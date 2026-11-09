/**
 * ============================================================================
 * culling.worker.ts — 离线「分块视锥剔除」Web Worker（纯计算，无 three 依赖）
 * ============================================================================
 *
 * 【如实标注：已实现，但未接线到主渲染循环】
 * - 本文件实现了「把一组区块 AABB 用 6 个视锥平面做相交测试，返回潜在可见区块 id」
 *   的纯函数与消息处理，可在 Worker 线程里跑，避免占用主线程。
 * - 未接线原因：
 *   ① 接线需要 `new Worker(new URL('./culling.worker.ts', import.meta.url), {type:'module'})`，
 *      属于构建配置范畴，而本任务【禁止修改 src/main.ts / package.json】，且并发构建期风险高；
 *   ② 当前分区实例规模（数百个空间桶）很小，主线程同步 ChunkGate 已足够，
 *      跨线程 postMessage 的结构化克隆反而可能抵消收益。
 * - 因此当前生效路径是 src/core/perfBudget.ts 的同步 ChunkGate；本文件作为
 *   可断言的「Worker 剔除方案」保留，主线程可在解除约束后直接接线 boxVisibleInFrustum。
 *
 * 【中近景保护】与主线程一致：dist ≤ nearGuard 的区块无条件判可见，Worker 不参与
 * 任何中近景剔除，也不改任何渲染属性。
 * ============================================================================
 */

/** 视锥平面：内侧满足 a*x + b*y + c*z + d >= 0 */
export interface CullPlane { a: number; b: number; c: number; d: number }
export interface ChunkBox {
  id: number;
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
}

/**
 * 标准 AABB vs 视锥：对每个平面取「正顶点」（离平面最远的角点），
 * 若正顶点仍在平面外侧则整个盒不可见。保守、不会误剔。
 */
export function boxVisibleInFrustum(box: ChunkBox, planes: readonly CullPlane[]): boolean {
  for (const p of planes) {
    // 沿平面法线方向最远的角点
    const px = p.a >= 0 ? box.cx + box.hx : box.cx - box.hx;
    const py = p.b >= 0 ? box.cy + box.hy : box.cy - box.hy;
    const pz = p.c >= 0 ? box.cz + box.hz : box.cz - box.hz;
    if (p.a * px + p.b * py + p.c * pz + p.d < 0) return false;
  }
  return true;
}

/** 纯函数：给定区块、视锥平面、相机位置与中近景保护半径，返回可见区块 id 列表 */
export function cullChunks(
  boxes: readonly ChunkBox[],
  planes: readonly CullPlane[],
  camX: number, camY: number, camZ: number,
  nearGuard: number,
): number[] {
  const out: number[] = [];
  for (const b of boxes) {
    const dx = b.cx - camX, dy = b.cy - camY, dz = b.cz - camZ;
    const distSq = dx * dx + dy * dy + dz * dz;
    // 中近景保护：无条件可见
    if (distSq <= nearGuard * nearGuard) { out.push(b.id); continue; }
    if (boxVisibleInFrustum(b, planes)) out.push(b.id);
  }
  return out;
}

export interface CullRequest {
  boxes: ChunkBox[];
  planes: CullPlane[];
  cam: [number, number, number];
  nearGuard: number;
}

// Worker 消息入口。用 `self as unknown as …` 避免在缺少 webworker lib 时产生类型错误；
// 本文件不被主线程 import，故不会产生给 window.onmessage 赋值的运行时副作用。
const ctx = self as unknown as {
  onmessage: ((e: { data: CullRequest }) => void) | null;
  postMessage: (v: number[]) => void;
};
if (ctx && typeof ctx === 'object') {
  ctx.onmessage = (e: { data: CullRequest }): void => {
    const { boxes, planes, cam, nearGuard } = e.data;
    ctx.postMessage(cullChunks(boxes, planes, cam[0], cam[1], cam[2], nearGuard));
  };
}

export {};
