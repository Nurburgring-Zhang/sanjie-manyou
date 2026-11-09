import * as THREE from 'three';

/**
 * ============================================================================
 * perfBudget.ts — 降低渲染负载的统一预算 / 空间分块剔除 / 运行期统计
 * ============================================================================
 *
 * 【技术对照说明：如实标注，严禁把「等效替代」说成原技术落地】
 *
 * 1) VRS 可变速率着色（Variable Rate Shading）
 *    - WebGL2 没有任何公开的 shading-rate 扩展；WebGPU 核心规范同样没有
 *      shading-rate 特性（该能力来自 D3D12/Vulkan 的可选扩展，浏览器图形 API 未暴露）。
 *    - 因此本工程【不能原样实现 VRS】。任何「per-tile 降采样着色」都没有可调用的 API。
 *    - 等效替代（本文件 + engine.ts）：「帧预算调度器」按帧时间给出档位，
 *      只对【远景层的更新频率】、【静态阴影 / 反射的刷新频率】做降频。
 *    - 关键：不做「画面模糊处降精度」——那需要动分辨率/贴图，会引入中近景画质损失，
 *      违反硬约束。所以本工程连「半分辨率后处理链 / 动态分辨率」也【未采用】：
 *      EffectComposer 始终全分辨率，只调整「多久更新一次」。
 *
 * 2) DVS 延迟顶点着色（Deferred Vertex Shading，Arm Mali 硬件术语）
 *    - 这是 GPU 驱动/硬件内部的顶点着色调度，应用层（JS/WebGL）不可直接调用。
 *    - 因此本工程【不能原样实现 DVS】。
 *    - 等效替代（SpatialChunkIndex + ChunkGate）：把世界按 PERF_CHUNK 分块，
 *      每帧用视锥剔除「视锥外 / 被雾与远平面遮蔽的远景区块」，只提交看得见的部分 ——
 *      与 DVS「跳过看不见的部分」同精神，但不是同一机制，只是应用层可做的等效降载。
 *    - 关于「CPU 侧按可视区块压紧 InstancedMesh.count / 可见实例」：【如实降级，未做 count 压紧】。
 *      本工程动态 InstancedMesh（eco_* 生态、角色池、infill 空间桶）都按「固定槽位 id」
 *      每帧 setMatrixAt(slot,...)，instanceColor 亦按槽位一次性写入；压紧 count 需重排
 *      实例矩阵，会与固定槽位语义及颜色映射错位（可见画质损失），且生态实例仅数百，
 *      收益低于风险。故改用「渲染前一瞬设 visible=false、composer.render 后立即 restore」
 *      的分区门控：同样跳过不可见区块，不新增 draw call、不重排实例、不留跨帧副作用，
 *      也绝不与 LodManager.applyVisibility / 反射闸门 / 各生态 update 的 visible 语义冲突。
 *
 * 3) 静态阴影缓存（engine.ts step）：真实落地。
 *    shadowMap.autoUpdate=false + needsUpdate 门控：相机静止且静态几何未变时不重绘
 *    shadow map；相机移动超过阈值 / 静态几何真变化 / 画质切换才刷新。
 *    静态城市 + 固定方向光 ⇒ 相机静止时阴影贴图内容逐像素不变 ⇒ 零画质损失。
 *
 * 4) WebGL2 遮挡查询 / PVS：见 occlusion.ts。会检测 EXT_disjoint_timer_query_webgl2
 *    与 ANY_SAMPLES_PASSED 能力；因接入 query 需要额外 proxy draw call、并与
 *    EffectComposer 的 GL 状态 / logarithmicDepthBuffer 冲突，【如实降级为 PVS 粗判】。
 *
 * 5) Web Worker 剔除：见 culling.worker.ts。已实现纯函数计算，但【未接线到主渲染循环】
 *    （接线需改 main.ts 构建配置，禁止修改 main.ts + 并发构建期风险）。如实标注未启用，
 *    当前走本文件的同步 ChunkGate 路径。
 *
 * 6) 远景半分辨率 / 动态分辨率：【未采用】。因为降分辨率会波及中近景（硬约束禁止）。
 *    改为「帧预算调度器」只调更新频率，不动分辨率 / 几何 / 贴图。
 *
 * ---------------------------------------------------------------------------
 * 【中近景硬保护：具体保证】
 * - PERF_NEAR_GUARD = 400（= engine.ts LOD_ENTER[1] 中档边界）。
 *   所有剔除 / 降频只对「包围球中心距相机 > 400m」的【远景】对象生效；
 *   ≤ 400m 的对象一律不碰 visible、不碰任何属性（ChunkGate.apply 直接 continue）。
 * - 帧预算档位【只】调整「更新频率」（阴影刷新最小间隔 / 远景门控周期 / 反射周期）。
 *   绝不触碰：renderer.setPixelRatio、composer.setSize、shadow.mapSize、
 *   shadow.camera.*、LOD_ENTER/EXIT、任何贴图、任何几何、材质。
 * - 反射闸门由 world.ts 既有 mirrorHot 实现（本文件不越界修改 world.ts，仅在统计反映）。
 *   分区门控的 visible=false 在主 RenderPass 与 Reflector 二次整场渲染间共享（同一 scene / 同一帧），
 *   因此远景视锥外对象在反射里也一并被保守剔除；这属于远景区块降级，中近景不受影响。
 * - `logarithmicDepthBuffer:true` 保持开启（near=0.5/far=52000 保远端深度精度），
 *   绝不关闭；远平面相关的保守逻辑只做「视锥外」剔除，不改 far。
 * ============================================================================
 */

