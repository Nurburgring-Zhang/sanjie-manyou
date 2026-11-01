import type { Baker } from './bake';
import { shade } from './bake';
import { buildPalaceGarden, buildPalaceHall } from './palaceDetail';

/**
 * R24 宫城填充层：把 2200×1050m 的宫城从「中轴一条带 + 两片夯土」填成有围合的宫院。
 *
 * 用户判词（逐字）：
 *  「皇宫如此空旷正常吗」「为什么皇宫内还是那么空旷！！！」
 *  「为什么皇宫又没有移动到闹市区附近？？？」「以及皇宫内的各种物品、装饰！！雕梁画柱！！还有精致的各种园亭楼阁台」
 *
 * 几何账（全部可机检，读点见文件末 palaceGroundsAudit()）：
 *  · 庑房：|x| = 172（内立面 166 / 后檐 178），进深 12，檐高 7.2，30–38m 一段、段间 1.2m 缝；
 *    每段 = 台明 + 后墙 + 两端山墙 + 逐间柱列（柱础）+ 檐枋 + 门洞 / 槛墙窗棂 + 双坡瓦顶 + 檐下宫灯。
 *  · 配殿：中轴三殿院与后寝院每进东西各一对，面阔 36–40、进深 18，台基 1.1 + 踏道 + 前檐柱列 + 隔扇 + 歇山。
 *  · 值房 / 库房：宫墙内皮每隔 68m 一座（面阔 17 = 2 间、进深 12、檐高 4.5），朝院内开门。
 *  · 铺装：宫城内除建筑与水面外一律方砖（26m 见方的大砖块 + 0.22m 砖缝），御路 14m、石边 0.9m、
 *    横街 5 条重铺；六宫 12 院各铺院心。
 *  · 陈设：铜鼎 / 日晷 / 嘉量 / 华表 / 望柱 / 石狮 / 宫灯 / 太平缸 / 香炉 / 旗杆，沿甬道对称、间距规则。
 *  · 御花园 2 处（东西各一，120×160），直接调 palaceDetail.buildPalaceGarden（每处 6 亭 / 3 楼 / 2 台），
 *    另加假山、水池、曲桥、花木。
 *  · 宫墙外：东西 30–70m 环带 4 类官署各 3 组（衙署 / 仓廪 / 守卫营房 / 匠作监）+ 贴墙值房带；
 *    南面午门外千步廊两列（|x| 14–26、z −2944…−2826）接御街铺面；北面仓廪 / 营房各 2 组。
 *
 * 材质纪律：只走 wall / roof / wood / ash / ground / glow / leaf / trunk / lacquer / metal / fabric / water
 * 这几组，新增几何在 compactStatic 里仍能合并，不因材质种类爆 draw call。
 */

// ---- 与 imperial.ts 同口径的宫城坐标 ----
const PAL_HX = 1098.7;
const PAL_S = -2948.7;
const PAL_N = -4001.3;

/** 庑房 / 配殿的横向定位（用户口径 |x| ≈ 150–190） */
const VERA_X = 172;
const VERA_D = 12;
const VERA_H = 7.2;
const SIDE_X = 199;
const SIDE_D = 18;

// ---- 色板：与 imperial.ts 的宫城色同源，低的青瓦衬主殿的金瓦 ----
const RED = 0x9d3327;
const TILE = 0x35594c;
const GOLD = 0x9a7428;
const GOLD_D = 0x7d5d1e;
const STONE = 0x9a9384;
const MARBLE = 0xd2c9b6;
const MARBLE_D = 0xb6ae99;
const PAVE = 0x8b8574;        // 方砖面（青灰石）：比 0x6c675a 提两档，黄昏下才读得出「石」而不是「沥青」
const PAVE_D = 0x736d5e;      // 砖缝底衬（只深一档，避免俯瞰变成黑网格）
const WOOD_DARK = 0x4a3220;
const BRONZE = 0x4a4234;
const GILT = 0xc9a13a;
const WIN = 0xff9a3c;
const LANT = 0xffc66e;

/** 坐标 hash（0–1）：与 imperial.wardHash 同式，不消耗共享 RNG，重建逐值一致 */
function h(a: number, b: number, c: number): number {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** 局部坐标 → 世界（与 imperial / buildings 的 at() 同式，ry 为绕 y 的偏航） */
function frame(x: number, z: number, ry: number): (lx: number, lz: number) => [number, number] {
  const c = Math.cos(ry), s = Math.sin(ry);
  return (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
}

/** 朝向：局部 +z（正面）指向世界 (dx, dz) */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

// ============ 占位台账（机检「最大空矩形」用） ============
type OccKind = 'build' | 'wall' | 'pave';
interface OccRect { x0: number; x1: number; z0: number; z1: number; kind: OccKind }
const OCC: OccRect[] = [];

function markRect(kind: OccKind, x0: number, x1: number, z0: number, z1: number): void {
  OCC.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), kind });
}

/** 已按偏航的构件：取轴对齐包围盒（矩形判定只认包络） */
function markBox(kind: OccKind, x: number, z: number, w: number, d: number, ry = 0): void {
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  const ex = (w * c + d * s) / 2, ez = (w * s + d * c) / 2;
  markRect(kind, x - ex, x + ex, z - ez, z + ez);
}

// ============ 一、方砖铺装 ============
/**
 * 院落方砖：一整片青石底衬（顶 0.122）+ 26m 见方的大砖块（顶 0.14），砖缝 0.22m 露底衬。
 * 颜色走 ash（中性石贴图）而不是 ground（暖赭夯土）：ground 会把 0x6c675a 染回沙色，
 * 那正是「宫城里一片裸土」的直接来源。
 */
function paveField(b: Baker, x0: number, x1: number, z0: number, z1: number, step = 34): void {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const za = Math.min(z0, z1), zb = Math.max(z0, z1);
  const w = xb - xa, d = zb - za;
  if (w < 2 || d < 2) return;
  const cx = (xa + xb) / 2, cz = (za + zb) / 2;
  b.box('ash', w, 0.5, d, cx, -0.128, cz, PAVE_D);           // 顶 0.122
  markRect('pave', xa, xb, za, zb);
  const nx = Math.max(1, Math.round(w / step));
  const nz = Math.max(1, Math.round(d / step));
  const tw = w / nx, td = d / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const px = xa + (i + 0.5) * tw, pz = za + (j + 0.5) * td;
      const tone = 0.93 + h(i + 11, j + 17, 3) * 0.13;
      b.box('ash', tw - 0.22, 0.06, td - 0.22, px, 0.11, pz, shade(PAVE, tone)); // 顶 0.14
    }
  }
  b.kit('palace.paving.field', 1, 0.14);
  b.kit('palace.paving.tile', nx * nz, 0.14);
}

/** 甬道 / 御路：14m 石板带 + 两道石边；顶 0.175 / 0.19，压在方砖（0.14）之上 */
function paveAvenue(b: Baker, z0: number, z1: number, hw = 7): void {
  const za = Math.min(z0, z1), zb = Math.max(z0, z1);
  const cz = (za + zb) / 2, d = zb - za;
  b.box('ash', hw * 2, 0.08, d, 0, 0.135, cz, shade(PAVE, 1.16));                        // 顶 0.175
  for (const s of [-1, 1]) b.box('ash', 0.9, 0.06, d, s * (hw + 0.45), 0.16, cz, STONE);  // 顶 0.19
  for (let z = za + 1.6; z < zb; z += 3.2) b.box('ash', hw * 2 - 0.4, 0.02, 0.16, 0, 0.18, z, shade(PAVE, 0.9));
  b.kit('palace.avenue', Math.round(d / 14), 0.18);
}

/** 横街：整幅石板 + 两侧石边（旧版横街在 0.13，被方砖 0.14 盖住，这里按新地坪重铺） */
function crossStreet(b: Baker, z: number, hw: number, x0: number, x1: number): void {
  const cx = (x0 + x1) / 2, w = x1 - x0;
  b.box('ash', w, 0.07, hw * 2, cx, 0.135, z, shade(PAVE, 1.1));
  for (const s of [-1, 1]) b.box('ash', w, 0.05, 0.56, cx, 0.15, z + s * (hw + 0.3), STONE);
  b.kit('palace.street', 1, 0.17);
}

// ============ 二、树木 ============
/** 宫树：松 / 柏（三层球冠，不用圆锥）+ 槐（宽冠），树池 3.6m 见方 */
function palaceTree(b: Baker, x: number, z: number, s: number, kind: number): void {
  b.box('ash', 3.6, 0.34, 3.6, x, 0.27, z, 0x8b8371);
  b.box('ground', 3.0, 0.1, 3.0, x, 0.44, z, 0x43392c);
  b.kit('palace.treePit', 1, 0.44);
  if (kind === 2) {
    // 槐：直干 + 宽冠（两团，8→6 段：单株 ≈230 面，宫城 700 株省 9 万面）
    b.cyl('trunk', 0.3 * s, 0.42 * s, 5.4 * s, 7, x, 0.44 + 2.7 * s, z, 0x5a4632);
    b.sphere('leaf', 2.8 * s, 6, x, 6.2 * s, z, 0x3d5a34, 0, 0, 0, 1.3, 0.72, 1.3);
    b.sphere('leaf', 2.1 * s, 6, x + 1.5 * s, 6.9 * s, z - 0.6 * s, 0x466a3a, 0, 0, 0, 1.1, 0.74, 1.1);
  } else {
    const c1 = kind === 1 ? 0x2f4a30 : 0x33513a;
    b.cyl('trunk', 0.3 * s, 0.44 * s, 4.2 * s, 7, x, 0.44 + 2.1 * s, z, 0x5a4632);
    b.sphere('leaf', 2.2 * s, 6, x, 4.9 * s, z, c1, 0, 0, 0, 1.1, 0.88, 1.1);
    b.sphere('leaf', 1.6 * s, 6, x + 0.6 * s, 6.6 * s, z - 0.4 * s, shade(c1, 1.1), 0, 0, 0, 1.05, 0.9, 1.05);
  }
  b.kit('palace.palaceTree', 1, 5 * s);
}

