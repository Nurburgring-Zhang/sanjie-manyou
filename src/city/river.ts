import * as THREE from 'three';
import { RIVER_END, RIVER_WATER_Y, riverCenterZ, riverHalfWidth, riverSurfaceY } from './riverGeom';

// 河道几何真源在 riverGeom.ts（imperial / layout / crowd 共用的纯函数）；本文件继续对外暴露同名符号
export { RIVER_END, RIVER_WATER_Y, riverCenterZ, riverHalfWidth, riverSurfaceY };

/**
 * 汴河水面（R1：河要有头有尾）。
 *
 * 旧实现两处根本毛病，正是用户看到的「桥外两侧河水断成沙地」：
 *  ① 水面从城内 y=1.0 线性降到城外 −0.2，而城内地形 |x|,|z|<5200 一律压平到 y=0
 *     （world/terrain.ts 的方形压平）——降坡之后水整条沉进地里，只剩两岸浅滩沙带露出来；
 *  ② 横向蜿蜒用 out^1.35×0.0009，x=4000 处河心被推到 z≈51，直接钻到河岸商业带（z≈40）底下。
 * 现在：水位全河段恒定 1.0，半宽 31→21（62m→42m）；两端水面 42m 全宽没入石砌涵洞，
 * 洞脸拱券 + 铁栅 + 暗背板收口，经城墙下的水关出城接护城河（±5160）——不是一刀平切。
 * 蜿蜒峰值压到 3.2m 且在 |x|<620 / >2600 归零，与城里那段直槽驳岸严格对齐。
 *
 * 本文件另外两个职责：
 *  1) 水面二次细节（高频波纹 / 浅滩沙带 / 虹桥段尾迹池）；
 *  2) R1 的船队：15 条船沿 5 个河段往复（`RIVER_BOATS` + `riverBoatPose` + `riverBoatAttach`）。
 *     会动的船原先只在 units.ts（9 艘、只在 ±650 往复），那份文件本轮不动，船队在这里自建。
 */

/** 船尾迹槽位：由 units.ts 每帧写入，River 只读（模块级固定容量，运行期不分配） */
export interface WakeSlot { x: number; z: number; yaw: number; len: number; wide: number; strength: number }
export const WAKE_SLOTS: WakeSlot[] = Array.from({ length: 12 }, () => ({ x: 0, z: 0, yaw: 0, len: 0, wide: 0, strength: 0 }));

const WAKE_Y = 1.008;
const SHALLOW_LIFT = 0.012;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

// ============ 河道几何：一条贯穿全城的明水带 ============
/**
 * 河带网格：沿 x 采 segX 段，每段横向 segZ 格；`band` 给出时只铺一条贴着水缘的窄带
 * （浅滩沙带用 side=±1、inset=2.0、width=2.4 贴着两侧水线走，河收窄时不会跑到岸上）。
 */
