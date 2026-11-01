import { Baker, BGroup, SignMesher, SignAtlas, shade } from './bake';
import { RNG } from '../core/rng';
import { RIVERS, LINK_WATER_Y, LINK_HALF_CUL, LINK_CHUTE2, WATER_RIVER_Y, terrainSurfaceY } from '../world/terrain';
import { RIVER_WATER_Y } from './river';

/**
 * R2 · 河的头与尾（「为什么河还是没头没尾！！！！」）
 *
 * 上一轮修了「水面被背面剔除」与「河道被 206.7m 地形网格埋掉」，但河仍然**在田野里凭空断头**：
 *  ① `addRiverWater` 在每条河两端各插一个站（宽 30%、alpha 0.05、外延 240m）——那是视觉补丁；
 *  ② `RIVERS` 西河头 `(-5600,0)` 与城内汴河 `x=-5000` 之间空 600m；
 *  ③ 水位差 3.2m：城外 −2.2、城内 +1.0。
 * 本文件补的就是这 600m 的**实体**：每一处水位落差都落在看得见的石作上，水面之间只有
 * 闸/跌水槽/涵洞，没有 alpha 淡出。
 *
 * 水位三级与两级澳闸（`world/terrain.ts` 的 `RiverLink` 注释是唯一真相源）：
 *   城内汴河 +1.0 → 水关外高渠 +1.0 → **跌水 1.35m** → 护城河 −0.35
 *   → **跌水 1.85m** → 城外河 −2.2。合计 3.2m。
 * 为什么拆两级：护城河水位由 `city/imperial.ts` 拥有（本轮冻结），河道只能从它上方/下方过，
 * 拆成「闸—澳—闸」正是宋代汴河澳闸的做法；而一级 3.2m 的船闸要 3.2m 高的闸墙横在城下，
 * 既挤不进城墙与护城河之间 130m 的滩地，也会把护城河水位顶穿。
 *
 * 河尾：`spring: true` 的 4 条河在山脚以**石砌泉洞**收口（洞脸 + 叠涩券 + 暗背板 + 乱石），
 * 水面满 alpha 进洞、切边藏在洞里 5m 处；入湖的两条（东河、泰山河）由 terrain 的湖面盖住切边。
 *
 * 所有落位只由 `RiverLink` 与既有常量派生，**不消耗共享 RNG**（`rng` 仅为与其它 builder 同签名），
 * 新增本步骤不会推进世界随机序列，下游树木/摊位的取数逐值不变。
 */

// ============ 尺寸 ============
/** 渠/堰/槽半宽（42m，与城内河同宽） */
const HW_WIDE = 21;
/** 跌水 ① 的槽长（m）：1.35m 落差走 10m */
const CHUTE1 = 10;
/** 跌水 ② 的槽长（m）：与 terrain.ts 的 `LINK_CHUTE2` 同值，水面与石作必须对齐 */
const CHUTE2 = LINK_CHUTE2;
/** 高渠石壁厚度 / 顶高 */
const WALL_T = 1.4;
const WALL_TOP = RIVER_WATER_Y + 0.42;

// ============ 配色 ============
const STONE = 0x8a8272;
const STONE_D = 0x6f6859;
const STONE_L = 0xa39a86;
const STONE_XL = 0xb5ac96;
const IRON = 0x3a4048;
const TIMBER = 0x6b4a2b;
const TIMBER_D = 0x4a3220;
const ROCK = 0x6d6a5e;
const ROCK_D = 0x54524a;
const DARK = 0x1a2026;

// ============ 轴系 ============
/** u = 离城方向；v = 右侧（u 逆时针 90°）；yaw 与 Baker.box 的约定一致 */
interface Axis { ox: number; oz: number; ux: number; uz: number; vx: number; vz: number; yaw: number }

function axisAt(ox: number, oz: number, ux: number, uz: number): Axis {
  return { ox, oz, ux, uz, vx: -uz, vz: ux, yaw: Math.atan2(-uz, ux) };
}

function at(a: Axis, u: number, v: number): [number, number] {
  return [a.ox + a.ux * u + a.vx * v, a.oz + a.uz * u + a.vz * v];
}

