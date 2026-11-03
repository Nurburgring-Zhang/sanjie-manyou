import * as THREE from 'three';
import { Baker, shade, type BGroup } from '../city/bake';
import { HEAVEN_BASE_LIFTED } from './heavenFrame';

/**
 * 天宫平台外缘：整面水帘（SPEC C1）+ 汉白玉龙首吐水（SPEC C2）。
 *
 * 全部坐标是 **scaleHeavenGeometry 之前的缩放前口径**（与 heavenGallery.ts 一致）。
 * 落位（极坐标，圆心 = 天宫平台中心 (0,0)，单位米）：
 *   · 崖嘴水口：t = 75° / 105°，外唇 r = 706+22 = 728，顶面 y = 233，出水唇 y = 232.6
 *   · 龙首台：  t = 45° / 65° / 115° / 135°，外唇 r = 706+16 = 722，顶面 y = 222
 *   两道大水帘落差 59.4m（232.6 → 173.2），宽 56m；龙首口水柱落差 44m。
 *   云海顶面 196.65：水帘在云线以上可见约 36m，以下没入云海（落差按几何算 59m）。
 *
 * 组织：
 *   buildHeavenWater(b)         —— 静态烘焙。石崖/池/水帘/水花/静态水雾全部进 Baker，
 *                                 不接动画也能出图（瀑布本体是几何，不是贴图平板）。
 *   createHeavenWaterFlow()     —— 动态叠加层（竖向流痕 + 漂移水雾）。由宿主 scene.add + 每帧
 *                                 updateHeavenWaterFlow(t)。不接也仍有静态水帘与水雾。
 */

// ============ 站点常量（探针/宿主接线都从这里取） ============
export const HEAVEN_WATER = {
  /** 崖嘴外唇半径（缩放前） */
  rimR: 706,
  /** 崖嘴外墙面半径 = rimR + 22 */
  lipR: 728,
  /** 崖顶台面标高 */
  deckY: 233,
  /** 出水唇标高 */
  lipY: 232.6,
  /** 落底标高（云海面以下） */
  bottomY: 173.2,
  /** 水帘宽（米） */
  fallW: 56,
  /** 大水帘方位（度） */
  fallAngles: [75, 105] as const,
  /** 龙首台方位（度） */
  bastionAngles: [45, 65, 115, 135] as const,
  /** 龙首台顶面 */
  bastionTopY: 222,
  /** 龙口标高（台顶 222 之上，整颗头是逆光剪影） */
  dragonMouthY: 227,
  /** 龙口吐水落底 */
  dragonBottomY: 175,
} as const;

const D = Math.PI / 180;

// ============ 调色板（sRGB；Baker 的 setHex 会转线性） ============
const JADE = 0xd8d2c2;
const JADE_D = shade(JADE, 0.82);
const JADE_DD = shade(JADE, 0.7);
const JADE_HI = shade(JADE, 1.05);
const GOLD = 0xc79a35;
const GOLD_HI = 0xe8c163;
const GOLD_D = shade(GOLD, 0.7);
// 水：偏冷白，靠顶点色分层读「水」而不是一块蓝板
const W_CREST = 0xf2fbff;
const W_HI = 0xc7e8f4;
const W_MID = 0x8ecadd;
const W_DEEP = 0x62a9c6;
const W_EDGE = 0xd8eef7;
const MIST = 0xcfe2ee;
const MIST_HI = 0xe9f3f8;

// ============ 小工具 ============
type V3 = [number, number, number];
type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

