import * as THREE from 'three';
import type { Baker, BGroup } from './bake';
import { ROOF_RIB_PITCH, roofRibCols, roofProfile, shade } from './bake';
import { dougongBand } from './architecture';
import { C } from './buildings';
import { buildDetailedEave } from './detailKit';

/**
 * R16 皇宫精细构造库（雕梁画柱级）。
 *
 * 与 `imperial.ts` 的关系：imperial 正被另一个 agent 改写，这里只提供可复用构造 + 机检计数，
 * 由 lead 接线。全部函数只往 Baker 里落件，不读全局状态，同参数多次调用结果一致。
 *
 * 坐标口径（与 imperial.ts 的 palaceHall 一致，接线时照抄）：
 *  · `y`      = 台基顶面（殿内地坪）的**世界标高**，三大殿为 3×1.55 = 4.65；
 *  · `eaveH`  = 檐口的**世界标高**（地面起算），与 `PALACE.eave.*` 同口径；
 *  · 殿身高   = eaveH − y（太和殿 26 − 4.65 = 21.35）。台基从 y 往下叠，落到 y − tiers×1.55。
 *
 * 屋面用 bake.ts 的 `roofC(..., rib=true)`（瓦垄顶点色 + 檐口 `eaveTrim` 的瓦当/滴水），
 * 垂脊沿同一套 `roofProfile` 生成，所以脊永远贴着自己家的曲面。
 */

// ============ 配色（与 imperial / buildings 的宫城色系对齐） ============
const MARBLE = 0xd7d0be;        // 汉白玉
const MARBLE_D = 0xb6ae99;      // 汉白玉阴面 / 线脚
const CINNABAR = 0x9d2933;      // 宫墙朱
const RED_DEEP = 0x7a1f1a;      // 朱漆深
const GILT = 0xd8b028;          // 鎏金
const QING = 0x2f5a4a;          // 和玺彩画青
const LV = 0x2a6b5a;            // 和玺彩画绿
const WOOD = 0x6b4a2b;          // 木
const WOOD_DK = 0x4a3220;       // 深褐
const TILE_GOLD = 0xb08a34;     // 黄琉璃瓦（比旧版 PAL_GOLD 沉一档，瓦垄才读得出明暗）
const RIDGE = 0x2b2f36;         // 脊身玄端
const PATTERN = [QING, LV, QING, LV, 0x8a6a2a];

// ============ 尺度常量 ============
const TIER_H = 1.55;            // 须弥座层高（SPEC R16-D）
const TIER_INSET = 1.8;         // 逐层收进（SPEC R16-D）
const APRON = 6;                // 台明：柱列到台基边的净宽
const EAVE_OUT = 4;             // 檐出：屋面挑出柱列
const RIDGE_HALF = 0.16;        // 与 bake.ts buildCurvedUnit 的 RIDGE_HALF 同值
const ROOF_KICK = 0.16;         // 檐口上挑系数（同 bake.ts UNIT_KICK）
const ROOF_CORNER = 0.15;       // 角部起翘（同 bake.ts CORNER_RISE）
const BAY_TARGET = 5.714;       // 开间 5.7m：明间 6 扇 0.9m 隔扇刚好占满
const BRACKET_H = 1.05;         // 斗栱带高（SPEC R16-B：0.9–1.2m）
const ARCH_H = 0.8;             // 额枋高（SPEC R16-B）
const EAVE_BAND = BRACKET_H + ARCH_H;

interface Frame {
  x: number; z: number; y: number; ry: number;
  at: (lx: number, lz: number) => [number, number];
}

function frame(o: { x: number; z: number; y: number; ry?: number }): Frame {
  const ry = o.ry ?? 0;
  const c = Math.cos(ry), s = Math.sin(ry);
  return {
    x: o.x, z: o.z, y: o.y, ry,
    at: (lx, lz) => [o.x + lx * c + lz * s, o.z - lx * s + lz * c],
  };
}

