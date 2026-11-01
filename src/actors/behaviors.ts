import * as THREE from 'three';
import type { Actor } from './types';
import { JOB_MAP, SpotRegistry } from '../data/jobs';
import { NavGraph, BRIDGE_HALF, bridgeDeckY, H_STREETS, V_STREETS } from '../city/layout';
import { inRiverFootprint } from '../city/riverGeom';

// ============ 干地判定（目标点级，只加严不放宽） ============
// 行为层的游荡目标以前只看路网节点，完全不看河道；驻场者（里坊/寺观/瓦舍）的圆内取点更容易
// 落到汴河里，于是「人往水面走、tick 末尾再被 keepOffRiver 推回岸」——视觉上就是贴着水线走。
// 这里在**选目标时**就拒绝水面：桥带内一律算干地（桥面几何归 layout 所有），其余点必须离河 3m。
const onBridgeSpan = (x: number, z: number): boolean => Math.abs(x) <= 8 && Math.abs(z) <= BRIDGE_HALF;
const dryPoint = (x: number, z: number): boolean => onBridgeSpan(x, z) || !inRiverFootprint(x, z, 3.0);
/** 起点到终点是否全程干地（4m 采样）：拦住「同岸两点直线斜穿河道」 */
function drySegment(x0: number, z0: number, x1: number, z1: number): boolean {
  const span = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(span / 4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!dryPoint(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

// ============ 局部避让网格 ============
// 4m 格，由 Crowd.update 每 4 帧重建一次（O(n)）。行人只在自己这一格与 8 邻格里找
// 1.6m 内的邻居，得到横向排斥向量；目标值每 0.15s 刷新一次，避免每帧几十万次距离判定。
const AVOID_CELL = 4;
const AVOID_LOOK = 1.6;
let AVOID: Map<number, Actor[]> = new Map();
const cellKey = (ix: number, iz: number): number => (ix + 100000) * 200003 + (iz + 100000);
export function rebuildAvoidGrid(actors: Actor[]): void {
  const g = new Map<number, Actor[]>();
  for (const a of actors) {
    if (a.hidden) continue;
    const k = cellKey(Math.floor(a.pos.x / AVOID_CELL), Math.floor(a.pos.z / AVOID_CELL));
    let arr = g.get(k);
    if (!arr) { arr = []; g.set(k, arr); }
    arr.push(a);
  }
  AVOID = g;
}


// ============ 行为库（R12-B）：12 类世相 × 各自停留时长 ============
// 与既有「职业 → 单个动作」的区别：这里的 12 类是「这段时间他在过什么日子」，
// 类内还有若干具体动作（挑担 / 打铁 / 吃面 / 看戏…），类每 30–180s 换一次。
// R12-C/D 追加 4 类场所专属行为（礼佛 / 值守 / 执役 / 看戏），供寺院、宫城、瓦舍、三界驻场人群使用。
// 判定口径见 artifacts/SPEC-R12-人口与行为.md §三、SPEC-R12-C、SPEC-R12-D。
export type BehaviorKind =
  | 'work' | 'trade' | 'food' | 'entertain' | 'chat' | 'rest'
  | 'transport' | 'religion' | 'chores' | 'child' | 'patrol' | 'sightsee'
  | 'worship' | 'guard' | 'serve' | 'watch_play';

export const ACTION_KINDS: BehaviorKind[] = [
  'work', 'trade', 'food', 'entertain', 'chat', 'rest',
  'transport', 'religion', 'chores', 'child', 'patrol', 'sightsee',
  'worship', 'guard', 'serve', 'watch_play',
];

export interface BehCtx { nav: NavGraph; spots: SpotRegistry; isNight: boolean; camPos: THREE.Vector3; t?: number }
export interface BehStep { act: string; doing: string; dur: [number, number]; move?: boolean; spot?: string }
export interface BehKindDef { label: string; stay: [number, number]; steps: BehStep[] }

/** 停留时长口径：spec 表里的「停留」= 单次活动的时长区间；类本身按 30–180s 换。 */
const S = (act: string, doing: string, dur: [number, number], move = false, spot?: string): BehStep => ({ act, doing, dur, move, spot });

export const BEHAVIOR_LIB: Record<BehaviorKind, BehKindDef> = {
  work: {
    label: '工作', stay: [20, 60], steps: [
      S('carryPole', '挑担运货', [14, 30], true),
      S('hammerAnvil', '捶打铁器', [12, 26], false, 'stall'),
      S('sweep', '洒扫街面', [10, 22], false, 'stall'),
      S('cook', '灶上烹调', [10, 22], false, 'food'),
      S('write', '伏案抄写', [12, 24], false, 'letter'),
      S('pullTree', '牵绳起木', [10, 20], false, 'dock'),
      S('crank', '绞盘收缆', [10, 20], false, 'dock'),
    ],
  },
  trade: {
    label: '交易', stay: [10, 40], steps: [
      S('bowTrade', '讨价还价', [8, 20], false, 'stall'),
      S('hawk', '高声叫卖', [10, 24], false, 'stall'),
      S('browse', '挑拣货物', [6, 18], false, 'stall'),
      S('present', '称重收货', [6, 14], false, 'stall'),
      S('walk', '赶去下个市口', [8, 18], true),
    ],
  },
  food: {
    label: '饮食', stay: [15, 45], steps: [
      S('eat', '吃面喝汤', [12, 28], false, 'food'),
      S('drink', '一碗浊酒', [12, 30], false, 'wine'),
      S('sitTea', '茶坊吃茶', [16, 36], false, 'tea'),
      S('browse', '买些果子', [6, 14], false, 'food'),
    ],
  },
  entertain: {
    label: '娱乐', stay: [30, 120], steps: [
      S('sitTea', '勾栏听书', [30, 90], false, 'story'),
      S('dice', '赌坊掷骰', [16, 40], false, 'dice'),
      S('fanSway', '摇扇看戏', [20, 60], false, 'stage'),
      S('lookAround', '围观百戏', [16, 44], false, 'stage'),
      S('sumo', '看相扑', [14, 36], false, 'fight'),
    ],
  },
  chat: {
    label: '交谈', stay: [8, 30], steps: [
      S('chat', '街边闲谈', [8, 24], false, 'social'),
      S('chat', '问路搭话', [6, 16]),
      S('argue', '当街口角', [5, 14], false, 'fight'),
      S('lookAround', '听人说话', [6, 16], false, 'social'),
    ],
  },
  rest: {
    label: '休憩', stay: [60, 180], steps: [
      S('squatRel', '墙根打盹', [36, 90]),
      S('sitNap', '树下小睡', [40, 110]),
      S('sitTea', '门槛上坐', [30, 80], false, 'tea'),
      S('stand', '靠墙歇脚', [20, 50]),
    ],
  },
  transport: {
    label: '交通', stay: [30, 90], steps: [
      S('walk', '沿街赶路', [20, 50], true),
      S('carryPole', '挑担过街', [20, 50], true),
      S('staggerWalk', '醉步踉跄', [18, 40], true),
      S('rideAnimal', '牵马缓行', [20, 46], true),
      S('carryPalanquin', '抬轿赶路', [20, 46], true),
    ],
  },
  religion: {
    label: '宗教', stay: [20, 60], steps: [
      S('incense', '上香祈福', [12, 28], false, 'shrine'),
      S('pray', '佛前叩拜', [12, 30], false, 'shrine'),
      S('monkBow', '稽首问讯', [10, 24], false, 'shrine'),
      S('preach', '当街讲经', [16, 36], false, 'shrine'),
    ],
  },
  chores: {
    label: '家务', stay: [20, 60], steps: [
      S('waterCarry', '挑水回家', [16, 36], true),
      S('sweep', '门前洒扫', [12, 28], false, 'social'),
      S('stand', '门前晾衣', [16, 40]),
      S('browse', '买菜办饭', [8, 18], false, 'food'),
    ],
  },
  child: {
    label: '孩童', stay: [30, 90], steps: [
      S('kiteRun', '放纸鸢', [20, 50], true),
      S('run', '追逐打闹', [16, 40], true),
      S('lookAround', '看热闹', [12, 28], false, 'story'),
      S('chat', '叽叽喳喳', [8, 20], false, 'social'),
    ],
  },
  patrol: {
    label: '巡守', stay: [30, 90], steps: [
      S('walk', '巡街查夜', [20, 50], true),
      S('stand', '执戟守门', [16, 40]),
      S('lookAround', '盘查行人', [10, 24]),
      S('bellTower', '敲更报时', [8, 16], false, 'social'),
      S('spearThrust', '演武操练', [10, 22], false, 'stage'),
    ],
  },
  sightsee: {
    label: '观景', stay: [20, 60], steps: [
      S('stand', '凭栏远眺', [20, 50]),
      S('lookAround', '桥上驻足', [16, 40]),
      S('fanSway', '临风摇扇', [16, 36]),
      S('browse', '看河上舟船', [12, 28], false, 'tow'),
    ],
  },
  // ---- R12-C/D 场所专属行为：不能全用街面的 walk/stand ----
  worship: {
    label: '礼佛', stay: [20, 60], steps: [
      S('incense', '上香祈福', [12, 28], false, 'shrine'),
      S('pray', '殿前叩拜', [12, 30], false, 'shrine'),
      S('monkBow', '稽首问讯', [10, 24], false, 'shrine'),
      S('sweep', '扫洒庭院', [10, 22], false, 'shrine'),
      S('preach', '讲经说法', [16, 36], false, 'shrine'),
    ],
  },
  guard: {
    label: '值守', stay: [30, 90], steps: [
      S('stand', '执戟侍立', [18, 44]),
      S('lookAround', '盘查来往', [10, 24]),
      S('spearThrust', '演武操练', [10, 22]),
      S('walk', '换岗巡行', [16, 36], true),
    ],
  },
  serve: {
    label: '执役', stay: [20, 60], steps: [
      S('present', '奉茶进膳', [10, 24]),
      S('sweep', '洒扫执役', [10, 22]),
      S('waterCarry', '提水穿廊', [12, 26], true),
      S('cook', '灶下烹煮', [10, 22]),
      S('stand', '廊下侍立', [16, 40]),
    ],
  },
  watch_play: {
    label: '看戏', stay: [30, 120], steps: [
      S('sitTea', '棚下看戏', [30, 80]),
      S('lookAround', '叫好喝彩', [12, 30]),
      S('chat', '与邻座议论', [10, 24]),
      S('fanSway', '摇扇听书', [16, 40]),
    ],
  },
};

// ---- 职业 → 行为类权重（未列职业走 DEFAULT_W）----
type KindWeights = Record<BehaviorKind, number>;
const DEFAULT_W: KindWeights = {
  work: 6, trade: 12, food: 12, entertain: 8, chat: 16, rest: 10,
  transport: 14, religion: 4, chores: 8, child: 0, patrol: 2, sightsee: 10,
  // 场所专属类默认不进街面权重，只由驻场岗位（Post.kinds）指派
  worship: 0, guard: 0, serve: 0, watch_play: 0,
};

const OCC_KIND_W: Record<string, Partial<KindWeights>> = {
  peddler: { transport: 34, trade: 30, work: 14, chat: 10, rest: 6, sightsee: 4 },
  vendor: { trade: 56, work: 14, food: 8, chat: 12, rest: 6, entertain: 4 },
  customer: { trade: 18, food: 16, entertain: 14, chat: 14, sightsee: 12, rest: 8, chores: 8, religion: 6, work: 4 },
  porter: { work: 44, transport: 30, rest: 12, food: 8, chat: 6 },
  tracker: { work: 54, transport: 20, rest: 14, food: 8 },
  scholar: { entertain: 18, trade: 10, chat: 20, sightsee: 14, food: 10, rest: 10, work: 8, religion: 6, transport: 4 },
  monk: { religion: 50, work: 14, chat: 16, rest: 12, chores: 8 },
  taoist: { religion: 42, chat: 16, sightsee: 14, work: 10, rest: 10, chores: 8 },
  merchant: { trade: 40, chat: 20, food: 14, entertain: 8, transport: 10, rest: 4, sightsee: 4 },
  soldier: { patrol: 52, sightsee: 14, chat: 12, work: 8, rest: 8, food: 6 },
  official: { patrol: 26, chat: 22, sightsee: 18, work: 14, food: 8, rest: 6, religion: 6 },
  lady: { trade: 20, entertain: 18, chat: 16, sightsee: 14, food: 12, rest: 8, chores: 8, religion: 4, transport: 4 },
  kid: { child: 58, entertain: 18, sightsee: 10, chat: 8, food: 6 },
  beggar: { rest: 30, chat: 18, sightsee: 16, food: 14, religion: 10, work: 12 },
  gambler: { entertain: 40, chat: 18, food: 14, rest: 14, trade: 8, sightsee: 6 },
  brawler: { entertain: 24, patrol: 16, chat: 18, food: 16, rest: 14, work: 12 },
  watchman: { patrol: 62, sightsee: 14, rest: 12, chat: 12 },
  farmer: { work: 40, transport: 22, trade: 14, rest: 12, food: 6, chores: 6 },
  fisher: { work: 48, rest: 16, food: 10, chores: 12, sightsee: 8, chat: 6 },
  drinker: { food: 34, entertain: 22, chat: 22, rest: 12, sightsee: 6, trade: 4 },
  storyteller: { entertain: 70, chat: 20, sightsee: 10 },
  musician: { entertain: 78, chat: 12, rest: 10 },
  acrobat: { entertain: 62, work: 12, rest: 10, chat: 10, sightsee: 6 },
  sailor: { work: 44, transport: 26, rest: 14, trade: 8, food: 8 },
  camelDriver: { transport: 46, trade: 18, work: 18, rest: 12, food: 6 },
  sitter: { entertain: 60, chat: 20, rest: 20 },
};

// ---- 每角色行为状态（不改 types.ts：状态挂在 WeakMap 上）----
interface BehState {
  kind: BehaviorKind | null;
  kindT: number;      // 当前类已持续
  kindDur: number;    // 下一次换类的间隔（30–180s）
  step: BehStep | null;
  stepT: number;
  stepDur: number;
  pendingDur: number;
  origin: THREE.Vector3;
  // ---- 自由行走（R26）----
  lane: number;         // 个人横向车道偏移（米，-3.2…3.2）：同向的人不再共用一条脚印线
  speedMul: number;     // 个人步速系数（0.72–1.32）
  avoidX: number;       // 邻居排斥向量（世界 x/z）
  avoidZ: number;
  avoidT: number;       // 上次刷新排斥向量的仿真时刻
}
const STATE = new WeakMap<Actor, BehState>();

function stateOf(a: Actor): BehState {
  let st = STATE.get(a);
  if (!st) {
    // 初相位随机：否则 4000 人会同一秒集体换行为
    st = {
      kind: null, kindT: 0, kindDur: 30, step: null, stepT: 0, stepDur: 0, pendingDur: 8, origin: a.pos.clone(),
      lane: (Math.random() * 2 - 1) * 3.2,
      speedMul: 0.72 + Math.random() * 0.6,
      avoidX: 0, avoidZ: 0, avoidT: -1,
    };
    st.kindDur = 30 + Math.random() * 150;
    st.kindT = Math.random() * 30;
    STATE.set(a, st);
  }
  return st;
}

/** 该角色当前所处的行为类（供 __crowd.actions 统计） */
export function actionKindOf(a: Actor): BehaviorKind | null { return STATE.get(a)?.kind ?? null; }

// ---- 驻场岗位（R12-C/D）：角色钉在某处场所半径内活动，不接城市路网 ----
// 用途：里坊院内、寺院、宫城、瓦舍、天宫/地府各殿。避免「场所里的人跑到街上去」，
// 也避免与街道人群互相重复计数——驻场者只在场子半径内取点，街道人群不进场子。
export interface Post { x: number; y: number; z: number; r: number; kinds: BehaviorKind[]; venue: string }
const POST = new WeakMap<Actor, Post>();
export function setPost(a: Actor, p: Post): void { POST.set(a, p); }
export function postOf(a: Actor): Post | undefined { return POST.get(a); }

// ---- 行为类变化日志：证明「不是一直走」----
// 时间基准是仿真时间（ctx.t），不是墙钟：engine.step() 推进 60s 也算一个 60s 窗口，
// 否则无头探针只跑 2s 就会读到 0（换类最短 30s，本来就没到第一次换类）。
const CHANGE_LOG: { t: number; kind: BehaviorKind }[] = [];
const CHANGE_WINDOW = 60;
const wallSec = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
let simClock = 0;
function logKindChange(kind: BehaviorKind, t: number): void {
  CHANGE_LOG.push({ t, kind });
  if (CHANGE_LOG.length > 40000) CHANGE_LOG.splice(0, 20000);
}
export function behaviorChangeStats(now?: number): { changes60s: number; kinds60s: number } {
  const cut = (now ?? (simClock || wallSec())) - CHANGE_WINDOW;
  let i = 0;
  while (i < CHANGE_LOG.length && CHANGE_LOG[i].t < cut) i++;
  if (i > 0) CHANGE_LOG.splice(0, i);
  const kinds = new Set<BehaviorKind>();
  for (const e of CHANGE_LOG) kinds.add(e.kind);
  return { changes60s: CHANGE_LOG.length, kinds60s: kinds.size };
}

// ---- 横向穿行（15%）：由 crowd 在出生时标记，行为层负责真的横穿街道 ----
const CROSSING = new WeakSet<Actor>();
export const CROSS_SHARE = 0.15;
export function markCrossing(a: Actor): void { CROSSING.add(a); }
export function isCrossing(a: Actor): boolean { return CROSSING.has(a); }

export function setPathTo(a: Actor, nav: NavGraph, target: THREE.Vector3): void {
  const from = nav.nearest(a.pos, 40);
  const to = nav.nearest(target, 40);
  a.path = nav.path(from, to);
  if (a.path.length > 0) {
    a.path[a.path.length - 1].copy(target);
    a.pathI = a.path.length > 1 ? 1 : 0;
  } else {
    a.path = [target.clone()];
    a.pathI = 0;
  }
}

/** 短距离直线行走：外城坊民不接路网，必须能自己走，否则远城全是钉在原地的木桩 */
function straightWalk(a: Actor, st: BehState, dist: number): boolean {
  st.origin.y = a.pos.y;
  const away = a.pos.distanceTo(st.origin);
  const baseX = Math.sin(a.yaw), baseZ = Math.cos(a.yaw);
  for (let i = 0; i < 6; i++) {
    let dirX = baseX, dirZ = baseZ;
    if (away > 260) { // 走远了就往出生地回，避免长跑后漂出城
      dirX = st.origin.x - a.pos.x; dirZ = st.origin.z - a.pos.z;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l; dirZ /= l;
    }
    // 每次试走随机偏转 ±40°：外城没有路网，也不能沿一条直线排成队
    const ang = (Math.random() - 0.5) * 1.4;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const dx = dirX * cs - dirZ * sn, dz = dirX * sn + dirZ * cs;
    const tx = a.pos.x + dx * dist, tz = a.pos.z + dz * dist;
    if (!dryPoint(tx, tz) || !drySegment(a.pos.x, a.pos.z, tx, tz)) continue;
    a.path = [new THREE.Vector3(tx, a.pos.y, tz)];
    a.pathI = 0;
    return true;
  }
  return false;
}

/** 路网外框（缓存）：街尾折返与出生权重都要用 */
const NAV_BOUNDS = new WeakMap<NavGraph, { minX: number; maxX: number; minZ: number; maxZ: number }>();
export function navBounds(nav: NavGraph): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let b = NAV_BOUNDS.get(nav);
  if (b) return b;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const n of nav.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.z < minZ) minZ = n.z;
    if (n.z > maxZ) maxZ = n.z;
  }
  b = { minX, maxX, minZ, maxZ };
  NAV_BOUNDS.set(nav, b);
  return b;
}

