import * as THREE from 'three';
import type { Vfx } from '../fx/vfx';

// ============================================================================
// R27 破坏系统：建筑破洞/局部坍缩 + 植物折断倒伏 + 角色受击碎裂 + 碎块重力堆叠
//
// 根因（为什么不是「弹文字/加粒子」）：R26 及以前命中只有 vfx.burst 粒子与冲击环，
// 静态城市（14 个 city_<组> 合批 mesh）与动态生态（eco_* InstancedMesh）在战斗后
// 完全不变，用户硬需求「建筑、植物、角色要有破坏效果和破坏物理」无从落地。
//
// 设计要点（与既有架构严格对齐）：
//  1) city_* mesh 的 position 属性里就是**最终世界坐标**（Baker 合批 + mergeExact blit
//     + scaleHeavenGeometry 直接改顶点，matrix 为单位矩阵），因此按「命中点世界坐标
//     + 半径」扫描顶点是精确的，且免疫合批重排，无需维护顶点区间台账。
//  2) 连续命中不能把几何无限压扁：每个 geometry 首次改动时缓存一份原始 Float32Array
//     （WeakMap<BufferGeometry, Float32Array>），后续变形始终基于「原始副本 + 累计位移」
//     叠加，且累计位移用 MAX_DEFORM 封顶（幂等）。
//  3) 碎块走单个 InstancedMesh（容量 256），固定步 1/120 抛体积分、落地反弹一次后静止
//     堆叠、静止 6~10s 回收；空闲时强制 visible=false 且 count=0 → 常驻 0 draw call。
//  4) 确定性硬约束：全程禁止 Math.random / rng.range / rng.chance，不消耗共享
//     RNG(20260905) 序列；所有抖动一律用整数坐标 hash debrisHash(seed, i)。
// ============================================================================

export interface DestructionHit {
  point: THREE.Vector3;
  power: number;
  radius: number;
  source: 'player' | 'cannon' | 'vehicle' | 'boss' | 'test';
  kind?: 'building' | 'plant' | 'actor' | 'auto';
}

export interface DestructionReport {
  ok: boolean;
  vertsDeformed: number;
  chunks: number;
  solidsBroken: number;
  plantsFelled: number;
  actorsHit: number;
  meshesTouched: number;
  note: string;
}

/** 累计计数（stats() 中除 aliveChunks / drawCallsWhenIdle / lastReport 外的部分） */
export interface DestructionTotals {
  events: number;
  chunks: number;
  vertsDeformed: number;
  solidsBroken: number;
  plantsFelled: number;
  actorsHit: number;
  meshEdits: number;
}

/** R27：单次命中顶点位移的最大绝对量。根因：连续命中若直接累加到当前顶点会把几何无限压扁。 */
export const MAX_DEFORM = 6;

/**
 * R27 确定性整数 hash → [0,1)。
 * 根因：全工程随机流极敏感，任何 Math.random / 共享 RNG 漂移都会让既有画面全变。
 * 这里用整数坐标混合 + 雪崩，保证同 (seed,i) 恒等、不同 i 充分分散，且不触碰任何全局随机源。
 */
export function debrisHash(seed: number, i: number): number {
  const s = seed | 0;
  const n = i | 0;
  let h = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(n ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul(s ^ n, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // 无符号归一化：(0 .. 2^32-1) / 2^32 ∈ [0,1)
}

/** R27 坍缩剖面：中心(0)位移系数 1，边缘(1)为 0，单调递增的反向（单调递减）、越界钳位幂等。 */
export function collapseProfile(t: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 1));
  return (1 - c) * (1 - c);
}

/**
 * R27 命中材质组分类。
 * group: city_* / eco_* 网格名（先去前缀与尾部 _数字 批次号）；h: 命中点高度。
 * 植物组 → plant；建筑组 → building；其余小件按高度：低处 decor，高处视作建筑附属 building。
 */
