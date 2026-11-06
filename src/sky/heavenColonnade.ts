import { Baker, shade } from '../city/bake';

/**
 * 天宫白玉柱廊 / 回廊立面（参考图 R1「弧形回廊内景」、R3「白玉柱廊街道」、R4「弧形柱廊」）。
 *
 * 目标形制（逐条对照参考图）：
 *   - 巨型汉白玉檐柱：柱径 1.2m、柱高 12m、柱距 4m；柱身带竖向凹槽（flute），
 *     柱头为仰莲 + 金箍，柱础为覆莲须弥座（两级，下宽上窄）
 *   - 檐下密排斗栱：每开间 2 攒，金地朱线，斗栱层高 1.8m
 *   - 额枋 / 平板枋：深朱红底 + 金线 + 青玺彩画分段（交替色块）
 *   - 栏板与望柱：汉白玉，望柱头为仰莲包金，柱距 2.4m，两道寻杖
 *   - 地面：深色抛光石，横向浅色石缝 + 竖向反光条
 *
 * 落位：御道两侧双列柱廊。**缩放前坐标**（调用方 scaleHeavenGeometry 再 ×2.2）。
 *   斗法云台台面 206.12（不是 214——214 是凌霄宫台；两者之间没有连续台面），
 *   柱列 x=±23.8、z=-32…+32（17 根/列，柱距 4m）。再往外就出了云台 r=42.46 的铺装边，
 *   会悬空，故不取到 z=±70；柱高 12m 已足以读成巨柱（世界 26.4m）。
 *   御道 z 向贯通 64m、宽 12m，两侧柱廊各带 7.6m 宽柱础条石与外缘栏板。
 */
export function buildHeavenColonnade(b: Baker): void {
  buildFloor(b);
  for (const sgn of [-1, 1]) {
    stylobate(b, sgn);
    for (let i = 0; i < NCOL; i++) column(b, sgn * COL_X, Z0 + i * BAY);
    entablature(b, sgn);
    for (let i = 0; i < NCOL - 1; i++) {
      for (const dz of [1, 3]) dougong(b, sgn * COL_X, Z0 + i * BAY + dz);
    }
    canopy(b, sgn);
    balustrade(b, sgn);
  }
  b.kit('heaven.colonnade', NCOL * 2, STYLO);
  b.kit('heaven.colonnade.dougong', (NCOL - 1) * 4, Y_DG);
  b.kit('heaven.colonnade.rail', 27 * 2, STYLO);
}

// ============ 台面标高（缩放前，米） ============
const DECK = 206.12;            // 斗法云台台面砖顶
const PAVE = DECK + 0.14;       // 铺装顶
const STYLO = PAVE + 0.48;      // 柱础条石顶 = 柱脚
const COL_X = 23.8;             // 柱列中心
const WALK_IN = 20.0;
const WALK_OUT = 27.6;
const Z0 = -32;
const Z1 = 32;
const BAY = 4;
const NCOL = 17;
const COL_H = 12;
const Y_TOP = STYLO + COL_H;    // 218.74 柱头
const Y_DG = Y_TOP + 1.31;      // 220.05 平板枋顶 = 斗栱底
const LEN = 64.8;               // 额枋/屋面通长（z ±32.4）

// ============ 调色板 ============
const JADE = 0xd2cabb;
const JADE_HI = shade(JADE, 1.07);
const JADE_D = shade(JADE, 0.8);
const FLUTE = shade(JADE, 0.58);
const GOLD = 0xe0b45c;
const GOLD_HI = shade(GOLD, 1.16);
const GOLD_D = shade(GOLD, 0.62);
const RED = 0xa6321e;
const RED_D = shade(RED, 0.66);
const PAINT_C = 0x2f7f86;
const PAINT_G = 0x3c8a63;
const PAINT_B = 0x33639b;
const PAINTS = [PAINT_C, PAINT_G, PAINT_B];
const FLOOR = 0x17191f;
const FLOOR_D = 0x101216;
const FLOOR_HI = 0x2b3340;
const JOINT = 0x6e6c62;
const SOFFIT = 0x2a1d14;
const TILE = 0x2b333a;

