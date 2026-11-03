import { Baker, shade } from '../city/bake';

/**
 * 长阶登天 + 石灯柱列 + 巨大天门（参考图 R1「长阶登天」、R5「巨大天门」、R9「三门」）。
 *
 * 形制：
 *   - 云海中一条 60m 宽汉白玉长阶，踏面 1.2m、踢面 0.35m，200 级；两侧垂带石 + 望柱栏板
 *   - 阶两侧石灯柱列：柱距 30m、通高 18m、柱径 2m，柱顶六面灯亭 + 四角攒尖顶 + 夜明珠
 *   - 天门三开间：中门净高 60m / 净宽 36m，两墩各宽 40m / 高 90m，墩顶各倾一道 30m 宽、
 *     90m 落差的 water 组水帘（细股，不是实心板）；墩面竖凹槽 + 三道浮雕带
 *   - 门楼三重檐歇山顶（roof 组金瓦）+ 檐下密排斗栱，中门上方金边匾额
 *   - 门前一对汉白玉石狮（须弥座，通高 6m），门前深色抛光石广场（lacquer 组，竖向高光条）
 *
 * 坐标空间：**缩放前**。调用方 scaleHeavenGeometry 会把 y>150 且 |x|,|z|<1500 的顶点
 * 绕 (0,196,0) 等比放大 2.2×。这条规则是本模块全部落位的硬约束：
 *   · 任何构件都必须整块落在 y>150 一侧，跨过 y=150 会被撕出 55m 断口
 *     （150.0 以下不缩放、150.1 以上映射到世界 94.8）。
 *   · 200 级 × 0.35 = 70m 落差，故阶梯顶面最低只能到 150.1+70 ≈ 220.1；
 *     取 221.0（世界 251.0），阶脚 151.0（世界 97.0，沉在云海之下，被阶脚云团收住）。
 *   · 世界口径：阶宽 132m、踏面 2.64m、踢面 0.77m、灯柱 39.6m、天门墩高 198m、
 *     中门净高 132m、总宽 255m。
 *
 * 落位（缩放前 → 世界）：
 *   阶梯顶 z=-135.7（世界 -298.4）正对南天门 z=-85；向 −z 每级下降，阶脚 z=-375.7（世界 -826.5）。
 *   天门中心 z=-127.7（世界 -281），门地面 221.0（世界 251）——比云海顶面高约 49m，
 *   墩墙下接 26m 高汉白玉须弥台，台身没入云中，读作"云海里长出来的巨门"。
 *   现有南天门（z=-85，世界 -187）原样保留，在本门之后 100m，构成"外天门—内南天门"两重门。
 */
export function buildHeavenStair(b: Baker): void {
  buildStair(b);
  buildLampPosts(b);
  buildTerrace(b);
  buildGate(b);
  buildLions(b);
  buildCloudFoot(b);
  b.kit('heaven.stair.step', STEPS, BOTTOM_Y);
  b.kit('heaven.stair.lamp', LAMP_COUNT * 2, TOP_Y);
  b.kit('heaven.gate.pier', 2, GATE_Y);
  b.kit('heaven.gate.lion', 2, GATE_Y);
}

// ============ 尺寸与标高（缩放前，米） ============
const TREAD = 1.2;
const RISE = 0.35;
const STEPS = 200;
const STAIR_W = 60;
/** 阶梯顶面（第一级踏面）= 天门地面 */
const TOP_Z = -135.7;
const TOP_Y = 221.0;
const BOTTOM_Z = TOP_Z - STEPS * TREAD;
const BOTTOM_Y = TOP_Y - STEPS * RISE;
/** 踏步箱体厚：底边必须留在 y>150 一侧（151.0-0.9=150.1） */
const STEP_H = 0.9;
const SLOPE = RISE / TREAD;
const SLOPE_ANG = Math.atan(SLOPE);

/** 天门 */
const GATE_Z = -127.7;
const GATE_Y = TOP_Y;
const GATE_D = 16;
const GATE_W = 116;
const GATE_H = 90;
const GATE_TOP = GATE_Y + GATE_H;
/** 中门：净宽 36、净高 60（42 直颊 + R18 半圆券） */
const OPEN_HW = 18;
const OPEN_SPRING = GATE_Y + 42;
/** 侧门：净宽 13、净高 30（R6.5） */
const SIDE_HW = 6.5;
const SIDE_SPRING = GATE_Y + 24;

const LAMP_STEP = 30;
const LAMP_X = 38.5;
const LAMP_COUNT = 8;

// ============ 调色板 ============
const JADE = 0xcac1ae;           // 汉白玉（压一档暖灰，避免整片裁白）
const JADE_HI = shade(JADE, 1.05);
const JADE_D = shade(JADE, 0.80);
const JADE_DD = shade(JADE, 0.62);
const GOLD = 0xc79a35;
const GOLD_HI = shade(GOLD, 1.24);
const GOLD_D = shade(GOLD, 0.66);
const GOLD_DD = shade(GOLD, 0.46);
const DARK = 0x14161c;           // 近黑抛光石
const DARK_HI = 0x39414f;
const JOINT = 0x7d7a6c;
const WATER_C = 0xeafaff;
const WATER_D = 0x5f95b0;
const WATER_E = 0xa8d6e8;
const LAMP = 0xffb95e;
const LAMP_HI = 0xffe2ab;
const CLOUD = 0xe4ebf4;
const CLOUD_D = 0xbfcbdb;

const TAU = Math.PI * 2;

