import { Baker, SignAtlas, SignMesher, shade } from './bake';
import { roadBlocked } from './imperial';
import type { RNG } from '../core/rng';
import { buildTradeInterior, flowerBush, gableTriangle, pickTrade, type ShopTrade, type TradeRoomSpec } from './interiors';
import { eaveRingOn, gableSlopeRibbed } from './buildings';

/**
 * R16 · 中央保留带填实（御街两厢商业带）
 *
 * 判词（用户原话，逐条对应本文件的改法）：
 *  ①「所有店铺等场所内……只剩桌椅？？？」→ 铺面从实心盒改成**薄壁 + 门洞 + 地面**，
 *     每间按业态摆 13–16 件器物（茶楼/酒楼/布庄/药铺/书坊/钱铺/面馆/杂货），见 interiors.ts 的 R16 段；
 *  ②「主街两侧的商铺不仅要单层的，还有有多层的」→ 层数由面阔决定（≥12m 必 2–3 层），带腰檐/平座/栏杆/楼梯口；
 *  ③「很多房顶为什么两侧都是空的」→ 每顶屋盖两端补山墙三角（2 面/端）；
 *  ④「为什么还有民房与主街两侧的商铺交错在一起」→ 硬分区：|x| 16–40 只放商铺，>40 只放院落；
 *  ⑤「皇宫还要有很多花花草草树木……整个城市都要这样」→ 行道树 8–12m、街角花坛 5 色、院内花木；
 *  ⑥「所有建筑的墙都差不多？？？大门正常吗？」→ 墙面 5 做法、大门 4 形制，逐间轮换；
 *
 * 现场（对源核对，不猜）：
 *   · 御街路面 |x|<13（imperial.ts 铺 26m 宽路面，顶 0.14），两侧朱雀廊柱 |x|=16；
 *   · 宫前商业街（R5，buildPalaceFrontStreet）已占 |x| 19–32、z −2820…−2300；
 *   · 御街两厢里坊（WS-18，infill.ts 的 courtWards）占 |x| 32–886、z 230…2880，
 *     与 infill.ts 的御街廊庑/石灯/行道树（|x| ≤ 17.2）之间夹着 17.2–26 的廊道；
 *   · 临河手工段（河岸铺面 + 桥东广场摊位到 x=48）占 |z| < 210，取 |z| < 305 整段让开（河道与桥面归 R15-A）；
 *   · 横街（imperial.ts ROAD_LINES = 900/1700/2500/3300）是折线、每段横向游走 ±36–40m，
 *     固定让位会在每个路口挖出 100m 空段，故铺面位置逐间调 imperial.roadBlocked 判位、贴路缘收边。
 *
 * 断面（R16 后的硬契约，`beltZoneAudit()` 机检）：
 *
 *     御街路面 |x|<13 │ 朱雀廊道 13–27 │ 商铺带 27–40 │ 院落带 40–120
 *
 *  · 商铺带（|x| 27–40，即自街缘 16 起 24m）只允许**铺面**，进深被 clamp 到 40 以内；
 *  · 院落带（>40）只允许**带院墙的宅院/作坊**：后巷排保留原房屋体量，但临巷一侧补院墙 + 门楼，
 *    从街上读到的是「临街是商铺、背后是院落」，不再是两排铺面互相插；
 *  · 值房（88–98）与小院（104–112）本来就在院带内，位置不动。
 *
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
/** 商铺带内边界（朱雀廊道外缘）：临街排前脸 26.2–27.6。
 *  必须让开后墙侧那道**坊墙**：实测 raycast 在 |x|=32.3 处命中连续 `city_earth` 实体
 *  （御街厢坊外墙，与 KIND_COURT 段里 `26.2–31.4` 的铺面带同一条线）。旧版进深 11–14
 *  直接把铺面砌进坊墙，墙上再压一座 2m 高的夯土体——这正是用户看到的「民房与商铺交错」。 */
const BAND_IN = 26.2;
/** 商铺带外边界：坊墙内皮 32.3 再让 0.4。铺面后墙一律 ≤ 此值，越界的由 beltZoneAudit 报错 */
const SHOP_OUT = 31.9;
/** 院落带：后巷排从这里开始（再让 3–4.5m 巷道）；
 *  旧版写成 40 是因为没识别出 32.3 的坊墙，现在院带放到坊墙之外，临街是商铺、坊墙内是院落。 */
const COURT_IN = 32.3;
/** 院带外缘（值房 88–98 / 小院 104–112 都在里面） */
const BAND_OUT = 120;
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

// ============ 色板 ============
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

// ============ 墙面 5 做法 / 大门 4 形制（判据 ⑥） ============
type WallGroup = 'wall' | 'earth' | 'wood';

interface WallStyle { id: string; name: string; g: WallGroup; hex: number; trim: number }
/** 夯土 / 砖砌 / 板壁 / 抹灰 / 木骨 —— 同街区按 z 段轮换，一段内不少于 3 种 */
const WALL_STYLES: readonly WallStyle[] = [
  { id: 'rammed', name: '夯土', g: 'earth', hex: 0x9a8c74, trim: 0x7f7059 },
  { id: 'brick', name: '砖砌', g: 'wall', hex: 0x7f8792, trim: 0x5f6772 },
  { id: 'plank', name: '板壁', g: 'wood', hex: 0x6b4a2b, trim: 0x3a2c22 },
  { id: 'plaster', name: '抹灰', g: 'wall', hex: 0xc0b096, trim: 0x9a8b74 },
  { id: 'timber', name: '木骨', g: 'wood', hex: 0x8a6a48, trim: 0x4a3220 },
];

/** 大门 4 形制：板门 / 格子门 / 乌头门 / 门楼 */
const DOOR_STYLES = ['board', 'lattice', 'wutou', 'gatehouse'] as const;
type DoorStyle = (typeof DOOR_STYLES)[number];

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
  style: number;    // 墙面做法 0–4
  door: number;     // 大门形制 0–3
  trade: ShopTrade;
  variant: number;
  /** 0 = 完整业态套（16 件）；1 = 外围简装（前 8 件） */
  level: number;
}

/**
 * 层数 × 面阔的相关性（判据 ②）：面阔 ≥12m 必多层，≥16m 有 42% 做三层。
 * 里坊段（进深只有 5.2m）压到 2 层上限，不做三层。
 */
