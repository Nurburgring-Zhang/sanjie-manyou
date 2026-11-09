// ============================================================================
// R27 全城静态实体碰撞台账 · src/rt/solids.ts
//
// 根因（team-lead R27 调查结论，本文件直接使用，不再重新调查）：
//   · behaviors.ts 的 walkSurfaceY / ensureWalkSurface 只把 3 类街屋烘成 4m 哈希，
//     全城 90% 建筑（宫城墙 / 午门 / 衙门 / 寺观 / 天宫殿阁 / 城墙 / 室内隔断）
//     从未登记 → 没有墙带，NPC 直接穿墙进入室内；也没有顶面高度 → 角色陷进台基/石板。
//   · rt/collider.ts、rt/ground.ts、rt/runtimeAssets.ts 三套正式基础设施全工程零实例化，
//     不能指望它们。本文件另起一套「零 THREE 依赖、构建期登记、运行期 O(1) 查询」的台账。
//
// 数据流：Baker.push() / Baker.boxFast() 是全部静态构件的两个统一入口，二者在「越界守卫
//   之后」把世界坐标 AABB 交给 registerSolid()；本文件按 BGroup + 尺寸做纯计算分类
//   （零随机、绝不消耗共享 RNG(20260905)，任何漂移都会让既有画面全变），登记进空间哈希。
//   behaviors / crowd / player 在行走积分、出生、逐帧兜底里查询 solidBlocked / solidFloorY /
//   solidPushOut，彻底挡住穿墙与陷地。
//
// 硬性约束：本线只做数据登记，不建任何 THREE 对象 / Mesh / 材质（零新增 draw call）；
//   不改 Baker 顶点输出字节（登记逻辑只读 position）；禁止 Math.random / rng.range /
//   rng.chance；破坏抖动一律用整数坐标 hash（ihash）。
// ============================================================================

// R27 规格（覆盖最初的三界换算方案）：人间台账只收 y∈[-60,120] 的构件。天宫/地府几何在
// loadingDone 之后由 scaleHeavenGeometry 直接改顶点（×2.2 + HEAVEN_LIFT），构建期的 AABB
// 与运行时角色坐标不是同一口径，无法可靠换算；故如实跳过并在 solidsStats().skipped 计数，
// 宁可少登记，不能造一个错误碰撞体把天上的人全卡死。本文件不依赖 heavenFrame.ts（无循环依赖）。

export type SolidKind = 'wall' | 'floor' | 'roof' | 'plant' | 'decor';

export interface SolidBox {
  id: number; kind: SolidKind; group: string;
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  hp: number; maxHp: number; broken: boolean;
}

// ---- 空间哈希常量（R27 内存/性能硬预算） ----
const CELL = 8;              // wall/plant/roof 主哈希格
const BIG_CELL = 64;         // 大构件粗哈希格（跨度 >60 单独判，避免逐 8m 格插入 O(n²)）
const BIG_SPAN = 60;         // 水平跨度阈值：超过放大构件索引
const MAX_CELLS = 64;        // 单构件逐格插入上限，超过改放 bigGrid（每格插入数封顶）
const MAX_TOTAL = 399000;    // solidsStats().total 硬上限 → ≤400000（decor/三界跳过项不占）
const WALL_RESERVE = 320000; // 达此量后非 wall 让路，给构建后段真宫墙保留配额（优先保证 wall）
const STEP_UP = 0.95;        // solidFloorY 单步可抬升高度
const CAPSULE_H = 1.7;       // 角色胶囊默认身高
const FOOT_R = 0.34;         // 角色水平半径
const PUSH_EPS = 0.02;       // 推出余量：抵消浮点边界误差，保证推出后圆心严格脱离半径 r

const OFF = 1 << 15;
const keyOf = (ix: number, iz: number): number => (ix + OFF) * 65536 + (iz + OFF);
const cellOf = (v: number, cell: number): number => Math.floor(v / cell);

