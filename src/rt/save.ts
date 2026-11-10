// ============================================================================
// 存档（P0-4）· src/rt/save.ts
//
// H4 spike 定案（artifacts/spike-H4-idb-save.md，五修订）：
//   ① 方案 A：原始 JSON 字符串 + 单 readwrite 事务双 store（slots + index）——禁止手工压缩
//     （Chrome 存储层已自动 Snappy，双重压缩负收益且落盘反大 21MB，实测）；
//   ② put 同步抛错不会自动 abort（实测半写提交）——所有 put 必须 try/catch 内显式 tx.abort()；
//   ③ 版本化槽位 + lastGood 指针 + 「写坏→顺序回退→校验」恢复路径（实测演练通过）；
//   ④ persist() 授权进启动流程（实测 false，不申请会被 Eviction 回收）；
//   ⑤ 真实存档序列化复测列 P0-4 探针（payload 合成≠逐字段真实）。
//
// 轮转/回退决策抽成纯类（SaveSlots）可 Node 单测；IndexedDB IO 独立（SaveManager），
// 全链验收走页面探针 scripts/probe-save-atomic.mjs。
//
// ---- SAV-001 / SAV-003 追加（v1.2：早于一切内容扩容）----
//   ⑥ 写前算 digest、写后回读校验：定长 4KB 头（magic/len/digest/schemaVersion/at/reason）
//      + body；回读比对「头 + 长度 + digest」，不符 → 标 bad 并移入隔离，绝不静默跳过；
//   ⑦ quarantine object store（DB_VERSION 升 2）：坏档「移入隔离不删除」，数据永远留给
//      玩家一次诊断/导出的机会；活动槽 delete 只为释放槽位，原始字节留在 quarantine；
//   ⑧ navigator.locks.request('sanjie-save', {mode:'exclusive'}) 串行化写；不支持则
//      Promise 链内存锁。锁 runner 与存储 backend 均可注入，策略层/测试无需真 IDB；
//   ⑨ 顶层模块函数 health/quarantine/newGameSlot/listSlots/loadSlot/requestSave 基于
//      懒单例 backend（IDB 优先，失败降级 localStorage 三键 + 槽镜像），失败原因落
//      localStorage['cq_last_save_error']（≤2KB，code/ts/slot/bytes，无网络上报）。
//   ⑩ 保持 SCHEMA_VERSION=2 / migrate / legacyFromLocalStorage / SaveSlots 全部旧语义，
//      load() 同时兼容「无 envelope 的旧 v0/v1/v2 槽」与「带头的新槽」。
// ============================================================================

import { dispose, forEach } from './entity';

// ---- 轮转决策（纯逻辑，Node 可测；SAV-001 不改动此类，save.test.ts 依赖其语义） ----

export const SLOT_COUNT = 3;

export class SaveSlots {
  private next = 0;

  /** 本次写入应用的槽名（save:v0/v1/v2 轮转） */
  pickSlot(): string { return `save:v${this.next++ % SLOT_COUNT}`; }

  /** 读取顺序：lastGood 槽最先，其余按槽号降序（轮转单调 ⇒ 号大 = 最近写 = 新→旧） */
  readOrder(lastGood: string | null): string[] {
    const all = Array.from({ length: SLOT_COUNT }, (_, i) => `save:v${i}`);
    const rest = all.filter((s) => s !== lastGood).reverse();   // 号降序：v2, v1, v0
    if (lastGood && all.includes(lastGood)) return [lastGood, ...rest];
    return rest;
  }
}

// ---- 存档数据形态 ----

export const SCHEMA_VERSION = 2;
/** v1 = legacy：localStorage 三键（cq_coins/cq_yinde/cq_peach）的直译形态 */
export interface SaveDataV1 { schemaVersion: 1; coins: number; yinde: number; peach: number }
export interface SaveDataV2 {
  schemaVersion: 2;
  savedAt: number;
  economy: { coins: number; yinde: number; peach: number };
  /** P0-1 实体表 persist 实体（步 2 只读接入——collectPersistedEntities 填充） */
  entities: Array<{ eid: number; kind: string; x: number; y: number; z: number; provenance?: unknown }>;
  /** P1-2 体素区全量（营造司；[gx,gy,gz,t] 扁平；缺省字段向后兼容） */
  voxel?: number[];
  /** P1-2 生存循环快照（hp/hunger/faints/bossesDown） */
  survival?: { hp: number; hunger: number; faints: number; bossesDown: number };
  /** P1-5 业力快照 */
  karma?: number;
  /** 全量审核 2026-11-07：巨灵神战绩（跨会话防重复领奖；v2 可选字段，旧档缺省 false） */
  bossDefeated?: boolean;
}
export type SaveData = SaveDataV2;

