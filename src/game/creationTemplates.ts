// ============================================================================
// 造物模板库（S10/S11 · H3 路线「agent coding 造物」的程序化资产端）
//
// 每模板 = 参数化放样（确定性：mulberry32(seed)），产出 positions/normals/colors/indices。
// 预算纪律（H3）：单模板 ≤20,000 tri / 包围盒 ≤200m；超限在源头裁细节。
// ============================================================================
import * as THREE from 'three';

export interface VGeo {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  tris: number;
  maxEdge: number;
}

interface RGB { r: number; g: number; b: number }
function shade(hex: number, k: number): RGB {
  return {
    r: Math.min(1, ((hex >> 16) & 255) / 255 * k),
    g: Math.min(1, ((hex >> 8) & 255) / 255 * k),
    b: Math.min(1, (hex & 255) / 255 * k),
  };
}

class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  ring(cx: number, cy: number, cz: number, r: number, seg: number, squash = 1): number {
    const base = this.pos.length / 3;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      this.pos.push(cx, cy + r * Math.cos(a), cz + r * Math.sin(a) * squash);
    }
    return base;
  }
  stitch(b0: number, b1: number, seg: number): void {
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      this.idx.push(b0 + j, b0 + j2, b1 + j, b0 + j2, b1 + j2, b1 + j);
    }
  }
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, color: number, k = 1): void {
    const base = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const c = shade(color, k);
    for (let i = 0; i < 3; i++) { this.nor.push(0, 1, 0); this.col.push(c.r, c.g, c.b); }
    this.idx.push(base, base + 1, base + 2);
  }
  skull(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number): void {
    const b = this.pos.length / 3;
    const c = shade(color, 1);
    const v = [
      [cx - sx, cy, cz], [cx + sx * 1.6, cy + sy * 0.25, cz],
      [cx, cy + sy, cz - sz * 0.6], [cx, cy + sy, cz + sz * 0.6],
      [cx, cy - sy * 0.9, cz - sz], [cx, cy - sy * 0.9, cz + sz],
    ];
    for (const p of v) this.pos.push(p[0], p[1], p[2]);
    const F = [[0,2,4],[0,4,5],[0,5,3],[0,3,2],[1,3,5],[1,4,3],[1,5,2],[1,2,4]];
    for (const f of F) {
      for (const vi of f) { this.nor.push(0, 1, 0); this.col.push(c.r, c.g, c.b); }
      this.idx.push(b + f[0], b + f[1], b + f[2]);
    }
  }
  cone(bx: number, by: number, bz: number, tx: number, ty: number, tz: number, r0: number, seg: number, color: number, k = 1): void {
    const b = this.pos.length / 3;
    const c = shade(color, k);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      this.pos.push(bx + r0 * Math.cos(a), by, bz + r0 * Math.sin(a));
      this.nor.push(0, 1, 0); this.col.push(c.r, c.g, c.b);
    }
    this.pos.push(tx, ty, tz);
    this.nor.push(0, 1, 0); this.col.push(c.r, c.g, c.b);
    const tip = b + seg;
    for (let j = 0; j < seg; j++) this.idx.push(b + j, b + ((j + 1) % seg), tip);
  }
  finish(): VGeo {
    return { positions: this.pos, normals: this.nor, colors: this.col, indices: this.idx, tris: this.idx.length / 3, maxEdge: 0 };
  }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 通用兽体放样（蛇形/纺锤共用） ----
function serpent(g: GeoBuilder, L: number, amp: number, waves: number, rHead: number, rTail: number, rings: number, seg: number): number {
  const radiusAt = (t: number) => rTail + (rHead - rTail) * Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5), 0.8);
  const spineY = (t: number) => amp * Math.sin(t * Math.PI * 2 * waves) * (0.35 + 0.65 * t);
  let prev = -1;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = radiusAt(t) * (i === 0 || i === rings ? 0.55 : 1);
    prev = g.ring(t * L, spineY(t), 0, r, seg, 0.92);
    if (i > 0) g.stitch(prev - seg, prev, seg);
  }
  return Math.round(spineY(1) * 100) / 100;
}