// ---- 台账状态（模块级单例；resetSolids 清空供单测） ----
interface FloorBox { x0: number; x1: number; y1: number; z0: number; z1: number }
let boxes: SolidBox[] = [];                 // 仅 wall/plant/roof 进碰撞+破坏索引（有 id）
let brokenWalls: SolidBox[] = [];           // R27 已打碎的 wall：破口放行用小表，数量远小于 boxes
let floorTop = new Map<number, number>();  // 8m cell → 该格最高顶面（每格只留一个值，防铺装板爆内存）
let bigFloors: FloorBox[] = [];            // 大 floor（跨度 >60）单独判顶面
let grid = new Map<number, number[]>();    // 8m cell → wall/plant/roof id
let bigGrid = new Map<number, number[]>();// 64m cell → 大构件 id
let built = false;
let buildMs = 0;
let registered = 0, wallCount = 0, floorCount = 0, plantCount = 0, roofCount = 0, brokenCount = 0, skippedCount = 0;
let nextId = 1;

/** 查询候选去重集（模块级复用，避免每帧几十万次 new Set；本文件所有查询均不嵌套调用） */
const Q_SEEN = new Set<number>();

/** 纯整数坐标 hash：破坏抖动 / hp 初值的唯一确定性来源（禁止 Math.random / rng.*）。 */
function ihash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// 三界构件在 registerSolid 里如实跳过并计入 skipped，不做 heavenPoint 换算
// （构建期 AABB 与 scaleHeavenGeometry 之后的运行时角色坐标不同口径）。

/**
 * 分类启发式（R27 修正版）：按 BGroup 字符串 + 尺寸纯计算。decor = 无碰撞语义，丢弃不登记。
 *
 * 关键实测（src/city/imperial.ts）：用户截图里士兵半嵌进去的是宫城南墙
 *   `buildPalaceWalls()` L948 `W(L, 4.4, 3.0, ...)`，L≈982m、厚 3.0m、高 4.4m——
 *   「又长又薄」的真墙。旧版 `span > 600 → decor` 会把整堵墙漏掉，必须删掉 span 守卫。
 *   反过来 1142 行 `b.box('wall', mainW, 7.2, mainD, ...)` 是殿宇实心主体（thin≥14），
 *   1224 行午门门墩 `b.box('earth', w, 11.2, 36, ...)`（thin=36）是厚城台，
 *   这些若判成 wall 会把殿内人群全部推出、画面直接毁掉。
 * 故只按「薄 + 够高」判墙，长宽不限；水平铺面再额外要求形状接近矩形，
 * 避免 `W(L+1.2, 0.62, 3.1, ...)` 这种长条墙顶压顶被当 floor 把 NPC 抬到 9.6m 墙顶。
 */
function classify(group: string, w: number, h: number, d: number): SolidKind {
  const thin = Math.min(w, d);
  const wide = Math.max(w, d);
  if (h > 200 || !Number.isFinite(thin) || !Number.isFinite(wide)) return 'decor';
  switch (group) {
    case 'trunk':
      // 直径 > 0.8 的粗树干当墙阻挡；细树干/枝条当 plant（不阻挡、可破坏）。
      return thin > 0.8 && h >= 1.0 ? 'wall' : 'plant';
    case 'leaf': return 'plant';                       // 叶团不阻挡、可破坏
    case 'roof': return 'roof';                        // 屋顶不阻挡地面行走、可破坏
    case 'ground': case 'water': return 'floor';       // 地坪/水面 → 顶面
    case 'glow': case 'fabric': return 'decor';        // 灯/幡不阻挡、数量大，丢弃
    default:
      // 竖直薄墙：长宽不限，982m 宫墙必须保留；thin≤3.6 排除殿宇主体/门墩/大台基
      if (h >= 1 && h <= 24 && thin >= 0.18 && thin <= 3.6) return 'wall';
      // 水平铺面：矮 + 形状接近铺面（wide ≤ thin*8 排除长条压顶）
      if (h < 0.7 && thin >= 0.5 && wide <= thin * 8) return 'floor';
      return 'decor';
  }
}

