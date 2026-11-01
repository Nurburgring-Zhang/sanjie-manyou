import { Baker, BGroup, shade } from './bake';

/**
 * 三大殿室内礼制陈设（太和 / 中和 / 保和）。
 *
 * 尺度口径：全部坐标以「殿中心 + 殿内地坪顶面」为原点，x 向东、z 向南（+z 为殿门方向）。
 * 件数按殿内可用面积分配（≈15㎡/件），宝座区为定值核心、不被稀释；次间按 6.5m 一组条带铺开。
 * 现有殿身（imperial/palaceDetail）只给柱、墙、屋面，没有梁架、天花、金柱，故这里补齐。
 */

// ============ 配色 ============
const GOLD = 0xd8b028;        // 鎏金
const GOLD_D = 0x9a7318;      // 旧金 / 阴面
const GOLD_L = 0xefd27a;      // 高光金
const RED = 0x8f2a24;         // 朱漆
const RED_D = 0x5e1a16;       // 深朱
const CINNABAR = 0x9d2933;    // 宫红
const SILK_RED = 0x8a1e22;    // 织锦红
const SILK_GOLD = 0xc9a13a;   // 织金
const MARBLE = 0xd2c9b6;      // 汉白玉
const MARBLE_D = 0xafa690;    // 汉白玉阴面
const JINZHUAN = 0x3b362c;    // 金砖（青黑带暖，深色才能压住殿内点光）
const BRONZE = 0x8a7a52;      // 铜
const BRONZE_D = 0x4e4632;    // 铜阴面
const VERDIGRIS = 0x4e7a5e;   // 铜绿
const PORCELAIN = 0xece4d2;   // 白瓷
const CELADON = 0x9fc4b0;     // 青瓷
const JADE = 0x2f5a4a;        // 青玉 / 和玺青
const TEAL = 0x2a6b5a;        // 和玺绿
const PAPER = 0xe6ddc4;       // 宣纸
const INK = 0x26282c;         // 墨
const WOOD = 0x6b4a2b;        // 木
const WOOD_D = 0x3a2c22;      // 深褐
const LACQ = 0x2b1a16;        // 黑漆
const LACQ_RED = 0x6e1f1a;    // 朱漆家具
const BONE = 0xe8e3d5;        // 骨白
const FLAME = 0xffb04a;       // 灯焰

// ============ 殿名与净高（与 imperial.ts 的三次调用一一对应） ============
/**
 * 殿内可站立面（金砖顶）的局部标高：imperial 的地坪垫层顶在 0.03，金砖 0.01–0.06。
 * 所有落地陈设的 y0 必须用它——用 0 会让家具陷进砖里 6cm。
 */
const FLOOR = 0.06;
const HALL_BY_SALT: Record<number, string> = { 11: 'taihe', 23: 'zhonghe', 37: 'baohe' };
const EAVE_BY_SALT: Record<number, number> = { 11: 26, 23: 24, 37: 25 };
/** imperial.ts 传进来的是殿心减 6/4/5m（旧陈设的落位习惯），这里补回真正殿心 */
const ZFIX_BY_SALT: Record<number, number> = { 11: 6, 23: 4, 37: 5 };

function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ============ 绘制上下文：坐标一律是殿内局部坐标 ============
class Hall {
  readonly b: Baker;
  readonly x: number;
  readonly z: number;
  readonly y: number;      // 殿内地坪顶面（世界标高）
  readonly hw: number;     // 可用半宽（墙内皮再退 0.6）
  readonly hd: number;
  readonly s: number;      // 殿的尺度系数
  readonly core: number;   // 明间半宽
  readonly ceilH: number;  // 额枋底净高（梁架下皮）
  readonly colZ: number;   // 殿内金柱所在 z（±colZ），与 imperial 的 12 根方柱同心
  readonly hall: string;
  readonly seed: number;

  constructor(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; scale: number; salt: number }) {
    this.b = b;
    this.x = o.x;
    this.z = o.z + (ZFIX_BY_SALT[o.salt] ?? 0);
    this.y = o.y + 0.19;             // 现有地坪石板顶面
    this.hw = Math.max(4, o.w / 2 - 3.0);
    this.hd = Math.max(3, o.d / 2 - 3.0);
    this.s = o.scale;
    this.core = Math.max(7.5, o.w * 0.065);
    const eave = EAVE_BY_SALT[o.salt] ?? 25;
    this.ceilH = Math.max(7.2, Math.min(9.6, (eave - o.y) * 0.52 - 1.85));
    this.colZ = o.d * 0.2;
    this.hall = HALL_BY_SALT[o.salt] ?? 'h' + o.salt;
    this.seed = o.salt * 7919 + 17;
  }

  box(g: BGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, ry = 0, rx = 0, rz = 0): void {
    this.b.box(g, w, h, d, this.x + lx, this.y + ly, this.z + lz, hex, ry, rx, rz);
  }

  cyl(g: BGroup, rt: number, rb: number, h: number, seg: number, lx: number, ly: number, lz: number, hex: number, ry = 0, rx = 0, rz = 0, open = false): void {
    this.b.cyl(g, rt, rb, h, seg, this.x + lx, this.y + ly, this.z + lz, hex, ry, rx, rz, open);
  }

  sphere(g: BGroup, r: number, seg: number, lx: number, ly: number, lz: number, hex: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.b.sphere(g, r, seg, this.x + lx, this.y + ly, this.z + lz, hex, ry, rx, rz, sx, sy, sz);
  }

  /** 双台账：palace.interior.<kind> 汇总 / palace.hall.<殿>.<kind> 分殿（验收两套都读得到） */
  kit(kind: string, n = 1, yy = 0): void {
    this.b.kit('palace.interior.' + kind, n, this.y + yy);
    this.b.kit('palace.hall.' + this.hall + '.' + kind, n, this.y + yy);
  }
}

interface Frame {
  x: number;
  z: number;
  ry: number;
  y0: number;   // 该物件基准面（0 = 地坪，桌面 = 桌面高）
}

function fp(f: Frame, u: number, v: number): [number, number] {
  const c = Math.cos(f.ry), s = Math.sin(f.ry);
  return [f.x + u * c + v * s, f.z - u * s + v * c];
}

function at(f: Frame, u: number, v: number, y0 = 0): Frame {
  const [x, z] = fp(f, u, v);
  return { x, z, ry: f.ry, y0: f.y0 + y0 };
}

// ============ 家具与器物（每类形制独立，不用同一个方盒糊） ============

/** 长案 / 供桌：独板面 + 束腰 + 四腿 + 金线 */
function longTable(h: Hall, f: Frame, len = 3.0): void {
  h.box('lacquer', len, 0.12, 0.86, f.x, f.y0 + 0.92, f.z, LACQ_RED, f.ry);
  h.box('wood', len - 0.12, 0.07, 0.76, f.x, f.y0 + 0.835, f.z, shade(WOOD, 0.92), f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * (len / 2 - 0.18), sv * 0.3);
    h.box('wood', 0.14, 0.84, 0.14, lx, f.y0 + 0.42, lz, WOOD_D, f.ry);
  }
  for (const sv of [-1, 1]) {
    const [ax, az] = fp(f, 0, sv * 0.36);
    h.box('lacquer', len - 0.22, 0.17, 0.05, ax, f.y0 + 0.74, az, shade(LACQ_RED, 1.12), f.ry);
  }
  for (const sv of [-1, 1]) {
    const [gx, gz] = fp(f, 0, sv * 0.44);
    h.box('metal', len - 0.1, 0.028, 0.028, gx, f.y0 + 0.985, gz, GOLD, f.ry);
  }
  h.kit('longTable', 1, 0.9);
}

/** 方桌（宴席 / 茶席） */
function squareTable(h: Hall, f: Frame, size = 1.25): void {
  h.box('lacquer', size, 0.1, size, f.x, f.y0 + 0.8, f.z, LACQ_RED, f.ry);
  h.box('wood', size - 0.1, 0.06, size - 0.1, f.x, f.y0 + 0.72, f.z, shade(WOOD, 1.02), f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * (size / 2 - 0.12), sv * (size / 2 - 0.12));
    h.box('wood', 0.11, 0.72, 0.11, lx, f.y0 + 0.36, lz, WOOD_D, f.ry);
  }
  for (const sv of [-1, 1]) {
    const [ax, az] = fp(f, 0, sv * (size / 2 - 0.06));
    h.box('metal', size - 0.16, 0.02, 0.02, ax, f.y0 + 0.855, az, GOLD, f.ry);
  }
  h.kit('squareTable', 1, 0.8);
}

/** 琴桌：窄长条案 + 琴 + 七弦 */
function qinTable(h: Hall, f: Frame): void {
  h.box('lacquer', 2.3, 0.11, 0.62, f.x, f.y0 + 0.78, f.z, 0x3a2018, f.ry);
  for (const su of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.95, 0);
    h.box('lacquer', 0.16, 0.72, 0.5, lx, f.y0 + 0.36, lz, RED_D, f.ry);
  }
  const [gx, gz] = fp(f, 0, 0.33);
  h.box('metal', 2.1, 0.022, 0.022, gx, f.y0 + 0.84, gz, GOLD, f.ry);
  h.box('lacquer', 1.9, 0.09, 0.34, f.x, f.y0 + 0.88, f.z, LACQ, f.ry);
  for (let i = 0; i < 7; i++) {
    const [sx, sz] = fp(f, 0, -0.13 + i * 0.043);
    h.box('metal', 1.8, 0.012, 0.012, sx, f.y0 + 0.93, sz, 0xd8cbaa, f.ry);
  }
  h.kit('qinTable', 1, 0.8);
  h.kit('qin', 1, 0.9);
}

/** 书案（御案 / 文臣案）：抽屉 + 铜拉手 + 文房 */
function desk(h: Hall, f: Frame, len = 2.7): void {
  h.box('lacquer', len, 0.13, 1.1, f.x, f.y0 + 0.86, f.z, 0x4a241c, f.ry);
  h.box('wood', len - 0.14, 0.1, 0.98, f.x, f.y0 + 0.75, f.z, shade(WOOD, 0.96), f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * (len / 2 - 0.2), sv * 0.4);
    h.box('wood', 0.16, 0.74, 0.16, lx, f.y0 + 0.37, lz, WOOD_D, f.ry);
  }
  for (const su of [-1, 1]) {
    const [dx, dz] = fp(f, su * 0.55, 0.5);
    h.box('lacquer', 0.95, 0.26, 0.06, dx, f.y0 + 0.62, dz, shade(0x4a241c, 1.1), f.ry);
    h.box('metal', 0.16, 0.04, 0.03, dx, f.y0 + 0.62, dz + 0.04, GOLD, f.ry);
  }
  h.box('metal', len - 0.1, 0.025, 0.025, f.x, f.y0 + 0.93, f.z + 0.0, GOLD, f.ry);
  h.kit('desk', 1, 0.86);
}