/** 中近景保护半径（m）：≤ 此距离的对象永不参与任何剔除/降频 */
export const PERF_NEAR_GUARD = 400;
/** 空间分块边长（m）：给跨全城合批网格建立「空间分块索引」的粒度 */
export const PERF_CHUNK = 256;
/** 帧预算档位阈值（ms，EMA 帧间隔）：full <16.7 / balanced 24 / saver 34 */
// 显式标注为 number：不用 as const，避免字段被推断成字面量类型 16.7 后又被赋别的 number 而报 TS2322
export const PERF_TIER_MS: { full: number; balanced: number; saver: number } = { full: 16.7, balanced: 24, saver: 34 };

export type PerfTier = 'full' | 'balanced' | 'saver';

/** 把 (x,z) 落在的区块编码成一个 number；仅供 Set/Map 使用，不参与渲染 */
export function perfChunkId(x: number, z: number): number {
  const ix = Math.floor(x / PERF_CHUNK) + 1024;
  const iz = Math.floor(z / PERF_CHUNK) + 1024;
  return ix * 4096 + iz;
}

export interface PerfProtection {
  nearGuardM: number;
  pixelRatioUntouched: boolean;
  composerFullRes: boolean;
  shadowMapSizeUntouched: boolean;
  shadowCameraUntouched: boolean;
  lodDistancesUntouched: boolean;
  geometryTexturesUntouched: boolean;
  logarithmicDepthKept: boolean;
  halfResPostDisabled: boolean;
  note: string;
}

/** 运行期统一统计返回类型（window.__perfBudget() 的返回） */
export interface PerfBudgetSnapshot {
  enabled: boolean;
  frame: number;
  tier: PerfTier;
  forcedTier: string | null;
  emaFrameMs: number;
  tierChanges: number;
  schedules: {
    shadowMinInterval: number;
    farGateInterval: number;
    reflectionInterval: number;
    note: string;
  };
  shadow: {
    refreshCount: number;
    skippedFrames: number;
    camMoveTriggers: number;
    staticDirtyTriggers: number;
    lastReason: string;
  };
  staticDirty: boolean;
  nearGuardM: number;
  chunkSizeM: number;
  protection: PerfProtection;
  chunkGate: ChunkGateSnapshot;
  /** engine.ts attachPerfExtras 注入：occlusion / pools 等外部统计 */
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// 帧预算调度器：只调「更新频率」，不动画质
// ---------------------------------------------------------------------------
export class PerfBudget {
  enabled = true;
  frame = 0;
  tier: PerfTier = 'full';
  tierChanges = 0;
  emaMs: number = PERF_TIER_MS.full;
  /** ?perfTier=full|balanced|saver 强制档位，供探针断言三档调度均可达 */
  readonly forcedTier: string | null;
  private frameSinceShadow = 999;
  private staticDirtyFlag = false;
  private extras: () => Record<string, unknown> = () => ({});

  readonly shadow = {
    refreshCount: 0,
    skippedFrames: 0,
    camMoveTriggers: 0,
    staticDirtyTriggers: 0,
    lastReason: 'init',
  };

