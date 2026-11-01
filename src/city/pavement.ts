import * as THREE from 'three';
import { RNG } from '../core/rng';
import { Baker, shade } from './bake';
import { terrainSurfaceY } from '../world/terrain';
import { STREETS_H, STREETS_V, PLAZAS } from './props';

// ============ 地坪细节层（ISS-31）：石板铺装实例化 + 坊区大尺度色斑 ============
// 高空视角下大地坪被雾与 mipmap 平均成整片同色；本层在两个尺度补回真实变化：
//  1) pave_slab —— 街道/广场/院落石板（2-3m，近景铺装 + 高空高频色斑）
//  2) pave_patch —— 坊区大块微差色斑（90-180m，低对比、矩形随坊，高空可读的区块层次）
// 全部静态一次写入，两个 draw call；不参与物理（physics 高度场不受影响）。

const SLAB_H = 0.05;

function slabTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  // 石板底：中调暖灰 + 细碎晶斑
  ctx.fillStyle = '#b0a48c'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${140 + Math.random() * 90 | 0},${130 + Math.random() * 80 | 0},${108 + Math.random() * 66 | 0},${0.14 + Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 2.4);
  }
  // 磨亮心 + 磨边暗缝（阶石被踩出的包浆）
  const g = ctx.createRadialGradient(128, 128, 30, 128, 128, 150);
  g.addColorStop(0, 'rgba(226,214,186,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(52,42,30,0.72)'; ctx.lineWidth = 7; ctx.strokeRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(52,42,30,0.3)'; ctx.lineWidth = 14; ctx.strokeRect(0, 0, 256, 256);
  // 裂纹
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = 'rgba(60,50,38,0.4)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    let x = 30 + Math.random() * 196, y = 30 + Math.random() * 196;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // 法线：中心凸起、边缘凹缝（解析高度场）
  const nc = document.createElement('canvas'); nc.width = nc.height = 128;
  const nctx = nc.getContext('2d')!;
  const img = nctx.createImageData(128, 128);
  const H = (x: number, y: number): number => {
    const dx = Math.min(x, 127 - x), dy = Math.min(y, 127 - y);
    const d = Math.min(dx, dy);
    return Math.min(1, d / 9); // 0 缝 → 1 面心
  };
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * 1.6;
    const ny = (H(x, y - 1) - H(x, y + 1)) * 1.6;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const i4 = (y * 128 + x) * 4;
    img.data[i4] = ((nx / len) * 0.5 + 0.5) * 255;
    img.data[i4 + 1] = ((ny / len) * 0.5 + 0.5) * 255;
    img.data[i4 + 2] = ((nz / len) * 0.5 + 0.5) * 255;
    img.data[i4 + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

// 石板色板：暖灰阶石（乘 instanceColor 的基白材质）。明度对齐街面渲染色调，靠微差出拼花
// 石板色板：同样按「受光后」定档。旧值 0xb0a288（线性 0.42）乘 3.2 的总光照会顶到 1.34 被裁掉，
// 石板缝/包浆全被白掉；压到 ~0.21 线性，受光后落在 0.67 一带，留得住缝与磨光。
const SLAB_COLORS = [0x7f7562, 0x756b59, 0x877c6a, 0x706755, 0x827861, 0x796f5e, 0x8b806f, 0x776d5b];
// 坊区色斑：对齐 groundTex 受光后的暖赭明度（~#c4a075），±6% 明度 + 微色相偏移
// 坊区色斑：**必须对齐「受光后的地平」而不是贴图本身**。
// 旧值 0xc2a173（线性 0.53）是按 groundTex 的亮赭估的，但地平实际是 顶点色 0x877959 × 贴图，
// 相乘后的反射率只有 ~0.11/0.06/0.015；色斑比地平亮 4 倍，再乘 3.2 的光照直接顶到 1.0 被裁掉，
// 于是整片地读成死白平面（实测 RGB 221/206/178、p05=210、p95=213），矩形硬接缝也跟着暴露。
const PATCH_COLORS = [0x5e4b2e, 0x64502f, 0x594628, 0x685334, 0x604c2c, 0x6a5535, 0x5c492b, 0x624e30];

export function buildPavement(scene: THREE.Scene, rng: RNG): void {
  const { map, normalMap } = slabTextures();
  const slabGeo = new THREE.BoxGeometry(1, SLAB_H, 1);
  const slabMat = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.88, metalness: 0.02 });
  const patchGeo = new THREE.BoxGeometry(1, 0.05, 1).translate(0, 0.025, 0);
  const patchMat = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0.0 });

  type Inst = { x: number; y: number; z: number; sx: number; sz: number; ry: number; c: number };
  const slabs: Inst[] = [];
  const addSlab = (x: number, y: number, z: number, sx: number, sz: number, c: number, ry = 0): void => {
    slabs.push({ x, y, z, sx, sz, ry, c });
  };
  const c4 = (): number => SLAB_COLORS[(rng.next() * SLAB_COLORS.length) | 0];

  // ---- 街面铺装（贴街面顶 0.11，石板凸出 4cm 成缘石质感；板间缝 ≤0.2m 免得高空成暗格） ----
  // 横向街：逐行错缝 + 板长随机，避免整条街对齐成大棋盘
  for (const st of STREETS_H) {
    const rows = Math.max(1, Math.floor(st.w / 2.1));
    for (let ri = 0; ri < rows; ri++) {
      const z = st.z - st.w / 2 + (ri + 0.5) * (st.w / rows) + rng.range(-0.1, 0.1);
      let x = st.x0 + 1.6 + rng.range(0, 2.6);
      while (x < st.x1 - 1) {
        const len = rng.range(2.3, 4.7);
        if (!rng.chance(0.05)) {
          addSlab(x + len / 2, 0.13, z, len - 0.12, st.w / rows - 0.14,
            rng.chance(0.09) ? 0x8a7f6c : c4(), rng.range(-0.03, 0.03));
        }
        x += len + 0.1;
      }
    }
  }
  for (const st of STREETS_V) {
    const rows = Math.max(1, Math.floor(st.w / 2.1));
    for (let ri = 0; ri < rows; ri++) {
      const x = st.x - st.w / 2 + (ri + 0.5) * (st.w / rows) + rng.range(-0.1, 0.1);
      let z = st.z0 + 1.6 + rng.range(0, 2.6);
      while (z < st.z1 - 1) {
        const len = rng.range(2.3, 4.7);
        if (!rng.chance(0.05)) {
          addSlab(x, 0.13, z + len / 2, st.w / rows - 0.14, len - 0.12,
            rng.chance(0.09) ? 0x8a7f6c : c4(), rng.range(-0.03, 0.03));
        }
        z += len + 0.1;
      }
    }
  }
  // 车辙：主街中线两侧被车轮磨出的浅槽（暗色贴地薄条，压在石板缝上）
  for (const st of STREETS_H) {
    for (const off of [-1.2, 1.2]) {
      addSlab((st.x0 + st.x1) / 2, 0.145, st.z + off, st.x1 - st.x0 - 4, 0.42, 0x9a8f7a);
    }
  }
  // ---- 市集广场 ----
  for (const pz of PLAZAS) {
    const cols = Math.max(1, Math.floor(pz.w / 3.6));
    for (let ci = 0; ci < cols; ci++) {
      for (let z = pz.z - pz.d / 2 + 1.4; z < pz.z + pz.d / 2 - 1; z += 2.7) {
        const x = pz.x - pz.w / 2 + (ci + 0.5) * (pz.w / cols) + rng.range(-0.2, 0.2);
        addSlab(x, 0.14, z + rng.range(-0.25, 0.25), pz.w / cols - 0.16, rng.range(2.4, 2.65), c4(), rng.range(-0.04, 0.04));
      }
    }
  }
  // ---- 两岸院落/空地散铺（避开河道 |z|<44 与岸坡） ----
  for (let i = 0; i < 900; i++) {
    const x = rng.range(-640, 640);
    const z = (rng.chance(0.5) ? 1 : -1) * rng.range(46, 412);
    if (rng.chance(0.22)) continue; // 夯土裸地
    addSlab(x + rng.range(-0.5, 0.5), 0.06, z + rng.range(-0.5, 0.5), rng.range(1.8, 2.9), rng.range(1.5, 2.4), c4(), rng.range(0, Math.PI));
  }

  // ---- 坊区色斑层（两岸，低对比中小块，叠出有机街区块面） ----
  const patches: Inst[] = [];
  for (const bank of [1, -1]) {
    for (let gx = 0; gx < 12; gx++) for (let gz = 0; gz < 6; gz++) {
      const cx = -650 + gx * 108 + rng.range(-40, 40);
      const cz = bank * (58 + gz * 62 + rng.range(-24, 24));
      if (Math.abs(cz) < 46) continue;
      patches.push({
        x: cx, y: rng.range(0.015, 0.035), z: cz,
        sx: rng.range(58, 122), sz: rng.range(40, 88), ry: 0,
        c: PATCH_COLORS[(rng.next() * PATCH_COLORS.length) | 0],
      });
    }
  }

  // ---- 实例化写入（静态，一次 flush） ----
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  const mk = (list: Inst[], geo: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow: boolean): void => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.name = name;
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = shadow;
    list.forEach((it, i) => {
      e.set(0, it.ry, 0); q.setFromEuler(e);
      m.compose(v.set(it.x, it.y, it.z), q, s.set(it.sx, 1, it.sz));
      im.setMatrixAt(i, m);
      im.setColorAt(i, col.setHex(it.c));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
  };
  mk(slabs, slabGeo, slabMat, 'pave_slab', true);
  mk(patches, patchGeo, patchMat, 'pave_patch', false);
}