const _col = new THREE.Color();
const _linCache = new Map<number, RGB>();
/** sRGB hex → 线性 RGB（与 heavenGallery 的 lin() 同口径） */
function lin(hex: number): RGB {
  const hit = _linCache.get(hex);
  if (hit) return hit;
  _col.setHex(hex);
  const v: RGB = [_col.r, _col.g, _col.b];
  _linCache.set(hex, v);
  return v;
}
/** 确定性哈希抖动（不消耗共享 rng） */
function jit(i: number, s: number): number {
  let x = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** 世界坐标三角形缓冲（顶点色绝对着色，addGeo 传 0xffffff） */
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

// ============ 参数 ============
export interface HeavenWaterOpts {
  cx?: number;
  cz?: number;
  /** 大水帘方位（度） */
  fallAngles?: readonly number[];
  /** 龙首台方位（度） */
  bastionAngles?: readonly number[];
  /** 水帘宽（米，缩放前） */
  fallW?: number;
  /** 出水唇标高 */
  deckY?: number;
  /** 落底标高 */
  bottomY?: number;
  /** 是否建石崖本体（探针做纯水测试时可关） */
  withCliff?: boolean;
  /** 是否建静态水雾（默认 true） */
  withMist?: boolean;
}

export interface HeavenWaterStats {
  falls: number;
  bastions: number;
  dragons: number;
  fallWidth: number;
  fallDrop: number;
  fallRimR: number;
  lipY: number;
  bottomY: number;
  mistPuffs: number;
  tris: number;
}

export const heavenWaterStats: HeavenWaterStats = {
  falls: 0, bastions: 0, dragons: 0, fallWidth: 0, fallDrop: 0, fallRimR: 0,
  lipY: 0, bottomY: 0, mistPuffs: 0, tris: 0,
};

// ============ 局部坐标：u = 切向，w = 径向（+ 向外），y = 绝对标高 ============
interface Frame {
  cx: number; cz: number; t: number;
  /** u 切向偏移、w 径向偏移（相对 HEAVEN_WATER.rimR）、yy 绝对 y */
  p: (u: number, w: number, yy: number) => V3;
  /** 切向长度的盒子用：绕 y 旋转角 */
  ry: number;
}

function frameAt(cx: number, cz: number, deg: number): Frame {
  const t = deg * D;
  const ct = Math.cos(t), st = Math.sin(t);
  return {
    cx, cz, t, ry: -t - Math.PI / 2,
    p: (u, w, yy) => [cx + ct * (HEAVEN_WATER.rimR + w) - st * u, yy, cz + st * (HEAVEN_WATER.rimR + w) + ct * u],
  };
}

/** 盒子：宽 w 沿切向、深 d 沿径向、高 h 竖直 */
function fbox(b: Baker, g: BGroup, f: Frame, u: number, w: number, yy: number, wu: number, h: number, d: number, hex: number): void {
  const p = f.p(u, w, yy);
  b.box(g, wu, h, d, p[0], p[1], p[2], hex, f.ry);
}

// ============ C1：崖嘴 + 整面水帘 ============
function buildCliff(b: Baker, f: Frame, topY: number, W: number): void {
  // 三级崖体：外墙面全部齐平在 r=728（水帘才能贴着崖面整面倾泻，不撞下半截石体）
  const deck = topY;
  const tiers: [number, number, number, number][] = [
    // [外唇内收 r, 高度, 切向宽, 底部 y]
    [0, 20, 78, 196.6],
    [10, 12, 68, 216.6],
    [18, deck - 228.6, 58, 228.6],
  ];
  for (let i = 0; i < tiers.length; i++) {
    const [inset, h, wu, yb] = tiers[i];
    const depth = 44 - inset;
    const centerW = 22 - depth / 2;      // 外唇恒在 rimR + 22
    const hex = i === 0 ? JADE_D : i === 1 ? JADE : JADE_HI;
    fbox(b, 'ash', f, 0, centerW, yb + h / 2, wu, h, depth, hex);
    // 每级挑檐：向外探 2.6m 的石檐（把 40m 高的白石面切成三段，不再是一整块板）
    fbox(b, 'ash', f, 0, 22 - 1.3, yb + h - 0.45, wu + 2.6, 0.9, 2.6, shade(hex, 1.06));
    fbox(b, 'wood', f, 0, 22 - 0.15, yb + h - 0.95, wu + 2.4, 0.16, 0.4, GOLD_D);
    // 竖向壁柱：让每级石面不是一块光板（柱间留 6–8m 的板面）
    const nPil = 7;
    for (let k = 0; k < nPil; k++) {
      const u = (k / (nPil - 1) - 0.5) * (wu - 4);
      fbox(b, 'ash', f, u, 22 - 0.5, yb + h / 2, 2.0, h * 0.92, 1.0, shade(hex, 0.9 + jit(k, i) * 0.12));
    }
    // 底部水蚀带（贴落水一侧压暗，读作常年水汽）
    fbox(b, 'ash', f, 0, 22 - 0.1, yb + 1.2, wu - 2, 2.2, 0.5, shade(hex, 0.78));
  }
  // 崖顶：出水渠（一条深色水槽）+ 两侧汉白玉栏板
  const halfTop = 29;                       // 顶层面（58 宽）的半宽
  fbox(b, 'water', f, 0, 22 - 6.5, deck + 0.06, halfTop * 2 - 2, 0.16, 11, W_DEEP);
  fbox(b, 'ash', f, 0, 22 - 0.5, deck + 0.34, halfTop * 2 - 2, 0.72, 1.0, JADE_HI);
  for (const sg of [-1, 1] as const) {
    const u = sg * (halfTop - 1);
    fbox(b, 'ash', f, u, 10, deck + 0.5, 1.2, 1.0, 24, JADE);
    fbox(b, 'wood', f, u, 10, deck + 1.02, 1.5, 0.14, 24, GOLD);
    for (let k = 0; k < 4; k++) {
      fbox(b, 'ash', f, u, 22 - 2 - k * 7, deck + 0.9, 0.9, 0.8, 0.9, JADE_HI);
    }
  }
  // 两根汉白玉龙柱夹住水口（参考图 R4/R5 的「框」；没有它，水帘只是一面墙）
  // 柱脚落在第二级挑檐（顶面 216.6、68m 宽）的肩上，柱身升到崖顶之上
  const pY = 216.6;
  for (const sg of [-1, 1] as const) {
    const u = sg * 30.5;
    const x0 = 22 - 2.2;
    for (let k = 0; k < 4; k++) {
      fbox(b, 'ash', f, u, x0, pY + 0.6 + k * 5.4, 4.6 - k * 0.24, 5.6, 4.6 - k * 0.24, k % 2 ? JADE : JADE_HI);
      fbox(b, 'wood', f, u, x0, pY + 3.4 + k * 5.4, 4.4 - k * 0.22, 0.24, 4.4 - k * 0.22, GOLD_D);
    }
    const topY = pY + 0.6 + 4 * 5.4;      // ≈ 238.2
    fbox(b, 'ash', f, u, x0, topY + 0.5, 4.2, 0.9, 4.2, JADE_HI);
    fbox(b, 'wood', f, u, x0, topY + 0.05, 4.8, 0.3, 4.8, GOLD);
    // 柱头莲座 + 宝珠
    b.cyl('ash', 2.5, 3.0, 1.1, 8, f.p(u, x0, topY + 1.4)[0], topY + 1.4, f.p(u, x0, 0)[2], JADE_HI);
    b.cyl('wood', 1.0, 1.3, 1.3, 8, f.p(u, x0, topY + 2.6)[0], topY + 2.6, f.p(u, x0, 0)[2], GOLD_HI);
    // 柱身缠龙（五道金箍，远看是盘龙柱而不是光柱）
    for (let k = 0; k < 5; k++) {
      const yy = pY + 2.4 + k * 4.4;
      fbox(b, 'wood', f, u, x0 - 2.1, yy, 5.1, 0.44, 0.52, GOLD);
      fbox(b, 'wood', f, u + sg * 1.7, x0 - 2.3, yy + 0.7, 1.5, 0.36, 0.42, GOLD_D);
    }
  }
  // 出水唇：一道白色翻卷（水口石 + 水面隆起）
  fbox(b, 'ash', f, 0, 22 - 0.3, deck - 0.1, 46, 0.5, 1.2, JADE_HI);
  const lip = new Surf(false);
  const lipL = f.p(-23, 22.4, deck + 0.02);
  const lipR2 = f.p(23, 22.4, deck + 0.02);
  const lipRb = f.p(23, 23.4, deck - 0.55);
  const lipLb = f.p(-23, 23.4, deck - 0.55);
  const cw = lin(W_CREST);
  lip.quad(lipL, lipR2, lipRb, lipLb, cw, cw, cw, cw);
  lip.quad(lipR2, lipL, lipLb, lipRb, cw, cw, cw, cw);
  lip.flush(b, 'water');
  void W;
}

/** 一道水帘：3 层不同速度/宽度/半径的水片 + 竖向流痕 + 顶部翻卷 + 底部水花 */
function buildCurtain(b: Baker, f: Frame, topY: number, bottomY: number, W: number): number {
  const sf = new Surf(false);
  const NU = 34;
  const NV = 22;
  const lipR = 22.4;
  /** v∈[0,1] 下落参数；返回该处的水片半径偏移、宽度缩放、y */
  const shape = (v: number): { w: number; ws: number; y: number } => {
    const y = topY - (topY - bottomY) * Math.pow(v, 1.08);
    // 出水后先向外抛 2.2m，再几乎垂直下落；越落越薄越散
    const w = lipR + 2.2 * (1 - Math.pow(1 - v, 2.4)) + 0.5 * Math.sin(v * Math.PI) ;
    const ws = 1 + 0.12 * v;
    return { w, ws, y };
  };
  const layers: [number, number, number, number][] = [
    // [额外半径, 宽度比, 下段截断, 亮度]
    [0, 1.0, 1.0, 1.0],
    [0.9, 0.84, 0.97, 0.93],
    [1.9, 0.62, 0.93, 0.86],
  ];
  for (const [dr, wf, cut, bright] of layers) {
    for (let iv = 0; iv < NV; iv++) {
      const v0 = (iv / NV) * cut;
      const v1 = ((iv + 1) / NV) * cut;
      const s0 = shape(v0);
      const s1 = shape(v1);
      for (let iu = 0; iu < NU; iu++) {
        const u0 = iu / NU - 0.5;
        const u1 = (iu + 1) / NU - 0.5;
        const half0 = (W * 0.5) * s0.ws * wf;
        const half1 = (W * 0.5) * s1.ws * wf;
        const P = (u: number, s: { w: number; y: number }, hw: number, back = 0): V3 =>
          f.p(u * 2 * hw, s.w + dr - back, s.y);
        const a = P(u0, s0, half0);
        const bb = P(u1, s0, half0);
        const c = P(u1, s1, half1);
        const d = P(u0, s1, half1);
        // 颜色按**顶点**取（不再逐格换色）：横向大尺度明暗 + 顶部翻白，避免读成一条条蓝板
        const mixc = (A: number, B: number, t: number): RGB => {
          const ca = lin(A), cb = lin(B);
          return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
        };
        const colAt = (u: number, vv: number): RGB => {
          const n = 0.5 + 0.30 * Math.sin(u * 7.1 + 0.6) + 0.18 * Math.sin(u * 19.3 + 2.2) + 0.08 * Math.sin(u * 47.0 + 4.4);
          let c = mixc(W_HI, W_DEEP, clamp(0.62 - n * 0.62, 0, 1));
          if (vv < 0.07) c = mixc(W_CREST, W_HI, vv / 0.07);
          const k = bright * (0.95 + 0.09 * Math.sin(vv * 8.0 + u * 3.0));
          return [c[0] * k, c[1] * k, c[2] * k];
        };
        const q0 = colAt(u0, v0);
        const q1 = colAt(u1, v0);
        const q2 = colAt(u1, v1);
        const q3 = colAt(u0, v1);
        sf.quad(a, bb, c, d, q0, q1, q2, q3);
        // 背面（water 组是 FrontSide；单面水片从另一侧看会消失）。往里让 6cm，避免共面 z-fighting
        const a2 = P(u0, s0, half0, 0.06);
        const b2 = P(u1, s0, half0, 0.06);
        const c2 = P(u1, s1, half1, 0.06);
        const d2 = P(u0, s1, half1, 0.06);
        sf.quad(b2, a2, d2, c2, q1, q0, q3, q2);
      }
    }
  }
  // 顶部翻卷：唇口外那道亮白弧（比水片更靠外、更亮）
  {
    const n = 16;
    for (let k = 0; k < n; k++) {
      const u0 = (k / n - 0.5) * W;
      const u1 = ((k + 1) / n - 0.5) * W;
      const y0 = topY + 0.55 - Math.abs(k / n - 0.5) * 0.4;
      const a = f.p(u0, lipR - 0.2, y0);
      const bb = f.p(u1, lipR - 0.2, y0);
      const c = f.p(u1, lipR + 2.1, y0 - 2.0);
      const d = f.p(u0, lipR + 2.1, y0 - 2.0);
      const a2 = f.p(u0, lipR - 0.2, y0 - 0.04);
      const b2 = f.p(u1, lipR - 0.2, y0 - 0.04);
      const c2 = f.p(u1, lipR + 2.1, y0 - 2.04);
      const d2 = f.p(u0, lipR + 2.1, y0 - 2.04);
      const cc = lin(shade(W_CREST, 1.0));
      sf.quad(a, bb, c, d, cc, cc, cc, cc);
      sf.quad(b2, a2, d2, c2, cc, cc, cc, cc);
    }
  }
  // 底部水花：两圈同心泡沫摊（水平铺开、外径平滑，不做锯齿边）
  for (let ring = 0; ring < 2; ring++) {
    const n = 30;
    const w0 = ring === 0 ? 15 : 24;
    const w1 = ring === 0 ? 24 : 34;
    const y0 = bottomY + (ring === 0 ? 6.4 : 3.2);
    const y1 = bottomY + (ring === 0 ? 3.2 : 0.1);
    const spanU = W * (ring === 0 ? 1.16 : 1.34);
    for (let k = 0; k < n; k++) {
      const u0 = (k / n - 0.5) * spanU;
      const u1 = ((k + 1) / n - 0.5) * spanU;
      const a = f.p(u0, w0, y0);
      const bb = f.p(u1, w0, y0);
      const c = f.p(u1, w1, y1);
      const d = f.p(u0, w1, y1);
      const a2 = f.p(u0, w0, y0 - 0.07);
      const b2 = f.p(u1, w0, y0 - 0.07);
      const c2 = f.p(u1, w1, y1 - 0.07);
      const d2 = f.p(u0, w1, y1 - 0.07);
      const cc = lin(shade(ring === 0 ? W_CREST : W_HI, 0.96 + jit(k, 7 + ring) * 0.06));
      const cd = lin(shade(W_MID, 0.98 + jit(k, 17 + ring) * 0.05));
      sf.quad(a, bb, c, d, cc, cc, cd, cd);
      sf.quad(b2, a2, d2, c2, cc, cc, cd, cd);
    }
  }
  sf.flush(b, 'water');
  return sf.tris;
}

function buildStaticMist(b: Baker, f: Frame, topY: number, bottomY: number, W: number, n: number): number {
  let count = 0;
  // 落底泡沫带：沿宽度密排三层扁球（外圈大、内圈小），读作「水砸在云上的沫」。
  // 中段不再放雾团——悬空的扁球会被读成石头/飞碟。
  for (let i = 0; i < n; i++) {
    const u = (jit(i, 11) - 0.5) * W * 1.34;
    const layer = i % 3;
    const yy = bottomY + 1.0 + layer * 2.4 + jit(i, 31) * 1.8;
    const w = 17 + layer * 4.2 + jit(i, 41) * 5;
    const r = 2.4 + jit(i, 47) * 2.4 + layer * 0.9;
    const p = f.p(u, w, yy);
    b.sphere('water', r, 7, p[0], p[1], p[2],
      shade(i % 3 === 0 ? MIST_HI : MIST, 0.97 + jit(i, 59) * 0.08), f.ry, 0, 0,
      1.0, 0.5, 1.0);
    count++;
  }
  // 顶部不再放飞沫球：在水帘前会读成一串悬空白泡泡（参考图里的雾都在落底）
  return count;
}

// ============ C2：汉白玉龙首吐水 ============
function buildBastion(b: Baker, f: Frame, topY: number): void {
  // 台基：三级白石墩（外唇齐平 r=722），从云线起
  const tiers: [number, number, number, number][] = [
    [0, 10.5, 20, 196.6],
    [3, 9.0, 16, 207.1],
    [6, topY - 216.1, 12.5, 216.1],
  ];
  for (let i = 0; i < tiers.length; i++) {
    const [inset, h, wu, yb] = tiers[i];
    const depth = 18 - inset;
    const centerW = 16 - depth / 2;
    fbox(b, 'ash', f, 0, centerW, yb + h / 2, wu, h, depth, i === 0 ? JADE_D : i === 1 ? JADE : JADE_HI);
    fbox(b, 'wood', f, 0, 16 - 0.22, yb + h - 0.2, wu + 1.4, 0.24, 0.44, GOLD_D);
    // 侧壁浅浮雕带（横线，远看是分层石作）
    fbox(b, 'ash', f, 0, 16 - 0.4, yb + 1.1, wu - 1.6, 0.5, 0.5, shade(JADE, 0.92));
  }
  // 台顶栏杆 + 出水石槽
  fbox(b, 'ash', f, 0, 16 - 5.0, topY + 0.2, 13.6, 0.4, 9.0, JADE_HI);
  for (const sg of [-1, 1] as const) {
    for (let k = 0; k < 3; k++) {
      fbox(b, 'ash', f, sg * (5.4 + k * 0.0), 12 + k * 2.2, topY + 0.9, 0.7, 0.9, 0.7, JADE_HI);
    }
    fbox(b, 'ash', f, sg * 5.4, 13, topY + 1.35, 0.18, 0.16, 6.0, JADE);
  }
}

/**
 * 龙首：从台基外唇伸出，龙口朝外（w+）。局部坐标 u 切向、v 竖直（相对 mouthY）、w 径向。
 * 全部白石（ash），眼/角尖/颔下金饰走 wood/metal；口内深色一口（读得出「口」）。
 */
function buildDragon(b: Baker, f: Frame, mouthY: number, bottomY: number): number {
  let tris = 0;
  const P = (u: number, v: number, w: number): V3 => f.p(u, 16 + w, mouthY + v);
  const box = (g: BGroup, u: number, v: number, w: number, wu: number, hv: number, dw: number, hex: number): void => {
    const p = P(u, v, w);
    b.box(g, wu, hv, dw, p[0], p[1], p[2], hex, f.ry);
    tris += 12;
  };
  const hexBody = JADE_HI;
  const hexDark = JADE_D;

  // 颈：从台顶升起、逐段外探（整颗头 ≈20m，架在 25m 高的台顶，逆光时是完整剪影）
  box('ash', 0, -4.6, -5.0, 8.0, 5.0, 11.0, hexBody);
  box('ash', 0, -2.0, 1.0, 7.2, 4.6, 8.0, hexBody);
  // 头骨（长 > 宽，避免读成方块）
  box('ash', 0, 1.2, 6.5, 6.0, 5.6, 9.0, hexBody);
  // 上吻（前伸 6m）
  box('ash', 0, 0.7, 12.5, 4.6, 3.0, 6.0, hexBody);
  box('ash', 0, 1.2, 15.6, 4.0, 1.6, 1.6, shade(hexBody, 1.04));
  // 上唇线（压暗一条，把吻和口腔分开）
  box('ash', 0, -0.7, 13.6, 4.4, 0.9, 5.0, shade(hexBody, 0.9));
  // 下颌（张开、垂到台沿外）
  box('ash', 0, -3.4, 12.5, 4.2, 1.8, 6.0, hexDark);
  box('ash', 0, -2.6, 15.2, 3.6, 1.4, 2.0, hexDark);
  // 口腔（深色，读得出「口」）。是洞不是窗：旧色 0x2a1410 落在窗洞暗色 0x2a1a10 的探针容差内，
  // 会被当成 14.5m 的「窗」；改用项目门色 0x241a18（线性红 0.0168，低于窗色的 0.80 下限）。
  box('wood', 0, -1.7, 12.2, 3.9, 2.2, 5.4, 0x241a18);
  // 眼
  for (const sg of [-1, 1] as const) {
    box('metal', sg * 2.7, 2.6, 9.6, 1.3, 1.1, 1.1, GOLD_HI);
    // 眉骨
    box('ash', sg * 2.8, 3.7, 9.2, 1.7, 1.0, 3.4, hexBody);
  }
  // 角：三段后掠（这一条是「龙」的主要剪影线索，必须长）
  for (const sg of [-1, 1] as const) {
    box('ash', sg * 2.0, 4.6, 5.6, 1.3, 3.4, 1.4, shade(hexBody, 0.97));
    box('ash', sg * 2.0, 6.4, 3.0, 1.1, 2.8, 1.2, GOLD_D);
    box('ash', sg * 2.0, 7.8, 1.0, 0.9, 2.2, 1.0, GOLD_HI);
    // 须
    box('ash', sg * 2.6, -1.0, 15.5, 0.5, 0.5, 7.0, hexDark);
    // 耳
    box('ash', sg * 3.2, 2.2, 5.4, 0.9, 2.4, 2.0, hexDark);
  }
  // 鬃（背脊 6 片，沿颈向后铺）
  for (let k = 0; k < 6; k++) {
    box('ash', 0, 4.6 + k * 0.05, 4.6 - k * 1.9, 1.4, 2.9 - k * 0.25, 1.2, shade(hexBody, 0.9));
  }
  // 齿
  for (const sg of [-1, 1] as const) {
    box('ash', sg * 1.5, -2.0, 15.0, 0.55, 1.2, 0.55, 0xf0ece0);
    box('ash', sg * 1.5, -0.2, 15.2, 0.55, 1.1, 0.55, 0xf0ece0);
  }
  // 颔下金饰
  box('wood', 0, -4.0, 11.5, 3.2, 0.7, 3.4, GOLD_D);

  // 吐水：从龙口（台顶外沿）起，先外抛再竖落
  const sf = new Surf(false);
  const NU = 12, NV = 16;
  const topY = P(0, -3.4, 15.2)[1];
  const drop = Math.max(8, topY - bottomY);
  for (let iv = 0; iv < NV; iv++) {
    const v0 = iv / NV, v1 = (iv + 1) / NV;
    const y0 = topY - drop * Math.pow(v0, 1.1);
    const y1 = topY - drop * Math.pow(v1, 1.1);
    const w0 = 15.0 + 2.2 * (1 - Math.pow(1 - v0, 2)) + 0.4;
    const w1 = 15.0 + 2.2 * (1 - Math.pow(1 - v1, 2)) + 0.4;
    const hw0 = 2.4 + 1.2 * v0;
    const hw1 = 2.4 + 1.2 * v1;
    for (let iu = 0; iu < NU; iu++) {
      const u0 = iu / NU - 0.5, u1 = (iu + 1) / NU - 0.5;
      const a = f.p(u0 * 2 * hw0, 16 + w0, y0);
      const bb = f.p(u1 * 2 * hw0, 16 + w0, y0);
      const c = f.p(u1 * 2 * hw1, 16 + w1, y1);
      const d = f.p(u0 * 2 * hw1, 16 + w1, y1);
      const k = 0.9 + jit(iu + iv * 7, 5) * 0.16;
      const col = lin(shade(v0 < 0.12 ? W_CREST : (iu & 1 ? W_HI : W_MID), k));
      sf.quad(a, bb, c, d, col, col, col, col);
      // 背面（水组单面；龙首口水柱从两侧都要看得见），让 4cm 防共面
      const a2 = f.p(u0 * 2 * hw0, 16 + w0 - 0.04, y0);
      const b2 = f.p(u1 * 2 * hw0, 16 + w0 - 0.04, y0);
      const c2 = f.p(u1 * 2 * hw1, 16 + w1 - 0.04, y1);
      const d2 = f.p(u0 * 2 * hw1, 16 + w1 - 0.04, y1);
      sf.quad(b2, a2, d2, c2, col, col, col, col);
    }
  }
  sf.flush(b, 'water');
  tris += sf.tris;
  return tris;
}

// ============ 主入口 ============
export function buildHeavenWater(b: Baker, opts: HeavenWaterOpts = {}): HeavenWaterStats {
  const cx = opts.cx ?? 0;
  const cz = opts.cz ?? 0;
  const W = clamp(opts.fallW ?? HEAVEN_WATER.fallW, 40, 80);
  const deckY = opts.deckY ?? HEAVEN_WATER.deckY;
  const bottomY = opts.bottomY ?? HEAVEN_WATER.bottomY;
  const fallAngles = opts.fallAngles ?? HEAVEN_WATER.fallAngles;
  const bastionAngles = opts.bastionAngles ?? HEAVEN_WATER.bastionAngles;
  const withCliff = opts.withCliff !== false;
  const withMist = opts.withMist !== false;

  const triBefore = totalTris(b);
  let mistPuffs = 0;

  for (const deg of fallAngles) {
    const f = frameAt(cx, cz, deg);
    if (withCliff) buildCliff(b, f, deckY, W);
    buildCurtain(b, f, deckY + 0.6, bottomY, W);
    if (withMist) mistPuffs += buildStaticMist(b, f, deckY, bottomY, W, 26);
  }

  for (const deg of bastionAngles) {
    const f = frameAt(cx, cz, deg);
    if (withCliff) buildBastion(b, f, HEAVEN_WATER.bastionTopY);
    buildDragon(b, f, HEAVEN_WATER.dragonMouthY, HEAVEN_WATER.dragonBottomY);
    if (withMist) mistPuffs += buildStaticMist(b, f, HEAVEN_WATER.dragonMouthY, HEAVEN_WATER.dragonBottomY, 8, 9);
  }

  b.kit('heavenWater.fall', fallAngles.length, deckY);
  b.kit('heavenWater.dragon', bastionAngles.length, HEAVEN_WATER.dragonMouthY);
  b.kit('heavenWater.mist', mistPuffs, bottomY);

  heavenWaterStats.falls = fallAngles.length;
  heavenWaterStats.bastions = bastionAngles.length;
  heavenWaterStats.dragons = bastionAngles.length;
  heavenWaterStats.fallWidth = W;
  heavenWaterStats.fallDrop = deckY + 0.6 - bottomY;
  heavenWaterStats.fallRimR = HEAVEN_WATER.rimR;
  heavenWaterStats.lipY = deckY + 0.6;
  heavenWaterStats.bottomY = bottomY;
  heavenWaterStats.mistPuffs = mistPuffs;
  heavenWaterStats.tris = totalTris(b) - triBefore;
  return heavenWaterStats;
}

/** Baker 累计三角面（含已 flush 的批次） */
function totalTris(b: Baker): number {
  const s = b.stats();
  let n = 0;
  for (const g of Object.values(s.groups)) n += g.triangles;
  return n;
}

// ============ 动态层：竖向流痕 + 漂移水雾 ============
const FLOW_T: { mat: THREE.ShaderMaterial }[] = [];
const MIST_T: { mat: THREE.ShaderMaterial }[] = [];
let flowGroup: THREE.Group | null = null;

const FLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOW_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float u = vUv.x;
    float v = vUv.y;
    float s1 = sin(u * 52.0 + v * 3.0 + uTime * 3.2);
    float s2 = sin(u * 23.0 - v * 5.0 - uTime * 2.1 + 1.3);
    float s3 = sin(u * 111.0 + v * 11.0 + uTime * 4.7 + 2.7);
    float streak = 0.5 + 0.30 * s1 + 0.14 * s2 + 0.08 * s3;
    float edge = smoothstep(0.0, 0.07, u) * smoothstep(1.0, 0.93, u);
    float top = smoothstep(0.0, 0.04, v);
    float bot = smoothstep(0.0, 0.12, 1.0 - v);
    float a = uOpacity * edge * top * bot * (0.5 + 0.5 * streak);
    vec3 c = mix(uColB, uColA, clamp(streak * 1.4, 0.0, 1.0));
    gl_FragColor = vec4(c, a);
  }
