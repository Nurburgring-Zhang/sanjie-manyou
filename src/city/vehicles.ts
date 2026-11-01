import * as THREE from 'three';
import { GLOW_MAT } from '../actors/pools';
import { noReflect } from '../core/layers';

/**
 * ============ W5 · 交通工具与动物几何工厂 ============
 * 全部按米制建模，原点语义：
 *   船 —— y=0 为设计水线（首 +x），水线以下上沥青色、以上桐油木色；
 *   车 —— y=0 为地面（辕 +x）；
 *   轿 —— y=0 为轿杠中心（行进方向 +z，与轿夫肩同高）；
 *   兽 —— y=0 为蹄底（头朝 +z）。
 * 顶点色承载材质组语义：船体/车体 wood（桐油深褐）、帆篷帘 fabric、铁件 metal、灯 glow。
 * 三种材质共用几何：hard（木/铁/陶/漆）· cloth（布）· glow（自发光）。
 * 每件 ≤3000 三角面；detail=0 的远景版走同一函数的简化分支（不另写一套）。
 */

export const VEH_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06 });
export const VEH_CLOTH = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide });

// ---- 调色板（sRGB，与 bake.ts 的 C 调色同族）----
const W_TAR = 0x2a2018;     // 水线下沥青
const W_HULL = 0x4e3620;    // 船体桐油深褐
const W_HULL_L = 0x60421f;  // 列板交替亮档
const W_DECK = 0x6f5230;    // 甲板
const W_DECK_L = 0x7d5d36;
const W_FRAME = 0x3c2a1a;   // 梁枋/舱壁
const W_CABIN = 0x5a3d22;
const W_POLE = 0x6b4a2b;
const IRON = 0x33343a;
const IRON_L = 0x585a62;
const CLOTH_SAIL = 0xd6c9a6;
const CLOTH_MAT = 0x9a855c; // 芦席
const CLOTH_DARK = 0x6e5c3c;
const SILK_RED = 0x9d2933;
const SILK_DARK = 0x6d1e26;
const LACQ = 0x6a1f18;
const CEIL = 0x8a7a5a;
const NEON = 0x3fe4d6;
const GOLD = 0xb08a34;
const STONE = 0x7a7468;

function sh(hex: number, k: number): number {
  const c = new THREE.Color().setHex(hex);
  c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  return c.getHex();
}

// ============ 实例池（自建，不进 PoolSet：pools.ts 不可写） ============
export class InstSet {
  readonly mesh: THREE.InstancedMesh;
  private dirty = false;
  private cursor = 0;
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly max: number, name: string, shadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = name;
    // 车/轿/牲口这些陆上件在 512² 的反射贴图（0.23m/px）里连轮子都占不满一个像素，
    // 却各自占一次 draw call。船是唯一该留在水里的：它本来就在水面，倒影是主视觉。
    if (!name.startsWith('veh_boat')) noReflect(this.mesh);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = false;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, white); }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  alloc(n = 1): number {
    const base = this.cursor;
    this.cursor += n;
    if (this.cursor > this.max) throw new Error(`实例池 ${this.mesh.name} 槽位不足：need ${this.cursor} > ${this.max}`);
    if (base + n > this.mesh.count) {
      for (let i = this.mesh.count; i < base + n; i++) this.mesh.setMatrixAt(i, this.zero);
      this.mesh.count = base + n;
      this.dirty = true;
    }
    return base;
  }
  set(i: number, m: THREE.Matrix4, tint?: THREE.Color): void {
    this.mesh.setMatrixAt(i, m);
    if (tint && this.mesh.instanceColor) this.mesh.setColorAt(i, tint);
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
    this.dirty = true;
  }
  flush(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }
}

// ============ 顶点色几何缓冲 ============
type P3 = readonly [number, number, number];
const _col = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

class GeoBuf {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  private xfCache: P3[] = [];

  get tris(): number { return this.p.length / 9; }

  private xf(pts: readonly P3[], x: number, y: number, z: number, ry: number, rx: number, rz: number): P3[] {
    if (ry === 0 && rx === 0 && rz === 0 && x === 0 && y === 0 && z === 0) return pts.slice();
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z);
    _m4.compose(_v, _q, _one);
    const out: P3[] = this.xfCache;
    out.length = 0;
    for (const q of pts) {
      _v.set(q[0], q[1], q[2]).applyMatrix4(_m4);
      out.push([_v.x, _v.y, _v.z]);
    }
    return out.slice();
  }

  tri(a: P3, b: P3, c: P3, hex: number, ao = 1): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    _col.setHex(hex);
    const r = _col.r * ao, g = _col.g * ao, bl = _col.b * ao;
    for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(r, g, bl); }
  }

  quad(a: P3, b: P3, c: P3, d: P3, hex: number, ao = 1): void { this.tri(a, b, c, hex, ao); this.tri(a, c, d, hex, ao); }

  /** 轴对齐（可旋转）长方体：六面独立法线 */
  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, ao = 1): void {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const c: P3[] = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
      [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
    ];
    const v = this.xf(c, x, y, z, ry, rx, rz);
    this.quad(v[4], v[5], v[6], v[7], hex, ao);
    this.quad(v[1], v[0], v[3], v[2], sh(hex, 0.9), ao);
    this.quad(v[5], v[1], v[2], v[6], sh(hex, 1.02), ao);
    this.quad(v[0], v[4], v[7], v[3], sh(hex, 1.02), ao);
    this.quad(v[3], v[7], v[6], v[2], sh(hex, 1.1), ao);
    this.quad(v[0], v[1], v[5], v[4], sh(hex, 0.78), ao);
  }

  /** 圆柱/圆台：轴 +y，中心在 (x,y,z) */
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, caps = true, ao = 1): void {
    const hh = h / 2;
    const ring = (r: number, yy: number, f: number): P3[] => {
      const out: P3[] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2 + f;
        out.push([Math.cos(a) * r, yy, Math.sin(a) * r]);
      }
      return out;
    };
    const bt = this.xf(ring(rb, -hh, 0), x, y, z, ry, rx, rz);
    const tp = this.xf(ring(rt, hh, 0), x, y, z, ry, rx, rz);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.quad(bt[i], bt[j], tp[j], tp[i], i % 2 ? hex : sh(hex, 0.94), ao);
    }
    if (caps) {
      const cb = this.xf([[0, -hh, 0]], x, y, z, ry, rx, rz)[0];
      const ct = this.xf([[0, hh, 0]], x, y, z, ry, rx, rz)[0];
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.tri(cb, bt[j], bt[i], sh(hex, 0.8), ao);
        this.tri(ct, tp[i], tp[j], sh(hex, 1.06), ao);
      }
    }
  }

  /** 四棱台（上下截面不同的方柱）：动物躯干、船柱收分 */
  frus(w0: number, d0: number, w1: number, d1: number, h: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, ao = 1): void {
    const hh = h / 2;
    const b: P3[] = [[-w0 / 2, -hh, -d0 / 2], [w0 / 2, -hh, -d0 / 2], [w0 / 2, -hh, d0 / 2], [-w0 / 2, -hh, d0 / 2]];
    const t: P3[] = [[-w1 / 2, hh, -d1 / 2], [w1 / 2, hh, -d1 / 2], [w1 / 2, hh, d1 / 2], [-w1 / 2, hh, d1 / 2]];
    const bv = this.xf(b, x, y, z, ry, rx, rz);
    const tv = this.xf(t, x, y, z, ry, rx, rz);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(bv[i], bv[j], tv[j], tv[i], i % 2 ? hex : sh(hex, 0.95), ao);
    }
    this.quad(tv[0], tv[1], tv[2], tv[3], sh(hex, 1.1), ao);
    this.quad(bv[3], bv[2], bv[1], bv[0], sh(hex, 0.8), ao);
  }

  /** 两点之间的方梁（用于斜撑、辕、桅、栏杆、绳索）：显式正交基，不依赖欧拉序 */
  strut(a: P3, b: P3, w: number, hex: number, ao = 1): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const rx = Math.abs(uy) > 0.92 ? 1 : 0, ry = Math.abs(uy) > 0.92 ? 0 : 1;
    let sx = ry * uz - 0 * uy, sy = 0 * ux - rx * uz, sz = rx * uy - ry * ux;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = uy * sz - uz * sy, ty = uz * sx - ux * sz, tz = ux * sy - uy * sx;
    const h = w / 2;
    const ring = (c: P3): P3[] => [
      [c[0] + (sx + tx) * h, c[1] + (sy + ty) * h, c[2] + (sz + tz) * h],
      [c[0] + (-sx + tx) * h, c[1] + (-sy + ty) * h, c[2] + (-sz + tz) * h],
      [c[0] + (-sx - tx) * h, c[1] + (-sy - ty) * h, c[2] + (-sz - tz) * h],
      [c[0] + (sx - tx) * h, c[1] + (sy - ty) * h, c[2] + (sz - tz) * h],
    ];
    const A = ring(a), B = ring(b);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(A[i], A[j], B[j], B[i], i % 2 ? hex : sh(hex, 0.94), ao);
    }
    this.quad(A[0], A[3], A[2], A[1], sh(hex, 0.85), ao);
    this.quad(B[0], B[1], B[2], B[3], sh(hex, 1.08), ao);
  }

  /** 平板（四角给定，双面各自一份：帆、帘、板） */
  plate(a: P3, b: P3, c: P3, d: P3, hex: number, thick = 0, ao = 1): void {
    this.quad(a, b, c, d, hex, ao);
    if (thick > 0) {
      const n = new THREE.Vector3(
        (b[0] - a[0]), (b[1] - a[1]), (b[2] - a[2]),
      ).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize().multiplyScalar(thick);
      const o = (q: P3): P3 => [q[0] + n.x, q[1] + n.y, q[2] + n.z];
      this.quad(o(d), o(c), o(b), o(a), sh(hex, 0.9), ao);
    }
  }

  toGeo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ============ 船体放样 ============
interface HullSt { x: number; keel: number; sheer: number; beam: number; flat: number }

/** 站面型值：t=0 龙骨 → t=1 舷顶；z 向展宽与 y 向吃深分别插值（6 道列板） */
const PROF_T = [0, 0.16, 0.34, 0.52, 0.7, 0.85, 1] as const;
const PROF_Z = [0, 0.3, 0.55, 0.74, 0.88, 0.96, 1] as const;
const NB = PROF_T.length - 1;

function profAt(s: HullSt, ti: number): [number, number] {
  const t = PROF_T[ti];
  const z = s.flat + (s.beam - s.flat) * PROF_Z[ti];
  return [z, s.keel + (s.sheer - s.keel) * t];
}

/** 列板分色：水线下沥青 → 舷侧四道列板明暗交替 → 舷顶压条提亮 */
function strakeHex(y: number, keel: number, sheer: number, band: number): number {
  const t = (y - keel) / Math.max(0.01, sheer - keel);
  if (t < 0.1) return W_TAR;
  if (t < 0.26) return sh(W_HULL, 0.86);
  return band % 2 === 0 ? W_HULL : W_HULL_L;
}

/**
 * 放样船体：左右各四道列板 + 平底 + 首尾横板 + 舷墙内衬。
 * @param deck 甲板高（舷墙内衬只做到甲板以上，甲板以下用实心甲板面盖住）
 */
