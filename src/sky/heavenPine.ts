import { Baker, shade, type BGroup } from '../city/bake';

/**
 * 天宫崖边古松 + 白玉望台（SPEC C4 / 参考图 R4-R5）。
 *
 * 形制（全部按 scaleHeavenGeometry 放大前的口径建，调用方不要再乘 2.2）：
 *   ① 台：半径 18m 圆形汉白玉台，台面近白、三圈同心缝 + 18 道放射缝 + 中心云纹；
 *      外沿一圈望柱栏板：望柱距 2.4m、通高 1.2m、柱头仰莲包金；栏板带浅浮雕。
 *   ② 崖：台下 5 层收分岩体（9–11 边不规则轮廓）+ 18 块外露岩 + 苔痕 + 垂草 + 藤萝，
 *      岩体下探到云海面以下，读作从云里长出来的崖台，而不是一张漂着的盘。
 *   ③ 松：13 节首尾相接的虬曲主干（S 形，横向摆幅 6m），每节 2 道深浅交替窄环作鳞；
 *      一条 46m 主横枝探出崖外 21m 并下垂，另有 3 条大枝与 5 条上部枝；针叶是
 *      3–4 个压扁低模球叠成的团簇（每团 2–4m），不是圆锥也不是单球。
 *   ④ 垂根与藤萝：横枝下 18 条深褐细条，其中 9 条末端挂暖金宫灯（glow 组）。
 *
 * 落位：主台贴内环 11 号岛西缘外挑（岛心 229.5,-144.4，r30.2，台面 214.6）；
 *       两处小尺度贴 10 号（r41.5）与 8 号（r29.1）岛外缘，缩放 0.6 / 0.45。
 *       三处不在一条线上，且都在内环带的背主城一侧，不挡凌霄殿与南天门。
 */

const TAU = Math.PI * 2;
const D = Math.PI / 180;

// ============ 调色板（sRGB，Baker 落盘时转线性） ============
const JADE = 0xd9d3c4;          // 汉白玉（压一档，避开夕阳裁白）
const JADE_HI = shade(JADE, 1.06);
const JADE_D = shade(JADE, 0.89);
const JADE_DD = shade(JADE, 0.77);
const SEAM = 0xaaa397;          // 台面浅灰缝
const SEAM_D = 0x8b857a;
const GOLD = 0xc79a35;
const GOLD_HI = 0xf0cf82;
const GOLD_D = shade(GOLD, 0.7);

const BARK = 0x5b4630;
const BARK_D = 0x3c2d1f;
const BARK_L = 0x75593c;
const BARK_LL = 0x8b6c49;
const NEEDLE = 0x37663f;
const NEEDLE_D = 0x284d33;
const NEEDLE_L = 0x53885c;

const ROCK = 0x4e463c;          // 深灰褐岩（压暗，避免夕照下读成白玉）
const ROCK_D = 0x3b352d;
const ROCK_DD = 0x2b2722;
const ROCK_L = 0x675b4b;
const MOSS = 0x3d5a30;
const MOSS_D = 0x2c4522;
const GRASS = 0x35502c;

const LANTERN = 0xffd58a;
const LANTERN_CORE = 0xffe9bd;
const TASSEL = 0xa63a2b;

type V3 = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const hash = (i: number, s: number): number => {
  const v = Math.sin(i * 127.1 + s * 311.7 + 74.7) * 43758.5453;
  return v - Math.floor(v);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ============ 落位 ============
export interface HeavenPineSite {
  /** 台心（缩放前 x/z） */
  x: number;
  z: number;
  /** 台面标高（缩放前） */
  deckY: number;
  /** 局部 +x（向崖外、横枝方向）的世界方位：世界角 = -rot */
  rot: number;
  /** 整组缩放：主台 1、小台 0.6 / 0.45 */
  scale: number;
  seed: number;
  label: string;
}

/** 最近一次 build 的落位（探针/验收用） */
export const HEAVEN_PINE_SITES: HeavenPineSite[] = [
  // 11 号内环岛（229.5,-144.4,r30.2）西缘：台心到岛心 47.9 = 岛缘 29.9 + 台半径 18.0
  { x: 181.6, z: -144.4, deckY: 214.7, rot: Math.PI, scale: 1, seed: 71, label: 'main' },
  // 10 号岛（114.9,-225.2,r41.5）背主城一侧
  { x: 138.5, z: -271.5, deckY: 213.8, rot: -297 * D, scale: 0.6, seed: 137, label: 'south' },
  // 8 号岛（-138,-208.4,r29.1）外缘
  { x: -158.4, z: -239.2, deckY: 211.3, rot: -236.5 * D, scale: 0.45, seed: 263, label: 'west' },
];

// ============ 局部坐标框架 ============
// 局部 +x = 崖外（横枝方向），+z = 沿台缘，y = 台面以上。
interface Frame {
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
}

const P = (f: Frame, lx: number, ly: number, lz: number): V3 => {
  const c = Math.cos(f.rot), sn = Math.sin(f.rot);
  return [
    f.x + (lx * c + lz * sn) * f.s,
    f.y + ly * f.s,
    f.z + (-lx * sn + lz * c) * f.s,
  ];
};

/** 局部盒体：位置/尺寸都按 f.s 缩放，ry 按局部朝向换算 */
const lbox = (
  b: Baker, f: Frame, g: BGroup, w: number, h: number, d: number,
  lx: number, ly: number, lz: number, hex: number, aLocal = 0, rx = 0, rz = 0,
): void => {
  const p = P(f, lx, ly, lz);
  b.box(g, w * f.s, h * f.s, d * f.s, p[0], p[1], p[2], hex, f.rot - aLocal, rx, rz);
};

/** 世界两点间圆柱（Baker 的 cyl 轴向是 +Y，用 ry/rz 对准） */
function rod(b: Baker, g: BGroup, a: V3, c: V3, r0: number, r1: number, seg: number, hex: number): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const tilt = Math.acos(clamp(dy / len, -1, 1));
  const az = Math.atan2(dz, -dx);
  b.cyl(g, r1, r0, len * 1.035, seg, (a[0] + c[0]) * 0.5, (a[1] + c[1]) * 0.5, (a[2] + c[2]) * 0.5, hex, az, 0, tilt);
}

