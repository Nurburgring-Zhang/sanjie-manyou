import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UNDER } from './underworld';
import { HEAVEN_LIFT, heavenY } from './heavenFrame';

// 注意：本文件**不得** import ../actors/pools（模块级用 document.createElement，无头用例会崩），
// 也不得 import ../city/vehicles（它转手 import pools）。
// 神像与八兽的几何都带顶点色，而池里的 BODY_MAT 未开 vertexColors（用了会渲成一尊纯白像），
// 故 W12 自持一份顶点色材质：旗标与 city/vehicles.ts 的 VEH_MAT 完全一致 → three 复用同一
// 着色器程序，不新增 program、不新增材质组，仅多一个 material 实例。
export const W12_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 });

// ============ B9 生物行为（43 卷鬼魔/10 卷仙兽巡游；10/30 卷路线表） ============
// Runner 路径点巡逻（复用 HeroStage 同款模式）；姿态用 ACTIONS 语义（黑无常前倾=staggerWalk）

interface Runner { aId: number; pts: THREE.Vector3[]; i: number; speed: number }

interface SpawnOpt {
  occ: string; x: number; y: number; z: number; cloth: number; pants: number; skin: number;
  hat?: number; prop?: string | null; action?: string; scale?: number; doing: string;
  data: Record<string, unknown>; headKit?: 'bull' | 'horse' | 'beast';
}

// ============ WS-5 生物分型：37 类 → 4 体型组 + 特征 kit ============
// 全部实例化：几何只建一次，矩阵/实例色复用，不逐帧建对象
type GroupId = 'small' | 'medium' | 'large' | 'mythic';
type Feature = 'horn' | 'antler' | 'wing' | 'fin' | 'mane' | 'spine' | 'tail' | 'eye' | 'ear';

interface GroupDef { l: number; h: number; w: number; gait: number; orbit: number }
const GROUPS: Record<GroupId, GroupDef> = {
  small: { l: 0.46, h: 0.34, w: 0.40, gait: 9.4, orbit: 7 },    // 0.3–1m：鱼/鬼火/小鬼
  medium: { l: 1.20, h: 0.95, w: 0.72, gait: 5.1, orbit: 20 },   // 1–3m：狼犬/鹿/雁/鹰/鬼
  large: { l: 2.30, h: 1.80, w: 1.12, gait: 3.0, orbit: 34 },    // 3–6m：驼/马/仙鹿/狮/貔貅
  mythic: { l: 4.80, h: 3.60, w: 1.90, gait: 1.8, orbit: 72 },   // 6m+：麒麟/天龙/凤凰/青牛
};

// 飞行下界：地形/云海之上（天宫台面 201–214、云海雾面 197、地府 -260、城内地面 0、塔顶≈34）
const HOST_Y: Record<string, number> = { city: 0, sky: 201, under: UNDER.y };
const MIN_CLEAR: Record<GroupId, number> = { small: 4, medium: 16, large: 28, mythic: 52 };

interface Shape { l: number; h: number; w: number; leg: number }

interface SpawnCfg { x: number; z: number; y: number; n: number; r: number; speed: number; host: 'city' | 'sky' | 'under'; scale?: number }

interface SpeciesDef {
  id: string; key: string; name: string; group: GroupId;
  feat: Feature[]; color: number; accent: number;
  shape?: Partial<Shape>; fly?: boolean; water?: boolean; legs?: number; stationary?: boolean;
  spawn?: SpawnCfg; aId?: number[];
  /** W12：八兽走自建放样（beastGeo），不再用 body/head/leg 池拼 */
  form?: BeastForm;
}

/** 兽池台账：探针 / 控制台共用（`window.__beastPool` 的只读视图） */
export interface BeastPoolReport {
  /** 尝试入场的兽体总数（含 form 型与 body 型） */
  requested: number;
  /** 真正进场（beasts.push 成功）的数量 */
  accepted: number;
  /** 因槽位不足被跳过的数量；行为仍是跳过，不抛异常 */
  dropped: number;
  /** 被丢掉的 species id，按发生顺序、保留重复（同一物种多只） */
  droppedIds: string[];
  droppedBySpecies: Record<string, number>;
  droppedByPool: Record<string, number>;
  /** 各池高水位 / 上限，用于判断还剩多少名额 */
  pools: Record<string, { used: number; max: number }>;
}

// 37 类照 world-atoms.json 的 37 行逐条登记：小型 4 / 中型 12 / 大型 9 / 神话巨型 12
// 名录与案牍行（C-CRT-01 / D-CRT-001 / D-CRT-017 / T-CRT-001）无独立躯体，只做组别登记
const SPECIES: SpeciesDef[] = [
  // ---- 小型 4 ----
  { id: 'C-CRT-05', key: 'yuqun', name: '鱼群', group: 'small', water: true, feat: ['fin', 'tail'], color: 0x6f8792, accent: 0xb8ccd2, shape: { h: 0.8 }, spawn: { x: 0, z: 16, y: 1.02, n: 6, r: 7, speed: 1.1, host: 'city' } },
  { id: 'D-CRT-010', key: 'youhun', name: '鬼城游魂', group: 'small', feat: ['eye', 'tail'], color: 0x5e6a78, accent: 0x9ad8e8, spawn: { x: 0, z: 0, y: UNDER.y, n: 6, r: 30, speed: 0.5, host: 'under' } },
  { id: 'D-CRT-013', key: 'yuangui', name: '怨鬼', group: 'small', feat: ['eye', 'horn'], color: 0x4a3f44, accent: 0xd0503a, spawn: { x: 0, z: 20, y: UNDER.y, n: 4, r: 22, speed: 0.7, host: 'under' } },
  { id: 'D-CRT-014', key: 'guihuo', name: '鬼火精灵', group: 'small', feat: ['eye'], color: 0x2a3a3a, accent: 0x7cffa0, spawn: { x: -40, z: -132, y: UNDER.y + 1.1, n: 8, r: 20, speed: 0.9, host: 'under' } },
  // ---- 中型 12 ----
  { id: 'C-CRT-01', key: 'qunluo', name: '生物群落全录', group: 'medium', feat: [], color: 0x707070, accent: 0x909090 },
  { id: 'C-CRT-04', key: 'yandui', name: '雁阵', group: 'medium', fly: true, feat: ['wing'], color: 0x4a4a52, accent: 0xd8d8e0, shape: { l: 1.1, h: 0.75 }, spawn: { x: 300, z: -500, y: 72, n: 6, r: 120, speed: 4.2, host: 'city', scale: 1.15 } },
  { id: 'C-CRT-06', key: 'langqun', name: '狼群', group: 'medium', feat: ['mane', 'tail'], color: 0x5a5850, accent: 0x8a8880, spawn: { x: -2400, z: -1500, y: 0, n: 3, r: 26, speed: 1.6, host: 'city' } },
  { id: 'C-CRT-07', key: 'ying', name: '鹰', group: 'medium', fly: true, feat: ['wing', 'ear'], color: 0x4a3c34, accent: 0xc8a870, spawn: { x: -200, z: 300, y: 96, n: 2, r: 60, speed: 5.2, host: 'city' } },
  { id: 'C-CRT-08', key: 'lu', name: '鹿', group: 'medium', feat: ['antler', 'tail'], color: 0x8a6a44, accent: 0xd8c090, spawn: { x: -1800, z: -900, y: 0, n: 2, r: 18, speed: 1.2, host: 'city' } },
  { id: 'D-CRT-001', key: 'shengwu', name: '生物', group: 'medium', feat: [], color: 0x707070, accent: 0x909090 },
  { id: 'D-CRT-011', key: 'shuigui', name: '水鬼', group: 'medium', legs: 6, feat: ['eye', 'tail'], color: 0x3a4a44, accent: 0x60ffb0, shape: { l: 0.8, h: 0.7 }, spawn: { x: 0, z: -70, y: UNDER.y + 0.15, n: 3, r: 14, speed: 0.6, host: 'under' } },
  { id: 'D-CRT-012', key: 'diaosi', name: '吊死鬼', group: 'medium', feat: ['tail'], color: 0x4a4048, accent: 0x8a7a90, shape: { l: 0.7 }, spawn: { x: 60, z: -40, y: UNDER.y, n: 2, r: 5, speed: 0.35, host: 'under' } },
  { id: 'D-CRT-015', key: 'zhiren', name: '纸人阵列', group: 'medium', feat: [], color: 0xd8d4c8, accent: 0xb84a3a, shape: { l: 0.6, h: 0.9 }, spawn: { x: 540, z: 85, y: UNDER.y, n: 6, r: 26, speed: 0.4, host: 'under' } },
  { id: 'D-CRT-016', key: 'guquan', name: '骨犬', group: 'medium', feat: ['ear', 'tail'], color: 0xd8d4c8, accent: 0x8cff6a, shape: { l: 0.85, h: 0.7 } },
  { id: 'T-CRT-007', key: 'jinli', name: '金鲤跃龙门', group: 'medium', water: true, feat: ['fin', 'tail'], color: 0xd8a23a, accent: 0xffe08a, shape: { l: 1.0, h: 0.65 }, spawn: { x: 120, z: 14, y: 1.02, n: 3, r: 9, speed: 1.4, host: 'city' } },
  { id: 'T-CRT-008', key: 'linghou', name: '灵猴', group: 'medium', feat: ['tail'], color: 0x6a4e2e, accent: 0x8a6a42, shape: { l: 0.7, h: 0.9 } },
  // ---- 大型 9 ----
  { id: 'C-CRT-02', key: 'tuodui', name: '丝路驼队', group: 'large', feat: ['mane', 'tail'], color: 0x9a7a4a, accent: 0x6a5028, shape: { l: 1.1 }, spawn: { x: -1500, z: 600, y: 0, n: 3, r: 34, speed: 0.9, host: 'city' } },
  { id: 'C-CRT-03', key: 'maqun', name: '草原马群', group: 'large', feat: ['mane', 'tail'], color: 0x6a4a34, accent: 0x2a1e16, shape: { l: 1.15, h: 1.05 }, spawn: { x: 1800, z: 900, y: 0, n: 3, r: 42, speed: 2.6, host: 'city' } },
  { id: 'D-CRT-002', key: 'xiezhi', name: '守关籍案', group: 'large', stationary: true, feat: ['horn', 'mane'], color: 0x3a3a42, accent: 0x8a8a96, shape: { l: 0.8, h: 0.85 }, spawn: { x: 0, z: -126, y: UNDER.y, n: 2, r: 5, speed: 0, host: 'under' } },
  { id: 'D-CRT-008', key: 'xiezhi2', name: '判官案', group: 'large', stationary: true, feat: ['horn', 'mane'], color: 0x3a3a42, accent: 0x9a7a3a, shape: { l: 0.8, h: 0.85 }, spawn: { x: 0, z: 46, y: UNDER.y, n: 1, r: 4, speed: 0, host: 'under' } },
  { id: 'D-CRT-017', key: 'guiwu', name: '鬼物总目', group: 'large', feat: [], color: 0x707070, accent: 0x909090 },
  { id: 'T-CRT-006', key: 'xianlu', name: '仙鹿', group: 'large', feat: ['antler', 'tail'], color: 0xe8e4d8, accent: 0x9ad8ff, shape: { h: 0.9 }, spawn: { x: -166, z: 60, y: 201.1, n: 2, r: 12, speed: 1.0, host: 'sky' } },
  { id: 'T-CRT-009', key: 'shishi', name: '石狮', group: 'large', stationary: true, feat: ['mane', 'tail'], color: 0x8a8478, accent: 0x6a6458, shape: { l: 0.85 }, spawn: { x: 536, z: 212, y: 0, n: 2, r: 4, speed: 0, host: 'city' } },
  { id: 'T-CRT-010', key: 'pixiu', name: '貔貅门墩', group: 'large', stationary: true, feat: ['horn', 'mane'], color: 0x7a6a3a, accent: 0xd8b45a, shape: { l: 0.85 }, spawn: { x: 520, z: 216, y: 0, n: 2, r: 4, speed: 0, host: 'city' } },
  { id: 'T-CRT-012', key: 'xiaotianquan', name: '哮天犬', group: 'large', feat: ['ear', 'mane', 'tail'], color: 0x3a3038, accent: 0xd8b45a, shape: { l: 0.7, h: 0.6 }, spawn: { x: 20, z: 20, y: 206.12, n: 1, r: 10, speed: 1.8, host: 'sky' } },
  // ---- 神话巨型 12 ----
  { id: 'D-CRT-003', key: 'niutou', name: '牛头', group: 'mythic', feat: ['horn'], color: 0x8a4a2a, accent: 0x3a2a20 },
  { id: 'D-CRT-004', key: 'mamian', name: '马面', group: 'mythic', feat: ['ear'], color: 0x6a4a8a, accent: 0x2a2030 },
  { id: 'D-CRT-005', key: 'wuchangb', name: '黑无常', group: 'mythic', feat: [], color: 0x1a2028, accent: 0x6a7a8a },
  { id: 'D-CRT-006', key: 'wuchangw', name: '白无常', group: 'mythic', feat: [], color: 0xe8f0e8, accent: 0xa8b8a8 },
  { id: 'D-CRT-007', key: 'mengpo', name: '孟婆位', group: 'mythic', feat: [], color: 0x6a6a6a, accent: 0x9a9a9a },
  { id: 'D-CRT-009', key: 'yanluo', name: '阎罗王', group: 'mythic', feat: [], color: 0x3a3a4a, accent: 0xd8b45a },
  { id: 'T-CRT-001', key: 'tianzhi', name: '天书索引', group: 'mythic', feat: [], color: 0x707070, accent: 0x909090 },
  { id: 'T-CRT-002', key: 'yutu', name: '玉兔', group: 'mythic', feat: ['ear'], color: 0xe8e8e0, accent: 0xd8a0a8, shape: { l: 0.26, h: 0.3, w: 0.3 }, spawn: { x: 40, z: -55, y: 209.1, n: 1, r: 5, speed: 0.6, host: 'sky', scale: 0.6 } },
  { id: 'T-CRT-003', key: 'qilin', name: '麒麟', group: 'mythic', feat: ['horn', 'spine', 'mane', 'tail'], color: 0xd8b45a, accent: 0x7cffd0, shape: { l: 1.05 }, spawn: { x: 0, z: 0, y: 206.12, n: 1, r: 16, speed: 1.4, host: 'sky' }, form: 'qilin' },
  { id: 'T-CRT-004', key: 'tianlong', name: '天龙', group: 'mythic', fly: true, feat: ['horn', 'spine', 'wing', 'tail'], color: 0x2a5a6a, accent: 0x60e8ff, shape: { l: 1.35, h: 0.7 }, spawn: { x: 0, z: 0, y: 268, n: 1, r: 90, speed: 5.5, host: 'sky' }, form: 'long' },
  { id: 'T-CRT-005', key: 'fenghuang', name: '凤凰', group: 'mythic', fly: true, feat: ['wing', 'tail'], color: 0xc8402a, accent: 0xffc85a, shape: { l: 1.0, h: 0.8 }, spawn: { x: 120, z: 110, y: 258, n: 1, r: 70, speed: 5.0, host: 'sky' }, form: 'feng' },
  { id: 'T-CRT-011', key: 'qingniu', name: '青牛', group: 'mythic', feat: ['horn', 'tail'], color: 0x3a4a44, accent: 0x9ad8c0, shape: { l: 1.0, h: 0.8 }, spawn: { x: -120, z: -26, y: 208.05, n: 1, r: 12, speed: 0.7, host: 'sky' } },
  // ---- W12 新增五型（补足八兽；id 沿用 43/10 卷续号，不动既有 37 行）----
  { id: 'T-CRT-013', key: 'kunpeng', name: '鲲鹏', group: 'mythic', fly: true, feat: ['fin', 'tail'], color: 0x35607a, accent: 0x9fd8e8, shape: { l: 1.5 }, spawn: { x: 300, z: -420, y: 262, n: 1, r: 64, speed: 3.2, host: 'sky', scale: 1.25 }, form: 'kun' },
  { id: 'D-CRT-018', key: 'yaksha', name: '夜叉', group: 'mythic', feat: ['horn', 'eye'], color: 0x2e5348, accent: 0xff5a34, shape: { h: 1.05 }, spawn: { x: 0, z: 6, y: UNDER.y, n: 2, r: 17, speed: 0.45, host: 'under' }, form: 'yaksha' },
  { id: 'D-CRT-019', key: 'luocha', name: '罗刹', group: 'mythic', feat: ['eye'], color: 0x3a2432, accent: 0xc86a9a, shape: { h: 1.1 }, spawn: { x: 0, z: 6, y: UNDER.y, n: 2, r: 23, speed: 0.55, host: 'under' }, form: 'luocha' },
  { id: 'T-CRT-014', key: 'baize', name: '白泽', group: 'mythic', feat: ['horn', 'mane', 'eye'], color: 0xe2ded0, accent: 0x7ec8ff, shape: { l: 1.0 }, spawn: { x: -24, z: -22, y: 206.12, n: 1, r: 6, speed: 0.6, host: 'sky' }, form: 'baize' },
  { id: 'T-CRT-015', key: 'xianhe', name: '仙鹤', group: 'medium', fly: true, feat: ['wing'], color: 0xe8e4dc, accent: 0xc83a30, shape: { l: 0.9 }, spawn: { x: 40, z: 60, y: 42, n: 3, r: 120, speed: 3.4, host: 'city', scale: 0.7 }, form: 'crane' },
];

