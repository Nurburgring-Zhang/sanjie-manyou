import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import type { BGroup } from './bake';
import { roofOn, roofTierAt, C, dougongBand, commonerRoof, wardRoofHex } from './buildings';
import { buildJiaolou, buildWengcheng, buildWatchtower, buildPaifang, furnishHall, furnishCourt, furnishGateHall } from './architecture';
import { buildPalaceHall, roofEndHips } from './palaceDetail';
import { buildPalaceGrounds, buildPalaceOuterGrounds, palaceGroundsAudit } from './palaceGrounds';
import { RNG } from '../core/rng';
import { inRiverFootprint } from './riverGeom';
import { buildRoomLiving } from './roomLiving';
// R24 商业街行业经营用品：宫前/宫后铺面接入 interiors.ts 的 8 业态 TRADE_KIT
import { buildTradeInterior, pickTrade } from './interiors';
// R24b：宫苑草毯也换成任意不规则自由轮廓（不再是一格格圆盘）
import { freeBlobGeometries, putFreeBlob } from './freeBlob';

// ============ 十公里帝都：城墙十二门/里坊百格/宫城皇城/东西两市/御街 ============
export const WALL = 5000;

/**
 * 直坡双坡顶的端头山花：局部 X 沿脊向，三角面立在端头平面上（底边沿 z、顶点在脊高）。
 * 与 interiors.gableTriangle 同形同装饰：双法线粉刷三角 + 前后两面宋式木作（博风板/悬鱼/
 * 直棂格/团花），UV 密度 0.8/m 让粉刷肌理真正重复，不跨文件耦合。
 */
function gableEnd(b: Baker, g: BGroup, x: number, y: number, z: number, ry: number, halfSpan: number, rise: number, hex: number): void {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -halfSpan, 0, 0, halfSpan, 0, 0, 0, rise, 0,
    halfSpan, 0, 0, -halfSpan, 0, 0, 0, rise, 0,
  ], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ], 3));
  // R20：粉刷肌理 UV 密度 3.2m/张 → 0.8/m，wallTex 真正重复，端头不再是一整片纯色。
  const GUV = 0.8;
  const u = halfSpan * 2 * GUV, v = rise * GUV;
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u / 2, v, u, 0, 0, 0, u / 2, v], 2));
  b.addGeo(g, geo, x, y, z, hex, ry, 0, 0);
  b.kit('roof.gableEnd', 1, y + rise);

  // ---- R20 宋式山花装饰（与 interiors.gableTriangle 同一套，外坊平民屋顶不再读作空白三角）----
  // 局部 XY 平面与三角同一套，z 略偏 ±off 免 z-fighting；ry 由 addGeo 统一处理，
  // 天然适配 ry=0/π 与 ry=±π/2。全部尺寸由 halfSpan/rise 确定性推导，不消耗共享 RNG；
  // 前后两面各一组（wood 为 FrontSide，须各自保证绕序）。
  const m = Math.min(halfSpan, rise);
  const off = 0.045;                       // 前后饰面各偏 0.045
  const bw = 0.18 * m;                     // 博风板宽
  const L = Math.max(1e-6, Math.hypot(halfSpan, rise));
  const uK = 0.8;                          // 木作 UV 密度
  const dpos: number[] = [], dnor: number[] = [], duv: number[] = [];
  // 压一个三角形；nz<0（背面）时反转绕序，FrontSide 材质下从两侧都可见。
  const tri = (a: [number, number], bb: [number, number], c: [number, number], zz: number, nz: number): void => {
    const p = nz > 0 ? [a, bb, c] : [a, c, bb];
    for (const q of p) { dpos.push(q[0], q[1], zz); dnor.push(0, 0, nz); duv.push(q[0] * uK, q[1] * uK); }
  };
  // 凸四边形 → 2 三角形；自动规范成从 +z 看逆时针（FrontSide 正确朝向）。
  const quad = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], zz: number, nz: number): void => {
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const q = cross >= 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
    tri(q[0], q[1], q[2], zz, nz);
    tri(q[0], q[2], q[3], zz, nz);
  };
  const bar = (cx: number, cy: number, hx: number, hy: number, zz: number, nz: number): void =>
    quad([cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy], zz, nz);
  const diamond = (cx: number, cy: number, rx: number, ry: number, zz: number, nz: number): void =>
    quad([cx - rx, cy], [cx, cy - ry], [cx + rx, cy], [cx, cy + ry], zz, nz);
  // 博风板：沿斜边 A→B 朝三角内法线 (nx,ny) 偏 bw；檐角内缘 y 钳到 0，不穿出底边。
  const barge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number, zz: number, nz: number): void =>
    quad([ax, ay], [bx, by], [bx + nx * bw, Math.max(0, by + ny * bw)], [ax + nx * bw, Math.max(0, ay + ny * bw)], zz, nz);
  // 团花 / 透气孔：6 段三角扇。
  const rosette = (cx: number, cy: number, r: number, zz: number, nz: number): void => {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      tri([cx, cy], [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], zz, nz);
    }
  };
  for (const s of [1, -1] as const) {
    const zz = s * off, nz = s;
    // 两条博风板：右斜边内法线 (-rise,-halfSpan)/L，左斜边内法线 (rise,-halfSpan)/L。
    barge(halfSpan, 0, 0, rise, -rise / L, -halfSpan / L, zz, nz);
    barge(-halfSpan, 0, 0, rise, rise / L, -halfSpan / L, zz, nz);
    // 悬鱼：脊点下方 rise*0.83 的小菱形吊饰。
    diamond(0, rise * 0.83, 0.06 * m, 0.085 * m, zz, nz);
    // 直棂山花格：中下部 4 根竖棂 + 2 根横枋，留出粉刷面不铺满。
    const yLo = rise * 0.12, yHi = rise * 0.5, cyMid = (yLo + yHi) / 2, hBar = (yHi - yLo) / 2;
    const sw = 0.03 * m;
    for (let i = 0; i < 4; i++) bar((-0.3 + 0.2 * i) * halfSpan, cyMid, sw, hBar, zz, nz);
    const fh = 0.028 * m, fx = 0.34 * halfSpan;
    bar(0, rise * 0.16, fx, fh, zz, nz);
    bar(0, rise * 0.46, fx, fh, zz, nz);
    // 悬鱼上方一个小圆团花 / 透气孔。
    rosette(0, rise * 0.66, 0.045 * m, zz, nz);
  }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  dgeo.setAttribute('normal', new THREE.Float32BufferAttribute(dnor, 3));
  dgeo.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  b.addGeo('wood', dgeo, x, y, z, 0x3a2a20, ry, 0, 0);
  b.kit('roof.gableDecor', 1, y + rise * 0.5);
}

/** 原版 roofOn：roofOnCapped 只包一层，屋面本体仍走它，避免复制一份曲面参数 */
const roofOnCore = roofOn;

/**
 * roofOn 的封山版：同签名，先落曲面屋面，再补两端山面。
 * bake.buildCurvedUnit 只造 ±Z 两片坡，±X 两端从脊端到檐角是敞口（详见 palaceDetail.roofEndHips）。
 */
function roofOnCapped(b: Baker, w: number, d: number, y: number, x: number, z: number, ry: number, tileC: number, neon?: number, hOverride?: number): void {
  roofOnCore(b, w, d, y, x, z, ry, tileC, neon, hOverride);
  const h = hOverride ?? Math.min(w, d) * 0.2 + 0.45;
  roofEndHips(b, { x, y, z, ry, sx: w * 0.905 * 1.02, rise: h * 1.06, sz: d * 0.905 * 1.02, hex: tileC });
}

/**
 * 里坊平民屋顶两端封山：commonerRoof 的 tier1 自带两级山花露头，tier3 只有脊线与檐口暗边
 * （没有坡面就没有腔），**只有 tier2 是两片平坡 + 全敞口**。这里给 tier2 补山墙三角。
 */
function capCommonerGables(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; ry: number; hex: number }): void {
  if (roofTierAt(o.x, o.z) !== 2) return;
  const W = o.w + 0.68;                       // 与 commonerRoof 的 W = w + overW*2 同值
  const L = o.d / 2 + 0.46;                   // 单坡坡长（skirt 到脊）
  const H = Math.max(0.9, Math.min(o.w, o.d) * 0.2 + 0.42);
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  for (const sx of [-1, 1] as const) {
    // 山墙平面垂直于脊向：把 gableEnd 的局部 X（底边）转到局部 Z
    gableEnd(b, 'wall', o.x + sx * (W / 2) * c, o.y, o.z - sx * (W / 2) * s, o.ry + Math.PI / 2, L, H, o.hex);
  }
}

/** 坐标 hash（0–1）：与 infill.ts 的 h01 同式。坊格抖动与街段走向全走它，不消耗共享 RNG */
function wardHash(a: number, b: number, c: number): number {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/**
 * 仪制保护区 [x0,x1,z0,z1]：御街中轴 / 御街两厢宫廷里坊 / 宫城含御沟 / 东西市。
 * 这几处是手工几何，必须规整；坊格抖动再大也不许压进去——infill.ts 的坊墙不查 reserved()
 * （只有房屋与巷暗带查），坊压进保护区就是一道 3.2m 坊墙横穿宫院。
 */
const WARD_KEEP: readonly (readonly [number, number, number, number])[] = [
  [-60, 60, -5000, 5000],
  [-905, 905, -2925, 2925],
  // W-N 宫城内收：旧版 −4500…−2895 一直顶到北城墙外 550m，宫北整条 2200×550m 没有坊格；
  // 现在北界收到 −4060（墙 −4000 外 60m），北面 12 格里坊落回 −4150 一带，最近 124–190m。
  [-1170, 1170, -4060, -2890],
  // 东市/西市不再进 WARD_KEEP：这一步是「整格」判定，一个 320m 的市会让整格 700m 被推走或丢弃，
  // 结果就是市场四周一圈 200–700m 的空地。市内的空白由逐宅的 wardReserved 排除即可。
];
const WARD_SHIFT_MAX = 300; // 推离保护区超过此距离 = 这一格本来就压在仪制区里，弃格
const FILL_HALF = 330;      // 补位坊半跨
const FILL_MAX = 6;         // 抖动后最多补几坊
const WARD_STEP = 120;      // 补位扫描栅格
/** 大路中线（里坊主街，御街以外的 5 条 ×2 侧 ×2 轴）：补位坊必须避开，坊格本身见下方 RING_HALF_MAX 的取舍 */
const ROAD_LINES = [900, 1700, 2500, 3300, 4100];
const ROAD_PAD = 10.5;      // 最大路段半宽 8.5 + 2m 余量

/** 把坊推离保护区：四向取最近，多框取最大；累计推移超阈值则弃格（null） */
function keepOutOf(cx0: number, cz0: number, half: number): [number, number] | null {
  let cx = cx0;
  let cz = cz0;
  let moved = 0;
  for (let pass = 0; pass < 4; pass++) {
    let need = -1;
    let tx = cx;
    let tz = cz;
    for (const [x0, x1, z0, z1] of WARD_KEEP) {
      if (cx + half <= x0 || cx - half >= x1 || cz + half <= z0 || cz - half >= z1) continue;
      let d = Math.abs(x0 - half - cx);
      let nx = x0 - half;
      let nz = cz;
      let dd = Math.abs(x1 + half - cx);
      if (dd < d) { d = dd; nx = x1 + half; nz = cz; }
      dd = Math.abs(z0 - half - cz);
      if (dd < d) { d = dd; nx = cx; nz = z0 - half; }
      dd = Math.abs(z1 + half - cz);
      if (dd < d) { d = dd; nx = cx; nz = z1 + half; }
      if (d > need) { need = d; tx = nx; tz = nz; }
    }
    if (need < 0) return [cx, cz];
    moved += need;
    if (moved > WARD_SHIFT_MAX) return null;
    cx = tx;
    cz = tz;
  }
  return null;
}

/** 补位坊候选点：离保护区留 30m 余量 */
function fillClear(cx: number, cz: number, half: number): boolean {
  for (const [x0, x1, z0, z1] of WARD_KEEP) {
    if (!(cx + half <= x0 - 30 || cx - half >= x1 + 30 || cz + half <= z0 - 30 || cz - half >= z1 + 30)) return false;
  }
  for (const p of ROAD_LINES) for (const s of [-1, 1]) {
    if (Math.abs(cx - s * p) < half + ROAD_PAD || Math.abs(cz - s * p) < half + ROAD_PAD) return false;
  }
  return true;
}

/**
 * 大路路廊 vs 坊格的取舍（实测数据，勿轻易改）：
 * 坊格 800 间距 = 大路 800 间距，坊心距路 400m；半跨一旦 > 394.7m（= 400 − 路半宽 8.5 + 民宅内缩 3.2）
 * 民宅就必然压到路面。实测把坊格裁到「完全不压路」（半跨 ≤ 389.5、median 354）时，
 * 并集覆盖率掉到 72.6%，比旧布局 78.9% 还低 —— 与「覆盖面积不得下降」直接冲突。
 * 故坊格不为大路让位（只让补位坊避开路廊），只把 ±700 那圈（离路仅 200m）压回旧版 350，
 * 使它的压入深度落在 110–200m（旧版恒 155m），不因放大半跨而进一步恶化。
 */
const RING_HALF_MAX = 350;

let _wardCache: { cx: number; cz: number; half: number }[] | null = null;

/**
 * 里坊坊格。旧版是 100 格等距 800、半跨恒 380 的规则网格加一圈 half=350：俯瞰就是坐标纸。
 * 现在三件事全部由坊心坐标 hash 决定（不消耗共享 RNG，重建逐值一致）：
 *   ① 坊心 ±45m 抖动；② 半跨 300–420m（u^0.3 → 大坊居多，median≈395，补足抖动带来的方差、
 *      并集覆盖不下降；±700 那圈例外，压回旧版 350，见 RING_HALF_MAX）；
 *   ③ 抖动让相邻坊之间出现 0–90m 宽窄不一的缝（也允许互相咬进几十米），这就是「散落」的来源。
 * 默认每格不去对齐：只有会压进仪制保护区的格才被整体推移，推不动就弃格，再由补位坊回填空洞。
 */
export function wardCells(): { cx: number; cz: number; half: number }[] {
  if (_wardCache) return _wardCache.slice();
  // 完整网格：所有 x × z 组合（不是仅对角线）+ 近城 ±700 一圈
  const positions = [-4500, -3700, -2900, -2100, -1300, 1300, 2100, 2900, 3700, 4500];
  const base: [number, number][] = [];
  for (const cx of positions) for (const cz of positions) base.push([cx, cz]);
  for (const cx of positions) for (const cz of [-700, 700]) base.push([cx, cz]);
  const cells: { cx: number; cz: number; half: number }[] = [];
  for (const [cx0, cz0] of base) {
    const cx = cx0 + (wardHash(cx0, cz0, 101) - 0.5) * 90;
    const cz = cz0 + (wardHash(cx0, cz0, 211) - 0.5) * 90;
    const want = 300 + 120 * Math.pow(wardHash(cx0, cz0, 307), 0.3);
    const half = Math.abs(cz0) === 700 ? Math.min(RING_HALF_MAX, want) : want;
    const fit = keepOutOf(cx, cz, half);
    if (fit) cells.push({ cx: fit[0], cz: fit[1], half });
  }
  // 补位坊：抖动之后仍剩几处大空洞，补 3–6 坊（挑「离最近坊最远」的合法点：避开仪制区与大路路廊）
  for (let k = 0; k < FILL_MAX; k++) {
    let bestD = 150;
    let bx = 0;
    let bz = 0;
    for (let x = -4520; x <= 4520; x += WARD_STEP) {
      for (let z = -4520; z <= 4520; z += WARD_STEP) {
        if (Math.abs(x) + FILL_HALF > 4900 || Math.abs(z) + FILL_HALF > 4900) continue;
        if (!fillClear(x, z, FILL_HALF)) continue;
        let d = Infinity;
        for (const c of cells) {
          const dd = Math.max(Math.abs(x - c.cx), Math.abs(z - c.cz)) - c.half;
          if (dd < d) d = dd;
        }
        if (d > bestD) { bestD = d; bx = x; bz = z; }
      }
    }
    if (bestD <= 150) break;
    cells.push({ cx: bx, cz: bz, half: FILL_HALF });
  }
  _wardCache = cells;
  return cells.slice();
}

export function wardReserved(x: number, z: number): boolean {
  // 只保留真正由手工几何占据的地带，其余全部交给 WardInfill：
  // 旧版 |x| < 950 一刀切，把 infill.ts 在 |x| 24–886 / |z| 470–2880 造好的 120 坊逐个丢掉，
  // 城市中轴因此留下一条 1900m 宽、贯穿全城的空带（俯瞰一眼可见）。
  //
  // 河道足迹（R20）：旧版只在「|z|<210 且 |x|<960」这一块保留，|x|>960 之后整条汴河
  // 没有任何保留判定 —— 里坊把厢房直接盖到水面上（实测 24 个 infill_gable 实例落在
  // x≈3026–3243、z≈−18…21 的河道里）。这里改用 riverGeom 的同一份真源判足迹，
  // pad 10m = 水面外 6m 河沿 + 3.2m 纤道，房子退到驳岸线外。
  if (inRiverFootprint(x, z, 10)) return true;
  if (Math.abs(x) < 26) return true; // 御街
  if (Math.abs(z) < 210 && Math.abs(x) < 960) return true; // 临河手工段（街市/码头/桥）
  if (z < -2890 && Math.abs(x) < 1150) return true; // 宫城（北墙 −4000，见 PALACE）
  // 宫前商业街（R5）：铺面占 |x| 19–33 与 |x| 40–56 两进，第一列里坊的临街院宅要让开
  if (z > -2950 && z < -2280 && Math.abs(x) < 36) return true;
  if (Math.abs(x - 2800) < 160 && Math.abs(z - 900) < 160) return true; // 东市（只留市集本体 300×300）
  if (Math.abs(x + 2800) < 160 && Math.abs(z - 900) < 160) return true; // 西市
  return false;
}

/**
 * W-N 宫城四至（导出给探针/调度）：中轴 x=0，午门仍在 z=−2950，北墙内收到 z=−4000。
 * 南北 1050m；北墙到北城墙 1000m、午门到南城墙 2050m、东西墙到城墙各 3900m。
 */
export const PALACE = {
  x0: -1100, x1: 1100, z0: -4000, z1: -2950,
  taiheZ: -3260, zhongheZ: -3480, baoheZ: -3690,
  /** 三大殿檐口高（地面起算，m）——探针直接读 PALACE.eave */
  eave: { taihe: 26, zhonghe: 24, baohe: 25 },
} as const;

/**
 * R5 两段商业街矩形（供 lead 在矩形内生成人流）：
 *  · front 宫前：午门前 130m 广场之后，御街两厢连铺 520m；
 *  · back  宫后：北御沟石栏外卖场，御街两厢连铺 840m。
 */
export const PALACE_STREETS = {
  front: { x0: -60, x1: 60, z0: -2820, z1: -2290 },
  back: { x0: -60, x1: 60, z0: -4920, z1: -4040 },
} as const;

interface RoadSeg { x0: number; z0: number; x1: number; z1: number; w: number }

const _segCache = new Map<string, RoadSeg[]>();

/** 一条大路的折线段（纯计算）。roadStrip 用它铺路面，roadBlocked 用它给民宅让路。 */
function roadSegs(fixed: number, alongX: boolean, salt: number): RoadSeg[] {
  const key = `${fixed}|${alongX ? 1 : 0}|${salt}`;
  const hit = _segCache.get(key);
  if (hit) return hit;
  const L = 2 * WALL - 200; // 9800：两端各留 100m 贴城墙
  const n = 6 + Math.floor(wardHash(fixed, salt, 11) * 3);
  const segLen = L / n;
  const off: number[] = [];
  const wid: number[] = [];
  for (let k = 0; k <= n; k++) {
    off.push((k % 2 === 0 ? 1 : -1) * (36 + wardHash(fixed, salt * 31 + k, 23) * 4));
    if (k < n) wid.push(9 + wardHash(fixed, salt * 17 + k, 91) * 8);
  }
  const out: RoadSeg[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = -L / 2 + k * segLen;
    const a1 = a0 + segLen;
    out.push({
      x0: alongX ? a0 : fixed + off[k],
      z0: alongX ? fixed + off[k] : a0,
      x1: alongX ? a1 : fixed + off[k + 1],
      z1: alongX ? fixed + off[k + 1] : a1,
      w: wid[k],
    });
  }
  _segCache.set(key, out);
  return out;
}

/**
 * 一条大路的折线路面：沿 alongX 方向铺 6–8 段，每段一个 box（用 ry 转向）。
 * 断点横向偏移固定在 ±(36–40)m 且相邻反号，段长 1225–1633m → 接头转角 5.0–7.5°。
 * 段宽 9–17m（相邻段宽差即路口瓶颈），段内明度 0.96–1.04。
 */
function roadStrip(b: Baker, fixed: number, alongX: boolean, salt: number): void {
  const segs = roadSegs(fixed, alongX, salt);
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const ry = Math.atan2(-(s.z1 - s.z0), s.x1 - s.x0);
    const tone = 0.96 + wardHash(fixed, salt * 13 + k, 57) * 0.08;
    b.box('ground', Math.hypot(s.x1 - s.x0, s.z1 - s.z0), 0.14, s.w, (s.x0 + s.x1) / 2, 0.05, (s.z0 + s.z1) / 2, shade(C.road, tone), ry);
  }
}

/**
 * 民宅是否压在大路路廊上。坊格 800 间距 = 大路 800 间距、坊心距路 400m，半跨一旦 >394.7m
 * 民宅就必然压到路面（实测 107/122 坊压路，中位 41.8m、最深 307m）。
 * 坊格本身不缩（缩了覆盖率掉到 72.6%，比旧版 78.9% 还低），改成**逐宅让路**：
 * 宅心到路中线距离 < 路半宽 + 宅包络半径 就跳过这一户。路面因此连续，房子贴着路边长，
 * 这才是密集城市的样子。
 */
export function roadBlocked(x: number, z: number, r: number): boolean {
  // 快速否判：大路只落在 ±ROAD_LINES 这几个坐标带上，离所有带都超过 60+r 的点直接放过，
  // 免得十几万个地块每个都跑 20 条路 × 7 段。
  let near = false;
  for (const p of ROAD_LINES) {
    if (Math.abs(Math.abs(x) - p) < 60 + r || Math.abs(Math.abs(z) - p) < 60 + r) { near = true; break; }
  }
  if (!near) return false;
  for (const p of ROAD_LINES) {
    for (const s of [-1, 1]) {
      for (const alongX of [true, false]) {
        const salt = alongX ? s * 7 : s * 11;
        for (const seg of roadSegs(s * p, alongX, salt)) {
          const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0;
          const len2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - seg.x0) * dx + (z - seg.z0) * dz) / len2));
          const px = seg.x0 + dx * t, pz = seg.z0 + dz * t;
          if (Math.hypot(x - px, z - pz) < seg.w / 2 + r) return true;
        }
      }
    }
  }
  return false;
}

// ============ W26 城墙加固：碉堡 / 城门楼构件 ============
/**
 * 马面碉堡：12×15×12 三层收分墩体，墩心外移 5.6m（外挑 4.3m 成侧射面），
 * 顶 12 垛口 + 4 射孔，上起一座两层小阁楼（下层实墙 / 上层敞亭 / 攒尖顶 / 旗杆）。
 * 旧版是压在墙心的 8×13×8 方墩：墙基 14.6m 宽把它整个吞掉，只在墙顶露出一块方头。
 * 镜像：alongX=true 表示墙沿 x 走向（南北墙），out 为出墙方向（±z / ±x）。
 */
function bastion(b: Baker, cx: number, cz: number, alongX: boolean, out: number): void {
  const bx = cx + (alongX ? 0 : out * 5.6);
  const bz = cz + (alongX ? out * 5.6 : 0);
  const D = (wu: number, wv: number): [number, number] => (alongX ? [wu, wv] : [wv, wu]);
  const put = (g: BGroup, wu: number, h: number, wv: number, du: number, dv: number, y: number, hex: number): void => {
    const [w, d] = D(wu, wv);
    b.box(g, w, h, d, bx + (alongX ? du : dv), y, bz + (alongX ? dv : du), hex);
  };
  // 墩体：三层收分，顶 15.3 与新城墙压顶（15.82）只差 0.5m——远看是墙身上长出的一座方堡
  put('ash', 13.4, 1.0, 13.4, 0, 0, 0.5, 0x8b877b);
  put('earth', 12.6, 5.1, 12.6, 0, 0, 2.55, shade(0x8a7b66, 0.95));
  put('earth', 12.0, 5.1, 12.0, 0, 0, 7.65, shade(0x8f8070, 1));
  put('earth', 11.4, 5.1, 11.4, 0, 0, 12.75, shade(0x94856f, 1.02));
  put('ash', 11.8, 0.3, 11.8, 0, 0, 15.45, 0x9a9282);
  // 垛口平台：四面各 3 垛（垛 1.9 / 口 1.4）
  for (const s of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      put('ash', 1.9, 1.2, 0.55, k * 3.3, s * 5.25, 16.2, 0x9a9282);
      put('ash', 0.55, 1.2, 1.9, s * 5.25, k * 3.3, 16.2, 0x9a9282);
    }
  }
  // 射孔：四面各一，压在中层墩面
  for (const s of [-1, 1]) {
    put('lacquer', 0.5, 1.6, 0.16, 0, s * 6.03, 8.4, 0x1e1a18);
    put('lacquer', 0.16, 1.6, 0.5, s * 6.03, 0, 8.4, 0x1e1a18);
  }
  // 小阁楼：台明 + 下层实墙（2.4）+ 平座栏杆 + 上层敞亭（8 柱）+ 攒尖顶 + 旗杆
  put('ash', 7.2, 0.3, 7.2, 0, 0, 15.75, 0x938c7c);
  put('ash', 5.4, 2.4, 5.4, 0, 0, 16.8, 0x968e7e);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    put('wood', 0.34, 2.6, 0.34, su * 2.62, sv * 2.62, 16.9, shade(C.woodRed, 1.02));
  }
  put('lacquer', 1.3, 2.0, 0.14, 0, -out * 2.73, 16.7, 0x241d18); // 城内侧开门
  put('ash', 6.9, 0.22, 6.9, 0, 0, 18.11, 0x9c9a90);              // 平座
  for (const s of [-1, 1]) {
    put('wood', 6.5, 0.09, 0.09, 0, s * 3.32, 18.82, 0x8a3324);
    put('wood', 6.5, 0.07, 0.07, 0, s * 3.32, 18.5, 0x8a3324);
    put('wood', 0.09, 0.09, 6.5, s * 3.32, 0, 18.82, 0x8a3324);
    put('wood', 0.07, 0.07, 6.5, s * 3.32, 0, 18.5, 0x8a3324);
    for (let k = -2; k <= 2; k++) {
      put('wood', 0.12, 0.8, 0.12, k * 1.55, s * 3.32, 18.55, 0x8a3324);
      put('wood', 0.12, 0.8, 0.12, s * 3.32, k * 1.55, 18.55, 0x8a3324);
    }
  }
  // 上层敞亭：8 柱（3×3 去心）+ 四面阑额
  for (const su of [-1, 0, 1]) for (const sv of [-1, 0, 1]) {
    if (su === 0 && sv === 0) continue;
    put('wood', 0.26, 2.2, 0.26, su * 2.3, sv * 2.3, 19.32, shade(C.woodRed, 0.98));
  }
  for (const s of [-1, 1]) {
    put('wood', 4.9, 0.22, 0.2, 0, s * 2.3, 20.35, shade(C.woodDark, 1.06));
    put('wood', 0.2, 0.22, 4.9, s * 2.3, 0, 20.35, shade(C.woodDark, 1.06));
  }
  // 攒尖顶：四棱锥（4 段圆柱转 45° 得方形伞顶，底边 4.24 半跨）+ 檐口枋
  b.cyl('roof', 0.12, 6.0, 2.1, 4, bx, 21.45, bz, shade(0x35594c, 1.06), Math.PI / 4);
  for (const s of [-1, 1]) {
    b.box('roof', 8.7, 0.18, 0.26, bx, 20.48, bz + s * 4.24, shade(0x35594c, 0.82));
    b.box('roof', 0.26, 0.18, 8.7, bx + s * 4.24, 20.48, bz, shade(0x35594c, 0.82));
  }
  b.cyl('metal', 0.14, 0.2, 0.4, 8, bx, 22.65, bz, 0xd8b028);
  // 旗杆 + 旗面 + 旗顶灯（点状，唯一 glow）
  b.box('wood', 0.14, 4.0, 0.14, bx + 0.4, 24.6, bz, shade(C.woodDark, 1.05));
  b.box('fabric', 1.5, 0.9, 0.04, bx + 1.2, 26.1, bz, 0x9d2933);
  b.box('glow', 0.22, 0.22, 0.22, bx + 0.4, 26.7, bz, 0xffb300);
}

/** 阙：夯土阙身三层收分（12m）+ 石压顶 + 小歇山顶（中轴门两侧各一） */
function cityQue(b: Baker, x: number, z: number): void {
  b.box('ash', 9.2, 0.9, 9.2, x, 0.45, z, 0x8b877b);
  b.box('earth', 8.2, 4.6, 8.2, x, 2.3, z, shade(0x8a7b66, 0.97));
  b.box('earth', 7.6, 4.2, 7.6, x, 6.7, z, shade(0x8f8070, 1));
  b.box('earth', 7.0, 3.4, 7.0, x, 10.5, z, shade(0x94856f, 1.03));
  b.box('ash', 7.4, 0.3, 7.4, x, 12.35, z, 0x9a9282);
  for (const s of [-1, 1]) {
    b.box('lacquer', 0.5, 1.7, 0.16, x, 8.9, z + s * 3.72, 0x1e1a18);
    b.box('lacquer', 0.16, 1.7, 0.5, x + s * 3.72, 8.9, z, 0x1e1a18);
  }
  roofOnCapped(b, 8.4, 8.4, 12.5, x, z, 0, shade(0x35594c, 1.02), undefined, 1.9);
  b.cyl('metal', 0.16, 0.24, 0.5, 8, x, 14.85, z, 0xd8b028);
  b.cyl('metal', 0.3, 0.12, 0.35, 8, x, 15.2, z, 0xd8b028);
}

/**
 * 城门：石包城台（15.8m、出墙 2.7m）+ 门洞暗腔与双扇门钉 + 5.2m 垛口平台 +
 * 20m 三门楼（下层门厅 / 中层议事 / 上层瞭望，三道腰檐 + 重檐歇山）+ 两侧值守厢房。
 * 旧版墩只 7m 深、整个埋进墙里，城台 3m、木身 7m——从城外看只剩一个浮在墙顶的小盒子。
 */
