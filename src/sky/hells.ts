import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade, BGroup } from '../city/bake';
import { roofOn } from '../city/buildings';
import {
  UNDER, INP, inFloor, inPaveLines, inSteps, inWall, inSkirt, inLattice, inVeil, inDoor, inWindow, inCeil,
  inDesk, inDeskTop, inRack, inChainStake, inChain, inLamp, inAltar, inCushion, inSealBox, inScrolls,
  inTable, inBench, inStool, inCauldron, inStove, inJar, inBowlRack, inIronBed, inPallet, inChainRing, inLantern,
  hellLampPost, hellFireBowl, hellSoulLantern,
} from './underworld';

// ============ B2：十八狱逐狱装置 + 阎罗殿法庭内饰 + 孟婆庄（46 卷 §4 + 47 卷 §八/§十） ============
// 纪律：地府禁霓虹禁金阶；光色三系 磷绿 #3DFF9C / 演出红 #FF3A4A / 青白 #BAFFEF；最深色 #2B1B3D

const IRON = 0x26282c, COPPER = 0xb87333, RUST = 0x6e1f1f, BANNER = 0x2b1b3d, BONE = 0xe8e3d5;
const PHOS = 0x3dff9c, RED = 0xff3a4a, ICEC = 0xbaffef, MIST = 0x57534e, BLACKB = 0x2e2420;

/** 46 卷 §4.2 逐狱十八行（绝对坐标 x,z；环心 (0,55) 半径 94-105 带，每 20°） */
const HELLS: { id: string; name: string; x: number; z: number; seals: number; heavy: boolean }[] = [
  { id: 'D-GZ-018', name: '拔舌獄', x: 17, z: -38, seals: 7, heavy: true },
  { id: 'D-GZ-019', name: '剪刀獄', x: 48, z: -27, seals: 4, heavy: false },
  { id: 'D-GZ-020', name: '鐵樹獄', x: 73, z: -6, seals: 4, heavy: false },
  { id: 'D-GZ-021', name: '孽鏡獄', x: 89, z: 22, seals: 3, heavy: false },
  { id: 'D-GZ-022', name: '蒸籠獄', x: 95, z: 55, seals: 7, heavy: true },
  { id: 'D-GZ-023', name: '銅柱獄', x: 89, z: 88, seals: 5, heavy: false },
  { id: 'D-GZ-024', name: '刀山獄', x: 73, z: 116, seals: 5, heavy: true },
  { id: 'D-GZ-025', name: '冰山獄', x: 48, z: 137, seals: 3, heavy: false },
  { id: 'D-GZ-026', name: '油鍋獄', x: 16, z: 149, seals: 7, heavy: true },
  { id: 'D-GZ-027', name: '牛坑獄', x: -16, z: 149, seals: 3, heavy: false },
  { id: 'D-GZ-028', name: '石壓獄', x: -48, z: 137, seals: 4, heavy: false },
  { id: 'D-GZ-029', name: '舂臼獄', x: -73, z: 116, seals: 4, heavy: false },
  { id: 'D-GZ-030', name: '血池獄', x: -89, z: 88, seals: 7, heavy: false },
  { id: 'D-GZ-031', name: '枉死獄', x: -95, z: 55, seals: 7, heavy: true },
  { id: 'D-GZ-032', name: '磔刑獄', x: -89, z: 22, seals: 5, heavy: false },
  { id: 'D-GZ-033', name: '火山獄', x: -73, z: -6, seals: 7, heavy: true },
  { id: 'D-GZ-034', name: '石磨獄', x: -48, z: -27, seals: 4, heavy: false },
  { id: 'D-GZ-035', name: '刀鋸獄', x: -17, z: -38, seals: 4, heavy: false },
];