function hull(buf: GeoBuf, st: readonly HullSt[], deckY: number, inner = true, keel = true): void {
  const n = st.length;
  // 舷侧
  for (let i = 0; i < n - 1; i++) {
    const s0 = st[i], s1 = st[i + 1];
    for (let b = 0; b < NB; b++) {
      const [z0, y0] = profAt(s0, b);
      const [z1, y1] = profAt(s0, b + 1);
      const [z2, y2] = profAt(s1, b + 1);
      const [z3, y3] = profAt(s1, b);
      const hex = strakeHex((y0 + y1) / 2, s0.keel, s0.sheer, b);
      // 右舷（+z）：外法线 +z
      buf.quad([s0.x, y0, z0], [s1.x, y3, z3], [s1.x, y2, z2], [s0.x, y1, z1], hex, 0.94 + b * 0.02);
      // 左舷（-z）
      buf.quad([s0.x, y1, -z1], [s1.x, y2, -z2], [s1.x, y3, -z3], [s0.x, y0, -z0], hex, 0.94 + b * 0.02);
      // 舷墙内衬（甲板以上那一道，反向）：从甲板面做到舷顶，避免近景看穿
      if (inner && b === NB - 1) {
        const bb0 = Math.max(y0, deckY), bb1 = Math.max(y3, deckY);
        if (y1 > bb0 + 0.04 && y2 > bb1 + 0.04) {
          const zb0 = z0 + (z1 - z0) * ((bb0 - y0) / Math.max(0.01, y1 - y0));
          const zb1 = z3 + (z2 - z3) * ((bb1 - y3) / Math.max(0.01, y2 - y3));
          buf.quad([s0.x, bb0, zb0 - 0.02], [s0.x, y1, z1 - 0.02], [s1.x, y2, z2 - 0.02], [s1.x, bb1, zb1 - 0.02], sh(W_HULL, 0.74), 0.88);
          buf.quad([s0.x, bb0, -zb0 + 0.02], [s1.x, bb1, -zb1 + 0.02], [s1.x, y2, -z2 + 0.02], [s0.x, y1, -z1 + 0.02], sh(W_HULL, 0.74), 0.88);
        }
      }
    }
    // 平底
    buf.quad(
      [s0.x, s0.keel, -s0.flat], [s1.x, s1.keel, -s1.flat], [s1.x, s1.keel, s1.flat], [s0.x, s0.keel, s0.flat], W_TAR, 0.7);
  }
  // 龙骨（方木，随首尾起翘分道贴底）
  if (keel) {
    for (let i = 0; i < n - 1; i++) {
      const a = st[i], b = st[i + 1];
      buf.strut([a.x, a.keel - 0.03, 0], [b.x, b.keel - 0.03, 0], 0.22, W_TAR, 0.8);
    }
  }
  // 首尾横板（方头）：由型值点围成的多边形做扇形
  for (const end of [0, n - 1]) {
    const s = st[end];
    const pts: P3[] = [];
    for (let b = 0; b <= NB; b++) { const [z, y] = profAt(s, b); pts.push([s.x, y, z]); }
    for (let b = NB; b >= 0; b--) { const [z, y] = profAt(s, b); pts.push([s.x, y, -z]); }
    const cy = (s.keel + s.sheer) / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      // 首板法线 +x、艉板法线 −x：绕序按站面多边形方向反过来
      if (end === n - 1) buf.tri([s.x, cy, 0], c, a, sh(W_HULL, 1.05), 0.95);
      else buf.tri([s.x, cy, 0], a, c, sh(W_HULL, 0.9), 0.95);
    }
  }
}

/** 甲板铺板：横向板条（随船体收分逐道缩短，端点不会穿出舷侧），明暗交替 */
function deckPlanks(buf: GeoBuf, st: readonly HullSt[], x0: number, x1: number, y: number, n: number, hex = W_DECK): void {
  const beamAt = (x: number): number => {
    for (let i = 0; i < st.length - 1; i++) {
      if (x <= st[i + 1].x || i === st.length - 2) {
        const a = st[i], b = st[i + 1];
        const t = Math.max(0, Math.min(1, (x - a.x) / Math.max(0.01, b.x - a.x)));
        return a.beam + (b.beam - a.beam) * t;
      }
    }
    return st[0].beam;
  };
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + step * (i + 0.5);
    const hw = beamAt(x) * 0.985;
    buf.box(step * 0.94, 0.05, hw * 2, x, y, 0, i % 2 ? hex : W_DECK_L, 0, 0, 0, 0.92 + (i % 3) * 0.03);
  }
}

/** 舷顶压条（护舷木）：沿舷弧分 5 段贴合 */
function rubRail(buf: GeoBuf, st: readonly HullSt[], off: number, hex: number): void {
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i], b = st[i + 1];
      const ya = a.sheer - off, yb = b.sheer - off;
      buf.strut([a.x, ya, side * (a.beam + 0.03)], [b.x, yb, side * (b.beam + 0.03)], 0.09, hex, 1.0);
    }
  }
}

// ============ 船型 ============
export interface BoatCrew { x: number; y: number; z: number; occ: string; act: string }
export interface BoatParts {
  hard: THREE.BufferGeometry;
  cloth: THREE.BufferGeometry | null;
  rig: THREE.BufferGeometry | null;
  sail: THREE.BufferGeometry | null;
  /** 桅脚（船体系） */
  pivot: { x: number; y: number; z: number };
  oars: { x: number; y: number; z: number; side: number }[];
  lanterns: { x: number; y: number; z: number }[];
  len: number; beam: number; deck: number;
  crew: BoatCrew[];
}

/** 共享橹：杆从 -0.5（握把）到 +2.4（桨叶端），原点在桨座 */
export function oarGeo(): THREE.BufferGeometry {
  const g = new GeoBuf();
  g.cyl(0.045, 0.055, 2.5, 5, 0.9, 0, 0, W_POLE, 0, 0, Math.PI / 2, false);
  g.box(0.42, 0.07, 0.19, 2.28, 0, 0, sh(W_POLE, 1.05));
  g.box(0.5, 0.02, 0.1, 2.3, 0.02, 0, W_POLE);
  g.cyl(0.07, 0.07, 0.16, 6, 0.12, 0, 0, IRON, 0, 0, Math.PI / 2);
  return g.toGeo();
}

/** 共享灯笼（glow）：小面积，只挂在画舫与客船 */
export function lanternGeo(): THREE.BufferGeometry {
  const g = new GeoBuf();
  g.cyl(0.11, 0.14, 0.3, 8, 0, 0, 0, 0xffc070);
  g.cyl(0.13, 0.11, 0.05, 8, 0, 0.17, 0, 0xffd89a);
  g.cyl(0.11, 0.13, 0.05, 8, 0, -0.17, 0, 0xffd89a);
  return g.toGeo();
}

/** 共享车轮：单位半径，绕 z 轴转（轮心在原点） */
export function wheelGeo(): THREE.BufferGeometry {
  const g = new GeoBuf();
  const R = 1;
  // 轮辋 12 边 + 辐条 + 毂
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    const p0: P3 = [Math.cos(a0) * R, Math.sin(a0) * R, 0];
    const p1: P3 = [Math.cos(a1) * R, Math.sin(a1) * R, 0];
    g.strut(p0, p1, 0.11, sh(W_FRAME, i % 2 ? 0.92 : 1.0));
    // 轮牙（外缘木块）
    const mx = Math.cos((a0 + a1) / 2) * (R + 0.02), my = Math.sin((a0 + a1) / 2) * (R + 0.02);
    g.box(0.16, 0.1, 0.16, mx, my, 0, W_FRAME, 0, 0, (a0 + a1) / 2);
    // 辐条
    g.strut([0, 0, 0], [Math.cos(a0) * (R - 0.06), Math.sin(a0) * (R - 0.06), 0], 0.06, sh(W_DECK, 0.95), 0.9);
  }
  g.cyl(0.15, 0.15, 0.24, 8, 0, 0, 0, IRON, Math.PI / 2, 0, 0);
  g.box(0.5, 0.12, 0.1, 0, 0, 0, IRON);
  return g.toGeo();
}

/** 帆：竹骨硬帆（分格 + 弧形兜风 + 斜桁），y 为帆所在的桅局部坐标 */
function squareSail(sail: GeoBuf, opt: { x: number; yTop: number; yBot: number; halfZ: number; sag: number; rake: number; cols: number; rows: number; hex: number }): void {
  const pt = (i: number, j: number): P3 => {
    const t = j / opt.rows;
    const z = -opt.halfZ + (i / opt.cols) * opt.halfZ * 2;
    const y = opt.yTop + (opt.yBot - opt.yTop) * t + opt.rake * z;
    const belly = Math.cos(((i + 0.5) / opt.cols) * Math.PI - Math.PI / 2) * 0.14;
    return [opt.x + belly + t * opt.sag, y, z];
  };
  for (let j = 0; j < opt.rows; j++) {
    for (let i = 0; i < opt.cols; i++) {
      sail.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), sh(opt.hex, i % 2 ? 0.97 : 1.03), 0.94 - j * 0.02);
    }
  }
  // 竹骨（横撑）+ 竖缝（帆布拼幅）
  for (let j = 0; j <= opt.rows; j++) {
    const y = opt.yTop + (opt.yBot - opt.yTop) * (j / opt.rows);
    const cx = opt.x + j * opt.sag / opt.rows;
    sail.box(0.07, 0.07, opt.halfZ * 2 + 0.17, cx, y, 0, sh(W_POLE, 0.88), 0, 0, opt.rake * 0.9, 0.96);
  }
  for (let i = 1; i < opt.cols; i++) {
    const z = -opt.halfZ + (i / opt.cols) * opt.halfZ * 2;
    sail.strut([opt.x, opt.yTop + opt.rake * z, z], [opt.x + opt.sag, opt.yBot + opt.rake * z, z], 0.03, sh(opt.hex, 0.86));
  }
  // 帆脚索（下拉到舱面）
  sail.strut([opt.x + opt.sag, opt.yBot, opt.halfZ], [opt.x + opt.sag * 0.6, opt.yBot - 1.2, opt.halfZ + 0.25], 0.03, sh(CEIL, 0.9));
  sail.strut([opt.x + opt.sag, opt.yBot, -opt.halfZ], [opt.x + opt.sag * 0.6, opt.yBot - 1.2, -opt.halfZ - 0.25], 0.03, sh(CEIL, 0.9));
}

