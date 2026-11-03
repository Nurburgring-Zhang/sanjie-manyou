import * as THREE from 'three';
import { RNG } from '../core/rng';
import { heavenPoint } from '../sky/heavenFrame';
import { inRiverFootprint, riverCenterZ, riverHalfWidth } from './riverGeom';

// ============ 世界坐标与街区布局 ============
export const RIVER_HALF = 30;        // 汴河半宽（z∈[-30,30]）
export const BANK_OUT = 42;          // 岸坡外缘
export const BRIDGE_HALF = 48;

// ============ B1 可进入内饰地标禁入区（街块/摊棚/灯器让位）：x0,x1,z0,z1 ============
export const LANDMARK_KEEPOUT: [number, number, number, number][] = [
  [213, 239, 51, 75],   // 孙羊正店+后院酒瓮场
  [111, 133, 50, 72],   // 十千脚店+后院客舍
  [541, 579, -83, -61], // 府衙大堂（南岸岸上，照壁 z=−62.5 / 大堂 z −68…−80）
  [-272, -202, 34, 41],  // 漕运仓场：码头岸带让给仓房（纤道外缘 34.8 之后）
];
export function inLandmarkKeepout(x: number, z: number): boolean {
  return LANDMARK_KEEPOUT.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
}       // 虹桥半跨（z 方向）
export const WALL_X = 462;           // 城墙位置（东）
export const GATE_Z = 52;            // 城门所在北街

export interface Street { x0: number; x1: number; z: number; w: number; bridge?: boolean }
export interface VStreet { z0: number; z1: number; x: number; w: number }

// 东西向街道（沿长卷方向）
export const H_STREETS: Street[] = [
  { x0: -600, x1: 452, z: 52, w: 11 },     // 北岸正街（穿城门）
  { x0: -560, x1: 440, z: -52, w: 9 },     // 南岸街
  { x0: 120, x1: 440, z: 96, w: 8 },       // 北岸后街（市场纵深）
  { x0: 470, x1: 620, z: 52, w: 11 },      // 城内大街（门内段与北街同轴）
];
// 南北向街道
export const V_STREETS: VStreet[] = [
  { z0: -120, z1: 96, x: -420, w: 7 },     // 郊野路
  { z0: -96, z1: 96, x: -238, w: 8 },      // 码头路
  { z0: -96, z1: 52, x: -60, w: 6 },       // 桥西巷
  { z0: 52, z1: 96, x: 60, w: 6 },         // 桥东巷（北）
  { z0: -96, z1: -52, x: 60, w: 6 },       // 桥东巷（南）
  { z0: 52, z1: 96, x: 190, w: 7 },        // 市场巷一
  { z0: 52, z1: 96, x: 300, w: 7 },        // 市场巷二
  { z0: -52, z1: 96, x: 396, w: 7 },       // 城门前路
  { z0: -60, z1: 240, x: 560, w: 8 },      // 城内南北街
];

// 虹桥桥面高度剖面（z 从 -48 到 +48）
export function bridgeDeckY(z: number): number {
  const t = THREE.MathUtils.clamp(z / BRIDGE_HALF, -1, 1);
  return 0.7 + 8.4 * (1 - t * t);
}

// ============ 汴河主河段桥梁登记表（建桥 / 行走 / 探头共用同一份真源） ============
// 用户判词：「河上建立多座桥的问题，你他妈解决了吗？？？」
// 旧账：全河只有 虹桥(0) / 石拱(−1680) / 木梁(+1620) / 浮桥(−2480) 四座，
// 主河段 0→±1600m 之间一座都没有 —— 高空沿河俯视时整条河是空的。
// 现在 |x|≤1680 每 420–600m 一座，7 座 6 形制（贯木拱/石拱/叠梁拱/廊桥/浮桥/木梁）。
export type BridgeForm = '贯木拱' | '石拱' | '叠梁拱' | '廊桥' | '浮桥' | '木梁';

