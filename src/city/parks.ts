import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import { RNG } from '../core/rng';
import { C } from './buildings';
// R10 的两条支渠（蔡河 / 五丈河）：五丈河正好从南岸东段这两处苑囿的位置穿过。
// 只读它的折线与渠宽，用来在园内"让水"——墙在水上断开水门、树石不落渠中、曲径在水缘收头。
import { WATER_BRANCHES } from './water';
// R24b：任意不规则草斑轮廓模板（不是圆盘、不是矩形）
import { freeBlobGeometries, putFreeBlob } from './freeBlob';

// ============ R11：苑囿 / 园林 / 瓦舍勾栏 ============
// 用户原话：「应该有多个大大小小的、有小河小湖、绿树成荫的大小公园之类的、以及大大小小的游乐场
// 之类的休闲玩玩耍的地方吗」。
// 汴京实况：琼林苑、金明池、玉津园、宜春苑四大苑囿；城里寺观园林与私家宅园成片；市井娱乐是瓦舍勾栏。
//
// 落位纪律（本文件全部站点已逐一比对下列占据区，见文件末尾 SITE_AUDIT 表）：
//   ① 里坊 / 御街两厢坊（imperial.wardCells 126 格 + infill.courtWards 120 格）；
//   ② 近城街排（H/V_STREETS 及其进深 + 后院 28m）、桥东/桥西广场、东城墙体；
//   ③ 河岸商业带（riverbank.ts：|z| 38–64 全 x）、三条环城大路（|x| 或 |z| = 900/1700/2500 ±55）；
//   ④ 宫城、东西市、三处地标禁入区、塔院柏树列、客栈/琴台/净房/棋桌等已知小件。
// 因此苑囿只能落在「河岸带以内、里坊带以外」的那两条带（|z| 65–380），
// 中小园林与瓦舍落在近城街排后院与河岸带之间的空地（|z| 100–210）以及东/西郊的同一带里。

// ---------- 调色（与全城共用一套，避免公园变成另一座城的色） ----------
// R27：旧 0x446230 偏黄褐（R68 G98 B48），黄昏俯瞰与暖赭裸土混成一片「浅黄空坪」。
// 换成明确草绿 0x5f8f42（R95 G143 B66，G/R≈1.5、饱和度足但不荧光），一眼能分出绿地与黄土。
const GRASS = 0x5f8f42;        // 草地：可辨青绿/草绿档，压得住暖赭底贴图
const GRASS_DK = 0x416b33;     // 深一档草绿：池岸地被 / 色斑底
const GRAVEL = 0x7f7768;       // 碎石曲径（灰褐，不能比草地亮太多，否则读成木板路）
const STONE_LT = 0x8e8b7f;
const STONE_DK = 0x65625a;
const LEAF = 0x3f6b3a;         // 阔叶
const LEAF_WARM = 0x59793c;    // 偏黄的新叶
const TRUNK = 0x4a3524;
// 水色三档：水材质是 Basic + toneMapped:false，颜色直出屏幕，写多少就是多少。
// 旧值 0x2c6b6a 在黄昏光下是一池泳池蓝；参照汴河河床 0x24455c 压到 0x1c4a50 一带。
const POND_DEEP = 0x143138;    // 池心
const POND_EDGE = 0x1d4d53;    // 岸边（顶点色由中心向岸渐变，没有硬环）

interface Rand { (): number }

function mkRand(seed: number): Rand {
  let s = (seed >>> 0) || 0x9e3779b9;
  return (): number => {
    s = (Math.imul(s ^ (s >>> 13), 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

function siteSeed(x: number, z: number, salt: number): number {
  return (Math.imul(Math.round(x * 17 + z * 31) ^ Math.imul(salt, 0x9e3779b1), 2654435761) >>> 0) || 7;
}

/** 盒子局部 X 轴对准世界方向 (dx,dz) 的 yaw（与 Baker.push 的旋转同式） */
const along = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/** 点到折线的最短距离 */
function distToPolyline(pts: readonly (readonly [number, number])[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/** 到任一支渠**水缘**的净距（>0 为干地）。已把 R10 的 1.2m 石岸厚度算进去 */
export function canalClearance(x: number, z: number): number {
  let best = Infinity;
  for (const br of WATER_BRANCHES) best = Math.min(best, distToPolyline(br.pts, x, z) - br.width / 2 - 1.6);
  return best;
}

// ============ 站点表 ============

export interface ParkSite {
  name: string;
  x: number; z: number;
  /** 围墙外廓（m） */
  w: number; d: number;
  /** 池半径（m）——直径 = 2r，规格要求 60–100m */
  pond: number;
}

/** 大苑囿 2 处（各 ≥300×300m，落在南岸东段的空带里，与里坊带互不侵入） */
export const GRAND_PARKS: readonly ParkSite[] = [
  { name: '瓊林苑', x: 1320, z: -222, w: 340, d: 300, pond: 46 },
  { name: '玉津園', x: 2100, z: -222, w: 300, d: 300, pond: 38 },
];

export interface GardenSite {
  x: number; z: number;
  /** 园地边长（m）——规格 60–150m */
  size: number;
  /** 池半径（m）——直径 12–24m */
  pond: number;
}

/** 中小园林 8 处：近城北/南两带的坊间空地 + 东西郊滨河空地 */
export const GARDENS: readonly GardenSite[] = [
  { x: -640, z: 150, size: 92, pond: 9 },
  { x: -330, z: 150, size: 92, pond: 8 },
  { x: -175, z: 150, size: 80, pond: 7 },
  { x: -620, z: -150, size: 92, pond: 9 },
  { x: 620, z: -150, size: 84, pond: 8 },
  { x: 760, z: 150, size: 60, pond: 6 },
  { x: 1050, z: 190, size: 84, pond: 8 },
  { x: -1000, z: 190, size: 84, pond: 8 },
];

export interface WasheSite {
  name: string;
  x: number; z: number;
  /** 勾栏场子边长（m）——规格 16–24m */
  size: number;
}

/** 瓦舍勾栏 5 处（戏台一律朝 +z，观众区在场子中南部） */
export const WASHE_SITES: readonly WasheSite[] = [
  { name: '瓦舍·州橋北', x: -520, z: 195, size: 22 },
  { name: '瓦舍·城東門', x: 700, z: 195, size: 22 },
  { name: '瓦舍·南岸市', x: -200, z: -195, size: 22 },
  { name: '瓦舍·瓊林道', x: 1000, z: -195, size: 22 },
  { name: '瓦舍·玉津坊', x: 1250, z: 200, size: 22 },
];

export interface AudienceRect { name: string; x0: number; x1: number; z0: number; z1: number }

/** 观众锚点矩形：看棚之内、戏台之前的空地（lead 直接用它铺 crowd 站位/闲逛圈） */
export const WASHE_AUDIENCE: readonly AudienceRect[] = WASHE_SITES.map((s) => {
  const h = s.size / 2;
  return { name: s.name, x0: s.x - h + 4.2, x1: s.x + h - 4.2, z0: s.z - h + 6.8, z1: s.z + h - 3.6 };
});

// ============ R25：空地填充站点表 ============
// 诊断：旧 buildParks 只有 2 大苑 + 8 园林 + 5 瓦舍，且全挤在 |z| 150–222 的窄带，
// 从河岸带到里坊带之间还留着成片只铺了裸土/草皮的开敞地 —— 俯瞰就是「城内大片空地」。
// 本层用一张独立站点表把这些空地填满：每处都是一组肉眼可辨的园亭小品
// （攒尖亭 / 台榭 / 水榭曲桥 / 小院屋 / 院墙 / 湖石 / 花圃 / 树丛 / 石桌凳 / 廊架）。
// 与三大苑囿一样全部走坐标 hash（mkRand/siteSeed），**不消耗共享 rng**；落位先过 infillClear
// 避开汴河、御街、环城大路、宫城（含三大殿轴线）与已有 15 处站点，园内再用 canalClearance 让开支渠。
export interface InfillSite {
  x: number; z: number;
  /** 院落边长（m）—— 26–40m，比中小园林小，才塞得进坊间缝隙 */
  size: number;
  /** 主体组合变体 0–5（整数 hash 派生） */
  variant: number;
}

const INFILL_ROADS = [900, 1700, 2500, 3300, 4100];

/** 站点落位判据：只留「河岸带以外、坊间开敞地、大路/御街/宫城/已有站点之外」的干地 */
function infillClear(x: number, z: number, size: number, placed: readonly InfillSite[]): boolean {
  const h = size / 2;
  if (Math.abs(z) < 78) return false;                          // 汴河 |z|<31 + 河岸商业带 |z|38–64 + 余量
  if (Math.abs(x) < 34 + h) return false;                     // 御街
  if (z < -2900 && Math.abs(x) < 1160 + h) return false;     // 宫城（含三大殿中轴 z −3260…−3690）
  if (z > -2960 && z < -2270 && Math.abs(x) < 44) return false; // 宫前商业街
  for (const L of INFILL_ROADS) {
    if (Math.abs(Math.abs(x) - L) < 62 + h) return false;    // 三条环城大路（|x| = L）
    if (Math.abs(Math.abs(z) - L) < 62 + h) return false;    // 三条环城大路（|z| = L）
  }
  if (Math.abs(Math.abs(x) - 2800) < 175 && Math.abs(Math.abs(z) - 900) < 175) return false; // 东/西市
  if (canalClearance(x, z) < 6) return false;                 // 五丈河 / 蔡河支渠（含石岸）
  // 已有 15 处站点外廓（+6m 余量）：不叠琼林苑/玉津园/园林/瓦舍
  for (const p of GRAND_PARKS) if (Math.abs(x - p.x) < p.w / 2 + h + 6 && Math.abs(z - p.z) < p.d / 2 + h + 6) return false;
  for (const g of GARDENS) if (Math.abs(x - g.x) < g.size / 2 + h + 6 && Math.abs(z - g.z) < g.size / 2 + h + 6) return false;
  for (const w of WASHE_SITES) if (Math.abs(x - w.x) < w.size / 2 + h + 6 && Math.abs(z - w.z) < w.size / 2 + h + 6) return false;
  // 站点之间不互相压（棋盘密度靠此判据收口，而不是等距方阵）
  for (const s of placed) if (Math.abs(x - s.x) < (size + s.size) / 2 + 8 && Math.abs(z - s.z) < (size + s.size) / 2 + 8) return false;
  return true;
}

// ============ R26：全城空地填充 · 网格与绿地常量（可机检 / 可 grep） ============
// 旧表 bandZ 只有 |z|≤340 的十条窄带，|z|>340 直到 ±4600 的绝大部分城内区域完全没有站点，
// 这就是俯瞰成片黄土裸地的直接原因。下面把 x / z 都铺成覆盖 ±4600 的完整网格，
// 并把每处站点的草坪放大到连片；全部确定性、零共享 RNG、全部 Baker 合批。
const INFILL_GRID_STEP_X = 240;     // bandX 步长（m）：全城 x −4600…4600，落在 220–260
const INFILL_GRID_STEP_Z = 220;     // bandZ 步长（m）：全城 z −4600…4600，落在 200–240
const INFILL_GRID_SKIP_CORE = 100;  // |z|<100 的汴河 / 御街核心带跳过（infillClear 的 |z|<78 亦会挡）
const INFILL_LAWN_RADIUS = 1.4;     // 草坪覆盖半径 = size × 1.4（≥ 规格「至少 size*1.4」；旧值约 size*0.5）
const INFILL_LAWN_TILE = 0.9;       // 草坪边长另不小于网格步长 × 0.9 → 相邻站点绿地连片、不露黄土
const INFILL_GROVE_COUNT = 14;      // R28：每处站点补的乔木 / 花丛带株数（旧 4，加密到 14）

// ============ R27：核心带细网格 · 御街两厢 / 汴河两岸方形空坪（可机检 / 可 grep） ============
// R26 主网格 bandZ 步长 220 且跳过 |z|<100，|z|110–420 只剩 z=240/460（−200/−420）两行，
// 两行之间的御街两厢 / 汴河两岸仍是方形浅黄空坪。这里用 70m 细网格补绿：
// 站点只铺草坪 / 花圃 / 树阵 / 低矮亭廊石景曲水，不建大建筑（不挡街道与河）。
const CORE_GREEN_STEP_Z = 70;       // |z| 110…420 步长（60–80 档）
const CORE_GREEN_STEP_X = 160;      // |x| ≤ 4600 的细列距
const CORE_GREEN_Z0 = 110;          // 汴河水面 |z|<31 + 河岸街屋带 |z|38–64 + 余量之外
const CORE_GREEN_Z1 = 420;
const CORE_GREEN_X_MAX = 4400;      // 城墙内环：±4400 之外让给城墙
const CORE_GREEN_TILE = 0.92;       // 草坪边长 = 网格步长 × 此系数 → 相邻站点绿地连片

/**
 * R25 → R26 全城网格：bandX / bandZ 都按完整序列铺到 −4600…4600，
 * 两轮错列 (r+c+pass)%2 覆盖奇偶格、整数坐标 hash 抖动（siteSeed，非等距方阵）。
 * |z|<INFILL_GRID_SKIP_CORE 的汴河 / 御街核心带跳过，逐处仍过 infillClear()
 * （道路 / 汴河 / 支渠 / 宫城 / 已有 15 站点 / 站点互压），不把公园压到街道或宫城上。
 * B 段城墙内侧环带、C 段宫城外围保留作边角补位，与主网格重复的由互压判据自动收口。
 * 全部由整数坐标 hash 派生，不消耗共享 RNG、不用 Math.random。
 */
function makeInfillSites(): InfillSite[] {
  const out: InfillSite[] = [];
  // 坐标只取整数格、抖动也取整数米：全表可机检、可复现，不含任何浮点随机
  const sizes = [28, 32, 36, 40, 34];
  // A. 全城主网格：x / z 都覆盖 −4600…4600
  const bandX: number[] = [];
  for (let x = -4600; x <= 4600; x += INFILL_GRID_STEP_X) bandX.push(x);
  const bandZ: number[] = [];
  for (let z = -4600; z <= 4600; z += INFILL_GRID_STEP_Z) {
    if (Math.abs(z) < INFILL_GRID_SKIP_CORE) continue;   // 汴河 / 御街核心带，不压建筑
    bandZ.push(z);
  }
  // 步长未必整除 9200：补一条对称端行，保证 z 真正铺到 +4600（而非停在 4420）
  if (4600 - bandZ[bandZ.length - 1] > INFILL_GRID_STEP_Z * 0.5) bandZ.push(4600);
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < bandZ.length; r++) {
      for (let c = 0; c < bandX.length; c++) {
        if ((r + c + pass) % 2 !== 0) continue;   // 两轮错列覆盖奇偶格，站点不互压交给 infillClear
        const seed = siteSeed(bandX[c], bandZ[r], 71 + pass * 17);
        const jx = (seed % 15) - 7, jz = ((seed >>> 5) % 15) - 7;   // ±7m 整数抖动
        const x = bandX[c] + jx, z = bandZ[r] + jz;
        const size = sizes[seed % sizes.length];
        const variant = (seed >>> 9) % 6;
        if (infillClear(x, z, size, out)) out.push({ x, z, size, variant });
      }
    }
  }
  // B. 城墙内侧环带：|x| 4580–4700，城墙（±5000）之内、最外一条大路（4100）之外
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 13; k++) {
      const z = -1500 + k * 250;
      const seed = siteSeed(sx * 4600, z, 83);
      const x = sx * (4580 + (seed % 6) * 24);
      const size = sizes[(seed >>> 3) % sizes.length];
      const variant = (seed >>> 11) % 6;
      if (infillClear(x, z, size, out)) out.push({ x, z, size, variant });
    }
  }
  // C. 宫城外围（午门前、御街两厢）：z −2380…−2820，|x| 200–620
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      for (let j = 0; j < 3; j++) {
        const z = -2380 - k * 110;
        const x = sx * (200 + j * 210);
        const seed = siteSeed(x, z, 97);
        const size = sizes[(seed >>> 2) % sizes.length];
        const variant = (seed >>> 7) % 6;
        if (infillClear(x, z, size, out)) out.push({ x, z, size, variant });
      }
    }
  }
  return out;
}

/** 空地填充站点表（导出给探针/单测读取）：全部由整数坐标 hash 派生，确定性 */
export const INFILL_SITES: readonly InfillSite[] = makeInfillSites();

// ---------- R27 核心带细网格：独立站点表，不并入 INFILL_SITES（保持 1060 / park.infill.siteCount 口径） ----------
export interface CoreGreenSite {
  x: number; z: number;
  /** 院落边长（m）—— 30–38m，只做低矮地被与小品，不建大建筑 */
  size: number;
  /** 低矮陈设组合变体 0–5（整数 hash 派生） */
  variant: number;
}

/**
 * 核心带落位判据：专补 |z|110–420 的方形浅黄空坪，逐条避开
 * 汴河水面与河岸街屋带 / 御街与宫城中轴甬道 / 开封府 / 宫城 / 城墙内环 /
 * 环城大路路面 / 蔡河五丈河支渠 / 既有 15 处手工园 / 既有 1060 处 INFILL 站点。
 * 与 imperial.wardReserved 不同口径：后者把 |z|<210 && |x|<960 整段留给临河手工段，
 * 而俯瞰里那段的方形空坪正是本次要补的，故按 riverbank 街屋带 |z|38–64 精准避让，不整段一刀切。
 */
function coreGreenClear(x: number, z: number, size: number, placed: readonly CoreGreenSite[]): boolean {
  const h = size / 2;
  if (Math.abs(z) < CORE_GREEN_Z0) return false;                        // 汴河 |z|<31 + 河岸街屋带 |z|38–64 + 余量；含抖动后仍严格 |z|≥110
  if (Math.abs(x) < 34 + h) return false;                               // 御街 / 宫城中轴甬道
  if (Math.abs(x) > CORE_GREEN_X_MAX) return false;                     // 城墙内环（±4400 之外让给城墙）
  if (Math.abs(x - 560) < 90 && Math.abs(z + 62) < 90) return false;    // 开封府（府衙 560,−62 含照壁/大堂外廓）
  if (z < -2900 && Math.abs(x) < 1160 + h) return false;                // 宫城（防御性，核心带 |z|≤420 不命中）
  for (const L of INFILL_ROADS) {
    if (Math.abs(Math.abs(x) - L) < 62 + h) return false;               // 环城大路（|x| = L）
    if (Math.abs(Math.abs(z) - L) < 62 + h) return false;               // 环城大路（|z| = L）
  }
  if (canalClearance(x, z) < 6) return false;                           // 蔡河 / 五丈河支渠水面
  for (const p of GRAND_PARKS) if (Math.abs(x - p.x) < p.w / 2 + h + 6 && Math.abs(z - p.z) < p.d / 2 + h + 6) return false;
  for (const g of GARDENS) if (Math.abs(x - g.x) < g.size / 2 + h + 6 && Math.abs(z - g.z) < g.size / 2 + h + 6) return false;
  for (const w of WASHE_SITES) if (Math.abs(x - w.x) < w.size / 2 + h + 6 && Math.abs(z - w.z) < w.size / 2 + h + 6) return false;
  // 不与既有 1060 处站点互压（草坪同色重叠无碍，立体陈设不压到别人的亭台）
  for (const s of INFILL_SITES) if (Math.abs(x - s.x) < (size + s.size) / 2 + 8 && Math.abs(z - s.z) < (size + s.size) / 2 + 8) return false;
  for (const s of placed) if (Math.abs(x - s.x) < (size + s.size) / 2 + 8 && Math.abs(z - s.z) < (size + s.size) / 2 + 8) return false;
  return true;
}

