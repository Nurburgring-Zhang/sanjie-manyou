/**
 * PERF-001 R1：world.ts 的 bake 任务 → 界域归属唯一真源。
 *
 * 这份表只用于「几何归因」与「R3 懒烘焙的可省量核算」，**不参与执行顺序**：
 * tasks 的执行序必须是固定串，因为多个 builder 共用一支 `rng = new RNG(20260905)`，
 * 换序会改变 rng 消耗顺序 → 世界逐值漂移（INV-01 明令禁止）。
 *
 * 归类口径（按构件实际写入 Baker 的空间位置）：
 *  - human     : |y| ≤ 150 的人界（山河 / 城郭 / 皇城 / 营造司）
 *  - heaven    : y > 150 的天宫层（放大前坐标），含神佛 / 仙植 / 云海宫阙
 *  - underworld: UNDER.y 附近的幽冥层
 *  - shared    : 跨三界或纯数据任务（灯光 / POI / 演员 / 合批 / 交互）
 *
 * `云海·仙植鬼植` 同时建鬼植（地府）与仙植（天宫），`三界生态·草木禽鱼`
 * 同时铺三界草木，故归 shared —— 把它们硬塞进某一界会虚报该界可省量。
 */
import type { BakeRealm } from '../city/bake';

export const TASK_REALM: Readonly<Record<string, BakeRealm>> = Object.freeze({
  '开天辟地': 'shared',
  '山河·地形': 'human',
  '山河·旷野': 'human',
  '山河·四方': 'human',
  '筑城·街巷基层': 'human',
  '筑城·街屋群': 'human',
  '筑城·街屋内饰': 'human',
  '筑城·樊楼相国寺': 'human',
  '筑城·虹桥人流': 'human',
  '皇城·宫城': 'human',
  '皇城·里坊民居': 'human',
  '皇城·街巷铺装': 'human',
  '筑城·水关收口': 'human',
  '筑城·水系支脉': 'human',
  '装点市井': 'human',
  '云起天宫': 'heaven',
  '仙界装点': 'heaven',
  '云海·宫阙群': 'heaven',
  '云海·三殿内饰': 'heaven',
  '云海·瑶池水榭': 'heaven',
  '云海·仙植鬼植': 'shared',
  '三界生态·草木禽鱼': 'shared',
  '云海·天府附院': 'heaven',
  '幽冥开辟': 'underworld',
  '幽冥·丰都街': 'underworld',
  '幽冥·阎罗殿': 'underworld',
  '幽冥·孟婆庄': 'underworld',
  '三界演员贴地校正': 'shared',
  '营造司·体素台': 'human',
  '幽冥·奈何桥': 'underworld',
  '幽冥·三生石': 'underworld',
  '幽冥·望乡台': 'underworld',
  '合拢万象': 'shared',
  '众生入场': 'shared',
  '豪杰登台': 'shared',
  '神佛就位': 'heaven',
  '化身与交互': 'shared',
  '名牌图鉴': 'shared',
});

/** 未知任务一律 shared：宁可少算可省量，也不把未知几何冒充成可延迟的界域。 */
export function realmOfTask(stage: string): BakeRealm {
  return TASK_REALM[stage] ?? 'shared';
}

/** 按界域汇总逐任务几何台账（探针/核算共用，避免在两处各写一份聚合口径）。 */
export function summarizeByRealm(
  rows: ReadonlyArray<{ stage: string; realm: BakeRealm; vertices: number; triangles: number; bytes: number }>,
): Record<BakeRealm, { tasks: number; vertices: number; triangles: number; bytes: number }> {
  const out: Record<BakeRealm, { tasks: number; vertices: number; triangles: number; bytes: number }> = {
    human: { tasks: 0, vertices: 0, triangles: 0, bytes: 0 },
    heaven: { tasks: 0, vertices: 0, triangles: 0, bytes: 0 },
    underworld: { tasks: 0, vertices: 0, triangles: 0, bytes: 0 },
    shared: { tasks: 0, vertices: 0, triangles: 0, bytes: 0 },
  };
  for (const r of rows) {
    const cell = out[r.realm] ?? out.shared;
    cell.tasks += 1;
    cell.vertices += r.vertices;
    cell.triangles += r.triangles;
    cell.bytes += r.bytes;
  }
  return out;
}