/** 屋面局部 (lx,lz) → 世界。屋面件不参与 y 偏移，单独一套世界换算。 */
function roofXY(o: { x: number; z: number; ry: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
}

/** 和玺彩画带：顶点色青绿叠晕（不贴图）。返回一条面向 +z 的直条几何。 */
function paintedBandGeo(len: number, h: number, segs: number, palette: number[]): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  const c = new THREE.Color();
  const step = len / segs;
  const quad: [number, number][] = [[0, -0.5], [1, -0.5], [1, 0.5], [0, -0.5], [1, 0.5], [0, 0.5]];
  for (let i = 0; i < segs; i++) {
    c.setHex(palette[i % palette.length]);
    const x0 = -len / 2 + i * step;
    for (const [fx, fy] of quad) {
      const px = x0 + fx * step;
      const py = fy * h;
      pos.push(px, py, 0);
      col.push(c.r, c.g, c.b);
      uv.push(px / 2.56, py / 2.4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 四角攒尖顶（亭）：四坡 + 瓦垄顶点色 + 檐口瓦当 + 四条戗脊。 */
function pyramidRoof(b: Baker, o: { x: number; y: number; z: number; half: number; rise: number; ry: number; hex: number }): void {
  const { half, rise, hex } = o;
  const N = Math.max(8, Math.min(160, Math.round((half * 2) / ROOF_RIB_PITCH)));
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [o.x + lx * c + lz * s, o.y + ly, o.z - lx * s + lz * c];
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  const cc = new THREE.Color();
  const paint = (k: number): void => { cc.setRGB(k, k, k); };
  // 下段（u=0.42→1，可数出瓦垄）+ 上段（u=0→0.42，近宝顶处合并成一片瓦面）
  const P = (u: number, x: number, z: number): [number, number, number] => {
    const r = 0.08 + 0.92 * Math.pow(u, 1.5);
    const y = rise * Math.pow(1 - u, 1.3);
    return at(x * half * r, y, z * half * r);
  };
  const tri = (a: [number, number, number], b2: [number, number, number], c2: [number, number, number]): void => {
    for (const v of [a, b2, c2]) { pos.push(v[0], v[1], v[2]); uv.push(v[0] / 2.56, v[2] / 2.4); }
    col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
  };
  // [A点的 x/z, B点的 x/z, 外法线 x/z]：四坡按「从外看逆时针」排，法线一律朝外
  const faces: [number, number, number, number, number, number][] = [
    [-1, 1, 1, 1, 0, 1],    // +z
    [1, -1, -1, -1, 0, -1], // -z
    [1, 1, 1, -1, 1, 0],    // +x
    [-1, -1, -1, 1, -1, 0], // -x
  ];
  for (const [ax, az, bx, bz, nx, nz] of faces) {
    for (let i = 0; i < N; i++) {
      const u0 = 0.42 + (0.58 * i) / N, u1 = 0.42 + (0.58 * (i + 1)) / N;
      const xa = ax + (bx - ax) * (i / N), za = az + (bz - az) * (i / N);
      const xb = ax + (bx - ax) * ((i + 1) / N), zb = az + (bz - az) * ((i + 1) / N);
      const k = i % 2 ? 1.22 : 0.8;
      paint(k);
      tri(P(u0, xa, za), P(u1, xa, za), P(u1, xb, zb));
      tri(P(u0, xa, za), P(u1, xb, zb), P(u0, xb, zb));
    }
    paint(0.95);
    for (let i = 0; i < N; i++) {
      const xa = ax + (bx - ax) * (i / N), za = az + (bz - az) * (i / N);
      const xb = ax + (bx - ax) * ((i + 1) / N), zb = az + (bz - az) * ((i + 1) / N);
      tri(P(0, xa, za), P(0.42, xa, za), P(0.42, xb, zb));
      tri(P(0, xa, za), P(0.42, xb, zb), P(0, xb, zb));
    }
    // 檐口瓦当 / 滴水（每 0.6m 一枚）
    const len = Math.hypot(bx - ax, bz - az) * half;
    const n = Math.max(2, Math.round(len / 0.6));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const [wx, wy, wz] = P(1, ax + (bx - ax) * t, az + (bz - az) * t);
      b.box('roof', 0.3, 0.22, 0.3, wx + nx * 0.12, wy - 0.06, wz + nz * 0.12, shade(hex, 1.18), o.ry + Math.atan2(nx, nz));
    }
    b.kit('palace.eaveTile', n);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  b.addGeo('roof', geo, 0, 0, 0, hex, 0);
  b.kit('palace.pyramidRib', N * 4);
  // 四条戗脊：从近顶（u=0.1）到角（u=1）分段
  for (const [ax, az] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const seg = 4;
    let prev = P(0.08, ax, az);
    for (let i = 1; i <= seg; i++) {
      const cur = P(0.08 + (0.92 * i) / seg, ax, az);
      const dx = cur[0] - prev[0], dz = cur[2] - prev[2], dy = cur[1] - prev[1];
      b.box('roof', Math.hypot(dx, dz, dy) + 0.06, 0.26, 0.3, (prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2 + 0.1, (prev[2] + cur[2]) / 2,
        shade(hex, 0.62), Math.atan2(-dz, dx), 0, Math.atan2(dy, Math.hypot(dx, dz)));
      prev = cur;
      b.kit('palace.hipRidge', 1);
    }
  }
  // 宝顶
  b.cyl('metal', 0.34, 0.46, 0.34, 8, o.x, o.y + rise + 0.17, o.z, shade(GILT, 0.8));
  b.sphere('metal', 0.44, 10, o.x, o.y + rise + 0.6, o.z, GILT);
  b.cyl('metal', 0.09, 0.14, 0.52, 6, o.x, o.y + rise + 1.05, o.z, shade(GILT, 0.92));
  b.kit('palace.finial', 1, o.y + rise);
}

// ============ 台基（三层须弥座，从 y 往下叠） ============
function palaceBase(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; tiers: number; ry: number }): void {
  const F = frame(o);
  const Y = o.y;
  const put = (w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number): void => {
    const [wx, wz] = F.at(lx, lz);
    b.box('ash', w, h, d, wx, Y + ly, wz, hex, o.ry);
  };
  const topW = o.w + APRON * 2, topD = o.d + APRON * 2;
  for (let t = 0; t < o.tiers; t++) {
    const grow = (o.tiers - 1 - t) * TIER_INSET;
    const wT = topW + grow * 2, dT = topD + grow * 2;
    const y0 = -o.tiers * TIER_H + t * TIER_H;
    // 圭角 / 下枋 / 束腰 / 上枋 / 压顶：5 段合成 1.55m 须弥座
    put(wT, 0.30, dT, 0, y0 + 0.15, 0, shade(MARBLE_D, 0.94));
    put(wT - 0.10, 0.24, dT - 0.10, 0, y0 + 0.42, 0, MARBLE_D);
    put(wT - 0.55, 0.45, dT - 0.55, 0, y0 + 0.765, 0, shade(MARBLE_D, 0.9));
    put(wT - 0.10, 0.30, dT - 0.10, 0, y0 + 1.14, 0, MARBLE);
    put(wT + 0.14, 0.26, dT + 0.14, 0, y0 + 1.42, 0, shade(MARBLE, 1.04));
    b.kit('palace.baseTier', 1, Y + y0);
    // 束腰椀花结带：通长两道线脚 + 每 3m 一朵结带（几何线脚，不靠贴图）
    const ww = wT - 0.55, dd = dT - 0.55;
    for (const yy of [-0.16, 0.16]) {
      put(ww + 0.1, 0.06, dd + 0.1, 0, y0 + 0.765 + yy, 0, shade(MARBLE_D, 1.08));
    }
    const mold = (len: number, alongX: boolean): void => {
      const n = Math.max(2, Math.round(len / 3.0));
      for (let i = 0; i < n; i++) {
        const off = -len / 2 + (len * (i + 0.5)) / n;
        for (const s of [-1, 1]) {
          const lx = alongX ? off : s * (ww / 2 + 0.04);
          const lz = alongX ? s * (dd / 2 + 0.04) : off;
          put(alongX ? 0.5 : 0.16, 0.26, alongX ? 0.16 : 0.5, lx, y0 + 0.765, lz, shade(MARBLE, 0.98));
          b.kit('palace.baseMolding', 1, Y + y0 + 0.765);
        }
      }
    };
    mold(ww, true);
    mold(dd, false);
  }
}

// ============ 汉白玉栏板（望柱 2.4m + 寻杖 + 地栿 + 螭首） ============
export function buildPalaceBalustrade(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; ry?: number }): void {
  const ry = o.ry ?? 0;
  const F = frame({ ...o, ry });
  const Y = o.y;
  const hw = o.w / 2, hd = o.d / 2;
  const GAP = 16;   // 南面正中御路口（与丹陛踏道同宽）
  const posts = new Set<string>();
  const post = (lx: number, lz: number, nx: number, nz: number): void => {
    const key = `${Math.round(lx * 10)}|${Math.round(lz * 10)}`;
    if (posts.has(key)) return;
    posts.add(key);
    const [wx, wz] = F.at(lx, lz);
    const cy = (h: number): number => Y + h;
    b.box('ash', 0.46, 0.14, 0.46, wx, cy(0.07), wz, shade(MARBLE_D, 0.94), ry);
    b.box('ash', 0.26, 1.06, 0.26, wx, cy(0.67), wz, MARBLE, ry);
    b.box('ash', 0.34, 0.5, 0.34, wx, cy(1.45), wz, shade(MARBLE, 1.04), ry);     // 柱头 0.5m
    b.box('ash', 0.42, 0.1, 0.42, wx, cy(1.75), wz, shade(MARBLE, 1.1), ry);
    b.box('ash', 0.26, 0.16, 0.26, wx, cy(1.88), wz, shade(MARBLE, 0.96), ry);
    b.kit('palace.balustrade', 1, Y + 1.4);
  };
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return;
    const ang = ry + Math.atan2(-dz, dx);
    const [wx, wz] = F.at((ax + bx) / 2, (az + bz) / 2);
    b.box('ash', len - 0.22, 0.16, 0.2, wx, Y + 1.16, wz, MARBLE, ang);              // 寻杖
    b.box('ash', len - 0.22, 0.14, 0.26, wx, Y + 0.22, wz, shade(MARBLE_D, 1.02), ang); // 地栿
    b.box('ash', len - 0.4, 0.62, 0.1, wx, Y + 0.62, wz, shade(MARBLE, 0.98), ang);  // 栏板
    b.kit('palace.rail', 1, Y + 1.16);
    b.kit('palace.sillRail', 1, Y + 0.22);
  };
  // 沿四边布柱：转角只落一次，南面留 GAP
  const walk = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.4));
    let prev: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const nx = Math.abs(bz - az) > Math.abs(bx - ax) ? Math.sign(px) : 0;
      const nz = Math.abs(bz - az) > Math.abs(bx - ax) ? 0 : Math.sign(pz);
      post(px, pz, nx, nz);
      if (prev) rail(prev[0], prev[1], px, pz);
      prev = [px, pz];
    }
  };
  walk(hw, hd, GAP / 2, hd);
  walk(-GAP / 2, hd, -hw, hd);
  walk(-hw, hd, -hw, -hd);
  walk(-hw, -hd, hw, -hd);
  walk(hw, -hd, hw, hd);
  // 螭首：四转角 + 御路口两端（龙首外挑，台基排水口）
  for (const [lx, lz, nx, nz] of [
    [hw, hd, 1, 1], [-hw, hd, -1, 1], [-hw, -hd, -1, -1], [hw, -hd, 1, -1],
    [GAP / 2, hd, 0, 1], [-GAP / 2, hd, 0, 1],
  ] as const) {
    const [wx, wz] = F.at(lx, lz);
    b.box('ash', 0.46, 0.34, 0.62, wx + nx * 0.16, Y + 0.2, wz + nz * 0.16, shade(MARBLE, 1.02), ry + Math.atan2(nx, nz));
    b.box('ash', 0.3, 0.22, 0.4, wx + nx * 0.42, Y + 0.16, wz + nz * 0.42, shade(MARBLE_D, 1.06), ry + Math.atan2(nx, nz), 0.2 * nz);
    b.box('ash', 0.16, 0.5, 0.16, wx + nx * 0.24, Y + 0.52, wz + nz * 0.24, shade(MARBLE, 0.96), ry + Math.atan2(nx, nz), 0.35);
    b.kit('palace.chishou', 1, Y + 0.4);
  }
}

