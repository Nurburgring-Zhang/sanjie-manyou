import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PoolSet, InstPool, BODY_MAT, MAX_HUMANS } from './pools';
import { ACTIONS, newPose, Pose, ActView, ActionFn } from './actions';
import type { Actor } from './types';
import { JOBS, JOB_MAP, SpotRegistry } from '../data/jobs';
import { NavGraph, H_STREETS, V_STREETS, BRIDGE_HALF, POIS, bridgeDeckY } from '../city/layout';
import {
  tickActor, BehCtx, markCrossing, isCrossing, actionKindOf, behaviorChangeStats,
  ACTION_KINDS, CROSS_SHARE, navBounds, BehaviorKind, initBehavior, setPost, rebuildAvoidGrid,
} from './behaviors';
import { SignAtlas } from '../city/bake';
import { wardCells, PALACE } from '../city/imperial';
import { beltRoomSpecs } from '../city/centralbelt';
import { riverRoomSpecs } from '../city/riverbank';
import { STREET_HOUSE_SLOTS } from '../city/interiors';
import { inRiverFootprint, riverCenterZ, riverHalfWidth, RIVER_WATER_Y } from '../city/riverGeom';
// R12-D：地府地面高程只从 sky/underworld.ts 只读导入（该文件不做任何修改）
import { UNDER } from '../sky/underworld';

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
    // 刚走下桥（桥端外 10m 内）：桥面高度收回到街面，否则会带着 0.7m 的桥端高度在街上飘
    if (a.pos.y > 0.4 && a.pos.y < 9) a.pos.y = 0;
    return;
  }
  // 已经悬空/站在桥面上的人按净宽 ±10 收回来（实测悬空点在 x=-8.2）；
  // 贴地的人只有本来就落在桥面足迹（±5.2）内才抬上桥，避免把桥头的岸上行人吸到桥面。
  const elevated = a.pos.y > 0.5;
  if (Math.abs(a.pos.x) > (elevated ? 10 : 5.2)) return;
  a.pos.x = THREE.MathUtils.clamp(a.pos.x, -4.8, 4.8);
  a.pos.y = bridgeDeckY(THREE.MathUtils.clamp(a.pos.z, -BRIDGE_HALF, BRIDGE_HALF));
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

function pickW(w: number[]): number {
  let total = 0;
  for (const x of w) total += x;
  let r = Math.random() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}