/** 交叉双面焰舌：顶点色自根部 1.0 收到尖端 0.06 —— 尖端融进黑场自然消失，不依赖透明贴图与额外 draw call */
function tongueGeo(h: number, w: number, lean: number, spin: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const tri = (a: number[], b2: number[], c2: number[], ka: number, kb: number, kc: number): void => {
    pos.push(a[0], a[1], a[2], b2[0], b2[1], b2[2], c2[0], c2[1], c2[2]);
    col.push(ka, ka, ka, kb, kb, kb, kc, kc, kc);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  };
  for (const s of [0, Math.PI / 2]) {
    const cx = Math.cos(spin + s), cz = Math.sin(spin + s);
    const p = (u: number, yy: number): number[] => [cx * u + lean * yy * 0.4, yy, cz * u + lean * yy * 0.4];
    const a = p(-w * 0.5, 0), b2 = p(w * 0.5, 0), c2 = p(w * 0.06, h), d2 = p(-w * 0.06, h);
    tri(a, b2, c2, 1.0, 1.0, 0.08);
    tri(a, c2, d2, 1.0, 0.08, 0.08);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** 逐狱光色：每层一处自发光源（炉火 / 冰灯 / 血光 / 磷火），颜色按刑具性质分流，同层院内泛光同色 */
const HELL_TINT: readonly number[] = [
  0xff3a4a, 0x9ad8ff, 0xff5a5a, 0xffd9a0, 0xdfe8e0, 0xff6a1a, 0x3dff9c, 0xbaffef, 0xff7a2d,
  0xb08a4a, 0xb8c0c8, 0xd8c8a8, 0x8a1020, 0x6affc8, 0xff3a4a, 0xff5a12, 0xc8b8a0, 0x9ad8ff,
];

/** 逐狱场景装置（46 卷 §4.2 装置列）——v2：每层四类以上可数刑具 + 两类静态特效 + 一处自发光源。
 * 判据（用户原话「四个刑具判据」）：① 四类刑具可数；② 两类特效；③ 各层形制与配色一眼可分；
 * ④ 自发光源颜色按狱分流（油锅橙红 / 冰山青白 / 血池暗红 / 阿鼻近无光）。
 * 全部构件落在既有 Baker 材质组里，新增 draw call = 0。
 */
function device(b: Baker, i: number, x: number, y: number, z: number, ux: number, uz: number): void {
  const vx = -uz, vz = ux;
  const ry = Math.atan2(ux, uz);
  const at = (du: number, dv: number): [number, number] => [x + ux * du + vx * dv, z + uz * du + vz * dv];
  /** 局部件：du 沿狱门轴（朝环心为正）、dv 侧向、yy 世界高度 */
  const B = (g: BGroup, w: number, h: number, d: number, du: number, dv: number, yy: number, hex: number, r = ry, rx = 0, rz = 0): void => {
    const [px, pz] = at(du, dv);
    b.box(g, w, h, d, px, yy, pz, hex, r, rx, rz);
  };
  const C = (g: BGroup, rt: number, rb: number, h: number, seg: number, du: number, dv: number, yy: number, hex: number, r = ry, rx = 0, rz = 0, open = false): void => {
    const [px, pz] = at(du, dv);
    b.cyl(g, rt, rb, h, seg, px, yy, pz, hex, r, rx, rz, open);
  };
  /** 尖刺/刀锋：底半径 rb、高 hh，底面落在 yy */
  const S = (g: BGroup, rb: number, du: number, dv: number, yy: number, hh: number, hex: number, r = ry, sx = 1, sz = 1): void => {
    const [px, pz] = at(du, dv);
    b.pyramid(g, 0.012, rb, px, yy + hh / 2, pz, hex, r, sx, hh, sz);
  };
  /** 特效一·焰：n 枚交叉焰舌，顶端收到近黑 */
  const flame = (du: number, dv: number, yy: number, hh: number, w: number, hex: number, n = 6, spread = 0.7): void => {
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996;
      const rr = k === 0 ? 0 : spread * (0.45 + (k % 3) * 0.3);
      const [px, pz] = at(du + Math.cos(a) * rr, dv + Math.sin(a) * rr);
      b.addGeo('glow', tongueGeo(hh * (0.55 + (k % 4) * 0.17), w * (0.72 + (k % 3) * 0.22), Math.cos(a) * 0.55, a), px, yy, pz, hex);
    }
  };
  /** 特效·雾：贴地雾圈 + 一团悬浮雾晶。锥壳版会把刑具整个糊住（实测拔舌/血池只剩一块深色布），
   *  改成 5cm 贴地圆盘 + 十余枚悬浮雾块，既有体积感又不挡视线。 */
  const vapor = (du: number, dv: number, yy: number, r: number, hex: number, n = 10): void => {
    C('glow', r, r * 1.08, 0.05, 10, du, dv, yy + 0.05, shade(hex, 0.16), 0, 0, 0, true);
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, rr = r * (0.3 + ((k * 41) % 100) / 130);
      B('glow', 0.44, 0.26, 0.44, du + Math.cos(a) * rr, dv + Math.sin(a) * rr, yy + 0.3 + ((k * 23) % 90) / 100 * 1.5, shade(hex, 0.3 + (k % 3) * 0.08), a);
    }
  };
  /** 特效·颗粒（火星/尘/谷壳/冰晶）：小发光点 */
  const specks = (du: number, dv: number, yy: number, r: number, n: number, hex: number, size = 0.1, tall = 1.8): void => {
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, rr = r * (0.15 + ((k * 61) % 100) / 120);
      B('glow', size, size, size, du + Math.cos(a) * rr, dv + Math.sin(a) * rr, yy + ((k * 37) % 100) / 100 * tall, shade(hex, 0.72 + (k % 3) * 0.14));
    }
  };
  /** 特效·虫群：绕圈的小点，带微光 */
  const swarm = (du: number, dv: number, yy: number, r: number, n: number, hex: number): void => {
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, rr = r * (0.25 + ((k * 53) % 100) / 130);
      B('glow', 0.1, 0.08, 0.15, du + Math.cos(a) * rr, dv + Math.sin(a) * rr, yy + 0.12 + ((k * 29) % 100) / 100 * 1.7, k % 3 === 0 ? hex : shade(hex, 0.42), a);
    }
  };
  // ---- 通用构件 ----
  const post = (du: number, dv: number, h = 2.8, hex = 0x241c16): void => {
    B('ash', 0.86, 0.2, 0.86, du, dv, y + 0.1, shade(0x4e5860, 0.9));
    C('wood', 0.17, 0.22, h, 6, du, dv, y + 0.2 + h / 2, hex);
    C('metal', 0.26, 0.26, 0.1, 8, du, dv, y + 0.2 + h - 0.2, 0x8a8a92);
    for (let k = 0; k < 3; k++) B('metal', 0.13, 0.2, 0.07, du + 0.02, dv + (k % 2 ? 0.14 : -0.14), y + 0.9 + k * 0.4, 0x9a9aa2, ry + (k % 2 ? 0.5 : -0.5));
  };
  const bones = (du: number, dv: number, n: number, hex = BONE): void => {
    for (let k = 0; k < n; k++) {
      const a = k * 1.7;
      B('ash', 0.13, 0.5, 0.13, du + Math.cos(a) * 0.5, dv + Math.sin(a) * 0.4, y + 0.26, shade(hex, 0.55 + (k % 3) * 0.08), a);
      if (k % 2 === 0) B('ash', 0.28, 0.16, 0.16, du + Math.cos(a + 1) * 0.7, dv + Math.sin(a + 1) * 0.5, y + 0.14, shade(hex, 0.6));
    }
  };
  const coal = (du: number, dv: number, r: number, n: number, hex: number): void => {
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, rr = r * (0.2 + ((k * 43) % 100) / 110);
      B('wood', 0.3, 0.24, 0.3, du + Math.cos(a) * rr, dv + Math.sin(a) * rr, y + 0.12 + ((k * 31) % 100) / 100 * 0.35, k % 3 === 0 ? hex : shade(hex, 0.55), a);
    }
  };
  const trough = (du: number, dv: number, w: number, d: number, hex = 0x5c1018): void => {
    B('ash', w, 0.28, d, du, dv, y + 0.14, shade(0x3b424a, 0.9));
    B('glow', w - 0.34, 0.09, d - 0.3, du, dv, y + 0.26, hex);
  };
  const chainHang = (du: number, dv: number, top: number, len: number, hex = 0x8a8a92): void => {
    for (let k = 0; k < 5; k++) B('metal', 0.11, 0.22, 0.06, du, dv, top - k * (len / 5), hex, ry + (k % 2 ? 0.5 : -0.5));
  };

  switch (i) {
    case 0: { // 拔舌獄：巨铁钳 / 舌形石台 / 铁舌钩架 / 齿栅 / 缚柱
      const RUST2 = 0x8a1a1a;
      B('ash', 6.2, 0.6, 4.2, -1.4, 0, y + 0.3, shade(0x4e5860, 0.92));
      B('ash', 2.6, 0.5, 3.2, -1.4, 0, y + 0.85, shade(0x5a5450, 1.04));
      S('ash', 1.05, -1.4, 1.9, y + 1.09, 1.2, shade(0x5a5450, 1.1), ry, 1, 1.35);
      B('glow', 2.1, 0.07, 2.7, -1.4, 0, y + 1.12, RUST2);
      // 巨钳：两外斜臂 + 枢轴 + 上颚两齿 + 下颚两齿 + 绞盘
      for (const s of [-1, 1]) {
        B('metal', 0.32, 5.2, 0.32, -1.4, s * 0.95, y + 3.5, IRON, ry + s * 0.28);
        B('metal', 0.26, 0.26, 2.2, -1.4, s * 0.5, y + 5.5, 0x9aa0a8, ry);
        for (let q = 0; q < 2; q++) B('metal', 0.15, 0.52, 0.15, -1.4 + 1.0 - q * 0.9, s * 0.5, y + 5.2, 0xb0b4bc);
      }
      C('metal', 0.44, 0.44, 1.7, 8, -1.4, 0, y + 3.5, shade(COPPER, 0.68), 0, Math.PI / 2);
      C('wood', 0.16, 0.16, 2.4, 6, -3.4, 0, y + 4.4, 0x3a2c22, 0, 0, Math.PI / 2 - 0.4);
      // 铁舌钩架（侧）：横梁 + 六钩
      B('metal', 0.2, 2.9, 0.2, 1.2, 4.7, y + 1.45, IRON);
      B('metal', 1.9, 0.16, 0.16, 1.2, 4.7, y + 2.9, 0x4a4a54);
      for (let k = 0; k < 6; k++) {
        S('metal', 0.09, 1.2, 4.7 - 1.7 + k * 0.68, y + 2.1, 0.8, 0xb0b4bc, ry, 1, 1);
        B('metal', 0.06, 0.5, 0.06, 1.2, 4.7 - 1.7 + k * 0.68, y + 2.66, 0x8a8a92);
      }
      // 齿栅（后）：一排十枚铁齿
      B('ash', 5.6, 0.5, 1.0, -5.4, 0, y + 0.25, shade(0x4e5860, 0.88));
      for (let k = 0; k < 10; k++) S('metal', 0.17, -5.4, -2.4 + k * 0.53, y + 0.5, 0.8, 0xb4b8c0);
      // 缚柱一对
      post(2.6, -3.5); post(2.6, 3.5);
      // 特效：血雾 + 磷火
      vapor(-1.4, 0, y + 1.15, 1.9, RUST2, 3);
      specks(-1.0, 0, y + 2.2, 2.2, 10, PHOS, 0.13, 2.4);
      specks(-1.4, 0, y + 1.2, 1.6, 8, 0xff6a5a, 0.09, 0.9);
      break;
    }
    case 1: { // 剪刀獄：悬剪二十四具 / 剪架 / 铁砧 / 缚柱 / 刃轮
      // 剪架：四柱两梁
      B('metal', 0.22, 4.6, 0.22, -3.2, -3.4, y + 2.3, IRON);
      B('metal', 0.22, 4.6, 0.22, -3.2, 3.4, y + 2.3, IRON);
      B('metal', 0.22, 4.6, 0.22, 3.2, -3.4, y + 2.3, IRON);
      B('metal', 0.22, 4.6, 0.22, 3.2, 3.4, y + 2.3, IRON);
      for (const q of [-3.4, 3.4]) B('metal', 6.8, 0.18, 0.18, 0, q, y + 4.5, 0x4a4a54);
      for (const q of [-3.2, 3.2]) B('metal', 0.18, 0.18, 7.0, q, 0, y + 4.5, 0x4a4a54);
      // 悬剪 24 具（每具双刃 + 枢 + 吊链）
      for (let k = 0; k < 24; k++) {
        const a = k * 2.39996, r = 0.7 + (k % 4) * 0.85;
        const du = Math.cos(a) * r, dv = Math.sin(a) * r;
        B('metal', 1.7, 0.15, 0.2, du, dv, y + 3.9, 0xb0b4bc, ry + a);
        B('metal', 1.7, 0.15, 0.2, du, dv, y + 3.9, 0xb0b4bc, ry + a + 0.62);
        C('metal', 0.07, 0.07, 0.36, 6, du, dv, y + 3.9, COPPER);
        B('metal', 0.05, 0.6, 0.05, du, dv, y + 4.2, 0x6a6a72);
        if (k % 2 === 0) B('glow', 0.09, 0.09, 0.09, du, dv, y + 3.9, ICEC);
      }
      // 铁砧 + 锤
      B('metal', 1.5, 0.7, 0.9, -4.6, 0, y + 0.85, 0x33393f);
      B('metal', 0.9, 0.4, 0.6, -4.6, 0, y + 0.4, 0x2b3036);
      B('wood', 0.12, 0.12, 1.2, -5.4, 0.5, y + 1.05, 0x3a2c22, ry + 0.9);
      B('metal', 0.34, 0.3, 0.3, -5.9, 0.9, y + 1.4, 0x8a8a92);
      // 缚柱
      post(2.2, -4.6); post(2.2, 4.6);
      // 刃轮：竖轮 + 八刃
      C('metal', 1.15, 1.15, 0.2, 12, -2.6, 4.4, y + 2.0, 0x3a3a44, 0, Math.PI / 2);
      for (let k = 0; k < 8; k++) {
        const a = k * 0.7854;
        S('metal', 0.2, -2.6 + Math.cos(a) * 1.1, 4.4, y + 2.0 + Math.sin(a) * 1.1, 0.75, 0xc0c4cc, ry + a + Math.PI / 2, 1, 1);
      }
      // 特效：冷白雾 + 铁屑火花
      vapor(0, 0, y + 0.2, 3.4, 0x8fb8d8, 2);
      specks(0, 0, y + 2.6, 3.0, 14, ICEC, 0.09, 2.0);
      specks(-4.6, 0, y + 1.4, 1.2, 6, 0xffc94a, 0.07, 1.0);
      break;
    }
    case 2: { // 鐵樹獄：铁树干 / 放射铁枝刺 / 皮幡 / 缠链 / 血槽
      B('ash', 5.8, 0.4, 5.8, -1.2, 0, y + 0.2, shade(0x3b424a, 0.9));
      C('wood', 0.42, 0.62, 5.2, 7, -1.2, 0, y + 2.6, 0x2a2622);
      for (let k = 0; k < 12; k++) {
        const a = k * 0.5236, hh = 2.0 + (k % 4) * 0.55;
        const rr = 0.9 + (k % 3) * 0.5;
        B('wood', hh, 0.13, 0.13, -1.2 + Math.cos(a) * rr * 0.7, Math.sin(a) * rr, y + 3.0 + (k % 3) * 0.6, 0x2e2a26, ry - a);
        S('metal', 0.16, -1.2 + Math.cos(a) * (rr + hh * 0.5), Math.sin(a) * (rr * 1.4), y + 3.0 + (k % 3) * 0.6, 0.7, 0xb4b8c0, ry - a + Math.PI / 2);
      }
      // 刺冠（树顶）
      C('metal', 0.5, 0.5, 0.22, 8, -1.2, 0, y + 5.3, 0x3a3a44);
      for (let k = 0; k < 8; k++) {
        const a = k * 0.7854;
        S('metal', 0.14, -1.2 + Math.cos(a) * 0.42, Math.sin(a) * 0.42, y + 5.35, 0.9, 0xc0c4cc, ry - a, 1, 1);
      }
      // 皮幡三幅
      for (let k = 0; k < 3; k++) {
        const a = 1.2 + k * 2.1;
        C('wood', 0.09, 0.11, 2.8, 5, -1.2 + Math.cos(a) * 3.0, Math.sin(a) * 3.0, y + 1.4, 0x241c16);
        B('fabric', 0.9, 1.7 - k * 0.2, 0.06, -1.2 + Math.cos(a) * 3.0, Math.sin(a) * 3.0, y + 2.2, k === 1 ? 0x6e1f1f : 0x3a2c22, ry + a);
      }
      // 缠链：三股自枝头垂下
      for (let k = 0; k < 3; k++) chainHang(2.4 - k * 1.9, -2.6 + k * 2.6, y + 3.4, 1.9);
      // 血槽一圈
      trough(-1.2, 0, 5.4, 0.7); 
      // 特效：血滴 + 电光
      specks(-1.2, 0, y + 5.4, 2.0, 10, 0xff5a5a, 0.08, 1.6);
      specks(-1.2, 0, y + 3.2, 2.6, 12, 0x9ad8ff, 0.09, 2.4);
      break;
    }
    case 3: { // 孽鏡獄：千面镜墙 / 镜台 / 照镜柱 / 判词碑 / 骨屏
      for (let r2 = 0; r2 < 3; r2++) for (let c = 0; c < 5; c++) {
        B('glow', 1.4, 1.4, 0.1, -5.2, -3.4 + c * 1.7, y + 1.5 + r2 * 1.55, shade(COPPER, 1.1 + (c % 2) * 0.08));
        B('ash', 1.56, 1.56, 0.14, -5.34, -3.4 + c * 1.7, y + 1.5 + r2 * 1.55, shade(0x3b424a, 1.0));
      }
      B('glow', 8.4, 5.2, 0.06, -5.44, 0, y + 2.7, shade(0x6e1f1f, 0.55));
      // 镜台（三级石台）
      B('ash', 4.4, 0.4, 3.2, -0.6, 0, y + 0.2, shade(0x4e5860, 0.94));
      B('ash', 3.2, 0.4, 2.4, -0.6, 0, y + 0.6, shade(0x4e5860, 1.04));
      B('glow', 2.6, 0.06, 1.8, -0.6, 0, y + 0.82, shade(COPPER, 1.0));
      // 照镜柱两具
      for (const s of [-1, 1]) {
        C('wood', 0.2, 0.26, 3.4, 6, 1.6, s * 3.0, y + 1.7, 0x241c16);
        C('glow', 0.62, 0.62, 0.1, 12, 1.6, s * 3.0, y + 3.1, shade(COPPER, 1.18), 0, Math.PI / 2);
        B('ash', 1.5, 1.5, 0.12, 1.5, s * 3.0, y + 3.1, shade(0x3b424a, 1.05));
      }
      // 判词碑两通
      for (const s of [-1, 1]) {
        B('ash', 1.2, 2.4, 0.32, 3.4, s * 3.4, y + 1.2, shade(0x4e5860, 1.08));
        B('glow', 0.9, 0.06, 0.1, 3.3, s * 3.4, y + 1.7, s > 0 ? 0xc9b380 : RUST);
        B('glow', 0.9, 0.06, 0.1, 3.3, s * 3.4, y + 1.3, s > 0 ? 0xc9b380 : RUST);
      }
      // 骨屏三扇
      for (let k = 0; k < 3; k++) B('wood', 0.9, 2.2, 0.08, -3.0, -1.4 + k * 1.4, y + 1.1, BONE);
      // 特效：镜光柱 + 暗红雾
      C('glow', 0.5, 0.9, 4.6, 7, -0.6, 0, y + 2.6, shade(0xbfa77a, 0.55), 0, 0, 0, true);
      vapor(-0.6, 0, y + 0.9, 2.6, 0x6e1f1f, 3);
      specks(-0.6, 0, y + 1.2, 2.2, 8, 0xffd9a0, 0.08, 2.0);
      break;
    }
    case 4: { // 蒸籠獄：九层蒸笼 / 灶台三眼 / 柴堆 / 笼盖提环 / 水缸
      B('ash', 7.0, 0.7, 6.4, -0.8, 0, y + 0.35, shade(0x3b3a34, 0.94));
      for (const [ddx, ddz] of [[-1.9, 0], [1.9, 0], [0, 2.1]] as const) {
        B('glow', 1.2, 0.62, 0.28, -0.8 + ddx, ddz, y + 0.55, 0x8a3a12);
        B('metal', 1.5, 0.16, 0.34, -0.8 + ddx, ddz, y + 0.92, 0x3a3a42);
      }
      for (let k = 0; k < 9; k++) C('wood', 1.2 + k * 0.03, 1.24 + k * 0.03, 0.42, 10, -0.8, 0, y + 0.95 + k * 0.45, shade(0x2e2a26, 1 + (k % 2) * 0.07));
      // 笼盖 + 提环 + 捆绳
      C('wood', 0.9, 1.3, 0.3, 10, -0.8, 0, y + 5.2, 0x3a2c22);
      C('metal', 0.2, 0.2, 0.16, 8, -0.8, 0, y + 5.44, COPPER);
      for (let k = 0; k < 3; k++) B('metal', 0.06, 4.0, 0.06, -0.8, 0, y + 3.1, 0x6a5a3a, ry + k * 1.047);
      // 柴堆
      for (let k = 0; k < 10; k++) B('wood', 1.5, 0.22, 0.22, -3.6 + (k % 3) * 0.5, -2.4 + Math.floor(k / 3) * 0.28, y + 0.2 + Math.floor(k / 4) * 0.24, shade(0x3a2c22, 0.9 + (k % 3) * 0.1), ry + 0.2);
      // 水缸两口
      for (const s of [-1, 1]) {
        C('ceramic', 0.72, 0.55, 1.1, 10, 2.4, s * 2.8, y + 0.55, 0x2e3436);
        C('glow', 0.62, 0.62, 0.1, 10, 2.4, s * 2.8, y + 1.06, 0x2a4a5a);
      }
      // 特效：汽柱 + 白雾
      C('glow', 0.5, 0.95, 5.4, 6, -0.8, 0, y + 7.6, shade(MIST, 1.3), 0, 0, 0, true);
      vapor(-0.8, 0, y + 5.4, 1.8, 0xcfd8d0, 3);
      specks(-0.8, 0, y + 5.6, 1.4, 10, 0xe8f0e8, 0.1, 2.6);
      break;
    }
    case 5: { // 銅柱獄：六根赤热铜柱 / 炉膛 / 炭堆 / 铁钳 / 风箱
      B('ash', 7.2, 0.6, 7.2, 0, 0, y + 0.3, shade(0x3b3a34, 0.9));
      for (let k = 0; k < 6; k++) {
        const a = k * 1.047, r = 2.5;
        C('metal', 0.26, 0.26, 4.4, 8, Math.cos(a) * r, Math.sin(a) * r, y + 2.4, shade(COPPER, 0.8));
        C('glow', 0.12, 0.12, 3.6, 6, Math.cos(a) * r, Math.sin(a) * r, y + 2.4, 0xc04a18);
        C('metal', 0.36, 0.36, 0.18, 8, Math.cos(a) * r, Math.sin(a) * r, y + 4.5, 0x8a6a3a);
        for (let q = 0; q < 3; q++) B('metal', 0.6, 0.06, 0.06, Math.cos(a) * r, Math.sin(a) * r, y + 0.9 + q * 1.2, 0x3a3a42, ry - a);
      }
      // 炉膛：方炉 + 双灶门 + 烟囱
      B('ash', 3.0, 1.9, 2.6, -4.6, 0, y + 0.95, shade(0x3b424a, 1.0));
      for (const s of [-1, 1]) B('glow', 0.9, 0.7, 0.14, -3.2, s * 0.8, y + 0.8, 0xff6a1a);
      C('metal', 0.36, 0.42, 2.4, 8, -4.6, 0, y + 3.0, 0x2a2622);
      // 炭堆 + 铁钳三支
      coal(-4.2, 2.4, 1.3, 14, 0xff5a12);
      for (let k = 0; k < 3; k++) B('metal', 0.1, 0.1, 2.6, 1.8 + k * 0.4, -3.2 + k * 0.5, y + 1.5, 0x8a8a92, ry + 0.5 + k * 0.2, 0, 0.9);
      // 风箱
      B('wood', 1.6, 0.9, 0.9, 3.6, 2.6, y + 0.75, 0x3a2c22);
      B('metal', 0.2, 0.2, 1.4, 3.0, 2.6, y + 0.8, 0x5a5a62, ry + Math.PI / 2);
      B('wood', 0.1, 0.1, 1.5, 4.3, 2.6, y + 1.2, 0x241c16, ry + 0.3);
      // 特效：焰 + 火星
      flame(-0.8, 0, y + 0.2, 2.6, 0.9, 0xff7a2d, 7, 1.1);
      specks(0, 0, y + 1.6, 3.2, 16, 0xffb347, 0.1, 2.8);
      break;
    }
    case 6: { // 刀山獄：五十柄刀锋 / 刀床架 / 血槽 / 骨堆 / 缚架
      B('ash', 8.0, 0.5, 8.0, 0, 0, y + 0.25, shade(0x4e5860, 0.9));
      // 三环 50 柄，朝向各异
      for (const [ring2, cnt, rad] of [[1, 10, 1.1], [2, 16, 2.3], [3, 24, 3.5]] as const) {
        for (let k = 0; k < cnt; k++) {
          const a = (k / cnt) * Math.PI * 2 + ring2 * 0.31;
          const hh = 1.5 + ring2 * 0.62 + (k % 3) * 0.22;
          S('metal', 0.17, Math.cos(a) * rad, Math.sin(a) * rad, y + 0.5, hh, k % 5 === 0 ? 0xd8dce4 : 0xb4b8c0, ry - a, 1, 0.34);
        }
      }
      // 刀床：两根横梁 + 八柄横置刀
      for (const s of [-1, 1]) B('metal', 0.22, 0.22, 5.4, 3.6, 0, y + 1.1, 0x4a4a54, ry);
      for (let k = 0; k < 8; k++) {
        B('metal', 0.22, 0.1, 1.5, 2.9, -2.4 + k * 0.68, y + 1.25, 0xc0c4cc, ry);
        B('metal', 0.06, 0.5, 0.06, 2.9, -2.4 + k * 0.68, y + 1.6, 0x6a6a72);
      }
      trough(0, 0, 6.4, 0.6);
      bones(-3.2, 2.8, 6);
      bones(3.0, -3.0, 4, 0xa8a094);
      // 缚架：双柱 + 横梁 + 绳
      for (const s of [-1, 1]) B('wood', 0.24, 3.4, 0.24, -4.4, s * 1.8, y + 1.7, 0x241c16);
      B('wood', 3.8, 0.24, 0.24, -4.4, 0, y + 3.4, 0x3a2c22);
      for (let k = 0; k < 4; k++) B('wood', 0.06, 1.5, 0.06, -4.4, -1.4 + k * 0.9, y + 2.6, 0x8a7a5a);
      // 特效：磷火 + 血雾
      specks(0, 0, y + 1.4, 3.6, 18, PHOS, 0.12, 2.6);
      vapor(0, 0, y + 0.4, 3.2, 0x8a1a1a, 2);
      break;
    }
    case 7: { // 冰山獄：十二冰柱 / 八冰锥 / 冰面 / 冰枷台 / 冰牢笼
      B('ash', 7.4, 0.4, 7.4, 0, 0, y + 0.2, shade(0x3b424a, 0.85));
      for (let k = 0; k < 12; k++) {
        const a = k * 0.5236 + 0.2, rr = k < 6 ? 1.2 : 2.4;
        const hgt = 2.2 + (k % 4) * 1.15;
        C('glow', 0.22, 0.4, hgt, 6, Math.cos(a) * rr, Math.sin(a) * rr, y + 0.4 + hgt / 2, shade(ICEC, 0.4 + (k % 3) * 0.09), a, 0, Math.sin(a) * 0.05);
      }
      for (let k = 0; k < 8; k++) {
        const a = k * 0.7854 + 0.4;
        S('glow', 0.3, Math.cos(a) * 3.1, Math.sin(a) * 3.1, y + 0.4, 2.4, shade(ICEC, 0.5), a, 1, 1);
      }
      B('glow', 4.2, 0.06, 4.2, 0, 0, y + 0.42, shade(ICEC, 0.2));
      // 冰枷台：石台 + 冰枷洞 + 冰封受刑者轮廓
      B('ash', 2.4, 0.5, 1.6, -1.6, 0, y + 0.65, shade(0x4e5860, 0.95));
      B('glow', 1.9, 0.16, 0.9, -1.6, 0, y + 0.95, shade(ICEC, 0.5));
      C('glow', 0.36, 0.42, 1.5, 7, -1.6, 0, y + 1.5, shade(ICEC, 0.34), 0, 0, 0.04);
      // 冰牢笼：四柱 + 顶框 + 冰栅
      for (const s of [-1, 1]) for (const q of [-1, 1]) C('glow', 0.12, 0.14, 3.0, 5, 2.4 + s * 0.9, q * 0.9, y + 1.5, shade(ICEC, 0.4));
      B('glow', 2.1, 0.12, 2.1, 2.4, 0, y + 3.0, shade(ICEC, 0.42));
      for (let k = 0; k < 6; k++) C('glow', 0.05, 0.05, 2.8, 4, 2.4 - 0.75 + k * 0.3, 0.9, y + 1.5, shade(ICEC, 0.3));
      // 冰灯（自发光源）：青白
      B('glow', 0.3, 0.5, 0.3, 3.6, 0, y + 2.0, 0x8fd8ff);
      // 特效：寒气 + 冰晶
      vapor(0, 0, y + 0.3, 3.0, 0xbfe8ff, 3);
      specks(0, 0, y + 1.0, 3.2, 18, 0xd8f4ff, 0.08, 2.8);
      break;
    }
    case 8: { // 油鍋獄：大镬 / 三眼灶 / 沸油面 / 柴堆 / 风箱 / 铁叉
      B('ash', 8.0, 1.1, 8.0, 0, 0, y + 0.55, shade(0x3b3a34, 0.92));
      // 三眼灶：三个拱形灶门 + 炉膛内焰
      for (const [ddx, ddz] of [[-2.4, 0], [2.4, 0], [0, 2.6]] as const) {
        B('glow', 1.3, 0.7, 0.3, ddx + 0, ddz, y + 0.5, 0x8a3a10);
        B('metal', 1.7, 0.18, 0.36, ddx, ddz, y + 0.92, 0x3a3a42);
        B('ash', 1.7, 0.6, 0.34, ddx, ddz, y + 0.18, shade(0x2e2420, 1.0));
      }
      // 大镬：锅体 + 口沿 + 双耳 + 油面 + 沸泡
      C('metal', 3.0, 2.3, 1.9, 16, 0, 0, y + 2.05, shade(COPPER, 0.62));
      C('metal', 3.15, 3.15, 0.3, 16, 0, 0, y + 3.0, shade(COPPER, 0.78));
      for (const s of [-1, 1]) B('metal', 0.34, 1.0, 0.56, 0, s * 2.8, y + 2.95, shade(COPPER, 0.7));
      C('glow', 2.8, 2.8, 0.14, 14, 0, 0, y + 2.92, 0x8a4a12);
      for (let k = 0; k < 14; k++) {
        const a = k * 0.4488 + 0.3, rr = 0.5 + (k % 5) * 0.42;
        B('glow', 0.34, 0.18, 0.34, Math.cos(a) * rr, Math.sin(a) * rr, y + 3.02, k % 3 === 0 ? 0xffa040 : 0x8a4a18);
      }
      // 柴堆（锅下）
      for (let k = 0; k < 12; k++) B('wood', 1.7, 0.24, 0.24, -3.9 + (k % 2) * 0.3, -3.0 + Math.floor(k / 2) % 4 * 0.3, y + 0.24 + Math.floor(k / 4) * 0.26, shade(0x3a2c22, 0.9 + (k % 3) * 0.1), ry + 0.24);
      // 风箱 + 铁叉
      B('wood', 1.7, 1.0, 1.0, 3.8, 3.0, y + 0.85, 0x3a2c22);
      B('wood', 0.1, 0.1, 1.6, 4.6, 3.0, y + 1.3, 0x241c16, ry + 0.35);
      for (let k = 0; k < 2; k++) B('metal', 0.08, 0.08, 3.2, 2.2 + k * 0.5, -3.4 + k * 0.6, y + 1.6, 0x9a9aa2, ry + 0.6, 0, 0.55);
      // 油灯（自发光源）：橙红
      B('glow', 0.34, 0.6, 0.34, 4.0, 0, y + 2.4, 0xff7a2d);
      // 特效：火焰 + 油烟
      flame(0, 0, y + 3.1, 2.4, 1.3, 0xff7a2d, 8, 1.4);
      vapor(0, 0, y + 3.6, 2.2, 0x4a3a2a, 3);
      specks(0, 0, y + 3.2, 2.4, 14, 0xffb347, 0.11, 3.2);
      break;
    }
    case 9: { // 牛坑獄：陷坑 / 牛形 / 犁 / 铁刺桩 / 骨堆
      B('ground', 7.4, 0.2, 7.4, 0, 0, y + 0.06, shade(0x4a3c33, 0.7));
      // 陷坑：外沿 + 深坑内壁 + 坑底
      B('ash', 5.6, 0.34, 5.6, 0, 0, y + 0.2, shade(MIST, 0.55));
      B('ground', 4.4, 0.5, 4.4, 0, 0, y - 0.05, 0x241c18);
      for (let k = 0; k < 12; k++) {
        const a = k * 0.5236;
        B('ash', 1.3, 0.5, 0.3, Math.cos(a) * 2.5, Math.sin(a) * 2.5, y + 0.1, shade(0x3b342c, 0.9), ry - a + Math.PI / 2);
      }
      // 牛形：身 + 头 + 双角 + 四足 + 尾
      B('wood', 2.6, 1.1, 1.3, -1.0, 0, y + 1.15, 0x2a2220);
      B('wood', 0.9, 0.8, 0.8, 0.5, 0, y + 1.35, 0x241c1a);
      for (const s of [-1, 1]) S('ash', 0.11, 0.78, s * 0.34, y + 1.75, 0.62, 0xd8d0c0, ry + s * 0.5);
      for (const s of [-1, 1]) for (const q of [-1, 1]) B('wood', 0.2, 0.85, 0.2, s * 0.9, q * 0.5, y + 0.5, 0x241c1a);
      B('wood', 0.7, 0.1, 0.1, -2.4, 0, y + 1.4, 0x241c1a, ry + 0.4);
      // 犁两具
      for (const s of [-1, 1]) {
        B('metal', 0.12, 0.12, 2.0, 2.2, s * 2.2, y + 0.4, 0x5a5a62, ry + s * 0.4);
        S('metal', 0.16, 3.0, s * 2.2, y + 0.2, 0.6, 0x8a8a92, ry + s * 0.4, 1, 0.4);
      }
      // 铁刺桩四支
      for (let k = 0; k < 4; k++) {
        const a = 0.78 + k * 1.57;
        C('wood', 0.14, 0.2, 1.6, 6, Math.cos(a) * 3.2, Math.sin(a) * 3.2, y + 0.8, 0x241c16);
        S('metal', 0.16, Math.cos(a) * 3.2, Math.sin(a) * 3.2, y + 1.6, 0.7, 0xb0b4bc);
      }
      bones(-2.6, 2.6, 5);
      // 特效：扬尘 + 血滴
      vapor(0, 0, y + 0.1, 3.4, 0x6a5a48, 2);
      specks(0, 0, y + 0.3, 3.0, 12, 0xff5a5a, 0.09, 1.4);
      break;
    }
    case 10: { // 石壓獄：悬顶巨石 / 吊链 / 压台 / 石柱 / 绞盘
      // 压台（下）+ 碎骨
      B('ash', 5.0, 0.7, 5.0, 0, 0, y + 0.35, shade(0x4e5860, 0.9));
      B('glow', 4.2, 0.06, 4.2, 0, 0, y + 0.72, shade(PHOS, 0.28));
      bones(0, 0, 7);
      // 悬顶巨石 + 四吊链 + 顶梁
      C('ash', 2.4, 2.6, 1.2, 12, 0, 0, y + 5.0, shade(0x33393f, 1.02));
      C('ash', 1.2, 1.9, 0.9, 12, 0, 0, y + 4.0, shade(0x3b424a, 0.98));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) chainHang(sx * 1.7, sz * 1.7, y + 6.4, 1.2);
      for (const s of [-1, 1]) B('wood', 4.6, 0.3, 0.3, s * 2.2, 0, y + 6.5, 0x241c16, ry);
      // 石柱四根
      for (let k = 0; k < 4; k++) {
        const a = 0.785 + k * 1.5708;
        C('ash', 0.28, 0.34, 4.6, 6, Math.cos(a) * 3.4, Math.sin(a) * 3.4, y + 2.3, shade(0x4e5860, 1.02));
        B('ash', 0.9, 0.24, 0.9, Math.cos(a) * 3.4, Math.sin(a) * 3.4, y + 4.7, shade(0x4e5860, 1.12));
      }
      // 绞盘
      C('wood', 0.5, 0.5, 1.6, 8, 3.6, 3.2, y + 1.4, 0x3a2c22, 0, 0, Math.PI / 2);
      for (let k = 0; k < 4; k++) B('wood', 0.1, 0.1, 1.8, 3.6, 3.2, y + 1.4, 0x241c16, ry + k * 0.785);
      B('wood', 0.9, 1.4, 0.9, 3.6, 3.2, y + 0.7, 0x2e2420);
      // 特效：粉尘 + 火星
      vapor(0, 0, y + 0.7, 3.0, 0x8a8078, 3);
      specks(0, 0, y + 3.4, 2.4, 12, 0xd8d0c0, 0.08, 2.2);
      break;
    }
    case 11: { // 舂臼獄：双石臼 / 双杵 / 踏碓架 / 谷斗 / 石碾
      B('ash', 6.6, 0.4, 5.6, 0, 0, y + 0.2, shade(0x3b424a, 0.92));
      for (const s of [-1, 1]) {
        C('ash', 0.95, 1.15, 1.5, 9, s * 1.6, 0, y + 0.95, shade(0x33393f, 1.08));
        C('glow', 0.86, 0.86, 0.1, 9, s * 1.6, 0, y + 1.66, shade(BONE, 0.32));
        // 杵：杆 + 杵头 + 上端配重
        B('wood', 0.22, 3.2, 0.22, s * 1.6, 0, y + 3.1, 0x3a2c22, ry, s * 0.06, 0);
        B('ash', 0.34, 0.5, 0.34, s * 1.6 - s * 0.18, 0, y + 1.9, shade(0x4e5860, 1.1));
        B('metal', 0.5, 0.2, 0.5, s * 1.6 + s * 0.1, 0, y + 4.7, 0x5a5a62);
      }
      // 踏碓架：横梁 + 两立柱 + 踏杆
      for (const s of [-1, 1]) B('wood', 0.24, 4.4, 0.24, -3.5, s * 1.4, y + 2.2, 0x241c16);
      B('wood', 0.26, 0.26, 3.4, -3.5, 0, y + 4.3, 0x3a2c22);
      B('wood', 3.4, 0.2, 0.2, -1.9, 0, y + 1.5, 0x3a2c22, ry + 0.12);
      // 谷斗
      C('wood', 0.9, 0.6, 1.2, 8, 3.4, -2.4, y + 0.8, 0x3a2c22);
      for (let k = 0; k < 6; k++) B('glow', 0.1, 0.1, 0.1, 3.4, -2.4, y + 1.1 + k * 0.18, shade(BONE, 0.5));
      // 石碾
      C('ash', 1.0, 1.0, 0.5, 12, 3.4, 2.6, y + 0.7, shade(0x33393f, 1.05), 0, Math.PI / 2);
      B('wood', 0.12, 0.12, 2.0, 3.4, 2.6, y + 1.2, 0x3a2c22, ry + 0.5);
      // 特效：粉尘 + 谷壳飘点
      vapor(0, 0, y + 0.2, 2.8, 0x9a8a78, 3);
      specks(0, 0, y + 1.6, 2.6, 14, 0xd8c8a8, 0.08, 2.4);
      break;
    }
    case 12: { // 血池獄：方池 / 溺形 / 骨栏 / 血瀑 / 血缸
      B('ground', 8.0, 0.34, 6.4, 0, 0, y + 0.17, shade(0x2a1a1a, 0.9));
      B('glow', 7.0, 0.14, 5.4, 0, 0, y + 0.34, 0x5c1018);
      // 池沿三段
      for (const s of [-1, 1]) B('ash', 8.4, 0.8, 0.46, 0, s * 3.2, y + 0.4, shade(0x4e5860, 0.9));
      for (const s of [-1, 1]) B('ash', 0.46, 0.8, 6.6, s * 4.1, 0, y + 0.4, shade(0x4e5860, 0.9));
      // 溺形两组（头/肩/双臂半沉 + 涟漪）
      for (const [ddx, ddz] of [[-1.6, 0.6], [1.8, -1.0]] as const) {
        C('glow', 0.32, 0.36, 0.42, 7, ddx, ddz, y + 0.52, 0x9a8f86);
        B('glow', 1.6, 0.26, 0.62, ddx, ddz, y + 0.38, 0x8a7f76);
        for (const s of [-1, 1]) B('glow', 0.64, 0.2, 0.26, ddx + s * 1.05, ddz + 0.2, y + 0.36, 0x7a6f68);
        C('glow', 1.7, 1.7, 0.03, 12, ddx, ddz, y + 0.37, 0x7a1a1a);
      }
      // 骨栏（池沿上的骨桩）
      for (let k = 0; k < 10; k++) {
        const a = k * 0.6283;
        B('ash', 0.14, 0.9, 0.14, Math.cos(a) * 3.9, Math.sin(a) * 3.0, y + 1.0, shade(BONE, 0.6), a);
        B('ash', 0.3, 0.14, 0.14, Math.cos(a) * 3.9, Math.sin(a) * 3.0, y + 1.46, shade(BONE, 0.66), a);
      }
      // 血瀑（后壁落血）+ 血缸三尊
      B('glow', 2.2, 3.4, 0.12, -4.2, 0, y + 1.9, 0x6e1f1f);
      for (let k = 0; k < 3; k++) {
        C('ceramic', 0.56, 0.44, 1.0, 9, 3.4, -2.8 + k * 2.8, y + 0.5, 0x3a2c28);
        C('glow', 0.48, 0.48, 0.08, 9, 3.4, -2.8 + k * 2.8, y + 0.98, 0x7a1a1a);
      }
      // 特效：血雾 + 血滴 + 蛆虫群（池面爬行的虫点，血池獄独有）
      vapor(0, 0, y + 0.4, 3.4, 0x8a1a1a, 3);
      specks(0, 0, y + 1.6, 3.0, 14, 0xff3a4a, 0.1, 2.2);
      swarm(0, 0, y + 0.42, 2.8, 22, 0xc8d8a0);
      break;
    }
    case 13: { // 枉死獄：名录墙 / 廊柱 / 灵位架 / 白幡 / 供案
      // 名录墙（后）+ 九行名条
      B('wall', 0.5, 3.6, 10.4, -5.2, 0, y + 1.8, shade(BLACKB, 0.9));
      for (let k = 0; k < 11; k++) B('glow', 0.36, 0.06, 0.06, -4.94, -4.6 + k * 0.92, y + 0.8 + (k % 5) * 0.6, k === 10 ? 0xc9b380 : MIST);
      // 廊柱八根
      for (let k = 0; k < 8; k++) {
        const dv = -4.5 + k * 1.29;
        C('wood', 0.24, 0.3, 4.2, 6, -3.6, dv, y + 2.1, 0x241c16);
        B('ash', 0.7, 0.16, 0.7, -3.6, dv, y + 0.08, shade(0x4e5860, 0.92));
      }
      B('wood', 0.3, 0.3, 9.6, -3.6, 0, y + 4.2, 0x3a2c22);
      // 灵位架：三层龛位
      for (let r2 = 0; r2 < 3; r2++) {
        B('wood', 4.4, 0.14, 0.5, 1.2, 0, y + 1.2 + r2 * 1.0, 0x3a2c22);
        for (let c = 0; c < 7; c++) B('glow', 0.16, 0.3, 0.08, 1.2, -1.85 + c * 0.62, y + 1.4 + r2 * 1.0, c % 3 === 0 ? 0xc9b380 : 0x8a8272);
      }
      for (const s of [-1, 1]) B('wood', 0.2, 3.4, 0.2, 1.2, s * 2.1, y + 1.7, 0x241c16);
      // 白幡四幅
      for (let k = 0; k < 4; k++) {
        const dv = -3.0 + k * 2.0;
        C('wood', 0.08, 0.1, 3.0, 5, 3.6, dv, y + 1.5, 0x241c16);
        B('fabric', 0.7, 2.0, 0.05, 3.6, dv, y + 2.6, k % 2 ? 0xd8d0c0 : 0x8a8272, ry);
      }
      // 供案 + 香炉
      B('wood', 2.4, 0.9, 1.0, 3.0, 0, y + 0.6, 0x2e2420);
      C('ceramic', 0.36, 0.26, 0.42, 8, 3.0, 0, y + 1.25, 0xb87333);
      for (let k = 0; k < 3; k++) B('glow', 0.04, 0.5, 0.04, 3.0, -0.2 + k * 0.2, y + 1.7, 0xff6a3a);
      // 特效：青白鬼雾 + 灵火
      vapor(0, 0, y + 0.3, 3.2, 0x9ad8c8, 3);
      specks(0, 0, y + 1.2, 3.0, 16, 0x6affc8, 0.1, 2.8);
      break;
    }
    case 14: { // 磔刑獄：五链悬张 / 刑架 / 绳轮 / 木桩 / 残躯布
      // 刑架：两高柱 + 顶横梁 + 斜撑
      for (const s of [-1, 1]) {
        B('wood', 0.34, 5.6, 0.34, 1.0, s * 2.6, y + 2.8, 0x241c16);
        B('wood', 0.2, 0.2, 2.4, 1.0, s * 2.6, y + 4.6, 0x3a2c22, ry + s * 0.6);
      }
      B('wood', 6.0, 0.34, 0.34, 1.0, 0, y + 5.6, 0x3a2c22);
      // 五链五向
      for (let k = 0; k < 5; k++) {
        const a = k * 1.256;
        const ex = Math.cos(a) * 2.6, ez = Math.sin(a) * 2.6;
        C('metal', 0.06, 0.06, 3.6, 5, ex * 0.5, ez * 0.5, y + 3.4, 0x9a9aa2, ry - a, 0, Math.sin(a) * 0.7);
        B('metal', 0.16, 0.34, 0.16, ex, ez, y + 1.5, 0x8a8a92);
        chainHang(ex, ez, y + 4.4, 1.4);
      }
      // 绳轮 + 绳
      C('wood', 0.7, 0.7, 0.24, 10, -0.6, 0, y + 5.0, 0x3a2c22, 0, Math.PI / 2);
      for (let k = 0; k < 6; k++) B('wood', 0.1, 0.1, 1.5, -0.6, 0, y + 5.0, 0x241c16, ry + k * 0.5236);
      B('wood', 0.06, 2.2, 0.06, -0.6, 0, y + 3.9, 0x8a7a5a);
      // 木桩四支 + 残躯布
      for (let k = 0; k < 4; k++) {
        const a = 0.5 + k * 1.5708;
        C('wood', 0.16, 0.22, 2.0, 6, Math.cos(a) * 3.2, Math.sin(a) * 3.2, y + 1.0, 0x241c16);
        B('fabric', 0.7, 0.5, 0.05, Math.cos(a) * 3.2, Math.sin(a) * 3.2, y + 1.8, 0x6e1f1f, ry + a);
      }
      bones(2.4, 0, 5);
      // 特效：血雾 + 电光
      vapor(1.0, 0, y + 0.4, 2.8, 0x8a1a1a, 2);
      specks(1.0, 0, y + 2.0, 2.6, 14, 0x9ad8ff, 0.1, 3.0);
      break;
    }
    case 15: { // 火山獄：火山口 / 熔岩流 / 喷气孔 / 炭堆 / 火山岩柱
      B('ground', 8.0, 0.3, 8.0, 0, 0, y + 0.15, shade(0x2a2220, 0.95));
      // 火山锥 + 口沿 + 岩浆池
      C('ash', 2.4, 4.2, 2.6, 12, -1.4, 0, y + 1.3, shade(0x2e2622, 1.0));
      C('ash', 1.8, 2.4, 0.5, 12, -1.4, 0, y + 2.75, shade(0x241c1a, 1.0));
      C('glow', 1.5, 1.5, 0.2, 12, -1.4, 0, y + 2.72, 0xff5a12);
      C('glow', 0.9, 0.7, 2.2, 8, -1.4, 0, y + 4.0, 0xff7a1a, 0, 0, 0, true);
      // 熔岩流三条
      for (let k = 0; k < 3; k++) {
        const a = 0.4 + k * 2.1;
        B('glow', 0.6, 0.08, 3.4, -1.4 + Math.cos(a) * 2.2, Math.sin(a) * 2.2, y + 0.28 + (k % 2) * 0.06, 0xff4a08, ry - a);
      }
      // 喷气孔四口
      for (let k = 0; k < 4; k++) {
        const a = 1.0 + k * 1.5708;
        C('ash', 0.3, 0.42, 0.6, 6, Math.cos(a) * 3.4, Math.sin(a) * 3.4, y + 0.3, shade(0x33393f, 0.9));
        C('glow', 0.14, 0.2, 0.5, 5, Math.cos(a) * 3.4, Math.sin(a) * 3.4, y + 0.72, 0xff7a2d, 0, 0, 0, true);
      }
      // 火山岩柱五根 + 炭堆
      for (let k = 0; k < 5; k++) {
        const a = k * 1.2566;
        S('ash', 0.5, Math.cos(a) * 2.8, Math.sin(a) * 2.8, y + 0.2, 1.8 + (k % 3) * 0.9, k % 2 ? 0x2a2220 : 0x332a24, a, 1, 1);
      }
      coal(2.6, 2.2, 1.4, 12, 0xff5a12);
      // 特效：焰 + 火星
      flame(-1.4, 0, y + 2.8, 2.8, 1.2, 0xff6a1a, 7, 1.0);
      flame(2.6, 2.2, y + 0.2, 1.4, 0.7, 0xff8a2d, 4, 0.6);
      specks(-1.4, 0, y + 2.8, 2.6, 16, 0xffb347, 0.1, 3.4);
      break;
    }
    case 16: { // 石磨獄：下盘 / 上盘 / 推杆 / 磨槽 / 磨眼与粉堆
      B('ash', 7.0, 0.4, 7.0, 0, 0, y + 0.2, shade(0x3b424a, 0.9));
      // 磨槽（环形）+ 磨盘座
      C('ash', 3.4, 3.4, 0.3, 16, 0, 0, y + 0.5, shade(0x4e5860, 0.86));
      C('glow', 3.1, 3.1, 0.08, 16, 0, 0, y + 0.66, shade(BONE, 0.28));
      C('ash', 2.9, 3.0, 0.4, 14, 0, 0, y + 0.85, shade(0x33393f, 1.05));
      // 下盘 + 上盘 + 磨眼 + 磨齿
      C('ash', 2.3, 2.3, 0.55, 14, 0, 0, y + 1.3, shade(0x3b424a, 1.06));
      C('ash', 2.0, 2.0, 0.6, 14, 0, 0, y + 1.85, shade(0x4e5860, 1.02));
      C('glow', 0.3, 0.3, 0.7, 8, 0, 0, y + 2.0, 0x241c1a);
      for (let k = 0; k < 12; k++) {
        const a = k * 0.5236;
        B('ash', 0.5, 0.22, 0.3, Math.cos(a) * 2.1, Math.sin(a) * 2.1, y + 1.62, shade(0x33393f, 1.1), a);
      }
      // 推杆两根 + 横担
      for (const s of [-1, 1]) B('wood', 3.6, 0.18, 0.18, 1.4, s * 0.7, y + 2.2, 0x3a2c22, ry, 0, s * 0.14);
      B('wood', 0.34, 0.5, 1.9, 3.2, 0, y + 2.1, 0x3a2c22);
      // 粉堆 + 斗
      for (let k = 0; k < 6; k++) {
        const a = k * 1.1;
        S('ash', 0.3, Math.cos(a) * 2.6, Math.sin(a) * 2.6, y + 0.7, 0.5, shade(BONE, 0.52), a);
      }
      C('wood', 0.6, 0.42, 0.8, 8, -3.4, 0, y + 0.8, 0x3a2c22);
      // 特效：粉尘 + 火星
      vapor(0, 0, y + 0.7, 3.0, 0xb8ab98, 3);
      specks(0, 0, y + 1.6, 2.6, 12, 0xffc94a, 0.08, 1.8);
      break;
    }
    default: { // 17 刀鋸獄：锯架 / 六锯条 / 缚柱与木马 / 铁屑 / 齿轮
      for (const s of [-1, 1]) B('metal', 0.26, 4.4, 0.26, 0, s * 3.2, y + 2.2, IRON);
      B('metal', 6.8, 0.26, 0.26, 0, 0, y + 4.4, 0x4a4a54);
      // 六锯条（往复）
      for (let k = 0; k < 6; k++) {
        const dv = -2.6 + k * 1.04;
        B('metal', 2.4, 0.4, 0.06, -0.6, dv, y + 3.6, 0xb0b4bc, ry);
        for (let q = 0; q < 8; q++) B('metal', 0.1, 0.14, 0.08, -1.7 + q * 0.3, dv, y + 3.34, 0xd8dce4, ry);
        B('metal', 0.06, 1.5, 0.06, -1.5, dv, y + 4.2, 0x6a6a72);
        B('metal', 0.16, 0.16, 0.16, 0.6, dv, y + 3.6, 0x8a8a92);
      }
      // 缚柱两对 + 木马
      post(2.8, -3.4); post(2.8, 3.4);
      B('wood', 2.0, 0.4, 0.9, 2.4, 0, y + 1.1, 0x3a2c22);
      for (const s of [-1, 1]) B('wood', 0.24, 1.0, 0.24, 2.4, s * 0.6, y + 0.55, 0x241c16);
      // 铁屑堆 + 齿轮
      for (let k = 0; k < 10; k++) B('metal', 0.12, 0.08, 0.12, -1.6 + (k % 5) * 0.4, -2.4 + Math.floor(k / 5) * 0.5, y + 0.12, 0x9a9aa2, k);
      C('metal', 1.0, 1.0, 0.18, 12, -3.6, 2.6, y + 3.0, 0x5a5a62, 0, Math.PI / 2);
      for (let k = 0; k < 10; k++) {
        const a = k * 0.6283;
        B('metal', 0.3, 0.3, 0.2, -3.6 + Math.cos(a) * 1.0, 2.6 + Math.sin(a) * 1.0, y + 3.0, 0x6a6a72, a);
      }
      // 特效：铁屑火花 + 冷雾
      specks(0, 0, y + 1.4, 3.0, 14, 0xffd9a0, 0.08, 2.2);
      vapor(0, 0, y + 0.3, 3.0, 0x8fb8d8, 2);
      break;
    }
  }
}