function riverRibbon(segX: number, segZ: number, band: { side: number; inset: number; width: number } | null = null): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segX; i++) {
    const x = -RIVER_END + (2 * RIVER_END * i) / segX;
    const cz = riverCenterZ(x), hw = riverHalfWidth(x);
    for (let j = 0; j <= segZ; j++) {
      const t = (j / segZ) * 2 - 1;
      const z = band ? cz + band.side * (hw - band.inset) + (t * band.width) / 2 : cz + t * hw;
      pos.push(x, RIVER_WATER_Y + (band ? SHALLOW_LIFT : 0), z);
      uv.push(i / segX, j / segZ);
    }
  }
  const W = segZ + 1;
  // 绕序必须让面法线朝 +Y：旧绕序 (a,b,b+1) 的法线是 −Y，材质又是默认 FrontSide，
  // 于是整条河面在俯瞰/空中机位被背面剔除——「水面」其实是河床，压在水下的过河街面、
  // 驳岸脚、码头石作全部裸露，被读成「河上修了路」（逐面实测 avgNormalY=−1.00）。
  for (let i = 0; i < segX; i++) for (let j = 0; j < segZ; j++) {
    const a = i * W + j, b = a + W;
    idx.push(a, b + 1, b, a, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ============ R1 船队：沿河往复航线 ============
export type BoatKind = 'grain' | 'passenger' | 'pleasure' | 'ferry' | 'fisher' | 'skiff';

/**
 * 一条往复航线。`x0`/`x1` 是航段两端（米），船在其间三角波往复（到端点即掉头）。
 * 分段依据是四座过河构造：浮桥 x=−2480、石拱桥 x=−1680、虹桥 x=0、木梁桥 x=+1620。
 * 除 9 号画舫有意从虹桥拱下穿过（展示通航）外，其余航线都不跨越桥体。
 */
export interface BoatRoute {
  id: number;
  kind: BoatKind;
  x0: number;
  x1: number;
  lane: number;     // 航道 z（|lane|+半船宽 必须留在水线内）
  speed: number;    // m/s
  phase: number;    // 0–1，错开相位
  len: number;
  beam: number;
  cabin: number;    // 舱棚高（0 = 敞船）
}

/** 15 艘：粮船 4 / 客船 3 / 画舫 1 / 渡船 2 / 渔船 2 / 小舟 3；长度 4.4–18m 混编 */
export const RIVER_BOATS: BoatRoute[] = [
  { id: 1, kind: 'grain', x0: -2960, x1: -2560, lane: -7, speed: 1.9, phase: 0.05, len: 16.5, beam: 4.4, cabin: 2.2 },
  { id: 2, kind: 'passenger', x0: -2920, x1: -2540, lane: 9, speed: 2.2, phase: 0.42, len: 13.5, beam: 3.6, cabin: 2.6 },
  { id: 3, kind: 'fisher', x0: -2400, x1: -1900, lane: -15, speed: 1.5, phase: 0.71, len: 6.2, beam: 1.9, cabin: 0 },
  { id: 4, kind: 'grain', x0: -2380, x1: -1760, lane: 13, speed: 1.7, phase: 0.18, len: 15.0, beam: 4.2, cabin: 2.1 },
  { id: 5, kind: 'skiff', x0: -2200, x1: -1720, lane: -4, speed: 1.3, phase: 0.63, len: 4.4, beam: 1.4, cabin: 0 },
  { id: 6, kind: 'ferry', x0: -1600, x1: -1100, lane: 7, speed: 1.8, phase: 0.27, len: 9.5, beam: 2.9, cabin: 0 },
  { id: 7, kind: 'passenger', x0: -1560, x1: -620, lane: -11, speed: 2.3, phase: 0.86, len: 12.0, beam: 3.4, cabin: 2.4 },
  { id: 8, kind: 'fisher', x0: -1500, x1: -900, lane: 16, speed: 1.4, phase: 0.34, len: 5.8, beam: 1.8, cabin: 0 },
  { id: 9, kind: 'pleasure', x0: -600, x1: 880, lane: 10, speed: 2.0, phase: 0.12, len: 18.0, beam: 4.6, cabin: 2.9 },
  { id: 10, kind: 'ferry', x0: 150, x1: 700, lane: -13, speed: 1.6, phase: 0.55, len: 9.0, beam: 2.8, cabin: 0 },
  { id: 11, kind: 'skiff', x0: 760, x1: 1200, lane: -3, speed: 1.2, phase: 0.78, len: 4.6, beam: 1.4, cabin: 0 },
  { id: 12, kind: 'grain', x0: 900, x1: 1560, lane: 14, speed: 1.8, phase: 0.09, len: 14.0, beam: 4.0, cabin: 2.0 },
  { id: 13, kind: 'passenger', x0: 1700, x1: 2500, lane: -9, speed: 2.1, phase: 0.47, len: 12.5, beam: 3.5, cabin: 2.5 },
  { id: 14, kind: 'fisher', x0: 1900, x1: 2960, lane: 13, speed: 1.5, phase: 0.31, len: 6.4, beam: 1.9, cabin: 0 },
  { id: 15, kind: 'grain', x0: 2500, x1: 2960, lane: -15, speed: 1.7, phase: 0.92, len: 15.5, beam: 4.2, cabin: 2.1 },
];

export interface BoatPose { x: number; z: number; y: number; yaw: number; dir: 1 | -1; roll: number }

/** 往复航线取位：三角波 + 轻微摆艏，全部由 t 决定（无状态，探针可逐帧复算） */
export function riverBoatPose(r: BoatRoute, t: number): BoatPose {
  const span = r.x1 - r.x0;
  const total = 2 * span;                       // 一个来回的航程（米）
  const d = (((t * r.speed + r.phase * total) % total) + total) % total;
  const fwd = d <= span;
  const dist = fwd ? d : total - d;
  const x = r.x0 + dist;
  const z = r.lane + Math.sin(t * 0.23 + r.phase * 9.4) * 0.55;
  const y = RIVER_WATER_Y + Math.sin(t * 1.6 + r.phase * 6.1) * 0.035;
  const yaw = fwd ? 0 : Math.PI;
  return { x, z, y, yaw, dir: fwd ? 1 : -1, roll: Math.sin(t * 0.9 + r.phase * 4.7) * 0.02 };
}

/**
 * 吃水补偿。`boatParts` 的船底在局部 y=0.55（船底箱心 0.72、厚 0.34），而航线位姿 y 给的是水线，
 * 直接按水线落位等于整条船悬在水面上 0.55m。水面恢复渲染后这个悬空一眼可见，故整体下沉 0.72m：
 * 船底沉到水线下 0.17m、舷顶露出 0.55m。
 */
const BOAT_DRAFT = 0.72;

/**
 * 船员 attach：把船体局部坐标 (lx, lz) 挂到航线上，返回世界位姿。
 * 与 units.ts 里 `a.attach = (out) => {...}` 同语义；本文件用它摆船上的人（不新建 crowd 通道）。
 */
export function riverBoatAttach(r: BoatRoute, t: number, lx: number, lz: number): { x: number; y: number; z: number; yaw: number } {
  const p = riverBoatPose(r, t);
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + c * lx - s * lz, y: p.y - BOAT_DRAFT + 1.3, z: p.z + s * lx + c * lz, yaw: p.yaw };
}

/** 船只部件（局部坐标：+x 船头、+z 右舷、y 自水线起算） */
interface BoatPart { x: number; y: number; z: number; w: number; h: number; d: number; hex: number; glow?: boolean }

const HULL = 0x6b4a2b, HULL_D = 0x4e3620, DECK = 0x8a6a44, TRIM = 0x7d5a34;

function boatParts(r: BoatRoute): BoatPart[] {
  const L = r.len, B = r.beam, C = r.cabin;
  const out: BoatPart[] = [
    { x: 0, y: 0.72, z: 0, w: L * 0.9, h: 0.34, d: B * 0.86, hex: HULL_D },                 // 船底
    { x: 0, y: 1.0, z: 0, w: L * 0.84, h: 0.1, d: B * 0.76, hex: DECK },                     // 甲板
    { x: -L * 0.5, y: 0.8, z: 0, w: 0.14, h: 1.1, d: B * 0.3, hex: HULL_D },                 // 舵
    { x: -L * 0.28, y: 1.34, z: B * 0.62, w: 0.1, h: 0.1, d: Math.min(2.6, L * 0.34), hex: TRIM }, // 橹
  ];
  for (const s of [-1, 1]) {
    out.push({ x: 0, y: 1.0, z: s * B * 0.44, w: L * 0.88, h: 0.55, d: 0.12, hex: HULL });   // 舷板
    out.push({ x: 0, y: 1.42, z: s * B * 0.4, w: L * 0.6, h: 0.26, d: 0.07, hex: TRIM });     // 舷栏
  }
  for (const s of [-1, 1]) {
    out.push({ x: s * L * 0.46, y: 1.02, z: 0, w: L * 0.13, h: 0.5, d: B * 0.62, hex: HULL }); // 艏艉收分
    out.push({ x: s * L * 0.5, y: 1.3, z: 0, w: 0.12, h: 1.0, d: 0.16, hex: HULL_D });          // 艏/艉柱
  }
  if (C > 0) {
    const cl = L * 0.44;
    out.push({ x: -L * 0.1, y: 1.27 + C / 2, z: 0, w: cl, h: C, d: B * 0.62, hex: 0x5e3e22 });
    out.push({ x: -L * 0.1, y: 1.27 + C + 0.09, z: 0, w: cl * 1.18, h: 0.16, d: B * 0.74, hex: 0x333a45 });
    out.push({ x: -L * 0.1, y: 1.27 + C + 0.22, z: 0, w: cl * 0.84, h: 0.13, d: B * 0.52, hex: 0x2a2f36 });
    for (const s of [-1, 1]) {
      out.push({ x: -L * 0.1, y: 1.27 + C * 0.56, z: s * B * 0.315, w: cl * 0.52, h: 0.34, d: 0.05, hex: 0xffb066, glow: true });
    }
    out.push({ x: L * 0.14, y: 1.27 + C + 0.42, z: B * 0.26, w: 0.2, h: 0.26, d: 0.2, hex: 0xff9a3c, glow: true }); // 舱灯
  }
  if (r.kind === 'grain') {
    // 粮船：舱口压席 + 两侧货堆
    out.push({ x: -L * 0.1, y: 1.34, z: 0, w: L * 0.5, h: 0.22, d: B * 0.66, hex: 0x8f7a52 });
    for (const s of [-1, 1]) out.push({ x: L * 0.24, y: 1.42, z: s * B * 0.24, w: L * 0.18, h: 0.4, d: B * 0.3, hex: 0x9c8659 });
  }
  if (r.kind === 'pleasure') {
    // 画舫：前甲板小亭 + 翘檐 + 三盏灯
    out.push({ x: L * 0.3, y: 1.95, z: 0, w: L * 0.2, h: 0.12, d: B * 0.8, hex: 0x9d2933 });
    for (const s of [-1, 1]) out.push({ x: L * 0.3, y: 2.45, z: s * B * 0.36, w: 0.14, h: 1.0, d: 0.14, hex: 0x7d1f26 });
    out.push({ x: L * 0.3, y: 3.0, z: 0, w: L * 0.24, h: 0.14, d: B * 0.9, hex: 0x333a45 });
    for (const s of [-1, 1]) out.push({ x: L * 0.3, y: 2.9, z: s * B * 0.5, w: 0.18, h: 0.24, d: 0.18, hex: 0xffc478, glow: true });
  }
  return out;
}

/** 船上的人：局部坐标 + 布色（不与 crowd 抢通道，纯本文件实例） */
const CREW_SPOTS: Record<BoatKind, [number, number][]> = {
  grain: [[0.32, 0.0], [-0.36, 0.22], [0.1, -0.24]],
  passenger: [[0.34, 0.0], [-0.38, -0.2]],
  pleasure: [[0.42, 0.0], [0.24, 0.18], [-0.3, -0.16]],
  ferry: [[0.28, 0.0], [-0.3, 0.0]],
  fisher: [[-0.18, 0.0]],
  skiff: [[-0.05, 0.0]],
};
const CREW_CLOTH = [0x2a4a6a, 0x7a2a2a, 0x3a5a3a, 0x6a5a3a];

export class River {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private normalTex: THREE.Texture;
  private rippleMat: THREE.MeshBasicMaterial;
  private ripTex: THREE.Texture;
  private shallowMat: THREE.MeshBasicMaterial;
  private wakeMesh: THREE.InstancedMesh;
  private fleetMesh: THREE.InstancedMesh;
  private fleetGlow: THREE.InstancedMesh;
  private fleetWake: THREE.InstancedMesh;
  private fleetParts: BoatPart[][];
  /** 船队逐帧实例计数（探针可读：船数 / 部件数） */
  readonly fleet = { boats: RIVER_BOATS.length, hull: 0, glow: 0 };

  private readonly mRoot = new THREE.Matrix4();
  private readonly mLocal = new THREE.Matrix4();
  private readonly qRoot = new THREE.Quaternion();
  private readonly qLocal = new THREE.Quaternion();
  private readonly eRoot = new THREE.Euler();
  private readonly vRoot = new THREE.Vector3();
  private readonly vLocal = new THREE.Vector3();
  private readonly sRoot = new THREE.Vector3(1, 1, 1);
  private readonly sLocal = new THREE.Vector3();
  private readonly cTmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = riverRibbon(280, 6);
    const normalTex = makeWaterNormal();
    normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.repeat.set(13, 2);
    // 用无光照材质：水面亮度不随太阳角度漂移，避免黄昏低角度高光把整条河打成一块浅色冰面
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a3a46,
      map: normalTex,
      transparent: true,
      opacity: 0.96,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 0, 0); // 水位已烘进几何（全河段 1.0）
    this.mesh.name = 'bian_river';
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
    this.mat = mat;
    this.normalTex = normalTex;

    // ---- 第二层：高频波纹（同一 y=1.0，靠 polygonOffset 压在主层之前，不 z-fight）----
    const ripGeo = riverRibbon(280, 6);
    const ripTex = makeWaterRipple();
    ripTex.wrapS = ripTex.wrapT = THREE.RepeatWrapping;
    // 视觉审核 2026-11-07（V-02）：旧 96×16 与主层 13×2 在 v 向正好 16:2 = 整数比 8，
    // 两层 tile 边界逐格对齐；再叠加旧版那组纯正弦谐波，实拍 `city__bridge__side.png` /
    // `det_water__iso.png` 读成一整片规则的细密竖条纹（条纹布/百叶窗），而不是水光。
    // 修复分两步（每步都做了运行时 A/B 归因，见 scripts/_va_water_ab.mjs / _va_rip_combo.mjs）：
    //   ① 两层贴图都从纯正弦换成可平铺值噪声，打破 tile 内严格周期；
    //   ② 重复数从 94×15 降到 11×3 —— 94×15 在长河掠射角下会把值噪声的规则格点
    //      压成摩尔细条纹（仅开高频层的隔离图证实），降低重复数后读作柔和碎光。
    // 11/13≈0.85、3/2=1.5 皆非整数，两层 tile 边界也不会同步。
    ripTex.repeat.set(11, 3);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0x4a7f88,
      map: ripTex,
      transparent: true,
      // 0.34 → 0.26：高频层是叠加发光，降一档后细碎波光仍在，但不再把噪声格点推成可见条纹
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const ripple = new THREE.Mesh(ripGeo, rippleMat);
    ripple.position.set(0, 0, 0);
    ripple.name = 'bian_river_ripple';
    ripple.renderOrder = 1;
    scene.add(ripple);
    this.rippleMat = rippleMat;
    this.ripTex = ripTex;

    // ---- 浅滩沙带：贴着两侧水线（随河宽/蜿蜒一起走），半透明更亮沙色 ----
    const shallowTex = makeShallowTex();
    shallowTex.wrapS = THREE.RepeatWrapping;
    shallowTex.wrapT = THREE.ClampToEdgeWrapping;
    shallowTex.repeat.set(14, 1);
    const shallowMat = new THREE.MeshBasicMaterial({
      color: 0xc9b184,
      map: shallowTex,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    for (const side of [1, -1]) {
      const g = riverRibbon(280, 2, { side, inset: 2.0, width: 2.4 });
      const m = new THREE.Mesh(g, shallowMat);
      m.position.set(0, 0, 0);
      m.name = side > 0 ? 'bian_shoal_n' : 'bian_shoal_s';
      m.renderOrder = 2;
      scene.add(m);
    }
    this.shallowMat = shallowMat;

    // ---- 尾迹池：极薄透明片，实例容量固定 ----
    const wg = new THREE.PlaneGeometry(1, 1, 1, 1);
    wg.rotateX(-Math.PI / 2);
    wg.translate(0.5, 0, 0); // 局部 +x 从船尾向后延伸
    const wakeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: makeWakeTex(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const wake = new THREE.InstancedMesh(wg, wakeMat, WAKE_SLOTS.length);
    wake.name = 'bian_wake';
    wake.frustumCulled = false;
    wake.renderOrder = 3;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < WAKE_SLOTS.length; i++) {
      wake.setMatrixAt(i, _m);
      wake.setColorAt(i, _col.setRGB(0, 0, 0));
    }
    wake.instanceMatrix.needsUpdate = true;
    if (wake.instanceColor) wake.instanceColor.needsUpdate = true;
    scene.add(wake);
    this.wakeMesh = wake;

    // ---- R1 船队：船体 + 灯笼 + 尾迹，各一池（新增 3 draw call，容量固定）----
    const box = new THREE.BoxGeometry(1, 1, 1);
    const fleetMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const FLEET_CAP = 420, GLOW_CAP = 96;
    this.fleetParts = RIVER_BOATS.map(boatParts);
    const fleetMesh = new THREE.InstancedMesh(box, fleetMat, FLEET_CAP);
    fleetMesh.name = 'veh_boat_fleet';
    fleetMesh.frustumCulled = false;
    fleetMesh.renderOrder = 2;
    const glowMesh = new THREE.InstancedMesh(box, glowMat, GLOW_CAP);
    glowMesh.name = 'veh_boat_fleet_glow';
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 3;
    const fleetWake = new THREE.InstancedMesh(wg, wakeMat, RIVER_BOATS.length);
    fleetWake.name = 'veh_boat_fleet_wake';
    fleetWake.frustumCulled = false;
    fleetWake.renderOrder = 3;
    for (let i = 0; i < FLEET_CAP; i++) { fleetMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); fleetMesh.setColorAt(i, _col.setRGB(0, 0, 0)); }
    for (let i = 0; i < GLOW_CAP; i++) { glowMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); glowMesh.setColorAt(i, _col.setRGB(0, 0, 0)); }
    for (let i = 0; i < RIVER_BOATS.length; i++) fleetWake.setMatrixAt(i, _m.makeScale(0, 0, 0));
    fleetMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    fleetWake.instanceMatrix.needsUpdate = true;
    if (fleetMesh.instanceColor) fleetMesh.instanceColor.needsUpdate = true;
    if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
    scene.add(fleetMesh);
    scene.add(glowMesh);
    scene.add(fleetWake);
    this.fleetMesh = fleetMesh;
    this.fleetGlow = glowMesh;
    this.fleetWake = fleetWake;
  }

  update(t: number, neon: number, fogColor?: THREE.Color, fogDensity?: number): void {
    // 水流：法线贴图缓慢横移 + 轻微明暗呼吸（霓虹越高水色越亮）
    this.normalTex.offset.set(t * 0.018, Math.sin(t * 0.06) * 0.02);
    const tint = 0.9 + neon * 0.1;
    // 水色必须蓝占比最高。旧值 (0.105,0.135,0.115) 是 G>B 的橄榄灰，
    // 乘上法线贴图后与河岸石铺装同值，整条汴河在 b01/r03 机位读成一块水泥板（实测中位亮度 90、p95 102）。
    // 改成同样明度的蓝青（B 最高），并把河床的冷色透一点上来，水面才与岸线分开。
    this.mat.color.setRGB(0.052 * tint, 0.106 * tint, 0.142 * tint);
    if (fogColor) this.mat.color.lerp(fogColor, 0.1);

    // 高频层：反向漂移 + 缓慢呼吸，与主层不同周期 → 双频干涉的拍频在水面上走出明暗带
    this.ripTex.offset.set(-t * 0.031, t * 0.012);
    // 0.26~0.36 在掠射角会把正弦纹理压成规则斜格；降到 0.10~0.16 只留一层水光
    this.rippleMat.opacity = 0.10 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.37));
    this.rippleMat.color.setRGB(0.26 + neon * 0.14, 0.44 + neon * 0.16, 0.48 + neon * 0.18);
    if (fogColor) this.rippleMat.color.lerp(fogColor, 0.08);

    // 浅滩：霓虹越高沙色越亮（夜里的岸边反光）
    this.shallowMat.opacity = 0.26 + neon * 0.14;
    this.shallowMat.color.setRGB(0.78 + neon * 0.10, 0.69 + neon * 0.08, 0.51 + neon * 0.07);
    if (fogColor) this.shallowMat.color.lerp(fogColor, 0.12);

    this.updateWakes();
    this.updateFleet(t);
    void fogDensity;
  }

  /** 尾迹矩阵合成：只读 WAKE_SLOTS，不分配对象 */
  private updateWakes(): void {
    for (let i = 0; i < WAKE_SLOTS.length; i++) {
      const w = WAKE_SLOTS[i];
      const hw = riverHalfWidth(w.x);
      if (w.len <= 0.01 || Math.abs(w.z - riverCenterZ(w.x)) >= hw) {
        _m.makeScale(0, 0, 0);
        this.wakeMesh.setMatrixAt(i, _m);
        continue;
      }
      // 局部 +x = 船尾方向（与航向相反）
      _q.setFromAxisAngle(_up, w.yaw + Math.PI / 2);
      _v.set(w.x, WAKE_Y, w.z);
      _s.set(w.len, 1, w.wide);
      _m.compose(_v, _q, _s);
      this.wakeMesh.setMatrixAt(i, _m);
      const k = Math.min(0.8, w.strength);
      this.wakeMesh.setColorAt(i, _col.setRGB(k * 0.58, k * 0.84, k * 0.94));
    }
    this.wakeMesh.instanceMatrix.needsUpdate = true;
    if (this.wakeMesh.instanceColor) this.wakeMesh.instanceColor.needsUpdate = true;
  }

  /** R1 船队逐帧上屏：15 条航线 → 船体部件 / 灯笼 / 船员 / 尾迹 */
  private updateFleet(t: number): void {
    let hull = 0, glow = 0;
    for (let bi = 0; bi < RIVER_BOATS.length; bi++) {
      const r = RIVER_BOATS[bi];
      const p = riverBoatPose(r, t);
      this.eRoot.set(0, p.yaw, p.roll);
      this.qRoot.setFromEuler(this.eRoot);
      this.vRoot.set(p.x, p.y - BOAT_DRAFT, p.z);
      this.mRoot.compose(this.vRoot, this.qRoot, this.sRoot);
      const parts = this.fleetParts[bi];
      for (let k = 0; k < parts.length; k++) {
        const part = parts[k];
        this.vLocal.set(part.x, part.y, part.z);
        this.sLocal.set(part.w, part.h, part.d);
        this.mLocal.compose(this.vLocal, this.qLocal.identity(), this.sLocal);
        this.mLocal.premultiply(this.mRoot);
        const scaled = _m.copy(this.mLocal);
        if (part.glow) {
          if (glow >= this.fleetGlow.instanceMatrix.count) continue;
          this.fleetGlow.setMatrixAt(glow, scaled);
          this.fleetGlow.setColorAt(glow, this.cTmp.setHex(part.hex));
          glow++;
        } else {
          if (hull >= this.fleetMesh.instanceMatrix.count) continue;
          this.fleetMesh.setMatrixAt(hull, scaled);
          this.fleetMesh.setColorAt(hull, this.cTmp.setHex(part.hex));
          hull++;
        }
      }
      // 船员：每船 1–3 人，局部坐标挂到航线上（attach 语义）
      const spots = CREW_SPOTS[r.kind];
      for (let s = 0; s < spots.length; s++) {
        const [fx, fz] = spots[s];
        const lx = fx * r.len, lz = fz * r.beam;
        const cloth = CREW_CLOTH[(bi + s) % CREW_CLOTH.length];
        this.vLocal.set(lx, 1.28 + 0.45, lz);
        this.sLocal.set(0.3, 0.9, 0.26);
        this.mLocal.compose(this.vLocal, this.qLocal.identity(), this.sLocal);
        this.mLocal.premultiply(this.mRoot);
        this.fleetMesh.setMatrixAt(hull, _m.copy(this.mLocal));
        this.fleetMesh.setColorAt(hull, this.cTmp.setHex(cloth));
        hull++;
        this.vLocal.set(lx, 1.28 + 0.95, lz);
        this.sLocal.set(0.36, 0.12, 0.3);
        this.mLocal.compose(this.vLocal, this.qLocal.identity(), this.sLocal);
        this.mLocal.premultiply(this.mRoot);
        this.fleetMesh.setMatrixAt(hull, _m.copy(this.mLocal));
        this.fleetMesh.setColorAt(hull, this.cTmp.setHex(0xd8c48a));
        hull++;
      }
      // 尾迹：从船尾向后拖，长度随船速
      const wl = r.len * 0.55 + 2.0;
      _q.setFromAxisAngle(_up, p.yaw + Math.PI);
      _v.set(p.x - p.dir * r.len * 0.46, WAKE_Y, p.z);
      _s.set(wl, 1, r.beam * 0.5);
      _m.compose(_v, _q, _s);
      this.fleetWake.setMatrixAt(bi, _m);
    }
    this.fleet.hull = hull;
    this.fleet.glow = glow;
    this.fleetMesh.count = hull;
    this.fleetGlow.count = glow;
    this.fleetMesh.instanceMatrix.needsUpdate = true;
    this.fleetGlow.instanceMatrix.needsUpdate = true;
    this.fleetWake.instanceMatrix.needsUpdate = true;
    if (this.fleetMesh.instanceColor) this.fleetMesh.instanceColor.needsUpdate = true;
    if (this.fleetGlow.instanceColor) this.fleetGlow.instanceColor.needsUpdate = true;
  }
}