/** 以轴系放置箱体：len 沿 u、wid 沿 v（比在调用处手算坐标少一半符号错误） */
function bx(b: Baker, g: BGroup, a: Axis, u: number, v: number, y: number, len: number, h: number, wid: number, hex: number): void {
  const [x, z] = at(a, u, v);
  b.box(g, len, h, wid, x, y, z, hex, a.yaw);
}

function cyl(b: Baker, g: BGroup, a: Axis, u: number, v: number, y: number, r: number, h: number, seg: number, hex: number): void {
  const [x, z] = at(a, u, v);
  b.cyl(g, r, r, h, seg, x, y, z, hex, a.yaw);
}

// ============ 一、水关台体（城墙外皮上的水关，把城门下段包进石作）============
/**
 * 为什么不是一道薄薄的洞脸：`imperial.ts` 在 (±5000, 0) 有一座**城门**（城台 24m 宽 × 20m 深 × 15.5m 高，
 * 门洞只是两块黑漆板），而河宽 42m——城台是站在河中间、两侧各 9m 水从它旁边绕过去的。
 * 用户那句「河上有路正常吗」指的就是它。imperial.ts 本轮冻结，所以这里建一座 19m 深的**水关台体**
 * （x 4993→5012、z ±22.2、y −2.8→8.45），把城台的下段整个包进石作：外侧 34m 券洞进水，
 * 内侧 25.2m 涵洞（riverends 的墩台）对齐，台面接水门楼——城门从此是「建在水关上」，
 * 水下没有城台的边，也就没有「路压着河」的读法。
 */
