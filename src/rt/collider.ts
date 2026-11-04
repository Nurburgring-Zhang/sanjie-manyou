// ============================================================================
// collider registry + broadphase（P0-3）· src/rt/collider.ts
//
// H2 spike 定案（docs/重建-v2/全量工作清单.md「H2 结论」）：均匀网格哈希 + 增量更新，
// cell 8m，数字打包 key；幽灵格必须可对账（高速跨多格移动后旧桶清干净）。
// 与实体表（src/rt/entity.ts）的接口（spec §6）：allocate 时挂 collider 组件，
// dispose 时用 onDispose 摘除——本文件提供 attachEntity 完成挂/摘闭环。
//
// 验收语义（清单 v3 P0-3）：「生成物的 collider 声明能挡住玩家」——blocked() 给出
// 玩家圆（x,z,r）是否与任一 collider 相交；推出解算属 P0-2 统一地面。
// ============================================================================

import { dispose, get } from './entity';

// ---- 形状定义（ADR-8.3 四值：capsule/box/sphere/mesh） ----

export interface ColliderShape {
  kind: 'capsule' | 'box' | 'sphere' | 'mesh';
  params: unknown;
}

export interface BoxParams { hx: number; hz: number }                 // XZ 轴对齐半尺寸（旋转盒属 P2 造物期）
export interface SphereParams { r: number }                            // XZ 圆
export interface CapsuleParams { r: number }                           // 竖直圆柱的 XZ 圆（身高维度 P0-2 处理）

/** 玩家/实体的 XZ 圆 vs 形状，是否相交（挡住判定） */
function hits(shape: ColliderShape, px: number, pz: number, pr: number, cx: number, cz: number): boolean {
  switch (shape.kind) {
    case 'box': {
      const b = shape.params as BoxParams;
      const dx = Math.max(0, Math.abs(px - cx) - b.hx);
      const dz = Math.max(0, Math.abs(pz - cz) - b.hz);
      return dx * dx + dz * dz < pr * pr;             // 圆到 AABB 最近距离 < 玩家半径
    }
    case 'sphere':
    case 'capsule': {                                  // capsule 的 XZ 判定与 sphere 同（竖直圆柱）
      const s = shape.params as SphereParams;
      const dx = px - cx, dz = pz - cz;
      const rr = pr + s.r;
      return dx * dx + dz * dz < rr * rr;
    }
    case 'mesh':
      return false;                                    // mesh 精判属 P2 造物期（先不挡，诚实降级）
  }
}

// ---- 均匀网格哈希（H2 定案口径） ----

const CELL = 8;
const OFF = 1 << 15;                                    // 坐标 ±262km 内为正；打包 key 唯一
const keyOf = (ix: number, iz: number): number => (ix + OFF) * 65536 + (iz + OFF);
const cellOf = (v: number): number => Math.floor(v / CELL);

export class ColliderGrid {
  private cells = new Map<number, Set<number>>();
  /** id → 当前桶 key（换格与幽灵对账的依据） */
  private home = new Map<number, number>();
  /** id → 位置引用（{x,y,z} 结构兼容 Vector3；引用同步与实体表同规） */
  private posOf = new Map<number, { x: number; y: number; z: number }>();
  /** pointQuery 去重集（实例自有，避免嵌套查询互踩） */
  private seen = new Set<number>();

  private keyFor(x: number, z: number): number { return keyOf(cellOf(x), cellOf(z)); }

  insert(id: number, pos: { x: number; y: number; z: number }): void {
    const k = this.keyFor(pos.x, pos.z);
    let bucket = this.cells.get(k);
    if (!bucket) { bucket = new Set(); this.cells.set(k, bucket); }
    bucket.add(id);
    this.home.set(id, k);
    this.posOf.set(id, pos);
  }

  /** 每帧换格：位置变了才搬桶（增量；Set.delete/add 均 O(1)，同 H2 的 swap-remove 语义） */
  update(id: number): void {
    const pos = this.posOf.get(id);
    if (!pos) return;
    const k = this.keyFor(pos.x, pos.z);
    const old = this.home.get(id);
    if (old === k) return;
    if (old !== undefined) {
      const bucket = this.cells.get(old);
      if (bucket) { bucket.delete(id); if (bucket.size === 0) this.cells.delete(old); }
    }
    let bucket = this.cells.get(k);
    if (!bucket) { bucket = new Set(); this.cells.set(k, bucket); }
    bucket.add(id);
    this.home.set(id, k);
  }

