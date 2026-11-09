import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PoolSet, InstPool, BODY_MAT, MAX_HUMANS } from './pools';
import { ACTIONS, newPose, Pose, ActView, ActionFn } from './actions';
import type { Actor } from './types';
import { JOBS, JOB_MAP, SpotRegistry } from '../data/jobs';
import { allocate } from '../rt/entity';
import { NavGraph, H_STREETS, V_STREETS, BRIDGE_HALF, POIS, bridgeDeckY, bridgeDeckYAt } from '../city/layout';
import {
  tickActor, BehCtx, markCrossing, isCrossing, actionKindOf, behaviorChangeStats,
  ACTION_KINDS, CROSS_SHARE, navBounds, BehaviorKind, initBehavior, setPost, rebuildAvoidGrid,
  walkSurfaceY, ensureWalkSurface, walkSurfaceStats as walkSurfaceGridStats,
} from './behaviors';
import { SignAtlas } from '../city/bake';
import { wardCells, PALACE } from '../city/imperial';
import { beltRoomSpecs } from '../city/centralbelt';
import { riverRoomSpecs } from '../city/riverbank';
import { STREET_HOUSE_SLOTS } from '../city/interiors';
import { inRiverFootprint, riverCenterZ, riverHalfWidth, RIVER_WATER_Y } from '../city/riverGeom';
// R12-D：地府地面高程只从 sky/underworld.ts 只读导入（该文件不做任何修改）
import { UNDER } from '../sky/underworld';
import type { Clock, Random } from './behaviors';
import { solidFloorY, solidPushOut, solidBlocked } from '../rt/solids';

// ============ 随机源与时钟：依赖注入（与 behaviors.ts / physics.ts 同一套写法）============
// crowd 的随机全部落在「出生」这条线上：撒点顺序、落点抖动、出生朝向、步速、外观抽签。
// 每一项都会写进 Actor（pos / yaw / speed / seed / cloth / pants / skin / hat）或改变
// actor 的生成顺序，所以「同 seed 截图不可比 / 联机街面不同 / 读档人群换批」的根都在这里。
// 做法与 behaviors.ts 一致：只接受一个注入的 `rng()`，谁构造 Crowd 谁给源；不做 Math.random
// 的全局替换——那会连城建、贴图、音效一起改掉。
/**
 * 旧路径默认随机源：就是 Math.random 本体（同一函数引用，分布不变，因此不改变现有行为统计）。
 * 这里保留成**引用**而不是调用点，是因为静态门 probe-determinism 拦的是 A 类文件里的
 * 非确定性**调用**；语义上它仍然不确定。
 * ⚠ 默认值仅用于单机旧路径；联机 / 回放 / 无头测试必须显式传入 rng。
 */
/**
 * 旧路径的默认随机源。原为 `= Math.random`（取引用），`probe-determinism` 命不中 ⇒ 假绿。
 * 改为固定种子 mulberry32：同运行同顺序逐值可复现。需要变化请显式传 rng。
 */
const LEGACY_RNG: Random = (() => {
  let s = 0x5e7a1 >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

/**
 * 旧路径默认时钟（宿主墙钟，毫秒）。同样是引用别名，语义仍是墙钟。
 * ⚠ 只服务单机旧路径与真实耗时基准；联机 / 回放 / 无头测试必须注入与仿真步同步的时钟，
 *    否则受击到期（impactUntil）与「读档后同一帧」都会跟着真实时间漂。
 */
const HOST_PERF = (globalThis as unknown as { performance?: { now(): number } }).performance;
export const hostClock: Clock = HOST_PERF ? () => HOST_PERF.now() : () => 0;

// ============ 矩阵合成 ============
const MS = Array.from({ length: 32 }, () => new THREE.Matrix4());
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _sv = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const _pose: Pose = newPose();
const _c2 = new THREE.Color();
const _view: ActView = { speed: 1, seed: 0, scale: 1, t: 0, actionT: 0 };

function loc(m: THREE.Matrix4, root: THREE.Matrix4, px: number, py: number, pz: number, ex: number, ey: number, ez: number, sx = 1, sy = 1, sz = 1): void {
  _e.set(ex, ey, ez);
  _q.setFromEuler(_e);
  _v.set(px, py, pz);
  _sv.set(sx, sy, sz);
  m.compose(_v, _q, _sv);
  m.premultiply(root);
}

/**
 * R20 干燥地面判定：汴河河道足迹内（外扩 4m = 水面外 6m 河沿减去纤道本体）不是可站立地面。
 * 虹桥桥面是唯一例外（桥轴 |x|≤8、|z|≤BRIDGE_HALF，与 layout.ts / world.ts 同一口径）。
 * 撒点与驻场人群都先过这一关：旧版按路网节点撒点，而南北街的节点落在水面上，
 * 于是行人「站在河心」（实测 162 人 y=0、水线 1.0）。
 *
 * 4m 不是随手取的：水线之外依次是 0.6m 河沿缝 + 3.2m 纤道实体（顶面 1.35），
 * 人群在 y=0 的高度只能站到纤道外侧，否则会「砌」进纤道石作里。
 */
const onBridgeSpan = (x: number, z: number): boolean => Math.abs(x) <= 8 && Math.abs(z) <= BRIDGE_HALF;
const isDryGround = (x: number, z: number): boolean => onBridgeSpan(x, z) || !inRiverFootprint(x, z, 4.0);

/**
 * 行为层兜底：把踩进河/纤道带的地面角色沿 z 推回最近岸线（保留 x、朝向与行为）。
 * 只对 y 在 [-5, 水面−0.2) 的普通角色生效——船上（y 高于水面）、天宫、地府、
 * 桥面与 attach 演员都不在此列，因此不会改动任何一个既有实例的落位。
 */
function keepOffRiver(pos: THREE.Vector3): void {
  if (pos.y < -5 || pos.y > RIVER_WATER_Y - 0.2) return;
  if (onBridgeSpan(pos.x, pos.z)) return;
  if (!inRiverFootprint(pos.x, pos.z, 4.0)) return;
  const cz = riverCenterZ(pos.x);
  const hw = riverHalfWidth(pos.x);
  // 纤道外缘 = hw + 0.6(缝) + 3.2(道宽) = hw + 3.8；再让 0.4m，站到岸上地面
  pos.z = cz + (pos.z >= cz ? 1 : -1) * (hw + 4.2);
  pos.y = 0;
}

/**
 * 桥面贴合（R26）：桥面高度随 z 变化（bridgeDeckY），但行为层的移动积分只改 x/z、不改 y。
 * 结果桥上的人保持出生时的 y，沿桥走到另一端就悬空/陷进桥面——实测严格口径抓到
 * id=1167 在 x=-8.21、z=-29.91、y=7.48 处行走，而该 z 的桥面只有 5.84m：
 * 人悬在桥面之上 1.6m、又在桥面净宽（W=10.4，半宽 5.2）之外，远看就是「在河面上走」。
 * 这里逐帧把桥带内的地面行人贴到桥面、夹进桥面净宽；attach 演员（桥面往返者）与天空/地府不在此列。
 */
function keepOnBridgeDeck(a: Actor): void {
  if (a.sky || a.freeze || a.attach || a.hidden) return;
  if (a.pos.y > 12) return;
  if (Math.abs(a.pos.z) > BRIDGE_HALF + 10 || Math.abs(a.pos.x) > 10) return;
  if (Math.abs(a.pos.z) > BRIDGE_HALF) {
    // R27 真根因修复：桥端外 10m 内（|x|≤10，实测 z≈±50）同时分布着 0.6~9m 的街屋
    // 台基 / 室内楼板。旧逻辑把 y∈(0.4,9) 一律归零，逐帧把站在楼板上的人打回街面，
    // 行走面兜底每 4 帧再抬回来，形成永久拉锯 —— collisionAudit 恒有 18~21 个 sunken。
    // 改为先查该点真实可行走面：只有脚下没有更高面（纯街面）才收回 0；有台基/楼板
    // 就贴上去，既不下沉也不悬空。判据与 collisionAudit 同为 walkSurfaceY(x,z,fromY)。
    if (a.pos.y > 0.4 && a.pos.y < 9) {
      const sy = walkSurfaceY(a.pos.x, a.pos.z, a.pos.y);
      if (sy === null || sy <= 0.4) a.pos.y = 0;
      else a.pos.y = sy;
    }
    return;
  }
  // E3 复审（2026-11-04）：探针抓到的 5 个「off-deck」逐一取证后全部为合法状态——
  // 3 个 vendor hawk 站在出河带的引桥岸段（虹桥半跨 48 > 河半宽 30.6，y=0 是岸面），
  // 2 个是桥下过洞的船上乐师/茶客（attach 由 boat 系统驱动，y=1.76 是甲板）。
  // 桥带内 y=0 的桥下穿行是 R27 明确允许的设计。此处不加「推出到岸」——那会把合法
  // 行为改坏；判据缺陷已在 probe-water-clash 判据 C 修正（排除船上人与出河带岸段）。
  // 已经悬空/站在桥面上的人按净宽 ±10 收回来（实测悬空点在 x=-8.2）；
  // 贴地的人只有本来就落在桥面足迹（±5.2）内才抬上桥，避免把桥头的岸上行人吸到桥面。
  // R27：桥面高度必须和 walkSurfaceY / collisionAudit 同源。旧代码只用 bridgeDeckY(z)
  // 的解析抛物线（z=4.07 → 9.04m），而 walkSurfaceY 叠加的是 bridgeDeckYAt(x,z) 的
  // MAIN_BRIDGES 剖面（同点 9.87m）；逐帧把桥上行人贴到旧曲线，审计按新曲线判，
  // 15~17 个桥上行人恒被报「陷地 0.83m」。这里优先取同源剖面，取不到再回退旧曲线。
  // 真正同源：直接问 walkSurfaceY（collisionAudit 用的就是它）。实测这批点的 9.87m
  // 来自 solidFloorY 叠加的实体桥面顶面，bridgeDeckYAt 在这些点返回 null，只换剖面函数
  // 会回退到旧曲线、问题依旧。取不到时再依次回退解析剖面。
  const legacy = bridgeDeckY(THREE.MathUtils.clamp(a.pos.z, -BRIDGE_HALF, BRIDGE_HALF));
  const surface = walkSurfaceY(a.pos.x, a.pos.z, a.pos.y);
  const deck = surface !== null ? surface
    : (bridgeDeckYAt(a.pos.x, a.pos.z) ?? legacy);
  // 桥下纤道（y≈0）与桥面（最高 9.1）是同一 (x,z) 的两层：只有本来就贴着桥面的人才吸上去，
  // 否则从桥下走过会被抬到 8m 高——这正是「人悬在桥面之上」的另一个来源（R27）。
  if (Math.abs(a.pos.y - deck) > 2.2) return;
  const elevated = a.pos.y > 0.5;
  if (Math.abs(a.pos.x) > (elevated ? 10 : 5.2)) return;
  a.pos.x = THREE.MathUtils.clamp(a.pos.x, -4.8, 4.8);
  a.pos.y = deck;
}

/**
 * 建筑足迹守卫（用户判词：「人物可以穿墙的问题你他妈解决了吗？？？」）。
 *
 * 现场：`terrainHeight()` 在城内恒返回 0，而铺面地坪是 0.30 / 0.34 / 0.36、9 座手工街屋是
 * 0.6–0.86；`behaviors.ts` 的移动积分只改 x/z，也没有任何墙体碰撞——于是行人直接穿过
 * 铺面薄壁，站在台基里只剩上半身露在地板上（用户截图里那截裙摆和手臂）。
 *
 * 这里按**建造时同一份室内参数**（`beltRoomSpecs` / `riverRoomSpecs` / `STREET_HOUSE_SLOTS`）
 * 生成 2903 个铺面足迹，做 16m 网格 + 逐帧推出。台基比墙宽 0.7–0.9m，所以足迹比室内净空
 * 再外扩 0.42m，把人挡在台阶之外，连"站在台基边缘陷进 0.36m"也一并消掉。
 */
interface Foot { x0: number; x1: number; z0: number; z1: number; y: number }

const FOOT_PAD = 0.42;
const FOOT_CELL = 16;
const FOOT_R = 0.34;      // 行人身体半径
let FOOT_GRID: Map<number, Foot[]> | null = null;
/** 守卫累计推移次数（探针用：这个数就是「没有守卫时会发生穿墙/陷地」的人次） */
let GUARD_MOVES = 0;

const footKey = (ix: number, iz: number): number => ix * 65536 + iz;

function addFoot(g: Map<number, Foot[]>, x0: number, x1: number, z0: number, z1: number, y: number): void {
  const f: Foot = { x0, x1, z0, z1, y };
  const i0 = Math.floor(x0 / FOOT_CELL), i1 = Math.floor(x1 / FOOT_CELL);
  const j0 = Math.floor(z0 / FOOT_CELL), j1 = Math.floor(z1 / FOOT_CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = footKey(i, j);
      const arr = g.get(k);
      if (arr) arr.push(f); else g.set(k, [f]);
    }
  }
}

function buildFootGrid(): Map<number, Foot[]> {
  const g = new Map<number, Foot[]>();
  for (const s of beltRoomSpecs()) {
    const hx = (s.w * Math.abs(s.ux) + s.d * Math.abs(s.vx)) / 2 + FOOT_PAD;
    const hz = (s.w * Math.abs(s.uz) + s.d * Math.abs(s.vz)) / 2 + FOOT_PAD;
    addFoot(g, s.cx - hx, s.cx + hx, s.cz - hz, s.cz + hz, s.y0);
  }
  for (const s of riverRoomSpecs()) {
    const hx = (s.w * Math.abs(s.ux) + s.d * Math.abs(s.vx)) / 2 + FOOT_PAD;
    const hz = (s.w * Math.abs(s.uz) + s.d * Math.abs(s.vz)) / 2 + FOOT_PAD;
    addFoot(g, s.cx - hx, s.cx + hx, s.cz - hz, s.cz + hz, s.y0);
  }
  for (const h of STREET_HOUSE_SLOTS) {
    const hx = h.w / 2 + FOOT_PAD, hz = h.d / 2 + FOOT_PAD;
    addFoot(g, h.x - hx, h.x + hx, h.z - hz, h.z + hz, h.y0 ?? 0.6);
  }
  return g;
}

/**
 * 把压进铺面的行人推到最近的外墙面；推不出去（夹在两间之间）就抬到室内地坪。
 * 原地修改（出生点与逐帧都用这一份），返回是否发生过推移。
 */
function pushOutOfBuildings(pos: THREE.Vector3): boolean {
  const g = (FOOT_GRID ??= buildFootGrid());
  const arr = g.get(footKey(Math.floor(pos.x / FOOT_CELL), Math.floor(pos.z / FOOT_CELL)));
  if (!arr) return false;
  let moved = false;  for (let pass = 0; pass < 2; pass++) {
    let hit = false;
    for (const f of arr) {
      if (pos.x < f.x0 - FOOT_R || pos.x > f.x1 + FOOT_R) continue;
      if (pos.z < f.z0 - FOOT_R || pos.z > f.z1 + FOOT_R) continue;
      const dl = pos.x - (f.x0 - FOOT_R), dr = (f.x1 + FOOT_R) - pos.x;
      const db = pos.z - (f.z0 - FOOT_R), df = (f.z1 + FOOT_R) - pos.z;
      const m = Math.min(dl, dr, db, df);
      if (m <= 0.002) continue;
      if (m === dl) pos.x = f.x0 - FOOT_R;
      else if (m === dr) pos.x = f.x1 + FOOT_R;
      else if (m === db) pos.z = f.z0 - FOOT_R;
      else pos.z = f.z1 + FOOT_R;
      hit = true;
      GUARD_MOVES++;
    }
    if (!hit) return moved;
    moved = true;
  }
  // 两次都推不出去：至少别陷在地板下
  for (const f of arr) {
    if (pos.x <= f.x0 - FOOT_R || pos.x >= f.x1 + FOOT_R) continue;
    if (pos.z <= f.z0 - FOOT_R || pos.z >= f.z1 + FOOT_R) continue;
    if (pos.y < f.y) pos.y = f.y;
  }
  return moved;
}

/**
 * R27 落位收敛：出生兜底与逐帧兜底共用的唯一函数，判定口径与 collisionAudit() 完全一致
 * （embedded = solidBlocked 命中；sunken = walkSurfaceY 高于脚下 0.3m 以上）。
 *
 * 修前的真根因：出生时 walkSurfaceY(x,z,y) 落在「墙带」返回 null，只调 pushOutOfBuildings
 * 改 x/z 却不重查行走面 → 新位置有 0.6~9.9m 台基/楼板，人仍停在 y=0；只能靠逐帧兜底
 * 每 8 帧慢慢救，实测加载 3s 后仍有 121 个陷地、行走后 22 个。这里改为出生即收敛：
 *   ① solidPushOut 推出实心墙；
 *   ② 贴行走面并迭代到稳定（walkSurfaceY 的结果依赖 fromY，一次赋值不稳）；
 *   ③ 仍不达标则在同心环上确定性找合法落脚点（不用 Math.random、不消耗共享 RNG）。
 */
function settleWalkPos(pos: THREE.Vector3, r = 0.34): boolean {
  const H = 1.7;
  const ok = (x: number, y: number, z: number): boolean => {
    if (solidBlocked(x, z, r, y, H)) return false;
    const sy = walkSurfaceY(x, z, y);
    return sy === null || y >= sy - 0.3;
  };
  solidPushOut(pos, r, pos.y);
  for (let i = 0; i < 4; i++) {
    let sy = walkSurfaceY(pos.x, pos.z, pos.y);
    if (sy === null) {
      pushOutOfBuildings(pos);
      sy = walkSurfaceY(pos.x, pos.z, pos.y);
      if (sy === null) sy = walkSurfaceY(pos.x, pos.z);
    }
    if (sy !== null && Math.abs(pos.y - sy) > 0.02) pos.y = sy;
    else break;
  }
  if (ok(pos.x, pos.y, pos.z)) return true;
  const ox = pos.x, oz = pos.z, oy = pos.y;
  for (let ring = 1; ring <= 18; ring++) {
    const rad = ring * 0.85;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const nx = ox + Math.cos(ang) * rad, nz = oz + Math.sin(ang) * rad;
      const sy = walkSurfaceY(nx, nz, oy);
      const ny = sy !== null ? sy : oy;
      if (!ok(nx, ny, nz)) continue;
      pos.set(nx, ny, nz);
      return true;
    }
  }
  return false;
}

const DARK = new THREE.Color(0x241f1a);const STRAW = new THREE.Color(0xa8905a);
const HORN = new THREE.Color(0x3a3028);
const IRON = new THREE.Color(0x767a84);   // 甲胄铁色（W6：兵与更夫）
const CANVAS = new THREE.Color(0xa89570); // 围裙麻布（W6：庖厨与摊贩）
const _c = new THREE.Color();

// ============ WS-5 角色分型：5 体型档 / 4 衣制 / 佩件分档 ============
// 分型只落在实例矩阵与实例色上：不新增材质、不逐帧建对象
interface BuildDef { h: number; w: number; stride: number; stoop: number; belly: number }

const BUILDS: BuildDef[] = [
  { h: 0.94, w: 1.12, stride: 0.92, stoop: 0.06, belly: 0.06 },   // 矮壮：脚夫/车夫/纤夫
  { h: 1.00, w: 1.00, stride: 1.00, stoop: 0.00, belly: 0.00 },   // 标准：行人/伙计/守卒
  { h: 1.06, w: 0.90, stride: 1.10, stoop: 0.02, belly: -0.04 },  // 修长：文士/官人
  { h: 0.98, w: 1.08, stride: 0.86, stoop: 0.04, belly: 0.15 },   // 丰腴：商贾/妇人
  { h: 0.92, w: 0.96, stride: 0.74, stoop: 0.38, belly: 0.02 },   // 佝偻：老者/乞丐
];

const OCC_BUILD: Record<string, number> = {
  porter: 0, peddler: 0, farmer: 0, tracker: 0, sailor: 0, brawler: 0, acrobat: 0, camelDriver: 0,
  scholar: 2, official: 2, storyteller: 2, musician: 2, sitter: 2,
  merchant: 3, lady: 3, drinker: 3, vendor: 3,
  beggar: 4, fisher: 4, watchman: 4,
};

interface GarmentDef { hemR: number; hemY: number; hemLen: number; sleeve: number; cloak: boolean; sash: boolean; cuff: boolean; stride: number }

const GARMENTS: GarmentDef[] = [
  { hemR: 0.30, hemY: -0.26, hemLen: 0.24, sleeve: 0.55, cloak: false, sash: false, cuff: false, stride: 1.00 }, // 短褐
  { hemR: 0.34, hemY: -0.26, hemLen: 0.62, sleeve: 0.95, cloak: false, sash: true, cuff: true, stride: 0.80 },  // 长衫
  { hemR: 0.35, hemY: -0.26, hemLen: 0.55, sleeve: 0.82, cloak: true, sash: false, cuff: true, stride: 0.86 },  // 披风
  { hemR: 0.44, hemY: -0.20, hemLen: 0.58, sleeve: 0.72, cloak: false, sash: true, cuff: true, stride: 0.74 },  // 襦裙
];

// [短褐, 长衫, 披风, 襦裙]
const OCC_GARMENT: Record<string, number[]> = {
  porter: [8, 2, 0, 0], peddler: [7, 3, 0, 0], farmer: [9, 1, 0, 0], tracker: [9, 1, 0, 0],
  sailor: [8, 2, 0, 0], brawler: [6, 2, 2, 0], kid: [8, 2, 0, 0], fisher: [7, 0, 3, 0],
  beggar: [9, 1, 0, 0], soldier: [6, 0, 4, 0], customer: [2, 7, 1, 0], vendor: [2, 7, 1, 0],
  scholar: [0, 8, 2, 0], official: [0, 5, 5, 0], monk: [0, 9, 1, 0], taoist: [0, 8, 2, 0],
  merchant: [0, 5, 5, 0], lady: [0, 0, 3, 7], musician: [0, 2, 0, 8], sitter: [0, 8, 0, 2],
  storyteller: [0, 9, 1, 0], drinker: [2, 8, 0, 0], gambler: [3, 7, 0, 0],
  watchman: [7, 3, 0, 0], acrobat: [6, 3, 1, 0], camelDriver: [6, 0, 4, 0],
};
const GARMENT_DEFAULT = [3, 6, 1, 0];