// ============ 三、陈设器物 ============
function fDing(b: Baker, x: number, z: number): void {
  b.box('ash', 2.3, 0.3, 2.3, x, 0.27, z, 0x8d8a80);
  b.box('ash', 1.7, 0.55, 1.7, x, 0.68, z, STONE);
  b.cyl('metal', 1.0, 0.78, 1.4, 12, x, 1.6, z, BRONZE);
  for (let l = 0; l < 3; l++) {
    const a = 0.6 + l * 2.094;
    b.cyl('metal', 0.15, 0.19, 0.9, 6, x + Math.cos(a) * 0.82, 0.9, z + Math.sin(a) * 0.82, shade(BRONZE, 0.82));
  }
  b.cyl('metal', 1.1, 1.0, 0.16, 12, x, 2.4, z, shade(BRONZE, 1.18));
  for (const s of [-1, 1]) b.box('metal', 0.2, 0.62, 0.46, x + s * 1.02, 2.6, z, shade(BRONZE, 1.12));
  b.cyl('metal', 0.68, 0.94, 0.34, 12, x, 2.65, z, BRONZE);
  b.cyl('metal', 0.22, 0.28, 0.42, 8, x, 3.0, z, GILT);
  for (let l = 0; l < 4; l++) {
    const a = l * 1.5708 + 0.4;
    b.box('glow', 0.26, 0.14, 0.26, x + Math.cos(a) * 0.86, 2.44, z + Math.sin(a) * 0.86, 0xff7a2a);
  }
  b.kit('palace.furn.ding', 1, 2.6);
}

function fSundial(b: Baker, x: number, z: number): void {
  b.box('ash', 2.8, 0.3, 2.8, x, 0.27, z, 0x8d8a80);
  b.box('ash', 1.9, 0.7, 1.9, x, 0.77, z, MARBLE);
  b.box('ash', 1.4, 1.0, 1.4, x, 1.62, z, shade(MARBLE, 1.04));
  const tilt = 0.62, sin = Math.sin(tilt), cos = Math.cos(tilt);
  b.box('wall', 2.3, 0.16, 2.3, x, 2.2, z, MARBLE, 0, tilt, 0);
  b.box('metal', 0.1, 0.1, 2.7, x, 2.2, z, GILT, 0, tilt, 0);
  for (let k = 0; k < 7; k++) {
    const d = -0.85 + k * 0.283;
    b.box('metal', 0.06, 0.03, 0.14, x + 0.7, 2.2 - d * sin + 0.12, z + d * cos, GILT, 0, tilt, 0);
  }
  b.kit('palace.furn.sundial', 1, 2.4);
}

function fJialiang(b: Baker, x: number, z: number): void {
  b.box('ash', 2.8, 0.3, 2.8, x, 0.27, z, 0x8d8a80);
  b.box('ash', 1.9, 0.7, 1.9, x, 0.77, z, MARBLE);
  b.box('ash', 1.3, 1.1, 1.3, x, 1.67, z, shade(MARBLE, 1.04));
  b.box('metal', 1.5, 0.12, 1.5, x, 2.28, z, BRONZE);
  b.cyl('metal', 0.6, 0.42, 0.72, 12, x, 2.7, z, BRONZE);
  b.cyl('metal', 0.68, 0.64, 0.1, 12, x, 3.11, z, GILT);
  b.cyl('metal', 0.16, 0.2, 0.26, 8, x, 3.29, z, GILT);
  b.kit('palace.furn.jialiang', 1, 2.8);
}

/** 华表：须弥座 + 云龙柱 + 云板 + 承露盘 + 蹲兽（11m） */
function fHuabiao(b: Baker, x: number, z: number): void {
  b.box('ash', 3.0, 0.4, 3.0, x, 0.32, z, 0x8d8a80);
  b.box('ash', 2.3, 0.7, 2.3, x, 0.87, z, MARBLE);
  b.box('ash', 1.6, 0.6, 1.6, x, 1.52, z, shade(MARBLE, 1.05));
  b.cyl('ash', 0.52, 0.62, 8.2, 10, x, 5.9, z, MARBLE);
  for (const sz of [-1, 1]) b.box('ash', 2.9, 0.42, 0.28, x, 8.0, z + sz * 0.1, shade(MARBLE, 1.02));
  b.cyl('ash', 1.1, 0.8, 0.36, 12, x, 10.15, z, MARBLE);
  b.box('ash', 0.55, 0.7, 0.55, x, 10.65, z, shade(MARBLE, 0.96));
  b.sphere('ash', 0.35, 8, x, 11.1, z, shade(MARBLE, 1.06));
  b.kit('palace.furn.huabiao', 1, 11);
}

/** 望柱：1.6m 短柱 + 柱头，成排用 */
function fWangzhu(b: Baker, x: number, z: number): void {
  b.box('ash', 0.42, 1.3, 0.42, x, 0.85, z, MARBLE);
  b.box('ash', 0.56, 0.18, 0.56, x, 1.57, z, shade(MARBLE, 1.06));
  b.kit('palace.furn.post', 1, 1.6);
}

/** 石狮：须弥座 + 蹲狮（成对，dir 为面朝方向） */
function fLion(b: Baker, x: number, z: number, dir: number): void {
  b.box('ash', 2.4, 0.7, 2.4, x, 0.47, z, 0x8d8a80);
  b.box('ash', 1.9, 0.35, 1.9, x, 1.0, z, STONE);
  b.box('ash', 1.25, 1.0, 0.95, x, 1.7, z, 0x6f6b60);
  b.sphere('ash', 0.78, 8, x + dir * 0.1, 2.55, z + 0.25, 0x77746a);
  b.box('ash', 0.9, 0.4, 0.9, x + dir * 0.1, 2.1, z - 0.2, 0x6f6b60);
  for (const s of [-1, 1]) b.box('ash', 0.3, 0.85, 0.34, x + s * 0.45, 1.35, z + 0.35, 0x7a766b);
  b.box('ash', 0.24, 1.1, 0.24, x - dir * 0.5, 2.2, z - 0.45, 0x6f6b60);
  b.box('glow', 0.16, 0.12, 0.1, x + dir * 0.72, 2.62, z + 0.35, 0xffb300);
  b.kit('palace.furn.lion', 1, 2.6);
}

/** 宫灯：石座 + 汉白玉灯柱 + 挑臂 + 绢灯（沿甬道成排） */
function fLantern(b: Baker, x: number, z: number): void {
  b.box('ash', 0.86, 0.34, 0.86, x, 0.29, z, 0x8d8a80);
  b.box('ash', 0.6, 0.3, 0.6, x, 0.6, z, MARBLE);
  b.cyl('ash', 0.17, 0.22, 3.5, 8, x, 2.5, z, MARBLE);
  b.box('wood', 0.12, 0.12, 0.9, x, 4.2, z + 0.45, WOOD_DARK);
  b.box('fabric', 0.52, 0.66, 0.52, x, 3.86, z + 0.86, 0x9d2933);
  b.box('glow', 0.4, 0.5, 0.4, x, 3.86, z + 0.86, LANT);
  b.kit('palace.furn.lantern', 1, 4.2);
}

/** 太平缸：石座 + 铜缸 + 水面 + 双耳 + 缸沿 */
function fVat(b: Baker, x: number, z: number): void {
  b.box('ash', 2.4, 0.26, 2.4, x, 0.25, z, 0x8d8a80);
  b.box('ash', 1.9, 0.22, 1.9, x, 0.49, z, shade(STONE, 1.02));
  b.cyl('metal', 1.28, 1.02, 1.5, 14, x, 1.35, z, 0x3f4a44);
  b.box('water', 2.2, 0.08, 2.2, x, 2.06, z, 0x14405c);
  b.cyl('metal', 1.38, 1.34, 0.18, 14, x, 2.16, z, shade(0x3f4a44, 1.2));
  for (const s of [-1, 1]) b.box('metal', 0.26, 0.5, 0.7, x + s * 1.3, 1.75, z, shade(0x3f4a44, 1.1));
  b.kit('palace.furn.vat', 1, 2.2);
}

