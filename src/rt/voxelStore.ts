// ============================================================================
// 体素沙盒数据层（P1-2 最小可玩闭环 · D3 卷落地第一块）· src/rt/voxelStore.ts
//
// 纯数据模块（零 three 依赖，可 Node 单测、可被 player/存档直接查询）。
// 「营造司」：城南偏东荒地的一座 48×48 石台（体素区），玩家可堆叠/拆除方块。
//
// 存储约定：体素 1m；格坐标 = floor(世界坐标 − ORIGIN)，∈ [0, N)；t=0 空气。
// 序列化 = 全量非空格（正确性优先；几千条量级，chunk 级增量留 P1-2 后续）。
// ============================================================================

export const VOX = {
  ox: 2776, oy: 0, oz: -824,   // 区域原点（世界坐标）
  nx: 48, ny: 24, nz: 48,      // 尺寸（格）
};

export interface VoxRect { x0: number; z0: number; x1: number; z1: number; }

/** 点是否在体素区水平范围内 */
export function inArea(x: number, z: number): boolean {
  return x >= VOX.ox && x < VOX.ox + VOX.nx && z >= VOX.oz && z < VOX.oz + VOX.nz;
}

const idx = (x: number, y: number, z: number): number => (y * VOX.nz + z) * VOX.nx + x;

export const BLOCK_NAMES = ['营造土', '青石', '松木', '城砖', '琉璃', '鎏金', '碧玉', '玄墨'];
export const BLOCK_COLORS = [0x8a6a42, 0x8d8d95, 0x7a5230, 0xa8503c, 0x4fa8a0, 0xd4af37, 0x7ec8a0, 0x2a2a35];
export const BLOCK_COUNT = BLOCK_NAMES.length;   // 8 种，hotbar 1-8 选

export class VoxelStore {
  private data = new Uint8Array(VOX.nx * VOX.ny * VOX.nz);

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < VOX.nx && y >= 0 && y < VOX.ny && z >= 0 && z < VOX.nz;
  }

  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.data[idx(x, y, z)] : 0;
  }

  set(x: number, y: number, z: number, t: number): void {
    if (this.inBounds(x, y, z) && t >= 0 && t <= BLOCK_COUNT) this.data[idx(x, y, z)] = t;
  }

  /** 铺一层（整层填充；y=0 基座用） */
  fillLayer(y: number, t: number): void {
    for (let z = 0; z < VOX.nz; z++) for (let x = 0; x < VOX.nx; x++) this.data[idx(x, y, z)] = t;
  }

  /**
   * 柱顶查询（玩家站立）：该 (x,z) 柱中 ≤ refY + 1.2（一格跳跃可达）的最高 solid 顶面（格底 y → 顶 y+1）。
   * 返回世界坐标高度；柱内无合格面返回 null。
   */
  columnTop(x: number, z: number, refY: number): number | null {
    if (!inArea(x, z)) return null;
    const gx = Math.floor(x - VOX.ox), gz = Math.floor(z - VOX.oz);
    const limit = refY + 1.2 - VOX.oy;                 // 顶面合格上限（一格跳跃可达语义）
    for (let y = Math.min(VOX.ny - 1, Math.floor(limit)); y >= 0; y--) {
      if (this.data[idx(gx, y, gz)] > 0) {
        if (y + 1 <= limit) return VOX.oy + y + 1;     // 合格（顶面 ≤ 步高上限）
        // 超步高：继续向下扫——更低矮的合格面（如基座/纤道）依然可站（walkSurfaceY 同款多层语义）
      }
    }
    return null;
  }

  /** 全量非空格序列化（[gx, gy, gz, t] 扁平数组；正确性优先） */
  serialize(): number[] {
    const out: number[] = [];
    for (let y = 0; y < VOX.ny; y++)
      for (let z = 0; z < VOX.nz; z++)
        for (let x = 0; x < VOX.nx; x++) {
          const t = this.data[idx(x, y, z)];
          if (t > 0) out.push(x, y, z, t);
        }
    return out;
  }

  /** 全量重建应用（先清空；读档/重置共用） */
  deserialize(flat: number[]): void {
    this.data.fill(0);
    for (let i = 0; i + 3 < flat.length; i += 4) {
      this.set(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
    }
  }

  get nonEmpty(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > 0) n++;
    return n;
  }
}

/** 全局单例：玩家站立查询（player.groundHeight）与建造交互（buildMode）共用同一份 */
export const voxelStore = new VoxelStore();

/** 营造司基座：y=0 铺满青石（顶面 1.0，玩家跳 1.34m 可上）；调用一次 */
export function ensureWorkshopBase(store: VoxelStore): void {
  store.fillLayer(0, 2);
}
