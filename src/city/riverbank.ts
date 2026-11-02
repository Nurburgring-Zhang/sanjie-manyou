import { Baker, shade } from './bake';
import { roadBlocked } from './imperial';
import { inLandmarkKeepout } from './layout';
import { riverCenterZ, riverHalfWidth, RIVER_WATER_Y } from './river';
import { buildTradeInterior, flowerBush, gableTriangle, pickTrade, type ShopTrade, type TradeRoomSpec } from './interiors';
import { gableSlopeRibbed } from './buildings';

/**
 * 河岸商业带（R2/R3 + R16）：沿城内河两岸铺「两排铺面 + 中间一条街」。
 *
 * 判词（用户原话）：
 *  -「河两边的商业区与居民区之间有大片的空地，这不允许，居民区要与商业区紧密结合」
 *  -「河两岸的商业区太短了，没有覆盖城市内的河两岸」
 *  -「河两边原有的商业街，在你添加扩展商业街时，应该是顺着原有的两岸的各有的两排商业建筑添加，
 *    而不是直接补充一长排建筑，把原有的两排建筑加一条路的组合破坏掉！」
 *  -「所有店铺等场所内，应该有什么家具、摆设、布局、物品、装饰等」（R16）
 *  -「主街两侧的商铺不仅要单层的，还有有多层的」（R16）
 *  -「很多房顶为什么两侧都是空的？？？」（R16）
 *  -「要求过的河上很多座不同的桥呢？」（R16）
 *
 * 断面（R16 后不变，仍是硬契约）：
 *
 *      水 │ 纤道 3.2m │ 临水排(进深 10–14, 前脸 35.4) │ 街 6–9m │ 内侧排(进深 10–14) │ 里坊空地
 *
 * R16 在这一层加的四件事：
 *  ① **薄壁 + 门洞 + 室内**：铺面从实心盒改成 6 块薄壁（后墙/两山墙/两前垛/门楣），
 *     留 2.6–3.0m 门洞；室内按业态摆 9 件单盒形制（河岸 2021 间，走 interiors.ts 的 compact 档位）。
 *  ② **多层**：层数由面阔决定（≥12m 必 2–3 层），多层铺面在 3.5m 处补一道腰檐。
 *  ③ **山墙封口**：双坡板顶两端补三角山墙（2 面/端），屋腔不再外露。
 *  ④ **绿化 + 桥**：河岸补柳（垂枝柳 90 面/株）与 5 色花丛；汴河与两条支渠上补 4 座不同形制的桥，
 *     与既有 虹桥(贯木拱) / 永宁(石拱) / 通济(木梁) / 浮梁(浮桥) 合计 8 座、6 种形制。
 *
 * 位置只依赖坐标 hash（不消耗共享 RNG），下游序列逐值不变。
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
/** 墙厚 / 地坪上皮 */
const TW = 0.26;
const GY = 0.30;

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
  trade: ShopTrade;
  variant: number;
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