const surfaceY = (z: number): number => TOP_Y - (TOP_Z - z) * SLOPE;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** 确定性抖动（不用 Math.random，保证每次烘焙逐值一致） */
let seed = 0x9e3779b9;
const rnd = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// ============ 长阶 ============
function buildStair(b: Baker): void {
  for (let i = 0; i < STEPS; i++) {
    const zc = TOP_Z - (i + 0.5) * TREAD;
    const yTop = TOP_Y - i * RISE;
    // 三档明度微差：远看是整片白玉，近看有石作层次，不读成"条纹"
    const tone = i % 7 === 3 ? JADE_HI : i % 5 === 2 ? shade(JADE, 0.965) : JADE;
    b.box('ash', STAIR_W, STEP_H, TREAD, 0, yTop - STEP_H / 2, zc, tone);
    // 踏步前缘一道压深缝（0.12m），让 200 级在低角度也读得出级数
    b.box('ash', STAIR_W - 0.12, 0.035, 0.14, 0, yTop + 0.018, zc - TREAD / 2 + 0.07, JADE_D);
    // 踢面压深一档：远看是连续水平暗带，级数才读得出来（否则整条阶读成一条白坡）
    b.box('ash', STAIR_W - 0.06, 0.315, 0.07, 0, yTop - 0.19, zc - TREAD / 2 - 0.035, shade(JADE, 0.76));
  }

  const run = STEPS * TREAD;
  const drop = STEPS * RISE;
  const len = Math.hypot(run, drop);
  const cz = (TOP_Z + BOTTOM_Z) / 2;
  const cy = (TOP_Y + BOTTOM_Y) / 2;
  // 斜置长箱的最低角 = cy + 0.35 - 1.3 - (len/2)·sinθ - 1.3·cosθ ≈ 149.6 < 150 ——
  // 会踩到缩放阈值被撕开。故斜箱整体沿坡上移 7m 并把长度收短 14m，末端藏进阶脚云团。
  const czS = cz + 7;
  const cyS = cy + 7 * SLOPE;

  for (const s of [-1, 1]) {
    const x = s * (STAIR_W / 2 + 1);
    // 垂带石：2m 宽、随阶倾斜，顶面高出踏面 0.35
    b.box('ash', 2, 2.6, len - 14, x, cyS + 0.35 - 1.3, czS, JADE_D, 0, -SLOPE_ANG, 0);
    b.box('ash', 2.14, 0.18, len - 14, x, cyS + 0.44, czS, JADE_HI, 0, -SLOPE_ANG, 0);
    // 外沿压边（把踏步端头封住，侧视不露锯齿）
    b.box('ash', 0.5, 3.2, len - 14, x + s * 1.15, cyS + 0.1 - 1.6, czS, JADE_DD, 0, -SLOPE_ANG, 0);
  }

  // 望柱 + 栏板：贴垂带石顶，柱距 3.6m；寻杖随阶倾斜
  const postPitch = 3.6;
  const nPost = Math.floor(run / postPitch);
  for (const s of [-1, 1]) {
    const x = s * (STAIR_W / 2 + 1);
    for (let i = 0; i <= nPost; i++) {
      const z = TOP_Z - 0.6 - i * postPitch;
      if (z < BOTTOM_Z + 0.6) break;
      const y = surfaceY(z) + 0.35;
      b.box('ash', 0.56, 1.16, 0.56, x, y + 0.58, z, JADE_HI);
      b.box('ash', 0.72, 0.14, 0.72, x, y + 1.22, z, JADE_D);
      b.cyl('ash', 0.30, 0.22, 0.16, 8, x, y + 1.36, z, JADE_HI);
      b.sphere('ash', 0.26, 8, x, y + 1.54, z, JADE, 0, 0, 0, 1, 1.15, 1);
      // 栏板（两柱之间）
      if (i < nPost) {
        const zm = z - postPitch / 2;
        if (zm > BOTTOM_Z + 0.6) {
          const ym = surfaceY(zm) + 0.35;
          b.box('ash', 0.26, 0.66, postPitch - 0.7, x, ym + 0.62, zm, JADE);
          // 栏板浮雕圆牌
          b.sphere('ash', 0.22, 6, x + s * 0.14, ym + 0.62, zm, JADE_HI, 0, 0, 0, 0.35, 0.85, 1);
        }
      }
    }
    // 寻杖两道（整段一根斜箱，比逐间拼省面数）
    b.box('ash', 0.3, 0.19, len - 1.2, x, cy + 1.62, cz, JADE_HI, 0, -SLOPE_ANG, 0);
    b.box('ash', 0.22, 0.12, len - 1.2, x, cy + 1.30, cz, JADE_D, 0, -SLOPE_ANG, 0);
  }
}

// ============ 石灯柱列 ============
function buildLampPosts(b: Baker): void {
  // 门前广场两对（站在 221 台面上）
  for (const z of [-146, -170]) {
    for (const s of [-1, 1]) buildLampPost(b, s * 41, TOP_Y, z);
  }
  // 阶旁 6 对（自台阶顶以南 60m 起，柱距 30m；台翼以南才落柱，避免埋进广场台身）
  for (let z = TOP_Z - 60; z > BOTTOM_Z + 18; z -= LAMP_STEP) {
    for (const s of [-1, 1]) buildLampPost(b, s * LAMP_X, surfaceY(z), z);
  }
}