// ---------- 1 漕船（货运主力，18m） ----------
function grainBoat(detail: number): BoatParts {
  const hard = new GeoBuf(), cloth = new GeoBuf(), rig = new GeoBuf(), sail = new GeoBuf();
  const st: HullSt[] = [
    { x: -9.0, keel: -0.10, sheer: 1.44, beam: 1.02, flat: 0.54 },
    { x: -8.2, keel: -0.30, sheer: 1.34, beam: 1.62, flat: 0.86 },
    { x: -6.6, keel: -0.52, sheer: 1.26, beam: 2.05, flat: 1.16 },
    { x: -4.0, keel: -0.66, sheer: 1.20, beam: 2.28, flat: 1.30 },
    { x: -0.5, keel: -0.68, sheer: 1.18, beam: 2.30, flat: 1.32 },
    { x: 3.0, keel: -0.62, sheer: 1.21, beam: 2.22, flat: 1.26 },
    { x: 6.2, keel: -0.52, sheer: 1.26, beam: 2.00, flat: 1.10 },
    { x: 8.2, keel: -0.34, sheer: 1.36, beam: 1.55, flat: 0.80 },
    { x: 9.0, keel: -0.18, sheer: 1.48, beam: 0.94, flat: 0.48 },
  ];
  const deck = 0.86;
  hull(hard, st, deck);
  deckPlanks(hard, st, -8.6, 8.6, deck, detail ? 14 : 7);
  rubRail(hard, st, 0.16, sh(W_HULL, 0.82));
  rubRail(hard, st, 0.62, sh(W_HULL, 0.72));

  // 舷墙立柱（detail 才有：近景看得出结构）
  if (detail) {
    for (let i = 0; i < 8; i++) {
      const x = -8 + i * 2.3;
      for (const s of [-1, 1]) {
        const b = 1.55 + Math.abs(x) * 0.028;
        hard.box(0.1, 0.42, 0.12, x, deck + 0.2, s * (b + 0.02), sh(W_FRAME, 0.95));
      }
    }
  }

  // 船首方头：前甲板平台 + 挡板 + 锚桩
  hard.box(1.5, 0.12, 1.9, 7.9, deck + 0.16, 0, sh(W_DECK, 0.92));
  hard.box(0.16, 0.55, 1.9, 8.62, deck + 0.4, 0, W_FRAME);
  hard.cyl(0.09, 0.11, 0.7, 6, 8.35, deck + 0.55, 0.62, IRON);
  // 船尾艉楼（高甲板 + 舱棚 + 门洞）
  hard.box(3.0, 0.36, 3.4, -6.9, deck + 0.18, 0, sh(W_DECK, 0.86));
  hard.box(2.5, 1.5, 2.9, -7.1, deck + 1.1, 0, W_CABIN);
  hard.box(2.7, 0.14, 3.1, -7.1, deck + 1.9, 0, sh(W_FRAME, 1.05));
  hard.box(0.09, 1.05, 0.8, -5.87, deck + 0.95, 0.55, sh(W_FRAME, 0.55));   // 门洞
  if (detail) {
    for (const s of [-1, 1]) hard.box(1.5, 0.5, 0.08, -7.1, deck + 1.2, s * 1.47, sh(W_FRAME, 0.7));
    // 艉楼栏杆
    for (let i = 0; i < 4; i++) hard.box(0.07, 0.4, 0.07, -8.4 + i * 0.42, deck + 0.56, 1.66, W_FRAME);
    hard.box(1.3, 0.07, 0.07, -7.75, deck + 0.75, 1.66, W_POLE);
  }

  // 三处货舱口（舱口围板 + 盖板）：敞舱是漕船的标志
  const hatches = [-4.4, -0.4, 3.4];
  for (let h = 0; h < hatches.length; h++) {
    const hx = hatches[h];
    hard.box(2.3, 0.3, 2.9, hx, deck + 0.15, 0, sh(W_FRAME, 0.92));
    hard.box(2.1, 0.08, 2.7, hx, deck + 0.28, 0, sh(W_DECK, 0.8));
    // 盖板（后两舱加盖，首舱敞着露货）
    if (h > 0 || !detail) {
      for (let p = 0; p < 4; p++) hard.box(2.36, 0.06, 0.66, hx, deck + 0.35, -1.02 + p * 0.68, p % 2 ? sh(W_DECK, 1.0) : sh(W_DECK, 0.88));
    } else {
      // 敞舱货堆：麻袋 + 木箱
      for (let s = 0; s < 5; s++) {
        const sx = hx - 0.7 + (s % 3) * 0.7, sz = s < 3 ? 0.55 : -0.6;
        hard.cyl(0.3, 0.34, 0.62, 7, sx, deck + 0.34, sz, sh(CEIL, 0.9), 0, 0, 0.04);
      }
      hard.box(0.8, 0.6, 0.8, hx + 0.6, deck + 0.3, -0.3, sh(W_DECK, 0.8));
    }
    if (detail) {
      for (const s of [-1, 1]) hard.box(0.14, 0.34, 0.14, hx + 0.9, deck + 0.2, s * 1.2, W_FRAME);
    }
  }

  // 舱面货：麻袋捆 + 木箱 + 缆圈（压舱货堆，靠近艉楼）
  for (let i = 0; i < 4; i++) {
    hard.cyl(0.26, 0.3, 0.55, 7, -5.45 + (i % 2) * 0.5, deck + 0.32, -0.6 + (i >> 1) * 0.62, sh(CEIL, 0.86 + (i % 3) * 0.05), 0, 0, 0.06);
  }
  hard.box(0.9, 0.62, 0.9, 4.9, deck + 0.36, 0.55, sh(W_DECK, 0.86));
  hard.box(0.9, 0.05, 0.12, 4.9, deck + 0.68, 0.55, W_FRAME);
  hard.cyl(0.42, 0.42, 0.16, 10, 4.9, deck + 0.12, -0.75, sh(CEIL, 0.8));  // 缆圈

  // 缆桩 ×4
  for (const [bx, bz] of [[-5.6, 1.5], [-5.6, -1.5], [7.2, 1.35], [7.2, -1.35]]) {
    hard.cyl(0.11, 0.13, 0.42, 6, bx, deck + 0.2, bz, IRON);
    hard.cyl(0.17, 0.17, 0.06, 6, bx, deck + 0.42, bz, IRON_L);
  }

  // 舵（艉后挂 + 舵杆 + 铁箍）
  hard.box(0.14, 1.7, 1.05, -9.32, 0.18, 0, sh(W_FRAME, 0.9), 0, 0, -0.06);
  hard.box(0.2, 0.2, 1.25, -9.32, 1.0, 0, IRON);
  hard.box(0.13, 0.13, 1.9, -9.05, 1.25, 0, W_POLE, 0, 0, 0.35);
  hard.cyl(0.2, 0.2, 0.1, 6, -9.3, 0.62, 0, IRON_L);
  hard.cyl(0.2, 0.2, 0.1, 6, -9.3, -0.3, 0, IRON_L);

  // 人字桅：两根前倾支脚 + 横档 + 铁箍（rig 局部：原点在桅脚）
  const legTop: P3 = [-0.55, 6.55, 0];
  rig.strut([0, 0, 0.62], legTop, 0.2, W_POLE, 1.0);
  rig.strut([0, 0, -0.62], legTop, 0.2, W_POLE, 1.0);
  rig.strut([0, 1.7, 0.74], [0, 1.7, -0.74], 0.12, W_POLE);
  rig.strut([0, 3.6, 0.8], [0, 3.6, -0.8], 0.1, W_POLE);
  rig.box(0.16, 0.16, 1.2, -0.5, 6.5, 0, W_POLE);
  for (let i = 0; i < 4; i++) rig.cyl(0.17, 0.17, 0.07, 6, -0.12 * i, 0.9 + i * 1.4, 0.585 - 0.09 * i, IRON);
  // 横桁（挂帆）
  rig.strut([-0.62, 4.4, 2.0], [-0.62, 4.4, -2.0], 0.14, W_POLE, 1.05);
  // 索具（rig 局部，y=0 为甲板面）
  rig.strut([4.6, 0.1, 0.9], [-0.55, 6.5, 0.1], 0.035, sh(CEIL, 0.9));
  rig.strut([4.6, 0.1, -0.9], [-0.55, 6.5, -0.1], 0.035, sh(CEIL, 0.9));
  rig.strut([-9.0, 0.3, 0], [-0.55, 6.4, 0], 0.035, sh(CEIL, 0.85));

  // 帆：竹骨硬帆（可放倒——桅倒即帆倒）
  squareSail(sail, { x: -0.66, yTop: 4.36, yBot: 1.85, halfZ: 1.9, sag: 0.5, rake: 0.16, cols: detail ? 5 : 3, rows: detail ? 3 : 2, hex: CLOTH_SAIL });

  void cloth;
  return {
    hard: hard.toGeo(), cloth: null, rig: rig.toGeo(), sail: sail.toGeo(),
    pivot: { x: 0.4, y: deck, z: 0 },
    oars: [
      { x: -4.9, y: deck + 0.34, z: 2.05, side: 1 },
      { x: -4.9, y: deck + 0.34, z: -2.05, side: -1 },
    ],
    lanterns: [],
    len: 18, beam: 4.6, deck,
    crew: [
      { x: -5.3, y: deck, z: 1.15, occ: 'sailor', act: 'row' },
      { x: -5.3, y: deck, z: -1.15, occ: 'sailor', act: 'row' },
      { x: 6.8, y: deck, z: 0, occ: 'porter', act: 'stand' },
      { x: 7.7, y: deck + 0.22, z: 0, occ: 'official', act: 'stand' },
    ],
  };
}

// ---------- 2 客船（14m） ----------
function passengerBoat(detail: number): BoatParts {
  const hard = new GeoBuf(), cloth = new GeoBuf(), rig = new GeoBuf(), sail = new GeoBuf();
  const st: HullSt[] = [
    { x: -7.0, keel: -0.06, sheer: 1.30, beam: 0.62, flat: 0.34 },
    { x: -6.2, keel: -0.24, sheer: 1.22, beam: 1.18, flat: 0.60 },
    { x: -4.6, keel: -0.42, sheer: 1.14, beam: 1.58, flat: 0.86 },
    { x: -2.0, keel: -0.52, sheer: 1.10, beam: 1.76, flat: 0.96 },
    { x: 1.5, keel: -0.52, sheer: 1.10, beam: 1.76, flat: 0.96 },
    { x: 4.4, keel: -0.46, sheer: 1.16, beam: 1.60, flat: 0.86 },
    { x: 6.2, keel: -0.32, sheer: 1.26, beam: 1.22, flat: 0.62 },
    { x: 7.0, keel: -0.14, sheer: 1.40, beam: 0.62, flat: 0.30 },
  ];
  const deck = 0.74;
  hull(hard, st, deck);
  deckPlanks(hard, st, -6.6, 6.6, deck, detail ? 12 : 6);
  rubRail(hard, st, 0.18, sh(W_HULL, 0.8));

  // 舱棚：拱形（半圆拱 + 两端封板），芦席覆顶
  const cx = -1.2, rz = 1.5, rise = 1.85, len = 6.4;
  const SEG = detail ? 8 : 5;
  for (let i = 0; i < SEG; i++) {
    const a0 = Math.PI * (i / SEG), a1 = Math.PI * ((i + 1) / SEG);
    const y0 = deck + Math.sin(a0) * rise, y1 = deck + Math.sin(a1) * rise;
    const z0 = Math.cos(a0) * rz, z1 = Math.cos(a1) * rz;
    // 拱壳（木骨 + 席面各一层）
    cloth.quad([cx, y0, z0], [cx, y1, z1], [cx + len, y1, z1], [cx + len, y0, z0], i % 2 ? CLOTH_MAT : sh(CLOTH_MAT, 0.9), 0.95);
    // 席下木骨（每跨一道拱肋）
    if (detail) {
      hard.strut([cx, y0, z0], [cx, y1, z1], 0.09, W_FRAME);
      hard.strut([cx, y0, -z0], [cx, y1, -z1], 0.09, W_FRAME);
      hard.strut([cx + len, y0, z0], [cx + len, y1, z1], 0.09, W_FRAME);
      hard.strut([cx + len, y0, -z0], [cx + len, y1, -z1], 0.09, W_FRAME);
    }
  }
  // 两端拱头封板 + 中段木壁
  hard.box(0.12, 1.35, 2.6, cx + 0.06, deck + 0.6, 0, sh(W_FRAME, 0.9));
  hard.box(0.12, 1.2, 2.2, cx + len - 0.06, deck + 0.55, 0, sh(W_FRAME, 0.9));
  // 两侧窗（四扇，深色窗心 + 棂条）
  for (let i = 0; i < 2; i++) {
    for (const s of [-1, 1]) {
      const wx = cx + 1.5 + i * 2.6;
      hard.box(0.95, 0.62, 0.06, wx, deck + 0.78, s * 1.42, sh(W_FRAME, 0.34));
      for (let k = 0; k < 3; k++) hard.box(0.05, 0.6, 0.04, wx - 0.32 + k * 0.32, deck + 0.78, s * 1.46, sh(W_DECK, 0.8));
    }
  }
  // 舱门（船首端）+ 门帘
  hard.box(0.1, 1.1, 0.9, cx + len + 0.04, deck + 0.55, 0, sh(W_FRAME, 0.5));
  cloth.plate([cx + len + 0.1, deck + 1.1, 0.44], [cx + len + 0.1, deck + 1.1, -0.44],
    [cx + len + 0.14, deck + 0.02, -0.5], [cx + len + 0.14, deck + 0.02, 0.5], sh(SILK_RED, 0.9), 0.02);
  // 船尾灶：灶台 + 锅 + 短烟囱
  hard.box(1.0, 0.5, 1.1, -5.6, deck + 0.25, 0, sh(STONE, 0.86));
  hard.cyl(0.3, 0.34, 0.12, 9, -5.6, deck + 0.56, 0, IRON);
  hard.cyl(0.09, 0.11, 0.7, 6, -5.9, deck + 0.85, 0.3, sh(STONE, 0.7));
  // 桅 + 轻帆：客船借风不载重，桅细、帆窄
  rig.strut([0, 0, 0], [-0.34, 5.05, 0], 0.15, W_POLE, 1.0);
  rig.strut([-0.3, 4.85, 1.45], [-0.3, 4.85, -1.45], 0.1, W_POLE, 1.06);
  rig.cyl(0.14, 0.14, 0.08, 6, -0.12, 2.5, 0, IRON);
  rig.cyl(0.13, 0.13, 0.08, 6, -0.22, 3.95, 0, IRON);
  // 前后支索（rig 局部：y=0 即甲板面）
  rig.strut([3.9, 0.06, 0], [-0.3, 4.95, 0], 0.03, sh(CEIL, 0.9));
  rig.strut([-9.1, 0.12, 0], [-0.3, 4.9, 0], 0.035, sh(CEIL, 0.9));
  squareSail(sail, { x: -0.42, yTop: 4.22, yBot: 2.05, halfZ: 1.55, sag: 0.42, rake: 0.15, cols: detail ? 4 : 3, rows: 2, hex: sh(CLOTH_SAIL, 1.02) });
  // 灯笼挂点（前后各一）
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(), rig: rig.toGeo(), sail: sail.toGeo(),
    pivot: { x: 2.6, y: deck, z: 0 },
    oars: [{ x: -4.4, y: deck + 0.30, z: 1.45, side: 1 }],
    lanterns: [{ x: -4.6, y: deck + 1.5, z: 0.8 }, { x: 3.9, y: deck + 1.4, z: -0.8 }],
    len: 14, beam: 3.6, deck,
    crew: [
      { x: -4.8, y: deck, z: 0.95, occ: 'sailor', act: 'row' },
      { x: -3.0, y: deck, z: 0.55, occ: 'scholar', act: 'sitTea' },
      { x: -3.1, y: deck, z: -0.5, occ: 'lady', act: 'sitTea' },
    ],
  };
}

