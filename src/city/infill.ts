import * as THREE from 'three';
import { RNG } from '../core/rng';
import { noReflect } from '../core/layers';
import { Baker, BGroup, createCityTextures, shade } from './bake';
import { conifer } from './props';
import { roadBlocked } from './imperial';

// ============ 里坊密集民居填充：实例化数万栋连片院落，构成真实都城密度 ============
export interface WardCell { cx: number; cz: number; half: number }

// ============ 运行时 LOD：按中心距离注册 InstancedMesh ============
// 四档：近 <120m / 中 120–400m / 远 400–1200m / 极远 >1200m。阈值、滞回与兜底全在 core/engine.ts 的 LodManager，
// 本文件只负责「把可换档的实例化几何连中心一起交出去」，不持有任何显示策略。
export type LodTierName = 'near' | 'mid' | 'far' | 'impostor';

/**
 * 一个 LOD 组 = 一块可整组换档的实例化几何（本文件按「空间单元」划分：里坊 1200m 格 / 御街坊 600m 格）。
 * 四档**不是四份几何**：tiers 是同一批 InstancedMesh 的可见子集——换档只改 visible，几何与实例数据零复制。
 * 组的外沿包围盒参与距离判定：相机在盒内时到组距离为 0（否则站在坊里仍按坊心距离算，近档永远命中不了）。
 */
export interface LodGroupSpec {
  id: string;
  cx: number; cy: number; cz: number;
  /** 半跨（m）。到组距离 = 到该盒外沿的 3D 距离 */
  hx: number; hy: number; hz: number;
  /** 各档可见网格；空数组 = 本组没有这一档的可绘制资源（由 LodManager 的兜底规则处理） */
  tiers: Record<LodTierName, THREE.Object3D[]>;
  /** 极远档剪影卡尺寸（宽 × 高，m）；null = 不出剪影卡 */
  card: { w: number; h: number } | null;
}

export interface LodSink { register(group: LodGroupSpec): void }

let lodSink: LodSink | null = null;
/** sink 挂上之前注册的组先入队，挂上后按注册顺序回放——WardInfill 早于 Engine 就不可能丢组 */
const lodPending: LodGroupSpec[] = [];

export function setLodSink(sink: LodSink | null): void {
  lodSink = sink;
  if (!sink) return;
  for (const g of lodPending) sink.register(g);
  lodPending.length = 0;
}

/** 按中心距离注册一组 InstancedMesh（本文件的 LOD 接线接口） */
export function registerInstancedLod(group: LodGroupSpec): void {
  if (lodSink) lodSink.register(group);
  else lodPending.push(group);
}

// 分级基准 = 精细城区外缘（buildGround / pavement 只铺到 ±660）到坊心的距离。
// 实测：19 机位里最近的一坊也在 2.0–2.9km，13m 柱距只剩 3–5px、雾透过率 0.14–0.41，
// 地面视角读不出单栋；只有贴着城边（自由飞行）才看得清。故按「这个距离上还能读出什么」分四档：
//   0 完整院落 ≤1200  正房两坡（86 面：举折 + 实体正脊 + 封头 + 檐口）+ 墙色山墙 + 两厢 / 厦子 + 倒座
//                     + 院门 + 院墙；沿巷 18–25% 敞门脸商铺；每坊 15–23 棵
//   1 简院    ≤2400  临巷两段留 2.4m 门洞 + 正房 + 一个两坡顶（42 面，同一套形制降采样），每坊 12–18 棵
//   2 简院 + 矮院墙 ≤3600  同 1，屋顶降到 8 面简顶（两坡 + 脊带），院墙切 12–28m 段落；不出树
//   3 体块 + 巷道暗带 >3600  丢院墙 / 厢房，屋顶 12 面远档单元（两坡 + 抬高的脊带 + 暗檐口）
// 预算账（w9TriEstimate 口径，2026-11 屋顶重做后实测）：
//   全城 infill 三角面 10,589,198；屋顶重做前 8,971,780（+18.0%）。增量落点：
//   正房 24,294×(86-66)=+0.49M、山墙 24,294×16=+0.39M、厢房/简院 57,068×(42-38)=+0.23M、
//   tier2 简顶 58,908×8=+0.47M、厦子 3,126×10=+0.03M。草顶 1,855 从瓦顶改出（88 vs 86，可忽略）。
const CORE_HALF = 660;
const PITCH = 13;
const LOD_NEAR = 1200;
const LOD_MID = 2400;
const LOD_FAR = 3600;
/** 档位边界抖动半幅（m）：按坊心 hash 抖 ±LOD_BAND，避免三圈同心圆上整圈同时跳变 */
const LOD_BAND = 140;

/** 运行时 LOD 的空间单元边长（m）：桶 =（构建档, 单元），一个桶就是一个 LodManager 组。
 *  单元越小近档越贴人，draw call 也越多。
 *  W26：单元整体放大一倍（1200→2400、600→1200），并把五类全城小件从分桶里摘出来（见 build 内注释）。
 *  实测（1280×720、开场运镜）：boot 机位 calls 658→552，45 秒全程峰值 561；
 *  场景 InstancedMesh 1186→516，门窗实例 382,335 件逐件不变。 */
const LOD_CELL = 2400;
const LOD_CELL_COURT = 1200;
const lodCellKey = (cx: number, cz: number, size: number): string =>
  `${Math.floor(cx / size)}_${Math.floor(cz / size)}`;

// 墙体色按「受光后」定档：旧值 0xd6cbaa（线性 0.66）× 贴图 0.85 × 3.2 总光照 = 1.8，
// 被裁到纯白——屋顶因此显得更黑，整座城是"白盒子 + 黑板"的强反差。
// 压到 0.20 线性一带，受光落在 0.55–0.65，墙面才留得住斑驳与砖缝。
const BODY_COLORS = [0x807a66, 0x796e57, 0x726855, 0x7c7663, 0x6e6552, 0x7f7869, 0x787162, 0x7d735f];
// 瓦色按 SPEC §8 收敛成三档深瓦（0x333a45 / 0x3f4752 / 0x272d36）：
// 旧版八色里 0x4a5361/0x475160 在 2km 外被雾一压就泛白，屋面读成一片浅灰板
// 瓦色：黄昏太阳仰角低，屋面 N·L≈0.3，0x333a45（线性 0.039）乘上去只剩 0.01，
// 屋顶直接塌成纯黑剪影。抬到 0.10 线性一带，受光 0.05–0.13，才读得出"深灰瓦"而不是黑洞。
// 屋顶色板 8 档（青灰 / 深灰 / 褐灰 / 板瓦褐 / 草顶 / 苇席 / 冷灰 / 暖灰）。
// 关键不在档数，在「按坊分片」：同一坊内共用一档，坊与坊之间才拉得开，整座城不再是一片同色海。
const ROOF_COLORS = [
  0x5c6878, // 青灰瓦（官式偏冷）
  0x4e5a68, // 深灰瓦
  0x6a6156, // 褐灰瓦
  0x7a6248, // 板瓦褐（民居多）
  0x8a7a4e, // 草顶（黄褐）
  0x9a8a62, // 苇席
  0x596470, // 冷灰
  0x6f6656, // 暖灰
];
const ROOF_CAP = 0x525c69; // 正脊 / 瓦压顶玄端（同步抬档，否则脊线是纯黑细条）

// ---- 里坊街区尺度 ----
const GROUND_Y = -0.44; // 城内地表 terrainSurfaceY = -0.5，构件落在其上（留 6cm 入土，不再浮空 0.56m）
// W25：坊墙不再是一圈 3.2m 夯土城墙。用户原话「不要一个个大围墙给分割成一块块的」——
// 改成**断续院墙**：段长 12–28m、段间缺口 6–14m、每边两端各让 3–7m 给坊间巷道，
// 厚 0.62m / 高 2.55m（墙皮量级，不再读成城墙）。坊门整组删除，改 1.8–2.6m 院门。
const WARD_T = 0.62;    // 院墙厚
const WARD_H = 2.55;    // 院墙高（夯土）
const WARD_SEG: [number, number] = [12, 28];   // 院墙段落长
const WARD_GAP: [number, number] = [6, 14];    // 段间缺口（朝巷道）
const WARD_END: [number, number] = [3, 7];     // 每边两端让给坊间巷道的缺口
const WARD_DOOR: [number, number] = [1.8, 2.6]; // 院门净宽

// ============ 御街两厢补里坊（WS-18）：走廊 |x| 24–886 / |z| 470–2880 补 120 坊 ============
// 走廊原先只有中轴 ±17m 的御街与御廊，两侧各 860m 裸土。这里按 276×183–257m 坊格补里坊（南北 × 东西各 3 列）：
// 院墙 0.62m 厚 / 2.35m 高（earth 夯土 + roof 压顶，W25 起断续成段，不再围成一圈）、坊内抖动二分院落户；
// 横街 |z|=900/1700/2500 各留 14m 断口，
// |x| 20–24 留街沟散水，|x|<20 全空给御街与御廊。排布全确定性（hash 取值，不消耗 rng）。
const COURT_X0 = 24;
const COURT_X1 = 886;
const COURT_EDGE = 893;
const COURT_Z0 = 230;
const COURT_Z1 = 2880;
const COURT_STREET = 8;
const COURT_GAP = 7;
const COURT_EAVE = 0.16;
const COURT_BASE = 0.10;
const COURT_SOIL = -0.5;
const COURT_SEGMENTS: [number, number, number][] = [
  [COURT_Z0, 900 - COURT_GAP, 2],
  [900 + COURT_GAP, 1700 - COURT_GAP, 3],
  [1700 + COURT_GAP, 2500 - COURT_GAP, 3],
  [2500 + COURT_GAP, COURT_Z1, 2],
];

interface CourtWard { cx: number; cz: number; hx: number; hz: number; rows: number }

function h01(a: number, b: number, c: number): number {
  let t = (Math.imul(a + 1, 0x27d4eb2d) ^ Math.imul(b + 1, 0x165667b1) ^ Math.imul(c + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/**
 * 二维值噪声：格点 hash 取值 + smoothstep 双线性插值，返回 0..1。
 * 格距 46m 与 127m 两个倍频叠成低频场——相邻院落拿到的是「缓变但不同相位」的偏移，
 * 不是各抽各的随机数；纯随机抖动会让相邻院心仍围绕父切线排队，连续场才能把整排推离直线。
 * 全部由坐标 hash 求出，不消耗共享 rng，也不受遍历顺序影响。
 */
function lattice01(x: number, z: number, salt: number, cell: number): number {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
  const fx = x / cell - gx, fz = z / cell - gz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h01(gx, gz, salt), b = h01(gx + 1, gz, salt);
  const c = h01(gx, gz + 1, salt), d = h01(gx + 1, gz + 1, salt);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sz;
}

/** 低频扰动场：-1..1，主倍频权重 0.62 / 副倍频 0.38 */
function fieldN(x: number, z: number, salt: number): number {
  return 0.62 * (lattice01(x, z, salt, W9_FIELD_CELL[0]) * 2 - 1)
    + 0.38 * (lattice01(x, z, salt + 7, W9_FIELD_CELL[1]) * 2 - 1);
}

let _courtWards: CourtWard[] | null = null;
function courtWards(): CourtWard[] {
  if (_courtWards) return _courtWards;
  const ww = (COURT_X1 - COURT_X0 - 4 * COURT_STREET) / 3;
  const out: CourtWard[] = [];
  for (const sz of [-1, 1]) {
    for (const [z0, z1, n] of COURT_SEGMENTS) {
      const depth = (z1 - z0 - (n - 1) * COURT_STREET) / n;
      for (let i = 0; i < n; i++) {
        const a = z0 + i * (depth + COURT_STREET);
        for (const sx of [-1, 1]) for (let c = 0; c < 3; c++) {
          const x0 = COURT_X0 + COURT_STREET + c * (ww + COURT_STREET);
          out.push({
            cx: sx * (x0 + ww / 2), cz: sz * (a + depth / 2), hx: ww / 2, hz: depth / 2,
            rows: Math.min(8, Math.max(6, Math.round(depth / 37))),
          });
        }
      }
    }
  }
  _courtWards = out;
  return out;
}

/** 御街两厢某一坊的院落：与 fillCourt 同一套抖动二分规划，静态院墙据此逐段对齐 */
function courtYards(w: CourtWard, wi: number): W9Yard[] {
  const h = (k: number): number => h01(wi, 17, 15000 + k);
  const root = rectPoly(w.cx, w.cz, w.hx - 1.8, w.hz - 1.8);
  return planRegion(root, 0, h, () => false, true).yards;
}

// ============ 里坊街区（W9）：抖动二分地块 + 随地块生长的巷 + 随机院 ============
// SPEC §8 / 用户硬约束：百姓房子、道路、院落、小巷「严禁规整」，必须散落、歪七扭八、有大有小、
// 随机组合、密集分布。旧版是「坊墙 → 正交主巷/支巷 → 等距院落」，俯瞰是一张会画墨线的方格纸。
// 本版把整条生成链改成无网格的：
//   坊界 —— 四角各 ±18m 抖动，每边 3–5 个控制点轻微外凸（≤2.8m）/内凹（≤1.1m），院墙沿折线断续砌
//   地块 —— 抖动二分（BSP）：切线 = 父地块主轴 + 90° ±25°，再叠低频场 ±42°（相对父轴可偏 25°–155°，
//           不再只有两族正交切法）；切分比 0.30–0.70 + ±0.08 场偏移；递归到面积 < 260–420㎡
//           （每块现抽，10% 抽 22–64㎡）或地块深度 ≥5 层；结果是一组不规则四边形，没有一行一列
//   巷   —— 二分时的缝直接长成巷：56% 的边界留 2.2–4.5m 巷道（按切缝中点坐标 hash + 低频场取宽，
//           一条巷一个宽度），其余 0.4m 共墙；走向继承切线；15–25% 的巷一端砌土墙封死（断头巷）
//   院   —— 三档按地块中心坐标 hash 取（40:40:20）：小院正房 6–8m、中院 9.5–13.5m、大院 17–23m；
//           朝向 = 主轴 ±14° + 场 ±10°，位置沿长/短向漂移 ±3/±2m，同档尺寸再 ±10%；
//           厢房随档 0–1 / 1–2 / 2 间（与主屋 90°±20°），沿地块边 1–3 面院墙（0.9–2.2m 高，留院门缺口）；
//           空院（菜畦/柴堆/井）1–3%
// 随机性全部由坐标 hash（h01）与连续低频场 fieldN 承担，不消耗共享 rng（见 drainLegacyRng 的 rng 序列契约）。
interface House {
  x: number; z: number; w: number; d: number; h: number; yaw: number; bc: number; rc: number; tk?: number;
  /** 出檐上限（m）：= 本宅到地块边界的净距，出檐不许把屋面顶出地块，否则相邻两院屋面必相交 */
  eo?: number;
}
/** 轴对齐方盒实例：y 是**底面**（bodyGeo / eaveGeo / 锥体都按底面在 0 建） */
interface Seg { x: number; z: number; w: number; h: number; d: number; y: number; yaw: number; c: number }
/** 发光盒实例：y 是**中心**（winGeo 居中，缩放即可当窗或灯芯） */
interface Glow { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number; c: number }
/**
 * 墙面小件（棂窗 / 板门 / 踏跺石）：单位四边形实例，**几何只有 2 面**。
 * 窗框、棂条、窗台板、门板缝、门槛、门簪全部在片元着色器里按 kind 画（同 roofFluteHook 的路线）：
 * 全城 tier0 有 3.4 万樘门窗，一件 30 面就是 100 万面，几何做不起；一片 2 面可以做到 1:1 的密度。
 */
interface Furn {
  x: number; y: number; z: number;
  /** 竖直构件：w = 面阔方向宽、h = 高；水平构件（flat）：w = 横向宽、h = 朝外进深 */
  w: number; h: number;
  /** 竖直构件 = 外法线（水平单位向量）；水平构件 = 面内「朝外」方向 */
  nx: number; nz: number;
  /** 0 棂窗 / 1 板门 / 2 踏跺石 / 3 院门 */
  kind: number;
  seed: number;
  flat?: boolean;
}
interface Block { x: number; z: number; w: number; d: number; h: number; yaw: number; bc: number; rc: number }

// ============ 放置后干涉消解：构件台账 ============
// 户型放置各自独立算位置与随机 yaw，planRegion / layoutYard 只保证「四角在本户地块内」，
// 从不做跨院互检；院墙又沿地块边内压 0.2m，与贴边房屋必然互穿。这里在**实例化之前**统一收口：
// 每个 Bucket 收一张有占地体积的构件表，用 OBB + 空间哈希查相交，按优先级删低精度件。
// 只做减法：不新增任何面 / draw call，只多一次构建期 CPU 扫描。
type ObstKind = 'shop' | 'main' | 'wing' | 'shed' | 'simple' | 'block' | 'wall' | 'gate';
/** 数字越大越该留：临街店铺永不删；正房次之；tier3 远档体块最可删。 */
const OBST_PRIO: Record<ObstKind, number> = {
  shop: 5, main: 4, wing: 3, shed: 3, wall: 2, gate: 2, simple: 1, block: 0,
};
/** 建筑类（屋面/墙体）：同一户的建筑之间本该贴合；院墙/院门与建筑不豁免 */
const OBST_BUILDING: Record<ObstKind, boolean> = {
  shop: true, main: true, wing: true, shed: true, simple: true, wall: false, gate: false, block: true,
};
/** 2cm 皮肤：院墙与地界找平、两段墙共面这种「贴边」不算穿插，避免过度删件。 */
const OBST_SKIN = 0.02;
/** 诊断开关：?noOverlap=1 跳过台账与消解，用于 A/B 量出这整套特性的真实 CPU 成本 */
const OVERLAP_ON = typeof window === 'undefined' || !/[?&]noOverlap=1/.test(window.location.search);
/** 参与消解的实例数组；区间快照只在这些数组上取。 */
const OBST_KEYS = ['bodies', 'curved', 'gableWalls', 'thatch', 'gables', 'sheds', 'tents', 'blocks', 'walls', 'slabs', 'fabrics', 'glows', 'furn'] as const;
type ObstKey = (typeof OBST_KEYS)[number];
interface ObstSlice { key: ObstKey; from: number; to: number }
interface Obst {
  kind: ObstKind;
  x: number; z: number; w: number; d: number; yaw: number; y: number; h: number;
  prio: number; area: number;
  /** 预计算：cos/sin yaw 与 OBB 的轴对齐包围半跨（每个构件只算一次，避免逐对 trig） */
  cy: number; sy: number; ax: number; az: number;
  /** 同一户 / 同一坊的构件共享 owner：自家人贴合不算干涉 */
  owner: number;
  /** 该构件在实例桶里占的区间（快照差），删件时按区间打掩膜 */
  slices: ObstSlice[];
}

interface Bucket {
  tier: number;
  court: boolean;
  lift: number;
  /** 院落的墙身（正房 + 厢房），共用一个 BODY 材质 mesh */
  bodies: House[];
  /** 里坊正房瓦顶（两坡举折） */
  curved: House[];
  /** 正房两端的山墙（BODY 材质，墙色三角封头） */
  gableWalls: Seg[];
  /** 草顶/苇顶正房（更圆坡面，无瓦垄） */
  thatch: House[];
  /** 里坊厢房的两坡顶 */
  gables: Seg[];
  /** 单坡厦子 / 杂屋顶（坡向院内） */
  sheds: Seg[];
  /** tier2 简屋顶（两坡 + 脊带，8 面） */
  tents: Seg[];
  /** 里坊中/远档体块 */
  blocks: Block[];
  /** 院墙 / 灯柱 / 井台 / 巷道暗带：同一个 earth 材质，靠实例色区分 */
  walls: Seg[];
  /** 院墙压顶 / 门罩 / 腰檐：roof 组薄板 */
  slabs: Seg[];
  /** 树冠（球冠团簇，每株 1–5 团；y 是**球心**） */
  leaves: Seg[];
  /** 树干（锥台，底面锚点；trunk 材质） */
  trunks: Seg[];
  /** 商户幌子 / 瓦舍苇席棚顶：fabric 材质，靠实例色区分行业 */
  fabrics: Seg[];
  /** 窗 / 门灯 / 灯芯 */
  glows: Glow[];
  /** 门窗 / 踏跺石（2 面/件的贴面小件，图案在着色器里画） */
  furn: Furn[];
  /** 巷道地坪（专用材质：车辙 / 路心 / 石板缝在片元着色器里按实例尺度画） */
  roads: Seg[];
  /** 完整院落数（tier0） */
  yards: number;
  /** 简院数（tier1–2） */
  simpleYards: number;
  /** 干涉消解台账：有占地体积的构件（见 Obst） */
  obstacles: Obst[];
  /** 构件消失计数（`infill.drop.<kind>` / `infill.overlap.*`），用于验收与后续调参 */
  kits: Record<string, number>;
  /** 同桶内自增的归属号：每院 / 每坊 / 每远档体块一个，自家人贴合豁免用 */
  ownerSeq: number;
  kit(id: string, count?: number, y?: number): void;
}

function newBucket(tier: number, court: boolean, lift: number): Bucket {
  const b: Bucket = {
    tier, court, lift, bodies: [], curved: [], gableWalls: [], thatch: [], gables: [], sheds: [], tents: [], blocks: [], walls: [], slabs: [], leaves: [], trunks: [], fabrics: [], glows: [], furn: [], roads: [], yards: 0, simpleYards: 0,
    obstacles: [], kits: {}, ownerSeq: 0,
    // 第三个参数只为与 Baker.kit 的调用形态对齐（本路没有 y 台账），计数按 id 累加
    kit(id: string, count = 1): void { b.kits[id] = (b.kits[id] ?? 0) + count; },
  };
  return b;
}

/** 构件落位前的数组长度快照（与 OBST_KEYS 对齐） */
function obstSnap(b: Bucket): number[] {
  const out = new Array<number>(OBST_KEYS.length);
  for (let i = 0; i < OBST_KEYS.length; i++) out[i] = b[OBST_KEYS[i]].length;
  return out;
}

/** 把快照之后新增的实例登记成一个构件；slices 就是「删这件该回退哪些区间」 */
function obstRecord(b: Bucket, kind: ObstKind, x: number, z: number, w: number, d: number,
  yaw: number, y: number, h: number, owner: number, from: number[]): void {
  if (!OVERLAP_ON) return;
  const slices: ObstSlice[] = [];
  for (let i = 0; i < OBST_KEYS.length; i++) {
    const key = OBST_KEYS[i];
    const to = b[key].length;
    if (to > from[i]) slices.push({ key, from: from[i], to });
  }
  if (!slices.length) return;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const hw = w * 0.5, hd = d * 0.5;
  // OBB 的轴对齐包围半跨：|cos|·hw + |sin|·hd / |sin|·hw + |cos|·hd
  const ax = Math.abs(cy) * hw + Math.abs(sy) * hd;
  const az = Math.abs(sy) * hw + Math.abs(cy) * hd;
  b.obstacles.push({ kind, x, z, w, d, yaw, y, h, prio: OBST_PRIO[kind], area: w * d, cy, sy, ax, az, owner, slices });
}

/** 正房的屋面足迹：与 InstanceMesh 的 putRoof 同一份公式（悬山出挑 / 前后檐按净距收口） */
function roofFoot(w: number, d: number, eoIn: number): [number, number] {
  const eo = Math.min(ROOF_EAVE_OUT, Math.max(0, eoIn));
  const ex = Math.min(roofOverhangX(w), eo);
  return [w + 2 * ex, d + 2 * Math.max(0.04, eo)];
}

/**
 * OBB 分离轴测试（2D 平面足迹）。房子有 ±20° 随机 yaw，AABB 会把整排邻院的角都判成相交，
 * 所以必须用有向盒：4 条候选分离轴 = 各自的两条局部轴，任一轴投影不重叠即分离。
 * 投影半径 = hw·|e1·n| + hd·|e2·n|；局部轴 e1=(cos yaw, −sin yaw)、e2=(sin yaw, cos yaw)
 * 与 Three 的 rotY 及全文件的 `x+u·cos+v·sin, z−u·sin+v·cos` 约定一致。
 * cos/sin 已在 obstRecord 里按件算好，逐对只做乘加（全城 27 万件，逐对 trig 会吃掉秒级）。
 */
function obbHit(a: Obst, b: Obst): boolean {
  const ca = a.cy, sa = a.sy, cb = b.cy, sb = b.sy;
  const dx = b.x - a.x, dz = b.z - a.z;
  const ahw = Math.max(0, a.w * 0.5 - OBST_SKIN), ahd = Math.max(0, a.d * 0.5 - OBST_SKIN);
  const bhw = Math.max(0, b.w * 0.5 - OBST_SKIN), bhd = Math.max(0, b.d * 0.5 - OBST_SKIN);
  const axes = [ca, -sa, sa, ca, cb, -sb, sb, cb];
  for (let k = 0; k < 8; k += 2) {
    const ux = axes[k], uz = axes[k + 1];
    const ra = ahw * Math.abs(ux * ca - uz * sa) + ahd * Math.abs(ux * sa + uz * ca);
    const rb = bhw * Math.abs(ux * cb - uz * sb) + bhd * Math.abs(ux * sb + uz * cb);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

/** 粗筛：AABB 是 OBB 的保守外框，先排掉绝大多数候选，再做 4 轴 SAT */
function pairHit(a: Obst, b: Obst): boolean {
  if (Math.abs(b.x - a.x) > a.ax + b.ax) return false;
  if (Math.abs(b.z - a.z) > a.az + b.az) return false;
  return obbHit(a, b);
}

/**
 * 同一户内部的豁免只覆盖「本该贴合」的两类：
 *   · 建筑 ↔ 建筑（正房 / 厢房 / 厦子 / 山墙）—— 院落的正常搭接；
 *   · 院墙 ↔ 院门 —— 墙段与门洞本来就连在一起。
 * 院墙 ↔ 自己的房屋**不豁免**：墙沿地界内压 0.2m，贴边房屋就会被墙穿过去，
 * 这正是用户截图里的「院墙穿过房屋」；墙优先级 2，删墙保房。
 * shop 优先级最高，连自家院墙撞门脸也删墙。
 */
function sameHouseExempt(a: Obst, b: Obst): boolean {
  if (a.owner !== b.owner) return false;
  if (a.kind === 'shop' || b.kind === 'shop') return false;
  return OBST_BUILDING[a.kind] === OBST_BUILDING[b.kind];
}

/** 空间哈希键：坐标偏移后打包成整数，避免字符串键的分配与哈希开销 */
function gridKey(ix: number, iz: number): number {
  return (ix + 0x8000) * 0x10000 + (iz + 0x8000);
}

/**
 * 空间哈希格边长（m）。不用「桶内最大 max(w,d)」：2400m 桶里只要有一根 28m 院墙，
 * 格子就被撑到 28m，实测候选规模把消解拖到 15s。改 8m 细格 + 按 AABB 多格登记：
 * 两件相交 ⇒ 它们的 AABB 相交 ⇒ 至少共享一格；同一对用 stamp 去重，
 * 语义仍是「只和相邻格比较」，但候选数降一个数量级。
 */
const OBST_CELL = 8;

/** 把一个构件按 AABB 覆盖的所有格登记（大块跨多格，小块 1–4 格） */
function gridInsert(g: Map<number, number[]>, o: Obst, i: number, cs: number): void {
  const ix0 = Math.floor((o.x - o.ax) / cs), ix1 = Math.floor((o.x + o.ax) / cs);
  const iz0 = Math.floor((o.z - o.az) / cs), iz1 = Math.floor((o.z + o.az) / cs);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const k = gridKey(ix, iz);
      const a = g.get(k);
      if (a) a.push(i); else g.set(k, [i]);
    }
  }
}

function buildObstGrid(obs: Obst[], idx: number[], cs: number): Map<number, number[]> {
  const g = new Map<number, number[]>();
  for (const i of idx) gridInsert(g, obs[i], i, cs);
  return g;
}

/** 索引掩膜压缩：消解只打标记，最后每个数组扫一遍，避免 O(n²) splice */
function compactArr<T>(arr: T[], dead: Set<number>): void {
  if (!dead.size) return;
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    if (dead.has(r)) continue;
    arr[w++] = arr[r];
  }
  arr.length = w;
}

interface ObstStats {
  obstacles: number; kept: number;
  pre: number; post: number;
  preShopShop: number; postShopShop: number;
  /** 宽相位候选对数（3×3 邻域内、通过 owner 豁免后的对数）：性能证据 */
  cand: number;
  /** 改前 / 改后店铺数（shop 永不删，两者必须相等，验收硬判据） */
  shopsBefore: number; shops: number;
  shopParts: number; shopPartsAfter: number;
  shopPartsByKey: Record<string, number>;
  shopPartsByKeyAfter: Record<string, number>;
  drops: Record<string, number>;
  /** 改前 / 改后各类构件数（分母，判断删除比例是否合理） */
  kindBefore: Record<string, number>;
  kindAfter: Record<string, number>;
  /** 被删件 × 肇事件：例如 main→shop 表示正房因压到铺面而被删 */
  dropBy: Record<string, Record<string, number>>;
  ms: number;
  /** 分阶段耗时（ms）：宽相位 / 贪心 / 改后复算，用于定位性能瓶颈 */
  tPre: number; tGreedy: number; tPost: number;
}

/**
 * 一个桶的干涉消解。
 *   1) 普查（改前）：所有构件两两 OBB 相交；同一 owner 的「建筑↔建筑」「墙↔门」豁免（正常搭接），
 *      院墙↔自家房屋不豁免（墙沿地界内压，贴边房会被墙穿过）；
 *   2) 消解：按「优先级降序 → 占地降序 → 生成序」贪心保留；与已保留件相交者删除，
 *      于是「相交 → 删优先级低的」「同优先级 → 删占地小的」两条规则一次成立；
 *      shop 是唯一例外：任何情况下都保留（两间铺面互压时记为 shop-shop 豁免，交验收单列）；
 *   3) 复算（改后）：用保留集再跑一遍 OBB 普查，白盒自证 post 只剩 shop-shop。
 * 复杂度：O(n log n + n·k)，k 为 3×3 邻域平均候选数，全量 n 上万也不会退化到 O(n²)。
 */
function resolveObstacles(b: Bucket, full = false): ObstStats {
  const t0 = performance.now();
  const obs = b.obstacles;
  const drops: Record<string, number> = {};
  const stats: ObstStats = {
    obstacles: obs.length, kept: 0, pre: full ? 0 : -1, post: 0, preShopShop: 0, postShopShop: 0, cand: 0,
    shopsBefore: 0, shops: 0, shopParts: 0, shopPartsAfter: 0,
    shopPartsByKey: {}, shopPartsByKeyAfter: {}, drops, kindBefore: {}, kindAfter: {}, dropBy: {},
    ms: 0, tPre: 0, tGreedy: 0, tPost: 0,
  };
  // 改前店铺台账：按实例数组拆开记，验收时逐键比对，避免「总数对、某一类丢了」
  for (const o of obs) {
    stats.kindBefore[o.kind] = (stats.kindBefore[o.kind] ?? 0) + 1;
    if (o.kind !== 'shop') continue;
    stats.shopsBefore++;
    for (const s of o.slices) {
      const n = s.to - s.from;
      stats.shopParts += n;
      stats.shopPartsByKey[s.key] = (stats.shopPartsByKey[s.key] ?? 0) + n;
    }
  }
  if (obs.length < 2) {
    stats.kept = obs.length;
    stats.shops = stats.shopsBefore;
    stats.shopPartsAfter = stats.shopParts;
    stats.shopPartsByKeyAfter = { ...stats.shopPartsByKey };
    stats.kindAfter = { ...stats.kindBefore };
    stats.ms = performance.now() - t0;
    return stats;
  }

  const cs = OBST_CELL;
  const all = new Array<number>(obs.length);
  for (let i = 0; i < obs.length; i++) all[i] = i;
  // 同一对会在共享的多格里重复出现：用 stamp 数组按「当前 i」去重，避免 Set 分配
  const seen = new Int32Array(obs.length).fill(-1);
  let stamp = 0;

  // ---- 1) 改前普查（full=true 时；生产只跑贪心，省一次全量宽相位） ----
  if (full) {
    const tp = performance.now();
    const allGrid = buildObstGrid(obs, all, cs);
    for (let i = 0; i < obs.length; i++) {
      const a = obs[i];
      const ix0 = Math.floor((a.x - a.ax) / cs), ix1 = Math.floor((a.x + a.ax) / cs);
      const iz0 = Math.floor((a.z - a.az) / cs), iz1 = Math.floor((a.z + a.az) / cs);
      stamp++;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const cell = allGrid.get(gridKey(ix, iz));
          if (!cell) continue;
          for (const j of cell) {
            if (seen[j] === stamp) continue;
            seen[j] = stamp;
            if (j <= i) continue;
            const c = obs[j];
            if (sameHouseExempt(a, c)) continue;
            stats.cand++;
            if (!pairHit(a, c)) continue;
            stats.pre++;
            if (a.kind === 'shop' && c.kind === 'shop') stats.preShopShop++;
          }
        }
      }
    }
    stats.tPre = performance.now() - tp;
  }

  // ---- 2) 贪心消解 ----
  const tg = performance.now();
  const order = all.slice().sort((i, j) => {
    const p = obs[j].prio - obs[i].prio;
    if (p) return p;
    const ar = obs[j].area - obs[i].area;
    if (ar) return ar;
    return i - j;
  });
  const dead = new Uint8Array(obs.length);
  const kept: number[] = [];
  const keepGrid = new Map<number, number[]>();
  for (const i of order) {
    const a = obs[i];
    const ix0 = Math.floor((a.x - a.ax) / cs), ix1 = Math.floor((a.x + a.ax) / cs);
    const iz0 = Math.floor((a.z - a.az) / cs), iz1 = Math.floor((a.z + a.az) / cs);
    let hit = false, hitKind = '', shopHits = 0;
    stamp++;
    scan: for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const cell = keepGrid.get(gridKey(ix, iz));
        if (!cell) continue;
        for (const j of cell) {
          if (seen[j] === stamp) continue;
          seen[j] = stamp;
          const c = obs[j];
          if (sameHouseExempt(a, c)) continue;
          stats.cand++;
          if (!pairHit(a, c)) continue;
          if (a.kind === 'shop') shopHits++; // 铺面永不删：继续扫完，精确数 shop-shop 对数
          else { hit = true; hitKind = c.kind; break scan; }
        }
      }
    }
    if (hit && a.kind !== 'shop') {
      dead[i] = 1;
      drops[a.kind] = (drops[a.kind] ?? 0) + 1;
      const row = (stats.dropBy[a.kind] ??= {});
      row[hitKind] = (row[hitKind] ?? 0) + 1;
      continue;
    }
    // shop 永不删：记录它压住了几间已保留铺面
    if (a.kind === 'shop') stats.postShopShop += shopHits;
    kept.push(i);
    gridInsert(keepGrid, a, i, cs);
  }
  stats.kept = kept.length;
  for (const i of kept) {
    const k = obs[i].kind;
    stats.kindAfter[k] = (stats.kindAfter[k] ?? 0) + 1;
  }
  stats.tGreedy = performance.now() - tg;
  if (!full) {
    // 非 full 模式不做全量改后复算：贪心已保证非 shop 件不会留下相交。
    // shop 永不删，唯一可能是 shop-shop；贪心对铺面不 break，已逐对精确计数。
    stats.post = stats.postShopShop;
    stats.shops = stats.shopsBefore;
    stats.shopPartsAfter = stats.shopParts;
    stats.shopPartsByKeyAfter = { ...stats.shopPartsByKey };
  }

  // ---- 3) 按区间掩膜删件，每个数组只压缩一次 ----
  const marks = new Map<ObstKey, Set<number>>();
  for (let i = 0; i < obs.length; i++) {
    if (!dead[i]) continue;
    for (const s of obs[i].slices) {
      let set = marks.get(s.key);
      if (!set) { set = new Set<number>(); marks.set(s.key, set); }
      for (let k = s.from; k < s.to; k++) set.add(k);
    }
  }
  for (const [key, set] of marks) compactArr(b[key] as unknown[], set);

  // ---- 4) 改后复算 + 店铺台账（full=true 时；生产端贪心已保证非 shop 件无残留） ----
  if (full) {
    const tq = performance.now();
    stats.post = 0;
    stats.postShopShop = 0;
    stats.shops = 0;
    stats.shopPartsAfter = 0;
    stats.shopPartsByKeyAfter = {};
    const keptGrid = buildObstGrid(obs, kept, cs);
    for (const i of kept) {
      const a = obs[i];
      const ix0 = Math.floor((a.x - a.ax) / cs), ix1 = Math.floor((a.x + a.ax) / cs);
      const iz0 = Math.floor((a.z - a.az) / cs), iz1 = Math.floor((a.z + a.az) / cs);
      stamp++;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const cell = keptGrid.get(gridKey(ix, iz));
          if (!cell) continue;
          for (const j of cell) {
            if (seen[j] === stamp) continue;
            seen[j] = stamp;
            if (j <= i) continue;
            const c = obs[j];
            if (sameHouseExempt(a, c)) continue;
            stats.cand++;
            if (!pairHit(a, c)) continue;
            stats.post++;
            if (a.kind === 'shop' && c.kind === 'shop') stats.postShopShop++;
          }
        }
      }
      if (a.kind === 'shop') {
        stats.shops++;
        for (const s of a.slices) {
          const n = s.to - s.from;
          stats.shopPartsAfter += n;
          stats.shopPartsByKeyAfter[s.key] = (stats.shopPartsByKeyAfter[s.key] ?? 0) + n;
        }
      }
    }
    stats.tPost = performance.now() - tq;
  }
  stats.ms = performance.now() - t0;
  return stats;
}