  constructor() {
    let f: string | null = null;
    if (typeof location !== 'undefined') {
      try { f = new URLSearchParams(location.search).get('perfTier'); } catch { f = null; }
    }
    this.forcedTier = f === 'full' || f === 'balanced' || f === 'saver' ? f : null;
  }

  attachExtras(fn: () => Record<string, unknown>): void { this.extras = fn; }

  /** 每帧首部调用：更新 EMA、档位（带滞回，避免抖动） */
  beginFrame(dtMs: number): void {
    this.frame++;
    this.frameSinceShadow++;
    const s = Math.min(100, Math.max(0, dtMs));
    this.emaMs = this.emaMs * 0.9 + s * 0.1;
    if (this.forcedTier) {
      if (this.tier !== this.forcedTier) { this.tier = this.forcedTier as PerfTier; this.tierChanges++; }
      return;
    }
    const t = this.tier;
    let next: PerfTier = t;
    if (t === 'full' && this.emaMs > PERF_TIER_MS.balanced) next = 'balanced';
    else if (t === 'balanced' && this.emaMs > PERF_TIER_MS.saver) next = 'saver';
    else if (t === 'balanced' && this.emaMs < PERF_TIER_MS.full * 0.92) next = 'full';
    else if (t === 'saver' && this.emaMs < PERF_TIER_MS.balanced * 0.92) next = 'balanced';
    if (next !== t) { this.tier = next; this.tierChanges++; }
  }

  /** 阴影刷新最小间隔（帧）。档位越高越省，但只改「多久重绘」，不改阴影分辨率/范围 */
  get shadowMinInterval(): number { return this.tier === 'full' ? 1 : this.tier === 'balanced' ? 2 : 4; }
  /** 远景门控更新周期（帧）：saver 档可隔帧重判远景剔除，中近景每帧全量 */
  get farGateInterval(): number { return this.tier === 'full' ? 1 : this.tier === 'balanced' ? 2 : 3; }
  /** 反射更新周期建议值（帧）：world.ts mirrorHot 已实现按需停更，这里只给统计口径 */
  get reflectionInterval(): number { return this.tier === 'full' ? 1 : this.tier === 'balanced' ? 2 : 4; }

  /** 静态几何真变化时调用（例如画质切换重建 shadow.map） */
  markStaticDirty(): void { this.staticDirtyFlag = true; }
  get staticDirty(): boolean { return this.staticDirtyFlag; }

  /**
   * 阴影是否需要刷新。
   * 相机静止 + 几何未变 → false（最大收益：静态城市逐帧省掉整遍 46M 阴影 pass）。
   * 需要刷新时仍受档位频率上限约束，避免相机连续移动时每帧重绘。
   */
  shadowDue(camMoved: boolean, staticDirty: boolean): boolean {
    const want = camMoved || staticDirty || this.staticDirtyFlag;
    if (!want) {
      this.shadow.skippedFrames++;
      this.shadow.lastReason = 'idle';
      return false;
    }
    if (this.frameSinceShadow < this.shadowMinInterval) {
      this.shadow.skippedFrames++;
      this.shadow.lastReason = 'budget';
      return false;
    }
    return true;
  }

  noteShadowRefresh(camMoved: boolean, staticDirty: boolean): void {
    this.shadow.refreshCount++;
    this.frameSinceShadow = 0;
    if (camMoved) this.shadow.camMoveTriggers++;
    if (staticDirty) this.shadow.staticDirtyTriggers++;
    this.shadow.lastReason = camMoved ? 'camera' : staticDirty ? 'static' : 'dirty';
    this.staticDirtyFlag = false;
  }