/** 核心带站点表：|z|110–420 双侧细带 × |x|≤4400 细列，整数坐标 hash 抖动，逐处过 coreGreenClear */
function makeCoreGreenSites(): CoreGreenSite[] {
  const out: CoreGreenSite[] = [];
  const sizes = [30, 34, 38, 32, 36];
  const bandX: number[] = [];
  for (let x = -CORE_GREEN_X_MAX; x <= CORE_GREEN_X_MAX; x += CORE_GREEN_STEP_X) bandX.push(x);
  const bandZ: number[] = [];
  for (const s of [-1, 1]) {
    for (let z = s * CORE_GREEN_Z0; Math.abs(z) <= CORE_GREEN_Z1; z += s * CORE_GREEN_STEP_Z) bandZ.push(z);
  }
  for (let c = 0; c < bandX.length; c++) {
    for (let r = 0; r < bandZ.length; r++) {
      const seed = siteSeed(bandX[c], bandZ[r], 401);
      const jx = (seed % 13) - 6, jz = ((seed >>> 5) % 13) - 6;   // ±6m 整数抖动
      const x = bandX[c] + jx, z = bandZ[r] + jz;
      const size = sizes[seed % sizes.length];
      const variant = (seed >>> 9) % 6;
      if (coreGreenClear(x, z, size, out)) out.push({ x, z, size, variant });
    }
  }
  return out;
}

/** 核心带站点表（导出给探针/单测读取）：确定性、零共享 RNG、不并入 INFILL_SITES */
export const CORE_GREEN_SITES: readonly CoreGreenSite[] = makeCoreGreenSites();

// ============ R28：核心带补绿 · 广场空坪独立站点表（可机检 / 可 grep） ============
// 实拍硬证据（R22 中间生产包 4173，初始机位 Raycaster→y=0 求交）：相机 (-523, 15.6, 71.8)，
// 画面右侧那片浅黄裸地反算世界坐标 x≈-395…-460 / z≈59…105（近处主体）、更远 x≈-18 / z≈157，
// 即大致覆盖 x∈[-700,0]、z∈[60,180] 并向两侧延伸 —— 正是本轮用户点名的「大片空地」。
// 双重空档根因（源码核实）：infillClear 第 157 行 `if (Math.abs(z) < 78) return false;`、
// CORE_GREEN_Z0=110（coreGreenClear 第 281 行 `if (Math.abs(z) < CORE_GREEN_Z0) return false;`），
// 故 78≤|z|<110 两层站点表都不覆盖，就是俯瞰里那条方形浅黄带；且 CORE_GREEN_STEP_X=160 又与
// 1060 个 INFILL 站点互压排除，|z|110–420 只落 337 站点、密度也不够。
// 本层据此：plazaClear 明确允许 |z|>=66（汴河 |z|<31、河岸街屋带 |z|38–64 仍含在 |z|<66 内禁），
// 主带铺满 |z|66–160 × x±4400，并对实拍矩形 x∈[-700,0] / |z|66–180 单独加密（x=60 / z=30），
// 另保留 |z|420–900 漏坪带；站点只铺低矮公园构件，不建大体量房屋、不挡街。
// 全部由 siteSeed 整数坐标 hash 派生，禁止 Math.random、禁止新增 rng.range/rng.chance，
// 与共享 RNG 完全无关 —— 扩充本表不会扰动 buildTrees/buildStalls 等任何后续随机序列。
export interface PlazaSite {
  x: number; z: number;
  /** 坪地边长（m）—— 24–32m，比 INFILL 站点略小，才塞得进核心缝与网格漏格 */
  size: number;
  /** 低矮陈设组合变体 0–5（整数 hash 派生） */
  variant: number;
}

const PLAZA_STEP_X = 120;        // 主带细网格列距（m）
const PLAZA_STEP_Z_CORE = 40;    // 近河带 |z|66–180 行距（m）—— 连片变绿
const PLAZA_STEP_Z_LEAK = 60;    // 420–900 漏坪带行距（m）
const PLAZA_LAWN_W = 116;        // 草坪宽：贴近主带列距 120，令相邻坪地接壤
const PLAZA_LAWN_D = 56;         // 草坪深：覆盖核心行距 40（重叠接壤）、贴近漏坪行距 60
const PLAZA_X_MAX = 4400;        // 城墙内环：±4400 之外让给城墙（与 CORE_GREEN_X_MAX 一致）
const PLAZA_Z_CORE0 = 66;        // 近河带下界：实拍确认 |z|>=66 明确允许
const PLAZA_Z_CORE1 = 160;       // 近河主带上界
const PLAZA_Z_LEAK0 = 420;       // 漏坪带起点 |z|
const PLAZA_Z_LEAK1 = 900;       // 漏坪带上界 |z|（900 本身是环城大路，由判据挡掉）
const PLAZA_HOT_X0 = -700, PLAZA_HOT_X1 = 0;        // 实拍裸地加密带 x 范围
const PLAZA_HOT_Z0 = 70;                            // 加密带 |z| 起点（±4m 抖动后仍 >=66，不被判据误杀）
const PLAZA_HOT_Z1 = 180;                           // 实拍裸地加密带 |z| 上界
const PLAZA_HOT_STEP_X = 60, PLAZA_HOT_STEP_Z = 30; // 加密带步长（m）—— 比主带 x120/z40 更密

/**
 * 广场坪落位判据：严格避开
 *   汴河水面 |z|<31、河岸街屋带 |z|38–64（二者已含在 |z|<66 内）、御街 |x|<34、
 *   宫城 z<-2900 && |x|<1160、开封府 (560,−62) 半径 90、
 *   环城大路 |x|/|z| = 900/1700/2500/3300/4100 ±62、支渠 canalClearance<6、
 *   既有 GRAND_PARKS/GARDENS/WASHE_SITES；|z|>=420 的漏坪带另严格避让 INFILL/CORE_GREEN；
 *   以及广场站点彼此互压。R22 实拍确认 |z|>=66 明确允许。
 */
function plazaClear(x: number, z: number, size: number, placed: readonly PlazaSite[]): boolean {
  const h = size / 2;
  // R22 实拍：|z|>=66 明确允许；汴河 |z|<31、河岸街屋带 |z|38–64 已含在 |z|<66 内严格禁止。
  if (Math.abs(z) < 66) return false;
  if (Math.abs(x) < 34 + h) return false;                  // 御街
  if (Math.abs(x) > PLAZA_X_MAX) return false;             // 城墙内环
  if (z < -2900 && Math.abs(x) < 1160 + h) return false;  // 宫城（含三大殿中轴）
  if (Math.hypot(x - 560, z + 62) < 90 + h) return false; // 开封府 (560,−62) 半径 90
  for (const L of INFILL_ROADS) {                         // 900/1700/2500/3300/4100 ±62
    if (Math.abs(Math.abs(x) - L) < 62 + h) return false;
    if (Math.abs(Math.abs(z) - L) < 62 + h) return false;
  }
  if (canalClearance(x, z) < 6) return false;              // 蔡河 / 五丈河支渠（含石岸）
  // 既有 15 处手工园外廓（+6m 余量）
  for (const p of GRAND_PARKS) if (Math.abs(x - p.x) < p.w / 2 + h + 6 && Math.abs(z - p.z) < p.d / 2 + h + 6) return false;
  for (const g of GARDENS) if (Math.abs(x - g.x) < g.size / 2 + h + 6 && Math.abs(z - g.z) < g.size / 2 + h + 6) return false;
  for (const w of WASHE_SITES) if (Math.abs(x - w.x) < w.size / 2 + h + 6 && Math.abs(z - w.z) < w.size / 2 + h + 6) return false;
  // R22 实拍：|z|<420 的近河带是两层既有表的双重空档（INFILL 跳 |z|<78/100、CORE_GREEN
  // 从 110 起且稀疏），按实拍要求在此不因「与既有站点互压」过滤（66–110 本就无站点中心），
  // 确保 66–110 连片变绿；420–900 漏坪带仍严格避让 INFILL / CORE_GREEN 既有站点外廓。
  if (Math.abs(z) >= PLAZA_Z_LEAK0) {
    for (const s of INFILL_SITES) if (Math.abs(x - s.x) < (size + s.size) / 2 + 8 && Math.abs(z - s.z) < (size + s.size) / 2 + 8) return false;
    for (const s of CORE_GREEN_SITES) if (Math.abs(x - s.x) < (size + s.size) / 2 + 8 && Math.abs(z - s.z) < (size + s.size) / 2 + 8) return false;
  }
  // 广场站点彼此不互压：最密网格步长 x=60 / z=30，用 18m 中心距阈值只挡真正重合的
  // 立体陈设（亭/树/石），不误杀相邻坪地的连片草坪与花木。
  for (const s of placed) if (Math.abs(x - s.x) < 18 && Math.abs(z - s.z) < 18) return false;
  return true;
}

/**
 * 广场坪站点表（全部候选统一过 plazaClear，整数坐标 hash 抖动，确定性、零共享 RNG）：
 *   ① 实拍裸地加密带（优先占位）：x∈[-700,0]、|z|66–180，步长 x=60 / z=30，南北双侧；
 *   ② 近河主带：|z|66–160、x 全 ±4400，步长 x=120 / z=40（在实拍矩形内与 ① 交错叠加）；
 *   ③ 420–900 漏坪带：步长 x=120 / z=60（原设计，补 INFILL 互压跳格留下的棋盘空坪）。
 */
function makePlazaSites(): PlazaSite[] {
  const out: PlazaSite[] = [];
  const sizes = [24, 28, 32, 26, 30];
  const cand: { x: number; z: number }[] = [];
  // ① 实拍裸地加密带：优先入列，保证 x∈[-700,0] / |z|66–180 俯瞰连片变绿、密布花木亭廊
  for (const s of [-1, 1])
    for (let x = PLAZA_HOT_X0; x <= PLAZA_HOT_X1; x += PLAZA_HOT_STEP_X)
      for (let a = PLAZA_HOT_Z0; a <= PLAZA_HOT_Z1; a += PLAZA_HOT_STEP_Z)
        cand.push({ x, z: s * a });
  // ② 近河主带：|z|66–160、x 全 ±4400；与 ① 加密带在实拍矩形内交错叠加（z 行 66/106/146
  //    对 70/100/130/160 错开，placed 互压 18m 阈值只挡真重合），进一步压实连片绿地
  for (const s of [-1, 1])
    for (let x = -PLAZA_X_MAX; x <= PLAZA_X_MAX; x += PLAZA_STEP_X)
      for (let a = PLAZA_Z_CORE0; a <= PLAZA_Z_CORE1; a += PLAZA_STEP_Z_CORE)
        cand.push({ x, z: s * a });
  // ③ 420–900 漏坪带
  for (const s of [-1, 1])
    for (let x = -PLAZA_X_MAX; x <= PLAZA_X_MAX; x += PLAZA_STEP_X)
      for (let a = PLAZA_Z_LEAK0; a <= PLAZA_Z_LEAK1; a += PLAZA_STEP_Z_LEAK)
        cand.push({ x, z: s * a });
  for (const c of cand) {
    const seed = siteSeed(c.x, c.z, 809);
    const jx = (seed % 9) - 4, jz = ((seed >>> 5) % 9) - 4;   // ±4m 整数抖动
    const x = c.x + jx, z = c.z + jz;
    const size = sizes[seed % sizes.length];
    const variant = (seed >>> 9) % 6;
    if (plazaClear(x, z, size, out)) out.push({ x, z, size, variant });
  }
  return out;
}

/** 广场坪站点表（导出给探针/单测读取）：确定性、零共享 RNG、不并入 INFILL_SITES / CORE_GREEN_SITES */
export const PLAZA_SITES: readonly PlazaSite[] = makePlazaSites();

// ============ R22 第二轮：核心带连片薄层草皮 CORE_GAP_LAWNS（可机检 / 可 grep） ============
// 实拍（r22-final-default.png / r20-03-infill.png / r20-23-r22-grove-close.png）：
//   x≈-395…-460 / z≈59…105（默认机位右侧第一眼）、x≈255…745 / z≈185、
//   x≈247…385 / z≈134…233 仍是「浅黄/褐色裸地 + 稀疏小树」，未达标。
// 根因：INFILL / CORE_GREEN / PLAZA 都是「站点级草坪」——块之间留网格缝、且 |z|160–420
// 没有 PLAZA 覆盖，俯瞰下连不成片。本层用 x=48 / z=20 的细网格铺**连片薄层草皮**，
// 块尺寸略大于步长（x 52–56 / z 24–28）令相邻块互相搭接、不留棋盘缝；
// 覆盖 |z|66–420 × |x|≤4400，每块按 siteSeed 补 4–8 株低矮花木 / 花丛。
// 薄草皮 y≈0.035、深绿 GRASS(0x5f8f42)，与既有公园草坪同色同高，重叠无碍（正是要填它们的缝）；
// 故只对硬禁区（汴河/河岸街屋带/御街/宫城/开封府/环城大路/支渠/15 处手工园）严格避让，
// 对 INFILL/CORE_GREEN/PLAZA 站点逐块遍历、仅用于「该块是否贴近既有立体陈设」→ 花木降档，
// 不因互压滤掉草皮（否则 66–160 会被 PLAZA 外廓挖空，反而更裸）。
// 全部 siteSeed 整数坐标 hash，禁 Math.random / 禁新增 rng.range / rng.chance，零共享 RNG 漂移。
export interface CoreGapLawn {
  x: number; z: number;
  /** 草皮块尺寸（m）—— 恒略大于网格步长，令相邻块搭接连片 */
  w: number; d: number;
  /** 花木组合变体 0–5（整数 hash 派生） */
  variant: number;
  /** 是否贴近既有站点：贴近期只补 4 株低矮花木，避免立体陈设叠压 */
  nearSite: boolean;
}

const CORE_GAP_STEP_X = 48;      // 网格列距（m），≤48
const CORE_GAP_STEP_Z = 20;      // 网格行距（m），≤20
const CORE_GAP_W = 52;           // 草皮宽基准（>48，x 向搭接 ≥4m）
const CORE_GAP_D = 24;           // 草皮深基准（>20，z 向搭接 ≥4m）
const CORE_GAP_Z0 = 66;          // 核心带单独放宽 z 门槛到 |z|>=66（不沿用 64+h）
const CORE_GAP_Z1 = 420;

/** 连片草皮落位判据：严格避开硬禁区与既有手工园外廓；|z|>=66 明确允许 */
function coreGapClear(x: number, z: number): boolean {
  const hx = CORE_GAP_W / 2, hz = CORE_GAP_D / 2;
  if (Math.abs(z) < CORE_GAP_Z0) return false;                  // 汴河 |z|<31 + 河岸街屋带 |z|38–64
  if (Math.abs(x) < 34 + hx) return false;                      // 御街
  if (Math.abs(x) > 4400) return false;                         // 城墙内环
  if (z < -2900 && Math.abs(x) < 1160 + hx) return false;       // 宫城
  if (Math.hypot(x - 560, z + 62) < 90 + hx) return false;      // 开封府 (560,−62) 半径 90
  for (const L of INFILL_ROADS) {                               // 900/1700/2500/3300/4100 ±62
    if (Math.abs(Math.abs(x) - L) < 62 + hx) return false;
    if (Math.abs(Math.abs(z) - L) < 62 + hz) return false;
  }
  if (canalClearance(x, z) < 6) return false;                   // 蔡河 / 五丈河支渠
  // 既有 15 处手工园外廓（+4m 余量）
  for (const p of GRAND_PARKS) if (Math.abs(x - p.x) < p.w / 2 + hx + 4 && Math.abs(z - p.z) < p.d / 2 + hz + 4) return false;
  for (const g of GARDENS) if (Math.abs(x - g.x) < g.size / 2 + hx + 4 && Math.abs(z - g.z) < g.size / 2 + hz + 4) return false;
  for (const w of WASHE_SITES) if (Math.abs(x - w.x) < w.size / 2 + hx + 4 && Math.abs(z - w.z) < w.size / 2 + hz + 4) return false;
  return true;
}

// 核心带内的既有站点子集（一次性预筛）：逐块判断「是否贴近既有立体陈设」，避免渲染期 O(n) 全表扫描
const CORE_GAP_NEIGHBOURS = [...INFILL_SITES, ...CORE_GREEN_SITES, ...PLAZA_SITES]
  .filter(s => Math.abs(s.z) <= CORE_GAP_Z1 + 60);

function coreGapNearSite(x: number, z: number): boolean {
  for (const s of CORE_GAP_NEIGHBOURS)
    if (Math.abs(x - s.x) < s.size / 2 + 10 && Math.abs(z - s.z) < s.size / 2 + 10) return true;
  return false;
}

/** 连片草皮站点表：|z|66–420 × |x|≤4400，x=48 / z=20 细网格，整数坐标 hash 抖动 */
function makeCoreGapLawns(): CoreGapLawn[] {
  const out: CoreGapLawn[] = [];
  for (const s of [-1, 1]) {
    for (let x = -4400; x <= 4400; x += CORE_GAP_STEP_X) {
      for (let a = CORE_GAP_Z0; a <= CORE_GAP_Z1; a += CORE_GAP_STEP_Z) {
        const gz = s * a;
        const seed = siteSeed(x, gz, 1301);
        // 仅 x 向 0–4m 整数抖动（不向 -x 越出 ±4400 判据、不破坏 z 规则行距）；
        // z 保持规则 20m 行距，块深 24–28 > 20 严格搭接 → 连片不留棋盘缝，|z|=66 行不被 66 门槛误杀
        const cx = x + (seed % 5), cz = gz;
        if (!coreGapClear(cx, cz)) continue;
        out.push({
          x: cx, z: cz,
          w: CORE_GAP_W + (seed % 5), d: CORE_GAP_D + ((seed >>> 4) % 5),
          variant: (seed >>> 9) % 6,
          nearSite: coreGapNearSite(cx, cz),
        });
      }
    }
  }
  return out;
}

/** 连片草皮站点表（导出给探针/单测读取）：确定性、零共享 RNG、独立台账 park.coreGap.* */
export const CORE_GAP_LAWNS: readonly CoreGapLawn[] = makeCoreGapLawns();

// ============ 基本形体 ============

/** 草地：贴在城内地坪（y=0）之上的薄层，压住贴图裸土、不与街面（0.12）抢高度。
 *  走 leaf 组而不是 ground：ground 的 0.24/m 石板贴图铺到 340m 草坪上会变成一张 1m 方格网，
 *  草面要的是均匀色块（叶子材质只采贴图一点，正好当纯色草地用）。 */
