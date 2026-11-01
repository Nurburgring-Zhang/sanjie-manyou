import { Baker, SignAtlas, SignMesher, shade } from './bake';
import { roadBlocked } from './imperial';
import type { RNG } from '../core/rng';

/**
 * R15-B · 中央保留带填实（御街两厢商业带）
 *
 * 判词（用户原话）：「皇宫主道两边还是没有河边两岸的那种繁华商业楼！！」
 * 现场（对源核对，不猜）：
 *   · 御街路面 |x|<13（imperial.ts 铺 26m 宽路面，顶 0.14），两侧朱雀廊柱 |x|=16；
 *   · 宫前商业街（R5，buildPalaceFrontStreet）已占 |x| 19–32、z −2820…−2300；
 *   · 御街两厢里坊（WS-18，infill.ts 的 courtWards）占 |x| 32–886、z 230…2880，
 *     与 infill.ts 的御街廊庑/石灯/行道树（|x| ≤ 17.2）之间正好夹着 24–32 的裸土地带；
 *   · 临河手工段（河岸铺面 + 桥东广场摊位到 x=48）占 |z| < 210，取 |z| < 305 整段让开（河道与桥面归 R15-A）；
 *   · 横街（imperial.ts ROAD_LINES = 900/1700/2500/3300）是折线、每段横向游走 ±36–40m，
 *     固定让位会在每个路口挖出 100m 空段，故铺面位置逐间调 imperial.roadBlocked 判位、贴路缘收边。
 * 结论：真正空着的是**宫前主道那 2.6km**（z −2900…−305）以及里坊南界外 120m；
 *       里坊段只剩 24–32 的 8m 空档（坊墙在 |x|=32），只能补「临街铺面带」而不是整排铺面。
 *
 * 做法：每侧两排铺面（临街排 + 后巷排），后巷排与临街排隔 3–4m 巷道并沿 z 错缝 30–60%；
 * 其余面积补值房/仓库 8 间、小院 6 处、行道树每 12m 一株、水井 6 口、牌坊 4 座。
 * 位置全部走坐标 hash（与 riverbank.ts 同式），**一次都不消耗共享 rng**，
 * 因此下游 buildPavement / 树木 / 摊位拿到的随机序列逐值不变。
 */