// ============ 地面：深色抛光石 + 石缝 + 反光条 ============
function buildFloor(b: Baker): void {
  // 铺装主体：暗石（ash 无清漆，避免低角度把整片地面反成白板）
  b.box('ash', WALK_IN * 2, 0.14, Z1 - Z0, 0, DECK + 0.07, 0, FLOOR);
  // 大块深浅差（避免整片死黑）
  for (let i = 0; i < 8; i++) {
    const px = -16 + (i % 4) * 11;
    const pz = -22 + Math.floor(i / 4) * 24;
    b.box('ash', 8.4, 0.006, 13.5, px, PAVE + 0.003, pz, shade(FLOOR, i % 2 ? 0.82 : 1.22));
  }
  // 横向石缝（每 3.2m 一道，浅灰）
  for (let z = Z0 + 3.2; z < Z1; z += 3.2) {
    b.box('ash', WALK_IN * 2 - 0.4, 0.012, 0.10, 0, PAVE + 0.006, z, shade(JOINT, 0.9));
  }
  // 纵向石缝（每 3m 一道）
  for (let x = -18; x <= 18; x += 3) {
    if (Math.abs(x) < 6.4) continue;
    b.box('ash', 0.09, 0.012, Z1 - Z0 - 0.4, x, PAVE + 0.006, 0, shade(JOINT, 0.68));
  }
  // 御道：12m 宽、贯通 64m，比两侧再深一档，压边金线
  b.box('ash', 12, 0.02, Z1 - Z0, 0, PAVE + 0.01, 0, FLOOR_D);
  for (const s of [-1, 1]) {
    b.box('wood', 0.10, 0.012, Z1 - Z0, s * 5.9, PAVE + 0.021, 0, shade(GOLD, 0.82));
    b.box('ash', 0.5, 0.008, Z1 - Z0, s * 6.6, PAVE + 0.016, 0, shade(JOINT, 0.5));
  }
  // 竖向反光条（沿行走方向），用浅灰石条模拟反光，不用清漆面（否则低角度整条炸白）
  const xs = [-19.2, -16.0, -12.4, -8.6, 8.6, 12.4, 16.0, 19.2];
  for (let k = 0; k < xs.length; k++) {
    for (let j = 0; j < 5; j++) {
      const z = Z0 + 6 + j * 12 + (k % 2) * 3;
      const l = 6.5 + ((k + j) % 3) * 1.6;
      b.box('ash', 0.62 + (k % 3) * 0.18, 0.01, l, xs[k], PAVE + 0.005, z, shade(FLOOR_HI, 1.18 + (j % 2) * 0.24));
    }
  }
  // 御道中轴：断续的浅色反光段（不铺通长，否则读成一条浅色地毯）
  for (let j = 0; j < 6; j++) {
    const z = Z0 + 4 + j * 11;
    b.box('ash', 0.9, 0.008, 7.5 + (j % 3) * 2, 0, PAVE + 0.03, z, shade(FLOOR_HI, 1.3));
  }
}

// ============ 柱础条石（台明） ============
function stylobate(b: Baker, sgn: number): void {
  const x = sgn * COL_X;
  b.box('ash', WALK_OUT - WALK_IN, STYLO - DECK, Z1 - Z0 + 0.4, x, (DECK + STYLO) / 2, 0, shade(JADE_D, 0.9));
  b.box('ash', WALK_OUT - WALK_IN + 0.04, 0.05, Z1 - Z0 + 0.44, x, STYLO - 0.025, 0, JADE);
  // 内缘一级踏步
  b.box('ash', 0.95, 0.24, Z1 - Z0 + 0.4, sgn * (WALK_IN - 0.475), PAVE + 0.12, 0, JADE_D);
  // 外缘压边（云台边）
  b.box('ash', 0.26, 0.12, Z1 - Z0 + 0.4, sgn * (WALK_OUT + 0.12), STYLO - 0.06, 0, JADE_HI);
  // 廊内深色抛光石地面（外缘留 0.6m 白玉压边，内缘留 0.15m）
  const fw = WALK_OUT - WALK_IN - 0.75;
  b.box('ash', fw, 0.05, Z1 - Z0 + 0.2, sgn * (WALK_IN + 0.15 + fw / 2), STYLO + 0.025, 0, shade(FLOOR, 1.05));
  for (let z = Z0 + 2.4; z < Z1; z += 3.2) {
    b.box('ash', fw - 0.2, 0.012, 0.09, sgn * (WALK_IN + 0.15 + fw / 2), STYLO + 0.052, z, shade(JOINT, 0.62));
  }
  b.box('ash', 0.7, 0.008, Z1 - Z0 - 6, sgn * (COL_X + 1.4), STYLO + 0.053, 0, shade(FLOOR_HI, 1.2));
}