export interface BridgeSpec {
  /** 桥名（与桥面匾额同字） */
  name: string;
  form: BridgeForm;
  /** 桥轴世界 x */
  x: number;
  /** 拱顶桥面标高（米；水面恒 1.0） */
  crown: number;
  /** 桥面宽（米） */
  wide: number;
  /** 半跨（沿 z；缺省由河宽推出） */
  half?: number;
  /** 是否计入「主河段」密度账（|x|<2000 的一座不漏） */
  main?: boolean;
}

/** 桥面两端落地标高：与虹桥同口径，0.7m 落在纤道上，再两级踏步到岸面 */
export const BRIDGE_END_Y = 0.7;
/** 水面标高（riverGeom.RIVER_WATER_Y 的镜像常数，供纯函数免 THREE 依赖使用） */
export const BRIDGE_WATER_Y = 1.0;

/**
 * 桥梁台账。顺序即建造顺序；`half` 缺省 = 河半宽 + 3.4（落在纤道内缘、不进铺面）。
 * 位置一律落在船只航段的空隙或可通航的高拱下（船队分段的原点是 −2480/−1680/0/+1620）。
 */
export const MAIN_BRIDGES: BridgeSpec[] = [
  { name: '浮梁', form: '浮桥', x: -2480, crown: 3.6, wide: 8.2 },
  { name: '永寧橋', form: '石拱', x: -1680, crown: 8.4, wide: 9.6 },
  { name: '疊梁橋', form: '叠梁拱', x: -1200, crown: 8.4, wide: 9.0 },
  { name: '清風橋', form: '廊桥', x: -600, crown: 8.2, wide: 8.8 },
  { name: '虹橋', form: '贯木拱', x: 0, crown: 9.1, wide: 10.4, half: BRIDGE_HALF },
  { name: '通津橋', form: '浮桥', x: 600, crown: 3.6, wide: 8.2 },
  { name: '拱辰橋', form: '石拱', x: 1200, crown: 8.8, wide: 9.2 },
  { name: '通濟橋', form: '木梁', x: 1620, crown: 7.0, wide: 6.4 },
];

/** 桥的半跨（沿 z）：河半宽 + 3.4；虹桥用显式 48 */
export function bridgeHalfSpan(b: BridgeSpec): number {
  return b.half ?? Math.max(34, riverHalfWidth(b.x) + 3.4);
}

/** 拱桥桥面抛物线剖面：拱顶 crown、两端 BRIDGE_END_Y */
export function bridgeProfileY(b: BridgeSpec, dz: number): number {
  const half = bridgeHalfSpan(b);
  const t = THREE.MathUtils.clamp(dz / half, -1, 1);
  return BRIDGE_END_Y + (b.crown - BRIDGE_END_Y) * (1 - t * t);
}

/** 浮桥的通航孔半宽：宽河（半宽 >26）留 18m 通航孔给双向航道，窄河只做 6m 小孔 */
export function pontoonNavHalf(x: number): number {
  return riverHalfWidth(x) > 26 ? 18 : 6;
}

/**
 * 浮桥桥面剖面：通航孔顶（宽河 6.2 / 窄河 4.6）→ 3.0m 内降到 3.6m → 平段 → 端部降到 0.7m。
 * 抬高不是为了好看：用户要求桥面高出水面 ≥2.5m，浮舟托架因此做成 2.6m 高的排架。
 */
export function pontoonDeckY(x: number, dz: number): number {
  const half = bridgeHalfSpan({ name: '', form: '浮桥', x, crown: 3.6, wide: 0 });
  const nav = pontoonNavHalf(x);
  const top = nav > 6 ? 6.2 : 4.6;
  const a = Math.abs(dz);
  if (a <= nav) return top;
  if (a <= nav + 3) return top - ((a - nav) / 3) * (top - 3.6);
  if (a <= 29) return 3.6;
  if (a >= half) return BRIDGE_END_Y;
  return 3.6 - ((a - 29) / (half - 29)) * (3.6 - BRIDGE_END_Y);
}

