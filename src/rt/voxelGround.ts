// ============================================================================
// 体素地面桥（P0-2 语义的最小切片）· src/rt/voxelGround.ts
//
// player.groundHeight 的体素柱顶查询入口——独立小模块避免 player→voxelStore 大面积耦合。
// ============================================================================
import { voxelStore } from './voxelStore';

export function voxelColumnTop(x: number, z: number, refY: number): number | null {
  return voxelStore.columnTop(x, z, refY);
}