/** 迁移链：v1 → v2（后续版本在此追加 case；未知未来版本原样返回由上层拒载） */
export function migrate(d: SaveDataV1 | SaveDataV2): SaveDataV2 | null {
  if (d.schemaVersion === 1) {
    return {
      schemaVersion: 2,
      savedAt: Date.now(),
      economy: { coins: d.coins, yinde: d.yinde, peach: d.peach },
      entities: [],
    };
  }
  if (d.schemaVersion === 2) {
    // 全量审核 2026-11-07（C07）：旧实现 `return d` 对 v2 零校验，半写/损坏档
    // （如 `{\"schemaVersion\":2}`）会在 world.ts 读 `saved.economy.coins` 时抛 TypeError，
    // 被上层 catch 吞成「走新档」。这里只做字段有效性校验 + 最小补齐：
    // 合法档原样返回，保证 save.test.ts 的 `expect(migrate(v2())).toEqual(v2())` 不变。
    const e = d.economy;
    if (!e || !Number.isFinite(e.coins) || !Number.isFinite(e.yinde) || !Number.isFinite(e.peach)) return null;
    if (d.survival && !Number.isFinite(d.survival.hp)) return null;
    if (typeof d.karma === 'number' && !Number.isFinite(d.karma)) return null;
    if (d.voxel && !Array.isArray(d.voxel)) return null;
    return Array.isArray(d.entities) ? d : { ...d, entities: [] };
  }
  return null;                                   // 比当前更新的版本：上层拒载（降版本兼容不做）
}

/** legacy localStorage 三键 → v1 形态（NaN 安全，与 interact.loadInt 同口径） */
export function legacyFromLocalStorage(storage: Storage): SaveDataV1 {
  const num = (key: string, dflt: number): number => {
    const v = parseInt(storage.getItem(key) ?? '', 10);
    return Number.isNaN(v) ? dflt : v;
  };
  return { schemaVersion: 1, coins: num('cq_coins', 500), yinde: num('cq_yinde', 0), peach: num('cq_peach', 3) };
}

/** 实体表快照（P0-1 步 3 接管后由调用方传 persist 实体集；当前接口先行、调用后补） */
/**
 * P0-1 步 2（只读接入）：从实体表遍历 persist 实体生成存档数组——不维护自己的数组
 * （spec §6：存档是表的读方）。顺序 = allocate 顺序（单调 id 序，A8 确定性口径）。
 */
/**
 * 全量审核 2026-11-07（C01 口径收窄）：新增可选品类参数，默认仍为全量（向后兼容）。
 * 写档侧只传 `['creation']`：`crowd.ts:1366` 给**每个 NPC** 都登记了 persist:true，
 * 全城 4500+ 实例的实时坐标若每次经济操作都 JSON.stringify 进 IDB，会让档体积暴涨，
 * 且读档侧本就只重演 creation（npc/beast 由生成器每会话重建），写了也读不回。
 */
export function collectPersistedEntities(
  kinds: readonly ('npc' | 'beast' | 'creation')[] = ['npc', 'beast', 'creation'],
): SaveDataV2['entities'] {
  const out: SaveDataV2['entities'] = [];
  for (const kind of kinds) {
    forEach(kind, (rec) => {
      if (!rec.persist) return;
      out.push({ eid: rec.id, kind: rec.kind, x: rec.pos.x, y: rec.pos.y, z: rec.pos.z, provenance: rec.provenance });
    });
  }
  return out;
}

// ============================================================================
// SAV-001 / SAV-003：槽常量、类型、纯函数
// ============================================================================

export type SaveReason = 'auto' | 'manual' | 'exit' | 'checkpoint';
/** 坏档原因：digest 不符 / 长度或头损坏 / schema 拒载 / 槽不存在 */
export type BadReason = 'digest' | 'length' | 'schema' | 'absent';

export type SaveHealth = {
  slot: string;
  ok: boolean;
  reason?: BadReason;
  bytes?: number;
  at?: number;
};

/** 自动槽（轮转，永不覆盖手动槽）/ 手动槽（只随玩家操作变化）/ 旧版轮转槽 */
export const AUTO_SLOTS = ['save:a0', 'save:a1', 'save:a2'] as const;
export const MANUAL_SLOTS = ['save:m1', 'save:m2', 'save:m3'] as const;
export const LEGACY_SLOTS = ['save:v0', 'save:v1', 'save:v2'] as const;
export const ALL_USER_SLOTS: string[] = [...AUTO_SLOTS, ...MANUAL_SLOTS];
export const ALL_SLOTS: string[] = [...LEGACY_SLOTS, ...AUTO_SLOTS, ...MANUAL_SLOTS];