/** 干涉消解的全局台账（每次构建覆写；探针与验收从 window.__infillDrop 读同一份） */
export interface InfillDropReport {
  buckets: number;
  obstacles: number;
  kept: number;
  /** 是否跑了改前普查（生产端为 false，pre = -1；探针 full 模式才有真值） */
  full: boolean;
  pre: number;
  post: number;
  preShopShop: number;
  postShopShop: number;
  /** 宽相位候选对数（性能证据） */
  candidates: number;
  shopsBefore: number;
  shops: number;
  shopParts: number;
  shopPartsAfter: number;
  shopPartsByKey: Record<string, number>;
  shopPartsByKeyAfter: Record<string, number>;
  drops: Record<string, number>;
  kindBefore: Record<string, number>;
  kindAfter: Record<string, number>;
  dropBy: Record<string, Record<string, number>>;
  kits: Record<string, number>;
  byTier: Record<string, { obstacles: number; pre: number; post: number; drops: Record<string, number>; shops: number }>;
  wards: { cx: number; cz: number; half: number; tier: number }[];
  shopSamples: { x: number; z: number; yaw: number }[];
  ms: number;
  /** 分阶段耗时（ms）：普查 / 贪心 / 改后复算 */
  msBreakdown: { pre: number; greedy: number; post: number };
}
let lastInfillReport: InfillDropReport | null = null;
export function infillDropReport(): InfillDropReport | null { return lastInfillReport; }

export interface OverlapProbeRow {
  key: string; tier: number; obstacles: number; kept: number;
  pre: number; post: number; preShopShop: number; postShopShop: number;
  shopsBefore: number; shops: number; shopParts: number; shopPartsAfter: number;
  shopPartsByKey: Record<string, number>; shopPartsByKeyAfter: Record<string, number>;
  drops: Record<string, number>; ms: number;
}
export interface OverlapProbeResult {
  rows: OverlapProbeRow[];
  total: {
    cells: number; buckets: number; obstacles: number; kept: number;
    pre: number; post: number; preShopShop: number; postShopShop: number;
    shopsBefore: number; shops: number; shopParts: number; shopPartsAfter: number;
    shopPartsByKey: Record<string, number>; shopPartsByKeyAfter: Record<string, number>;
    drops: Record<string, number>; ms: number;
  };
}

/**
 * 离线相交普查（不依赖 THREE / 场景）：与 WardInfill 走同一套 planWard → wardWall → emitFill → 消解。
 * 输出「改前 / 改后」相交对数、按 kind 的删除分布、店铺件数（必须前后相等），供 scripts/probe-house-overlap.mjs 调用。
 * 默认取 4 个 tier0 坊 + 4 个 tier1 坊；桶按 (tier, LOD_CELL) 合并，与生产分桶一致。
 */
export function w9OverlapProbe(cellList?: WardCell[]): OverlapProbeResult {
  const cells = cellList ?? [
    { cx: 1300, cz: 1300, half: 380 }, { cx: -1300, cz: 700, half: 350 },
    { cx: 1300, cz: -700, half: 350 }, { cx: -1300, cz: -1300, half: 380 },
    { cx: 2100, cz: 2100, half: 380 }, { cx: -2100, cz: 2100, half: 380 },
    { cx: 2900, cz: 1300, half: 380 }, { cx: -2900, cz: 1300, half: 380 },
  ];
  const buckets = new Map<string, { b: Bucket; tier: number }>();
  for (const c of cells) {
    const tier = wardLod(c.cx, c.cz);
    const key = `${tier}:${lodCellKey(c.cx, c.cz, LOD_CELL)}`;
    let ent = buckets.get(key);
    if (!ent) { ent = { b: newBucket(tier, false, GROUND_Y), tier }; buckets.set(key, ent); }
    fillWard(ent.b, c, () => false);
  }
  const rows: OverlapProbeRow[] = [];
  const total: OverlapProbeResult['total'] = {
    cells: cells.length, buckets: buckets.size, obstacles: 0, kept: 0,
    pre: 0, post: 0, preShopShop: 0, postShopShop: 0,
    shopsBefore: 0, shops: 0, shopParts: 0, shopPartsAfter: 0,
    shopPartsByKey: {}, shopPartsByKeyAfter: {}, drops: {}, ms: 0,
  };
  for (const [key, ent] of buckets) {
    // 探针跑 full：带改前普查 + 改后复算，给出独立的 pre/post
    const r = resolveObstacles(ent.b, true);
    rows.push({
      key, tier: ent.tier, obstacles: r.obstacles, kept: r.kept,
      pre: r.pre, post: r.post, preShopShop: r.preShopShop, postShopShop: r.postShopShop,
      shopsBefore: r.shopsBefore, shops: r.shops, shopParts: r.shopParts, shopPartsAfter: r.shopPartsAfter,
      shopPartsByKey: r.shopPartsByKey, shopPartsByKeyAfter: r.shopPartsByKeyAfter,
      drops: r.drops, ms: +r.ms.toFixed(2),
    });
    total.obstacles += r.obstacles;
    total.kept += r.kept;
    total.pre += r.pre;
    total.post += r.post;
    total.preShopShop += r.preShopShop;
    total.postShopShop += r.postShopShop;
    total.shopsBefore += r.shopsBefore;
    total.shops += r.shops;
    total.shopParts += r.shopParts;
    total.shopPartsAfter += r.shopPartsAfter;
    total.ms += r.ms;
    for (const [k, n] of Object.entries(r.shopPartsByKey)) total.shopPartsByKey[k] = (total.shopPartsByKey[k] ?? 0) + n;
    for (const [k, n] of Object.entries(r.shopPartsByKeyAfter)) total.shopPartsByKeyAfter[k] = (total.shopPartsByKeyAfter[k] ?? 0) + n;
    for (const [k, n] of Object.entries(r.drops)) total.drops[k] = (total.drops[k] ?? 0) + n;
  }
  total.ms = +total.ms.toFixed(2);
  return { rows, total };
}

// ============ 民居两坡屋顶：举折曲面 + 实体正脊 + 两端封头 + 檐口 ============
// 旧单元（mountainRoofUnit）是两块**直板**拼成人字：没有举折、没有正脊实体、没有山墙封头、
// 没有檐口厚度，坡面法线还被人为摆 ±12° 假造瓦垄。用户原话「平民的房屋，房顶全不正确」即此。
// 本版按宋《营造法式》民居形制重做，全部尺寸走单位空间（x=面阔/脊向，z=进深，y 0=檐口 1=脊顶），
// 世界尺寸全部由实例缩放给出：屋面高 = 进深×坡度、出檐 = 实例比墙体外扩的量。
// 瓦垄不进几何：6–23m 面阔要 18–68 列才能压到 0.34m 垄距，200 面装不下；改由世界坐标条纹
// 在着色器里按 ROOF_RIB_M 定距生成（见 roofFluteHook），几何只负责脊/坡/山墙/檐口。
type P3 = [number, number, number];
const sub3 = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = (a: P3): P3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

interface TwinRoof {
  /** 沿面阔的列数 */
  cols: number;
  /** 脊→檐的环段数（3 = 4 环，宋式举折的最低表达） */
  rings: number;
  /** 檐口坡度占比：剖面 y=(1-A)(1-t)²+A(1-t)。A=0.52 → 脊侧 46°、檐口 20°，
   *  两头都是**有限坡度**（旧式 (1-t)^1.35 在檐口导数为 0，"上陡下缓"最后读成一块平板） */
  eaveSlope: number;
  /** 角部起翘（单位 y） */
  corner: number;
  /** 正脊高 / 半宽（单位 y / 单位 z） */
  ridgeH: number;
  ridgeHalf: number;
  /** 草顶：脊是一捆苇把（圆脊）而不是方脊 */
  ridgeRoll?: boolean;
  /** 檐口板高（垂到 y=-fascia） */
  fascia: number;
  /** 两端三角封头（瓦色）；硬山由山墙本体封，悬山必须由屋顶自封 */
  endFace: boolean;
  /** 草顶：坡面外凸（檐口最陡）、苇秆厚檐 */
  thatch?: boolean;
  /** 两端封头的顶点色。近档正房有独立山墙盖住封头（0.74 当博风板），
   *  中档简院没有山墙实例 —— 直接把封头提亮成墙色量级，1.2km 外才读得出"这头是山墙" */
  endC?: number;
}

/**
 * 造一片民居两坡屋顶。单位空间：x∈[-0.5,0.5] 面阔 / z∈[-0.5,0.5] 进深 / y 0=檐口 1=脊顶。
 * 面数 = 坡面 4·cols·rings + 正脊 10 + 封头 4·rings + 檐口 4·cols。
 */
function twinRoofGeo(o: TwinRoof): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], uvs: number[] = [];
  // 常量 UV：旧版按单位空间乱铺瓦纹，224m 大殿与 6m 民居拿到的是同一张被拉花的图。
  // 瓦面明暗改由「顶点色（檐口压暗/脊提亮）+ 世界坐标瓦垄」承担，贴图只留一个中性乘子。
  const UV_C = 0.55;
  const vert = (p: P3, n: P3, c: number): void => {
    pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]);
    col.push(c, c, c); uvs.push(UV_C, UV_C);
  };
  const tri = (a: P3, na: P3, b: P3, nb: P3, c: P3, nc: P3, ca: number, cb: number, cc: number): void => {
    const nAvg: P3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    // 绕序与法线一致：宁可在这里翻一次，也不让 FrontSide 把整片坡剔成"浮在墙上的薄板"
    if (dot3(cross3(sub3(b, a), sub3(c, a)), nAvg) < 0) { vert(a, na, ca); vert(c, nc, cc); vert(b, nb, cb); return; }
    vert(a, na, ca); vert(b, nb, cb); vert(c, nc, cc);
  };
  const quad = (a: P3, na: P3, b: P3, nb: P3, c: P3, nc: P3, d: P3, nd: P3, ca: number, cb: number, cc: number, cd: number): void => {
    tri(a, na, b, nb, c, nc, ca, cb, cc);
    tri(a, na, c, nc, d, nd, ca, cc, cd);
  };
  /** 剖面：t=0 在脊，t=1 在檐口 */
  const yAt = (u: number, t: number): number => {
    // 草顶外凸（檐口最陡、近脊转平）——与瓦顶的「上陡下缓」正好相反，远看就能分出两种材质
    const base = o.thatch
      ? 1 - 0.20 * t - 0.80 * t * t                      // 草顶外凸：脊侧平、檐口陡
      : (1 - o.eaveSlope) * (1 - t) * (1 - t) + o.eaveSlope * (1 - t);
    return base + o.corner * t * t * u * u;
  };
  const surf = (u: number, t: number, side: 1 | -1): { p: P3; n: P3 } => {
    const p: P3 = [u * 0.5, yAt(u, t), side * 0.5 * t];
    const d = 2e-3;
    const ta = Math.max(0, t - d), tb = Math.min(1, t + d);
    const ua = Math.max(-1, u - d), ub = Math.min(1, u + d);
    const A: P3 = [0.5 * (ub - ua), yAt(ub, t) - yAt(ua, t), 0];
    const B: P3 = [0, yAt(u, tb) - yAt(u, ta), side * 0.5 * (tb - ta)];
    let n = cross3(B, A);
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]]; // 两侧坡面统一朝上翻正（推导见 cross(∂p/∂t, ∂p/∂u)）
    return { p, n: unit3(n) };
  };
  // ① 两坡：rings 段 × cols 列，逐顶点法线（曲面平滑，脊线自带硬折）
  for (const side of [1, -1] as const) {
    for (let j = 0; j < o.rings; j++) {
      const t0 = j / o.rings, t1 = (j + 1) / o.rings;
      for (let k = 0; k < o.cols; k++) {
        const u0 = -1 + (2 * k) / o.cols, u1 = -1 + (2 * (k + 1)) / o.cols;
        const a = surf(u0, t0, side), b = surf(u1, t0, side), c = surf(u1, t1, side), d2 = surf(u0, t1, side);
        // 檐口一圈压暗（瓦口/滴水阴影），脊侧提亮：俯视时两坡的明暗差就是"坡"本身
        const ce = 0.90 + 0.10 * (1 - (t0 + t1) / 2);
        quad(a.p, a.n, b.p, b.n, c.p, c.n, d2.p, d2.n, ce, ce, ce, ce);
      }
    }
  }
  // ② 正脊：实体脊身（比屋面高一截），俯视读成一条通长线
  const RH = o.ridgeH, RW = o.ridgeHalf;
  const ridgeC = o.thatch ? 1.12 : 1.40;
  if (o.ridgeRoll) {
    const SEG = 3;
    const arc: { z: number; y: number; n: P3 }[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (Math.PI * i) / SEG;
      const z = Math.cos(a) * RW, y = 1 + Math.sin(a) * RH;
      arc.push({ z, y, n: unit3([0, (y - 1) / Math.max(RH, 1e-4), z / Math.max(RW, 1e-4)]) });
    }
    for (let i = 0; i < SEG; i++) {
      const p0 = arc[i], p1 = arc[i + 1];
      quad([-0.5, p0.y, p0.z], p0.n, [0.5, p0.y, p0.z], p0.n, [0.5, p1.y, p1.z], p1.n, [-0.5, p1.y, p1.z], p1.n,
        ridgeC, ridgeC, ridgeC * 0.94, ridgeC * 0.94);
    }
    for (const sx of [1, -1] as const) {
      const n: P3 = [sx, 0, 0];
      for (let i = 0; i < SEG; i++) {
        const p0 = arc[i], p1 = arc[i + 1];
        tri([sx * 0.5, 1, 0], n, [sx * 0.5, p0.y, p0.z], n, [sx * 0.5, p1.y, p1.z], n, ridgeC * 0.9, ridgeC * 0.9, ridgeC * 0.9);
      }
    }
  } else {
    const top = 1 + RH;
    quad([-0.5, top, -RW], [0, 1, 0], [0.5, top, -RW], [0, 1, 0], [0.5, top, RW], [0, 1, 0], [-0.5, top, RW], [0, 1, 0],
      ridgeC, ridgeC, ridgeC, ridgeC);
    for (const s of [1, -1] as const) {
      const n: P3 = [0, 0, s];
      quad([-0.5, 1, s * RW], n, [0.5, 1, s * RW], n, [0.5, top, s * RW], n, [-0.5, top, s * RW], n,
        ridgeC * 0.78, ridgeC * 0.78, ridgeC * 0.9, ridgeC * 0.9);
    }
    for (const sx of [1, -1] as const) {
      const n: P3 = [sx, 0, 0];
      quad([sx * 0.5, 1, -RW], n, [sx * 0.5, 1, RW], n, [sx * 0.5, top, RW], n, [sx * 0.5, top, -RW], n,
        ridgeC * 0.86, ridgeC * 0.86, ridgeC * 0.86, ridgeC * 0.86);
    }
  }
  // ③ 封头（山花/博风板内侧）：把屋顶内腔彻底封死，任何角度都看不到屋面背面。
  //    采样比坡面稀：真正露在外面的只有"屋顶外沿到山墙"那一圈（0.1–0.34m），
  //    被墙色山墙挡住的内部用 1–2 段直线插值就够了。
  if (o.endFace) {
    const ec = o.endC ?? (o.thatch ? 0.86 : 0.74);
    const ER = o.rings >= 3 ? 2 : 1;
    for (const sx of [1, -1] as const) {
      const n: P3 = [sx, 0, 0];
      for (const sz of [1, -1] as const) {
        for (let j = 0; j < ER; j++) {
          const t0 = j / ER, t1 = (j + 1) / ER;
          const z0 = sz * 0.5 * t0, z1 = sz * 0.5 * t1;
          const y0 = yAt(1, t0), y1 = yAt(1, t1);
          quad([sx * 0.5, -0.03, z0], n, [sx * 0.5, -0.03, z1], n, [sx * 0.5, y1, z1], n, [sx * 0.5, y0, z0], n,
            ec, ec, ec, ec);
        }
      }
    }
  }
  // ④ 檐口板：屋面外沿垂下一道厚度，墙顶与檐下因此有明暗分界（宋式民居檐口 0.1–0.2m）
  if (o.fascia > 0) {
    const FC = Math.min(o.cols, 3);
    for (const side of [1, -1] as const) {
      const n: P3 = [0, 0, side];
      for (let k = 0; k < FC; k++) {
        const u0 = -1 + (2 * k) / FC, u1 = -1 + (2 * (k + 1)) / FC;
        const y0 = yAt(u0, 1), y1 = yAt(u1, 1);
        const z = side * 0.5;
        quad([u0 * 0.5, y0, z], n, [u1 * 0.5, y1, z], n, [u1 * 0.5, y1 - o.fascia, z], n, [u0 * 0.5, y0 - o.fascia, z], n,
          0.62, 0.62, 0.52, 0.52);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * 山墙（两端三角封头，BODY 材质 → 墙色）。屋顶自带的封头是瓦色，只能读成"博风板"；
 * 宋式民居两头那片粉白三角是**山墙**，必须走墙材质，否则整栋屋顶仍是"一块盖板"。
 * 单位空间与屋顶同一套：x 沿面阔、z 沿进深、y 0=檐口 1=脊顶。顶边跟举折曲线。
 */
function gableWallGeo(): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], uvs: number[] = [];
  const R = 2;
  // 山墙落在墙皮上（比屋顶收进一个出檐），其顶边对应屋顶 t = d/(d+2·出檐) ≈ 0.86
  const TR = 0.86;
  const yAt = (tv: number): number => Math.pow(1 - Math.min(1, tv), 1.35) + 0.02; // 微抬 2cm 穿进屋面，杜绝缝
  const vert = (p: P3, n: P3, c: number): void => {
    pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]);
    col.push(c, c, c); uvs.push(0.55, 0.55);
  };
  for (const sx of [1, -1] as const) {
    const n: P3 = [sx, 0, 0];
    for (const sz of [1, -1] as const) {
      for (let j = 0; j < R; j++) {
        const t0 = j / R, t1 = (j + 1) / R;
        const z0 = sz * 0.5 * t0, z1 = sz * 0.5 * t1;
        const y0 = yAt(t0 * TR), y1 = yAt(t1 * TR);
        const a: P3 = [sx * 0.5, -0.05, z0], b: P3 = [sx * 0.5, -0.05, z1];
        const c: P3 = [sx * 0.5, y1, z1], d: P3 = [sx * 0.5, y0, z0];
        const k = 0.82 + 0.18 * (1 - (t0 + t1) / 2);
        vert(a, n, k); vert(b, n, k); vert(c, n, k);
        vert(a, n, k); vert(c, n, k); vert(d, n, k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * 单坡厦子（偏屋/杂屋）：一面靠墙、坡向院内。单位空间 x=沿脊长、z=坡向、y 0=低檐 1=高檐。
 * 高檐一侧带一道垂裙（把"屋顶架在矮墙上方 0.7m"的空当封住），低檐侧带檐口板。
 */
function shedRoofGeo(): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], uvs: number[] = [];
  const vert = (p: P3, n: P3, c: number): void => {
    pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]);
    col.push(c, c, c); uvs.push(0.55, 0.55);
  };
  const quad = (a: P3, na: P3, b: P3, nb: P3, c: P3, nc: P3, d: P3, nd: P3, ca: number, cb: number, cc: number, cd: number): void => {
    const nAvg: P3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    const flip = dot3(cross3(sub3(b, a), sub3(c, a)), nAvg) < 0;
    const v = (p: P3, n: P3, c: number): void => vert(p, n, c);
    if (flip) { v(a, na, ca); v(c, nc, cc); v(b, nb, cb); v(a, na, ca); v(d, nd, cd); v(c, nc, cc); return; }
    v(a, na, ca); v(b, nb, cb); v(c, nc, cc); v(a, na, ca); v(c, nc, cc); v(d, nd, cd);
  };
  const C = 2;
  // 坡面 y = 0.5 + z
  for (let k = 0; k < C; k++) {
    const x0 = -0.5 + k / C, x1 = -0.5 + (k + 1) / C;
    const n = unit3([0, 1, -1]);
    quad([x0, 0, -0.5], n, [x1, 0, -0.5], n, [x1, 1, 0.5], n, [x0, 1, 0.5], n, 0.98, 0.98, 1.06, 1.06);
  }
  // 高檐垂裙（封住屋顶与矮墙之间的空当）
  quad([-0.5, 1, 0.5], [0, 0, 1], [0.5, 1, 0.5], [0, 0, 1], [0.5, 0.3, 0.5], [0, 0, 1], [-0.5, 0.3, 0.5], [0, 0, 1], 0.70, 0.70, 0.56, 0.56);
  // 两端三角封头
  for (const sx of [1, -1] as const) {
    const n: P3 = [sx, 0, 0];
    vert([sx * 0.5, 0, -0.5], n, 0.84); vert([sx * 0.5, 0.3, 0.5], n, 0.84); vert([sx * 0.5, 1, 0.5], n, 0.84);
  }
  // 低檐檐口板
  quad([-0.5, 0, -0.5], [0, 0, -1], [0.5, 0, -0.5], [0, 0, -1], [0.5, -0.07, -0.5], [0, 0, -1], [-0.5, -0.07, -0.5], [0, 0, -1], 0.60, 0.60, 0.50, 0.50);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** 远档（tier2，2.4–3.6km）的简屋顶：两个坡面 + 一条抬高的脊带。8 面。 */
function tentRoofGeo(): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], uvs: number[] = [];
  const v = (p: P3, n: P3, c: number): void => {
    pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); col.push(c, c, c); uvs.push(0.55, 0.55);
  };
  for (const side of [1, -1] as const) {
    const n = unit3([0, 1, -side]);
    v([-0.5, 0, side * 0.5], n, 0.92); v([0.5, 0, side * 0.5], n, 0.92); v([0.5, 1, 0], n, 1.0);
    v([-0.5, 0, side * 0.5], n, 0.92); v([0.5, 1, 0], n, 1.0); v([-0.5, 1, 0], n, 1.0);
  }
  // 山面（封死内腔）
  for (const sx of [1, -1] as const) {
    const n: P3 = [sx, 0, 0];
    v([sx * 0.5, 0, -0.5], n, 0.78); v([sx * 0.5, 1, 0], n, 0.78); v([sx * 0.5, 0, 0.5], n, 0.78);
  }
  // 脊带：略高于屋面的一条亮带（3km 外只剩这一条能读出"是屋顶"）
  const top = 1.12, w = 0.06;
  v([-0.5, top, -w], [0, 1, 0], 1.45); v([0.5, top, -w], [0, 1, 0], 1.45); v([0.5, top, w], [0, 1, 0], 1.45);
  v([-0.5, top, -w], [0, 1, 0], 1.45); v([0.5, top, w], [0, 1, 0], 1.45); v([-0.5, top, w], [0, 1, 0], 1.45);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** 五面盒（去底面）：墙身 / 院墙 / 灯柱 / 井台都坐在地坪或台明上，底面永远不可见。
 *  BoxGeometry 是 24 顶点 36 索引、面序 +x −x +y −y +z −z，砍掉 −y 的 6 个索引即 10 面。
 *  本路 40 万件实例因此省下约 80 万面——这是把简院铺到 2.4km 的预算前提。 */
function boxUnit5(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    const keep = a instanceof Uint16Array ? new Uint16Array(30) : new Uint32Array(30);
    keep.set(a.subarray(0, 18), 0);
    keep.set(a.subarray(24), 18);
    g.setIndex(new THREE.BufferAttribute(keep, 1));
  }
  return g.translate(0, 0.5, 0);
}

/** 居中锚点的五面盒：窗光方片用。窗框嵌在墙里，底面永远不可见，砍掉 −y 面省 2 面/件；
 *  本路窗光 20 万件以上，这一刀把 A5/A3' 新增的灯笼与陈设面数全部挣回来。 */
function boxUnit5c(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    const keep = a instanceof Uint16Array ? new Uint16Array(30) : new Uint32Array(30);
    keep.set(a.subarray(0, 18), 0);
    keep.set(a.subarray(24), 18);
    g.setIndex(new THREE.BufferAttribute(keep, 1));
  }
  return g;
}

/** 树冠球单元：直径 1 的球（半径 0.5）。近档 7×4 段 = 42 面、中档 5×3 段 = 20 面。
 *  三种形态全靠实例非等比缩放做出来（宽扁柳冠 / 锥状松层 / 圆球阔叶），**不再用单圆锥**。 */