function cityGate(b: Baker, gx: number, gz: number, ry: number, along: boolean, mid: boolean): void {
  const out = along ? Math.sign(gz) : Math.sign(gx);
  const P = (du: number, dv: number): [number, number] => (along ? [gx + du, gz + dv] : [gx + dv, gz + du]);
  const D = (wu: number, wv: number): [number, number] => (along ? [wu, wv] : [wv, wu]);
  const put = (g: BGroup, wu: number, h: number, wv: number, du: number, dv: number, y: number, hex: number): void => {
    const [wx, wz] = P(du, dv);
    const [w, d] = D(wu, wv);
    b.box(g, w, h, d, wx, y, wz, hex);
  };
  const TOP = 15.8;                 // 新城墙压顶面：城台自此起砌
  const PW = mid ? 24 : 20;         // 城台面阔（沿墙）
  const PD = 20;                    // 城台进深：出墙各 2.7m
  const GW = mid ? 16 : 11;         // 门楼木身面阔
  const GD = mid ? 10 : 7.5;        // 门楼进深
  const OPEN = mid ? 16 : 13;       // 门洞净宽（侧门窄一档，城台只 20m 宽）
  const OH = mid ? 11 : 10;         // 门洞净高
  // ① 城台：夯土芯 + 三道石皮 + 四角隅石（大面积仍是 earth，符合“禁大面积 wall”）
  put('ash', PW + 1.6, 1.0, PD + 1.6, 0, 0, 0.5, 0x8b877b);
  put('earth', PW, TOP - 1.0, PD, 0, 0, 1.0 + (TOP - 1.0) / 2, shade(0x8f8070, 0.99));
  for (const yy of [3.9, 8.1, 12.3]) put('ash', PW + 0.26, 0.5, PD + 0.26, 0, 0, yy, 0x948f80);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    put('ash', 0.9, TOP, 0.9, su * (PW / 2 - 0.05), sv * (PD / 2 - 0.05), TOP / 2, 0x8d8a80);
  }
  // ② 门洞：石券脸 + 暗腔（内外）+ 双扇板门 + 门钉 5×5（旧版门洞是空口，没有门）
  put('ash', OPEN + 2.8, 1.0, 0.6, 0, out * (PD / 2 + 0.05), OH + 0.5, 0x9c9a90);
  for (const s of [-1, 1]) {
    put('ash', 0.9, OH + 1.0, 0.6, s * (OPEN / 2 + 0.45), out * (PD / 2 + 0.05), (OH + 1) / 2, 0x9c9a90);
    put('lacquer', OPEN, OH, 0.24, 0, s * (PD / 2 + 0.03), OH / 2 + 0.1, 0x161417);
  }
  for (const s of [-1, 1]) {
    const du = s * (OPEN / 4);
    put('lacquer', OPEN / 2 - 0.2, 9.3, 0.3, du, out * (PD / 2 + 0.22), 4.75, 0x7a1f1a);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      put('metal', 0.24, 0.24, 0.16, du - 2.9 + c * 1.45, out * (PD / 2 + 0.4), 2.2 + r * 1.55, 0xd8b028);
    }
  }
  put('metal', 0.22, 9.4, 0.18, 0, out * (PD / 2 + 0.4), 4.8, 0x8a7a52);
  // 门额匾：内外两面各一
  for (const s of [-1, 1]) {
    put('lacquer', 13, 1.8, 0.42, 0, s * (PD / 2 + 0.16), 13.0, 0x241f1c);
    for (const t of [-1, 1]) put('metal', 0.22, 1.9, 0.5, t * 6.4, s * (PD / 2 + 0.16), 13.0, 0xd8b028);
    put('metal', 13.2, 0.2, 0.5, 0, s * (PD / 2 + 0.16), 13.95, 0xd8b028);
    put('metal', 13.2, 0.2, 0.5, 0, s * (PD / 2 + 0.16), 12.05, 0xd8b028);
  }
  // 门上悬灯两盏（点状 glow）
  for (const s of [-1, 1]) {
    put('metal', 0.5, 0.6, 0.5, s * 7.4, out * (PD / 2 + 0.5), 10.6, 0x4a4e54);
    put('glow', 0.42, 0.55, 0.42, s * 7.4, out * (PD / 2 + 0.55), 10.85, C.lantern);
  }
  // ③ 城台 5.2m（旧版 3m）+ 垛口平台
  const PLW = mid ? 40 : 30;
  put('ash', PLW + 1.2, 0.45, 18.0, 0, 0, TOP + 0.22, 0x8b877b);
  put('earth', PLW, 5.2, 17, 0, 0, TOP + 2.6, shade(0x8f8070, 1.01));
  put('ash', PLW + 0.8, 0.5, 17.6, 0, 0, TOP + 5.45, 0x9c9a90);
  for (const s of [-1, 1]) {
    put('ash', PLW, 1.0, 0.6, 0, s * 8.2, TOP + 5.7, 0x9a9282);
    put('ash', 0.6, 1.0, 17, s * (PLW / 2 - 0.3), 0, TOP + 5.7, 0x9a9282);
  }
  for (let k = -3; k <= 3; k++) put('ash', 2.2, 1.2, 0.7, k * (PLW / 2 - 2.4) / 3, out * 8.2, TOP + 6.3, 0x9a9282);
  // ④ 门楼三层，木身 20m（21.45 → 41.45），每层带腰檐；各层按面阔等比退进
  const Y0 = 21.45;
  const L2W = GW - 1.2, L2D = GD - 0.8;
  const L3W = L2W - 1.6, L3D = L2D - 1.0;
  put('wood', GW, 6.9, GD, 0, 0, Y0 + 3.45, 0xa63a2b);
  for (const s of [-1, 1]) {
    for (let k = -2; k <= 2; k++) put('wood', 0.5, 6.9, 0.5, k * (GW / 2 - 0.55) / 2, s * (GD / 2 + 0.08), Y0 + 3.45, shade(0xa63a2b, 0.82));
    for (let k = -1; k <= 1; k++) put('wood', 0.5, 6.9, 0.5, s * (GW / 2 + 0.08), k * (GD / 2 - 0.6), Y0 + 3.45, shade(0xa63a2b, 0.82));
  }
  put('lacquer', GW * 0.46, 4.9, 0.28, 0, out * (GD / 2 + 0.03), Y0 + 2.55, 0x5e1c1a);
  put('wood', GW * 0.5, 0.5, 0.34, 0, out * (GD / 2 + 0.06), Y0 + 5.2, shade(C.woodDark, 1.1));
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    put('wood', 1.7, 2.4, 0.22, t * GW * 0.31, s * (GD / 2 + 0.02), Y0 + 3.5, 0x2a1c12);
    put('glow', 1.4, 2.0, 0.1, t * GW * 0.31, s * (GD / 2 + 0.14), Y0 + 3.5, C.winGlow);
  }
  roofOnCapped(b, GW + 3.2, GD + 3.2, Y0 + 6.9, gx, gz, ry, shade(0x5c6878, 1.02), undefined, 1.2);
  // 中层议事：28.3 → 34.9
  put('wood', L2W, 6.6, L2D, 0, 0, 31.6, 0x9d3327);
  for (const s of [-1, 1]) for (const k of [-0.7, 0, 0.7]) {
    put('wood', 1.8, 2.6, 0.2, k * L2W * 0.5, s * (L2D / 2 + 0.02), 31.6, 0x2a1c12);
    put('glow', 1.5, 2.2, 0.1, k * L2W * 0.5, s * (L2D / 2 + 0.14), 31.6, C.winGlow);
  }
  roofOnCapped(b, L2W + 2.6, L2D + 2.8, 34.9, gx, gz, ry, shade(0x5c6878, 1.06), undefined, 1.05);
  // 上层瞭望：34.8 → 41.45，四面开窗（点状窗光，不做通长灯带）
  put('wood', L3W, 6.65, L3D, 0, 0, 38.12, 0x8e2f24);
  for (const s of [-1, 1]) {
    for (const k of [-0.78, -0.26, 0.26, 0.78]) {
      put('wood', 1.4, 2.3, 0.2, k * L3W * 0.5, s * (L3D / 2 + 0.02), 38.2, 0x241a16);
      put('glow', 1.1, 1.9, 0.1, k * L3W * 0.5, s * (L3D / 2 + 0.14), 38.2, C.winGlow);
    }
    for (const k of [-0.6, 0, 0.6]) {
      put('wood', 0.2, 2.3, 1.3, s * (L3W / 2 + 0.02), k * L3D * 0.5, 38.2, 0x241a16);
      put('glow', 0.1, 1.9, 1.0, s * (L3W / 2 + 0.14), k * L3D * 0.5, 38.2, C.winGlow);
    }
  }
  // 重檐歇山：下檐 22×10、上檐 16×8（侧门按比例缩小）
  const RW = mid ? 22 : 17, RD = mid ? 10 : 8.5;
  roofOnCapped(b, RW, RD, 41.45, gx, gz, ry, shade(0x35594c, 1.04), undefined, 2.2);
  // 重檐之间的上层檐墙：旧版上檐直接落在下檐上方 2.15m，四周没有任何墙体承托，
  // 侧看是一条透空通缝（上檐像一块浮板）。补一圈 0.9m 内收的檐墙 + 围脊压顶。
  {
    const UW = RW - 6 - 1.8, UD = RD - 2 - 1.8;
    const WY = 41.45 + (43.6 - 41.45) / 2, WH = 43.6 - 41.45;
    for (const s of [-1, 1] as const) {
      put('lacquer', UW, WH, 0.34, 0, s * (UD / 2), WY, 0x7a1f1a);
      put('lacquer', 0.34, WH, UD, s * (UW / 2), 0, WY, 0x7a1f1a);
      put('roof', UW + 0.5, 0.22, 0.62, 0, s * (UD / 2), 43.52, shade(0x35594c, 0.86));
      put('roof', 0.62, 0.22, UD + 0.5, s * (UW / 2), 0, 43.52, shade(0x35594c, 0.86));
    }
  }
  roofOnCapped(b, RW - 6, RD - 2, 43.6, gx, gz, ry, shade(0x35594c, 1.1), undefined, 1.9);
  b.cyl('metal', 0.3, 0.55, 1.0, 8, gx, 45.85, gz, 0xd8b028);
  b.cyl('metal', 0.5, 0.18, 0.4, 8, gx, 46.45, gz, 0xd8b028);
  for (const s of [-1, 1]) {
    const [bx2, bz2] = P(0, s * (L3D / 2 + 0.3));
    dougongBand(b, bx2, 41.0, bz2, L3W - 1, along ? 0 : Math.PI / 2, 0xd8b028);
  }
  // ⑤ 值守厢房（8×5，单坡顶）：塔身两侧各一
  for (const s of [-1, 1]) {
    const du = s * (GW / 2 + 4.7);
    put('ash', 8.4, 0.4, 5.4, du, out * 3.0, 21.65, 0x8b877b);
    put('ash', 8, 3.2, 5, du, out * 3.0, 23.45, 0x968e7e);
    put('wood', 8.2, 0.3, 5.2, du, out * 3.0, 25.15, shade(C.woodDark, 1.02));
    const [rx2, rz2] = along ? [out * 0.22, 0] : [0, -out * 0.22];
    const [wx, wz] = P(du, out * 3.0);
    b.box('roof', along ? 9.0 : 6.4, 0.4, along ? 6.4 : 9.0, wx, 25.6, wz, shade(0x5c6878, 1.04), 0, rx2, rz2);
    put('glow', 0.3, 0.4, 0.3, du + s * 3.4, out * 5.0, 22.6, C.lantern);
  }
  // ⑥ 四座正门的双阙：阙身 12m，左右各一，阙顶小歇山
  if (mid) {
    for (const s of [-1, 1]) {
      const [qx, qz] = P(s * 24.5, out * 13.0);
      cityQue(b, qx, qz);
    }
  }
}

const yieldFrameI = (): Promise<void> => new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r()); else setTimeout(r, 0); });

/**
 * 皇城 + 里坊。**异步分片**：城的构筑（墙/门/宫城）之后是逐坊民居循环，
 * 一坊 ~25 户 × 院墙/正房/厢房/窗光，整段实测 1.7s 阻塞。现在每 3 坊让一帧。
 */
export async function buildImperialCity(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): Promise<void> {
  const W = WALL;
  // ---- 城墙四面 + 马面 ----
  // sx=1 表示墙沿 x 走向（南北墙）；东西墙几何必须是 (14.6, 15.5, len)，轴反了会变成 10km 长板横贯全城
  // 夯土城身 + 三层收分：旧版是一根 12m 等宽、`wall` 组（自带蓝灰自发光）的通长方条，
  // 远看就是一道浅灰水泥护栏。宋汴京城墙是夯土版筑、外壁明显收分、顶上一圈女墙垛口。
  // W26 加固：墙身 11.9 → 15.5（14.6/13.6/12.6 × 4.4/5.6/5.5），压顶石与女墙同步抬到 15.8；
  // 顶面加 8m 砖马道，外侧女墙带垛口、内侧改 1.0m 实心宇墙（旧版两道都带垛口，内侧垛口只挡马道）。
  for (const [dx, dz, len, sx] of [[W, 0, W * 2, 0], [-W, 0, W * 2, 0], [0, W, W * 2, 1], [0, -W, W * 2, 1]] as const) {
    const out = sx ? Math.sign(dz) : Math.sign(dx); // 外侧 = 远离城心的一侧
    b.box('earth', sx ? len : 14.6, 4.4, sx ? 14.6 : len, dx, 2.2, dz, shade(0x8a7b66, 0.96));
    b.box('earth', sx ? len : 13.6, 5.6, sx ? 13.6 : len, dx, 7.2, dz, shade(0x8f8070, 1));
    b.box('earth', sx ? len : 12.6, 5.5, sx ? 12.6 : len, dx, 12.75, dz, shade(0x94856f, 1.02));
    // 压顶石
    b.box('ash', sx ? len : 13.0, 0.32, sx ? 13.0 : len, dx, 15.66, dz, 0x9a9282);
    // 马道：8m 砖面（顶 15.92）+ 两侧牙石；旧版墙顶是 11.5m 宽的压顶石，马道无处落脚
    b.box('ash', sx ? len : 8, 0.1, sx ? 8 : len, dx, 15.87, dz, 0x8a8478);
    for (const s of [-1, 1]) {
      b.box('ash', sx ? len : 0.36, 0.16, sx ? 0.36 : len, dx + (sx ? 0 : s * 4.2), 15.9, dz + (sx ? s * 4.2 : 0), 0x948d7e);
    }
    for (const s of [-1, 1]) {
      const ox = sx ? 0 : s * 5.75;
      const oz = sx ? s * 5.75 : 0;
      if (s === out) {
        // 外侧：女墙 + 垛口（每 12m 一垛，垛宽 3.4、口宽 8.6）
        b.box('earth', sx ? len : 0.72, 1.0, sx ? 0.72 : len, dx + ox, 16.32, dz + oz, shade(0x8f8070, 1.06));
        const n = Math.floor(len / 12);
        for (let i = 0; i < n; i++) {
          const t = -len / 2 + 6 + i * 12;
          b.box('earth', sx ? 3.4 : 0.86, 1.5, sx ? 0.86 : 3.4, dx + ox + (sx ? t : 0), 16.57, dz + oz + (sx ? 0 : t), shade(0x8a7b66, 1.04));
        }
      } else {
        // 内侧宇墙：1.0m 实墙 + 石压顶（不设垛口——垛口只朝外）
        b.box('earth', sx ? len : 0.8, 1.0, sx ? 0.8 : len, dx + ox, 16.32, dz + oz, shade(0x94856f, 1.04));
        b.box('ash', sx ? len : 0.9, 0.12, sx ? 0.9 : len, dx + ox, 16.88, dz + oz, 0x9a9282);
      }
    }
  }
  // 马面 → 碉堡（每 500m 一墩）：19 个点位 × 4 面 = 76，扣掉与十二门重合的 12 个 = 64 座
  for (let p = -4500; p <= 4500; p += 500) {
    if (Math.abs(p) < 40 || Math.abs(Math.abs(p) - 2600) < 40) continue; // 门位让开（墩压门楼）
    for (const s of [-1, 1]) {
      bastion(b, p, s * W, true, s);   // 南北墙：墙沿 x，外法线 ±z
      bastion(b, s * W, p, false, s);  // 东西墙：墙沿 z，外法线 ±x
    }
  }
  // ---- 十二门（每面 3 座：中门+左右门） ----
  const gates: [number, number, number][] = [
    [0, W, 0], [-2600, W, 0], [2600, W, 0],
    [0, -W, Math.PI], [-2600, -W, Math.PI], [2600, -W, Math.PI],
    [W, 0, -Math.PI / 2], [W, 2600, -Math.PI / 2], [W, -2600, -Math.PI / 2],
    [-W, 0, Math.PI / 2], [-W, 2600, Math.PI / 2], [-W, -2600, Math.PI / 2],
  ];
  const gateNames = ['景龍門', '朝陽門', '宣化門', '天波門', '金耀門', '通天門'];
  gates.forEach(([gx, gz, ry], i) => {
    const along = ry === 0 || Math.abs(ry) === Math.PI; // 门在南北墙（门面朝 ±z）
    // 中门（轴线上）规格高于侧门：城台更宽、门楼更大、四座正门另加双阙——依 45 卷 3.1 城防节
    const mid = gx === 0 || gz === 0;
    cityGate(b, gx, gz, ry, along, mid);
    // 门额匾：挂在门洞上方的门额上，正面朝城外（旧版东西门匾额朝城内，从城外读不到）
    const out = along ? Math.sign(gz) : Math.sign(gx);
    const sgn = along ? (out > 0 ? 0 : Math.PI) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
    const [sgx, sgz] = along ? [gx, gz + out * 10.4] : [gx + out * 10.4, gz];
    const nm = gateNames[i % gateNames.length];
    sg.quad(atlas.text('g' + i, nm, 240, 70, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.88)', border: 'rgba(255,179,0,.8)', fontPx: 48 }), 5.2, 1.35, sgx, 13.0, sgz, sgn);
  });
  // ---- 大内御街（中轴线） ----
  b.box('ground', 26, 0.16, 8800, 0, 0.06, -800, shade(C.road, 1.12));

  // 御街两侧朱雀廊柱：只到午门为止（旧版一直排到 −4300，整排柱子从宫城里穿出来）
  // 2026-11-01 巡检修复「河心两根红柱 + 橙灯、无基座」：御街在 z=0 处跨汴河，160m 步进恰有一对
  // 落在河心（x=±16、z=0、柱体 y 0–7、灯 y 7.1–7.7，实测 city_wood_4 / city_glow）。
  // 水面半宽 31（river.ts HALF_IN），centralbelt.ts 也把 |z|<305 的临河段让给河道与桥面——
  // 廊柱必须同样止于桥头，否则柱子从水面长出来。跳过水面 + 驳岸余量后，跨河 320m 的缺口由虹桥接管。
  for (let z = -2880; z <= 300; z += 160) {
    if (Math.abs(z) < 44) continue;   // 汴河水面 ±31 + 桥头驳岸余量
    for (const sx of [-1, 1]) {
      b.box('wood', 0.7, 7, 0.7, sx * 16, 3.5, z, shade(C.woodRed, 1));
      b.box('glow', 0.5, 0.6, 0.5, sx * 16, 7.4, z, C.neonGold);
    }
    b.kit('avenue.zhuquePost', 2, 3.5);
  }
  // ---- 大路（里坊主街）：折线化 ----
  // 旧版每条都是通长 9800m 的直线、宽恒 14m，俯瞰就是一张坐标纸。现在走向 / 段数 / 段宽 / 明度
  // 全由坐标 hash 决定（不消耗共享 RNG，重建逐值一致）：6–8 段；断点横向游走 ±(36–40)m 且相邻断点反号，
  // 于是每个接头都是折角（5.0–7.5°）而不是一条缓弯；段宽 9–17m，收窄处即路口瓶颈；
  // 同一路段内明度 0.96–1.04，不再是一条通体发亮的带子。御街（x=0 中轴）是仪制轴线，保持上方的直线不参与。
  for (const p of ROAD_LINES) {
    for (const s of [-1, 1]) {
      roadStrip(b, s * p, true, s * 7);
      roadStrip(b, s * p, false, s * 11);
    }
  }
  // 护城河（四面水带）：旧水面顶 −1.0，压在城区下沉地表（−0.5）之下 0.5m，整圈埋进地里。
  // 现水面顶 −0.35：高出城区地表 0.15，低于城墙基座底（0.0）0.35；箱底 −0.65 压进地表，水沿不悬空。
  // 地形边界：城区平整盘半径 5250，城墙是 5000 见方（角半径 7071），近四角地表升至 25–42m，
  // 那几段水面仍被地形盖住——根治要改 world/terrain.ts 的城市遮罩，不属本文件。
  for (const [dx, dz, len, horiz] of [[0, W + 160, W * 2 + 500, true], [0, -W - 160, W * 2 + 500, true], [W + 160, 0, W * 2 + 500, false], [-W - 160, 0, W * 2 + 500, false]] as const) {
    b.box('water', horiz ? len : 46, 0.3, horiz ? 46 : len, dx, -0.5, dz, 0x14405c);
  }
  b.kit('water.moat', 4, -0.35);
  // ---- 里坊：街区坊墙 + 民居坊（外城 ~55 坊） ----
  const cells = wardCells();
  // 中轴与核心区例外
  const reserved = (x: number, z: number): boolean =>
    Math.abs(x) < 950 || (z < -3050 && Math.abs(x) < 1500) || (Math.abs(x - 2800) < 700 && Math.abs(z - 900) < 700) || (Math.abs(x + 2800) < 700 && Math.abs(z - 900) < 700);
  let wardIdx = 0;
  let wardNo = 0;
  for (const cell of cells) {
    if (wardNo++ % 3 === 0) await yieldFrameI();
    const { cx, cz, half } = cell;
    if (reserved(cx, cz)) continue;
    // 坊墙与地坪已移除（空中俯视呈网格线伪影；城市肌理由街道+建筑自然构成）

    // 坊内四角灯柱
    for (const [ox, oz] of [[-half + 30, -half + 30], [half - 30, -half + 30], [-half + 30, half - 30], [half - 30, half - 30]] as const) {
      b.cyl('wood', 0.1, 0.14, 4.2, 5, cx + ox, 2.1, cz + oz, C.woodDark);
      b.box('glow', 0.4, 0.5, 0.4, cx + ox, 4.4, cz + oz, 0xffb84a);
    }
    // 坊门
    b.box('wood', 4, 4.6, 1.2, cx, 2.3, cz - half, C.woodDark);
    const wardName = ['興仁坊', '積善坊', '上林坊', '昭德坊', '安業坊', '通濟坊', '樂郊坊', '崇仁坊', '務本坊', '廣化坊'][wardIdx++ % 10];
    sg.quad(atlas.text('ward' + wardIdx, wardName, 140, 56, { color: '#ffe9c8', glow: '#00e5ff', fontPx: 40, bg: 'rgba(8,12,22,0.85)', border: 'rgba(0,229,255,.6)' }), 2.4, 0.96, cx, 4.6, cz - half - 0.6, 0);
    // 民居宅院：不再是 5×5、间距恰好 120m 的方格阵（俯瞰"图纸感"的主因）。
    // 位置 ±34m 抖动、朝向 ±20°、尺寸 9–26m 跨档、层数/屋面随机；压到大路路廊的整户跳过。
    for (let gxI = 0; gxI < 5; gxI++) for (let gzI = 0; gzI < 5; gzI++) {
      if (gxI === 2 && gzI === 2) continue;
      const hx = cx - 240 + gxI * 120 + (wardHash(gxI, gzI, 401) - 0.5) * 68;
      const hz = cz - 240 + gzI * 120 + (wardHash(gxI, gzI, 409) - 0.5) * 68;
      const w2 = 9 + wardHash(gxI, gzI, 419) * 17;   // 9–26m
      const d2 = 8 + wardHash(gxI, gzI, 421) * 12;   // 8–20m
      if (roadBlocked(hx, hz, Math.hypot(w2, d2) * 0.5 + 2)) continue;
      const yaw = (wardHash(gxI, gzI, 431) - 0.5) * 0.72;  // ±20°
      const hh = 3.2 + wardHash(gxI, gzI, 433) * 3.2;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const at = (lx: number, lz: number): [number, number] => [hx + lx * cy + lz * sy, hz - lx * sy + lz * cy];
      // 院墙（三面，转角随之旋转）
      for (const [lx, lz, ww, dd] of [[0, -d2 / 2 - 1.6, w2 + 5, 0.7], [-w2 / 2 - 2.4, 0, 0.7, d2 + 3.2], [w2 / 2 + 2.4, 0, 0.7, d2 + 3.2]] as const) {
        const [wx, wz] = at(lx, lz);
        b.box('wall', ww, 1.4, dd, wx, 0.7, wz, shade(0x9a9080, 1), yaw);
      }
      // 正房
      const fl = wardHash(gxI, gzI, 439) < 0.35 ? 2 : 1;
      b.box('wall', w2, hh * fl + 0.6, d2, hx, (hh * fl + 0.6) / 2 + 0.3, hz, wardHash(gxI, gzI, 443) < 0.5 ? shade(C.plaster, 0.98) : shade(C.plaster2, 0.98), yaw);
      // 平民两坡悬山：色板按坊分片（8 档），形制按方形半径三档（近/中/远剪影）
      const roofHex = wardRoofHex(Math.round(cx / 480), Math.round(cz / 480));
      const wallHex = wardHash(gxI, gzI, 443) < 0.5 ? shade(C.plaster, 0.98) : shade(C.plaster2, 0.98);
      commonerRoof(b, { x: hx, z: hz, y: 0.3 + hh * fl, w: w2, d: d2, ry: yaw, hex: roofHex, wallC: wallHex });
      capCommonerGables(b, { x: hx, z: hz, y: 0.3 + hh * fl, w: w2, d: d2, ry: yaw, hex: wallHex });
      // 窗光（贴在正房正面，随朝向旋转）
      for (let wn = 0; wn < 3; wn++) {
        const [wx, wz] = at(-w2 / 2 + 2.2 + wn * (w2 - 4.4) / 2, d2 / 2 + 0.05);
        b.box('glow', 0.7, 0.9, 0.08, wx, hh * fl * 0.55, wz, C.winGlow, yaw);
        if (fl === 2) b.box('glow', 0.7, 0.9, 0.08, wx, hh * fl * 0.85, wz, C.winGlow, yaw);
      }
      // 厢房
      const [cx2, cz2] = at(-w2 * 0.22, -d2 * 0.28);
      b.box('wall', w2 * 0.55, hh * 0.8, d2 * 0.5, cx2, hh * 0.4 + 0.3, cz2, shade(C.plaster2, 0.95), yaw);
      // 厢房原来是一块 1.4m 厚的悬空平板（侧视像"压在墙上的水泥板"），改同一套悬山屋顶的低配档
      commonerRoof(b, { x: cx2, z: cz2, y: hh * 0.8 + 0.3, w: w2 * 0.55, d: d2 * 0.5, ry: yaw, hex: shade(roofHex, 0.96), wallC: shade(C.plaster2, 0.95) });
      capCommonerGables(b, { x: cx2, z: cz2, y: hh * 0.8 + 0.3, w: w2 * 0.55, d: d2 * 0.5, ry: yaw, hex: shade(C.plaster2, 0.95) });
      // 门灯
      const [lx2, lz2] = at(w2 * 0.3, d2 / 2 + 1.8);
      b.box('glow', 0.35, 0.45, 0.35, lx2, 2.5, lz2, C.lantern);
    }
  }
  // ---- 城防细部：四角角楼 / 主门瓮城 / 望火楼 / 御街牌坊 ----
  buildJiaolou(b, W, W);
  buildJiaolou(b, -W, W);
  buildJiaolou(b, W, -W);
  buildJiaolou(b, -W, -W);
  buildWengcheng(b, 0, -W - 28, 0);
  buildWatchtower(b, sg, atlas, -1250, 260);
  buildWatchtower(b, sg, atlas, 3450, -850);
  buildPaifang(b, sg, atlas, 0, 240, 0, '御街', 'yujie1', C.neonGold);
  buildPaifang(b, sg, atlas, 0, -2350, 0, '宣德門前', 'yujie2', C.neonCyan);
  // ---- 宫城（中轴，内收）----
  buildPalace(b, sg, atlas);
  // ---- 东西两市 ----
  for (const [mx, nm, nc] of [[2800, '東市', C.neonCyan], [-2800, '西市', C.neonMag]] as const) {
    const mz2 = 900;
    // 1km 见方的空地是「孤零零一片」的根源：市只做 300×300，外面由里坊包住。
    b.box('ground', 300, 0.24, 300, mx, 0.12, mz2, shade(0x8a8068, 1.02));
    for (const [ox, oz, w2, d2] of [[0, -150, 300, 1.2], [0, 150, 300, 1.2], [-150, 0, 1.2, 300], [150, 0, 1.2, 300]] as const) {
      b.box('wall', w2, 3.4, d2, mx + ox, 1.7, mz2 + oz, shade(C.wallGray, 1));
    }
    // 市楼十字街
    b.box('ground', 6, 0.16, 290, mx, 0.06, mz2, shade(C.road, 1.1));
    b.box('ground', 290, 0.16, 6, mx, 0.06, mz2, shade(C.road, 1.1));
    // 摊位：旧版整片 1km 见方的市只有 12 个摊位，从空中看就是一块空场。
    // 这里按「沿十字街两厢 + 四角仓棚」铺满：每 34m 一摊，每摊 = 案 + 棚 + 货 + 灯。
    const stall = (sx2: number, sz2: number, ry2: number): void => {
      b.box('wood', 2.6, 0.85, 1.2, sx2, 0.42, sz2, shade(C.wood, 1), ry2);
      b.box('wood', 2.9, 0.1, 1.5, sx2, 0.9, sz2, shade(C.wood, 1.1), ry2);
      b.box('roof', 3.4, 0.12, 2.1, sx2, 2.5, sz2, rng.pick(CANOPYC), ry2, 0.18);
      for (const p2 of [-1, 1]) {
        b.box('wood', 0.12, 2.2, 0.12, sx2 + Math.cos(ry2 + Math.PI / 2) * p2 * 1.5, 1.35,
          sz2 + Math.sin(ry2 + Math.PI / 2) * p2 * 1.5, C.woodDark, ry2);
      }
      for (let g2 = 0; g2 < 3; g2++) {
        b.box('ceramic', 0.34, 0.3, 0.34, sx2 - 0.8 + g2 * 0.8, 1.1, sz2 + 0.1, [0x8a5a3a, 0x6a7a5a, 0x7a6a8a][g2], ry2);
      }
      b.box('glow', 0.22, 0.26, 0.22, sx2, 2.9, sz2, C.lantern);
    };
    for (let i = 0; i < 7; i++) {
      const off = -120 + i * 40;
      for (const s of [-1, 1]) { stall(mx + s * 22, mz2 + off, 0); stall(mx + s * 52, mz2 + off, 0); }
      for (const s of [-1, 1]) { stall(mx + off, mz2 + s * 22, Math.PI / 2); stall(mx + off, mz2 + s * 52, Math.PI / 2); }
    }
    // 四角仓棚（草顶大跨，市背后的囤货）
    for (const sx2 of [-1, 1]) for (const sz2 of [-1, 1]) {
      const cx2 = mx + sx2 * 118, cz2 = mz2 + sz2 * 118;
      b.box('wall', 26, 3.6, 16, cx2, 1.8, cz2, shade(0xb5a582, 0.98));
      b.box('roof', 30, 1.8, 20, cx2, 4.2, cz2, shade(C.tile2, 1.02));
      for (let d2 = 0; d2 < 5; d2++) {
        b.box('wood', 2.4, 1.4, 2.4, cx2 - 14 + d2 * 7, 0.7, cz2 + 16, shade(0x6a5238, 0.95 + d2 * 0.04));
      }
    }
    // 市楼
    b.box('wood', 12, 8, 9, mx, 4, mz2, shade(C.woodRed, 1));
    roofOnCapped(b, 16, 12, 8.4, mx, mz2, 0, shade(C.tile, 1.08), nc);
    sg.quad(atlas.text('market' + nm, nm, 300, 84, { color: '#ffe9c8', glow: '#' + nc.toString(16).padStart(6, '0'), bg: 'rgba(12,10,18,0.9)', border: 'rgba(255,179,0,.8)', fontPx: 60 }), 6.4, 1.8, mx, 9.8, mz2 + 4.6, 0);
  }
}
// ============ W-N 宫城：迁入城区 + 故宫式格局 + 室内陈设 + 宫前/宫后商业街 ============
/**
 * 用户判词：
 *  「皇宫建筑极其简陋！要像故宫一样的宏大精美壮观，建筑要多要精致高细节，内部装饰家具物品等也要向故宫看齐。
 *    另外，皇宫要在城市的市区内部！而不是外部！」
 *  「皇宫前后的大路，要有和河边商业区一样的热闹的建筑群和人群！」
 *
 * 几何账（旧 → 新，全部可机检）：
 *  · 宫城 z ∈ [−4450, −2950]（纵深 1500m）→ z ∈ [−4000, −2950]（纵深 1050m）。
 *    午门门线不动（御街 / 宣德門前牌坊 / 拒马 / 御沟石桥共用同一 z 基准），只把北墙从 −4450 收到 −4000：
 *    北墙到北城墙 550m → 1000m，宫北 2200×800m 复归城区；四向 300m 内都有里坊（见 wardCells 证明）。
 *  · 三大殿 大慶/垂拱/紫宸 → −3260 / −3480 / −3690，面阔 200/140/180、台基一律三重须弥座 + 汉白玉栏板、
 *    檐口 26 / 24 / 25m（≥22m），重檐庑殿 + 鸱吻 + 正脊鎏金。
 *  · 新增：午门五凤楼 + 雁翅楼 + 双阙、太和门（铜狮/门戟/值房）、东西六宫 12 院、宫城角楼 4 座、
 *    庑房连廊、御花园 2 处、神武门；室内陈设宝座/屏风/香炉/宫灯/地毯/案几/仪仗（≥200 kit 件）。
 */
const PAL_X = 1100;          // 宫墙中线 |x|
const PAL_HX = PAL_X - 1.3;  // 宫墙内皮 1098.7
const PAL_S = -2948.7;       // 南墙内皮（午门中线 −2950）
const PAL_N = -4001.3;       // 北墙内皮（北墙中线 −4000）
const PAL_CZ = -3475;        // 宫城几何中心
const PAL_WALL_H = 9.6;      // 宫墙压顶面高（旧版 8.5）
const PAV_Y = 0.10;          // 殿庭地坪顶面
const PAL_STONE = 0x9a9384;
const PAL_MARBLE = 0xd2c9b6;
const PAL_RED = 0x9d3327;    // 宫墙朱
const PAL_TILE = 0x35594c;   // 庑房/廊子的青瓦（低一档，衬主殿）
const PAL_GOLD = 0x9a7428;   // 琉璃金瓦：三大殿/午门/六宫（故宫黄瓦的夜景等价物）
const PAL_GOLD_D = 0x7d5d1e; // 金瓦暗档（背光面/配殿）

/** 地坪板：底面砌到 −0.6（城内下沉地表达 −0.5），板边不会露出半米悬空 */
function palSlab(b: Baker, g: BGroup, w: number, d: number, x: number, z: number, top: number, hex: number): void {
  const h = top + 0.6;
  b.box(g, w, h, d, x, top - h / 2, z, hex);
}

/**
 * 一、宫城地坪：中轴御道 + 五进殿庭 + 横街 + 沿墙散水 + 御道石灯。
 * 不做规则网格（俯视网格线伪影已删过一轮）：五段带界各差 8–18m、横街宽 6–8m 且有一条半幅，
 * 长向接缝因此错落；分隔只用 0.56m 窄石边，不铺整条亮线。
 *
 * R24：材质从 ground（暖赭夯土贴图）改成 ash（中性石贴图），色板换成青灰。
 * 这一步是「宫城里一片裸土褐色」的直接解法——同样的几何，换掉贴图与色相即可；
 * 真正的方砖缝与 26m 大砖块由 palaceGrounds.paveField 铺在上面（顶 0.14）。
 */
function buildPalaceGround(b: Baker): void {
  const SEG: [number, number][] = [[PAL_S, -3150], [-3150, -3370], [-3370, -3590], [-3590, -3800], [-3800, PAL_N]];
  const TONE = [0x6a6558, 0x6d685b, 0x676254, 0x6c6759, 0x686356];
  const EDGE: [number, number][] = [[356, 764], [366, 748], [348, 772], [360, 752], [354, 768]];
  SEG.forEach(([z0, z1], i) => {
    const cz = (z0 + z1) / 2, dz = Math.abs(z1 - z0);
    const [e1, e2] = EDGE[i];
    for (const s of [-1, 1]) {
      palSlab(b, 'ash', e1 - 13, dz, (s * (13 + e1)) / 2, cz, PAV_Y, shade(TONE[i], s > 0 ? 1 : 0.975));
      palSlab(b, 'ash', e2 - e1, dz, (s * (e1 + e2)) / 2, cz, PAV_Y - 0.01, shade(TONE[(i + 2) % 5], s > 0 ? 0.995 : 1.01));
      palSlab(b, 'ash', PAL_HX - 4 - e2, dz, (s * (e2 + PAL_HX - 4)) / 2, cz, PAV_Y - 0.02, shade(TONE[(i + 4) % 5], 1.01));
    }
  });
  // 中轴御道：12m 亮带，顶 0.16 压在既有御街顶 0.14 之上 2cm
  palSlab(b, 'ground', 12, PAL_S - PAL_N, 0, PAL_CZ, 0.16, shade(C.road, 1.18));
  // 横街：五条，宽度各不相同（4 条整幅 + 1 条半幅）
  const ST: [number, number, number, number][] = [
    [-3065, 3.4, -1080, 1080], [-3355, 3.2, -620, 620], [-3585, 3.0, -620, 620],
    [-3762, 4.0, -1080, 1080], [-3975, 3.0, -1080, 1080],
  ];
  for (const [z, hw, x0, x1] of ST) {
    palSlab(b, 'ground', x1 - x0, hw * 2, (x0 + x1) / 2, z, 0.13, shade(C.road, 1.04));
    for (const sz of [-1, 1]) {
      for (const [a, c] of [[x0, -14], [14, x1]] as const) {
        if (c - a < 4) continue;
        palSlab(b, 'ash', c - a, 0.56, (a + c) / 2, z + sz * (hw + 0.3), 0.155, PAL_STONE);
      }
    }
  }
  // 沿墙散水：贴墙 4m
  palSlab(b, 'ash', PAL_HX * 2, 4, 0, PAL_S - 2, 0.11, PAL_STONE);
  palSlab(b, 'ash', PAL_HX * 2, 4, 0, PAL_N + 2, 0.11, PAL_STONE);
  palSlab(b, 'ash', 4, PAL_S - PAL_N, -PAL_HX + 2, PAL_CZ, 0.11, PAL_STONE);
  palSlab(b, 'ash', 4, PAL_S - PAL_N, PAL_HX - 2, PAL_CZ, 0.11, PAL_STONE);
  // 御道石灯：70m 一对
  for (let z = PAL_S - 62; z > PAL_N + 24; z -= 70) {
    // 三殿台基半宽 78–116m，石灯若压在台基 z 段内就会从台面上戳出来
    if ([PALACE.taiheZ, PALACE.zhongheZ, PALACE.baoheZ].some((hz) => Math.abs(z - hz) < 82)) continue;
    for (const s of [-1, 1]) {
      b.box('ash', 0.74, 0.36, 0.74, s * 9.6, 0.32, z, PAL_STONE);
      b.box('ash', 0.26, 4.0, 0.26, s * 9.6, 2.5, z, PAL_MARBLE);
      b.box('glow', 0.46, 0.52, 0.46, s * 9.6, 4.72, z, 0xffb060);
    }
  }
  b.kit('imperial.ground', 1, PAV_Y);
}

/** 二、宫墙：朱红墙身（旧版是夯土灰）+ 石墙基 + 琉璃压顶 + 两面每 8m 壁柱；南墙让开午门、北墙让开神武门 */
function buildPalaceWalls(b: Baker): void {
  const H = PAL_WALL_H;
  const segs: { alongX: boolean; fixed: number; a0: number; a1: number; skip?: number }[] = [
    { alongX: true, fixed: -4000, a0: -PAL_X, a1: PAL_X, skip: 26 },   // 北墙（神武门洞 52m）
    { alongX: true, fixed: -2950, a0: -PAL_X, a1: PAL_X, skip: 118 },  // 南墙（午门城台 236m）
    { alongX: false, fixed: -PAL_X, a0: -4000, a1: -2950 },
    { alongX: false, fixed: PAL_X, a0: -4000, a1: -2950 },
  ];
  for (const s of segs) {
    const parts: [number, number][] = s.skip ? [[s.a0, -s.skip], [s.skip, s.a1]] : [[s.a0, s.a1]];
    for (const [a0, a1] of parts) {
      const L = a1 - a0, mid = (a0 + a1) / 2;
      const W = (w: number, h: number, d: number, off: number, y: number, hex: number): void =>
        b.box('wall', s.alongX ? w : d, h, s.alongX ? d : w, s.alongX ? mid + off : s.fixed, y, s.alongX ? s.fixed : mid + off, hex);
      // 石墙基 + 朱红墙身两道 + 琉璃压顶 + 滴水
      W(L + 1.6, 1.6, 3.4, 0, 0.8, shade(PAL_STONE, 0.9));
      W(L, 4.4, 3.0, 0, 3.8, PAL_RED);
      W(L, 4.0, 2.7, 0, 7.0, shade(PAL_RED, 1.06));
      W(L + 1.2, 0.62, 3.1, 0, H + 0.31, shade(PAL_TILE, 1.02));
      W(L + 1.8, 0.2, 3.6, 0, H - 0.12, shade(PAL_TILE, 0.72));
      // 壁柱：两面各一列，8m 一柱 + 柱头
      for (let p = a0 + 4; p <= a1 - 4; p += 8) {
        for (const sd of [-1, 1]) {
          b.box('wall', s.alongX ? 0.72 : 0.5, 6.6, s.alongX ? 0.5 : 0.72,
            s.alongX ? p : s.fixed + sd * 1.62, 4.6, s.alongX ? s.fixed + sd * 1.62 : p, shade(PAL_RED, 0.9));
          b.box('ash', s.alongX ? 0.96 : 0.7, 0.3, s.alongX ? 0.7 : 0.96,
            s.alongX ? p : s.fixed + sd * 1.62, 7.95, s.alongX ? s.fixed + sd * 1.62 : p, PAL_MARBLE);
        }
      }
    }
  }
  b.kit('imperial.wall', 4, H);
}

/** 汉白玉栏板：望柱 + 栏板 + 寻杖，沿矩形一圈；skip(x,z) 为真处断开（踏道口） */
function marbleRail(b: Baker, x0: number, x1: number, z0: number, z1: number, y: number, skip?: (x: number, z: number) => boolean): void {
  const step = 6;
  const seg = (ax: number, az: number, bx: number, bz: number): void => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) return;
    const n = Math.max(1, Math.round(L / step));
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const alongX = Math.abs(ux) > 0.5;
    for (let i = 0; i <= n; i++) {
      const px = ax + ux * (L * i) / n, pz = az + uz * (L * i) / n;
      if (skip?.(px, pz)) continue;
      b.box('ash', alongX ? 0.44 : 0.44, 1.28, alongX ? 0.44 : 0.44, px, y + 0.64, pz, PAL_MARBLE);
      b.box('ash', alongX ? 0.58 : 0.58, 0.18, 0.58, px, y + 1.34, pz, shade(PAL_MARBLE, 1.04));
      if (i === n) continue;
      const qx = ax + ux * (L * (i + 0.5)) / n, qz = az + uz * (L * (i + 0.5)) / n;
      if (skip?.(qx, qz)) continue;
      const sl = L / n - 0.5;
      b.box('ash', alongX ? sl : 0.2, 0.62, alongX ? 0.2 : sl, qx, y + 0.52, qz, shade(PAL_MARBLE, 0.95));
      b.box('ash', alongX ? sl : 0.3, 0.16, alongX ? 0.3 : sl, qx, y + 0.98, qz, PAL_MARBLE);
    }
  };
  seg(x0, z0, x1, z0);
  seg(x1, z0, x1, z1);
  seg(x1, z1, x0, z1);
  seg(x0, z1, x0, z0);
}