/** 纯函数：自动槽轮转。入参为单调递增的轮次（整数/hash，不用 Math.random，INV-01）。 */
export function pickAutoSlot(turn: number): string {
  const i = Math.abs(Math.trunc(turn)) % AUTO_SLOTS.length;
  return AUTO_SLOTS[i];
}

/** 纯函数：以新档开始——优先复用空的手动槽，全占用则按时间戳生成确定性新 key（无随机）。 */
export function chooseNewGameSlot(occupied: readonly string[], now: number): string {
  for (const k of MANUAL_SLOTS) if (!occupied.includes(k)) return k;
  return `save:m${Math.abs(Math.trunc(now)).toString(36)}`;
}

// ---- 4KB 头 + 长度 + digest（SAV-003 R1）----

export const HEAD_SIZE = 4096;            // 写后回读校验读回的「4KB 头」
const MAGIC = 'CQSAVE2';

/** FNV-1a 32bit 变体（UTF-16 code unit），确定性、零 Math.random（INV-01）。 */
export function computeDigest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

export interface SlotHeader {
  magic: string;
  len: number;
  digest: string;
  schemaVersion: number;
  at: number;
  reason: SaveReason;
}

/** 写前算 digest：头 JSON 定长补齐到 4KB，尾部拼接原始 payload（不压缩，H4 修订①）。 */
export function packSlot(
  payload: string,
  meta: { schemaVersion: number; at: number; reason: SaveReason },
): string {
  const head: SlotHeader = {
    magic: MAGIC,
    len: payload.length,
    digest: computeDigest(payload),
    schemaVersion: meta.schemaVersion,
    at: meta.at,
    reason: meta.reason,
  };
  const headText = JSON.stringify(head);
  if (headText.length > HEAD_SIZE) throw new Error('slot header exceeds 4KB');
  return headText.padEnd(HEAD_SIZE, '\u0000') + payload;
}

export interface VerifyResult { ok: boolean; payload?: string; reason?: BadReason; header?: SlotHeader }

/** 写后回读校验：解析 4KB 头 → 比对 magic / 长度 / digest。不做 schema 判定（留给上层 migrate）。 */
export function verifySlot(raw: string | null | undefined): VerifyResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'absent' };
  if (raw.length < HEAD_SIZE) return { ok: false, reason: 'length' };
  const headText = raw.slice(0, HEAD_SIZE).replace(/\u0000+$/, '');
  let head: SlotHeader;
  try { head = JSON.parse(headText) as SlotHeader; } catch { return { ok: false, reason: 'length' }; }
  if (!head || head.magic !== MAGIC) return { ok: false, reason: 'length' };
  const body = raw.slice(HEAD_SIZE);
  if (typeof head.len !== 'number' || body.length !== head.len) return { ok: false, reason: 'length', header: head };
  if (head.digest !== computeDigest(body)) return { ok: false, reason: 'digest', header: head };
  return { ok: true, payload: body, header: head };
}

/**
 * 兼容解析：新格式（带头）走 verifySlot；旧格式（无 envelope 的原始 JSON 字符串，
 * 由 H4 时代 __saveSave / loadOrMigrateLegacy 写入）直接 JSON.parse + migrate。
 * digest 不符一律拒读（SAV-003 R1「不符标 bad 并跳过」）。
 */
export function parseSlotRaw(raw: string | null): { data: SaveData | null; reason?: BadReason } {
  if (raw === null) return { data: null, reason: 'absent' };
  const v = verifySlot(raw);
  if (!v.ok && v.reason === 'digest') return { data: null, reason: 'digest' };
  const body = v.ok && v.payload !== undefined ? v.payload : raw;
  try {
    const parsed = JSON.parse(body) as SaveDataV1 | SaveDataV2;
    const migrated = migrate(parsed);
    return { data: migrated, reason: migrated ? undefined : 'schema' };
  } catch {
    return { data: null, reason: v.ok ? 'schema' : 'length' };
  }
}

// ---- 串行化锁（SAV-003 R4）：Web Locks 优先，不支持则内存 Promise 链 ----

export interface LockLike {
  request<T>(name: string, options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<T>): Promise<T>;
}

export function createSerialLock(getLocks?: () => LockLike | null) {
  let chain: Promise<unknown> = Promise.resolve();
  const LOCK_NAME = 'sanjie-save';
  return async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = getLocks ? getLocks() : null;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, { mode: 'exclusive' }, fn);
    }
    // 内存锁：后一个写排队到前一个写完（无论成败），禁止并发写
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}

