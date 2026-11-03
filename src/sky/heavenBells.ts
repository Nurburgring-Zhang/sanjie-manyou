import * as THREE from 'three';
import { Baker, shade, type BGroup } from '../city/bake';

/**
 * 天宫编钟阵列（SPEC C3 / 参考图 R3）。
 *
 * 形制：单排 14 口青铜甬钟沿 120° 弧悬挂，钟口直径 7.0m、通高 8.75m；
 *       钟身两道龙纹浮雕带（几何外凸 0.14m + 顶点色，不用贴图）+ 乳钉两排 + 朱红飘带；
 *       下方是圆形水面（r 57）与同心涟漪，中央一座小石台。
 *
 * 落位：天宫主平台内 (170, -60)，台面 206。全部坐标为 **缩放前**（×2.2 由调用方承担）。
 * 选点依据：主平台 r<220 内该处离月台 (40,-55,r17) 113m、莲台 (120,120) 186m、斗法台 (0,0,r44) 96m，
 *           且不在内环岛带（r≥220）上。
 */

export const HEAVEN_BELLS = {
  x: 170,
  z: -60,
  /** 台面标高 */
  deckY: 206,
  /** 钟口直径（米，缩放前） */
  mouthDia: 7,
  /** 钟通高 */
  bellH: 8.75,
  /** 钟口标高（相对台面 +10.2） */
  mouthY: 216.2,
  /** 悬钟弧半径 */
  bellR: 46,
  /** 钟列总角度（度） */
  arcDeg: 120,
  /**
   * 钟列中点朝向（度）：0 = +x。镜头从 +x 侧看进来，看到凸面整排 14 口。
   */
  facingDeg: 0,
  /** 台面半径 */
  terraceR: 66,
  /** 水面半径 */
  poolR: 57,
  /** 水面标高（比台面低 0.5m） */
  waterY: 205.5,
} as const;

const D = Math.PI / 180;
const TAU = Math.PI * 2;

const JADE = 0xd8d2c2;
const JADE_D = shade(JADE, 0.82);
const JADE_HI = shade(JADE, 1.04);
const GOLD = 0xc79a35;
const GOLD_HI = 0xe8c163;
const GOLD_D = shade(GOLD, 0.7);
const RED = 0xb8422c;
const RED_D = shade(RED, 0.62);
const WOOD_D = 0x3a2414;
const BRONZE = 0x4a7a63;
const BRONZE_D = shade(BRONZE, 0.72);
const BRONZE_HI = shade(BRONZE, 1.22);
const BRONZE_WARM = 0x8f6a2c;
const WATER = 0x5fa8c6;
const WATER_DEEP = 0x3d7f9c;
const WATER_HI = 0xcbeaf4;