/** 单根灯柱：通高 ≈18.4m（台座 1.6 + 柱身 10.4 + 柱头 1.0 + 灯亭 3.2 + 攒尖 1.8 + 珠 0.9） */
function buildLampPost(b: Baker, x: number, y0: number, z: number): void {
  // 台座（两级方座 + 覆莲线脚）
  b.box('ash', 3.8, 0.9, 3.8, x, y0 + 0.45, z, JADE_D);
  b.box('ash', 3.2, 0.6, 3.2, x, y0 + 1.2, z, JADE);
  b.cyl('ash', 1.34, 1.52, 0.36, 12, x, y0 + 1.68, z, JADE_HI);

  // 柱身：柱径 2m、高 10.4m、收分 0.18m
  const shaftY = y0 + 1.86;
  const shaftH = 10.4;
  b.cyl('ash', 0.86, 1.02, shaftH, 14, x, shaftY + shaftH / 2, z, JADE);
  // 8 道竖向凹槽
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.19;
    const r = 0.97;
    b.box('ash', 0.22, shaftH - 0.5, 0.16, x + Math.cos(a) * r, shaftY + shaftH / 2, z + Math.sin(a) * r, JADE_D, -a);
  }
  // 柱身中段金箍（分节，破掉一根到底的"杆"感）
  b.cyl('wood', 1.0, 1.0, 0.26, 14, x, shaftY + shaftH * 0.52, z, GOLD_D);
  // 柱头：金箍 + 仰莲 + 斗
  b.cyl('wood', 1.1, 1.1, 0.36, 14, x, shaftY + shaftH + 0.18, z, GOLD_D);
  b.cyl('ash', 1.42, 1.06, 0.34, 14, x, shaftY + shaftH + 0.53, z, JADE_HI);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    b.sphere('ash', 0.26, 6, x + Math.cos(a) * 1.24, shaftY + shaftH + 0.66, z + Math.sin(a) * 1.24, JADE_HI, -a, 0, 0, 0.6, 0.5, 0.85);
  }

  // 灯亭：六面柱身（攒尖顶下），灯室 3.2m 高、对角 3.2m
  const lanY = shaftY + shaftH + 1.0;
  b.cyl('ash', 1.66, 1.46, 0.4, 6, x, lanY + 0.2, z, JADE_D, Math.PI / 6);
  b.cyl('ash', 1.34, 1.56, 3.1, 6, x, lanY + 1.95, z, JADE, Math.PI / 6);
  // 灯芯：整室暖金（glow）
  b.box('glow', 2.05, 2.45, 2.05, x, lanY + 1.92, z, LAMP);
  // 六角金柱 + 上下窗楣，窗洞之间的实面让灯室读成"亭"而不是灯笼
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    const cx2 = x + Math.cos(a) * 1.5, cz2 = z + Math.sin(a) * 1.5;
    b.box('wood', 0.22, 3.3, 0.22, cx2, lanY + 1.95, cz2, GOLD_D, -a);
    // 窗棂（两根细金条，横跨窗洞）
    for (const oy of [-0.55, 0.55]) {
      b.box('wood', 0.09, 0.09, 1.5, cx2 - Math.cos(a) * 0.06, lanY + 1.95 + oy, cz2 - Math.sin(a) * 0.06, GOLD_D, -a + Math.PI / 2);
    }
    b.box('wood', 0.10, 0.14, 1.62, x + Math.cos(a) * 1.52, lanY + 3.42, z + Math.sin(a) * 1.52, GOLD, -a + Math.PI / 2);
    b.box('wood', 0.10, 0.14, 1.62, x + Math.cos(a) * 1.52, lanY + 0.52, z + Math.sin(a) * 1.52, GOLD_D, -a + Math.PI / 2);
  }
  b.cyl('ash', 1.78, 1.66, 0.3, 6, x, lanY + 3.62, z, JADE_HI, Math.PI / 6);
  // 四角攒尖顶（金瓦，出檐 2.6m）
  b.pyramid('roof', 0.26, 2.45, x, lanY + 4.72, z, GOLD_D, Math.PI / 4, 1.0, 1.95, 1.0);
  b.cyl('wood', 2.5, 1.35, 0.22, 4, x, lanY + 3.86, z, GOLD, Math.PI / 4);
  b.box('roof', 0.36, 0.34, 0.36, x, lanY + 5.78, z, GOLD_HI);
  // 夜明珠
  b.sphere('glow', 0.46, 10, x, lanY + 6.28, z, LAMP_HI);
  b.cyl('wood', 0.34, 0.16, 0.24, 8, x, lanY + 5.88, z, GOLD);
}

// ============ 门前台明 / 广场 ============
function buildTerrace(b: Baker): void {
  const deck = TOP_Y;
  const halfW = 86;

  // 北段台明（门座）：z -108…-136 整片；南侧只留两翼，中缝让 60m 长阶穿过
  b.box('ash', halfW * 2, 2.6, 30, 0, deck - 1.3, -122, JADE_D);
  b.box('lacquer', halfW * 2 - 1.2, 0.14, 29.2, 0, deck + 0.05, -122, DARK);
  // 台明外皮（须弥座三道线脚）
  for (const s of [-1, 1]) {
    b.box('ash', 1.4, 3.2, 30.4, s * (halfW - 0.2), deck - 1.6, -122, JADE);
    b.box('ash', 2.0, 0.5, 30.4, s * (halfW - 0.2), deck - 3.2, -122, JADE_D);
  }

  // 两翼广场（阶两侧各 50m 宽、44m 深）：深色抛光石 + 竖向高光条
  for (const s of [-1, 1]) {
    const x0 = s * 30, x1 = s * halfW;
    const cx = (x0 + x1) / 2;
    const w = Math.abs(x1 - x0);
    const zc = -158;
    b.box('ash', w, 2.6, 44, cx, deck - 1.3, zc, JADE_D);
    b.box('lacquer', w - 1.0, 0.14, 43.4, cx, deck + 0.05, zc, DARK);
    // 石缝（横向 + 纵向，浅灰）
    for (let z = -137.5; z > -180; z -= 3.4) {
      b.box('lacquer', w - 1.4, 0.02, 0.10, cx, deck + 0.135, z, shade(JOINT, 0.6));
    }
    for (let k = 1; k < 6; k++) {
      b.box('lacquer', 0.10, 0.02, 43.2, x0 + s * k * 8.2, deck + 0.135, zc, shade(JOINT, 0.55));
    }
    // 竖向高光条：模拟柱列/天光在抛光面上的拉长倒影
    for (let k = 0; k < 7; k++) {
      const hx = x0 + s * (5 + k * 6.6);
      b.box('lacquer', 0.55 + (k % 3) * 0.22, 0.012, 26 + (k % 4) * 4, hx, deck + 0.145, zc + (k % 2 ? 5 : -4), DARK_HI);
    }
    // 中央倒影带（正对阶梯的一道光）
    b.box('lacquer', 1.1, 0.010, 40, s * 33.4, deck + 0.150, zc, shade(DARK_HI, 1.15));
    // 外沿金线
    b.box('wood', 0.09, 0.012, 43.4, x1 - s * 0.9, deck + 0.15, zc, shade(GOLD, 0.85));

    // 翼台外沿：汉白玉栏杆（望柱 + 寻杖）
    for (let i = 0; i <= 10; i++) {
      const z = -137 + i * 4.2;
      b.box('ash', 0.5, 1.2, 0.5, x1 - s * 0.7, deck + 0.6, z, JADE_HI);
      b.sphere('ash', 0.22, 6, x1 - s * 0.7, deck + 1.32, z, JADE);
    }
    b.box('ash', 0.3, 0.2, 43.4, x1 - s * 0.7, deck + 1.16, x1 ? zc : zc, JADE_HI);
    // 靠阶一侧的栏板（望柱 + 寻杖），把 60m 长阶框住
    const xin = s * 30.7;
    b.box('ash', 0.46, 1.1, 43.2, xin, deck + 0.55, zc, JADE);
    b.box('ash', 0.62, 0.16, 43.2, xin, deck + 1.14, zc, JADE_HI);
    for (let i = 0; i <= 10; i++) {
      const zz = -137 + i * 4.2;
      b.box('ash', 0.64, 1.3, 0.64, xin, deck + 0.65, zz, JADE);
      b.sphere('ash', 0.28, 6, xin, deck + 1.38, zz, JADE_HI, 0, 0, 0, 1, 1.1, 1);
    }
    // 台身外皮：三级收分（每级 8m、内收 1.3m），读作石砌崖台而不是一块灰板
    for (let k = 0; k < 3; k++) {
      const inset = k * 1.3;
      const yy = deck - 1.3 - 4.2 - k * 8;
      b.box('ash', w - inset * 2, 8, 1.5, cx, yy, -180.4 + inset, JADE_D);
      b.box('ash', 1.5, 8, 44 - inset, x1 - s * (0.7 + inset), yy, zc, JADE_D);
      b.box('ash', w - inset * 2 + 0.4, 0.32, 1.7, cx, yy + 4.0, -180.4 + inset, JADE_HI);
    }
    // 外皮两道通长石线（把 12m 高的台身分三段，不读成一整块灰板）
    b.box('ash', w + 0.5, 0.5, 1.9, cx, deck - 2.5, -180.4, JADE_HI);
    b.box('ash', 1.9, 0.5, 44.4, x1 - s * 0.5, deck - 2.5, zc, JADE_HI);
    b.box('ash', w + 0.2, 0.35, 1.8, cx, deck - 6.9, -180.4, shade(JADE, 0.72));
    b.box('ash', 1.8, 0.35, 44.2, x1 - s * 0.5, deck - 6.9, zc, shade(JADE, 0.72));
  }

  // 台明/广场两侧与后部的须弥座束腰
  b.box('ash', halfW * 2, 1.0, 1.6, 0, deck - 3.4, -136.4, JADE_DD);
}