// ============ 丹陛御路 + 12 级踏步 ============
function palaceStair(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; tiers: number; ry: number }): void {
  const F = frame(o);
  const Y = o.y;
  const drop = o.tiers * TIER_H;
  const STEPS = 12;
  const rise = drop / STEPS;
  const tread = 0.72;
  const rampW = 8;
  const runW = 4;
  const z0 = o.d / 2 + APRON;      // 台基前缘（局部）
  // 御路：中间 8m 丹陛石（浮雕云龙抽象化：3 道弧形纹 + 6 处云头）
  const run = STEPS * tread;
  const hyp = Math.hypot(run, drop);
  const midZ = z0 + run / 2, midY = Y - drop / 2;
  {
    const [wx, wz] = F.at(0, midZ);
    b.box('ash', rampW, 0.32, hyp, wx, midY, wz, shade(MARBLE, 1.06), o.ry, Math.atan2(drop, run));
    b.box('ash', rampW - 0.7, 0.1, hyp * 0.94, wx, midY + 0.19, wz, shade(MARBLE_D, 1.12), o.ry, Math.atan2(drop, run));
    b.kit('palace.imperialRamp', 1, midY);
  }
  // 3 道弧形纹：横跨御路的窄条，跟着坡度
  for (let k = 1; k <= 3; k++) {
    const t = k / 4;
    const [wx, wz] = F.at(0, z0 + run * t);
    b.box('ash', rampW - 1.4, 0.07, 0.5, wx, Y - drop * t + 0.26, wz, shade(MARBLE_D, 0.9), o.ry, Math.atan2(drop, run));
    b.kit('palace.rampArc', 1);
  }
  // 6 处云头：三段式弧云（每处 2 个小圆盘 + 1 道卷边）
  for (let i = 0; i < 6; i++) {
    const t = 0.16 + (i % 3) * 0.3;
    const off = (i < 3 ? -1 : 1) * 1.6;
    const [wx, wz] = F.at(off, z0 + run * t);
    b.cyl('ash', 0.42, 0.42, 0.08, 8, wx, Y - drop * t + 0.3, wz, shade(MARBLE, 1.12), 0, Math.atan2(drop, run));
    b.cyl('ash', 0.24, 0.24, 0.06, 6, wx, Y - drop * t + 0.35, wz, shade(MARBLE_D, 1.16), 0, Math.atan2(drop, run));
    b.kit('palace.cloudHead', 1, Y - drop * t);
  }
  // 两侧 12 级踏步（实体台阶：每级从地面砌到踏面）
  for (const s of [-1, 1]) {
    for (let i = 0; i < STEPS; i++) {
      const h = (STEPS - i) * rise;
      const [wx, wz] = F.at(s * (rampW / 2 + runW / 2), z0 + (i + 0.5) * tread);
      b.box('ash', runW, h, tread, wx, Y - h / 2, wz, shade(MARBLE_D, 0.96 + (i % 2) * 0.04), o.ry);
      b.kit('palace.stair', 1, Y - h / 2);
    }
    // 垂带（踏道两侧的斜栏板）
    const [bx, bz] = F.at(s * (rampW / 2 + runW - 0.2), midZ);
    b.box('ash', 0.5, 0.5, hyp, bx, midY + 0.1, bz, shade(MARBLE, 0.98), o.ry, Math.atan2(drop, run));
  }
}

// ============ 斗栱 / 额枋 / 柱列 ============
interface HallCtx {
  b: Baker;
  F: Frame;
  Y: number;
  ry: number;
  put: (g: BGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, dyaw?: number, rx?: number, rz?: number) => void;
  cyl: (g: BGroup, rt: number, rb: number, h: number, seg: number, lx: number, ly: number, lz: number, hex: number, dyaw?: number, rx?: number, rz?: number) => void;
}

function hallCtx(b: Baker, o: { x: number; z: number; y: number; ry: number }): HallCtx {
  const F = frame(o);
  const Y = o.y;
  const put = (g: BGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, dyaw = 0, rx = 0, rz = 0): void => {
    const [wx, wz] = F.at(lx, lz);
    b.box(g, w, h, d, wx, Y + ly, wz, hex, o.ry + dyaw, rx, rz);
  };
  const cyl = (g: BGroup, rt: number, rb: number, h: number, seg: number, lx: number, ly: number, lz: number, hex: number, dyaw = 0, rx = 0, rz = 0): void => {
    const [wx, wz] = F.at(lx, lz);
    b.cyl(g, rt, rb, h, seg, wx, Y + ly, wz, hex, o.ry + dyaw, rx, rz);
  };
  return { b, F, Y, ry: o.ry, put, cyl };
}

/** 一攒五铺作（栌斗 → 华栱两跳 → 泥道栱/慢栱 → 令栱 + 散斗 + 耍头），高 0.98m。 */
function bracketSet(b: Baker, F: Frame, Y: number, ry: number, lx: number, lz: number, nx: number, nz: number, baseY: number): void {
  const [wx, wz] = F.at(lx, lz);
  const ltx = -nz, ltz = nx;
  const dyaw = Math.atan2(nx, nz);
  const box = (w: number, h: number, d: number, u: number, v: number, yy: number, hex: number): void => {
    b.box('wood', w, h, d, wx + ltx * u + nx * v, Y + baseY + yy, wz + ltz * u + nz * v, hex, ry + dyaw);
  };
  box(0.62, 0.26, 0.62, 0, 0, 0.13, shade(GILT, 0.9));                 // 栌斗
  box(0.34, 0.16, 0.95, 0, 0.18, 0.35, QING);                          // 华栱一跳
  box(0.30, 0.15, 0.86, 0, 0.38, 0.54, shade(QING, 0.94));             // 华栱二跳
  box(1.05, 0.16, 0.28, 0, 0, 0.42, LV);                               // 泥道栱
  box(1.52, 0.15, 0.28, 0, 0.02, 0.62, shade(LV, 1.06));               // 慢栱
  box(0.92, 0.14, 0.26, 0, 0.58, 0.78, QING);                          // 令栱
  box(0.22, 0.12, 0.22, -0.66, 0.02, 0.72, GILT);                      // 散斗
  box(0.22, 0.12, 0.22, 0.66, 0.02, 0.72, GILT);
  box(0.26, 0.16, 0.78, 0, 0.64, 0.9, shade(WOOD_DK, 1.0));            // 耍头
  b.kit('palace.bracket', 1, Y + baseY + 0.5);
}

/** 沿一条边均布斗栱：攒距 ≤ 3m（每开间 2 攒）。 */
function bracketLine(b: Baker, F: Frame, Y: number, ry: number, x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, baseY: number, spacing: number, skipEnds = false): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) {
    if (skipEnds && (i === 0 || i === n)) continue;
    const t = i / n;
    bracketSet(b, F, Y, ry, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, nx, nz, baseY);
  }
}

/** 额枋（0.8m）+ 和玺彩画带（顶点色条纹）。雀替由调用方按真实柱列另落（见 corbel）。 */
function architraveRun(b: Baker, F: Frame, Y: number, ry: number, halfW: number, halfD: number, topY: number): void {
  const cy = topY - ARCH_H / 2;
  const band = (len: number, lx: number, lz: number, nx: number, nz: number): void => {
    const segs = Math.max(6, Math.round(len / 0.9));
    const geo = paintedBandGeo(len, 0.5, segs, PATTERN);
    const [wx, wz] = roofXY({ x: F.x, z: F.z, ry }, lx + nx * 0.315, lz + nz * 0.315);
    b.addGeo('lacquer', geo, wx, Y + topY - 0.38, wz, 0xffffff, ry + Math.atan2(nx, nz));
    b.kit('palace.paintedBeam', segs, Y + topY - 0.38);
  };
  for (const [len, lx, lz, nx, nz] of [
    [halfW * 2, 0, halfD, 0, 1],
    [halfW * 2, 0, -halfD, 0, -1],
    [halfD * 2, halfW, 0, 1, 0],
    [halfD * 2, -halfW, 0, -1, 0],
  ] as const) {
    const [wx, wz] = F.at(lx, lz);
    const dyaw = nx !== 0 ? Math.PI / 2 : 0;
    b.box('wood', len, ARCH_H, 0.62, wx, Y + cy, wz, shade(WOOD_DK, 1.02), ry + dyaw);
    b.kit('palace.architrave', 1, Y + cy);
    band(len, lx, lz, nx, nz);
  }
}

