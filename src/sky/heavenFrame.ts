/**
 * 天宫层的唯一几何基准（缩放 + 抬升）。
 *
 * 旧口径：天宫几何以「缩放前的世界坐标」烘焙（台面 y≈196–215），加载后由
 * `expansion.scaleHeavenGeometry` 绕 HEAVEN_BASE_Y 等比放大 2.2×。本版把整层再抬
 * HEAVEN_LIFT，让云海顶面落在 2131、天宫台面落在 ~2150 —— 只改高度，不改尺寸。
 *
 * 为什么单开一份：palace.ts 的室内点光、world.ts 的氛围阈值、演员/POI/名场面的落位
 * 都要用同一组数；此前 palace.ts 已经手抄过一遍 2.2/196（改一处必漂移）。
 */
export const HEAVEN_SCALE = 2.2;
/** 放大基准面（旧天宫云海顶面） */
export const HEAVEN_BASE_Y = 196;
/** 天庭层下界：汴京地面构件最高 <150m，y>150 只含天庭 */
export const HEAVEN_Y_MIN = 150;
/** 整层抬升量：旧天宫台面 ~215m → 2150m（云海顶面 196+1935=2131）。 */
export const HEAVEN_LIFT = 1935;
/** 抬升后的放大基准面（原 196）——即云海顶面的世界 y。 */
export const HEAVEN_BASE_LIFTED = HEAVEN_BASE_Y + HEAVEN_LIFT;

/** 缩放前的天宫 y → 世界 y（含抬升）。与 scaleHeavenGeometry 的顶点变换逐字一致。 */
export function heavenY(y: number): number {
  return HEAVEN_BASE_LIFTED + (y - HEAVEN_BASE_Y) * HEAVEN_SCALE;
}

/** 缩放前的天宫点 → 世界点（含抬升）。 */
export function heavenPoint(x: number, y: number, z: number): [number, number, number] {
  return [x * HEAVEN_SCALE, heavenY(y), z * HEAVEN_SCALE];
}

// ============ 凌霄殿二次放大（唯一真相源） ============
// 这两组常量原来各写一份：
//   · `palace.ts` 用它换算室内点光（LX_A / LINGXIAO_K / LX_YMIN）
//   · `expansion.ts` 用它放大凌霄殿几何（LINGXIAO_ANCHOR / LINGXIAO_SCALE / LINGXIAO_Y_MIN）
// 2026-11-03 实测两者**阈值不一致**：palace 用 233、expansion 用 230（换算到同一口径）。
// 差 3m 的选区 ⇒ 落在 [230,233) 的构件「几何被放大、灯没被放大」，最多错位 2.7273×3 ≈ 8m。
// 现在统一到本文件，两处都从这里 import。
export const LINGXIAO_SCALE = 2.7273;
/** 放大锚点（**pre-lift**，即已 ×HEAVEN_SCALE 之后、尚未 +HEAVEN_LIFT 的口径） */
export const LINGXIAO_ANCHOR_PRESCALE = { x: 0, y: 233, z: 209 } as const;
export const LINGXIAO_HALF_X = 60;
export const LINGXIAO_HALF_Z = 62;
/** 选区下界（**pre-lift** 口径）。原 palace 用 233、expansion 用 230，本文件取 230 并统一。 */
export const LINGXIAO_Y_MIN_PRESCALE = 230;