/** 每 cell 只保留最高顶面：紧凑 Map<number,number>，绝不存全部 floor AABB。 */
function putFloor(x0: number, x1: number, y1: number, z0: number, z1: number): void {
  const i0 = cellOf(x0, CELL), i1 = cellOf(x1, CELL);
  const j0 = cellOf(z0, CELL), j1 = cellOf(z1, CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = keyOf(i, j);
    const cur = floorTop.get(k);
    if (cur === undefined || y1 > cur) floorTop.set(k, y1);
  }
}

/** 构建期登记：世界坐标 AABB（已含 yawPivot/旋转/缩放后的最终值）。
 *  R27 规格：只收人间 y∈[-60,120]；天宫/地府构件如实跳过（skipped++），不造错误碰撞体。 */
export function registerSolid(
  group: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): void {
  // 三界跳过：天宫(y>120)/地府(y<-60)几何在 loadingDone 后会被 scaleHeavenGeometry
  // 整体缩放+抬升，构建期 AABB 与运行时角色坐标不同口径，强行登记会把异界的人卡死。
  // 宁可少登记，不能错登记。
  if (y0 < -60 || y1 > 120) { skippedCount++; return; }
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(d)) { skippedCount++; return; }
  const kind = classify(group, w, h, d);
  if (kind === 'decor') return;                      // 无碰撞语义且数量巨大：不登记（控制内存）
  // 硬预算 total ≤ 400000：decor/三界跳过项不占；达上限后一律停登记。
  // 优先保证 wall：接近上限时非 wall（floor/plant/roof）先让路，给构建后段真宫墙留配额。
  if (registered >= MAX_TOTAL) return;
  if (kind !== 'wall' && registered >= WALL_RESERVE) return;
  registered++;
  if (kind === 'floor') {
    // floor 走 putFloor/bigFloors 紧凑结构，不进 boxes（不占 SolidBox 对象内存）。
    floorCount++;
    if (w > BIG_SPAN || d > BIG_SPAN) bigFloors.push({ x0, x1, y1, z0, z1 });
    else putFloor(x0, x1, y1, z0, z1);
    return;
  }
  // wall / plant / roof：进 boxes + 破坏索引（hp 初值用整数坐标 hash，完全确定）
  const hp = 30 + (ihash(Math.round(x0), Math.round(y0), Math.round(z0)) % 70);
  const box: SolidBox = { id: nextId++, kind, group, x0, x1, y0, y1, z0, z1, hp, maxHp: hp, broken: false };
  boxes.push(box);
  if (kind === 'wall') wallCount++;
  else if (kind === 'plant') plantCount++;
  else roofCount++;
}

/** 幂等构建空间哈希；首次查询自动调用。floorTop 在 registerSolid 时已增量就绪。 */
export function buildSolidIndex(): void {
  if (built) return;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  grid = new Map(); bigGrid = new Map();
  for (const b of boxes) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const big = w > BIG_SPAN || d > BIG_SPAN;
    const n8 = (cellOf(b.x1, CELL) - cellOf(b.x0, CELL) + 1) * (cellOf(b.z1, CELL) - cellOf(b.z0, CELL) + 1);
    const useBig = big || n8 > MAX_CELLS;            // 大构件/跨格过多 → 64m 粗哈希单独判
    const c = useBig ? BIG_CELL : CELL;
    const map = useBig ? bigGrid : grid;
    const i0 = cellOf(b.x0, c), i1 = cellOf(b.x1, c);
    const j0 = cellOf(b.z0, c), j1 = cellOf(b.z1, c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = keyOf(i, j);
      const arr = map.get(k);
      if (arr) arr.push(b.id); else map.set(k, [b.id]);
    }
  }
  built = true;
  buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
}