function floorsOf(w: number, u: number, court: boolean): number {
  if (court) return w >= 14 && u < 0.22 ? 2 : 1;
  if (w >= 16) return u < 0.42 ? 3 : 2;
  if (w >= 12) return u < 0.30 ? 3 : 2;
  return u < 0.28 ? 2 : 1;
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

/** 一段 z 属于哪个「街区」（120m 一格，用于墙面做法的轮换基数） */
const blockOf = (z: number): number => Math.floor(z / 120);

/** 非负取模：z 为负时 JS 的 % 会回负数，直接索引 WALL_STYLES 会拿到 undefined */
const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** 墙面做法 / 大门形制：街区内轮换，保证同一段里至少出现 3 种做法 */
function styleOf(z: number, salt: number): number {
  return mod(blockOf(z) * 3 + ((H(blockOf(z) * 0.71, salt + 31) * 5) | 0) + ((H(z * 0.051, salt + 33) * 3) | 0), 5);
}
const doorOf = (z: number, salt: number): number => mod((H(z * 0.043, salt + 37) * 4) | 0, 4);

/** 临街排：面阔 8–20、进深 9–13（后墙一律 clamp 到 40 以内）、间距 1.5–4、层数看面阔 */
function row1Mods(r: Run, sx: number): Shop[] {
  const salt = 1000 + r.kind * 311 + (sx > 0 ? 13 : 71) + Math.round(r.z0);
  const out: Shop[] = [];
  let z = r.z0;
  while (z < r.z1 - 8) {
    const w = Math.min(8 + H(z * 0.0173, salt + 1) * 12, r.z1 - z);
    const gap = 1.5 + H(z * 0.0239, salt + 2) * 2.5;
    const face = r.kind === KIND_COURT ? 26.2 : BAND_IN + H(z * 0.0121, salt + 3) * 0.8;
    // 后墙 ≤ SHOP_OUT：商铺带是硬边界（坊墙内皮 32.3），进深因此被夹到 4.7–5.6m
    const depth = r.kind === KIND_COURT
      ? 5.2
      : Math.max(4.4, Math.min(11 + H(z * 0.0131, salt + 4) * 3, SHOP_OUT - face - 0.15));
    const floors = floorsOf(w, H(z * 0.0301, salt + 5), r.kind === KIND_COURT);
    const style = styleOf(z, salt);
    const door = doorOf(z, salt);
    const { trade, variant } = pickTrade(sx * (face + depth / 2), (z + z) / 2);
    const base = { sx, face, depth, floors, salt: salt + Math.round(z), style, door, trade, variant, level: 0 };
    const rd = firstRoad(sx, face, depth, z, z + w);
    if (rd >= 0) {
      // 路口收边：临街那间压到路缘停下（≥8m 才留），然后跳到路口对岸续铺
      const cut = rd - 0.8;
      if (cut - z >= 8) out.push({ ...base, w: cut - z, z0: z, z1: cut });
      z = pastRoad(sx, face, depth, rd, r.z1) + 0.8;
      continue;
    }
    out.push({ ...base, w, z0: z, z1: z + w });
    z += w + gap;
  }
  return out;
}

/** 后巷排（院落带）：进深 12–16，与临街排隔 3–4.5m 巷道，起点按首间面阔的 30–60% 错缝 */
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
    const lane = 3 + H(z * 0.0277, salt + 4) * 1.5;
    const host = hostShop(r1, z + w / 2);
    const face = Math.max(COURT_IN + lane, (host ? host.face + host.depth : BAND_IN + 12) + lane);
    const floors = H(z * 0.0311, salt + 5) > 0.80 ? 2 : 1;
    const style = styleOf(z, salt);
    const door = doorOf(z, salt);
    const { trade, variant } = pickTrade(sx * (face + depth / 2), z + w / 2);
    const base = { sx, face, depth, floors, salt: salt + Math.round(z), style, door, trade, variant, level: 1 };
    const rd = firstRoad(sx, face, depth, z, z + w);
    if (rd >= 0) {
      const cut = rd - 0.8;
      if (cut - z >= 8) out.push({ ...base, w: cut - z, z0: z, z1: cut });
      z = pastRoad(sx, face, depth, rd, r.z1) + 0.8;
      continue;
    }
    out.push({ ...base, w, z0: z, z1: z + w });
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

// ============ 通用构件 ============
/** 山墙三角封口（判据 ③）：屋盖两端各补一片，2 面/端 */
function capGables(b: Baker, cx: number, zc: number, yTop: number, span: number, halfDepth: number, rise: number, hex: number): void {
  for (const s of [-1, 1] as const) {
    gableTriangle(b, halfDepth, rise, cx, yTop, zc + s * (span / 2), s > 0 ? 0 : Math.PI, hex);
  }
}

/** 腰檐（两层之间的披檐）+ 平座 + 栏杆 + 楼梯口（判据 ②） */
function storeyBand(b: Baker, m: Shop, zc: number, yEdge: number): void {
  const { sx, face, w } = m;
  // 腰檐：一道沿街的短披檐，挑出 0.55m
  b.box('roof', 0.72, 0.14, w + 0.3, sx * (face - 0.2), yEdge + 0.24, zc, shade(0x3a4450, 1.12), 0, 0, sx * 0.36);
  // 平座（二层挑台）
  b.box('wood', 0.95, 0.16, w * 0.94, sx * (face - 0.3), yEdge, zc, shade(0x6b4a2b, 1.05));
  // 栏杆：通长扶手 + 三根望柱
  b.box('wood', 0.1, 0.08, w * 0.9, sx * (face - 0.72), yEdge + 0.72, zc, WOOD_RED);
  for (let k = -1; k <= 1; k++) b.box('wood', 0.09, 0.72, 0.09, sx * (face - 0.72), yEdge + 0.36, zc + k * w * 0.42, WOOD_DARK);
  // 楼梯口：靠街一侧的木踏道（≥14m 面阔才做，免得小铺面被楼梯吃掉）
  if (w >= 14 && m.floors >= 2) {
    // 楼梯口只做「洞口 + 扶手」两件，不做整跑踏道：一跑 5 级要 60 面，559 间铺面就是 34k
    b.box('wood', 0.92, 0.12, 0.9, sx * (face - 0.62), yEdge + 0.02, zc + w * 0.42, 0x8b5e3c);
    b.box('wood', 1.0, 0.08, 0.1, sx * (face - 0.62), yEdge + 0.78, zc + w * 0.42 + 0.4, WOOD_DARK);
    b.box('wood', 0.1, 0.78, 0.1, sx * (face - 0.2), yEdge + 0.39, zc + w * 0.42 + 0.4, WOOD_DARK);
  }
}

/** 大门（判据 ⑥）：4 形制，靠门洞两侧的墙垛与门楣本身构成，只补 1–2 件差异件 */
function shopDoor(b: Baker, m: Shop, dw: number, zc: number, gy: number): void {
  const { sx, face } = m;
  const fx = sx * (face + 0.06);
  switch (m.door) {
    case 0: // 板门：一扇半掩的门扇 + 门环
      b.box('wood', 0.1, 2.34, dw * 0.5, fx, gy + 1.17, zc - dw * 0.25, 0x3a2418);
      b.box('metal', 0.05, 0.16, 0.06, fx - sx * 0.06, gy + 1.2, zc - dw * 0.06, 0xb08a34);
      break;
    case 1: // 格子门：两扇格心（两根竖棂 + 一道横铛）
      b.box('wood', 0.08, 2.34, dw * 0.9, fx, gy + 1.17, zc, 0x6b4a2b);
      for (const k of [-1, 0, 1]) b.box('wood', 0.05, 2.2, 0.06, fx - sx * 0.05, gy + 1.2, zc + k * dw * 0.28, 0x3a2c22);
      break;
    case 2: // 乌头门：两根高出门楣的乌头柱
      for (const s of [-1, 1]) {
        b.box('wood', 0.18, 2.9, 0.18, fx - sx * 0.06, gy + 1.45, zc + s * (dw / 2 + 0.1), 0x2a1c12);
        b.box('wood', 0.22, 0.16, 0.22, fx - sx * 0.06, gy + 2.92, zc + s * (dw / 2 + 0.1), 0x3a2a1a);
      }
      break;
    default: // 门楼：门上起一座小披檐
      b.box('roof', 0.9, 0.14, dw + 1.1, fx - sx * 0.3, gy + 2.72, zc, 0x33404a, 0, 0, sx * 0.3);
      b.box('wood', 0.12, 0.2, dw + 1.0, fx - sx * 0.06, gy + 2.5, zc, WOOD_RED);
      break;
  }
}

// ============ 铺面断面的单一真相源 ============
// 檐高与室内参数既被 build 用、也被 tests/shopInterior.test.ts 的审计用。
// 两处各写一份就会漂移（测试报 14 件、现场落 8 件这种事故查不出来），所以只留这一份。
const FRONT_GY = 0.36;   // 临街排室内地坪
const FRONT_TW = 0.28;   // 临街排墙厚
const BACK_GY = 0.34;    // 后巷排室内地坪
const BACK_TW = 0.26;    // 后巷排墙厚

/** 临街排檐高（含层数） */
function frontShopH(m: Shop): number {
  const t = H(m.z0 * 0.0071, m.salt);
  const storeyH = 3.5 + t * 0.45;
  return m.floors === 1 ? 3.7 + t * 1.0
    : m.floors === 2 ? storeyH * 2 + 0.15
      : storeyH * 3 + 0.3;
}

/** 后巷排檐高（含层数） */
function backShopH(m: Shop): number {
  const t = H(m.z0 * 0.0081, m.salt);
  return m.floors === 2 ? 5.8 + t * 1.2 : 3.4 + t * 1.2;
}

/**
 * 临街排的室内参数（面阔 / 进深 / 地坪 / 净高 / 业态 / 器物上限）。
 * `buildCentralBelt` 与审计共用：调用点只负责盖壳，陈设密度只在这里改。
 */
export function frontRoomSpec(m: Shop): TradeRoomSpec {
  const { sx, face, depth: d, w } = m;
  const zc = (m.z0 + m.z1) / 2;
  const h = frontShopH(m);
  return {
    cx: sx * (face + d / 2), cz: zc,
    w: w - FRONT_TW * 2 - 0.1, d: d - FRONT_TW * 2 - 0.1,
    y0: FRONT_GY, h: h - 0.12,
    trade: m.trade, variant: m.variant,
    ux: 0, uz: 1, vx: sx, vz: 0,
    ceiling: true,
    maxItems: d >= 9 ? 14 : 11,
  };
}

/** 后巷排的室内参数（院落带，简装档） */
export function backRoomSpec(m: Shop): TradeRoomSpec {
  const { sx, face, depth: d, w } = m;
  const zc = (m.z0 + m.z1) / 2;
  const h = backShopH(m);
  return {
    cx: sx * (face + d / 2), cz: zc,
    w: w - BACK_TW * 2 - 0.1, d: d - BACK_TW * 2 - 0.1,
    y0: BACK_GY, h: h - 0.12,
    trade: m.trade, variant: m.variant,
    ux: 0, uz: 1, vx: sx, vz: 0,
    ceiling: false, compact: true, maxItems: 9,
  };
}

/**
 * 审计入口：中央商业带**实际会建出来**的全部室内参数（临街排 + 后巷排）。
 * 与 `buildCentralBelt` 同一套过滤（R5 段临街排已由宫前商业街建好，这里不重复）。
 * 纯计算，不碰几何——测试与探针直接按这个列表抽样。
 */
export function beltRoomSpecs(): TradeRoomSpec[] {
  const plan = planBelt();
  const out: TradeRoomSpec[] = [];
  for (const rp of plan.row1) {
    if (rp.run.kind === KIND_R5) continue;
    for (const m of rp.mods) out.push(frontRoomSpec(m));
  }
  for (const rp of plan.row2) {
    for (const m of rp.mods) out.push(backRoomSpec(m));
  }
  return out;
}

// ============ 临街铺面 ============
function frontShop(b: Baker, sg: SignMesher, atlas: SignAtlas, m: Shop, kit: string): void {
  const { sx, face, depth: d, w } = m;
  const zc = (m.z0 + m.z1) / 2;
  const cx = sx * (face + d / 2);
  const t = H(m.z0 * 0.0071, m.salt);
  const st = WALL_STYLES[m.style];
  const wallC = shade(pick(WALL_TONES, H(m.z0 * 0.0073, m.salt + 7)), 0.86 + m.style * 0.05);
  const roofC = pick(ROOF_TONES, H(m.z0 * 0.0111, m.salt + 9));
  const flagC = pick(FLAG_TONES, H(m.z0 * 0.0137, m.salt + 11));
  const storeyH = 3.5 + t * 0.45;
  const h = frontShopH(m);
  const gy = FRONT_GY;             // 地坪上皮
  const TW = FRONT_TW;             // 墙厚

  // 台基（顶面即室内地坪，另铺一层薄砖只是色差，12 面/间不值得）
  b.box('ash', d + 0.9, 0.36, w + 0.7, cx, 0.18, zc, shade(wallC, 0.82));
  // —— 薄壁壳（判据 ①）：后墙 / 两山墙 / 前墙留门洞 ——
  b.box(st.g, TW, h, w - TW * 2, sx * (face + d - TW / 2), gy + h / 2, zc, st.hex);
  for (const s of [-1, 1] as const) {
    b.box(st.g, d - TW * 2, h, TW, cx, gy + h / 2, zc + s * (w / 2 - TW / 2), shade(st.hex, 0.96));
  }
  const dw = Math.min(w * 0.42, 3.2);
  const seg = (w - TW * 2 - dw) / 2;
  for (const s of [-1, 1] as const) {
    b.box(st.g, TW, h, seg, sx * (face + TW / 2), gy + h / 2, zc + s * (dw / 2 + seg / 2), st.hex);
  }
  b.box(st.g, TW, h - 2.6, dw, sx * (face + TW / 2), gy + 2.6 + (h - 2.6) / 2, zc, st.hex);
  // 墙面做法差异件（夯土压顶 / 砖砌勒脚 / 板壁竖缝 / 抹灰腰线 / 木骨枋）
  if (m.style === 0) b.box(st.g, 0.16, 0.22, w - TW * 2, sx * (face + 0.02), gy + h - 0.11, zc, st.trim);
  else if (m.style === 1) b.box(st.g, 0.12, 0.62, w - TW * 2, sx * (face - 0.02), gy + 0.31, zc, st.trim);
  else if (m.style === 2) {
    for (let k = -1; k <= 1; k++) b.box('wood', 0.06, h - 0.5, 0.08, sx * (face - 0.02), gy + h / 2, zc + k * w * 0.26, st.trim);
  } else if (m.style === 3) b.box('wood', 0.14, 0.16, w - TW * 2, sx * (face - 0.02), gy + h * 0.62, zc, st.trim);
  else {
    b.box('wood', 0.2, 0.24, w - TW * 2, sx * (face - 0.02), gy + h - 0.2, zc, st.trim);
    b.box('wood', 0.2, 0.18, w - TW * 2, sx * (face - 0.02), gy + h * 0.5, zc, st.trim);
  }
  // 勒脚（外贴 0.1m，避免与墙面共面闪烁）
  b.box('ash', 0.12, 0.5, w * 0.99, sx * (face - 0.03), gy + 0.25, zc, shade(st.hex, 0.66));
  // 檐柱：立在街上（原来写在 face+0.24，正好埋进墙里，街上根本看不见）
  const nCol = Math.max(2, Math.min(5, Math.round(w / 3.6)));
  for (let k = 0; k < nCol; k++) {
    const pz = zc + ((k + 0.5) / nCol - 0.5) * (w - 1.1);
    b.box('wood', 0.26, h - 0.55, 0.26, sx * (face - 0.24), gy + (h - 0.55) / 2, pz, WOOD_DARK);
  }
  // 额头枋（柱列上沿）
  b.box('wood', 0.3, 0.26, w - 0.5, sx * (face - 0.24), gy + h - 0.5, zc, shade(WOOD_RED, 0.82));
  // 大门（4 形制）
  shopDoor(b, m, dw, zc, gy);
  // 亮窗：贴在墙外皮（原来写在 face+0.06，正好埋进 0.28m 厚的薄壁里，临街只看得到一片空墙）
  for (const s2 of [-1, 1]) {
    b.box('glow', 0.12, 1.3, Math.min(w * 0.15, 1.9), sx * (face - 0.05), gy + 1.95, zc + s2 * (dw / 2 + seg * 0.5), 0xffd8a0);
  }
  // 台阶
  b.box('ash', 0.9, 0.2, Math.min(w * 0.5, 4), sx * (face - 0.45), 0.1, zc, shade(st.hex, 0.9));
  // 匾额
  const ni = (H(m.z0 * 0.0051, m.salt + 21) * SHOP_NAMES.length) | 0;
  const bw = Math.min(w * 0.5, 3.0);
  sg.quad(
    atlas.text('belt_' + ni, SHOP_NAMES[ni], 240, 72, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.9)', border: 'rgba(255,179,0,.75)', fontPx: 46 }),
    bw, bw * 0.3, sx * (face - 0.16), gy + h * 0.78, zc, sx > 0 ? -Math.PI / 2 : Math.PI / 2,
  );
  // 幌子：一根挑杆 + 布幌（挑向街心）
  const pz2 = zc + w * 0.42;
  b.box('wood', 0.1, 2.6, 0.1, sx * (face - 0.5), 2.4, pz2, WOOD_DARK);
  b.box('fabric', 0.9, 1.0, 0.06, sx * (face - 0.95), 2.7, pz2, flagC);
  // 檐下灯
  b.box('glow', 0.26, 0.34, 0.26, sx * (face - 0.32), gy + h - 0.42, zc - w * 0.32, 0xffb84a);
  // 楼身（多层）
  if (m.floors >= 2) {
    storeyBand(b, m, zc, gy + storeyH);
    if (m.floors >= 3) {
      b.box('roof', 0.7, 0.13, w + 0.2, sx * (face - 0.2), gy + storeyH * 2 + 0.2, zc, shade(0x3a4450, 1.06), 0, 0, sx * 0.36);
      b.box('wood', 0.9, 0.14, w * 0.9, sx * (face - 0.28), gy + storeyH * 2 - 0.02, zc, shade(0x6b4a2b, 1.0));
      for (const s2 of [-1, 1]) {
        b.box('glow', 0.1, 1.1, Math.min(w * 0.2, 2.2), sx * (face - 0.05), gy + storeyH * 2 + 1.2, zc + s2 * w * 0.24, 0xffc66e);
      }
    }
    // 二层通长亮窗（原只有挑台，墙面整片空）
    for (let k = 0; k < Math.max(2, Math.round(w / 4)); k++) {
      const zz = zc + ((k + 0.5) / Math.max(2, Math.round(w / 4)) - 0.5) * (w - 1.6);
      b.box('glow', 0.1, 1.35, 1.9, sx * (face - 0.05), gy + storeyH + 1.15, zz, 0xffc66e);
    }
  }
  // 曲面反宇顶 + 两端山墙（判据 ③）
  const rh = (d < 7 ? 0.8 + w * 0.03 : 1.1 + w * 0.05);
  const swC = (w + 0.5) * 1.02, sdC = d * 1.04;
  b.roofC('roof', cx, gy + h, zc, roofC, Math.PI / 2, swC, rh, sdC);
  // 旧版这里只有一榀裸曲面壳：没有连檐、没有滴水、没有正脊 —— 街面看是一段没有收头的灰壳。
  // 补一圈连续檐口环（沿反宇折线，四边不断开）+ 一条正脊（脊沿 z，与 ry=π/2 一致）。
  eaveRingOn(b, cx, gy + h, zc, Math.PI / 2, swC, sdC, rh, roofC);
  b.box('roof', 0.42, 0.2, 0.32 * swC, cx, gy + h + rh + 0.05, zc, shade(roofC, 1.22));
  capGables(b, cx, zc, gy + h - 0.02, (w + 0.5) * 1.02, d * 0.54, rh * 1.03, st.hex);
  // 室内（判据 ①）
  buildTradeInterior(b, frontRoomSpec(m));
  b.kit(kit, 1, h);
  b.kit(`belt.wall.${st.id}`, 1, h);
  b.kit(`belt.door.${DOOR_STYLES[m.door]}`, 1, h);
  b.kit(`belt.floors${m.floors}`, 1, h);
}

// ============ 后巷排（院落带：铺面 + 临巷院墙 + 门楼） ============
function backShop(b: Baker, m: Shop, kit: string): void {
  const { sx, face, depth: d, w } = m;
  const zc = (m.z0 + m.z1) / 2;
  const cx = sx * (face + d / 2);
  const st = WALL_STYLES[m.style];
  const wallC = shade(pick(WALL_TONES, H(m.z0 * 0.0083, m.salt + 13)), 0.84 + m.style * 0.05);
  const roofC = pick(ROOF_TONES, H(m.z0 * 0.0097, m.salt + 17));
  const h = backShopH(m);
  const gy = BACK_GY;
  const TW = BACK_TW;
  b.box('ash', d + 0.8, 0.34, w + 0.6, cx, 0.17, zc, shade(wallC, 0.8));
  b.box('ash', d - TW * 2, 0.05, w - TW * 2, cx, gy - 0.025, zc, 0x6b7076);
  // 薄壁壳 + 后门洞（判据 ①）
  b.box(st.g, TW, h, w - TW * 2, sx * (face + d - TW / 2), gy + h / 2, zc, st.hex);
  for (const s of [-1, 1] as const) b.box(st.g, d - TW * 2, h, TW, cx, gy + h / 2, zc + s * (w / 2 - TW / 2), shade(st.hex, 0.96));
  const dw = Math.min(w * 0.34, 2.6);
  const seg = (w - TW * 2 - dw) / 2;
  for (const s of [-1, 1] as const) b.box(st.g, TW, h, seg, sx * (face + TW / 2), gy + h / 2, zc + s * (dw / 2 + seg / 2), st.hex);
  b.box(st.g, TW, h - 2.4, dw, sx * (face + TW / 2), gy + 2.4 + (h - 2.4) / 2, zc, st.hex);
  b.box('wood', 0.14, 2.2, dw * 0.8, sx * (face + 0.06), gy + 1.1, zc, 0x3a2418);
  // 双坡顶（脊沿 z）：两块斜板绕 z 倾 + 正脊 + 两端山墙。
  // 近景段改成带 0.34m 瓦垄顶点色的坡面（旧版是两块素板，俯视就是一整块灰板），
  // 并补连续连檐 + 滴水；|z0|≥1200 的远段仍用板，面数只花在能看清的街段上。
  const rh = 1.0 + w * 0.045;
  const L = Math.hypot(d / 2, rh);
  const th = Math.atan2(rh, d / 2);
  const nearB = Math.abs(zc) < 1200;
  for (const rs of [-1, 1] as const) {
    if (nearB) {
      gableSlopeRibbed(b, cx, gy + h, zc, Math.PI / 2, (w + 0.8) / 2, d / 2, rh, rs, roofC);
    } else {
      b.box('roof', L * 1.02, 0.18, w + 0.8, cx + (rs * d) / 4, gy + h + rh / 2, zc, roofC, 0, 0, -rs * th);
    }
    b.box('roof', 0.34, 0.16, w + 0.8, cx + rs * (d / 2), gy + h - 0.05, zc, shade(roofC, 0.7));
    b.box('roof', 0.16, 0.1, w + 0.8, cx + rs * (d / 2 + 0.06), gy + h - 0.16, zc, shade(roofC, 0.55));
  }
  b.box('roof', 0.4, 0.22, w + 0.9, cx, gy + h + rh, zc, shade(roofC, 1.26));
  capGables(b, cx, zc, gy + h, w + 0.8, d * 0.54, rh * 1.02, st.hex);
  // —— 院墙 + 门楼（判据 ④：后巷排落在院落带，必须读成"院"而不是第二排临街铺面）——
  const gate = Math.min(w * 0.34, 3.2);
  const gseg = (w - gate) / 2;
  const wallH = 2.0;
  for (const s of [-1, 1] as const) {
    b.box('earth', 0.34, wallH, gseg, sx * (face - 0.55), wallH / 2, zc + s * (gate / 2 + gseg / 2), EARTH_WALL);
    b.box('roof', 0.46, 0.12, gseg, sx * (face - 0.55), wallH + 0.06, zc + s * (gate / 2 + gseg / 2), shade(0x6c7382, 0.95));
  }
  // 院门楼：两根门柱 + 一道小披檐
  for (const s of [-1, 1] as const) {
    b.box('wood', 0.2, 2.3, 0.2, sx * (face - 0.55), 1.15, zc + s * (gate / 2 + 0.12), WOOD_DARK);
  }
  b.box('roof', 0.62, 0.12, gate + 0.9, sx * (face - 0.72), 2.42, zc, roofC, 0, 0, sx * 0.3);
  // 院内花木（判据 ⑤）
  const laneX = sx * (face - 1.9);
  flowerBush(b, laneX, zc - w * 0.34, 0.9, (m.salt * 7) % 5);
  // 室内（院落带的后巷排走简装档，见 backRoomSpec）
  buildTradeInterior(b, backRoomSpec(m));
  b.kit(kit, 1, h);
  b.kit(`belt.wall.${st.id}`, 1, h);
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
  const bh = 3.6;
  b.box('ash', 7, 0.36, 11, x, 0.18, z, STONE_C);
  b.box('wall', 6, bh, 10, x, 0.36 + bh / 2, z, wallC);
  b.roofC('roof', x, 0.36 + bh, z, roofC, Math.PI / 2, 10.4, 1.3, 6.3);
  capGables(b, x, z, 0.36 + bh, 10.4, 3.4, 1.34, wallC);
  b.box('wood', 0.14, 2.2, 3.0, x - sx * 3.05, 1.5, z - 2.0, 0x3a2418);
  b.box('glow', 0.1, 0.9, 1.2, x - sx * 3.0, 2.9, z + 2.6, 0xffc66e);
  for (let k = 0; k < 3; k++) {
    const ox = x - sx * (5.4 + (k % 2) * 1.4);
    const oz = z + 4.6 + k * 1.5;
    b.box('wood', 1.3, 1.0 + (k % 2) * 0.4, 1.3, ox, 0.5 + (k % 2) * 0.2, oz, shade(0x6b4a2b, 0.9 + k * 0.05));
  }
  // 院内花木
  flowerBush(b, x - sx * 2.2, z - 6.2, 1.0, 0);
  flowerBush(b, x + sx * 3.0, z - 6.4, 0.85, 2);
  b.kit('belt.duty', 1, 0.36 + bh);
}

// ============ 小院（院墙 + 正房 + 花木） ============
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
  const bx = x + sx * 2.6;
  const bh = 3.8;
  b.box('ash', 10, 0.4, 7, bx, 0.2, z, STONE_C);
  b.box('wall', 9, bh, 6, bx, 0.4 + bh / 2, z, wallC);
  b.roofC('roof', bx, 0.4 + bh, z, roofC, 0, 9.4, 1.25, 6.4);
  capGables(b, bx, z, 0.4 + bh, 9.4, 3.2, 1.29, wallC);
  b.box('wood', 0.14, 2.2, 2.6, bx - sx * 4.55, 1.5, z, 0x3a2418);
  b.box('glow', 0.1, 1.2, 1.6, bx - sx * 4.5, 2.4, z + 2.4, 0xffc66e);
  // 院中花木：1 株乔木 + 3 丛花（五色轮换）
  const tz = z - 2.4;
  const tx = x - sx * 1.8;
  const th = 3.0 + H(z * 0.0131, salt + 9) * 1.1;
  b.cyl('trunk', 0.14, 0.22, th, 6, tx, th / 2, tz, 0x574530);
  b.sphere('leaf', 1.5, 7, tx, th + 0.8, tz, shade(0x3f6a3c, 0.92), 0, 0, 0, 1, 0.88, 1);
  b.sphere('leaf', 0.95, 6, tx + 0.8, th + 1.5, tz - 0.5, shade(0x466f3e, 1.0));
  for (let k = 0; k < 3; k++) {
    flowerBush(b, x - sx * 3.4, z + 3.4 - k * 2.2, 0.8 + k * 0.12, (salt + k * 3) % 5);
  }
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
  for (const s of [-1, 1] as const) b.box('wood', 8.4, 0.5, 0.6, s * 9.9, 5.9, z, shade(WOOD_RED, 0.96));
  b.box('wood', 30.2, 0.55, 0.7, 0, 6.6, z, shade(WOOD_RED, 0.92));
  b.box('wood', 12.6, 0.85, 0.42, 0, 7.5, z, 0x2a4a3a);
  b.roofC('roof', 0, 7.95, z, 0x3a4450, 0, 15.8, 1.9, 3.0);
  for (const s of [-1, 1] as const) b.roofC('roof', s * 10.6, 6.45, z, 0x33404a, 0, 8.2, 1.2, 2.5);
  // 额枋灯：旧版一根 15.2m 不断的灯条横跨三间（街面/御街视角都是一条连续亮线）。
  // 改成分段灯管：2.2m 管 / 3.2m 暗段，五段均匀落在额枋上。
  for (let lx = -6.4; lx <= 6.4; lx += 3.2) b.box('glow', 2.2, 0.12, 0.12, lx, 7.2, z + 0.1, neon);
  sg.quad(
    atlas.text(key, name, 320, 84, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.9)', border: 'rgba(255,179,0,.8)', fontPx: 56 }),
    5.0, 1.3, 0, 7.5, z + 0.26, 0,
  );
  b.kit('belt.paifang', 1, 9.4);
}