function lawn(b: Baker, x: number, z: number, w: number, d: number, hex = GRASS, y = 0.035): void {
  b.box('leaf', w, 0.07, d, x, y, z, hex);
}

/**
 * R22 第三轮 · 画面级根因修复（可 grep / 可机检）：
 * 城内地坪合批网格 city_ground 的顶面实测 y=0.28（坊间区域 9568 个采样顶点，5840 个落在 0.28 层），
 * 而上面 lawn() 的草坪顶面只有 y=0.07 —— 整片补绿草皮被石板铺装压在底下，台账再满画面也是褐色格网。
 * A/B 证据：artifacts/r22-ab-D-nocityground.png，只隐藏 city_ground 一张网格，
 * 同一机位立刻由「褐色大格网 + 稀疏小树」变成「连片深绿草地 + 树阵」。
 *
 * 修法：消裸地层改铺「贴地实心草台」——底面 y=0（不悬浮、不穿地），顶面 y=0.34（高于铺装 0.28），
 * 无论该格有没有石板铺装都表现一致；盒体面数不变（仍是 6 面 box），零新增 draw call。
 * 老园子（GRAND_PARKS / GARDENS）仍走 lawn() 薄层，保持原有园径、池岸、台基的高度关系，不受影响。
 */
const PAVE_TOP_Y = 0.28;                         // city_ground 铺装板顶面（顶点直方图实测）
const RAISED_LAWN_THICK = 0.02;
// 各补绿层用微量错开的 z，避免多层草皮在 |z|66–420 重叠区共面 z-fighting；
// 都在铺装顶面 0.28 之上、且远小于花圃(0.17)/台基(0.24) 等构件之上沿。
const RAISED_LAWN_Y_INFILL = PAVE_TOP_Y + 0.012;   // INFILL / CORE_GREEN：底 0.282
const RAISED_LAWN_Y_PLAZA = PAVE_TOP_Y + 0.024;    // PLAZA / CORE_GAP：底 0.294
/**
 * 消裸地层专用：贴在铺装顶面上方的薄草皮。
 * 做成薄层而不是 0→0.34 的实心草台，是为了不把同站点的花圃(顶 0.17)、亭台台基(顶 0.24)、
 * 石景与曲水小池埋进草里；树根从 y=0 穿出草皮，视觉上正是「树从草地里长出来」。
 */
function raisedLawn(b: Baker, x: number, z: number, w: number, d: number, hex = GRASS, y = RAISED_LAWN_Y_PLAZA): void {
  b.box('leaf', w, RAISED_LAWN_THICK, d, x, y, z, hex);
}

/**
 * 大片草地：底色 + 八九块深浅不一的色斑。一整片同色草地从 200m 外看就是一块绿塑料板，
 * 色斑只花 9 个盒子，却能把"草坪"读成"有起伏的地被"。
 * raised=true 供消裸地层（INFILL / CORE_GREEN）使用：草台与色斑一起抬到铺装之上，避免被 city_ground 盖住。
 */
function meadow(b: Baker, x: number, z: number, w: number, d: number, rnd: Rand, hex = GRASS, raised = false): void {
  if (raised) raisedLawn(b, x, z, w, d, hex, RAISED_LAWN_Y_INFILL);
  else lawn(b, x, z, w, d, hex);
  const spotY = raised ? RAISED_LAWN_Y_INFILL + 0.012 : 0.068;
  // 色斑只做 ±5% 明度、最大 20% 边长：再大一点就从"地被起伏"变成"草坪上的绿方块"
  for (let i = 0; i < 8; i++) {
    const pw = w * (0.10 + rnd() * 0.12), pd = d * (0.10 + rnd() * 0.12);
    const px = x + (rnd() - 0.5) * (w - pw), pz = z + (rnd() - 0.5) * (d - pd);
    if (canalClearance(px, pz) < 2) continue;   // 色斑不铺到渠面上（渠水在 1.0m，压着看不见但没必要留）
    b.box('leaf', pw, 0.02, pd, px, spotY, pz, shade(hex, 0.95 + rnd() * 0.10), rnd() * 0.9);
  }
}

// ============ R23：把「一层绿膜」改成真草地，并让大街保持石板 ============
/**
 * 用户 R23 反馈：①「草地就一层绿膜布满地面、近看也是一层绿膜，各种植物的叶呢？花呢？花草枝叶是这样吗」；
 * ②「为什么一些大街上都是绿膜，大街该有绿膜么」。
 *
 * ② 的真因：plazaClear / infillClear 只按站点 size 判道路，而实际草坪是 PLAZA_LAWN_W×D = 116×56m、
 * INFILL lawnSpan 可达 336m —— 草坪外廓远大于站点 size，于是整片大草坪盖到环城大路 / 御街上。
 * 这里改为**渲染层按街道走廊裁剪**：无论站点表怎么算，草皮都不会再压到任何一条街。
 *
 * ① 的真因：raisedLawn 只是一张纯色 box，每块最多 4–8 株小灌木，近景当然是一层塑料膜。
 * 这里给每块草地补倾斜草叶片、花瓣小球、带枝叶小灌木与深浅色斑，且全部走既有材质组 + Baker 合批。
 */
interface R23Rect { x: number; z: number; w: number; d: number }
interface R23Corridor { axis: 'x' | 'z'; c: number; half: number }

/** 全城街道走廊：与 imperial.ROAD_LINES / 御街 / 汴河岸街 / centralbelt 横街同一口径 */
const R23_CORRIDORS: R23Corridor[] = [
  { axis: 'x', c: 0, half: 34 },   // 御街 + 朱雀廊道
  { axis: 'z', c: 0, half: 66 },   // 汴河 + 河岸街屋带
];
for (const L of INFILL_ROADS) {
  R23_CORRIDORS.push(
    { axis: 'x', c: L, half: 62 }, { axis: 'x', c: -L, half: 62 },
    { axis: 'z', c: L, half: 62 }, { axis: 'z', c: -L, half: 62 },
  );
}

/** 把想铺草的矩形按走廊切成「草地段 / 街面段」；街面段后续铺石板，草地段后续撒草叶 */
function r23Split(rects: R23Rect[]): { grass: R23Rect[]; stone: R23Rect[] } {
  let cur = rects;
  const stone: R23Rect[] = [];
  for (const co of R23_CORRIDORS) {
    const next: R23Rect[] = [];
    for (const r of cur) {
      const lo = co.axis === 'x' ? r.x - r.w / 2 : r.z - r.d / 2;
      const hi = co.axis === 'x' ? r.x + r.w / 2 : r.z + r.d / 2;
      const a = co.c - co.half, bb = co.c + co.half;
      if (hi <= a || lo >= bb) { next.push(r); continue; }
      const s0 = Math.max(lo, a), s1 = Math.min(hi, bb);
      if (s1 > s0) {
        if (co.axis === 'x') stone.push({ x: (s0 + s1) / 2, z: r.z, w: s1 - s0, d: r.d });
        else stone.push({ x: r.x, z: (s0 + s1) / 2, w: r.w, d: s1 - s0 });
      }
      const pushPart = (p0: number, p1: number): void => {
        if (p1 - p0 < 0.6) return;
        if (co.axis === 'x') next.push({ x: (p0 + p1) / 2, z: r.z, w: p1 - p0, d: r.d });
        else next.push({ x: r.x, z: (p0 + p1) / 2, w: r.w, d: p1 - p0 });
      };
      pushPart(lo, Math.min(hi, a));
      pushPart(Math.max(lo, bb), hi);
    }
    cur = next;
  }
  return { grass: cur, stone };
}

const R23_STONE = 0x9a9282;
const R23_STONE_DK = 0x847d6e;
const R23_FLOWERS = [0xd8c05a, 0xcf7286, 0xe6e0c6, 0x9a76b4, 0xe08a48, 0xbdd05e] as const;
/** R23 第二轮：草叶必须用比草皮底色明显更亮的嫩绿，否则近景仍读作「一层绿膜」 */
const R23_BLADES = [0xa8d45c, 0xb8dd6a, 0x93c24c, 0x9ecb56, 0xc2e078, 0x86bd52] as const;

/** 一丛真草：4 片宽大倾斜叶（rx/rz 倾斜 + ry 外张）+ 六成带一朵可辨的彩色花。
 *  第一轮做成 0.07m 细叶 / 0.5m 高，2m 近景实拍完全看不见 —— 按画面尺度放大约 3 倍。 */
function r23GrassTuft(b: Baker, x: number, z: number, y: number, seed: number): void {
  const n = 4;
  const blade = R23_BLADES[(seed >>> 7) % R23_BLADES.length];
  const spread = 0.42 + ((seed >>> 12) % 30) / 100;
  for (let k = 0; k < n; k++) {
    const kh = siteSeed(x + k * 1.7, z - k * 2.1, 2300 + k);
    const hgt = 0.78 + ((kh % 60) / 100) * 0.86;          // 0.78–1.64m
    const tilt = 0.18 + (((kh >>> 6) % 34) / 100);
    const yaw = (k / n) * Math.PI * 2 + (seed % 10) * 0.11;
    b.box('leaf', 0.24, hgt, 0.52,
      x + Math.cos(yaw) * spread, y + hgt / 2, z + Math.sin(yaw) * spread,
      shade(blade, 0.98 + (((kh >>> 20) % 28) / 100)),
      yaw, tilt * Math.cos(yaw), tilt * Math.sin(yaw));
  }
  if ((seed % 5) < 3) {
    b.sphere('ceramic', 0.24, 5, x, y + 1.12, z,
      R23_FLOWERS[(seed >>> 9) % R23_FLOWERS.length], 0, 0, 0, 1, 0.85, 1);
  }
}

/** 一株带枝叶的小灌木：主干 + 3 根斜枝 + 3 团叶，读作「枝叶」而不是一颗球 */
function r23Twig(b: Baker, x: number, z: number, y: number, seed: number): void {
  // R23 第二轮：同样按画面尺度放大，近景能看清「枝 + 叶」而不是三粒小点
  const hgt = 1.0 + ((seed >>> 5) % 60) / 100;
  b.cyl('trunk', 0.06, 0.1, hgt, 5, x, y + hgt / 2, z, TRUNK);
  for (let k = 0; k < 3; k++) {
    const kh = siteSeed(x, z + k, 2400 + k);
    const a = (k / 3) * Math.PI * 2 + (seed % 10) * 0.1;
    b.box('wood', 0.06, 0.06, 0.8, x + Math.cos(a) * 0.32, y + hgt * 0.72, z + Math.sin(a) * 0.32,
      TRUNK, a, 0, 0.36);
    b.sphere('leaf', 0.45, 5, x + Math.cos(a) * 0.6, y + hgt * 0.9, z + Math.sin(a) * 0.6,
      shade((kh & 1) ? LEAF : LEAF_WARM, 0.9 + (kh % 22) / 100), 0, 0, 0, 1.15, 0.72, 1.15);
  }
}

/**
 * R23 草地总入口：按街道走廊裁剪 → 草地段铺深浅草色 + 草叶/花/枝叶，街面段铺石板。
 * 全部既有材质组 + Baker 合批（0 新材质组 / 0 独立 Mesh / 0 draw call）；
 * 位置/颜色/形态全由 siteSeed 整数 hash 派生，零共享 RNG、不用 Math.random。
 */
/**
 * R24b：用户追问「不规则圆草斑？？？就他妈不能是随机的任意不规则的形状吗？？？」
 * 根因：上一版用 b.cyl(7~9 边) —— 那只是**多边形圆盘**，外轮廓仍是圆；且底下还垫了
 * 一整块 b.box 矩形基底，俯瞰依旧读作「方格 + 圆斑」的棋盘。
 * 现在改为真正任意不规则的自由轮廓（见 freeBlob.ts：非等分角度 / 多频半径 / 连续深凹 /
 * 尖尾枝杈 / 自带长宽比），每块再独立旋转 + 非等比拉伸，任意两块都不同：
 *   · 3 张大底斑错开搭接，替代矩形基底，保证不露铺装但边界是撕裂的自然曲线；
 *   · 5~18 张中小斑在地块内按面积与 hash 随机疏密散布，不是均匀铺满的一层膜；
 *   · 6 张细长撕裂斑沿边缘咬碎直线边界，与相邻地块互相穿插 → 网格感彻底消失。
 * 全部走既有 leaf 材质组 + Baker.addGeo 合批：0 新材质组 / 0 独立 Mesh / 0 draw call；
 * 形状 / 位置 / 旋转 / 拉伸 / 色阶全部 siteSeed 整数 hash，零共享 RNG、不用 Math.random。
 * 溢出控制在 rect 半宽内，不越过 r23Split 裁出的石板街面（避免「大街上都是绿膜」复发）。
 */
function r23OrganicMeadow(b: Baker, r: R23Rect, y: number, salt: number): void {
  const B = freeBlobGeometries();
  const area = r.w * r.d;
  let placed = 0;
  // ① 大底斑：3 张互相错开搭接，取代整块矩形草皮
  for (let k = 0; k < 3; k++) {
    const hs = siteSeed(r.x + k * 17.3, r.z - k * 11.7, salt + 4001 + k);
    const g = B[hs % B.length];
    const jx = ((((hs >>> 8) % 1000) / 1000) - 0.5) * r.w * 0.24;
    const jz = ((((hs >>> 18) % 1000) / 1000) - 0.5) * r.d * 0.24;
    const sx = r.w * (0.30 + (((hs >>> 3) % 9) / 100));
    const sz = r.d * (0.30 + (((hs >>> 13) % 9) / 100));
    putFreeBlob(b, g, r.x + jx, y + 0.0015 * k, r.z + jz,
      shade(GRASS, 0.76 + (((hs >>> 24) % 30) / 100)),
      (hs % 628) / 100, sx, sz);
    placed++;
  }
  // ② 随机疏密的中小自由斑
  const blobs = Math.max(5, Math.min(18, Math.round(area / 420)));
  for (let k = 0; k < blobs; k++) {
    const hs = siteSeed(r.x + k * 13.1, r.z - k * 7.9, salt + 4201 + k);
    const g = B[(hs >>> 4) % B.length];
    const px = r.x + ((((hs >>> 9) % 1000) / 1000) - 0.5) * r.w * 0.80;
    const pz = r.z + ((((hs >>> 19) % 1000) / 1000) - 0.5) * r.d * 0.80;
    const base = Math.min(r.w, r.d);
    const sx = Math.min(r.w * 0.22, 1.4 + (((hs >>> 2) % 100) / 100) * base * 0.16);
    const sz = Math.min(r.d * 0.22, 1.0 + (((hs >>> 12) % 100) / 100) * base * 0.13);
    putFreeBlob(b, g, px, y + 0.004 + (k % 5) * 0.0012, pz,
      shade(GRASS, 0.78 + (((hs >>> 25) % 44) / 100)),
      (hs % 628) / 100, sx, sz);
    placed++;
  }
  // ③ 边缘撕裂细斑：长条 / 扁片，把地块直线边界咬碎
  for (let k = 0; k < 6; k++) {
    const hs = siteSeed(r.x - k * 9.7, r.z + k * 5.3, salt + 5101 + k);
    const g = B[(hs >>> 7) % B.length];
    const edge = k % 2 === 0 ? 1 : -1;
    const alongX = k < 3;
    const px = alongX
      ? r.x + ((((hs >>> 5) % 1000) / 1000) - 0.5) * r.w * 0.7
      : r.x + edge * r.w * 0.40;
    const pz = alongX
      ? r.z + edge * r.d * 0.40
      : r.z + ((((hs >>> 15) % 1000) / 1000) - 0.5) * r.d * 0.7;
    const sx = alongX ? Math.min(r.w * 0.16, 2.2 + (hs % 40) / 10) : Math.min(r.w * 0.05, 1.2 + (hs % 18) / 10);
    const sz = alongX ? Math.min(r.d * 0.05, 1.2 + (hs % 18) / 10) : Math.min(r.d * 0.16, 2.2 + (hs % 40) / 10);
    putFreeBlob(b, g, px, y + 0.007 + k * 0.0008, pz,
      shade(GRASS, 0.86 + (k % 3) * 0.06), (hs % 628) / 100, sx, sz);
    placed++;
  }
  b.kit('park.r24.freeBlob', placed, 0);
}

function r23Ground(b: Baker, x: number, z: number, w: number, d: number, y: number, salt: number): number {
  const { grass, stone } = r23Split([{ x, z, w, d }]);
  for (const r of stone) {
    b.box('ash', r.w, 0.02, r.d, r.x, y + 0.002, r.z, R23_STONE);
    const hs = siteSeed(r.x, r.z, salt + 17);
    if (r.w > 3 && r.d > 3) {
      for (let k = 0; k < 3; k++) {
        const sx = r.x + ((((hs >>> (k * 5)) % 100) / 100) - 0.5) * r.w * 0.8;
        b.box('ash', Math.min(r.w * 0.8, 6), 0.006, 0.07, sx, y + 0.014, r.z, R23_STONE_DK);
      }
    }
  }
  b.kit('park.r23.stone', stone.length, 0);
  let plants = 0;
  for (const r of grass) {
    // R24：不再铺整块矩形草皮（俯瞰是棋盘格），改铺重叠的有机圆草斑群
    r23OrganicMeadow(b, r, y, salt);
    const area = r.w * r.d;
    // 深浅色斑：R24b 也换成任意不规则小斑（旧版是矩形小色块，俯瞰仍是一堆小方块）
    const spots = Math.min(10, Math.max(2, Math.round(area / 900)));
    const B = freeBlobGeometries();
    for (let k = 0; k < spots; k++) {
      const hs = siteSeed(r.x + k * 7, r.z - k * 5, salt + 31 + k);
      const pw = Math.min(r.w * 0.18, 2 + (hs % 9)), pd = Math.min(r.d * 0.18, 2 + ((hs >>> 7) % 8));
      putFreeBlob(b, B[(hs >>> 3) % B.length],
        r.x + ((((hs >>> 12) % 100) / 100) - 0.5) * (r.w - pw * 2), y + 0.014,
        r.z + ((((hs >>> 19) % 100) / 100) - 0.5) * (r.d - pd * 2),
        shade(GRASS, 0.86 + ((hs >>> 24) % 34) / 100), (hs % 628) / 100, pw, pd);
    }
    b.kit('park.r24.spotBlob', spots, 0);
    // 密度分层：玩家能走到的城内核心带（|x|<1800、|z|<760）按 ~30㎡/丛密铺，
    // 远景外围降到 ~280㎡/丛；总原语数与上一轮相当，但近景从「每 200㎡ 一丛」变成连片草。
    const core = Math.abs(r.x) < 1800 && Math.abs(r.z) < 760;
    const tufts = core
      ? Math.max(8, Math.min(58, Math.round(area / 30)))
      : Math.max(3, Math.min(9, Math.round(area / 280)));
    for (let k = 0; k < tufts; k++) {
      const hs = siteSeed(r.x + k * 13.7, r.z - k * 9.3, salt + 61 + k);
      const px = r.x + (((hs % 1000) / 1000) - 0.5) * r.w * 0.92;
      const pz = r.z + ((((hs >>> 10) % 1000) / 1000) - 0.5) * r.d * 0.92;
      r23GrassTuft(b, px, pz, y + 0.016, hs);
      plants++;
    }
    const twigs = Math.max(1, Math.min(6, Math.round(area / 900)));
    for (let k = 0; k < twigs; k++) {
      const hs = siteSeed(r.x - k * 11.3, r.z + k * 6.1, salt + 97 + k);
      const px = r.x + (((hs % 1000) / 1000) - 0.5) * r.w * 0.8;
      const pz = r.z + ((((hs >>> 11) % 1000) / 1000) - 0.5) * r.d * 0.8;
      r23Twig(b, px, pz, y + 0.016, hs);
      plants++;
    }
  }
  b.kit('park.r23.tuft', plants, 0);
  b.kit('park.r23.grassRect', grass.length, 0);
  return plants;
}

