// ============================================================================
// 四层保存策略 · src/game/savePolicy.ts（SAV-001 R1/R4/R5/R6）
//
// 本模块是「策略层 / 产品层」，只 import 存储层 rt/save，**不 import world.ts / interact.ts**
// （避免循环依赖；主代理在 world.ts 里把 getSnapshot/applySnapshot/bus 接进来）。
// 所有外部依赖（时钟 / 定时器 / 事件总线 / window / 存储 backend / 提示）均可注入，
// 故 vitest 用假时钟 + 内存 backend 即可测，无需真 IndexedDB、无需 DOM。
//
// 四层：自动（安全点 + ≤120s 间隔）/ 检查点（安全点触发）/ 手动（Esc 面板，玩家主动）
//       / 退出（pagehide+beforeunload，同步 localStorage 三键 + 轻量摘要兜底，再异步全量）。
// ============================================================================

import {
  SCHEMA_VERSION, AUTO_SLOTS, MANUAL_SLOTS, LEGACY_SLOTS,
  pickAutoSlot, getSaveBackend,
  requestSave as rtRequestSave, listSlots as rtListSlots, loadSlot as rtLoadSlot,
  type SaveBackend, type SaveReason, type BadReason, type SaveSlotRecord,
} from '../rt/save';

// ---- 对外数据契约（SAV-001 接口与数据）----

export interface SaveSlotMeta {
  key: string;
  label: string;
  day: number;
  at: number;
  scale: string;
  karma: number;
  rank: number;
  playMs: number;
  schemaVersion: number;
  thumb?: string;
  ok: boolean;
}

export interface SaveResult { slot: string; bytes: number; ms: number; ok: boolean; reason?: string }
export interface SaveStateView {
  lastAutoMs: number;
  pending: boolean;
  slots: string[];
  saving: boolean;
  failCount: number;
  lastError?: string;
}

export type { SaveReason };

/** 安全点间隔上限：≤120s（SAV-001 R1）。测试据此断言常量不越界。 */
export const AUTO_INTERVAL_MS = 120_000;
/** 3s 内无 combat:hit 才安全 */
export const SAFE_COMBAT_GAP_MS = 3_000;
/** 默认 tick：每秒检查一次安全点/间隔（真实间隔由 now() 判定） */
export const DEFAULT_TICK_MS = 1_000;

/** 安全点五项信号（SAV-001 R1）。主代理用 getSafety() 直接映射，或用 bus 事件驱动。 */
export interface SafetyState {
  wanted: number;            // 通缉/威胁计数：<3 才安全
  lastCombatHitMs: number;   // 最近一次 combat:hit 的 now() 时间戳；-Infinity=从未
  dialogState: string;       // 'idle' 才安全
  buildPreview: unknown;     // === null 才安全
  switching: boolean;        // 场景切换中不写
}

export function defaultSafetyState(): SafetyState {
  return { wanted: 0, lastCombatHitMs: -Infinity, dialogState: 'idle', buildPreview: null, switching: false };
}

/** 纯函数：安全点五项判定（wanted<3 / 3s 无 combat:hit / dialog idle / 无建造预览 / 非切换）。 */
export function isSafePoint(s: SafetyState, now: number): boolean {
  return s.wanted < 3
    && (now - s.lastCombatHitMs) >= SAFE_COMBAT_GAP_MS
    && s.dialogState === 'idle'
    && s.buildPreview === null
    && !s.switching;
}

/** 纯函数：槽位标签（自动 / 手动 / 旧档），保证 label 稳定可测。 */
export function labelForSlot(key: string): string {
  const ai = (AUTO_SLOTS as readonly string[]).indexOf(key);
  if (ai >= 0) return `自动档 ${ai + 1}`;
  const mi = (MANUAL_SLOTS as readonly string[]).indexOf(key);
  if (mi >= 0) return `手动档 ${mi + 1}`;
  const vi = (LEGACY_SLOTS as readonly string[]).indexOf(key);
  if (vi >= 0) return `旧档 v${vi}`;
  return key;
}

