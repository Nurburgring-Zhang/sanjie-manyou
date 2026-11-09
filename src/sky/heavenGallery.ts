import * as THREE from 'three';
import { Baker, shade, roofProfile, type BGroup } from '../city/bake';

/**
 * 天宫弧形回廊（凌霄宝殿后）—— 把 expansion.ts 里那条 6.2m 宽、5.16m 檐高的
 * 「过道」重做成配得上天宫的巨型廊庑。
 *
 * 形制（全部按 scaleHeavenGeometry 放大前的口径建，调用方不要再乘 2.2）：
 *   廊宽 10–14m（默认 12）、檐高 12–16m（默认 14）、柱距 4–5m、柱径 0.9–1.2m。
 *   外檐：碧色琉璃瓦垄（真几何起垄，不是贴图/平板）＋瓦当＋滴水＋出挑 1.1m；
 *         斗栱成带（攒距 1.2–1.6m，每攒栌斗＋两跳华栱＋令栱＋散斗＋昂）；
 *         额枋通长、和玺彩画（顶点色分带，青/绿/金三段）；柱头两侧弧形雀替；
 *         檐下透空挂落（细棂条）；金砖地面（大块方砖＋砖缝）；宫灯成对带缨络。
 *   内檐：蟠龙金柱（柱身缠龙＋柱头），内侧廊墙做槛窗/隔扇（棂条＋裙板＋金饰）。
 *   外沿：汉白玉望柱（间距 2.0m，柱头雕花）＋寻杖＋中枋＋地栿＋净瓶。
 *   脊：正脊 + 宝顶脊饰 + 两端山花/博风/垂脊/走兽。
 *
 * 组织：一次 build 内先「干跑」计数，再按预算选档实建——三角面随弧长自适应，
 *       0–3 档 11 项细节全做；4–5 是长弧档，只降重复密度（5 档不铺望板，其余 10 项仍在）。
 *
 * 长弧：minHalfSpanDeg（默认 90）会把调用方给的窄跨度以中点为中心补齐到 ±90°，
 *       r=660 时弧长 2073m / 432 间 / 866 柱；expansion.ts 的调用不需要改。
 *
 * 落位约定（与旧 hSkyArcCorridor 一致）：
 *   o = 径向偏移（+ 为弧外侧，− 为内侧靠殿），t = 极角，y = 廊面标高。
 *   局部 +x 恒沿切向（t 增大方向），局部 +z 恒指圆心（−o 方向）。
 */

export interface HeavenGalleryOpts {
  cx: number;
  cz: number;
  /** 廊面标高（米，缩放前） */
  y: number;
  /** 弧半径（米，缩放前） */
  r: number;
  /** 起止极角（弧度） */
  a0: number;
  a1: number;
  /** 廊宽 10–14m，默认 12 */
  width?: number;
  /** 檐高 12–16m，默认 14 */
  eaveH?: number;
  /** 三角面上限（默认 660k），超预算自动降档；最低档仍超则如实记 overBudget */
  maxTris?: number;
  /**
   * 弧长下限（半角，度）：调用方给的跨度不足时，以中点为中心自动扩到该半角，默认 90。
   * ±90° @r660 = 2073m 弧长；expansion.ts 的调用仍传 ±23°，由本模块内部补齐。
   * 传 0 可关闭（按调用方给的 a0/a1 原样建）。
   */
  minHalfSpanDeg?: number;
}

export interface HeavenGalleryStats {
  /** 实建档位 0（最精）… 3（最省） */
  tier: number;
  bays: number;
  columns: number;
  dougong: number;
  tileRibs: number;
  lanterns: number;
  railPosts: number;
  goldBricks: number;
  arcLength: number;
  bayLength: number;
  /** 实建跨度（度）与调用方请求的跨度（度）——请求窄于 minHalfSpanDeg 时会被内部补齐 */
  spanDeg: number;
  requestedSpanDeg: number;
  width: number;
  eaveH: number;
  ridgeY: number;
  tris: number;
  /** 最低档仍超预算时为 true（不静默降级） */
  overBudget: boolean;
}

/** 最近一次 build 的实建统计（探针/验收用） */
export const heavenGalleryStats: HeavenGalleryStats = {
  tier: 0, bays: 0, columns: 0, dougong: 0, tileRibs: 0, lanterns: 0,
  railPosts: 0, goldBricks: 0, arcLength: 0, bayLength: 0, spanDeg: 0, requestedSpanDeg: 0,
  width: 0, eaveH: 0,
  ridgeY: 0, tris: 0, overBudget: false,
};

// ============ 调色板（sRGB，落盘时转线性；全部避开 ACES 过曝区） ============
const JADE = 0xd6cebc;          // 汉白玉（压一档，避免夕阳下裁白）
const JADE_D = shade(JADE, 0.8);
const JADE_HI = shade(JADE, 1.04);
const GOLD = 0xc79a35;          // 贴金（走 wood 组，不做金属反射）
const GOLD_HI = 0xe8c163;
const GOLD_D = shade(GOLD, 0.66);
// R20 终局：原 0x3a9270 碧色琉璃 / 0x2b6a50 青绿脊是放大图 r20-crop2-gold.png 左上角
// 那排蓝绿杂色瓦亭的真源。用户要求「天宫所有建筑配色都向凌霄宝殿匹配，不能灰了吧唧、
// 土了吧唧，都要金碧辉煌」，故统一到 expansion H_TILE / H_TILE2 同一套中调金。
// 用中调 0x9a7526 而非 GOLD_ROOF 0xd2ab3d：天宫强光下亮金会过曝成白板。
const TILE = 0x9a7526;          // 金琉璃瓦主色（= expansion H_TILE / realm W18_TILE）
const TILE_L = shade(TILE, 1.2); // 受光瓦，随主色自动跟随
const TILE_D = shade(TILE, 0.58);// 檐下阴面瓦，随主色自动跟随
const TILE_RIDGE = 0x70521c;    // 剪边深金（= expansion H_TILE2）
const TILE_TRIM = 0xc9a94f;     // 檐口贴金线脚（原已是金色，保留）
const RED = 0xb8422c;           // 朱漆柱
const RED_D = shade(RED, 0.62);
const RED_DD = 0x5e1d10;
const PAINT_C = 0x2a7f8a;       // 和玺彩画·青
const PAINT_G = 0x358a66;       // 和玺彩画·绿
const PAINT_B = 0x3a6aa8;       // 和玺彩画·蓝
const BRICK = 0x8f6a3c;         // 金砖
const BRICK_D = 0x3b2c1b;
const WOOD_D = 0x3a2414;
const PAPER = 0x2a2118;         // 窗内暗部
const LAMP = 0xe8b45a;
const LAMP_CORE = 0xffcf7a;

// ============ 小工具 ============
type V3 = [number, number, number];
type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

