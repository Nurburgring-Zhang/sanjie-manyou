import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import { RNG } from '../core/rng';
import { C } from './buildings';
// R10 的两条支渠（蔡河 / 五丈河）：五丈河正好从南岸东段这两处苑囿的位置穿过。
// 只读它的折线与渠宽，用来在园内"让水"——墙在水上断开水门、树石不落渠中、曲径在水缘收头。
import { WATER_BRANCHES } from './water';

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
const GRASS = 0x446230;        // 草地（ground 贴图是暖赭底，绿要压得住）
const GRASS_DK = 0x334a26;
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

// ============ 基本形体 ============

/** 草地：贴在城内地坪（y=0）之上的薄层，压住贴图裸土、不与街面（0.12）抢高度。
 *  走 leaf 组而不是 ground：ground 的 0.24/m 石板贴图铺到 340m 草坪上会变成一张 1m 方格网，
 *  草面要的是均匀色块（叶子材质只采贴图一点，正好当纯色草地用）。 */
function lawn(b: Baker, x: number, z: number, w: number, d: number, hex = GRASS, y = 0.035): void {
  b.box('leaf', w, 0.07, d, x, y, z, hex);
}

/**
 * 大片草地：底色 + 八九块深浅不一的色斑。一整片同色草地从 200m 外看就是一块绿塑料板，
 * 色斑只花 9 个盒子，却能把"草坪"读成"有起伏的地被"。
 */
function meadow(b: Baker, x: number, z: number, w: number, d: number, rnd: Rand, hex = GRASS): void {
  lawn(b, x, z, w, d, hex);
  // 色斑只做 ±5% 明度、最大 20% 边长：再大一点就从"地被起伏"变成"草坪上的绿方块"
  for (let i = 0; i < 8; i++) {
    const pw = w * (0.10 + rnd() * 0.12), pd = d * (0.10 + rnd() * 0.12);
    const px = x + (rnd() - 0.5) * (w - pw), pz = z + (rnd() - 0.5) * (d - pd);
    if (canalClearance(px, pz) < 2) continue;   // 色斑不铺到渠面上（渠水在 1.0m，压着看不见但没必要留）
    b.box('leaf', pw, 0.02, pd, px, 0.068, pz, shade(hex, 0.95 + rnd() * 0.10), rnd() * 0.9);
  }
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

// ============ 入口 ============

/**
 * R11 总入口：2 处大苑囿 + 8 处中小园林 + 5 处瓦舍勾栏。
 *
 * `rng` 保留在签名里以对齐其他 builder，但**本模块不消耗它**：
 * 全部抖动由坐标 hash 派生（见 mkRand/siteSeed）。理由与 props.ts 的 willow/conifer 同：
 * 共享 RNG 的取数序列一变，下游 buildTrees/buildStalls 的落位会整体错位，
 * 而 parks 是后加的独立图层，不该改变已有城市。
 */
export function buildParks(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  void rng;
  for (const site of GRAND_PARKS) buildGrandPark(b, sg, atlas, site);
  for (const site of GARDENS) buildGarden(b, site);
  for (const site of WASHE_SITES) buildWashe(b, sg, atlas, site);
  b.kit('park.siteCount', GRAND_PARKS.length + GARDENS.length + WASHE_SITES.length, 0);
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
