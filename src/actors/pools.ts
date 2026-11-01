import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noReflect } from '../core/layers';

// ============ 实例化部件池：全部动态物体共用极少数 draw call ============
// 用法：init 时 alloc 槽位；每帧向槽位写矩阵；未用槽位缩放为 0（不可见）。
export class InstPool {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private dirty = true;
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly max: number, name: string, glow = false, glowSoft = false, shadow = !glow) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = name;
    // 角色 / 道具 /  deities 这类部件在反射贴图里不到一个像素（512² 覆盖 120×40m ≈ 0.23m/px），
    // 却每个池各占一次 draw call —— 全场 80 多个池就是反射 pass 里最大的一块。
    // 树冠与云例外：它们有 3m 以上的剪影，水面上少了会看得出来。
    if (!/^(tree|cloud)/.test(name)) noReflect(this.mesh);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = false;
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // 性能：count 只画已分配槽位（零缩放实例也要跑顶点着色器，未分配的直接不提交）
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  alloc(n: number): number {
    const base = this.cursor;
    this.cursor += n;
    if (this.cursor > this.max) throw new Error(`池 ${this.mesh.name} 槽位不足：need ${this.cursor} > ${this.max}`);
    if (base + n > this.mesh.count) {
      // 新槽位补零矩阵（隐藏态），count 抬升覆盖已分配区间
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
  hide(i: number): void { this.mesh.setMatrixAt(i, this.zero); this.dirty = true; }
  flush(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }
}

export class PoolSet {
  private pools = new Map<string, InstPool>();
  constructor(readonly scene: THREE.Scene) { this.buildGeoms(); }
  get(name: string): InstPool {
    let p = this.pools.get(name);
    if (!p) {
      const def = POOL_DEFS[name];
      if (!def) throw new Error('未知池：' + name);
      const mat = name === 'cloud' || name === 'cloudFar' ? CLOUD_MAT
        : def.sil ? SILHOUETTE_MAT
        : def.glow ? (def.glowSoft ? GLOW_SOFT_MAT : GLOW_MAT)
        : BODY_MAT;
      p = new InstPool(this.scene, def.geo, mat, def.max, 'pool_' + name, def.glow, def.glowSoft, def.shadow);
      this.pools.set(name, p);
    }
    return p;
  }
  flushAll(): void { this.pools.forEach((p) => p.flush()); }
  allocMany(req: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k in req) out[k] = this.get(k).alloc(req[k]);
    return out;
  }
  /** 各池「已预留 / 容量」快照：探针与断言共用同一口径 */
  report(): Record<string, { used: number; max: number; free: number }> {
    const out: Record<string, { used: number; max: number; free: number }> = {};
    this.pools.forEach((p, k) => { out[k] = { used: p.mesh.count, max: p.max, free: p.max - p.mesh.count }; });
    return out;
  }
  /**
   * 池容量的显式后置断言。
   * 池溢出原本只有 alloc 里的 throw 一条线，而 init 流水线是 async 分段执行，
   * 抛错会被 loading 阶段吞成「卡住不动」——这里把「谁溢出了、差多少」变成可见的断言失败。
   */
  assertCapacity(stage: string): void {
    const over: string[] = [];
    this.pools.forEach((p, k) => {
      if (p.mesh.count > p.max) over.push(`${k} need ${p.mesh.count} > ${p.max}`);
    });
    if (over.length) throw new Error(`[池容量断言] ${stage}：${over.join('；')}`);
  }

  private buildGeoms(): void { /* 几何在 POOL_DEFS 惰性构建 */ }
}

// 织物织纹法线（十字编织凹凸）：全体角色衣料微细节
const clothNrm = (() => {
  const c2 = document.createElement('canvas'); c2.width = c2.height = 64;
  const cx = c2.getContext('2d')!;
  const img = cx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = 128 + Math.sin(x * 1.1) * 40 + Math.sin(y * 1.1) * 40;
    const i4 = (y * 64 + x) * 4;
    img.data[i4] = 128; img.data[i4 + 1] = 128; img.data[i4 + 2] = Math.max(0, Math.min(255, v)); img.data[i4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c2);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
})();
export const BODY_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.02, normalMap: clothNrm, normalScale: new THREE.Vector2(0.5, 0.5) });
export const GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
export const GLOW_SOFT_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false });
export const CLOUD_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.64, depthWrite: false, toneMapped: false });
/** 极远档剪影材质：双面、无光照、逐实例染色（远看只是一块暗色人身剪影） */
export const SILHOUETTE_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

function tY(g: THREE.BufferGeometry, y: number): THREE.BufferGeometry { g.translate(0, y, 0); return g; }
function rotZ(g: THREE.BufferGeometry, a: number): THREE.BufferGeometry { g.rotateZ(a); return g; }