/**
 * 桥面行走高程（纯函数）：世界 (x,z) 落在某座桥的桥面内 → 返回桥面 y；否则 null。
 * 浮桥是平桥 + 中央通航孔抬升，不走抛物线剖面。
 */
export function bridgeDeckYAt(x: number, z: number): number | null {
  for (const b of MAIN_BRIDGES) {
    if (Math.abs(x - b.x) > b.wide / 2) continue;
    const dz = z - riverCenterZ(b.x);
    if (Math.abs(dz) > bridgeHalfSpan(b)) continue;
    return b.form === '浮桥' ? pontoonDeckY(b.x, dz) : bridgeProfileY(b, dz);
  }
  return null;
}

// ============ POI ============
export interface Poi { name: string; pos: THREE.Vector3; radius: number; sky?: boolean }
/**
 * 天宫 POI 一律**世界坐标**（x/z 已 ×HEAVEN_SCALE，y 已走 heavenY）。
 *
 * 旧账：这里写的是缩放前米（凌霄殿 0,214,95），而 `liftHeavenResiduals` 只补 +HEAVEN_LIFT ——
 * x/z 没乘 2.2，传送到凌霄殿落在殿前约 130m 的空中。天宫几何的顶点通道
 * （expansion.scaleHeavenGeometry）与 POI 必须同一套换算，唯一入口就是 `heavenPoint`。
 *
 * 换算后的 y 都在 2137 以上（≥ HEAVEN_BASE_LIFTED=2131），`liftHeavenResiduals` 的
 * `y < HEAVEN_BASE_LIFTED` 判据因此自然不命中 —— 不会二次抬升，补丁无需另改。
 *
 * y 取该 host 的可站面（与 `sky/havoc.ts` 的 SKY_STAND_Y 同源），不是云台名义中心：
 * 名义高会埋进台基（palace 214 → 台明顶 219.58）或悬在台面上方（arenaW 208 → 铺装 206.12）。
 */
export const POIS: Record<string, Poi> = {
  countryside: { name: '郊野柳林', pos: new THREE.Vector3(-450, 4, 78), radius: 16 },
  wharf: { name: '汴河码头', pos: new THREE.Vector3(-238, 2, 40), radius: 18 },
  bridge: { name: '虹桥', pos: new THREE.Vector3(0, 12, 0), radius: 30 },
  sunyang: { name: '孙羊正店', pos: new THREE.Vector3(226, 2, 66), radius: 14 },
  shiqian: { name: '十千脚店', pos: new THREE.Vector3(122, 2, 64), radius: 12 },
  washi: { name: '瓦子勾栏', pos: new THREE.Vector3(306, 2, 78), radius: 16 },
  gate: { name: '城门', pos: new THREE.Vector3(WALL_X, 6, GATE_Z), radius: 20 },
  pagoda: { name: '开宝寺塔', pos: new THREE.Vector3(540, 6, 200), radius: 20 },
  yamen: { name: '府衙', pos: new THREE.Vector3(560, 2, -74), radius: 18 },
  southbank: { name: '南岸市集', pos: new THREE.Vector3(-60, 2, -66), radius: 16 },
  // 天宫：参数为缩放前米（与 realm.ts SkyCenters 同一套），落位统一走 heavenPoint
  nantianmen: { name: '南天门', pos: new THREE.Vector3(...heavenPoint(0, 203.12, -80)), radius: 30, sky: true },
  // 凌霄殿落点取东院台面（palace.ts buildHeavenScaleColonnade 的 EAST 院，世界 257.5/253.5）：
  // 殿心 0,95 已被 2.7273× 的台基整片埋掉；palace.ts 的 poi.pos.set 是同一落点的二次定锚，两者必须同值。
  lingxiao: { name: '凌霄宝殿', pos: new THREE.Vector3(...heavenPoint(117.05, 214.8, 115.23)), radius: 36, sky: true },
  pantao: { name: '蟠桃园', pos: new THREE.Vector3(...heavenPoint(-150, 201.12, 40)), radius: 24, sky: true },
  // 瑶池：落点在水榭水中台上（palace.ts buildYaochi：台面 208.26），不是水面 206.25
  yaochi: { name: '天宫·瑶池水榭', pos: new THREE.Vector3(...heavenPoint(150, 208.26, 20)), radius: 14, sky: true },
};