/** 文房四宝：笔筒 + 四笔 + 砚 + 印 + 纸 + 卷轴 */
function stationery(h: Hall, f: Frame): void {
  h.cyl('ceramic', 0.13, 0.11, 0.24, 8, f.x - 0.55, f.y0 + 0.12, f.z, CELADON, f.ry);
  for (let i = 0; i < 4; i++) {
    const [bx, bz] = fp(f, -0.55 + (i - 1.5) * 0.05, (i % 2) * 0.03);
    h.cyl('wood', 0.014, 0.018, 0.34, 5, bx, f.y0 + 0.32, bz, 0x6a4a2a, f.ry, 0.06 * (i - 1.5), 0.04 * (i % 2));
    h.cyl('fabric', 0.02, 0.006, 0.1, 5, bx, f.y0 + 0.53, bz, 0x2a2a2a, f.ry, 0.06 * (i - 1.5), 0.04 * (i % 2));
  }
  h.kit('brush', 4, 0.4);
  h.box('lacquer', 0.44, 0.07, 0.32, f.x - 0.02, f.y0 + 0.035, f.z + 0.2, LACQ, f.ry);
  h.box('metal', 0.3, 0.02, 0.2, f.x - 0.02, f.y0 + 0.07, f.z + 0.2, 0x3a3a3a, f.ry);
  h.kit('inkstone', 1, 0.07);
  h.box('metal', 0.14, 0.16, 0.14, f.x + 0.32, f.y0 + 0.08, f.z + 0.24, GOLD, f.ry);
  h.box('fabric', 0.42, 0.05, 0.3, f.x + 0.52, f.y0 + 0.025, f.z + 0.22, PAPER, f.ry);
  h.kit('seal', 1, 0.16);
  for (let i = 0; i < 2; i++) {
    const [sx, sz] = fp(f, 0.6 + i * 0.16, -0.16);
    h.cyl('fabric', 0.045, 0.045, 0.5, 6, sx, f.y0 + 0.06, sz, PAPER, f.ry, 0, Math.PI / 2);
    h.cyl('metal', 0.05, 0.05, 0.04, 6, sx + 0.27, f.y0 + 0.06, sz, GOLD_D, f.ry, 0, Math.PI / 2);
    h.cyl('metal', 0.05, 0.05, 0.04, 6, sx - 0.27, f.y0 + 0.06, sz, GOLD_D, f.ry, 0, Math.PI / 2);
    h.kit('scroll', 1, 0.06);
  }
  h.kit('stationery', 1, 0.12);
}

/** 交椅：座面 + 后靠 + 两扶手 + 交叉腿 */
function armchair(h: Hall, f: Frame): void {
  h.box('wood', 0.64, 0.08, 0.58, f.x, f.y0 + 0.5, f.z, shade(WOOD, 1.08), f.ry);
  h.box('fabric', 0.56, 0.1, 0.5, f.x, f.y0 + 0.58, f.z, CINNABAR, f.ry);
  const [bx, bz] = fp(f, 0, -0.26);
  h.box('lacquer', 0.64, 0.78, 0.09, bx, f.y0 + 0.94, bz, RED_D, f.ry);
  h.box('metal', 0.52, 0.1, 0.03, bx, f.y0 + 1.24, bz, GOLD, f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.24, sv * 0.2);
    h.box('wood', 0.07, 0.58, 0.07, lx, f.y0 + 0.28, lz, WOOD_D, f.ry, sv * 0.12, su * 0.12);
  }
  for (const su of [-1, 1]) {
    const [ax, az] = fp(f, su * 0.31, 0);
    h.box('lacquer', 0.07, 0.26, 0.52, ax, f.y0 + 0.72, az, RED_D, f.ry);
    h.box('metal', 0.06, 0.05, 0.32, ax, f.y0 + 0.86, az, GOLD, f.ry);
  }
  h.kit('armchair', 1, 0.5);
}

/** 绣墩 / 坐凳 */
function stool(h: Hall, f: Frame, fabric = CINNABAR): void {
  h.cyl('wood', 0.29, 0.33, 0.48, 10, f.x, f.y0 + 0.24, f.z, shade(WOOD, 0.96), f.ry);
  h.cyl('metal', 0.305, 0.305, 0.03, 10, f.x, f.y0 + 0.42, f.z, GOLD, f.ry);
  h.cyl('metal', 0.335, 0.335, 0.03, 10, f.x, f.y0 + 0.09, f.z, GOLD, f.ry);
  h.cyl('fabric', 0.3, 0.3, 0.07, 10, f.x, f.y0 + 0.52, f.z, fabric, f.ry);
  h.kit('stool', 1, 0.4);
}

/** 凭几：三段弧面 + 两腿 */
function armrest(h: Hall, f: Frame): void {
  h.box('lacquer', 0.62, 0.07, 0.28, f.x, f.y0 + 0.44, f.z, LACQ_RED, f.ry);
  for (const su of [-1, 1]) {
    const [ex, ez] = fp(f, su * 0.5, 0.06);
    h.box('lacquer', 0.3, 0.06, 0.26, ex, f.y0 + 0.41, ez, shade(LACQ_RED, 1.08), f.ry, 0, su * 0.24);
  }
  for (const su of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.28, 0.02);
    h.box('wood', 0.07, 0.4, 0.2, lx, f.y0 + 0.2, lz, WOOD_D, f.ry, 0, su * 0.1);
  }
  h.box('metal', 0.56, 0.02, 0.02, f.x, f.y0 + 0.48, f.z, GOLD, f.ry);
  h.kit('armrest', 1, 0.3);
}

/** 香几：细腿高几 + 下枨 */
function incenseTable(h: Hall, f: Frame, top = 0.72): void {
  h.box('lacquer', top, 0.07, top, f.x, f.y0 + 0.86, f.z, LACQ_RED, f.ry);
  h.box('metal', top + 0.04, 0.02, top + 0.04, f.x, f.y0 + 0.9, f.z, GOLD, f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * (top / 2 - 0.07), sv * (top / 2 - 0.07));
    h.box('wood', 0.07, 0.86, 0.07, lx, f.y0 + 0.43, lz, WOOD_D, f.ry, sv * 0.03, su * 0.03);
  }
  for (const su of [-1, 1]) {
    const [rx, rz] = fp(f, su * (top / 2 - 0.07), 0);
    h.box('wood', 0.05, 0.05, top - 0.18, rx, f.y0 + 0.3, rz, WOOD_D, f.ry);
  }
  h.kit('incenseTable', 1, 0.86);
}

/** 花几（高脚，放盆景/瓶花） */
function flowerStand(h: Hall, f: Frame): void {
  h.box('lacquer', 0.62, 0.07, 0.62, f.x, f.y0 + 0.92, f.z, LACQ_RED, f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.24, sv * 0.24);
    h.box('wood', 0.06, 0.9, 0.06, lx, f.y0 + 0.45, lz, WOOD_D, f.ry, sv * 0.04, su * 0.04);
  }
  for (const sv of [-1, 1]) {
    const [rx, rz] = fp(f, 0, sv * 0.24);
    h.box('wood', 0.48, 0.04, 0.04, rx, f.y0 + 0.28, rz, WOOD_D, f.ry);
  }
  h.kit('flowerStand', 1, 0.9);
}

/** 三扇屏扇（可折叠，带云纹） */
function foldingScreen(h: Hall, f: Frame): void {
  for (let i = -1; i <= 1; i++) {
    const ang = i * 0.3;
    const [px, pz] = fp(f, i * 0.98, -Math.abs(i) * 0.16);
    h.box('lacquer', 1.02, 2.0, 0.1, px, f.y0 + 1.02, pz, RED_D, f.ry + ang);
    h.box('metal', 0.88, 1.78, 0.04, px, f.y0 + 1.04, pz + 0.06, i === 0 ? GOLD : GOLD_D, f.ry + ang);
    h.box('fabric', 0.78, 1.62, 0.02, px, f.y0 + 1.04, pz + 0.085, shade(GOLD, 0.92), f.ry + ang);
    for (let k = 0; k < 3; k++) {
      h.box('fabric', 0.26 - k * 0.04, 0.11, 0.014, px - 0.18 + k * 0.18, f.y0 + 1.42 - k * 0.3, pz + 0.1, GOLD_D, f.ry + ang, 0, 0.4);
    }
    h.box('metal', 0.9, 0.06, 0.06, px, f.y0 + 2.0, pz, GOLD, f.ry + ang);
    // 背面：三道金箍 + 两只矮脚（从侧廊看不会是一块光板）
    for (let k = 0; k < 3; k++) {
      h.box('metal', 0.94, 0.05, 0.04, px, f.y0 + 0.3 + k * 0.72, pz - 0.07, shade(GOLD, 0.8), f.ry + ang);
    }
    h.box('wood', 0.12, 0.14, 0.42, px - 0.4, f.y0 + 0.07, pz, WOOD_D, f.ry + ang);
    h.box('wood', 0.12, 0.14, 0.42, px + 0.4, f.y0 + 0.07, pz, WOOD_D, f.ry + ang);
  }
  h.kit('screenPanel', 3, 1.0);
  h.kit('foldingScreen', 1, 1.0);
}

/** 漆盒（大小两只叠放 + 金扣） */
function lacquerBox(h: Hall, f: Frame, s = 1): void {
  h.box('lacquer', 0.56 * s, 0.26 * s, 0.4 * s, f.x, f.y0 + 0.13 * s, f.z, LACQ, f.ry);
  h.box('metal', 0.58 * s, 0.03 * s, 0.42 * s, f.x, f.y0 + 0.27 * s, f.z, GOLD, f.ry);
  h.box('lacquer', 0.4 * s, 0.2 * s, 0.3 * s, f.x, f.y0 + 0.39 * s, f.z, LACQ_RED, f.ry);
  h.box('metal', 0.42 * s, 0.025 * s, 0.32 * s, f.x, f.y0 + 0.49 * s, f.z, GOLD, f.ry);
  h.box('metal', 0.08 * s, 0.16 * s, 0.02, f.x, f.y0 + 0.3 * s, f.z + 0.21 * s, GOLD_L, f.ry);
  h.kit('lacquerBox', 1, 0.3);
}

/** 瓷瓶（三种器形：梅瓶 / 玉壶春 / 觚） */
function vase(h: Hall, f: Frame, kind = 0): void {
  const col = kind === 1 ? CELADON : kind === 2 ? JADE : PORCELAIN;
  const r = kind === 1 ? 0.3 : 0.24;
  const hh = kind === 2 ? 1.35 : 1.1;
  h.cyl('ceramic', r * 0.5, r * 0.62, 0.08, 6, f.x, f.y0 + 0.04, f.z, shade(col, 0.9), f.ry);
  if (kind === 2) {
    h.cyl('ceramic', r * 0.9, r * 0.55, 0.5, 6, f.x, f.y0 + 0.33, f.z, col, f.ry);
    h.cyl('ceramic', r * 0.62, r * 0.9, 0.5, 6, f.x, f.y0 + 0.83, f.z, shade(col, 1.04), f.ry);
    h.cyl('ceramic', r * 1.02, r * 0.64, 0.3, 6, f.x, f.y0 + 1.22, f.z, col, f.ry);
  } else {
    h.cyl('ceramic', r, r * 0.82, 0.52, 6, f.x, f.y0 + 0.32, f.z, col, f.ry);
    h.cyl('ceramic', r * 0.52, r * 0.92, 0.24, 6, f.x, f.y0 + 0.7, f.z, shade(col, 1.04), f.ry);
    h.cyl('ceramic', r * 0.3, r * 0.36, 0.28, 6, f.x, f.y0 + 0.92, f.z, col, f.ry);
  }
  h.cyl('ceramic', r * 0.4, r * 0.3, 0.06, 6, f.x, f.y0 + hh - 0.03, f.z, shade(col, 1.08), f.ry);
  h.kit('vase', 1, hh);
}

