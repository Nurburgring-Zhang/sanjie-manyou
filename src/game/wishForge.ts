// ============================================================================
// 三界造物 · 程序化几何锻造（融合终版垂直切片）· src/game/wishForge.ts
//
// 运行时按 archetype + traits 用 THREE.BufferGeometry / Mesh 生成可见几何；
// 颜色由 traits / spec.colors 驱动；确定性纪律：只用整数 hash，无 Math.random、
// 无 Date.now，同 spec 双跑顶点数据逐字节一致；单件 ≤ 20,000 tri。
//
// R24：forge 增加可选 stage/form 参数，五阶形态肉眼可辨（卵光茧 / 幼体短躯 /
// 成体完整龙形 / 灵体发光光环 / 神体祥云+多重光轮+额外灵肢），并把 form 的
// glow / aura / extraLimbs 真正读进几何；buildDragon 重写为可辨识的中国龙
// （连续渐变躯干 + 关节短爪 + 放大头 + 鹿角凸眼长须 + 连续背鳍带 + 扇形尾鳍）。
// ============================================================================
import * as THREE from 'three';
import type { Archetype, WishShape } from './wishCatalog';
import type { Stage, EvolvableForm } from './wishEvolution';
import { addChineseOrnaments } from './wishOrnament';

export interface WishSpec {
  name: string;
  archetype: Archetype;
  traits: string[];
  colors: number[];
  scale: number;
  seed: number;
  source: 'preset' | 'param' | 'code';
  /** 可选：阶位（兼容 wishPanel 的 forge({ ...spec, stage }) 契约，等价于 forge 第二参数） */
  stage?: Stage;
  /**
   * 可选：语义形状标签（三界造物八类愿景）。带 shape 时 forge 走专用建模函数，
   * 仍并入单一 bodyMesh（零新增 Mesh / 材质组 / 常驻 draw call）；不带则完全走旧 10 类。
   * 旧接口 100% 兼容：所有既有 WishSpec 均无此字段。
   */
  shape?: WishShape;
}

/** forge 第二参数：阶位 + 外形参数（glow/aura/extraLimbs 会被读进几何） */
export interface ForgeOptions {
  stage?: Stage;
  form?: Partial<Pick<EvolvableForm, 'glow' | 'aura' | 'extraLimbs' | 'scale'>>;
}

export interface ForgeResult {
  group: THREE.Group;
  tris: number;
  bounds: THREE.Box3;
  /** 语义部件清单（验收 / 自测用，不影响几何） */
  parts: string[];
}

/** FNV-1a 文本 hash（整数，供 agent / panel 复用） */
export function hashText(s: string): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}

/** 确定性 [0,1)：纯整数运算，逐字节可复现 */
function h01(seed: number, i: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type V3 = [number, number, number];
export interface RGB { r: number; g: number; b: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const rgb = (hex: number, k = 1): RGB => ({
  r: Math.min(1, ((hex >> 16) & 255) / 255 * k),
  g: Math.min(1, ((hex >> 8) & 255) / 255 * k),
  b: Math.min(1, (hex & 255) / 255 * k),
});
/** 沿躯干平滑渐变（替代逐段奇偶跳色） */
const lerpRGB = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

/** R26 导出：精细化部件库 wishOrnament.ts 直接复用同一套几何原语，零新增 draw call */
export class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  tri(a: V3, b: V3, c: V3, color: RGB): void {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const base = this.pos.length / 3;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.nor.push(n[0], n[1], n[2]); this.col.push(color.r, color.g, color.b); }
    this.idx.push(base, base + 1, base + 2);
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: RGB): void {
    this.tri(a, b, c, color); this.tri(a, c, d, color);
  }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color);
  }
  /** 经纬低模球（rings*seg*2 面） */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg: number, rings: number, color: RGB): void {
    const ringAt = (t: number): V3[] => {
      const phi = t * Math.PI;
      const out: V3[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        out.push([
          cx + rx * Math.sin(phi) * Math.cos(a),
          cy + ry * Math.cos(phi),
          cz + rz * Math.sin(phi) * Math.sin(a),
        ]);
      }
      return out;
    };
    let prev = ringAt(0.001);
    for (let i = 1; i <= rings; i++) {
      const cur = ringAt(i / rings);
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        this.quad(prev[j], prev[j2], cur[j2], cur[j], color);
      }
      prev = cur;
    }
  }
  /** 底圆 + 顶点（含底盖） */
  cone(bx: number, by: number, bz: number, tx: number, ty: number, tz: number, r: number, seg: number, color: RGB): void {
    const tip: V3 = [tx, ty, tz];
    const ring: V3[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push([bx + r * Math.cos(a), by, bz + r * Math.sin(a)]);
    }
    const center: V3 = [bx, by, bz];
    for (let j = 0; j < seg; j++) {
      this.tri(ring[j], ring[(j + 1) % seg], tip, color);
      this.tri(center, ring[(j + 1) % seg], ring[j], color);
    }
  }
  get tris(): number { return this.idx.length / 3; }
}

interface Palette { main: RGB; alt: RGB; trim: RGB }

/** 颜色用 traits：元素/明暗词微调主色，辅色取自 spec.colors */
function palette(spec: WishSpec): Palette {
  const cs = spec.colors.length ? spec.colors : [0xd4af37, 0x4fa8a0, 0xa8503c];
  const t = spec.traits.join(' ');
  let k = 1;
  if (/发光|金光|辉|曜|鎏|佛光|星辉/.test(t)) k = 1.2;
  if (/幽|冥|暗|影|墨|夜/.test(t)) k = 0.78;
  const main = rgb(cs[0], k);
  const alt = rgb(cs[1 % cs.length], k);
  const trim = rgb(cs[2 % cs.length], 1.15);
  if (/火|炎|赤|红|烈/.test(t)) { main.r = Math.min(1, main.r * 1.3 + 0.1); main.g *= 0.7; main.b *= 0.6; }
  if (/冰|水|寒|海|玄/.test(t)) { main.b = Math.min(1, main.b * 1.3 + 0.05); }
  if (/木|青|碧|翠|绿/.test(t)) { main.g = Math.min(1, main.g * 1.25 + 0.05); }
  return { main, alt, trim };
}

const clampScale = (s: number): number => Math.max(0.3, Math.min(3, Number.isFinite(s) ? s : 1));