/** 遍历 (x,z) 半径 r 覆盖的候选实体（grid 8m + bigGrid 64m），跳过 broken = 已从碰撞索引摘除。 */
function forEachCandidate(x: number, z: number, r: number, fn: (b: SolidBox) => void): void {
  Q_SEEN.clear();
  let i0 = cellOf(x - r, CELL), i1 = cellOf(x + r, CELL);
  let j0 = cellOf(z - r, CELL), j1 = cellOf(z + r, CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const arr = grid.get(keyOf(i, j));
    if (!arr) continue;
    for (const id of arr) {
      if (Q_SEEN.has(id)) continue; Q_SEEN.add(id);
      const b = boxes[id - 1];
      if (b && !b.broken) fn(b);
    }
  }
  i0 = cellOf(x - r, BIG_CELL); i1 = cellOf(x + r, BIG_CELL);
  j0 = cellOf(z - r, BIG_CELL); j1 = cellOf(z + r, BIG_CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const arr = bigGrid.get(keyOf(i, j));
    if (!arr) continue;
    for (const id of arr) {
      if (Q_SEEN.has(id)) continue; Q_SEEN.add(id);
      const b = boxes[id - 1];
      if (b && !b.broken) fn(b);
    }
  }
}

/** 胶囊 (x,z,r) 的 XZ 圆与 AABB 是否相交；Y 区间 [y,y+h] 是否重叠。 */
function capsuleHits(b: SolidBox, x: number, z: number, r: number, y: number, h: number): boolean {
  if (b.y1 <= y || b.y0 >= y + h) return false;
  const cx = Math.max(b.x0, Math.min(x, b.x1));
  const cz = Math.max(b.z0, Math.min(z, b.z1));
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

/** 角色胶囊（圆心 x,z 半径 r，脚 y，身高 h 默认 1.7）是否与实心阻挡相交。
 *  仅 wall（含粗 trunk）阻挡；plant/roof 不阻挡地面行走，floor 只提供顶面。 */
export function solidBlocked(x: number, z: number, r: number, y: number, h = CAPSULE_H): boolean {
  buildSolidIndex();
  let hit = false;
  forEachCandidate(x, z, r, (b) => {
    if (hit || b.kind !== 'wall') return;
    if (capsuleHits(b, x, z, r, y, h)) hit = true;
  });
  return hit;
}

/** 该点 ≤ fromY+0.95 能踩到的最高顶面；无则 null。墙带内（够不着墙顶）返回 null。 */
export function solidFloorY(x: number, z: number, fromY: number): number | null {
  buildSolidIndex();
  const cap = fromY + STEP_UP;
  let best: number | null = null;
  const top = floorTop.get(keyOf(cellOf(x, CELL), cellOf(z, CELL)));
  if (top !== undefined && top <= cap) best = top;
  for (const f of bigFloors) {
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    if (f.y1 <= cap && (best === null || f.y1 > best)) best = f.y1;
  }
  // 墙带：胶囊撞进 wall 且够不着其顶面 → 不可站（返回 null，让行走积分滑动/回退）
  let inWall = false;
  forEachCandidate(x, z, FOOT_R, (b) => {
    if (inWall || b.kind !== 'wall') return;
    if (b.y1 <= fromY || b.y0 >= fromY + CAPSULE_H) return;
    const cx = Math.max(b.x0, Math.min(x, b.x1));
    const cz = Math.max(b.z0, Math.min(z, b.z1));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < FOOT_R * FOOT_R && b.y1 > cap) inWall = true;
  });
  if (inWall) return null;
  return best;
}

/** 把 pos 推出最近的实心体，返回是否移动过；只改 pos.x/pos.z（不改 y）。
 *  多 pass 迭代解「推出一个墙又进另一个墙」的夹缝情形。 */