/** 兽体实例池：与 actors/pools 同语义，但不 import pools.ts —— 它模块级用 canvas，无 DOM 用例会被拖崩。
 *  神像（deities.ts）复用同一个类，避免第三套实例池实现。 */
export class BeastPool {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private dirty = true;
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly max: number, name: string) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, c); }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  get count(): number { return this.mesh.count; }
  alloc(n: number): number {
    const base = this.cursor;
    this.cursor += n;
    if (this.cursor > this.max) throw new Error(`兽体池 ${this.mesh.name} 槽位不足：need ${this.cursor} > ${this.max}`);
    if (base + n > this.mesh.count) {
      for (let i = this.mesh.count; i < base + n; i++) this.mesh.setMatrixAt(i, this.zero);
      this.mesh.count = base + n;
      this.dirty = true;
    }
    return base;
  }
  set(i: number, m: THREE.Matrix4, color?: THREE.Color): void {
    this.mesh.setMatrixAt(i, m);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(i, color);
    this.dirty = true;
  }
  flush(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }
}

const BEAST_POOLS: Record<string, { geo: THREE.BufferGeometry; max: number; glow?: boolean }> = {
  body: { geo: new THREE.BoxGeometry(1, 1, 1), max: 168 },
  head: { geo: new THREE.BoxGeometry(1, 1, 1), max: 168 },
  leg: { geo: new THREE.CylinderGeometry(0.5, 0.38, 1, 5).translate(0, -0.5, 0), max: 560 },
  tail: { geo: new THREE.ConeGeometry(0.5, 1, 5).rotateX(Math.PI / 2).translate(0, 0, -0.5), max: 120 },
  horn: { geo: new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0), max: 320 },
  wing: { geo: new THREE.BoxGeometry(1, 0.06, 1).translate(0.5, 0, 0), max: 96 },
  mane: {
    geo: mergeGeometries(Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2;
      return new THREE.ConeGeometry(0.18, 0.9, 4).rotateZ(Math.PI / 2).translate(0.55, 0, 0).rotateY(a);
    }))!, max: 72,
  },
  spine: {
    geo: mergeGeometries(Array.from({ length: 5 }, (_, i) =>
      new THREE.ConeGeometry(0.16, 0.8, 4).translate(0, 0.4, -0.4 + i * 0.2)))!, max: 72,
  },
  eye: { geo: new THREE.SphereGeometry(0.5, 8, 6), max: 160, glow: true },
};

// ============ W12 造物几何内核（神像 deities.ts 复用同一份） ============
// 顶点色 + 逐面法线，口径同 vehicles.ts 的 GeoBuf（Color.setHex 做 sRGB→线性）；
// 供「静态、量大、要一眼可辨」的神像/神兽使用；材质复用 VEH_MAT，不新增材质。
export type P3 = [number, number, number];
const TAU = Math.PI * 2;
const _vcol = new THREE.Color();
const _vq = new THREE.Quaternion(), _ve = new THREE.Euler(), _vm = new THREE.Matrix4(), _vs = new THREE.Vector3(1, 1, 1);

/** 明暗乘子（sRGB 往返，与 bake.shade 同效） */
export function sh2(hex: number, k: number): number {
  _vcol.setHex(hex);
  _vcol.r = Math.min(1, _vcol.r * k); _vcol.g = Math.min(1, _vcol.g * k); _vcol.b = Math.min(1, _vcol.b * k);
  return _vcol.getHex();
}

export class VGeo {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  get tris(): number { return this.p.length / 9; }

  private put(a: P3, b: P3, c: P3, nx: number, ny: number, nz: number, hex: number, k: number): void {
    _vcol.setHex(hex);
    const r = _vcol.r * k, g = _vcol.g * k, bl = _vcol.b * k;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.c.push(r, g, bl, r, g, bl, r, g, bl);
  }

  /** 单面三角：inside 为实体内一点，法线自动朝外（凸体/管体免手工绕序） */
  triO(a: P3, b: P3, c: P3, hex: number, k: number, ix: number, iy: number, iz: number): void {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const gx = (a[0] + b[0] + c[0]) / 3 - ix;
    const gy = (a[1] + b[1] + c[1]) / 3 - iy;
    const gz = (a[2] + b[2] + c[2]) / 3 - iz;
    if (nx * gx + ny * gy + nz * gz < 0) {
      const tx = b[0], ty = b[1], tz = b[2];
      b = c; c = [tx, ty, tz];
      nx = -nx; ny = -ny; nz = -nz;
    }
    this.put(a, b, c, nx, ny, nz, hex, k);
  }