/** 盆景：盆 + 土 + 三曲干 + 叶团 + 花 */
function bonsai(h: Hall, f: Frame, variant = 0): void {
  h.cyl('ceramic', 0.34, 0.28, 0.32, 6, f.x, f.y0 + 0.16, f.z, variant ? CELADON : 0x8a5a3a, f.ry);
  h.cyl('ceramic', 0.36, 0.36, 0.05, 6, f.x, f.y0 + 0.32, f.z, shade(variant ? CELADON : 0x8a5a3a, 1.1), f.ry);
  h.cyl('earth', 0.3, 0.3, 0.04, 6, f.x, f.y0 + 0.35, f.z, 0x3a2c1e, f.ry);
  h.box('trunk', 0.09, 0.6, 0.09, f.x, f.y0 + 0.62, f.z, 0x4a3520, f.ry, 0, 0.16);
  h.box('trunk', 0.07, 0.46, 0.07, f.x + 0.1, f.y0 + 1.0, f.z, 0x4a3520, f.ry, 0.1, -0.32);
  h.box('trunk', 0.06, 0.36, 0.06, f.x + 0.34, f.y0 + 1.24, f.z + 0.06, 0x4a3520, f.ry, -0.12, -0.42);
  const leaf = variant ? 0x3e6b4a : 0x4a7a3a;
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + (variant ? 0.4 : 0);
    h.sphere('leaf', 0.26 + (i % 2) * 0.07, 4, f.x + Math.cos(a) * 0.28, f.y0 + 1.42 + (i % 3) * 0.12, f.z + Math.sin(a) * 0.24, shade(leaf, 0.9 + (i % 3) * 0.12));
  }
  if (variant) for (let i = 0; i < 3; i++) {
    h.sphere('leaf', 0.05, 3, f.x + Math.cos(i * 2.1) * 0.22, f.y0 + 1.55 + i * 0.08, f.z + Math.sin(i * 2.1) * 0.2, 0xc03a4a);
  }
  h.kit('bonsai', 1, 1.4);
}

/** 铜鼎（三足双耳带盖，铜绿环带） */
function bronzeDing(h: Hall, f: Frame, s = 1): void {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    h.cyl('metal', 0.07 * s, 0.1 * s, 0.42 * s, 5, f.x + Math.cos(a) * 0.3 * s, f.y0 + 0.21 * s, f.z + Math.sin(a) * 0.3 * s, BRONZE_D, f.ry);
  }
  h.cyl('metal', 0.46 * s, 0.4 * s, 0.5 * s, 8, f.x, f.y0 + 0.67 * s, f.z, BRONZE, f.ry);
  h.cyl('metal', 0.5 * s, 0.5 * s, 0.08 * s, 8, f.x, f.y0 + 0.95 * s, f.z, shade(BRONZE, 1.12), f.ry);
  h.cyl('metal', 0.44 * s, 0.46 * s, 0.06 * s, 8, f.x, f.y0 + 0.7 * s, f.z, VERDIGRIS, f.ry);
  h.cyl('metal', 0.2 * s, 0.34 * s, 0.16 * s, 8, f.x, f.y0 + 1.06 * s, f.z, shade(BRONZE, 0.94), f.ry);
  h.cyl('metal', 0.09 * s, 0.09 * s, 0.1 * s, 5, f.x, f.y0 + 1.18 * s, f.z, GOLD_D, f.ry);
  for (const su of [-1, 1]) {
    h.box('metal', 0.1 * s, 0.34 * s, 0.14 * s, f.x + su * 0.34 * s, f.y0 + 1.12 * s, f.z, BRONZE_D, f.ry);
    h.box('metal', 0.07 * s, 0.1 * s, 0.1 * s, f.x + su * 0.34 * s, f.y0 + 1.3 * s, f.z, shade(BRONZE, 1.2), f.ry);
  }
  h.kit('bronzeDing', 1, 1.1);
}

/** 香炉（三足小鼎 + 盖 + 余烬） */
function censer(h: Hall, f: Frame, s = 1): void {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    h.cyl('metal', 0.035 * s, 0.05 * s, 0.2 * s, 4, f.x + Math.cos(a) * 0.14 * s, f.y0 + 0.1 * s, f.z + Math.sin(a) * 0.14 * s, BRONZE_D, f.ry);
  }
  h.cyl('metal', 0.22 * s, 0.19 * s, 0.24 * s, 6, f.x, f.y0 + 0.32 * s, f.z, BRONZE, f.ry);
  h.cyl('metal', 0.24 * s, 0.24 * s, 0.04 * s, 6, f.x, f.y0 + 0.45 * s, f.z, shade(BRONZE, 1.14), f.ry);
  h.cyl('metal', 0.17 * s, 0.21 * s, 0.1 * s, 6, f.x, f.y0 + 0.51 * s, f.z, shade(BRONZE, 0.94), f.ry);
  for (const su of [-1, 1]) h.box('metal', 0.05 * s, 0.13 * s, 0.09 * s, f.x + su * 0.21 * s, f.y0 + 0.44 * s, f.z, BRONZE_D, f.ry);
  h.box('glow', 0.1 * s, 0.03 * s, 0.1 * s, f.x, f.y0 + 0.43 * s, f.z, FLAME);
  h.kit('censer', 1, 0.5);
}

/** 烛台：座 + 杆 + 盘 + 烛 + 焰 */
function candle(h: Hall, f: Frame, height = 1.1): void {
  h.cyl('metal', 0.2, 0.26, 0.06, 4, f.x, f.y0 + 0.03, f.z, GOLD_D, f.ry);
  h.cyl('metal', 0.045, 0.06, height, 4, f.x, f.y0 + height / 2, f.z, GOLD, f.ry);
  h.cyl('metal', 0.16, 0.12, 0.05, 4, f.x, f.y0 + height, f.z, GOLD, f.ry);
  h.cyl('fabric', 0.055, 0.06, 0.3, 4, f.x, f.y0 + height + 0.17, f.z, 0xf2e6cc, f.ry);
  h.sphere('glow', 0.07, 3, f.x, f.y0 + height + 0.38, f.z, FLAME, 0, 0, 0, 1, 1.8, 1);
  h.kit('candle', 1, height);
}

/** 火盆：宽口铜盆 + 三足 + 炭火 */
function brazier(h: Hall, f: Frame): void {
  h.cyl('metal', 0.56, 0.38, 0.34, 10, f.x, f.y0 + 0.4, f.z, BRONZE, f.ry);
  h.cyl('metal', 0.58, 0.58, 0.05, 10, f.x, f.y0 + 0.58, f.z, shade(BRONZE, 1.14), f.ry);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    h.cyl('metal', 0.05, 0.07, 0.32, 4, f.x + Math.cos(a) * 0.36, f.y0 + 0.16, f.z + Math.sin(a) * 0.36, BRONZE_D, f.ry);
    h.sphere('glow', 0.11, 3, f.x + Math.cos(a) * 0.24, f.y0 + 0.56, f.z + Math.sin(a) * 0.24, 0xff6a2a);
  }
  h.kit('brazier', 1, 0.5);
}

/** 茶具：托盘 + 执壶 + 四盏 */
function teaSet(h: Hall, f: Frame): void {
  h.box('wood', 0.86, 0.05, 0.54, f.x, f.y0 + 0.025, f.z, shade(WOOD, 1.1), f.ry);
  h.box('metal', 0.88, 0.02, 0.56, f.x, f.y0 + 0.06, f.z, GOLD, f.ry);
  h.sphere('ceramic', 0.17, 8, f.x - 0.14, f.y0 + 0.22, f.z, CELADON, 0, 0, 0, 1, 0.82, 1);
  h.cyl('ceramic', 0.09, 0.12, 0.06, 8, f.x - 0.14, f.y0 + 0.34, f.z, shade(CELADON, 1.1), f.ry);
  h.cyl('ceramic', 0.03, 0.045, 0.22, 5, f.x + 0.02, f.y0 + 0.28, f.z, CELADON, f.ry, 0, -0.9);
  h.box('ceramic', 0.04, 0.16, 0.16, f.x - 0.32, f.y0 + 0.24, f.z, CELADON, f.ry);
  for (let i = 0; i < 4; i++) {
    const u = i < 2 ? -0.02 : 0.24;
    const v = (i % 2 ? 0.16 : -0.16);
    const [cx, cz] = fp(f, u + (i < 2 ? 0 : 0.16), v);
    h.cyl('ceramic', 0.055, 0.045, 0.07, 6, cx, f.y0 + 0.11, cz, PORCELAIN, f.ry);
  }
  h.kit('cup', 4, 0.12);
  h.kit('teaSet', 1, 0.2);
}

/** 卷轴架：两柱三档 + 卷轴 */
function scrollRack(h: Hall, f: Frame): void {
  for (const su of [-1, 1]) {
    const [px, pz] = fp(f, su * 0.55, 0);
    h.box('wood', 0.09, 1.75, 0.09, px, f.y0 + 0.88, pz, WOOD_D, f.ry);
  }
  for (let k = 0; k < 3; k++) {
    h.box('wood', 1.2, 0.06, 0.08, f.x, f.y0 + 0.5 + k * 0.5, f.z, shade(WOOD, 1.04), f.ry);
    for (let i = 0; i < 2; i++) {
      const [sx, sz] = fp(f, -0.28 + i * 0.5, 0);
      h.cyl('fabric', 0.05, 0.05, 0.42, 6, sx, f.y0 + 0.62 + k * 0.5, sz, i ? PAPER : 0xd8cbaa, f.ry, 0, Math.PI / 2);
      h.cyl('metal', 0.055, 0.055, 0.03, 6, sx + 0.22, f.y0 + 0.62 + k * 0.5, sz, GOLD_D, f.ry, 0, Math.PI / 2);
      h.cyl('metal', 0.055, 0.055, 0.03, 6, sx - 0.22, f.y0 + 0.62 + k * 0.5, sz, GOLD_D, f.ry, 0, Math.PI / 2);
    }
  }
  h.kit('scroll', 6, 1.0);
  h.kit('scrollRack', 1, 0.9);
}

/** 书堆 */
function bookStack(h: Hall, f: Frame, n = 5): void {
  const cols = [0x2f4a6a, PAPER, 0x7a2a2a, 0x4a5a3a, 0x6a5a2a];
  for (let i = 0; i < n; i++) {
    h.box('fabric', 0.4 - i * 0.012, 0.055, 0.28, f.x, f.y0 + 0.03 + i * 0.056, f.z, cols[i % cols.length], f.ry + i * 0.05);
    h.box('fabric', 0.02, 0.05, 0.28, f.x - 0.2 + i * 0.006, f.y0 + 0.03 + i * 0.056, f.z, PAPER, f.ry + i * 0.05);
  }
  h.kit('book', n, n * 0.056);
}

/** 书柜 / 陈设柜 */
function cabinet(h: Hall, f: Frame): void {
  h.box('wood', 1.7, 2.1, 0.6, f.x, f.y0 + 1.05, f.z, shade(WOOD, 0.9), f.ry);
  for (const su of [-1, 1]) {
    const [dx, dz] = fp(f, su * 0.42, 0.3);
    h.box('lacquer', 0.78, 1.86, 0.05, dx, f.y0 + 1.08, dz, RED_D, f.ry);
    h.box('metal', 0.1, 0.16, 0.04, dx + (su > 0 ? -0.28 : 0.28), f.y0 + 1.08, dz + 0.04, GOLD, f.ry);
  }
  h.box('metal', 1.74, 0.06, 0.64, f.x, f.y0 + 2.12, f.z, GOLD, f.ry);
  h.box('wood', 1.74, 0.1, 0.64, f.x, f.y0 + 0.06, f.z, WOOD_D, f.ry);
  h.box('fabric', 1.7, 0.3, 0.02, f.x, f.y0 + 0.26, f.z + 0.31, JADE, f.ry);
  h.kit('cabinet', 1, 1.1);
}