/**
 * 池岸形状（局部坐标，中心在原点）：THREE.Shape 建水面与石砌岸唇（岸线按 hash 抖动 ±8%，
 * 不是圆规画的池子）。用 Shape/ShapeGeometry 而不是手拼三角带：
 * ShapeGeometry 的绕序由 three 保证朝 +Y，手写扇形极容易法线朝下 —— 池面会变成一张从上方看不见的透明纸。
 */
function pondShape(r: number, rnd: Rand, seg = 26): THREE.Shape {
  const sh = new THREE.Shape();
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 0.17;
    const px = Math.cos(a) * r * k;
    const pz = Math.sin(a) * r * k;
    // Shape 在 XY 平面工作，绕 X 轴转 −90° 后 shape.y → 世界 −z
    if (i === 0) sh.moveTo(px, -pz);
    else sh.lineTo(px, -pz);
  }
  sh.closePath();
  return sh;
}

function flatFromShape(sh: THREE.Shape, y: number, uvScale: number): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(sh);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (uv) for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
  return geo;
}

function addFlat(b: Baker, group: 'water' | 'ash' | 'ground', geo: THREE.BufferGeometry, cx: number, cz: number, hex: number): void {
  b.addGeo(group, geo, cx, 0, cz, hex, 0, 0, 0);
}

/**
 * 水面：单个扇形网格 + **顶点色径向渐变**（中心深、岸边浅）。
 * 旧实现是三层同心盘各一色 —— 水色一改就露出硬边同心环，像一池油污；顶点色渐变没有任何边界。
 * 绕序取 (中心, p[i+1], p[i])：世界 XZ 平面里角度递增在俯视下是顺时针，反过来才朝 +Y。
 */
function pondWater(b: Baker, cx: number, cz: number, r: number, seed: number): void {
  const rnd = mkRand(seed);
  const seg = 34;
  const pos: number[] = [0, 0, 0], nor: number[] = [0, 1, 0];
  const deep = new THREE.Color(POND_DEEP), edge = new THREE.Color(POND_EDGE);
  const col: number[] = [deep.r, deep.g, deep.b];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 0.17;
    pos.push(Math.cos(a) * r * k, 0, Math.sin(a) * r * k);
    nor.push(0, 1, 0);
    col.push(edge.r, edge.g, edge.b);
  }
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  // hex 必须给白：Baker 的最终色 = base × AO × 顶点色，底色一染就会把渐变压成单色
  b.addGeo('water', geo, cx, 0.10, cz, 0xffffff, 0, 0, 0);
}

/** 池 + 石岸 + 荷叶 + 岸苇（岸唇 0.95m 宽，压 0.14m 高，读作条石压边而不是一圈水泥地坪） */
function pond(b: Baker, cx: number, cz: number, r: number, seed: number): void {
  const rnd = mkRand(seed);
  const outer = pondShape(r + 0.95, mkRand(seed ^ 0x51ed));
  const hole = pondShape(r * 0.99, mkRand(seed ^ 0x51ed));
  outer.holes.push(new THREE.Path(hole.getPoints(64)));
  addFlat(b, 'ash', flatFromShape(outer, 0.14, 0.55), cx, cz, STONE_DK);
  pondWater(b, cx, cz, r * 0.99, seed ^ 0x2b1);
  // 荷叶：贴水面的扁圆盘（不是圆锥）
  for (let i = 0; i < Math.round(r * 0.5); i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r * (0.25 + rnd() * 0.62);
    b.cyl('leaf', 0.42 + rnd() * 0.3, 0.42 + rnd() * 0.3, 0.03, 7,
      cx + Math.cos(a) * rr, 0.15, cz + Math.sin(a) * rr,
      shade(LEAF, 0.86 + rnd() * 0.28), rnd() * 3.14, 0, 0, false, 1, 1, 1);
  }
  // 岸苇：细杆 + 两粒穗（不用锥体，杆是圆柱、穗是小球）
  for (let i = 0; i < Math.round(r * 0.55); i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r * (0.86 + rnd() * 0.11);
    const rx2 = cx + Math.cos(a) * rr, rz2 = cz + Math.sin(a) * rr;
    const h2 = 0.8 + rnd() * 0.8;
    b.cyl('trunk', 0.035, 0.05, h2, 4, rx2, h2 / 2 + 0.12, rz2, shade(0x6a6a3a, 0.9 + rnd() * 0.2));
    b.sphere('leaf', 0.1, 4, rx2, h2 + 0.18, rz2, shade(0x7a7a44, 0.9 + rnd() * 0.2), 0, 0, 0, 1, 2.2, 1);
  }
  b.kit('park.pond', 1, 0.1);
}

/** 池中小岛：石岸一圈 + 岛面 + 散石，桥与亭由调用方叠上去 */
function island(b: Baker, cx: number, cz: number, r: number, seed: number): void {
  const rnd = mkRand(seed);
  addFlat(b, 'ground', flatFromShape(pondShape(r + 0.5, mkRand(seed ^ 0x77), 14), 0.32, 0.5), cx, cz, shade(GRASS_DK, 1.12));
  addFlat(b, 'ash', flatFromShape(pondShape(r + 0.9, mkRand(seed ^ 0x77), 14), 0.2, 0.5), cx, cz, STONE_DK);
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r * (0.62 + rnd() * 0.28);
    b.box('ash', 0.5 + rnd() * 0.7, 0.22 + rnd() * 0.3, 0.4 + rnd() * 0.6,
      cx + Math.cos(a) * rr, 0.36, cz + Math.sin(a) * rr, shade(STONE_LT, 0.9 + rnd() * 0.2), rnd() * 3.14);
  }
  b.kit('park.island', 1, 0.32);
}

/**
 * 拱桥：桥面沿弧线抬升（y = 0.35 + rise·sin πt），两侧栏杆逐段跟随桥面。
 * 桥面用 12 段垫石拼，段间重叠 6cm，近景看不出断缝；拱圈从桥下补一圈券石。
 */
function archBridge(b: Baker, x: number, z: number, len: number, width: number, rise: number, ry: number, hex = shade(STONE_LT, 1.0), baseY = 0.34): void {
  const n = 12;
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const at = (t: number): [number, number] => [x + (t - 0.5) * len * cs, z - (t - 0.5) * len * sn];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const tm = (t0 + t1) / 2;
    const y = baseY + rise * Math.sin(Math.PI * tm);
    const [px, pz] = at(tm);
    b.box('ash', (len / n) * 1.12, 0.26, width, px, y, pz, shade(hex, 0.96 + (i % 2) * 0.05), ry);
    // 桥面石板缝
    b.box('ash', (len / n) * 1.14, 0.06, width * 0.94, px, y + 0.15, pz, shade(hex, 1.08), ry);
  }
  // 拱圈券石：桥面之下一道半圆（只做可见的两侧）
  const archN = 9;
  for (let i = 1; i < archN; i++) {
    const t = i / archN;
    const [px, pz] = at(t);
    const y = baseY + rise * Math.sin(Math.PI * t) - 0.2;
    const drop = 0.55 * Math.sin(Math.PI * t) + 0.15;
    for (const s of [-1, 1]) {
      const ox = s * (width / 2) * -sn, oz = s * (width / 2) * -cs;
      b.box('ash', (len / archN) * 1.2, drop, 0.32, px + ox, y - drop / 2, pz + oz, shade(STONE_DK, 1.04), ry);
    }
  }
  // 栏杆：望柱 + 扶手，逐段跟随桥面（扶手不做曲线，用短段折线近似）
  const posts = 7;
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    const [px, pz] = at(t);
    const y = baseY + rise * Math.sin(Math.PI * t);
    for (const s of [-1, 1]) {
      const ox = s * (width / 2 - 0.16) * -sn, oz = s * (width / 2 - 0.16) * -cs;
      b.box('ash', 0.2, 1.0, 0.2, px + ox, y + 0.63, pz + oz, shade(STONE_LT, 1.06), ry);
    }
  }
  for (let i = 0; i < posts; i++) {
    const t0 = i / posts, t1 = (i + 1) / posts;
    const tm = (t0 + t1) / 2;
    const [px, pz] = at(tm);
    const y = baseY + rise * Math.sin(Math.PI * tm);
    for (const s of [-1, 1]) {
      const ox = s * (width / 2 - 0.16) * -sn, oz = s * (width / 2 - 0.16) * -cs;
      b.box('ash', 0.16, 0.14, (len / posts) * 0.98, px + ox, y + 1.06, pz + oz, shade(STONE_LT, 1.1), ry + Math.PI / 2);
    }
  }
  b.kit('park.bridge', 1, 0.6);
}

/**
 * 渠上小桥：五丈河的岸顶在 1.30m（R10 的石岸），园里 0.07m 的草地比水面低一米多，
 * 所以跨渠的桥不能按 0.34m 的基础造——桥面抬到岸顶之上，两端各接四级踏步落地。
 */
function canalBridge(b: Baker, cx: number, cz: number, ry: number): void {
  const base = 1.34, span = 21, width = 2.9;
  archBridge(b, cx, cz, span, width, 0.95, ry, shade(STONE_LT, 1.04), base);
  const cs = Math.cos(ry), sn = Math.sin(ry);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const d = span / 2 + 0.75 + k * 1.15;
      const y = base - 0.06 - k * 0.33;
      b.box('ash', 1.25, 0.22, width, cx + s * d * cs, y, cz - s * d * sn, shade(STONE_LT, 1.02 - k * 0.02), ry);
    }
  }
}

/** 最近支渠的渠心点与走向（yaw，局部 X 指向渠的切线方向） */
function canalNearest(x: number, z: number): { x: number; z: number; yaw: number } {
  let best = Infinity;
  let out = { x, z, yaw: 0 };
  for (const br of WATER_BRANCHES) {
    for (let i = 0; i < br.pts.length - 1; i++) {
      const ax = br.pts[i][0], az = br.pts[i][1];
      const dx = br.pts[i + 1][0] - ax, dz = br.pts[i + 1][1] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; out = { x: px, z: pz, yaw: Math.atan2(-dz, dx) }; }
    }
  }
  return out;
}

/** 阔叶乔木：两段收分干 + 三主枝 + 七团球冠（叶团压扁、外缘碎化）——按规格只用 sphere + cyl */
function broadleaf(b: Baker, x: number, z: number, s: number, rnd: Rand): void {
  const h = (6.2 + rnd() * 2.4) * s;
  const trunkC = shade(TRUNK, 0.92 + rnd() * 0.14);
  b.cyl('trunk', 0.19 * s, 0.38 * s, h * 0.34, 6, x, h * 0.17, z, trunkC);
  b.cyl('trunk', 0.13 * s, 0.2 * s, h * 0.32, 6, x, h * 0.42, z, shade(trunkC, 1.04));
  const topY = h * 0.56;
  const leafC = shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.92 + rnd() * 0.14);
  // 三主枝：俯仰 50°–65°
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2;
    const p = 0.95 + rnd() * 0.25;
    const len = (1.1 + rnd() * 0.5) * s;
    const dx = Math.sin(a) * Math.cos(p) * len, dy = Math.sin(p) * len, dz = Math.cos(a) * Math.cos(p) * len;
    b.cyl('trunk', 0.05 * s, 0.12 * s, len, 5, x + dx * 0.5, topY + dy * 0.5, z + dz * 0.5,
      shade(trunkC, 1.06), 0, Math.sin(a) * p, -Math.cos(a) * p);
  }
  // 冠：内团三 + 外团四，全部压扁球（sy 0.78），球缘再咬 8 个小团打碎轮廓
  const crown = topY + 0.5 * s;
  const clumps: [number, number, number, number][] = [
    [0, 0.15, 0, 1.75], [-0.85, -0.05, 0.35, 1.25], [0.8, 0.02, -0.3, 1.2],
    [0.2, 0.55, 0.72, 1.02], [-0.28, 0.5, -0.78, 0.98], [0.95, 0.3, 0.45, 0.86], [-0.9, 0.28, -0.42, 0.9],
  ];
  clumps.forEach(([ox, oy, oz, cs], i) => {
    const r = cs * s;
    b.sphere('leaf', r, 7, x + ox * s, crown + oy * s, z + oz * s,
      shade(leafC, 0.9 + i * 0.04 + rnd() * 0.05), rnd() * 3.14, 0, 0, 1.08, 0.78, 1.08);
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rnd() * 0.6;
    const rr = (1.35 + rnd() * 0.55) * s;
    b.sphere('leaf', (0.42 + rnd() * 0.24) * s, 5,
      x + Math.cos(a) * rr, crown + (0.1 + (rnd() - 0.5) * 0.9) * s, z + Math.sin(a) * rr,
      shade(leafC, 1.02 + rnd() * 0.1), rnd() * 3.14, 0, 0, 1.12, 0.8, 1.12);
  }
  b.kit('park.tree', 1, crown);
}

/** 高杨：冠竖向拉长（sy 1.7 的球叠三段），与阔叶的横冠拉开剪影 */
function poplar(b: Baker, x: number, z: number, s: number, rnd: Rand): void {
  const h = (8.5 + rnd() * 3.0) * s;
  const trunkC = shade(TRUNK, 0.9 + rnd() * 0.12);
  b.cyl('trunk', 0.16 * s, 0.3 * s, h * 0.62, 6, x, h * 0.31, z, trunkC);
  const leafC = shade(0x4f7a42, 0.92 + rnd() * 0.14);
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    b.sphere('leaf', (1.35 - t * 0.42) * s, 7, x + (rnd() - 0.5) * 0.3 * s, h * (0.56 + t * 0.2), z + (rnd() - 0.5) * 0.3 * s,
      shade(leafC, 0.92 + i * 0.06), rnd() * 3.14, 0, 0, 0.92, 1.55, 0.92);
  }
  b.kit('park.tree', 1, h * 0.7);
}

/** 置石（太湖石意）：3–5 块小石叠置，转角各异，石上缀苔。单块不超过 1.2m——
 *  旧尺寸（1.1–2.2m 的方盒）在近景读成一摞水泥块，置石要碎、要瘦。 */
function rockery(b: Baker, x: number, z: number, s: number, rnd: Rand): void {
  const n = 3 + Math.floor(rnd() * 3);
  let y = 0.08;
  for (let i = 0; i < n; i++) {
    const w = (0.45 + rnd() * 0.55) * s, hh = (0.35 + rnd() * 0.6) * s, d = (0.35 + rnd() * 0.5) * s;
    b.box('ash', w, hh, d, x + (rnd() - 0.5) * 0.8 * s, y + hh / 2, z + (rnd() - 0.5) * 0.8 * s,
      shade(STONE_DK, 0.86 + rnd() * 0.26), rnd() * 3.14, (rnd() - 0.5) * 0.24, (rnd() - 0.5) * 0.24);
    y += hh * 0.78;
  }
  for (let i = 0; i < 4; i++) {
    b.sphere('leaf', (0.16 + rnd() * 0.12) * s, 5, x + (rnd() - 0.5) * 1.1 * s, 0.1 + rnd() * 0.45 * s, z + (rnd() - 0.5) * 1.1 * s,
      shade(0x35502c, 1.0 + rnd() * 0.2), rnd() * 3.14, 0, 0, 1.3, 0.5, 1.3);
  }
  b.kit('park.rock', 1, 0.4);
}

