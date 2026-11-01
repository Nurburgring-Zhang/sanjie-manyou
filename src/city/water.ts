import * as THREE from 'three';
import { RNG } from '../core/rng';
import { Baker, shade } from './bake';
import { wardCells, wardReserved, roadBlocked, PALACE } from './imperial';
import { riverCenterZ, riverHalfWidth, RIVER_WATER_Y } from './river';

/**
 * R10 · 汴京水系支脉（四河贯城 + 城内池沼 + 金明池）。
 *
 * 用户问「城市中应该有多条分支河、多个小湖随机分布吗？」——答案是有，但要按汴京实际水系：
 * 汴河（主河，东西向，已由 river.ts 建好）、蔡河（南北向穿南城）、五丈河（东北向）、
 * 金明池（皇家水军演练池，带岛与拱桥）与城内多处池沼（水柜）。**不是乱撒**，所以全部位置
 * 都是对着既有城市几何算出来的，不是随机落点：
 *
 *  ① 水位与主河一致：`WATER_Y = RIVER_WATER_Y = 1.0`（M2 已定），水底另铺一层 0x1a3444；
 *  ② 岸线：支渠两侧与湖泊四周做 0.3m 高石砌驳岸（顶 1.30，水面上露 0.3）；
 *  ③ **有头有尾**：蔡河两端都通（主河南岸水口 → 南城墙水关 → 护城河）；五丈河头接主河、
 *     尾入「水柜」（宋城真实的蓄水库，带石闸），不是凭空断头；
 *  ④ 与建筑的最小间距用 `wardCells()` / `wardReserved()` / `roadBlocked()` 只读复核，
 *     结果见 `waterAudit()`；
 *  ⑤ 不穿宫城（|x|≤1100, z∈[-4000,-2950]）、不占御街（|x|<26）与任何大路路面——
 *     大路是「垂直跨过」而不是「顺着走」，跨点带石桥（桥面 1.36，两侧踏步落回街面）。
 *
 * 落位依据（离线复算 + 文件内 `waterAudit()` 双保险）：
 *  · 御街两厢（infill.ts WS-18）在 |x| 32–878 / |z| 230–2880 铺满里坊，其间只有 8m 宽的
 *    坊间巷道（x=±308.7、±593.3、±878 一线）能走南北向水道 → 蔡河走 x≈597 这条；
 *  · 南城 |x|<880 / z 2880–4100 是唯一成片空地（里坊、御街厢坊、补位坊都不覆盖）→ 金明池；
 *  · 河带 |z| 61–210 在 x<2590 与 3250–4100 两段连续无房（`FILL` 补位坊在 2590–3250、
 *    4150–4810 处落了两座）→ 五丈河只走到 2305 的水柜，硬穿那两处 16–50m 的坊缝会压房。
 *
 * 共享 rng 不吃种子：岸线一律由水体 id 派生（`bodyRng`），与构建顺序无关；
 * 因此新增这一步不会推进世界序列，下游树木/摊位的取数逐值不变。
 */

// ============ 水位与配色（顶点色已在 Baker 里乘过 0.82 落地 AO，这里反除回去） ============
export const WATER_Y = RIVER_WATER_Y;
const BED_Y = 0.55;
const QUAY_BOT = -0.60;
const QUAY_TOP = 1.30;
const AO_FIX = 1 / 0.82;
const WATER_HEX = shade(0x1a3a46, AO_FIX);
const BED_HEX = shade(0x1a3444, AO_FIX);
const STONE = 0x8a8272;
const STONE_D = 0x6f6859;
const STONE_L = 0xa39a86;
const GRASS = 0x54603c;

type Pt = readonly [number, number];

// ============ 岸线：支渠 ============
export interface WaterBranchSpec {
  id: string;
  name: string;
  /** 水面宽（米）。蔡河 18–26、五丈河 12–18 */
  width: number;
  pts: Pt[];
}