function corbel(b: Baker, F: Frame, Y: number, ry: number, lx: number, lz: number, nx: number, nz: number, baseY: number): void {
  const dyaw = Math.atan2(nx, nz);
  const ltx = -nz, ltz = nx;
  for (const s of [-1, 1]) {
    const [wx, wz] = F.at(lx + ltx * s * 0.72, lz + ltz * s * 0.72);
    b.box('wood', 0.82, 0.34, 0.3, wx, Y + baseY, wz, shade(RED_DEEP, 1.1), ry + dyaw, 0, s * 0.12);
    b.kit('palace.corbel', 1, Y + baseY);
  }
}

function column(b: Baker, F: Frame, Y: number, ry: number, lx: number, lz: number, yBase: number, h: number): void {
  const [wx, wz] = F.at(lx, lz);
  b.box('ash', 1.4, 0.34, 1.4, wx, Y + yBase + 0.17, wz, MARBLE, ry);                 // 柱础 1.4 见方
  b.cyl('wood', 0.53, 0.57, h - 0.34, 10, wx, Y + yBase + 0.34 + (h - 0.34) / 2, wz, shade(RED_DEEP, 1.02), ry); // 柱径 1.1
  b.cyl('metal', 0.62, 0.62, 0.14, 10, wx, Y + yBase + h - 0.36, wz, GILT, ry);        // 柱头箍
  b.cyl('metal', 0.6, 0.6, 0.09, 10, wx, Y + yBase + h - 0.06, wz, shade(GILT, 0.86), ry);
  b.kit('palace.column', 1, Y + yBase + h * 0.5);
  b.kit('palace.columnBase', 1, Y + yBase);
  b.kit('palace.columnRing', 2, Y + yBase + h - 0.2);
}

// ============ 正立面门窗 ============
function latticeDoor(b: Baker, F: Frame, Y: number, ry: number, cx: number, zf: number, y0: number, w: number, h: number): void {
  const z = zf + 0.42;
  const put = (gw: number, gh: number, gd: number, lx: number, ly: number, lz: number, hex: number): void => {
    const [wx, wz] = F.at(lx, lz);
    b.box('wood', gw, gh, gd, wx, Y + ly, wz, hex, ry);
  };
  for (const s of [-1, 1]) put(0.07, h, 0.12, cx + s * (w / 2 - 0.035), y0 + h / 2, z, shade(RED_DEEP, 0.94)); // 大边
  for (const yy of [0.03, 0.55, 1.15, 2.2, 3.0, h - 0.03]) put(w - 0.05, 0.075, 0.1, cx, y0 + yy, z, shade(WOOD_DK, 1.0)); // 六抹
  put(w - 0.16, 1.06, 0.06, cx, y0 + 0.58, z + 0.03, shade(RED_DEEP, 0.86));   // 裙板
  put(w - 0.16, 0.98, 0.06, cx, y0 + 1.66, z + 0.03, shade(RED_DEEP, 0.92));   // 绦环板
  put(w - 0.2, 0.06, 0.08, cx, y0 + 1.6, z + 0.05, GILT);                      // 金线
  // 棂心：横向 4 × 纵向 3 = 12 格
  const lw = w - 0.14, lh = h - 2.27;
  put(lw, lh, 0.04, cx, y0 + 2.2 + lh / 2, z - 0.03, shade(C.winGlow, 0.42));
  for (let k = 0; k < 5; k++) put(0.05, lh, 0.07, cx - lw / 2 + (lw * k) / 4, y0 + 2.2 + lh / 2, z + 0.02, shade(WOOD_DK, 0.96));
  for (let k = 0; k < 4; k++) put(lw, 0.05, 0.07, cx, y0 + 2.2 + (lh * k) / 3, z + 0.02, shade(WOOD_DK, 0.96));
  b.kit('palace.door', 1, Y + y0 + h / 2);
  b.kit('palace.doorLattice', 12, Y + y0 + h / 2);
}

function casementWindow(b: Baker, F: Frame, Y: number, ry: number, cx: number, zf: number, y0: number, w: number, h: number): void {
  const z = zf + 0.42;
  const [wx, wz] = F.at(cx, z);
  b.box('wood', w, h, 0.14, wx, Y + y0 + h / 2, wz, shade(RED_DEEP, 0.9), ry);
  b.box('glow', w - 0.16, h - 0.16, 0.05, wx, Y + y0 + h / 2, wz + 0.08, shade(C.winGlow, 0.46), ry);
  for (let k = 1; k < 4; k++) {
    const [sx, sz] = F.at(cx - w / 2 + (w * k) / 4, z + 0.1);
    b.box('wood', 0.05, h - 0.12, 0.08, sx, Y + y0 + h / 2, sz, WOOD_DK, ry);
  }
  const [hx, hz] = F.at(cx, z + 0.1);
  b.box('wood', w - 0.1, 0.06, 0.08, hx, Y + y0 + h * 0.52, hz, WOOD_DK, ry);
  const [fx, fz] = F.at(cx, z);
  b.box('ash', w + 0.24, 0.12, 0.36, fx, Y + y0 - 0.06, fz, MARBLE_D, ry);
  b.kit('palace.window', 1, Y + y0 + h / 2);
  b.kit('palace.windowSlat', 4, Y + y0 + h / 2);
}

function zhilingWindow(b: Baker, F: Frame, Y: number, ry: number, cx: number, zf: number, y0: number, w: number, h: number): void {
  const z = zf + 0.42;
  const [wx, wz] = F.at(cx, z);
  b.box('wood', w, h, 0.14, wx, Y + y0 + h / 2, wz, shade(RED_DEEP, 0.92), ry);
  b.box('glow', w - 0.18, h - 0.18, 0.05, wx, Y + y0 + h / 2, wz + 0.08, shade(C.winGlow, 0.38), ry);
  for (let k = 1; k < 6; k++) {
    const [sx, sz] = F.at(cx - w / 2 + (w * k) / 6, z + 0.1);
    b.box('wood', 0.07, h - 0.14, 0.09, sx, Y + y0 + h / 2, sz, shade(WOOD_DK, 1.04), ry);
  }
  const [fx, fz] = F.at(cx, z);
  b.box('ash', w + 0.24, 0.12, 0.36, fx, Y + y0 - 0.06, fz, MARBLE_D, ry);
  b.kit('palace.zhilingWindow', 1, Y + y0 + h / 2);
  b.kit('palace.windowSlat', 5, Y + y0 + h / 2);
}

function transomRow(b: Baker, F: Frame, Y: number, ry: number, bx: number, zf: number, bayW: number, y0: number): void {
  const z = zf + 0.4;
  const panels = 4;
  const pw = Math.min(1.35, (bayW - 0.6) / panels);
  for (let p = 0; p < panels; p++) {
    const cx = bx - (panels - 1) * pw / 2 + p * pw;
    const [wx, wz] = F.at(cx, z);
    b.box('wood', pw - 0.08, 1.6, 0.12, wx, Y + y0 + 0.8, wz, shade(RED_DEEP, 0.9), ry);
    b.box('glow', pw - 0.26, 1.4, 0.04, wx, Y + y0 + 0.8, wz + 0.07, shade(C.winGlow, 0.34), ry);
    for (let k = 1; k < 3; k++) {
      const [sx, sz] = F.at(cx - pw / 2 + (pw * k) / 3, z + 0.09);
      b.box('wood', 0.05, 1.44, 0.07, sx, Y + y0 + 0.8, sz, WOOD_DK, ry);
    }
    b.kit('palace.transom', 1, Y + y0 + 0.8);
  }
}

// ============ 屋面 ============
interface Shell {
  x: number; z: number; ry: number;
  sx: number; sz: number; rise: number;
  eaveY: number; tileC: number;
}

/**
 * 补齐曲面屋顶 ±X 两端的山面（庑殿的两片端坡）。
 *
 * 根因在 bake.ts 的 buildCurvedUnit：`sides` 循环只有 [1, -1] 两片 ±Z 坡，
 * ±X 两端从脊端（±0.16·sx, 脊高）到檐角（±0.5·sx, 檐口）是一条**敞口**。
 * 斜上方看进去，看到的是对面瓦背 + 檐口内壁，整顶读作"开盖的盒子"——
 * 用户第 N 次投诉的"前后面有贴图、侧面是空的"就是这个。
 *
 * 修法不是挂一块端板：端板在檐口外会从瓦面里穿出来。这里按 ring() 的同一套参数逐环取
 * 环半宽 h(t) 与举高 y(t)，把每环的左右檐角连成一条横带——生成的是真正的端坡面，
 * 外缘正好落在两条戗脊线下，既不露缝也不穿瓦。UV 按 3.2m 一张展开，瓦垄用世界 0.34m 顶点色，
 * 端面因此与前后坡同材质、同瓦纹（不是一块纯色板）。
 *
 * 面数：12 环 × 2 三角 × 2 端 = 48 面/顶（当前全城 326 顶 ≈ +15.6k 面，占 17.3M 的 0.09%）。
 */