/** 御路踏道：从地坪逐级升到台基顶（级高 0.55），中央一条丹陛石 */
function imperialStair(b: Baker, x: number, zFront: number, w: number, yTop: number, depth: number): void {
  const n = Math.max(3, Math.round(yTop / 0.55));
  const stepD = depth / n;
  for (let i = 0; i < n; i++) {
    const y = yTop - (i + 0.5) * (yTop / n);
    b.box('wall', w - i * 0.35, yTop / n, stepD, x, y, zFront + stepD * (i + 0.5), shade(PAL_MARBLE, 0.98 - i * 0.004));
  }
  // 丹陛石：中央一道浅浮雕斜板（云龙纹用两道错缝金线表示）
  b.box('ash', w * 0.26, 0.2, depth * 0.92, x, yTop * 0.5 + 0.1, zFront + depth * 0.46, 0xcfc6b4, 0, -0.12, 0);
  for (let k = 0; k < 3; k++) {
    b.box('metal', w * 0.2, 0.06, 0.24, x, yTop * 0.5 + 0.24, zFront + depth * (0.2 + k * 0.22), 0xc9a13a);
  }
}

/**
 * 三大殿通用：三重须弥座台基 + 汉白玉栏板 + 前檐开敞的殿身（能看见室内陈设）+ 重檐庑殿。
 * 檐口高 = baseY + 殿身高，直接由 eave 参数给定（探针读 palace.eave.<key>）。
 */
interface PalaceHallSpec {
  x: number; z: number; w: number; d: number;
  eave: number; name: string; key: string;
  roofC: number; upperW: number; upperD: number;
  lowerH: number; upperH: number; upperRise: number;
  stair?: boolean;
}

function palaceHall(b: Baker, sg: SignMesher, atlas: SignAtlas, s: PalaceHallSpec): void {
  const tiers = 3, tierH = 1.55;
  const baseY = tiers * tierH;
  // R23：外观与结构全部改走 palaceDetail 的精细构造库。
  // 旧版是「三块盒子台基 + 四道额枋 + 两片平板重檐」——用户原话「皇宫的建筑怎么他妈的这么粗糙」。
  // 新构造实测：五铺作斗栱 350 攒、瓦垄 1136 垄 + 瓦当/滴水 1712 枚、栏板 251 段、走兽 24 只、
  // 六抹隔扇 72 扇、飞椽 1840 根、须弥座 3 层；单殿 197,888 面。
  // eaveH 是檐口世界标高（与 PALACE.eave.* 同口径），台基从 y 向下叠到 0，口径见 palaceDetail 头注释。
  buildPalaceHall(b, { x: s.x, z: s.z, y: baseY, w: s.w, d: s.d, eaveH: s.eave, tiers });
  // 殿身（檐墙 / 六抹隔扇 / 檐柱 / 斗栱 / 重檐屋面）全部由 palaceDetail 的 buildPalaceHall 负责。
  // 这里只补它不做的室内：金砖地坪 + 天花 + 两排金柱 + 藻井。
  const bh = s.eave - baseY;
  b.box('ground', s.w - 1.2, 0.22, s.d - 1.2, s.x, baseY + 0.11, s.z, shade(0x6e5f48, 1.02));
  b.box('lacquer', s.w - 2.4, 0.42, s.d - 2.4, s.x, s.eave - 1.1, s.z, 0x3a2a18);
  for (const sz of [-1, 1]) for (let i = 0; i < 6; i++) {
    const cx = s.x - s.w / 2 + s.w * (i + 0.5) / 6;
    b.box('wood', 0.9, bh - 1.4, 0.9, cx, baseY + (bh - 1.4) / 2, s.z + sz * s.d * 0.2, shade(0xb8892a, 0.98));
  }
  for (const sz of [-1, 1]) {
    b.cyl('lacquer', 5.2, 5.6, 0.6, 16, s.x, s.eave - 1.7, s.z + sz * s.d * 0.16, 0x2a1c12, 0, Math.PI / 2);
    b.cyl('metal', 5.4, 5.4, 0.16, 16, s.x, s.eave - 1.44, s.z + sz * s.d * 0.16, 0xd8b028, 0, Math.PI / 2);
    b.cyl('metal', 1.6, 1.6, 0.2, 12, s.x, s.eave - 1.42, s.z + sz * s.d * 0.16, 0xc9a13a, 0, Math.PI / 2);
  }
  // 匾额
  sg.quad(atlas.text('pal_' + s.key, s.name, 480, 120, { color: '#ffe9c8', glow: '#d8a83a', bg: 'rgba(20,8,8,0.94)', border: 'rgba(216,168,58,.75)', fontPx: 76 }),
    Math.min(17, s.w * 0.1), 2.5, s.x, baseY + bh * 0.66, s.z + s.d / 2 + 0.4, 0);
  // 机检读点：檐口高 / 台基层数 / 殿身
  b.kit('palace.eave.' + s.key, 1, s.eave);
  b.kit('palace.tiers.' + s.key, tiers, baseY);
  b.kit('palace.hall.' + s.key, 1, baseY);
}

/** 五、三大殿：太和殿（大慶殿）· 中和殿（垂拱殿）· 保和殿（紫宸殿），前庭广场 + 庑房 + 铜鼎日晷 */
function buildThreeHalls(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  palaceHall(b, sg, atlas, {
    x: 0, z: PALACE.taiheZ, w: 200, d: 84, eave: PALACE.eave.taihe, name: '太和殿', key: 'taihe',
    roofC: PAL_GOLD, upperW: 128, upperD: 46, lowerH: 6.5, upperH: 12, upperRise: 7.5,
  });
  palaceHall(b, sg, atlas, {
    x: 0, z: PALACE.zhongheZ, w: 140, d: 70, eave: PALACE.eave.zhonghe, name: '中和殿', key: 'zhonghe',
    roofC: PAL_GOLD, upperW: 88, upperD: 40, lowerH: 4.5, upperH: 8, upperRise: 5.5,
  });
  palaceHall(b, sg, atlas, {
    x: 0, z: PALACE.baoheZ, w: 180, d: 78, eave: PALACE.eave.baohe, name: '保和殿', key: 'baohe',
    roofC: PAL_GOLD, upperW: 112, upperD: 44, lowerH: 6, upperH: 11, upperRise: 7,
  });
  // R23/R24：三殿之间的东西连廊不再在这里手搓短板条。
  // 旧版 SEGS 是 4 段通长 5m 高的「灰带」，与 buildPalaceWings 的内庑（|x|=152）平行重复，
  // 俯瞰合并成一条没有分间的长条——用户判词「皇宫内还是那么空旷」的一半来自它。
  // 现在统一由 palaceGrounds 的庑房链接管：|x|=172、进深 12、30–38m 一段、逐间柱列与门窗。
  // R14：太和殿前广场（金砖 / 庑房 / 陈设 / 松柏）统一由 buildPalaceCourt 落地。
  // 旧版这里是一整块 300×250 的平铺板 + 18 块散石，广场读成「三个殿摆在沙地上」。
  b.kit('imperial.zichenRail', 1, 4.65);
  b.kit('imperial.zichenSteps', 3, 4.65);
}

/**
 * 三大殿院落的庑房：旧版宫院里只有三座孤殿 + 一圈空铺装，俯瞰是一片空场。
 * 故宫的「宏大有秩序」很大程度来自合院：太和殿院 200×190 被东西庑房围合，午门院内是两列朝房。
 * 这里补三段：内庑（贴三殿院，进深 9）、外庑（体仁阁/弘义阁一线，进深 16）、南庑（午门院内朝房）。
 * 全部用箱体坡顶（不走 roofOn 曲面），一段 ≈ 20 个构件，代价小、远景读得出檐口线。
 */
function palaceWing(b: Baker, x: number, zS: number, zN: number, depth: number, h: number, face: number, roofC: number): void {
  const L = Math.abs(zS - zN), cz = (zS + zN) / 2;
  const fx = x + face * (depth / 2 - 0.6);
  // 台明 + 后墙 + 两端山墙
  b.box('ash', depth + 1.6, 0.7, L + 1.4, x, 0.25, cz, 0x8b8371);
  b.box('wall', depth, h, L, x, 0.6 + h / 2, cz, shade(PAL_RED, 0.92));
  for (const e of [-1, 1]) b.box('wall', depth + 1.2, h + 0.6, 1.0, x, 0.6 + (h + 0.6) / 2, cz + e * (L / 2), shade(PAL_RED, 0.86));
  // 前檐柱 + 槛窗
  const n = Math.max(2, Math.round(L / 5));
  for (let i = 0; i <= n; i++) {
    const zz = zS - (zS - zN) * (i / n);
    b.box('wood', 0.7, h, 0.7, fx, 0.6 + h / 2, zz, shade(0xb8892a, 0.98));
    b.box('ash', 1.1, 0.34, 1.1, fx, 0.77, zz, PAL_MARBLE);
  }
  for (let i = 0; i < n; i++) {
    const zz = zS - (zS - zN) * ((i + 0.5) / n);
    b.box('glow', 0.12, h * 0.42, Math.abs(zS - zN) / n * 0.42, fx + face * 0.06, 0.6 + h * 0.52, zz, 0xff9a3c);
    b.box('wood', 0.16, h * 0.5, Math.abs(zS - zN) / n * 0.5, fx + face * 0.02, 0.6 + h * 0.5, zz, shade(PAL_RED, 1.04));
  }
  // 双坡瓦顶（两块斜板 + 正脊）
  const rh = 1.4 + depth * 0.14;
  for (const s2 of [-1, 1]) {
    b.box('roof', depth / 2 + 0.9, 0.24, L + 1.2, x + s2 * (depth / 4 + 0.25), 0.6 + h + rh * 0.5, cz, roofC, 0, 0, -s2 * 0.34);
  }
  b.box('roof', 0.55, 0.3, L + 1.3, x, 0.6 + h + rh, cz, shade(roofC, 1.25));
  // 两端山花：两块斜板在 ±z 端头之间是一条三角空腔，不封就是「能从侧面看进屋架」
  {
    const hw = depth / 2 + 0.9;
    const cy = 0.6 + h + rh * 0.5;
    const dy = Math.sin(0.34) * hw * 0.5;
    const halfSpan = (hw / 2 - 0.2) + (hw / 2) * Math.cos(0.34);
    for (const e of [-1, 1] as const) {
      gableEnd(b, 'wall', x, cy - dy, cz + e * (L / 2 + 0.45), 0, halfSpan, dy * 2, shade(PAL_RED, 0.88));
    }
  }
  b.kit('palace.wing', 1, 0.6 + h);
}

/**
 * 宫城两厢的四组合院：文华殿（东）、武英殿（西）、南三所（东）、内务府（西）。
 * 三大殿只占中轴 200m，宫城 2200m 宽的两厢若只有铺装，俯瞰就是一片空场——
 * 故宫的「多」正是靠这些侧院填出来的。每院 = 院墙 + 正殿 + 后殿 + 东西配殿 + 院门 + 石灯。
 */
function palaceCompound(b: Baker, cx: number, cz: number, w: number, d: number, mainW: number, mainD: number, salt: number): void {
  const wallH = 5.2;
  for (const s of [-1, 1]) {
    b.box('wall', w, wallH, 1.4, cx, wallH / 2, cz + s * d / 2, PAL_RED);
    b.box('roof', w + 1.0, 0.42, 2.0, cx, wallH + 0.21, cz + s * d / 2, PAL_TILE);
    b.box('wall', 1.4, wallH, d, cx + s * w / 2, wallH / 2, cz, PAL_RED);
    b.box('roof', 2.0, 0.42, d + 1.0, cx + s * w / 2, wallH + 0.21, cz, PAL_TILE);
  }
  // 正殿（面阔 mainW × 进深 mainD，单檐歇山，前檐开敞）
  const hz = cz - d * 0.16;
  b.box('wall', mainW + 16, 1.1, mainD + 12, cx, 0.55, hz, shade(PAL_MARBLE, 0.9));
  b.box('ash', mainW + 17, 0.16, mainD + 13, cx, 1.13, hz, PAL_MARBLE);
  b.box('ground', mainW - 2, 0.2, mainD - 2, cx, 1.16, hz, shade(0x6e5f48, 1.02));
  b.box('wall', mainW, 7.2, mainD, cx, 1.18 + 3.6, hz, shade(PAL_RED, 0.96));
  for (let i = 0; i <= 6; i++) b.box('wood', 0.9, 7.2, 0.9, cx - mainW / 2 + i * mainW / 6, 4.78, hz + mainD / 2 - 0.8, 0xb8892a);
  for (let i = 0; i < 5; i++) litBay(b, cx - mainW / 2 + mainW / 6 * (i + 0.5), 2.7, mainW / 6 * 0.5, 3.4, hz + mainD / 2 + 0.02, 0, 0xff9a3c);
  roofOnCapped(b, mainW + 14, mainD + 10, 8.4, cx, hz, 0, PAL_GOLD, undefined, mainD * 0.35 + 1.5);
  b.box('roof', mainW * 0.6, 0.7, 1.0, cx, 8.4 + mainD * 0.35 + 1.5, hz, 0xe8c040);
  // 后殿（矮一档、青瓦）
  const bz = cz + d * 0.28;
  b.box('wall', mainW * 0.7, 1.0, mainD * 0.8, cx, 0.5, bz, shade(PAL_MARBLE, 0.88));
  b.box('wall', mainW * 0.66, 6.0, mainD * 0.74, cx, 4.0, bz, shade(PAL_RED, 0.92));
  roofOnCapped(b, mainW * 0.72, mainD * 0.8, 7.0, cx, bz, 0, PAL_TILE, undefined, mainD * 0.3);
  // 东西配殿（沿院墙）
  for (const s of [-1, 1]) {
    const px = cx + s * (w / 2 - 18);
    b.box('ash', 26, 0.7, 64, px, 0.35, cz - d * 0.05, 0x8b8371);
    b.box('wall', 22, 5.4, 60, px, 3.4, cz - d * 0.05, shade(PAL_RED, 0.9));
    roofOnCapped(b, 26, 64, 6.1, px, cz - d * 0.05, 0, PAL_TILE, undefined, 4.2);
  }
  // 院门 + 石灯：门洞暗腔在前、朱扉压在它外面 0.1m（旧版只有一块 7×4.4 的裸暗板 = 一块黑板）
  b.box('wall', 16, 6.2, 2.2, cx, 3.1, cz + d / 2, shade(PAL_RED, 1.04));
  b.box('lacquer', 7, 4.4, 0.4, cx, 2.2, cz + d / 2 + 0.95, 0x1a1416);
  for (const s of [-1, 1]) {
    b.box('lacquer', 3.3, 4.1, 0.22, cx + s * 1.75, 2.15, cz + d / 2 + 1.2, shade(0x7a1f1a, 1.04));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      b.box('metal', 0.15, 0.15, 0.08, cx + s * (0.7 + c * 1.7), 1.1 + r * 0.95, cz + d / 2 + 1.33, 0xd8b028);
    }
  }
  roofOnCapped(b, 19, 5.2, 6.4, cx, cz + d / 2, 0, PAL_GOLD, undefined, 2.2);
  for (const s of [-1, 1]) {
    b.box('ash', 0.7, 0.3, 0.7, cx + s * 12, 0.15, cz + d / 2 - 4, PAL_MARBLE);
    b.box('ash', 0.24, 3.0, 0.24, cx + s * 12, 1.8, cz + d / 2 - 4, PAL_MARBLE);
    b.box('glow', 0.4, 0.5, 0.4, cx + s * 12, 3.5, cz + d / 2 - 4, C.lantern);
  }
  b.kit('palace.compound', 1, 4);
}

function buildPalaceCompounds(b: Baker): void {
  palaceCompound(b, 620, -3230, 300, 220, 90, 44, 11);   // 文华殿（东）
  palaceCompound(b, -620, -3230, 300, 220, 90, 44, 23);  // 武英殿（西）
  palaceCompound(b, 620, -3620, 270, 200, 70, 36, 37);   // 南三所（东）
  palaceCompound(b, -620, -3620, 270, 200, 70, 36, 51);  // 内务府（西）
}

/** 庑房总布：外庑 4 段 ×2（内庑由 palaceGrounds 的庑房链接管） */
function buildPalaceWings(b: Baker): void {
  // 旧内庑（|x|=152，5 段，最长一段 236m、不分间、无门窗）已删：
  // 它与三殿连廊平行，两条 5–7m 高的长条在俯瞰里熔成一条灰带。
  // 现在 palaceGrounds 在 |x|=172 上重排 30–38m 一段的分节庑房（柱列 / 门洞 / 窗棂 / 檐口 / 宫灯）。
  // 外庑末段收到 −3712：后寝御花园（|x| 294–436、z −3720…−3880）就落在 |x|=332 这条线上，
  // 旧末段一直铺到 −3820，会从花园正中穿过去（俯视是两条长筒瓦穿园）。
  const OUTER: [number, number][] = [[-3092, -3260], [-3290, -3460], [-3490, -3660], [-3690, -3712]];
  for (const sx of [-1, 1]) for (const [zS, zN] of OUTER) palaceWing(b, sx * 332, zS, zN, 16, 9.2, -sx, shade(PAL_TILE, 1.04));
  // 午门院朝房（旧版在 |x|=640、z −2996…−3242）已删：它整段穿过文华殿/武英殿合院，
  // 与合院院墙、配殿互相穿模。午门内两厢改由 palaceGrounds 的院群网格（x 214–466、z −2988…−3300）填满。
}

/**
 * 三、午门：石包城台（236×12.6×36）+ 三门洞 + 城台顶平台垛口 + 五凤楼（重檐庑殿）
 * + 四座崇楼（攒尖）+ 双阙（阙身 12m 上起观楼）+ 雁翅楼（两翼南伸 70m）。
 * 旧版宫门只是「两根 12m 方墩 + 一块 150×10 朱板 + 一张 190m 大瓦盖」，读不出城门。
 */