/** 六狱型：门楣材质与械具分档。i%6 与圈层错位互补，每型 3 座，拔舌/刀山/血池/油锅四狱与本名对齐 */
const HELL_TYPES = ['bashe', 'daoshan', 'xuechi', 'youguo', 'tiechuang', 'naihe'] as const;
type HellType = (typeof HELL_TYPES)[number];
const hellTypeOf = (i: number): HellType => HELL_TYPES[(i + Math.floor(i / 6)) % 6];

/** 单座狱体立面：月台 + 壁柱 + 阑额 + 双扇门/门钉 + 门楣匾框 + 锁链桩 + 檐下灯 + 按型械具 */
function hellFacade(
  b: Baker, sg: SignMesher, atlas: SignAtlas, i: number, h: (typeof HELLS)[number], y: number,
  ux: number, uz: number, vx: number, vz: number, ry: number,
): void {
  const t = hellTypeOf(i);
  const tag = 'hell.' + t;
  const y0 = y + 0.14;
  const at = (du: number, dv: number): [number, number] => [h.x + ux * du + vx * dv, h.z + uz * du + vz * dv];
  // 立面局部坐标摆件：w 沿墙面（v 向），d 沿墙法线（u 向）
  const W = (g: 'wood' | 'ash' | 'metal' | 'glow' | 'fabric' | 'ground', w: number, hh: number, d: number, du: number, dv: number, yy: number, hex: number): void => {
    const [px, pz] = at(du, dv);
    b.box(g, w, hh, d, px, yy, pz, hex, ry);
  };
  const frame: 'wood' | 'ash' | 'metal' = t === 'naihe' ? 'ash' : (t === 'bashe' || t === 'xuechi' ? 'wood' : 'metal');
  const frameHex = frame === 'metal' ? shade(COPPER, 0.78) : frame === 'wood' ? 0x4a3020 : shade(0x4e5860, 1.06);

  // 门前月台（把锁链桩与械具一起托住，避免立面件落在冥土面上）+ 四壁柱 + 阑额/地栿 + 门槛
  W('ground', 15.2, 0.2, 2.8, 9.4, 0, y + 0.1, shade(MIST, 0.52));
  for (const dv of [-7.2, -3.3, 3.3, 7.2]) W('ash', 0.54, 5.2, 0.36, 8.14, dv, y + 2.8, shade(0x4e5860, 1.02));
  W('ash', 15.4, 0.3, 0.4, 8.16, 0, y + 5.41, shade(0x3b424a, 1.08));
  W('ash', 15.4, 0.24, 0.4, 8.16, 0, y + 0.34, shade(0x3b424a, 0.94));
  W('ash', 5.8, 0.34, 0.7, 8.24, 0, y + 0.24, shade(0x4e5860, 1.12));
  b.kit(tag + '.pilaster', 4, y + 2.8);

  // 双扇狱门（v2）：门扇以铰链为轴半开 70°——旧版双扇紧闭，从环道正面只能看到一块门板，
  // 院内刑具（拔舌铁钳 / 油锅 / 刀山）全被门叶挡住，这是「十八层读不出」的首要成因。
  // 门钉与铺首挂在门叶局部坐标上，跟着铰链一起转，不在门洞里悬空。
  const DOOR_OPEN = 1.42;
  for (const s of [-1, 1]) {
    const d = -s * DOOR_OPEN;
    const [hx, hz] = at(8.2, s * 2.09);
    const rvx = -uz * Math.cos(d) + ux * Math.sin(d);   // 旋转后的 v̂
    const rvz = uz * Math.sin(d) + ux * Math.cos(d);
    /** 门叶局部点（du 沿用门洞坐标、dv 沿用立面坐标）→ 世界 */
    const leaf = (du0: number, dv0: number): [number, number] => {
      const hu = du0 - 8.2, hv = dv0 - s * 2.09;
      return [hx + hu * ux + hv * rvx, hz + hu * uz + hv * rvz];
    };
    const leafBox = (g: 'metal' | 'glow', w: number, hh: number, dd: number, du0: number, dv0: number, yy: number, hex: number): void => {
      const [px, pz] = leaf(du0, dv0);
      b.box(g, w, hh, dd, px, yy, pz, hex, ry + d);
    };
    leafBox('metal', 1.42, 3.3, 0.16, 8.2, s * 1.38, y0 + 1.65, shade(0x24242c, 1.0));
    for (let c = 0; c < 3; c++) for (let r2 = 0; r2 < 5; r2++) {
      leafBox('metal', 0.15, 0.15, 0.1, 8.31, s * 1.38 + (c - 1) * 0.42, y0 + 0.5 + r2 * 0.6, 0x8a8a94);
    }
    leafBox('metal', 0.3, 0.36, 0.1, 8.34, s * 0.78, y0 + 2.26, 0x6a6a74);
    leafBox('metal', 0.2, 0.07, 0.13, 8.4, s * 0.78, y0 + 2.08, 0x8a8a94);
    leafBox('glow', 0.18, 0.18, 0.06, 8.35, s * 1.38, y0 + 2.62, PHOS);
  }
  b.kit(tag + '.door', 2, y0 + 1.6);
  b.kit(tag + '.stud', 30, y0 + 1.6);

  // 门额匾：石背板 + 木/铁/石边框（旧匾贴在门楣背面，被封符与屋檐互穿）
  W('ash', 3.76, 1.24, 0.14, 8.42, 0, y + 4.9, shade(0x2a2622, 0.92));
  W(frame, 4.06, 0.3, 0.3, 8.44, 0, y + 5.42, frameHex);
  W(frame, 4.06, 0.22, 0.3, 8.44, 0, y + 4.38, frameHex);
  for (const s of [-1, 1]) W(frame, 0.26, 1.34, 0.3, 8.44, s * 1.9, y + 4.9, frameHex);
  const [qx, qz] = at(8.5, 0);
  sg.quad(atlas.text('hell' + i, h.name, 240, 76, {
    color: '#e8e3d5', bg: 'rgba(126,42,32,0.94)', border: 'rgba(201,179,128,.65)', fontPx: 50,
  }), 3.3, 0.94, qx, y + 4.9, qz, ry);
  b.kit(tag + '.lintel', 1, y + 4.9);

  // 封符改贴门柱正面（旧坐标在檐口以上，封符会穿出屋面悬空成排）
  for (let k = 0; k < h.seals; k++) {
    W('glow', 0.42, 0.26, 0.04, 8.34, (k % 2 ? 1 : -1) * 2.4, y0 + 0.72 + Math.floor(k / 2) * 0.34, k % 2 ? 0xc9b380 : 0xb03a2e);
  }

  // 按型门饰
  switch (t) {
    // 门缝血线：旧版画在门洞正中（x=0），门一开就成一条 3.1m 高的红柱横在院子中央、
    // 把刑具劈成两半（石磨/石壓等 bashe 型实测如此），改贴到两侧门柱上
    case 'bashe': for (const s of [-1, 1]) W('glow', 0.1, 3.1, 0.06, 8.32, s * 2.6, y0 + 1.6, RUST); break;
    case 'daoshan': for (const yy of [1.0, 2.6]) W('metal', 4.3, 0.16, 0.06, 8.34, 0, y0 + yy, 0x9a9aa2); break;
    case 'xuechi': W('glow', 4.5, 0.05, 0.62, 8.62, 0, y + 0.23, 0x5c1018); break;
    case 'youguo':
      for (const s of [-1, 1]) {
        W('metal', 0.12, 0.52, 0.12, 8.36, s * 2.88, y0 + 3.98, COPPER);
        W('metal', 0.26, 0.08, 0.13, 8.36, s * 2.88, y0 + 3.7, COPPER);
      }
      break;
    case 'tiechuang': for (let k = 0; k < 5; k++) W('metal', 0.09, 2.9, 0.09, 8.34, (k - 2) * 0.72, y0 + 1.55, 0x4a4a54); break;
    case 'naihe':
      for (const s of [-1, 1]) {
        W('wood', 0.9, 0.08, 0.08, 8.36, s * 2.72, y0 + 3.06, 0x3a2c22);
        W('fabric', 0.62, 1.7, 0.05, 8.44, s * 2.72, y0 + 2.2, 0xd8d0c0);
      }
      break;
  }

  // 檐下灯：挑梁挂在阑额上，重狱四盏（右盏演出红），其余两盏
  const lamps = h.heavy ? [-6.0, -4.2, 4.2, 6.0] : [-4.2, 4.2];
  for (const dv of lamps) {
    W('wood', 0.56, 0.1, 0.34, 8.33, dv, y + 5.52, 0x2a201a);
    const [lx, lz] = at(8.4, dv);
    b.box('metal', 0.05, 0.24, 0.05, lx, y + 5.36, lz, 0x3a3a42, ry);
    b.box('metal', 0.42, 0.07, 0.42, lx, y + 5.3, lz, 0x2a2622, ry);
    b.box('glow', 0.34, 0.46, 0.34, lx, y + 5.04, lz, h.heavy && dv > 0 ? RED : PHOS);
    b.box('metal', 0.3, 0.06, 0.3, lx, y + 4.78, lz, 0x2a2622, ry);
    b.kit(tag + '.eaveLamp', 1, y + 5.04);
  }

  // 两侧锁链桩：桩顶铁环垂三节链，链身贴桩外侧
  for (const s of [-1, 1]) {
    const [px, pz] = at(9.9, s * 4.7);
    b.box('ash', 0.94, 0.28, 0.94, px, y + 0.28, pz, shade(0x4e5860, 0.94), ry);
    b.cyl('wood', 0.17, 0.23, 1.9, 6, px, y + 1.36, pz, shade(0x241c16, 1.06));
    b.cyl('metal', 0.27, 0.27, 0.1, 8, px, y + 2.33, pz, 0x8a8a92);
    for (let k = 0; k < 3; k++) {
      const [cx2, cz2] = at(9.9 + (k % 2 ? 0.05 : -0.05), s * 5.0);
      b.box('metal', 0.14, 0.22, 0.07, cx2, y + 2.15 - k * 0.34, cz2, 0x9a9aa2, ry + (k % 2 ? 0.5 : -0.5));
    }
    b.kit(tag + '.chainPost', 1, y + 1.36);
  }

  // 两侧械具：一律直立构件，只叠 ry（复合欧拉角会被非等比缩放剪切）
  for (const s of [-1, 1]) {
    const dv0 = s * 6.9;
    switch (t) {
      case 'bashe': { // 铁钳架 + 舌状红雾
        W('ash', 1.2, 0.24, 1.2, 9.3, dv0, y + 0.26, shade(0x4e5860, 0.9));
        for (const q of [-1, 1]) W('metal', 0.15, 2.5, 0.15, 9.3, dv0 + q * 0.44, y + 1.62, 0x3a3a44);
        W('metal', 1.12, 0.16, 0.16, 9.3, dv0, y + 2.72, 0x4a4a54);
        for (const q of [-1, 1]) W('metal', 0.11, 1.8, 0.11, 9.16, dv0 + q * 0.16, y + 1.86, 0xa8a8b0);
        W('glow', 0.46, 0.07, 1.1, 8.66, dv0, y + 0.24, RUST);
        b.kit(tag + '.gear', 7, y + 1.6);
        break;
      }
      case 'daoshan': { // 三刀悬架
        W('ash', 1.0, 0.24, 1.0, 9.3, dv0, y + 0.26, shade(0x4e5860, 0.9));
        W('metal', 0.18, 2.4, 0.18, 9.3, dv0, y + 1.56, 0x3a3a44);
        W('metal', 2.2, 0.14, 0.14, 9.3, dv0, y + 2.66, 0x4a4a54);
        for (let k = 0; k < 3; k++) {
          W('metal', 0.26, 1.2, 0.06, 9.3, dv0 + (k - 1) * 0.62, y + 2.02, 0xb0b4bc);
          W('wood', 0.1, 0.42, 0.1, 9.3, dv0 + (k - 1) * 0.62, y + 2.83, 0x3a2c22);
        }
        b.kit(tag + '.gear', 8, y + 1.6);
        break;
      }
      case 'xuechi': { // 血缸 + 骨桩
        W('ash', 1.1, 0.22, 1.1, 9.3, dv0, y + 0.25, shade(0x4e5860, 0.9));
        const [bx2, bz2] = at(9.3, dv0);
        b.cyl('ceramic', 0.52, 0.42, 0.92, 10, bx2, y + 0.82, bz2, 0x4a3c33);
        b.cyl('glow', 0.46, 0.46, 0.08, 10, bx2, y + 1.26, bz2, 0x6e1f1f);
        for (let k = 0; k < 3; k++) W('ash', 0.12, 0.5, 0.12, 9.74, dv0 + (k - 1) * 0.26, y + 0.6, shade(BONE, 0.62));
        b.kit(tag + '.gear', 6, y + 0.9);
        break;
      }
      case 'youguo': { // 三石支锅 + 油面 + 双木柄
        for (let k = 0; k < 3; k++) {
          const a = k * 2.094;
          W('ash', 0.34, 0.44, 0.34, 9.3 + Math.cos(a) * 0.78, dv0 + Math.sin(a) * 0.78, y + 0.32, shade(0x4e5860, 0.95));
        }
        const [px2, pz2] = at(9.3, dv0);
        b.cyl('metal', 0.86, 0.66, 0.8, 12, px2, y + 0.92, pz2, shade(COPPER, 0.78));
        b.cyl('glow', 0.78, 0.78, 0.1, 12, px2, y + 1.26, pz2, 0x6b4226);
        for (const q of [-1, 1]) W('wood', 0.7, 0.1, 0.1, 9.3, dv0 + q * 1.0, y + 1.22, 0x3a2c22);
        b.kit(tag + '.gear', 7, y + 1.0);
        break;
      }
      case 'tiechuang': { // 铁床：四足 + 床板 + 三刺 + 双镣
        for (const q of [-1, 1]) for (const r2 of [-1, 1]) W('metal', 0.14, 0.66, 0.14, 9.3 + q * 0.62, dv0 + r2 * 0.5, y + 0.47, 0x3a3a44);
        W('metal', 1.9, 0.14, 1.3, 9.3, dv0, y + 0.87, 0x4a4a54);
        for (let k = 0; k < 3; k++) W('metal', 0.09, 0.5, 0.09, 9.3, dv0 + (k - 1) * 0.4, y + 1.19, 0xb0b4bc);
        for (const q of [-1, 1]) W('metal', 0.07, 0.46, 0.07, 9.3, dv0 + q * 0.62, y + 1.13, 0x8a8a92);
        b.kit(tag + '.gear', 10, y + 0.9);
        break;
      }
      case 'naihe': { // 忘川石 + 白幡
        W('ash', 1.0, 0.24, 0.9, 9.3, dv0, y + 0.26, shade(0x4e5860, 0.92));
        W('ash', 0.72, 2.1, 0.32, 9.3, dv0, y + 1.42, shade(0x4e5860, 1.08));
        W('ash', 0.94, 0.16, 0.44, 9.3, dv0, y + 2.5, shade(0x4e5860, 1.16));
        W('wood', 0.08, 2.6, 0.08, 9.5, dv0 - s * 0.86, y + 1.5, 0x201820);
        W('wood', 0.68, 0.07, 0.07, 9.5, dv0 - s * 0.56, y + 2.74, 0x3a2c22);
        W('fabric', 0.66, 1.5, 0.04, 9.5, dv0 - s * 0.28, y + 2.0, 0xd8d0c0);
        b.kit(tag + '.gear', 6, y + 1.5);
        break;
      }
    }
  }
}

/** 狱体环外空地：鬼差列位/磷火灯/刑具桩/锁链桩，每狱 7 件（静态 Baker，不占演员池） */
const RING_SLOTS: readonly (readonly [number, number])[] = [
  [-11.6, -10.8], [-11.6, 10.8], [-15.6, -3.6], [-15.6, 3.6], [-17.4, 0], [-13.2, -13.6], [-13.2, 13.6],
];

function ringFill(b: Baker, i: number, h: (typeof HELLS)[number], y: number, ux: number, uz: number, vx: number, vz: number, ry: number): void {
  RING_SLOTS.forEach(([du, dv], k) => {
    const x = h.x + ux * du + vx * dv;
    const z = h.z + uz * du + vz * dv;
    const face = ry + (k % 2 ? 0.9 : -0.9);
    switch ((i + k * 3) % 4) {
      case 0: { // 鬼差列位（剪影）
        b.box('wood', 0.54, 0.95, 0.36, x, y + 0.55, z, 0x1e2a26, face);
        b.box('wood', 0.64, 0.9, 0.4, x, y + 1.45, z, 0x243430, face);
        b.box('wood', 0.26, 0.28, 0.26, x, y + 2.03, z, 0x8fb898, face);
        b.box('wood', 0.66, 0.12, 0.66, x, y + 2.22, z, 0x1a1418, face);
        b.box('wood', 0.05, 2.4, 0.05, x + Math.cos(face) * 0.42, y + 1.2, z - Math.sin(face) * 0.42, 0x3a3a42, face);
        b.box('metal', 0.24, 0.28, 0.05, x + Math.cos(face) * 0.42, y + 2.5, z - Math.sin(face) * 0.42, 0x9aa6b8, face);
        b.box('glow', 0.07, 0.07, 0.07, x + Math.sin(face) * 0.14, y + 2.05, z + Math.cos(face) * 0.14, PHOS, face);
        b.kit('hell.ring.guard', 1, y + 1.1);
        break;
      }
      case 1: { // 磷火灯
        b.cyl('wood', 0.09, 0.13, 3.0, 6, x, y + 1.5, z, 0x1c141a);
        b.box('metal', 0.34, 0.1, 0.34, x, y + 3.02, z, 0x2a2622, face);
        b.box('metal', 0.3, 0.42, 0.3, x, y + 2.75, z, 0x2a2622, face);
        b.box('glow', 0.22, 0.3, 0.22, x, y + 2.75, z, PHOS);
        b.kit('hell.ring.lamp', 1, y + 2.75);
        break;
      }
      case 2: { // 刑具桩
        b.box('ash', 1.1, 0.26, 1.1, x, y + 0.13, z, shade(MIST, 0.9), face);
        b.cyl('wood', 0.22, 0.3, 2.9, 6, x, y + 1.7, z, shade(0x241c16, 1.08));
        for (const yy of [1.3, 2.3]) b.cyl('metal', 0.32, 0.32, 0.12, 8, x, y + yy, z, 0x6e5a3a);
        b.box('metal', 1.4, 0.1, 0.1, x, y + 2.9, z, 0x8a8a92, face);
        for (let q = 0; q < 3; q++) {
          const t2 = -0.42 + q * 0.42;
          b.box('metal', 0.1, 0.2, 0.08, x + Math.cos(face) * t2, y + 2.7 - q * 0.06, z - Math.sin(face) * t2, 0x9a9aa2, face);
        }
        b.box('glow', 0.66, 0.04, 0.66, x, y + 0.28, z, 0x5c1018);
        b.kit('hell.ring.punishPost', 1, y + 1.5);
        break;
      }
      default: { // 锁链桩
        b.box('ash', 0.86, 0.22, 0.86, x, y + 0.11, z, shade(MIST, 0.94), face);
        b.cyl('wood', 0.15, 0.22, 1.8, 6, x, y + 1.1, z, shade(0x241c16, 1.06));
        b.cyl('metal', 0.22, 0.22, 0.08, 8, x, y + 2.06, z, 0x9a9aa2);
        for (let q = 0; q < 4; q++) {
          b.box('metal', 0.12, 0.18, 0.06, x + Math.sin(face) * (0.28 + q * 0.3), y + 1.45 - q * 0.3, z + Math.cos(face) * (0.28 + q * 0.3), 0x8a8a92, face + (q % 2 ? 0.5 : -0.5));
        }
        b.kit('hell.ring.chain', 1, y + 1.0);
        break;
      }
    }
  });
}

/** 十八狱环总装（狱体 16×16×9 半地下 3m，狱门朝环心） */
export function buildEighteenHells(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  const cx = 0, cz = 55;
  HELLS.forEach((h, i) => {
    const dx = h.x - cx, dz = h.z - cz;
    const R = Math.hypot(dx, dz);
    const ux = -dx / R, uz = -dz / R; // 指向环心
    const vx = -uz, vz = ux;
    const ry = Math.atan2(ux, uz); // 门面朝环心
    // 狱体：半地下 3m + 地上 6m 空壳（背/侧墙 + 顶罩，正面朝环心敞开——原先是一个 16×16×9 实心盒，
    // 把 device() 做的刑具整套埋在里面，画面上只剩一个灰盒子，这就是"每狱只有名字"的根因）
    {
      const bw = 16, bd = 16, bh = 9, wt = 0.9;
      // 后墙（背离环心，local −z）
      b.box('wall', bw, bh, wt, h.x - ux * (bd / 2 - wt / 2), y + 1.5, h.z - uz * (bd / 2 - wt / 2), shade(BLACKB, 0.96), ry);
      // 两侧墙（local ±x）
      for (const s of [-1, 1]) {
        b.box('wall', wt, bh, bd, h.x + vx * s * (bw / 2 - wt / 2), y + 1.5, h.z + vz * s * (bw / 2 - wt / 2), shade(BLACKB, 0.9), ry);
      }
      // 顶罩只盖后 8m（辇前半敞，让环境光落进院内照出刑具），前半留天
      b.box('roof', bw, 0.8, 8, h.x - ux * 4, y + 6.2, h.z - uz * 4, 0x14161a, ry);
      // 院内背景光：后墙光带按本狱光色 + 地面光池（glow 自发光不受光，把院内提亮到「能读出刑具剪影」的档）
      const bx2 = h.x - ux * (bd / 2 - 1.2), bz2 = h.z - uz * (bd / 2 - 1.2);
      const tint = HELL_TINT[i % HELL_TINT.length];
      b.box('glow', 9.0, 1.9, 0.12, bx2, y + 2.6, bz2, shade(tint, 0.3), ry);
      b.box('glow', 7.0, 0.5, 0.12, bx2, y + 4.4, bz2, shade(tint, 0.15), ry);
      // 地面光池：径 6.4m 的一圈微光，让院内地面与刑具底座从冥土里浮出来
      b.cyl('glow', 6.4, 6.8, 0.05, 16, h.x - ux * 1.0, y + 0.14, h.z - uz * 1.0, shade(tint, 0.16));
      b.cyl('glow', 3.4, 3.6, 0.05, 14, h.x - ux * 1.0, y + 0.17, h.z - uz * 1.0, shade(tint, 0.26));
      for (const s of [-1, 1]) {
        b.box('glow', 0.3, 0.46, 0.3, h.x + vx * s * 5.6, y + 2.6, h.z + vz * s * 5.6, shade(tint, 0.6));
      }
      b.kit('hell.court', 1, y + 1.5);
    }
    b.box('ground', 15, 0.16, 15, h.x, y + 0.06, h.z, shade(MIST, 0.5), ry);
    b.pyramid('roof', 0.2, 0.8, h.x, y + 6.6, h.z, 0x14161a, ry, 15, 1.8, 15);
    // 门柱 + 门楣梁（门洞净宽 4.2，朝向环心）
    const gx = h.x + ux * 8, gz = h.z + uz * 8;
    b.box('wall', 0.6, 4.5, 0.6, gx + vx * 2.4, y + 2.25, gz + vz * 2.4, shade(0x33393f, 1.05));
    b.box('wall', 0.6, 4.5, 0.6, gx - vx * 2.4, y + 2.25, gz - vz * 2.4, shade(0x33393f, 1.05));
    b.box('wall', 5.4, 1.0, 0.7, gx, y + 4.9, gz, shade(BLACKB, 0.9), ry);
    // 立面（六狱型：双扇门/门钉/匾框/锁链桩/檐下灯/按型械具）
    hellFacade(b, sg, atlas, i, h, y, ux, uz, vx, vz, ry);
    // 逐狱装置 + 狱体环外空地填充
    device(b, i, h.x, y, h.z, ux, uz);
    ringFill(b, i, h, y, ux, uz, vx, vz, ry);
    // WS-25 狱门前灯柱（J4-29）：月台顶 y+0.20 上、门洞侧前方 du10.3 / dv2.9 一具（灯座 du 9.99–10.61，月台到 10.8）——
    // dv 5.4–6.1 的空档（锁链桩 4.7 与按型械具 6.9 之间）会被「油锅狱」三支石（dv 5.95 起）挤掉，
    // 故改贴门槛外侧（门槛 dv±2.9 @ du8.24、门柱 dv±2.4 @ du8），离立面 1.63m、不挡门洞
    {
      const du = 10.3, dv = 2.9;
      hellLampPost(
        b, h.x + ux * du + vx * dv, h.z + uz * du + vz * dv, y + 0.2,
        i % 6 === 5 ? 0x9d6bff : i % 3 === 0 ? 0x4d7cff : 0x3dff9c, 'hell.light.gateLamp', 3.6,
      );
    }
  });

  // ---- 狱道环：十八狱门以石道相连 + 界桩 + 路灯（旧版十八座狱各自孤立在暗地上） ----
  const doors = HELLS.map((h) => {
    const dx = h.x - cx, dz = h.z - cz;
    const R = Math.hypot(dx, dz);
    return { x: h.x - (dx / R) * 11.5, z: h.z - (dz / R) * 11.5 };
  });
  for (let i = 0; i < doors.length; i++) {
    const a = doors[i], c = doors[(i + 1) % doors.length];
    const mx2 = (a.x + c.x) / 2, mz2 = (a.z + c.z) / 2;
    const dx2 = c.x - a.x, dz2 = c.z - a.z;
    const len = Math.hypot(dx2, dz2);
    if (len < 1) continue;
    const ang = Math.atan2(dx2, dz2);
    b.box('ground', 7.0, 0.14, len + 2.2, mx2, y + 0.07, mz2, shade(MIST, 0.42), ang);
    b.box('ground', 2.4, 0.06, len + 2.0, mx2, y + 0.15, mz2, shade(BONE, 0.32), ang);
    b.kit('hell.road', 1, y);
    // 界桩：道心两侧各一根，桩头磷光
    for (const side of [-1, 1]) {
      const ox = Math.cos(ang) * side * 3.2, oz = -Math.sin(ang) * side * 3.2;
      b.box('wall', 0.5, 1.5, 0.5, mx2 + ox, y + 0.75, mz2 + oz, shade(0x33393f, 1.02), ang);
      b.box('glow', 0.16, 0.16, 0.16, mx2 + ox, y + 1.6, mz2 + oz, i % 3 === 0 ? RED : PHOS);
      b.kit('hell.post', 1, y + 0.75);
    }
    // 隔段路灯
    if (i % 2 === 0) {
      b.cyl('wood', 0.1, 0.14, 3.4, 6, mx2 + Math.cos(ang) * 4.6, y + 1.7, mz2 - Math.sin(ang) * 4.6, 0x1c141a);
      b.box('metal', 0.34, 0.5, 0.34, mx2 + Math.cos(ang) * 4.6, y + 3.5, mz2 - Math.sin(ang) * 4.6, 0x2a2622);
      b.box('glow', 0.24, 0.34, 0.24, mx2 + Math.cos(ang) * 4.6, y + 3.5, mz2 - Math.sin(ang) * 4.6, PHOS);
      b.kit('hell.lamp', 1, y + 3.5);
    }
    // 狱前石阶：门洞外两级
    for (let st = 0; st < 2; st++) {
      b.box('wall', 5.6 - st * 0.8, 0.28, 1.1, a.x, y + 0.14 + st * 0.26, a.z, shade(0x3a3a42, 1.0 + st * 0.03), ang);
    }
    b.kit('hell.step', 2, y + 0.3);
  }
}