/** 香炉：石座 + 铜炉 + 盖 + 双耳 + 三足 */
function fCenser(b: Baker, x: number, z: number): void {
  b.box('ash', 1.6, 0.28, 1.6, x, 0.26, z, 0x8d8a80);
  b.box('ash', 1.15, 0.5, 1.15, x, 0.65, z, STONE);
  b.cyl('metal', 0.62, 0.5, 0.72, 12, x, 1.28, z, BRONZE);
  b.cyl('metal', 0.72, 0.66, 0.14, 12, x, 1.7, z, shade(BRONZE, 1.2));
  b.cyl('metal', 0.3, 0.44, 0.3, 10, x, 1.9, z, shade(BRONZE, 1.05));
  for (const s of [-1, 1]) b.box('metal', 0.16, 0.46, 0.3, x + s * 0.64, 1.66, z, shade(BRONZE, 1.1));
  for (let l = 0; l < 3; l++) {
    const a = 0.5 + l * 2.094;
    b.cyl('metal', 0.09, 0.12, 0.32, 6, x + Math.cos(a) * 0.42, 0.78, z + Math.sin(a) * 0.42, shade(BRONZE, 0.9));
  }
  b.kit('palace.furn.censer', 1, 1.9);
}

/** 旗杆：石座 + 12m 木杆 + 金顶 + 旗（旗面走 fabric） */
function fFlagpole(b: Baker, x: number, z: number, hex: number): void {
  b.box('ash', 2.2, 0.5, 2.2, x, 0.37, z, 0x8d8a80);
  b.box('ash', 1.4, 0.5, 1.4, x, 0.86, z, STONE);
  b.cyl('wood', 0.14, 0.2, 12.0, 8, x, 7.1, z, WOOD_DARK);
  b.cyl('metal', 0.1, 0.16, 0.5, 8, x, 13.3, z, GILT);
  b.box('fabric', 0.06, 2.6, 1.6, x + 0.06, 11.4, z + 1.4, hex);
  b.box('fabric', 0.06, 2.2, 1.3, x + 0.06, 9.6, z + 1.35, shade(hex, 0.9));
  b.kit('palace.furn.flagpole', 1, 12);
}

// ============ 四、通用小殿（配殿 / 值房 / 库房 / 院中正房共用） ============
interface HallOpt {
  x: number; z: number; w: number; d: number; h: number;
  ry?: number;
  base?: number;
  roof?: 'gable' | 'hip';
  roofC?: number;
  wallC?: number;
  bays?: number;
  kitId?: string;
  doorEvery?: number;
  /** 低配档：只留台基 + 墙身 + 一樘门 + 坡顶（院群里的厢房 / 倒座用，省一半面） */
  simple?: boolean;
}

/**
 * 局部坐标：x = 面阔方向，z = 进深方向，+z 为正面。
 * 构件：台基 → 墙身 → 山墙 → 前檐柱列（柱础）→ 逐间隔扇 / 槛窗（窗光 + 窗棂）→ 檐枋 →
 * 双坡瓦顶（或歇山曲面顶）→ 檐口滴水 → 踏道。
 */
function hallUnit(b: Baker, o: HallOpt): void {
  const ry = o.ry ?? 0;
  const { x, z, w, d, h } = o;
  const base = o.base ?? 0.9;
  const roofC = o.roofC ?? TILE;
  const wallC = o.wallC ?? RED;
  const n = o.bays ?? Math.max(2, Math.round(w / 4));
  const at = frame(x, z, ry);
  const bx = (g: Parameters<Baker['box']>[0], lw: number, lh: number, ld: number, lx: number, ly: number, lz: number, hex: number): void => {
    const [wx, wz] = at(lx, lz);
    b.box(g, lw, lh, ld, wx, ly, wz, hex, ry);
  };
  // 台基（两级）+ 台面
  b.box('ash', w + 4.2, base + 0.4, d + 4.2, x, (base - 0.4) / 2, z, STONE, ry);
  bx('ash', w + 2.4, 0.14, d + 2.4, 0, base + 0.05, 0, shade(STONE, 1.12));
  markBox('build', x, z, w + 4.2, d + 4.2, ry);
  // 墙身 + 墙裙
  bx('wall', w, h, d, 0, base + h / 2, 0, wallC);
  bx('ash', w + 0.3, 0.8, 0.34, 0, base + 0.4, d / 2 + 0.2, shade(STONE, 0.94));
  // 前檐柱列（柱础）+ 檐枋：低配档（院群里的厢房/倒座）只保留一樘门 + 一条窗光
  const fz = d / 2 + 0.55;
  if (o.simple) {
    bx('lacquer', 0.22, h * 0.62, Math.min(3.4, w * 0.28), 0, base + h * 0.31, d / 2 + 0.12, 0x1a1416);
    bx('glow', Math.min(2.6, w * 0.24), h * 0.2, 0.12, 0, base + h * 0.62, d / 2 + 0.08, WIN);
    bx('ash', Math.min(4.6, w * 0.34), 0.2, 0.5, 0, base + 0.16, d / 2 + 1.4, shade(STONE, 0.96));
  } else {
    for (let i = 0; i <= n; i++) {
      const lx = -w / 2 + (w * i) / n;
      bx('wood', 0.42, h - 0.9, 0.42, lx, base + 0.45 + (h - 0.9) / 2, fz, shade(0xb8892a, 0.98));
      bx('ash', 0.72, 0.28, 0.72, lx, base + 0.5, fz, MARBLE);
    }
    bx('wood', w + 0.4, 0.5, 0.44, 0, base + h - 0.22, fz, shade(WOOD_DARK, 1.14));
    // 逐间：门洞 / 槛墙 + 窗棂 + 窗光
    const doorEvery = o.doorEvery ?? 3;
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + (w * (i + 0.5)) / n;
      const bw = w / n;
      if (i % doorEvery === 1) {
        bx('lacquer', 0.24, h - 1.8, bw * 0.62, lx, base + (h - 1.8) / 2 + 0.1, d / 2 + 0.1, 0x1a1416);
        bx('metal', 0.3, 0.16, bw * 0.66, lx, base + h - 2.0, d / 2 + 0.13, GILT);
        bx('metal', 0.3, h - 1.9, 0.16, lx - bw * 0.33, base + (h - 1.9) / 2, d / 2 + 0.13, GILT);
        bx('metal', 0.3, h - 1.9, 0.16, lx + bw * 0.33, base + (h - 1.9) / 2, d / 2 + 0.13, GILT);
        b.kit('palace.hallDoor', 1, base + h * 0.5);
      } else {
        bx('wall', bw - 0.7, 1.2, 0.42, lx, base + 0.6, d / 2 + 0.12, shade(wallC, 0.86));
        bx('glow', bw - 1.0, h * 0.36, 0.14, lx, base + 1.2 + h * 0.2, d / 2 + 0.08, WIN);
        // 竖棂 4→2、横棂 2→1：小殿在 200m 外只读"有格子"，省下的面给主殿
        for (let m = 0; m < 2; m++) {
          bx('wood', 0.12, h * 0.4, 0.1, lx - (bw - 1.0) / 2 + ((bw - 1.0) * (m + 0.5)) / 2, base + 1.2 + h * 0.2, d / 2 + 0.16, GILT);
        }
        bx('wood', bw - 1.0, 0.09, 0.12, lx, base + 1.2 + h * 0.4, d / 2 + 0.16, GILT);
        b.kit('palace.hallWindow', 1, base + h * 0.5);
      }
    }
  }
  // 屋面
  if (o.roof === 'hip') {
    const [rx, rz] = at(0, 0);
    const rise = Math.max(2.6, Math.min(w, d) * 0.26 + 1.2);
    b.roofC('roof', rx, base + h, rz, roofC, ry, w + 7.2, rise, d + 6.4, 0, 0, true);
    bx('roof', w * 0.42, 0.62, 0.9, 0, base + h + rise, 0, shade(roofC, 1.24));
    bx('roof', 0.9, 0.24, d + 6.6, 0, base + h + 0.02, 0, shade(roofC, 0.72));
  } else {
    const rh = 1.5 + Math.min(w, d) * 0.18;
    for (const s2 of [-1, 1]) {
      // 坡度用 rz 烘进几何：不出现 rx≠0 与 ry=π 同时作用的上下翻
      const [px, pz] = at(s2 * (w / 4 + 0.35), 0);
      b.box('roof', w / 2 + 1.0, 0.24, d + 1.6, px, base + h + rh * 0.5, pz, roofC, ry, 0, -s2 * 0.34);
    }
    bx('roof', 0.6, 0.32, d + 1.7, 0, base + h + rh, 0, shade(roofC, 1.26));
    bx('roof', 0.9, 0.36, d + 1.5, -w / 2 - 0.3, base + h + 0.06, 0, shade(roofC, 0.74));
    bx('roof', 0.9, 0.36, d + 1.5, w / 2 + 0.3, base + h + 0.06, 0, shade(roofC, 0.74));
  }
  // 踏道（正面三级）
  for (let i = 0; i < 3; i++) {
    const yy = base - (i + 1) * (base / 3);
    bx('ash', Math.min(8, w * 0.3), base / 3, 0.9, 0, yy / 2 + base / 6, d / 2 + 2.6 + i * 0.85, shade(STONE, 0.98 - i * 0.02));
  }
  if (o.kitId) b.kit(o.kitId, 1, base + h);
}

// ============ 五、东西庑房（分段 + 柱列 + 檐口 + 门洞 + 窗棂） ============
/**
 * 一段庑房：长向沿 z，内立面 |x| = 166，后檐 178。
 * 台明 → 后墙 → 两端山墙 → 逐间柱列（柱础）→ 门窗 → 檐枋 → 双坡瓦顶 + 檐口滴水 + 檐下宫灯。
 */