// ============ 寻路路网 ============
export class NavGraph {
  nodes: THREE.Vector3[] = [];
  adj: number[][] = [];
  private index = new Map<string, number>();

  private key(x: number, z: number): string { return `${Math.round(x)}_${Math.round(z)}`; }
  add(x: number, y: number, z: number): number {
    const k = this.key(x, z);
    const got = this.index.get(k);
    if (got !== undefined) return got;
    const id = this.nodes.length;
    this.nodes.push(new THREE.Vector3(x, y, z));
    this.adj.push([]);
    this.index.set(k, id);
    return id;
  }
  connect(a: number, b: number): void {
    if (a === b) return;
    if (!this.adj[a].includes(b)) this.adj[a].push(b);
    if (!this.adj[b].includes(a)) this.adj[b].push(a);
  }
  nearest(p: THREE.Vector3, maxDist = 30, maxY = Infinity): number {
    let best = -1, bd = maxDist * maxDist;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].y > maxY) continue;
      const d = this.nodes[i].distanceToSquared(p);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** BFS 最短路（图小，足够快） */
  path(from: number, to: number): THREE.Vector3[] {
    if (from < 0 || to < 0) return [];
    if (from === to) return [this.nodes[to].clone()];
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const seen = new Uint8Array(this.nodes.length);
    const q = [from]; seen[from] = 1;
    while (q.length) {
      const cur = q.shift()!;
      for (const nb of this.adj[cur]) {
        if (seen[nb]) continue;
        seen[nb] = 1; prev[nb] = cur;
        if (nb === to) {
          const out: THREE.Vector3[] = [];
          let c = to;
          while (c !== -1) { out.push(this.nodes[c].clone()); c = prev[c]; }
          return out.reverse();
        }
        q.push(nb);
      }
    }
    return [];
  }
  connectivityOk(): boolean {
    if (this.nodes.length === 0) return false;
    const seen = new Uint8Array(this.nodes.length);
    const q = [0]; seen[0] = 1; let n = 1;
    while (q.length) {
      const cur = q.shift()!;
      for (const nb of this.adj[cur]) if (!seen[nb]) { seen[nb] = 1; q.push(nb); n++; }
    }
    return n === this.nodes.length;
  }
}

/**
 * 桥面豁免带：虹桥桥轴 |x|≤8、|z|≤BRIDGE_HALF。行人在这里本来就高于水面。
 * 与 world.ts「桥面 |x|<8」、crowd.ts AXIS_X 同一口径。
 */
const onBridgeSpan = (x: number, z: number): boolean => Math.abs(x) <= 8 && Math.abs(z) <= BRIDGE_HALF;
/** 地面点是否落在汴河里（桥面除外）—— 判据取 riverGeom 真源，不复制河宽常数 */
const inRiverSpan = (x: number, z: number): boolean => !onBridgeSpan(x, z) && inRiverFootprint(x, z, 0.5);
/** 两点连线是否穿河（3m 步长采样；桥面除外） */
function crossesRiver(x0: number, z0: number, x1: number, z1: number): boolean {
  const span = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(span / 3));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (inRiverSpan(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return true;
  }
  return false;
}