// ============ 檐柱：12m 白玉凹槽巨柱 ============
function column(b: Baker, cx: number, cz: number): void {
  const y = STYLO;
  // 柱础：两级须弥座，下宽上窄
  b.box('ash', 2.80, 0.36, 2.80, cx, y + 0.18, cz, JADE_D);
  b.box('ash', 2.34, 0.34, 2.34, cx, y + 0.53, cz, JADE);
  // 覆莲座
  b.cyl('ash', 0.92, 1.10, 0.20, 18, cx, y + 0.80, cz, JADE_HI);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.12;
    b.sphere('ash', 0.27, 6, cx + Math.cos(a) * 0.94, y + 0.84, cz + Math.sin(a) * 0.94, JADE_HI, -a, 0, 0, 1, 0.42, 0.6);
  }
  // 柱身（下粗上细，收分 4.5cm）
  const sh = 9.49;
  b.cyl('ash', 0.600, 0.645, sh, 20, cx, y + 1.0 + sh / 2, cz, JADE);
  // 8 道竖向凹槽 + 8 道棱
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('ash', 0.11, sh - 0.45, 0.07, cx + Math.cos(a) * 0.605, y + 1.0 + sh / 2, cz + Math.sin(a) * 0.605, FLUTE, -a);
    const a2 = a + Math.PI / 8;
    b.box('ash', 0.15, sh - 0.45, 0.05, cx + Math.cos(a2) * 0.610, y + 1.0 + sh / 2, cz + Math.sin(a2) * 0.610, JADE_HI, -a2);
  }
  // 金箍
  b.cyl('wood', 0.665, 0.665, 0.26, 20, cx, y + 10.62, cz, GOLD);
  b.cyl('wood', 0.672, 0.672, 0.05, 20, cx, y + 10.62, cz, GOLD_HI);
  // 柱头仰莲
  const cy = y + 10.75;
  b.cyl('ash', 0.72, 0.90, 0.20, 18, cx, cy + 0.10, cz, JADE_HI);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.sphere('ash', 0.27, 6, cx + Math.cos(a) * 0.72, cy + 0.32, cz + Math.sin(a) * 0.72, JADE_HI, -a, 0, 0, 0.55, 0.95, 0.5);
  }
  b.cyl('ash', 0.70, 0.70, 0.10, 18, cx, cy + 0.61, cz, JADE);
  // 顶板 + 小斗
  b.box('ash', 1.50, 0.30, 1.50, cx, cy + 0.81, cz, JADE_D);
  b.box('wood', 1.30, 0.29, 1.30, cx, cy + 1.105, cz, RED_D);
  b.box('wood', 1.36, 0.05, 1.36, cx, cy + 1.25, cz, GOLD_D);
}

// ============ 额枋 / 平板枋 / 和玺彩画 ============
function entablature(b: Baker, sgn: number): void {
  const x = sgn * COL_X;
  // 额枋（深朱红）+ 上下金线
  b.box('wood', 0.82, 0.96, LEN, x, Y_TOP + 0.48, 0, RED_D);
  for (const f of [-1, 1]) {
    const fx = x + f * 0.43;
    b.box('wood', 0.05, 0.09, LEN, fx, Y_TOP + 0.09, 0, GOLD);
    b.box('wood', 0.05, 0.09, LEN, fx, Y_TOP + 0.87, 0, GOLD);
    // 和玺彩画：青/绿/蓝交替色块，块间金线
    for (let i = 0; i < 32; i++) {
      const z = Z0 + 1 + i * 2;
      b.box('wood', 0.05, 0.64, 1.62, fx, Y_TOP + 0.48, z, PAINTS[i % 3]);
      b.box('wood', 0.055, 0.68, 0.10, fx, Y_TOP + 0.48, z + 0.95, GOLD_D);
    }
  }
  // 平板枋（承斗栱）
  b.box('wood', 1.16, 0.35, LEN, x, Y_TOP + 1.135, 0, RED);
  b.box('wood', 1.22, 0.06, LEN, x, Y_TOP + 1.34, 0, GOLD_D);
  // 挑檐枋（斗栱外跳上通长）
  const ex = x + sgn * 2.0;
  b.box('wood', 0.46, 0.40, LEN, ex, Y_DG + 2.0, 0, RED_D);
  b.box('wood', 0.50, 0.07, LEN, ex, Y_DG + 1.83, 0, GOLD);
}