// ---------- 3 渔船（7m） ----------
function fisherBoat(detail: number): BoatParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const st: HullSt[] = [
    { x: -3.5, keel: 0.02, sheer: 0.64, beam: 0.24, flat: 0.12 },
    { x: -2.9, keel: -0.14, sheer: 0.56, beam: 0.62, flat: 0.30 },
    { x: -1.6, keel: -0.26, sheer: 0.48, beam: 0.86, flat: 0.44 },
    { x: 0.4, keel: -0.30, sheer: 0.46, beam: 0.90, flat: 0.46 },
    { x: 2.2, keel: -0.26, sheer: 0.54, beam: 0.74, flat: 0.36 },
    { x: 3.2, keel: -0.14, sheer: 0.68, beam: 0.40, flat: 0.18 },
    { x: 3.5, keel: 0.02, sheer: 0.80, beam: 0.12, flat: 0.06 },
  ];
  const deck = 0.26;
  hull(hard, st, deck);
  deckPlanks(hard, st, -3.1, 3.1, deck, detail ? 8 : 4);
  rubRail(hard, st, 0.12, sh(W_HULL, 0.78));

  // 小篷：竹骨拱篷（三段）
  for (let i = 0; i < 3; i++) {
    const x0 = -1.9 + i * 0.7, x1 = x0 + 0.7;
    const z0 = -0.62, z1 = 0.62, y = deck + 0.72;
    cloth.plate([x0, y, z0], [x0, y + 0.12, 0], [x1, y + 0.12, 0], [x1, y, z0], i % 2 ? sh(CLOTH_MAT, 0.85) : CLOTH_MAT, 0.03);
    cloth.plate([x0, y, z1], [x0, y + 0.12, 0], [x1, y + 0.12, 0], [x1, y, z1], i % 2 ? sh(CLOTH_MAT, 0.85) : CLOTH_MAT, 0.03);
    hard.strut([x0, deck, z0], [x0, y, z0], 0.06, W_FRAME);
    hard.strut([x0, deck, z1], [x0, y, z1], 0.06, W_FRAME);
  }
  // 渔网架：两根立柱 + 横杆 + 斜撑 + 挂网
  const rackX = 2.1;
  for (const s of [-1, 1]) {
    hard.cyl(0.05, 0.06, 1.2, 5, rackX, deck + 0.6, s * 0.56, W_POLE);
    hard.strut([rackX, deck + 1.15, s * 0.56], [rackX - 0.5, deck + 0.05, s * 0.7], 0.05, W_POLE);
  }
  hard.cyl(0.045, 0.045, 1.24, 5, rackX, deck + 1.16, 0, W_POLE, Math.PI / 2, 0, 0);
  if (detail) {
    // 挂网（布片，带垂坠）
    for (let i = 0; i < 4; i++) {
      const z0 = -0.52 + i * 0.26;
      cloth.plate([rackX + 0.02, deck + 1.1, z0], [rackX + 0.02, deck + 1.1, z0 + 0.24],
        [rackX + 0.1, deck + 0.32, z0 + 0.24], [rackX + 0.1, deck + 0.32, z0], sh(CLOTH_DARK, 0.9), 0.01);
    }
  }
  // 竹篓 ×2 + 桨托
  hard.cyl(0.24, 0.19, 0.34, 7, -2.6, deck + 0.2, 0.34, sh(CEIL, 0.82));
  hard.cyl(0.2, 0.16, 0.3, 7, -2.8, deck + 0.18, -0.4, sh(CEIL, 0.72));
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(), rig: null, sail: null,
    pivot: { x: 0, y: deck, z: 0 },
    oars: [{ x: -3.0, y: deck + 0.22, z: 0.62, side: 1 }],
    lanterns: [],
    len: 7, beam: 1.8, deck,
    crew: [
      { x: -2.9, y: deck, z: 0.5, occ: 'fisher', act: 'row' },
      { x: 1.5, y: deck, z: -0.4, occ: 'sailor', act: 'pullRope' },
    ],
  };
}

// ---------- 4 渡船（平底宽体，10m） ----------
function ferryBoat(detail: number): BoatParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const st: HullSt[] = [
    { x: -5.0, keel: -0.02, sheer: 0.72, beam: 1.30, flat: 1.10 },
    { x: -4.2, keel: -0.14, sheer: 0.70, beam: 1.68, flat: 1.40 },
    { x: -2.4, keel: -0.22, sheer: 0.68, beam: 1.82, flat: 1.52 },
    { x: 0.6, keel: -0.24, sheer: 0.68, beam: 1.82, flat: 1.52 },
    { x: 3.2, keel: -0.20, sheer: 0.70, beam: 1.70, flat: 1.42 },
    { x: 4.6, keel: -0.10, sheer: 0.74, beam: 1.34, flat: 1.12 },
    { x: 5.0, keel: -0.02, sheer: 0.80, beam: 1.10, flat: 0.92 },
  ];
  const deck = 0.44;
  hull(hard, st, deck);
  deckPlanks(hard, st, -4.8, 4.8, deck, detail ? 12 : 6);
  rubRail(hard, st, 0.1, sh(W_HULL, 0.8));

  // 栏杆：立柱 8 对 + 上下两道横杆
  for (let i = 0; i < 8; i++) {
    const x = -4.4 + i * 1.26;
    const b = 1.5;
    for (const s of [-1, 1]) {
      hard.box(0.09, 0.62, 0.09, x, deck + 0.31, s * b, sh(W_FRAME, 0.95));
      hard.box(0.09, 0.09, 0.09, x, deck + 0.62, s * b, W_POLE);
    }
  }
  for (const s of [-1, 1]) {
    hard.box(9.2, 0.08, 0.08, 0, deck + 0.6, s * 1.5, W_POLE);
    hard.box(9.2, 0.06, 0.06, 0, deck + 0.32, s * 1.5, sh(W_POLE, 0.85));
  }
  // 首尾跳板 + 系缆桩
  hard.box(1.4, 0.07, 0.7, 4.2, deck + 0.02, 0, sh(W_DECK, 0.9), 0, 0, -0.06);
  for (const [bx, bz] of [[-4.4, 1.3], [-4.4, -1.3], [4.2, 1.2], [4.2, -1.2]]) {
    hard.cyl(0.1, 0.12, 0.34, 6, bx, deck + 0.15, bz, IRON);
  }
  // 桨架 4 处
  for (const [ox, oz] of [[-1.4, 1.56], [-1.4, -1.56], [1.6, 1.56], [1.6, -1.56]] as const) {
    hard.box(0.1, 0.16, 0.16, ox, deck + 0.5, oz, IRON);
  }
  // 舱面堆货（渡客的行李）
  if (detail) {
    hard.box(0.7, 0.4, 0.6, -2.2, deck + 0.22, 0.2, sh(W_DECK, 0.82), 0.3);
    hard.cyl(0.24, 0.28, 0.42, 7, -2.4, deck + 0.23, -0.55, sh(CEIL, 0.8));
  }
  void cloth;
  return {
    hard: hard.toGeo(), cloth: null, rig: null, sail: null,
    pivot: { x: 0, y: deck, z: 0 },
    oars: [
      { x: -1.4, y: deck + 0.5, z: 1.56, side: 1 },
      { x: -1.4, y: deck + 0.5, z: -1.56, side: -1 },
      { x: 1.6, y: deck + 0.5, z: 1.56, side: 1 },
      { x: 1.6, y: deck + 0.5, z: -1.56, side: -1 },
    ],
    lanterns: [],
    len: 10, beam: 3.6, deck,
    crew: [
      { x: -2.6, y: deck, z: 1.2, occ: 'sailor', act: 'row' },
      { x: -2.6, y: deck, z: -1.2, occ: 'sailor', act: 'row' },
      { x: 0.4, y: deck, z: 0, occ: 'porter', act: 'stand' },
      { x: 2.6, y: deck, z: 0.6, occ: 'peddler', act: 'stand' },
    ],
  };
}