export function buildNav(): NavGraph {
  const g = new NavGraph();
  // 沿街节点
  // R20：旧版把每条南北街直接铺过汴河——码头路 x=−238、郊野路 x=−420、桥西巷 x=−60、
  // 城内南北街 x=560 都在水面正中留下节点，行走人口按节点撒点后就「站在水上」。
  // 河道内不再落节点（桥面除外），北岸与南岸各自成链，唯一过河口仍是虹桥。
  for (const s of H_STREETS) {
    const step = 26;
    const n = Math.max(2, Math.round((s.x1 - s.x0) / step));
    for (let i = 0; i <= n; i++) {
      const x = s.x0 + ((s.x1 - s.x0) * i) / n;
      if (s.bridge) continue;
      if (inRiverSpan(x, s.z)) continue;
      g.add(x, 0, s.z);
    }
  }
  for (const s of V_STREETS) {
    const step = 26;
    const n = Math.max(2, Math.round((s.z1 - s.z0) / step));
    for (let i = 0; i <= n; i++) {
      const z = s.z0 + ((s.z1 - s.z0) * i) / n;
      if (inRiverSpan(s.x, z)) continue;
      g.add(s.x, 0, z);
    }
  }
  // 虹桥桥面链（带坡度 y）：三条人行道，桥面才有人流而不是只有一条中线
  for (let i = 0; i <= 8; i++) {
    const z = -BRIDGE_HALF + (BRIDGE_HALF * 2 * i) / 8;
    for (const lane of [-2.4, 0, 2.4]) g.add(lane, bridgeDeckY(z), z);
  }
  // 同街相邻连接
  const linkLine = (pts: number[][], horizontal: boolean) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = horizontal
        ? g.nodes.findIndex((n) => Math.abs(n.x - pts[i][0]) < 0.5 && Math.abs(n.z - pts[i][1]) < 0.5)
        : g.nodes.findIndex((n) => Math.abs(n.z - pts[i][1]) < 0.5 && Math.abs(n.x - pts[i][0]) < 0.5);
      const b = horizontal
        ? g.nodes.findIndex((n) => Math.abs(n.x - pts[i + 1][0]) < 0.5 && Math.abs(n.z - pts[i + 1][1]) < 0.5)
        : g.nodes.findIndex((n) => Math.abs(n.z - pts[i + 1][1]) < 0.5 && Math.abs(n.x - pts[i + 1][0]) < 0.5);
      if (a >= 0 && b >= 0 && !crossesRiver(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) g.connect(a, b);
    }
  };
  for (const s of H_STREETS) {
    const pts: number[][] = [];
    const n = Math.max(2, Math.round((s.x1 - s.x0) / 26));
    for (let i = 0; i <= n; i++) pts.push([s.x0 + ((s.x1 - s.x0) * i) / n, s.z]);
    linkLine(pts, true);
  }
  for (const s of V_STREETS) {
    const pts: number[][] = [];
    const n = Math.max(2, Math.round((s.z1 - s.z0) / 26));
    for (let i = 0; i <= n; i++) pts.push([s.x, s.z0 + ((s.z1 - s.z0) * i) / n]);
    linkLine(pts, false);
  }
  // 桥链 + 桥接两岸街
  const bridgePts: number[][] = [];
  for (let i = 0; i <= 8; i++) { const z = -BRIDGE_HALF + (BRIDGE_HALF * 2 * i) / 8; bridgePts.push([0, z]); }
  for (let i = 0; i < 8; i++) {
    const a = g.nodes.findIndex((n) => Math.abs(n.x) < 0.5 && Math.abs(n.z - bridgePts[i][1]) < 0.5);
    const b = g.nodes.findIndex((n) => Math.abs(n.x) < 0.5 && Math.abs(n.z - bridgePts[i + 1][1]) < 0.5);
    if (a >= 0 && b >= 0) g.connect(a, b);
  }
  // 桥接两岸街（就近连接，桥面节点 y 过滤防止自连）
  const nb1 = g.nearest(new THREE.Vector3(0, 0, 52), 45, 5);
  const nb2 = g.nearest(new THREE.Vector3(0, bridgeDeckY(BRIDGE_HALF), BRIDGE_HALF), 45);
  if (nb1 >= 0 && nb2 >= 0) g.connect(nb1, nb2);
  const ns1 = g.nearest(new THREE.Vector3(0, 0, -52), 45, 5);
  const ns2 = g.nearest(new THREE.Vector3(0, bridgeDeckY(-BRIDGE_HALF), -BRIDGE_HALF), 45);
  if (ns1 >= 0 && ns2 >= 0) g.connect(ns1, ns2);
  // 兜底：每个节点连最近邻（≤20m），保证零孤岛；连线穿河的一律不接（唯一过河口是虹桥）
  for (let i = 0; i < g.nodes.length; i++) {
    let best = -1, bd = 400;
    for (let j = 0; j < g.nodes.length; j++) {
      if (i === j || g.adj[i].includes(j)) continue;
      const d = g.nodes[i].distanceToSquared(g.nodes[j]);
      if (d > 0.01 && d < bd) { bd = d; best = j; }
    }
    if (best >= 0) {
      const a = g.nodes[i], b = g.nodes[best];
      if (!crossesRiver(a.x, a.z, b.x, b.z)) g.connect(i, best);
    }
  }
  // 过河断链的接驳（R20）：南北街在河岸被截断后，同一岸的支路必须接回主网。
  // 只从「连线不穿河」的候选里取最近（不限 20m），确保北岸/南岸各自成网、
  // 唯一过河口仍然是虹桥；否则 connectivityOk 会因南岸短支路成为孤岛而失败。
  const linkIsolated = (): void => {
    if (!g.nodes.length) return;
    const seen = new Uint8Array(g.nodes.length);
    const reach = (start: number): void => {
      const q: number[] = [start];
      seen[start] = 1;
      while (q.length) {
        const cur = q.shift()!;
        for (const nb of g.adj[cur]) if (!seen[nb]) { seen[nb] = 1; q.push(nb); }
      }
    };
    reach(0);
    for (let i = 0; i < g.nodes.length; i++) {
      if (seen[i]) continue;
      let best = -1, bd = Infinity;
      for (let j = 0; j < g.nodes.length; j++) {
        if (i === j || !seen[j]) continue;
        const a = g.nodes[i], b = g.nodes[j];
        const d = a.distanceToSquared(b);
        if (d >= bd) continue;
        if (crossesRiver(a.x, a.z, b.x, b.z)) continue;
        bd = d; best = j;
      }
      if (best < 0) continue;
      g.connect(i, best);
      reach(i);
    }
  };
  linkIsolated();
  return g;
}