/** 阎罗殿法庭内饰（47 卷 §八 R03/R06/R07/R08：台面上画）——配合 underworld.ts 空心化壳 */
export function buildYanluoInterior(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y + 2.6; // 台基顶
  const cx = 0, cz = 60;
  // 黑玉砖镜面（R03：42×22 整铺）
  b.box('glow', 41, 0.1, 21, cx, y + 0.06, cz, shade(0x1f1a14, 1.25));
  // 判官案（6×1.2×1.1 阴沉木+铜线磷光）+ 骨屏六扇
  b.box('wood', 6, 1.1, 1.2, cx, y + 0.55, cz - 6.5, 0x1f1a14);
  b.box('glow', 5.6, 0.05, 0.05, cx, y + 1.12, cz - 6.1, PHOS);
  for (let k = 0; k < 6; k++) b.box('wood', 0.8, 2.6, 0.08, cx - 2.5 + k * 1.0, y + 1.3, cz - 8.6, BONE);
  b.box('wood', 5.4, 0.25, 0.2, cx, y + 2.7, cz - 8.6, shade(0x33393f, 1.1));
  // 生死簿架（高 4.2 十二格，R06 西侧）
  b.box('wood', 0.8, 4.2, 5, -14, y + 2.1, cz - 4, 0x1f1a14);
  for (let k = 0; k < 5; k++) b.box('glow', 0.82, 0.06, 4.6, -14, y + 0.8 + k * 0.8, cz - 4, 0xc9b380);
  // 孽镜台（径 1.6 座高 3.6 立西壁，R07）
  b.box('wall', 1.2, 3.6, 1.2, -18, y + 1.8, cz + 3, shade(0x33393f, 1.05));
  b.cyl('glow', 0.8, 0.8, 0.12, 16, -18, y + 3.2, cz + 3.65, shade(COPPER, 1.2), 0, Math.PI / 2);
  b.box('glow', 1.5, 1.9, 0.05, -17.9, y + 2.2, cz + 3.7, RUST, 0, 0, 0);
  // 白烛阵（R03：案前七七 49→代表性 12 支绿焰三档）
  for (let k = 0; k < 12; k++) {
    const a = k * 0.523;
    b.box('glow', 0.12, 0.7, 0.12, cx + Math.cos(a) * (1.5 + k % 3), y + 0.4, cz - 4.5 + Math.sin(a) * 1.5, k % 3 ? PHOS : ICEC);
  }
  // 地藏龛（R08 北正中：石像+锡杖+长明暖白）
  b.box('wall', 3, 3.4, 1, cx, y + 1.7, cz - 10.2, shade(0x33393f, 1.02));
  b.box('glow', 0.7, 1.6, 0.2, cx, y + 1.1, cz - 10.1, BONE);
  b.box('glow', 0.5, 0.7, 0.4, cx, y + 2.6, cz - 10.1, 0xe8f0ff);
  // 楹联东西（联底暗朱 字骨白）；西/东庑隔墙立起后原 x=±12.5 会被庑房顶棚埋掉一半，内收到大堂堂心
  sg.quad(atlas.text('ylianE', '陽世三間積善作惡皆由你', 640, 80, { color: '#e8e3d5', bg: 'rgba(126,42,32,0.95)', fontPx: 54 }), 8.4, 1.1, -6.6, y + 6.5, cz - 9.3, 0);
  sg.quad(atlas.text('ylianW', '古往今來陰曹地府放過誰', 640, 80, { color: '#e8e3d5', bg: 'rgba(126,42,32,0.95)', fontPx: 54 }), 8.4, 1.1, 6.6, y + 6.5, cz - 9.3, 0);
  // 业雾穹顶意象（中环垂骨璎珞数串）
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785;
    b.box('glow', 0.06, 0.7, 0.06, cx + Math.cos(a) * 3.5, y + 7.2, cz - 6.5 + Math.sin(a) * 3.5, PHOS);
  }
}

/** 孟婆庄主棚（47 卷 §十 R01-R05 + 30 卷 D-GZ-003 (-40,-132)） */
export function buildMengpoZhuang(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  const mx = -40, mz = -132;
  // 台基 + 主棚 8×6（坐西朝东：门朝 +x）
  b.box('ground', 12, 0.3, 10, mx, y + 0.15, mz, shade(MIST, 0.5));
  for (const px of [-3, 0, 3]) for (const pz of [-2.6, 2.6]) {
    b.box('wood', 0.3, 3.4, 0.3, mx + px, y + 1.7, mz + pz, 0x1f1a14);
  }
  b.roofC('roof', mx, y + 3.9, mz, 0x1a1c20, 0, 9.5, 1.6, 7.5);
  b.box('wall', 0.4, 3.4, 6, mx - 3.8, y + 1.7, mz, shade(BLACKB, 0.95));
  b.box('wall', 0.4, 3.4, 6, mx + 3.8, y + 1.7, mz, shade(BLACKB, 0.95));
  // 汤锅（径 2.4 铜三石支，D-ITM-0030）
  b.cyl('wood', 1.2, 1.0, 0.8, 10, mx - 1.5, y + 0.55, mz, shade(0x26282c, 0.95));
  b.cyl('glow', 1.05, 1.05, 0.12, 10, mx - 1.5, y + 0.98, mz, 0x6b4226);
  for (let k = 0; k < 3; k++) { const a = k * 2.094; b.box('wood', 0.35, 0.4, 0.35, mx - 1.5 + Math.cos(a) * 1.05, y + 0.2, mz + Math.sin(a) * 1.05, shade(0x33393f, 1.05)); }
  // 灶膛双眼（左沸右温）
  b.box('wall', 1.6, 0.9, 1.2, mx + 1.5, y + 0.45, mz - 1.6, 0x4a3c33);
  b.box('glow', 0.5, 0.3, 0.1, mx + 1.2, y + 0.5, mz - 1.02, 0x6b4226);
  b.box('glow', 0.4, 0.2, 0.1, mx + 1.8, y + 0.5, mz - 1.02, shade(0x6b4226, 0.7));
  // 碗架三层 108 粗陶碗（D-ITM-0031，缺角 36 意象用暗档色）
  b.box('wood', 0.5, 2.4, 3.4, mx - 3.4, y + 1.2, mz + 1.6, 0x4a3c33);
  let bowls = 0;
  for (let layer = 0; layer < 3; layer++) for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++, bowls++) {
    b.cyl('wood', 0.09, 0.06, 0.08, 5, mx - 3.05, y + 0.55 + layer * 0.8, mz + 0.25 + r * 0.28 + 0, shade(0x8a7a6a, bowls % 3 === 0 ? 0.8 : 1));
  }
  // 孟婆位（蒲团+小几+茶账）
  b.cyl('wood', 0.4, 0.45, 0.18, 8, mx - 2.2, y + 0.09, mz - 1.8, 0x4a3c33);
  b.box('wood', 0.8, 0.5, 0.5, mx - 2.4, y + 0.25, mz - 0.8, 0x1f1a14);
  // 绿灯笼对（D-ITM-0041 檐下）
  for (const s of [-1, 1]) b.box('glow', 0.28, 0.38, 0.28, mx + 3.6, y + 2.6, mz + s * 2.2, PHOS);
  // 招幌「湯」（P-13 骨纹底）
  sg.quad(atlas.text('mengpoT', '湯', 96, 96, { color: '#e8e3d5', glow: '#3dff9c', bg: 'rgba(20,10,16,0.9)', fontPx: 64 }), 1.1, 1.1, mx + 4.1, y + 2.9, mz, Math.PI / 2);
  // 后圃忘忧曼陀罗两丛（D-PLT-006 红瓣微光）
  for (const dx of [-2, 1]) for (let k = 0; k < 4; k++) {
    b.box('glow', 0.12, 0.3, 0.12, mx + dx + k * 0.3, y + 0.3, mz - 4.5 - (k % 2) * 0.4, RUST);
  }

  // ---- 庄前汤棚：桌凳、排队栏、幡灯、水缸与铺装（旧版只有一座孤棚） ----
  b.box('ground', 32, 0.06, 26, mx + 2, y + 0.03, mz - 1, 0x26222a);
  b.box('ground', 4.2, 0.04, 22, mx + 4.6, y + 0.07, mz - 1, shade(0x6e6a60, 0.9));
  b.kit('mengpo.paving', 1, y);
  // 引路：庄前向奈何桥方向接骨白路
  b.box('ground', 46, 0.04, 3.8, mx + 23, y + 0.05, mz + 2, shade(0x6e6a60, 0.86));
  b.kit('mengpo.path', 1, y);
  // 汤棚：四柱 + 布顶（庄东侧）
  for (const px of [-2.6, 2.6]) for (const pz of [-2.0, 2.0]) {
    b.cyl('wood', 0.11, 0.15, 3.2, 6, mx + 7.4 + px, y + 1.6, mz + 1.5 + pz, 0x241c16);
  }
  // 双坡布顶（单张平板会读成一块悬空紫板）+ 正脊 + 檐口压条
  for (const sz of [-1, 1]) {
    b.box('fabric', 6.2, 0.07, 2.6, mx + 7.4, y + 3.22, mz + 1.5 + sz * 1.18, 0x4a3f30, 0, sz * 0.26, 0);
  }
  b.box('wood', 6.5, 0.16, 0.18, mx + 7.4, y + 3.56, mz + 1.5, 0x2a201a);
  for (const sz of [-1, 1]) b.box('wood', 6.4, 0.1, 0.1, mx + 7.4, y + 2.92, mz + 1.5 + sz * 2.35, 0x2a201a);
  b.kit('mengpo.canopy', 1, y + 3.3);
  // 长桌两张 + 长凳四条
  for (const [tx, tz] of [[mx + 6.2, mz + 2.6], [mx + 8.8, mz + 2.6]] as const) {
    b.box('wood', 2.0, 0.1, 0.9, tx, y + 0.82, tz, 0x4a3c33);
    for (const sx of [-1, 1]) b.box('wood', 0.1, 0.78, 0.1, tx + sx * 0.8, y + 0.4, tz + 0.3, 0x2a201a);
    b.kit('mengpo.table', 1, y + 0.8);
    for (const sz of [-1, 1]) {
      b.box('wood', 1.8, 0.08, 0.34, tx, y + 0.48, tz + sz * 0.85, 0x3a2c22);
      b.box('wood', 0.08, 0.46, 0.08, tx - 0.75, y + 0.23, tz + sz * 0.85, 0x2a201a);
      b.box('wood', 0.08, 0.46, 0.08, tx + 0.75, y + 0.23, tz + sz * 0.85, 0x2a201a);
      b.kit('mengpo.bench', 1, y + 0.45);
    }
    // 碗与残汤
    for (let i = 0; i < 3; i++) b.cyl('ceramic', 0.14, 0.1, 0.1, 8, tx - 0.6 + i * 0.6, y + 0.92, tz - 0.1, 0x8a7a6a);
    b.cyl('glow', 0.16, 0.12, 0.04, 8, mx + 6.2, y + 0.95, mz + 2.6, 0x6b4226);
  }
  // 排队栏：铁柱 + 红绳（亡魂排队意象）
  for (let i = 0; i < 5; i++) {
    const qz = mz + 5.4 - i * 1.6;
    for (const sx of [-1, 1]) {
      b.cyl('metal', 0.06, 0.08, 1.0, 6, mx + 6.4 + sx * 0.9, y + 0.5, qz, 0x3a3640);
      if (i < 4) b.box('glow', 0.03, 0.03, 1.6, mx + 6.4 + sx * 0.9, y + 0.86, qz - 0.8, 0x9d2933);
    }
    b.kit('mengpo.queuePost', 2, y + 0.5);
  }
  // 招幡两杆 + 四盏绿灯笼
  for (const sx of [-1, 1]) {
    const bx2 = mx + 4.2, bz2 = mz + (sx > 0 ? 3.4 : -3.2);
    b.cyl('wood', 0.08, 0.12, 4.4, 6, bx2, y + 2.2, bz2, 0x201820);
    // 幡面挂在杆侧、正面朝路（旧版飘在杆外且朝向随意）
    b.box('fabric', 1.0, 2.0, 0.04, bx2 + 0.02, y + 3.3, bz2 + 0.55, 0x2a5c42, 0);
    b.box('wood', 0.08, 0.08, 1.12, bx2, y + 4.32, bz2 + 0.5, 0x3a2c22);
    b.kit('mengpo.banner', 1, y + 3.3);
  }
  for (const [lx, lz] of [[mx + 3.7, mz + 2.2], [mx + 3.7, mz - 2.2], [mx + 7.4, mz + 4.0], [mx + 7.4, mz - 1.0]] as const) {
    b.box('glow', 0.24, 0.34, 0.24, lx, y + 2.7, lz, PHOS);
    b.box('wood', 0.03, 0.5, 0.03, lx, y + 2.95, lz, 0x2a201a);
    b.kit('mengpo.lantern', 1, y + 2.7);
  }
  // 水缸三具与柴堆
  for (let i = 0; i < 3; i++) b.cyl('ceramic', 0.42, 0.34, 0.8, 10, mx - 5.6 + i * 1.1, y + 0.4, mz + 3.4, 0x4a4a52);
  for (let i = 0; i < 8; i++) b.box('wood', 0.9, 0.14, 0.16, mx - 4.8, y + 0.1 + i * 0.15, mz - 4.6, 0x3a2c22, 0.1 * (i % 3));
  b.kit('mengpo.waterJar', 3, y + 0.4);
  b.kit('mengpo.firewood', 8, y + 0.5);

  buildMengpoRooms(b);
}

/** 孟婆庄室内壳 R01–R07：汤棚/主棚收壳 + 北侧庄院四房与后圃廊 */
export function buildMengpoRooms(b: Baker): void {
  const y = UNDER.y;
  const cy = y + 0.14;   // 庄院地面
  const fy = y + 0.3;    // 主棚台基顶
  let n = 0;

  // ---- 庄院外形：台基 + 四壁 + 檐下灯 + 屋面 ----
  b.box('ash', 25.2, 0.1, 21.2, -40, y + 0.05, -148, shade(INP.rough, 0.9));
  inWall(b, -52, -138, -28, -138, cy, 4.4, 0.6, INP.brickD, [[11, 13]]);
  inWall(b, -52, -158, -28, -158, cy, 4.4, 0.6, INP.brickD, [[11, 13]]);
  inWall(b, -52, -158, -52, -138, cy, 4.4, 0.6, INP.brickD);
  inWall(b, -28, -158, -28, -138, cy, 4.4, 0.6, INP.brickD);
  roofOn(b, 27.6, 23.6, cy + 4.4, -40, -148, 0, 0x14161a, PHOS);
  for (const [lx, lz] of [[-40, -138.4], [-50, -157.6], [-30, -157.6]] as const) inLantern(b, lx, lz, cy + 3.9, PHOS);
  b.kit('mengpo.zhuang', 4, cy);

  // ---- R01 棚前歇脚场（既有汤棚收壳：北/东墙 + 正面格栅 + 黑梁顶） ----
  n = inFloor(b, -32.6, -130.5, 6.0, 4.9, y + 0.14, INP.rough, 1.5);
  n += inWall(b, -35.6, -132.6, -29.6, -132.6, y, 3.0, 0.36, INP.brick, [[2.4, 3.9]]);
  n += inWall(b, -29.6, -132.6, -29.6, -128.6, y, 3.0, 0.36, INP.brick);
  n += inSkirt(b, -35.4, -132.4, -29.8, -132.4, y);
  n += inSkirt(b, -29.4, -132.4, -29.4, -128.8, y);
  n += inLattice(b, -35.6, -128.6, -29.6, -128.6, y, 3.0);
  n += inVeil(b, -34.4, -128.6, -30.8, -128.6, y + 2.6, 0.8, INP.cloth2);
  n += inDoor(b, -32.6, -132.6, y, 1.5, 2.6, 0);
  n += inWindow(b, -29.42, -130.6, y + 1.1, 1.3, 1.2, Math.PI / 2, true);
  n += inBench(b, -33.9, -131.9, y + 0.14, 1.7, 0);
  n += inBench(b, -31.3, -131.9, y + 0.14, 1.7, 0);
  n += inTable(b, -34.4, -129.9, y + 0.14, 1.2, 0.7, 0.6);
  n += inTable(b, -30.9, -129.9, y + 0.14, 1.2, 0.7, 0.6);
  for (const [bx2, bz2] of [[-34.4, -129.9], [-30.9, -129.9]] as const) {
    b.cyl('ceramic', 0.12, 0.09, 0.1, 8, bx2, y + 0.79, bz2, 0x8a7a6a);
    b.cyl('glow', 0.13, 0.1, 0.03, 8, bx2 + 0.3, y + 0.78, bz2, 0x6b4226);
    n += 2;
  }
  n += inLamp(b, -35.0, -128.9, y + 0.14, 1.6);
  n += inCushion(b, -34.8, -130.9, y + 0.14, 0.4);
  n += inJar(b, -30.2, -128.9, y + 0.14, 0.8);
  for (const bz3 of [-131.6, -130.5, -129.4]) {
    b.box('wood', 5.9, 0.18, 0.16, -32.6, y + 2.94, bz3, INP.wood);
    n++;
  }
  b.box('wood', 0.16, 0.16, 4.1, -32.6, y + 3.05, -130.5, INP.wood2);
  n++;
  b.kit('interior.mengpo.R01', n, y);

  // ---- R02 主棚茶堂（既有棚体收壳：侧墙裙 + 北门 + 直棂窗 + 顶棚 + 连廊） ----
  n = inPaveLines(b, -40, -132, 6.6, 4.6, fy + 0.02, 1.5);
  n += inWall(b, -43.6, -134.4, -36.4, -134.4, fy, 3.2, 0.34, INP.brick, [[1.8, 3.6]]);
  n += inDoor(b, -40, -134.4, fy, 1.8, 3.0, 0);
  n += inSkirt(b, -43.55, -134.2, -43.55, -129.6, fy);
  n += inSkirt(b, -36.45, -134.2, -36.45, -129.6, fy);
  n += inWindow(b, -43.62, -132.0, fy + 1.1, 1.4, 1.3, Math.PI / 2, true);
  n += inWindow(b, -36.38, -132.0, fy + 1.1, 1.4, 1.3, Math.PI / 2, true);
  n += inLattice(b, -43.6, -129.5, -36.4, -129.5, fy, 3.0);
  n += inVeil(b, -42.2, -129.5, -38.9, -129.5, fy + 2.6, 0.8, INP.cloth);
  n += inCeil(b, -40, -132, 7.1, 4.9, fy + 3.1, 1);
  n += inCushion(b, -41.2, -130.4, fy, 0.42);
  n += inCushion(b, -38.8, -130.4, fy, 0.42);
  n += inLamp(b, -39.4, -129.9, fy, 1.8);
  n += inTable(b, -38.2, -131.0, fy, 1.3, 0.7, 0.62);
  n += inScrolls(b, -38.2, -131.0, fy + 0.66, 2);
  n += inRack(b, -43.0, -133.6, fy, Math.PI / 2, 2.2, 2.6, 2, 'bone');
  // 棚后连廊（主棚北门 → 庄院南门），把两进院子接成一条动线
  inFloor(b, -40, -136.2, 3.2, 3.6, cy, INP.rough, 1.2);
  inWall(b, -41.6, -138.2, -41.6, -134.4, cy, 3.0, 0.3, INP.brick);
  inWall(b, -38.4, -138.2, -38.4, -134.4, cy, 3.0, 0.3, INP.brick);
  inCeil(b, -40, -136.3, 3.2, 3.8, cy + 3.0, 1);
  b.kit('interior.mengpo.R02', n, fy);

  // ---- R03 灶间（庄院西南）：三眼灶 + 双汤锅 + 水缸 + 柴堆 ----
  n = inFloor(b, -47.85, -143.15, 7.7, 9.4, cy, INP.rough, 1.6);
  n += inSkirt(b, -51.5, -138.6, -44.4, -138.6, cy);
  n += inSkirt(b, -51.5, -138.6, -51.5, -147.7, cy);
  n += inStove(b, -48.4, -139.4, cy, 3.2, 0);
  n += inCauldron(b, -50.4, -141.8, cy, 0.95);
  n += inCauldron(b, -46.4, -141.8, cy, 0.95);
  n += inJar(b, -50.8, -146.6, cy, 1.0);
  n += inJar(b, -49.0, -146.6, cy, 0.85);
  for (let k = 0; k < 6; k++) {
    b.box('wood', 0.9, 0.14, 0.16, -45.6, cy + 0.1 + k * 0.15, -145.2 + (k % 2) * 0.2, 0x3a2c22, 0.12 * (k % 3));
    n++;
  }
  n += inBowlRack(b, -44.9, -142.4, cy, -Math.PI / 2, 2.4, 15);
  n += inDoor(b, -44.0, -144.3, cy, 1.8, 3.0, Math.PI / 2);
  n += inWindow(b, -51.66, -142.4, cy + 1.2, 1.4, 1.3, Math.PI / 2, true);
  n += inLamp(b, -51.0, -143.8, cy, 1.9);
  n += inChainStake(b, -45.2, -147.0, cy, -Math.PI / 2);
  n += inCeil(b, -47.85, -143.15, 7.7, 9.4, cy + 3.4, 1);
  b.kit('interior.mengpo.R03', n, cy);

  // ---- R04 孟婆位房（庄院西北）：蒲团 + 小几 + 茶账 + 骨器 ----
  n = inFloor(b, -47.85, -152.85, 7.7, 9.4, cy, INP.rough, 1.6);
  n += inSkirt(b, -51.5, -157.4, -44.4, -157.4, cy);
  n += inSkirt(b, -51.5, -157.4, -51.5, -148.3, cy);
  n += inVeil(b, -51.2, -157.2, -44.6, -157.2, cy, 3.0, INP.cloth);
  n += inDoor(b, -44.0, -150.5, cy, 1.8, 3.0, Math.PI / 2);
  n += inWindow(b, -51.66, -152.4, cy + 1.2, 1.4, 1.3, Math.PI / 2, true);
  n += inRack(b, -47.8, -156.9, cy, 0, 2.6, 3.0, 3, 'bone');
  n += inAltar(b, -50.2, -154.4, cy, Math.PI / 2, 2.2);
  n += inTable(b, -47.2, -151.6, cy, 1.6, 0.8, 0.64);
  n += inScrolls(b, -47.2, -151.6, cy + 0.68, 3);
  n += inSealBox(b, -46.4, -151.6, cy + 0.68);
  n += inCushion(b, -47.2, -152.9, cy, 0.44);
  n += inCushion(b, -48.8, -152.9, cy, 0.4);
  n += inLamp(b, -45.2, -156.6, cy, 1.9);
  n += inLamp(b, -51.0, -149.4, cy, 1.9);
  n += inCeil(b, -47.85, -152.85, 7.7, 9.4, cy + 3.4, 1);
  b.kit('interior.mengpo.R04', n, cy);

  // ---- R05 碗架库（庄院东南）----
  n = inFloor(b, -32.15, -143.15, 7.7, 9.4, cy, INP.rough, 1.6);
  n += inSkirt(b, -28.5, -138.6, -35.6, -138.6, cy);
  n += inSkirt(b, -28.5, -138.6, -28.5, -147.7, cy);
  n += inBowlRack(b, -29.2, -140.6, cy, -Math.PI / 2, 2.6, 18);
  n += inBowlRack(b, -29.2, -144.4, cy, -Math.PI / 2, 2.6, 18);
  n += inBowlRack(b, -35.2, -140.6, cy, Math.PI / 2, 2.4, 15);
  for (const [jx, jz] of [[-34.4, -146.4], [-32.9, -146.4], [-31.4, -146.4], [-34.4, -147.4]] as const) n += inJar(b, jx, jz, cy, 0.85);
  n += inRack(b, -32.2, -147.2, cy, 0, 2.4, 2.8, 3, 'scroll');
  n += inDoor(b, -36.0, -144.3, cy, 1.8, 3.0, Math.PI / 2);
  n += inWindow(b, -28.34, -142.4, cy + 1.2, 1.4, 1.3, Math.PI / 2, true);
  n += inLamp(b, -35.2, -144.2, cy, 1.9);
  n += inLamp(b, -34.6, -138.8, cy, 1.9);
  n += inCeil(b, -32.15, -143.15, 7.7, 9.4, cy + 3.4, 1);
  b.kit('interior.mengpo.R05', n, cy);

  // ---- R06 值夜帐房（庄院东北）：草榻 + 小几 + 锁链桩 ----
  n = inFloor(b, -32.15, -152.85, 7.7, 9.4, cy, INP.rough, 1.6);
  n += inSkirt(b, -35.6, -157.4, -28.5, -157.4, cy);
  n += inSkirt(b, -28.5, -148.3, -28.5, -157.4, cy);
  n += inPallet(b, -30.9, -153.8, cy, Math.PI / 2);
  n += inTable(b, -33.4, -150.6, cy, 1.4, 0.75, 0.62);
  n += inScrolls(b, -33.4, -150.6, cy + 0.66, 2);
  n += inCushion(b, -33.4, -152.2, cy, 0.42);
  n += inRack(b, -32.6, -157.0, cy, 0, 2.4, 2.8, 2, 'bone');
  n += inChainStake(b, -35.0, -156.4, cy, Math.PI / 2);
  n += inDoor(b, -36.0, -150.5, cy, 1.8, 3.0, Math.PI / 2);
  n += inWindow(b, -28.34, -152.4, cy + 1.2, 1.4, 1.3, Math.PI / 2, true);
  n += inLamp(b, -29.4, -156.4, cy, 1.9);
  n += inLamp(b, -30.4, -149.6, cy, 1.9);
  n += inChain(b, -32.2, cy + 3.4, -155.2, 1.4, 1);
  n += inCeil(b, -32.15, -152.85, 7.7, 9.4, cy + 3.4, 1);
  b.kit('interior.mengpo.R06', n, cy);

  // ---- R07 后圃小径（庄院中廊）：曼陀罗两丛 + 石灯 + 香案 + 纱帘 ----
  n = inFloor(b, -40, -148, 8.0, 19.4, cy, 0x2e2a30, 2.0);
  n += inSkirt(b, -44.15, -138.4, -44.15, -157.6, cy);
  n += inSkirt(b, -35.85, -138.4, -35.85, -157.6, cy);
  n += inDoor(b, -40, -138.15, cy, 1.8, 3.0, 0);
  n += inDoor(b, -40, -157.85, cy, 1.8, 3.0, 0);
  for (const [gx, gz] of [[-42.4, -152.4], [-37.6, -146.4]] as const) {
    for (let k = 0; k < 5; k++) {
      b.box('glow', 0.12, 0.34, 0.12, gx + (k % 3) * 0.34 - 0.34, cy + 0.28, gz + Math.floor(k / 3) * 0.36, k % 2 ? RUST : shade(RUST, 0.8));
      n++;
    }
    b.box('ash', 1.5, 0.16, 1.1, gx, cy + 0.08, gz + 0.1, INP.roughD);
    n++;
  }
  for (const lz of [-155.4, -148.0, -140.6]) n += inLamp(b, -40, lz, cy, 2.0);
  n += inAltar(b, -40, -155.4 + 5.4, cy, 0, 2.6);
  n += inCushion(b, -41.4, -149.2, cy, 0.42);
  n += inCushion(b, -38.6, -149.2, cy, 0.42);
  for (let k = 0; k < 5; k++) {
    b.box('fabric', 0.7, 2.2 - (k % 3) * 0.18, 0.05, -43.0 + k * 1.5, cy + 2.0, -157.3, k % 2 ? INP.cloth : shade(INP.cloth, 1.3));
    n++;
  }
  n += inJar(b, -43.0, -140.2, cy, 0.9);
  n += inJar(b, -37.0, -140.2, cy, 0.9);
  n += inCeil(b, -40, -148, 8.0, 19.4, cy + 3.6, 4);
  b.kit('interior.mengpo.R07', n, cy);
}