  remove(id: number): void {
    const old = this.home.get(id);
    if (old !== undefined) {
      const bucket = this.cells.get(old);
      if (bucket) { bucket.delete(id); if (bucket.size === 0) this.cells.delete(old); }
      this.home.delete(id);
    }
    this.posOf.delete(id);
  }

  /** 半径 r 的查询：遍历覆盖到的桶，逐候选回调（不建临时数组）。同 id 只回调一次。 */
  pointQuery(x: number, z: number, r: number, fn: (id: number) => void): void {
    const i0 = cellOf(x - r), i1 = cellOf(x + r);
    const j0 = cellOf(z - r), j1 = cellOf(z + r);
    const seen = this.seen;
    seen.clear();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const bucket = this.cells.get(keyOf(i, j));
        if (!bucket) continue;
        for (const id of bucket) {
          if (seen.has(id)) continue;
          seen.add(id);
          fn(id);
        }
      }
    }
  }

  /**
   * 幽灵格对账（H2 修订③）：对每个登记 id 重算应有桶 vs home 记录，不一致即幽灵。
   * 返回幽灵 id 列表并就地修正（调用方可断言 length === 0）。
   */
  reconcile(): number[] {
    const ghosts: number[] = [];
    for (const [id, pos] of this.posOf) {
      const want = this.keyFor(pos.x, pos.z);
      const home = this.home.get(id);
      if (home !== want) {
        ghosts.push(id);
        if (home !== undefined) {
          const bucket = this.cells.get(home);
          if (bucket) { bucket.delete(id); if (bucket.size === 0) this.cells.delete(home); }
        }
        let bucket = this.cells.get(want);
        if (!bucket) { bucket = new Set(); this.cells.set(want, bucket); }
        bucket.add(id);
        this.home.set(id, want);
      }
    }
    // 反向：桶里有但 posOf 没有的（remove 漏网的真幽灵）
    for (const [k, bucket] of this.cells) {
      for (const id of bucket) {
        if (!this.posOf.has(id)) { ghosts.push(id); bucket.delete(id); }
      }
      if (bucket.size === 0) this.cells.delete(k);
    }
    return ghosts;
  }

  get size(): number { return this.posOf.size; }
}

// ---- registry：形状 + 与实体表的挂/摘闭环 ----

export class ColliderRegistry {
  readonly grid = new ColliderGrid();
  private shapes = new Map<number, ColliderShape>();

  /**
   * 与实体表挂接（spec §6）：登记 collider 组件 + 入格 + onDispose 摘除闭环。
   * 实体不存在时返回 false。posRef 必须传权威位置引用（Vector3 结构兼容）。
   */
  attachEntity(entityId: number, shape: ColliderShape, posRef: { x: number; y: number; z: number }): boolean {
    const rec = get(entityId);
    if (!rec) return false;
    rec.collider = shape;
    this.shapes.set(entityId, shape);
    this.grid.insert(entityId, posRef);
    rec.onDispose.push(() => {
      this.shapes.delete(entityId);
      this.grid.remove(entityId);
    });
    return true;
  }

  /** 每帧换格驱动：对所有登记实体按其权威位置更新桶（P0-2 接管后由帧循环调用） */
  updateAll(): void {
    for (const id of this.shapes.keys()) this.grid.update(id);
  }

  /**
   * 「挡住玩家」判定（P0-3 验收语义）：玩家圆 (x,z,r) 是否与任一 collider 相交。
   * 网格候选 → 形状精判，两级。mesh 形状当前不挡（诚实降级，见 hits）。
   */
  blocked(x: number, z: number, r: number): boolean {
    let hit = false;
    this.grid.pointQuery(x, z, r + 16 /* box 最大半尺上界，粗筛宁多不少 */, (id) => {
      if (hit) return;
      const shape = this.shapes.get(id);
      if (!shape) return;
      const rec = get(id);
      if (!rec) return;
      if (hits(shape, x, z, r, rec.pos.x, rec.pos.z)) hit = true;
    });
    return hit;
  }

  /** 幽灵对账透传（P0-3 验收断言用：每 100 帧跑一次，length 必须 === 0） */
  reconcile(): number[] { return this.grid.reconcile(); }

  get count(): number { return this.shapes.size; }
}