  /** 单面三角：法线取绕序（供布片/羽片等非凸面片） */
  triRaw(a: P3, b: P3, c: P3, hex: number, k = 1): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    this.put(a, b, c, nx / l, ny / l, nz / l, hex, k);
  }

  quad(a: P3, b: P3, c: P3, d: P3, hex: number, k: number, ix: number, iy: number, iz: number): void {
    this.triO(a, b, c, hex, k, ix, iy, iz);
    this.triO(a, c, d, hex, k, ix, iy, iz);
  }

  /** 双面四边：布幡、羽片、鳍膜、薄片 */
  quadBoth(a: P3, b: P3, c: P3, d: P3, hex: number, k = 1): void {
    this.triRaw(a, b, c, hex, k); this.triRaw(a, c, d, hex, k);
    this.triRaw(a, d, c, hex, k); this.triRaw(a, c, b, hex, k);
  }

  xf(pts: P3[], x: number, y: number, z: number, ry: number, rx: number, rz: number): P3[] {
    _ve.set(rx, ry, rz);
    _vq.setFromEuler(_ve);
    _vm.compose(new THREE.Vector3(x, y, z), _vq, _vs);
    return pts.map((q) => {
      const v = new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(_vm);
      return [v.x, v.y, v.z] as P3;
    });
  }

  /** 长方体：六面独立明暗（+y 提亮 / −y 压暗，与 bake 的接地感一致） */
  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, k = 1): void {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const v = this.xf([[-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd], [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]], x, y, z, ry, rx, rz);
    const c0 = this.xf([[0, 0, 0]], x, y, z, ry, rx, rz)[0];
    const ix = c0[0], iy = c0[1], iz = c0[2];
    this.quad(v[0], v[1], v[2], v[3], hex, k, ix, iy, iz);
    this.quad(v[5], v[4], v[7], v[6], sh2(hex, 0.92), k, ix, iy, iz);
    this.quad(v[4], v[0], v[3], v[7], hex, k, ix, iy, iz);
    this.quad(v[1], v[5], v[6], v[2], sh2(hex, 1.03), k, ix, iy, iz);
    this.quad(v[3], v[2], v[6], v[7], sh2(hex, 1.1), k, ix, iy, iz);
    this.quad(v[0], v[4], v[5], v[1], sh2(hex, 0.78), k, ix, iy, iz);
  }

  /** 四棱台：上小下大（躯干收分、须弥座束腰、冕板） */
  frus(bw: number, bd: number, tw: number, td: number, h: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, k = 1): void {
    const hh = h / 2;
    const b: P3[] = [[-bw / 2, -hh, -bd / 2], [bw / 2, -hh, -bd / 2], [bw / 2, -hh, bd / 2], [-bw / 2, -hh, bd / 2]];
    const t: P3[] = [[-tw / 2, hh, -td / 2], [tw / 2, hh, -td / 2], [tw / 2, hh, td / 2], [-tw / 2, hh, td / 2]];
    const bv = this.xf(b, x, y, z, ry, rx, rz);
    const tv = this.xf(t, x, y, z, ry, rx, rz);
    const c0 = this.xf([[0, 0, 0]], x, y, z, ry, rx, rz)[0];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(bv[i], bv[j], tv[j], tv[i], i % 2 ? hex : sh2(hex, 0.95), k, c0[0], c0[1], c0[2]);
    }
    this.quad(tv[0], tv[1], tv[2], tv[3], sh2(hex, 1.1), k, c0[0], c0[1], c0[2]);
    this.quad(bv[3], bv[2], bv[1], bv[0], sh2(hex, 0.8), k, c0[0], c0[1], c0[2]);
  }

  /** 圆台：轴 +y，中心 (x,y,z) */
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, k = 1, caps = true): void {
    const hh = h / 2;
    const ring = (r: number, yy: number): P3[] => {
      const out: P3[] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU;
        out.push([Math.cos(a) * r, yy, Math.sin(a) * r]);
      }
      return out;
    };
    const bt = this.xf(ring(rb, -hh), x, y, z, ry, rx, rz);
    const tp = this.xf(ring(rt, hh), x, y, z, ry, rx, rz);
    const c0 = this.xf([[0, 0, 0]], x, y, z, ry, rx, rz)[0];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.quad(bt[i], bt[j], tp[j], tp[i], i % 2 ? hex : sh2(hex, 0.94), k, c0[0], c0[1], c0[2]);
    }
    if (caps) {
      const cb = this.xf([[0, -hh, 0]], x, y, z, ry, rx, rz)[0];
      const ct = this.xf([[0, hh, 0]], x, y, z, ry, rx, rz)[0];
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.triO(cb, bt[j], bt[i], sh2(hex, 0.8), k, c0[0], c0[1], c0[2]);
        this.triO(ct, tp[i], tp[j], sh2(hex, 1.06), k, c0[0], c0[1], c0[2]);
      }
    }
  }

  /** 圆锥：轴 +y */
  cone(r: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, k = 1): void {
    const hh = h / 2;
    const out: P3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      out.push([Math.cos(a) * r, -hh, Math.sin(a) * r]);
    }
    const ring = this.xf(out, x, y, z, ry, rx, rz);
    const apex = this.xf([[0, hh, 0]], x, y, z, ry, rx, rz)[0];
    const base = this.xf([[0, -hh, 0]], x, y, z, ry, rx, rz)[0];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.triO(ring[i], ring[j], apex, hex, k, base[0], base[1], base[2]);
      this.triO(base, ring[j], ring[i], sh2(hex, 0.8), k, apex[0], apex[1], apex[2]);
    }
  }

  /** 变径管：沿 spine 走，rw/rh 为每点的横向/纵向半径（龙身、颈、尾、四肢） */
  tube(spine: P3[], rw: number[], rh: number[], seg: number, hex: number, k = 1, capA = true, capB = true): void {
    const n = spine.length;
    if (n < 2) return;
    const frames = spine.map((p, i) => {
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(ty) > 0.94) { ux = 1; uy = 0; }
      let rx = uy * tz - uz * ty, ry = uz * tx - ux * tz, rz = ux * ty - uy * tx;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      return { p, r: [rx, ry, rz] as P3, u: [ty * rz - tz * ry, tz * rx - tx * rz, tx * ry - ty * rx] as P3 };
    });
    const rings: P3[][] = frames.map((f, i) => {
      const out: P3[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * TAU;
        const ca = Math.cos(a) * rw[i], sa = Math.sin(a) * rh[i];
        out.push([f.p[0] + f.r[0] * ca + f.u[0] * sa, f.p[1] + f.r[1] * ca + f.u[1] * sa, f.p[2] + f.r[2] * ca + f.u[2] * sa]);
      }
      return out;
    });
    for (let i = 0; i < n - 1; i++) {
      const cx = (spine[i][0] + spine[i + 1][0]) / 2, cy = (spine[i][1] + spine[i + 1][1]) / 2, cz = (spine[i][2] + spine[i + 1][2]) / 2;
      for (let j = 0; j < seg; j++) {
        const jj = (j + 1) % seg;
        this.quad(rings[i][j], rings[i][jj], rings[i + 1][jj], rings[i + 1][j], j % 2 ? hex : sh2(hex, 0.96), k, cx, cy, cz);
      }
    }
    if (capA) {
      const c = spine[0];
      for (let j = 0; j < seg; j++) this.triO(c, rings[0][j], rings[0][(j + 1) % seg], sh2(hex, 0.86), k, spine[1][0], spine[1][1], spine[1][2]);
    }
    if (capB) {
      const c = spine[n - 1];
      for (let j = 0; j < seg; j++) this.triO(c, rings[n - 1][j], rings[n - 1][(j + 1) % seg], sh2(hex, 1.05), k, spine[n - 2][0], spine[n - 2][1], spine[n - 2][2]);
    }
  }

  /** 两点之间的方梁（簪、杠、爪、指节） */
  beam(a: P3, b: P3, w: number, h: number, hex: number, k = 1): void {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return;
    dx /= l; dy /= l; dz /= l;
    const up: P3 = Math.abs(dy) > 0.92 ? [1, 0, 0] : [0, 1, 0];
    let sx = up[1] * dz - up[2] * dy, sy = up[2] * dx - up[0] * dz, sz = up[0] * dy - up[1] * dx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = dy * sz - dz * sy, ty = dz * sx - dx * sz, tz = dx * sy - dy * sx;
    const hw = w / 2, hh = h / 2;
    const corner = (c: P3, i: number): P3 => {
      const u = i === 0 || i === 3 ? 1 : -1, v = i < 2 ? 1 : -1;
      return [c[0] + sx * hw * u + tx * hh * v, c[1] + sy * hw * u + ty * hh * v, c[2] + sz * hw * u + tz * hh * v];
    };
    const A = [0, 1, 2, 3].map((i) => corner(a, i));
    const B = [0, 1, 2, 3].map((i) => corner(b, i));
    const mid: P3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(A[i], A[j], B[j], B[i], i % 2 ? hex : sh2(hex, 0.94), k, mid[0], mid[1], mid[2]);
    }
    this.quad(A[0], A[3], A[2], A[1], sh2(hex, 0.85), k, mid[0], mid[1], mid[2]);
    this.quad(B[0], B[1], B[2], B[3], sh2(hex, 1.08), k, mid[0], mid[1], mid[2]);
  }

  /** 羽片/鳍条：根→梢三段渐窄的薄片（双面），bend 为中部横向弯量 */
  feather(root: P3, tip: P3, w0: number, w1: number, bend: number, hex: number, k = 1): void {
    let dx = tip[0] - root[0], dy = tip[1] - root[1], dz = tip[2] - root[2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return;
    dx /= l; dy /= l; dz /= l;
    const up: P3 = Math.abs(dy) > 0.92 ? [1, 0, 0] : [0, 1, 0];
    let sx = up[1] * dz - up[2] * dy, sy = up[2] * dx - up[0] * dz, sz = up[0] * dy - up[1] * dx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const at = (t: number): P3 => {
      const b = Math.sin(t * Math.PI) * bend;
      return [root[0] + dx * l * t + sx * b, root[1] + dy * l * t + sy * b, root[2] + dz * l * t + sz * b];
    };
    const prev: P3[] = [];
    const cur: P3[] = [];
    let pw = w0 / 2, cw = w0 / 2;
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const p = at(t);
      cw = (w0 + (w1 - w0) * t) / 2;
      cur.length = 0;
      cur.push([p[0] - sx * cw, p[1] - sy * cw, p[2] - sz * cw], [p[0] + sx * cw, p[1] + sy * cw, p[2] + sz * cw]);
      if (i > 0) this.quadBoth(prev[0], prev[1], cur[1], cur[0], hex, k);
      prev.length = 0; prev.push(cur[0], cur[1]);
      pw = cw;
    }
    void pw;
  }

  /** 扇面（鳍、尾扇、蹼）：apex 向 rim 各点连成三角，双面 */
  fan(apex: P3, rim: P3[], hex: number, k = 1): void {
    for (let i = 0; i < rim.length - 1; i++) this.quadBoth(apex, rim[i], rim[i + 1], rim[i + 1], hex, k);
  }

  merge(o: VGeo): void {
    for (const a of [o.p]) for (let i = 0; i < a.length; i++) this.p.push(a[i]);
    for (const a of [o.n]) for (let i = 0; i < a.length; i++) this.n.push(a[i]);
    for (const a of [o.c]) for (let i = 0; i < a.length; i++) this.c.push(a[i]);
  }

  /** 就地变换（坐骑缩放/翻向；神像落位） */
  bake(m: THREE.Matrix4): void {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    for (let i = 0; i < this.p.length; i += 3) {
      v.set(this.p[i], this.p[i + 1], this.p[i + 2]).applyMatrix4(m);
      this.p[i] = v.x; this.p[i + 1] = v.y; this.p[i + 2] = v.z;
    }
    for (let i = 0; i < this.n.length; i += 3) {
      nv.set(this.n[i], this.n[i + 1], this.n[i + 2]).applyMatrix3(nm).normalize();
      this.n[i] = nv.x; this.n[i + 1] = nv.y; this.n[i + 2] = nv.z;
    }
  }

  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ============ W12 神兽分型：躯干放样 + 腿/翼/尾/头 参数化 ============
// 兽体 = 一张参数表（截面/腿/颈/头/角/鬃/尾/翼/鳍/眼）+ 一段 ≤15 行的「签名」函数。
// 9 型共用同一套骨架代码：龙/麒麟/凤凰/鲲/夜叉/罗刹/白泽/仙鹤 + 虎（只给神像虎座用）。
export type BeastForm = 'long' | 'qilin' | 'feng' | 'kun' | 'yaksha' | 'luocha' | 'baize' | 'crane' | 'tiger';

interface Sec { z: number; y: number; w: number; h: number }
interface LegSpec { n: 2 | 4; x: number; z: number; len: number; r: number; kind: 'hoof' | 'paw' | 'claw' | 'crane' }
interface ArmSpec { at: P3; len: number; r: number; claws: number; drop: number; span: number }
interface NeckSpec { at: P3; tip: P3; r0: number; r1: number }
interface HeadSpec { at: P3; w: number; h: number; l: number; snout: number; kind: 'dragon' | 'deer' | 'bird' | 'whale' | 'human' | 'lion' }
interface HornSpec { kind: 'antler' | 'single' | 'pair' | 'curved'; len: number; r: number; at: P3 }
interface TailSpec { kind: 'serpent' | 'fan' | 'bush' | 'strand' | 'whale'; len: number; r: number; n: number }
interface WingSpec { span: number; chord: number; up: number; kind: 'feather' | 'fin' }
interface FinSpec { dorsal: number; pectoral: number; caudal: number; level: boolean }
interface BeastFormSpec {
  hex: number; accent: number;
  spine: Sec[];
  legs?: LegSpec;
  arms?: ArmSpec;
  neck?: NeckSpec;
  head?: HeadSpec;
  horns?: HornSpec;
  mane?: { n: number; len: number; r: number; z0: number; z1: number };
  tail?: TailSpec;
  wing?: WingSpec;
  fin?: FinSpec;
  flame?: { n: number; len: number; z0: number; z1: number };
  eyes: P3[];
  eyeR: number;
}