export function classifyHit(group: string, h: number): 'building' | 'plant' | 'decor' {
  const g = group.replace(/^(city|eco)_/, '').replace(/_\d+$/, '').toLowerCase();
  if (/^(leaf|leaves|trunk|foliage|grass|bush|tree|flower|petal|reed|bamboo|vine)/.test(g)) return 'plant';
  if (/^(wall|ash|earth|wood|lacquer|metal|ceramic|roof|stone|brick|tile|pillar|beam)/.test(g)) return 'building';
  return h > 3 ? 'building' : 'decor';
}

/** R27 位移钳位：把任意增量压到 ±max，非有限值归零。 */
export function clampDeform(delta: number, max = MAX_DEFORM): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-max, Math.min(max, delta));
}

/**
 * R27 基于「原始坐标」的累计位移叠加（幂等/上限断言的抓手）。
 * prev 与 delta 都是相对原始坐标的位移，不是相对上次命中后的坐标；
 * 因此连续命中不会在已被压扁的坐标上二次坍缩，且总量封顶 ±MAX_DEFORM。
 */
export function boundedDisplacement(prev: number, delta: number, max = MAX_DEFORM): number {
  return clampDeform(prev + delta, max);
}

/** R27 纯函数：把一次命中报告累加进累计计数（系统内部与 Node 单测共用同一套口径）。 */
export function accumulateTotals(t: DestructionTotals, r: DestructionReport): DestructionTotals {
  return {
    events: t.events + 1,
    chunks: t.chunks + r.chunks,
    vertsDeformed: t.vertsDeformed + r.vertsDeformed,
    solidsBroken: t.solidsBroken + r.solidsBroken,
    plantsFelled: t.plantsFelled + r.plantsFelled,
    actorsHit: t.actorsHit + r.actorsHit,
    meshEdits: t.meshEdits + r.meshesTouched,
  };
}

// ---- 模块级单点注册：physics.ts 不持有 world 引用也能拿到系统 ----
let _instance: DestructionSystem | null = null;
export function setDestructionSystem(ds: DestructionSystem | null): void { _instance = ds; }
export function getDestructionSystem(): DestructionSystem | null { return _instance; }

type DamageSolids = (x: number, z: number, radius: number, y: number, power: number) => unknown[];
type ChunkClass = 'building' | 'plant' | 'actor' | 'decor';

interface Chunk {
  id: number;                 // R27 物理轨迹跟踪用：固定跟踪同一块碎块，避免 swap-remove 换索引造成假轨迹
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  wx: number; wy: number; wz: number;
  sx: number; sy: number; sz: number;
  color: THREE.Color;
  groundY: number; stackY: number;
  settled: boolean; bounced: boolean; rest: number; ttl: number;
}

interface Felled { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; until: number }

const FIXED_DT = 1 / 120;      // 与 ImpactSystem.FIXED_DT 一致
const MAX_SUBSTEPS = 16;       // 与 ImpactSystem.MAX_SUBSTEPS 一致
const CAPACITY = 256;          // 单个 InstancedMesh 容量
const FELL_TTL = 8;            // 植物倒伏维持时长（sim-time 秒，非墙钟）
const TRACE_CAP = 600;         // 单块碎块逐步物理轨迹上限（1/120 固定步 → 最长 5s）

export class DestructionSystem {
  /** R27 碎块实例网格：全局仅此一个，空闲隐藏 → 常驻 0 draw call；有活块时最多 +1 */
  readonly chunkMesh: THREE.InstancedMesh;

  private scene: THREE.Scene;
  private vfx: Vfx;
  private opts: { damageSolids?: DamageSolids };

  // 几何变形台账：原始坐标副本 + 累计位移（都按 geometry 缓存，避免连续命中无限压扁）
  private originals = new WeakMap<THREE.BufferGeometry, Float32Array>();
  private deltas = new WeakMap<THREE.BufferGeometry, Float32Array>();