/** 亭：台明 + 柱 + 阑额挂落 + 攒尖顶 + 坐凳栏杆 + 石桌；sides=4 方亭 / 6 六角亭 */
function pavilion(b: Baker, x: number, z: number, r: number, sides: 4 | 6, ry: number, seed: number): void {
  const rnd = mkRand(seed);
  const deck = 0.5;
  const colH = 2.85;
  // 台明（方亭用方台，六角亭用六棱台，避免台与柱圈错位）
  if (sides === 4) {
    b.box('ash', r * 2 + 1.9, 0.34, r * 2 + 1.9, x, 0.17, z, shade(STONE_LT, 1.0), ry);
    b.box('ash', r * 2 + 1.4, 0.18, r * 2 + 1.4, x, 0.43, z, shade(STONE_LT, 1.08), ry);
  } else {
    b.cyl('ash', r + 1.05, r + 1.2, 0.34, 6, x, 0.17, z, shade(STONE_LT, 1.0), ry);
    b.cyl('ash', r + 0.82, r + 1.0, 0.18, 6, x, 0.43, z, shade(STONE_LT, 1.08), ry);
  }
  // 踏步（朝 ry 方向落地）
  const fx = Math.sin(ry), fz = Math.cos(ry);
  for (let k = 0; k < 2; k++) {
    b.box('ash', 2.0 - k * 0.2, 0.17, 0.78, x + fx * (r + 1.25 + k * 0.66), 0.17 - k * 0.09, z + fz * (r + 1.25 + k * 0.66),
      shade(STONE_LT, 0.94 - k * 0.04), ry);
  }
  // 柱位
  const pts: [number, number][] = [];
  if (sides === 4) {
    const c = Math.cos(Math.PI / 4) * r * 1.06;
    const ring: [number, number][] = [[c, c], [c, -c], [-c, -c], [-c, c]];
    for (const [ox, oz] of ring) pts.push([x + ox * Math.cos(ry) + oz * Math.sin(ry), z - ox * Math.sin(ry) + oz * Math.cos(ry)]);
  } else {
    for (let i = 0; i < 6; i++) {
      const a = ry + (i / 6) * Math.PI * 2;
      pts.push([x + Math.sin(a) * r, z + Math.cos(a) * r]);
    }
  }
  for (const [px, pz] of pts) {
    b.cyl('ash', 0.26, 0.3, 0.18, 8, px, deck + 0.09, pz, shade(STONE_DK, 1.06));
    b.cyl('wood', 0.14, 0.17, colH, 7, px, deck + 0.18 + colH / 2, pz, shade(C.woodRed, 0.9 + rnd() * 0.08));
  }
  // 阑额 + 挂落：逐边连成圈（同时给亭子一道水平剪影线）
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c2 = pts[(i + 1) % pts.length];
    const dx = c2[0] - a[0], dz = c2[1] - a[1];
    const len = Math.hypot(dx, dz);
    const ang = along(dx, dz);
    b.box('wood', len, 0.22, 0.18, (a[0] + c2[0]) / 2, deck + 0.18 + colH - 0.1, (a[1] + c2[1]) / 2, shade(C.woodDark, 1.06), ang);
    b.box('wood', len * 0.94, 0.3, 0.08, (a[0] + c2[0]) / 2, deck + 0.18 + colH - 0.38, (a[1] + c2[1]) / 2, shade(C.wood, 1.12), ang);
    b.box('wood', len * 0.94, 0.08, 0.07, (a[0] + c2[0]) / 2, deck + 0.18 + colH - 0.55, (a[1] + c2[1]) / 2, shade(C.woodDark, 0.94), ang);
    // 坐凳栏杆 + 扶手：正对踏步的那一边留空（进出）
    const mid: [number, number] = [(a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2];
    const outward = Math.atan2(mid[0] - x, mid[1] - z);
    const dd = Math.abs(((outward - ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dd < 0.45) continue;
    b.box('wood', len * 0.96, 0.12, 0.42, mid[0], deck + 0.62, mid[1], shade(C.wood, 1.0), ang);
    b.box('wood', len * 0.96, 0.1, 0.12, mid[0], deck + 1.0, mid[1], shade(C.woodDark, 1.1), ang);
    for (let k = 1; k <= 2; k++) {
      const t = k / 3;
      b.box('wood', 0.1, 0.44, 0.1, a[0] + dx * t, deck + 0.82, a[1] + dz * t, shade(C.woodDark, 0.98));
    }
  }
  // 攒尖顶：檐口下压一圈（起翘）+ 主锥 + 宝顶。屋面比墙身亮一档——
  // C.tile 在黄昏掠射角下会塌成黑块，园亭又小又孤，必须让瓦面留一点灰度才读得出反宇曲线。
  const roofY = deck + 0.18 + colH + 0.1;
  if (sides === 4) {
    const H = r * 1.02 + 1.25;
    b.box('roof', H * 2, 0.26, H * 2, x, roofY + 0.06, z, shade(C.tile2, 1.12), ry);
    // pyramid 的 rb 是四棱台外接半径，rotateY(π/4) 后足印半宽 = rb/√2，故 rb 要乘 √2 才盖住 H
    b.pyramid('roof', 0.32, (r * 1.06 + 1.5) * Math.SQRT2, x, roofY + 1.05, z, shade(C.tile2, 1.2), ry, 1, 2.0, 1);
  } else {
    b.cyl('roof', r + 1.25, r + 1.6, 0.3, 6, x, roofY + 0.06, z, shade(C.tile2, 1.12), ry);
    b.cyl('roof', 0.34, r + 1.5, 2.0, 6, x, roofY + 1.15, z, shade(C.tile2, 1.2), ry);
  }
  b.cyl('wood', 0.1, 0.12, 0.42, 6, x, roofY + 2.3, z, shade(C.woodDark, 1.1));
  b.sphere('ceramic', 0.3, 10, x, roofY + 2.62, z, 0xd8c48a, 0, 0, 0, 1, 1.25, 1);
  // 亭内石桌 + 两只鼓凳
  b.cyl('ash', 0.52, 0.58, 0.12, 10, x, deck + 0.72, z, shade(STONE_LT, 1.06));
  b.cyl('ash', 0.24, 0.3, 0.6, 8, x, deck + 0.36, z, shade(STONE_DK, 1.02));
  for (const s of [-1, 1]) {
    b.cyl('ash', 0.24, 0.26, 0.42, 8, x + s * 0.95, deck + 0.21, z + s * 0.2, shade(STONE_LT, 0.96));
  }
  // 檐下宫灯：吊在柱列内侧（旧位置挂在檐外 0.8r，读作一颗悬空黄球）
  const lx = x + fx * (r * 0.55), lz = z + fz * (r * 0.55);
  const lTop = deck + 0.18 + colH - 0.12;
  b.cyl('wood', 0.035, 0.035, 0.55, 4, lx, lTop - 0.15, lz, shade(C.woodDark, 1.0));
  b.cyl('wood', 0.2, 0.1, 0.08, 6, lx, lTop - 0.44, lz, shade(C.woodDark, 1.06));
  b.cyl('glow', 0.2, 0.22, 0.34, 8, lx, lTop - 0.66, lz, C.neonGold);
  b.cyl('wood', 0.22, 0.18, 0.06, 6, lx, lTop - 0.86, lz, shade(C.woodDark, 0.98));
  b.sphere('glow', 0.07, 5, lx, lTop - 0.95, lz, C.lantern, 0, 0, 0, 1, 2.2, 1);
  b.kit('park.pavilion', 1, deck + colH);
}

/** 碎石曲径：路点插值成 3.2m 短段盒（盒间搭接 0.4m，接缝藏在碎石色差里）。
 *  `dry` 为落位判据（缺省处处可走）；给园子用时传 canal clearance，路在水缘就收头。 */
function gravelPath(b: Baker, pts: [number, number][], width: number, dry?: (x: number, z: number) => boolean, hex = GRAVEL): void {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const seg = Math.hypot(dx, dz);
    if (seg < 0.01) continue;
    const n = Math.max(1, Math.ceil(seg / 3.2));
    const ang = along(dx, dz);
    let placed = true;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = x0 + dx * t, pz = z0 + dz * t;
      if (dry && !dry(px, pz)) { placed = false; continue; }
      b.box('ground', (seg / n) * 1.14, 0.07, width, px, 0.075, pz, shade(hex, 0.94 + ((i + k) % 3) * 0.04), ang);
    }
    if (placed) len += seg;
  }
  b.kit('park.path', 1, 0.075);
  void len;
}

/** 矮花圃：三五种花色的小球簇（点在园径两侧，给"园林"而不是"草坪"的气味） */
function flowerBed(b: Baker, x: number, z: number, w: number, d: number, rnd: Rand): void {
  b.box('earth', w, 0.16, d, x, 0.09, z, shade(0x6b5842, 1.06));
  const cols = [0xc2677a, 0xd8a24a, 0xd8d0b0, 0x9a6fb0];
  const n = Math.max(6, Math.round((w * d) / 5));
  for (let i = 0; i < n; i++) {
    b.sphere('leaf', 0.22 + rnd() * 0.14, 5,
      x + (rnd() - 0.5) * (w - 0.5), 0.28 + rnd() * 0.12, z + (rnd() - 0.5) * (d - 0.5),
      shade(cols[(rnd() * cols.length) | 0], 0.94 + rnd() * 0.18), rnd() * 3.14, 0, 0, 1, 0.8, 1);
  }
  b.kit('park.flower', 1, 0.3);
}

// ============ 大苑囿 ============