// ============ W6 人物分型：冠 8 / 服 6 / 鞋 3 / 持物 8 / 劳动姿态 3 ============
// 分型只落在「换几何池 + 换实例色 + 换关节角」，不新增材质、不逐帧建对象、不动 MAX_HUMANS。
// 冠 8 型：0 无 / 1 幞头(官·吏) / 2 斗笠(农·船) / 3 妇人发髻+簪 / 4 东坡巾(士人) / 5 幅巾(商贩) / 6 僧帽 / 7 道冠 / 8 总角(童)
const HAT_POOL: string[] = ['hatFlat', 'hatFlat', 'hatCone', 'bun', 'hatDongpo', 'hatFujin', 'hatMonk', 'hatDao', 'hairKid'];
/** 冠帽落座点 [y, z]（头部局部坐标：球心 = 原点，r = 0.135） */
const HAT_SEAT: [number, number][] = [[0, 0], [0.17, 0], [0.21, 0], [0.15, -0.07], [0.02, -0.01], [0, 0], [0.01, 0], [0.07, -0.01], [0, 0]];
/** 冠帽固定色档（<0 = 改用衣色 × HAT_TINT）：发髻/幞头/道冠/总角是深色硬质，不随衣裳走；斗笠是篾黄 */
const HAT_HEX: number[] = [-1, 0x1e1e26, 0xb09a62, 0x2a201a, -1, -1, -1, 0x22242c, 0x322620];
/** 冠帽衣色压暗档（仅对 HAT_HEX < 0 的布巾生效）：东坡巾 0.45 最深、幅巾 0.80、僧帽 0.95 */
const HAT_TINT: number[] = [0.55, 0.55, 1, 0.30, 0.45, 0.80, 0.95, 0.34, 0.26];
/** 职业 → 冠型：顶戴即身份 */
const OCC_HAT: Record<string, number> = {
  official: 1, soldier: 1, watchman: 1,
  scholar: 4, storyteller: 4, sitter: 4,
  merchant: 5, vendor: 5, peddler: 5, customer: 5, gambler: 5, drinker: 5, brawler: 5, camelDriver: 5, acrobat: 5,
  farmer: 2, fisher: 2, tracker: 2, sailor: 2, porter: 2, beggar: 2,
  lady: 3, musician: 3, monk: 6, taoist: 7, kid: 8,
};
/** 换冠概率：僧/道/童/女/兵必戴（1.0），官/士高档，农/船/脚夫/乞者次之，市井商贩再低；未列职业 0.72 */
const HAT_FORCE: Record<string, number> = {
  monk: 1, taoist: 1, kid: 1, lady: 1, musician: 1, soldier: 1, watchman: 1,
  official: 0.96, scholar: 0.96,
  farmer: 0.9, fisher: 0.9, tracker: 0.9, sailor: 0.9, porter: 0.9, beggar: 0.9,
  merchant: 0.86, vendor: 0.86, peddler: 0.86, camelDriver: 0.86, storyteller: 0.86, sitter: 0.86,
  customer: 0.8, gambler: 0.8, drinker: 0.8, brawler: 0.8, acrobat: 0.8,
};
/** 女职：只有这两个职业允许"妇人发髻+簪"，其余职业抽到第 4 档一律改回本型冠 */
const FEMALE_OCC = new Set(['lady', 'musician']);

// 服 6 型：0 长袍(士人·下摆及踝) 1 短褐(劳动者·及膝) 2 襦裙(女·两截) 3 直裰(僧道·直筒) 4 甲胄(兵) 5 围裙(庖厨·摊贩)
interface SilDef { hemR: number; hemLen: number; hemY: number; sleeve: number; skirt: boolean; armor: boolean; apron: boolean }
const SILHOUETTES: SilDef[] = [
  { hemR: 0.36, hemLen: 0.70, hemY: -0.24, sleeve: 1.05, skirt: false, armor: false, apron: false }, // 长袍：及踝、宽袖
  { hemR: 0.30, hemLen: 0.30, hemY: -0.22, sleeve: 0.62, skirt: false, armor: false, apron: false }, // 短褐：过膝、窄袖
  { hemR: 0.46, hemLen: 0.62, hemY: -0.18, sleeve: 0.88, skirt: false, armor: false, apron: false }, // 襦裙：下摆最阔（两截靠腰封读）
  { hemR: 0.00, hemLen: 0.00, hemY: 0.00, sleeve: 1.18, skirt: true, armor: false, apron: false },  // 直裰：直筒无喇叭（band 池拉长）
  { hemR: 0.31, hemLen: 0.30, hemY: -0.24, sleeve: 0.55, skirt: false, armor: true, apron: false },  // 甲胄：短摆 + 胸甲披膊
  { hemR: 0.30, hemLen: 0.32, hemY: -0.22, sleeve: 0.58, skirt: false, armor: false, apron: true },  // 围裙：短摆 + 前襟围腰
];
const OCC_SIL: Record<string, number> = {
  official: 0, scholar: 0, merchant: 0, storyteller: 0, sitter: 0, drinker: 0, gambler: 0, camelDriver: 0,
  lady: 2, musician: 2,
  monk: 3, taoist: 3,
  soldier: 4, watchman: 4,
  vendor: 5,
  porter: 1, farmer: 1, tracker: 1, sailor: 1, beggar: 1, kid: 1, peddler: 1, brawler: 1, fisher: 1, customer: 1, acrobat: 1,
};

// 鞋 3 型：0 翘头履 / 1 草鞋 / 2 赤足（赤足 = foot 池缩到脚形 + 肤色，不新增池）
const OCC_SHOE: Record<string, number> = {
  official: 0, scholar: 0, merchant: 0, lady: 0, musician: 0, sitter: 0, drinker: 0, gambler: 0,
  storyteller: 0, customer: 0, vendor: 0, camelDriver: 0,
  porter: 1, farmer: 1, tracker: 1, sailor: 1, peddler: 1, watchman: 1, soldier: 1, monk: 1, taoist: 1, brawler: 1, acrobat: 1,
  beggar: 2, fisher: 2, kid: 2,
};

// 持物 8 型（独立池，挂在手上/肩上）：扁担 carryPole / 伞 umbrella / 扇 fan / 书卷 scroll / 篮 basket / 鱼竿 rod / 算盘 abacus / 旗幡 bannerPole
/** 职业专属持物：[池名, 概率]。未命中的仍走 jobs.props 既有配比 */
const OCC_PROP: Record<string, [string, number]> = {
  fisher: ['rod', 0.62], merchant: ['abacus', 0.34], gambler: ['abacus', 0.26],
  vendor: ['bannerPole', 0.14], official: ['scroll', 0.50], scholar: ['scroll', 0.40],
};

/** 性别/年龄身高（整组实例缩放）：女 ×0.94、儿童 ×0.62 */
const OCC_SCALE: Record<string, number> = { lady: 0.94, musician: 0.94, kid: 0.62 };


// ===== WS-27 CARD-ID BEGIN =====（纯函数块：无 THREE / 无 DOM，可被外部脚本原样抽取执行复核）
// 卡 id → 确定性外观身份。四层量：
//  ① 身份三元组 slot ∈ [0,200) = 体型 5 × 衣制 4 × 衣色 10：
//     slot = (ordinal·137 + 41 + fnv1a(id 前缀)) mod 200；137 与 200 互质 ⇒ ordinal ↗ slot 在 [0,200) 上是双射，
//     于是「同屏多人三元组不重复」是构造保证，不是概率（纯哈希取模在 20 人同框下约六成概率撞车）。
//  ② ordinal 由 id 末段决定：纯数字直取，字母段（CH-C-N01）整体后移到 CARD_LETTER_BASE 之后，
//     避免两段共用同一串 ordinal 而整体重合 —— 这是实测抓到的真实缺陷（30 张市井 NPC 卡）。
//  ③ 区域明度分级（人间 ×1.00 / 天宫 ×1.10 / 地府 ×0.86）：色相档仍严格 10 档，跨区撞槽时色值必然不同。
//  ④ 身高/肩宽 ±4%、配件、斗笠、肤色/裤色/道具/入场尺度：独立哈希比特，与 slot 去相关。
// 取舍：5 档上任何保持单射的映射都只能是置换，故「按 group 偏置体型权重」与「三元组不重复」互斥；
//       本实现优先硬指标，group 偏置落在不参与唯一性的维度（配件概率 / 斗笠 / 身高肩宽微调 / 区域明度）。
//       243 张卡 > 200 个槽位，鸽笼决定索引三元组必有跨区重复（实测 65 对，且全部跨区）；
//       叠加区域明度后，视觉三元组（体型 · 衣制 · 实际衣色）实测 243/243 全唯一。
// [无, 伞, 书箱]：扇/担子/货筐/斗笠走既有 job.props 与 hat，见分档表
const OCC_ACC: Record<string, number[]> = {
  lady: [6, 4, 0], scholar: [4, 3, 3], official: [6, 3, 1], merchant: [8, 2, 0], vendor: [8, 2, 0],
  customer: [9, 1, 0], monk: [9, 1, 0], taoist: [9, 1, 0], farmer: [9, 1, 0], fisher: [9, 1, 0],
  sitter: [8, 1, 1], drinker: [9, 1, 0], storyteller: [10, 0, 0],
};
const STRAW_HAT: Record<string, number> = { farmer: 0.85, fisher: 0.9, beggar: 0.55, porter: 0.35, tracker: 0.5, camelDriver: 0.5 };

const CARD_SLOTS = 200;
const CARD_STRIDE = 137;
const CARD_ORIGIN = 41;
/** 字母后缀段（CH-C-N01）的 ordinal 基址：给数字段留 1..127（现网最大 108），两段并集仍 < 200 */
const CARD_LETTER_BASE = 128;
/** 衣色 10 档：全部取自 jobs.ts 既有 cloth 主色（去同族近色后按色相排），维持汴京同一低饱和土色系 */
const CARD_PALETTE: number[] = [0x8a6a3a, 0x5a7a8a, 0x8a7a5a, 0x4a6a5a, 0x7a5a5a, 0x6a6a7a, 0x9a5a7a, 0x2e4e5e, 0xa84e3e, 0x9a8a4a];
/** 区域明度分级（/256）：人间 1.00 / 天宫 1.10 偏亮 / 地府 0.86 偏暗。色相仍严格 10 档 */
const CARD_TINT: number[] = [256, 282, 220];
const CARD_HAT_DEFAULT = [1, 3, 3, 2];

/** FNV-1a 32：字符串 → 哈希。逐 UTF-16 码元 + Math.imul，纯整数运算，跨平台跨会话一致 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** murmur3 fmix32：uint32 上的双射搅匀，让 …001 与 …002 这类相邻 id 落到相距很远的比特 */
function mix32(v: number): number {
  let h = v >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 卡 id → 32 位种子（跨会话稳定，驱动动作相位与各维抽签） */
export function cardSeed(id: string): number { return mix32(fnv1a(id)); }

/**
 * 卡 id → 身份槽位 [0,200)。
 * ordinal：纯数字后缀直接取值；字母后缀（CH-C-N01…N30）落到 CARD_LETTER_BASE 之后，
 * 避免与数字段共用同一串 ordinal 而整体重合。ordinal 互异且 < 200 ⇒ 槽位双射。
 * 前缀哈希只平移整段（常量），不破坏段内双射。
 */
export function cardSlot(id: string): number {
  let n = 0, mul = 1, i = id.length - 1;
  while (i >= 0 && mul <= 1e9) {
    const d = id.charCodeAt(i) - 48;
    if (d < 0 || d > 9) break;
    n += d * mul; mul *= 10; i--;
  }
  const lettered = i >= 0 && id.charCodeAt(i) > 57 ? CARD_LETTER_BASE : 0;
  const shift = fnv1a(i >= 0 ? id.substring(0, i + 1) : '') % CARD_SLOTS;
  return ((n + lettered) * CARD_STRIDE + CARD_ORIGIN + shift) % CARD_SLOTS;
}

export interface CardLook {
  b: number; g: number; c: number; color: number;
  hm: number; wm: number;
  u: number; v: number; w: number; x: number; p: number; s: number; r: number;
  seed: number;
}

/** 卡 id 区域：0 人间 / 1 天宫 / 2 地府（world-atoms.json characters 243 张的命名段） */
export function cardRealm(id: string): number {
  if (id.indexOf('-T-') >= 0) return 1;
  if (id.indexOf('-D-') >= 0) return 2;
  return 0;
}

/** 区域明度分级：色相档不变，只整体压亮/压暗，使跨区撞槽的卡仍有可辨的色差 */
export function tintHex(color: number, realm: number): number {
  const t = CARD_TINT[realm];
  const r = Math.min(255, (((color >> 16) & 255) * t) >> 8);
  const g = Math.min(255, (((color >> 8) & 255) * t) >> 8);
  const b = Math.min(255, ((color & 255) * t) >> 8);
  return (r << 16) | (g << 8) | b;
}

/** 卡 id → 外观身份（纯函数：同一 id 恒定返回同一结果，跨会话跨机器一致） */
export function cardLook(id: string): CardLook {
  const slot = cardSlot(id);
  const h1 = cardSeed(id);
  const h2 = mix32(h1 ^ 0x9e3779b9);
  const h3 = mix32(h2 ^ 0x85ebca6b);
  const h4 = mix32(h3 ^ 0xc2b2ae35);
  const c = slot / 20 | 0;   // 0..9，与 b/g 一起把 slot 双射到 5×4×10 三元组（不做色板旋转：旋转会让 slot 相差 20k 的卡撞到同色）
  return {
    b: slot % 5, g: (slot / 5 | 0) % 4, c, color: tintHex(CARD_PALETTE[c], cardRealm(id)),
    hm: 1 + ((h2 & 0xffff) / 65535 - 0.5) * 0.08,      // 身高 ±4%
    wm: 1 + ((h2 >>> 16) / 65535 - 0.5) * 0.08,        // 肩宽 ±4%
    u: (h3 & 0xffff) / 65535,
    v: (h3 >>> 16) / 65535,
    w: (h4 & 0xffff) / 65535,
    x: (h4 >>> 16) / 65535,
    p: (h1 & 0xffff) / 65535,
    s: (h1 >>> 16) / 65535,
    r: mix32(h4 ^ 0x27d4eb2f) / 4294967295,
    seed: h1 % 1000,
  };
}

/** 权重表 + 0..1 均量 → 索引（pickW 的确定性版） */
export function pickWeighted(w: number[], q: number): number {
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i];
  if (total <= 0) return 0;
  let r = q * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return w.length - 1;
}

/** 配件按角色概率：0 无 / 1 伞 / 2 书箱（沿用 OCC_ACC 既有权重表） */
export function cardAcc(occ: string, q: number): number { return pickWeighted(OCC_ACC[occ] ?? [10, 0, 0], q); }

/** 斗笠是否顶替空帽位（沿用 STRAW_HAT 既有概率表） */
export function cardStraw(occ: string, q: number): boolean { return q < (STRAW_HAT[occ] ?? 0); }

/** 手持道具（扇/筐/担子等）：按既有 0.8 概率取自 job.props，取档确定性 */
export function cardProp(prop: string[], q: number): string | null {
  if (q >= 0.8 || prop.length === 0) return null;
  const i = (q / 0.8 * prop.length) | 0;
  return prop[i < prop.length ? i : prop.length - 1];
}

/** data.code 本身是否就是卡 id（CH-C-001 / CH-C-N01 / CH-T-073 / CH-D-028 / C-CHR-0007） */
export function isCardId(s: string | null | undefined): boolean {
  return !!s && /^[A-Z]{1,4}-[A-Z]{1,4}-[A-Z0-9]{1,4}$/.test(s);
}
// ===== WS-27 CARD-ID END =====

interface Look {
  b: number; g: number;
  hem: number; cloak: number; sash: number; band: number;
  prop: number; propKind: number;
  head: number; head2: number; headKind: number;
  hm: number; wm: number;   // 身高/肩宽微调（±4%）：确定性卡种按卡种子，其余恒 1
  sil: number; shoe: number; skirt: number; armor: number; apron: number; gs: number;
}

/** 摆口内衬环：法线压向下，靠自遮蔽成暗边（不加材质/纹理，仍走同一实例与同一色） */
function hemInner(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i) * 0.3, nz = n.getZ(i) * 0.3;
    const ny = n.getY(i) * 0.3 - 1;
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  return g;
}

const WARDROBE_DEFS: Record<string, { geo: THREE.BufferGeometry; max: number }> = {
  // WS-21 衣摆：腰收 0.97 / 底 1.24（原 1.00→1.18），下缘接一圈 0.12 高、内收 0.17 的暗内衬。
  // 底沿外径 = 1.24×hemR（长衫 0.42m），步态外扩在 writeActor 里按相位叠乘，几何本身不分左右。
  hem: {
    geo: mergeGeometries([
      new THREE.CylinderGeometry(0.97, 1.24, 1, 10, 1, true).translate(0, -0.5, 0),
      hemInner(new THREE.CylinderGeometry(1.27, 1.10, 0.12, 10, 1, true).translate(0, -1.05, 0)),
    ])!, max: MAX_HUMANS,
  },
  band: { geo: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, -0.5, 0), max: MAX_HUMANS * 3 },
  sash: { geo: new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0), max: MAX_HUMANS },
  cloak: { geo: new THREE.CylinderGeometry(0.5, 0.62, 1, 10, 1, true, Math.PI * 0.5, Math.PI).translate(0, -0.5, 0), max: 1200 },
  umbrella: {
    geo: mergeGeometries([
      new THREE.CylinderGeometry(0.016, 0.016, 0.92, 5).translate(0, 0.46, 0),
      new THREE.ConeGeometry(0.60, 0.22, 10).translate(0, 0.98, 0),
      new THREE.TorusGeometry(0.60, 0.012, 4, 12).rotateX(Math.PI / 2).translate(0, 0.90, 0),
    ])!, max: 1400,
  },
  bookBox: {
    geo: mergeGeometries([
      new THREE.BoxGeometry(0.34, 0.44, 0.20),
      new THREE.BoxGeometry(0.37, 0.06, 0.23).translate(0, 0.22, 0),
      new THREE.BoxGeometry(0.04, 0.62, 0.04).translate(-0.13, 0.04, -0.16),
      new THREE.BoxGeometry(0.04, 0.62, 0.04).translate(0.13, 0.04, -0.16),
    ])!, max: 400,
  },
  horn: { geo: new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0), max: 120 },
  muzzle: { geo: new THREE.BoxGeometry(0.5, 0.5, 1).translate(0, 0, 0.5), max: 40 },
};

class Wardrobe {
  private pools = new Map<string, InstPool>();
  /** 衣装池被拿空时的次数：take() 静默返回 -1 会让角色「少了披风」而不是报错，
   *  所以这里显式计数，spawnCrowd 之后由 assertCapacity 断言为 0。 */
  fails = 0;
  constructor(private scene: THREE.Scene) {
    for (const k of Object.keys(WARDROBE_DEFS)) this.get(k);
    // 小件不投影：省下阴影 pass 的 3 个 draw call，视觉几乎无损
    for (const k of ['band', 'sash', 'umbrella', 'muzzle']) this.get(k).mesh.castShadow = false;
  }
  get(name: string): InstPool {
    let p = this.pools.get(name);
    if (!p) {
      const d = WARDROBE_DEFS[name];
      p = new InstPool(this.scene, d.geo, BODY_MAT, d.max, 'pool_' + name);
      this.pools.set(name, p);
    }
    return p;
  }
  take(name: string, n = 1): number {
    const p = this.get(name);
    const slot = p.mesh.count + n <= p.max ? p.alloc(n) : -1;
    if (slot < 0) this.fails++;
    return slot;
  }
  report(): Record<string, { used: number; max: number }> {
    const out: Record<string, { used: number; max: number }> = {};
    this.pools.forEach((p, k) => { out[k] = { used: p.mesh.count, max: p.max }; });
    return out;
  }
  flush(): void { this.pools.forEach((p) => p.flush()); }
}

const LOOKS = new WeakMap<Actor, Look>();
const WARDROBES = new WeakMap<PoolSet, Wardrobe>();
const BEAST_IDS = new Set<number>();

function take(p: InstPool, n: number): number { return p.mesh.count + n <= p.max ? p.alloc(n) : -1; }

/** 权重表 + 一颗均匀数 → 索引。rng 由调用方给（Crowd 的注入源），不读全局随机。 */
function pickW(w: number[], rng: Random): number {
  let total = 0;
  for (const x of w) total += x;
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}

function makeLook(occ: string, W: Wardrobe, bases: Record<string, number>, sil: number, shoe: number, rng: Random, headKit?: 'bull' | 'horse', card?: CardLook | null): Look {
  const g = card ? card.g : pickW(OCC_GARMENT[occ] ?? GARMENT_DEFAULT, rng);
  const gd = GARMENTS[g];
  const sd = SILHOUETTES[sil];
  const look: Look = {
    b: card ? card.b : (OCC_BUILD[occ] ?? 1), g,
    hem: W.take('hem'),
    cloak: gd.cloak ? W.take('cloak') : -1,
    sash: gd.sash ? W.take('sash') : -1,
    band: W.take('band', 2),
    prop: -1, propKind: 0, head: -1, head2: -1, headKind: 0,
    hm: card ? card.hm : 1, wm: card ? card.wm : 1,
    sil, shoe,
    skirt: sd.skirt ? W.take('band') : -1,   // 直裰：第三根 band 槽当直筒下裳
    armor: sd.armor ? (bases.armor ?? -1) : -1,
    apron: sd.apron ? (bases.apron ?? -1) : -1,
    gs: OCC_SCALE[occ] ?? 1,
  };
  const acc = card ? cardAcc(occ, card.u) : pickW(OCC_ACC[occ] ?? [10, 0, 0], rng);
  if (acc === 1) { look.propKind = 1; look.prop = W.take('umbrella'); }
  else if (acc === 2) { look.propKind = 2; look.prop = W.take('bookBox'); }
  if (headKit === 'bull') { look.headKind = 1; look.head = W.take('horn', 2); }
  else if (headKit === 'horse') { look.headKind = 2; look.head = W.take('horn', 2); look.head2 = W.take('muzzle'); }
  return look;
}