/** 纯函数：存储层 record → 面板 SaveSlotMeta。缺字段走确定性缺省（不用 Math.random）。 */
export function toSlotMeta(rec: SaveSlotRecord): SaveSlotMeta {
  const d = (rec.data ?? {}) as Record<string, unknown>;
  const meta = (d.meta ?? {}) as Record<string, unknown>;
  const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
  const thumbRaw = d.thumb ?? meta.thumb;
  return {
    key: rec.key,
    label: typeof d.label === 'string' ? d.label : labelForSlot(rec.key),
    day: num(d.day ?? meta.day, 1),
    at: rec.at || num(d.savedAt, 0),
    scale: String(d.scale ?? meta.scale ?? '人间'),
    karma: num(d.karma, 0),
    rank: num(d.rank ?? meta.rank, 0),
    playMs: num(d.playMs ?? meta.playMs, 0),
    schemaVersion: num(d.schemaVersion, SCHEMA_VERSION),
    thumb: typeof thumbRaw === 'string' ? thumbRaw : undefined,
    ok: rec.ok,
  };
}

// ---- 可注入鸭子类型 ----

export interface BusLike {
  on(evt: string, fn: (p?: unknown) => void): void | (() => void);
  emit(evt: string, p?: unknown): void;
}
export interface Scheduler {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}
export type NotifyKind = 'ok' | 'fail';
export interface NotifyPayload {
  kind: NotifyKind;
  reason?: string;
  slot?: string;
  bytes?: number;
  ms?: number;
  retry?: () => void;
}
export type Notifier = (p: NotifyPayload) => void;

export interface InitSaveOptions {
  /** 必填：主代理提供当前游戏快照（SaveDataV2 形状，或任意可序列化对象） */
  getSnapshot(): unknown;
  /** 必填：读档时把快照写回游戏 */
  applySnapshot(s: unknown): void;
  bus?: BusLike;
  now?: () => number;
  /** 直接读 world 安全点信号（优先）；不传则用内部 bus 维护的 signals */
  getSafety?: () => SafetyState;
  /** 可注入定时器（vitest 假时钟） */
  scheduler?: Scheduler;
  tickMs?: number;
  /** 自动保存间隔（默认 120000，≤120s） */
  autoIntervalMs?: number;
  /** 可注入存储 backend（测试用内存实现） */
  backend?: SaveBackend;
  /** window 注入（测试用普通对象） */
  host?: Record<string, unknown>;
  /** HUD 容器（默认 globalThis.document） */
  doc?: Document | null;
  /** 提示注入（测试 spy）；默认 DOM 墨点/红标实现 */
  notify?: Notifier;
  /** 是否自动挂 pagehide/beforeunload（默认 true） */
  attachUnload?: boolean;
  manualSlots?: readonly string[];
  autoSlots?: readonly string[];
}

export interface SaveSystem {
  requestSave(reason: SaveReason, slot?: string): Promise<SaveResult>;
  listSlots(): Promise<SaveSlotMeta[]>;
  loadSlot(key: string): Promise<{ ok: boolean; reason?: string }>;
  state(): SaveStateView;
  /** 手动推进一次检查（假时钟测试 / bus 信号变化后即刻写） */
  tick(): void;
  signals(): SafetyState;
  updateSignal(partial: Partial<SafetyState>): void;
  retry(): Promise<SaveResult>;
  dispose(): void;
}