function buildMeridianGate(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const gz = PALACE.z1;         // −2950
  const TOP = 12.6;
  const PW = 236, PD = 36;
  // ---- R24：城台结构重建（用户截图「午门殿内上下两片灰板 + 中间一条缝」）----
  // 旧版是「一整块 236×11.2×36 实心 earth + 三条横贯全宽的 yy=4.2/8.0/11.4 石带」，
  // 门洞只是贴在南立面的装饰朱扉，背后根本没有隧道。相机进到实心体内部时，夯土立面
  // 因背面剔除消失，只剩石带顶面/底面两片灰板 —— 射线实测上撞 y=7.75、下撞 y=4.45
  // （artifacts/r24-wumen-probe.json）。现在拆成门墩 + 门楣 + 三条真隧道，石带只贴外立面。
  const holes: [number, number, number][] = [[0, 22, 12], [-52, 12, 9.6], [52, 12, 9.6]]; // 中门/侧门：中心x, 净宽, 券顶高
  const spans = holes.map(([hx, hw]) => [hx - hw / 2, hx + hw / 2] as [number, number])
    .sort((a, c) => a[0] - c[0]);
  const piers: [number, number][] = [];
  let cursor = -PW / 2;
  for (const [a, c] of spans) { if (a > cursor) piers.push([cursor, a]); cursor = c; }
  if (cursor < PW / 2) piers.push([cursor, PW / 2]);
  // ① 石基：只在门墩区段铺（门洞区段让出真实地面），夯土芯同区段全高
  for (const [a, c] of piers) {
    const w = c - a;
    b.box('ash', w + 1.0, 1.4, PD + 2.0, (a + c) / 2, 0.7, gz, 0x8b877b);
    b.box('earth', w, TOP - 1.4, PD, (a + c) / 2, 1.4 + (TOP - 1.4) / 2, gz, shade(PAL_RED, 0.82));
  }
  // ② 门楣：每个洞券顶以上到城台顶补实体，保证顶平台连续
  for (const [hx, hw, hh] of holes) {
    const lh = TOP - hh;
    if (lh > 0.2) b.box('earth', hw + 1.2, lh, PD, hx, hh + lh / 2, gz, shade(PAL_RED, 0.86));
  }
  // ③ 三道石皮只贴南北外立面（0.35m 厚），不再横贯城台内部；门洞上方按券顶高度补段
  for (const yy of [4.2, 8.0, 11.4]) {
    for (const sz of [-1, 1]) {
      const zf = gz + sz * (PD / 2 + 0.04);
      for (const [a, c] of piers) b.box('ash', c - a, 0.5, 0.35, (a + c) / 2, yy, zf, 0x948f80);
      for (const [hx, hw, hh] of holes)
        if (yy > hh + 0.1) b.box('ash', hw, 0.5, 0.35, hx, yy, zf, 0x948f80);
    }
  }
  for (const su of [-1, 1]) for (const sv of [-1, 1]) b.box('ash', 1.1, TOP, 1.1, su * (PW / 2 - 0.05), TOP / 2, gz + sv * (PD / 2 - 0.05), 0x8d8a80);
  // ④ 三条真门道：墁地 + 双侧衬墙 + 券顶 + 阶梯券脸 + 向两侧敞开的朱扉门钉
  for (const [hx, hw, hh] of holes) {
    b.box('ground', hw, 0.14, PD + 2.0, hx, 0.07, gz, 0x8a8272);
    for (const s of [-1, 1]) {
      b.box('ash', 0.55, hh, PD, hx + s * (hw / 2 - 0.275), hh / 2, gz, 0x9c9a90);
      for (let k = 1; k < 4; k++)
        b.box('ash', 0.08, 0.07, PD, hx + s * (hw / 2 - 0.57), k * hh / 4, gz, 0x7e7a70);
    }
    b.box('ash', hw, 0.5, PD, hx, hh - 0.25, gz, 0x948f80);
    for (const sz of [-1, 1]) {
      const zf = gz + sz * (PD / 2 + 0.16);
      for (let k = 0; k < 4; k++)
        b.box('ash', hw + 2.4 - k * hw * 0.15, 0.42, 0.5, hx, hh + 0.12 + k * 0.42, zf, 0xa5a196);
      b.box('ash', hw + 3.2, 1.0, 0.8, hx, hh + 0.6, zf + sz * 0.12, 0x9c9a90);
    }
    // 朱扉不再是一整块封死门道的背板：两扇绕门轴向两侧敞开，中央留净宽可通行
    const leafW = hw / 2 - 0.6, leafH = hh - 1.4;
    for (const s of [-1, 1]) {
      const ry = s * 1.30;
      const lx = hx + s * (hw / 2 - 0.45), lz = gz + PD / 2 - 1.6;
      b.box('lacquer', leafW, leafH, 0.3, lx, leafH / 2 + 0.2, lz, 0x7a1f1a, ry);
      for (let r = 0; r < 5; r++) for (let cc = 0; cc < 3; cc++) {
        const ox = (cc - 1) * leafW * 0.27, oz = 0.22;
        b.box('metal', 0.28, 0.28, 0.2,
          lx + ox * Math.cos(ry) - oz * Math.sin(ry),
          1.5 + r * (leafH - 2.0) / 4,
          lz + ox * Math.sin(ry) + oz * Math.cos(ry), 0xd8b028, ry);
      }
    }
    b.kit('palace.gate.wumen.passage', 1, 0);
  }
  // 城台顶：平台 + 垛口（外沿）
  b.box('ash', PW + 1.2, 0.4, PD + 1.2, 0, TOP + 0.2, gz, 0x9a9282);
  b.box('ash', PW, 0.3, PD, 0, TOP + 0.55, gz, 0x8a8478);
  for (let i = -14; i <= 14; i++) b.box('ash', 2.6, 1.3, 0.8, i * 8.2, TOP + 1.2, gz + PD / 2 - 0.6, 0x9a9282);
  // 五凤楼：面阔 130、进深 30、殿身 11m、重檐庑殿；四角崇楼 4 座
  const hallY = TOP + 0.7;
  // R23：旧版是一整块 130×11×30 的**实心 wall**，殿内根本不存在空间，
  // 连 buildPalaceLiving 落的起居家具也埋在城台实心芯里 —— 用户点名「午门这个宫殿内为什么什么都没有」。
  // 改成四壁围合的可进入殿身：外观（屋顶 / 斗拱 / 窗光 / 柱列）全部沿用，内部补礼制陈设与起居资产。
  const WT = 0.9;
  b.box('wall', 130, 11, WT, 0, hallY + 5.5, gz + 15 - WT / 2, shade(PAL_RED, 0.98));   // 南壁（临街）
  b.box('wall', 130, 11, WT, 0, hallY + 5.5, gz - 15 + WT / 2, shade(PAL_RED, 0.94));   // 北壁（面朝宫城）
  for (const sx2 of [-1, 1]) b.box('wall', WT, 11, 30, sx2 * (65 - WT / 2), hallY + 5.5, gz, shade(PAL_RED, 0.96));
  b.box('ash', 128, 0.36, 28, 0, hallY + 0.18, gz, 0x9a8f76);                          // 金砖地面
  b.box('fabric', 34, 0.04, 13, 0, hallY + 0.38, gz - 6, 0x8c2f2a);                     // 御座前红毯
  b.kit('palace.gate.wumen.hall', 1, hallY);
  // ---- R24 殿内木构：金柱列 / 梁架 / 斗八藻井 / 北壁槅扇 ----
  // 旧版四壁围合后只有四面光墙 + 家具，抬头是整片瓦底、没有柱梁，结构读不出「殿」。
  for (let ci = -3; ci <= 3; ci++) {
    const cx = ci * 17;
    for (const cz of [gz - 9, gz + 9]) {
      b.box('wood', 1.1, 9.6, 1.1, cx, hallY + 4.8, cz, 0x8c2f2a);
      b.box('metal', 1.4, 0.32, 1.4, cx, hallY + 0.16, cz, 0xb8892f);   // 柱础
      b.box('metal', 1.5, 0.3, 1.5, cx, hallY + 9.5, cz, 0xb8892f);     // 柱头
    }
  }
  for (const cz of [gz - 9, gz + 9]) b.box('wood', 122, 0.85, 1.2, 0, hallY + 9.75, cz, 0x6d3a26);
  for (let ci = -3; ci <= 3; ci++) b.box('wood', 1.0, 0.65, 19.5, ci * 17, hallY + 10.05, gz, 0x6d3a26);
  for (let ix = -5; ix <= 5; ix++) for (let iz = -2; iz <= 2; iz++) {
    const px = ix * 11, pz = gz + iz * 5.2;
    const mid = Math.abs(ix) <= 1 && Math.abs(iz) <= 1;
    b.box('wood', 10.4, 0.14, 4.8, px, hallY + 10.66, pz, mid ? 0xb8892f : 0x7a4a2c);
    b.box('lacquer', 9.4, 0.05, 3.8, px, hallY + 10.58, pz, mid ? 0x24455c : 0x4a3524);
  }
  // 北壁内面槅扇：御座两侧各三扇，木框 + 直棂 + 绦环板
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const px = s * (16 + k * 6.5);
    b.box('wood', 5.6, 6.2, 0.22, px, hallY + 3.4, gz - 13.9, 0x6d3a26);
    for (let t = -2; t <= 2; t++)
      b.box('wood', 0.16, 4.4, 0.1, px + t * 1.05, hallY + 3.6, gz - 13.75, 0xb8892f);
    b.box('glow', 5.0, 4.2, 0.06, px, hallY + 3.6, gz - 13.72, 0xc9a24a);
  }
  b.kit('palace.gate.wumen.frame', 1, hallY);
  for (let i = 0; i <= 10; i++) {
    b.box('wood', 1.3, 11, 1.3, -60 + i * 12, hallY + 5.5, gz + 15.4, 0xd8b028);
    // 旧版是 8.2×6.4 的无框 glow 贴片（52㎡ 一块），夜里读作"墙上一排黄板"；补框/棂/窗台
    litBay(b, -54 + i * 12, hallY + 3.0, 8.2, 6.4, gz + 15.0);
  }
  for (const sx of [-1, 1]) for (let i = 0; i <= 6; i++) b.box('wood', 1.2, 11, 1.2, sx * 65, hallY + 5.5, gz - 15 + i * 5, 0xd8b028);
  dougongBand(b, 0, hallY + 10.6, gz + 15.2, 128, 0, 0xd8b028);
  roofOnCapped(b, 152, 46, hallY + 11, 0, gz, 0, shade(PAL_GOLD, 1.0), undefined, 12);
  roofOnCapped(b, 96, 26, hallY + 20, 0, gz, 0, shade(PAL_GOLD, 1.08), undefined, 8);
  b.box('roof', 58, 0.9, 1.3, 0, hallY + 31.4, gz, 0xd8b028);
  b.cyl('metal', 0.4, 0.6, 1.3, 8, 0, hallY + 32.6, gz, 0xd8b028);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // 崇楼：16×16 两层攒尖
    const cx = sx * 92, cz = gz + sz * 8;
    b.box('wall', 16, 8, 16, cx, hallY + 4, cz, shade(PAL_RED, 0.94));
    for (const s2 of [-1, 1]) {
      litBay(b, cx, hallY + 2.5, 3.4, 4.2, cz + s2 * 8.0);
      litBay(b, cx + s2 * 8.0, hallY + 2.5, 3.4, 4.2, cz, Math.PI / 2);
    }
    b.box('ash', 17.4, 0.4, 17.4, cx, hallY + 8.2, cz, 0x9c9a90);
    b.cyl('roof', 0.16, 13.2, 7.4, 4, cx, hallY + 12.1, cz, shade(PAL_GOLD, 1.04), Math.PI / 4);
    b.cyl('metal', 0.3, 0.4, 0.9, 8, cx, hallY + 16.3, cz, 0xd8b028);
  }
  // 双阙：城台两侧外挑的阙台 + 观楼（旧版 quePier 位置同步改到 ±150）
  for (const sx of [-1, 1]) {
    const qx = sx * 150;
    b.box('ash', 30, 1.2, 34, qx, 0.6, gz + 6, 0x8d8a80);
    for (let i = 0; i < 8; i++) b.box('wall', 28 - i * 0.16, 1.3, 32 - i * 0.16, qx, 1.2 + i * 1.3, gz + 6, shade(C.wallGray, 0.92 + (i % 3) * 0.05));
    b.box('ash', 28.6, 0.4, 32.6, qx, 11.6, gz + 6, 0x9c9a90);
    for (const s2 of [-1, 1]) for (const t2 of [-1, 1]) b.cyl('wood', 0.2, 0.24, 3.2, 8, qx + s2 * 6.4, 13.4, gz + 6 + t2 * 7.2, shade(PAL_RED, 1.02));
    b.box('wood', 15, 0.5, 17, qx, 15.2, gz + 6, shade(C.woodDark, 1.05));
    roofOnCapped(b, 20, 22, 15.45, qx, gz + 6, 0, shade(PAL_GOLD_D, 1.0), undefined, 4.2);
    b.cyl('metal', 0.2, 0.3, 0.6, 8, qx, 20.2, gz + 6, 0xd8b028);
    // 雁翅楼：自阙台向南折出 64m
    b.box('wall', 16, 9.5, 64, qx, 4.75, gz + 54, shade(PAL_RED, 0.92));
    // 旧版 5 块窗光 x 恒为 qx（16m 厚墙的中心），整块埋在墙体里、一块都看不见；
    // 移到院内立面（qx − sx·8）并补框棂，朝院一侧才有窗
    for (let i = 0; i < 5; i++) litBay(b, qx - sx * 8.0, 3.0, 3.2, 4.4, gz + 26 + i * 12, Math.PI / 2);
    roofOnCapped(b, 20, 68, 9.6, qx, gz + 54, 0, shade(PAL_TILE, 1.04), undefined, 5.2);
    b.kit('gate.quePier', 1, 5.6);
    b.kit('gate.queTower', 1, 12.4);
  }
  sg.quad(atlas.text('pal_wumen', '午門', 480, 120, { color: '#ffe9c8', glow: '#ffd25e', bg: 'rgba(20,8,8,0.92)', border: 'rgba(255,210,94,.9)', fontPx: 78 }),
    14, 3.4, 0, 13.4, gz + PD / 2 + 0.5, 0);

  // ---- R23：五凤楼殿内陈设（礼制 + 起居 + 仪仗），全部落在四壁围合的空间内 ----
  const fy = hallY + 0.4;              // 殿内地面完成面 y≈13.7
  const seatZ = gz - 8;
  let wmFurn = 0;
  // ① 御座区：须弥台 + 宝座 + 三扇屏风 + 脚踏 + 御案
  b.box('ash', 9.2, 0.66, 5.6, 0, fy + 0.33, seatZ, 0x9a8f76);
  b.box('wood', 4.2, 1.1, 2.8, 0, fy + 1.2, seatZ, 0x8c2f2a);
  b.box('lacquer', 4.0, 2.6, 0.5, 0, fy + 2.9, seatZ - 1.2, 0x74231f);
  for (let i = -1; i <= 1; i++)
    b.box('fabric', 3.4, 4.2, 0.16, i * 3.7, fy + 3.0, seatZ - 3.2, i === 0 ? 0xb8892f : 0x8e6a26);
  b.box('wood', 2.2, 0.22, 1.1, 0, fy + 0.12, seatZ + 2.4, 0x3a2a20);
  b.box('wood', 5.0, 0.18, 1.4, 0, fy + 1.1, seatZ + 3.0, 0x4a3324);
  for (const sx3 of [-1, 1]) b.box('wood', 0.22, 1.05, 1.2, sx3 * 2.3, fy + 0.55, seatZ + 3.0, 0x4a3324);
  wmFurn += 9;
  // ② 铜鼎 / 香炉 / 铜鹤：御座两列
  for (const sx3 of [-1, 1]) for (let i = 0; i < 3; i++) {
    const px = sx3 * (8 + i * 6), pz = gz - 2 + i * 1.5;
    b.cyl('metal', 0.38, 0.46, 0.9, 8, px, fy + 0.45, pz, 0xb08b3c);
    b.sphere('metal', 0.3, 7, px, fy + 1.02, pz, 0xc9a24a);
    b.cyl('metal', 0.1, 0.13, 0.6, 6, px + sx3 * 1.6, fy + 0.3, pz, 0xa8843a);
    wmFurn += 3;
  }
  // ③ 仪仗兵器架 + 戟（东西两壁）
  for (const sx3 of [-1, 1]) {
    const bx = sx3 * 46, bz = gz + 4;
    b.box('wood', 9.0, 0.16, 0.5, bx, fy + 1.6, bz, 0x4a3324);
    for (const t of [-1, 1]) b.box('wood', 0.2, 1.8, 0.2, bx + t * 4.3, fy + 0.9, bz, 0x4a3324);
    for (let k = 0; k < 7; k++) {
      const px = bx - 3.6 + k * 1.2;
      b.cyl('wood', 0.035, 0.05, 3.4, 5, px, fy + 1.7, bz, 0x5a4128);
      b.cyl('metal', 0.02, 0.16, 0.55, 5, px, fy + 3.65, bz, 0xd8c48a);
    }
    wmFurn += 16;
  }
  // ④ 宫灯立柱 6 盏
  for (const sx3 of [-1, 1]) for (let i = 0; i < 3; i++) {
    const px = sx3 * (20 + i * 16), pz = gz + 9;
    b.cyl('wood', 0.09, 0.13, 2.8, 6, px, fy + 1.4, pz, 0x4a3324);
    b.box('fabric', 0.8, 0.9, 0.8, px, fy + 2.95, pz, 0x9d2933);
    b.sphere('glow', 0.34, 8, px, fy + 2.95, pz, C.neonGold, 0, 0, 0, 1, 1.2, 1);
    wmFurn += 3;
  }
  // ⑤ 案几 / 卷轴 / 烛台（两翼起居与功能用品）
  for (const sx3 of [-1, 1]) {
    const px = sx3 * 28, pz = gz + 5;
    b.box('wood', 3.4, 0.14, 1.5, px, fy + 0.85, pz, 0x5a3d28);
    for (const t of [-1, 1]) for (const u of [-1, 1])
      b.box('wood', 0.14, 0.8, 0.14, px + t * 1.5, fy + 0.42, pz + u * 0.6, 0x4a3324);
    b.cyl('ceramic', 0.22, 0.26, 0.4, 8, px - 0.9, fy + 1.1, pz, 0xe0d8b8);
    for (let k = 0; k < 3; k++)
      b.cyl('ceramic', 0.09, 0.09, 0.7, 6, px + 0.4 + k * 0.3, fy + 1.05, pz, 0xd8c48a);
    wmFurn += 9;
  }
  // ⑥ 挂轴 4 幅（贴北壁）
  for (let i = 0; i < 4; i++) {
    const px = -40 + i * 26;
    b.box('fabric', 3.0, 4.4, 0.06, px, fy + 5.0, gz - 13.9, i % 2 ? 0xd8cdae : 0xc9b998);
    b.box('wood', 3.2, 0.12, 0.1, px, fy + 7.25, gz - 13.9, 0x4a3324);
  }
  wmFurn += 8;
  // ⑦ 起居资产：左右两翼各一组高档陈设（床榻 / 箱笼 / 妆奁 / 盆架 / 灯檠 / 挂轴…）
  for (const [sx3, variant] of [[-1, 501], [1, 502]] as const) {
    buildRoomLiving(b, {
      cx: sx3 * 36, cz: gz + 1, w: 40, d: 20, y0: fy, h: 8.2,
      ux: 1, uz: 0, vx: 0, vz: 1, variant, tier: 'high',
    });
  }
  b.kit('palace.gate.wumen.interior', 1, hallY);
  b.kit('palace.gate.wumen.furnish', wmFurn, hallY);
  b.kit('palace.gate.wumen.living', 2, hallY);
  b.kit('palace.gate.wumen', 1, TOP);
}

/**
 * 朱墙槛窗：木框 + 直棂 + 石窗台，窗光退在框内、只比墙面凸出 0.02m。
 * 旧写法是把一块 glow 直接贴在墙体外 0.1m、四周无框无棂，夜里读作「悬在红墙上的黄方块」。
 */
function litBay(b: Baker, x: number, y0: number, w: number, h: number, zf: number, ry = 0, glow = C.winGlow as number): void {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, zf - lx * s + lz * c];
  const FW = 0.14;
  const [gx, gz] = at(0, 0);
  b.box('glow', w - FW * 2, h - FW * 2, 0.04, gx, y0 + h / 2, gz, shade(glow, 0.62), ry);
  const frame: [number, number, number, number][] = [
    [FW, h, -(w - FW) / 2, 0], [FW, h, (w - FW) / 2, 0],
    [w, FW, 0, (h - FW) / 2], [w, FW, 0, -(h - FW) / 2],
  ];
  for (const [fw, fh, lx, ly] of frame) {
    const [fx, fz] = at(lx, 0.04);
    b.box('wood', fw, fh, 0.12, fx, y0 + h / 2 + ly, fz, shade(C.woodDark, 1.02), ry);
  }
  for (let k = 1; k < 5; k++) {
    const [mx, mz] = at(-w / 2 + (w * k) / 5, 0.03);
    b.box('wood', 0.06, h - FW * 2, 0.08, mx, y0 + h / 2, mz, shade(C.woodDark, 0.9), ry);
  }
  const [hx2, hz2] = at(0, 0.03);
  b.box('wood', w - FW * 2, 0.06, 0.08, hx2, y0 + h * 0.62, hz2, shade(C.woodDark, 0.9), ry);
  const [sx2, sz2] = at(0, 0.02);
  b.box('ash', w + 0.3, 0.14, 0.36, sx2, y0 - 0.07, sz2, PAL_STONE, ry);
  b.kit('palace.gate.window', 1, y0 + h / 2);
  b.kit('palace.gate.windowSlat', 6, y0 + h / 2);
}

/** 隔扇：边梃 + 抹头 + 裙板 + 棂心（窗光 + 直棂），贴在朱墙面 zf 上 */
function gateLatticeDoor(b: Baker, cx: number, y0: number, w: number, h: number, zf: number): void {
  for (const s of [-1, 1]) b.box('wood', 0.1, h, 0.18, cx + s * (w / 2 - 0.05), y0 + h / 2, zf + 0.04, shade(C.woodDark, 0.92));
  for (const t of [0.06, 0.34, 0.62]) b.box('wood', w - 0.06, 0.08, 0.2, cx, y0 + h * t, zf + 0.04, shade(C.woodDark, 0.86));
  b.box('wood', w - 0.16, h * 0.2, 0.1, cx, y0 + h * 0.2, zf + 0.06, shade(0x7a1f1a, 0.92));
  const ly0 = y0 + h * 0.66, lh = h * 0.28;
  b.box('glow', w - 0.2, lh, 0.04, cx, ly0 + lh / 2, zf + 0.03, shade(C.winGlow, 0.5));
  for (let k = 1; k < 4; k++) {
    b.box('wood', 0.05, lh, 0.09, cx - w / 2 + 0.1 + (w - 0.2) * k / 4, ly0 + lh / 2, zf + 0.07, shade(C.woodDark, 0.95));
  }
  b.box('wood', w - 0.2, 0.05, 0.09, cx, ly0 + lh * 0.5, zf + 0.07, shade(C.woodDark, 0.95));
  b.kit('palace.gate.door', 1, y0 + h / 2);
  b.kit('palace.gate.doorLattice', 4, y0 + h / 2);
}

/**
 * 敞开的朱扉：铰位 x=±hx，门面向殿内转 theta。
 * 局部 +x 轴（铰→门边）映到 (-s·cosθ, 0, -sinθ)，所以门扇是往门洞里收，正立面读到斜立的两扇红门。
 * 门钉面朝观众：s=+1 时可见面是局部 -z，s=-1 时是 +z，故钉位取 lz = −s·0.17。
 */
function openGateLeaf(b: Baker, s: number, hx: number, y0: number, lw: number, lh: number, theta: number, zf: number): void {
  const ry = s > 0 ? Math.PI - theta : theta;
  const co = Math.cos(ry), si = Math.sin(ry);
  const cx = s * hx - s * Math.cos(theta) * lw / 2;
  const cz = zf - Math.sin(theta) * lw / 2;
  const at = (lx: number, lz: number): [number, number] => [cx + lx * co + lz * si, cz - lx * si + lz * co];
  b.box('lacquer', lw, lh, 0.28, cx, y0 + lh / 2, cz, shade(0x8a2118, 1.0), ry);
  for (let r = 0; r < 5; r++) {
    for (let col = 0; col < 3; col++) {
      const [wx, wz] = at((col - 1) * lw * 0.3, -s * 0.17);
      b.box('metal', 0.17, 0.17, 0.1, wx, y0 + 1.0 + r * 0.68, wz, 0xd8b028, ry);
    }
  }
  const [px, pz] = at(lw * 0.5 - 0.34, -s * 0.18);
  b.box('metal', 0.22, 0.3, 0.12, px, y0 + lh * 0.5, pz, 0xd8b028, ry);
  b.kit('palace.gate.leaf', 1, y0 + lh / 2);
  b.kit('palace.gate.stud', 15, y0 + lh / 2);
}

/** 四、太和门：两重台基 + 三间门殿（重檐歇山）+ 铜狮一对 + 门戟 + 东西值房；北面通三大殿 */
function buildTaiheGate(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const z = -3080;
  // 台基两层
  b.box('wall', 96, 1.3, 46, 0, 0.65, z, shade(PAL_MARBLE, 0.9));
  b.box('ash', 97, 0.18, 47, 0, 1.39, z, PAL_MARBLE);
  b.box('wall', 86, 1.3, 40, 0, 1.95, z, shade(PAL_MARBLE, 0.96));
  b.box('ash', 87, 0.18, 41, 0, 2.69, z, PAL_MARBLE);
  marbleRail(b, -43, 43, z + 20, z - 20, 2.78, (px, pz) => Math.abs(px) < 14 && pz > z + 18);
  imperialStair(b, 0, z + 20, 24, 2.78, 9);
  // 门殿：三间。次间 = 槛墙 + 三樘隔扇；明间 = 10m 净宽门洞 + 两扇敞开的朱扉
  // 旧版这里是一块 22×8.4×0.6 的暗板（0x1a1416）贴在 z+7.4、比两侧朱扉（z+7.2）还靠外 0.2m，
  // 从广场看就是「台基到匾额一块黑板」；门扇、门洞、抱框全被它盖住。
  for (const sx of [-1, 1]) {
    b.box('wall', 24, 9.6, 16, sx * 26, 2.78 + 4.8, z, shade(PAL_RED, 0.98));
    // 三樘槛窗：旧版 `for (i<3)` 的 x 恒为 sx*26，三块 4.2×4.6 窗光完全重叠、且比墙面凸出 0.1m，
    // 远看就是匾额左右各一块无框黄板。这里按 7.2m 间距分樘，并补框、直棂、石窗台。
    for (let i = 0; i < 3; i++) litBay(b, sx * (26 + (i - 1) * 7.2), 4.9, 4.2, 4.6, z + 8.0);
    // 北面（朝太和殿一侧）同样三樘：旧版门殿背脸是 76m 宽的一片素墙，从三大殿回看就是一段暗墙
    for (let i = 0; i < 3; i++) litBay(b, sx * (26 + (i - 1) * 7.2), 4.9, 4.2, 4.6, z - 8.0, Math.PI);
    // 檐柱：旧版 z+7.4、深 1.0，整根埋进 16m 厚的墙体（墙面 z+8）里，一根都看不见；外移到墙面外 0.4m
    for (let i = 0; i <= 3; i++) b.box('wood', 1.0, 9.6, 0.9, sx * 26 - 12 + i * 8, 7.3, z + 7.95, 0xd8b028);
  }
  // —— 明间：28m 开口分五段（抱框 1.2 + 次间隔扇 7.2 + 明间净空 10），读作门而不是黑板 ——
  const OPEN = 5.0;      // 明间半净宽
  const SILL = 4.0;      // 隔扇下槛
  const HEAD = 8.2;      // 隔扇上槛 = 门洞顶（其上走马板，匾额正好落在走马板上）
  for (const sx of [-1, 1]) {
    b.box('lacquer', 1.2, 11.2 - 2.78, 0.7, sx * 5.6, (2.78 + 11.2) / 2, z + 7.9, shade(0x7a1f1a, 1.02)); // 抱框
    b.box('wall', 7.2, SILL - 2.78, 0.4, sx * 9.8, (2.78 + SILL) / 2, z + 7.9, shade(PAL_RED, 0.92));     // 槛墙
    for (let i = 0; i < 3; i++) gateLatticeDoor(b, sx * (7.4 + i * 2.4), SILL, 2.34, HEAD - SILL, z + 7.9); // 三樘隔扇
    b.box('wall', 0.7, 9.6, 1.2, sx * 13.75, 2.78 + 4.8, z + 7.7, shade(PAL_RED, 0.9));                   // 边柱收口
  }
  // 门洞：石门槛 + 内衬（把 16m 进深读成隧道，而不是一块贴在门脸上的板）
  // 内衬用暗朱（0x3a2622）：旧版 0x2a1a16 从斜角看是一整片死黑，像墙上挖了个洞
  b.box('ash', OPEN * 2, 0.26, 1.6, 0, 2.91, z + 7.9, PAL_MARBLE);
  for (const s of [-1, 1]) {
    b.box('lacquer', 0.4, HEAD - 2.78, 15.4, s * (OPEN - 0.2), (2.78 + HEAD) / 2, z - 0.2, shade(0x3a2622, 1.0));
    for (let k = 0; k < 3; k++) {
      b.box('lacquer', 0.5, HEAD - 2.78, 0.6, s * (OPEN - 0.25), (2.78 + HEAD) / 2, z + 4.6 - k * 4.8, shade(0x5a3126, 1.0));
    }
    b.box('ash', 0.5, 0.9, 15.4, s * (OPEN - 0.2), 3.2, z - 0.2, shade(PAL_MARBLE, 0.78));
  }
  b.box('lacquer', OPEN * 2, 0.4, 15.4, 0, HEAD - 0.2, z - 0.2, shade(0x3a2622, 1.0));
  // 走马板（门洞顶 → 额枋）：匾额挂在这一层上，不再吊在门洞里
  b.box('lacquer', 28, 11.2 - HEAD, 0.5, 0, (HEAD + 11.2) / 2, z + 7.8, shade(0x6d1c16, 1.0));
  b.box('wood', 28, 1.0, 0.8, 0, 11.55, z + 7.85, shade(C.woodDark, 1.1));
  // 两扇朱扉：铰在抱框内侧，向殿内开 56°，正面读到的是两扇斜立的红门（门钉 + 铺首）
  openGateLeaf(b, -1, OPEN, 2.9, 4.6, 5.0, 0.98, z + 7.9);
  openGateLeaf(b, 1, OPEN, 2.9, 4.6, 5.0, 0.98, z + 7.9);
  dougongBand(b, 0, 12.2, z + 7.6, 74, 0, 0xd8b028);
  dougongBand(b, 0, 12.2, z - 7.6, 74, Math.PI, 0xd8b028);   // 北檐同制：旧版只有南面一道，回看时檐口直接压在素墙上
  roofOnCapped(b, 92, 26, 12.4, 0, z, 0, shade(PAL_GOLD, 1.0), undefined, 8);
  roofOnCapped(b, 58, 18, 18.6, 0, z, 0, shade(PAL_GOLD, 1.08), undefined, 5.6);
  b.box('roof', 34, 0.8, 1.2, 0, 24.0, z, 0xd8b028);
  b.cyl('metal', 0.28, 0.4, 0.9, 8, 0, 24.8, z, 0xd8b028);
  // 铜狮一对 + 门戟架两对
  for (const sx of [-1, 1]) {
    b.box('ash', 3.0, 1.6, 3.0, sx * 52, 0.8, z + 22, 0x8d8a80);
    b.box('ash', 2.2, 1.5, 1.4, sx * 52, 2.35, z + 22, 0x6f6b60);
    b.box('ash', 1.5, 1.3, 1.3, sx * 52, 3.4, z + 23.2, 0x77746a);
    b.box('ash', 1.0, 1.0, 1.0, sx * 52, 3.9, z + 24.0, 0x6f6b60);
    b.box('glow', 0.24, 0.18, 0.14, sx * 52 - 0.3, 3.6, z + 23.9, 0xffb300);
    b.kit('palace.lion', 1, 3.4);
  }
  for (const sx of [-1, 1]) {
    const hx = sx * 30, hz = z + 24;
    b.box('ash', 3.4, 0.34, 1.2, hx, 0.17, hz, PAL_STONE);
    for (const t of [-1.4, 1.4]) b.box('wood', 0.18, 3.6, 0.18, hx + t, 2.0, hz, shade(C.woodDark, 1.1));
    b.box('wood', 3.1, 0.18, 0.2, hx, 3.66, hz, shade(C.woodDark, 1.1));
    for (let k = 0; k < 6; k++) {
      const hx2 = hx - 1.2 + k * 0.48;
      b.box('metal', 0.09, 2.9, 0.09, hx2, 2.3, hz, 0x6a6a62);
      b.box('metal', 0.14, 0.66, 0.32, hx2, 3.9, hz, 0x8a8a80);
    }
    b.kit('palace.ceremonial', 6, 3.6);
  }
  // 值房：门内东西各一
  for (const s of [-1, 1]) {
    const gx = s * 172, gz2 = -2998;
    b.box('ash', 16, 0.42, 12, gx, 0.21, gz2, 0x938c7c);
    b.box('wall', 13, 3.6, 8.6, gx, 2.22, gz2, shade(PAL_RED, 0.9));
    for (const t of [-3.2, 3.2]) b.box('wood', 0.24, 3.6, 0.24, gx + t, 2.22, gz2 + 4.3, shade(C.woodRed, 0.9));
    // 值房门：旧版一块 1.8×2.3 的裸 glow 直接贴在门洞上（夜里是一块悬空黄板）；补框棂
    litBay(b, gx, 0.42, 1.8, 2.3, gz2 + 4.3);
    roofOnCapped(b, 18.5, 12.5, 4.42, gx, gz2, 0, shade(PAL_TILE, 1.02), C.neonGold);
    for (const t of [-5.6, 5.6]) b.box('glow', 0.4, 0.5, 0.4, gx + t, 4.1, gz2 + 5.4, C.lantern);
  }
  sg.quad(atlas.text('pal_taihemen', '太和門', 420, 110, { color: '#ffe9c8', glow: '#ffd25e', bg: 'rgba(20,8,8,0.92)', border: 'rgba(255,210,94,.9)', fontPx: 66 }),
    10, 2.9, 0, 9.6, z + 8.2, 0);
  b.kit('palace.gate.taihemen', 1, 12.4);
}

// ============ R14 太和门广场：围合 / 金砖 / 陈设 / 松柏 / 值房 ============
/**
 * 用户判词：「皇宫如此空旷正常吗」——不正常。故宫的宏大都来自围合，不是来自体量：
 * 太和门→太和殿之间是一条 296m 宽、88m 深的殿庭，两侧庑房夹道、地面整片金砖、
 * 月台前铜鼎日晷品级山成阵、四角松柏。旧版这里只有一块 300×250 的平铺板，
 * 两侧是 9m 进深的连续长条（不分间、无廊），所以从午门看进去就是「三个殿摆在沙地上」。
 *
 * 几何账（全部可机检：PALACE_COURT / PALACE_COURT_COVERAGE / palace.court.* kit）：
 *  · 广场 x ∈ [−148, 148]、z ∈ [−3194, −3106] = 296 × 88 = 26,048 m²；
 *  · 东西庑房各 12 间（面阔 7.0、进深 9.0），内立面 |x| = 147.5、连廊柱列 |x| = 144.1；
 *  · 金砖 0.06m 厚、色 0x6e6a66；大格通缝 0.03m（细砖缝由 PAVE_GLSL 程序化给出，不占几何）；御道 14m + 两侧 0.9m 石边；
 *  · 铜鼎 4 / 日晷 1（东 66,−3176）/ 嘉量 1（西 −66,−3176）/ 品级山 2 列 × 8 / 松柏 4 角 × 4；
 *  · 午门内值房东西各 6 间（面阔 8.2、进深 8.5、檐高 4.4）。
 */
export const PALACE_COURT = { x0: -148, x1: 148, z0: -3194, z1: -3106, roadHalf: 7 } as const;
const COURT_NX = 12;        // 每侧金砖列数（列距 ≈11.7m）
// 大格之间的露缝。旧值 0.45m：一格 6.34×12.33m 再加 45cm 通缝，从午门内看就是停车场车位线。
// 真实墁地的通缝只有 1–2cm；这里收到 0.03m 只留一道暗线，0.8–1.2m 的细砖缝交给
// PAVE_GLSL 的程序化色带（零几何），两套缝在尺度上分工，不再互相打架。
const COURT_GAP = 0.03;
const COURT_EDGE = 0.9;     // 御道两侧石边宽
const COURT_TILE_H = 0.06;  // 金砖厚（规格 0.06m）
const COURT_TILE_C = 0x6e6a66;
const COURT_BAY = 12;       // 每侧庑房间数（判定要求 9–13）
const COURT_VERANDA_Z0 = -3190;  // 庑房北端（南端 = 广场北界 −3106，12 间 × 7.0m）

interface CourtGrid { nx: number; nz: number; cw: number; cd: number; tw: number; td: number; sideIn: number }

/** 金砖网格的纯算术：绘制与覆盖率读数共用，改一处两边同步 */
function courtGrid(zS: number, zN: number, halfX: number = PALACE_COURT.x1): CourtGrid {
  const { roadHalf } = PALACE_COURT;
  const depth = Math.abs(zS - zN);
  const sideIn = roadHalf + COURT_EDGE;
  const nx = COURT_NX;
  const nz = Math.max(2, Math.round(depth / 12));
  const cw = (halfX - sideIn) / nx;
  const cd = depth / nz;
  return { nx, nz, cw, cd, tw: cw - COURT_GAP, td: cd - COURT_GAP, sideIn };
}

/**
 * 覆盖率 =（金砖 + 御道 + 石边）面积 / 广场矩形面积。
 * 砖缝不算铺装（露出底衬青石），所以这个数比「无裸沙」严格一档。
 */
export function courtPavingCoverage(zS: number = PALACE_COURT.z1, zN: number = PALACE_COURT.z0): {
  area: number; brick: number; paved: number; brickRatio: number; ratio: number;
} {
  const { x0, x1, roadHalf } = PALACE_COURT;
  const depth = Math.abs(zS - zN);
  const g = courtGrid(zS, zN);
  const area = (x1 - x0) * depth;
  const brick = g.tw * g.td * g.nx * g.nz * 2;
  const road = roadHalf * 2 * depth;
  const edge = COURT_EDGE * 2 * depth;
  return { area, brick, paved: brick + road + edge, brickRatio: brick / area, ratio: (brick + road + edge) / area };
}