export function solidPushOut(pos: { x: number; y: number; z: number }, r: number, y: number): boolean {
  buildSolidIndex();
  let moved = false;
  // R27：3 pass 解不开室内隔断夹缝（实测 8 个角色每 4 帧校验仍嵌墙），放宽到 8 pass。
  for (let pass = 0; pass < 8; pass++) {
    let hit = false;
    forEachCandidate(pos.x, pos.z, r + 1.0, (b) => {
      if (b.kind !== 'wall' || b.y1 <= y || b.y0 >= y + CAPSULE_H) return;
      const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
      const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
      const dx = pos.x - cx, dz = pos.z - cz;
      if (dx * dx + dz * dz >= r * r) return;
      // 圆等效膨胀 AABB：推到最近的一条边（4 方向取最小位移）
      const dl = pos.x - (b.x0 - r), dr = (b.x1 + r) - pos.x;
      const db = pos.z - (b.z0 - r), df = (b.z1 + r) - pos.z;
      const m = Math.min(dl, dr, db, df);
      if (m === dl) pos.x = b.x0 - r - PUSH_EPS;
      else if (m === dr) pos.x = b.x1 + r + PUSH_EPS;
      else if (m === db) pos.z = b.z0 - r - PUSH_EPS;
      else pos.z = b.z1 + r + PUSH_EPS;
      hit = true;
    });
    if (!hit) return moved;
    moved = true;
  }
  // 多墙夹缝 8 pass 仍互相推回：小半径螺旋找一个真正不阻挡的落脚点。
  // 只改 x/z，不动 y；位移上限约 6*(r+0.45)≈4.7m，不会把人瞬移到街对面。
  if (solidBlocked(pos.x, pos.z, r, y, CAPSULE_H)) {
    const ox = pos.x, oz = pos.z;
    for (let ring = 1; ring <= 12; ring++) {
      const rad = ring * (r + 0.45);
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const nx = ox + Math.cos(ang) * rad, nz = oz + Math.sin(ang) * rad;
        if (!solidBlocked(nx, nz, r, y, CAPSULE_H)) {
          pos.x = nx; pos.z = nz;
          return true;
        }
      }
    }
  }
  return moved;
}

/** 半径 radius 内扣血，返回本次被打碎（broken 由 false→true）的构件；
 *  broken 后 forEachCandidate 直接跳过 → 等效「同时从碰撞索引摘除」。 */
export function solidDamage(x: number, z: number, radius: number, y: number, power: number): SolidBox[] {
  buildSolidIndex();
  const out: SolidBox[] = [];
  const r2 = radius * radius;
  forEachCandidate(x, z, radius, (b) => {
    const cx = Math.max(b.x0, Math.min(x, b.x1));
    const cy = Math.max(b.y0, Math.min(y, b.y1));
    const cz = Math.max(b.z0, Math.min(z, b.z1));
    const dx = x - cx, dy = y - cy, dz = z - cz;
    if (dx * dx + dy * dy + dz * dz > r2) return;
    b.hp -= power;
    if (b.hp <= 0 && !b.broken) {
      b.broken = true;
      brokenCount++;
      if (b.kind === 'wall') brokenWalls.push(b);   // 破口登记，供旧 WS_GRID 墙带放行
      out.push(b);
    }
  });
  return out;
}

/**
 * R27 破坏后破口放行：solids 侧 forEachCandidate 已自动跳过 broken，
 * 但 behaviors.ts 的旧 WS_GRID 墙带是独立判据，墙被打碎后仍会挡住 NPC 穿过破口。
 * 该查询只看已打碎的 wall 小表（数量远小于 boxes），线性扫足够。
 */
export function solidBreachAt(x: number, z: number, r = 1.2): boolean {
  for (let i = 0; i < brokenWalls.length; i++) {
    const b = brokenWalls[i];
    if (b.x0 - r <= x && x <= b.x1 + r && b.z0 - r <= z && z <= b.z1 + r) return true;
  }
  return false;
}

export function solidsStats(): { total: number; walls: number; floors: number; plants: number; broken: number; skipped: number; cells: number; buildMs: number } {
  return {
    total: registered, walls: wallCount, floors: floorCount, plants: plantCount,
    broken: brokenCount, skipped: skippedCount, cells: grid.size + bigGrid.size + floorTop.size, buildMs: +buildMs.toFixed(2),
  };
}

/** 单测用：清空全部状态。 */
export function resetSolids(): void {
  boxes = []; brokenWalls = []; floorTop = new Map(); bigFloors = []; grid = new Map(); bigGrid = new Map();
  built = false; buildMs = 0;
  registered = 0; wallCount = 0; floorCount = 0; plantCount = 0; roofCount = 0; brokenCount = 0;
  nextId = 1;
  Q_SEEN.clear();
}