// ============ WS-45 铺装分层 / 广场纹样 / 郊野土路 ============
// 三视角验收：广场与街道是一整片无层次的浅色平板。上方 pave_slab 只补了 2~3m 的高频石板
// 色差，视距一远就被 mipmap 平均成单色。本层不再增开 InstancedMesh，而是经 Baker 烘进既有
// ground / earth / ash 组：0 新增 draw call，与地坪同批出图。
//
// 竖直关系：薄件顶面按 6/8/10/14/20mm 五级阶梯排开（每级只出现一次，任意两层顶面不共面，
// 不会 z-fight）；底面一律落在石板顶或其下方，层间不留空腔：
//   石板顶：街道 0.155 / 广场 0.165（pave_slab）｜既有车辙带顶 0.170
//   板缝 6mm → 落叶 8mm → 车辙 10mm → 污渍 14mm → 广场纹样 20mm（均为高出石板顶的顶面高度）
//   散水带 / 石牙子 / 沙土堆 / 落叶片往下砌到地面层（0.11 / 0.12），任何角度都不露底。

/** 独立 LCG：铺装分层专用随机源。不消耗共享 rng，既有石板/树木/摊位布局逐字不变。 */
function pavingRnd(seed: number): { next: () => number; range: (a: number, b: number) => number; chance: (p: number) => boolean } {
  let s = seed >>> 0 || 1;
  const next = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  return { next, range: (a, b) => a + next() * (b - a), chance: (p) => next() < p };
}