// ---- 龙 ----
function buildDragon(g: GeoBuilder): void {
  const GOLD = 0xd4af37, JADE = 0x4fa8a0, RED = 0xa8503c;
  const L = 40, R_HEAD = 1.9, R_TAIL = 0.16, AMP = 3.2, WAVES = 1.75, RINGS = 44, SEG = 10;
  const radiusAt = (t: number) => R_TAIL + (R_HEAD - R_TAIL) * Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5), 0.8);
  const spineY = (t: number) => AMP * Math.sin(t * Math.PI * 2 * WAVES) * (0.35 + 0.65 * t);
  let prev = -1;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const r = radiusAt(t) * (i === 0 || i === RINGS ? 0.55 : 1);
    prev = g.ring(t * L, spineY(t), 0, r, SEG, 0.92);
    if (i > 0) g.stitch(prev - SEG, prev, SEG);
  }
  const yH = spineY(1), xH = L + 0.4;
  g.skull(xH + 2.2, yH + 0.5, 0, 2.4, 1.1, 1.15, GOLD);
  g.skull(xH + 1.2, yH - 0.9, 0, 1.5, 0.55, 0.8, RED);
  for (const s of [-1, 1]) {
    g.cone(xH - 0.6, yH + 1.2, s * 0.75, xH - 3.7, yH + 3.5, s * 2.1, 0.34, 6, GOLD, 1.1);
    g.cone(xH + 0.6, yH + 0.8, s * 0.95, xH + 0.6, yH + 0.8, s * 1.15, 0.3, 5, JADE, 1.2);
  }
  for (let i = 1; i <= 16; i++) {
    const t = 0.12 + (i / 17) * 0.8;
    const x = t * L, y = spineY(t) + radiusAt(t) * 0.92, h = 0.55 + 0.5 * Math.sin(t * Math.PI);
    g.tri(x - 0.5, y, 0, x + 0.5, y, 0, x, y + h, 0, GOLD, 1.15);
    g.tri(x + 0.5, y, 0, x - 0.5, y, 0, x, y + h, 0, RED, 0.8);
  }
  for (const t of [0.24, 0.36, 0.62, 0.74]) {
    for (const s of [-1, 1]) {
      const x = t * L, y0 = spineY(t) - radiusAt(t) * 0.55;
      g.cone(x, y0, s * 0.6, x - 0.2, y0 - 1.6, s * 1.2, 0.3, 6, RED, 0.9);
    }
  }
}

// ---- 凤凰 ----
function buildPhoenix(g: GeoBuilder): void {
  const GOLD = 0xd4af37, RED = 0xc25a42, JADE = 0x4fa8a0;
  let prev = -1; const SEG = 10, RINGS = 12;
  const bodyY = (t: number) => 6 + t * 3;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const r = Math.max(0.2, 1.4 * Math.sin(t * Math.PI));
    prev = g.ring(Math.sin(t * 1.2) * 1.5, bodyY(t), 0, r, SEG, 0.8);
    if (i > 0) g.stitch(prev - SEG, prev, SEG);
  }
  let pv = -1;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pv = g.ring(Math.sin(t * 0.8) * 0.4, bodyY(1) + t * 4, 0, Math.max(0.15, 0.45 - t * 0.15), 8, 1);
    if (i > 0) g.stitch(pv - 8, pv, 8);
  }
  g.skull(0.4, bodyY(1) + 4.6, 0, 0.7, 0.5, 0.45, GOLD);
  g.cone(0.4, bodyY(1) + 5.2, 0, 0.4, bodyY(1) + 6.4, 0, 0.2, 5, RED, 1.2);
  for (let i = 0; i < 9; i++) {
    const a = -0.7 + (i / 8) * 1.4;
    const tx = Math.sin(a) * 9, tz = Math.cos(a) * 3 - 9;
    g.tri(-0.6, bodyY(0) + 1, -1.5, 0.6, bodyY(0) + 1, -1.5, tx, bodyY(0) + 1 + Math.abs(a), tz, i % 2 ? GOLD : RED, 1.1);
    g.tri(0.6, bodyY(0) + 1, -1.5, tx, bodyY(0) + 1 + Math.abs(a), tz, tx, bodyY(0) + 0.4, tz * 1.1, JADE, 0.9);
  }
  for (const s of [-1, 1]) {
    g.tri(s * 1.2, bodyY(0.55), 0, s * 8, bodyY(0.75) + 2.5, 1.5, s * 7, bodyY(0.45), 2.2, RED, 1.05);
    g.tri(s * 1.2, bodyY(0.55), 0, s * 7, bodyY(0.45), 2.2, s * 5.5, bodyY(0.3), 2.6, GOLD, 1.0);
  }
  for (const s of [-1, 1]) g.cone(s * 0.5, bodyY(0.15), 0.3, s * 0.6, bodyY(0.15) - 2.2, 0.5, 0.18, 5, GOLD, 0.9);
}