let locksOverride: LockLike | null | undefined;
/** 注入点：configureSaveLocks(fake) 走 Web Locks 路径；configureSaveLocks(null) 强制内存锁；
 *  configureSaveLocks(undefined) 恢复自动检测。测试与真机共用同一 runner。 */
export function configureSaveLocks(l: LockLike | null | undefined): void { locksOverride = l; }

function resolveLocks(): LockLike | null {
  if (locksOverride !== undefined) return locksOverride;
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { locks?: LockLike }).locks ?? null;
}

export const withSaveLock = createSerialLock(resolveLocks);

// ============================================================================
// IndexedDB 封装
// ============================================================================

const DB_NAME = 'sanjie-save';
const DB_VERSION = 2;                 // SAV-003 R2：升版新增 quarantine store（v1 库只增 store，数据不动）
const SLOTS_STORE = 'slots';
const INDEX_STORE = 'index';
const QUARANTINE_STORE = 'quarantine';

export interface SaveWriteResult { slot: string; bytes: number; ms: number; ok: boolean; reason?: BadReason }
export interface SaveSlotRecord {
  key: string;
  bytes: number;
  at: number;
  ok: boolean;
  reason?: BadReason;
  data?: unknown;
}

export class SaveManager {
  private db: IDBDatabase | null = null;
  readonly slots = new SaveSlots();

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SLOTS_STORE)) db.createObjectStore(SLOTS_STORE);
        if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE);
        if (!db.objectStoreNames.contains(QUARANTINE_STORE)) db.createObjectStore(QUARANTINE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error('SaveManager.open() first');
    return this.db;
  }

  available(): boolean { return this.db !== null; }

  private async getRaw(slot: string): Promise<string | null> {
    const db = this.requireDb();
    return new Promise<string | null>((resolve) => {
      const tx = db.transaction(SLOTS_STORE, 'readonly');
      const req = tx.objectStore(SLOTS_STORE).get(slot);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  }

  private async getIndexValue(key: string): Promise<unknown> {
    const db = this.requireDb();
    return new Promise<unknown>((resolve) => {
      const tx = db.transaction(INDEX_STORE, 'readonly');
      const req = tx.objectStore(INDEX_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  }

  private async getQuarantineRaw(slot: string): Promise<string | null> {
    const db = this.requireDb();
    return new Promise<string | null>((resolve) => {
      const tx = db.transaction(QUARANTINE_STORE, 'readonly');
      const req = tx.objectStore(QUARANTINE_STORE).get(slot);
      req.onsuccess = () => resolve(((req.result as { raw?: string } | undefined)?.raw) ?? null);
      req.onerror = () => resolve(null);
    });
  }

  /** 单 readwrite 事务双 store；put 同步抛错必须显式 tx.abort()（H4 修订②）。 */
  private async putRaw(slot: string, raw: string, meta: { at: number; bytes: number; reason: SaveReason; schemaVersion: number }): Promise<void> {
    const db = this.requireDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SLOTS_STORE, INDEX_STORE], 'readwrite');
      try {
        tx.objectStore(SLOTS_STORE).put(raw, slot);
        tx.objectStore(INDEX_STORE).put({ lastGood: slot, ...meta }, 'lastGood');
      } catch (err) {
        tx.abort();
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('save tx aborted'));
    });
  }

  /**
   * SAV-003 R1/R4：带锁原子写 + 写前算 digest + 写后回读校验（4KB 头 + 长度 + digest）。
   * 校验不符 → 该槽标 bad（index 记录）并移入 quarantine（不删数据，SAV-003 R2）。
   */
  async writeSlot(slot: string, data: unknown, reason: SaveReason): Promise<SaveWriteResult> {
    const t0 = Date.now();
    let payload: string;
    let raw: string;
    try {
      payload = JSON.stringify(data);
      const schemaVersion = typeof (data as { schemaVersion?: unknown } | null)?.schemaVersion === 'number'
        ? (data as { schemaVersion: number }).schemaVersion : SCHEMA_VERSION;
      raw = packSlot(payload, { schemaVersion, at: Date.now(), reason });
    } catch (err) {
      recordLastSaveError({ code: 'serialize-failed', slot, bytes: 0, detail: String(err) });
      return { slot, bytes: 0, ms: Date.now() - t0, ok: false, reason: 'length' };
    }
    const bytes = raw.length;
    return withSaveLock(async () => {
      try {
        await this.putRaw(slot, raw, { at: Date.now(), bytes, reason, schemaVersion: SCHEMA_VERSION });
        const back = await this.getRaw(slot);
        const v = verifySlot(back);
        if (!v.ok) {
          await this.quarantineSlot(slot, v.reason ?? 'length', back);
          recordLastSaveError({ code: 'verify-failed', slot, bytes, detail: v.reason });
          return { slot, bytes, ms: Date.now() - t0, ok: false, reason: v.reason };
        }
        return { slot, bytes, ms: Date.now() - t0, ok: true };
      } catch (err) {
        recordLastSaveError({ code: 'write-failed', slot, bytes, detail: String(err) });
        return { slot, bytes, ms: Date.now() - t0, ok: false, reason: 'length' };
      }
    });
  }

  /** 保持旧链：__saveSave(d) / loadOrMigrateLegacy 调它；轮转 v0/v1/v2，补 savedAt 兜底。 */
  async save(data: SaveData, slot?: string): Promise<SaveWriteResult> {
    const full = { ...data, savedAt: data.savedAt ?? Date.now() } as SaveData;
    return this.writeSlot(slot ?? this.slots.pickSlot(), full, 'checkpoint');
  }

  /** 面板读档：返回原始快照交主代理 applySnapshot；digest 不符明确拒读。 */
  async readSlot(key: string): Promise<{ ok: boolean; data?: unknown; reason?: BadReason }> {
    const raw = await this.getRaw(key);
    if (raw === null) {
      const q = await this.getQuarantineRaw(key);
      if (q !== null) return { ok: false, reason: 'digest' };   // 已隔离：可导出诊断，不可直接读
      return { ok: false, reason: 'absent' };
    }
    const v = verifySlot(raw);
    if (!v.ok && v.reason === 'digest') return { ok: false, reason: 'digest' };
    const body = v.ok && v.payload !== undefined ? v.payload : raw;   // 兼容旧格式
    try {
      return { ok: true, data: JSON.parse(body) as unknown };
    } catch {
      return { ok: false, reason: 'length' };
    }
  }

  async listSlotRecords(): Promise<SaveSlotRecord[]> {
    const out: SaveSlotRecord[] = [];
    for (const key of ALL_SLOTS) {
      const raw = await this.getRaw(key);
      if (raw === null) { out.push({ key, bytes: 0, at: 0, ok: false, reason: 'absent' }); continue; }
      const v = verifySlot(raw);
      const body = v.ok && v.payload !== undefined ? v.payload : raw;
      let data: unknown;
      try { data = JSON.parse(body) as unknown; } catch { data = undefined; }
      let at = 0;
      try {
        const h = JSON.parse(raw.slice(0, HEAD_SIZE).replace(/\u0000+$/, '')) as { at?: number };
        at = h?.at ?? 0;
      } catch { at = (data as { savedAt?: number } | undefined)?.savedAt ?? 0; }
      const bad = await this.getIndexValue('bad:' + key);
      const reason: BadReason | undefined = !v.ok ? v.reason : (data === undefined ? 'schema' : (bad ? 'digest' : undefined));
      const ok = v.ok && data !== undefined && !bad;
      out.push({ key, bytes: raw.length, at, ok, reason, data: ok ? data : undefined });
    }
    return out;
  }

  async removeSlot(key: string): Promise<void> {
    const db = this.requireDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SLOTS_STORE, INDEX_STORE], 'readwrite');
      try {
        tx.objectStore(SLOTS_STORE).delete(key);
        tx.objectStore(INDEX_STORE).delete('bad:' + key);
      } catch (err) { tx.abort(); reject(err); return; }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('remove tx aborted'));
    });
    // 注意：不触碰 quarantine —— 隔离数据永远保留（SAV-003 R2「隔离而非删除」）
  }

  async copySlot(key: string, toKey: string): Promise<boolean> {
    const raw = await this.getRaw(key);
    if (raw === null) return false;
    try {
      await this.putRaw(toKey, raw, { at: Date.now(), bytes: raw.length, reason: 'manual', schemaVersion: SCHEMA_VERSION });
      return true;
    } catch { return false; }
  }

  /** 坏档移入 quarantine（保留原始字节），活动槽 delete 释放槽位，index 记 bad 标记。 */
  async quarantineSlot(slot: string, reason: BadReason, rawOverride?: string | null): Promise<boolean> {
    const db = this.requireDb();
    const raw = rawOverride === undefined ? await this.getRaw(slot) : rawOverride;
    if (raw === null) return false;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SLOTS_STORE, QUARANTINE_STORE, INDEX_STORE], 'readwrite');
        try {
          tx.objectStore(QUARANTINE_STORE).put({ slot, raw, reason, at: Date.now() }, slot);  // 保留，供诊断/导出
          tx.objectStore(SLOTS_STORE).delete(slot);                                            // 从活动槽移出
          tx.objectStore(INDEX_STORE).put({ slot, reason, at: Date.now() }, 'bad:' + slot);
        } catch (err) { tx.abort(); reject(err); return; }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('quarantine tx aborted'));
      });
      return true;
    } catch { return false; }
  }

  async health(): Promise<SaveHealth[]> {
    const out: SaveHealth[] = [];
    for (const slot of ALL_SLOTS) {
      const raw = await this.getRaw(slot);
      const bad = await this.getIndexValue('bad:' + slot);
      if (raw === null) {
        out.push(bad ? { slot, ok: false, reason: 'digest' } : { slot, ok: false, reason: 'absent' });
        continue;
      }
      const v = verifySlot(raw);
      if (!v.ok) { out.push({ slot, ok: false, reason: v.reason, bytes: raw.length }); continue; }
      let schemaOk = false;
      try {
        const p = JSON.parse(v.payload ?? '') as { schemaVersion?: unknown };
        schemaOk = !!p && typeof p === 'object'
          && Number.isFinite(p.schemaVersion) && (p.schemaVersion as number) <= SCHEMA_VERSION;
      } catch { schemaOk = false; }
      let at: number | undefined;
      try { at = (JSON.parse(raw.slice(0, HEAD_SIZE).replace(/\u0000+$/, '')) as { at?: number }).at; } catch { at = undefined; }
      out.push({ slot, ok: schemaOk && !bad, reason: !schemaOk ? 'schema' : (bad ? 'digest' : undefined), bytes: raw.length, at });
    }
    return out;
  }

  async newGameSlot(): Promise<string> {
    const occupied: string[] = [];
    for (const k of MANUAL_SLOTS) if (await this.getRaw(k) !== null) occupied.push(k);
    return chooseNewGameSlot(occupied, Date.now());
  }

  /** 读取：lastGood 优先，坏档逐槽回退（H4 修订③）；兼容旧无-envelope 槽与新 a/m 槽。 */
  async load(): Promise<SaveData | null> {
    this.requireDb();
    const index = await new Promise<{ lastGood: string | null }>((resolve) => {
      const tx = this.requireDb().transaction(INDEX_STORE, 'readonly');
      const req = tx.objectStore(INDEX_STORE).get('lastGood');
      req.onsuccess = () => resolve({ lastGood: (req.result as { lastGood?: string } | undefined)?.lastGood ?? null });
      req.onerror = () => resolve({ lastGood: null });
    });
    const order: string[] = [];
    const seen = new Set<string>();
    const push = (k: string): void => { if (k && !seen.has(k)) { seen.add(k); order.push(k); } };
    push(index.lastGood ?? '');
    for (const s of this.slots.readOrder(index.lastGood)) push(s);
    for (const s of [...AUTO_SLOTS].reverse()) push(s);
    for (const s of [...MANUAL_SLOTS].reverse()) push(s);
    for (const slot of order) {
      const parsed = parseSlotRaw(await this.getRaw(slot));
      if (parsed.data) return parsed.data;
    }
    return null;
  }

  /** persist 授权（H4 修订④：不申请会被 Eviction 回收） */
  async requestPersist(): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) return await navigator.storage.persist();
    } catch { /* 环境不支持，如实返回 false */ }
    return false;
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    try {
      if (typeof navigator !== 'undefined') {
        const est = await navigator.storage?.estimate?.();
        return { usage: est?.usage ?? 0, quota: est?.quota ?? 0 };
      }
    } catch { /* ignore */ }
    return { usage: 0, quota: 0 };
  }

  close(): void { this.db?.close(); this.db = null; }
}

