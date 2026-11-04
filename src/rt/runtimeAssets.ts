// ============================================================================
// runtimeAssets 注册表 + 建筑足迹索引（P0-9）· src/rt/runtimeAssets.ts
//
// 清单 v3 P0-9：「world.ts 新增 runtimeAssets 注册表 + 建筑足迹索引（载入期落盘）」；
// 验收：「100m 落点规则能判定『此处可放』」（P2-6 落点规则与 D5「不压既有建筑」的数据源）。
//
// 数据源（既有，零复制）：
//   - behaviors.snapshotWalkSurfaces()：全城建筑足迹矩形（含墙带与地板高度，载入期烘焙生成）
//   - inRiverFootprint（world 注入回调）：河道足迹（水面中央禁落）
// 判定口径（P2-6 v1）：不压建筑足迹、不落河面中央、地面可站立（三与或非）。
// ============================================================================

const RA_CELL = 16;
const raKey = (ix: number, iz: number): number => (ix + 8192) * 65536 + (iz + 8192);

export interface FootprintRect {
  x0: number; x1: number; z0: number; z1: number;
  y: number;          // 该足迹的地面/台面高
  wall: boolean;      // true = 墙带（实心不可落）；false = 可站地板/台面
  src: string;        // 归属（诊断：'ws' / 'manual'）
}

export interface PlaceCtx {
  /** 玩家/造物占地半径（默认 2m） */
  r?: number;
  /** 河道足迹判定回调（world 注入 inRiverFootprint）；不注入则跳过水面判定 */
  inRiver?: (x: number, z: number, pad: number) => boolean;
  /** 地面查询回调（GroundLayers.groundAt / walkSurfaceY）；不注入则跳过悬空判定 */
  groundAt?: (x: number, z: number, refY: number) => number | null;
}

export interface PlaceVerdict { ok: boolean; reason: string }

export class RuntimeAssets {
  private cells = new Map<number, FootprintRect[]>();
  private count = 0;

  /** 登记一条建筑足迹（载入期由 world 从 snapshotWalkSurfaces 批量喂入） */
  ingest(x0: number, x1: number, z0: number, z1: number, y: number, wall: boolean, src = 'ws'): void {
    const rect: FootprintRect = { x0, x1, z0, z1, y, wall, src };
    const i0 = Math.floor(x0 / RA_CELL), i1 = Math.floor(x1 / RA_CELL);
    const j0 = Math.floor(z0 / RA_CELL), j1 = Math.floor(z1 / RA_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = raKey(i, j);
        let bucket = this.cells.get(k);
        if (!bucket) { bucket = []; this.cells.set(k, bucket); }
        bucket.push(rect);
      }
    }
    this.count++;
  }

  /** 建筑足迹条数（诊断） */
  get size(): number { return this.count; }

  /** 查询点邻近足迹（3×3 cell 邻域；跨 cell 大矩形按引用去重——同一足迹只回调一次） */
  nearby(x: number, z: number, fn: (r: FootprintRect) => void): void {
    const i = Math.floor(x / RA_CELL), j = Math.floor(z / RA_CELL);
    const seen = new Set<FootprintRect>();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const bucket = this.cells.get(raKey(i + di, j + dj));
        if (!bucket) continue;
        for (const r of bucket) {
          if (seen.has(r)) continue;
          seen.add(r);
          fn(r);
        }
      }
    }
  }

  /**
   * 「此处可放」判定（P2-6 落点规则 v1 数据源就绪版）：
   *   ① 不压建筑足迹：查询圆与任一 footprint 矩形 XZ 重叠 → false（墙带与地板都算已占用——
   *      地板重叠=穿进建筑内部，墙带重叠=嵌墙）
   *   ② 不落水面中央：inRiver 回调命中 → false（岸/纤道由 pad 语义豁免）
   *   ③ 地面可站立：groundAt 回调非 null → 有面；null（墙带内/无面）→ false
   * 三条全过才 ok。reason 给出第一条失败原因（供 UI/日志）。
   */
  canPlace(x: number, z: number, ctx: PlaceCtx = {}): PlaceVerdict {
    const r = ctx.r ?? 2;
    let hit = false;
    this.nearby(x, z, (rect) => {
      if (hit) return;
      const dx = Math.max(0, Math.max(rect.x0 - x, x - rect.x1));
      const dz = Math.max(0, Math.max(rect.z0 - z, z - rect.z1));
      if (dx * dx + dz * dz <= r * r) hit = true;  // 圆与矩形相交（相切即碰撞，保守占位）
    });
    if (hit) return { ok: false, reason: 'overlaps-building-footprint' };
    if (ctx.inRiver && ctx.inRiver(x, z, 0)) return { ok: false, reason: 'in-river' };
    if (ctx.groundAt) {
      const g = ctx.groundAt(x, z, 0);
      if (g === null) return { ok: false, reason: 'no-walkable-surface' };
    }
    return { ok: true, reason: 'placeable' };
  }
}