function verandaSegment(b: Baker, sx: number, zS: number, zN: number, salt: number): void {
  const xc = sx * VERA_X;
  const L = Math.abs(zS - zN);
  if (L < 6) return;
  const cz = (zS + zN) / 2;
  const inner = xc - sx * (VERA_D / 2);   // 内立面 166
  const outer = xc + sx * (VERA_D / 2);   // 后檐 178
  const H = VERA_H;
  const n = Math.max(2, Math.round(L / 3.6));
  const bw = L / n;
  // 台明（两端只出挑 0.25，段缝才看得见）
  b.box('ash', VERA_D + 3.4, 0.54, L + 0.5, xc - sx * 0.5, 0.27, cz, STONE);
  // 后墙（外立面）：墙身 + 逐间壁柱 + 盲窗 + 墙帽——不这样处理，从宫城外侧看就是一堵光板长墙
  b.box('wall', 0.7, H, L, outer - sx * 0.35, 0.54 + H / 2, cz, shade(RED, 0.9));
  for (let i = 0; i <= n; i++) {
    b.box('wall', 0.34, H - 0.6, 0.52, outer + sx * 0.12, 0.54 + (H - 0.6) / 2, zS + (zN - zS) * (i / n), shade(RED, 0.82));
  }
  for (let i = 0; i < n; i++) {
    const zc = zS + (zN - zS) * ((i + 0.5) / n);
    b.box('glow', 0.1, 1.1, bw * 0.34, outer + sx * 0.06, 3.3, zc, shade(WIN, 0.72));
    b.box('wood', 0.12, 1.4, bw * 0.4, outer + sx * 0.1, 3.3, zc, shade(WOOD_DARK, 1.1));
  }
  b.box('roof', 1.35, 0.24, L + 0.4, outer - sx * 0.2, 0.54 + H + 0.1, cz, shade(TILE, 0.8));
  // 两端硬山墙：墙身高出屋面 1.2m（山墙尖）——段缝处形成一对"齿"，任何角度都能数出分段
  for (const e of [-1, 1]) {
    const ze = cz + e * (L / 2 + 0.12);
    b.box('wall', VERA_D - 0.4, H + 1.2, 0.72, xc, 0.54 + (H + 1.2) / 2, ze, shade(RED, 0.84));
    b.box('roof', VERA_D - 0.2, 0.24, 1.5, xc, 0.54 + H + 1.3, ze, shade(TILE, 0.9), 0, 0, 0);
  }
  // 逐间：柱列 + 门洞 / 槛窗
  for (let i = 0; i <= n; i++) {
    const zz = zS + (zN - zS) * (i / n);
    b.box('wood', 0.42, H - 0.8, 0.42, inner + sx * 0.4, 0.54 + (H - 0.8) / 2, zz, shade(0xb8892a, 0.98));
    b.box('ash', 0.72, 0.3, 0.72, inner + sx * 0.4, 0.7, zz, MARBLE);
    b.kit('palace.veranda.column', 1, 0.54 + H);
  }
  for (let i = 0; i < n; i++) {
    const zc = zS + (zN - zS) * ((i + 0.5) / n);
    const fx = inner - sx * 0.06;
    if (i % 4 === 2) {
      // 门洞：板门 + 门框 + 门簪
      b.box('lacquer', 0.26, 3.5, bw * 0.58, fx, 0.54 + 1.75, zc, 0x1a1416);
      b.box('metal', 0.32, 0.18, bw * 0.62, fx - sx * 0.04, 0.54 + 3.62, zc, GILT);
      for (const e of [-1, 1]) b.box('metal', 0.32, 3.6, 0.18, fx - sx * 0.04, 0.54 + 1.8, zc + e * bw * 0.31, GILT);
      b.kit('palace.veranda.door', 1, 2.3);
    } else {
      // 槛墙 + 窗棂 + 窗光（竖棂 5→3、横棂 3→2：每间省 3 个盒，庑房 56 段 × 10 间仍读得出格子）
      b.box('wall', 0.46, 1.2, bw - 0.7, fx, 1.14, zc, shade(RED, 0.82));
      b.box('glow', 0.12, 2.1, bw - 1.0, fx + sx * 0.06, 2.95, zc, WIN);
      for (let m = 0; m < 3; m++) {
        b.box('wood', 0.12, 2.2, 0.1, fx - sx * 0.02, 2.95, zc - (bw - 1.0) / 2 + ((bw - 1.0) * (m + 0.5)) / 3, GILT);
      }
      for (const yy of [2.32, 3.58]) b.box('wood', 0.12, 0.08, bw - 1.0, fx - sx * 0.02, yy, zc, GILT);
      b.kit('palace.veranda.window', 1, 2.95);
    }
  }
  // 檐枋 + 屋顶（双坡）——沿 z 只出挑 0.25/端，段间 1.2m 缝才不会被瓦面吃掉
  b.box('wood', 0.36, 0.5, L + 0.5, inner + sx * 0.45, 0.54 + H - 0.2, cz, shade(WOOD_DARK, 1.12));
  const rh = 1.9;
  for (const e of [-1, 1]) {
    b.box('roof', VERA_D / 2 + 1.5, 0.26, L + 0.5, xc + e * (VERA_D / 4 + 0.32), 0.54 + H + rh * 0.5, cz, TILE, 0, 0, -e * 0.34);
  }
  b.box('roof', 0.62, 0.34, L + 0.6, xc, 0.54 + H + rh, cz, shade(TILE, 1.24));
  b.box('roof', 0.95, 0.4, L + 0.45, inner - sx * 0.1, 0.54 + H + 0.02, cz, shade(TILE, 0.72));
  b.box('roof', 0.95, 0.4, L + 0.45, outer + sx * 0.1, 0.54 + H + 0.02, cz, shade(TILE, 0.8));
  // 檐下宫灯（每 3 间一盏）
  for (let i = 1; i < n; i += 3) {
    const zc = zS + (zN - zS) * ((i + 0.5) / n);
    b.box('wood', 0.07, 0.7, 0.07, inner - sx * 0.75, 5.55, zc, WOOD_DARK);
    b.box('fabric', 0.46, 0.56, 0.46, inner - sx * 0.75, 5.15, zc, 0x9d2933);
    b.box('glow', 0.34, 0.42, 0.34, inner - sx * 0.75, 5.15, zc, LANT);
    b.kit('palace.veranda.lantern', 1, 5.2);
  }
  markBox('build', xc, cz, VERA_D, L);
  b.kit('palace.veranda.segment', 1, 0.54 + H);
  b.kit('palace.veranda.bay', n, 0.54 + H);
}

/** 庑房链：30–38m 一段、段间 1.2m 缝（通长会熔成一条灰带——SEGS 的教训） */
function verandaChain(b: Baker, sx: number, z0: number, z1: number, seed: number): void {
  let z = z0;
  let k = 0;
  const dir = Math.sign(z1 - z0) || -1;
  while ((z1 - z) * dir > 14 && k < 80) {
    const len = 30 + h(seed, k, 7) * 8;
    const end = z + dir * Math.min(len, Math.abs(z1 - z));
    verandaSegment(b, sx, z, end, seed + k * 13);
    z = end + dir * 1.2;
    k++;
  }
}

// ============ 六、配殿 ============
function sideHall(b: Baker, sx: number, z: number, w: number, salt: number): void {
  const xc = sx * SIDE_X;
  const ry = yawTo(-sx, 0);   // 正面朝中轴
  hallUnit(b, {
    x: xc, z, w, d: SIDE_D, h: 6.6, ry, base: 1.1,
    roof: 'hip', roofC: h(salt, 3, 5) > 0.55 ? shade(GOLD, 0.96) : GOLD_D,
    kitId: 'palace.sideHall', bays: Math.max(3, Math.round(w / 4.6)), doorEvery: 3,
  });
  // 月台前石灯一对
  const at = frame(xc, z, ry);
  for (const e of [-1, 1]) {
    const [px, pz] = at(e * 3.2, SIDE_D / 2 + 4.6);
    fLantern(b, px, pz);
  }
}

// ============ 七、值房 / 库房 ============
/** 贴墙值房：一组 2 间，正面朝院内（dir 为朝内的 x 方向） */
function dutyBlock(b: Baker, x: number, z: number, dir: number, salt: number): void {
  const ry = yawTo(dir, 0);
  hallUnit(b, {
    x, z, w: 17, d: 12, h: 4.5, ry, base: 0.45, roof: 'gable',
    roofC: shade(TILE, 1.02), wallC: shade(RED, 0.9), bays: 2, kitId: 'palace.dutyRoom', doorEvery: 2,
  });
  const at = frame(x, z, ry);
  const [sx2, sz2] = at(0, 7.4);
  b.box('ash', 3.0, 0.3, 1.0, sx2, 0.34, sz2, STONE, ry);
  const [lx, lz] = at(4.6, 7.0);
  fLantern(b, lx, lz);
  b.kit('palace.dutyBlock', 1, 4);
  if (h(salt, 9, 2) > 0.72) b.kit('palace.dutyStore', 1, 4);
}

// ============ 八、院落（值房院 / 库房院 / 衙署 / 营房 / 匠作） ============
/**
 * 一格院：院墙四面（南面留门）+ 院心方砖 + 正房 + 厢房 + 树 / 缸 / 灯 / 石桌。
 * 五种院型按 hash 选，镜像两侧用同一 salt → 东西对称。
 */