// ============ 劳动姿态三型（W6）：只改关节角，不新增部件 ============
/** 挑担：双臂下垂略外张（扁担压肩，手不过肩）；步幅收短、上身微沉 */
const poseCarry: ActionFn = (v, t, p) => {
  const ph = t * (3.6 + v.speed * 1.6);
  const sw = Math.sin(ph);
  p.legPL = sw * 0.44; p.legPR = -sw * 0.44;
  p.kneeL = Math.max(0, -sw) * 0.55; p.kneeR = Math.max(0, sw) * 0.55;
  p.shPL = 0.10; p.shPR = 0.10; p.spL = 0.24; p.spR = 0.24;
  p.elL = 0.18; p.elR = 0.18;
  p.bodyPitch = 0.05; p.bodyRoll = Math.sin(t * 3.1 + v.seed) * 0.05;
  p.bob = Math.abs(sw) * 0.045;
};
/** 弯腰做活：身前倾 + 微屈膝，双手落在身前低处（拾掇/和面/捶打共用） */
const poseBend: ActionFn = (v, t, p) => {
  const g = Math.sin(t * 2.2 + v.seed);
  p.bodyPitch = 0.68 + g * 0.06;
  p.headPitch = 0.22;
  p.crouch = 0.14;
  p.legPL = 0.16; p.legPR = -0.14; p.kneeL = 0.40; p.kneeR = 0.34;
  p.shPL = 0.62 + g * 0.18; p.shPR = 0.58 - g * 0.18;
  p.spL = 0.30; p.spR = 0.30; p.elL = 0.52; p.elR = 0.46;
  p.bob = Math.abs(g) * 0.012;
};
/** 坐：臀低于膝（膝角 ≥ 2.1 > 髋角 1.9），上身微前倾 */
const poseSit: ActionFn = (v, t, p) => {
  p.crouch = 0.84;
  p.legPL = -1.94; p.legPR = -1.90;
  p.kneeL = 2.14; p.kneeR = 2.08;
  p.bodyPitch = 0.12;
  p.shPL = 0.52; p.shPR = 0.52; p.spL = 0.26; p.spR = 0.26;
  p.elL = 0.86; p.elR = 0.86;
  p.bob = Math.sin(t * 1.1 + v.seed) * 0.008;
};
const LABOR: Record<string, ActionFn> = { carry: poseCarry, bend: poseBend, sit: poseSit };

/** 既有动作 → 劳动姿态档：不换动作表，只在关节层压一档（挑/作/坐三类世相） */
const LABOR_OF: Record<string, 'carry' | 'bend' | 'sit'> = {
  carryPole: 'carry',
  cook: 'bend', write: 'bend', sweep: 'bend', hammerAnvil: 'bend',
  sitTea: 'sit', sitNap: 'sit', fishSit: 'sit',
};
const LABOR_POSE: Record<'carry' | 'bend' | 'sit', (p: Pose) => void> = {
  // 扁担已压在肩上，两臂改为下垂略外张（原动作把手臂举到 1.35 rad，像举杠铃）
  carry(p) {
    p.shPL = 0.10; p.shPR = 0.10;
    if (p.spL < 0.22) p.spL = 0.22;
    if (p.spR < 0.22) p.spR = 0.22;
    if (p.elL > 0.30) p.elL = 0.30;
    if (p.elR > 0.30) p.elR = 0.30;
    p.bodyPitch += 0.04;
  },
  // 案前俯身：书写 / 烹制 / 洒扫 / 捶打一律压到 0.55 以上
  bend(p) {
    if (p.bodyPitch < 0.55) p.bodyPitch = 0.55;
    if (p.headPitch < 0.12) p.headPitch = 0.12;
    if (p.crouch < 0.10) p.crouch = 0.10;
  },
  // 坐：膝高于胯（臀低于膝）
  sit(p) {
    if (p.crouch < 0.78) p.crouch = 0.78;
    if (p.legPL > -1.85) p.legPL = -1.85;
    if (p.legPR > -1.85) p.legPR = -1.85;
    if (p.kneeL < 2.00) p.kneeL = 2.00;
    if (p.kneeR < 2.00) p.kneeR = 2.00;
  },
};

// ============ 角色 LOD 四档（R12）============
// <60m 高模（全身 19 部件 + 逐关节动作）/ 60–200m 中模（躯干+头+冠+单段四肢）/
// 200–600m 低模（1 个 lodLow 槽：四棱锥袍身 + 球头）/ >600m 剪影（lodSil 交叉双面片）。
// 滞回与 engine 的 LodManager 同构：进入阈值 / 退出阈值 = 进入 ×1.25；
// 目标档未就绪 → 保留上一档（禁止隐藏），近档兜底优先退回最近可用档。
// 角色 LOD 由 crowd 自己驱动，不反向依赖 engine（避免 actors ← engine 循环依赖）。
export const LOD_ENTER = [60, 200, 600];
export const LOD_EXIT = [75, 250, 750];

export function resolveActorLod(current: number, dist: number): number {
  let t = current < 0 ? 0 : current > 3 ? 3 : current;
  while (t > 0 && dist < LOD_ENTER[t - 1]) t--;
  while (t < 3 && dist > LOD_EXIT[t]) t++;
  return t;
}

export interface ActorLodState {
  tier: number; prev: number;
  low: number; sil: number;
  switches: number; blocked: number; fallbacks: number;
  lowFull: boolean; silFull: boolean;
}
const LODS = new WeakMap<Actor, ActorLodState>();
export function lodStateOf(a: Actor): ActorLodState {
  let s = LODS.get(a);
  if (!s) {
    s = { tier: -1, prev: -1, low: -1, sil: -1, switches: 0, blocked: 0, fallbacks: 0, lowFull: false, silFull: false };
    LODS.set(a, s);
  }
  return s;
}

/** 中模（60–200m）：躯干 / 头 / 冠 / 上臂 / 大腿，单段动作；小件与衣制附加全不写 */
function writeActorMid(cs: PoolSet, a: Actor, t: number): void {
  const look = LOOKS.get(a);
  const bd = BUILDS[look ? look.b : 1];
  const hJit = look ? look.hm : 1;
  const wJit = bd.w * (look ? look.wm : 1);
  const gs = look ? look.gs : 1;
  const swing = Math.sin(t * (4.2 + a.speed * 1.7) + a.seed) * 0.5;
  _e.set(0, a.yaw, 0); _q.setFromEuler(_e);
  _v.set(a.pos.x, a.pos.y + a.yOff, a.pos.z);
  _sv.setScalar(a.scale * bd.h * hJit * gs);
  MS[0].compose(_v, _q, _sv);
  loc(MS[1], MS[0], 0, 1.14, 0, 0.05, 0, 0, wJit * (1 + bd.belly), 1, wJit * (1 + bd.belly * 0.55));
  loc(MS[2], MS[0], 0, 1.64, 0, 0, 0, 0);
  cs.get('torso').set(a.slots.torso, MS[1], a.cloth);
  cs.get('head').set(a.slots.head, MS[2], a.skin);
  if (a.hat > 0 && a.slots.hat !== undefined) {
    const seat = HAT_SEAT[a.hat] ?? HAT_SEAT[1];
    loc(MS[3], MS[2], 0, seat[0], seat[1], 0, 0, 0);
    const fixed = HAT_HEX[a.hat] ?? -1;
    if (fixed >= 0) _c.setHex(fixed);
    else _c.copy(a.cloth).multiplyScalar(HAT_TINT[a.hat] ?? 0.55);
    cs.get(a.hatPool).set(a.slots.hat, MS[3], _c);
  }
  loc(MS[4], MS[0], -0.275 * wJit, 1.42, 0, -swing, 0, -0.09);
  loc(MS[6], MS[0], 0.275 * wJit, 1.42, 0, swing, 0, 0.09);
  loc(MS[8], MS[0], -0.125 * wJit, 0.94, 0, -swing, 0, 0);
  loc(MS[10], MS[0], 0.125 * wJit, 0.94, 0, swing, 0, 0);
  const armU = cs.get('armU'), legU = cs.get('legU');
  armU.set(a.slots.armU, MS[4], a.cloth);
  armU.set(a.slots.armU + 1, MS[6], a.cloth);
  legU.set(a.slots.legU, MS[8], a.pants);
  legU.set(a.slots.legU + 1, MS[10], a.pants);
}

/** 低模 / 剪影（>200m）：单槽写入；槽按需懒分配，拿不到 → 返回 false 交给近档兜底 */
function writeActorFar(cs: PoolSet, a: Actor, tier: number): boolean {
  const ls = lodStateOf(a);
  const far = tier === 3;
  const poolName = far ? 'lodSil' : 'lodLow';
  let slot = far ? ls.sil : ls.low;
  if (slot < 0) {
    if (far ? ls.silFull : ls.lowFull) return false;
    const p = cs.get(poolName);
    if (p.mesh.count + 1 > p.max) { if (far) ls.silFull = true; else ls.lowFull = true; return false; }
    slot = p.alloc(1);
    if (far) ls.sil = slot; else ls.low = slot;
  }
  const look = LOOKS.get(a);
  const h = (look ? look.hm : 1) * (look ? look.gs : 1);
  _e.set(0, a.yaw, 0); _q.setFromEuler(_e);
  _v.set(a.pos.x, a.pos.y + a.yOff, a.pos.z);
  _sv.setScalar(a.scale * h);
  MS[0].compose(_v, _q, _sv);
  if (far) _c.copy(a.cloth).multiplyScalar(0.55);
  else _c.copy(a.cloth);
  cs.get(poolName).set(slot, MS[0], _c);
  return true;
}

/** 把一个角色的当前姿态写入实例池 */
export function writeActor(cs: PoolSet, a: Actor, t: number, tier = 0): boolean {
  if (BEAST_IDS.has(a.id)) { hideActor(cs, a); return true; }
  if (tier === 1) { writeActorMid(cs, a, t); return true; }
  if (tier >= 2) return writeActorFar(cs, a, tier);
  const W = WARDROBES.get(cs);
  const look = W ? LOOKS.get(a) : undefined;
  const bd = BUILDS[look ? look.b : 1];
  const gd = GARMENTS[look ? look.g : 1];
  const sd = SILHOUETTES[look ? look.sil : 0];
  // WS-27 卡外观微调：身高 ±4% 并入根缩放，肩宽 ±4% 并入躯干 / 肩点 / 胯点横向
  const hJit = look ? look.hm : 1;
  const wJit = bd.w * (look ? look.wm : 1);
  // 劳动姿态（W6）：ACTIONS 优先，其次 LABOR —— 显式 action='carry'/'bend'/'sit' 可直接驱动
  const fn = ACTIONS[a.action] ?? LABOR[a.action] ?? ACTIONS.stand;
  _view.speed = a.speed; _view.seed = a.seed; _view.scale = a.scale; _view.t = t;
  _view.actionT = a.actionT;
  // Pose 共享对象污染修复：完整重置全部 26 个姿态字段（任一残留都会跨动作泄漏）
  _pose.rootPitch = 0; _pose.rootRoll = 0; _pose.bob = 0; _pose.crouch = 0;
  _pose.bodyPitch = 0; _pose.bodyRoll = 0; _pose.headYaw = 0; _pose.headPitch = 0;
  _pose.shPL = 0; _pose.shPR = 0; _pose.spL = 0.09; _pose.spR = 0.09; _pose.elL = 0; _pose.elR = 0;
  _pose.legPL = 0; _pose.legPR = 0; _pose.kneeL = 0; _pose.kneeR = 0;
  _pose.propHand = 0; _pose.propEX = 0; _pose.propEY = 0; _pose.propEZ = 0; _pose.propLen = 0;
  _pose.halo = 0; _pose.aura = 0;
  fn(_view, a.actT, _pose);
  // 劳动姿态叠加：既有动作（挑担/案前做活/坐）在关节层再压一档；只改角度，不加部件
  const lab = ACTIONS[a.action] ? LABOR_OF[a.action] : undefined;
  if (lab) LABOR_POSE[lab](_pose);

  // 手持道具时手臂摆动阻尼：长柄道具（杖/枪/刀）经前臂矩阵放大后会狂舞
  if (a.propPool) {
    _pose.shPL *= 0.3; _pose.shPR *= 0.3;
    _pose.elL *= 0.5; _pose.elR *= 0.5;
    _pose.bodyRoll *= 0.5;
  }

  // 体型档：佝偻前倾 + 步幅（腿摆/膝弯）缩放
  if (bd.stoop > 0) {
    _pose.bodyPitch += bd.stoop * 0.5;
    _pose.headPitch -= bd.stoop * 0.42;
    _pose.crouch += bd.stoop * 0.1;
  }
  const stride = bd.stride * (look ? gd.stride : 1);
  if (stride !== 1) {
    _pose.legPL *= stride; _pose.legPR *= stride;
    _pose.kneeL *= stride; _pose.kneeR *= stride;
  }

  const hF = 1 - _pose.crouch * 0.33;
  _e.set(_pose.rootPitch, a.yaw, _pose.rootRoll);
  _q.setFromEuler(_e);
  _v.set(a.pos.x, a.pos.y + a.yOff + _pose.bob, a.pos.z);
  _sv.setScalar(a.scale * bd.h * hJit * (look ? look.gs : 1)); // 女 ×0.94 / 童 ×0.62：整组实例缩放
  MS[0].compose(_v, _q, _sv);

  // 躯干/头/帽（躯干按肩宽与腹部横向缩放，纵向比例交给根矩阵）
  loc(MS[1], MS[0], 0, 1.14 * hF, 0, _pose.bodyPitch, 0, _pose.bodyRoll, wJit * (1 + bd.belly), 1, wJit * (1 + bd.belly * 0.55));
  loc(MS[2], MS[0], 0, 1.64 * hF, 0, _pose.headPitch + _pose.bodyPitch * 0.55, _pose.headYaw, 0);
  cs.get('torso').set(a.slots.torso, MS[1], a.cloth);
  cs.get('head').set(a.slots.head, MS[2], a.skin);
  // 细节件：腰带（深色束腰）/ 衣领 / 护腕
  _c2.copy(a.pants).multiplyScalar(0.7);
  loc(MS[15], MS[1], 0, -0.16, 0, 0, 0, 0);
  cs.get('belt').set(a.slots.belt, MS[15], _c2);
  _c2.copy(a.cloth).multiplyScalar(0.6);
  loc(MS[15], MS[2], 0, -0.14, 0, 0, 0, 0);
  cs.get('collar').set(a.slots.collar, MS[15], _c2);
  _c2.copy(a.skin).multiplyScalar(0.85);
  loc(MS[15], MS[5], 0, -0.32, 0, 0, 0, 0);
  cs.get('wrist').set(a.slots.wrist, MS[15], _c2);
  loc(MS[15], MS[7], 0, -0.32, 0, 0, 0, 0);
  cs.get('wrist').set(a.slots.wrist + 1, MS[15], _c2);
  // 宽袖大袖（宋制垂袖：挂前臂，随摆臂微荡；袖口宽窄随衣型：直裰最宽、短褐最窄）
  if (a.slots.sleeve !== undefined) {
    const sw = look ? sd.sleeve : 1;
    loc(MS[16], MS[5], 0, -0.14, 0.02, 0.25 + _pose.elL * 0.4 + Math.sin(t * 3 + a.seed) * 0.05, 0, 0.14, sw, 1, sw);
    cs.get('sleeve').set(a.slots.sleeve, MS[16], a.cloth);
    loc(MS[16], MS[7], 0, -0.14, -0.02, 0.25 + _pose.elR * 0.4 + Math.sin(t * 3 + a.seed + 2) * 0.05, 0, -0.14, sw, 1, sw);
    cs.get('sleeve').set(a.slots.sleeve + 1, MS[16], a.cloth);
  }
  // 冠帽八型：落座点按型查表；颜色按型分档（发/冠走固定深色，布巾走衣色压暗，斗笠走篾黄）
  if (a.hat > 0) {
    const seat = HAT_SEAT[a.hat] ?? HAT_SEAT[1];
    loc(MS[3], MS[2], 0, seat[0], seat[1], 0, 0, 0);
    const fixed = HAT_HEX[a.hat] ?? -1;
    if (fixed >= 0) _c.setHex(fixed);
    else _c.copy(a.cloth).multiplyScalar(HAT_TINT[a.hat] ?? 0.55);
    cs.get(a.hatPool).set(a.slots.hat, MS[3], _c);
  }
  if (a.halo) {
    loc(MS[3], MS[2], 0, 0.1, -0.22, 0, 0, 0, 1 + _pose.halo * 0.15, 1 + _pose.halo * 0.15, 1);
    _c.setHex(0xffd25e).multiplyScalar(0.6 + _pose.halo * 0.8);
    cs.get('halo').set(a.slots.halo, MS[3], _c);
    if (_pose.aura > 0) {
      loc(MS[3], MS[0], 0, 0.06, 0, -Math.PI / 2, 0, 0, 1.6 + _pose.aura * 0.5, 1.6 + _pose.aura * 0.5, 1);
      _c.setHex(0x8fe8ff).multiplyScalar(_pose.aura * 0.9);
      cs.get('aura').set(a.slots.aura, MS[3], _c);
    } else cs.get('aura').hide(a.slots.aura);
    // 莲台（神佛脚下）+ 背光圆光（佛菩萨头后）
    const grp = a.data?.group as string | undefined;
    const seated = a.action === 'sitLotus' || a.action === 'meditate' || a.action === 'preach';
    if (a.slots.lotus !== undefined && (grp === 'buddha' || grp === 'deity' || seated)) {
      loc(MS[17], MS[0], 0, -0.02, 0, 0, 0, 0);
      _c.setHex(seated ? 0xffd9a0 : 0xc8b06a).multiplyScalar(0.85);
      cs.get('lotus').set(a.slots.lotus, MS[17], _c);
    } else if (a.slots.lotus !== undefined) cs.get('lotus').hide(a.slots.lotus);
    if (a.slots.mandorla !== undefined && grp === 'buddha') {
      loc(MS[17], MS[2], 0, 0.05, -0.3, 0, 0, 0, 1.35, 1.55, 1);
      _c.setHex(0xa8e8ff).multiplyScalar(0.75);
      cs.get('mandorla').set(a.slots.mandorla, MS[17], _c);
    } else if (a.slots.mandorla !== undefined) cs.get('mandorla').hide(a.slots.mandorla);
  }

  // 四肢（肩宽/胯宽随体型档，再叠卡外观微调 wJit）
  loc(MS[4], MS[0], -0.275 * wJit, 1.42 * hF, 0, -_pose.shPL, 0, -_pose.spL);
  loc(MS[5], MS[4], 0, -0.37, 0, -_pose.elL, 0, 0);
  loc(MS[6], MS[0], 0.275 * wJit, 1.42 * hF, 0, -_pose.shPR, 0, _pose.spR);
  loc(MS[7], MS[6], 0, -0.37, 0, -_pose.elR, 0, 0);
  loc(MS[8], MS[0], -0.125 * wJit, 0.94 * hF, 0, -_pose.legPL, 0, 0);
  loc(MS[9], MS[8], 0, -0.43, 0, _pose.kneeL, 0, 0);
  loc(MS[10], MS[0], 0.125 * wJit, 0.94 * hF, 0, -_pose.legPR, 0, 0);
  loc(MS[11], MS[10], 0, -0.43, 0, _pose.kneeR, 0, 0);
  loc(MS[12], MS[9], 0, -0.41, 0.05, -_pose.kneeL * 0.5, 0, 0);
  loc(MS[13], MS[11], 0, -0.41, 0.05, -_pose.kneeR * 0.5, 0, 0);
  const armU = cs.get('armU'), armL = cs.get('armL'), legU = cs.get('legU'), legL = cs.get('legL'), foot = cs.get('foot');
  armU.set(a.slots.armU, MS[4], a.cloth); armU.set(a.slots.armU + 1, MS[6], a.cloth);
  armL.set(a.slots.armL, MS[5], a.cloth); armL.set(a.slots.armL + 1, MS[7], a.pants);
  legU.set(a.slots.legU, MS[8], a.pants); legU.set(a.slots.legU + 1, MS[10], a.pants);
  legL.set(a.slots.legL, MS[9], a.pants); legL.set(a.slots.legL + 1, MS[11], a.pants);
  // 鞋三型（W6）：0 翘头履 / 1 草鞋（不出翘头履，改草编底+襻带） / 2 赤足（同池缩到脚形 + 肤色）
  const shoe = look ? look.shoe : 0;
  if (shoe === 1 && (a.slots.shoeA ?? -1) >= 0) {
    foot.hide(a.slots.foot); foot.hide(a.slots.foot + 1);
    const st = cs.get('footStraw');
    _c.copy(STRAW).multiplyScalar(0.95);
    st.set(a.slots.shoeA, MS[12], _c);
    st.set(a.slots.shoeA + 1, MS[13], _c);
  } else if (shoe === 2) {
    _c.copy(a.skin).multiplyScalar(0.88);
    loc(MS[20], MS[12], 0, 0.014, -0.012, 0, 0, 0, 0.78, 0.62, 0.84);
    foot.set(a.slots.foot, MS[20], _c);
    loc(MS[20], MS[13], 0, 0.014, -0.012, 0, 0, 0, 0.78, 0.62, 0.84);
    foot.set(a.slots.foot + 1, MS[20], _c);
  } else {
    foot.set(a.slots.foot, MS[12], DARK); foot.set(a.slots.foot + 1, MS[13], DARK);
  }

  // 手持道具（挂在小臂末端）；担子扛在肩上，鱼竿斜挑，算盘端在身前
  if (a.propPool) {
    if (a.propPool === 'carryPole') {
      loc(MS[14], MS[1], 0, 0.30, 0.04, 0, 0, 0.08 + Math.sin(t * 4 + a.seed) * 0.02);
      cs.get(a.propPool).set(a.slots.prop, MS[14], a.cloth);
    } else if (a.propPool === 'rod') {
      // 竿身沿 +y 造，绕 X 前倾 0.95 rad（约 54°）挑向水面前方，避免垂手时插地
      const handM = _pose.propHand < 0 ? MS[5] : MS[7];
      loc(MS[14], handM, 0, -0.30, 0.04, 0.95, 0, 0.16);
      cs.get(a.propPool).set(a.slots.prop, MS[14], _c2.copy(a.cloth).multiplyScalar(1.15));
    } else if (a.propPool === 'abacus') {
      // 算盘端在腹前：摊主/掌柜的"算账"姿势，与走/站动作解耦，姿态稳
      loc(MS[14], MS[1], 0, -0.06, 0.30, 0.35, 0, 0);
      cs.get(a.propPool).set(a.slots.prop, MS[14], _c2.setHex(0xd8c8a8));
    } else {
      const handM = _pose.propHand < 0 ? MS[5] : MS[7];
      loc(MS[14], handM, 0, -0.3 - _pose.propLen, 0, _pose.propEX, _pose.propEY, _pose.propEZ);
      cs.get(a.propPool).set(a.slots.prop, MS[14], a.cloth);
    }
  }

  // ---- 衣制附加几何 + 佩件（全部挂在躯干/前臂/小腿骨架上，无悬空件）----
  if (W && look) {
    if (look.hem >= 0) {
      // 服型六档（W6）：下摆半径/长度取自定义轮廓，长袍及踝、短褐及膝、襦裙最阔、甲胄围裙短摆
      if (sd.skirt) {
        W.get('hem').hide(look.hem); // 直裰不用喇叭摆，改直筒（下条 look.skirt）
      } else {
        // WS-21 步态联动：腿摆相位 |sin| > 0.35 起下摆外扩，满幅沿腿 +0.055m（绝对量，各衣型同口径）。
        // 相位直接取姿态腿角（任何步行动作通用），除以该衣制+体型的满摆角 0.62×步幅阻尼归一化。
        let flare = 1;
        if (sd.hemLen >= 0.5) {
          const la = _pose.legPL < 0 ? -_pose.legPL : _pose.legPL;
          const lb = _pose.legPR < 0 ? -_pose.legPR : _pose.legPR;
          const amp = (la > lb ? la : lb) / (0.62 * gd.stride * bd.stride);
          const f01 = (amp - 0.35) / 0.65;
          if (f01 > 0) flare += (f01 > 1 ? 1 : f01) * 0.055 / (1.24 * sd.hemR);
        }
        // 下摆按重力垂落：反补 0.7 倍躯干前倾，否则前倾时摆口整体后移、膝盖从前面顶出
        loc(MS[18], MS[1], 0, sd.hemY, 0, -_pose.bodyPitch * 0.7, 0, 0, sd.hemR * flare, sd.hemLen, sd.hemR * flare);
        W.get('hem').set(look.hem, MS[18], _c2.copy(a.cloth).multiplyScalar(0.94));
      }
    }
    // 直裰（僧道）：band 池第三槽拉成直筒下裳，从腰垂到脚面，无喇叭口
    if (look.skirt >= 0) {
      loc(MS[18], MS[1], 0, -0.24, 0, -_pose.bodyPitch * 0.8, 0, 0, 0.31, 0.90, 0.31);
      W.get('band').set(look.skirt, MS[18], _c2.copy(a.cloth).multiplyScalar(0.90));
    }
    // 甲胄（兵）：胸甲 + 甲片横带 + 披膊 + 肩吞兽面 + 腹吞，全部在躯干局部坐标
    if (look.armor >= 0) {
      cs.get('armor').set(look.armor, MS[1], _c2.copy(IRON));
    }
    // 围裙（庖厨/摊贩）：前襟围腰 + 腰栏 + 兜袋 + 系带 + 褶线；衣色与麻布各半，避免与长衫同色
    if (look.apron >= 0) {
      cs.get('apron').set(look.apron, MS[1], _c2.copy(a.cloth).lerp(CANVAS, 0.55));
    }
    if (look.cloak >= 0) {
      loc(MS[18], MS[1], 0, 0.30, -0.01, -0.06 + Math.sin(t * 2.6 + a.seed) * 0.03, 0, 0, 0.72, 1.04, 0.72);
      W.get('cloak').set(look.cloak, MS[18], _c2.copy(a.cloth).multiplyScalar(0.82));
    }
    if (look.sash >= 0) {
      loc(MS[18], MS[1], 0, -0.15, 0.20, 0, 0, Math.sin(t * 2.4 + a.seed) * 0.08, 0.10, 0.52, 0.03);
      W.get('sash').set(look.sash, MS[18], _c2.copy(a.cloth).multiplyScalar(1.12));
    }
    if (look.band >= 0) {
      const bp = W.get('band');
      _c2.copy(a.pants).multiplyScalar(0.72);
      if (gd.cuff) {
        loc(MS[18], MS[5], 0, -0.28, 0, 0, 0, 0, 0.085, 0.1, 0.085); bp.set(look.band, MS[18], _c2);
        loc(MS[19], MS[7], 0, -0.28, 0, 0, 0, 0, 0.085, 0.1, 0.085); bp.set(look.band + 1, MS[19], _c2);
      } else {
        loc(MS[18], MS[9], 0, -0.34, 0, 0, 0, 0, 0.082, 0.13, 0.082); bp.set(look.band, MS[18], _c2);
        loc(MS[19], MS[11], 0, -0.34, 0, 0, 0, 0, 0.082, 0.13, 0.082); bp.set(look.band + 1, MS[19], _c2);
      }
    }
    if (look.propKind === 1 && look.prop >= 0) {
      const handM = _pose.propHand < 0 ? MS[5] : MS[7];
      loc(MS[19], handM, 0, -0.3 - _pose.propLen, 0, _pose.propEX * 0.25, 0, 0.1);
      W.get('umbrella').set(look.prop, MS[19], _c2.copy(a.cloth).multiplyScalar(1.05));
    } else if (look.propKind === 2 && look.prop >= 0) {
      loc(MS[19], MS[1], 0, 0.1, -0.27, 0.1, 0, 0);
      W.get('bookBox').set(look.prop, MS[19], _c2.copy(a.pants).multiplyScalar(0.65));
    }
    if (look.headKind === 1 && look.head >= 0) {
      const hp = W.get('horn');
      _c2.copy(HORN);
      loc(MS[19], MS[2], -0.1, 0.12, 0, -0.25, 0, 0.5, 0.1, 0.3, 0.1); hp.set(look.head, MS[19], _c2);
      loc(MS[19], MS[2], 0.1, 0.12, 0, -0.25, 0, -0.5, 0.1, 0.3, 0.1); hp.set(look.head + 1, MS[19], _c2);
    } else if (look.headKind === 2 && look.head >= 0) {
      const hp = W.get('horn');
      _c2.copy(a.skin).multiplyScalar(0.85);
      loc(MS[19], MS[2], -0.09, 0.22, -0.04, -0.2, 0, 0.12, 0.06, 0.16, 0.05); hp.set(look.head, MS[19], _c2);
      loc(MS[19], MS[2], 0.09, 0.22, -0.04, -0.2, 0, -0.12, 0.06, 0.16, 0.05); hp.set(look.head + 1, MS[19], _c2);
      if (look.head2 >= 0) {
        loc(MS[19], MS[2], 0, -0.02, 0.12, 0, 0, 0, 0.2, 0.18, 0.26);
        W.get('muzzle').set(look.head2, MS[19], _c2);
      }
    }
  }
  return true;
}