// ---- 玄龟 ----
function buildTurtle(g: GeoBuilder): void {
  const JADE = 0x2f6f5f, GOLD = 0xd4af37;
  let prev = -1; const SEG = 12, RINGS = 8;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const r = Math.max(0.4, 9 * Math.sin(t * Math.PI * 0.62));
    prev = g.ring(0, t * 6, 0, r, SEG, 1);
    if (i > 0) g.stitch(prev - SEG, prev, SEG);
  }
  for (let i = 1; i < RINGS; i += 2) {
    for (let j = 0; j < SEG; j += 2) {
      const a = (j / SEG) * Math.PI * 2, r = 9 * Math.sin((i / RINGS) * Math.PI * 0.62);
      g.cone(Math.cos(a) * r * 0.9, (i / RINGS) * 6 + 0.15, Math.sin(a) * r * 0.9, Math.cos(a) * r * 0.9, (i / RINGS) * 6 + 0.5, Math.sin(a) * r * 0.9, 0.5, 5, GOLD, 1.2);
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.cone(sx * 6, 0.5, sz * 6, sx * 6.6, -2.2, sz * 6.6, 1.4, 8, JADE, 0.9);
  }
  g.cone(10.5, 2.5, 0, 14, 3, 0, 1.8, 8, JADE, 1.0);
  g.cone(-10, 1.2, 0, -12.5, 1.6, 0, 1.0, 6, JADE, 0.9);
}

// ---- 仙鹤 ----
function buildCrane(g: GeoBuilder): void {
  const WHITE = 0xf0ead8, RED = 0xc25a42, BLACK = 0x2a2a35;
  let prev = -1;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prev = g.ring(-2 + t * 5, 7 + Math.sin(t * Math.PI) * 0.6, 0, 0.8 * Math.sin(t * Math.PI) + 0.2, 8, 0.85);
    if (i > 0) g.stitch(prev - 8, prev, 8);
  }
  let pv = -1;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pv = g.ring(3 + t * 1.6, 7.4 + t * 3.2, Math.sin(t * Math.PI) * 0.5, 0.22, 6, 1);
    if (i > 0) g.stitch(pv - 6, pv, 6);
  }
  g.skull(4.8, 10.8, 0, 0.5, 0.35, 0.3, WHITE);
  g.cone(5.2, 10.9, 0, 6.2, 10.7, 0, 0.1, 5, RED, 1.3);
  for (const s of [-1, 1]) {
    g.tri(-1, 7.4, 0, -1, 7.4, s * 2.4, 2.5, 8.2, s * 3.2, BLACK, 0.9);
    g.tri(-1, 7.4, s * 2.4, 2.5, 8.2, s * 3.2, 1.5, 7.6, s * 4.2, WHITE, 1.0);
  }
  for (const s of [-0.4, 0.4]) g.cone(-1.5, 6.6, s, 3.5, 0.2, s, 0.1, 5, RED, 1.0);
}