/** 帷幔：一排细密褶皱（每褶独立盒体，明暗交替）+ 楣子 */
function curtain(h: Hall, f: Frame, width = 2.6, top = 7.6, bottom = 1.4): void {
  const folds = Math.max(7, Math.round(width / 0.28));
  const step = width / folds;
  for (let i = 0; i < folds; i++) {
    const u = -width / 2 + step * (i + 0.5);
    const ripple = (i % 2 ? 0.06 : -0.03) + hash01(h.seed + i * 13 + Math.round(f.x * 7)) * 0.05;
    const [px, pz] = fp(f, u, ripple);
    h.box('fabric', step * 1.06, top - bottom, 0.045, px, (top + bottom) / 2, pz, i % 3 === 0 ? shade(SILK_RED, 0.72) : i % 3 === 1 ? SILK_RED : shade(SILK_RED, 1.15), f.ry);
  }
  // 上楣 + 金线 + 垂穗
  h.box('fabric', width + 0.2, 0.42, 0.12, f.x, top + 0.2, f.z, RED_D, f.ry);
  h.box('metal', width + 0.24, 0.05, 0.14, f.x, top + 0.4, f.z, GOLD, f.ry);
  for (let i = 0; i < 5; i++) {
    const [tx, tz] = fp(f, -width / 2 + (width * (i + 0.5)) / 5, 0.1);
    h.box('fabric', 0.07, 0.34, 0.07, tx, top - 0.02, tz, SILK_GOLD, f.ry);
  }
  h.kit('curtain', 1, top);
  h.kit('valance', 1, top + 0.2);
}

/** 宫灯：吊杆 + 六角灯身 + 上下金盖 + 缨络 */
function palaceLantern(h: Hall, f: Frame, hang: number): void {
  h.box('wood', 0.07, 1.5, 0.07, f.x, hang + 1.55, f.z, WOOD_D, f.ry);
  h.box('metal', 0.62, 0.12, 0.62, f.x, hang + 0.86, f.z, GOLD, f.ry);
  h.cyl('fabric', 0.5, 0.5, 0.12, 6, f.x, hang + 0.78, f.z, SILK_RED, f.ry);
  h.cyl('glow', 0.42, 0.42, 0.72, 6, f.x, hang + 0.34, f.z, 0xffc061, f.ry);
  h.cyl('fabric', 0.46, 0.5, 0.1, 6, f.x, hang - 0.06, f.z, SILK_RED, f.ry);
  h.box('metal', 0.54, 0.09, 0.54, f.x, hang - 0.13, f.z, GOLD, f.ry);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    h.box('fabric', 0.05, 0.46, 0.05, f.x + Math.cos(a) * 0.13, hang - 0.38, f.z + Math.sin(a) * 0.13, i === 1 ? SILK_GOLD : SILK_RED, f.ry);
    h.sphere('metal', 0.05, 4, f.x + Math.cos(a) * 0.13, hang - 0.62, f.z + Math.sin(a) * 0.13, GOLD_D);
  }
  h.kit('lantern', 1, hang);
}

export { Hall, at, fp };
export type { Frame };
export { longTable, squareTable, qinTable, desk, stationery, armchair, stool, armrest, incenseTable, flowerStand, foldingScreen, lacquerBox, vase, bonsai, bronzeDing, censer, candle, brazier, teaSet, scrollRack, bookStack, cabinet, curtain, palaceLantern };

// ============ 条带陈设：一组 = 一桌两椅/一案供器，8 种形制轮转 ============
function station(h: Hall, f: Frame, kind: number): void {
  switch (kind % 8) {
    case 0: {   // 香几 + 双炉 + 瓶
      for (const su of [-1, 1]) {
        const t = at(f, su * 1.35, 0);
        incenseTable(h, t);
        censer(h, at(t, 0, 0, 0.9));
      }
      vase(h, at(f, 0, -0.5), 1);
      candle(h, at(f, 2.4, 0.5), 1.0);
      break;
    }
    case 1: {   // 书案 + 两椅 + 文房 + 卷轴架
      const d = at(f, 0, 0);
      desk(h, d);
      stationery(h, at(d, -0.25, 0.18, 0.92));
      armchair(h, at(f, -0.9, -0.95));
      armchair(h, at(f, 0.9, -0.95));
      scrollRack(h, at(f, 2.5, -0.2));
      bookStack(h, at(d, 0.85, -0.2, 0.92), 3);
      candle(h, at(d, 1.0, 0.25, 0.92), 0.95);
      break;
    }
    case 2: {   // 茶席：方桌 + 四椅 + 茶具 + 漆盒
      squareTable(h, at(f, 0, 0));
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const cf = at(f, su * 1.05, sv * 0.95, 0);
        armchair(h, { ...cf, ry: f.ry + (sv > 0 ? Math.PI : 0) });
      }
      teaSet(h, at(f, 0, 0.05, 0.85));
      lacquerBox(h, at(f, 0.55, -0.55, 0.85), 0.9);
      vase(h, at(f, -2.3, 0.2), 2);
      break;
    }
    case 3: {   // 琴案 + 香几 + 凭几
      qinTable(h, at(f, 0, 0));
      const it = at(f, 2.1, 0);
      incenseTable(h, it);
      censer(h, at(it, 0, 0, 0.9));
      armrest(h, at(f, -1.9, 0.7));
      lacquerBox(h, at(f, -1.9, -0.6));
      vase(h, at(f, 2.2, 1.3), 0);
      break;
    }
    case 4: {   // 盆景架 + 铜鼎 + 火盆
      for (const su of [-1, 1]) {
        const st = at(f, su * 1.6, 0);
        flowerStand(h, st);
        bonsai(h, at(st, 0, 0, 0.955), su > 0 ? 1 : 0);
      }
      vase(h, at(f, 0, -1.0), 1);
      vase(h, at(f, 0, 1.1), 2);
      bronzeDing(h, at(f, 2.7, 0), 0.8);
      brazier(h, at(f, -2.7, 0.6));
      break;
    }
    case 5: {   // 屏扇 + 凭几 + 漆盒 + 书
      foldingScreen(h, at(f, 0, 0));
      armrest(h, at(f, -1.9, 0.8));
      armrest(h, at(f, 1.9, 0.8));
      lacquerBox(h, at(f, 0, 1.1));
      bookStack(h, at(f, 1.7, -0.5), 3);
      break;
    }
    case 6: {   // 长案供器
      longTable(h, at(f, 0, 0));
      bronzeDing(h, at(f, 0, 1.5), 0.85);
      for (const su of [-1, 1]) {
        candle(h, at(f, su * 1.25, 0, 1.0), 1.0);
        vase(h, at(f, su * 0.55, -0.05, 0.98), su > 0 ? 1 : 0);
        lacquerBox(h, at(f, su * 0.35, 0.18, 0.98), 0.85);
      }
      break;
    }
    default: {  // 柜架 + 书 + 卷轴
      cabinet(h, at(f, 0, 0));
      bookStack(h, at(f, -1.25, 0.35), 3);
      scrollRack(h, at(f, 1.45, -0.1));
      const it = at(f, -2.3, 0.3);
      incenseTable(h, it);
      censer(h, at(it, 0, 0, 0.9));
      break;
    }
  }
}

/** 沿墙供桌：长案 + 瓶炉烛盒（东西山墙、后檐墙通用） */
function wallTable(h: Hall, f: Frame): void {
  longTable(h, at(f, 0, 0), 3.2);
  for (const su of [-1, 1]) {
    vase(h, at(f, su * 1.35, 0, 0.98), su > 0 ? 0 : 1);
    candle(h, at(f, su * 0.7, 0.02, 0.98), 0.95);
    lacquerBox(h, at(f, su * 0.35, 0.1, 0.98), 0.8);
  }
  censer(h, at(f, 0, 0.05, 0.98), 1.1);
}

// ============ 宝座区 ============
function tierBlock(h: Hall, w: number, d: number, y0: number, cz = 0): void {
  h.box('ash', w + 0.36, 0.14, d + 0.36, 0, y0 + 0.07, cz, MARBLE_D);
  h.box('ash', w, 0.28, d, 0, y0 + 0.28, cz, MARBLE);
  h.box('lacquer', w - 0.34, 0.14, d - 0.34, 0, y0 + 0.48, cz, RED_D);
  h.box('ash', w + 0.16, 0.12, d + 0.16, 0, y0 + 0.6, cz, shade(MARBLE, 1.04));
  for (const sz of [-1, 1]) h.box('metal', w + 0.2, 0.035, 0.035, 0, y0 + 0.66, cz + sz * (d / 2 + 0.08), GOLD);
  for (const sx of [-1, 1]) h.box('metal', 0.035, 0.035, d + 0.2, sx * (w / 2 + 0.08), y0 + 0.66, cz, GOLD);
  // 束腰椀花：每 2.4m 一朵
  const n = Math.max(2, Math.round(w / 2.4));
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + (w * (i + 0.5)) / n;
    for (const sz of [-1, 1]) {
      h.box('metal', 0.42, 0.16, 0.05, u, y0 + 0.48, cz + sz * (d / 2 - 0.17), shade(GOLD, 0.9));
    }
  }
}

function throneSet(h: Hall, f: Frame): void {
  // 座榻（面阔 5.4m，重檐大殿的明间尺度）
  h.box('lacquer', 5.4, 0.55, 3.2, f.x, f.y0 + 0.275, f.z, RED_D, f.ry);
  h.box('metal', 5.5, 0.07, 3.3, f.x, f.y0 + 0.57, f.z, GOLD, f.ry);
  h.box('fabric', 4.9, 0.16, 2.8, f.x, f.y0 + 0.68, f.z, CINNABAR, f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * 2.35, sv * 1.35);
    h.box('metal', 0.24, 0.26, 0.24, lx, f.y0 + 0.13, lz, GOLD_D, f.ry);
  }
  // 靠背 + 金心 + 三团龙
  const [bx, bz] = fp(f, 0, -1.35);
  h.box('lacquer', 5.2, 2.6, 0.34, bx, f.y0 + 1.95, bz, RED_D, f.ry);
  h.box('metal', 4.35, 2.05, 0.06, bx, f.y0 + 2.02, bz + 0.19, GOLD_D, f.ry);
  for (let i = -1; i <= 1; i++) {
    const [cx, cz] = fp(f, i * 1.3, -1.13);
    h.cyl('metal', 0.38, 0.38, 0.05, 12, cx, f.y0 + 2.1, cz, GOLD, f.ry, Math.PI / 2);
    h.cyl('metal', 0.24, 0.24, 0.06, 12, cx, f.y0 + 2.1, cz + 0.02, GOLD_L, f.ry, Math.PI / 2);
  }
  h.box('metal', 5.25, 0.16, 0.42, bx, f.y0 + 3.3, bz, GOLD, f.ry);
  // 扶手
  for (const su of [-1, 1]) {
    const [ax, az] = fp(f, su * 2.4, 0);
    h.box('lacquer', 0.38, 1.15, 2.9, ax, f.y0 + 1.25, az, RED_D, f.ry);
    h.box('metal', 0.46, 0.14, 3.0, ax, f.y0 + 1.86, az, GOLD, f.ry);
    h.sphere('metal', 0.16, 6, ax, f.y0 + 1.99, az + 1.4, GOLD);
  }
  // 脚踏
  const [fx, fz] = fp(f, 0, 2.35);
  h.box('wood', 3.9, 0.22, 1.2, fx, f.y0 + 0.11, fz, WOOD_D, f.ry);
  h.box('fabric', 3.55, 0.09, 1.0, fx, f.y0 + 0.26, fz, CINNABAR, f.ry);
  h.box('metal', 3.6, 0.03, 0.06, fx, f.y0 + 0.31, fz + 0.48, GOLD, f.ry);
  h.kit('throne', 1, f.y0 + 1);
}