let _leafNear: THREE.BufferGeometry | null = null;
let _leafMid: THREE.BufferGeometry | null = null;
function leafNearUnit(): THREE.BufferGeometry {
  if (!_leafNear) _leafNear = new THREE.SphereGeometry(0.5, 7, 4);
  return _leafNear;
}
function leafMidUnit(): THREE.BufferGeometry {
  if (!_leafMid) _leafMid = new THREE.SphereGeometry(0.5, 5, 3);
  return _leafMid;
}
/** 树干：5 棱开口锥台（底半径 1 / 顶 0.55），10 面；底面锚点 */
let _trunkUnit: THREE.BufferGeometry | null = null;
function trunkUnit(): THREE.BufferGeometry {
  if (!_trunkUnit) _trunkUnit = new THREE.CylinderGeometry(0.55, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  return _trunkUnit;
}

// ---- 屋顶变体：同一套 twinRoofGeo，只改采样密度与脊形（一档一档地省面）----
// 面数账：坡面 4·cols·rings + 正脊 10 + 封头 4·rings + 檐口 4·cols
let _roofNear: THREE.BufferGeometry | null = null;
let _roofMid: THREE.BufferGeometry | null = null;
let _roofThatch: THREE.BufferGeometry | null = null;
let _gableWall: THREE.BufferGeometry | null = null;
let _shedRoof: THREE.BufferGeometry | null = null;
let _tentRoof: THREE.BufferGeometry | null = null;
let _roofFar: THREE.BufferGeometry | null = null;

/** 近档正房（tier0，≤1200m）：4 列 × 3 环举折 + 方脊 + 两端封头 + 檐口板 = 86 面
 *  列数只影响「角部起翘」与檐口线的折点数；瓦垄由着色器按世界坐标生成，不吃几何列数。 */
function roofUnitNear(): THREE.BufferGeometry {
  return _roofNear ??= twinRoofGeo({ cols: 4, rings: 3, eaveSlope: 0.52, corner: 0.11, ridgeH: 0.20, ridgeHalf: 0.036, fascia: 0.085, endFace: true });
}
/** 中档（tier1 简院 / tier0 厢房）：2 列 × 2 环，形态（两坡 + 脊 + 封头 + 檐口）一样，只降采样 = 42 面 */
function roofUnitMid(): THREE.BufferGeometry {
  return _roofMid ??= twinRoofGeo({ cols: 2, rings: 2, eaveSlope: 0.52, corner: 0.09, ridgeH: 0.19, ridgeHalf: 0.038, fascia: 0.085, endFace: true, endC: 1.75 });
}
/** 草顶/苇顶正房：外凸圆坡（檐口最陡）+ 圆脊捆 + 厚檐，没有瓦垄（走无条纹材质）= 84 面 */
function roofUnitThatch(): THREE.BufferGeometry {
  return _roofThatch ??= twinRoofGeo({ cols: 4, rings: 3, eaveSlope: 0.5, corner: 0.05, ridgeH: 0.16, ridgeHalf: 0.05, ridgeRoll: true, fascia: 0.11, endFace: true, thatch: true });
}
function gableWallUnit(): THREE.BufferGeometry { return _gableWall ??= gableWallGeo(); }
function shedUnit(): THREE.BufferGeometry { return _shedRoof ??= shedRoofGeo(); }
function tentUnit(): THREE.BufferGeometry { return _tentRoof ??= tentRoofGeo(); }

/** 远档（>3600m，一栋 6–10 像素）：两坡 + 一条略高的脊带 + 暗檐口，12 面。 */
function roofUnitFar(): THREE.BufferGeometry {
  if (_roofFar) return _roofFar;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], uv: number[] = [];
  const tri = (a: number[], b: number[], c: number[], n: number[], ca: number, cb: number, cc: number): void => {
    const vs = [a, b, c], cs = [ca, cb, cc];
    for (let i = 0; i < 3; i++) {
      pos.push(vs[i][0], vs[i][1], vs[i][2]); nrm.push(n[0], n[1], n[2]); col.push(cs[i], cs[i], cs[i]); uv.push(0.55, 0.55);
    }
  };
  // 两坡（各 1 面，坡面比旧版抬 0.03：3km 外靠这点高差区分「坡」与「板」）
  tri([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1.0, 0], [0, 0.45, 0.89], 0.92, 0.92, 1.0);
  tri([-0.5, 0, 0.5], [0.5, 1.0, 0], [-0.5, 1.0, 0], [0, 0.45, 0.89], 0.92, 1.0, 1.0);
  tri([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1.0, 0], [0, 0.45, -0.89], 0.92, 0.92, 1.0);
  tri([0.5, 0, -0.5], [-0.5, 1.0, 0], [0.5, 1.0, 0], [0, 0.45, -0.89], 0.92, 1.0, 1.0);
  // 脊带：加宽到 0.10、抬高 0.16，远档只剩这条线可读
  const RW = 0.10, RT = 1.16;
  tri([-0.5, 1.0, -RW], [0.5, 1.0, -RW], [0.5, RT, 0], [0, 0.75, -0.66], 1.5, 1.5, 1.6);
  tri([-0.5, 1.0, -RW], [0.5, RT, 0], [-0.5, RT, 0], [0, 0.75, -0.66], 1.5, 1.6, 1.6);
  tri([-0.5, RT, 0], [0.5, RT, 0], [0.5, 1.0, RW], [0, 0.75, 0.66], 1.6, 1.6, 1.5);
  tri([-0.5, RT, 0], [0.5, 1.0, RW], [-0.5, 1.0, RW], [0, 0.75, 0.66], 1.6, 1.5, 1.5);
  // 檐口暗边（前后各一条）
  for (const side of [1, -1] as const) {
    tri([-0.5, 0, side * 0.5], [0.5, 0, side * 0.5], [0.5, -0.10, side * 0.5], [0, 0, side], 0.58, 0.58, 0.46);
    tri([-0.5, 0, side * 0.5], [0.5, -0.10, side * 0.5], [-0.5, -0.10, side * 0.5], [0, 0, side], 0.58, 0.46, 0.46);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  _roofFar = g;
  return g;
}

// ---- 屋面尺寸（世界 m）：脊高 / 出檐。全是纯函数，emitFill 与摆位两处必须调同一份 ----
/** 脊高 = f(进深)：坡度 ≈ arctan((0.34·d+0.5)/(d/2+出檐)) ≈ 33°–37°，宋式民居量级 */
export function roofRise(w: number, d: number): number { return Math.min(w, d) * 0.34 + 0.5; }
/** 两山出挑：15m 以上大院走悬山（0.34，两端挑出、看得到博风板下的暗影），
 *  其余硬山（0.03，屋面与山墙齐平 —— 出挑一大，山墙三角就被瓦色封头挡住，读不出"山墙"） */
export function roofOverhangX(w: number): number { return w >= 15 ? 0.34 : 0.03; }
/** 前后檐出挑（宋式民居 0.5–0.7m，取 0.6） */
export const ROOF_EAVE_OUT = 0.6;

/**
 * 瓦垄着色：按实例脊向在世界坐标里按 ROOF_RIB_M 定距生成筒瓦条纹 + 法线扰动。
 * 几何只有 5 列（面阔 6–23m 要 18–68 列才压到 0.34m），所以垄距只能在片元里定：
 * 取实例矩阵第一列（脊向单位向量）与实例原点，世界坐标投影定相位 —— **每户垄距恒为 0.34m**。
 * 近处叠一个解析法线扰动（筒瓦是凸的），远处淡出，避免亚像素摩尔纹。
 */
export const ROOF_RIB_M = 0.34;
function roofFluteHook(m: THREE.MeshLambertMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRib = { value: ROOF_RIB_M };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoofP;\nvarying vec3 vRoofO;\nvarying vec3 vRoofA;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vRoofA = normalize( instanceMatrix[ 0 ].xyz );
  vRoofO = ( modelMatrix * instanceMatrix[ 3 ] ).xyz;
  vRoofP = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
  vRoofA = normalize( modelMatrix[ 0 ].xyz );
  vRoofO = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vRoofP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoofP;\nvarying vec3 vRoofO;\nvarying vec3 vRoofA;\nuniform float uRib;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float along = dot( vRoofP - vRoofO, vRoofA );
  float ph = along * 6.28318530718 / uRib;
  float sv = sin( ph );
  float crest = smoothstep( -0.62, 0.34, sv );
  float dist = length( vViewPosition );
  float band = 1.0 - smoothstep( 240.0, 700.0, dist );
  diffuseColor.rgb *= mix( 1.0, mix( 0.72, 1.17, crest ), band );
  float bump = 1.0 - smoothstep( 26.0, 150.0, dist );
  if ( bump > 0.002 ) {
    vec3 axisW = normalize( vRoofA );
    vec3 nW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
    vec3 tW = axisW - nW * dot( nW, axisW );
    float tl = length( tW );
    if ( tl > 1e-3 ) {
      tW /= tl;
      float dh = 0.024 * cos( ph ) * ( 6.28318530718 / uRib ) * band * bump;
      normal = normalize( ( viewMatrix * vec4( normalize( nW - tW * dh ), 0.0 ) ).xyz );
    }
  }
}`);
  };
}

/**
 * 夜间瓦色色调：MeshLambert 的 emissive 是材质级常量——午夜时八档瓦色被同一层 0x2a323e 抬成同一亮度，
 * 俯视就是一块蓝灰平板（A1 的"夜里吞掉 8 档瓦色差"）。
 * 这里把自发光乘上实例色（vColor = 顶点色 × instanceColor，线性空间）：
 *   ① 色相跟着瓦色走（青灰发冷、板瓦褐发暖、草顶发黄）；
 *   ② 强度按瓦色明度分三档（暗瓦少抬、亮瓦多抬），均值仍落在原常量附近，不整体提亮。
 * 与 roofFluteHook 组合，不覆盖已有的 onBeforeCompile。
 */
function roofEmissiveTint(m: THREE.MeshLambertMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, renderer) => {
    prev.call(m, sh, renderer);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#ifdef USE_COLOR
{
  vec3 tileC = max( vColor.rgb, vec3( 1e-4 ) );
  float tileL = dot( tileC, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 hue = tileC / max( tileL, 1e-4 );
  // 明度档拉成 ~2.2×（暗瓦 0.30 / 亮瓦 1.75），色相用瓦色本身；均值压到原常量附近，不整体提亮
  float level = clamp( 0.18 + 3.10 * tileL, 0.30, 1.75 );
  totalEmissiveRadiance *= hue * level * 0.86;
}
#endif`,
    );
  };
}

// ============ 墙与门窗（W26）：勒脚 / 墙帽 / 夯土横纹走材质世界 Y 着色带（0 面），
//            棂窗 / 板门 / 踏跺石走 2 面贴面小件 + 片元图案。两者都不新增贴图文件。 ============
const PLINTH_H = 0.46;   // 勒脚高（宋式民居墙根石脚 0.4–0.5m）
const CAP_H = 0.16;      // 墙帽压顶高
const COURSE_M = 0.42;   // 夯土横纹间距（0.35–0.5m 一档）

/**
 * 墙身材质：勒脚 + 墙帽 + 夯土横纹，全部按**实例世界坐标**取带，不改几何、不加实例。
 * 只作用于「立在地上的墙」：墙高 < 1.05m 的小件（菜畦 / 柴堆 / 井台 / 巷道地坪）不套勒脚；
 * 墙帽只给 1.6m 以上的墙。tier0 的正房厢房与 tier1/tier2 的简院墙身走同一份代码，
 * 远档因此也自动带上墙根色带（原来只能靠"往下加一个深色盒子"，那是 8 面/栋）。
 */
function plasterHook(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWallY;\nvarying float vWallH;\nvarying float vWallBase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vWallH = length( instanceMatrix[ 1 ].xyz );
  vWallBase = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).y;
  vWallY = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;
#else
  vWallH = 1.0;
  vWallBase = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).y;
  vWallY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWallY;\nvarying float vWallH;\nvarying float vWallBase;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float hAbove = max( vWallY - vWallBase, 0.0 );
  float wallLike = step( 1.05, vWallH );
  float plinth = ( 1.0 - smoothstep( ${PLINTH_H.toFixed(2)} - 0.05, ${PLINTH_H.toFixed(2)}, hAbove ) ) * wallLike;
  diffuseColor.rgb *= mix( 1.0, 0.62, plinth );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.052, 0.050, 0.045 ), plinth * 0.32 );
  float cap = ( 1.0 - smoothstep( ${CAP_H.toFixed(2)} - 0.05, ${CAP_H.toFixed(2)}, vWallH - hAbove ) ) * step( 1.6, vWallH );
  diffuseColor.rgb *= mix( 1.0, 0.68, cap );
  float course = abs( fract( hAbove / ${COURSE_M.toFixed(2)} ) - 0.5 ) * 2.0;
  diffuseColor.rgb *= 1.0 - 0.034 * wallLike * smoothstep( 0.70, 1.0, course );
}`);
  };
}

/**
 * 巷道地坪：车辙 / 路心 / 石板缝 / 边沟散水全部按**实例尺度**在片元里画。
 * 巷道实例是 box(w=巷长, h=0.07, d=巷宽+0.7)，所以 position.x 是沿巷、position.z 是过巷；
 * 实例矩阵两列的模长就是米数 —— 无论巷宽 2.2 还是 4.5m，两条车辙永远落在同一相对位置。
 */
function roadHook(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRoadL;\nvarying float vRoadW;\nvarying float vRoadD;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vRoadL = position.x * length( instanceMatrix[ 0 ].xyz );
  vRoadW = position.z * length( instanceMatrix[ 2 ].xyz );
  vRoadD = length( instanceMatrix[ 2 ].xyz );
#else
  vRoadL = position.x;
  vRoadW = position.z;
  vRoadD = 1.0;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vRoadL;
varying float vRoadW;
varying float vRoadD;
float roadHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
float roadNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( roadHash( i ), roadHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( roadHash( i + vec2( 0.0, 1.0 ) ), roadHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float halfW = max( vRoadD * 0.5, 0.4 );
  float at = clamp( abs( vRoadW ) / halfW, 0.0, 1.0 );
  // 程序化斑驳替掉被箱体 UV 沿巷拉伸的贴图（拉伸后会读成"木纹"，这是上一版的最大问题）
  float mot = roadNoise( vec2( vRoadL, vRoadW ) * 1.7 ) * 0.62
            + roadNoise( vec2( vRoadL, vRoadW ) * 6.5 ) * 0.26;
  diffuseColor.rgb *= 0.84 + 0.34 * mot;
  float core = 1.0 - smoothstep( 0.0, 0.40, at );                                    // 踩实的路心
  float rut = smoothstep( 0.26, 0.34, at ) * ( 1.0 - smoothstep( 0.48, 0.58, at ) );  // 两道车辙
  float edge = smoothstep( 0.80, 0.97, at );                                         // 墙根散水 / 边沟
  float row = floor( ( vRoadW / halfW * 0.5 + 0.5 ) * 2.6 );
  float pitch = 0.95 + 0.95 * roadHash( vec2( row, 3.7 ) );
  float seam = abs( fract( vRoadL / pitch + mod( row, 2.0 ) * 0.5 ) - 0.5 );
  float inStone = 1.0 - smoothstep( 0.82, 0.92, at );      // 石板只铺到边沟，边上留土
  diffuseColor.rgb *= 1.0 + 0.11 * core - 0.20 * rut - 0.17 * edge;
  diffuseColor.rgb *= 1.0 - 0.06 * smoothstep( 0.36, 0.5, seam ) * inStone;
}`);
  };
}

/** 贴面小件的单位四边形：x∈[-0.5,0.5]、y∈[0,1]，底面锚点、面朝 +Z（与 put 的约定一致） */
let _furnQuad: THREE.BufferGeometry | null = null;
function furnQuad(): THREE.BufferGeometry {
  if (_furnQuad) return _furnQuad;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
  ]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return (_furnQuad = g);
}

/**
 * 门窗图案（片元）：kind 0 棂窗 = 外框 + 竖 3 横 2 棂条 + 石窗台板 + 纸窗暖光；
 * kind 1 板门 = 门框 + 四道竖板缝 + 石门槛 + 门楣 + 两枚门簪；kind 2 踏跺石 = 倒棱石板 + 拼缝。
 * 窗的光只加在纸面区域（emissive），白天是纸、夜里是灯，边框永远是暗木色 —— 不再是"浮在墙上的白片"。
 */
