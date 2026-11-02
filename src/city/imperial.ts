import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import type { BGroup } from './bake';
import { roofOn, roofTierAt, C, dougongBand, commonerRoof, wardRoofHex } from './buildings';
import { buildJiaolou, buildWengcheng, buildWatchtower, buildPaifang, furnishHall, furnishCourt, furnishGateHall } from './architecture';
import { buildPalaceHall, roofEndHips } from './palaceDetail';
import { buildPalaceGrounds, buildPalaceOuterGrounds, palaceGroundsAudit } from './palaceGrounds';
import { RNG } from '../core/rng';
import { inRiverFootprint } from './riverGeom';

// ============ 十公里帝都：城墙十二门/里坊百格/宫城皇城/东西两市/御街 ============
export const WALL = 5000;

/**
 * 直坡双坡顶的端头山花：局部 X 沿脊向，三角面立在端头平面上（底边沿 z、顶点在脊高）。
 * 与 interiors.gableTriangle 同形，但自带双面法线与 3.2m 一张的 UV，不跨文件耦合。
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
  const u = (halfSpan * 2) / 3.2, v = rise / 3.2;
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u / 2, v, u, 0, 0, 0, u / 2, v], 2));
  b.addGeo(g, geo, x, y, z, hex, ry, 0, 0);
  b.kit('roof.gableEnd', 1, y + rise);
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
  // 城台：石基 + 夯土芯 + 三道石皮 + 隅石
  b.box('ash', PW + 2.0, 1.4, PD + 2.0, 0, 0.7, gz, 0x8b877b);
  b.box('earth', PW, TOP - 1.4, PD, 0, 1.4 + (TOP - 1.4) / 2, gz, shade(PAL_RED, 0.82));
  for (const yy of [4.2, 8.0, 11.4]) b.box('ash', PW + 0.3, 0.5, PD + 0.3, 0, yy, gz, 0x948f80);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) b.box('ash', 1.1, TOP, 1.1, su * (PW / 2 - 0.05), TOP / 2, gz + sv * (PD / 2 - 0.05), 0x8d8a80);
  // 三个门洞：中门 22×12、侧门 12×9.6（x ±52）
  const holes: [number, number, number][] = [[0, 22, 12], [-52, 12, 9.6], [52, 12, 9.6]];
  for (const [hx, hw, hh] of holes) {
    b.box('ash', hw + 3.2, 1.2, 0.8, hx, hh + 0.6, gz + PD / 2 + 0.1, 0x9c9a90);
    for (const s of [-1, 1]) b.box('ash', 1.1, hh + 1.2, 0.8, hx + s * (hw / 2 + 0.55), (hh + 1.2) / 2, gz + PD / 2 + 0.1, 0x9c9a90);
    b.box('lacquer', hw, hh, 0.4, hx, hh / 2, gz + PD / 2 - 0.2, 0x161417);
    // 朱扉 + 九路门钉
    for (const s of [-1, 1]) {
      b.box('lacquer', hw / 2 - 0.3, hh - 1.4, 0.35, hx + s * (hw / 4), (hh - 1.4) / 2 + 0.2, gz + PD / 2 - 0.5, 0x7a1f1a);
      for (let r = 0; r < 7; r++) for (let c = 0; c < 4; c++) {
        b.box('metal', 0.3, 0.3, 0.2, hx + s * (hw / 4) - hw / 8 + 0.9 + c * (hw / 4 - 1.8) / 3, 1.6 + r * (hh - 3.2) / 6, gz + PD / 2 - 0.28, 0xd8b028);
      }
    }
  }
  // 城台顶：平台 + 垛口（外沿）
  b.box('ash', PW + 1.2, 0.4, PD + 1.2, 0, TOP + 0.2, gz, 0x9a9282);
  b.box('ash', PW, 0.3, PD, 0, TOP + 0.55, gz, 0x8a8478);
  for (let i = -14; i <= 14; i++) b.box('ash', 2.6, 1.3, 0.8, i * 8.2, TOP + 1.2, gz + PD / 2 - 0.6, 0x9a9282);
  // 五凤楼：面阔 130、进深 30、殿身 11m、重檐庑殿；四角崇楼 4 座
  const hallY = TOP + 0.7;
  b.box('wall', 130, 11, 30, 0, hallY + 5.5, gz, shade(PAL_RED, 0.98));
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
 *  · 金砖 0.06m 厚、色 0x6e6a66，砖缝 0.45m；御道 14m + 两侧 0.9m 石边；
 *  · 铜鼎 4 / 日晷 1（东 66,−3176）/ 嘉量 1（西 −66,−3176）/ 品级山 2 列 × 8 / 松柏 4 角 × 4；
 *  · 午门内值房东西各 6 间（面阔 8.2、进深 8.5、檐高 4.4）。
 */