function goldScreen(h: Hall, f: Frame): void {
  for (let i = -2; i <= 2; i++) {
    const [px, pz] = fp(f, i * 1.85, -Math.abs(i) * 0.3);
    const ang = i * 0.13;
    h.box('lacquer', 1.9, 4.3, 0.16, px, f.y0 + 2.16, pz, RED_D, f.ry + ang);
    h.box('metal', 1.68, 3.92, 0.07, px, f.y0 + 2.2, pz + 0.09, GOLD_D, f.ry + ang);
    h.box('fabric', 1.54, 3.74, 0.02, px, f.y0 + 2.2, pz + 0.14, GOLD, f.ry + ang);
    // 云龙纹：五段折线龙身 + 两朵云
    for (let k = 0; k < 5; k++) {
      h.box('metal', 0.36, 0.14, 0.03, px + (k % 2 ? 0.26 : -0.2), f.y0 + 1.3 + k * 0.5, pz + 0.16, shade(GOLD_L, 0.9), f.ry + ang, 0, k % 2 ? 0.6 : -0.5);
    }
    for (let k = 0; k < 2; k++) {
      h.box('metal', 0.4, 0.11, 0.02, px - 0.4 + k * 0.78, f.y0 + 3.4 - k * 2.2, pz + 0.17, JADE, f.ry + ang, 0, 0.3);
    }
    h.box('metal', 1.84, 0.09, 0.18, px, f.y0 + 4.34, pz, GOLD, f.ry + ang);
  }
  h.kit('screen', 5, f.y0 + 2.2);
  h.kit('goldScreenSet', 1, f.y0 + 2.2);
}

/** 香亭：四柱小亭 + 铜炉（宝座前左右各一） */
function incensePavilion(h: Hall, f: Frame): void {
  h.box('ash', 2.0, 0.16, 2.0, f.x, f.y0 + 0.08, f.z, MARBLE_D, f.ry);
  h.box('metal', 2.04, 0.03, 2.04, f.x, f.y0 + 0.17, f.z, GOLD, f.ry);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.72, sv * 0.72);
    h.box('lacquer', 0.12, 2.5, 0.12, lx, f.y0 + 1.45, lz, RED_D, f.ry);
    h.box('metal', 0.18, 0.1, 0.18, lx, f.y0 + 2.66, lz, GOLD, f.ry);
  }
  h.box('lacquer', 1.9, 0.16, 1.9, f.x, f.y0 + 2.66, f.z, RED_D, f.ry);
  h.box('roof', 2.2, 0.18, 2.2, f.x, f.y0 + 2.82, f.z, 0x2b2f36, f.ry);
  h.box('roof', 1.5, 0.26, 1.5, f.x, f.y0 + 3.04, f.z, 0x33383f, f.ry);
  h.box('roof', 0.8, 0.3, 0.8, f.x, f.y0 + 3.32, f.z, 0x2b2f36, f.ry);
  h.cyl('metal', 0.1, 0.14, 0.34, 6, f.x, f.y0 + 3.64, f.z, GOLD, f.ry);
  h.sphere('metal', 0.16, 6, f.x, f.y0 + 3.86, f.z, GOLD);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [tx, tz] = fp(f, su * 1.02, sv * 1.02);
    h.box('fabric', 0.08, 0.42, 0.08, tx, f.y0 + 2.52, tz, SILK_RED, f.ry);
  }
  const it = at(f, 0, 0, 0.1);
  incenseTable(h, it, 0.62);
  censer(h, at(it, 0, 0, 0.9), 1.25);
  h.kit('incensePavilion', 1, f.y0 + 2.6);
}

/** 仙鹤（铜鎏金，立于石座） */
function crane(h: Hall, f: Frame): void {
  h.box('ash', 1.15, 0.65, 1.15, f.x, f.y0 + 0.32, f.z, MARBLE_D, f.ry);
  h.box('metal', 1.2, 0.05, 1.2, f.x, f.y0 + 0.66, f.z, GOLD, f.ry);
  const y = f.y0 + 0.7;
  for (const su of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.14, 0.05);
    h.cyl('metal', 0.045, 0.055, 0.86, 5, lx, y + 0.43, lz, GOLD_D, f.ry);
    h.box('metal', 0.1, 0.06, 0.3, lx, y + 0.04, lz + 0.08, GOLD_D, f.ry);
  }
  h.sphere('metal', 0.36, 8, f.x, y + 1.02, f.z, GOLD, f.ry, 0, 0, 1.35, 0.85, 0.9);
  // 双翼
  for (const su of [-1, 1]) {
    const [wx, wz] = fp(f, su * 0.3, -0.02);
    h.box('metal', 0.16, 0.32, 0.62, wx, y + 1.08, wz, shade(GOLD, 0.88), f.ry, su * 0.5, 0);
  }
  // 颈 + 头 + 喙
  const [nx, nz] = fp(f, 0, 0.3);
  h.cyl('metal', 0.075, 0.1, 0.62, 6, nx, y + 1.5, nz, GOLD, f.ry, 0.32, 0);
  h.sphere('metal', 0.13, 6, nx, y + 1.84, nz + 0.1, GOLD);
  h.cyl('metal', 0.015, 0.055, 0.3, 5, nx, y + 1.86, nz + 0.3, GOLD_D, f.ry, 1.35, 0);
  h.box('metal', 0.05, 0.1, 0.14, nx, y + 1.94, nz - 0.02, CINNABAR, f.ry);
  // 尾羽
  for (let i = -1; i <= 1; i++) {
    const [tx, tz] = fp(f, i * 0.12, -0.36);
    h.box('metal', 0.12, 0.1, 0.5, tx, y + 0.98, tz, shade(GOLD, 0.82), f.ry, 0, i * 0.14);
  }
  h.kit('crane', 1, y + 1);
}

/** 宝象（铜鎏金，鞍鞯织锦） */
function elephant(h: Hall, f: Frame): void {
  h.box('ash', 1.35, 0.6, 1.35, f.x, f.y0 + 0.3, f.z, MARBLE_D, f.ry);
  h.box('metal', 1.4, 0.05, 1.4, f.x, f.y0 + 0.62, f.z, GOLD, f.ry);
  const y = f.y0 + 0.66;
  h.sphere('metal', 0.55, 8, f.x, y + 1.05, f.z, GOLD, f.ry, 0, 0, 1.25, 0.95, 0.85);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.36, sv * 0.32);
    h.cyl('metal', 0.13, 0.16, 0.62, 6, lx, y + 0.34, lz, GOLD_D, f.ry);
    h.box('metal', 0.24, 0.06, 0.28, lx, y + 0.06, lz + 0.03, GOLD_D, f.ry);
  }
  const [hx, hz] = fp(f, 0, 0.62);
  h.sphere('metal', 0.3, 7, hx, y + 1.2, hz, GOLD);
  for (const su of [-1, 1]) {
    const [ex, ez] = fp(f, su * 0.34, 0.55);
    h.box('metal', 0.4, 0.48, 0.08, ex, y + 1.22, ez, shade(GOLD, 0.9), f.ry, 0, su * 0.25);
    const [tx, tz] = fp(f, su * 0.16, 0.82);
    h.box('metal', 0.07, 0.07, 0.34, tx, y + 1.0, tz, BONE, f.ry, 1.1, 0);
  }
  for (let i = 0; i < 3; i++) {
    const [tx, tz] = fp(f, 0, 0.86 + i * 0.02);
    h.cyl('metal', 0.07, 0.09, 0.26, 5, tx, y + 1.0 - i * 0.22, tz + i * 0.06, GOLD, f.ry, 0.25 + i * 0.3, 0);
  }
  // 鞍鞯
  h.box('fabric', 0.95, 0.1, 0.85, f.x, y + 1.5, f.z, CINNABAR, f.ry);
  h.box('metal', 0.98, 0.05, 0.88, f.x, y + 1.56, f.z, GOLD, f.ry);
  for (const su of [-1, 1]) {
    const [sx, sz] = fp(f, su * 0.5, 0);
    h.box('fabric', 0.06, 0.55, 0.7, sx, y + 1.28, sz, SILK_RED, f.ry);
  }
  h.kit('elephant', 1, y + 1.2);
}

/** 甪端（独角瑞兽，铜鎏金） */
function qilin(h: Hall, f: Frame): void {
  h.box('ash', 1.15, 0.65, 1.15, f.x, f.y0 + 0.32, f.z, MARBLE_D, f.ry);
  h.box('metal', 1.2, 0.05, 1.2, f.x, f.y0 + 0.66, f.z, GOLD, f.ry);
  const y = f.y0 + 0.7;
  h.sphere('metal', 0.4, 7, f.x, y + 0.92, f.z, GOLD, f.ry, 0, 0, 1.2, 0.9, 0.85);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [lx, lz] = fp(f, su * 0.24, sv * 0.3);
    h.cyl('metal', 0.08, 0.1, 0.5, 5, lx, y + 0.28, lz, GOLD_D, f.ry);
    h.box('metal', 0.16, 0.05, 0.24, lx, y + 0.05, lz + 0.04, GOLD_D, f.ry);
  }
  const [hx, hz] = fp(f, 0, 0.42);
  h.sphere('metal', 0.25, 6, hx, y + 1.16, hz, GOLD);
  h.cyl('metal', 0.01, 0.07, 0.34, 5, hx, y + 1.42, hz - 0.02, GOLD_L, f.ry, -0.2, 0);
  for (const su of [-1, 1]) {
    const [ex, ez] = fp(f, su * 0.22, 0.34);
    h.box('metal', 0.12, 0.14, 0.08, ex, y + 1.24, ez, shade(GOLD, 0.9), f.ry);
  }
  for (const su of [-1, 1]) {
    const [mx, mz] = fp(f, su * 0.26, -0.06);
    h.box('metal', 0.14, 0.2, 0.24, mx, y + 1.02, mz, shade(GOLD, 0.86), f.ry, 0, su * 0.4);
  }
  const [tx, tz] = fp(f, 0, -0.4);
  h.box('metal', 0.1, 0.44, 0.1, tx, y + 0.9, tz, GOLD_D, f.ry, 0.9, 0);
  h.kit('qilin', 1, y + 1);
}

/** 大型立灯 / 烛台（四角） */
function floorCandelabra(h: Hall, f: Frame): void {
  h.cyl('metal', 0.42, 0.52, 0.12, 10, f.x, f.y0 + 0.06, f.z, GOLD_D, f.ry);
  h.cyl('metal', 0.09, 0.12, 2.7, 8, f.x, f.y0 + 1.4, f.z, GOLD, f.ry);
  for (const [a, aa] of [[0, 0], [2.1, 0.5], [4.2, -0.5]] as const) {
    const [ax, az] = [f.x + Math.cos(a) * 0.6, f.z + Math.sin(a) * 0.6];
    h.box('metal', 0.06, 0.06, 0.62, (f.x + ax) / 2, f.y0 + 2.55, (f.z + az) / 2, GOLD, f.ry + a + Math.PI / 2, 0, aa * 0.3);
    h.cyl('metal', 0.11, 0.07, 0.06, 6, ax, f.y0 + 2.6, az, GOLD, f.ry);
    h.cyl('fabric', 0.05, 0.055, 0.24, 5, ax, f.y0 + 2.76, az, 0xf2e6cc, f.ry);
    h.sphere('glow', 0.055, 4, ax, f.y0 + 2.92, az, FLAME, 0, 0, 0, 1, 1.7, 1);
    h.kit('candle', 1, 2.8);
  }
  h.cyl('metal', 0.16, 0.11, 0.06, 8, f.x, f.y0 + 2.78, f.z, GOLD, f.ry);
  h.cyl('fabric', 0.06, 0.065, 0.3, 5, f.x, f.y0 + 2.96, f.z, 0xf2e6cc, f.ry);
  h.sphere('glow', 0.06, 4, f.x, f.y0 + 3.16, f.z, FLAME, 0, 0, 0, 1, 1.7, 1);
  h.kit('candle', 1, 3.0);
  h.kit('floorCandelabra', 1, 2.6);
}