/** 层数 × 面阔（判据 ②）：≥12m 必多层，≥16m 有 40% 做三层；<12m 只有 26% 两层 */
function floorsOf(w: number, u: number): number {
  if (w >= 16) return u < 0.40 ? 3 : 2;
  if (w >= 12) return u < 0.28 ? 3 : 2;
  return u < 0.26 ? 2 : 1;
}

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
    const floors = floorsOf(w, H(x * 0.041, salt + row * 37 + 11));
    const { trade, variant } = pickTrade(x + w / 2, zc);
    const shop: RiverShop = {
      side, row, x0: x, x1: x + w, zc, depth, floors, trade, variant,
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

/** 审计入口：河岸两条带全部铺面的室内参数（纯计算，与 build 共用 riverRoomSpec） */
export function riverRoomSpecs(): TradeRoomSpec[] {
  return riverbandPlan().shops.map(riverRoomSpec);
}

// ============ 铺面（R16：薄壁壳 + 门洞 + 山墙 + 室内） ============
/**
 * 两排共用的体块：台基 / 薄壁壳（留门洞）/ 双坡板顶 / 两端山墙 / 多层腰檐 / 室内。
 * @param faceZ 前脸（街侧）的 z，带符号
 * @param dir   进深方向（+1 = 往 +z，−1 = 往 −z）
 */
function shopShell(
  b: Baker, m: RiverShop, cx: number, w: number, d: number, zc: number, dir: 1 | -1,
  h: number, wallC: number, roofC: number, kit: string,
): void {
  // 台基（顶面即室内地坪）
  b.box('ash', w + 0.7, GY, d + 0.7, cx, GY / 2, zc, shade(wallC, 0.86));
  // 后墙（远离街的一侧）
  b.box('wall', w - TW * 2, h, TW, cx, GY + h / 2, zc + dir * (d / 2 - TW / 2), wallC);
  // 两山墙（沿进深）
  for (const s of [-1, 1] as const) {
    b.box('wall', TW, h, d - TW * 2, cx + s * (w / 2 - TW / 2), GY + h / 2, zc, shade(wallC, 0.96));
  }
  // 前墙：中间留门洞 + 两侧墙垛 + 门楣
  const dw = Math.min(w * 0.4, 3.0);
  const seg = (w - TW * 2 - dw) / 2;
  for (const s of [-1, 1] as const) {
    b.box('wall', seg, h, TW, cx + s * (dw / 2 + seg / 2), GY + h / 2, zc - dir * (d / 2 - TW / 2), wallC);
  }
  b.box('wall', dw, h - 2.5, TW, cx, GY + 2.5 + (h - 2.5) / 2, zc - dir * (d / 2 - TW / 2), wallC);
  // 板门（半掩）：门洞两侧的墙垛本身就是门框，不再另加两根门套（2021 间 × 24 面 = 48k）
  b.box('wood', dw * 0.46, 2.36, 0.1, cx - dw * 0.24, GY + 1.18, zc - dir * (d / 2 - 0.02), 0x3a2418);
  // 双坡瓦顶（脊沿 x）：旧版是两块 0.18m 素板——没有瓦垄、没有连檐、没有滴水，
  // 俯视就是一整块灰板（用户三次投诉的"灰平板"在河岸带就是这个）。近景区换成
  // 带 0.34m 瓦垄顶点色的坡面 + 连续连檐/滴水；远景区（|x|≥1200）仍保留两块板，
  // 每间多 152 面的代价只花在长卷镜头能看清的河段上。
  const rh = 1.0 + w * 0.045;
  const half = d / 2 + 0.5;
  const th = Math.atan2(rh, half);
  const near = Math.abs(cx) < 1200;
  for (const rs of [-1, 1] as const) {
    if (near) {
      gableSlopeRibbed(b, cx, GY + h, zc, 0, w / 2 + 0.45, half, rh, rs, roofC);
    } else {
      const L = Math.hypot(half, rh);
      b.box('roof', w + 0.9, 0.18, L * 1.02, cx, GY + h + rh / 2, zc + (rs * d) / 4, roofC, 0, rs * th, 0);
    }
    // 连檐 + 滴水：檐口收一条硬边，两坡共用
    b.box('roof', w + 0.9, 0.16, 0.34, cx, GY + h - 0.05, zc + rs * half, shade(roofC, 0.7));
    b.box('roof', w + 0.9, 0.1, 0.16, cx, GY + h - 0.16, zc + rs * (half + 0.06), shade(roofC, 0.55));
  }
  b.box('roof', w + 0.9, 0.22, 0.42, cx, GY + h + rh, zc, shade(roofC, 1.25));
  // 两端山墙（判据 ③）：每端 2 面，封闭板顶屋腔
  for (const s of [-1, 1] as const) {
    gableTriangle(b, half, rh * 1.02, cx + s * (w + 0.9) / 2, GY + h, zc, s > 0 ? Math.PI / 2 : -Math.PI / 2, wallC);
  }
  // 多层腰檐（判据 ②）：一道沿街披檐 + 平座板，不做整跑楼梯（2021 间 × 84 面 = 170k）
  if (m.floors >= 2) {
    b.box('roof', w + 0.3, 0.14, 0.72, cx, GY + 3.72, zc - dir * (d / 2 + 0.2), shade(0x3a4450, 1.1), 0, dir * 0.36, 0);
    b.box('wood', w * 0.94, 0.14, 0.9, cx, GY + 3.5, zc - dir * (d / 2 + 0.28), shade(0x6b4a2b, 1.05));
    if (m.floors >= 3) {
      b.box('roof', w + 0.3, 0.13, 0.66, cx, GY + 6.7, zc - dir * (d / 2 + 0.18), shade(0x3a4450, 1.04), 0, dir * 0.36, 0);
    }
    // 二层亮窗（固定 2 樘：按面阔开 2–5 樘要多花 18k 面，2021 间下来不值）
    for (let k = 0; k < 2; k++) {
      const xx = cx + (k - 0.5) * (w - 2.4) * 0.55;
      b.box('glow', 1.9, 1.25, 0.1, xx, GY + 4.6, zc - dir * (d / 2 - 0.04), 0xffc66e);
    }
  }
  // 室内（判据 ①）：参数见 riverRoomSpec
  buildTradeInterior(b, riverRoomSpec(m));
  b.kit(kit, 1, h);
}

// ============ 铺面断面的单一真相源 ============
// 檐高与室内参数同时被 build 与 tests/shopInterior.test.ts 的审计读取；两处各写一份必然漂移。
const SHOP_TW = 0.28;

/** 两排各自的檐高（临水排与内侧排用的是不同的 hash 盐，不能合并） */
export function riverShopH(m: RiverShop): number {
  const t = m.row === 1 ? H(m.x0 * 0.017, m.salt) : H(m.x0 * 0.019, m.salt);
  if (m.row === 1) return m.floors === 1 ? 3.9 + t * 1.3 : m.floors === 2 ? 7.0 + t * 1.2 : 10.1 + t * 1.2;
  return m.floors === 1 ? 3.7 + t * 1.1 : m.floors === 2 ? 6.8 + t * 1.1 : 9.9 + t * 1.1;
}

/** 河岸铺面的室内参数（两排同档：进深 10–14、面阔 7–16，地坪 GY） */
export function riverRoomSpec(m: RiverShop): TradeRoomSpec {
  const w = m.x1 - m.x0;
  return {
    cx: m.x0 + w / 2, cz: m.zc,
    w: w - SHOP_TW * 2 - 0.1, d: m.depth - SHOP_TW * 2 - 0.1,
    y0: GY, h: riverShopH(m) - 0.1,
    trade: m.trade, variant: m.variant,
    ux: 1, uz: 0, vx: 0, vz: m.side,
    ceiling: false, maxItems: 8,
  };
}

// ============ 临水排（朝水面开敞，背街一面留后门） ============
function waterShop(b: Baker, m: RiverShop, wallC: number, roofC: number, flagC: number): void {
  const { side, x0, depth: d } = m;
  const w = m.x1 - m.x0;
  const zc = m.zc;
  const cx = x0 + w / 2;
  const h = riverShopH(m);
  shopShell(b, m, cx, w, d, zc, side, h, wallC, roofC, 'riverbank.shop');
  // 临河一面：幌子（挑向水面）+ 檐下灯
  const zf = zc - side * (d / 2 + 0.06);
  const pole = cx + w * 0.34;
  b.box('wood', 0.1, 1.6, 0.1, pole, h + 0.5, zf - side * 0.5, 0x3a2418);
  b.box('fabric', 0.06, 1.1, 0.6, pole, h + 0.9, zf - side * 0.62, flagC);
  b.box('glow', 0.22, 0.3, 0.22, x0 + w * 0.2, h - 0.2, zf - side * 0.3, 0xffb84a);
  // 背街后窗
  const zb = zc + side * (d / 2 + 0.06);
  b.box('glow', Math.min(w * 0.16, 1.4), 1.0, 0.09, x0 + w * 0.26, GY + 1.7, zb, 0xffc66e);
}

// ============ 内侧排（朝街开脸） ============
function streetShop(b: Baker, m: RiverShop, wallC: number, roofC: number, flagC: number): void {
  const { side, x0, depth: d } = m;
  const w = m.x1 - m.x0;
  const zc = m.zc;
  const cx = x0 + w / 2;
  const h = riverShopH(m);
  shopShell(b, m, cx, w, d, zc, side, h, wallC, roofC, 'riverbank.shopRow2');
  // 朝街一面：檐柱两列 + 幌子 + 檐下灯
  const zf = zc - side * (d / 2 + 0.06);
  const nCol = Math.max(2, Math.min(4, Math.round(w / 4.2)));
  for (let k = 0; k < nCol; k++) {
    const px = x0 + w * ((k + 0.5) / nCol);
    b.box('wood', 0.24, h - 0.5, 0.24, px, (h - 0.5) / 2 + GY, zf - side * 0.22, 0x4a3220);
  }
  const pz = cx + w * 0.4;
  b.box('wood', 0.09, 2.4, 0.09, pz, 2.3, zf - side * 0.45, 0x4a3220);
  b.box('fabric', 0.06, 1.0, 0.85, pz, 2.6, zf - side * 0.85, flagC);
  b.box('glow', 0.24, 0.32, 0.24, cx - w * 0.3, h - 0.35, zf - side * 0.28, 0xffb84a);
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
    b.box('ash', x1 - x + 0.6, 0.1, 0.34, midX, 0.1, ze - s.side * 0.17, shade(0x9a9080, tone));
  }
  b.kit('riverbank.paving', 1, 0.12);
}