`;

const MIST_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  varying float vA;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.33 + aSeed * 6.283) * 3.2;
    p.z += cos(uTime * 0.27 + aSeed * 6.283) * 3.2;
    p.y += sin(uTime * 0.19 + aSeed * 3.1) * 2.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
    vA = 0.55 + 0.45 * sin(uTime * 0.45 + aSeed * 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.08, d) * uOpacity * vA;
    gl_FragColor = vec4(0.86, 0.93, 0.97, a);
  }
`;

/** 弧形水片（竖直圆柱面片断；baseR = 水片相对 rimR 的基础半径偏移） */
function curtainGeo(f: Frame, topY: number, bottomY: number, W: number, baseR: number, radiusOff: number, widthScale: number): THREE.BufferGeometry {
  const NU = 12, NV = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let iv = 0; iv <= NV; iv++) {
    const v = iv / NV;
    const y = topY - (topY - bottomY) * Math.pow(v, 1.08);
    const r = baseR + 2.2 * (1 - Math.pow(1 - v, 2.4)) + radiusOff;
    const hw = (W * 0.5) * widthScale * (1 + 0.12 * v);
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      const p = f.p((u - 0.5) * 2 * hw, r, y);
      pos.push(p[0], p[1], p[2]);
      uv.push(u, v);
    }
  }
  for (let iv = 0; iv < NV; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const a = iv * (NU + 1) + iu;
      const b = a + 1;
      const c = a + NU + 1;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * 动态叠加层（宿主接线：scene.add(group) + 每帧 updateHeavenWaterFlow(t)）。
 * 几何按**缩放前**坐标建；group 自带 2.2× / 绕 y=196 的缩放，与 scaleHeavenGeometry 等价，
 * 故宿主只需 add，不要再手动缩放。
 */
export function createHeavenWaterFlow(opts: HeavenWaterOpts & { scale?: number; baseY?: number } = {}): THREE.Group {
  const cx = opts.cx ?? 0;
  const cz = opts.cz ?? 0;
  const W = clamp(opts.fallW ?? HEAVEN_WATER.fallW, 40, 80);
  const deckY = opts.deckY ?? HEAVEN_WATER.deckY;
  const bottomY = opts.bottomY ?? HEAVEN_WATER.bottomY;
  const fallAngles = opts.fallAngles ?? HEAVEN_WATER.fallAngles;
  const bastionAngles = opts.bastionAngles ?? HEAVEN_WATER.bastionAngles;
  const scale = opts.scale ?? 2.2;
  // 动态层的 group 用「绕 baseY 缩放」复刻 scaleHeavenGeometry；抬升后基准面是 2131，不是 196。
  const baseY = opts.baseY ?? HEAVEN_BASE_LIFTED;

  if (flowGroup) return flowGroup;
  const group = new THREE.Group();
  group.name = 'heavenWaterFlow';
  group.scale.setScalar(scale);
  group.position.y = baseY * (1 - scale);
  FLOW_T.length = 0;
  MIST_T.length = 0;

  const flowMats: THREE.ShaderMaterial[] = [];
  for (const deg of fallAngles) {
    const f = frameAt(cx, cz, deg);
    for (const [ro, ws, op] of [[0.05, 0.98, 0.5], [1.0, 0.8, 0.36], [2.0, 0.55, 0.26]] as const) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColA: { value: new THREE.Color(0xffffff) },
          uColB: { value: new THREE.Color(0x9fd7e8) },
          uOpacity: { value: op },
        },
        vertexShader: FLOW_VERT,
        fragmentShader: FLOW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(curtainGeo(f, deckY + 0.6, bottomY, W, 22.4, ro, ws), mat);
      mesh.name = 'heavenWaterFlow.curtain';
      mesh.frustumCulled = false;
      group.add(mesh);
      flowMats.push(mat);
    }
    // 水雾：每道水帘 56 个漂移点
    const n = 56;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = (jit(i, 71) - 0.5) * W * 1.05;
      const v = jit(i, 73);
      const y = bottomY + (deckY - bottomY) * (v < 0.62 ? 0.02 + jit(i, 79) * 0.10 : 0.18 + jit(i, 79) * 0.36);
      const p = f.p(u, 20 + jit(i, 83) * 6, y);
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = p[2];
      seed[i] = jit(i, 89);
      size[i] = 6 + jit(i, 97) * 12;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.5 } },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.name = 'heavenWaterFlow.mist';
    pts.frustumCulled = false;
    group.add(pts);
    MIST_T.push({ mat });
  }
  for (const deg of bastionAngles) {
    const f = frameAt(cx, cz, deg);
    for (const [ro, ws, op] of [[0.6, 1.0, 0.45], [1.4, 0.7, 0.3]] as const) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColA: { value: new THREE.Color(0xffffff) },
          uColB: { value: new THREE.Color(0x9fd7e8) },
          uOpacity: { value: op },
        },
        vertexShader: FLOW_VERT,
        fragmentShader: FLOW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        toneMapped: false,
      });
      const geo = curtainGeo(f, HEAVEN_WATER.dragonMouthY - 3.4, HEAVEN_WATER.dragonBottomY, 7.6, 31.0, ro, ws);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'heavenWaterFlow.jet';
      mesh.frustumCulled = false;
      group.add(mesh);
      flowMats.push(mat);
    }
  }

  flowGroup = group;
  FLOW_T.length = 0;
  for (const mat of flowMats) FLOW_T.push({ mat });
  return group;
}

/** 每帧调用（t 秒）。动态层未创建时是空操作。 */
export function updateHeavenWaterFlow(t: number): void {
  for (const it of FLOW_T) it.mat.uniforms.uTime.value = t;
  for (const it of MIST_T) it.mat.uniforms.uTime.value = t;
}

/** 探针/宿主释放用 */
export function disposeHeavenWaterFlow(): void {
  if (!flowGroup) return;
  flowGroup.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.Points).isPoints) {
      (m.geometry as THREE.BufferGeometry | undefined)?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    }
  });
  flowGroup = null;
  FLOW_T.length = 0;
  MIST_T.length = 0;
}