function serviceCourt(b: Baker, cx: number, cz: number, w: number, d: number, kind: number, salt: number): void {
  const wallH = 3.8, t = 0.6, gateW = 6.0;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  // 屋面五档色：同一条带里不出现「整片同色瓦」的仓库感（青瓦 / 深青 / 亮青 / 暗金 / 灰绿）
  const TINTS = [TILE, shade(TILE, 0.9), shade(TILE, 1.1), GOLD_D, shade(TILE, 1.2)];
  const tint = TINTS[(h(salt, 2, 5) * TINTS.length) | 0];
  // 院心方砖
  b.box('ash', w - 2.4, 0.12, d - 2.4, cx, 0.2, cz, shade(PAVE, 1.05));
  // 院墙：南面（+z）留门，其余三面通长
  const wSeg = (w - gateW) / 2;
  for (const s of [-1, 1]) {
    b.box('wall', wSeg, wallH, t, cx + s * (gateW / 2 + wSeg / 2), wallH / 2, z1, RED);
    b.box('roof', wSeg + 0.7, 0.42, t + 1.0, cx + s * (gateW / 2 + wSeg / 2), wallH + 0.21, z1, TILE);
    b.box('wall', t, wallH, d, s > 0 ? x1 : x0, wallH / 2, cz, RED);
    b.box('roof', t + 1.0, 0.42, d + 0.7, s > 0 ? x1 : x0, wallH + 0.21, cz, TILE);
  }
  b.box('wall', w, wallH, t, cx, wallH / 2, z0, RED);
  b.box('roof', w + 0.7, 0.42, t + 1.0, cx, wallH + 0.21, z0, TILE);
  markBox('wall', cx, cz, w, d);
  // 门楼 + 门扇
  b.box('wall', gateW + 2.4, wallH + 1.6, 1.4, cx, (wallH + 1.6) / 2, z1, shade(RED, 1.04));
  b.box('lacquer', gateW - 0.8, 3.2, 0.3, cx, 1.6, z1 + 0.72, 0x1a1416);
  b.box('roof', gateW + 4.4, 0.5, 3.2, cx, wallH + 1.85, z1, shade(TILE, 1.06));
  b.box('roof', 0.5, 0.3, 3.4, cx, wallH + 2.3, z1, shade(GILT, 0.92));
  b.kit('palace.serviceGate', 1, wallH);

  if (kind === 0) {
    // 值房院：正房 34×12 + 两厢 20×9
    hallUnit(b, { x: cx, z: cz - d * 0.24, w: Math.min(34, w * 0.7), d: 12, h: 4.9, base: 0.5, roof: 'gable', roofC: tint, kitId: 'palace.yardHall', bays: 5, doorEvery: 3 });
    for (const s of [-1, 1]) {
      hallUnit(b, { x: cx + s * (w / 2 - 8), z: cz + d * 0.16, w: Math.min(22, d * 0.42), d: 9, h: 4.3, ry: yawTo(-s, 0), base: 0.4, roof: 'gable', roofC: shade(tint, 0.96), kitId: 'palace.yardWing', bays: 3, doorEvery: 2, simple: true });
    }
  } else if (kind === 1) {
    // 库房院：两座大仓 + 三个粮囤
    for (const s of [-1, 1]) {
      hallUnit(b, { x: cx + s * w * 0.24, z: cz - d * 0.22, w: Math.min(24, w * 0.4), d: 14, h: 5.6, base: 0.5, roof: 'gable', roofC: shade(TILE, 0.94), wallC: shade(RED, 0.86), bays: 3, doorEvery: 2, kitId: 'palace.store' });
    }
    for (let i = 0; i < 3; i++) {
      const px = cx - w * 0.24 + i * w * 0.24, pz = cz + d * 0.24;
      b.cyl('earth', 2.0, 2.3, 2.6, 10, px, 1.5, pz, 0x8a7a58);
      b.cyl('roof', 0.3, 2.5, 1.0, 10, px, 3.2, pz, shade(TILE, 0.96));
      b.kit('palace.granary', 1, 3.2);
    }
  } else if (kind === 2) {
    // 衙署：正厅 + 仪门 + 旗杆一对
    hallUnit(b, { x: cx, z: cz - d * 0.2, w: Math.min(38, w * 0.76), d: 14, h: 5.6, base: 0.8, roof: 'hip', roofC: GOLD_D, bays: 5, doorEvery: 3, kitId: 'palace.yamenHall' });
    b.box('wall', Math.min(26, w * 0.5), 3.2, 0.8, cx, 1.6, cz + d * 0.2, shade(RED, 0.94));
    b.box('roof', Math.min(28, w * 0.52), 0.44, 1.6, cx, 3.4, cz + d * 0.2, TILE);
    for (const s of [-1, 1]) fFlagpole(b, cx + s * w * 0.32, cz + d * 0.1, s > 0 ? 0x9d2933 : 0x2a5c42);
    b.kit('palace.yamen', 1, 5);
  } else if (kind === 3) {
    // 守卫营房：三排 + 兵器架
    for (let i = 0; i < 3; i++) {
      hallUnit(b, { x: cx, z: cz - d * 0.28 + i * 12.5, w: Math.min(30, w * 0.62), d: 8, h: 4.0, base: 0.35, roof: 'gable', roofC: shade(tint, 0.94), wallC: shade(RED, 0.88), bays: 4, doorEvery: 2, kitId: 'palace.barracksRow' });
    }
    for (let i = 0; i < 4; i++) {
      b.box('wood', 3.2, 0.14, 0.8, cx - 6 + i * 4, 1.2, cz + d * 0.28, WOOD_DARK);
      for (const s of [-1, 1]) b.box('metal', 0.08, 1.5, 0.08, cx - 6 + i * 4 + s * 1.4, 0.85, cz + d * 0.28, 0x6a6a62);
    }
    b.kit('palace.barracks', 1, 4);
  } else {
    // 匠作监：三座敞棚 + 料堆 + 炉
    for (let i = 0; i < 3; i++) {
      const px = cx + (i - 1) * w * 0.3;
      b.box('wall', 16, 4.4, 11, px, 2.4, cz - d * 0.24, shade(RED, 0.84));
      b.box('roof', 19, 0.3, 13, px, 4.8, cz - d * 0.24, shade(TILE, 0.9));
      b.box('roof', 9.6, 0.24, 13, px - 4.7, 5.3, cz - d * 0.24, shade(TILE, 0.86), 0, 0, 0.34);
      for (let m = 0; m < 4; m++) b.box('wood', 0.3, 4.4, 0.3, px - 7.6 + m * 5.1, 2.4, cz - d * 0.24 + 5.6, WOOD_DARK);
    }
    for (let i = 0; i < 5; i++) b.box('wood', 2.4, 1.1, 1.6, cx - w * 0.3 + i * w * 0.15, 0.7, cz + d * 0.22, shade(0x6a5238, 1.02));
    b.cyl('metal', 1.1, 1.4, 2.4, 10, cx + w * 0.3, 1.35, cz + d * 0.2, 0x4a443c);
    b.box('glow', 0.6, 0.4, 0.6, cx + w * 0.3, 2.2, cz + d * 0.2 + 0.8, 0xff6a1a);
    b.kit('palace.workshop', 1, 4);
  }
  // 倒座：院门两侧各一间（南墙也变成「有房子的院」，而不是一道空墙）
  const fsW = Math.min(13, w * 0.34);
  for (const s of [-1, 1]) {
    hallUnit(b, {
      x: cx + s * (gateW / 2 + fsW / 2 + 1.4), z: z1 - 7.2, w: fsW, d: 8, h: 3.9, ry: Math.PI,
      base: 0.35, roof: 'gable', roofC: shade(tint, 1.04), wallC: shade(RED, 0.9), bays: 2, doorEvery: 2, kitId: 'palace.yardFront', simple: true,
    });
  }
  // 环院廊：东西两侧的单坡廊（台明 + 廊柱 + 廊顶），把正房与倒座连起来
  for (const s of [-1, 1]) {
    const px = cx + s * (w / 2 - 2.4);
    b.box('ash', 2.8, 0.3, d - 8, px, 0.4, cz, STONE);
    b.box('roof', 5.2, 0.26, d - 5, px, 3.55, cz, shade(TILE, 0.92), 0, 0, s * 0.17);
    for (let k = 0; k < 3; k++) {
      b.box('wood', 0.26, 3.1, 0.26, px - s * 1.7, 1.9, cz - (d - 10) / 2 + k * (d - 10) / 2, WOOD_DARK);
    }
    b.kit('palace.yardCorridor', 1, 3.4);
  }
  // 院心：两株树（对角）+ 太平缸 + 石桌 + 门侧石灯
  const kindTree = (h(salt, 5, 9) * 3) | 0;
  for (const s of [-1, 1]) {
    palaceTree(b, cx + s * w * 0.34, cz + s * d * 0.34, 0.82 + h(salt, s + 3, 4) * 0.2, kindTree);
  }
  fVat(b, cx - w * 0.34, cz - d * 0.05);
  b.cyl('ash', 1.0, 0.9, 0.4, 8, cx, 0.42, cz, STONE);
  b.cyl('ash', 0.9, 0.9, 0.1, 8, cx, 0.65, cz, MARBLE);
  for (const s of [-1, 1]) fLantern(b, cx + s * (gateW / 2 + 1.6), z1 - 2.4);
  b.kit('palace.serviceCourt', 1, 4);
}

