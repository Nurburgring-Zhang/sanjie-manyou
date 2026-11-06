// ============================================================================
// 体素 chunk 渲染（P1-2 主体）· src/game/voxelMesh.ts
//
// chunk 增量重建：8×8 格一片（48/8=6×6=36 片），放/拆只重建所在 chunk（+贴边邻块），
// 消掉旧版全区 30ms 尖峰。功能方块分组：琉璃(5)=glow 自发光、玄墨(8)=半透明。
// API：new VoxelChunkMeshes(scene) 构建全区；onVoxelChange(gx,gz) 放/拆后增量；
//      保留 rebuildVoxelMesh(mesh) 兼容旧调用（全区重建+单 mesh——不再使用）。
// ============================================================================
import * as THREE from 'three';
import { BLOCK_COLORS, VOX, voxelStore } from '../rt/voxelStore';

const CHUNK = 8;
const CHUNKS_X = Math.ceil(VOX.nx / CHUNK);   // 6
const CHUNKS_Z = Math.ceil(VOX.nz / CHUNK);   // 6

const SOLID = (x: number, y: number, z: number): boolean => voxelStore.get(x, y, z) > 0;

export class VoxelChunkMeshes {
  private meshes = new Map<string, THREE.Mesh>();
  readonly root: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'voxel-workshop';
    scene.add(this.root);
    for (let cz = 0; cz < CHUNKS_Z; cz++)
      for (let cx = 0; cx < CHUNKS_X; cx++) this.rebuildChunk(cx, cz);
    // 功能组材质差异（一次性）
    const glow = this.meshes.get('glow');
    if (glow) (glow.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x354d44);
    const glass = this.meshes.get('glass');
    if (glass) {
      (glass.material as THREE.MeshLambertMaterial).transparent = true;
      (glass.material as THREE.MeshLambertMaterial).opacity = 0.55;
    }
  }

  private meshFor(key: string): THREE.Mesh {
    let m = this.meshes.get(key);
    if (!m) {
      m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.name = `voxel-${key}`;
      this.root.add(m);
      this.meshes.set(key, m);
    }
    return m;
  }

  /** 收集一个 chunk 的面（group=main 全部实体 / glow 琉璃 / glass 玄墨） */
  private collectChunk(cx: number, cz: number, group: 'main' | 'glow' | 'glass', pos: number[], nor: number[], col: number[], idc: number[]): void {
    const pushFace = (
      gx: number, gy: number, gz: number,
      c0: [number, number, number], c1: [number, number, number], c2: [number, number, number], c3: [number, number, number],
      n: [number, number, number], t: number, k: number,
    ): void => {
      const base = pos.length / 3;
      for (const c of [c0, c1, c2, c3]) pos.push(VOX.ox + gx + c[0], VOX.oy + gy + c[1], VOX.oz + gz + c[2]);
      for (let i = 0; i < 4; i++) nor.push(n[0], n[1], n[2]);
      const c3v = new THREE.Color(BLOCK_COLORS[t - 1]);
      for (let i = 0; i < 4; i++) col.push(c3v.r * k, c3v.g * k, c3v.b * k);
      idc.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let y = 0; y < VOX.ny; y++) {
      for (let gz = z0; gz < Math.min(VOX.nz, z0 + CHUNK); gz++) {
        for (let gx = x0; gx < Math.min(VOX.nx, x0 + CHUNK); gx++) {
          const t = voxelStore.get(gx, y, gz);
          if (t === 0) continue;
          const want = group === 'main' ? (t !== 5 && t !== 8) : group === 'glow' ? t === 5 : t === 8;
          if (!want) continue;
          const k = group === 'glow' ? 1.15 : 1;
          if (!SOLID(gx + 1, y, gz)) pushFace(gx, y, gz, [1,0,0],[1,1,0],[1,1,1],[1,0,1], [1,0,0], t, k * 0.86);
          if (!SOLID(gx - 1, y, gz)) pushFace(gx, y, gz, [0,0,1],[0,1,1],[0,1,0],[0,0,0], [-1,0,0], t, k * 0.86);
          if (!SOLID(gx, y + 1, gz)) pushFace(gx, y, gz, [0,1,1],[1,1,1],[1,1,0],[0,1,0], [0,1,0], t, k);
          if (!SOLID(gx, y - 1, gz)) pushFace(gx, y, gz, [0,0,0],[1,0,0],[1,0,1],[0,0,1], [0,-1,0], t, k * 0.62);
          if (!SOLID(gx, y, gz + 1)) pushFace(gx, y, gz, [1,0,1],[1,1,1],[0,1,1],[0,0,1], [0,0,1], t, k * 0.74);
          if (!SOLID(gx, y, gz - 1)) pushFace(gx, y, gz, [0,0,0],[0,1,0],[1,1,0],[1,0,0], [0,0,-1], t, k * 0.74);
        }
      }
    }
  }

  private apply(key: string, pos: number[], nor: number[], col: number[], idc: number[]): void {
    const m = this.meshFor(key);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idc);
    g.computeBoundingSphere();
    m.geometry.dispose();
    m.geometry = g;
  }

  rebuildChunk(cx: number, cz: number): void {
    for (const group of ['main', 'glow', 'glass'] as const) {
      const pos: number[] = [], nor: number[] = [], col: number[] = [], idc: number[] = [];
      this.collectChunk(cx, cz, group, pos, nor, col, idc);
      this.apply(`${group}-c${cx}_${cz}`, pos, nor, col, idc);
    }
  }

  rebuildGroup(group: 'glow' | 'glass'): void {
    for (let cz = 0; cz < CHUNKS_Z; cz++) for (let cx = 0; cx < CHUNKS_X; cx++) this.rebuildChunk(cx, cz);
    void group;
  }

  /** 放/拆入口：重建所在 chunk + 贴边邻 chunk（角部双轴贴边含对角） */
  onVoxelChange(gx: number, gz: number): void {
    const cx = Math.floor(gx / CHUNK), cz = Math.floor(gz / CHUNK);
    const rebuilds: [number, number][] = [[cx, cz]];
    const lx = gx % CHUNK, lz = gz % CHUNK;
    if (lx === 0 && cx > 0) rebuilds.push([cx - 1, cz]);
    if (lx === CHUNK - 1 && cx < CHUNKS_X - 1) rebuilds.push([cx + 1, cz]);
    if (lz === 0 && cz > 0) rebuilds.push([cx, cz - 1]);
    if (lz === CHUNK - 1 && cz < CHUNKS_Z - 1) rebuilds.push([cx, cz + 1]);
    if ((lx === 0 || lx === CHUNK - 1) && (lz === 0 || lz === CHUNK - 1)) {
      const ncx = lx === 0 ? cx - 1 : cx + 1;
      const ncz = lz === 0 ? cz - 1 : cz + 1;
      if (ncx >= 0 && ncx < CHUNKS_X && ncz >= 0 && ncz < CHUNKS_Z) rebuilds.push([ncx, ncz]);
    }
    for (const [ccx, ccz] of rebuilds) {
      if (ccx < 0 || ccx >= CHUNKS_X || ccz < 0 || ccz >= CHUNKS_Z) continue;
      this.rebuildChunk(ccx, ccz);
    }
  }
}

/** 放/拆增量入口（buildMode 调用） */
let chunkMeshes: VoxelChunkMeshes | null = null;
export function initVoxelMeshes(scene: THREE.Scene): VoxelChunkMeshes {
  chunkMeshes = new VoxelChunkMeshes(scene);
  return chunkMeshes;
}
export function onVoxelChanged(gx: number, gz: number): void {
  chunkMeshes?.onVoxelChange(gx, gz);
}

/** 兼容旧调用（world.ts buildVoxelMesh）——创建 chunk 化网格并返回 root */
export function buildVoxelMesh(scene: THREE.Scene): THREE.Group {
  chunkMeshes = new VoxelChunkMeshes(scene);
  return chunkMeshes.root;
}

/** 兼容旧调用（重建全区） */
export function rebuildVoxelMesh(_mesh: THREE.Mesh): void {
  if (chunkMeshes) for (let cz = 0; cz < CHUNKS_Z; cz++) for (let cx = 0; cx < CHUNKS_X; cx++) chunkMeshes.rebuildChunk(cx, cz);
}