/**
 * 十八狱环境粒子：**一个 Points 承载全部 18 层**（新增 draw call = 1，不是每层 1 个），
 * 顶点着色器按 uTime 做程序化循环（火焰上升 / 雾团漂移 / 虫群绕圈 / 冰晶浮动 / 火星四溅 / 血滴下落），
 * 不用贴图、不加材质组。亮度在 onBeforeRender 里按 world.applyHellDepth 的同一公式随镜头深度衰减，
 * 保证最深处只剩少量冷光点，不破坏「伸手不见五指」。
 */
type HellFxKind = 0 | 1 | 2 | 3 | 4 | 5; // 0 焰 / 1 雾 / 2 虫群 / 3 冰晶 / 4 火星 / 5 血滴
/** 逐狱 [主特效, 数量, 半径, 高度, 颜色, 速度] + 可选副特效 */
const HELL_FX: readonly { k: HellFxKind; n: number; r: number; h: number; hex: number; spd: number }[][] = [
  [{ k: 1, n: 26, r: 3.0, h: 1.6, hex: 0x8a1a1a, spd: 0.16 }, { k: 4, n: 14, r: 2.2, h: 2.2, hex: 0x3dff9c, spd: 0.5 }],
  [{ k: 4, n: 30, r: 2.6, h: 2.6, hex: 0xbaffef, spd: 0.7 }],
  [{ k: 4, n: 22, r: 2.8, h: 3.0, hex: 0x9ad8ff, spd: 0.9 }, { k: 5, n: 12, r: 2.2, h: 2.4, hex: 0xff5a5a, spd: 0.35 }],
  [{ k: 1, n: 24, r: 3.2, h: 2.0, hex: 0xffd9a0, spd: 0.14 }],
  [{ k: 1, n: 34, r: 2.0, h: 4.0, hex: 0xdfe8e0, spd: 0.2 }],
  [{ k: 0, n: 30, r: 2.4, h: 3.4, hex: 0xff7a2d, spd: 0.6 }, { k: 4, n: 16, r: 2.6, h: 3.0, hex: 0xffb347, spd: 0.8 }],
  [{ k: 1, n: 22, r: 3.2, h: 1.8, hex: 0x8a1a1a, spd: 0.15 }, { k: 4, n: 18, r: 3.0, h: 2.6, hex: 0x3dff9c, spd: 0.55 }],
  [{ k: 3, n: 30, r: 3.0, h: 3.2, hex: 0xd8f4ff, spd: 0.28 }],
  [{ k: 0, n: 40, r: 2.6, h: 3.6, hex: 0xff7a2d, spd: 0.75 }],
  [{ k: 1, n: 20, r: 3.2, h: 1.4, hex: 0x8a6a3a, spd: 0.18 }, { k: 5, n: 10, r: 2.4, h: 2.0, hex: 0xff5a5a, spd: 0.4 }],
  [{ k: 1, n: 20, r: 3.0, h: 2.6, hex: 0xb8c0c8, spd: 0.22 }],
  [{ k: 1, n: 18, r: 2.8, h: 2.0, hex: 0xd8c8a8, spd: 0.2 }, { k: 5, n: 10, r: 2.4, h: 1.8, hex: 0xe8e3d5, spd: 0.3 }],
  [{ k: 1, n: 26, r: 3.2, h: 1.2, hex: 0x8a1020, spd: 0.14 }, { k: 5, n: 14, r: 2.8, h: 2.0, hex: 0xff3a4a, spd: 0.45 }],
  [{ k: 1, n: 22, r: 3.0, h: 2.4, hex: 0x6affc8, spd: 0.16 }, { k: 4, n: 14, r: 2.4, h: 2.8, hex: 0x6affc8, spd: 0.4 }],
  [{ k: 1, n: 20, r: 2.8, h: 1.8, hex: 0x8a1a1a, spd: 0.16 }, { k: 4, n: 16, r: 2.4, h: 3.0, hex: 0x9ad8ff, spd: 0.85 }],
  [{ k: 0, n: 38, r: 3.0, h: 4.2, hex: 0xff6a1a, spd: 0.8 }],
  [{ k: 1, n: 18, r: 3.0, h: 2.0, hex: 0xb8ab98, spd: 0.2 }, { k: 4, n: 10, r: 2.2, h: 1.8, hex: 0xffc94a, spd: 0.6 }],
  [{ k: 4, n: 26, r: 2.8, h: 2.6, hex: 0xffd9a0, spd: 0.9 }, { k: 1, n: 16, r: 3.0, h: 1.6, hex: 0x8fb8d8, spd: 0.18 }],
];