// ============ 多层楼阁 / 望楼（判据 ②：御街沿线补多层亭台阁楼） ============
/** 三重檐楼阁：台基 + 三层墙身 + 两重腰檐 + 各层平座栏杆 + 攒尖顶（不用 roofC 堆叠，控面数） */
function pavilionTower(b: Baker, x: number, z: number, floors: number, w: number, salt: number): void {
  const t = H(z * 0.011, salt);
  const tile = pick(ROOF_TONES, H(z * 0.013, salt + 3));
  const wallC = pick(WALL_TONES, H(z * 0.015, salt + 5));
  const gy = 0.9;
  const sh = 3.2;
  b.box('ash', w + 3.0, gy, w + 3.0, x, gy / 2, z, shade(STONE_C, 0.94));
  b.box('ash', w + 2.2, 0.2, w + 2.2, x, gy - 0.06, z, shade(STONE_C, 1.06));
  for (let f = 0; f < floors; f++) {
    const y = gy + f * sh;
    const ww = w * (1 - f * 0.13);
    b.box('wood', ww, sh - 0.2, ww, x, y + (sh - 0.2) / 2, z, shade(wallC, 0.9 + f * 0.06));
    // 各层檐柱 + 亮窗（四面）
    for (const s of [-1, 1] as const) {
      for (let k = -1; k <= 1; k++) {
        b.box('wood', 0.22, sh - 0.3, 0.22, x + s * (ww / 2 - 0.11), y + (sh - 0.3) / 2, z + k * ww * 0.32, WOOD_DARK);
        b.box('wood', 0.22, sh - 0.3, 0.22, x + k * ww * 0.32, y + (sh - 0.3) / 2, z + s * (ww / 2 - 0.11), WOOD_DARK);
        b.box('glow', ww * 0.3, 1.0, 0.1, x + k * ww * 0.3, y + sh * 0.55, z + s * (ww / 2 - 0.06), 0xffc66e);
        b.box('glow', 0.1, 1.0, ww * 0.3, x + s * (ww / 2 - 0.06), y + sh * 0.55, z + k * ww * 0.3, 0xffc66e);
      }
    }
    // 平座 + 栏杆（檐下一圈）
    b.box('wood', ww + 1.5, 0.14, ww + 1.5, x, y + sh - 0.24, z, shade(0x6b4a2b, 1.0));
    const rr = (ww + 1.4) / 2;
    for (let k = -2; k <= 2; k++) {
      const p = (k / 2) * rr;
      for (const s of [-1, 1] as const) {
        b.box('wood', 0.1, 0.62, 0.1, x + s * rr, y + sh + 0.07, z + p, WOOD_RED);
        b.box('wood', 0.1, 0.62, 0.1, x + p, y + sh + 0.07, z + s * rr, WOOD_RED);
      }
    }
    // 腰檐（四坡板檐，绕脊四条斜板）
    const eh = 0.62;
    const half = (ww + 1.6) / 2;
    const sl = Math.hypot(half, eh);
    const pitch = Math.atan2(eh, half);
    for (const s of [-1, 1] as const) {
      b.box('roof', ww + 1.8, 0.14, sl, x, y + sh + 0.2 + eh / 2, z + s * half * 0.5, tile, 0, s * pitch, 0);
      b.box('roof', sl, 0.14, ww + 1.8, x + s * half * 0.5, y + sh + 0.2 + eh / 2, z, tile, 0, 0, -s * pitch);
    }
  }
  // 攒尖顶：四块斜板收成一点
  const topY = gy + floors * sh + 0.2;
  const ww = w * (1 - Math.min(2, floors - 1) * 0.13);
  const rise = 1.6 + t * 0.6;
  const half = ww / 2 + 0.9;
  const sl = Math.hypot(half, rise);
  const pitch = Math.atan2(rise, half);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.box('roof', ww + 1.8, 0.16, sl, x + Math.sin(a) * half * 0.5, topY + rise / 2, z + Math.cos(a) * half * 0.5, tile, a, 0, 0);
  }
  b.cyl('roof', 0.16, 0.3, 0.9, 6, x, topY + rise + 0.3, z, shade(tile, 1.3));
  b.box('glow', 0.3, 0.34, 0.3, x, topY + rise + 0.78, z, 0xffb300);
  b.kit('belt.tower', 1, topY + rise);
}