// ---------- 5 画舫（两层，霓虹版，14m） ----------
function pleasureBoat(detail: number): BoatParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const st: HullSt[] = [
    { x: -7.0, keel: -0.10, sheer: 1.42, beam: 1.20, flat: 0.66 },
    { x: -6.0, keel: -0.34, sheer: 1.36, beam: 1.72, flat: 1.00 },
    { x: -4.2, keel: -0.52, sheer: 1.32, beam: 2.00, flat: 1.16 },
    { x: -1.2, keel: -0.56, sheer: 1.30, beam: 2.08, flat: 1.22 },
    { x: 2.2, keel: -0.52, sheer: 1.32, beam: 2.00, flat: 1.16 },
    { x: 5.0, keel: -0.38, sheer: 1.38, beam: 1.70, flat: 0.98 },
    { x: 6.6, keel: -0.20, sheer: 1.48, beam: 1.10, flat: 0.60 },
  ];
  const deck = 0.82;
  hull(hard, st, deck);
  deckPlanks(hard, st, -6.6, 6.6, deck, detail ? 12 : 6);
  rubRail(hard, st, 0.2, sh(W_HULL, 0.82));
  rubRail(hard, st, 0.7, GOLD);

  // 一层舱：彩绘壁板 + 栏杆
  hard.box(8.4, 1.55, 3.3, -0.6, deck + 0.9, 0, LACQ);
  hard.box(8.6, 0.12, 3.5, -0.6, deck + 1.72, 0, sh(GOLD, 0.9));
  // 腰间挑檐（一层顶的腰檐）
  hard.box(9.2, 0.1, 3.9, -0.6, deck + 1.84, 0, sh(W_FRAME, 1.05), 0, 0, 0);
  for (const s of [-1, 1]) {
    hard.box(9.2, 0.14, 0.16, -0.6, deck + 1.78, s * 1.9, sh(SILK_RED, 0.8));
  }
  // 二层舱（收分）
  hard.box(6.4, 1.2, 2.7, -0.8, deck + 2.55, 0, sh(LACQ, 1.12));
  hard.box(6.6, 0.1, 2.9, -0.8, deck + 3.2, 0, sh(GOLD, 0.86));
  // 卷棚顶（前后两坡的圆脊棚）
  const roofY = deck + 3.25;
  const RS = detail ? 7 : 4;
  for (let i = 0; i < RS; i++) {
    const a0 = Math.PI * (i / RS), a1 = Math.PI * ((i + 1) / RS);
    const y0 = roofY + Math.sin(a0) * 0.55, y1 = roofY + Math.sin(a1) * 0.55;
    const z0 = Math.cos(a0) * 1.55, z1 = Math.cos(a1) * 1.55;
    // 席棚面
    cloth.quad([-4.0, y0, z0], [-4.0, y1, z1], [2.4, y1, z1], [2.4, y0, z0], i % 2 ? sh(CLOTH_MAT, 0.95) : CLOTH_MAT, 1.0);
  }
  // 卷棚两端封头 + 脊饰
  hard.cyl(0.5, 0.5, 0.12, 8, -4.0, roofY + 0.5, 0, sh(W_FRAME, 1.05), Math.PI / 2, 0, 0);
  hard.cyl(0.5, 0.5, 0.12, 8, 2.4, roofY + 0.5, 0, sh(W_FRAME, 1.05), Math.PI / 2, 0, 0);
  hard.box(6.4, 0.14, 0.12, -0.8, roofY + 0.56, 0, GOLD);
  // 二层窗（连续棂窗，暖光内透 → 用漆木框 + 深窗心）
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      hard.box(0.9, 0.62, 0.05, -3.3 + i * 1.5, deck + 2.6, s * 1.37, sh(W_FRAME, 0.3));
      hard.box(0.94, 0.07, 0.06, -3.3 + i * 1.5, deck + 2.92, s * 1.38, GOLD);
    }
  }
  // 帘幕（二层前脸 + 一层两侧）
  cloth.plate([2.42, deck + 3.2, 1.3], [2.42, deck + 3.2, -1.3], [2.44, deck + 1.95, -1.3], [2.44, deck + 1.95, 1.3], sh(SILK_RED, 0.88), 0.02);
  for (const s of [-1, 1]) {
    cloth.plate([3.4, deck + 1.7, s * 1.68], [-0.4, deck + 1.7, s * 1.68], [-0.4, deck + 0.35, s * 1.68], [3.4, deck + 0.35, s * 1.68], sh(SILK_DARK, 0.95), 0.02);
  }
  // 霓虹灯带（赛博版）：腰檐下缘 + 二层檐下，小面积 glow 由 units.ts 用灯珠补
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) hard.box(2.7, 0.05, 0.05, -3.5 + i * 2.9, deck + 1.74, s * 1.95, NEON, 0, 0, 0, 1);
    for (let i = 0; i < 2; i++) hard.box(2.6, 0.045, 0.045, -2.6 + i * 3.0, deck + 3.14, s * 1.5, NEON, 0, 0, 0, 1);
  }
  // 首部平台栏杆 + 尾舵
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) hard.box(0.08, 0.5, 0.08, 4.6 + i * 0.9, deck + 0.25, s * 1.3, sh(W_FRAME, 0.9));
  hard.box(0.16, 1.3, 0.9, -7.35, 0.1, 0, sh(W_FRAME, 0.85));
  hard.box(0.14, 0.14, 1.6, -7.1, 1.1, 0, W_POLE, 0, 0, 0.4);
  void cloth;
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(), rig: null, sail: null,
    pivot: { x: 0, y: deck, z: 0 },
    oars: [
      { x: -5.6, y: deck + 0.35, z: 1.45, side: 1 },
      { x: -5.6, y: deck + 0.35, z: -1.45, side: -1 },
    ],
    lanterns: [
      { x: 3.0, y: deck + 1.55, z: 1.55 }, { x: 3.0, y: deck + 1.55, z: -1.55 },
      { x: 1.6, y: deck + 3.3, z: 1.3 }, { x: 1.6, y: deck + 3.3, z: -1.3 },
    ],
    len: 14, beam: 4.2, deck,
    crew: [
      { x: -5.4, y: deck, z: 1.3, occ: 'sailor', act: 'row' },
      { x: -5.4, y: deck, z: -1.3, occ: 'sailor', act: 'row' },
      { x: 4.5, y: deck, z: 0.4, occ: 'musician', act: 'stand' },
      { x: 5.3, y: deck, z: -0.55, occ: 'lady', act: 'sitTea' },
    ],
  };
}

// ---------- 6 小舟（三板，3.6m） ----------
function skiffBoat(detail: number): BoatParts {
  const hard = new GeoBuf();
  const st: HullSt[] = [
    { x: -1.8, keel: 0.06, sheer: 0.34, beam: 0.16, flat: 0.09 },
    { x: -1.2, keel: -0.06, sheer: 0.30, beam: 0.44, flat: 0.22 },
    { x: -0.2, keel: -0.12, sheer: 0.28, beam: 0.52, flat: 0.26 },
    { x: 0.9, keel: -0.10, sheer: 0.30, beam: 0.46, flat: 0.22 },
    { x: 1.8, keel: 0.06, sheer: 0.40, beam: 0.14, flat: 0.08 },
  ];
  const deck = 0.16;
  hull(hard, st, deck);
  // 三板：两道内衬板 + 坐板
  hard.box(3.0, 0.03, 0.9, 0, deck + 0.02, 0, sh(W_DECK, 0.95));
  hard.box(0.34, 0.06, 0.82, -0.5, deck + 0.12, 0, sh(W_DECK, 0.9));
  hard.box(0.3, 0.06, 0.7, 0.85, deck + 0.12, 0, sh(W_DECK, 0.86));
  rubRail(hard, st, 0.06, sh(W_HULL, 0.8));
  if (detail) {
    hard.cyl(0.06, 0.07, 0.5, 5, 1.5, deck + 0.2, 0.1, W_POLE); // 短篙
    hard.box(0.5, 0.05, 0.28, -1.2, deck + 0.06, 0.05, sh(W_FRAME, 0.9));
  }
  return {
    hard: hard.toGeo(), cloth: null, rig: null, sail: null,
    pivot: { x: 0, y: deck, z: 0 },
    oars: [{ x: -1.3, y: deck + 0.2, z: 0.42, side: 1 }],
    lanterns: [],
    len: 3.6, beam: 1.1, deck,
    crew: [{ x: -1.2, y: deck, z: 0.12, occ: 'fisher', act: 'row' }],
  };
}

/** 船型清单：0 渡船 / 1 漕船 / 2 客船 / 3 画舫 / 4 渔船 / 5 小舟 */
export function boatParts(kind: number, detail: 1 | 0): BoatParts {
  switch (kind) {
    case 0: return ferryBoat(detail);
    case 1: return grainBoat(detail);
    case 2: return passengerBoat(detail);
    case 3: return pleasureBoat(detail);
    case 4: return fisherBoat(detail);
    default: return skiffBoat(detail);
  }
}

// ============ 车（4 型，+x 为行进方向，y=0 为地面） ============
export interface CartParts {
  hard: THREE.BufferGeometry;
  cloth: THREE.BufferGeometry | null;
  wheels: { x: number; z: number; r: number }[];
  /** 牲口挂点（正值 = 车前方） */
  hitch: number;
  len: number;
}

/** 车轮轴 + 铁辖 */
function axle(hard: GeoBuf, x: number, z: number, r: number): void {
  hard.box(0.14, 0.14, z * 2 + 0.3, x, r, 0, IRON);
  for (const s of [-1, 1]) hard.cyl(0.07, 0.07, 0.16, 6, x, r, s * (z + 0.06), IRON_L, Math.PI / 2, 0, 0);
}

/** 太平车：四轮、双辕、车箱带拱棚（载重主力） */
function taipingCart(detail: number): CartParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const WR = 0.68, AX = 1.02, AZ = 0.92;
  // 车架（大梁 ×2 + 横枨 ×3）
  for (const s of [-1, 1]) hard.box(3.9, 0.16, 0.14, 0, 0.74, s * 0.62, W_FRAME);
  for (const x of [-1.45, 0, 1.45]) hard.box(0.16, 0.14, 1.34, x, 0.74, 0, sh(W_FRAME, 0.94));
  // 车箱：底板 + 四壁 + 压条
  hard.box(2.5, 0.1, 1.68, -0.15, 0.9, 0, W_DECK);
  hard.box(2.5, 0.72, 0.1, -0.15, 1.28, 0.83, W_CABIN);
  hard.box(2.5, 0.72, 0.1, -0.15, 1.28, -0.83, W_CABIN);
  hard.box(0.1, 0.72, 1.68, -1.36, 1.28, 0, sh(W_CABIN, 0.92));
  hard.box(0.1, 0.5, 1.68, 1.06, 1.18, 0, sh(W_CABIN, 0.96));
  hard.box(2.62, 0.08, 1.8, -0.15, 1.66, 0, sh(W_FRAME, 1.08));
  if (detail) {
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) hard.box(0.06, 0.66, 0.06, -1.1 + i * 0.62, 1.28, s * 0.89, sh(W_FRAME, 0.9));
    }
    for (let i = 0; i < 3; i++) hard.box(0.05, 0.05, 1.7, -1.0 + i * 0.95, 1.62, 0, IRON, 0, 0, 0, 1);
  }
  // 拱棚（芦席半圆拱，四段）
  const SEG = detail ? 5 : 3;
  for (let i = 0; i < SEG; i++) {
    const a0 = Math.PI * (i / SEG), a1 = Math.PI * ((i + 1) / SEG);
    const y0 = 1.7 + Math.sin(a0) * 0.62, y1 = 1.7 + Math.sin(a1) * 0.62;
    const z0 = Math.cos(a0) * 0.9, z1 = Math.cos(a1) * 0.9;
    cloth.quad([-1.34, y0, z0], [-1.34, y1, z1], [0.96, y1, z1], [0.96, y0, z0], i % 2 ? CLOTH_MAT : sh(CLOTH_MAT, 0.9), 0.96);
    // 席棚下的竹骨
    hard.strut([-1.34, y0, z0], [-1.34, y1, z1], 0.06, W_FRAME);
    hard.strut([0.96, y0, z0], [0.96, y1, z1], 0.06, W_FRAME);
    hard.strut([-1.34, y0, -z0], [-1.34, y1, -z1], 0.06, W_FRAME);
    hard.strut([0.96, y0, -z0], [0.96, y1, -z1], 0.06, W_FRAME);
  }
  // 双辕（两根长辕 + 前端横轭）
  for (const s of [-1, 1]) hard.strut([1.0, 0.78, s * 0.5], [3.72, 0.96, s * 0.46], 0.13, W_FRAME);
  hard.box(0.14, 0.14, 1.1, 3.66, 0.96, 0, W_POLE);
  // 车尾拖钩 + 绳
  hard.cyl(0.06, 0.06, 0.28, 5, -1.95, 0.78, 0, IRON, 0, 0, Math.PI / 2);
  if (detail) {
    // 载货：麻袋 3 堆
    for (let i = 0; i < 3; i++) hard.cyl(0.3, 0.34, 0.62, 7, -1.0 + i * 0.72, 1.02, -0.16, sh(CEIL, 0.9 + (i % 2) * 0.06), 0, 0, 0.03);
  }
  axle(hard, AX, 0, WR);
  axle(hard, -AX, 0, WR);
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(),
    wheels: [{ x: AX, z: AZ, r: WR }, { x: AX, z: -AZ, r: WR }, { x: -AX, z: AZ, r: WR }, { x: -AX, z: -AZ, r: WR }],
    hitch: 3.7, len: 4.2,
  };
}