/** 宝座区总装：三级须弥座 + 御路踏道 + 宝座屏风御案 + 香亭 + 瑞兽 + 仪仗 + 藻井 */
function throneZone(h: Hall): void {
  // 底层须弥座后缘 = pRear − (0.9×2 + 0.18) = pRear − 1.98；1.76 让后缘停在后檐墙内皮前 2cm
  // （旧版 0.6 时后缘 −hd−1.38，已穿出墙外皮 0.42m）
  const pRear = -h.hd + 1.76;
  const pD = 14 * h.s;
  const pW = h.core * 2 + 6;
  const pf = pRear + pD;
  const pc = (pRear + pf) / 2;
  for (let t = 0; t < 3; t++) {
    const ext = (2 - t) * 0.9;
    tierBlock(h, pW + ext, pD + ext, t * 0.66, pc - ext / 2);
    h.kit('throneTier', 1, t * 0.66);
  }
  const top = 1.98;
  // 台面红毯（金边）：把宝座区从"白台阶"拉回朱红金饰的礼制核心
  h.box('fabric', pW - 4.4, 0.035, pD - 3.2, 0, top + 0.018, pc, CINNABAR);
  for (const su of [-1, 1]) h.box('fabric', 0.3, 0.045, pD - 3.2, su * (pW / 2 - 2.35), top + 0.026, pc, SILK_GOLD);
  for (const sz of [-1, 1]) h.box('fabric', pW - 4.4, 0.045, 0.3, 0, top + 0.026, pc + sz * (pD / 2 - 1.65), SILK_GOLD);
  h.kit('platformCarpet', 1, top);
  const stepW = Math.min(pW * 0.78, h.core * 1.75);
  const runW = Math.min(stepW - 2.4, 14);
  const nStep = 10;            // 级高 1.98/10 = 19.8cm（宋式 15–20cm）；旧版 7 级 28.3cm 过高
  const tread = 0.62;
  const rise = top / nStep;
  for (let i = 0; i < nStep; i++) {
    const zc = pf + (nStep - 0.5 - i) * tread;
    const sh = (i + 1) * rise;
    h.box('ash', stepW, sh, tread, 0, sh / 2, zc, i % 2 ? MARBLE : shade(MARBLE, 0.97));
    h.box('metal', stepW, 0.03, 0.06, 0, sh + 0.015, zc + tread / 2 - 0.03, GOLD);
    // 中央红毯踏步（实体红台阶，比白石高 2cm；比斜铺面可靠，远看就是一条红毯御路）
    h.box('fabric', runW, sh + 0.02, tread + 0.04, 0, (sh + 0.02) / 2, zc + 0.025, CINNABAR);
    for (const su of [-1, 1]) h.box('fabric', 0.16, sh + 0.03, tread + 0.04, su * (runW / 2 - 0.08), (sh + 0.03) / 2, zc + 0.025, SILK_GOLD);
    h.kit('throneStep', 1, sh);
  }
  h.kit('stairCarpet', nStep, top / 2);
  // 御路石（斜置，金边 + 云纹）：斜面进深跟踏道总进深一致，上下两端正好落在台面与地面
  const rampRun = nStep * tread;
  const rampL = Math.hypot(rampRun, top);
  const rampRx = Math.atan2(top, rampRun);
  const rampZ = pf + rampRun / 2;
  h.box('ash', 3.4, 0.14, rampL, 0, top / 2 + 0.04, rampZ, shade(MARBLE, 1.02), 0, rampRx, 0);
  for (const sx of [-1, 1]) {
    h.box('metal', 0.12, 0.05, rampL, sx * 1.65, top / 2 + 0.1, rampZ, GOLD, 0, rampRx, 0);
  }
  // 御路红毯（铺在斜面上，两端压金线）
  h.box('fabric', 2.5, 0.035, rampL - 0.5, 0, top / 2 + 0.13, rampZ, CINNABAR, 0, rampRx, 0);
  for (const sx of [-1, 1]) h.box('fabric', 0.16, 0.04, rampL - 0.5, sx * 1.28, top / 2 + 0.135, rampZ, SILK_GOLD, 0, rampRx, 0);
  h.kit('rampCarpet', 1, top / 2);
  // 台面压边：上枭红地金线，白台基不再是一整块白
  h.box('lacquer', pW, 0.5, 0.08, 0, top - 0.32, pf + 0.02, RED_D);
  for (const yy of [top - 0.08, top - 0.56]) h.box('metal', pW, 0.05, 0.1, 0, yy, pf + 0.03, GOLD);
  for (let i = 0; i < 4; i++) {
    const dz = 1.0 + i * 1.4;
    h.box('metal', 0.5, 0.03, 0.34, 0, top * (1 - dz / rampRun) + 0.12, pf + rampRun - dz, shade(GOLD, 0.94), 0, rampRx, 0);
  }
  h.kit('throneRamp', 1, top / 2);
  // 踏道两侧栏板
  for (const sx of [-1, 1]) {
    const posts = 8;
    for (let i = 0; i < posts; i++) {
      const zc = pf + 0.4 + (i * (rampRun - 0.5)) / (posts - 1);
      const hh = top * (1 - i / (posts - 1)) + 0.9;
      h.box('ash', 0.2, hh, 0.2, sx * (stepW / 2 + 0.24), hh / 2, zc, MARBLE);
      h.box('metal', 0.24, 0.05, 0.24, sx * (stepW / 2 + 0.24), hh + 0.02, zc, GOLD);
    }
    h.box('ash', 0.18, 0.16, rampL + 0.4, sx * (stepW / 2 + 0.24), top / 2 + 0.92, rampZ, MARBLE, 0, rampRx, 0);
    h.kit('throneRail', 1, top / 2);
  }
  // 宝座 / 屏风 / 御案
  const tf: Frame = { x: 0, z: pRear + pD * 0.42, ry: 0, y0: top };
  throneSet(h, tf);
  goldScreen(h, { x: 0, z: tf.z - 1.95, ry: 0, y0: top });
  const df = at(tf, 0, 5.3);
  desk(h, df, Math.min(5.6, pW * 0.4));
  stationery(h, at(df, -0.4, 0.15, 0.92));
  for (const su of [-1, 1]) {
    candle(h, at(df, su * 1.7, -0.1, 0.92), 1.0);
    lacquerBox(h, at(df, su * 2.2, 0.1, 0.92), 0.9);
  }
  censer(h, at(df, 0, 0.28, 0.92), 1.2);
  h.kit('throneDesk', 1, top + 1);
  // 屏壁 / 匾额 / 楹联：后檐墙不再是 195m 的空白红墙，宝座有一个礼制背景
  const bz = -h.hd + 0.35;
  h.box('lacquer', 26, 8.4, 0.24, 0, 4.2, bz, 0x5e1a16);
  h.box('metal', 26.3, 0.22, 0.3, 0, 8.45, bz, GOLD);
  h.box('metal', 26.3, 0.18, 0.3, 0, 0.09, bz, GOLD);
  for (const su of [-1, 1]) h.box('metal', 0.22, 8.4, 0.3, su * 13.1, 4.2, bz, GOLD);
  h.cyl('metal', 2.4, 2.4, 0.08, 20, 0, 5.5, bz + 0.16, GOLD_D, 0, Math.PI / 2);
  h.cyl('fabric', 2.1, 2.1, 0.1, 20, 0, 5.5, bz + 0.18, 0x7a1f1a, 0, Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    h.box('metal', 0.26, 0.5, 0.06, Math.cos(a) * 1.55, 5.5 + Math.sin(a) * 1.55, bz + 0.24, GOLD_L, 0, 0, a);
  }
  h.sphere('metal', 0.5, 8, 0, 5.5, bz + 0.26, GOLD);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.3;
    h.box('metal', 0.5, 0.12, 0.05, Math.cos(a) * (4.2 + (i % 3)), 2.2 + (i % 4) * 1.6, bz + 0.18, shade(GOLD, 0.82), 0, 0, i % 2 ? 0.5 : -0.4);
  }
  h.kit('backdrop', 1, 4.2);
  // 匾额：外挂 0.14m，避免与屏壁前脸共面闪烁（旧版两者 z 完全相同）
  h.box('lacquer', 8.2, 1.1, 0.24, 0, 8.55, bz + 0.14, 0x1b2a30);
  h.box('metal', 8.5, 0.14, 0.3, 0, 9.12, bz + 0.14, GOLD);
  h.box('metal', 8.5, 0.14, 0.3, 0, 7.98, bz + 0.14, GOLD);
  for (const su of [-1, 1]) h.box('metal', 0.14, 1.1, 0.3, su * 4.2, 8.55, bz + 0.14, GOLD);
  for (let i = 0; i < 4; i++) h.box('metal', 0.72, 0.78, 0.05, -2.7 + i * 1.8, 8.55, bz + 0.3, GOLD_L);
  h.kit('plaque', 1, 8.6);
  // 楹联（左右）
  for (const su of [-1, 1]) {
    h.box('lacquer', 1.15, 6.2, 0.16, su * 9.6, 4.3, bz + 0.1, 0x2b1a16);
    h.box('metal', 1.35, 0.14, 0.22, su * 9.6, 7.45, bz + 0.12, GOLD);
    h.box('metal', 1.35, 0.14, 0.22, su * 9.6, 1.15, bz + 0.12, GOLD);
    for (let i = 0; i < 5; i++) h.box('metal', 0.5, 0.5, 0.04, su * 9.6, 1.9 + i * 1.05, bz + 0.2, shade(GOLD, 0.9));
  }
  h.kit('couplet', 2, 4.3);
  // 香亭（左右）
  for (const su of [-1, 1]) incensePavilion(h, { x: su * (pW / 2 - 2.4), z: pf - 2.1, ry: 0, y0: top });
  // 仪仗：宝座两侧各 5 杆（戟 / 幡 / 扇）
  for (const su of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = su * (pW / 2 - 0.5);   // 旧版 −1.1 时，幡面（0.5 宽）与香亭出檐（半宽 1.1）重叠
      const z = pc - pD / 2 + 2.2 + i * 2.3;
      h.cyl('metal', 0.05, 0.06, 4.4, 6, x, top + 2.2, z, GOLD_D);
      h.box('metal', 0.06, 0.34, 0.06, x, top + 4.44, z, GOLD);
      if (i % 3 === 0) {
        h.cyl('fabric', 0.5, 0.5, 0.05, 10, x, top + 3.6, z, SILK_GOLD, Math.PI / 2);
        h.cyl('fabric', 0.3, 0.3, 0.06, 10, x, top + 3.6, z + 0.01, SILK_RED, Math.PI / 2);
      } else if (i % 3 === 1) {
        h.box('metal', 0.52, 0.62, 0.08, x, top + 3.7, z, GOLD, 0, 0, su * 0.35);
        h.box('fabric', 0.5, 1.0, 0.04, x, top + 2.85, z, SILK_RED);
      } else {
        h.box('metal', 0.46, 0.5, 0.26, x, top + 3.66, z, GOLD);
      }
      h.kit('ceremonial', 1, top + 3.2);
    }
  }
  // 藻井：四层递增圆井 + 金龙 + 宝珠
  const cy = h.ceilH - 0.12;
  for (let i = 0; i < 4; i++) {
    const r = 4.4 - i * 0.9;
    h.cyl('lacquer', r, r + 0.16, 0.5, 16, 0, cy - i * 0.44 - 0.25, tf.z, i % 2 ? JADE : TEAL, 0, 0, 0, true);
    h.cyl('metal', r + 0.06, r + 0.06, 0.06, 16, 0, cy - i * 0.44 - 0.02, tf.z, GOLD, 0, 0, 0, true);
  }
  h.cyl('metal', 1.5, 1.5, 0.1, 16, 0, cy - 1.78, tf.z, GOLD_D);
  h.cyl('metal', 1.2, 1.2, 0.06, 16, 0, cy - 1.82, tf.z, GOLD);
  h.sphere('glow', 0.26, 8, 0, cy - 1.95, tf.z, 0xffc061);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    h.box('metal', 0.16, 0.16, 0.7, Math.cos(a) * 1.0, cy - 1.72, tf.z + Math.sin(a) * 1.0, GOLD, -a, 0, 0.2);
  }
  h.kit('caisson', 1, cy - 1);
  h.kit('cofferDragon', 1, cy - 1.7);
  // 瑞兽：踏道前一对鹤 / 一对宝象 / 一对甪端
  const sz0 = pf + 6.3;
  for (const su of [-1, 1]) {
    crane(h, { x: su * (h.core + 2.0), z: sz0, ry: 0, y0: FLOOR });
    elephant(h, { x: su * (h.core + 6.8), z: sz0 - 0.6, ry: 0, y0: FLOOR });
    qilin(h, { x: su * (h.core + 11.5), z: sz0, ry: 0, y0: FLOOR });
  }
  // 四角大立灯（明间前部）：台上两盏内收到 core−2，旧版 core+1.6 会插进香亭台座
  for (const su of [-1, 1]) {
    floorCandelabra(h, { x: su * (h.core - 2.0), z: pf - 3.2, ry: 0, y0: top });
    floorCandelabra(h, { x: su * (h.core + 1.6), z: h.hd - 7, ry: 0, y0: FLOOR });
  }
}