function furnHook(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    const decl = 'varying vec2 vFUv;\nvarying vec3 vFAttr;';
    const look = `
float fLine( float d, float w, float aa ) {
  float e = w * 0.5 - abs( d );
  return clamp( e / max( aa * 2.0, 1e-4 ) + 0.5, 0.0, 1.0 );
}
void furnLook( vec2 uv, vec3 attr, float aa, out vec3 col, out float glow ) {
  float kind = attr.x;
  float seed = attr.y;
  float u = uv.x;
  float v = uv.y;
  float au = max( aa, 1e-4 );
  vec3 wood = mix( vec3( 0.085, 0.050, 0.026 ), vec3( 0.155, 0.095, 0.050 ), seed );
  // 纸窗：白天是**比墙暗**的暖灰（远看是"窗洞 + 棂条"，不是白点），夜里靠 emissive 亮起来
  vec3 paper = vec3( 0.135, 0.103, 0.062 );
  vec3 stone = vec3( 0.20, 0.19, 0.17 );
  vec3 c = wood;
  glow = 0.0;
  if ( kind < 0.5 ) {
    float bd = 0.085;
    float inner = ( 1.0 - smoothstep( 0.5 - bd - au, 0.5 - bd + au, abs( u ) ) )
                * smoothstep( bd - au, bd + au, v )
                * ( 1.0 - smoothstep( 1.0 - bd - au, 1.0 - bd + au, v ) );
    float bar = max( max( fLine( u + 0.25, 0.030, au ), fLine( u, 0.030, au ) ), fLine( u - 0.25, 0.030, au ) );
    bar = max( bar, max( fLine( v - 0.38, 0.028, au ), fLine( v - 0.66, 0.028, au ) )
                    * step( bd, v ) * step( v, 1.0 - bd ) );
    float frame = 1.0 - inner;
    float sill = 1.0 - smoothstep( bd * 0.72 - au, bd * 0.72 + au, v );
    vec3 pane = paper * ( 0.80 + 0.50 * ( 1.0 - v ) );
    c = mix( pane, wood, clamp( bar, 0.0, 1.0 ) );
    c = mix( c, wood * 1.25, frame );
    c = mix( c, stone, sill );
    glow = inner * ( 1.0 - clamp( bar, 0.0, 1.0 ) ) * ( 1.0 - sill ) * ( 0.45 + 0.55 * attr.z );
  } else if ( kind < 1.5 ) {
    float bd = 0.075;
    float inner = ( 1.0 - smoothstep( 0.5 - bd - au, 0.5 - bd + au, abs( u ) ) )
                * smoothstep( bd - au, bd + au, v )
                * ( 1.0 - smoothstep( 1.0 - bd - au, 1.0 - bd + au, v ) );
    float px = ( u + 0.5 - bd ) / max( 0.001, 1.0 - 2.0 * bd );
    float fx = fract( px * 4.0 );
    float seam = ( 1.0 - smoothstep( 0.0, 0.055, min( fx, 1.0 - fx ) ) ) * inner;
    float sill = 1.0 - smoothstep( 0.055 - au, 0.055 + au, v );
    float lintel = smoothstep( 0.885 - au, 0.885 + au, v );
    vec3 leaf = wood * ( 0.95 + 0.30 * seed );
    c = mix( leaf, leaf * 0.62, seam );
    c = mix( c, wood * 1.9, 1.0 - inner );      // 门框 / 门额：比门扇亮一档，才看得出"框"
    c = mix( c, stone * 1.35, sill );            // 门槛：石色
    c = mix( c, wood * 2.1, lintel );            // 门楣
    float stud = step( 0.845, v ) * step( v, 0.945 ) * step( 0.13, abs( u ) ) * step( abs( u ), 0.235 );
    c = mix( c, vec3( 0.30, 0.22, 0.11 ), stud ); // 两枚门簪
  } else if ( kind < 2.5 ) {
    float e = max( abs( u ) * 1.0, abs( v - 0.5 ) * 1.55 );
    c = mix( stone * 1.2, stone * 0.70, smoothstep( 0.40, 0.47, e ) );
    c *= 1.0 - 0.35 * ( 1.0 - smoothstep( 0.0, 0.035, abs( v - 0.5 ) ) );
  }
  col = c;
}
`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${decl}\nattribute vec3 aFurn;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFUv = vec2( position.x, position.y );
vFAttr = aFurn;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}\n${look}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 fCol;
  float fGlow;
  vec2 fw = fwidth( vFUv );
  furnLook( vFUv, vFAttr, max( fw.x, fw.y ), fCol, fGlow );
  diffuseColor.rgb = fCol;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 fCol2;
  float fGlow2;
  vec2 fw2 = fwidth( vFUv );
  furnLook( vFUv, vFAttr, max( fw2.x, fw2.y ), fCol2, fGlow2 );
  totalEmissiveRadiance += vec3( 1.0, 0.60, 0.26 ) * fGlow2 * 0.20;
}`);
  };
}

// ---------- W9 参数：SPEC §8 的全部数字集中在此，调参只动这一块 ----------
const W9_CORNER = 18;                  // 坊四角各 ±18m 抖动
const W9_BOW = 2.8;                    // 边线控制点外凸上限（另一侧内凹 ≤1.2m）
const W9_NODE: [number, number] = [3, 5];  // 每边 3–5 个控制点
const W9_CUT = 25 * Math.PI / 180;     // 切线相对父地块主轴的随机偏转上限（原有抖动保留）
// 低频扰动场再推 ±42°：旧版切线永远落在「父轴 +90° ±25°」里，全坊只有两族近似正交的切法，
// 地块与巷道因此排成十字格。叠加连续场后，切线相对父轴可偏 25°–155°，两族结构被打散。
const W9_CUT_FIELD = 42 * Math.PI / 180;
const W9_RATIO: [number, number] = [0.30, 0.70];
const W9_RATIO_FIELD = 0.08;           // 切缝位置也随低频场偏移：相邻切缝不再等距
// 地块停切面积：旧版逐节点独立抽「均匀 260–420㎡ + 10% 抽 22–64㎡」。
// 每个父地块都切到同一档 ⇒ 地块密度在平面上是常数 ⇒ 最近邻间距 CV 卡在 0.20（探针实测）。
// 远景（tier1/2）改为**密度场 + 几何长尾**：一片街区共用一个目标面积（50–1400㎡），
// 有的街段一路切到 7m 独户，有的停在 37m 大宅；近景（tier0）保留旧分布——
// 近景的 CV 本来就够（0.79–0.84），改成小院只会让空院与院墙段数暴涨、面数超预算。
const W9_LOT: [number, number] = [260, 420];   // 近景停切面积（旧口径，保持逐块现抽）
const W9_LOT_TAIL: [number, number] = [50, 1400]; // 远景几何长尾的两端（7m 独户 ↔ 37m 大宅）
const W9_LOT_JIT = 0.16;               // 远景每节点再 ±16% 细抖：同一片里也不会精确同尺寸
// tier1/2 的「院组」比例：一院里再出一栋厢房（相距 4.4–6.0m），让远景的最近邻不再只有一个间距。
const W9_PAIR_LOD = 0.9;
// tier1/2 的地块放大系数：远景一院出两栋（W9_PAIR_LOD），宅基就少一些，
// 建筑总件数不变、院墙/门窗不再随宅基一起膨胀，面数才守得住 ≤ 基线。
const W9_LOT_LOD = 2.42;
// 地块深度上限：从跌进 W9_BLOCK 那一层起计。深度 5 时最小地块 = 4200/2^5 ≈ 131㎡，
// 旧版「10% 抽 22–64㎡ 小院」因此**从未真正落地**（被深度截断），地块尺寸全挤在同一档。
// 远景放到 6 层才能切到 66㎡ 级（4200/2^6），小院 ↔ 大宅的疏密差才成立；
// 近景保持 5 层（基线口径），否则空院与院墙段数会把面数顶出预算。
const W9_DEPTH = 6;
const W9_DEPTH_NEAR = 5;
const W9_BLOCK = 4200;                 // 地块深度起算尺度：比它大的层只算「切街」，不计深度
// 56% 的边界留巷，其余 0.4m 共墙。巷宽从 1.7m 抬到 2.2–4.5m 后建成面被挤掉一截，
// 再把留巷比例从 0.65 收到 0.56：巷加宽但条数减少，覆盖率仍守在 0.78 上下（仍是密集街区）。
const W9_ALLEY_P = 0.56;
// 巷宽 2.2–4.5m：按切缝中点的坐标 hash + 低频场取值，一条巷一个宽度，不再全城统一 1.7m
const W9_ALLEY: [number, number] = [2.2, 4.5];
const W9_PARTY = 0.4;
const W9_DEAD: [number, number] = [0.15, 0.25]; // 断头巷比例
// ---- 院落三档（4:4:2，坐标 hash 取档，不按遍历顺序）----
// 小院正面宽 6–8m（独户 / 柴院）；中院 9.5–13.5m；大院 17–23m（长向正房，含前后院总进深 20m+）。
// 旧版全域 5.5–14m 一条带，落差不足；三档把「一间灶房」与「三进大宅」放进同一条巷子。
const W9_SIZE_P: [number, number] = [0.40, 0.80]; // hash<0.4 小 / <0.8 中 / 其余大 = 40:40:20
const W9_SIZE: { w: [number, number]; d: [number, number]; h: [number, number]; wing: number; ww: [number, number] }[] = [
  { w: [6.0, 8.0], d: [4.4, 5.8], h: [2.8, 4.2], wing: 0.28, ww: [2.0, 3.0] },
  { w: [9.5, 13.5], d: [5.6, 7.6], h: [3.4, 5.4], wing: 0.78, ww: [2.4, 4.2] },
  { w: [17.0, 23.0], d: [6.8, 9.2], h: [4.4, 6.6], wing: 1.0, ww: [2.6, 3.6] },
];
const W9_YAW = 45 * Math.PI / 180;     // 主屋朝向 = 本地块主轴 ±45°（原 ±14° 太窄，同排屋脊几乎平行）
const W9_YAW_FIELD = 10 * Math.PI / 180; // 低频场再给 ±10°：同排屋脊不再平行
const W9_WING_A = 45 * Math.PI / 180;  // 厢房与主屋成 90°±45°
const W9_WALL_H: [number, number] = [0.9, 2.2];
// 院落整体漂移的幅值区间（m）：方向与幅值各取一个低频场（极坐标），所以请求的偏移量
// 一定落在 1.5–3.0m，而不是「两个 0 均值分量相加」那种大半小于 1m 的分布。
// 实际落位仍按地块余量收口（大院只剩 0.5m 余量时就只能挪 0.5m）。
const W9_DRIFT: [number, number] = [1.5, 3.0];
// 低频场：主倍频 46m（跨两三个院落）、副倍频 127m（跨半条巷），smoothstep 双线性
const W9_FIELD_CELL: [number, number] = [46, 127];
// 空院（菜畦/柴堆/水井/空地）：显式抽 1–3%，另有小到放不下正房的地块也归空院。
// 旧版 2–5% + 宽巷挤窄的边角地，实测合计 18%，俯视是一片片黄土；这里收一档保住密度。
const W9_VACANT: [number, number] = [0.01, 0.03];
const W9_INSET = 1.4;                  // 坊墙内侧到第一块地的散水宽

// ---------- 2D 多边形工具：地块全是凸多边形，二分即半平面裁剪，无三角剖分 ----------
type V2 = { x: number; z: number };
type Poly = V2[];

/** 有向面积 ×2（正 = 逆时针） */
function area2(p: Poly): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i], r = p[(i + 1) % n];
    a += q.x * r.z - r.x * q.z;
  }
  return a * 0.5;
}
function polyArea(p: Poly): number { return Math.abs(area2(p)); }

function polyCentre(p: Poly): V2 {
  const a = area2(p);
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sz = 0;
    for (const q of p) { sx += q.x; sz += q.z; }
    return { x: sx / Math.max(1, p.length), z: sz / Math.max(1, p.length) };
  }
  let cx = 0, cz = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i], r = p[(i + 1) % n];
    const cr = q.x * r.z - r.x * q.z;
    cx += (q.x + r.x) * cr;
    cz += (q.z + r.z) * cr;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

/** 半平面裁剪：保留 n·(p−o) ≥ off 的一侧；凸多边形裁完仍是凸多边形 */
function clipHalf(p: Poly, nx: number, nz: number, ox: number, oz: number, off: number): Poly {
  const out: Poly = [];
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const da = nx * (a.x - ox) + nz * (a.z - oz) - off;
    const db = nx * (b.x - ox) + nz * (b.z - oz) - off;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** 直线 n·p = off 与凸多边形的交弦（= 这条巷的中线两端）；退化返回 null */
function chordOf(p: Poly, nx: number, nz: number, off: number): [V2, V2] | null {
  const pts: V2[] = [];
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const da = nx * a.x + nz * a.z - off, db = nx * b.x + nz * b.z - off;
    if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
      const t = da === db ? 0 : da / (da - db);
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  if (pts.length < 2) return null;
  const dx = -nz, dz = nx;
  let lo = 0, hi = 0, tlo = Infinity, thi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i].x * dx + pts[i].z * dz;
    if (t < tlo) { tlo = t; lo = i; }
    if (t > thi) { thi = t; hi = i; }
  }
  if (hi === lo || thi - tlo < 1.5) return null;
  return [pts[lo], pts[hi]];
}

/** 最长边方向 = 地块的「主轴」 */
function edgeDir(p: Poly): number {
  let best = 0, len = -1;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const l = (b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z);
    if (l > len) { len = l; best = Math.atan2(b.z - a.z, b.x - a.x); }
  }
  return best;
}

/** 凸多边形内含判定（顶点同向） */
function inside(p: Poly, x: number, z: number): boolean {
  const s = area2(p) >= 0 ? 1 : -1;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    if (((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) * s < 0) return false;
  }
  return true;
}

/** yaw 朝向的 w×d 矩形是否整体落在地块内（四角各留 6cm，防共墙穿插） */
function fitRect(p: Poly, x: number, z: number, w: number, d: number, yaw: number): boolean {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const hu = w / 2 - 0.06, hv = d / 2 - 0.06;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    if (!inside(p, x + su * hu * ca + sv * hv * sa, z - su * hu * sa + sv * hv * ca)) return false;
  }
  return true;
}

/**
 * 矩形到地块边界的净距（m）：凸多边形 → 对每条边的内法线取「四角到该边的最短有向距离」。
 * 出檐上限就取它：屋面外扩量 ≤ 净距 ⇒ 屋面永远不越出地块 ⇒ 相邻两院的屋面在平面上不可能相交
 * （相邻地块以分界线相邻，各自屋面都留在自己一侧）。
 */
function edgeClearance(p: Poly, x: number, z: number, w: number, d: number, yaw: number): number {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let best = Infinity;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const ex = b.x - a.x, ez = b.z - a.z;
    const el = Math.hypot(ex, ez) || 1;
    let nx = -ez / el, nz = ex / el;
    if (nx * (x - a.x) + nz * (z - a.z) < 0) { nx = -nx; nz = -nz; }
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const u = su * w / 2, v = sv * d / 2;
      const dist = nx * (x + u * c + v * s - a.x) + nz * (z - u * s + v * c - a.z);
      if (dist < best) best = dist;
    }
  }
  return Math.max(0, best);
}

/**
 * RNG 排空（不可删）：下游 buildPavement / buildTrees / buildStalls / buildLanterns 与本类共用一个 rng，
 * 依赖的是**调用序列**而不是分布。旧版 100 坊在 13m 格点上逐点抽 3 或 9 个随机数
 * （2 次位置抖动 + 1 次空院判定 + 3 次尺寸 + 1 次朝向 + 2 次配色），这里按同样的顺序与分支重放一遍、
 * 结果全部丢弃，把 rng 推到与旧版完全相同的位置。新布局全部走坐标 hash，不再消耗 rng。
 * 改动下面的格距 / 概率会让下游铺装、树木、摊位整体漂移，勿动。
 */
function drainLegacyRng(rng: RNG, cells: WardCell[], reserved: (x: number, z: number) => boolean): void {
  for (const cell of cells) {
    const span = cell.half * 2 - 24;
    const rows = Math.floor(span / PITCH);
    for (let gx = 0; gx <= rows; gx++) for (let gz = 0; gz <= rows; gz++) {
      const x = cell.cx - cell.half + 12 + gx * PITCH + rng.range(-6, 6);
      const z = cell.cz - cell.half + 12 + gz * PITCH + rng.range(-6, 6);
      if (reserved(x, z)) continue;
      if (rng.chance(0.18)) continue;
      rng.range(11, 18); rng.range(9, 15); rng.range(4.0, 6.5);
      rng.range(0, Math.PI * 2);
      rng.pick(BODY_COLORS); rng.pick(ROOF_COLORS);
    }
  }
}

// ---------- W9 数据结构：地块 → 院 → 构件，全部纯数据（不含 THREE），便于离线机检 ----------
interface W9Wall {
  x: number; z: number; w: number; d: number; h: number; yaw: number;
  /** 厢房/倒座相对院心的方位（+1 = 局部 +u 一侧）。单坡厦子据此把坡向院内；
   *  缺省 = 不做厦子（倒座与后罩房保持两坡） */
  shedSide?: number;
}
interface W9Prop extends W9Wall { c: number; o: number }
interface W9Gate { x: number; z: number; w: number; d: number; yaw: number }
interface W9Yard {
  poly: Poly; c: V2; area: number;
  /** 地块长向净跨度（m）：三档院落（小 6–8 / 中 / 大 20+）按它分类 */
  span: number;
  main: boolean; hx: number; hz: number; hw: number; hd: number; hh: number; yaw: number;
  /** 正房出檐上限（m，= 到地块边界净距），见 edgeClearance */
  eo: number;
  wings: W9Wall[]; walls: W9Wall[]; gates: W9Gate[]; props: W9Prop[];
  foot: number; bc: number; rc: number; wc: number;
  /** 商铺行业下标（SHOPS），-1 = 民居；W25 起沿巷地块 18–25% 出店铺 */
  shop: number;
  /** 商铺正面是否翻 180°（朝向最近的巷）；翻 π 不改变 |cos yaw|，去规整判据不受影响 */
  shopFlip?: boolean;
}
interface W9Alley { x0: number; z0: number; x1: number; z1: number; w: number; depth: number; dead: boolean }
interface W9Block { x: number; z: number; w: number; d: number; yaw: number }
interface W9Plan {
  ring: Poly; corner: V2[];
  yards: W9Yard[]; alleys: W9Alley[]; blocks: W9Block[];
  lotArea: number; partyArea: number; span: number;
}

/**
 * 坊界折线：四角各 ±18m 抖动，每边 3–5 个控制点沿外法线轻微外凸（≤3.3m）/内凹（≤1.2m）。
 * 返回折线 + 四个角点（角点四边形永远是凸的，二分地块用它做根，避免非凸裁剪）。
 * W25 起不再产出坊门位——院墙是断续段落，门开在段中间，不落在坊界上。
 */
function wardRing(cell: WardCell, h: (k: number) => number, jit: number, nodes: [number, number]): {
  ring: Poly; corner: V2[];
} {
  const corner: V2[] = [
    { x: cell.cx - cell.half + (h(1) - 0.5) * 2 * jit, z: cell.cz - cell.half + (h(2) - 0.5) * 2 * jit },
    { x: cell.cx + cell.half + (h(3) - 0.5) * 2 * jit, z: cell.cz - cell.half + (h(4) - 0.5) * 2 * jit },
    { x: cell.cx + cell.half + (h(5) - 0.5) * 2 * jit, z: cell.cz + cell.half + (h(6) - 0.5) * 2 * jit },
    { x: cell.cx - cell.half + (h(7) - 0.5) * 2 * jit, z: cell.cz + cell.half + (h(8) - 0.5) * 2 * jit },
  ];
  const ring: Poly = [];
  for (let e = 0; e < 4; e++) {
    const a = corner[e], b = corner[(e + 1) % 4];
    const ex = b.x - a.x, ez = b.z - a.z;
    const el = Math.hypot(ex, ez) || 1;
    let nx = -ez / el, nz = ex / el;
    if (nx * (a.x - cell.cx) + nz * (a.z - cell.cz) < 0) { nx = -nx; nz = -nz; } // 外法线
    const n = nodes[0] + Math.floor(h(20 + e) * (nodes[1] - nodes[0] + 1));
    ring.push(a);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      // 外凸为主（0..1），偶发小幅内凹（-0.35），保证边线是「略弯」而不是锯齿
      const bow = (h(40 + e * 9 + k) * 1.35 - 0.35) * W9_BOW * 1.2;
      ring.push({ x: a.x + ex * t + nx * bow, z: a.z + ez * t + nz * bow });
    }
  }
  return { ring, corner };
}

/** 地块的包围盒（沿给定标准方向角）→ 远档体块尺寸 */
function blockOf(p: Poly, axis: number, c: V2): W9Block {
  const ca = Math.cos(axis), sa = Math.sin(axis);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const q of p) {
    const dx = q.x - c.x, dz = q.z - c.z;
    const u = dx * ca + dz * sa, v = -dx * sa + dz * ca;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  return { x: c.x, z: c.z, w: u1 - u0, d: v1 - v0, yaw: -axis };
}

/**
 * 商户行业（W25）：衣食住用行 + 娱乐游玩，共 17 类。
 * 行业**全部由坐标 hash 分派**（不消耗共享 rng），色板即幌子色；big=true 的是大跨度棚屋（瓦舍/勾栏/傀儡棚）。
 * 下标写进 W9Yard.shop，emitFill 据此决定敞门脸 / 苇席棚。
 */
interface ShopKind { n: string; c: number; big: boolean }
const SHOPS: ShopKind[] = [
  { n: '米鋪', c: 0xd9cdb0, big: false },
  { n: '麵館', c: 0xdcbf8a, big: false },
  { n: '茶坊', c: 0x7fa88a, big: false },
  { n: '酒肆', c: 0xc25a42, big: false },
  { n: '藥鋪', c: 0xb08a4a, big: false },
  { n: '布莊', c: 0x7d96b4, big: false },
  { n: '成衣', c: 0xc090a8, big: false },
  { n: '鐵匠', c: 0x8a9098, big: false },
  { n: '木器', c: 0xa8824c, big: false },
  { n: '香燭', c: 0xd2a24a, big: false },
  { n: '當鋪', c: 0x8c6a3a, big: false },
  { n: '腳店', c: 0xb87a4a, big: false },
  { n: '瓦舍', c: 0xa89a6a, big: true },
  { n: '勾欄', c: 0x9c8f7a, big: true },
  { n: '傀儡棚', c: 0x8f9a7c, big: true },
  { n: '書坊', c: 0x93a6c2, big: false },
  { n: '糕餅', c: 0xd8b87a, big: false },
];

// 树：叶色按 SPEC（0x3f6a3c / 0x4a7a44），松柏压暗一档、垂柳提亮一档
const LEAF_A = 0x3f6a3c;
const LEAF_B = 0x4a7a44;
const LEAF_C = 0x35593a; // 松柏
const LEAF_W = 0x4b7f46; // 垂柳
const BARK = 0x4a3626;
/**
 * 单个地块 → 一个院：三档按地块中心坐标 hash 取（40:40:20），主屋面阔随档 6–8 / 9.5–13.5 / 17–23m。
 * 朝向 = 主轴 ±14° + 低频场 ±10°；院心沿长/短向漂移 ±3/±2m；同档尺寸再乘 0.90–1.10 的场。
 * 厢房随档 0–1 / 1–2 / 2 间（与主屋 90°±20°），沿地块边 1–3 面院墙（留 1–2 个院门缺口）。
 * 空院（菜畦 / 柴堆 / 水井 / 空地）1–3%；房屋一律用 fitRect 校验四角在地块内，绝不跨出地块。
 * shop ≥ 0 时改出商铺形制：面阔同档取（大棚瓦舍 8–14m）、不放厢房、正面敞开门脸。
 */
function layoutYard(poly: Poly, c: V2, area: number, q: (j: number) => number, rcOverride?: number, shop = -1, bcOverride?: number): W9Yard {
  // 墙色：坊级底色（同坊同族）+ 逐户按坐标 hash 抖 ±8% —— 坊与坊拉得开，坊内不花
  const bc = shade(bcOverride ?? BODY_COLORS[Math.floor(q(1) * BODY_COLORS.length)],
    0.92 + 0.16 * h01(Math.round(c.x), Math.round(c.z), 9901));
  // 屋顶色按「坊」定档（rcOverride）：同坊同色、坊间拉开，整座城才不会是一片同色调
  const rc = rcOverride ?? ROOF_COLORS[Math.floor(q(2) * ROOF_COLORS.length)];
  const wc = shade(0xa98a5e, 0.86 + q(3) * 0.2);
  const isShop = shop >= 0;
  const big = isShop && SHOPS[shop].big;
  const proj = (a: number): [number, number] => {
    const ca = Math.cos(a), sa = Math.sin(a);
    let lo = Infinity, hi = -Infinity;
    for (const p of poly) {
      const u = (p.x - c.x) * ca - (p.z - c.z) * sa;
      if (u < lo) lo = u;
      if (u > hi) hi = u;
    }
    return [lo, hi];
  };
  // 三档院落由地块中心的坐标 hash 取档（40:40:20），与遍历顺序、共享 rng 无关；
  // 同一条巷两侧因此经常一小一大相邻。商铺也按同一档位取面阔，只是不放厢房。
  const sizeHash = h01(Math.round(c.x), Math.round(c.z), 9900);
  const cls = sizeHash < W9_SIZE_P[0] ? 0 : sizeHash < W9_SIZE_P[1] ? 1 : 2;
  const size = W9_SIZE[cls];
  // 同档内部再 ±10%：相邻两院不会因为同档就一样大（大院的 ±10% 已是 2m 级）
  const vary = 0.90 + 0.20 * (0.5 + 0.5 * fieldN(c.x, c.z, 9760));
  // 朝向 = 地块主轴 ±45° + 低频场 ±10°：同排屋脊不再平行。
  // base 保留「不带场」的朝向，axisT 是不带任何抖动的纯地块主轴——两级兜底，
  // 大角度抖动把四角顶出界时可逐级退回，房子不会因为朝向抖而消失。
  const axisRaw = -edgeDir(poly);
  let axisT = axisRaw;
  const yawBase = -(edgeDir(poly) + (q(4) - 0.5) * 2 * W9_YAW);
  let yaw = yawBase - W9_YAW_FIELD * fieldN(c.x, c.z, 9750);
  let base = yawBase;
  let [u0, u1] = proj(yaw);
  let [v0, v1] = proj(yaw + Math.PI / 2);
  let hu = Math.min(-u0, u1), hv = Math.min(-v0, v1);
  if (hu < hv) { yaw += Math.PI / 2; base += Math.PI / 2; axisT += Math.PI / 2; const t = hu; hu = hv; hv = t; }
  // 正交偏转：近方形地块里，另一半宅子改用与地块主轴正交的朝向 —— 同一坊里因此有两族朝向，
  // 不再是「全坊屋脊跟着同一条主轴排队」。只在近方形地块上做，长条地块转 90° 会放不下正房。
  if (Math.min(hu, hv) >= 0.72 * Math.max(hu, hv) && q(52) < 0.5) {
    yaw += Math.PI / 2; base += Math.PI / 2; axisT += Math.PI / 2;
    const t = hu; hu = hv; hv = t;
  }

  // ---- 主屋：小院 6–8m / 中院 9.5–13.5m / 大院 17–23m（长向面阔）----
  // 商铺同档取面阔（大棚瓦舍仍走 8–14m），三档比例因此不会被店面稀释。
  const shopW: [number, number] = cls === 0 ? [5.0, 7.0] : cls === 1 ? [6.5, 11.0] : [12.0, 18.0];
  const shopD: [number, number] = cls === 0 ? [4.0, 5.2] : cls === 1 ? [4.4, 6.2] : [5.4, 7.2];
  // 最小可建面（m）：小院 5.4×4.0 也要放得下，边角窄条才不会整片变空院
  const canHouse = isShop ? (hu * 2 >= 4.8 && hv * 2 >= 4.2) : (hu * 2 >= 5.6 && hv * 2 >= 4.4);
  const vacant = isShop ? !canHouse : (!canHouse || q(5) < W9_VACANT[0] + (W9_VACANT[1] - W9_VACANT[0]) * q(6));
  let hw = isShop
    ? Math.min(big ? 8 + 6 * q(7) : shopW[0] + (shopW[1] - shopW[0]) * q(7), hu * 2 - 0.8)
    : Math.min((size.w[0] + (size.w[1] - size.w[0]) * q(7)) * vary, hu * 2 - 0.8);
  let hd = isShop
    ? Math.min(big ? 6.2 + 2.4 * q(8) : shopD[0] + (shopD[1] - shopD[0]) * q(8), hv * 2 - 0.8)
    : Math.min((size.d[0] + (size.d[1] - size.d[0]) * q(8)) * vary, hv * 2 - 0.8);
  let main = false, hx = c.x, hz = c.z, hh = 0, mainV = 0;
  // 低频漂移（极坐标）：方向 = 一个场，幅值 = 另一个场在 1.5–3.0m 内取值。
  // 再按地块余量收口——院子被推离原地块中心，相邻院落不再共线，也绝不越出地块（fitRect 兜底）。
  // 细抖 ≤0.4m 只用来打散同相位的两院，不会把连续场抵消成随机抖动。
  const su = Math.max(0, hu * 2 - hw - 0.8);
  const sv = Math.max(0, hv * 2 - hd - 0.8);
  const driftAng = Math.PI * 2 * (0.5 + 0.5 * fieldN(c.x, c.z, 9720));
  const driftMag = W9_DRIFT[0] + (W9_DRIFT[1] - W9_DRIFT[0]) * (0.5 + 0.5 * fieldN(c.x, c.z, 9721));
  const driftU = Math.max(-su / 2, Math.min(su / 2,
    Math.cos(driftAng) * driftMag + (q(9) - 0.5) * Math.min(0.5, su * 0.15)));
  const driftV = Math.max(-sv / 2, Math.min(sv / 2,
    Math.sin(driftAng) * driftMag + (q(10) - 0.5) * Math.min(0.4, sv * 0.15)));
  if (!vacant && hw >= (isShop ? 4.3 : 5.4) && hd >= (isShop ? 3.8 : 4.0)) {
    // 大宅（>330㎡）走三进院形制：正房居中，前倒座后罩房各一座，几何上不会与正房穿插
    const tries: [number, number][] = (area > 330 && !isShop)
      ? [[driftU, 0], [0, 0], [driftU * 0.5, 0], [0, hv * 0.25], [0, -hv * 0.25]]
      : cls === 2
        ? [[driftU, driftV], [driftU, hv * 0.3], [driftU, -hv * 0.3], [0, hv * 0.2], [0, -hv * 0.2], [0, 0]]
        : [[driftU, driftV], [driftU, 0], [0, driftV], [0, 0]];
    // 大院在窄条地块里常因「朝向场」多转 10° 而四角出界：退回不带场的 base 再试一轮。
    // 尺寸阶梯也对大院特化：优先保 17–23m 面阔，只把进深一档档收（1 → 0.86 → 0.74），
    // 而不是等比缩到 0.68 变成中院；等比缩只留最后一档兜底。
    const dims: [number, number][] = isShop
      ? [[1, 1], [0.9, 0.9], [0.79, 0.79], [0.68, 0.68]]
      : cls === 2
        ? [[1, 1], [1, 0.86], [1, 0.74], [0.92, 0.88], [0.84, 0.78], [0.76, 0.72], [0.68, 0.68]]
        : [[1, 1], [0.9, 0.9], [0.79, 0.79], [0.68, 0.68]];
    // 大院额外试 base±8°：窄梯形地块的「最长边方向」未必是能塞下 17m 正房的方向。
    // 小/中院也试 base（不带朝向场）：±45° 抖在大地块上常把四角顶出界，退一步保住房子。
    const yawTry = 8 * Math.PI / 180;
    const yaws = isShop ? [yaw] : cls === 2 ? [yaw, base, axisT, base + yawTry, base - yawTry] : [yaw, base, axisT];
    outer: for (const yy of yaws) {
      const ca = Math.cos(yy), sa = Math.sin(yy);
      for (const [fw, fd] of dims) {
        for (const [du, dv] of tries) {
          const w = hw * fw, d = hd * fd;
          if (w < (isShop ? 4.3 : 5.4) || d < (isShop ? 3.8 : 4.0)) continue;
          const x = c.x + du * ca + dv * sa;
          const z = c.z - du * sa + dv * ca;
          if (!fitRect(poly, x, z, w, d, yy)) continue;
          hx = x; hz = z; hw = w; hd = d; main = true; mainV = dv; yaw = yy;
          hh = isShop ? 2.9 + 0.9 * q(11) : size.h[0] + (size.h[1] - size.h[0]) * q(11);
          break outer;
        }
      }
    }
  }

  // ---- 厢房：小院 0–1 间（宽 2.0–3.0m）/ 中院 1–2 间 / 大院 2 间（放不下由 fitRect 拒收）----
  const wings: W9Wall[] = [];
  if (main && !isShop) {
    const r = q(12);
    // 档位表里的 wing = 「有厢房」的概率：小院 28% 出 1 间、中院 78% 出 2 间（否则 1 间）、大院固定 2 间
    const nw = cls === 2 ? 2 : cls === 0 ? (r < 1 - size.wing ? 0 : 1) : (r < 1 - size.wing ? 1 : 2);
    let side = q(13) < 0.5 ? -1 : 1;
    for (let i = 0; i < nw; i++) {
      const ww = size.ww[0] + (size.ww[1] - size.ww[0]) * q(14 + i * 5);
      const wd = Math.min(cls === 2 ? 9.5 : 6.6, Math.max(2.8, hd * (0.62 + 0.48 * q(15 + i * 5))));
      const wy = yaw + side * (Math.PI / 2) + (q(16 + i * 5) - 0.5) * 2 * W9_WING_A;
      const offU = side * (hw / 2 + ww / 2 + 0.25);
      const offV = (q(17 + i * 5) - 0.4) * hd * 0.6;
      const wx = c.x + offU * Math.cos(yaw) + offV * Math.sin(yaw);
      const wz = c.z - offU * Math.sin(yaw) + offV * Math.cos(yaw);
      if (fitRect(poly, wx, wz, ww, wd, wy)) {
        wings.push({ x: wx, z: wz, w: ww, d: wd, h: 2.4 + 0.7 * q(18 + i * 5), yaw: wy, shedSide: side });
      }
      side = -side;
    }
    // 中院 / 大院再补一座倒座（临巷那一排，正脊与正房平行）——四合院形制，与「厢房」不冲突。
    // 小院（cls 0）不再补：否则 6–8m 的独户院里会多出一排 8–11m 的房子，三档就混了。
    if (cls >= 1 && area > 235 && (area > 330 || q(41) < 0.5)) {
      const sw = 8.0 + 3.5 * q(42);
      const sd2 = 3.4 + 1.0 * q(43);
      const sgn = mainV >= 0 ? -1 : 1;   // 摆到主屋反侧，避免与正房穿插；大宅正房居中，倒座固定在前
      const ov = (area > 330 ? -1 : sgn) * hv * (area > 330 ? 0.66 : 0.55);
      const sx = c.x + ov * Math.sin(yaw);
      const sz = c.z + ov * Math.cos(yaw);
      if (fitRect(poly, sx, sz, sw, sd2, yaw)) {
        wings.push({ x: sx, z: sz, w: sd2, d: sw, h: 2.8 + 0.5 * q(44), yaw: yaw + Math.PI / 2 });
      }
    }
    // 大院再来一座后罩房（正房之后的服务性用房），院落总占地因此跨过 200㎡ 这一档
    if (cls === 2 && area > 350 && (area > 330 || q(45) < 0.45)) {
      const rw = 6.0 + 3.0 * q(46);
      const rd2 = 4.4 + 1.2 * q(47);
      const ov = (area > 330 ? 1 : mainV >= 0 ? -1 : 1) * hv * (area > 330 ? 0.66 : 0.80);
      const rx2 = c.x + ov * Math.sin(yaw);
      const rz2 = c.z + ov * Math.cos(yaw);
      if (fitRect(poly, rx2, rz2, rw, rd2, yaw)) {
        wings.push({ x: rx2, z: rz2, w: rd2, d: rw, h: 2.7 + 0.5 * q(48), yaw: yaw + Math.PI / 2 });
      }
    }
  }

  // ---- 院墙 0.9–2.2m：沿地块边 1–3 面，墙上留 1–2 个 1.5–2.5m 的院门缺口 ----
  const walls: W9Wall[] = [];
  const gates: W9Gate[] = [];
  const n = poly.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  const nWall = 1 + Math.floor(q(20) * 3);
  for (let i = 0; i < nWall && order.length; i++) {
    const ei = order.splice(Math.floor(q(21 + i) * order.length), 1)[0];
    const a = poly[ei], b = poly[(ei + 1) % n];
    const ex = b.x - a.x, ez = b.z - a.z;
    const L = Math.hypot(ex, ez);
    if (L < 3.4) continue;
    const yawW = -Math.atan2(ez, ex);
    const wh = W9_WALL_H[0] + (W9_WALL_H[1] - W9_WALL_H[0]) * q(30 + i * 4);
    let nx = -ez / L, nz = ex / L;
    if (nx * (c.x - a.x) + nz * (c.z - a.z) < 0) { nx = -nx; nz = -nz; }
    const ox = a.x + nx * 0.2, oz = a.z + nz * 0.2;
    const put = (s0: number, s1: number): void => {
      const l = s1 - s0;
      if (l < 0.9) return;
      const m = (s0 + s1) / 2;
      walls.push({ x: ox + (ex / L) * m, z: oz + (ez / L) * m, w: l, d: 0.36, h: wh, yaw: yawW });
    };
    if (L > 5.4 && gates.length < 2 && q(31 + i * 4) < 0.78) {
      const gw = WARD_DOOR[0] + (WARD_DOOR[1] - WARD_DOOR[0]) * q(32 + i * 4); // 院门 1.8–2.6m
      const s = (0.24 + 0.52 * q(33 + i * 4)) * L;
      if (s - gw / 2 > 1.1) put(0, s - gw / 2);
      if (s + gw / 2 < L - 1.1) put(s + gw / 2, L);
      gates.push({ x: ox + (ex / L) * s, z: oz + (ez / L) * s, w: gw + 0.7, d: 1.0, yaw: yawW });
    } else {
      put(0, L);
    }
  }

  // ---- 无房地块：菜畦 / 柴堆 / 水井 / 空地 ----
  const props: W9Prop[] = [];
  if (!main) {
    const kind = q(40);
    if (kind < 0.42) {
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 1.7;
        props.push({
          x: c.x + off * Math.sin(yaw), z: c.z + off * Math.cos(yaw),
          w: Math.max(2.4, hu * 1.8), d: 0.9, h: 0.26, yaw, c: 0x5d6b33, o: 0,
        });
      }
    } else if (kind < 0.72) {
      props.push({ x: c.x, z: c.z, w: 1.8, d: 1.3, h: 0.9, yaw, c: 0x6a4c2e, o: 0 });
      props.push({ x: c.x + 0.6 * Math.sin(yaw), z: c.z + 0.6 * Math.cos(yaw), w: 1.3, d: 0.95, h: 0.7, yaw: yaw + 0.4, c: 0x5a4028, o: 0 });
    } else if (kind < 0.9) {
      props.push({ x: c.x, z: c.z, w: 1.6, d: 1.6, h: 0.52, yaw, c: 0x8a8478, o: 0 });
      props.push({ x: c.x, z: c.z, w: 1.15, d: 1.15, h: 0.1, yaw, c: 0x2b3238, o: 0.5 });
    }
  }

  // 出檐上限：正房到地块边界的净距（不设下限 —— 任何下限都会让屋面越出地块，
  // 相邻两院就可能互相插进对方屋顶；贴着界线的宅子就只出一点点檐）
  const eo = main ? Math.min(ROOF_EAVE_OUT, edgeClearance(poly, hx, hz, hw, hd, yaw)) : 0;
  let foot = 0;
  if (main) foot += hw * hd;
  for (const w of wings) foot += w.w * w.d;
  return { poly, c, area, span: hu * 2, main, hx, hz, hw, hd, hh, yaw, eo, wings, walls, gates, props, foot, bc, rc, wc, shop: main ? shop : -1 };
}

/**
 * 一个坊的地块规划：坊界折线 → 角点四边形内缩 → 抖动二分 → 每块一个院。
 * 二分规则：切线 = 父地块主轴 + 90° + 0–25° 随机偏转 + 低频场 ±42°（相对父轴 25°–155°）；
 * 切分比 0.30–0.70，再叠 ±0.08 的场偏移（相邻切缝不再等距）；
 * 递归到面积 < 260–420㎡（每块现抽，10% 抽 22–64㎡）或地块深度 ≥5 层（深度从跌进 4200㎡ 那层起计）。
 * 相邻地块之间的缝就是巷：56% 留 2.2–4.5m（按切缝中点坐标 hash + 低频场取宽），其余 0.4m 共墙；
 * 15–25% 的巷一端封死。
 */
/**
 * 远档体块的保留带判定。块尺度实测 68–126m（宫城北侧那一片就是这个尺寸），
 * 只在地块中心判 reserved 会让整片宫城/河道保留带被巨型体块盖住——
 * 用户看到的"几十米棱柱碎块铺满一地"就是它。取中心 + 四角 + 四边中点 9 点，任一点落在保留带即丢弃。
 */
function blockReserved(p: Poly, c: V2, reserved: (x: number, z: number) => boolean): boolean {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of p) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.z < z0) z0 = q.z;
    if (q.z > z1) z1 = q.z;
  }
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const pts: [number, number][] = [
    [c.x, c.z], [x0, z0], [x1, z0], [x0, z1], [x1, z1],
    [mx, z0], [mx, z1], [x0, mz], [x1, mz],
  ];
  for (const [x, z] of pts) if (reserved(x, z)) return true;
  return false;
}

function planRegion(
  root: Poly, axis0: number, h: (k: number) => number,
  reserved: (x: number, z: number) => boolean, wantYards: boolean, wardRoof?: number, wantShops = true, wardBody?: number,
  lotScale = 1, lotTail = false,
): { yards: W9Yard[]; alleys: W9Alley[]; blocks: W9Block[]; lotArea: number; partyArea: number } {
  const lots: { poly: Poly; c: V2; area: number }[] = [];
  const alleys: W9Alley[] = [];
  const blocks: W9Block[] = [];
  let partyArea = 0;
  const stack: { poly: Poly; c: V2; area: number; axis: number; depth: number }[] = [];
  const rootC = polyCentre(root);
  stack.push({ poly: root, c: rootC, area: polyArea(root), axis: axis0, depth: 0 });
  let k = 200;
  let guard = 0;
  while (stack.length && guard++ < 9000) {
    const nd = stack.pop()!;
    const p = nd.poly;
    // 停切面积：近景沿用旧口径（均匀 260–420 + 10% 抽 22–64）；
    // 远景走密度场 + 几何长尾（成片的小院 / 大宅），再叠 ±16% 细抖与 LOD 放大系数。
    let target: number;
    if (lotTail) {
      const dens = Math.max(0, Math.min(1, 0.5 + 1.5 * fieldN(nd.c.x, nd.c.z, 9410)));
      target = W9_LOT_TAIL[0] * Math.pow(W9_LOT_TAIL[1] / W9_LOT_TAIL[0], dens)
        * (1 - W9_LOT_JIT + 2 * W9_LOT_JIT * h(k++)) * lotScale;
    } else {
      const small = h(k++) < 0.1;
      target = (small ? 22 + 42 * h(k++) : W9_LOT[0] + (W9_LOT[1] - W9_LOT[0]) * Math.pow(h(k++), 0.2)) * lotScale;
    }
    if (p.length < 3 || nd.area < target || nd.depth >= (lotTail ? W9_DEPTH : W9_DEPTH_NEAR)) { lots.push({ poly: p, c: nd.c, area: nd.area }); continue; }
    // 切线方向：父主轴 + 90° + 随机偏转 0–25°（保留），再叠低频场 ±42°。
    // 旧版只取「垂直父轴 ±25°」，全坊的切缝永久锁在两族正交方向上，地块与巷道排成十字格；
    // 连续场让切线相对父轴可偏 25°–155°，相邻地块不再共享同一族方向。
    const jitter = (0.06 + 0.94 * h(k++)) * W9_CUT * (h(k++) < 0.5 ? -1 : 1);
    const cut = nd.axis + Math.PI / 2 + jitter + W9_CUT_FIELD * fieldN(nd.c.x, nd.c.z, 9300);
    const nx = -Math.sin(cut), nz = Math.cos(cut);
    let lo = Infinity, hi = -Infinity;
    for (const q of p) {
      const t = nx * q.x + nz * q.z;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    const span = hi - lo;
    if (span < 3.2) { lots.push({ poly: p, c: nd.c, area: nd.area }); continue; }
    // 切缝位置：比例 hash + 连续场偏移（±0.08），相邻切缝的间距因此不再等分
    const ratio = W9_RATIO[0] + (W9_RATIO[1] - W9_RATIO[0]) * h(k++)
      + W9_RATIO_FIELD * fieldN(nd.c.x, nd.c.z, 9400);
    const off = lo + span * Math.max(0.08, Math.min(0.92, ratio));
    // 巷道判定（成对合院方案实测对最近邻 CV 无贡献，已撤，只留这条）
    const alley = h(k++) < W9_ALLEY_P;
    // 巷宽 2.2–4.5m：以切缝中点坐标为种（低频场定大势 + hash 细抖），一条巷一个宽度；
    // 旧版是「全城 1.7m 夹道 + 偶发 5m 主巷」的二值分布，俯视读成等宽网线。
    let gap = W9_PARTY;
    let ch: [V2, V2] | null = null;
    if (alley) {
      ch = chordOf(p, nx, nz, off);
      const mx = ch ? (ch[0].x + ch[1].x) / 2 : nd.c.x;
      const mz = ch ? (ch[0].z + ch[1].z) / 2 : nd.c.z;
      // 0.58 增益 + 0.15 细抖：场取到两端时能把 2.2 / 4.5 都吃到（旧 0.5 增益实测只到 2.42–4.44）
      const wn = 0.5 + 0.58 * fieldN(mx, mz, 9850) + 0.15 * (h(k++) - 0.5);
      gap = W9_ALLEY[0] + (W9_ALLEY[1] - W9_ALLEY[0]) * Math.max(0, Math.min(1, wn));
    }
    const A = clipHalf(p, nx, nz, 0, 0, off + gap / 2);
    const B = clipHalf(p, -nx, -nz, 0, 0, gap / 2 - off);
    const aA = polyArea(A), aB = polyArea(B);
    if (A.length < 3 || B.length < 3 || aA < 12 || aB < 12) { lots.push({ poly: p, c: nd.c, area: nd.area }); continue; }
    if (alley) {
      if (ch) {
        const dead = h(k++) < W9_DEAD[0] + (W9_DEAD[1] - W9_DEAD[0]) * h(k++);
        alleys.push({ x0: ch[0].x, z0: ch[0].z, x1: ch[1].x, z1: ch[1].z, w: gap, depth: nd.depth, dead });
      }
    } else {
      // 共墙也是建成面：0.4m 共墙面积计入建成覆盖
      const ch2 = chordOf(p, nx, nz, off);
      if (ch2) partyArea += Math.hypot(ch2[1].x - ch2[0].x, ch2[1].z - ch2[0].z) * W9_PARTY;
    }
    const push = (q: Poly, a: number): void => {
      const cc = polyCentre(q);
      // 远档体块：地块刚跌进 W9_BLOCK 尺度的那一层记一颗（tier3 只出这一层）。
      // 必须在这里判 reserved —— 块尺度实测 68–126m（宫城北侧保留带那一片），
      // 只在地块中心判（emitFill 的 reserved(lot.c)）会把宫城/河道保留带整片盖掉：
      // 用户原话「这些是什么？？？」「这些又是什么」指的就是铺满宫城北侧的巨大碎块。
      if (nd.area >= W9_BLOCK && a < W9_BLOCK && !blockReserved(q, cc, reserved)) blocks.push(blockOf(q, cut, cc));
      stack.push({ poly: q, c: cc, area: a, axis: cut, depth: a < W9_BLOCK ? nd.depth + 1 : 0 });
    };
    push(A, aA); push(B, aB);
  }

  // ---- 商铺网点（W25）：巷采样点 / 巷端点各灌一张 40m 网格 ----
  // 只有临巷地块才可能开铺（18–25%），越靠近巷口（alleys 端点）比例越高。
  // 全部走坐标 hash（q），不消耗共享 rng。
  const CELLS = 40;
  const GX = 4096;
  const gkey = (x: number, z: number): number => (Math.floor(x / CELLS) + GX) * 8192 + (Math.floor(z / CELLS) + GX);
  const alleyGrid = new Map<number, number[]>();
  const nodeGrid = new Map<number, number[]>();
  const putPt = (m: Map<number, number[]>, x: number, z: number): void => {
    const kk = gkey(x, z);
    const a = m.get(kk);
    if (a) a.push(x, z); else m.set(kk, [x, z]);
  };
  if (wantYards) {
    for (const al of alleys) {
      const dx = al.x1 - al.x0, dz = al.z1 - al.z0;
      const L = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(L / 8));
      for (let s = 0; s <= n; s++) putPt(alleyGrid, al.x0 + (dx * s) / n, al.z0 + (dz * s) / n);
      putPt(nodeGrid, al.x0, al.z0);
      putPt(nodeGrid, al.x1, al.z1);
    }
  }
  const nearGrid = (m: Map<number, number[]>, x: number, z: number, r: number): number => {
    let best = r;
    const gx = Math.floor(x / CELLS), gz = Math.floor(z / CELLS);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const a = m.get((ix + GX) * 8192 + (iz + GX));
        if (!a) continue;
        for (let s = 0; s < a.length; s += 2) {
          const d = Math.hypot(a[s] - x, a[s + 1] - z);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
  const nearPt = (m: Map<number, number[]>, x: number, z: number, r: number): V2 | null => {
    let best = r * r, bx = 0, bz = 0, hit = false;
    const gx = Math.floor(x / CELLS), gz = Math.floor(z / CELLS);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const a = m.get((ix + GX) * 8192 + (iz + GX));
        if (!a) continue;
        for (let s = 0; s < a.length; s += 2) {
          const d = (a[s] - x) ** 2 + (a[s + 1] - z) ** 2;
          if (d < best) { best = d; bx = a[s]; bz = a[s + 1]; hit = true; }
        }
      }
    }
    return hit ? { x: bx, z: bz } : null;
  };

  const yards: W9Yard[] = [];
  let lotArea = 0;
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    if (reserved(lot.c.x, lot.c.z)) continue;
    // 逐宅让路：坊格半跨可到 420m、大路 800m 间距，必然有坊压进路廊（W10 实测 107/122），
    // 这里按地块包络半径跳过压在路面上的地块，路面才连续（空地自然落在路两侧）。
    if (roadBlocked(lot.c.x, lot.c.z, Math.sqrt(lot.area) * 0.34)) continue;
    lotArea += lot.area;
    if (!wantYards) continue;
    const bi = i;
    const q = (j: number): number => h(8000 + bi * 53 + j);
    let shop = -1;
    if (wantShops && nearGrid(alleyGrid, lot.c.x, lot.c.z, 16) < 16) {
      // 近路口权重 0（55m 外）→ 1（路口上），铺面比例 18–25%
      const jw = 1 - Math.min(1, nearGrid(nodeGrid, lot.c.x, lot.c.z, 55) / 55);
      if (q(9000) < 0.12 + 0.05 * jw) shop = Math.floor(q(9001) * SHOPS.length);
    }
    const yd = layoutYard(lot.poly, lot.c, lot.area, q, wardRoof, shop, wardBody);
    // 店铺正面朝最近的巷：正面法线 (sin yaw, cos yaw) 与「院心→巷点」反向就翻 180°
    if (yd.shop >= 0) {
      const np = nearPt(alleyGrid, yd.c.x, yd.c.z, 30);
      if (np && Math.sin(yd.yaw) * (np.x - yd.c.x) + Math.cos(yd.yaw) * (np.z - yd.c.z) < 0) yd.shopFlip = true;
    }
    yards.push(yd);
  }
  return { yards, alleys, blocks, lotArea, partyArea };
}

/** 一个坊的完整规划：坊界折线 + 地块/巷/院 */
function planWard(cell: WardCell, reserved: (x: number, z: number) => boolean, wantYards: boolean, jit = W9_CORNER, wantShops = true, lotScale = 1, lotTail = false): W9Plan {
  const sa = Math.round(cell.cx), sb = Math.round(cell.cz);
  const h = (k: number): number => h01(sa, sb, 12000 + k);
  // 坊级屋顶色：8 档按坊心 hash 取一档，整坊共用
  const wardRoof = ROOF_COLORS[Math.floor(h(431) * ROOF_COLORS.length)];
  // 坊级墙色：与屋顶同理，同坊一族、坊间拉开；逐户再抖 ±8%（见 layoutYard）
  const wardBody = BODY_COLORS[Math.floor(h(432) * BODY_COLORS.length)];
  const { ring, corner } = wardRing(cell, h, jit, W9_NODE);
  // 地块根 = 角点四边形内缩 W9_INSET（永远凸，半平面裁剪安全）
  let root = corner.slice();
  for (let i = 0; i < 4; i++) {
    const a = corner[i], b = corner[(i + 1) % 4];
    const ang = Math.atan2(b.z - a.z, b.x - a.x);
    let nx = -Math.sin(ang), nz = Math.cos(ang);
    if (nx * (cell.cx - a.x) + nz * (cell.cz - a.z) < 0) { nx = -nx; nz = -nz; }
    root = clipHalf(root, nx, nz, a.x, a.z, W9_INSET);
  }
  const reg = planRegion(root, edgeDir(root), h, reserved, wantYards, wardRoof, wantShops, wardBody, lotScale, lotTail);
  return { ring, corner, yards: reg.yards, alleys: reg.alleys, blocks: reg.blocks, lotArea: reg.lotArea, partyArea: reg.partyArea, span: (cell.half * 2) ** 2 };
}

/**
 * 院墙（W25）：不再是沿坊界围一圈的城墙，而是**断续院墙段落**。
 * 每边：两端各让 3–7m（与邻坊接出 8–20m 的巷道缺口）→ 段长 12–28m → 段间缺口 6–14m（朝巷道）；
 * 约 1/3 的段中开 1.8–2.6m 院门（两侧门柱 + 门楣）。坊门 / 门柱 / 门灯 / 巷口牌整组取消。
 * tier2 同样切段，只是矮一档（1.9m），供 2–2.9km 机位读得出坊格，而不是一张"格子布"。
 */
function wardWall(b: Bucket, plan: W9Plan, tier: number, h: (k: number) => number, reserved: (x: number, z: number) => boolean, owner: number): void {
  const base = b.lift;
  const capC = shade(ROOF_CAP, 0.94 + h(900) * 0.12);
  const wallC = shade(0xac9468, 0.9 + h(901) * 0.16);
  /** 沿 a→b 砌「段 + 缺口」；key 是 hash 基址，hh/th/capH/capD 是墙高/墙厚/压顶厚/压顶出挑 */
  const run = (ax: number, az: number, bx: number, bz: number, key: number, hh: number, th: number, capH: number): void => {
    const ex = bx - ax, ez = bz - az;
    const L = Math.hypot(ex, ez);
    if (L < 10) return;
    const yaw = -Math.atan2(ez, ex);
    const eA = WARD_END[0] + (WARD_END[1] - WARD_END[0]) * h(key + 1);
    const eB = WARD_END[0] + (WARD_END[1] - WARD_END[0]) * h(key + 2);
    const ux = ex / L, uz = ez / L;
    let s = eA;
    for (let i = 0; i < 80 && s < L - eB - 5; i++) {
      const seg = Math.min(WARD_SEG[0] + (WARD_SEG[1] - WARD_SEG[0]) * h(key + 10 + i * 7), L - eB - s);
      if (seg < 6) break;
      const t0 = (s + seg / 2) / L;
      const x = ax + ex * t0, z = az + ez * t0;
      const tone = shade(wallC, 0.93 + 0.14 * h(key + 14 + i * 7));
      if (!reserved(x, z)) {
        const from = obstSnap(b);
        if (seg > 9 && h(key + 11 + i * 7) < 0.34) {
          // 院门：段中开 1.8–2.6m 缺口，两侧砌短墙 + 两根门柱 + 门楣
          const dw = WARD_DOOR[0] + (WARD_DOOR[1] - WARD_DOOR[0]) * h(key + 12 + i * 7);
          const half = Math.max(1.1, (seg - dw) / 2);
          for (const sd of [-1, 1]) {
            const off = sd * (dw / 2 + half / 2);
            const px = x + ux * off, pz = z + uz * off;
            b.walls.push({ x: px, z: pz, w: half, h: hh, d: th, y: base, yaw, c: tone });
            b.slabs.push({ x: px, z: pz, w: half + 0.3, h: capH, d: th + 0.3, y: base + hh, yaw, c: capC });
          }
          for (const sd of [-1, 1]) {
            b.walls.push({ x: x + ux * sd * (dw / 2), z: z + uz * sd * (dw / 2), w: 0.22, h: hh + 0.5, d: 0.22, y: base, yaw, c: 0x6b4426 });
          }
          b.slabs.push({ x, z, w: dw + 1.0, h: 0.3, d: 0.32, y: base + hh + 0.2, yaw, c: capC });
          obstRecord(b, 'gate', x, z, seg, th + 0.3, yaw, base, hh + capH, owner, from);
        } else {
          b.walls.push({ x, z, w: seg, h: hh, d: th, y: base, yaw, c: tone });
          b.slabs.push({ x, z, w: seg + 0.3, h: capH, d: th + 0.3, y: base + hh, yaw, c: capC });
          obstRecord(b, 'wall', x, z, seg, th + 0.3, yaw, base, hh + capH, owner, from);
        }
      }
      s += seg + WARD_GAP[0] + (WARD_GAP[1] - WARD_GAP[0]) * h(key + 13 + i * 7);
    }
  };
  if (tier <= 1) {
    const ring = plan.ring;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      run(a.x, a.z, c.x, c.z, 9100 + i * 40, WARD_H, WARD_T, 0.16);
    }
  } else if (tier === 2) {
    // 2–2.9km：矮院墙段落（1.9m × 0.95m），仍断续——整条边的长箱体正是"格子布"的另一半来源
    for (let i = 0; i < 4; i++) {
      const a = plan.corner[i], c = plan.corner[(i + 1) % 4];
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      if (reserved(mx, mz)) continue;
      run(a.x, a.z, c.x, c.z, 14000 + i * 40, 1.9, 0.95, 0.14);
    }
  }
}

/** 苇席棚顶色（瓦舍大跨度棚屋） */
const MAT_WEAVE = 0x9a8a62;

/**
 * 商铺（W25）：三面墙（背墙 + 两山墙）+ 正面两根檐柱 + 柜台 + 檐下竖幡（fabric 0.8×2.2）。
 * 瓦舍 / 勾栏 / 傀儡棚（SHOPS[].big）改大跨度棚屋：4–6 柱 + 苇席棚顶（fabric），不出曲面瓦顶。
 * 正面法线 = (sin yaw, cos yaw)；planRegion 已按最近的巷点决定是否翻 180°（|cos| 不变，去规整判据不受影响）。
 */
function emitShop(b: Bucket, yd: W9Yard, base: number, h: (k: number) => number): void {
  const kind = SHOPS[yd.shop];
  const yaw = yd.yaw + (yd.shopFlip ? Math.PI : 0);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const at = (u: number, v: number): { x: number; z: number } => ({ x: yd.hx + u * ca + v * sa, z: yd.hz - u * sa + v * ca });
  const w = yd.hw, d = yd.hd, hh = yd.hh;
  const wallC = shade(0x8a8478, 0.9 + 0.16 * h(Math.round(yd.hx) & 63)); // 墙 0x8a8478 档（不落 wall 组自发光）
  const postC = 0x6b4a2c;
  const T = 0.34;
  const back = at(0, -d / 2 + T / 2);
  b.bodies.push({ x: back.x, z: back.z, w, d: T, h: hh, yaw, bc: wallC, rc: yd.rc, tk: 0.4 });
  for (const sd of [-1, 1]) {
    const side = at(sd * (w / 2 - T / 2), 0);
    b.bodies.push({ x: side.x, z: side.z, w: T, d, h: hh, yaw, bc: shade(wallC, 0.96), rc: yd.rc, tk: 0.4 });
  }
  if (!kind.big) {
    // 正面两根檐柱（大棚由 4–6 根棚柱承担，避免前角几何重合）
    for (const sd of [-1, 1]) {
      const p = at(sd * (w / 2 - 0.26), d / 2 - 0.26);
      b.bodies.push({ x: p.x, z: p.z, w: 0.3, d: 0.3, h: hh - 0.25, yaw, bc: postC, rc: yd.rc, tk: 0.4 });
    }
  }
  // 门脸额枋：两柱之间一道横木，敞开的门脸才有"框"
  const beam = at(0, d / 2 - 0.26);
  b.bodies.push({ x: beam.x, z: beam.z, w: w - 0.2, d: 0.28, h: 0.3, yaw, bc: postC, rc: yd.rc, tk: 0.4 });
  const cnt = at(0, d / 2 - 0.95);
  b.bodies.push({ x: cnt.x, z: cnt.z, w: Math.max(1.6, w - 0.9), d: 0.62, h: 1.02, yaw, bc: 0x7a5a34, rc: yd.rc, tk: 0.35 });
  b.glows.push({ x: yd.hx, z: yd.hz - d * 0.06, y: base + hh * 0.52, w: 1.15, h: 1.15, d: 1.15, yaw, c: 0xffb45c });
  const bx = at(w / 2 - 0.7, d / 2 + 0.42);
  b.fabrics.push({ x: bx.x, z: bx.z, w: 0.8, h: 2.2, d: 0.07, y: base + hh - 2.35, yaw: yaw + Math.PI / 2, c: kind.c });
  if (kind.big) {
    const posts = h(Math.round(yd.hz)) < 0.5 ? 4 : 6;
    for (let i = 0; i < posts; i++) {
      const u = (i % 2 === 0 ? -1 : 1) * (w / 2 - 0.3);
      const v = posts === 4 ? (i < 2 ? -d / 2 + 0.3 : d / 2 - 0.3) : ((i >> 1) - 1) * (d / 2 - 0.3);
      const p = at(u, v);
      b.bodies.push({ x: p.x, z: p.z, w: 0.26, d: 0.26, h: hh + 0.5, yaw, bc: postC, rc: yd.rc, tk: 0.4 });
    }
    const roofY = base + hh + 0.55;
    b.fabrics.push({ x: yd.hx, z: yd.hz, w: w + 1.7, h: 0.14, d: d + 1.7, y: roofY, yaw, c: MAT_WEAVE });
    b.fabrics.push({ x: yd.hx, z: yd.hz, w: w + 1.9, h: 0.3, d: 0.52, y: roofY + 0.12, yaw, c: shade(MAT_WEAVE, 0.86) });
    const b2 = at(-(w / 2 - 0.7), d / 2 + 0.42);
    b.fabrics.push({ x: b2.x, z: b2.z, w: 0.8, h: 2.2, d: 0.07, y: base + hh - 2.2, yaw: yaw + Math.PI / 2, c: kind.c });
  } else {
    b.curved.push({ x: yd.hx, z: yd.hz, w, d, h: hh, yaw, bc: yd.bc, rc: yd.rc, eo: yd.eo });
    b.gableWalls.push({ x: yd.hx, z: yd.hz, w, d, h: hh, y: base + hh + 0.5, yaw, c: yd.bc });
  }
}

/**
 * 单株树：树干 + 球冠团簇（**不用单圆锥**）。
 * 近档 ≤260 面：叶 3–5 团 × 42 + 干 10；中档 ≤60 面：叶 1–2 团 × 20 + 干 10；远档（>2400m）不出树。
 * form：0 阔叶（球冠）/ 1 垂柳（宽扁冠 + 四团下垂）/ 2 松柏（锥状层叠）。
 */
function pushTree(b: Bucket, x: number, z: number, base: number, form: number, r1: number, r2: number, r3: number): void {
  const s = 0.84 + 0.4 * r1;
  const trunkH = (form === 1 ? 2.4 : 2.8) + 1.2 * r2;
  const tr = 0.15 + 0.08 * r3;
  b.trunks.push({ x, z, w: tr, h: trunkH * s, d: tr, y: base, yaw: 0, c: shade(BARK, 0.88 + 0.24 * r3) });
  const topY = base + trunkH * s;
  if (b.tier >= 1) {
    // 中档：1–2 团球冠（20 面/团）
    const d = (2.5 + 1.4 * r2) * s;
    b.leaves.push({ x, z, w: d, h: d * 0.78, d, y: topY - d * 0.05, yaw: 0, c: form === 2 ? LEAF_C : LEAF_A });
    if (form === 0 && r3 > 0.45) {
      b.leaves.push({ x: x + (r1 - 0.5) * d * 0.8, z: z + (r3 - 0.5) * d * 0.8, w: d * 0.7, h: d * 0.5, d: d * 0.7, y: topY + d * 0.16, yaw: 0, c: LEAF_B });
    }
    return;
  }
  if (form === 2) {
    // 松柏：锥状层叠（4 层扁球逐层收小）
    const d = (1.9 + 0.9 * r2) * s;
    const ly = [1, 0.78, 0.56, 0.34];
    for (let i = 0; i < 4; i++) {
      const dd = d * ly[i];
      b.leaves.push({ x, z, w: dd, h: dd * 0.52, d: dd, y: topY - d * 0.22 + i * d * 0.3, yaw: 0, c: i % 2 ? LEAF_C : LEAF_A });
    }
  } else if (form === 1) {
    // 垂柳：宽扁主冠 + 四团下垂
    const d = (3.2 + 1.7 * r2) * s;
    b.leaves.push({ x, z, w: d, h: d * 0.46, d, y: topY - d * 0.04, yaw: 0, c: LEAF_W });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r3 * 1.7;
      const dd = d * (0.46 + 0.1 * r1);
      b.leaves.push({
        x: x + Math.cos(a) * d * 0.36, z: z + Math.sin(a) * d * 0.36,
        w: dd, h: dd * 0.72, d: dd, y: topY - d * 0.26 + (i % 2) * d * 0.08,
        yaw: a, c: shade(LEAF_W, i % 2 ? 1.04 : 0.92),
      });
    }
  } else {
    // 阔叶：三团球冠错位
    const d = (2.7 + 1.5 * r2) * s;
    b.leaves.push({ x, z, w: d, h: d * 0.82, d, y: topY - d * 0.08, yaw: 0, c: LEAF_A });
    b.leaves.push({ x: x + (r1 - 0.5) * d * 0.9, z: z + (r3 - 0.5) * d * 0.9, w: d * 0.66, h: d * 0.56, d: d * 0.66, y: topY + d * 0.16, yaw: 0, c: LEAF_B });
    b.leaves.push({ x: x - (r2 - 0.5) * d * 0.8, z: z - (r1 - 0.5) * d * 0.8, w: d * 0.6, h: d * 0.5, d: d * 0.6, y: topY - d * 0.26, yaw: 0, c: shade(LEAF_B, 0.92) });
  }
}

/** 院中空地：连续试 4 个偏置点，四角留 0.65m、离开正房 1.1m；找不到就放弃这一棵 */
function yardSpot(yd: W9Yard, k: number, h: (j: number) => number): { x: number; z: number } | null {
  const ca = Math.cos(yd.yaw), sa = Math.sin(yd.yaw);
  const rad = Math.sqrt(yd.area);
  const salt = Math.round(yd.c.x * 3 + yd.c.z * 7);
  for (let t = 0; t < 4; t++) {
    const idx = salt + k * 11 + t * 3;
    const a = h(6700 + idx) * Math.PI * 2;
    const r = (0.16 + 0.34 * h(6701 + idx)) * rad;
    const x = yd.c.x + Math.cos(a) * r, z = yd.c.z + Math.sin(a) * r;
    if (!fitRect(yd.poly, x, z, 1.3, 1.3, 0)) continue;
    if (yd.main) {
      const dx = x - yd.hx, dz = z - yd.hz;
      const u = dx * ca - dz * sa, v = dx * sa + dz * ca;
      if (Math.abs(u) < yd.hw / 2 + 1.1 && Math.abs(v) < yd.hd / 2 + 1.1) continue;
    }
    return { x, z };
  }
  return null;
}

/**
 * 密植树木（W25）：每坊 30–44 棵（tier0）/ 25–33 棵（tier1），远档不出树。
 * ① 行道树：沿主巷（宽 ≥2.2m、深 ≤3 层）每 8–12m 一株，规则感；
 * ② 院树：院中空地 1–3 棵，用跨步抽样铺满整坊（顺序抽样会把树全堆在前几块地里）；
 * 形态按 hash 轮换：巷口多垂柳、院角多松柏、其余阔叶。
 */
function plantTrees(b: Bucket, plan: W9Plan, h: (k: number) => number, reserved: (x: number, z: number) => boolean): void {
  const tier = b.tier;
  if (tier > 1) return;
  const base = b.lift;
  // 30–44/坊 会把启动与首帧拖到 2 分钟以上（软件渲染下 5200 棵 × 136 面 ≈ 70 万面只是表层，
  // 真正的代价是实例分桶后的绘制批次数）。先收到 15–23/坊，全城约 2600 棵。
  const target = tier === 0 ? 15 + Math.floor(h(6100) * 9) : 12 + Math.floor(h(6100) * 7);
  let planted = 0;
  const streetQuota = Math.round(target * (0.55 + 0.1 * h(6101)));
  const roads = plan.alleys.filter((al): boolean => al.w >= 2.2 && al.depth <= 3 && Math.hypot(al.x1 - al.x0, al.z1 - al.z0) >= 9);
  roads.sort((p, q) => h01(Math.round(p.x0), Math.round(p.z0), 6200) - h01(Math.round(q.x0), Math.round(q.z0), 6200));
  for (const al of roads) {
    if (planted >= streetQuota) break;
    const dx = al.x1 - al.x0, dz = al.z1 - al.z0;
    const L = Math.hypot(dx, dz);
    const step = 8 + 4 * h(6201 + (Math.round(al.z0) & 511));
    // 每坊每条巷最多 6 株，但**株距死守 8–12m**：取巷中一段连续 40–72m 种满，
    // 而不是把 6 株摊到 700m 长的巷上（那样株距 117m，读不出"行道树"）
    const n = Math.min(6, Math.max(1, Math.floor(L / step)));
    const s0 = h(6202 + (Math.round(al.x0) & 511)) * Math.max(0, L - n * step);
    for (let i = 0; i < n && planted < streetQuota; i++) {
      const t = (s0 + (i + 0.5) * step) / L;
      const x = al.x0 + dx * t, z = al.z0 + dz * t;
      if (reserved(x, z)) continue;
      const seed = h(6300 + planted * 7);
      const form = seed < 0.34 ? 1 : seed < 0.86 ? 0 : 2;
      pushTree(b, x, z, base, form, seed, h(6301 + planted * 7), h(6302 + planted * 7));
      planted++;
    }
  }
  const yards = plan.yards;
  if (!yards.length || planted >= target) return;
  const need = target - planted;
  const start = Math.floor(h(6402) * yards.length);
  const stride = Math.max(1, Math.floor(yards.length / need));
  for (let i = 0; i < yards.length && planted < target; i++) {
    const yi = (start + i * stride) % yards.length;
    const yd = yards[yi];
    if (h(6500 + yi * 5) < 0.12) continue;
    const want = 1 + Math.floor(h(6510 + yi * 5) * 3);
    for (let k = 0; k < want && planted < target; k++) {
      const spot = yardSpot(yd, k, h);
      if (!spot) continue;
      const seed = h(6600 + planted * 7);
      const form = seed < 0.3 ? 2 : seed > 0.9 ? 1 : 0;
      pushTree(b, spot.x, spot.z, base, form, seed, h(6601 + planted * 7), h(6602 + planted * 7));
      planted++;
    }
  }
}

// ---------- 门窗摆位：整面按「樘数 + 门」等分，明间居中 ----------
interface WallFace { nx: number; nz: number; ax: number; az: number; half: number; px: number; pz: number }

/** 建筑四面里最朝向 aim 的一面：面心、外法线、面内切向、半宽 */
function wallFace(cx: number, cz: number, w: number, d: number, yaw: number, aimX: number, aimZ: number): WallFace {
  const sa = Math.sin(yaw), ca = Math.cos(yaw);
  const tx = aimX - cx, tz = aimZ - cz;
  const faces: WallFace[] = [
    { nx: sa, nz: ca, ax: ca, az: -sa, half: w / 2, px: cx + sa * d / 2, pz: cz + ca * d / 2 },
    { nx: -sa, nz: -ca, ax: -ca, az: sa, half: w / 2, px: cx - sa * d / 2, pz: cz - ca * d / 2 },
    { nx: ca, nz: -sa, ax: -sa, az: -ca, half: d / 2, px: cx + ca * w / 2, pz: cz - sa * w / 2 },
    { nx: -ca, nz: sa, ax: sa, az: ca, half: d / 2, px: cx - ca * w / 2, pz: cz + sa * w / 2 },
  ];
  let best = faces[0], bd = -Infinity;
  for (const f of faces) {
    const sc = f.nx * tx + f.nz * tz;
    if (sc > bd) { bd = sc; best = f; }
  }
  return best;
}

/**
 * 一处院落 / 厢房的门窗：朝院一面 4–6 樘棂窗（厢房 1–2 樘）+ 明间板门 + 门前踏跺石。
 * 面宽按「樘数 + 门」等分成格，正房取偶数樘（4 或 6）让 5/7 格必为奇数 —— 门正好落在明间。
 * 全部是 2 面的贴面小件，图案在 furnHook 里画；窗台高 0.92m、门高 2.06m 是宋式民居量级。
 */
function furnishHouse(b: Bucket, cx: number, cz: number, w: number, d: number, yaw: number,
  base: number, hh: number, aimX: number, aimZ: number, seed: number, wing: boolean): void {
  if (hh < 2.2) return;
  const f = wallFace(cx, cz, w, d, yaw, aimX, aimZ);
  const W = f.half * 2;
  if (W < 2.6) return;
  const nWin = wing ? (W >= 3.4 ? 2 : 1) : (W >= 14 ? 6 : 4);
  const N = nWin + 1;
  const pitch = W / N;
  const off = 0.045;
  const doorIdx = Math.floor(N / 2);
  const winH = wing ? 1.0 : 1.12;
  const sillH = wing ? 0.95 : 0.92;
  const doorH = wing ? 1.95 : 2.06;
  const winW = Math.min(1.12, Math.max(0.62, pitch - 0.22));
  const doorW = Math.min(1.5, Math.max(0.9, pitch - 0.14));
  for (let i = 0; i < N; i++) {
    const s = (i + 0.5 - N / 2) * pitch;
    const x = f.px + f.ax * s + f.nx * off;
    const z = f.pz + f.az * s + f.nz * off;
    if (i === doorIdx) {
      b.furn.push({ x, y: base, z, w: doorW, h: doorH, nx: f.nx, nz: f.nz, kind: 1, seed: (seed * 7.3) % 1 });
    } else {
      b.furn.push({ x, y: base + sillH, z, w: winW, h: winH, nx: f.nx, nz: f.nz, kind: 0, seed: (seed * 3.1 + i * 0.17) % 1 });
    }
  }
  const stepW = wing ? 1.2 : 1.5, stepD = wing ? 0.8 : 1.0;
  b.furn.push({
    x: f.px + f.nx * 0.12, y: base + 0.02, z: f.pz + f.nz * 0.12,
    w: stepW, h: stepD, nx: f.nx, nz: f.nz, kind: 2, seed, flat: true,
  });
}

/** 院门前踏跺石（1.5×1.0）：外法线 = 院心 → 院门，石板朝外铺在门洞外侧，与门对齐 */
function gateStep(b: Bucket, g: W9Gate, base: number, cx: number, cz: number): void {
  const dx = g.x - cx, dz = g.z - cz;
  const L = Math.hypot(dx, dz) || 1;
  const nx = dx / L, nz = dz / L;
  b.furn.push({ x: g.x + nx * 0.16, y: base + 0.02, z: g.z + nz * 0.16, w: 1.5, h: 1.0, nx, nz, kind: 2, seed: 0.5, flat: true });
}

/** 把规划好的地块/巷/院按档位灌进实例桶：tier0 完整院落，tier1/2 简院，tier3 只出体块 */
function emitFill(b: Bucket, plan: W9Plan, h: (k: number) => number, reserved: (x: number, z: number) => boolean): void {
  const tier = b.tier, base = b.lift;
  if (tier === 0) b.yards += plan.yards.length;
  else if (tier <= 2) b.simpleYards += plan.yards.length;
  if (tier <= 2) {
    // ---- 巷道地坪暗带：巷随地块二分生长，走向天然分叉，不再有横平竖直的街网 ----
    // 只铺「够宽够长」的巷（窄缝留土），近档铺到深 7 层，中远档只铺主巷（深 4 层），面数可控
    const maxD = tier === 0 ? 7 : tier === 1 ? 4 : 3;
    for (const al of plan.alleys) {
      if (al.depth > maxD) continue;
      const dx = al.x1 - al.x0, dz = al.z1 - al.z0;
      const L = Math.hypot(dx, dz);
      if (L < 6 || al.w < 1.5) continue;
      const mx = (al.x0 + al.x1) / 2, mz = (al.z0 + al.z1) / 2;
      if (reserved(mx, mz)) continue;
      // 巷道地坪走独立的 roads 桶：材质自带车辙 / 路心 / 石板缝 / 散水着色（面数与原来一样）
      b.roads.push({ x: mx, z: mz, w: L, h: 0.07, d: al.w + 0.7, y: base + 0.003 + h(Math.round(L)) * 0.003, yaw: -Math.atan2(dz, dx), c: 0x4a4238 });
      // 断头巷：一端砌 1.9m 土墙封死（15–25%）
      if (tier <= 1 && al.dead) {
        const from = obstSnap(b);
        b.walls.push({ x: al.x0, z: al.z0, w: al.w + 1.4, h: 1.9, d: 0.5, y: base, yaw: -Math.atan2(dz, dx) + Math.PI / 2, c: 0x9c8560 });
        obstRecord(b, 'wall', al.x0, al.z0, al.w + 1.4, 0.5, -Math.atan2(dz, dx) + Math.PI / 2, base, 1.9, b.ownerSeq++, from);
      }
    }
  }

  if (tier === 0) {
    for (const yd of plan.yards) {
      // 一院一个 owner：建筑之间、墙门之间允许贴合；墙穿房仍按优先级删墙（见 sameHouseExempt）
      const owner = b.ownerSeq++;
      if (yd.shop >= 0) {
        // 商铺：敞门脸（三面墙 + 前柱 + 柜台）+ 檐下幌子；正面朝最近的巷，院墙不再挡门脸
        const from = obstSnap(b);
        emitShop(b, yd, base, h);
        const big = SHOPS[yd.shop].big;
        const [fw, fd] = big ? [yd.hw + 1.9, yd.hd + 1.7] : roofFoot(yd.hw, yd.hd, yd.eo);
        obstRecord(b, 'shop', yd.hx, yd.hz, fw, fd, yd.yaw + (yd.shopFlip ? Math.PI : 0), base, yd.hh + 1.2, owner, from);
        continue;
      }
      if (yd.main) {
        const from = obstSnap(b);
        b.bodies.push({ x: yd.hx, z: yd.hz, w: yd.hw, d: yd.hd, h: yd.hh, yaw: yd.yaw, bc: yd.bc, rc: yd.rc, tk: 0.5 });
        // 形制：9% 草顶/苇顶（坡面外凸、一捆圆脊、厚檐），其余瓦顶；脊高/出檐在摆位处按同一份纯函数算
        const thatch = h01(Math.round(yd.hx), Math.round(yd.hz), 7717) < 0.09;
        const rc = thatch
          ? shade(ROOF_COLORS[h01(Math.round(yd.hz), Math.round(yd.hx), 7719) < 0.5 ? 4 : 5], 0.92 + 0.16 * h01(Math.round(yd.hx), Math.round(yd.hz), 7718))
          : yd.rc;
        (thatch ? b.thatch : b.curved).push({ x: yd.hx, z: yd.hz, w: yd.hw, d: yd.hd, h: yd.hh, yaw: yd.yaw, bc: yd.bc, rc, eo: yd.eo });
        // 山墙：墙色三角封头，落在墙皮上（比屋顶两端各收进一个出檐）
        b.gableWalls.push({ x: yd.hx, z: yd.hz, w: yd.hw, d: yd.hd, h: yd.hh, y: base + yd.hh + 0.5, yaw: yd.yaw, c: yd.bc });
        // 正房正面：4–6 樘棂窗 + 明间板门 + 踏跺石（朝院门一面；无院门时朝院心）
        const aim = yd.gates.length ? yd.gates[0] : yd.c;
        furnishHouse(b, yd.hx, yd.hz, yd.hw, yd.hd, yd.yaw, base, yd.hh, aim.x, aim.z,
          h01(Math.round(yd.hx), Math.round(yd.hz), 7820), false);
        const [fw, fd] = roofFoot(yd.hw, yd.hd, yd.eo);
        obstRecord(b, 'main', yd.hx, yd.hz, fw, fd, yd.yaw, base, yd.hh + roofRise(yd.hw, yd.hd), owner, from);
      }
      for (const w of yd.wings) {
        const from = obstSnap(b);
        b.bodies.push({ x: w.x, z: w.z, w: w.w, d: w.d, h: w.h, yaw: w.yaw, bc: yd.bc, rc: yd.rc, tk: 0.3 });
        // 厢房：两坡硬山顶（正脊沿厢房长向，所以 w/d 互换再转 90°）；
        // 侧厢 34% 改单坡厦子（细长、低矮的服务用房），坡向院内 —— 等级差就落在这一条上
        const side = w.shedSide ?? 0;
        const wallTop = base + w.h + 0.3;
        // 厢房屋面同样按净距收口（斜着站在地块边上的厢房，出檐一大就顶进邻院）
        const weo = Math.min(0.5, edgeClearance(yd.poly, w.x, w.z, w.w, w.d, w.yaw));
        const isShed = side !== 0 && h01(Math.round(w.x), Math.round(w.z), 7723) < 0.34;
        if (isShed) {
          b.sheds.push({
            x: w.x, z: w.z, w: w.d + 2 * weo, h: 0.72 + 0.26 * h01(Math.round(w.z), Math.round(w.x), 7724), d: w.w + 2 * weo,
            y: wallTop, yaw: w.yaw + side * Math.PI / 2, c: yd.rc,
          });
        } else {
          b.gables.push({
            x: w.x, z: w.z, w: w.d + 2 * weo, h: roofRise(w.d, w.w) * 0.86, d: w.w + 2 * weo,
            y: wallTop, yaw: w.yaw + Math.PI / 2, c: yd.rc,
          });
        }
        // 厢房：朝院一面 1–2 樘棂窗 + 1 樘门（朝向正房 = 院心方向）+ 门前踏跺石
        furnishHouse(b, w.x, w.z, w.w, w.d, w.yaw, base, w.h, yd.hx, yd.hz,
          h01(Math.round(w.x), Math.round(w.z), 7830), true);
        // 两坡 / 单坡的实例 w/d 互换又转 90°，平面足迹等价于「墙身四面各外扩 weo」
        obstRecord(b, isShed ? 'shed' : 'wing', w.x, w.z, w.w + 2 * weo, w.d + 2 * weo, w.yaw, base, w.h + 0.8, owner, from);
      }
      for (const w of yd.walls) {
        const from = obstSnap(b);
        b.walls.push({ x: w.x, z: w.z, w: w.w, h: w.h, d: w.d, y: base, yaw: w.yaw, c: yd.wc });
        obstRecord(b, 'wall', w.x, w.z, w.w, w.d, w.yaw, base, w.h, owner, from);
      }
      for (const g of yd.gates) {
        const from = obstSnap(b);
        b.slabs.push({ x: g.x, z: g.z, w: g.w, h: 0.5, d: g.d, y: base + 2.0, yaw: g.yaw, c: yd.rc });
        // 院门前踏跺石：1.5×1.0，与门洞对齐、铺在巷侧
        gateStep(b, g, base, yd.c.x, yd.c.z);
        obstRecord(b, 'gate', g.x, g.z, g.w, g.d, g.yaw, base + 2.0, 0.5, owner, from);
      }
      for (const p of yd.props) {
        b.walls.push({ x: p.x, z: p.z, w: p.w, h: p.h, d: p.d, y: base + p.o, yaw: p.yaw, c: p.c });
      }
    }
  } else if (tier <= 2) {
    // 1200–3600m：一院 = 墙身 + 两坡顶。tier1 走 42 面两坡单元、tier2 走 8 面简顶（旧版 tier2 干脆没有屋顶，
    // 俯视是一片灰平顶 —— 这也是「房顶全不正确」的一部分）。不铺院墙：2km 外一道 2m 土墙不足 1px，
    // 省下的面留给近档；院与院之间的错落靠地块本身的不规则与巷暗带交代
    for (const yd of plan.yards) {
      const owner = b.ownerSeq++;
      const from = obstSnap(b);
      const w = yd.main ? yd.hw : Math.min(9.6, Math.max(5.2, Math.sqrt(yd.area) * 0.62));
      const d = yd.main ? yd.hd : Math.min(7.6, Math.max(4.6, Math.sqrt(yd.area) * 0.46));
      const hh = yd.main ? yd.hh : 3.2 + h(Math.round(yd.c.x)) * 1.4;
      const x = yd.main ? yd.hx : yd.c.x, z = yd.main ? yd.hz : yd.c.z;
      b.bodies.push({ x, z, w, d, h: hh, yaw: yd.yaw, bc: yd.bc, rc: yd.rc, tk: 0.4 });
      // 院组：一部分宅基出两栋（正房 + 后檐小屋），两栋相距 4.4–6.0m。
      // tier1/2 的 LOD 以前把厢房整条砍掉，每院只剩一栋居中的盒子 —— 最近邻因此全等于地块间距，
      // 远景读成规则格网。补回来的这一栋不改变宅基数，只在原地块内偏置，间距分布才有近支。
      if (h(7300 + (owner & 1023)) < W9_PAIR_LOD) {
        const w2 = Math.min(4.6, Math.max(3.0, w * 0.5));
        const d2 = 2.6;
        // 沿进深方向（v 轴）并排：小屋贴着正房后檐，中心距 4.4–6.0m，与 12–18m 的户间距成对拉开。
        const vx = Math.sin(yd.yaw), vz = Math.cos(yd.yaw);
        const off = d / 2 + d2 / 2 + 0.45;
        for (const sgn of [1, -1]) {
          const x2 = x + vx * off * sgn, z2 = z + vz * off * sgn;
          if (!fitRect(yd.poly, x2, z2, w2, d2, yd.yaw)) continue;
          b.bodies.push({ x: x2, z: z2, w: w2, d: d2, h: hh * 0.8, yaw: yd.yaw, bc: yd.bc, rc: yd.rc, tk: 0.3 });
          break;
        }
      }
      // tier1 补最小门窗（2 樘窗 + 1 樘门 + 踏跺石，8 面/户）：验收机位 (2100,55,2500) 整片落在
      // 1200–2400m 这一档，不给门窗就仍是"米白盒子"，与"每户数得出 2 窗 1 门"直接冲突。
      // tier2（2.4km 外）仍不加：一樘 1m 的窗不足 1px，面数花了也读不出。
      if (tier === 1) {
        const aim = yd.gates.length
          ? yd.gates[0]
          : { x: x + Math.sin(yd.yaw) * 12, z: z + Math.cos(yd.yaw) * 12 };
        furnishHouse(b, x, z, w, d, yd.yaw, base, hh, aim.x, aim.z, h01(Math.round(x), Math.round(z), 7850), true);
      }
      // 屋面必须落在墙顶：墙体实例高 hh+0.4（多出的 0.4 埋进地坪），旧版放在 hh+0.2 —— 墙从屋面里穿出来
      const rh = roofRise(w, d);
      if (tier === 1) {
        b.gables.push({ x, z, w: w + 0.5, h: rh, d: d + 2 * ROOF_EAVE_OUT, y: base + hh + 0.4, yaw: yd.yaw, c: yd.rc });
      } else {
        // tier2 旧版干脆没有屋顶（俯视是一片灰平顶），补一层 8 面简顶：两坡 + 脊带
        b.tents.push({ x, z, w: w + 0.4, h: rh * 0.92, d: d + 1.2, y: base + hh + 0.4, yaw: yd.yaw, c: yd.rc });
      }
      // 简院同样按屋面足迹参与消解（tier1 两坡 w+0.5 / d+1.2；tier2 简顶 w+0.4 / d+1.2）
      const fw = tier === 1 ? w + 0.5 : w + 0.4;
      const fd = tier === 1 ? d + 2 * ROOF_EAVE_OUT : d + 1.2;
      obstRecord(b, 'simple', x, z, fw, fd, yd.yaw, base, hh + rh, owner, from);
    }
  } else {
    // 3.6km 以外：地块块群一体块，朝向沿用二分切线，剪影仍是不规则簇团
    for (const bl of plan.blocks) {
      const from = obstSnap(b);
      b.blocks.push({
        x: bl.x, z: bl.z, w: bl.w * 0.86, d: bl.d * 0.86, h: 4.2 + h(Math.round(bl.x)) * 1.2, yaw: bl.yaw,
        bc: BODY_COLORS[Math.floor(h(Math.round(bl.z)) * BODY_COLORS.length)],
        rc: ROOF_COLORS[Math.floor(h(Math.round(bl.x + bl.z)) * ROOF_COLORS.length)],
      });
      // 远档体块本来就是剪影（prio 0）：同一地块若与邻块互穿，删占地小的那块
      obstRecord(b, 'block', bl.x, bl.z, bl.w * 0.86, bl.d * 0.86, bl.yaw, b.lift, 4.2, b.ownerSeq++, from);
    }
  }
}

/** 里坊：院墙（折线）→ 抖动二分地块 → 巷 → 院 */
function fillWard(b: Bucket, cell: WardCell, reserved: (x: number, z: number) => boolean): void {
  const sa = Math.round(cell.cx), sb = Math.round(cell.cz);
  const h = (k: number): number => h01(sa, sb, 12000 + k);
  // 坊级屋顶色：8 档按坊心 hash 取一档，整坊共用
  const wardRoof = ROOF_COLORS[Math.floor(h(431) * ROOF_COLORS.length)];
  const plan = planWard(cell, reserved, b.tier <= 2, W9_CORNER, b.tier === 0,
    b.tier >= 1 ? W9_LOT_LOD : 1, b.tier >= 1);
  // 坊界院墙整坊共用一个 owner：同一坊的墙段在转角处本来就该相接，不互相判干涉
  const wardOwner = b.ownerSeq++;
  wardWall(b, plan, b.tier, h, reserved, wardOwner);
  emitFill(b, plan, h, reserved);
  plantTrees(b, plan, h, reserved);
}

/** 矩形地块（御街两厢坊格） */
function rectPoly(cx: number, cz: number, hx: number, hz: number): Poly {
  return [
    { x: cx - hx, z: cz - hz }, { x: cx + hx, z: cz - hz },
    { x: cx + hx, z: cz + hz }, { x: cx - hx, z: cz + hz },
  ];
}

/**
 * 御街两厢里坊：坊格与街网保持直线（临御街的是仪制街面，SPEC §8 允许道路取直），
 * 但坊内院落与巷全部走同一套抖动二分——旧版这里是 6 列 × 6–8 行的等距院子，正是「方格纸」的重灾区。
 */
function fillCourt(b: Bucket, w: CourtWard, wi: number, reserved: (x: number, z: number) => boolean): void {
  const h = (k: number): number => h01(wi, 17, 15000 + k);
  const root = rectPoly(w.cx, w.cz, w.hx - 1.8, w.hz - 1.8);
  const reg = planRegion(root, 0, h, reserved, b.tier <= 2, undefined, true, undefined,
    b.tier >= 1 ? W9_LOT_LOD : 1, b.tier >= 1);
  const plan: W9Plan = { ring: root, corner: root, yards: reg.yards, alleys: reg.alleys, blocks: reg.blocks, lotArea: reg.lotArea, partyArea: reg.partyArea, span: w.hx * w.hz * 4 };
  emitFill(b, plan, h, reserved);
  plantTrees(b, plan, h, reserved);
}

// ---------- 离线机检出口：跑的就是 WardInfill 用的同一套规划器，不经过 THREE ----------
/** tier0 的八个坊心（wardLod 的距离判据下，|x|=1300 的两列 × |z|=700/1300 两行全部落进 1200m） */
const W9_PROBE_CELLS: WardCell[] = [
  { cx: 1300, cz: 1300, half: 380 }, { cx: -1300, cz: 1300, half: 380 },
  { cx: 1300, cz: -1300, half: 380 }, { cx: -1300, cz: -1300, half: 380 },
  { cx: 1300, cz: 700, half: 350 }, { cx: -1300, cz: 700, half: 350 },
  { cx: 1300, cz: -700, half: 350 }, { cx: -1300, cz: -700, half: 350 },
];

export function w9Probe(): {
  yards: { x: number; z: number; dx: number; dz: number; yaw: number; area: number; span: number; foot: number; hw: number; hd: number; eo: number; cell: number; vacant: boolean }[];
  alleys: W9Alley[];
  coverage: number[];
} {
  const yards: { x: number; z: number; dx: number; dz: number; yaw: number; area: number; span: number; foot: number; hw: number; hd: number; eo: number; cell: number; vacant: boolean }[] = [];
  const alleys: W9Alley[] = [];
  const coverage: number[] = [];
  for (let ci = 0; ci < W9_PROBE_CELLS.length; ci++) {
    const cell = W9_PROBE_CELLS[ci];
    const plan = planWard(cell, () => false, true);
    coverage.push((plan.lotArea + plan.partyArea) / plan.span);
    for (const yd of plan.yards) {
      yards.push({ x: yd.c.x, z: yd.c.z, dx: yd.hx - yd.c.x, dz: yd.hz - yd.c.z, yaw: yd.yaw, area: yd.area, span: yd.span, foot: yd.foot, hw: yd.hw, hd: yd.hd, eo: yd.eo, cell: ci, vacant: !yd.main });
    }
    for (const al of plan.alleys) alleys.push(al);
  }
  return { yards, alleys, coverage };
}

/** 全量面数估算：把 120 坊 + 120 御街厢坊真的灌一遍实例桶，再按单件面数折算（离线可跑） */
export function w9TriEstimate(): Record<string, number> {
  const pos = [-4500, -3700, -2900, -2100, -1300, 1300, 2100, 2900, 3700, 4500];
  const cells: WardCell[] = [];
  for (const cx of pos) for (const cz of pos) cells.push({ cx, cz, half: 380 });
  for (const cx of pos) for (const cz of [-700, 700]) cells.push({ cx, cz, half: 350 });
  const tot = newBucket(0, false, GROUND_Y);
  const tiers = [0, 0, 0, 0];
  // 分档台账（同屋形面数不同，只有按档拆开才看得出增量落在哪一档）
  const byTier = [0, 1, 2, 3].map(() => ({ bodies: 0, curved: 0, gables: 0, sheds: 0, blocks: 0 }));
  let leafNear = 0, leafMid = 0;
  const merge = (b: Bucket): void => {
    tot.bodies.push(...b.bodies); tot.curved.push(...b.curved); tot.gables.push(...b.gables);
    tot.thatch.push(...b.thatch); tot.gableWalls.push(...b.gableWalls); tot.sheds.push(...b.sheds); tot.tents.push(...b.tents);
    tot.blocks.push(...b.blocks); tot.walls.push(...b.walls); tot.slabs.push(...b.slabs); tot.glows.push(...b.glows);
    tot.furn.push(...b.furn); tot.roads.push(...b.roads);
    tot.trunks.push(...b.trunks); tot.leaves.push(...b.leaves); tot.fabrics.push(...b.fabrics);
    const bt = byTier[b.tier];
    bt.bodies += b.bodies.length; bt.curved += b.curved.length + b.thatch.length; bt.gables += b.gables.length;
    bt.sheds += b.sheds.length + b.tents.length; bt.blocks += b.blocks.length;
    if (b.tier >= 1) leafMid += b.leaves.length; else leafNear += b.leaves.length;
  };
  for (const cell of cells) {
    const tier = wardLod(cell.cx, cell.cz);
    tiers[tier]++;
    const b = newBucket(tier, false, GROUND_Y);
    fillWard(b, cell, () => false);
    merge(b);
  }
  const cw = courtWards();
  for (let wi = 0; wi < cw.length; wi++) {
    const tier = cellLod(cw[wi].cx, cw[wi].cz);
    const b = newBucket(tier, true, COURT_BASE - 0.06);
    fillCourt(b, cw[wi], wi, () => false);
    merge(b);
  }
  const tri = (g: { index: unknown; getAttribute: (k: string) => { count: number } }): number =>
    ((g.index ? (g.index as { count: number }).count : g.getAttribute('position').count) / 3);
  const T_BOX = tri(boxUnit5()), T_CURVED_LITE = tri(roofUnitNear()), T_GABLE = tri(roofUnitMid());
  const T_THATCH = tri(roofUnitThatch()), T_GWALL = tri(gableWallUnit()), T_SHED = tri(shedUnit()), T_TENT = tri(tentUnit());
  const T_LEAF_NEAR = tri(leafNearUnit()), T_LEAF_MID = tri(leafMidUnit()), T_TRUNK = tri(trunkUnit());
  const T_FAB = 12; // BoxGeometry(1,1,1)
  const T_EAVE = 12, T_WIN = 12; // BoxGeometry(1.06,0.36,1.06) / BoxGeometry(1.1,1.2,0.12)
  const T_FURN = 2; // 门窗贴面四边形
  const tris =
    tot.bodies.length * T_BOX + tot.curved.length * T_CURVED_LITE + tot.gables.length * T_GABLE +
    tot.thatch.length * T_THATCH + tot.gableWalls.length * T_GWALL + tot.sheds.length * T_SHED + tot.tents.length * T_TENT +
    tot.blocks.length * (T_BOX + 12) + tot.walls.length * T_BOX + tot.slabs.length * T_EAVE + tot.glows.length * T_WIN +
    tot.furn.length * T_FURN + tot.roads.length * T_BOX +
    tot.trunks.length * T_TRUNK + leafNear * T_LEAF_NEAR + leafMid * T_LEAF_MID + tot.fabrics.length * T_FAB;
  return {
    'ward.tier0': tiers[0], 'ward.tier1': tiers[1], 'ward.tier2': tiers[2], 'ward.tier3': tiers[3],
    'court.wards': cw.length,
    bodies: tot.bodies.length, curved: tot.curved.length, gables: tot.gables.length,
    thatch: tot.thatch.length, gableWalls: tot.gableWalls.length, sheds: tot.sheds.length, tents: tot.tents.length,
    blocks: tot.blocks.length, walls: tot.walls.length, slabs: tot.slabs.length, glows: tot.glows.length,
    trunks: tot.trunks.length, leaves: tot.leaves.length, leafNear, leafMid, fabrics: tot.fabrics.length,
    furn: tot.furn.length, roads: tot.roads.length,
    T_BOX, T_CURVED_LITE, T_GABLE, T_THATCH, T_GWALL, T_SHED, T_TENT, T_LEAF_NEAR, T_LEAF_MID, T_TRUNK, T_FAB, T_EAVE, T_WIN, T_FURN, tris,
    ...Object.fromEntries(byTier.flatMap((v, i) => Object.entries(v).map(([kk, vv]) => [`t${i}.${kk}`, vv]))),
  };
}

/** 御街两厢的三档（WS-18 观感合同，随 LOD_NEAR / LOD_MID 走）：0 完整屋面 / 1 檐板 / 2 体块 */
function cellLod(cx: number, cz: number): number {
  const d = Math.hypot(Math.max(0, Math.abs(cx) - CORE_HALF), Math.max(0, Math.abs(cz) - CORE_HALF));
  return d <= LOD_NEAR ? 0 : d <= LOD_MID ? 1 : 2;
}

/** 里坊（官坊格）四档，见文件头的分档表：0 完整院落 / 1 简院 / 2 简院 + 矮坊界 / 3 体块 + 暗带。
 *  边界按坊心 hash 抖 ±LOD_BAND，否则三圈同心圆上整排坊会同时换档，俯视是一圈生硬的环。 */
function wardLod(cx: number, cz: number): number {
  const ax = Math.max(0, Math.abs(cx) - CORE_HALF), az = Math.max(0, Math.abs(cz) - CORE_HALF);
  const d = Math.hypot(ax, az) + (h01(Math.round(cx), Math.round(cz), 8800) - 0.5) * LOD_BAND * 2;
  return d <= LOD_NEAR ? 0 : d <= LOD_MID ? 1 : d <= LOD_FAR ? 2 : 3;
}

export class WardInfill {
  readonly count = {
    body: 0, roof: 0, win: 0, tris: 0,
    yards: 0, blocks: 0, wallPieces: 0, decor: 0,
    courtWards: 0, courtHouses: 0, courtTris: 0, courtMeshes: 0,
  };

  constructor(scene: THREE.Scene, rng: RNG, cells: WardCell[], reserved: (x: number, z: number) => boolean) {
    const tex = createCityTextures();
    const BODY = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.18, map: tex.wallTex });
    // 勒脚 / 墙帽 / 夯土横纹：材质级世界 Y 着色带，零几何、零贴图（tier1/tier2 一并带上）
    plasterHook(BODY);
    const ROOF = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x2a323e, map: tex.roofTex, side: THREE.DoubleSide });
    // 瓦垄只开在瓦顶上：草顶/苇顶是一张粗糙的坡面，多两道亮暗条纹就成了"瓦当"。
    roofFluteHook(ROOF);
    // 夜间自发光按瓦色着色：必须排在 roofFluteHook 之后（它给 onBeforeCompile 打瓦垄补丁，本函数在其上叠加）
    roofEmissiveTint(ROOF);
    const ROOF_THATCH = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x2a323e, map: tex.roofTex, side: THREE.DoubleSide });
    roofEmissiveTint(ROOF_THATCH);
    // 窗光：旧版 Basic + toneMapped:false = 不受光、不过 ACES，1.1×1.2m 的窗在全城上万个实例里
    // 直接输出原始亮度，Bloom 一叠就是满屏白斑（用户问的「闪光」有一半来自这里）。
    // 改走 ACES + 压暗一档：夜里有灯感，但不会烧成纯白。
    const WIN = new THREE.MeshBasicMaterial({ color: 0xc99a58, toneMapped: true });
    // 巷道地坪：与 EARTH 同族，但自带车辙 / 路心 / 石板缝着色
    const ROAD = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0.0, map: tex.groundTex });
    roadHook(ROAD);
    // 门窗 / 踏跺石：双面（从院里看得到窗背面），图案与暖光全在片元里。
    // 必须是 Standard 而不是 Lambert：场景的 scene.environment 是 PMREM RoomEnvironment，
    // 只有 Standard 族吃这份 IBL；走 Lambert 时门窗只剩直射光，贴在墙上像一块黑洞。
    const FURN = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.18, side: THREE.DoubleSide });
    furnHook(FURN);
    // 夯土（院墙 / 灯柱 / 井台共用一个 mesh）：对齐 earth 组语义——无自发光、最粗糙，不把街区染蓝灰
    const EARTH = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.0, map: tex.groundTex });
    plasterHook(EARTH);
    const LEAF = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x16211a });
    // 树干 / 幌子：叶是球冠、干是锥台，幌子与苇席棚顶走 fabric（与 bake 同组语义）
    const TRUNK = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x0a0806 });
    const FABRIC = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1c1712 });
    // 五面盒：底面永不可见（见 boxUnit5 注释），本路 40 万件实例省 80 万面
    const bodyGeo = boxUnit5();
    // 民居屋顶四件套（全部来自 twinRoofGeo 的同一套形制，只差采样密度）：
    //   正房 102 面（5 列×3 环举折 + 方脊 + 封头 + 檐口）/ 厢房与 tier1 简院 42 面 /
    //   草顶 84 面（外凸圆坡 + 圆脊捆）/ 厦子 12 面 / tier2 简顶 8 面 / tier3 远档 12 面
    const roofLiteGeo = roofUnitNear();
    const gableGeo = roofUnitMid();
    const thatchGeo = roofUnitThatch();
    const gableWallGeoRef = gableWallUnit();
    const shedGeo = shedUnit();
    const tentGeo = tentUnit();
    // 压顶石板 / 门罩 / 腰檐：ROOF 材质是 DoubleSide，砍掉 −y 面从檐下看仍是实心面，
    // 35k 件 × 2 面 = 7 万面，正好抵掉 A5 新增灯笼与招幌的预算（净增 ≤0）。
    const eaveGeo = boxUnit5c(1.06, 0.36, 1.06).translate(0, 0.5, 0);
    const winGeo = boxUnit5c(1.1, 1.2, 0.12);
    // 幌子 / 苇席棚顶：六面盒（12 面）。棚顶从街上要看得见底面，不能像墙那样砍掉 −y 面
    const fabricGeo = new THREE.BoxGeometry(1, 1, 1);
    // 树冠：球冠（近档 42 面 / 中档 20 面）。单圆锥在 2km 外读成钉子，形态靠实例缩放区分
    const leafNearGeo = leafNearUnit();
    const leafMidGeo = leafMidUnit();
    const trunkGeo = trunkUnit();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), s = new THREE.Vector3();
    const c = new THREE.Color();
    const triOf = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const T_BOX = triOf(bodyGeo), T_CURVED_LITE = triOf(roofLiteGeo), T_GABLE = triOf(gableGeo);
    const T_THATCH = triOf(thatchGeo), T_GWALL = triOf(gableWallGeoRef), T_SHED = triOf(shedGeo), T_TENT = triOf(tentGeo);
    const T_EAVE = triOf(eaveGeo), T_WIN = triOf(winGeo);
    const T_LEAF_NEAR = triOf(leafNearGeo), T_LEAF_MID = triOf(leafMidGeo), T_TRUNK = triOf(trunkGeo);
    const T_FAB = triOf(fabricGeo);
    const T_FURN = triOf(furnQuad());

    // rng 先按旧结构排空：下游 buildPavement / 树木 / 摊位拿到的数值与旧版逐位相同
    drainLegacyRng(rng, cells, reserved);

    // 按 (档位, 象限) 分桶收集：视锥剔除按桶算包围球
    const buckets = new Map<string, Bucket>();
    const bucketFor = (key: string, tier: number, court: boolean, lift: number): Bucket => {
      let b = buckets.get(key);
      if (!b) {
        b = newBucket(tier, court, lift);
        buckets.set(key, b);
      }
      return b;
    };
    // imperial.ts 的近城环带（half=350 的 ±700 两行）与 half=380 的 ±1300 行在 |z| 920–1050 重叠 130m。
    // 按 cells 顺序判重：重叠带归先出现的坊，后出现的坊在该带不再出地块，否则近档会叠出双倍密度的房子
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const dup = (x: number, z: number): boolean => {
        for (let j = 0; j < ci; j++) {
          const c = cells[j];
          if (Math.abs(x - c.cx) <= c.half - 1 && Math.abs(z - c.cz) <= c.half - 1) return true;
        }
        return false;
      };
      const tier = wardLod(cell.cx, cell.cz);
      fillWard(bucketFor(`${tier}:${lodCellKey(cell.cx, cell.cz, LOD_CELL)}`, tier, false, GROUND_Y), cell, (x, z) => reserved(x, z) || dup(x, z));
    }

    // 御街两厢里坊：接在 100 坊之后，确定性排布不消耗 rng；复用同一套分桶 + LOD + 视锥剔除
    const wards = courtWards();
    for (let wi = 0; wi < wards.length; wi++) {
      const w = wards[wi];
      const tier = cellLod(w.cx, w.cz);
      const lift = COURT_BASE - 0.06;
      fillCourt(bucketFor(`${tier}:court${lodCellKey(w.cx, w.cz, LOD_CELL_COURT)}`, tier, true, lift), w, wi, reserved);
    }

    // ============ 放置后干涉消解（实例化之前，每桶一次） ============
    // layoutYard / planRegion 只保证构件在本户地块内，架不住「院墙内压 0.2m + 屋面出檐 + 随机 yaw」
    // 三者叠加：俯视能看到厢房屋顶插进邻院、院墙穿过房屋。这里对每个桶做一次 OBB 普查，
    // 删优先级低的件（tier3 体块 / tier1-2 简院 / 院墙），shop 永不删，高精度正房/临街店铺优先留。
    // 纯减法：不新增面与 draw call，只多一次构建期 CPU 扫描。
    if (OVERLAP_ON) {
    const overlapT0 = performance.now();
    const dropTotals: Record<string, number> = {};
    const kits: Record<string, number> = {};
    const kindBeforeTotals: Record<string, number> = {};
    const kindAfterTotals: Record<string, number> = {};
    const dropByTotals: Record<string, Record<string, number>> = {};
    const byTier: InfillDropReport['byTier'] = {};
    const shopSamples: { x: number; z: number; yaw: number }[] = [];
    let obsTotal = 0, keptTotal = 0, postTotal = 0, postSS = 0, candTotal = 0;
    let tPreTotal = 0, tGreedyTotal = 0, tPostTotal = 0;
    let shopsBeforeTotal = 0, shopTotal = 0, shopPartsTotal = 0, shopPartsAfterTotal = 0;
    const shopPartsByKey: Record<string, number> = {};
    const shopPartsByKeyAfter: Record<string, number> = {};
    for (const b of buckets.values()) {
      for (const o of b.obstacles) {
        if (o.kind === 'shop' && shopSamples.length < 16) {
          shopSamples.push({ x: +o.x.toFixed(2), z: +o.z.toFixed(2), yaw: +o.yaw.toFixed(3) });
        }
      }
      if (b.obstacles.length) {
        const r = resolveObstacles(b);
        for (const [k, n] of Object.entries(r.drops)) {
          b.kit(`infill.drop.${k}`, n, 0);
          dropTotals[k] = (dropTotals[k] ?? 0) + n;
        }
        for (const [k, n] of Object.entries(r.kindBefore)) kindBeforeTotals[k] = (kindBeforeTotals[k] ?? 0) + n;
        for (const [k, n] of Object.entries(r.kindAfter)) kindAfterTotals[k] = (kindAfterTotals[k] ?? 0) + n;
        for (const [victim, row] of Object.entries(r.dropBy)) {
          const t = (dropByTotals[victim] ??= {});
          for (const [by, n] of Object.entries(row)) t[by] = (t[by] ?? 0) + n;
        }
        if (r.pre >= 0) b.kit('infill.overlap.pre', r.pre, 0);
        b.kit('infill.overlap.post', r.post, 0);
        b.kit('infill.overlap.shop', r.shops, 0);
        obsTotal += r.obstacles;
        keptTotal += r.kept;
        postTotal += r.post;
        postSS += r.postShopShop;
        candTotal += r.cand;
        tPreTotal += r.tPre;
        tGreedyTotal += r.tGreedy;
        tPostTotal += r.tPost;
        shopsBeforeTotal += r.shopsBefore;
        shopTotal += r.shops;
        shopPartsTotal += r.shopParts;
        shopPartsAfterTotal += r.shopPartsAfter;
        for (const [k, n] of Object.entries(r.shopPartsByKey)) shopPartsByKey[k] = (shopPartsByKey[k] ?? 0) + n;
        for (const [k, n] of Object.entries(r.shopPartsByKeyAfter)) shopPartsByKeyAfter[k] = (shopPartsByKeyAfter[k] ?? 0) + n;
        const t = (byTier[b.tier] ??= { obstacles: 0, pre: 0, post: 0, drops: {}, shops: 0 });
        t.obstacles += r.obstacles;
        t.pre += r.pre >= 0 ? r.pre : 0;
        t.post += r.post;
        t.shops += r.shops;
        for (const [k, n] of Object.entries(r.drops)) t.drops[k] = (t.drops[k] ?? 0) + n;
      }
      for (const [k, n] of Object.entries(b.kits)) kits[k] = (kits[k] ?? 0) + n;
    }
    lastInfillReport = {
      buckets: buckets.size,
      obstacles: obsTotal,
      kept: keptTotal,
      full: false,
      pre: -1,
      post: postTotal,
      preShopShop: -1,
      postShopShop: postSS,
      candidates: candTotal,
      shopsBefore: shopsBeforeTotal,
      shops: shopTotal,
      shopParts: shopPartsTotal,
      shopPartsAfter: shopPartsAfterTotal,
      shopPartsByKey,
      shopPartsByKeyAfter,
      drops: dropTotals,
      kindBefore: kindBeforeTotals,
      kindAfter: kindAfterTotals,
      dropBy: dropByTotals,
      kits,
      byTier,
      shopSamples,
      wards: cells.map((c) => ({ cx: c.cx, cz: c.cz, half: c.half, tier: wardLod(c.cx, c.cz) })),
      ms: +(performance.now() - overlapT0).toFixed(1),
      msBreakdown: {
        pre: +tPreTotal.toFixed(1),
        greedy: +tGreedyTotal.toFixed(1),
        post: +tPostTotal.toFixed(1),
      },
    };
    if (typeof window !== 'undefined') {
      (window as unknown as { __infillDrop?: InfillDropReport }).__infillDrop = lastInfillReport;
    }
    }

    // ============ 全城小件（W26）：五类「全城只有几百到两万件」的构件改出全城一件 ============
    // 草顶 / 厦子 / 山墙 / 树干 / 窗光按 1200/600m 单元分桶后，每类在**每个可见单元**里各占一次
    // draw call：实测开场运镜峰值机位（cam −197,14,36）thatch 10 + shed 10 + gwall 10 + trunk 6 + glow 6
    // = 42 次，而五类实例合计 35,108 件 / 64.6 万面（静态几何的 2.2%）。按单元切块是纯亏。
    // 改出「全城一件」后恒为 5 个网格 ×（主相机 + 水面反射）2 个 pass = 10 次，实例逐件不变。
    // 其余种类仍分桶：它们的实例在十万级，必须靠分桶 + 视锥剔除把不可见部分整块省掉。
    const gTot = { thatch: 0, shed: 0, gwall: 0, trunk: 0, glow: 0 };
    for (const b of buckets.values()) {
      gTot.thatch += b.thatch.length;
      gTot.shed += b.sheds.length;
      gTot.gwall += b.gableWalls.length;
      gTot.trunk += b.trunks.length;
      gTot.glow += b.glows.length;
    }
    const gIdx = { thatch: 0, shed: 0, gwall: 0, trunk: 0, glow: 0 };
    const gThatch = gTot.thatch ? new THREE.InstancedMesh(thatchGeo, ROOF_THATCH, gTot.thatch) : null;
    const gShed = gTot.shed ? new THREE.InstancedMesh(shedGeo, ROOF, gTot.shed) : null;
    const gGwall = gTot.gwall ? new THREE.InstancedMesh(gableWallGeoRef, BODY, gTot.gwall) : null;
    const gTrunk = gTot.trunk ? new THREE.InstancedMesh(trunkGeo, TRUNK, gTot.trunk) : null;
    const gGlow = gTot.glow ? new THREE.InstancedMesh(winGeo, WIN, gTot.glow) : null;

    for (const [key, b] of buckets) {
      const tier = b.tier;
      // 包围球按桶内所有实例重新量一次（旧版用 house 的 min/max；新桶还有墙 / 树 / 灯）
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, total = 0;
      const acc = (x: number, z: number): void => {
        total++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      };
      for (const h of b.bodies) acc(h.x, h.z);
      for (const k of b.blocks) acc(k.x, k.z);
      for (const w of b.walls) acc(w.x, w.z);
      for (const w of b.slabs) acc(w.x, w.z);
      for (const w of b.trunks) acc(w.x, w.z);
      for (const w of b.leaves) acc(w.x, w.z);
      for (const w of b.fabrics) acc(w.x, w.z);
      for (const w of b.glows) acc(w.x, w.z);
      for (const w of b.furn) acc(w.x, w.z);
      for (const w of b.roads) acc(w.x, w.z);
      if (total === 0) continue;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const rad = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 24;
      // 每个桶自带真包围球并交回视锥剔除。旧版 3 个网格 frustumCulled=false，
      // 站进屋里的室内机位同样提交全部 24.9 万栋（实测 7573 万三角面）
      const bind = (im: THREE.InstancedMesh, name: string): THREE.InstancedMesh => {
        im.name = name;
        im.castShadow = false;
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 4, cz), rad);
        scene.add(im);
        return im;
      };
      // 底面锚点：几何都按底面在 y=0 建
      const put = (im: THREE.InstancedMesh, i: number, x: number, z: number, w: number, hh: number, d: number, y: number, ry: number): void => {
        e.set(0, ry, 0); q.setFromEuler(e);
        m.compose(v.set(x, y, z), q, s.set(w, hh, d));
        im.setMatrixAt(i, m);
      };
      // 中心锚点：winGeo 居中
      const putC = (im: THREE.InstancedMesh, i: number, g: Glow): void => {
        e.set(0, g.yaw, 0); q.setFromEuler(e);
        m.compose(v.set(g.x, g.y, g.z), q, s.set(g.w, g.h, g.d));
        im.setMatrixAt(i, m);
      };
      // 贴面小件：竖直件 local +Y = 世界 up、local +Z = 外法线；水平件（踏跺石）local +Z = up、local +Y = 朝外
      const bax = new THREE.Vector3(), bay = new THREE.Vector3(), baz = new THREE.Vector3();
      const putQuad = (im: THREE.InstancedMesh, i: number, f: Furn): void => {
        if (f.flat) {
          bay.set(f.nx, 0, f.nz);
          baz.set(0, 1, 0);
        } else {
          bay.set(0, 1, 0);
          baz.set(f.nx, 0, f.nz);
        }
        bax.crossVectors(bay, baz).normalize();
        m.makeBasis(bax, bay, baz);
        m.scale(s.set(f.w, f.h, 1));
        m.setPosition(f.x, f.y, f.z);
        im.setMatrixAt(i, m);
      };
      const flush = (im: THREE.InstancedMesh): void => {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      };
      const tag = b.court ? 'court' : 'infill';
      const lift = b.lift;
      // 运行时 LOD 四档 = 同一批 InstancedMesh 的可见子集（几何与实例数据零复制）：
      //   detail 只进近档（压顶石板、幌子/棚顶这类 0.1–1m 小件，120m 外本来就剩几个像素）
      //   struct 进近/中档（院墙、树、窗光）· mass 三档都留（体块与屋面：远档的骨架）
      // detail 还有第二重语义：**不进水面反射**。反射贴图 512² 覆盖 120×40m ≈ 0.23m/px，
      // 0.1–1m 的小件在反射里连一个像素都铺不满，却每个桶各占一次 draw call。
      const nearSet: THREE.Object3D[] = [];
      const midSet: THREE.Object3D[] = [];
      const farSet: THREE.Object3D[] = [];
      const keep = (im: THREE.InstancedMesh, kind: 'detail' | 'struct' | 'mass'): THREE.InstancedMesh => {
        nearSet.push(im);
        if (kind !== 'detail') midSet.push(im);
        else noReflect(im);
        if (kind === 'mass') farSet.push(im);
        return im;
      };

      // ---- 里坊院落：墙身 ----
      if (b.bodies.length) {
        const im = keep(bind(new THREE.InstancedMesh(bodyGeo, BODY, b.bodies.length), `${tag}_body_${key}`), 'mass');
        for (let i = 0; i < b.bodies.length; i++) {
          const h = b.bodies[i];
          put(im, i, h.x, h.z, h.w, h.h + (h.tk ?? 0.5), h.d, lift, h.yaw);
          im.setColorAt(i, c.setHex(h.bc));
        }
        flush(im);
        this.count.tris += b.bodies.length * T_BOX;
      }
      // ---- 正房屋顶：悬山/硬山两坡（举折 + 实体正脊 + 封头 + 檐口板）----
      // 落位三件事必须同一份纯函数：脊高 roofRise(w,d)、两山出挑 roofOverhangX(w)、前后檐 0.6。
      // 檐口落在墙顶 lift+h.h+0.5（墙体实例高 h.h+0.5，多出的 0.5 埋进地坪）——旧版比墙顶低 0.44m，
      // 墙从屋面里穿出来、屋面浮在墙上；这也是"房顶不对"的第一现场。
      const putRoof = (im: THREE.InstancedMesh, i: number, h: House): void => {
        const eo = Math.min(h.eo ?? ROOF_EAVE_OUT, ROOF_EAVE_OUT);
        const ex = Math.min(roofOverhangX(h.w), eo);
        // 下限 4cm：贴着地块界线的宅子若出檐为 0，檐口板会与墙面共面闪烁
        put(im, i, h.x, h.z, h.w + 2 * ex, roofRise(h.w, h.d), h.d + 2 * Math.max(0.04, eo), lift + h.h + 0.5, h.yaw);
        im.setColorAt(i, c.setHex(h.rc));
      };
      if (b.curved.length) {
        const im = keep(bind(new THREE.InstancedMesh(roofLiteGeo, ROOF, b.curved.length), `${tag}_roof_${key}`), 'mass');
        for (let i = 0; i < b.curved.length; i++) putRoof(im, i, b.curved[i]);
        flush(im);
        this.count.tris += b.curved.length * T_CURVED_LITE;
      }
      if (b.thatch.length && gThatch) {
        for (const h of b.thatch) putRoof(gThatch, gIdx.thatch++, h);
        this.count.tris += b.thatch.length * T_THATCH;
      }
      // ---- 山墙：墙色三角封头（BODY 材质）。屋顶两端本来就封死了内腔，
      //      这一片是让端头读成"山墙"而不是"一块瓦色三角" ----
      if (b.gableWalls.length && gGwall) {
        for (const g of b.gableWalls) {
          const i = gIdx.gwall++;
          // 山墙比墙皮再外扩 8cm：屋顶两端那块"瓦色封头"正好被墙色三角盖住，
          // 端头才读成"山墙"而不是"一块瓦"。悬山（出挑 0.34）仍露出一圈博风板。
          put(gGwall, i, g.x, g.z, g.w + 0.08, roofRise(g.w, g.d), g.d, g.y, g.yaw);
          gGwall.setColorAt(i, c.setHex(g.c));
        }
        this.count.tris += b.gableWalls.length * T_GWALL;
      }
      // ---- 单坡厦子（偏屋/杂屋）：坡向院内，高檐一侧带垂裙 ----
      if (b.sheds.length && gShed) {
        for (const g of b.sheds) {
          const i = gIdx.shed++;
          put(gShed, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          gShed.setColorAt(i, c.setHex(g.c));
        }
        this.count.tris += b.sheds.length * T_SHED;
      }
      // ---- tier2 简屋顶（8 面：两坡 + 脊带）----
      if (b.tents.length) {
        const im = keep(bind(new THREE.InstancedMesh(tentGeo, ROOF, b.tents.length), `${tag}_tent_${key}`), 'mass');
        for (let i = 0; i < b.tents.length; i++) {
          const g = b.tents[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.tents.length * T_TENT;
      }
      // ---- 里坊院落：厢房两坡顶 ----
      if (b.gables.length) {
        const im = keep(bind(new THREE.InstancedMesh(gableGeo, ROOF, b.gables.length), `${tag}_gable_${key}`), 'mass');
        for (let i = 0; i < b.gables.length; i++) {
          const g = b.gables[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.gables.length * T_GABLE;
      }
      // ---- 远档体块（tier3）：只剩剪影，箱体直接用瓦色（俯视看到的就是屋面）----
      // tier1/2 已改出简院，不再走这里（简院 = bodies 3 + gables 1）
      if (b.blocks.length) {
        const bm = keep(bind(new THREE.InstancedMesh(bodyGeo, ROOF, b.blocks.length), `${tag}_block_${key}`), 'mass');
        const fm = keep(bind(new THREE.InstancedMesh(roofUnitFar(), ROOF, b.blocks.length), `${tag}_blockroof_${key}`), 'mass');
        const T_FAR = 12;
        for (let i = 0; i < b.blocks.length; i++) {
          const k = b.blocks[i];
          put(bm, i, k.x, k.z, k.w, k.h, k.d, lift, k.yaw);
          bm.setColorAt(i, c.setHex(k.rc));
          // 远档屋顶：只给「脊线 + 檐口暗边」，一栋 12 面，让 3km 外也读得出是屋顶不是盒子
          put(fm, i, k.x, k.z, k.w * 1.16 + 0.6, Math.min(k.w, k.d) * 0.32 + 0.6, k.d * 1.14 + 0.6,
            lift + k.h + 0.02, k.yaw);
          fm.setColorAt(i, c.setHex(k.rc));
        }
        flush(bm); flush(fm);
        this.count.tris += b.blocks.length * (T_BOX + T_FAR);
        this.count.blocks += b.blocks.length;
      }
      // ---- 院墙 / 压顶 / 灯柱 / 井台 ----
      if (b.walls.length) {
        const im = keep(bind(new THREE.InstancedMesh(bodyGeo, EARTH, b.walls.length), `${tag}_wall_${key}`), 'struct');
        for (let i = 0; i < b.walls.length; i++) {
          const g = b.walls[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.walls.length * T_BOX;
        this.count.wallPieces += b.walls.length;
      }
      // ---- 巷道地坪：同一套 box，车辙 / 路心 / 石板缝 / 散水由 roadHook 按实例米制尺度画 ----
      if (b.roads.length) {
        const im = keep(bind(new THREE.InstancedMesh(bodyGeo, ROAD, b.roads.length), `${tag}_road_${key}`), 'struct');
        for (let i = 0; i < b.roads.length; i++) {
          const g = b.roads[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.roads.length * T_BOX;
      }
      if (b.slabs.length) {
        const im = keep(bind(new THREE.InstancedMesh(eaveGeo, ROOF, b.slabs.length), `${tag}_slab_${key}`), 'detail');
        for (let i = 0; i < b.slabs.length; i++) {
          const g = b.slabs[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.slabs.length * T_EAVE;
      }
      if (b.trunks.length && gTrunk) {
        for (const g of b.trunks) {
          const i = gIdx.trunk++;
          put(gTrunk, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          gTrunk.setColorAt(i, c.setHex(g.c));
        }
        this.count.tris += b.trunks.length * T_TRUNK;
        this.count.decor += b.trunks.length;
      }
      if (b.leaves.length) {
        // 近档 42 面/团、中档 20 面/团：几何按桶档位选，一个桶里不会混两档
        const leafGeo = tier >= 1 ? leafMidGeo : leafNearGeo;
        const T_LEAF = tier >= 1 ? T_LEAF_MID : T_LEAF_NEAR;
        const im = keep(bind(new THREE.InstancedMesh(leafGeo, LEAF, b.leaves.length), `${tag}_leaf_${key}`), 'struct');
        for (let i = 0; i < b.leaves.length; i++) {
          const g = b.leaves[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.leaves.length * T_LEAF;
        this.count.decor += b.leaves.length;
      }
      if (b.fabrics.length) {
        const im = keep(bind(new THREE.InstancedMesh(fabricGeo, FABRIC, b.fabrics.length), `${tag}_fabric_${key}`), 'detail');
        for (let i = 0; i < b.fabrics.length; i++) {
          const g = b.fabrics[i];
          put(im, i, g.x, g.z, g.w, g.h, g.d, g.y, g.yaw);
          im.setColorAt(i, c.setHex(g.c));
        }
        flush(im);
        this.count.tris += b.fabrics.length * T_FAB;
      }
      if (b.glows.length && gGlow) {
        for (const g of b.glows) {
          const i = gIdx.glow++;
          putC(gGlow, i, g);
          gGlow.setColorAt(i, c.setHex(g.c));
        }
        this.count.win += b.glows.length;
        this.count.tris += b.glows.length * T_WIN;
      }
      // ---- 门窗 / 踏跺石：2 面/件 + 实例属性 aFurn（kind, seed, 亮度）----
      // 几何必须逐桶克隆：aFurn 是实例属性，挂在共享几何上会被后一个桶覆盖
      if (b.furn.length) {
        const fg = furnQuad().clone();
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(b.furn.length * 3), 3);
        for (let i = 0; i < b.furn.length; i++) {
          const f = b.furn[i];
          attr.setXYZ(i, f.kind, f.seed, 0.30 + 0.70 * h01(Math.round(f.x), Math.round(f.z), 7840));
        }
        fg.setAttribute('aFurn', attr);
        const im = keep(bind(new THREE.InstancedMesh(fg, FURN, b.furn.length), `${tag}_furn_${key}`), 'struct');
        for (let i = 0; i < b.furn.length; i++) putQuad(im, i, b.furn[i]);
        flush(im);
        this.count.tris += b.furn.length * T_FURN;
      }
      // 交给 LodManager：中心 + 外沿半跨 + 三档可见子集。极远档不出几何，由管理器的共享剪影卡顶上。
      registerInstancedLod({
        id: `${tag}_${key}`,
        cx, cy: 4, cz,
        hx: (maxX - minX) / 2 + 2, hy: 16, hz: (maxZ - minZ) / 2 + 2,
        tiers: { near: nearSet, mid: midSet, far: farSet, impostor: [] },
        card: { w: Math.max(80, (maxX - minX) * 0.95), h: 18 },
      });
    }
    // 全城小件落盘：包围球按实例实算，仍受视锥剔除（只是不再按单元切块）。
    const mountGlobal = (im: THREE.InstancedMesh | null, name: string): void => {
      if (!im) return;
      im.name = name;
      im.castShadow = false;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
    };
    mountGlobal(gThatch, 'ward_all_thatch');
    mountGlobal(gShed, 'ward_all_shed');
    mountGlobal(gGwall, 'ward_all_gwall');
    mountGlobal(gTrunk, 'ward_all_trunk');
    mountGlobal(gGlow, 'ward_all_glow');
    this.count.courtWards = wards.length;
    this.count.yards = 0;
    for (const b of buckets.values()) this.count.yards += b.yards + b.simpleYards;
    this.count.body = this.count.blocks;
    for (const b of buckets.values()) this.count.body += b.bodies.length + b.gables.length;
    this.count.roof = this.count.body;
  }
}

// ============ 城外郊野：田垄 / 村落 / 土路 / 山体细节 ============
// 尺度事实：外郭墙在 ±5000，里坊占 |x|,|z| 920–4880，|x|<950 是手工城区与中央留白。
// 因此田地只落两处无建筑地带：城内中轴留白走廊（|x|≤880）与郭墙外（≥5290），不与民居争地。

export interface CountrysideMarks { fields: { x: number; z: number; r: number }[] }
type Sampler = (x: number, z: number) => number;
type WaterFn = (x: number, z: number) => number | null;

interface Band { cx: number; cz: number; hx: number; hz: number; yaw: number }
interface FieldTone { ridge: number; furrow: number; bund: number }

const FIELD_TONES: FieldTone[] = [
  { ridge: 0xb49a68, furrow: 0x6f5c40, bund: 0x8a7650 }, // 熟土
  { ridge: 0x74823c, furrow: 0x4a5528, bund: 0x6a5c3c }, // 麦苗
  { ridge: 0xc2a45e, furrow: 0x806b3c, bund: 0x8f7a4c }, // 稻茬
  { ridge: 0x8f7a54, furrow: 0x554730, bund: 0x6f5c42 }, // 湿土
];

// 原四段走廊带落在 |x| 44–876、|z| 470–2880，是皇城御街轴线（城内地块），
// 铺条田等于在宫前种稻；已清空，只保留外郭墙外的田带
const CORRIDOR_Z: [number, number][] = [];

const COUNTRY_VILLAGES: { x: number; z: number; n: number; yaw: number; tile: boolean }[] = [
  // 城内轴线上的两处村（-520,1560 / 430,2340 / -430,-1560 / 300,-2340）已移除，只留墙外村落
  { x: 5600, z: -420, n: 5, yaw: 1.15, tile: false },
  { x: -5560, z: 1120, n: 4, yaw: -0.85, tile: true },
];

const COUNTRY_ROADS: [number, number][][] = [
  // 城内轴线的两条土路随村一并移除（原 R1/R2 从 (60,440) 一路穿过御街）
  [[5060, 0], [5320, -170], [5600, -420], [5790, -980], [5870, -1580]],
  [[-5060, 0], [-5320, 430], [-5560, 1120], [-5620, 1800]],
];

// 5.3–7.6km 环内三处真实起伏：七大岳都在 14km 外，这三处才是"近景山"
const NEAR_HILLS: [number, number][] = [[4700, 5800], [5300, -5100], [-3900, 5900]];

const L_TONE = 0x6b4a2b;

function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function nearPts(x: number, z: number, pts: [number, number][], r: number): boolean {
  const r2 = r * r;
  for (const [px, pz] of pts) {
    const dx = x - px, dz = z - pz;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

function onRoad(cx: number, cz: number, yaw: number, len: number, wid: number, pts: [number, number][]): boolean {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const hu = len / 2 + 4.5, hv = wid / 2 + 4.5;
  for (const [px, pz] of pts) {
    const dx = px - cx, dz = pz - cz;
    if (Math.abs(dx * ca - dz * sa) < hu && Math.abs(dx * sa + dz * ca) < hv) return true;
  }
  return false;
}

function fieldPlot(b: Baker, cx: number, cz: number, yaw: number, len: number, wid: number, tone: FieldTone, sampleY: Sampler): boolean {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const at = (u: number, v: number): [number, number] => [cx + u * ca + v * sa, cz - u * sa + v * ca];
  let mn = Infinity, mx = -Infinity;
  for (const [u, v] of [[-len / 2, -wid / 2], [len / 2, -wid / 2], [-len / 2, wid / 2], [len / 2, wid / 2], [0, 0]] as const) {
    const [px, pz] = at(u, v);
    const y = sampleY(px, pz);
    if (y < mn) mn = y;
    if (y > mx) mx = y;
  }
  if (mx - mn > 1.5 || mx > 95 || mn < -5) return false;
  const top = mx + 0.04;
  b.box('ground', len, 1.6, wid, cx, top - 0.78, cz, tone.furrow, yaw);
  const nR = Math.max(3, Math.round((wid - 1) / 1.7));
  for (let k = 0; k < nR; k++) {
    const v = -wid / 2 + 1 + k * ((wid - 2) / (nR - 1));
    const [px, pz] = at(0, v);
    b.box('earth', len - 1.4, 0.16, 0.82, px, top + 0.09, pz, shade(tone.ridge, 0.92 + (k % 3) * 0.06), yaw);
  }
  for (const s of [-1, 1]) {
    const [px, pz] = at(0, s * (wid / 2 + 0.24));
    b.box('earth', len + 0.7, 0.3, 0.5, px, top + 0.03, pz, tone.bund, yaw);
    const [ex, ez] = at(s * (len / 2 + 0.24), 0);
    b.box('earth', 0.5, 0.3, wid + 0.2, ex, top + 0.03, ez, shade(tone.bund, 0.95), yaw);
  }
  b.kit('country.field', 1, top);
  b.kit('country.ridge', nR, top + 0.09);
  b.kit('country.bund', 4, top + 0.03);
  return true;
}

function layBand(
  b: Baker, rng: RNG, band: Band, sampleY: Sampler, waterAt: WaterFn,
  roadPts: [number, number][], villages: { x: number; z: number }[], marks: CountrysideMarks,
): void {
  const ca = Math.cos(band.yaw), sa = Math.sin(band.yaw);
  const at = (u: number, v: number): [number, number] => [band.cx + u * ca + v * sa, band.cz - u * sa + v * ca];
  let v = -band.hz + 5;
  while (v + 18 < band.hz - 5) {
    const wid = rng.range(15, 26);
    if (v + wid > band.hz - 5) break;
    const rowSkip = rng.chance(0.22);
    let u = -band.hx + 5;
    while (u + 70 < band.hx - 5) {
      const len = rng.range(80, 200);
      if (u + len > band.hx - 5) break;
      const uc = u + len / 2, vc = v + wid / 2;
      u += len + rng.range(10, 24);
      if (rowSkip || rng.chance(0.12)) continue;
      const [px, pz] = at(uc, vc);
      let near = false;
      for (const vv of villages) if (Math.hypot(px - vv.x, pz - vv.z) < 560) { near = true; break; }
      if (!near) near = nearPts(px, pz, roadPts, 300);
      if (!near) continue;
      let bad = false;
      for (const vv of villages) if (Math.hypot(px - vv.x, pz - vv.z) < 62 + Math.max(len, wid) * 0.4) { bad = true; break; }
      if (bad) continue;
      if (onRoad(px, pz, band.yaw, len, wid, roadPts)) continue;
      for (const [du, dv] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]] as const) {
        const [qx, qz] = at(uc + du * len, vc + dv * wid);
        if (waterAt(qx, qz) !== null) { bad = true; break; }
      }
      if (bad) continue;
      const tone = FIELD_TONES[rng.int(0, FIELD_TONES.length - 1)];
      if (fieldPlot(b, px, pz, band.yaw, len, wid, tone, sampleY)) {
        marks.fields.push({ x: px, z: pz, r: Math.hypot(len, wid) * 0.5 });
      }
    }
    v += wid + rng.range(2.4, 3.0);
  }
}

function household(b: Baker, rng: RNG, x: number, z: number, yaw: number, sampleY: Sampler, tile: boolean): void {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const at = (u: number, v: number): [number, number] => [x + u * ca + v * sa, z - u * sa + v * ca];
  const g = (u: number, v: number): number => { const [px, pz] = at(u, v); return sampleY(px, pz); };
  const L = 13, D = 11;
  const wallC = shade(0xa98a5e, rng.range(0.88, 1.06));
  // 夯土院墙：正面留门洞
  for (const s of [-1, 1]) {
    const [px, pz] = at(s * (L / 4 + 0.85), -D / 2);
    b.box('earth', L / 2 - 1.7, 2.0, 0.42, px, g(s * (L / 4 + 0.85), -D / 2) + 1.0, pz, wallC, yaw);
  }
  const [bx, bz] = at(0, D / 2);
  b.box('earth', L, 2.0, 0.42, bx, g(0, D / 2) + 1.0, bz, shade(wallC, 0.96), yaw);
  for (const s of [-1, 1]) {
    const [px, pz] = at(s * L / 2, 0);
    b.box('earth', 0.42, 2.0, D, px, g(s * L / 2, 0) + 1.0, pz, shade(wallC, 0.93), yaw);
  }
  b.kit('country.houseWall', 4, g(0, 0) + 1.0);
  // 门楼：门柱 + 门楣 + 小披檐
  for (const s of [-1, 1]) {
    const [px, pz] = at(s * 1.15, -D / 2);
    b.box('wood', 0.22, 2.4, 0.22, px, g(s * 1.15, -D / 2) + 1.2, pz, L_TONE, yaw);
  }
  const [lx, lz] = at(0, -D / 2);
  const ly = g(0, -D / 2);
  b.box('wood', 2.9, 0.22, 0.34, lx, ly + 2.45, lz, L_TONE, yaw);
  b.roofC('roof', lx, ly + 2.55, lz, 0x7d6a48, yaw, 3.8, 0.85, 1.7);
  // 主屋
  const [hx, hz] = at(0, 1.4);
  const hy = g(0, 1.4);
  b.box('earth', 8.6, 3.4, 5.8, hx, hy + 1.7, hz, shade(0xc0a274, rng.range(0.92, 1.05)), yaw);
  b.kit('country.house', 1, hy);
  b.roofC('roof', hx, hy + 3.4, hz, tile ? shade(0x5f6a78, rng.range(0.9, 1.1)) : shade(0xb59a6a, rng.range(0.9, 1.08)), yaw, 12.4, tile ? 2.2 : 2.7, 9.0);
  b.kit(tile ? 'country.tileRoof' : 'country.thatch', 1, hy + 3.4);
  // 门窗
  const [dx, dz] = at(0, -1.5);
  b.box('trunk', 1.9, 2.1, 0.16, dx, hy + 1.05, dz, 0x2b2118, yaw);
  for (const s of [-1, 1]) {
    const [wx, wz] = at(s * 2.7, -1.5);
    b.box('trunk', 0.9, 0.9, 0.14, wx, hy + 2.0, wz, 0x241c14, yaw);
  }
  // 烟囱
  const [cx2, cz2] = at(2.9, 3.2);
  b.box('ash', 0.55, 1.5, 0.55, cx2, hy + 4.0, cz2, 0x87816f, yaw);
  b.kit('country.chimney', 1, hy + 4.0);
  // 柴垛
  const [wx0, wz0] = at(-4.9, -3.2);
  const wy = g(-4.9, -3.2);
  b.box('wood', 2.4, 0.22, 1.6, wx0, wy + 0.11, wz0, 0x6a4c2e, yaw);
  for (let k = 0; k < 6; k++) {
    const row = Math.floor(k / 2), col = k % 2;
    const [lx2, lz2] = at(-4.9 + (col - 0.5) * 0.32, -3.2 + (row - 0.5) * 0.34);
    b.box('trunk', 2.2, 0.28, 0.28, lx2, wy + 0.34 + row * 0.26, lz2, shade(0x5a4128, 0.9 + (k % 3) * 0.08), yaw);
  }
  for (const s of [-1, 1]) {
    const [sx2, sz2] = at(-4.9 + s * 1.15, -3.2);
    b.box('trunk', 0.1, 1.3, 0.1, sx2, wy + 0.65, sz2, 0x4a3620, yaw);
  }
  b.kit('country.woodpile', 1, wy);
  // 篱笆
  const [fx0, fz0] = at(4.6, -3.4);
  const fy = g(4.6, -3.4);
  for (let k = 0; k < 5; k++) {
    const [px, pz] = at(4.6 + (k - 2) * 0.9, -3.4);
    b.box('wood', 0.1, 1.15, 0.1, px, fy + 0.58, pz, 0x6a4c2e, yaw);
  }
  for (const s of [0.45, 0.95]) b.box('wood', 3.8, 0.08, 0.08, fx0, fy + s, fz0, 0x7a5a34, yaw);
  b.kit('country.fence', 1, fy);
  // 水缸
  const [jx, jz] = at(4.9, 2.6);
  b.cyl('ceramic', 0.24, 0.32, 0.8, 8, jx, g(4.9, 2.6) + 0.4, jz, 0x6a7a86);
}

function villageCommons(b: Baker, rng: RNG, vx: number, vz: number, yaw: number, sampleY: Sampler): void {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const at = (u: number, v: number): [number, number] => [vx + u * ca + v * sa, vz - u * sa + v * ca];
  // 水井
  const [wx, wz] = at(3.6, 4.8);
  const wy = sampleY(wx, wz);
  b.cyl('ash', 1.02, 1.08, 0.9, 8, wx, wy + 0.42, wz, 0x8a8478);
  b.cyl('trunk', 0.84, 0.84, 0.06, 8, wx, wy + 0.9, wz, 0x1b2420);
  for (const s of [-1, 1]) b.box('wood', 0.16, 1.9, 0.16, wx + s * 0.86, wy + 1.75, wz, L_TONE);
  b.box('wood', 2.1, 0.14, 0.16, wx, wy + 2.6, wz, L_TONE);
  b.cyl('wood', 0.17, 0.17, 0.32, 8, wx, wy + 2.25, wz, 0x7a5a34, 0, 0, Math.PI / 2);
  b.box('wood', 0.3, 0.34, 0.3, wx + 0.62, wy + 1.05, wz, 0x5a4028);
  b.kit('country.well', 1, wy);
  // 晒场：石碾 + 谷堆 + 草垛
  const [sx, sz] = at(0, -30);
  const sy = sampleY(sx, sz);
  b.box('ground', 24, 0.14, 16, sx, sy + 0.06, sz, 0xb8a582, yaw);
  b.cyl('ash', 0.9, 0.9, 1.5, 10, sx, sy + 0.85, sz, 0x8b857a, 0, 0, Math.PI / 2);
  b.box('wood', 2.2, 0.12, 0.12, sx, sy + 1.62, sz, 0x6a4c2e, yaw);
  for (const [ox, oz] of [[-6, 3], [5.5, -3.5]] as const) {
    const [gx, gz] = at(ox, -30 + oz);
    b.pyramid('earth', 0.25, 2.1, gx, sampleY(gx, gz) + 0.6, gz, 0xc0a260, yaw, 1, 1.2, 1);
  }
  for (const [ox, oz] of [[7, 4], [-8, -4]] as const) {
    const [hx, hz] = at(ox, -30 + oz);
    const hy = sampleY(hx, hz);
    b.cyl('roof', 0.06, 1.5, 2.0, 8, hx, hy + 1.0, hz, 0xa88f5e);
    b.kit('country.haystack', 1, hy);
  }
  b.kit('country.threshing', 1, sy);
  // 村口树
  for (const [ox, oz] of [[-14, 28], [16, 27], [0, -46]] as const) {
    const [tx, tz] = at(ox, oz);
    const ty = sampleY(tx, tz);
    b.cyl('trunk', 0.22, 0.34, 3.4, 6, tx, ty + 1.7, tz, 0x4a3620);
    b.pyramid('leaf', 0.2, 2.3, tx, ty + 3.4, tz, 0x35592f, rng.range(0, 3), 1, 2.6, 1);
    b.pyramid('leaf', 0.15, 1.6, tx, ty + 5.2, tz, 0x3d6635, rng.range(0, 3), 1, 1.9, 1);
    b.kit('country.tree', 1, ty);
  }
}

function buildVillage(b: Baker, rng: RNG, v: { x: number; z: number; n: number; yaw: number; tile: boolean }, sampleY: Sampler, waterAt: WaterFn): number {
  const ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
  const at = (u: number, vv: number): [number, number] => [v.x + u * ca + vv * sa, v.z - u * sa + vv * ca];
  let built = 0;
  for (let i = 0; i < v.n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const [hx, hz] = at((i - (v.n - 1) / 2) * 26, side * 15);
    if (waterAt(hx, hz) !== null) continue;
    household(b, rng, hx, hz, v.yaw + (side > 0 ? Math.PI : 0), sampleY, v.tile);
    built++;
  }
  if (waterAt(v.x, v.z) === null) villageCommons(b, rng, v.x, v.z, v.yaw, sampleY);
  b.kit('country.village', built, sampleY(v.x, v.z));
  return built;
}

function buildRoad(b: Baker, sampleY: Sampler, pts: [number, number][]): number {
  let segs = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 12));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const yaw = Math.atan2(-(z1 - z0), x1 - x0);
      const top = (sampleY(x0, z0) + sampleY(x1, z1)) * 0.5 + 0.01;
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.6;
      b.box('ground', len, 1.6, 3.6, mx, top - 0.8, mz, 0x93805c, yaw);
      for (const o of [-0.82, 0.82]) {
        b.box('earth', len, 0.06, 0.34, mx + Math.sin(yaw) * o, top + 0.008, mz + Math.cos(yaw) * o, 0x5a4934, yaw);
      }
      b.kit('country.road', 1, top);
      b.kit('country.rut', 2, top + 0.008);
      segs++;
    }
  }
  return segs;
}

function hillDetail(b: Baker, rng: RNG, cx: number, cz: number, sampleY: Sampler): void {
  let px = cx, pz = cz, peak = -1e9;
  for (let dz = -650; dz <= 650; dz += 50) for (let dx = -650; dx <= 650; dx += 50) {
    const x = cx + dx, z = cz + dz;
    if (Math.hypot(x, z) < 5200) continue;
    const y = sampleY(x, z);
    if (y > peak) { peak = y; px = x; pz = z; }
  }
  if (peak < 10) return;
  // 山脊线：沿最能延续高度的方向双向走，岩齿随脊线倾斜
  let bestH = -1e9, ba = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const h = sampleY(px + Math.cos(a) * 180, pz + Math.sin(a) * 180);
    if (h > bestH) { bestH = h; ba = a; }
  }
  const dx = Math.cos(ba), dz = Math.sin(ba);
  for (const s of [1, -1]) {
    for (let k = 1; k <= 8; k++) {
      const x = px + dx * s * 130 * k, z = pz + dz * s * 130 * k;
      const y = sampleY(x, z);
      if (y < peak * 0.5) break;
      const yaw = Math.atan2(-dz * s, dx * s);
      for (let t = 0; t < 2; t++) {
        const ox = rng.range(-26, 26), oz = rng.range(-26, 26);
        const yy = sampleY(x + ox, z + oz);
        const w = rng.range(14, 30), hh = rng.range(3.0, 7.5), dd = rng.range(8, 16);
        b.box('ash', w, hh, dd, x + ox, yy + hh * 0.34, z + oz, shade(0x6b665c, rng.range(0.84, 1.14)), yaw + rng.range(-0.35, 0.35), rng.range(-0.12, 0.12), 0);
      }
      b.kit('country.ridgeLine', 2, y);
    }
  }
  // 裸岩带：峰高一半处的等高岩被
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2 + rng.range(-0.05, 0.05);
    let r = 100, y = peak, hit = false;
    while (r < 1900) {
      y = sampleY(px + Math.cos(a) * r, pz + Math.sin(a) * r);
      if (y < peak * 0.52) { hit = true; break; }
      r += 40;
    }
    if (!hit) continue;
    const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
    const w = rng.range(20, 40);
    b.box('ash', w, 0.9, w * rng.range(0.45, 0.9), x, y + 0.2, z, shade(0x7d766a, rng.range(0.88, 1.1)), -a, 0, rng.range(-0.05, 0.05));
    b.kit('country.bareRock', 1, y);
  }
  // 山脚碎石带
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    let r = 200, y = peak, hit = false;
    while (r < 2400) {
      y = sampleY(px + Math.cos(a) * r, pz + Math.sin(a) * r);
      if (y < peak * 0.16) { hit = true; break; }
      r += 50;
    }
    if (!hit) continue;
    for (let t = 0; t < 4; t++) {
      const rr = r + rng.range(0, 90);
      const x = px + Math.cos(a) * rr + rng.range(-20, 20);
      const z = pz + Math.sin(a) * rr + rng.range(-20, 20);
      const yy = sampleY(x, z);
      const s = rng.range(0.9, 2.4);
      b.box('ash', s * 1.5, s * 0.8, s, x, yy + s * 0.22, z, shade(0x8b857a, rng.range(0.82, 1.12)), rng.range(0, 3.14), 0, rng.range(-0.2, 0.2));
      b.kit('country.scree', 1, yy);
    }
  }
  b.kit('country.hill', 1, peak);
}

/** 近郊菜畦：城墙与中轴留白之间的空地，补 countryside 机位的近景 */
function gardenBeds(b: Baker, rng: RNG, sampleY: Sampler, waterAt: WaterFn): void {
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 22; i++) {
      const x = sx * rng.range(706, 880);
      const z = rng.range(150, 440);
      if (waterAt(x, z) !== null) continue;
      const y = sampleY(x, z);
      if (y < -3 || y > 5) continue;
      const len = rng.range(7, 12), wid = rng.range(3, 5);
      const c = rng.pick([0x6d7a3c, 0x7d8a46, 0x8a7a48, 0x5f6e34]);
      b.kit('ground.infill', 1, y);
      b.box('ground', len, 0.34, wid, x, y + 0.03, z, c);
      for (const s of [-1, 1]) b.box('earth', len + 0.5, 0.18, 0.24, x, y + 0.13, z + s * (wid / 2 + 0.12), 0x7a6644);
      b.kit('country.garden', 1, y + 0.03);
    }
  }
}

// ============ 皇城御街走廊：御街铺装 / 御廊 / 行道树 / 牌坊 / 石栏与灯 ============
// 城市中轴 |x|≤876、|z| 470–2880 是御街轴线，不是农田（原四段稻田带已清空，只剩裸土）。
// 竖向基准：imperial.ts 的大内御街石板顶面 0.14，横贯整条中轴，本层石铺必须压到 0.16（+0.02），
// 否则 16m 新铺装会被 26m 旧板整条盖住；城内地表被 terrainSurfaceY 下沉到 -0.5，只给树池/台明落地用。
const AVE_Z0 = 470;
const AVE_Z1 = 2880;
const AVE_HALF = 8;
const AVE_DECK = 0.16;
const AVE_DADO = 0.38;
// imperial.ts 的横街（14m 宽、顶面 0.12）横穿走廊：御廊/石栏在这里断口，台明压低成过街石
const AVE_CROSS = [900, 1700, 2500];
// 牌坊：南北各 4 座（z=470→2880 共 2410m，四座即约 600m 一跨）
const AVE_PAIFANG = [780, 1380, 1980, 2580];

const AVE_STONE = 0x9a9384;
const AVE_STONE_D = 0x827c6e;
const AVE_DADO_C = 0x8d8778;
const AVE_CINNABAR = 0x9c3a2c;
const AVE_TILE = 0x5e6878;
const AVE_DECK_C = 0xa9a08f;

function avenueCross(z: number, pad = 0): boolean {
  const az = Math.abs(z);
  for (const p of AVE_CROSS) if (Math.abs(az - p) < 7 + pad) return true;
  return false;
}

function avenueNode(z: number, pad = 0): boolean {
  if (avenueCross(z, pad)) return true;
  const az = Math.abs(z);
  for (const p of AVE_PAIFANG) if (Math.abs(az - p) < 5 + pad) return true;
  return false;
}

/** 从 bot 到 top 的板：Baker.box 的 y 是中心，统一收口，免得每处手算中心 */
function plate(b: Baker, g: BGroup, w: number, d: number, x: number, z: number, bot: number, top: number, hex: number, ry = 0): void {
  b.box(g, w, top - bot, d, x, (bot + top) * 0.5, z, hex, ry);
}

/** 御街：16m 石铺 + 每 6m 横向分缝 + 两道车辙暗条 */
function avenueDeck(b: Baker, sz: number): void {
  const L = AVE_Z1 - AVE_Z0;
  for (let t = 0; t < L; t += 6) {
    const k = t / 6;
    plate(b, 'ground', AVE_HALF * 2, 5.9, 0, sz * (AVE_Z0 + t + 3), AVE_DECK - 0.06, AVE_DECK, shade(AVE_DECK_C, 0.96 + (k % 3) * 0.025));
    b.kit('avenue.deck', 1, AVE_DECK);
    plate(b, 'ground', AVE_HALF * 2, 0.2, 0, sz * (AVE_Z0 + t), AVE_DECK - 0.004, AVE_DECK + 0.006, 0x6c6357);
    b.kit('avenue.deckJoint', 1, AVE_DECK);
  }
  plate(b, 'ground', AVE_HALF * 2, 0.2, 0, sz * AVE_Z1, AVE_DECK - 0.004, AVE_DECK + 0.006, 0x6c6357);
  b.kit('avenue.deckJoint', 1, AVE_DECK);
  for (const rx of [-1.55, 1.55]) {
    for (let t = 0; t < L; t += 12) {
      plate(b, 'ground', 0.62, 11.7, rx, sz * (AVE_Z0 + t + 6), AVE_DECK - 0.012, AVE_DECK + 0.002, 0x6a6157);
      b.kit('avenue.rut', 1, AVE_DECK);
    }
  }
}

/** 石栏：街心两侧 ±7.85，望柱每 4m，寻杖 + 地栿 + 栏板每 12m 一联 */
function avenueRail(b: Baker, sz: number): void {
  const L = AVE_Z1 - AVE_Z0;
  for (const sx of [-1, 1]) {
    const x = sx * 7.85;
    for (let t = 0; t <= L; t += 4) {
      const z = sz * (AVE_Z0 + t);
      if (avenueNode(z)) continue;
      plate(b, 'ash', 0.26, 0.26, x, z, AVE_DECK, AVE_DECK + 0.94, AVE_STONE);
      b.box('ash', 0.36, 0.18, 0.36, x, AVE_DECK + 1.03, z, AVE_STONE_D);
      b.kit('avenue.baluster', 1, AVE_DECK);
    }
    for (let t = 0; t < L; t += 12) {
      const zc = sz * (AVE_Z0 + t + 6);
      if (avenueNode(zc)) continue;
      plate(b, 'ash', 0.24, 12.1, x, zc, AVE_DECK + 0.74, AVE_DECK + 0.9, AVE_STONE);
      plate(b, 'ash', 0.32, 12.1, x, zc, AVE_DECK, AVE_DECK + 0.2, AVE_STONE_D);
      plate(b, 'ash', 0.1, 12.1, x, zc, AVE_DECK + 0.24, AVE_DECK + 0.62, AVE_STONE);
      b.kit('avenue.railing', 3, AVE_DECK);
    }
  }
}

/** 御廊：距街心 11.1 一道，柱距 4m / 柱高 4.2m / 单坡顶 3m 进深，内高外低 */
function avenueColonnade(b: Baker, sz: number): void {
  const L = AVE_Z1 - AVE_Z0;
  const BAY = 4;
  for (const sx of [-1, 1]) {
    const xi = sx * 9.6, xo = sx * 12.6, xc = sx * 11.1;
    for (let t = 0; t < L; t += 8) {
      const zc = sz * (AVE_Z0 + t + 4);
      const top = avenueCross(zc, 4) ? 0.14 : AVE_DADO;
      plate(b, 'ash', 3.6, 7.95, xc, zc, top - 0.5, top, AVE_DADO_C);
      b.kit('avenue.dado', 1, top);
    }
    for (let t = 0; t <= L; t += BAY) {
      const z = sz * (AVE_Z0 + t);
      if (avenueNode(z)) continue;
      for (const x of [xi, xo]) {
        b.box('ash', 0.46, 0.1, 0.46, x, AVE_DADO + 0.05, z, AVE_DADO_C);
        b.cyl('wood', 0.15, 0.19, 4.2, 6, x, AVE_DADO + 2.1, z, AVE_CINNABAR);
      }
      b.box('wood', 3.24, 0.2, 0.26, xc, AVE_DADO + 4.14, z, shade(AVE_CINNABAR, 0.86));
      b.box('wood', 0.24, 0.74, 0.24, xi, AVE_DADO + 4.93, z, shade(AVE_CINNABAR, 0.8));
      b.kit('avenue.colonnadePost', 2, AVE_DADO);
      b.kit('avenue.colonnadeStrut', 1, AVE_DADO + 4.56);
    }
    for (let t = 0; t < L; t += 8) {
      const zc = sz * (AVE_Z0 + t + 4);
      if (avenueNode(zc)) continue;
      for (const x of [xi, xo]) plate(b, 'wood', 0.3, 8.05, x, zc, AVE_DADO + 4.2, AVE_DADO + 4.56, shade(AVE_CINNABAR, 0.92));
      b.kit('avenue.colonnadeBeam', 2, AVE_DADO + 4.2);
    }
    for (let t = 0; t < L; t += BAY) {
      const zc = sz * (AVE_Z0 + t + 2);
      if (avenueNode(zc)) continue;
      b.box('roof', 3.7, 0.2, 4.06, xc, 5.42, zc, shade(AVE_TILE, 0.94 + (t / BAY % 3) * 0.04), 0, 0, -0.2 * sx);
      b.box('roof', 0.34, 0.3, 4.06, xi - sx * 0.3, 5.88, zc, shade(AVE_TILE, 0.8));
      b.box('roof', 0.22, 0.36, 4.06, xo + sx * 0.35, 4.9, zc, shade(AVE_TILE, 0.72));
      b.kit('avenue.colonnadeRoof', 3, 5.4);
    }
  }
}

/** 廊下长凳与吊灯（每 24m 一组，长凳靠外柱、吊灯吊在横梁中点） */
function avenueColonnadeFurniture(b: Baker, sz: number): void {
  const L = AVE_Z1 - AVE_Z0;
  for (const sx of [-1, 1]) {
    for (let t = 0; t < L; t += 24) {
      const zb = sz * (AVE_Z0 + t + 6);
      if (!avenueNode(zb, 2)) {
        plate(b, 'wood', 0.66, 2.6, sx * 11.9, zb, 0.78, 0.9, 0x7a5a34);
        for (const oz of [-1.0, 1.0]) b.box('wood', 0.5, 0.4, 0.16, sx * 11.9, 0.58, zb + oz, 0x5f4526);
        b.kit('avenue.bench', 1, AVE_DADO);
      }
      const zl = sz * (AVE_Z0 + t + 18);
      if (!avenueNode(zl, 2)) {
        b.box('wood', 0.1, 0.3, 0.1, sx * 11.1, 4.27, zl, 0x5f4526);
        b.box('glow', 0.34, 0.42, 0.34, sx * 11.1, 3.95, zl, 0xffc069);
        b.kit('avenue.lantern', 1, 3.95);
      }
    }
  }
}

/** 栏外石灯：±8.75，每 24m 一盏，灯芯自发光 + 石座石顶 */
function avenueLamps(b: Baker, sz: number): void {
  const L = AVE_Z1 - AVE_Z0;
  for (const sx of [-1, 1]) {
    const x = sx * 8.75;
    for (let t = 12; t < L; t += 24) {
      const z = sz * (AVE_Z0 + t);
      if (avenueNode(z, 2)) continue;
      plate(b, 'ash', 0.8, 0.8, x, z, 0.1, 0.44, AVE_DADO_C);
      b.cyl('ash', 0.1, 0.14, 1.0, 6, x, 0.94, z, AVE_STONE);
      for (const ox of [-0.22, 0.22]) for (const oz of [-0.22, 0.22]) b.box('ash', 0.07, 0.5, 0.07, x + ox, 1.62, z + oz, AVE_STONE_D);
      b.box('glow', 0.36, 0.44, 0.36, x, 1.62, z, 0xffcf8a);
      plate(b, 'ash', 0.66, 0.66, x, z, 1.85, 1.95, AVE_STONE);
      b.pyramid('ash', 0.08, 0.42, x, 2.02, z, AVE_DADO_C, 0, 1, 0.34, 1);
      b.kit('avenue.streetLamp', 1, 0.14);
    }
  }
}

/** 行道树：廊外侧 ±15.6，每 12m 一株，树池从土面砌到与旧御街板齐平 */
function avenueTrees(b: Baker, sz: number, sampleY: Sampler): void {
  const L = AVE_Z1 - AVE_Z0;
  for (let t = 6; t < L; t += 12) {
    const z = sz * (AVE_Z0 + t);
    if (avenueCross(z, 4)) continue;
    const k = Math.floor(t / 12);
    for (const sx of [-1, 1]) {
      const x = sx * 15.6;
      const gy = sampleY(x, z);
      plate(b, 'ash', 3.2, 3.2, x, z, gy - 0.25, 0.18, AVE_DADO_C);
      plate(b, 'earth', 2.6, 2.6, x, z, 0.18, 0.24, 0x5a4a34);
      b.kit('avenue.treePit', 1, gy);
      conifer(b, x, z, 1.1 + (k % 3) * 0.14, k % 2 === 0);
      b.kit('avenue.tree', 1, 0);
    }
  }
}

/** 牌坊：4 柱 3 间 + 额枋 + 匾位空板 + 三间檐顶；外柱立在廊台明、内柱立在御街石铺 */
function avenuePaifang(b: Baker, z: number): void {
  for (const x of [12.4, 4.4, -4.4, -12.4]) {
    const outer = Math.abs(x) > 6;
    const base = outer ? AVE_DADO : AVE_DECK;
    const top = outer ? 9.9 : 11.2;
    plate(b, 'ash', 1.2, 1.2, x, z, base - 0.08, base + 0.66, AVE_DADO_C);
    b.cyl('wood', 0.32, 0.38, top - base, 8, x, (base + top) * 0.5, z, AVE_CINNABAR);
    b.kit('avenue.paifangPost', 1, base);
  }
  for (const [xc, w] of [[0, 8.8], [8.4, 8.0], [-8.4, 8.0]] as const) {
    plate(b, 'wood', w, 0.5, xc, z, 6.2, 6.6, shade(AVE_CINNABAR, 0.9));
    plate(b, 'wood', w, 0.66, xc, z, 7.3, 8.0, AVE_CINNABAR);
    b.kit('avenue.paifangBeam', 2, 7.0);
  }
  plate(b, 'ash', 6.1, 0.26, 0, z, 8.05, 9.45, AVE_STONE);
  plate(b, 'lacquer', 5.5, 0.34, 0, z, 8.15, 9.35, 0x1e1a17);
  b.kit('avenue.plaque', 1, 8.75);
  for (let x = -3.85; x <= 3.86; x += 1.1) b.box('wood', 0.34, 0.5, 0.5, x, 9.3, z, shade(AVE_CINNABAR, 1.05));
  for (const s of [-1, 1]) for (let x = 4.95; x <= 12.01; x += 1.1) b.box('wood', 0.34, 0.4, 0.46, s * x, 8.2, z, shade(AVE_CINNABAR, 1.05));
  b.kit('avenue.dougong', 22, 8.7);
  b.roofC('roof', 0, 9.5, z, shade(AVE_TILE, 1.02), 0, 10.6, 2.2, 2.8);
  b.box('roof', 9.6, 0.36, 0.42, 0, 11.78, z, shade(AVE_TILE, 0.84));
  for (const s of [-1, 1]) {
    b.roofC('roof', s * 8.4, 8.4, z, shade(AVE_TILE, 0.96), 0, 8.4, 1.35, 2.3);
    b.box('roof', 7.4, 0.3, 0.36, s * 8.4, 9.68, z, shade(AVE_TILE, 0.8));
  }
  b.kit('avenue.paifangRoof', 3, 9.5);
  for (const s of [-1, 1]) b.box('glow', 0.36, 0.5, 0.36, s * 2.9, 6.95, z, 0xffb15a);
  b.kit('avenue.paifangLantern', 2, 6.95);
  b.kit('avenue.paifang', 1, AVE_DECK);
}

function buildImperialAvenue(b: Baker, sampleY: Sampler): void {
  for (const sz of [1, -1]) {
    avenueDeck(b, sz);
    avenueRail(b, sz);
    avenueColonnade(b, sz);
    avenueColonnadeFurniture(b, sz);
    avenueLamps(b, sz);
    avenueTrees(b, sz, sampleY);
    for (const p of AVE_PAIFANG) avenuePaifang(b, sz * p);
  }
}

/** 御街两厢里坊：夯土街面 + 坊台明 + 断续院墙（earth + roof 压顶）+ 院墙段 + 街沟散水；院落户由 WardInfill 实例化 */
function buildWardCourts(b: Baker): void {
  const T = 0.9, YT = 0.35, YH = 2.2;
  for (const sz of [-1, 1]) {
    for (const [z0, z1] of COURT_SEGMENTS) {
      const len = z1 - z0, zc = sz * (z0 + z1) / 2;
      for (const sx of [-1, 1]) {
        // 铺到 |x|=893 的竖街边，免得坊外留 7m 裸土沟
        b.box('ground', COURT_EDGE - COURT_X0, 0.56, len, sx * (COURT_X0 + COURT_EDGE) / 2, COURT_SOIL + 0.28, zc, 0x8b7a5c);
        b.kit('court.street', 1, 0.06);
        b.box('ash', 1.55, 0.52, len, sx * 20.78, COURT_SOIL + 0.26, zc, 0x8f8878);
        b.box('ash', 1.55, 0.52, len, sx * 23.22, COURT_SOIL + 0.26, zc, 0x938c7c);
        b.box('earth', 0.9, 0.44, len, sx * 22, COURT_SOIL + 0.22, zc, 0x453f34);
        b.kit('court.gutter', 3, 0.02);
      }
    }
  }
  const wards = courtWards();
  for (let wi = 0; wi < wards.length; wi++) {
    const w = wards[wi];
    const x0 = w.cx - w.hx, x1 = w.cx + w.hx, z0 = w.cz - w.hz, z1 = w.cz + w.hz;
    const wallC = shade(0xb19a72, 0.92 + h01(wi, 0, 91) * 0.16);
    const capC = shade(0x6c7382, 0.94 + h01(wi, 0, 92) * 0.12);
    b.box('ground', x1 - x0, 0.66, z1 - z0, w.cx, COURT_BASE - 0.33, w.cz, shade(0x9d8a6a, 0.94 + h01(wi, 0, 93) * 0.12));
    b.kit('court.platform', 1, COURT_BASE);
    // 四面院墙（W25）：不再是 3.3m 高的一圈墙 + 8m 坊门，而是 12–28m 段 + 6–14m 缺口，
    // 两端各让 3–6m（与邻坊接出 8–20m 巷道缺口）；门柱 / 门楣 / 门灯整组取消。
    const line = (x: number, z: number, len: number, alongX: boolean, e: number): void => {
      const T2 = 0.62, H2 = 2.35;
      const hs = (kk: number): number => h01(wi, e, kk);
      const endA = 3 + 3 * hs(1), endB = 3 + 3 * hs(2);
      let s = -len / 2 + endA;
      const stop = len / 2 - endB;
      for (let i = 0; i < 60 && s < stop - 5; i++) {
        const seg = Math.min(12 + 16 * hs(10 + i * 5), stop - s);
        if (seg < 6) break;
        const m = s + seg / 2;
        const px = x + (alongX ? m : 0), pz = z + (alongX ? 0 : m);
        b.box('earth', alongX ? seg : T2, H2, alongX ? T2 : seg, px, COURT_BASE + H2 / 2, pz, wallC);
        b.box('roof', (alongX ? seg : T2) + 0.26, 0.18, (alongX ? T2 : seg) + 0.26, px, COURT_BASE + H2 + 0.09, pz, capC);
        b.kit('court.wardWall', 1, COURT_BASE + H2 / 2);
        b.kit('court.wardWallCap', 1, COURT_BASE + H2 + 0.09);
        s += seg + 6 + 8 * hs(11 + i * 5);
      }
    };
    // 墙中线内移一个瓦口（0.16m）：压顶外挑不进横街，14m 断口在瓦口高度仍是净 14m
    const wOff = T / 2 + COURT_EAVE;
    line(w.cx, z0 + wOff, x1 - x0, true, 1);
    line(w.cx, z1 - wOff, x1 - x0, true, 2);
    line(x0 + wOff, w.cz, z1 - z0 - T * 2, false, 3);
    line(x1 - wOff, w.cz, z1 - z0 - T * 2, false, 4);
    // 院墙只建近段 LOD0 坊：2.2m 土墙在 2km 外不足 1px，远坊留实例化体块即可
    if (cellLod(w.cx, w.cz) === 0 && Math.abs(w.cz) <= 1300) {
      let ny = 0, ng = 0;
      for (const yd of courtYards(w, wi)) {
        // 院墙逐段沿地块边走（含 0.9–2.2m 高差与院门缺口），不再是四道等距直墙
        for (const wl of yd.walls) {
          b.box('earth', wl.w, wl.h, wl.d, wl.x, COURT_BASE + wl.h / 2, wl.z, yd.wc, wl.yaw);
        }
        for (const gt of yd.gates) {
          for (const sd of [-1, 1]) {
            b.box('wood', 0.2, 2.3, 0.2, gt.x + Math.cos(gt.yaw) * sd * (gt.w / 2), COURT_BASE + 1.15, gt.z - Math.sin(gt.yaw) * sd * (gt.w / 2), 0x6f4a2c, gt.yaw);
          }
          b.box('wood', gt.w, 0.2, 0.3, gt.x, COURT_BASE + 2.3, gt.z, 0x7a5533, gt.yaw);
          ng++;
        }
        ny++;
      }
      b.kit('court.yardWall', ny * 4, COURT_BASE + YH / 2);
      b.kit('court.yardGate', ng * 3, COURT_BASE + 1.3);
    }
  }
}

export function buildCountryside(b: Baker, rng: RNG, sampleY: Sampler, waterAt: WaterFn): CountrysideMarks {
  const marks: CountrysideMarks = { fields: [] };
  const roadPts = COUNTRY_ROADS.flatMap((p) => resample(p, 8));
  for (const pts of COUNTRY_ROADS) buildRoad(b, sampleY, pts);

  for (const v of COUNTRY_VILLAGES) buildVillage(b, rng, v, sampleY, waterAt);
  for (const [hx, hz] of NEAR_HILLS) hillDetail(b, rng, hx, hz, sampleY);
  gardenBeds(b, rng, sampleY, waterAt);

  const bands: Band[] = [];
  CORRIDOR_Z.forEach(([z0, z1], i) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wx = 840, wz = z1 - z0;
      bands.push(i % 2 === 0
        ? { cx: sx * 460, cz: sz * (z0 + z1) / 2, hx: wx / 2 - 4, hz: wz / 2 - 4, yaw: 0 }
        : { cx: sx * 460, cz: sz * (z0 + z1) / 2, hx: wz / 2 - 4, hz: wx / 2 - 4, yaw: Math.PI / 2 });
    }
  });
  bands.push(
    { cx: 5620, cz: 150, hx: 330, hz: 480, yaw: 0.14 },
    { cx: 5760, cz: -1350, hx: 320, hz: 380, yaw: -0.12 },
    { cx: -5620, cz: 900, hx: 320, hz: 520, yaw: -0.2 },
    { cx: -5680, cz: 1900, hx: 300, hz: 330, yaw: 0.24 },
  );
  for (const band of bands) layBand(b, rng, band, sampleY, waterAt, roadPts, COUNTRY_VILLAGES, marks);
  buildImperialAvenue(b, sampleY);
  buildWardCourts(b);
  return marks;
}