/** 独轮车：一轮、两把、货架 */
function barrowCart(detail: number): CartParts {
  const hard = new GeoBuf();
  const WR = 0.42;
  // 车架：两根大杆从轮轴伸到后把
  for (const s of [-1, 1]) hard.strut([0.55, 0.5, s * 0.3], [-1.28, 0.82, s * 0.22], 0.09, W_FRAME);
  // 轮上护板（半圆罩）
  for (let i = 0; i < 4; i++) {
    const a0 = Math.PI * (i / 4), a1 = Math.PI * ((i + 1) / 4);
    const y0 = 0.5 + Math.sin(a0) * WR, y1 = 0.5 + Math.sin(a1) * WR;
    const z0 = Math.cos(a0) * 0.36, z1 = Math.cos(a1) * 0.36;
    hard.quad([0.1, y0, z0], [0.1, y1, z1], [-0.24, y1, z1], [-0.24, y0, z0], sh(W_DECK, 0.94), 0.9);
    hard.quad([0.1, y0, -z0], [0.1, y1, -z1], [-0.24, y1, -z1], [-0.24, y0, -z0], sh(W_DECK, 0.94), 0.9);
  }
  // 货架：两侧平台 + 横档
  for (const s of [-1, 1]) {
    hard.box(1.1, 0.07, 0.44, -0.35, 0.62, s * 0.42, W_DECK);
    hard.box(1.1, 0.09, 0.06, -0.35, 0.74, s * 0.62, W_FRAME);
    for (let i = 0; i < 3; i++) hard.box(0.06, 0.2, 0.06, -0.75 + i * 0.4, 0.62, s * 0.6, sh(W_FRAME, 0.9));
  }
  // 后把（两根）+ 支脚
  for (const s of [-1, 1]) hard.box(0.4, 0.07, 0.07, -1.42, 0.84, s * 0.2, W_POLE);
  hard.box(0.05, 0.42, 0.05, -0.95, 0.36, 0.3, W_FRAME);
  hard.box(0.05, 0.42, 0.05, -0.95, 0.36, -0.3, W_FRAME);
  if (detail) {
    // 货：两只竹筐 + 麻绳
    hard.cyl(0.26, 0.22, 0.3, 7, -0.15, 0.82, 0.42, sh(CEIL, 0.86));
    hard.cyl(0.24, 0.2, 0.28, 7, -0.6, 0.81, -0.42, sh(CEIL, 0.76));
    hard.cyl(0.04, 0.04, 0.9, 4, 0.35, 0.62, 0.1, sh(CEIL, 0.9), 0, 0, Math.PI / 2);
  }
  return {
    hard: hard.toGeo(), cloth: null,
    wheels: [{ x: 0, z: 0, r: WR }],
    hitch: 1.3, len: 2.6,
  };
}

/** 牛车：两轮高箱 + 篷架 */
function oxcartCart(detail: number): CartParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const WR = 0.64;
  // 车底板 + 高箱
  hard.box(2.5, 0.12, 1.5, -0.35, 0.86, 0, W_DECK);
  hard.box(2.4, 1.05, 0.1, -0.35, 1.46, 0.72, W_CABIN);
  hard.box(2.4, 1.05, 0.1, -0.35, 1.46, -0.72, W_CABIN);
  hard.box(0.1, 1.05, 1.44, -1.5, 1.46, 0, sh(W_CABIN, 0.9));
  hard.box(0.1, 0.7, 1.44, 0.8, 1.28, 0, sh(W_CABIN, 0.95));
  hard.box(2.52, 0.1, 1.56, -0.35, 2.02, 0, sh(W_FRAME, 1.06));
  if (detail) {
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) hard.box(0.06, 0.95, 0.06, -1.1 + i * 0.6, 1.46, s * 0.78, sh(W_FRAME, 0.88));
    // 箱侧铁箍
    for (const s of [-1, 1]) hard.box(2.44, 0.06, 0.06, -0.35, 1.9, s * 0.78, IRON);
  }
  // 篷架（拱形席篷，覆盖箱顶）
  const SEG = detail ? 5 : 3;
  for (let i = 0; i < SEG; i++) {
    const a0 = Math.PI * (i / SEG), a1 = Math.PI * ((i + 1) / SEG);
    const y0 = 2.06 + Math.sin(a0) * 0.5, y1 = 2.06 + Math.sin(a1) * 0.5;
    const z0 = Math.cos(a0) * 0.8, z1 = Math.cos(a1) * 0.8;
    cloth.quad([-1.5, y0, z0], [-1.5, y1, z1], [0.8, y1, z1], [0.8, y0, z0], i % 2 ? CLOTH_DARK : sh(CLOTH_DARK, 1.1), 0.96);
    hard.strut([-1.5, y0, z0], [-1.5, y1, z1], 0.06, W_FRAME);
    hard.strut([0.8, y0, z0], [0.8, y1, z1], 0.06, W_FRAME);
    hard.strut([-1.5, y0, -z0], [-1.5, y1, -z1], 0.06, W_FRAME);
    hard.strut([0.8, y0, -z0], [0.8, y1, -z1], 0.06, W_FRAME);
  }
  // 辕（两根）+ 轭
  for (const s of [-1, 1]) hard.strut([0.75, 0.9, s * 0.52], [3.3, 1.02, s * 0.42], 0.12, W_FRAME);
  hard.box(0.13, 0.13, 1.0, 3.24, 1.02, 0, W_POLE);
  axle(hard, 0, 0, WR);
  if (detail) hard.box(0.6, 0.35, 0.6, -1.0, 1.1, 0, sh(W_DECK, 0.84));
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(),
    wheels: [{ x: 0, z: 0.9, r: WR }, { x: 0, z: -0.9, r: WR }],
    hitch: 3.24, len: 3.6,
  };
}

/** 驴车：小板车 + 低栏 */
function donkeyCart(detail: number): CartParts {
  const hard = new GeoBuf();
  const WR = 0.5;
  hard.box(2.2, 0.12, 1.2, -0.4, 0.66, 0, W_DECK);
  for (const s of [-1, 1]) {
    hard.box(0.07, 0.34, 2.16, -1.45, 0.88, 0, sh(W_FRAME, 0.94), Math.PI / 2, 0, 0);
    hard.box(1.9, 0.06, 0.06, -0.4, 1.04, s * 0.58, W_POLE);
    for (let i = 0; i < 3; i++) hard.box(0.06, 0.3, 0.06, -1.2 + i * 0.8, 0.9, s * 0.58, W_FRAME);
  }
  // 辕 + 横档
  for (const s of [-1, 1]) hard.strut([0.7, 0.68, s * 0.42], [2.6, 0.86, s * 0.36], 0.1, W_FRAME);
  hard.box(0.11, 0.11, 0.86, 2.55, 0.86, 0, W_POLE);
  axle(hard, 0, 0, WR);
  if (detail) {
    hard.box(0.7, 0.5, 0.7, -0.9, 0.98, 0, sh(W_DECK, 0.86));
    hard.cyl(0.26, 0.3, 0.46, 7, 0.2, 0.96, 0.2, sh(CEIL, 0.82));
  }
  return {
    hard: hard.toGeo(), cloth: null,
    wheels: [{ x: 0, z: 0.72, r: WR }, { x: 0, z: -0.72, r: WR }],
    hitch: 2.55, len: 2.8,
  };
}

/** 车 4 型：0 太平车 / 1 独轮车 / 2 牛车 / 3 驴车 */
export function cartParts(kind: number, detail: 1 | 0): CartParts {
  switch (kind) {
    case 0: return taipingCart(detail);
    case 1: return barrowCart(detail);
    case 2: return oxcartCart(detail);
    default: return donkeyCart(detail);
  }
}

// ============ 轿（2 型，+z 为行进方向，y=0 为轿杠中心） ============
export interface SedanParts {
  hard: THREE.BufferGeometry;
  cloth: THREE.BufferGeometry | null;
  /** 轿夫肩位（相对轿心） */
  bearers: { x: number; z: number }[];
  /** 轿内坐位高度 */
  seat: number;
  len: number;
  mass: number;
}

/** 官轿：四人抬，帷幔 + 顶珠 */
function officialSedan(detail: number): SedanParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const W = 1.16, D = 1.06, H = 1.02;
  // 轿厢：底 + 四壁 + 腰枨
  hard.box(W, 0.1, D, 0, 0.06, 0, sh(LACQ, 0.7));
  for (const s of [-1, 1]) {
    hard.box(W, H, 0.08, 0, 0.12 + H / 2, s * (D / 2), LACQ);
    hard.box(0.08, H, D, s * (W / 2), 0.12 + H / 2, 0, sh(LACQ, 0.94));
  }
  hard.box(W + 0.04, 0.1, D + 0.04, 0, 0.12 + H, 0, sh(GOLD, 0.9));
  // 轿顶：两级收分 + 宝顶
  hard.box(W + 0.2, 0.1, D + 0.18, 0, 0.2 + H, 0, sh(LACQ, 1.15));
  hard.frus(W + 0.2, D + 0.18, W * 0.62, D * 0.58, 0.26, 0, 0.36 + H, 0, sh(LACQ, 1.05));
  hard.box(0.34, 0.07, 0.3, 0, 0.52 + H, 0, GOLD);
  hard.cyl(0.1, 0.13, 0.12, 8, 0, 0.6 + H, 0, GOLD);
  hard.cyl(0.05, 0.1, 0.16, 8, 0, 0.72 + H, 0, sh(GOLD, 1.2));   // 顶珠
  // 轿杠：两根纵杠 + 四只铁箍
  for (const s of [-1, 1]) {
    hard.box(0.1, 0.1, 2.9, s * 0.52, 0, 0, W_POLE);
    for (const z of [-1.2, -0.4, 0.4, 1.2]) hard.box(0.13, 0.13, 0.07, s * 0.52, 0, z, IRON);
  }
  // 前后横担（连接两杠）
  for (const z of [-1.2, 1.2]) hard.box(1.14, 0.09, 0.09, 0, 0, z, sh(W_POLE, 0.9));
  // 帷幔（四面垂帘，含下摆缘饰）
  const top = 0.12 + H - 0.06;
  for (const s of [-1, 1]) {
    cloth.plate([-W / 2 + 0.02, top, s * (D / 2 + 0.02)], [W / 2 - 0.02, top, s * (D / 2 + 0.02)],
      [W / 2 - 0.06, top - 0.62, s * (D / 2 + 0.05)], [-W / 2 + 0.06, top - 0.62, s * (D / 2 + 0.05)], sh(SILK_RED, 0.9), 0.01);
    cloth.plate([s * (W / 2 + 0.02), top, -D / 2 + 0.02], [s * (W / 2 + 0.02), top, D / 2 - 0.02],
      [s * (W / 2 + 0.05), top - 0.62, D / 2 - 0.06], [s * (W / 2 + 0.05), top - 0.62, -D / 2 + 0.06], sh(SILK_RED, 0.82), 0.01);
    // 缘饰横带
    hard.box(W, 0.06, 0.04, 0, top - 0.62, s * (D / 2 + 0.05), sh(GOLD, 1.0));
  }
  // 前帘（可掀的一角，露出轿内）
  cloth.plate([-0.42, top, D / 2 + 0.06], [0.42, top, D / 2 + 0.06], [0.34, top - 0.5, D / 2 + 0.14], [-0.34, top - 0.5, D / 2 + 0.14], sh(SILK_DARK, 1.05), 0.01);
  if (detail) {
    // 窗（两侧小方窗 + 棂条）
    for (const s of [-1, 1]) {
      hard.box(0.46, 0.34, 0.05, 0, 0.62, s * (D / 2 + 0.01), sh(W_FRAME, 0.3));
      hard.box(0.5, 0.05, 0.06, 0, 0.8, s * (D / 2 + 0.02), GOLD);
    }
    // 角饰（四角小兽头）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) hard.cyl(0.05, 0.07, 0.14, 5, sx * (W / 2 - 0.05), 0.28 + H, sz * (D / 2 - 0.05), GOLD);
  }
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(),
    bearers: [{ x: -0.86, z: 1.25 }, { x: 0.86, z: 1.25 }, { x: -0.86, z: -1.25 }, { x: 0.86, z: -1.25 }],
    seat: 0.55, len: 1.2, mass: 3,
  };
}