type V3 = [number, number, number];
type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const _col = new THREE.Color();
const _linCache = new Map<number, RGB>();
function lin(hex: number): RGB {
  const hit = _linCache.get(hex);
  if (hit) return hit;
  _col.setHex(hex);
  const v: RGB = [_col.r, _col.g, _col.b];
  _linCache.set(hex, v);
  return v;
}
function jit(i: number, s: number): number {
  let x = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

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

  flush(b: Baker, g: BGroup): void {
    if (this.dry || this.p.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    geo.computeVertexNormals();
    b.addGeo(g, geo, 0, 0, 0, 0xffffff);
    this.p.length = 0;
    this.c.length = 0;
    this.u.length = 0;
  }
}

/** 水平圆环面（台面中间要挖出水面，不能用整块圆盘盖住） */
function flatRing(b: Baker, g: BGroup, cx: number, cz: number, r0: number, r1: number, y: number, hex: number, seg = 48): void {
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  const c = lin(hex);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    const p = (a: number, r: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    const A = p(a0, r0), B = p(a0, r1), C = p(a1, r1), D = p(a1, r0);
    const push = (q: V3): void => { pos.push(q[0], q[1], q[2]); col.push(c[0], c[1], c[2]); uv.push(q[0] * 0.24, q[2] * 0.24); };
    push(A); push(D); push(C);
    push(A); push(C); push(B);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  b.addGeo(g, geo, 0, 0, 0, 0xffffff);
}

export interface HeavenBellsOpts {
  x?: number;
  z?: number;
  deckY?: number;
  /** 口数（≥12） */
  bells?: number;
  /** 钟口直径 6–8m */
  mouthDia?: number;
  /** 钟列总角度（度） */
  arcDeg?: number;
  /** 钟列中点朝向（度） */
  facingDeg?: number;
}

export interface HeavenBellsStats {
  bells: number;
  mouthDia: number;
  bellHeight: number;
  mouthY: number;
  bellR: number;
  arcDeg: number;
  tassels: number;
  ripples: number;
  columns: number;
  tris: number;
}

export const heavenBellsStats: HeavenBellsStats = {
  bells: 0, mouthDia: 0, bellHeight: 0, mouthY: 0, bellR: 0, arcDeg: 0,
  tassels: 0, ripples: 0, columns: 0, tris: 0,
};

/** 钟体轮廓（自钟口向上，半径与高度都用「钟口半径」归一） */
const PROFILE: [number, number][] = [
  [1.0, 0.0],
  [0.985, 0.075],
  [0.94, 0.17],
  [0.86, 0.38],
  [0.78, 0.62],
  [0.70, 0.80],
  [0.62, 0.90],
  [0.52, 0.955],
  [0.42, 1.0],
];

interface BellCtx {
  cx: number;
  cz: number;
  /** 钟心极角 */
  a: number;
  /** 钟口半径 */
  R: number;
  /** 钟口标高 */
  mouthY: number;
  /** 通高 */
  H: number;
}

function bellPoint(c: BellCtx, ang: number, frac: number, rScale: number, extraR = 0): V3 {
  const rr = c.R * rScale + extraR;
  return [c.cx + Math.cos(ang) * rr, c.mouthY + c.H * frac, c.cz + Math.sin(ang) * rr];
}

/** 一口钟：钟体 + 内壁 + 口沿 + 龙纹带 + 乳钉 + 钮 + 飘带 */
function buildBell(b: Baker, sf: Surf, sfw: Surf, c: BellCtx, idx: number, tassels: { n: number }): void {
  const SEG = 24;
  const H = c.H;
  // 钟体（外表面）
  for (let k = 0; k < PROFILE.length - 1; k++) {
    const [r0, f0] = PROFILE[k];
    const [r1, f1] = PROFILE[k + 1];
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * TAU;
      const a1 = ((s + 1) / SEG) * TAU;
      const p00 = bellPoint(c, a0, f0, r0);
      const p01 = bellPoint(c, a0, f1, r1);
      const p11 = bellPoint(c, a1, f1, r1);
      const p10 = bellPoint(c, a1, f0, r0);
      const band = k / (PROFILE.length - 1);
      const v = 0.9 + jit(s + k * 31, idx) * 0.16;
      // 口沿一圈亮铜（参考图里钟口是磨亮的），身中段青铜锈，顶部收口偏暗
      const hex = k === 0 ? BRONZE_WARM : k <= 2 ? shade(BRONZE_HI, v) : k <= 5 ? shade(BRONZE, v) : BRONZE_D;
      const cc = lin(hex);
      sf.quad(p00, p01, p11, p10, cc, cc, cc, cc);
    }
  }
  // 内壁（仰视能看到钟内暗腔，不能是实心）
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * TAU;
    const a1 = ((s + 1) / SEG) * TAU;
    const p00 = bellPoint(c, a0, 0.0, 0.93);
    const p10 = bellPoint(c, a1, 0.0, 0.93);
    const p01 = bellPoint(c, a0, 0.36, 0.60);
    const p11 = bellPoint(c, a1, 0.36, 0.60);
    const cc = lin(0x1d2f28);
    sf.quad(p10, p11, p01, p00, cc, cc, cc, cc);
  }
  // 钟口环面（外沿→内壁，厚 0.4m）
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * TAU;
    const a1 = ((s + 1) / SEG) * TAU;
    const p0 = bellPoint(c, a0, 0.0, 1.0);
    const p1 = bellPoint(c, a1, 0.0, 1.0);
    const p2 = bellPoint(c, a1, 0.035, 0.93);
    const p3 = bellPoint(c, a0, 0.035, 0.93);
    const cc = lin(shade(BRONZE_WARM, 1.12));
    sf.quad(p0, p3, p2, p1, cc, cc, cc, cc);
  }
  // 龙纹浮雕带 ×2：沿钟身绕行的 S 形凸带（外凸 0.14m）
  for (const band of [0.30, 0.62]) {
    const N = 20;
    const turns = 2;    // 2 个波峰绕钟一周 = 两条龙
    const amp = H * 0.055;
    const bh = H * 0.075;
    const cy0 = c.mouthY + H * band;
    for (let s = 0; s < N; s++) {
      const a0 = (s / N) * TAU;
      const a1 = ((s + 1) / N) * TAU;
      const y0 = cy0 + Math.sin(a0 * turns) * amp;
      const y1 = cy0 + Math.sin(a1 * turns) * amp;
      const y0b = y0 + bh;
      const y1b = y1 + bh;
      const P = (ang: number, yy: number, extra: number): V3 => {
        const f = (yy - c.mouthY) / H;
        // 该高度处的钟半径（线性插值轮廓）
        let rs = 1;
        for (let k = 0; k < PROFILE.length - 1; k++) {
          const [r0, f0] = PROFILE[k];
          const [r1, f1] = PROFILE[k + 1];
          if (f >= f0 && f <= f1) { rs = r0 + (r1 - r0) * ((f - f0) / (f1 - f0)); break; }
        }
        return bellPoint(c, ang, f, rs, extra);
      };
      const p00 = P(a0, y0, 0.02);
      const p01 = P(a0, y0b, 0.02);
      const p11 = P(a1, y1b, 0.02);
      const p10 = P(a1, y1, 0.02);
      const p00f = P(a0, y0, 0.16);
      const p01f = P(a0, y0b, 0.16);
      const p11f = P(a1, y1b, 0.16);
      const p10f = P(a1, y1, 0.16);
      const hi = (s & 1) === 0;
      // 一整条凸带一个色（不逐段换色，否则读成锯齿花纹）；明暗只做 4% 抖动
      const cf = lin(shade(hi ? BRONZE_HI : BRONZE, 0.98 + jit(s, 31) * 0.05));
      const cs = lin(BRONZE_D);
      sf.quad(p00f, p01f, p11f, p10f, cf, cf, cf, cf);      // 浮雕正面
      sf.quad(p00, p00f, p10f, p10, cs, cs, cs, cs);        // 下侧面
      sf.quad(p01f, p01, p11, p11f, cs, cs, cs, cs);        // 上侧面
      // 龙脊：凸带中线上一条 0.2m 宽的金线（远看是「一条龙盘在钟上」）
      const e0 = P(a0, y0 + bh * 0.45, 0.24);
      const e1 = P(a1, y1 + bh * 0.45, 0.24);
      const e2 = P(a1, y1 + bh * 0.62, 0.24);
      const e3 = P(a0, y0 + bh * 0.62, 0.24);
      const ce = lin(GOLD_D);
      sf.quad(e0, e1, e2, e3, ce, ce, ce, ce);
    }
    // 龙首（浮雕带上的一处高凸：吻 + 角 + 眼，读得出是「头」不是花纹）
    const ha = Math.PI * 0.25;
    const f = band;
    const hx = c.cx + Math.cos(ha) * (c.R + 0.42);
    const hz = c.cz + Math.sin(ha) * (c.R + 0.42);
    const hy = c.mouthY + H * f + H * 0.02;
    b.box('metal', 1.15, 1.0, 1.15, hx, hy, hz, BRONZE_HI, -ha + Math.PI / 2);
    b.box('metal', 0.9, 0.55, 0.9, hx + Math.cos(ha) * 1.0, hy - 0.2, hz + Math.sin(ha) * 1.0, BRONZE_WARM, -ha + Math.PI / 2);
    b.box('metal', 0.42, 0.42, 0.42, hx + Math.cos(ha) * 0.55, hy + 0.62, hz + Math.sin(ha) * 0.55, GOLD_HI, -ha);
    b.box('metal', 0.3, 0.3, 0.3, hx - Math.cos(ha) * 0.5, hy + 0.6, hz - Math.sin(ha) * 0.5, GOLD_D, -ha);
  }
  // 乳钉两排（36 枚的简化：每排 12 枚，只落在正面朝外的一面）
  for (const band of [0.46, 0.78]) {
    for (let s = 0; s < SEG; s += 2) {
      const ang = (s / SEG) * TAU;
      const f = band;
      let rs = 1;
      for (let k = 0; k < PROFILE.length - 1; k++) {
        const [r0, f0] = PROFILE[k];
        const [r1, f1] = PROFILE[k + 1];
        if (f >= f0 && f <= f1) { rs = r0 + (r1 - r0) * ((f - f0) / (f1 - f0)); break; }
      }
      const p = bellPoint(c, ang, f, rs, 0.12);
      b.box('metal', 0.34, 0.34, 0.34, p[0], p[1], p[2], shade(BRONZE_WARM, 1.05), -ang);
    }
  }
  // 钟钮（舞顶的悬环）+ 悬杆
  const topY = c.mouthY + c.H;
  const crown: V3 = [c.cx, topY + 0.45, c.cz];
  b.box('metal', 1.0, 0.36, 0.5, crown[0], crown[1], crown[2], BRONZE_WARM, -c.a);
  b.box('metal', 0.36, 0.42, 0.9, crown[0], crown[1] + 0.34, crown[2], BRONZE_WARM, -c.a);
  b.box('metal', 0.9, 0.14, 0.14, crown[0], crown[1] + 0.6, crown[2], BRONZE_HI, -c.a);
  // 朱红飘带（两条，自钟钮两侧垂下）
  for (const sg of [-1, 1] as const) {
    const ang = c.a + sg * (1.55 / c.R);
    for (let k = 0; k < 3; k++) {
      const y0 = topY + 0.1 - k * 1.15 - Math.sin(k * 0.7) * 0.18;
      const p = bellPoint(c, ang, 0, 1.0, 0.16 + k * 0.05);
      const px = p[0] + Math.cos(ang) * 0.0;
      const pz = p[2] + Math.sin(ang) * 0.0;
      sfw.quad(
        [px - Math.cos(c.a + Math.PI / 2) * 0.22, y0, pz - Math.sin(c.a + Math.PI / 2) * 0.22],
        [px + Math.cos(c.a + Math.PI / 2) * 0.22, y0, pz + Math.sin(c.a + Math.PI / 2) * 0.22],
        [px + Math.cos(c.a + Math.PI / 2) * 0.18, y0 - 1.0, pz + Math.sin(c.a + Math.PI / 2) * 0.18],
        [px - Math.cos(c.a + Math.PI / 2) * 0.18, y0 - 1.0, pz - Math.sin(c.a + Math.PI / 2) * 0.18],
        lin(k === 0 ? RED : shade(RED, 0.92 - k * 0.06)), lin(k === 0 ? RED : shade(RED, 0.92 - k * 0.06)),
        lin(RED_D), lin(RED_D),
      );
    }
    tassels.n++;
    b.box('wood', 0.26, 0.26, 0.26, crown[0] + Math.cos(c.a + Math.PI / 2) * sg * 0.36, topY + 0.22,
      crown[2] + Math.sin(c.a + Math.PI / 2) * sg * 0.36, GOLD_D, -c.a);
  }
  void sfw;
}