// ============================================================================
// 存储 backend 契约（策略层 / 恢复层 / 面板 / 测试共用，解耦 IndexedDB）
// ============================================================================

export interface SaveBackend {
  available(): boolean;
  write(slot: string, data: unknown, reason: SaveReason): Promise<SaveWriteResult>;
  read(key: string): Promise<{ ok: boolean; data?: unknown; reason?: BadReason }>;
  list(): Promise<SaveSlotRecord[]>;
  remove(key: string): Promise<void>;
  copy(key: string, toKey: string): Promise<boolean>;
  quarantine(key: string): Promise<boolean>;
  health(): Promise<SaveHealth[]>;
  newGameSlot(): Promise<string>;
}

export function idbBackend(mgr: SaveManager): SaveBackend {
  return {
    available: () => mgr.available(),
    write: (slot, data, reason) => mgr.writeSlot(slot, data, reason),
    read: (key) => mgr.readSlot(key),
    list: () => mgr.listSlotRecords(),
    remove: (key) => mgr.removeSlot(key),
    copy: (key, toKey) => mgr.copySlot(key, toKey),
    quarantine: (key) => mgr.quarantineSlot(key, 'digest'),
    health: () => mgr.health(),
    newGameSlot: () => mgr.newGameSlot(),
  };
}