// ============ 巨大天门 ============
function buildGate(b: Baker): void {
  // ---- 墩台：门地面下的白玉桥拱（60m 跨），南面读作巨拱而不是一堵实心墙 ----
  const POD_TOP = GATE_Y;
  const POD_BASE = GATE_Y - 30;
  for (const s of [-1, 1]) {
    b.box('ash', 35, 30, 26, s * 47.5, (POD_BASE + POD_TOP) / 2, GATE_Z, JADE_D);
    b.box('ash', 36, 1.2, 26.8, s * 47.5, POD_BASE + 0.6, GATE_Z, JADE);
    b.box('ash', 36, 0.9, 26.8, s * 47.5, POD_TOP - 0.6, GATE_Z, JADE_HI);
  }
  archFill(b, 0, POD_BASE + 1, 29, 26, GATE_Z, JADE_D);
  archRing(b, 0, POD_BASE + 1, 29, GATE_Z - 13.3, GATE_Z + 13.3, 22);
  // 拱洞是**贯通**的（后面直通主平台），不做暗腔：从阶顶下望能透光，才不读成黑窟窿
  b.box('ash', 60.5, 0.7, 26, 0, POD_BASE + 0.4, GATE_Z, JADE_DD);

  // ---- 墩墙：外侧 15m 实墙 + 中缝 12m 实墙 + 侧门上方 60m 墙身 ----
  for (const s of [-1, 1]) {
    const zc = GATE_Z;
    // 外侧大墩（x 43…58）
    b.box('ash', 15, GATE_H, GATE_D, s * 50.5, GATE_Y + GATE_H / 2, zc, JADE);
    // 中缝（x 18…30），整高 90
    b.box('ash', 12, GATE_H, GATE_D, s * 24, GATE_Y + GATE_H / 2, zc, JADE);
    // 侧门上方（x 30…43）：自 251.4 起 60m
    b.box('ash', 13, 60, GATE_D, s * 36.5, GATE_Y + 30 + 30, zc, JADE);
    // 侧门半圆券填角（R6.5，起券 245.4）
    archFill(b, s * 36.5, SIDE_SPRING, SIDE_HW, GATE_D, zc, JADE);

    // 竖向壁柱 + 深缝（0.5 宽深槽才在逆光里读得出来）
    for (const face of [-1, 1]) {
      const zf = zc + face * (GATE_D / 2 + 0.17);
      for (let k = 0; k < 9; k++) {
        const gx = s * (59.4 - 3.6 * k);
        if (Math.abs(gx) < 31.6) continue;
        b.box('ash', 1.05, GATE_H - 6, 0.40, gx, GATE_Y + GATE_H / 2 - 1.0, zf, JADE_HI);
        b.box('ash', 0.46, GATE_H - 6.6, 0.52, gx + s * 0.74, GATE_Y + GATE_H / 2 - 1.0, zf, shade(JADE, 0.50));
      }
      // 两道通长石缝（把 90m 高分三段，否则整面读不出高度）
      for (const by of [GATE_Y + 30, GATE_Y + 60]) {
        b.box('ash', 40.4, 0.42, 0.44, s * 38, by, zf + face * 0.02, shade(JADE, 0.58));
      }
      // 内凹壁板（外墩中部 + 侧门上方各一块）：深色板 + 凸边，破掉 40m 白板
      for (const [px, pw, py, ph] of [[s * 50.5, 10.6, GATE_Y + 47, 56], [s * 36.5, 9.4, GATE_Y + 57, 36]] as [number, number, number, number][]) {
        b.box('ash', pw, ph, 0.55, px, py, zf + face * 0.06, shade(JADE_D, 0.66));
        b.box('ash', pw + 1.5, 0.7, 0.6, px, py + ph / 2 + 0.35, zf, JADE_HI);
        b.box('ash', pw + 1.5, 0.7, 0.6, px, py - ph / 2 - 0.35, zf, JADE_HI);
        b.box('ash', 0.7, ph + 1.4, 0.6, px - pw / 2 - 0.4, py, zf, JADE_HI);
        b.box('ash', 0.7, ph + 1.4, 0.6, px + pw / 2 + 0.4, py, zf, JADE_HI);
      }
      // 浮雕带三道（凸出长条 + 其上密排小雕块）
      for (const by of [GATE_Y + 16, GATE_Y + 41, GATE_Y + 66]) {
        b.box('ash', 37.4, 2.3, 0.75, s * 38.2, by, zf + face * 0.2, JADE_HI);
        b.box('ash', 37.8, 0.28, 0.82, s * 38.2, by + 1.28, zf + face * 0.22, JADE_D);
        b.box('ash', 37.8, 0.28, 0.82, s * 38.2, by - 1.28, zf + face * 0.22, JADE_D);
        const n = 12;
        for (let k = 0; k < n; k++) {
          const gx = s * (39.0 - 3.1 * k);
          if (Math.abs(gx) < 31.2) continue;
          b.box('ash', 1.5, 1.05, 0.35, gx, by, zf + face * 0.5, JADE);
          b.sphere('ash', 0.34, 6, gx, by, zf + face * 0.62, JADE_D, 0, 0, 0, 1.1, 0.85, 0.5);
        }
      }
    }
    // 须弥座式基座（三道线脚 + 深束腰）+ 压檐 + 檐下一道金线
    b.box('ash', 41.2, 1.3, 17.4, s * 38, GATE_Y + 0.65, zc, JADE_HI);
    b.box('ash', 40.5, 1.7, 16.9, s * 38, GATE_Y + 2.15, zc, shade(JADE, 0.66));
    b.box('ash', 41.0, 1.0, 17.2, s * 38, GATE_Y + 3.5, zc, JADE_HI);
    b.box('ash', 41.0, 1.8, 17.2, s * 38, GATE_TOP - 0.9, zc, JADE_HI);
    b.box('ash', 41.6, 0.45, 17.6, s * 38, GATE_TOP - 0.05, zc, JADE);
    b.box('wood', 41.2, 0.28, 17.3, s * 38, GATE_TOP - 2.0, zc, GOLD_D);
    // 墩身侧面（远离轴线的 90m 外皮）也压两道线脚，侧视不空
    for (const f of [-1, 1]) {
      b.box('ash', 0.5, GATE_H - 4, 16.6, s * 58.1, GATE_Y + GATE_H / 2, zc + f * 0.1, JADE_HI);
    }

    // 侧门：券脸（外圈金线 + 汉白玉券石）
    archRing(b, s * 36.5, SIDE_SPRING, SIDE_HW, zc - GATE_D / 2 - 0.3, zc + GATE_D / 2 + 0.3, 10);
    // 门框中线（金）
    b.box('wood', 0.30, 30, 0.30, s * 30.2, GATE_Y + 15, zc - GATE_D / 2 - 0.2, GOLD_D);
    b.box('wood', 0.30, 30, 0.30, s * 42.8, GATE_Y + 15, zc - GATE_D / 2 - 0.2, GOLD_D);
    // 侧门内的暗部（不进光的深腔，避免"能看到背面"）
    b.box('wood', 12.4, 29.4, 1.0, s * 36.5, GATE_Y + 14.7, zc + GATE_D / 2 - 0.7, 0x241a12);
    // 侧门扇：朱漆 + 金门钉 + 金铺首（天门夜里也认得出是"门"）
    b.box('wood', 11.4, 27.6, 0.5, s * 36.5, GATE_Y + 14.0, zc + 2.2, 0x7a2a18);
    b.box('wood', 11.9, 0.5, 0.7, s * 36.5, GATE_Y + 28.0, zc + 2.1, GOLD_D);
    for (let ry = 0; ry < 6; ry++) {
      for (let rx = 0; rx < 4; rx++) {
        b.sphere('wood', 0.20, 6, s * 36.5 + (rx - 1.5) * 2.3, GATE_Y + 4.5 + ry * 4.0, zc + 2.5, GOLD, 0, 0, 0, 1, 1, 0.6);
      }
    }
    b.cyl('wood', 0.55, 0.55, 0.3, 10, s * 36.5, GATE_Y + 14.0, zc + 2.55, GOLD_HI, 0, Math.PI / 2, 0);
  }

  // ---- 中门：券洞 + 券脸 + 门槛 ----
  archFill(b, 0, OPEN_SPRING, OPEN_HW, GATE_D, GATE_Z, JADE);
  b.box('ash', 36, 30, GATE_D, 0, OPEN_SPRING + OPEN_HW + 15, GATE_Z, JADE);   // 中门上方墙身
  archRing(b, 0, OPEN_SPRING, OPEN_HW, GATE_Z - GATE_D / 2 - 0.3, GATE_Z + GATE_D / 2 + 0.3, 16);
  // 券洞内壁（把 16m 进深读成石头隧道）
  for (const s of [-1, 1]) {
    b.box('ash', 0.9, OPEN_SPRING - GATE_Y, 0.9, s * (OPEN_HW - 0.35), (GATE_Y + OPEN_SPRING) / 2, GATE_Z - GATE_D / 2 - 0.2, JADE_D);
    b.box('ash', 0.9, OPEN_SPRING - GATE_Y, 0.9, s * (OPEN_HW - 0.35), (GATE_Y + OPEN_SPRING) / 2, GATE_Z + GATE_D / 2 + 0.2, JADE_D);
  }
  b.box('ash', 40, 0.5, GATE_D + 2.4, 0, GATE_Y + 0.25, GATE_Z, JADE_HI);
  // 门槛石
  b.box('ash', 37, 0.55, 2.2, 0, GATE_Y + 0.28, GATE_Z - GATE_D / 2 + 1.0, JADE_D);
  // 门枢金线（券洞两侧）
  for (const s of [-1, 1]) {
    b.box('wood', 0.26, OPEN_SPRING - GATE_Y, 0.26, s * (OPEN_HW - 0.75), (GATE_Y + OPEN_SPRING) / 2, GATE_Z - GATE_D / 2 - 0.12, GOLD_D);
  }

  // ---- 匾额（中门上方） ----
  b.box('wood', 19, 6.4, 0.7, 0, GATE_TOP - 15, GATE_Z - GATE_D / 2 - 0.5, 0x1a1410);
  b.box('wood', 20.2, 0.42, 0.9, 0, GATE_TOP - 11.6, GATE_Z - GATE_D / 2 - 0.5, GOLD);
  b.box('wood', 20.2, 0.42, 0.9, 0, GATE_TOP - 18.4, GATE_Z - GATE_D / 2 - 0.5, GOLD);
  for (const s of [-1, 1]) b.box('wood', 0.5, 7.0, 0.9, s * 9.9, GATE_TOP - 15, GATE_Z - GATE_D / 2 - 0.5, GOLD);
  // 匾心：金线回纹（不做文字，避免伪造匾文）
  for (let i = 0; i < 5; i++) {
    b.box('wood', 1.2, 0.16, 0.14, -7.2 + i * 3.6, GATE_TOP - 15, GATE_Z - GATE_D / 2 - 0.85, GOLD_D);
    b.box('wood', 0.16, 2.2, 0.14, -7.2 + i * 3.6, GATE_TOP - 15, GATE_Z - GATE_D / 2 - 0.85, GOLD_DD);
  }

  // ---- 墩顶压檐（承水帘）----
  for (const s of [-1, 1]) {
    b.box('ash', 41.5, 1.6, 18.2, s * 38.2, GATE_TOP + 0.8, GATE_Z, JADE_HI);
    b.box('ash', 42.5, 0.5, 19.2, s * 38.2, GATE_TOP + 1.75, GATE_Z, JADE);
    // 墩顶石栏（望柱一圈）
    for (let k = 0; k < 9; k++) {
      const zz = GATE_Z - 8 + k * 2;
      b.box('ash', 0.4, 0.9, 0.4, s * 58.4, GATE_TOP + 2.2, zz, JADE);
    }
  }

  // ---- 水帘：墩顶倾泻 90m × 30m（细股，留缝，不是实心板） ----
  for (const s of [-1, 1]) waterCurtain(b, s * 38, GATE_TOP + 2.0, GATE_Z - GATE_D / 2 - 0.55, 30, GATE_H);

  buildGateRoof(b);
}