/**
 * 广场实测覆盖率（0.995 = 99.5%），探针直接读这个常量。
 * 口径提醒：这个数只统计「几何砖面 + 御道 + 石边」，不含程序化砖缝——大格通缝从 0.45m 收到
 * 0.03m 后它自然抬高（旧值 93.1%）。它量的仍是「有没有裸沙」，不是「砖缝占多少画面」。
 */
export const PALACE_COURT_COVERAGE = courtPavingCoverage();

/**
 * 宫殿墁地的分级砖缝：0.9m 基本砖 + 每 7 块（6.3m）一道主缝。**零几何**。
 *
 * 病根在 `courtGrid`：它只按「12 列 / 12m 一行」切格，午门内广场单格 6.34×12.33m，
 * 从午门内看就是停车场。真实宫殿墁地是 0.6–1.2m 方砖，每 6–8 块一道通缝。
 *
 * 为什么不做真几何：午门内广场单侧 76.1×74m，铺 0.9m 方砖要 85×82 格 × 2 面 × 2 侧
 * ≈ 27,880 三角面；而现有铺装（144 块大砖 × 12 面）只有 1,728 面。净增 ≤0 的硬约束下，
 * 细砖缝只能走「贴图式色带」——在世界坐标里按 0.9m 周期调制漫反射色，逐片元 fwidth
 * 做抗锯齿与远距淡出，三角面一个不加。
 *
 * 三重门控保证只命中午门内广场 / 太和门广场的砖顶面（世界 y = 0.18）：
 *   ① 世界法线朝上（n.y > 0.9）——须弥座、品级山、树池的竖直侧面不沾；
 *   ② |y − 0.18| < 1.5mm —— 底衬 0.16、御道 0.185、御路石 0.23 全部排除；
 *   ③ 两个广场矩形内 —— 城内外同高度的石面不沾。
 * 御路石因此保持自己的材质与收边金线（顶面 0.23），砖缝淹不到它。
 */
const PAVE_BRICK_M = 0.9;     // 基本砖边长（0.8–1.2m 区间的中值）
const PAVE_MAJOR_EVERY = 7;   // 每 7 块一条主缝 = 6.3m

/** 砖缝的 GLSL 片段：paveHash/paveLine 两个小函数 + 砖距/主缝间隔两个 define */
const PAVE_GLSL = `
#define PAVE_PITCH ${PAVE_BRICK_M.toFixed(3)}
#define PAVE_MAJOR ${PAVE_MAJOR_EVERY.toFixed(1)}
float paveHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float paveLine( float d, float w, float aa ) {
  return 1.0 - smoothstep( max( w - aa, 0.0 ), w + aa, d );
}`;

/** 砖缝调制：进来的是「砖面最终色」，出去的是「砖面 × 砖缝/逐砖明度」 */
const PAVE_APPLY_GLSL = `
{
  vec2 pg = vPaveW.xz / PAVE_PITCH;
  vec2 paw = fwidth( pg );
  float paaw = max( paw.x, paw.y );
  float upFace = step( 0.9, vPaveN.y );
  float yBand = step( abs( vPaveW.y - 0.18 ), 0.0015 );
  float inFront = step( -84.0, vPaveW.x ) * step( vPaveW.x, 84.0 )
                * step( -3056.0, vPaveW.z ) * step( vPaveW.z, -2982.0 );
  float inCourt = step( -148.0, vPaveW.x ) * step( vPaveW.x, 148.0 )
                * step( -3194.0, vPaveW.z ) * step( vPaveW.z, -3106.0 );
  float zone = upFace * yBand * clamp( inFront + inCourt, 0.0, 1.0 );
  if ( zone > 0.5 ) {
    // 单元格小于约 2.5px 时淡回整片（亚像素砖缝只会变成摩尔纹）
    float fade = 1.0 - smoothstep( 0.14, 0.42, paaw );
    vec2 d = abs( fract( pg + 0.5 ) - 0.5 );   // 到最近砖缝的距离（单位：砖）
    vec2 joint = floor( pg + 0.5 );           // 最近砖缝的序号（主缝判定用）
    vec2 cell = floor( pg );                  // 砖块序号（逐砖明度用，一块砖只取一个值）
    // 缝宽按「3km 外一眼读得出」定档：10cm 通缝在 24m 处约 2.2px，2cm 真缝只有 0.4px（亚像素=摩尔纹）
    float jb = max( paveLine( d.x, 0.0556, paaw ), paveLine( d.y, 0.0556, paaw ) );  // 10cm 通缝
    float mx = 1.0 - step( 0.5, mod( joint.x, PAVE_MAJOR ) );
    float my = 1.0 - step( 0.5, mod( joint.y, PAVE_MAJOR ) );
    float jm = max( paveLine( d.x, 0.1111, paaw ) * mx, paveLine( d.y, 0.1111, paaw ) * my ); // 20cm 主缝
    float tone = 0.955 + 0.09 * paveHash( cell );
    float k = tone * ( 1.0 - 0.40 * jb - 0.24 * jm );  // 主缝再深一档
    diffuseColor.rgb *= mix( 1.0, k, fade );
  }
}`;

/**
 * 把 PAVE_GLSL 挂到 ash 材质上。工地只有一处：`Baker.materialSet()`（私有）——
 * 烘焙器与 flush 必须共用同一份材质实例，另建一份只会多一个 draw call 且改不到实际渲染的那份。
 * 幂等：材质上带 `__palacePaving` 标记，重复构建不会叠两次。
 */
function palacePavingJoints(b: Baker): void {
  const mats = (b as unknown as { materialSet(): Record<string, THREE.Material> }).materialSet();
  const ash = mats.ash as THREE.MeshStandardMaterial;
  const flag = ash as unknown as { __palacePaving?: boolean };
  if (flag.__palacePaving) return;
  flag.__palacePaving = true;
  ash.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaveW;\nvarying vec3 vPaveN;')
      // 城市网格的 modelMatrix 是单位阵（顶点已是世界坐标），这里只是把「取世界」写全
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvPaveN = normalize( mat3( modelMatrix ) * objectNormal );')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaveW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPaveW;\nvarying vec3 vPaveN;\n${PAVE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${PAVE_APPLY_GLSL}`);
  };
  ash.needsUpdate = true;
}

/** 金砖铺装：底衬青石 + 0.06m 金砖网格 + 14m 御道与石边（同一矩形可分几段铺，halfX 可窄于广场） */
function palaceCourtPaving(b: Baker, zS: number, zN: number, halfX: number = PALACE_COURT.x1): void {
  const { roadHalf } = PALACE_COURT;
  const depth = Math.abs(zS - zN);
  const cz = (zS + zN) / 2;
  const zSouth = Math.max(zS, zN);
  const g = courtGrid(zS, zN, halfX);
  // ① 底衬青石：整片顶面 0.16。砖缝里露出来的也是石面——广场内没有半寸裸沙
  b.box('ground', halfX * 2, 0.16, depth, 0, 0.08, cz, 0x6a6153);
  // ② 金砖：0.06 厚、色 0x6e6a66，逐块明度微差（坐标 hash，不消耗共享 RNG）。
  //    走 ash（中性石贴图）而不是 ground（暖赭夯土贴图）：0x6e6a66 乘上暖赭贴图会被染成沙色，
  //    广场又读回「一片沙地」。金砖本就是青灰色，必须和四周的夯土地面拉开色相差。
  for (const s of [-1, 1]) {
    for (let i = 0; i < g.nx; i++) {
      const cx = s * (g.sideIn + g.cw * (i + 0.5));
      for (let j = 0; j < g.nz; j++) {
        const zc = zSouth - g.cd * (j + 0.5);
        // 大格只留 ±1.5% 的极轻明度差：旧值 ±6% 会在细砖缝之上再叠一层 6.34×12.33m 的棋盘，
        // 远看仍是「大板拼缝」。逐砖明度差（0.9m 一格）由 PAVE_GLSL 的 paveHash 给。
        const tone = 0.985 + wardHash(i + 7, j + 13, s > 0 ? 3 : 5) * 0.03;
        b.box('ash', g.tw, COURT_TILE_H, g.td, cx, 0.15, zc, shade(COURT_TILE_C, tone));
      }
    }
  }
  // ③ 御道：14m 宽、顶面 0.185，两侧 0.9m 石边顶 0.20。
  //    压这么低是为了让 architecture.ts 的 carpetDaqing 红毯（底面 0.19、团花顶 0.235）能落在御道上，
  //    旧顶面 0.225 会把毯面埋掉、只漏出一圈金色团花——远看是「路面上浮着几个金点」。
  b.box('ash', roadHalf * 2, 0.1, depth, 0, 0.135, cz, shade(0x8d8878, 1.02));
  for (const s of [-1, 1]) b.box('ash', COURT_EDGE, 0.06, depth, s * (roadHalf + COURT_EDGE / 2), 0.17, cz, PAL_STONE);
  b.kit('palace.court.paving', g.nx * g.nz * 2, 0.18);
}

/**
 * 广场东西庑房：一间 = 后墙 + 分间墙 + 槛墙 + 隔扇 + 窗光；前檐一条连廊（柱列 + 单坡顶 + 宫灯）。
 * 12 间 ×2 = 24 间，内立面 |x| = 147.5 正好卡在广场 148 的边线上——两侧一围，广场才成立。
 */
function palaceCourtVeranda(b: Baker, sx: number, zS: number, zN: number, bays: number): void {
  const depth = 9, h = 6.6;
  const x = sx * 152;
  const L = zS - zN;
  const cz = (zS + zN) / 2;
  const bayW = L / bays;
  const inner = x - (sx * depth) / 2;   // ±147.5
  const walk = inner - sx * 3.4;        // 连廊柱列 ±144.1
  // 台明：铺到连廊柱列之外，柱脚不站在砖上
  b.box('ash', depth + 4.6, 0.6, L + 1.6, x - sx * 1.5, 0.3, cz, 0x8b8371);
  // 后墙 + 南北山墙
  b.box('wall', 0.9, h, L, x + sx * (depth / 2 - 0.45), 0.6 + h / 2, cz, shade(PAL_RED, 0.9));
  for (const e of [-1, 1]) b.box('wall', depth, h + 0.4, 1.0, x, 0.6 + (h + 0.4) / 2, cz + e * (L / 2), shade(PAL_RED, 0.84));
  for (let i = 0; i < bays; i++) {
    const zb = zS - bayW * i;
    const zc = zb - bayW / 2;
    // 分间墙：把长条切成「间」
    b.box('wall', depth - 1.2, h * 0.94, 0.42, x + sx * 0.3, 0.6 + h * 0.47, zb, shade(PAL_RED, 0.8));
    // 槛墙（下截）+ 隔扇（上截）+ 两扇窗光
    b.box('wall', 0.5, 1.5, bayW - 0.8, inner - sx * 0.15, 1.35, zc, shade(PAL_RED, 0.86));
    b.box('lacquer', 0.34, 3.2, bayW - 0.9, inner - sx * 0.24, 3.5, zc, 0x2a1414);
    for (let m = 0; m < 3; m++) {
      b.box('wood', 0.14, 3.2, 0.2, inner, 3.5, zc - (bayW - 0.9) / 2 + ((bayW - 0.9) * (m + 0.5)) / 3, 0xc9a13a);
    }
    for (const e of [-1, 1]) b.box('glow', 0.1, 1.5, (bayW - 1.4) * 0.4, inner - sx * 0.44, 3.4, zc + e * bayW * 0.2, 0xff9a3c);
    // 连廊宫灯
    b.box('wood', 0.07, 0.9, 0.07, walk - sx * 0.9, 4.1, zc, C.woodDark);
    b.box('fabric', 0.56, 0.66, 0.56, walk - sx * 0.9, 3.55, zc, 0x9d2933);
    b.box('glow', 0.4, 0.5, 0.4, walk - sx * 0.9, 3.55, zc, C.lantern);
    b.kit('palace.court.veranda', 1, 0.6 + h);
  }
  // 连廊柱列 + 檐枋 + 单坡廊顶
  for (let i = 0; i <= bays; i++) {
    const zz = zS - bayW * i;
    b.box('wood', 0.44, 4.0, 0.44, walk, 0.6 + 2.0, zz, 0xb8892a);
    b.box('ash', 0.78, 0.3, 0.78, walk, 0.75, zz, PAL_MARBLE);
  }
  b.box('wood', 0.4, 0.46, L + 0.8, walk, 4.72, cz, shade(C.woodDark, 1.14));
  b.box('roof', 4.8, 0.26, L + 1.2, inner - sx * 1.8, 4.86, cz, shade(PAL_TILE, 1.08), 0, 0, sx * 0.13);
  b.box('roof', 0.5, 0.3, L + 1.2, walk - sx * 2.3, 4.62, cz, shade(PAL_TILE, 0.74));
  // 主瓦顶（双坡，脊沿 z）
  const rh = 1.4 + depth * 0.14;
  for (const s2 of [-1, 1]) {
    b.box('roof', depth / 2 + 1.3, 0.24, L + 1.6, x + s2 * (depth / 4 + 0.3), 0.6 + h + rh * 0.5, cz, PAL_TILE, 0, 0, -s2 * 0.34);
  }
  b.box('roof', 0.62, 0.3, L + 1.7, x, 0.6 + h + rh, cz, shade(PAL_TILE, 1.25));
}

/** 铜鼎：汉白玉石座 + 三足炉身 + 双耳 + 盖 + 口沿火光（4 座，月台前御道两侧各两座） */
function courtDing(b: Baker, x: number, z: number): void {
  b.box('ash', 2.3, 0.3, 2.3, x, 0.15, z, 0x8d8a80);
  b.box('ash', 1.7, 0.5, 1.7, x, 0.55, z, PAL_STONE);
  b.cyl('metal', 1.0, 0.78, 1.5, 12, x, 1.5, z, 0x4a4234);
  for (let l = 0; l < 3; l++) {
    const a = 0.6 + l * 2.094;
    b.cyl('metal', 0.15, 0.19, 0.95, 6, x + Math.cos(a) * 0.82, 0.95, z + Math.sin(a) * 0.82, 0x3d362b);
  }
  b.cyl('metal', 1.1, 1.0, 0.16, 12, x, 2.3, z, 0x5a5040);
  for (const s of [-1, 1]) b.box('metal', 0.2, 0.62, 0.46, x + s * 1.02, 2.5, z, 0x5a5040);
  b.cyl('metal', 0.68, 0.94, 0.34, 12, x, 2.55, z, 0x4a4234);
  b.cyl('metal', 0.22, 0.28, 0.42, 8, x, 2.9, z, 0xd8b028);
  for (let l = 0; l < 4; l++) {
    const a = l * 1.5708 + 0.4;
    b.box('glow', 0.26, 0.14, 0.26, x + Math.cos(a) * 0.86, 2.34, z + Math.sin(a) * 0.86, 0xff7a2a);
  }
  b.kit('palace.court.ding', 1, 2.6);
}

/** 日晷：须弥座 + 赤道式斜置晷盘（倾 39°）+ 晷针 + 七道刻度（东侧一座） */
function courtSundial(b: Baker, x: number, z: number): void {
  b.box('ash', 2.8, 0.3, 2.8, x, 0.15, z, 0x8d8a80);
  b.box('ash', 1.9, 0.7, 1.9, x, 0.65, z, shade(PAL_MARBLE, 0.88));
  b.box('ash', 1.4, 1.0, 1.4, x, 1.5, z, shade(PAL_MARBLE, 0.94));
  const tilt = 0.62, sin = Math.sin(tilt), cos = Math.cos(tilt);
  b.box('wall', 2.3, 0.16, 2.3, x, 2.05, z, PAL_MARBLE, 0, tilt, 0);
  b.box('metal', 0.1, 0.1, 2.7, x, 2.05, z, 0xc9a13a, 0, tilt, 0);
  for (let k = 0; k < 7; k++) {
    const d = -0.85 + k * 0.283;
    b.box('metal', 0.06, 0.03, 0.14, x + 0.7, 2.05 - d * sin + 0.12, z + d * cos, 0xd8b028, 0, tilt, 0);
  }
  b.kit('palace.court.sundial', 1, 2.2);
}

/** 嘉量：须弥座 + 铜斛 + 口沿 + 宝顶（西侧一座，与日晷对置） */
function courtJialiang(b: Baker, x: number, z: number): void {
  b.box('ash', 2.8, 0.3, 2.8, x, 0.15, z, 0x8d8a80);
  b.box('ash', 1.9, 0.7, 1.9, x, 0.65, z, shade(PAL_MARBLE, 0.88));
  b.box('ash', 1.3, 1.1, 1.3, x, 1.55, z, shade(PAL_MARBLE, 0.94));
  b.box('metal', 1.5, 0.12, 1.5, x, 2.16, z, 0x5a5040);
  b.cyl('metal', 0.6, 0.42, 0.72, 12, x, 2.58, z, 0x4a4234);
  b.cyl('metal', 0.68, 0.64, 0.1, 12, x, 2.99, z, 0xd8b028);
  b.cyl('metal', 0.16, 0.2, 0.26, 8, x, 3.17, z, 0xd8b028);
  b.kit('palace.court.jialiang', 1, 2.6);
}

/** 品级山：石座 + 两级「山」形石 + 金线（御道两侧 2 列 × 8 座） */
function courtPinji(b: Baker, x: number, z: number): void {
  b.box('ash', 1.7, 0.32, 1.7, x, 0.16, z, 0x8d8a80);
  b.box('wall', 1.2, 0.5, 1.2, x, 0.57, z, shade(0xb4ab96, 0.98));
  b.box('wall', 0.9, 0.42, 0.9, x, 1.03, z, shade(0xa89f8a, 1.02));
  b.box('metal', 0.5, 0.06, 0.5, x, 1.27, z, 0xc9a13a);
  b.kit('palace.court.pinji', 1, 1.2);
}

/**
 * 御路石（丹陛石）：午门内广场中轴一整块浅浮雕石板。
 * 广场本身已有 14m 御道，但那是一条平铺的色带；加一块 8m 宽、抬 1.5cm 的整石，
 * 从午门门洞看进去才有「一条石」而不是「一条路」。
 */
function courtImperialWay(b: Baker, zS: number, zN: number): void {
  const L = Math.abs(zS - zN);
  const cz = (zS + zN) / 2;
  b.box('ash', 8, 0.09, L, 0, 0.185, cz, shade(PAL_MARBLE, 0.97));
  for (const sx of [-1, 1]) b.box('ash', 0.5, 0.12, L, sx * 4.25, 0.19, cz, PAL_STONE);
  // 浮雕：七道横跨石面的金线 + 每道两端云头（3km 外读成"石面上有纹"，近处读成云龙带）
  for (let i = 0; i < 7; i++) {
    const z = zS - (L * (i + 0.5)) / 7;
    b.box('metal', 7.0, 0.02, 0.16, 0, 0.235, z, 0xc9a13a);
    for (const sx of [-1, 1]) b.box('metal', 0.9, 0.02, 0.5, sx * 3.0, 0.235, z + 0.5, 0xd8b028);
  }
  b.kit('palace.front.imperialWay', 1, 0.2);
}

/** 铜龟：须弥座 + 龟趺 + 鎏金龟背（头朝 sx），与铜鹤对置 */
function courtTurtle(b: Baker, x: number, z: number, sx: number): void {
  b.box('ash', 2.2, 0.28, 2.2, x, 0.14, z, 0x8d8a80);
  b.box('ash', 1.7, 0.55, 1.7, x, 0.55, z, shade(PAL_MARBLE, 0.9));
  b.box('ash', 1.3, 0.18, 1.3, x, 0.9, z, PAL_MARBLE);
  b.sphere('metal', 0.86, 10, x, 1.28, z, 0x4a4234, 0, 0, 0, 1.2, 0.5, 0.98);
  b.sphere('metal', 0.46, 8, x + sx * 1.02, 1.2, z, 0x554a3a, 0, 0, 0, 1.15, 0.6, 0.72);
  for (const ax of [-1, 1]) for (const az of [-1, 1]) b.box('metal', 0.26, 0.34, 0.3, x + ax * 0.62, 1.03, z + az * 0.62, 0x4a4234);
  b.box('metal', 0.2, 0.16, 0.5, x - sx * 1.0, 1.1, z, 0x4a4234, 0, 0, 0.5);
  for (let i = -1; i <= 1; i++) b.box('metal', 1.1, 0.02, 0.06, x, 1.46, z + i * 0.3, 0xc9a13a);
  b.kit('palace.front.turtle', 1, 1.6);
}

/** 铜鹤：须弥座 + 双足 + 鹤身 + 两段长颈 + 喙 + 丹顶 + 双翼，头朝 -sx */
function courtCrane(b: Baker, x: number, z: number, sx: number): void {
  b.box('ash', 2.2, 0.28, 2.2, x, 0.14, z, 0x8d8a80);
  b.box('ash', 1.7, 0.55, 1.7, x, 0.55, z, shade(PAL_MARBLE, 0.9));
  b.box('ash', 1.2, 0.16, 1.2, x, 0.9, z, PAL_MARBLE);
  const y0 = 0.98;
  for (const az of [-1, 1]) b.cyl('metal', 0.055, 0.07, 1.05, 6, x, y0 + 0.52, z + az * 0.18, 0x5a5040);
  b.sphere('metal', 0.62, 10, x, y0 + 1.18, z, 0x5a5040, 0, 0, 0, 1.25, 0.72, 0.8);
  b.cyl('metal', 0.09, 0.13, 1.1, 6, x - sx * 0.42, y0 + 1.78, z, 0x5a5040, 0, 0, sx * 0.5);
  b.cyl('metal', 0.07, 0.09, 0.7, 6, x - sx * 0.82, y0 + 2.28, z, 0x5a5040, 0, 0, sx * 0.9);
  b.sphere('metal', 0.15, 8, x - sx * 0.98, y0 + 2.62, z, 0x5a5040, 0, 0, 0, 1.2, 0.9, 0.9);
  b.box('metal', 0.42, 0.06, 0.07, x - sx * 1.22, y0 + 2.6, z, 0xc9a13a, 0, 0, sx * 0.12);
  b.box('wall', 0.16, 0.08, 0.16, x - sx * 0.98, y0 + 2.76, z, 0xa8322a);
  for (const az of [-1, 1]) b.box('metal', 0.9, 0.08, 0.42, x + sx * 0.1, y0 + 1.34, z + az * 0.32, 0x4a4234, 0, 0, -0.35);
  b.kit('palace.front.crane', 1, 2.6);
}

/**
 * 午门内广场（真正的皇宫前庭）地面陈设：御路石 / 日晷 / 嘉量 / 铜龟 / 铜鹤 / 品级山两列。
 * **不加任何有顶建筑**——SPEC-总账.md:153 把中轴院无有顶建筑列为刻意保留的大朝仪制空间。
 * 落位全部收在 |x| ≤ 42 内：东西值房内立面 |x| = 59.75，太和门台基南缘 z = −3057，
 * 陈设南端 z = −2990 在午门城台北缘（−2968）以北 22m。
 */
function palaceFrontFurnish(b: Baker): void {
  const zS = -2990, zN = -3050;
  courtImperialWay(b, zS, zN);
  courtSundial(b, 30, -3020);
  courtJialiang(b, -30, -3020);
  courtTurtle(b, 16, -3040, 1);
  courtCrane(b, -16, -3040, -1);
  for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) courtPinji(b, sx * 40, -2996 - i * 7.0);
  b.kit('palace.front.pinji', 16, 1.2);
  if (typeof window !== 'undefined') {
    (window as unknown as { __w2PalaceFront?: unknown }).__w2PalaceFront = {
      court: { x0: -84, x1: 84, z0: -3056, z1: -2982 },
      items: {
        imperialWay: { x: 0, z0: zS, z1: zN, w: 8 },
        sundial: { x: 30, z: -3020 },
        jialiang: { x: -30, z: -3020 },
        turtle: { x: 16, z: -3040 },
        crane: { x: -16, z: -3040 },
        pinji: { columns: [-40, 40], z0: -2996, dz: 7.0, n: 8 },
      },
    };
  }
}

/** 松柏：树池 + 树干（cyl 'trunk'）+ 三层松针球（sphere 'leaf'）——不用圆锥 */
function courtPine(b: Baker, x: number, z: number, s: number): void {
  b.box('ash', 3.4, 0.34, 3.4, x, 0.17, z, 0x8b8371);
  b.box('ground', 2.8, 0.1, 2.8, x, 0.3, z, 0x4a4335);
  b.cyl('trunk', 0.34 * s, 0.5 * s, 4.0 * s, 7, x, 0.3 + 2.0 * s, z, 0x5a4632);
  b.sphere('leaf', 2.4 * s, 10, x, 4.6 * s, z, 0x2f4a30, 0, 0, 0, 1.15, 0.82, 1.15);
  b.sphere('leaf', 1.9 * s, 10, x + 0.8 * s, 6.2 * s, z - 0.5 * s, 0x35543a, 0, 0, 0, 1.1, 0.86, 1.1);
  b.sphere('leaf', 1.4 * s, 10, x - 0.6 * s, 7.5 * s, z + 0.5 * s, 0x2b4430, 0, 0, 0, 1.05, 0.9, 1.05);
  b.kit('palace.court.tree', 1, 5 * s);
}

/** 广场陈设：品级山 16 / 铜鼎 4 / 日晷 1 / 嘉量 1 / 松柏 4 角 × 4 */
function palaceCourtFurnish(b: Baker): void {
  // ① 品级山：御道两侧各 8 座（2 列 × 8，列距 7.4m）
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i++) courtPinji(b, sx * 44, -3118 - i * 7.4);
  }
  // ② 铜鼎 4：月台前御道两侧各两座
  for (const sx of [-1, 1]) for (const z of [-3148, -3172]) courtDing(b, sx * 27, z);
  // ③ 日晷（东）嘉量（西）：月台前一左一右
  courtSundial(b, 66, -3176);
  courtJialiang(b, -66, -3176);
  // ④ 松柏：广场四角各 4 株
  for (const sx of [-1, 1]) {
    for (const cz of [-3114, -3178]) {
      for (const ox of [-3.6, 3.6]) for (const oz of [-3.6, 3.6]) {
        const s = 0.92 + wardHash(Math.round(cz), Math.round(ox * 10), sx > 0 ? 1 : 2) * 0.24;
        courtPine(b, sx * 130 + ox, cz + oz, s);
      }
    }
  }
  b.kit('imperial.taihePlaza', 1, 0.2);
  b.kit('imperial.zichenDing', 4, 1);
  b.kit('imperial.zichenPlaza', 1, 0.2);
}

// ============ R27 太和殿丹陛广场 · 仪仗陈设（可机检 / 可 grep） ============
// R20 实拍 r20-04-palace.png：丹陛广场是一整片灰白大铺装、边缘空荡。
// 沿广场东西两侧补「仪仗带」，中轴 |x|<20 完全留空，保持大朝广场的空阔形制。
const COURT_FURNISH_X_FLAG = 104;   // 仪仗旗幡列 |x|
const COURT_FURNISH_X_TREE = 120;   // 宫树阵列 |x|
const COURT_FURNISH_X_BED = 82;     // 花坛列 |x|
const COURT_FURNISH_Z0 = -3112;     // 南端（靠太和门）
const COURT_FURNISH_Z1 = -3186;     // 北端（靠太和殿月台）
const COURT_FURNISH_ROWS = 5;       // 沿 z 的仪仗排数

/** 仪仗旗幡：石础 + 细木杆 + 朱/黄/青三色幡面 + 鎏金杆顶（细高，不遮中轴甬道） */
function courtBanner(b: Baker, x: number, z: number, salt: number): void {
  const h = 5.4 + wardHash(x, z, salt) * 0.9;
  const cols = [0x9d2933, 0xd8a24a, 0x24483a];   // 朱 / 明黄 / 青
  const fc = cols[(wardHash(x, z, salt + 1) * cols.length) | 0];
  b.box('ash', 1.1, 0.24, 1.1, x, 0.30, z, 0x8d8a80);
  b.cyl('wood', 0.09, 0.12, h, 6, x, 0.42 + h / 2, z, 0x4a3524);
  b.sphere('metal', 0.17, 8, x, 0.42 + h + 0.12, z, 0xd8b028);
  b.box('wood', 1.6, 0.09, 0.09, x + 0.65, 0.42 + h - 0.25, z, 0x4a3524);
  b.box('fabric', 0.06, 2.6, 1.2, x + 1.35, 0.42 + h - 1.6, z, fc, 0, 0, (wardHash(x, z, salt + 2) - 0.5) * 0.14);
  b.box('metal', 1.2, 0.10, 0.06, x + 1.35, 0.42 + h - 2.9, z, 0xd8b028);
}

/** 花坛：汉白玉矮栏 + 土面 + 五色花球（低矮 0.6m，不挡视线） */
function courtFlowerBed(b: Baker, x: number, z: number, salt: number): void {
  b.box('ash', 4.6, 0.42, 3.0, x, 0.39, z, PAL_MARBLE);
  b.box('ground', 4.0, 0.06, 2.4, x, 0.63, z, 0x4a4335);
  const cols = [0xc2677a, 0xd8a24a, 0xd8d0b0, 0x9a6fb0, 0x9d2933];
  for (let i = 0; i < 7; i++) {
    const a = wardHash(x, z, salt + i);
    b.sphere('leaf', 0.32 + a * 0.16, 6,
      x + (wardHash(x, z, salt + 20 + i) - 0.5) * 3.2,
      0.80, z + (wardHash(x, z, salt + 40 + i) - 0.5) * 1.8,
      cols[(a * cols.length) | 0], 0, 0, 0, 1, 0.8, 1);
  }
}

/** 丹陛石雕：须弥座 + 云龙浅浮雕斜板 + 云头石兽（成对列于月台前，低矮 1.1m） */
function courtDanbiCarving(b: Baker, x: number, z: number, sx: number): void {
  b.box('ash', 3.2, 0.30, 2.2, x, 0.33, z, 0x8d8a80);
  b.box('ash', 2.8, 0.34, 1.8, x, 0.65, z, PAL_MARBLE);
  b.box('wall', 2.4, 0.16, 1.5, x, 0.90, z, shade(PAL_MARBLE, 0.94), 0, 0.24, 0);
  for (let i = 0; i < 4; i++) {
    b.box('metal', 2.0, 0.02, 0.07, x, 1.00 - i * 0.02, z - 0.5 + i * 0.3, 0xc9a13a, 0, 0.24, 0);
  }
  b.sphere('ash', 0.34, 8, x + sx * 1.0, 1.06, z, shade(PAL_MARBLE, 0.9), 0, 0, 0, 1, 0.7, 1);
}

/**
 * R27 太和殿丹陛广场仪仗陈设：旗幡 / 花坛 / 宫树阵列 / 品级山 / 丹陛石雕 / 铜鹤 / 香炉。
 * 全部落在 |x| ∈ [30, 132]、z ∈ [−3190, −3110]，中轴 |x|<20 完全留空，
 * 保持大朝广场的空阔形制；不种满树堵住中轴、不加有顶建筑（沿用 SPEC 仪制）。
 * 复用 courtPinji / courtDing / courtCrane / courtPine，新增小件全走既有材质组、Baker 合批。
 * 位置与选型全由 wardHash 整数坐标 hash 派生，零共享 RNG、不用 Math.random。
 */
function palaceCourtFurnishR27(b: Baker): void {
  let n = 0;
  const dz = (COURT_FURNISH_Z0 - COURT_FURNISH_Z1) / (COURT_FURNISH_ROWS - 1);
  for (const sx of [-1, 1]) {
    const side = sx > 0 ? 1 : 0;
    for (let i = 0; i < COURT_FURNISH_ROWS; i++) {
      const z = COURT_FURNISH_Z0 - i * dz;
      courtBanner(b, sx * COURT_FURNISH_X_FLAG, z, 701 + i * 3 + side); n++;   // 仪仗旗幡
      courtFlowerBed(b, sx * COURT_FURNISH_X_BED, z, 811 + i * 3 + side); n++; // 花坛
    }
    for (let i = 0; i < 4; i++) {                                               // 宫树阵列（复用 courtPine）
      courtPine(b, sx * COURT_FURNISH_X_TREE, -3116 - i * 24, 0.78 + wardHash(sx, i, 907) * 0.18); n++;
    }
    for (let i = 0; i < 3; i++) {                                               // 品级山（北侧补列，复用 courtPinji）
      courtPinji(b, sx * 44, -3178 - i * 4.6); n++;
    }
    courtDanbiCarving(b, sx * 30, -3188, sx); n++;                              // 丹陛石雕
    courtCrane(b, sx * 56, -3110, -sx); n++;                                    // 铜鹤
    courtDing(b, sx * 68, -3110); n++;                                          // 铜鹤香炉（铜鼎）
  }
  b.kit('palace.courtFurnish', n, 0.6);
}