/** 小轿：二人抬，单杠 */
function smallSedan(detail: number): SedanParts {
  const hard = new GeoBuf(), cloth = new GeoBuf();
  const W = 0.92, D = 0.9, H = 0.92;
  hard.box(W, 0.09, D, 0, 0.06, 0, sh(W_CABIN, 0.8));
  for (const s of [-1, 1]) {
    hard.box(W, H, 0.07, 0, 0.1 + H / 2, s * (D / 2), sh(W_CABIN, 0.95));
    hard.box(0.07, H, D, s * (W / 2), 0.1 + H / 2, 0, W_CABIN);
    hard.box(0.05, 0.05, D, s * (W / 2), 0.3, 0, sh(W_FRAME, 0.8));
  }
  // 平顶 + 竹骨压边
  hard.box(W + 0.12, 0.08, D + 0.12, 0, 0.14 + H, 0, sh(W_FRAME, 1.02));
  hard.box(W + 0.16, 0.05, 0.08, 0, 0.19 + H, D / 2 + 0.04, sh(CLOTH_DARK, 1.1));
  hard.box(W + 0.16, 0.05, 0.08, 0, 0.19 + H, -D / 2 - 0.04, sh(CLOTH_DARK, 1.1));
  if (detail) {
    for (let i = 0; i < 3; i++) hard.box(0.05, 0.05, D + 0.14, -W / 3 + i * (W / 3), 0.2 + H, 0, sh(W_FRAME, 0.9));
  }
  // 单杠（正中贯通）
  hard.box(0.09, 0.09, 2.5, 0, 0, 0, W_POLE);
  hard.box(0.11, 0.11, 0.07, 0, 0, 0, IRON);
  // 两侧短横担（抬肩用）
  for (const z of [-0.95, 0.95]) hard.box(0.76, 0.07, 0.07, 0, 0, z, sh(W_POLE, 0.88));
  // 帘（前后两片）
  const top = 0.1 + H - 0.05;
  for (const s of [-1, 1]) {
    cloth.plate([-W / 2 + 0.04, top, s * (D / 2 + 0.02)], [W / 2 - 0.04, top, s * (D / 2 + 0.02)],
      [W / 2 - 0.08, top - 0.55, s * (D / 2 + 0.05)], [-W / 2 + 0.08, top - 0.55, s * (D / 2 + 0.05)], sh(CLOTH_DARK, 1.05), 0.01);
  }
  return {
    hard: hard.toGeo(), cloth: cloth.toGeo(),
    bearers: [{ x: 0, z: 0.95 }, { x: 0, z: -0.95 }],
    seat: 0.5, len: 1.0, mass: 2,
  };
}

/** 轿 2 型：0 官轿（四人）/ 1 小轿（二人） */
export function sedanParts(kind: number, detail: 1 | 0): SedanParts {
  return kind === 0 ? officialSedan(detail) : smallSedan(detail);
}

// ============ 动物（7 型：马/驴/骆驼/牛/猪/犬/鹅） ============
export type Species = 'horse' | 'donkey' | 'camel' | 'ox' | 'pig' | 'dog' | 'goose';

export interface AnimalParts {
  body: THREE.BufferGeometry;
  /** 髋位（体坐标系） */
  legs: { x: number; z: number }[];
  legLen: number;
  legW: number;
  /** 腿型：0 蹄行（四足） / 1 禽足（鹅） */
  legType: 0 | 1;
  /** 背部高（骑乘者落座 / 挽具高度） */
  back: number;
  /** 骑乘位（z 偏移） */
  saddle: number;
  /** 头长（挽具到头部） */
  reach: number;
}

/** 躯干放样：10 点椭圆截面沿 z 依次插值 */
function torso(buf: GeoBuf, secs: readonly { z: number; y: number; w: number; h: number }[], hex: number): void {
  const R = 10;
  const ring = (s: { y: number; w: number; h: number }): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < R; i++) {
      const a = (i / R) * Math.PI * 2;
      out.push([Math.cos(a) * s.w / 2, s.y + Math.sin(a) * s.h / 2]);
    }
    return out;
  };
  for (let k = 0; k < secs.length - 1; k++) {
    const a = ring(secs[k]), b = ring(secs[k + 1]);
    const za = secs[k].z, zb = secs[k + 1].z;
    const cy = (secs[k].y + secs[k + 1].y) / 2;
    for (let i = 0; i < R; i++) {
      const j = (i + 1) % R;
      const midY = (a[i][1] + a[j][1] + b[i][1] + b[j][1]) / 4;
      const ao = midY < cy ? 0.86 : 0.98 + (midY - cy) * 0.12;
      buf.quad([a[i][0], a[i][1], za], [a[j][0], a[j][1], za], [b[j][0], b[j][1], zb], [b[i][0], b[i][1], zb], hex, ao);
    }
  }
  // 首尾封板
  const last = secs[secs.length - 1], first = secs[0];
  const ln = ring(last), lf = ring(first);
  for (let i = 0; i < R; i++) {
    const j = (i + 1) % R;
    buf.tri([0, last.y, last.z], [ln[i][0], ln[i][1], last.z], [ln[j][0], ln[j][1], last.z], sh(hex, 1.04), 1);
    buf.tri([0, first.y, first.z], [lf[j][0], lf[j][1], first.z], [lf[i][0], lf[i][1], first.z], sh(hex, 0.9), 1);
  }
}

/** 耳：0 立耳/尖耳、1 长耳、2 垂耳、3 角 */
function ears(buf: GeoBuf, w: number, at: P3, kind: number, hex: number): void {
  for (const s of [-1, 1]) {
    const [x, y, z] = at;
    if (kind === 1) {
      // 长耳（驴）：细长前倾
      buf.strut([x + s * w * 0.3, y, z], [x + s * w * 0.55, y + 0.3, z - 0.06], 0.055, hex, 1.02);
    } else if (kind === 2) {
      // 垂耳（猪/犬垂耳）：三角片下垂
      buf.tri([x + s * w * 0.2, y + 0.02, z + 0.04], [x + s * w * 0.62, y + 0.06, z], [x + s * w * 0.34, y - 0.14, z - 0.02], sh(hex, 0.92));
      buf.tri([x + s * w * 0.2, y + 0.02, z + 0.04], [x + s * w * 0.34, y - 0.14, z - 0.02], [x + s * w * 0.62, y + 0.06, z], sh(hex, 0.84));
    } else if (kind === 3) {
      // 角（牛）：外撇再上翘
      buf.strut([x + s * w * 0.34, y + 0.05, z], [x + s * (w * 0.34 + 0.17), y + 0.12, z + 0.02], 0.07, sh(hex, 1.1), 1.05);
      buf.strut([x + s * (w * 0.34 + 0.17), y + 0.12, z + 0.02], [x + s * (w * 0.34 + 0.2), y + 0.3, z + 0.05], 0.05, sh(hex, 1.2), 1.05);
    } else {
      // 立耳：两片三角
      buf.tri([x + s * w * 0.26, y + 0.04, z - 0.02], [x + s * w * 0.5, y + 0.04, z - 0.06], [x + s * w * 0.34, y + 0.24, z - 0.04], sh(hex, 0.96));
      buf.tri([x + s * w * 0.26, y + 0.04, z + 0.06], [x + s * w * 0.34, y + 0.24, z - 0.04], [x + s * w * 0.5, y + 0.04, z - 0.06], sh(hex, 0.86));
    }
  }
}

/** 尾：0 垂尾、1 立尾、2 卷尾 */
function tail(buf: GeoBuf, at: P3, len: number, kind: number, hex: number): void {
  const [x, y, z] = at;
  if (kind === 2) {
    // 卷尾（猪）：三节小螺旋
    buf.strut([x, y, z], [x + 0.05, y + 0.1, z - 0.08], 0.04, hex);
    buf.strut([x + 0.05, y + 0.1, z - 0.08], [x - 0.02, y + 0.17, z - 0.16], 0.035, hex);
    buf.strut([x - 0.02, y + 0.17, z - 0.16], [x + 0.06, y + 0.2, z - 0.24], 0.03, hex);
  } else if (kind === 1) {
    // 立尾（犬）
    buf.strut([x, y, z], [x, y + 0.2, z - 0.16], 0.05, hex, 1.05);
    buf.strut([x, y + 0.2, z - 0.16], [x, y + 0.3, z - 0.3], 0.04, hex, 1.1);
  } else {
    // 垂尾（马/牛/骆驼）：上段细、下端毛束加粗
    buf.strut([x, y, z], [x, y - len * 0.5, z - 0.12], 0.07, hex, 1.0);
    buf.strut([x, y - len * 0.5, z - 0.12], [x, y - len, z - 0.18], 0.11, sh(hex, 0.7), 0.95);
  }
}

/** 四足兽主体：躯干放样 + 颈 + 头 + 耳 + 尾 */
interface QuadCfg {
  hex: number;
  secs: readonly { z: number; y: number; w: number; h: number }[];
  neck: [P3, P3, number];
  head: { x: number; y: number; z: number; w: number; h: number; l: number };
  ear: number; earW: number;
  tail: number; tailLen: number;
  humps?: number;
  horn?: boolean;
  mane?: boolean;
  saddle?: boolean;
  dewlap?: boolean;
}

function quadruped(c: QuadCfg): GeoBuf {
  const g = new GeoBuf();
  torso(g, c.secs, c.hex);
  const [n0, n1, nw] = c.neck;
  g.strut(n0, n1, nw, sh(c.hex, 1.04), 1.0);
  if (c.dewlap) {
    // 牛颈垂皮
    g.plate([n0[0], n0[1] - nw * 0.4, n0[2]], [n0[0], n1[1] - nw * 0.5, n1[2] - 0.1],
      [n0[0], n1[1] - nw * 0.95, n1[2] - 0.2], [n0[0], n0[1] - nw * 0.85, n0[2] - 0.02], sh(c.hex, 0.8), 0.03);
  }
  if (c.mane) {
    // 鬃毛：沿颈上缘的一列薄片
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const px = n0[0] + (n1[0] - n0[0]) * t, py = n0[1] + (n1[1] - n0[1]) * t, pz = n0[2] + (n1[2] - n0[2]) * t;
      g.box(0.08, 0.12, 0.14, px, py + nw * 0.5, pz - 0.02, sh(c.hex, 0.62), 0, 0, 0, 1.05);
    }
  }
  const hd = c.head;
  g.box(hd.w, hd.h, hd.l, hd.x, hd.y, hd.z, sh(c.hex, 1.08), 0, 0, 0, 1.02);
  // 吻部
  g.frus(hd.w * 0.74, hd.l * 0.46, hd.w * 0.6, hd.l * 0.36, hd.h * 0.72, hd.x, hd.y - hd.h * 0.12, hd.z + hd.l * 0.62, sh(c.hex, 1.12));
  // 鼻镜
  g.box(hd.w * 0.62, hd.h * 0.42, 0.05, hd.x, hd.y - hd.h * 0.12, hd.z + hd.l * 0.86, sh(c.hex, 0.72));
  ears(g, hd.w, [hd.x, hd.y + hd.h * 0.42, hd.z - hd.l * 0.18], c.ear, c.hex);
  if (c.horn) ears(g, hd.w, [hd.x, hd.y + hd.h * 0.34, hd.z - hd.l * 0.06], 3, 0xd8cbb0);
  if (c.humps) {
    // 驼峰：两枚收分穹顶
    for (let i = 0; i < c.humps; i++) {
      const hz = -0.3 + i * 0.52;
      const sy = c.secs[Math.min(c.secs.length - 2, 1 + i)].y + c.secs[1].h * 0.5;
      g.frus(0.5, 0.62, 0.14, 0.18, 0.42, 0, sy + 0.18, hz, sh(c.hex, 0.94));
    }
  }
  tail(g, [0, c.secs[1].y + 0.1, c.secs[0].z - 0.02], c.tailLen, c.tail, c.hex);
  if (c.saddle) {
    // 鞍：垫 + 前后鞍桥 + 肚带（骑手落座处）
    const sy = c.secs[2].y + c.secs[2].h * 0.5;
    const sz = c.secs[2].z;
    g.box(c.secs[2].w * 0.78, 0.07, 0.56, 0, sy + 0.01, sz, 0x7a2c28, 0, 0, 0, 1.06);
    g.box(0.2, 0.09, 0.12, 0, sy + 0.09, sz + 0.22, 0x5a1f18);
    g.box(0.2, 0.12, 0.1, 0, sy + 0.1, sz - 0.22, 0x5a1f18);
    for (const s of [-1, 1]) g.box(0.04, 0.3, 0.06, s * (c.secs[2].w * 0.4), sy - 0.16, sz, 0x3a2c22);
  }
  return g;
}

