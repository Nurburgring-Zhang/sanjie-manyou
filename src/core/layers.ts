import type * as THREE from 'three';

/**
 * 水面反射 pass 的图层分流。
 *
 * `world.ts` 里的 Reflector 会用**同一份 scene** 再从镜像相机渲染一遍 —— 也就是把整场
 * 再提交一次（实测六个机位各 ~220–245 次 draw call，占峰值的三到四成）。反射目标是 512²
 * 的贴图、覆盖的是一块 120×40m 的水面：**每像素约 0.23m**，任何小于 1m 的构件在反射里
 * 连一个像素都铺不满。把这类东西标到第 1 层即可：
 *
 *   - 主相机开 0|1 两层 —— 主画面照旧一件不少；
 *   - Reflector 的虚拟相机保持默认（只测第 0 层）—— 反射里自动跳过这些小件；
 *   - 太阳的阴影相机也开 1 层 —— 否则被打了标的角色会连影子一起消失。
 *
 * 注意是 `layers.set(1)` 而不是 `enable(1)`：`enable` 只会让它在反射里也出现。
 */
export const LAYER_NO_REFLECT = 1;

/** 只在主相机里出现的对象（不进水面反射，但影子照旧） */
export function noReflect(obj: THREE.Object3D): void {
  obj.layers.set(LAYER_NO_REFLECT);
}

/**
 * 静态合批网格的「空间分块索引」标记（perfBudget.ChunkGate 只统计、不剔除）。
 *
 * Baker.flush 产出的 city_* 网格是【跨全城大网格】，包围盒/包围球覆盖全城，
 * frustumCulled 基本失效——因此【不能】简单粗暴打开 frustumCulled 就宣称优化。
 * 这里只把「该 batch 覆盖了多少空间区块 / 包围球」记进 userData，作为可断言的
 * 分块索引事实（window.__perfBudget().chunkGate.staticChunks / staticIndexedMeshes）。
 * 真正的对象级剔除只作用于带精确包围球的空间分块 InstancedMesh（见 perfBudget.ts）。
 *
 * 该标记不改 mesh 命名、不改渲染层、不新增 draw call、不改 Baker 公共接口。
 */
export function tagStaticChunk(obj: THREE.Object3D, chunks: number,
                               center: THREE.Vector3, radius: number): void {
  (obj.userData as Record<string, unknown>).perfStaticChunk = { chunks, center, radius };
}