// ============ R28 太和殿丹陛广场 · 彩色仪仗方阵（可机检 / 可 grep） ============
// R20 实拍 r20-04-palace.png：广场人群在 500m 外只是深色小点，crowd.ts 的服色被 LOD 压成剪影，
// 靠改 NPC 救不回远景可辨性。这一层改走场景几何：8 组 10×10 彩色仪仗幡 / 伞盖 / 甲仗立柱，
// 俯瞰下连成可数的彩色条带，与 crowd.ts 的 8 个 palaceDense 身份一一对应。
const COURT_ARRAY_NX = 10;        // 每组列数
const COURT_ARRAY_NZ = 10;        // 每组行数（10×10 = 100 根/组，8 组共 800 根）
const COURT_ARRAY_STEP = 2.0;     // 1.8–2.2m 间距档：密实矩形、俯瞰成块
const COURT_ARRAY_X_INNER = 155;  // 内侧列 |x|：方阵 x 146–164，贴 PALACE_COURT 缘 148 之外
const COURT_ARRAY_X_OUTER = 196;  // 外侧列 |x|：方阵 x 187–205，落在 |x|=172 庑房之后的 178–214 夹道
const COURT_ARRAY_Z_S = -3116;    // 南排（靠太和门）
const COURT_ARRAY_Z_N = -3170;    // 北排（靠太和殿月台）；z 覆盖 −3107…−3179，不触大殿台基 −3218

interface CourtArrayGroup { x: number; z: number; hex: number; role: string }

/** 8 组：左右严格镜像分列，中轴 |x|<20 全空；8 色全部用上，同色系的东西对位 */
const COURT_ARRAY_GROUPS: readonly CourtArrayGroup[] = [
  { x: -COURT_ARRAY_X_INNER, z: COURT_ARRAY_Z_S, hex: 0x6b5bff, role: '王公大臣·石青紫' },
  { x:  COURT_ARRAY_X_INNER, z: COURT_ARRAY_Z_S, hex: 0x3f6ee0, role: '禁军·靛青' },
  { x: -COURT_ARRAY_X_OUTER, z: COURT_ARRAY_Z_S, hex: 0xff3b2f, role: '侍卫·朱红' },
  { x:  COURT_ARRAY_X_OUTER, z: COURT_ARRAY_Z_S, hex: 0xff8a2a, role: '侍卫·橙红' },
  { x: -COURT_ARRAY_X_INNER, z: COURT_ARRAY_Z_N, hex: 0xfbb81c, role: '将军·金甲' },
  { x:  COURT_ARRAY_X_INNER, z: COURT_ARRAY_Z_N, hex: 0xf7d23a, role: '将军·金甲' },
  { x: -COURT_ARRAY_X_OUTER, z: COURT_ARRAY_Z_N, hex: 0xffd23f, role: '帝后·明黄' },
  { x:  COURT_ARRAY_X_OUTER, z: COURT_ARRAY_Z_N, hex: 0xff5fa8, role: '宫女·胭脂粉' },
];

/**
 * 一根仪仗：彩色漆杆（高 3.1–3.9m、直径 0.36–0.54m）+ 顶部鎏金球 +
 * 小方旗 / 圆伞盖 / 甲仗横旗三形制轮换。颜色全部由 b.cyl / b.box 的 hex 直接给出，
 * 走既有 lacquer / fabric / wood / metal 材质组；不是一排彩色方柱。
 * 位置与选型全由 wardHash(x,z,salt) 整数坐标 hash 派生，零共享 RNG、不用 Math.random。
 */
function courtArrayPennant(b: Baker, x: number, z: number, hex: number, salt: number): void {
  const h = 3.1 + wardHash(x, z, salt) * 0.8;          // 3.1–3.9m
  const r = 0.18 + wardHash(x, z, salt + 1) * 0.09;    // 半径 0.18–0.27 → 直径 0.36–0.54m
  const y0 = 0.18;                                     // 宫城方砖 / 金砖铺装顶
  b.cyl('lacquer', r * 0.82, r, h, 5, x, y0 + h / 2, z, hex);
  b.sphere('metal', 0.15, 5, x, y0 + h + 0.16, z, 0xf7d23a);
  const k = salt % 3;
  if (k === 0) {
    // 小方旗：横挑 + 彩色方旗面
    b.box('wood', 1.0, 0.06, 0.06, x + 0.48, y0 + h - 0.24, z, 0x4a3524);
    b.box('fabric', 0.06, 1.05, 1.15, x + 1.0, y0 + h - 0.78, z, hex, 0, 0, (wardHash(x, z, salt + 2) - 0.5) * 0.10);
  } else if (k === 1) {
    // 圆伞盖：上宽下窄的彩色扁锥台 + 一道伞垂
    b.cyl('fabric', 0.62, 0.30, 0.26, 8, x, y0 + h - 0.34, z, hex);
    b.box('fabric', 0.05, 0.36, 0.62, x, y0 + h - 0.62, z, shade(hex, 0.92));
  } else {
    // 甲仗：横挑 + 彩色竖旗 + 鎏金叉
    b.box('wood', 1.0, 0.06, 0.06, x - 0.48, y0 + h - 0.30, z, 0x4a3524);
    b.box('fabric', 0.06, 0.72, 1.0, x - 0.95, y0 + h - 0.66, z, hex, 0, 0, (wardHash(x, z, salt + 3) - 0.5) * 0.10);
    b.box('metal', 0.07, 0.30, 0.07, x, y0 + h + 0.02, z, 0xd8b028);
  }
}

/**
 * 8 组彩色仪仗方阵：每组 10×10 = 100 根、8 组共 800 根，1.8–2.2m 间距排成密实矩形。
 * 落位只取两条无建筑空带（|x| 146–164 与 187–205），避开：
 * 中轴御道 |x|<20 / 大殿台基 z≤−3218 / 既有 40 件 courtFurnish（|x|≤132）/
 * |x|=172 分节庑房（166–178）/ 院群（214–320）/ |x|=332 外庑（324–340）。
 * 全部走 Baker 合批，不新增 Mesh / draw call；salt 为固定整数序列，零 RNG。
 */
function palaceCourtArrayR28(b: Baker): void {
  let flags = 0;
  for (let gi = 0; gi < COURT_ARRAY_GROUPS.length; gi++) {
    const g = COURT_ARRAY_GROUPS[gi];
    for (let r = 0; r < COURT_ARRAY_NZ; r++) {
      for (let c = 0; c < COURT_ARRAY_NX; c++) {
        const x = g.x + (c - (COURT_ARRAY_NX - 1) / 2) * COURT_ARRAY_STEP;
        const z = g.z + (r - (COURT_ARRAY_NZ - 1) / 2) * COURT_ARRAY_STEP;
        courtArrayPennant(b, x, z, g.hex, 1201 + gi * 137 + r * 11 + c);
        flags++;
      }
    }
  }
  b.kit('palace.courtArray', COURT_ARRAY_GROUPS.length, 0.6);  // 8 组
  b.kit('palace.courtArray.group', COURT_ARRAY_GROUPS.length, 3.2);
  b.kit('palace.courtArray.flag', flags, 3.2);                 // 800 根
}

/**
 * 午门内值房：东西各一排 6 间（面阔 8.2 / 进深 8.5 / 檐高 4.4），内立面 |x| = 87.75。
 * 南端起于 z = −2986——午门内侧 24m 处是御沟（水面 −2978…−2970），值房不能站在沟里。
 * 北端接一段敞廊到 z = −3052（贴近日墙），把 6 间拉成一条「朝房夹道」而不是孤零零一排房。
 */
function palaceDutyRooms(b: Baker, sx: number): void {
  const bays = 6, bayW = 8.2, depth = 8.5, h = 4.4;
  // |x| = 64：午门内广场宽 128m。再往外（旧值 92）在 85° 水平视场里永远进不了画面——
  // 从午门看进去两侧仍是空的。64 这个距离下，北端敞廊（z −3052，70m 远）正好压在视场边缘收口。
  const x = sx * 64;
  const zS = -2986;
  const zN = zS - bays * bayW;
  const L = zS - zN, cz = (zS + zN) / 2;
  const inner = x - (sx * depth) / 2;
  b.box('ash', depth + 2.2, 0.5, L + 1.4, x, 0.25, cz, 0x8b8371);
  b.box('wall', 0.8, h, L, x + sx * (depth / 2 - 0.4), 0.5 + h / 2, cz, shade(PAL_RED, 0.92));
  for (const e of [-1, 1]) b.box('wall', depth + 0.6, h + 0.3, 0.9, x, 0.5 + (h + 0.3) / 2, cz + e * L / 2, shade(PAL_RED, 0.86));
  for (let i = 0; i < bays; i++) {
    const zb = zS - bayW * i;
    const zc = zb - bayW / 2;
    // 分间墙
    b.box('wall', depth - 0.8, h * 0.96, 0.4, x, 0.5 + h * 0.48, zb, shade(PAL_RED, 0.82));
    // 板门 + 门框 + 门钉
    b.box('lacquer', 0.3, 2.4, 1.8, inner - sx * 0.12, 1.7, zc - bayW * 0.16, 0x2a1414);
    b.box('metal', 0.34, 0.14, 1.9, inner - sx * 0.14, 2.95, zc - bayW * 0.16, 0xc9a13a);
    for (const t of [-1, 1]) b.box('metal', 0.34, 2.5, 0.16, inner - sx * 0.14, 1.7, zc - bayW * 0.16 + t * 0.98, 0xc9a13a);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      b.box('metal', 0.1, 0.1, 0.1, inner - sx * 0.3, 1.1 + r * 0.42, zc - bayW * 0.16 - 0.55 + c * 0.55, 0xd8b028);
    }
    // 槛窗（窗光）
    b.box('wall', 0.34, 1.2, 2.2, inner - sx * 0.1, 1.1, zc + bayW * 0.26, shade(PAL_RED, 0.88));
    b.box('glow', 0.14, 1.1, 1.7, inner - sx * 0.24, 2.5, zc + bayW * 0.26, 0xff9a3c);
    // 檐灯
    b.box('wood', 0.06, 0.7, 0.06, inner - sx * 0.9, 3.6, zc, C.woodDark);
    b.box('fabric', 0.42, 0.5, 0.42, inner - sx * 0.9, 3.2, zc, 0x9d2933);
    b.box('glow', 0.32, 0.4, 0.32, inner - sx * 0.9, 3.2, zc, C.lantern);
    b.kit('palace.court.dutyroom', 1, 0.5 + h);
  }
  // 双坡瓦顶（脊沿 z）
  const rh = 1.2 + depth * 0.12;
  for (const s2 of [-1, 1]) {
    b.box('roof', depth / 2 + 1.0, 0.22, L + 1.3, x + s2 * (depth / 4 + 0.25), 0.5 + h + rh * 0.5, cz, shade(PAL_TILE, 1.03), 0, 0, -s2 * 0.34);
  }
  b.box('roof', 0.5, 0.26, L + 1.4, x, 0.5 + h + rh, cz, shade(PAL_TILE, 1.24));
  // 北端敞廊：台明 + 廊柱 + 单坡顶，接到院墙前（z = −3052）
  const zEnd = -3052;
  const L2 = zN - zEnd, cz2 = (zN + zEnd) / 2;
  b.box('ash', depth, 0.5, L2 + 0.8, x, 0.25, cz2, 0x938c7c);
  b.box('roof', depth + 1.2, 0.4, L2 + 1.0, x, 4.5, cz2, shade(PAL_TILE, 1.0), 0, 0, -sx * 0.1);
  for (let i = 0; i <= 6; i++) {
    const zz = zN - (L2 * i) / 6;
    b.box('wood', 0.4, 3.9, 0.4, inner + sx * 0.4, 2.35, zz, shade(C.woodRed, 0.96));
    b.box('ash', 0.7, 0.28, 0.7, inner + sx * 0.4, 0.64, zz, PAL_MARBLE);
  }
  b.box('wood', 0.34, 0.38, L2 + 1.0, inner + sx * 1.1, 4.44, cz2, shade(C.woodDark, 1.12));
  b.kit('palace.corridor', 1, 3.0);
}

/**
 * 广场南院墙：太和门两侧的宫墙（x 48 → 147.5，z = −3104），中间是太和门，两翼各开一道侧门
 * （昭德门 / 贞度门的位置）。没有这道墙，太和殿广场南边就是敞的——从午门一路看进去毫无遮挡，
 * 那才是「空旷」的根源；故宫从午门看进去只见门、墙与墙后的殿顶。
 */
function palaceCourtWall(b: Baker, sx: number): void {
  const z = -3104, x0 = 48, x1 = 147.5;
  const L = x1 - x0, cx = (sx * (x0 + x1)) / 2;
  // 石基 + 朱墙 + 琉璃压顶
  b.box('ash', L, 1.0, 3.4, cx, 0.5, z, 0x8b877b);
  b.box('wall', L, 5.4, 2.9, cx, 3.7, z, PAL_RED);
  b.box('roof', L + 1.4, 0.55, 3.6, cx, 6.68, z, shade(PAL_TILE, 1.02));
  b.box('roof', L + 1.8, 0.16, 3.9, cx, 6.36, z, shade(PAL_TILE, 0.74));
  // 壁柱 + 石柱头（8m 一柱，和宫墙同一节奏）
  for (let p = x0 + 4; p < x1; p += 8) {
    b.box('wall', 0.8, 5.7, 3.3, sx * p, 3.55, z, shade(PAL_RED, 0.9));
    b.box('ash', 1.0, 0.28, 3.5, sx * p, 6.4, z, PAL_MARBLE);
  }
  // 侧门：12m 净宽的门洞 + 门楼（重檐太小，这里单檐歇山 + 金脊）
  // 暗腔在墙厚中线，朱扉压在它南面 0.55m —— 旧版只有一块 12×5 的裸暗板嵌在墙里，读作一块黑板
  const gx = sx * 96;
  b.box('lacquer', 12, 5.0, 0.6, gx, 2.5, z, 0x1a1416);
  for (const s of [-1, 1]) {
    b.box('lacquer', 5.6, 4.8, 0.24, gx + s * 3.1, 2.5, z + 0.55, shade(0x7a1f1a, 1.04));
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) {
      b.box('metal', 0.16, 0.16, 0.08, gx + s * (1.0 + c * 1.9), 0.9 + r * 0.9, z + 0.7, 0xd8b028);
    }
  }
  for (const t of [-1, 1]) {
    b.box('wall', 1.0, 7.2, 3.4, gx + t * 7, 3.6, z, shade(PAL_RED, 0.96));
    b.box('ash', 1.4, 0.3, 3.8, gx + t * 7, 7.35, z, PAL_MARBLE);
  }
  roofOnCapped(b, 22, 8.0, 7.5, gx, z, 0, shade(PAL_GOLD_D, 1.12), undefined, 3.4);
  b.box('metal', 0.34, 0.44, 0.34, gx, 9.6, z, 0xd8b028);
  for (const t of [-1, 1]) b.box('glow', 0.4, 0.5, 0.4, gx + t * 8.6, 6.0, z + 2.0, C.lantern);
  b.kit('palace.court.wall', 1, 7.2);
}

/** R14 广场总装：金砖 → 院墙 → 庑房 → 值房 → 陈设（覆盖率同时落 kit，探针可读） */
function buildPalaceCourt(b: Baker): void {
  palacePavingJoints(b);                                   // 0.9m 分级砖缝（程序化色带，零几何）
  palaceCourtPaving(b, PALACE_COURT.z1, PALACE_COURT.z0);  // 太和门 → 太和殿
  palaceCourtPaving(b, -2982, -3056, 84);                  // 午门内：南端起于御沟以北，宽度收到 ±84（值房 |x|=64 落在铺装边上）
  for (const sx of [-1, 1]) palaceCourtWall(b, sx);
  for (const sx of [-1, 1]) palaceCourtVeranda(b, sx, PALACE_COURT.z1, COURT_VERANDA_Z0, COURT_BAY);
  for (const sx of [-1, 1]) palaceDutyRooms(b, sx);
  palaceCourtFurnish(b);
  // R27：丹陛广场两侧仪仗陈设（旗幡 / 花坛 / 宫树 / 丹陛石雕 / 铜鹤香炉），中轴留空
  palaceCourtFurnishR27(b);
  // R28：8 组彩色仪仗方阵（800 根幡 / 伞盖 / 甲仗），远景俯瞰读成朝会班列的彩色条带
  palaceCourtArrayR28(b);
  // 午门内广场（前庭）：御路石 / 日晷 / 嘉量 / 铜龟 / 铜鹤 / 品级山两列——只加地面陈设，不加有顶建筑
  palaceFrontFurnish(b);
  // 千分比：928 = 92.8%
  b.kit('palace.court.coverage', Math.round(PALACE_COURT_COVERAGE.ratio * 1000), 0.18);
}

/**
 * 六、东西六宫：每侧 3 列 × 2 进 = 6 院（共 12 院），每院 = 院墙 + 琉璃门 + 正殿 + 东西配殿 + 陈设。
 * 院心 120×96、列距 150、行距 118；|x| 从 420 到 870，全在三大殿两厢之外。
 */
function buildSixPalaces(b: Baker): void {
  const W = 120, D = 96;
  let n = 0;
  for (const sx of [-1, 1]) {
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 2; row++) {
        // R24：列距 150 不变，整排东移 50m（450→500）：西侧让出 310–430 给后寝御花园，
        // 与园墙留 10m 夹道；东缘 860，与宫墙内皮 1098.7 之间仍有 238m 给值房院群。
        const cx = sx * (500 + col * 150);
        const cz = -3820 - row * 118;
        const salt = sx * 100 + col * 10 + row;
        // 院墙（南墙留 9m 门洞）
        for (const s of [-1, 1]) {
          const wSeg = s < 0 ? [W / 2 - 5, W / 2] : [-W / 2, W / 2 - 5];
          b.box('wall', wSeg[1] - wSeg[0], 5.2, 1.5, cx + (wSeg[0] + wSeg[1]) / 2, 2.6, cz + s * D / 2, PAL_RED);
          b.box('roof', wSeg[1] - wSeg[0] + 1.2, 0.46, 2.3, cx + (wSeg[0] + wSeg[1]) / 2, 5.42, cz + s * D / 2, PAL_TILE);
          b.box('wall', 1.5, 5.2, D, cx + s * W / 2, 2.6, cz, PAL_RED);
          b.box('roof', 2.3, 0.46, D + 1.2, cx + s * W / 2, 5.42, cz, PAL_TILE);
        }
        // 琉璃门：门洞暗腔退到门扇之后（旧版 5×4.4 暗板贴在门脸上、前面没有门扇，读作一块黑板）
        b.box('wall', 10, 6.4, 2.0, cx, 3.2, cz + D / 2, shade(PAL_RED, 1.06));
        b.box('lacquer', 5.0, 4.4, 0.3, cx, 2.2, cz + D / 2 + 0.55, 0x1a1416);
        for (const s of [-1, 1]) b.box('lacquer', 2.3, 4.1, 0.22, cx + s * 1.2, 2.15, cz + D / 2 + 0.78, shade(0x7a1f1a, 1.04));
        for (let r = 0; r < 4; r++) for (const s of [-1, 1]) {
          for (let c = 0; c < 2; c++) b.box('metal', 0.14, 0.14, 0.08, cx + s * (0.45 + c * 1.35), 1.1 + r * 0.95, cz + D / 2 + 0.9, 0xd8b028);
        }
        roofOnCapped(b, 13, 5.0, 6.5, cx, cz + D / 2, 0, shade(PAL_GOLD, 1.02), undefined, 2.2);
        // 正殿：42×22，单檐歇山，前檐开敞
        const hz = cz - 14;
        b.box('wall', 50, 1.0, 30, cx, 0.5, hz, shade(PAL_MARBLE, 0.9));
        b.box('ash', 51, 0.16, 31, cx, 1.06, hz, PAL_MARBLE);
        b.box('ground', 41, 0.2, 21, cx, 1.16, hz, shade(0x8a7a62, 1.02));
        b.box('wall', 42, 6.4, 1.2, cx, 1.2 + 3.2, hz - 10.4, shade(PAL_RED, 0.96));
        for (const s of [-1, 1]) b.box('wall', 1.2, 6.4, 21, cx + s * 20.4, 4.4, hz, shade(PAL_RED, 0.98));
        for (let i = 0; i <= 6; i++) b.box('wood', 0.9, 6.4, 0.9, cx - 21 + i * 7, 4.4, hz + 9.9, 0xd8b028);
        for (let i = 0; i < 6; i++) {
          const lx = cx - 21 + 7 * (i + 0.5);
          // 明间两间做板门（旧版是两块 6.2×4.8 的纯暗板，夹在四樘亮窗中间 = 两个黑窟窿）
          if (i === 2 || i === 3) {
            b.box('lacquer', 6.2, 4.8, 0.2, lx, 3.6, hz + 9.95, 0x1a1416);
            for (const s of [-1, 1]) b.box('lacquer', 2.9, 4.5, 0.22, lx + s * 1.55, 3.5, hz + 10.12, shade(0x7a1f1a, 1.04));
            for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
              for (const s of [-1, 1]) b.box('metal', 0.15, 0.15, 0.08, lx + s * (0.55 + c * 1.5), 1.8 + r * 0.95, hz + 10.26, 0xd8b028);
            }
          } else litBay(b, lx, 1.9, 4.6, 4.0, hz + 10.0);
        }
        dougongBand(b, cx, 7.9, hz + 10.2, 41, 0, 0xd8b028);
        roofOnCapped(b, 52, 30, 8.0, cx, hz, 0, shade(PAL_GOLD, 0.94), undefined, 5.4);
        b.box('roof', 26, 0.6, 1.0, cx, 13.2, hz, 0xd8b028);
        // 东西配殿：14×30
        for (const s of [-1, 1]) {
          const px = cx + s * 44;
          b.box('wall', 15, 0.8, 32, px, 0.4, cz - 6, shade(PAL_MARBLE, 0.88));
          b.box('wall', 13, 4.6, 30, px, 2.7, cz - 6, shade(PAL_RED, 0.9));
          for (let i = 0; i < 3; i++) litBay(b, px - s * 6.5, 1.6, 4.0, 2.6, cz - 18 + i * 12, Math.PI / 2);
          roofOnCapped(b, 17, 34, 5.0, px, cz - 6, 0, shade(PAL_GOLD_D, 0.98), undefined, 3.4);
        }
        // 院内：石灯一对 + 陈设（由 architecture 的 furnishCourt 落宝座/屏风/香炉/宫灯/地毯/案几）
        for (const s of [-1, 1]) {
          b.box('ash', 0.7, 0.3, 0.7, cx + s * 16, 1.4, cz + D / 2 - 6, PAL_STONE);
          b.box('ash', 0.24, 3.2, 0.24, cx + s * 16, 3.1, cz + D / 2 - 6, PAL_MARBLE);
          b.box('glow', 0.4, 0.46, 0.4, cx + s * 16, 4.9, cz + D / 2 - 6, C.winGlow);
        }
        furnishCourt(b, cx, hz + 3.0, 1.26, salt);
        n++;
      }
    }
  }
  b.kit('palace.court', n, 4);
  // 御花园：旧版这里只有一块 150×170 草绿平板 + 一座小方亭 + 6 个树球。
  // 现在由 palaceGrounds.palaceGardenSide 在两处做完整御花园（120×160，各 6 亭 / 3 楼 / 2 台 +
  // 假山 / 水池 / 曲桥 / 花木），本函数不再重复落件。
}