function installHellFx(crowd: { mesh?: THREE.Object3D }): void {
  const scene = crowd.mesh?.parent;
  if (!scene || (scene as THREE.Object3D & { __hellFx?: boolean }).__hellFx) return;
  (scene as THREE.Object3D & { __hellFx?: boolean }).__hellFx = true;
  const P: number[] = [], C: number[] = [], S: number[] = [], K: number[] = [], SD: number[] = [], R: number[] = [], H: number[] = [], SP: number[] = [];
  const col = new THREE.Color();
  HELLS.forEach((h, i) => {
    const dx = h.x, dz = h.z - 55, R0 = Math.hypot(dx, dz);
    const ux = -dx / R0, uz = -dz / R0, vx = -uz, vz = ux;
    for (const fx of HELL_FX[i % HELL_FX.length]) {
      col.setHex(fx.hex);
      for (let k = 0; k < fx.n; k++) {
        const a = k * 2.39996, rr = fx.r * (0.15 + ((k * 61) % 100) / 120);
        const du = -1.0 + Math.cos(a) * rr, dv = Math.sin(a) * rr;
        P.push(h.x + ux * du + vx * dv, UNDER.y + 0.3 + ((k * 37) % 100) / 100 * fx.h * 0.5, h.z + uz * du + vz * dv);
        C.push(col.r, col.g, col.b);
        S.push(fx.k === 1 ? 0.9 + (k % 4) * 0.35 : fx.k === 2 ? 0.28 : 0.34 + (k % 3) * 0.16);
        K.push(fx.k);
        SD.push(((k * 7919) % 1000) / 1000);
        R.push(fx.r * (0.3 + (k % 5) * 0.18));
        H.push(fx.h);
        SP.push(fx.spd * (0.75 + (k % 4) * 0.15));
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(S, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(K, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(SD, 1));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(R, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
  g.setAttribute('aSpd', new THREE.Float32BufferAttribute(SP, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uDim: { value: 1 }, uScale: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uDim; uniform float uScale;
      attribute vec3 aColor; attribute float aSize; attribute float aKind;
      attribute float aSeed; attribute float aRad; attribute float aH; attribute float aSpd;
      varying vec3 vC; varying float vA;
      void main() {
        float ph = fract(uTime * aSpd + aSeed);
        vec3 p = position;
        float s = aSize;
        if (aKind < 0.5) {                       // 焰：上升 + 摆动，越上越小
          p.y += ph * aH * 0.55;
          p.x += sin((aSeed + uTime * 1.7) * 6.2831) * 0.34 * ph;
          p.z += cos((aSeed + uTime * 1.4) * 6.2831) * 0.34 * ph;
          s *= 1.0 - ph * 0.5;
        } else if (aKind < 1.5) {                // 雾：横向缓慢漂移 + 起伏
          p.x += sin(uTime * 0.22 + aSeed * 9.0) * aRad * 0.5;
          p.z += cos(uTime * 0.19 + aSeed * 7.0) * aRad * 0.5;
          p.y += sin(uTime * 0.3 + aSeed * 6.0) * 0.45;
          s *= 1.0 + ph * 0.35;
        } else if (aKind < 2.5) {                // 虫群：绕圈
          float a2 = uTime * (0.8 + aSeed) + aSeed * 6.2831;
          p.x += cos(a2) * aRad * 0.5; p.z += sin(a2 * 1.13) * aRad * 0.5;
          p.y += sin(a2 * 1.7) * aH * 0.2;
        } else if (aKind < 3.5) {                // 冰晶：缓慢上浮
          p.x += sin(uTime * 0.5 + aSeed * 12.0) * 0.5;
          p.z += cos(uTime * 0.43 + aSeed * 9.0) * 0.5;
          p.y += ph * aH * 0.5;
          s *= 1.0 - ph * 0.55;
        } else if (aKind < 4.5) {                // 火星：斜向上抛出
          p.y += ph * aH * 0.5;
          p.x += (aSeed - 0.5) * aRad * ph * 1.2;
          p.z += (fract(aSeed * 7.0) - 0.5) * aRad * ph * 1.2;
          s *= 1.0 - ph * 0.75;
        } else {                                  // 血滴：下落
          p.y -= ph * aH * 0.45;
          p.x += (aSeed - 0.5) * aRad * ph * 0.6;
          s *= 0.8;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = max(1.0, s * uScale / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        vC = aColor * uDim;
        vA = (aKind < 0.5 || aKind > 3.5) ? (1.0 - ph * 0.6) : 0.5;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.25, 0.0, dot(q, q));
        if (a <= 0.001) discard;
        gl_FragColor = vec4(vC, a * vA);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'hellFx';
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  // 亮度衰减公式与 world.applyHellDepth 完全一致：k=clamp(dIn/240)^1.4，最深处保留 28%
  pts.onBeforeRender = (_r, _s, cam) => {
    mat.uniforms.uTime.value = performance.now() / 1000;
    const c = cam.position;
    const k = c.y < -100 ? Math.pow(THREE.MathUtils.clamp(Math.hypot(c.x, c.z + 60) / 240, 0, 1), 1.4) : 0;
    mat.uniforms.uDim.value = 1 - 0.72 * k;
    mat.uniforms.uScale.value = 300;
  };
  scene.add(pts);
}

/**
 * 十八狱「谁在做什么」：每层 1 名狱主（判官）+ 2 名鬼卒 + 3 名受刑者，姿态按层轮换。
 * 旧版只有 6 尊站桩狱卒头目（全部 action:'stand'），院内空无一人 —— 用户原话「应该有什么人在屋里、
 * 各自都在做什么」。姿态全部复用既有 ACTIONS 表（kneel / knockedDown / courtBow / pullRope /
 * crank / axeChop / spearThrust / hammerAnvil / sweep / write / holdCourt），不新增动作系统。
 */
const HELL_JUDGE_DOING = ['朱笔记名', '翻生死簿', '拍案定罪', '执笔勾魂'];
const HELL_GUARD_DOING = ['举鞭催行', '执叉守炉', '押魂入狱', '按刀监刑'];
const HELL_VICTIM_DOING = ['跪受刑', '伏地不起', '缚柱待刑', '推磨不休', '踏碓舂米', '抱首哀嚎'];

export function spawnHellKeepers(crowd: {
  spawnActor(o: Record<string, unknown>): { pos: { x: number; y: number; z: number } };
  heroes?: unknown[];
  mesh?: THREE.Object3D;
}): void {
  installHellFx(crowd);
  const y = UNDER.y;
  HELLS.forEach((h, i) => {
    const dx = h.x - 0, dz = h.z - 55;
    const R = Math.hypot(dx, dz);
    const ux = -dx / R, uz = -dz / R;         // 指向环心（门朝向）
    const vx = -uz, vz = ux;
    /** 院内局部点 → 世界 */
    const at = (du: number, dv: number): THREE.Vector3 => new THREE.Vector3(h.x + ux * du + vx * dv, y, h.z + uz * du + vz * dv);
    const face = Math.atan2(ux, uz);          // 面朝院心（外）
    const spawn = (o: Record<string, unknown>): { pos: { x: number; y: number; z: number } } => {
      const a = crowd.spawnActor(o as never) as { pos: THREE.Vector3 };
      a.pos.y = y;
      return a;
    };
    // ① 狱主 / 判官：案后执笔，坐朝院心
    const judge = spawn({
      occ: 'official', prop: 'scroll', pos: at(3.4, 2.4), yaw: face + Math.PI, cloth: 0x2a1420, pants: 0x1a1018,
      skin: 0x8fb898, hat: 1, action: i % 3 === 0 ? 'holdCourt' : 'write', scale: 1.34, freeze: true,
      doing: `${h.name}·狱主：${HELL_JUDGE_DOING[i % HELL_JUDGE_DOING.length]}`,
      data: { name: '狱主判官', nick: h.name, group: 'deity', weapon: '朱笔', desc: `掌${h.name}刑名，勾决一册`, code: 'helljudge' + i },
    });
    crowd.heroes?.push(judge);
    // ② 鬼卒两名：一执刑、一押解
    spawn({
      occ: 'soldier', prop: 'axe', pos: at(1.4, -3.6), yaw: face + 0.5, cloth: 0x22242a, pants: 0x1a1c20,
      skin: 0x8fb898, hat: 1, action: i % 2 === 0 ? 'axeChop' : 'stand', scale: 1.46, freeze: true,
      doing: `${h.name}·鬼卒：${HELL_GUARD_DOING[i % HELL_GUARD_DOING.length]}`,
      data: { name: '鬼卒', nick: '行刑', group: 'deity', weapon: '鬼头刀', desc: `监${h.name}刑`, code: 'hellguard' + i + 'a' },
    });
    spawn({
      occ: 'soldier', prop: 'spear', pos: at(0.2, 3.9), yaw: face - 0.5, cloth: 0x1e2a26, pants: 0x16201c,
      skin: 0x8fb898, hat: 1, action: i % 2 === 0 ? 'impMarch' : 'spearThrust', scale: 1.42, freeze: true,
      doing: `${h.name}·鬼卒：押魂入列`,
      data: { name: '鬼卒', nick: '押解', group: 'deity', weapon: '锁链', desc: `押魂至${h.name}`, code: 'hellguard' + i + 'b' },
    });
    // ③ 受刑者三名：动作按层轮换（跪 / 缚 / 劳役），保证十八层姿态不重样
    const poses: [string, string, number, number][] = [
      ['kneel', '伏地待刑', -2.6, -1.8],
      [i % 3 === 0 ? 'pullRope' : i % 3 === 1 ? 'crank' : 'hammerAnvil', '受刑·劳役', -1.4, 2.6],
      [i % 2 === 0 ? 'knockedDown' : 'courtBow', '受刑·倒地', 0.9, -2.4],
    ];
    poses.forEach(([action, doing, du, dv], k) => {
      spawn({
        occ: k === 1 ? 'porter' : 'beggar', prop: k === 1 ? 'carryPole' : null, pos: at(du, dv), yaw: face + (k % 2 ? 0.8 : -0.8),
        cloth: 0x2a3430, pants: 0x1a201c, skin: 0xa8d8b8, hat: k === 1 ? 0 : 2, action, scale: 0.96, freeze: true,
        doing: `${h.name}·${doing}`,
        data: { name: '受刑亡魂', nick: '罪魂', group: 'guest', weapon: '', desc: HELL_VICTIM_DOING[(i + k) % HELL_VICTIM_DOING.length], code: 'hellvictim' + i + k },
      });
    });
  });
}

/** 地府室内点光（磷绿系+汤锅暖，物理单位） */
export const HELL_LIGHTS: { x: number; y: number; z: number; color: number; int: number; dist: number }[] = [
  { x: 0, y: UNDER.y + 6, z: 52, color: 0x3dff9c, int: 90, dist: 20 },     // 阎罗殿前堂
  { x: 0, y: UNDER.y + 6.5, z: 66, color: 0x3dff9c, int: 70, dist: 18 },   // 阎罗殿案后
  { x: -40, y: UNDER.y + 2.2, z: -132, color: 0x6b4226, int: 60, dist: 9 }, // 孟婆灶
  { x: 0, y: UNDER.y + 6, z: 55, color: 0x3dff9c, int: 160, dist: 34 },    // 狱环心
  // ---- WS-25（J4-29）：地府局部补光 6 盏，硬上限用满；强度 25–45 cd / 距离 20–30 / 冷绿·幽蓝 ----
  // 狱环心已有 160 cd 的既有盏（0,55），本预算不再重复打同一点，改投 J4-29 的实测暗点「奈何桥心」——
  // 位置抬到 y+7.2，高于照魂镜吊链顶（y+6.9），避免把链杆打成一圈热点
  { x: 0, y: UNDER.y + 7, z: 100, color: 0x4d7cff, int: 42, dist: 30 },      // 阎罗殿前广场中心
  { x: 0, y: UNDER.y + 7.2, z: -60, color: 0x3dff9c, int: 40, dist: 26 },     // 奈何桥心（naihe 机位实测暗点）
  { x: -36, y: UNDER.y + 3.6, z: -126, color: 0x3dff9c, int: 32, dist: 24 },  // 孟婆庄前庭（避开既有孟婆灶）
  { x: 24, y: UNDER.y + 5, z: -100.8, color: 0x4d7cff, int: 30, dist: 22 },   // 三生石南照面外侧
  { x: -150, y: UNDER.y + 18.6, z: -150, color: 0x4d7cff, int: 34, dist: 26 }, // 望乡台顶亭心
  { x: 210, y: UNDER.y + 7, z: 25, color: 0x3dff9c, int: 40, dist: 28 },      // 丰都街口（街面雾下第一进）
  // 丰都主街四盏檐灯暖光：街面位于黑场最深处（dIn≈220–420），只有自发光没有照明时，
  // 铺面与行人全是黑剪影，「街道 / 店铺 / 人流可数」这一条读不出。四盏低强度暖光把近街照出来。
  { x: 235, y: UNDER.y + 4.2, z: 25, color: 0xffb347, int: 26, dist: 20 },
  { x: 285, y: UNDER.y + 4.2, z: 25, color: 0xffb347, int: 24, dist: 20 },
  { x: 335, y: UNDER.y + 4.2, z: 25, color: 0xffb347, int: 22, dist: 20 },
  { x: 235, y: UNDER.y + 4.2, z: 85, color: 0x3dff9c, int: 22, dist: 20 },
  // ---- v2：逐狱一盏。18 层原先只有环心一盏 160cd 的大灯，院内金属/木质刑具没有局部光，
  // 画面上只剩自发光泛光，刑具本体是黑剪影。这里给每层补一盏本色点光（位置在院心偏后 2m、高 3.2m），
  // 灯色取 HELL_TINT，与地面光池 / 自发光件同色系，保证「油锅橙红 / 冰山青白 / 血池暗红」一眼可分。
  ...HELLS.map((h, i) => {
    const dx = h.x, dz = h.z - 55, R = Math.hypot(dx, dz);
    return {
      x: h.x - (dx / R) * 2.2, y: UNDER.y + 3.2, z: h.z - (dz / R) * 2.2,
      color: HELL_TINT[i % HELL_TINT.length], int: h.heavy ? 60 : 46, dist: h.heavy ? 19 : 16,
    };
  }),
];

// ============ B3：奈何桥桥面系统 + 三生石三照面 + 望乡台（47 卷 §九/§十一/§十二） ============

/** 奈何桥系统增量件（桥体沿用 underworld 拱板：引魂灯 8/照魂镜/锁魂链/导雾槽/双碑亭/鬼面望柱/拱腹铜铃） */
export function buildNaiheSystem(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  // 引魂灯 8 盏（栏柱上交替侧；第 4、5 盏回头灯双盏）
  for (let i = 0; i < 8; i++) {
    const z = -86 + i * 7.8;
    const deck = y + 2.2 + Math.sin(((z + 88) / 56) * Math.PI) * 1.75;
    const sx = i % 2 === 0 ? -2.8 : 2.8;
    b.box('wood', 0.14, 1.6, 0.14, sx, deck + 0.8, z, 0x2c2018);
    b.box('glow', 0.32, 0.44, 0.32, sx, deck + 1.9, z, PHOS);
    if (i === 3 || i === 4) b.box('glow', 0.24, 0.34, 0.24, sx * 0.92, deck + 1.5, z + 0.3, ICEC); // 回头灯副盏
  }
  // 桥心照魂镜（径 0.8 铜框悬链四股）
  const md = y + 5.4;
  b.cyl('glow', 0.8, 0.8, 0.12, 16, 0, md, -60, shade(COPPER, 1.25), 0, Math.PI / 2);
  b.box('glow', 1.35, 1.35, 0.05, 0, md, -60, shade(ICEC, 0.55), 0, 0, 0);
  for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) b.box('wood', 0.04, 1.2, 0.04, dx, md + 0.9, -60 + dz, IRON);
  // 锁魂链九股（水下 0.5m 横江）
  for (let k = 0; k < 9; k++) b.box('wood', 0.11, 0.11, 44, -4 + k * 1.0, y - 2.3, -60, k % 2 ? IRON : shade(IRON, 0.8));
  // 导雾槽两侧（雾瀑下泻半透柱意象）
  for (const sx of [-4.6, 4.6]) for (let k = 0; k < 5; k++) {
    b.cyl('glow', 0.5, 0.8, 2.2, 5, sx, y - 1.2, -78 + k * 9.5, shade(0x1a2430, 1.4), 0, 0, 0, true);
  }
  // 南北碑亭（3×3 四柱攒尖 + 碑 2.4：南碑「奈何橋」/北碑「回頭無岸」+ 碑阴联文）
  for (const [tz, main, back, key] of [[-93, '奈何橋', '善者過橋穩如砥', 'S'], [-25, '回頭無岸', '過了此橋休問來路', 'N']] as const) {
    for (const dx of [-1.3, 1.3]) for (const dz of [-1.3, 1.3]) b.box('wall', 0.35, 3.2, 0.35, dx, y + 1.6, tz + dz, shade(0x33393f, 1.05));
    b.pyramid('roof', 0.1, 0.7, 0, y + 4.0, tz, 0x14161a, 0, 3.6, 1.0, 3.6);
    b.box('wall', 0.7, 2.4, 0.28, 0, y + 1.2, tz, shade(0x33393f, 1.12));
    b.box('glow', 0.5, 0.06, 0.3, 0, y + 0.9, tz + 0.16, BONE);
    sg.quad(atlas.text('beiA' + key, main, 128, 200, { color: '#e8e3d5', vertical: true, fontPx: 66, bg: 'rgba(51,57,63,0.9)' }), 0.62, 1.9, 0, y + 1.55, tz + 0.17, 0);
    sg.quad(atlas.text('beiB' + key, back, 420, 44, { color: '#b8b2a4', fontPx: 30, bg: 'rgba(30,34,38,0.85)' }), 2.6, 0.3, 0, y + 0.55, tz - 0.17, Math.PI);
  }
  // 望柱鬼面 24（沿桥两侧柱头暗面块）
  for (let i = 0; i < 24; i++) {
    const z = -86 + i * 2.35, sx = i % 2 ? 4.35 : -4.35;
    const deck = y + 2.2 + Math.sin(((z + 88) / 56) * Math.PI) * 1.75;
    b.box('wood', 0.2, 0.26, 0.14, sx, deck + 1.15, z, 0x1a161c);
    if (i % 6 === 0) b.box('glow', 0.06, 0.06, 0.05, sx, deck + 1.15, z + 0.09, shade(PHOS, 0.5));
  }
  // 拱腹铜铃 12（哑响）
  for (let i = 0; i < 12; i++) {
    const z = -84 + i * 4.6;
    const deck = y + 2.2 + Math.sin(((z + 88) / 56) * Math.PI) * 1.75;
    b.cyl('wood', 0.07, 0.1, 0.22, 5, (i % 2 ? 2.2 : -2.2), deck - 0.5, z, COPPER);
  }
  // ================= v2：栏杆加密 / 桥头牌坊 / 孟婆亭 / 忘川水面与雾带 =================
  // 判据（用户原话）：「奈何桥：桥面、栏杆（望柱+寻杖）、桥头牌坊、孟婆亭、忘川水面与雾气」。
  // 旧版每 4.7m 才一根望柱 + 两道横杆，桥面侧看是一条无栏平板；这里补地栿 / 净瓶 / 桥头牌坊 / 桥头亭。
  // 栏杆：24 跨 × 3 只净瓶 + 地栿，望柱与寻杖沿用 underworld 拱板既有件
  for (let i = 0; i < 24; i++) {
    const z0 = -88 + i * (56 / 24), z1 = -88 + (i + 1) * (56 / 24);
    for (let q = 1; q <= 3; q++) {
      const z = z0 + (z1 - z0) * (q / 4);
      const deck = y + 2.2 + Math.sin(((z + 88) / 56) * Math.PI) * 1.75;
      for (const sx of [-4.3, 4.3]) {
        b.cyl('wood', 0.055, 0.085, 0.44, 5, sx, deck + 0.44, z, 0x3a2c22);   // 净瓶
        b.box('wood', 0.13, 0.09, (z1 - z0) / 4 + 0.06, sx, deck + 0.2, z, 0x2c2018); // 地栿
      }
    }
  }
  // 桥头牌坊（南北各一座，四柱三间 + 主楼 + 两次楼 + 匾）
  for (const [pz, label, key] of [[-91.5, '陰陽界', 'S'], [-26.5, '回頭無岸', 'N']] as const) {
    const py = y;
    for (const sx of [-3.4, -1.2, 1.2, 3.4]) {
      b.box('wall', 0.46, 5.6, 0.46, sx, py + 2.8, pz, shade(0x3a3a42, 1.02));
      b.box('ash', 0.78, 0.3, 0.78, sx, py + 0.15, pz, shade(0x4e5860, 0.94));
      b.box('metal', 0.6, 0.14, 0.6, sx, py + 0.9, pz, 0x2a2622);
    }
    b.box('wall', 8.6, 0.5, 0.6, 0, py + 5.5, pz, shade(0x3a3a42, 1.08));
    b.box('wall', 8.6, 0.34, 0.5, 0, py + 4.2, pz, shade(0x33393f, 1.02));
    b.pyramid('roof', 0.16, 0.5, 0, py + 6.3, pz, 0x14161a, 0, 5.4, 1.2, 1.6);
    for (const sx of [-2.3, 2.3]) b.pyramid('roof', 0.14, 0.42, sx, py + 5.9, pz, 0x14161a, 0, 2.6, 0.9, 1.4);
    b.box('ash', 3.4, 1.1, 0.16, 0, py + 4.85, pz + 0.3, shade(0x2a2622, 0.94));
    sg.quad(atlas.text('pai' + key, label, 320, 96, {
      color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(8,12,10,0.92)', border: 'rgba(61,255,156,.8)', fontPx: 60,
    }), 3.0, 0.86, 0, py + 4.85, pz + 0.4, 0);
    for (const sx of [-1.2, 1.2]) b.box('glow', 0.22, 0.3, 0.22, sx, py + 5.15, pz + 0.34, PHOS);
    b.kit('naihe.paifang', 1, py + 5.5);
  }
  // 孟婆亭（北桥头东侧）：四柱攒尖 + 石案 + 汤锅 + 长凳 + 亭灯
  {
    const mx = 9.2, mz = -25.5, py = y;
    for (const sx of [-1.9, 1.9]) for (const sz of [-1.9, 1.9]) {
      b.box('wood', 0.28, 3.0, 0.28, mx + sx, py + 1.5, mz + sz, 0x2a201a);
      b.cyl('ash', 0.36, 0.4, 0.2, 8, mx + sx, py + 0.1, mz + sz, shade(0x4e5860, 1.0));
    }
    b.pyramid('roof', 0.14, 0.5, mx, py + 3.9, mz, 0x14161a, 0, 5.2, 1.3, 5.2);
    b.box('wood', 4.4, 0.22, 0.22, mx, py + 3.0, mz - 1.9, 0x3a2c22);
    b.box('wood', 4.4, 0.22, 0.22, mx, py + 3.0, mz + 1.9, 0x3a2c22);
    // 石案 + 汤锅 + 碗
    b.box('wood', 2.6, 0.9, 1.1, mx, py + 0.55, mz - 0.6, 0x3a2c22);
    b.cyl('metal', 0.62, 0.5, 0.5, 12, mx - 0.5, py + 1.2, mz - 0.6, shade(COPPER, 0.7));
    b.cyl('glow', 0.54, 0.54, 0.08, 12, mx - 0.5, py + 1.44, mz - 0.6, 0x6b4226);
    for (let k = 0; k < 3; k++) b.cyl('ceramic', 0.13, 0.1, 0.1, 8, mx + 0.3 + k * 0.42, py + 1.05, mz - 0.6, 0x8a7a6a);
    // 长凳两条 + 亭灯
    for (const sz of [-1.2, 1.2]) {
      b.box('wood', 2.2, 0.1, 0.36, mx + 0.2, py + 0.46, mz + sz, 0x3a2c22);
      for (const sx of [-0.8, 0.8]) b.box('wood', 0.09, 0.42, 0.09, mx + 0.2 + sx, py + 0.22, mz + sz, 0x2a201a);
    }
    b.box('glow', 0.3, 0.42, 0.3, mx, py + 3.3, mz, 0xffb347);
    b.kit('naihe.pavilion', 1, py + 3.2);
  }
  // 忘川水面：两岸之间的暗水面 + 磷光水纹；雾带三束（横跨江面，越远越淡）
  b.box('water', 300, 0.05, 54, 0, y - 2.55, -59.5, 0x08161c);
  for (let k = 0; k < 14; k++) {
    const wx = -150 + k * 22 + ((k * 37) % 11);
    b.box('glow', 14 + (k % 3) * 6, 0.03, 0.34, wx, y - 2.5, -84 + (k % 5) * 11, k % 3 === 0 ? 0x1e6a5a : 0x0e3a46);
  }
  for (let k = 0; k < 3; k++) {
    const mz = -84 + k * 16;
    b.cyl('glow', 46, 52, 0.5 + k * 0.15, 14, 0, y - 2.1 + k * 0.2, mz, shade(0x8fb8d8, 0.1 + k * 0.03), 0, 0, 0, true);
  }
  b.kit('naihe.wangchuan', 3, y - 2.3);
  // WS-37 忘川双渡口（D-ITM-0081/0082/0083/0086）：归魂渡 / 迎魂渡 / 孟婆渡船 / 系舟缆桩
  buildNaiheDocks(b);
}

/** 三生石三照面（47 卷 §十一：迁正 spec (24,-108)；旧 (-7,-90) 退役） */
export function buildSansheng(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  const x = 24, z = -108;
  // 三生石：八棱收分巨石（底 2.6 → 顶 1.9）。石材用 ash——wall 自带蓝灰自发光，正是「没做完的蓝灰柱」来源
  const ST = 0x7d7873, ST_D = 0x5c5854;
  const base = y + 1.05;
  const pedTop = base + 0.96;
  const H = 8.6, R0 = 2.6, R1 = 1.9;
  const AP = Math.cos(Math.PI / 8);
  const top = pedTop + H;
  const radAt = (dy: number): number => R0 + (R1 - R0) * (dy / H);
  const apAt = (dy: number): number => radAt(dy) * AP;
  /** 面坐标：phi 面法向（+z 为南，向 +x 正转），d 平心距，s 沿面切向偏移；与 b.box 的 ry=phi 同向 */
  const on = (phi: number, d: number, s = 0): [number, number] =>
    [x + Math.sin(phi) * d + Math.cos(phi) * s, z + Math.cos(phi) * d - Math.sin(phi) * s];

  // 面心朝向：南 0 / 东南 45 / 东 90 / 东北 135 / 北 180 / 西北 225 / 西 270 / 西南 315
  // 八棱柱顶点在 +z，整柱转 -π/8 让面心落到八方
  b.cyl('ash', R1, R0, H, 8, x, pedTop + H / 2, z, ST, -Math.PI / 8);
  b.kit('sansheng.body', 1, pedTop + H / 2);
  // 顶面断口：5 块碎面，最高点高出顶面 0.40
  for (const [dx, dz, r, h] of [
    [0.6, -0.2, 0.66, 0.4], [-0.72, 0.34, 0.54, 0.27], [0.16, 0.84, 0.46, 0.18],
    [-0.28, -0.86, 0.44, 0.31], [0.84, 0.46, 0.34, 0.13],
  ] as const) {
    b.pyramid('ash', 0.03, r, x + dx, top + h / 2, z + dz, shade(ST, 1.03), dx * 0.5, 1, h, 1);
  }
  b.box('ash', 1.5, 0.12, 1.05, x + 0.1, top + 0.05, z - 0.12, shade(ST_D, 0.9), 0.4, 0.12, -0.1);
  b.box('ash', 1.05, 0.1, 1.35, x - 0.22, top + 0.03, z + 0.18, shade(ST_D, 1.02), -0.7, -0.09, 0.06);
  // 顶沿崩口 6：把八棱顶边的整直棱线打碎
  for (let k = 0; k < 6; k++) {
    const phi = 0.36 + k * 1.047;
    const [qx, qz] = on(phi, apAt(H) - 0.02, (k % 2 ? 0.34 : -0.4));
    b.box('ash', 0.44, 0.34 + (k % 3) * 0.1, 0.26, qx, top - 0.14, qz, shade(ST_D, 0.94), phi, 0, (k % 2 ? 0.22 : -0.26));
  }
  b.kit('sansheng.cap', 1, top);
  // 风化缺角 8：每条竖棱两侧各贴一块压扁三角石，读作崩掉的面
  for (let k = 0; k < 8; k++) {
    const vy = Math.PI / 8 + k * Math.PI / 4;
    const dy = 1.05 + ((k * 1.37) % 6.2);
    const rr = radAt(dy), halfW = 0.3827 * rr;
    for (const sgn of [-1, 1]) {
      const phi = vy + sgn * Math.PI / 8;
      const [nx, nz] = on(phi, apAt(dy) + 0.012, sgn * (halfW - 0.05));
      b.pyramid('ash', 0.02, 0.3 + (k % 3) * 0.04, nx, pedTop + dy, nz, shade(ST_D, 0.64 + (k % 2) * 0.1), phi, 1, 0.06, 1);
    }
    if (k % 3 === 0) {
      const [sx3, sz3] = on(vy, rr + 0.02);
      b.pyramid('ash', 0.02, 0.26, sx3, pedTop + dy, sz3, shade(ST, 0.84), vy, 1, 0.24, 1);
    }
    b.kit('sansheng.notch', 1, pedTop + dy);
  }
  // 三面镜（南 / 东北 / 西北）：镜板比框浅 0.07，收分靠暗石槽垫平，镜面不必斜贴
  const mirDy = 3.5, mirH = 2.8, mirW = 1.15;
  const mirD = apAt(2.1) + 0.05;
  const MIRROR = [0, Math.PI * 0.75, Math.PI * 1.25] as const;
  for (const phi of MIRROR) {
    const [mx, mz] = on(phi, mirD);
    const [dx2, dz2] = on(phi, mirD - 0.24);
    b.box('ash', mirW + 0.34, mirH + 0.3, 0.36, dx2, pedTop + mirDy, dz2, shade(ST_D, 0.7), phi);
    b.box('glow', mirW + 0.14, mirH + 0.14, 0.04, mx, pedTop + mirDy, mz, 0x1d3a52, phi);
    b.box('lacquer', mirW, mirH, 0.08, mx, pedTop + mirDy, mz, 0xb8cfe2, phi);
    const [fx, fz] = on(phi, mirD - 0.06);
    b.box('ash', mirW + 0.3, 0.16, 0.34, fx, pedTop + mirDy + mirH / 2 + 0.08, fz, shade(ST, 1.06), phi);
    b.box('ash', mirW + 0.3, 0.16, 0.34, fx, pedTop + mirDy - mirH / 2 - 0.08, fz, shade(ST, 0.94), phi);
    for (const sgn of [-1, 1]) {
      const [px2, pz2] = on(phi, mirD - 0.06, sgn * (mirW / 2 + 0.07));
      b.box('ash', 0.15, mirH + 0.3, 0.34, px2, pedTop + mirDy, pz2, shade(ST, 1.0), phi);
      // 云纹：框顶两角的云头鼓 + 云尾（坐在上枋顶面，不埋进框里）
      const [cx3, cz3] = on(phi, mirD - 0.06, sgn * (mirW / 2 - 0.02));
      b.pyramid('ash', 0.02, 0.17, cx3, pedTop + mirDy + mirH / 2 + 0.16, cz3, shade(ST, 1.1), phi, 1, 0.14, 1);
      const [tx3, tz3] = on(phi, mirD - 0.06, sgn * (mirW / 2 + 0.18));
      b.box('ash', 0.22, 0.09, 0.14, tx3, pedTop + mirDy + mirH / 2 + 0.14, tz3, shade(ST, 1.02), phi);
    }
    b.kit('sansheng.mirror', 1, pedTop + mirDy);
    b.kit('sansheng.mirrorFrame', 1, pedTop + mirDy);
  }
  // 另三面铭文（东南 / 北 / 西南）：14 道竖排细槽 + 冷色受光边
  const insTop = 4.75;
  for (const phi of [Math.PI * 0.25, Math.PI, Math.PI * 1.75] as const) {
    const [hx2, hz2] = on(phi, apAt(insTop + 0.2) + 0.03);
    b.box('ash', 1.62, 0.16, 0.1, hx2, pedTop + insTop + 0.26, hz2, shade(ST, 1.06), phi);
    for (const sgn of [-1, 1]) {
      for (let seg = 0; seg < 2; seg++) {
        const sy0 = insTop + 0.1 - seg * 2.0;
        const [ex2, ez2] = on(phi, apAt(sy0 - 1.0) + 0.03, sgn * 0.8);
        b.box('ash', 0.08, 2.0, 0.1, ex2, pedTop + sy0 - 1.0, ez2, shade(ST, 0.9), phi);
      }
    }
    for (let g = 0; g < 14; g++) {
      const s = (g - 6.5) * 0.114;
      const gh = 0.95 + ((g * 7) % 5) * 0.14;
      const [gx, gz] = on(phi, apAt(insTop - gh / 2), s);
      b.box('ash', 0.038, gh, 0.1, gx, pedTop + insTop - gh / 2, gz, 0x435566, phi);
      const [lx2, lz2] = on(phi, apAt(insTop - gh / 2) + 0.02, s + 0.026);
      b.box('ash', 0.012, gh * 0.86, 0.06, lx2, pedTop + insTop - gh / 2, lz2, 0xa6c4d6, phi);
    }
    b.kit('sansheng.inscription', 14, pedTop + insTop);
  }
  // 雨蚀沟 11 道：只落在素面/装饰带上下，躲开镜板与铭文
  const ERO: readonly (readonly [number, number, number, number, number])[] = [
    [2, -0.52, 0.6, 3.4, 0.05], [2, 0.14, 1.2, 2.8, 0.06], [2, 0.56, 4.6, 3.0, 0.045],
    [6, -0.5, 0.7, 4.4, 0.055], [6, 0.34, 1.4, 2.2, 0.05], [0, -0.58, 5.35, 2.3, 0.05],
    [0, 0.6, 5.5, 1.9, 0.055], [1, -0.64, 5.3, 2.5, 0.05], [1, 0.28, 5.45, 2.1, 0.06],
    [3, -0.5, 5.4, 2.0, 0.045], [5, 0.46, 5.5, 2.1, 0.05],
  ];
  for (const [fi, s, gy0, gh, gw] of ERO) {
    const phi = fi * Math.PI / 4;
    for (let q = 0; q < 2; q++) {
      const segH = gh / 2;
      const dyc = gy0 + segH * (q + 0.5);
      const [gx, gz] = on(phi, apAt(dyc) + 0.015, s + (q ? 0.03 : -0.02));
      b.box('ash', gw, segH, 0.2, gx, pedTop + dyc, gz, shade(ST_D, 0.58 + (fi % 3) * 0.08), phi);
    }
    b.kit('sansheng.erosion', 1, pedTop + gy0);
  }
  // 横向层理 5 道（面心装饰带让开）
  let bands = 0;
  for (let si = 0; si < 5; si++) {
    const dy = 1.35 + si * 1.55;
    for (let f = 0; f < 8; f++) {
      if ((f === 0 || f === 3 || f === 5) && dy > 1.9 && dy < 5.1) continue;
      if ((f === 1 || f === 4 || f === 7) && dy > 0.95 && dy < 5.15) continue;
      const phi = f * Math.PI / 4;
      const fw = 2 * radAt(dy) * Math.sin(Math.PI / 8);
      const [bx2, bz2] = on(phi, apAt(dy) + 0.014);
      b.box('ash', fw - 0.16 - (si % 2) * 0.18, 0.05 + (f % 3) * 0.012, 0.06, bx2, pedTop + dy, bz2, shade(ST_D, 0.6 + (si % 2) * 0.12), phi);
      bands++;
    }
  }
  b.kit('sansheng.band', bands, pedTop + 4);
  // 底部苔痕带 0.55–0.61 高 + 5 处散斑
  let mossN = 0;
  for (let f = 0; f < 8; f++) {
    const phi = f * Math.PI / 4;
    const mh = 0.55 + (f % 3) * 0.03;
    const [mx2, mz2] = on(phi, apAt(mh * 0.5) + 0.006);
    b.box('leaf', 2 * R0 * Math.sin(Math.PI / 8) - 0.12, mh, 0.024, mx2, pedTop + mh / 2, mz2, 0x35502c, phi);
    mossN++;
  }
  for (const [f, s, dy, mh] of [[0, 0.5, 0.72, 0.3], [2, -0.34, 0.8, 0.24], [4, 0.26, 0.66, 0.26], [6, 0.42, 0.9, 0.2], [7, -0.5, 0.6, 0.28]] as const) {
    const phi = f * Math.PI / 4;
    const [mx3, mz3] = on(phi, apAt(dy) + 0.008, s);
    b.box('leaf', 0.3, mh, 0.024, mx3, pedTop + dy, mz3, 0x3b5730, phi);
    mossN++;
  }
  b.kit('sansheng.moss', mossN, pedTop + 0.4);
  // 须弥座：下枋 4.2 见方 / 束腰 / 上枋 + 覆莲（石身底径 5.2 出檐，按巨石坐座处理）
  b.box('ash', 4.2, 0.42, 4.2, x, base + 0.21, z, shade(ST, 0.9));
  b.box('ash', 3.5, 0.24, 3.5, x, base + 0.54, z, shade(ST, 0.76));
  b.box('ash', 4.0, 0.3, 4.0, x, base + 0.81, z, shade(ST, 0.98));
  b.cyl('ash', 2.45, 2.6, 0.18, 8, x, pedTop - 0.09, z, shade(ST, 0.86), -Math.PI / 8);
  b.kit('sansheng.pedestal', 3, base);
  b.kit('sansheng.lotusBase', 1, pedTop);
  // 四角石灯
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const lx = x + sx * 2.42, lz = z + sz * 2.42;
    b.box('ash', 0.54, 0.16, 0.54, lx, base + 0.08, lz, shade(ST, 0.82));
    b.box('ash', 0.22, 0.92, 0.22, lx, base + 0.62, lz, shade(ST, 0.9));
    b.box('ash', 0.46, 0.07, 0.46, lx, base + 1.11, lz, shade(ST, 0.96));
    b.box('glow', 0.32, 0.26, 0.34, lx, base + 1.27, lz, 0x8ce8c0);
    b.box('glow', 0.34, 0.26, 0.32, lx, base + 1.27, lz, 0x8ce8c0);
    b.box('ash', 0.44, 0.06, 0.44, lx, base + 1.43, lz, shade(ST, 1.02));
    b.pyramid('ash', 0.03, 0.42, lx, base + 1.56, lz, shade(ST, 1.06), Math.PI / 4, 1, 0.2, 1);
    b.kit('sansheng.lantern', 1, base);
  }
  // WS-25 台座四角魂灯（J4-29）：站在石台面（base = y+1.05）对角 r4.6——须弥座角 2.97 之外、锁链桩 r3.15 之外，
  // 挑臂走对角外法线，不与四幡（r9.6）与香案（z+5.4）争位
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    hellSoulLantern(b, x + sx * 3.25, z + sz * 3.25, base, 0x3dff9c, 'sansheng.light.cornerLamp', Math.atan2(sx, sz));
  }
  // 前踏跺 3 级（南向，接既有石道轴线）
  for (let st = 0; st < 3; st++) {
    b.box('ash', 2.4 - st * 0.18, 0.33, 0.38, x, base + 0.165 + st * 0.32, z + 2.98 - st * 0.34, shade(ST, 0.88 + st * 0.04));
  }
  b.kit('sansheng.pedestalSteps', 3, base + 0.5);
  // 台座外缘锁链桩 8 根（22.5° 起，与四角石灯交错）+ 每档 6 环垂链
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + k * Math.PI / 4;
    const [cx4, cz4] = on(a, 3.15);
    b.box('ash', 0.26, 0.86, 0.26, cx4, base + 0.43, cz4, shade(ST, 0.84), -a);
    b.box('ash', 0.34, 0.1, 0.34, cx4, base + 0.91, cz4, shade(ST, 0.98), -a);
    b.cyl('metal', 0.09, 0.09, 0.1, 6, cx4, base + 1.01, cz4, 0x3c3c42);
    b.kit('sansheng.chainStake', 1, base);
    const [nx4, nz4] = on(a + Math.PI / 4, 3.15);
    for (let m = 1; m <= 6; m++) {
      const t = m / 7;
      b.cyl('metal', 0.055, 0.055, 0.03, 5, cx4 + (nx4 - cx4) * t, base + 0.9 - Math.sin(t * Math.PI) * 0.18, cz4 + (nz4 - cz4) * t, 0x35353b, 0, Math.PI / 2);
      b.kit('sansheng.chain', 1, base + 0.9);
    }
    // 旧「红绳环带」删掉后，祈愿红绳改挂在桩间链上（不另立桩、不与链冲突）
    const chord = Math.hypot(nx4 - cx4, nz4 - cz4) * 0.82;
    const ry4 = Math.atan2(nx4 - cx4, nz4 - cz4);
    b.box('glow', 0.035, 0.035, chord, (cx4 + nx4) / 2, base + 0.76, (cz4 + nz4) / 2, 0x9d2933, ry4);
    b.box('wood', 0.12, 0.2, 0.04, (cx4 + nx4) / 2, base + 0.64, (cz4 + nz4) / 2, 0x4a3c33, ry4);
    b.kit('sansheng.wishRope', 1, base + 0.7);
  }
  // 三生珠（南面石心上部：龛 + 莲座 + 0.5m 冷绿珠）
  const pd = apAt(6.5) + 0.02;
  const [px4, pz4] = on(0, pd);
  b.box('ash', 0.98, 1.0, 0.12, px4, pedTop + 6.5, pz4, shade(ST_D, 0.6), 0);
  const [gx4, gz4] = on(0, pd + 0.09);
  b.box('glow', 0.74, 0.74, 0.05, gx4, pedTop + 6.5, gz4, 0x1c4636);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    b.box('ash', 0.24, 0.07, 0.16, px4 + Math.cos(a) * 0.2, pedTop + 6.18, pz4 + Math.sin(a) * 0.06, 0xa09a92, 0, 0, a > 0.9 && a < 2.4 ? 0.3 : -0.3);
  }
  const [ox, oz] = on(0, pd + 0.24);
  b.cyl('glow', 0.13, 0.13, 0.1, 8, ox, pedTop + 6.28, oz, 0x7dffc4);
  b.cyl('glow', 0.25, 0.25, 0.26, 8, ox, pedTop + 6.46, oz, 0x62ffb6);
  b.cyl('glow', 0.15, 0.15, 0.1, 8, ox, pedTop + 6.64, oz, 0x9dffd4);
  b.kit('sansheng.pearl', 1, pedTop + 6.46);
  // 三照匾（挂在三面镜框顶）：沿用 ss1/ss2/ss3 图集键
  const plaque = (key: string, txt: string, color: string, glow: string, phi: number): void => {
    const [bx3, bz3] = on(phi, apAt(5.35) + 0.06);
    b.box('ash', 1.36, 0.46, 0.1, bx3, pedTop + 5.35, bz3, shade(ST, 0.76), phi);
    const [qx2, qz2] = on(phi, apAt(5.35) + 0.13);
    sg.quad(atlas.text(key, txt, 200, 64, { color, glow, fontPx: 44, bg: 'rgba(18,24,30,0.88)' }), 1.24, 0.4, qx2, pedTop + 5.35, qz2, phi);
  };
  plaque('ss1', '一照前塵', '#baffef', '#baffef', 0);
  plaque('ss2', '二照今生', '#4d7cff', '#4d7cff', Math.PI * 0.75);
  plaque('ss3', '三照來世', '#e8f0ff', '#e8f0ff', Math.PI * 1.25);
  // 石前双灯
  for (const s of [-1, 1]) { b.box('wood', 0.24, 1.1, 0.24, x + s * 1.6, y + 0.55, z + 4.4, 0x33393f); b.box('glow', 0.2, 0.3, 0.2, x + s * 1.6, y + 1.25, z + 4.4, PHOS); }

  // ---- 石台与祭场：三生石原本孤零零立在一片暗地上 ----
  b.cyl('ground', 11.5, 11.5, 0.12, 24, x, y + 0.06, z, 0x2e2a30);
  b.cyl('ash', 7.6, 8.1, 0.5, 20, x, y + 0.25, z, shade(0x6e6a66, 1.0));
  b.cyl('ash', 6.7, 7.4, 0.5, 20, x, y + 0.75, z, shade(0x787470, 1.02));
  b.cyl('ground', 6.5, 6.5, 0.06, 20, x, y + 1.02, z, shade(0x9a948c, 0.86));
  b.kit('sansheng.platform', 2, y + 0.5);
  // 台面放射石缝
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box('ground', 0.16, 0.02, 6.2, x + Math.cos(a) * 3.1, y + 1.06, z + Math.sin(a) * 3.1, 0x5a545c, -a);
  }
  b.kit('sansheng.paving', 8, y + 1.06);
  // 石栏 16 望柱 + 弦栏
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const px3 = x + Math.cos(a) * 7.2, pz3 = z + Math.sin(a) * 7.2;
    b.box('ash', 0.38, 1.05, 0.38, px3, y + 1.35, pz3, shade(0x827d77, 1.05), -a);
    b.box('glow', 0.12, 0.12, 0.12, px3, y + 1.92, pz3, 0xbaffef);
    const b2 = a + Math.PI / 16;
    b.box('ash', 0.14, 0.14, 2.6, x + Math.cos(b2) * 7.2, y + 1.62, z + Math.sin(b2) * 7.2, shade(0x6f6b66, 1.0), -b2 + Math.PI / 2);
    b.kit('sansheng.rail', 1, y + 1.35);
  }
  // 南向三级踏道
  for (let st = 0; st < 3; st++) {
    b.box('ash', 5.2 - st * 0.6, 0.34, 1.2, x, y + 0.17 + st * 0.34, z + 8.1 - st * 1.0, shade(0x6b6763, 1.02 + st * 0.03));
  }
  b.box('ground', 3.4, 0.06, 14, x, y + 0.08, z + 15, shade(0x8a8478, 0.88));
  b.kit('sansheng.steps', 3, y + 0.5);
  // 香案 + 香炉 + 供果 + 纸钱
  b.box('ash', 3.4, 0.14, 1.0, x, y + 1.62, z + 5.4, shade(0x827d77, 1.06));
  for (const sx of [-1, 1]) b.box('ash', 0.3, 0.62, 0.7, x + sx * 1.4, y + 1.31, z + 5.4, shade(0x6e6a66, 1.0));
  b.cyl('metal', 0.36, 0.28, 0.42, 10, x, y + 1.9, z + 5.4, 0x5a5044);
  for (let i = 0; i < 3; i++) b.box('glow', 0.02, 0.34, 0.02, x - 0.12 + i * 0.12, y + 2.2, z + 5.4, 0xffcf90);
  for (const sx of [-1, 1]) b.cyl('ceramic', 0.14, 0.18, 0.16, 8, x + sx * 0.9, y + 1.77, z + 5.4, 0xb8734a);
  b.box('fabric', 0.5, 0.03, 0.5, x - 2.6, y + 1.08, z + 4.4, 0xd2c8a8, 0.4);
  b.kit('sansheng.altar', 1, y + 1.6);
  // 四幡
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const px4 = x + Math.cos(a) * 9.6, pz4 = z + Math.sin(a) * 9.6;
    b.cyl('wood', 0.08, 0.12, 4.6, 6, px4, y + 2.3, pz4, 0x201820);
    // 幡面沿切向挂出、贴住旗杆（旧版只按自身角度旋转并平移到旁边，读作悬空彩板）
    const tx2 = -Math.sin(a) * 0.55, tz2 = Math.cos(a) * 0.55;
    b.box('fabric', 1.1, 2.2, 0.04, px4 + tx2, y + 3.55, pz4 + tz2, k % 2 ? 0x2a5c42 : 0x4a4a7a, a + Math.PI / 2);
    b.box('wood', 1.16, 0.08, 0.08, px4 + tx2, y + 4.7, pz4 + tz2, 0x3a2c22, a + Math.PI / 2);
    b.kit('sansheng.banner', 1, y + 3.6);
  }
  // 枯树两株
  for (const [tx, tz] of [[x - 10.5, z + 2.5], [x + 9.5, z - 7]] as const) {
    b.cyl('wood', 0.18, 0.34, 4.2, 6, tx, y + 2.1, tz, 0x1a1418);
    for (let br = 0; br < 4; br++) {
      const a = (br / 4) * Math.PI * 2 + tx * 0.3;
      b.box('wood', 0.11, 1.8, 0.11, tx + Math.cos(a) * 0.8, y + 3.4, tz + Math.sin(a) * 0.8, 0x1a1418, a, 0, 0.55);
    }
    b.kit('sansheng.deadTree', 1, y + 2.1);
  }
  // 贴地鬼火
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    b.cyl('glow', 0.45, 0.7, 0.03, 8, x + Math.cos(a) * 10.2, y + 0.1, z + Math.sin(a) * 10.2, ICEC, 0, 0, 0, true);
  }

  buildSanshengPavilions(b, sg, atlas);
}

/** 三生石亭组团：六座照亭环石而立（避开 ±z 石道、四幡 r9.6、两株枯树），R01–R06 */
export function buildSanshengPavilions(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  // [cx, cz, w, d, 开口朝向, kit 房号]
  const P: readonly (readonly [number, number, number, number, 'N' | 'S' | 'E' | 'W', string])[] = [
    [24, -95.5, 7.0, 5.0, 'N', 'R01'],
    [35.8, -108, 6.0, 6.0, 'W', 'R02'],
    [12.2, -109.5, 6.0, 6.0, 'E', 'R03'],
    [24, -120, 8.0, 5.0, 'S', 'R04'],
    [34, -96, 6.0, 5.0, 'N', 'R05'],
    [14, -96, 6.0, 5.0, 'N', 'R06'],
  ];
  for (const [cx, cz, w, d, open, key] of P) {
    const y0 = y + 0.26;
    let n = 0;
    // 台明 + 踏跺
    b.box('ash', w + 0.7, 0.24, d + 0.7, cx, y + 0.12, cz, shade(INP.rough, 0.95));
    n++;
    n += inSteps(b, cx, cz + d / 2 + 0.35, 2.4, y + 0.24, 2, 0.12, 0.3);
    n += inFloor(b, cx, cz, w, d, y0, INP.slab, 1.6);
    // 三面石墙 + 正面格栅 + 四角柱 + 阑额
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const h = 3.2;
    if (open !== 'N') n += inWall(b, x0, z0, x1, z0, y0, h, 0.4, INP.brick, key === 'R01' ? [[2.4, 4.6]] : []);
    if (open !== 'S') n += inWall(b, x0, z1, x1, z1, y0, h, 0.4, INP.brick, key === 'R04' ? [[2.4, 4.6]] : []);
    if (open !== 'W') n += inWall(b, x0, z0, x0, z1, y0, h, 0.4, INP.brick);
    if (open !== 'E') n += inWall(b, x1, z0, x1, z1, y0, h, 0.4, INP.brick);
    if (open === 'N') n += inLattice(b, x0 + 0.2, z0, x1 - 0.2, z0, y0, 2.6);
    if (open === 'S') n += inLattice(b, x0 + 0.2, z1, x1 - 0.2, z1, y0, 2.6);
    if (open === 'W') n += inLattice(b, x0, z0 + 0.2, x0, z1 - 0.2, y0, 2.6);
    if (open === 'E') n += inLattice(b, x1, z0 + 0.2, x1, z1 - 0.2, y0, 2.6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box('ash', 0.38, h + 0.2, 0.38, cx + sx * (w / 2 - 0.19), y0 + (h + 0.2) / 2, cz + sz * (d / 2 - 0.19), shade(INP.rough, 1.12));
      n++;
    }
    for (const sz of [-1, 1]) {
      b.box('ash', w, 0.24, 0.2, cx, y0 + h, cz + sz * (d / 2 - 0.1), shade(INP.rough, 1.05));
      n++;
    }
    for (const sx of [-1, 1]) {
      b.box('ash', 0.2, 0.24, d, cx + sx * (w / 2 - 0.1), y0 + h, cz, shade(INP.rough, 1.05));
      n++;
    }
    // 墙裙（三面）
    const si = 0.22;
    if (open !== 'N') n += inSkirt(b, x0 + si, z0 + si, x1 - si, z0 + si, y0);
    if (open !== 'S') n += inSkirt(b, x0 + si, z1 - si, x1 - si, z1 - si, y0);
    if (open !== 'W') n += inSkirt(b, x0 + si, z0 + si, x0 + si, z1 - si, y0);
    if (open !== 'E') n += inSkirt(b, x1 - si, z0 + si, x1 - si, z1 - si, y0);
    // 直棂窗（背墙两樘）+ 板门（侧墙）
    const bx = open === 'N' ? z1 - 0.38 : open === 'S' ? z0 + 0.38 : z0 + d * 0.28;
    if (open === 'N' || open === 'S') {
      for (const ox of [-w * 0.26, w * 0.26]) {
        n += inWindow(b, cx + ox, bx, y0 + 1.0, 1.4, 1.3, 0, true);
      }
    } else {
      for (const oz of [-d * 0.24, d * 0.24]) {
        n += inWindow(b, open === 'W' ? x1 - 0.38 : x0 + 0.38, cz + oz, y0 + 1.0, 1.3, 1.3, Math.PI / 2, true);
      }
    }
    if (key === 'R01') n += inDoor(b, cx, z1, y0, 2.2, 2.8, 0);
    if (key === 'R04') n += inDoor(b, cx, z0, y0, 2.2, 2.8, 0);
    if (key === 'R02') n += inDoor(b, x1, cz, y0, 2.0, 2.6, Math.PI / 2);
    if (key === 'R03') n += inDoor(b, x0, cz, y0, 2.0, 2.6, Math.PI / 2);
    if (key === 'R05') n += inDoor(b, x0, cz, y0, 2.0, 2.6, Math.PI / 2);
    if (key === 'R06') n += inDoor(b, x0, cz, y0, 2.0, 2.6, Math.PI / 2);
    n += inCeil(b, cx, cz, w - 0.1, d - 0.1, y0 + 3.1, 1);
    roofOn(b, w + 1.5, d + 1.5, y0 + 3.3, cx, cz, 0, 0x14161a, PHOS);
    b.kit('sansheng.pavilion', 1, y0);
    // 逐亭陈设
    if (key === 'R01') {
      n += inAltar(b, cx, cz + 0.9, y0, 0, 2.4);
      n += inCushion(b, cx - 1.0, cz - 0.8, y0, 0.42);
      n += inCushion(b, cx + 1.0, cz - 0.8, y0, 0.42);
      n += inLamp(b, cx - 2.8, cz + 1.7, y0, 1.9);
      n += inLamp(b, cx + 2.8, cz + 1.7, y0, 1.9);
      n += inScrolls(b, cx + 2.4, cz - 1.4, y0, 3);
      n += inRack(b, cx - 2.9, cz - 0.9, y0, Math.PI / 2, 2.2, 2.6, 2, 'bone');
      sg.quad(atlas.text('ssP1', '前塵', 160, 96, { color: '#baffef', glow: '#baffef', fontPx: 60, bg: 'rgba(20,30,28,0.86)' }), 1.5, 0.9, cx, y0 + 2.7, cz - d / 2 + 0.26, 0);
    } else if (key === 'R02') {
      n += inTable(b, cx - 0.8, cz, y0, 1.6, 0.9, 0.66);
      n += inScrolls(b, cx - 0.8, cz, y0 + 0.72, 3);
      n += inSealBox(b, cx + 0.2, cz, y0 + 0.72);
      n += inCushion(b, cx + 1.4, cz - 1.2, y0, 0.42);
      n += inCushion(b, cx + 1.4, cz + 1.2, y0, 0.42);
      n += inLamp(b, cx - 1.9, cz - 2.2, y0, 1.8);
      n += inLamp(b, cx - 1.9, cz + 2.2, y0, 1.8);
      n += inRack(b, cx + 2.4, cz, y0, -Math.PI / 2, 2.2, 2.6, 2, 'bone');
      sg.quad(atlas.text('ssP2', '今生', 160, 96, { color: '#4d7cff', glow: '#4d7cff', fontPx: 60, bg: 'rgba(16,20,34,0.86)' }), 1.5, 0.9, cx + w / 2 - 0.26, y0 + 2.7, cz, -Math.PI / 2);
    } else if (key === 'R03') {
      n += inTable(b, cx - 0.6, cz, y0, 1.6, 0.9, 0.66);
      n += inScrolls(b, cx - 0.6, cz, y0 + 0.72, 3);
      n += inCushion(b, cx + 1.2, cz - 1.1, y0, 0.42);
      n += inCushion(b, cx + 1.2, cz + 1.1, y0, 0.42);
      n += inLamp(b, cx + 2.0, cz - 2.1, y0, 1.8);
      n += inLamp(b, cx + 2.0, cz + 2.1, y0, 1.8);
      n += inAltar(b, cx - 2.2, cz, y0, Math.PI / 2, 2.2);
      sg.quad(atlas.text('ssP3', '來世', 160, 96, { color: '#e8f0ff', fontPx: 60, bg: 'rgba(28,26,20,0.86)' }), 1.5, 0.9, cx - w / 2 + 0.26, y0 + 2.7, cz, Math.PI / 2);
    } else if (key === 'R04') {
      n += inRack(b, cx - 2.9, cz - 0.4, y0, Math.PI / 2, 2.4, 3.0, 3, 'bone');
      n += inRack(b, cx + 2.9, cz - 0.4, y0, -Math.PI / 2, 2.4, 3.0, 3, 'scroll');
      n += inTable(b, cx, cz - 0.2, y0, 1.8, 0.9, 0.66);
      n += inScrolls(b, cx, cz - 0.2, y0 + 0.72, 4);
      n += inCushion(b, cx, cz + 1.2, y0, 0.44);
      n += inLamp(b, cx - 1.4, cz + 1.7, y0, 1.9);
      n += inLamp(b, cx + 1.4, cz + 1.7, y0, 1.9);
      sg.quad(atlas.text('ssP4', '碑銘', 160, 96, { color: '#e8e3d5', fontPx: 60, bg: 'rgba(51,57,63,0.88)' }), 1.5, 0.9, cx, y0 + 2.7, cz + d / 2 - 0.26, Math.PI);
    } else if (key === 'R05') {
      n += inAltar(b, cx, cz + 0.9, y0, 0, 2.6);
      n += inCushion(b, cx - 0.9, cz - 0.9, y0, 0.42);
      n += inCushion(b, cx + 0.9, cz - 0.9, y0, 0.42);
      n += inLamp(b, cx - 2.4, cz + 1.8, y0, 1.9);
      n += inLamp(b, cx + 2.4, cz + 1.8, y0, 1.9);
      n += inScrolls(b, cx + 2.3, cz - 1.6, y0, 3);
      n += inJar(b, cx - 2.3, cz - 1.6, y0, 0.8);
    } else {
      n += inPallet(b, cx - 1.2, cz - 0.6, y0, Math.PI / 2);
      n += inTable(b, cx + 1.2, cz + 1.2, y0, 1.4, 0.8, 0.62);
      n += inScrolls(b, cx + 1.2, cz + 1.2, y0 + 0.66, 2);
      n += inCushion(b, cx + 1.2, cz - 0.6, y0, 0.42);
      n += inLamp(b, cx - 2.2, cz + 1.9, y0, 1.9);
      n += inRack(b, cx + 2.5, cz - 1.6, y0, -Math.PI / 2, 2.0, 2.6, 2, 'torture');
      n += inChainStake(b, cx - 2.4, cz + 0.4, y0, Math.PI / 2);
    }
    b.kit('interior.sansheng.' + key, n, y0);
  }
  // 亭间石径（把六亭与石台环道接成一体）
  for (const [ax, az, bx2, bz2] of [
    [24, -93, 24, -86.5], [32.8, -108, 27.5, -108], [15.2, -109.5, 20.5, -109.5],
    [24, -122.5, 24, -128], [31, -96, 27.6, -99.4], [17, -96, 20.4, -99.4],
  ] as const) {
    const len = Math.hypot(bx2 - ax, bz2 - az);
    b.box('ash', 2.2, 0.1, len, (ax + bx2) / 2, y + 0.06, (az + bz2) / 2, shade(INP.roughD, 1.1), Math.atan2(bx2 - ax, bz2 - az));
  }
  b.kit('sansheng.pavilionPath', 6, y + 0.06);
}

/** 望乡台塔身：一层敞亭（罩罗盘）+ 两道腰檐 + 两层平座栏杆 + 逐层直棂窗 + 相轮塔刹 */
function wangxiangTower(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, top: number): void {
  const T = (dy: number): number => top + dy;
  // 一层敞亭：四角石柱 + 阑额 + 地栿 + 台明压边（罗盘与泪痕石留在亭内）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('ash', 0.46, 3.5, 0.46, x + sx * 3.66, T(1.95), z + sz * 3.66, shade(0x4e5860, 1.05));
  }
  for (const s of [-1, 1]) {
    b.box('ash', 7.78, 0.34, 0.34, x, T(3.5), z + s * 3.66, shade(0x4e5860, 1.0));
    b.box('ash', 0.34, 0.34, 7.78, x + s * 3.66, T(3.5), z, shade(0x4e5860, 1.0));
    b.box('ash', 7.78, 0.22, 0.3, x, T(0.31), z + s * 3.66, shade(0x4e5860, 0.9));
    b.box('ash', 0.3, 0.22, 7.78, x + s * 3.66, T(0.31), z, shade(0x4e5860, 0.9));
    b.box('ash', 8.6, 0.22, 0.9, x, T(0.22), z + s * 3.9, shade(0x5a646c, 1.02));
    b.box('ash', 0.9, 0.22, 8.6, x + s * 3.9, T(0.22), z, shade(0x5a646c, 1.02));
  }
  b.kit('wangxiang.tower.body', 8, T(2));

  // 腰檐一：四棱台裙檐（下 5.3 / 上 3.6 半宽）+ 檐口滴水线
  b.pyramid('roof', 0.68, 1, x, T(4.08), z, 0x14161a, 0, 7.5, 0.95, 7.5);
  for (const s of [-1, 1]) {
    b.box('ash', 10.44, 0.16, 0.2, x, T(3.64), z + s * 5.22, shade(0x3b424a, 1.1));
    b.box('ash', 0.2, 0.16, 10.44, x + s * 5.22, T(3.64), z, shade(0x3b424a, 1.1));
  }
  b.kit('wangxiang.tower.eave', 1, T(4.2));

  // 直棂窗：ax=0 为 ±z 面，ax=1 为 ±x 面，fd 为该层墙面半宽（面板 + 三直棂 + 一横档）
  const win = (s: number, ax: number, o: number, fd: number, yy: number, ww: number, wh: number): void => {
    const c1 = ax ? x + s * fd : x + o;
    const c2 = ax ? z + o : z + s * fd;
    b.box('ash', ax ? 0.12 : ww, wh, ax ? ww : 0.12, c1, yy, c2, shade(0x2a2622, 0.62));
    for (const v of [-0.34, 0, 0.34]) {
      b.box('wood', 0.07, wh - 0.12, 0.07, ax ? x + s * (fd + 0.06) : x + o + v, yy, ax ? z + o + v : z + s * (fd + 0.06), 0x1f1a14);
    }
    b.box('wood', ax ? 0.06 : ww * 0.94, 0.07, ax ? ww * 0.94 : 0.06, ax ? x + s * (fd + 0.08) : x + o, yy + wh * 0.2, ax ? z + o : z + s * (fd + 0.08), 0x1f1a14);
    b.kit('wangxiang.tower.window', 1, yy);
  };

  // 两层平座：台板 + 平座枋 + 斗栱托 + 白玉栏杆
  for (const [py2, half, hgt] of [[4.86, 4.42, 1.0], [8.36, 3.78, 0.95]] as const) {
    b.box('ash', half * 2, 0.22, half * 2, x, T(py2), z, shade(0x5a646c, 1.06));
    for (const s of [-1, 1]) {
      b.box('ash', half * 2, 0.2, 0.24, x, T(py2 - 0.2), z + s * (half - 0.12), shade(0x4e5860, 1.0));
      b.box('ash', 0.24, 0.2, half * 2, x + s * (half - 0.12), T(py2 - 0.2), z, shade(0x4e5860, 1.0));
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      b.box('ash', 0.3, 0.42, 0.3, x + Math.cos(a) * (half - 0.34), T(py2 - 0.36), z + Math.sin(a) * (half - 0.34), shade(0x4e5860, 0.96));
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k <= 4; k++) {
        const t2 = -half + (half * 2 * k) / 4;
        b.box('ash', 0.16, hgt, 0.16, x + t2, T(py2 + hgt / 2), z + s * half, shade(0xd8d0c0, 1.02));
        b.box('ash', 0.16, hgt, 0.16, x + s * half, T(py2 + hgt / 2), z + t2, shade(0xd8d0c0, 1.02));
      }
      b.box('ash', half * 2, 0.12, 0.18, x, T(py2 + hgt), z + s * half, shade(0xd8d0c0, 1.08));
      b.box('ash', 0.18, 0.12, half * 2, x + s * half, T(py2 + hgt), z, shade(0xd8d0c0, 1.08));
      b.box('ash', half * 2, 0.09, 0.14, x, T(py2 + hgt * 0.45), z + s * half, shade(0xc0b8a8, 1.02));
      b.box('ash', 0.14, 0.09, half * 2, x + s * half, T(py2 + hgt * 0.45), z, shade(0xc0b8a8, 1.02));
    }
    b.kit('wangxiang.tower.balcony', 1, T(py2));
    b.kit('wangxiang.tower.rail', 20, T(py2 + 0.5));
  }

  // 二层：四面墙（墙脚埋入平座板）+ 每面三窗
  for (const s of [-1, 1]) {
    b.box('ash', 7.2, 2.66, 0.5, x, T(6.16), z + s * 3.35, shade(0x4e5860, 0.98));
    b.box('ash', 0.5, 2.66, 6.2, x + s * 3.35, T(6.16), z, shade(0x4e5860, 0.98));
  }
  for (const s of [-1, 1]) for (const o of [-2.1, 0, 2.1]) {
    win(s, 0, o, 3.6, T(6.15), 1.32, 1.12);
    win(s, 1, o, 3.6, T(6.15), 1.32, 1.12);
  }

  // 腰檐二（下 4.6 / 上 2.95）+ 檐口
  b.pyramid('roof', 0.64, 1, x, T(7.83), z, 0x14161a, 0, 6.5, 0.85, 6.5);
  for (const s of [-1, 1]) {
    b.box('ash', 9.04, 0.15, 0.18, x, T(7.43), z + s * 4.52, shade(0x3b424a, 1.1));
    b.box('ash', 0.18, 0.15, 9.04, x + s * 4.52, T(7.43), z, shade(0x3b424a, 1.1));
  }
  b.kit('wangxiang.tower.eave', 1, T(7.6));

  // 三层：四面墙 + 每面两窗
  for (const s of [-1, 1]) {
    b.box('ash', 5.8, 2.24, 0.46, x, T(9.5), z + s * 2.67, shade(0x4e5860, 0.98));
    b.box('ash', 0.46, 2.24, 4.88, x + s * 2.67, T(9.5), z, shade(0x4e5860, 0.98));
  }
  for (const s of [-1, 1]) for (const o of [-1.45, 1.45]) {
    win(s, 0, o, 2.9, T(9.62), 1.1, 0.92);
    win(s, 1, o, 2.9, T(9.62), 1.1, 0.92);
  }

  // 顶檐（下 4.88 / 上 0.59）+ 檐口
  b.pyramid('roof', 0.12, 1, x, T(11.55), z, 0x14161a, 0, 6.9, 1.9, 6.9);
  for (const s of [-1, 1]) {
    b.box('ash', 9.56, 0.16, 0.2, x, T(10.64), z + s * 4.78, shade(0x3b424a, 1.1));
    b.box('ash', 0.2, 0.16, 9.56, x + s * 4.78, T(10.64), z, shade(0x3b424a, 1.1));
  }
  b.kit('wangxiang.tower.eave', 1, T(10.7));

  // 塔刹：露盘 + 覆钵 + 刹杆 + 三圈相轮 + 宝珠（全用 ash/metal，不用 glow 做杆）
  b.cyl('metal', 1.22, 1.22, 0.16, 16, x, T(12.58), z, 0x6e6a5c);
  b.cyl('ash', 0.92, 1.32, 0.74, 16, x, T(13.05), z, shade(0x4e5860, 1.12));
  b.cyl('metal', 0.13, 0.17, 2.9, 8, x, T(14.35), z, 0x8a8a92);
  b.cyl('metal', 0.94, 0.94, 0.12, 16, x, T(13.86), z, 0xa8a8b0);
  b.cyl('metal', 0.76, 0.76, 0.12, 16, x, T(14.36), z, 0xa8a8b0);
  b.cyl('metal', 0.58, 0.58, 0.12, 16, x, T(14.86), z, 0xa8a8b0);
  b.cyl('metal', 0.2, 0.46, 0.5, 10, x, T(15.32), z, 0xb0b4bc);
  b.cyl('metal', 0.05, 0.3, 0.46, 10, x, T(15.8), z, 0xc0c4cc);
  b.kit('wangxiang.tower.finial', 1, T(13));
  b.kit('wangxiang.tower.ring', 3, T(14.3));

  // 「望鄉臺」匾挂南面阑额（旧版是悬在台缘外无支撑的浮板）
  sg.quad(atlas.text('wxBig', '望鄉臺', 260, 80, { color: '#ffd8b8', glow: '#ff7a2d', fontPx: 56, bg: 'rgba(10,6,4,0.8)' }), 4.6, 1.2, x, T(2.72), z + 3.94, 0);
  for (const s of [-1, 1]) b.box('wood', 0.08, 0.36, 0.08, x + s * 1.7, T(3.36), z + 3.88, 0x2a201a);
}

