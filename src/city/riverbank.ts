import { Baker, shade } from './bake';
import { roadBlocked } from './imperial';
import { inLandmarkKeepout } from './layout';
import { riverCenterZ, riverHalfWidth, RIVER_WATER_Y } from './river';

/**
 * 河岸商业带（R2/R3）：沿城内河两岸铺「两排铺面 + 中间一条街」。
 *
 * 判词（用户原话）：
 *  -「河两边的商业区与居民区之间有大片的空地，这不允许，居民区要与商业区紧密结合」
 *  -「河两岸的商业区太短了，没有覆盖城市内的河两岸」
 *  -「河两边原有的商业街，在你添加扩展商业街时，应该是顺着原有的两岸的各有的两排商业建筑添加，
 *    而不是直接补充一长排建筑，把原有的两排建筑加一条路的组合破坏掉！」
 *
 * 现场与改法（不猜，按渲染现场量过）：
 *  旧版从 −4800 一路铺到 +4800，但**每岸只有一排**，前脸固定在 |z|=40、进深 10–14m。
 *  而城里手工段（桥、城门、广场）本来是 `buildings.ts` 的 streetPlots 沿 z=±52 正街铺出的
 *  「水排 33.5–43.5 / 街 46.5–57.5 / 里排 60.5–70.5」——旧版那一排正好插进街心，
 *  把「两排夹一街」压成一堵临水长墙（街被埋到墙后），出城段则只剩一堵墙、后面直接是空地。
 *
 *  现在把断面当成硬契约，两岸统一成一条连续的商业走廊：
 *
 *      水 │ 纤道 3.2m │ 临水排(进深 10–14, 前脸 35.4) │ 街 6–9m │ 内侧排(进深 10–14) │ 里坊空地
 *
 *  · 手工临水段（|x| ≤ 600/620）本来就有 streetPlots 的两排夹一街，本模块整段让开，不叠第三排；
 *    北岸 470–620 只有里排（H_STREETS[3] 只做了 +1 侧），这里只补临水排，正好凑齐两排。
 *  · 每个约 200m 的街块取一组进深/街宽，块内两排的后墙与前脸都是直线，街宽严格落在 6–9m；
 *    街块之间与横街路口处自然错缝，不做成一整条笔直的走廊。
 *  · 每排按 8–20m 面阔分间、间留 1.5–4m 夹道（与既有铺面同一套节奏），过横街按 imperial.roadBlocked
 *    收边跳段，不把路口砌死。
 *  · 临水排朝水面开敞（板门 + 幌子 + 檐下灯），背街一面补后门与窗，街两侧都能进人；
 *    内侧排板门/亮窗/檐柱朝街开脸；街面铺石板，河面收窄段再把「纤道—铺面」之间的裸地铺成河台。
 *  · 位置只依赖坐标 hash（不消耗共享 RNG），下游序列逐值不变。
 */