/** 半圆券填角：把 y0…y0+r 之间、|x| ∈ [√(r²-dy²), r] 的两块角料用层叠小箱填满 */
function archFill(b: Baker, cx: number, y0: number, r: number, depth: number, zc: number, hex: number): void {
  const N = 14;
  for (let i = 0; i < N; i++) {
    const yA = y0 + (i / N) * r;
    const yB = y0 + ((i + 1) / N) * r;
    const dy = (yA + yB) / 2 - y0;
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    const fw = r - hw;
    if (fw <= 0.05) continue;
    for (const s of [-1, 1]) {
      b.box('ash', fw, (yB - yA) + 0.06, depth, cx + s * (hw + fw / 2), (yA + yB) / 2, zc, hex);
    }
  }
}

/** 券脸：沿半圆外缘一圈券石，南北两面各一圈 */
function archRing(b: Baker, cx: number, springY: number, r: number, zSouth: number, zNorth: number, n: number): void {
  const rr = r + 0.85;
  for (let i = 0; i < n; i++) {
    const am = Math.PI * ((i + 0.5) / n);
    const px = cx + Math.cos(am) * rr;
    const py = springY + Math.sin(am) * rr;
    const seg = (Math.PI * rr) / n * 1.06;
    for (const zf of [zSouth, zNorth]) {
      b.box('ash', seg, 1.7, 0.62, px, py, zf, i % 2 ? JADE_HI : JADE, 0, 0, am - Math.PI / 2);
    }
  }
  // 拱心石
  for (const zf of [zSouth, zNorth]) {
    b.box('ash', 2.0, 2.6, 0.75, cx, springY + r + 0.9, zf, JADE_HI);
  }
}