/** 主河南岸 z（side=+1）与北岸 z（side=-1）：与 river.ts 同源，水口不靠猜 */
export function riverBankZ(x: number, side: 1 | -1): number {
  return riverCenterZ(x) + side * riverHalfWidth(x);
}

/**
 * 蔡河：主河南岸（x=597）分出，向南穿御街东厢的 8m 坊间巷道，到 z≈3700 折向西南，
 * 从南城墙水关出城入护城河（两端都有口，不是断头渠）。
 * 两端坐标见 `WATER_BRANCHES[0].pts` 首尾。
 */
const CAIHE_PTS: Pt[] = [
  [597, riverBankZ(597, 1) + 0.02], // 水口：主河南岸
  [597, 63],                        // 穿临河铺面后的涵洞出水口
  [596, 300],
  [597, 900],                       // 跨 z=900 大路（桥）
  [598, 1500],
  [596, 2200],
  [597, 2880],                      // 御街厢坊南界
  [597, 3400],
  [597, 3700],
  [300, 3900],                      // 折向西南（南城空地）
  [120, 4000],
  [90, 4100],                       // 跨 z=4100 大路（桥）
  [90, 4988],                       // 南城墙水关（贴城墙内皮出城入护城河）
];

/** 五丈河：主河北岸（x=1200）分出，向东北入「水柜」。 */
const WUZHANG_PTS: Pt[] = [
  [1200, riverBankZ(1200, -1) - 0.02], // 水口：主河北岸
  [1200, -64],                         // 穿临河铺面后的涵洞出水口
  [1300, -105],
  [1450, -138],
  [1650, -162],                        // 跨 x=1700 大路（桥）
  [1900, -178],
  [2150, -185],
  [2305, -182],                        // 入水柜（尾）
];

export const WATER_BRANCHES: WaterBranchSpec[] = [
  { id: 'water.branch.caihe', name: '蔡河', width: 20, pts: CAIHE_PTS },
  { id: 'water.branch.wuzhang', name: '五丈河', width: 15, pts: WUZHANG_PTS },
];

/** 金明池引水渠：从蔡河东岸（水缘 x=607）引水入湖，与渠水只相接不重叠（重叠面会闪烁） */
const FEED_PTS: Pt[] = [
  [607, 3480],
  [461, 3480],
];
const FEED_MOUTH: Pt = [607, 3480];

// ============ 岸线：池沼与湖 ============
export interface WaterBodySpec {
  id: string;
  name: string;
  kind: 'pond' | 'lake';
  x: number;
  z: number;
  /** 水面半径（米） */
  r: number;
  /** 12–16 边形不规则岸线 */
  sides: number;
  island?: { x: number; z: number; r: number };
  /** 跨水拱桥：x/z 为桥心，span 为跨度，width 为桥宽，rise 为拱高 */
  bridge?: { x: number; z: number; span: number; width: number; rise: number; yaw: number };
}

export const WATER_BODIES: WaterBodySpec[] = [
  // 水柜（五丈河尾闾，宋城真实蓄水库）：直径 110
  { id: 'water.pond.basin', name: '五丈河水柜', kind: 'pond', x: 2360, z: -182, r: 55, sides: 13 },
  // 河北岸带西段池沼：直径 100
  { id: 'water.pond.west', name: '凝碧池', kind: 'pond', x: -3000, z: -170, r: 50, sides: 16 },
  // 河北岸带东段池沼：直径 96
  { id: 'water.pond.east', name: '琼林小池', kind: 'pond', x: 3550, z: -180, r: 48, sides: 12 },
  // 南城空地池沼：直径 120
  { id: 'water.pond.south', name: '玉津池', kind: 'pond', x: -450, z: 3800, r: 60, sides: 15 },
  // 金明池：直径 230，岛 48，拱桥跨 34（桥跨沿南北跨引水渠，桥宽沿渠）
  {
    id: 'water.lake.jinming', name: '金明池', kind: 'lake', x: 350, z: 3450, r: 115, sides: 14,
    island: { x: 318, z: 3472, r: 24 },
    bridge: { x: 528, z: 3480, span: 34, width: 6, rise: 2.4, yaw: 0 },
  },
];