/** 沿杆件的窄环（树皮鳞环 / 竹节） */
function band(b: Baker, g: BGroup, a: V3, c: V3, t: number, r: number, hh: number, hex: number, seg = 7): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const tilt = Math.acos(clamp(dy / len, -1, 1));
  const az = Math.atan2(dz, -dx);
  b.cyl(g, r, r, hh, seg, a[0] + dx * t, a[1] + dy * t, a[2] + dz * t, hex, az, 0, tilt);
}

// ============ 针叶团簇 ============
/** 一团针叶 = 5 个互相咬合的压扁低模球 + 1 个深色底衬；单团直径 2–4m */
function needlePad(b: Baker, f: Frame, p: V3, r: number, seed: number, tint = 1): void {
  const w = P(f, p[0], p[1], p[2]);
  const R = r * f.s;
  for (let k = 0; k < 5; k++) {
    const a = hash(seed + k * 3.7, 12.3) * TAU;
    const dx = Math.cos(a) * R * 0.48;
    const dz = Math.sin(a) * R * 0.48;
    const dy = (k % 3 === 0 ? 0.34 : k % 3 === 1 ? -0.3 : 0.02) * R;
    const rr = R * (0.7 + hash(seed + k, 5.9) * 0.3);
    b.sphere('leaf', rr, 6, w[0] + dx, w[1] + dy, w[2] + dz,
      shade(k === 2 ? NEEDLE_L : NEEDLE, tint * (0.84 + 0.18 * hash(seed + k, 7.1))),
      a, (hash(seed + k, 8.9) - 0.5) * 0.42, (hash(seed + k, 9.7) - 0.5) * 0.42, 1.22, 0.56, 1.05);
  }
  // 背光底衬，压住球底读作“团”而不是“球”
  b.sphere('leaf', R * 0.6, 5, w[0], w[1] - R * 0.36, w[2], shade(NEEDLE_D, 1.12), seed, 0, 0, 1.18, 0.5, 1.0);
}

/** 宫灯：金盖 + 暖金 glow 芯 + 朱红小缨（挂在垂根末端） */
function lantern(b: Baker, f: Frame, p: V3, size: number): void {
  const [x, y, z] = P(f, p[0], p[1], p[2]);
  const s = size * f.s;
  b.cyl('metal', 0.05 * s, 0.05 * s, 0.16 * s, 4, x, y + 0.28 * s, z, GOLD_D);
  b.cyl('metal', 0.14 * s, 0.19 * s, 0.1 * s, 6, x, y + 0.19 * s, z, GOLD);
  b.sphere('glow', 0.2 * s, 6, x, y, z, LANTERN, 0, 0, 0, 1.05, 1.2, 1.05);
  b.sphere('glow', 0.13 * s, 5, x, y, z, LANTERN_CORE, 0, 0, 0, 1, 1.1, 1);
  b.cyl('metal', 0.08 * s, 0.05 * s, 0.08 * s, 6, x, y - 0.24 * s, z, GOLD_D);
  b.cyl('fabric', 0.03 * s, 0.04 * s, 0.34 * s, 4, x, y - 0.44 * s, z, TASSEL);
}

