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
// ============================================================================

import { dispose, forEach } from './entity';

// ---- 轮转决策（纯逻辑，Node 可测） ----

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
  economy: { coins: number; yinde: number; peach: number   /** P1-2 体素区全量（营造司；[gx,gy,gz,t] 扁平；缺省字段向后兼容） */
  voxel?: number[];
  /** P1-2 生存循环快照（hp/hunger/faints/bossesDown） */
  survival?: { hp: number; hunger: number; faints: number; bossesDown: number };
};
  /** P0-1 实体表 persist 实体（步 3 接管后填充；当前恒空数组——字段先行） */
  entities: Array<{ eid: number; kind: string; x: number; y: number; z: number; provenance?: unknown }>;
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
  if (d.schemaVersion === 2) return d;
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
export function collectPersistedEntities(): SaveDataV2['entities'] {
  const out: SaveDataV2['entities'] = [];
  for (const kind of ['npc', 'beast', 'creation'] as const) {
    forEach(kind, (rec) => {
      if (!rec.persist) return;
      out.push({ eid: rec.id, kind: rec.kind, x: rec.pos.x, y: rec.pos.y, z: rec.pos.z, provenance: rec.provenance });
    });
  }
  return out;
}

// ---- IndexedDB 封装 ----

const DB_NAME = 'sanjie-save';
const DB_VERSION = 1;
const SLOTS_STORE = 'slots';
const INDEX_STORE = 'index';

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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 原子写（H4 修订②③）：stringify 先行（同步抛错挡在事务外）→ 单 readwrite 事务双 store →
   * 每个 put 包 try/catch，catch 里显式 tx.abort()（实测：不显式 abort 会半写提交）。
   */
  async save(data: SaveData): Promise<{ slot: string; bytes: number }> {
    if (!this.db) throw new Error('SaveManager.open() first');
    const payload = JSON.stringify(data);          // 同步抛错挡在事务外
    const bytes = payload.length;
    const slot = this.slots.pickSlot();
    const db = this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SLOTS_STORE, INDEX_STORE], 'readwrite');
      try {
        tx.objectStore(SLOTS_STORE).put(payload, slot);
        tx.objectStore(INDEX_STORE).put({ lastGood: slot, bytes, savedAt: data.savedAt }, 'lastGood');
      } catch (err) {
        tx.abort();                                // H4 修订②：同步抛错必须显式 abort
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return { slot, bytes };
  }

  /** 读取：lastGood 优先，坏档逐槽回退（H4 修订③）；全空时返回 null 由调用方走 legacy 迁移 */
  async load(): Promise<SaveData | null> {
    if (!this.db) throw new Error('SaveManager.open() first');
    const db = this.db;
    const index = await new Promise<{ lastGood: string | null }>((resolve) => {
      const tx = db.transaction(INDEX_STORE, 'readonly');
      const req = tx.objectStore(INDEX_STORE).get('lastGood');
      req.onsuccess = () => resolve({ lastGood: (req.result as { lastGood?: string } | undefined)?.lastGood ?? null });
      req.onerror = () => resolve({ lastGood: null });
    });
    const order = this.slots.readOrder(index.lastGood);
    for (const slot of order) {
      const raw = await new Promise<string | null>((resolve) => {
        const tx = db.transaction(SLOTS_STORE, 'readonly');
        const req = tx.objectStore(SLOTS_STORE).get(slot);
        req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
      if (raw === null) continue;
      try {
        const parsed = JSON.parse(raw) as SaveDataV1 | SaveDataV2;
        const migrated = migrate(parsed);
        if (migrated) return migrated;
      } catch {
        continue;                                  // 坏档：顺序回退下一槽（H4 恢复演练语义）
      }
    }
    return null;
  }

  /** persist 授权（H4 修订④：不申请会被 Eviction 回收） */
  async requestPersist(): Promise<boolean> {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch { /* 环境不支持，如实返回 false */ }
    return false;
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage ?? 0, quota: est?.quota ?? 0 };
  }

  close(): void { this.db?.close(); this.db = null; }
}

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