// ============ 几何小工具 ============
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 折线在 i 处的单位切向（前后点差分，端点用自身） */
function tangentAt(path: Pt[], i: number): [number, number] {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/** 折线上离给定点最近的采样下标（洞口朝向取用） */
function nearestIndex(path: Pt[], p: Pt): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - p[0], path[i][1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** 折线水面/水底条带（三角形朝 +y，water 组无 uv） */
function ribbonGeo(path: Pt[], halfW: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    const [tx, tz] = tangentAt(path, i);
    const nx = tz;
    const nz = -tx;
    left.push([path[i][0] + nx * halfW, path[i][1] + nz * halfW]);
    right.push([path[i][0] - nx * halfW, path[i][1] - nz * halfW]);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = left[i], b = right[i], c = right[i + 1], d = left[i + 1];
    pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    pos.push(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 不规则岸线（12–16 边）：角度与半径都抖，但首尾闭合由环本身保证 */
function ringOf(cx: number, cz: number, r: number, sides: number, rnd: () => number, wobble = 0.14): Pt[] {
  const out: Pt[] = [];
  const phase = rnd() * Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2 + (rnd() - 0.5) * 0.16;
    const rr = r * (1 - wobble * 0.5 + rnd() * wobble);
    out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return out;
}

/** 多边形扇面。环按角度递增生成，因此三角形取 (c, p[i+1], p[i]) 才朝 +y
 *  （机检：水面 3460 面全部朝上、0 退化；若改成 (c, p[i], p[i+1]) 会整片背面剔除、水面消失） */
function fanGeo(ring: Pt[], y: number): THREE.BufferGeometry {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    pos.push(cx, y, cz, q[0], y, q[1], p[0], y, p[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 沿折线砌石驳岸（两侧各一道，压在水缘外侧）；`hole` 处留出入口 */
function quayAlong(b: Baker, path: Pt[], halfW: number, thick: number, hex: number, hole?: Pt, holeR = 13): number {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const tx = dx / len, tz = dz / len;
    const nx = tz, nz = -tx;
    const ry = Math.atan2(-tz, tx);
    for (const s of [1, -1]) {
      const ox = (ax + bx) / 2 + nx * s * (halfW + thick / 2);
      const oz = (az + bz) / 2 + nz * s * (halfW + thick / 2);
      if (hole && Math.hypot(ox - hole[0], oz - hole[1]) < holeR) continue;
      b.box('ash', len + 0.45, QUAY_TOP - QUAY_BOT, thick, ox, (QUAY_TOP + QUAY_BOT) / 2, oz, hex, ry);
      n++;
    }
  }
  return n;
}

/** 沿闭合岸线砌石驳岸（池沼/湖/岛）；`hole` 处留出入口，水渠才不会被一道石墙横断 */
function quayRing(b: Baker, ring: Pt[], thick: number, top: number, bot: number, hex: number, hole?: Pt, holeR = 13): number {
  let n = 0;
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const tx = dx / len, tz = dz / len;
    let nx = tz, nz = -tx;
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
    if (hole && Math.hypot(mx - hole[0], mz - hole[1]) < holeR) continue;
    b.box('ash', len + 0.35, top - bot, thick, mx + nx * (thick / 2), (top + bot) / 2, mz + nz * (thick / 2), hex, Math.atan2(-tz, tx));
    n++;
  }
  return n;
}

/** 岸线在给定 z 上的极值 x（取水口定位用；side=-1 取西岸、+1 取东岸） */
function shoreX(ring: Pt[], z: number, side: 1 | -1): number {
  let best = side > 0 ? -Infinity : Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if ((p[1] - z) * (q[1] - z) > 0) continue;
    const t = (z - p[1]) / (q[1] - p[1] || 1e-9);
    const x = p[0] + (q[0] - p[0]) * t;
    if (side > 0 ? x > best : x < best) best = x;
  }
  return best;
}

/**
 * 箱体局部轴 → 世界方向。Baker.push 用 Euler(rx, ry, rz)，ry 单独作用时：
 * 局部 +x → (cos ry, 0, −sin ry)、局部 +z → (sin ry, 0, cos ry)。
 * 本文件一律以 `yaw = atan2(−tz, tx)` 传入（与 road/roof 同约定），于是下面两个常量就是
 * 「沿轴」与「跨轴」的真方向，不再靠手写正负号。
 */
function axes(yaw: number): { tx: number; tz: number; nx: number; nz: number } {
  return { tx: Math.cos(yaw), tz: -Math.sin(yaw), nx: Math.sin(yaw), nz: Math.cos(yaw) };
}

/** 石砌洞脸（水关/涵洞口）：两侧墩 + 过梁 + 压顶，水面从洞下穿过 */
function portal(b: Baker, x: number, z: number, yaw: number, halfW: number, hex: number): void {
  const { nx, nz } = axes(yaw);
  for (const sd of [1, -1]) {
    b.box('ash', 2.4, 3.0, 2.0, x + nx * sd * (halfW + 1.0), 1.5, z + nz * sd * (halfW + 1.0), hex, yaw);
  }
  b.box('ash', 2.4, 0.9, 2 * (halfW + 2.0), x, 2.45, z, shade(hex, 0.94), yaw);
  b.box('ash', 3.0, 0.26, 2 * (halfW + 2.7), x, 2.99, z, STONE_L, yaw);
  // 洞心暗背板：挡住穿视，读作涵洞纵深
  b.box('ash', 0.3, 1.5, 2 * halfW, x, 1.5, z, 0x2a3138, yaw);
  b.kit('water.culvert', 1, 1.5);
}

/** 大路跨渠石桥：桥面 1.36，两端踏步落回街面（街面 0.05，渠水 1.0） */
function roadBridge(b: Baker, x: number, z: number, yaw: number, halfW: number, roadLen: number): void {
  const { tx, tz, nx, nz } = axes(yaw);
  const along = Math.max(roadLen + 8, 22);   // 沿渠方向（= 街宽 + 余量）
  const across = 2 * halfW + 9;              // 跨渠方向
  b.box('ash', along, 0.34, across, x, 1.36, z, STONE, yaw);
  for (const sd of [1, -1]) {
    const px = x + tx * sd * (along / 2 - 0.21);
    const pz = z + tz * sd * (along / 2 - 0.21);
    b.box('ash', 0.42, 0.62, across, px, 1.67, pz, STONE_D, yaw);
    b.box('ash', 0.42, 0.16, across, px, 2.02, pz, STONE_L, yaw);
  }
  // 踏步：沿跨渠方向逐级落到街面
  for (const sd of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const off = across / 2 + 1.2 + k * 2.6;
      const top = 1.19 - k * 0.38;
      b.box('ash', along, top + 0.6, 2.6, x + nx * sd * off, (top - 0.6) / 2, z + nz * sd * off, k === 2 ? STONE_D : STONE, yaw);
    }
  }
  b.kit('water.branch.bridge', 1, 1.36);
}

/** 石拱桥（金明池引水渠口）：桥面按抛物线起拱，两侧栏板逐段跟随 */
function archBridge(b: Baker, x: number, z: number, yaw: number, span: number, width: number, rise: number): void {
  const { tx, tz, nx, nz } = axes(yaw);
  const N = 10;
  const seg = span / N;
  for (let i = 0; i < N; i++) {
    const t0 = -1 + (2 * i) / N;
    const t1 = -1 + (2 * (i + 1)) / N;
    const tm = (t0 + t1) / 2;
    const y = 1.14 + rise * (1 - tm * tm);
    const px = x + nx * tm * (span / 2);
    const pz = z + nz * tm * (span / 2);
    b.box('ash', width, 0.26, seg + 0.14, px, y - 0.13, pz, shade(STONE, 0.98 + i * 0.006), yaw);
    b.box('ash', width, 0.3, seg + 0.14, px, y - 0.4, pz, STONE_D, yaw); // 拱腹（下缘）
    for (const sd of [1, -1]) {
      const ox = px + tx * sd * (width / 2 - 0.15);
      const oz = pz + tz * sd * (width / 2 - 0.15);
      b.box('ash', 0.3, 0.46, seg + 0.1, ox, y + 0.3, oz, STONE_D, yaw);
      b.box('ash', 0.42, 0.1, seg + 0.1, ox, y + 0.55, oz, STONE_L, yaw);
    }
  }
  // 桥台
  for (const sd of [1, -1]) {
    b.box('ash', width + 1.6, 1.5, 3.2, x + nx * sd * (span / 2), 0.62, z + nz * sd * (span / 2), STONE_D, yaw);
  }
  b.kit('water.lake.bridge', 1, 1.14 + rise);
}

/** 每处水体一支稳定序列：岸线 / 汀石与构建顺序无关，`waterAudit` 能算出与画面上同一份环 */
function bodyRng(id: string): () => number {
  let s = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) s = Math.imul(s ^ id.charCodeAt(i), 16777619) >>> 0;
  const r = new RNG(s >>> 0);
  return () => r.next();
}

/** 池沼/湖水体：水底 + 水面 + 石驳岸。水底由同一环外扩，岸线才不会错位 */
function buildBody(b: Baker, spec: WaterBodySpec, ring: Pt[], hole?: Pt): void {
  const bed: Pt[] = ring.map((p) => [
    spec.x + (p[0] - spec.x) * ((spec.r + 1.1) / spec.r),
    spec.z + (p[1] - spec.z) * ((spec.r + 1.1) / spec.r),
  ]);
  b.addGeo('water', fanGeo(bed, BED_Y), 0, 0, 0, BED_HEX);
  b.addGeo('water', fanGeo(ring, WATER_Y), 0, 0, 0, WATER_HEX);
  b.kit('water.shore', quayRing(b, ring, 1.2, QUAY_TOP, QUAY_BOT, STONE, hole), QUAY_TOP);
}

/** 小岛：草地 + 石砌缘 + 三株柳 */
function buildIsland(b: Baker, x: number, z: number, r: number, rnd: () => number): void {
  const ring = ringOf(x, z, r, 12, rnd, 0.18);
  b.addGeo('ground', fanGeo(ring, 1.06), 0, 0, 0, GRASS);
  quayRing(b, ring, 0.9, 1.12, 0.72, STONE_D);
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r * (0.2 + rnd() * 0.45);
    const tx = x + Math.cos(a) * rr;
    const tz = z + Math.sin(a) * rr;
    const h = 2.6 + rnd() * 1.4;
    b.cyl('trunk', 0.13, 0.2, h, 5, tx, 1.06 + h / 2, tz, 0x4a3a26);
    b.sphere('leaf', 1.5 + rnd() * 0.5, 8, tx, 1.06 + h + 0.7, tz, 0x4e6b3a, 0, 0, 0, 1, 0.72, 1);
    b.sphere('leaf', 1.1 + rnd() * 0.4, 7, tx + 0.7, 1.06 + h + 0.2, tz + 0.5, 0x56743f, 0, 0, 0, 1, 0.66, 1);
  }
  b.kit('water.lake.island', 1, 1.06);
}

// ============ 净空复核（只读既有城市几何） ============
/**
 * 御街两厢里坊走廊（infill.ts WS-18 的保守外包框）：|x| 24–893 / |z| 230–2880。
 * 里坊本身是私有规划数据，这里用外包框复核，宁可判远也不判近。
 */
const COURT_BOX: [number, number, number, number] = [24, 893, 230, 2880];

function boxGap(x: number, z: number, b: readonly [number, number, number, number]): number {
  const dx = Math.max(Math.abs(x) - b[1], 0, b[0] - Math.abs(x));
  const dz = Math.max(Math.abs(z) - b[3], 0, b[2] - Math.abs(z));
  if (dx <= 0 && dz <= 0) return 0;
  return Math.hypot(dx, dz);
}

function wardGap(x: number, z: number): number {
  let g = Infinity;
  for (const cell of wardCells()) {
    const dx = Math.max(Math.abs(x - cell.cx) - cell.half, 0);
    const dz = Math.max(Math.abs(z - cell.cz) - cell.half, 0);
    const d = Math.hypot(dx, dz);
    if (d < g) g = d;
  }
  const cg = boxGap(x, z, COURT_BOX);
  if (cg < g) g = cg;
  return g;
}

function roadGap(x: number, z: number): number {
  if (!roadBlocked(x, z, 0)) return 60;
  for (let r = 2; r <= 60; r += 2) if (!roadBlocked(x, z, r)) return r;
  return 0;
}

/** 水体圆盘与建筑的最小间距（岸线采样）；落进 `wardReserved` 的手工地带按 0 计 */
function bodyGap(x: number, z: number, r: number): number {
  if (wardReserved(x, z)) return 0;
  let g = Infinity;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (wardReserved(px, pz)) return 0;
    const d = wardGap(px, pz);
    if (d < g) g = d;
  }
  const c = wardGap(x, z);
  return Math.min(g, c);
}