// ============ 行道树 + 花坛（判据 ⑤） ============
function streetTree(b: Baker, x: number, z: number): void {
  const salt = Math.round(z);
  const th = 3.3 + H(z * 0.0141, salt) * 1.3;
  b.cyl('trunk', 0.16, 0.26, th, 6, x, th / 2, z, 0x574530);
  const r = 1.5 + H(z * 0.0193, salt + 2) * 0.6;
  const base = shade(0x3f6a3c, 0.9 + H(z * 0.0167, salt + 4) * 0.22);
  b.sphere('leaf', r, 7, x, th + r * 0.5, z, base, 0, 0, 0, 1, 0.84, 1);
  b.sphere('leaf', r * 0.68, 6, x + 0.85, th + r * 0.95, z - 0.55, shade(base, 1.06));
  b.sphere('leaf', r * 0.58, 6, x - 0.7, th + r * 0.8, z + 0.6, shade(base, 0.94));
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
/** 多层楼阁/望楼：宫前 3 座 + 四牌坊侧 4 座 + 南端 1 座（判据 ②） */
const TOWER_SITES: readonly [number, number, number][] = [
  [52, -2884, 3], [-52, -2884, 3], [66, -2660, 2],
  [-58, -1852, 2], [58, -822, 2], [-58, 2952, 2],
];

/** 行道树落点：主道 2.6km + 里坊南界外 120m，两侧每 9m 一株（判据要求 8–12m） */
export function centralBeltTreeSites(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const sx of [-1, 1] as const) {
    for (const [a, b] of [[Z_NORTH + 6, -RIVER_PAD], [2880, Z_SOUTH]] as const) {
      for (let z = a; z < b; z += 9) {
        if (z > R5_Z0 && z < R5_Z1) continue;                       // 宫前商业街铺面压着这条线
        if (PAIFANG_Z.some((p) => Math.abs(p - z) < 8)) continue;   // 让开牌坊柱
        if (treeHitsRoad(sx * 21.5, z)) continue;
        out.push({ x: sx * 21.5, z });
      }
    }
  }
  return out;
}