// 1600 → 4800：R12 人口预算。可见角色目标 4000–4500，非行走角色（摊档/名将/神佛/鬼差/戍卒/外城坊民）
// 约 700 名，故行走人口上限留到 4800 才有 10% 以上余量。
// 池满时 alloc 会直接抛错把整个世界初始化打断（表现为加载卡死、loading 不下去），
// 所以 crowd.spawnCrowd 在开池前先做「计划人数 + 已用槽位 ≤ MAX_HUMANS」的显式断言，池分配完再做一次后置断言。
export const MAX_HUMANS = 4800;
export const MAX_ANIMALS = 56;
export const MAX_VEHICLES = 26;
export const MAX_BOATS = 24;
export const MAX_CLOUDS = 300;
export const MAX_MplANE = 24;

const POOL_DEFS: Record<string, { geo: THREE.BufferGeometry; max: number; glow?: boolean; glowSoft?: boolean; sil?: boolean; shadow?: boolean }> = {
  // ---- 人形（第七轮模型细化：袍摆/双耳/翘头鞋/宽袖） ----
  head: { geo: mergeGeometries([
    new THREE.SphereGeometry(0.135, 8, 6),
    new THREE.ConeGeometry(0.035, 0.09, 5).rotateX(Math.PI / 2).translate(0, -0.01, 0.13),
    new THREE.CylinderGeometry(0.055, 0.07, 0.09, 7).translate(0, -0.16, 0),
    // 双耳（模型细化）
    new THREE.SphereGeometry(0.038, 5, 4).translate(0.128, 0.005, 0),
    new THREE.SphereGeometry(0.038, 5, 4).translate(-0.128, 0.005, 0),
  ])!, max: MAX_HUMANS + MAX_ANIMALS }, // 球头+鼻+颈+双耳
  belt: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.235, 0.235, 0.09, 8, 1, true),
    // 玉带钩（腹前小方块）
    new THREE.BoxGeometry(0.09, 0.07, 0.04).translate(0, 0, 0.235),
  ])!, max: MAX_HUMANS }, // 束腰环带+带钩
  collar: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.32, 0.07, 0.32),
    // 交领 V 形（宋装左衽意象）
    new THREE.BoxGeometry(0.05, 0.2, 0.04).translate(0.08, -0.11, 0.14).rotateZ(-0.5),
    new THREE.BoxGeometry(0.05, 0.2, 0.04).translate(-0.08, -0.11, 0.14).rotateZ(0.5),
  ])!, max: MAX_HUMANS }, // 衣领+交领
  wrist: { geo: new THREE.SphereGeometry(0.048, 6, 5), max: MAX_HUMANS * 2 },
  // ---- 冠帽八型（W6 人物分型）：顶戴即身份，一眼分官 / 士 / 农 / 商 / 妇 / 僧 / 道 / 童 ----
  // ① 幞头（官、吏）：展脚 + 后垂罗 + 玉额饰
  hatFlat: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.30, 0.11, 0.32),
    new THREE.BoxGeometry(0.16, 0.03, 0.05).translate(0.22, 0.03, 0),
    new THREE.BoxGeometry(0.16, 0.03, 0.05).translate(-0.22, 0.03, 0),
    new THREE.BoxGeometry(0.20, 0.10, 0.06).translate(0, -0.02, -0.19),
    new THREE.BoxGeometry(0.10, 0.035, 0.02).translate(0, 0.015, 0.166),
  ])!, max: MAX_HUMANS }, // 展脚幞头（宋官帽双翅）+ 后垂罗 + 额饰
  // ② 斗笠（农、船工）：宽檐 + 竹编檐圈 + 系带
  hatCone: { geo: mergeGeometries([
    new THREE.ConeGeometry(0.34, 0.20, 9),
    new THREE.TorusGeometry(0.30, 0.011, 3, 6).rotateX(Math.PI / 2).translate(0, -0.085, 0),
    new THREE.BoxGeometry(0.018, 0.24, 0.018).translate(0.14, -0.19, 0.06),
    new THREE.BoxGeometry(0.018, 0.24, 0.018).translate(-0.14, -0.19, 0.06),
  ])!, max: MAX_HUMANS }, // 斗笠宽檐 + 竹编圈 + 颌下系带
  // ③ 妇人发髻 + 簪（女）：圆髻 + 双鬓 + 横簪 + 簪珠 + 巾结
  bun: { geo: mergeGeometries([
    new THREE.SphereGeometry(0.085, 7, 5).translate(0, 0.05, -0.04),
    new THREE.SphereGeometry(0.05, 5, 3).translate(0.10, 0.01, -0.02),
    new THREE.SphereGeometry(0.05, 5, 3).translate(-0.10, 0.01, -0.02),
    new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5).rotateZ(Math.PI / 2).translate(0, 0.09, -0.05),
    new THREE.SphereGeometry(0.03, 4, 3).translate(0.09, 0.09, -0.05),
    new THREE.CylinderGeometry(0.095, 0.11, 0.05, 7).translate(0, 0.01, -0.03),
  ])!, max: MAX_HUMANS }, // 圆髻 + 双鬓 + 横簪 + 簪珠 + 巾结
  // ④ 东坡巾（士人）：高筒方巾 + 顶盖 + 前檐上翻 + 后垂巾角
  hatDongpo: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.155, 0.185, 0.30, 4).translate(0, 0.15, 0),
    new THREE.BoxGeometry(0.29, 0.05, 0.29).translate(0, 0.31, 0),
    new THREE.BoxGeometry(0.26, 0.06, 0.09).translate(0, 0.055, 0.185),
    new THREE.BoxGeometry(0.10, 0.24, 0.035).translate(0, -0.10, -0.185),
  ])!, max: MAX_HUMANS },
  // ⑤ 幅巾（商贩）：软布包头 + 额箍 + 后垂带
  hatFujin: { geo: mergeGeometries([
    new THREE.SphereGeometry(0.155, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.58),
    new THREE.TorusGeometry(0.152, 0.02, 3, 8).rotateX(Math.PI / 2).translate(0, 0.01, 0),
    new THREE.BoxGeometry(0.06, 0.30, 0.02).translate(0.05, -0.16, -0.14),
    new THREE.BoxGeometry(0.06, 0.30, 0.02).translate(-0.05, -0.16, -0.14),
  ])!, max: MAX_HUMANS },
  // ⑥ 僧帽（僧）：圆箍帽 + 额箍 + 顶珠
  hatMonk: { geo: mergeGeometries([
    new THREE.SphereGeometry(0.158, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.56),
    new THREE.CylinderGeometry(0.165, 0.17, 0.05, 8, 1, true),
    new THREE.SphereGeometry(0.03, 4, 3).translate(0, 0.16, 0),
  ])!, max: MAX_HUMANS },
  // ⑦ 道冠（道）：小方冠 + 冠座 + 横簪 + 后披
  hatDao: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.14, 0.13, 0.14).translate(0, 0.185, 0),
    new THREE.CylinderGeometry(0.115, 0.13, 0.05, 6).translate(0, 0.10, 0),
    new THREE.CylinderGeometry(0.010, 0.010, 0.24, 4).rotateZ(Math.PI / 2).translate(0, 0.185, 0),
    new THREE.BoxGeometry(0.16, 0.20, 0.02).translate(0, -0.06, -0.135),
  ])!, max: MAX_HUMANS },
  // ⑧ 总角（童）：顶发 + 双丫髻 + 发带
  hairKid: { geo: mergeGeometries([
    new THREE.SphereGeometry(0.14, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.SphereGeometry(0.062, 5, 4).translate(0.115, 0.115, 0),
    new THREE.SphereGeometry(0.062, 5, 4).translate(-0.115, 0.115, 0),
    new THREE.BoxGeometry(0.075, 0.025, 0.075).translate(0.115, 0.055, 0),
    new THREE.BoxGeometry(0.075, 0.025, 0.075).translate(-0.115, 0.055, 0),
  ])!, max: MAX_HUMANS },
  torso: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.155, 0.265, 0.56, 8),
    // 袍摆（下摆外扩，行走的袍服剪影）
    new THREE.CylinderGeometry(0.265, 0.345, 0.2, 8, 1, true).translate(0, -0.37, 0),
  ])!, max: MAX_HUMANS }, // 锥台袍身+袍摆
  // ---- 服型附加件（W6）：甲胄 / 围裙，挂在躯干骨上（躯干局部坐标） ----
  armor: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.185, 0.275, 0.40, 8).translate(0, 0.02, 0),          // 胸甲
    new THREE.CylinderGeometry(0.245, 0.265, 0.05, 8, 1, true).translate(0, -0.13, 0), // 甲片横带
    new THREE.CylinderGeometry(0.262, 0.272, 0.05, 8, 1, true).translate(0, -0.20, 0),
    new THREE.BoxGeometry(0.20, 0.09, 0.26).rotateZ(-0.28).translate(-0.215, 0.235, 0), // 披膊
    new THREE.BoxGeometry(0.20, 0.09, 0.26).rotateZ(0.28).translate(0.215, 0.235, 0),
    new THREE.BoxGeometry(0.08, 0.08, 0.05).translate(-0.20, 0.235, 0.115),            // 肩吞兽面
    new THREE.BoxGeometry(0.08, 0.08, 0.05).translate(0.20, 0.235, 0.115),
    new THREE.BoxGeometry(0.14, 0.12, 0.05).translate(0, -0.19, 0.245),                // 腹吞
  ])!, max: MAX_HUMANS },
  apron: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.38, 0.46, 0.03).rotateX(0.06).translate(0, -0.20, 0.245),   // 围裙面
    new THREE.BoxGeometry(0.40, 0.06, 0.035).translate(0, 0.02, 0.250),                // 腰栏
    new THREE.BoxGeometry(0.16, 0.12, 0.04).translate(0, -0.24, 0.272),                // 兜袋
    new THREE.BoxGeometry(0.03, 0.34, 0.02).rotateZ(-0.12).translate(-0.17, 0.10, 0.235), // 系带
    new THREE.BoxGeometry(0.03, 0.34, 0.02).rotateZ(0.12).translate(0.17, 0.10, 0.235),
    new THREE.BoxGeometry(0.02, 0.44, 0.006).translate(-0.09, -0.20, 0.262),           // 褶线
    new THREE.BoxGeometry(0.02, 0.44, 0.006).translate(0.09, -0.20, 0.262),
  ])!, max: MAX_HUMANS },
  sleeve: { geo: new THREE.CylinderGeometry(0.06, 0.135, 0.3, 6, 1, true).translate(0, -0.12, 0), max: MAX_HUMANS * 2 }, // 宽袖大袖（宋制）
  armU: { geo: tY(new THREE.CylinderGeometry(0.052, 0.043, 0.37, 6), -0.185), max: MAX_HUMANS * 2 },
  armL: { geo: tY(new THREE.CylinderGeometry(0.043, 0.036, 0.33, 6), -0.165), max: MAX_HUMANS * 2 },
  legU: { geo: tY(new THREE.CylinderGeometry(0.07, 0.056, 0.43, 6), -0.215), max: MAX_HUMANS * 2 },
  legL: { geo: tY(new THREE.CylinderGeometry(0.056, 0.045, 0.41, 6), -0.205), max: MAX_HUMANS * 2 },
  foot: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.14, 0.09, 0.24).translate(0, -0.005, 0.02),
    // 翘头鞋头（宋式方头靴上翘）
    new THREE.BoxGeometry(0.12, 0.05, 0.08).translate(0, 0.035, 0.16).rotateX(-0.35),
  ])!, max: MAX_HUMANS * 2 },
  // 草鞋（W6 鞋三型之二）：麻底 + 前襻 + 后跟带 + 侧带 + 露出的脚背
  footStraw: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.15, 0.035, 0.26).translate(0, -0.035, 0.03),
    new THREE.BoxGeometry(0.13, 0.02, 0.03).translate(0, 0.02, 0.10),
    new THREE.BoxGeometry(0.13, 0.02, 0.03).rotateX(0.4).translate(0, 0.05, -0.055),
    new THREE.BoxGeometry(0.018, 0.018, 0.20).translate(0.068, 0.025, 0.02),
    new THREE.BoxGeometry(0.018, 0.018, 0.20).translate(-0.068, 0.025, 0.02),
    new THREE.BoxGeometry(0.105, 0.055, 0.11).translate(0, 0.015, 0.125),
  ])!, max: MAX_HUMANS * 2 },
  halo: { geo: new THREE.TorusGeometry(0.42, 0.035, 6, 22), max: 80, glow: true },
  aura: { geo: new THREE.TorusGeometry(0.8, 0.02, 4, 26), max: 80, glow: true },
  // 莲台（佛菩萨坐具）+ 背光（头后圆光）：神佛服化道
  lotus: { geo: mergeGeometries([
    new THREE.TorusGeometry(0.52, 0.09, 6, 16).rotateX(Math.PI / 2).translate(0, 0.06, 0),
    ...Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return new THREE.ConeGeometry(0.09, 0.24, 5).rotateX(-0.4).translate(Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5);
    }),
    new THREE.CylinderGeometry(0.42, 0.5, 0.1, 12).translate(0, 0.02, 0),
  ] as THREE.BufferGeometry[])!, max: 40, glow: true },
  mandorla: { geo: new THREE.CircleGeometry(0.62, 20).translate(0, 0, 0), max: 40, glowSoft: true },
  // ---- 手持道具 ----
  // 手工道具池：R12 扩容后按 3300 名行走人口重算峰值（扇 830 / 篮 540 / 扁担 430 / 枪 96…），
  // 这里取 1.3–1.5 倍余量。漏扩任何一个都会在 spawnCrowd 中途 alloc 抛错。
  staff: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.032, 0.032, 1.7, 5),
    // 杖头（禅杖环）
    new THREE.TorusGeometry(0.07, 0.018, 4, 10).translate(0, 0.9, 0),
  ])!, max: 400 },
  blade: { geo: mergeGeometries([
    tY(new THREE.BoxGeometry(0.07, 0.95, 0.16), 0.45),
    // 刀背刃线（高光棱）
    new THREE.BoxGeometry(0.02, 0.8, 0.05).translate(0, 0.55, 0.09),
    // 刀镡（护手）
    new THREE.CylinderGeometry(0.09, 0.09, 0.03, 8).translate(0, 0.02, 0),
  ])!, max: 240 },
  spear: { geo: mergeGeometries([
    tY(new THREE.CylinderGeometry(0.028, 0.028, 2.3, 5), 1.05),
    // 红缨枪缨穗
    new THREE.ConeGeometry(0.09, 0.22, 6).translate(0, 2.2, 0),
    // 枪尖
    new THREE.ConeGeometry(0.05, 0.18, 6).translate(0, 2.3, 0),
  ])!, max: 420 },
  axe: { geo: mergeGeometries([tY(new THREE.BoxGeometry(0.06, 1.1, 0.06), 0.5), new THREE.BoxGeometry(0.5, 0.36, 0.09).translate(0, 1.0, 0.1)])!, max: 200 },
  fan: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.32, 0.46, 0.03),
    // 扇骨（折扇收拢棱线）
    new THREE.BoxGeometry(0.035, 0.48, 0.035).translate(0, 0, 0.02),
  ])!, max: 1400 },
  basket: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.24, 0.17, 0.3, 7, 1, true),
    // 提梁
    new THREE.TorusGeometry(0.2, 0.02, 4, 10, Math.PI).translate(0, 0.16, 0),
    // 货品露出（包布堆）
    new THREE.SphereGeometry(0.13, 6, 4).translate(0, 0.14, 0),
  ])!, max: 900 },
  jar: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.16, 0.19, 0.34, 8),
    new THREE.CylinderGeometry(0.07, 0.13, 0.08, 8).translate(0, 0.2, 0),
    // 罐肩釉带
    new THREE.TorusGeometry(0.16, 0.018, 4, 12).rotateX(Math.PI / 2).translate(0, 0.12, 0),
  ])!, max: 360 },
  scroll: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.045, 0.045, 0.6, 6).rotateZ(Math.PI / 2),
    new THREE.CylinderGeometry(0.055, 0.055, 0.05, 6).rotateZ(Math.PI / 2).translate(0.3, 0, 0),
    new THREE.CylinderGeometry(0.055, 0.055, 0.05, 6).rotateZ(Math.PI / 2).translate(-0.3, 0, 0),
  ])!, max: 360 },
  carryPole: { geo: mergeGeometries([
    new THREE.BoxGeometry(1.9, 0.05, 0.05),                                            // 扁担
    new THREE.BoxGeometry(0.012, 0.34, 0.012).translate(0.80, -0.19, 0),               // 吊绳
    new THREE.BoxGeometry(0.012, 0.34, 0.012).translate(-0.80, -0.19, 0),
    new THREE.CylinderGeometry(0.16, 0.13, 0.22, 7).translate(0.80, -0.46, 0),          // 货筐
    new THREE.CylinderGeometry(0.165, 0.165, 0.02, 7, 1, true).translate(0.80, -0.35, 0), // 筐箍
    new THREE.SphereGeometry(0.12, 5, 3).translate(0.80, -0.34, 0),                     // 筐中货
    new THREE.CylinderGeometry(0.16, 0.13, 0.22, 7).translate(-0.80, -0.46, 0),
    new THREE.CylinderGeometry(0.165, 0.165, 0.02, 7, 1, true).translate(-0.80, -0.35, 0),
    new THREE.SphereGeometry(0.12, 5, 3).translate(-0.80, -0.34, 0),
  ])!, max: 900 }, // 扁担 + 两筐（W6 持物之一：挑担的两头货）
  // 鱼竿（W6 持物之六）：竹竿 + 竿梢弧 + 线 + 浮标 + 鱼篓
  rod: { geo: mergeGeometries([
    tY(new THREE.CylinderGeometry(0.012, 0.026, 2.4, 4), 1.05),
    new THREE.TorusGeometry(0.26, 0.010, 3, 6, Math.PI * 0.4).translate(0, 2.28, 0.02),
    new THREE.BoxGeometry(0.005, 0.86, 0.005).translate(0.17, 1.90, 0.02),
    new THREE.BoxGeometry(0.022, 0.09, 0.022).translate(0.17, 1.46, 0.02),
    new THREE.CylinderGeometry(0.11, 0.09, 0.20, 6).translate(0, 0.52, 0.12),
  ])!, max: 300 },
  // 算盘（W6 持物之七）：框 + 梁 + 三档 + 六珠
  abacus: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.34, 0.03, 0.03).translate(0, 0.11, 0),
    new THREE.BoxGeometry(0.34, 0.03, 0.03).translate(0, -0.11, 0),
    new THREE.BoxGeometry(0.03, 0.25, 0.03).translate(-0.16, 0, 0),
    new THREE.BoxGeometry(0.03, 0.25, 0.03).translate(0.16, 0, 0),
    new THREE.BoxGeometry(0.32, 0.022, 0.022).translate(0, 0.01, 0),
    new THREE.CylinderGeometry(0.006, 0.006, 0.22, 3).translate(-0.08, 0, 0),
    new THREE.CylinderGeometry(0.006, 0.006, 0.22, 3),
    new THREE.CylinderGeometry(0.006, 0.006, 0.22, 3).translate(0.08, 0, 0),
    new THREE.BoxGeometry(0.026, 0.026, 0.026).translate(-0.08, 0.05, 0),
    new THREE.BoxGeometry(0.026, 0.026, 0.026).translate(-0.08, -0.05, 0),
    new THREE.BoxGeometry(0.026, 0.026, 0.026).translate(0, 0.05, 0),
    new THREE.BoxGeometry(0.026, 0.026, 0.026).translate(0, -0.05, 0),
    new THREE.BoxGeometry(0.026, 0.026, 0.026).translate(0.08, 0.05, 0),
    new THREE.BoxGeometry(0.026, 0.026, 0.026).translate(0.08, -0.05, 0),
  ])!, max: 300 },
  bucket: { geo: new THREE.CylinderGeometry(0.17, 0.14, 0.32, 7), max: 240 },
  bow: { geo: new THREE.TorusGeometry(0.52, 0.022, 4, 10, Math.PI), max: 160 },
  plank: { geo: new THREE.BoxGeometry(1.15, 0.06, 0.28), max: 300 },
  hammer: { geo: mergeGeometries([tY(new THREE.BoxGeometry(0.055, 0.9, 0.055), 0.4), new THREE.BoxGeometry(0.26, 0.24, 0.26).translate(0, 0.85, 0)])!, max: 240 },
  bannerPole: { geo: mergeGeometries([
    tY(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 5), 1.7),
    new THREE.BoxGeometry(0.02, 0.02, 0.02).translate(0, 3.4, 0),
    // 幡旗（垂布）
    new THREE.BoxGeometry(0.36, 0.9, 0.015).translate(0.19, 2.9, 0),
  ])!, max: 200 },
  goldRing: { geo: new THREE.TorusGeometry(0.34, 0.09, 8, 18), max: 40, glow: true },
  // ---- 角色 LOD 专用池（R12）----
  // 中远档（200–600m）：低模 = 四棱锥袍身 + 球头，约 30 三角面，单池一次绘制
  lodLow: { geo: mergeGeometries([
    new THREE.ConeGeometry(0.34, 1.42, 4, 1).translate(0, 0.71, 0),
    new THREE.SphereGeometry(0.155, 4, 3).translate(0, 1.60, 0),
  ])!, max: MAX_HUMANS, shadow: false },
  // 极远档（>600m）：两片十字交叉面片，4 三角面，双面暗色剪影
  lodSil: { geo: mergeGeometries([
    new THREE.PlaneGeometry(0.78, 1.82).translate(0, 0.91, 0),
    new THREE.PlaneGeometry(0.78, 1.82).rotateY(Math.PI / 2).translate(0, 0.91, 0),
  ])!, max: MAX_HUMANS, sil: true, shadow: false },
  // ---- 动物（第七轮：鬃毛/尾巴/牛角） ----
  aBody: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.52, 0.56, 1.3),
    // 尾巴（后扬小锥）
    new THREE.ConeGeometry(0.05, 0.3, 5).rotateX(2.6).translate(0, 0.28, -0.72),
    // 背脊线
    new THREE.BoxGeometry(0.08, 0.08, 1.1).translate(0, 0.3, 0),
  ])!, max: MAX_ANIMALS },
  aHead: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.28, 0.3, 0.62),
    // 双角（牛/驴通用小角）
    new THREE.ConeGeometry(0.035, 0.16, 5).translate(0.09, 0.2, 0.08),
    new THREE.ConeGeometry(0.035, 0.16, 5).translate(-0.09, 0.2, 0.08),
    // 吻部
    new THREE.BoxGeometry(0.18, 0.16, 0.16).translate(0, -0.05, 0.36),
  ])!, max: MAX_ANIMALS },
  aLeg: { geo: tY(new THREE.BoxGeometry(0.095, 0.64, 0.095), -0.32), max: MAX_ANIMALS * 4 },
  camelBody: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.62, 0.7, 1.7),
    new THREE.ConeGeometry(0.05, 0.34, 5).rotateX(2.6).translate(0, 0.34, -0.92),
  ])!, max: 24 },
  camelHump: { geo: new THREE.BoxGeometry(0.34, 0.3, 0.55), max: 48 },
  camelNeck: { geo: tY(new THREE.BoxGeometry(0.15, 0.95, 0.17), 0.47), max: 24 },
  camelHead: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.22, 0.26, 0.52),
    new THREE.BoxGeometry(0.16, 0.14, 0.14).translate(0, -0.04, 0.3),
  ])!, max: 24 },
  fowl: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.17, 0.22, 0.26),
    // 鸡冠+喙
    new THREE.BoxGeometry(0.04, 0.07, 0.1).translate(0, 0.14, 0.06),
    new THREE.ConeGeometry(0.03, 0.08, 4).rotateX(Math.PI / 2).translate(0, 0.09, 0.16),
  ])!, max: 40 },
  // ---- 车轿 ----
  wheel: { geo: rotZ(new THREE.CylinderGeometry(0.44, 0.44, 0.11, 10), Math.PI / 2), max: MAX_VEHICLES * 4 },
  cartBed: { geo: mergeGeometries([new THREE.BoxGeometry(2.3, 0.22, 1.35), new THREE.BoxGeometry(1.3, 0.1, 0.09).translate(1.75, 0.06, 0)])!, max: MAX_VEHICLES },
  sedan: { geo: mergeGeometries([new THREE.BoxGeometry(1.15, 1.25, 1.1).translate(0, 0.75, 0), new THREE.CylinderGeometry(0.06, 0.85, 0.4, 4).rotateY(Math.PI / 4).translate(0, 1.55, 0)])!, max: 28 },
  canopy: { geo: mergeGeometries([new THREE.BoxGeometry(2.0, 0.12, 1.5), new THREE.CylinderGeometry(0.5, 0.75, 0.45, 4).rotateY(Math.PI / 4).scale(1.55, 1, 1.2).translate(0, 0.28, 0)])!, max: 40 },
  // ---- 船 ----
  hull: { geo: mergeGeometries([
    new THREE.BoxGeometry(4.8, 0.55, 1.55),
    new THREE.BoxGeometry(4.2, 0.75, 0.16).translate(0, 0.6, 0.75),
    new THREE.BoxGeometry(4.2, 0.75, 0.16).translate(0, 0.6, -0.75),
    new THREE.BoxGeometry(0.8, 1.0, 1.2).translate(2.35, 0.45, 0),
    new THREE.BoxGeometry(0.7, 0.85, 1.15).translate(-2.3, 0.4, 0),
  ] as THREE.BufferGeometry[])!, max: MAX_BOATS },
  mast: { geo: tY(new THREE.CylinderGeometry(0.055, 0.085, 7.2, 5), 3.6), max: MAX_BOATS },
  oar: { geo: mergeGeometries([tY(new THREE.BoxGeometry(2.6, 0.09, 0.13), 0), new THREE.BoxGeometry(0.5, 0.14, 0.02).translate(0, 0, 0)])!, max: 40 },
  sail: { geo: new THREE.BoxGeometry(2.0, 3.0, 0.05), max: MAX_BOATS },
  boatTop: { geo: new THREE.BoxGeometry(2.3, 0.8, 1.6), max: MAX_BOATS * 8 },
  rope: { geo: new THREE.CylinderGeometry(0.035, 0.035, 1, 4), max: 24 },
  // ---- 坐骑（第七轮：鬃毛/尾/鳍刺/独角） ----
  horseBody: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.56, 0.6, 1.5),
    // 颈鬃（颈脊连排）
    new THREE.BoxGeometry(0.06, 0.1, 0.44).translate(0, 0.38, 0.5).rotateX(-0.5),
    // 尾（低垂甩尾）
    new THREE.ConeGeometry(0.05, 0.44, 5).rotateX(2.75).translate(0, 0.24, -0.82),
  ])!, max: 6 },
  horseHeadN: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.3, 0.32, 0.66),
    // 双耳
    new THREE.ConeGeometry(0.045, 0.14, 4).translate(0.1, 0.2, -0.06),
    new THREE.ConeGeometry(0.045, 0.14, 4).translate(-0.1, 0.2, -0.06),
  ])!, max: 6 },
  horseLeg: { geo: tY(new THREE.BoxGeometry(0.13, 0.72, 0.13), -0.36), max: 24 },
  craneBody: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.62, 0.66, 1.15),
    // 尾羽（上翘白羽排）
    new THREE.BoxGeometry(0.3, 0.06, 0.34).translate(0, 0.3, -0.68).rotateX(-0.35),
  ])!, max: 4 },
  craneWing: { geo: new THREE.BoxGeometry(1.5, 0.1, 0.62), max: 8 },
  craneNeck: { geo: tY(new THREE.CylinderGeometry(0.14, 0.66, 0.14), 0.33), max: 4 },
  craneHead: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.2, 0.22, 0.5),
    // 丹顶
    new THREE.SphereGeometry(0.05, 5, 4).translate(0, 0.13, 0.05),
    // 长喙
    new THREE.ConeGeometry(0.035, 0.18, 4).rotateX(Math.PI / 2).translate(0, 0, 0.3),
  ])!, max: 4 },
  dragonHead: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.7, 0.62, 1.05),
    // 龙角双枝
    new THREE.ConeGeometry(0.07, 0.34, 5).translate(0.18, 0.42, -0.1).rotateZ(-0.4),
    new THREE.ConeGeometry(0.07, 0.34, 5).translate(-0.18, 0.42, -0.1).rotateZ(0.4),
    // 龙须（吻侧垂须）
    new THREE.BoxGeometry(0.03, 0.3, 0.03).translate(0.3, -0.12, 0.45),
    new THREE.BoxGeometry(0.03, 0.3, 0.03).translate(-0.3, -0.12, 0.45),
  ])!, max: 4 },
  dragonSeg: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.82, 0.78, 0.86),
    // 背脊鳍刺
    new THREE.ConeGeometry(0.09, 0.26, 4).translate(0, 0.48, 0),
  ])!, max: 28 },
  dragonFin: { geo: new THREE.BoxGeometry(0.14, 0.5, 0.5), max: 8 },
  dragonLeg: { geo: new THREE.BoxGeometry(0.22, 0.55, 0.22), max: 8 },
  dragonHorn: { geo: new THREE.SphereGeometry(0.5, 8, 6), max: 4, glow: true },
  qilinBody: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.62, 0.66, 1.5),
    // 麒麟鳞背（中线鳍排）
    new THREE.ConeGeometry(0.08, 0.22, 4).translate(0, 0.4, 0.45),
    new THREE.ConeGeometry(0.08, 0.22, 4).translate(0, 0.4, 0),
    new THREE.ConeGeometry(0.08, 0.22, 4).translate(0, 0.4, -0.45),
  ])!, max: 4 },
  qilinHead: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.44, 0.5, 0.7),
    // 独角（麒麟祥角）
    new THREE.ConeGeometry(0.06, 0.36, 5).translate(0, 0.4, 0.05),
    // 龙须
    new THREE.BoxGeometry(0.03, 0.22, 0.03).translate(0.24, -0.1, 0.3),
    new THREE.BoxGeometry(0.03, 0.22, 0.03).translate(-0.24, -0.1, 0.3),
  ])!, max: 4 },
  qilinLeg: { geo: tY(new THREE.BoxGeometry(0.16, 0.76, 0.16), -0.38), max: 16 },
  qilinMane: { geo: new THREE.BoxGeometry(0.22, 0.3, 0.5), max: 12, glow: true },
  qilinTail: { geo: mergeGeometries([
    new THREE.BoxGeometry(0.12, 0.7, 0.12),
    // 尾梢鬃团
    new THREE.SphereGeometry(0.09, 5, 4).translate(0, -0.36, 0),
  ])!, max: 4 },
  // ---- 天空 ----
  cloud: { geo: new THREE.SphereGeometry(1, 10, 7), max: MAX_CLOUDS, glow: true },
  cloudFar: { geo: new THREE.SphereGeometry(1, 6, 4), max: 2400, glow: true },
  lanternFly: { geo: new THREE.BoxGeometry(0.36, 0.48, 0.36), max: 80, glow: true },
  // ---- 植被（第七轮：双锥层叠树冠） ----
  treeTrunk: { geo: mergeGeometries([
    new THREE.CylinderGeometry(0.16, 0.4, 4.4, 5),
    // 根部外扩（三向根脚）
    new THREE.ConeGeometry(0.14, 0.8, 4).translate(0.2, -1.9, 0.1).rotateZ(0.5),
    new THREE.ConeGeometry(0.14, 0.8, 4).translate(-0.2, -1.9, 0).rotateZ(-0.5),
  ])!, max: 1600 },
  treeCanopy: { geo: mergeGeometries([
    new THREE.ConeGeometry(1.7, 3.2, 7).translate(0, 3.4, 0),
    new THREE.ConeGeometry(1.25, 2.6, 7).translate(0, 4.9, 0),
    new THREE.ConeGeometry(0.7, 1.7, 6).translate(0, 6.1, 0),
  ])!, max: 1600 },
};
