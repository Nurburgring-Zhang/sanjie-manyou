/**
 * 汴河河道几何真源（零 THREE / 零 DOM 依赖）。
 *
 * 这里只放「河在哪、多宽、水面多高」三个纯函数 + 两个常数。
 * `city/river.ts` 负责水面网格与船队，`city/imperial.ts` 的里坊守备判定、
 * `city/layout.ts` 的路网、`actors/crowd.ts` 的撒点都从这里取同一份几何——
 * 谁也不再复制 HALF_IN / 31 / 21 这类常数。
 *
 * 为什么要单拆一个文件：`imperial.ts` 在初始化时被调用几十万次（逐宅守备判定），
 * 而 `river.ts` 顶层持有船队/波纹等运行时对象。把纯函数下沉到这里，
 * 既避免 imperial → river 的模块耦合，也让「河道足迹」只有一个定义。
 */

/** 河带两端：水面铺到 ±5012（城墙外皮 5007.3 再出 4.7m，停在 `waterLink.ts` 水关台体外口） */
export const RIVER_END = 5012;
/** 水面标高：全河段恒定。码头/驳岸/渡口/船全部按 1.0 建模 */
export const RIVER_WATER_Y = 1.0;

/** 城里段半宽 31（62m）、城外段半宽 21（42m） */
const HALF_IN = 31;
const HALF_OUT = 21;
const TAPER_A = 900;      // 收窄起点
const TAPER_B = 1600;     // 收窄终点

const smooth01 = (t: number): number => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
};

/** 河面半宽（米）：62m 主城段 → 42m 城外段；两端不再收窄，收口交给石拱涵洞 */
export function riverHalfWidth(x: number): number {
  const a = Math.abs(x);
  return HALF_IN + (HALF_OUT - HALF_IN) * smooth01((a - TAPER_A) / (TAPER_B - TAPER_A));
}

/**
 * 河心 z 偏移：|x|<620 严格居中（与 props.ts 的城里石砌驳岸 z=±30.6 对齐），
 * 620–2600 之间一个正弦鼓包（峰值 3.2m，东西反向成 S），2600 以外归零 —— 涵洞口在轴线上。
 */
export function riverCenterZ(x: number): number {
  const a = Math.abs(x);
  if (a <= 620 || a >= 2600) return 0;
  const s = Math.sin((Math.PI * (a - 620)) / 1980);
  return Math.sign(x) * 3.2 * s * s;
}

/** 水面标高（函数形式留给探针/桥墩取用，全河段恒为 1.0） */
export function riverSurfaceY(): number {
  return RIVER_WATER_Y;
}

/**
 * 河道足迹判定：|z − 河心| < 半宽 + pad（米）。
 * pad = 0 是水线本身；建筑/人群让位取 8–12（含驳岸与纤道），路网取 0.5。
 */
export function inRiverFootprint(x: number, z: number, pad = 0): boolean {
  const hw = riverHalfWidth(x);
  return Math.abs(z - riverCenterZ(x)) < hw + pad;
}