function gateMass(b: Baker, sg: SignMesher, atlas: SignAtlas, a: Axis, u0: number, u1: number): void {
  const SPRING = RIVER_WATER_Y;          // 洞口下沿 = 高渠水面
  const OPEN_H = 5.2;
  const CROWN = SPRING + OPEN_H;
  const TOP = 8.45;                      // 与 riverends.ts 的 MASS_TOP 同高：两台连成一体
  const OPEN_HALF = 17;                  // 34m 券洞（内侧再收到 25.2m）
  const BANK_HALF = 22.2;                // 与 riverends 的 BANK_HALF 对齐
  const len = u1 - u0;
  const mid = (u0 + u1) / 2;
  const cen = (OPEN_HALF + BANK_HALF) / 2;
  const wid = BANK_HALF - OPEN_HALF;

  for (const s of [-1, 1] as const) {
    // 门墩：自河床 −2.8 砌到台面
    bx(b, 'ash', a, mid, s * cen, (TOP - 2.8) / 2, len, TOP + 2.8, wid, shade(STONE_D, 1.0));
    bx(b, 'ash', a, mid, s * (BANK_HALF - 0.1), (TOP + 0.1) / 2, len + 0.2, TOP + 0.4, 0.5, shade(STONE, 1.03));
  }
  // 拱上填充：沿 v 切片自拱线砌到台面（26 片，缝宽 0.06 咬合）
  const N = 26;
  for (let i = 0; i < N; i++) {
    const v0 = -OPEN_HALF + (2 * OPEN_HALF * i) / N;
    const v1 = v0 + (2 * OPEN_HALF) / N;
    const ar = (v: number): number => SPRING + OPEN_H * Math.sqrt(Math.max(0, 1 - (v / OPEN_HALF) ** 2));
    const y0 = Math.max(ar(v0), ar(v1));
    if (TOP - y0 > 0.06) {
      bx(b, 'ash', a, mid, (v0 + v1) / 2, (y0 + TOP) / 2, len, TOP - y0, (v1 - v0) + 0.06,
        shade(STONE, 0.97 + (i % 3) * 0.02));
    }
  }
  // 外口券脸：14 块楔石按椭圆线排（沿 v 分段、每块自身不旋转——Baker 的欧拉角与 yaw 叠序不可靠，
  // 这里用「不同高度的窄条」拼出券线，远看读得出拱，近看是分层砌体）
  for (let k = 0; k < 14; k++) {
    const t0 = (Math.PI * k) / 14, t1 = (Math.PI * (k + 1)) / 14;
    const v0 = OPEN_HALF * Math.cos(t0), v1 = OPEN_HALF * Math.cos(t1);
    const y0 = SPRING + OPEN_H * Math.sin(t0), y1 = SPRING + OPEN_H * Math.sin(t1);
    bx(b, 'ash', a, u1 + 0.16, (v0 + v1) / 2, (y0 + y1) / 2, 0.7, Math.abs(y1 - y0) + 0.42, Math.abs(v1 - v0) + 0.1,
      shade(STONE_L, 1.0 + (k % 2) * 0.05));
  }
  // 龙门石（拱顶合龙）
  bx(b, 'ash', a, u1 + 0.2, 0, CROWN + 0.16, 0.8, 0.8, 1.6, shade(STONE_XL, 1.18));
  // 台面压顶 + 临河护栏（中间 3 开间让给水门楼，护栏只做两翼）
  bx(b, 'ash', a, mid, 0, TOP + 0.15, len + 0.9, 0.3, 2 * BANK_HALF + 1.2, shade(STONE_L, 1.12));
  for (const s of [-1, 1] as const) {
    bx(b, 'ash', a, mid, s * (BANK_HALF - 6.4), TOP + 0.8, len + 0.4, 1.0, 0.4, STONE_L);
  }
  // 卧石门槛：压住水面在台体外口的切边（水面 +1.0，门槛顶 +1.16）
  bx(b, 'ash', a, u1 - 0.7, 0, SPRING + 0.06, 1.4, 0.4, 2 * OPEN_HALF, STONE_XL);
  // 水尺：洞口一侧，八格明暗
  for (let i = 0; i < 8; i++) {
    bx(b, 'ash', a, u1 - 0.1, -(OPEN_HALF + 1.2), SPRING + 0.3 + i * 0.42, 0.5, 0.42, 0.44, i % 2 ? STONE_XL : STONE_D);
  }
  // 门灯两盏
  for (const s of [-1, 1] as const) {
    bx(b, 'metal', a, u1 + 0.6, s * (OPEN_HALF + 2.6), CROWN + 1.5, 0.9, 0.18, 0.18, IRON);
    bx(b, 'glow', a, u1 + 1.7, s * (OPEN_HALF + 2.6), CROWN + 1.1, 0.36, 0.44, 0.36, 0xffb066);
  }
  // 匾：临河一面
  const [sx, sz] = at(a, u1 + 0.25, 0);
  const face = Math.atan2(-a.ux, -a.uz);
  sg.quad(atlas.text('r2_culvert_out', '汴渠下關', 320, 88, {
    color: '#ffe9c8', glow: '#00e5ff', bg: 'rgba(10,14,22,0.9)', border: 'rgba(0,229,255,.7)', fontPx: 56,
  }), 7.2, 1.95, sx, CROWN + 2.2, sz, face);
  b.kit('water.link.portal', 1, CROWN);
}

/** 两点之间的一段墙/堤（可斜）：在轴系里给两个 (u,v) 端点，自动算世界方向与 yaw */
function seg(b: Baker, g: BGroup, a: Axis, u0: number, v0: number, u1: number, v1: number, yb: number, yt: number, thick: number, hex: number): void {
  const du = u1 - u0, dv = v1 - v0;
  const l = Math.hypot(du, dv) || 1;
  const wx = a.ux * du + a.vx * dv, wz = a.uz * du + a.vz * dv;
  const [x, z] = at(a, (u0 + u1) / 2, (v0 + v1) / 2);
  b.box(g, l + 0.25, yt - yb, thick, x, (yb + yt) / 2, z, hex, Math.atan2(-wz, wx));
}

// ============ 二、引水渠石壁（+1.0 高渠 / −0.35 抬高渠）============
/**
 * 西/东的高渠 125m：水面 +1.0，地面 −0.5 —— 1.5m 高的地上河（汴河本就是地上河）；
 * 南/北的抬高渠 168m：水面 −0.35，地面 −0.5…−1.6 —— 一条矮堤渠。
 * 两岸石壁从 −0.9 砌到 +1.42，渠宽从洞口 34m 展到 42m，所以壁是斜的（分段跟随水线）。
 */