// ============ 河岸绿化（判据 ⑤）：垂柳 + 5 色花丛 ============
/** 垂枝柳：干 + 冠 + 三条垂枝（90 面/株，比 props.willow 省 2/3） */
function riversideWillow(b: Baker, x: number, z: number, s: number): void {
  const th = 2.9 * s;
  b.cyl('trunk', 0.14 * s, 0.24 * s, th, 5, x, th / 2, z, 0x574530);
  b.sphere('leaf', 1.15 * s, 4, x, th + 0.45 * s, z, shade(0x4c7a42, 0.96), 0, 0, 0, 1, 0.8, 1);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + x * 0.07;
    b.box('leaf', 0.3 * s, 1.5 * s, 0.3 * s, x + Math.cos(a) * 0.95 * s, th - 0.35 * s, z + Math.sin(a) * 0.95 * s, shade(0x577f46, 0.94 + k * 0.04));
  }
  b.kit('riverbank.willow', 1, th);
}

/** 河岸柳/花的落点：两排铺面之外只有纤道，故种在纤道外侧 0.6m 的岸肩上 */
function bankGreenery(b: Baker): void {
  let n = 0;
  let f = 0;
  for (const side of [1, -1] as const) {
    for (let x = X0 + 24; x < X1; x += 40) {
      if (Math.abs(x) < 62) continue;                       // 虹桥桥头让开
      const jx = x + (H(x * 0.011, side + 5) - 0.5) * 9;
      const zc = riverCenterZ(jx) + side * (riverHalfWidth(jx) + 1.4);
      // 与铺面前脸 35.4 之间要留出纤道：只在河面收窄段（岸肩 ≥2m）种
      if (Math.abs(Math.abs(zc) - FACE_A) < 2.4) continue;
      if (H(jx * 0.017, side + 7) > 0.42) {
        riversideWillow(b, jx, zc, 0.9 + H(jx * 0.019, side + 9) * 0.5);
        n++;
      } else {
        flowerBush(b, jx, zc, 0.95, (Math.round(jx / 33) + (side > 0 ? 1 : 3)) % 5);
        f++;
      }
    }
  }
  b.kit('riverbank.greeneryTrees', n, 0);
  b.kit('riverbank.greeneryFlowers', f, 0);
}