// ============ 坐标 hash（不消耗 RNG） ============
const H = (a: number, c: number): number => {
  const v = Math.sin(a * 12.9898 + c * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const pick = <T,>(arr: readonly T[], t: number): T => arr[Math.min(arr.length - 1, Math.max(0, (t * arr.length) | 0))];

// ============ 空间骨架 ============
/** 午门前 50m（宫墙在 z=−2950）到南端探针线 */
const Z_NORTH = -2900;
const Z_SOUTH = 3000;
/** 临河手工段半长：河岸铺面到 |z|≈54、桥东广场摊位到 |z|=300，取 305 整段让开 */
const RIVER_PAD = 305;
/** 覆盖带（两排铺面的实际走廊）：临街前脸 26m 起，后巷排后墙最深 63m */
const BAND_IN = 26;
const BAND_OUT = 64;
/** 里坊段只在坊墙外 26.2–31.4 的铺面带里落房，带内面积按 26…32.2 计 */
const COURT_BAND_OUT = 32.2;
/** 宫前商业街（R5）已建临街排的 z 区间：不重复建第一排，只补后巷排 */
const R5_Z0 = -2825;
const R5_Z1 = -2295;
/** 里坊开始建坊的 z（infill.ts COURT_Z0）：此段之后 |x|≥32 已被 WS-18 占满 */
const COURT_Z0 = 230;

const KIND_OPEN = 0;   // 两排全建
const KIND_R5 = 1;     // 临街排已有（R5），只补后巷排
const KIND_COURT = 2;  // 里坊段：只补 26.2–31.4 的临街铺面带

interface Run { z0: number; z1: number; kind: number }

const RUNS: readonly Run[] = [
  { z0: Z_NORTH, z1: R5_Z0, kind: KIND_OPEN },
  { z0: R5_Z0, z1: R5_Z1, kind: KIND_R5 },
  { z0: R5_Z1, z1: -RIVER_PAD, kind: KIND_OPEN },
  { z0: RIVER_PAD, z1: 2880, kind: KIND_COURT },
  { z0: 2880, z1: Z_SOUTH, kind: KIND_OPEN },
];

/** 牌坊 z：避开既有 御街牌坊 z=240 / 宣德門前 z=−2350 / R5 街口 −2790·−2340 / avenue 780·1380·1980·2580 */
const PAIFANG_Z = [-2620, -1830, -800, 2930] as const;
const PAIFANG_NAME: Record<number, string> = { [-2620]: '天街南口', [-1830]: '宣德街', [-800]: '朱雀門', [2930]: '御街南口' };

// ============ 色板（与 riverbank / palaceShop 同档，避免整条街只有两种颜色） ============
const WALL_TONES = [0x8d7d69, 0x9a8a72, 0x7f7160, 0x91836f, 0x9a7f68, 0x87796a];
const ROOF_TONES = [0x333a45, 0x2a2f36, 0x463830, 0x36463e, 0x3d4450];
const FLAG_TONES = [0x9d2933, 0x2a5c42, 0xa87a2a, 0x5c1b24, 0x24483a, 0x3a3448];
const WOOD_DARK = 0x4a3220;
const WOOD_RED = 0xa63a2b;
const STONE_C = 0x8f8878;
const EARTH_WALL = 0x9a8c74;

/** 匾额用固定 24 个行名：图集按 key 去重，500+ 间铺面只占 24 格，不会把 6144 图集撑爆 */
const SHOP_NAMES = [
  '香藥鋪', '絹帛莊', '茶坊', '酒樓', '果子行', '湯餅店', '書坊', '藥鋪',
  '米行', '靴店', '扇莊', '瓷器鋪', '漆器行', '胭脂鋪', '金銀鋪', '珠翠行',
  '紙馬鋪', '鐵器鋪', '油坊', '肉市', '布帛鋪', '蜜煎局', '香燭鋪', '筆墨莊',
] as const;

// ============ 铺面规划（纯计算，build 与 metrics 共用同一份） ============
interface Shop {
  sx: number;       // +1 东侧 / −1 西侧
  face: number;     // 临街面到中轴的距离（m，正值）
  depth: number;    // 进深
  w: number;        // 面阔
  z0: number;
  z1: number;
  floors: number;
  salt: number;
}

/** 在 [z0,z1] 内找第一处压到横街的 z（1m 步进 + 0.25m 二分细化），无则 −1。
 *  位置判定交给 imperial.ts 的 roadBlocked：自己按 ±52m 粗口径让开，会在每个路口留下 100m 空段
 *  （SPEC 判据「不得出现 >40m 无建筑裸铺装」直接不过）；横街是折线（每段横向游走 ±36–40），
 *  只有按真实线段判位，才能让铺面贴着路口收边而不是整间跳走。 */
const FIRST_STEP = 1;
const ROAD_PAD = 1.5;
function firstRoad(sx: number, face: number, depth: number, z0: number, z1: number): number {
  const x = sx * (face + depth / 2);
  for (let z = z0; z <= z1 + 1e-3; z += FIRST_STEP) {
    if (!roadBlocked(x, z, ROAD_PAD)) continue;
    let a = Math.max(z0, z - FIRST_STEP);
    let b = z;
    for (let i = 0; i < 4; i++) {
      const m = (a + b) / 2;
      if (roadBlocked(x, m, ROAD_PAD)) b = m; else a = m;
    }
    return b;
  }
  return -1;
}

/** 从 z 起扫过整段路口，返回对岸（路口外）的第一点 */
function pastRoad(sx: number, face: number, depth: number, z: number, zEnd: number): number {
  const x = sx * (face + depth / 2);
  let zz = z;
  while (zz < zEnd && roadBlocked(x, zz, ROAD_PAD)) zz += FIRST_STEP;
  return zz;
}

/** 行道树同理（树池 3.2m 见方，留 0.5m 余量） */
const treeHitsRoad = (x: number, z: number): boolean => roadBlocked(x, z, 2.2);

/** 临街排：面阔 8–20、进深 10–14、间距 1.5–4、1–2 层；里坊段压成 5.2m 铺面带 */
function row1Mods(r: Run, sx: number): Shop[] {
  const salt = 1000 + r.kind * 311 + (sx > 0 ? 13 : 71) + Math.round(r.z0);
  const out: Shop[] = [];
  let z = r.z0;
  while (z < r.z1 - 8) {
    const w = Math.min(8 + H(z * 0.0173, salt + 1) * 12, r.z1 - z);
    const gap = 1.5 + H(z * 0.0239, salt + 2) * 2.5;
    const face = r.kind === KIND_COURT ? 26.2 : 27 + H(z * 0.0121, salt + 3) * 2;
    const depth = r.kind === KIND_COURT ? 5.2 : 11 + H(z * 0.0131, salt + 4) * 3;
    const floors = r.kind === KIND_COURT ? 1 : H(z * 0.0301, salt + 5) > 0.62 ? 2 : 1;
    const rd = firstRoad(sx, face, depth, z, z + w);
    if (rd >= 0) {
      // 路口收边：临街那间压到路缘停下（≥8m 才留），然后跳到路口对岸续铺
      const cut = rd - 0.8;
      if (cut - z >= 8) out.push({ sx, face, depth, w: cut - z, z0: z, z1: cut, floors, salt: salt + Math.round(z) });
      z = pastRoad(sx, face, depth, rd, r.z1) + 0.8;
      continue;
    }
    out.push({ sx, face, depth, w, z0: z, z1: z + w, floors, salt: salt + Math.round(z) });
    z += w + gap;
  }
  return out;
}

/** 后巷排：进深 12–16，与临街排隔 3–4m 巷道，起点按首间面阔的 30–60% 错缝 */
function row2Mods(r: Run, sx: number, r1: Shop[]): Shop[] {
  const out: Shop[] = [];
  const salt = 3000 + (sx > 0 ? 29 : 53) + Math.round(r.z0);
  const anchor = r1[0];
  const stagger = 0.3 + H(r.z0 * 0.0071, salt) * 0.3;   // 30–60%
  let z = r.z0 + stagger * (anchor ? anchor.w : 12);
  while (z < r.z1 - 8) {
    const w = Math.min(8 + H(z * 0.0201, salt + 1) * 12, r.z1 - z);
    const gap = 1.5 + H(z * 0.0227, salt + 2) * 2.5;
    const depth = 13 + H(z * 0.0151, salt + 3) * 3;
    const lane = 3 + H(z * 0.0277, salt + 4);
    const host = hostShop(r1, z + w / 2);
    const face = (host ? host.face + host.depth : 27 + 12) + lane;
    const rd = firstRoad(sx, face, depth, z, z + w);
    if (rd >= 0) {
      const cut = rd - 0.8;
      if (cut - z >= 8) out.push({ sx, face, depth, w: cut - z, z0: z, z1: cut, floors: H(z * 0.0311, salt + 5) > 0.78 ? 2 : 1, salt: salt + Math.round(z) });
      z = pastRoad(sx, face, depth, rd, r.z1) + 0.8;
      continue;
    }
    out.push({ sx, face, depth, w, z0: z, z1: z + w, floors: H(z * 0.0311, salt + 5) > 0.78 ? 2 : 1, salt: salt + Math.round(z) });
    z += w + gap;
  }
  return out;
}

/** 后巷排的巷道基准：取该 z 所在的临街排铺面；落在夹道里就取最近一间 */
function hostShop(list: Shop[], zc: number): Shop | null {
  let best: Shop | null = null;
  let bd = Infinity;
  for (const m of list) {
    if (zc >= m.z0 && zc <= m.z1) return m;
    const d = zc < m.z0 ? m.z0 - zc : zc - m.z1;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

interface RowPlan { run: Run; sx: number; mods: Shop[] }
interface BeltPlan { row1: RowPlan[]; row2: RowPlan[]; stagger: number }

function planBelt(): BeltPlan {
  const row1: RowPlan[] = [];
  const row2: RowPlan[] = [];
  let stag = 0;
  let stagN = 0;
  for (const sx of [-1, 1] as const) {
    for (const r of RUNS) {
      const m1 = row1Mods(r, sx);
      row1.push({ run: r, sx, mods: m1 });
      if (r.kind !== KIND_COURT && m1.length > 0) {
        const m2 = row2Mods(r, sx, m1);
        row2.push({ run: r, sx, mods: m2 });
        if (m2.length > 0) { stag += (m2[0].z0 - r.z0) / m1[0].w; stagN++; }
      }
    }
  }
  return { row1, row2, stagger: stagN > 0 ? stag / stagN : 0 };
}

// ============ 临街铺面 ============
function frontShop(b: Baker, sg: SignMesher, atlas: SignAtlas, m: Shop, kit: string): void {
  const { sx, face, depth: d, w } = m;
  const zc = (m.z0 + m.z1) / 2;
  const cx = sx * (face + d / 2);
  const t = H(m.z0 * 0.0071, m.salt);
  const wallC = pick(WALL_TONES, H(m.z0 * 0.0073, m.salt + 7));
  const roofC = pick(ROOF_TONES, H(m.z0 * 0.0111, m.salt + 9));
  const flagC = pick(FLAG_TONES, H(m.z0 * 0.0137, m.salt + 11));
  const h = m.floors === 2 ? 6.2 + t * 1.6 : 3.7 + t * 1.1;
  // 台基
  b.box('ash', d + 0.9, 0.36, w + 0.7, cx, 0.18, zc, shade(wallC, 0.82));
  // 墙身
  b.box('wall', d, h, w, cx, 0.36 + h / 2, zc, wallC);
  // 勒脚（外贴 0.1m，避免与墙面共面闪烁）
  b.box('wall', 0.1, 0.55, w * 0.99, sx * (face - 0.03), 0.64, zc, shade(wallC, 0.72));
  // 檐柱：压在屋顶投影内，读作前檐廊
  const nCol = Math.max(2, Math.min(5, Math.round(w / 3.6)));
  for (let k = 0; k < nCol; k++) {
    const pz = zc + ((k + 0.5) / nCol - 0.5) * (w - 1.1);
    b.box('wood', 0.26, h - 0.55, 0.26, sx * (face + 0.24), 0.36 + (h - 0.55) / 2, pz, WOOD_DARK);
  }
  // 额头枋（柱列上沿）
  b.box('wood', 0.3, 0.26, w - 0.5, sx * (face + 0.24), 0.36 + h - 0.5, zc, shade(WOOD_RED, 0.82));
  // 板门 + 两扇窗（临街面）
  b.box('wood', 0.16, 2.3, Math.min(w * 0.4, 4.6), sx * (face - 0.08), 1.5, zc + w * 0.05, 0x3a2418);
  for (const s2 of [-1, 1]) {
    b.box('glow', 0.1, 1.3, Math.min(w * 0.17, 2.2), sx * (face - 0.06), 1.95, zc + s2 * w * 0.3, 0xffd8a0);
  }
  // 台阶
  b.box('ash', 0.9, 0.2, Math.min(w * 0.5, 4), sx * (face - 0.45), 0.1, zc + w * 0.05, shade(wallC, 0.9));
  // 匾额（图集按 key 去重：24 个行名 × 一种字号 = 24 格）
  const ni = (H(m.z0 * 0.0051, m.salt + 21) * SHOP_NAMES.length) | 0;
  const bw = Math.min(w * 0.52, 3.2);
  sg.quad(
    atlas.text('belt_' + ni, SHOP_NAMES[ni], 240, 72, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.9)', border: 'rgba(255,179,0,.75)', fontPx: 46 }),
    bw, bw * 0.3, sx * (face - 0.14), 0.36 + h * 0.74, zc, sx > 0 ? -Math.PI / 2 : Math.PI / 2,
  );
  // 幌子：一根挑杆 + 布幌（挑向街心）
  const pz2 = zc + w * 0.42;
  b.box('wood', 0.1, 2.6, 0.1, sx * (face - 0.5), 2.4, pz2, WOOD_DARK);
  b.box('fabric', 0.9, 1.0, 0.06, sx * (face - 0.95), 2.7, pz2, flagC);
  // 檐下灯
  b.box('glow', 0.26, 0.34, 0.26, sx * (face - 0.32), 0.36 + h - 0.42, zc - w * 0.32, 0xffb84a);
  // 二层挑台
  if (m.floors === 2) {
    b.box('wood', 1.0, 0.16, w * 0.9, sx * (face - 0.45), 3.95, zc, shade(0x6b4a2b, 1.05));
    for (let k = 0; k < 4; k++) {
      b.box('wood', 0.09, 0.6, 0.09, sx * (face - 0.9), 4.3, zc - w * 0.36 + k * w * 0.24, WOOD_DARK);
    }
    for (let k = 0; k < 2; k++) {
      b.box('glow', 0.1, 1.4, 2.0, sx * (face - 0.02), 5.3, zc - w * 0.2 + k * w * 0.4, 0xffc66e);
    }
  }
  // 曲面反宇顶：脊沿 z（ry=π/2 把单元的长轴转到 z）。
  // 不开瓦垄顶点色条纹：0.34m 垄距是给 30m+ 地标用的，15m 街屋会从 216 面涨到 ~2300 面/顶
  // （bake.ts 的 roofC 注释同此口径，里坊 1700 顶民居走的也是 9 列贴图档）。
  const rh = (d < 7 ? 0.8 + w * 0.03 : 1.1 + w * 0.05);
  b.roofC('roof', cx, 0.36 + h, zc, roofC, Math.PI / 2, (w + 0.5) * 1.02, rh, d * 1.04);
  b.kit(kit, 1, h);
}

// ============ 后巷排（省几何：两坡斜板 + 正脊，不开曲面单元） ============
function backShop(b: Baker, m: Shop, kit: string): void {
  const { sx, face, depth: d, w } = m;
  const zc = (m.z0 + m.z1) / 2;
  const cx = sx * (face + d / 2);
  const t = H(m.z0 * 0.0081, m.salt);
  const wallC = pick(WALL_TONES, H(m.z0 * 0.0083, m.salt + 13));
  const roofC = pick(ROOF_TONES, H(m.z0 * 0.0097, m.salt + 17));
  const h = m.floors === 2 ? 5.6 + t * 1.2 : 3.4 + t * 1.2;
  b.box('ash', d + 0.8, 0.34, w + 0.6, cx, 0.17, zc, shade(wallC, 0.8));
  b.box('wall', d, h, w, cx, 0.34 + h / 2, zc, wallC);
  // 双坡顶：两块斜板绕 z 倾；板长取 hypot(半进深, 举高)，两端正好落在脊与檐
  const rh = 1.0 + w * 0.045;
  const L = Math.hypot(d / 2, rh);
  const th = Math.atan2(rh, d / 2);
  for (const rs of [-1, 1] as const) {
    b.box('roof', L * 1.02, 0.18, w + 0.8, cx + (rs * d) / 4, 0.34 + h + rh / 2, zc, roofC, 0, 0, -rs * th);
  }
  b.box('roof', 0.4, 0.22, w + 0.9, cx, 0.34 + h + rh, zc, shade(roofC, 1.26));
  // 板门（朝巷道/街心）+ 一扇窗
  b.box('wood', 0.14, 2.1, Math.min(w * 0.36, 4), sx * (face - 0.07), 1.4, zc - w * 0.12, 0x3a2418);
  b.box('glow', 0.09, 1.1, Math.min(w * 0.16, 2), sx * (face - 0.05), 1.75, zc + w * 0.28, 0xffd0a0);
  // 后门檐灯（半数）
  if (H(m.z0 * 0.0179, m.salt + 19) > 0.45) {
    b.box('glow', 0.22, 0.3, 0.22, sx * (face - 0.28), 0.34 + h - 0.35, zc + w * 0.38, 0xffb84a);
  }
  b.kit(kit, 1, h);
}

// ============ 值房 / 仓库（6×10m，带院墙） ============
function dutyHouse(b: Baker, x: number, z: number): void {
  const sx = x > 0 ? 1 : -1;
  const salt = Math.round(x) * 7 + Math.round(z);
  const wallC = pick(WALL_TONES, H(z * 0.0091, salt));
  const roofC = pick(ROOF_TONES, H(z * 0.0107, salt + 3));
  const HX = 10;
  const HZ = 9;
  const wallH = 2.1;
  const T = 0.5;
  // 院墙：朝街一面留 4m 门洞（两段），其余三面整段，顶压瓦
  const gate = 4;
  const seg = (HZ * 2 - gate) / 2;
  const sides: [number, number, number, number][] = [
    [x - sx * HX, z - (gate / 2 + seg / 2), T, seg],
    [x - sx * HX, z + (gate / 2 + seg / 2), T, seg],
    [x + sx * HX, z, T, HZ * 2],
  ];
  for (const [px, pz, ww, dd] of sides) {
    b.box('earth', ww, wallH, dd, px, wallH / 2, pz, EARTH_WALL);
    b.box('roof', ww + 0.24, 0.16, dd + 0.24, px, wallH + 0.08, pz, shade(0x6c7382, 0.95));
  }
  for (const pz of [z - HZ, z + HZ]) {
    b.box('earth', HX * 2, wallH, T, x, wallH / 2, pz, EARTH_WALL);
    b.box('roof', HX * 2 + 0.24, 0.16, T + 0.24, x, wallH + 0.08, pz, shade(0x6c7382, 0.95));
  }
  // 正房 6×10（脊沿 z）
  const bh = 3.6;
  b.box('ash', 7, 0.36, 11, x, 0.18, z, STONE_C);
  b.box('wall', 6, bh, 10, x, 0.36 + bh / 2, z, wallC);
  b.roofC('roof', x, 0.36 + bh, z, roofC, Math.PI / 2, 10.4, 1.3, 6.3);
  b.box('wood', 0.14, 2.2, 3.0, x - sx * 3.05, 1.5, z - 2.0, 0x3a2418);
  b.box('glow', 0.1, 0.9, 1.2, x - sx * 3.0, 2.9, z + 2.6, 0xffc66e);
  // 门前货堆（仓库语义）
  for (let k = 0; k < 3; k++) {
    const ox = x - sx * (5.4 + (k % 2) * 1.4);
    const oz = z + 4.6 + k * 1.5;
    b.box('wood', 1.3, 1.0 + (k % 2) * 0.4, 1.3, ox, 0.5 + (k % 2) * 0.2, oz, shade(0x6b4a2b, 0.9 + k * 0.05));
  }
  b.kit('belt.duty', 1, 0.36 + bh);
}

// ============ 小院（院墙 + 正房 + 树） ============
function smallYard(b: Baker, x: number, z: number): void {
  const sx = x > 0 ? 1 : -1;
  const salt = Math.round(x) * 11 + Math.round(z);
  const wallC = pick(WALL_TONES, H(z * 0.0083, salt + 5));
  const roofC = pick(ROOF_TONES, H(z * 0.0099, salt + 7));
  const HX = 8;
  const HZ = 8;
  const wallH = 2.0;
  const T = 0.45;
  const gate = 3.4;
  const seg = (HZ * 2 - gate) / 2;
  const sides: [number, number, number, number][] = [
    [x - sx * HX, z - (gate / 2 + seg / 2), T, seg],
    [x - sx * HX, z + (gate / 2 + seg / 2), T, seg],
    [x + sx * HX, z, T, HZ * 2],
  ];
  for (const [px, pz, ww, dd] of sides) {
    b.box('earth', ww, wallH, dd, px, wallH / 2, pz, shade(EARTH_WALL, 1.04));
    b.box('roof', ww + 0.22, 0.15, dd + 0.22, px, wallH + 0.07, pz, shade(0x6c7382, 1.0));
  }
  for (const pz of [z - HZ, z + HZ]) {
    b.box('earth', HX * 2, wallH, T, x, wallH / 2, pz, shade(EARTH_WALL, 1.04));
    b.box('roof', HX * 2 + 0.22, 0.15, T + 0.22, x, wallH + 0.07, pz, shade(0x6c7382, 1.0));
  }
  // 正房 9×6，落在院子靠里的三分之二处（院心留空种树）
  const bx = x + sx * 2.6;
  const bh = 3.8;
  b.box('ash', 10, 0.4, 7, bx, 0.2, z, STONE_C);
  b.box('wall', 9, bh, 6, bx, 0.4 + bh / 2, z, wallC);
  b.roofC('roof', bx, 0.4 + bh, z, roofC, 0, 9.4, 1.25, 6.4);
  b.box('wood', 0.14, 2.2, 2.6, bx - sx * 4.55, 1.5, z, 0x3a2418);
  b.box('glow', 0.1, 1.2, 1.6, bx - sx * 4.5, 2.4, z + 2.4, 0xffc66e);
  // 院树
  const tz = z - 2.4;
  const tx = x - sx * 1.8;
  const th = 3.0 + H(z * 0.0131, salt + 9) * 1.1;
  b.cyl('trunk', 0.14, 0.22, th, 6, tx, th / 2, tz, 0x574530);
  b.sphere('leaf', 1.5, 7, tx, th + 0.8, tz, shade(0x3f6a3c, 0.92), 0, 0, 0, 1, 0.88, 1);
  b.sphere('leaf', 0.95, 6, tx + 0.8, th + 1.5, tz - 0.5, shade(0x466f3e, 1.0));
  b.kit('belt.yard', 1, 0.4 + bh);
}

// ============ 水井 ============
function well(b: Baker, x: number, z: number): void {
  b.cyl('ash', 0.95, 1.05, 0.34, 12, x, 0.17, z, STONE_C);
  b.cyl('ash', 0.7, 0.74, 0.62, 12, x, 0.62, z, 0x7a7364);
  b.cyl('water', 0.58, 0.58, 0.08, 12, x, 0.9, z, 0x14212a);
  for (const s of [-1, 1]) b.box('wood', 0.14, 1.9, 0.14, x + s * 0.9, 1.35, z, 0x4a3826);
  b.box('wood', 2.1, 0.16, 0.16, x, 2.3, z, 0x4a3826);
  b.cyl('wood', 0.09, 0.09, 1.6, 6, x, 2.16, z, 0x5a4630, 0, 0, Math.PI / 2);
  b.cyl('wood', 0.2, 0.26, 0.32, 8, x, 1.5, z, 0x6b4a2b);
  b.box('ash', 1.9, 0.05, 1.9, x, 0.02, z, shade(STONE_C, 0.92));
  b.kit('belt.well', 1, 0.34);
}

// ============ 牌坊（跨街 4 柱 3 间，比 architecture.buildPaifang 的 8.6m 单间更贴 26m 御街） ============
function paifang(b: Baker, sg: SignMesher, atlas: SignAtlas, z: number, name: string, key: string, neon: number): void {
  const PX = [14.4, 5.6];
  for (const s of [-1, 1] as const) {
    for (const px of PX) {
      const x = s * px;
      b.box('ash', 1.3, 0.7, 1.3, x, 0.35, z, STONE_C);
      b.cyl('wood', 0.34, 0.42, 7.2, 8, x, 0.7 + 3.6, z, WOOD_RED);
      b.box('wood', 0.2, 0.5, 0.2, x, 0.72, z, shade(WOOD_RED, 0.7));
    }
  }
  // 小额枋（次间）+ 主额枋（明间）+ 花板
  for (const s of [-1, 1] as const) b.box('wood', 8.4, 0.5, 0.6, s * 9.9, 5.9, z, shade(WOOD_RED, 0.96));
  b.box('wood', 30.2, 0.55, 0.7, 0, 6.6, z, shade(WOOD_RED, 0.92));
  b.box('wood', 12.6, 0.85, 0.42, 0, 7.5, z, 0x2a4a3a);
  // 主楼顶（脊沿 x）+ 两侧次楼顶
  b.roofC('roof', 0, 7.95, z, 0x3a4450, 0, 15.8, 1.9, 3.0);
  for (const s of [-1, 1] as const) b.roofC('roof', s * 10.6, 6.45, z, 0x33404a, 0, 8.2, 1.2, 2.5);
  b.box('glow', 15.2, 0.12, 0.12, 0, 7.2, z + 0.1, neon);
  // 匾（正面 +z，背面由 SignMesher 的镜像 UV 负责）
  sg.quad(
    atlas.text(key, name, 320, 84, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.9)', border: 'rgba(255,179,0,.8)', fontPx: 56 }),
    5.0, 1.3, 0, 7.5, z + 0.26, 0,
  );
  b.kit('belt.paifang', 1, 9.4);
}

// ============ 行道树（球冠 + 锥台干，不用圆锥） ============
function streetTree(b: Baker, x: number, z: number): void {
  const salt = Math.round(z);
  const th = 3.3 + H(z * 0.0141, salt) * 1.3;
  b.cyl('trunk', 0.16, 0.26, th, 6, x, th / 2, z, 0x574530);
  const r = 1.5 + H(z * 0.0193, salt + 2) * 0.6;
  const base = shade(0x3f6a3c, 0.9 + H(z * 0.0167, salt + 4) * 0.22);
  b.sphere('leaf', r, 7, x, th + r * 0.5, z, base, 0, 0, 0, 1, 0.84, 1);
  b.sphere('leaf', r * 0.68, 6, x + 0.85, th + r * 0.95, z - 0.55, shade(base, 1.06));
  b.sphere('leaf', r * 0.58, 6, x - 0.7, th + r * 0.8, z + 0.6, shade(base, 0.94));
  // 树池
  b.box('ash', 1.9, 0.12, 1.9, x, 0.06, z, shade(STONE_C, 0.9));
  b.kit('belt.tree', 1, th);
}

// ============ 站点表（纯数据；探针与报告直接读，不经画面） ============
const DUTY_SITES: readonly [number, number][] = [
  [88, -2665], [-92, -2355], [95, -2045], [-87, -1735],
  [93, -1425], [-98, -1115], [90, -805], [-94, -495],
];
const YARD_SITES: readonly [number, number][] = [
  [108, -2850], [-110, -2510], [106, -2190],
  [-104, -1880], [112, -1570], [-108, -1260],
];
const WELL_SITES: readonly [number, number][] = [
  [68.5, -2600], [-68.5, -2280], [68.5, -1960],
  [-68.5, -1640], [68.5, -1320], [-68.5, -1000],
];

/** 行道树落点：主道 2.6km + 里坊南界外 120m，两侧每 12m 一株 */
export function centralBeltTreeSites(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const sx of [-1, 1] as const) {
    for (const [a, b] of [[Z_NORTH + 6, -RIVER_PAD], [2880, Z_SOUTH]] as const) {
      for (let z = a; z < b; z += 12) {
        if (z > R5_Z0 && z < R5_Z1) continue;                       // 宫前商业街铺面压着这条线
        if (PAIFANG_Z.some((p) => Math.abs(p - z) < 8)) continue;   // 让开牌坊柱
        if (treeHitsRoad(sx * 21.5, z)) continue;
        out.push({ x: sx * 21.5, z });
      }
    }
  }
  return out;
}

/** 覆盖带：两排铺面走廊 |x| ∈ [26,64]（里坊段取 [26, 32.2]），分母为各段带面积 */
function bandOf(kind: number): [number, number] {
  return [BAND_IN, kind === KIND_COURT ? COURT_BAND_OUT : BAND_OUT];
}

/** 矩形在带内的投影面积（轴对齐，铺面全部轴向摆放，无需多边形裁剪） */
function areaInBand(m: Shop, kind: number): number {
  const [lo, hi] = bandOf(kind);
  const a = Math.max(lo, m.face);
  const b = Math.min(hi, m.face + m.depth);
  return Math.max(0, b - a) * m.w;
}

export interface BeltMetrics {
  shopsRow1: number;
  shopsRow2: number;
  shopsCourtFront: number;
  duty: number;
  yards: number;
  wells: number;
  paifang: number;
  trees: number;
  stagger: number;
  /** 宫前主道 + 南端尾段：两排铺面走廊覆盖率（0–1） */
  coverageOpen: number;
  /** 里坊段 6m 铺面带覆盖率（0–1） */
  coverageCourt: number;
  /** 实测尺寸区间（min/max，m）：面阔 w / 间距 gap / 进深 depth / 巷道 lane。
   *  row1 与 row1court 分开：里坊段受 WS-18 里坊限制只能做 5.2m 铺面带，不能与主道铺面混算区间。 */
  spans: {
    row1: { w: [number, number]; gap: [number, number]; depth: [number, number] };
    row1court: { w: [number, number]; gap: [number, number]; depth: [number, number] };
    row2: { w: [number, number]; gap: [number, number]; depth: [number, number]; lane: [number, number] };
  };
  runs: { z0: number; z1: number; kind: number; row1: number; row2: number }[];
}

const grow = (r: [number, number], v: number): void => {
  if (v < r[0]) r[0] = v;
  if (v > r[1]) r[1] = v;
};

/** 纯计算：与 buildCentralBelt 共用同一份规划，供报告与探针取数（不碰几何） */
export function beltMetrics(): BeltMetrics {
  return metricsOf(planBelt());
}

function metricsOf(plan: BeltPlan): BeltMetrics {
  let shopsRow1 = 0;
  let shopsCourtFront = 0;
  let shopsRow2 = 0;
  let openFoot = 0;
  let openBand = 0;
  let courtFoot = 0;
  let courtBand = 0;
  const runs: BeltMetrics['runs'] = [];
  for (const r of RUNS) {
    const [lo, hi] = bandOf(r.kind);
    const band = (hi - lo) * (r.z1 - r.z0) * 2;   // 两侧
    if (r.kind === KIND_COURT) courtBand += band;
    else openBand += band;
    runs.push({ z0: r.z0, z1: r.z1, kind: r.kind, row1: 2, row2: r.kind === KIND_COURT || r.kind === KIND_R5 ? 0 : 2 });
  }
  for (const rp of plan.row1) {
    for (const m of rp.mods) {
      if (rp.run.kind === KIND_COURT) { courtFoot += areaInBand(m, rp.run.kind); shopsCourtFront++; }
      else if (rp.run.kind !== KIND_R5) { openFoot += areaInBand(m, rp.run.kind); shopsRow1++; }
    }
  }
  for (const rp of plan.row2) {
    for (const m of rp.mods) {
      openFoot += areaInBand(m, rp.run.kind);
      shopsRow2++;
    }
  }
  // 实测尺寸区间：逐段扫相邻铺面求间距，后巷排的巷道 = 它到所在临街排后墙的距离
  const sp1 = { w: [Infinity, -Infinity], gap: [Infinity, -Infinity], depth: [Infinity, -Infinity] } as BeltMetrics['spans']['row1'];
  const spc = { w: [Infinity, -Infinity], gap: [Infinity, -Infinity], depth: [Infinity, -Infinity] } as BeltMetrics['spans']['row1court'];
  const sp2 = { w: [Infinity, -Infinity], gap: [Infinity, -Infinity], depth: [Infinity, -Infinity], lane: [Infinity, -Infinity] } as BeltMetrics['spans']['row2'];
  for (const rp of plan.row1) {
    const target = rp.run.kind === KIND_COURT ? spc : sp1;
    for (let i = 0; i < rp.mods.length; i++) {
      const m = rp.mods[i];
      grow(target.w, m.w); grow(target.depth, m.depth);
      const nx = rp.mods[i + 1];
      // 间距只统计常态夹道（<10m）；路口让位是 20–25m 的街宽，不能混进「间距」区间
      if (nx) { const g = nx.z0 - m.z1; if (g > 0 && g < 10) grow(target.gap, g); }
    }
  }
  for (const rp of plan.row2) {
    const host = plan.row1.find((p) => p.run === rp.run && p.sx === rp.sx);
    for (let i = 0; i < rp.mods.length; i++) {
      const m = rp.mods[i];
      grow(sp2.w, m.w); grow(sp2.depth, m.depth);
      const nx = rp.mods[i + 1];
      if (nx) { const g = nx.z0 - m.z1; if (g > 0 && g < 10) grow(sp2.gap, g); }
      const h = host ? hostShop(host.mods, (m.z0 + m.z1) / 2) : null;
      if (h) grow(sp2.lane, m.face - (h.face + h.depth));
    }
  }
  // R5 段临街排（19–32）不是本模块建的，但它把 26–32 那 6m 压在带内：
  // 分母仍按「两排铺面走廊」计，分子只算本模块新建，所以覆盖率是下界。
  return {
    shopsRow1, shopsRow2, shopsCourtFront,
    duty: DUTY_SITES.length, yards: YARD_SITES.length, wells: WELL_SITES.length,
    paifang: PAIFANG_Z.length, trees: centralBeltTreeSites().length,
    stagger: plan.stagger,
    coverageOpen: openBand > 0 ? openFoot / openBand : 0,
    coverageCourt: courtBand > 0 ? courtFoot / courtBand : 0,
    spans: { row1: sp1, row1court: spc, row2: sp2 },
    runs,
  };
}

// ============ 总装 ============
/**
 * 中央保留带填实。归因 kit：
 *   belt.shopRow1 / belt.shopRow2 / belt.duty / belt.yard / belt.tree / belt.well / belt.paifang
 *   belt.coverage（宫前主道走廊覆盖率 ×100）/ belt.coverageCourt（里坊段铺面带 ×100）
 *
 * `rng` 只为签名一致：函数内部一次都不取数，下游序列逐值不变。
 */
export function buildCentralBelt(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  void rng;
  const plan = planBelt();
  for (const rp of plan.row1) {
    if (rp.run.kind === KIND_R5) continue;  // 临街排已由 buildPalaceFrontStreet 建好
    for (const m of rp.mods) frontShop(b, sg, atlas, m, 'belt.shopRow1');
  }
  for (const rp of plan.row2) {
    for (const m of rp.mods) backShop(b, m, 'belt.shopRow2');
  }
  for (const [x, z] of DUTY_SITES) dutyHouse(b, x, z);
  for (const [x, z] of YARD_SITES) smallYard(b, x, z);
  for (const [x, z] of WELL_SITES) well(b, x, z);
  for (const z of PAIFANG_Z) paifang(b, sg, atlas, z, PAIFANG_NAME[z] ?? '天街', 'belt_pf' + z, 0xffb300);
  for (const p of centralBeltTreeSites()) streetTree(b, p.x, p.z);

  const m = metricsOf(plan);
  b.kit('belt.coverage', Math.round(m.coverageOpen * 1000) / 10, m.coverageOpen);
  b.kit('belt.coverageCourt', Math.round(m.coverageCourt * 1000) / 10, m.coverageCourt);
  b.kit('belt.stagger', Math.round(m.stagger * 100) / 100, m.stagger);
}