// ============ 建筑地块 ============
export interface Plot { x: number; z: number; ry: number; w: number; d: number; kind: string; sign?: string }

/** 沿街自动排布地块；side=1 建筑在街北侧（朝南 ry=0），-1 南侧（朝北 ry=π） */
export function streetPlots(st: Street, side: 1 | -1, rng: RNG, kinds: string[], opt: { gapMin: number; gapMax: number; wMin: number; wMax: number; dMin: number; dMax: number; signChance?: number; signs?: string[] }): Plot[] {
  const out: Plot[] = [];
  let x = st.x0 + rng.range(4, 14);
  const zLine = st.z + side * (st.w / 2 + 8);
  while (x < st.x1 - 10) {
    const w = rng.range(opt.wMin, opt.wMax);
    const d = rng.range(opt.dMin, opt.dMax);
    if (rng.chance(0.86)) {
      const kind = rng.pick(kinds);
      let sign: string | undefined;
      if (opt.signs && opt.signChance && rng.chance(opt.signChance)) sign = rng.pick(opt.signs);
      // 建筑正面朝向街道：北侧建筑(在z+)面向-z => ry=π；南侧面向+z => ry=0
      const ry = side === 1 ? Math.PI : 0;
      out.push({ x: x + w / 2, z: zLine, ry, w, d, kind, sign });
    }
    x += w + rng.range(opt.gapMin, opt.gapMax);
  }
  return out;
}