// ---- 五阶形态档案 -----------------------------------------------------------
/** 每一阶的本体复杂度 / 附加部件 / 发光参数；form 的 glow/aura/extraLimbs 会覆盖默认值 */
interface StageProfile {
  bodyScale: number;
  rings: number;
  headScale: number;
  horns: 0 | 1 | 2;
  whiskers: boolean;
  clawPairs: number;
  dorsal: boolean;
  tailFin: boolean;
  glow: number;
  aura: number;
  extraLimbs: number;
  shell: boolean;
  haloRings: number;
  clouds: number;
}

const STAGE_PROFILE: Record<Stage, StageProfile> = {
  '卵':   { bodyScale: 0.52, rings: 10, headScale: 1.0, horns: 0, whiskers: false, clawPairs: 0, dorsal: false, tailFin: false, glow: 0.15, aura: 0.30, extraLimbs: 0, shell: true,  haloRings: 0, clouds: 0 },
  '幼体': { bodyScale: 0.74, rings: 12, headScale: 1.4, horns: 1, whiskers: false, clawPairs: 1, dorsal: false, tailFin: false, glow: 0.30, aura: 0.50, extraLimbs: 0, shell: false, haloRings: 0, clouds: 0 },
  '成体': { bodyScale: 1.00, rings: 18, headScale: 2.0, horns: 2, whiskers: true,  clawPairs: 2, dorsal: true,  tailFin: true,  glow: 0.45, aura: 0.70, extraLimbs: 0, shell: false, haloRings: 0, clouds: 0 },
  '灵体': { bodyScale: 1.02, rings: 18, headScale: 2.0, horns: 2, whiskers: true,  clawPairs: 2, dorsal: true,  tailFin: true,  glow: 0.80, aura: 1.00, extraLimbs: 1, shell: false, haloRings: 1, clouds: 0 },
  '神体': { bodyScale: 1.05, rings: 18, headScale: 2.1, horns: 2, whiskers: true,  clawPairs: 2, dorsal: true,  tailFin: true,  glow: 1.10, aura: 1.40, extraLimbs: 3, shell: false, haloRings: 3, clouds: 3 },
};

function profileFor(stage: Stage, form?: ForgeOptions['form']): StageProfile {
  const base = STAGE_PROFILE[stage] ?? STAGE_PROFILE['成体'];
  const clamp = (v: number | undefined, d: number, hi: number): number =>
    v === undefined || !Number.isFinite(v) ? d : Math.max(0, Math.min(hi, v));
  return {
    ...base,
    glow: clamp(form?.glow, base.glow, 1.6),
    aura: clamp(form?.aura, base.aura, 2.0),
    extraLimbs: Math.round(clamp(form?.extraLimbs, base.extraLimbs, 4)),
  };
}

// ---- 龙：连续蜿蜒躯干 + 放大头 + 鹿角/凸眼/长须 + 关节短爪 + 连续背鳍 + 扇尾 ----
function buildDragon(b: Builder, spec: WishSpec, P: Palette, prof: StageProfile): void {
  // s 已含 bodyScale 与龙形尺寸上限（spawn 卵阶段总长 ≪ 20m，不占满街道）
  const s = clampScale(spec.scale), L = 14 * s, RINGS = prof.rings, SEG = 8;
  // seed 只用于脊线相位（±小），保证不同 seed 几何不同，又不破坏躯干连续
  const ph = h01(spec.seed, 0) * 0.6;
  const spine = (t: number): V3 => [
    (t - 0.5) * L,
    2.0 * s + Math.sin(t * Math.PI * 2.4 + ph) * 0.85 * s,
    Math.sin(t * Math.PI * 1.8 + ph) * 0.55 * s,
  ];
  // 平滑半径包络：头尾渐细、相邻段差 < 15%，彻底去掉逐段 h01 随机抖动
  const radius = (t: number): number => (0.52 + 0.30 * Math.sin(t * Math.PI)) * s;
  const bodyColor = (t: number): RGB => lerpRGB(P.alt, P.main, t);

  // 躯干：段距压到 0.7 让重叠椭球连成连续管；颜色沿躯干渐变（无奇偶跳色）
  for (let i = 0; i < RINGS; i++) {
    const t = (i + 0.5) / RINGS, p = spine(t), r = radius(t);
    b.ellipsoid(p[0], p[1], p[2], (L / RINGS) * 0.7, r, r * 0.92, SEG, 5, bodyColor(t));
  }

  // 连续背鳍带：沿脊线 C 形采样，相邻段用 quad 连成一条带 + 锯齿尖
  if (prof.dorsal) {
    const N = RINGS * 2;
    const ridge = (t: number): V3 => {
      const p = spine(t);
      return [p[0], p[1] + radius(t) * 0.95, p[2]];
    };
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const a = ridge(t0), c = ridge(t1);
      const h = (0.32 + 0.5 * Math.sin(t0 * Math.PI)) * s;
      b.quad([a[0], a[1], a[2] - 0.08 * s], [c[0], c[1], c[2] - 0.08 * s],
        [c[0], c[1] + h, c[2]], [a[0], a[1] + h, a[2]], P.trim);
      b.tri([a[0], a[1] + h, a[2]], [c[0], c[1] + h, c[2]],
        [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + h * 1.45, (a[2] + c[2]) / 2], P.alt);
    }
  }

  // 头（放大到 ≈ 2.0*s）：头颅 + 吻部 + 鼻 + 一对凸眼
  const hp = spine(1);
  const hx = hp[0] + 0.8 * s, hy = hp[1] + 0.15 * s;
  const hr = 0.5 * prof.headScale * s;
  b.ellipsoid(hx, hy, hp[2], hr * 1.15, hr * 0.72, hr * 0.82, 10, 6, P.main);
  b.ellipsoid(hx + hr * 1.0, hy - 0.24 * s, hp[2], hr * 0.72, hr * 0.34, hr * 0.52, 8, 4, P.main);
  b.ellipsoid(hx + hr * 1.5, hy - 0.16 * s, hp[2], hr * 0.36, hr * 0.22, hr * 0.30, 6, 3, P.alt);
  for (const z of [-1, 1])
    b.ellipsoid(hx + hr * 0.35, hy + hr * 0.42, hp[2] + z * hr * 0.6, 0.22 * s, 0.22 * s, 0.16 * s, 8, 4, P.trim);

  // 分叉鹿角（成体）/ 短角（幼体）
  if (prof.horns > 0) for (const z of [-1, 1]) {
    const bx = hx - hr * 0.3, by = hy + hr * 0.58, bz = hp[2] + z * hr * 0.42;
    const mx = bx - 0.5 * s, my = by + (prof.horns === 2 ? 1.7 : 0.9) * s, mz = bz + z * 0.5 * s;
    b.cone(bx, by, bz, mx, my, mz, 0.16 * s, 6, P.trim);
    if (prof.horns === 2) {
      b.cone(mx, my, mz, mx - 0.9 * s, my + 0.7 * s, mz + z * 0.4 * s, 0.1 * s, 5, P.trim);
      b.cone((bx + mx) / 2, (by + my) / 2, (bz + mz) / 2,
        (bx + mx) / 2 + 0.2 * s, (by + my) / 2 + 0.8 * s, (bz + mz) / 2 + z * 0.7 * s, 0.08 * s, 5, P.trim);
    }
  }

  // 两根向前飘的长须（三段细锥连成曲线）
  if (prof.whiskers) for (const z of [-1, 1]) {
    const sx = hx + hr * 1.4, sy = hy - 0.2 * s, sz = hp[2] + z * hr * 0.35;
    const p1: V3 = [sx + 0.9 * s, sy + 0.3 * s, sz + z * 0.5 * s];
    const p2: V3 = [sx + 2.0 * s, sy - 0.1 * s, sz + z * 1.1 * s];
    const p3: V3 = [sx + 2.9 * s, sy + 0.5 * s, sz + z * 1.4 * s];
    b.cone(sx, sy, sz, p1[0], p1[1], p1[2], 0.07 * s, 5, P.trim);
    b.cone(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], 0.055 * s, 5, P.trim);
    b.cone(p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], 0.04 * s, 4, P.trim);
  }

  // 四爪：前后各一对，每只两段关节（短 ≈1.0*s）+ 3 根爪尖，不再是 -2.0*s 长锥
  const clawT: number[] = [];
  if (prof.clawPairs >= 2) clawT.push(0.30, 0.72);
  else if (prof.clawPairs === 1) clawT.push(0.62);
  for (const t of clawT) for (const z of [-1, 1]) {
    const p = spine(t);
    const ax = p[0], ay = p[1] - radius(t) * 0.7, az = p[2] + z * 0.55 * s;
    const kx: V3 = [ax - 0.15 * s, ay - 0.5 * s, az + z * 0.35 * s];
    const wx: V3 = [kx[0] + 0.35 * s, kx[1] - 0.45 * s, kx[2] + z * 0.2 * s];
    b.cone(ax, ay, az, kx[0], kx[1], kx[2], 0.18 * s, 6, P.main);
    b.cone(kx[0], kx[1], kx[2], wx[0], wx[1], wx[2], 0.13 * s, 6, P.main);
    for (const dz of [-0.18, 0, 0.18])
      b.cone(wx[0], wx[1], wx[2], wx[0] + 0.45 * s, wx[1] - 0.18 * s, wx[2] + dz * s, 0.05 * s, 4, P.trim);
  }

  // 尾端扇形尾鳍（收细尾根 + 5 片扇形鳍）
  if (prof.tailFin) {
    const tp = spine(0);
    b.cone(tp[0] + 0.4 * s, tp[1], tp[2], tp[0] - 1.2 * s, tp[1] + 0.2 * s, tp[2], 0.28 * s, 6, P.alt);
    for (let k = -2; k <= 2; k++) {
      const ang = k * 0.28;
      b.tri([tp[0] - 0.9 * s, tp[1], tp[2]],
        [tp[0] - 3.0 * s, tp[1] + Math.sin(ang) * 1.6 * s + 0.4 * s, tp[2] + k * 0.5 * s],
        [tp[0] - 2.6 * s, tp[1] + Math.sin(ang) * 1.6 * s - 0.9 * s, tp[2] + k * 0.6 * s],
        k % 2 ? P.trim : P.alt);
    }
  }
}