export const PALACE_COURT = { x0: -148, x1: 148, z0: -3194, z1: -3106, roadHalf: 7 } as const;
const COURT_NX = 12;        // 每侧金砖列数（列距 ≈11.7m）
const COURT_GAP = 0.45;     // 砖缝：露出底衬青石，不是沙
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

/** 广场实测覆盖率（0.931 = 93.1%），探针直接读这个常量 */
export const PALACE_COURT_COVERAGE = courtPavingCoverage();

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
        const tone = 0.94 + wardHash(i + 7, j + 13, s > 0 ? 3 : 5) * 0.12;
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
  palaceCourtPaving(b, PALACE_COURT.z1, PALACE_COURT.z0);  // 太和门 → 太和殿
  palaceCourtPaving(b, -2982, -3056, 84);                  // 午门内：南端起于御沟以北，宽度收到 ±84（值房 |x|=64 落在铺装边上）
  for (const sx of [-1, 1]) palaceCourtWall(b, sx);
  for (const sx of [-1, 1]) palaceCourtVeranda(b, sx, PALACE_COURT.z1, COURT_VERANDA_Z0, COURT_BAY);
  for (const sx of [-1, 1]) palaceDutyRooms(b, sx);
  palaceCourtFurnish(b);
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
function palaceShop(b: Baker, sgn: number, xFace: number, z0: number, w: number, depth: number, floors: number, salt: number): void {
  const xc = sgn * (xFace + depth / 2);
  const zc = z0 + w / 2;
  const wallC = SHOP_WALL_C[(wardHash(salt, 7, 11) * SHOP_WALL_C.length) | 0];
  const roofC = SHOP_ROOF_C[(wardHash(salt, 13, 17) * SHOP_ROOF_C.length) | 0];
  const flagC = SHOP_FLAG_C[(wardHash(salt, 19, 23) * SHOP_FLAG_C.length) | 0];
  const h = floors === 2 ? 6.6 + wardHash(salt, 29, 31) * 1.4 : 3.9 + wardHash(salt, 37, 41) * 1.2;
  // 台基与地坪
  b.box('ash', depth + 1.4, 1.0, w + 1.2, xc, 0.1, zc, shade(wallC, 0.84));
  // 墙体
  b.box('wall', depth, h, w, xc, 0.6 + h / 2, zc, wallC);
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
  // 板门 + 窗 + 柜台（临街面）
  b.box('wood', 0.16, 2.3, Math.min(w * 0.42, 4.4), sgn * (xFace + 0.06), 1.75, zc, 0x3a2418);
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
}

/**
 * 一条商业街：沿 z 铺两排铺面（sgn=±1），铺面间距 10.5–18m（实体夹道 2.2–5m）。
 * 同时铺临街石板（御街两侧各 20m），保证店面不悬在裸地形上。
 */
function buildPalaceStreet(b: Baker, z0: number, z1: number, kitId: string): number {
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
      palaceShop(b, sgn, 19, z, w, depth, floors, salt);
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
  const n = buildPalaceStreet(b, -2820, -2300, 'palace.shopFront');
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
  const n = buildPalaceStreet(b, -4060, -4900, 'palace.shopBack');
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
  b.kit('imperial.palace', 1, 0);
}

const CANOPYC = [0xa83a32, 0x2a7a8a, 0x8a5aa8, 0xa87a2a, 0x3a7a4a];