function raisedCanal(b: Baker, a: Axis, u0: number, u1: number, hw0: number, hw1: number, lamps: boolean): void {
  for (const s of [-1, 1] as const) {
    seg(b, 'ash', a, u0, s * hw0, u1, s * hw1, -1.1, WALL_TOP, WALL_T, shade(STONE, 0.99));
    seg(b, 'ash', a, u0, s * hw0, u1, s * hw1, WALL_TOP, WALL_TOP + 0.24, WALL_T + 0.5, shade(STONE_L, 1.06));
  }
  if (!lamps) return;
  const n = Math.max(2, Math.round((u1 - u0) / 22));
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const u = u0 + (u1 - u0) * k;
    const hw = hw0 + (hw1 - hw0) * k;
    for (const s of [-1, 1] as const) {
      const [x, z] = at(a, u, s * hw);
      b.box('wood', 0.16, 1.5, 0.16, x, WALL_TOP + 0.95, z, TIMBER_D);
      b.box('glow', 0.26, 0.3, 0.26, x, WALL_TOP + 1.75, z, 0xffb84a);
    }
  }
  b.kit('water.link.canal', 1, WALL_TOP);
}

// ============ 三、跌水闸（叠梁闸半启 + 石砌跌水槽 + 绞关）============
/**
 * 一台闸 = 堰体 + 4 级消能踏步 + 两侧闸墩（带铁闸槽）+ 半启的叠梁闸 + 绞关 + 水尺。
 * 叠梁闸停在堰顶之上 1m（「半启」）：水从堰顶漫过、顺槽跌下，闸板只是抬着——读得出是闸，也能看到水在流。
 */
function spill(b: Baker, a: Axis, u: number, hw: number, yCrest: number, yDown: number, chuteLen: number): void {
  const drop = (yCrest - yDown) / 4;
  // 堰体与堰顶石
  bx(b, 'ash', a, u, 0, (yDown - 2.0 + yCrest) / 2, 3.0, yCrest - yDown + 2.0, 2 * hw + 5, shade(STONE, 0.97));
  bx(b, 'ash', a, u, 0, yCrest + 0.1, 3.5, 0.2, 2 * hw + 5.4, STONE_XL);
  // 跌水槽：4 级，每级一块消能石
  for (let i = 0; i < 4; i++) {
    const top = yCrest - drop * (i + 1);
    const uc = u + 1.7 + (chuteLen / 4) * (i + 0.5);
    bx(b, 'ash', a, uc, 0, top - 0.8, chuteLen / 4 + 0.14, 1.6, 2 * hw, shade(STONE, 0.94 + i * 0.025));
    bx(b, 'ash', a, uc, 0, top + 0.06, chuteLen / 4 + 0.24, 0.14, 2 * hw + 0.6, STONE_L);
  }
  // 消力坎 + 三片白浪（跌水脚的水花，用亮水色薄片，不用发光体）
  bx(b, 'ash', a, u + chuteLen + 2.2, 0, yDown - 0.1, 1.6, 1.1, 2 * hw + 1.4, shade(STONE, 0.9));
  for (let i = 0; i < 3; i++) {
    bx(b, 'water', a, u + chuteLen + 1.6 + i * 1.9, 0, yDown + 0.06 + i * 0.01, 1.5, 0.1, 2 * hw - 2.0 - i * 3.0, 0xbfe3ea);
  }
  // 两侧闸墩：背后收 4m 翼墙
  for (const s of [-1, 1] as const) {
    bx(b, 'ash', a, u + chuteLen * 0.45, s * (hw + 3.6), (yDown - 2.2 + yCrest + 2.6) / 2, chuteLen + 11, yCrest + 2.6 - (yDown - 2.2), 7.2,
      shade(STONE_D, 1.0));
    bx(b, 'ash', a, u + chuteLen * 0.45, s * (hw + 3.6), yCrest + 2.72, chuteLen + 11.4, 0.28, 7.8, STONE_L);
    // 翼墙：上游侧八字张开，把水收进堰口
    bx(b, 'ash', a, u - 6.5, s * (hw + 6.2), (yDown + yCrest + 0.4) / 2, 12, yCrest + 0.4 - yDown + 2.0, 1.6, shade(STONE, 0.96));
    // 铁闸槽（闸板升降导轨）
    bx(b, 'metal', a, u + 0.25, s * (hw + 0.5), yCrest + 2.0, 0.55, 4.4, 0.5, IRON);
    // 叠梁闸：5 根梁停在堰顶上方 1m（半启），铁箍
    for (let k = 0; k < 5; k++) {
      bx(b, 'wood', a, u + 0.25, 0, yCrest + 1.05 + k * 0.62, 0.5, 0.56, 2 * hw - 1.4, shade(TIMBER, 0.92 + (k % 2) * 0.14));
      bx(b, 'metal', a, u + 0.25, 0, yCrest + 1.05 + k * 0.62, 0.56, 0.1, 2 * hw - 1.2, IRON);
    }
    // 绞关：石座 + 铁鼓 + 木轮 + 六杆
    const wu = u + chuteLen * 0.45, wv = s * (hw + 3.6);
    bx(b, 'ash', a, wu, wv, yCrest + 3.05, 2.4, 0.3, 2.4, shade(STONE_L, 1.04));
    cyl(b, 'metal', a, wu, wv, yCrest + 3.72, 0.62, 1.0, 10, 0x4a4e54);
    for (let k = 0; k < 6; k++) {
      const ang = (Math.PI * 2 * k) / 6;
      const [x, z] = at(a, wu, wv);
      b.box('wood', 1.9, 0.12, 0.12, x, yCrest + 4.3, z, TIMBER_D, a.yaw + ang);
    }
    b.kit('water.link.winch', 1, yCrest + 4.3);
  }
  // 水尺（闸墩内侧面）
  for (let i = 0; i < 7; i++) {
    bx(b, 'ash', a, u - 1.1, -(hw + 0.35), yDown + 0.3 + i * 0.42, 0.4, 0.36, 0.4, i % 2 ? STONE_XL : STONE_D);
  }
  b.kit('water.link.spill', 1, yCrest);
}