// ============ 崖边白玉台 ============
function buildTerrace(b: Baker, f: Frame, seed: number): void {
  const R = 18;
  const nPost = Math.max(18, Math.round((TAU * 17.2) / 2.4));

  // —— 台面：抛光玉盘 + 收分台帮 ——
  const [dx, dy, dz] = P(f, 0, -0.5, 0);
  b.cyl('ash', R, R * 1.012, 1.0 * f.s, 64, dx, dy, dz, JADE_D);
  const [px, py, pz] = P(f, 0, -0.02, 0);
  b.cyl('ash', R * 0.997, R * 0.997, 0.08 * f.s, 64, px, py, pz, JADE_HI);
  const topY = 0.02;

  // 台帮：上枭 / 束腰 / 下枋 / 滴水唇
  for (const [rr, hh, yy, col] of [
    [18.05, 0.5, -1.05, shade(JADE, 0.94)],
    [17.7, 0.34, -1.45, shade(JADE, 0.86)],
    [18.42, 0.26, -1.7, JADE_D],
  ] as [number, number, number, number][]) {
    const [xc, yc, zc] = P(f, 0, yy, 0);
    b.cyl('ash', rr * f.s * 1.0, rr * f.s * 1.03, hh * f.s, 64, xc, yc, zc, col);
  }

  // —— 台面分缝：3 圈同心缝 + 12 道放射缝 + 中心云纹（缝比台面只浅一档，避免读成蜘蛛网） ——
  for (const rr of [6.2, 11.5, 16.1]) {
    const [xc, yc, zc] = P(f, 0, topY + 0.022, 0);
    b.cyl('ash', rr * f.s, rr * f.s, 0.04 * f.s, 72, xc, yc, zc, SEAM, 0, 0, 0, true);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.13;
    lbox(b, f, 'ash', 16.0, 0.035, 0.06, Math.cos(a) * 8.9, topY + 0.022, Math.sin(a) * 8.9, SEAM, a);
  }
  const [mx, my, mz] = P(f, 0, topY + 0.03, 0);
  b.cyl('ash', 3.5 * f.s, 3.5 * f.s, 0.055 * f.s, 32, mx, my, mz, JADE_HI);
  b.cyl('ash', 3.62 * f.s, 3.62 * f.s, 0.06 * f.s, 40, mx, my, mz, SEAM_D, 0, 0, 0, true);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    const p = P(f, Math.cos(a) * 1.35, topY + 0.075, Math.sin(a) * 1.0);
    b.sphere('ash', (0.85 - i * 0.05) * f.s, 6, p[0], p[1], p[2], shade(JADE, 1.03), a, 0, 0, 1.35, 0.4, 0.8);
  }
  // 台面云纹：外圈 8 组浅浮雕如意云（近看有内容，远看只是微凹凸）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.19;
    const bx = Math.cos(a) * 8.4, bz = Math.sin(a) * 8.4;
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * 1.15;
      const px = bx + Math.cos(a + Math.PI / 2) * off;
      const pz = bz + Math.sin(a + Math.PI / 2) * off;
      const p = P(f, px, topY + 0.06, pz);
      b.sphere('ash', (0.5 + Math.abs(k - 1) * -0.12 + 0.12) * f.s, 5, p[0], p[1], p[2],
        k === 1 ? JADE_HI : shade(JADE, 0.99), a, 0, 0, 1.6, 0.22, 0.8);
    }
  }

  // —— 望柱 + 栏板（望柱距 2.4m、通高 1.2m、柱头仰莲包金） ——
  const RP = 17.2;
  const chord = 2 * RP * Math.sin(Math.PI / nPost);
  for (let i = 0; i < nPost; i++) {
    const am = (i / nPost) * TAU;
    const cx = Math.cos(am) * RP, cz = Math.sin(am) * RP;
    const ryT = am + Math.PI / 2;

    // 望柱：础 / 柱身 / 柱帽 / 仰莲包金
    lbox(b, f, 'ash', 0.5, 0.2, 0.5, cx, 0.1, cz, JADE_D, -am);
    lbox(b, f, 'ash', 0.36, 0.66, 0.36, cx, 0.52, cz, JADE, -am);
    lbox(b, f, 'ash', 0.48, 0.1, 0.48, cx, 0.9, cz, JADE_HI, -am);
    const [gx, gy, gz] = P(f, cx, 0.965, cz);
    b.cyl('wood', 0.19 * f.s, 0.175 * f.s, 0.05 * f.s, 8, gx, gy, gz, GOLD);
    for (let k = 0; k < 6; k++) {
      const a2 = am + (k / 6) * TAU + 0.26;
      const lx = cx + Math.cos(a2) * 0.155, lz = cz + Math.sin(a2) * 0.155;
      const p = P(f, lx, 1.005, lz);
      b.sphere('ash', 0.15 * f.s, 5, p[0], p[1], p[2], k % 2 ? JADE_HI : JADE, a2, 0, 0, 0.78, 0.95, 0.55);
    }
    const [ux, uy, uz] = P(f, cx, 1.04, cz);
    b.sphere('ash', 0.13 * f.s, 6, ux, uy, uz, JADE_HI, 0, 0, 0, 0.85, 1.25, 0.85);

    // 栏板：地栿 / 板身 / 寻杖 + 板面两道阴刻云纹
    const am2 = am + Math.PI / nPost;
    const mx2 = Math.cos(am2) * RP, mz2 = Math.sin(am2) * RP;
    lbox(b, f, 'ash', chord * 1.0, 0.17, 0.16, mx2, 0.27, mz2, JADE_D, ryT);
    lbox(b, f, 'ash', chord * 0.95, 0.42, 0.1, mx2, 0.55, mz2, shade(JADE, 0.985), ryT);
    lbox(b, f, 'ash', chord * 1.02, 0.15, 0.18, mx2, 0.835, mz2, JADE_HI, ryT);
    for (let k = 0; k < 2; k++) {
      const yy2 = 0.47 + k * 0.15;
      const lx = mx2 + Math.cos(am2) * 0.062;
      const lz = mz2 + Math.sin(am2) * 0.062;
      lbox(b, f, 'ash', chord * 0.8, 0.028, 0.014, lx, yy2, lz, SEAM_D, ryT);
    }
  }

  // —— 台下：6 层收分岩体（低边数出多边形轮廓；每层出檐 0.3m 读作岩层） ——
  const layers: [number, number, number, number, number, number, number][] = [
    // rTop, rBot, h, yCenter, xOff, zOff, seg
    [17.7, 17.2, 3.0, -2.3, 0.15, 0.0, 12],
    [17.2, 15.6, 3.8, -5.9, 0.5, 0.2, 11],
    [15.2, 12.8, 4.8, -10.2, 0.9, 0.4, 10],
    [12.4, 9.6, 5.2, -15.2, 1.2, 0.6, 9],
    [9.2, 6.4, 5.6, -20.6, 1.0, 0.5, 9],
    [6.0, 3.2, 5.2, -25.7, 0.7, 0.4, 8],
  ];
  for (let i = 0; i < layers.length; i++) {
    const [rt, rb, hh, yy, ox, oz, seg] = layers[i];
    const p = P(f, ox, yy, oz);
    b.cyl('ash', rt * f.s, rb * f.s, hh * f.s, seg, p[0], p[1], p[2],
      shade(i % 3 === 0 ? ROCK : i % 3 === 1 ? ROCK_D : ROCK_DD, 0.97 + (i % 2) * 0.06), (i * 17.3) % TAU);
    // 层间出檐：亮一档的窄岩带 + 檐下一道暗缝，远看是沉积层理
    if (i < layers.length - 1) {
      const yb = yy - hh * 0.5;
      const p2 = P(f, ox + 0.12, yb, oz + 0.12);
      b.cyl('ash', (rb + 0.52) * f.s, (rb + 0.34) * f.s, 0.5 * f.s, seg, p2[0], p2[1], p2[2],
        shade(ROCK_L, 0.96 + (i % 2) * 0.1), (i * 31.7) % TAU);
      const p3 = P(f, ox + 0.12, yb - 0.42, oz + 0.12);
      b.cyl('ash', (rb + 0.3) * f.s, (rb + 0.22) * f.s, 0.22 * f.s, seg, p3[0], p3[1], p3[2],
        ROCK_DD, (i * 31.7) % TAU);
    }
  }
  // 外挑岩肩：把平台悬在崖外的一侧垫住（3 块大岩板）
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.55;
    lbox(b, f, 'ash', 6.2, 1.5, 4.4, Math.cos(a) * 15.3, -3.0 - i * 2.2, Math.sin(a) * 15.3,
      shade(ROCK, 0.92 + i * 0.05), -a, 0.12, 0.18);
  }
  // 层沿大岩：每层外缘再压 2 块，破掉“叠饼”轮廓
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.7;
    const t = (i % 5) / 4;
    const yy = -3.4 - t * 14.2;
    const rr = lerp(16.4, 9.0, t) + 0.6;
    const p = P(f, Math.cos(a) * rr, yy, Math.sin(a) * rr);
    b.sphere('ash', (1.2 + hash(i, seed + 71.3) * 1.2) * f.s, 6, p[0], p[1], p[2],
      shade(i % 2 ? ROCK_L : ROCK, 0.9 + hash(i, seed + 72.7) * 0.14), a, 0.3, 0.2, 1.35, 0.72, 1.0);
  }

  // 外露岩块（沿台缘一圈不规则岩层）+ 苔 + 垂草
  const nRock = 26;
  for (let i = 0; i < nRock; i++) {
    const a = (i / nRock) * TAU + (hash(i, seed + 4.1) - 0.5) * 0.26;
    const t = hash(i, seed + 6.7);
    const rr = lerp(17.2, 8.4, t) - 0.4;
    const yy = -1.6 - t * 15.2;
    const sz = 1.7 + hash(i, seed + 7.9) * 2.0;
    const p = P(f, Math.cos(a) * rr, yy, Math.sin(a) * rr);
    b.sphere('ash', sz * f.s, 5 + (i % 2), p[0], p[1], p[2],
      shade(i % 4 === 0 ? ROCK_L : i % 4 === 1 ? ROCK : i % 4 === 2 ? ROCK_D : shade(ROCK, 1.08), 0.9 + hash(i, 9.1) * 0.2),
      a, 0.2, 0.15, 1.55, 0.62, 1.0);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.21;
    const rr = 15.8 + hash(i, seed + 11.3) * 1.9;
    const yy = -1.2 + hash(i, seed + 12.7) * 0.8;
    const p = P(f, Math.cos(a) * rr, yy, Math.sin(a) * rr);
    b.sphere('leaf', (0.9 + hash(i, seed + 13.9) * 0.8) * f.s, 5, p[0], p[1], p[2], MOSS, a, 0, 0, 1.4, 0.3, 1.0);
  }
  const nGrass = 40;
  for (let i = 0; i < nGrass; i++) {
    const a = (i / nGrass) * TAU + hash(i, seed + 14.3) * 0.1;
    const t = hash(i, seed + 15.7);
    const rr = lerp(17.0, 8.8, t);
    const len = (1.6 + hash(i, seed + 16.1) * 4.2) * f.s;
    const p = P(f, Math.cos(a) * rr, -1.6 - t * 14.5, Math.sin(a) * rr);
    b.cyl('leaf', 0.05 * f.s, 0.09 * f.s, len, 4, p[0], p[1] - len * 0.5, p[2],
      i % 3 === 0 ? GRASS : shade(GRASS, 0.82), a, 0, 0);
  }
  // 台沿石托（20 个，压住岩与玉的接缝）
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    lbox(b, f, 'ash', 0.72, 0.8, 0.7, Math.cos(a) * 17.15, -1.85, Math.sin(a) * 17.15, JADE_DD, -a);
  }

  b.kit('heavenPine.terrace', 1, f.y);
}