// ============ 望乡台盘道辅助（WS-22 / J1-12） ============
/** 盘道局部系（ry=-a：+z 上行切向、+x 半径向外）→ 世界 */
function rampPt(cx: number, cz: number, a: number, lx: number, lz: number): [number, number] {
  const ca = Math.cos(a), sa = Math.sin(a);
  return [cx + ca * lx - sa * lz, cz + sa * lx + ca * lz];
}

/** 圆杆定向：CylinderGeometry 轴向为局部 +y，解 rz=-asin(tx)、rx=atan2(tz,ty) 可指任意方向（圆截面不受翻滚角影响） */
function rodTo(b: Baker, rad: number, len: number, x: number, y: number, z: number, tx: number, ty: number, tz: number, hex: number): void {
  const rz = -Math.asin(Math.max(-1, Math.min(1, tx)));
  const rx = Math.atan2(tz, ty);
  b.cyl('ash', rad, rad, len, 8, x, y, z, hex, 0, rx, rz);
}

/** 望乡台（47 卷 §十二：迁正 spec (-150,-150)，台面 y=-244；旧 (-40,30) 退役） */
export function buildWangxiang(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const y = UNDER.y;
  const x = -150, z = -150;
  // 台基三层收分（26→20→14，各高 5.3）
  for (let k = 0; k < 3; k++) b.box('wall', 26 - k * 6, 5.3, 26 - k * 6, x, y + 2.65 + k * 5.3, z, shade(0x4a3c33, 0.85 + k * 0.06));
  const top = y + 15.9;
  // ---- 盘道：8 段螺旋（南起，绕东-北-西），半径与起止角度原位不动；段内拆 3 级踏面 ----
  const RP = { n: 8, span: 0.72, r0: 15.5, dr: 1.2, y0: 1.2, rise: 1.85, tread: 0.62 };
  const rise1 = RP.rise / 3;                       // 段内均分高差 0.6167
  for (let k = 0; k < RP.n; k++) {
    const a = -Math.PI / 2 + k * RP.span;
    const r = RP.r0 - k * RP.dr;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ry = -a;                                 // 局部 +z 对齐上行切向
    const ccx = x + ca * r, ccz = z + sa * r;      // 段心（原石板位置）
    const h0 = y + RP.y0 + k * RP.rise;            // 本段第一级踏面标高（原石板中心线）
    for (let j = 0; j < 3; j++) {
      const [tx, tz] = rampPt(ccx, ccz, a, 0, (j - 1) * RP.tread);
      const tTop = h0 + j * rise1;
      b.box('ash', 3.2, rise1 + 0.02, RP.tread, tx, tTop - (rise1 + 0.02) / 2, tz, shade(0x3b424a, 0.96 + j * 0.05), ry);
      // 踏面鼻线：前缘一道磨亮石口（4.5cm 高，读作踩磨边）
      const [nx2, nz2] = rampPt(ccx, ccz, a, 0, (j - 1) * RP.tread - RP.tread / 2 + 0.06);
      b.box('ash', 3.1, 0.02, 0.13, nx2, tTop + 0.004, nz2, shade(0x4e5860, 1.14), ry);
    }
    // 栏板：每段每侧 1 望柱（段内共 2 柱）+ 1 道圆寻杖，随段均匀抬升
    for (const s of [-1, 1]) {
      const [px, pz] = rampPt(ccx, ccz, a, s * 1.63, -0.72);
      b.box('ash', 0.2, 1.06, 0.2, px, h0 + 0.53, pz, shade(0xd8d0c0, 1.0), ry);
      b.box('ash', 0.28, 0.1, 0.28, px, h0 + 1.11, pz, shade(0xd8d0c0, 1.12), ry);
      const run = Math.hypot(1.66, 2 * rise1);
      const [qx, qz] = rampPt(ccx, ccz, a, s * 1.63, 0.11);
      rodTo(b, 0.085, run, qx, h0 + 1.0 + rise1, qz, -sa * (1.66 / run), (2 * rise1) / run, ca * (1.66 / run), shade(0x4e5860, 1.1));
    }
    b.kit('wangxiang.ramp.tread', 3, h0);
    b.kit('wangxiang.ramp.rail', 2, h0 + 0.6);
  }
  // WS-25 盘道魂灯（J4-29，每 2 段 1 组共 4 组）：坐在外侧望柱柱头（h0+1.16）上，随段抬升，不悬空
  for (let k = 0; k < RP.n; k += 2) {
    const a = -Math.PI / 2 + k * RP.span;
    const r = RP.r0 - k * RP.dr;
    const h0 = y + RP.y0 + k * RP.rise;
    const [px, pz] = rampPt(x + Math.cos(a) * r, z + Math.sin(a) * r, a, 1.63, -0.72);
    b.box('metal', 0.3, 0.08, 0.3, px, h0 + 1.2, pz, 0x2a2622, -a);
    b.box('glow', 0.24, 0.34, 0.24, px, h0 + 1.41, pz, 0x4d7cff, -a);
    b.box('metal', 0.3, 0.05, 0.3, px, h0 + 1.61, pz, 0x2a2622, -a);
    b.kit('wangxiang.light.rampLantern', 1, h0 + 1.41);
  }
  // 末段过渡平台：末级踏面外延 2.1（切向 z +0.93..+3.03）× r7.0–9.2
  // 补末级 15.383 → 15.87 的最后一级 0.49；平台顶故意比台顶低 3cm（石口），避开与台基顶面的共面闪烁
  const aL = -Math.PI / 2 + 7 * RP.span;           // 末段方位（原起止角不动）
  const caL = Math.cos(aL), saL = Math.sin(aL);
  const [lcx, lcz] = rampPt(x + caL * (RP.r0 - 7 * RP.dr), z + saL * (RP.r0 - 7 * RP.dr), aL, 1.0, 1.98);
  b.box('ash', 2.2, 0.62, 2.1, lcx, top - 0.34, lcz, shade(0x3b424a, 1.04), -aL);
  b.kit('wangxiang.ramp.landing', 1, top - 0.03);
  // 台顶收头石：平台外缘压边石（外侧临空边，兼作挡脚）
  const [scx, scz] = rampPt(x + caL * (RP.r0 - 7 * RP.dr), z + saL * (RP.r0 - 7 * RP.dr), aL, 1.95, 1.98);
  b.box('ash', 0.66, 0.22, 2.34, scx, top + 0.08, scz, shade(0x4e5860, 1.12), -aL);
  b.kit('wangxiang.ramp.cope', 1, top + 0.08);
  // 起步收头石：段 0 首级下三级垫石（逐级收窄、顶压到首级踏面下 2cm）+ 地面门槛石
  const a0 = -Math.PI / 2, ca0 = Math.cos(a0), sa0 = Math.sin(a0);
  const [sx0, sz0] = rampPt(x + ca0 * RP.r0, z + sa0 * RP.r0, a0, 0, -0.62);
  b.box('ash', 3.44, 0.42, 0.96, sx0, y + 0.21, sz0, shade(0x3b424a, 0.9), -a0);
  b.box('ash', 3.36, 0.4, 0.86, sx0, y + 0.62, sz0, shade(0x3b424a, 0.96), -a0);
  b.box('ash', 3.28, 0.36, 0.76, sx0, y + 1.0, sz0, shade(0x3b424a, 1.02), -a0);
  const [sx1, sz1] = rampPt(x + ca0 * RP.r0, z + sa0 * RP.r0, a0, 0, -1.38);
  b.box('ash', 3.6, 0.26, 0.9, sx1, y + 0.13, sz1, shade(0x4e5860, 1.1), -a0);
  b.kit('wangxiang.ramp.cope', 1, y + 0.6);
  // 顶环白玉栏 20 柱
  for (let k = 0; k < 20; k++) {
    const a = k * 0.314;
    b.box('wall', 0.16, 1.1, 0.16, x + Math.cos(a) * 6.6, top + 0.55, z + Math.sin(a) * 6.6, BONE);
    if (k % 4 === 0) b.box('glow', 0.1, 0.1, 0.1, x + Math.cos(a) * 6.6, top + 1.2, z + Math.sin(a) * 6.6, shade(PHOS, 0.6));
  }
  b.cyl('wood', 6.7, 6.7, 0.08, 20, x, top + 1.05, z, shade(BONE, 0.9), 0, 0, 0, true);
  // 罗盘刻纹（径 6 青铜 + 指针恒指北偏西 7°；旧指针是一根竖立的 2.6m 扁棒）
  b.cyl('glow', 3, 3, 0.08, 24, x, top + 0.1, z, shade(0x26282c, 1.6));
  b.box('glow', 0.22, 0.07, 4.4, x, top + 0.19, z, shade(COPPER, 1.3), -0.12);
  for (let k = 0; k < 8; k++) { const a = k * 0.785; b.box('glow', 0.1, 0.5, 0.05, x + Math.cos(a) * 2.4, top + 0.18, z + Math.sin(a) * 2.4, BONE, -a); }
  // 泪痕石（径 0.8 凹面温润）——台明压边占去 z+3.45..4.35，石移出台明外
  b.cyl('glow', 0.8, 0.85, 0.16, 12, x, top + 0.14, z + 4.95, shade(0x33393f, 1.15));
  b.box('glow', 0.5, 0.04, 0.5, x, top + 0.24, z + 4.95, shade(ICEC, 0.5));
  // 雾幕（台缘高 3m 半透环——望乡幻象载体）
  b.cyl('glow', 6.9, 6.9, 3, 24, x, top + 1.5, z, shade(0x57534e, 0.75), 0, 0, 0, true);
  // 南缘垂幡 12（素面无字）
  for (let k = 0; k < 12; k++) {
    const fx = x - 5.5 + k * 1.0;
    b.box('glow', 0.3, 2.2, 0.04, fx, top + 0.9, z - 6.9, 0xc9b380, 0, 0, 0.03 * (k % 3 - 1));
  }
  // 塔身（旧版台顶只有罗盘与一圈栏柱，台上无塔）
  wangxiangTower(b, sg, atlas, x, z, top);

  // 界碑「一炷香為限」：旧坐标 (x+9,z+10) 埋在 26×26 台基内，移到北侧盘道起步外 r19.6
  const jx = x + 4.2, jz = z - 19.2;
  b.box('ash', 1.1, 0.3, 0.9, jx, y + 0.15, jz, shade(0x4e5860, 0.95));
  b.box('ash', 0.62, 2.1, 0.34, jx, y + 1.35, jz, shade(0x4e5860, 1.08));
  b.box('ash', 0.86, 0.2, 0.44, jx, y + 2.5, jz, shade(0x4e5860, 1.16));
  sg.quad(atlas.text('wxJie', '一炷香為限', 300, 56, { color: '#e8e3d5', fontPx: 40, bg: 'rgba(51,57,63,0.9)' }), 2.6, 0.5, jx, y + 1.9, jz - 0.2, Math.PI);
  b.kit('wangxiang.jiebei', 1, y + 1.2);
  // 守台棚：旧坐标 (x+9.5,z+8) 同样被台基吞掉，移到台基西北 r19.7 并补四柱攒尖与供案
  const hx = x - 6.4, hz = z - 18.6;
  for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) b.box('wood', 0.24, 2.9, 0.24, hx + dx, y + 1.45, hz + dz, 0x1f1a14);
  b.box('wood', 3.9, 0.18, 3.9, hx, y + 2.98, hz, 0x1a1c20);
  b.pyramid('roof', 0.08, 0.72, hx, y + 3.32, hz, 0x14161a, 0, 5.0, 0.7, 5.0);
  b.box('wood', 1.7, 0.9, 0.7, hx, y + 0.45, hz + 1.1, 0x2a201a);
  b.cyl('ceramic', 0.34, 0.26, 0.3, 10, hx, y + 1.05, hz + 1.1, 0x5a4a3a);
  for (let k = 0; k < 3; k++) b.box('glow', 0.06, 0.9 - k * 0.25, 0.06, hx - 0.4 + k * 0.4, y + 1.55, hz + 1.1, 0xff9e00);
  b.kit('wangxiang.keeperHut', 1, y + 1.5);
  b.kit('wangxiang.timer', 3, y + 1.55);

  buildWangxiangRooms(b);
}