const BEAST_FORM: Record<BeastForm, BeastFormSpec> = {
  // 龙：长蛇身（分段弯曲）+ 四足 + 鹿角 + 鬃 + 须 + 鳞环 + 尾鳍
  long: {
    hex: 0x2f6a62, accent: 0x8ee8c8,
    spine: [
      { z: -2.7, y: 0.62, w: 0.10, h: 0.10 }, { z: -2.1, y: 0.46, w: 0.20, h: 0.19 },
      { z: -1.4, y: 0.34, w: 0.30, h: 0.28 }, { z: -0.7, y: 0.36, w: 0.38, h: 0.34 },
      { z: 0.0, y: 0.48, w: 0.42, h: 0.38 }, { z: 0.7, y: 0.62, w: 0.40, h: 0.36 },
      { z: 1.4, y: 0.78, w: 0.34, h: 0.30 }, { z: 2.0, y: 0.92, w: 0.26, h: 0.24 },
      { z: 2.5, y: 1.02, w: 0.18, h: 0.17 },
    ],
    legs: { n: 4, x: 0.36, z: 1.05, len: 0.82, r: 0.085, kind: 'claw' },
    neck: { at: [0, 1.06, 2.45], tip: [0, 1.5, 3.0], r0: 0.19, r1: 0.15 },
    head: { at: [0, 1.56, 3.14], w: 0.42, h: 0.34, l: 0.8, snout: 0.34, kind: 'dragon' },
    horns: { kind: 'antler', len: 0.62, r: 0.045, at: [0, 1.74, 3.02] },
    mane: { n: 11, len: 0.42, r: 0.07, z0: -1.9, z1: 2.2 },
    tail: { kind: 'fan', len: 0.72, r: 0.09, n: 7 },
    eyes: [[-0.16, 1.62, 3.34], [0.16, 1.62, 3.34]], eyeR: 0.055,
  },
  // 麒麟：鹿身 + 牛尾 + 马蹄 + 独角 + 鳞甲 + 火焰披毛
  qilin: {
    hex: 0xd8a83a, accent: 0x7cffd0,
    spine: [
      { z: -1.55, y: 1.16, w: 0.24, h: 0.26 }, { z: -1.0, y: 1.14, w: 0.32, h: 0.34 },
      { z: -0.3, y: 1.13, w: 0.36, h: 0.40 }, { z: 0.4, y: 1.15, w: 0.34, h: 0.40 },
      { z: 0.95, y: 1.2, w: 0.28, h: 0.34 }, { z: 1.35, y: 1.3, w: 0.2, h: 0.24 },
    ],
    legs: { n: 4, x: 0.24, z: 0.92, len: 1.12, r: 0.075, kind: 'hoof' },
    neck: { at: [0, 1.36, 1.3], tip: [0, 1.86, 1.62], r0: 0.2, r1: 0.15 },
    head: { at: [0, 1.94, 1.74], w: 0.3, h: 0.28, l: 0.62, snout: 0.24, kind: 'deer' },
    horns: { kind: 'single', len: 0.5, r: 0.05, at: [0, 2.1, 1.9] },
    tail: { kind: 'bush', len: 0.85, r: 0.07, n: 7 },
    flame: { n: 15, len: 0.42, z0: -1.2, z1: 1.2 },
    eyes: [[-0.12, 1.98, 1.98], [0.12, 1.98, 1.98]], eyeR: 0.045,
  },
  // 凤凰：长尾羽 3 束 + 冠羽 + 宽翼两段（肱羽 + 飞羽）
  feng: {
    hex: 0xc8402a, accent: 0xffc85a,
    spine: [
      { z: -1.05, y: 1.0, w: 0.09, h: 0.1 }, { z: -0.6, y: 1.0, w: 0.17, h: 0.19 },
      { z: -0.1, y: 1.02, w: 0.22, h: 0.24 }, { z: 0.45, y: 1.06, w: 0.2, h: 0.22 },
      { z: 0.8, y: 1.12, w: 0.13, h: 0.14 },
    ],
    legs: { n: 2, x: 0.12, z: 0.3, len: 0.86, r: 0.038, kind: 'crane' },
    neck: { at: [0, 1.2, 0.8], tip: [0, 1.62, 1.02], r0: 0.12, r1: 0.08 },
    head: { at: [0, 1.68, 1.1], w: 0.2, h: 0.18, l: 0.34, snout: 0.16, kind: 'bird' },
    wing: { span: 1.42, chord: 0.52, up: 1.22, kind: 'feather' },
    tail: { kind: 'strand', len: 1.85, r: 0.05, n: 3 },
    eyes: [[-0.1, 1.7, 1.2], [0.1, 1.7, 1.2]], eyeR: 0.035,
  },
  // 鲲/鲸：纺锤体 + 背鳍 + 水平尾鳍 + 喷气孔
  kun: {
    hex: 0x35607a, accent: 0x9fd8e8,
    spine: [
      { z: -2.2, y: 0.0, w: 0.07, h: 0.09 }, { z: -1.5, y: 0.0, w: 0.2, h: 0.22 },
      { z: -0.7, y: 0.0, w: 0.44, h: 0.46 }, { z: 0.1, y: 0.0, w: 0.52, h: 0.54 },
      { z: 0.9, y: 0.0, w: 0.42, h: 0.44 }, { z: 1.6, y: 0.0, w: 0.24, h: 0.26 },
      { z: 2.0, y: 0.0, w: 0.12, h: 0.13 },
    ],
    fin: { dorsal: 0.42, pectoral: 0.6, caudal: 0.86, level: true },
    eyes: [[-0.44, -0.06, 1.5], [0.44, -0.06, 1.5]], eyeR: 0.07,
  },
  // 夜叉：短躯干 + 长臂 + 獠牙 + 角 + 三指
  yaksha: {
    hex: 0x2e5348, accent: 0xd84a2a,
    spine: [
      { z: 0.0, y: 0.86, w: 0.3, h: 0.3 }, { z: 0.0, y: 1.06, w: 0.36, h: 0.32 },
      { z: 0.0, y: 1.3, w: 0.32, h: 0.3 }, { z: 0.0, y: 1.46, w: 0.2, h: 0.2 },
    ],
    legs: { n: 2, x: 0.16, z: 0, len: 0.86, r: 0.09, kind: 'claw' },
    arms: { at: [0, 1.38, 0.02], len: 1.04, r: 0.085, claws: 3, drop: 0.5, span: 0.46 },
    head: { at: [0, 1.62, 0.04], w: 0.3, h: 0.3, l: 0.3, snout: 0.1, kind: 'lion' },
    horns: { kind: 'pair', len: 0.34, r: 0.045, at: [0, 1.76, 0.02] },
    eyes: [[-0.1, 1.66, 0.2], [0.1, 1.66, 0.2]], eyeR: 0.042,
  },
  // 罗刹：高瘦 + 长发 + 长爪 + 破衣
  luocha: {
    hex: 0x3a2432, accent: 0xc86a9a,
    spine: [
      { z: 0.0, y: 1.0, w: 0.2, h: 0.2 }, { z: 0.0, y: 1.4, w: 0.24, h: 0.22 },
      { z: 0.0, y: 1.82, w: 0.26, h: 0.24 }, { z: 0.0, y: 2.06, w: 0.2, h: 0.2 },
    ],
    legs: { n: 2, x: 0.12, z: 0, len: 1.0, r: 0.065, kind: 'claw' },
    arms: { at: [0, 1.94, 0.02], len: 1.24, r: 0.058, claws: 4, drop: 0.62, span: 0.4 },
    head: { at: [0, 2.2, 0.03], w: 0.24, h: 0.28, l: 0.26, snout: 0.12, kind: 'human' },
    eyes: [[-0.075, 2.24, 0.16], [0.075, 2.24, 0.16]], eyeR: 0.036,
  },
  // 白泽：狮身 + 人面 + 双角 + 多目纹
  baize: {
    hex: 0xe2ded0, accent: 0x7ec8ff,
    spine: [
      { z: -1.3, y: 1.1, w: 0.22, h: 0.24 }, { z: -0.8, y: 1.08, w: 0.3, h: 0.34 },
      { z: -0.1, y: 1.08, w: 0.34, h: 0.38 }, { z: 0.5, y: 1.1, w: 0.32, h: 0.36 },
      { z: 1.0, y: 1.16, w: 0.26, h: 0.3 },
    ],
    legs: { n: 4, x: 0.22, z: 0.82, len: 1.02, r: 0.07, kind: 'paw' },
    neck: { at: [0, 1.3, 0.95], tip: [0, 1.66, 1.2], r0: 0.2, r1: 0.15 },
    head: { at: [0, 1.72, 1.32], w: 0.28, h: 0.3, l: 0.3, snout: 0.1, kind: 'human' },
    horns: { kind: 'curved', len: 0.34, r: 0.045, at: [0, 1.86, 1.24] },
    mane: { n: 9, len: 0.34, r: 0.06, z0: -0.6, z1: 1.0 },
    tail: { kind: 'bush', len: 0.7, r: 0.06, n: 6 },
    eyes: [[-0.1, 1.76, 1.46], [0.1, 1.76, 1.46]], eyeR: 0.04,
  },
  // 仙鹤：长颈 + 长腿 + 丹顶 + 黑颈环
  crane: {
    hex: 0xe8e4dc, accent: 0xc83a30,
    spine: [
      { z: -0.62, y: 1.12, w: 0.1, h: 0.11 }, { z: -0.2, y: 1.12, w: 0.17, h: 0.19 },
      { z: 0.22, y: 1.14, w: 0.18, h: 0.2 }, { z: 0.55, y: 1.2, w: 0.12, h: 0.13 },
    ],
    legs: { n: 2, x: 0.09, z: 0.05, len: 1.1, r: 0.03, kind: 'crane' },
    neck: { at: [0, 1.26, 0.48], tip: [0, 1.98, 0.58], r0: 0.075, r1: 0.055 },
    head: { at: [0, 2.04, 0.62], w: 0.14, h: 0.13, l: 0.24, snout: 0.1, kind: 'bird' },
    wing: { span: 0.62, chord: 0.3, up: 1.24, kind: 'feather' },
    tail: { kind: 'fan', len: 0.44, r: 0.05, n: 5 },
    eyes: [[-0.07, 2.06, 0.7], [0.07, 2.06, 0.7]], eyeR: 0.026,
  },
  // 虎（只给神像「虎座」用）：低伏长身 + 短鬃 + 粗尾
  tiger: {
    hex: 0xa8622a, accent: 0x2a201a,
    spine: [
      { z: -1.35, y: 0.94, w: 0.2, h: 0.22 }, { z: -0.8, y: 0.92, w: 0.3, h: 0.32 },
      { z: -0.1, y: 0.92, w: 0.34, h: 0.36 }, { z: 0.5, y: 0.96, w: 0.3, h: 0.32 },
      { z: 1.0, y: 1.04, w: 0.22, h: 0.24 },
    ],
    legs: { n: 4, x: 0.22, z: 0.8, len: 0.88, r: 0.075, kind: 'paw' },
    neck: { at: [0, 1.14, 0.95], tip: [0, 1.42, 1.2], r0: 0.19, r1: 0.15 },
    head: { at: [0, 1.46, 1.3], w: 0.28, h: 0.26, l: 0.34, snout: 0.12, kind: 'lion' },
    mane: { n: 7, len: 0.26, r: 0.05, z0: -0.5, z1: 0.9 },
    tail: { kind: 'bush', len: 0.8, r: 0.055, n: 6 },
    eyes: [[-0.1, 1.5, 1.44], [0.1, 1.5, 1.44]], eyeR: 0.038,
  },
};

/** 截面高度插值（腿根 / 鬃 / 焰毛落点用） */
function spineY(sp: Sec[], z: number): number {
  for (let i = 0; i < sp.length - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    if ((z - a.z) * (z - b.z) <= 0) {
      const t = Math.abs(b.z - a.z) < 1e-5 ? 0 : (z - a.z) / (b.z - a.z);
      return a.y + (b.y - a.y) * t + (a.h + (b.h - a.h) * t) * 0.34;
    }
  }
  return sp[z > 0 ? sp.length - 1 : 0].y;
}
function spineHalfW(sp: Sec[], z: number): number {
  for (let i = 0; i < sp.length - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    if ((z - a.z) * (z - b.z) <= 0) {
      const t = Math.abs(b.z - a.z) < 1e-5 ? 0 : (z - a.z) / (b.z - a.z);
      return a.w + (b.w - a.w) * t;
    }
  }
  return sp[0].w;
}