/**
 * 水帘：90m 落差、30m 宽。
 * 关键不是"加更多水"，而是**不要读成百叶帘**：三档不同进深的水股 + 非等距排布 +
 * 宽窄/落点/亮度全不一致 + 顶唇外抛 + 落底水花，缝隙里能看见后面的石面。
 */
function waterCurtain(b: Baker, cx: number, topY: number, z: number, w: number, h: number): void {
  // ① 石雕出水唇：墩口一道压檐 + 一道溢水
  b.box('ash', w + 2.6, 0.85, 1.7, cx, topY + 0.35, z - 0.45, JADE_D);
  b.box('ash', w + 1.4, 0.45, 1.0, cx, topY + 0.9, z - 0.75, JADE_HI);
  b.box('water', w + 0.5, 0.7, 0.55, cx, topY + 0.15, z - 1.05, WATER_C);

  // ② 水股：三层进深（贴石面 / 中 / 外抛），宽窄悬殊但整体铺满 —— 参考图里水是"有竖纹的水面"，
  //    不是一根根悬空的绳子；靠明暗差与前后错位读水，不靠留大缝
  for (let layer = 0; layer < 3; layer++) {
    const n = [10, 7, 5][layer];
    const dz = [0.0, 0.7, 1.45][layer];
    const tone = [WATER_D, WATER_E, WATER_C][layer];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5 + (rnd() - 0.5) * 0.9) / n;
      const x = cx + (u - 0.5) * w;
      const ww = 0.4 + rnd() * (layer === 0 ? 1.0 : 1.5);
      const zd = z + dz + (rnd() - 0.5) * 0.4;
      // 落点不一致：有的提前散完，有的直落到底
      const drop = h * (0.5 + rnd() * 0.5);
      const col = rnd() < 0.3 ? shade(tone, 0.82) : tone;
      b.box('water', ww, drop, 0.16, x, topY - drop / 2, zd, col);
      // 股顶翻白的一小段（水离唇时最亮）
      b.box('water', ww + 0.3, 0.7, 0.2, x, topY - 0.35, zd, WATER_C);
    }
  }

  // ③ 落底：水花环 + 溅起的水雾（fabric）
  for (let i = 0; i < 9; i++) {
    const x = cx + ((i + 0.5) / 9 - 0.5) * (w + 1);
    b.sphere('water', 0.9 + rnd() * 0.7, 7, x, topY - h + 0.25, z + 0.4 + rnd() * 0.8, WATER_C, 0, 0, 0, 1.5, 0.32, 1.0);
    if (i % 2 === 0) {
      b.sphere('fabric', 1.6 + rnd() * 1.2, 7, x, topY - h + 0.8, z + 1.4, CLOUD, 0, 0, 0, 1.4, 0.6, 1.1);
    }
  }
}

