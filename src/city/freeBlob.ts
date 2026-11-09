import * as THREE from 'three';
import type { Baker } from './bake';

/**
 * R24b —— 用户原话：「不规则圆草斑？？？就他妈不能是随机的任意不规则的形状吗？？？」
 *
 * 旧版 parks.r23OrganicMeadow / imperial.buildPalaceGroundFlora 的"有机草斑"其实只是
 * b.cyl(..., 7~9 边) 的**多边形圆盘**：外轮廓仍是圆，底下还垫一整块矩形 box 基底，
 * 俯瞰读作「方格 + 圆斑」的棋盘，不是自然地被。
 *
 * 本模块给出真正任意不规则的自由轮廓模板：
 *   · 顶点数 9~21 随机；角度非等分抖动（不是圆规等分）；
 *   · 半径 = 低频瓣 2~5 瓣 + 高频毛刺 + 1~3 个连续顶点的深凹（自然缺口） + 单顶点尖尾/枝杈；
 *   · 形状自带 0.55~1.45 的长宽比（团块 / 长条 / 扁片）；
 *   · 调用方再叠加独立的旋转 ry 与非等比 sx/sz，任意两块都不同。
 *
 * 工程约束（每一条都是踩过的坑）：
 *   1) 模板**必须带 index**。Baker.push 对 indexed 几何走 toNonIndexed() 生成副本，
 *      applyMatrix4 只作用于副本；若传无 index 的几何，push 会就地改写模板顶点，
 *      下一块就在上一次变换的基础上再变换一次 → 草斑会一路飞到天外。
 *   2) 绕序取 (中心, p[i+1], p[i])：XZ 平面里角度递增在俯视下是顺时针，反过来才朝 +Y。
 *      法线统一 (0,1,0)，不会被背面剔除成一张看不见的透明纸。
 *   3) 中心顶点抬高 0.024、边界顶点 y=0：Baker 的落地 AO 按 (y-wMinY)/wH 从 0.82→1.0，
 *      于是斑块中心亮、边缘自然压暗，避免整块被 0.82 乘成一层暗绿膜
 *      （ShapeGeometry 只有轮廓顶点，没有中心点，做不到这个梯度）。
 *   4) 模板只作几何源，从不进渲染器；push 对模板调用 dispose() 只是派发事件，
 *      不清除 CPU attributes，可安全复用十余万次，零临时 BufferGeometry 分配。
 *   5) 全部整数 hash 派生，零共享 RNG、不用 Math.random；UV 按局部世界尺寸重算。
 */

function h32(a: number, b: number): number {
  return (Math.imul(a ^ Math.imul(b, 0x9e3779b1), 2654435761) >>> 0) || 7;
}

function seq(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return (): number => {
    s = (Math.imul(s ^ (s >>> 13), 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

let CACHE: THREE.BufferGeometry[] | null = null;

/** 单位半径 ≈1 的自由轮廓几何模板；同一进程内只生成一次。 */
export function freeBlobGeometries(count = 32): THREE.BufferGeometry[] {
  if (CACHE && CACHE.length === count) return CACHE;
  const out: THREE.BufferGeometry[] = [];
  for (let t = 0; t < count; t++) {
    const rnd = seq(h32(0x51a7, t * 977 + 13));
    const n = 9 + Math.floor(rnd() * 13);            // 9~21 个轮廓顶点
    const lobes = 2 + Math.floor(rnd() * 4);          // 低频瓣数
    const phase = rnd() * Math.PI * 2;
    const notch = Math.floor(rnd() * n);              // 深凹起点
    const notchLen = 1 + Math.floor(rnd() * 3);       // 连续 1~3 个顶点被咬掉
    const tail = Math.floor(rnd() * n);               // 尖尾 / 枝杈
    const aspect = 0.55 + rnd() * 0.90;               // 形状自带长宽比

    const px: number[] = [], pz: number[] = [];
    for (let i = 0; i < n; i++) {
      // 抖动限制在 ±0.45 段内，保证相邻角度严格递增 → 极坐标单值 → 轮廓不自交、
      // 且形状相对中心是星形的，扇形三角化对任意深凹都严格有效。
      const a = (i + (rnd() - 0.5) * 0.9) * (Math.PI * 2 / n);
      let r = 1
        + 0.34 * Math.sin(lobes * a + phase)
        + 0.30 * (rnd() - 0.5) * 2;
      if (((i - notch + n) % n) < notchLen) r *= 0.30;
      if (i === tail) r *= 1.55;
      r = Math.max(0.18, Math.min(1.55, r));
      px.push(Math.cos(a) * r);
      pz.push(Math.sin(a) * r * aspect);
    }

    // 中心点 + n 个轮廓点；index 让 Baker.push 走副本路径，模板本身永不被就地改写
    const pos = new Float32Array((n + 1) * 3);
    const nor = new Float32Array((n + 1) * 3);
    const uv = new Float32Array((n + 1) * 2);
    pos[0] = 0; pos[1] = 0.024; pos[2] = 0;
    nor[1] = 1;
    for (let i = 0; i < n; i++) {
      const o = (i + 1) * 3;
      pos[o] = px[i]; pos[o + 1] = 0; pos[o + 2] = pz[i];
      nor[o + 1] = 1;
      uv[(i + 1) * 2] = px[i] * 0.24;
      uv[(i + 1) * 2 + 1] = pz[i] * 0.24;
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      idx.push(0, next + 1, i + 1);                   // (中心, p[i+1], p[i]) → +Y
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    out.push(geo);
  }
  CACHE = out;
  return out;
}

/**
 * 摆一块自由轮廓草斑。sx/sz 是半径尺度（不是直径），ry 是绕 Y 的旋转弧度。
 * 走既有 leaf 材质组 + Baker.addGeo 合批：0 新材质组 / 0 独立 Mesh / 0 draw call。
 */
export function putFreeBlob(
  b: Baker, geo: THREE.BufferGeometry, x: number, y: number, z: number,
  hex: number, ry: number, sx: number, sz: number,
): void {
  b.addGeo('leaf', geo, x, y, z, hex, ry, 0, 0, sx, 1, sz);
}