export interface BeastGeoOpt {
  /** 1 = 远景档：掉鳞环/多目纹/腹褶等细件，面数约减半 */
  lod?: 0 | 1;
  /** 毛发/鬃/焰数量乘子（神像坐骑用 0.3 压到 ~1/3） */
  thin?: number;
  /** false = 不建腿（伏兽座） */
  legs?: boolean;
  /** 换毛色：同一骨架复用到碑兽/犬像 */
  hex?: number;
  accent?: number;
}

/** 兽体总装：一张表 → 一具几何。lod=1 掉细节，thin 压毛量，legs=false 出伏兽 */
export function beastGeo(form: BeastForm, opt: BeastGeoOpt = {}): VGeo {
  const lod = opt.lod ?? 0;
  const thin = opt.thin ?? 1;
  const s0 = BEAST_FORM[form];
  const s: BeastFormSpec = opt.hex === undefined && opt.accent === undefined
    ? s0
    : { ...s0, hex: opt.hex ?? s0.hex, accent: opt.accent ?? s0.accent };
  const g = new VGeo();
  const hex = s.hex, acc = s.accent;
  const sp = s.spine;
  // 远景档：截面段数 8→6、肢段 5→4（配合细件剔除，整体降到 ~0.5–0.6）
  const SEG = lod ? 6 : 8;
  const LSEG = lod ? 4 : 5;

  // —— 躯干：椭圆截面放样 ——
  g.tube(sp.map((q): P3 => [0, q.y, q.z]), sp.map((q) => q.w), sp.map((q) => q.h), SEG, hex, 1);

  // —— 四足 / 双足 ——
  if (s.legs && opt.legs !== false) {
    const L = s.legs;
    for (const sz of L.z !== 0 ? [L.z, -L.z] : [0]) {
      for (const sx of [-1, 1]) {
        const hip: P3 = [sx * L.x, L.len, sz];
        const knee: P3 = [sx * (L.x + 0.03), L.len * 0.46, sz + (sz >= 0 ? 0.07 : -0.09)];
        const ankle: P3 = [sx * L.x, L.kind === 'crane' ? 0.1 : 0.17, sz + (sz >= 0 ? 0.1 : -0.12)];
        g.tube([hip, knee], [L.r, L.r * 0.66], [L.r, L.r * 0.66], LSEG, hex, 1, true, false);
        g.tube([knee, ankle], [L.r * 0.66, L.r * 0.5], [L.r * 0.66, L.r * 0.5], LSEG, hex, 1, false, false);
        if (L.kind === 'hoof') {
          g.cyl(L.r * 0.78, L.r * 0.92, 0.14, 6, sx * L.x, 0.07, sz + (sz >= 0 ? 0.12 : -0.14), acc, 0, 0, 0, 0.9);
        } else if (L.kind === 'crane') {
          g.box(L.r * 5, 0.04, L.r * 2.2, sx * L.x, 0.02, sz + 0.16, sh2(hex, 0.9));
          for (const t of [-1, 0, 1]) g.beam([sx * L.x, 0.02, sz + 0.06], [sx * L.x + t * 0.06, 0.02, sz + 0.24], 0.025, 0.02, sh2(hex, 0.86));
        } else {
          const cs = L.kind === 'claw' ? 3 : 2;
          for (let c = 0; c < cs; c++) {
            const tx = (c - (cs - 1) / 2) * L.r * 1.5;
            g.beam([sx * L.x, 0.1, sz + 0.1], [sx * L.x + tx, 0.02, sz + 0.26], L.r * 0.5, L.r * 0.42, acc);
          }
        }
      }
    }
  }

  // —— 臂（夜叉/罗刹：长臂 + 三指/长爪）——
  if (s.arms) {
    const A = s.arms;
    for (const sx of [-1, 1]) {
      const sh: P3 = [sx * A.span, A.at[1], A.at[2]];
      const el: P3 = [sx * (A.span + A.len * 0.22), A.at[1] - A.len * 0.42, A.at[2] + A.drop * 0.24];
      const wr: P3 = [sx * (A.span + A.len * 0.16), A.at[1] - A.len * 0.78, A.at[2] + A.drop * 0.5];
      g.tube([sh, el], [A.r, A.r * 0.82], [A.r, A.r * 0.82], LSEG, hex, 1, true, false);
      g.tube([el, wr], [A.r * 0.82, A.r * 0.6], [A.r * 0.82, A.r * 0.6], LSEG, hex, 1, false, false);
      g.box(A.r * 2.2, A.r * 1.7, A.r * 1.7, wr[0], wr[1] - A.r * 0.6, wr[2], sh2(hex, 0.94));
      for (let c = 0; c < A.claws; c++) {
        const tx = (c - (A.claws - 1) / 2) * A.r * 1.3;
        g.beam([wr[0] + tx, wr[1] - A.r, wr[2] + A.r * 0.4], [wr[0] + tx * 1.4, wr[1] - A.r - 0.18, wr[2] + A.r * 0.9], A.r * 0.4, A.r * 0.34, acc);
      }
    }
  }

  // —— 颈 + 头 ——
  if (s.neck) {
    const N = s.neck;
    g.tube([N.at, [(N.at[0] + N.tip[0]) / 2, (N.at[1] + N.tip[1]) / 2, (N.at[2] + N.tip[2]) / 2], N.tip], [N.r0, (N.r0 + N.r1) / 2, N.r1], [N.r0, (N.r0 + N.r1) / 2, N.r1], SEG, sh2(hex, 1.04), 1, false, false);
  }
  if (s.head) {
    const H = s.head;
    const [hx, hy, hz] = H.at;
    g.frus(H.w, H.l, H.w * 0.82, H.l * 0.9, H.h, hx, hy, hz, sh2(hex, 1.07));
    // 吻部
    g.frus(H.w * H.snout / 0.3 * 0.72, H.l * 0.5, H.w * H.snout / 0.3 * 0.6, H.l * 0.42, H.h * 0.62, hx, hy - H.h * 0.14, hz + H.l * 0.62, sh2(hex, 1.12));
    if (H.kind === 'dragon') {
      g.frus(H.w * 0.6, H.l * 0.3, H.w * 0.5, H.l * 0.26, H.h * 0.34, hx, hy + H.h * 0.16, hz + H.l * 0.78, sh2(hex, 1.2)); // 额丘
      for (const sx of [-1, 1]) g.cone(0.035, 0.16, 5, hx + sx * H.w * 0.26, hy + H.h * 0.3, hz + H.l * 0.2, sh2(acc, 1.1), 0, 0.5, 0); // 龙角基
      // 须：两根前伸的细须
      for (const sx of [-1, 1]) {
        g.beam([hx + sx * H.w * 0.3, hy - H.h * 0.1, hz + H.l * 0.6], [hx + sx * H.w * 0.72, hy + H.h * 0.08, hz + H.l * 0.96], 0.022, 0.02, acc);
      }
    } else if (H.kind === 'bird') {
      g.cone(0.05, H.snout * 1.6, 5, hx, hy - H.h * 0.1, hz + H.l * 0.56, 0xd8b04a, -Math.PI / 2, 0, 0);
    } else if (H.kind === 'human' || H.kind === 'lion') {
      // 眉脊 / 鼻 / 口（人面与兽面共用）
      g.box(H.w * 0.62, H.h * 0.08, H.w * 0.1, hx, hy + H.h * 0.14, hz + H.l * 0.44, sh2(hex, 0.82));
      g.frus(H.w * 0.16, H.w * 0.16, H.w * 0.12, H.w * 0.12, H.h * 0.3, hx, hy - H.h * 0.02, hz + H.l * 0.46, sh2(hex, 1.14));
      g.box(H.w * 0.34, H.h * 0.05, 0.03, hx, hy - H.h * 0.26, hz + H.l * 0.42, sh2(hex, 0.7));
      if (H.kind === 'lion') {
        for (const sx of [-1, 1]) g.cone(0.032, 0.14, 5, hx + sx * H.w * 0.22, hy - H.h * 0.22, hz + H.l * 0.44, 0xe8e0d0, Math.PI, 0, 0); // 獠牙
      }
    } else if (H.kind === 'deer') {
      g.box(H.w * 0.7, H.h * 0.06, H.w * 0.1, hx, hy + H.h * 0.2, hz + H.l * 0.36, sh2(hex, 0.86));
    }
    // 耳
    for (const sx of [-1, 1]) {
      if (H.kind === 'whale') continue;
      g.cone(H.w * 0.1, H.h * 0.34, 4, hx + sx * H.w * 0.42, hy + H.h * 0.42, hz - H.l * 0.16, sh2(hex, 0.9), sx * 0.5, 0, 0);
    }
  }

  // —— 角 / 鹿角 ——
  if (s.horns) {
    const K = s.horns;
    const [ax, ay, az] = K.at;
    const stalk = (bx: number, bz: number): void => {
      const p0: P3 = [ax + bx, ay, az];
      const p1: P3 = [ax + bx * 1.4, ay + K.len * 0.55, az + bz * 0.3];
      const p2: P3 = [ax + bx * 1.1, ay + K.len, az + bz];
      g.tube([p0, p1, p2], [K.r, K.r * 0.7, K.r * 0.25], [K.r, K.r * 0.7, K.r * 0.25], 4, sh2(hex, 0.78), 1, false, false);
    };
    if (K.kind === 'antler') {
      for (const sx of [-1, 1]) {
        stalk(sx * K.r * 2, K.len * 0.3);
        for (const t of [0.42, 0.68]) {
          const by = ay + K.len * t;
          g.beam([ax + sx * K.r * 2.4, by, az + K.len * 0.2], [ax + sx * (K.r * 2.4 + K.len * 0.28), by + K.len * 0.2, az + K.len * 0.34], K.r * 0.6, K.r * 0.5, sh2(hex, 0.84));
        }
      }
    } else if (K.kind === 'single') {
      g.tube([[ax, ay, az], [ax, ay + K.len * 0.5, az + K.len * 0.55], [ax, ay + K.len * 0.7, az + K.len * 0.95]], [K.r, K.r * 0.6, 0.012], [K.r, K.r * 0.6, 0.012], 5, sh2(hex, 0.82), 1, false, false);
    } else if (K.kind === 'curved') {
      for (const sx of [-1, 1]) {
        g.tube([[ax + sx * K.r * 1.6, ay, az], [ax + sx * (K.r + K.len * 0.6), ay + K.len * 0.5, az - K.len * 0.2], [ax + sx * K.r * 1.2, ay + K.len * 0.95, az - K.len * 0.7]], [K.r, K.r * 0.65, 0.01], [K.r, K.r * 0.65, 0.01], 4, sh2(hex, 0.8), 1, false, false);
      }
    } else {
      for (const sx of [-1, 1]) stalk(sx * K.r * 2.2, -K.len * 0.2);
    }
  }

  // —— 鬃 / 火焰披毛：沿背脊外张的锥刺（thin 压数量，供坐骑档）——
  const spikes = (n0: number, len: number, r: number, z0: number, z1: number, col: number, spread: number): void => {
    const n = Math.max(2, Math.round(n0 * thin));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const z = z0 + (z1 - z0) * t;
      const y = spineY(sp, z) + 0.02;
      const sw = spineHalfW(sp, z);
      const lean = 0.55 + 0.45 * Math.sin(t * Math.PI * 1.6);
      for (const sx of [-1, 1]) {
        g.cone(r, len * (0.7 + 0.3 * Math.sin(t * Math.PI)), 4, sx * sw * spread, y + len * 0.28 * lean, z, col, sx * 0.5, -lean * 0.7, 0);
      }
    }
  };
  if (s.mane) spikes(s.mane.n, s.mane.len, s.mane.r, s.mane.z0, s.mane.z1, sh2(hex, 0.72), 0.9);
  if (s.flame) spikes(s.flame.n, s.flame.len, 0.075, s.flame.z0, s.flame.z1, acc, 1.02);

  // —— 翼：肱羽（一段）+ 飞羽（扇形），两段式 ——
  if (s.wing) {
    const W = s.wing;
    for (const sx of [-1, 1]) {
      const sh: P3 = [sx * spineHalfW(sp, 0.4) * 0.8, spineY(sp, 0.4) - 0.06, 0.35];
      const el: P3 = [sx * W.span * 0.52, sh[1] + W.up * 0.42, -0.12];
      // 肱羽：三段渐窄的厚羽；飞羽：6 根（远景档 4 根）扇形
      g.feather(sh, el, W.chord * 0.42, W.chord * 0.3, W.chord * 0.14, sh2(hex, 1.04));
      const prim = lod ? 4 : 6;
      for (let i = 0; i < prim; i++) {
        const t = i / (prim - 1);
        const tip: P3 = [el[0] + sx * W.span * (0.28 + 0.18 * t), el[1] + W.up * (0.5 - 0.86 * t), el[2] - W.chord * (0.5 + 0.9 * t)];
        g.feather(el, tip, W.chord * 0.24, W.chord * 0.1, W.chord * 0.12, sh2(acc, 0.9 + 0.12 * t));
      }
    }
  }

  // —— 鳍（鲲）：背鳍 + 胸鳍 + 水平尾鳍 ——
  if (s.fin) {
    const F = s.fin;
    g.fan([0, spineY(sp, 0.1), 0.1], [[0, spineY(sp, 0.1) + F.dorsal, -0.5], [0, spineY(sp, 0.1) + F.dorsal * 0.6, 0.5], [0, spineY(sp, 0.1), 0.55]], sh2(hex, 0.86));
    for (const sx of [-1, 1]) {
      g.fan([sx * 0.4, -0.1, 0.75], [[sx * (0.4 + F.pectoral), -0.42, 0.3], [sx * (0.42 + F.pectoral), -0.5, 0.8], [sx * 0.36, -0.3, 1.02]], sh2(hex, 0.94));
    }
    if (F.level) {
      const zt = sp[0].z;
      g.fan([0, 0, zt + 0.06], [[F.caudal, 0, zt - 0.34], [F.caudal * 0.55, 0, zt - 0.6], [0, 0, zt - 0.42]], sh2(acc, 0.9));
      g.fan([0, 0, zt + 0.06], [[-F.caudal * 0.55, 0, zt - 0.6], [-F.caudal, 0, zt - 0.34], [0, 0, zt - 0.42]], sh2(acc, 0.9));
    }
  }

  // —— 尾 ——
  if (s.tail) {
    const T = s.tail;
    const z0 = sp[0].z, y0 = sp[0].y;
    if (T.kind === 'serpent') {
      g.tube([[0, y0, z0], [0, y0 - 0.1, z0 - T.len * 0.45], [0, y0 - 0.05, z0 - T.len]], [T.r, T.r * 0.7, 0.01], [T.r, T.r * 0.7, 0.01], 5, hex, 1, false, false);
    } else if (T.kind === 'bush') {
      g.tube([[0, y0 + 0.1, z0], [0, y0 + 0.36, z0 - T.len * 0.4], [0, y0 + 0.3, z0 - T.len * 0.82]], [T.r, T.r * 0.8, T.r * 0.6], [T.r, T.r * 0.8, T.r * 0.6], 5, hex, 1, false, false);
      const tn = Math.max(2, Math.round(T.n * thin));
      for (let i = 0; i < tn; i++) {
        const a = (i / tn) * TAU;
        g.cone(T.r * 0.5, T.len * 0.36, 4, Math.cos(a) * T.r * 0.8, y0 + 0.3 + Math.sin(a) * T.r * 0.8, z0 - T.len * 0.86, sh2(acc, 0.9), 0, Math.PI * 0.5 + Math.sin(a) * 0.4, a * 0.3);
      }
    } else if (T.kind === 'fan') {
      const rim: P3[] = [];
      for (let i = 0; i < T.n; i++) {
        const t = i / (T.n - 1) - 0.5;
        rim.push([t * T.len * 1.5, y0 + 0.1 + Math.cos(t * Math.PI) * T.len * 0.5, z0 - T.len * (0.6 + 0.4 * Math.cos(t * Math.PI))]);
      }
      g.fan([0, y0 + 0.08, z0 - 0.02], rim, sh2(acc, 0.92));
    } else {
      for (let i = 0; i < T.n; i++) {
        const t = (i - (T.n - 1) / 2) / Math.max(1, T.n - 1);
        const tip: P3 = [t * T.len * 0.55, y0 + 0.5 + Math.cos(t * 2) * 0.15, z0 - T.len];
        g.feather([0, y0 + 0.12, z0 - 0.04], tip, T.r * 2, T.r * 0.8, T.len * 0.12, i % 2 ? sh2(acc, 1) : sh2(hex, 1.1));
        // 羽眼（眼斑）只在近景档
        if (!lod) g.box(T.r * 2.2, T.r * 2.2, 0.02, tip[0], tip[1] + 0.06, tip[2] + T.len * 0.06, sh2(acc, 0.7));
      }
    }
  }

  // —— 各型签名细节（每段 ≤ 15 行）——
  SIGN[form](g, s, lod);
  return g;
}