/** 七、宫城角楼：四角各一座「台 + 重檐十字脊」小楼（14m） */
function buildPalaceCorner(b: Baker, x: number, z: number): void {
  b.box('ash', 17, 2.2, 17, x, 1.1, z, 0x8b877b);
  b.box('wall', 14, 7.4, 14, x, 5.9, z, shade(PAL_RED, 0.96));
  for (const s of [-1, 1]) {
    b.box('glow', 3.0, 3.0, 0.2, x, 6.4, z + s * 7.1, C.winGlow);
    b.box('glow', 0.2, 3.0, 3.0, x + s * 7.1, 6.4, z, C.winGlow);
  }
  b.box('ash', 15.6, 0.4, 15.6, x, 9.8, z, 0x9c9a90);
  roofOnCapped(b, 19, 19, 10.0, x, z, 0, shade(PAL_GOLD, 0.98), undefined, 4.4);
  b.box('wall', 8.4, 4.6, 8.4, x, 14.2, z, shade(PAL_RED, 1.0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.box('glow', 2.0, 2.6, 0.18, x + Math.sin(a) * 4.3, 14.4, z + Math.cos(a) * 4.3, C.winGlow, a);
  }
  b.box('ash', 9.6, 0.3, 9.6, x, 16.6, z, 0x9c9a90);
  b.cyl('roof', 0.18, 7.4, 3.6, 4, x, 18.55, z, shade(PAL_GOLD, 1.06), Math.PI / 4);
  b.cyl('metal', 0.24, 0.34, 0.8, 8, x, 20.9, z, 0xd8b028);
  b.box('glow', 0.3, 0.3, 0.3, x, 21.4, z, C.neonGold);
  b.kit('palace.corner', 1, 12);
}

/** 八、庑房连廊：贴东西宫墙各 4 段（不通长），另加轴线两侧连接六宫的短廊 */
function buildPalaceCorridors(b: Baker): void {
  const SEG: [number, number][] = [[-3000, -3220], [-3300, -3540], [-3620, -3800], [-3860, -3980]];
  for (const s of [-1, 1]) {
    for (const [zS, zN] of SEG) {
      const L = zS - zN, cz = (zS + zN) / 2;
      const fx = s * 1091.8;
      b.box('ash', 8.0, 0.45, L + 2.4, s * 1095.2, 0.225, cz, 0x938c7c);
      b.box('wall', 0.5, 4.85, L + 2.0, s * 1098.85, 2.875, cz, shade(PAL_RED, 0.92));
      for (const e of [-1, 1]) b.box('wall', 7.8, 4.6, 0.6, s * 1095.2, 2.75, cz + e * (L / 2 + 0.9), shade(PAL_RED, 0.9));
      const n = Math.round(L / 4);
      for (let i = 0; i <= n; i++) {
        const zz = zS - (L * i) / n;
        b.box('wood', 0.42, 4.1, 0.42, fx, 2.5, zz, shade(C.woodRed, 0.95));
        b.box('ash', 0.72, 0.28, 0.72, fx, 0.59, zz, PAL_MARBLE);
      }
      b.box('wood', 0.36, 0.55, L + 2.0, fx, 4.62, cz, shade(C.woodDark, 1.2));
      b.box('roof', 9.4, 0.42, L + 2.2, s * 1094.7, 5.08, cz, shade(PAL_TILE, 1.04), 0, 0, s * 0.11);
      b.box('roof', 0.62, 0.5, L + 2.2, s * 1090.4, 4.52, cz, shade(PAL_TILE, 0.7));
      b.box('roof', 0.9, 0.5, L + 2.2, s * 1099.0, 5.72, cz, shade(PAL_TILE, 1.08));
      for (let zz = zS - 12; zz > zN; zz -= 26) b.box('glow', 0.5, 0.2, 0.5, s * 1094, 4.28, zz, C.winGlow);
      b.kit('palace.corridor', 1, 3.4);
    }
  }
  // 六宫与中轴之间的短廊（旧版 |x|=388、z −3770…−3920 两段）已删：
  // R24 把后寝御花园放在 |x| 294–436 / z −3720…−3880，这条 6.4m 宽的瓦顶长条正好从园子正中穿过，
  // 俯视读成"一条管子架在花园上"。六宫与中轴的连系改由园墙两侧的夹道承担。
}

/** 九、御沟与汉白玉石栏：宫墙中线外 24m 一圈，8m 水面 + 两岸石压顶 + 过沟石桥（南午门 / 北神武门） */
function buildPalaceMoat(b: Baker): void {
  const RS = PALACE.z1 - 24;   // −2974
  const RN = PALACE.z0 + 24;   // −3976
  const RX = PAL_X + 24;       // 1124
  const TD = 19.5, TW = 17.9;
  palSlab(b, 'ground', 2244, TD, 0, PAL_S + TD / 2, 0.06, 0x7d7462);
  palSlab(b, 'ground', 2244, TD, 0, PAL_N - TD / 2, 0.06, 0x7d7462);
  palSlab(b, 'ground', TW, PAL_S - PAL_N, -1109.75, PAL_CZ, 0.06, 0x7d7462);
  palSlab(b, 'ground', TW, PAL_S - PAL_N, 1109.75, PAL_CZ, 0.06, 0x7d7462);
  b.box('water', 2256, 1.0, 8, 0, -0.08, RS, 0x14405c);
  b.box('water', 2256, 1.0, 8, 0, -0.08, RN, 0x14405c);
  b.box('water', 8, 1.0, 1046, -RX, -0.08, PAL_CZ, 0x14405c);
  b.box('water', 8, 1.0, 1046, RX, -0.08, PAL_CZ, 0x14405c);
  b.kit('water.canal', 4, 0.42);
  for (const d of [-4.65, 4.65]) {
    b.box('ash', 2262, 1.1, 1.3, 0, -0.05, RS + d, shade(PAL_STONE, 1.02));
    b.box('ash', 2262, 1.1, 1.3, 0, -0.05, RN + d, shade(PAL_STONE, 1.02));
    b.box('ash', 1.3, 1.06, 1052, RX + d, -0.07, PAL_CZ, shade(PAL_STONE, 0.98));
    b.box('ash', 1.3, 1.06, 1052, -RX + d, -0.07, PAL_CZ, shade(PAL_STONE, 0.98));
  }
  palRail(b, true, RS + 4.65, -1126, 1126, 0.5, (p) => Math.abs(p) < 26);
  palRail(b, true, RN - 4.65, -1126, 1126, 0.5, (p) => Math.abs(p) < 26);
  palRail(b, false, RX + 4.65, RN + 6, RS - 6, 0.46, () => false);
  palRail(b, false, -RX - 4.65, RN + 6, RS - 6, 0.46, () => false);
  // 过沟石桥：南（午门御路）+ 北（神武门御路）
  for (const bz of [RS, RN]) {
    b.box('ash', 46, 0.4, 13.6, 0, 0.26, bz, 0xa39b8a);
    for (const s of [-1, 1]) {
      b.box('ash', 0.55, 0.95, 13.6, s * 22.4, 0.93, bz, PAL_MARBLE);
      for (const k of [-5.2, -1.7, 1.7, 5.2]) b.box('ash', 0.5, 1.24, 0.5, s * 22.4, 1.07, bz + k, PAL_MARBLE);
    }
  }
  b.kit('palace.moat', 1, 0.42);
}

/** 石栏：6m 一柱望柱 + 柱间栏板与寻杖；skip 为真处断开（桥口） */
function palRail(b: Baker, alongX: boolean, fixed: number, a0: number, a1: number, y0: number, skip: (p: number) => boolean): void {
  const n = Math.max(1, Math.round((a1 - a0) / 6));
  const step = (a1 - a0) / n;
  const put = (p: number, along: number, thick: number, h: number, y: number, hex: number): void => {
    b.box('ash', alongX ? along : thick, h, alongX ? thick : along, alongX ? p : fixed, y, alongX ? fixed : p, hex);
  };
  for (let i = 0; i <= n; i++) {
    const p = a0 + i * step;
    if (skip(p)) continue;
    put(p, 0.46, 0.46, 1.3, y0 + 0.65, PAL_MARBLE);
    if (i === n || skip(p + step)) continue;
    put(p + step / 2, step - 0.5, 0.2, 0.8, y0 + 0.4, shade(PAL_MARBLE, 0.94));
    put(p + step / 2, step - 0.34, 0.34, 0.22, y0 + 1.0, PAL_MARBLE);
  }
}

// ============ R5 宫前 / 宫后商业街 ============
const SHOP_WALL_C = [0x8a7a68, 0x9a8a72, 0x7d6f5e, 0x8f8272, 0x9a7f68];
const SHOP_ROOF_C = [0x333a45, 0x2a2f36, 0x4a3a2c, 0x3a4a42];
const SHOP_FLAG_C = [0x9d2933, 0x2a5c42, 0xa87a2a, 0x5c1b24, 0x24483a];

/**
 * 一间铺面（R5，与 riverbank.ts 同档密度）：面阔 8–13m、进深 10–13m、1–2 层，
 * 台基 + 双坡瓦顶 + 板门 + 两扇窗 + 柜台 + 两侧幌子 + 檐下灯。
 * sgn=+1 建在中轴东侧（正面朝 −x），−1 为西侧；xFace 是临街面到中轴的距离。
 */
function palaceShop(b: Baker, sgn: number, xFace: number, z0: number, w: number, depth: number, floors: number, salt: number, src: string): void {
  const xc = sgn * (xFace + depth / 2);
  const zc = z0 + w / 2;
  const wallC = SHOP_WALL_C[(wardHash(salt, 7, 11) * SHOP_WALL_C.length) | 0];
  const roofC = SHOP_ROOF_C[(wardHash(salt, 13, 17) * SHOP_ROOF_C.length) | 0];
  const flagC = SHOP_FLAG_C[(wardHash(salt, 19, 23) * SHOP_FLAG_C.length) | 0];
  const h = floors === 2 ? 6.6 + wardHash(salt, 29, 31) * 1.4 : 3.9 + wardHash(salt, 37, 41) * 1.2;
  // 台基与地坪
  b.box('ash', depth + 1.4, 1.0, w + 1.2, xc, 0.1, zc, shade(wallC, 0.84));
  // R24：旧实现是实心墙盒（16×5×10 那类空壳的同类问题），从街上看不到任何店内经营用品。
  // 改成薄壁壳 + 明间对街开敞（与 centralbelt 临街排同法），行业经营用品陈设才可见。
  const TW = 0.5, gy0 = 0.6;                 // 台基顶 = 室内地坪
  b.box('wall', TW, h, w, sgn * (xFace + depth - TW / 2), gy0 + h / 2, zc, wallC);           // 背墙（远街侧）
  for (const sz of [-1, 1])
    b.box('wall', depth - TW * 2, h, TW, xc, gy0 + h / 2, zc + sz * (w / 2 - TW / 2), wallC); // 两山墙
  const openW = Math.min(w * 0.62, 7.0);     // 明间开敞净宽
  const pier = Math.max(0.2, (w - openW) / 2), doorH = 2.7;
  b.box('wall', TW, h - doorH, w, sgn * (xFace + TW / 2), gy0 + doorH + (h - doorH) / 2, zc, wallC); // 门楣过梁
  for (const sz of [-1, 1])
    b.box('wall', TW, doorH, pier, sgn * (xFace + TW / 2), gy0 + doorH / 2, zc + sz * (w / 2 - pier / 2), wallC); // 两端墙垛
  // 双坡瓦顶（脊沿街）
  const rh = 1.1 + w * 0.05;
  const half = depth / 2 + 0.65;
  for (const sx of [-1, 1]) {
    b.box('roof', half * 1.06, 0.2, w + 1.0, xc + sx * half * 0.5, 0.6 + h + rh * 0.5, zc, roofC, 0, 0, -sx * 0.30);
  }
  b.box('roof', 0.5, 0.26, w + 1.05, xc, 0.6 + h + rh, zc, shade(roofC, 1.3));
  // 两端山花：两块斜板之间在 ±z 端头是敞口三角腔
  {
    const hw = half * 1.06;
    const cy = 0.6 + h + rh * 0.5;
    const dy = Math.sin(0.30) * hw * 0.5;
    const halfSpan = (half / 2 - 0.2) + (half / 2) * Math.cos(0.30);
    for (const e of [-1, 1] as const) {
      gableEnd(b, 'wall', xc, cy - dy, zc + e * (w / 2 + 0.42), 0, halfSpan, dy * 2, shade(wallC, 0.96));
    }
  }
  // 二层挑台
  if (floors === 2) {
    b.box('wood', 1.1, 0.18, w * 0.92, sgn * (xFace - 0.45), 4.1, zc, shade(0x6b4a2b, 1.05));
    for (let k = 0; k < 4; k++) b.box('wood', 0.12, 0.7, 0.12, sgn * (xFace - 0.95), 4.45, zc - w * 0.36 + k * w * 0.24, 0x4a3220);
    for (let k = 0; k < 2; k++) b.box('glow', 0.12, 1.5, 2.2, sgn * (xFace - 0.02), 5.2, zc - w * 0.2 + k * w * 0.4, C.winGlow);
  }
  // 板门双扇推开到两侧（营业时段敞开），明间居中让出净空；否则整扇实心板门会把刚摆好的
  // 行业经营用品挡在后面，从街面依旧只看见一块黑板。窗 + 柜台仍在临街面。
  const leafW = Math.min(w * 0.2, 2.0);
  for (const sd of [-1, 1]) {
    b.box('wood', 0.16, 2.3, leafW, sgn * (xFace + 0.06), 1.75,
      zc + sd * (openW / 2 - leafW / 2), 0x3a2418);
  }
  for (const s of [-1, 1]) b.box('glow', 0.12, 1.5, 2.2, sgn * (xFace + 0.03), 2.2, zc + s * w * 0.3, 0xffd8a0);
  b.box('wood', 0.9, 0.9, w * 0.5, sgn * (xFace - 0.55), 1.05, zc, shade(wallC, 1.12));
  b.box('wood', 1.0, 0.12, w * 0.52, sgn * (xFace - 0.55), 1.53, zc, shade(0x8a6a3a, 1.1));
  // 幌子：临街一根挑杆 + 布幌（两面）
  const pz = zc + w * 0.44;
  b.box('wood', 0.12, 3.0, 0.12, sgn * (xFace - 0.35), 2.2, pz, C.woodDark);
  b.box('fabric', 0.9, 1.1, 0.07, sgn * (xFace - 0.1), 2.9, pz, flagC);
  b.box('fabric', 0.07, 1.1, 0.9, sgn * (xFace - 0.35), 2.9, pz - sgn * 0.45, flagC);
  // 檐下灯
  b.box('glow', 0.24, 0.32, 0.24, sgn * (xFace - 0.25), 0.6 + h - 0.25, zc - w * 0.34, 0xffb84a);
  // 货担 / 箩筐（街面）
  b.cyl('wood', 0.34, 0.28, 0.44, 10, sgn * (xFace - 1.35), 0.82, zc - w * 0.3, 0x8a6a3a);
  b.box('fabric', 0.7, 0.3, 0.7, sgn * (xFace - 1.9), 0.75, zc + w * 0.28, shade(flagC, 0.9));
  // R24：行业经营用品 + 家具/摆设/装饰/饰品/日常用品（全城 8 业态 TRADE_KIT + 起居层）。
  // 面阔沿 z、进深沿 x；门在近街侧（x=sgn*xFace），由门指向店内 = +sgn·x。
  // 业态/形态只走 pickTrade 坐标 hash，零共享 RNG；全部走 Baker 合批。
  const { trade, variant } = pickTrade(xc, zc);
  buildTradeInterior(b, {
    cx: xc, cz: zc,
    w: w - TW * 2 - 0.1, d: depth - TW * 2 - 0.1,
    y0: gy0, h: h - 0.1,
    trade, variant,
    ux: 0, uz: 1, vx: sgn, vz: 0,
    ceiling: false, compact: true, src,
  });
}

/**
 * 一条商业街：沿 z 铺两排铺面（sgn=±1），铺面间距 10.5–18m（实体夹道 2.2–5m）。
 * 同时铺临街石板（御街两侧各 20m），保证店面不悬在裸地形上。
 */
function buildPalaceStreet(b: Baker, z0: number, z1: number, kitId: string, src: string): number {
  const cz = (z0 + z1) / 2, len = Math.abs(z1 - z0);
  for (const s of [-1, 1]) b.box('ground', 20, 0.12, len, s * 23, 0.06, cz, shade(C.road, 1.04));
  let n = 0;
  for (const sgn of [-1, 1]) {
    let z = Math.min(z0, z1) + 2;
    const zEnd = Math.max(z0, z1) - 2;
    let k = 0;
    while (z < zEnd - 8) {
      const salt = Math.round(z) * 2 + (sgn > 0 ? 1 : 0) + k * 977;
      const w = 8 + wardHash(salt, 3, 51) * 5;                   // 面阔 8–13
      const gap = 2.2 + wardHash(salt, 5, 53) * 2.8;             // 夹道 2.2–5.0 → 中心距 10.2–18
      const depth = 10 + wardHash(salt, 9, 57) * 3;              // 进深 10–13
      const floors = wardHash(salt, 11, 59) > 0.68 ? 2 : 1;
      palaceShop(b, sgn, 19, z, w, depth, floors, salt, src);
      // R24 台账（真实计数）：该来源「全部店铺数」，与 interiors 落位侧 .stocked 可逐项断言相等
      b.kit(`shopint.src.${src}.all`, 1, 3);
      b.kit(kitId, 1, 3);
      n++;
      z += w + gap;
      k++;
    }
  }
  return n;
}

/** 宫前商业街（午门前 130m 广场之后，520m）：铺面数记 palace.shopFront */
function buildPalaceFrontStreet(b: Baker): void {
  const n = buildPalaceStreet(b, -2820, -2300, 'palace.shopFront', 'imperialFront');
  b.kit('palace.shopFront.total', n, 0);
  // 街口牌坊 + 街尾灯棚，让这条街有头有尾
  for (const z of [-2790, -2340]) {
    for (const s of [-1, 1]) {
      b.box('wood', 0.6, 7.0, 0.6, s * 18.5, 3.5, z, shade(C.woodRed, 1.0));
      b.box('glow', 0.4, 0.5, 0.4, s * 18.5, 7.4, z, C.neonGold);
    }
    b.box('wood', 38, 0.6, 0.7, 0, 6.8, z, shade(C.woodRed, 0.96));
    b.box('roof', 40, 1.1, 1.6, 0, 7.5, z, shade(PAL_TILE, 1.06));
  }
}

/** 宫后商业街（北御沟石栏以北，840m）：铺面数记 palace.shopBack */
function buildPalaceBackStreet(b: Baker): void {
  const n = buildPalaceStreet(b, -4060, -4900, 'palace.shopBack', 'imperialBack');
  b.kit('palace.shopBack.total', n, 0);
}

/** 神武门：北墙上的单门道门楼（宫后大街的西端有头） */
function buildShenwuGate(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const gz = PALACE.z0;
  b.box('ash', 54, 1.2, 26, 0, 0.6, gz, 0x8b877b);
  b.box('earth', 52, 10.4, 24, 0, 6.4, gz, shade(PAL_RED, 0.86));
  b.box('ash', 52.6, 0.4, 24.6, 0, 11.8, gz, 0x9a9282);
  b.box('lacquer', 11, 8.2, 0.5, 0, 4.3, gz + 12.1, 0x161417);
  for (const s of [-1, 1]) {
    b.box('lacquer', 5.0, 7.2, 0.4, s * 2.8, 3.8, gz + 12.4, shade(0x9a2a20, 1.02));
    // 门钉：背光面全黑时靠金钉才读得出"这是一对门"，不然整块门洞就是一枚黑洞
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      b.box('metal', 0.18, 0.18, 0.1, s * (0.9 + c * 1.5), 1.2 + r * 1.35, gz + 12.62, 0xd8b028);
    }
  }
  b.box('wood', 26, 0.5, 1.0, 0, 10.6, gz + 12.2, shade(C.woodDark, 1.1));
  b.box('wood', 22, 5.6, 12, 0, 14.6, gz, shade(PAL_RED, 0.98));
  for (let i = 0; i <= 4; i++) b.box('wood', 0.8, 5.6, 0.8, -10 + i * 5, 14.6, gz + 6.1, 0xd8b028);
  for (let i = 0; i < 3; i++) litBay(b, -7 + i * 7, 12.6, 4.0, 3.0, gz + 6.0);
  dougongBand(b, 0, 17.3, gz + 6.2, 20, 0, 0xd8b028);
  roofOnCapped(b, 30, 20, 17.5, 0, gz, 0, shade(PAL_GOLD, 1.02), undefined, 5.0);
  b.cyl('metal', 0.22, 0.32, 0.7, 8, 0, 22.2, gz, 0xd8b028);
  sg.quad(atlas.text('pal_shenwu', '神武門', 360, 100, { color: '#ffe9c8', glow: '#00e5ff', bg: 'rgba(10,14,22,0.9)', border: 'rgba(0,229,255,.7)', fontPx: 60 }),
    8, 2.4, 0, 12.9, gz + 12.6, 0);
  b.kit('palace.gate.shenwu', 1, 11.8);
}

// ============ R25：宫内补景（亭台楼阁 / 水榭 / 廊庑 / 花木 / 湖石 / 曲桥） ============
// 用户判词：「皇宫内亭台楼阁、花草树木、山水景观造型不足」。
// R24 的 palaceGrounds 把宫内空地填成了值房 / 庑房 / 院群等功能性房屋，另在 |x| 294–436、
// z −3880…−3720 做了两处完整御花园（本文件不重复落件、不修改 palaceGrounds）。
// 本层在那之外的**中轴仪制广场**（|x|<166，殿与殿之间的金砖院）补一组独立的园亭小品：
// 攒尖亭 / 廊庑花架 / 湖石 / 花圃 / 宫树，个别节点再带方池曲桥（水榭）。
// 落点由 scClear 逐点排除三大殿与寝殿台基包络、后寝院墙、门楼、中轴御路，**不与已有殿宇叠压**；
// 所有器件只叠在广场地面（方砖 / 金砖）层，与 R24 的鼎 / 缸 / 宫灯 / 树池同属院落陈设。
// 随机只读 wardHash 坐标 hash，不消耗共享 rng。
const SC_LEAF = 0x3f6a3c, SC_LEAF_W = 0x59793c, SC_TRUNK = 0x4a3524;
const SC_STONE = 0x8e8b7f, SC_STONE_D = 0x65625a;

function scTree(b: Baker, x: number, z: number, s: number, salt: number): void {
  const h = (5.4 + wardHash(x, z, salt) * 2.2) * s;
  b.cyl('trunk', 0.16 * s, 0.32 * s, h * 0.6, 6, x, h * 0.3, z, SC_TRUNK);
  const lc = shade(wardHash(x, z, salt + 1) < 0.5 ? SC_LEAF : SC_LEAF_W, 0.92 + wardHash(x, z, salt + 2) * 0.16);
  const cy = h * 0.72;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + wardHash(x, z, salt + 3 + i);
    const r = (1.35 + wardHash(x, z, salt + 9 + i) * 0.5) * s;
    b.sphere('leaf', r, 7, x + Math.cos(a) * r * 0.8, cy + (wardHash(x, z, salt + 15 + i) - 0.5) * 0.7 * s,
      z + Math.sin(a) * r * 0.8, lc, 0, 0, 0, 1.05, 0.8, 1.05);
  }
  b.sphere('leaf', 1.75 * s, 7, x, cy + 0.25 * s, z, lc, 0, 0, 0, 1.1, 0.78, 1.1);
  b.kit('palace.scenery.tree', 1, cy);
}

function scRockery(b: Baker, x: number, z: number, s: number, salt: number): void {
  b.box('ash', 3.4 * s, 0.32, 2.6 * s, x, 0.16, z, SC_STONE_D);
  for (let i = 0; i < 6; i++) {
    const a = wardHash(x, z, salt + i) * Math.PI * 2;
    const rr = (0.4 + wardHash(x, z, salt + 20 + i) * 1.2) * s;
    b.sphere('ash', (0.5 + wardHash(x, z, salt + 40 + i) * 0.7) * s, 6,
      x + Math.cos(a) * rr, 0.4 + wardHash(x, z, salt + 60 + i) * 1.9 * s, z + Math.sin(a) * rr * 0.7,
      shade(SC_STONE_D, 0.85 + wardHash(x, z, salt + 80 + i) * 0.3), 0, 0, 0, 1.2, 0.9, 1.1);
  }
  // R21 假山瀑布：主峰上一挂白水帘 + 峰下落水潭（山水景观造型，非空叠石）
  for (let i = 0; i < 3; i++) {
    b.box('water', 0.9 * s, (1.7 - i * 0.28) * s, 0.1, x - 0.5 * s + i * 0.55 * s,
      (1.9 - i * 0.2) * s, z - 0.6 * s, shade(0x4a8a90, 1.0 - i * 0.05));
  }
  b.box('water', 4.2 * s, 0.08, 2.4 * s, x, 0.36, z - 1.8 * s, 0x1d4d53);
  b.kit('palace.scenery.waterfall', 1, 1.6);
  b.kit('palace.scenery.rock', 1, 1.2);
}

function scFlowerBed(b: Baker, x: number, z: number, w: number, d: number, salt: number): void {
  b.box('earth', w, 0.16, d, x, 0.09, z, shade(0x6b5842, 1.04));
  const cols = [0xc2677a, 0xd8a24a, 0xd8d0b0, 0x9a6fb0];
  const n = Math.max(6, Math.round((w * d) / 3));
  for (let i = 0; i < n; i++) {
    b.sphere('leaf', 0.2 + wardHash(x + i, z, salt) * 0.16, 5,
      x + (wardHash(x, z + i, salt + 1) - 0.5) * (w - 0.4), 0.28 + wardHash(x, z, salt + 2 + i) * 0.14,
      z + (wardHash(x + i, z, salt + 3) - 0.5) * (d - 0.4),
      cols[(wardHash(x, z, salt + 5 + i) * cols.length) | 0], 0, 0, 0, 1, 0.8, 1);
  }
  // R21 花圃带廊架：花圃后缘两柱一横梁 + 攀藤（花圃不再是一块孤立的花毯）
  const bz = z + d / 2 + 0.6;
  for (const s of [-1, 1]) b.cyl('wood', 0.1, 0.13, 2.0, 5, x + s * (w / 2 - 0.3), 1.0, bz, shade(C.woodDark, 1.02));
  b.box('wood', w + 0.4, 0.12, 0.16, x, 2.05, bz, shade(C.wood, 1.06));
  for (let i = 0; i < 4; i++) b.sphere('leaf', 0.32, 5, x - w / 2 + (i + 0.5) * w / 4, 2.15, bz, shade(SC_LEAF_W, 1.02));
  b.kit('palace.scenery.flowerPergola', 1, 2.0);
  b.kit('palace.scenery.flower', 1, 0.3);
}

/** 攒尖小亭：台明 + 柱 + 阑额 + 攒尖顶 + 宝顶 + 亭内石桌凳 */
function scPavilion(b: Baker, x: number, z: number, r: number, sides: 4 | 6, ry: number, salt: number): void {
  const deck = 0.42, colH = 2.7;
  const tile = shade(PAL_TILE, 1.16 + wardHash(x, z, salt) * 0.16);
  b.box('ash', r * 2 + 1.6, 0.3, r * 2 + 1.6, x, 0.15, z, PAL_MARBLE, ry);
  b.box('ash', r * 2 + 1.2, 0.14, r * 2 + 1.2, x, 0.37, z, shade(PAL_MARBLE, 1.06), ry);
  const pts: [number, number][] = [];
  if (sides === 4) {
    const c = Math.cos(Math.PI / 4) * r * 1.06;
    const ring: [number, number][] = [[c, c], [c, -c], [-c, -c], [-c, c]];
    for (const [ox, oz] of ring) {
      pts.push([x + ox * Math.cos(ry) + oz * Math.sin(ry), z - ox * Math.sin(ry) + oz * Math.cos(ry)]);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const a = ry + (i / 6) * Math.PI * 2;
      pts.push([x + Math.sin(a) * r, z + Math.cos(a) * r]);
    }
  }
  for (const [px, pz] of pts) b.cyl('wood', 0.13, 0.16, colH, 7, px, deck + colH / 2, pz, shade(C.woodRed, 0.94));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c2 = pts[(i + 1) % pts.length];
    const dx = c2[0] - a[0], dz = c2[1] - a[1];
    b.box('wood', Math.hypot(dx, dz), 0.2, 0.16, (a[0] + c2[0]) / 2, deck + colH - 0.1, (a[1] + c2[1]) / 2,
      shade(C.woodDark, 1.06), Math.atan2(-dz, dx));
  }
  const roofY = deck + colH;
  b.cyl('roof', r + 1.1, r + 1.45, 0.28, sides, x, roofY, z, tile, ry);
  b.cyl('roof', 0.28, r + 1.35, 1.9, sides, x, roofY + 1.05, z, shade(tile, 1.06), ry);
  b.sphere('ceramic', 0.26, 8, x, roofY + 2.2, z, 0xd8c48a);
  b.cyl('ash', 0.5, 0.56, 0.12, 10, x, deck + 0.66, z, PAL_MARBLE);
  b.cyl('ash', 0.2, 0.26, 0.56, 8, x, deck + 0.32, z, SC_STONE_D);
  for (const s of [-1, 1]) b.cyl('ash', 0.23, 0.25, 0.4, 8, x + s * 0.9, deck + 0.2, z + s * 0.18, SC_STONE);
  b.kit('palace.scenery.pavilion', 1, deck + colH);
}

/** R21 二层小楼阁：台明 + 一层柱墙 + 平座腰檐 + 二层柱墙 + 攒尖顶 + 宝顶（亭台楼阁类的「楼」） */
function scTower(b: Baker, x: number, z: number, salt: number): void {
  const tile = shade(PAL_TILE, 1.18 + wardHash(x, z, salt) * 0.12);
  b.box('ash', 7.6, 0.36, 6.4, x, 0.18, z, PAL_MARBLE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    b.cyl('wood', 0.15, 0.18, 3.0, 6, x + sx * 3.1, 1.9, z + sz * 2.6, shade(C.woodRed, 0.94));
  b.box('wall', 6.0, 2.6, 5.0, x, 1.7, z, shade(C.plaster2, 1.02));
  b.box('ash', 8.0, 0.2, 6.8, x, 3.4, z, shade(PAL_MARBLE, 1.04));
  b.box('roof', 9.2, 0.26, 8.0, x, 3.62, z, tile);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    b.cyl('wood', 0.12, 0.15, 2.2, 6, x + sx * 2.3, 4.7, z + sz * 1.9, shade(C.woodRed, 0.96));
  b.box('wall', 4.4, 1.9, 3.6, x, 4.6, z, shade(C.plaster2, 1.0));
  b.box('roof', 6.8, 0.22, 6.0, x, 5.8, z, shade(tile, 1.06));
  b.cyl('roof', 0.26, 3.9, 1.7, 4, x, 6.7, z, shade(tile, 1.12), Math.PI / 4);
  b.sphere('ceramic', 0.24, 8, x, 7.75, z, 0xd8c48a);
  b.kit('palace.scenery.tower', 1, 6.0);
}

/** 廊庑花架：一列柱 + 单坡瓦顶 + 攀藤 */
function scPergola(b: Baker, x: number, z: number, len: number, ry: number, salt: number): void {
  const n = Math.max(3, Math.round(len / 3.2));
  const cs = Math.cos(ry), sn = Math.sin(ry);
  for (let i = 0; i <= n; i++) {
    const t = (i / n - 0.5) * len;
    b.cyl('wood', 0.13, 0.16, 2.5, 6, x + t * cs, 1.25, z - t * sn, shade(C.woodDark, 1.0));
  }
  b.box('roof', len + 1.2, 0.2, 2.9, x, 2.62, z, shade(PAL_TILE, 1.16), ry);
  b.box('wood', len, 0.12, 0.14, x, 2.45, z, shade(C.wood, 1.04), ry);
  for (let i = 0; i < 8; i++) {
    const t = (wardHash(x, z, salt + i) - 0.5) * len;
    b.sphere('leaf', 0.45 + wardHash(x, z, salt + 20 + i) * 0.25, 5,
      x + t * cs, 2.7, z - t * sn + (wardHash(x, z, salt + 40 + i) - 0.5) * 2.2,
      shade(wardHash(x, z, salt + 60 + i) < 0.5 ? SC_LEAF : SC_LEAF_W, 1.0), 0, 0, 0, 1.1, 0.7, 1.1);
  }
  b.kit('palace.scenery.pergola', 1, 2.6);
}

/** 水榭：方池 + 石岸 + 荷叶 + 三段折线曲桥 */
function scWater(b: Baker, x: number, z: number, r: number, salt: number): void {
  b.box('ash', r * 2 + 2.4, 0.4, r * 2 + 2.4, x, 0.2, z, SC_STONE_D);
  b.box('water', r * 2, 0.1, r * 2, x, 0.42, z, 0x1d4d53);
  for (const s of [-1, 1]) {
    b.box('ash', r * 2 + 2.4, 0.3, 0.6, x, 0.5, z + s * (r + 0.9), PAL_MARBLE);
    b.box('ash', 0.6, 0.3, r * 2 + 2.4, x + s * (r + 0.9), 0.5, z, PAL_MARBLE);
  }
  for (let i = 0; i < 6; i++) {
    const a = wardHash(x, z, salt + i) * Math.PI * 2;
    const rr = r * (0.3 + wardHash(x, z, salt + 10 + i) * 0.55);
    b.cyl('leaf', 0.4, 0.4, 0.03, 7, x + Math.cos(a) * rr, 0.5, z + Math.sin(a) * rr, shade(SC_LEAF, 1.0));
  }
  for (let i = -1; i <= 1; i++) {
    const bz = z + (i === 0 ? r * 0.18 : -r * 0.18);
    b.box('ash', r * 0.9, 0.18, 1.8, x + i * r * 0.62, 0.62, bz, PAL_MARBLE, i * 0.24);
    for (const s of [-1, 1]) b.box('ash', 0.16, 0.5, 0.16, x + i * r * 0.62, 0.9, bz + s * 0.8, shade(PAL_MARBLE, 1.04));
  }
  // R21 水榭：池北岸四柱小榭（平台 + 柱 + 攒尖顶），与三段折线曲桥连成「水榭带曲桥」
  const wx = x, wz = z - r - 3.2;
  b.box('ash', r * 1.5, 0.24, 3.2, wx, 0.62, wz, PAL_MARBLE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    b.cyl('wood', 0.12, 0.15, 2.2, 6, wx + sx * r * 0.6, 1.75, wz + sz * 1.2, shade(C.woodRed, 0.96));
  b.box('roof', r * 1.8, 0.22, 4.2, wx, 3.0, wz, shade(PAL_TILE, 1.18));
  b.cyl('roof', 0.2, r * 0.95, 1.3, 4, wx, 3.7, wz, shade(PAL_TILE, 1.24), Math.PI / 4);
  b.kit('palace.scenery.waterPavilion', 1, 3.0);
  b.kit('palace.scenery.water', 1, 0.6);
}

/** 补景落位判据：只留仪制广场内、殿宇台基之外的地面（不碰御花园 / 六宫 / 门楼 / 御路） */
/**
 * R22 多带落位判据（世界口径）：补景节点不再只堆在中轴几条 z 线上，而是分落 4 类空地，
 * 每带各自排除已知建筑包络，逐点判定，绝不把殿宇 / 值房 / 官署 / 御花园亭楼盖住。
 *   带① 中轴仪制广场 |x|16–160：太和殿前院 / 三殿间院 / 后寝院两厢（沿用台基-门楼-御路避让）；
 *   带② 御花园中心隙地（园心 |x|365、z−3800）：只取 r<30 的中心，避开 6 亭(r34)/3 楼(r62)/水池/假山；
 *   带③ 宫墙内侧沿墙隙地 |x|1052–1096：避开 |x|1074 值房带与北墙内值房 z−3966；
 *   带④ 宫墙外侧隙地 |x|1104–1130：宫墙(1100)与官署(1132)之间的 26m 自由带。
 */
function scClear(x: number, z: number): boolean {
  const ax = Math.abs(x);
  if (z > -3000 || z < -3980) return false;
  // 带① 中轴仪制广场
  if (ax >= 16 && ax <= 160) {
    for (const [hz, hw, hd] of [[PALACE.taiheZ, 112, 52], [PALACE.zhongheZ, 80, 44], [PALACE.baoheZ, 100, 48], [-3840, 70, 40]] as const) {
      if (Math.abs(z - hz) < hd + 8 && ax < hw + 8) return false;   // 三大殿 / 寝殿台基包络
    }
    if (Math.abs(z + 3752) < 7) return false;                        // 后寝横院墙
    if (Math.abs(z + 3080) < 16 || Math.abs(z + 2960) < 20) return false; // 太和门 / 午门
    return true;
  }
  // 带② 御花园中心隙地
  if (ax >= 305 && ax <= 425 && z >= -3865 && z <= -3735) {
    const cx = x > 0 ? 365 : -365, cz = -3800;
    return Math.hypot(x - cx, z - cz) < 30;
  }
  // 带③ 宫墙内侧沿墙隙地
  if (ax >= 1052 && ax <= 1096) {
    if (ax > 1062 && ax < 1086) return false;                        // 值房带
    if (Math.abs(z + 3966) < 14) return false;                        // 北墙内一排值房
    return true;
  }
  // 带④ 宫墙外侧隙地
  if (ax >= 1104 && ax <= 1130) return true;
  return false;
}

/**
 * R22 扩容：**88 组**补景节点（旧 20 组），世界口径 x / z / 组合变体。
 * 不再只堆在中轴几条 z 线上，按 4 类空地分落（逐点过 scClear，全部 88/88 通过）：
 *   带① 中轴仪制广场 48 组（太和殿前院 / 三殿间院 / 后寝院两厢，|x| 34–152）；
 *   带② 御花园中心隙地 10 组（|x| 351–379，避开 6 亭/3 楼/水池/假山）；
 *   带③ 宫墙内侧沿墙隙地 16 组（|x| 1058 / 1090）；
 *   带④ 宫墙外侧隙地 14 组（|x| 1116）。
 * |x| 分布 34…1116、z 分布 −3900…−3010（23 个不同 z 值），覆盖御花园与宫墙内外。
 * variant 0–5 按 %3 分三类：0/3 亭台楼阁、1/4 花草树木、2/5 山水景观；侧带节点由 scCluster 只补成簇花木/山水，不放大亭楼。
 */
const SCENE_NODES: readonly (readonly [number, number, number])[] = [
  // 带① 中轴仪制广场（太和殿前院 / 三殿间院 / 后寝院两厢） — 48 组
  [-34, -3010, 0], [-96, -3010, 1], [-152, -3010, 2], [34, -3010, 3],
  [96, -3010, 4], [152, -3010, 5], [-34, -3040, 0], [-96, -3040, 1],
  [-152, -3040, 2], [34, -3040, 3], [96, -3040, 4], [152, -3040, 5],
  [-34, -3130, 0], [-96, -3130, 1], [-152, -3130, 2], [34, -3130, 3],
  [96, -3130, 4], [152, -3130, 5], [-34, -3170, 0], [-96, -3170, 1],
  [-152, -3170, 2], [34, -3170, 3], [96, -3170, 4], [152, -3170, 5],
  [-34, -3330, 0], [-96, -3330, 1], [-152, -3330, 2], [34, -3330, 3],
  [96, -3330, 4], [152, -3330, 5], [-34, -3400, 0], [-96, -3400, 1],
  [-152, -3400, 2], [34, -3400, 3], [96, -3400, 4], [152, -3400, 5],
  [-34, -3545, 0], [-96, -3545, 1], [-152, -3545, 2], [34, -3545, 3],
  [96, -3545, 4], [152, -3545, 5], [-34, -3615, 0], [-96, -3615, 1],
  [-152, -3615, 2], [34, -3615, 3], [96, -3615, 4], [152, -3615, 5],
  // 带② 御花园中心隙地（东西各一，避开 6 亭/3 楼/水池/假山） — 10 组
  [-365, -3800, 0], [-379, -3808, 1], [-351, -3808, 2], [-379, -3790, 3],
  [-351, -3790, 4], [365, -3800, 5], [351, -3808, 0], [379, -3808, 1],
  [351, -3790, 2], [379, -3790, 3],
  // 带③ 宫墙内侧沿墙隙地 — 16 组
  [-1058, -3040, 4], [-1090, -3160, 5], [-1058, -3280, 0], [-1090, -3400, 1],
  [-1058, -3520, 2], [-1090, -3640, 3], [-1058, -3760, 4], [-1090, -3880, 5],
  [1058, -3040, 0], [1090, -3160, 1], [1058, -3280, 2], [1090, -3400, 3],
  [1058, -3520, 4], [1090, -3640, 5], [1058, -3760, 0], [1090, -3880, 1],
  // 带④ 宫墙外侧隙地（墙与官署之间） — 14 组
  [-1116, -3060, 2], [-1116, -3200, 3], [-1116, -3340, 4], [-1116, -3480, 5],
  [-1116, -3620, 0], [-1116, -3760, 1], [-1116, -3900, 2], [1116, -3060, 3],
  [1116, -3200, 4], [1116, -3340, 5], [1116, -3480, 0], [1116, -3620, 1],
  [1116, -3760, 2], [1116, -3900, 3],
];

/**
 * R22 每节点成簇花木 + 山水景观造型：3 片成片花圃（自带廊架）+ 10 株成簇花木（聚成 3 个小簇）
 * + 3 处湖石群（叠石 + 瀑布水帘 + 落水潭）+ 一条曲水/方池，全部确定性 wardHash、零 RNG、全 Baker 合批。
 * 88 组节点**每一组**都调用，俯视能读到「满地花草树木」，不是均匀稀疏撒点。
 */
function scCluster(b: Baker, cx: number, cz: number, salt: number): void {
  const cols = [0xc2677a, 0xd8a24a, 0xd8d0b0, 0x9a6fb0, 0xb05a72];
  // 成片花圃 3 处（花圃自带后缘廊架）
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + wardHash(cx, cz, salt + i);
    const r = 5 + wardHash(cx, cz, salt + 10 + i) * 4;
    scFlowerBed(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 4.0, 2.6, salt + 20 + i);
  }
  // 成簇花木 10 株：聚成 3 个小簇（簇心距节点 6m、簇内半径 3–9m），花丛 / 灌木 / 乔木三选一
  for (let i = 0; i < 10; i++) {
    const cl = i % 3;
    const a = wardHash(cx, cz, salt + 100 + i) * Math.PI * 2;
    const rr = 3 + wardHash(cx, cz, salt + 200 + i) * 6;
    const ang = (cl / 3) * Math.PI * 2;
    const bx = cx + Math.cos(ang) * 6 + Math.cos(a) * rr;
    const bz = cz + Math.sin(ang) * 6 + Math.sin(a) * rr;
    const u = wardHash(cx, cz, salt + 300 + i);
    if (u < 0.5) {
      b.sphere('leaf', 0.5, 5, bx, 0.32, bz, shade(SC_LEAF_W, 1.04), 0, 0, 0, 1.2, 0.6, 1.2);
      b.sphere('leaf', 0.22, 5, bx + 0.3, 0.5, bz, cols[(wardHash(cx, cz, salt + 400 + i) * cols.length) | 0]);
    } else if (u < 0.8) {
      b.sphere('leaf', 0.8, 5, bx, 0.6, bz, shade(SC_LEAF, 1.02), 0, 0, 0, 1.2, 0.8, 1.2);
    } else {
      b.cyl('trunk', 0.12, 0.18, 1.9, 5, bx, 0.95, bz, SC_TRUNK);
      b.sphere('leaf', 1.4, 6, bx, 2.4, bz, shade(SC_LEAF, 1.0));
    }
  }
  // 湖石群 3 处（每处叠石 + 瀑布水帘 + 落水潭，构成山水景观造型）
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + wardHash(cx, cz, salt + 500 + i);
    scRockery(b, cx + Math.cos(a) * 8, cz + Math.sin(a) * 8,
      0.5 + wardHash(cx, cz, salt + 510 + i) * 0.3, salt + 520 + i);
  }
  // 曲水 / 方池：一条细长水带 + 两岸条石 + 三块汀步
  const wz = cz + 11;
  b.box('water', 12, 0.08, 1.4, cx, 0.10, wz, 0x1d4d53);
  for (const s of [-1, 1]) b.box('ash', 12.6, 0.16, 0.32, cx, 0.14, wz + s * 0.9, shade(SC_STONE_D, 1.02));
  for (let i = 0; i < 3; i++) b.box('ash', 0.8, 0.12, 1.6, cx - 3.6 + i * 3.6, 0.19, wz, shade(SC_STONE, 1.02));
  b.kit('palace.scenery.cluster', 1, 0.3);
  b.kit('palace.scenery.clusterFlower', 3, 0.3);
  b.kit('palace.scenery.clusterPlant', 10, 0.3);
  b.kit('palace.scenery.clusterRock', 3, 0.3);
  b.kit('palace.scenery.clusterWater', 1, 0.3);
}