// ---- 兽：躯干 + 四腿 + 头 + 尾 ----
function buildBeast(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  b.ellipsoid(0, 1.4 * s, 0, 2.2 * s, 1.0 * s, 1.0 * s, 10, 6, P.main);
  b.ellipsoid(2.4 * s, 1.8 * s, 0, 0.9 * s, 0.75 * s, 0.8 * s, 8, 5, P.alt);
  b.cone(3.0 * s, 1.6 * s, 0, 3.8 * s, 1.5 * s, 0, 0.35 * s, 6, P.main);
  for (const z of [-1, 1])
    b.cone(2.2 * s, 2.4 * s, z * 0.5 * s, 1.9 * s, 3.2 * s, z * 0.8 * s, 0.16 * s, 5, P.trim);
  for (const x of [-1.4, 1.4]) for (const z of [-0.65, 0.65])
    b.cone(x * s, 1.0 * s, z * s, x * s * 1.05, 0.05 * s, z * s * 1.15, 0.3 * s, 7, P.main);
  b.cone(-2.0 * s, 1.5 * s, 0, -3.6 * s, 2.2 * s, 0, 0.28 * s, 6, P.alt);
  for (let i = 0; i < 5; i++)
    b.tri([(-1 + i * 0.6) * s, 2.35 * s, -0.2 * s], [(-0.8 + i * 0.6) * s, 2.35 * s, -0.2 * s], [(-0.9 + i * 0.6) * s, 2.7 * s, 0], P.trim);
}

// ---- 鸟：身 + 双翼 + 尾羽 ----
function buildBird(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  b.ellipsoid(0, 1.6 * s, 0, 1.3 * s, 0.9 * s, 0.9 * s, 10, 6, P.main);
  b.ellipsoid(1.3 * s, 2.3 * s, 0, 0.55 * s, 0.5 * s, 0.5 * s, 8, 4, P.alt);
  b.cone(1.8 * s, 2.25 * s, 0, 2.7 * s, 2.1 * s, 0, 0.18 * s, 5, P.trim);
  for (const z of [-1, 1]) {
    b.tri([0, 1.8 * s, z * 0.5 * s], [-1.6 * s, 2.8 * s, z * 2.8 * s], [1.2 * s, 1.5 * s, z * 3.4 * s], P.main);
    b.tri([1.2 * s, 1.5 * s, z * 3.4 * s], [-1.6 * s, 2.8 * s, z * 2.8 * s], [0.4 * s, 1.2 * s, z * 3.8 * s], P.alt);
    for (let i = 0; i < 4; i++)
      b.tri([(-1.2 + i * 0.6) * s, 1.6 * s, z * 1.2 * s], [(-1.0 + i * 0.6) * s, 1.6 * s, z * 1.2 * s],
        [(-1.1 + i * 0.6) * s, 1.2 * s, z * (3.2 + i * 0.15) * s], i % 2 ? P.trim : P.alt);
  }
  for (let i = -2; i <= 2; i++)
    b.tri([-1.1 * s, 1.6 * s, 0], [-3.2 * s, 1.9 * s + i * 0.12 * s, i * 0.3 * s], [-3.0 * s, 1.2 * s + i * 0.18 * s, i * 0.35 * s], i % 2 ? P.main : P.alt);
  for (const z of [-0.35, 0.35]) b.cone(0, 0.9 * s, z * s, 0, 0.1 * s, z * s, 0.09 * s, 5, P.trim);
}