// ============ 虬曲古松 ============
function buildPine(b: Baker, f: Frame, seed: number): void {
  const base: V3 = [-4.4, 0.03, 2.2];
  const tp = (lx: number, ly: number, lz: number): V3 => [base[0] + lx, base[1] + ly, base[2] + lz];

  // 主干 13 节点：先向崖外探 3.1m，再回折 -3.1m，顶部再回 +1 —— S 形虬曲
  const nodes: V3[] = [
    tp(0, 0, 0), tp(0.9, 1.9, 0.4), tp(2.1, 3.8, 0.8), tp(2.9, 5.7, 0.4),
    tp(3.1, 7.6, -0.6), tp(2.6, 9.5, -1.7), tp(1.2, 11.2, -2.3), tp(-0.7, 12.8, -2.1),
    tp(-2.3, 14.3, -1.2), tp(-3.1, 15.8, 0.2), tp(-3.0, 17.2, 1.5), tp(-2.2, 18.5, 2.4),
    tp(-1.5, 19.6, 2.6), tp(-1.0, 20.6, 2.2),
  ];
  const radii = [1.62, 1.52, 1.42, 1.32, 1.22, 1.1, 0.98, 0.86, 0.74, 0.62, 0.5, 0.4, 0.31, 0.24];
  const world = nodes.map((p) => P(f, p[0], p[1], p[2]));

  for (let i = 0; i < world.length - 1; i++) {
    const a = world[i], c = world[i + 1];
    const r0 = radii[i] * f.s, r1 = radii[i + 1] * f.s;
    rod(b, 'trunk', a, c, r0, r1, 7, shade(BARK, 0.95 + (i % 2) * 0.06));
    // 每一节 3 道深浅交替窄环 = 鳞片（深/浅/深，半径出挑 9%）
    const bands: [number, number][] = [[0.2, BARK_D], [0.5, BARK_LL], [0.8, BARK_D]];
    for (const [bt, bc] of bands) {
      band(b, 'trunk', a, c, bt, lerp(r0, r1, bt) * 1.09,
        (0.17 + (bt === 0.5 ? 0.06 : 0)) * f.s, bc);
    }
    if (i > 0) {
      b.sphere('trunk', r0 * 1.02, 6, a[0], a[1], a[2], shade(BARK, 0.93));
    }
  }
  // 树瘤：沿主干 7 处凸起的鳞疤，破掉“光杆缠带”的读数
  for (let i = 0; i < 7; i++) {
    const seg = 1 + (i % 8);
    const t = 0.25 + ((i * 0.17) % 0.55);
    const a0 = world[seg], c0 = world[seg + 1];
    const ang = i * 2.37 + 0.5;
    const rr = radii[seg] * f.s * 0.92;
    const px = lerp(a0[0], c0[0], t) + Math.cos(ang) * rr;
    const py = lerp(a0[1], c0[1], t);
    const pz = lerp(a0[2], c0[2], t) + Math.sin(ang) * rr;
    b.sphere('trunk', (0.34 + hash(i, seed + 81.3) * 0.22) * f.s, 5, px, py, pz,
      i % 2 ? BARK_LL : BARK_L, ang, 0.2, 0.15, 1.25, 0.8, 0.62);
  }
  // 基部瘤块 / 板根
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.35;
    const p0 = P(f, base[0] + Math.cos(a) * 0.75, 0.35, base[2] + Math.sin(a) * 0.75);
    const p1 = P(f, base[0] + Math.cos(a) * (3.0 + hash(i, seed) * 1.2), 0.02, base[2] + Math.sin(a) * (3.0 + hash(i, seed) * 1.2));
    rod(b, 'trunk', p0, p1, 0.55 * f.s, 0.16 * f.s, 5, i % 2 ? BARK_D : BARK);
    band(b, 'trunk', p0, p1, 0.45, 0.34 * f.s, 0.16 * f.s, BARK_L, 5);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 1.1;
    const p = P(f, base[0] + Math.cos(a) * 1.5, 0.55, base[2] + Math.sin(a) * 1.5);
    b.sphere('trunk', (0.55 + hash(i, seed + 2.1) * 0.3) * f.s, 6, p[0], p[1], p[2], BARK_D, a, 0, 0, 1.2, 0.8, 1.0);
  }

  // —— 枝：起点 / 方向 / 长 / 垂 / 横摆 / 半径 ——
  interface Branch { start: V3; dir: V3; len: number; droop: number; wob: number; r0: number; r1: number; pads: [number, number][]; arch?: number; }
  const mains: Branch[] = [
    // 主横枝：探出崖外 21m，中段微微拱起再下垂，末端低于台面
    { start: tp(-2.2, 14.2, -1.25), dir: [0.995, -0.05, 0.09], len: 46, droop: 9.0, wob: 2.4, arch: 2.4, r0: 1.02, r1: 0.14, pads: [[0.3, 2.4], [0.4, 2.6], [0.49, 2.8], [0.57, 2.8], [0.65, 2.7], [0.73, 2.6], [0.81, 2.4], [0.89, 2.2], [0.96, 1.9], [1.0, 1.5]] },
    // 第二条大枝：沿台缘斜出
    { start: tp(2.7, 7.9, -0.5), dir: [0.6, 0.17, -0.78], len: 27, droop: 5.6, wob: 1.8, arch: 1.6, r0: 0.8, r1: 0.13, pads: [[0.44, 2.1], [0.55, 2.2], [0.66, 2.2], [0.77, 2.1], [0.88, 1.9], [0.96, 1.6]] },
    // 低垂枝：扫过台缘
    { start: tp(2.5, 6.3, 0.35), dir: [0.92, 0.04, 0.39], len: 17, droop: 5.2, wob: 1.2, r0: 0.62, r1: 0.1, pads: [[0.5, 1.9], [0.65, 2.0], [0.8, 1.9], [0.93, 1.6]] },
    // 第三条大枝：向 +z 斜出，撑开侧向冠幅
    { start: tp(-1.0, 11.4, -0.4), dir: [0.5, 0.14, 0.85], len: 21, droop: 4.4, wob: 1.6, arch: 1.2, r0: 0.6, r1: 0.1, pads: [[0.42, 2.0], [0.58, 2.1], [0.74, 2.0], [0.9, 1.7]] },
  ];
  const uppers: Branch[] = [
    { start: tp(-2.9, 16.3, 0.4), dir: [-0.18, 0.82, 0.54], len: 9, droop: 1.2, wob: 0.5, r0: 0.36, r1: 0.08, pads: [[0.5, 1.7], [0.75, 1.6], [0.95, 1.3]] },
    { start: tp(-2.6, 17.5, 1.2), dir: [0.55, 0.76, -0.34], len: 10, droop: 1.4, wob: 0.6, r0: 0.33, r1: 0.08, pads: [[0.5, 1.6], [0.75, 1.5], [0.95, 1.2]] },
    { start: tp(-1.6, 19.1, 2.3), dir: [0.12, 0.86, 0.5], len: 7, droop: 0.8, wob: 0.4, r0: 0.25, r1: 0.06, pads: [[0.55, 1.4], [0.85, 1.3]] },
    { start: tp(-1.0, 19.9, 2.2), dir: [-0.46, 0.8, 0.39], len: 6.5, droop: 0.9, wob: 0.4, r0: 0.22, r1: 0.06, pads: [[0.6, 1.3], [0.9, 1.1]] },
  ];

  const drawBranch = (br: Branch, bi: number): V3[] => {
    const d: V3 = [br.dir[0], br.dir[1], br.dir[2]];
    const dl = Math.hypot(d[0], d[1], d[2]);
    d[0] /= dl; d[1] /= dl; d[2] /= dl;
    const n = 4;
    const arch = br.arch ?? 0;
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wob = Math.sin(t * 2.8 + hash(seed + bi, 21.7) * 6.28) * br.wob;
      pts.push([
        br.start[0] + d[0] * br.len * t - d[2] * wob,
        br.start[1] + d[1] * br.len * t - br.droop * t * t + arch * Math.sin(t * Math.PI),
        br.start[2] + d[2] * br.len * t + d[0] * wob,
      ]);
    }
    for (let i = 0; i < n; i++) {
      const r0 = lerp(br.r0, br.r1, i / n) * f.s;
      const r1 = lerp(br.r0, br.r1, (i + 1) / n) * f.s;
      const a = P(f, pts[i][0], pts[i][1], pts[i][2]);
      const c = P(f, pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
      rod(b, 'trunk', a, c, r0, r1, 6, shade(BARK, 0.94 + (i % 2) * 0.05));
      if (i === 0) b.sphere('trunk', r0 * 1.05, 6, a[0], a[1], a[2], BARK_D);
      if (i === 1) band(b, 'trunk', a, c, 0.5, r0 * 1.06, 0.14 * f.s, BARK_LL);
    }
    // 团簇针叶
    for (let k = 0; k < br.pads.length; k++) {
      const [t, r] = br.pads[k];
      const fi = clamp(t, 0, 1) * n;
      const i0 = Math.min(n - 1, Math.floor(fi));
      const ft = fi - i0;
      const p: V3 = [
        lerp(pts[i0][0], pts[i0 + 1][0], ft) + (hash(k, bi + 8.3) - 0.5) * 1.6,
        lerp(pts[i0][1], pts[i0 + 1][1], ft) + (k % 3 === 0 ? 1.15 : k % 3 === 1 ? -0.55 : 0.5),
        lerp(pts[i0][2], pts[i0 + 1][2], ft) + (hash(k, bi + 9.7) - 0.5) * 1.6,
      ];
      needlePad(b, f, p, r * 0.7, seed + bi * 17 + k * 3.1, 0.94 + (k / br.pads.length) * 0.18);
      // 上下再叠 1 团（错开 1–2m），把“糖葫芦”读成有厚度的枝盘
      if (k % 2 === 0) {
        needlePad(b, f, [p[0] + 1.2, p[1] - 1.5, p[2] + 0.9], r * 0.45, seed + bi * 23 + k * 4.3, 0.86);
      } else if (k % 3 === 1) {
        needlePad(b, f, [p[0] - 0.6, p[1] + 1.5, p[2] - 1.0], r * 0.41, seed + bi * 29 + k * 5.1, 1.04);
      }
    }
    return pts;
  };

  const mainPts = drawBranch(mains[0], 0);
  drawBranch(mains[1], 1);
  drawBranch(mains[2], 2);
  drawBranch(mains[3], 3);
  for (const br of uppers) drawBranch(br, 3 + uppers.indexOf(br));

  // 主横枝上的侧枝（一部分上翘、一部分下探）
  const side = (t: number, dir: V3, len: number, droop: number, r0: number, pads: [number, number][], bi: number): void => {
    const fi = t * 4;
    const i0 = Math.min(3, Math.floor(fi));
    const ft = fi - i0;
    const st: V3 = [
      lerp(mainPts[i0][0], mainPts[i0 + 1][0], ft),
      lerp(mainPts[i0][1], mainPts[i0 + 1][1], ft) - 0.3,
      lerp(mainPts[i0][2], mainPts[i0 + 1][2], ft),
    ];
    drawBranch({ start: st, dir, len, droop, wob: 0.5, r0, r1: 0.07, pads }, bi);
  };
  side(0.52, [0.4, 0.62, -0.68], 16, 2.4, 0.42, [[0.42, 1.9], [0.66, 2.0], [0.88, 1.8]], 10);
  side(0.74, [-0.2, 0.62, 0.76], 7.5, 1.4, 0.3, [[0.62, 1.45], [0.95, 1.2]], 11);
  side(0.9, [0.45, 0.6, -0.65], 6, 1.0, 0.24, [[0.8, 1.15]], 12);
  side(0.66, [0.7, -0.6, 0.25], 5, 2.2, 0.16, [], 13);

  // 冠顶团
  needlePad(b, f, tp(-1.4, 21.4, 2.3), 1.75, seed + 31, 1.06);
  needlePad(b, f, tp(-0.2, 21.9, 1.6), 1.45, seed + 37, 1.1);
  needlePad(b, f, tp(-2.9, 20.4, 1.0), 1.35, seed + 41, 0.98);
  needlePad(b, f, tp(-2.2, 20.7, 1.4), 1.85, seed + 43, 1.0);
  needlePad(b, f, tp(-0.6, 22.4, 2.6), 1.55, seed + 47, 1.08);

  // —— 垂根 / 藤萝 + 宫灯 ——
  const nRoot = 18;
  for (let i = 0; i < nRoot; i++) {
    const t = 0.14 + (i / (nRoot - 1)) * 0.86 + (hash(i, seed + 50.3) - 0.5) * 0.03;
    const fi = t * 4;
    const i0 = Math.min(3, Math.floor(fi));
    const ft = fi - i0;
    const sx = lerp(mainPts[i0][0], mainPts[i0 + 1][0], ft);
    const sy = lerp(mainPts[i0][1], mainPts[i0 + 1][1], ft) - 0.45;
    const sz = lerp(mainPts[i0][2], mainPts[i0 + 1][2], ft);
    const overVoid = sx > 18.4;
    const len = (overVoid ? 6.5 : 3.0) + hash(i, seed + 51.3) * (overVoid ? 7.5 : 3.0);
    const sway = (hash(i, seed + 52.7) - 0.5) * 1.6;
    const a = P(f, sx, sy, sz);
    const m = P(f, sx + sway * 0.4, sy - len * 0.5, sz + sway);
    const c = P(f, sx + sway, sy - len, sz + sway * 1.6);
    const rr0 = (0.055 + hash(i, seed + 53.9) * 0.035) * f.s;
    rod(b, 'trunk', a, m, rr0, rr0 * 0.7, 4, i % 3 === 0 ? BARK_D : shade(BARK, 0.82));
    rod(b, 'trunk', m, c, rr0 * 0.7, rr0 * 0.4, 4, BARK_D);
    // 宫灯：只挂在崖外段，避免灯悬在台面上
    if (overVoid && i % 2 === 1) {
      lantern(b, f, [sx + sway, sy - len - 0.15, sz + sway * 1.6], 0.95 + hash(i, seed + 57.7) * 0.35);
    }
  }
  // 第二枝再挂 3 盏
  for (let i = 0; i < 3; i++) {
    const t = 0.55 + i * 0.15;
    const br = mains[1];
    const dl = Math.hypot(br.dir[0], br.dir[1], br.dir[2]);
    const px = br.start[0] + (br.dir[0] / dl) * br.len * t;
    const py = br.start[1] + (br.dir[1] / dl) * br.len * t - br.droop * t * t;
    const pz = br.start[2] + (br.dir[2] / dl) * br.len * t;
    const len = 4.5 + i * 1.8;
    const a = P(f, px, py - 0.4, pz);
    const c = P(f, px + 0.4, py - 0.4 - len, pz - 0.5);
    rod(b, 'trunk', a, c, 0.06 * f.s, 0.04 * f.s, 4, BARK_D);
    lantern(b, f, [px + 0.4, py - 0.4 - len - 0.1, pz - 0.5], 0.85);
  }

  // 树基：3 块半埋的岩 + 苔，压住板根与台面的接缝
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.7;
    const p = P(f, base[0] + Math.cos(a) * 2.0, 0.28, base[2] + Math.sin(a) * 2.0);
    b.sphere('ash', (1.1 + hash(i, seed + 64.7) * 0.7) * f.s, 5, p[0], p[1], p[2],
      shade(i % 2 ? ROCK_L : ROCK, 0.96), a, 0.1, 0.1, 1.5, 0.34, 1.0);
  }
  // 树基苔痕
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.2;
    const p = P(f, base[0] + Math.cos(a) * (1.6 + hash(i, seed + 61.1) * 1.4), 0.06, base[2] + Math.sin(a) * (1.6 + hash(i, seed + 61.1) * 1.4));
    b.sphere('leaf', (0.5 + hash(i, seed + 62.3) * 0.4) * f.s, 5, p[0], p[1], p[2], MOSS_D, a, 0, 0, 1.3, 0.22, 0.9);
  }

  b.kit('heavenPine.tree', 1, f.y);
}

/** 单处：台 + 松（落位点的岩体也在这里，供两处小尺度复用） */
function buildSite(b: Baker, s: HeavenPineSite): void {
  const f: Frame = { x: s.x, y: s.deckY, z: s.z, rot: s.rot, s: s.scale };
  buildTerrace(b, f, s.seed);
  buildPine(b, f, s.seed);
}

/** 天宫崖边古松 + 白玉台：3 处（主台 + 2 处小尺度）。 */
export function buildHeavenPines(b: Baker): void {
  for (const s of HEAVEN_PINE_SITES) buildSite(b, s);
}