/** IDB 不可用时的降级 backend：localStorage 槽镜像（容量有限，R5 需常驻告知）。 */
export function localStorageBackend(): SaveBackend {
  const ls = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);
  const rawKey = (k: string): string => 'cq_slot:' + k;
  const qKey = (k: string): string => 'cq_quarantine:' + k;
  const readRaw = (k: string): string | null => { try { return ls()?.getItem(rawKey(k)) ?? null; } catch { return null; } };
  const writeRaw = (k: string, raw: string): void => {
    const s = ls();
    if (!s) throw new Error('localStorage unavailable');
    s.setItem(rawKey(k), raw);
  };
  const keys = (): string[] => ALL_SLOTS;
  return {
    available: () => false,
    async write(slot, data, reason) {
      const t0 = Date.now();
      try {
        const payload = JSON.stringify(data);
        const raw = packSlot(payload, { schemaVersion: SCHEMA_VERSION, at: Date.now(), reason });
        writeRaw(slot, raw);
        const back = readRaw(slot);
        const v = verifySlot(back);
        if (!v.ok) {
          try { ls()?.setItem(qKey(slot), raw); } catch { /* ignore */ }
          return { slot, bytes: raw.length, ms: Date.now() - t0, ok: false, reason: v.reason };
        }
        return { slot, bytes: raw.length, ms: Date.now() - t0, ok: true };
      } catch (err) {
        recordLastSaveError({ code: 'ls-write-failed', slot, bytes: 0, detail: String(err) });
        return { slot, bytes: 0, ms: Date.now() - t0, ok: false, reason: 'length' };
      }
    },
    async read(key) {
      const raw = readRaw(key);
      if (raw === null) return { ok: false, reason: 'absent' };
      const v = verifySlot(raw);
      if (!v.ok && v.reason === 'digest') return { ok: false, reason: 'digest' };
      const body = v.ok && v.payload !== undefined ? v.payload : raw;
      try { return { ok: true, data: JSON.parse(body) as unknown }; } catch { return { ok: false, reason: 'length' }; }
    },
    async list() {
      return keys().map((key): SaveSlotRecord => {
        const raw = readRaw(key);
        if (raw === null) return { key, bytes: 0, at: 0, ok: false, reason: 'absent' };
        const v = verifySlot(raw);
        const body = v.ok && v.payload !== undefined ? v.payload : raw;
        let data: unknown;
        try { data = JSON.parse(body) as unknown; } catch { data = undefined; }
        let at = 0;
        try { at = (JSON.parse(raw.slice(0, HEAD_SIZE).replace(/\u0000+$/, '')) as { at?: number }).at ?? 0; } catch { at = 0; }
        const ok = v.ok && data !== undefined;
        return { key, bytes: raw.length, at, ok, reason: ok ? undefined : v.reason ?? 'schema', data: ok ? data : undefined };
      });
    },
    async remove(key) { try { ls()?.removeItem(rawKey(key)); } catch { /* ignore */ } },
    async copy(key, toKey) {
      const raw = readRaw(key);
      if (raw === null) return false;
      try { writeRaw(toKey, raw); return true; } catch { return false; }
    },
    async quarantine(key) {
      const raw = readRaw(key);
      if (raw === null) return false;
      try { ls()?.setItem(qKey(key), raw); ls()?.removeItem(rawKey(key)); return true; } catch { return false; }
    },
    async health() {
      return keys().map((slot): SaveHealth => {
        const raw = readRaw(slot);
        if (raw === null) return { slot, ok: false, reason: 'absent' };
        const v = verifySlot(raw);
        if (!v.ok) return { slot, ok: false, reason: v.reason, bytes: raw.length };
        return { slot, ok: true, bytes: raw.length };
      });
    },
    async newGameSlot() {
      const occupied = keys().filter((k) => MANUAL_SLOTS.includes(k as typeof MANUAL_SLOTS[number]) && readRaw(k) !== null);
      return chooseNewGameSlot(occupied, Date.now());
    },
  };
}