// ---- 人形 / 神佛：头 + 躯干 + 四肢 + 法器（+ 光环莲台）----
function buildHumanoid(b: Builder, spec: WishSpec, P: Palette, divine: boolean): void {
  const s = clampScale(spec.scale);
  const robe = divine ? P.trim : P.main;
  b.ellipsoid(0, 2.9 * s, 0, 0.5 * s, 0.55 * s, 0.5 * s, 8, 5, P.alt);
  b.box(0, 1.9 * s, 0, 1.1 * s, 1.6 * s, 0.7 * s, robe);
  for (const x of [-1, 1]) b.cone(x * 0.7 * s, 2.5 * s, 0, x * 1.0 * s, 0.9 * s, 0, 0.22 * s, 6, robe);
  for (const x of [-0.35, 0.35]) b.cone(x * s, 1.1 * s, 0, x * s, 0.05 * s, 0, 0.25 * s, 6, P.main);
  b.cone(1.2 * s, 1.0 * s, 0, 1.2 * s, 3.8 * s, 0, 0.09 * s, 6, P.trim);
  b.ellipsoid(1.2 * s, 3.9 * s, 0, 0.25 * s, 0.25 * s, 0.25 * s, 6, 3, P.trim);
  if (divine) {
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2, a2 = ((j + 1) / 12) * Math.PI * 2, r = 1.3 * s;
      b.quad([Math.cos(a) * r, 3.6 * s, Math.sin(a) * r], [Math.cos(a2) * r, 3.6 * s, Math.sin(a2) * r],
        [Math.cos(a2) * r, 3.85 * s, Math.sin(a2) * r], [Math.cos(a) * r, 3.85 * s, Math.sin(a) * r], P.trim);
    }
    b.ellipsoid(0, 0.05 * s, 0, 1.6 * s, 0.22 * s, 1.6 * s, 12, 2, P.alt);
  }
}

// ---- 植物：主干 + 枝叶 + 花果 ----
function buildPlant(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  const trunk = rgb(0x6b4a2f);
  b.cone(0, 0, 0, 0, 3.4 * s, 0, 0.35 * s, 8, trunk);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, y = (1.6 + i * 0.35) * s;
    b.cone(0, y, 0, Math.cos(a) * 1.4 * s, y + 0.8 * s, Math.sin(a) * 1.4 * s, 0.12 * s, 5, trunk);
    b.ellipsoid(Math.cos(a) * 1.5 * s, y + 0.9 * s, Math.sin(a) * 1.5 * s, 0.7 * s, 0.35 * s, 0.7 * s, 8, 3, i % 2 ? P.main : P.alt);
    b.ellipsoid(Math.cos(a) * 1.7 * s, y + 1.0 * s, Math.sin(a) * 1.7 * s, 0.18 * s, 0.18 * s, 0.18 * s, 6, 3, P.trim);
  }
}

// ---- 建筑：台基 + 柱 + 额枋 + 四坡屋顶 + 宝顶 ----
function buildBuilding(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  b.box(0, 0.3 * s, 0, 4.2 * s, 0.6 * s, 4.2 * s, P.alt);
  for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6])
    b.cone(x * s, 0.6 * s, z * s, x * s, 3.0 * s, z * s, 0.22 * s, 8, P.main);
  b.box(0, 3.1 * s, 0, 4.4 * s, 0.25 * s, 4.4 * s, P.alt);
  const e = 2.6 * s, top = 4.0 * s;
  const c0: V3 = [-e, 3.25 * s, -e], c1: V3 = [e, 3.25 * s, -e];
  const c2: V3 = [e, 3.25 * s, e], c3: V3 = [-e, 3.25 * s, e];
  const apex: V3 = [0, top, 0];
  b.tri(c0, c1, apex, P.main); b.tri(c1, c2, apex, P.alt);
  b.tri(c2, c3, apex, P.main); b.tri(c3, c0, apex, P.alt);
  b.quad(c0, c3, c2, c1, P.trim);
  b.cone(0, top, 0, 0, top + 0.8 * s, 0, 0.18 * s, 6, P.trim);
}

// ---- 器物：主体 + 装饰环 + 柄/钮 ----
function buildItem(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  b.ellipsoid(0, 1.0 * s, 0, 0.9 * s, 1.0 * s, 0.9 * s, 10, 6, P.main);
  b.cone(0, 1.9 * s, 0, 0, 2.5 * s, 0, 0.28 * s, 8, P.alt);
  b.ellipsoid(0, 2.55 * s, 0, 0.22 * s, 0.22 * s, 0.22 * s, 6, 3, P.trim);
  for (let j = 0; j < 8; j++) {
    const a = (j / 8) * Math.PI * 2, a2 = ((j + 1) / 8) * Math.PI * 2, r = 0.95 * s;
    b.quad([Math.cos(a) * r, 0.9 * s, Math.sin(a) * r], [Math.cos(a2) * r, 0.9 * s, Math.sin(a2) * r],
      [Math.cos(a2) * r, 1.05 * s, Math.sin(a2) * r], [Math.cos(a) * r, 1.05 * s, Math.sin(a) * r], P.trim);
  }
  for (const z of [-1, 1]) b.cone(0, 1.1 * s, z * 0.85 * s, 0, 1.1 * s, z * 1.5 * s, 0.12 * s, 5, P.alt);
}

// ---- 载具：主体 + 四轮 + 篷/桅 ----
function buildVehicle(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  b.box(0, 0.9 * s, 0, 3.2 * s, 0.9 * s, 1.6 * s, P.main);
  b.box(0, 1.7 * s, 0, 1.8 * s, 0.8 * s, 1.4 * s, P.alt);
  for (const x of [-1.1, 1.1]) for (const z of [-0.9, 0.9])
    b.ellipsoid(x * s, 0.5 * s, z * s, 0.5 * s, 0.5 * s, 0.16 * s, 8, 3, P.trim);
  b.cone(0, 2.1 * s, 0, 0, 3.6 * s, 0, 0.1 * s, 6, P.alt);
  b.tri([0, 3.5 * s, 0], [1.4 * s, 2.4 * s, 0], [0, 2.4 * s, 0], P.main);
}