/** 街角花坛：沿御街每 27m 一丛，与行道树错开 4.5m，避开路口与牌坊 */
export function centralBeltFlowerSites(): { x: number; z: number; c: number }[] {
  const out: { x: number; z: number; c: number }[] = [];
  let i = 0;
  for (const sx of [-1, 1] as const) {
    for (let z = Z_NORTH + 15; z < Z_SOUTH; z += 27) {
      if (z > R5_Z0 && z < R5_Z1) continue;
      if (PAIFANG_Z.some((p) => Math.abs(p - z) < 10)) continue;
      if (treeHitsRoad(sx * 24.6, z)) continue;
      out.push({ x: sx * 24.6, z, c: (i++ + (sx > 0 ? 2 : 0)) % 5 });
    }
  }
  return out;
}

/** 覆盖带：两排铺面走廊 |x| ∈ [27,40]（里坊段取 [26.2, 32.2]），分母为各段带面积 */
function bandOf(kind: number): [number, number] {
  return [BAND_IN, kind === KIND_COURT ? COURT_BAND_OUT : SHOP_OUT];
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
  flowers: number;
  towers: number;
  stagger: number;
  /** 宫前主道 + 南端尾段：两排铺面走廊覆盖率（0–1） */
  coverageOpen: number;
  /** 里坊段 6m 铺面带覆盖率（0–1） */
  coverageCourt: number;
  /** 判据 ②：临街铺面 2–3 层占比（0–1） */
  multiStoreyRatio: number;
  /** 判据 ②：面阔 ≥12m 的临街铺面里多层占比 */
  wideMultiRatio: number;
  /** 判据 ④：铺面后墙越过 40m 的间数（必须为 0） */
  zoneViolations: number;
  /** 判据 ③：补了山墙的屋顶数 */
  gables: number;
  /** 判据 ⑥：墙面做法 / 大门形制的分布 */
  wallStyles: Record<string, number>;
  doorStyles: Record<string, number>;
  /** 判据 ①：业态分布与器物计数 */
  trades: Record<string, number>;
  /** 实测尺寸区间（min/max，m） */
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
  let multi = 0;
  let wide = 0;
  let wideMulti = 0;
  let zoneViolations = 0;
  const wallStyles: Record<string, number> = {};
  const doorStyles: Record<string, number> = {};
  const trades: Record<string, number> = {};
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
      if (m.face + m.depth > SHOP_OUT + 0.01) zoneViolations++;
      if (m.floors >= 2) multi++;
      if (m.w >= 12) { wide++; if (m.floors >= 2) wideMulti++; }
      wallStyles[WALL_STYLES[m.style].name] = (wallStyles[WALL_STYLES[m.style].name] ?? 0) + 1;
      doorStyles[DOOR_STYLES[m.door]] = (doorStyles[DOOR_STYLES[m.door]] ?? 0) + 1;
      trades[m.trade] = (trades[m.trade] ?? 0) + 1;
    }
  }
  for (const rp of plan.row2) {
    for (const m of rp.mods) {
      openFoot += areaInBand(m, rp.run.kind);
      shopsRow2++;
      if (m.face + m.depth > BAND_OUT) zoneViolations++;
      wallStyles[WALL_STYLES[m.style].name] = (wallStyles[WALL_STYLES[m.style].name] ?? 0) + 1;
      trades[m.trade] = (trades[m.trade] ?? 0) + 1;
    }
  }
  const sp1 = { w: [Infinity, -Infinity], gap: [Infinity, -Infinity], depth: [Infinity, -Infinity] } as BeltMetrics['spans']['row1'];
  const spc = { w: [Infinity, -Infinity], gap: [Infinity, -Infinity], depth: [Infinity, -Infinity] } as BeltMetrics['spans']['row1court'];
  const sp2 = { w: [Infinity, -Infinity], gap: [Infinity, -Infinity], depth: [Infinity, -Infinity], lane: [Infinity, -Infinity] } as BeltMetrics['spans']['row2'];
  for (const rp of plan.row1) {
    const target = rp.run.kind === KIND_COURT ? spc : sp1;
    for (let i = 0; i < rp.mods.length; i++) {
      const m = rp.mods[i];
      grow(target.w, m.w); grow(target.depth, m.depth);
      const nx = rp.mods[i + 1];
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
  const totalRow1 = shopsRow1 + shopsCourtFront;
  return {
    shopsRow1, shopsRow2, shopsCourtFront,
    duty: DUTY_SITES.length, yards: YARD_SITES.length, wells: WELL_SITES.length,
    paifang: PAIFANG_Z.length, trees: centralBeltTreeSites().length,
    flowers: centralBeltFlowerSites().length,
    towers: TOWER_SITES.length,
    stagger: plan.stagger,
    coverageOpen: openBand > 0 ? openFoot / openBand : 0,
    coverageCourt: courtBand > 0 ? courtFoot / courtBand : 0,
    multiStoreyRatio: totalRow1 > 0 ? multi / totalRow1 : 0,
    wideMultiRatio: wide > 0 ? wideMulti / wide : 0,
    zoneViolations,
    gables: totalRow1 + shopsRow2 + DUTY_SITES.length + YARD_SITES.length,
    wallStyles, doorStyles, trades,
    spans: { row1: sp1, row1court: spc, row2: sp2 },
    runs,
  };
}

/** 判据 ①/②/⑥ 的取样入口：临街铺面落位 + 业态 + 层数 + 墙/门做法（纯计算，不碰几何） */
export function beltShopSites(): {
  x: number; z: number; w: number; d: number; face: number; floors: number;
  trade: ShopTrade; style: string; door: string;
}[] {
  const out: ReturnType<typeof beltShopSites> = [];
  for (const rp of planBelt().row1) {
    for (const m of rp.mods) {
      out.push({
        x: rp.sx * (m.face + m.depth / 2), z: (m.z0 + m.z1) / 2,
        w: m.w, d: m.depth, face: m.face, floors: m.floors,
        trade: m.trade, style: WALL_STYLES[m.style].name, door: DOOR_STYLES[m.door],
      });
    }
  }
  return out;
}

/** 判据 ④ 的机检入口：分区越界与商铺带/院落带的实际范围 */
export function beltZoneAudit(): {
  shopBand: [number, number];
  courtBand: [number, number];
  violations: number;
  maxShopBackWall: number;
  minCourtFront: number;
} {
  const p = planBelt();
  let maxBack = 0;
  let minCourt = Infinity;
  let violations = 0;
  for (const rp of p.row1) {
    for (const m of rp.mods) {
      const back = m.face + m.depth;
      if (back > maxBack) maxBack = back;
      if (back > SHOP_OUT + 0.01) violations++;
    }
  }
  for (const rp of p.row2) {
    for (const m of rp.mods) {
      if (m.face < minCourt) minCourt = m.face;
      if (m.face < COURT_IN) violations++;
    }
  }
  return {
    shopBand: [BAND_IN, SHOP_OUT],
    courtBand: [COURT_IN, BAND_OUT],
    violations,
    maxShopBackWall: maxBack,
    minCourtFront: Number.isFinite(minCourt) ? minCourt : 0,
  };
}

// ============ 总装 ============
/**
 * 中央保留带填实。归因 kit：
 *   belt.shopRow1 / belt.shopRow2 / belt.duty / belt.yard / belt.tree / belt.well / belt.paifang
 *   belt.wall.<夯土|砖砌|板壁|抹灰|木骨> / belt.door.<board|lattice|wutou|gatehouse>
 *   belt.floors1|2|3 / belt.flower / belt.tower
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
  for (const [x, z, f] of TOWER_SITES) pavilionTower(b, x, z, f, f >= 3 ? 11 : 9, Math.round(z));
  for (const p of centralBeltTreeSites()) streetTree(b, p.x, p.z);
  for (const p of centralBeltFlowerSites()) flowerBush(b, p.x, p.z, 0.95, p.c);

  const m = metricsOf(plan);
  b.kit('belt.coverage', Math.round(m.coverageOpen * 1000) / 10, m.coverageOpen);
  b.kit('belt.coverageCourt', Math.round(m.coverageCourt * 1000) / 10, m.coverageCourt);
  b.kit('belt.stagger', Math.round(m.stagger * 100) / 100, m.stagger);
  b.kit('belt.multiStorey', Math.round(m.multiStoreyRatio * 1000) / 10, m.multiStoreyRatio);
  b.kit('belt.wideMulti', Math.round(m.wideMultiRatio * 1000) / 10, m.wideMultiRatio);
  b.kit('belt.zoneViolations', m.zoneViolations, 0);
  b.kit('belt.gables', m.gables, 0);
}