/** 八型签名：只补「一眼可辨」的那一件，不重写躯干 */
const SIGN: Record<BeastForm, (g: VGeo, s: BeastFormSpec, lod: 0 | 1) => void> = {
  // 龙：鳞环（沿脊 9 道）+ 背鳍列
  long: (g, s, lod) => {
    if (lod) return;
    const sp = s.spine;
    for (let i = 1; i < sp.length - 1; i++) {
      const q = sp[i];
      g.cyl(q.w * 1.12, q.w * 1.12, 0.05, 8, 0, q.y, q.z, sh2(s.accent, 0.6), 0, 0, 0, 1, false);
    }
    for (let i = 0; i < 7; i++) {
      const z = -1.6 + i * 0.55;
      g.cone(0.06, 0.22, 4, 0, spineY(sp, z) + 0.12, z, sh2(s.accent, 0.9), 0, -0.8, 0);
    }
  },
  // 麒麟：胸前/肩部鳞甲片
  qilin: (g, s, lod) => {
    if (lod) return;
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const z = 1.0 - t * 0.9, y = spineY(s.spine, z) - 0.1;
      for (const sx of [-1, 1]) g.box(0.09, 0.07, 0.13, sx * spineHalfW(s.spine, z) * 0.86, y, z, sh2(s.accent, 0.8), 0, 0.3, 0.2);
    }
  },
  // 凤凰：冠羽 3 根 + 尾羽羽眼
  feng: (g, s) => {
    const h = s.head!;
    for (let i = 0; i < 3; i++) {
      const t = (i - 1) * 0.5;
      g.feather([h.at[0] + t * 0.05, h.at[1] + h.h * 0.4, h.at[2] - 0.02], [h.at[0] + t * 0.22, h.at[1] + h.h * 0.4 + 0.34, h.at[2] - 0.3], 0.06, 0.02, 0.05, sh2(s.accent, 1.1));
    }
  },
  // 鲲：喷气孔 2 + 腹褶 6
  kun: (g, s, lod) => {
    const zt = -0.35;
    for (const sx of [-1, 1]) g.cyl(0.07, 0.09, 0.1, 6, sx * 0.09, s.spine[3].h * 0.98, zt, sh2(s.accent, 0.7));
    if (!lod) {
      for (let i = 0; i < 6; i++) {
        const z = 0.2 + i * 0.28;
        g.box(0.5, 0.05, 0.05, 0, -s.spine[3].h * 0.9, z, sh2(s.hex, 1.14));
      }
    }
  },
  // 夜叉：眉骨角 + 腰裙片
  yaksha: (g, s, lod) => {
    const h = s.head!;
    for (const sx of [-1, 1]) g.cone(0.05, 0.2, 4, h.at[0] + sx * h.w * 0.36, h.at[1] + h.h * 0.34, h.at[2] + h.l * 0.24, sh2(s.accent, 0.8), 0, 0.7, sx * 0.4);
    if (lod) return;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / 4));
      g.box(0.14, 0.34, 0.05, Math.cos(a) * 0.3, 0.8, Math.sin(a) * 0.22, sh2(s.hex, 0.72), a, 0.1, 0);
    }
  },
  // 罗刹：长发 12 束 + 破衣 7 片
  luocha: (g, s, lod) => {
    const h = s.head!;
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * (0.08 + 0.84 * (i / 11));
      const x = h.at[0] + Math.cos(a) * h.w * 0.62, z = h.at[2] - Math.sin(a) * 0.1 - 0.04;
      g.tube([[x, h.at[1] + h.h * 0.2, z], [x * 1.5, h.at[1] - 0.3, z - 0.14], [x * 1.8, h.at[1] - 0.95, z - 0.2]], [0.03, 0.025, 0.012], [0.03, 0.025, 0.012], 4, sh2(s.hex, 0.4), 1, false, false);
    }
    if (lod) return;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      g.box(0.1, 0.6, 0.03, Math.cos(a) * 0.22, 0.86, Math.sin(a) * 0.18, sh2(s.hex, 0.62), a, 0.12, 0);
    }
  },
  // 白泽：多目纹（肩背 6 枚）
  baize: (g, s, lod) => {
    if (lod) return;
    for (let i = 0; i < 6; i++) {
      const z = -0.7 + i * 0.32;
      const sx = i % 2 ? 1 : -1;
      g.cyl(0.06, 0.06, 0.03, 8, sx * spineHalfW(s.spine, z) * 0.95, spineY(s.spine, z) - 0.16, z, sh2(s.accent, 0.75), 0, 0, Math.PI / 2);
    }
  },
  // 仙鹤：丹顶 + 黑颈环
  crane: (g, s) => {
    const h = s.head!;
    g.cyl(0.05, 0.06, 0.05, 6, h.at[0], h.at[1] + h.h * 0.5, h.at[2] - 0.02, s.accent);
    const N = s.neck!;
    g.cyl(0.075, 0.075, 0.09, 8, N.at[0], N.at[1] + 0.06, N.at[2], 0x1c1c20);
  },
  // 虎：环纹（腹侧深色带）
  tiger: (g, s, lod) => {
    if (lod) return;
    for (let i = 0; i < 7; i++) {
      const z = -1.1 + i * 0.34;
      for (const sx of [-1, 1]) g.box(0.05, 0.04, 0.1, sx * spineHalfW(s.spine, z) * 0.92, spineY(s.spine, z) - 0.24, z, s.accent, 0, 0.2, 0.2);
    }
  },
};

/** 各型的眼位（走既有 eye 池，不新增材质） */
export const FORM_EYES: Record<BeastForm, { at: P3[]; r: number }> = Object.fromEntries(
  (Object.keys(BEAST_FORM) as BeastForm[]).map((k) => [k, { at: BEAST_FORM[k].eyes, r: BEAST_FORM[k].eyeR }]),
) as Record<BeastForm, { at: P3[]; r: number }>;

interface Beast {
  sp: SpeciesDef;
  slot: Partial<Record<'body' | 'head' | 'tail' | 'mane' | 'spine' | 'eye' | 'wing' | 'horn' | 'form', number>>;
  legSlot: number; legs: number;
  form?: BeastForm;
  aId: number;
  x: number; y: number; z: number; yaw: number; baseY: number;
  ang: number; phase: number; seed: number;
  cx: number; cz: number; r: number; speed: number;
  color: THREE.Color; accent: THREE.Color; scale: number;
}

const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bv = new THREE.Vector3(), _bs = new THREE.Vector3();
const _bc = new THREE.Color();

function bl(m: THREE.Matrix4, root: THREE.Matrix4, px: number, py: number, pz: number, ex: number, ey: number, ez: number, sx = 1, sy = 1, sz = 1): void {
  _be.set(ex, ey, ez);
  _bq.setFromEuler(_be);
  _bv.set(px, py, pz);
  _bs.set(sx, sy, sz);
  m.compose(_bv, _bq, _bs);
  m.premultiply(root);
}

export class CreatureSystem {
  runners: Runner[] = [];
  private beasts: Beast[] = [];
  private pools: Record<string, BeastPool> = {};
  /** 八兽自建放样：每型一个实例池（几何只建一次） */
  private forms: Partial<Record<BeastForm, BeastPool>> = {};
  private bound = new Map<number, { pos: THREE.Vector3; yaw: number }>();
  private t = 0;
  /** 兽池台账：requested / accepted / dropped + 明细；window.__beastPool 读它 */
  private reqCount = 0;
  private okCount = 0;
  private droppedIds: string[] = [];
  private droppedBySpecies: Record<string, number> = {};
  private droppedByPool: Record<string, number> = {};