const B_STREET = 0.155;      // 街道石板顶面
const B_PLAZA = 0.165;       // 广场石板顶面
const T_SEAM = 0.006;        // 板缝暗线厚
const T_LEAF = 0.008;        // 落叶/沙土薄片厚
const T_RUT = 0.010;         // 车辙厚
const T_STAIN = 0.014;       // 污渍斑厚
const T_MOTIF = 0.020;       // 广场纹样厚
const APRON_H = 0.057;       // 散水带：从地面层砌到纹样面，落地不悬空
const SEAM_W = 0.06;         // 板缝宽
const RUT_W = 0.45;          // 车辙宽
const APRON_W = 0.8;         // 散水带宽
const SEAM_C = 0x6f6555;
const MOTIF_C = 0x585550;    // 纹样石带：压暗的冷灰石。旧值 0x8f8b80（线性 0.27）× 3.2 总光照 = 0.86，
                             // ACES 后接近纯白，广场上读出几团"白椭圆斑"；压到 0.10 线性才是深灰石
const KERB_C = 0x655d4f;
// 石板中位色（SLAB_COLORS 均值），暗化层以此为基准算明度倍率
const PAVE_BASE = 0x7f7562;   // 与新 SLAB_COLORS 中位数对齐（旧值 0xb0a48c 是压爆前的老石板色）