const H = (a: number, c: number): number => {
  const v = Math.sin(a * 12.9898 + c * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const X0 = -4800, X1 = 4800;
/** 临水排前脸：纤道外缘 34.8 再让 0.6（台基外挑 0.4 也不压纤道） */
const FACE_A = 35.4;
/** 两排进深：与旧版同一档 */
const DEPTH_MIN = 10, DEPTH_MAX = 14;
/** 街宽：宋代街市窄街 */
const STREET_MIN = 6, STREET_MAX = 9;
/** 内侧排后墙上限：南岸大苑囿北界 z=−72，留 1m */
const BACK_LIMIT = 71;
/** 面阔 / 夹道：与既有 1097 间同一套节奏 */
const W_MIN = 8, W_MAX = 20;
const GAP_MIN = 1.5, GAP_MAX = 4;
/** 街块长度：块内进深与街宽取同一组值，保证街两侧都是直线 */
const BLOCK = 200;
/** 横街让位（与 centralbelt 同口径：逐点判 imperial.roadBlocked） */
const ROAD_PAD = 1.5;

/** 手工临水段：streetPlots 已把这一段做成两排夹一街，本模块不重复建 */
const HANDOFF: Record<number, [number, number]> = { 1: [-600, 620], [-1]: [-560, 440] };
/** 北岸 470–620 只有临街里排（H_STREETS[3] 只做 +1 侧），补一列临水排即可凑成两排 */
const ROW_A_ONLY: Record<number, [number, number][]> = { 1: [[470, 620]], [-1]: [] };
/** 五丈河在主河北岸 x=1200 分出，穿临水铺面下涵洞（water.ts WUZHANG_PTS）；两排都让出洞口 */
const CULVERT: Record<number, [number, number]> = { [-1]: [1180, 1240] };

export interface RiverShop {
  side: 1 | -1;
  row: 1 | 2;
  /** 面阔区间（沿 x） */
  x0: number;
  x1: number;
  /** 进深中线 z */
  zc: number;
  depth: number;
  floors: number;
  salt: number;
}

export interface RiverStreet {
  side: 1 | -1;
  x0: number;
  x1: number;
  /** 水侧路缘（临水排后墙）与内侧路缘（内侧排前脸），带符号 */
  zNear: number;
  zFar: number;
}

export interface RiverbandPlan {
  shops: RiverShop[];
  streets: RiverStreet[];
  /** 实测：两排齐全的街块（= streets 里两侧都出铺面的块） */
  blocks: { side: 1 | -1; x0: number; x1: number; streetW: number; rowA: number; rowB: number }[];
}

/** 一个 [a,b] 区间在 side 上是否需要建某排 */
function windowsOf(side: 1 | -1, row: 1 | 2): [number, number][] {
  const out: [number, number][] = [];
  const h = HANDOFF[side];
  out.push([X0, h[0]]);
  out.push([h[1], X1]);
  if (row === 1) for (const w of ROW_A_ONLY[side]) out.push(w);
  return out.filter(([a, b]) => b - a > 20);
}

/** 切块：手工段端点 + 每 BLOCK 一段，块内断面恒定 */
function chunksOf(side: 1 | -1): [number, number][] {
  const pts = new Set<number>([X0, X1]);
  for (const [a, b] of windowsOf(side, 1)) { pts.add(a); pts.add(b); }
  for (const [a, b] of windowsOf(side, 2)) { pts.add(a); pts.add(b); }
  const cuts = [...pts].sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const n = Math.max(1, Math.ceil((b - a) / BLOCK));
    for (let k = 0; k < n; k++) out.push([a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n]);
  }
  return out;
}

/** 沿 x 扫过一段，遇到横街返回第一处压线的 x（1m 步进 + 0.25m 二分细化），无则 −1 */
function firstRoad(z: number, x0: number, x1: number): number {
  for (let x = x0; x <= x1 + 1e-3; x += 1) {
    if (!roadBlocked(x, z, ROAD_PAD)) continue;
    let a = Math.max(x0, x - 1), b = x;
    for (let i = 0; i < 4; i++) {
      const m = (a + b) / 2;
      if (roadBlocked(m, z, ROAD_PAD)) b = m; else a = m;
    }
    return b;
  }
  return -1;
}

/** 从压线点扫出路口，返回对岸第一点 */
function pastRoad(z: number, x: number, xEnd: number): number {
  let xx = x;
  while (xx < xEnd && roadBlocked(xx, z, ROAD_PAD)) xx += 1;
  return xx;
}

const hitsLandmark = (x: number, z: number, w: number, d: number): boolean => {
  const pr = Math.max(w, d) / 2;
  return inLandmarkKeepout(x, z) || inLandmarkKeepout(x - pr, z) || inLandmarkKeepout(x + pr, z)
    || inLandmarkKeepout(x, z - pr) || inLandmarkKeepout(x, z + pr);
};

/** 一排铺面：块内面阔/夹道逐间变，进深恒定（块内后墙成一条直线 → 街宽可控） */
function rowShops(
  side: 1 | -1, row: 1 | 2, c0: number, c1: number,
  face: number, depth: number, salt: number,
): RiverShop[] {
  const out: RiverShop[] = [];
  const zc = side * (face + depth / 2);
  let x = c0;
  while (x < c1 - W_MIN * 0.5) {
    const t = H(x * 0.017, salt + row * 37);
    const w = Math.min(W_MIN + t * (W_MAX - W_MIN), c1 - x);
    const gap = GAP_MIN + H(x * 0.031, salt + row * 37 + 7) * (GAP_MAX - GAP_MIN);
    const floors = H(x * 0.041, salt + row * 37 + 11) > (row === 1 ? 0.72 : 0.84) ? 2 : 1;
    const shop: RiverShop = {
      side, row, x0: x, x1: x + w, zc, depth, floors,
      salt: salt + row * 977 + Math.round(x),
    };
    const hit = firstRoad(zc, x, x + w);
    if (hit >= 0) {
      // 路口收边：够 6m 就把这间压到路缘停下，然后跳到路口对岸续铺
      if (hit - x >= 6 && !hitsLandmark(x + (hit - x) / 2, zc, hit - x, depth)) {
        out.push({ ...shop, x1: hit - 0.8 });
      }
      x = pastRoad(zc, hit, c1) + 0.8;
      continue;
    }
    if (!hitsLandmark(x + w / 2, zc, w, depth)) out.push(shop);
    x += w + gap;
  }
  return out;
}

/** 纯计算：两排 + 街块的规划（build / metrics / 探针共用同一份） */
export function riverbandPlan(): RiverbandPlan {
  const shops: RiverShop[] = [];
  const streets: RiverStreet[] = [];
  const blocks: RiverbandPlan['blocks'] = [];
  for (const side of [1, -1] as const) {
    const winA = windowsOf(side, 1);
    const winB = windowsOf(side, 2);
    const culvert = CULVERT[side];
    for (const [c0, c1] of chunksOf(side)) {
      const buildA = winA.some(([a, b]) => c0 >= a && c1 <= b);
      const buildB = winB.some(([a, b]) => c0 >= a && c1 <= b);
      if (!buildA) continue;
      if (culvert && c1 > culvert[0] && c0 < culvert[1]) continue;
      const salt = Math.round(c0) * 7 + (side > 0 ? 3 : 11);
      // 块内断面恒定：进深 10–14、街宽 6–9
      const dA = DEPTH_MIN + H(c0 * 0.0031, salt) * (DEPTH_MAX - DEPTH_MIN);
      const sw = STREET_MIN + H(c0 * 0.0047, salt + 1) * (STREET_MAX - STREET_MIN);
      const faceB = FACE_A + dA + sw;
      const dB = Math.min(DEPTH_MAX, BACK_LIMIT - faceB);
      const a = rowShops(side, 1, c0, c1, FACE_A, dA, salt);
      shops.push(...a);
      let b: RiverShop[] = [];
      if (buildB) {
        b = rowShops(side, 2, c0, c1, faceB, dB, salt + 5);
        shops.push(...b);
        streets.push({ side, x0: c0, x1: c1, zNear: side * (FACE_A + dA), zFar: side * faceB });
        blocks.push({ side, x0: c0, x1: c1, streetW: sw, rowA: a.length, rowB: b.length });
      }
    }
  }
  return { shops, streets, blocks };
}

// ============ 临水排（朝水面开敞，背街一面留后门） ============
function waterShop(b: Baker, m: RiverShop, wallC: number, roofC: number, flagC: number): void {
  const { side, x0, depth: d } = m;
  const w = m.x1 - m.x0;
  const zc = m.zc;
  const cx = x0 + w / 2;
  const t = H(x0 * 0.017, m.salt);
  const h = m.floors === 2 ? 6.4 + t * 1.6 : 3.8 + t * 1.4;
  // 铺面主体 + 台基与门槛
  b.box('wall', w, h, d, cx, h / 2, zc, wallC);
  b.box('ash', w + 0.8, 0.3, d + 0.8, cx, 0.15, zc, shade(wallC, 0.86));
  // 屋面（两坡：两块斜板 + 正脊）
  // 坡度必须由举高反算：旧版写死 0.30 rad，而 rh 随面阔变化，脊正好浮在坡顶上方 0.1–0.35m
  //（或坡板反过来穿出脊），近景能看到瓦面与正脊之间一条通缝。与 streetShop 同一套算法。
  const rh = 1.1 + w * 0.05;
  const half = d / 2 + 0.5;
  const th = Math.atan2(rh, half);
  const L = Math.hypot(half, rh);
  for (const rs of [-1, 1]) {
    b.box('roof', w + 0.9, 0.18, L * 1.02, cx, h + rh * 0.5, zc + rs * half * 0.5, roofC, 0, rs * th, 0);
  }
  b.box('roof', w + 0.9, 0.22, 0.42, cx, h + rh, zc, shade(roofC, 1.25));
  // 二层挑台（仅 2 层）
  if (m.floors === 2) {
    b.box('wood', w * 0.9, 0.16, 0.9, cx, 3.9, zc - side * (d / 2 + 0.4), shade(0x6b4a2b, 1.05));
    for (let k = 0; k < 4; k++) {
      b.box('wood', 0.1, 0.6, 0.1, x0 + w * (0.12 + 0.25 * k), 4.25, zc - side * (d / 2 + 0.75), 0x4a3220);
    }
  }
  // 临河一面：板门 + 幌子（无字，避免图集依赖）+ 檐下灯
  const zf = zc - side * (d / 2 + 0.06);
  b.box('wood', Math.min(w * 0.5, 2.6), 2.2, 0.12, cx, 1.1, zf, shade(0x3a2418, 1.1));
  const pole = cx + w * 0.34;
  b.box('wood', 0.1, 1.6, 0.1, pole, h + 0.5, zf - side * 0.5, 0x3a2418);
  b.box('fabric', 0.06, 1.1, 0.6, pole, h + 0.9, zf - side * 0.62, flagC);
  b.box('glow', 0.22, 0.3, 0.22, x0 + w * 0.2, h - 0.2, zf - side * 0.3, 0xffb84a);
  // 街侧后门 + 窗：水排背街一面不能是整堵白墙，街要两侧都能进人
  const zb = zc + side * (d / 2 + 0.06);
  b.box('wood', Math.min(w * 0.28, 1.8), 2.0, 0.12, x0 + w * 0.62, 1.0, zb, shade(0x3a2418, 0.95));
  b.box('glow', Math.min(w * 0.16, 1.4), 1.0, 0.09, x0 + w * 0.26, 1.7, zb + side * 0.02, 0xffc66e);
  b.kit('riverbank.shop', 1, h);
}

// ============ 内侧排（朝街开脸） ============
function streetShop(b: Baker, m: RiverShop, wallC: number, roofC: number, flagC: number): void {
  const { side, x0, depth: d } = m;
  const w = m.x1 - m.x0;
  const zc = m.zc;
  const cx = x0 + w / 2;
  const t = H(x0 * 0.019, m.salt);
  const h = m.floors === 2 ? 5.9 + t * 1.5 : 3.6 + t * 1.2;
  b.box('wall', w, h, d, cx, h / 2, zc, wallC);
  b.box('ash', w + 0.7, 0.28, d + 0.7, cx, 0.14, zc, shade(wallC, 0.84));
  // 双坡顶：脊沿 x
  const rh = 1.0 + w * 0.045;
  const L = Math.hypot(d / 2, rh);
  const th = Math.atan2(rh, d / 2);
  for (const rs of [-1, 1] as const) {
    b.box('roof', w + 0.8, 0.18, L * 1.02, cx, h + rh / 2, zc + (rs * d) / 4, roofC, 0, rs * th, 0);
  }
  b.box('roof', w + 0.9, 0.2, 0.4, cx, h + rh, zc, shade(roofC, 1.24));
  // 朝街一面：板门 + 两扇亮窗 + 檐柱
  const zf = zc - side * (d / 2 + 0.06);
  b.box('wood', Math.min(w * 0.42, 3.2), 2.2, 0.14, cx, 1.1, zf, 0x3a2418);
  for (const s2 of [-1, 1]) {
    b.box('glow', Math.min(w * 0.17, 1.9), 1.15, 0.1, cx + s2 * w * 0.3, 1.9, zf - side * 0.02, 0xffd8a0);
  }
  const nCol = Math.max(2, Math.min(4, Math.round(w / 4.2)));
  for (let k = 0; k < nCol; k++) {
    const px = x0 + w * ((k + 0.5) / nCol);
    b.box('wood', 0.24, h - 0.5, 0.24, px, (h - 0.5) / 2 + 0.28, zf - side * 0.22, 0x4a3220);
  }
  // 幌子挑向街心 + 檐下灯
  const pz = cx + w * 0.4;
  b.box('wood', 0.09, 2.4, 0.09, pz, 2.3, zf - side * 0.45, 0x4a3220);
  b.box('fabric', 0.06, 1.0, 0.85, pz, 2.6, zf - side * 0.85, flagC);
  b.box('glow', 0.24, 0.32, 0.24, cx - w * 0.3, h - 0.35, zf - side * 0.28, 0xffb84a);
  b.kit('riverbank.shopRow2', 1, h);
}

// ============ 街面：石板一条，铺到内侧排前脸 ============
function streetPaving(b: Baker, s: RiverStreet): void {
  const zs = s.side * (FACE_A + DEPTH_MIN - 0.4);   // 从最浅的临水排后墙起铺，深排下方被遮住
  const ze = s.zFar;
  const mid = (zs + ze) / 2;
  const wide = Math.abs(ze - zs);
  for (let x = s.x0; x < s.x1; x += 30) {
    const x1 = Math.min(s.x1, x + 30);
    const midX = (x + x1) / 2;
    const tone = 0.94 + H(x * 0.013, s.side + 3) * 0.12;
    b.box('ground', x1 - x + 0.6, 0.16, wide, midX, 0.045, mid, shade(0x8a7f6c, tone));
    // 路边石：贴着内侧排前脸，把街读成街而不是空地
    b.box('ash', x1 - x + 0.6, 0.1, 0.34, midX, 0.1, ze - s.side * 0.17, shade(0x9a9080, tone));
  }
  b.kit('riverbank.paving', 1, 0.12);
}

export function buildRiverbank(b: Baker): void {
  const WALL_TONES = [0x8a7a68, 0x9a8a72, 0x7d6f5e, 0x8f8272];
  const ROOF_TONES = [0x333a45, 0x2a2f36, 0x4a3a2c, 0x3a4a42];
  const FLAG_TONES = [0x5c1b24, 0x24483a, 0x3a3448, 0xa87a2a];
  const plan = riverbandPlan();
  let count = 0;
  for (const m of plan.shops) {
    const t = H(m.x0 * 0.007, m.salt);
    const wallC = WALL_TONES[(t * WALL_TONES.length) | 0];
    const roofC = ROOF_TONES[(H(m.x0 * 0.011, m.salt + 9) * ROOF_TONES.length) | 0];
    const flagC = FLAG_TONES[(H(m.x0 * 0.005, m.salt + 5) * FLAG_TONES.length) | 0];
    if (m.row === 1) waterShop(b, m, wallC, roofC, flagC);
    else streetShop(b, m, wallC, roofC, flagC);
    count++;
  }
  for (const s of plan.streets) streetPaving(b, s);

  // ---- 河沿 apron：城外段河面收窄（半宽 31→21），纤道外缘与铺面前脸之间会露出 0–11m 裸地。
  //      这一段铺成石板河台，让「纤道 → 河台 → 铺面」连成一条连续的滨河街面，而不是店铺悬在沙地上。
  let apronSegs = 0;
  for (const sz of [1, -1] as const) {
    for (let x = X0; x < X1; x += 30) {
      const x1 = Math.min(X1, x + 30);
      const mx = (x + x1) / 2;
      const zs = riverCenterZ(mx) + sz * (riverHalfWidth(mx) + 3.8);   // 纤道外缘
      const ze = sz * FACE_A;                                          // 临水排前脸
      const wide = Math.abs(ze - zs);
      if (wide < 1.2) continue;
      b.box('ground', x1 - x + 0.6, 0.12, wide, mx, 0.035, (zs + ze) / 2,
        shade(0x7f7562, 0.96 + H(x * 0.009, sz + 21) * 0.10));
      apronSegs++;
    }
  }
  b.kit('riverbank.apron', apronSegs, 0.1);

  // ---- 纤道（R13）：两岸连续、宽 3.2m、顶面 = 水面 +0.35m、碎石夯土，不接车行道 ----
  // 位置跟着河心/河宽走（riverCenterZ / riverHalfWidth），所以蜿蜒段也贴在水缘外，不会伸进水面。
  // 顶面 1.35 = 水 1.0 + 0.35；岸上地面只有 0，所以纤道要砌成实心岸台（-0.3 → 1.35），
  // 外缘那道 1.35m 的挡墙就是它与 z=±52 正街之间唯一的连接面——车行道接不上来。
  const TOW_W = 3.2, TOW_BOT = -0.3, TOW_GAP = 0.6, TOW_STEP = 30;
  const TOW_TOP = RIVER_WATER_Y + 0.35;
  let towSegs = 0;
  for (const sz of [1, -1] as const) {
    for (let x = X0; x < X1; x += TOW_STEP) {
      const x1 = Math.min(X1, x + TOW_STEP);
      const mx = (x + x1) / 2;
      const zc = riverCenterZ(mx) + sz * (riverHalfWidth(mx) + TOW_GAP + TOW_W / 2);
      // 相邻段搭接 1.2m：弯曲段 30m 内的正弦偏差 <0.3m，搭接后不露缝
      b.box('earth', x1 - x + 1.2, TOW_TOP - TOW_BOT, TOW_W, mx, (TOW_TOP + TOW_BOT) / 2, zc,
        shade(0x8a7f6a, 0.94 + H(x * 0.011, sz + 13) * 0.10));
      towSegs++;
    }
  }
  b.kit('riverbank.towpath', towSegs, TOW_TOP);
  b.kit('riverbank.total', count, 0);
  b.kit('riverbank.blocks', plan.blocks.length, 0);
}