/**
 * 可平铺值噪声（V-02 视觉审核修复 2026-11-07，两层水面贴图共用）。
 * 格点 hash 按 nx/ny 取模，因此 u 或 v 从 0 到 1 时首尾精确接边，repeat 不会出现 tile 缝；
 * nx < ny 时噪声沿 u 方向被拉长，用来表达「顺流」的方向感，但不引入任何周期亮线。
 * 不用 RNG，纯坐标 hash，保持 determinism。
 */
const tileHash = (ix: number, iy: number, nx: number, ny: number): number => {
  const wx = ((ix % nx) + nx) % nx, wy = ((iy % ny) + ny) % ny;
  const s = Math.sin(wx * 127.1 + wy * 311.7 + nx * 0.717 + ny * 0.113) * 43758.5453;
  return s - Math.floor(s);
};
const tileNoise = (u: number, v: number, nx: number, ny: number = nx): number => {
  const fx = u * nx, fy = v * ny;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = tileHash(ix, iy, nx, ny), b = tileHash(ix + 1, iy, nx, ny);
  const c = tileHash(ix, iy + 1, nx, ny), d = tileHash(ix + 1, iy + 1, nx, ny);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
};

/**
 * 主层水色底（V-02）：旧版是 4/9/12 三个纯正弦，repeat(13,2) 后 `cos(v*12+u*3)`
 * 在河宽方向给出 24 条等距带，实拍 `only_main.png` 读成整片规则宽波纹。
 * 换成两级可平铺值噪声，只保留大尺度明暗与细碎颗粒，无周期性。
 */