// ---- 灵体：飘浮多面体 + 环绕碎片 + 尾迹 ----
function buildSpirit(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale);
  b.ellipsoid(0, 1.8 * s, 0, 1.0 * s, 1.2 * s, 1.0 * s, 8, 5, P.main);
  b.ellipsoid(0, 1.8 * s, 0, 1.2 * s, 0.7 * s, 1.2 * s, 8, 3, P.alt);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 1.6 * s, y = 1.8 * s + Math.sin(a * 2) * 0.8 * s, z = Math.sin(a) * 1.6 * s;
    b.ellipsoid(x, y, z, 0.18 * s, 0.18 * s, 0.18 * s, 5, 2, P.trim);
  }
  b.cone(0, 1.0 * s, 0, 0, 0.1 * s, 0, 0.5 * s, 6, P.alt);
}

// ============================================================================
// 八类愿景专用建模：全部并入同一个 Builder → 同一个 bodyMesh（零新增 Mesh / draw call）。
// 只用整数常量与已有几何原语，无 Math.random / 无共享 RNG / 无 h01 抖动。
// 形状语义由 spec.shape 选择，不再退化成通用 spirit / plant / beast 原型。
// ============================================================================

/** 猫：四足小动物（紧凑躯干 + 立耳 + 长尾 + 四肢 + 口鼻 + 双目） */
function buildCat(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale) * 0.62;
  const dark = rgb(0x2a2a35);
  b.ellipsoid(0, 0.95 * s, 0, 1.15 * s, 0.52 * s, 0.52 * s, 10, 6, P.main);      // 躯干
  b.ellipsoid(1.12 * s, 1.28 * s, 0, 0.44 * s, 0.44 * s, 0.44 * s, 8, 5, P.alt); // 头
  b.ellipsoid(1.48 * s, 1.12 * s, 0, 0.26 * s, 0.19 * s, 0.24 * s, 6, 3, P.main); // 口鼻
  for (const z of [-1, 1]) {
    b.cone(1.02 * s, 1.6 * s, z * 0.24 * s, 0.9 * s, 2.08 * s, z * 0.3 * s, 0.15 * s, 4, P.trim); // 立耳
    b.ellipsoid(1.34 * s, 1.38 * s, z * 0.22 * s, 0.085 * s, 0.085 * s, 0.06 * s, 5, 3, dark);    // 眼
  }
  for (const x of [-0.72, 0.72]) for (const z of [-0.34, 0.34])
    b.cone(x * s, 0.62 * s, z * s, x * 1.04 * s, 0.05 * s, z * 1.12 * s, 0.16 * s, 6, P.main);     // 四足
  b.cone(-1.05 * s, 1.12 * s, 0, -1.75 * s, 1.5 * s, 0, 0.13 * s, 5, P.alt);                       // 尾根
  b.cone(-1.75 * s, 1.5 * s, 0, -2.15 * s, 2.02 * s, 0.1 * s, 0.095 * s, 5, P.alt);               // 尾梢
}

/** 皇宫：大尺度宫殿建筑群（大台基 + 主殿重檐 + 两厢配殿 + 前门阙 + 角楼 + 围墙） */
function buildPalace(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale) * 2.3;
  b.box(0, 0.4 * s, 0, 13.5 * s, 0.8 * s, 10 * s, P.alt);                         // 大台基
  const hall = (cx: number, cz: number, w: number, h: number): void => {
    b.box(cx, 0.95 * s, cz, w * s, 0.35 * s, w * 0.66 * s, P.alt);                // 殿基
    for (const x of [-1, 1]) for (const z of [-1, 1])
      b.cone(cx + x * (w * 0.42) * s, 1.1 * s, cz + z * (w * 0.28) * s,
        cx + x * (w * 0.42) * s, (1.1 + h) * s, cz + z * (w * 0.28) * s, 0.18 * s, 6, P.main); // 柱网
    const e = w * 0.62 * s, ty = (1.1 + h) * s + 0.75 * s;
    const c: V3[] = [[cx - e, (1.1 + h) * s, cz - e * 0.66], [cx + e, (1.1 + h) * s, cz - e * 0.66],
      [cx + e, (1.1 + h) * s, cz + e * 0.66], [cx - e, (1.1 + h) * s, cz + e * 0.66]];
    for (let i = 0; i < 4; i++) b.tri(c[i], c[(i + 1) % 4], [cx, ty, cz], i % 2 ? P.alt : P.main); // 四坡顶
    b.cone(cx, ty, cz, cx, ty + 0.55 * s, cz, 0.16 * s, 6, P.trim);               // 宝顶
  };
  hall(0, -1.6, 5.4, 3.5);        // 主殿
  hall(-4.6, 2.2, 2.8, 1.9);      // 东配殿
  hall(4.6, 2.2, 2.8, 1.9);       // 西配殿
  for (const x of [-5.6, 5.6]) for (const z of [-4.2, 4.2])
    b.cone(x * s, 0.8 * s, z * s, x * s, 3.0 * s, z * s, 0.32 * s, 6, P.alt);    // 四角阙楼
  b.box(0, 1.3 * s, 4.6 * s, 2.4 * s, 1.8 * s, 0.5 * s, P.trim);                // 前门阙
  for (const x of [-1, 1]) b.box(x * 6.4 * s, 1.4 * s, 0, 0.35 * s, 2.0 * s, 9.6 * s, P.alt); // 围墙
}

/** 山：地形山体（主峰 + 次峰 + 雪顶 + 山脊棱面，堆叠成山而非楼台） */
function buildMountain(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale) * 2.4;
  const snow = rgb(0xf0f4ff);
  b.cone(0, 0, 0, 0.4 * s, 6.4 * s, 0, 4.6 * s, 12, P.main);                     // 主峰
  b.cone(-3.4 * s, 0.3 * s, 1.4 * s, -3.7 * s, 4.3 * s, 1.4 * s, 2.3 * s, 9, P.alt);  // 左次峰
  b.cone(3.5 * s, 0.2 * s, -1.7 * s, 3.9 * s, 3.5 * s, -1.7 * s, 2.0 * s, 9, P.alt);  // 右次峰
  b.cone(0.4 * s, 5.5 * s, 0, 0.4 * s, 6.6 * s, 0, 1.35 * s, 9, snow);          // 主峰雪顶
  b.cone(-3.7 * s, 3.7 * s, 1.4 * s, -3.7 * s, 4.5 * s, 1.4 * s, 0.72 * s, 8, snow);
  b.cone(3.9 * s, 2.9 * s, -1.7 * s, 3.9 * s, 3.6 * s, -1.7 * s, 0.6 * s, 8, snow);
  for (let i = 0; i < 6; i++) {                                                   // 山脊棱面
    const a = (i / 6) * Math.PI * 2;
    b.tri([0, 0.2 * s, 0], [Math.cos(a) * 4.5 * s, 0.2 * s, Math.sin(a) * 4.5 * s],
      [Math.cos(a + 0.5) * 3.0 * s, 3.2 * s, Math.sin(a + 0.5) * 3.0 * s], i % 2 ? P.alt : P.main);
  }
}