export function roofEndHips(b: Baker, o: {
  x: number; y: number; z: number; ry: number;
  sx: number; sz: number; rise: number; hex: number;
}): number {
  const { x, y, z, ry, sx, sz, rise, hex } = o;
  const N = 12;
  const UV_T = 3.2;
  const RIB_MID = 1.01, RIB_AMP = 0.23;   // = bake.ts 的 (RIB_HI+RIB_LO)/2、(RIB_HI−RIB_LO)/2
  /** 环点：局部 x=su·h·sx，z=side·h·sz，y=(反宇剖面+起翘)·rise */
  const P = (su: number, i: number, side: number): [number, number, number, number] => {
    const t = i / N;
    const h = RIDGE_HALF + (0.5 - RIDGE_HALF) * Math.pow(t, 1.6);
    const yy = (roofProfile(t) + ROOF_KICK * t * t * t + ROOF_CORNER * t * t) * rise;
    const lz = side * h * sz;
    return [su * h * sx, yy, lz, RIB_MID + RIB_AMP * Math.cos((lz / ROOF_RIB_PITCH) * Math.PI * 2)];
  };
  let tris = 0;
  for (const su of [-1, 1] as const) {
    // 沿环点的弧长做 v 方向 UV（脊→檐）
    const arc = new Float64Array(N + 1);
    for (let i = 1; i <= N; i++) {
      const a = P(su, i - 1, 1), c = P(su, i, 1);
      arc[i] = arc[i - 1] + Math.hypot(c[0] - a[0], c[1] - a[1]);
    }
    const pos: number[] = [], uv: number[] = [], col: number[] = [];
    /** 落一个环点（su 固定）：i 环、side=±1 决定左右檐角 */
    const put = (i: number, side: 1 | -1): void => {
      const p = P(su, i, side);
      pos.push(p[0], p[1], p[2]);
      uv.push(p[2] / UV_T, arc[i] / UV_T);
      col.push(p[3], p[3], p[3]);
    };
    for (let i = 0; i < N; i++) {
      // 绕序：端坡外法线 = ±X + Y，su<0 时把整串顶点反着发
      if (su > 0) {
        put(i, -1); put(i, 1); put(i + 1, 1);
        put(i, -1); put(i + 1, 1); put(i + 1, -1);
      } else {
        put(i + 1, -1); put(i + 1, 1); put(i, 1);
        put(i + 1, -1); put(i, 1); put(i, -1);
      }
      tris += 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    b.addGeo('roof', geo, x, y, z, hex, ry, 0, 0);
  }
  b.kit('roof.endHip', 2, y + rise);
  return tris;
}

/** 屋面本体：曲线瓦面 + 瓦垄顶点色 + 檐口瓦当/滴水（都由 roofC 的共享实现给出）。 */
function roofShell(b: Baker, s: Shell): number {
  const baseY = s.eaveY - ROOF_KICK * s.rise;
  b.roofC('roof', s.x, baseY, s.z, s.tileC, s.ry, s.sx, s.rise, s.sz, 0, 0, true);
  // 两端山面：roofC 只造 ±Z 两坡，不补这一手就是"开盖盒子"
  roofEndHips(b, { x: s.x, y: baseY, z: s.z, ry: s.ry, sx: s.sx, sz: s.sz, rise: s.rise, hex: s.tileC });
  const cols = roofRibCols(s.sx);
  b.kit('palace.rib', cols / 2, s.eaveY);
  b.kit('palace.ribCol', cols, s.eaveY);
  return baseY;
}

/** 连檐 0.3m + 飞椽头每 0.6m（瓦当/滴水由 roofC.eaveTrim 落，见 roof.tileCap / roof.dripTile）。 */
function eaveRing(b: Baker, s: Shell): void {
  const { sx, sz, rise, eaveY } = s;
  const M = 16;
  for (const axis of ['z', 'x'] as const) {
    for (const sign of [-1, 1] as const) {
      const A = axis === 'z' ? sx : sz;
      const halfT = (axis === 'z' ? sz : sx) / 2;
      for (let i = 0; i < M; i++) {
        const u0 = -1 + (2 * i) / M, u1 = -1 + (2 * (i + 1)) / M;
        const y0 = eaveY + ROOF_CORNER * rise * u0 * u0;
        const y1 = eaveY + ROOF_CORNER * rise * u1 * u1;
        const l0 = (u0 * A) / 2, l1 = (u1 * A) / 2;
        const dx = l1 - l0, dy = y1 - y0;
        const [wx, wz] = axis === 'z' ? roofXY(s, (l0 + l1) / 2, sign * halfT) : roofXY(s, sign * halfT, (l0 + l1) / 2);
        b.box('roof', Math.hypot(dx, dy) + 0.02, 0.3, 0.2, wx, (y0 + y1) / 2 - 0.13, wz,
          shade(s.tileC, 0.7), s.ry + (axis === 'z' ? 0 : Math.PI / 2), 0, Math.atan2(dy, dx));
      }
      b.kit('palace.eaveFascia', M, eaveY);
      const n = Math.max(2, Math.round(A / 0.6));
      for (let i = 0; i < n; i++) {
        const u = -1 + (2 * (i + 0.5)) / n;
        const yy = eaveY + ROOF_CORNER * rise * u * u;
        const lat = (u * A) / 2;
        const [wx, wz] = axis === 'z' ? roofXY(s, lat, sign * (halfT + 0.07)) : roofXY(s, sign * (halfT + 0.07), lat);
        const w = axis === 'z' ? 0.13 : 0.52;
        const d = axis === 'z' ? 0.52 : 0.13;
        b.box('wood', w, 0.16, d, wx, yy - 0.36, wz, shade(WOOD, 0.92), s.ry + (axis === 'z' ? 0 : Math.PI / 2));
      }
      b.kit('palace.flyingRafter', n, eaveY);
    }
  }
}

/** 四条垂脊：沿曲面参数 t 分段（每 ~2m 一段），脊端走兽 3 只。 */
function hipRidges(b: Baker, s: Shell, tStart: number, beasts: number): void {
  const { sx, sz, rise } = s;
  const baseY = s.eaveY - ROOF_KICK * rise;
  for (const sxS of [-1, 1]) {
    for (const szS of [-1, 1]) {
      const at = (t: number): [number, number, number] => {
        const hx = RIDGE_HALF + (0.5 - RIDGE_HALF) * Math.pow(t, 1.6);
        const y = baseY + (roofProfile(t) + ROOF_KICK * Math.pow(t, 3) + ROOF_CORNER * t * t) * rise;
        return [sxS * hx * sx, y, szS * hx * sz];
      };
      let len = 0;
      let prev = at(tStart);
      const N0 = 48;
      for (let i = 1; i <= N0; i++) {
        const cur = at(tStart + ((1 - tStart) * i) / N0);
        len += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
        prev = cur;
      }
      const segs = Math.max(2, Math.round(len / 2));
      prev = at(tStart);
      let pw = roofXY(s, prev[0], prev[2]);
      for (let i = 1; i <= segs; i++) {
        const t = tStart + ((1 - tStart) * i) / segs;
        const cur = at(t);
        const [wx, wz] = roofXY(s, cur[0], cur[2]);
        const dx = wx - pw[0], dz = wz - pw[1], dy = cur[1] - prev[1];
        const segLen = Math.hypot(dx, dy, dz);
        b.box('roof', segLen + 0.1, 0.42, 0.5, (wx + pw[0]) / 2, (cur[1] + prev[1]) / 2 + 0.16, (wz + pw[1]) / 2,
          shade(s.tileC, 0.58), s.ry + Math.atan2(-dz, dx), 0, Math.atan2(dy, Math.hypot(dx, dz)));
        b.kit('palace.hipRidge', 1, cur[1]);
        prev = cur;
        pw = [wx, wz];
      }
      // 走兽：贴脊端（t→1），每 0.02 一只
      for (let k = 0; k < beasts; k++) {
        const t = 0.985 - k * 0.02;
        const cur = at(t);
        const [wx, wz] = roofXY(s, cur[0], cur[2]);
        const yaw = s.ry + Math.atan2(sxS * sz, szS * sx);
        b.box('roof', 0.24, 0.3, 0.34, wx, cur[1] + 0.42, wz, shade(RIDGE, 1.15), yaw);
        b.box('roof', 0.18, 0.18, 0.22, wx, cur[1] + 0.62, wz, shade(RIDGE, 1.3), yaw);
        b.kit('palace.beast', 1, cur[1] + 0.5);
      }
    }
  }
}

/** 正脊 0.9m + 两端鸱吻 1.8m + 脊心宝顶。 */
function mainRidge(b: Baker, s: Shell, ridgeY: number): void {
  const halfLen = RIDGE_HALF * s.sx;
  const [wx, wz] = roofXY(s, 0, 0);
  b.box('roof', halfLen * 2 + 1.2, 0.9, 0.86, wx, ridgeY + 0.45, wz, shade(TILE_GOLD, 0.5), s.ry);
  b.box('roof', halfLen * 2 + 1.3, 0.14, 0.7, wx, ridgeY + 0.95, wz, shade(TILE_GOLD, 0.72), s.ry);
  b.kit('palace.mainRidge', 1, ridgeY);
  for (const e of [-1, 1]) {
    const [tx, tz] = roofXY(s, e * (halfLen + 0.5), 0);
    b.box('roof', 0.9, 1.8, 0.9, tx, ridgeY + 1.0, tz, shade(TILE_GOLD, 0.66), s.ry, 0, e * 0.16);
    b.box('roof', 0.62, 0.5, 0.68, tx, ridgeY + 2.0, tz, shade(TILE_GOLD, 0.8), s.ry, 0, e * 0.72);
    b.kit('palace.chwen', 1, ridgeY + 1.0);
  }
  b.cyl('metal', 0.5, 0.72, 0.42, 8, wx, ridgeY + 1.12, wz, GILT);
  b.sphere('metal', 0.42, 10, wx, ridgeY + 1.64, wz, shade(GILT, 1.08));
  b.cyl('metal', 0.09, 0.14, 0.5, 6, wx, ridgeY + 2.06, wz, shade(GILT, 0.9));
  b.kit('palace.ridgeFinial', 1, ridgeY + 1.6);
}

// ============ 主殿 ============
export function buildPalaceHall(b: Baker, o: {
  x: number; z: number; y: number;
  w: number; d: number;
  eaveH: number;
  tiers?: number;
  doubleEave?: boolean;
  ry?: number;
}): void {
  const ry = o.ry ?? 0;
  const C0 = hallCtx(b, { x: o.x, z: o.z, y: o.y, ry });
  const { F, Y, put, cyl } = C0;
  const tiers = Math.max(1, Math.round(o.tiers ?? 3));
  const halfW = o.w / 2, halfD = o.d / 2;
  const bodyH = Math.max(8, o.eaveH - Y);
  const doubleEave = o.doubleEave ?? true;
  const mainEave = Y + bodyH;
  const lowerEave = doubleEave ? Y + bodyH * 0.52 : mainEave;

  palaceBase(b, { x: o.x, z: o.z, y: Y, w: o.w, d: o.d, tiers, ry });
  buildPalaceBalustrade(b, { x: o.x, z: o.z, y: Y, w: o.w + APRON * 2, d: o.d + APRON * 2, ry });
  palaceStair(b, { x: o.x, z: o.z, y: Y, w: o.w, d: o.d, tiers, ry });

  // ---- 下层殿身 ----
  const colH = lowerEave - Y - EAVE_BAND;                    // 柱高（到额枋底）
  const bayN = Math.max(3, Math.round(o.w / BAY_TARGET) | 1); // 奇数开间
  const bayW = o.w / bayN;
  const zf = halfD - 2.4;                                    // 前檐墙（退在檐柱内 2.4m，形成前廊）
  const openTop = 6.8;

  // 柱列：前后檐逐间落，两山去掉转角重复
  for (let i = 0; i <= bayN; i++) {
    const lx = -halfW + i * bayW;
    for (const sz of [-1, 1]) {
      column(b, F, Y, ry, lx, sz * halfD, 0, colH);
      corbel(b, F, Y, ry, lx, sz * halfD, 0, sz, colH - 0.18);
    }
  }
  const sideN = Math.max(2, Math.round(o.d / BAY_TARGET));
  for (let i = 1; i < sideN; i++) {
    const lz = -halfD + (i * o.d) / sideN;
    for (const sx of [-1, 1]) {
      column(b, F, Y, ry, sx * halfW, lz, 0, colH);
      corbel(b, F, Y, ry, sx * halfW, lz, sx, 0, colH - 0.18);
    }
  }

  // 额枋 + 和玺彩画带
  architraveRun(b, F, Y, ry, halfW, halfD, colH + ARCH_H);
  // 斗栱带：每开间 2 攒，攒距 = bayW/2 ≤ 3m
  const bs = bayW / 2;
  bracketLine(b, F, Y, ry, -halfW, halfD, halfW, halfD, 0, 1, colH + ARCH_H, bs);
  bracketLine(b, F, Y, ry, -halfW, -halfD, halfW, -halfD, 0, -1, colH + ARCH_H, bs);
  const sideSpacing = o.d / sideN;
  bracketLine(b, F, Y, ry, halfW, -halfD, halfW, halfD, 1, 0, colH + ARCH_H, sideSpacing);
  bracketLine(b, F, Y, ry, -halfW, -halfD, -halfW, halfD, -1, 0, colH + ARCH_H, sideSpacing);

  // 前檐墙：逐间开洞（槛墙 + 洞口上墙 + 抱框），洞里落门窗
  const wallT = 0.72;
  for (let i = 0; i < bayN; i++) {
    const bx = -halfW + (i + 0.5) * bayW;
    const mid = (bayN - 1) / 2;
    const isCenter = i === mid;
    const isSecond = Math.abs(i - mid) === 1;
    const isEnd = i === 0 || i === bayN - 1;
    const sillH = isCenter ? 0.1 : 1.0;
    put('wall', bayW - 0.22, sillH, wallT, bx, sillH / 2, zf, shade(CINNABAR, 0.9));
    put('wall', bayW - 0.22, colH - openTop, wallT, bx, (colH + openTop) / 2, zf, shade(CINNABAR, 0.95));
    // 走马板：填掉门窗顶（≈4.1）到洞口上沿之间的墙，否则横披窗两侧会透出殿内
    put('wall', bayW - 0.22, openTop - 4.1, wallT, bx, (openTop + 4.1) / 2, zf, shade(CINNABAR, 0.97));
    for (const s of [-1, 1]) put('wood', 0.22, openTop - sillH, 0.86, bx + s * (bayW / 2 - 0.17), (openTop + sillH) / 2, zf, shade(RED_DEEP, 1.04));
    // 门窗只占洞宽的一部分，两侧补板壁——不补的话洞口会漏出一条直通殿内的缝
    const fillSides = (contentW: number): void => {
      const gap = (bayW - 0.22 - contentW) / 2;
      if (gap < 0.06) return;
      for (const s of [-1, 1]) {
        put('wood', gap, 4.12 - sillH, 0.5, bx + s * (contentW / 2 + gap / 2), (4.12 + sillH) / 2, zf, shade(RED_DEEP, 0.86));
        b.kit('palace.board', 1, Y + 2.5);
      }
    };
    if (isCenter) {
      for (let j = 0; j < 6; j++) latticeDoor(b, F, Y, ry, bx + (j - 2.5) * 0.9, zf, 0.16, 0.9, 4.2);
      fillSides(5.4);
      transomRow(b, F, Y, ry, bx, zf, bayW, 4.72);
    } else if (isEnd) {
      // 尽间：板壁 + 直棂窗 2 扇（两樘对接，顶到 4.1 与走马板接缝）
      for (const s of [-1, 1]) zhilingWindow(b, F, Y, ry, bx + s * 0.95, zf, 1.4, 1.9, 2.7);
      fillSides(3.8);
      transomRow(b, F, Y, ry, bx, zf, bayW, 4.72);
    } else {
      // 次间与其余开间：槛窗 4 扇（SPEC R16-C 的次间做法），首尾两间另加横披窗
      for (let j = 0; j < 4; j++) casementWindow(b, F, Y, ry, bx + (j - 1.5) * 1.15, zf, 1.22, 1.15, 2.9);
      fillSides(4.6);
      if (isSecond) transomRow(b, F, Y, ry, bx, zf, bayW, 4.72);
    }
  }
  // 后檐墙 / 两山墙 + 石墙裙
  put('wall', o.w, colH, wallT, 0, colH / 2, -zf, shade(CINNABAR, 0.93));
  for (const s of [-1, 1]) put('wall', wallT, colH, o.d - 4.8, s * (halfW - 2.4), colH / 2, 0, shade(CINNABAR, 0.96));
  put('ash', o.w + 0.3, 0.9, 0.3, 0, 0.45, -zf - 0.4, MARBLE_D);
  for (const s of [-1, 1]) put('ash', 0.3, 0.9, o.d - 4.6, s * (halfW - 2.32), 0.45, 0, MARBLE_D);
  for (const yy of [7.25, 8.45]) if (yy < colH - 0.3) put('wood', o.w - 0.6, 0.14, 0.1, 0, yy, zf + 0.4, shade(WOOD_DK, 1.02));
  put('ash', o.w - 1.2, 0.24, o.d - 1.2, 0, 0.06, 0, shade(0x6b6459, 1.0));

  // ---- 下檐屋面（重檐时是裙檐，上层殿身把中段包住）----
  const lowShell: Shell = {
    x: o.x, z: o.z, ry, sx: o.w + EAVE_OUT * 2, sz: o.d + EAVE_OUT * 2,
    rise: 0, eaveY: lowerEave, tileC: TILE_GOLD,
  };
  if (doubleEave) {
    const upperWallTopRel = bodyH - EAVE_BAND;
    const upperWallTopAbs = Y + upperWallTopRel;
    const drumW = Math.round((o.w * 0.86) / 2) * 2;
    const drumD = Math.round((o.d * 0.82) / 2) * 2;
    // 裙檐升到上层殿身底：屋脊整段埋进殿身，外面只留一圈坡面（roofC 造不出截顶，靠殿身来截）
    lowShell.rise = Math.max(2.4, (upperWallTopAbs - lowerEave) * 0.78);
    roofShell(b, lowShell);
    eaveRing(b, lowShell);
    // 殿身底压进屋面 0.5m：外皮处的瓦面已高于檐口中点，接缝不会漏出天空
    const drumY0Rel = (lowerEave - Y) + ROOF_KICK * lowShell.rise - 0.5;
    const drumH = Math.max(1.6, upperWallTopRel - drumY0Rel);
    // 下檐垂脊只从殿身外皮开始（往里那截被殿身遮住，落件也只是穿模）
    const hxExit = Math.min(drumW / (2 * lowShell.sx), drumD / (2 * lowShell.sz));
    const tExit = Math.min(1, Math.max(0.05, Math.pow(Math.max(0, (hxExit - RIDGE_HALF) / (0.5 - RIDGE_HALF)), 1 / 1.6)));
    hipRidges(b, lowShell, tExit + 0.01, 3);
    // 上层殿身（重檐的「腰」）：红墙 + 窗光 + 围脊
    put('wall', drumW, drumH, drumD, 0, drumY0Rel + drumH / 2, 0, shade(CINNABAR, 0.99));
    put('ash', drumW + 0.3, 0.5, drumD + 0.3, 0, drumY0Rel + 0.2, 0, shade(MARBLE_D, 0.98));
    for (const s of [-1, 1]) put('roof', drumW + 0.9, 0.6, 0.5, 0, drumY0Rel + 0.45, s * (drumD / 2 + 0.1), shade(TILE_GOLD, 0.55));
    for (const s of [-1, 1]) put('roof', 0.5, 0.6, drumD + 0.9, s * (drumW / 2 + 0.1), drumY0Rel + 0.45, 0, shade(TILE_GOLD, 0.55));
    b.kit('palace.ridgeBand', 4, Y + drumY0Rel);
    for (let i = 0; i < 8; i++) {
      const wx = -drumW / 2 + (drumW * (i + 1)) / 9;
      const [sx, sz] = F.at(wx, drumD / 2 + 0.02);
      b.box('glow', 2.0, 2.6, 0.06, sx, Y + drumY0Rel + drumH * 0.55, sz, shade(C.winGlow, 0.5), ry);
      b.box('wood', 2.3, 2.9, 0.1, sx, Y + drumY0Rel + drumH * 0.55, sz - 0.06, shade(RED_DEEP, 1.0), ry);
      b.kit('palace.window', 1, Y + drumY0Rel + drumH * 0.55);
    }
    // 上层斗栱带 + 额枋 + 彩画 + 柱
    const upColH = upperWallTopRel - drumY0Rel;
    const dw = drumW / 2 - 0.55, dd = drumD / 2 - 0.55;
    for (const [cx2, cz2, nx2, nz2] of [
      [-dw, -dd, -1, -1], [dw, -dd, 1, -1], [dw, dd, 1, 1], [-dw, dd, -1, 1],
      [0, -dd, 0, -1], [0, dd, 0, 1], [-dw, 0, -1, 0], [dw, 0, 1, 0],
    ] as const) {
      column(b, F, Y, ry, cx2, cz2, drumY0Rel, upColH);
      corbel(b, F, Y, ry, cx2, cz2, nx2, nz2, upperWallTopRel - ARCH_H - 0.2);
    }
    architraveRun(b, F, Y, ry, drumW / 2, drumD / 2, upperWallTopRel);
    const ubs = Math.max(2.2, drumW / 2 / Math.max(1, Math.round(drumW / 2 / 2.8)));
    bracketLine(b, F, Y, ry, -drumW / 2, drumD / 2, drumW / 2, drumD / 2, 0, 1, upperWallTopRel, ubs);
    bracketLine(b, F, Y, ry, -drumW / 2, -drumD / 2, drumW / 2, -drumD / 2, 0, -1, upperWallTopRel, ubs);
    const uss = Math.max(2.2, drumD / 2 / Math.max(1, Math.round(drumD / 2 / 2.8)));
    bracketLine(b, F, Y, ry, drumW / 2, -drumD / 2, drumW / 2, drumD / 2, 1, 0, upperWallTopRel, uss);
    bracketLine(b, F, Y, ry, -drumW / 2, -drumD / 2, -drumW / 2, drumD / 2, -1, 0, upperWallTopRel, uss);
    // 上檐
    const upShell: Shell = {
      x: o.x, z: o.z, ry, sx: drumW + 6, sz: drumD + 6,
      rise: Math.max(3.2, Math.min(drumW + 6, drumD + 6) * 0.2), eaveY: mainEave, tileC: TILE_GOLD,
    };
    const upBase = roofShell(b, upShell);
    eaveRing(b, upShell);
    hipRidges(b, upShell, 0.02, 3);
    mainRidge(b, upShell, upBase + upShell.rise);
  } else {
    lowShell.rise = Math.max(3.2, Math.min(lowShell.sx, lowShell.sz) * 0.2);
    const base = roofShell(b, lowShell);
    eaveRing(b, lowShell);
    hipRidges(b, lowShell, 0.02, 3);
    mainRidge(b, lowShell, base + lowShell.rise);
  }

  b.kit('palace.hall', 1, Y);
  b.kit('palace.tiers', tiers, Y);
  b.kit('palace.eave', 1, mainEave);
  b.kit('palace.bay', bayN, Y);
}

// ============ 御花园：亭 / 楼 / 台 ============
function gardenPavilion(b: Baker, o: { x: number; z: number; y: number; s: number }): void {
  const { s } = o;
  const Y = o.y;
  const put = (g: BGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, dyaw = 0): void => {
    b.box(g, w, h, d, o.x + lx, Y + ly, o.z + lz, hex, dyaw);
  };
  put('ash', 13 * s, 0.3, 13 * s, 0, 0.15, 0, MARBLE_D);
  put('ash', 12.2 * s, 0.22, 12.2 * s, 0, 0.41, 0, MARBLE);
  const R = 3.9 * s;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    put('ash', 0.66, 0.26, 0.66, sx * R, 0.65, sz * R, MARBLE_D);
    b.cyl('wood', 0.24, 0.27, 4.2 * s, 10, o.x + sx * R, Y + 0.78 + 2.1 * s, o.z + sz * R, shade(RED_DEEP, 1.02));
    put('wood', 0.5, 0.16, 0.5, sx * R, 4.9 * s, sz * R, WOOD_DK);
    b.kit('palace.pavilionColumn', 1, Y + 3);
  }
  for (const s2 of [-1, 1]) {
    put('wood', 2 * R, 0.34, 0.3, 0, 4.62 * s, s2 * R, shade(WOOD_DK, 1.04));
    put('wood', 0.3, 0.34, 2 * R, s2 * R, 4.62 * s, 0, shade(WOOD_DK, 1.04));
  }
  // 简化斗栱带（一层）：复用 architecture.dougongBand（它只落件不登账，计数在调用处登记）
  const dgBays = Math.max(3, Math.round((2 * R) / 1.6));
  for (const s2 of [-1, 1]) {
    dougongBand(b, o.x, Y + 4.9 * s, o.z + s2 * R, 2 * R, 0, GILT);
    dougongBand(b, o.x + s2 * R, Y + 4.9 * s, o.z, 2 * R, Math.PI / 2, GILT);
  }
  b.kit('palace.bracket', (dgBays + 1) * 4, Y + 4.9 * s);
  // 坐凳栏：四边（柱间）
  for (const s2 of [-1, 1]) {
    put('wood', 2 * R - 0.5, 0.16, 0.5, 0, 0.55, s2 * (R - 0.1), shade(WOOD, 1.06));
    put('wood', 0.5, 0.16, 2 * R - 0.5, s2 * (R - 0.1), 0.55, 0, shade(WOOD, 1.06));
    put('wood', 2 * R - 0.5, 0.12, 0.14, 0, 1.0, s2 * (R - 0.32), shade(WOOD_DK, 1.02));
    put('wood', 0.14, 0.12, 2 * R - 0.5, s2 * (R - 0.32), 1.0, 0, shade(WOOD_DK, 1.02));
  }
  b.kit('palace.pavilionBench', 4, Y + 0.6);
  // 檐口细部接 detailKit（椽 / 飞椽 / 檩 / 滴水 / 风铎）：w*0.46 正好等于檐口半宽 6.2m
  buildDetailedEave(b, { x: o.x, y: Y + 5.15 * s, z: o.z, w: 13.5 * s, d: 13.5 * s, ry: 0, roofC: TILE_GOLD, tier: 'near' });
  pyramidRoof(b, { x: o.x, y: Y + 5.15 * s, z: o.z, half: 6.2 * s, rise: 3.4 * s, ry: 0, hex: TILE_GOLD });
  b.kit('palace.pavilion', 1, Y + 6);
}