// ============ R16 新桥：汴河 2 座 + 蔡河 1 座 + 五丈河 1 座 ============
/**
 * 既有桥（bridge.ts）：虹桥 x=0（贯木拱）/ 石拱 x=−1680 / 木梁 x=1620 / 浮桥 x=−2480（浮梁）。
 * 本段补 4 座，合计 8 座、6 种形制，位置一律落在水面上（不压码头、不压里坊）：
 *   廊桥 汴河 x=−3400 · 浮桥 汴河 x=+3400 · 石拱 蔡河 z=1550 · 叠梁拱 五丈河 x=1450
 */
interface BridgeSite { cx: number; cz: number; span: number; wide: number; along: 'x' | 'z'; deckY: number; waterY: number }

function railRun(b: Baker, s: BridgeSite, deckY: number, hex: number): void {
  const n = Math.max(4, Math.round(s.span / 2.4));
  for (const sd of [-1, 1] as const) {
    // 扶手通长 + 望柱
    if (s.along === 'x') {
      b.box('wood', s.span, 0.1, 0.12, s.cx, deckY + 0.95, s.cz + sd * (s.wide / 2 - 0.1), hex);
      for (let k = 0; k <= n; k++) b.box('wood', 0.12, 1.0, 0.12, s.cx - s.span / 2 + (s.span * k) / n, deckY + 0.5, s.cz + sd * (s.wide / 2 - 0.1), hex);
    } else {
      b.box('wood', 0.12, 0.1, s.span, s.cx + sd * (s.wide / 2 - 0.1), deckY + 0.95, s.cz, hex);
      for (let k = 0; k <= n; k++) b.box('wood', 0.12, 1.0, 0.12, s.cx + sd * (s.wide / 2 - 0.1), deckY + 0.5, s.cz - s.span / 2 + (s.span * k) / n, hex);
    }
  }
}