function buildGrandPark(b: Baker, sg: SignMesher, atlas: SignAtlas, site: ParkSite): void {
  const rnd = mkRand(siteSeed(site.x, site.z, 3));
  const x = site.x, z = site.z;
  const hw = site.w / 2, hd = site.d / 2;
  // 园地：草皮压住裸土（比地坪高 7cm，避开街面 12cm 的铺装层）
  meadow(b, x, z, site.w - 6, site.d - 6, rnd, GRASS);
  // 围墙：粉墙 + 瓦压顶（与全城街墙同一套「灰泥白 + 瓦灰黑」），正面（朝城 −x）与南面各开一道门。
  // 墙体遇水断开：五丈河从这两块园址的北缘穿过去，墙压在水上就是一道横跨石渠的粉墙——断成水门才对。
  const wallH = 1.9;
  const gateAt = (zz: number): boolean => Math.abs(zz - z) > 9;
  for (const s of [-1, 1]) {
    // 东西两道墙（沿 z 走向）
    const wx = x + s * hw;
    for (let zz = z - hd; zz < z + hd; zz += 8) {
      const seg = Math.min(8, z + hd - zz);
      if (s < 0 && !gateAt(zz + seg / 2)) continue;      // 西门洞
      if (canalClearance(wx, zz + seg / 2) < 3) continue; // 水门洞
      b.box('wall', 0.55, wallH, seg, wx, wallH / 2, zz + seg / 2, shade(C.plaster2, 0.94 + rnd() * 0.08));
      b.box('roof', 0.85, 0.16, seg, wx, wallH + 0.08, zz + seg / 2, C.tile);
      b.box('earth', 0.7, 0.34, seg, wx, 0.17, zz + seg / 2, shade(0x8a7c62, 1.0));
    }
    // 南北两道墙（沿 x 走向）
    const wz = z + s * hd;
    for (let xx = x - hw; xx < x + hw; xx += 8) {
      const seg = Math.min(8, x + hw - xx);
      if (s < 0 && Math.abs(xx + seg / 2 - x) < 9) continue;   // 南门洞
      if (canalClearance(xx + seg / 2, wz) < 3) continue;      // 水门洞
      b.box('wall', seg, wallH, 0.55, xx + seg / 2, wallH / 2, wz, shade(C.plaster2, 0.92 + rnd() * 0.08));
      b.box('roof', seg, 0.16, 0.85, xx + seg / 2, wallH + 0.08, wz, C.tile);
      b.box('earth', seg, 0.34, 0.7, xx + seg / 2, 0.17, wz, shade(0x8a7c62, 0.98));
    }
  }
  b.kit('park.wall', 4, 1.0);
  // 池 + 岛 + 拱桥：池心略偏园心北侧，给南面留出大片草地给游人
  const pcx = x, pcz = z - 8;
  pond(b, pcx, pcz, site.pond, siteSeed(x, z, 9));
  const islR = Math.max(7, site.pond * 0.22);
  island(b, pcx, pcz, islR, siteSeed(x, z, 11));
  // 桥从南岸接到岛上（跨度 = 池半径 − 岛半径，两端各搭 1m）
  const gap = site.pond - islR;
  archBridge(b, pcx, pcz - (islR + gap / 2), gap + 2, 3.2, Math.min(2.2, gap * 0.09), 0, shade(STONE_LT, 1.02));
  // 亭台 2–3 座：岛上主亭 + 两座岸亭
  pavilion(b, pcx, pcz, Math.min(4.6, islR * 0.55), 4, 0, siteSeed(x, z, 13));
  pavilion(b, pcx - site.pond * 0.82, pcz + site.pond * 0.62, 4.2, 6, 0.5, siteSeed(x, z, 17));
  pavilion(b, pcx + site.pond * 0.86, pcz + site.pond * 0.5, 3.6, 4, -0.6, siteSeed(x, z, 19));
  // 曲径：绕池一周（岸线外 14–22m 抖动），再各接两座岸亭与南门。`dry` 判据让路在五丈河水缘收头
  const dry = (px: number, pz: number): boolean => canalClearance(px, pz) > 3.5;
  const ring: [number, number][] = [];
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = site.pond + 13 + Math.sin(a * 2.3 + 1.1) * 5 + (rnd() - 0.5) * 3;
    ring.push([pcx + Math.cos(a) * rr * 1.12, pcz + Math.sin(a) * rr]);
  }
  gravelPath(b, ring, 2.5, dry);
  gravelPath(b, [[pcx, z + hd - 2], [pcx + 2, pcz + site.pond + 20], [pcx - 3, pcz + site.pond + 8]], 2.5, dry);
  gravelPath(b, [[x - hw + 2, z], [pcx - site.pond - 16, pcz], [pcx - site.pond - 6, pcz + 4]], 2.5, dry);
  gravelPath(b, [[pcx + site.pond + 16, pcz - 2], [x + hw - 4, z + 4]], 2.5, dry);
  // 环池路跨渠处补小拱桥：路不能在水边断头。桥心取**渠心**（不是水缘），否则桥偏到一侧、踏步落进水里
  for (let i = 0; i < ring.length - 1; i++) {
    const c0 = canalClearance(ring[i][0], ring[i][1]);
    const c1 = canalClearance(ring[i + 1][0], ring[i + 1][1]);
    if (c0 * c1 >= 0) continue;
    const t = c0 / (c0 - c1);
    const hit = canalNearest(ring[i][0] + (ring[i + 1][0] - ring[i][0]) * t, ring[i][1] + (ring[i + 1][1] - ring[i][1]) * t);
    canalBridge(b, hit.x, hit.z, hit.yaw + Math.PI / 2);
  }
  // 成片乔木：环池带 + 四周林带 + 园内散点。规格硬指标 ≥60 株，这里按"绿树成荫"做到 ≈120 株
  // （单株 ≈900 面，120 株 ≈11 万面，两园 22 万面，对全城 460 万面是零头）
  let trees = 0;
  const spot = (tx: number, tz: number): boolean => {
    if (Math.abs(tx - x) > hw - 3 || Math.abs(tz - z) > hd - 3) return false;
    if (canalClearance(tx, tz) < 7) return false;      // 不落支渠（含岸）
    const d = Math.hypot(tx - pcx, tz - pcz);
    if (d < site.pond + 4.5) return false;            // 不落水、不落岸唇
    if (d > site.pond + 8 && d < site.pond + 14) return false; // 让开环池路
    if (rnd() < 0.22) poplar(b, tx, tz, 1.0 + rnd() * 0.4, rnd);
    else broadleaf(b, tx, tz, 1.02 + rnd() * 0.44, rnd);
    trees++;
    return true;
  };
  for (let i = 0; i < 62; i++) {
    const a = (i / 62) * Math.PI * 2 + rnd() * 0.09;
    const rr = site.pond + 15 + rnd() * 17;
    spot(pcx + Math.cos(a) * rr * 1.12, pcz + Math.sin(a) * rr);
  }
  // 四周林带：贴着围墙内侧两排（俯视时"这是一座园子"的第一眼线索）。间距抖动 ±4m，
  // 否则 11m 等距会排成一圈栅栏；总数封在 180 株，别把园子做成森林。
  for (const s of [-1, 1]) {
    for (let t = -hd + 9; t < hd - 6; t += 11) {
      if (trees >= 180) break;
      spot(x + s * (hw - 6 - rnd() * 8), z + t + rnd() * 8 - 4);
      if (trees < 180) spot(x + s * (hw - 19 - rnd() * 7), z + t + rnd() * 8 - 4);
    }
    for (let t = -hw + 9; t < hw - 6; t += 11) {
      if (trees >= 180) break;
      spot(x + t + rnd() * 8 - 4, z + s * (hd - 6 - rnd() * 8));
      if (trees < 180) spot(x + t + rnd() * 8 - 4, z + s * (hd - 19 - rnd() * 7));
    }
  }
  for (let i = 0; trees < 150 && i < 400; i++) {
    spot(x + (rnd() - 0.5) * (site.w - 26), z + (rnd() - 0.5) * (site.d - 26));
  }
  // 灌木丛：贴在岸边（每丛 3 团小球），把大草坪的"空"补上
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = site.pond + 3 + rnd() * 2.5;
    const sx2 = pcx + Math.cos(a) * rr, sz2 = pcz + Math.sin(a) * rr;
    if (canalClearance(sx2, sz2) < 7) continue;
    for (let k = 0; k < 3; k++) {
      b.sphere('leaf', 0.6 + rnd() * 0.5, 6, sx2 + (rnd() - 0.5) * 2.2, 0.42 + rnd() * 0.3, sz2 + (rnd() - 0.5) * 2.2,
        shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.86 + rnd() * 0.22), rnd() * 3.14, 0, 0, 1.2, 0.8, 1.2);
    }
    b.kit('park.shrub', 1, 0.4);
  }
  // 置石 + 花圃：沿池岸散点（不落路上、不落渠里）
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = site.pond + 2.5 + rnd() * 3;
    const rx2 = pcx + Math.cos(a) * rr, rz2 = pcz + Math.sin(a) * rr;
    if (canalClearance(rx2, rz2) < 8) continue;
    rockery(b, rx2, rz2, 0.9 + rnd() * 0.5, rnd);
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = site.pond + 20 + rnd() * 8;
    const fx2 = pcx + Math.cos(a) * rr, fz2 = pcz + Math.sin(a) * rr;
    if (canalClearance(fx2, fz2) < 10) continue;
    flowerBed(b, fx2, fz2, 7 + rnd() * 4, 3.2 + rnd() * 1.6, rnd);
  }
  // 园门：西门牌坊 + 匾额（用得上 sg/atlas：让苑囿在街上有名字）
  const gx = x - hw + 0.4, gz = z;
  for (const s of [-1, 1]) {
    b.box('wood', 0.42, 5.2, 0.42, gx - 0.6, 2.6, gz + s * 4.4, shade(C.woodRed, 0.94));
    b.box('ash', 0.7, 0.4, 0.7, gx - 0.6, 0.2, gz + s * 4.4, STONE_DK);
  }
  b.box('wood', 0.34, 0.5, 9.6, gx - 0.6, 5.0, gz, shade(C.woodRed, 1.04));
  b.box('roof', 1.9, 0.3, 10.4, gx - 0.6, 5.42, gz, C.tile);
  const uv = atlas.text(`park_${Math.round(x)}_${Math.round(z)}`, site.name, 260, 84,
    { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(14,12,20,0.92)', border: 'rgba(255,179,0,.8)', fontPx: 48 });
  sg.quad(uv, 3.6, 1.2, gx - 1.9, 4.3, gz, -Math.PI / 2);
  b.kit('park.gate', 1, 5.2);
  b.kit('park.garden', 1, 2);
}

// ============ 中小园林 ============

function buildGarden(b: Baker, site: GardenSite): void {
  const rnd = mkRand(siteSeed(site.x, site.z, 23));
  const x = site.x, z = site.z, h = site.size / 2;
  // 园地 + 竹篱（矮，不遮视线，但把"园"从"空地"里读出来）
  meadow(b, x, z, site.size - 4, site.size - 4, rnd, GRASS);
  for (const s of [-1, 1]) {
    for (let t = -h + 2; t < h - 2; t += 3.2) {
      b.box('wood', 0.12, 1.0, 0.12, x + s * (h - 2), 0.5, z + t, shade(C.woodDark, 0.98 + rnd() * 0.1));
      b.box('wood', 0.12, 1.0, 0.12, x + t, 0.5, z + s * (h - 2), shade(C.woodDark, 0.98 + rnd() * 0.1));
    }
    b.box('wood', 0.1, 0.1, site.size - 4, x + s * (h - 2), 0.95, z, shade(C.wood, 1.06));
    b.box('wood', site.size - 4, 0.1, 0.1, x, 0.95, z + s * (h - 2), shade(C.wood, 1.06));
    b.box('wood', 0.1, 0.08, site.size - 4, x + s * (h - 2), 0.5, z, shade(C.wood, 0.96));
    b.box('wood', site.size - 4, 0.08, 0.1, x, 0.5, z + s * (h - 2), shade(C.wood, 0.96));
  }
  b.kit('park.hedge', 4, 0.6);
  // 一池
  const pcx = x - h * 0.18, pcz = z + h * 0.1;
  pond(b, pcx, pcz, site.pond, siteSeed(x, z, 29));
  // 一亭（贴池西岸，踏步朝东看水）
  pavilion(b, x + h * 0.42, z - h * 0.22, Math.min(3.6, site.size * 0.055 + 1.6), 4, -Math.PI / 2, siteSeed(x, z, 31));
  // 曲径：园门（南）→ 池南 → 亭前
  gravelPath(b, [[x + 3, z + h - 3], [x + 4, z + h * 0.35], [pcx + site.pond + 3, pcz + 2], [x + h * 0.42 - 3.4, z - h * 0.22]], 2.2);
  gravelPath(b, [[pcx - site.pond - 3, pcz - 2], [x - h + 4, z + 2]], 2.2);
  // 乔木 6 株（园角与池对岸，避开亭与径）——表内一律是相对园心的偏移，
  // 池对岸两处用 pcx/pcz 反推：pcx = x − h·0.18，pcz = z + h·0.1
  const offPool = -h * 0.18;
  const spots: [number, number][] = [
    [-h + 6, -h + 7], [-h + 8, h - 8], [h - 7, h - 9],
    [offPool - site.pond - 5, h * 0.1 + 5], [offPool + 3, h * 0.1 + site.pond + 6], [h - 9, -h + 9],
  ];
  let n = 0;
  for (const [ox, oz] of spots) {
    const tx = x + ox + (rnd() - 0.5) * 3, tz = z + oz + (rnd() - 0.5) * 3;
    if (Math.hypot(tx - pcx, tz - pcz) < site.pond + 2.2) continue;
    if (Math.abs(tx - x - h * 0.42) < 5 && Math.abs(tz - z + h * 0.22) < 5) continue;
    broadleaf(b, tx, tz, 0.9 + rnd() * 0.35, rnd);
    n++;
  }
  // 兜底：至少 6 株（院角补位，仍避池避亭）
  for (let i = 0; n < 6 && i < 24; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = h * (0.62 + rnd() * 0.28);
    const tx = x + Math.cos(a) * rr, tz = z + Math.sin(a) * rr;
    if (Math.hypot(tx - pcx, tz - pcz) < site.pond + 2.2) continue;
    if (Math.abs(tx - x - h * 0.42) < 5 && Math.abs(tz - z + h * 0.22) < 5) continue;
    broadleaf(b, tx, tz, 0.88 + rnd() * 0.3, rnd);
    n++;
  }
  // 置石 2–3 块 + 一处花圃
  rockery(b, pcx + site.pond + 2.4, pcz - site.pond * 0.45, 0.85 + rnd() * 0.3, rnd);
  rockery(b, x - h * 0.55, z - h * 0.6, 0.7 + rnd() * 0.3, rnd);
  if (rnd() < 0.7) rockery(b, x + h * 0.55, z + h * 0.52, 0.6 + rnd() * 0.3, rnd);
  flowerBed(b, x - h * 0.55, z + h * 0.58, 5.5, 2.6, rnd);
  b.kit('park.garden', 1, 1.2);
}

// ============ R21：空地填充站点 · 4 套确定性游憩组合 ============
// 每处站点都是一组肉眼可辨的公园场景：攒尖亭（亭） + [台榭 | 楼阁 | 水榭曲桥 | 假山瀑布]（台/楼/阁/榭）
// + 廊架 + 湖石/假山 + 花圃/花木 + 小水面/流水 + 石凳，按 variant % 4 做 4 套组合，别所有站点一个样。
// 构件全部复用本文件已验证的 helper + 下列 3 个低面数构件，逐件过 canalClearance 让开支渠；
// 随机只走 mkRand(siteSeed(...))，与共享 rng 无关，全部 Baker 合批（无新材质组 / 无新 Mesh）。

/** 细流水：贴地水带 + 两岸条石 + 三块汀步（低面数，给非水榭站点也补「小水面 / 流水」） */
function infillRill(b: Baker, x: number, z: number, len: number, rnd: Rand): void {
  b.box('water', len, 0.08, 1.5, x, 0.10, z, 0x1d4d53);
  for (const s of [-1, 1]) b.box('ash', len + 0.6, 0.16, 0.35, x, 0.14, z + s * 0.95, shade(STONE_DK, 1.02));
  for (let i = 0; i < 3; i++) {
    b.box('ash', 0.9, 0.12, 1.9, x - len * 0.3 + i * len * 0.3, 0.19, z,
      shade(STONE_LT, 0.98 + rnd() * 0.1), (rnd() - 0.5) * 0.3);
  }
  b.kit('park.infill.rill', 1, 0.15);
}

/** 二层小楼阁：台基 + 一层柱墙 + 平座腰檐 + 二层柱墙 + 攒尖顶 + 宝顶（比台榭高一档的剪影） */
function infillTower(b: Baker, x: number, z: number, ry: number): void {
  b.box('ash', 10.2, 0.5, 8.4, x, 0.25, z, shade(STONE_LT, 0.98), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    b.cyl('wood', 0.17, 0.2, 3.1, 6, x + sx * 4.3, 2.05, z + sz * 3.5, shade(C.woodRed, 0.94));
  b.box('wall', 8.2, 2.6, 6.6, x, 1.8, z, shade(C.plaster2, 1.02), ry);
  for (const sx of [-1, 1]) b.box('glow', 1.0, 1.2, 0.1, x + sx * 2.6, 2.2, z + 3.55, C.lantern);
  b.box('ash', 10.6, 0.24, 8.8, x, 3.62, z, shade(STONE_LT, 1.06), ry);
  b.roofC('roof', x, 3.9, z, shade(C.tile2, 1.12), ry, 11.6, 1.5, 9.6, 0, 0, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    b.cyl('wood', 0.14, 0.17, 2.5, 6, x + sx * 3.2, 5.35, z + sz * 2.6, shade(C.woodRed, 0.96));
  b.box('wall', 6.2, 2.2, 5.0, x, 5.3, z, shade(C.plaster2, 1.0), ry);
  b.box('roof', 9.4, 0.24, 8.2, x, 6.7, z, shade(C.tile2, 1.16), ry);
  b.pyramid('roof', 0.32, 6.2 * Math.SQRT2, x, 7.7, z, shade(C.tile2, 1.22), ry, 1, 1.9, 1);
  b.sphere('ceramic', 0.3, 8, x, 9.1, z, 0xd8c48a);
  b.kit('park.infill.tower', 1, 7.0);
}

/** 假山瀑布：三簇叠石 + 一挂白水帘 + 落水小潭 + 涧石（山水景观造型） */
function infillCascade(b: Baker, x: number, z: number, s: number, rnd: Rand): void {
  rockery(b, x, z, 1.5 * s, rnd);
  rockery(b, x - 2.2 * s, z + 1.4 * s, 1.0 * s, rnd);
  rockery(b, x + 2.0 * s, z + 1.2 * s, 0.9 * s, rnd);
  for (let i = 0; i < 3; i++) {
    b.box('water', 1.5 * s, (2.4 - i * 0.4) * s, 0.12, x - 0.6 * s + i * 0.7 * s,
      (1.4 - i * 0.25) * s, z - 0.7 * s, shade(0x3f7f86, 1.0 - i * 0.06));
  }
  b.box('water', 6.0 * s, 0.1, 3.4 * s, x, 0.16, z - 2.4 * s, 0x1d4d53);
  b.box('ash', 6.6 * s, 0.22, 0.4, x, 0.2, z - 0.7 * s, shade(STONE_DK, 1.02));
  for (let i = 0; i < 4; i++) {
    b.sphere('ash', (0.25 + rnd() * 0.25) * s, 5,
      x + (rnd() - 0.5) * 5 * s, 0.24, z - 2.4 * s + (rnd() - 0.5) * 2.4 * s,
      shade(STONE_LT, 0.9 + rnd() * 0.2));
  }
  b.kit('park.infill.cascade', 1, 2.0);
}

/**
 * 一处站点：草地 + 矮院墙 + 攒尖亭 + 4 套主体之一 + 廊架/曲桥 + 湖石/假山 + 花圃/花木
 * + 小水面/流水 + 石桌凳 + 曲径。逐件过 canalClearance 让开支渠，全部 Baker 合批、零共享 RNG。
 */
function buildInfillSite(b: Baker, site: InfillSite): void {
  const { x, z, size, variant } = site;
  const h = size / 2;
  const theme = variant % 4;                       // 4 套确定性组合：台榭 / 楼阁 / 水榭曲桥 / 假山瀑布
  const rnd = mkRand(siteSeed(x, z, 101 + variant));
  const dry = (px: number, pz: number): boolean => canalClearance(px, pz) > 3;
  // 园地：草坪覆盖半径 = size × INFILL_LAWN_RADIUS（≥ size*1.4），且边长不小于网格步长的
  // INFILL_LAWN_TILE 倍，令相邻站点绿地连成片、俯瞰不再露出黄土。薄层 y=0.035 仍在街面
  // 铺装（0.12）之下；走既有 leaf 材质组、Baker 合批，box 尺寸放大不改变三角面数。
  const lawnR = size * INFILL_LAWN_RADIUS;                          // 覆盖半径 ≥ size*1.4
  const lawnSpan = Math.max(lawnR * 2,
    INFILL_GRID_STEP_X * INFILL_LAWN_TILE,
    INFILL_GRID_STEP_Z * INFILL_LAWN_TILE);
  // R23：改走 r23Ground —— 街道走廊裁剪 + 真草叶/花/枝叶，不再是一层纯色绿膜
  r23Ground(b, x, z, lawnSpan, lawnSpan, RAISED_LAWN_Y_INFILL, siteSeed(x, z, 2601 + variant));
  b.kit('park.infill.lawn', 1, 0.07);
  // 矮院墙（粉墙 + 瓦压顶），朝 +z 的南面正中留门洞
  const wallH = 1.65;
  for (const s of [-1, 1]) {
    // 东西两道墙（沿 z）
    for (let t = -h + 1; t < h - 1; t += 5) {
      const seg = Math.min(5, h - 1 - t);
      b.box('wall', 0.42, wallH, seg, x + s * (h - 1), wallH / 2, z + t + seg / 2, shade(C.plaster2, 0.94 + rnd() * 0.08));
      b.box('roof', 0.7, 0.14, seg, x + s * (h - 1), wallH + 0.07, z + t + seg / 2, C.tile);
    }
    // 南北两道墙（沿 x），+z 面留 3.2m 门洞
    for (let t = -h + 1; t < h - 1; t += 5) {
      const seg = Math.min(5, h - 1 - t);
      if (s > 0 && Math.abs(t + seg / 2) < 3.2) continue;
      b.box('wall', seg, wallH, 0.42, x + t + seg / 2, wallH / 2, z + s * (h - 1), shade(C.plaster2, 0.92 + rnd() * 0.08));
      b.box('roof', seg, 0.14, 0.7, x + t + seg / 2, wallH + 0.07, z + s * (h - 1), C.tile);
    }
  }
  b.kit('park.infill.wall', 4, wallH);

  // 主体一：攒尖亭（方 / 六角按 variant），园心偏北，踏步朝南门
  const px = x - h * 0.22, pz = z - h * 0.18;
  const sides = (variant % 2 === 0 ? 4 : 6) as 4 | 6;
  const pavR = Math.min(4.2, 2.3 + size * 0.045);
  if (dry(px, pz)) pavilion(b, px, pz, pavR, sides, 0, siteSeed(x, z, 103 + variant));

  // 主体二：4 套主题（台榭 / 楼阁 / 水榭曲桥 / 假山瀑布），让相邻站点的剪影不重样
  const ex = x + h * 0.34, ez = z + h * 0.22;
  if (theme === 0) {
    // 台榭：方台 + 四柱 + 平座 + 攒尖顶 + 宝顶
    b.box('ash', 9.2, 0.44, 9.2, ex, 0.22, ez, shade(STONE_LT, 1.0));
    b.box('ash', 8.6, 0.14, 8.6, ex, 0.5, ez, shade(STONE_LT, 1.08));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.cyl('wood', 0.16, 0.19, 3.0, 6, ex + sx * 3.7, 2.0, ez + sz * 3.7, shade(C.woodRed, 0.94));
    }
    b.box('roof', 10.6, 0.3, 10.6, ex, 4.12, ez, shade(C.tile2, 1.1));
    b.cyl('roof', 0.3, 5.6, 1.7, 4, ex, 5.0, ez, shade(C.tile2, 1.18), Math.PI / 4);
    b.sphere('ceramic', 0.28, 8, ex, 6.0, ez, 0xd8c48a);
    b.kit('park.infill.terrace', 1, 4.0);
  } else if (theme === 1) {
    // 二层楼阁：比台榭高一档，给坊间空地立一处竖向剪影
    infillTower(b, ex, ez, variant % 2 ? 0.3 : -0.3);
  } else if (theme === 2) {
    // 水榭：小池（复用 pond 的石岸 / 荷叶 / 岸苇）+ 跨池曲桥
    const wr = Math.min(6.0, size * 0.16);
    if (canalClearance(ex, ez) > wr + 2) {
      pond(b, ex, ez, wr, siteSeed(x, z, 107));
      archBridge(b, ex + wr * 0.5, ez, wr * 1.4, 1.9, 0.55, Math.PI / 2, shade(STONE_LT, 1.04), 0.4);
      // 曲桥两侧的石凳（游憩停留点）
      for (const s of [-1, 1]) b.box('ash', 1.6, 0.16, 0.5, ex + s * (wr + 1.6), 0.42, ez + wr * 0.5, shade(STONE_LT, 1.02));
      b.kit('park.infill.water', 1, 0.4);
    }
  } else {
    // 假山瀑布：叠石 + 水帘 + 落水潭（山水景观造型）
    if (dry(ex, ez)) infillCascade(b, ex, ez, 0.85 + rnd() * 0.25, rnd);
  }

  // 小水面 / 流水：非水榭套补一条细 rill（水榭套已有方池），曲径旁再落两处石凳
  if (theme !== 2) {
    const rx = x - h * 0.05, rz = z + h * 0.60;
    if (dry(rx, rz)) infillRill(b, rx, rz, size * 0.5, rnd);
  }
  for (const s of [-1, 1]) {
    const bx = x + s * (h * 0.5 + 1.2), bz = z + h * 0.12;
    if (dry(bx, bz)) {
      b.box('ash', 1.8, 0.16, 0.5, bx, 0.42, bz, shade(STONE_LT, 1.02));
      for (const t of [-1, 1]) b.box('ash', 0.24, 0.42, 0.4, bx + t * 0.7, 0.21, bz, shade(STONE_DK, 1.0));
    }
  }
  b.kit('park.infill.bench', 2, 0.42);

  // 石桌凳（亭外一小组）
  const tx = x - h * 0.5 + 3, tz = z + h * 0.4;
  if (dry(tx, tz)) {
    b.cyl('ash', 0.62, 0.7, 0.14, 10, tx, 0.72, tz, shade(STONE_LT, 1.04));
    b.cyl('ash', 0.22, 0.28, 0.62, 8, tx, 0.36, tz, STONE_DK);
    for (const s of [-1, 1]) b.cyl('ash', 0.26, 0.28, 0.4, 8, tx + s * 1.05, 0.24, tz, shade(STONE_LT, 0.96));
    b.kit('park.infill.table', 1, 0.7);
  }

  // 廊架：一列柱 + 双横梁 + 攀藤小球（贴园墙内侧，读作一条绿廊）
  const lx = x + h * 0.05, lz = z - h * 0.52;
  for (let i = 0; i < 4; i++) {
    const cx = lx - 4.5 + i * 3.0;
    b.cyl('wood', 0.12, 0.15, 2.4, 5, cx, 1.2, lz, shade(C.woodDark, 1.0));
    b.cyl('wood', 0.12, 0.15, 2.4, 5, cx, 1.2, lz + 2.2, shade(C.woodDark, 1.0));
    b.box('wood', 3.2, 0.12, 0.14, cx + 1.5, 2.5, lz + 1.1, shade(C.wood, 1.06));
    for (let k = 0; k < 3; k++) {
      b.sphere('leaf', 0.42 + rnd() * 0.22, 5, cx + (k - 1) * 0.9, 2.6 + rnd() * 0.3, lz + 1.1 + (rnd() - 0.5) * 1.2,
        shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.9 + rnd() * 0.18), 0, 0, 0, 1.1, 0.7, 1.1);
    }
  }
  b.box('wood', 13.0, 0.14, 0.18, lx + 1.5, 2.48, lz + 1.1, shade(C.wood, 1.02));
  b.kit('park.infill.pergola', 1, 2.5);

  // 湖石 1–2 处 + 花圃 2–3 处 + 树丛 5–8 株：逐件过支渠净距
  const scatter = (n: number, fn: (ax: number, az: number) => void): void => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, rr = h * (0.5 + rnd() * 0.42);
      const ax = x + Math.cos(a) * rr, az = z + Math.sin(a) * rr;
      if (!dry(ax, az)) continue;
      fn(ax, az);
    }
  };
  scatter(2, (ax, az) => rockery(b, ax, az, 0.7 + rnd() * 0.5, rnd));
  scatter(3, (ax, az) => flowerBed(b, ax, az, 4 + rnd() * 2.5, 2.2 + rnd() * 1.2, rnd));
  scatter(7, (ax, az) => {
    if (rnd() < 0.25) poplar(b, ax, az, 0.85 + rnd() * 0.3, rnd);
    else broadleaf(b, ax, az, 0.88 + rnd() * 0.32, rnd);
  });

  // 乔木 / 花丛带：在放大的草坪上按整数坐标 hash 补一行绿带，让站点之间不再是纯色黄土。
  // 位置 / 树种全部由 siteSeed(x,z,salt) 派生（纯整数 hash，零共享 RNG），逐处过 canalClearance
  // 继续避开支渠水面；复用 broadleaf / poplar / flowerBed，全部走既有 leaf/trunk/earth 材质组、
  // 由 Baker 合批（0 新增材质组 / 0 独立 Mesh / 0 draw call）。
  const groveRnd = mkRand(siteSeed(x, z, 211 + variant));
  let grove = 0;
  for (let i = 0; i < INFILL_GROVE_COUNT; i++) {
    const hs = siteSeed(x, z, 223 + i * 13 + variant);
    const ang = ((hs % 360) / 360) * Math.PI * 2;
    const rr = lawnR * (0.7 + ((hs >>> 9) % 25) / 100);
    const gx = x + Math.cos(ang) * rr, gz = z + Math.sin(ang) * rr;
    if (canalClearance(gx, gz) < 5) continue;      // 继续让开支渠水面
    if (i === 0) {
      if (hs & 1) poplar(b, gx, gz, 0.8 + groveRnd() * 0.25, groveRnd);
      else broadleaf(b, gx, gz, 0.82 + groveRnd() * 0.28, groveRnd);
    } else {
      flowerBed(b, gx, gz, 4 + groveRnd() * 2, 2.2 + groveRnd(), groveRnd);
    }
    grove++;
  }
  b.kit('park.infill.grove', grove, 0.6);

  // R28 加密：花丛带 + variant 分档景观小品（独立 siteSeed 派生，不扰动既有 rnd/groveRnd 序列；
  // 全部走既有 leaf/trunk/earth/ash/water/wood/roof/ceramic 材质组，Baker 合批、零共享 RNG）
  const r28 = mkRand(siteSeed(x, z, 701 + variant));
  // 花丛带：沿放大的草坪外缘散列 6 块花圃，把站点之间补成连续花带
  for (let i = 0; i < 6; i++) {
    const hs = siteSeed(x, z, 711 + i * 9 + variant);
    const ang = ((hs % 360) / 360) * Math.PI * 2;
    const rr = lawnR * (0.5 + ((hs >>> 9) % 35) / 100);
    const fx = x + Math.cos(ang) * rr, fz = z + Math.sin(ang) * rr;
    if (canalClearance(fx, fz) < 4) continue;
    flowerBed(b, fx, fz, 4 + r28() * 2, 2 + r28(), r28);
  }
  // 分档小品：亭 / 水景 / 石景 三选一（低矮，不建大体量房屋、不挡街）
  const ax = x + h * 0.42, az = z - h * 0.42;
  if (canalClearance(ax, az) > 4) {
    if (variant % 3 === 0) {
      // 矮方亭：台明 + 4 柱 + 矮瓦顶 + 石桌
      const r = 2.0;
      b.box('ash', r * 2 + 0.7, 0.22, r * 2 + 0.7, ax, 0.11, az, shade(STONE_LT, 1.02));
      for (const s of [-1, 1]) for (const u of [-1, 1])
        b.cyl('wood', 0.1, 0.13, 1.8, 6, ax + s * r, 1.02, az + u * r, shade(C.woodRed, 0.96));
      b.box('roof', r * 2 + 1.2, 0.18, r * 2 + 1.2, ax, 2.0, az, shade(C.tile2, 1.12));
      b.sphere('ceramic', 0.2, 8, ax, 2.2, az, 0xd8c48a);
      b.cyl('ash', 0.4, 0.46, 0.12, 8, ax, 0.58, az, shade(STONE_LT, 1.04));
      b.kit('park.infill.r28.pavilion', 1, 2.0);
    } else if (variant % 3 === 1) {
      // 曲水小景：水带 + 条石岸 + 汀步
      const len = size * 0.4;
      b.box('water', len, 0.08, 1.6, ax, 0.10, az, 0x1d4d53);
      for (const s of [-1, 1]) b.box('ash', len + 0.4, 0.16, 0.3, ax, 0.14, az + s * 0.9, shade(STONE_DK, 1.02));
      for (let i = 0; i < 3; i++)
        b.box('ash', 0.7, 0.12, 1.8, ax - len * 0.3 + i * len * 0.3, 0.19, az, shade(STONE_LT, 0.98 + r28() * 0.1));
      b.kit('park.infill.r28.water', 1, 0.4);
    } else {
      // 石景 + 两只石凳
      rockery(b, ax, az, 0.8 + r28() * 0.3, r28);
      for (const s of [-1, 1])
        b.box('ash', 1.4, 0.16, 0.45, ax + s * 2.6, 0.38, az + 1.4, shade(STONE_LT, 1.02));
      b.kit('park.infill.r28.rock', 1, 0.6);
    }
  }
  b.kit('park.infill.r28', 1, 1.0);

  // 曲径：南门 → 亭前 → 台榭/水榭
  gravelPath(b, [[x, z + h - 1.4], [x + 1, z + h * 0.3], [px + pavR + 1.6, pz + 1.2], [ex - 4.5, ez]], 2.0, dry);
  b.kit('park.infill.site', 1, 2.0);
  b.kit('park.infill.siteV2', 1, 2.0);   // R21 新增统计键：每处扩容站点一个，供 world.assetAudit.detail 核对
}