function gardenTower(b: Baker, o: { x: number; z: number; y: number }): void {
  const Y = o.y;
  const put = (g: BGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, dyaw = 0): void => {
    b.box(g, w, h, d, o.x + lx, Y + ly, o.z + lz, hex, dyaw);
  };
  put('ash', 17, 0.9, 13, 0, 0.45, 0, MARBLE_D);
  put('ash', 16.2, 0.24, 12.2, 0, 1.0, 0, MARBLE);
  // 一层
  put('wall', 14, 5.4, 10, 0, 3.9, 0, shade(CINNABAR, 0.98));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('wood', 0.3, 0.34, 5.6, 10, o.x + sx * 7, Y + 3.8, o.z + sz * 5, shade(RED_DEEP, 1.0));
  put('wood', 14.6, 0.42, 0.36, 0, 6.5, 5.1, shade(WOOD_DK, 1.04));
  put('wood', 14.6, 0.42, 0.36, 0, 6.5, -5.1, shade(WOOD_DK, 1.04));
  for (let i = 0; i < 5; i++) {
    const lx = -5.2 + i * 2.6;
    put('glow', 1.7, 2.4, 0.08, lx, 3.8, 5.06, shade(C.winGlow, 0.5));
    put('wood', 2.0, 2.7, 0.12, lx, 3.8, 5.0, shade(RED_DEEP, 0.94));
  }
  // 腰檐（一层顶）
  const waist: Shell = { x: o.x, z: o.z, ry: 0, sx: 18, sz: 14, rise: 2.9, eaveY: Y + 6.9, tileC: TILE_GOLD };
  buildDetailedEave(b, { x: o.x, y: Y + 6.9, z: o.z, w: 19.6, d: 15.2, ry: 0, roofC: TILE_GOLD, tier: 'near' });
  const wb = roofShell(b, waist);
  hipRidges(b, waist, 0.02, 2);
  void wb;
  eaveRing(b, waist);
  // 平座 + 栏杆
  put('wood', 15.4, 0.3, 11.4, 0, 8.55, 0, shade(WOOD, 1.04));
  for (const s2 of [-1, 1]) {
    put('wood', 15.4, 0.12, 0.12, 0, 9.55, s2 * 5.6, shade(RED_DEEP, 1.06));
    put('wood', 0.12, 0.12, 11.4, s2 * 7.6, 9.55, 0, shade(RED_DEEP, 1.06));
    for (let i = 0; i <= 7; i++) put('wood', 0.14, 0.9, 0.14, -7.4 + i * 2.1, 9.1, s2 * 5.6, shade(RED_DEEP, 1.02));
    for (let i = 0; i <= 5; i++) put('wood', 0.14, 0.9, 0.14, s2 * 7.6, 9.1, -5.2 + i * 2.1, shade(RED_DEEP, 1.02));
  }
  b.kit('palace.towerDeck', 1, Y + 9);
  // 二层
  put('wall', 11, 4.4, 7.5, 0, 11.3, 0, shade(CINNABAR, 1.0));
  for (let i = 0; i < 4; i++) {
    put('glow', 1.5, 2.1, 0.07, -4 + i * 2.7, 11.2, 3.78, shade(C.winGlow, 0.46));
    put('wood', 1.8, 2.4, 0.1, -4 + i * 2.7, 11.2, 3.72, shade(RED_DEEP, 0.96));
  }
  const top: Shell = { x: o.x, z: o.z, ry: 0, sx: 15, sz: 11.5, rise: 4.2, eaveY: Y + 13.8, tileC: TILE_GOLD };
  buildDetailedEave(b, { x: o.x, y: Y + 13.8, z: o.z, w: 16.3, d: 12.5, ry: 0, roofC: TILE_GOLD, tier: 'near' });
  const tb = roofShell(b, top);
  hipRidges(b, top, 0.02, 2);
  eaveRing(b, top);
  mainRidge(b, top, tb + top.rise);
  b.kit('palace.tower', 1, Y + 9);
}