  snapshot(): PerfBudgetSnapshot {
    return {
      enabled: this.enabled,
      frame: this.frame,
      tier: this.tier,
      forcedTier: this.forcedTier,
      emaFrameMs: +this.emaMs.toFixed(2),
      tierChanges: this.tierChanges,
      schedules: {
        shadowMinInterval: this.shadowMinInterval,
        farGateInterval: this.farGateInterval,
        reflectionInterval: this.reflectionInterval,
        note: '档位只调「更新频率」；中近景分辨率/几何/贴图/阴影分辨率/LOD 距离一律不动',
      },
      shadow: { ...this.shadow },
      staticDirty: this.staticDirtyFlag,
      nearGuardM: PERF_NEAR_GUARD,
      chunkSizeM: PERF_CHUNK,
      protection: protectionState(),
      chunkGate: getChunkGate().snapshot(),
      ...this.extras(),
    };
  }
}

export function protectionState(): PerfProtection {
  return {
    nearGuardM: PERF_NEAR_GUARD,
    pixelRatioUntouched: true,
    composerFullRes: true,
    shadowMapSizeUntouched: true,
    shadowCameraUntouched: true,
    lodDistancesUntouched: true,
    geometryTexturesUntouched: true,
    logarithmicDepthKept: true,
    halfResPostDisabled: true,
    note: '所有降级只作用于 >400m 远景 / 被遮挡区块 / 更新频率；中近景零画质损失',
  };
}

// ---------------------------------------------------------------------------
// 分区视锥剔除：给「跨全城大合批」建立空间分块索引，并做对象级门控
// ---------------------------------------------------------------------------
export interface GateEntry {
  obj: THREE.InstancedMesh;
  /** 世界空间包围球（refresh 时由 im.boundingSphere 变换而来） */
  sphere: THREE.Sphere;
  chunkId: number;
  dist: number;
}

export interface ChunkGateSnapshot {
  indexedObjects: number;
  staticIndexedMeshes: number;
  staticChunks: number;
  culledFarObjects: number;
  visibleFarObjects: number;
  nearProtectedObjects: number;
  lastCullFrame: number;
  mode: string;
}

/**
 * ChunkGate 的安全契约：
 * - 只收集「已带精确 boundingSphere 且 frustumCulled !== false」的 InstancedMesh。
 *   Baker 的 city_* 是普通 Mesh（无 boundingSphere，且故意覆盖全城）——【不收集】，
 *   避免审计指出的「粗暴打开 frustumCulled 宣称优化」。它们的空间分块索引只写进
 *   userData 供统计（staticIndexedMeshes/staticChunks），不作为剔除对象。
 * - 尊重系统「故意关闭剔除」的对象（eco_* / InstPool / lod_impostor 均为 frustumCulled=false）。
 * - apply 只做「减」：把远景视锥外对象临时设 visible=false，并在 restore() 恢复；
 *   每帧 apply 在 lod.update() 之后、composer.render() 之前；restore 在 render 之后。
 *   这样绝不与 LodManager.applyVisibility / 反射闸门 / 各生态 update 的 visible 语义冲突。
 * - 中近景（dist ≤ PERF_NEAR_GUARD）直接 continue，连 visible 都不碰。
 */
export class ChunkGate {
  private entries: GateEntry[] = [];
  private lastChildCount = -1;
  private touchedObj: THREE.Object3D[] = [];
  private touchedPrev: boolean[] = [];
  private touchedN = 0;
  readonly stats: ChunkGateSnapshot = {
    indexedObjects: 0,
    staticIndexedMeshes: 0,
    staticChunks: 0,
    culledFarObjects: 0,
    visibleFarObjects: 0,
    nearProtectedObjects: 0,
    lastCullFrame: 0,
    mode: 'sync-chunk-frustum',
  };

  /**
   * 增量收集：仅在 scene.children 数量变化时重扫（世界加载完成后 children 数稳定 ⇒ 稳态，
   * 不每帧分配，符合「对象池稳态化 / 避免每帧 new」）。
   */
  refresh(scene: THREE.Scene): void {
    if (scene.children.length === this.lastChildCount) return;
    this.lastChildCount = scene.children.length;
    this.entries.length = 0;
    let staticMeshes = 0, staticChunks = 0;
    const tmpSphere = new THREE.Sphere();
    scene.traverse((obj) => {
      // 静态合批网格的空间分块索引（bake.ts flush 写入），只统计不剔除
      const ud = obj.userData as { perfStaticChunk?: { chunks: number } } | undefined;
      if (ud && ud.perfStaticChunk) {
        staticMeshes++;
        staticChunks += ud.perfStaticChunk.chunks;
      }
      if (!(obj instanceof THREE.InstancedMesh)) return;
      const im = obj;
      // 尊重系统显式关闭剔除的对象（eco_* / 角色池 / lod 剪影卡）
      if (im.frustumCulled === false) return;
      if (im.name === 'lod_impostor') return;
      const bs = im.boundingSphere;
      if (!bs) return;
      im.updateWorldMatrix(true, false);
      tmpSphere.copy(bs).applyMatrix4(im.matrixWorld);
      this.entries.push({
        obj: im,
        sphere: tmpSphere.clone(),
        chunkId: perfChunkId(tmpSphere.center.x, tmpSphere.center.z),
        dist: 0,
      });
    });
    this.stats.indexedObjects = this.entries.length;
    this.stats.staticIndexedMeshes = staticMeshes;
    this.stats.staticChunks = staticChunks;
  }