/** 士兵（军队 / 天兵天将单体）：兜鍪 + 铠甲 + 长兵 + 盾；divine 时加背光圆光 */
function buildSoldier(b: Builder, spec: WishSpec, P: Palette, divine: boolean): void {
  const s = clampScale(spec.scale) * 0.92;
  b.ellipsoid(0, 2.72 * s, 0, 0.42 * s, 0.45 * s, 0.42 * s, 8, 5, P.alt);        // 头
  b.cone(0, 3.0 * s, 0, 0, 3.68 * s, 0, 0.32 * s, 7, P.trim);                    // 兜鍪
  b.cone(0, 3.62 * s, 0, 0, 4.25 * s, 0, 0.07 * s, 4, P.trim);                   // 盔缨
  b.box(0, 1.85 * s, 0, 1.15 * s, 1.5 * s, 0.66 * s, P.main);                    // 铠甲
  b.box(0, 1.85 * s, 0.35 * s, 0.78 * s, 0.9 * s, 0.1 * s, P.trim);              // 护心镜
  for (const x of [-1, 1]) b.cone(x * 0.72 * s, 2.4 * s, 0, x * 0.96 * s, 0.95 * s, 0, 0.19 * s, 6, P.main);
  for (const x of [-0.3, 0.3]) b.cone(x * s, 1.1 * s, 0, x * s, 0.05 * s, 0, 0.24 * s, 6, P.alt);
  b.cone(1.12 * s, 0.55 * s, 0, 1.12 * s, 4.3 * s, 0, 0.06 * s, 5, P.trim);     // 长兵杆
  b.cone(1.12 * s, 4.3 * s, 0, 1.12 * s, 4.75 * s, 0, 0.15 * s, 5, P.alt);      // 兵刃
  b.box(-1.0 * s, 1.7 * s, 0.3 * s, 0.12 * s, 1.0 * s, 0.78 * s, P.alt);        // 盾
  if (divine) for (let j = 0; j < 12; j++) {                                       // 天将背光
    const a = (j / 12) * Math.PI * 2, a2 = ((j + 1) / 12) * Math.PI * 2, r = 1.35 * s;
    b.quad([Math.cos(a) * r, 3.6 * s, Math.sin(a) * r], [Math.cos(a2) * r, 3.6 * s, Math.sin(a2) * r],
      [Math.cos(a2) * r, 3.85 * s, Math.sin(a2) * r], [Math.cos(a) * r, 3.85 * s, Math.sin(a) * r], P.trim);
  }
}

/** 特斯拉汽车：现代轿车（低车身 + 车舱玻璃 + 四轮 + 前后灯 + 侧窗） */
function buildCar(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale) * 1.15;
  const glass = rgb(0x2b3a4a), lamp = rgb(0xffe9a8), tail = rgb(0xc23127), tyre = rgb(0x1b1b20);
  b.box(0, 0.78 * s, 0, 4.5 * s, 0.72 * s, 1.95 * s, P.main);                    // 车身
  b.box(0.1 * s, 1.18 * s, 0, 4.1 * s, 0.16 * s, 1.86 * s, P.alt);              // 引擎盖/行李厢线
  b.box(-0.15 * s, 1.58 * s, 0, 2.2 * s, 0.66 * s, 1.62 * s, glass);            // 车舱玻璃
  b.box(-0.15 * s, 1.58 * s, 0.82 * s, 2.0 * s, 0.46 * s, 0.05 * s, glass);     // 侧窗
  b.box(-0.15 * s, 1.58 * s, -0.82 * s, 2.0 * s, 0.46 * s, 0.05 * s, glass);
  for (const x of [-1.45, 1.45]) for (const z of [-1.02, 1.02])
    b.ellipsoid(x * s, 0.52 * s, z * s, 0.5 * s, 0.5 * s, 0.18 * s, 10, 4, tyre); // 四轮
  for (const z of [-0.62, 0.62]) {
    b.box(2.24 * s, 0.95 * s, z * s, 0.1 * s, 0.22 * s, 0.36 * s, lamp);        // 前灯
    b.box(-2.24 * s, 0.95 * s, z * s, 0.1 * s, 0.2 * s, 0.3 * s, tail);         // 尾灯
  }
  b.box(2.1 * s, 0.7 * s, 0, 0.12 * s, 0.16 * s, 1.2 * s, P.trim);              // 前格栅
}

/** 宇宙飞船：带翼飞行器（梭形机身 + 座舱 + 三角翼 + 垂尾 + 尾部推进器与尾焰） */
function buildSpaceship(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale) * 1.25;
  const glass = rgb(0x2b3a4a), flame = rgb(0x66ccff), engine = rgb(0x555a66);
  b.ellipsoid(0, 1.6 * s, 0, 2.6 * s, 0.62 * s, 0.72 * s, 12, 6, P.main);       // 梭形机身
  b.cone(2.4 * s, 1.6 * s, 0, 3.7 * s, 1.6 * s, 0, 0.62 * s, 8, P.alt);        // 机首锥
  b.ellipsoid(1.2 * s, 2.08 * s, 0, 0.82 * s, 0.34 * s, 0.5 * s, 8, 4, glass); // 座舱盖
  for (const z of [-1, 1]) {
    b.tri([0.6 * s, 1.6 * s, z * 0.5 * s], [-1.9 * s, 1.45 * s, z * 3.2 * s],
      [-2.25 * s, 1.45 * s, z * 0.6 * s], P.alt);                                // 三角主翼
    b.tri([-1.9 * s, 1.45 * s, z * 3.2 * s], [-2.25 * s, 1.45 * s, z * 0.6 * s],
      [-2.5 * s, 1.45 * s, z * 2.2 * s], P.main);
  }
  b.tri([-2.0 * s, 1.6 * s, 0], [-2.85 * s, 3.05 * s, 0], [-2.85 * s, 1.6 * s, 0], P.main); // 垂尾
  for (const z of [-0.62, 0.62]) {
    b.cone(-2.4 * s, 1.55 * s, z * s, -3.05 * s, 1.55 * s, z * s, 0.36 * s, 8, engine);   // 推进器
    b.cone(-3.05 * s, 1.55 * s, z * s, -3.65 * s, 1.55 * s, z * s, 0.24 * s, 8, flame);   // 尾焰
  }
}