// ============ 斗栱：每攒 = 栌斗 + 三层出挑栱 ============
function dougong(b: Baker, cx: number, cz: number): void {
  const s = Math.sign(cx);
  const y = Y_DG;
  const bkt = shade(GOLD, 1.1);
  // 栌斗
  b.box('wood', 0.66, 0.42, 0.66, cx, y + 0.21, cz, GOLD);
  b.box('wood', 0.70, 0.06, 0.70, cx, y + 0.42, cz, GOLD_HI);
  // 一跳华栱（外长内短）
  b.box('wood', 2.00, 0.28, 0.30, cx + s * 0.30, y + 0.56, cz, bkt);
  b.box('wood', 0.34, 0.26, 0.34, cx + s * 1.15, y + 0.85, cz, GOLD_HI);
  b.box('wood', 0.34, 0.26, 0.34, cx - s * 0.55, y + 0.85, cz, GOLD_D);
  // 二跳华栱
  b.box('wood', 2.70, 0.28, 0.30, cx + s * 0.65, y + 1.14, cz, bkt);
  b.box('wood', 0.38, 0.26, 0.38, cx + s * 1.85, y + 1.42, cz, GOLD_HI);
  // 令栱（平行檐口，承挑檐枋）
  b.box('wood', 0.30, 0.24, 1.30, cx + s * 1.85, y + 1.68, cz, bkt);
  b.box('wood', 0.36, 0.10, 0.42, cx + s * 1.85, y + 1.79, cz, GOLD_D);
  // 内跳小斗
  b.box('wood', 0.30, 0.24, 0.34, cx - s * 0.55, y + 1.42, cz, GOLD);
}

// ============ 天花 + 低坡瓦顶 ============
function canopy(b: Baker, sgn: number): void {
  const x = sgn * COL_X;
  // 檐口封板（内外两道）
  for (const e of [WALK_IN - 0.06, WALK_OUT + 0.06]) {
    b.box('wood', 0.22, 0.42, LEN, sgn * e, Y_DG + 2.36, 0, RED_D);
    b.box('wood', 0.26, 0.06, LEN, sgn * e, Y_DG + 2.55, 0, GOLD);
    b.box('wood', 0.28, 0.05, LEN, sgn * e, Y_DG + 2.14, 0, GOLD_D);
  }
  // 天花（深色木顶 + 金线井口）
  b.box('wood', WALK_OUT - WALK_IN, 0.30, LEN - 0.2, x, Y_DG + 2.68, 0, SOFFIT);
  for (const off of [-1.9, 1.9]) {
    b.box('wood', 0.12, 0.08, LEN - 0.4, x + off, Y_DG + 2.55, 0, GOLD);
  }
  for (let i = 0; i < 32; i++) {
    b.box('wood', WALK_OUT - WALK_IN - 0.4, 0.08, 0.12, x, Y_DG + 2.55, Z0 + 1 + i * 2, GOLD);
  }
  // 低坡瓦顶：脊在柱列上方，内外各一坡
  const ridgeY = Y_DG + 3.62;
  const eaveY = Y_DG + 2.72;
  const half = (WALK_OUT - WALK_IN) / 2;
  const ang = Math.atan2(ridgeY - eaveY, half);
  b.box('roof', half + 0.35, 0.22, LEN, x - sgn * half / 2, (ridgeY + eaveY) / 2, 0, TILE, 0, 0, sgn * ang);
  b.box('roof', half + 0.35, 0.22, LEN, x + sgn * half / 2, (ridgeY + eaveY) / 2, 0, TILE, 0, 0, -sgn * ang);
  // 正脊 + 脊头金饰
  b.box('roof', 0.44, 0.28, LEN, x, ridgeY + 0.14, 0, shade(TILE, 1.18));
  // P1-8 报障修复：两端山墙三角封板（旧版 ±32.4 端头从檐口到屋脊是敞口——侧看穿进空腔）
  for (const s of [-1, 1]) {
    const ez = (LEN / 2) * s;
    // 三级阶梯封板：从檐口线 (half, eaveY) 升到屋脊 (0, ridgeY)，宽 0.3
    for (const [f, wStep, hStep] of [[0.34, half * 0.62, (eaveY + (ridgeY - eaveY) * 0.34)], [0.67, half * 0.32, (eaveY + (ridgeY - eaveY) * 0.67)]] as const) {
      b.box('wall', wStep, (ridgeY - eaveY) * 0.34, 0.3, x, eaveY + (ridgeY - eaveY) * f, ez + s * 0.14, shade(TILE, 1.08));
    }
    b.box('wall', 0.3, ridgeY - eaveY + 0.1, 0.3, x, eaveY + (ridgeY - eaveY) / 2, ez + s * 0.14, shade(TILE, 1.08));
  }
  b.box('wood', 0.50, 0.06, LEN, x, ridgeY + 0.30, 0, GOLD_D);
  for (const z of [Z0 - 0.2, Z1 + 0.2]) {
    b.box('wood', 0.40, 0.34, 0.22, x, ridgeY + 0.30, z, GOLD);
  }
  // 两端山花封板
  for (const z of [Z0 - 0.28, Z1 + 0.28]) {
    b.box('wood', WALK_OUT - WALK_IN, 1.0, 0.20, x, Y_DG + 2.95, z, SOFFIT);
    b.box('wood', WALK_OUT - WALK_IN, 0.07, 0.24, x, Y_DG + 3.46, z, GOLD_D);
  }
}