/**
 * R22 宫苑补景总装：88 组节点。带①中轴（|x|≤160）按 variant % 3 做三类完整组合
 * （0/3 亭台楼阁：攒尖亭 + 二层小楼阁 + 廊架 + 湖石 + 花圃 + 宫树；
 *  1/4 花草树木：攒尖小亭 + 3 处带廊架花圃 + 树列；
 *  2/5 山水景观：水榭曲桥 + 假山瀑布 + 廊架 + 花圃 + 宫树）；
 * 带②③④（御花园 / 宫墙内外）只补 scCluster 小型成簇花木与山水，不放大亭楼以免叠压既有建筑；
 * 全部 88 组都叠一层 scCluster（3 片成片花圃 + 10 株成簇花木 + 3 处湖石群 + 一条曲水）。
 * 落点逐点过 scClear，随机只读 wardHash 整数坐标 hash，不消耗共享 rng；
 * 新增统计键 palace.scenery（每节点一个），保留 palace.scenery.node / .nodes 旧语义。
 */
function buildPalaceScenery(b: Baker): void {
  let n = 0;
  for (const [x0, z0, variant] of SCENE_NODES) {
    if (!scClear(x0, z0)) continue;
    const salt = (Math.round(x0) * 31 + Math.round(z0) * 17 + variant * 131) | 0;
    const px = x0 + (wardHash(x0, z0, salt) - 0.5) * 6;
    const pz = z0 + (wardHash(x0, z0, salt + 1) - 0.5) * 6;
    if (Math.abs(x0) <= 160) {
      const kind = variant % 3;
      if (kind === 0) {
        // 亭台楼阁：攒尖亭 + 二层小楼阁 + 廊架 + 湖石 + 花圃 + 宫树
        scPavilion(b, px, pz, 2.6 + wardHash(x0, z0, salt + 2) * 0.9,
          (variant % 2 === 0 ? 4 : 6) as 4 | 6, wardHash(x0, z0, salt + 3) * 0.6, salt + 10);
        scTower(b, x0 + (x0 > 0 ? -11 : 11), z0 - 10, salt + 12);
        scPergola(b, x0 + (x0 > 0 ? -8 : 8), z0 + 11, 12, Math.PI / 2, salt + 20);
        scRockery(b, x0 - 6, z0 - 9, 0.9 + wardHash(x0, z0, salt + 4) * 0.3, salt + 30);
        scFlowerBed(b, x0 + 5, z0 - 8, 5.5, 3.0, salt + 40);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + wardHash(x0, z0, salt + 50 + i);
          scTree(b, x0 + Math.cos(a) * 10, z0 + Math.sin(a) * 10, 0.85 + wardHash(x0, z0, salt + 60 + i) * 0.3, salt + 70 + i);
        }
      } else if (kind === 1) {
        // 花草树木：攒尖小亭 + 3 处花圃（花圃带廊架） + 6 株宫树
        scPavilion(b, px, pz, 2.2 + wardHash(x0, z0, salt + 2) * 0.6, 6, wardHash(x0, z0, salt + 3) * 0.6, salt + 10);
        scFlowerBed(b, x0 + 6, z0 - 9, 6.0, 3.2, salt + 40);
        scFlowerBed(b, x0 - 7, z0 + 7, 5.0, 2.8, salt + 45);
        scFlowerBed(b, x0 + 3, z0 + 12, 4.5, 2.6, salt + 48);
        scPergola(b, x0 + (x0 > 0 ? -8 : 8), z0, 11, Math.PI / 2, salt + 20);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + wardHash(x0, z0, salt + 50 + i);
          const rr = 8 + wardHash(x0, z0, salt + 60 + i) * 5;
          scTree(b, x0 + Math.cos(a) * rr, z0 + Math.sin(a) * rr, 0.8 + wardHash(x0, z0, salt + 70 + i) * 0.35, salt + 80 + i);
        }
      } else {
        // 山水景观：水榭曲桥 + 假山瀑布 + 廊架 + 花圃 + 宫树
        scWater(b, x0 + (x0 > 0 ? 9 : -9), z0 + 14, 4.2, salt + 90);
        scRockery(b, x0 - 7, z0 - 9, 1.0 + wardHash(x0, z0, salt + 4) * 0.3, salt + 30);
        scPergola(b, x0 + (x0 > 0 ? -8 : 8), z0 + 11, 10, Math.PI / 2, salt + 20);
        scFlowerBed(b, x0 + 5, z0 - 6, 5.0, 2.8, salt + 40);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + wardHash(x0, z0, salt + 50 + i);
          scTree(b, x0 + Math.cos(a) * 10, z0 + Math.sin(a) * 10, 0.85 + wardHash(x0, z0, salt + 60 + i) * 0.3, salt + 70 + i);
        }
      }
    }
    // 每节点成簇花木与山水景观造型：88 组全有（侧带节点的主要构件）
    scCluster(b, x0, z0, salt + 200);
    b.kit('palace.scenery', 1, 3.0);
    b.kit('palace.scenery.node', 1, 3.0);
    n++;
  }
  b.kit('palace.scenery.nodes', n, 0);
}

// ============ R21：宫城「满地花草树木」· 确定性成簇花木 ============
/**
 * 宫城空地成片花木：32 个簇心（16 个 z 行 × 东西两侧），每簇半径 24–40m、固定 20 株，
 * 合计 **640 株**（花丛 / 灌木 / 乔木三选一），按簇而不是均匀撒点。逐点过 floraClear 排除
 * 御道中轴、三大殿台基与丹陛礼制区、门楼、后寝横院墙、六宫、御花园核心圈、文华/武英合院、
 * 庑房带与值房带；随机只读 wardHash 坐标 hash，零共享 RNG，全部 Baker 合批。
 * 统计键 palace.groundFlora（簇数 32）/ palace.groundFlora.plant（株数 640）。
 */
function floraClear(x: number, z: number): boolean {
  const ax = Math.abs(x);
  if (ax < 18 || ax > 1080) return false;                       // 御道中轴 / 宫墙内
  if (z > -2980 || z < -3985) return false;                     // 宫城南北界内
  for (const [hz, hw, hd] of [[PALACE.taiheZ, 112, 52], [PALACE.zhongheZ, 80, 44], [PALACE.baoheZ, 100, 48], [-3840, 70, 40]] as const)
    if (Math.abs(z - hz) < hd + 10 && ax < hw + 10) return false;   // 三大殿 / 寝殿台基与丹陛礼制区
  if (Math.abs(z + 3080) < 20 || Math.abs(z + 2960) < 24) return false;  // 太和门 / 午门
  if (Math.abs(z + 3752) < 10 && ax < 170) return false;             // 后寝横院墙
  for (const sx of [-1, 1]) for (let col = 0; col < 3; col++) for (let row = 0; row < 2; row++) {
    const cx = sx * (500 + col * 150), cz = -3820 - row * 118;
    if (Math.abs(x - cx) < 54 && Math.abs(z - cz) < 42) return false;   // 东西六宫 12 院（R23 收窄，夹道可种）
  }
  // R23 放宽：御花园只保留核心亭楼水池圈，外围一圈可种（用户「皇宫内花草树木特别少」）
  if (ax > 320 && ax < 410 && z > -3860 && z < -3740) return false;
  if (ax > 465 && ax < 775 && ((z > -3345 && z < -3115) || (z > -3725 && z < -3515))) return false; // 文华/武英合院
  if (ax > 160 && ax < 185) return false;                          // 庑房带
  if (ax > 1055 && ax < 1092) return false;                        // 值房带
  return true;
}

/**
 * R23：旧版只写死 32 个簇心 × 20 株 = 640 株，铺在 1050×2160m 的宫城里，
 * 俯瞰与近景都「几乎看不见花草树木」。改成整宫城 90m 网格程序化簇心，
 * 逐点过 floraClear；簇数与株数由判据实算，台账 palace.groundFlora 记录真实值。
 */
function makeFloraClusters(): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let z = -3010; z >= -3970; z -= 90) {
    for (const sx of [-1, 1]) {
      for (let ax = 45; ax <= 1035; ax += 90) {
        const x = sx * ax;
        if (floraClear(x, z)) out.push([x, z] as const);
      }
    }
  }
  return out;
}
const FLORA_CLUSTERS: readonly (readonly [number, number])[] = makeFloraClusters();
const PLANTS_PER_CLUSTER = 24;

/** 一株宫苑花木：花丛 / 灌木 / 乔木三选一，全部低面数（sphere 5 段 + 短 cyl） */
function floraPlant(b: Baker, x: number, z: number, u: number, salt: number): void {
  // R23 第四轮：宫苑草皮抬到铺装顶面之上（0.302），花木同步抬 0.10，
  // 否则花丛下半截埋在 city_ash_9 的 0.24 铺装里，俯瞰只读成零星黑点。
  const L = 0.10;
  const cols = [0xc2677a, 0xd8a24a, 0xd8d0b0, 0x9a6fb0, 0xb05a72];
  if (u < 0.55) {
    // 花丛：一团矮叶 + 三粒花色小球
    b.sphere('leaf', 0.55, 5, x, L + 0.32, z, shade(SC_LEAF, 1.05), 0, 0, 0, 1.2, 0.6, 1.2);
    for (let i = 0; i < 3; i++) {
      const a = wardHash(x, z, salt + i) * Math.PI * 2;
      b.sphere('leaf', 0.2, 5, x + Math.cos(a) * 0.45, L + 0.5, z + Math.sin(a) * 0.45,
        cols[(wardHash(x, z, salt + 10 + i) * cols.length) | 0]);
    }
  } else if (u < 0.85) {
    // 灌木：一团压扁叶球 + 一粒花
    b.sphere('leaf', 0.85, 5, x, L + 0.62, z, shade(SC_LEAF_W, 1.02), 0, 0, 0, 1.2, 0.8, 1.2);
    b.sphere('leaf', 0.24, 5, x + 0.4, L + 0.9, z, cols[(wardHash(x, z, salt) * cols.length) | 0]);
  } else {
    // 乔木：短干 + 一团树冠
    b.cyl('trunk', 0.12, 0.18, 1.9, 5, x, L + 0.95, z, SC_TRUNK);
    b.sphere('leaf', 1.5, 6, x, L + 2.5, z, shade(SC_LEAF, 0.98 + wardHash(x, z, salt) * 0.12), 0, 0, 0, 1.05, 0.85, 1.05);
  }
}

/**
 * R23 第四轮：宫苑「连续绿毯」。
 * 根因（A/B 实拍 + Raycaster 实测）：宫城灰白铺装来自 city_ash_9（顶面 0.14 / 0.24），
 * 与 city_ground 无关；而旧版 208 个半径 20–32m 的孤立草块只覆盖宫城不到一成面积，
 * 所以 250m 俯瞰仍是一片灰白。这里按 30m 网格铺 9 点避让判据通过的连片草皮，
 * 并补「人眼尺度草叶 + 彩花 + 3m 级树冠」，让俯瞰与近景都能读出满地花木。
 * 全部坐标 hash 派生，零共享 RNG；全部 Baker 合批，不新增 draw call。
 */
const PAL_GREEN_STEP = 30;
const PAL_GREEN_Y = 0.302;                  // 高于 city_ash 0.24 / city_ground 0.28
const PAL_BLADES = [0xa8d45c, 0xb8dd6a, 0x93c24c, 0x9ecb56, 0xc2e078, 0x86bd52] as const;
const PAL_FLOWERS = [0xe6d06a, 0xd8798c, 0xc98ad0, 0xe8a05a, 0xe9e4c8, 0xb96a86] as const;

function palaceGreenOk(x: number, z: number, half: number): boolean {
  for (const dx of [-half, 0, half])
    for (const dz of [-half, 0, half])
      if (!floraClear(x + dx, z + dz)) return false;
  return true;
}

/** 3m 级宫苑乔木：俯瞰是一团能读出来的树冠，近景有主干 + 两层叶球 + 花点 */
function palaceCanopy(b: Baker, x: number, z: number, salt: number): void {
  const u = wardHash(x, z, salt);
  const h = 3.6 + u * 1.8;
  b.cyl('trunk', 0.22, 0.34, h, 6, x, PAL_GREEN_Y + h / 2, z, SC_TRUNK);
  const crown = shade(u < 0.5 ? 0x4f7f3e : 0x648c42, 0.92 + u * 0.22);
  b.sphere('leaf', 2.9 + u, 7, x, PAL_GREEN_Y + h + 1.1, z, crown, 0, 0, 0, 1.1, 0.86, 1.1);
  for (let i = 0; i < 2; i++) {
    const a = wardHash(x, z, salt + 11 + i) * Math.PI * 2;
    b.sphere('leaf', 1.5, 6, x + Math.cos(a) * 2.1, PAL_GREEN_Y + h + 0.2,
      z + Math.sin(a) * 2.1, shade(crown, 1.06), 0, 0, 0, 1, 0.8, 1);
  }
  for (let i = 0; i < 3; i++) {
    const a = wardHash(x, z, salt + 31 + i) * Math.PI * 2;
    b.sphere('ceramic', 0.34, 5, x + Math.cos(a) * 2.6, PAL_GREEN_Y + h + 1.5,
      z + Math.sin(a) * 2.6, PAL_FLOWERS[(Math.abs(salt) + i) % PAL_FLOWERS.length]);
  }
}

/**
 * R23：每簇 = 一块宫苑草地（深浅草色 + 18 丛倾斜草叶 + 花）+ 24 株花木。
 * R23 第四轮：草皮统一抬到 y=0.302（方砖顶 0.14 / 0.24、city_ground 顶 0.28 之上），
 * 并先铺一层 30m 网格连续绿毯 + 3m 级树冠，解决「208 个孤立草块只覆盖一成宫城」的画面级稀疏。
 * 全部走既有 leaf/ceramic/trunk 组 + Baker 合批，坐标 hash 派生，零共享 RNG。
 */
function buildPalaceGroundFlora(b: Baker): void {
  let clusters = 0, plants = 0, tufts = 0;
  // R23 第四轮：0.20 会被 city_ash_9 的 0.24 铺装盖住，抬到所有铺装顶面之上。
  const LAWN_Y = PAL_GREEN_Y;

  // ---- ① 连续绿毯：30m 网格，9 点避让，草叶 / 彩花 / 3m 级乔木 ----
  let cells = 0, carpetTufts = 0, carpetFlowers = 0, canopies = 0, carpetBlobs = 0;
  for (let z = -3025; z >= -3965; z -= PAL_GREEN_STEP) {
    for (let x = -1065; x <= 1065; x += PAL_GREEN_STEP) {
      if (!palaceGreenOk(x, z, PAL_GREEN_STEP / 2)) continue;
      const salt = (Math.round(x) * 31 + Math.round(z) * 17) | 0;
      const hs = wardHash(x, z, salt + 7701);
      // R24b：位置抖动的「重叠圆盘群」仍是圆 → 改成任意不规则自由轮廓
      // （非等分角度 / 多频半径 / 连续深凹 / 尖尾枝杈 / 长条扁片），3 张错开搭接
      // 保证连片不露灰白铺装；30m 网格只作为布点参考，不再是肉眼可见的方格边界。
      const B = freeBlobGeometries();
      const rad0 = 15 + hs * 4;
      for (let q = 0; q < 3; q++) {
        const uq = wardHash(x, z, salt + 7711 + q * 7);
        const vq = wardHash(x, z, salt + 7713 + q * 11);
        const jx = (uq - 0.5) * 11;
        const jz = (vq - 0.5) * 11;
        const rr = rad0 * (0.72 + uq * 0.20);
        carpetBlobs++;
        putFreeBlob(b, B[(Math.abs(salt + q * 37) >>> 0) % B.length],
          x + jx, PAL_GREEN_Y + (cells % 4) * 0.0015 + q * 0.0012, z + jz,
          shade(0x8ab84f, 0.90 + hs * 0.22 + q * 0.03), uq * 6.28,
          rr, rr * (0.72 + vq * 0.35));
      }
      for (let q = 0; q < 2; q++) {
        const uq = wardHash(x, z, salt + 7721 + q);
        const aq = uq * Math.PI * 2;
        carpetBlobs++;
        putFreeBlob(b, B[(Math.abs(salt + 7901 + q) >>> 0) % B.length],
          x + Math.cos(aq) * 17, PAL_GREEN_Y + 0.003 + q * 0.001, z + Math.sin(aq) * 17,
          shade(0x8ab84f, 0.88 + uq * 0.24), aq, 4 + uq * 4, 3 + uq * 3);
      }
      // R23 第四轮：3×3 共 9 丛亮叶 / 30m 格，4 片/丛，人眼近景能分辨出草叶而非纯色膜
      for (let k = 0; k < 9; k++) {
        const u1 = wardHash(x, z, salt + 7800 + k * 3);
        const u2 = wardHash(x, z, salt + 7801 + k * 3);
        const px = x + ((k % 3) - 1) * 9 + (u1 - 0.5) * 3.4;
        const pz = z + (((k / 3) | 0) - 1) * 9 + (u2 - 0.5) * 3.4;
        const blade = PAL_BLADES[(Math.abs(salt) + k) % PAL_BLADES.length];
        for (let t = 0; t < 4; t++) {
          const a = (t / 4) * Math.PI * 2 + u1 * 3;
          const hgt = 0.9 + u2 * 0.7;
          b.box('leaf', 0.26, hgt, 0.54,
            px + Math.cos(a) * 0.4, PAL_GREEN_Y + hgt / 2, pz + Math.sin(a) * 0.4,
            shade(blade, 0.96 + u1 * 0.14), a, 0.22 * Math.cos(a), 0.22 * Math.sin(a));
        }
        if (k % 3 === 0)
          b.sphere('ceramic', 0.3, 5, px, PAL_GREEN_Y + 1.25, pz,
            PAL_FLOWERS[(Math.abs(salt) + k) % PAL_FLOWERS.length], 0, 0, 0, 1, 0.85, 1);
        carpetTufts++;
        carpetFlowers += k % 3 === 0 ? 1 : 0;
      }
      // 每 4 格一棵 3m 级乔木：250m 俯瞰也能读出成片树冠
      if ((cells & 3) === 0) {
        palaceCanopy(b, x + (hs - 0.5) * 10, z + (wardHash(x, z, salt + 7901) - 0.5) * 10, salt + 8100);
        canopies++;
      }
      cells++;
    }
  }
  b.kit('palace.greenCarpet.cell', cells, PAL_GREEN_Y);
  b.kit('palace.greenCarpet.freeBlob', carpetBlobs, PAL_GREEN_Y);
  b.kit('palace.greenCarpet.tuft', carpetTufts, 0);
  b.kit('palace.greenCarpet.flower', carpetFlowers, 0);
  b.kit('palace.greenCarpet.canopy', canopies, 0);

  // ---- ② 原簇状花木层：与绿毯叠加，提供簇内 24 株花 / 灌木 / 小乔木 ----
  for (const [cx, cz] of FLORA_CLUSTERS) {
    const salt = (Math.round(cx) * 31 + Math.round(cz) * 17) | 0;
    const radius = 20 + wardHash(cx, cz, salt + 1) * 12;      // 20–32m
    const gw = radius * 1.8, gd = radius * 1.5;
    // ① 真草地：底色 + 深浅草斑 + 倾斜草叶 + 花，取代「方砖上几粒孤立小球」
    // R23 第三轮：草叶按画面尺度放大并提亮（第一轮 0.08m 细叶在宫内近景同样看不见）
    // 簇状草斑比绿毯高 16mm，避免两层共面 z-fighting（R23 第四轮）
    b.box('leaf', gw, 0.03, gd, cx, LAWN_Y + 0.016, cz, shade(0x7ea94a, 0.94));
    for (let k = 0; k < 22; k++) {
      const hs = wardHash(cx + k * 7, cz - k * 5, salt + 400 + k);
      const px = cx + (hs - 0.5) * gw * 0.92;
      const pz = cz + (wardHash(cx, cz + k * 3, salt + 500 + k) - 0.5) * gd * 0.92;
      b.box('leaf', gw * 0.16, 0.012, gd * 0.2, px, LAWN_Y + 0.042, pz, shade(SC_LEAF_W, 0.9 + hs * 0.25));
      for (let t = 0; t < 4; t++) {
        const a = (t / 4) * Math.PI * 2 + hs * 3;
        b.box('leaf', 0.22, 0.8 + hs * 0.6, 0.48,
          px + Math.cos(a) * 0.4, LAWN_Y + 0.55, pz + Math.sin(a) * 0.4,
          shade(t % 2 ? 0xa8d45c : 0x8fbe4a, 0.92 + hs * 0.24), a,
          0.24 * Math.cos(a), 0.24 * Math.sin(a));
      }
      if (k % 2 === 0) {
        const cols2 = [0xc2677a, 0xd8a24a, 0xe6e0c6, 0x9a6fb0, 0xe08a48];
        b.sphere('ceramic', 0.26, 5, px, LAWN_Y + 1.16, pz, cols2[k % 5]);
      }
      tufts++;
    }
    // ② 花木 24 株（花丛 / 灌木 / 乔木三选一），簇内按面积均匀撒点，拒绝点顺延重试
    let placed = 0, tries = 0;
    while (placed < PLANTS_PER_CLUSTER && tries < PLANTS_PER_CLUSTER * 6) {
      const a = wardHash(cx, cz, salt + 100 + tries) * Math.PI * 2;
      const rr = radius * Math.sqrt(wardHash(cx, cz, salt + 200 + tries));
      const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
      tries++;
      if (!floraClear(px, pz)) continue;
      floraPlant(b, px, pz, wardHash(cx, cz, salt + 300 + tries), salt + tries);
      placed++; plants++;
    }
    clusters++;
  }
  b.kit('palace.groundFlora', clusters, 0);
  b.kit('palace.groundFlora.plant', plants, 0);
  b.kit('palace.groundFlora.tuft', tufts, 0);
  b.kit('palace.groundFlora.lawn', clusters, 0.2);
}

// ============ R25：殿阁室内起居陈设层 ============
/**
 * 旧 furnishHall / furnishCourt 只落礼制陈设（宝座 / 屏风 / 香炉 / 宫灯 / 仪仗），
 * 用户点名「皇宫房间内家具、摆设、装饰、起居用品、功能用品缺失」。
 * 这里对主要殿阁补一层 buildRoomLiving 的三档起居资产（床榻 / 箱笼 / 妆奁 / 盆架 / 灯檠 / 挂轴…），
 * 与街屋同一套资产表、同一套坐标 hash，不消耗共享 rng；器件贴墙贴角，不压明间宝座与甬道。
 * 坐标全部是世界口径（与 furnishHall 的 x/z/y 同口径），ux=+X / vx=+Z 即不旋转的房间。
 */
function buildPalaceLiving(b: Baker): void {
  const room = (cx: number, cz: number, w: number, d: number, y0: number, h: number, variant: number): void => {
    buildRoomLiving(b, { cx, cz, w, d, y0, h, ux: 1, uz: 0, vx: 0, vz: 1, variant });
  };
  // 三大殿（台基顶 y = 4.65，与 furnishHall 同口径）
  room(0, PALACE.taiheZ - 6, 200, 84, 4.65, 20, 1);
  room(0, PALACE.zhongheZ - 4, 140, 70, 4.65, 18, 2);
  room(0, PALACE.baoheZ - 5, 180, 78, 4.65, 19, 3);
  // 后寝寝殿（R24 中轴北段，台基 y = 3.1）
  room(0, -3840, 110, 52, 3.1, 14, 4);
  // R23：旧值 room(0,-2960,60,24,6.2,9,5) 落在午门**城台实心芯**内（城台 y 1.4–12.6），
  // 28 件起居家具全被夯土墙埋掉，这正是「午门宫殿内什么都没有」的根因之一。
  // 改到五凤楼真实楼层（hallY=13.3，地面完成面 13.7），与 buildMeridianGate 的四壁空间对齐。
  // 太和门门楼（furnishGateHall 只落灯与仪仗）
  room(0, -2950, 116, 24, 13.75, 10.2, 5);
  room(0, -3086, 44, 20, 2.78, 7, 6);
  // 东西六宫 12 院：每院正殿 + 东西配殿（台基顶 y ≈ 1.26），共 36 间
  let k = 10;
  for (const sx of [-1, 1]) {
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 2; row++) {
        const cx = sx * (500 + col * 150), cz = -3820 - row * 118;
        room(cx, cz - 14, 42, 22, 1.26, 6.4, k++);
        for (const s of [-1, 1]) room(cx + s * 44, cz - 6, 13, 30, 1.26, 4.6, k++);
      }
    }
  }
  b.kit('palace.living.rooms', 42, 0);
  // ============ R22 追加：东西六宫夹道值房 / 后寝值房 / 宫苑厅阁，共 28 间 ============
  // 固定整数坐标 + 变体序号，零随机源、不消耗共享 RNG；坐标全部落在宫城
  // z ∈ [-3000, -3690]、|x| ≤ 1040（< 1160）的既有殿阁两翼，不改动上面任何已有 room(...) 调用。
  // —— 三大殿两翼廊庑 / 六宫夹道值房（10 间）
  room(-300, -3060, 30, 18, 1.26, 5.4, 100);
  room( 300, -3060, 30, 18, 1.26, 5.4, 101);
  room(-560, -3060, 26, 16, 1.26, 5.0, 102);
  room( 560, -3060, 26, 16, 1.26, 5.0, 103);
  room(-820, -3200, 24, 18, 1.26, 5.0, 104);
  room( 820, -3200, 24, 18, 1.26, 5.0, 105);
  room(-300, -3300, 30, 18, 1.26, 5.4, 106);
  room( 300, -3300, 30, 18, 1.26, 5.4, 107);
  room(-620, -3340, 28, 20, 1.26, 5.2, 108);
  room( 620, -3340, 28, 20, 1.26, 5.2, 109);
  // —— 后寝值房（内廷东西，8 间）
  room(-160, -3560, 22, 14, 3.1, 6.0, 110);
  room( 160, -3560, 22, 14, 3.1, 6.0, 111);
  room(-360, -3600, 24, 16, 3.1, 6.0, 112);
  room( 360, -3600, 24, 16, 3.1, 6.0, 113);
  room(-160, -3660, 22, 14, 3.1, 6.0, 114);
  room( 160, -3660, 22, 14, 3.1, 6.0, 115);
  room(-420, -3690, 26, 16, 3.1, 6.0, 116);
  room( 420, -3690, 26, 16, 3.1, 6.0, 117);
  // —— 宫苑厅阁（外翼，10 间）
  room(-900, -3000, 20, 20, 0.6, 4.6, 118);
  room( 900, -3000, 20, 20, 0.6, 4.6, 119);
  room(-1000, -3200, 22, 18, 0.6, 4.6, 120);
  room( 1000, -3200, 22, 18, 0.6, 4.6, 121);
  room(-900, -3400, 20, 20, 0.6, 4.6, 122);
  room( 900, -3400, 20, 20, 0.6, 4.6, 123);
  room(-1040, -3560, 24, 18, 0.6, 4.6, 124);
  room( 1040, -3560, 24, 18, 0.6, 4.6, 125);
  room(-960, -3660, 20, 20, 0.6, 4.6, 126);
  room( 960, -3660, 20, 20, 0.6, 4.6, 127);
  b.kit('palace.living.roomsR22', 70, 0);  // 42 原有 + 28 新增 = 房间总数 70
}

/** 宫城总装：地坪 → 宫墙 → 午门/太和门/神武门 → 三大殿 → 广场 → 六宫 → 角楼 → 廊庑 → 御沟 → 宫前宫后商业街 */
export function buildPalace(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  buildPalaceGround(b);
  buildPalaceWalls(b);
  buildMeridianGate(b, sg, atlas);
  buildShenwuGate(b, sg, atlas);
  buildTaiheGate(b, sg, atlas);
  buildThreeHalls(b, sg, atlas);
  buildPalaceCourt(b);
  buildPalaceWings(b);
  buildPalaceCompounds(b);
  buildSixPalaces(b);
  // R24 宫城填充层：方砖 / 御路 / 分段庑房 / 配殿 / 后寝 / 值房 / 院群 / 陈设 / 东西御花园
  buildPalaceGrounds(b);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) buildPalaceCorner(b, sx * PAL_X, sz > 0 ? PALACE.z1 : PALACE.z0);
  buildPalaceCorridors(b);
  buildPalaceMoat(b);
  buildPalaceFrontStreet(b);
  buildPalaceBackStreet(b);
  // R24 宫墙外过渡：东西 30–70m 官署环带 + 北面仓廪营房 + 午门外千步廊
  buildPalaceOuterGrounds(b);
  // 机检读点：宫城内「最大空矩形」等读数（2m 栅格），探针直接读 window.__palaceAudit
  if (typeof window !== 'undefined') {
    (window as unknown as { __palaceAudit?: unknown }).__palaceAudit = palaceGroundsAudit();
  }
  // 室内陈设（宝座/屏风/香炉/宫灯/地毯/案几/仪仗）：三大殿 + 午门 + 太和门
  furnishHall(b, { x: 0, z: PALACE.taiheZ - 6, y: 4.65, w: 200, d: 84, scale: 1.0, salt: 11 });
  furnishHall(b, { x: 0, z: PALACE.zhongheZ - 4, y: 4.65, w: 140, d: 70, scale: 0.86, salt: 23 });
  furnishHall(b, { x: 0, z: PALACE.baoheZ - 5, y: 4.65, w: 180, d: 78, scale: 0.94, salt: 37 });
  furnishGateHall(b, 0, -2960, 6.2, 1.0, 51);
  furnishGateHall(b, 0, -3086, 2.78, 0.8, 67);
  // R22 叠加层：88 组多带补景（中轴 / 御花园 / 宫墙内外，每组含成簇花木与山水） + 32 簇 640 株成片花木；
  // R25 殿阁内补三档起居陈设
  buildPalaceScenery(b);
  buildPalaceGroundFlora(b);
  buildPalaceLiving(b);
  b.kit('imperial.palace', 1, 0);
}

const CANOPYC = [0xa83a32, 0x2a7a8a, 0x8a5aa8, 0xa87a2a, 0x3a7a4a];