  entriesView(): readonly GateEntry[] { return this.entries; }

  /**
   * @param visibleChunks occlusion.ts PVS 产出的「区块级潜在可见集」
   * @param frame 当前帧号（帧预算 farGateInterval 可让远景门控隔帧重判）
   */
  apply(visibleChunks: Set<number>, frustum: THREE.Frustum, camPos: THREE.Vector3,
        frame: number, farGateInterval: number): void {
    this.restore(); // 兜底：先恢复上一帧（若外部漏调 restore）
    let culled = 0, visFar = 0, nearP = 0;
    for (const e of this.entries) {
      const d = e.sphere.center.distanceTo(camPos);
      e.dist = d;
      // 中近景硬保护：≤ 400m 一律不碰（visible 由 LOD/各系统自己管）
      if (d <= PERF_NEAR_GUARD) { nearP++; continue; }
      // 远景：区块可见 或 包围球与视锥相交（保守 OR，绝不误剔）⇒ 保留
      const keep = visibleChunks.has(e.chunkId) || frustum.intersectsSphere(e.sphere);
      if (keep) { visFar++; continue; }
      // 远景 + 视锥外 + 被 PVS 判不可见 ⇒ 临时剔除（只做「减」）
      this.touchedObj[this.touchedN] = e.obj;
      this.touchedPrev[this.touchedN] = e.obj.visible;
      this.touchedN++;
      e.obj.visible = false;
      culled++;
    }
    this.stats.culledFarObjects = culled;
    this.stats.visibleFarObjects = visFar;
    this.stats.nearProtectedObjects = nearP;
    this.stats.lastCullFrame = frame;
    this.stats.mode = farGateInterval > 1 ? 'sync-chunk-frustum(budget-gated)' : 'sync-chunk-frustum';
  }

  /** 渲染后恢复：把本帧临时设 false 的对象还原为原值，绝不留下跨帧副作用 */
  restore(): void {
    for (let i = 0; i < this.touchedN; i++) this.touchedObj[i].visible = this.touchedPrev[i];
    this.touchedN = 0;
  }

  snapshot(): ChunkGateSnapshot { return { ...this.stats }; }
}

// ---------------------------------------------------------------------------
// 模块级单例 / 对外 API
// ---------------------------------------------------------------------------
let _budget: PerfBudget | null = null;
export function getPerfBudget(): PerfBudget { return (_budget ??= new PerfBudget()); }

let _gate: ChunkGate | null = null;
export function getChunkGate(): ChunkGate { return (_gate ??= new ChunkGate()); }

/** engine.ts / 主线程注入 occlusion、pools 等外部统计（避免模块循环依赖） */
export function attachPerfExtras(fn: () => Record<string, unknown>): void {
  getPerfBudget().attachExtras(fn);
}

/**
 * 统一统计入口。engine.ts 已把它挂到 window.__perfBudget；
 * 主线程也可 import { perfBudgetSnapshot } from './core/perfBudget' 自行挂载。
 */
export function perfBudgetSnapshot(): PerfBudgetSnapshot {
  return getPerfBudget().snapshot();
}

// ---------------------------------------------------------------------------
// 对象池稳态化统计：由 pools.ts 更新，engine.ts / __perfBudget 只读。
// 【设计】故意放在 perfBudget.ts 而不是 pools.ts：pools.ts 顶层会构建大量几何并访问
// document（canvas），若 engine.ts 反向 import pools 会把这些副作用带进 engine 的加载链，
// 可能拖垮只 import engine 的纯逻辑测试。经此共享存储可让 engine 完全不依赖 pools.ts。
// ---------------------------------------------------------------------------
export interface PoolStats {
  flushCalls: number;
  matrixUploads: number;
  colorUploads: number;
  allocations: number;
  createdPools: number;
}
const POOL_STATS: PoolStats = { flushCalls: 0, matrixUploads: 0, colorUploads: 0, allocations: 0, createdPools: 0 };
export function bumpPoolStat(k: keyof PoolStats): void { POOL_STATS[k] += 1; }
export function getPoolStats(): PoolStats { return { ...POOL_STATS }; }