  private chunks: Chunk[] = [];
  private nextChunkId = 1;
  // R27 破坏物理硬证据：固定步积分内部逐 y 记录，不依赖墙钟 / 浏览器定时器 / 截图往返。
  // Puppeteer 在 77M+ tris 场景下采样会被渲染阻塞，读到的全是落地静止值，故直接由物理引擎自证。
  private traceId = -1;
  private trace: number[] = [];
  private felled: Felled[] = [];
  private acc = 0;
  private logicTime = 0;       // sim-time 累加，供倒伏维持/回收计时，不用墙钟
  private totals: DestructionTotals = {
    events: 0, chunks: 0, vertsDeformed: 0, solidsBroken: 0, plantsFelled: 0, actorsHit: 0, meshEdits: 0,
  };
  private lastReport: DestructionReport | null = null;
  private disposed = false;

  // 复用临时对象，避免每次 hit / 每帧 sync 产生大量 GC 压力
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  constructor(scene: THREE.Scene, vfx: Vfx, opts?: { damageSolids?: DamageSolids }) {
    this.scene = scene;
    this.vfx = vfx;
    this.opts = opts ?? {};
    const im = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      CAPACITY,
    );
    im.name = 'r27_debris';
    im.count = 0;                 // 空闲零实例
    im.visible = false;           // 空闲不提交 draw call
    im.frustumCulled = false;     // 碎块四处飞散，避免被包围球裁掉
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh = im;
    scene.add(im);
  }

  /** 一次战斗命中：几何变形 + 台账摘除 + 碎块 + 冲击环，返回可断言的报告。 */
  hit(h: DestructionHit): DestructionReport {
    const report: DestructionReport = {
      ok: false, vertsDeformed: 0, chunks: 0, solidsBroken: 0,
      plantsFelled: 0, actorsHit: 0, meshesTouched: 0, note: '',
    };
    if (this.disposed) { report.note = '系统已 dispose'; return report; }
    const P = h.point;
    if (!Number.isFinite(P.x) || !Number.isFinite(P.y) || !Number.isFinite(P.z)
      || !Number.isFinite(h.power) || !Number.isFinite(h.radius) || h.radius <= 0) {
      report.note = '无效命中参数（非有限值或 radius<=0）';
      return report;
    }
    // 混入事件序号：同坐标同 power 的连续命中也得到不同（但完全确定）的碎块布局。
    const seed = (this.hitSeed(h) ^ Math.imul(this.totals.events + 1, 0x9e3779b9)) | 0;
    const kind = h.kind ?? 'auto';
    const wantBuilding = kind === 'auto' || kind === 'building';
    const wantPlant = kind === 'auto' || kind === 'plant';
    const notes: string[] = [];

    // ---- 1) 静态城市几何变形 + 动态生态倒伏 ----
    let chunkClass: ChunkClass = 'building';
    let classFound = false;
    let shadowPassTouched = false;
    if (wantBuilding || wantPlant) {
      this.scene.traverse((o) => {
        const name = o.name;
        if (name.startsWith('eco_') && (o as THREE.InstancedMesh).isInstancedMesh && wantPlant) {
          this.fellEco(o as THREE.InstancedMesh, h, seed, report);
        } else if (name.startsWith('city_') && (o as THREE.Mesh).isMesh) {
          const cls = classifyHit(name, P.y);
          if ((cls === 'building' && wantBuilding) || (cls === 'plant' && wantPlant)) {
            const touched = this.deformCity(o as THREE.Mesh, h, seed, cls, report);
            if (touched) {
              if (!classFound) { chunkClass = cls; classFound = true; }
              if ((o as THREE.Mesh).castShadow) shadowPassTouched = true;
            }
          }
        }
      });
    }
    // R27 如实标注：bake.ts:1349 里 wall/wood/ash/earth/roof/trunk/ceramic/metal/lacquer
    // 组 castShadow=true，改顶点会重复进阴影 pass（本系统不改阴影设置）。
    if (shadowPassTouched) notes.push('命中 castShadow 网格：改顶点会重复进阴影 pass（如实标注，未改阴影设置）');

    // ---- 2) 把被打碎构件从碰撞台账摘除 ----
    // R27 唯一调用点：注入的 damageSolids(x,z,radius,y,power) 由并行实现线
    // （src/rt/solids.ts solidDamage）提供，把命中半径内构件从台账摘除、其返回数组长度
    // 记入 report.solidsBroken；本系统不碰 WS_GRID / walkSurfaceY（另一条实现线让
    // solidBlocked 放行）。未注入时如实记 0 并在 note 写明，绝不伪造。
    if (wantBuilding) {
      if (this.opts.damageSolids) {
        const removed = this.opts.damageSolids(P.x, P.z, h.radius, P.y, h.power);
        report.solidsBroken = Array.isArray(removed) ? removed.length : 0;
      } else {
        notes.push('damageSolids 未注入：solidsBroken 记为 0（碰撞台账由并行实现线提供）');
      }
    }

    // ---- 3) 碎块（所有 kind 都产生；碎块物理是本系统的核心，不是只有粒子） ----
    const clsForChunk: ChunkClass = kind === 'actor' ? 'actor'
      : classFound ? chunkClass : kind === 'plant' ? 'plant' : 'building';
    report.chunks = this.spawnChunks(h, seed, clsForChunk);

    // ---- 4) 角色命中计数 / 5) 确定性冲击环（vfx.ring 无随机，不触碰共享 RNG） ----
    report.actorsHit = kind === 'actor' ? 1 : 0;
    this.vfx.ring(P.clone(), this.ringColor(clsForChunk), Math.max(2, h.radius * 1.6), 0.7);

    // ---- 6) 报告与累计 ----
    report.ok = true;
    const base = `R27 命中 source=${h.source} kind=${kind} 组=${clsForChunk} 变形${report.vertsDeformed}顶点/触${report.meshesTouched}网格/碎块${report.chunks}`;
    // 上传策略如实标注：DynamicDrawUsage + addUpdateRange 局部区间（r180 自动合并/清空 ranges）。
    notes.push('顶点上传：DynamicDrawUsage + addUpdateRange 局部区间（r180 自动合并/清空 ranges，单次命中单 mesh 仅标一次）');
    report.note = base + '；' + notes.join('；');
    this.lastReport = report;
    this.totals = accumulateTotals(this.totals, report);
    return report;
  }

  /** 每帧推进：固定步碎块物理 + 倒伏维持 + 实例矩阵同步。 */
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.logicTime += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.step(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.acc = Math.min(this.acc, FIXED_DT);
    this.maintainFelled();
    this.syncMesh();
  }

  stats(): {
    events: number; chunks: number; aliveChunks: number; vertsDeformed: number;
    solidsBroken: number; plantsFelled: number; actorsHit: number; meshEdits: number;
    drawCallsWhenIdle: number; lastReport: DestructionReport | null;
    physicsTrace: number[]; physicsDistinct: number; physicsTrackedId: number;
  } {
    const idle = this.chunks.length === 0;
    // R27 空闲零 draw call 的可观测依据：空闲时 chunkMesh 被强制 visible=false 且 count=0。
    // 下面按 mesh 实态计算而非硬编码常量——若空闲却仍可见，会如实返回 1 以暴露泄漏。
    const drawCallsWhenIdle = idle && this.chunkMesh.visible ? 1 : 0;
    return {
      events: this.totals.events,
      chunks: this.totals.chunks,
      aliveChunks: this.chunks.length,
      vertsDeformed: this.totals.vertsDeformed,
      solidsBroken: this.totals.solidsBroken,
      plantsFelled: this.totals.plantsFelled,
      actorsHit: this.totals.actorsHit,
      meshEdits: this.totals.meshEdits,
      drawCallsWhenIdle,
      lastReport: this.lastReport,
      physicsTrace: this.trace.slice(),
      physicsDistinct: new Set(this.trace).size,
      physicsTrackedId: this.traceId,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.chunkMesh);
    this.chunkMesh.geometry.dispose();
    (this.chunkMesh.material as THREE.Material).dispose();
    this.chunks.length = 0;
    this.felled.length = 0;
    setDestructionSystem(null);
  }

  // ---- 内部实现 ----

  /** 整数坐标 hash 种子：同一命中点/power/source 恒等，且不同来源同坐标也不同。 */
  private hitSeed(h: DestructionHit): number {
    const x = Math.round(h.point.x * 8) | 0;
    const y = Math.round(h.point.y * 8) | 0;
    const z = Math.round(h.point.z * 8) | 0;
    const p = Math.round(h.power * 4) | 0;
    const sMap: Record<DestructionHit['source'], number> = { player: 1, cannon: 2, vehicle: 3, boss: 4, test: 5 };
    const s = sMap[h.source] ?? 0;
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
      ^ Math.imul(p, 2654435761) ^ Math.imul(s, 1013904223)) | 0;
  }

  /**
   * R27 建筑破洞/坍缩 或 植物倾倒：直接改 city_* mesh 的 position BufferAttribute。
   * 命中点世界坐标 + 半径球形筛顶点；破口外推 + 向下坍缩 + 确定性 hash 抖动；
   * 基于原始坐标副本叠加位移并封顶；局部上传 addUpdateRange + 重算包围球。
   */
  private deformCity(mesh: THREE.Mesh, h: DestructionHit, seed: number, cls: 'building' | 'plant', report: DestructionReport): boolean {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || !(pos.array instanceof Float32Array)) return false;
    const arr = pos.array as Float32Array;

    // 世界坐标包围球快速剔除：契约保证 city_* 顶点即最终世界坐标、matrix 为单位矩阵。
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    if (bs && h.point.distanceTo(bs.center) > h.radius + bs.radius + 0.001) return false;

    let orig = this.originals.get(geo);
    let delta = this.deltas.get(geo);
    if (!orig || !delta || delta.length !== arr.length) {
      // R27 修正：Baker.flush()/mergeExact() 产出的是普通 STATIC_DRAW BufferAttribute，
      // 运行期要动态改写顶点，必须在首次改动前置为 DynamicDrawUsage
      //（工程先例：engine.ts:414 / ecoExpansion.ts:889）。改过一次后 usage 保持 Dynamic。
      if (typeof pos.setUsage === 'function') pos.setUsage(THREE.DynamicDrawUsage);
      orig = new Float32Array(arr);          // 首次改动缓存原始副本
      delta = new Float32Array(arr.length);  // 累计位移（相对原始），初始 0
      this.originals.set(geo, orig);
      this.deltas.set(geo, delta);
    }

    const P = h.point;
    const R = h.radius, R2 = R * R;
    const S = clampDeform(h.power * 0.03);  // 本次命中强度（同样封顶）
    // 植物倒伏方向：确定性，同一 hit 内一致
    const leanA = debrisHash(seed, 7) * Math.PI * 2;
    const lx = Math.cos(leanA), lz = Math.sin(leanA);
    const nVerts = pos.count;
    let minVi = nVerts, maxVi = -1, changed = 0;

    for (let vi = 0; vi < nVerts; vi++) {
      const k = vi * 3;
      const ox = orig[k], oy = orig[k + 1], oz = orig[k + 2];
      const dx = ox - P.x, dy = oy - P.y, dz = oz - P.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      const t = Math.min(1, Math.sqrt(d2) / R);
      const w = collapseProfile(t);          // 距中心衰减剖面
      if (w <= 0) continue;

      const h1 = debrisHash(seed, vi * 3 + 1);
      const h2 = debrisHash(seed, vi * 3 + 2);
      const h3 = debrisHash(seed, vi * 3 + 3);
      let ddx = 0, ddy = 0, ddz = 0;
      if (cls === 'building') {
        // 破口：沿命中点→顶点水平径向向外推；坍缩：向下；hash 抖动打碎石块感。
        const inv = 1 / (Math.hypot(dx, dz) + 1e-4);
        const nx = dx * inv, nz = dz * inv;
        const outward = S * w * (0.5 + h1 * 0.9);
        const drop = S * w * (1.1 + h2 * 0.7);
        ddx = nx * outward + (h3 - 0.5) * S * w * 0.7;
        ddy = -drop + (h1 - 0.5) * S * w * 0.5;
        ddz = nz * outward + (h2 - 0.5) * S * w * 0.7;
      } else {
        // 植物：顶点按高度线性侧移 + 下压，模拟整株倾倒折断。
        const up = Math.min(1, Math.max(0, (oy - (P.y - 1)) / 8));
        const lean = up * S * 2.2;
        ddx = lx * lean + (h1 - 0.5) * S * w * 0.4;
        ddy = -up * S * 1.3 + (h2 - 0.5) * S * w * 0.3;
        ddz = lz * lean + (h3 - 0.5) * S * w * 0.4;
      }

      // 基于原始副本叠加 + 上限：连续命中不会无限压扁（幂等语义）。
      delta[k] = boundedDisplacement(delta[k], ddx);
      delta[k + 1] = boundedDisplacement(delta[k + 1], ddy);
      delta[k + 2] = boundedDisplacement(delta[k + 2], ddz);
      arr[k] = ox + delta[k];
      arr[k + 1] = oy + delta[k + 1];
      arr[k + 2] = oz + delta[k + 2];
      changed++;
      if (vi < minVi) minVi = vi;
      if (vi > maxVi) maxVi = vi;
    }
    if (changed === 0) return false;

    // R27 局部上传：单次命中、单个 mesh 只标记一次区间（门控①）；r180 渲染器会把
    // 多次命中的 updateRanges 排序合并后局部 bufferSubData 并自动 clearUpdateRanges，
    // 绝不整份重传百万顶点。
    this.markRange(pos, minVi * 3, (maxVi - minVi + 1) * 3);
    geo.computeBoundingSphere();             // 变形后重算包围球，保持 frustumCulled 正确
    const nbs = geo.boundingSphere;
    if (nbs) nbs.radius += MAX_DEFORM + 1;   // 外推顶点余量，避免被裁剪
    mesh.frustumCulled = true;
    report.vertsDeformed += changed;
    report.meshesTouched += 1;
    return true;
  }

  /**
   * R27 局部缓冲上传 + 门控限频。
   * 根因：Baker.flush()/mergeExact() 产出普通 STATIC_DRAW 属性，addUpdateRange 是全工程首次引入。
   * three r180 实测：BufferAttribute.js:178 addUpdateRange 把区间 push 进 updateRanges[]；
   * WebGLAttributes.js:83~147 排序合并区间后按段 gl.bufferSubData，末尾 clearUpdateRanges() 清空。
   * 因此局部上传真实生效、多次命中自动合并，不会每次命中重传百万顶点。
   * 若运行时无 addUpdateRange（老版本），退回 needsUpdate=true 全量上传，但仍守两道门控：
   *   ① deformCity 保证「单次命中、单个 mesh 只调用本函数一次」；
   *   ② 改动量 count 钳制在 attr.array.length 内，杜绝越界 / 异常全量。
   */
  private markRange(attr: THREE.BufferAttribute, start: number, count: number): void {
    if (count <= 0) return;
    const cap = attr.array.length;
    const s = Math.max(0, Math.min(start, cap));
    const c = Math.min(count, cap - s);        // 门控②：改动量绝不超过该 mesh 顶点总量
    if (c <= 0) return;
    const a = attr as THREE.BufferAttribute & { addUpdateRange?: (s: number, c: number) => void };
    if (typeof a.addUpdateRange === 'function') a.addUpdateRange(s, c); // 局部上传，渲染器自动合并+清空
    // 无 addUpdateRange 时仅靠 needsUpdate 全量回退（门控①已保证单次命中只标一次）
    attr.needsUpdate = true;
  }

  /**
   * R27 动态生态倒伏：对 eco_* InstancedMesh 命中半径内实例做 60~85° 倾斜 + 下沉。
   * 不新建 Mesh；倒伏矩阵登记到 felled，由 update() 每帧重写（eco_ 系统在前段每帧刷新矩阵，
   * world.update 把 destruction.update 排在其后，故能盖回去维持倒伏）。
   */
  private fellEco(im: THREE.InstancedMesh, h: DestructionHit, seed: number, report: DestructionReport): void {
    const P = h.point, R = h.radius;
    const m = this.tmpM, q = this.tmpQ, e = this.tmpE, v = this.tmpV, s = this.tmpS;
    const until = this.logicTime + FELL_TTL;
    let felledCount = 0;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);           // 实例矩阵 translation 即最终世界坐标（eco_ 不参与缩放）
      const dx = v.x - P.x, dz = v.z - P.z;
      if (dx * dx + dz * dz > R * R) continue;
      m.decompose(v, q, s);                 // 保留位置与缩放，只替换旋转
      const ang = (60 + debrisHash(seed, i * 5 + 1) * 25) * Math.PI / 180;
      const dir = debrisHash(seed, i * 5 + 2) > 0.5 ? 1 : -1;
      e.set(ang * dir, debrisHash(seed, i * 5 + 3) * 0.6, ang * dir * 0.3, 'XYZ');
      q.setFromEuler(e);
      v.y -= 0.4 + s.y * 0.25;             // 下沉
      m.compose(v, q, s);
      im.setMatrixAt(i, m);
      this.felled.push({ mesh: im, index: i, matrix: m.clone(), until });
      felledCount++;
    }
    if (felledCount > 0) {
      im.instanceMatrix.needsUpdate = true;
      report.plantsFelled += felledCount;
      report.meshesTouched += 1;
    }
  }

  /** 维持已倒伏实例：每帧把倒伏矩阵盖回去，直到 FELL_TTL 到期释放（eco_ 恢复动画）。 */
  private maintainFelled(): void {
    if (this.felled.length === 0) return;
    const active = this.felled.filter((f) => this.logicTime < f.until);
    const touched = new Set<THREE.InstancedMesh>();
    for (const f of active) { f.mesh.setMatrixAt(f.index, f.matrix); touched.add(f.mesh); }
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
    this.felled = active;
  }

  /** R27 生成 12~40 个确定性碎块：初速向命中点外 + 向上、角速度、尺寸、颜色、落地堆叠。 */
  private spawnChunks(h: DestructionHit, seed: number, cls: ChunkClass): number {
    let n = 12 + Math.floor(debrisHash(seed, 999) * 29);  // 12..40
    n = Math.min(n, CAPACITY - this.chunks.length);
    if (n <= 0) return 0;
    const P = h.point;
    const base = this.chunkColor(cls);
    for (let j = 0; j < n; j++) {
      const i = j;                          // 本次命中内局部序号，确定性
      const a = debrisHash(seed, i * 8 + 1) * Math.PI * 2;
      const sp = 2 + debrisHash(seed, i * 8 + 2) * (4 + h.power * 0.02);
      const sx = 0.3 + debrisHash(seed, i * 8 + 3) * 0.9;
      const sy = 0.3 + debrisHash(seed, i * 8 + 4) * 0.9;
      const sz = 0.3 + debrisHash(seed, i * 8 + 5) * 0.9;
      const color = base.clone().multiplyScalar(0.75 + debrisHash(seed, i * 8 + 6) * 0.5);
      this.chunks.push({
        id: this.nextChunkId++,
        x: P.x + Math.cos(a) * 0.4,
        y: P.y + 0.5 + debrisHash(seed, i * 8 + 7) * 1.5,
        z: P.z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * sp,
        vy: 3 + debrisHash(seed, i * 8 + 8) * 6 + h.power * 0.01,
        vz: Math.sin(a) * sp,
        rx: 0, ry: 0, rz: 0,
        wx: (debrisHash(seed, i * 8 + 9) - 0.5) * 8,
        wy: (debrisHash(seed, i * 8 + 10) - 0.5) * 8,
        wz: (debrisHash(seed, i * 8 + 11) - 0.5) * 8,
        sx, sy, sz, color,
        groundY: P.y, stackY: debrisHash(seed, i * 8 + 12) * 0.6,
        settled: false, bounced: false, rest: 0,
        ttl: 6 + debrisHash(seed, i * 8 + 13) * 4,   // 静止后保留 6~10s 再回收
      });
    }
    // 每次命中重置轨迹，固定跟踪本批第 0 块：证明「同一块碎块」在重力下真实位移。
    if (n > 0) {
      this.trace = [];
      this.traceId = this.chunks[this.chunks.length - n].id;
    }
    return n;
  }

  /** 一个固定步：vy -= 21*dt 抛体积分 + 落地反弹一次后静止 + 静止超时回收。 */
  private step(dt: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (!c.settled) {
        c.vy -= 21 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
        c.vx *= 1 - dt * 0.4; c.vz *= 1 - dt * 0.4;   // 空气阻力
        const floor = c.groundY + c.stackY + c.sy * 0.5;
        if (c.y <= floor) {
          c.y = floor;
          if (!c.bounced) {
            c.vy = -c.vy * 0.32; c.vx *= 0.6; c.vz *= 0.6;
            c.wx *= 0.5; c.wy *= 0.5; c.wz *= 0.5;
            c.bounced = true;                  // 只反弹一次
          } else {
            c.vx = c.vy = c.vz = 0; c.wx = c.wy = c.wz = 0;
            c.settled = true; c.rest = 0;     // 第二次触地静止堆叠
          }
        }
      } else {
        c.rest += dt;
        if (c.rest >= c.ttl) {              // swap-remove 回收（索引变化由每帧全量重写兜底）
          const last = this.chunks.length - 1;
          this.chunks[i] = this.chunks[last];
          this.chunks.pop();
        }
      }
    }
    // 物理引擎内部自证：每个固定步记一次被跟踪碎块的真实 y（回收后停止记录）。
    if (this.traceId >= 0 && this.trace.length < TRACE_CAP) {
      for (let i = 0; i < this.chunks.length; i++) {
        if (this.chunks[i].id === this.traceId) {
          this.trace.push(+this.chunks[i].y.toFixed(3));
          break;
        }
      }
    }
  }

  /** 把碎块写进 InstancedMesh；空闲时强制隐藏且 count=0 → 零 draw call。 */
  private syncMesh(): void {
    const im = this.chunkMesh;
    if (this.chunks.length === 0) {
      if (im.count !== 0) im.count = 0;
      if (im.visible) im.visible = false;
      return;
    }
    im.visible = true;
    im.count = this.chunks.length;
    const m = this.tmpM, q = this.tmpQ, e = this.tmpE, v = this.tmpV, s = this.tmpS;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      v.set(c.x, c.y, c.z);
      e.set(c.rx, c.ry, c.rz, 'XYZ');
      q.setFromEuler(e);
      s.set(c.sx, c.sy, c.sz);
      m.compose(v, q, s);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.color);            // 首次调用自动创建 instanceColor
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  /** 碎块三档材质色 + 角色暖色（无顶点色时的兜底，按命中组分类）。 */
  private chunkColor(cls: ChunkClass): THREE.Color {
    if (cls === 'actor') return new THREE.Color(0xffb300);
    if (cls === 'plant') return new THREE.Color(0x4a7a3a);
    if (cls === 'building') return new THREE.Color(0x9a8f7a);  // 石材
    return new THREE.Color(0x8a5a2b);                          // 木 / 陈设
  }

  private ringColor(cls: ChunkClass): number {
    if (cls === 'actor') return 0xffb300;
    if (cls === 'plant') return 0x7dff9c;
    return 0xff7a2d;
  }
}