// ============ 门楼：三重檐歇山顶 ============
function buildGateRoof(b: Baker): void {
  // 三重檐：举高按进深的 1/2 取（14/23 ≈ 31°），旧版 9m 在 134m 宽屋顶上等于平板
  const tiers = [
    { y: GATE_TOP, w: 146, d: 48, h: 15.0 },
    { y: GATE_TOP + 18.0, w: 124, d: 38, h: 13.0 },
    { y: GATE_TOP + 33.0, w: 102, d: 30, h: 11.0 },
  ];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    // 檐下斗栱带：金，密排（每 2.4m 一攒，每攒栌斗 + 华栱 + 令栱）
    dougongBand(b, t.y - 0.15, t.w - 2, t.d - 2, Math.max(1, Math.round((t.w - 2) / 2.4)));
    // 斗栱下的额枋（朱金）
    b.box('wood', t.w - 4, 1.5, t.d - 4, 0, t.y - 1.35, GATE_Z, 0x8a2f1e);
    b.box('wood', t.w - 3.6, 0.22, t.d - 3.6, 0, t.y - 0.55, GATE_Z, GOLD);

    b.roofC('roof', 0, t.y, GATE_Z, GOLD, 0, t.w, t.h, t.d);
    // 檐口金剪边（薄金条压在瓦口）
    b.box('wood', t.w + 0.4, 0.34, 0.5, 0, t.y + 0.72, GATE_Z - t.d / 2 - 0.1, GOLD_HI);
    b.box('wood', t.w + 0.4, 0.34, 0.5, 0, t.y + 0.72, GATE_Z + t.d / 2 + 0.1, GOLD_HI);
    for (const s of [-1, 1]) {
      b.box('wood', 0.5, 0.34, t.d + 0.4, s * (t.w / 2 + 0.1), t.y + 0.72, GATE_Z, GOLD_HI);
    }

    // 檐间墙身：只做"上一层的暗层"，宽度收到远小于下层屋面，否则会把下层瓦坡整片盖住、
    // 三重檐读成三层叠桌（实测：130m 宽的暗层把 146m 屋面盖得只剩金边）
    if (i < tiers.length - 1) {
      const nt = tiers[i + 1];
      const y0 = t.y + t.h * 0.96;
      const bodyH = Math.max(0, nt.y - y0 - 0.2);
      if (bodyH > 0.4) {
        b.box('wood', nt.w - 26, bodyH, nt.d - 14, 0, y0 + bodyH / 2, GATE_Z, 0x6e2416);
        b.box('wood', nt.w - 25, 0.3, nt.d - 13, 0, y0 + bodyH, GATE_Z, GOLD_D);
      }
    }
  }

  // 正脊 + 鸱吻 + 宝顶（歇山正脊长 = 顶层面阔 − 进深）
  const ridgeY = GATE_TOP + 33.0 + 11.0 * 0.98;
  b.box('roof', 72, 2.4, 3.4, 0, ridgeY + 1.2, GATE_Z, GOLD_HI);
  b.box('wood', 72.4, 0.32, 3.6, 0, ridgeY + 2.42, GATE_Z, GOLD);
  for (const s of [-1, 1]) {
    b.box('roof', 2.6, 4.4, 3.0, s * 35.4, ridgeY + 2.6, GATE_Z, GOLD_D, 0, 0, s * 0.22);
    b.box('roof', 1.7, 1.9, 2.3, s * 36.0, ridgeY + 5.1, GATE_Z, GOLD_HI, 0, 0, s * 0.5);
  }
  // 宝顶（脊心金珠）
  b.cyl('wood', 1.5, 2.0, 0.7, 10, 0, ridgeY + 2.6, GATE_Z, GOLD_D);
  b.sphere('wood', 1.25, 10, 0, ridgeY + 4.0, GATE_Z, GOLD_HI, 0, 0, 0, 1, 1.15, 1);
  b.cyl('wood', 0.35, 0.7, 1.1, 8, 0, ridgeY + 5.3, GATE_Z, GOLD);
  // 歇山山花：只做端部脊下的小三角（放大到整坡会从瓦面里穿出来，读成"脊上叠箱子"）
  for (const s of [-1, 1]) {
    const zEnd = GATE_Z + s * 14.2;
    const n = 9;
    for (let k = 0; k < n; k++) {
      const w = 26 * (1 - k / n);
      if (w <= 1.2) break;
      b.box('wood', w, 0.78, 0.55, 0, GATE_TOP + 37.4 + k * 0.82, zEnd, k % 2 ? 0x5c1f12 : 0x6e2416);
    }
    b.box('wood', 26.5, 0.26, 0.7, 0, GATE_TOP + 37.2, zEnd, GOLD_D);
    b.box('wood', 0.4, 7.4, 0.7, 0, GATE_TOP + 40.9, zEnd + s * 0.02, GOLD_D);
  }
}