// 郊野土路走向：与 infill.ts 的 COUNTRY_ROADS 同源。该常量未导出，此处按值镜像；
// 若 infill.ts 的道路走向变更，本表必须同步，否则车辙/蹄印会脱开路面。
const COUNTRY_ROADS_MIRROR: [number, number][][] = [
  [[5060, 0], [5320, -170], [5600, -420], [5790, -980], [5870, -1580]],
  [[-5060, 0], [-5320, 430], [-5560, 1120], [-5620, 1800]],
];

/**
 * 铺装分层总装：由 props.ts 的 buildGround 在既有地坪之后调用（与地坪同批烘焙）。
 * 只读 PLAZAS / STREETS_*，不写全局状态，不消耗共享 rng。
 */
export function buildPavementDetail(b: Baker): void {
  // 归因标签：铺装层打通 `ground.pavement`，与 props 的 ground.slabN/slabS 一起，
  // 让「找到那片近黑地坪是谁铺的」可以只查 assetAudit.detail，不必再反推顶点色。
  b.kit('ground.pavement', 1, 0);
  const r = pavingRnd(0x459e11);
  const rutC = shade(PAVE_BASE, 0.9);     // 车辙：明度 0.9×
  const apronC = shade(PAVE_BASE, 0.82);  // 散水带：比铺装深一档

  // ---- 1) 板缝暗线：沿石板阵列接缝，宽 0.06 ----
  // 街道：纵向缝落在行分界（rows/pitch 与 pave_slab 同源），横向缝按 2.9m 一道
  for (const st of STREETS_H) {
    const rows = Math.max(1, Math.floor(st.w / 2.1));
    const pitch = st.w / rows;
    const len = st.x1 - st.x0 - 3.2;
    const cx = (st.x0 + st.x1) / 2;
    for (let ri = 1; ri < rows; ri++) {
      const z = st.z - st.w / 2 + ri * pitch + r.range(-0.08, 0.08);
      b.box('earth', len, T_SEAM, SEAM_W, cx, B_STREET + T_SEAM / 2, z, SEAM_C);
    }
    for (let x = st.x0 + 1.8; x < st.x1 - 1.4; x += 2.9 + r.range(-0.35, 0.35)) {
      b.box('earth', SEAM_W, T_SEAM, st.w - 0.2, x, B_STREET + T_SEAM / 2, st.z, SEAM_C);
    }
  }
  for (const st of STREETS_V) {
    const rows = Math.max(1, Math.floor(st.w / 2.1));
    const pitch = st.w / rows;
    const len = st.z1 - st.z0 - 3.2;
    const cz = (st.z0 + st.z1) / 2;
    for (let ri = 1; ri < rows; ri++) {
      const x = st.x - st.w / 2 + ri * pitch + r.range(-0.08, 0.08);
      b.box('earth', SEAM_W, T_SEAM, len, x, B_STREET + T_SEAM / 2, cz, SEAM_C);
    }
    for (let z = st.z0 + 1.8; z < st.z1 - 1.4; z += 2.9 + r.range(-0.35, 0.35)) {
      b.box('earth', st.w - 0.2, T_SEAM, SEAM_W, st.x, B_STREET + T_SEAM / 2, z, SEAM_C);
    }
  }
  // 广场：列缝（cols 与 pave_slab 同源）+ 2.7m 横缝
  for (const pz of PLAZAS) {
    const cols = Math.max(1, Math.floor(pz.w / 3.6));
    const cw = pz.w / cols;
    const x0 = pz.x - pz.w / 2;
    const z0 = pz.z - pz.d / 2 + 1.4, z1 = pz.z + pz.d / 2 - 1;
    for (let ci = 1; ci < cols; ci++) {
      b.box('earth', SEAM_W, T_SEAM, z1 - z0, x0 + ci * cw + r.range(-0.1, 0.1),
        B_PLAZA + T_SEAM / 2, (z0 + z1) / 2, SEAM_C);
    }
    for (let z = z0 + 2.7; z < z1 - 0.6; z += 2.7) {
      b.box('earth', pz.w - 2.6, T_SEAM, SEAM_W, pz.x, B_PLAZA + T_SEAM / 2, z, SEAM_C);
    }
  }

  // ---- 2) 车辙：主街两道（南北主街 z=±52、西纵街 x=-238、东纵街 x=560），宽 0.45，明度 0.9× ----
  // 轨距 1.5m，落在 ±0.75：避开 pave_slab 既有的 ±1.2 / 0.42 宽土辙带（顶面 0.170），不重叠不遮挡
  for (const st of [STREETS_H[0], STREETS_H[1]]) {
    for (const off of [-0.75, 0.75]) {
      b.box('earth', st.x1 - st.x0 - 4, T_RUT, RUT_W, (st.x0 + st.x1) / 2,
        B_STREET + T_RUT / 2, st.z + off, rutC);
    }
  }
  for (const st of [STREETS_V[1], STREETS_V[8]]) {
    for (const off of [-0.75, 0.75]) {
      b.box('earth', RUT_W, T_RUT, st.z1 - st.z0 - 4, st.x + off,
        B_STREET + T_RUT / 2, (st.z0 + st.z1) / 2, rutC);
    }
  }

  // ---- 3) 踢脚/散水带：沿建筑街面墙脚一圈，宽 0.8，比铺装深一档 ----
  // 建筑沿街布置，街沿即墙脚线；沿街两侧各压一条，广场则沿四边各压一条。
  // 从地面层（街 0.11 / 广场 0.12）直砌到纹样面，外侧任何角度都不露底。
  for (const st of STREETS_H) {
    const len = st.x1 - st.x0 - 1.0;
    const cx = (st.x0 + st.x1) / 2;
    for (const s of [-1, 1]) {
      b.box('ground', len, APRON_H, APRON_W, cx, 0.11 + APRON_H / 2,
        st.z + s * (st.w / 2 - APRON_W / 2), apronC);
    }
  }
  for (const st of STREETS_V) {
    const len = st.z1 - st.z0 - 1.0;
    const cz = (st.z0 + st.z1) / 2;
    for (const s of [-1, 1]) {
      b.box('ground', APRON_W, APRON_H, len, st.x + s * (st.w / 2 - APRON_W / 2),
        0.11 + APRON_H / 2, cz, apronC);
    }
  }
  for (const pz of PLAZAS) {
    const oz = pz.d / 2 - APRON_W / 2, ox = pz.w / 2 - APRON_W / 2;
    b.box('ground', pz.w - APRON_W, APRON_H, APRON_W, pz.x, 0.12 + APRON_H / 2, pz.z - oz, apronC);
    b.box('ground', pz.w - APRON_W, APRON_H, APRON_W, pz.x, 0.12 + APRON_H / 2, pz.z + oz, apronC);
    b.box('ground', APRON_W, APRON_H, pz.d - APRON_W * 2, pz.x - ox, 0.12 + APRON_H / 2, pz.z, apronC);
    b.box('ground', APRON_W, APRON_H, pz.d - APRON_W * 2, pz.x + ox, 0.12 + APRON_H / 2, pz.z, apronC);
  }

  // ---- 4) 污渍斑：每 40m² 一处，半径 0.6~1.6，明度 0.8~0.9× ----
  // 10 边低盘当有机斑块（方盒会读成贴纸），随机转角打散阵列感；inset 保证整片落在石板上
  const stainField = (cx: number, cz: number, w: number, d: number, base: number, inset: number): void => {
    const iw = w - inset * 2, id = d - inset * 2;
    if (iw <= 0 || id <= 0) return;
    const n = Math.max(1, Math.round(w * d / 40));
    for (let i = 0; i < n; i++) {
      const x = cx + r.range(-iw / 2, iw / 2);
      const z = cz + r.range(-id / 2, id / 2);
      // 半径按剩余净宽收：窄街上斑块不许越过石板上沿（越过就是悬空）
      const rad = Math.min(r.range(0.6, 1.6), iw / 2, id / 2);
      if (rad < 0.25) continue;
      b.cyl('earth', rad, rad * r.range(0.88, 1.0), T_STAIN, 10, x, base + T_STAIN / 2, z,
        shade(PAVE_BASE, r.range(0.8, 0.9)), r.range(0, Math.PI * 2));
    }
  };
  // inset 2.4：≥ 最大半径 1.6 + 散水带 0.8，斑块不压到街沿散水带上（两者顶面仅差 2mm）
  for (const st of STREETS_H) stainField((st.x0 + st.x1) / 2, st.z, st.x1 - st.x0, st.w, B_STREET, 2.4);
  for (const st of STREETS_V) stainField(st.x, (st.z0 + st.z1) / 2, st.w, st.z1 - st.z0, B_STREET, 2.4);
  for (const pz of PLAZAS) stainField(pz.x, pz.z, pz.w, pz.d, B_PLAZA, 3.2);

  // ---- 5) 广场：中心铺装纹样 + 边缘石牙子 + 四角落叶/沙土堆 ----
  const LEAF_C = [0x8a7434, 0x7d6a2f, 0x9c8438, 0x6f5f28];
  const PILE_C = [0x6e6146, 0x655843, 0x76684f, 0x61543a];
  for (const pz of PLAZAS) {
    // 外框：距广场边 6m 起、带宽 3.2m 的方框（大尺度，远看压掉"一块白板"的观感）
    const OUT = 6.0, FB = 3.2;
    const ix = pz.w / 2 - OUT, iz = pz.d / 2 - OUT;
    if (ix > FB * 2 && iz > FB * 2) {
      const my = B_PLAZA + T_MOTIF / 2;
      b.box('ash', ix * 2, T_MOTIF, FB, pz.x, my, pz.z - iz + FB / 2, MOTIF_C);
      b.box('ash', ix * 2, T_MOTIF, FB, pz.x, my, pz.z + iz - FB / 2, MOTIF_C);
      b.box('ash', FB, T_MOTIF, iz * 2 - FB * 2, pz.x - ix + FB / 2, my, pz.z, MOTIF_C);
      b.box('ash', FB, T_MOTIF, iz * 2 - FB * 2, pz.x + ix - FB / 2, my, pz.z, MOTIF_C);

      // 中心方块：边长按外框内净空收，避免与外框共面重叠
      const innerHalf = Math.min(ix - FB, iz - FB);
      const ms = Math.max(4, Math.min(24, innerHalf * 2 - 2));
      const half = ms / 2, fw = 1.4;
      b.box('ash', ms, T_MOTIF, fw, pz.x, my, pz.z - half + fw / 2, MOTIF_C);
      b.box('ash', ms, T_MOTIF, fw, pz.x, my, pz.z + half - fw / 2, MOTIF_C);
      b.box('ash', fw, T_MOTIF, ms - fw * 2, pz.x - half + fw / 2, my, pz.z, MOTIF_C);
      b.box('ash', fw, T_MOTIF, ms - fw * 2, pz.x + half - fw / 2, my, pz.z, MOTIF_C);
      if (ms > 8) {
        const ds = Math.min(ms * 0.42, (half - fw - 0.4) * Math.SQRT2);
        b.box('ash', ds, T_MOTIF, ds, pz.x, my, pz.z, MOTIF_C, Math.PI / 4);
      }
      // 对角石带：外框内角再内缩 DIAG_INS 起（否则 2.6m 带宽的角部会压在方框上共面），
      // 射向中心、停在中方块外 1.2m；两端都不与外框/中心方块重叠
      const DIAG_W = 2.6, DIAG_INS = DIAG_W * 0.75;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx0 = pz.x + sx * (ix - FB - DIAG_INS), cz0 = pz.z + sz * (iz - FB - DIAG_INS);
        const vx = pz.x - cx0, vz = pz.z - cz0;
        const L = Math.hypot(vx, vz);
        const seg = L - half - 1.2;
        if (seg <= 0.8) continue;
        const ux = vx / L, uz = vz / L;
        b.box('ash', seg, T_MOTIF, DIAG_W, cx0 + ux * seg / 2, my, cz0 + uz * seg / 2,
          MOTIF_C, Math.atan2(-uz, ux));
      }
    }

    // 边缘石牙子：四边压条，从 0.02 直砌到 0.192，外侧地面再低也不露底
    const KB = 0.36;
    const KC = (0.02 + 0.192) / 2, KH = 0.192 - 0.02;
    b.box('ground', pz.w, KH, KB, pz.x, KC, pz.z - pz.d / 2 + KB / 2, KERB_C);
    b.box('ground', pz.w, KH, KB, pz.x, KC, pz.z + pz.d / 2 - KB / 2, KERB_C);
    b.box('ground', KB, KH, pz.d - KB * 2, pz.x - pz.w / 2 + KB / 2, KC, pz.z, KERB_C);
    b.box('ground', KB, KH, pz.d - KB * 2, pz.x + pz.w / 2 - KB / 2, KC, pz.z, KERB_C);

    // 四角落叶/沙土堆：土堆从广场地面 0.12 起砌（跨石板缝也不悬空），落叶薄片坐在石板上
    for (let ci = 0; ci < 4; ci++) {
      const sx = ci < 2 ? -1 : 1, sz = ci % 2 === 0 ? -1 : 1;
      const px = pz.x + sx * (pz.w / 2 - 3.2);
      const pzr = pz.z + sz * (pz.d / 2 - 3.0);
      b.cyl('earth', 0.5, 1.45, 0.24, 7, px, 0.24, pzr, PILE_C[ci], r.range(0, Math.PI * 2));
      // 落叶薄片：从广场地面 0.12 直砌到 B_PLAZA + T_LEAF，落在石板缝上也不会浮空
      const leafH = B_PLAZA + T_LEAF - 0.12;
      for (let k = 0; k < 8; k++) {
        const a = r.range(0, Math.PI * 2), rad = 0.9 + r.range(0, 1.6);
        b.box('earth', r.range(0.16, 0.3), leafH, r.range(0.1, 0.2),
          px + Math.cos(a) * rad, 0.12 + leafH / 2, pzr + Math.sin(a) * rad,
          LEAF_C[(r.next() * LEAF_C.length) | 0], r.range(0, Math.PI));
      }
    }
  }

  // ---- 6) 郊野土路：车辙加深 + 蹄印（小凹点） ----
  // 路面顶 = 相邻两点 terrainSurfaceY 均值 + 0.01（与 infill.ts buildRoad 同式）；
  // 既有土辙条 0.34 宽、顶面 top+0.038，本层压在它之上，不共面。
  const roadRutC = shade(0x6b5a3e, 0.92);
  const hoofC = shade(0x6b5a3e, 0.78);
  for (const pts of COUNTRY_ROADS_MIRROR) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 12));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const yaw = Math.atan2(-(z1 - z0), x1 - x0);
        const top = (terrainSurfaceY(x0, z0) + terrainSurfaceY(x1, z1)) * 0.5 + 0.01;
        const len = Math.hypot(x1 - x0, z1 - z0) + 0.6;
        const sy = Math.sin(yaw), cy = Math.cos(yaw);
        // 车辙核心：压在既有 0.34 宽土辙正中，0.14 宽更深的磨痕
        for (const o of [-0.82, 0.82]) {
          b.box('earth', len, 0.004, 0.14, mx + sy * o, top + 0.042, mz + cy * o, roadRutC, yaw);
        }
        // 蹄印：沿路面两侧错落的小凹点（每段至少 1 个，避免短段除零）
        const prints = Math.max(1, Math.round(len / 2.6));
        for (let h = 0; h < prints; h++) {
          const tt = (h + r.next() * 0.85) / prints;
          const px = x0 + (x1 - x0) * tt, pz2 = z0 + (z1 - z0) * tt;
          const o = (r.chance(0.5) ? 1 : -1) * r.range(0.25, 1.45);
          b.box('earth', 0.1, 0.004, 0.16, px + sy * o, top + 0.042, pz2 + cy * o,
            hoofC, yaw + r.range(-0.35, 0.35));
        }
      }
    }
  }
}