// ============ 四、山脚泉洞（河尾收口）============
/**
 * 四条河的河尾都在山脚/台地上凭空断掉。这里造一座**石砌泉洞**：洞脸石框 + 叠涩券 + 暗背板 + 乱石，
 * 水面满 alpha 铺到洞里 5m 处才切——切边在暗处，读作「河从山里涌出来」，不是淡出。
 */
function springMouth(b: Baker, a: Axis, halfW: number, relief: number): void {
  const open = Math.max(16, halfW * 0.45);   // 洞口半宽
  const FACE = -5;                           // 洞脸在端点前 5m：水从洞里出来
  const TOP = Math.max(14, Math.min(relief + 8, 58));   // 洞顶随山体高度：西河尾是 85m 深的峡谷，泉洞不能只有 13m
  const span = halfW * 1.25;

  // 两侧岩体（错缝的深色石块，不是一整面墙）：向岸外扩到河宽之外，把水面的边藏进岩体
  for (const s of [-1, 1] as const) {
    const v0 = open, v1 = span;
    bx(b, 'earth', a, FACE + 9, s * (v0 + v1) / 2, TOP / 2 - 3.0, 20, TOP + 6, v1 - v0, ROCK);
    bx(b, 'earth', a, FACE + 17, s * (v0 + v1) / 2 + s * 4, TOP / 2 + 2.0, 14, TOP - 4, v1 - v0 - 8, ROCK_D);
    // 洞脸石框（竖框）
    bx(b, 'ash', a, FACE + 0.3, s * (open + 1.3), TOP * 0.42, 1.8, TOP * 0.84, 2.6, shade(STONE, 0.98));
  }
  // 叠涩券：6 层内收，压在洞顶净高（泉洞不是厂房大门，净高封到 15m，上面全是岩体）
  const LINTEL = Math.min(15, Math.max(10, TOP * 0.42));
  for (let k = 0; k < 6; k++) {
    bx(b, 'ash', a, FACE + 0.2, 0, LINTEL + 0.35 + k * 0.72, 2.1, 0.74, 2 * open + 5.2 - k * 2.6, shade(STONE_L, 1.0 + k * 0.03));
  }
  // 券上岩体：从券顶砌到洞顶（把 50m 高的「门」封成一座山）。**从 u=+3 起**——
  // 河尾端点 u=0 必须露天才过得了「垂直射线最高点是水面」的机检（水在洞顶之外切边，洞里是暗的）
  bx(b, 'earth', a, FACE + 13, 0, (LINTEL + 4.6 + TOP + 6) / 2, 14, Math.max(2, TOP + 6 - LINTEL - 4.6), 2 * open + 7, ROCK);
  // 洞顶岩檐（压住券顶，读作山体塌落的一块）
  bx(b, 'earth', a, FACE + 17, 0, TOP + 4.0, 18, 8.0, 2 * span, ROCK);
  // 暗背板：水在洞里 5m 处切，切边藏在暗处
  bx(b, 'ash', a, 2.0, 0, LINTEL / 2, 1.2, LINTEL, 2 * open - 1.0, DARK);
  // 门槛卧石：压住水面与洞底的接缝
  bx(b, 'ash', a, FACE + 0.9, 0, WATER_RIVER_Y + 0.05, 2.2, 0.5, 2 * open, STONE_XL);
  // 乱石：两岸各三块，打散「一堵直墙」的读法（位置由序号派生，不取 RNG）
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const u = FACE + 4 + ((i * 37) % 11);
    const v = s * (open + 3 + ((i * 53) % 14));
    const w = 5 + ((i * 29) % 7);
    bx(b, 'earth', a, u, v, WATER_RIVER_Y + w * 0.25, w, w * 0.8, w * 0.9, i % 3 === 0 ? ROCK_D : ROCK);
  }
  b.kit('water.link.spring', 1, TOP);
}