// ============ 柱列 ============
function jinColumn(h: Hall, lx: number, lz: number, r: number): void {
  const H = h.ceilH - 0.55;
  h.box('ash', r * 2.7, 0.18, r * 2.7, lx, FLOOR + 0.09, lz, MARBLE_D);
  h.cyl('ash', r * 1.48, r * 1.62, 0.26, 12, lx, FLOOR + 0.27, lz, MARBLE);
  h.cyl('metal', r * 1.3, r * 1.3, 0.035, 12, lx, FLOOR + 0.41, lz, GOLD);
  h.cyl('wood', r, r * 1.05, H, 12, lx, FLOOR + 0.44 + H / 2, lz, RED);
  // 蟠龙：16 段贴金绕柱螺旋（段心在柱面外 8cm，接缝重叠，远看是一条连续盘绕金带）
  for (let i = 0; i < 16; i++) {
    const a = i * 0.42 + lx * 0.013;
    const yy = FLOOR + 0.95 + (i * (H - 1.7)) / 15;
    h.box('metal', 0.2, 0.52, 0.14, lx + Math.cos(a) * r * 1.06, yy, lz + Math.sin(a) * r * 1.06, i % 2 ? GOLD : GOLD_D, Math.PI / 2 - a);
  }
  h.box('metal', 0.26, 0.26, 0.2, lx + Math.cos(0.42 * 16 + lx * 0.013) * r * 1.08, H - 0.62, lz + Math.sin(0.42 * 16 + lx * 0.013) * r * 1.08, GOLD_L, Math.PI / 2 - 0.42 * 16 - lx * 0.013);
  // 柱身中部两道金箍（近人尺度可见）
  for (const yy of [H * 0.32, H * 0.58]) h.cyl('metal', r * 1.04, r * 1.04, 0.06, 12, lx, yy, lz, shade(GOLD, 0.86), 0, 0, 0, true);
  // 彩画三箍
  for (let k = 0; k < 3; k++) {
    h.cyl(k === 2 ? 'metal' : 'lacquer', r * 1.07, r * 1.07, 0.13, 12, lx, H - 0.72 + k * 0.22, lz, k === 0 ? JADE : k === 1 ? TEAL : GOLD, 0, 0, 0, true);
  }
  // 雀替：四向
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    h.box('wood', dx ? 0.92 : 0.24, 0.32, dz ? 0.92 : 0.24, lx + dx * (r + 0.34), H - 0.53, lz + dz * (r + 0.34), shade(RED, 1.05), 0, 0, dz ? 0 : dx * 0.18);
    h.box('metal', dx ? 0.3 : 0.18, 0.07, dz ? 0.3 : 0.18, lx + dx * (r + 0.34), H - 0.36, lz + dz * (r + 0.34), GOLD, 0, 0, 0);
  }
  h.cyl('metal', r * 1.1, r * 1.1, 0.16, 12, lx, H + 0.4, lz, GOLD);
  h.kit('jinColumn', 1, H * 0.5);
  h.kit('columnDragon', 1, H * 0.5);
  h.kit('columnBase', 1, 0.2);
  h.kit('corbel', 4, H - 0.5);
  h.kit('columnPainted', 3, H - 0.7);
}

function interiorColumns(h: Hall, w: number, d: number): void {
  // 与 imperial.palaceHall 内已有的 12 根 0.9×0.9 方柱**同心**：圆金柱直径 2.0m 正好包住方柱，
  // 否则两套柱列并排（方柱 0.9 见方、褐金色 = 用户截图里那排"光秃秃的褐色方柱"）。
  const xs: number[] = [];
  for (let i = 0; i < 6; i++) xs.push(-w / 2 + (w * (i + 0.5)) / 6);
  for (const sz of [-d * 0.2, d * 0.2]) {
    for (let i = 0; i < xs.length; i++) {
      jinColumn(h, xs[i], sz, 1.0);
      if (i === xs.length - 1) continue;
      const a = xs[i], b2 = xs[i + 1];
      if (a < 0 && b2 > 0) continue;   // 明间（中轴一跨）不落柱
      for (const t of [1 / 3, 2 / 3]) jinColumn(h, a + (b2 - a) * t, sz, 0.8);
    }
  }
}

/** 檐柱装饰：覆盆柱础 + 彩画箍 + 雀替（柱身朱漆由 palaceDetail 已有，不重复画） */
function eaveColumns(h: Hall, w: number, d: number): void {
  const bayN = Math.max(3, Math.round(w / 5.714) | 1);
  const bayW = w / bayN;
  const sideN = Math.max(2, Math.round(d / 5.714));
  const ch = h.ceilH;
  const gy = -0.19;   // 檐柱立在台明（比殿内地坪低 0.19）
  const dress = (lx: number, lz: number, nx: number, nz: number): void => {
    h.box('ash', 1.95, 0.14, 1.95, lx, gy + 0.07, lz, MARBLE_D);
    h.cyl('ash', 0.84, 0.9, 0.2, 10, lx, gy + 0.24, lz, MARBLE);
    h.cyl('metal', 0.74, 0.74, 0.03, 10, lx, gy + 0.35, lz, GOLD);
    h.cyl('lacquer', 0.58, 0.58, 0.16, 10, lx, gy + ch * 0.76, lz, JADE, 0, 0, 0, true);
    h.cyl('metal', 0.6, 0.6, 0.05, 10, lx, gy + ch * 0.76 + 0.1, lz, GOLD, 0, 0, 0, true);
    for (const s of [-1, 1]) {
      h.box('wood', nx ? 0.26 : 0.86, 0.3, nx ? 0.86 : 0.26, lx + (nx ? 0 : s * 0.72), gy + ch - 0.32, lz + (nx ? s * 0.72 : 0), shade(RED, 1.06));
      h.box('metal', 0.16, 0.06, 0.16, lx + (nx ? 0 : s * 0.72), gy + ch - 0.15, lz + (nx ? s * 0.72 : 0), GOLD);
    }
    h.kit('eaveColumn', 1, ch * 0.5);
    h.kit('columnBase', 1, 0);
    h.kit('eaveCorbel', 2, ch - 0.3);
    h.kit('columnPainted', 1, ch * 0.76);
  };
  for (let i = 0; i <= bayN; i++) {
    const lx = -w / 2 + i * bayW;
    dress(lx, d / 2, 0, 1);
    dress(lx, -d / 2, 0, 1);
  }
  for (let i = 1; i < sideN; i++) {
    const lz = -d / 2 + (i * d) / sideN;
    dress(w / 2, lz, 1, 0);
    dress(-w / 2, lz, 1, 0);
  }
}

// ============ 梁架 / 天花 / 宫灯 / 帷幔 ============
function beamCeiling(h: Hall): void {
  const zs: number[] = [];
  for (let z = -h.hd + 6; z <= h.hd - 6; z += 8) zs.push(z);
  for (const z of zs) {
    h.box('wood', h.hw * 2, 0.56, 0.62, 0, h.ceilH - 0.28, z, shade(WOOD_D, 1.04));
    h.box('metal', h.hw * 2, 0.06, 0.06, 0, h.ceilH - 0.58, z + 0.32, GOLD);
    const segs = Math.max(6, Math.round((h.hw * 2) / 3.6));
    for (let i = 0; i < segs; i++) {
      const u = -h.hw + (h.hw * 2 * (i + 0.5)) / segs;
      h.box(i % 2 ? 'lacquer' : 'wood', (h.hw * 2) / segs - 0.06, 0.24, 0.04, u, h.ceilH - 0.3, z + 0.33, i % 2 ? 0x275046 : 0x1f3a34);
    }
    h.kit('beam', 1, h.ceilH - 0.3);
    h.kit('paintedBeam', segs, h.ceilH - 0.3);
  }
  const xs = [0, h.core + 5.2, -(h.core + 5.2), h.hw * 0.46, -h.hw * 0.46, h.hw - 1.2, -(h.hw - 1.2)];
  for (const x of xs) {
    h.box('wood', 0.55, 0.5, h.hd * 2 - 4, x, h.ceilH - 0.25, 0, shade(WOOD_D, 0.98));
    for (const sz of [-1, 1]) h.box('metal', 0.06, 0.08, h.hd * 2 - 4, x + sz * 0.28, h.ceilH - 0.5, 0, GOLD);
    h.kit('beam', 1, h.ceilH - 0.3);
  }
  // 井口天花：12 块暗底 + 金肋
  const nx = 4, nz = 3;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const pw = (h.hw * 2) / nx, pd = (h.hd * 2) / nz;
    const cx = -h.hw + pw * (i + 0.5);
    const cz = -h.hd + pd * (j + 0.5);
    h.box('wood', pw - 0.1, 0.1, pd - 0.1, cx, h.ceilH + 0.16, cz, 0x1e2c30);
    for (let k = 0; k < 2; k++) {
      h.box('metal', 0.05, 0.03, pd - 0.3, cx - pw * 0.22 + k * pw * 0.44, h.ceilH + 0.09, cz, shade(GOLD, 0.72));
    }
    h.kit('coffer', 1, h.ceilH);
    h.kit('ceilingRib', 2, h.ceilH);
  }
  // 檐口金线（墙顶一周）
  for (const sz of [-1, 1]) h.box('metal', h.hw * 2, 0.1, 0.1, 0, h.ceilH - 0.05, sz * (h.hd - 0.25), GOLD);
  for (const sx of [-1, 1]) h.box('metal', 0.1, 0.1, h.hd * 2, sx * (h.hw - 0.15), h.ceilH - 0.05, 0, GOLD);
}

function lanternGrid(h: Hall): void {
  // 吊杆顶 = hang + 2.3：必须低于天花面（旧版 −2.0 让中和/保和殿吊杆穿出天花 0.3m）
  const hang = Math.min(h.ceilH - 2.42, 6.8);
  // 明间两列（沿殿深）
  for (const su of [-1, 1]) {
    for (let z = -h.hd + 8; z <= h.hd - 6; z += 6) {
      palaceLantern(h, { x: su * (h.core + 1.6), z, ry: 0, y0: 0 }, hang);
    }
  }
  // 两道横列（沿面阔），把整殿打成灯阵
  for (const sz of [-1, 1]) {
    const z = sz * h.hd * 0.56;
    for (let x = -h.hw + 6; x <= h.hw - 6; x += 6) {
      palaceLantern(h, { x, z, ry: 0, y0: 0 }, hang);
    }
  }
  // 后檐墙一列（宝座后方的氛围灯）
  for (let x = -h.hw + 12; x <= h.hw - 12; x += 9) {
    palaceLantern(h, { x, z: -h.hd + 2.2, ry: 0, y0: 0 }, Math.min(hang, 6.4));
  }
}