/** 石拱桥：两座桥台 + 7 段拱券 + 桥面 + 栏板 */
function stoneArchBridge(b: Baker, s: BridgeSite): void {
  const bankH = s.deckY - 1.4;
  for (const sd of [-1, 1] as const) {
    const off = (s.span / 2 - 1.6) * sd;
    if (s.along === 'x') b.box('ash', 3.2, bankH, s.wide + 1.2, s.cx + off, bankH / 2, s.cz, 0x8f8878);
    else b.box('ash', s.wide + 1.2, bankH, 3.2, s.cx, bankH / 2, s.cz + off, 0x8f8878);
  }
  const N = 7;
  const halfSpan = s.span / 2 - 3.2;
  for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N;                     // 0..1 跨中到跨端
    const u = (t * 2 - 1);                       // −1..1
    const y = s.deckY - 1.1 - (1 - u * u) * 1.9; // 拱券下缘
    const ang = Math.atan2(2 * u * 1.9, halfSpan);
    if (s.along === 'x') {
      b.box('ash', (halfSpan * 2) / N + 0.3, 0.55, s.wide + 0.6, s.cx + u * halfSpan, y, s.cz, k % 2 ? 0x8f8878 : 0x847d6d, 0, 0, ang);
    } else {
      b.box('ash', s.wide + 0.6, 0.55, (halfSpan * 2) / N + 0.3, s.cx, y, s.cz + u * halfSpan, k % 2 ? 0x8f8878 : 0x847d6d, 0, -ang, 0);
    }
  }
  if (s.along === 'x') b.box('ash', s.span, 0.4, s.wide, s.cx, s.deckY - 0.2, s.cz, 0x9a9080);
  else b.box('ash', s.wide, 0.4, s.span, s.cx, s.deckY - 0.2, s.cz, 0x9a9080);
  railRun(b, s, s.deckY, 0x7f7566);
  b.kit('bridge.new.stoneArch', 1, s.deckY);
}

/** 叠梁拱（贯木拱）：五层木梁逐层内收，形成折线拱 */
function stackedBeamBridge(b: Baker, s: BridgeSite): void {
  const halfSpan = s.span / 2 - 1.5;
  for (let k = 0; k < 5; k++) {
    const t = k / 4;                             // 0 底 1 顶
    const w = halfSpan * 2 * (0.42 + 0.58 * t);
    const y = s.waterY + 1.0 + t * (s.deckY - s.waterY - 1.6);
    const th = 0.34;
    if (s.along === 'x') b.box('wood', w, th, s.wide + 0.5, s.cx, y, s.cz, shade(0x7a5636, 1.0 + k * 0.05));
    else b.box('wood', s.wide + 0.5, th, w, s.cx, y, s.cz, shade(0x7a5636, 1.0 + k * 0.05));
  }
  // 桥面 + 两端桥台
  if (s.along === 'x') b.box('wood', s.span, 0.24, s.wide, s.cx, s.deckY - 0.12, s.cz, 0x8a6540);
  else b.box('wood', s.wide, 0.24, s.span, s.cx, s.deckY - 0.12, s.cz, 0x8a6540);
  for (const sd of [-1, 1] as const) {
    if (s.along === 'x') b.box('ash', 2.6, s.deckY - 0.2, s.wide + 0.8, s.cx + sd * (s.span / 2 - 1.3), (s.deckY - 0.2) / 2, s.cz, 0x8f8878);
    else b.box('ash', s.wide + 0.8, s.deckY - 0.2, 2.6, s.cx, (s.deckY - 0.2) / 2, s.cz + sd * (s.span / 2 - 1.3), 0x8f8878);
  }
  railRun(b, s, s.deckY, 0x6b4a2b);
  b.kit('bridge.new.stackedBeam', 1, s.deckY);
}

