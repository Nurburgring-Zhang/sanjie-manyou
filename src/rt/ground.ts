// ============================================================================
// 统一地面查询层（P0-2 + P0-7）· src/rt/ground.ts
//
// H2 定案落地：新增 block/creation 层的顶面查询**必须走网格 pointQuery**
// （4,400 次/帧时 forEach 线性扫直接吃满整帧——见清单「H2 结论」）。
//
// 设计（三步迁移纪律下的零行为变化切片）：
//   - 既有地面判定（player.groundHeight 的分层、behaviors.walkSurfaceY 的哈希）不复制不接管，
//     作为 **provider** 注入本层组合；
//   - 新增 block/creation 层：attachGroundBox 登记顶面（走 ColliderGrid），groundAt 里
//     用 pointQuery 取「够得着的最高顶面」（语义照 walkSurfaceY 的 fromY+STEP_UP 口径）；
//   - **本文件不接线 player/behaviors**——接线是行为变化，须 P0-2 收口探针护航后独立切片。
// ============================================================================

import { ColliderGrid } from './collider';
import { dispose, get } from './entity';

/** 地面 provider：返回该 (x,z,refY) 的地面高度；null = 此层不覆盖该点 */
export type GroundProvider = (x: number, z: number, refY: number) => number | null;

export class GroundLayers {
  readonly grid = new ColliderGrid();
  /** entityId → 顶面 y（block/creation 的可站立面） */
  private tops = new Map<number, number>();
  /** entityId → XZ 半覆盖（顶面判定：|x-cx|≤hx && |z-cz|≤hz；约定 ≤8m 保证所在 cell 覆盖查询点） */
  private half = new Map<number, { hx: number; hz: number }>();
  private providers: GroundProvider[] = [];

  /** 注入既有地面判定（player.groundHeight 语义 / walkSurfaceY 语义各一个） */
  registerProvider(fn: GroundProvider): void { this.providers.push(fn); }

  /**
   * 登记一块「可站立的方块/造物顶面」：collider（XZ 阻挡用）+ 顶面（站立用）一起挂，
   * 并挂进实体 onDispose 摘除闭环（spec §6）。实体不存在返回 false。
   * 约定：hx/hz ≤ 8（保证实体所在 cell 覆盖其覆盖范围内的任何查询点；更大请拆件）。
   */
  attachGroundBox(entityId: number, posRef: { x: number; y: number; z: number }, hx: number, hz: number, topY: number): boolean {
    const rec = get(entityId);
    if (!rec) return false;
    rec.collider = { kind: 'box', params: { hx, hz } };
    this.tops.set(entityId, topY);
    this.half.set(entityId, { hx, hz });
    this.grid.insert(entityId, posRef);
    rec.onDispose.push(() => {
      this.tops.delete(entityId);
      this.half.delete(entityId);
      this.grid.remove(entityId);
    });
    return true;
  }

  /** 每帧换格驱动（P0-2 接管后由帧循环调用；引用位置语义）——遍历本层登记的顶面实体逐 id 换格 */
  moveAll(): void {
    for (const id of this.tops.keys()) this.grid.update(id);
  }

  /**
   * 统一地面查询：collider 顶面层（网格 pointQuery）与 providers 取最大者。
   * stepUp 照 walkSurfaceY 口径（够得着的最高面），默认 0.95。
   * 返回 null = 该点无任何地面层覆盖（当前 provider 链下不应发生——街面 0 恒在）。
   */
  groundAt(x: number, z: number, refY: number, stepUp = 0.95): number | null {
    let best: number | null = null;
    // ① block/creation 顶面层：网格 3×3 邻域点查（半径=CELL：覆盖区内查询点与实体中心
    //    可能分属相邻 cell——单 cell 查询会漏检，A1 式教训）；XZ 精判
    this.grid.pointQuery(x, z, 8, (id) => {
      const top = this.tops.get(id);
      const half = this.half.get(id);
      if (top === undefined || !half) return;
      const pos = this.posRefOf(id);
      if (!pos) return;
      if (Math.abs(x - pos.x) > half.hx || Math.abs(z - pos.z) > half.hz) return;
      if (top <= refY + stepUp && (best === null || top > best)) best = top;
    });
    // ② providers（既有分层判定）
    for (const fn of this.providers) {
      const v = fn(x, z, refY);
      if (v !== null && (best === null || v > best)) best = v;
    }
    return best;
  }

  private posRefOf(id: number): { x: number; y: number; z: number } | undefined {
    const rec = get(id);
    return rec ? rec.pos : undefined;
  }

  /** 移除（测试/注销用；运行时注销走 onDispose 闭环） */
  detach(entityId: number): void {
    this.tops.delete(entityId);
    this.half.delete(entityId);
    this.grid.remove(entityId);
  }
}

/** 供探针/诊断读实体表存活（避免直接 import entity 的调用方蔓延） */
export function entityAlive(id: number): boolean { return get(id) !== undefined; }

// dispose 的重导出：接线方（world）从本模块一次性拿「地面层 + 注销」两个语义
export { dispose };