/** 檐下斗栱：正面 + 背面 + 两侧各一排 */
function dougongBand(b: Baker, y: number, w: number, d: number, nFront: number): void {
  const armW = 0.9, armH = 0.42;
  for (let i = 0; i < nFront; i++) {
    const x = -w / 2 + (i + 0.5) * (w / nFront);
    for (const face of [-1, 1]) {
      const z = face * (d / 2 - 0.4);
      b.box('wood', armW, armH, 0.55, x, y + 0.21, z, GOLD_D);              // 栌斗
      b.box('wood', 1.55, 0.30, 0.42, x, y + 0.60, z + face * 0.35, GOLD);   // 华栱
      b.box('wood', 0.62, 0.26, 0.62, x, y + 0.86, z + face * 0.55, GOLD_HI); // 散斗
      b.box('wood', 0.30, 0.34, 1.15, x, y + 0.98, z + face * 0.6, GOLD_D);  // 令栱
    }
  }
  const nSide = Math.max(1, Math.round(d / 2.4));
  for (let i = 0; i < nSide; i++) {
    const z = -d / 2 + (i + 0.5) * (d / nSide);
    for (const face of [-1, 1]) {
      const x = face * (w / 2 - 0.4);
      b.box('wood', 0.55, armH, armW, x, y + 0.21, z, GOLD_D);
      b.box('wood', 0.42, 0.30, 1.55, x + face * 0.35, y + 0.60, z, GOLD);
      b.box('wood', 0.62, 0.26, 0.62, x + face * 0.55, y + 0.86, z, GOLD_HI);
    }
  }
}

// ============ 石狮（须弥座，通高 6m） ============
function buildLions(b: Baker): void {
  for (const s of [-1, 1]) lion(b, s * 41, TOP_Y, -146, s);
}

function lion(b: Baker, x: number, y0: number, z: number, s: number): void {
  // 须弥座（三级，总高 2.2m）
  b.box('ash', 5.2, 0.55, 5.6, x, y0 + 0.28, z, JADE_D);
  b.box('ash', 4.5, 0.75, 4.9, x, y0 + 0.93, z, JADE);
  b.box('ash', 4.9, 0.35, 5.3, x, y0 + 1.48, z, JADE_HI);
  b.box('ash', 4.0, 0.45, 4.4, x, y0 + 1.88, z, JADE_D);

  const py = y0 + 2.1;   // 狮座面（以上 3.9m 为狮身）
  // 后腿 / 臀部
  b.sphere('ash', 1.05, 10, x, py + 0.95, z + 0.95, JADE, 0, 0, 0, 1.15, 1.0, 1.15);
  // 身躯（前低后高的坐姿）
  b.box('ash', 1.75, 1.35, 1.6, x, py + 1.05, z + 0.2, JADE);
  b.sphere('ash', 0.95, 10, x, py + 1.35, z - 0.45, JADE, 0, 0, 0, 1.05, 1.15, 1.0);
  // 前腿 + 爪
  for (const f of [-1, 1]) {
    b.box('ash', 0.42, 1.15, 0.5, x + f * 0.62, py + 0.58, z - 0.62, JADE_D);
    b.box('ash', 0.52, 0.32, 0.75, x + f * 0.62, py + 0.14, z - 0.92, JADE);
  }
  // 绣球（左爪下）
  b.sphere('ash', 0.5, 10, x - 0.62, py + 0.55, z - 0.95, JADE_HI);
  // 头
  const hy = py + 2.35;
  b.sphere('ash', 0.95, 10, x, hy, z - 0.62, JADE, 0, 0, 0, 1.05, 1.0, 1.05);
  // 鬃毛（一圈卷球）
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    b.sphere('ash', 0.30, 6, x + Math.cos(a) * 0.82, hy + Math.sin(a) * 0.78, z - 0.55, JADE_D, 0, 0, 0, 1, 1, 1);
  }
  // 耳 / 眼 / 吻
  for (const f of [-1, 1]) {
    b.sphere('ash', 0.24, 6, x + f * 0.62, hy + 0.72, z - 0.7, JADE_D, 0, 0, 0, 1, 1.2, 0.7);
    b.sphere('ash', 0.13, 6, x + f * 0.34, hy + 0.18, z - 1.42, 0x2a2119);
  }
  b.box('ash', 0.85, 0.55, 0.55, x, hy - 0.25, z - 1.35, JADE);
  b.sphere('ash', 0.16, 6, x, hy - 0.12, z - 1.6, JADE_D);
  // 张口
  b.box('ash', 0.6, 0.16, 0.2, x, hy - 0.5, z - 1.55, 0x2a2119);
  // 尾巴（三球上卷）
  b.sphere('ash', 0.42, 8, x + s * 0.55, py + 1.75, z + 1.42, JADE_D);
  b.sphere('ash', 0.34, 8, x + s * 0.72, py + 2.15, z + 1.5, JADE);
  b.sphere('ash', 0.26, 8, x + s * 0.78, py + 2.5, z + 1.45, JADE_HI);
}

// ============ 阶脚云团：收住长阶下段 ============
function buildCloudFoot(b: Baker): void {
  // 硬约束：云团的**每一个顶点**都必须 >150，否则被 scaleHeavenGeometry 撕成
  // 贯穿全城的巨型白管（实测：跨 y=150 的球会拉出一条 200m 高的"柱子"糊住整个画面）。
  // 故球心 y ≥ 151.5 + r·0.62（竖直半轴 = r×sy）。
  for (let i = 0; i < 40; i++) {
    const t = i / 39;
    const z = -252 - t * 140;
    const x = (rnd() - 0.5) * 170 * (0.5 + t);
    const r = 5 + rnd() * 7;
    const y = 151.5 + r * 0.62 + rnd() * 16;
    const col = rnd() < 0.45 ? CLOUD_D : CLOUD;
    b.sphere('fabric', r, 8, x, y, z, col, 0, 0, 0, 1.25, 0.62, 1.15);
  }
  // 阶脚正下方一团厚的收口云（同样整团在 150 之上）
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const r = 9 + (i % 3) * 2.5;
    b.sphere('fabric', r, 9, Math.cos(a) * 30, 152 + r * 0.62 + (i % 4) * 2.5, -368 + Math.sin(a) * 22, i % 2 ? CLOUD : CLOUD_D, 0, 0, 0, 1.2, 0.7, 1.2);
  }
  b.kit('heaven.stair.cloud', 49, 152);
}