const _col = new THREE.Color();
/** sRGB hex → 线性 RGB（与 Baker 的顶点色口径一致） */
const _linCache = new Map<number, RGB>();
function lin(hex: number): RGB {
  const hit = _linCache.get(hex);
  if (hit) return hit;
  _col.setHex(hex);
  const v: RGB = [_col.r, _col.g, _col.b];
  _linCache.set(hex, v);
  return v;
}
/** 确定性哈希抖动（不碰共享 rng，天宫其它生成序列逐值不变） */
function jit(i: number, s: number): number {
  let x = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** 世界坐标三角形缓冲：顶点色绝对着色（addGeo 传 0xffffff 当乘子） */
class Surf {
  private p: number[] = [];
  private c: number[] = [];
  private u: number[] = [];
  tris = 0;
  constructor(private readonly dry: boolean) {}

  tri(a: V3, b: V3, c: V3, ca: RGB, cb: RGB, cc: RGB): void {
    this.tris++;
    if (this.dry) return;
    const P = this.p;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const C = this.c;
    C.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    const U = this.u;
    for (const q of [a, b, c]) U.push(q[0] * 0.24, q[1] * 0.24);
  }

  quad(a: V3, b: V3, c: V3, d: V3, ca: RGB, cb: RGB, cc: RGB, cd: RGB): void {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }

  /** 任意朝向长方体：以中心 + 三条正交半轴描述（斜椽用，绕切向倾斜靠它） */
  boxAxes(ctr: V3, ex: V3, ey: V3, ez: V3, hx: number, hy: number, hz: number, col: RGB): void {
    const V = (sx: number, sy: number, sz: number): V3 => [
      ctr[0] + ex[0] * hx * sx + ey[0] * hy * sy + ez[0] * hz * sz,
      ctr[1] + ex[1] * hx * sx + ey[1] * hy * sy + ez[1] * hz * sz,
      ctr[2] + ex[2] * hx * sx + ey[2] * hy * sy + ez[2] * hz * sz,
    ];
    const a = V(-1, -1, -1), b = V(1, -1, -1), c = V(1, 1, -1), d = V(-1, 1, -1);
    const e = V(-1, -1, 1), f = V(1, -1, 1), g = V(1, 1, 1), h = V(-1, 1, 1);
    this.quad(b, c, g, f, col, col, col, col); // +x
    this.quad(a, e, h, d, col, col, col, col); // −x
    this.quad(d, h, g, c, col, col, col, col); // +y
    this.quad(a, b, f, e, col, col, col, col); // −y
    this.quad(f, g, h, e, col, col, col, col); // +z
    this.quad(a, d, c, b, col, col, col, col); // −z
  }

  flush(baker: Baker, g: BGroup): void {
    if (this.dry || this.p.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    geo.computeVertexNormals();
    baker.addGeo(g, geo, 0, 0, 0, 0xffffff);
    this.p.length = 0;
    this.c.length = 0;
    this.u.length = 0;
  }
}

// ============ 精度档位 ============
interface Tier {
  /** 瓦垄（筒瓦）间距 */
  ribPitch: number;
  /** 屋面沿坡分段 */
  slopeSeg: number;
  /** 每边每间的斗栱攒数（攒距 = 柱距/攒数，4 攒 ≈1.2m） */
  dgPerBay: number;
  /** 斗栱简繁：false = 六件齐全，true = 栌斗＋华栱＋令栱 */
  dgSimple: boolean;
  /** 蟠龙绕柱圈数（0 = 只留金环） */
  dragonTurns: number;
  /** 隔扇棂条：竖棂数 / 横棂数 */
  mullions: number;
  hRails: number;
  /** 挂落细棂条数 */
  hangerSlats: number;
  /** 每间每坡的椽数（0 = 不落椽） */
  rafters: number;
  /** 瓦当隔几垄落一枚（1 = 每垄） */
  capEvery: number;
  /** 脊饰间隔（间数） */
  ridgeEvery: number;
  /** 金砖分格：0 = 按旧公式自适应（bayLen/1.55 × W/1.55），>0 = 固定列数（长弧档用） */
  brickU: number;
  brickO: number;
  /** 每间隔扇数 */
  panels: number;
  /** 隔扇精细度：2 = 棂条+裙板+金饰（现行），1 = 边框+裙板，0 = 整面板 + 金线 */
  panelDetail: number;
  /** 额枋彩画分段数（0 = 不画） */
  fasciaSeg: number;
  /** 额枋彩画面数：2 = 内外两面 */
  fasciaFaces: number;
  /** 宫灯间距（米） */
  lampPitch: number;
  /** 望柱间距（米） */
  postPitch: number;
  /** 望板沿坡细分（0 = 不落望板，只留檐口封边） */
  boardSub: number;
  /** 柱础精细度：2 = 须弥座三层，1 = 两层，0 = 一层 */
  colBase: number;
  /** 雀替每侧分段（0 = 不做雀替） */
  bracketSteps: number;
}

/**
 * 档位表。0–3 是既有短弧档（逐值不动）；4–5 是长弧档：
 *   弧长 ≥1km 时 432 间 × 满档会到 129 万面，只能靠「降重复密度、不放大构件」压回预算。
 *   柱距、柱径、檐高、钟/砖/瓦的单件尺寸全部不变，改的只是每间的重复件数。
 */
const TIERS: Tier[] = [
  { ribPitch: 0.33, slopeSeg: 5, dgPerBay: 4, dgSimple: false, dragonTurns: 2.4, mullions: 3, hRails: 4, hangerSlats: 13, rafters: 5, capEvery: 1, ridgeEvery: 3, brickU: 0, brickO: 0, panels: 2, panelDetail: 2, fasciaSeg: 5, fasciaFaces: 2, lampPitch: 9.5, postPitch: 2.0, boardSub: 2, colBase: 2, bracketSteps: 4 },
  { ribPitch: 0.42, slopeSeg: 4, dgPerBay: 4, dgSimple: false, dragonTurns: 1.8, mullions: 3, hRails: 3, hangerSlats: 10, rafters: 4, capEvery: 1, ridgeEvery: 4, brickU: 0, brickO: 0, panels: 2, panelDetail: 2, fasciaSeg: 5, fasciaFaces: 2, lampPitch: 9.5, postPitch: 2.0, boardSub: 2, colBase: 2, bracketSteps: 4 },
  { ribPitch: 0.52, slopeSeg: 3, dgPerBay: 4, dgSimple: true, dragonTurns: 1.2, mullions: 2, hRails: 2, hangerSlats: 7, rafters: 2, capEvery: 2, ridgeEvery: 5, brickU: 0, brickO: 0, panels: 2, panelDetail: 2, fasciaSeg: 5, fasciaFaces: 2, lampPitch: 9.5, postPitch: 2.0, boardSub: 2, colBase: 2, bracketSteps: 4 },
  { ribPitch: 0.64, slopeSeg: 2, dgPerBay: 4, dgSimple: true, dragonTurns: 0.8, mullions: 2, hRails: 2, hangerSlats: 5, rafters: 0, capEvery: 2, ridgeEvery: 6, brickU: 0, brickO: 0, panels: 2, panelDetail: 2, fasciaSeg: 5, fasciaFaces: 2, lampPitch: 9.5, postPitch: 2.0, boardSub: 2, colBase: 2, bracketSteps: 4 },
  { ribPitch: 0.84, slopeSeg: 2, dgPerBay: 3, dgSimple: true, dragonTurns: 0, mullions: 2, hRails: 2, hangerSlats: 6, rafters: 0, capEvery: 3, ridgeEvery: 8, brickU: 2, brickO: 3, panels: 1, panelDetail: 1, fasciaSeg: 3, fasciaFaces: 1, lampPitch: 14, postPitch: 2.7, boardSub: 1, colBase: 1, bracketSteps: 2 },
  { ribPitch: 1.28, slopeSeg: 1, dgPerBay: 2, dgSimple: true, dragonTurns: 0.6, mullions: 1, hRails: 1, hangerSlats: 3, rafters: 0, capEvery: 5, ridgeEvery: 12, brickU: 1, brickO: 2, panels: 1, panelDetail: 0, fasciaSeg: 2, fasciaFaces: 1, lampPitch: 21, postPitch: 3.4, boardSub: 0, colBase: 0, bracketSteps: 1 },
];

const DEFAULT_MAX_TRIS = 660_000;

/**
 * 建一条天宫弧形回廊。
 * 单位米；全部坐标为**缩放前**（scaleHeavenGeometry 的 2.2× 由调用方承担）。
 */
export function buildHeavenGallery(b: Baker, opts: HeavenGalleryOpts): void {
  const cx = opts.cx;
  const cz = opts.cz;
  const y0 = opts.y;
  const r = Math.max(8, Math.abs(opts.r));
  const reqA0 = Math.min(opts.a0, opts.a1);
  const reqA1 = Math.max(opts.a0, opts.a1);
  const reqSpan = Math.max(1e-4, reqA1 - reqA0);
  // 长弧补齐：调用方仍传 ±23°（expansion.ts 归 lead，不改），本模块内部以中点为中心扩到 ±90°。
  const minHalf = Math.max(0, opts.minHalfSpanDeg ?? 90) * (Math.PI / 180);
  const mid = (reqA0 + reqA1) * 0.5;
  const half = Math.max(reqSpan * 0.5, minHalf);
  const aA = mid - half;
  const aB = mid + half;
  const W = clamp(opts.width ?? 12, 8, 16);
  const eaveH = clamp(opts.eaveH ?? 14, 9, 22);
  const maxTris = opts.maxTris ?? DEFAULT_MAX_TRIS;

  const span = Math.max(1e-4, aB - aA);
  const arcLen = span * r;
  const nBay = Math.max(3, Math.round(arcLen / 4.8));
  const dA = span / nBay;
  const bayLen = dA * r;

  // 断面（o = 径向，+ 外）
  const halfW = W / 2;
  const colR = clamp(W * 0.042, 0.45, 0.6);   // φ0.9–1.2
  const outerColO = halfW - 1.0;
  const innerColO = -halfW + 1.0;
  const wallO = -halfW + 0.3;
  const railO = halfW - 0.25;
  const eaveO = halfW + 0.6;                  // 出挑 1.1m（相对柱外皮）
  const rise = (eaveH - 1.5) * 0.34;

  // 竖向锚点
  const baseTop = 0.42;
  const eaveY = eaveH;
  const dgBot = eaveY - 1.15;
  const archTop = dgBot;
  const archBot = archTop - 1.3;
  const colTop = archBot;
  const colH = colTop - baseTop;
  const ridgeY = eaveY + rise;

  const pt = (t: number, o: number, yy: number): V3 => [
    cx + Math.cos(t) * (r + o),
    y0 + yy,
    cz + Math.sin(t) * (r + o),
  ];
  const ryAt = (t: number): number => -t - Math.PI / 2;

  // 弧端翼角：末端 20m 内檐口起翘 + 出冲
  const cornerSpan = Math.max(8, Math.min(26, arcLen * 0.18));
  const cornerAt = (t: number): number => {
    const d = Math.min(t - aA, aB - t) * r;
    return clamp(1 - d / cornerSpan, 0, 1);
  };

  // 望柱 / 宫灯按弧长均布；间距由档位决定（默认 2.0m / 9.5m，长弧档放宽），在 run 内按档算
  const run = (tier: number, dry: boolean): number => {
    const T = TIERS[tier];
    const nPost = Math.max(6, Math.round(arcLen / T.postPitch));
    const postDA = span / nPost;
    const nLampStation = Math.max(2, Math.round(arcLen / T.lampPitch));
    const lampDA = span / nLampStation;
    const sf = new Surf(dry);    // 屋面组（瓦/脊/山花/瓦当/滴水）
    const sfw = new Surf(dry);   // 木作组（椽/望板/雀替/博风/缠龙）
    let tris = 0;
    let nColumn = 0;
    let nDougong = 0;
    let nRib = 0;
    let nLamp = 0;
    let nPostBuilt = 0;
    let nBrick = 0;

    const bx = (g: BGroup, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void => {
      if (!dry) b.box(g, w, h, d, x, y, z, hex, ry, rx, rz);
      // 与 Baker.boxFast 的底面剔除同口径：只有绕 y 转、底边落在 −6…−0.05、
      // 且在城市方域内时，ny 那一面不写（10 面而不是 12 面）。计数必须跟着这条走，
      // 否则干跑估高 5%，会把本该走满档的回廊误降到下一档。
      const bottom = y - Math.abs(h) * 0.5;
      const cull = rx === 0 && rz === 0 && bottom <= -0.05 && bottom >= -6 && Math.abs(x) < 5200 && Math.abs(z) < 5200;
      tris += cull ? 10 : 12;
    };
    const cy = (g: BGroup, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, open = false): void => {
      if (!dry) b.cyl(g, rt, rb, h, seg, x, y, z, hex, ry, 0, 0, open);
      tris += open ? seg * 2 : seg * 4;
    };
    const put = (g: BGroup, w: number, h: number, d: number, t: number, o: number, yy: number, hex: number, dry0 = 0): void => {
      const p = pt(t, o, yy);
      bx(g, w, h, d, p[0], p[1], p[2], hex, ryAt(t) + dry0);
    };

    // ---------- 屋面：沿弧扫掠的筒瓦曲面 ----------
    const nRibBay = Math.max(4, Math.round(bayLen / T.ribPitch));
    nRib = nRibBay * nBay * 2;
    const nu = nRibBay * 2;
    const nt = T.slopeSeg;
    const cornerNorm = (t: number): number => {
      const c = cornerAt(t);
      return c * c;
    };
    const roofPt = (t: number, side: number, a: number, crest: boolean): V3 => {
      const cl = cornerNorm(t);
      const o = side * (eaveO * a + 0.9 * cl * a * a * a);
      const yR = eaveY + rise * (roofProfile(a) + 0.06 * a * a * a * a * a);
      const yL = cl * 1.3 * a * a;
      const rib = (crest ? 0.085 : -0.035) * Math.min(1, a / 0.12) * (1 - 0.3 * cl);
      return pt(t, o, yR + yL + rib);
    };
    const ribCol = (t: number, u: number, a: number, side: number): RGB => {
      const v = 0.9 + jit(u * 7 + side * 3, 5) * 0.2;
      if (a > 0.925) return lin(shade(TILE_TRIM, v));
      if (a < 0.035) return lin(TILE_RIDGE);
      if (a < 0.10) return lin(shade(TILE_D, v));
      return lin((u & 1) === 0 ? shade(TILE_L, v) : shade(TILE_D, v));
    };
    const capCol = lin(GOLD_HI);
    const dripCol = lin(TILE_D);
    const fasciaCol = lin(WOOD_D);

    for (let i = 0; i < nBay; i++) {
      const t0 = aA + dA * i;
      const t1 = t0 + dA;
      const tm = (t0 + t1) * 0.5;

      // ① 台基（须弥座两层的简化：核心 + 两沿压边石；压边只压边，不盖住金砖）
      put('ash', bayLen * 1.01, 0.9, W + 1.85, tm, 0, -0.56, shade(JADE_D, 0.76));
      for (const sg of [-1, 1] as const) {
        put('ash', bayLen * 1.01, 0.22, 0.42, tm, sg * (halfW + 0.16), -0.05, shade(JADE_D, 0.96));
        put('wood', bayLen * 1.01, 0.05, 0.3, tm, sg * (halfW - 0.02), -0.14, GOLD_D);
      }

      // ② 金砖地面：列数由档位定（长弧档只留 1×2，靠砖缝与压边石读铺装）
      const nBrickU = T.brickU > 0 ? T.brickU : Math.max(2, Math.round(bayLen / 1.55));
      const nBrickO = T.brickO > 0 ? T.brickO : Math.max(4, Math.round(W / 1.55));
      const bw = bayLen / nBrickU;
      const bd = W / nBrickO;
      put('ash', bayLen * 1.01, 0.06, W, tm, 0, -0.08, BRICK_D);
      for (let iu = 0; iu < nBrickU; iu++) {
        for (let io = 0; io < nBrickO; io++) {
          const tu = t0 + dA * ((iu + 0.5) / nBrickU);
          const oo = -halfW + bd * (io + 0.5);
          const k = 0.86 + jit(i * 31 + iu, io * 13 + 7) * 0.26;
          // 砖面比砖缝层高 5mm：两个面同高会共面 z-fighting，远看是一地黑三角
          put('ash', bw - 0.055, 0.05, bd - 0.055, tu, oo, -0.02, shade(BRICK, k));
          nBrick++;
        }
      }
      put('lacquer', bayLen * 1.01, 0.06, W, tm, 0, -0.032, BRICK_D);
      // 两沿的压边石 + 金线（不是两条孤零零的黄线，而是贴着墙根/栏根的收边）
      put('ash', bayLen * 1.01, 0.12, 0.24, tm, -halfW + 0.12, 0.06, JADE_D);
      put('ash', bayLen * 1.01, 0.12, 0.24, tm, halfW - 0.12, 0.06, JADE_D);
      put('wood', bayLen * 1.01, 0.035, 0.06, tm, halfW - 0.26, 0.115, GOLD_D);

      // ③ 内侧廊墙：下碱 + 隔扇（槛窗）＋走马板（长弧档 panelDetail 0/1 只降棂条与裙板密度）
      put('ash', bayLen * 1.01, 0.35, 0.56, tm, wallO, 0.175, JADE_D);
      put('wood', bayLen * 1.01, 0.72, 0.5, tm, wallO, 0.71, RED_DD);
      const panelTop = 9.85;
      const panelBot = 1.07;
      const pH = panelTop - panelBot;
      // 硬指标：回廊只吃 scaleHeavenGeometry 的 ×2.2，预缩放上限 2/2.2 = 0.909m。
      // 旧版整条暗板 bayLen×pH ≈4.9×8.8 ⇒ 世界 10.7×19.3m（探针最大超标源，436 簇）。
      // 本版按 0.909m 分频：每格 0.783×0.842 ×2.2 = 1.72×1.85m ≤2 ✔。
      // 必须真实拆成独立盒体：压棂条不改变暗板的几何连通性，探针仍会读成一整樘巨窗。
      const gx = Math.max(1, Math.ceil((bayLen * 1.01 + 0.04) / (0.909 + 0.04)));
      const gy = Math.max(1, Math.ceil((pH + 0.04) / (0.909 + 0.04)));
      const gW = (bayLen * 1.01 - 0.04 * (gx - 1)) / gx;
      const gH = (pH - 0.04 * (gy - 1)) / gy;
      for (let ix = 0; ix < gx; ix++) {
        const ox = -(bayLen * 1.01) / 2 + gW / 2 + ix * (gW + 0.04);
        for (let iy = 0; iy < gy; iy++) {
          const oy = panelBot + gH / 2 + iy * (gH + 0.04);
          put('wood', gW, gH, 0.34, tm + ox / r, wallO, oy, PAPER);
        }
      }
      // 格间木棂（朱漆）：压住分格缝，避免透出廊外。0.04 预缩放 ×2.2 = 0.088m。
      for (let ix = 1; ix < gx; ix++) {
        const ox = -(bayLen * 1.01) / 2 + ix * (gW + 0.04) - 0.02;
        put('wood', 0.04, pH, 0.05, tm + ox / r, wallO + 0.18, panelBot + pH / 2, RED_DD);
      }
      for (let iy = 1; iy < gy; iy++) {
        const oy = panelBot + iy * (gH + 0.04) - 0.02;
        put('wood', bayLen * 1.01, 0.04, 0.05, tm, wallO + 0.18, oy, RED_DD);
      }
      const nPanel = Math.max(1, T.panels);
      const pw = bayLen / nPanel - 0.16;
      for (let k = 0; k < nPanel; k++) {
        const so = (k + 0.5 - nPanel / 2) * (bayLen / nPanel);
        const tp = tm + so / r;
        const po = wallO + 0.19;
        if (T.panelDetail <= 0) {
          // 整面朱漆板 + 一道金线（远看仍是「深色木隔扇带」，只是不再逐根棂条）
          put('wood', pw, pH - 0.26, 0.12, tp, po, panelBot + pH / 2, shade(RED_DD, 1.08));
          put('wood', pw * 0.96, 0.1, 0.16, tp, po + 0.03, panelTop - 0.2, GOLD_D);
          put('wood', pw * 0.96, 0.08, 0.16, tp, po + 0.03, panelBot + 0.24, GOLD_D);
          continue;
        }
        // 边框
        put('wood', 0.13, pH, 0.13, tp + (pw / 2 - 0.065) / r, po, panelBot + pH / 2, RED);
        put('wood', 0.13, pH, 0.13, tp - (pw / 2 - 0.065) / r, po, panelBot + pH / 2, RED);
        put('wood', pw, 0.16, 0.13, tp, po, panelTop - 0.08, RED);
        put('wood', pw, 0.16, 0.13, tp, po, panelBot + 0.08, RED);
        // 裙板
        put('wood', pw - 0.2, 1.35, 0.1, tp, po + 0.06, panelBot + 0.85, RED_D);
        put('wood', Math.min(0.9, pw * 0.5), 0.42, 0.06, tp, po + 0.13, panelBot + 0.86, GOLD);
        if (T.panelDetail <= 1) {
          put('glow', pw * 0.6, 0.05, 0.04, tp, po - 0.03, panelBot + 2.0, 0x6b4a1e);
          continue;
        }
        // 棂条（竖 + 横）
        const latBot = panelBot + 1.62;
        const latTop = panelTop - 0.2;
        for (let m = 1; m <= T.mullions; m++) {
          const sx = -pw / 2 + (pw * m) / (T.mullions + 1);
          put('wood', 0.055, latTop - latBot, 0.085, tp + sx / r, po + 0.015, (latBot + latTop) / 2, shade(RED, 1.18));
        }
        for (let m = 0; m <= T.hRails; m++) {
          const yy = latBot + ((latTop - latBot) * m) / T.hRails;
          put('wood', pw - 0.14, 0.055, 0.085, tp, po + 0.015, yy, shade(RED, 1.12));
        }
        // 窗内暖光一条（不铺满，避免整面墙发白）
        put('glow', pw * 0.7, 0.05, 0.04, tp, po - 0.03, latBot + 0.28, 0x6b4a1e);
      }
      // 走马板 + 上槛
      put('wood', bayLen * 1.01, colTop - panelTop, 0.46, tm, wallO, (colTop + panelTop) / 2, RED_DD);
      put('wood', bayLen * 1.01, 0.12, 0.54, tm, wallO, panelTop + 0.06, GOLD_D);
      put('wood', bayLen * 1.01, 0.14, 0.56, tm, wallO, colTop - 0.07, GOLD_D);

      // ④ 额枋（通长）+ 和玺彩画（内外两面都画：人在廊里看的是内侧面）
      for (const side of [1, -1] as const) {
        const o = side * (halfW - 0.95);
        put('wood', bayLen * 1.02, archTop - archBot, 0.5, tm, o, (archTop + archBot) / 2, RED_DD);
        // 外檐枋两面都上彩画；内檐枋靠墙那面看不见，只画朝廊的一面
        const faceSigns = T.fasciaFaces >= 2
          ? (side > 0 ? [1, -1] as const : [-1] as const)
          : (side > 0 ? [1] as const : [-1] as const);
        const segN = Math.max(1, T.fasciaSeg);
        for (const fs of faceSigns) {
          const oo = o + side * fs * 0.27;
          for (let s = 0; s < segN; s++) {
            const ts = t0 + dA * ((s + 0.5) / segN);
            const cc = s % 2 === 0 ? PAINT_C : (s % 4 === 1 ? PAINT_G : PAINT_B);
            put('wood', (bayLen / segN) * 0.94, 0.86, 0.06, ts, oo, (archTop + archBot) / 2, cc);
          }
          for (let s = 0; s <= segN; s += 2) {
            const ts = t0 + dA * (s / segN);
            put('wood', 0.07, 0.92, 0.075, ts, oo + side * fs * 0.01, (archTop + archBot) / 2, GOLD_D);
          }
        }
        // 上下金边
        put('wood', bayLen * 1.02, 0.07, 0.62, tm, o, archTop - 0.035, GOLD);
        put('wood', bayLen * 1.02, 0.07, 0.62, tm, o, archBot + 0.035, GOLD_D);
      }

      // ⑤ 斗栱带（每边 4 攒，攒距 ≈1.2m）+ 栱眼壁
      for (const side of [1, -1] as const) {
        const o = side * (halfW - 0.95);
        // 栱眼壁/垫板：额枋顶到瓦面之间补一块实心板。不补的话，
        // 攒与攒之间能直接从廊内看穿到瓦背（用户会读成"绿色平板"）。
        const bh = eaveY - dgBot + 0.75;
        put('wood', bayLen * 1.02, bh, 0.12, tm, o + side * 0.04, dgBot + bh / 2 - 0.05, RED_DD);
        put('wood', bayLen * 1.02, 0.07, 0.16, tm, o + side * 0.05, dgBot + 0.08, GOLD_D);
        for (let k = 0; k < T.dgPerBay; k++) {
          const tk = t0 + dA * ((k + 0.5) / T.dgPerBay);
          const oo = o + side * 0.28;
          // 栌斗
          put('wood', 0.46, 0.36, 0.46, tk, oo, dgBot + 0.18, T.dgSimple ? GOLD_D : PAINT_B);
          // 一跳华栱（沿切向长）
          put('wood', 1.12, 0.2, 0.26, tk, oo + side * 0.16, dgBot + 0.45, T.dgSimple ? GOLD : PAINT_C);
          if (!T.dgSimple) {
            put('wood', 0.92, 0.19, 0.3, tk, oo + side * 0.31, dgBot + 0.67, PAINT_C);
            // 下昂（径向出挑）
            put('wood', 0.24, 0.17, 0.86, tk, oo + side * 0.34, dgBot + 0.56, RED_DD);
          }
          // 令栱
          put('wood', 1.34, 0.17, 0.24, tk, oo + side * 0.46, dgBot + 0.88, GOLD);
          // 散斗 ×2
          for (const sg of [-1, 1] as const) {
            put('wood', 0.19, 0.19, 0.19, tk + (sg * 0.55) / r, oo + side * 0.46, dgBot + 1.02, PAINT_B);
          }
          nDougong++;
        }
      }

      // ⑥ 挂落（外檐，透空细棂条）
      {
        const o = halfW - 0.95;
        put('wood', bayLen, 0.1, 0.2, tm, o, archBot - 0.06, RED_DD);
        put('wood', bayLen, 0.08, 0.16, tm, o, archBot - 0.72, shade(RED, 1.05));
        for (let s = 0; s < T.hangerSlats; s++) {
          const ts = t0 + dA * ((s + 0.5) / T.hangerSlats);
          put('wood', 0.06, 0.63, 0.11, ts, o, archBot - 0.39, shade(RED, 1.2));
        }
      }

      // ⑦ 屋面（两坡连续扫掠，筒瓦起垄）
      for (const side of [1, -1] as const) {
        for (let u = 0; u < nu; u++) {
          const tu0 = t0 + (dA * u) / nu;
          const tu1 = t0 + (dA * (u + 1)) / nu;
          for (let j = 0; j < nt; j++) {
            const aa0 = j / nt;
            const aa1 = (j + 1) / nt;
            const p00 = roofPt(tu0, side, aa0, (u & 1) === 0);
            const p10 = roofPt(tu1, side, aa0, ((u + 1) & 1) === 0);
            const p11 = roofPt(tu1, side, aa1, ((u + 1) & 1) === 0);
            const p01 = roofPt(tu0, side, aa1, (u & 1) === 0);
            const c00 = ribCol(tu0, u, aa0, side);
            const c10 = ribCol(tu1, u + 1, aa0, side);
            const c11 = ribCol(tu1, u + 1, aa1, side);
            const c01 = ribCol(tu0, u, aa1, side);
            if (side > 0) sf.quad(p00, p10, p11, p01, c00, c10, c11, c01);
            else sf.quad(p00, p01, p11, p10, c00, c01, c11, c10);
          }
        }
        // 檐口封檐板 + 金线
        const nF = 4;
        for (let s = 0; s < nF; s++) {
          const ta = t0 + (dA * s) / nF;
          const tb = t0 + (dA * (s + 1)) / nF;
          const pa = roofPt(ta, side, 1, true);
          const pb = roofPt(tb, side, 1, true);
          const da: V3 = [pa[0], pa[1] - 0.62, pa[2]];
          const db: V3 = [pb[0], pb[1] - 0.62, pb[2]];
          if (side > 0) sf.quad(pa, pb, db, da, fasciaCol, fasciaCol, fasciaCol, fasciaCol);
          else sf.quad(pa, da, db, pb, fasciaCol, fasciaCol, fasciaCol, fasciaCol);
        }
        // 檐底板：只做一条 0.06 厚的封边，贴在檐口瓦谷下方
        {
          const yb = eaveY - 0.06;
          const b0 = pt(t0, side * eaveO * 0.9, yb);
          const b1 = pt(t1, side * eaveO * 0.9, yb);
          const b2 = pt(t1, side * eaveO * 1.04, yb);
          const b3 = pt(t0, side * eaveO * 1.04, yb);
          const wc = lin(0x5e3722);
          if (side > 0) sf.quad(b0, b3, b2, b1, wc, wc, wc, wc);
          else sf.quad(b0, b1, b2, b3, wc, wc, wc, wc);
        }
        // 脊底封板：两坡望板在正脊交成 V 形缺口，仰视会漏一条瓦背
        {
          const yr = ridgeY - 0.46;
          const c0 = pt(t0, -0.85, yr);
          const c1 = pt(t1, -0.85, yr);
          const c2 = pt(t1, 0.85, yr);
          const c3 = pt(t0, 0.85, yr);
          const wc = lin(0x5e3722);
          sf.quad(c0, c3, c2, c1, wc, wc, wc, wc);
        }
        // 瓦当（每垄一枚）+ 滴水（垄间一枚）
        for (let u = 0; u <= nu; u++) {
          const tt = t0 + (dA * u) / nu;
          const crest = (u & 1) === 0;
          if (T.capEvery > 1) {
            const per = T.capEvery * 2;
            if (u % per !== (crest ? 0 : T.capEvery)) continue;
          }
          const e = roofPt(tt, side, 1, crest);
          const rx = Math.cos(tt) * side;
          const rz = Math.sin(tt) * side;
          const tx = -Math.sin(tt);
          const tz = Math.cos(tt);
          const ccx = e[0] + rx * 0.05;
          const ccy = e[1] - 0.03;
          const ccz = e[2] + rz * 0.05;
          if (crest) {
            const R = 0.115;
            const cen: V3 = [ccx, ccy, ccz];
            const ring: V3[] = [];
            for (let q = 0; q < 6; q++) {
              const an = (q / 6) * TAU;
              ring.push([ccx + tx * Math.cos(an) * R, ccy + Math.sin(an) * R, ccz + tz * Math.cos(an) * R]);
            }
            for (let q = 0; q < 6; q++) {
              const a = ring[q];
              const bb = ring[(q + 1) % 6];
              if (side > 0) sf.tri(cen, a, bb, capCol, capCol, capCol);
              else sf.tri(cen, bb, a, capCol, capCol, capCol);
            }
          } else {
            const w = 0.085;
            const a: V3 = [ccx - tx * w, ccy - 0.02, ccz - tz * w];
            const b: V3 = [ccx + tx * w, ccy - 0.02, ccz + tz * w];
            const c: V3 = [ccx, ccy - 0.26, ccz];
            if (side > 0) sf.tri(a, b, c, dripCol, dripCol, dripCol);
            else sf.tri(a, c, b, dripCol, dripCol, dripCol);
          }
        }
        // 望板（顺瓦面铺的木板顶棚，朝下）+ 椽 + 檩；长弧档 boardSub=0 时不铺望板（只留檐口封边）
        if (T.boardSub > 0) {
          const cc = lin(0x6b4026);
          const nSub = T.boardSub;
          for (let u = 0; u < nu; u++) {
            const tu0 = t0 + (dA * u) / nu;
            const tu1 = t0 + (dA * (u + 1)) / nu;
            for (let j = 0; j < nSub; j++) {
              const aa0 = 0.005 + (0.995 * j) / nSub;
              const aa1 = 0.005 + (0.995 * (j + 1)) / nSub;
              const a00 = roofPt(tu0, side, aa0, true);
              const a10 = roofPt(tu1, side, aa0, true);
              const a11 = roofPt(tu1, side, aa1, true);
              const a01 = roofPt(tu0, side, aa1, true);
              // 望板按瓦脊高度整体下压 0.32m（实测这条口径能稳定从廊内看见望板；
              // 贴近瓦谷的写法会被瓦背吃掉，反而露出整片绿色）
              const off = (p: V3): V3 => [p[0], p[1] - 0.32, p[2]];
              const q00 = off(a00), q10 = off(a10), q11 = off(a11), q01 = off(a01);
              // 望板落进 roof 组（DoubleSide）：零厚度壳体只有双面渲染才保证仰视一定看得见，
              // 单面 wood 组在掠射角上会被瓦背顶掉。
              if (side > 0) sf.quad(q00, q01, q11, q10, cc, cc, cc, cc);
              else sf.quad(q00, q10, q11, q01, cc, cc, cc, cc);
            }
          }
          // 两道檩条（沿弧通长，压在椽下）
          for (const pa of [0.36, 0.72]) {
            const yP = eaveY + rise * (roofProfile(pa) + 0.06 * Math.pow(pa, 5)) - 0.3;
            put('wood', bayLen * 1.02, 0.17, 0.23, tm, side * eaveO * pa, yP, 0x9a5030);
          }
        }
        for (let k = 0; k < T.rafters; k++) {
          const tu = t0 + dA * ((k + 0.5) / T.rafters);
          const pa = roofPt(tu, side, 0.08, true);
          const pb = roofPt(tu, side, 0.985, true);
          const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
          const L = Math.hypot(dx, dy, dz) || 1;
          const ex: V3 = [dx / L, dy / L, dz / L];
          const ez: V3 = [Math.cos(tu) * side, 0, Math.sin(tu) * side];
          const ey: V3 = [
            ex[1] * ez[2] - ex[2] * ez[1],
            ex[2] * ez[0] - ex[0] * ez[2],
            ex[0] * ez[1] - ex[1] * ez[0],
          ];
          const ctr: V3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 - 0.55, (pa[2] + pb[2]) / 2];
          sfw.boxAxes(ctr, ex, ey, ez, L / 2, 0.09, 0.062, lin(0x8a4530));
        }
      }

      // ⑧ 正脊（通长不断开；宝顶才按间隔落）
      put('roof', bayLen * 1.02, 0.62, 0.66, tm, 0, ridgeY + 0.2, TILE_RIDGE);
      put('roof', bayLen * 1.02, 0.1, 0.8, tm, 0, ridgeY + 0.55, shade(TILE_TRIM, 0.98));
      if (i % T.ridgeEvery === 0) {
        const p = pt(tm, 0, ridgeY + 0.78);
        cy('metal', 0.1, 0.26, 0.42, 6, p[0], p[1], p[2], GOLD, 0, false);
        cy('metal', 0.3, 0.06, 0.16, 8, p[0], p[1] + 0.3, p[2], GOLD_HI, 0, false);
        cy('metal', 0.02, 0.02, 0.5, 4, p[0], p[1] + 0.55, p[2], GOLD_HI, 0, true);
      }
    }

    // ---------- 柱（每柱位两根：外檐 + 内檐） ----------
    for (let i = 0; i <= nBay; i++) {
      const t = aA + dA * i;
      for (const o of [outerColO, innerColO]) {
        const p = pt(t, o, 0);
        // 须弥座柱础（长弧档只留一层方础 + 柱脚弧线）
        if (T.colBase >= 2) {
          put('ash', 1.98, 0.3, 1.98, t, o, 0.15, JADE_D);
          put('ash', 1.56, 0.42, 1.56, t, o, 0.51, JADE);
          put('ash', 2.08, 0.26, 2.08, t, o, 0.85, JADE_HI);
          cy('ash', 0.72, 0.62, 0.18, 8, p[0], p[1] + 1.08, p[2], shade(JADE, 1.02), 0, true);
        } else if (T.colBase === 1) {
          put('ash', 1.72, 0.62, 1.72, t, o, 0.31, JADE);
          put('ash', 1.98, 0.2, 1.98, t, o, 0.72, JADE_HI);
        } else {
          put('ash', 1.52, 0.44, 1.52, t, o, 0.22, JADE);
        }
        // 柱身（上下略有收分，φ0.9–1.2，柱顶直抵额枋底）
        const shaftH = colTop - 1.05;
        cy('wood', colR * 0.92, colR, shaftH, 10, p[0], p[1] + 1.05 + shaftH / 2, p[2], RED, 0, true);
        // 缠龙：绕柱螺旋带（每圈 9 段，径向外凸 0.12）
        const turns = T.dragonTurns;
        if (turns > 0.01) {
          const segPer = 9;
          const segs = Math.max(4, Math.round(turns * segPer));
          const yA = baseTop + 1.5;
          const yB = colTop - 1.1;
          const hw = 0.105;
          const rr = colR * 0.95 + 0.09;
          for (let s = 0; s < segs; s++) {
            const u0 = s / segs;
            const u1 = (s + 1) / segs;
            const th0 = u0 * turns * TAU;
            const th1 = u1 * turns * TAU;
            const yv0 = yA + (yB - yA) * u0;
            const yv1 = yA + (yB - yA) * u1;
            const P0 = pt(t + (Math.cos(th0) * rr) / r, o + Math.sin(th0) * rr, 0);
            const P1 = pt(t + (Math.cos(th1) * rr) / r, o + Math.sin(th1) * rr, 0);
            const A0: V3 = [P0[0], y0 + yv0 - hw, P0[2]];
            const A1: V3 = [P0[0], y0 + yv0 + hw, P0[2]];
            const B0: V3 = [P1[0], y0 + yv1 - hw, P1[2]];
            const B1: V3 = [P1[0], y0 + yv1 + hw, P1[2]];
            const gc = lin(shade(GOLD, 1.0 + 0.1 * ((s & 1) ? 1 : 0)));
            sfw.quad(A0, B0, B1, A1, gc, gc, gc, gc);
            // 龙脊（外凸的一条）
            const mid0 = pt(t + (Math.cos(th0) * (rr + 0.1)) / r, o + Math.sin(th0) * (rr + 0.1), 0);
            const mid1 = pt(t + (Math.cos(th1) * (rr + 0.1)) / r, o + Math.sin(th1) * (rr + 0.1), 0);
            const M0: V3 = [mid0[0], y0 + yv0 + 0.02, mid0[2]];
            const M1: V3 = [mid1[0], y0 + yv1 + 0.02, mid1[2]];
            sfw.quad(A1, B1, M1, M0, gc, gc, gc, gc);
          }
          // 龙头（柱顶附近，朝外）
          const th = turns * TAU;
          const hp = pt(t + (Math.cos(th) * (rr + 0.12)) / r, o + Math.sin(th) * (rr + 0.12), 0);
          const face = ryAt(t);
          bx('metal', 0.34, 0.28, 0.46, hp[0], y0 + yB + 0.16, hp[2], GOLD_HI, face);
          bx('metal', 0.2, 0.16, 0.24, hp[0] + Math.cos(t) * 0.26 * Math.sign(o), y0 + yB + 0.2,
            hp[2] + Math.sin(t) * 0.26 * Math.sign(o), GOLD, face);
          bx('metal', 0.1, 0.34, 0.1, hp[0], y0 + yB + 0.42, hp[2], GOLD_D, face);
          // 两爪
          for (const sg of [-1, 1] as const) {
            bx('metal', 0.09, 0.09, 0.3, hp[0] + (-Math.sin(t) * sg) * 0.3, y0 + yB + 0.02,
              hp[2] + (Math.cos(t) * sg) * 0.3, GOLD, face);
          }
        }
        // 柱头金箍 + 柱头枋
        cy('wood', colR * 1.12, colR * 1.12, 0.2, 10, p[0], p[1] + colTop - 0.12, p[2], GOLD, 0, true);
        put('wood', colR * 2.6, 0.26, colR * 2.6, t, o, colTop - 0.32, RED_DD);
        nColumn++;
      }
    }

    // ---------- 雀替（柱头两侧弧形托木） ----------
    for (let i = 0; i <= nBay; i++) {
      const t = aA + dA * i;
      for (const o of [outerColO, innerColO]) {
        for (const sg of [-1, 1] as const) {
          const reach = 0.95;
          const steps = T.bracketSteps;
          const thick = 0.16;
          for (let s = 0; s < steps; s++) {
            const s0 = (s / steps) * reach;
            const s1 = ((s + 1) / steps) * reach;
            const h0 = 0.82 * Math.pow(1 - s0 / reach, 1.6) + 0.05;
            const h1 = 0.82 * Math.pow(1 - s1 / reach, 1.6) + 0.05;
            const t0 = t + (sg * s0) / r;
            const t1 = t + (sg * s1) / r;
            for (const fo of [-thick / 2, thick / 2]) {
              const A = pt(t0, o + fo, archBot - h0);
              const B = pt(t1, o + fo, archBot - h1);
              const Cc = pt(t1, o + fo, archBot);
              const D = pt(t0, o + fo, archBot);
              const col = lin(s % 2 ? PAINT_G : PAINT_C);
              if (fo > 0) sfw.quad(A, B, Cc, D, col, col, col, col);
              else sfw.quad(A, D, Cc, B, col, col, col, col);
            }
            // 下缘金边
            const e0 = pt(t0, o + thick / 2, archBot - h0);
            const e1 = pt(t1, o + thick / 2, archBot - h1);
            const f0 = pt(t0, o - thick / 2, archBot - h0);
            const f1 = pt(t1, o - thick / 2, archBot - h1);
            const gc = lin(GOLD);
            sfw.quad(e0, e1, f1, f0, gc, gc, gc, gc);
          }
        }
      }
    }

    // ---------- 穿枋（每柱位横向拉结两排柱） ----------
    for (let i = 0; i <= nBay; i++) {
      const t = aA + dA * i;
      const p = pt(t, 0, 0);
      bx('wood', 0.38, 0.5, W - 1.7, p[0], y0 + archBot - 0.55, p[2], RED_DD, ryAt(t));
      bx('wood', W - 1.9, 0.09, 0.44, p[0], y0 + archBot - 0.28, p[2], GOLD_D, ryAt(t));
    }

    // ---------- 汉白玉栏杆（外沿） ----------
    for (let i = 0; i < nBay; i++) {
      const t0 = aA + dA * i;
      const tm = t0 + dA * 0.5;
      put('ash', bayLen * 1.02, 0.22, 0.3, tm, railO, 0.26, JADE_D);   // 地栿
      put('ash', bayLen * 1.02, 0.12, 0.17, tm, railO, 1.34, JADE_HI); // 寻杖
      put('ash', bayLen * 1.02, 0.1, 0.15, tm, railO, 0.86, JADE);     // 中枋
    }
    for (let i = 0; i <= nPost; i++) {
      const t = aA + postDA * i;
      const p = pt(t, railO, 0);
      bx('ash', 0.36, 0.16, 0.36, p[0], y0 + 0.5, p[2], JADE_D, ryAt(t));       // 柱础
      bx('ash', 0.22, 1.02, 0.22, p[0], y0 + 1.02, p[2], JADE, ryAt(t));        // 柱身
      cy('ash', 0.19, 0.24, 0.2, 8, p[0], p[1] + 1.62, p[2], JADE_HI, 0, false); // 柱头莲座
      bx('ash', 0.3, 0.12, 0.3, p[0], y0 + 1.78, p[2], JADE_HI, ryAt(t));       // 柱头雕花
      nPostBuilt++;
    }
    for (let i = 0; i < nBay; i++) {
      const t0 = aA + dA * i;
      for (let k = 0; k < 2; k++) {
        const tk = t0 + dA * ((k + 0.5) / 2);
        put('ash', 0.1, 0.62, 0.12, tk, railO, 0.72, JADE);   // 净瓶
        put('ash', 0.14, 0.1, 0.16, tk, railO, 1.06, JADE_HI);
      }
    }

    // ---------- 宫灯（每 9.5m 一对，挂在穿枋下；灯体放大 1.35× 才在 12m 廊宽里读得出） ----------
    for (let i = 0; i <= nLampStation; i++) {
      const t = aA + lampDA * i;
      const LS = 1.35;
      for (const o of [-1.9, 1.9]) {
        const p = pt(t, o, archBot - 0.85);
        // 灯钩/挂链
        cy('metal', 0.02, 0.02, 0.62 * LS, 4, p[0], p[1] + 0.31 * LS, p[2], GOLD_D, 0, true);
        // 灯盖
        cy('metal', 0.09 * LS, 0.3 * LS, 0.16 * LS, 8, p[0], p[1], p[2], GOLD, 0, false);
        // 灯体（六棱纱灯）
        cy('fabric', 0.31 * LS, 0.36 * LS, 0.78 * LS, 6, p[0], p[1] - 0.5 * LS, p[2], LAMP, ryAt(t), false);
        // 上下金箍
        cy('metal', 0.33 * LS, 0.33 * LS, 0.07 * LS, 6, p[0], p[1] - 0.13 * LS, p[2], GOLD_HI, 0, true);
        cy('metal', 0.38 * LS, 0.38 * LS, 0.07 * LS, 6, p[0], p[1] - 0.88 * LS, p[2], GOLD_HI, 0, true);
        // 内芯
        cy('glow', 0.17 * LS, 0.19 * LS, 0.5 * LS, 6, p[0], p[1] - 0.5 * LS, p[2], LAMP_CORE, 0, false);
        // 灯底 + 缨络
        cy('metal', 0.2 * LS, 0.1 * LS, 0.12 * LS, 6, p[0], p[1] - 0.96 * LS, p[2], GOLD_D, 0, false);
        for (let s = 0; s < 3; s++) {
          const a = (s / 3) * TAU + 0.4;
          bx('fabric', 0.05 * LS, 0.52 * LS, 0.05 * LS, p[0] + Math.cos(a) * 0.09 * LS,
            p[1] - 1.25 * LS, p[2] + Math.sin(a) * 0.09 * LS, 0x9a2418, 0);
        }
        bx('metal', 0.07 * LS, 0.07 * LS, 0.07 * LS, p[0], p[1] - 0.98 * LS, p[2], GOLD, 0);
        nLamp++;
      }
    }

    // ---------- 两端：山花 / 博风 / 垂脊 / 走兽 ----------
    for (const [ae, inward] of [[aA, 1], [aB, -1]] as const) {
      // 山花板（多边形封头，取两侧屋面轮廓）
      const apex = roofPt(ae, 1, 0, true);
      const apexL: V3 = [apex[0], apex[1], apex[2]];
      const N = 8;
      for (const side of [1, -1] as const) {
        let prev = apexL;
        for (let j = 1; j <= N; j++) {
          const a = j / N;
          const cur = roofPt(ae, side, a, true);
          const dd: V3 = [cur[0], cur[1] - 0.12, cur[2]];
          const cc = lin(shade(WOOD_D, 1.1));
          if (side > 0) sfw.tri(apexL, prev, dd, cc, cc, cc);
          else sfw.tri(apexL, dd, prev, cc, cc, cc);
          prev = dd;
        }
      }
      // 博风板（沿两坡外缘）+ 垂脊
      for (const side of [1, -1] as const) {
        let prev = roofPt(ae, side, 0, true);
        for (let j = 1; j <= N; j++) {
          const a = j / N;
          const cur = roofPt(ae, side, a, true);
          const dx = cur[0] - prev[0], dy = cur[1] - prev[1], dz = cur[2] - prev[2];
          const L = Math.hypot(dx, dy, dz) || 1;
          const ex: V3 = [dx / L, dy / L, dz / L];
          const ez: V3 = [Math.cos(ae) * side, 0, Math.sin(ae) * side];
          const ey: V3 = [
            ex[1] * ez[2] - ex[2] * ez[1],
            ex[2] * ez[0] - ex[0] * ez[2],
            ex[0] * ez[1] - ex[1] * ez[0],
          ];
          const ctr: V3 = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2 - 0.16, (prev[2] + cur[2]) / 2];
          sfw.boxAxes(ctr, ex, ey, ez, L / 2, 0.2, 0.16, lin(GOLD_D));
          if (j % 3 === 0) {
            // 走兽
            sfw.boxAxes([cur[0], cur[1] + 0.24, cur[2]], ex, ey, ez, 0.12, 0.16, 0.1, lin(GOLD));
          }
          prev = cur;
        }
      }
      // 鸱吻（脊端）
      const rp = pt(ae, 0, ridgeY + 0.4);
      bx('metal', 0.5, 0.7, 0.34, rp[0], rp[1], rp[2], GOLD, ryAt(ae));
      bx('metal', 0.22, 0.45, 0.22, rp[0] + Math.cos(ae) * inward * 0.2, rp[1] + 0.42,
        rp[2] + Math.sin(ae) * inward * 0.2, GOLD_HI, ryAt(ae));
      // 端头台基收口
      const ep = pt(ae, 0, 0);
      bx('ash', 1.4, 1.0, W + 2.2, ep[0], y0 - 0.5, ep[2], JADE_D, ryAt(ae));
    }

    sf.flush(b, 'roof');
    sfw.flush(b, 'wood');
    if (!dry) {
      b.kit('heavenGallery.bay', nBay, y0);
      b.kit('heavenGallery.column', nColumn, y0);
      b.kit('heavenGallery.dougong', nDougong, y0);
      b.kit('heavenGallery.lantern', nLamp, y0);
      b.kit('heavenGallery.railPost', nPostBuilt, y0);
      b.kit('heavenGallery.goldBrick', nBrick, y0);
      b.kit('heavenGallery.tileRib', nRib, y0);
    }
    // 自定义几何（屋面 + 木作）的三角面
    tris += sf.tris + sfw.tris;
    countBox.dougong = nDougong;
    countBox.columns = nColumn;
    countBox.lanterns = nLamp;
    countBox.posts = nPostBuilt;
    countBox.bricks = nBrick;
    countBox.ribs = nRib;
    return tris;
  };

  // 先干跑计数，再按预算选档（细节项不删，只降密度）
  let tier = TIERS.length - 1;
  let tris = 0;
  for (let i = 0; i < TIERS.length; i++) {
    const n = run(i, true);
    if (n <= maxTris) {
      tier = i;
      tris = n;
      break;
    }
    tris = n;
  }
  const realTris = run(tier, false);
  heavenGalleryStats.tier = tier;
  heavenGalleryStats.bays = nBay;
  heavenGalleryStats.columns = countBox.columns;
  heavenGalleryStats.dougong = countBox.dougong;
  heavenGalleryStats.tileRibs = countBox.ribs;
  heavenGalleryStats.lanterns = countBox.lanterns;
  heavenGalleryStats.railPosts = countBox.posts;
  heavenGalleryStats.goldBricks = countBox.bricks;
  heavenGalleryStats.arcLength = arcLen;
  heavenGalleryStats.bayLength = bayLen;
  heavenGalleryStats.spanDeg = (span * 180) / Math.PI;
  heavenGalleryStats.requestedSpanDeg = (reqSpan * 180) / Math.PI;
  heavenGalleryStats.width = W;
  heavenGalleryStats.eaveH = eaveH;
  heavenGalleryStats.ridgeY = ridgeY;
  heavenGalleryStats.tris = realTris;
  heavenGalleryStats.overBudget = realTris > maxTris;
}

/** 干跑结果的临时承接（避免把局部变量抬到模块作用域） */
const countBox = { dougong: 0, columns: 0, lanterns: 0, posts: 0, bricks: 0, ribs: 0 };