function gardenTerrace(b: Baker, o: { x: number; z: number; y: number }): void {
  const Y = o.y;
  for (let t = 0; t < 2; t++) {
    const w = 30 - t * 2.4, d = 20 - t * 2.4;
    b.box('ash', w, 1.1, d, o.x, Y + 0.55 + t * 1.1, o.z, t === 1 ? MARBLE : MARBLE_D);
  }
  b.box('ash', 27.8, 0.14, 17.8, o.x, Y + 2.27, o.z, shade(MARBLE, 1.04));
  buildPalaceBalustrade(b, { x: o.x, z: o.z, y: Y + 2.2, w: 27.6, d: 17.6 });
  // 蹬道 8 级
  for (let i = 0; i < 8; i++) {
    const h = (8 - i) * 0.275;
    b.box('ash', 6, h, 0.62, o.x, Y + 2.2 - h / 2, o.z + 8.8 + (i + 0.5) * 0.62, shade(MARBLE_D, 0.96 + (i % 2) * 0.05));
  }
  b.kit('palace.terraceStair', 8, Y + 1);
  b.kit('palace.terrace', 1, Y + 1.1);
}

export function buildPalaceGarden(b: Baker, o: { x: number; z: number; y: number; count: { pavilion: number; tower: number; terrace: number } }): void {
  for (let i = 0; i < o.count.pavilion; i++) {
    const a = (i / Math.max(1, o.count.pavilion)) * Math.PI * 2 + Math.PI / 4;
    gardenPavilion(b, { x: o.x + Math.cos(a) * 34, z: o.z + Math.sin(a) * 34, y: o.y, s: 1 });
  }
  for (let i = 0; i < o.count.tower; i++) {
    const a = (i / Math.max(1, o.count.tower)) * Math.PI * 2 + Math.PI / 2;
    gardenTower(b, { x: o.x + Math.cos(a) * 62, z: o.z + Math.sin(a) * 62, y: o.y });
  }
  for (let i = 0; i < o.count.terrace; i++) {
    gardenTerrace(b, { x: o.x + (i - (o.count.terrace - 1) / 2) * 44, z: o.z, y: o.y });
  }
}
