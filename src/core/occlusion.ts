import * as THREE from 'three';
import { PERF_NEAR_GUARD, type GateEntry } from './perfBudget';

/**
 * ============================================================================
 * occlusion.ts — WebGL2 遮挡查询检测 + PVS 潜在可见集粗判
 * ============================================================================
 *
 * 【如实标注】
 * - WebGL2 提供 ANY_SAMPLES_PASSED / ANY_SAMPLES_PASSED_CONSERVATIVE 的 occlusion query，
 *   EXT_disjoint_timer_query_webgl2 提供 disjoint 判定。本模块会【真实检测】这些能力。
 * - 但本工程【未把 occlusion query 接线到主渲染】，原因如实如下：
 *   ① 一次 query 需要为区块绘制 proxy 几何（额外 draw call），与「不得新增常驻
 *      draw call 数量级」冲突；
 *   ② query 需用 depth-only 材质绕开 EffectComposer 的 RenderPass/bloom/OutputPass，
 *      并与 logarithmicDepthBuffer 的深度写入状态交互，容易污染主渲染 GL 状态；
 *   ③ 读 QUERY_RESULT 需跨帧异步、处理 GPU disjoint，软渲染(swiftshader)下常不可用。
 *   综上，即使 query 扩展可用，也【降级为 CPU 侧 PVS 粗判】（mode='pvs'）。
 * - 扩展不可用 => 同样的 PVS 降级（mode='pvs'），不影响中近景。
 *
 * PVS 做的事（保守、绝不误剔中近景）：
 * - 以「区块」为单位，用视锥 + 远平面 + 可选遮挡体射线，算出「潜在可见区块集合」。
 * - dist ≤ PERF_NEAR_GUARD 的区块无条件判可见（中近景保护）。
 * - perfBudget.ChunkGate 用这个集合对【远景】对象做门控；中近景每帧全量。
 * ============================================================================
 */

export type OcclusionMode = 'occlusion-query' | 'pvs';

export interface OcclusionSnapshot {
  mode: OcclusionMode;
  queryWired: boolean;
  degradeReason: string;
  webgl2: boolean;
  timerQueryExtAvailable: boolean;
  anySamplesPassed: boolean;
  occluders: number;
  chunksTotal: number;
  chunksVisible: number;
  chunksRejected: number;
  nearProtectedChunks: number;
  queriesIssued: number;
  pvsRecomputes: number;
  frames: number;
}

export class OcclusionCuller {
  mode: OcclusionMode = 'pvs';
  readonly queryWired = false;
  readonly degradeReason =
    'occlusion query 需额外 proxy draw call 且会污染 EffectComposer/logarithmicDepthBuffer 的 GL 状态，' +
    '如实降级为 CPU 侧 PVS 粗判（视锥+远平面+遮挡体射线）';
  webgl2 = false;
  timerQueryExtAvailable = false;
  anySamplesPassed = false;
  private occluders: THREE.Box3[] = [];
  private readonly ray = new THREE.Ray();
  private readonly hit = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private visible = new Set<number>();
  private all = new Set<number>();
  private nearProtected = new Set<number>();
  private rejected = 0;
  private frames = 0;
  private queriesIssued = 0;
  private hasResult = false;
  private pvsRecomputes = 0;

  /** 由 engine 用 renderer.getContext() 调用：真实检测 GL 能力，但结果只用于如实标注 */
  detect(gl: unknown): void {
    const g = gl as {
      getExtension?: (n: string) => unknown;
      createQuery?: () => unknown;
      ANY_SAMPLES_PASSED?: number;
    } | null;
    if (!g || typeof g !== 'object') return;
    this.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && typeof g.createQuery === 'function';
    this.anySamplesPassed = typeof g.ANY_SAMPLES_PASSED === 'number';
    try {
      this.timerQueryExtAvailable = !!(g.getExtension && g.getExtension('EXT_disjoint_timer_query_webgl2'));
    } catch {
      this.timerQueryExtAvailable = false;
    }
    // 即便能力齐备也不接线：见文件头「如实标注」。mode 恒为 'pvs'。
    this.mode = 'pvs';
  }