/** 街面走廊：目标点允许落在「街宽/2 + 3.2m」内，既铺得开又不穿进沿街建筑体 */
function onStreetCorridor(x: number, z: number): boolean {
  if (onBridgeSpan(x, z)) return true;
  for (const s of H_STREETS) {
    if (x >= s.x0 - 8 && x <= s.x1 + 8 && Math.abs(z - s.z) <= s.w / 2 + 3.2) return true;
  }
  for (const s of V_STREETS) {
    if (z >= s.z0 - 8 && z <= s.z1 + 8 && Math.abs(x - s.x) <= s.w / 2 + 3.2) return true;
  }
  return false;
}

/** 直线段是否全程在街面走廊内（斜穿/过街可以直接走，不会切进建筑体） */
function streetSegment(x0: number, z0: number, x1: number, z1: number): boolean {
  const span = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(span / 4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!onStreetCorridor(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

/**
 * 独立游荡目标：在街面走廊内随机取点，而不是「路网节点」。
 * 旧实现的目标点只有 26m 间距的节点，全城同一条街的人共享同一串终点，
 * 于是所有人先汇到街心、再沿同一条折线走——实测采样离街心中位数 0.14m、65% 的人挤在 0.9m 内。
 * 现在 45% 沿当前朝向取 12–44m、35% 垂直过街取 3–11m、20% 全向取 8–32m：
 * 转向时刻、方向、步速都按人独立，才有「自由乱走」而不是一条队列。
 */
function pickFreeTarget(a: Actor, ctx: BehCtx): THREE.Vector3 | null {
  const nb = navBounds(ctx.nav);
  // 三档取点：45% 沿当前朝向、35% 斜穿/横过街、20% 全向回头。
  // 只取「前半球」会让 30s 朝向直方图始终只有沿街两个峰；斜穿档专门制造第三、四个峰。
  const roll = Math.random();
  const mode = roll < 0.45 ? 0 : roll < 0.8 ? 1 : 2;
  // 桥上的人：目标只能落在桥面净宽内，或越过桥两端走下去；不能横着跨过栏杆（桥面净宽 W=10.4）
  const onBridgeNow = !a.sky && a.pos.y > 0.5 && Math.abs(a.pos.x) <= 9 && Math.abs(a.pos.z) <= BRIDGE_HALF;
  for (let i = 0; i < 8; i++) {
    const ang = mode === 0 ? a.yaw + (Math.random() - 0.5) * 2.2
      : mode === 1 ? a.yaw + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 0.5
        : Math.random() * Math.PI * 2;
    const d = mode === 0 ? 12 + Math.random() * 32
      : mode === 1 ? 3 + Math.random() * 8
        : 8 + Math.random() * 24;
    const x = a.pos.x + Math.sin(ang) * d;
    const z = a.pos.z + Math.cos(ang) * d;
    if (x < nb.minX - 24 || x > nb.maxX + 24 || z < nb.minZ - 24 || z > nb.maxZ + 24) continue;
    if (!a.sky && !onStreetCorridor(x, z)) continue;
    if (onBridgeNow) {
      const deckTarget = Math.abs(x) <= 4.6 && Math.abs(z) <= BRIDGE_HALF;
      const offEnd = Math.abs(z) > BRIDGE_HALF + 1 && Math.abs(x) <= 9;
      if (!deckTarget && !offEnd) continue;
    }
    if (!a.sky && (!dryPoint(x, z) || !drySegment(a.pos.x, a.pos.z, x, z))) continue;
    const y = a.sky ? a.pos.y : (onBridgeSpan(x, z) ? bridgeDeckY(z) : 0);
    return new THREE.Vector3(x, y, z);
  }
  return null;
}

function randomRoam(a: Actor, nav: NavGraph, st: BehState): boolean {
  const from = nav.nearest(a.pos, 40);
  if (from < 0) return false;
  const lo = a.sky ? 0 : 150;
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const away = a.pos.distanceTo(st.origin);
  // 回程模式：走远了就往出生地回，避免长跑后全挤到地图边缘
  const back = away > 300;
  // 街尾折返：靠近路网外框时只往前城中心的方向走。
  // 不这么做，持续单向会把人流推到街尾，那一格就只剩一个朝向（实测最差格就是街尾）。
  const nb = navBounds(nav);
  const cx = (nb.minX + nb.maxX) / 2, cz = (nb.minZ + nb.maxZ) / 2;
  const dCenter = Math.hypot(a.pos.x - cx, a.pos.z - cz);
  const atEdge = a.pos.x < nb.minX + 24 || a.pos.x > nb.maxX - 24 || a.pos.z < nb.minZ + 24 || a.pos.z > nb.maxZ - 24;
  // 55% 走前半球（双向流留得住），45% 允许掉头/斜穿：旧值 70% 太强，人流会一路单向推下去。
  const forward = !back && !atEdge && Math.random() < 0.55;
  const cands: number[] = [];
  const backCands: number[] = [];
  for (let i = 0; i < nav.nodes.length; i++) {
    if (a.sky !== (nav.nodes[i].y > 100)) continue;
    const d = nav.nodes[i].distanceToSquared(a.pos);
    if (d <= 1 || d >= lo * lo) continue;
    const node = nav.nodes[i];
    if (back) {
      if (node.distanceToSquared(st.origin) < away * away) backCands.push(i);
      continue;
    }
    if (atEdge) {
      if (Math.hypot(node.x - cx, node.z - cz) < dCenter) cands.push(i);
      continue;
    }
    if (!forward) { cands.push(i); continue; }
    const dx = node.x - a.pos.x, dz = node.z - a.pos.z;
    if (dx * fx + dz * fz > 0) cands.push(i);
  }
  let pool = back ? backCands : cands;
  if (pool.length === 0) {
    // 前半球没有可选点时放宽到全域（不牺牲可走性）
    for (let i = 0; i < nav.nodes.length; i++) {
      if (a.sky !== (nav.nodes[i].y > 100)) continue;
      const d = nav.nodes[i].distanceToSquared(a.pos);
      if (d > 1 && d < lo * lo) pool.push(i);
    }
  }
  if (pool.length === 0) return false;
  const to = pool[Math.floor(Math.random() * pool.length)];
  a.path = nav.path(from, to);
  if (a.path.length === 0) return false;
  // 终点从街心偏到个人车道：同一条街的两个方向各留一侧，再加 ±0.6m 抖动。
  const last = a.path[a.path.length - 1];
  if (!a.sky) {
    const node = nav.nodes[to];
    const dx = node.x - a.pos.x, dz = node.z - a.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const off = st.lane + (Math.random() - 0.5) * 1.2;
    let tx = node.x + (-dz / l) * off;
    let tz = node.z + (dx / l) * off;
    // 桥面净宽半宽 5.2m：个人车道不能把终点推到栏杆外
    if (onBridgeSpan(node.x, node.z) && Math.abs(tz) <= BRIDGE_HALF) tx = THREE.MathUtils.clamp(tx, -4.4, 4.4);
    if (dryPoint(tx, tz) && drySegment(a.pos.x, a.pos.z, tx, tz)) last.set(tx, last.y, tz);
  }
  a.pathI = Math.min(1, a.path.length - 1);
  return true;
}

/** 横穿：取最近路网节点的走向，转 90° 走出去 6–14m（真的过街，不是原地转圈） */
function crossStreet(a: Actor, nav: NavGraph): boolean {
  const i = nav.nearest(a.pos, 40);
  if (i < 0) return false;
  const p = nav.nodes[i];
  let best = -1, bd = 31 * 31;
  for (const j of nav.adj[i]) {
    const d = nav.nodes[j].distanceToSquared(p);
    if (d > 4 && d < bd) { bd = d; best = j; }
  }
  if (best < 0) return false;
  const q = nav.nodes[best];
  let sx = q.x - p.x, sz = q.z - p.z;
  const l = Math.hypot(sx, sz) || 1;
  sx /= l; sz /= l;
  // 垂直方向二选一，取与当前朝向夹角更小的那侧（人不会原地掉头过街）
  const c1x = sz, c1z = -sx, c2x = -sz, c2z = sx;
  const f1 = Math.sin(a.yaw) * c1x + Math.cos(a.yaw) * c1z;
  const f2 = Math.sin(a.yaw) * c2x + Math.cos(a.yaw) * c2z;
  const dx = f1 >= f2 ? c1x : c2x, dz = f1 >= f2 ? c1z : c2z;
  for (let t = 0; t < 5; t++) {
    const d = 6 + Math.random() * 8;
    const tx = a.pos.x + dx * d, tz = a.pos.z + dz * d;
    // 过街也不能穿河：靠河一侧的横穿若直插水面，就换一次落点
    if (!dryPoint(tx, tz) || !drySegment(a.pos.x, a.pos.z, tx, tz)) continue;
    a.path = [new THREE.Vector3(tx, a.pos.y, tz)];
    a.pathI = 0;
    return true;
  }
  return false;
}

function wander(a: Actor, ctx: BehCtx, st: BehState): boolean {
  // 驻场者：只在岗位半径内取点，不碰城市路网（场所人群与街道人群互不串场）
  const post = POST.get(a);
  if (post) {
    // 圆内取点必须落在干地：里坊矩形横跨汴河，旧版会把坊民送到水面上（用户：「为什么还有人在水面上走」）
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * post.r;
      const x = post.x + Math.cos(ang) * rr;
      const z = post.z + Math.sin(ang) * rr;
      if (!a.sky && (!dryPoint(x, z) || !drySegment(a.pos.x, a.pos.z, x, z))) continue;
      a.path = [new THREE.Vector3(x, a.pos.y, z)];
      a.pathI = 0;
      return true;
    }
    return false;
  }
  if (isCrossing(a) && Math.random() < 0.55) { if (crossStreet(a, ctx.nav)) return true; }
  // 先取独立自由点，再退回路网节点：目标点不再全是同一串节点
  const free = pickFreeTarget(a, ctx);
  if (free) {
    // 同一街面走廊内的目标直接走直线：过街/斜穿不再先被 setPathTo 拉回路网中线，
    // 否则斜穿只发生在最后一小段，30s 朝向直方图仍只剩沿街两个峰。
    if (!a.sky && streetSegment(a.pos.x, a.pos.z, free.x, free.z)) {
      a.path = [free.clone()];
      a.pathI = 0;
    } else {
      setPathTo(a, ctx.nav, free);
    }
    return true;
  }
  if (randomRoam(a, ctx.nav, st)) return true;
  // 路网还在附近（随机游走失败多半是 40m 内没点）→ 先走回最近的路上，
  // 否则离网角色会沿着当前朝向一路直线飘出城，最后在街尾堆成同向的一串（实测低 yaw 方差格）。
  const near = ctx.nav.nearest(a.pos, 90);
  if (near >= 0) {
    const n = ctx.nav.nodes[near];
    const dx = n.x - a.pos.x, dz = n.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 10) {
      const tx = n.x + (Math.random() - 0.5) * 3;
      const tz = n.z + (Math.random() - 0.5) * 3;
      if (dryPoint(tx, tz) && drySegment(a.pos.x, a.pos.z, tx, tz)) {
        a.path = [new THREE.Vector3(tx, a.pos.y, tz)];
        a.pathI = 0;
        return true;
      }
    }
  }
  return straightWalk(a, st, 14 + Math.random() * 26);
}

// ---- 行为类选择 ----
const KIND_TMP: BehaviorKind[] = [];
function baseWeights(occ: string): KindWeights {
  const w: KindWeights = { ...DEFAULT_W };
  const base = OCC_KIND_W[occ];
  if (base) for (const k in base) w[k as BehaviorKind] = base[k as BehaviorKind]!;
  return w;
}
function weightedKind(w: KindWeights): BehaviorKind {
  KIND_TMP.length = 0;
  let total = 0;
  for (const k of ACTION_KINDS) { const v = w[k] ?? 0; if (v > 0) { KIND_TMP.push(k); total += v; } }
  let r = Math.random() * total;
  for (const k of KIND_TMP) { r -= w[k] ?? 0; if (r <= 0) return k; }
  return KIND_TMP[KIND_TMP.length - 1];
}
/** 街面性格偏好池：seed → 一个长期偏好类（只作用于街面人群，场所驻场者走岗位 kinds） */
const DAILY_PREF: BehaviorKind[] = ['rest', 'chat', 'sightsee', 'entertain', 'food', 'chores', 'work'];
function prefOf(a: Actor): BehaviorKind {
  const h = Math.abs(Math.sin(a.seed * 12.9898) * 43758.5453) % 1;
  return DAILY_PREF[Math.floor(h * DAILY_PREF.length) % DAILY_PREF.length];
}
/** 出生即给一个行为类：让 __crowd.actions 从第一帧起就是完整分布（不必等到第一次换类）。
 *  给了 kinds 就覆盖（场所驻场者要在 spawnActor 的默认初始化之后再改成岗位专属类）。 */
export function initBehavior(a: Actor, kinds?: BehaviorKind[]): BehaviorKind {
  const st = stateOf(a);
  if (st.kind && !kinds) return st.kind;
  let kind: BehaviorKind;
  if (kinds && kinds.length) kind = kinds[Math.floor(Math.random() * kinds.length)];
  else {
    const w = baseWeights(a.occ);
    w[prefOf(a)] *= 2.4;
    kind = weightedKind(w);
  }
  st.kind = kind;
  st.kindDur = 30 + Math.random() * 150;
  st.kindT = Math.random() * 30;
  return kind;
}
function pickKind(a: Actor, ctx: BehCtx, st: BehState, job: { nightOnly?: boolean } | undefined): BehaviorKind {
  // 驻场者：78% 概率继续做本场所该做的事（寺院礼佛 / 宫城执役 / 瓦舍看戏 / 天宫巡天…）
  const post = POST.get(a);
  if (post && post.kinds.length && Math.random() < 0.78) {
    return post.kinds[Math.floor(Math.random() * post.kinds.length)];
  }
  const w = baseWeights(a.occ);
  // 位置在说话：站在庙口就烧香，站在瓦子就听书，站在码头就扛包
  const shrine = ctx.spots.nearest(a.pos, 'shrine', 46);
  if (shrine) { w.religion *= 3; w.rest *= 1.4; }
  const stage = ctx.spots.nearest(a.pos, 'stage', 46);
  if (stage) { w.entertain *= 2.6; w.sightsee *= 1.5; }
  const story = ctx.spots.nearest(a.pos, 'story', 46);
  if (story) { w.entertain *= 2; w.chat *= 1.2; }
  const dock = ctx.spots.nearest(a.pos, 'dock', 46);
  if (dock) { w.work *= 2.2; w.transport *= 1.5; }
  const wine = ctx.spots.nearest(a.pos, 'wine', 46);
  if (wine) { w.food *= 1.9; w.chat *= 1.3; }
  const dice = ctx.spots.nearest(a.pos, 'dice', 46);
  if (dice) { w.entertain *= 2.2; }
  // 性格偏好（由 seed 决定，与职业/位置无关）：同一条街的十来人会自然分成
  // 闲坐的、聊天的、看热闹的、吃东西的……否则小格子里的行为种类会塌成 2 类。
  w[prefOf(a)] *= 2.4;
  // 昼夜：夜里收摊、回家、巡夜
  if (ctx.isNight) { w.rest *= 2.2; w.patrol *= 2.4; w.trade *= 0.25; w.work *= 0.45; w.chat *= 0.8; }
  if (job?.nightOnly && ctx.isNight) { w.patrol *= 3; }
  return weightedKind(w);
}

function chooseKind(a: Actor, st: BehState, ctx: BehCtx, job: { nightOnly?: boolean } | undefined): void {
  const kind = pickKind(a, ctx, st, job);
  if (kind !== st.kind) logKindChange(kind, ctx.t ?? wallSec());
  st.kind = kind;
  st.kindT = 0;
  st.kindDur = 30 + Math.random() * 150;
  st.step = null;
  st.stepT = 0;
  st.stepDur = 0;
  a.timer = 0;
}

function pickStep(def: BehKindDef, st: BehState): BehStep {
  const steps = def.steps;
  if (steps.length === 1) return steps[0];
  for (let i = 0; i < 6; i++) {
    const s = steps[Math.floor(Math.random() * steps.length)];
    if (s !== st.step) return s;
  }
  return steps[Math.floor(Math.random() * steps.length)];
}

const _v = new THREE.Vector3();

export function tickActor(a: Actor, dt: number, ctx: BehCtx): void {
  a.actT += dt;
  if (a.freeze || a.attach) return;
  const job = JOB_MAP.get(a.occ);
  if (!job) return;
  if (ctx.t !== undefined) simClock = ctx.t;

  // 远处角色降频思考：节流期间累积 dt，放行帧按累积值积分（避免原地滑步）。
  // 节流用仿真时钟（ctx.t），不是墙钟：否则暂停 / 快进 / 时间缩放下远距角色会停止思考，
  // 无头快进 70s 时整城只有相机附近的人在换行为（实测只记到 102 次，量级差十倍）。
  const far = a.pos.distanceToSquared(ctx.camPos) > 200 * 200;
  const now = ctx.t !== undefined ? ctx.t * 1000 : performance.now();
  if (far) {
    a.acc += dt;
    if (now - a.lastTick < 250) return;
    a.lastTick = now;
    const caught = a.acc;
    a.acc = 0;
    tickInner(a, caught, ctx, job);
    return;
  }
  a.acc = 0;
  a.lastTick = now;
  tickInner(a, dt, ctx, job);
}

function tickInner(a: Actor, dt: number, ctx: BehCtx, job: NonNullable<ReturnType<typeof JOB_MAP.get>>): void {
  const st = stateOf(a);

  // ---- 行为类节拍（30–180s）：必须在移动分支之前累计。
  // 旧顺序把类计时放在「走到目的地之后」，一条长路径能走 100s 以上，类计时永远不动 ——
  // 实测 60s 窗口只换 104 次（应为千级），等于「一路走到底、从不换事」。
  st.kindT += dt;
  if (!st.kind || st.kindT >= st.kindDur) chooseKind(a, st, ctx, job);

  // ---- 移动中 ----
  if (a.path.length > 0) {
    // 受击动作（趔趄/击倒/击飞）结束后恢复正常行走
    if (a.action === 'knockedDown' || a.action === 'launched' || a.action === 'staggerHit') a.action = 'walk';
    const tgt = a.path[a.pathI];
    _v.subVectors(tgt, a.pos);
    _v.y = 0;
    const dist = _v.length();
    if (dist < 0.5) {
      a.pathI++;
      if (a.pathI >= a.path.length) {
        a.path = [];
        if (a.pendingSpot) {
          a.action = a.pendingAct;
          a.timer = st.pendingDur;
          a.pendingSpot = false;
          st.stepT = 0;
          // 到站的人不会挤成同一朝向：站位上各自朝不同方向（问价、张望、看货）
          a.yaw += (Math.random() - 0.5) * 4.4;
          return;
        }
        // 到站后按个人节奏停一下（30%）：市井里本来就有人走两步就站住看摊
        if (Math.random() < 0.3) {
          a.action = 'stand';
          a.doing = '驻足';
          a.curDoing = a.doing;
          st.stepT = 0;
          st.stepDur = 1.4 + Math.random() * 3.2;
          a.timer = st.stepDur;
          return;
        }
        a.timer = 0;
      }
    } else {
      // 局部避让：每 0.15s 刷新一次邻居排斥向量（4m 网格，只统计相机 150m 内的人）
      const nowT = ctx.t ?? 0;
      if (nowT - st.avoidT > 0.15 && a.pos.distanceToSquared(ctx.camPos) < 150 * 150) {
        let ax = 0, az = 0;
        const ix = Math.floor(a.pos.x / AVOID_CELL), iz = Math.floor(a.pos.z / AVOID_CELL);
        for (let gx = -1; gx <= 1; gx++) {
          for (let gz = -1; gz <= 1; gz++) {
            const arr = AVOID.get(cellKey(ix + gx, iz + gz));
            if (!arr) continue;
            for (const b of arr) {
              if (b === a || b.hidden) continue;
              const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
              const d2 = dx * dx + dz * dz;
              if (d2 < 1e-4 || d2 > AVOID_LOOK * AVOID_LOOK) continue;
              const d = Math.sqrt(d2);
              const w = (AVOID_LOOK - d) / AVOID_LOOK;   // 1.6m → 0，0m → 1
              ax += (dx / d) * w;
              az += (dz / d) * w;
            }
          }
        }
        st.avoidX = ax;
        st.avoidZ = az;
        st.avoidT = nowT;
      }
      // 个人步速：职业速度 × 个人系数 × 缓慢步态起伏（同一条街不会齐步走）
      const sp = a.speed * st.speedMul * (0.9 + 0.1 * Math.sin((ctx.t ?? 0) * 0.9 + a.seed));
      _v.normalize();
      // 个人横向车道：沿行进方向的右/左侧偏 lane 米；接近终点时收回，保证真的到站
      const laneW = Math.min(1, dist / 7);
      let mx = _v.x + _v.z * st.lane * laneW;
      let mz = _v.z - _v.x * st.lane * laneW;
      // 邻居排斥：向空侧让开 0.6–1.2m（只在相机附近计算）
      mx += st.avoidX * 0.55;
      mz += st.avoidZ * 0.55;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      a.pos.x += mx * sp * dt;
      a.pos.z += mz * sp * dt;
      const targetYaw = Math.atan2(mx, mz);
      let dy = targetYaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * Math.min(1, dt * 4.6);
      return;
    }
  }

  // ---- 更夫白日蛰伏（既有语义：不换类、只走）----
  if (job.nightOnly && !ctx.isNight) {
    if (st.kind !== 'patrol') { st.kind = 'patrol'; st.kindT = 0; st.kindDur = 30; st.step = null; }
    a.doing = '白日蛰伏';
    a.curDoing = a.doing;
    a.pendingSpot = false;
    if (a.timer > 0) { a.timer -= dt; return; }
    a.action = 'walk';
    if (!wander(a, ctx, st)) { a.action = 'stand'; a.timer = 2 + Math.random() * 3; }
    return;
  }

  // ---- 行为类节拍已在上方推进（勿在此重复累计，否则计数翻倍）----

  // ---- 当前具体活动的计时 ----
  a.timer -= dt;
  st.stepT += dt;
  if (a.timer > 0 && st.stepT < st.stepDur) {
    // 站着的人也会慢慢转头看街（不是钉死在原地的雕塑）
    if (a.path.length === 0 && Math.random() < dt * 0.6) a.yaw += (Math.random() - 0.5) * 0.6;
    return;
  }

  const def = BEHAVIOR_LIB[st.kind!];
  let step = pickStep(def, st);

  // 动作必须在动作库注册表里（新增行为时漏注册会在这里被挡住，不会静默走错动作）
  st.step = step;
  st.stepDur = step.dur[0] + Math.random() * (step.dur[1] - step.dur[0]);
  st.pendingDur = st.stepDur;
  st.stepT = 0;
  a.doing = step.doing;
  a.curDoing = step.doing;

  if (step.move) {
    a.action = step.act;
    a.pendingSpot = false;
    a.timer = st.stepDur;
    if (!wander(a, ctx, st)) { a.action = 'stand'; a.timer = 2 + Math.random() * 3; st.stepDur = a.timer; }
    return;
  }
  // 驻场者不追热点：热点在 46m 内也不去（否则会被街面摊子拉出场子）
  if (step.spot && !POST.has(a)) {
    const spot = ctx.spots.nearest(a.pos, step.spot, 46);
    // 热点环上的落点也要过干地关：码头/河岸热点贴着水线，旧版会让人站到水面上
    let tgt: THREE.Vector3 | null = null;
    if (spot) {
      for (let t = 0; t < 5; t++) {
        const ring = 0.9 + Math.random() * 1.8;
        const ang = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(spot.pos.x + Math.cos(ang) * ring, spot.pos.y, spot.pos.z + Math.sin(ang) * ring);
        if (a.sky || (dryPoint(p.x, p.z) && drySegment(a.pos.x, a.pos.z, p.x, p.z))) { tgt = p; break; }
      }
    }
    if (tgt) {
      setPathTo(a, ctx.nav, tgt);
      a.pendingAct = step.act;
      a.pendingSpot = true;
      a.action = 'walk';
      return;
    }
    // 附近没有对应热点（或落点在水里）→ 退化成「在这一带走动」，不硬塞一个不存在的摊子
    step = { ...step, spot: undefined, move: true };
    st.step = step;
    st.stepDur = step.dur[0] + Math.random() * (step.dur[1] - step.dur[0]);
    st.pendingDur = st.stepDur;
    a.action = 'walk';
    a.pendingSpot = false;
    a.timer = st.stepDur;
    if (!wander(a, ctx, st)) { a.action = 'stand'; a.timer = 2 + Math.random() * 3; st.stepDur = a.timer; }
    return;
  }
  a.action = step.act;
  a.pendingSpot = false;
  a.timer = st.stepDur;
  a.yaw += (Math.random() - 0.5) * 4.4;
}
