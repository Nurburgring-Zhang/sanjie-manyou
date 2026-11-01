import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from '../city/bake';
import { roofOn, dougongBand } from '../city/buildings';
import { Crowd } from '../actors/crowd';
import { RNG } from '../core/rng';
import { Vfx } from '../fx/vfx';

// ============ 幽冥地府：黄泉/奈何桥/阎罗殿/孟婆庄/望乡台/彼岸花 ============
export const UNDER = { y: -260, gateZ: -130, bridgeZ: -60 };

// ============ WS-12 地府室内壳：共享构件 ============
// 纪律：石材一律 ash（wall 自带蓝灰自发光，只用于人间灰泥）；金属 metal；灯火 glow。
// 光色三系沿用 hells.ts：磷绿 #3DFF9C / 演出红 #FF3A4A / 幽蓝 #4D7CFF。
export const INP = {
  slab: 0x4a4450, slabD: 0x2a2630, rough: 0x3b424a, roughD: 0x2e2a34,
  brick: 0x2e2420, brickD: 0x241c18, wood: 0x1f1a14, wood2: 0x3a2c22,
  lacq: 0x2a1f26, bone: 0xe8e3d5, paper: 0xc9b380, ink: 0xb03a2e,
  iron: 0x26282c, steel: 0x8a8a92, cu: 0xb87333, rust: 0x6e1f1f,
  phos: 0x3dff9c, blue: 0x4d7cff, ice: 0xbaffef, cloth: 0x2b1b3d, cloth2: 0x4a3f30,
} as const;

/** 局部坐标 → 世界（与 Baker 的 ry 约定一致：局部 +z 对齐 (sin ry, cos ry)） */
function lp(cx: number, cz: number, ry: number, lx: number, lz: number): [number, number] {
  return [cx + Math.cos(ry) * lx + Math.sin(ry) * lz, cz - Math.sin(ry) * lx + Math.cos(ry) * lz];
}

/** 石板/青砖地面：面板 + 双向分缝 */
export function inFloor(b: Baker, x: number, z: number, w: number, d: number, y: number, tone: number = INP.slab, step = 1.75): number {
  b.box('ash', w, 0.14, d, x, y - 0.07, z, tone);
  let n = 1;
  for (let zz = z - d / 2 + step; zz < z + d / 2 - 0.3; zz += step) {
    b.box('ash', w - 0.14, 0.03, 0.11, x, y + 0.005, zz, INP.slabD);
    n++;
  }
  for (let xx = x - w / 2 + step; xx < x + w / 2 - 0.3; xx += step) {
    b.box('ash', 0.11, 0.03, d - 0.14, xx, y + 0.005, z, INP.slabD);
    n++;
  }
  return n;
}

/** 只有分缝与磨亮带的地面（压在既有地面上，不盖掉既有铺装） */
export function inPaveLines(b: Baker, x: number, z: number, w: number, d: number, y: number, step = 2.2, tone: number = INP.slabD): number {
  let n = 0;
  for (let zz = z - d / 2 + step; zz < z + d / 2 - 0.3; zz += step) {
    b.box('ash', w - 0.6, 0.03, 0.1, x, y, zz, tone);
    n++;
  }
  for (let xx = x - w / 2 + step; xx < x + w / 2 - 0.3; xx += step) {
    b.box('ash', 0.1, 0.03, d - 0.6, xx, y, z, tone);
    n++;
  }
  return n;
}

/** 踏跺：n 级石阶，自 (x,z) 向 +z 逐级下行 */
export function inSteps(b: Baker, x: number, z: number, w: number, y: number, n: number, rise = 0.26, tread = 0.3): number {
  for (let i = 0; i < n; i++) {
    b.box('ash', w - i * 0.06, rise + 0.06, tread * 1.1, x, y - i * rise - rise / 2, z + i * tread, shade(INP.rough, 1.02 - i * 0.02));
  }
  return n;
}

/** 石墙/隔墙：沿 a→b，gaps 为距 a 的 [起,止] 米区间（门洞），压顶枋通长兼作过梁 */
export function inWall(b: Baker, ax: number, az: number, bx: number, bz: number, y: number, h: number, t: number, hex: number = INP.brick, gaps: readonly (readonly [number, number])[] = []): number {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return 0;
  const ux = dx / len, uz = dz / len, ang = Math.atan2(dx, dz);
  const segs: [number, number][] = [];
  let cur = 0;
  for (const g of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g[0] > cur) segs.push([cur, g[0]]);
    cur = Math.max(cur, g[1]);
  }
  if (cur < len) segs.push([cur, len]);
  let n = 0;
  for (const [s0, s1] of segs) {
    const L = s1 - s0;
    if (L < 0.06) continue;
    b.box('ash', t, h, L, ax + ux * (s0 + L / 2), y + h / 2, az + uz * (s0 + L / 2), hex, ang);
    n++;
  }
  b.box('ash', t + 0.24, 0.16, len, ax + ux * (len / 2), y + h + 0.08, az + uz * (len / 2), shade(hex, 1.22), ang);
  return n + 1;
}

/** 墙裙：下碱石 + 板壁 + 压条（三面齐的「墙」靠它与墙裙共同立住） */
export function inSkirt(b: Baker, ax: number, az: number, bx: number, bz: number, y: number, hex: number = INP.wood2, h = 0.95): number {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 0.2) return 0;
  const ang = Math.atan2(dx, dz), mx = (ax + bx) / 2, mz = (az + bz) / 2;
  b.box('ash', 0.2, 0.14, len, mx, y + 0.07, mz, INP.roughD, ang);
  b.box('wood', 0.11, h - 0.24, len, mx, y + 0.14 + (h - 0.24) / 2, mz, hex, ang);
  b.box('wood', 0.16, 0.14, len, mx, y + h - 0.02, mz, shade(hex, 1.4), ang);
  return 3;
}

/** 格栅隔断：上下枋 + 中贯 + 直棂 + 两端立柱 */
export function inLattice(b: Baker, ax: number, az: number, bx: number, bz: number, y: number, h: number): number {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 0.3) return 0;
  const ang = Math.atan2(dx, dz), ux = dx / len, uz = dz / len;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  let n = 0;
  b.box('wood', 0.18, 0.2, len, mx, y + 0.1, mz, INP.wood, ang); n++;
  b.box('wood', 0.22, 0.22, len, mx, y + h - 0.11, mz, INP.wood, ang); n++;
  b.box('wood', 0.13, 0.11, len, mx, y + h * 0.52, mz, INP.wood2, ang); n++;
  const slats = Math.max(2, Math.round(len / 0.34));
  for (let i = 1; i < slats; i++) {
    const t = i / slats;
    b.box('wood', 0.09, h - 0.32, 0.09, ax + ux * len * t, y + h / 2, az + uz * len * t, INP.wood2, ang);
    n++;
  }
  for (const e of [0, 1]) {
    b.box('wood', 0.24, h, 0.24, ax + ux * len * e, y + h / 2, az + uz * len * e, INP.wood, ang);
    n++;
  }
  return n;
}

/** 帷幔隔断：幔杆 + 垂幅 + 束带（地府幔色取幽冥紫，破口以铁链缝缀） */
export function inVeil(b: Baker, ax: number, az: number, bx: number, bz: number, y: number, h: number, hex: number = INP.cloth): number {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 0.4) return 0;
  const ang = Math.atan2(dx, dz), ux = dx / len, uz = dz / len;
  let n = 0;
  b.box('wood', 0.1, 0.1, len, (ax + bx) / 2, y + h, (az + bz) / 2, INP.wood, ang); n++;
  const panels = Math.max(2, Math.round(len / 0.62));
  for (let i = 0; i < panels; i++) {
    const t = (i + 0.5) / panels;
    const px = ax + ux * len * t, pz = az + uz * len * t;
    const ph = h - 0.28 - (i % 3) * 0.14;
    b.box('fabric', 0.56, ph, 0.05, px, y + h - 0.12 - ph / 2, pz, i % 2 ? hex : shade(hex, 1.25), ang);
    b.box('wood', 0.1, 0.1, 0.12, px, y + h - 0.4, pz, INP.wood2, ang);
    n += 2;
  }
  return n;
}

/** 板门：门槛石 + 门框 + 门楣 + 双扇板 + 门钉 + 铺首 + 门轴 */
export function inDoor(b: Baker, cx: number, cz: number, y: number, w: number, h: number, ry = 0, ajar = 0.14): number {
  let n = 0;
  b.box('ash', w + 0.66, 0.18, 0.54, cx, y + 0.09, cz, INP.rough, ry); n++;
  for (const s of [-1, 1]) {
    const [jx, jz] = lp(cx, cz, ry, s * (w / 2 + 0.1), 0);
    b.box('wood', 0.2, h + 0.3, 0.36, jx, y + (h + 0.3) / 2, jz, INP.wood, ry);
    n++;
  }
  b.box('wood', w + 0.64, 0.28, 0.38, cx, y + h + 0.16, cz, INP.wood, ry); n++;
  b.box('glow', 0.34, 0.1, 0.05, cx, y + h + 0.42, cz, shade(INP.phos, 0.35), ry); n++;
  for (const s of [-1, 1]) {
    const [lx, lz] = lp(cx, cz, ry, s * (w / 4), s > 0 ? 0.1 * ajar : 0.02);
    b.box('lacquer', w / 2 - 0.06, h - 0.14, 0.13, lx, y + (h - 0.14) / 2 + 0.1, lz, shade(INP.wood, 1.5), ry + (s > 0 ? ajar : 0));
    n++;
    for (let c = 0; c < 2; c++) for (let r = 0; r < 4; r++) {
      const [sx, sz] = lp(lx, lz, ry, (c - 0.5) * 0.55, s > 0 ? 0.09 : -0.09);
      b.box('metal', 0.14, 0.14, 0.08, sx, y + 0.46 + r * 0.68, sz, INP.steel, ry);
      n++;
    }
    const [rx2, rz2] = lp(lx, lz, ry, -s * 0.5, 0.12);
    b.cyl('metal', 0.13, 0.13, 0.07, 8, rx2, y + 1.5, rz2, 0x9a8a52, ry, Math.PI / 2);
    n++;
  }
  return n;
}

/** 直棂窗：暗框 + 石窗台 + 五棂 + 双横档 + 磷光窗纸（bars 加铁栅） */
export function inWindow(b: Baker, cx: number, cz: number, y0: number, w: number, h: number, ry = 0, lit = true, bars = false): number {
  let n = 0;
  const cy = y0 + h / 2;
  b.box('wood', w + 0.2, h + 0.2, 0.1, cx, cy, cz, 0x120e12, ry); n++;
  b.box('ash', w + 0.46, 0.16, 0.36, cx, y0 - 0.08, cz, INP.rough, ry); n++;
  for (const s of [-1, 1]) {
    const [sx, sz] = lp(cx, cz, ry, s * (w / 2 + 0.06), 0);
    b.box('wood', 0.13, h + 0.24, 0.16, sx, cy, sz, INP.wood, ry);
    n++;
    const [hy, hz] = lp(cx, cz, ry, 0, s * (h / 2 + 0.05));
    b.box('wood', w + 0.24, 0.14, 0.16, hy, y0 + (h / 2) * (1 + s), hz, INP.wood, ry);
    n++;
  }
  if (lit) {
    const [gx, gz] = lp(cx, cz, ry, 0, -0.07);
    b.box('glow', w - 0.1, h - 0.12, 0.04, gx, cy, gz, shade(INP.phos, 0.3), ry);
    n++;
  }
  for (let i = 1; i < 5; i++) {
    const [sx, sz] = lp(cx, cz, ry, -w / 2 + (w * i) / 5, 0.06);
    b.box('wood', 0.07, h - 0.1, 0.08, sx, cy, sz, INP.wood2, ry);
    n++;
  }
  for (const s of [-1, 1]) {
    const [sx, sz] = lp(cx, cz, ry, 0, 0.06);
    b.box('wood', w * 0.96, 0.07, 0.08, sx, cy + s * h * 0.22, sz, INP.wood2, ry);
    n++;
  }
  if (bars) {
    for (let i = 0; i < 3; i++) {
      const [sx, sz] = lp(cx, cz, ry, -w / 2 + (w * (i + 1)) / 4, 0.1);
      b.box('metal', 0.06, h - 0.06, 0.06, sx, cy, sz, INP.steel, ry);
      n++;
    }
  }
  return n;
}

/** 黑梁顶棚 + 藻井：四周阑额 + 顶板 + 大梁 + 檩条 + 藻井（井框/井心/磷光一点） */
export function inCeil(b: Baker, x: number, z: number, w: number, d: number, y: number, coffers = 1): number {
  let n = 0;
  for (const s of [-1, 1]) {
    b.box('wood', w, 0.28, 0.22, x, y + 0.14, z + s * (d / 2 - 0.11), INP.wood); n++;
    b.box('wood', 0.22, 0.28, d, x + s * (w / 2 - 0.11), y + 0.14, z, INP.wood); n++;
  }
  b.box('roof', w - 0.34, 0.1, d - 0.34, x, y + 0.5, z, 0x14161a); n++;
  const nb = Math.max(2, Math.round(w / 2.6));
  for (let i = 1; i < nb; i++) {
    const bx = x - w / 2 + (w * i) / nb;
    b.box('wood', 0.26, 0.36, d - 0.24, bx, y + 0.3, z, INP.wood2); n++;
    for (const s of [-1, 1]) {
      b.box('wood', 0.34, 0.2, 0.44, bx, y + 0.34, z + s * (d / 2 - 0.36), INP.wood); n++;
    }
  }
  const np = Math.max(2, Math.round(d / 2.8));
  for (let i = 1; i < np; i++) {
    b.box('wood', w - 0.24, 0.18, 0.17, x, y + 0.46, z - d / 2 + (d * i) / np, shade(INP.wood2, 0.88));
    n++;
  }
  for (let c = 0; c < coffers; c++) {
    const cx = coffers === 1 ? x : x - w / 2 + (w * (c + 0.5)) / coffers;
    for (const s of [-1, 1]) {
      b.box('wood', 2.3, 0.3, 0.26, cx, y + 0.4, z + s * 1.02, INP.wood); n++;
      b.box('wood', 0.26, 0.3, 2.3, cx + s * 1.02, y + 0.4, z, INP.wood); n++;
    }
    b.box('ash', 1.78, 0.09, 1.78, cx, y + 0.68, z, 0x1a161a); n++;
    b.box('ash', 1.24, 0.07, 1.24, cx, y + 0.73, z, shade(0x1a161a, 1.5)); n++;
    b.box('glow', 0.26, 0.12, 0.26, cx, y + 0.64, z, shade(INP.phos, 0.55)); n++;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box('wood', 0.24, 0.22, 0.24, cx + sx * 1.12, y + 0.3, z + sz * 1.12, INP.wood); n++;
    }
  }
  return n;
}

/** 案面陈设：生死簿 + 印匣 + 惊堂木 + 令签筒 + 朱笔 + 小油灯 */
export function inDeskTop(b: Baker, x: number, z: number, y: number, ry = 0, w = 3.2): number {
  let n = 0;
  let [px, pz] = lp(x, z, ry, -w * 0.3, 0.06);
  b.box('lacquer', 0.68, 0.06, 0.46, px, y + 0.03, pz, 0x223a5e, ry);
  b.box('fabric', 0.62, 0.09, 0.4, px, y + 0.1, pz, INP.paper, ry);
  b.box('wood', 0.66, 0.03, 0.44, px, y + 0.16, pz, 0x1b2c46, ry);
  b.box('glow', 0.6, 0.02, 0.04, px, y + 0.12, pz + 0.21, shade(INP.bone, 0.85), ry);
  n += 4;
  [px, pz] = lp(x, z, ry, 0.05, 0.1);
  b.box('lacquer', 0.46, 0.22, 0.34, px, y + 0.11, pz, INP.lacq, ry);
  b.box('lacquer', 0.52, 0.07, 0.4, px, y + 0.26, pz, shade(INP.lacq, 1.5), ry);
  b.box('metal', 0.1, 0.13, 0.08, px, y + 0.13, pz + 0.2, 0xc9a227, ry);
  b.box('glow', 0.42, 0.02, 0.03, px, y + 0.21, pz + 0.21, shade(INP.phos, 0.4), ry);
  n += 4;
  [px, pz] = lp(x, z, ry, w * 0.32, 0.02);
  b.box('wood', 0.36, 0.11, 0.15, px, y + 0.06, pz, 0x2e1a12, ry);
  b.box('glow', 0.3, 0.02, 0.05, px, y + 0.12, pz, shade(INP.rust, 0.9), ry);
  n += 2;
  [px, pz] = lp(x, z, ry, w * 0.44, -0.18);
  b.cyl('lacquer', 0.1, 0.1, 0.26, 8, px, y + 0.13, pz, shade(INP.wood, 1.6));
  for (let i = 0; i < 4; i++) {
    const [sx, sz] = lp(px, pz, ry, (i - 1.5) * 0.05, (i % 2) * 0.04);
    b.box('wood', 0.035, 0.34, 0.035, sx, y + 0.3, sz, INP.paper, ry);
    b.box('glow', 0.04, 0.05, 0.04, sx, y + 0.47, sz, INP.ink, ry);
    n += 2;
  }
  n++;
  [px, pz] = lp(x, z, ry, -w * 0.46, -0.2);
  b.cyl('wood', 0.03, 0.035, 0.36, 5, px, y + 0.18, pz, 0x3a2c22, 0, 0, 0.28);
  b.box('glow', 0.05, 0.09, 0.05, px + 0.06, y + 0.36, pz, INP.ink);
  n += 2;
  return n;
}

/** 判官案：案体 + 铜嵌线 + 符帘 + 案面陈设 */
export function inDesk(b: Baker, x: number, z: number, y: number, ry = 0, w = 3.2): number {
  let n = 0;
  b.box('wood', w, 0.14, 1.2, x, y + 1.04, z, INP.wood, ry); n++;
  b.box('wood', w - 0.34, 0.24, 1.02, x, y + 0.84, z, shade(INP.wood, 1.35), ry); n++;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * (w / 2 - 0.22), sz * 0.44);
    b.box('wood', 0.18, 0.74, 0.18, px, y + 0.37, pz, INP.wood, ry);
    n++;
  }
  for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, 0, sz * 0.46);
    b.box('glow', w * 0.9, 0.035, 0.05, px, y + 1.13, pz, shade(INP.phos, 0.5), ry);
    n++;
  }
  for (let k = 0; k < 3; k++) {
    const [px, pz] = lp(x, z, ry, -w / 2 + 0.4 + k * (w - 0.8) / 2, 0.66);
    b.box('fabric', 0.5, 0.34 - k * 0.04, 0.04, px, y + 0.92 - k * 0.02, pz, k % 2 ? INP.paper : INP.ink, ry);
    n++;
  }
  return n + inDeskTop(b, x, z, y + 1.11, ry, w);
}

/** 架类：scroll=卷宗架 / torture=刑具架 / bone=骨器架（背板+侧板+层板+逐层器件） */
export function inRack(b: Baker, x: number, z: number, y: number, ry = 0, w = 3.0, h = 4.2, shells = 4, kind: 'scroll' | 'torture' | 'bone' = 'scroll'): number {
  let n = 0;
  b.box('wood', w, h, 0.1, x, y + h / 2, z, INP.wood, ry); n++;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * (w / 2 - 0.06), 0.26);
    b.box('wood', 0.12, h, 0.52, px, y + h / 2, pz, INP.wood, ry);
    n++;
  }
  const pitch = (h - 0.4) / shells;
  for (let i = 0; i < shells; i++) {
    const yy = y + 0.28 + i * pitch;
    b.box('wood', w - 0.24, 0.09, 0.54, x, yy, z + Math.cos(ry) * 0.26, shade(INP.wood2, 1.05), ry);
    n++;
    for (let k = 0; k < 3; k++) {
      const lx = -w / 2 + 0.4 + k * (w - 0.8) / 2;
      const [px, pz] = lp(x, z, ry, lx, 0.26);
      if (kind === 'scroll') {
        b.cyl('fabric', 0.09, 0.09, 0.5, 6, px, yy + 0.14, pz, shade(INP.paper, 0.9 + (k % 2) * 0.16), ry, 0, Math.PI / 2);
        b.box('glow', 0.06, 0.16, 0.06, px, yy + 0.11, pz + Math.cos(ry) * 0.24, INP.ink, ry);
        n += 2;
      } else if (kind === 'torture') {
        if ((i + k) % 3 === 0) {
          b.box('metal', 0.07, 0.9, 0.13, px, yy + 0.5, pz, INP.steel, ry);
          b.box('wood', 0.09, 0.36, 0.09, px, yy + 0.18, pz, INP.wood2, ry);
        } else if ((i + k) % 3 === 1) {
          b.box('metal', 0.95, 0.06, 0.14, px, yy + 0.09, pz, shade(INP.steel, 0.8), ry);
          b.box('metal', 0.3, 0.1, 0.3, px, yy + 0.16, pz, INP.cu, ry);
        } else {
          b.box('wood', 0.08, 0.7, 0.08, px, yy + 0.38, pz, INP.wood2, ry);
          b.box('metal', 0.26, 0.26, 0.08, px, yy + 0.78, pz, shade(INP.steel, 0.9), ry);
          b.box('metal', 0.34, 0.05, 0.05, px, yy + 0.9, pz, INP.steel, ry);
        }
        n += 2;
      } else {
        if ((i + k) % 3 === 0) {
          b.cyl('ash', 0.045, 0.05, 0.62, 6, px, yy + 0.14, pz, shade(INP.bone, 0.9), 0, 0, Math.PI / 2);
          b.cyl('ash', 0.06, 0.06, 0.1, 6, px, yy + 0.14, pz + Math.cos(ry) * 0.32, INP.bone, 0, 0, Math.PI / 2);
        } else if ((i + k) % 3 === 1) {
          b.cyl('ash', 0.16, 0.16, 0.06, 8, px, yy + 0.14, pz, INP.bone, ry, Math.PI / 2);
          b.cyl('ash', 0.1, 0.1, 0.07, 8, px, yy + 0.14, pz, shade(INP.bone, 0.6), ry, Math.PI / 2);
        } else {
          b.box('ash', 0.06, 0.4, 0.06, px, yy + 0.12, pz, INP.bone, ry, 0, 0.1);
          for (let q = 0; q < 3; q++) b.box('ash', 0.05, 0.14, 0.05, px + (q - 1) * 0.06, yy + 0.34, pz, shade(INP.bone, 0.95), ry);
        }
        n += 3;
      }
    }
  }
  return n;
}

/** 锁链桩：石础 + 桩身 + 顶环 + 垂链 + 血渍 */
export function inChainStake(b: Baker, x: number, z: number, y: number, ry = 0): number {
  let n = 0;
  b.box('ash', 0.86, 0.24, 0.86, x, y + 0.12, z, shade(INP.rough, 0.92), ry); n++;
  b.cyl('wood', 0.16, 0.24, 1.9, 6, x, y + 1.19, z, shade(INP.wood, 1.5)); n++;
  b.cyl('metal', 0.24, 0.24, 0.09, 8, x, y + 2.18, z, INP.steel, ry, Math.PI / 2); n++;
  for (let k = 0; k < 5; k++) {
    const [px, pz] = lp(x, z, ry, 0, 0.34 + k * 0.05);
    b.box('metal', 0.13, 0.2, 0.07, px, y + 1.86 - k * 0.34, pz, shade(INP.steel, 0.95 - k * 0.05), ry + (k % 2 ? 0.5 : -0.5));
    n++;
  }
  b.box('glow', 0.56, 0.03, 0.56, x, y + 0.25, z, INP.rust, ry); n++;
  return n;
}

/** 垂链（自顶棚垂下的铁链 + 钩） */
export function inChain(b: Baker, x: number, y: number, z: number, len: number, seed = 0): number {
  b.box('metal', 0.14, 0.12, 0.14, x, y, z, INP.steel);
  const links = Math.max(3, Math.round(len / 0.24));
  for (let k = 0; k < links; k++) {
    b.box('metal', 0.11, 0.2, 0.06, x, y - 0.14 - k * 0.22, z, shade(INP.steel, 0.92 - (k % 3) * 0.06), (k + seed) % 2 ? 0.6 : -0.6);
  }
  b.box('metal', 0.05, 0.2, 0.05, x, y - 0.24 - links * 0.22, z, 0x9a9aa2);
  return links + 2;
}

/** 油灯台：灯柱 + 灯盘 + 三足 + 灯罩 + 焰 */
export function inLamp(b: Baker, x: number, z: number, y: number, h = 2.2): number {
  let n = 0;
  b.box('ash', 0.42, 0.16, 0.42, x, y + 0.08, z, shade(INP.rough, 0.95)); n++;
  b.cyl('wood', 0.08, 0.13, h, 6, x, y + 0.16 + h / 2, z, shade(INP.wood, 1.5)); n++;
  b.cyl('metal', 0.26, 0.2, 0.1, 8, x, y + 0.22 + h, z, 0x2a2622); n++;
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094;
    b.box('metal', 0.06, 0.16, 0.06, x + Math.cos(a) * 0.16, y + 0.3 + h, z + Math.sin(a) * 0.16, INP.iron);
    n++;
  }
  b.box('glow', 0.2, 0.26, 0.2, x, y + 0.44 + h, z, INP.phos); n++;
  b.box('glow', 0.1, 0.12, 0.1, x, y + 0.6 + h, z, INP.ice); n++;
  return n;
}

/** 香案：案 + 香炉 + 三炷香 + 供果 + 纸钱 */
export function inAltar(b: Baker, x: number, z: number, y: number, ry = 0, w = 3.2): number {
  let n = 0;
  b.box('wood', w, 0.13, 1.0, x, y + 0.98, z, INP.wood, ry); n++;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * (w / 2 - 0.16), 0);
    b.box('wood', 0.2, 0.92, 0.8, px, y + 0.46, pz, INP.wood, ry);
    n++;
  }
  b.box('fabric', w - 0.3, 0.7, 0.05, x, y + 0.56, z + Math.cos(ry) * 0.44, INP.ink, ry); n++;
  b.cyl('metal', 0.34, 0.28, 0.4, 10, x, y + 1.2, z, 0x5a5044); n++;
  for (let k = 0; k < 4; k++) {
    const a = k * 1.571 + 0.4;
    b.box('metal', 0.08, 0.16, 0.08, x + Math.cos(a) * 0.28, y + 1.06, z + Math.sin(a) * 0.28, 0x4a4436);
    n++;
  }
  for (let k = 0; k < 3; k++) {
    const [px, pz] = lp(x, z, ry, (k - 1) * 0.12, 0.04);
    b.box('glow', 0.03, 0.42, 0.03, px, y + 1.55, pz, INP.ice, ry);
    b.box('glow', 0.05, 0.05, 0.05, px, y + 1.78, pz, 0xffcf90, ry);
    n += 2;
  }
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * w * 0.32, -0.1);
    b.cyl('ceramic', 0.13, 0.16, 0.16, 8, px, y + 1.12, pz, 0xb8734a, ry);
    b.cyl('glow', 0.1, 0.1, 0.04, 8, px, y + 1.22, pz, shade(INP.rust, 1.1), ry);
    n += 2;
  }
  b.box('fabric', 0.46, 0.03, 0.46, x - Math.cos(ry) * (w / 2 + 0.4), y + 1.03, z + Math.sin(ry) * (w / 2 + 0.4), 0xd2c8a8, ry, 0.06);
  n++;
  return n;
}

/** 蒲团 */
export function inCushion(b: Baker, x: number, z: number, y: number, r = 0.42, hex: number = INP.cloth2): number {
  b.cyl('fabric', r, r * 1.06, 0.16, 10, x, y + 0.08, z, hex);
  b.cyl('fabric', r * 0.72, r * 0.8, 0.1, 10, x, y + 0.2, z, shade(hex, 1.25));
  b.box('glow', 0.07, 0.05, 0.07, x, y + 0.27, z, shade(INP.phos, 0.35));
  return 3;
}

/** 印匣（可独立摆放） */
export function inSealBox(b: Baker, x: number, z: number, y: number, ry = 0): number {
  b.box('lacquer', 0.44, 0.2, 0.32, x, y + 0.1, z, INP.lacq, ry);
  b.box('lacquer', 0.5, 0.06, 0.36, x, y + 0.23, z, shade(INP.lacq, 1.5), ry);
  b.box('metal', 0.09, 0.12, 0.07, x, y + 0.13, z + Math.cos(ry) * 0.19, 0xc9a227, ry);
  b.box('glow', 0.38, 0.02, 0.03, x, y + 0.2, z + Math.cos(ry) * 0.2, shade(INP.phos, 0.4), ry);
  return 4;
}

/** 卷宗堆（成摞卷轴 + 朱签） */
export function inScrolls(b: Baker, x: number, z: number, y: number, n = 3, ry = 0): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    const [px, pz] = lp(x, z, ry, (i % 2) * 0.3 - 0.15, Math.floor(i / 2) * 0.26 - 0.13);
    b.cyl('fabric', 0.1, 0.1, 0.46, 6, px, y + 0.1 + i * 0.02, pz, shade(INP.paper, 0.86 + (i % 3) * 0.1), ry + (i % 2 ? 0.2 : -0.1), 0, Math.PI / 2);
    b.box('glow', 0.05, 0.07, 0.05, px, y + 0.11 + i * 0.02, pz + 0.24, INP.ink, ry);
    c += 2;
  }
  return c;
}

/** 矮桌/小几 */
export function inTable(b: Baker, x: number, z: number, y: number, w = 1.4, d = 0.8, h = 0.62): number {
  b.box('wood', w, 0.09, d, x, y + h, z, INP.wood2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('wood', 0.09, h - 0.05, 0.09, x + sx * (w / 2 - 0.1), y + (h - 0.05) / 2, z + sz * (d / 2 - 0.1), INP.wood);
  }
  b.box('glow', w * 0.8, 0.02, 0.04, x, y + h + 0.06, z, shade(INP.phos, 0.28));
  return 6;
}

/** 长凳 */
export function inBench(b: Baker, x: number, z: number, y: number, len = 1.9, ry = 0): number {
  b.box('wood', len, 0.09, 0.34, x, y + 0.45, z, INP.wood2, ry);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * (len / 2 - 0.16), 0);
    b.box('wood', 0.09, 0.42, 0.3, px, y + 0.21, pz, INP.wood, ry);
  }
  return 3;
}

/** 矮凳 */
export function inStool(b: Baker, x: number, z: number, y: number, h = 0.42): number {
  b.cyl('wood', 0.2, 0.24, h, 8, x, y + h / 2, z, INP.wood2);
  b.cyl('lacquer', 0.22, 0.22, 0.05, 8, x, y + h + 0.02, z, shade(INP.wood2, 1.3));
  return 2;
}

/** 汤锅（三石支 + 沸面 + 双耳） */
export function inCauldron(b: Baker, x: number, z: number, y: number, r = 1.1): number {
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.3;
    b.box('ash', 0.34, 0.42, 0.34, x + Math.cos(a) * r, y + 0.21, z + Math.sin(a) * r, shade(INP.rough, 1.0));
    n++;
  }
  b.cyl('metal', r * 0.98, r * 0.86, 0.72, 12, x, y + 0.78, z, shade(INP.cu, 0.72)); n++;
  b.cyl('glow', r * 0.9, r * 0.9, 0.08, 12, x, y + 1.12, z, 0x6b4226); n++;
  for (const s of [-1, 1]) {
    b.box('metal', 0.5, 0.1, 0.1, x + s * (r + 0.2), y + 1.06, z, shade(INP.cu, 0.8));
    n++;
  }
  return n;
}

/** 灶（三眼灶台 + 灶膛火光 + 烟道） */
export function inStove(b: Baker, x: number, z: number, y: number, w = 2.6, ry = 0): number {
  b.box('ash', w, 0.92, 1.3, x, y + 0.46, z, shade(INP.rough, 0.96), ry);
  b.box('ash', w - 0.2, 0.14, 1.1, x, y + 0.98, z, INP.roughD, ry);
  for (let k = 0; k < 3; k++) {
    const [px, pz] = lp(x, z, ry, (k - 1) * (w / 3), 0);
    b.cyl('metal', 0.3, 0.3, 0.08, 8, px, y + 1.04, pz, 0x3a3630);
    b.box('glow', 0.34, 0.1, 0.1, px, y + 0.3, pz + Math.cos(ry) * 0.66, k === 1 ? 0x6b4226 : shade(0x6b4226, 0.7), ry);
  }
  const [cx2, cz2] = lp(x, z, ry, w / 2 + 0.3, -0.4);
  b.box('ash', 0.5, 3.2, 0.5, cx2, y + 1.6, cz2, shade(INP.rough, 0.9), ry);
  return 9;
}

/** 陶瓮/水缸 */
export function inJar(b: Baker, x: number, z: number, y: number, s = 1): number {
  b.cyl('ceramic', 0.36 * s, 0.28 * s, 0.78 * s, 10, x, y + 0.39 * s, z, 0x4a4a52);
  b.cyl('ceramic', 0.3 * s, 0.34 * s, 0.12 * s, 10, x, y + 0.82 * s, z, 0x3a3a42);
  b.box('glow', 0.1, 0.04, 0.1, x, y + 0.86 * s, z, shade(INP.blue, 0.5));
  return 3;
}

/** 碗架（三层 + 粗陶碗，缺角以暗档色表达） */
export function inBowlRack(b: Baker, x: number, z: number, y: number, ry = 0, w = 2.6, bowls = 18): number {
  let n = 0;
  b.box('wood', w, 2.3, 0.12, x, y + 1.15, z, INP.wood, ry); n++;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * (w / 2 - 0.06), 0.3);
    b.box('wood', 0.12, 2.3, 0.6, px, y + 1.15, pz, INP.wood, ry);
    n++;
  }
  let c = 0;
  for (let layer = 0; layer < 3; layer++) {
    const yy = y + 0.6 + layer * 0.72;
    b.box('wood', w - 0.2, 0.08, 0.62, x + Math.sin(ry) * 0.3, yy, z + Math.cos(ry) * 0.3, INP.wood2, ry);
    n++;
    for (let k = 0; k < bowls / 3; k++) {
      const [px, pz] = lp(x, z, ry, -w / 2 + 0.24 + k * ((w - 0.44) / Math.max(1, bowls / 3 - 1)), 0.3);
      b.cyl('ceramic', 0.1, 0.07, 0.09, 5, px, yy + 0.09, pz, c % 4 === 0 ? 0x6a5c4c : 0x8a7a6a);
      c++;
    }
  }
  return n + c;
}

/** 铁床（四足 + 床板 + 三刺 + 双镣），刑具房用 */
export function inIronBed(b: Baker, x: number, z: number, y: number, ry = 0): number {
  let n = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.62, sz * 0.5);
    b.box('metal', 0.14, 0.66, 0.14, px, y + 0.33, pz, INP.iron, ry);
    n++;
  }
  b.box('metal', 1.9, 0.14, 1.3, x, y + 0.73, z, 0x3a3a44, ry); n++;
  for (let k = 0; k < 3; k++) {
    const [px, pz] = lp(x, z, ry, (k - 1) * 0.4, 0);
    b.box('metal', 0.09, 0.5, 0.09, px, y + 1.05, pz, shade(INP.steel, 1.05), ry);
    n++;
  }
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.62, 0);
    b.box('metal', 0.07, 0.46, 0.07, px, y + 0.99, pz, INP.steel, ry);
    n++;
  }
  b.box('glow', 1.5, 0.03, 0.9, x, y + 0.81, z, INP.rust, ry); n++;
  return n;
}

/** 草席榻（值夜/耳房用） */
export function inPallet(b: Baker, x: number, z: number, y: number, ry = 0): number {
  b.box('wood', 2.0, 0.16, 0.9, x, y + 0.34, z, INP.wood, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.86, sz * 0.34);
    b.box('wood', 0.12, 0.28, 0.12, px, y + 0.21, pz, INP.wood, ry);
  }
  b.box('fabric', 1.86, 0.1, 0.8, x, y + 0.47, z, 0x8a7a5a, ry);
  const [hx, hz] = lp(x, z, ry, 0, 0.62);
  b.cyl('fabric', 0.16, 0.16, 0.5, 6, hx, y + 0.56, hz, shade(INP.cloth, 1.6), ry, 0, Math.PI / 2);
  return 7;
}

/** 矮链围（观察位/围栏）：立柱 + 顶环 + 链段 */
export function inChainRing(b: Baker, x: number, z: number, y: number, r = 2.0, posts = 6): number {
  for (let k = 0; k < posts; k++) {
    const a = (k / posts) * Math.PI * 2;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    b.cyl('metal', 0.06, 0.08, 0.9, 6, px, y + 0.45, pz, INP.iron);
    b.box('glow', 0.09, 0.09, 0.09, px, y + 0.94, pz, shade(INP.phos, 0.4));
    const b2 = (k + 0.5) / posts * Math.PI * 2;
    const seg = 2 * r * Math.sin(Math.PI / posts);
    b.box('metal', 0.04, 0.04, seg, x + Math.cos(b2) * r * Math.cos(Math.PI / posts), y + 0.72, z + Math.sin(b2) * r * Math.cos(Math.PI / posts), shade(INP.steel, 0.9), -b2 + Math.PI / 2);
  }
  return posts * 3;
}

/** 悬挂灯笼（杆 + 罩 + 焰） */
export function inLantern(b: Baker, x: number, z: number, y: number, hex: number = INP.phos): number {
  b.box('wood', 0.05, 0.5, 0.05, x, y + 0.25, z, INP.wood);
  b.box('metal', 0.3, 0.06, 0.3, x, y, z, 0x2a2622);
  b.box('glow', 0.26, 0.34, 0.26, x, y - 0.2, z, hex);
  b.box('metal', 0.26, 0.05, 0.26, x, y - 0.39, z, 0x2a2622);
  b.box('glow', 0.04, 0.24, 0.04, x, y - 0.52, z, shade(INP.ink, 1.1));
  return 5;
}

// ============ WS-25 地府局部光源（J4-29）：灯柱 / 火盆 / 魂灯 ============
// J4-29（naihe 63.7 / wangxiang 68.8，人间街景 88–110）：底光只有 0.72 且归编排者，本节只做局部光源与发光件——
// 石座 ash + 灯架/金属箍 metal + 灯芯 glow，三个材质组都在既有 draw call 内（0 增量），只新增三角面。
// 光色三系沿用 hells.ts：磷绿 0x3dff9c / 幽蓝 0x4d7cff / 魂火 0x9d6bff。
// 纪律：每个灯具的底面 y 一律填所在台面的顶标高（广场 y+0.07 / 月台 y+0.20 / 冥土 y），不悬空。
const WLC = {
  phos: 0x3dff9c, blue: 0x4d7cff, soul: 0x9d6bff,
  iron: 0x2a2622, ironL: 0x3a3a42, stone: 0x4e5860, stoneD: 0x3b424a, cu: 0xb87333,
} as const;

/** 灯柱（总高 h，锥顶另计 0.11）：石座 + 覆盆 + 铁杆 + 灯箍 + 灯芯 + 铁罩 + 锥顶 */
export function hellLampPost(b: Baker, x: number, z: number, y: number, hex: number, kit: string, h = 3.4): number {
  b.box('ash', 0.62, 0.22, 0.62, x, y + 0.09, z, shade(WLC.stoneD, 0.9));
  b.box('ash', 0.44, 0.26, 0.44, x, y + 0.32, z, shade(WLC.stone, 0.86));
  b.cyl('metal', 0.07, 0.1, h - 0.9, 6, x, y + 0.45 + (h - 0.9) / 2, z, WLC.iron);
  b.cyl('metal', 0.16, 0.16, 0.1, 8, x, y + h - 0.72, z, WLC.ironL);
  b.box('glow', 0.34, 0.5, 0.34, x, y + h - 0.38, z, hex);
  b.box('metal', 0.46, 0.08, 0.46, x, y + h - 0.1, z, WLC.iron);
  b.pyramid('metal', 0.04, 0.26, x, y + h + 0.02, z, WLC.ironL, 0, 1, 0.18, 1);
  b.kit(kit, 7, y + h - 0.38);
  return 7;
}

/** 火盆（1.96 高）：石座 + 三足 + 铜盆 + 炭床 + 两级焰舌 */
export function hellFireBowl(b: Baker, x: number, z: number, y: number, hex: number, kit: string, s = 1): number {
  b.box('ash', 0.9 * s, 0.24, 0.9 * s, x, y + 0.1, z, shade(WLC.stoneD, 0.9));
  b.box('ash', 0.64 * s, 0.28, 0.64 * s, x, y + 0.36, z, shade(WLC.stone, 0.84));
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.5;
    b.box('metal', 0.08, 0.44, 0.08, x + Math.cos(a) * 0.3 * s, y + 0.68, z + Math.sin(a) * 0.3 * s, WLC.iron);
  }
  b.cyl('metal', 0.56 * s, 0.34 * s, 0.34, 10, x, y + 0.92, z, shade(WLC.cu, 0.78));
  b.cyl('glow', 0.46 * s, 0.46 * s, 0.05, 10, x, y + 1.11, z, shade(hex, 0.5));
  b.cyl('glow', 0.05, 0.32 * s, 0.7, 7, x, y + 1.45, z, hex);
  b.cyl('glow', 0.03, 0.16 * s, 0.36, 6, x, y + 1.78, z, hex);
  b.kit(kit, 9, y + 1.4);
  return 9;
}

/** 魂灯（2.5 高）：石座 + 立柱 + 挑臂 + 吊杆 + 灯罩 + 灯芯 + 罩底。ry 决定挑臂挂出的方位 */
export function hellSoulLantern(b: Baker, x: number, z: number, y: number, hex: number, kit: string, ry = 0): number {
  b.box('ash', 0.56, 0.2, 0.56, x, y + 0.08, z, shade(WLC.stoneD, 0.9));
  b.cyl('metal', 0.08, 0.12, 2.5, 6, x, y + 1.35, z, WLC.iron);
  const [ax, az] = lp(x, z, ry, 0, 0.46);
  b.box('metal', 0.07, 0.07, 0.92, ax, y + 2.62, az, WLC.ironL, ry);
  const [hx, hz] = lp(x, z, ry, 0, 0.86);
  b.box('metal', 0.03, 0.2, 0.03, hx, y + 2.48, hz, WLC.iron, ry);
  b.box('metal', 0.3, 0.06, 0.3, hx, y + 2.36, hz, WLC.iron, ry);
  b.box('glow', 0.26, 0.36, 0.26, hx, y + 2.14, hz, hex, ry);
  b.cyl('metal', 0.03, 0.2, 0.14, 4, hx, y + 1.89, hz, WLC.ironL, ry);
  b.kit(kit, 7, y + 2.14);
  return 7;
}

/** WS-25 布点：阎罗殿前广场 6 / 十八狱环道 6 / 孟婆庄 6 / 三生石 4 / 望乡台 6（点光另见 HELL_LIGHTS） */
export function buildUnderworldLamps(b: Baker): void {
  const y = UNDER.y;
  // 阎罗殿前广场（铺装顶 y+0.07，46×50 @ z100）：四角大灯柱撑出台面边界 + 殿前一对
  for (const sx of [-1, 1]) {
    hellLampPost(b, sx * 21, 80, y + 0.07, WLC.phos, 'hell.light.lampPost');
    hellLampPost(b, sx * 21, 122, y + 0.07, WLC.phos, 'hell.light.lampPost');
    hellLampPost(b, sx * 11.5, 77, y + 0.07, WLC.phos, 'hell.light.lampPost');
  }
  // 十八狱环道外缘 6（环心 (0,55) 半径 78，每 60°；离最近狱心 ≥17.7m，避开门洞/月台/骨白路 x±5.5）
  const RING: readonly (readonly [number, number])[] = [
    [55.6, -10.8], [84.6, 70.2], [29.4, 135.9], [-55.6, 120.8], [-84.6, 39.8], [-29.9, -25.4],
  ];
  RING.forEach(([lx, lz], i) => hellLampPost(b, lx, lz, y, i % 3 === 2 ? WLC.soul : WLC.phos, 'hell.light.lampPost'));
  // 孟婆庄（庄前铺装 32×26 @ (-38,-133)，顶 y+0.06）：前庭四角火盆 + 引路两支灯柱。
  // 北侧庄院墙圈 x−52..−28 / z−138..−158，故四角取 z −122.6 与 −136.4，全部留在墙外前庭
  for (const lz of [-122.6, -136.4]) {
    hellFireBowl(b, -52.6, lz, y + 0.06, WLC.phos, 'hell.light.fireBowl');
    hellFireBowl(b, -26.6, lz, y + 0.06, WLC.phos, 'hell.light.fireBowl');
  }
  hellLampPost(b, -13, -134.6, y, WLC.phos, 'hell.light.lampPost');
  hellLampPost(b, -7, -125.4, y, WLC.phos, 'hell.light.lampPost');
  // 三生石四正面外侧 4（r8.6：石栏 r7.2 之外、四幡 r9.6 之内；挑臂走切向，不压幡杆）。
  // 台面是 r11.5 的贴地石盘（顶 y+0.12），灯座取该面标高，不埋进盘面
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    hellSoulLantern(b, 24 + Math.cos(a) * 8.6, -108 + Math.sin(a) * 8.6, y + 0.12, WLC.blue, 'sansheng.light.approachLamp', a + Math.PI / 2);
  }
  // 望乡台：台基一、二层南向收分台面（y+5.3 / y+10.6）+ 台顶（y+15.9）各一对火盆，全部落在可站台面上
  for (const sx of [-1, 1]) {
    hellFireBowl(b, -150 + sx * 11.5, -150 + 11.5, y + 5.3, WLC.blue, 'wangxiang.light.fireBowl', 1.05);
    hellFireBowl(b, -150 + sx * 8.6, -150 + 8.6, y + 10.6, WLC.blue, 'wangxiang.light.fireBowl', 0.95);
    hellFireBowl(b, -150 + sx * 5.2, -150, y + 15.9, WLC.blue, 'wangxiang.light.towerLamp', 0.8);
  }
}

// ============ WS-22 鬼域市集（J1-11）：十八狱环 ↔ 望乡台之间的西北楔形空地 ============
// 域：以望乡台 (-150,-150) 为极点的扇环 r30–70、方位 0.20–1.20 rad，只取黄泉河北岸（z ≤ -92.5）的陆面，
// 净面积 1927㎡；构件 56 件 → 2.9 件/100㎡（密度线 2 件/100㎡）。
// 盘道 r15.5 与台脚碑林（r≤24.5）、狱体（最近狱心 91.8m）、孟婆庄铺装（32.4m）、骨白路灯柱（79m）全在域外；
// 所有构件自 UNDER.y 起，不悬空。
const GMK = { cx: -150, cz: -150 } as const;
const gmP = (a: number, r: number): [number, number] => [GMK.cx + Math.cos(a) * r, GMK.cz + Math.sin(a) * r];
/** 棚口/碑面朝向（Baker 的 ry）：局部 +z 指向半径外（out）或半径内 */
const gmFace = (a: number, out: boolean): number => Math.PI / 2 - a + (out ? 0 : Math.PI);

/** 摊棚：踏平地 + 四柱 + 四坡布棚 + 檐口木框 + 台面台腿 + 后架 + 三件杂货 + 檐下磷灯 + 前幌 */
function gmStall(b: Baker, a: number, r: number, out: boolean, i: number): void {
  const y = UNDER.y;
  const [x, z] = gmP(a, r);
  const ry = gmFace(a, out);
  b.box('earth', 4.9, 0.05, 4.0, x, y + 0.025, z, shade(0x3a3230, 1.0 + (i % 2) * 0.1), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 1.62, sz * 1.0);
    b.box('wood', 0.14, 2.34, 0.14, px, y + 1.17, pz, 0x241a14, ry);
  }
  b.pyramid('fabric', 0.1, 1, x, y + 2.68, z, [0x3a2c22, 0x2b3a34, 0x34263a][i % 3], ry, 3.05, 0.68, 2.5);
  for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, 0, sz * 1.77);
    b.box('wood', 4.34, 0.09, 0.09, px, y + 2.36, pz, 0x2e2018, ry);
  }
  for (const sx of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 2.16, 0);
    b.box('wood', 0.09, 0.09, 3.54, px, y + 2.36, pz, 0x2e2018, ry);
  }
  // 台面 + 两条板腿 + 后架（架板与两立柱）
  const [cx2, cz2] = lp(x, z, ry, 0, 0.55);
  b.box('wood', 2.9, 0.1, 0.78, cx2, y + 0.96, cz2, 0x3a2c22, ry);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.22, 0.55);
    b.box('wood', 0.12, 0.9, 0.66, px, y + 0.46, pz, 0x241a14, ry);
  }
  const [bx2, bz2] = lp(x, z, ry, 0, -0.76);
  b.box('wood', 2.7, 0.08, 0.5, bx2, y + 1.44, bz2, 0x3a2c22, ry);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.2, -0.76);
    b.box('wood', 0.1, 1.44, 0.44, px, y + 0.72, pz, 0x241a14, ry);
  }
  // 货：四类轮换（粗陶碗 / 纸钱捆 / 陶瓮 / 布卷）
  for (let g = 0; g < 3; g++) {
    const [gx2, gz2] = lp(x, z, ry, -0.9 + g * 0.9, 0.55);
    if (i % 4 === 0) b.cyl('ceramic', 0.12, 0.09, 0.1, 8, gx2, y + 1.06, gz2, 0x8a7a6a, ry);
    else if (i % 4 === 1) b.box('fabric', 0.34, 0.16, 0.26, gx2, y + 1.09, gz2, shade(0xc9b380, 0.9 + g * 0.05), ry + g * 0.3);
    else if (i % 4 === 2) b.cyl('ceramic', 0.14, 0.17, 0.24, 8, gx2, y + 1.13, gz2, 0x4a4a52, ry);
    else b.cyl('fabric', 0.1, 0.1, 0.4, 6, gx2, y + 1.08, gz2, shade(0x2b1b3d, 1.6), ry, 0, Math.PI / 2);
  }
  // 檐下磷灯：吊杆 + 罩箍 + 芯
  const [lx2, lz2] = lp(x, z, ry, 1.5, 1.5);
  b.box('wood', 0.05, 0.24, 0.05, lx2, y + 2.4, lz2, 0x241a14, ry);
  b.box('metal', 0.26, 0.05, 0.26, lx2, y + 2.3, lz2, 0x2a2622, ry);
  b.box('glow', 0.2, 0.22, 0.2, lx2, y + 2.16, lz2, 0x3dff9c, ry);
  // 前幌（分色破布）
  const [vx2, vz2] = lp(x, z, ry, 0, 1.8);
  b.box('fabric', 2.8, 0.32, 0.05, vx2, y + 2.16, vz2, i % 2 ? 0x2a5c42 : 0x5c2a2a, ry);
  b.kit('hell.market.stall', 1, y + 2.4);
}

/** 鬼差列位：一组两身（相距 0.56m），下裳/上身/头/笠帽/戟杆/戟刃/磷目 */
function gmGuard(b: Baker, a: number, r: number, out: boolean, i: number): void {
  const y = UNDER.y;
  const base = gmFace(a, out);
  for (const s of [-1, 1]) {
    const [gx2, gz2] = gmP(a, r);
    const px = gx2 - Math.sin(a) * s * 0.56, pz = gz2 + Math.cos(a) * s * 0.56;
    const f = base + (s > 0 ? 0.12 : -0.12);
    b.box('wood', 0.54, 1.0, 0.36, px, y + 0.5, pz, 0x1e2a26, f);
    b.box('wood', 0.64, 0.92, 0.4, px, y + 1.44, pz, 0x243430, f);
    b.box('wood', 0.26, 0.28, 0.26, px, y + 2.03, pz, 0x8fb898, f);
    b.box('wood', 0.68, 0.12, 0.68, px, y + 2.2, pz, 0x1a1418, f);
    b.box('wood', 0.2, 0.16, 0.2, px, y + 2.3, pz, 0x1a1418, f);
    const hx = px + Math.cos(f) * 0.44, hz = pz - Math.sin(f) * 0.44;
    b.box('wood', 0.05, 2.5, 0.05, hx, y + 1.25, hz, 0x3a3a42, f, 0, 0.1);
    b.box('metal', 0.26, 0.3, 0.05, hx, y + 2.56, hz, 0x9aa6b8, f);
    b.box('glow', 0.06, 0.06, 0.06, px + Math.sin(f) * 0.15, y + 2.07, pz + Math.cos(f) * 0.15, 0x3dff9c, f);
    if (i % 3 === 0) b.box('metal', 0.4, 0.06, 0.06, px, y + 1.05, pz, 0x8a8a92, f);
  }
  b.kit('hell.market.guard', 1, y + 1.1);
}

/** 锁链桩：石础 + 桩身 + 顶环 + 四节垂链 + 血渍 */
function gmChainStake(b: Baker, a: number, r: number, i: number): void {
  const y = UNDER.y;
  const [x, z] = gmP(a, r);
  const ry = Math.PI / 2 - a + i * 0.35;
  b.box('ash', 0.9, 0.24, 0.9, x, y + 0.12, z, shade(0x3b424a, 0.94), ry);
  b.cyl('wood', 0.16, 0.24, 2.0, 6, x, y + 1.22, z, 0x241c16);
  b.cyl('metal', 0.22, 0.22, 0.09, 8, x, y + 2.26, z, 0x9a9aa2, ry, Math.PI / 2);
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    b.box('metal', 0.13, 0.2, 0.06, x + Math.sin(ry) * (0.4 + t * 1.25), y + 1.56 - t * 1.2, z + Math.cos(ry) * (0.4 + t * 1.25), 0x8a8a92, ry + (k % 2 ? 0.5 : -0.5));
  }
  b.box('glow', 0.66, 0.03, 0.66, x, y + 0.25, z, 0x5c1018, ry);
  b.kit('hell.market.chainStake', 1, y + 1.2);
}

/** 磷火灯：石座 + 木柱 + 挑臂 + 灯罩 + 磷芯 + 罩箍 */
function gmGhostLamp(b: Baker, a: number, r: number): void {
  const y = UNDER.y;
  const [x, z] = gmP(a, r);
  const ry = Math.PI / 2 - a;
  b.box('ash', 0.52, 0.18, 0.52, x, y + 0.09, z, shade(0x3b424a, 0.96), ry);
  b.cyl('wood', 0.09, 0.13, 3.0, 6, x, y + 1.68, z, 0x1c141a);
  const [ax2, az2] = lp(x, z, ry, 0, 0.3);
  b.box('wood', 0.08, 0.08, 0.62, ax2, y + 3.12, az2, 0x2a2018, ry);
  const [hx2, hz2] = lp(x, z, ry, 0, 0.62);
  b.box('metal', 0.3, 0.44, 0.3, hx2, y + 2.9, hz2, 0x2a2622, ry);
  b.box('glow', 0.22, 0.3, 0.22, hx2, y + 2.9, hz2, 0x3dff9c, ry);
  b.box('metal', 0.34, 0.06, 0.34, hx2, y + 3.14, hz2, 0x2a2622, ry);
  b.kit('hell.market.lamp', 1, y + 2.9);
}

/** 纸钱堆：三沓错缝 + 压石 + 两张散落 + 余烬 */
function gmPaperPile(b: Baker, a: number, r: number, i: number): void {
  const y = UNDER.y;
  const [x, z] = gmP(a, r);
  const ry = 0.2 + i * 0.63;
  const paper = 0xc9b380;
  b.box('fabric', 0.74, 0.1, 0.56, x, y + 0.06, z, shade(paper, 0.9), ry);
  b.box('fabric', 0.68, 0.09, 0.5, x + 0.06, y + 0.15, z - 0.04, shade(paper, 0.82), ry + 0.22);
  b.box('fabric', 0.6, 0.08, 0.46, x - 0.05, y + 0.23, z + 0.05, shade(paper, 0.96), ry - 0.16);
  b.box('ash', 0.24, 0.12, 0.22, x + 0.02, y + 0.33, z - 0.02, 0x4a4450, ry);
  for (let k = 0; k < 2; k++) {
    b.box('fabric', 0.3, 0.02, 0.22, x + Math.cos(ry + k * 1.3) * 0.62, y + 0.03, z + Math.sin(ry + k * 1.3) * 0.62, shade(paper, 0.68), ry + k * 1.3);
  }
  b.box('glow', 0.16, 0.05, 0.16, x + 0.2, y + 0.04, z - 0.16, 0x6b4226);
  b.kit('hell.market.paperPile', 1, y + 0.2);
}

/** 判词碑：碑座 + 座身 + 碑身 + 碑首（四棱台）+ 碑文磷光 */
function gmStele(b: Baker, a: number, r: number, i: number): void {
  const y = UNDER.y;
  const [x, z] = gmP(a, r);
  const ry = gmFace(a, false);
  const h = 1.9 + (i % 3) * 0.26;
  b.box('ash', 1.7, 0.36, 0.95, x, y + 0.18, z, shade(0x3b424a, 0.95), ry);
  b.box('ash', 1.18, 0.26, 0.66, x, y + 0.49, z, shade(0x3b424a, 1.08), ry);
  b.box('ash', 0.88, h, 0.3, x, y + 0.62 + h / 2, z, shade(0x4e5860, 1.02), ry);
  b.pyramid('ash', 0.12, 0.62, x, y + 0.75 + h, z, shade(0x3b424a, 1.12), ry, 0.62, 0.26, 0.44);
  b.box('glow', 0.58, 0.05, 0.04, x + Math.sin(ry) * 0.17, y + 0.62 + h * 0.62, z + Math.cos(ry) * 0.17, 0x3dff9c, ry);
  b.kit('hell.market.stele', 1, y + 0.9);
}

/** 鬼域市集总装：摊棚 8 / 鬼差 12 组 / 锁链桩 10 / 磷火灯 12 / 纸钱堆 8 / 判词碑 6 = 56 件 */
export function buildGhostMarket(b: Baker): void {
  // 内排摊棚 r40 棚口朝外、外排 r56 棚口朝内，中间 12m 市道
  const STALL_IN: readonly (readonly [number, number])[] = [[0.28, 40], [0.44, 40], [0.60, 40], [0.76, 40]];
  const STALL_OUT: readonly (readonly [number, number])[] = [[0.36, 56], [0.52, 56], [0.68, 56], [0.84, 56]];
  // 鬼差：台前 6 组列位（背台面市，0.80–0.95 方位让开工位视线）+ 外缘 6 组封锁
  const GUARD_IN: readonly (readonly [number, number])[] = [[0.26, 31.5], [0.40, 31.5], [0.54, 31.5], [0.68, 31.5], [1.02, 31.5], [1.16, 31.5]];
  const GUARD_OUT: readonly (readonly [number, number])[] = [[0.40, 66], [0.52, 66], [0.64, 66], [0.76, 66], [0.88, 66], [1.00, 66]];
  const CHAINS: readonly (readonly [number, number])[] = [
    [0.30, 36], [0.70, 36], [0.24, 43], [0.72, 43], [0.32, 53], [0.80, 53],
    [0.44, 60], [0.60, 60], [0.36, 68], [0.88, 68],
  ];
  const LAMP_IN: readonly (readonly [number, number])[] = [[0.24, 35], [0.37, 35], [0.50, 35], [0.63, 35], [1.03, 35], [1.16, 35]];
  const LAMP_OUT: readonly (readonly [number, number])[] = [[0.36, 63], [0.50, 63], [0.64, 63], [0.78, 63], [0.92, 63], [1.06, 63]];
  const PAPER: readonly (readonly [number, number])[] = [
    [0.34, 46], [0.48, 46], [0.62, 46], [0.76, 46], [0.41, 50], [0.55, 50], [0.69, 50], [0.31, 43],
  ];
  const STELES: readonly (readonly [number, number])[] = [[0.34, 62], [0.47, 62], [0.60, 62], [0.73, 62], [0.86, 62], [0.99, 62]];
  STALL_IN.forEach(([a, r], i) => gmStall(b, a, r, true, i));
  STALL_OUT.forEach(([a, r], i) => gmStall(b, a, r, false, i + 4));
  GUARD_IN.forEach(([a, r], i) => gmGuard(b, a, r, true, i));
  GUARD_OUT.forEach(([a, r], i) => gmGuard(b, a, r, false, i));
  CHAINS.forEach(([a, r], i) => gmChainStake(b, a, r, i));
  LAMP_IN.forEach(([a, r]) => gmGhostLamp(b, a, r));
  LAMP_OUT.forEach(([a, r]) => gmGhostLamp(b, a, r));
  PAPER.forEach(([a, r], i) => gmPaperPile(b, a, r, i));
  STELES.forEach(([a, r], i) => gmStele(b, a, r, i));
}

// ============ 冥府穹：地府自己的天 ============
// 从地府（y≈−260）往上看，原本没有顶：视线上方是人间地面/地形的底面（雾化成灰紫），
// 再往上穿出地形覆盖区就是 world.ts:403 那层球面天穹（uBot=0xd46a2e 橙红、uTop=0x1a2b52）的
// 地平线橙红带——两者的交界就是画面上那块"带缺口的暗红多边形"。
// 这里给地府补一层封闭岩穹：岩顶压在 −34（人间地表 y=0 以下，绝不外露），岩壁 R=980，
// 任何仰角都被岩顶或岩壁接住。全部用 box 砌：Baker.cyl 造的是单面朝外的筒，从内看会被背面剔除，
// 只有 box 六面俱在，内视安全。
const CAV = { cx: 170, cz: -10, r: 980, yTop: -34, yRim: -134, y0: UNDER.y - 3 };

/** 坐标 hash（不消耗共享 RNG 序列，确定性） */
const cavHash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function buildUnderCavern(b: Baker): void {
  const { cx, cz, r, yTop, yRim, y0 } = CAV;
  const seg = 48;
  const hw = ((2 * Math.PI * r) / seg) * 1.22;   // 砌块宽 1.22 倍搭接：拼缝不漏
  const wh = yRim - y0;
  // 岩壁：48 段砌块 + 24 道向内凸的岩肋
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    b.box('earth', hw, wh, 14, x, (yRim + y0) / 2, z, shade(0x2b2119, 0.82 + (i % 4) * 0.05), -a - Math.PI / 2);
    if (i % 2 === 0) {
      b.box('ash', hw * 0.44, wh - 8, 6, x - Math.cos(a) * 9, (yRim + y0) / 2 - 3, z - Math.sin(a) * 9, shade(0x3a342e, 0.76 + (i % 3) * 0.07), -a - Math.PI / 2);
    }
  }
  // 岩顶：四级阶梯内收（外低内高），四张实心板叠出穹形，几何上无缝隙
  const slabs: readonly (readonly [number, number, number])[] = [
    [1000, 820, yRim], [760, 620, -104], [520, 430, -76], [300, 250, -46],
  ];
  for (const [hx, hz, yb] of slabs) {
    b.box('earth', hx * 2, 10, hz * 2, cx, yb + 5, cz, shade(0x241c17, 0.92));
    b.box('ash', hx * 1.94, 0.5, hz * 1.94, cx, yb - 0.3, cz, shade(0x322c26, 0.7));
  }
  // 垂石钟乳：按坐标 hash 布点，避开环心（十八狱环/阎罗殿上空留空，不压建筑轮廓）
  for (let i = 0; i < 84; i++) {
    const rr = 150 + cavHash(i * 3.17) * 790;
    const a = i * 2.39996;
    const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
    let yb = yRim;
    if (Math.abs(dx) <= 300 && Math.abs(dz) <= 250) yb = -46;
    else if (Math.abs(dx) <= 520 && Math.abs(dz) <= 430) yb = -76;
    else if (Math.abs(dx) <= 760 && Math.abs(dz) <= 620) yb = -104;
    const len = 3 + cavHash(i * 7.7) * 13;
    const rad = 0.7 + cavHash(i * 5.3) * 2.0;
    b.cyl('ash', rad, 0, len, 6, cx + dx, yb - len / 2, cz + dz, shade(0x342e28, 0.72 + cavHash(i * 2.1) * 0.2), a);
  }
  // 穹上鬼火（小面积 glow）：环带上 14 点磷绿 + 6 道暗红岩缝，只做层次不做泛光
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.3;
    const rr = 620 + (i % 3) * 90;
    const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
    const yb = (Math.abs(dx) <= 760 && Math.abs(dz) <= 620) ? -104 : yRim;
    b.box('glow', 0.9, 0.5, 0.9, cx + dx, yb - 6, cz + dz, i % 5 === 0 ? 0x8a1a1a : 0x3dff9c);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    b.box('glow', 0.5, 26, 0.5, cx + Math.cos(a) * (r - 7), yRim - 26, cz + Math.sin(a) * (r - 7), 0x8a1a1a, -a - Math.PI / 2);
  }
}

export function buildUnderworld(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  const y = UNDER.y;
  buildUnderCavern(b);
  // 冥土大地 + 骨白路
  b.box('ground', 760, 0.6, 400, 0, y - 0.3, 0, 0x2e2228);
  b.box('ground', 11, 0.16, 340, 0, y + 0.02, -40, 0x9a948c);
  b.box('ground', 11, 0.16, 120, 0, y + 0.02, 120, 0x9a948c);
  // 黄泉河：深血色水面 + 浊浪/血沫 + 石砌河岸（旧版是一整片高饱和红板，像铺了红毯）
  b.box('ground', 760, 0.4, 60, 0, y - 1.2, -60, 0x12080c);
  b.box('ground', 756, 0.3, 52, 0, y + 0.02, -60, 0x3a0a10);
  // 浊浪：沿流向拉长的暗红亮条，打散平涂
  for (let i = 0; i < 46; i++) {
    const rx = ((i * 137) % 700) - 340;
    const rz = -86 + ((i * 53) % 48);
    const w = 18 + ((i * 29) % 46);
    b.box('glow', w, 0.06, 0.5 + (i % 3) * 0.3, rx, y + 0.16, rz, i % 4 === 0 ? 0x8a1a24 : 0x5c1018);
  }
  // 血沫：零散小块，给水面颗粒
  for (let i = 0; i < 40; i++) {
    const rx = ((i * 211) % 720) - 355;
    const rz = -86 + ((i * 67) % 50);
    b.box('glow', 1.2 + (i % 3) * 0.8, 0.05, 0.8 + (i % 4) * 0.5, rx, y + 0.19, rz, 0x9a2430);
  }
  // 石砌河岸：两岸挡墙 + 望柱 + 临水石阶
  // 760m 通长的挡墙原先挂 'wall' 组（蓝灰自发光）——整条黄泉两岸因此是一条灰带，全部改石作 'ash'。
  for (const bank of [-88.6, -31.4]) {
    b.box('ash', 760, 1.5, 1.4, 0, y + 0.55, bank, shade(0x33393f, 1.0));
    b.box('ash', 760, 0.22, 1.7, 0, y + 1.36, bank, shade(0x3b424a, 1.05));
    for (let k = -18; k <= 18; k++) {
      b.box('ash', 0.4, 0.9, 0.4, k * 20, y + 1.9, bank, shade(0x3b424a, 1.1));
      if (k % 2 === 0) b.box('glow', 0.14, 0.2, 0.14, k * 20, y + 2.42, bank, bank < -60 ? 0x3dff9c : 0xff3a4a);
    }
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      for (let st = 0; st < 3; st++) {
        b.box('ash', 6, 0.3, 1.0, k * 120, y - 0.3 - st * 0.3, bank + (bank < -60 ? 1.2 + st * 1.0 : -1.2 - st * 1.0), shade(0x3b424a, 1.0 - st * 0.04));
      }
    }
  }
  // 奈何桥
  const N = 12;
  for (let i = 0; i < N; i++) {
    const z0 = -88 + (56 * i) / N, z1 = -88 + (56 * (i + 1)) / N;
    const zm = (z0 + z1) / 2;
    const yy = y + 2.2 + Math.sin((i + 0.5) / N * Math.PI) * 1.75;
    const slope = Math.atan2(y + 2.2 + Math.sin(((i + 1) / N) * Math.PI) * 1.75 - yy, z1 - z0);
    b.box('wood', 9, 0.3, (z1 - z0) * 1.1, 0, yy, zm, shade(0x4a382a, 0.98), 0, -slope, 0);
    // 桥面石阶横缝：三段暗色分格，避免一整条光板
    for (let pl = 0; pl < 3; pl++) {
      b.box('wood', 8.6, 0.05, 0.16, 0, yy + 0.16, z0 + (z1 - z0) * (pl + 0.5) / 3, 0x2a1e16, 0, -slope, 0);
    }
    for (const sx of [-1, 1]) {
      // 望柱 + 上下两道扶手（旧版只有孤柱没有横栏，桥面读作无栏平板）
      b.box('wood', 0.2, 1.15, 0.2, sx * 4.3, yy + 0.64, zm, 0x2c2018);
      b.box('wood', 0.16, 0.16, (z1 - z0) * 1.12, sx * 4.3, yy + 1.2, zm, shade(0x4a382a, 1.05), 0, -slope, 0);
      b.box('wood', 0.12, 0.12, (z1 - z0) * 1.12, sx * 4.3, yy + 0.78, zm, shade(0x3a2c22, 1.0), 0, -slope, 0);
      if (i % 2 === 0) b.box('glow', 0.34, 0.46, 0.34, sx * 4.3, yy + 1.5, zm, 0x3dff9c);
    }
  }
  // 桥头「奈何橋」匾
  sg.quad(atlas.text('naihe', '奈何橋', 300, 90, { color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(6,10,8,0.9)', border: 'rgba(61,255,156,.8)', fontPx: 64 }), 6, 1.8, 0, y + 7.6, -88, 0);
  // 阎罗殿
  const py = y, px = 0, pz = 60;
  // ============ 阎罗殿大朝：按凌霄殿构造层级重做（灰模根治 + 体量拉到天宫同级） ============
  // 判词（用户原话）：「地府的建筑都有灰模？彻底解决！」「要和天宫一样高大、精致、壮观、宏伟、瑰丽！」
  // 旧版两条病根：
  //   ① 殿身四面全挂在 'wall' 组。该组是 MeshLambertMaterial + emissive 0x3a3d48（蓝灰自发光），
  //      顶点色再深也被自发光压平 —— 实测补光后整面读作灰蓝素板，这就是「没材质」的真相；
  //   ② 几何本身就是 42×11×20 的实心盒 + 两片平屋面：无台基分层、无柱列、无额枋、无斗栱、无瓦垄。
  // 新版层级与凌霄殿同构：三层须弥座 → 丹陛御路 → 栏板望柱 → 九间檐柱 → 额枋彩画 → 密排斗栱
  //   → 下檐 → 二层殿身 → 中檐 → 三层殿身 → 上檐 → 正脊 / 鸱吻 / 宝顶。
  // 原 42m 法庭（buildYanluoRooms R01–R08）整组保留在新殿身内，作「殿中殿」；室内坐标一格未动。
  const HW = 76, HD = 40, HZ = 52;            // 面阔 76m / 进深 40m / 殿心 z=52
  const FLR = py + 2.6;                       // 殿内地坪 = 旧台基顶（室内壳不动，故必须对齐）
  const X0 = px - HW / 2, X1 = px + HW / 2;   // ±38
  const Z0 = HZ - HD / 2, Z1 = HZ + HD / 2;   // 32 / 72
  const MB = 0x4a4450;                        // 青石（地府不用汉白玉）
  const LACQ = 0x3a1420;                      // 朱漆
  const PAINT = 0x2b4a52;                     // 和玺彩画青绿底
  const TILE = 0x39404c;                      // 冥制筒瓦（比旧 #33393F 提亮半档：太暗整顶溶进夜空，太亮俯视像水泥板）
  const CU = 0x8a6a2a;                        // 铜饰

  // ---- ① 三层须弥座台基：每层「下枋 / 束腰 / 上枋」，逐层收 8×4m ----
  // 旧版是一整块 52×2.6×30 的灰板（'wall' 组），没有任何石作线脚。
  const tier = (tw: number, td: number, yb: number, top: number, n: number): void => {
    const h = top - yb;
    b.box('ash', tw, h * 0.38, td, px, yb + h * 0.19, HZ, shade(MB, 0.96));            // 下枋
    b.box('ash', tw - 0.9, h * 0.30, td - 0.9, px, yb + h * 0.52, HZ, shade(MB, 0.84)); // 束腰
    b.box('ash', tw - 0.2, h * 0.18, td - 0.2, px, yb + h * 0.89, HZ, shade(MB, 1.06)); // 上枋
    // 束腰壸门：南北两面各一排浅龛，读出「石作」而不是一块板
    const span = tw - 3.2;
    for (let i = 0; i < n; i++) {
      const gx = px - span / 2 + (i * span) / (n - 1);
      b.box('ash', 1.5, h * 0.2, 0.22, gx, yb + h * 0.52, HZ + td / 2 - 0.42, shade(MB, 0.72));
      b.box('ash', 1.5, h * 0.2, 0.22, gx, yb + h * 0.52, HZ - td / 2 + 0.42, shade(MB, 0.72));
    }
    const nd = Math.max(3, Math.round((td - 4) / 5));
    for (let i = 0; i < nd; i++) {
      const gz = HZ - (td - 3.2) / 2 + (i * (td - 3.2)) / (nd - 1);
      for (const s of [-1, 1]) b.box('ash', 0.22, h * 0.2, 1.5, px + s * (tw / 2 - 0.42), yb + h * 0.52, gz, shade(MB, 0.72));
    }
  };
  tier(104, 50, py, py + 0.85, 12);
  tier(96, 46, py + 0.85, py + 1.75, 11);
  tier(88, 42, py + 1.75, py + 2.6, 10);
  // 台面铺装：阶条石 + 双向分缝（俯视时台明不是一整块灰板）
  for (const [yy, tw, td] of [[py + 0.85, 104, 50], [py + 1.75, 96, 46], [py + 2.6, 88, 42]] as const) {
    b.box('ash', tw - 0.6, 0.06, 0.34, px, yy + 0.03, HZ + td / 2 - 0.7, shade(MB, 1.14));
    b.box('ash', tw - 0.6, 0.06, 0.34, px, yy + 0.03, HZ - td / 2 + 0.7, shade(MB, 1.14));
    for (let x2 = -tw / 2 + 3; x2 <= tw / 2 - 3; x2 += 4.2) b.box('ash', 0.14, 0.03, td - 1.6, px + x2, yy + 0.02, HZ, shade(MB, 0.7));
    for (let z2 = -td / 2 + 3; z2 <= td / 2 - 3; z2 += 4.2) b.box('ash', tw - 1.6, 0.03, 0.14, px, yy + 0.02, HZ + z2, shade(MB, 0.7));
    b.kit('yanluo.terracePave', 1, yy);
  }
  b.kit('yanluo.terrace', 3, py + 0.9);

  // ---- ② 栏板望柱：台基外缘一圈，望柱 2.6m 一柱；正面让开丹陛 ----
  const railAt = (ax: number, az: number, bx: number, bz: number, yy: number): void => {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.5) return;
    const ry = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / 2.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.box('ash', 0.26, 1.16, 0.26, ax + dx * t, yy + 0.58, az + dz * t, shade(MB, 1.04));
      b.box('ash', 0.36, 0.16, 0.36, ax + dx * t, yy + 1.24, az + dz * t, shade(MB, 1.16));
    }
    b.box('ash', len, 0.16, 0.18, (ax + bx) / 2, yy + 0.96, (az + bz) / 2, shade(MB, 1.0), ry);
    b.box('ash', len, 0.1, 0.14, (ax + bx) / 2, yy + 0.5, (az + bz) / 2, shade(MB, 0.92), ry);
    b.box('ash', len, 0.36, 0.12, (ax + bx) / 2, yy + 0.26, (az + bz) / 2, shade(MB, 0.86), ry);
    b.kit('yanluo.rail', n + 3, yy);
  };
  const RY = py + 0.85;                       // 一层台明顶
  railAt(X0 - 14, HZ + 25, px - 8, HZ + 25, RY);   // 正面（左）
  railAt(px + 8, HZ + 25, X1 + 14, HZ + 25, RY);   // 正面（右）
  railAt(X0 - 14, HZ - 25, X1 + 14, HZ - 25, RY);  // 背面
  railAt(X0 - 14, HZ - 25, X0 - 14, HZ + 25, RY);  // 西侧
  railAt(X1 + 14, HZ - 25, X1 + 14, HZ + 25, RY);  // 东侧

  // ---- ③ 丹陛：九级踏跺 + 御路石 + 垂带，自台基前缘（z=77）落到冥土 ----
  const ST_Z = HZ + 25, ST_N = 9, ST_RISE = 2.6 / ST_N, ST_TREAD = 0.56;
  for (let i = 1; i <= ST_N; i++) {
    const top = 2.6 - i * ST_RISE;
    if (top <= 0.02) break;
    b.box('ash', 16, top, ST_TREAD, px, py + top / 2, ST_Z + (i - 1) * ST_TREAD + ST_TREAD / 2, shade(MB, i % 2 ? 0.98 : 1.03));
  }
  const RUN = ST_N * ST_TREAD, MIDZ = ST_Z + RUN / 2, MIDY = py + 1.3;
  const SANG = Math.atan2(2.6, RUN), SLOPE = Math.hypot(RUN, 2.6) + 0.5;
  b.box('ash', 3.8, 0.4, SLOPE, px, MIDY + 0.12, MIDZ, shade(MB, 1.08), 0, SANG, 0);   // 御路石
  for (let k = 0; k < 6; k++) {                                                        // 云龙浅刻（暗色薄片）
    const s = (k - 2.5) * 0.9;
    b.box('ash', 2.2, 0.06, 0.7, px, MIDY + 0.34 - s * Math.sin(SANG), MIDZ + s * Math.cos(SANG), shade(MB, 0.7), 0, SANG, 0);
  }
  for (const s of [-1, 1]) {
    b.box('ash', 0.5, 0.52, SLOPE, px + s * 2.15, MIDY + 0.2, MIDZ, shade(MB, 1.02), 0, SANG, 0); // 垂带
    b.box('ash', 0.7, 0.3, 0.7, px + s * 2.15, py + 2.72, ST_Z - 0.2, shade(MB, 1.14));           // 抱鼓石
  }
  b.kit('yanluo.stair', ST_N + 10, py + 1.3);
  // 镇殿石兽四尊（沿用 W37 既有石兽形制，不新建系统）
  for (const s of [-1, 1]) {
    w37Beast(b, px + s * 12, ST_Z + 2.6, s > 0 ? -0.35 : 0.35, 0x3e4650);
    w37Beast(b, px + s * 12, ST_Z + 7.4, s > 0 ? -0.2 : 0.2, 0x3e4650);
  }

  // ---- ④ 殿身：朱漆板壁 + 石作墙裙 + 壁柱 + 直棂窗 ----
  // 原四面板壁一律 'wall' 组 —— 换成 lacquer（朱漆，PBR 清漆）后自发光消失，颜色才立得住。
  const WH = 20;                               // 檐柱高（压低殿身、抬举屋面，才不是「三个盒子叠起来」）
  const wallRun = (ax: number, az: number, bx: number, bz: number, h: number, yb: number): void => {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const ry = Math.atan2(-dz, dx);
    // 板壁走 'lacquer'：地府没有日光，只有 0.24 环境光 + 少量点光；粗糙组（wood/ash）整面会沉成纯黑。
    // 清漆层靠环境反射把墙面从黑里提出来——这不是「自发光」，暗部仍然吃光，不会像 'wall' 那样压平顶点色。
    b.box('lacquer', len, h, 1.8, (ax + bx) / 2, yb + h / 2, (az + bz) / 2, shade(LACQ, 1.35), ry);
    b.box('ash', len, 2.4, 2.1, (ax + bx) / 2, yb + 1.2, (az + bz) / 2, shade(MB, 0.9), ry);        // 墙裙
    b.box('wood', len, 0.34, 2.2, (ax + bx) / 2, yb + h - 0.17, (az + bz) / 2, shade(LACQ, 1.6), ry); // 墙帽
    // 两道横枋：把 20m 高的整面墙断开，避免又是一块「大板」
    for (const k of [0.34, 0.68]) b.box('wood', len, 0.26, 2.05, (ax + bx) / 2, yb + h * k, (az + bz) / 2, shade(LACQ, 1.75), ry);
  };
  wallRun(X0, Z0, X1, Z0, WH, FLR);                                     // 后墙
  wallRun(X0, Z0, X0, Z1, WH, FLR);                                     // 西墙
  wallRun(X1, Z0, X1, Z1, WH, FLR);                                     // 东墙
  wallRun(X0, Z1, px - 23.75, Z1, WH, FLR);                             // 前墙西段
  wallRun(px + 23.75, Z1, X1, Z1, WH, FLR);                             // 前墙东段
  b.box('lacquer', 47.5, 6.2, 1.8, px, FLR + 17.0, Z1, LACQ);           // 明间上部走马板
  b.box('wood', 47.8, 0.3, 2.0, px, FLR + 13.95, Z1, shade(LACQ, 1.7)); // 门楣
  b.kit('yanluo.wall', 5, FLR);

  // 壁柱（每间一根，与檐柱对位）+ 墙裙压线
  for (let i = 1; i < 8; i++) {
    const gx = X0 + i * (HW / 8);
    for (const zz of [Z0 + 0.9, Z1 - 0.9]) b.box('wood', 1.7, WH, 1.7, gx, FLR + WH / 2, zz, shade(LACQ, 1.35));
  }
  // 东西山面直棂窗（每面 4 樘，内透磷光）
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const wz = Z0 + 6 + i * 9;
      b.box('glow', 0.1, 2.4, 4.2, px + s * (HW / 2 + 0.95), FLR + 12, wz, 0x2e6a52);
      for (let k = 0; k <= 6; k++) b.box('wood', 0.18, 2.5, 0.12, px + s * (HW / 2 + 1.0), FLR + 12, wz - 2.1 + k * 0.7, 0x1a1418);
    }
  }

  // ---- ⑤ 九间檐柱：76m 面阔 8 间 × 9.5m，柱径 1.5，柱高 26m ----
  const col = (cx: number, cz: number): void => {
    b.cyl('ash', 1.05, 1.15, 0.5, 12, cx, FLR + 0.25, cz, shade(MB, 0.94));    // 柱础
    b.cyl('wood', 0.75, 0.8, WH, 12, cx, FLR + WH / 2, cz, LACQ);              // 柱身
    b.cyl('wood', 0.86, 0.86, 0.36, 12, cx, FLR + WH - 0.3, cz, CU);           // 柱头箍
    b.box('glow', 0.2, WH - 2, 0.2, cx + 0.35, FLR + WH / 2, cz + 0.85, 0x3dff9c);
  };
  for (let i = 0; i <= 8; i++) col(X0 + i * (HW / 8), Z1 + 0.4);
  for (let i = 0; i <= 8; i++) col(X0 + i * (HW / 8), Z0 - 0.4);
  for (let i = 1; i < 4; i++) {
    for (const s of [-1, 1]) col(px + s * (HW / 2 + 0.4), Z0 + i * (HD / 4));
  }
  b.kit('yanluo.column', 9 + 9 + 6, FLR + 13);

  // ---- ⑥ 额枋 / 平板枋 / 和玺彩画 / 密排斗栱 ----
  const archY = FLR + WH + 0.8;
  const arch = (len: number, cx: number, cz: number, ry: number): void => {
    b.box('wood', len, 1.5, 1.0, cx, archY, cz, PAINT, ry);
    b.box('wood', len + 0.1, 0.16, 1.04, cx, archY + 0.75, cz, CU, ry);
    b.box('wood', len + 0.1, 0.16, 1.04, cx, archY - 0.75, cz, CU, ry);
    b.box('wood', len + 0.1, 0.28, 1.24, cx, archY + 1.02, cz, shade(PAINT, 1.3), ry);
  };
  arch(HW + 1.2, px, Z1 + 0.4, 0);
  arch(HW + 1.2, px, Z0 - 0.4, 0);
  arch(HD + 1.2, px - HW / 2 - 0.4, HZ, Math.PI / 2);
  arch(HD + 1.2, px + HW / 2 + 0.4, HZ, Math.PI / 2);
  const dgY = archY + 1.55;
  dougongBand(b, px, dgY, Z1 + 0.4, HW, 0, 0x4a2434);
  dougongBand(b, px, dgY, Z0 - 0.4, HW, Math.PI, 0x4a2434);
  dougongBand(b, px - HW / 2 - 0.4, dgY, HZ, HD, Math.PI / 2, 0x4a2434);
  dougongBand(b, px + HW / 2 + 0.4, dgY, HZ, HD, -Math.PI / 2, 0x4a2434);
  b.kit('yanluo.bracket', 2 * (Math.round(HW / 1.6) + 1) + 2 * (Math.round(HD / 1.6) + 1), dgY);
  for (let r = 0; r < 30; r++) b.box('wood', 0.16, 0.16, 1.6, X0 + 1.5 + r * 2.5, dgY + 0.9, Z1 + 1.1, 0x3a1c28);
  b.kit('yanluo.rafter', 30, dgY + 0.9);

  // ---- ⑦ 三重檐：下檐 84×52 / 中檐 72×46 / 上檐 56×36 ----
  // roofOn 自带反宇曲面、0.34m 瓦垄顶点色条纹、垂脊、正脊鸱吻、瓦当滴水与檐口连檐。
  // 举高按「檐口起 1/3.5 坡度」定：84m 檐口 11.5m 举高 ≈ 15°（旧版 6.6m 只有 9°，远看是一条平盖）。
  const EAVE1 = FLR + 23.8, EAVE2 = FLR + 39.9, EAVE3 = FLR + 54.8;
  roofOn(b, 84, 52, EAVE1, px, HZ, 0, TILE, 0x2e8a62, 11.5);
  // 二层殿身（围脊墙）：下檐正脊藏在这层里面，「重檐」的重就在这一圈
  b.box('lacquer', 60, 12.6, 34, px, EAVE1 + 6.4, HZ, shade(LACQ, 1.4));
  b.box('ash', 60.6, 0.6, 34.6, px, EAVE1 + 0.3, HZ, shade(MB, 0.8));      // 围脊
  // 二层直棂窗：木框 + 竖棂 + 内透磷光（旧版是七个纯色方块，读作贴纸）
  for (let i = 0; i < 7; i++) {
    for (const s of [-1, 1]) {
      const wx = px - 24 + i * 8, wz = HZ + s * 17.05;
      b.box('wood', 3.8, 4.6, 0.4, wx, EAVE1 + 6.6, wz, 0x1a1418);
      b.box('glow', 3.2, 4.0, 0.16, wx, EAVE1 + 6.6, wz + s * 0.12, 0x2e6a52);
      for (let k = 0; k < 5; k++) b.box('wood', 0.14, 4.1, 0.24, wx - 1.5 + k * 0.75, EAVE1 + 6.6, wz + s * 0.2, 0x1a1418);
      b.box('wood', 3.9, 0.2, 0.5, wx, EAVE1 + 4.25, wz, CU);
    }
  }
  b.box('wood', 62, 1.3, 1.0, px, EAVE1 + 12.4, HZ + 17, PAINT);
  b.box('wood', 62, 1.3, 1.0, px, EAVE1 + 12.4, HZ - 17, PAINT);
  dougongBand(b, px, EAVE1 + 13.6, HZ + 17.2, 60, 0, 0x4a2434);
  dougongBand(b, px, EAVE1 + 13.6, HZ - 17.2, 60, Math.PI, 0x4a2434);
  b.kit('yanluo.bracket2', 2 * (Math.round(60 / 1.6) + 1), EAVE1 + 13.6);
  roofOn(b, 72, 46, EAVE2, px, HZ, 0, TILE, 0x2e8a62, 10.5);
  // 三层殿身
  b.box('lacquer', 42, 11.4, 24, px, EAVE2 + 5.75, HZ, shade(LACQ, 1.4));
  b.box('ash', 42.6, 0.5, 24.6, px, EAVE2 + 0.25, HZ, shade(MB, 0.8));
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) {
      const wx = px - 16 + i * 8, wz = HZ + s * 12.05;
      b.box('wood', 2.6, 3.4, 0.36, wx, EAVE2 + 5.6, wz, 0x1a1418);
      b.box('glow', 2.1, 2.9, 0.14, wx, EAVE2 + 5.6, wz + s * 0.1, 0x2e6a52);
    }
  }
  b.box('wood', 43.2, 1.2, 0.9, px, EAVE2 + 11.9, HZ + 12, PAINT);
  b.box('wood', 43.2, 1.2, 0.9, px, EAVE2 + 11.9, HZ - 12, PAINT);
  dougongBand(b, px, EAVE2 + 13.1, HZ + 12.2, 42, 0, 0x4a2434);
  dougongBand(b, px, EAVE2 + 13.1, HZ - 12.2, 42, Math.PI, 0x4a2434);
  b.kit('yanluo.bracket3', 2 * (Math.round(42 / 1.6) + 1), EAVE2 + 13.1);
  roofOn(b, 56, 36, EAVE3, px, HZ, 0, TILE, 0x2e8a62, 9.5);
  // 宝顶：鎏铜葫芦，压在上檐正脊
  const RIDGE = EAVE3 + 9.5 * 1.06;
  b.cyl('metal', 1.0, 1.15, 0.5, 10, px, RIDGE + 0.55, HZ, shade(CU, 0.72));
  b.cyl('metal', 0.72, 0.9, 1.1, 10, px, RIDGE + 1.35, HZ, CU);
  b.cyl('metal', 0.4, 0.54, 0.34, 8, px, RIDGE + 2.05, HZ, shade(CU, 1.15));
  b.cyl('metal', 0.52, 0.4, 0.7, 10, px, RIDGE + 2.55, HZ, CU);
  b.cyl('glow', 0.12, 0.2, 0.5, 8, px, RIDGE + 3.1, HZ, 0x3dff9c);
  b.kit('yanluo.finial', 1, RIDGE + 2);

  // ---- ⑧ 正面五间格扇 + 明间大门 + 匾额 ----
  // 原内殿格扇（z=71.1）保留在新门内侧 0.5m，作法庭内门；此处是外檐五间格心。
  for (const s of [-1, 1]) {
    for (const [a, b2] of [[4.75, 14.25], [14.25, 23.75]] as const) {
      const xa = s * a, xb = s * b2;
      inLattice(b, xa, Z1 + 0.1, xb, Z1 + 0.1, FLR + 0.4, 13.2);
      b.box('lacquer', b2 - a - 0.3, 1.2, 0.34, (xa + xb) / 2, FLR + 1.0, Z1 + 0.1, LACQ);
      b.box('wood', b2 - a - 0.2, 0.16, 0.42, (xa + xb) / 2, FLR + 1.66, Z1 + 0.1, CU);
    }
  }
  // 明间：门槛 + 门框 + 门簪（净宽 9.5，车马可入）
  b.box('wood', 9.5, 0.4, 1.2, px, FLR + 0.2, Z1 + 0.1, 0x241820);
  for (const s of [-1, 1]) b.box('wood', 0.7, 13.6, 0.9, px + s * 4.9, FLR + 6.8, Z1 + 0.1, shade(LACQ, 1.4));
  b.box('wood', 10.4, 0.8, 1.0, px, FLR + 13.8, Z1 + 0.1, shade(LACQ, 1.5));
  for (let i = 0; i < 4; i++) b.box('wood', 0.34, 0.34, 1.2, px - 3 + i * 2, FLR + 14.4, Z1 + 0.1, CU);
  sg.quad(atlas.text('yanluo', '閻羅殿', 768, 192, { color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(4,8,6,0.92)', border: 'rgba(61,255,156,.9)', fontPx: 132 }), 15, 3.8, px, FLR + 17.1, Z1 + 1.05, 0);
  b.box('wood', 16, 0.26, 0.3, px, FLR + 19.2, Z1 + 1.1, CU);
  b.box('wood', 16, 0.26, 0.3, px, FLR + 15.0, Z1 + 1.1, CU);
  for (const s of [-1, 1]) b.box('wood', 0.3, 4.4, 0.3, px + s * 7.8, FLR + 17.1, Z1 + 1.1, CU);
  // 楹联：挂在明间两侧金柱（x=±9.5）柱面，竖排七言
  sg.quad(atlas.text('yanluo_lianw', '陽世三間多昧己', 96, 460, { color: '#ffd9a8', glow: '#ffb060', vertical: true, fontPx: 58, bg: 'rgba(18,6,8,0.9)', border: 'rgba(255,176,96,.7)' }), 1.6, 7.6, px - 9.5, FLR + 9.4, Z1 + 1.35, 0);
  sg.quad(atlas.text('yanluo_liane', '陰司一筆不容情', 96, 460, { color: '#ffd9a8', glow: '#ffb060', vertical: true, fontPx: 58, bg: 'rgba(18,6,8,0.9)', border: 'rgba(255,176,96,.7)' }), 1.6, 7.6, px + 9.5, FLR + 9.4, Z1 + 1.35, 0);
  // 檐下宫灯：四盏（灯绳 + 铜盖 + 骨白灯身 + 磷光内芯）
  for (const s of [-1, 1]) {
    for (const lx of [14.25, 28.5]) {
      const gx = px + s * lx;
      b.box('metal', 0.06, 1.4, 0.06, gx, FLR + 19.7, Z1 + 2.3, CU);
      b.cyl('metal', 0.44, 0.56, 0.24, 8, gx, FLR + 18.9, Z1 + 2.3, shade(CU, 0.9));
      b.cyl('glow', 0.5, 0.5, 1.1, 8, gx, FLR + 18.2, Z1 + 2.3, 0xffb060);
      b.cyl('metal', 0.52, 0.36, 0.16, 8, gx, FLR + 17.6, Z1 + 2.3, shade(CU, 0.8));
      b.box('glow', 0.1, 0.5, 0.1, gx, FLR + 17.25, Z1 + 2.3, 0xff7a2d);
      b.kit('yanluo.lantern', 1, FLR + 18);
    }
  }

  // ---- ⑨ 殿内天花：井口格 + 中心藻井（把上部屋架藏住，站在殿里不再看见旧屋面） ----
  b.box('lacquer', 74, 1.2, 38, px, FLR + 22.6, HZ, shade(LACQ, 0.7));       // 天花大板（压在下檐之下）
  for (let i = 0; i <= 8; i++) b.box('wood', 0.34, 0.5, 38, X0 + i * (HW / 8), FLR + 22.0, HZ, 0x241a20);
  for (let i = 0; i <= 5; i++) b.box('wood', 74, 0.5, 0.34, px, FLR + 22.0, Z0 + i * (HD / 5), 0x241a20);
  b.box('lacquer', 15, 0.9, 15, px, FLR + 21.5, 58, shade(LACQ, 1.2));
  b.box('glow', 12.4, 0.1, 12.4, px, FLR + 21.0, 58, 0x123c2c);
  for (const s of [-1, 1]) {
    b.box('metal', 0.3, 0.3, 0.3, px + s * 5.4, FLR + 21.1, 58, CU);
    b.box('metal', 0.3, 0.3, 0.3, px, FLR + 21.1, 58 + s * 5.4, CU);
  }
  b.kit('yanluo.ceiling', 60, FLR + 24);

  // ---- 殿身正面：格扇（次间/梢间装格心，明间留空以见法庭内景）----
  // 列柱 x=−20..20 每 5m 一柱（z = pz+11.4，柱净距 3.5），格扇贴在柱列内侧一格。
  for (const sx of [-1, 1]) {
    for (const [b0, b1] of [[5, 10], [10, 15]] as const) {
      const x0 = sx * b0, x1 = sx * b1;
      inLattice(b, x0, pz + 11.1, x1, pz + 11.1, py + 2.62, 8.4);
      // 格扇下槛 + 群板（朱漆），让格心不悬空
      b.box('lacquer', Math.abs(x1 - x0) - 0.3, 1.0, 0.26, (x0 + x1) / 2, py + 3.12, pz + 11.1, 0x3a1420);
      b.box('wood', Math.abs(x1 - x0) - 0.2, 0.14, 0.34, (x0 + x1) / 2, py + 3.66, pz + 11.1, 0x241820);
    }
    // 梢间板壁（最外一间做实墙，挡侧风视线）
    b.box('lacquer', 4.6, 8.4, 0.3, sx * 17.5, py + 6.8, pz + 11.1, 0x2e1220);
    b.box('glow', 0.5, 1.6, 0.06, sx * 17.5, py + 8.0, pz + 11.3, 0x3dff9c);
  }
  b.kit('yanluo.lattice', 4, py + 6.0);

  // ---- 两侧判官案（案 + 生死簿 + 朱笔 + 令签筒，inDeskTop 内已含四件陈设）----
  for (const sx of [-1, 1]) {
    const dx2 = sx * 11.5, dz2 = 66.6;
    inDesk(b, dx2, dz2, py + 2.6, 0, 3.4);
    // 判官（坐姿剪影：座/身/肩/头/冠/眼；案后 −z 一侧，正面朝广场 +z）
    b.box('wood', 1.5, 0.5, 1.2, dx2, py + 2.85, dz2 - 1.0, 0x1c1418);
    b.box('wood', 1.24, 1.25, 0.72, dx2, py + 3.72, dz2 - 1.0, 0x241a22);
    b.box('wood', 1.5, 0.3, 0.86, dx2, py + 4.34, dz2 - 1.0, 0x2e1a20);
    b.box('wood', 0.56, 0.62, 0.56, dx2, py + 4.72, dz2 - 1.0, 0x8f8a80);
    b.box('wood', 1.34, 0.24, 0.9, dx2, py + 5.06, dz2 - 1.0, 0x141014);
    b.box('wood', 0.5, 0.1, 0.2, dx2, py + 5.24, dz2 - 0.9, 0x141014);
    b.box('glow', 0.12, 0.06, 0.06, dx2 - 0.14, py + 4.78, dz2 - 0.72, 0x3dff9c);
    b.box('glow', 0.12, 0.06, 0.06, dx2 + 0.14, py + 4.78, dz2 - 0.72, 0x3dff9c);
    b.box('fabric', 1.5, 1.1, 0.06, dx2, py + 3.3, dz2 + 0.36, 0x2b1b3d);
    // 案后屏风
    b.box('lacquer', 3.0, 3.6, 0.2, dx2, py + 4.4, dz2 - 2.0, 0x2a1018);
    b.box('glow', 2.4, 0.09, 0.05, dx2, py + 5.7, dz2 - 1.88, 0x8a1a1a);
    b.kit('yanluo.judgeDesk', 1, py + 3.7);
  }

  // ---- 殿前香案 + 鼎炉（香案移入殿内明间前；鼎炉移到丹陛之下的神道正中） ----
  inAltar(b, px, 69.0, py + 2.6, 0, 5.2);
  b.kit('yanluo.incense', 1, py + 4.2);
  {
    const dz3 = 87.5;
    // 石础 + 鼎身 + 双耳 + 三足 + 炉心炭火 + 烟柱
    b.box('ash', 6.2, 0.5, 6.2, px, py + 0.25, dz3, shade(INP.rough, 1.02));
    b.cyl('metal', 3.0, 2.2, 2.1, 14, px, py + 1.55, dz3, shade(INP.cu, 0.62));
    for (const sx of [-1, 1]) {
      b.box('metal', 0.34, 1.0, 0.5, px + sx * 2.6, py + 2.5, dz3, shade(INP.cu, 0.7));
    }
    b.cyl('metal', 3.1, 3.1, 0.26, 14, px, py + 2.7, dz3, shade(INP.cu, 0.78));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.4;
      b.cyl('metal', 0.3, 0.24, 1.3, 6, px + Math.cos(a) * 1.7, py + 0.65, dz3 + Math.sin(a) * 1.7, shade(INP.cu, 0.55), a);
    }
    b.cyl('glow', 2.5, 2.5, 0.14, 12, px, py + 2.5, dz3, 0x6b2a12);
    for (let k = 0; k < 8; k++) {
      const a = k * 0.785 + 0.2;
      b.box('glow', 0.5, 0.16, 0.5, px + Math.cos(a) * (0.6 + (k % 3) * 0.55), py + 2.62, dz3 + Math.sin(a) * (0.6 + (k % 4) * 0.42), k % 3 === 0 ? 0x8a1a1a : 0xff7a2d);
    }
    // 烟：细而无柱感——只留三缕贴鼎口的热气，颜色压到暗紫灰（旧版五块堆成一漆黑柱）
    for (let k = 0; k < 3; k++) {
      b.box('glow', 0.34 - k * 0.06, 0.3, 0.34 - k * 0.06, px + Math.sin(k * 2.1) * 0.32, py + 3.1 + k * 0.5, dz3 + Math.cos(k * 1.4) * 0.26, 0x453a44);
    }
    b.kit('yanluo.cauldron', 1, py + 2.6);
  }

  // 丹墀石灯笼（原在旧殿后 z=42，新殿身覆盖后移至台明前缘两侧；'wall' 组一并换掉——它是灰模第二来源）
  for (const sx of [-1, 1]) {
    b.box('ash', 2.2, 4.2, 2.2, px + sx * 20, py + 2.6 + 2.1, 73.6, shade(MB, 0.9));
    b.box('ash', 2.6, 0.3, 2.6, px + sx * 20, py + 2.6 + 4.2, 73.6, shade(MB, 1.1));
    b.box('glow', 1.0, 1.2, 1.0, px + sx * 20, py + 2.6 + 3.4, 73.6, 0xff3a4a);
    b.kit('yanluo.stoneLamp', 1, py + 6.8);
  }
  // 孟婆摊（桥南头）
  const mx = 6, mz2 = -92;
  b.box('wood', 3.0, 0.9, 1.4, mx, y + 0.45, mz2, 0x3a2c22);
  b.box('wood', 0.09, 2.2, 0.09, mx - 1.2, y + 1.1, mz2 - 0.5, 0x241a12);
  b.box('wood', 0.09, 2.2, 0.09, mx + 1.2, y + 1.1, mz2 - 0.5, 0x241a12);
  b.box('roof', 3.6, 0.12, 2.0, mx, y + 2.3, mz2, 0x2a1e2e, 0, 0.16);
  b.cyl('wood', 0.9, 1.1, 1.1, 9, mx + 0.2, y + 1.4, mz2, 0x1c141a);
  b.cyl('glow', 0.62, 0.8, 0.3, 9, mx + 0.2, y + 2.0, mz2, 0x8a1420);
  sg.quad(atlas.text('mengpo', '孟婆莊', 240, 76, { color: '#b8ffd8', glow: '#3dff9c', vertical: false, fontPx: 52, bg: 'rgba(6,10,8,0.85)' }), 4.4, 1.4, mx, y + 3.8, mz2, 0);
  // 三生石/望乡台迁正 spec 坐标（B3，src/sky/hells.ts）
  // 彼岸花海（红 glow 花簇）+ 鬼火
  for (let i = 0; i < 220; i++) {
    const fx = rng.range(-330, 330), fz = rng.chance(0.5) ? rng.range(-26, 90) : rng.range(-140, -92);
    if (Math.abs(fx) < 8) continue;
    b.box('glow', 0.22, 0.75, 0.22, fx, y + 0.5, fz, rng.chance(0.75) ? 0xff2d55 : 0xff7a2d);
  }
  for (let i = 0; i < 40; i++) {
    const fx = rng.range(-300, 300), fz = rng.range(-100, 100);
    b.box('glow', 0.24, 0.24, 0.24, fx, y + rng.range(1.2, 4.5), fz, 0x3dff9c);
  }
  // 骨白路两侧引魂灯柱
  for (let z = -120; z <= 40; z += 16) {
    for (const sx of [-1, 1]) {
      b.cyl('wood', 0.1, 0.14, 3.4, 5, sx * 7, y + 1.7, z, 0x1c141a);
      b.box('glow', 0.4, 0.55, 0.4, sx * 7, y + 3.6, z, z % 32 === 8 ? 0xff3a4a : 0x3dff9c);
    }
  }
  // 阴阳界牌坊（阳间入口，汴河东城门外）
  const gx = 470, gz = 24;
  for (const sx of [-1, 1]) {
    b.box('wall', 1.8, 9, 1.8, gx + sx * 3.4, 4.5, gz, 0x241a22);
    b.box('glow', 0.14, 7.6, 0.14, gx + sx * 4.4, 4.5, gz, 0x3dff9c);
  }
  b.box('wall', 11, 1.6, 2.2, gx, 9.6, gz, 0x1c1218);
  b.box('glow', 9.6, 0.2, 0.24, gx, 10.5, gz, 0x3dff9c);
  sg.quad(atlas.text('yinyang', '陰陽界', 320, 96, { color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(4,8,6,0.92)', border: 'rgba(61,255,156,.85)', fontPx: 64 }), 6, 1.8, gx, 7.8, gz, 0);
  // 返阳牌坊（地府侧）
  const rx = 0, rz2 = -124;
  for (const sx of [-1, 1]) {
    b.box('wall', 1.8, 9, 1.8, rx + sx * 3.4, y + 4.5, rz2, 0x241a22);
    b.box('glow', 0.14, 7.6, 0.14, rx + sx * 4.4, y + 4.5, rz2, 0xff3a4a);
  }
  b.box('wall', 11, 1.6, 2.2, rx, y + 9.6, rz2, 0x1c1218);
  sg.quad(atlas.text('fanyang', '返陽門', 300, 90, { color: '#ffd8b8', glow: '#ff7a2d', bg: 'rgba(10,6,4,0.92)', border: 'rgba(255,122,45,.85)', fontPx: 60 }), 5.6, 1.7, rx, y + 7.6, rz2, 0);

  // ---- 十八狱环中心场 / 阎罗殿前广场（旧版只有一条骨白路，两侧整片空黑）----
  const H_PHOS = 0x3dff9c, H_STONE = 0x3b424a;
  // 广场铺装：石板面 + 分缝（压住 0x2e2228 的整片冥土）
  b.box('ash', 46, 0.06, 50, 0, y + 0.04, 100, shade(0x4a4450, 1.05));
  for (let pz2 = 78; pz2 <= 122; pz2 += 7) b.box('ground', 44, 0.03, 0.14, 0, y + 0.08, pz2, shade(0x2e2a34, 1.1));
  for (let px2 = -20; px2 <= 20; px2 += 8) b.box('ground', 0.14, 0.03, 48, px2, y + 0.08, 100, shade(0x2e2a34, 1.1));
  b.kit('hell.plazaPaving', 13, y + 0.04);
  // 碑刻：碑座 + 座身 + 碑身 + 碑首（四棱台）+ 碑文磷光
  const stele = (sx2: number, sz2: number, h: number, ry: number, kit: string): void => {
    b.box('ash', 1.7, 0.36, 0.95, sx2, y + 0.18, sz2, shade(H_STONE, 0.95), ry);
    b.box('ash', 1.2, 0.26, 0.66, sx2, y + 0.49, sz2, shade(H_STONE, 1.08), ry);
    b.box('ash', 0.88, h, 0.3, sx2, y + 0.62 + h / 2, sz2, shade(0x4e5860, 1.02), ry);
    b.pyramid('ash', 0.14, 0.66, sx2, y + 0.82 + h, sz2, shade(H_STONE, 1.12), ry, 1, 0.4, 0.45);
    b.box('glow', 0.6, 0.05, 0.04, sx2 + Math.sin(ry) * 0.17, y + 0.62 + h * 0.62, sz2 + Math.cos(ry) * 0.17, H_PHOS, ry);
    b.kit(kit, 1, y + 0.6);
  };
  // 刑具桩：石础 + 四角石 + 桩身 + 两道铁箍 + 横担 + 垂链 + 血渍
  const punishPost = (sx2: number, sz2: number, kit: string): void => {
    b.box('ash', 1.2, 0.28, 1.2, sx2, y + 0.14, sz2, shade(H_STONE, 0.9));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      b.box('ash', 0.3, 0.24, 0.3, sx2 + Math.cos(a) * 0.62, y + 0.12, sz2 + Math.sin(a) * 0.62, shade(H_STONE, 1.0));
    }
    b.cyl('wood', 0.24, 0.34, 3.2, 7, sx2, y + 1.88, sz2, shade(0x2a2027, 1.05));
    for (const yy of [1.5, 2.5]) b.cyl('metal', 0.36, 0.36, 0.14, 8, sx2, y + yy, sz2, 0x6e5a3a);
    b.box('metal', 1.5, 0.12, 0.12, sx2, y + 3.2, sz2, 0x8a8a92, 0.42);
    for (let k = 0; k < 3; k++) b.box('metal', 0.11, 0.22, 0.09, sx2 + 0.42 + k * 0.14, y + 3.0 - k * 0.26, sz2 + 0.18 + k * 0.1, 0x9a9aa2, 0.42, 0, 0.3);
    b.box('glow', 0.74, 0.04, 0.74, sx2, y + 0.3, sz2, 0x5c1018);
    b.kit(kit, 1, y + 1.6);
  };
  // 锁链桩：石础 + 桩身 + 顶环 + 垂地锁链
  const chainPost = (sx2: number, sz2: number, ry: number, kit: string): void => {
    b.box('ash', 0.92, 0.24, 0.92, sx2, y + 0.12, sz2, shade(H_STONE, 0.94), ry);
    b.cyl('wood', 0.16, 0.24, 2.0, 6, sx2, y + 1.22, sz2, shade(0x241c16, 1.06));
    b.cyl('metal', 0.22, 0.22, 0.09, 8, sx2, y + 2.32, sz2, 0x9a9aa2, ry, Math.PI / 2);
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      b.box('metal', 0.13, 0.2, 0.06, sx2 + Math.sin(ry) * (0.4 + t * 1.5), y + 1.6 - t * 1.25, sz2 + Math.cos(ry) * (0.4 + t * 1.5), 0x8a8a92, ry + (k % 2 ? 0.5 : -0.5));
    }
    b.kit(kit, 1, y + 1.2);
  };
  // 鬼差列位（Baker 摆的静态剪影：下裳/上身/头/笠帽/戟杆/戟刃/磷光）
  const hellGuard = (gx2: number, gz2: number, face: number, kit: string): void => {
    b.box('wood', 0.54, 0.95, 0.36, gx2, y + 0.55, gz2, 0x1e2a26, face);
    b.box('wood', 0.64, 0.92, 0.4, gx2, y + 1.46, gz2, 0x243430, face);
    b.box('wood', 0.26, 0.28, 0.26, gx2, y + 2.05, gz2, 0x8fb898, face);
    b.box('wood', 0.68, 0.12, 0.68, gx2, y + 2.24, gz2, 0x1a1418, face);
    b.box('wood', 0.2, 0.16, 0.2, gx2, y + 2.36, gz2, 0x1a1418, face);
    b.box('wood', 0.05, 2.5, 0.05, gx2 + Math.cos(face) * 0.44, y + 1.25, gz2 - Math.sin(face) * 0.44, 0x3a3a42, face, 0, 0.1);
    b.box('metal', 0.26, 0.3, 0.05, gx2 + Math.cos(face) * 0.44, y + 2.56, gz2 - Math.sin(face) * 0.44, 0x9aa6b8, face, 0, 0.1);
    b.box('glow', 0.06, 0.06, 0.06, gx2 + Math.sin(face) * 0.15, y + 2.07, gz2 + Math.cos(face) * 0.15, H_PHOS, face);
    b.kit(kit, 1, y + 1.1);
  };
  // 广场灯柱
  const plazaLamp = (sx2: number, sz2: number, kit: string): void => {
    b.cyl('wood', 0.1, 0.15, 3.2, 5, sx2, y + 1.6, sz2, 0x1c141a);
    b.box('metal', 0.4, 0.1, 0.4, sx2, y + 3.62, sz2, 0x2a2622);
    b.box('metal', 0.36, 0.5, 0.36, sx2, y + 3.3, sz2, 0x2a2622);
    b.box('glow', 0.26, 0.34, 0.26, sx2, y + 3.3, sz2, H_PHOS);
    b.kit(kit, 1, y + 3.3);
  };
  // 布点：神道两侧鬼差列位 → 碑林 → 刑具桩/锁链桩 → 灯柱（z 76–124，均在殿前可见范围）
  for (const sx2 of [-1, 1]) {
    for (const gz2 of [78, 84, 90, 96, 102, 108]) hellGuard(sx2 * 8.4, gz2, sx2 > 0 ? -Math.PI / 2 : Math.PI / 2, 'hell.guardFile');
    stele(sx2 * 17, 82, 2.4, 0, 'hell.plazaStele');
    stele(sx2 * 17, 98, 2.0, 0, 'hell.plazaStele');
    stele(sx2 * 31, 90, 2.8, 0, 'hell.plazaStele');
    punishPost(sx2 * 12.5, 108, 'hell.punishPost');
    punishPost(sx2 * 12.5, 118, 'hell.punishPost');
    chainPost(sx2 * 20, 104, sx2 > 0 ? 0.6 : -0.6, 'hell.chainPost');
    chainPost(sx2 * 20, 114, sx2 > 0 ? 0.4 : -0.4, 'hell.chainPost');
    plazaLamp(sx2 * 7.4, 86, 'hell.plazaLamp');
    plazaLamp(sx2 * 7.4, 116, 'hell.plazaLamp');
  }

  // ---- 望乡台台基四周（旧版三层台基只有光板与螺旋盘道，四周全空）----
  const wx = -150, wz = -150;
  // 栏板段：望柱 + 柱头 + 实心栏板 + 压面枋（只做 +z / +x 两向迎光面，避开螺旋盘道）
  const railRun = (ax: number, az: number, bx: number, bz: number, yy: number, kit: string): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 5));
    const ang = Math.atan2(bx - ax, bz - az);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      b.box('ash', 0.34, 1.14, 0.34, ax + (bx - ax) * t, yy + 0.57, az + (bz - az) * t, shade(0xd8d0c0, 1.02), ang);
      b.box('ash', 0.44, 0.12, 0.44, ax + (bx - ax) * t, yy + 1.2, az + (bz - az) * t, shade(0xd8d0c0, 1.12), ang);
    }
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      b.box('ash', 0.16, 0.8, len / n - 0.36, ax + (bx - ax) * t, yy + 0.52, az + (bz - az) * t, shade(0xc0b8a8, 1.0), ang);
      b.box('ash', 0.24, 0.12, len / n - 0.3, ax + (bx - ax) * t, yy + 0.97, az + (bz - az) * t, shade(0xd8d0c0, 1.08), ang);
    }
    b.kit(kit, n + 1, yy + 0.6);
  };
  railRun(wx - 12.6, wz + 12.65, wx + 12.6, wz + 12.65, y + 5.3, 'wangxiang.rail');
  railRun(wx + 12.65, wz + 12.2, wx + 12.65, wz - 12.6, y + 5.3, 'wangxiang.rail');
  railRun(wx - 9.6, wz + 9.65, wx + 9.6, wz + 9.65, y + 10.6, 'wangxiang.rail');
  railRun(wx + 9.65, wz + 9.2, wx + 9.65, wz - 9.6, y + 10.6, 'wangxiang.rail');
  // 台脚陈设：锁链桩成列、刑具桩、碑林、鬼差列位（均在盘道外半径 15.5 之外）
  for (const [ox, oz] of [[-7.5, 15.8], [-1.8, 15.8], [1.8, 15.8], [7.5, 15.8], [16.0, 2.0], [16.0, -6.0]] as const) {
    chainPost(wx + ox, wz + oz, ox > 0 ? 0.5 : -0.5, 'wangxiang.chainPost');
  }
  punishPost(wx + 13.6, wz + 15.9, 'wangxiang.punishPost');
  punishPost(wx - 13.6, wz + 15.9, 'wangxiang.punishPost');
  punishPost(wx + 16.0, wz - 13.0, 'wangxiang.punishPost');
  for (const [ox, oz] of [[-16, 18.6], [-8, 18.6], [8, 18.6], [16, 18.6]] as const) {
    stele(wx + ox, wz + oz, 2.2, 0, 'wangxiang.stele');
  }
  for (const ox of [-3.6, 3.6]) hellGuard(wx + ox, wz + 16.9, 0, 'wangxiang.guard');

  // 鬼域市集（J1-11）：望乡台与十八狱环之间的西北楔形空地
  buildGhostMarket(b);

  buildYanluoRooms(b, sg, atlas);
  buildPanguanHall(b, sg, atlas);
  // WS-34 地府门楼（4 件 / 12 座）：北门楼 / 死门三 / 更楼两座 / 六道光门六座
  buildUnderworldGates(b, sg, atlas);
  // WS-37 地府构件补齐（28 件 / D-ITM 台账）：鬼门关外·返阳门·黄泉路·引魂灯柱·血池湖·归墟·判官厅·丰都街面
  buildUnderworldProps(b, sg, atlas);
  // WS-25 局部光源（J4-29）：广场/狱环道/孟婆庄/三生石/望乡台灯组
  buildUnderworldLamps(b);
  // WS-42 data-only 29 件补齐（D-ITM 台账）：鬼门关/枉死城/丰都城垣/阴阳界井口/丰都九坊铺面
  buildUnderworldDataOnly(b, sg, atlas);
}

/** 阎罗殿室内壳 R01–R08（台基顶 y = UNDER.y + 2.6；既有法庭 R02 与簿架/镜台全部保留） */
export function buildYanluoRooms(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y0 = UNDER.y + 2.6;
  let n = 0;
  // ---- R01 前堂门厅：屏门 + 双侧直棂窗 + 格栅屏 ----
  n = inFloor(b, 0, 68.9, 15.2, 4.6, y0 + 0.03);
  n += inWall(b, -7.6, 66.6, 7.6, 66.6, y0, 4.6, 0.42, INP.brick, [[5.7, 9.5]]);
  n += inDoor(b, 0, 66.6, y0, 3.4, 3.6, 0, 1.15);
  n += inWindow(b, -4.8, 66.62, y0 + 1.05, 1.9, 1.7, 0, true);
  n += inWindow(b, 4.8, 66.62, y0 + 1.05, 1.9, 1.7, 0, true);
  n += inLattice(b, -7.6, 66.8, -7.6, 71.1, y0, 4.2);
  n += inLattice(b, 7.6, 66.8, 7.6, 71.1, y0, 4.2);
  n += inSkirt(b, -7.5, 66.85, 7.5, 66.85, y0);
  n += inSkirt(b, -7.45, 66.9, -7.45, 71.05, y0);
  n += inSkirt(b, 7.45, 66.9, 7.45, 71.05, y0);
  n += inCeil(b, 0, 68.9, 15.2, 4.6, y0 + 4.2, 1);
  for (const s of [-1, 1]) {
    b.cyl('ash', 0.44, 0.52, 0.5, 10, s * 2.5, y0 + 0.25, 70.6, shade(INP.rough, 1.05));
    b.cyl('ash', 0.3, 0.3, 0.12, 10, s * 2.5, y0 + 0.56, 70.6, INP.roughD);
    n += 2;
  }
  n += inLamp(b, -6.3, 70.3, y0, 1.9);
  n += inLamp(b, 6.3, 70.3, y0, 1.9);
  n += inCushion(b, -3.4, 69.3, y0, 0.44);
  n += inCushion(b, 3.4, 69.3, y0, 0.44);
  n += inTable(b, 5.3, 70.4, y0, 1.5, 0.8, 0.66);
  n += inScrolls(b, 5.3, 70.35, y0 + 0.7, 3);
  n += inRack(b, -6.9, 70.8, y0, Math.PI, 1.6, 2.6, 2, 'bone');
  b.kit('interior.yanluo.R01', n, y0);
  b.kit('interior.yanluo.door', 1, y0);

  // ---- R02 大堂审判正庭：分缝 + 垂幔 + 刑具架屏 + 香案/蒲团/灯阵 + 铁链 ----
  n = inPaveLines(b, 0, 58.4, 23.0, 15.8, y0 + 0.13, 2.4);
  n += inVeil(b, -2.7, 50.4, -2.7, 52.7, y0, 5.2, INP.cloth);
  n += inVeil(b, 2.7, 50.4, 2.7, 52.7, y0, 5.2, INP.cloth);
  n += inRack(b, -7.4, 55.4, y0, Math.PI / 2, 2.6, 3.6, 3, 'torture');
  n += inRack(b, 7.4, 55.4, y0, -Math.PI / 2, 2.6, 3.6, 3, 'torture');
  n += inDeskTop(b, 0, 53.5, y0 + 1.11, 0, 4.0);
  n += inWindow(b, -8.0, 50.18, y0 + 1.3, 1.8, 1.6, 0, true);
  n += inWindow(b, 8.0, 50.18, y0 + 1.3, 1.8, 1.6, 0, true);
  n += inAltar(b, 0, 58.6, y0, 0, 3.4);
  for (const sx of [-1, 1]) for (const dz of [60.1, 61.5, 62.9]) n += inCushion(b, sx * 2.3, dz, y0, 0.42);
  for (const sx of [-1, 1]) for (const dz of [56.0, 63.0]) n += inLamp(b, sx * 9.7, dz, y0, 2.2);
  n += inRack(b, 9.7, 51.6, y0, 0, 2.6, 3.2, 3, 'bone');
  n += inRack(b, -9.7, 51.6, y0, 0, 2.6, 3.2, 3, 'scroll');
  n += inChain(b, -4.6, y0 + 9.3, 57.6, 2.4, 0);
  n += inChain(b, 4.6, y0 + 9.3, 57.6, 2.4, 1);
  n += inChainStake(b, -10.4, 65.4, y0, Math.PI / 2);
  n += inChainStake(b, 10.4, 65.4, y0, -Math.PI / 2);
  n += inCeil(b, 0, 58.4, 23.4, 16.2, y0 + 9.4, 2);
  b.kit('interior.yanluo.R02', n, y0);

  // ---- R03 东庑刑具廊 ----
  n = inFloor(b, 15.85, 62.3, 8.1, 8.6, y0, INP.rough);
  n += inPaveLines(b, 15.85, 62.3, 7.9, 8.4, y0 + 0.13, 1.7);
  n += inWall(b, 11.8, 58, 11.8, 66.6, y0, 4.4, 0.5, INP.brick, [[2.6, 4.4]]);
  n += inDoor(b, 11.8, 61.5, y0, 1.8, 3.4, Math.PI / 2);
  n += inSkirt(b, 19.75, 58.2, 19.75, 66.4, y0);
  n += inSkirt(b, 11.95, 66.45, 19.7, 66.45, y0);
  for (const wz of [60.0, 63.0, 65.2]) n += inWindow(b, 19.86, wz, y0 + 1.1, 1.5, 1.5, Math.PI / 2, true, true);
  for (const wz of [59.3, 62.2, 65.1]) n += inRack(b, 19.05, wz, y0, -Math.PI / 2, 2.4, 3.4, 3, 'torture');
  for (const wz of [60.0, 63.0, 65.8]) n += inLamp(b, 12.7, wz, y0, 1.8);
  n += inRack(b, 13.6, 66.28, y0, Math.PI, 2.0, 2.6, 2, 'bone');
  n += inChain(b, 15.6, y0 + 4.4, 60.4, 1.8, 1);
  n += inChain(b, 15.6, y0 + 4.4, 64.6, 1.8, 0);
  n += inCeil(b, 15.85, 62.3, 8.1, 8.6, y0 + 4.4, 1);
  b.kit('interior.yanluo.R03', n, y0);

  // ---- R04 东庑锁链库（锁链桩 + 铁床 + 刑具架） ----
  n = inFloor(b, 15.85, 54.2, 8.1, 7.6, y0, INP.rough);
  n += inPaveLines(b, 15.85, 54.2, 7.9, 7.4, y0 + 0.13, 1.7);
  n += inWall(b, 11.8, 58.2, 19.9, 58.2, y0, 4.4, 0.42, INP.brick, [[3.9, 5.5]]);
  n += inSkirt(b, 19.75, 50.5, 19.75, 58.0, y0);
  n += inSkirt(b, 11.95, 50.45, 19.7, 50.45, y0);
  for (const wz of [51.8, 54.2, 56.6]) n += inChainStake(b, 18.1, wz, y0, Math.PI / 2);
  n += inIronBed(b, 14.6, 51.9, y0, 0);
  n += inRack(b, 19.15, 53.2, y0, -Math.PI / 2, 2.2, 3.2, 3, 'torture');
  n += inRack(b, 19.15, 56.4, y0, -Math.PI / 2, 2.2, 3.2, 3, 'torture');
  n += inRack(b, 12.5, 52.0, y0, Math.PI / 2, 2.4, 3.4, 4, 'scroll');
  n += inWindow(b, 19.86, 54.6, y0 + 1.2, 1.4, 1.4, Math.PI / 2, true, true);
  n += inLamp(b, 15.9, 57.2, y0, 1.9);
  n += inCeil(b, 15.85, 54.2, 8.1, 7.6, y0 + 4.4, 1);
  b.kit('interior.yanluo.R04', n, y0);

  // ---- R05 西庑生死簿库（既有簿架保留，补卷宗架/判官小案/骨器） ----
  n = inFloor(b, -15.85, 54.5, 8.1, 8.2, y0, 0x565058);
  n += inPaveLines(b, -15.85, 54.5, 7.9, 8.0, y0 + 0.13, 1.7);
  n += inWall(b, -11.8, 50.4, -11.8, 58.6, y0, 4.4, 0.5, INP.brick, [[4.2, 6.0]]);
  n += inDoor(b, -11.8, 55.5, y0, 1.8, 3.4, Math.PI / 2);
  n += inWall(b, -19.9, 58.6, -11.8, 58.6, y0, 4.4, 0.42, INP.brick, [[2.7, 4.3]]);
  n += inSkirt(b, -19.75, 50.5, -19.75, 58.4, y0);
  n += inSkirt(b, -19.7, 50.45, -11.95, 50.45, y0);
  n += inRack(b, -19.2, 52.4, y0, Math.PI / 2, 3.0, 4.2, 4, 'scroll');
  n += inRack(b, -15.9, 50.9, y0, 0, 2.8, 3.4, 3, 'scroll');
  n += inDesk(b, -16.6, 54.6, y0, Math.PI / 2, 2.4);
  n += inRack(b, -12.6, 56.9, y0, -Math.PI / 2, 2.2, 3.0, 3, 'bone');
  n += inLamp(b, -18.2, 55.8, y0, 1.9);
  n += inLamp(b, -14.2, 57.6, y0, 1.9);
  n += inScrolls(b, -18.3, 51.3, y0, 4);
  n += inScrolls(b, -15.2, 57.9, y0, 3);
  n += inWindow(b, -19.86, 54.4, y0 + 1.2, 1.4, 1.4, Math.PI / 2, true, true);
  n += inCeil(b, -15.85, 54.5, 8.1, 8.2, y0 + 4.2, 1);
  b.kit('interior.yanluo.R05', n, y0);

  // ---- R06 西庑孽镜台区（既有镜台保留，补九宫烛阵/矮链围/香案） ----
  n = inFloor(b, -15.85, 62.6, 8.1, 8.0, y0, 0x565058);
  n += inPaveLines(b, -15.85, 62.6, 7.9, 7.8, y0 + 0.13, 1.7);
  n += inWall(b, -11.8, 58.8, -11.8, 66.6, y0, 4.4, 0.5, INP.brick, [[1.8, 3.6]]);
  n += inDoor(b, -11.8, 61.5, y0, 1.8, 3.4, Math.PI / 2);
  n += inSkirt(b, -19.75, 58.8, -19.75, 66.4, y0);
  n += inSkirt(b, -19.7, 66.45, -11.95, 66.45, y0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    b.box('glow', 0.12, 0.62, 0.12, -16.9 + c * 0.85, y0 + 0.36, 61.9 + r * 0.85, (r + c) % 4 === 0 ? INP.ice : INP.phos);
    n++;
  }
  n += inChainRing(b, -15.2, 63.0, y0, 2.0, 6);
  for (const dz of [62.0, 63.0, 64.0]) n += inCushion(b, -15.2, dz, y0, 0.4);
  n += inAltar(b, -16.6, 65.5, y0, 0, 2.4);
  n += inLamp(b, -19.2, 60.2, y0, 2.1);
  n += inLamp(b, -19.2, 65.8, y0, 2.1);
  n += inRack(b, -12.7, 59.5, y0, -Math.PI / 2, 2.2, 3.0, 3, 'bone');
  n += inWall(b, -19.9, 66.6, -11.8, 66.6, y0, 4.4, 0.42, INP.brick, [[3.9, 5.7]]);
  n += inDoor(b, -15.0, 66.6, y0, 1.8, 3.4, 0);
  n += inScrolls(b, -18.4, 62.0, y0, 3);
  n += inCeil(b, -15.85, 62.6, 8.1, 8.0, y0 + 4.2, 1);
  b.kit('interior.yanluo.R06', n, y0);

  // ---- R07 判官书办房（东前角；前墙开板门 + 直棂窗） ----
  n = inFloor(b, 15.85, 68.8, 8.1, 4.4, y0 + 0.03);
  n += inWall(b, 11.8, 66.6, 11.8, 71.0, y0, 4.4, 0.5, INP.brick, [[1.8, 3.6]]);
  n += inWall(b, 11.8, 66.6, 19.9, 66.6, y0, 4.4, 0.42, INP.brick);
  n += inWall(b, 11.8, 71.0, 19.9, 71.0, y0, 4.4, 0.42, INP.brick, [[4.8, 6.6]]);
  n += inDoor(b, 17.5, 71.0, y0, 1.8, 3.4, 0);
  n += inWindow(b, 13.2, 71.02, y0 + 1.1, 1.6, 1.5, 0, true);
  n += inSkirt(b, 12.0, 66.8, 19.7, 66.8, y0);
  n += inSkirt(b, 12.0, 70.85, 19.7, 70.85, y0);
  n += inDesk(b, 15.9, 69.2, y0, Math.PI, 2.8);
  n += inRack(b, 19.4, 68.6, y0, -Math.PI / 2, 3.0, 3.4, 3, 'scroll');
  n += inRack(b, 12.6, 68.1, y0, Math.PI / 2, 2.2, 2.8, 2, 'bone');
  n += inLamp(b, 18.2, 67.4, y0, 1.9);
  n += inLamp(b, 13.4, 70.2, y0, 1.9);
  n += inCushion(b, 15.9, 70.2, y0, 0.42);
  n += inScrolls(b, 14.6, 68.0, y0, 3);
  n += inSealBox(b, 13.0, 69.6, y0);
  n += inCeil(b, 15.85, 68.8, 8.1, 4.4, y0 + 4.2, 1);
  b.kit('interior.yanluo.R07', n, y0);

  // ---- R08 后场甬道（殿后北出，符帘 + 幽蓝荧光预告十八狱） ----
  n = inFloor(b, 9.6, 47.0, 6.4, 6.2, y0, INP.rough);
  n += inWall(b, 6.4, 44.0, 6.4, 50.1, y0, 3.6, 0.42, INP.brick);
  n += inWall(b, 12.8, 44.0, 12.8, 50.1, y0, 3.6, 0.42, INP.brick);
  n += inDoor(b, 9.6, 44.05, y0, 2.6, 3.2, 0);
  n += inDoor(b, 9.6, 50.3, y0, 2.6, 3.2, 0);
  n += inSkirt(b, 6.65, 44.3, 6.65, 49.9, y0);
  n += inSkirt(b, 12.55, 44.3, 12.55, 49.9, y0);
  for (let k = 0; k < 7; k++) {
    const pz = 44.8 + k * 0.72;
    for (const sx of [-1, 1]) {
      b.box('fabric', 0.5, 1.5 - (k % 3) * 0.16, 0.04, 9.6 + sx * 3.0, y0 + 2.3, pz, k % 2 ? INP.paper : shade(INP.paper, 0.8));
      b.box('glow', 0.34, 0.05, 0.05, 9.6 + sx * 3.0, y0 + 1.5, pz, k % 3 === 0 ? INP.ink : shade(INP.phos, 0.4));
      n += 2;
    }
  }
  b.box('glow', 2.2, 2.6, 0.1, 9.6, y0 + 1.5, 44.35, shade(INP.blue, 0.55));
  b.box('glow', 0.3, 0.3, 0.12, 9.6, y0 + 2.9, 44.4, INP.ice);
  n += 2;
  n += inLamp(b, 7.1, 45.4, y0, 1.7);
  n += inLamp(b, 12.1, 48.4, y0, 1.7);
  n += inChainStake(b, 12.1, 45.2, y0, -Math.PI / 2);
  n += inCeil(b, 9.6, 47.0, 6.4, 6.4, y0 + 3.6, 1);
  // 甬道石砌台座 + 北向落阶（否则走廊北端会在冥土上方悬空 2.6m）
  b.box('ash', 7.0, 2.56, 6.4, 9.6, UNDER.y + 1.28, 47.1, shade(INP.rough, 0.86));
  n += 1;
  for (let i = 0; i < 12; i++) {
    b.box('ash', 3.6 - i * 0.04, 0.28, 0.34, 9.6, y0 - 0.2 - i * 0.2, 43.6 - i * 0.3, shade(INP.rough, 1.0 - i * 0.015));
    n++;
  }
  b.kit('interior.yanluo.R08', n, y0);
}

/** 判官司（新增小殿，(-56,62) 空地 24×16）：R01–R06 */
export function buildPanguanHall(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const cx = -56, cz = 62, y = UNDER.y, y0 = y + 1.4;
  let n = 0;
  // 台基 + 三级踏跺
  b.box('ash', 25.4, 1.36, 17.4, cx, y + 0.68, cz, shade(INP.rough, 0.92));
  n++;
  n += inSteps(b, cx, 70.85, 4.6, y0, 3, 0.24, 0.34);
  // 墙身（前墙留 6m 门洞）+ 四角壁柱 + 阑额
  n += inWall(b, cx - 12, 69.6, cx + 12, 69.6, y0, 6.2, 0.8, INP.brickD, [[9, 15]]);
  n += inWall(b, cx - 12, 54.4, cx + 12, 54.4, y0, 6.2, 0.8, INP.brickD);
  n += inWall(b, cx - 11.6, 54, cx - 11.6, 70, y0, 6.2, 0.8, INP.brickD);
  n += inWall(b, cx + 11.6, 54, cx + 11.6, 70, y0, 6.2, 0.8, INP.brickD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('ash', 1.0, 6.4, 1.0, cx + sx * 11.6, y0 + 3.2, cz + sz * 8.0, shade(INP.rough, 1.08));
    b.box('ash', 1.24, 0.3, 1.24, cx + sx * 11.6, y0 + 6.5, cz + sz * 8.0, shade(INP.rough, 1.2));
    n += 2;
  }
  b.box('ash', 6.4, 1.9, 0.5, cx, y0 + 5.25, 69.6, shade(INP.rough, 1.0));
  dougongBand(b, cx, y0 + 5.95, 70.3, 23.4, 0, 0x4a2434);
  b.kit('panguan.bracket', 13, y0 + 5.95);
  roofOn(b, 28.4, 20.4, y0 + 6.2, cx, cz, 0, 0x0f0a12, INP.phos);
  sg.quad(atlas.text('panguansi', '判官司', 512, 160, { color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(4,8,6,0.92)', border: 'rgba(61,255,156,.9)', fontPx: 116 }), 7.0, 1.7, cx, y0 + 4.9, 70.06, 0);
  for (const sx of [-1, 1]) {
    b.box('glow', 0.34, 0.46, 0.34, cx + sx * 7.6, y0 + 4.9, 70.42, INP.phos);
    b.box('metal', 0.05, 0.3, 0.05, cx + sx * 7.6, y0 + 5.2, 70.42, 0x3a3a42);
    n += 2;
  }
  // 门前锁链桩 + 碑一
  n += inChainStake(b, cx - 10.6, 71.7, y, Math.PI);
  n += inChainStake(b, cx + 10.6, 71.7, y, 0);
  b.box('ash', 1.5, 0.36, 1.0, cx + 13.6, y + 0.18, 66.0, shade(INP.rough, 0.95));
  b.box('ash', 0.8, 2.2, 0.32, cx + 13.6, y + 1.4, 66.0, shade(INP.rough, 1.1));
  b.box('glow', 0.5, 0.06, 0.05, cx + 13.6, y + 1.9, 66.18, INP.phos);
  n += 3;

  // 隔墙（R03 判词厅 / R04 卷宗库 / R05 刑具房 / 前后厅）
  n += inWall(b, cx - 11.2, 64.6, cx - 6.0, 64.6, y0, 4.6, 0.5, INP.brick, [[1.4, 3.0]]);
  n += inWall(b, cx - 5.0, 64.6, cx + 5.0, 64.6, y0, 4.6, 0.5, INP.brick, [[4.0, 6.0]]);
  n += inWall(b, cx + 5.4, 64.6, cx + 11.2, 64.6, y0, 4.6, 0.5, INP.brick, [[1.8, 3.4]]);
  n += inWall(b, cx - 6.0, 54.8, cx - 6.0, 64.6, y0, 4.6, 0.5, INP.brick, [[3.4, 5.2]]);
  n += inWall(b, cx + 5.6, 54.8, cx + 5.6, 64.6, y0, 4.6, 0.5, INP.brick, [[3.4, 5.2]]);
  n += inWall(b, cx - 5.0, 64.6, cx - 5.0, 69.2, y0, 4.6, 0.5, INP.brick, [[1.8, 3.6]]);
  n += inWall(b, cx + 5.0, 64.6, cx + 5.0, 69.2, y0, 4.6, 0.5, INP.brick, [[1.8, 3.6]]);
  b.kit('panguan.partition', 7, y0 + 2.3);

  // ---- R01 受签门厅（前中，10×4.6） ----
  n = inFloor(b, cx, 66.9, 10.0, 4.6, y0);
  n += inDoor(b, cx, 69.6, y0, 3.6, 4.2, 0);
  n += inWindow(b, cx - 4.6, 69.62, y0 + 1.2, 1.7, 1.6, 0, true);
  n += inWindow(b, cx + 4.6, 69.62, y0 + 1.2, 1.7, 1.6, 0, true);
  n += inSkirt(b, cx - 4.9, 64.75, cx + 4.9, 64.75, y0);
  n += inSkirt(b, cx - 4.9, 69.45, cx + 4.9, 69.45, y0);
  n += inTable(b, cx - 2.6, 68.3, y0, 1.7, 0.85, 0.7);
  n += inScrolls(b, cx - 2.6, 68.3, y0 + 0.74, 3);
  n += inSealBox(b, cx - 1.7, 68.3, y0 + 0.74);
  n += inRack(b, cx + 3.2, 65.4, y0, 0, 2.2, 2.8, 2, 'scroll');
  n += inCushion(b, cx - 3.4, 66.4, y0, 0.42);
  n += inCushion(b, cx + 2.4, 66.4, y0, 0.42);
  n += inLamp(b, cx - 4.4, 68.9, y0, 1.9);
  n += inLamp(b, cx + 4.4, 68.9, y0, 1.9);
  n += inChainStake(b, cx + 4.4, 65.6, y0, -Math.PI / 2);
  n += inVeil(b, cx - 2.6, 69.0, cx + 2.6, 69.0, y0 + 2.9, 0.9);
  n += inLattice(b, cx - 4.4, 65.2, cx - 1.8, 65.2, y0, 3.2);
  n += inCeil(b, cx, 66.9, 10.0, 4.6, y0 + 4.2, 1);
  b.kit('interior.panguan.R01', n, y0);

  // ---- R02 受状厅（前西，5.2×4.6） ----
  n = inFloor(b, cx - 8.4, 66.9, 5.2, 4.6, y0);
  n += inDoor(b, cx - 8.4, 64.6, y0, 1.8, 3.4, 0);
  n += inWindow(b, cx - 8.4, 69.62, y0 + 1.2, 1.5, 1.5, 0, true);
  n += inSkirt(b, cx - 10.9, 64.75, cx - 5.9, 64.75, y0);
  n += inSkirt(b, cx - 10.9, 64.85, cx - 10.9, 69.45, y0);
  n += inDesk(b, cx - 8.6, 67.4, y0, Math.PI, 2.2);
  n += inRack(b, cx - 8.4, 68.9, y0, Math.PI, 2.0, 2.6, 2, 'bone');
  n += inCushion(b, cx - 9.6, 66.2, y0, 0.4);
  n += inScrolls(b, cx - 10.2, 65.6, y0, 3);
  n += inLamp(b, cx - 10.2, 68.9, y0, 1.9);
  n += inCeil(b, cx - 8.4, 66.9, 5.2, 4.6, y0 + 4.2, 1);
  b.kit('interior.panguan.R02', n, y0);

  // ---- R06 值夜耳房（前东，6.2×4.6） ----
  n = inFloor(b, cx + 8.1, 66.9, 6.2, 4.6, y0);
  n += inDoor(b, cx + 8.1, 64.6, y0, 1.6, 3.4, 0);
  n += inWindow(b, cx + 8.1, 69.62, y0 + 1.3, 1.4, 1.4, 0, true);
  n += inSkirt(b, cx + 5.1, 64.75, cx + 11.1, 64.75, y0);
  n += inSkirt(b, cx + 11.1, 64.85, cx + 11.1, 69.45, y0);
  n += inVeil(b, cx + 9.6, 65.2, cx + 9.6, 68.8, y0, 3.4);
  n += inPallet(b, cx + 8.4, 68.6, y0, Math.PI);
  n += inRack(b, cx + 10.6, 66.0, y0, -Math.PI / 2, 2.0, 2.6, 2, 'bone');
  n += inCushion(b, cx + 6.2, 66.0, y0, 0.4);
  n += inLamp(b, cx + 5.8, 68.9, y0, 1.9);
  n += inScrolls(b, cx + 6.4, 67.4, y0, 2);
  n += inChain(b, cx + 9.6, y0 + 4.2, 66.8, 1.4, 1);
  n += inCeil(b, cx + 8.1, 66.9, 6.2, 4.6, y0 + 4.2, 1);
  b.kit('interior.panguan.R06', n, y0);

  // ---- R03 判词厅（后中，11.6×9.8） ----
  n = inFloor(b, cx, 59.7, 11.6, 9.8, y0, 0x565058);
  n += inPaveLines(b, cx, 59.7, 10.4, 8.6, y0 + 0.15, 2.0);
  n += inSkirt(b, cx - 5.75, 54.95, cx + 5.75, 54.95, y0);
  n += inSkirt(b, cx - 5.8, 55.0, cx - 5.8, 64.4, y0);
  n += inSkirt(b, cx + 5.8, 55.0, cx + 5.8, 64.4, y0);
  n += inDesk(b, cx - 0.2, 57.4, y0, 0, 4.2);
  for (let k = 0; k < 4; k++) {
    b.box('wood', 1.0, 2.6, 0.08, cx - 2.4 + k * 1.1, y0 + 1.3, 55.6, k % 2 ? INP.bone : shade(INP.bone, 0.72));
    n++;
  }
  b.box('wood', 4.4, 0.24, 0.2, cx - 0.3, y0 + 2.7, 55.6, shade(INP.rough, 1.1));
  n++;
  n += inAltar(b, cx - 0.2, 60.8, y0, 0, 3.0);
  n += inCushion(b, cx - 2.4, 59.6, y0, 0.42);
  n += inCushion(b, cx + 2.0, 59.6, y0, 0.42);
  n += inRack(b, cx - 4.9, 56.4, y0, Math.PI / 2, 2.6, 3.6, 3, 'scroll');
  n += inRack(b, cx + 4.5, 56.4, y0, -Math.PI / 2, 2.6, 3.6, 3, 'scroll');
  for (const sx of [-1, 1]) for (const dz of [58.0, 62.8]) n += inLamp(b, cx + sx * 4.6, dz, y0, 2.2);
  n += inChain(b, cx - 3.0, y0 + 5.2, 58.6, 2.2, 0);
  n += inChain(b, cx + 1.8, y0 + 5.2, 58.6, 2.2, 1);
  n += inChainStake(b, cx + 3.4, 63.6, y0, Math.PI);
  n += inDoor(b, cx, 64.6, y0, 1.8, 3.6, 0);
  n += inWindow(b, cx - 3.4, 54.84, y0 + 1.3, 1.8, 1.6, 0, true);
  n += inWindow(b, cx + 3.4, 54.84, y0 + 1.3, 1.8, 1.6, 0, true);
  n += inRack(b, cx - 4.9, 63.4, y0, Math.PI / 2, 2.2, 3.0, 3, 'bone');
  n += inCeil(b, cx, 59.7, 11.6, 9.8, y0 + 5.2, 2);
  b.kit('interior.panguan.R03', n, y0);

  // ---- R04 卷宗库（后西，5.2×9.8） ----
  n = inFloor(b, cx - 8.6, 59.7, 5.2, 9.8, y0, INP.rough);
  n += inSkirt(b, cx - 11.05, 55.0, cx - 11.05, 64.4, y0);
  n += inSkirt(b, cx - 11.05, 54.95, cx - 6.15, 54.95, y0);
  n += inRack(b, cx - 10.6, 56.4, y0, Math.PI / 2, 3.0, 4.2, 4, 'scroll');
  n += inRack(b, cx - 10.6, 60.4, y0, Math.PI / 2, 3.0, 4.2, 4, 'scroll');
  n += inRack(b, cx - 6.8, 56.4, y0, -Math.PI / 2, 2.6, 3.6, 3, 'scroll');
  n += inRack(b, cx - 6.8, 60.4, y0, -Math.PI / 2, 2.6, 3.6, 3, 'scroll');
  n += inRack(b, cx - 8.6, 64.1, y0, Math.PI, 2.4, 3.0, 3, 'bone');
  n += inScrolls(b, cx - 8.6, 58.2, y0, 4);
  n += inScrolls(b, cx - 9.4, 62.6, y0, 3);
  n += inDoor(b, cx - 6.0, 59.0, y0, 1.6, 3.4, Math.PI / 2);
  n += inWindow(b, cx - 11.16, 58.0, y0 + 1.3, 1.4, 1.4, Math.PI / 2, true, true);
  n += inLamp(b, cx - 7.6, 58.4, y0, 2.0);
  n += inLamp(b, cx - 9.6, 63.0, y0, 2.0);
  n += inCeil(b, cx - 8.6, 59.7, 5.2, 9.8, y0 + 3.8, 1);
  b.kit('interior.panguan.R04', n, y0);

  // ---- R05 刑具房（后东，5.6×9.8） ----
  n = inFloor(b, cx + 8.4, 59.7, 5.6, 9.8, y0, INP.rough);
  n += inSkirt(b, cx + 11.05, 55.0, cx + 11.05, 64.4, y0);
  n += inSkirt(b, cx + 5.65, 55.0, cx + 5.65, 64.4, y0);
  for (const dz of [56.2, 59.2, 62.2]) n += inRack(b, cx + 10.5, dz, y0, -Math.PI / 2, 2.4, 3.4, 3, 'torture');
  n += inChainStake(b, cx + 6.6, 55.8, y0, Math.PI / 2);
  n += inChainStake(b, cx + 6.6, 63.4, y0, Math.PI / 2);
  n += inIronBed(b, cx + 8.6, 58.6, y0, 0);
  n += inRack(b, cx + 6.4, 61.0, y0, Math.PI / 2, 2.2, 3.0, 3, 'bone');
  n += inChain(b, cx + 8.4, y0 + 3.8, 62.6, 1.8, 0);
  n += inChain(b, cx + 8.4, y0 + 3.8, 56.8, 1.8, 1);
  n += inDoor(b, cx + 5.6, 59.0, y0, 1.6, 3.4, Math.PI / 2);
  n += inWindow(b, cx + 11.16, 58.0, y0 + 1.3, 1.4, 1.4, Math.PI / 2, true, true);
  n += inLamp(b, cx + 10.2, 64.0, y0, 1.9);
  n += inCeil(b, cx + 8.4, 59.7, 5.6, 9.8, y0 + 3.8, 1);
  b.kit('interior.panguan.R05', n, y0);

  b.kit('panguan.hall', 6, y0);
}

/** 地府角色：恶鬼/鬼差/孟婆/判官/牛头马面/黑白无常/阎王 */
export function spawnUnderworldCast(crowd: Crowd, rng: RNG, vfx: Vfx): void {
  const y = UNDER.y;
  const ghostSkin = [0xa8d8b8, 0x98c8a8, 0xb8e8c8];
  const tatter = [0x2a3430, 0x3a2a34, 0x242e28, 0x30262e];
  const acts = ['sneak', 'walk', 'kneel', 'stand', 'lookAround', 'monkBow', 'sitNap', 'argue'];
  const doings = ['游魂飘荡', '跪泣黄泉', '徘徊忘川', '俯首冥思', '张望归途', '叩拜阎罗'];
  for (let i = 0; i < 34; i++) {
    const a = crowd.spawnActor({
      occ: 'beggar',
      pos: new THREE.Vector3(rng.range(-120, 120), y, rng.range(-135, 55)),
      skin: rng.pick(ghostSkin), cloth: rng.pick(tatter), pants: 0x1a201c,
      hat: rng.chance(0.5) ? 3 : 0,
      prop: rng.chance(0.2) ? 'staff' : null,
      action: rng.pick(acts), scale: rng.range(0.92, 1.05),
      doing: rng.pick(doings),
      data: { name: '亡魂', nick: '恶鬼', group: 'guest', weapon: '', desc: '黄泉路上的孤魂野鬼', code: 'ghost' + i },
    });
    a.pos.y = y;
    a.speed = 0.55;
  }
  // 鬼差巡逻队（提索押送）
  for (let i = 0; i < 3; i++) {
    const a = crowd.spawnActor({
      occ: 'soldier', prop: 'spear', pos: new THREE.Vector3(-40 + i * 30, y, -52),
      cloth: 0x1e2a26, pants: 0x14201c, skin: 0x8fb898, hat: 2, action: 'walk',
      doing: '鬼差押解亡魂过桥', data: { name: '鬼差', nick: '阴司', group: 'guest', weapon: '锁链', desc: '阴司差役，押魂过桥', code: 'ghostcop' + i },
    });
    a.speed = 0.8;
    crowd.heroes.push(a);
  }
  // 孟婆
  crowd.spawnStation('vendor', 6, -92, y, 'cook', '熬孟婆汤', Math.PI,
    { name: '孟婆', nick: '孟婆庄', group: 'deity', weapon: '汤勺', desc: '一碗忘川，前尘尽忘', code: 'mengpo' });
  vfx.addEmberSource(new THREE.Vector3(6.2, y + 2.0, -92));
  // 判官（阎罗殿前记账）
  crowd.spawnStation('scholar', 5, 38, y, 'write', '朱笔勾生死簿', 0,
    { name: '判官', nick: '阴司判官', group: 'deity', weapon: '生死簿', desc: '一笔定人寿数', code: 'panguan' });
  // 牛头马面
  // 牛头/马面站桩版退役（B9）：巡游版见 sky/creatures.ts（90s/150s 环线）
  // 黑白无常
  crowd.spawnStation('taoist', -10, -96, y, 'stand', '白无常索命', Math.PI / 2,
    { name: '白无常', nick: '谢必安', group: 'deity', weapon: '哭丧棒', desc: '一见生财，谢必安', code: 'baiwuchang' });
  const bai = crowd.actors[crowd.actors.length - 1];
  bai.scale = 1.32; bai.skin = new THREE.Color(0xe8f0e8); bai.cloth = new THREE.Color(0xe8f0e8); bai.hat = 2;
  crowd.spawnStation('taoist', -14, -96, y, 'stand', '黑无常拿鬼', Math.PI / 2,
    { name: '黑无常', nick: '范无救', group: 'deity', weapon: '锁链', desc: '天下太平，范无救', code: 'heiwuchang' });
  const hei = crowd.actors[crowd.actors.length - 1];
  hei.scale = 1.32; hei.skin = new THREE.Color(0x2a3038); hei.cloth = new THREE.Color(0x1a2028); hei.hat = 2;
  // 阎王
  crowd.spawnStation('official', 0, 56, y, 'holdCourt', '阎王升殿', 0,
    { name: '阎罗王', nick: '十殿阎君', group: 'deity', weapon: '生死判', desc: '阎王要你三更死，谁敢留人到五更', code: 'yanwang' });
  const yan = crowd.actors[crowd.actors.length - 1];
  yan.scale = 1.5; yan.cloth = new THREE.Color(0x3a1428); yan.halo = true;
}

/** 幽冥扩张：鬼城游魂散布（沿丰都三条长街布人，街面不再空无一人） */
export function spawnGhostSprawl(crowd: Crowd, rng: RNG): void {
  const y = UNDER.y;
  const lanes = [25, 85, 145];
  const jobs = ['gambler', 'drinker', 'lady', 'storyteller', 'beggar', 'watchman', 'vendor', 'brawler', 'sitter'];
  const doings = ['赌钱', '讨一碗汤', '倚栏望乡', '听戏', '游荡', '打更', '摆摊', '寻衅', '蹲坐'];
  // 44→62 且起点由 x=250 提前到 200：旧分布把近街（200–250）留成真空带，
  // 从街口机位看过去「人流可数」这一条不成立。加密端不改分布形状，只压近街密度。
  for (let i = 0; i < 62; i++) {
    const lane = lanes[i % lanes.length];
    const ji = i % jobs.length;
    const a = crowd.spawnActor({
      occ: jobs[ji],
      pos: new THREE.Vector3(200 + rng.range(0, 660), y, lane + rng.range(-6.5, 6.5)),
      skin: rng.pick([0xa8d8b8, 0x98c8a8, 0xb8c8d8]),
      cloth: rng.pick([0x2a3430, 0x3a2a34, 0x2a2a3a]),
      hat: rng.chance(0.4) ? 3 : 0,
      action: rng.pick(['stand', 'lookAround', 'kneel', 'sneak']),
      doing: doings[ji],
      data: { name: '游魂', nick: '鬼城', group: 'guest', weapon: '', desc: '丰都鬼城中的执念之魂', code: 'sprawl' + i },
    });
    a.pos.y = y;
    a.speed = 0.5;
  }
  // 街口鬼差：押解亡魂的差役，给鬼城一条秩序线
  for (let i = 0; i < 6; i++) {
    const a = crowd.spawnActor({
      occ: 'official',
      pos: new THREE.Vector3(300 + i * 96, y, 85 + (i % 2 ? 8 : -8)),
      skin: 0x8aa89a, cloth: 0x3a1428, hat: 2,
      action: rng.pick(['stand', 'lookAround']),
      doing: '押解亡魂',
      data: { name: '鬼差', nick: '丰都', group: 'job', weapon: '鐵叉', desc: '丰都街口押解亡魂的差役', code: 'guichai' + i },
    });
    a.pos.y = y;
    a.speed = 0.4;
  }
}

/** 冥河青萍：黄泉河面漂浮的青绿萍叶（小圆片，成片分布） */
export function duckweed(b: Baker, rng: RNG): void {
  const y = UNDER.y;
  for (let i = 0; i < 90; i++) {
    const x = rng.range(-360, 360);
    const z = rng.range(-86, -34);
    const s = rng.range(0.5, 1.3);
    b.cyl('leaf', 0.28 * s, 0.32 * s, 0.03, 6, x, y + 1.18, z, shade(0x4a7a4a, 0.85 + rng.next() * 0.3), rng.range(0, 3.14), 0, 0, true);
    if (i % 3 === 0) b.cyl('glow', 0.08, 0.08, 0.02, 5, x + 0.2, y + 1.2, z - 0.15, 0xbfe8a8);
  }
  b.kit('flora.duckweed', 90, y + 1.18);
}

// ============ WS-34 地府门楼（4 件 / 12 座）：北门楼 / 死门三 / 更楼两座 / 六道光门六座 ============
// 落位纪律：北门楼卡在油鍋(16,149)与牛坑(-16,149)之间的环北缺口，门总宽 11.4 → 与旋转狱体留 1.8m；
// 死门三落在环带三处狱间空隙（东/南/西），逐座按「门面朝环心」定向；更楼移出狱道弦线，落在广场两翼；
// 六道光门进阎罗殿前广场北缘（z=122，广场铺装 46×50 @ z100），避开骨白路 x±5.5 与广场既有灯/碑/桩。
// 石材一律 ash（wall 只属人间灰泥）；本段不取共享 rng。

type UnderBox = Parameters<Baker['box']>[0];

type UnderFrame = {
  bx: (g: UnderBox, lx: number, ly: number, lz: number, w: number, h: number, d: number, hex: number, pry?: number, prx?: number, prz?: number) => void;
  cy: (g: UnderBox, rt: number, rb: number, hh: number, seg: number, lx: number, ly: number, lz: number, hex: number, prz?: number, open?: boolean) => void;
  py: (g: UnderBox, rt: number, rb: number, lx: number, ly: number, lz: number, hex: number, sx: number, sy: number, sz: number) => void;
  rf: (g: UnderBox, lx: number, ly: number, lz: number, hex: number, sx: number, sy: number, sz: number) => void;
  at: (lx: number, lz: number) => [number, number];
};

function underFrame(b: Baker, gx: number, gz: number, ry: number): UnderFrame {
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [gx + lx * cs + lz * sn, gz - lx * sn + lz * cs];
  return {
    at,
    bx: (g, lx, ly, lz, w, h, d, hex, pry = 0, prx = 0, prz = 0) => {
      const [wx, wz] = at(lx, lz);
      b.box(g, w, h, d, wx, ly, wz, hex, ry + pry, prx, prz);
    },
    cy: (g, rt, rb, hh, seg, lx, ly, lz, hex, prz = 0, open = false) => {
      const [wx, wz] = at(lx, lz);
      b.cyl(g, rt, rb, hh, seg, wx, ly, wz, hex, ry, 0, prz, open);
    },
    py: (g, rt, rb, lx, ly, lz, hex, sx, sy, sz) => {
      const [wx, wz] = at(lx, lz);
      b.pyramid(g, rt, rb, wx, ly, wz, hex, ry, sx, sy, sz);
    },
    rf: (g, lx, ly, lz, hex, sx, sy, sz) => {
      const [wx, wz] = at(lx, lz);
      b.roofC(g, wx, ly, wz, hex, ry, sx, sy, sz);
    },
  };
}

/** 地府门楼石色档（ash 三档：墩身 / 线脚 / 压顶） */
const UG = { body: 0x38343e, foot: 0x413d4a, cap: 0x4a4652, face: 0x2f2b36, tile: 0x101218, ridge: 0x20242a };

export function buildUnderworldGates(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  const plazaTop = y + 0.07; // 殿前广场铺装顶
  // 北门楼：环北缺口 (0,150)，骨白路穿门而过，是环上唯一常开之门（D-ITM-0093）
  underNorthGate(b, sg, atlas, y + 0.1, 0, 150);
  // 死门三：东 (93.5,71.5) / 南 (32.4,-34) / 西 (-93.5,71.5)，砖封满掌印（D-ITM-0094）
  for (const [dx, dz] of [[93.5, 71.5], [32.4, -34], [-93.5, 71.5]] as const) {
    const ry = Math.atan2(-dx, -(dz - 55)) + Math.PI; // 掌印面朝环心 (0,55)，狱道上可见封砖
    underDeathGate(b, y, dx, dz, ry);
  }
  // 更楼两座：广场两翼 (±30,100)，悬「枉」字灯、置更鼓（D-ITM-0095）
  for (const s of [-1, 1]) underWatchTower(b, sg, atlas, y, s * 30, 100, s > 0 ? -Math.PI / 2 : Math.PI / 2);
  // 六道光门：广场北缘 z=122，六色各一道光帘（D-ITM-0102）
  const PATHS: readonly (readonly [string, number])[] = [
    ['天', 0xf6f0cf], ['人', 0xffc464], ['修罗', 0xff3a4a],
    ['畜生', 0x6a8698], ['饿鬼', 0x5f8a3e], ['地狱', 0x8a1a1e],
  ];
  PATHS.forEach(([, hex], k) => {
    const s = k < 3 ? -1 : 1;
    const order = k % 3;
    const lx = s * (6.9 + order * 4.5);
    underLightGate(b, plazaTop, lx, 122, hex);
  });
}

/** 1 北门楼（D-ITM-0093）：三墩两洞门楼 + 门内一片白雾 + 门额「北門」 + 更灯 */
function underNorthGate(b: Baker, sg: SignMesher, atlas: SignAtlas, base: number, x: number, z: number): void {
  const g = underFrame(b, x, z, 0);
  const PH = 8.6;
  g.bx('ash', 0, base + 0.2, 0, 11.4, 0.4, 5.6, UG.foot);
  g.bx('ash', 0, base + 0.46, 0, 10.8, 0.12, 5.0, UG.cap);
  for (const lx of [-4.9, 4.9]) {
    g.bx('ash', lx, base + 0.52 + PH / 2, 0, 1.7, PH, 4.6, UG.body);
    g.bx('ash', lx, base + 0.9, 0, 2.1, 0.7, 5.0, UG.foot);
    g.bx('ash', lx, base + 4.3, 0, 1.86, 0.26, 4.8, UG.cap);
    g.bx('ash', lx, base + 0.52 + PH - 0.18, 0, 1.9, 0.34, 4.8, UG.cap);
    for (let i = 0; i < 2; i++) g.bx('ash', lx, base + 2.4 + i * 2.6, 0, 1.68, 0.06, 4.64, 0x36323c);
  }
  b.kit('under.northGate.pier', 2, base + PH / 2);
  // 门框：上槛 + 门枕石 + 门槛
  g.bx('ash', 0, base + 7.5, 0, 8.7, 0.8, 4.7, UG.face);
  g.bx('ash', 0, base + 0.6, -1.1, 8.7, 0.24, 0.9, UG.cap);
  for (const s of [-1, 1]) g.bx('ash', s * 4.0, base + 0.72, -1.2, 0.7, 0.28, 0.7, UG.cap);
  // 双扇敞开（朝忘川方向，即 local −z）
  for (const s of [-1, 1]) {
    const p = s * 0.16;
    const cs2 = Math.cos(p);
    const sn2 = Math.sin(p);
    const cxl = s * 4.0 - s * 1.95 * cs2;
    const czl = -1.5 + s * 1.95 * sn2;
    const lp2 = (dx: number, dz: number): [number, number] => [cxl + dx * cs2 + dz * sn2, czl - dx * sn2 + dz * cs2];
    g.bx('lacquer', cxl, base + 0.72 + 3.3, czl, 3.9, 6.6, 0.2, 0x241a1e, p);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const [dx, dz] = lp2(-s * 1.4 + s * c * 1.05, 0.13);
      g.bx('metal', dx, base + 1.6 + r * 1.8, dz, 0.13, 0.13, 0.07, 0x5a5a66, p);
    }
    const [rx2, rz2] = lp2(-s * 1.0, 0.14);
    g.bx('metal', rx2, base + 3.1, rz2, 0.24, 0.24, 0.05, 0x6e6a58, p);
  }
  b.kit('under.northGate.door', 2, base + 4.0);
  // 门内白雾：门内望不见外（雾幕三层 + 冷光点，压在门洞后侧）
  for (let i = 0; i < 3; i++) {
    g.bx('ash', 0, base + 1.3 + i * 2.1, 1.1 + i * 0.5, 8.2 - i * 0.5, 2.6, 0.9, shade(0x8e949c, 1 - i * 0.05));
    g.bx('ash', -2.6 + i * 1.4, base + 2.2 + i * 1.6, 1.7, 2.4, 1.5, 0.6, shade(0x9aa0a8, 1 - i * 0.04));
  }
  g.bx('glow', 0, base + 3.4, 2.3, 6.4, 4.6, 0.04, 0x2a3038);
  b.kit('under.northGate.fog', 3, base + 3.4);
  // 门楼：石台 + 四柱 + 板壁 + 直棂窗 + 檐 + 脊 + 宝顶
  g.bx('ash', 0, base + 9.2, 0, 10.0, 0.34, 5.8, UG.foot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.bx('wood', sx * 4.2, base + 10.7, sz * 2.4, 0.36, 2.7, 0.36, 0x241c22);
  }
  for (const sz of [-1, 1]) {
    g.bx('wood', 0, base + 11.0, sz * 2.5, 8.8, 2.0, 0.26, 0x1e181e);
    for (let i = 0; i < 5; i++) g.bx('glow', -3.2 + i * 1.6, base + 11.1, sz * 2.64, 1.0, 1.0, 0.03, i % 2 ? 0x2a6a5a : 0x6a2a30);
  }
  g.rf('roof', 0, base + 12.1, 0, UG.tile, 11.4, 2.1, 6.8);
  g.bx('roof', 0, base + 14.2, 0, 9.4, 0.26, 0.4, UG.ridge);
  for (const s of [-1, 1]) g.bx('roof', 0, base + 12.18, s * 3.3, 11.8, 0.16, 0.5, UG.tile);
  g.bx('metal', 0, base + 14.5, 0, 0.4, 0.5, 0.4, 0x4a4652);
  g.bx('glow', 0, base + 14.9, 0, 0.3, 0.3, 0.3, 0x6a8a7a);
  b.kit('under.northGate.tower', 1, base + 11.0);
  sg.quad(atlas.text('under-gate-north', '北門', 260, 104, {
    color: '#c8ffe4', glow: '#3dff9c', bg: 'rgba(4,8,6,0.94)', border: 'rgba(61,255,156,.8)', fontPx: 76,
  }), 3.4, 1.2, x, base + 8.35, z - 2.38, Math.PI);
  b.kit('under.northGate.sign', 1, base + 8.35);
  for (const s of [-1, 1]) {
    g.bx('metal', s * 5.4, base + 6.6, -2.3, 0.07, 0.6, 0.07, 0x3a3440);
    g.bx('glow', s * 5.4, base + 6.0, -2.3, 0.3, 0.42, 0.3, s < 0 ? 0xff3a4a : 0x3dff9c);
    g.bx('metal', s * 5.4, base + 6.26, -2.3, 0.38, 0.06, 0.38, 0x4a4030);
  }
  b.kit('under.northGate.lamp', 2, base + 6.0);
  b.kit('under.northGate', 1, base);
}

/** 2 死门三（D-ITM-0094，逐座一座）：两墩 + 门楣 + 砖封 + 满掌印 + 朱封条 + 檐 */
function underDeathGate(b: Baker, y: number, x: number, z: number, ry: number): void {
  const g = underFrame(b, x, z, ry);
  g.bx('ash', 0, y + 0.15, 0, 5.4, 0.3, 2.8, UG.foot);
  g.bx('ash', 0, y + 0.34, 0, 5.0, 0.1, 2.5, UG.cap);
  for (const lx of [-2.0, 2.0]) {
    g.bx('ash', lx, y + 0.39 + 2.1, 0, 1.2, 4.2, 2.2, UG.body);
    g.bx('ash', lx, y + 0.62, 0, 1.5, 0.5, 2.4, UG.foot);
    g.bx('ash', lx, y + 4.5, 0, 1.32, 0.24, 2.3, UG.cap);
  }
  b.kit('under.deathGate.pier', 2, y + 2.4);
  g.bx('ash', 0, y + 4.62, 0, 5.0, 0.7, 2.3, UG.face);
  g.bx('ash', 0, y + 5.0, 0, 5.2, 0.22, 2.4, UG.cap);
  // 砖封：4 皮 × 3 丁
  for (let c = 0; c < 4; c++) {
    const off = c % 2 ? 0.24 : -0.24;
    for (let i = 0; i < 3; i++) {
      g.bx('ash', -0.92 + i * 0.92 + off, y + 0.68 + c * 0.98, -0.42, 0.86, 0.92, 0.6, shade(UG.body, 1.06 + c * 0.02));
    }
    g.bx('ash', 0, y + 1.22 + c * 0.98, -0.74, 3.0, 0.05, 0.03, 0x4e4a56);
  }
  // 掌印：封砖上按满掌印，偶有新添（两枚偏朱）
  for (let i = 0; i < 7; i++) {
    const hx = -1.1 + (i % 4) * 0.74;
    const hy = y + 1.1 + Math.floor(i / 4) * 1.05 + (i % 2) * 0.18;
    g.bx('ash', hx, hy, -0.74, 0.22, 0.26, 0.06, i === 2 || i === 5 ? 0x3a1a1e : 0x1a1418);
    g.bx('ash', hx, hy + 0.19, -0.74, 0.1, 0.09, 0.05, i === 2 || i === 5 ? 0x3a1a1e : 0x1a1418);
  }
  b.kit('under.deathGate.handprint', 7, y + 1.6);
  g.bx('lacquer', 0, y + 3.0, -0.76, 3.2, 0.18, 0.05, 0x1a1218);
  g.bx('lacquer', 0.9, y + 2.55, -0.77, 0.34, 0.32, 0.03, 0xa8302a);
  g.rf('roof', 0, y + 5.2, 0, UG.tile, 6.6, 1.3, 3.6);
  g.bx('roof', 0, y + 6.5, 0, 5.4, 0.2, 0.32, UG.ridge);
  b.kit('under.deathGate.seal', 1, y + 2.6);
  for (const s of [-1, 1]) {
    g.bx('metal', s * 2.7, y + 3.4, -1.35, 0.06, 0.4, 0.06, 0x3a3440);
    g.bx('glow', s * 2.7, y + 3.05, -1.35, 0.24, 0.32, 0.24, 0x9d6bff);
    g.bx('metal', s * 2.7, y + 3.26, -1.35, 0.3, 0.05, 0.3, 0x4a4030);
  }
  b.kit('under.deathGate.lamp', 2, y + 3.05);
  b.kit('under.deathGate', 1, y);
}

/** 3 更楼（D-ITM-0095，逐座）：石台 + 收分塔身 + 腰檐 + 更鼓 + 挑灯「枉」 + 攒尖顶 */
function underWatchTower(b: Baker, sg: SignMesher, atlas: SignAtlas, y: number, x: number, z: number, ry: number): void {
  const g = underFrame(b, x, z, ry);
  g.bx('ash', 0, y + 0.27, 0, 5.0, 0.54, 5.0, UG.foot);
  g.bx('ash', 0, y + 0.62, 0, 4.6, 0.2, 4.6, UG.cap);
  g.bx('ash', 0, y + 0.72 + 3.0, 0, 4.2, 6.0, 4.2, UG.body);
  g.bx('ash', 0, y + 3.9, 0, 4.3, 0.18, 4.3, UG.cap);
  g.bx('ash', 0, y + 7.0, 0, 3.9, 2.6, 3.9, UG.body);
  for (const s of [-1, 1]) {
    g.bx('ash', s * 1.55, y + 2.4, -2.11, 0.7, 1.1, 0.1, 0x241f28);
    g.bx('glow', s * 1.55, y + 2.4, -2.19, 0.5, 0.86, 0.04, 0x2a6a5a);
  }
  // 腰檐
  g.bx('roof', 0, y + 6.68, 0, 5.4, 0.2, 5.4, UG.tile);
  for (const s of [-1, 1]) {
    g.bx('roof', 0, y + 6.58, s * 2.75, 5.6, 0.14, 0.5, UG.tile);
    g.bx('roof', s * 2.75, y + 6.58, 0, 0.5, 0.14, 5.6, UG.tile);
  }
  b.kit('under.watchTower.body', 2, y + 4.0);
  // 更鼓：架 + 鼓身 + 皮面 + 钉
  g.bx('wood', 0, y + 4.62, -2.35, 1.5, 0.16, 0.7, 0x241c1a);
  for (const s of [-1, 1]) g.bx('wood', s * 0.34, y + 5.42, -2.35, 0.12, 1.16, 0.12, 0x1e1818);
  g.cy('wood', 0.44, 0.44, 0.52, 10, 0, y + 5.42, -2.35, 0x3a2a1e, Math.PI / 2);
  g.cy('fabric', 0.37, 0.37, 0.56, 10, 0, y + 5.42, -2.35, 0x8a7a5e, Math.PI / 2);
  b.kit('under.watchTower.drum', 2, y + 5.4);
  // 上层：四柱 + 板壁 + 直棂窗
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.bx('wood', sx * 1.7, y + 8.4, sz * 1.7, 0.26, 2.6, 0.26, 0x241c22);
  }
  for (const sz of [-1, 1]) {
    g.bx('wood', 0, y + 9.0, sz * 1.78, 3.3, 1.9, 0.2, 0x1e181e);
    for (let i = 0; i < 3; i++) g.bx('glow', -1.0 + i * 1.0, y + 9.1, sz * 1.93, 0.62, 0.86, 0.03, i % 2 ? 0x2a6a5a : 0x6a2a30);
  }
  // 挑臂「枉」字灯：朝广场一侧（local +z）
  g.bx('wood', 0, y + 10.0, 1.95, 0.18, 0.18, 1.1, 0x241c22);
  g.bx('wood', 0, y + 9.7, 2.42, 0.14, 0.7, 0.14, 0x241c22);
  g.bx('metal', 0, y + 10.15, 2.42, 0.1, 0.2, 0.1, 0x4a4650);
  g.bx('lacquer', 0, y + 8.95, 2.42, 0.62, 1.15, 0.5, 0x2a1a20);
  g.bx('glow', 0, y + 8.95, 2.2, 0.46, 0.9, 0.04, 0x5c2430);
  g.bx('glow', 0, y + 8.95, 2.66, 0.46, 0.9, 0.04, 0x5c2430);
  g.bx('metal', 0, y + 9.56, 2.42, 0.7, 0.08, 0.58, 0x4a4030);
  g.bx('fabric', 0, y + 8.3, 2.42, 0.16, 0.3, 0.16, 0x5c1b24);
  const [sx2, sz2] = g.at(0, 2.78);
  sg.quad(atlas.text('under-tower-wang', '枉', 96, 128, {
    color: '#ffb8b0', glow: '#ff3a4a', bg: 'rgba(10,4,6,0.9)', border: 'rgba(255,58,74,.8)', fontPx: 82, vertical: true,
  }), 0.56, 0.96, sx2, y + 8.95, sz2, ry);
  b.kit('under.watchTower.lantern', 1, y + 8.95);
  b.kit('under.watchTower.sign', 1, y + 8.95);
  // 攒尖顶
  g.rf('roof', 0, y + 9.7, 0, UG.tile, 4.6, 1.9, 4.6);
  g.bx('roof', 0, y + 11.5, 0, 2.6, 0.22, 0.32, UG.ridge);
  g.bx('metal', 0, y + 11.75, 0, 0.26, 0.5, 0.26, 0x4a4652);
  g.bx('glow', 0, y + 12.05, 0, 0.2, 0.2, 0.2, 0x3dff9c);
  b.kit('under.watchTower.roof', 1, y + 10.6);
  b.kit('under.watchTower', 1, y);
}

/** 4 六道光门（D-ITM-0102，逐座）：两柱一门 + 六色光帘 + 门枕石 + 檐，帘色即所通之道 */
function underLightGate(b: Baker, base: number, x: number, z: number, hex: number): void {
  const g = underFrame(b, x, z, 0);
  for (const s of [-1, 1]) {
    g.bx('ash', s * 1.25, base + 0.12, 0, 0.5, 0.24, 0.5, UG.foot);
    g.bx('ash', s * 1.25, base + 0.26, 0, 0.34, 0.14, 0.34, UG.cap);
    g.bx('ash', s * 1.25, base + 2.2, 0, 0.3, 3.8, 0.3, UG.body);
    g.bx('ash', s * 1.25, base + 3.9, 0, 0.36, 0.2, 0.36, UG.cap);
  }
  g.bx('ash', 0, base + 4.14, 0, 2.86, 0.3, 0.4, UG.face);
  g.bx('ash', 0, base + 4.34, 0, 3.0, 0.12, 0.48, UG.cap);
  for (const s of [-1, 1]) g.bx('ash', s * 0.9, base + 0.1, -0.4, 0.34, 0.2, 0.34, UG.cap);
  // 光帘：五道檐下光带，越往下越亮
  for (let i = 0; i < 5; i++) {
    g.bx('glow', 0, base + 0.62 + i * 0.68, -0.02, 2.3 - i * 0.06, 0.5, 0.03, shade(hex, 0.7 + i * 0.09));
  }
  g.bx('glow', 0, base + 0.04, -0.55, 2.4, 0.02, 1.5, shade(hex, 0.45));
  g.bx('roof', 0, base + 4.52, 0, 3.3, 0.16, 0.9, UG.tile);
  g.bx('roof', 0, base + 4.64, 0, 3.0, 0.1, 0.36, UG.ridge);
  b.kit('under.lightGate.curtain', 1, base + 2.0);
  b.kit('under.lightGate.hood', 1, base + 4.5);
  b.kit('under.lightGate', 1, base);
}


// ============ WS-37 地府构件补齐（D-ITM 台账 33 件） ============
// 卷 30《地府资产全录》逐件按「材质 / 形制 / 位置」落地：石材一律 ash（wall 自带蓝灰自发光，地府石不用 wall），
// 金属 metal、灯火 glow、纸件 fabric、木作 wood、棺椁 lacquer。属地：
// 鬼门关外 1 / 返阳门 3 / 黄泉路牌坊 2 / 引魂灯柱 1 / 血池湖 5 / 轮回归墟 2 / 判官厅前 3 / 丰都街面 12。
// 全部贴 UNDER.y 基面（丰都街面件取主街铺装顶 y+0.225），无悬空件。
const W37 = {
  st: 0x3b424a, stD: 0x2e2a34, stL: 0x4e5860, bone: 0xc8c0b0, boneD: 0x8e8878,
  soot: 0x1a161c, wood: 0x2a201a, woodD: 0x1e1814, iron: 0x26282c, steel: 0x9a9aa2,
  cu: 0xb87333, cuD: 0x6e4424, blood: 0x6e1f1f, bloodL: 0x8a1a24,
  paper: 0xc9b380, paperD: 0x8a7a52, lac: 0x2a1a1e, phos: 0x3dff9c, warm: 0xffb060, ice: 0xbaffef,
} as const;

/** 照壁：壁座 + 壁身 + 抱鼓石 + 瓦顶 + 砖雕壁心「鬼門關」+ 字缝渗红雾 */
function w37ScreenWall(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number): void {
  const y = UNDER.y;
  const W = 9.0, H = 5.0;
  b.box('ash', W + 1.0, 0.5, 2.0, x, y + 0.25, z, shade(W37.stD, 0.94));
  b.box('ash', W + 0.4, 0.24, 1.6, x, y + 0.62, z, W37.stL);
  b.box('ash', W, H - 0.74, 1.0, x, y + 0.74 + (H - 0.74) / 2, z, W37.st);
  for (const s of [-1, 1]) {
    b.box('ash', 0.42, H - 0.74, 1.22, x + s * (W / 2 - 0.21), y + 0.74 + (H - 0.74) / 2, z, shade(W37.stL, 1.05));
    // 抱鼓石：鼓身 + 鼓面 + 须弥座
    b.box('ash', 0.5, 0.9, 1.5, x + s * (W / 2 + 0.36), y + 0.45, z, W37.stD);
    b.cyl('ash', 0.55, 0.55, 0.3, 10, x + s * (W / 2 + 0.36), y + 0.95, z, shade(W37.stL, 1.02), 0, 0, Math.PI / 2);
  }
  b.box('ash', W + 0.24, 0.34, 1.26, x, y + H - 0.02, z, shade(W37.stL, 1.12));
  b.box('roof', W + 1.9, 0.28, 2.0, x, y + H + 0.17, z, 0x101218);
  for (const s of [-1, 1]) b.box('roof', W + 2.1, 0.18, 0.36, x, y + H + 0.31, z + s * 1.02, 0x141820);
  b.box('roof', W + 0.5, 0.26, 0.38, x, y + H + 0.47, z, 0x20242a);
  // 壁心砖雕：暗赭墙面 + 上下压条 + 三字匾
  b.box('ash', 6.7, 2.9, 0.16, x, y + 2.9, z + 0.55, 0x4a3c33);
  for (const s of [-1, 1]) b.box('ash', 7.1, 0.14, 0.22, x, y + 2.9 + s * 1.52, z + 0.54, W37.stD);
  sg.quad(atlas.text('w37-zhaobi', '鬼門關', 320, 96, {
    color: '#8e2a26', glow: '#6e1f1f', bg: 'rgba(74,60,51,0.95)', border: 'rgba(110,31,31,.7)', fontPx: 60,
  }), 5.0, 1.02, x, y + 3.05, z + 0.65, 0);
  // 字缝渗红雾：三道竖渗痕 + 壁脚积雾
  for (let i = 0; i < 3; i++) {
    b.box('glow', 0.09, 1.5 - i * 0.16, 0.03, x - 1.9 + i * 1.9, y + 2.1 - i * 0.1, z + 0.645, shade(W37.blood, 0.92));
    b.box('glow', 0.3, 0.05, 0.05, x - 1.9 + i * 1.9, y + 1.32 - i * 0.05, z + 0.65, shade(W37.bloodL, 1.1));
  }
  b.box('glow', 8.4, 0.1, 1.7, x, y + 0.52, z + 0.9, shade(W37.blood, 0.55));
  b.kit('under.zhaobi', 1, y + 2.6);
}

/** 阳气温光：门缝暖金光带 + 浮游光尘 + 门前地光斑 + 门柱暖灯 */
function w37WarmLight(b: Baker, x: number, z: number): void {
  const y = UNDER.y;
  // 门缝光带：五道横向暖光，越靠下越亮（门缝透出的阳间光）
  for (let i = 0; i < 5; i++) {
    b.box('glow', 4.8 - i * 0.06, 1.0, 0.05, x, y + 0.5 + i * 1.12, z + 0.9, shade(W37.warm, 0.5 + i * 0.1));
  }
  // 光尘：十六粒暖金浮游（左右两侧密度略异，读作雾被推开的一层）
  for (let i = 0; i < 16; i++) {
    const a = i * 0.618;
    const px = x + Math.cos(a * 3.1) * (0.4 + (i % 5) * 0.9);
    const pz = z + 0.7 + Math.sin(a * 2.3) * (0.5 + (i % 4) * 0.7);
    b.box('glow', 0.1, 0.1, 0.1, px, y + 0.6 + (i % 7) * 0.82, pz, shade(W37.warm, 0.85 + (i % 3) * 0.1));
  }
  // 门前地光斑：压在两柱之间的骨白路上（路顶 y+0.10），靠近门框处最亮
  b.box('glow', 5.6, 0.04, 5.6, x, y + 0.11, z + 1.6, shade(W37.warm, 0.4));
  b.box('glow', 3.4, 0.045, 2.4, x, y + 0.12, z + 1.1, shade(W37.warm, 0.62));
  // 门柱内侧暖灯：两柱内缘各一盏，光照在门槛上
  for (const s of [-1, 1]) {
    b.box('metal', 0.16, 0.1, 0.16, x + s * 3.1, y + 6.1, z + 0.5, 0x4a4030);
    b.box('glow', 0.22, 0.3, 0.22, x + s * 3.1, y + 5.9, z + 0.5, W37.warm);
    b.box('metal', 0.26, 0.05, 0.26, x + s * 3.1, y + 6.2, z + 0.5, 0x4a4030);
  }
  b.kit('under.warmLight', 1, y + 3.0);
}

/** 守门判官位：副判官长案 + 案面文牍 + 印匣 + 笔架 + 名籍匣 + 判官座 */
function w37JudgeDesk(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y;
  b.box('ash', 2.9, 0.16, 1.2, x, y + 0.86, z, shade(W37.stL, 1.08), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 1.24, sz * 0.44);
    b.box('wood', 0.16, 0.84, 0.16, px, y + 0.42, pz, W37.wood, ry);
  }
  b.box('wood', 2.5, 0.14, 0.3, x, y + 0.7, z, W37.woodD, ry);
  // 案面：三叠文牍 + 朱笔架 + 印匣 + 名籍匣（阳寿未绝籍）
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -1.0 + i * 0.2, -0.32 + i * 0.16);
    b.box('fabric', 0.62, 0.1, 0.44, px, y + 0.99 + i * 0.02, pz, shade(W37.paper, 0.86 + i * 0.06), ry + i * 0.05);
  }
  const [bx, bz] = lp(x, z, ry, 0.74, -0.3);
  b.box('wood', 0.4, 0.1, 0.16, bx, y + 0.99, bz, W37.woodD, ry);
  b.box('wood', 0.05, 0.42, 0.05, bx, y + 1.2, bz, shade(0x8a2a26, 1.0), ry, 0, 0.28);
  const [sx2, sz2] = lp(x, z, ry, 1.14, -0.02);
  b.box('lacquer', 0.34, 0.26, 0.34, sx2, y + 1.06, sz2, 0x3a2420, ry);
  b.box('glow', 0.2, 0.06, 0.2, sx2, y + 1.2, sz2, shade(0xb03a2e, 0.9), ry);
  const [gx2, gz2] = lp(x, z, ry, 0.2, 0.36);
  b.box('lacquer', 0.74, 0.22, 0.42, gx2, y + 1.05, gz2, 0x2a1f26, ry);
  b.box('glow', 0.6, 0.03, 0.3, gx2, y + 1.17, gz2, shade(W37.paper, 0.6), ry);
  // 判官座：矮榻 + 靠背 + 蒲团
  const [kx, kz] = lp(x, z, ry, 0, -1.05);
  b.box('wood', 1.3, 0.4, 0.66, kx, y + 0.2, kz, W37.wood, ry);
  b.box('wood', 1.24, 1.0, 0.14, kx, y + 0.85, kz - 0.26, W37.woodD, ry);
  b.cyl('fabric', 0.34, 0.4, 0.16, 10, kx, y + 0.48, kz, 0x2b1b3d);
  // 名籍木牌：案前立「核籍」小牌
  const [px2, pz2] = lp(x, z, ry, -1.5, 0.5);
  b.box('wood', 0.1, 1.0, 0.1, px2, y + 0.5, pz2, W37.woodD, ry);
  b.box('lacquer', 0.5, 0.66, 0.06, px2, y + 0.86, pz2, 0x2a1a1e, ry);
  b.box('glow', 0.36, 0.4, 0.02, px2, y + 0.86, pz2 + 0.04, shade(W37.paper, 0.62), ry);
  b.kit('under.judgeDesk', 1, y + 1.0);
}

/** 回生鼓：鼓架 + 大鼓（径 1.2）+ 双槌 + 鼓面心跳纹 + 鼓脚石础 */
function w37RevivalDrum(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y;
  for (const sx of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.86, 0);
    b.box('ash', 0.5, 0.22, 0.7, px, y + 0.11, pz, W37.stD, ry);
    b.box('wood', 0.18, 1.5, 0.18, px, y + 0.97, pz, W37.wood, ry, 0, sx * 0.06);
    b.box('metal', 0.3, 0.08, 0.3, px, y + 1.74, pz, 0x4a4030, ry);
  }
  b.box('wood', 2.0, 0.16, 0.2, x, y + 1.62, z, W37.woodD, ry);
  // 鼓身：木腔 + 双皮面（横置，轴沿局部 x）+ 两匝铁箍 + 鼓钉
  b.cyl('wood', 0.6, 0.6, 1.16, 14, x, y + 1.62, z, 0x3a2a1e, ry, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    const [fx, fz] = lp(x, z, ry, s * 0.6, 0);
    b.cyl('fabric', 0.56, 0.56, 0.06, 14, fx, y + 1.62, fz, 0x8a7a5e, ry, 0, Math.PI / 2);
    for (let k = 0; k < 8; k++) {
      const a = k * 0.785;
      const [rx3, rz3] = lp(0, 0, ry, 0, Math.sin(a) * 0.46);
      b.box('metal', 0.07, 0.07, 0.07, fx + rx3, y + 1.62 + Math.cos(a) * 0.46, fz + rz3, 0x6e5a3a, ry);
    }
  }
  for (const s of [-1, 1]) {
    const [mx, mz] = lp(x, z, ry, s * 0.34, 0);
    b.cyl('metal', 0.63, 0.63, 0.07, 14, mx, y + 1.62, mz, 0x5a4a30, ry, 0, Math.PI / 2);
  }
  // 鼓面心跳纹：两圈明灭的暗红鼓点（鼓点即心跳）
  for (const s of [-1, 1]) {
    const [fx, fz] = lp(x, z, ry, s * 0.64, 0);
    b.box('glow', 0.03, 0.34, 0.34, fx, y + 1.62, fz, shade(W37.blood, 1.0), ry);
    b.box('glow', 0.03, 0.2, 0.2, fx, y + 1.62, fz, shade(W37.bloodL, 1.2), ry);
  }
  // 双槌：斜靠鼓架
  for (const s of [-1, 1]) {
    const [hx, hz] = lp(x, z, ry, s * 1.1, 0.34);
    b.box('wood', 0.06, 0.7, 0.06, hx, y + 1.0, hz, W37.woodD, ry, 0, s * 0.3);
    b.box('fabric', 0.14, 0.16, 0.14, hx - s * 0.1, y + 1.36, hz, 0x8a7a5e, ry);
  }
  b.kit('under.revivalDrum', 1, y + 1.6);
}

/** 三间四柱牌坊：四柱 + 夹杆石 + 三间阑额 + 中楼匾「黄泉路」 + 背额「莫回頭」 + 三顶 */
function w37Paifang(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y;
  const COLS = [-5.8, -2.2, 2.2, 5.8] as const;
  for (const lx of COLS) {
    const [px, pz] = lp(x, z, ry, lx, 0);
    b.box('ash', 0.62, 8.4, 0.62, px, y + 4.2, pz, W37.st, ry);
    b.box('ash', 0.9, 0.34, 0.9, px, y + 8.55, pz, W37.stL, ry);
    b.box('ash', 1.24, 0.5, 1.24, px, y + 0.25, pz, W37.stD, ry);
    b.pyramid('ash', 0.36, 0.66, px, y + 0.72, pz, shade(W37.stL, 1.04), ry, 1, 0.5, 1);
  }
  // 阑额：中额（高）+ 两侧额（低）+ 由额垫板
  b.box('ash', 8.4, 0.72, 0.5, x, y + 7.1, z, shade(W37.stL, 1.02), ry);
  b.box('ash', 6.6, 0.44, 0.44, x, y + 5.4, z, shade(W37.stL, 0.98), ry);
  for (const s of [-1, 1]) {
    const [ex, ez] = lp(x, z, ry, s * 4.0, 0);
    b.box('ash', 3.6, 0.5, 0.46, ex, y + 6.3, ez, shade(W37.stL, 1.0), ry);
    b.box('ash', 3.6, 0.34, 0.42, ex, y + 4.9, ez, shade(W37.stL, 0.94), ry);
  }
  b.box('ash', 7.2, 0.34, 0.34, x, y + 6.5, z, W37.stD, ry);
  // 三顶：中楼（曲面）+ 两次楼（小曲面）+ 脊 + 檐口
  b.roofC('roof', x, y + 8.72, z, 0x101218, ry, 9.4, 1.5, 2.6);
  b.box('roof', 8.0, 0.2, 0.34, x, y + 10.1, z, 0x20242a, ry);
  for (const s of [-1, 1]) {
    const [rx2, rz2] = lp(x, z, ry, s * 4.0, 0);
    b.roofC('roof', rx2, y + 7.05, rz2, 0x121418, ry, 4.2, 0.9, 2.0);
    b.box('roof', 3.4, 0.16, 0.28, rx2, y + 7.9, rz2, 0x20242a, ry);
    const [lx2, lz2] = lp(x, z, ry, s * 4.0, 1.06);
    b.box('roof', 4.4, 0.12, 0.28, lx2, y + 7.02, lz2, 0x141820, ry);
  }
  for (const s of [-1, 1]) {
    const [ex2, ez2] = lp(x, z, ry, 0, s * 1.32);
    b.box('roof', 9.6, 0.14, 0.32, ex2, y + 8.78, ez2, 0x141820, ry);
  }
  // 坊额：正面「黄泉路」/ 背面「莫回頭」；坊柱幡联左右
  const [fx, fz] = lp(x, z, ry, 0, 0.28);
  sg.quad(atlas.text('w37-huangquan', '黄泉路', 300, 108, {
    color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(6,10,8,0.94)', border: 'rgba(61,255,156,.8)', fontPx: 76,
  }), 3.3, 1.05, fx, y + 7.08, fz, ry);
  const [bx2, bz2] = lp(x, z, ry, 0, -0.28);
  sg.quad(atlas.text('w37-mohuitou', '莫回頭', 300, 108, {
    color: '#ffb8b0', glow: '#ff3a4a', bg: 'rgba(10,4,6,0.94)', border: 'rgba(255,58,74,.75)', fontPx: 76,
  }), 3.3, 1.05, bx2, y + 7.08, bz2, ry + Math.PI);
  for (const s of [-1, 1]) {
    const [cx2, cz2] = lp(x, z, ry, s * 5.8, 0.34);
    b.box('wood', 0.86, 0.06, 0.06, cx2, y + 6.1, cz2, W37.woodD, ry);
    b.box('fabric', 0.8, 2.6, 0.05, cx2, y + 4.75, cz2, s < 0 ? 0x2a5c42 : 0x5c1b24, ry);
    b.box('wood', 0.9, 0.07, 0.07, cx2, y + 3.42, cz2, W37.woodD, ry);
    b.box('glow', 0.1, 0.1, 0.06, cx2, y + 6.24, cz2, s < 0 ? W37.phos : W37.bloodL, ry);
  }
  b.kit('under.paifang', 1, y + 7.0);
}

/** 镇坊石兽（一只）：须弥座 + 蹲兽身 + 四足 + 兽首 + 双角 + 眼窝绿火 + 尾 */
function w37Beast(b: Baker, x: number, z: number, ry: number, hex: number): void {
  const y = UNDER.y;
  b.box('ash', 1.9, 0.34, 1.5, x, y + 0.17, z, W37.stD, ry);
  b.box('ash', 1.5, 0.22, 1.14, x, y + 0.45, z, shade(W37.stL, 0.96), ry);
  b.box('ash', 1.2, 1.0, 0.86, x, y + 1.06, z, hex, ry);                 // 身
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.42, sz * 0.3);
    b.box('ash', 0.28, 0.62, 0.3, px, y + 0.87, pz, shade(hex, 0.92), ry);  // 足
    b.box('ash', 0.34, 0.16, 0.36, px, y + 0.56, pz, shade(W37.stL, 0.9), ry);  // 爪
  }
  const [hx, hz] = lp(x, z, ry, 0, 0.52);
  b.box('ash', 0.66, 0.62, 0.56, hx, y + 1.72, hz, shade(hex, 1.06), ry);   // 首
  b.box('ash', 0.4, 0.24, 0.36, hx, y + 1.42, hz + 0.16, shade(hex, 0.9), ry); // 颔
  for (const s of [-1, 1]) {
    const [ex, ez] = lp(hx, hz, ry, s * 0.24, 0.28);
    b.box('glow', 0.13, 0.1, 0.06, ex, y + 1.86, ez, W37.phos, ry);
    const [ax, az] = lp(hx, hz, ry, s * 0.2, -0.06);
    b.box('ash', 0.13, 0.34, 0.13, ax, y + 2.12, az, shade(hex, 0.84), ry, 0, s * 0.24);   // 角
  }
  const [tx, tz] = lp(x, z, ry, 0, -0.62);
  b.box('ash', 0.2, 0.24, 0.5, tx, y + 1.34, tz, shade(hex, 0.88), ry, -0.5, 0);
  b.kit('under.beast', 1, y + 1.4);
}

/** 引魂灯柱柱身铭文：柱脚石牌 + 阴刻三行 + 亡名行（细看是玩家可读的名字） */
function w37LampInscription(b: Baker, x: number, z: number, side: number, i: number): void {
  const y = UNDER.y;
  const hex = shade(W37.stL, 1.02);
  b.box('ash', 0.46, 0.62, 0.07, x + side * 0.17, y + 0.44, z, hex, side > 0 ? Math.PI / 2 : -Math.PI / 2);
  b.box('ash', 0.56, 0.1, 0.12, x + side * 0.17, y + 0.78, z, W37.stD, side > 0 ? Math.PI / 2 : -Math.PI / 2);
  for (let k = 0; k < 3; k++) {
    b.box('glow', 0.03, 0.07, 0.32 - k * 0.06, x + side * 0.19, y + 0.6 - k * 0.16, z, shade(W37.phos, 0.5));
  }
  // 最新一批亡名：三枚细朱点，随批次位置不一
  for (let k = 0; k < 3; k++) {
    b.box('glow', 0.025, 0.04, 0.1, x + side * 0.19, y + 0.44, z - 0.16 + k * 0.13 + (i % 3) * 0.02, shade(0xc9a06a, 0.8));
  }
  b.kit('under.lampInscription', 1, y + 0.5);
}

/** 黑石祭台：临湖台身 + 东向踏跺 + 台缘业纹 + 台面层层血渍（12×12 高 6） */
function w37BloodAltar(b: Baker, x: number, z: number): void {
  const y = UNDER.y;
  b.box('ash', 12.4, 0.5, 12.4, x, y + 0.25, z, shade(W37.stD, 0.9));
  b.box('ash', 12.0, 5.4, 12.0, x, y + 3.1, z, shade(0x2a262e, 1.0));
  b.box('ash', 12.4, 0.36, 12.4, x, y + 5.98, z, shade(W37.stL, 0.98));
  // 收分：台身四面各压一道暗线脚
  for (const s of [-1, 1]) {
    b.box('ash', 12.3, 0.22, 0.3, x, y + 4.3, z + s * 6.0, shade(W37.stD, 1.06));
    b.box('ash', 0.3, 0.22, 12.3, x + s * 6.0, y + 4.3, z, shade(W37.stD, 1.06));
  }
  // 台缘业纹：四周一圈薄刻槽（暗红），北面最密
  for (let i = 0; i < 9; i++) {
    b.box('glow', 0.9, 0.08, 0.05, x - 5.0 + i * 1.25, y + 5.2, z - 6.02, shade(W37.blood, 0.9));
    b.box('glow', 9.6, 0.05, 0.06, x, y + 1.5 + (i % 3) * 1.1, z - 6.04, shade(W37.blood, 0.7));
  }
  // 东向踏跺（面向阎罗殿 x=0）：五级
  for (let i = 0; i < 5; i++) {
    b.box('ash', 1.0, 0.9 - i * 0.16, 4.2, x + 6.5 + i * 0.9, y + (0.9 - i * 0.16) / 2, z, shade(W37.stL, 0.96 + i * 0.02));
  }
  // 台面血渍：四层错叠暗红斑，最上一层带亮边
  for (let i = 0; i < 4; i++) {
    b.box('glow', 8.4 - i * 1.1, 0.05, 8.0 - i * 1.0, x - 0.6 + i * 0.5, y + 6.18 + i * 0.01, z + 0.4 - i * 0.4, shade(W37.blood, 0.75 + i * 0.12));
  }
  b.box('glow', 2.6, 0.04, 1.8, x + 1.4, y + 6.24, z + 1.8, shade(W37.bloodL, 1.15));
  // 台心祭鬼槽：一具石盘与三支残烛
  b.cyl('ash', 1.4, 1.55, 0.4, 10, x - 1.2, y + 6.3, z - 1.0, shade(W37.stL, 0.92));
  b.cyl('glow', 1.15, 1.15, 0.06, 10, x - 1.2, y + 6.48, z - 1.0, shade(W37.blood, 0.8));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    b.box('glow', 0.1, 0.5 - i * 0.08, 0.1, x - 1.2 + Math.cos(a) * 0.7, y + 6.72, z - 1.0 + Math.sin(a) * 0.7, shade(W37.bone, 0.5));
  }
  b.kit('under.bloodAltar', 1, y + 3.0);
}

/** 锁链桩（八根之一）：石础 + 桩身 + 顶环 + 没水粗链四节 + 搏动暗光 */
function w37ChainStake(b: Baker, x: number, z: number, a: number, i: number): void {
  const y = UNDER.y;
  b.box('ash', 1.0, 0.36, 1.0, x, y + 0.18, z, shade(W37.stD, 0.96), a);
  b.box('ash', 0.7, 0.24, 0.7, x, y + 0.46, z, W37.stL, a);
  b.cyl('ash', 0.2, 0.26, 2.6, 7, x, y + 1.86, z, shade(0x33313a, 1.02));
  b.cyl('metal', 0.3, 0.3, 0.12, 9, x, y + 3.2, z, 0x8a8a92, a, Math.PI / 2);
  b.cyl('metal', 0.3, 0.3, 0.12, 9, x, y + 3.46, z, 0x7a7a82, a, Math.PI / 2);
  // 粗链：四节自顶环垂下没入水中（链身搏动）
  for (let k = 0; k < 4; k++) {
    const dir = a + (k % 2 ? 0.7 : -0.7);
    const px = x + Math.sin(dir) * (0.36 + k * 0.34);
    const pz = z + Math.cos(dir) * (0.36 + k * 0.34);
    b.box('metal', 0.26, 0.3, 0.12, px, y + 2.9 - k * 0.72, pz, k % 2 ? 0x8a8a92 : 0x6e6e78, dir);
    if (k === 3) b.box('glow', 0.3, 0.06, 0.3, px, y + 0.2, pz, shade(W37.blood, 1.2), dir);
  }
  b.box('glow', 0.02, 0.5, 0.02, x + Math.sin(a) * 0.24, y + 2.4, z + Math.cos(a) * 0.24, shade(W37.bloodL, 0.9 + (i % 3) * 0.1), a);
  b.kit('under.chainStake', 1, y + 1.8);
}

/** 铜柱（六根之一）：须弥石础 + 柱身 + 上下铜箍 + 柱顶兽头 + 凝血珠不坠 */
function w37CopperPillar(b: Baker, x: number, z: number, i: number): void {
  const y = UNDER.y;
  b.box('ash', 1.1, 0.4, 1.1, x, y + 0.2, z, shade(W37.stD, 0.94), i * 0.3);
  b.box('ash', 0.86, 0.26, 0.86, x, y + 0.53, z, W37.stL, i * 0.3);
  b.cyl('metal', 0.24, 0.3, 3.1, 10, x, y + 2.21, z, W37.cu);
  for (const dy of [0.72, 1.7, 3.4]) b.cyl('metal', 0.34, 0.34, 0.16, 10, x, y + dy, z, W37.cuD);
  b.pyramid('metal', 0.06, 0.34, x, y + 3.86, z, shade(W37.cu, 1.12), 0, 1, 0.5, 1);
  // 凝血珠：柱身三点暗红反光 + 柱脚积血一圈
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + i;
    b.box('glow', 0.1, 0.26, 0.1, x + Math.cos(a) * 0.27, y + 1.2 + k * 0.8, z + Math.sin(a) * 0.27, shade(W37.bloodL, 1.15));
  }
  b.box('glow', 0.9, 0.04, 0.9, x, y + 0.44, z, shade(W37.blood, 0.8));
  b.kit('under.copperPillar', 1, y + 2.0);
}

/** 血雾喷口（湖面一处）：石口 + 内壁 + 上喷红雾柱 + 池面雾盘 */
function w37BloodVent(b: Baker, x: number, z: number, i: number): void {
  const y = UNDER.y;
  b.cyl('ash', 1.5, 1.7, 0.5, 10, x, y + 0.35, z, shade(W37.stD, 0.92));
  b.cyl('ash', 1.15, 1.2, 0.16, 10, x, y + 0.66, z, shade(W37.stL, 0.9));
  b.cyl('glow', 1.0, 1.0, 0.08, 10, x, y + 0.72, z, shade(W37.blood, 0.55));
  for (let k = 0; k < 3; k++) {
    b.cyl('glow', 1.3 - k * 0.22, 0.9 - k * 0.16, 1.5 + k * 0.6, 7, x, y + 1.3 + k * 0.9, z, shade(W37.blood, 0.5 + k * 0.14), 0, 0, 0, true);
  }
  b.box('glow', 5.6, 0.03, 5.6, x, y + 0.2, z, shade(W37.blood, 0.4 + (i % 2) * 0.1));
  b.kit('under.bloodVent', 1, y + 1.4);
}

/** 祭台骨缘：台缘白骨垒缘 + 骨隙白骨苔 + 偶然"坐正"的一堆（坐台面，不悬空） */
function w37AltarBones(b: Baker, x: number, z: number, i: number): void {
  const y = UNDER.y + 6.16;   // 祭台压顶顶面
  const a = (i / 12) * Math.PI * 2 + 0.26;
  const px = x + Math.cos(a) * 5.3, pz = z + Math.sin(a) * 5.3;
  b.box('ash', 1.5, 0.5, 1.0, px, y + 0.25, pz, shade(W37.boneD, 0.9), a);
  b.box('ash', 1.2, 0.4, 0.8, px + Math.cos(a) * 0.2, y + 0.65, pz + Math.sin(a) * 0.2, shade(W37.bone, 0.95), a + 0.2);
  b.box('ash', 0.9, 0.34, 0.6, px - Math.cos(a) * 0.24, y + 1.0, pz - Math.sin(a) * 0.24, shade(W37.bone, 0.82), a - 0.3);
  // 长骨横搭：两根，末段挑出缘外
  b.cyl('ash', 0.12, 0.14, 1.5, 6, px, y + 1.2, pz, shade(W37.bone, 1.05), 0, 0, Math.PI / 2 + a);
  b.cyl('ash', 0.1, 0.12, 1.2, 6, px, y + 0.92, pz + 0.2, shade(W37.boneD, 1.1), 0, 0, Math.PI / 2 - a);
  // 骨隙白骨苔：三点磷绿
  for (let k = 0; k < 3; k++) {
    b.box('glow', 0.1, 0.06, 0.1, px + Math.cos(a + k) * 0.5, y + 0.44 + k * 0.22, pz + Math.sin(a + k) * 0.5, shade(0xbaffef, 0.55));
  }
  b.kit('under.altarBones', 1, y + 0.7);
}

/** 转轴魂柱：归墟坛三级 + 坛面石础 + 二十米收分魂柱 + 四道铁箍 + 缠柱魂链（叮当）+ 顶刹 */
function w37SoulAxle(b: Baker, x: number, z: number): void {
  const y = UNDER.y;
  // 归墟台地：冥土面止于 z=200，坛位在 215，先补一块同色冥土接板（顶面 y，与主冥土齐平不叠）
  b.box('ground', 48, 0.62, 33, 0, y - 0.31, 216.5, 0x2e2228);
  // 归墟坛：三级方坛（自冥土 y 起，第一级横跨 z=197 与地面相接，柱身不悬空）
  b.box('ash', 36, 0.6, 36, x, y + 0.3, z, shade(W37.stD, 0.9));
  b.box('ash', 28, 0.5, 28, x, y + 0.85, z, shade(W37.st, 1.0));
  b.box('ash', 20, 0.5, 20, x, y + 1.35, z, shade(W37.stL, 0.98));
  for (const s of [-1, 1]) {
    b.box('ash', 36.4, 0.1, 0.5, x, y + 0.62, z + s * 17.9, shade(W37.stL, 1.06));
    b.box('ash', 0.5, 0.1, 36.4, x + s * 17.9, y + 0.62, z, shade(W37.stL, 1.06));
  }
  b.box('ash', 14, 0.36, 14, x, y + 1.78, z, shade(W37.stD, 1.02));
  b.box('ash', 5.4, 0.36, 5.4, x, y + 2.14, z, shade(W37.stL, 0.96));
  for (const s of [-1, 1]) {
    b.box('ash', 5.6, 0.2, 0.4, x, y + 2.5, z + s * 2.6, shade(W37.stD, 1.06));
    b.box('ash', 0.4, 0.2, 5.6, x + s * 2.6, y + 2.5, z, shade(W37.stD, 1.06));
  }
  b.cyl('ash', 1.0, 1.55, 19.6, 8, x, y + 12.12, z, shade(0x35323c, 1.02), -Math.PI / 8);
  for (const dy of [3.2, 7.4, 11.6, 15.8]) {
    b.cyl('metal', 1.28 - dy * 0.028, 1.3 - dy * 0.028, 0.3, 8, x, y + 2.32 + dy, z, 0x4a4650, -Math.PI / 8);
  }
  // 缠柱魂链：十一匝，每匝三节错开，环环叮当（声源方位失真已属音频层）
  for (let k = 0; k < 11; k++) {
    const hy = y + 3.72 + k * 1.42;
    const rr = 1.62 - k * 0.036;
    const a = k * 0.72;
    for (let s = 0; s < 3; s++) {
      const aa = a + s * 2.09;
      b.box('metal', 0.26, 0.16, 0.1, x + Math.cos(aa) * rr, hy, z + Math.sin(aa) * rr, s % 2 ? 0x8a8a92 : 0x6e6e78, aa);
    }
  }
  b.cyl('metal', 0.9, 1.1, 0.34, 8, x, y + 22.1, z, 0x4a4650, -Math.PI / 8);
  b.pyramid('metal', 0.12, 0.74, x, y + 22.7, z, shade(0x8a8a92, 1.08), Math.PI / 8, 1, 1.1, 1);
  b.box('glow', 0.3, 0.3, 0.3, x, y + 23.4, z, shade(0x9d6bff, 0.7), 0, 0, Math.PI / 4);
  // 坛面六道纹：轮盘在坛上的放射刻槽（坛心六向，收在三级坛面 ±10 之内）
  for (let k = 0; k < 6; k++) {
    const a = k * 1.047 + 0.26;
    b.box('glow', 0.3, 0.04, 8.0, x + Math.cos(a) * 5.0, y + 1.62, z + Math.sin(a) * 5.0, shade(0x9d6bff, 0.32), -a - Math.PI);
  }
  b.kit('under.soulAxle', 1, y + 10.0);
}

/** 轮心墨洞：径三米纯黑轮心 + 外圈石毂 + 心跳暗环（任何光都不入） */
function w37WheelHub(b: Baker, x: number, z: number, hubY: number): void {
  b.cyl('ash', 2.5, 2.7, 0.5, 16, x, hubY, z, shade(0x33313a, 0.98), 0, Math.PI / 2);
  b.cyl('glow', 1.5, 1.5, 0.1, 16, x, hubY, z + 0.26, 0x04050a, 0, Math.PI / 2);
  b.cyl('ash', 1.86, 1.86, 0.14, 16, x, hubY, z + 0.34, shade(0x26242c, 0.9), 0, Math.PI / 2);
  // 心跳：两圈极暗红环，外环略宽（读作胎动般的搏动）
  b.cyl('glow', 1.74, 1.74, 0.03, 16, x, hubY, z + 0.42, shade(W37.blood, 0.4), 0, Math.PI / 2);
  b.cyl('glow', 1.58, 1.58, 0.03, 16, x, hubY, z + 0.44, shade(W37.bloodL, 0.55), 0, Math.PI / 2);
  // 六道纹：轮心放射六条刻槽
  for (let k = 0; k < 6; k++) {
    const a = k * 1.047;
    b.box('ash', 0.14, 0.86, 0.1, x + Math.cos(a) * 2.1, hubY + Math.sin(a) * 2.1, z + 0.4, shade(0x26242c, 1.1), -a, 0, 0);
  }
  b.kit('under.wheelHub', 1, hubY);
}

/** 市锣：木架两柱 + 横梁 + 悬锣（锣面/锣心/锣箍）+ 锣槌 + 开市三响的余震绳 */
function w37MarketGong(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.5, 0);
    b.box('ash', 0.6, 0.26, 0.6, px, y + 0.13, pz, W37.stD, ry);
    b.box('wood', 0.2, 3.5, 0.2, px, y + 1.98, pz, W37.wood, ry);
    b.box('metal', 0.3, 0.1, 0.3, px, y + 3.78, pz, 0x4a4030, ry);
  }
  b.box('wood', 3.4, 0.2, 0.22, x, y + 3.62, z, W37.woodD, ry);
  b.box('wood', 0.14, 0.5, 0.14, x, y + 3.3, z, W37.wood, ry);
  // 悬锣：锣面面向街心（世界 ±x），锣心凸起，外箍铜圈
  b.cyl('metal', 0.62, 0.62, 0.1, 16, x, y + 2.72, z, shade(W37.cu, 0.86), 0, 0, Math.PI / 2);
  b.cyl('metal', 0.26, 0.3, 0.14, 12, x + 0.1, y + 2.72, z, shade(W37.cu, 1.06), 0, 0, Math.PI / 2);
  b.cyl('metal', 0.7, 0.7, 0.06, 16, x - 0.07, y + 2.72, z, W37.cuD, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    const [rx, rz] = lp(x, z, ry, s * 0.4, 0);
    b.box('metal', 0.06, 0.44, 0.06, rx, y + 3.34, rz, 0x8a8a92, ry);
  }
  // 锣槌：斜挂架侧，槌头包布
  const [mx, mz] = lp(x, z, ry, 1.9, 0.3);
  b.box('wood', 0.07, 1.1, 0.07, mx, y + 1.5, mz, W37.woodD, ry, 0, 0.22);
  b.box('fabric', 0.2, 0.22, 0.2, mx - 0.12, y + 2.06, mz, 0x8a7a5e, ry);
  b.box('glow', 0.02, 1.4, 0.02, x, y + 1.9, z - 0.24, shade(0x9d2933, 0.7), ry);
  b.kit('under.marketGong', 1, y + 2.7);
}

/** 纸人阵列：橱窗台 + 背板 + 顶檐 + 十二尊纸人（眉眼随客转的一排素体） */
function w37PaperDolls(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 7.6, 0.42, 2.4, x, y + 0.21, z, shade(W37.stD, 0.96), ry);
  b.box('wood', 7.6, 2.9, 0.16, x, y + 1.87, z - 1.0, W37.woodD, ry);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 3.6, -1.0);
    b.box('wood', 0.16, 3.1, 0.16, px, y + 1.55, pz, W37.wood, ry);
  }
  b.box('roof', 8.0, 0.18, 2.6, x, y + 3.3, z - 0.3, 0x14161c, ry);
  for (let i = 0; i < 12; i++) {
    const row = i < 6 ? 0 : 1;
    const col = i % 6;
    const lx = -2.9 + col * 1.16 + row * 0.34;
    const lz = row === 0 ? 0.1 : 0.62;
    const [px, pz] = lp(x, z, ry, lx, lz);
    const hh = 1.42 + (i % 3) * 0.09;
    const paper = [0xc9b380, 0xd8cbb0, 0xb9a884][i % 3];
    b.box('fabric', 0.5, hh, 0.16, px, y + 0.42 + hh / 2, pz, paper, ry + (i % 2 ? 0.06 : -0.05));
    b.box('fabric', 0.2, 0.24, 0.18, px, y + 0.42 + hh + 0.14, pz, shade(paper, 1.06), ry);
    b.box('fabric', 0.52, 0.1, 0.2, px, y + 0.42 + hh + 0.3, pz, shade(W37.woodD, 1.1), ry);   // 纸冠
    if (i % 2 === 0) b.box('fabric', 0.08, hh * 0.74, 0.14, px - 0.3, y + 0.44 + hh * 0.5, pz, shade(paper, 0.94), ry);
    else b.box('fabric', 0.08, hh * 0.74, 0.14, px + 0.3, y + 0.44 + hh * 0.5, pz, shade(paper, 0.94), ry);
    b.box('glow', 0.05, 0.03, 0.03, px - 0.07, y + 0.42 + hh + 0.16, pz + 0.1, shade(0x1a1418, 1.0), ry);
    b.box('glow', 0.05, 0.03, 0.03, px + 0.07, y + 0.42 + hh + 0.16, pz + 0.1, shade(0x1a1418, 1.0), ry);
  }
  b.kit('under.paperDolls', 12, y + 1.4);
}

/** 烧件炉：铺前小炉 + 炉膛青焰 + 炉盖格栅 + 积灰 + 待烧纸件 + 火钳 */
function w37Burner(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 2.6, 0.3, 2.6, x, y + 0.15, z, shade(W37.stD, 0.94), ry);
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.86, t * 0.86);
    b.box('ash', 0.4, 1.5, 0.4, px, y + 1.05, pz, shade(0x35323c, 1.02), ry);
  }
  b.box('ash', 1.9, 0.34, 1.9, x, y + 1.94, z, W37.stL, ry);
  b.box('ash', 1.4, 0.9, 1.4, x, y + 1.35, z, shade(0x2a2830, 1.0), ry);
  // 炉膛：三面口 + 青焰芯 + 落灰
  b.box('glow', 1.02, 0.6, 0.06, x, y + 1.28, z + 0.72, shade(0x3fd6a0, 0.55), ry);
  for (let i = 0; i < 3; i++) {
    const [gx, gz] = lp(x, z, ry, -0.3 + i * 0.3, 0.7);
    b.box('glow', 0.2, 0.34 + (i % 2) * 0.16, 0.05, gx, y + 1.2, gz, shade(W37.phos, 0.7 + i * 0.1), ry);
  }
  // 炉盖格栅：五根铁条 + 盖框
  b.box('metal', 1.5, 0.1, 1.5, x, y + 2.16, z, 0x3a3a42, ry);
  for (let i = 0; i < 5; i++) {
    const [gx, gz] = lp(x, z, ry, -0.56 + i * 0.28, 0);
    b.box('metal', 0.08, 0.06, 1.3, gx, y + 2.24, gz, 0x4a4a52, ry);
  }
  b.box('ash', 0.8, 0.16, 0.7, x - 0.9, y + 2.06, z - 0.5, shade(W37.stD, 1.1), ry + 0.3);  // 灰堆
  // 待烧纸件：两捆纸钱 + 一具未烧的纸马
  const [px2, pz2] = lp(x, z, ry, 1.6, 0.5);
  for (let i = 0; i < 2; i++) b.box('fabric', 0.6, 0.16, 0.44, px2, y + 0.08 + i * 0.17, pz2, shade(W37.paper, 0.9 - i * 0.1), ry + i * 0.14);
  const [px3, pz3] = lp(x, z, ry, 1.7, -0.5);
  b.box('fabric', 0.5, 0.34, 0.9, px3, y + 0.24, pz3, shade(W37.paperD, 1.0), ry);
  // 火钳：斜靠炉身
  const [tx, tz] = lp(x, z, ry, -1.5, 0.4);
  b.box('metal', 0.05, 1.6, 0.05, tx, y + 1.0, tz, 0x5a5a62, ry, 0, 0.2);
  b.kit('under.burner', 1, y + 1.3);
}

/** 竖棺陈列：靠墙立架 + 三口竖棺（盖虚掩一指缝）+ 棺头阴纹 + 刨花绿火 */
function w37StandingCoffins(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 3.4, 0.3, 1.6, x, y + 0.15, z, shade(W37.stD, 0.96), ry);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.5, -0.6);
    b.box('wood', 0.22, 2.7, 0.22, px, y + 1.6, pz, W37.wood, ry);
  }
  b.box('wood', 3.2, 0.2, 0.22, x, y + 2.86, z - 0.6, W37.woodD, ry);
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -1.0 + i * 1.0, -0.18);
    const lean = -0.11 - (i % 2) * 0.02;
    b.box('lacquer', 0.82, 2.3, 0.62, px, y + 1.42, pz, i === 1 ? 0x33211c : 0x2a1a16, ry, lean);
    // 棺盖虚掩：盖板前移一指缝，缝内一线暗光
    const [gx, gz] = lp(px, pz, ry, 0, 0.36);
    b.box('lacquer', 0.86, 2.3, 0.12, gx, y + 1.44, gz, shade(0x3a2420, 1.06), ry, lean - 0.03);
    b.box('glow', 0.62, 2.0, 0.02, gx, y + 1.42, gz - 0.08, 0x120c10, ry);
    // 阴纹：木纹细看如人脸，油灯一照即隐——只留三道浅刻
    for (let k = 0; k < 3; k++) {
      b.box('lacquer', 0.5, 0.06, 0.02, gx, y + 0.7 + k * 0.56, gz + 0.08, shade(0x1c1210, 1.0), ry + 0.06 * (k - 1));
    }
  }
  // 铺脚：刨花堆燃绿火 + 两只空棺盖立靠
  b.box('wood', 1.2, 0.24, 0.6, x, y + 0.36, z + 0.7, shade(W37.woodD, 1.1), ry);
  b.box('glow', 0.7, 0.12, 0.34, x, y + 0.5, z + 0.7, shade(0x4a7a3a, 0.8), ry);
  for (let k = 0; k < 3; k++) b.box('glow', 0.1, 0.24 + k * 0.06, 0.1, x - 0.24 + k * 0.24, y + 0.66, z + 0.7, shade(W37.phos, 0.55), ry);
  b.kit('under.standingCoffins', 3, y + 1.4);
}

/** 尸牌墙：牌墙框 + 五排四十名牌（墨色由朱转黑）+ 压条 + 风钩 */
function w37CorpseTags(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 3.4, 0);
    b.box('ash', 0.34, 0.4, 0.5, px, y + 0.2, pz, W37.stD, ry);
    b.box('wood', 0.24, 3.5, 0.24, px, y + 1.95, pz, W37.wood, ry);
  }
  b.box('wood', 7.2, 0.26, 0.3, x, y + 3.6, z, W37.woodD, ry);
  b.box('wood', 6.9, 0.2, 0.26, x, y + 0.34, z, W37.woodD, ry);
  b.box('wood', 6.9, 2.9, 0.1, x, y + 2.0, z - 0.16, shade(W37.soot, 1.1), ry);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
    const [px, pz] = lp(x, z, ry, -3.0 + c * 0.86, 0.02);
    const t = r / 4;                                  // 停放时日起：上排最旧（黑），下排最鲜（朱）
    const col = t > 0.6 ? 0x3a1a1e : t > 0.3 ? 0x5c2a26 : 0x6e4438;
    b.box('fabric', 0.66, 0.46, 0.05, px, y + 0.66 + r * 0.6, pz, col, ry + (c % 3) * 0.02 - 0.02);
    b.box('glow', 0.4, 0.03, 0.02, px, y + 0.72 + r * 0.6, pz + 0.04, shade(W37.paper, 0.5 + t * 0.3), ry);
  }
  b.box('glow', 6.4, 0.06, 0.04, x, y + 3.44, z + 0.18, shade(W37.phos, 0.45), ry);
  b.kit('under.corpseTags', 40, y + 1.8);
}

/** 万魂签墙：千格签墙框 + 十排十四列小签（名字缓慢换位）+ 六枚亮签 */
function w37SoulTags(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 4.1, 0);
    b.box('ash', 0.4, 0.36, 0.6, px, y + 0.18, pz, W37.stD, ry);
    b.box('wood', 0.26, 3.9, 0.26, px, y + 2.15, pz, W37.wood, ry);
  }
  b.box('wood', 8.6, 0.3, 0.34, x, y + 4.0, z, W37.woodD, ry);
  b.box('wood', 8.4, 0.24, 0.3, x, y + 0.3, z, W37.woodD, ry);
  b.box('wood', 8.2, 3.4, 0.12, x, y + 2.16, z - 0.2, shade(W37.soot, 1.16), ry);
  // 签格：10 排 × 14 列，签面 paper；每格上沿一道压条
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 14; c++) {
      const [px, pz] = lp(x, z, ry, -3.7 + c * 0.57, 0);
      const lit = (r * 14 + c) % 23 === 0;
      b.box('fabric', 0.44, 0.24, 0.06, px, y + 0.62 + r * 0.32, pz, lit ? shade(W37.paper, 1.12) : shade(W37.paperD, 0.72 + (c % 4) * 0.05), ry);
      if (lit) b.box('glow', 0.3, 0.02, 0.02, px, y + 0.62 + r * 0.32, pz + 0.05, shade(W37.phos, 0.6), ry);
    }
    b.box('wood', 7.6, 0.05, 0.1, x, y + 0.76 + r * 0.32, z + 0.04, shade(W37.woodD, 1.1), ry);
  }
  b.kit('under.soulTags', 140, y + 2.0);
}

/** 戏台：台基 + 四柱 + 台口栏 + 上下场门 + 台口对联 + 檐 + 双灯 */
function w37Stage(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 9.2, 0.86, 6.4, x, y + 0.43, z, shade(W37.stD, 0.94), ry);
  b.box('ash', 9.4, 0.16, 6.6, x, y + 0.94, z, shade(W37.stL, 0.98), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 4.0, sz * 2.4);
    b.box('ash', 0.5, 0.24, 0.5, px, y + 1.06, pz, W37.stL, ry);   // 台角柱础
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 4.0, sz * 2.4);
    b.box('wood', 0.34, 4.6, 0.34, px, y + 3.3, pz, 0x241c22, ry);
  }
  // 台口栏：低栏 + 望柱四根（台口朝 local +z）
  const [fx, fz] = lp(x, z, ry, 0, 2.4);
  b.box('wood', 8.0, 0.12, 0.14, fx, y + 1.5, fz, W37.woodD, ry);
  for (let i = 0; i < 4; i++) {
    const [px, pz] = lp(x, z, ry, -3.0 + i * 2.0, 2.4);
    b.box('wood', 0.16, 0.66, 0.16, px, y + 1.36, pz, W37.wood, ry);
  }
  // 台面：地毯 + 台心桌 + 一椅（演出位）
  b.box('lacquer', 5.6, 0.06, 3.2, x, y + 1.06, z, 0x3a1c22, ry);
  const [tx2, tz2] = lp(x, z, ry, 0, -0.4);
  b.box('wood', 1.5, 0.12, 0.9, tx2, y + 1.5, tz2, W37.wood, ry);
  for (const s of [-1, 1]) b.box('wood', 0.12, 0.4, 0.12, tx2, y + 1.28, tz2 + s * 0.3, W37.woodD, ry);
  const [cx2, cz2] = lp(x, z, ry, 0, -1.5);
  b.box('wood', 0.8, 0.1, 0.7, cx2, y + 1.5, cz2, W37.wood, ry);
  b.box('wood', 0.8, 0.9, 0.1, cx2, y + 1.95, cz2 - 0.3, W37.woodD, ry);
  // 上下场门：后台两洞（挂帘）
  for (const s of [-1, 1]) {
    const [dx, dz] = lp(x, z, ry, s * 2.4, -2.3);
    b.box('wood', 1.5, 2.4, 0.14, dx, y + 2.3, dz, 0x241c22, ry);
    b.box('fabric', 1.3, 2.2, 0.06, dx, y + 2.2, dz + 0.1, s < 0 ? 0x2a5c42 : 0x5c1b24, ry);
    for (let k = 0; k < 3; k++) b.box('fabric', 0.34, 2.0, 0.03, dx - 0.4 + k * 0.4, y + 2.1, dz + 0.14, s < 0 ? 0x2f6a4c : 0x6a2228, ry);
  }
  // 台口对联（竖联，红底骨白）
  for (const s of [-1, 1]) {
    const [lx, lz] = lp(x, z, ry, s * 3.9, 2.5);
    b.box('lacquer', 0.62, 2.6, 0.08, lx, y + 3.0, lz - 0.04, 0x3a1c22, ry);
    b.box('wood', 0.06, 0.7, 0.06, lx, y + 4.6, lz, W37.woodD, ry);
    sg.quad(atlas.text('w37-stageCouplet' + (s < 0 ? 'A' : 'B'), s < 0 ? '三五步行遍天下' : '六七人百萬雄兵', 96, 400, {
      color: '#e8e3d5', vertical: true, fontPx: 42, bg: 'rgba(94,32,26,0.94)', border: 'rgba(200,180,140,.6)',
    }), 0.5, 2.4, lx, y + 3.0, lz, ry);
  }
  // 檐：曲面顶 + 脊 + 檐口 + 双灯
  b.roofC('roof', x, y + 5.7, z, 0x101218, ry, 11.4, 2.0, 8.6);
  b.box('roof', 9.6, 0.2, 0.36, x, y + 7.5, z, 0x20242a, ry);
  for (const s of [-1, 1]) {
    const [ex, ez] = lp(x, z, ry, 0, s * 2.65);
    b.box('roof', 11.6, 0.16, 0.4, ex, y + 5.76, ez, 0x141820, ry);
    const [lx2, lz2] = lp(x, z, ry, s * 3.6, 2.9);
    b.box('wood', 0.06, 0.4, 0.06, lx2, y + 4.9, lz2, W37.woodD, ry);
    b.box('glow', 0.34, 0.46, 0.34, lx2, y + 4.56, lz2, shade(W37.bloodL, 0.9), ry);
  }
  b.kit('under.stage', 1, y + 2.4);
}

/** 「夜夜笙歌」戏幌：幡杆 + 双绿灯 + 竖幡 + 开演转红的灯罩 */
function w37StageBanner(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 0.9, 0.3, 0.9, x, y + 0.15, z, W37.stD, ry);
  b.cyl('wood', 0.11, 0.15, 5.0, 6, x, y + 2.5, z, 0x201820);
  const [ax, az] = lp(x, z, ry, 0, 0.5);
  b.box('wood', 0.1, 0.1, 1.1, ax, y + 4.9, az, W37.woodD, ry);
  const [vx, vz] = lp(x, z, ry, 0, 0.86);
  b.box('fabric', 0.9, 2.5, 0.04, vx, y + 3.6, vz, 0x5c1b24, ry);
  b.box('wood', 0.96, 0.08, 0.1, vx, y + 4.86, vz, W37.woodD, ry);
  b.box('glow', 0.62, 0.06, 0.02, vx, y + 4.5, vz + 0.04, shade(W37.bloodL, 0.8), ry);
  sg.quad(atlas.text('w37-stageBanner', '夜夜笙歌', 88, 400, {
    color: '#ffd0c0', glow: '#ff3a4a', vertical: true, fontPx: 40, bg: 'rgba(36,10,12,0.6)',
  }), 0.66, 2.0, vx, y + 3.5, vz + 0.05, ry);
  for (const s of [-1, 1]) {
    const [lx, lz] = lp(x, z, ry, s * 1.1, 0.3);
    b.box('wood', 0.05, 0.9, 0.05, lx, y + 4.4, lz, W37.woodD, ry);
    b.box('glow', 0.3, 0.4, 0.3, lx, y + 3.86, lz, shade(W37.phos, 0.85), ry);
    b.box('metal', 0.36, 0.06, 0.36, lx, y + 4.08, lz, 0x4a4030, ry);
  }
  b.kit('under.stageBanner', 1, y + 3.8);
}

/** 血戏单：木牌架 + 戏单纸 + 朱字渗晕 + 压条（名目《目連救母》《六月雪》） */
function w37Playbill(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.72, 0);
    b.box('wood', 0.16, 0.3, 0.5, px, y + 0.15, pz, W37.wood, ry);
    b.box('wood', 0.12, 1.9, 0.12, px, y + 1.15, pz, W37.woodD, ry);
  }
  b.box('wood', 1.7, 0.12, 0.16, x, y + 2.06, z, W37.woodD, ry);
  const [p1x, p1z] = lp(x, z, ry, 0, 0.04);
  const [p2x, p2z] = lp(x, z, ry, 0, -0.04);
  const [p3x, p3z] = lp(x, z, ry, 0, 0.085);
  b.box('fabric', 1.5, 1.5, 0.05, p1x, y + 1.3, p1z, shade(W37.paper, 0.96), ry);
  b.box('fabric', 1.5, 1.5, 0.05, p2x, y + 1.3, p2z, shade(W37.paper, 0.84), ry);
  // 渗红：三处渐晕，越靠下越深
  for (let i = 0; i < 3; i++) {
    const [qx2, qz2] = lp(x, z, ry, -0.3 + i * 0.3, 0.085);
    b.box('glow', 0.5 - i * 0.1, 0.3, 0.02, qx2, y + 1.72 - i * 0.36, qz2, shade(W37.blood, 0.6 + i * 0.14), ry);
  }
  sg.quad(atlas.text('w37-playbill', '目連救母', 220, 80, {
    color: '#8e2a26', bg: 'rgba(201,179,128,0.96)', border: 'rgba(110,31,31,.5)', fontPx: 44,
  }), 1.24, 0.46, p3x, y + 1.86, p3z, ry);
  sg.quad(atlas.text('w37-playbill2', '六月雪', 180, 62, {
    color: '#4a2420', bg: 'rgba(201,179,128,0.94)', fontPx: 38,
  }), 0.9, 0.32, p3x, y + 0.86, p3z, ry);
  b.kit('under.playbill', 1, y + 1.2);
}

/** 阴阳秤：秤架 + 长秤杆 + 提绳 + 大小双盘 + 秤砣 + 星点（阳价与阴价不等） */
function w37Scale(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 1.0, 0.28, 1.0, x, y + 0.14, z, W37.stD, ry);
  b.box('wood', 0.2, 3.4, 0.2, x, y + 2.0, z, W37.wood, ry);
  // 横臂：沿局部 x（朝街的一侧挑出）
  b.box('wood', 2.4, 0.14, 0.14, x, y + 3.62, z, W37.woodD, ry);
  b.box('wood', 0.16, 0.7, 0.16, x, y + 3.0, z, W37.wood, ry, 0.14);
  // 秤杆：沿局部 z 前探（显式长条，不用 cyl 免去 Euler 轴向歧义）
  const [qx, qz] = lp(x, z, ry, 0, 1.3);
  b.box('wood', 0.1, 0.1, 2.6, qx, y + 3.52, qz, shade(0x4a3a24, 1.1), ry);
  for (let i = 0; i < 15; i++) {
    const [sx2, sz2] = lp(x, z, ry, 0, 0.3 + i * 0.17);
    b.box('glow', 0.06, 0.03, 0.05, sx2, y + 3.58, sz2, shade(W37.paper, 0.9), ry);
  }
  // 双盘：绳 + 铜盘（一深一浅，暗示阴阳价差）
  for (const [dd, rr, hex] of [[0.62, 0.44, 0xb87333], [2.5, 0.6, 0x8a6a3a]] as const) {
    const [px, pz] = lp(x, z, ry, 0, dd);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.09;
      const [hx2, hz2] = lp(0, 0, ry, Math.cos(a) * rr * 0.7, Math.sin(a) * rr * 0.7);
      b.box('wood', 0.03, 0.9, 0.03, px + hx2, y + 3.0, pz + hz2, 0x3a3026, ry);
    }
    b.cyl('metal', rr, rr * 0.9, 0.1, 12, px, y + 2.56, pz, hex);
    b.cyl('metal', rr * 0.96, rr * 0.96, 0.03, 12, px, y + 2.62, pz, shade(hex, 1.16));
  }
  // 秤砣：挂在杆尾
  const [tx, tz] = lp(x, z, ry, 0, -0.42);
  b.box('wood', 0.03, 0.7, 0.03, tx, y + 3.2, tz, 0x3a3026, ry);
  b.pyramid('metal', 0.12, 0.28, tx, y + 2.72, tz, 0x5a4a2a, ry, 1, 0.9, 1);
  b.kit('under.scale', 1, y + 3.0);
}

/** 洋火纸煤：火种柜 + 三层格 + 火柴五束 + 绿焰三簇 + 柜门半开 */
function w37MatchCabinet(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  b.box('ash', 1.5, 0.24, 1.1, x, y + 0.12, z, W37.stD, ry);
  b.box('wood', 1.4, 2.3, 1.0, x, y + 1.39, z, W37.wood, ry);
  b.box('wood', 1.54, 0.16, 1.06, x, y + 2.5, z, W37.woodD, ry);
  b.box('wood', 0.12, 1.9, 1.02, x - 0.7, y + 1.39, z, W37.woodD, ry);
  // 柜门：右扇半开（斜挂）
  const [dx, dz] = lp(x, z, ry, 0.42, 0.56);
  b.box('wood', 0.66, 1.9, 0.08, dx, y + 1.39, dz, shade(W37.wood, 1.18), ry, 0, -0.3);
  b.box('metal', 0.08, 0.12, 0.08, dx - 0.24, y + 1.36, dz + 0.06, 0x6e5a3a, ry);
  // 三层格：火柴束 + 纸煤卷
  for (let r = 0; r < 3; r++) {
    b.box('wood', 1.3, 0.06, 0.9, x, y + 0.6 + r * 0.66, z - 0.02, shade(W37.woodD, 1.1), ry);
    for (let c = 0; c < 5; c++) {
      const [px, pz] = lp(x, z, ry, -0.44 + c * 0.22, 0.02);
      b.box('fabric', 0.06, 0.34, 0.06, px, y + 0.8 + r * 0.66, pz, c % 2 ? 0xb8a06a : 0x8a7a52, ry + c * 0.1);
      b.box('glow', 0.04, 0.04, 0.04, px, y + 1.0 + r * 0.66, pz, shade(0x2f8a52, 0.9), ry);
    }
  }
  // 柜前绿焰三簇 + 划火声不同步（听感层，这里只留火苗错高）
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -0.34 + i * 0.32, 0.72);
    b.box('glow', 0.1, 0.26 + (i % 2) * 0.14, 0.1, px, y + 0.42, pz, shade(W37.phos, 0.72 + i * 0.1), ry);
  }
  b.kit('under.matchCabinet', 1, y + 1.3);
}

/** 唤客铜铃：门架两柱 + 横梁 + 铜铃（铃身/铃舌/铃纽）+ 拉绳 + 更次木牌 */
function w37GuestBell(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.23;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.5, 0);
    b.box('ash', 0.56, 0.24, 0.56, px, y + 0.12, pz, W37.stD, ry);
    b.box('wood', 0.22, 3.3, 0.22, px, y + 1.88, pz, W37.wood, ry);
    b.box('ash', 0.34, 0.16, 0.34, px, y + 3.6, pz, W37.stL, ry);
  }
  b.box('wood', 3.4, 0.22, 0.24, x, y + 3.46, z, W37.woodD, ry);
  b.cyl('wood', 0.07, 0.1, 0.3, 6, x, y + 3.2, z, 0x3a3026);
  // 铃身：喇叭形铜铃（上小下大）+ 铃舌 + 铃纽
  b.cyl('metal', 0.24, 0.42, 0.62, 12, x, y + 2.74, z, shade(W37.cu, 0.92));
  b.cyl('metal', 0.16, 0.2, 0.16, 10, x, y + 3.06, z, W37.cuD);
  b.box('metal', 0.1, 0.1, 0.1, x, y + 3.14, z, 0x7a6a44);
  b.cyl('metal', 0.08, 0.06, 0.34, 6, x, y + 2.5, z, 0x8a7a52);
  // 铃身纹：两道弦纹 + 一线磷光（铃哑而楼板应，故光弱）
  for (const dy of [2.72, 2.9]) b.cyl('metal', 0.3, 0.36, 0.04, 12, x, y + dy, z, 0x6e5a3a);
  b.box('glow', 0.24, 0.04, 0.24, x, y + 2.56, z, shade(W37.phos, 0.4));
  // 拉绳：自铃舌垂到人手高 + 绳结
  b.box('fabric', 0.03, 1.8, 0.03, x, y + 1.44, z + 0.06, 0x6a5a44);
  b.box('fabric', 0.09, 0.12, 0.09, x, y + 0.6, z + 0.06, 0x8a7a52);
  // 更次木牌：五更小牌挂梁侧
  for (let i = 0; i < 5; i++) {
    const [px, pz] = lp(x, z, ry, -0.9 + i * 0.45, 0.14);
    b.box('fabric', 0.06, 0.42, 0.02, px, y + 3.06, pz, shade(W37.paper, 0.8 - i * 0.06), ry);
  }
  b.kit('under.guestBell', 1, y + 2.8);
}

/** 皂隶立像：底座 + 下裳 + 上身 + 双袖 + 首 + 皂帽 + 水火棍 + 磷目（二尊成对） */
function w37YamenGuard(b: Baker, x: number, z: number, face: number, i: number): void {
  const y = UNDER.y;
  b.box('ash', 0.9, 0.24, 0.9, x, y + 0.12, z, shade(W37.stD, 0.94), face);
  b.box('wood', 0.56, 1.02, 0.4, x, y + 0.75, z, 0x1e2a26, face);
  b.box('wood', 0.66, 0.94, 0.44, x, y + 1.72, z, 0x243430, face);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, face, s * 0.4, 0.04);
    b.box('wood', 0.2, 0.78, 0.24, px, y + 1.62, pz, 0x1e2a26, face, 0, s * 0.1);
  }
  b.box('wood', 0.28, 0.3, 0.28, x, y + 2.34, z, 0x8fb898, face);
  b.box('wood', 0.72, 0.14, 0.72, x, y + 2.56, z, 0x1a1418, face);
  b.box('wood', 0.26, 0.2, 0.26, x, y + 2.72, z, 0x1a1418, face);
  // 水火棍：一手拄地，棍头包铁
  const [sx2, sz2] = lp(x, z, face, 0.52, 0.1);
  b.cyl('wood', 0.06, 0.07, 2.5, 6, sx2, y + 1.3, sz2, 0x3a2a1e);
  b.cyl('metal', 0.08, 0.08, 0.24, 6, sx2, y + 2.44, sz2, 0x8a8a92);
  b.cyl('lacquer', 0.075, 0.075, 0.3, 6, sx2, y + 0.62, sz2, 0x6e1f1f);
  // 磷目：一眼随人动，一眼常暗
  b.box('glow', 0.07, 0.05, 0.04, x + Math.sin(face) * 0.15 + (i ? 0.07 : -0.07), y + 2.36, z + Math.cos(face) * 0.15, i ? shade(W37.phos, 0.9) : shade(W37.phos, 0.5), face);
  b.kit('under.yamenGuard', 1, y + 1.2);
}

/** 功过格：长案 + 善簿恶簿两函 + 自翻簿页 + 朱墨双砚 + 标目牌 */
function w37LedgerStand(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y;
  b.box('ash', 2.6, 0.16, 1.15, x, y + 0.9, z, shade(W37.stL, 1.06), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 1.1, sz * 0.42);
    b.box('wood', 0.16, 0.88, 0.16, px, y + 0.44, pz, W37.wood, ry);
  }
  b.box('wood', 2.3, 0.12, 0.24, x, y + 0.76, z, W37.woodD, ry);
  for (let i = 0; i < 2; i++) {
    const [px, pz] = lp(x, z, ry, -0.62 + i * 1.24, 0);
    b.box('lacquer', 0.62, 0.3, 0.44, px, y + 1.12, pz, i ? 0x2a1f26 : 0x33201c, ry);
    b.box('fabric', 0.54, 0.04, 0.36, px, y + 1.29, pz, shade(W37.paper, i ? 0.92 : 0.86), ry);
    // 自翻簿页：两页错开一线，页角上翘
    b.box('fabric', 0.3, 0.05, 0.36, px - 0.1, y + 1.33, pz, shade(W37.paper, 1.04), ry + 0.14);
    b.box('glow', 0.26, 0.02, 0.3, px - 0.1, y + 1.36, pz, shade(W37.paper, 0.62), ry);
  }
  // 双砚：朱 / 墨（阴德账目两色）
  const [zx, zz] = lp(x, z, ry, 0, 0.44);
  b.cyl('ash', 0.2, 0.22, 0.1, 8, zx, y + 1.03, zz, shade(W37.stD, 1.1));
  b.cyl('glow', 0.16, 0.16, 0.04, 8, zx, y + 1.08, zz, shade(0xb03a2e, 0.9));
  const [mx, mz] = lp(x, z, ry, 0.36, 0.44);
  b.cyl('ash', 0.18, 0.2, 0.1, 8, mx, y + 1.03, mz, shade(W37.stD, 1.1));
  b.cyl('glow', 0.14, 0.14, 0.04, 8, mx, y + 1.08, mz, 0x14161c);
  // 标目牌：「善」「恶」两小牌立在函后
  for (const [s, ch] of [[-1, '善'], [1, '恶']] as const) {
    const [px, pz] = lp(x, z, ry, s * 0.62, -0.38);
    b.box('wood', 0.08, 0.6, 0.08, px, y + 1.24, pz, W37.woodD, ry);
    b.box('lacquer', 0.3, 0.34, 0.04, px, y + 1.56, pz, 0x2a1a1e, ry);
    b.box('glow', 0.18, 0.2, 0.02, px, y + 1.56, pz + 0.03, shade(ch === '善' ? W37.phos : W37.bloodL, 0.8), ry);
  }
  b.kit('under.ledgerStand', 1, y + 1.1);
}

/** 福签筒：签案 + 竹筒 + 十二支签 + 落地两签 + 签文磷光 */
function w37FortuneSticks(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y;
  b.box('ash', 1.9, 0.14, 0.95, x, y + 0.86, z, shade(W37.stL, 1.04), ry);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.14, 0.8, 0.14, x + sx * 0.72, y + 0.4, z, W37.wood, ry);
    b.box('wood', 1.6, 0.1, 0.16, x, y + 0.76, z + sx * 0.28, W37.woodD, ry);
  }
  b.cyl('ceramic', 0.3, 0.24, 0.78, 12, x, y + 1.32, z, 0x4a4a52);
  b.cyl('metal', 0.31, 0.31, 0.05, 12, x, y + 1.7, z, 0x6e5a3a);
  for (let i = 0; i < 12; i++) {
    const a = i * 0.62;
    const r = 0.03 + (i % 4) * 0.038;
    b.box('fabric', 0.045, 0.7 + (i % 3) * 0.1, 0.045, x + Math.cos(a) * r, y + 1.88, z + Math.sin(a) * r, shade(W37.paper, 0.86 + (i % 2) * 0.1), a, (i % 3 - 1) * 0.1, 0);
  }
  // 落地两签：一支横、一支斜
  b.box('fabric', 0.05, 0.05, 0.7, x - 0.5, y + 0.11, z + 0.34, shade(W37.paper, 0.84), 0.5);
  b.box('fabric', 0.05, 0.05, 0.66, x + 0.42, y + 0.12, z + 0.5, shade(W37.paper, 0.92), 1.1);
  // 签文牌：案侧小架
  const [bx, bz] = lp(x, z, ry, -0.86, -0.3);
  b.box('wood', 0.06, 0.9, 0.06, bx, y + 1.4, bz, W37.woodD, ry);
  b.box('fabric', 0.34, 0.46, 0.02, bx, y + 1.62, bz, shade(W37.paper, 0.9), ry);
  b.box('glow', 0.2, 0.03, 0.02, bx, y + 1.62, bz + 0.03, shade(W37.phos, 0.55), ry);
  b.kit('under.fortuneSticks', 1, y + 1.5);
}

/** WS-37 总装：33 件分布在鬼门关外 / 返阳门 / 黄泉路 / 引魂灯柱 / 血池湖 / 归墟 / 判官厅 / 丰都街面 */
export function buildUnderworldProps(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  // ---- 鬼门关外（D-ZZ-03）----
  w37ScreenWall(b, sg, atlas, 180, 37);                                   // 照壁：D-ITM-0072
  // ---- 返阳门（D-ZZ-13，(0,-124) 牌坊）----
  w37WarmLight(b, 0, -124);                                               // 阳气温光：D-ITM-0077
  w37JudgeDesk(b, -7.3, -127.6, Math.PI / 2);                             // 守门判官位：D-ITM-0078
  w37RevivalDrum(b, 7.3, -127.6, -Math.PI / 2);                           // 回生鼓：D-ITM-0079
  // ---- 黄泉路西口（骨白路南端 (0,-196)）----
  w37Paifang(b, sg, atlas, 0, -196, 0);                                   // 三间四柱牌坊：D-ITM-0107
  w37Beast(b, -7.6, -193.4, Math.PI / 2, shade(W37.stL, 1.02));           // 镇坊石兽：D-ITM-0109
  w37Beast(b, 7.6, -193.4, -Math.PI / 2, shade(W37.stL, 0.96));           // 镇坊石兽：D-ITM-0109
  // ---- 引魂灯柱柱身铭文（既有 21 座灯柱，取四座刻铭）----
  const INSC: readonly (readonly [number, number, number])[] = [[-1, -120, 0], [1, -72, 1], [-1, -24, 2], [1, 24, 3]];
  for (const [s, z, i] of INSC) w37LampInscription(b, s * 7, z, s, i);   // 柱身铭文：D-ITM-0112
  // ---- 血池湖（D-ZZ-10，卷面 (-240,60) 湖湾）：池面 + 石堤 + 祭台 + 桩 + 柱 + 雾口 + 骨缘 ----
  w37BloodPool(b);
  w37BloodAltar(b, -240, 88);                                             // 黑石祭台：D-ITM-0087
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785 + 0.2;
    w37ChainStake(b, -240 + Math.cos(a) * 21, 58 + Math.sin(a) * 21, a, k);  // 锁链桩：D-ITM-0088
  }
  const PILLARS: readonly (readonly [number, number])[] = [[-250, 84], [-250, 93], [-244, 78], [-236, 78], [-230, 84], [-230, 93]];
  PILLARS.forEach(([px, pz], i) => w37CopperPillar(b, px, pz, i));        // 铜柱：D-ITM-0089
  const VENTS: readonly (readonly [number, number])[] = [[-266, 42], [-214, 42], [-266, 78], [-214, 78]];
  VENTS.forEach(([px, pz], i) => w37BloodVent(b, px, pz, i));             // 血雾喷口：D-ITM-0090
  for (let k = 0; k < 12; k++) w37AltarBones(b, -240, 88, k);             // 祭台骨缘：D-ITM-0091
  // ---- 轮回归墟（D-ZZ-13，坛心 (0,215)）：转轴魂柱 + 轮心墨洞 ----
  w37SoulAxle(b, 0, 215);                                                 // 转轴魂柱：D-ITM-0101
  w37WheelHub(b, 0, 216.3, y + 10.6);                                     // 轮心墨洞：D-ITM-0100
  // ---- 判官厅门前（D-ZZ-08 西侧，(-56,62) 厅前庭）----
  w37YamenGuard(b, -61.2, 72.4, Math.PI, 0);                              // 皂隶立像：D-ITM-0152
  w37YamenGuard(b, -50.8, 72.4, Math.PI, 1);                              // 皂隶立像：D-ITM-0152
  w37LedgerStand(b, -46.4, 74.6, -Math.PI / 2);                           // 功过格：D-ITM-0150
  w37FortuneSticks(b, -65.6, 74.6, Math.PI / 2);                          // 福签筒：D-ITM-0151
  // ---- 丰都鬼城街面（D-ZZ-11）：主街 z=145 / z=25 街心，避灯柱(±7.6)、招魂幡(±9.6) 与南北巷口(x=280…840)----
  w37MarketGong(b, 238, 85, Math.PI / 2);                                 // 市锣：D-ITM-0119
  w37PaperDolls(b, 320, 145, 0);                                          // 纸人阵列：D-ITM-0132
  w37Burner(b, 400, 145, 0);                                              // 烧件炉：D-ITM-0136
  w37StandingCoffins(b, 480, 145, 0);                                     // 竖棺陈列：D-ITM-0138
  w37CorpseTags(b, 560, 145, 0);                                           // 尸牌墙：D-ITM-0147
  w37SoulTags(b, 640, 145, 0);                                             // 万魂签墙：D-ITM-0180
  w37Stage(b, sg, atlas, 720, 145, Math.PI);                              // 戏台：D-ITM-0164
  w37StageBanner(b, sg, atlas, 727.6, 140.4, Math.PI);                    // 「夜夜笙歌」戏幌：D-ITM-0167
  w37Playbill(b, sg, atlas, 712.4, 140.4, Math.PI);                       // 血戏单：D-ITM-0168
  w37GuestBell(b, 320, 25, 0);                                            // 唤客铜铃：D-ITM-0158
  w37Scale(b, 400, 25, 0);                                                // 阴阳秤：D-ITM-0170
  w37MatchCabinet(b, 480, 25, 0);                                         // 洋火纸煤：D-ITM-0173
}

/** 血池湖池面（承托 0087～0091 五件的湖湾本体）：水面 + 石堤 + 血沫 + 岸线骨苔 */
function w37BloodPool(b: Baker): void {
  const y = UNDER.y;
  const cx = -240, cz = 60;
  b.box('ground', 92, 0.2, 78, cx, y + 0.1, cz, 0x2a1218);
  b.box('glow', 88, 0.06, 74, cx, y + 0.19, cz, 0x3e0c12);
  for (let i = 0; i < 14; i++) {
    const a = i * 0.449;
    b.box('glow', 8 + (i % 4) * 5, 0.04, 0.6, cx + Math.cos(a) * 20, y + 0.24, cz + Math.sin(a) * 18, i % 3 === 0 ? 0x8a1a24 : 0x5c1018, a);
  }
  // 石堤：四面压边（ash），北 / 南面留出祭台与踏跺位
  for (const s of [-1, 1]) {
    b.box('ash', 94, 0.44, 1.6, cx, y + 0.22, cz + s * 39.2, shade(W37.stD, 0.96));
    b.box('ash', 1.6, 0.44, 80, cx + s * 46.2, y + 0.22, cz, shade(W37.stD, 0.96));
    b.box('ash', 94, 0.1, 1.9, cx, y + 0.48, cz + s * 39.2, shade(W37.stL, 1.0));
    b.box('ash', 1.9, 0.1, 80, cx + s * 46.2, y + 0.48, cz, shade(W37.stL, 1.0));
  }
  for (let i = 0; i < 10; i++) {
    b.box('glow', 0.14, 0.1, 0.14, cx - 44 + i * 9.8, y + 0.58, cz + 39.2, shade(0x8a1a24, 0.8));
    b.box('glow', 0.14, 0.1, 0.14, cx - 44 + i * 9.8, y + 0.58, cz - 39.2, shade(0x8a1a24, 0.8));
  }
  b.kit('under.bloodPool', 1, y + 0.2);
}

// ============ WS-42 地府 data-only 29 件补齐（D-ITM 台账） ============
// 卷 30《地府资产全录》逐件按「材质 / 形制 / 位置」落地：石材一律 ash（wall 自带蓝灰自发光，地府石不用），
// 金属 metal、灯火 glow、纸件与布 fabric、木作 wood、陶 ceramic、漆 lacquer、顶瓦 roof。
// 属地：鬼门关街口 1 / 枉死城 3 / 丰都城垣 1 / 阴阳界井口 1 / 丰都九坊铺面 23。
// 全部贴地府基面（UNDER.y；丰都街面件取铺装顶 y+0.19），无悬空件；kit 全部 under.*，draw call 0 增量。
const W42 = {
  st: 0x3b424a, stD: 0x2e2a34, stL: 0x4e5860, brick: 0x3a322c, brickL: 0x4a3c33,
  moss: 0x4a4a40, wood: 0x2a201a, woodD: 0x1e1814, iron: 0x26282c, steel: 0x9a9aa2,
  cu: 0xb87333, cuD: 0x6e4424, blood: 0x6e1f1f, bloodL: 0x8a1a24,
  paper: 0xc9b380, paperD: 0x8a7a52, lac: 0x2a1a1e, bone: 0xc8c0b0, boneD: 0x8e8878,
  phos: 0x3dff9c, ice: 0xbaffef, warm: 0xffb060, cloth: 0x2b1b3d, cloth2: 0x4a3f30,
} as const;

/** 城垣段：墙身 + 墙根湿带 + 压顶 + 苔痕如泪痕成行 + 墙头白幡（gaps 为距起点的 [起,止] 米区间＝门洞） */
function w42WallRun(b: Baker, ax: number, az: number, bx: number, bz: number, y: number, h: number, t: number, hex: number, gaps: readonly (readonly [number, number])[], banners: number): number {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1) return 0;
  const ux = dx / len, uz = dz / len, ang = Math.atan2(dx, dz);
  const segs: [number, number][] = [];
  let cur = 0;
  for (const g of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g[0] > cur) segs.push([cur, g[0]]);
    cur = Math.max(cur, g[1]);
  }
  if (cur < len) segs.push([cur, len]);
  let n = 0;
  for (const [s0, s1] of segs) {
    const L = s1 - s0;
    if (L < 1.2) continue;
    const mx = ax + ux * (s0 + L / 2), mz = az + uz * (s0 + L / 2);
    b.box('ash', t, h, L, mx, y + h / 2, mz, hex, ang);
    b.box('ash', t + 0.08, 1.2, L, mx, y + 0.6, mz, shade(hex, 0.84), ang);        // 墙根湿带
    b.box('ash', t + 0.5, 0.38, L, mx, y + h + 0.19, mz, shade(hex, 1.24), ang);    // 压顶（出檐 0.25）
    b.box('ash', t + 0.64, 0.14, L, mx, y + h + 0.44, mz, shade(W42.stL, 0.9), ang); // 压顶上皮
    // 苔痕如泪痕成行：每 6m 一道竖向苔线，穿透墙厚，两面同见
    const streaks = Math.max(1, Math.round(L / 6));
    for (let k = 0; k < streaks; k++) {
      const s = s0 + (L * (k + 0.5)) / streaks;
      const sh = 2.2 + (k % 3) * 0.9;
      b.box('ash', t + 0.1, sh, 0.14, ax + ux * s, y + 1.2 + sh / 2, az + uz * s, W42.moss, ang);
    }
    n += 3 + streaks;
  }
  // 墙头无雉堞只插白幡：沿整段均布，幡面与墙面同向（薄在法线方向）
  for (let k = 0; k < banners; k++) {
    const s = (len * (k + 0.5)) / banners;
    const px = ax + ux * s, pz = az + uz * s;
    b.box('wood', 0.09, 1.9, 0.09, px, y + h + 1.02, pz, W42.wood, ang);
    b.box('fabric', 0.05, 1.45, 0.58, px, y + h + 1.6, pz, shade(0xd8d0c0, 1.0), ang);
    b.box('fabric', 0.05, 0.34, 0.2, px + Math.cos(ang) * 0.03, y + h + 0.86, pz - Math.sin(ang) * 0.03, shade(0xb8b0a0, 0.94), ang);
    n += 3;
  }
  return n;
}

// 门钉铜乳：D-ITM-0071
/** 鬼门关过街门洞两扇板门：门板 + 上下横带 + 九路八十一铜乳钉（碗口大）+ 铺首 + 门槛（门外开，不挡黄泉路） */
function w42GateStuds(b: Baker, x: number, z: number): void {
  const base = UNDER.y + 0.19 + 0.34;      // 门枕石落面 = 城门台明顶
  const TH = 0.95, L = 4.02;               // 开启角 / 单扇宽（门洞净宽 8.2 分两扇）
  for (const s of [-1, 1]) {
    const hz = z + s * 4.1;                                     // 门轴贴墩身内 face
    const ry = s < 0 ? -TH : Math.PI + TH;                      // 朝 −x（来路）推开
    const cx = x - Math.sin(TH) * (L / 2);
    const cz = hz + (s < 0 ? 1 : -1) * Math.cos(TH) * (L / 2);
    b.box('lacquer', 0.18, 6.3, L, cx, base + 3.15, cz, W42.lac, ry);
    for (const ly of [0.72, 5.58]) b.box('lacquer', 0.26, 0.26, L - 0.12, cx, base + ly, cz, shade(W42.lac, 1.7), ry);
    // 铜乳钉：九路 × 九钉，穿透门板两面同见
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const [px, pz] = lp(cx, cz, ry, 0, (c - 4) * 0.4);
      b.box('metal', 0.24, 0.17, 0.17, px, base + 0.95 + r * 0.6, pz, shade(W42.cu, 0.9 + (r % 3) * 0.06), ry);
    }
    // 铺首衔环：底板 + 环座 + 一线磷光（触碰才嗡鸣，静态只留暗光）
    const [gx, gz] = lp(cx, cz, ry, 0.13, 1.05);
    b.box('metal', 0.1, 0.46, 0.46, gx, base + 3.34, gz, W42.cuD, ry);
    b.box('metal', 0.08, 0.26, 0.26, gx, base + 3.34, gz, shade(W42.cu, 1.15), ry);
    const [rx2, rz2] = lp(cx, cz, ry, 0.1, 1.05);
    b.box('glow', 0.02, 0.52, 0.05, rx2, base + 2.56, rz2, shade(W42.phos, 0.26), ry);
    b.kit('under.studPlank', 1, base + 3.0);
  }
  // 门槛石 + 两侧门枕石
  b.box('ash', 0.72, 0.24, 8.6, x, base + 0.12, z, shade(W42.stL, 0.9));
  for (const s of [-1, 1]) b.box('ash', 0.66, 0.4, 0.7, x, base + 0.2, z + s * 4.1, W42.stD);
}

// 城墙垣：D-ITM-0113
/** 丰都鬼城城垣：黑砖 · 周长 1800m 高 8m · 墙头无雉堞只插白幡 120 面 · 四门处留豁口不封门 */
function w42FengduCityWall(b: Baker): void {
  const y = UNDER.y;
  const X0 = 190, X1 = 890, Z0 = -10, Z1 = 190;
  // 墙基裙：街区台地外侧是 1.6m 深的地面落差，城垣下压一道基裙，外侧看墙不悬空
  b.box('ash', X1 - X0 + 3.2, 2.6, 3.6, (X0 + X1) / 2, y - 1.2, Z0, W42.brickL);
  b.box('ash', X1 - X0 + 3.2, 2.6, 3.6, (X0 + X1) / 2, y - 1.2, Z1, W42.brickL);
  b.box('ash', 3.6, 2.6, Z1 - Z0 + 3.2, X0, y - 1.2, (Z0 + Z1) / 2, W42.brickL);
  b.box('ash', 3.6, 2.6, Z1 - Z0 + 3.2, X1, y - 1.2, (Z0 + Z1) / 2, W42.brickL);
  w42WallRun(b, X0, Z0, X1, Z0, y, 8, 2.4, W42.brick, [], 47);                     // 南垣（无门）
  w42WallRun(b, X1, Z0, X1, Z1, y, 8, 2.4, W42.brick, [[28, 42], [148, 162]], 13);  // 东垣：返阳门 / 生门
  w42WallRun(b, X1, Z1, X0, Z1, y, 8, 2.4, W42.brick, [[365, 375]], 47);            // 北垣：北枉门
  w42WallRun(b, X0, Z1, X0, Z0, y, 8, 2.4, W42.brick, [[96, 114], [159, 171]], 13); // 西垣：丰都门 / 西市门
  b.kit('under.fengduCityWall', 4, y);
}

// 城墙垣：D-ITM-0092
/** 枉死城城垣：220×160 高 10m 青灰砖 · 补土台地 · 唯北门开 · 苔痕如泪痕成行 · 半塌档塌砖堆 */
function w42WrongfulCityWall(b: Baker): void {
  const y = UNDER.y;
  const X0 = -110, X1 = 110, Z0 = -330, Z1 = -170;
  // 城址台地：主冥土（760×400）止于 z=-200，补一块同色冥土接板（z −344..−200），城不悬空
  b.box('ground', 268, 0.62, 144, 0, y - 0.31, -272, 0x2e2228);
  b.kit('under.wrongfulCity.ground', 1, y);
  // 北正街：北门 → 衙署前，石板 + 横缝
  b.box('ash', 12, 0.14, 54, 0, y + 0.07, -197, shade(0x4a4450, 1.0));
  for (let z = -222; z <= -171; z += 4.5) b.box('ash', 11.4, 0.03, 0.12, 0, y + 0.155, z, W42.stD);
  b.kit('under.wrongfulStreet', 1, y);
  w42WallRun(b, X0, Z0, X1, Z0, y, 10, 3, W42.brick, [], 0);
  w42WallRun(b, X1, Z0, X1, Z1, y, 10, 3, W42.brick, [], 0);
  w42WallRun(b, X1, Z1, X0, Z1, y, 10, 3, W42.brick, [[104, 116]], 0);
  w42WallRun(b, X0, Z1, X0, Z0, y, 10, 3, W42.brick, [], 0);
  b.kit('under.wrongfulCityWall', 4, y);
  // 北门门洞：豁口上方补门头墙 + 门额 + 门槛 + 门枕 + 门内白雾（门向忘川常开，不设门扇）
  b.box('ash', 3.0, 3.4, 12.6, 0, y + 8.3, Z1, W42.brick);
  b.box('ash', 3.5, 0.5, 13.0, 0, y + 6.5, Z1, W42.stL);
  b.box('ash', 13.6, 0.42, 4.2, 0, y + 10.21, Z1, shade(W42.brick, 1.26));
  b.box('ash', 0.9, 0.3, 12.2, 0, y + 0.15, Z1, W42.stL);
  for (const s of [-1, 1]) b.box('ash', 1.1, 0.5, 0.9, s * 6.1, y + 0.25, Z1, W42.stD);
  for (let i = 0; i < 3; i++) b.box('glow', 11.0 - i * 0.8, 2.2, 0.06, 0, y + 1.2 + i * 2.0, Z1 - 2.4 - i * 0.5, shade(0x8e949c, 1.0 - i * 0.05));
  b.kit('under.wrongfulGate', 1, y + 3.2);
  // 半塌档（46 卷归型 8）：墙脚塌砖堆八处，城内城外各半
  const RUBBLE: readonly (readonly [number, number, number])[] = [
    [-96, -174, 3], [-62, -172.6, 2], [38, -172.4, 3], [74, -174.4, 2],
    [-104, -240, 2], [104, -286, 3], [-40, -326, 2], [56, -326, 2],
  ];
  for (const [rx, rz, n] of RUBBLE) {
    for (let k = 0; k < n; k++) {
      b.box('ash', 0.9 + k * 0.22, 0.34, 0.7, rx + k * 0.72, y + 0.17 + k * 0.13, rz + (k % 2) * 0.42, shade(W42.brick, 1.08 + k * 0.06), 0.3 * k);
    }
    b.kit('under.wrongfulRubble', 1, y);
  }
}

// 枉死衙署：D-ITM-0096
/** 枉死衙署（城内北正街）：台基 + 三级踏跺 + 门厅（后墙/山墙/四檐柱/板门双窗）+ 前廊 + 匾额 + 披麻石狮（狮眼蒙布） */
function w42WrongfulYamen(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number): void {
  const y = UNDER.y;
  const t = y + 0.98;                       // 台基顶
  const hz = z - 1.0;                       // 门厅中心
  b.box('ash', 26, 0.9, 18, x, y + 0.45, z, shade(W42.st, 0.9));
  b.box('ash', 26.8, 0.18, 18.8, x, y + 0.98, z, shade(W42.stL, 0.98));
  for (let i = 0; i < 3; i++) b.box('ash', 7.6 - i * 0.4, 0.32, 0.62, x, y + 0.78 - i * 0.28, z + 9.2 + i * 0.56, shade(W42.stL, 1.0 - i * 0.05));
  // 门厅：后墙 + 两山墙
  b.box('ash', 18, 5.6, 0.9, x, t + 2.8, hz - 3.55, W42.brick);
  for (const s of [-1, 1]) b.box('ash', 0.9, 5.6, 7.2, x + s * 8.55, t + 2.8, hz, W42.brick);
  // 前檐：四檐柱 + 柱础 + 额枋 + 普拍枋；两山墙之间补槛墙
  for (const lx of [-6.3, -2.1, 2.1, 6.3]) {
    b.box('ash', 0.72, 0.28, 0.72, x + lx, t + 0.14, hz + 3.5, W42.stL);
    b.box('wood', 0.46, 5.2, 0.46, x + lx, t + 2.9, hz + 3.5, shade(W42.wood, 1.35));
  }
  b.box('wood', 18.6, 0.5, 0.62, x, t + 5.62, hz + 3.5, W42.wood);
  b.box('wood', 19.2, 0.24, 0.78, x, t + 6.02, hz + 3.5, W42.woodD);
  for (const s of [-1, 1]) b.box('ash', 4.1, 1.1, 0.44, x + s * 4.2, t + 0.55, hz + 3.5, W42.brick);
  inDoor(b, x, hz + 3.5, t, 4.0, 4.2, 0, 0.92);
  for (const s of [-1, 1]) inWindow(b, x + s * 4.2, hz + 3.5, t + 1.12, 3.1, 2.1, 0, true, true);
  // 前廊：四廊柱 + 单坡廊顶（自檐口挑出 2.8m）
  for (const lx of [-6.3, -2.1, 2.1, 6.3]) {
    b.box('ash', 0.6, 0.24, 0.6, x + lx, t + 0.12, hz + 6.3, W42.stL);
    b.box('wood', 0.4, 4.6, 0.4, x + lx, t + 2.5, hz + 6.3, shade(W42.wood, 1.25));
  }
  b.box('wood', 18.2, 0.42, 0.5, x, t + 4.94, hz + 6.3, W42.wood);
  b.box('roof', 19.4, 0.2, 3.5, x, t + 5.72, hz + 4.95, 0x14161a, 0, 0.2, 0);
  // 屋顶：四坡（四棱台）+ 正脊 + 檐口
  b.pyramid('roof', 0.6, 6.0, x, t + 6.12, hz, 0x14161a, 0, 2.36, 1.9, 1.13);
  b.box('roof', 2.6, 0.3, 0.8, x, t + 8.06, hz, 0x20242a);
  for (const s of [-1, 1]) {
    b.box('roof', 3.0, 0.22, 0.5, x, t + 8.26, hz + s * 0.3, shade(0x20242a, 1.1));
    b.box('roof', 21.0, 0.18, 0.36, x, t + 6.22, hz + s * 5.2, 0x141820);
    b.box('roof', 0.36, 0.18, 10.6, x + s * 9.8, t + 6.22, hz, 0x141820);
  }
  // 匾额「枉死衙署」
  sg.quad(atlas.text('w42-yamen', '枉死衙署', 460, 128, {
    color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(6,10,8,0.92)', border: 'rgba(61,255,156,.85)', fontPx: 74,
  }), 4.8, 1.34, x, t + 5.0, hz + 3.86, 0);
  // 檐下双灯
  for (const s of [-1, 1]) inLantern(b, x + s * 5.2, hz + 5.6, t + 4.5, 0x3dff9c);
  // 门前石狮披麻：须弥座 + 身 + 首 + 披麻覆身 + 狮眼以布蒙之（两条白布带）
  for (const s of [-1, 1]) {
    const px = x + s * 5.9, pz = z + 10.7;
    b.box('ash', 1.3, 0.5, 1.5, px, y + 0.25, pz, W42.stD);
    b.box('ash', 1.05, 0.16, 1.2, px, y + 0.58, pz, W42.stL);
    b.box('ash', 0.78, 1.0, 0.72, px, y + 1.16, pz, shade(W42.st, 1.06));
    for (const sz of [-1, 1]) b.box('ash', 0.22, 0.5, 0.26, px + sz * 0.26, y + 0.84, pz + 0.3, shade(W42.st, 0.94));
    b.box('ash', 0.56, 0.52, 0.5, px, y + 1.9, pz, shade(W42.st, 1.1));
    b.box('fabric', 0.86, 0.64, 0.8, px, y + 1.48, pz, 0xb8ad90, 0.06);
    b.box('fabric', 0.9, 0.14, 0.84, px, y + 1.16, pz, 0x9a8f74, -0.05);
    b.box('fabric', 0.62, 0.16, 0.06, px, y + 1.96, pz + 0.26, 0xd8d0c0);
    for (const sz of [-1, 1]) b.box('fabric', 0.1, 0.5, 0.08, px + sz * 0.34, y + 1.84, pz + 0.2, 0xd8d0c0, sz * 0.2);
    b.kit('under.wrongfulLion', 1, y + 1.5);
  }
  b.kit('under.wrongfulYamen', 1, t + 3.0);
}

// 坠井井口：D-ITM-0103
/** 坠井井口（阴阳界井亭心，径 6m）：八角井台 + 双层石圈 + 井壁下贯 + 辘轳（架于亭柱之间）+ 麻绳吊桶 */
function w42WellMouth(b: Baker, x: number, z: number): void {
  const top = UNDER.y + 0.19;               // 街面铺装顶
  const rim = top + 0.36;                   // 井亭石台顶（既有 fengduWellPavilion 台面）
  // 井台：八角石台一圈（径 8.6），压在街面与亭台之间作上井踏步
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    b.box('ash', 1.5, 0.24, 1.2, x + Math.cos(a) * 3.95, top + 0.12, z + Math.sin(a) * 3.95, shade(W42.st, 0.94), -a);
  }
  // 石圈：外圈 + 内圈夹出井口环，顶面十二块压石
  b.cyl('ash', 3.02, 3.16, 0.56, 16, x, rim + 0.28, z, shade(W42.stL, 0.96), 0, 0, 0, true);
  b.cyl('ash', 2.82, 2.9, 0.56, 16, x, rim + 0.28, z, shade(W42.st, 0.8), 0, 0, 0, true);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.box('ash', 0.62, 0.1, 0.36, x + Math.cos(a) * 2.94, rim + 0.6, z + Math.sin(a) * 2.94, shade(W42.stL, 1.05), -a + Math.PI / 2);
  }
  // 井壁：三段开口筒下贯（262m 井道只做近井可见段），底段一点灰白天光
  b.cyl('ash', 2.52, 2.52, 2.6, 12, x, rim - 1.0, z, 0x1a161c, 0, 0, 0, true);
  b.cyl('ash', 2.3, 2.3, 3.4, 10, x, rim - 4.0, z, 0x120e14, 0, 0, 0, true);
  b.cyl('ash', 2.1, 2.1, 4.2, 10, x, rim - 7.8, z, 0x0c0a10, 0, 0, 0, true);
  b.cyl('glow', 1.1, 1.1, 0.04, 10, x, rim - 9.6, z, shade(0x8e949c, 0.5), 0, 0, 0, true);
  // 辘轳：架在亭内 z 向两柱之间（柱位 (0,±2.95)）——石座 + 立柱 + 横梁 + 卷筒 + 摇柄
  const beamY = rim + 2.35;
  for (const s of [-1, 1]) {
    b.box('ash', 0.44, 0.28, 0.44, x, rim + 0.14, z + s * 2.62, W42.stD);
    b.box('wood', 0.26, 2.2, 0.26, x, rim + 1.2, z + s * 2.62, shade(W42.wood, 1.2));
    b.box('metal', 0.34, 0.12, 0.34, x, rim + 2.3, z + s * 2.62, W42.iron);
  }
  b.box('wood', 0.24, 0.24, 5.5, x, beamY, z, shade(W42.wood, 1.3));
  b.cyl('wood', 0.26, 0.26, 1.5, 12, x, beamY - 0.16, z, shade(W42.woodD, 1.2), 0, Math.PI / 2);
  for (const s of [-1, 1]) b.cyl('metal', 0.3, 0.3, 0.08, 12, x, beamY - 0.16, z + s * 0.78, W42.iron, 0, Math.PI / 2);
  b.box('metal', 0.1, 0.1, 0.9, x + 0.44, beamY - 0.16, z + 1.02, W42.steel, 0.42);
  b.box('wood', 0.14, 0.14, 0.5, x + 0.74, beamY - 0.16, z + 1.26, W42.woodD, 0.42);
  // 麻绳垂井 + 吊桶（半沉井口）
  for (let k = 0; k < 6; k++) b.box('fabric', 0.05, 0.4, 0.05, x, beamY - 0.42 - k * 0.38, z, 0x8a7a52);
  b.cyl('wood', 0.24, 0.19, 0.36, 10, x, rim - 0.94, z, shade(W42.woodD, 1.15), 0, 0, 0, true);
  b.cyl('metal', 0.25, 0.25, 0.04, 10, x, rim - 0.76, z, W42.iron, 0, 0, 0, true);
  b.box('glow', 2.4, 0.03, 2.4, x, rim - 8.4, z, shade(0x2a3038, 0.7));
  b.kit('under.wellMouth', 1, rim + 0.6);
}

// 骨骰：D-ITM-0120
/** 骨骰：血木赌桌（桌面骰坑磨深）+ 豁口赌碗 + 指骨骰六枚（点数自变）+ 灯下多出一枚的错位骰影 */
function w42BoneDice(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('wood', 2.0, 0.14, 1.2, x, y + 0.82, z, shade(W42.wood, 1.12), ry);
  b.box('lacquer', 1.16, 0.04, 0.74, x, y + 0.9, z, 0x1a1014, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.84, sz * 0.48);
    b.box('wood', 0.13, 0.78, 0.13, px, y + 0.39, pz, W42.woodD, ry);
    b.box('ash', 0.2, 0.06, 0.2, px, y + 0.03, pz, W42.stD, ry);
  }
  // 赌碗：粗陶大碗（豁一口）+ 碗内骨骰六枚
  const [bx, bz] = lp(x, z, ry, -0.34, 0.02);
  b.cyl('ceramic', 0.38, 0.24, 0.24, 12, bx, y + 0.98, bz, 0x584f44, 0, 0, 0, true);
  b.cyl('ash', 0.25, 0.25, 0.03, 12, bx, y + 0.9, bz, 0x2a2620);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05;
    const [dx, dz] = lp(bx, bz, ry, Math.cos(a) * 0.13, Math.sin(a) * 0.13);
    const dh = 0.15 + (i % 2) * 0.02;
    b.box('ash', dh, dh, dh, dx, y + 0.95 + (i % 2) * 0.02, dz, shade(W42.bone, 0.88 + (i % 3) * 0.06), a, 0.22, 0.16);
    for (let k = 0; k < 3; k++) {
      b.box('lacquer', 0.028, 0.028, 0.028, dx + Math.cos(k * 2.1) * 0.04, y + 1.03 + Math.sin(k * 2.1) * 0.03, dz + Math.sin(k * 2.1) * 0.04, 0x14100e, a);
    }
  }
  // 碗外散骰两枚 + 错位骰影（影比骰多一枚）
  for (let i = 0; i < 2; i++) b.box('ash', 0.14, 0.14, 0.14, x + 0.46 + i * 0.22, y + 0.94, z - 0.22 + i * 0.34, shade(W42.bone, 0.94), 0.6 + i);
  for (let i = 0; i < 3; i++) b.box('lacquer', 0.2, 0.02, 0.2, x + 0.2 + i * 0.42, y + 0.9, z - 0.3 + i * 0.26, 0x181014, i * 0.4);
  // 单灯：灯杆挑臂 + 罩 + 磷芯（灯下骰影错位）
  const [lx, lz] = lp(x, z, ry, 0.98, -0.44);
  b.box('ash', 0.5, 0.2, 0.5, lx, y + 0.1, lz, W42.stD, ry);
  b.box('wood', 0.1, 3.1, 0.1, lx, y + 1.75, lz, W42.wood, ry);
  const [ax, az] = lp(lx, lz, ry, -0.34, 0);
  b.box('wood', 0.08, 0.08, 0.72, ax, y + 3.28, az, W42.woodD, ry);
  b.box('metal', 0.26, 0.06, 0.26, ax, y + 3.14, az, W42.iron, ry);
  b.box('glow', 0.22, 0.28, 0.22, ax, y + 2.96, az, shade(W42.phos, 0.78), ry);
  b.kit('under.boneDice', 1, y + 1.0);
}

// 押魂签筹：D-ITM-0121
/** 押魂签筹：签案 + 铜签筒 + 竹筹十二支（刻魂纹）+ 朱印盒 + 「陽壽」押注牌 + 签筹筹码两摞 */
function w42SoulTokens(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 2.2, 0.14, 1.0, x, y + 0.76, z, shade(W42.stL, 1.02), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.92, sz * 0.38);
    b.box('wood', 0.14, 0.7, 0.14, px, y + 0.35, pz, W42.wood, ry);
  }
  b.box('wood', 2.0, 0.12, 0.22, x, y + 0.6, z, W42.woodD, ry);
  // 铜签筒 + 竹筹十二支（筹面刻魂纹，三支抽出斜靠筒口）
  const [ux, uz] = lp(x, z, ry, -0.6, 0.06);
  b.cyl('metal', 0.18, 0.15, 0.5, 10, ux, y + 1.06, uz, shade(W42.cu, 0.86), 0, 0, 0, true);
  b.cyl('metal', 0.19, 0.19, 0.06, 10, ux, y + 1.28, uz, W42.cuD, 0, 0, 0, true);
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7;
    b.box('fabric', 0.05, 0.62 + (i % 3) * 0.08, 0.05, ux + Math.cos(a) * 0.05, y + 1.52, uz + Math.sin(a) * 0.05, shade(W42.paper, 0.86 + (i % 2) * 0.1), a, (i % 3 - 1) * 0.08, 0);
  }
  for (let i = 0; i < 3; i++) {
    const [sx2, sz2] = lp(x, z, ry, -0.42 + i * 0.16, -0.18);
    b.box('fabric', 0.05, 0.76, 0.05, sx2, y + 1.02, sz2, shade(W42.paper, 0.94), ry + i * 0.3, 0, 0.42);
    b.box('glow', 0.02, 0.06, 0.02, sx2, y + 1.34, sz2, shade(W42.blood, 0.9), ry);
  }
  // 朱印盒 + 印面朱痕
  const [ix, iz] = lp(x, z, ry, 0.14, 0.04);
  b.box('lacquer', 0.4, 0.22, 0.32, ix, y + 0.94, iz, W42.lac, ry);
  b.box('lacquer', 0.44, 0.06, 0.36, ix, y + 1.08, iz, shade(W42.lac, 1.5), ry);
  b.box('glow', 0.2, 0.02, 0.16, ix, y + 1.12, iz, shade(0xb03a2e, 0.95), ry);
  // 「陽壽」押注牌 + 筹码两摞
  const [qx, qz] = lp(x, z, ry, 0.66, -0.06);
  b.box('wood', 0.07, 0.62, 0.07, qx, y + 1.14, qz, W42.woodD, ry);
  b.box('lacquer', 0.44, 0.56, 0.05, qx, y + 1.2, qz + 0.05, 0x2a1a1e, ry);
  b.box('glow', 0.3, 0.36, 0.02, qx, y + 1.2, qz + 0.08, shade(W42.paper, 0.72), ry);
  for (let i = 0; i < 2; i++) {
    const [cx2, cz2] = lp(x, z, ry, 0.44 + i * 0.34, 0.34);
    for (let k = 0; k < 5; k++) b.box('wood', 0.14, 0.03, 0.14, cx2 + (k % 2) * 0.02, y + 0.86 + k * 0.035, cz2, shade(W42.woodD, 0.9 + k * 0.06), ry + k * 0.1);
  }
  b.kit('under.soulTokens', 1, y + 1.1);
}

// 招魂食幌：D-ITM-0126
/** 招魂食幌：幌杆 + 横臂 + 布幌「聞香止步」+ 幌角滴油不落（三滴悬在角下）+ 幌脚油渍 */
function w42FoodBanner(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 0.86, 0.24, 0.86, x, y + 0.12, z, W42.stD, ry);
  b.box('ash', 0.6, 0.14, 0.6, x, y + 0.31, z, W42.stL, ry);
  b.box('wood', 0.14, 4.4, 0.14, x, y + 2.3, z, shade(W42.wood, 1.2), ry);
  const [ax, az] = lp(x, z, ry, 0, 0.84);
  b.box('wood', 0.1, 0.1, 1.7, ax, y + 4.34, az, W42.woodD, ry);
  b.box('wood', 0.09, 0.3, 0.09, ax, y + 4.2, az, W42.woodD, ry);
  // 幌面：布 + 上下压杆 + 破角
  const [vx, vz] = lp(x, z, ry, 0, 1.5);
  b.box('fabric', 0.94, 2.6, 0.05, vx, y + 2.86, vz, 0x5c3a24, ry);
  b.box('wood', 1.04, 0.08, 0.12, vx, y + 4.2, vz, W42.woodD, ry);
  b.box('fabric', 0.3, 0.44, 0.04, vx + 0.34, y + 1.36, vz + 0.02, shade(0x5c3a24, 0.82), ry + 0.12);
  sg.quad(atlas.text('w42-foodBanner', '聞香止步', 96, 420, {
    color: '#ffe0b0', glow: '#ffb060', vertical: true, fontPx: 62, bg: 'rgba(58,32,16,0.55)',
  }), 0.72, 2.2, vx, y + 2.86, vz + 0.05, ry);
  // 幌角滴「油」不落地：三滴悬在角下，油渍只压在幌脚
  for (let i = 0; i < 3; i++) {
    const [dx, dz] = lp(x, z, ry, 0.3 - i * 0.06, 1.52);
    b.box('glow', 0.07, 0.14, 0.07, dx, y + 1.24 - i * 0.05, dz, shade(0xd8a040, 0.8), ry);
    b.box('glow', 0.03, 0.1, 0.03, dx, y + 1.1 - i * 0.05, dz, shade(0xd8a040, 0.6), ry);
  }
  b.box('glow', 0.9, 0.02, 0.5, vx, y + 0.2, vz, shade(0x6b4a20, 0.6), ry);
  b.kit('under.foodBanner', 1, y + 2.9);
}

// 气味灶：D-ITM-0127
/** 气味灶：双眼灶台 + 灶膛火光 + 铁锅 + 锅上雾态食物（成形又散）+ 烟道 + 甜香雾带 */
function w42SmellStove(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 2.8, 1.0, 1.5, x, y + 0.5, z, shade(W42.st, 0.94), ry);
  b.box('ash', 2.6, 0.16, 1.36, x, y + 1.08, z, W42.stL, ry);
  b.box('ash', 2.94, 0.1, 1.62, x, y + 1.18, z, shade(W42.stL, 1.1), ry);
  for (let k = 0; k < 2; k++) {
    const [px, pz] = lp(x, z, ry, (k - 0.5) * 1.3, 0);
    b.cyl('metal', 0.42, 0.42, 0.06, 12, px, y + 1.24, pz, 0x3a3630);
    b.cyl('metal', 0.38, 0.3, 0.34, 12, px, y + 1.44, pz, shade(W42.iron, 1.4));
    // 雾态食物：锅上成形又散——三层半透雾团，越上越淡
    for (let i = 0; i < 3; i++) {
      b.cyl('glow', 0.3 - i * 0.07, 0.26 - i * 0.06, 0.16, 9, px, y + 1.66 + i * 0.24, pz, shade(0xd8c8a8, 0.66 - i * 0.12));
    }
    // 灶膛：两处火光
    b.box('glow', 0.5, 0.28, 0.06, px, y + 0.42, pz + Math.cos(ry) * 0.76, k === 0 ? 0x6b4226 : shade(0x6b4226, 0.75), ry);
  }
  // 烟道 + 灶台磨损 + 柴堆
  const [cx2, cz2] = lp(x, z, ry, 1.6, -0.5);
  b.box('ash', 0.56, 3.4, 0.56, cx2, y + 1.7, cz2, shade(W42.st, 0.88), ry);
  b.box('ash', 0.7, 0.2, 0.7, cx2, y + 3.46, cz2, W42.stD, ry);
  const [wx2, wz2] = lp(x, z, ry, -1.5, -0.52);
  b.box('wood', 1.0, 0.18, 0.5, wx2, y + 0.09, wz2, W42.woodD, ry + 0.2);
  for (let i = 0; i < 4; i++) b.box('wood', 0.12, 0.12, 0.86, wx2 + Math.cos(i * 1.6) * 0.3, y + 0.22 + (i % 2) * 0.16, wz2 + Math.sin(i * 1.6) * 0.26, shade(W42.woodD, 1.1), ry + i * 0.36);
  // 甜香雾带：自锅面向街心漫开的三道雾
  for (let i = 0; i < 3; i++) {
    const [sx2, sz2] = lp(x, z, ry, -0.4 + i * 0.6, 1.0 + i * 0.5);
    b.cyl('glow', 0.2, 0.5, 0.06, 8, sx2, y + 1.7 + i * 0.3, sz2, shade(0xd8b888, 0.3), 0, 0, 0, true);
  }
  b.kit('under.smellStove', 1, y + 1.2);
}

// 垂涎幌：D-ITM-0129
/** 垂涎幌：门口幌杆 + 油布幌 + 幌下滴涎成线（三道垂涎不落地）+ 门槛湿痕（落地无痕） */
function w42DroolBanner(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 0.8, 0.22, 0.8, x, y + 0.11, z, W42.stD, ry);
  b.box('ash', 0.56, 0.12, 0.56, x, y + 0.28, z, W42.stL, ry);
  b.box('wood', 0.13, 3.9, 0.13, x, y + 2.05, z, shade(W42.wood, 1.16), ry);
  const [ax, az] = lp(x, z, ry, 0, 0.7);
  b.box('wood', 0.09, 0.09, 1.4, ax, y + 3.9, az, W42.woodD, ry);
  const [vx, vz] = lp(x, z, ry, 0, 1.24);
  b.box('fabric', 0.8, 2.1, 0.05, vx, y + 2.76, vz, 0x3c4a3e, ry);
  b.box('wood', 0.9, 0.07, 0.1, vx, y + 3.84, vz, W42.woodD, ry);
  // 滴涎成线：三道自幌角垂下的涎线，下端悬空不落地
  for (let i = 0; i < 3; i++) {
    const [dx, dz] = lp(x, z, ry, -0.24 + i * 0.24, 1.28);
    b.box('glow', 0.05, 0.9 + (i % 2) * 0.34, 0.05, dx, y + 1.32 - (i % 2) * 0.16, dz, shade(0xd8e0b0, 0.55), ry);
    b.box('glow', 0.09, 0.1, 0.09, dx, y + 0.82 - (i % 2) * 0.16, dz, shade(0xd8e0b0, 0.75), ry);
  }
  // 落地无痕：门槛只留一圈极淡湿光，无积涎
  b.box('glow', 1.5, 0.02, 0.6, x + Math.sin(ry) * 0.5, y + 0.2, z + Math.cos(ry) * 0.5, shade(0x4a5a3a, 0.42), ry);
  // 幌旁两只空碗（等食的）
  for (let i = 0; i < 2; i++) {
    const [bx, bz] = lp(x, z, ry, 0.5 + i * 0.26, 0.3 + i * 0.1);
    b.cyl('ceramic', 0.16, 0.1, 0.1, 8, bx, y + 0.24, bz, 0x6a5c4c, 0, 0, 0, true);
  }
  b.kit('under.droolBanner', 1, y + 2.8);
}

// 饿鬼食槽：D-ITM-0130
/** 饿鬼食槽：整石凿槽 + 槽沿磨凹 + 槽内雾食 + 伏槽饿鬼两身（哭嚎态剪影）+ 槽脚残食桶 */
function w42GhoulTrough(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 3.2, 0.72, 1.5, x, y + 0.36, z, shade(W42.st, 0.96), ry);
  // 槽口：三面板壁围出槽膛（内壁深一档）
  for (const s of [-1, 1]) b.box('ash', 3.0, 0.34, 0.16, x, y + 0.86, z + s * 0.62 * Math.cos(ry), shade(W42.stL, 0.94), ry);
  b.box('ash', 0.16, 0.34, 1.24, x + Math.cos(ry) * 1.44, y + 0.86, z - Math.sin(ry) * 1.44, shade(W42.stL, 0.94), ry);
  b.box('ash', 0.16, 0.34, 1.24, x - Math.cos(ry) * 1.44, y + 0.86, z + Math.sin(ry) * 1.44, shade(W42.stL, 0.94), ry);
  b.box('ash', 2.7, 0.16, 1.0, x, y + 0.68, z, 0x1e1a1e, ry);
  // 槽内雾食：一层浊白雾面 + 三团浮起的食形
  b.box('glow', 2.6, 0.06, 0.94, x, y + 0.78, z, shade(0xb8b09a, 0.52), ry);
  for (let i = 0; i < 3; i++) {
    const [fx, fz] = lp(x, z, ry, -0.8 + i * 0.8, 0);
    b.cyl('glow', 0.26, 0.18, 0.22, 8, fx, y + 0.92 + (i % 2) * 0.06, fz, shade(0xd0c8b0, 0.62), 0, 0, 0, true);
  }
  // 伏槽饿鬼两身：伏身 + 前臂 + 首 + 乱发（剪影，只做暗木色块）
  for (let i = 0; i < 2; i++) {
    const [gx, gz] = lp(x, z, ry, -0.9 + i * 1.7, -0.94);
    b.box('wood', 0.62, 0.42, 0.8, gx, y + 0.52, gz, 0x1e2622, ry, 0.18, 0);
    b.box('wood', 0.28, 0.24, 0.5, gx, y + 0.42, gz + Math.cos(ry) * 0.42, 0x18201c, ry);
    for (const s of [-1, 1]) b.box('wood', 0.16, 0.2, 0.62, gx + s * 0.22, y + 0.34, gz + Math.cos(ry) * 0.3, 0x18201c, ry, 0.3, 0);
    b.box('wood', 0.26, 0.24, 0.26, gx, y + 0.68, gz - Math.cos(ry) * 0.3, 0x2a342e, ry);
    for (let k = 0; k < 3; k++) b.box('wood', 0.06, 0.18, 0.06, gx - 0.1 + k * 0.1, y + 0.82, gz - Math.cos(ry) * 0.32, 0x141a16, ry, 0, 0.3 - k * 0.3);
    b.kit('under.ghoulTrough.ghoul', 1, y + 0.5);
  }
  // 槽脚残食桶 + 撒落
  const [px, pz] = lp(x, z, ry, 1.72, 0.36);
  b.cyl('ceramic', 0.3, 0.24, 0.42, 10, px, y + 0.21, pz, 0x4a4640);
  b.cyl('ceramic', 0.32, 0.32, 0.06, 10, px, y + 0.44, pz, 0x3a3640);
  for (let i = 0; i < 4; i++) b.box('glow', 0.1, 0.02, 0.08, px - 0.4 - i * 0.16, y + 0.2, pz + 0.2 + i * 0.12, shade(0xb0a890, 0.5));
  b.kit('under.ghoulTrough', 1, y + 0.7);
}

// 纸马纸轿：D-ITM-0133
/** 纸马纸轿：靠墙竹骨扎架 + 纸马（躯/四腿/首/尾）+ 纸轿（轿身/轿顶/轿杆/轿帘）+ 竹骨吱呀的断骨两根 */
function w42PaperHorseSedan(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  // 扎架：两根横杆 + 四根立柱（靠墙立放）
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 2.5, -0.3);
    b.box('wood', 0.14, 3.0, 0.14, px, y + 1.5, pz, W42.wood, ry);
    b.box('ash', 0.4, 0.16, 0.4, px, y + 0.08, pz, W42.stD, ry);
  }
  b.box('wood', 5.1, 0.12, 0.12, x, y + 2.9, z - Math.cos(ry) * 0.3, W42.woodD, ry);
  b.box('wood', 5.1, 0.1, 0.1, x, y + 0.5, z - Math.cos(ry) * 0.3, W42.woodD, ry);
  // 纸马：躯 + 四腿 + 颈首 + 耳 + 尾（骨白纸色）
  const [mx, mz] = lp(x, z, ry, -1.1, 0.16);
  b.box('fabric', 1.5, 0.62, 0.44, mx, y + 1.34, mz, shade(W42.paper, 1.0), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [lx, lz] = lp(mx, mz, ry, sx * 0.52, sz * 0.14);
    b.box('fabric', 0.12, 0.86, 0.12, lx, y + 0.62, lz, shade(W42.paper, 0.9 + sx * 0.04), ry);
    b.box('wood', 0.04, 0.9, 0.04, lx + 0.05, y + 0.64, lz, shade(W42.woodD, 1.1), ry);
  }
  const [nx, nz] = lp(mx, mz, ry, 0.82, 0);
  b.box('fabric', 0.28, 0.7, 0.3, nx, y + 1.76, nz, shade(W42.paper, 1.04), ry, 0, -0.34);
  b.box('fabric', 0.5, 0.28, 0.26, nx + 0.12, y + 2.04, nz, shade(W42.paper, 1.08), ry, 0, -0.34);
  for (const s of [-1, 1]) b.box('fabric', 0.08, 0.2, 0.06, nx + 0.14, y + 2.24, nz + s * 0.1, shade(W42.paperD, 1.1), ry);
  const [tx2, tz2] = lp(mx, mz, ry, -0.82, 0);
  b.box('fabric', 0.1, 0.5, 0.1, tx2, y + 1.4, tz2, W42.paperD, ry, 0, 0.4);
  // 纸轿：轿身 + 轿顶（四棱台）+ 轿杆两根 + 轿帘 + 轿窗
  const [sx2, sz2] = lp(x, z, ry, 1.5, 0.2);
  b.box('fabric', 1.5, 1.7, 1.4, sx2, y + 1.34, sz2, shade(W42.paper, 0.96), ry);
  b.pyramid('fabric', 0.1, 1.1, sx2, y + 2.3, sz2, shade(0x8a5a2a, 1.0), ry, 1, 0.5, 0.94);
  for (const s of [-1, 1]) {
    const [qx, qz] = lp(sx2, sz2, ry, 0, s * 0.9);
    b.box('wood', 0.09, 0.09, 2.2, qx, y + 0.72, qz, shade(W42.woodD, 1.2), ry);
    b.box('wood', 0.08, 0.8, 0.08, qx, y + 0.34, qz, W42.wood, ry);
  }
  b.box('fabric', 0.06, 1.2, 0.7, sx2 + Math.cos(ry) * 0.76, y + 1.34, sz2 - Math.sin(ry) * 0.76, shade(0x5c2a26, 0.9), ry);
  for (let i = 0; i < 3; i++) b.box('glow', 0.02, 0.06, 0.5, sx2 + Math.cos(ry) * 0.78, y + 1.0 + i * 0.36, sz2 - Math.sin(ry) * 0.78, shade(W42.paper, 0.5), ry);
  // 竹骨吱呀：两根断骨斜插在架脚
  for (let i = 0; i < 2; i++) b.box('wood', 0.05, 1.1, 0.05, x - 1.8 + i * 0.3, y + 0.55, z + Math.cos(ry) * 0.6, shade(0x8a7a4a, 1.0), ry, 0, 0.34 - i * 0.5);
  b.kit('under.paperHorseSedan', 1, y + 1.4);
}

// 纸宅模型：D-ITM-0134
/** 纸宅模型：扎活案 + 微缩阳宅（墙/瓦顶/门楼）+ 纸门（每晚自己开大一分，门扇错开）+ 院墙与门墩 */
function w42PaperHouse(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('wood', 1.9, 0.16, 1.4, x, y + 0.72, z, W42.wood, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.78, sz * 0.55);
    b.box('wood', 0.11, 0.66, 0.11, px, y + 0.33, pz, W42.woodD, ry);
  }
  // 微缩宅：正房 + 厢房 + 院墙 + 两坡顶
  b.box('fabric', 0.94, 0.62, 0.7, x - 0.24, y + 1.1, z, shade(W42.paper, 1.02), ry);
  b.box('roof', 1.08, 0.12, 0.34, x - 0.24, y + 1.48, z - 0.2, 0x1e2028, ry);
  b.box('roof', 1.08, 0.12, 0.34, x - 0.24, y + 1.48, z + 0.2, 0x1e2028, ry);
  b.box('roof', 1.1, 0.1, 0.1, x - 0.24, y + 1.6, z, 0x2a2c34, ry);
  b.box('fabric', 0.5, 0.44, 0.5, x + 0.56, y + 1.02, z + 0.24, shade(W42.paper, 0.94), ry);
  b.box('roof', 0.62, 0.1, 0.62, x + 0.56, y + 1.3, z + 0.24, 0x1e2028, ry);
  // 院墙 + 门楼 + 门墩
  b.box('fabric', 1.8, 0.3, 0.08, x, y + 0.95, z + 0.62, shade(W42.paper, 0.88), ry);
  b.box('fabric', 0.42, 0.5, 0.12, x, y + 1.05, z + 0.62, shade(W42.paper, 1.06), ry);
  for (const s of [-1, 1]) b.box('ash', 0.1, 0.12, 0.1, x + s * 0.3, y + 0.86, z + 0.56, shade(W42.stL, 1.0), ry);
  // 纸门：一扇开大一分（错开一道缝，缝里黑）
  b.box('lacquer', 0.2, 0.42, 0.03, x + 0.06, y + 1.02, z + 0.68, 0x14100e, ry + 0.34);
  b.box('glow', 0.16, 0.3, 0.02, x - 0.02, y + 1.0, z + 0.69, 0x0a080c, ry);
  b.box('lacquer', 0.24, 0.06, 0.06, x, y + 1.3, z + 0.7, 0x2a1a1e, ry);
  b.kit('under.paperHouse', 1, y + 1.1);
}

// 浆糊陶盆：D-ITM-0135
/** 浆糊陶盆：纸扎案 + 大陶盆 + 盆中浆糊自沸（泡起泡破）+ 木搅棒 + 刷帚 + 裁纸条 */
function w42PasteBasin(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('wood', 2.0, 0.14, 1.3, x, y + 0.76, z, shade(W42.wood, 1.06), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.86, sz * 0.5);
    b.box('wood', 0.12, 0.7, 0.12, px, y + 0.35, pz, W42.woodD, ry);
  }
  // 陶盆：外壁 + 盆沿 + 浆糊面（浊白）+ 气泡
  const [bx, bz] = lp(x, z, ry, -0.2, 0);
  b.cyl('ceramic', 0.5, 0.34, 0.42, 14, bx, y + 1.04, bz, 0x4e4a44, 0, 0, 0, true);
  b.cyl('ceramic', 0.56, 0.54, 0.08, 14, bx, y + 1.26, bz, 0x5a564e, 0, 0, 0, true);
  b.cyl('glow', 0.46, 0.46, 0.04, 14, bx, y + 1.2, bz, shade(0xd8d0b8, 0.62));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    const [px, pz] = lp(bx, bz, ry, Math.cos(a) * 0.24, Math.sin(a) * 0.24);
    const r = 0.05 + (i % 3) * 0.03;
    b.cyl('glow', r, r, 0.05, 7, px, y + 1.24, pz, shade(0xe8e0c8, 0.8));
  }
  // 木搅棒斜插 + 刷帚 + 裁纸条（浆糊旁三张）
  const [sx2, sz2] = lp(bx, bz, ry, 0.16, 0.1);
  b.box('wood', 0.05, 0.9, 0.05, sx2, y + 1.5, sz2, shade(0x8a7a52, 1.1), ry, 0, 0.24);
  const [bx2, bz2] = lp(x, z, ry, 0.62, 0.3);
  b.box('wood', 0.09, 0.3, 0.09, bx2, y + 0.98, bz2, W42.woodD, ry);
  b.box('fabric', 0.16, 0.16, 0.1, bx2, y + 1.16, bz2, 0xb8a888, ry);
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, 0.5 + (i % 2) * 0.18, -0.34 + i * 0.1);
    b.box('fabric', 0.36, 0.012, 0.24, px, y + 0.84 + i * 0.014, pz, shade(W42.paper, 0.9 + i * 0.04), ry + i * 0.2);
  }
  b.kit('under.pasteBasin', 1, y + 1.1);
}

// 价目阴签：D-ITM-0137
/** 价目阴签：价目架 + 阴德计价牌（墨字随汇率浮动）+ 十二枚价签（签面一线磷光）+ 算珠盘 */
function w42PriceTags(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.0, 0);
    b.box('ash', 0.42, 0.2, 0.5, px, y + 0.1, pz, W42.stD, ry);
    b.box('wood', 0.16, 2.7, 0.16, px, y + 1.5, pz, W42.wood, ry);
  }
  b.box('wood', 2.3, 0.24, 0.18, x, y + 2.76, z, W42.woodD, ry);
  b.box('wood', 2.1, 0.14, 0.14, x, y + 0.5, z, W42.woodD, ry);
  // 阴德计价牌：漆板 + 三行墨字（浮动＝行距不等）+ 朱押
  b.box('lacquer', 2.0, 1.3, 0.08, x, y + 2.05, z + Math.cos(ry) * 0.04, 0x241a20, ry);
  for (let r = 0; r < 3; r++) {
    const [px, pz] = lp(x, z, ry, -0.5 + (r % 2) * 0.22, 0.06 + r * 0.02);
    b.box('glow', 0.9 - (r % 3) * 0.14, 0.07, 0.02, px, y + 2.42 - r * 0.34, pz, shade(W42.paper, 0.72 + r * 0.06), ry);
    b.box('glow', 0.5, 0.04, 0.02, px - 0.16, y + 2.34 - r * 0.34, pz, shade(W42.paper, 0.5), ry);
  }
  b.box('glow', 0.16, 0.16, 0.02, x + 0.66, y + 1.62, z + Math.cos(ry) * 0.09, shade(0xb03a2e, 0.95), ry);
  // 价签十二枚：分两列挂在横枋下，签面磷光一线
  for (let i = 0; i < 12; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const [px, pz] = lp(x, z, ry, -0.62 + col * 1.24, 0.16);
    b.box('wood', 0.03, 0.16, 0.03, px, y + 2.6 - row * 0.06, pz, W42.woodD, ry);
    b.box('fabric', 0.26, 0.3, 0.02, px, y + 2.4, pz, shade(W42.paper, 0.86 + (i % 4) * 0.05), ry + (i % 3 - 1) * 0.06);
    b.box('glow', 0.16, 0.02, 0.02, px, y + 2.42, pz + 0.02, shade(W42.phos, 0.4), ry);
  }
  // 算珠盘：小算盘压在下横枋上
  const [abx, abz] = lp(x, z, ry, 0.5, -0.2);
  b.box('wood', 0.66, 0.06, 0.26, abx, y + 0.62, abz, shade(W42.woodD, 1.2), ry);
  for (let i = 0; i < 5; i++) b.box('ash', 0.06, 0.06, 0.2, abx - 0.24 + i * 0.12, y + 0.68, abz, shade(W42.stL, 1.0), ry);
  b.kit('under.priceTags', 1, y + 2.2);
}

// 棺木阴纹：D-ITM-0139
/** 棺木阴纹：靠墙竖棺 + 棺板 + 木纹细看如人脸（三线额/两眼/一唇）+ 侧立油灯（一照即隐） */
function w42CoffinGrain(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 1.5, 0.26, 1.5, x, y + 0.13, z, W42.stD, ry);
  b.box('lacquer', 1.24, 2.5, 0.72, x, y + 1.5, z, 0x2a1a16, ry, -0.06, 0);
  // 棺盖（虚掩，缝内一线暗）
  const [gx, gz] = lp(x, z, ry, 0, 0.42);
  b.box('lacquer', 1.3, 2.5, 0.14, gx, y + 1.52, gz, shade(0x3a2420, 1.06), ry, -0.09, 0);
  b.box('glow', 0.94, 2.1, 0.02, gx, y + 1.5, gz - 0.09, 0x120c10, ry);
  // 阴纹：木纹细看如人脸——额线 + 两眼窝 + 唇线（极浅刻，油灯一照即隐）
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -0.3 + i * 0.3, 0.37);
    b.box('lacquer', 0.34, 0.03, 0.02, px, y + 2.28, pz, shade(0x1a1210, 1.0), ry);
  }
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.22, 0.37);
    b.box('lacquer', 0.16, 0.1, 0.02, px, y + 2.06, pz, 0x140e0c, ry, 0, s * 0.12);
  }
  const [mx2, mz2] = lp(x, z, ry, 0, 0.37);
  b.box('lacquer', 0.3, 0.03, 0.02, mx2, y + 1.84, mz2, 0x140e0c, ry);
  for (let i = 0; i < 4; i++) {
    const [px, pz] = lp(x, z, ry, -0.4 + i * 0.27, 0.38);
    b.box('lacquer', 0.03, 0.9 + (i % 2) * 0.4, 0.02, px, y + 1.2, pz, shade(0x1e1412, 1.0), ry);
  }
  // 侧立油灯：灯柱 + 灯盘 + 焰（照棺不照墙）
  const [lx, lz] = lp(x, z, ry, 1.05, 0.3);
  b.box('ash', 0.34, 0.16, 0.34, lx, y + 0.08, lz, W42.stD, ry);
  b.cyl('wood', 0.06, 0.1, 1.5, 6, lx, y + 0.9, lz, shade(W42.wood, 1.4));
  b.cyl('metal', 0.2, 0.15, 0.1, 8, lx, y + 1.7, lz, 0x2a2622);
  b.box('glow', 0.14, 0.22, 0.14, lx, y + 1.86, lz, shade(0xffcf90, 0.8));
  b.box('glow', 0.7, 0.04, 0.5, lx - Math.cos(ry) * 0.4, y + 0.22, lz + Math.sin(ry) * 0.4, shade(0x8a6a2a, 0.4), ry);
  b.kit('under.coffinGrain', 1, y + 1.5);
}

// 敲棺声：D-ITM-0140
/** 敲棺声：铺内平棺 + 棺盖（虚掩）+ 盖面三下震纹（等距同心）+ 震落灰 + 棺侧木槌 */
function w42CoffinKnock(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.62, 0);
    b.box('ash', 0.5, 0.34, 1.0, px, y + 0.17, pz, W42.stD, ry);
  }
  b.box('lacquer', 1.1, 0.66, 2.2, x, y + 0.67, z, 0x2a1a16, ry);
  b.box('lacquer', 1.24, 0.14, 2.32, x, y + 1.06, z, shade(0x3a2420, 1.05), ry);
  b.box('lacquer', 1.1, 0.1, 0.18, x, y + 1.18, z + 1.06, 0x1c1210, ry);
  // 三下震纹：盖面三圈等距同心暗红（间隔均匀）
  for (let i = 0; i < 3; i++) {
    const r = 0.24 + i * 0.24;
    b.cyl('glow', r, r, 0.02, 12, x, y + 1.14 + i * 0.004, z - 0.2, shade(W42.blood, 0.5 - i * 0.1), 0, 0, 0, true);
  }
  // 震落灰：盖面积灰 + 沿边落灰三道
  b.box('ash', 0.9, 0.02, 1.9, x - 0.1, y + 1.14, z + 0.1, 0x6a6458, ry + 0.03);
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -0.5 + i * 0.5, 1.16);
    b.box('ash', 0.04, 0.34, 0.4, px, y + 0.94, pz, shade(0x6a6458, 0.9), ry);
  }
  // 木槌：棺侧斜靠（槌头包布）
  const [mx, mz] = lp(x, z, ry, 0.86, 0.5);
  b.box('wood', 0.07, 1.0, 0.07, mx, y + 0.55, mz, W42.woodD, ry, 0, 0.26);
  b.box('wood', 0.3, 0.2, 0.2, mx - 0.12, y + 1.06, mz, shade(W42.wood, 1.3), ry);
  b.box('fabric', 0.32, 0.12, 0.22, mx - 0.12, y + 1.06, mz, 0x8a7a5e, ry);
  b.kit('under.coffinKnock', 1, y + 1.0);
}

// 守庄梆子：D-ITM-0146
/** 守庄梆子：更架（两柱一梁）+ 梆子（中空木梆）+ 梆槌 + 三更木牌 + 悬绳 + 灵床白布塌角（响后塌下的一角） */
function w42WatchClapper(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.9, 0);
    b.box('ash', 0.44, 0.22, 0.44, px, y + 0.11, pz, W42.stD, ry);
    b.box('wood', 0.16, 2.4, 0.16, px, y + 1.32, pz, W42.wood, ry);
  }
  b.box('wood', 2.1, 0.16, 0.16, x, y + 2.56, z, W42.woodD, ry);
  // 梆子：中空木梆（两片合）挂在梁下，敲面朝街
  const [bx, bz] = lp(x, z, ry, 0, 0.06);
  b.box('wood', 0.7, 0.34, 0.3, bx, y + 2.18, bz, shade(0x6a4a2a, 1.05), ry);
  b.box('lacquer', 0.5, 0.14, 0.34, bx, y + 2.18, bz, 0x1a1210, ry);
  b.box('metal', 0.1, 0.18, 0.1, bx, y + 2.44, bz, W42.iron, ry);
  b.box('fabric', 0.03, 0.24, 0.03, bx, y + 2.52, bz, 0x8a7a52);
  // 梆槌：挂架侧
  const [mx, mz] = lp(x, z, ry, 0.86, 0.2);
  b.box('wood', 0.06, 0.7, 0.06, mx, y + 2.1, mz, W42.woodD, ry, 0, 0.2);
  b.box('wood', 0.16, 0.16, 0.16, mx + 0.06, y + 2.42, mz, shade(W42.wood, 1.3), ry);
  // 三更木牌：三枚挂在下横枋，第三枚翻面（三更）
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -0.6 + i * 0.3, 0.14);
    b.box('wood', 0.03, 0.12, 0.03, px, y + 2.44 - i * 0.02, pz, W42.woodD, ry);
    b.box('fabric', 0.2, 0.26, 0.02, px, y + 2.28, pz, shade(W42.paper, i === 2 ? 0.72 : 0.9), ry + (i === 2 ? 0.3 : 0));
  }
  // 响后灵床白布塌下一角：架后一张矮灵床，白布一角垂到地
  const [tx2, tz2] = lp(x, z, ry, -1.9, -0.5);
  b.box('wood', 1.5, 0.16, 0.72, tx2, y + 0.42, tz2, W42.woodD, ry);
  for (const s of [-1, 1]) b.box('wood', 0.1, 0.38, 0.1, tx2 + s * 0.62, y + 0.19, tz2, W42.wood, ry);
  b.box('fabric', 1.44, 0.1, 0.66, tx2, y + 0.56, tz2, 0xd8d0c0, ry);
  b.box('fabric', 0.42, 0.5, 0.06, tx2 + 0.5, y + 0.32, tz2 + 0.34, 0xd8d0c0, ry, 0, 0.2);
  b.kit('under.watchClapper', 1, y + 2.2);
}

// 分殿正堂：D-ITM-0148
/** 分殿正堂：三间小殿（台基/后墙/两山/四柱/板门）+ 「城隍」匾 + 城隍虚位（座空尘无）+ 香案前一炉冷灰 */
function w42ShrineHall(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  const t = y + 0.62;
  b.box('ash', 7.6, 0.62, 5.6, x, y + 0.31, z, shade(W42.st, 0.9), ry);
  b.box('ash', 8.0, 0.14, 6.0, x, y + 0.62, z, shade(W42.stL, 0.98), ry);
  for (let i = 0; i < 2; i++) b.box('ash', 3.4, 0.22, 0.5, x, y + 0.5 - i * 0.22, z + Math.cos(ry) * (2.9 + i * 0.5), shade(W42.stL, 1.0 - i * 0.06), ry);
  // 后墙 + 两山 + 四柱
  b.box('ash', 7.0, 3.6, 0.6, x, t + 1.8, z - Math.cos(ry) * 2.1, W42.brick, ry);
  for (const s of [-1, 1]) b.box('ash', 0.6, 3.6, 4.4, x + Math.cos(ry) * s * 3.3, t + 1.8, z - Math.sin(ry) * s * 3.3, W42.brick, ry);
  for (const lx of [-2.2, 2.2]) {
    const [px, pz] = lp(x, z, ry, lx, 2.1);
    b.box('ash', 0.44, 0.16, 0.44, px, t + 0.08, pz, W42.stL, ry);
    b.box('wood', 0.32, 3.4, 0.32, px, t + 1.86, pz, shade(W42.wood, 1.3), ry);
  }
  b.box('wood', 7.2, 0.36, 0.42, x, t + 3.62, z + Math.cos(ry) * 2.1, W42.wood, ry);
  // 屋顶：四坡 + 正脊
  b.pyramid('roof', 0.3, 3.4, x, t + 3.85, z, 0x14161a, ry, 1.36, 1.5, 1.05);
  b.box('roof', 1.8, 0.2, 0.5, x, t + 5.28, z, 0x20242a, ry);
  // 板门（半开）+ 匾「城隍」
  const [dx, dz] = lp(x, z, ry, 0, 2.1);
  b.box('lacquer', 1.5, 2.6, 0.12, dx - Math.cos(ry) * 0.5, t + 1.3, dz + Math.sin(ry) * 0.5, 0x2a1a1e, ry + 0.5);
  b.box('wood', 3.4, 0.24, 0.3, dx, t + 2.78, dz, W42.woodD, ry);
  sg.quad(atlas.text('w42-chenghuang', '城隍', 240, 96, {
    color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(6,10,8,0.92)', border: 'rgba(61,255,156,.8)', fontPx: 68,
  }), 2.1, 0.84, dx, t + 3.28, dz + Math.cos(ry) * 0.1, ry);
  // 城隍虚位：空座 + 扶手 + 座后屏 + 座上薄尘（座空尘无，只留一层灰）
  const [sx2, sz2] = lp(x, z, ry, 0, 0.4);
  b.box('lacquer', 1.8, 0.22, 1.2, sx2, t + 0.6, sz2, 0x2a1a20, ry);
  for (const s of [-1, 1]) {
    b.box('lacquer', 0.4, 0.7, 1.1, sx2 + Math.cos(ry) * s * 0.72, t + 0.9, sz2 - Math.sin(ry) * s * 0.72, shade(0x2a1a20, 0.9), ry);
    b.box('wood', 0.14, 0.56, 0.9, sx2 + Math.cos(ry) * s * 0.7, t + 1.28, sz2 - Math.sin(ry) * s * 0.7, W42.woodD, ry);
  }
  b.box('lacquer', 1.9, 1.5, 0.16, sx2, t + 1.5, sz2 - Math.cos(ry) * 0.56, 0x241820, ry);
  for (let i = 0; i < 3; i++) b.box('wood', 0.06, 1.3, 0.06, sx2 - 0.6 + i * 0.6, t + 1.5, sz2 - Math.cos(ry) * 0.48, shade(W42.woodD, 1.1), ry);
  b.box('ash', 1.6, 0.02, 1.0, sx2, t + 0.72, sz2, 0x8a8478, ry, 0, 0);
  b.box('ash', 1.0, 0.02, 0.6, sx2, t + 1.34, sz2 - Math.cos(ry) * 0.3, 0x8a8478, ry);
  // 香案前一炉冷灰
  const [ax, az] = lp(x, z, ry, 0, 1.6);
  b.box('wood', 1.9, 0.14, 0.7, ax, t + 0.7, az, W42.wood, ry);
  for (const s of [-1, 1]) b.box('wood', 0.1, 0.66, 0.1, ax + Math.cos(ry) * s * 0.78, t + 0.33, az - Math.sin(ry) * s * 0.78, W42.woodD, ry);
  b.cyl('metal', 0.26, 0.2, 0.3, 10, ax, t + 0.92, az, 0x4a4438);
  b.cyl('ash', 0.22, 0.22, 0.05, 10, ax, t + 1.08, az, 0x8a8478);
  b.kit('under.shrineHall', 1, t + 2.0);
}

// 绕梁香烟：D-ITM-0153
/** 绕梁香烟：香案 + 铜炉 + 三炷香 + 香烟凝而不散成带（横向指主城 −x，不散）+ 炉前灰痕 */
function w42IncenseBand(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 1.7, 0.14, 0.9, x, y + 0.82, z, shade(W42.stL, 1.02), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.7, sz * 0.32);
    b.box('wood', 0.13, 0.78, 0.13, px, y + 0.39, pz, W42.wood, ry);
  }
  b.cyl('metal', 0.3, 0.24, 0.36, 10, x, y + 1.07, z, 0x4a4438);
  b.cyl('metal', 0.34, 0.34, 0.06, 10, x, y + 1.27, z, 0x5a5244);
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, -0.1 + i * 0.1, 0.03);
    b.box('glow', 0.03, 0.5, 0.03, px, y + 1.52, pz, shade(0xd8c8a0, 0.7));
    b.box('glow', 0.05, 0.05, 0.05, px, y + 1.79, pz, shade(0xffcf90, 0.9));
  }
  // 香烟凝而不散成带：自炉口起五段横带，逐段向 −x（主城方向）偏折
  for (let i = 0; i < 5; i++) {
    const [px, pz] = lp(x, z, ry, -0.4 - i * 0.46, 0.06 + i * 0.1);
    b.box('glow', 0.6, 0.1 - i * 0.012, 0.22, px, y + 2.0 + i * 0.14, pz, shade(0xb8c0b0, 0.42 - i * 0.05), ry);
    b.box('glow', 0.42, 0.07, 0.16, px - 0.1, y + 2.1 + i * 0.14, pz, shade(0xd8dcd0, 0.34 - i * 0.04), ry);
  }
  b.box('glow', 0.9, 0.02, 0.5, x, y + 0.2, z + Math.cos(ry) * 0.3, shade(0x6a6458, 0.5), ry);
  b.kit('under.incenseBand', 1, y + 1.4);
}

// 「未时开张」幌：D-ITM-0154
/** 「未時開張」幌：客栈幌杆 + 竖幌 + 营业木牌（牌面半掩，未时自开）+ 昼间紧闭的门板两扇 + 檐下双灯 */
function w42InnBanner(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 0.9, 0.24, 0.9, x, y + 0.12, z, W42.stD, ry);
  b.box('ash', 0.62, 0.14, 0.62, x, y + 0.31, z, W42.stL, ry);
  b.box('wood', 0.14, 4.6, 0.14, x, y + 2.4, z, shade(W42.wood, 1.2), ry);
  const [ax, az] = lp(x, z, ry, 0, 0.9);
  b.box('wood', 0.1, 0.1, 1.8, ax, y + 4.5, az, W42.woodD, ry);
  const [vx, vz] = lp(x, z, ry, 0, 1.56);
  b.box('fabric', 0.92, 2.9, 0.05, vx, y + 2.96, vz, 0x2e3a44, ry);
  b.box('wood', 1.02, 0.08, 0.12, vx, y + 4.42, vz, W42.woodD, ry);
  sg.quad(atlas.text('w42-innBanner', '未時開張', 100, 460, {
    color: '#d8e8ff', glow: '#4d7cff', vertical: true, fontPx: 66, bg: 'rgba(10,18,32,0.6)',
  }), 0.74, 2.5, vx, y + 2.98, vz + 0.05, ry);
  // 营业牌：木牌半掩（牌面斜挂，昼间合）
  const [bx, bz] = lp(x, z, ry, 0.02, 0.98);
  b.box('wood', 0.62, 0.86, 0.06, bx, y + 3.3, bz, W42.woodD, ry + 0.24);
  b.box('glow', 0.44, 0.62, 0.02, bx, y + 3.3, bz + 0.04, shade(W42.paper, 0.64), ry + 0.24);
  // 昼间门板：两扇靠在柱侧（未时自开）
  for (const s of [-1, 1]) {
    const [dx, dz] = lp(x, z, ry, s * 1.25, -0.5);
    b.box('wood', 1.1, 2.5, 0.1, dx, y + 1.26, dz, shade(W42.wood, 0.94), ry + s * 0.18, 0, s * 0.06);
    for (let i = 0; i < 3; i++) b.box('wood', 1.0, 0.08, 0.14, dx, y + 0.5 + i * 0.8, dz, W42.woodD, ry + s * 0.18);
  }
  // 檐下双灯（绿焰）
  for (const s of [-1, 1]) {
    const [lx, lz] = lp(x, z, ry, s * 1.6, 0.4);
    b.box('wood', 0.05, 0.4, 0.05, lx, y + 3.9, lz, W42.woodD, ry);
    b.box('metal', 0.24, 0.05, 0.24, lx, y + 3.66, lz, W42.iron, ry);
    b.box('glow', 0.2, 0.24, 0.2, lx, y + 3.5, lz, shade(W42.phos, 0.8), ry);
  }
  b.kit('under.innBanner', 1, y + 3.0);
}

// 通铺大房：D-ITM-0155
/** 通铺大房：通铺台（木框 + 草垫）+ 十二位被形鼓起而无人 + 枕木 + 床头挂钩 + 一盏残灯 + 铺前鞋两双 */
function w42BunkRoom(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('wood', 8.6, 0.16, 1.9, x, y + 0.62, z, W42.wood, ry);
  for (const s of [-1, 1]) b.box('wood', 8.6, 0.5, 0.14, x, y + 0.3, z + s * 0.94 * Math.cos(ry), W42.woodD, ry);
  for (let i = 0; i < 4; i++) {
    const [px, pz] = lp(x, z, ry, -3.6 + i * 2.4, 0);
    b.box('wood', 0.16, 0.56, 1.7, px, y + 0.3, pz, shade(W42.woodD, 1.06), ry);
  }
  b.box('fabric', 8.4, 0.14, 1.7, x, y + 0.77, z, 0x8a7a5a, ry);
  // 十二位：被形鼓起而无人（两段布卷 + 折边），每人一枕木
  for (let i = 0; i < 12; i++) {
    const col = i % 6, row = Math.floor(i / 6);
    const [px, pz] = lp(x, z, ry, -3.35 + col * 1.34, (row - 0.5) * 0.78);
    const bh = 0.3 + (i % 3) * 0.06;
    b.box('fabric', 1.06, bh, 0.66, px, y + 0.9 + bh / 2, pz, shade(0x3a3448, 0.9 + (i % 4) * 0.06), ry + (i % 3 - 1) * 0.04);
    b.box('fabric', 0.96, 0.1, 0.56, px, y + 0.98 + bh, pz, shade(0x4a4458, 1.05), ry);
    b.box('fabric', 0.3, 0.06, 0.5, px + 0.34, y + 0.92 + bh, pz, shade(0x5a5468, 1.0), ry);
    b.box('wood', 0.5, 0.14, 0.3, px - 0.72, y + 0.92, pz, shade(W42.wood, 1.1), ry);
    b.box('metal', 0.05, 0.16, 0.05, px - 0.7, y + 1.5, pz, W42.iron, ry);
  }
  // 残灯：铺头灯柱 + 灯盘 + 弱焰
  const [lx, lz] = lp(x, z, ry, 4.2, 0.7);
  b.box('ash', 0.34, 0.16, 0.34, lx, y + 0.08, lz, W42.stD, ry);
  b.cyl('wood', 0.06, 0.1, 1.6, 6, lx, y + 0.96, lz, shade(W42.wood, 1.4));
  b.cyl('metal', 0.2, 0.15, 0.1, 8, lx, y + 1.82, lz, 0x2a2622);
  b.box('glow', 0.14, 0.22, 0.14, lx, y + 1.98, lz, shade(W42.phos, 0.62));
  // 铺前鞋两双（住客忘带走的）
  for (let i = 0; i < 4; i++) {
    const [px, pz] = lp(x, z, ry, -2.6 + i * 1.7, -(1.35 + (i % 2) * 0.24));
    b.box('fabric', 0.3, 0.1, 0.16, px, y + 0.24, pz, i % 2 ? 0x3a2a26 : 0x26303a, ry + i * 0.4);
    b.box('fabric', 0.16, 0.08, 0.16, px + 0.1, y + 0.3, pz, 0x2a2a30, ry + i * 0.4);
  }
  b.kit('under.bunkRoom', 12, y + 0.9);
}

// 望夫窗：D-ITM-0159
/** 望夫窗：临街残窗墙 + 直棂窗（窗纸磷光）+ 窗内立姿剪影（近看即无，只留薄影）+ 窗台石 + 墙脚落灰 */
function w42WaitingWindow(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 3.2, 3.4, 0.5, x, y + 1.7, z, shade(W42.brick, 1.0), ry);
  b.box('ash', 3.5, 0.28, 0.66, x, y + 3.5, z, shade(W42.stL, 1.0), ry);
  b.box('ash', 3.3, 0.4, 0.56, x, y + 0.2, z, W42.brickL, ry);
  // 直棂窗（既有窗式，窗纸走磷光）
  inWindow(b, x, z + Math.cos(ry) * 0.28, y + 1.0, 2.1, 1.9, ry, true, false);
  // 窗内立姿剪影：肩/身/首 三层薄影，贴在窗纸上（近看即无）
  const [px, pz] = lp(x, z, ry, 0.16, 0.2);
  b.box('fabric', 0.62, 1.0, 0.03, px, y + 1.5, pz, 0x1a2028, ry);
  b.box('fabric', 0.7, 0.24, 0.03, px, y + 2.02, pz, 0x1a2028, ry);
  b.box('fabric', 0.24, 0.28, 0.03, px, y + 2.34, pz, 0x1a2028, ry);
  b.box('fabric', 0.5, 0.6, 0.02, px + 0.04, y + 1.18, pz, 0x10161c, ry);
  // 窗台石 + 墙脚落灰
  b.box('ash', 2.4, 0.16, 0.42, x, y + 0.96, z + Math.cos(ry) * 0.3, W42.stL, ry);
  for (let i = 0; i < 3; i++) b.box('ash', 0.7 - i * 0.12, 0.03, 0.24, x - 1.0 + i * 0.9, y + 0.22, z + Math.cos(ry) * 0.42, shade(0x6a6458, 1.0), ry);
  b.kit('under.waitingWindow', 1, y + 1.6);
}

// 泪烛：D-ITM-0160
/** 泪烛：窗台泪烛（红烛 + 烛台 + 烛泪不干，泪痕流到窗棂外）+ 窗棂前一线烛光 + 台面蜡臼 */
function w42TearCandle(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 1.6, 0.14, 0.7, x, y + 0.9, z, shade(W42.stL, 1.02), ry);
  for (const s of [-1, 1]) b.box('wood', 0.1, 0.84, 0.1, x + Math.cos(ry) * s * 0.62, y + 0.45, z - Math.sin(ry) * s * 0.62, W42.wood, ry);
  // 烛台：铜盘 + 三足 + 蜡臼 + 红烛 + 焰
  const [cx2, cz2] = lp(x, z, ry, -0.18, 0.04);
  b.cyl('metal', 0.3, 0.34, 0.06, 10, cx2, y + 1.0, cz2, shade(W42.cu, 0.8));
  for (let k = 0; k < 3; k++) {
    const a = k * 2.09;
    b.box('metal', 0.07, 0.16, 0.07, cx2 + Math.cos(a) * 0.2, y + 1.06, cz2 + Math.sin(a) * 0.2, W42.cuD);
  }
  b.cyl('lacquer', 0.14, 0.16, 0.5, 10, cx2, y + 1.3, cz2, 0x8a2028);
  b.cyl('lacquer', 0.16, 0.14, 0.1, 10, cx2, y + 1.58, cz2, 0x9a2a30);
  b.box('glow', 0.1, 0.18, 0.1, cx2, y + 1.72, cz2, shade(0xffcf90, 0.9));
  b.box('glow', 0.05, 0.08, 0.05, cx2, y + 1.86, cz2, 0xffe0a0);
  // 烛泪不干：三层环形蜡泪挂在烛身，最外一条流到窗棂外
  for (let i = 0; i < 3; i++) {
    const [wx, wz] = lp(cx2, cz2, ry, Math.cos(i * 1.4) * 0.14, Math.sin(i * 1.4) * 0.14);
    b.box('glow', 0.07, 0.2 + i * 0.06, 0.07, wx, y + 1.22 - i * 0.04, wz, shade(0xa83038, 0.9), ry);
  }
  const [tx2, tz2] = lp(cx2, cz2, ry, 0.16, 0.0);
  b.box('glow', 0.05, 0.9, 0.05, tx2, y + 1.0, tz2, shade(0x8a2028, 0.95), ry + 0.1);
  b.box('glow', 0.16, 0.05, 0.1, tx2 + Math.cos(ry) * 0.12, y + 0.62, tz2 - Math.sin(ry) * 0.12, shade(0x8a2028, 1.05), ry);
  // 台面蜡臼 + 窗棂前一盏暗光
  b.cyl('glow', 0.22, 0.22, 0.02, 10, cx2, y + 0.99, cz2, shade(0x6a1a22, 0.7));
  b.box('glow', 1.1, 0.5, 0.02, x, y + 1.3, z + Math.cos(ry) * 0.32, shade(0xa83038, 0.22), ry);
  b.kit('under.tearCandle', 1, y + 1.2);
}

// 绣鞋一双：D-ITM-0161
/** 绣鞋一双：窗下石阶 + 两只绣鞋（鞋尖自转向来客方向，左右一正一偏）+ 鞋底灰痕 + 阶前落尘 */
function w42EmbroideredShoes(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 1.9, 0.26, 1.2, x, y + 0.13, z, shade(W42.stL, 0.98), ry);
  b.box('ash', 2.1, 0.12, 1.4, x, y + 0.32, z, shade(W42.st, 1.04), ry);
  // 两只绣鞋：鞋身 + 鞋头翘 + 鞋底 + 绣面（朱线两道）
  for (let i = 0; i < 2; i++) {
    const [px, pz] = lp(x, z, ry, -0.26 + i * 0.54, 0.04 + i * 0.1);
    const a = ry + 0.26 - i * 0.42;                       // 鞋尖朝来客方向
    b.box('fabric', 0.34, 0.14, 0.18, px, y + 0.45, pz, 0x5c1a24, a);
    b.box('fabric', 0.16, 0.1, 0.16, px + Math.cos(a) * 0.18, y + 0.47, pz - Math.sin(a) * 0.18, shade(0x7a2430, 1.06), a);
    b.box('fabric', 0.1, 0.08, 0.1, px + Math.cos(a) * 0.27, y + 0.52, pz - Math.sin(a) * 0.27, 0x8a2a34, a, 0, -0.3);
    b.box('ash', 0.36, 0.04, 0.2, px, y + 0.38, pz, 0x8a8478, a);
    for (let k = 0; k < 2; k++) b.box('glow', 0.2, 0.012, 0.02, px, y + 0.5 + k * 0.03, pz, shade(0xd8b060, 0.7), a);
  }
  // 鞋底灰痕（走过的一段）+ 阶前落尘
  for (let i = 0; i < 3; i++) b.box('ash', 0.14, 0.012, 0.1, x + Math.cos(ry + 1.2) * (0.6 + i * 0.45), y + 0.39, z - Math.sin(ry + 1.2) * (0.6 + i * 0.45), shade(0x9a9488, 0.9), ry + i * 0.2);
  b.box('ash', 1.0, 0.02, 0.5, x - 0.3, y + 0.39, z - 0.3, shade(0x8a8478, 0.9), ry);
  b.kit('under.embroideredShoes', 1, y + 0.45);
}

// 织机半幅：D-ITM-0162
/** 织机半幅：织机（机身/经轴/卷布轴/综框/踏板）+ 机上断帛半幅（断口毛边）+ 梭子自己走（错位两道梭痕） */
function w42Loom(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, sx * 0.86, sz * 0.9);
    b.box('wood', 0.16, 1.5, 0.16, px, y + 0.75, pz, W42.wood, ry);
  }
  b.box('wood', 2.0, 0.14, 0.16, x, y + 1.44, z - Math.cos(ry) * 0.9, W42.woodD, ry);
  b.box('wood', 2.0, 0.14, 0.16, x, y + 1.44, z + Math.cos(ry) * 0.9, W42.woodD, ry);
  b.box('wood', 0.16, 0.14, 1.9, x - Math.cos(ry) * 0.86, y + 0.5, z + Math.sin(ry) * 0.86, W42.woodD, ry);
  b.box('wood', 0.16, 0.14, 1.9, x + Math.cos(ry) * 0.86, y + 0.5, z - Math.sin(ry) * 0.86, W42.woodD, ry);
  // 经轴（后） + 卷布轴（前）
  const [bx1, bz1] = lp(x, z, ry, 0, -0.78);
  b.cyl('wood', 0.2, 0.2, 1.7, 12, bx1, y + 1.06, bz1, shade(W42.wood, 1.25), 0, 0, Math.PI / 2);
  const [bx2, bz2] = lp(x, z, ry, 0, 0.74);
  b.cyl('wood', 0.16, 0.16, 1.6, 12, bx2, y + 0.98, bz2, shade(W42.wood, 1.1), 0, 0, Math.PI / 2);
  // 经线：横向细线一束（布面）
  b.box('fabric', 1.5, 0.02, 1.4, x, y + 1.12, z, 0x8a7a5a, ry);
  // 断帛半幅：织到一半断开，断口毛边三缕
  b.box('fabric', 1.5, 0.03, 0.66, x, y + 1.14, z + Math.cos(ry) * 0.36, 0xb8a888, ry);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.12, 0.02, 0.22 + i * 0.06, x - 0.5 + i * 0.5, y + 1.15, z - Math.cos(ry) * 0.02, shade(0xb8a888, 0.88), ry + (i - 1) * 0.16);
  // 综框 + 双踏板
  b.box('wood', 1.6, 0.1, 0.1, x, y + 1.5, z - Math.cos(ry) * 0.2, W42.woodD, ry);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.34, 0.58);
    b.box('wood', 0.5, 0.08, 0.9, px, y + 0.24, pz, shade(W42.woodD, 1.12), ry, -0.2, 0);
  }
  // 梭子自己走：错位两道梭痕（一在经面，一已滑到布边外）
  b.box('wood', 0.44, 0.08, 0.16, x, y + 1.18, z - Math.cos(ry) * 0.12, shade(0x6a4a2a, 1.1), ry + 0.1);
  const [sx2, sz2] = lp(x, z, ry, 0.94, 0.44);
  b.box('wood', 0.4, 0.07, 0.14, sx2, y + 1.16, sz2, shade(0x6a4a2a, 1.0), ry - 0.3);
  b.kit('under.loom', 1, y + 1.2);
}

// 逆行梯影：D-ITM-0163
/** 逆行梯影：木梯（双帮 + 七踏）+ 梯上人影（向上行的剪影）+ 脚步声向下（踏面下三枚暗光） + 梯脚磨痕 */
function w42ReverseStairs(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 0.48, 0);
    b.box('wood', 0.14, 3.6, 0.14, px, y + 1.8, pz, W42.wood, ry, 0, 0);
    b.box('wood', 0.14, 0.5, 0.4, px, y + 3.6, pz, W42.woodD, ry);
  }
  for (let i = 0; i < 7; i++) {
    const [px, pz] = lp(x, z, ry, 0, -0.32 + i * 0.1);
    b.box('wood', 1.0, 0.07, 0.26, px, y + 0.42 + i * 0.47, pz, shade(W42.woodD, 1.0 + (i % 2) * 0.1), ry);
  }
  // 梯上人影：向上行的剪影（身 + 首 + 一腿抬起），越上越淡
  const [bx, bz] = lp(x, z, ry, 0.1, 0.12);
  b.box('fabric', 0.5, 1.1, 0.1, bx, y + 2.6, bz, 0x161c22, ry);
  b.box('fabric', 0.26, 0.3, 0.1, bx, y + 3.24, bz, 0x161c22, ry);
  b.box('fabric', 0.14, 0.6, 0.1, bx - 0.16, y + 1.96, bz, 0x10161c, ry, 0, 0.24);
  b.box('fabric', 0.3, 0.12, 0.1, bx + 0.16, y + 2.5, bz, 0x10161c, ry, 0, -0.3);
  // 脚步声向下：踏面下三枚暗光（声源在梯脚，人却在梯上）
  for (let i = 0; i < 3; i++) {
    const [px, pz] = lp(x, z, ry, 0, -0.3 + i * 0.1);
    b.box('glow', 0.36, 0.04, 0.2, px, y + 0.34 + i * 0.47, pz, shade(W42.phos, 0.16 + i * 0.04), ry);
  }
  // 梯脚磨痕 + 落尘
  b.box('ash', 1.2, 0.02, 0.5, x, y + 0.2, z + Math.cos(ry) * 0.4, shade(0x8a8478, 0.7), ry);
  b.kit('under.reverseStairs', 1, y + 1.8);
}

// 「万货全」匾：D-ITM-0172
/** 「萬貨全」匾：门架（两柱一梁）+ 漆匾「萬貨全」+ 末字缺笔（缺处遮一笔、旁补极小「尋」） + 匾下垂双灯 */
function w42AllGoodsPlaque(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.5, 0);
    b.box('ash', 0.56, 0.22, 0.56, px, y + 0.11, pz, W42.stD, ry);
    b.box('wood', 0.2, 2.5, 0.2, px, y + 1.4, pz, W42.wood, ry);
  }
  b.box('wood', 3.4, 0.22, 0.22, x, y + 2.72, z, W42.woodD, ry);
  b.box('lacquer', 2.9, 1.0, 0.12, x, y + 2.1, z + Math.cos(ry) * 0.02, 0x241a20, ry);
  b.box('lacquer', 3.0, 0.1, 0.16, x, y + 2.62, z, 0x2a1a1e, ry);
  b.box('lacquer', 3.0, 0.1, 0.16, x, y + 1.58, z, 0x2a1a1e, ry);
  sg.quad(atlas.text('w42-allGoods', '萬貨全', 360, 116, {
    color: '#d8c8a0', glow: '#b8a060', bg: 'rgba(30,20,26,0.96)', border: 'rgba(160,140,90,.6)', fontPx: 78,
  }), 2.6, 0.84, x, y + 2.1, z + Math.cos(ry) * 0.08, ry);
  // 末字缺笔：缺处用匾底压住一笔，笔旁补一个极小的「尋」（一点磷光 + 两道细划）
  const [kx, kz] = lp(x, z, ry, 1.02, 0.09);
  b.box('lacquer', 0.1, 0.44, 0.02, kx, y + 2.06, kz, 0x241a20, ry);
  const [mx, mz] = lp(x, z, ry, 0.86, 0.1);
  b.box('glow', 0.03, 0.03, 0.01, mx, y + 2.3, mz, shade(W42.phos, 0.5), ry);
  for (let i = 0; i < 2; i++) b.box('glow', 0.09, 0.012, 0.01, mx, y + 2.22 - i * 0.05, mz, shade(W42.phos, 0.36), ry);
  // 匾下垂双灯
  for (const s of [-1, 1]) {
    const [lx, lz] = lp(x, z, ry, s * 1.2, 0.1);
    b.box('wood', 0.05, 0.3, 0.05, lx, y + 1.42, lz, W42.woodD, ry);
    b.box('glow', 0.18, 0.22, 0.18, lx, y + 1.2, lz, shade(W42.phos, 0.7), ry);
  }
  b.kit('under.allGoodsPlaque', 1, y + 2.1);
}

// 庙祝空位：D-ITM-0183
/** 庙祝空位：庙前石台 + 庙祝椅（椅面/靠背/扶手，无人自摇的偏斜角）+ 椅上薄尘 + 两侧幡带 + 足下磨出的凹痕 */
function w42TempleKeeperSeat(b: Baker, x: number, z: number, ry: number): void {
  const y = UNDER.y + 0.19;
  b.box('ash', 2.2, 0.3, 2.0, x, y + 0.15, z, shade(W42.st, 0.94), ry);
  b.box('ash', 2.4, 0.12, 2.2, x, y + 0.36, z, shade(W42.stL, 1.0), ry);
  // 庙祝椅：四腿 + 椅面 + 靠背 + 两扶手（整椅微斜 = 无人自摇的一瞬）
  const ry2 = ry + 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = lp(x, z, ry2, sx * 0.42, sz * 0.4);
    b.box('wood', 0.1, 0.5, 0.1, px, y + 0.71, pz, W42.wood, ry2);
  }
  b.box('wood', 1.1, 0.1, 0.94, x, y + 1.01, z, shade(W42.wood, 1.2), ry2);
  b.box('wood', 1.1, 0.9, 0.1, x, y + 1.5, z - Math.cos(ry2) * 0.42, W42.woodD, ry2, 0, 0.08);
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry2, s * 0.5, -0.02);
    b.box('wood', 0.1, 0.1, 0.84, px, y + 1.3, pz, W42.woodD, ry2);
  }
  b.box('wood', 1.0, 0.3, 0.06, x, y + 1.56, z - Math.cos(ry2) * 0.42, shade(0x3a2c22, 1.0), ry2);
  // 椅上薄尘 + 座面凹痕（常年有人坐过又没人）
  b.box('ash', 0.98, 0.02, 0.84, x, y + 1.07, z, 0x8a8478, ry2);
  b.box('ash', 0.5, 0.015, 0.42, x, y + 1.08, z, shade(0x8a8478, 0.86), ry2);
  // 两侧幡带（庙前幡带成林，只取两条）
  for (const s of [-1, 1]) {
    const [px, pz] = lp(x, z, ry, s * 1.5, -0.3);
    b.box('ash', 0.4, 0.18, 0.4, px, y + 0.09, pz, W42.stD, ry);
    b.box('wood', 0.1, 3.2, 0.1, px, y + 1.7, pz, W42.wood, ry);
    const [fx, fz] = lp(px, pz, ry, 0, 0.34);
    b.box('fabric', 0.34, 1.8, 0.04, fx, y + 2.3, fz, s < 0 ? 0x2a5c42 : 0x5c1b24, ry);
    for (let i = 0; i < 3; i++) b.box('fabric', 0.3, 0.16, 0.03, fx, y + 1.44 - i * 0.22, fz, s < 0 ? 0x386e50 : 0x6a2228, ry);
  }
  b.kit('under.templeKeeperSeat', 1, y + 1.1);
}

/** WS-42 总装：29 件 —— 鬼门关 1 / 枉死城 3 / 丰都城垣 1 / 阴阳界井口 1 / 丰都九坊铺面 23 */
export function buildUnderworldDataOnly(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // ---- 鬼门关街口（D-ZZ-03：既有「鬼門關」过街门楼 x=400 / z=85，门洞原为空的）----
  w42GateStuds(b, 400, 85);                                        // 门钉铜乳：D-ITM-0071
  // ---- 枉死城（D-ZZ-12：城垣中心 (0,-250)，衙署居城内北正街 (0,-215)）----
  w42WrongfulCityWall(b);                                          // 城墙垣：D-ITM-0092
  w42WrongfulYamen(b, sg, atlas, 0, -215);                         // 枉死衙署：D-ITM-0096
  // ---- 阴阳界井亭（D-ZZ-01：(470,-258,24)，井口径 6m）----
  w42WellMouth(b, 470, 25);                                        // 坠井井口：D-ITM-0103
  // ---- 丰都鬼城（D-ZZ-11）城垣 ----
  w42FengduCityWall(b);                                            // 城墙垣：D-ITM-0113
  // ---- D-HOU-01 赌鬼坊（东南坊，后巷 z=55 中央骰台大院）----
  w42BoneDice(b, 622, 52.4, 0);                              // 骨骰：D-ITM-0120
  w42SoulTokens(b, 640, 52.4, 0);                            // 押魂签筹：D-ITM-0121
  // ---- D-HOU-02 饿鬼食肆（南市坊，双排对脸、灶口全朝街 z=25）----
  w42FoodBanner(b, sg, atlas, 294, 29.6, Math.PI);                 // 招魂食幌：D-ITM-0126
  w42SmellStove(b, 310, 20.4, 0);                                  // 气味灶：D-ITM-0127
  w42DroolBanner(b, 312, 29.6, Math.PI);                           // 垂涎幌：D-ITM-0129
  w42GhoulTrough(b, 332, 20.4, 0);                                 // 饿鬼食槽：D-ITM-0130
  // ---- D-HOU-03 纸扎铺（西市坊，前店后炉，后巷 z=115）----
  w42PaperHorseSedan(b, 460, 112.4, 0);                      // 纸马纸轿：D-ITM-0133
  w42PaperHouse(b, 460, 117.6, Math.PI);                                 // 纸宅模型：D-ITM-0134
  w42PasteBasin(b, 480, 112.4, 0);                           // 浆糊陶盆：D-ITM-0135
  w42PriceTags(b, 452, 117.6, Math.PI);                                  // 价目阴签：D-ITM-0137
  // ---- D-HOU-04 棺材铺（西北坊，竖棺靠墙）----
  w42CoffinGrain(b, 540, 112.4, 0);                          // 棺木阴纹：D-ITM-0139
  w42CoffinKnock(b, 540, 117.6, Math.PI);                                // 敲棺声：D-ITM-0140
  // ---- D-HOU-05 义庄（北郊坊，灵床横列）----
  w42WatchClapper(b, 618, 117.6, Math.PI);                               // 守庄梆子：D-ITM-0146
  // ---- D-HOU-06 城隍分殿（中央坊，正堂虚位）----
  w42ShrineHall(b, sg, atlas, 700, 89.6, Math.PI);                 // 分殿正堂：D-ITM-0148
  w42IncenseBand(b, 716, 89.6, Math.PI);                           // 绕梁香烟：D-ITM-0153
  // ---- D-HOU-07 鬼客栈（东市坊，昼闭夜开）----
  w42InnBanner(b, sg, atlas, 586, 149.6, Math.PI);                 // 「未时开张」幌：D-ITM-0154
  w42BunkRoom(b, 618, 149.6, Math.PI);                             // 通铺大房：D-ITM-0155
  // ---- D-HOU-08 怨妇楼（西巷坊，临巷绣楼，窗向西）----
  w42WaitingWindow(b, 462, 52.4, 0);                         // 望夫窗：D-ITM-0159
  w42TearCandle(b, 474, 57.6, Math.PI);                                  // 泪烛：D-ITM-0160
  w42EmbroideredShoes(b, 462, 57.6, Math.PI);                            // 绣鞋一双：D-ITM-0161
  w42Loom(b, 486, 52.4, 0);                                  // 织机半幅：D-ITM-0162
  w42ReverseStairs(b, 486, 57.6, Math.PI);                               // 逆行梯影：D-ITM-0163
  // ---- D-HOU-10 杂货鬼铺（十字街坊）----
  w42AllGoodsPlaque(b, sg, atlas, 700, 149.6, Math.PI);             // 「万货全」匾：D-ITM-0172
  // ---- D-HOU-12 游魂庙（庙前坊，小庙无墙、龛前幡带成林）----
  w42TempleKeeperSeat(b, 780, 149.6, Math.PI);                     // 庙祝空位：D-ITM-0183
}