function inPalace(x: number, z: number, r: number): boolean {
  return x + r > PALACE.x0 && x - r < PALACE.x1 && z + r > PALACE.z0 && z - r < PALACE.z1;
}

/** 水体是否压到御街（|x|<26）或大路路面 */
function onStreet(x: number, z: number, r: number): boolean {
  if (Math.abs(x) - r < 26) return true;
  return roadBlocked(x, z, r);
}

// ============ 主构建 ============
/**
 * 建全部支渠/池沼/大湖。**只写 Baker，不动场景**；由 lead 在 world.ts 里接线。
 * `rng` 留在签名里只为与其它 builder 同形：本文件一个随机数都不取（岸线由水体 id 派生），
 * 所以新增这一步不会推进世界序列，下游取数逐值不变。
 */
export function buildWaterBranches(b: Baker, rng: RNG): void {
  // 每处水体的岸线先算出来：入水口要按真实岸线定位，渠尾不能停在乱数里
  const rings = new Map<string, Pt[]>();
  for (const spec of WATER_BODIES) rings.set(spec.id, ringOf(spec.x, spec.z, spec.r, spec.sides, bodyRng(spec.id)));
  const lake = WATER_BODIES.find((s) => s.id === 'water.lake.jinming') as WaterBodySpec;
  const basin = WATER_BODIES.find((s) => s.id === 'water.pond.basin') as WaterBodySpec;
  const lakeRing = rings.get(lake.id) as Pt[];
  const basinRing = rings.get(basin.id) as Pt[];
  // 渠尾收在岸线内侧 0.6m：水底比水面宽 1.1m，这点缝由暗色河床补上，不会露土
  const feedEndX = Math.min(shoreX(lakeRing, 3480, 1) - 0.6, 520);
  const wuTailX = shoreX(basinRing, -182, -1) - 0.6;

  // ---- 支渠 ----
  for (const br of WATER_BRANCHES) {
    const halfW = br.width / 2;
    const pts: Pt[] = br.pts.map((p) => [p[0], p[1]]);
    if (br.id.endsWith('wuzhang')) pts[pts.length - 1] = [wuTailX, pts[pts.length - 1][1]];
    const path = resample(pts, 8);
    b.addGeo('water', ribbonGeo(path, halfW + 1.0, BED_Y), 0, 0, 0, BED_HEX);
    b.addGeo('water', ribbonGeo(path, halfW, WATER_Y), 0, 0, 0, WATER_HEX);
    const quay = quayAlong(b, path, halfW, 1.2, br.id.endsWith('caihe') ? STONE : shade(STONE, 0.96),
      br.id.endsWith('caihe') ? FEED_MOUTH : undefined, 12);
    b.kit(br.id, 1, WATER_Y);
    b.kit('water.branch', 1, WATER_Y);
    b.kit('water.branch.quay', quay, QUAY_TOP);

    // 洞口三处：主河侧水口 → 穿临河铺面的涵洞出口 → 尾闾（蔡河出城墙 / 五丈河入水柜）
    const head = pts[0];
    const [hx, hz] = tangentAt(path, 0);
    portal(b, head[0], head[1] + (br.id.endsWith('caihe') ? 0.9 : -0.9), Math.atan2(-hz, hx) + Math.PI / 2, halfW, STONE_D);
    const [ex2, ez2] = tangentAt(path, nearestIndex(path, pts[1]));
    portal(b, pts[1][0], pts[1][1], Math.atan2(-ez2, ex2) + Math.PI / 2, halfW, STONE_D);
    if (br.id.endsWith('caihe')) {
      const tail = pts[pts.length - 1];
      const [tx2, tz2] = tangentAt(path, path.length - 1);
      portal(b, tail[0], tail[1], Math.atan2(-tz2, tx2) + Math.PI / 2, halfW, STONE_D);
    }

    // 跨大路石桥：按 roadBlocked 实测跨点，不靠坐标猜
    let run: Pt[] = [];
    let runStart = 0;
    const flush = (): void => {
      if (run.length === 0) return;
      const mid = run[Math.floor(run.length / 2)];
      const [tx, tz] = tangentAt(path, runStart + Math.floor(run.length / 2));
      roadBridge(b, mid[0], mid[1], Math.atan2(-tz, tx), halfW, Math.max(run.length * 8, 12));
      run = [];
    };
    for (let i = 0; i < path.length; i++) {
      if (roadBlocked(path[i][0], path[i][1], 0.5)) {
        if (run.length === 0) runStart = i;
        run.push(path[i]);
      } else flush();
    }
    flush();
  }

  // ---- 金明池引水渠（蔡河 → 湖） ----
  {
    const halfW = 7;
    const path = resample([[FEED_PTS[0][0], FEED_PTS[0][1]], [feedEndX, 3480]], 6);
    b.addGeo('water', ribbonGeo(path, halfW + 1.0, BED_Y), 0, 0, 0, BED_HEX);
    b.addGeo('water', ribbonGeo(path, halfW, WATER_Y), 0, 0, 0, WATER_HEX);
    quayAlong(b, path, halfW, 1.0, STONE);
    b.kit('water.branch.feed', 1, WATER_Y);
  }

  // ---- 池沼与湖 ----
  for (const spec of WATER_BODIES) {
    const ring = rings.get(spec.id) as Pt[];
    const hole: Pt | undefined = spec.id === lake.id
      ? [feedEndX, 3480]
      : spec.id === basin.id
        ? [wuTailX, -182]
        : undefined;
    buildBody(b, spec, ring, hole);
    b.kit(spec.id, 1, WATER_Y);
    b.kit(spec.kind === 'lake' ? 'water.lake' : 'water.pond', 1, WATER_Y);
    if (spec.island) buildIsland(b, spec.island.x, spec.island.z, spec.island.r, bodyRng(spec.id + ':isle'));
    if (spec.bridge) {
      const br = spec.bridge;
      archBridge(b, br.x, br.z, br.yaw, br.span, br.width, br.rise);
    }
    // 岸边补几块汀石，免得岸线读成一条光边
    const rr = bodyRng(spec.id + ':rock');
    const nRock = spec.kind === 'lake' ? 6 : 3;
    for (let i = 0; i < nRock; i++) {
      const p = ring[Math.floor(rr() * ring.length)];
      const a = rr() * Math.PI * 2;
      b.box('ash', 1.4 + rr() * 1.6, 0.5 + rr() * 0.5, 1.1 + rr() * 1.2,
        p[0] + Math.cos(a) * 1.2, 1.02, p[1] + Math.sin(a) * 1.2, STONE_D, rr() * Math.PI);
    }
  }
  void rng;
}