/** 网格化院群：cols × rows 格，格距 = 院宽 + 4–6m 夹道。x0/x1 可反序（镜像调用）。
 *  奇偶行错半格 + 逐格尺寸抖动：不这样做，五条带在俯瞰里就是一整张坐标纸。 */
function serviceGrid(b: Baker, x0: number, x1: number, z0: number, z1: number, pitch: number, seed: number, kinds: number[]): void {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const za = Math.min(z0, z1), zb = Math.max(z0, z1);
  const cols = Math.max(1, Math.round((xb - xa) / pitch));
  const rows = Math.max(1, Math.round((zb - za) / pitch));
  const cw = (xb - xa) / cols, cd = (zb - za) / rows;
  for (let j = 0; j < rows; j++) {
    const shift = (j % 2) * cw * 0.5;
    for (let i = 0; i < cols; i++) {
      const cx = xa + (i + 0.5) * cw + shift;
      if (cx + cw / 2 > xb + 0.5) continue;
      const cz = za + (j + 0.5) * cd + (h(i + seed, j, 19) - 0.5) * 2.2;
      const salt = Math.round(Math.abs(cx) * 7) * 131 + Math.round(cz * 3) + seed;
      const kind = kinds[(h(i + seed, j + 3, 11) * kinds.length) | 0];
      const jw = 0.9 + h(i, j, seed + 5) * 0.1;
      serviceCourt(b, cx, cz, (cw - 5.0) * jw, (cd - 5.0) * jw, kind, salt);
    }
  }
  b.kit('palace.serviceGrid', cols * rows, 4);
}

// ============ 九、御花园（东西各一处） ============
function rockery(b: Baker, x: number, z: number, s: number, salt: number): void {
  b.box('ash', 16 * s, 0.5, 11 * s, x, 0.4, z, 0x7d796c);
  for (let i = 0; i < 9; i++) {
    const a = h(salt, i, 3) * 6.283, rr = 3.2 * s * h(salt, i, 7);
    const rr2 = 1.4 + h(salt, i, 11) * 2.6;
    b.sphere('ash', rr2 * s, 8, x + Math.cos(a) * rr, 1.2 + h(salt, i, 13) * 4.4 * s, z + Math.sin(a) * rr * 0.7,
      shade(0x7a766a, 0.9 + h(salt, i, 17) * 0.24), 0, 0, 0, 1.2, 0.8 + h(salt, i, 19) * 0.5, 1.1);
  }
  for (let i = 0; i < 3; i++) b.box('ash', 2.4 * s, 3.0 + i, 1.6 * s, x - 4 * s + i * 3.6 * s, 2.0 + i * 0.8, z + 2.2 * s, shade(0x6f6b60, 1.0 + i * 0.05));
  b.kit('palace.garden.rock', 1, 6);
}

function gardenPond(b: Baker, x: number, z: number): void {
  const W = 44, D = 22;
  b.box('ash', W + 3.2, 0.5, D + 3.2, x, 0.2, z, 0x807b6e);
  b.box('water', W, 0.5, D, x, 0.16, z, 0x14405c);
  for (const s of [-1, 1]) {
    b.box('ash', W + 3.2, 0.5, 1.4, x, 0.42, z + s * (D / 2 + 1.0), MARBLE_D);
    b.box('ash', 1.4, 0.5, D + 3.2, x + s * (W / 2 + 1.0), 0.42, z, MARBLE_D);
  }
  b.kit('palace.garden.pond', 1, 0.4);
  // 曲桥：三段折线 + 栏杆
  const segs: [number, number][] = [[-13, z - 2], [0, z + 3], [13, z - 2]];
  for (const [px, pz] of segs) {
    b.box('ash', 15, 0.34, 4.4, x + px, 0.62, pz, 0xb4ae9c);
    for (const e of [-1, 1]) {
      b.box('ash', 15, 0.18, 0.3, x + px, 1.24, pz + e * 2.1, MARBLE);
      for (let m = 0; m < 5; m++) b.box('ash', 0.2, 0.7, 0.2, x + px - 6 + m * 3, 1.0, pz + e * 2.1, MARBLE);
    }
    b.kit('palace.garden.bridge', 1, 0.8);
  }
}

function palaceGardenSide(b: Baker, sx: number): void {
  // 后寝东西两侧：园心 |x| = 365、z = −3800。
  // 用户口径 120×160：实测放不下——buildPalaceGarden 的楼阁排在 r=62 的圈上（楼身 17×13），
  // 120 宽会让东西两座楼各穿出园墙 2m，故园宽取 142（塔尖刚好落在墙内 0.5m），纵深仍 160。
  const cx = sx * 365, cz = -3800;
  const W = 142, D = 160;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
  // 南北两道院墙
  for (const s of [-1, 1]) {
    b.box('wall', W, 4.6, 1.6, cx, 2.3, s > 0 ? z1 : z0, RED);
    b.box('roof', W + 1.2, 0.5, 2.6, cx, 4.8, s > 0 ? z1 : z0, TILE);
  }
  // 朝中轴一侧的院墙（中间开门）
  const gx = sx > 0 ? x0 : x1;
  const gate = 7;
  for (const s of [-1, 1]) {
    b.box('wall', 1.6, 4.6, (D - gate) / 2, gx, 2.3, cz + s * (gate / 2 + (D - gate) / 4), RED);
  }
  b.box('roof', 2.6, 0.5, D + 1.2, gx, 4.8, cz, TILE);
  b.box('roof', 4.2, 0.6, gate + 4, gx, 5.0, cz, shade(GOLD_D, 1.05));
  b.box('lacquer', 0.3, 3.6, gate - 1, gx, 1.9, cz, 0x1a1416);
  b.box('glow', 0.3, 0.4, 0.4, gx + sx * 1.2, 3.6, cz + gate * 0.6, LANT);
  // 外侧院墙
  const ox = sx > 0 ? x1 : x0;
  b.box('wall', 1.6, 4.6, D, ox, 2.3, cz, RED);
  b.box('roof', 2.6, 0.5, D + 1.2, ox, 4.8, cz, TILE);
  markBox('wall', cx, cz, W, D);
  // 地面：青石 + 土衬花池
  b.box('ash', W - 8, 0.16, D - 8, cx, 0.2, cz, shade(PAVE, 1.02));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * 6.283;
    const px = cx + Math.cos(a) * (W * 0.34), pz = cz + Math.sin(a) * (D * 0.38);
    b.box('ground', 9 + h(i, 3, 5) * 5, 0.14, 7 + h(i, 7, 9) * 4, px, 0.28, pz, 0x4a4030);
    b.box('leaf', 5.4, 0.5, 4.2, px, 0.5, pz, 0x3f5a33);
    b.kit('palace.garden.bed', 1, 0.5);
  }
  // 亭 / 楼 / 台：直接调 R23 精细构造库（每处 6 亭 / 3 楼 / 2 台）
  // 亭 / 楼 / 台：直接调 R23 精细构造库（每处 6 亭 / 3 楼 / 2 台）
  buildPalaceGarden(b, { x: cx, z: cz, y: 0.3, count: { pavilion: 6, tower: 3, terrace: 2 } });
  // 假山两处 + 水池曲桥 + 花木
  rockery(b, cx - 46, cz + 58, 1.0, sx * 7 + 3);
  rockery(b, cx + 46, cz + 58, 0.86, sx * 11 + 5);
  // 水池放在园子北偏东：既避开 6 亭（r=34）与 3 楼（r=62）的落点，也正好落在御花园主视角（东北向）里
  gardenPond(b, cx + 20, cz - 55);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * 6.283;
    const rr = 0.42 + h(i, sx + 5, 13) * 0.12;
    palaceTree(b, cx + Math.cos(a) * W * rr, cz + Math.sin(a) * D * rr, 0.8 + h(i, 9, 3) * 0.34, i % 3);
  }
  // 石桌石凳
  for (let i = 0; i < 4; i++) {
    const px = cx - 30 + i * 20, pz = cz + 22;
    b.cyl('ash', 1.2, 1.0, 0.5, 8, px, 0.55, pz, MARBLE_D);
    b.cyl('ash', 1.3, 1.3, 0.12, 8, px, 0.85, pz, MARBLE);
    b.kit('palace.garden.table', 1, 0.8);
  }
  b.kit('palace.garden2', 1, 0.3);
}