// ============ 栏板 / 望柱（汉白玉，望柱头仰莲包金） ============
function balustrade(b: Baker, sgn: number): void {
  const x = sgn * (WALK_OUT - 0.25);
  const y = STYLO;
  // 地栿
  b.box('ash', 0.46, 0.22, Z1 - Z0, x, y + 0.11, 0, JADE_D);
  // 栏板（逐间）+ 浮雕圆牌
  const postZ: number[] = [];
  for (let i = 0; i <= 26; i++) postZ.push(-31.2 + i * 2.4);
  for (let i = 0; i < postZ.length - 1; i++) {
    const zc = (postZ[i] + postZ[i + 1]) / 2;
    b.box('ash', 0.22, 0.62, 2.06, x, y + 0.60, zc, JADE);
    b.box('ash', 0.26, 0.06, 2.10, x, y + 0.93, zc, JADE_HI);
    for (const f of [-1, 1]) {
      b.sphere('ash', 0.26, 10, x + f * 0.10, y + 0.60, zc, JADE_D, 0, 0, 0, 0.20, 0.85, 1);
    }
  }
  // 两道寻杖
  b.box('ash', 0.30, 0.17, Z1 - Z0, x, y + 1.30, 0, JADE_HI);
  b.box('ash', 0.24, 0.12, Z1 - Z0, x, y + 1.04, 0, JADE_D);
  // 望柱：柱身 + 仰莲座 + 金球
  for (const pz of postZ) {
    b.box('ash', 0.34, 1.24, 0.34, x, y + 0.62, pz, JADE_HI);
    b.box('ash', 0.40, 0.10, 0.40, x, y + 1.28, pz, JADE_D);
    b.cyl('ash', 0.30, 0.22, 0.14, 12, x, y + 1.40, pz, JADE_HI);
    b.cyl('wood', 0.24, 0.28, 0.08, 12, x, y + 1.47, pz, GOLD);
    b.sphere('wood', 0.19, 10, x, y + 1.61, pz, GOLD_HI, 0, 0, 0, 1, 1.12, 1);
    b.cyl('wood', 0.03, 0.09, 0.12, 8, x, y + 1.80, pz, GOLD_HI);
  }
  // 端头转角栏板（封住两列廊的端头）
  for (const z of [Z0 + 0.08, Z1 - 0.08]) {
    for (const px of [WALK_IN + 0.8, COL_X, WALK_OUT - 0.4]) {
      b.box('ash', 0.34, 1.24, 0.34, sgn * px, y + 0.62, z, JADE_HI);
      b.cyl('ash', 0.30, 0.22, 0.14, 12, sgn * px, y + 1.40, z, JADE_HI);
      b.cyl('wood', 0.24, 0.28, 0.08, 12, sgn * px, y + 1.47, z, GOLD);
      b.sphere('wood', 0.19, 10, sgn * px, y + 1.61, z, GOLD_HI, 0, 0, 0, 1, 1.12, 1);
      b.cyl('wood', 0.03, 0.09, 0.12, 8, sgn * px, y + 1.80, z, GOLD_HI);
    }
    const cx = sgn * (WALK_IN + WALK_OUT) / 2;
    b.box('ash', WALK_OUT - WALK_IN, 0.17, 0.30, cx, y + 1.30, z, JADE_HI);
    b.box('ash', WALK_OUT - WALK_IN, 0.12, 0.24, cx, y + 1.04, z, JADE_D);
    b.box('ash', WALK_OUT - WALK_IN, 0.62, 0.22, cx, y + 0.60, z, JADE);
  }
}