const QUAD: Record<Exclude<Species, 'goose'>, () => AnimalParts> = {
  horse: () => {
    const g = quadruped({
      hex: 0x6a4a30,
      secs: [
        { z: -0.78, y: 1.16, w: 0.3, h: 0.34 },
        { z: -0.52, y: 1.14, w: 0.46, h: 0.52 },
        { z: -0.1, y: 1.13, w: 0.5, h: 0.56 },
        { z: 0.26, y: 1.16, w: 0.52, h: 0.58 },
        { z: 0.56, y: 1.2, w: 0.44, h: 0.54 },
        { z: 0.74, y: 1.24, w: 0.3, h: 0.42 },
      ],
      neck: [[0, 1.4, 0.68], [0, 1.74, 0.94], 0.26],
      head: { x: 0, y: 1.84, z: 1.1, w: 0.2, h: 0.22, l: 0.5 },
      ear: 0, earW: 0.2,
      tail: 0, tailLen: 0.62, mane: true, saddle: true,
    });
    return { body: g.toGeo(), legs: [{ x: -0.2, z: 0.5 }, { x: 0.2, z: 0.5 }, { x: -0.2, z: -0.52 }, { x: 0.2, z: -0.52 }], legLen: 0.86, legW: 0.12, legType: 0, back: 1.42, saddle: -0.05, reach: 1.35 };
  },
  donkey: () => {
    const g = quadruped({
      hex: 0x7a6a58,
      secs: [
        { z: -0.62, y: 0.84, w: 0.24, h: 0.28 },
        { z: -0.4, y: 0.83, w: 0.36, h: 0.42 },
        { z: -0.05, y: 0.82, w: 0.38, h: 0.44 },
        { z: 0.24, y: 0.84, w: 0.38, h: 0.44 },
        { z: 0.46, y: 0.87, w: 0.32, h: 0.4 },
        { z: 0.58, y: 0.9, w: 0.22, h: 0.3 },
      ],
      neck: [[0, 1.02, 0.56], [0, 1.3, 0.76], 0.2],
      head: { x: 0, y: 1.38, z: 0.9, w: 0.18, h: 0.2, l: 0.4 },
      ear: 1, earW: 0.18,
      tail: 0, tailLen: 0.44, saddle: true,
    });
    return { body: g.toGeo(), legs: [{ x: -0.15, z: 0.36 }, { x: 0.15, z: 0.36 }, { x: -0.15, z: -0.42 }, { x: 0.15, z: -0.42 }], legLen: 0.62, legW: 0.095, legType: 0, back: 1.04, saddle: -0.02, reach: 1.1 };
  },
  camel: () => {
    const g = quadruped({
      hex: 0xb89868,
      secs: [
        { z: -1.0, y: 1.32, w: 0.4, h: 0.44 },
        { z: -0.62, y: 1.3, w: 0.6, h: 0.64 },
        { z: -0.1, y: 1.28, w: 0.64, h: 0.66 },
        { z: 0.42, y: 1.3, w: 0.6, h: 0.64 },
        { z: 0.8, y: 1.34, w: 0.48, h: 0.56 },
        { z: 1.0, y: 1.36, w: 0.34, h: 0.44 },
      ],
      neck: [[0, 1.52, 0.94], [0, 2.06, 1.16], 0.24],
      head: { x: 0, y: 2.14, z: 1.28, w: 0.18, h: 0.2, l: 0.44 },
      ear: 0, earW: 0.18,
      tail: 0, tailLen: 0.5, humps: 2, saddle: true,
    });
    return { body: g.toGeo(), legs: [{ x: -0.23, z: 0.72 }, { x: 0.23, z: 0.72 }, { x: -0.23, z: -0.76 }, { x: 0.23, z: -0.76 }], legLen: 0.96, legW: 0.14, legType: 0, back: 1.68, saddle: -0.35, reach: 1.5 };
  },
  ox: () => {
    const g = quadruped({
      hex: 0x6a4e38,
      secs: [
        { z: -0.86, y: 1.02, w: 0.36, h: 0.4 },
        { z: -0.6, y: 1.0, w: 0.54, h: 0.6 },
        { z: -0.12, y: 0.98, w: 0.6, h: 0.66 },
        { z: 0.36, y: 1.02, w: 0.6, h: 0.68 },
        { z: 0.66, y: 1.06, w: 0.5, h: 0.58 },
        { z: 0.82, y: 1.06, w: 0.36, h: 0.44 },
      ],
      neck: [[0, 1.16, 0.78], [0, 1.2, 0.96], 0.32],
      head: { x: 0, y: 1.18, z: 1.1, w: 0.28, h: 0.28, l: 0.4 },
      ear: 2, earW: 0.28,
      tail: 0, tailLen: 0.7, horn: true, dewlap: true,
    });
    return { body: g.toGeo(), legs: [{ x: -0.24, z: 0.56 }, { x: 0.24, z: 0.56 }, { x: -0.24, z: -0.62 }, { x: 0.24, z: -0.62 }], legLen: 0.68, legW: 0.145, legType: 0, back: 1.28, saddle: 0, reach: 1.42 };
  },
  pig: () => {
    const g = quadruped({
      hex: 0x8a6a5a,
      secs: [
        { z: -0.46, y: 0.44, w: 0.24, h: 0.26 },
        { z: -0.26, y: 0.44, w: 0.38, h: 0.42 },
        { z: 0.02, y: 0.43, w: 0.42, h: 0.46 },
        { z: 0.26, y: 0.44, w: 0.38, h: 0.42 },
        { z: 0.42, y: 0.46, w: 0.28, h: 0.32 },
      ],
      neck: [[0, 0.5, 0.42], [0, 0.52, 0.52], 0.24],
      head: { x: 0, y: 0.5, z: 0.58, w: 0.22, h: 0.22, l: 0.18 },
      ear: 2, earW: 0.24,
      tail: 2, tailLen: 0.2,
    });
    return { body: g.toGeo(), legs: [{ x: -0.14, z: 0.26 }, { x: 0.14, z: 0.26 }, { x: -0.14, z: -0.3 }, { x: 0.14, z: -0.3 }], legLen: 0.22, legW: 0.085, legType: 0, back: 0.66, saddle: 0, reach: 0.5 };
  },
  dog: () => {
    const g = quadruped({
      hex: 0x8a6a44,
      secs: [
        { z: -0.36, y: 0.42, w: 0.14, h: 0.16 },
        { z: -0.2, y: 0.42, w: 0.22, h: 0.26 },
        { z: 0.0, y: 0.41, w: 0.24, h: 0.28 },
        { z: 0.2, y: 0.42, w: 0.24, h: 0.28 },
        { z: 0.34, y: 0.44, w: 0.18, h: 0.22 },
      ],
      neck: [[0, 0.5, 0.32], [0, 0.62, 0.42], 0.16],
      head: { x: 0, y: 0.66, z: 0.52, w: 0.15, h: 0.16, l: 0.2 },
      ear: 0, earW: 0.16,
      tail: 1, tailLen: 0.3,
    });
    return { body: g.toGeo(), legs: [{ x: -0.1, z: 0.2 }, { x: 0.1, z: 0.2 }, { x: -0.1, z: -0.24 }, { x: 0.1, z: -0.24 }], legLen: 0.28, legW: 0.06, legType: 0, back: 0.56, saddle: 0, reach: 0.6 };
  },
};

/** 鹅：长颈、扁喙、双蹼足 */
function gooseParts(): AnimalParts {
  const g = new GeoBuf();
  const hex = 0xe8e2d4;
  torso(g, [
    { z: -0.32, y: 0.3, w: 0.12, h: 0.12 },
    { z: -0.18, y: 0.3, w: 0.24, h: 0.22 },
    { z: 0.02, y: 0.29, w: 0.26, h: 0.24 },
    { z: 0.18, y: 0.3, w: 0.2, h: 0.2 },
  ], hex);
  // 颈（两段，先竖后前倾）
  g.strut([0, 0.36, 0.16], [0, 0.6, 0.2], 0.075, sh(hex, 1.02), 1.02);
  g.strut([0, 0.6, 0.2], [0.02, 0.72, 0.3], 0.07, sh(hex, 1.05), 1.05);
  // 头 + 橙喙 + 额瘤
  g.box(0.11, 0.11, 0.16, 0.02, 0.76, 0.36, sh(hex, 1.08), 0, 0, 0, 1.04);
  g.frus(0.08, 0.1, 0.05, 0.06, 0.06, 0.02, 0.74, 0.47, 0xd89040);
  g.cyl(0.03, 0.04, 0.05, 5, 0.02, 0.82, 0.36, 0xd07040);
  // 翅（两片带羽纹）
  for (const s of [-1, 1]) {
    g.plate([s * 0.12, 0.36, 0.14], [s * 0.14, 0.34, -0.16], [s * 0.1, 0.24, -0.26], [s * 0.08, 0.26, 0.1], sh(hex, 0.92), 0.015);
    for (let i = 0; i < 3; i++) g.box(0.01, 0.02, 0.1, s * 0.135, 0.33, -0.02 - i * 0.07, sh(hex, 0.82), 0, 0, 0, 1);
  }
  // 尾（上翘）
  g.strut([0, 0.32, -0.3], [0, 0.4, -0.44], 0.1, sh(hex, 0.9), 1.05);
  return {
    body: g.toGeo(),
    legs: [{ x: -0.06, z: 0.02 }, { x: 0.06, z: 0.02 }],
    legLen: 0.2, legW: 0.045, legType: 1,
    back: 0.42, saddle: 0, reach: 0.5,
  };
}

export function animalParts(kind: Species): AnimalParts {
  if (kind === 'goose') return gooseParts();
  return QUAD[kind]();
}

/** 四足腿：从髋（y=0）到蹄（y=-1），截面随高度收细，蹄端加黑 */
export function legQuadGeo(): THREE.BufferGeometry {
  const g = new GeoBuf();
  const hex = 0x8a7458;
  g.frus(1, 1, 0.62, 0.62, 0.34, 0, -0.17, 0, hex, 0, 0, 0, 1.0);
  g.frus(0.62, 0.62, 0.5, 0.5, 0.44, 0, -0.56, 0, sh(hex, 0.94), 0, 0, 0, 0.92);
  g.frus(0.5, 0.5, 0.6, 0.66, 0.22, 0, -0.89, 0, sh(hex, 0.82), 0, 0, 0, 0.86);
  g.box(0.66, 0.1, 0.72, 0, -0.95, 0.03, 0x2e2620);
  return g.toGeo();
}

/** 禽足：细腿 + 三趾蹼 */
export function legBirdGeo(): THREE.BufferGeometry {
  const g = new GeoBuf();
  g.cyl(0.16, 0.2, 0.8, 5, 0, -0.4, 0, 0xd89040);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    g.strut([0, -0.8, 0], [Math.cos(a) * 0.5, -0.95, Math.sin(a) * 0.5], 0.16, 0xd07040);
  }
  return g.toGeo();
}