// ============ 瓦舍勾栏 ============

function buildWashe(b: Baker, sg: SignMesher, atlas: SignAtlas, site: WasheSite): void {
  const rnd = mkRand(siteSeed(site.x, site.z, 41));
  const x = site.x, z = site.z, h = site.size / 2;
  // 场子地面：夯土压实（比街面低 5cm，读作"场内"）
  b.box('ground', site.size - 1.4, 0.09, site.size - 1.4, x, 0.045, z, shade(0x7a7263, 1.0));
  // 台前踩踏区：深一档，把"观众站的那片"从场地上分出来
  b.box('ground', site.size - 6.5, 0.02, 9.5, x, 0.095, z + 1.2, shade(0x6f6657, 1.04));
  // 围栏：立柱 + 双横杆，南面留 4.4m 门洞
  const fenceH = 1.15;
  const step = 2.4;
  for (let t = -h + 1.2; t <= h - 1.2 + 0.01; t += step) {
    for (const s of [-1, 1]) {
      b.box('wood', 0.14, fenceH, 0.14, x + s * h, fenceH / 2, z + t, shade(C.woodDark, 0.96 + rnd() * 0.1));
      if (Math.abs(t) > 2.4) b.box('wood', 0.14, fenceH, 0.14, x + t, fenceH / 2, z + s * h, shade(C.woodDark, 0.96 + rnd() * 0.1));
    }
  }
  for (const s of [-1, 1]) {
    b.box('wood', 0.12, 0.1, site.size - 2, x + s * h, 1.0, z, shade(C.wood, 1.04));
    b.box('wood', 0.12, 0.1, site.size - 2, x + s * h, 0.55, z, shade(C.wood, 0.94));
    b.box('wood', site.size - 2, 0.1, 0.12, x, 1.0, z + s * h, shade(C.wood, 1.04));
    if (s > 0) {
      // 南面横杆断开成门洞（左右两段）
      b.box('wood', h - 2.4, 0.1, 0.12, x - (h + 2.4) / 2, 1.0, z + h, shade(C.wood, 1.04));
      b.box('wood', h - 2.4, 0.1, 0.12, x + (h + 2.4) / 2, 1.0, z + h, shade(C.wood, 1.04));
      b.box('wood', h - 2.4, 0.1, 0.12, x - (h + 2.4) / 2, 0.55, z + h, shade(C.wood, 0.94));
      b.box('wood', h - 2.4, 0.1, 0.12, x + (h + 2.4) / 2, 0.55, z + h, shade(C.wood, 0.94));
    } else {
      b.box('wood', site.size - 2, 0.1, 0.12, x, 0.55, z + s * h, shade(C.wood, 0.94));
    }
  }
  b.kit('washe.fence', 4, 0.8);
  // 戏台（北侧，台高 1.2m）：砖台身 + 木台面 + 四柱 + 歇山棚顶 + 后屏
  const stageH = 1.2;
  const sw = 7.2, sd = 5.0;
  const sz = z - h + 2.9;
  b.box('earth', sw + 0.5, stageH - 0.16, sd + 0.5, x, (stageH - 0.16) / 2, sz, shade(0x8a7a5f, 1.0));
  b.box('wood', sw, 0.18, sd, x, stageH - 0.07, sz, shade(C.wood, 1.06));
  // 台口踏步（观众上台口两侧各一）
  for (const s of [-1, 1]) {
    b.box('ash', 1.1, 0.2, 0.7, x + s * (sw / 2 - 1.4), 0.1, sz + sd / 2 + 0.35, shade(STONE_DK, 1.0));
    b.box('ash', 1.1, 0.2, 0.7, x + s * (sw / 2 - 1.4), 0.3, sz + sd / 2 + 0.15, shade(STONE_DK, 1.06));
  }
  // 四柱 + 额枋
  const postH = 3.1;
  const px = sw / 2 - 0.35, pz = sd / 2 - 0.35;
  const corners: [number, number][] = [[px, pz], [px, -pz], [-px, -pz], [-px, pz]];
  for (const [ox, oz] of corners) {
    b.box('wood', 0.26, postH, 0.26, x + ox, stageH + postH / 2, sz + oz, shade(C.woodRed, 0.94 + rnd() * 0.08));
  }
  for (const [ox, oz] of corners) {
    const nx = ox, nz = -oz;
    b.box('wood', sw - 0.4, 0.26, 0.2, x, stageH + postH - 0.15, sz + oz, shade(C.woodDark, 1.08));
    void nx; void nz;
  }
  b.box('wood', 0.2, 0.26, sd - 0.4, x + px, stageH + postH - 0.15, sz, shade(C.woodDark, 1.08));
  b.box('wood', 0.2, 0.26, sd - 0.4, x - px, stageH + postH - 0.15, sz, shade(C.woodDark, 1.08));
  // 棚顶（曲面反宇，出檐 1.4m）
  b.roofC('roof', x, stageH + postH, sz, shade(C.tile, 1.28), 0, sw + 2.6, 2.0, sd + 2.4, 0, 0, true);
  b.kit('washe.stage', 1, stageH);
  // 后屏（舞台背板）：三片朱红板 + 两道金线
  for (let i = -1; i <= 1; i++) {
    b.box('lacquer', 2.0, 2.6, 0.12, x + i * 2.1, stageH + 1.4, sz - sd / 2 + 0.3, shade(C.woodRed, 0.86 + (i + 1) * 0.04));
  }
  b.box('glow', sw - 1.6, 0.06, 0.06, x, stageH + 2.5, sz - sd / 2 + 0.22, C.neonGold);
  b.box('glow', sw - 1.6, 0.06, 0.06, x, stageH + 0.7, sz - sd / 2 + 0.22, C.neonGold);
  // 台前两盏宫灯（挂檐下）
  for (const s of [-1, 1]) {
    b.cyl('wood', 0.05, 0.05, 0.7, 5, x + s * (sw / 2 - 0.6), stageH + postH - 0.4, sz + sd / 2 - 0.2, shade(C.woodDark, 1.0));
    b.sphere('glow', 0.3, 8, x + s * (sw / 2 - 0.6), stageH + postH - 1.0, sz + sd / 2 - 0.2, C.lantern, 0, 0, 0, 1, 1.3, 1);
  }
  // 看棚三面（东 / 西 / 南）：前檐柱 + 斜棚顶 + 两排长凳。南面拆成两段，中间留出 4.4m 门洞
  const shedDepth = 2.8;
  const shedH = 2.5;
  const shedRoofY = 3.3;
  const runShed = (ax: 'x' | 'z', sgn: 1 | -1, t0: number, t1: number): void => {
    const runLen = t1 - t0;
    const runMid = (t0 + t1) / 2;
    // 棚身中心：外缘与围栏齐平（不越界），内侧留 2.8m 进深
    const outer = h - (shedDepth + 0.9) / 2 + 0.15;
    const cxp = ax === 'x' ? x + sgn * outer : runMid;
    const czp = ax === 'x' ? runMid : z + sgn * outer;
    const tilt = -sgn * 0.13;   // 向外侧压低（雨水外排），sgn 方向由轴决定
    if (ax === 'x') {
      b.box('roof', shedDepth + 0.9, 0.16, runLen + 1.1, cxp, shedRoofY, czp, shade(C.tile, 1.32), 0, 0, tilt);
      b.box('roof', shedDepth + 1.1, 0.14, runLen + 1.2, cxp + sgn * 0.05, shedRoofY - 0.22, czp, shade(C.tile, 1.1), 0, 0, tilt);
    } else {
      b.box('roof', runLen + 1.1, 0.16, shedDepth + 0.9, cxp, shedRoofY, czp, shade(C.tile, 1.32), 0, tilt, 0);
      b.box('roof', runLen + 1.2, 0.14, shedDepth + 1.1, cxp, shedRoofY - 0.22, czp + sgn * 0.05, shade(C.tile, 1.1), 0, tilt, 0);
    }
    // 前后两排柱：内侧一排在 2.45m 高撑住棚沿
    const nPost = Math.max(2, Math.round(runLen / 3.4));
    for (let i = 0; i <= nPost; i++) {
      const t = t0 + (runLen * i) / nPost;
      for (const inner of [true, false]) {
        const off = sgn * (inner ? -(shedDepth - 0.25) : -(shedDepth - 0.85));
        const px2 = ax === 'x' ? x + off : t;
        const pz2 = ax === 'x' ? t : z + off;
        b.box('wood', 0.16, inner ? shedH : 2.2, 0.16, px2, (inner ? shedH : 2.2) / 2, pz2, shade(C.woodDark, 0.96 + rnd() * 0.1));
      }
    }
    // 长凳：两排（檐下 + 靠后）
    for (let row = 0; row < 2; row++) {
      const off = sgn * -(shedDepth * (row === 0 ? 0.3 : 0.72));
      if (ax === 'x') b.box('wood', 0.85, 0.14, runLen - 0.8, x + off, 0.46, runMid, shade(C.wood, 0.96 + row * 0.06));
      else b.box('wood', runLen - 0.8, 0.14, 0.85, runMid, 0.46, z + off, shade(C.wood, 0.96 + row * 0.06));
    }
    // 棚下挂小灯两盏（读作"棚"而不是"屋顶"）
    for (const q of [0.3, 0.7]) {
      const t = t0 + runLen * q;
      const lx = ax === 'x' ? x + sgn * -(shedDepth - 0.4) : t;
      const lz = ax === 'x' ? t : z + sgn * -(shedDepth - 0.4);
      b.sphere('glow', 0.16, 6, lx, 2.15, lz, C.lantern, 0, 0, 0, 1, 1.2, 1);
    }
    b.kit('washe.shed', 1, 1.6);
  };
  runShed('x', 1, z - h + 1, z + h - 1);
  runShed('x', -1, z - h + 1, z + h - 1);
  // 南面：门洞两侧各一段（门洞 4.4m，正对匾额）
  runShed('z', 1, x - h + 1, x - 4.2);
  runShed('z', 1, x + 4.2, x + h - 1);
  // 灯笼 8 盏：四角 + 四边中点，全部退到看棚线内侧（不然挂进棚顶里）
  const lampLine = h - shedDepth - 0.8;
  const lampSpots: [number, number][] = [
    [x - lampLine, z - lampLine], [x + lampLine, z - lampLine],
    [x - lampLine, z + lampLine], [x + lampLine, z + lampLine],
    [x - lampLine, z], [x + lampLine, z],
    [x - 4.9, z + lampLine], [x + 4.9, z + lampLine],
  ];
  for (const [lx, lz] of lampSpots) {
    b.cyl('wood', 0.07, 0.09, 3.0, 5, lx, 1.5, lz, shade(C.woodDark, 1.02));
    b.cyl('wood', 0.2, 0.14, 0.06, 6, lx, 3.02, lz, shade(C.woodDark, 1.08));
    b.sphere('glow', 0.26, 8, lx, 2.8, lz, rnd() < 0.5 ? C.lantern : C.neonGold, 0, 0, 0, 1, 1.25, 1);
    b.kit('washe.lantern', 1, 2.8);
  }
  // 幡旗 2 面：门口一对，旗面竖挂（6.8m 杆 + 横挑 + 1.1×3.6 布幡）
  for (const s of [-1, 1]) {
    const fx2 = x + s * 3.4, fz2 = z + h + 1.6;
    b.box('wood', 0.16, 7.0, 0.16, fx2, 3.5, fz2, shade(C.woodDark, 1.04));
    b.box('wood', 0.1, 0.1, 1.5, fx2, 6.6, fz2 - 0.75, shade(C.woodDark, 0.98));
    b.box('fabric', 0.06, 3.6, 1.1, fx2, 4.5, fz2 - 1.4, s > 0 ? 0x9d2933 : 0x24483a, 0, 0, s * 0.03);
    b.box('fabric', 1.5, 0.12, 0.06, fx2, 6.3, fz2 - 1.4, 0x1a1a20);
    b.kit('washe.flag', 1, 5.0);
  }
  // 场口：门楼（两柱 + 额枋 + 小瓦顶）+ 竖匾。匾额不能空挂一根线——它得有承重的门框
  const gateZ = z + h;
  for (const s of [-1, 1]) {
    b.box('wood', 0.3, 3.6, 0.3, x + s * 2.6, 1.8, gateZ, shade(C.woodRed, 0.92 + rnd() * 0.08));
    b.box('ash', 0.6, 0.3, 0.6, x + s * 2.6, 0.15, gateZ, shade(STONE_DK, 1.04));
  }
  b.box('wood', 5.9, 0.34, 0.36, x, 3.62, gateZ, shade(C.woodRed, 1.02));
  b.box('roof', 6.8, 0.22, 1.5, x, 3.9, gateZ, shade(C.tile2, 1.12));
  b.box('roof', 6.9, 0.14, 0.34, x, 4.04, gateZ, shade(C.tile, 1.1));
  const uv = atlas.text(`washe_${Math.round(x)}_${Math.round(z)}`, '瓦舍', 180, 90,
    { color: '#ffe4c0', glow: '#ff5a3c', bg: 'rgba(20,8,10,0.9)', border: 'rgba(255,90,60,.8)', fontPx: 52, vertical: true });
  sg.quad(uv, 1.05, 2.1, x, 2.35, gateZ + 0.24, 0);
  b.kit('washe.gate', 1, 3.1);
}

// ============ R27 核心带补绿：只铺低矮地被与小品，不建大建筑 ============
/**
 * 每处核心带站点 = 连片草绿草坪 + 花圃 + 低矮树阵 + 石景/曲水/低廊。
 * 全部复用 meadow/lawn、flowerBed、broadleaf/poplar、rockery 等既有 helper，
 * 走既有 leaf/trunk/earth/ash/water/wood/roof 材质组、Baker 合批（0 新材质组 / 0 独立 Mesh / 0 draw call）。
 * 位置与选型全由 siteSeed 整数坐标 hash 派生，零共享 RNG、不用 Math.random。
 */