  constructor(private crowd: {
    spawnActor(o: Record<string, unknown>): { id: number; pos: THREE.Vector3; yaw: number; freeze: boolean; action: string };
    actors: { id: number; pos: THREE.Vector3; yaw: number }[];
    poolSet?: () => { scene: THREE.Scene; get(name: string): { mesh: THREE.InstancedMesh } };
  }) {
    const y = UNDER.y;
    const spawn = (o: SpawnOpt, pts: [number, number][] | null, speed = 0): number => {
      const a = this.crowd.spawnActor({
        occ: o.occ, pos: new THREE.Vector3(o.x, o.y, o.z), cloth: o.cloth, pants: o.pants, skin: o.skin,
        hat: o.hat, prop: o.prop, action: o.action ?? 'walk', scale: o.scale, freeze: true,
        doing: o.doing, data: o.data, headKit: o.headKit,
      });
      if (pts) this.runners.push({
        aId: a.id, speed: speed || 0.8, i: 0,
        pts: pts.map(([px, pz]) => new THREE.Vector3(px, y, pz)),
      });
      return a.id;
    };
    // 牛头：90s 环线「殿前广场→前引道→南桥头」（43 卷 CH-D-005，~130m/90s≈1.45m/s）
    spawn({ occ: 'soldier', x: 0, y, z: 34, cloth: 0x26262c, pants: 0x2a1420, skin: 0x8a4a2a, hat: 2, prop: 'axe', scale: 2.3, action: 'walk', doing: '牛头押解巡环：殿前→引道→桥头', headKit: 'bull', data: { name: '牛头', nick: '狱卒都头', group: 'deity', weapon: '三股叉', desc: '两顿一顿一扫，跪字当头', code: 'niutou' } },
      [[0, 34], [0, 10], [0, -18], [0, -34], [0, -18], [0, 10]], 1.45);
    // 马面：150s 十八狱内圈 r75（43 卷 CH-D-006 五点环）
    spawn({ occ: 'soldier', x: 75, y, z: 55, cloth: 0x26262c, pants: 0x201428, skin: 0x6a4a8a, hat: 2, prop: 'spear', scale: 2.3, action: 'walk', doing: '马面巡狱：十八狱内圈蹄叩听回声', headKit: 'horse', data: { name: '马面', nick: '狱卒副都头', group: 'deity', weapon: '九环丧门锤', desc: '勒缰三拉，原地突进', code: 'mamian' } },
      [[75, 55], [53, 102], [-53, 102], [-75, 55], [-53, 8], [53, 8]], 1.05);
    // 黑无常（前倾·staggerWalk）黄泉路夜巡往返（43 卷 CH-D-011 对偶签名：一倾一仰）
    spawn({ occ: 'beggar', x: 180, y, z: 24, cloth: 0x1a2028, pants: 0x101418, skin: 0x2a3038, hat: 3, scale: 1.32, action: 'staggerWalk', doing: '黑无常夜巡黄泉：锁鬼不问缘由', data: { name: '黑无常', nick: '范无救', group: 'deity', weapon: '锁链', desc: '行走前倾五度，帽书天下太平', code: 'wuchangB' } },
      [[180, 24], [120, 24], [80, 24], [120, 24]], 0.9);
    // 白无常（后仰·walk 慢）错半程对偶
    spawn({ occ: 'beggar', x: 130, y, z: 21, cloth: 0xe8f0e8, pants: 0xd8e0d8, skin: 0xe8f0e8, hat: 3, scale: 1.32, action: 'walk', doing: '白无常引魂：一见生财，掩面嚎啕', data: { name: '白无常', nick: '谢必安', group: 'deity', weapon: '招魂幡', desc: '行走后仰五度，与黑无常错半程', code: 'wuchangW' } },
      [[130, 21], [95, 21], [80, 21], [95, 21]], 0.85);
    // 骨犬三群：枉死城外循白骨苔足印（43 卷 CH-D-028，不吠之犬）
    const hounds: number[] = [];
    for (let k = 0; k < 3; k++) {
      hounds.push(spawn({ occ: 'beggar', x: 30 + k * 8, y, z: -250, cloth: 0xd8d4c8, pants: 0xc8c4b8, skin: 0xd8d4c8, scale: 0.45, action: 'sneak', doing: '骨犬循迹：眼窝绿火不吠', headKit: 'beast', data: { name: '骨犬', nick: '循迹', group: 'guest', weapon: '', desc: '循白骨苔足印每秒两嗅', code: 'hound' + k } },
        [[30 + k * 8, -250], [60 + k * 8, -262], [20 + k * 8, -272], [-10 + k * 8, -258]], 0.8));
    }
    // 灵猴六只：蟠桃园环巡（10 卷 T-CRT-008 夜袭三千年档）
    const monkeys: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a0 = k * 1.05;
      const rr = 20 + (k % 3) * 6;
      const pts: [number, number][] = [];
      for (let m = 0; m < 5; m++) pts.push([-150 + Math.cos(a0 + m * 1.26) * rr, 40 + Math.sin(a0 + m * 1.26) * rr]);
      monkeys.push(spawn({ occ: 'beggar', x: pts[0][0], y: 202, z: pts[0][1], cloth: 0x6a4e2e, pants: 0x46321c, skin: 0x8a6a42, hat: 0, scale: 0.5, action: 'run', doing: '灵猴绕桃林：专挑三千年档下手', headKit: 'beast', data: { name: '灵猴', nick: '偷桃', group: 'guest', weapon: '', desc: '金褐睑朱，桃林常客', code: 'monkey' + k } },
        pts.map(([px, pz]) => [px, pz] as [number, number]), 1.2));
    }
    // 天宫 y 修正：runner pts y 用 202
    for (let k = this.runners.length - 6; k < this.runners.length; k++) {
      // 灵猴在蟠桃园跑：跑道点必须与整层同高（202 是缩放前口径）。
      // 必须走 heavenY()，不能写 `202 + HEAVEN_LIFT`：几何是 2131+(y-196)*2.2，
      // 而 +1935 只给了 2137，比台面低 7.2m，灵猴会陷进地里。
      for (const p of this.runners[k].pts) p.y = heavenY(202);
    }
    // 骨犬/灵猴改用兽体：人类部件停写，四足骨架接管
    for (const id of [...hounds, ...monkeys]) {
      const a = this.crowd.actors.find((x) => x.id === id);
      if (a) this.bound.set(id, a as { pos: THREE.Vector3; yaw: number });
    }
    this.initBeasts(hounds, monkeys);
    this.mountBeastDebug();
  }

  /** 兽池台账快照（window.__beastPool.report() 与探针共用） */
  beastReport(): BeastPoolReport {
    const pools: Record<string, { used: number; max: number }> = {};
    for (const k of Object.keys(this.pools)) pools[k] = { used: this.pools[k].count, max: this.pools[k].max };
    return {
      requested: this.reqCount,
      accepted: this.okCount,
      dropped: this.droppedIds.length,
      droppedIds: [...this.droppedIds],
      droppedBySpecies: { ...this.droppedBySpecies },
      droppedByPool: { ...this.droppedByPool },
      pools,
    };
  }

  /** 槽位不足：仍是跳过（不抛异常、不中断加载），但记账 + 汇总告警，不再静默 */
  private noteDrop(sp: SpeciesDef, pool: string): void {
    this.droppedIds.push(sp.id);
    this.droppedBySpecies[sp.id] = (this.droppedBySpecies[sp.id] ?? 0) + 1;
    this.droppedByPool[pool] = (this.droppedByPool[pool] ?? 0) + 1;
  }

  /** 调试出口：window.__beastPool（只读 getter + report()；无 window 的无头用例不发布） */
  private mountBeastDebug(): void {
    if (typeof window === 'undefined') return;
    const api: Record<string, unknown> = {};
    const keys: (keyof BeastPoolReport)[] = [
      'requested', 'accepted', 'dropped', 'droppedIds', 'droppedBySpecies', 'droppedByPool', 'pools',
    ];
    for (const k of keys) {
      Object.defineProperty(api, k, { enumerable: true, get: () => this.beastReport()[k] });
    }
    api['report'] = () => this.beastReport();
    (window as unknown as Record<string, unknown>)['__beastPool'] = api;
  }

  /** 37+5 类生物分型落地：真实 Crowd（有 poolSet）才建兽体池，无头用例零开销 */
  private initBeasts(hounds: number[], monkeys: number[]): void {
    if (!this.crowd.poolSet) return;
    const ps = this.crowd.poolSet();
    // 材质沿用既有池材质（从实例池取同一份 BODY_MAT / GLOW_MAT，不新增材质）
    const bodyMat = ps.get('head').mesh.material as THREE.Material;
    const glowMat = ps.get('halo').mesh.material as THREE.Material;
    for (const k of Object.keys(BEAST_POOLS)) {
      const d = BEAST_POOLS[k];
      this.pools[k] = new BeastPool(ps.scene, d.geo, d.glow ? glowMat : bodyMat, d.max, 'pool_beast_' + k);
      this.pools[k].mesh.castShadow = !d.glow;
    }
    // 八兽：每型一份自建放样几何 → 一个 InstancedMesh（W12_MAT 顶点色，实例色置白）
    for (const sp of SPECIES) {
      if (!sp.form || this.forms[sp.form]) continue;
      const inst = new BeastPool(ps.scene, beastGeo(sp.form).geo(), W12_MAT, 6, 'beast_' + sp.form);
      inst.mesh.castShadow = true;
      this.forms[sp.form] = inst;
    }
    const bound = new Map<string, number[]>();
    bound.set('guquan', hounds);
    bound.set('linghou', monkeys);
    for (const sp of SPECIES) {
      if (sp.spawn) {
        for (let i = 0; i < sp.spawn.n; i++) this.addBeast(sp, sp.spawn, i);
      } else if (bound.has(sp.key)) {
        for (const id of bound.get(sp.key)!) this.addBeast(sp, { x: 0, z: 0, y: UNDER.y, n: 1, r: 8, speed: 0, host: 'under', scale: sp.key === 'guquan' ? 1 : 0.75 }, 0, id);
      }
    }
    // 汇总一条告警：数量 + 被丢弃的 species id（明细同时挂在 window.__beastPool）
    if (this.droppedIds.length > 0) {
      console.warn(`[beasts] 兽池槽位不足，${this.droppedIds.length} 只未入场：${this.droppedIds.join(', ')}`);
    }
  }

  private addBeast(sp: SpeciesDef, cfg: SpawnCfg, i: number, aId = -1): void {
    this.reqCount++;
    const slot: Beast['slot'] = {};
    const take = (pool: string, n: number): number => {
      const p = this.pools[pool];
      if (!p || p.mesh.count + n > p.max) return -1;
      return p.alloc(n);
    };
    if (sp.form) {
      // 八兽：整具放样已被签名细节吃满，不再拆 body/head/leg 件
      const inst = this.forms[sp.form];
      if (!inst) { this.noteDrop(sp, 'form:' + sp.form); return; }
      slot.form = inst.alloc(1);
      slot.eye = take('eye', FORM_EYES[sp.form].at.length);
      const fly = sp.fly === true;
      // 天宫灵兽的 cfg.y 是缩放前坐标；非天宫宿主（人间 0 / 地府 -260）保持原值。
      const rawY = fly ? Math.max(cfg.y, HOST_Y[cfg.host] + MIN_CLEAR[sp.group]) : cfg.y;
      const baseY = cfg.host === 'sky' ? heavenY(rawY) : rawY;
      const ang = (i / Math.max(1, cfg.n)) * Math.PI * 2 + (sp.id.charCodeAt(2) % 7) * 0.4;
      this.beasts.push({
        sp, slot, legSlot: -1, legs: 0, form: sp.form, aId,
        x: cfg.x + Math.cos(ang) * cfg.r, y: baseY, z: cfg.z + Math.sin(ang) * cfg.r, yaw: ang,
        baseY, ang, phase: i * 1.7, seed: i * 3.3 + sp.id.length,
        cx: cfg.x, cz: cfg.z, r: cfg.r, speed: cfg.speed,
        color: new THREE.Color(sp.color), accent: new THREE.Color(sp.accent),
        scale: cfg.scale ?? 1,
      });
      this.okCount++;
      return;
    }
    const body = take('body', 1);
    if (body < 0) { this.noteDrop(sp, 'body'); return; }
    slot.body = body;
    slot.head = take('head', 1);
    const legs = sp.legs ?? 4;
    const legSlot = take('leg', legs);
    for (const f of sp.feat) {
      if (f === 'tail') slot.tail = take('tail', 1);
      else if (f === 'mane') slot.mane = take('mane', 1);
      else if (f === 'spine') slot.spine = take('spine', 1);
      else if (f === 'eye') slot.eye = take('eye', 1);
      else if (f === 'wing') slot.wing = take('wing', 2);
      else if (f === 'fin') slot.wing = take('wing', 1);
      else if (f === 'horn') slot.horn = take('horn', 2);
      else if (f === 'antler') slot.horn = take('horn', 4);
      else if (f === 'ear') slot.horn = take('horn', 2);
    }
    const fly = sp.fly === true;
    const rawY2 = fly
      ? Math.max(cfg.y, HOST_Y[cfg.host] + MIN_CLEAR[sp.group])
      : cfg.y;
    const baseY = cfg.host === 'sky' ? heavenY(rawY2) : rawY2;
    const ang = (i / Math.max(1, cfg.n)) * Math.PI * 2 + (sp.id.charCodeAt(2) % 7) * 0.4;
    this.beasts.push({
      sp, slot, legSlot, legs, aId,
      x: cfg.x + Math.cos(ang) * cfg.r, y: baseY, z: cfg.z + Math.sin(ang) * cfg.r, yaw: ang,
      baseY, ang, phase: i * 1.7, seed: i * 3.3 + sp.id.length,
      cx: cfg.x, cz: cfg.z, r: cfg.r, speed: cfg.speed,
      color: new THREE.Color(sp.color), accent: new THREE.Color(sp.accent),
      scale: cfg.scale ?? 1,
    });
    this.okCount++;
  }

  update(dt: number): void {
    this.t += dt;
    for (const r of this.runners) {
      const a = this.crowd.actors.find((x) => x.id === r.aId);
      if (!a) continue;
      const tgt = r.pts[r.i];
      const dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) { r.i = (r.i + 1) % r.pts.length; continue; }
      a.pos.x += (dx / d) * r.speed * dt;
      a.pos.z += (dz / d) * r.speed * dt;
      a.pos.y = tgt.y;
      const ty = Math.atan2(dx, dz);
      let dyw = ty - a.yaw;
      while (dyw > Math.PI) dyw -= Math.PI * 2;
      while (dyw < -Math.PI) dyw += Math.PI * 2;
      a.yaw += dyw * Math.min(1, dt * 5);
    }
    if (!this.beasts.length) return;
    for (const b of this.beasts) {
      b.phase += dt * GROUPS[b.sp.group].gait;
      if (b.aId >= 0) {
        const a = this.bound.get(b.aId);
        if (!a) continue;
        b.x = a.pos.x; b.z = a.pos.z; b.yaw = a.yaw;
        b.y = a.pos.y;
      } else {
        if (!b.sp.stationary && b.r > 0 && b.speed > 0) {
          b.ang += (dt * b.speed) / Math.max(3, b.r);
          b.x = b.cx + Math.cos(b.ang) * b.r;
          b.z = b.cz + Math.sin(b.ang) * b.r;
          b.yaw = Math.atan2(-Math.sin(b.ang), Math.cos(b.ang));
        }
        b.y = b.baseY;
        if (b.sp.fly) b.y += Math.sin(this.t * 0.55 + b.seed) * 1.6;
        else if (b.sp.water) b.y += Math.sin(this.t * 1.6 + b.seed) * 0.18;
        if (b.sp.key === 'jinli') b.y += Math.max(0, Math.sin(this.t * 0.9 + b.seed)) * 2.4;
      }
      this.writeBeast(b);
    }
    for (const k in this.pools) this.pools[k].flush();
  }

  private writeBeast(b: Beast): void {
    const G = GROUPS[b.sp.group];
    const sh = b.sp.shape ?? {};
    const bw = G.w * (sh.w ?? 1) * b.scale;
    const bh = G.h * (sh.h ?? 1) * b.scale;
    const blen = G.l * (sh.l ?? 1) * b.scale;
    const legH = bh * (sh.leg ?? 0.62);
    const bodyY = legH + bh * 0.5;
    const fly = b.sp.fly === true;
    const flap = fly ? Math.sin(this.t * 3.2 + b.seed) * 0.55 : 0;

    _be.set(fly ? Math.sin(this.t * 0.9 + b.seed) * 0.06 : 0, b.yaw, 0);
    _bq.setFromEuler(_be);
    _m0.compose(_bv.set(b.x, b.y, b.z), _bq, _bs.setScalar(1));

    // 八兽：整具放样一次落位（体态靠几何本身，动作只做整体俯仰/浮沉，不拆件摆动）
    if (b.slot.form !== undefined && b.form) {
      const inst = this.forms[b.form];
      if (inst) {
        const roll = fly ? Math.sin(this.t * 0.7 + b.seed) * 0.1 : Math.sin(b.phase * 0.5) * 0.012;
        _be.set(0, b.yaw, roll);
        _bq.setFromEuler(_be);
        _m1.compose(_bv.set(b.x, b.y, b.z), _bq, _bs.setScalar(b.scale));
        inst.set(b.slot.form, _m1, _bc.setRGB(1, 1, 1));
        inst.flush();
      }
      if (b.slot.eye !== undefined) {
        const E = FORM_EYES[b.form];
        for (let i = 0; i < E.at.length; i++) {
          const p = E.at[i];
          bl(_m3, _m0, p[0] * b.scale, p[1] * b.scale, p[2] * b.scale, 0, 0, 0, E.r * b.scale * 2.2, E.r * b.scale * 2.2, E.r * b.scale * 1.6);
          this.pools.eye.set(b.slot.eye + i, _m3, _bc.copy(b.accent).multiplyScalar(1.5));
        }
      }
      return;
    }

    const body = this.pools.body;
    if (b.slot.body !== undefined) {
      bl(_m1, _m0, 0, bodyY, 0, 0, 0, 0, bw, bh, blen);
      body.set(b.slot.body, _m1, b.color);
    }
    if (b.slot.head !== undefined) {
      bl(_m2, _m0, 0, bodyY + bh * 0.46, blen * 0.46, 0, 0, 0, bw * 0.55, bh * 0.55, blen * 0.42);
      this.pools.head.set(b.slot.head, _m2, b.color);
    }
    // 四足/多足：髋部摆动，落点在根平面上下
    if (b.legSlot >= 0) {
      for (let i = 0; i < b.legs; i++) {
        const side = i % 2 ? 1 : -1;
        const fore = i < b.legs / 2 ? 1 : -1;
        const swing = Math.sin(b.phase + (side > 0 ? Math.PI : 0) + (fore > 0 ? 0 : Math.PI * 0.5)) * (fly ? 0.15 : 0.5);
        bl(_m3, _m0, side * bw * 0.33, bodyY - bh * 0.42, fore * blen * 0.3, swing, 0, 0, bw * 0.17, legH, bw * 0.17);
        this.pools.leg.set(b.legSlot + i, _m3, b.accent);
      }
    }
    if (b.slot.tail !== undefined) {
      bl(_m3, _m0, 0, bodyY + bh * 0.12, -blen * 0.5, -0.35 + Math.sin(this.t * 2 + b.seed) * 0.12, 0, 0, bw * 0.24, bw * 0.24, blen * 0.55);
      this.pools.tail.set(b.slot.tail, _m3, b.accent);
    }
    if (b.slot.spine !== undefined) {
      bl(_m3, _m0, 0, bodyY + bh * 0.5, 0, 0, 0, 0, bw * 0.55, bh * 0.4, blen * 0.9);
      this.pools.spine.set(b.slot.spine, _m3, b.accent);
    }
    if (b.slot.mane !== undefined) {
      bl(_m3, _m0, 0, bodyY + bh * 0.42, blen * 0.24, 0, 0, 0, bw * 0.62, bh * 0.42, bw * 0.62);
      this.pools.mane.set(b.slot.mane, _m3, b.accent);
    }
    if (b.slot.horn !== undefined) {
      const hp = this.pools.horn;
      const feat = b.sp.feat.find((f) => f === 'horn' || f === 'antler' || f === 'ear');
      if (feat === 'antler') {
        for (let i = 0; i < 2; i++) {
          const s = i ? 1 : -1;
          bl(_m3, _m2, s * 0.22, 0.3, 0.02, -0.3, 0, -s * 0.45, 0.16, 1.9, 0.16); hp.set(b.slot.horn + i, _m3, b.accent);
          bl(_m3, _m2, s * 0.3, 0.75, 0.02, -0.35, 0, -s * 0.9, 0.12, 1.0, 0.12); hp.set(b.slot.horn + 2 + i, _m3, b.accent);
        }
      } else if (feat === 'ear') {
        for (let i = 0; i < 2; i++) {
          const s = i ? 1 : -1;
          bl(_m3, _m2, s * 0.24, 0.46, -0.04, -0.15, 0, -s * 0.2, 0.14, 0.55, 0.1); hp.set(b.slot.horn + i, _m3, b.accent);
        }
      } else {
        for (let i = 0; i < 2; i++) {
          const s = i ? 1 : -1;
          bl(_m3, _m2, s * 0.26, 0.34, 0.04, -0.35, 0, -s * 0.32, 0.22, 1.5, 0.22); hp.set(b.slot.horn + i, _m3, b.accent);
        }
      }
    }
    if (b.slot.eye !== undefined) {
      _bc.copy(b.accent);
      if (b.sp.feat.includes('eye') && b.sp.group === 'small') {
        // 独眼：单颗置于面门正中
        bl(_m3, _m2, 0, 0.05, 0.5, 0, 0, 0, 0.5, 0.5, 0.3);
      } else {
        bl(_m3, _m2, 0, 0.12, 0.5, 0, 0, 0, 0.28, 0.28, 0.2);
      }
      this.pools.eye.set(b.slot.eye, _m3, _bc.multiplyScalar(1.4));
    }
    if (b.slot.wing !== undefined) {
      const wp = this.pools.wing;
      if (b.sp.feat.includes('fin')) {
        bl(_m3, _m0, 0, bodyY + bh * 0.55, 0, 0, 0, 0, bw * 0.18, bh * 0.55, blen * 0.5);
        wp.set(b.slot.wing, _m3, b.accent);
      } else {
        bl(_m3, _m0, bw * 0.42, bodyY + bh * 0.3, 0, 0, 0, flap, bw * 1.15, bh * 0.12, blen * 1.0);
        wp.set(b.slot.wing, _m3, b.accent);
        bl(_m3, _m0, -bw * 0.42, bodyY + bh * 0.3, 0, 0, Math.PI, -flap, bw * 1.15, bh * 0.12, blen * 1.0);
        wp.set(b.slot.wing + 1, _m3, b.accent);
      }
    }
  }

  /** 台账用：creature.<类>.<件> 特征 kit 清单与实例数 */
  kitStats(): { id: string; count: number }[] {
    const out: { id: string; count: number }[] = [];
    const seen = new Map<string, number>();
    for (const b of this.beasts) {
      for (const f of b.sp.feat) {
        const id = `creature.${b.sp.key}.${f}`;
        seen.set(id, (seen.get(id) ?? 0) + (f === 'wing' ? 2 : f === 'antler' ? 4 : 1));
      }
    }
    seen.forEach((count, id) => out.push({ id, count }));
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/** B9 驻守：赵公明（天库镇守财神，41 卷 CH-T-073） */
export function spawnZhaoGongming(crowd: { spawnStation(...a: unknown[]): unknown }): void {
  crowd.spawnStation('merchant', -75, 79, 208 + 0.2, 'stand', '赵公明·天库镇守：吞金驱邪', Math.PI,
    { name: '赵公明', nick: '玄坛真君', group: 'deity', weapon: '铁鞭', desc: '黑面浓须，骑黑虎掌天库', code: 'zhaogongming' } as never);
}

/** 自检用：单只兽体面数（八兽台账 / 面数上限核对） */
export function beastTris(form: BeastForm, opt?: BeastGeoOpt): number {
  return beastGeo(form, opt).tris;
}