function makeWaterNormal(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const broad = tileNoise(u, v, 4, 8);
      const mid = tileNoise(u, v, 12, 16);
      const h = (broad - 0.5) * 0.9 + (mid - 0.5) * 0.45;
      const i = (y * S + x) * 4;
      img.data[i] = 168 + h * 16;
      img.data[i + 1] = 176 + h * 13;
      img.data[i + 2] = 232;
      img.data[i + 3] = 255 - Math.abs(h) * 20;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * 高频波纹层（V-02）：旧版是 11/19/29 三个纯正弦谐波，tile 内严格周期、tile 间完全同相，
 * repeat 90+ 次后必然读成规则条纹布（同文件 makeShallowTex 已记录过同一个坑）。
 * 第一版修复里还留了一条 `sin(u*6π+…)` 的"流向波"，分层 A/B（`only_ripple.png`）
 * 证明它又把细密条纹请了回来。现在改为**完全无正弦**的三级可平铺值噪声，
 * 靠 nx<ny 的拉长格点表达顺流方向。
 */
function makeWaterRipple(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const broad = tileNoise(u, v, 5, 10);
      const mid = tileNoise(u, v, 14, 22);
      const fine = tileNoise(u, v, 32, 32);
      const k = Math.max(0, Math.min(1, 0.10 + broad * 0.34 + mid * 0.30 + fine * 0.22));
      const i = (y * S + x) * 4;
      img.data[i] = 120 + k * 110;
      img.data[i + 1] = 150 + k * 95;
      img.data[i + 2] = 175 + k * 70;
      img.data[i + 3] = 60 + k * 96;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  // 掠射角长河带上把各向异性从 4 提到 8，减少高频层在远处被 mipmap 压成的方向性条带
  tex.anisotropy = 8;
  return tex;
}

/** 浅滩带：横向（v）两侧淡出的沙色薄层，把"水—岸墙"硬边软成一条湿沙过渡 */
function makeShallowTex(): THREE.CanvasTexture {
  const W = 24, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const band = Math.pow(Math.sin(Math.PI * v), 0.8);
    for (let x = 0; x < W; x++) {
      // 原来是两条正弦相乘，repeat 90 次后在河面上形成规则斜格（实拍读成"棋盘垫"）；
      // 改成哈希噪声，重复感消失
      const hsh = Math.sin((x * 12.9898 + y * 78.233)) * 43758.5453;
      const grain = 0.86 + 0.14 * (hsh - Math.floor(hsh));
      const i = (y * W + x) * 4;
      const k = grain;
      img.data[i] = 205 * k + 24;
      img.data[i + 1] = 182 * k + 22;
      img.data[i + 2] = 138 * k + 20;
      img.data[i + 3] = Math.max(0, Math.min(255, band * k * 235));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 尾迹：船尾亮、远端淡；横向两侧羽化 */
function makeWakeTex(): THREE.CanvasTexture {
  const W = 64, H = 16;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const edge = Math.pow(Math.sin(Math.PI * v), 0.7);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const along = Math.pow(1 - u, 1.7);
      const i = (y * W + x) * 4;
      img.data[i] = 214;
      img.data[i + 1] = 234;
      img.data[i + 2] = 240;
      img.data[i + 3] = Math.max(0, Math.min(255, along * edge * 236));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