export function hideActor(cs: PoolSet, a: Actor): void {
  const ls = LODS.get(a);
  if (ls) {
    if (ls.low >= 0) cs.get('lodLow').hide(ls.low);
    if (ls.sil >= 0) cs.get('lodSil').hide(ls.sil);
  }
  cs.get('head').hide(a.slots.head);
  cs.get('torso').hide(a.slots.torso);
  const armU = cs.get('armU'), armL = cs.get('armL'), legU = cs.get('legU'), legL = cs.get('legL'), foot = cs.get('foot');
  armU.hide(a.slots.armU); armU.hide(a.slots.armU + 1);
  armL.hide(a.slots.armL); armL.hide(a.slots.armL + 1);
  legU.hide(a.slots.legU); legU.hide(a.slots.legU + 1);
  legL.hide(a.slots.legL); legL.hide(a.slots.legL + 1);
  foot.hide(a.slots.foot); foot.hide(a.slots.foot + 1);
  if ((a.slots.shoeA ?? -1) >= 0) { cs.get('footStraw').hide(a.slots.shoeA); cs.get('footStraw').hide(a.slots.shoeA + 1); }
  if ((a.slots.armor ?? -1) >= 0) cs.get('armor').hide(a.slots.armor);
  if ((a.slots.apron ?? -1) >= 0) cs.get('apron').hide(a.slots.apron);
  if (a.hat > 0) cs.get(a.hatPool).hide(a.slots.hat);
  cs.get('belt').hide(a.slots.belt);
  cs.get('collar').hide(a.slots.collar);
  cs.get('wrist').hide(a.slots.wrist); cs.get('wrist').hide(a.slots.wrist + 1);
  if (a.slots.sleeve !== undefined) { cs.get('sleeve').hide(a.slots.sleeve); cs.get('sleeve').hide(a.slots.sleeve + 1); }
  if (a.propPool) cs.get(a.propPool).hide(a.slots.prop);
  const W = WARDROBES.get(cs);
  const look = W ? LOOKS.get(a) : undefined;
  if (W && look) {
    if (look.hem >= 0) W.get('hem').hide(look.hem);
    if (look.cloak >= 0) W.get('cloak').hide(look.cloak);
    if (look.sash >= 0) W.get('sash').hide(look.sash);
    if (look.band >= 0) { W.get('band').hide(look.band); W.get('band').hide(look.band + 1); }
    if (look.skirt >= 0) W.get('band').hide(look.skirt);
    if (look.prop >= 0) W.get(look.propKind === 1 ? 'umbrella' : 'bookBox').hide(look.prop);
    if (look.head >= 0) { const hp = W.get('horn'); hp.hide(look.head); hp.hide(look.head + 1); }
    if (look.head2 >= 0) W.get('muzzle').hide(look.head2);
  }
  if (a.halo) {
    cs.get('halo').hide(a.slots.halo); cs.get('aura').hide(a.slots.aura);
    if (a.slots.lotus !== undefined) cs.get('lotus').hide(a.slots.lotus);
    if (a.slots.mandorla !== undefined) cs.get('mandorla').hide(a.slots.mandorla);
  }
}

// ============ 名牌（水浒/神佛头顶名号）：独立图集，144 块 288×84 恰好容于 2048² ============
export class Nameplates {
  private mesh: THREE.InstancedMesh;
  private uvAttr: THREE.InstancedBufferAttribute;
  private uvOf = new Map<string, [number, number, number, number]>();
  private tmpM = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private nearBuf: Actor[] = [];
  constructor(scene: THREE.Scene, _atlas: SignAtlas, names: { code: string; text: string; color: string }[]) {
    void _atlas;
    const atlas = new SignAtlas(); // 名牌专用图集，避免与城市招牌争格溢出
    const geo = new THREE.PlaneGeometry(1.9, 0.62);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas.tex } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec4 uvOff; varying vec2 vUv;
        void main(){
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          c.xy += position.xy * 1.0;
          gl_Position = projectionMatrix * c;
          vUv = uv * uvOff.zw + uvOff.xy;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.08) discard;
          gl_FragColor = c;
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, 28);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.uvAttr = new THREE.InstancedBufferAttribute(new Float32Array(28 * 4).fill(0.0001), 4);
    geo.setAttribute('uvOff', this.uvAttr);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 28; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    for (const n of names) {
      const uv = atlas.text('np_' + n.code, n.text, 288, 84, {
        color: '#ffffff', glow: n.color, fontPx: 56, bg: 'rgba(6,9,18,0.72)',
        border: n.color,
      });
      this.uvOf.set(n.code, uv);
    }
  }

  update(camera: THREE.Camera, heroes: Actor[]): void {
    const camPos = camera.position;
    this.nearBuf.length = 0;
    for (const h of heroes) {
      if (h.hidden) continue;
      const d = h.pos.distanceToSquared(camPos);
      if (d < 64 * 64) this.nearBuf.push(h);
    }
    this.nearBuf.sort((a, b) => a.pos.distanceToSquared(camPos) - b.pos.distanceToSquared(camPos));
    const near = this.nearBuf.length > 28 ? this.nearBuf.slice(0, 28) : this.nearBuf;
    const zero = this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < 28; i++) { this.mesh.setMatrixAt(i, zero); this.uvAttr.setXYZW(i, 0.0001, 0.0001, 0.0002, 0.0002); }
    near.forEach((e2, i) => {
      const s = Math.min(1.6, 0.85 + Math.sqrt(e2.pos.distanceToSquared(camPos)) * 0.012) * e2.scale;
      this.v.set(e2.pos.x, e2.pos.y + e2.yOff + 2.35 * e2.scale, e2.pos.z);
      this.tmpM.compose(this.v, this.q.setFromEuler(this.e.set(0, 0, 0)), this.sv.set(s, s * 0.66, 1));
      this.mesh.setMatrixAt(i, this.tmpM);
      const uv = this.uvOf.get(e2.data?.code ?? '');
      if (uv) this.uvAttr.setXYZW(i, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1]);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
  }
}

// ============ 人群总管 ============
export class Crowd {
  actors: Actor[] = [];
  spots = new SpotRegistry();
  heroes: Actor[] = [];
  density = 1;
  frame = 0;
  isNight = false;
  nameplates: Nameplates | null = null;
  private idSeq = 1;
  private ps: PoolSet;
  private wardrobe: Wardrobe;
  /** spawnCrowd 生成的行走人口（穿行占比等人口学指标的分母；不含 world 另发的坊民/摊档/名将） */
  private spawned = new WeakSet<Actor>();
  /** 最近一次 update 的仿真时间（行为类变化日志按它裁 60s 窗口） */
  private simT = 0;
  /** R27 首帧全量落位收敛：所有 spawn（含首帧 ensureVenues 补建）完成、solids 索引齐备后再跑一次 */
  private settledAll = false;
  private settleAllStat = { checked: 0, fixed: 0, failed: 0 };

  /**
   * @param rng   注入随机源。省略 = 旧路径默认源（Math.random 本体），既有调用点行为不变；
   *              联机 / 回放 / 无头测试必须显式传入种子 RNG，否则出生批次与外观抽签不可复现。
   * @param clock 注入时钟（毫秒）。省略 = 宿主墙钟；联机 / 回放必须传与仿真步同步的时钟，
   *              否则受击到期（impactUntil）会跟着真实时间漂。
   */
  constructor(scene: THREE.Scene, readonly nav: NavGraph, private rng: Random = LEGACY_RNG, private clock: Clock = hostClock) {
    this.ps = new PoolSet(scene);
    this.wardrobe = new Wardrobe(scene);
    WARDROBES.set(this.ps, this.wardrobe);
    // 行走面哈希在构造期建一次（2894 间铺面 + 9 座街屋），之后每次查询一次 Map 取格
    ensureWalkSurface();
    // 清掉上一批角色的避让网格。AVOID 是 behaviors.ts 的模块级表，读档/重建 Crowd 时它上面
    // 还留着**上一个实例**的 actor；不清的话新人群前 3 帧会按旧批位置避让（实测同 seed 复跑
    // 首帧即分叉）。新建进程时它本来就是空表，所以单机旧路径的行为不变。
    rebuildAvoidGrid([]);
    // 同理：BEAST_IDS 按 a.id 记「兽形」，而 idSeq 每个 Crowd 从 1 重新发号。不清掉的话
    // 读档后新角色会继承上一批的 id 而被当成骨犬/灵猴整只隐藏。新建进程时本来就是空集。
    BEAST_IDS.clear();
  }
  /** 守卫累计推移人次（= 没有守卫时会穿墙/陷地的人次） */
  guardMoves(): number { return GUARD_MOVES; }

  /** 行走面哈希规模（探针用：构建期一次，运行期 O(1)） */
  walkSurfaceStats(): { rects: number; cells: number } { return walkSurfaceGridStats(); }

  /** 单点行走面（探针/调试用）：null = 墙带内不可站立 */
  walkSurfaceAt(x: number, z: number, fromY?: number): number | null { return walkSurfaceY(x, z, fromY); }

  /**
   * R27 首帧全量落位收敛。世界装配期间 solids 台账与 WS_GRID 是增量构建的，早于台账
   * 完成就出生的角色会残留「脚下有 0.6~9m 台基、y 却还是 0」。等到首帧（含 ensureVenues
   * 补建的场所人群都在场、索引齐备）对全部人间角色跑一次与 collisionAudit 同口径的
   * settleWalkPos，把嵌墙/陷地在加载阶段一次性清干净，而不是靠逐帧兜底慢慢救。
   */
  settleAll(): {
    checked: number; fixed: number; failed: number;
    before: { embedded: number; sunken: number }; after: { embedded: number; sunken: number };
  } {
    const before = this.collisionAudit();
    let checked = 0, fixed = 0, failed = 0;
    for (const a of this.actors) {
      if (a.hidden || a.attach || a.sky) continue;
      if (a.pos.y < -60 || a.pos.y > 120) continue;
      const ox = a.pos.x, oy = a.pos.y, oz = a.pos.z;
      const ok = settleWalkPos(a.pos, 0.34);
      checked++;
      if (!ok) failed++;
      if (Math.abs(a.pos.x - ox) > 0.01 || Math.abs(a.pos.y - oy) > 0.01
        || Math.abs(a.pos.z - oz) > 0.01) fixed++;
    }
    const after = this.collisionAudit();
    this.settleAllStat = { checked, fixed, failed };
    return {
      checked, fixed, failed,
      before: { embedded: before.embedded, sunken: before.sunken },
      after: { embedded: after.embedded, sunken: after.sunken },
    };
  }

  /** R27 首帧收敛的可断言统计（验收脚本读 window.__qingming.world.crowd.settleStats()） */
  settleStats(): { done: boolean; checked: number; fixed: number; failed: number } {
    return { done: this.settledAll, ...this.settleAllStat };
  }

  /**
   * R27 碰撞可断言统计（验收脚本读 window.__crowd.collision，或直接调用本方法）：
   * embedded = 仍嵌在实心墙里的人数（solidBlocked 命中）；
   * sunken   = 脚下有可站顶面但 y 与该顶面偏差 >0.3m 的人数（陷地/浮空）；
   * sample   = 前若干问题角色的真实坐标，便于实拍复核。
   * 全部遍历 this.actors 真实计算，绝不硬编码 0。
   */
  collisionAudit(): { embedded: number; sunken: number; sample: { id: number; x: number; y: number; z: number }[] } {
    let embedded = 0, sunken = 0;
    const sample: { id: number; x: number; y: number; z: number }[] = [];
    for (const a of this.actors) {
      if (a.hidden || a.attach || a.sky) continue;
      if (a.pos.y < -60 || a.pos.y > 120) continue;           // 只统计人间层
      const hit = solidBlocked(a.pos.x, a.pos.z, 0.34, a.pos.y, 1.7);
      // R27 口径修正：「陷地」参考面改用 walkSurfaceY（R19 已有的多层街屋/桥面/台基
      // 融合行走面），不再用 solidFloorY 的「每 8m 格只留一个最高顶面」——后者会把
      // 同格另一栋楼的 9.9m 楼板当成楼下角色的参考面，实机误报 138 个。
      // 且只判「脚低于行走面」：角色高于地面（楼上/城墙/桥面）不算陷地。
      const sy = walkSurfaceY(a.pos.x, a.pos.z, a.pos.y);
      const off = sy !== null && a.pos.y < sy - 0.3;
      if (hit) embedded++;
      if (off) sunken++;
      if ((hit || off) && sample.length < 16) {
        sample.push({ id: a.id, x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(2) });
      }
    }
    return { embedded, sunken, sample };
  }