/** 浮桥：一排浮舟托桥面 + 两端系缆桩 */
function pontoonBridgeNew(b: Baker, s: BridgeSite): void {
  const n = 8;
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n - 0.5;
    const y = s.waterY + 0.28;
    if (s.along === 'x') b.cyl('wood', 0.62, 0.62, s.wide * 0.9, 6, s.cx + u * (s.span - 2), y, s.cz, 0x8a6540, 0, 0, Math.PI / 2);
    else b.cyl('wood', 0.62, 0.62, s.wide * 0.9, 6, s.cx, y, s.cz + u * (s.span - 2), 0x8a6540, Math.PI / 2, 0, 0);
  }
  if (s.along === 'x') b.box('wood', s.span, 0.2, s.wide, s.cx, s.waterY + 0.86, s.cz, 0x9a7b4a);
  else b.box('wood', s.wide, 0.2, s.span, s.cx, s.waterY + 0.86, s.cz, 0x9a7b4a);
  railRun(b, { ...s, deckY: s.waterY + 0.86 }, s.waterY + 0.86, 0x7a5636);
  for (const sd of [-1, 1] as const) {
    if (s.along === 'x') b.box('wood', 0.28, 2.4, 0.28, s.cx + sd * (s.span / 2 - 0.4), 1.2, s.cz, 0x4a3220);
    else b.box('wood', 0.28, 2.4, 0.28, s.cx, 1.2, s.cz + sd * (s.span / 2 - 0.4), 0x4a3220);
  }
  b.kit('bridge.new.pontoon', 1, s.waterY + 0.86);
}

/** 廊桥：石砌桥台 + 木桥面 + 两排廊柱 + 双坡廊顶 + 栏板 */
function coveredBridge(b: Baker, s: BridgeSite): void {
  for (const sd of [-1, 1] as const) {
    if (s.along === 'x') b.box('ash', 3.0, s.deckY - 0.3, s.wide + 1.4, s.cx + sd * (s.span / 2 - 1.5), (s.deckY - 0.3) / 2, s.cz, 0x8f8878);
    else b.box('ash', s.wide + 1.4, s.deckY - 0.3, 3.0, s.cx, (s.deckY - 0.3) / 2, s.cz + sd * (s.span / 2 - 1.5), 0x8f8878);
  }
  if (s.along === 'x') b.box('wood', s.span, 0.26, s.wide, s.cx, s.deckY - 0.13, s.cz, 0x8a6540);
  else b.box('wood', s.wide, 0.26, s.span, s.cx, s.deckY - 0.13, s.cz, 0x8a6540);
  const n = Math.max(4, Math.round(s.span / 3));
  for (let k = 0; k <= n; k++) {
    const u = -s.span / 2 + (s.span * k) / n;
    for (const sd of [-1, 1] as const) {
      if (s.along === 'x') b.box('wood', 0.2, 2.5, 0.2, s.cx + u, s.deckY + 1.25, s.cz + sd * (s.wide / 2 - 0.2), 0x6b4a2b);
      else b.box('wood', 0.2, 2.5, 0.2, s.cx + sd * (s.wide / 2 - 0.2), s.deckY + 1.25, s.cz + u, 0x6b4a2b);
    }
  }
  // 双坡廊顶（脊沿桥向）
  const rise = 1.15;
  const halfW = s.wide / 2 + 0.5;
  const th = Math.atan2(rise, halfW);
  const L = Math.hypot(halfW, rise);
  for (const sd of [-1, 1] as const) {
    if (s.along === 'x') b.box('roof', s.span + 0.6, 0.16, L, s.cx, s.deckY + 2.5 + rise / 2, s.cz + sd * halfW * 0.5, 0x3a4450, 0, sd * th, 0);
    else b.box('roof', L, 0.16, s.span + 0.6, s.cx + sd * halfW * 0.5, s.deckY + 2.5 + rise / 2, s.cz, 0x3a4450, 0, 0, -sd * th);
  }
  if (s.along === 'x') b.box('roof', s.span + 0.7, 0.2, 0.36, s.cx, s.deckY + 2.5 + rise, s.cz, 0x4a5560);
  else b.box('roof', 0.36, 0.2, s.span + 0.7, s.cx, s.deckY + 2.5 + rise, s.cz, 0x4a5560);
  // 廊内挂灯
  for (let k = 1; k < n; k += 3) {
    const u = -s.span / 2 + (s.span * k) / n;
    if (s.along === 'x') b.box('glow', 0.24, 0.3, 0.24, s.cx + u, s.deckY + 2.1, s.cz, 0xffc66e);
    else b.box('glow', 0.24, 0.3, 0.24, s.cx, s.deckY + 2.1, s.cz + u, 0xffc66e);
  }
  b.kit('bridge.new.covered', 1, s.deckY);
}