// ---- 锦鲤 ----
function buildFish(g: GeoBuilder): void {
  const CYAN = 0x3a8ab8, GOLD = 0xd4af37;
  let prev = -1; const SEG = 10, RINGS = 14;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    prev = g.ring(t * 8, 4 + Math.sin(t * Math.PI * 2) * 0.4, 0, Math.max(0.15, 1.6 * Math.sin(t * Math.PI)), SEG, 0.6);
    if (i > 0) g.stitch(prev - SEG, prev, SEG);
  }
  g.tri(8, 4, 0, 11, 5.5, 0.8, 11, 2.5, -0.8, GOLD, 1.1);
  g.tri(8, 4, 0, 11, 2.5, 0.8, 11, 5.5, -0.8, CYAN, 1.0);
  for (let i = 1; i < 6; i++) {
    const x = i * 1.2, y = 4 + Math.sin((x / 8) * Math.PI) * 1.55;
    g.tri(x - 0.4, y, 0, x + 0.4, y, 0, x, y + 0.9, 0, GOLD, 1.0);
  }
}

// ---- 白虎 ----
function buildTiger(g: GeoBuilder): void {
  const ORANGE = 0xd07a30, BLACK = 0x222222;
  let prev = -1;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prev = g.ring(t * 6, 2.2 + Math.sin(t * Math.PI) * 0.3, 0, 1.5, 10, 0.9);
    if (i > 0) g.stitch(prev - 10, prev, 10);
  }
  g.skull(7.2, 2.8, 0, 1.3, 1.0, 1.1, ORANGE);
  g.cone(6.6, 3.6, 0.5, 6.2, 4.3, 0.55, 0.12, 4, ORANGE, 0.9);
  g.cone(6.6, 3.6, -0.5, 6.2, 4.3, -0.55, 0.12, 4, ORANGE, 0.9);
  for (const [lx, lz] of [[5.4, -0.7], [5.4, 0.7], [1.2, -0.7], [1.2, 0.7]] as const) {
    g.cone(lx, 1.8, lz, lx, -0.1, lz, 0.42, 8, ORANGE, 0.95);
  }
  for (let i = 0; i < 6; i++) {
    const x = 1 + i * 0.9;
    g.tri(x, 3.1, -1.45, x + 0.25, 3.1, -1.45, x + 0.12, 1.6, -1.45, BLACK, 1);
    g.tri(x, 3.1, 1.45, x + 0.25, 3.1, 1.45, x + 0.12, 1.6, 1.45, BLACK, 1);
  }
  let pv = -1;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pv = g.ring(-0.5 - t * 3, 2.6 + Math.sin(t * Math.PI) * 0.8, Math.sin(t * 5) * 0.3, Math.max(0.08, 0.22 - t * 0.1), 6, 1);
    if (i > 0) g.stitch(pv - 6, pv, 6);
  }
}

// ---- 麒麟 ----
function buildQilin(g: GeoBuilder): void {
  const JADE = 0x4fa8a0, GOLD = 0xd4af37;
  let prev = -1;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prev = g.ring(t * 7, 2.4 + Math.sin(t * Math.PI) * 0.4, 0, 1.5, 10, 0.9);
    if (i > 0) g.stitch(prev - 10, prev, 10);
  }
  g.skull(8.6, 3.4, 0, 1.4, 1.0, 1.1, JADE);
  for (const s of [-1, 1]) g.cone(8.2, 4.3, s * 0.5, 7.6, 5.6, s * 0.9, 0.15, 5, GOLD, 1.2);
  for (let i = 0; i < 7; i++) {
    const x = 1 + i * 0.9;
    g.cone(x, 3.9, 0, x + 0.3, 4.5, 0, 0.22, 5, GOLD, 1.1);
  }
  for (const [lx, lz] of [[6.4, -0.8], [6.4, 0.8], [1.4, -0.8], [1.4, 0.8]] as const) {
    g.cone(lx, 1.9, lz, lx, -0.1, lz, 0.45, 8, JADE, 0.95);
  }
  for (const dz of [-0.3, 0, 0.3]) {
    g.tri(-0.5, 3.2, dz, -4, 4 + Math.abs(dz) * 2, dz * 2.2, -4, 2 + dz, dz * 2.2, GOLD, 1.1);
  }
}

