// ============================================================================
// 体素网格渲染（P1-2 · D3 落地）· src/game/voxelMesh.ts
//
// per-face culling：只生成与空气相邻的面，逐面按方块色写 vertexColors。
// 重建策略 V0：放/拆后全区重建（48×48×24 遍历 ~30ms 单帧尖峰，离散事件可接受；
// chunk 级增量重建是 P1-2 后续优化——账本已记）。
// ============================================================================
import * as THREE from 'three';
import { BLOCK_COLORS, VOX, voxelStore } from '../rt/voxelStore';

const SOLID = (x: number, y: number, z: number): boolean => voxelStore.get(x, y, z) > 0;

/** 重建全区体素网格（挂 scene；返回 mesh 供 raycast） */
export function buildVoxelMesh(scene: THREE.Scene): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.name = 'voxel-workshop';
  mesh.frustumCulled = false;                    // 区块重建频繁，包围盒交给全量重建时的 compute
  rebuildVoxelMesh(mesh);
  scene.add(mesh);
  return mesh;
}

/** 放/拆后调用：清 geometry 重建（避免 dispose 竞态，直接覆盖 attribute） */
export function rebuildVoxelMesh(mesh: THREE.Mesh): void {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idc: number[] = [];
  const pushFace = (
    gx: number, gy: number, gz: number,
    // 四角偏移（逆时针，法线朝外）
    c0: [number, number, number], c1: [number, number, number], c2: [number, number, number], c3: [number, number, number],
    n: [number, number, number], t: number,
  ): void => {
    const ox = VOX.ox, oy = VOX.oy, oz = VOX.oz;
    const base = pos.length / 3;
    for (const c of [c0, c1, c2, c3]) pos.push(ox + gx + c[0], oy + gy + c[1], oz + gz + c[2]);
    for (let i = 0; i < 4; i++) nor.push(n[0], n[1], n[2]);
    const col3 = new THREE.Color(BLOCK_COLORS[t - 1]);
    // 微调明暗制造面差（顶面亮、底面暗、侧面中），单色 Lambert 下保留体积感
    const k = n[1] > 0.5 ? 1.0 : n[1] < -0.5 ? 0.62 : n[0] !== 0 ? 0.86 : 0.74;
    for (let i = 0; i < 4; i++) col.push(col3.r * k, col3.g * k, col3.b * k);
    idc.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let y = 0; y < VOX.ny; y++) {
    for (let z = 0; z < VOX.nz; z++) {
      for (let x = 0; x < VOX.nx; x++) {
        const t = voxelStore.get(x, y, z);
        if (t === 0) continue;
        if (!SOLID(x + 1, y, z)) pushFace(x, y, z, [1,0,0],[1,1,0],[1,1,1],[1,0,1], [1,0,0], t);
        if (!SOLID(x - 1, y, z)) pushFace(x, y, z, [0,0,1],[0,1,1],[0,1,0],[0,0,0], [-1,0,0], t);
        if (!SOLID(x, y + 1, z)) pushFace(x, y, z, [0,1,1],[1,1,1],[1,1,0],[0,1,0], [0,1,0], t);
        if (!SOLID(x, y - 1, z)) pushFace(x, y, z, [0,0,0],[1,0,0],[1,0,1],[0,0,1], [0,-1,0], t);
        if (!SOLID(x, y, z + 1)) pushFace(x, y, z, [1,0,1],[1,1,1],[0,1,1],[0,0,1], [0,0,1], t);
        if (!SOLID(x, y, z - 1)) pushFace(x, y, z, [0,0,0],[0,1,0],[1,1,0],[1,0,0], [0,0,-1], t);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idc);
  g.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = g;
}