function buildCoreGreenSite(b: Baker, site: CoreGreenSite): void {
  const { x, z, variant } = site;
  const rnd = mkRand(siteSeed(x, z, 501 + variant));
  // ① 明确草绿的连片草坪：边长 = 网格步长 × CORE_GREEN_TILE，相邻站点接壤压住浅黄空坪
  // R23：街道裁剪 + 草叶/花/枝叶（替代原 meadow 纯色膜）
  r23Ground(b, x, z, CORE_GREEN_STEP_X * CORE_GREEN_TILE, CORE_GREEN_STEP_Z * CORE_GREEN_TILE,
    RAISED_LAWN_Y_INFILL, siteSeed(x, z, 2603 + variant));
  b.kit('park.coreGreen.lawn', 1, 0.07);
  const dry = (px: number, pz: number): boolean => canalClearance(px, pz) > 3;
  // ② 花圃 3 块（复用 flowerBed）：整数 hash 落在草坪内，逐处避开支渠
  for (let i = 0; i < 3; i++) {
    const hs = siteSeed(x, z, 511 + i * 7 + variant);
    const fx = x + ((hs % 101) - 50) * 0.5, fz = z + (((hs >>> 8) % 41) - 20) * 0.9;
    if (!dry(fx, fz)) continue;
    flowerBed(b, fx, fz, 4 + (hs % 3), 2.2 + (hs % 2), rnd);
  }
  // ③ 低矮树阵 3 株（s 0.55–0.75，树高 4–7m，不挡街道与河）
  for (let i = 0; i < 3; i++) {
    const hs = siteSeed(x, z, 541 + i * 11 + variant);
    const tx = x + ((hs % 121) - 60) * 0.85, tz = z + (((hs >>> 9) % 51) - 25) * 0.8;
    if (!dry(tx, tz)) continue;
    if (hs & 1) poplar(b, tx, tz, 0.55 + (hs % 20) / 100, rnd);
    else broadleaf(b, tx, tz, 0.6 + (hs % 20) / 100, rnd);
  }
  // ④ 石景 + 曲水（偶数变体）/ 低矮廊架（奇数变体）—— 皆为 1–2m 低矮小品
  if (variant % 2 === 0) {
    rockery(b, x + 14, z - 7, 0.8, rnd);
    if (canalClearance(x - 12, z + 8) > 5) {
      b.box('water', 24, 0.08, 1.4, x - 12, 0.10, z + 8, 0x1d4d53);   // 曲水（复用既有水色）
    }
  } else {
    // 低廊：4 根木柱 + 一条瓦顶，通高 2.0m（不建大建筑、不挡街道视线）
    for (const t of [-1, 1]) {
      for (const u of [-1, 1]) b.box('wood', 0.16, 1.9, 0.16, x + t * 3.2 + 10, 0.95, z + u * 1.6, shade(C.woodDark, 1.0));
    }
    b.box('roof', 7.4, 0.16, 3.8, x + 10, 2.0, z, shade(C.tile2, 1.04));
  }
  b.kit('park.coreGreen.detail', 1, 0.6);

  // R28 加密：再补 8 株低矮乔木 + 一行花丛带（独立 siteSeed 派生，不扰动既有 rnd 序列）。
  // 叠加既有 3 株树阵 → 每站点 ≥11 株可辨草木；全部既有 leaf/trunk/earth 材质组、Baker 合批。
  const r28 = mkRand(siteSeed(x, z, 801 + variant));
  let extra = 0;
  for (let i = 0; i < 8; i++) {
    const hs = siteSeed(x, z, 811 + i * 13 + variant);
    const tx = x + ((hs % 141) - 70) * 0.85, tz = z + (((hs >>> 9) % 61) - 30) * 0.9;
    if (!dry(tx, tz)) continue;
    if (hs & 1) poplar(b, tx, tz, 0.5 + (hs % 18) / 100, r28);
    else broadleaf(b, tx, tz, 0.52 + (hs % 18) / 100, r28);
    extra++;
  }
  for (let i = 0; i < 4; i++) {
    const hs = siteSeed(x, z, 861 + i * 7 + variant);
    const fx = x + ((hs % 121) - 60) * 0.9, fz = z + (((hs >>> 8) % 45) - 22) * 1.1;
    if (!dry(fx, fz)) continue;
    flowerBed(b, fx, fz, 4 + (hs % 3), 2 + (hs % 2), r28);
  }
  b.kit('park.coreGreen.plant', 3 + extra, 0.6);
  b.kit('park.coreGreen.r28', 1, 0.6);
}

// ============ R28 广场坪渲染：只做低矮公园构件，不挡街、不建大体量房屋 ============
/**
 * 一处广场坪 = 明确草绿草坪(lawn, GRASS) + 花圃/花带 + 树阵 + 石景 + 曲水/小池 +
 * 低亭或廊架(按 variant 分档)。每站点 ≥12 株可辨草木（8 株小乔木 + 4 块花圃 + 4 丛灌木）
 * + 1 组景观小品（湖石 + 亭/水景/廊架）。
 * 全部走既有 BGroup(leaf/trunk/ash/earth/water/wood/roof/ceramic) 与 b.box/b.cyl/b.sphere
 * 原语，由 Baker 合批：0 新材质组 / 0 独立 Mesh / 0 draw call。
 * 位置与选型全由 siteSeed 整数坐标 hash + mkRand(siteSeed(...)) 派生，零共享 RNG、不用 Math.random。
 * 返回本站点草木株数，供 buildParks 末尾登记 park.plaza.plant 台账（本函数不自行登记台账）。
 */
function buildPlazaSite(b: Baker, site: PlazaSite): number {
  const { x, z, size, variant } = site;
  const h = size / 2;
  const rnd = mkRand(siteSeed(x, z, 901 + variant));
  const dry = (px: number, pz: number): boolean => canalClearance(px, pz) > 4;
  // ① 明确草绿连片草坪：铺在 city_ground 铺装板（顶 0.28）之上 1cm，压住浅黄格网、令相邻坪地接壤
  const lawnW = PLAZA_LAWN_W, lawnD = PLAZA_LAWN_D;
  // R23：116×56 大草坪按街道走廊裁剪，街面段铺石板；草地段补真草叶 / 花 / 枝叶。
  // 旧版这一整片纯色 raisedLawn 正是「大街上都是绿膜」的直接来源。
  let plants = r23Ground(b, x, z, lawnW, lawnD, RAISED_LAWN_Y_PLAZA, siteSeed(x, z, 2605 + variant));
  // ② 树阵 8 株：简化小乔木（1 柱干 + 2 团球冠，低面数、剪影可辨），整数 hash 落位
  for (let i = 0; i < 8; i++) {
    const hs = siteSeed(x, z, 911 + i * 13 + variant);
    const tx = x + ((hs % 97) - 48) * (lawnW / 100), tz = z + (((hs >>> 9) % 45) - 22) * (lawnD / 46);
    if (!dry(tx, tz)) continue;
    const s = 0.5 + ((hs >>> 16) % 30) / 100;   // 0.5–0.8，树高 3–6m，不挡街
    const th = 2.6 * s + 1.2;
    b.cyl('trunk', 0.13 * s, 0.2 * s, th, 5, tx, th / 2, tz, shade(TRUNK, 0.94 + rnd() * 0.12));
    const lc = shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.92 + rnd() * 0.14);
    b.sphere('leaf', 1.15 * s, 6, tx, th + 0.5 * s, tz, lc, 0, 0, 0, 1.1, 0.82, 1.1);
    b.sphere('leaf', 0.82 * s, 5, tx + 0.7 * s, th + 0.2 * s, tz + 0.3 * s, shade(lc, 1.06), 0, 0, 0, 1.1, 0.8, 1.1);
    plants++;
  }
  // ③ 花圃/花带 4 块（既有 flowerBed，每块 ≥6 株花草）+ 灌木球 4 丛，补足 ≥12 株草木
  for (let i = 0; i < 4; i++) {
    const hs = siteSeed(x, z, 941 + i * 7 + variant);
    const fx = x + ((hs % 101) - 50) * (lawnW / 104), fz = z + (((hs >>> 8) % 37) - 18) * (lawnD / 40);
    if (!dry(fx, fz)) continue;
    flowerBed(b, fx, fz, 4 + (hs % 3), 2 + (hs % 2), rnd);
    plants++;
  }
  for (let i = 0; i < 4; i++) {
    const hs = siteSeed(x, z, 971 + i * 11 + variant);
    const sx = x + ((hs % 111) - 55) * (lawnW / 114), sz = z + (((hs >>> 9) % 41) - 20) * (lawnD / 44);
    if (!dry(sx, sz)) continue;
    for (let k = 0; k < 3; k++) {
      b.sphere('leaf', 0.4 + rnd() * 0.3, 5, sx + (rnd() - 0.5) * 1.4, 0.4 + rnd() * 0.3, sz + (rnd() - 0.5) * 1.4,
        shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.86 + rnd() * 0.2), 0, 0, 0, 1.2, 0.8, 1.2);
    }
    plants++;
  }

  // ④ 石景（每站点一组湖石，复用既有 rockery）
  if (dry(x + h * 0.5, z - h * 0.5)) rockery(b, x + h * 0.5, z - h * 0.5, 0.7 + rnd() * 0.3, rnd);

  // ⑤ 景观小品：按 variant 分档做「低亭 / 曲水小池 / 廊架」之一，皆低矮、不建房屋
  const fx = x - h * 0.35, fz = z + h * 0.35;
  if (variant % 3 === 0) {
    // 低亭：方台明 + 四柱 + 檐口 + 四角攒尖顶 + 宝顶 + 石桌（通高 ~3m，不挡街）
    if (dry(fx, fz)) {
      const r = 2.2;
      b.box('ash', r * 2 + 0.8, 0.24, r * 2 + 0.8, fx, 0.12, fz, shade(STONE_LT, 1.02));
      for (const s of [-1, 1]) for (const u of [-1, 1])
        b.cyl('wood', 0.11, 0.14, 1.9, 6, fx + s * r, 1.07, fz + u * r, shade(C.woodRed, 0.96));
      b.box('roof', r * 2 + 1.4, 0.2, r * 2 + 1.4, fx, 2.12, fz, shade(C.tile2, 1.14));
      b.cyl('roof', 0.28, r + 1.1, 1.1, 4, fx, 2.72, fz, shade(C.tile2, 1.2), Math.PI / 4);
      b.sphere('ceramic', 0.2, 8, fx, 3.35, fz, 0xd8c48a);
      b.cyl('ash', 0.42, 0.48, 0.12, 8, fx, 0.6, fz, shade(STONE_LT, 1.04));
      b.cyl('ash', 0.18, 0.22, 0.5, 6, fx, 0.36, fz, STONE_DK);
    }
  } else if (variant % 3 === 1) {
    // 曲水小池：贴地水带 + 两岸条石 + 三块汀步 + 池边矮石凳（低矮、不积水于街）
    if (dry(fx, fz)) {
      const len = Math.min(14, size * 0.5);
      b.box('water', len, 0.08, 2.0, fx, 0.10, fz, 0x1d4d53);
      for (const s of [-1, 1]) b.box('ash', len + 0.5, 0.16, 0.32, fx, 0.14, fz + s * 1.1, shade(STONE_DK, 1.02));
      for (let i = 0; i < 3; i++)
        b.box('ash', 0.8, 0.12, 2.2, fx - len * 0.3 + i * len * 0.3, 0.19, fz, shade(STONE_LT, 0.98 + rnd() * 0.1));
      b.box('ash', 1.6, 0.16, 0.5, fx + len * 0.5 + 1.0, 0.38, fz + 1.4, shade(STONE_LT, 1.02));
    }
  } else {
    // 廊架：4 根矮木柱 + 双横梁 + 攀藤小球（通高 2.0m 的绿廊，不建房屋）
    if (dry(fx, fz)) {
      for (const s of [-1, 1]) for (const u of [-1, 1])
        b.cyl('wood', 0.1, 0.12, 1.9, 5, fx + s * 2.4, 0.95, fz + u * 1.2, shade(C.woodDark, 1.0));
      b.box('wood', 5.4, 0.12, 0.14, fx, 2.0, fz - 1.2, shade(C.wood, 1.06));
      b.box('wood', 5.4, 0.12, 0.14, fx, 2.0, fz + 1.2, shade(C.wood, 1.06));
      b.box('roof', 6.0, 0.14, 3.0, fx, 2.12, fz, shade(C.tile2, 1.06));
      for (let k = 0; k < 5; k++)
        b.sphere('leaf', 0.35 + rnd() * 0.18, 5, fx - 2.2 + k * 1.1, 2.2 + rnd() * 0.2, fz + (rnd() - 0.5) * 1.4,
          shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.9 + rnd() * 0.16), 0, 0, 0, 1.1, 0.7, 1.1);
    }
  }
  return plants;
}

// ============ R22 第二轮：连片草皮渲染（薄层 + 4–8 株低矮花木，Baker 合批） ============
/**
 * 一块 CORE_GAP_LAWN = 薄层草皮（lawn, GRASS 0x5f8f42, y≈0.035，块尺寸略大于步长→连片）+
 * 4–8 株低矮花木 / 花丛（复用既有 flowerBed 与 b.cyl/b.sphere 小灌木）。
 * 贴近既有站点时花木降档到 4 株，避免立体陈设叠压；草皮本身与既有公园草坪同色同高，重叠无碍。
 * 全部走既有 BGroup(leaf/trunk/earth/glow/ceramic) 与 b.box/b.cyl/b.sphere 原语：
 * 0 新材质组 / 0 独立 Mesh / 0 draw call。位置全由 siteSeed 整数 hash + mkRand(siteSeed(...)) 派生，
 * 零共享 RNG、不用 Math.random。返回花木株数，供 buildParks 末尾登记 park.coreGap.plant 台账。
 */
function buildCoreGapLawn(b: Baker, site: CoreGapLawn): number {
  const { x, z, w, d, variant, nearSite } = site;
  // ① 连片薄层草皮：深绿 GRASS，块尺寸 w/d 略大于网格步长，相邻块搭接不留棋盘缝；
  //    R22 第三轮改铺在 city_ground 铺装板（顶 0.28）之上，否则整片被压住看不见。
  // R23：街道走廊裁剪 + 真草叶/花/枝叶；街面段改铺石板，绿膜不再上街
  let plants = r23Ground(b, x, z, w, d, RAISED_LAWN_Y_PLAZA, siteSeed(x, z, 2607 + variant));
  // ② 每块按 siteSeed 补 4–8 株花木 / 花丛；贴近既有站点时固定 4 株（降档）
  const rnd = mkRand(siteSeed(x, z, 1319 + variant));
  const dry = (px: number, pz: number): boolean => canalClearance(px, pz) > 4;
  const n = nearSite ? 4 : 4 + (siteSeed(x, z, 1327 + variant) % 5);
  for (let i = 0; i < n; i++) {
    const hs = siteSeed(x, z, 1331 + i * 13 + variant);
    const px = x + ((hs % 41) - 20) * (w / 44);
    const pz = z + (((hs >>> 8) % 17) - 8) * (d / 18);
    if (!dry(px, pz)) continue;
    if (hs & 1) {
      // 低矮花丛：复用既有 flowerBed（每块 ≥6 株小花，只走既有 earth/leaf/glow 组）
      flowerBed(b, px, pz, 2 + rnd(), 1.4 + rnd(), rnd);
    } else {
      // 小灌木：1 柱干 + 1 团球冠（低面数、剪影可辨，高 < 2m 不挡街）
      const s = 0.34 + ((hs >>> 16) % 14) / 100;
      const th = 1.0 * s + 0.5;
      b.cyl('trunk', 0.08 * s, 0.12 * s, th, 5, px, th / 2, pz, shade(TRUNK, 0.94 + rnd() * 0.1));
      b.sphere('leaf', 0.55 * s + 0.28, 5, px, th + 0.32 * s, pz,
        shade(rnd() < 0.5 ? LEAF : LEAF_WARM, 0.9 + rnd() * 0.16), 0, 0, 0, 1.1, 0.8, 1.1);
    }
    plants++;
  }
  return plants;
}

// ============ 入口 ============

/**
 * R11 总入口：2 处大苑囿 + 8 处中小园林 + 5 处瓦舍勾栏；
 * R26 再叠一层「空地填充」：INFILL_SITES（全城 −4600…4600 网格，站点数由 makeInfillSites() 实算）
 * 覆盖坊间、御街两厢、城墙内侧与宫城外围以外的城内空地，
 * 每处按 variant 做 4 套确定性游憩组合（台榭 / 楼阁 / 水榭曲桥 / 假山瀑布），
 * 草坪连片并补一行乔木 / 花丛带（park.infill.lawn / park.infill.grove 台账）。
 * R27 再叠一层「核心带细网格」：CORE_GREEN_SITES（|z|110–420 步长 70 的双侧细带 × |x|≤4400）
 * 专补御街两厢 / 汴河两岸的方形浅黄空坪，只铺低矮地被与小品、不建大建筑；
 * 草坪改用明确草绿，独立 park.coreGreen.site 台账，不并入 INFILL_SITES 的 1060 口径。
 *
 * `rng` 保留在签名里以对齐其他 builder，但**本模块不消耗它**：
 * 全部抖动由坐标 hash 派生（见 mkRand/siteSeed）。理由与 props.ts 的 willow/conifer 同：
 * 共享 RNG 的取数序列一变，下游 buildTrees/buildStalls 的落位会整体错位，
 * 而 parks 是后加的独立图层，不该改变已有城市。R25 的新站点同样只读坐标 hash，
 * 不碰 rng，因此扩充站点表不会扰动后续任何随机序列。
 */
export function buildParks(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  void rng;
  for (const site of GRAND_PARKS) buildGrandPark(b, sg, atlas, site);
  for (const site of GARDENS) buildGarden(b, site);
  for (const site of WASHE_SITES) buildWashe(b, sg, atlas, site);
  // R21 空地填充层：每处都是一组肉眼可辨的公园/游憩场景，逐处独立 seed、4 套组合
  for (const site of INFILL_SITES) buildInfillSite(b, site);
  // R27 核心带细网格补绿：独立站点表，不并入 INFILL_SITES（保持 1060 / park.infill.siteCount 口径）
  for (const site of CORE_GREEN_SITES) buildCoreGreenSite(b, site);
  // R28 广场坪补绿：独立站点表（|z|66–160 近河带 + 实拍裸地 x∈[-700,0] 加密带 + |z|420–900 漏坪），
  // 逐处过 plazaClear，只铺低矮公园构件；不并入 INFILL_SITES / CORE_GREEN_SITES（保持 1060 / 337 台账口径）。
  let plazaPlant = 0;
  for (const site of PLAZA_SITES) plazaPlant += buildPlazaSite(b, site);
  // R22 第二轮：连片薄层草皮 CORE_GAP_LAWNS（|z|66–420 × |x|≤4400，x=48 / z=20），
  // 逐块过 coreGapClear，铺深绿连片草皮 + 4–8 株花木，专消「站点级草坪之间的缝」与 160–420 裸带。
  let coreGapPlant = 0;
  for (const site of CORE_GAP_LAWNS) coreGapPlant += buildCoreGapLawn(b, site);
  b.kit('park.siteCount', GRAND_PARKS.length + GARDENS.length + WASHE_SITES.length, 0);
  b.kit('park.infill.siteCount', INFILL_SITES.length, 0);
  b.kit('park.coreGreen.site', CORE_GREEN_SITES.length, 0);
  b.kit('park.plaza.site', PLAZA_SITES.length, 0);
  b.kit('park.plaza.lawn', PLAZA_SITES.length, 0.07);
  b.kit('park.plaza.plant', plazaPlant, 0.6);
  b.kit('park.plaza.feature', PLAZA_SITES.length, 1.6);
  b.kit('park.coreGap.site', CORE_GAP_LAWNS.length, 0);
  b.kit('park.coreGap.lawn', CORE_GAP_LAWNS.length, 0.035);
  b.kit('park.coreGap.plant', coreGapPlant, 0.6);
}

/**
 * 站点自检表（纯数据，供探针/单测读取）：每块园的矩形与类别。
 * 与 lead 的接线无关，但让「园子到底落在哪、有没有压到坊巷」可以不经画面直接断言。
 */
export const PARK_SITES: readonly { kind: 'park' | 'garden' | 'washe'; name: string; x0: number; x1: number; z0: number; z1: number }[] = [
  ...GRAND_PARKS.map((p) => ({ kind: 'park' as const, name: p.name, x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 })),
  ...GARDENS.map((g) => ({ kind: 'garden' as const, name: `園林 ${g.x},${g.z}`, x0: g.x - g.size / 2, x1: g.x + g.size / 2, z0: g.z - g.size / 2, z1: g.z + g.size / 2 })),
  ...WASHE_SITES.map((w) => ({ kind: 'washe' as const, name: w.name, x0: w.x - w.size / 2, x1: w.x + w.size / 2, z0: w.z - w.size / 2, z1: w.z + w.size / 2 })),
];