// ============ 十、宫墙外过渡带 ============
/** 墙外一组官署：院墙 + 正厅（或仓 / 营房 / 匠作棚），ry 为正面朝向 */
function outerCompound(b: Baker, cx: number, cz: number, ry: number, kind: number, salt: number): void {
  const w = 40, d = 30;
  const at = frame(cx, cz, ry);
  const seg = (lx: number, lz: number, ww: number, dd: number, hh: number): void => {
    const [px, pz] = at(lx, lz);
    b.box('wall', ww, hh, dd, px, hh / 2, pz, RED, ry);
    b.box('roof', ww + 0.6, 0.4, dd + 0.6, px, hh + 0.2, pz, TILE, ry);
  };
  seg(0, d / 2, w, 0.6, 3.4);
  seg(0, -d / 2, w, 0.6, 3.4);
  for (const s of [-1, 1]) seg(s * w / 2, 0, 0.6, d, 3.4);
  markBox('wall', cx, cz, w, d, ry);
  if (kind === 0) {
    hallUnit(b, { x: cx, z: cz, w: 30, d: 12, h: 5.2, ry, base: 0.7, roof: 'hip', roofC: GOLD_D, bays: 4, doorEvery: 3, kitId: 'palace.outer.yamen' });
  } else if (kind === 1) {
    for (const s of [-1, 1]) {
      const [px, pz] = at(0, s * 5.5);
      hallUnit(b, { x: px, z: pz, w: 30, d: 10, h: 4.8, ry, base: 0.5, roof: 'gable', wallC: shade(RED, 0.86), bays: 3, doorEvery: 2, kitId: 'palace.outer.granary' });
    }
  } else if (kind === 2) {
    for (let i = 0; i < 2; i++) {
      const [px, pz] = at((i - 0.5) * 11, 0);
      hallUnit(b, { x: px, z: pz, w: 9, d: 24, h: 3.8, ry, base: 0.35, roof: 'gable', wallC: shade(RED, 0.88), bays: 2, doorEvery: 2, kitId: 'palace.outer.barracks' });
    }
  } else {
    hallUnit(b, { x: cx, z: cz, w: 28, d: 11, h: 4.4, ry, base: 0.4, roof: 'gable', roofC: shade(TILE, 0.9), bays: 3, doorEvery: 2, kitId: 'palace.outer.workshop' });
    const [fx, fz] = at(9, 8);
    b.cyl('metal', 0.9, 1.1, 2.2, 10, fx, 1.3, fz, 0x4a443c);
    b.box('glow', 0.5, 0.34, 0.5, fx, 2.1, fz + 0.6, 0xff6a1a);
  }
  b.kit('palace.outer', 1, 4);
  void salt;
}

/** 千步廊：午门外御街两厢的长排廊房（|x| 14–26），把宫门与御街铺面接起来 */
function thousandStepCorridor(b: Baker): void {
  const zS = -2944, zN = -2826;
  for (const sx of [-1, 1]) {
    const cx = sx * 20;
    const ry = yawTo(-sx, 0);
    let z = zS;
    let k = 0;
    // z 从 −2944 递增到 −2826（向南）：旧版写成 z > zN+8，起点即假，一间都没建（palace.qianbulang = 0）
    while (z < zN - 8 && k < 12) {
      const len = Math.min(26, zN - z);
      const cz = z + len / 2;
      hallUnit(b, { x: cx, z: cz, w: len - 1.2, d: 11, h: 4.6, ry, base: 0.55, roof: 'gable', roofC: shade(TILE, 1.02), wallC: shade(RED, 0.92), bays: Math.max(3, Math.round(len / 4)), doorEvery: 2, kitId: 'palace.qianbulang', simple: true });
      z += len + 1.4;
      k++;
    }
    b.kit('palace.qianbulang.segment', k, 4);
  }
}

// ============ 十一、总装 ============
/**
 * 宫内填充（由 imperial.buildPalace 调用，必须在 buildPalaceGround / buildThreeHalls 之后）。
 * 顺序：方砖底铺 → 御路 / 横街 → 庑房链 → 配殿 → 后寝 → 值房 → 院群 → 六宫院心 → 陈设 → 御花园。
 */
export function buildPalaceGrounds(b: Baker): void {
  // ① 方砖底铺：整个宫城（建筑与水面压在上面，砖缝只在露出来的地方看得到）。
  //    南北各铺到墙心（PAL_S+2 / PAL_N−2）：留 2m 缝的话，栅格审计会在墙脚留下一条 2m 宽的"裸地"细条。
  paveField(b, -PAL_HX + 4, PAL_HX - 4, PAL_S + 2, PAL_N - 2);
  // ② 中轴御路 + 五条横街重铺（旧横街 0.13 被新地坪盖住）
  paveAvenue(b, PAL_S - 4, PAL_N + 6, 7);
  for (const [z, hw, e] of [[-3065, 3.4, 1080], [-3355, 3.2, 620], [-3585, 3.0, 620], [-3762, 4.0, 1080], [-3975, 3.0, 1080]] as const) {
    crossStreet(b, z, hw, -e, e);
  }
  // ③ 沿墙散水重铺（旧版 0.11 被盖住）
  for (const s of [-1, 1]) {
    b.box('ash', PAL_HX * 2 - 6, 0.1, 4, 0, 0.19, s > 0 ? PAL_S - 2 : PAL_N + 2, STONE);
    b.box('ash', 4, 0.1, PAL_S - PAL_N - 6, s * (PAL_HX - 2), 0.19, (PAL_S + PAL_N) / 2, STONE);
  }
  // 宫墙本体入账（墙在 x ±1100 / z −2950、−4000，宽 3.4）：否则栅格审计会在墙脚留下 4m 宽的"裸地"细条
  markRect('wall', -1100 - 1.7, 1100 + 1.7, PAL_S + 1.7, PAL_S + 5.1);
  markRect('wall', -1100 - 1.7, 1100 + 1.7, PAL_N - 5.1, PAL_N - 1.7);
  for (const s of [-1, 1]) markRect('wall', s * 1100 - 1.7, s * 1100 + 1.7, PAL_N, PAL_S);
  // ④ 东西庑房：|x| 172，从午门内一直到北墙内，30–38m 一段
  for (const sx of [-1, 1]) verandaChain(b, sx, -2984, -3974, 101 + (sx > 0 ? 0 : 37));

  // ⑤ 配殿：三殿院 + 后寝院，每进东西各一对
  for (const sx of [-1, 1]) {
    sideHall(b, sx, -3338, 40, 11);
    sideHall(b, sx, -3414, 36, 13);
    sideHall(b, sx, -3562, 40, 17);
    sideHall(b, sx, -3636, 36, 19);
    sideHall(b, sx, -3796, 38, 23);
    sideHall(b, sx, -3892, 38, 29);
  }

  // ⑥ 后寝：横院墙 + 寝殿（中轴北段收口，R23 精细构造库）
  b.box('wall', 2 * 166, 4.4, 1.4, 0, 2.2, -3752, shade(RED, 0.96));
  b.box('roof', 2 * 166 + 1.2, 0.5, 2.4, 0, 4.6, -3752, TILE);
  // 后寝院墙门：暗腔在墙厚里、朱扉压在它南面（旧版只有一块 12×4 裸暗板凸出墙面 0.6m = 一块黑板）
  b.box('lacquer', 12, 4.0, 0.6, 0, 2.0, -3751.6, 0x1a1416);
  for (const s of [-1, 1]) {
    b.box('lacquer', 5.6, 3.8, 0.24, s * 3.0, 1.95, -3750.95, shade(0x7a1f1a, 1.04));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      b.box('metal', 0.15, 0.15, 0.08, s * (1.0 + c * 1.9), 0.8 + r * 0.85, -3750.78, 0xd8b028);
    }
  }
  b.box('roof', 16, 0.6, 4.0, 0, 4.9, -3752, shade(GOLD_D, 1.1));
  markRect('wall', -166, 166, -3753, -3751);
  buildPalaceHall(b, { x: 0, z: -3840, y: 3.1, w: 110, d: 52, eaveH: 18, tiers: 2 });
  markBox('build', 0, -3840, 134, 76);

  // ⑦ 值房：宫墙内皮 68m 一座（2 间），朝院内开门
  for (const sx of [-1, 1]) {
    for (let z = -3000; z > -3960; z -= 68) dutyBlock(b, sx * 1074, z, -sx, z * 0.01);
  }
  // 北墙内皮一排（跳过六宫与神武门）
  for (let x = -1020; x <= 1020; x += 72) {
    if (Math.abs(x) < 70) continue;
    if (Math.abs(Math.abs(x) - 650) < 245) continue;   // 让开东西六宫（x 440–860）
    dutyBlock(b, x, -3966, 0, x * 0.01);
  }
  // 旧版这里还有一段 x −380…380 / step 76 的值房：它与上一段同在 z −3966，x 只差 4m，
  // 两排几乎重合（俯视是双墙错缝）。上一段在 |x| 72–380 已有 5 组，删掉重复段。

  // ⑧ 两厢院群：格距 62m（院 57 + 夹道 5），东西镜像（同一 salt → 同院型，只是镜像落位）
  for (const sx of [-1, 1]) {
    const S = (x0: number, x1: number, z0: number, z1: number, pitch: number, seed: number, kinds: number[]): void =>
      serviceGrid(b, sx * x0, sx * x1, z0, z1, pitch, seed, kinds);
    S(214, 320, -3300, -3716, 68, 11, [0, 0, 1, 2, 3]);
    S(214, 320, -2988, -3300, 68, 23, [3, 0, 4, 0, 2]);
    S(348, 466, -2988, -3716, 84, 37, [1, 4, 0, 3, 2]);
    S(470, 770, -2988, -3118, 80, 41, [2, 1, 3, 0]);
    S(470, 770, -3342, -3518, 80, 53, [1, 1, 3, 4, 0]);
    S(880, 1052, -2988, -3716, 80, 67, [0, 1, 3, 2, 4]);
    S(880, 1052, -3720, -3984, 80, 71, [1, 3, 0, 4]);
    // 御花园西侧两条窄院（x 200–290，园墙 294 起）与后寝两侧的值房
    S(200, 248, -3724, -3984, 62, 83, [0, 3]);
    S(250, 290, -3724, -3984, 62, 87, [0, 1]);
    for (let k = 0; k < 3; k++) dutyBlock(b, sx * 262, -3796 - k * 52, -sx, 31 + k);
    // 文华殿 / 武英殿 / 南三所 / 内务府 四座合院：院心方砖 + 甬道 + 四角宫树（旧版院内是裸土）
    for (const [w, d, cz2] of [[300, 220, -3230], [270, 200, -3620]] as const) {
      b.box('ash', w - 16, 0.1, d - 16, sx * 620, 0.19, cz2, shade(PAVE, 1.06));
      b.box('ash', 12, 0.06, d - 30, sx * 620, 0.242, cz2, shade(PAVE, 1.2));
      markRect('pave', sx * 620 - w / 2 + 8, sx * 620 + w / 2 - 8, cz2 - d / 2 + 8, cz2 + d / 2 - 8);
      for (const e of [-1, 1]) for (const t of [-1, 1]) {
        palaceTree(b, sx * 620 + e * (w / 2 - 26), cz2 + t * (d / 2 - 24), 0.94, (e + t + 4) % 3);
        palaceTree(b, sx * 620 + e * (w / 2 - 26), cz2 + t * (d / 2 - 60), 0.88, (e + 2) % 3);
      }
      for (const e of [-1, 1]) fDing(b, sx * 620 + e * 26, cz2 + d * 0.16);
    }
  }

  // ⑨ 六宫 12 院：院心方砖 + 四角宫树（旧版院心是裸土）。列位与 imperial.buildSixPalaces 同口径：500 + col×150
  for (const sx of [-1, 1]) {
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 2; row++) {
        const cx = sx * (500 + col * 150), cz = -3820 - row * 118;
        b.box('ash', 116, 0.12, 92, cx, 0.2, cz, shade(PAVE, 1.02));
        markRect('pave', cx - 58, cx + 58, cz - 46, cz + 46);
        for (const s of [-1, 1]) for (const t of [-1, 1]) palaceTree(b, cx + s * 50, cz + t * 38, 0.86, col % 3);
        fVat(b, cx + 46, cz + 40);
      }
    }
  }

  // ⑩ 陈设：每进院落沿甬道对称
  for (const sx of [-1, 1]) {
    // 太和殿前：铜鼎三对 + 华表 + 石狮（月台前）
    for (const z of [-3240, -3260, -3280]) fDing(b, sx * 24, z);
    fHuabiao(b, sx * 44, -3200);
    fLion(b, sx * 56, -3196, -sx);
    // 殿间院：日晷 / 嘉量 / 香炉 / 太平缸
    fSundial(b, sx * 62, -3354);
    fJialiang(b, sx * 74, -3354);
    for (const z of [-3390, -3560, -3630]) fCenser(b, sx * 40, z);
    fVat(b, sx * 96, -3400);
    fVat(b, sx * 96, -3620);
    // 后寝院：旗杆 + 望柱
    fFlagpole(b, sx * 80, -3790, sx > 0 ? 0x9d2933 : 0x2a5c42);
    fFlagpole(b, sx * 80, -3900, sx > 0 ? 0xa87a2a : 0x24483a);
    for (let i = 0; i < 8; i++) fWangzhu(b, sx * 64, -3806 - i * 11);
    // 甬道宫灯：每 26m 一对
    for (let z = -3170; z > -3960; z -= 26) {
      if ([-3260, -3480, -3690, -3840].some((hz) => Math.abs(z - hz) < 40)) continue;
      fLantern(b, sx * 11.8, z);
    }
    // 树池：殿院四角各 6 株
    for (let i = 0; i < 6; i++) {
      palaceTree(b, sx * (120 + (i % 2) * 26), -3216 - Math.floor(i / 2) * 12, 0.9 + (i % 3) * 0.1, i % 3);
      palaceTree(b, sx * (120 + (i % 2) * 26), -3406 - Math.floor(i / 2) * 12, 0.92 + (i % 3) * 0.08, (i + 1) % 3);
    }
  }

  // ⑪ 御花园 2 处
  for (const sx of [-1, 1]) palaceGardenSide(b, sx);

  b.kit('palace.grounds', 1, 0);
}