function curtains(h: Hall): void {
  const top = h.ceilH - 0.55;
  // 明间两侧垂幔（ throne zone 前缘到殿门）
  for (const su of [-1, 1]) {
    for (let z = -h.hd + 12; z <= h.hd - 10; z += 8) {
      curtain(h, { x: su * (h.core + 2.1), z, ry: Math.PI / 2, y0: 0 }, 3.0, top, 1.5);
    }
  }
  // 东西山墙垂幔
  for (const su of [-1, 1]) {
    for (let z = -h.hd + 10; z <= h.hd - 9; z += 9) {
      curtain(h, { x: su * (h.hw - 0.7), z, ry: Math.PI / 2, y0: 0 }, 2.4, top, 1.8);
    }
  }
}

// ============ 陈设条带 ============
function aisleStations(h: Hall): void {
  const area = h.hw * 2 * h.hd * 2;
  const target = Math.round(area / 160);      // 每组约 10 件 → 面积/16 件
  // 陈设列落在金柱开间中点上：旧版固定 4 列（core+9/+21/+33/hw−2.2）在太和殿把
  // 第 4 列直接贴到墙根，46–95m 之间留下 48m 空带。列数随殿宽变化，总件数不变。
  const w = (h.hw + 3) * 2;
  const base: number[] = [];
  for (let i = 0; i < 6; i++) base.push(-w / 2 + (w * (i + 0.5)) / 6);
  const cols = base.slice();
  for (let i = 0; i < base.length - 1; i++) {
    if (base[i] < 0 && base[i + 1] > 0) continue;   // 明间不落柱
    const a = base[i], b = base[i + 1];
    cols.push(a + (b - a) / 3, a + ((b - a) * 2) / 3);
  }
  cols.sort((a, b) => a - b);
  const bays: number[] = [];
  for (let i = 0; i < cols.length - 1; i++) {
    const m = (cols[i] + cols[i + 1]) / 2;
    if (m >= h.core + 5 && m <= h.hw - 3) bays.push(m);
  }
  const outer = (cols[cols.length - 1] + h.hw + 0.24) / 2;
  if (outer >= h.core + 5 && outer <= h.hw - 3) bays.push(outer);
  const nCol = Math.max(3, Math.min(5, Math.round((h.hw - h.core - 12) / 22) + 1));
  const offsets = [...new Set(bays.length <= nCol
    ? bays
    : Array.from({ length: nCol }, (_, i) => {
      const ideal = bays[0] + ((bays[bays.length - 1] - bays[0]) * i) / (nCol - 1);
      return bays.reduce((best, v) => (Math.abs(v - ideal) < Math.abs(best - ideal) ? v : best), bays[0]);
    }))];
  const z0 = -h.hd + 3.5, z1 = h.hd - 7;
  const fixed = 0;
  const per = Math.max(2, Math.round((target - fixed) / (offsets.length * 2)));
  const step = (z1 - z0) / Math.max(1, per - 1);
  const pRear = -h.hd + 1.76, pf = pRear + 14 * h.s;
  for (const ax of offsets) {
    for (const su of [-1, 1]) {
      // 条带下的通毯：把一列家具在视觉上连成"一处陈设"而不是散落桌椅
      const rx = su * ax;
      h.box('fabric', 4.6, 0.028, h.hd * 2 - 10, rx, 0.05, 0, shade(SILK_RED, 0.84));
      for (const ss of [-1, 1]) h.box('fabric', 0.14, 0.034, h.hd * 2 - 10, rx + ss * 2.24, 0.056, 0, shade(SILK_GOLD, 0.9));
      h.kit('carpetRunner', 1, 0);
      for (let i = 0; i < per; i++) {
        const z = z0 + i * step;
        // 踏道前瑞兽区留白 + 金柱行前后 2.8m 留白（否则条带家具会穿柱础）
        if (Math.abs(z - (pf + 6.3)) < 4.6 && Math.abs(ax) < h.core + 15) continue;
        if (Math.abs(Math.abs(z) - h.colZ) < 2.8) continue;
        const kind = Math.abs(Math.round(hash01(h.seed + i * 17 + Math.round(ax * 3)) * 8)) % 8;
        const f: Frame = { x: su * ax, z, ry: su > 0 ? -Math.PI / 2 : Math.PI / 2, y0: FLOOR };
        station(h, f, kind);
      }
    }
  }
}

function wallRows(h: Hall): void {
  const pW = h.core * 2 + 6;
  // 后檐墙供桌（宝座两侧）：贴墙 5cm，左右对称排布（旧版从 −hw+4 起步，左侧会压到须弥座）
  const stepX = 6.8;
  const nX = Math.floor((h.hw - 4) / stepX);
  for (let i = -nX; i <= nX; i++) {
    const x = i * stepX;
    if (Math.abs(x) < pW / 2 + 2.8) continue;
    wallTable(h, { x, z: -h.hd + 0.24, ry: 0, y0: FLOOR });
  }
  // 前檐墙内侧（殿门两厢）
  for (const su of [-1, 1]) {
    for (let x = h.core + 8; x <= h.hw - 6; x += 7.4) {
      wallTable(h, { x: su * x, z: h.hd - 0.24, ry: Math.PI, y0: FLOOR });
    }
  }
  // 东西山墙：供桌带（每 6.4m 一张）+ 织锦挂幔（每 9.5m 一幅）——桌背贴墙、挂幔贴墙面
  for (const su of [-1, 1]) {
    const wx = su * (h.hw - 0.24);
    for (let z = -h.hd + 9; z <= h.hd - 9; z += 6.4) {
      wallTable(h, { x: wx, z, ry: su > 0 ? -Math.PI / 2 : Math.PI / 2, y0: FLOOR });
    }
    const bx = su * (h.hw + 0.2);
    for (let z = -h.hd + 12; z <= h.hd - 12; z += 9.5) {
      h.box('fabric', 0.08, 4.6, 2.6, bx, 3.4, z, SILK_RED);
      h.box('metal', 0.1, 0.12, 2.72, bx, 5.68, z, GOLD);
      h.box('metal', 0.1, 0.12, 2.72, bx, 1.12, z, GOLD);
      for (const sz of [-1, 1]) h.box('metal', 0.1, 4.6, 0.1, bx, 3.4, z + sz * 1.3, GOLD);
      h.cyl('metal', 0.6, 0.6, 0.05, 12, bx, 3.6, z, GOLD, 0, 0, Math.PI / 2);
      h.cyl('fabric', 0.44, 0.44, 0.06, 12, bx, 3.6, z, 0x7a1f1a, 0, 0, Math.PI / 2);
      h.kit('wallHanging', 1, 3.4);
    }
  }
}

// ============ 主入口 ============
export function furnishPalaceInterior(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; scale: number; salt: number }): void {
  const h = new Hall(b, o);
  const s = h.s;
  const pRear = -h.hd + 1.76;
  const pf = pRear + 14 * s;

  // ① 金砖地面：深色垫层 + 大块方砖分格（明暗按确定性哈希），砖缝读成暗金缝而不是白石板
  // 砖面顶 = FLOOR（0.06），也是殿内一切落地物的基准（见文件头 FLOOR 注释）
  h.box('lacquer', h.hw * 2, 0.02, h.hd * 2, 0, 0.006, 0, 0x241f18);
  const nx = Math.max(4, Math.round((h.hw * 2) / 8.4));
  const nz = Math.max(3, Math.round((h.hd * 2) / 8.4));
  const pw = (h.hw * 2) / nx, pd = (h.hd * 2) / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const cx = -h.hw + pw * (i + 0.5);
    const cz = -h.hd + pd * (j + 0.5);
    h.box('ash', pw - 0.07, 0.05, pd - 0.07, cx, 0.035, cz, shade(JINZHUAN, 0.86 + 0.26 * hash01(h.seed + i * 31 + j * 7)));
    h.kit('floorPanel', 1, 0);
  }
  // 地面金线（每 8.4m 一道）
  for (let i = 1; i < nx; i++) {
    h.box('metal', 0.035, 0.012, h.hd * 2, -h.hw + pw * i, 0.052, 0, shade(GOLD, 0.6));
  }
  for (let j = 1; j < nz; j++) {
    h.box('metal', h.hw * 2, 0.012, 0.035, 0, 0.052, -h.hd + pd * j, shade(GOLD, 0.6));
  }

  // ② 红地金边地毯：踏道 → 殿门；次间通毯
  const cw = Math.min(12, h.core * 0.86);
  const z0 = pf + 4.4, z1 = h.hd - 1.2;
  if (z1 > z0) {
    const len = z1 - z0, cz = (z0 + z1) / 2;
    h.box('fabric', cw, 0.035, len, 0, 0.05, cz, CINNABAR);
    for (const su of [-1, 1]) h.box('fabric', 0.34, 0.045, len, su * (cw / 2 - 0.17), 0.06, cz, SILK_GOLD);
    for (const [zz, ww] of [[z0, cw], [z1, cw]]) h.box('fabric', ww, 0.045, 0.34, 0, 0.06, zz, SILK_GOLD);
    for (let i = 0; i < Math.max(3, Math.round(len / 7)); i++) {
      const mz = z0 + (len * (i + 0.5)) / Math.max(3, Math.round(len / 7));
      h.cyl('fabric', 0.62, 0.62, 0.018, 12, 0, 0.07, mz, SILK_GOLD);
      h.cyl('fabric', 0.4, 0.4, 0.02, 12, 0, 0.072, mz, shade(CINNABAR, 1.18));
      h.cyl('fabric', 0.14, 0.14, 0.022, 8, 0, 0.074, mz, SILK_GOLD);
    }
    h.kit('carpet', 1, 0);
  }
  for (const su of [-1, 1]) {
    const rx = su * (h.core + 12);
    if (Math.abs(rx) < h.hw - 2) {
      h.box('fabric', 3.4, 0.03, h.hd * 2 - 8, rx, 0.05, 0, shade(SILK_RED, 0.86));
      for (const ss of [-1, 1]) h.box('fabric', 0.16, 0.035, h.hd * 2 - 8, rx + ss * 1.62, 0.055, 0, SILK_GOLD);
      h.kit('carpetRunner', 1, 0);
    }
  }

  // ③ 宝座区 / ④ 柱列 / ⑤ 梁架天花 / ⑥ 灯具 / ⑦ 帷幔 / ⑧ 陈设条带
  throneZone(h);
  interiorColumns(h, o.w, o.d);
  eaveColumns(h, o.w, o.d);
  beamCeiling(h);
  lanternGrid(h);
  curtains(h);
  aisleStations(h);
  wallRows(h);

  // ⑨ 明间地毯两侧香炉对（沿御路成列）+ 殿门内大鼎一对
  const stepW = Math.min((h.core * 2 + 6) * 0.78, h.core * 1.75);
  for (let i = 0; i < Math.max(2, Math.round((h.hd * 2 - 20) / 12)); i++) {
    const z = pf + 8.4 + i * 12;      // 让开加长后的踏道脚（pf+6.2）
    if (z > h.hd - 5) break;
    for (const su of [-1, 1]) {
      const x = su * (cw / 2 + 1.36);
      h.cyl('ash', 0.42, 0.48, 0.5, 8, x, FLOOR + 0.25, z, MARBLE_D);
      censer(h, { x, z, ry: 0, y0: FLOOR + 0.5 }, 1.35);
      h.kit('carpetCenser', 1, 0.9);
    }
  }
  for (const su of [-1, 1]) {
    bronzeDing(h, { x: su * (stepW / 2 + 3.2), z: h.hd - 5.2, ry: 0, y0: FLOOR }, 1.3);
    incenseTable(h, { x: su * (stepW / 2 + 5.6), z: h.hd - 5.2, ry: 0, y0: FLOOR });
    vase(h, { x: su * (stepW / 2 + 5.6), z: h.hd - 5.2, ry: 0, y0: FLOOR + 1.0 }, 2);
    h.kit('doorDing', 1, 1.2);
  }

  b.kit('palace.interior.hall', 1, h.y);
  b.kit('palace.hall.' + h.hall + '.hall', 1, h.y);
}