/** 立柱（朱漆 + 金箍 + 石础 + 斗栱托） */
function buildColumn(b: Baker, x: number, z: number, deckY: number, topY: number, ry: number): void {
  b.box('ash', 2.2, 0.5, 2.2, x, deckY + 0.25, z, JADE_D, ry);
  b.box('ash', 1.8, 0.3, 1.8, x, deckY + 0.62, z, JADE, ry);
  b.cyl('wood', 0.62, 0.72, topY - deckY - 0.8, 12, x, (topY + deckY + 0.8) / 2, z, RED, ry);
  const shaftTop = topY - 1.4;
  b.cyl('wood', 0.78, 0.78, 0.36, 12, x, shaftTop, z, GOLD, ry);
  b.cyl('wood', 0.78, 0.78, 0.26, 12, x, deckY + 2.6, z, GOLD_D, ry);
  // 柱头斗栱（一跳 + 栌斗）
  b.box('wood', 1.5, 0.5, 1.5, x, topY - 1.0, z, GOLD_D, ry);
  b.box('wood', 2.4, 0.36, 1.0, x, topY - 0.62, z, GOLD, ry);
  b.box('wood', 1.0, 0.36, 2.4, x, topY - 0.62, z, GOLD, ry);
}

export function buildHeavenBells(b: Baker, opts: HeavenBellsOpts = {}): HeavenBellsStats {
  const cx = opts.x ?? HEAVEN_BELLS.x;
  const cz = opts.z ?? HEAVEN_BELLS.z;
  const deckY = opts.deckY ?? HEAVEN_BELLS.deckY;
  const nBell = Math.max(12, Math.round(opts.bells ?? 14));
  const mouthDia = clamp(opts.mouthDia ?? HEAVEN_BELLS.mouthDia, 6, 8);
  const arcDeg = clamp(opts.arcDeg ?? HEAVEN_BELLS.arcDeg, 40, 220);
  const face = (opts.facingDeg ?? HEAVEN_BELLS.facingDeg) * D;
  const R = mouthDia / 2;
  const bellR = HEAVEN_BELLS.bellR;
  const mouthY = deckY + (HEAVEN_BELLS.mouthY - HEAVEN_BELLS.deckY);
  const triBefore = totalTris(b);
  const sf = new Surf(false);   // 钟体（metal 组）
  const sfw = new Surf(false);  // 飘带（fabric 组）

  // ---------- 台基：三级石座（做开口筒：顶盖会把水池盖死、把水面衬成浅石色） ----------
  const TR = HEAVEN_BELLS.terraceR;
  b.cyl('ash', TR, TR * 0.98, 3.2, 36, cx, deckY - 1.6, cz, JADE_D, 0, 0, 0, true);
  b.cyl('ash', TR * 0.94, TR * 0.9, 3.2, 36, cx, deckY - 4.8, cz, shade(JADE_D, 0.9), 0, 0, 0, true);
  b.cyl('ash', TR * 0.86, TR * 0.8, 3.0, 36, cx, deckY - 7.9, cz, shade(JADE_D, 0.82), 0, 0, 0, true);
  // 台面：只铺「池沿 → 台缘」一圈（中间留给水面，整块圆盘会把水盖死）
  flatRing(b, 'ash', cx, cz, HEAVEN_BELLS.poolR + 0.4, TR * 0.985, deckY, 0xbdb6a4, 48);
  b.cyl('ash', TR, TR, 0.34, 36, cx, deckY - 0.1, cz, JADE_HI, 0, 0, 0, true);
  // 金线一圈
  b.cyl('wood', TR * 1.002, TR * 1.002, 0.1, 36, cx, deckY + 0.06, cz, GOLD_D, 0, 0, 0, true);

  // ---------- 水面 + 池底 + 同心涟漪 ----------
  const poolR = HEAVEN_BELLS.poolR;
  const wy = deckY - (HEAVEN_BELLS.deckY - HEAVEN_BELLS.waterY);
  b.cyl('water', poolR, poolR, 0.12, 48, cx, wy - 0.06, cz, WATER);
  // 池壁：从水面一直砌到台面（浅色石壁，读得出「池」）
  b.cyl('ash', poolR, poolR, 2.7, 48, cx, wy - 1.28, cz, shade(JADE, 0.86), 0, 0, 0, true);
  b.cyl('ash', poolR + 0.55, poolR + 0.55, 0.28, 48, cx, deckY - 0.14, cz, JADE_HI, 0, 0, 0, true);
  b.cyl('ground', poolR * 0.98, poolR * 0.98, 0.3, 36, cx, wy - 2.4, cz, 0x16333c);
  let ripples = 0;
  for (let i = 0; i < 11; i++) {
    const rr = 10.5 + i * 4.4;
    if (rr > poolR - 4) break;
    const a = 0.6 + (i % 2) * 0.24;
    // 水平环形面（开口圆柱侧看是一条线，从上方根本看不见涟漪）
    flatRing(b, 'water', cx, cz, rr - 0.36, rr + 0.36, wy + 0.05, shade(WATER_HI, a), 64);
    flatRing(b, 'water', cx, cz, rr + 1.15, rr + 1.55, wy + 0.045, shade(WATER, 1.08), 64);
    ripples++;
  }
  // 中央小平台
  const daisR = 9;
  b.cyl('ash', daisR, daisR * 1.04, 0.9, 8, cx, wy + 0.45, cz, JADE);
  b.cyl('ash', daisR * 1.1, daisR * 1.1, 0.24, 8, cx, wy + 0.86, cz, JADE_HI);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.box('ash', 0.5, 0.7, 0.5, cx + Math.cos(a) * (daisR - 0.4), wy + 1.25, cz + Math.sin(a) * (daisR - 0.4), JADE_HI, -a);
  }
  b.kit('heavenBells.dais', 1, wy);

  // ---------- 台缘栏杆 ----------
  const nPost = 40;
  for (let i = 0; i < nPost; i++) {
    const a = (i / nPost) * TAU;
    const px = cx + Math.cos(a) * (TR - 0.6);
    const pz = cz + Math.sin(a) * (TR - 0.6);
    // 正对钟列的缺口：留出上台阶的位置（±7°）
    if (Math.abs(((a - face + Math.PI * 3) % TAU) - Math.PI) < 0.42) continue;
    b.box('ash', 0.42, 1.5, 0.42, px, deckY + 0.75, pz, JADE, -a);
    b.box('ash', 0.6, 0.18, 0.6, px, deckY + 1.58, pz, JADE_HI, -a);
  }
  for (const yy of [0.45, 1.25]) {
    b.cyl('ash', TR - 0.6, TR - 0.6, 0.12, 48, cx, deckY + yy, cz, yy > 1 ? JADE_HI : JADE, 0, 0, 0, true);
  }
  b.kit('heavenBells.railPost', nPost, deckY);

  // ---------- 钟列：14 口沿 120° 弧悬挂 ----------
  const half = (arcDeg * D) / 2;
  const tassels = { n: 0 };
  let bellCount = 0;
  for (let i = 0; i < nBell; i++) {
    const f = nBell === 1 ? 0.5 : i / (nBell - 1);
    const a = face - half + f * arcDeg * D;
    const bell: BellCtx = { cx: cx + Math.cos(a) * bellR, cz: cz + Math.sin(a) * bellR, a, R, mouthY, H: HEAVEN_BELLS.bellH };
    sfr(bell, i);
    bellCount++;
  }
  function sfr(c: BellCtx, idx: number): void {
    // 悬杆：从横梁落到钟钮
    const topY = c.mouthY + c.H + 1.0;
    b.cyl('metal', 0.12, 0.12, 1.1, 6, c.cx, topY + 0.55, c.cz, BRONZE_WARM, -c.a);
    buildBell(b, sf, sfw, c, idx, tassels);
  }

  // ---------- 立柱与横梁（8 柱，随弧） ----------
  const nCol = 8;
  const colR = bellR + 7;
  const beamY = mouthY + HEAVEN_BELLS.bellH + 1.1;
  let columns = 0;
  const colAng: number[] = [];
  for (let i = 0; i < nCol; i++) {
    const f = i / (nCol - 1);
    const a = face - half - 6 * D + f * (arcDeg + 12) * D;
    colAng.push(a);
    const px = cx + Math.cos(a) * colR;
    const pz = cz + Math.sin(a) * colR;
    buildColumn(b, px, pz, deckY, beamY + 1.5, -a - Math.PI / 2);
    columns++;
  }
  // 弧形横梁：两圈（外圈主梁 + 内圈承钟梁）+ 每跨斜撑
  for (let i = 0; i < nCol - 1; i++) {
    const a0 = colAng[i];
    const a1 = colAng[i + 1];
    const am = (a0 + a1) / 2;
    const segLen = Math.hypot(
      Math.cos(a1) * colR - Math.cos(a0) * colR,
      Math.sin(a1) * colR - Math.sin(a0) * colR,
    ) * 1.04;
    for (const [rr, h, d, hex] of [[colR, 1.0, 1.1, WOOD_D], [bellR + 0.4, 0.9, 0.8, shade(WOOD_D, 1.15)], [bellR - 1.0, 0.34, 0.5, GOLD_D]] as const) {
      const px = cx + Math.cos(am) * rr;
      const pz = cz + Math.sin(am) * rr;
      b.box('wood', segLen, h, d, px, beamY + (rr === colR ? 0.4 : 0), pz, hex, -am - Math.PI / 2);
    }
    // 短柱（承钟梁落到主梁，别做斜撑——仰视时两根斜杆会读成悬空的 X）
    const pmx = cx + Math.cos(am) * (colR - 1.8);
    const pmz = cz + Math.sin(am) * (colR - 1.8);
    b.box('wood', 0.42, 1.6, 0.42, pmx, beamY + 0.1, pmz, WOOD_D, -am - Math.PI / 2);
    // 梁头金饰
    b.box('metal', 0.5, 0.5, 0.5, cx + Math.cos(a1) * colR, beamY + 0.45, cz + Math.sin(a1) * colR, GOLD, -a1);
  }
  // 两端额枋收头
  b.box('wood', 0.6, 1.4, 3.2, cx + Math.cos(colAng[0]) * colR, beamY + 0.4, cz + Math.sin(colAng[0]) * colR, GOLD_D, -colAng[0]);
  b.box('wood', 0.6, 1.4, 3.2, cx + Math.cos(colAng[nCol - 1]) * colR, beamY + 0.4, cz + Math.sin(colAng[nCol - 1]) * colR, GOLD_D, -colAng[nCol - 1]);

  // ---------- 正面上台阶（3 级） ----------
  for (let k = 0; k < 4; k++) {
    const rr = TR + 0.2 + k * 2.2;
    const px = cx + Math.cos(face) * rr;
    const pz = cz + Math.sin(face) * rr;
    b.box('ash', 16 - k * 1.4, 0.5, 2.3, px, deckY - 0.25 - k * 0.5, pz, k % 2 ? JADE : JADE_D, -face - Math.PI / 2);
  }

  sf.flush(b, 'metal');
  sfw.flush(b, 'fabric');
  b.kit('heavenBells.bell', bellCount, mouthY);
  b.kit('heavenBells.column', columns, deckY);
  b.kit('heavenBells.ripple', ripples, wy);

  heavenBellsStats.bells = bellCount;
  heavenBellsStats.mouthDia = mouthDia;
  heavenBellsStats.bellHeight = HEAVEN_BELLS.bellH;
  heavenBellsStats.mouthY = mouthY;
  heavenBellsStats.bellR = bellR;
  heavenBellsStats.arcDeg = arcDeg;
  heavenBellsStats.tassels = tassels.n;
  heavenBellsStats.ripples = ripples;
  heavenBellsStats.columns = columns;
  heavenBellsStats.tris = totalTris(b) - triBefore;
  return heavenBellsStats;
}

function totalTris(b: Baker): number {
  const s = b.stats();
  let n = 0;
  for (const g of Object.values(s.groups)) n += g.triangles;
  return n;
}