// ---- 顶层模块函数（懒单例 + 可注入 backend）----

let backendOverride: SaveBackend | undefined;
/** 注入点：测试注入内存/假 backend；configureSaveBackend(undefined) 恢复自动检测。 */
export function configureSaveBackend(b: SaveBackend | undefined): void { backendOverride = b; }

let cachedMgr: SaveManager | null = null;
let opening: Promise<SaveManager> | null = null;

async function ensureMgr(): Promise<SaveManager> {
  if (cachedMgr) return cachedMgr;
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
  if (!opening) {
    opening = (async () => {
      const m = new SaveManager();
      await m.open();
      await m.requestPersist().catch(() => false);
      cachedMgr = m;
      return m;
    })().catch((e: unknown) => { opening = null; throw e; });
  }
  return opening;
}

export async function getSaveBackend(): Promise<SaveBackend> {
  if (backendOverride) return backendOverride;
  try { return idbBackend(await ensureMgr()); }
  catch { return localStorageBackend(); }
}

/** IDB 是否真的可用（供恢复向导 R5 常驻降级告知；纯布尔，可测）。 */
export async function isIdbAvailable(): Promise<boolean> {
  if (backendOverride) return backendOverride.available();
  if (typeof indexedDB === 'undefined') return false;
  try { await ensureMgr(); return true; } catch { return false; }
}