  /** 可选：登记已知遮挡体（Box3，世界空间）。默认不登记 => PVS 退化为纯视锥粗判 */
  registerOccluder(box: THREE.Box3): void { this.occluders.push(box); }
  clearOccluders(): void { this.occluders.length = 0; }

  /** 相机→目标 的视线是否被「比目标更近」的遮挡体挡住 */
  private isOccluded(camPos: THREE.Vector3, target: THREE.Vector3): boolean {
    if (this.occluders.length === 0) return false;
    this.dir.subVectors(target, camPos);
    const dist = this.dir.length();
    if (dist < 1e-4) return false;
    this.dir.multiplyScalar(1 / dist);
    this.ray.set(camPos, this.dir);
    for (const box of this.occluders) {
      if (!this.ray.intersectBox(box, this.hit)) continue;
      if (this.hit.distanceTo(camPos) < dist - Math.max(1, dist * 0.02)) return true;
    }
    return false;
  }

  /**
   * 每帧粗判，返回「潜在可见区块集合」。
   * @param entries ChunkGate 收集到的对象（只读其 sphere / chunkId）
   * @param far 相机远平面（只做保守裁剪，绝不改 camera.far）
   */
  beginFrame(frustum: THREE.Frustum, camPos: THREE.Vector3, entries: readonly GateEntry[],
             far: number, recompute = true): Set<number> {
    this.frames++;
    // 帧预算降频：saver 档可隔帧重算 PVS，中间帧复用上次结果（省 CPU）。
    // ChunkGate.apply 仍用【当前帧】frustum 的 sphere 测试做保守 OR 保底，
    // 因此缓存滞后一帧也绝不会误剔中近景 / 视锥内对象。
    if (!recompute && this.hasResult) return this.visible;
    this.pvsRecomputes++;
    this.all.clear();
    this.visible.clear();
    this.nearProtected.clear();
    this.rejected = 0;
    const effectiveFar = Number.isFinite(far) && far > 0 ? far : 52000;
    for (const e of entries) {
      const c = e.sphere.center;
      const d = c.distanceTo(camPos);
      this.all.add(e.chunkId);
      // 中近景保护：≤ 400m 的区块无条件可见，ChunkGate 也不会剔除其对象
      if (d <= PERF_NEAR_GUARD) {
        this.nearProtected.add(e.chunkId);
        this.visible.add(e.chunkId);
        continue;
      }
      const inFrustum = frustum.intersectsSphere(e.sphere);
      const withinFar = d <= effectiveFar;
      const occluded = inFrustum && withinFar && this.isOccluded(camPos, c);
      if (inFrustum && withinFar && !occluded) this.visible.add(e.chunkId);
      else this.rejected++;
    }
    this.hasResult = true;
    // 未接线 query：queriesIssued 恒为 0（如实）
    return this.visible;
  }

  /** 预留：若未来接线 query，在此推进异步结果；当前为空操作 */
  endFrame(): void { /* query 未接线，无异步结果需推进 */ }

  snapshot(): OcclusionSnapshot {
    return {
      mode: this.mode,
      queryWired: this.queryWired,
      degradeReason: this.degradeReason,
      webgl2: this.webgl2,
      timerQueryExtAvailable: this.timerQueryExtAvailable,
      anySamplesPassed: this.anySamplesPassed,
      occluders: this.occluders.length,
      chunksTotal: this.all.size,
      chunksVisible: this.visible.size,
      chunksRejected: this.rejected,
      nearProtectedChunks: this.nearProtected.size,
      queriesIssued: this.queriesIssued,
      pvsRecomputes: this.pvsRecomputes,
      frames: this.frames,
    };
  }
}

let _occ: OcclusionCuller | null = null;
export function getOcclusion(): OcclusionCuller { return (_occ ??= new OcclusionCuller()); }