// ============ 主构建 ============
/**
 * 由 `RIVERS[i].link` 逐条派生落位（不写第二份坐标）：
 *  - gate=true（西/东）：水关外口 + 高渠 + 1.35m 跌水；
 *  - 所有四条：护城河外岸 1.85m 跌水 + 河头护岸；
 *  - spring=true 的四条：山脚泉洞。
 */
export function buildWaterLinks(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  void rng; // 落位全为常量派生，不推进共享随机序列
  for (const r of RIVERS) {
    const L = r.link;
    if (!L) continue;
    const alongX = Math.abs(r.pts[0][0]) > Math.abs(r.pts[0][1]);
    const s0 = alongX ? Math.sign(r.pts[0][0]) || 1 : Math.sign(r.pts[0][1]) || 1;
    // 原点：西/东取水关台体外口（城墙外皮），南/北取护城河外岸；u 一律指向城外
    const ox = alongX ? s0 * L.wall : r.pts[0][0];
    const oz = alongX ? 0 : s0 * L.moatOut;
    const a = axisAt(ox, oz, alongX ? s0 : 0, alongX ? 0 : s0);
    const uIn = L.moatIn - L.wall;          // 仅西/东：护城河内岸（相对台体外口）
    const uWeir = L.weir - (L.gate ? L.wall : L.moatOut);

    if (L.gate) {
      gateMass(b, sg, atlas, a, -19, 0);
      raisedCanal(b, a, 0.5, uIn - 3, HW_WIDE * 0.81, HW_WIDE, true);
      // 跌水 ①（1.35m）：高渠 +1.0 → 护城河 −0.35
      spill(b, a, uIn, HW_WIDE, RIVER_WATER_Y - 0.4, LINK_WATER_Y, CHUTE1);
    } else {
      raisedCanal(b, a, 0.5, uWeir - 2, HW_WIDE, HW_WIDE, true);
    }
    // 跌水 ②（1.85m）：护城河 −0.35（或抬高渠）→ 河头 −2.2
    spill(b, a, uWeir, HW_WIDE, LINK_WATER_Y - 0.4, WATER_RIVER_Y, CHUTE2);
  }
  // 河尾：山脚泉洞（洞脸朝向来水），洞顶高度取当地地面高差
  for (const r of RIVERS) {
    if (!r.spring) continue;
    const P = r.pts, n = P.length;
    const [ex, ez] = P[n - 1];
    let ux = ex - P[n - 2][0], uz = ez - P[n - 2][1];
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    const relief = terrainSurfaceY(ex, ez) - WATER_RIVER_Y;   // 河尾地面比水面高多少（西河 85m，北河 ~10m）
    springMouth(b, axisAt(ex, ez, ux, uz), r.w * 0.5 + 10, relief);
  }
}