/** 宫墙外：东西环带 4 类官署（各 3 组）+ 贴墙值房 + 北面仓廪营房 + 南面千步廊 */
export function buildPalaceOuterGrounds(b: Baker): void {
  for (const sx of [-1, 1]) {
    const ry = yawTo(-sx, 0);
    let i = 0;
    for (let z = -2990; z > -3990; z -= 104) {
      outerCompound(b, sx * 1152, z, ry, i % 4, i * 17 + (sx > 0 ? 1 : 2));
      // 组间贴墙值房（一组一间：60–80m 间距仍有物可数，面数省一半）
      dutyBlock(b, sx * 1150, z - 34, -sx, i * 5);
      i++;
    }
  }
  // 北面（宫墙外 40m 自由带）：仓廪 / 营房各 2 组 + 值房
  for (const [x, kind] of [[-620, 1], [-180, 2], [260, 1], [700, 2]] as const) {
    outerCompound(b, x, -4036, 0, kind, x * 0.01);
  }
  for (let x = -1000; x <= 1000; x += 84) {
    if (Math.abs(x) < 120) continue;
    dutyBlock(b, x, -4032, 0, x * 0.01 + 3);
  }
  // 南面：午门外千步廊（把宫门与御街铺面接起来）
  thousandStepCorridor(b);
  // 千步廊外侧值房
  for (const sx of [-1, 1]) for (let z = -2936; z > -2840; z -= 30) dutyBlock(b, sx * 40, z, -sx, z * 0.01 + sx);
  b.kit('palace.outer.band', 1, 0);
}

// ============ 十二、机检：最大空矩形 ============
interface EmptyRect { w: number; h: number; x: number; z: number; area: number }

function largestEmpty(filled: Uint8Array, nx: number, nz: number, step: number, ox: number, oz: number): EmptyRect {
  const heights = new Int32Array(nx);
  let best: EmptyRect = { w: 0, h: 0, x: 0, z: 0, area: 0 };
  const stack = new Int32Array(nx + 1);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) heights[ix] = filled[iz * nx + ix] ? 0 : heights[ix] + 1;
    let sp = 0;
    for (let ix = 0; ix <= nx; ix++) {
      const cur = ix === nx ? 0 : heights[ix];
      while (sp > 0 && heights[stack[sp - 1]] >= cur) {
        const hgt = heights[stack[--sp]];
        const left = sp > 0 ? stack[sp - 1] + 1 : 0;
        const wid = ix - left;
        const area = wid * hgt;
        if (area > best.area) {
          best = { area, x: ox + left * step, z: oz + (iz - hgt + 1) * step, w: wid * step, h: hgt * step };
        }
      }
      stack[sp++] = ix;
    }
  }
  return best;
}

/** 中轴仪制广场（大朝空间）：不参与「侧带空场」统计，单独报 */
export const PG_CEREMONIAL: readonly [number, number, number, number][] = [
  [-166, 166, -3310, -3192],
  [-166, 166, -3520, -3440],
  [-166, 166, -3730, -3648],
  [-166, 166, -3970, -3760],
];

/**
 * 占位审计：把宫城栅格化成 2m 网格，分别求
 *  · bare   无建筑、无院墙、无铺装（真·裸地）
 *  · walls  无建筑、无院墙
 *  · build  无有顶建筑
 *  · side   去掉中轴仪制广场后的「无有顶建筑」最大矩形
 * 「边长」取矩形的长边。全部来自本文件真实落位坐标，不是估的。
 */
export function palaceGroundsAudit(): {
  rects: number; buildRects: number;
  bare: EmptyRect; walls: EmptyRect; build: EmptyRect; side: EmptyRect;
} {
  const STEP = 2;
  const ox = -PAL_HX, oz = PAL_N;
  const nx = Math.ceil((PAL_HX * 2) / STEP);
  const nz = Math.ceil((PAL_S - PAL_N) / STEP);
  const bare = new Uint8Array(nx * nz);
  const walls = new Uint8Array(nx * nz);
  const build = new Uint8Array(nx * nz);
  const side = new Uint8Array(nx * nz);
  const inCeremonial = (x: number, z: number): boolean =>
    PG_CEREMONIAL.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
  for (const r of OCC) {
    const i0 = Math.max(0, Math.floor((r.x0 - ox) / STEP));
    const i1 = Math.min(nx - 1, Math.ceil((r.x1 - ox) / STEP));
    const j0 = Math.max(0, Math.floor((r.z0 - oz) / STEP));
    const j1 = Math.min(nz - 1, Math.ceil((r.z1 - oz) / STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (r.kind === 'build') { build[k] = 1; walls[k] = 1; bare[k] = 1; side[k] = 1; }
        else if (r.kind === 'wall') { walls[k] = 1; bare[k] = 1; side[k] = 1; }
        else { bare[k] = 1; side[k] = 1; }
      }
    }
  }
  // side 视图：仪制广场内的非建筑格视为已占（广场本身不是「空旷」问题）
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ox + i * STEP, z = oz + j * STEP;
      if (inCeremonial(x, z) && !build[j * nx + i]) side[j * nx + i] = 1;
    }
  }
  return {
    rects: OCC.length,
    buildRects: OCC.filter((r) => r.kind === 'build').length,
    bare: largestEmpty(bare, nx, nz, STEP, ox, oz),
    walls: largestEmpty(walls, nx, nz, STEP, ox, oz),
    build: largestEmpty(build, nx, nz, STEP, ox, oz),
    side: largestEmpty(side, nx, nz, STEP, ox, oz),
  };
}