function makeLook(occ: string, W: Wardrobe, bases: Record<string, number>, sil: number, shoe: number, headKit?: 'bull' | 'horse', card?: CardLook | null): Look {
  const g = card ? card.g : pickW(OCC_GARMENT[occ] ?? GARMENT_DEFAULT);
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
  const acc = card ? cardAcc(occ, card.u) : pickW(OCC_ACC[occ] ?? [10, 0, 0]);
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

  constructor(scene: THREE.Scene, readonly nav: NavGraph) {
    this.ps = new PoolSet(scene);
    this.wardrobe = new Wardrobe(scene);
    WARDROBES.set(this.ps, this.wardrobe);
  }
  /** 守卫累计推移人次（= 没有守卫时会穿墙/陷地的人次） */
  guardMoves(): number { return GUARD_MOVES; }

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
    const pQ = card ? card.p : Math.random();
    const pOv = OCC_PROP[o.occ];
    const pBase = job && job.props.length > 0
      ? (card ? cardProp(job.props, card.p) : (pQ < 0.8 ? job.props[Math.min(job.props.length - 1, (pQ / 0.8 * job.props.length) | 0)] : null))
      : null;
    const propPool = o.prop !== undefined ? o.prop : ((pOv && pQ < pOv[1]) ? pOv[0] : pBase);
    const a: Actor = {
      id: this.idSeq++,
      pos: o.pos.clone(), yaw: o.yaw ?? Math.random() * Math.PI * 2,
      speed: job ? job.speed[0] + Math.random() * (job.speed[1] - job.speed[0]) : 1,
      action: o.action ?? 'stand', actT: Math.random() * 100, timer: Math.random() * 4,
      occ: o.occ, seed: card ? card.seed : Math.random() * 1000,
      // 儿童身高由 OCC_SCALE 统一 ×0.62（整组实例），故基础 scale 取 1，避免与 job.scale 叠乘成矮人
      scale: o.scale ?? (o.occ === 'kid' ? 1 : (job?.scale ? job.scale[0] + (card ? card.r : Math.random()) * (job.scale[1] - job.scale[0]) : 0.9 + (card ? card.r : Math.random()) * 0.24)),
      hat: o.hat ?? (card ? pickWeighted(job ? job.hats : CARD_HAT_DEFAULT, card.v) : pickHat(job ? job.hats : [1, 3, 3, 2])),
      cloth: new THREE.Color(o.cloth ?? (card ? card.color : (job ? job.cloth[Math.floor(Math.random() * job.cloth.length)] : 0x6a6a6a))),
      pants: new THREE.Color(o.pants ?? (job ? job.pants[Math.min(job.pants.length - 1, ((card ? card.x : Math.random()) * job.pants.length) | 0)] : 0x3a3a3a)),
      skin: new THREE.Color(o.skin ?? (card ? (card.w < 0.34 ? 0xd8b090 : card.w < 0.67 ? 0xc8a080 : 0xb89070) : (Math.random() < 0.34 ? 0xd8b090 : Math.random() < 0.5 ? 0xc8a080 : 0xb89070))),
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
    // 出生建筑守卫：摊主/名将这类给定坐标的角色若正好落在铺面里（实测茶博士的 (-36,58)
    // 就在 9 座手工街屋「茶坊」(-36,62,11×9) 的台基内），出生即推到街面，否则整场都陷在地板下。
    if (a.pos.y > -0.4 && a.pos.y < 12 && !a.sky) pushOutOfBuildings(a.pos);
    if (a.hat === 0 && (card ? cardStraw(a.occ, card.s) : Math.random() < (STRAW_HAT[a.occ] ?? 0))) a.hat = 2;
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
    if (o.cloth === undefined && !card) a.cloth.offsetHSL((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.18);
    if (o.pants === undefined && !card) a.pants.offsetHSL((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15);
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
    else LOOKS.set(a, makeLook(a.occ, this.wardrobe, bases, sil, shoe, o.headKit, card));
    this.actors.push(a);
    // 所有角色出生即带行为类：第一帧的 __crowd.actions / 每格行为种类就是完整分布，
    // 不必等第一次 tick（否则快照会读到一堆 null，格子种类被低估）。
    initBehavior(a);
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
      const j = Math.floor(Math.random() * (i + 1));
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
      let r = Math.random() * total;
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
      const along = (Math.random() * 2 - 1) * 12;
      const across = (Math.random() * 2 - 1) * 3.2;
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
    const r = Math.random();
    const crossing = r < CROSS_SHARE;
    if (crossing) {
      yaw = (b ? b.dir : 0) + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (Math.random() - 0.5) * 0.8;
    } else if (r < CROSS_SHARE + 0.13) {
      yaw = Math.random() * Math.PI * 2;
    } else {
      yaw = (b ? b.dir : 0) + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.0;
    }
    const a = this.spawnActor({ occ, pos: new THREE.Vector3(p.x, p.y, p.z), yaw });
    if (crossing) markCrossing(a);
    initBehavior(a);   // 出生即定行为类：__crowd.actions 从第一帧起就是完整分布
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

  ctx(camPos: THREE.Vector3, t = this.simT): BehCtx {
    return { nav: this.nav, spots: this.spots, isNight: this.isNight, camPos, t };
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

    let planned = 0;
    for (const v of plan) planned += v.count;
    this.venueReport.planned = planned;
    if (this.actors.length + planned > MAX_HUMANS) {
      throw new Error(`[人口池断言] 场所人群：已用 ${this.actors.length} + 计划 ${planned} > MAX_HUMANS ${MAX_HUMANS}`);
    }
    for (const v of plan) {
      const n = this.spawnVenue(v);
      this.venueReport.spawned += n;
      if (v.name.startsWith('天宫')) this.venueReport.sky += n;
      else if (v.name.startsWith('地府')) this.venueReport.hell += n;
      else if (v.name.startsWith('坊')) this.venueReport.wards += n;
      else if (v.name === '寺观') this.venueReport.temples += n;
      else if (v.name === '宫城') this.venueReport.palace += n;
      else if (v.name === '瓦舍') this.venueReport.washe += n;
    }
    this.ps.assertCapacity('ensureVenues');
    if (this.wardrobe.fails > 0) {
      throw new Error(`[衣装池断言] ensureVenues 有 ${this.wardrobe.fails} 次池满`);
    }
  }

  private spawnVenue(v: Venue): number {
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
          const ang = span * s + ((slot + 0.5) / slots - 0.5) * span * 0.86 + (Math.random() - 0.5) * span * 0.04;
          const rr = v.r + (band - 1) * v.r * 0.11 + (Math.random() - 0.5) * 1.8;
          x = v.x + Math.cos(ang) * rr; z = v.z + Math.sin(ang) * rr;
        } else {
          const ang = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * v.r;
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
        occ: v.occ[Math.floor(Math.random() * v.occ.length)],
        pos: new THREE.Vector3(x, v.y, z),
        yaw: Math.random() * Math.PI * 2,
        sky: v.sky,
        action: 'stand',
        doing: '',
      });
      // 环形场所的人钉在自己那座狱门前（半径 10m），不能以环心为岗——
      // 否则 80m 的岗位半径会把人撒到整个环盘上，十八狱人数的分区统计就被抹平了。
      setPost(a, v.ring
        ? { x, y: v.y, z, r: 10, kinds: v.kinds, venue: v.name }
        : { x: v.x, y: v.y, z: v.z, r: v.r, kinds: v.kinds, venue: v.name });
      initBehavior(a, v.kinds);
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
    // 局部避让网格每 4 帧重建一次（O(n)）：行人靠它在 1.6m 内找邻居并向空侧让开。
    // 每帧重建没有必要，4 帧 ≈ 66ms，远小于一个人走完半个身位的时间。
    if ((this.frame & 3) === 0) rebuildAvoidGrid(this.actors);
    const ctx = this.ctx(camPos, t);
    const now = performance.now();
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
      // 建筑足迹不变量：铺面墙体不做碰撞体，靠这一道守卫把人推出墙面（见 pushOutOfBuildings）
      if (a.pos.y > -5 && a.pos.y < 12 && !a.freeze && !a.attach && !a.sky && !a.hidden) pushOutOfBuildings(a.pos);

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
}

interface Anchor { x: number; y: number; z: number; w: number; dir: number; axis: boolean; bridge: boolean; zone: string }

/** R12-C/D 场所驻场点：count 人落在半径 r 内，kinds 为该场所的专属行为 */
interface Venue {
  name: string; x: number; y: number; z: number; r: number; count: number;
  sky: boolean; kinds: BehaviorKind[]; occ: string[];
  /** 环形场所的簇数（十八狱环 = 18） */
  ring?: number;
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

function pickHat(w: [number, number, number, number]): number {
  const total = w[0] + w[1] + w[2] + w[3];
  let r = Math.random() * total;
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}