// ---- 七级浮屠 ----
function buildPagoda(g: GeoBuilder): void {
  const WALL = 0xa8503c, ROOF = 0x2a4a5a, GOLD = 0xd4af37;
  let y = 0;
  for (let sIdx = 0; sIdx < 7; sIdx++) {
    const w = Math.max(1.2, 6 - sIdx * 0.55);
    const b0 = g.ring(-w / 2, y, -w / 2, 0.01, 4, 1);
    const b1 = g.ring(-w / 2, y + 3.2, -w / 2, 0.01, 4, 1);
    g.stitch(b0, b1, 4);
    const e = w / 2 + 1.1;
    g.tri(-e, y + 3.2, -e, e, y + 3.2, -e, e, y + 3.35, e, ROOF, 1);
    g.tri(-e, y + 3.2, -e, e, y + 3.35, e, -e, y + 3.35, e, ROOF, 0.85);
    g.tri(e, y + 3.2, e, e, y + 3.2, -e, -e, y + 3.2, -e, ROOF, 0.9);
    y += 3.6;
  }
  g.cone(0, y, 0, 0, y + 2.4, 0, 0.5, 6, GOLD, 1.2);
}

// ---- 注册表 ----
export interface CreationTemplate {
  id: string;
  names: string[];
  name: string;
  lore: string;
  scale: number;
  build: (g: GeoBuilder) => void;
  tris: number;
}

function measure(build: (g: GeoBuilder) => void): { tris: number } {
  const g = new GeoBuilder();
  build(g);
  return { tris: g.idx.length / 3 };
}

const def = (t: Omit<CreationTemplate, 'tris'>): CreationTemplate => ({ ...t, ...measure(t.build) });

export const CREATION_TEMPLATES: CreationTemplate[] = [
  def({ id: 'dragon', names: ['龙', '神龙', '赤龙', '青龙', '金龙'], name: '神龙', lore: '蛇身鳞甲，吞云吐雾', scale: 1.0, build: buildDragon }),
  def({ id: 'phoenix', names: ['凤', '凤凰', '朱雀'], name: '凤凰', lore: '浴火重生，百鸟朝凤', scale: 0.9, build: buildPhoenix }),
  def({ id: 'turtle', names: ['龟', '玄龟', '玄武'], name: '玄龟', lore: '甲上金纹，驮山负海', scale: 0.8, build: buildTurtle }),
  def({ id: 'crane', names: ['鹤', '仙鹤', '白鹤'], name: '仙鹤', lore: '丹顶雪羽，骑之上九天', scale: 0.7, build: buildCrane }),
  def({ id: 'fish', names: ['鱼', '锦鲤', '鲤鱼'], name: '锦鲤', lore: '金鳞跃浪，好运随身', scale: 0.6, build: buildFish }),
  def({ id: 'tiger', names: ['虎', '老虎', '白虎'], name: '白虎', lore: '啸震山林，百兽之王', scale: 0.7, build: buildTiger }),
  def({ id: 'qilin', names: ['麒麟'], name: '麒麟', lore: '仁兽现世，盛世之兆', scale: 0.8, build: buildQilin }),
  def({ id: 'pagoda', names: ['塔', '宝塔', '浮屠'], name: '七级浮屠', lore: '七级浮屠，镇一方平安', scale: 1.2, build: buildPagoda }),
];

export function matchTemplate(text: string): CreationTemplate | null {
  for (const t of CREATION_TEMPLATES) {
    for (const n of t.names) if (text.includes(n)) return t;
  }
  return null;
}

/** 构建几何（确定性：同 seed 同几何） */
export function buildTemplateGeo(t: CreationTemplate, seed: number): { geo: THREE.BufferGeometry; tris: number } {
  const g = new GeoBuilder();
  t.build(g);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
  geo.setIndex(g.idx);
  geo.computeBoundingSphere();
  return { geo, tris: g.idx.length / 3 };
}