/** 外星人：类人异形生物（巨大头颅 + 杏核大眼 + 细长躯干四肢 + 触角） */
function buildAlien(b: Builder, spec: WishSpec, P: Palette): void {
  const s = clampScale(spec.scale) * 1.0;
  const eye = rgb(0x14161f);
  b.ellipsoid(0, 3.05 * s, 0, 0.78 * s, 0.88 * s, 0.66 * s, 10, 6, P.alt);      // 巨大头颅
  b.ellipsoid(0, 2.82 * s, 0.34 * s, 0.5 * s, 0.4 * s, 0.4 * s, 8, 4, P.main);  // 面部
  for (const z of [-1, 1]) b.ellipsoid(0.34 * s, 2.96 * s, z * 0.33 * s, 0.24 * s, 0.13 * s, 0.16 * s, 7, 4, eye); // 大眼
  b.cone(0, 2.3 * s, 0, 0, 1.0 * s, 0, 0.46 * s, 8, P.main);                    // 细长躯干
  for (const x of [-1, 1]) b.cone(x * 0.45 * s, 2.2 * s, 0, x * 0.92 * s, 0.9 * s, 0, 0.1 * s, 6, P.alt);  // 长臂
  for (const x of [-0.26, 0.26]) b.cone(x * s, 1.0 * s, 0, x * 1.3 * s, 0.05 * s, 0, 0.14 * s, 6, P.alt);   // 长腿
  for (const z of [-1, 1]) b.cone(0, 3.8 * s, z * 0.2 * s, 0, 4.45 * s, z * 0.36 * s, 0.045 * s, 4, P.trim); // 触角
  b.ellipsoid(0, 4.45 * s, 0.36 * s, 0.09 * s, 0.09 * s, 0.09 * s, 5, 3, P.trim);
  b.ellipsoid(0, 4.45 * s, -0.36 * s, 0.09 * s, 0.09 * s, 0.09 * s, 5, 3, P.trim);
}

const SEMANTIC_BUILDER: Record<WishShape, (b: Builder, sp: WishSpec, P: Palette) => void> = {
  cat: (b, sp, P) => buildCat(b, sp, P),
  palace: (b, sp, P) => buildPalace(b, sp, P),
  mountain: (b, sp, P) => buildMountain(b, sp, P),
  army: (b, sp, P) => buildSoldier(b, sp, P, false),
  battalion: (b, sp, P) => buildSoldier(b, sp, P, true),
  car: (b, sp, P) => buildCar(b, sp, P),
  spaceship: (b, sp, P) => buildSpaceship(b, sp, P),
  alien: (b, sp, P) => buildAlien(b, sp, P),
};

/** 语义部件清单（验收/自测用，证明不退化成通用 spirit/plant 原型） */
const SEMANTIC_PARTS: Record<WishShape, string[]> = {
  cat: ['四足小动物·躯干', '头/立耳/口鼻/双目', '四足', '长尾'],
  palace: ['大尺度台基', '主殿重檐四坡顶', '两厢配殿', '前门阙', '四角阙楼', '围墙'],
  mountain: ['地形主峰', '左右次峰', '雪顶', '山脊棱面'],
  army: ['士兵·兜鍪', '铠甲/护心镜', '长兵', '盾'],
  battalion: ['天将·兜鍪', '铠甲/护心镜', '长兵', '盾', '背光圆光'],
  car: ['现代轿车车身', '车舱玻璃/侧窗', '四轮', '前灯/尾灯/格栅'],
  spaceship: ['梭形机身/机首', '座舱盖', '三角主翼', '垂尾', '推进器/尾焰'],
  alien: ['类人异形·巨颅', '杏核大眼', '细长躯干/四肢', '触角'],
};

/** 复数愿望：返回「实体列表」（旧 forge 只返回单实体，此扩展保持 forge 签名不变）。
 *  每个实体用整数 hash 派生独立 seed，确定性、不消耗共享 RNG；返回独立 Group，
 *  使每件仍可各自进化 / 行为 / 浮标，不与 InstancedMesh 世界循环冲突。 */
export function forgeMany(spec: WishSpec, count: number, opts: ForgeOptions = {}): ForgeResult[] {
  const n = Math.max(1, Math.min(64, Math.floor(Number.isFinite(count) ? count : 1)));
  const out: ForgeResult[] = [];
  for (let i = 0; i < n; i++) {
    const seeded: WishSpec = { ...spec, seed: (spec.seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0 };
    out.push(forge(seeded, opts));
  }
  return out;
}

// ---- 阶位通用实体附加：祥云 + 额外灵肢（都并入主 mesh，确定性） ----
function addStageBodyParts(b: Builder, s: number, P: Palette, prof: StageProfile): void {
  for (let i = 0; i < prof.clouds; i++) {
    const a = (i / Math.max(1, prof.clouds)) * Math.PI * 2;
    const cx = Math.cos(a) * 3.2 * s, cz = Math.sin(a) * 3.2 * s, cy = 0.6 * s + (i % 2) * 0.4 * s;
    for (let j = 0; j < 3; j++)
      b.ellipsoid(cx + (j - 1) * 0.5 * s, cy + (j % 2) * 0.2 * s, cz, 0.7 * s, 0.3 * s, 0.5 * s, 7, 3, P.trim);
  }
  for (let i = 0; i < prof.extraLimbs; i++) {
    const a = (i / Math.max(1, prof.extraLimbs)) * Math.PI * 2 + 0.3;
    const bx = Math.cos(a) * 3.0 * s, bz = Math.sin(a) * 3.0 * s;
    b.cone(bx, 1.8 * s, bz, bx + Math.cos(a) * 1.2 * s, 1.8 * s + (0.8 + 0.2 * i) * s, bz + Math.sin(a) * 1.2 * s, 0.12 * s, 5, P.trim);
  }
}

/** 把 Builder 转成 BufferGeometry（position/normal/color/index 全量） */
function geometryFromBuilder(b: Builder): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setIndex(b.idx);
  geo.computeBoundingSphere();
  return geo;
}