export async function health(): Promise<SaveHealth[]> { return (await getSaveBackend()).health(); }
export async function quarantine(slot: string): Promise<boolean> { return (await getSaveBackend()).quarantine(slot); }
export async function newGameSlot(): Promise<string> { return (await getSaveBackend()).newGameSlot(); }
export async function listSlots(): Promise<SaveSlotRecord[]> { return (await getSaveBackend()).list(); }
export async function loadSlot(key: string): Promise<{ ok: boolean; data?: unknown; reason?: BadReason }> {
  return (await getSaveBackend()).read(key);
}

let autoTurn = 0;
function fallbackSnapshot(): unknown {
  try {
    if (typeof localStorage !== 'undefined') {
      const m = migrate(legacyFromLocalStorage(localStorage));
      if (m) return m;
    }
  } catch { /* ignore */ }
  return { schemaVersion: SCHEMA_VERSION, savedAt: Date.now(), economy: { coins: 500, yinde: 0, peach: 3 }, entities: [] };
}

/** 底层写档（SAV-001 导出）：策略层通常显式传 slot 与 data；单参调用走自动轮转 + 兜底快照。 */
export async function requestSave(reason: SaveReason, data?: unknown, slot?: string): Promise<SaveWriteResult> {
  const t0 = Date.now();
  const b = await getSaveBackend();
  const key = slot ?? (reason === 'manual' ? MANUAL_SLOTS[0] : pickAutoSlot(autoTurn++));
  const snapshot = data ?? fallbackSnapshot();
  const r = await b.write(key, snapshot, reason);
  if (!r.ok) recordLastSaveError({ code: 'write-failed', slot: key, bytes: r.bytes, detail: r.reason });
  return { ...r, ms: r.ms || (Date.now() - t0) };
}

// ---- 错误留存（SAV-003 R6）：≤2KB，含 code/ts/slot/bytes，无网络上报 ----

export const LAST_SAVE_ERROR_KEY = 'cq_last_save_error';
export interface LastSaveError { code: string; ts: number; slot: string; bytes: number; detail?: string }

export function recordLastSaveError(e: { code: string; slot: string; bytes: number; detail?: string }): LastSaveError {
  const rec: LastSaveError = { code: e.code, ts: Date.now(), slot: e.slot, bytes: e.bytes, detail: e.detail };
  let text = JSON.stringify(rec);
  if (text.length > 2048) {
    text = JSON.stringify({ code: rec.code, ts: rec.ts, slot: rec.slot, bytes: rec.bytes, detail: String(rec.detail ?? '').slice(0, 128) }).slice(0, 2048);
  }
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_SAVE_ERROR_KEY, text); } catch { /* ignore */ }
  return rec;
}

export function readLastSaveError(): LastSaveError | null {
  try {
    const t = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SAVE_ERROR_KEY) : null;
    return t ? JSON.parse(t) as LastSaveError : null;
  } catch { return null; }
}

// ============================================================================

/** legacy 迁移入口：IDB 全空时从 localStorage 三键组装 v1 → migrate → v2 */
export function loadOrMigrateLegacy(mgr: SaveManager, storage: Storage): Promise<SaveData | null> {
  return (async () => {
    const fromIdb = await mgr.load();
    if (fromIdb) return fromIdb;
    const legacy = legacyFromLocalStorage(storage);
    const hasAny = storage.getItem('cq_coins') !== null
      || storage.getItem('cq_yinde') !== null
      || storage.getItem('cq_peach') !== null;
    if (!hasAny) return null;
    const migrated = migrate(legacy);
    if (migrated) await mgr.save(migrated);        // 迁移即落档（旧档可开 + 一次性升级）
    return migrated;
  })();
}

// dispose 重导出：注销实体时的存档联动（persist:false 的实体 dispose 即从未来存档消失）由
// P0-1 步 3 接管——本模块只声明依赖方向，避免 world 直接 import entity 蔓延。
export { dispose };
