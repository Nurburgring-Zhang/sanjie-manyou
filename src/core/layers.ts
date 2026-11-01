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