/** 望乡台阁室内壳 R01–R06：守台棚 / 盘道门廊 / 台顶亭心 / 塔二层 / 塔三层 / 候台亭 */
export function buildWangxiangRooms(b: Baker): void {
  const y = UNDER.y;
  const x = -150, z = -150, top = y + 15.9;
  let n = 0;

  // ---- R01 台脚守台棚（既有棚体收壳） ----
  const hx = x - 6.4, hz = z - 18.6;
  n = inFloor(b, hx, hz, 3.9, 3.9, y + 0.04, INP.rough, 1.3);
  n += inWall(b, hx - 1.95, hz - 1.95, hx + 1.95, hz - 1.95, y, 2.9, 0.32, INP.brick);
  n += inWall(b, hx - 1.95, hz - 1.95, hx - 1.95, hz + 1.95, y, 2.9, 0.32, INP.brick, [[1.6, 3.0]]);
  n += inWall(b, hx + 1.95, hz - 1.95, hx + 1.95, hz + 1.95, y, 2.9, 0.32, INP.brick);
  n += inDoor(b, hx - 1.95, hz + 0.2, y, 1.4, 2.4, Math.PI / 2);
  n += inWindow(b, hx, hz - 1.93, y + 1.0, 1.4, 1.2, 0, true);
  n += inWindow(b, hx + 1.93, hz + 0.6, y + 1.0, 1.2, 1.2, Math.PI / 2, true);
  n += inSkirt(b, hx - 1.75, hz - 1.75, hx + 1.75, hz - 1.75, y);
  n += inSkirt(b, hx + 1.75, hz - 1.75, hx + 1.75, hz + 1.75, y);
  n += inSkirt(b, hx - 1.75, hz - 1.75, hx - 1.75, hz + 1.75, y);
  n += inCeil(b, hx, hz, 3.9, 3.9, y + 2.86, 1);
  n += inScrolls(b, hx + 0.2, hz + 1.1, y + 1.02, 2);
  n += inCushion(b, hx - 0.9, hz + 0.3, y, 0.4);
  n += inLamp(b, hx + 1.4, hz + 1.4, y, 1.6);
  n += inVeil(b, hx - 1.0, hz + 0.55, hx + 1.0, hz + 0.55, y + 2.1, 0.7);
  n += inRack(b, hx + 1.5, hz - 1.2, y, -Math.PI / 2, 2.0, 2.4, 2, 'bone');
  n += inChainStake(b, hx - 1.3, hz - 1.2, y, Math.PI / 2);
  b.kit('interior.wangxiang.R01', n, y);

  // ---- R02 盘道门廊（台基南，盘道起步外侧） ----
  const gx = x, gz = z - 21;
  n = inFloor(b, gx, gz, 6.0, 4.4, y + 0.04, INP.rough, 1.5);
  n += inSteps(b, gx, gz + 2.2, 3.0, y, 2, 0.12, 0.3);
  n += inWall(b, gx - 3, gz - 2.2, gx + 3, gz - 2.2, y, 3.4, 0.4, INP.brick, [[2.2, 3.8]]);
  n += inWall(b, gx - 3, gz - 2.2, gx - 3, gz + 2.2, y, 3.4, 0.4, INP.brick);
  n += inWall(b, gx + 3, gz - 2.2, gx + 3, gz + 2.2, y, 3.4, 0.4, INP.brick);
  n += inWall(b, gx - 3, gz + 2.2, gx + 3, gz + 2.2, y, 3.4, 0.4, INP.brick, [[2.4, 3.6]]);
  n += inDoor(b, gx, gz - 2.2, y, 1.6, 2.8, 0);
  n += inDoor(b, gx, gz + 2.2, y, 1.2, 2.6, 0);
  for (const ox of [-1.9, 1.9]) n += inWindow(b, gx + ox, gz - 2.18, y + 1.0, 1.2, 1.2, 0, true);
  n += inSkirt(b, gx - 2.8, gz - 2.0, gx + 2.8, gz - 2.0, y);
  n += inSkirt(b, gx - 2.8, gz + 2.0, gx + 2.8, gz + 2.0, y);
  n += inSkirt(b, gx - 2.8, gz - 2.0, gx - 2.8, gz + 2.0, y);
  n += inSkirt(b, gx + 2.8, gz - 2.0, gx + 2.8, gz + 2.0, y);
  n += inCeil(b, gx, gz, 6.0, 4.4, y + 3.4, 1);
  roofOn(b, 7.4, 5.8, y + 3.6, gx, gz, 0, 0x14161a, PHOS);
  n += inLamp(b, gx - 2.3, gz + 1.4, y, 1.9);
  n += inLamp(b, gx + 2.3, gz + 1.4, y, 1.9);
  n += inChainStake(b, gx - 2.2, gz - 1.2, y, Math.PI / 2);
  n += inChainStake(b, gx + 2.2, gz - 1.2, y, -Math.PI / 2);
  n += inLattice(b, gx + 2.2, gz - 2.0, gx + 2.2, gz + 2.0, y, 2.8);
  n += inCushion(b, gx - 1.1, gz + 0.6, y, 0.42);
  n += inCushion(b, gx + 1.1, gz + 0.6, y, 0.42);
  n += inScrolls(b, gx + 2.0, gz - 1.9, y, 2);
  n += inRack(b, gx - 2.6, gz + 0.2, y, Math.PI / 2, 2.0, 2.4, 2, 'bone');
  b.kit('interior.wangxiang.R02', n, y);

  // ---- R03 台顶亭心（既有敞亭内）：石框 + 三面格栅 + 垂幔 + 黑梁藻井 ----
  n = 0;
  for (const s of [-1, 1]) {
    b.box('ash', 7.4, 0.1, 0.42, x, top + 0.05, z + s * 3.5, shade(INP.rough, 1.05));
    b.box('ash', 0.42, 0.1, 7.4, x + s * 3.5, top + 0.05, z, shade(INP.rough, 1.05));
    n += 2;
  }
  n += inLattice(b, x - 3.5, z - 3.62, x + 3.5, z - 3.62, top + 0.1, 2.4);
  n += inLattice(b, x - 3.62, z - 3.5, x - 3.62, z + 3.5, top + 0.1, 2.4);
  n += inLattice(b, x + 3.62, z - 3.5, x + 3.62, z + 3.5, top + 0.1, 2.4);
  n += inVeil(b, x - 3.5, z + 3.6, x + 3.5, z + 3.6, top + 3.2, 0.9, INP.cloth);
  n += inCeil(b, x, z, 7.2, 7.2, top + 3.3, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) n += inLamp(b, x + sx * 3.0, z + sz * 3.0, top + 0.06, 1.7);
  n += inAltar(b, x, z - 3.3, top + 0.06, 0, 2.2);
  n += inScrolls(b, x + 2.6, z - 2.4, top + 0.06, 3);
  n += inCushion(b, x - 1.5, z + 3.1, top + 0.06, 0.42);
  n += inCushion(b, x + 1.5, z + 3.1, top + 0.06, 0.42);
  n += inRack(b, x - 3.0, z + 0.4, top + 0.06, Math.PI / 2, 2.2, 2.6, 2, 'bone');
  b.kit('interior.wangxiang.R03', n, top);

  // ---- R04 塔二层内室（望乡镜） ----
  const f2 = top + 5.0;
  n = 0;
  b.box('ash', 6.2, 0.1, 6.2, x, f2 - 0.02, z, INP.slab);
  n++;
  for (const s of [-1, 1]) {
    n += inSkirt(b, x - 3.05, z + s * 3.05, x + 3.05, z + s * 3.05, f2);
    n += inSkirt(b, x + s * 3.05, z - 3.05, x + s * 3.05, z + 3.05, f2);
  }
  n += inCeil(b, x, z, 6.2, 6.2, top + 7.15, 1);
  // 望乡镜：铜框 + 幽蓝镜面 + 双柱座
  b.box('ash', 2.4, 0.4, 0.6, x, f2 + 0.2, z - 2.7, shade(INP.rough, 1.05));
  b.cyl('metal', 0.95, 0.95, 0.14, 16, x, f2 + 1.6, z - 2.62, shade(INP.cu, 0.9), 0, Math.PI / 2);
  b.cyl('glow', 0.86, 0.86, 0.06, 16, x, f2 + 1.6, z - 2.55, shade(INP.blue, 0.55), 0, Math.PI / 2);
  b.box('metal', 0.16, 1.3, 0.16, x - 0.9, f2 + 0.65, z - 2.7, INP.steel);
  b.box('metal', 0.16, 1.3, 0.16, x + 0.9, f2 + 0.65, z - 2.7, INP.steel);
  n += 6;
  n += inAltar(b, x, z - 0.9, f2, 0, 2.6);
  n += inCushion(b, x - 0.8, z + 0.5, f2, 0.42);
  n += inCushion(b, x + 0.8, z + 0.5, f2, 0.42);
  n += inRack(b, x + 2.6, z + 0.6, f2, -Math.PI / 2, 2.4, 3.0, 3, 'scroll');
  n += inRack(b, x - 2.6, z + 1.4, f2, Math.PI / 2, 2.0, 2.4, 2, 'bone');
  n += inLamp(b, x - 2.6, z - 2.4, f2, 1.7);
  n += inLamp(b, x + 2.6, z - 2.4, f2, 1.7);
  n += inScrolls(b, x - 1.6, z + 2.4, f2, 2);
  b.kit('interior.wangxiang.R04', n, f2);

  // ---- R05 塔三层内室（凭栏眺望） ----
  const f3 = top + 8.47;
  n = 0;
  b.box('ash', 4.88, 0.1, 4.88, x, f3 - 0.02, z, INP.slab);
  n++;
  for (const s of [-1, 1]) {
    n += inSkirt(b, x - 2.4, z + s * 2.4, x + 2.4, z + s * 2.4, f3);
    n += inSkirt(b, x + s * 2.4, z - 2.4, x + s * 2.4, z + 2.4, f3);
  }
  n += inCeil(b, x, z, 4.88, 4.88, top + 10.5, 1);
  b.cyl('metal', 0.62, 0.62, 0.12, 16, x, f3 + 1.5, z - 2.05, shade(INP.cu, 0.9), 0, Math.PI / 2);
  b.cyl('glow', 0.54, 0.54, 0.06, 16, x, f3 + 1.5, z - 1.98, shade(INP.ice, 0.5), 0, Math.PI / 2);
  b.box('ash', 1.7, 0.34, 0.5, x, f3 + 0.17, z - 2.05, shade(INP.rough, 1.05));
  n += 3;
  n += inAltar(b, x, z - 0.6, f3, 0, 2.0);
  n += inCushion(b, x - 0.7, z + 0.5, f3, 0.4);
  n += inCushion(b, x + 0.7, z + 0.5, f3, 0.4);
  n += inScrolls(b, x - 1.7, z + 1.5, f3, 2);
  n += inLamp(b, x - 1.9, z - 1.4, f3, 1.6);
  n += inLamp(b, x + 1.9, z - 1.4, f3, 1.6);
  n += inRack(b, x + 2.1, z + 1.2, f3, -Math.PI / 2, 1.8, 2.2, 2, 'bone');
  b.kit('interior.wangxiang.R05', n, f3);

  // ---- R06 候台亭（台基西，候台者歇脚处） ----
  const wx = x - 16.5, wz = z;
  n = inFloor(b, wx, wz, 5.0, 5.0, y + 0.04, INP.rough, 1.4);
  n += inWall(b, wx - 2.5, wz - 2.5, wx + 2.5, wz - 2.5, y, 3.2, 0.4, INP.brick, [[1.9, 3.1]]);
  n += inWall(b, wx - 2.5, wz + 2.5, wx + 2.5, wz + 2.5, y, 3.2, 0.4, INP.brick);
  n += inWall(b, wx - 2.5, wz - 2.5, wx - 2.5, wz + 2.5, y, 3.2, 0.4, INP.brick);
  n += inLattice(b, wx + 2.5, wz - 2.3, wx + 2.5, wz + 2.3, y, 2.6);
  n += inDoor(b, wx, wz - 2.5, y, 1.2, 2.6, 0);
  for (const ox of [-1.4, 1.4]) n += inWindow(b, wx + ox, wz - 2.48, y + 1.0, 1.1, 1.1, 0, true);
  n += inSkirt(b, wx - 2.3, wz - 2.3, wx + 2.3, wz - 2.3, y);
  n += inSkirt(b, wx - 2.3, wz + 2.3, wx + 2.3, wz + 2.3, y);
  n += inSkirt(b, wx - 2.3, wz - 2.3, wx - 2.3, wz + 2.3, y);
  n += inCeil(b, wx, wz, 5.0, 5.0, y + 3.2, 1);
  roofOn(b, 6.4, 6.4, y + 3.4, wx, wz, 0, 0x14161a, PHOS);
  n += inAltar(b, wx, wz - 1.5, y, 0, 2.0);
  n += inCushion(b, wx - 0.9, wz + 0.3, y, 0.42);
  n += inCushion(b, wx + 0.9, wz + 0.3, y, 0.42);
  n += inLamp(b, wx - 2.0, wz + 1.8, y, 1.8);
  n += inLamp(b, wx + 2.0, wz + 1.8, y, 1.8);
  n += inScrolls(b, wx + 1.7, wz - 1.9, y, 2);
  n += inRack(b, wx + 2.0, wz + 0.2, y, -Math.PI / 2, 1.8, 2.4, 2, 'bone');
  n += inChainStake(b, wx - 1.9, wz - 1.9, y, Math.PI / 2);
  b.kit('interior.wangxiang.R06', n, y);
}

/** B3 cast：守桥鬼差南北 + 守台鬼差 */
export function spawnNaiheGuards(crowd: { spawnStation(...a: unknown[]): unknown }): void {
  const y = UNDER.y;
  crowd.spawnStation('soldier', 1.6, -90, y, 'stand', '守桥岗·南：验籍挥灯三放行', 0,
    { name: '守桥鬼差', nick: '南岗', group: 'deity', weapon: '提灯', desc: '鬼火照半径三米，验籍放行', code: 'bridgeS' } as never);
  crowd.spawnStation('soldier', -1.6, -27, y, 'stand', '守桥岗·北：过桥莫回头', Math.PI,
    { name: '守桥鬼差', nick: '北岗', group: 'deity', weapon: '提灯', desc: '二次停留即推魂', code: 'bridgeN' } as never);
  crowd.spawnStation('soldier', -156.4, -165.2, y + 0.1, 'stand', '守台鬼差·执香计时', Math.PI / 2,
    { name: '守台鬼差', nick: '香计时', group: 'deity', weapon: '燃香', desc: '一炷香为限，不得久留', code: 'wxguard' } as never);
}


// ============ WS-37 忘川双渡口（D-ITM 台账 4 件）：归魂渡 / 迎魂渡 / 孟婆渡船 / 系舟缆桩 ============
// 卷 30 §3.8（D-GZ-008）：归魂渡北岸 (-52,-152) / 迎魂渡南岸 (60,-30)。既有河岸石堤（z=-88.6 / -31.4，
// 压顶 y+1.47）保留不动，渡口跨堤而设：上堤三级 → 堤顶平台 → 下河十二级 → 水面。石材一律 ash。
const DX = {
  st: 0x3b424a, stD: 0x2e2a34, stL: 0x4e5860, wood: 0x2a1a16, lac: 0x1c161a,
  cu: 0xb87333, iron: 0x26282c, blood: 0x6e1f1f, phos: 0x3dff9c, paper: 0xc9b380, ash: 0x6e6a62,
} as const;

/** 归魂渡（北岸）：上堤三级 + 堤顶平台 + 下河十二级 + 两侧石帮 + 阶脚缆桩一对 */
function naiheFerryNorth(b: Baker, x: number): void {
  // 归魂渡（北岸）：D-ITM-0081
  const y = UNDER.y;
  // 上堤三级：自岸地 y 登上石堤压顶 y+1.47（堤顶不改，只在其北侧加三级踏跺）
  for (let i = 0; i < 3; i++) {
    b.box('ash', 6.2, 0.5, 0.42, x, y + 0.25 + i * 0.49, -90.72 + i * 0.42, shade(DX.stL, 0.94 + i * 0.03));
  }
  // 堤顶平台：压顶上加一层 0.16 的石台，与水侧第一级对齐
  b.box('ash', 6.4, 0.18, 1.9, x, y + 1.56, -88.75, shade(DX.stL, 1.04));
  b.box('ash', 6.6, 0.1, 0.24, x, y + 1.66, -87.86, shade(DX.st, 1.12));
  // 下河十二级：rise 0.11 / tread 0.42，末级高出水面 0.06
  for (let i = 0; i < 12; i++) {
    b.box('ash', 6.2, 0.14, 0.46, x, y + 1.44 - i * 0.11, -87.62 + i * 0.42, shade(DX.st, 0.94 + (i % 3) * 0.04));
  }
  // 两侧石帮：按踏面分段，每段自河床 y-1.0 顶到该段首级踏面下沿（不做悬空石阶）
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const top = 1.44 - k * 4 * 0.11;                 // 该段首级踏面标高
      const h = top - 0.1 + 1.0;                       // 河床 -1.0 → 踏面下 0.1
      const zc = -87.62 + k * 4 * 0.42 + 0.84;         // 四级的中心
      b.box('ash', 0.5, h, 1.72, x + s * 3.36, y - 1.0 + h / 2, zc, shade(DX.stD, 0.94 + k * 0.04));
    }
    // 阶脚缆桩：桩身 + 顶环 + 缠桩缆三匝
    b.box('ash', 0.42, 0.2, 0.42, x + s * 3.3, y + 0.34, -83.5, shade(DX.stL, 1.02));
    b.cyl('wood', 0.14, 0.18, 1.1, 6, x + s * 3.3, y + 0.99, -83.5, DX.wood);
    b.cyl('metal', 0.19, 0.19, 0.08, 8, x + s * 3.3, y + 1.58, -83.5, 0x9a9aa2, 0, 0, Math.PI / 2);
    for (let k = 0; k < 3; k++) {
      b.box('fabric', 0.34, 0.05, 0.05, x + s * 3.3, y + 1.1 + k * 0.12, -83.5 + 0.16, 0x6a5a44, k * 0.5);
    }
  }
  // 阶石湿滑：沿踏面前缘一道暗水痕（读作尽头红水拍岸）
  for (let i = 0; i < 12; i += 2) {
    b.box('glow', 5.8, 0.03, 0.1, x, y + 1.5 - i * 0.11, -87.82 + i * 0.42, shade(DX.blood, 0.5));
  }
  b.kit('hell.dock.ferryNorth', 1, y + 1.0);
}

/** 迎魂渡（南岸）：堤顶平台 + 下河六级 + 灯桩二根 + 登岸新灰 + 阶脚缆桩（D-ITM-0082） */
function naiheFerrySouth(b: Baker, x: number): void {
  // 迎魂渡（南岸）：D-ITM-0082
  const y = UNDER.y;
  // 堤顶平台：跨在压顶上，向水侧探出 1.9m
  b.box('ash', 7.4, 0.3, 2.6, x, y + 1.35, -32.9, shade(DX.stL, 1.02));
  b.box('ash', 7.6, 0.1, 0.26, x, y + 1.55, -31.66, shade(DX.st, 1.1));
  // 下河六级：自平台北缘向水面下行
  for (let i = 0; i < 6; i++) {
    b.box('ash', 7.0, 0.18, 0.5, x, y + 1.36 - i * 0.2, -34.32 - i * 0.44, shade(DX.st, 0.96 + (i % 3) * 0.03));
  }
  // 两侧石帮：按踏面分段，自河床 y-1.0 顶到该段首级踏面下沿
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const top = 1.36 - k * 3 * 0.2;
      const h = top - 0.12 + 1.0;
      b.box('ash', 0.46, h, 1.42, x + s * 3.66, y - 1.0 + h / 2, -34.3 - k * 1.4, shade(DX.stD, 0.96 + k * 0.05));
    }
  }
  // 灯桩二根：石座 + 木杆 + 挑臂 + 绿灯 + 罩箍（对岸见灯即知船至）
  for (const s of [-1, 1]) {
    const px = x + s * 3.0;
    b.box('ash', 0.56, 0.24, 0.56, px, y + 1.62, -32.2, shade(DX.stD, 1.0));
    b.cyl('wood', 0.09, 0.12, 2.9, 6, px, y + 3.14, -32.2, 0x1c141a);
    b.box('wood', 0.08, 0.08, 0.5, px, y + 4.5, -32.0, 0x2a2018);
    b.box('metal', 0.3, 0.42, 0.3, px, y + 4.3, -31.78, 0x2a2622);
    b.box('glow', 0.22, 0.3, 0.22, px, y + 4.3, -31.78, DX.phos);
    b.box('metal', 0.34, 0.06, 0.34, px, y + 4.52, -31.78, 0x4a4030);
  }
  // 登岸新灰：平台与首级踏面铺一层浅灰（迎新魂之灰，比旧岸浅一号）
  b.box('ash', 6.6, 0.04, 2.1, x, y + 1.52, -32.9, DX.ash);
  for (let i = 0; i < 3; i++) b.box('ash', 6.2, 0.03, 0.4, x, y + 1.47 - i * 0.2, -34.32 - i * 0.44, shade(DX.ash, 0.96));
  // 阶脚缆桩（与 D-ITM-0086 四桩分设，此处只做渡口自带的一对系船石）
  for (const s of [-1, 1]) {
    b.box('ash', 0.4, 0.22, 0.4, x + s * 2.2, y + 0.33, -37.6, shade(DX.stL, 1.0));
    b.cyl('wood', 0.12, 0.16, 0.9, 6, x + s * 2.2, y + 0.89, -37.6, DX.wood);
  }
  b.kit('hell.dock.ferrySouth', 1, y + 1.0);
}

/** 孟婆渡船：平底乌篷船（船底/四道列板/船首楔/船尾板）+ 乌篷 + 灯桅绿灯 + 渡资灰钱匣（D-ITM-0083） */
function naiheBoat(b: Baker, x: number, z: number): void {
  // 孟婆渡船：D-ITM-0083
  const y = UNDER.y + 0.14;
  // 船底与四道列板：船身长 7.8（z 向），宽 2.4
  b.box('lacquer', 2.2, 0.24, 7.4, x, y + 0.12, z, 0x141014);
  for (const s of [-1, 1]) {
    b.box('lacquer', 0.16, 0.3, 7.4, x + s * 1.12, y + 0.36, z, 0x1a1418);
    b.box('lacquer', 0.14, 0.28, 7.0, x + s * 1.2, y + 0.62, z, 0x221a1e, 0, 0, -s * 0.06);
    b.box('lacquer', 0.12, 0.24, 6.4, x + s * 1.26, y + 0.86, z + 0.1, 0x2a2024, 0, 0, -s * 0.1);
  }
  // 船首楔（尖头）与船尾板
  b.pyramid('lacquer', 0.1, 1.34, x, y + 0.42, z - 4.2, 0x1a1418, 0, 0.9, 0.7, 1.0);
  b.box('lacquer', 2.32, 0.5, 0.22, x, y + 0.55, z + 3.72, 0x1a1418);
  b.box('wood', 2.4, 0.1, 0.34, x, y + 0.84, z + 3.78, 0x2a1a16);
  // 舱板两道 + 舷缘压条
  for (const dz of [-1.4, 1.2]) b.box('wood', 2.1, 0.08, 0.28, x, y + 0.78, z + dz, 0x2a201a);
  for (const s of [-1, 1]) b.box('wood', 0.1, 0.08, 6.6, x + s * 1.16, y + 0.98, z, 0x2a1a16);
  // 乌篷：五道拱肋 + 篷布（薄箱按弧高分段叠）
  for (let k = 0; k < 5; k++) {
    const arc = Math.sin((k / 4) * Math.PI);
    b.box('fabric', 2.2 - k * 0.06, 0.05, 0.1, x, y + 1.06 + arc * 0.86, z - 1.5 + k * 0.72, 0x2b2430);
  }
  for (const s of [-1, 1]) {
    b.box('fabric', 0.08, 0.62, 2.5, x + s * 1.04, y + 1.36, z - 1.1, 0x2b2430, 0, 0, -s * 0.2);
    b.box('fabric', 0.06, 0.4, 2.3, x + s * 0.72, y + 1.72, z - 1.1, 0x342a38);
  }
  b.box('fabric', 1.5, 0.08, 2.7, x, y + 1.94, z - 1.1, 0x2b2430);
  // 灯桅：船首立杆 + 挑臂 + 绿灯 + 罩箍（大雾中唯一可见物）
  b.cyl('wood', 0.06, 0.08, 2.2, 6, x, y + 1.9, z - 3.3, 0x2a1a16);
  b.box('wood', 0.06, 0.06, 0.44, x, y + 2.96, z - 3.1, 0x2a1a16);
  b.box('metal', 0.24, 0.34, 0.24, x, y + 2.76, z - 2.9, 0x2a2622);
  b.box('glow', 0.18, 0.24, 0.18, x, y + 2.76, z - 2.9, DX.phos);
  b.box('metal', 0.28, 0.05, 0.28, x, y + 2.94, z - 2.9, 0x4a4030);
  // 渡资灰钱匣：船中木匣，匣底灰积不溢
  b.box('wood', 0.5, 0.34, 0.4, x - 0.5, y + 1.02, z + 1.9, 0x3a2a1e);
  b.box('glow', 0.4, 0.05, 0.3, x - 0.5, y + 1.2, z + 1.9, 0x6e6a62);
  b.box('fabric', 0.12, 0.04, 0.1, x - 0.5, y + 1.24, z + 1.9, 0xb8b0a0);
  // 船行无声唯水语：船侧散开的两道水纹
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    b.box('glow', 0.6 + k * 0.3, 0.02, 0.06, x + s * (1.7 + k * 0.34), y - 0.12, z - 2.6 + k * 1.6, shade(DX.blood, 0.5));
  }
  b.kit('hell.dock.boat', 1, y + 0.9);
}

/** 系舟缆桩（四根）：石础 + 桩身 + 勒痕 + 顶环 + 缠桩缆三匝（D-ITM-0086） */
function naiheMooring(b: Baker, x: number, z: number, i: number): void {
  // 系舟缆桩：D-ITM-0086
  const y = UNDER.y + 1.5;
  b.box('ash', 0.5, 0.2, 0.5, x, y + 0.1, z, shade(DX.stL, 1.0));
  b.cyl('wood', 0.15, 0.2, 1.0, 7, x, y + 0.7, z, DX.wood);
  for (let k = 0; k < 3; k++) b.cyl('wood', 0.155, 0.155, 0.05, 7, x, y + 0.5 + k * 0.14, z, 0x1a1210);   // 桩身勒痕
  b.cyl('metal', 0.2, 0.2, 0.08, 8, x, y + 1.22, z, 0x9a9aa2, 0, 0, Math.PI / 2);
  for (let k = 0; k < 3; k++) {
    b.box('fabric', 0.42, 0.05, 0.05, x, y + 0.72 + k * 0.13, z + 0.2, 0x6a5a44, k * 0.6 + i * 0.2);
  }
  b.box('glow', 0.22, 0.03, 0.22, x, y + 0.24, z, shade(DX.blood, 0.6));
  b.kit('hell.dock.mooring', 1, y + 0.7);
}

/** WS-37 忘川双渡口总装：北岸归魂渡 (-52) / 南岸迎魂渡 (60) / 孟婆渡船 (60,-41.5) / 缆桩四根 */
export function buildNaiheDocks(b: Baker): void {
  naiheFerryNorth(b, -52);
  naiheFerrySouth(b, 60);
  naiheBoat(b, 60, -41.5);
  for (let i = 0; i < 4; i++) {
    naiheMooring(b, 60 + (i % 2 ? 2.3 : -2.3), i < 2 ? -32.2 : -33.5, i);
  }
}