// ============ 机检出口 ============
export interface WaterAuditRow {
  id: string;
  kind: 'branch' | 'pond' | 'lake';
  /** 长度（支渠）或直径（水体） */
  size: number;
  width: number;
  head: [number, number];
  tail: [number, number];
  minBuildingGap: number;
  roadCrossings: number;
  inPalace: boolean;
  onStreet: boolean;
}

/** 交付给 lead / 探针的复核台账：全部按只读城市几何实时算 */
export function waterAudit(): { rows: WaterAuditRow[]; minGap: number; ok: boolean } {
  const rows: WaterAuditRow[] = [];
  for (const br of WATER_BRANCHES) {
    const halfW = br.width / 2;
    const path = resample(br.pts, 8);
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) len += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    let gap = Infinity;
    for (let i = 0; i < path.length; i++) {
      const [tx, tz] = tangentAt(path, i);
      for (const s of [0, 1, -1]) {
        const g = wardGap(path[i][0] + tz * s * (halfW + 1.2), path[i][1] - tx * s * (halfW + 1.2));
        if (g < gap) gap = g;
      }
    }
    let crossings = 0;
    let was = false;
    let hitsStreet = false;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const now = roadBlocked(p[0], p[1], 0.5);
      if (now && !was) crossings++;
      was = now;
      if (Math.abs(p[0]) - halfW < 26) hitsStreet = true; // 御街中线 |x|<26 不得进水
    }
    rows.push({
      id: br.id, kind: 'branch', size: Math.round(len), width: br.width,
      head: [br.pts[0][0], br.pts[0][1]], tail: [br.pts[br.pts.length - 1][0], br.pts[br.pts.length - 1][1]],
      minBuildingGap: Math.round(gap), roadCrossings: crossings,
      inPalace: br.pts.some((p) => inPalace(p[0], p[1], halfW)),
      onStreet: hitsStreet,
    });
  }
  for (const body of WATER_BODIES) {
    rows.push({
      id: body.id, kind: body.kind, size: body.r * 2, width: body.r * 2,
      head: [body.x, body.z], tail: [body.x, body.z],
      minBuildingGap: Math.round(bodyGap(body.x, body.z, body.r)),
      roadCrossings: 0,
      inPalace: inPalace(body.x, body.z, body.r),
      onStreet: onStreet(body.x, body.z, body.r),
    });
  }
  // 支渠穿城而过，与沿街建筑本来就贴边（蔡河走的是御街厢坊之间 8m 巷道），
  // 故 ≥8m 的判据只对池沼/湖成立；支渠另给 roadCrossings（跨街都要有桥）。
  const flats = rows.filter((r) => r.kind !== 'branch');
  const minGap = Math.min(...flats.map((r) => r.minBuildingGap));
  const ok = rows.every((r) => !r.inPalace && !r.onStreet) && flats.every((r) => r.minBuildingGap >= 8);
  return { rows, minGap, ok };
}

/** 供探针使用：某点是否落在任意水体水面内（含支渠带宽） */
export function waterAt(x: number, z: number): string | null {
  for (const body of WATER_BODIES) {
    const d = Math.hypot(x - body.x, z - body.z);
    if (d <= body.r) return body.id;
  }
  for (const br of WATER_BRANCHES) {
    const halfW = br.width / 2;
    const path = resample(br.pts, 6);
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= halfW) return br.id;
    }
  }
  return null;
}