/** 4 座新桥的落位（不压码头：码头甲板在 x −259/−217；不压既有桥 x 0/±1620/−1680/−2480） */
export function buildRiverBridges(b: Baker): void {
  // 汴河：河心随 x 起伏、河宽随 x 收放，桥面按实测河宽铺
  for (const [bx, kind] of [[-3400, 'covered'], [3400, 'pontoon']] as const) {
    const cz = riverCenterZ(bx);
    const span = riverHalfWidth(bx) * 2 + 9;
    const site: BridgeSite = { cx: bx, cz, span, wide: 6.2, along: 'z', deckY: 3.4, waterY: RIVER_WATER_Y };
    if (kind === 'covered') coveredBridge(b, site);
    else pontoonBridgeNew(b, site);
  }
  // 蔡河（水.ts 支渠，河心 x≈597，宽 20）：石拱，桥面沿 x 跨
  stoneArchBridge(b, { cx: 597, cz: 1550, span: 30, wide: 5.6, along: 'x', deckY: 3.6, waterY: RIVER_WATER_Y });
  // 五丈河（自 (1200,−64) 向东南，宽 15）：叠梁拱，桥面沿 z 跨，中心取 x=1450 处河心 z≈−138
  stackedBeamBridge(b, { cx: 1450, cz: -138, span: 24, wide: 5.2, along: 'z', deckY: 3.4, waterY: RIVER_WATER_Y });
  b.kit('riverbank.bridges', 4, 0);
}

export function buildRiverbank(b: Baker): void {
  const WALL_TONES = [0x8a7a68, 0x9a8a72, 0x7d6f5e, 0x8f8272, 0x94836d];
  const ROOF_TONES = [0x333a45, 0x2a2f36, 0x4a3a2c, 0x3a4a42];
  const FLAG_TONES = [0x5c1b24, 0x24483a, 0x3a3448, 0xa87a2a];
  const plan = riverbandPlan();
  let count = 0;
  let multi = 0;
  for (const m of plan.shops) {
    const t = H(m.x0 * 0.007, m.salt);
    const wallC = WALL_TONES[(t * WALL_TONES.length) | 0];
    const roofC = ROOF_TONES[(H(m.x0 * 0.011, m.salt + 9) * ROOF_TONES.length) | 0];
    const flagC = FLAG_TONES[(H(m.x0 * 0.005, m.salt + 5) * FLAG_TONES.length) | 0];
    if (m.row === 1) waterShop(b, m, wallC, roofC, flagC);
    else streetShop(b, m, wallC, roofC, flagC);
    if (m.floors >= 2) multi++;
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
  const TOW_W = 3.2, TOW_BOT = -0.3, TOW_GAP = 0.6, TOW_STEP = 30;
  const TOW_TOP = RIVER_WATER_Y + 0.35;
  let towSegs = 0;
  for (const sz of [1, -1] as const) {
    for (let x = X0; x < X1; x += TOW_STEP) {
      const x1 = Math.min(X1, x + TOW_STEP);
      const mx = (x + x1) / 2;
      const zc = riverCenterZ(mx) + sz * (riverHalfWidth(mx) + TOW_GAP + TOW_W / 2);
      b.box('earth', x1 - x + 1.2, TOW_TOP - TOW_BOT, TOW_W, mx, (TOW_TOP + TOW_BOT) / 2, zc,
        shade(0x8a7f6a, 0.94 + H(x * 0.011, sz + 13) * 0.10));
      towSegs++;
    }
  }
  b.kit('riverbank.towpath', towSegs, TOW_TOP);
  bankGreenery(b);
  buildRiverBridges(b);
  b.kit('riverbank.total', count, 0);
  b.kit('riverbank.blocks', plan.blocks.length, 0);
  b.kit('riverbank.multiStorey', Math.round((multi / Math.max(1, count)) * 1000) / 10, multi / Math.max(1, count));
}