function defaultScheduler(): Scheduler {
  return {
    setInterval: (cb, ms) => setInterval(cb, ms) as unknown,
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
}

/** 默认 HUD 提示：成功→角落墨点 1.2s 淡出；失败→常驻红标 + 原因 + 重试（禁止静默）。 */
function createDomNotifier(doc?: Document | null): Notifier {
  const d = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!d || !d.body) return () => { /* Node 无 DOM：提示降级为 no-op，失败仍由 lastError/readLastSaveError 留存 */ };
  let failEl: HTMLElement | null = null;
  const clearFail = (): void => {
    if (failEl && failEl.parentNode) failEl.parentNode.removeChild(failEl);
    failEl = null;
  };
  return (p) => {
    if (p.kind === 'ok') {
      clearFail();
      const dot = d.createElement('div');
      dot.textContent = '● 已保存';
      dot.setAttribute('data-save-toast', 'ok');
      dot.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;padding:6px 12px;'
        + 'border-radius:14px;background:rgba(20,28,40,.82);color:#cfe8ff;font:12px/1.4 system-ui,sans-serif;'
        + 'opacity:1;transition:opacity 1.2s ease;pointer-events:none;';
      d.body.appendChild(dot);
      // 墨点 1.2s 淡出后移除
      setTimeout(() => { dot.style.opacity = '0'; }, 30);
      setTimeout(() => { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 1250);
    } else {
      clearFail();
      const box = d.createElement('div');
      box.setAttribute('data-save-toast', 'fail');
      box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;gap:10px;align-items:center;'
        + 'padding:8px 12px;border-radius:8px;background:rgba(90,16,16,.94);color:#ffd9d9;'
        + 'font:12px/1.4 system-ui,sans-serif;border:1px solid #d33;';
      const txt = d.createElement('span');
      txt.textContent = `存档失败：${p.reason ?? '未知原因'}（可重试）`;
      box.appendChild(txt);
      const btn = d.createElement('button');
      btn.textContent = '重试';
      btn.style.cssText = 'cursor:pointer;background:#d33;color:#fff;border:0;border-radius:4px;padding:3px 10px;';
      btn.onclick = () => p.retry?.();
      box.appendChild(btn);
      d.body.appendChild(box);
      failEl = box;   // 常驻，直到下次成功或手动 dispose
    }
  };
}

/** 退出兜底：同步写 localStorage 三键（沿用 interact.save 的键）+ ≤2KB 轻量摘要。 */
function writeExitFallback(host: Record<string, unknown>, snapshot: unknown, slot: string): void {
  try {
    const ls = (host as unknown as { localStorage?: Storage }).localStorage
      ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return;
    const econ = (snapshot as { economy?: { coins?: number; yinde?: number; peach?: number } } | null)?.economy;
    if (econ) {
      if (typeof econ.coins === 'number') ls.setItem('cq_coins', String(econ.coins));
      if (typeof econ.yinde === 'number') ls.setItem('cq_yinde', String(econ.yinde));
      if (typeof econ.peach === 'number') ls.setItem('cq_peach', String(econ.peach));
    }
    const digest = JSON.stringify({ at: Date.now(), slot, reason: 'exit', schemaVersion: SCHEMA_VERSION });
    ls.setItem('cq_save_digest', digest.slice(0, 2048));
  } catch { /* 退出期尽力而为，失败不阻断 */ }
}

function attachUnloadHandlers(host: Record<string, unknown>, onExit: () => void): () => void {
  const h = host as unknown as {
    addEventListener?: (t: string, fn: () => void) => void;
    removeEventListener?: (t: string, fn: () => void) => void;
  };
  if (typeof h.addEventListener !== 'function') return () => {};
  const fn = (): void => onExit();
  h.addEventListener('pagehide', fn);
  h.addEventListener('beforeunload', fn);
  return () => {
    if (typeof h.removeEventListener === 'function') {
      h.removeEventListener('pagehide', fn);
      h.removeEventListener('beforeunload', fn);
    }
  };
}

// ---- 工厂 ----

let active: SaveSystem | null = null;
export function getActiveSaveSystem(): SaveSystem | null { return active; }

export function initSaveSystem(opts: InitSaveOptions): SaveSystem {
  const now = opts.now ?? (() => Date.now());
  const host = (opts.host ?? (globalThis as unknown as Record<string, unknown>));
  const bus = opts.bus;
  const autoSlots = opts.autoSlots ?? AUTO_SLOTS;
  const manualSlots = opts.manualSlots ?? MANUAL_SLOTS;
  const autoIntervalMs = opts.autoIntervalMs ?? AUTO_INTERVAL_MS;
  const notify = opts.notify ?? createDomNotifier(opts.doc);

  let signals = defaultSafetyState();
  let pending = false;
  let saving = false;
  let lastAutoMs = now();          // 启动即视为「刚保存过」，首次自动写落在 120s 后
  let autoTurn = 0;
  let manualTurn = 0;
  let failCount = 0;
  let lastError: string | undefined;
  let lastResult: SaveResult | undefined;
  let disposed = false;
  const slotsView: string[] = [...autoSlots, ...manualSlots];

  const getBackend = async (): Promise<SaveBackend> => (opts.backend ? opts.backend : getSaveBackend());
  const getSafety = (): SafetyState => (opts.getSafety ? opts.getSafety() : signals);

  const doWrite = async (reason: SaveReason, slot?: string): Promise<SaveResult> => {
    if (saving) return lastResult ?? { slot: '', bytes: 0, ms: 0, ok: false };
    saving = true;
    host['__saving'] = true;                    // SAV-001 R6：写档期间 window.__saving === true
    const t0 = now();
    let key = slot ?? '';
    try {
      const snap = opts.getSnapshot();
      key = slot ?? (reason === 'manual'
        ? manualSlots[manualTurn++ % manualSlots.length]
        : pickAutoSlot(autoTurn++));          // 自动/检查点/退出：只写 a0/a1/a2，永不覆盖 m 槽（R5）
      if (reason === 'exit') writeExitFallback(host, snap, key);   // R3：同步兜底先行
      const b = await getBackend();
      const r = await b.write(key, snap, reason);
      const res: SaveResult = { slot: r.slot, bytes: r.bytes, ms: r.ms || (now() - t0), ok: r.ok };
      lastResult = res;
      if (r.ok) {
        lastAutoMs = now();
        pending = false;
        failCount = 0;
        lastError = undefined;
        notify({ kind: 'ok', slot: r.slot, bytes: r.bytes, ms: res.ms });
        bus?.emit('save:ok', { slot: r.slot, bytes: r.bytes, ms: res.ms, reason });
      } else {
        lastError = r.reason ?? 'write-failed';
        failCount++;
        if (reason === 'auto' || reason === 'checkpoint') pending = true;   // 失败保留待写，下个安全点重试
        notify({ kind: 'fail', reason: lastError, slot: r.slot, retry: () => { void doWrite(reason, key); } });
        bus?.emit('save:fail', { slot: r.slot, error: lastError, reason });
      }
      return res;
    } catch (err) {
      const txt = String(err);
      lastError = txt;
      failCount++;
      if (reason === 'auto' || reason === 'checkpoint') pending = true;
      notify({ kind: 'fail', reason: txt, slot: key, retry: () => { void doWrite(reason, key); } });
      lastResult = { slot: key, bytes: 0, ms: now() - t0, ok: false };
      return lastResult;
    } finally {
      saving = false;
      host['__saving'] = false;
    }
  };

  /** 安全点一旦满足，待写队列即刻落盘（不等下一次定时器 tick）。 */
  const maybeFlushPending = (): void => {
    if (disposed || saving || !pending) return;
    if (isSafePoint(getSafety(), now())) void doWrite('auto');
  };

  const requestSave = async (reason: SaveReason, slot?: string): Promise<SaveResult> => {
    if (disposed) return { slot: '', bytes: 0, ms: 0, ok: false };
    if (reason === 'auto' || reason === 'checkpoint') {
      // R1：不满足安全点 → 只排队，禁止强写（防半状态入档）
      if (!isSafePoint(getSafety(), now())) {
        pending = true;
        bus?.emit('save:queued', { reason });
        return { slot: '', bytes: 0, ms: 0, ok: false };
      }
    }
    // manual / exit：玩家主动或退出尽力写，不受安全点排队限制
    return doWrite(reason, slot);
  };

  const tick = (): void => {
    if (disposed || saving) return;
    const n = now();
    const safe = isSafePoint(getSafety(), n);
    if (pending && safe) { void doWrite('auto'); return; }          // 满足即刻写
    if (n - lastAutoMs >= autoIntervalMs) {                          // 间隔 ≤120s
      if (safe) void doWrite('auto');
      else pending = true;                                           // 到点但非安全点 → 排队不强写
    }
  };

  const listSlots = async (): Promise<SaveSlotMeta[]> => {
    const b = await getBackend();
    return (await b.list()).map(toSlotMeta);
  };

  const loadSlot = async (key: string): Promise<{ ok: boolean; reason?: string }> => {
    const b = await getBackend();
    const r = await b.read(key);
    if (!r.ok) return { ok: false, reason: r.reason };
    try {
      opts.applySnapshot(r.data);
      bus?.emit('save:loaded', { key });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  };

  const state = (): SaveStateView => ({
    lastAutoMs,
    pending,
    slots: [...slotsView],
    saving,
    failCount,
    lastError,
  });

  // ---- bus 信号接线（事件名在报告接线清单给主代理）----
  const unsubs: Array<() => void> = [];
  const on = (evt: string, fn: (p?: unknown) => void): void => {
    if (!bus) return;
    const r = bus.on(evt, fn);
    if (typeof r === 'function') unsubs.push(r);
  };
  on('combat:hit', () => { signals = { ...signals, lastCombatHitMs: now() }; maybeFlushPending(); });
  on('dialog:state', (p) => { signals = { ...signals, dialogState: String(p ?? 'idle') }; maybeFlushPending(); });
  on('build:preview', (p) => { signals = { ...signals, buildPreview: p ?? null }; maybeFlushPending(); });
  on('scene:switch', (p) => { signals = { ...signals, switching: p === true }; maybeFlushPending(); });
  on('save:wanted', (p) => { signals = { ...signals, wanted: Number(p ?? 0) }; maybeFlushPending(); });
  on('save:checkpoint', () => { void requestSave('checkpoint'); });

  // ---- 定时器（可注入 scheduler，便于 vitest 假时钟）----
  const scheduler = opts.scheduler ?? defaultScheduler();
  const timer = scheduler.setInterval(() => tick(), opts.tickMs ?? DEFAULT_TICK_MS);

  // ---- window 桥（SAV-001 R6）----
  host['__save'] = () => requestSave('manual')
    .then((r) => ({ slot: r.slot, bytes: r.bytes, ms: r.ms, ok: r.ok }));
  host['__saveState'] = () => state();
  host['__saving'] = false;

  // ---- 退出层（R3）：挂在主代理指定或自动检测的 window 上 ----
  const detachUnload = opts.attachUnload === false
    ? () => {}
    : attachUnloadHandlers(host, () => { void requestSave('exit'); });

  const system: SaveSystem = {
    requestSave,
    listSlots,
    loadSlot,
    state,
    tick,
    signals: () => ({ ...signals }),
    updateSignal: (partial) => { signals = { ...signals, ...partial }; maybeFlushPending(); },
    retry: () => doWrite('manual', lastResult && lastResult.slot ? lastResult.slot : undefined),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scheduler.clearInterval(timer);
      detachUnload();
      for (const u of unsubs) u();
      delete host['__save'];
      delete host['__saveState'];
      delete host['__saving'];
      if (active === system) active = null;
    },
  };
  active = system;
  return system;
}

// ---- 顶层委托函数（SAV-001 接口与数据；未 init 时走存储层兜底）----

export async function requestSave(reason: SaveReason): Promise<SaveResult> {
  if (active) return active.requestSave(reason);
  const r = await rtRequestSave(reason);
  return { slot: r.slot, bytes: r.bytes, ms: r.ms, ok: r.ok };
}

export async function listSlots(): Promise<SaveSlotMeta[]> {
  if (active) return active.listSlots();
  const recs = await rtListSlots();
  return recs.map(toSlotMeta);
}

export async function loadSlot(key: string): Promise<{ ok: boolean; reason?: string }> {
  if (active) return active.loadSlot(key);
  const r = await rtLoadSlot(key);
  return { ok: r.ok, reason: r.reason as string | undefined };
}

// BadReason 仅作类型再导出，方便恢复层/测试引用同一套原因枚举
export type { BadReason };