/** 卵：半透明光茧蛋壳包住本体（独立 Mesh，能透出壳内龙形） */
function buildShell(s: number): THREE.Mesh {
  const b = new Builder();
  const C = rgb(0xffe9a8);
  const L = 14 * s;
  b.ellipsoid(0, 1.7 * s, 0, L * 0.5, 2.5 * s, 1.9 * s, 14, 10, C);
  // 三道茧丝光环，强化「光茧」轮廓
  for (let k = 0; k < 3; k++) {
    const y = (0.7 + k * 1.0) * s, r = (1.4 - Math.abs(k - 1) * 0.35) * s;
    const seg = 16;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      b.quad([Math.cos(a0) * L * 0.46, y, Math.sin(a0) * r], [Math.cos(a1) * L * 0.46, y, Math.sin(a1) * r],
        [Math.cos(a1) * L * 0.49, y, Math.sin(a1) * r * 1.05], [Math.cos(a0) * L * 0.49, y, Math.sin(a0) * r * 1.05], C);
    }
  }
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd25e, transparent: true, opacity: 0.26, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geometryFromBuilder(b), mat);
  m.name = 'wish-shell';
  return m;
}

/** 灵体/神体：发光光环（水平环带，additive）；环数 / 半径由 haloRings / aura 决定 */
function buildHalos(s: number, prof: StageProfile): THREE.Mesh {
  const b = new Builder();
  const C = rgb(0xffe9a8);
  for (let k = 0; k < prof.haloRings; k++) {
    const y = (1.8 + k * 0.9) * s;
    const r = (2.6 + 0.5 * k + prof.aura * 0.6) * s;
    const seg = 24;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      const inner = r - 0.16 * s, outer = r + 0.16 * s;
      b.quad([Math.cos(a0) * inner, y, Math.sin(a0) * inner], [Math.cos(a1) * inner, y, Math.sin(a1) * inner],
        [Math.cos(a1) * outer, y, Math.sin(a1) * outer], [Math.cos(a0) * outer, y, Math.sin(a0) * outer], C);
    }
  }
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd25e, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geometryFromBuilder(b), mat);
  m.name = 'wish-halo';
  return m;
}

/** 运行时锻造：主 mesh(children[0]) = 本体 + 通用阶位附加；其后可挂半透明装饰 mesh */
export function forge(spec: WishSpec, opts: ForgeOptions = {}): ForgeResult {
  // 三种入口统一：forge(spec,{stage}) / forge({...spec,stage}) / forge(spec) 默认成体
  const stage: Stage = opts.stage ?? spec.stage ?? '成体';
  const prof = profileFor(stage, opts.form);
  // 把 bodyScale 折进 spec.scale：卵缩小、成体原尺寸、神体略大；龙额外封顶避免超长占街
  const scaled: WishSpec = {
    ...spec,
    scale: spec.archetype === 'dragon'
      ? Math.min(clampScale(spec.scale) * prof.bodyScale, 1.05)
      : clampScale(spec.scale) * prof.bodyScale,
  };
  const s = clampScale(scaled.scale);
  const P = palette(scaled);
  const b = new Builder();
  const shape = scaled.shape;
  if (shape && SEMANTIC_BUILDER[shape]) {
    // 八类愿景：专用语义建模，绝不退化成通用 spirit / plant / beast 原型
    SEMANTIC_BUILDER[shape](b, scaled, P);
  } else {
    switch (scaled.archetype) {
      case 'dragon': buildDragon(b, scaled, P, prof); break;
      case 'beast': buildBeast(b, scaled, P); break;
      case 'bird': buildBird(b, scaled, P); break;
      case 'humanoid': buildHumanoid(b, scaled, P, false); break;
      case 'deity': buildHumanoid(b, scaled, P, true); break;
      case 'plant': buildPlant(b, scaled, P); break;
      case 'building': buildBuilding(b, scaled, P); break;
      case 'item': buildItem(b, scaled, P); break;
      case 'vehicle': buildVehicle(b, scaled, P); break;
      case 'spirit': buildSpirit(b, scaled, P); break;
      default: buildBeast(b, scaled, P); break;
    }
  }
  addStageBodyParts(b, s, P, prof);
  // R26 全量模型精细化：仅对「旧 10 类」叠加中国审美部件；带 shape 的现代/异形/地形
  // 资产不再套飞檐斗拱，保持语义干净（仍零新增 Mesh，面数受装饰层硬预算约束）。
  const ornament = shape ? null : addChineseOrnaments(b, scaled, stage);

  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // glow 读进几何：灵体/神体整体 emissive 增强
  if (prof.glow > 0.5) {
    bodyMat.emissive = new THREE.Color(P.trim.r * 0.5, P.trim.g * 0.5, P.trim.b * 0.5);
    bodyMat.emissiveIntensity = Math.min(1.2, prof.glow * 0.7);
  }
  const bodyMesh = new THREE.Mesh(geometryFromBuilder(b), bodyMat);
  bodyMesh.name = 'wish-body-' + spec.name;
  const group = new THREE.Group();
  group.name = 'wish-group-' + spec.name + '-' + stage;
  group.add(bodyMesh); // children[0] 恒为本体，forgeBytes 逐字节比对不受装饰影响

  const parts: string[] = ['本体', ...(ornament ? ornament.parts.map((p) => '精修·' + p) : [])];
  if (shape && SEMANTIC_PARTS[shape]) parts.push(...SEMANTIC_PARTS[shape]);
  if (scaled.archetype === 'dragon' && !shape) {
    parts.push(`连续渐变躯干×${prof.rings}段`);
    parts.push('吻部/凸眼');
    if (prof.horns) parts.push(prof.horns === 2 ? '分叉鹿角×2' : '短角×2');
    if (prof.whiskers) parts.push('飘须×2');
    if (prof.clawPairs) parts.push(`关节爪×${prof.clawPairs * 2}`);
    if (prof.dorsal) parts.push('连续背鳍带');
    if (prof.tailFin) parts.push('扇形尾鳍');
  }

  const decor: THREE.Mesh[] = [];
  if (prof.shell) { decor.push(buildShell(s)); parts.push('半透明光茧蛋壳'); }
  if (prof.haloRings > 0) { decor.push(buildHalos(s, prof)); parts.push(`发光光环×${prof.haloRings}`); }
  for (const m of decor) group.add(m);
  if (prof.clouds > 0) parts.push(`祥云×${prof.clouds}`);
  if (prof.extraLimbs > 0) parts.push(`额外灵肢×${prof.extraLimbs}`);

  let tris = b.tris;
  for (const m of decor) tris += (m.geometry.getIndex()?.count ?? 0) / 3;
  const bounds = new THREE.Box3().setFromObject(group);
  return { group, tris, bounds, parts };
}

/** 顶点数据原始字节（确定性验收用；不依赖 WebGL）。opts 可带 stage 验证各阶确定性 */
export function forgeBytes(spec: WishSpec, opts: ForgeOptions = {}): Uint8Array {
  const r = forge(spec, opts);
  const mesh = r.group.children[0] as THREE.Mesh;
  const arr = mesh.geometry.getAttribute('position').array as Float32Array;
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