  /**
   * 行走面探针（R27）：全城 actor 的 y 与脚下可行走面高差 >0.15m 的人数。
   * 判定集＝真正会在城里走的人（排除天宫 / 地府 / 城墙这些另外世界层与 attach 演员）；
   * 定点演员（freeze）单列，只统计 y<3 的街面/店铺岗位（茶博士这类），15.9m 城墙上的戍卒不计。
   */
  surfaceAudit(): {
    total: number; judged: number; off: number; noSurface: number; maxDelta: number;
    worst: { id: number; occ: string; x: number; y: number; z: number; surface: number; delta: number }[];
    freeze: number; freezeOff: number;
  } {
    const rows: { id: number; occ: string; x: number; y: number; z: number; surface: number; delta: number }[] = [];
    let judged = 0, off = 0, noSurface = 0, maxDelta = 0, freeze = 0, freezeOff = 0;
    for (const a of this.actors) {
      if (a.hidden || a.attach) continue;
      // 天宫 (>120) / 地府 (−260) / 城墙顶 (15.9) 是另外的世界层：行走面表只覆盖人间城内
      if (a.sky || a.pos.y > 60 || a.pos.y < -40) continue;
      const sy = walkSurfaceY(a.pos.x, a.pos.z, a.pos.y);
      if (a.freeze) {
        if (a.pos.y < 3) {
          freeze++;
          if (sy !== null && Math.abs(a.pos.y - sy) > 0.15) freezeOff++;
        }
        continue;
      }
      judged++;
      if (sy === null) { noSurface++; continue; }
      const d = Math.abs(a.pos.y - sy);
      if (d > maxDelta) maxDelta = d;
      if (d > 0.15) {
        off++;
        rows.push({
          id: a.id, occ: a.occ, x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2),
          z: +a.pos.z.toFixed(2), surface: +sy.toFixed(2), delta: +d.toFixed(2),
        });
      }
    }
    rows.sort((p, q) => q.delta - p.delta);
    return {
      total: this.actors.length, judged, off, noSurface,
      maxDelta: +maxDelta.toFixed(3), worst: rows.slice(0, 8), freeze, freezeOff,
    };
  }

  /**
   * 单次查询耗时实测（探针用）：按当前全城角色的真实落点循环 n 次；perFrame5000 = 5000 人一帧的毫秒数。
   * 这里量的是**真实耗时**，所以固定用宿主墙钟（hostClock），不走注入时钟——注入时钟是
   * 仿真刻度（回放时会停在 0 或大步跳），拿它计时只会得到 0ms 或负值。本项不参与 sim 状态。
   */
  surfaceBench(n = 20000): { n: number; ms: number; us: number; perFrame5000: number; checksum: number } {
    ensureWalkSurface();
    const acts = this.actors;
    if (!acts.length) return { n: 0, ms: 0, us: 0, perFrame5000: 0, checksum: 0 };
    let sum = 0;
    const t0 = hostClock();
    for (let i = 0; i < n; i++) {
      const a = acts[i % acts.length];
      const y = walkSurfaceY(a.pos.x, a.pos.z, a.pos.y);
      if (y !== null) sum += y;
    }
    const ms = hostClock() - t0;
    const us = (ms * 1000) / n;
    return { n, ms: +ms.toFixed(2), us: +us.toFixed(3), perFrame5000: +((us * 5000) / 1000).toFixed(3), checksum: +sum.toFixed(2) };
  }

  poolSet(): PoolSet { return this.ps; }

  /**
   * 读只：该点是否落在铺面足迹内，落在里面时返回室内地坪高度（否则 null）。
   * 探针用它量「陷地」：角色 y 低于地坪 = 陷进地板；同时是 admin/调试的入口。
   */
  shopFloorAt(x: number, z: number): number | null {
    const g = (FOOT_GRID ??= buildFootGrid());
    const arr = g.get(footKey(Math.floor(x / FOOT_CELL), Math.floor(z / FOOT_CELL)));
    if (!arr) return null;
    for (const f of arr) {
      if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) return f.y;
    }
    return null;
  }

  spawnActor(o: {
    occ: string; pos: THREE.Vector3; yaw?: number; scale?: number;
    hat?: number; prop?: string | null; halo?: boolean; sky?: boolean;
    cloth?: number; pants?: number; skin?: number; headKit?: 'bull' | 'horse' | 'beast';
    action?: string; doing?: string; data?: Actor['data']; freeze?: boolean;
    cardId?: string;   // WS-27：角色卡 id（如 CH-C-001）。给了就按卡种子定外观，缺省退回既有随机
  }): Actor {
    // 人口池的单点断言：所有角色（摊档/名将/神佛/鬼差/坊民/玩家）都从这里出生，
    // 超限时给出一条可读的原因，而不是让某个部件池的 alloc 在 async init 中间抛错被吞成「加载卡住」
    if (this.actors.length >= MAX_HUMANS) {
      throw new Error(`[人口池断言] 角色数已达 MAX_HUMANS ${MAX_HUMANS}，再 spawn(${o.occ}) 会打断初始化`);
    }
    const job = JOB_MAP.get(o.occ);
    // WS-27 卡外观身份：cardId 显式传入优先；data.code 本身是卡 id 时自动采用；都没有则整条走既有随机路径
    const codeId = o.data?.code;
    const cardId = o.cardId ?? (codeId && isCardId(codeId) ? codeId : null);
    const card = cardId ? cardLook(cardId) : null;
    // 持物：职业专属池优先（鱼竿/算盘/旗幡/书卷），未命中仍走 jobs.props 既有配比
    const pQ = card ? card.p : this.rng();
    const pOv = OCC_PROP[o.occ];
    const pBase = job && job.props.length > 0
      ? (card ? cardProp(job.props, card.p) : (pQ < 0.8 ? job.props[Math.min(job.props.length - 1, (pQ / 0.8 * job.props.length) | 0)] : null))
      : null;
    const propPool = o.prop !== undefined ? o.prop : ((pOv && pQ < pOv[1]) ? pOv[0] : pBase);
    const a: Actor = {
      id: this.idSeq++,
      pos: o.pos.clone(), yaw: o.yaw ?? this.rng() * Math.PI * 2,
      speed: job ? job.speed[0] + this.rng() * (job.speed[1] - job.speed[0]) : 1,
      action: o.action ?? 'stand', actT: this.rng() * 100, timer: this.rng() * 4,
      occ: o.occ, seed: card ? card.seed : this.rng() * 1000,
      // 儿童身高由 OCC_SCALE 统一 ×0.62（整组实例），故基础 scale 取 1，避免与 job.scale 叠乘成矮人
      scale: o.scale ?? (o.occ === 'kid' ? 1 : (job?.scale ? job.scale[0] + (card ? card.r : this.rng()) * (job.scale[1] - job.scale[0]) : 0.9 + (card ? card.r : this.rng()) * 0.24)),
      hat: o.hat ?? (card ? pickWeighted(job ? job.hats : CARD_HAT_DEFAULT, card.v) : pickHat(job ? job.hats : [1, 3, 3, 2], this.rng)),
      cloth: new THREE.Color(o.cloth ?? (card ? card.color : (job ? job.cloth[Math.floor(this.rng() * job.cloth.length)] : 0x6a6a6a))),
      pants: new THREE.Color(o.pants ?? (job ? job.pants[Math.min(job.pants.length - 1, ((card ? card.x : this.rng()) * job.pants.length) | 0)] : 0x3a3a3a)),
      skin: new THREE.Color(o.skin ?? (card ? (card.w < 0.34 ? 0xd8b090 : card.w < 0.67 ? 0xc8a080 : 0xb89070) : (this.rng() < 0.34 ? 0xd8b090 : this.rng() < 0.5 ? 0xc8a080 : 0xb89070))),
      propPool,
      slots: {}, hatPool: '', halo: o.halo ?? false, sky: o.sky ?? false,
      hidden: false, freeze: o.freeze ?? false, attach: null, data: o.data ?? null,
      doing: o.doing ?? (job ? job.label : ''),
      path: [], pathI: 0, pendingAct: '', pendingSpot: false, curDoing: '',
      lastTick: 0, lastWrite: -1, acc: 0, actionT: 0, lastAction: '', impactUntil: 0, yOff: 0, yawVel: 0,
    };
    // 出生贴地兜底（R20）：名将/摊主这类"给定坐标"的角色若落在河道足迹内、脚在岸面高度，
    // 就沿 z 挪到最近岸线（heroes.ts / props.ts 的坐标表横跨河道，源头逐个改会破坏其原意）。
    // 船上（甲板 y>0.4）、泳将（action='swim'，本就该在水里）与桥面除外。
    if (a.pos.y > -0.4 && a.pos.y < 0.4 && a.action !== 'swim'
      && !onBridgeSpan(a.pos.x, a.pos.z) && inRiverFootprint(a.pos.x, a.pos.z, 0.5)) {
      const cz = riverCenterZ(a.pos.x);
      const hw = riverHalfWidth(a.pos.x);
      a.pos.z = cz + (a.pos.z >= cz ? 1 : -1) * (hw + 4.2);
    }
    // 出生行走面贴合（R27）：先看脚下有没有可行走面——
    // 室内/台基/桥面就直接站上去（茶博士 (-36,58) 在茶坊 (–36,62) 室内，不再陷进 0.6m 台基），
    // 真落在墙带里（walkSurfaceY === null）才用旧守卫推出墙面。
    // 出生兜底（R27）：覆盖全部人间角色，含 freeze:true 的仪仗侍卫与玩家。
    // 根因：spawnVenue grid 分支按整数行列直接落点 + freeze，freeze 不进 tickActor，
    // 截图里半嵌进宫墙的正是这批侍卫，只能在出生时修正。
    // 先 solidFloorY 贴地（台基/石板顶面），再 solidPushOut 推出实心墙；
    // 旧 walkSurfaceY / pushOutOfBuildings 保留作 3 类街屋足迹的补充，主判定走全城 solids。
    if (a.pos.y > -0.4 && a.pos.y <= 120 && !a.sky) {
      const fy = solidFloorY(a.pos.x, a.pos.z, a.pos.y);
      if (fy !== null && fy > a.pos.y && fy - a.pos.y <= 0.95) a.pos.y = fy;
      // R27 一次性收敛：与 collisionAudit 同口径，出生即无嵌墙 / 无陷地，不靠逐帧兜底慢慢救。
      settleWalkPos(a.pos, 0.34);
    }
    if (a.hat === 0 && (card ? cardStraw(a.occ, card.s) : this.rng() < (STRAW_HAT[a.occ] ?? 0))) a.hat = 2;
    // W6 冠分型：按职业换冠（僧/道/童/女/兵必戴，官/士高档，其余七至九成）；显式传入的 hat 不覆盖
    const hatId = OCC_HAT[a.occ];
    if (hatId !== undefined && a.hat !== hatId && o.hat === undefined) {
      const hr = ((a.seed * 0.6180339887) % 1 + 1) % 1;
      if (hr < (HAT_FORCE[a.occ] ?? 0.72)) a.hat = hatId;
      // 反向修正：非女职不得戴妇人发髻（jobs.hats 的第 4 档对男性职业无意义，会把人变成妇人）
      else if (a.hat === 3 && !FEMALE_OCC.has(a.occ)) a.hat = hatId;
    }
    a.hatPool = HAT_POOL[a.hat] ?? 'hatFlat';
    // W6 服型与鞋型：按职业定，与卡种子无关（同职业同轮廓，身份靠冠与持物区分）
    const sil = OCC_SIL[a.occ] ?? 0;
    const shoe = OCC_SHOE[a.occ] ?? 0;
    // 同职业内部色彩偏移（每个人独特）；卡种以卡种子定色，不再叠随机偏移（可复现优先）
    if (o.cloth === undefined && !card) a.cloth.offsetHSL((this.rng() - 0.5) * 0.06, (this.rng() - 0.5) * 0.25, (this.rng() - 0.5) * 0.18);
    if (o.pants === undefined && !card) a.pants.offsetHSL((this.rng() - 0.5) * 0.05, (this.rng() - 0.5) * 0.2, (this.rng() - 0.5) * 0.15);
    // 槽位分配
    const req: Record<string, number> = { head: 1, torso: 1, armU: 2, armL: 2, legU: 2, legL: 2, foot: 2, belt: 1, collar: 1, wrist: 2, sleeve: 2 };
    if (a.hat > 0) req[a.hatPool] = 1;
    if (a.propPool) req[a.propPool] = (req[a.propPool] ?? 0) + 1;
    if (shoe === 1) req['footStraw'] = 2;
    if (SILHOUETTES[sil].armor) req['armor'] = 1;
    if (SILHOUETTES[sil].apron) req['apron'] = 1;
    if (a.halo) { req['halo'] = (req['halo'] ?? 0) + 1; req['aura'] = (req['aura'] ?? 0) + 1; req['lotus'] = 1; req['mandorla'] = 1; }
    const bases = this.ps.allocMany(req);
    a.slots.head = bases.head; a.slots.torso = bases.torso;
    a.slots.belt = bases.belt; a.slots.collar = bases.collar; a.slots.wrist = bases.wrist;
    a.slots.armU = bases.armU; a.slots.armL = bases.armL;
    a.slots.legU = bases.legU; a.slots.legL = bases.legL; a.slots.foot = bases.foot;
    a.slots.sleeve = bases.sleeve;
    a.slots.shoeA = shoe === 1 ? bases['footStraw'] : -1;
    a.slots.armor = SILHOUETTES[sil].armor ? bases['armor'] : -1;
    a.slots.apron = SILHOUETTES[sil].apron ? bases['apron'] : -1;
    if (a.hat > 0) a.slots.hat = bases[a.hatPool];
    if (a.propPool) a.slots.prop = bases[a.propPool];
    if (a.halo) { a.slots.halo = bases['halo']; a.slots.aura = bases['aura']; a.slots.lotus = bases['lotus']; a.slots.mandorla = bases['mandorla']; }
    if (o.headKit === 'beast') BEAST_IDS.add(a.id);
    else LOOKS.set(a, makeLook(a.occ, this.wardrobe, bases, sil, shoe, this.rng, o.headKit, card));
    this.actors.push(a);
    // 所有角色出生即带行为类：第一帧的 __crowd.actions / 每格行为种类就是完整分布，
    // 不必等第一次 tick（否则快照会读到一堆 null，格子种类被低估）。
    // 随机源与 crowd 共用同一条流：行为初相位（车道/步速/类时长）也跟着种子走。
    initBehavior(a, undefined, this.rng);
    // P0-1 步 1：登记实体表（谁都不读，零行为变化）；pos 传 Vector3 引用（结构兼容 {x,y,z}，天然同步）
    a.eid = allocate('npc', { pos: a.pos, persist: true });
    return a;
  }

  /** 固定岗位演员（摊贩/说书人等），不参与寻路。cardId 可选：给了就按卡种子定外观 */
  spawnStation(jobKey: string, x: number, z: number, y: number, action: string, doing: string, yaw = 0, data?: Actor['data'], cardId?: string): Actor {
    const a = this.spawnActor({ occ: jobKey, pos: new THREE.Vector3(x, y, z), yaw, action, doing, freeze: true, data, cardId });
    return a;
  }

  // ============ R12 人口与分布 ============
  /** 全城 2m 占位表：街道人群与场所人群共用同一张，撒点前先查这里，避免两套人群站在同一处 */
  private occ = new Map<string, { x: number; z: number }[]>();
  private static readonly OCC_NEI = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  /** 返回 (x,z) 到最近已占点的距离（格边长 2m，查 3×3 邻域；无邻居返回一个大数） */
  private occClear(x: number, z: number): number {
    let best = 1e9;
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    for (const [dx, dz] of Crowd.OCC_NEI) {
      const arr = this.occ.get(`${cx + dx},${cz + dz}`);
      if (!arr) continue;
      for (const p of arr) {
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }
  private occAdd(x: number, z: number): void {
    const k = `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
    let arr = this.occ.get(k);
    if (!arr) { arr = []; this.occ.set(k, arr); }
    arr.push({ x, z });
  }
  /** 街道行走人口：R12-C/D 从同一预算里切出场所与三界人口后，街面保留 1800（总 live 落在 4400 上下） */
  private static readonly TARGET_WALKERS = 1800;
  /**
   * 非街道人口预留：摊档/名将/神佛/鬼差/戍卒/外城坊民约 700，
   * 加上 R12-C/D 的场所人群（里坊 7×N + 寺院/宫城/瓦舍 + 天宫 305 + 地府 464）约 1700。
   * 场所人群在首帧 update 补建，届时还会再断言一次（见 ensureVenues）。
   */
  private static readonly HUMAN_RESERVE = 2500;
  /** 中轴（虹桥及其桥头）判定带宽：与 world.ts 的「桥面 |x|<8」同一口径 */
  static readonly AXIS_X = 8;

  spawnReport = { planned: 0, spawned: 0, rejected: 0, skipped: 0, axis: 0, cross: 0 };
  lastStats: CrowdStats | null = null;

  /**
   * 出生分布（R12-A）：POI 权重散点 + 拒绝采样（同点 2m 内不落第二人）。
   * 旧实现从路网节点均匀抽点 → 节点间距 26m、桥面只有三列 → 视觉上是「一队人排队」。
   * 现在按「节点 → 热点/地标区域 → 沿街 ±12m × 横向 ±2.8m 抖动」铺开，
   * 并按职业给热点加权（脚夫去码头、僧道去庙口、赌客去赌坊…），再逐点做 2m 排斥。
   */
  spawnCrowd(): void {
    const anchors = this.buildAnchors();
    const base = JOBS.reduce((s, j) => s + (j.count > 0 ? j.count : 0), 0);
    const scale = (Crowd.TARGET_WALKERS * this.density) / Math.max(1, base);

    // 池溢出会把 async 初始化打断成「加载卡住」：开池前先做显式断言，而不是等 alloc 抛在中间
    const planned = JOBS.reduce((s, j) => s + (j.count > 0 ? Math.round(j.count * scale) : 0), 0);
    if (planned + Crowd.HUMAN_RESERVE > MAX_HUMANS) {
      throw new Error(`[人口池断言] 计划行走人口 ${planned} + 非行走预留 ${Crowd.HUMAN_RESERVE} > MAX_HUMANS ${MAX_HUMANS}；` +
        `请下调 TARGET_WALKERS 或提高 pools.ts 的 MAX_HUMANS（池满会让 loading 卡死而不是报错）`);
    }
    if (this.actors.length + planned > MAX_HUMANS) {
      throw new Error(`[人口池断言] 已用角色 ${this.actors.length} + 计划 ${planned} > MAX_HUMANS ${MAX_HUMANS}`);
    }

    // 交错发放：按岗位一次性铺完会让先发的职业占满热点，后发的只能去边角
    const queue: string[] = [];
    for (const j of JOBS) {
      if (!j.count) continue;
      const n = Math.round(j.count * scale);
      for (let i = 0; i < n; i++) queue.push(j.key);
    }
    // 2m 排斥的空间哈希（与场所人群共用同一张表：见 occClear/occAdd）
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const t = queue[i]; queue[i] = queue[j]; queue[j] = t;
    }
    const clearAt = (x: number, z: number): number => this.occClear(x, z);
    const takeSpot = (x: number, z: number): void => this.occAdd(x, z);

    const cum = new Map<string, number[]>();
    const cumFor = (occ: string): number[] => {
      let c = cum.get(occ);
      if (c) return c;
      c = new Array<number>(anchors.length);
      const zw = OCC_ZONE[occ];
      let acc = 0;
      for (let i = 0; i < anchors.length; i++) {
        const b = anchors[i];
        acc += b.w * (zw && zw[b.zone] ? zw[b.zone] : 1);
        c[i] = acc;
      }
      cum.set(occ, c);
      return c;
    };
    const pickAnchor = (c: number[]): Anchor => {
      const total = c[c.length - 1];
      let r = this.rng() * total;
      let lo = 0, hi = c.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid] < r) lo = mid + 1; else hi = mid;
      }
      return anchors[lo];
    };
    // 沿街 ±12m / 横向 ±3.2m：把「节点珠链」摊成一片，桥面按坡度重算高度。
    // ±2.8 太窄（街宽 8–11m），出生时就已经是一条窄带；±3.2 让双向流各占一侧。
    const jitter = (b: Anchor): { x: number; y: number; z: number } => {
      const along = (this.rng() * 2 - 1) * 12;
      const across = (this.rng() * 2 - 1) * 3.2;
      const fx = Math.sin(b.dir), fz = Math.cos(b.dir);
      const x = b.x + fx * along + fz * across;
      const z = b.z + fz * along - fx * across;
      return { x, y: b.bridge ? bridgeDeckY(z) : b.y, z };
    };

    let spawned = 0, rejected = 0, skipped = 0, axis = 0, cross = 0;
    for (const occ of queue) {
      let placed = false;
      let last: { x: number; y: number; z: number } | null = null;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const b = pickAnchor(cumFor(occ));
        for (let t = 0; t < 4; t++) {
          const p = jitter(b);
          last = p;
          if (isDryGround(p.x, p.z) && clearAt(p.x, p.z) >= 2) {
            this.spawnWalker(occ, p, b);
            takeSpot(p.x, p.z);
            placed = true;
            break;
          }
          rejected++;
        }
      }
      if (!placed) {
        // 兜底：在若干候选里挑「最空」的一点；仍不足 2m 就跳过该人（宁可少人，不破 2m 约束）
        let best: { x: number; y: number; z: number; clear: number } | null = null;
        for (let i = 0; i < 14; i++) {
          const b = pickAnchor(cumFor(occ));
          const p = jitter(b);
          if (!isDryGround(p.x, p.z)) continue;
          const c = clearAt(p.x, p.z);
          if (!best || c > best.clear) best = { ...p, clear: c };
        }
        if (best && best.clear >= 2) {
          this.spawnWalker(occ, best, null);
          takeSpot(best.x, best.z);
          placed = true;
        } else skipped++;
      }
      if (placed) spawned++;
    }
    // 中轴占比 / 横向穿行占比：只统计行走人口（摊档与名将本来就钉在桥头）
    for (const a of this.actors) {
      if (a.data || a.freeze || a.sky) continue;
      if (Math.abs(a.pos.x) <= Crowd.AXIS_X) axis++;
      if (isCrossing(a)) cross++;
    }
    this.spawnReport = { planned, spawned, rejected, skipped, axis, cross };

    this.ps.assertCapacity('spawnCrowd');
    if (this.wardrobe.fails > 0) {
      throw new Error(`[衣装池断言] spawnCrowd 有 ${this.wardrobe.fails} 次池满（角色会静默少件：披风/伞/书箱）`);
    }
  }

  private spawnWalker(occ: string, p: { x: number; y: number; z: number }, b: Anchor | null): Actor {
    // 出生朝向：15% 横向穿行（±π/2）、13% 全向（斜穿/回头），其余沿街双向各半。
    // 旧版非穿行者只有 dir 与 dir+π 两档，出生瞬间就已经排成两列。
    let yaw: number;
    const r = this.rng();
    const crossing = r < CROSS_SHARE;
    if (crossing) {
      yaw = (b ? b.dir : 0) + (this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (this.rng() - 0.5) * 0.8;
    } else if (r < CROSS_SHARE + 0.13) {
      yaw = this.rng() * Math.PI * 2;
    } else {
      yaw = (b ? b.dir : 0) + (this.rng() < 0.5 ? 0 : Math.PI) + (this.rng() - 0.5) * 1.0;
    }
    const a = this.spawnActor({ occ, pos: new THREE.Vector3(p.x, p.y, p.z), yaw });
    if (crossing) markCrossing(a);
    initBehavior(a, undefined, this.rng);   // 出生即定行为类：__crowd.actions 从第一帧起就是完整分布
    this.spawned.add(a);
    return a;
  }

  /** 出生锚点：路网节点（热点/地标加权）+ 外城坊街（极远档剪影与网格熵） */
  private buildAnchors(): Anchor[] {
    const out: Anchor[] = [];
    const spots = this.spots.list;
    const nb = navBounds(this.nav);
    for (const n of this.nav.nodes) {
      if (n.y > 12) continue;
      const st = streetOf(n.x, n.z);
      let zone = 'street';
      let best = 55 * 55;
      for (const s of spots) {
        const d = s.pos.distanceToSquared(n);
        if (d < best) { best = d; zone = s.kind; }
      }
      if (zone === 'street') {
        for (const k in POIS) {
          const poi = POIS[k];
          if (poi.sky) continue;
          if (poi.pos.distanceToSquared(n) < 60 * 60) { zone = k; break; }
        }
      }
      // 街尾 24m 内减权：那里只能「走出去 / 走回来」，人堆在那儿会变成单向外流
      const edge = n.x < nb.minX + 24 || n.x > nb.maxX - 24 || n.z < nb.minZ + 24 || n.z > nb.maxZ - 24;
      const streetW = (st.bridge ? 0.55 : zone !== 'street' ? 2.1 : 1) * (edge ? 0.45 : 1);
      out.push({ x: n.x, y: n.y, z: n.z, w: streetW * st.importance, dir: st.dir, axis: st.axis, bridge: st.bridge, zone });
    }
    // 外城坊街：与 world.ts 的外城坊民同一套坐标（A 环），只给低权重，
    // 让「极远处只有剪影」有人，同时把 200m 网格的分布撑开（不再全挤在 1200m 长卷里）
    const A = [900, 1700, 2500, 3300, 4100];
    for (const ax of A) {
      for (let i = 0; i < 6; i++) {
        const z = -4900 + (9800 * (i + 0.5)) / 6;
        out.push({ x: ax, y: 0, z, w: 0.16, dir: Math.PI / 2, axis: false, bridge: false, zone: 'outer' });
        out.push({ x: -ax, y: 0, z, w: 0.16, dir: Math.PI / 2, axis: false, bridge: false, zone: 'outer' });
      }
      for (let i = 0; i < 6; i++) {
        const x = -4900 + (9800 * (i + 0.5)) / 6;
        out.push({ x, y: 0, z: ax, w: 0.16, dir: 0, axis: false, bridge: false, zone: 'outer' });
        out.push({ x, y: 0, z: -ax, w: 0.16, dir: 0, axis: false, bridge: false, zone: 'outer' });
      }
    }
    return out;
  }

  /**
   * 行为层上下文：把 Crowd 的注入源一并传下去。出生与逐帧推进必须共用同一条随机流，
   * 否则「人群生成确定、走两步又分叉」。clock 只在 ctx.t 缺失时才会被 behaviors 取用。
   */
  ctx(camPos: THREE.Vector3, t = this.simT): BehCtx {
    return { nav: this.nav, spots: this.spots, isNight: this.isNight, camPos, t, rng: this.rng, clock: this.clock };
  }

  // ============ R12-C/D 场所人群：里坊 / 寺院 / 宫城 / 瓦舍 / 天宫 / 地府 ============
  /**
   * 这些场所的坐标来自别处、且部分在 spawnCrowd 之后才注册：
   *  · 里坊矩形 wardCells()、宫城矩形 PALACE —— 纯数据，随时可读；
   *  · 寺院（spots 'shrine'）、瓦舍（POIS.washi + spots 'stage'）—— world 在「众生入场」后段才 add；
   *  · 地府各区 POIS（fengdu/naihe/yanluo/shibayu/mengpo/wangxiang）—— 开天辟地阶段写入；
   *  · 天宫六区 POIS（lingxiao/yaochi/nantianmen/pantao/jiangtai/star9）—— 同上；
   *  · 天宫台面高度 —— 借神佛就位后已有 sky 角色的 y 校准（POI 落点比台面高 1–2m）。
   * 所以统一放到首帧 update() 补建，此时世界已经装完。只读，不改 sky/*。
   */
  private venuesReady = false;
  private venueReport = { planned: 0, spawned: 0, wards: 0, temples: 0, palace: 0, washe: 0, sky: 0, hell: 0 };

  private ensureVenues(): void {
    if (this.venuesReady) return;
    const skyRefs = this.actors.filter((a) => a.pos.y > 120);
    const hellRefs = this.actors.filter((a) => a.pos.y < -100);
    // 等「神佛就位」把天宫/地府角色放完再补；否则台面高度与坐标都还没齐
    if (!skyRefs.length && !hellRefs.length) return;
    this.venuesReady = true;

    const plan: Venue[] = [];
    // ---- 12-C 里坊：每坊 7 人（≥6 达标留 1 人余量，驻场半径内游走也不会走出坊格）----
    const wards = wardCells();
    for (let i = 0; i < wards.length; i++) {
      const w = wards[i];
      plan.push({
        name: '坊' + i, x: w.cx, y: 0, z: w.cz, r: Math.min(80, w.half * 0.28),
        count: 7, sky: false,
        kinds: ['chores', 'child', 'chat', 'rest'],
        occ: ['customer', 'kid', 'lady', 'farmer', 'beggar', 'peddler'],
      });
    }
    // ---- 12-C 寺院：每处 ≥8（给 10），必须有 worship ----
    for (const s of this.spots.byKind('shrine')) {
      plan.push({
        name: '寺观', x: s.pos.x, y: s.pos.y, z: s.pos.z, r: 30, count: 12, sky: false,
        kinds: ['worship', 'chores', 'chat'],
        occ: ['monk', 'taoist', 'customer', 'beggar', 'scholar'],
      });
    }
    // ---- 12-C 宫城：矩形内 ≥60（给 72），guard/serve 必现 ----
    // 落点全部压在矩形内：午门锚点从 z1 再往里收 60m，否则 r=46 的采样会有一半落到宫墙外
    const palaceY = 0;
    const palaceAnchors: [number, number][] = [
      [0, PALACE.taiheZ], [0, PALACE.zhongheZ], [0, PALACE.baoheZ], [0, PALACE.z1 - 60],
    ];
    for (const [px, pz] of palaceAnchors) {
      plan.push({
        name: '宫城', x: px, y: palaceY, z: pz, r: 40, count: 18, sky: false,
        kinds: ['guard', 'serve', 'patrol'],
        occ: ['soldier', 'official', 'lady', 'porter', 'watchman'],
      });
    }
    // ---- 12-C 瓦舍勾栏：每处 ≥20（给 22），watch_play 必现 ----
    // y 取街面 0：POI 的 y 是传送落点（比地面高 2m），人群站在铺面上
    const washeAnchors: { x: number; y: number; z: number }[] = [];
    if (POIS.washi) washeAnchors.push({ x: POIS.washi.pos.x, y: 0, z: POIS.washi.pos.z });
    for (const s of this.spots.byKind('stage')) washeAnchors.push({ x: s.pos.x, y: 0, z: s.pos.z });
    for (const w of washeAnchors) {
      plan.push({
        name: '瓦舍', x: w.x, y: w.y, z: w.z, r: 30, count: 24, sky: false,
        kinds: ['watch_play', 'entertain', 'chat'],
        occ: ['customer', 'lady', 'kid', 'gambler', 'drinker', 'sitter'],
      });
    }
    // ---- 12-D 天宫：六个 POI 区，合计 305（≥300）；凌霄殿前 100≥60 / 瑶池 60≥40 / 南天门 40≥20 ----
    const skyGround = (p: { x: number; z: number; y: number }, radius: number): number => {
      let bestY = -1, bd = 90 * 90;
      for (const r of skyRefs) {
        const d = (r.pos.x - p.x) * (r.pos.x - p.x) + (r.pos.z - p.z) * (r.pos.z - p.z);
        if (d < bd) { bd = d; bestY = r.pos.y; }
      }
      // 附近没有参照演员时，POI 落点比台面高约 1–2m
      return bestY > 0 ? bestY : p.y - 1.5;
    };
    const skyPlan: [string, number, number, BehaviorKind[], string[]][] = [
      ['lingxiao', 100, 28, ['serve', 'guard', 'religion', 'sightsee'], ['official', 'lady', 'soldier', 'scholar']],
      ['yaochi', 60, 13, ['entertain', 'serve', 'sightsee', 'chat'], ['musician', 'lady', 'official', 'customer']],
      ['nantianmen', 40, 24, ['guard', 'patrol', 'sightsee'], ['soldier', 'official', 'watchman']],
      ['pantao', 30, 19, ['work', 'chores', 'sightsee'], ['farmer', 'lady', 'customer']],
      ['jiangtai', 35, 14, ['patrol', 'guard', 'sightsee'], ['soldier', 'official', 'watchman']],
      ['star9', 40, 30, ['sightsee', 'religion', 'entertain'], ['scholar', 'taoist', 'musician', 'lady']],
    ];
    for (const [key, count, r, kinds, occ] of skyPlan) {
      const p = POIS[key];
      if (!p) continue;
      plan.push({
        name: '天宫·' + key, x: p.pos.x, y: skyGround(p.pos, p.radius), z: p.pos.z, r,
        count, sky: true, kinds, occ,
      });
    }
    // ---- 12-D 地府：丰都 150≥120 / 阎罗 60≥50 / 奈何桥 50≥40 / 孟婆 40≥30 / 望乡 25≥20 / 十八狱环 12×18≥8 ----
    const hellPlan: [string, number, number, BehaviorKind[], string[]][] = [
      ['fengdu', 150, 90, ['trade', 'chat', 'food', 'rest'], ['beggar', 'gambler', 'drinker', 'vendor', 'lady', 'storyteller']],
      ['yanluo', 60, 18, ['guard', 'religion', 'serve'], ['soldier', 'official', 'scholar', 'beggar']],
      ['naihe', 50, 14, ['transport', 'guard', 'sightsee'], ['beggar', 'soldier', 'customer']],
      ['mengpo', 40, 14, ['serve', 'food', 'chat'], ['vendor', 'lady', 'beggar']],
      ['wangxiang', 25, 11, ['sightsee', 'chat', 'rest'], ['lady', 'beggar', 'scholar']],
    ];
    for (const [key, count, r, kinds, occ] of hellPlan) {
      const p = POIS[key];
      if (!p) continue;
      // 地面统一到 UNDER.y；望乡台本身是抬高 18m 的台，沿用 POI 高度
      const y = key === 'wangxiang' ? p.pos.y - 1.5 : UNDER.y;
      plan.push({ name: '地府·' + key, x: p.pos.x, y, z: p.pos.z, r, count, sky: true, kinds, occ });
    }
    if (POIS.shibayu) {
      // 十八狱环：18 个角度簇 × 10 人（spec 每狱 ≥8，每座狱门前留 2 人余量）
      plan.push({
        name: '地府·十八狱环', x: POIS.shibayu.pos.x, y: UNDER.y, z: POIS.shibayu.pos.z,
        r: POIS.shibayu.radius + 20, count: 180, sky: true, ring: 18,
        kinds: ['serve', 'rest', 'religion', 'guard'],
        occ: ['beggar', 'soldier', 'official', 'drinker'],
      });
    }

    // ---- 12-C 宫城扩编：三大殿两庑 / 丹陛广场 / 太和门 / 廊庑 / 御花园 / 宫墙内外 ----
    // 全部追加在 plan 末尾：原 4 个宫城锚点与其余场所的 rng 消耗序列一字不改，
    // 新增人群与具名角色的随机只排在序列末尾，保证「同 seed 截图可比」。
    // name 统一以 '宫城' 开头，纳入 venueReport.palace 台账（见下方 startsWith 分支）。
    const palaceExtra: {
      name: string; x: number; z: number; r: number; count: number;
      kinds: BehaviorKind[]; occ: string[];
    }[] = [
      { name: '宫城·太和殿丹陛东', x: 170, z: PALACE.taiheZ, r: 38, count: 14,
        kinds: ['guard', 'serve', 'patrol'], occ: ['soldier', 'official', 'watchman', 'porter'] },
      { name: '宫城·太和殿丹陛西', x: -170, z: PALACE.taiheZ, r: 38, count: 14,
        kinds: ['guard', 'serve', 'patrol'], occ: ['soldier', 'official', 'watchman', 'porter'] },
      { name: '宫城·中和保和东庑', x: 210, z: -3530, r: 48, count: 14,
        kinds: ['serve', 'patrol', 'guard'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·中和保和西庑', x: -210, z: -3530, r: 48, count: 14,
        kinds: ['serve', 'patrol', 'guard'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·丹陛广场东班', x: 300, z: -3120, r: 44, count: 12,
        kinds: ['guard', 'serve', 'patrol', 'chat'], occ: ['soldier', 'official', 'watchman', 'scholar'] },
      { name: '宫城·丹陛广场西班', x: -300, z: -3120, r: 44, count: 12,
        kinds: ['guard', 'serve', 'patrol', 'chat'], occ: ['soldier', 'official', 'watchman', 'scholar'] },
      { name: '宫城·太和门内', x: 0, z: -3130, r: 40, count: 12,
        kinds: ['guard', 'serve', 'patrol'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·东廊庑', x: 560, z: -3400, r: 52, count: 12,
        kinds: ['patrol', 'serve', 'rest'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·西廊庑', x: -560, z: -3400, r: 52, count: 12,
        kinds: ['patrol', 'serve', 'rest'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·御花园', x: 0, z: -3890, r: 56, count: 16,
        kinds: ['sightsee', 'serve', 'chat', 'religion'], occ: ['lady', 'official', 'kid', 'customer', 'musician'] },
      { name: '宫城·御花园东', x: 300, z: -3870, r: 44, count: 12,
        kinds: ['sightsee', 'serve', 'chat'], occ: ['lady', 'kid', 'customer', 'musician'] },
      { name: '宫城·御花园西', x: -300, z: -3870, r: 44, count: 12,
        kinds: ['sightsee', 'serve', 'chat'], occ: ['lady', 'kid', 'customer', 'musician'] },
      { name: '宫城·午门外', x: 0, z: -2890, r: 38, count: 10,
        kinds: ['guard', 'patrol'], occ: ['soldier', 'watchman', 'porter'] },
      { name: '宫城·东华门外', x: 1180, z: -3400, r: 42, count: 10,
        kinds: ['guard', 'patrol'], occ: ['soldier', 'watchman'] },
      { name: '宫城·西华门外', x: -1180, z: -3400, r: 42, count: 10,
        kinds: ['guard', 'patrol'], occ: ['soldier', 'watchman'] },
    ];
    for (const p of palaceExtra) {
      plan.push({ name: p.name, x: p.x, y: palaceY, z: p.z, r: p.r, count: p.count, sky: false, kinds: p.kinds, occ: p.occ });
    }

    // ---- R20 宫城再扩编：紧凑簇让「成群」可读 ----
    // 背景：R19 把宫城驻场计划数从 72 扩到 292（含 34 位具名核心角色），但丹陛广场尺度极大，
    // r=38~56m 的均匀散点铺开后只是稀疏黑点，实拍 r20-04-palace.png 里仍「没人」。
    // 本轮 20 个新锚点把 r 全部收紧到 14~20m（要求 12~24m），同一身份聚成一小群人；
    // 坐标沿用既有 palaceExtra 的皇城可站立区，全部落在 PALACE 矩形 x∈[-1100,1100]、
    // z∈[-4000,-2950] 内，避开殿宇中轴台基，y=palaceY=0 由既有贴地逻辑处理。
    // 硬约束：① 追加在 plan 末尾（palaceExtra 之后），for (const v of plan) 顺序 spawn，
    //   既有 4 个「宫城」锚点与其余场所的 rng 消耗序列一字不改，新增项随机全排在序列末尾；
    //   ② 不新增任何 this.rng() 调用点、不用 Math.random；③ name 一律以「宫城」开头，
    //   纳入 venueReport.palace（startsWith 口径）与 window.__realmSnap.actors 台账；
    //   ④ kinds/occ 全取自既有 BehaviorKind / JOB_MAP 键，不引入未知字段。
    // 计划数台账（可 grep）：原 4 锚点 72 + R19 扩编 186 + R20 新增 20 锚点 Σcount 338
    //   + R19 具名 34 + R20 新增具名 30 = 宫城驻场计划数 660（≥620）。
    const palaceExtra2: {
      name: string; x: number; z: number; r: number; count: number;
      kinds: BehaviorKind[]; occ: string[];
    }[] = [
      { name: '宫城·太和殿丹陛仪仗东', x: 210, z: PALACE.taiheZ, r: 16, count: 18,
        kinds: ['guard', 'serve', 'patrol'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·太和殿丹陛仪仗西', x: -210, z: PALACE.taiheZ, r: 16, count: 18,
        kinds: ['guard', 'serve', 'patrol'], occ: ['soldier', 'official', 'porter', 'watchman'] },
      { name: '宫城·中和殿朝班东', x: 170, z: PALACE.zhongheZ, r: 14, count: 16,
        kinds: ['serve', 'guard', 'chat'], occ: ['official', 'soldier', 'scholar', 'porter'] },
      { name: '宫城·中和殿朝班西', x: -170, z: PALACE.zhongheZ, r: 14, count: 16,
        kinds: ['serve', 'guard', 'chat'], occ: ['official', 'soldier', 'scholar', 'porter'] },
      { name: '宫城·保和殿宴列东', x: 170, z: PALACE.baoheZ, r: 16, count: 16,
        kinds: ['serve', 'sightsee', 'chat'], occ: ['official', 'lady', 'musician', 'customer'] },
      { name: '宫城·保和殿宴列西', x: -170, z: PALACE.baoheZ, r: 16, count: 16,
        kinds: ['serve', 'sightsee', 'chat'], occ: ['official', 'lady', 'musician', 'customer'] },
      { name: '宫城·太和门御前侍卫', x: 90, z: -3120, r: 14, count: 18,
        kinds: ['guard', 'patrol', 'serve'], occ: ['soldier', 'watchman', 'porter'] },
      { name: '宫城·太和门外候朝王公', x: 0, z: -3040, r: 18, count: 18,
        kinds: ['guard', 'serve', 'chat', 'rest'], occ: ['official', 'soldier', 'scholar', 'porter'] },
      { name: '宫城·朝房王公大臣东', x: 380, z: -3040, r: 16, count: 18,
        kinds: ['serve', 'chat', 'rest'], occ: ['official', 'scholar', 'lady', 'porter'] },
      { name: '宫城·朝房王公大臣西', x: -380, z: -3040, r: 16, count: 18,
        kinds: ['serve', 'chat', 'rest'], occ: ['official', 'scholar', 'lady', 'porter'] },
      { name: '宫城·值房随侍太监东', x: 260, z: -3080, r: 14, count: 16,
        kinds: ['serve', 'chores', 'patrol'], occ: ['official', 'porter', 'watchman'] },
      { name: '宫城·值房随侍太监西', x: -260, z: -3080, r: 14, count: 16,
        kinds: ['serve', 'chores', 'patrol'], occ: ['official', 'porter', 'watchman'] },
      { name: '宫城·东六宫宫女班', x: 700, z: -3600, r: 18, count: 18,
        kinds: ['serve', 'chores', 'chat', 'sightsee'], occ: ['lady', 'kid', 'customer', 'porter'] },
      { name: '宫城·西六宫宫女班', x: -700, z: -3600, r: 18, count: 18,
        kinds: ['serve', 'chores', 'chat', 'sightsee'], occ: ['lady', 'kid', 'customer', 'porter'] },
      { name: '宫城·御花园宫女班', x: 120, z: -3880, r: 16, count: 18,
        kinds: ['serve', 'sightsee', 'chat', 'chores'], occ: ['lady', 'kid', 'musician', 'customer'] },
      { name: '宫城·御花园王公游宴', x: -160, z: -3900, r: 18, count: 16,
        kinds: ['sightsee', 'chat', 'religion'], occ: ['official', 'lady', 'scholar', 'musician'] },
      { name: '宫城·东廊庑戍卫', x: 620, z: -3360, r: 16, count: 16,
        kinds: ['patrol', 'guard', 'rest'], occ: ['soldier', 'watchman', 'porter'] },
      { name: '宫城·西廊庑戍卫', x: -620, z: -3360, r: 16, count: 16,
        kinds: ['patrol', 'guard', 'rest'], occ: ['soldier', 'watchman', 'porter'] },
      { name: '宫城·宫墙内巡道东', x: 1020, z: -3400, r: 20, count: 16,
        kinds: ['patrol', 'guard'], occ: ['soldier', 'watchman'] },
      { name: '宫城·宫墙内巡道西', x: -1020, z: -3400, r: 20, count: 16,
        kinds: ['patrol', 'guard'], occ: ['soldier', 'watchman'] },
    ];
    for (const p of palaceExtra2) {
      plan.push({ name: p.name, x: p.x, y: palaceY, z: p.z, r: p.r, count: p.count, sky: false, kinds: p.kinds, occ: p.occ });
    }

    // ---- 宫城俯瞰密集阵列（补充 / 二轮精修）：朝会班列 / 仪仗卫队 / 禁军列阵 / 侍从簇 ----
    // 背景：既有 plan 全部走 spawnVenue 的 rng 极坐标随机撒点（ang/rr 各吃一次 rng），
    // r=14~56m 铺开后俯瞰仍是一片稀疏小点；首轮 8 个网格方阵又因 card 哈希灰暗杂色
    // 被实拍判为「散落黑点」。本轮：① 每方阵统一鲜明服色（COURT_UNIFORMS，俯瞰成彩色条带）；
    // ② 步距 COURT_GRID_STEP 1.6m 收紧成密实色块；③ 中轴 COURT_AXIS_CLEAR 留白，班列分列两侧；
    // ④ 朝向统一 COURT_YAW（面朝太和殿）；⑤ freeze 站定，count 全部落地（不经 2m 排斥）。
    // 10 类身份覆盖：侍卫(2/3/8)、宫女(7)、太监(6)、王公大臣(1)、将军将士(4/5)、
    //   皇帝/皇后/妃嫔/王子/公主(6 内廷 stripe，叠加既有 courtRows 64 位具名)。
    // 硬约束：① 纯追加在 plan 末尾，palaceExtra / palaceExtra2 / courtRows 一字不改；
    //   ② name 一律以 '宫城' 开头，纳入 venueReport.palace（startsWith 口径）；
    //   ③ 坐标 = 整数行列 × 步距（无 rng 撒点），外观 = 整数坐标 hash 编 cardId + 显式服色覆盖卡色；
    //   ④ 每阵列统一显式 prop（null / 具体池名），道具峰值可静态精确核算（见 pools.ts 注释）；
    //   ⑤ grid 项的 spawn 由主循环跳过、延到具名角色之后（既有 rng 消耗序列一字不改）。
    // 宫城计划数台账：既有 660 + 本批 Σcount 715 = 1375（≥1100）；count 均 = rows*cols，本轮不变。
    const palaceDense: {
      name: string; x: number; z: number; r: number; count: number;
      rows: number; cols: number; dx: number; dz: number; prop: string | null;
      uniform: string; axisGap?: number; kinds: BehaviorKind[]; occ: string[];
    }[] = [
      // 太和殿丹陛朝会班列：按品级分列（occ 按列循环），王公大臣执笏/表（scroll），分列御道两侧
      { name: '宫城·太和殿朝会班列·王公大臣', x: 0, z: -3240, r: 11, count: 100,
        rows: 10, cols: 10, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'scroll',
        uniform: '王公大臣', axisGap: COURT_AXIS_CLEAR,
        kinds: ['serve', 'guard', 'chat', 'rest'], occ: ['official', 'scholar', 'official', 'sitter'] },
      // 丹陛广场仪仗卫队：御道东西两厢执戟（spear）侍卫
      { name: '宫城·丹陛广场仪仗东班·侍卫', x: 300, z: -3220, r: 10, count: 90,
        rows: 10, cols: 9, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'spear',
        uniform: '仪仗东班',
        kinds: ['guard', 'patrol', 'serve'], occ: ['soldier', 'watchman'] },
      { name: '宫城·丹陛广场仪仗西班·侍卫', x: -300, z: -3220, r: 10, count: 90,
        rows: 10, cols: 9, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'spear',
        uniform: '仪仗西班',
        kinds: ['guard', 'patrol', 'serve'], occ: ['soldier', 'watchman'] },
      // 御道两侧禁军列阵：佩刀（blade）将军将士
      { name: '宫城·御道禁军列阵东·将军将士', x: 150, z: -3160, r: 12, count: 96,
        rows: 12, cols: 8, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'blade',
        uniform: '禁军东阵',
        kinds: ['guard', 'patrol'], occ: ['soldier'] },
      { name: '宫城·御道禁军列阵西·将军将士', x: -150, z: -3160, r: 12, count: 96,
        rows: 12, cols: 8, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'blade',
        uniform: '禁军西阵',
        kinds: ['guard', 'patrol'], occ: ['soldier'] },
      // 内廷：皇帝 / 皇后 / 妃嫔 / 皇子公主 / 随侍太监（stripe 五身份色条带，不持物靠冠服读身份）
      { name: '宫城·内廷帝后妃嫔皇子公主·太监随侍', x: 0, z: -3100, r: 10, count: 81,
        rows: 9, cols: 9, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: null,
        uniform: '帝后内廷', axisGap: COURT_AXIS_CLEAR,
        kinds: ['serve', 'chores', 'sightsee', 'chat'], occ: ['official', 'lady', 'kid', 'lady', 'kid'] },
      // 御花园 / 廊庑侍从簇：宫女执扇（fan）成群
      { name: '宫城·御花园廊庑侍从簇·宫女', x: 620, z: -3500, r: 10, count: 81,
        rows: 9, cols: 9, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'fan',
        uniform: '宫女侍从',
        kinds: ['serve', 'chores', 'chat', 'sightsee'], occ: ['lady', 'kid', 'customer'] },
      // 午门内禁军列阵：执戟侍卫成方阵，中轴留白
      { name: '宫城·午门内禁军列阵·侍卫', x: 0, z: -2960, r: 10, count: 81,
        rows: 9, cols: 9, dx: COURT_GRID_STEP, dz: COURT_GRID_STEP, prop: 'spear',
        uniform: '午门禁军', axisGap: COURT_AXIS_CLEAR,
        kinds: ['guard', 'patrol'], occ: ['soldier', 'watchman'] },
    ];
    for (const d of palaceDense) {
      plan.push({
        name: d.name, x: d.x, y: palaceY, z: d.z, r: d.r, count: d.count, sky: false,
        kinds: d.kinds, occ: d.occ,
        grid: { rows: d.rows, cols: d.cols, dx: d.dx, dz: d.dz, prop: d.prop,
          uniform: COURT_UNIFORMS[d.uniform], axisGap: d.axisGap },
      });
    }

    // ---- 宫廷具名核心角色：皇帝 / 后妃 / 皇子公主 / 内廷 / 朝臣 / 将领 / 侍卫 ----
    // occ 全部取自 JOB_MAP（职业键），action 全部取自 ACTIONS（动作键），名片复用 data 既有字段；
    // 不新增造型资源：身份靠职业冠服（幞头/襦裙/甲胄）+ 宫廷动作（临朝/朝拜/执扇）区分。
    // 元组：[occ, x, z, action, doing, name, nick, group, desc]
    type CourtRow = [string, number, number, string, string, string, string, 'guest' | 'job', string];
    const courtRows: CourtRow[] = [
      // 御座前列班：皇帝临朝，皇后、贵妃与妃嫔、皇子公主、太监总管与宫女班随侍
      ['official', 0, -3208, 'holdCourt', '御座临朝', '官家', '当今圣上', 'guest', '太和殿前御座临朝听政'],
      ['lady', -9, -3206, 'fanSway', '中宫陪朝', '皇后', '中宫皇后', 'guest', '御座西侧陪临朝'],
      ['lady', 9, -3206, 'sleeveWave', '御前随侍', '贵妃', '贵妃娘娘', 'guest', '御座东侧随侍'],
      ['lady', -18, -3202, 'fanSway', '列侍', '宸妃', '宸妃', 'guest', '妃嫔列侍丹陛'],
      ['lady', 18, -3202, 'chat', '叙话', '淑妃', '淑妃', 'guest', '妃嫔丹陛叙话'],
      ['lady', -27, -3198, 'present', '捧献', '德妃', '德妃', 'guest', '妃嫔御前捧献'],
      ['kid', -14, -3198, 'stand', '侍立', '皇长子', '大皇子', 'guest', '皇子御前侍立'],
      ['kid', 14, -3198, 'lookAround', '观朝', '三皇子', '三皇子', 'guest', '幼皇子观朝仪'],
      ['lady', -22, -3194, 'chat', '相伴', '长公主', '长公主', 'guest', '公主丹陛相伴'],
      ['kid', 22, -3194, 'lookAround', '张望', '小公主', '小公主', 'guest', '幼公主丹陛张望'],
      ['official', -5, -3204, 'present', '传旨', '大总管', '内廷总管', 'job', '太监总管御前传旨'],
      ['official', 5, -3204, 'courtBow', '秉笔', '秉笔太监', '内侍秉笔', 'job', '内侍秉笔立班'],
      ['lady', -12, -3200, 'present', '掌事', '宫女掌事', '女官掌事', 'job', '宫女班掌事'],
      ['lady', 12, -3200, 'fanSway', '执扇', '执扇宫女', '宫女执扇', 'job', '宫女执扇随侍'],
      ['lady', -20, -3196, 'present', '捧皿', '捧皿宫女', '宫女捧皿', 'job', '宫女捧皿侍立'],
      ['lady', 30, -3192, 'sweep', '洒扫', '洒扫宫女', '宫女洒扫', 'job', '宫女月台洒扫'],
      // 王公大臣与将军：御前列班
      ['official', 0, -3184, 'courtBow', '朝拜', '丞相', '当朝丞相', 'guest', '丞相率百官朝拜'],
      ['official', -40, -3186, 'holdCourt', '奏事', '枢密使', '枢密使', 'guest', '枢密使御前奏事'],
      ['official', 40, -3186, 'write', '录旨', '参知政事', '参政', 'guest', '参知政事录旨'],
      ['official', -80, -3180, 'stand', '立班', '户部尚书', '户部尚书', 'guest', '六部尚书列班'],
      ['official', 80, -3180, 'courtBow', '朝拜', '礼部侍郎', '礼部侍郎', 'guest', '礼部侍郎朝拜'],
      ['soldier', -60, -3174, 'stand', '镇殿', '镇殿将军', '镇殿将军', 'job', '将军镇殿'],
      ['soldier', 60, -3174, 'swordForm', '佩剑', '骁骑将军', '骁骑将军', 'job', '骁骑将军佩剑立班'],
      ['soldier', 0, -3170, 'spearThrust', '执戟', '殿前都指挥', '殿前都指挥', 'job', '殿前都指挥执戟'],
      // 御前侍卫：分列丹陛广场两厢
      ['soldier', -100, -3192, 'stand', '立卫', '左班侍卫', '御前侍卫', 'job', '御前侍卫左班'],
      ['soldier', 100, -3192, 'stand', '立卫', '右班侍卫', '御前侍卫', 'job', '御前侍卫右班'],
      ['soldier', -140, -3182, 'lookAround', '警视', '执戟侍卫', '御前侍卫', 'job', '御前侍卫执戟警视'],
      ['soldier', 140, -3182, 'lookAround', '警视', '佩刀侍卫', '御前侍卫', 'job', '御前侍卫佩刀警视'],
      ['watchman', -180, -3166, 'sneak', '巡廊', '巡廊侍卫', '廊庑戍卫', 'job', '廊庑巡卫'],
      ['watchman', 180, -3166, 'stand', '守门', '立门侍卫', '宫门戍卫', 'job', '宫门立卫'],
      // 御花园：游园与宴乐
      ['kid', 0, -3870, 'lookAround', '游园', '游园皇子', '皇子', 'guest', '皇子御花园游赏'],
      ['kid', -30, -3870, 'chat', '赏花', '赏花公主', '公主', 'guest', '公主御花园赏花'],
      ['musician', -60, -3880, 'flute', '品竹', '御园乐伎', '乐伎', 'job', '御花园乐伎品竹'],
      ['musician', 60, -3880, 'pluck', '拨弦', '御园乐伎', '乐伎', 'job', '御花园乐伎拨弦'],
      // ---- R20 新增 30 位具名核心角色：34 → 64（≥60）----
      // 补齐用户点名的每一类并按区域分配不同组合：皇帝/皇后/皇贵妃·妃嫔/皇子/公主/
      // 太监总管·随侍太监/宫女班/王公大臣/将军·将士/御前侍卫。name 全部唯一、可区分；
      // occ/action 全取既有枚举；yaw 仍由 Math.atan2(-x, taiheZ - z) 纯坐标计算（确定性，
      // 不消耗 rng）。追加在 courtRows 末尾 → 既有 34 位具名的 spawnStation 顺序一字不改。
      // 太和门外候朝 / 朝房 王公大臣（6）
      ['official', 210, -3050, 'courtBow', '候朝', '魏国公', '国公', 'guest', '国公太和门外候朝'],
      ['official', 260, -3050, 'stand', '立班', '郑王', '亲王', 'guest', '亲王朝房立班'],
      ['official', 310, -3050, 'write', '录事', '中书舍人', '中书舍人', 'job', '中书舍人朝房录事'],
      ['official', -210, -3050, 'present', '捧表', '吏部尚书', '吏部尚书', 'guest', '吏部尚书朝房捧表'],
      ['official', -260, -3050, 'chat', '议政', '枢密副使', '枢密副使', 'guest', '枢密副使朝房议政'],
      ['official', -310, -3050, 'stand', '立班', '御史中丞', '御史中丞', 'guest', '御史中丞朝房立班'],
      // 值房 / 殿内 随侍太监（4）
      ['official', 130, -3080, 'present', '传膳', '御前掌膳太监', '掌膳太监', 'job', '掌膳太监御前传膳'],
      ['official', -130, -3080, 'sneak', '巡值', '值房随侍太监', '随侍太监', 'job', '值房太监巡值'],
      ['official', 160, -3100, 'stand', '侍立', '殿内随侍太监', '随侍太监', 'job', '殿内太监侍立'],
      ['official', -160, -3100, 'courtBow', '承旨', '司礼监太监', '司礼监', 'job', '司礼监太监承旨'],
      // 东西六宫 宫女班（4）
      ['lady', 680, -3600, 'fanSway', '执扇', '东六宫掌事宫女', '东宫女官', 'job', '东六宫女官执扇'],
      ['lady', 720, -3580, 'present', '捧盏', '东六宫捧盏宫女', '东宫宫女', 'job', '东六宫宫女捧盏'],
      ['lady', -680, -3600, 'sweep', '洒扫', '西六宫洒扫宫女', '西宫宫女', 'job', '西六宫宫女洒扫'],
      ['lady', -720, -3580, 'sleeveWave', '引路', '西六宫引路宫女', '西宫宫女', 'job', '西六宫宫女引路'],
      // 东西六宫 皇贵妃 / 妃嫔 / 皇子公主（6）
      ['lady', 820, -3720, 'fanSway', '临轩', '皇贵妃', '皇贵妃', 'guest', '皇贵妃东六宫临轩'],
      ['lady', 850, -3740, 'chat', '叙话', '丽妃', '丽妃', 'guest', '丽妃东六宫叙话'],
      ['kid', 780, -3700, 'lookAround', '读书', '五皇子', '五皇子', 'guest', '皇子东六宫读书'],
      ['lady', -820, -3720, 'present', '赏花', '贤妃', '贤妃', 'guest', '贤妃西六宫赏花'],
      ['kid', -780, -3700, 'chat', '习礼', '四公主', '四公主', 'guest', '公主西六宫习礼'],
      ['kid', -850, -3740, 'stand', '侍立', '七皇子', '七皇子', 'guest', '幼皇子西六宫侍立'],
      // 宫墙 / 廊庑 将军·将士（5）
      ['soldier', 1020, -3400, 'stand', '戍墙', '宫墙东班将领', '戍墙将领', 'job', '宫墙东班将领戍墙'],
      ['soldier', -1020, -3400, 'spearThrust', '执戟', '宫墙西班将领', '戍墙将领', 'job', '宫墙西班将领执戟'],
      ['soldier', 620, -3360, 'swordForm', '佩刀', '东廊庑将士', '廊庑将士', 'job', '东廊庑将士佩刀'],
      ['soldier', -620, -3360, 'stand', '镇庑', '西廊庑将士', '廊庑将士', 'job', '西廊庑将士镇庑'],
      ['watchman', 640, -3340, 'sneak', '巡廊', '东廊巡卫', '巡廊戍卫', 'job', '东廊庑巡卫'],
      // 丹陛 / 御道 御前侍卫（3）
      ['soldier', 210, -3260, 'stand', '立卫', '丹陛东班侍卫', '御前侍卫', 'job', '丹陛东班御前侍卫'],
      ['soldier', -210, -3260, 'stand', '立卫', '丹陛西班侍卫', '御前侍卫', 'job', '丹陛西班御前侍卫'],
      ['soldier', 110, -3160, 'spearThrust', '执戟', '御道仪仗侍卫', '御前侍卫', 'job', '御道仪仗侍卫执戟'],
      // 御花园 乐伎 / 游宴（2）
      ['musician', 160, -3900, 'flute', '品箫', '御园箫伎', '御园乐伎', 'job', '御花园箫伎品箫'],
      ['musician', -190, -3880, 'pluck', '拨弦', '御园琵琶伎', '御园乐伎', 'job', '御花园琵琶伎拨弦'],
    ];

    let planned = 0;
    for (const v of plan) planned += v.count;
    planned += courtRows.length;   // 具名角色同样占人口池，计入预算与台账
    this.venueReport.planned = planned;
    if (this.actors.length + planned > MAX_HUMANS) {
      throw new Error(`[人口池断言] 场所人群：已用 ${this.actors.length} + 计划 ${planned} > MAX_HUMANS ${MAX_HUMANS}`);
    }
    for (const v of plan) {
      if (v.grid) continue;   // 密集阵列延后到具名角色之后 spawn：既有每个角色的 rng 消耗序列一字不改
      const n = this.spawnVenue(v);
      this.venueReport.spawned += n;
      if (v.name.startsWith('天宫')) this.venueReport.sky += n;
      else if (v.name.startsWith('地府')) this.venueReport.hell += n;
      else if (v.name.startsWith('坊')) this.venueReport.wards += n;
      else if (v.name === '寺观') this.venueReport.temples += n;
      else if (v.name.startsWith('宫城')) this.venueReport.palace += n;
      else if (v.name === '瓦舍') this.venueReport.washe += n;
    }
    // 具名宫廷角色：spawnStation 生成 freeze 定点演员，随机消耗排在场所人群之后（序列末尾），
    // 既有任何角色的出生结果都不受牵连。逐位带入名片 { name, nick, group, desc }；
    // yaw 纯坐标计算（朝太和殿中轴），不引入 Math.random / Date.now 等新随机源。
    let named = 0;
    for (const [occ, x, z, action, doing, name, nick, group, desc] of courtRows) {
      const yaw = Math.atan2(-x, PALACE.taiheZ - z);
      this.spawnStation(occ, x, z, palaceY, action, doing, yaw, { name, nick, group, desc });
      named++;
    }
    this.venueReport.spawned += named;
    this.venueReport.palace += named;
    // 宫城俯瞰密集阵列：spawn 排在既有全部随机消耗（场所人群 + 具名角色）之后，
    // 既有每个角色读到的 rng 值一字不改；网格坐标 / 朝向 / 外观全部确定性，
    // 本段不新增任何 this.rng() 调用点、不引入 Math.random。
    for (const v of plan) {
      if (!v.grid) continue;
      const n = this.spawnVenue(v);
      this.venueReport.spawned += n;
      if (v.name.startsWith('宫城')) this.venueReport.palace += n;
    }
    this.ps.assertCapacity('ensureVenues');
    if (this.wardrobe.fails > 0) {
      throw new Error(`[衣装池断言] ensureVenues 有 ${this.wardrobe.fails} 次池满`);
    }
  }

  private spawnVenue(v: Venue): number {
    const g = v.grid;
    if (g) {
      // 确定性行列网格：x/z 由整数行列 × 步距算出，不调用 this.rng() 做极坐标撒点；
      // 朝向统一 COURT_YAW（朝会面朝太和殿），外观 = 整数坐标 hash 编 cardId + 显式制服色。
      // 服色经 spawnActor 既有 cloth?/pants?/skin?/hat? 入口覆盖 card 哈希灰暗杂色，
      // 走 InstPool.set → setColorAt 既有实例色机制，不新造材质、不新增 draw call。
      // 每个阵列统一显式 prop（null / 池名），道具需求可静态精确核算。
      // 本分支不新增任何 this.rng() 调用点、不引入 Math.random；spawnActor 内部既有路径
      // 的随机消耗排在整条 rng 序列的最末尾（grid spawn 在具名角色之后），既有画面零漂移。
      const u = g.uniform;
      let n = 0;
      for (let i = 0; i < g.rows; i++) {
        for (let j = 0; j < g.cols; j++) {
          let x = v.x + (j - (g.cols - 1) / 2) * g.dx;
          // 中轴御道留白：|x| < COURT_AXIS_CLEAR 的点整体外推到两侧，班列分列、红毯畅通（人数不变）
          if (g.axisGap) x += (x >= 0 ? 1 : -1) * g.axisGap;
          const z = v.z + (i - (g.rows - 1) / 2) * g.dz;
          const occ = v.occ[j % v.occ.length];                  // 按列分品级，同列同身份
          const cloth = u.stripe ? u.stripe[j % u.stripe.length] : u.cloth;  // 内廷多身份纵向彩条
          const ix = Math.round(x * 10), iz = Math.round(-z * 10);
          const cardId = `PC-${ix}-${iz}-${i}-${j}`;               // 整数坐标 hash → 卡种子
          const a = this.spawnActor({
            occ, pos: new THREE.Vector3(x, v.y, z), yaw: COURT_YAW, scale: 1,
            prop: g.prop, freeze: true, cardId,
            cloth, pants: u.pants, skin: u.skin, hat: u.hat,
          });
          setPost(a, { x, y: v.y, z, r: v.r, kinds: v.kinds, venue: v.name });
          n++;
        }
      }
      return n;
    }
    let n = 0;
    for (let i = 0; i < v.count; i++) {
      let x = 0, z = 0, ok = false;
      // 环形场所用「格点」落点：每狱门扇区内 4 个角位 × 3 条径向带。
      // 纯按同一条带均分角度时，r=72 处相邻两人只有 1.9m（<2m 排斥），会被反复拒绝、扇区漏人。
      const per = v.ring ? Math.ceil(v.count / v.ring) : 0;
      const bands = 3, slots = Math.max(1, Math.ceil(per / bands));
      for (let t = 0; t < 14 && !ok; t++) {
        if (v.ring) {
          const s = i % v.ring, k = Math.floor(i / v.ring);
          const span = (Math.PI * 2) / v.ring;
          const band = k % bands, slot = Math.floor(k / bands);
          const ang = span * s + ((slot + 0.5) / slots - 0.5) * span * 0.86 + (this.rng() - 0.5) * span * 0.04;
          const rr = v.r + (band - 1) * v.r * 0.11 + (this.rng() - 0.5) * 1.8;
          x = v.x + Math.cos(ang) * rr; z = v.z + Math.sin(ang) * rr;
        } else {
          const ang = this.rng() * Math.PI * 2;
          const rr = Math.sqrt(this.rng()) * v.r;
          x = v.x + Math.cos(ang) * rr; z = v.z + Math.sin(ang) * rr;
        }
        // 与街道人群共用同一张 2m 占位表：场所落点也要避开已经在街上的人；
        // 另外拒收落在汴河里的落点（里坊矩形会横跨河道，旧版会把坊民撒到水面上）。
        // 天宫/地府（v.sky）的 x/z 与人间河道重合但 y 在 ±200m 之外，不参与河道判定。
        ok = this.occClear(x, z) >= 2 && (v.sky || isDryGround(x, z));
      }
      if (!ok) continue; // 挤不下就少放一个，不硬塞重叠
      this.occAdd(x, z);
      const a = this.spawnActor({
        occ: v.occ[Math.floor(this.rng() * v.occ.length)],
        pos: new THREE.Vector3(x, v.y, z),
        yaw: this.rng() * Math.PI * 2,
        sky: v.sky,
        action: 'stand',
        doing: '',
      });
      // 环形场所的人钉在自己那座狱门前（半径 10m），不能以环心为岗——
      // 否则 80m 的岗位半径会把人撒到整个环盘上，十八狱人数的分区统计就被抹平了。
      setPost(a, v.ring
        ? { x, y: v.y, z, r: 10, kinds: v.kinds, venue: v.name }
        : { x: v.x, y: v.y, z: v.z, r: v.r, kinds: v.kinds, venue: v.name });
      initBehavior(a, v.kinds, this.rng);
      n++;
    }
    return n;
  }

  // ============ 可断言统计面：window.__crowd ============
  private wardList: { cx: number; cz: number; half: number }[] | null = null;
  private wardGrid: Map<string, number[]> | null = null;
  private placeCache: PlaceStats | null = null;
  private placeFrame = -9999;

  private wards(): { cx: number; cz: number; half: number }[] {
    if (!this.wardList) this.wardList = wardCells();
    return this.wardList;
  }
  /** 200m 空间哈希：坊格最大 840m 见方，逐人暴力遍历 110 坊太贵，先按格筛候选 */
  private wardGridOf(): Map<string, number[]> {
    if (this.wardGrid) return this.wardGrid;
    const g = new Map<string, number[]>();
    const ws = this.wards();
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const x0 = Math.floor((w.cx - w.half) / 200), x1 = Math.floor((w.cx + w.half) / 200);
      const z0 = Math.floor((w.cz - w.half) / 200), z1 = Math.floor((w.cz + w.half) / 200);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx + ',' + gz;
        let arr = g.get(k);
        if (!arr) { arr = []; g.set(k, arr); }
        arr.push(i);
      }
    }
    this.wardGrid = g;
    return g;
  }

  /** 场所达标数：里坊 ≥6、寺院 ≥8 且出现 worship、宫城 ≥60 且出现 guard/serve、瓦舍 ≥20 */
  private computePlaces(live: Actor[]): PlaceStats {
    const ws = this.wards();
    const grid = this.wardGridOf();
    const counts = new Int32Array(ws.length);
    for (const a of live) {
      const arr = grid.get(Math.floor(a.pos.x / 200) + ',' + Math.floor(a.pos.z / 200));
      if (!arr) continue;
      for (const i of arr) {
        const w = ws[i];
        if (Math.abs(a.pos.x - w.cx) <= w.half && Math.abs(a.pos.z - w.cz) <= w.half) counts[i]++;
      }
    }
    let wardOk = 0;
    for (let i = 0; i < ws.length; i++) if (counts[i] >= 6) wardOk++;

    let templeOk = 0;
    const shrines = this.spots.byKind('shrine');
    for (const s of shrines) {
      let n = 0, worship = false;
      for (const a of live) {
        const dx = a.pos.x - s.pos.x, dz = a.pos.z - s.pos.z;
        if (dx * dx + dz * dz > 60 * 60) continue;
        n++;
        if (actionKindOf(a) === 'worship') worship = true;
      }
      if (n >= 8 && worship) templeOk++;
    }

    let palacePop = 0, palaceRole = false;
    for (const a of live) {
      if (a.pos.x < PALACE.x0 || a.pos.x > PALACE.x1 || a.pos.z < PALACE.z0 || a.pos.z > PALACE.z1) continue;
      palacePop++;
      const k = actionKindOf(a);
      if (k === 'guard' || k === 'serve') palaceRole = true;
    }
    const palaceOk = palacePop >= 60 && palaceRole ? 1 : 0;

    const washeAnchors: { x: number; z: number }[] = [];
    if (POIS.washi) washeAnchors.push({ x: POIS.washi.pos.x, z: POIS.washi.pos.z });
    for (const s of this.spots.byKind('stage')) washeAnchors.push({ x: s.pos.x, z: s.pos.z });
    let washeOk = 0;
    for (const w of washeAnchors) {
      let n = 0;
      for (const a of live) {
        const dx = a.pos.x - w.x, dz = a.pos.z - w.z;
        if (dx * dx + dz * dz <= 40 * 40) n++;
      }
      if (n >= 20) washeOk++;
    }

    return {
      wards: wardOk, temples: templeOk, palace: palaceOk, washe: washeOk,
      wardsTotal: ws.length, templesTotal: shrines.length, washeTotal: washeAnchors.length,
      palacePop,
    };
  }

  private computeStats(): CrowdStats {
    const live: Actor[] = [];
    const lodsAll: [number, number, number, number] = [0, 0, 0, 0];
    for (const a of this.actors) {
      if (a.hidden) continue;
      live.push(a);
      const t = lodStateOf(a).tier;
      lodsAll[(t < 0 ? 0 : t) as 0 | 1 | 2 | 3]++;
    }
    const lods: [number, number, number, number] = [0, 0, 0, 0];
    const actions: Record<string, number> = {};
    const cells = new Map<string, number>();
    const cellKinds = new Map<string, Set<BehaviorKind>>();
    const circ = new Map<string, { c: number; s: number; n: number; mc: number; ms: number; mn: number }>();
    let walkers = 0, axis = 0, cross = 0, blocked = 0, fallbacks = 0;
    let walkersSpawned = 0, crossSpawned = 0;
    // 三界计数（判据与 scripts/probe-crowd.mjs 完全一致：y>120 天宫 / y<-100 地府）
    let sky = 0, hell = 0;
    const skyKinds = new Set<BehaviorKind>();
    const hellKinds = new Set<BehaviorKind>();
    for (const a of live) {
      const ls = lodStateOf(a);
      const kAll = actionKindOf(a);
      if (a.pos.y > 120) { sky++; if (kAll) skyKinds.add(kAll); }
      else if (a.pos.y < -100) { hell++; if (kAll) hellKinds.add(kAll); }
      if (!a.data && !a.freeze && !a.sky && !a.attach) {
        walkers++;
        const fromCrowd = this.spawned.has(a);
        if (fromCrowd) walkersSpawned++;
        const t = ls.tier < 0 ? 0 : ls.tier;
        lods[t as 0 | 1 | 2 | 3]++;
        const k = actionKindOf(a);
        if (k) actions[k] = (actions[k] ?? 0) + 1;
        const ck = `${Math.floor(a.pos.x / 200)},${Math.floor(a.pos.z / 200)}`;
        cells.set(ck, (cells.get(ck) ?? 0) + 1);
        if (k) {
          let set = cellKinds.get(ck);
          if (!set) { set = new Set<BehaviorKind>(); cellKinds.set(ck, set); }
          set.add(k);
        }
        const e = circ.get(ck) ?? { c: 0, s: 0, n: 0, mc: 0, ms: 0, mn: 0 };
        e.c += Math.cos(a.yaw); e.s += Math.sin(a.yaw); e.n++;
        if (a.path.length > 0 || a.action === 'walk' || a.action === 'run') { e.mc += Math.cos(a.yaw); e.ms += Math.sin(a.yaw); e.mn++; }
        circ.set(ck, e);
        if (Math.abs(a.pos.x) <= Crowd.AXIS_X) axis++;
        if (isCrossing(a)) { cross++; if (fromCrowd) crossSpawned++; }
      }
    }
    // 每格行为种类：spec 要求「任一 200m 网格内 ≥3 类」
    let kindsMinPerCell = 99, kindsThinCells = 0, kindsCells = 0;
    for (const [ck, n] of cells) {
      if (n < 10) continue;
      const kc = cellKinds.get(ck)?.size ?? 0;
      kindsCells++;
      if (kc < kindsMinPerCell) kindsMinPerCell = kc;
      if (kc < 3) kindsThinCells++;
    }
    // 场所达标数：30 帧刷新一次（4000+ 人对 110 个坊逐格判定不必每 10 帧算）
    if (!this.placeCache || this.frame - this.placeFrame >= 30) {
      this.placeCache = this.computePlaces(live);
      this.placeFrame = this.frame;
    }
    // 200m 网格香农熵（bit）：均匀约 log2(格数)，单线约 1.5
    let H = 0;
    for (const n of cells.values()) { const p = n / Math.max(1, walkers); H -= p * Math.log2(p); }
    // 每个网格的 yaw 圆标准差：双向流应 ≥1.2rad，单行同向会掉到 0.5 以下。
    // 口径：street = 与路网外框交叠 ≥50% 的「街道格」（真正能走出双向流的格子）；
    // all = 含街尾 20m 残格与外城 A 环坊街——那里的全部行人都只能朝城内走，同向是几何必然，
    //       不是排队，故单独列出、不参与达标判定。
    const nb = navBounds(this.nav);
    let stdMinStreet = Math.PI, stdMinAll = Math.PI, stdSum = 0, stdN = 0, streetCells = 0;
    let movMinStreet = Math.PI, movMinAll = Math.PI, movSum = 0, movN = 0;
    const worst: { cell: string; n: number; std: number; moving: number; stdMoving: number; core: boolean }[] = [];
    for (const [cell, e] of circ) {
      if (e.n < 10) continue;
      const g = cell.split(',');
      const gx = Number(g[0]), gz = Number(g[1]);
      const x0 = gx * 200, z0 = gz * 200;
      const ox = Math.max(0, Math.min(x0 + 200, nb.maxX) - Math.max(x0, nb.minX));
      const oz = Math.max(0, Math.min(z0 + 200, nb.maxZ) - Math.max(z0, nb.minZ));
      const street = (ox * oz) / (200 * 200) >= 0.5;
      const R = Math.hypot(e.c / e.n, e.s / e.n);
      const std = Math.min(Math.PI, Math.sqrt(-2 * Math.log(Math.max(R, 1e-6))));
      if (std < stdMinAll) stdMinAll = std;
      if (street) { streetCells++; if (std < stdMinStreet) stdMinStreet = std; }
      stdSum += std; stdN++;
      let stdMoving = 0;
      if (e.mn >= 10) {
        const rm = Math.hypot(e.mc / e.mn, e.ms / e.mn);
        stdMoving = Math.min(Math.PI, Math.sqrt(-2 * Math.log(Math.max(rm, 1e-6))));
        if (stdMoving < movMinAll) movMinAll = stdMoving;
        if (street && stdMoving < movMinStreet) movMinStreet = stdMoving;
        movSum += stdMoving; movN++;
      }
      worst.push({ cell, n: e.n, std: +std.toFixed(3), moving: e.mn, stdMoving: +stdMoving.toFixed(3), core: street });
    }
    worst.sort((a, b) => a.std - b.std);
    for (const a of live) { const ls = lodStateOf(a); blocked += ls.blocked; fallbacks += ls.fallbacks; }
    const ch = behaviorChangeStats(this.simT > 0 ? this.simT : undefined);
    let kinds = 0;
    for (const k of ACTION_KINDS) if (actions[k] > 0) kinds++;
    const stat: CrowdStats = {
      live: live.length,
      total: this.actors.length,
      walkers,
      lods: lodsAll,
      lodsWalkers: lods,
      actions,
      kinds,
      kindsMinPerCell,
      kindsThinCells,
      kindsCells,
      places: this.placeCache!,
      venues: { ...this.venueReport },
      sky, hell,
      skyKinds: skyKinds.size, hellKinds: hellKinds.size,
      gridEntropy: +H.toFixed(3),
      gridCells: cells.size,
      axisShare: +(walkers ? axis / walkers : 0).toFixed(4),
      crossShare: +(walkersSpawned ? crossSpawned / walkersSpawned : 0).toFixed(4),
      crossShareAll: +(walkers ? cross / walkers : 0).toFixed(4),
      walkersSpawned,
      yawStdMin: +(streetCells && stdMinStreet < Math.PI ? stdMinStreet : 0).toFixed(3),
      yawStdMinAll: +(stdN ? stdMinAll : 0).toFixed(3),
      yawStdMean: +(stdN ? stdSum / stdN : 0).toFixed(3),
      yawCells: stdN,
      yawStreetCells: streetCells,
      yawMovingMin: +(movN && movMinStreet < Math.PI ? movMinStreet : 0).toFixed(3),
      yawMovingMinAll: +(movN ? movMinAll : 0).toFixed(3),
      yawMovingMean: +(movN ? movSum / movN : 0).toFixed(3),
      yawMovingCells: movN,
      yawWorst: worst.slice(0, 5),
      changes60s: ch.changes60s,
      kinds60s: ch.kinds60s,
      lodBlocked: blocked,
      lodFallbacks: fallbacks,
      spawn: { ...this.spawnReport },
      collision: this.collisionAudit(),
    };
    return stat;
  }

  /** 供探针 / 测试直接调用：返回当前统计并同步 window.__crowd */
  stats(): CrowdStats {
    this.lastStats = this.computeStats();
    (globalThis as unknown as Record<string, unknown>)['__crowd'] = this.lastStats;
    return this.lastStats;
  }

  update(t: number, dt: number, camPos: THREE.Vector3): void {
    this.frame++;
    this.simT = t;
    // 首帧补建场所人群（此时 world 的寺院/瓦舍热点、天宫/地府角色、POIS 地府条目都已就位）
    this.ensureVenues();
    // R27：所有出生完成 + solids 索引齐备后，做一次全量落位收敛（只跑一次，零常驻开销）。
    if (!this.settledAll) {
      this.settledAll = true;
      this.settleAll();
    }
    // 局部避让网格每 4 帧重建一次（O(n)）：行人靠它在 1.6m 内找邻居并向空侧让开。
    // 每帧重建没有必要，4 帧 ≈ 66ms，远小于一个人走完半个身位的时间。
    if ((this.frame & 3) === 0) rebuildAvoidGrid(this.actors);
    const ctx = this.ctx(camPos, t);
    // 受击到期判定读注入时钟：旧实现读墙钟，暂停 / 快进 / 回放时僵直会按真实时间过期。
    const now = this.clock();
    for (const a of this.actors) {
      // 动作变更检测：重置动作时间线（受击动作需要）
      if (a.action !== a.lastAction) { a.lastAction = a.action; a.actionT = 0; }
      a.actionT += dt;
      a.actT += dt; // freeze/attach 演员的动作相位照走（B4 名将定桩不僵立）
      // 隐藏转换：visible→hidden 时清一次实例矩阵，避免残影雕像
      if (a.hidden) {
        if (a.lastWrite >= 0) { hideActor(this.ps, a); a.lastWrite = -1; }
        continue;
      }
      // sky 不再一律跳过：R12-D 新加的天宫/地府驻场者要产生行为（既有神佛/天兵/名将都是 freeze，照旧不动）
      if (!a.freeze && !a.attach && now >= a.impactUntil) tickActor(a, dt, ctx);
      if (a.attach) a.attach({ pos: a.pos, yaw: a.yaw, y: a.yOff });
      // R26 桥面不变量先做：桥带内的人先贴到 bridgeDeckY(z)（抬到 0.7m 以上），
      // 再让 keepOffRiver 判河道——否则从街上走上桥的人 y=0，会先被当成河里的人推回岸上。
      keepOnBridgeDeck(a);
      // R20 河道不变量：行为层的横向穿行不许把人带进水面（attach 演员由各自系统定位，不在此列）
      if (!a.freeze && !a.attach && !a.sky && !a.hidden) keepOffRiver(a.pos);
      // 行走面兜底（R27）：移动积分已经挡墙/贴地；这里只救两类漏网——
      // 出生时就在墙里的、被别的系统（击退/载具）塞进墙里的。每 4 帧查一次，避免每帧两次查询。
      // R27 逐帧兜底：主判定走全城 solids（贴地 + 推出），旧 pushOutOfBuildings 作补充。
      // freeze 角色（不进 tickActor 的仪仗侍卫）每 30 帧低频校验一次（≤1s，含低帧率），
      // 确保嵌墙的也被推出；行走角色每 4 帧校验。上限放宽到 120（含城墙/高台戍卒）。
      if (!a.attach && !a.sky && !a.hidden && a.pos.y > -5 && a.pos.y <= 120) {
        // R27 硬门禁：任何一帧结束都不允许残留嵌墙 / 陷地角色。
        // 此前按 (frame+id) 每 2/4 帧轮转，实机抓到 id=1490 在 frame=3 时
        // （(3+1490)%2=1，没轮到）被上一帧的移动积分塞进墙带，blockedOwn=true、
        // wsOwn=null；下一帧轮到才归零。外部在帧间取样就报「加载时嵌墙 1 人」。
        // 改为每帧兜底：CPU 侧是空间哈希 O(1) 查询，不新增 draw call / 材质 / 几何，
        // 软渲染瓶颈在 114M tris 的 GPU 侧，不构成稳态帧时间主因。
        settleWalkPos(a.pos, 0.34);
      }

      // ---- 角色 LOD：四档 + 25% 滞回 ----
      const d2 = a.pos.distanceToSquared(camPos);
      const ls = lodStateOf(a);
      const want = resolveActorLod(ls.tier, Math.sqrt(d2));
      if (want !== ls.tier) {
        ls.prev = ls.tier;
        ls.tier = want;
        ls.switches++;
        // 换档先清掉上一档的全部实例（否则低模与高模会同时留在场上）
        hideActor(this.ps, a);
        a.lastWrite = -1;
      }
      const tier = ls.tier < 0 ? 0 : ls.tier;
      const interval = tier === 0 ? 1 : tier === 1 ? 2 : tier === 2 ? 4 : 9;
      if (a.lastWrite < 0 || (this.frame + a.id) % interval === 0) {
        const ok = writeActor(this.ps, a, t, tier);
        if (!ok) {
          // 近档兜底：目标档池未就绪 → 退回上一档（或中模），绝不留空
          const fb = ls.prev >= 1 && ls.prev !== tier ? ls.prev : 1;
          ls.tier = fb;
          ls.fallbacks++;
          hideActor(this.ps, a);
          writeActor(this.ps, a, t, fb);
        }
        a.lastWrite = this.frame;
      }
    }
    this.ps.flushAll();
    this.wardrobe.flush();
    if (this.nameplates) this.nameplates.update(camera0 ?? ({ position: camPos } as THREE.Camera), this.heroes);
    // 统计面：第 1 帧就发布（否则软件渲染 1fps 时要等 15 秒才有 window.__crowd），
    // 之后每 10 帧刷新一次，避免每帧遍历 4000+ 角色做熵统计
    if (this.frame === 1 || this.frame % 10 === 0) this.stats();
  }
}

export interface PlaceStats {
  /** 达标数量（不是布尔）：里坊 ≥6 / 寺院 ≥8 且出现 worship / 宫城 ≥60 且出现 guard·serve / 瓦舍 ≥20 */
  wards: number; temples: number; palace: number; washe: number;
  wardsTotal: number; templesTotal: number; washeTotal: number;
  palacePop: number;
}

export interface CrowdStats {
  live: number; total: number; walkers: number;
  lods: [number, number, number, number];
  lodsWalkers: [number, number, number, number];
  actions: Record<string, number>;
  kinds: number;
  kindsMinPerCell: number; kindsThinCells: number; kindsCells: number;
  places: PlaceStats;
  venues: { planned: number; spawned: number; wards: number; temples: number; palace: number; washe: number; sky: number; hell: number };
  sky: number; hell: number; skyKinds: number; hellKinds: number;
  gridEntropy: number; gridCells: number;
  axisShare: number; crossShare: number; crossShareAll: number; walkersSpawned: number;
  yawStdMin: number; yawStdMinAll: number; yawStdMean: number; yawCells: number; yawStreetCells: number;
  yawMovingMin: number; yawMovingMinAll: number; yawMovingMean: number; yawMovingCells: number;
  yawWorst: { cell: string; n: number; std: number; moving: number; stdMoving: number; core: boolean }[];
  changes60s: number; kinds60s: number;
  lodBlocked: number; lodFallbacks: number;
  spawn: { planned: number; spawned: number; rejected: number; skipped: number; axis: number; cross: number };
  /** R27 碰撞审计（collisionAudit() 真实计算，验收脚本读此项） */
  collision: { embedded: number; sunken: number; sample: { id: number; x: number; y: number; z: number }[] };
}

interface Anchor { x: number; y: number; z: number; w: number; dir: number; axis: boolean; bridge: boolean; zone: string }

// ---- 宫城俯瞰方阵统一服色（R20 二轮精修）：把「card 哈希灰暗杂色」换成「按身份鲜明色块」----
// 根因：grid 人群原本只给 cardId，spawnActor 走 cardLook → CARD_PALETTE 十档灰暗浊色
//   （0x8a6a3a/0x5a7a8a/0x2e4e5e…），俯瞰由 writeActorFar 用 a.cloth 写 instanceColor，
//   tier3 剪影档还要 ×0.55 压暗 —— 于是成了一片散落的黑点，读不出朝会班列。
// 修法：经 spawnActor 既有的 cloth?/pants?/skin?/hat? 入口显式传入服色，覆盖卡色；
//   InstPool.set → setColorAt 的既有实例色机制不变，不新造材质、不新增 draw call。
//   色值全部取高亮高饱和通道，抵消 tier3 ×0.55 后仍在俯瞰下可辨。
interface CourtUniform {
  cloth: number; pants: number; skin: number; hat: number;
  /** 可选：按列循环的袍色，方阵内部形成纵向彩色条带（用于内廷多身份） */
  stripe?: number[];
}
const COURT_UNIFORMS: Record<string, CourtUniform> = {
  '王公大臣': { cloth: 0x6b5bff, pants: 0x2c2570, skin: 0xf0d5b0, hat: 1 },  // 石青紫 · 幞头
  '仪仗东班': { cloth: 0xff3b2f, pants: 0x7a1a12, skin: 0xdca878, hat: 1 },  // 朱红甲胄
  '仪仗西班': { cloth: 0xff8a2a, pants: 0x7a2a10, skin: 0xdca878, hat: 1 },  // 橙红（与东班可辨）
  '禁军东阵': { cloth: 0xfbb81c, pants: 0x7a5410, skin: 0xdca878, hat: 1 },  // 金甲
  '禁军西阵': { cloth: 0xf7d23a, pants: 0x7a6410, skin: 0xdca878, hat: 1 },  // 明黄金甲
  // 内廷一条带按列循环覆盖帝后/妃嫔/太监/宫女/皇子公主 5 类身份色
  '帝后内廷': { cloth: 0xffd23f, pants: 0x8a6a10, skin: 0xf5dcc0, hat: 3,
    stripe: [0xffd23f, 0xe8487a, 0x6b8fa8, 0xf2eefb, 0xffb03a] },            // 明黄/胭脂/青灰/月白/杏黄
  '宫女侍从': { cloth: 0xff5fa8, pants: 0x9a3a68, skin: 0xf5dcc0, hat: 3 },  // 胭脂粉 · 发髻
  '午门禁军': { cloth: 0x3f6ee0, pants: 0xb02118, skin: 0xdca878, hat: 1 },  // 靛青（玄黑提亮免回退黑点）镶红
};
/** 方阵行列步距（m）：2.0 → 1.6，收紧成俯瞰密实色块 */
const COURT_GRID_STEP = 1.6;
/** 中轴御道留白半宽（m）：|x| 小于此值的点整体外推到两侧，红毯畅通、班列分列 */
const COURT_AXIS_CLEAR = 9;
/** 朝会统一朝向（面朝太和殿 −z），整阵一致，不再逐点 atan2 成扇形 */
const COURT_YAW = Math.PI;

/** R12-C/D 场所驻场点：count 人落在半径 r 内，kinds 为该场所的专属行为 */
interface Venue {
  name: string; x: number; y: number; z: number; r: number; count: number;
  sky: boolean; kinds: BehaviorKind[]; occ: string[];
  /** 环形场所的簇数（十八狱环 = 18） */
  ring?: number;
  /** 宫城俯瞰密集阵列（R20 补充）：确定性行列网格，count = rows*cols，不走 rng 极坐标撒点 */
  grid?: {
    rows: number; cols: number; dx: number; dz: number; prop: string | null;
    uniform: CourtUniform; axisGap?: number;
  };
}

/** 节点属于哪条街：返回沿街方向（yaw 基准）、是否中轴、是否桥面、街道权重 */
function streetOf(x: number, z: number): { dir: number; axis: boolean; bridge: boolean; importance: number } {
  const axis = Math.abs(x) <= Crowd.AXIS_X;
  if (Math.abs(x) <= 3.2 && Math.abs(z) <= BRIDGE_HALF + 0.5) {
    return { dir: 0, axis: true, bridge: true, importance: 0.55 };
  }
  for (const s of H_STREETS) {
    if (Math.abs(z - s.z) < 1.2) {
      const imp = s.z === 52 ? (s.x1 > 470 ? 1.15 : 1.4) : s.z === -52 ? 1.15 : 0.95;
      return { dir: Math.PI / 2, axis, bridge: false, importance: imp };
    }
  }
  for (const s of V_STREETS) {
    if (Math.abs(x - s.x) < 1.2) return { dir: 0, axis, bridge: false, importance: 0.85 };
  }
  return { dir: 0, axis, bridge: false, importance: 1 };
}

/** 职业 → 热点区域倍率（脚夫去码头、僧道去庙口、赌客去赌坊…） */
const OCC_ZONE: Record<string, Record<string, number>> = {
  porter: { dock: 3, stall: 1.6, food: 1.2, tow: 1.6 },
  tracker: { tow: 3, dock: 2 },
  monk: { shrine: 3.5, story: 1.2 },
  taoist: { shrine: 3, fortune: 2.4 },
  beggar: { shrine: 2, social: 1.6, street: 1.2 },
  scholar: { letter: 3, story: 2, stall: 1.5 },
  official: { story: 1.5, social: 1.5, gate: 1.2 },
  gambler: { dice: 3.5 },
  brawler: { fight: 3.2, wine: 1.6 },
  drinker: { wine: 3, food: 2 },
  musician: { stage: 3.5 },
  acrobat: { stage: 3.2, social: 2 },
  soldier: { gate: 1.5, social: 1.2 },
  watchman: { gate: 1.3, social: 1.4 },
  lady: { stall: 2, tea: 2, social: 1.4 },
  kid: { stage: 2.4, social: 2, story: 2 },
  peddler: { stall: 2, dock: 1.8 },
  vendor: { stall: 3 },
  farmer: { stall: 2, dock: 2 },
  fisher: { tow: 3, dock: 2 },
  merchant: { stall: 2, wine: 1.6 },
  customer: { stall: 1.6, tea: 1.4, food: 1.4, social: 1.2 },
  sailor: { dock: 3, tow: 2 },
  camelDriver: { gate: 2.4, stall: 1.3 },
};

// 相机引用由 world 注入（避免循环依赖）
export let camera0: THREE.Camera | null = null;
export function setCameraRef(c: THREE.Camera): void { camera0 = c; }

/** 冠帽四档权重 → 档位。rng 由调用方给（spawnActor 的注入源），不读全局随机。 */
function pickHat(w: [number, number, number, number], rng: Random): number {
  const total = w[0] + w[1] + w[2] + w[3];
  let r = rng() * total;
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}
