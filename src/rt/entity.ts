// ============================================================================
// 实体表（Entity Registry）· P0-1 步 1（建表 + 登记，谁都不读）
//
// spec：docs/重建-v2/spec/P0-1-实体表.md（模块级函数 API、单例表）
// H1 spike：GO（三套结构共用一套 id，16/16 断言，_spike/h1-entity-registry.mjs）
// H7 增补：A-move/A-leak 断言（P0-6 裁定：setBounds 单事务刷组包围盒+剔除体）
//
// 铁律（spec §2）：
//   id 单调递增、永不复用——复用会让旧存档引用指到新对象（存档毒药）；
//   pos 是权威位置（object3d.position 只是投影；天宫必须经 heavenY 后写入）；
//   onDispose 逆序调用（后注册的先拆，LOD 注册晚于 mesh 创建不会拆在半空）。
//
// 步 1 纪律：只建表、只登记、谁都不读——零行为变化；回滚 = 删两处登记调用。
// ============================================================================

export type EntityId = number;
/** 0 恒为无效 id（存档/回放里的空引用） */
export const NONE_ENTITY: EntityId = 0;

export type EntityKind =
  | 'npc' | 'beast' | 'creation'   // P0-3 需要碰撞
  | 'block' | 'building'           // P2/P1 需要
  | 'prop' | 'fx';                 // 只渲染

export interface EntityRecord {
  id: EntityId;
  kind: EntityKind;
  /** 渲染根：注销时从这里 remove；null 表示纯逻辑实体（crowd 实例化渲染就是 null） */
  object3d: { id: number } | null;
  /** 权威位置。Actor.pos(Vector3) 结构兼容直接传引用；快照类（beast 分量字段）步 2 改引用同步 */
  pos: { x: number; y: number; z: number };
  collider?: { kind: 'capsule' | 'box' | 'sphere' | 'mesh'; params: unknown };
  behavior?: { kind: 'static' | 'patrol' | 'follow' | 'fly' | 'swim'; params: unknown };
  /** P0-4 用：false 的不入档 */
  persist: boolean;
  /** ADR-3：生成式实体必须带来源，可重放 */
  provenance?: { seed: number; moduleHash: string; apiVersion: string };
  /** 注销回调；按注册逆序调用；可从回调内重入 dispose */
  onDispose: Array<() => void>;
  alive: boolean;
}

const KINDS = new Set(['npc', 'beast', 'creation', 'block', 'building', 'prop', 'fx']);

// ---- 单例表（spec API 为模块函数；不建通用 ECS，只要 id + 生命周期 + 组件槽） ----
const byId = new Map<EntityId, EntityRecord>();
const indexByKind = new Map<EntityKind, Set<EntityId>>();
let idSeq: EntityId = NONE_ENTITY;      // 0 被保留，首个分配从 1
let allocatedTotal = 0;
let disposedTotal = 0;
let lastDisposeReason: string | null = null;

export function allocate(kind: EntityKind, init: Partial<Omit<EntityRecord, 'id' | 'kind' | 'alive'>> = {}): EntityId {
  // kind 非法由联合类型编译期拦；运行时兜底（js 调用方/探针动态 import 场景）
  if (!KINDS.has(kind)) return NONE_ENTITY;
  const id = ++idSeq;
  const rec: EntityRecord = {
    id,
    kind,
    object3d: init.object3d ?? null,
    pos: init.pos ?? { x: 0, y: 0, z: 0 },
    collider: init.collider,
    behavior: init.behavior,
    persist: init.persist ?? false,
    provenance: init.provenance,
    onDispose: init.onDispose ?? [],
    alive: true,
  };
  byId.set(id, rec);
  let bucket = indexByKind.get(kind);
  if (!bucket) { bucket = new Set(); indexByKind.set(kind, bucket); }
  bucket.add(id);
  allocatedTotal++;
  return id;
}

export function get(id: EntityId): EntityRecord | undefined {
  if (!id || id === NONE_ENTITY) return undefined;
  const rec = byId.get(id);
  return rec && rec.alive ? rec : undefined;
}

export function alive(id: EntityId): boolean {
  return get(id) !== undefined;
}

/**
 * 逻辑注销：置 alive=false、移出索引、按逆序跑 onDispose。
 * 幂等（已注销返回 false 不报错）；回调内重入安全（先摘除自身再跑回调）。
 * disposeReason 可选，进 entityStats 诊断。
 */
export function dispose(id: EntityId, reason?: string): boolean {
  if (!id || id === NONE_ENTITY) return false;
  const rec = byId.get(id);
  if (!rec || !rec.alive) return false;
  rec.alive = false;
  const bucket = indexByKind.get(rec.kind);
  if (bucket) bucket.delete(id);
  disposedTotal++;
  if (reason) lastDisposeReason = reason;
  // 逆序执行；回调内重入 dispose(self) 时 alive 已 false → 幂等返回，不会死循环
  const cbs = rec.onDispose;
  rec.onDispose = [];
  for (let i = cbs.length - 1; i >= 0; i--) cbs[i]();
  return true;
}

/** 按 kind 遍历（不含已 dispose 的）。for 循环直跑回调，不建临时数组（spec §7 GC 风险）。 */
export function forEach(kind: EntityKind, fn: (e: EntityRecord) => void): void {
  const bucket = indexByKind.get(kind);
  if (!bucket) return;
  for (const id of bucket) {
    const rec = byId.get(id);
    if (rec && rec.alive) fn(rec);
  }
}

export function entityStats(): {
  alive: number; allocated: number; disposed: number;
  byKind: Record<string, number>; lastDisposeReason: string | null; idSeq: number;
} {
  let aliveN = 0;
  const byKind: Record<string, number> = {};
  for (const rec of byId.values()) {
    if (!rec.alive) continue;
    aliveN++;
    byKind[rec.kind] = (byKind[rec.kind] ?? 0) + 1;
  }
  return { alive: aliveN, allocated: allocatedTotal, disposed: disposedTotal, byKind, lastDisposeReason, idSeq };
}

/** 测试/重置专用：清空整表（生产路径禁止调用；spec 无此 API，标注 TEST-ONLY） */
export function __resetForTest(): void {
  byId.clear();
  indexByKind.clear();
  idSeq = NONE_ENTITY;
  allocatedTotal = 0;
  disposedTotal = 0;
  lastDisposeReason = null;
}
