import * as THREE from 'three';
import { Crowd } from '../actors/crowd';
import { DEITIES, type DeityDef } from '../data/deities';
import { SkyCenters } from './realm';
import { RNG } from '../core/rng';
import { Vfx } from '../fx/vfx';
import { VGeo, BeastPool, W12_MAT, beastGeo, sh2, type P3 } from './creatures';
import { HEAVEN_SCALE, heavenPoint, heavenY } from './heavenFrame';

// ============================================================
// W12 仙魔神佛：神像分型（8 冠 / 10 持物 / 4 法座 / 袍摆分片 / 背光）
// ------------------------------------------------------------
// 几何内核 VGeo 与兽体放样 beastGeo 都在 sky/creatures.ts（W12 只许改两个文件），
// 这里只写「神像装配」：同一具骨架 → 冠×持物×座×体量 决定可辨识度。
// 与 city/architecture.ts 的 deity() 入参同名同义（x/y/z/h/ry/seated/robe/skin/
// crown/halo/back/hold/seatW），旧调用点原样传参即可换用本实现。
// 材质：运行期从 poolSet() 取既有 BODY_MAT / GLOW_MAT，不新增材质、不新增 b.kit id。
// ============================================================

export type CrownKind = 'mianliu' | 'lotus' | 'dao' | 'buddha' | 'helmet' | 'futou' | 'ghost' | 'child' | 'none';
export type HoldKind = 'gui' | 'ruyi' | 'fuchen' | 'sword' | 'vajra' | 'pen' | 'ledger' | 'banner' | 'bowl' | 'pipa' | 'none';
export type SeatKind = 'sumei' | 'lotus' | 'qilin' | 'cloud' | 'tiger';
export type BuildKind = 'regular' | 'fat' | 'lean' | 'tall' | 'child' | 'old' | 'giant';

/** 旧口径别名（architecture.ts 在用的 'beads'/'phoenix'/'slip'/'lotus'/'peach'）→ 新分型 */
type CrownIn = CrownKind | 'beads' | 'phoenix';
type HoldIn = HoldKind | 'slip' | 'lotus' | 'peach';

export interface StatueSpec {
  x: number; y: number; z: number;
  /** 像高：座面以上（与 architecture.deity 同义） */
  h: number;
  ry?: number;
  seated?: boolean;
  robe: number; skin: number;
  crown?: CrownIn;
  halo?: number | boolean;
  back?: boolean;
  hold?: HoldIn;
  seat?: SeatKind;
  seatW?: number;
  build?: BuildKind;
  /** false = 座上是伏兽而非人形（哮天犬） */
  figure?: boolean;
  coat?: [number, number];
}

// ============ 哮天犬的落脚面（缩放前 y，世界 y 一律走 heavenY）============
// Actor 模型原点在脚底：crowd.writeActor 把实例根矩阵直接放在 a.pos（躯干/头在局部
// y=1.14/1.64、大腿 0.94），所以 pos.y 就是脚底高度，不存在「模型中心」补偿（补偿量 = 0）。
// 犬绕二郎神跑的中轴御道由 heavenColonnade.ts 的 buildFloor 铺在斗法台上：
//   DECK = 206.12（= SKY_STAND_Y.arenaS，realm.platform 的台面铺装顶）
//   PAVE = DECK + 0.14 = 206.26（40×64 缩放前米的 ash 板顶面，即犬脚下的可见地面）
// 落位账把二郎神放在 206.12（台面，不含御道），旧码又按 c.y − 1.2 下沉 —— 犬脚因此
// 落到御道面下 1.2 + 0.14×2.2 ≈ 1.51 世界米（实测 1.55–1.58，差额是御道 0.01–0.02 的石材线脚）。
// 御道板的水平范围 = heavenColonnade 的 WALK_IN=20 与 |Z0|=|Z1|=32（缩放前米）。
const DOG_GROUND = {
  halfX: 20,      // WALK_IN
  halfZ: 32,      // |Z0| = |Z1|
  roadY: 206.26,  // PAVE = DECK + 0.14
  deckY: 206.12,  // SKY_STAND_Y.arenaS（御道之外退回台面）
};

const TAU = Math.PI * 2;
const GOLD = 0xb89434;
const GOLD_D = 0x8a6a1e;
const JADE = 0xdcd6c4;
const INK = 0x24242a;
const STONE = 0x8a877c;
const STONE_D = 0x67645b;
const LAC_RED = 0x7a2420;

const CROWN_ALIAS: Record<string, CrownKind> = {
  beads: 'mianliu', phoenix: 'lotus', none: 'none',
};
const HOLD_ALIAS: Record<string, HoldKind> = {
  slip: 'ledger', lotus: 'bowl', peach: 'bowl', none: 'none',
};
const normCrown = (k?: CrownIn): CrownKind => (k ? (CROWN_ALIAS[k] ?? (k as CrownKind)) : 'none');
const normHold = (k?: HoldIn): HoldKind => (k ? (HOLD_ALIAS[k] ?? (k as HoldKind)) : 'none');

/** 体量档：只改三围与头身比，不改骨架 —— 神像不能一个模子换颜色 */
interface Build { w: number; head: number; hunch: number; neck: number }
const BUILDS: Record<BuildKind, Build> = {
  regular: { w: 1.0, head: 1.0, hunch: 0, neck: 1.0 },
  fat: { w: 1.2, head: 1.02, hunch: 0.02, neck: 0.86 },
  lean: { w: 0.84, head: 0.98, hunch: 0.01, neck: 1.06 },
  tall: { w: 0.96, head: 0.94, hunch: 0, neck: 1.08 },
  child: { w: 0.82, head: 1.26, hunch: 0, neck: 0.9 },
  old: { w: 0.96, head: 1.0, hunch: 0.05, neck: 0.95 },
  giant: { w: 1.14, head: 0.94, hunch: 0.01, neck: 1.0 },
};

/** 弧面（袍摆分片/云气/莲瓣环）：rings 自下而上，双面 */
function arcPanel(g: VGeo, rings: { y: number; r: number }[], a0: number, a1: number, seg: number, hex: number, k = 1): void {
  const pts = rings.map((q) => {
    const row: P3[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      row.push([Math.cos(a) * q.r, q.y, Math.sin(a) * q.r]);
    }
    return row;
  });
  for (let r = 0; r < pts.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      g.quadBoth(pts[r][i], pts[r][i + 1], pts[r + 1][i + 1], pts[r + 1][i], i % 2 ? hex : sh2(hex, 0.96), k);
    }
  }
}

// ============ 4 型法座 ============
// 面数：须弥座 128 / 莲台 12 瓣×3 层=144+2 环柱 80 = 224 / 麒麟座·虎座 = beastGeo(伏兽) / 云座 192
function seatOf(g: VGeo, kind: SeatKind, w: number, sh: number, hex: number): void {
  const half = w * 0.5;
  if (kind === 'lotus') {
    // 莲台：三层莲瓣（仰/平/覆）+ 上下两道颈箍 + 台面
    for (let tier = 0; tier < 3; tier++) {
      const n = 12 - tier * 2;
      const y = sh * (0.18 + tier * 0.24);
      const rr = half * (1.0 - tier * 0.13);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + tier * 0.26;
        const p0: P3 = [Math.cos(a) * rr, y, Math.sin(a) * rr];
        const p1: P3 = [Math.cos(a + 0.24) * rr, y, Math.sin(a + 0.24) * rr];
        const tip: P3 = [Math.cos(a + 0.12) * rr * 1.1, y + sh * 0.2 * (tier === 2 ? -1 : 1), Math.sin(a + 0.12) * rr * 1.1];
        g.quadBoth(p0, p1, tip, tip, tier === 1 ? sh2(hex, 1.12) : hex);
      }
    }
    g.cyl(half * 0.62, half * 0.7, sh * 0.12, 10, 0, sh * 0.06, 0, STONE_D);
    g.cyl(half * 0.9, half * 0.86, sh * 0.1, 10, 0, sh * 0.88, 0, sh2(STONE, 1.08));
    g.cyl(half * 0.97, half * 0.97, sh * 0.06, 10, 0, sh * 0.96, 0, sh2(STONE, 1.16));
    return;
  }
  if (kind === 'cloud' || kind === 'qilin' || kind === 'tiger') {
    // 云座 = 6 团云气；麒麟座/虎座 = 伏兽（复用兽体放样，掉腿掉细节）
    if (kind === 'cloud') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const r = half * (0.5 + 0.16 * (i % 2));
        const cx = Math.cos(a) * half * 0.42, cz = Math.sin(a) * half * 0.42;
        g.tube([[cx, sh * 0.16, cz], [cx * 1.2, sh * 0.36, cz * 1.2], [cx * 1.3, sh * 0.52, cz * 1.3]],
          [r * 0.5, r * 0.62, r * 0.3], [r * 0.34, r * 0.42, r * 0.2], 8, i % 2 ? sh2(hex, 1.06) : hex);
      }
      g.cyl(half * 0.8, half * 0.72, sh * 0.16, 10, 0, sh * 0.5, 0, sh2(hex, 0.9));
      return;
    }
    const mount = beastGeo(kind === 'qilin' ? 'qilin' : 'tiger', { lod: 1, thin: 0.3, legs: false });
    const s = (half * 1.15) / 1.6;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, sh * 0.34, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
      new THREE.Vector3(s, s, s),
    );
    mount.bake(m);
    g.merge(mount);
    g.cyl(half * 0.72, half * 0.66, sh * 0.14, 10, 0, sh * 0.86, 0, sh2(hex, 0.94));
    return;
  }
  // 须弥座：圭角 / 下枋 / 束腰壸门 / 上枋 / 台面（5 层 + 4 壸门 + 8 莲瓣 = 128 面）
  g.box(w, sh * 0.16, w * 0.9, 0, sh * 0.08, 0, STONE_D);
  g.box(w * 0.96, sh * 0.14, w * 0.86, 0, sh * 0.23, 0, sh2(STONE, 0.96));
  g.box(w * 0.8, sh * 0.34, w * 0.72, 0, sh * 0.47, 0, STONE_D);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.box(w * 0.16, sh * 0.16, 0.05, sx * w * 0.24, sh * 0.47, sz * w * 0.36, sh2(STONE_D, 0.7));
  }
  g.box(w * 0.97, sh * 0.14, w * 0.88, 0, sh * 0.72, 0, sh2(STONE, 1.08));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const p0: P3 = [Math.cos(a) * w * 0.44, sh * 0.79, Math.sin(a) * w * 0.4];
    const p1: P3 = [Math.cos(a + 0.5) * w * 0.44, sh * 0.79, Math.sin(a + 0.5) * w * 0.4];
    const tip: P3 = [Math.cos(a + 0.25) * w * 0.5, sh * 0.9, Math.sin(a + 0.25) * w * 0.46];
    g.quadBoth(p0, p1, tip, tip, sh2(STONE, 1.2));
  }
  g.box(w * 0.92, sh * 0.1, w * 0.84, 0, sh * 0.95, 0, sh2(STONE, 1.14));
}

// ============ 8 型头冠 ============
// 面数：冕旒 324 / 莲花冠 124 / 道冠 84 / 佛髻 124 / 兜鍪 166 / 幞头 104 / 角冠 212 / 双髻 144
function crownOf(g: VGeo, kind: CrownKind, h: number, headH: number, headC: number, headW: number, skin: number): void {
  const cy = headC + headH * 0.42;
  const top = headC + headH * 0.5;
  switch (kind) {
    case 'mianliu': {
      // 冕旒：冕板（前低后高）+ 武弁 + 前垂 12 串玉珠（每串 2 粒）+ 玉衡簪 + 充耳
      g.frus(headW * 1.02, headW * 1.0, headW * 0.86, headW * 0.84, headH * 0.34, 0, cy, 0, INK, 0, -0.05, 0);
      g.box(headW * 2.5, headH * 0.13, headW * 1.5, 0, top + headH * 0.1, -headW * 0.12, 0x1e1e24, 0, -0.1, 0);
      g.box(headW * 2.3, headH * 0.05, headW * 1.34, 0, top + headH * 0.2, -headW * 0.12, sh2(GOLD, 0.8));
      for (let i = 0; i < 12; i++) {
        const lx = (i / 11 - 0.5) * headW * 1.86;
        for (let b = 0; b < 2; b++) {
          g.box(headW * 0.09, headH * 0.13, headW * 0.09, lx, top - headH * (0.1 + b * 0.2), headW * 0.62 - b * 0.02, b ? sh2(JADE, 0.86) : JADE);
        }
      }
      g.beam([-headW * 1.1, cy + headH * 0.06, -headW * 0.12], [headW * 1.1, cy + headH * 0.06, -headW * 0.12], headH * 0.05, headH * 0.05, GOLD);
      for (const sx of [-1, 1]) g.box(headW * 0.1, headH * 0.18, headW * 0.1, sx * headW * 0.78, cy - headH * 0.24, 0, JADE);
      break;
    }
    case 'lotus': {
      // 莲花冠：冠箍 + 两层各 8 瓣 + 顶莲蕾 + 两侧垂叶
      g.cyl(headW * 0.62, headW * 0.58, headH * 0.16, 10, 0, cy - headH * 0.04, 0, sh2(GOLD, 0.86), 0, 0, 0, 1, false);
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + layer * 0.39;
          const r = headW * (0.56 + layer * 0.12);
          const y = cy + headH * (0.06 + layer * 0.08);
          const p0: P3 = [Math.cos(a) * r, y, Math.sin(a) * r];
          const p1: P3 = [Math.cos(a + 0.62) * r, y, Math.sin(a + 0.62) * r];
          const tip: P3 = [Math.cos(a + 0.31) * r * 1.32, y + headH * 0.3, Math.sin(a + 0.31) * r * 1.32];
          g.quadBoth(p0, p1, tip, tip, layer ? sh2(JADE, 1.04) : JADE);
        }
      }
      g.cyl(headW * 0.1, headW * 0.2, headH * 0.26, 6, 0, cy + headH * 0.2, 0, sh2(GOLD, 1.1));
      for (const sx of [-1, 1]) g.box(headW * 0.1, headH * 0.3, headW * 0.06, sx * headW * 0.66, cy - headH * 0.2, 0, sh2(GOLD, 0.9), 0, 0, sx * 0.2);
      break;
    }
    case 'dao': {
      // 道冠：上窄下宽冠体 + 顶珠 + 金簪 + 巾子后垂 + 三道云纹
      g.frus(headW * 0.62, headW * 0.56, headW * 0.4, headW * 0.4, headH * 0.36, 0, cy + headH * 0.04, 0, 0x33323a);
      g.box(headW * 0.16, headH * 0.12, headW * 0.16, 0, cy + headH * 0.28, 0, GOLD);
      g.beam([-headW * 0.7, cy + headH * 0.12, 0], [headW * 0.7, cy + headH * 0.12, 0], headH * 0.05, headH * 0.04, GOLD);
      g.quadBoth([-headW * 0.3, top, -headW * 0.1], [headW * 0.3, top, -headW * 0.1], [headW * 0.36, headC - headH * 0.5, -headW * 0.4], [-headW * 0.36, headC - headH * 0.5, -headW * 0.4], sh2(skin, 0.8));
      for (let i = 0; i < 3; i++) g.box(headW * 0.54, headH * 0.03, headW * 0.03, 0, cy + headH * (i * 0.1 - 0.02), headW * 0.42, sh2(GOLD, 0.9 - i * 0.1));
      break;
    }
    case 'buddha': {
      // 佛髻：螺发一圈（10 粒）+ 肉髻 + 顶严
      g.cyl(headW * 0.6, headW * 0.56, headH * 0.2, 10, 0, cy - headH * 0.02, 0, sh2(skin, 0.74), 0, 0, 0, 1, false);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        g.cone(headW * 0.1, headH * 0.14, 4, Math.cos(a) * headW * 0.54, cy + headH * 0.08, Math.sin(a) * headW * 0.5, sh2(skin, 0.64), 0, Math.PI / 2, 0);
      }
      g.cyl(headW * 0.2, headW * 0.34, headH * 0.3, 8, 0, cy + headH * 0.26, 0, sh2(skin, 0.8));
      g.box(headW * 0.1, headH * 0.1, headW * 0.1, 0, cy + headH * 0.4, 0, sh2(GOLD, 1.05));
      break;
    }
    case 'helmet': {
      // 武将兜鍪：盔体 + 额箍 + 护耳 + 顿项 + 顶缨五缕 + 缨枪
      g.tube([[0, cy - headH * 0.1, 0], [0, cy + headH * 0.18, 0], [0, cy + headH * 0.36, 0]],
        [headW * 0.66, headW * 0.6, headW * 0.3], [headW * 0.66, headW * 0.54, headW * 0.24], 8, 0x3c3f4a);
      g.cyl(headW * 0.7, headW * 0.7, headH * 0.1, 10, 0, cy - headH * 0.04, 0, sh2(GOLD, 0.8), 0, 0, 0, 1, false);
      for (const sx of [-1, 1]) {
        g.quadBoth([sx * headW * 0.6, cy - headH * 0.04, headW * 0.2], [sx * headW * 0.66, cy - headH * 0.04, -headW * 0.24],
          [sx * headW * 0.72, cy - headH * 0.5, -headW * 0.2], [sx * headW * 0.64, cy - headH * 0.52, headW * 0.18], 0x2e313a);
        g.quadBoth([sx * headW * 0.7, cy + headH * 0.06, -headW * 0.1], [sx * headW * 0.74, cy + headH * 0.06, -headW * 0.34],
          [sx * headW * 0.8, cy - headH * 0.4, -headW * 0.42], [sx * headW * 0.76, cy - headH * 0.42, -headW * 0.16], 0x2a2d34);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        g.beam([Math.cos(a) * headW * 0.06, cy + headH * 0.36, Math.sin(a) * headW * 0.06],
          [Math.cos(a) * headW * 0.34, cy + headH * 0.86, Math.sin(a) * headW * 0.34], headH * 0.07, headH * 0.05, 0xa8302a);
      }
      g.cone(headW * 0.07, headH * 0.3, 5, 0, cy + headH * 0.5, 0, sh2(GOLD, 1.1));
      break;
    }
    case 'futou': {
      // 判官幞头：幞头（前圆后高）+ 后垂两脚 + 展角 + 额带
      g.tube([[0, cy - headH * 0.06, 0], [0, cy + headH * 0.16, 0], [0, cy + headH * 0.3, -headW * 0.1]],
        [headW * 0.62, headW * 0.58, headW * 0.42], [headW * 0.62, headW * 0.54, headW * 0.4], 8, INK);
      for (const sx of [-1, 1]) {
        g.beam([sx * headW * 0.2, cy + headH * 0.28, -headW * 0.2], [sx * headW * 0.9, cy + headH * 0.22, -headW * 0.5], headH * 0.06, headH * 0.05, sh2(INK, 1.2));
        g.quadBoth([sx * headW * 0.5, cy - headH * 0.02, -headW * 0.3], [sx * headW * 0.56, cy - headH * 0.02, -headW * 0.42],
          [sx * headW * 0.6, cy - headH * 0.46, -headW * 0.46], [sx * headW * 0.52, cy - headH * 0.46, -headW * 0.34], INK);
      }
      g.cyl(headW * 0.66, headW * 0.66, headH * 0.08, 10, 0, cy - headH * 0.08, 0, sh2(INK, 1.35), 0, 0, 0, 1, false);
      break;
    }
    case 'ghost': {
      // 鬼王角冠：骷髅冠 + 双角（三节外撇）+ 三枚鬼面 + 四枚骨齿 + 额箍
      g.tube([[0, cy - headH * 0.1, 0], [0, cy + headH * 0.14, 0], [0, cy + headH * 0.28, 0]],
        [headW * 0.6, headW * 0.56, headW * 0.34], [headW * 0.6, headW * 0.5, headW * 0.28], 8, 0x2a2620);
      for (const sx of [-1, 1]) {
        const p0: P3 = [sx * headW * 0.42, cy + headH * 0.2, 0];
        const p1: P3 = [sx * headW * 0.78, cy + headH * 0.5, -headW * 0.1];
        const p2: P3 = [sx * headW * 0.66, cy + headH * 0.86, headW * 0.16];
        g.tube([p0, p1, p2], [headW * 0.1, headW * 0.08, headW * 0.02], [headW * 0.1, headW * 0.08, headW * 0.02], 4, 0xd8d0bc, 1, false, false);
      }
      for (let i = 0; i < 3; i++) g.box(headW * 0.22, headH * 0.16, headW * 0.08, (i - 1) * headW * 0.34, cy + headH * 0.06, headW * 0.5, sh2(0xc8bfa8, 1 - i * 0.06));
      for (let i = 0; i < 4; i++) g.cone(headW * 0.05, headH * 0.14, 4, (i - 1.5) * headW * 0.2, cy - headH * 0.14, headW * 0.56, 0xe8e0cc, Math.PI, 0, 0);
      g.cyl(headW * 0.62, headW * 0.62, headH * 0.07, 8, 0, cy - headH * 0.08, 0, sh2(GOLD, 0.6), 0, 0, 0, 1, false);
      break;
    }
    case 'child': {
      // 童子双髻：两枚圆髻 + 各自绛带 + 额箍 + 顶珠
      for (const sx of [-1, 1]) {
        g.tube([[sx * headW * 0.44, cy, 0], [sx * headW * 0.52, cy + headH * 0.2, 0], [sx * headW * 0.5, cy + headH * 0.34, 0]],
          [headW * 0.2, headW * 0.22, headW * 0.1], [headW * 0.2, headW * 0.22, headW * 0.1], 8, sh2(skin, 0.78));
        g.beam([sx * headW * 0.62, cy + headH * 0.26, 0], [sx * headW * 0.92, cy + headH * 0.06, -headW * 0.1], headH * 0.05, headH * 0.03, 0xa8302a);
        g.box(headW * 0.08, headH * 0.08, headW * 0.08, sx * headW * 0.5, cy + headH * 0.36, 0, GOLD);
      }
      g.cyl(headW * 0.64, headW * 0.64, headH * 0.09, 8, 0, cy - headH * 0.1, 0, 0xa8302a, 0, 0, 0, 1, false);
      break;
    }
    default:
      break;
  }
  void h;
}

// ============ 10 型持物 ============
// 面数：圭 46 / 如意 60 / 拂尘 120 / 剑 84 / 金刚杵 144 / 判官笔 60 / 生死簿 84 / 幡 120 / 钵 104 / 琵琶 156
function holdOf(g: VGeo, kind: HoldKind, h: number, at: P3, hex: number): void {
  const [hx, hy, hz] = at;
  const u = h * 0.01; // 1 单位 ≈ 1cm（h≈2.4m 时）
  switch (kind) {
    case 'gui': {
      // 玉圭：五棱柱 + 圭首斜面 + 两道云纹
      const p: P3[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        p.push([hx + Math.cos(a) * u * 3.4, hy, hz + Math.sin(a) * u * 1.1]);
      }
      const q: P3[] = p.map((v): P3 => [v[0], hy + u * 26, v[2]]);
      for (let i = 0; i < 5; i++) g.quad(p[i], p[(i + 1) % 5], q[(i + 1) % 5], q[i], JADE, 1, hx, hy + u * 12, hz);
      g.frus(u * 6.8, u * 2.2, u * 3, u * 1, u * 4, hx, hy + u * 28, hz, sh2(JADE, 1.04));
      for (let i = 0; i < 2; i++) g.box(u * 6, u * 0.8, u * 0.6, hx, hy + u * (9 + i * 6), hz + u * 1.2, sh2(GOLD, 0.8));
      break;
    }
    case 'ruyi': {
      // 如意：柄 + 云头（三叶）+ 柄尾
      g.beam([hx, hy, hz], [hx, hy + u * 3, hz + u * 20], u * 1.8, u * 1.6, 0x6a4a2a);
      g.beam([hx, hy, hz], [hx, hy - u * 3, hz - u * 9], u * 1.4, u * 1.3, 0x5a3e22);
      g.box(u * 6, u * 3.4, u * 4, hx, hy + u * 4, hz + u * 24, sh2(GOLD, 1.05));
      for (const sx of [-1, 1]) g.box(u * 3, u * 2.6, u * 3.4, hx + sx * u * 4.4, hy + u * 4.6, hz + u * 23, sh2(JADE, 1.02));
      g.cyl(u * 1.4, u * 1.6, u * 2, 6, hx, hy + u * 6.4, hz + u * 24, GOLD);
      break;
    }
    case 'fuchen': {
      // 拂尘：柄 + 犀角箍 + 七缕白丝
      g.beam([hx, hy - u * 12, hz], [hx, hy + u * 4, hz + u * 8], u * 1.7, u * 1.6, 0x6a4a2a);
      g.cyl(u * 2.4, u * 2.2, u * 3, 6, hx, hy + u * 6, hz + u * 9, sh2(GOLD, 0.9), 0, 0.4, 0);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        g.beam([hx, hy + u * 8, hz + u * 10], [hx + Math.cos(a) * u * 5, hy + u * 22, hz + u * (10 + Math.sin(a) * 4)], u * 0.7, u * 0.7, 0xe8e4dc);
      }
      break;
    }
    case 'sword': {
      // 宝剑：剑身（收锋）+ 脊 + 格 + 柄 + 首 + 双穗
      g.frus(u * 3, u * 0.9, u * 0.9, u * 0.4, u * 30, hx, hy + u * 30, hz + u * 2, 0xc8ccd4, 0, 0, 0);
      g.beam([hx, hy + u * 15, hz + u * 2], [hx, hy + u * 44, hz + u * 2], u * 0.5, u * 0.7, 0xa8aeb8);
      g.box(u * 9, u * 1.4, u * 2, hx, hy + u * 14, hz + u * 2, sh2(GOLD, 1.02));
      g.beam([hx, hy + u * 13, hz + u * 2], [hx, hy + u * 2, hz + u * 2], u * 1.6, u * 1.5, 0x4a2a1a);
      g.box(u * 3, u * 2, u * 3, hx, hy + u * 1, hz + u * 2, GOLD);
      for (const sx of [-1, 1]) g.beam([hx, hy + u * 1, hz + u * 2], [hx + sx * u * 4, hy - u * 10, hz + u * 3], u * 0.6, u * 0.6, 0xa8302a);
      break;
    }
    case 'vajra': {
      // 金刚杵：中股 + 两端莲座 + 各三股
      g.cyl(u * 3, u * 3, u * 16, 6, hx, hy + u * 12, hz + u * 2, sh2(GOLD, 0.9));
      for (const sy of [0, 1]) {
        const y = hy + u * (sy ? 21 : 3);
        g.cyl(u * 4.4, u * 3.4, u * 3, 6, hx, y, hz + u * 2, GOLD);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU;
          const dx = Math.cos(a) * u * 3.6, dz = Math.sin(a) * u * 3.6;
          g.beam([hx + dx, y, hz + u * 2 + dz], [hx + dx * 0.6, y + (sy ? u * 10 : -u * 10), hz + u * 2 + dz * 0.6], u * 1.2, u * 1.1, sh2(GOLD, 1.1));
        }
      }
      break;
    }
    case 'pen': {
      // 判官笔：笔杆 + 朱砂笔头 + 笔帽 + 系绳
      g.beam([hx, hy, hz], [hx, hy + u * 20, hz + u * 4], u * 1.5, u * 1.4, 0x4a2a1a);
      g.cone(u * 2.6, u * 7, 6, hx, hy + u * 24, hz + u * 4.6, 0x2a2028);
      g.cyl(u * 2.2, u * 2.4, u * 3, 6, hx, hy + u * 19, hz + u * 4, sh2(GOLD, 0.86));
      g.beam([hx, hy + u * 1, hz], [hx + u * 4, hy - u * 8, hz - u * 1], u * 0.5, u * 0.5, 0xa8302a);
      break;
    }
    case 'ledger': {
      // 生死簿：函套 + 三册 + 书脊 + 两道页缘 + 系带
      g.box(u * 16, u * 1.2, u * 11, hx, hy, hz + u * 6, 0x3a2a22);
      for (let i = 0; i < 3; i++) g.box(u * 14, u * 1.6, u * 9.4, hx, hy + u * (2 + i * 2), hz + u * 6, i === 1 ? 0xb8ac8c : 0xd8cdb0);
      g.box(u * 15, u * 7, u * 1.6, hx, hy + u * 4, hz + u * 1.4, 0x6a2a22);
      for (const sy of [2.4, 5.6]) g.box(u * 14.4, u * 0.5, u * 9.8, hx, hy + u * sy, hz + u * 6, sh2(JADE, 0.9));
      g.beam([hx, hy + u * 6, hz + u * 11], [hx + u * 6, hy + u * 1, hz + u * 12], u * 0.7, u * 0.5, 0xa8302a);
      break;
    }
    case 'banner': {
      // 幡：幡杆 + 顶饰 + 幡面（三折）+ 五缕流苏 + 横杆
      g.beam([hx, hy - u * 20, hz], [hx, hy + u * 46, hz], u * 1.5, u * 1.4, 0x5a3e22);
      g.box(u * 5, u * 4, u * 4, hx, hy + u * 48, hz, GOLD);
      g.beam([hx - u * 8, hy + u * 42, hz], [hx + u * 8, hy + u * 42, hz], u * 1.0, u * 1.0, sh2(GOLD, 0.8));
      const w = u * 7;
      for (let s = 0; s < 3; s++) {
        const y0 = hy + u * (42 - s * 12), y1 = hy + u * (32 - s * 12);
        const sw = w * (1 - s * 0.12);
        g.quadBoth([hx + u * 2, y0, hz], [hx + u * 2 + sw, y0, hz - u * 2], [hx + u * 2 + sw, y1, hz - u * 2], [hx + u * 2, y1, hz], s % 2 ? LAC_RED : 0xb8342a);
      }
      for (let i = 0; i < 5; i++) {
        g.beam([hx + u * (2 + i * 1.6), hy + u * 18, hz], [hx + u * (2 + i * 1.6), hy + u * 4, hz], u * 0.5, u * 0.4, sh2(GOLD, 0.9));
      }
      break;
    }
    case 'bowl': {
      // 钵：钵身 + 钵沿 + 净水 + 柳枝
      g.tube([[hx, hy + u * 6, hz], [hx, hy + u * 2, hz], [hx, hy - u * 3, hz]],
        [u * 7, u * 5.6, u * 2.4], [u * 7, u * 5.6, u * 2.4], 8, 0x8a6a3a, 1, false, true);
      g.cyl(u * 7.2, u * 7.2, u * 1.2, 10, hx, hy + u * 6.4, hz, sh2(GOLD, 0.82), 0, 0, 0, 1, false);
      g.cyl(u * 5.4, u * 5.4, u * 0.4, 8, hx, hy + u * 5.4, hz, 0x9ad8e8);
      g.beam([hx + u * 1, hy + u * 6, hz], [hx + u * 5, hy + u * 16, hz + u * 2], u * 0.6, u * 0.5, 0x4a7a3a);
      break;
    }
    case 'pipa': {
      // 琵琶：梨形音箱 + 面板 + 琴颈 + 四弦 + 四轴 + 弦马
      const body: P3[] = [];
      for (const t of [0, 1, 2, 3]) body.push([hx, hy + u * (4 + t * 5), hz + u * (6 - t * 0.4)]);
      g.tube(body, [u * 2, u * 7, u * 6.4, u * 3.4], [u * 1, u * 4.4, u * 4, u * 2], 8, 0x6a3a1a);
      g.cyl(u * 5.6, u * 5.6, u * 0.4, 8, hx, hy + u * 9, hz + u * 6, sh2(0xd8bc8a, 1.05), Math.PI / 2, 0, 0, 1, false);
      g.beam([hx, hy + u * 19, hz + u * 5], [hx, hy + u * 30, hz + u * 4], u * 1.6, u * 1.2, 0x4a2a12);
      for (let i = 0; i < 4; i++) {
        g.beam([hx + u * (i - 1.5) * 0.9, hy + u * 6, hz + u * 6.2], [hx + u * (i - 1.5) * 0.6, hy + u * 30, hz + u * 4.4], u * 0.22, u * 0.22, 0xe8e0c8);
        g.box(u * 1.6, u * 1.2, u * 0.8, hx + u * (i - 1.5) * 1.6, hy + u * (24 - i * 1.4), hz + u * 3.4, GOLD);
      }
      g.box(u * 5, u * 0.8, u * 0.8, hx, hy + u * 6.4, hz + u * 6.4, sh2(0x3a2010, 1.2));
      break;
    }
    default:
      break;
  }
  void hex;
}

// ============ 神像装配 ============
interface Halo { x: number; y: number; z: number; rx: number; ry: number; r: number; color: number; yaw: number }

/** 装配一尊像：返回三角面数（含座与背光实体，不含 glow 环） */
export function buildStatue(g: VGeo, s: StatueSpec, halos?: Halo[]): number {
  const h = s.h;
  const B = BUILDS[s.build ?? 'regular'];
  const seated = s.seated ?? true;
  const w0 = g.tris;
  const seatH = Math.max(0.42, Math.min(1.15, h * 0.3));
  const ry = s.ry ?? 0;
  void ry;

  // ---- 法座 ----
  const seatW = s.seatW ?? h * 0.7 * B.w;
  seatOf(g, s.seat ?? 'sumei', seatW, seatH, s.seat === 'lotus' ? 0x9aa2b4 : STONE);

  // ---- 伏兽（非人形像）：座上蹲兽，复用兽体放样，只换毛色 ----
  if (s.figure === false) {
    const coat = s.coat ?? [0x3a3038, 0xd8b45a];
    const beast = beastGeo('tiger', { lod: 0, thin: 0.8, hex: coat[0], accent: coat[1] });
    const sc = (seatW * 0.92) / 1.7;
    const mm = new THREE.Matrix4().compose(
      new THREE.Vector3(0, seatH, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
      new THREE.Vector3(sc, sc, sc),
    );
    beast.bake(mm);
    g.merge(beast);
    return g.tris - w0;
  }

  const yb = seatH;
  const headH = h * 0.15 * B.head;
  const headC = yb + h - headH * 0.92;
  const neckY = headC - headH * 0.6;
  const shY = neckY - headH * 0.34;
  const torH = h * (seated ? 0.32 : 0.28);
  const waistY = shY - torH;
  const hipY = seated ? yb + h * 0.26 : waistY * 0.88 + yb * 0.12;
  const hw = h * 0.15 * B.w;              // 半肩宽
  const dep = h * 0.1 * B.w;              // 半厚
  const headW = hw * 0.62;
  const robe = s.robe;
  const skin = s.skin;

  // ---- 下裳：前后两片（不是一整圈圆锥）+ 侧缝内衬 + 五道衣纹 ----
  const hemR = h * 0.26 * B.w;
  const waistR = h * 0.155 * B.w;
  const topY = seated ? yb + h * 0.3 : hipY;
  arcPanel(g, [
    { y: topY, r: waistR }, { y: (topY + yb) / 2, r: (waistR + hemR) * 0.55 }, { y: yb + h * 0.02, r: hemR },
  ], Math.PI / 2 - 1.16, Math.PI / 2 + 1.16, 6, robe);
  arcPanel(g, [
    { y: topY, r: waistR }, { y: (topY + yb) / 2, r: (waistR + hemR) * 0.55 }, { y: yb + h * 0.02, r: hemR },
  ], Math.PI / 2 + Math.PI - 1.16, Math.PI / 2 + Math.PI + 1.16, 6, sh2(robe, 0.9));
  arcPanel(g, [
    { y: topY, r: waistR }, { y: yb + h * 0.02, r: hemR },
  ], Math.PI / 2 - 1.16, Math.PI / 2 + 1.16, 6, sh2(robe, 0.7));
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i - 2) * 0.36;
    g.beam([Math.cos(a) * waistR * 0.98, topY, Math.sin(a) * waistR * 0.98],
      [Math.cos(a) * hemR * 1.02, yb + h * 0.015, Math.sin(a) * hemR * 1.02], h * 0.012, h * 0.012, sh2(robe, 1.14));
  }
  if (seated) {
    // 趺坐：交脚两膝 + 露足 + 裙裾垂座
    for (const sx of [-1, 1]) {
      g.box(h * 0.14, h * 0.09, h * 0.16, sx * h * 0.15, yb + h * 0.05, h * 0.1, sh2(robe, 1.06));
      g.box(h * 0.07, h * 0.04, h * 0.1, sx * h * 0.08, yb + h * 0.03, h * 0.17, skin);
    }
    g.box(h * 0.34, h * 0.04, h * 0.06, 0, yb + h * 0.02, h * 0.14, sh2(robe, 0.86));
  }

  // ---- 躯干：腰/胸/肩三段（截面收放）----
  g.tube([
    [0, waistY, 0], [0, waistY + torH * 0.34, 0], [0, waistY + torH * 0.72, 0], [0, shY, 0],
  ], [hw * 0.62, hw * 0.78, hw * 0.98, hw * 0.92], [dep * 0.7, dep * 0.9, dep, dep * 0.94], 8, robe);

  // ---- 宽袖（外张 0.35m）：袖筒 + 袖口箍 + 垂袖 ----
  const flare = h * 0.146;               // 0.35m @ h=2.4
  for (const sx of [-1, 1]) {
    const shp: P3 = [sx * hw * 0.92, shY - h * 0.02, 0];
    const cuff: P3 = [sx * (hw * 0.92 + flare), shY - h * 0.24, h * 0.03];
    g.tube([shp, [(shp[0] + cuff[0]) / 2, (shp[1] + cuff[1]) / 2 + h * 0.02, (shp[2] + cuff[2]) / 2], cuff],
      [h * 0.085, h * 0.1, h * 0.115], [h * 0.085, h * 0.1, h * 0.115], 6, robe, 1, true, false);
    g.cyl(h * 0.12, h * 0.12, h * 0.03, 6, cuff[0], cuff[1], cuff[2], sh2(robe, 1.16), 0, 0, sx * 0.5, 1, false);
    g.quadBoth([cuff[0] - sx * h * 0.08, cuff[1], cuff[2]], [cuff[0] + sx * h * 0.08, cuff[1], cuff[2]],
      [cuff[0] + sx * h * 0.06, cuff[1] - h * 0.16, cuff[2] - h * 0.02], [cuff[0] - sx * h * 0.1, cuff[1] - h * 0.16, cuff[2] - h * 0.02], sh2(robe, 0.94));
    // 臂：上臂 + 前臂（袖内）
    const el: P3 = [sx * (hw * 1.02 + flare * 0.4), shY - h * 0.18, h * 0.02];
    // 右臂略抬（持物手位），左臂下垂合于腹前
    const hnd: P3 = sx > 0
      ? [hw * 0.34, waistY + h * 0.14, h * 0.15]
      : [hw * 0.2, waistY + h * 0.04, h * 0.16];
    g.beam(shp, el, h * 0.05, h * 0.05, skin);
    g.beam(el, hnd, h * 0.042, h * 0.042, skin);
    g.box(h * 0.052, h * 0.03, h * 0.07, hnd[0], hnd[1], hnd[2], sh2(skin, 1.04));
  }

  // ---- 腰带 + 带钩 + 双佩 ----
  g.cyl(waistR * 1.02, waistR * 1.06, h * 0.05, 10, 0, waistY + h * 0.02, 0, sh2(robe, 0.62), 0, 0, 0, 1, false);
  g.box(h * 0.05, h * 0.04, h * 0.02, 0, waistY + h * 0.02, waistR * 1.02, GOLD);
  for (const sx of [-1, 1]) g.box(h * 0.03, h * 0.09, h * 0.02, sx * h * 0.07, waistY - h * 0.02, waistR * 0.96, JADE);

  // ---- 披帛：两道斜挂织物条（前后各一，交叉于胸前）----
  for (const sx of [-1, 1]) {
    const a: P3 = [sx * hw * 0.9, shY - h * 0.01, dep * 0.5];
    const b: P3 = [sx * hw * 0.2, waistY + torH * 0.3, dep * 1.05];
    const c2: P3 = [-sx * hw * 0.5, waistY - h * 0.01, dep * 0.9];
    g.quadBoth(a, [a[0] - sx * h * 0.03, a[1] - h * 0.01, a[2] + h * 0.02], b, [b[0] - sx * h * 0.03, b[1], b[2] - h * 0.01], sh2(robe, 1.24));
    g.quadBoth(b, c2, [c2[0] + h * 0.02, c2[1] - h * 0.12, c2[2] - h * 0.06], [b[0] + h * 0.02, b[1] - h * 0.14, b[2] - h * 0.04], sh2(robe, 1.16));
  }
  // 胸前璎珞两道金线
  for (let i = 0; i < 2; i++) g.box(hw * 1.3 - i * h * 0.05, h * 0.012, dep * 0.3, 0, waistY + torH * (0.5 + i * 0.16), dep * 0.92, sh2(GOLD, 0.86 - i * 0.12));

  // ---- 头：颅 + 面 + 耳 + 眉 + 目 + 鼻 + 唇 ----
  const faceZ = headW * 0.96;
  g.tube([[0, neckY - headH * 0.1, 0], [0, headC - headH * 0.3, 0], [0, headC + headH * 0.24, 0], [0, headC + headH * 0.44, 0]],
    [headW * 0.42, headW * 0.94, headW * 0.9, headW * 0.62], [headW * 0.36, headW * 0.86, headW * 0.88, headW * 0.5], 8, skin);
  g.frus(headW * 1.5, headW * 0.5, headW * 1.2, headW * 0.34, headH * 0.42, 0, headC - headH * 0.12, faceZ * 0.42, sh2(skin, 1.05));
  for (const sx of [-1, 1]) {
    g.box(headW * 0.16, headH * 0.34, headW * 0.2, sx * headW * 0.86, headC - headH * 0.04, 0, sh2(skin, 0.9));
    g.box(headW * 0.44, headH * 0.06, headW * 0.1, sx * headW * 0.34, headC + headH * 0.2, faceZ * 0.66, sh2(skin, 0.72));
    g.quadBoth([sx * headW * 0.14, headC + headH * 0.1, faceZ * 0.78], [sx * headW * 0.5, headC + headH * 0.1, faceZ * 0.7],
      [sx * headW * 0.5, headC + headH * 0.02, faceZ * 0.7], [sx * headW * 0.14, headC + headH * 0.02, faceZ * 0.78], 0x1c1a1c);
    g.box(headW * 0.1, headH * 0.06, headW * 0.06, sx * headW * 0.72, headC - headH * 0.24, faceZ * 0.62, sh2(skin, 1.08));
  }
  g.frus(headW * 0.24, headW * 0.3, headW * 0.16, headW * 0.2, headH * 0.24, 0, headC - headH * 0.14, faceZ * 0.72, sh2(skin, 1.1));
  g.box(headW * 0.44, headH * 0.07, headW * 0.1, 0, headC - headH * 0.36, faceZ * 0.64, 0x9a3a30);
  // 颈
  g.cyl(headW * 0.3, headW * 0.34, headH * 0.5, 6, 0, neckY + headH * 0.1, 0, sh2(skin, 0.94));

  // ---- 冠 ----
  crownOf(g, normCrown(s.crown), h, headH, headC, headW, skin);

  // ---- 持物（右手位）----
  const holdAt: P3 = [hw * 0.36, waistY + h * 0.16, dep * 1.5];
  holdOf(g, normHold(s.hold), h, holdAt, robe);

  // ---- 身光（火焰形，实体 lacquer+metal，不是整片 glow）+ 背屏 ----
  const hz = -h * 0.14;
  for (let i = 0; i < 12; i++) {
    const a = -0.9 + (i / 11) * 1.8;
    const bx = Math.sin(a) * h * 0.3;
    const by = headC - headH * 0.1 + Math.cos(a) * h * 0.28;
    const tip: P3 = [bx * 1.55, by + Math.cos(a) * h * 0.1, hz - h * 0.02];
    g.quadBoth([bx - h * 0.022, by, hz], [bx + h * 0.022, by, hz], tip, [bx, by + h * 0.02, hz], i % 2 ? sh2(GOLD, 0.9) : LAC_RED);
  }
  if (s.back) {
    g.frus(h * 0.42, 0.1, h * 0.3, 0.08, h * 0.5, 0, yb + h * 0.55, hz - h * 0.03, LAC_RED);
    for (const sx of [-1, 1]) g.beam([sx * h * 0.16, yb + h * 0.3, hz - h * 0.03], [sx * h * 0.24, yb + h * 0.86, hz - h * 0.03], h * 0.02, h * 0.016, GOLD_D);
    g.box(h * 0.1, h * 0.08, 0.05, 0, yb + h * 0.92, hz - h * 0.03, GOLD);
  }

  // ---- 头光（glow 环，交给人手实例池；面积小：细环而非光板）----
  if (s.halo && halos) {
    halos.push({
      x: 0, y: headC, z: hz - h * 0.02,
      rx: headH * 1.42, ry: headH * 1.42, r: 0.028 + headH * 0.02,
      color: typeof s.halo === 'number' ? s.halo : 0xffd25e, yaw: 0,
    });
    if (s.back) halos.push({ x: 0, y: yb + h * 0.55, z: hz - h * 0.05, rx: h * 0.34, ry: h * 0.4, r: 0.02 + h * 0.008, color: 0xffb300, yaw: 0 });
  }
  return g.tris - w0;
}

// ============ 名册：谁戴什么冠、持什么、坐什么（35 尊两两不同）============
interface Look {
  crown: CrownKind; hold: HoldKind; seat: SeatKind; build: BuildKind;
  seated: boolean; back?: boolean;
  /** false = 不是人形像（哮天犬立碑兽，避免「一个模子」） */
  figure?: boolean;
  /** 犬像毛色（只对 figure=false 生效） */
  coat?: [number, number];
}
const LOOK: Record<string, Look> = {
  孙悟空: { crown: 'child', hold: 'vajra', seat: 'cloud', build: 'child', seated: false },
  牛魔王: { crown: 'ghost', hold: 'vajra', seat: 'tiger', build: 'giant', seated: false },
  蛟魔王: { crown: 'ghost', hold: 'banner', seat: 'cloud', build: 'tall', seated: false },
  鹏魔王: { crown: 'ghost', hold: 'sword', seat: 'cloud', build: 'lean', seated: false },
  狮驼王: { crown: 'ghost', hold: 'vajra', seat: 'tiger', build: 'tall', seated: false },
  猕猴王: { crown: 'child', hold: 'vajra', seat: 'cloud', build: 'lean', seated: false },
  禺狨王: { crown: 'child', hold: 'vajra', seat: 'cloud', build: 'regular', seated: false },
  // 玉皇：冕旒 + 玉圭 + 须弥座（冕旒 360 + 麒麟座 232 会破 1400 上限；麒麟座归二郎）
  玉皇大帝: { crown: 'mianliu', hold: 'gui', seat: 'sumei', build: 'regular', seated: true, back: true },
  王母娘娘: { crown: 'lotus', hold: 'bowl', seat: 'lotus', build: 'fat', seated: true, back: true },
  太上老君: { crown: 'dao', hold: 'fuchen', seat: 'cloud', build: 'old', seated: true },
  太白金星: { crown: 'dao', hold: 'gui', seat: 'cloud', build: 'old', seated: true },
  托塔李天王: { crown: 'helmet', hold: 'vajra', seat: 'sumei', build: 'regular', seated: false },
  哪吒三太子: { crown: 'child', hold: 'banner', seat: 'lotus', build: 'child', seated: false },
  二郎神杨戬: { crown: 'helmet', hold: 'sword', seat: 'qilin', build: 'tall', seated: false },
  哮天犬: { crown: 'none', hold: 'none', seat: 'sumei', build: 'lean', seated: false, figure: false, coat: [0x3a3038, 0xd8b45a] },
  巨灵神: { crown: 'helmet', hold: 'sword', seat: 'sumei', build: 'giant', seated: false },
  持国天王: { crown: 'helmet', hold: 'pipa', seat: 'sumei', build: 'regular', seated: false },
  增长天王: { crown: 'helmet', hold: 'sword', seat: 'sumei', build: 'regular', seated: false },
  广目天王: { crown: 'helmet', hold: 'banner', seat: 'sumei', build: 'regular', seated: false },
  多闻天王: { crown: 'helmet', hold: 'banner', seat: 'sumei', build: 'fat', seated: false },
  王灵官: { crown: 'helmet', hold: 'sword', seat: 'tiger', build: 'regular', seated: false },
  雷公: { crown: 'helmet', hold: 'vajra', seat: 'cloud', build: 'regular', seated: false },
  电母: { crown: 'lotus', hold: 'ruyi', seat: 'cloud', build: 'regular', seated: false },
  风伯: { crown: 'dao', hold: 'fuchen', seat: 'cloud', build: 'lean', seated: false },
  雨师: { crown: 'dao', hold: 'bowl', seat: 'cloud', build: 'lean', seated: false },
  赤脚大仙: { crown: 'dao', hold: 'ruyi', seat: 'cloud', build: 'old', seated: false },
  如来佛祖: { crown: 'buddha', hold: 'bowl', seat: 'lotus', build: 'regular', seated: true, back: true },
  观音菩萨: { crown: 'buddha', hold: 'bowl', seat: 'lotus', build: 'lean', seated: true, back: true },
  嫦娥仙子: { crown: 'lotus', hold: 'ruyi', seat: 'cloud', build: 'lean', seated: true },
  '七仙女·红衣': { crown: 'lotus', hold: 'banner', seat: 'lotus', build: 'lean', seated: true },
  '七仙女·青衣': { crown: 'lotus', hold: 'bowl', seat: 'lotus', build: 'lean', seated: true },
  '七仙女·素衣': { crown: 'child', hold: 'ruyi', seat: 'cloud', build: 'lean', seated: true },
  '仙官·甲': { crown: 'futou', hold: 'gui', seat: 'sumei', build: 'regular', seated: false },
  '仙官·乙': { crown: 'futou', hold: 'pen', seat: 'sumei', build: 'regular', seated: false },
  '仙官·丙': { crown: 'futou', hold: 'ledger', seat: 'sumei', build: 'regular', seated: false },
};

const HAT_CROWN: Record<number, CrownKind> = { 0: 'ghost', 1: 'helmet', 2: 'ghost', 3: 'child' };
const PROP_HOLD: Record<string, HoldKind> = {
  staff: 'vajra', axe: 'vajra', spear: 'banner', blade: 'sword', fan: 'fuchen', goldRing: 'vajra',
  plank: 'gui', hammer: 'vajra', bucket: 'bowl', basket: 'bowl',
};

export function lookOf(d: { name: string; hat: number; prop: string | null; buddha?: boolean }): Look {
  const hit = LOOK[d.name];
  if (hit) return hit;
  return {
    crown: d.buddha ? 'buddha' : (HAT_CROWN[d.hat] ?? 'dao'),
    hold: d.prop ? (PROP_HOLD[d.prop] ?? 'none') : 'none',
    seat: d.buddha ? 'lotus' : 'sumei',
    build: 'regular',
    seated: !!d.buddha,
  };
}

/** 名册 → StatueSpec（入参与 architecture.deity 同名同义） */
export function statueSpec(d: DeityDef, x: number, y: number, z: number, ry: number): StatueSpec {
  const lk = lookOf(d);
  return {
    x, y, z, ry,
    h: 2.15 * Math.max(0.82, Math.min(1.5, d.scale)),
    seated: lk.seated, robe: d.cloth, skin: d.skin ?? 0xc9a13a,
    crown: lk.crown, hold: lk.hold, seat: lk.seat, build: lk.build,
    halo: d.halo ? 0xffd25e : 0,
    back: lk.back,
    figure: lk.figure,
    coat: lk.coat,
  };
}

// ============ 天宫神道落位（弧形，避开殿堂中心与台沿望柱）============
interface Ring { x: number; y: number; z: number; r: number; a0: number; a1: number }

/** 单尊石像的落位账（探针读点）：world 坐标 + 所依据的弧参数（缩放前口径）。 */
export interface ShrineSpot {
  name: string; home: string; ring: string;
  x: number; y: number; z: number;
  cx: number; cz: number; r: number; ringY: number;
}
/** 缩放前的弧参数原表；palace/court 与 arena 的修正见下方 RING 覆写（W5）。 */
const RING_PRESCALE: Record<string, Ring> = {
  // 角坐标：0=+x（东），π/2=+z；殿前在 −z（神道自城门 −85 方向进），故 palace/court 弧取负角
  palace: { x: 0, y: 214.12, z: 95, r: 30, a0: -2.5, a1: -1.0 },
  court: { x: 0, y: 214.12, z: 74, r: 14, a0: -2.35, a1: -1.15 },
  arena: { x: 0, y: 206.12, z: 0, r: 40, a0: 0.79, a1: 0.79 },
  arenaW: { x: 0, y: 206.12, z: 0, r: 40, a0: 3.05, a1: 3.65 },
  arenaE: { x: 0, y: 206.12, z: 0, r: 40, a0: -0.12, a1: 0.52 },
  arenaN: { x: 0, y: 206.12, z: 0, r: 40, a0: -1.85, a1: -1.28 },
  arenaS: { x: 0, y: 206.12, z: 0, r: 40, a0: 1.28, a1: 1.85 },
  furnace: { x: -120, y: 208.12, z: -20, r: 9.5, a0: 0.8, a1: 1.6 },
  lotus: { x: 120, y: 206.12, z: 120, r: 7, a0: 1.2, a1: 1.2 },
  lotus2: { x: 152, y: 205.12, z: 142, r: 7, a0: 1.2, a1: 1.2 },
  moon: { x: 40, y: 209.12, z: -55, r: 8, a0: 1.2, a1: 1.2 },
  pantao: { x: -150, y: 201.12, z: 45, r: 17, a0: 1.0, a1: 1.9 },
  high: { x: 0, y: 214.12, z: 20, r: 8.5, a0: 0, a1: TAU },
  gate: { x: 0, y: 203.12, z: -85, r: 22, a0: 0.62, a1: 2.52 },
};

/**
 * 世界口径 → 缩放前口径：RING 存的是「缩放前」数，落位时统一 x/z/r ×2.2、y 走 heavenY。
 * W5 修正两处布局冲突（scaleHeavenGeometry 把 x/z 也放大 2.2× 后暴露）：
 *  · palace/court：W48 把凌霄殿台基二次放大 2.7273×（南缘推到世界 z≈136.4），原弧位缩放后
 *    落在台基体内。改到前庭外缘世界 x=±52.8 的左右两列（z=100/110/120/130），弧心取外侧
 *    ±250、R=197.2 —— 台面上是一列近直的石像生，半径仍由 RING.r 判定。
 *  · arena：12 座光柱正好落在缩放后 r=88 的圆周上，神像半径内收到 83.6 避开。
 */
const RING: Record<string, Ring> = {
  ...RING_PRESCALE,
  arena: { ...RING_PRESCALE.arena, r: 38 },
  arenaW: { ...RING_PRESCALE.arenaW, r: 38 },
  arenaE: { ...RING_PRESCALE.arenaE, r: 38 },
  arenaN: { ...RING_PRESCALE.arenaN, r: 38 },
  arenaS: { ...RING_PRESCALE.arenaS, r: 38 },
  palaceE: { x: 250 / HEAVEN_SCALE, y: 214.12, z: 115 / HEAVEN_SCALE, r: 197.2 / HEAVEN_SCALE, a0: 3.0655, a1: 3.2177 },
  palaceW: { x: -250 / HEAVEN_SCALE, y: 214.12, z: 115 / HEAVEN_SCALE, r: 197.2 / HEAVEN_SCALE, a0: 0.0761, a1: -0.0761 },
  palace: { x: 250 / HEAVEN_SCALE, y: 214.12, z: 115 / HEAVEN_SCALE, r: 197.2 / HEAVEN_SCALE, a0: 3.0655, a1: 3.2177 },
  court: { x: -250 / HEAVEN_SCALE, y: 214.12, z: 115 / HEAVEN_SCALE, r: 197.2 / HEAVEN_SCALE, a0: 0.0761, a1: -0.0761 },
};

/** 名册 → 弧位：palace/court 的 5+3 尊分到前庭左右两列（其余用 home 原键）。 */
const RING_KEY: Record<string, string> = {
  '玉皇大帝': 'palaceE', '王母娘娘': 'palaceE', '太白金星': 'palaceE', '仙官·甲': 'palaceE',
  '王灵官': 'palaceW', '赤脚大仙': 'palaceW', '仙官·乙': 'palaceW', '仙官·丙': 'palaceW',
};

// ============ 神佛驻场：日常小剧场 ============
export class DeityStage {
  map = new Map<string, import('../actors/types').Actor>();
  private erlangDog: { a: import('../actors/types').Actor; center: THREE.Vector3 } | null = null;
  private ringT = 0;
  /** 35 尊石像合并为一张网格（1 个 draw call）；头光走细环实例池 */
  private shrine: THREE.Mesh | null = null;
  private halos: BeastPool | null = null;

  constructor(private crowd: Crowd, centers: SkyCenters, rng: RNG, private vfx: Vfx) {
    DEITIES.forEach((d, i) => {
      const c = centers[d.home as keyof SkyCenters] ?? centers.arena;
      const ring = d.home === 'court' ? 0 : 2.2 + (i % 5) * 0.8;
      const ang = i * 2.1;
      const pos = c.clone().add(new THREE.Vector3(Math.cos(ang) * ring, 0, Math.sin(ang) * ring + (d.home === 'court' ? Math.floor(i / 2) * 3.4 - 3 : 0)));
      const a = crowd.spawnActor({
        occ: 'customer', pos, yaw: Math.atan2(c.x - pos.x, c.z - pos.z),
        scale: d.scale, hat: d.hat, prop: d.prop, halo: d.halo, sky: true, freeze: true,
        cloth: d.cloth, pants: d.pants, skin: d.skin,
        action: d.daily, doing: `${d.title}·${d.name}：${d.desc}`,
        data: { name: d.name, nick: d.title, group: (d as { buddha?: boolean }).buddha ? 'buddha' : 'deity', weapon: d.weapon, desc: d.desc, code: 'dy_' + d.name },
      });
      a.pos.y = pos.y;
      this.map.set(d.name, a);
      crowd.heroes.push(a);
    });
    // 官员班列位置
    const court = centers.court;
    const officials = ['仙官·甲', '仙官·乙', '仙官·丙'];
    officials.forEach((n, i) => {
      const a = this.map.get(n)!;
      a.pos.set(court.x + (i - 1) * 3, court.y, court.z + Math.floor(i) * 3.4 - 2);
    });
    // 七仙女定位于桃树
    const pt = centers.pantao;
    const fairies = ['七仙女·红衣', '七仙女·青衣', '七仙女·素衣'];
    fairies.forEach((n, i) => {
      const a = this.map.get(n)!;
      if (i < 2) {
        const ang = i * 3.1 + 0.3;
        a.pos.set(pt.x + Math.cos(ang) * 15, pt.y, pt.z + Math.sin(ang) * 11);
      } else {
        a.pos.set(pt.x, pt.y, pt.z + 4);
        a.action = 'spinDance';
      }
      a.yaw = Math.atan2(pt.x - a.pos.x, pt.z - a.pos.z) + Math.PI;
    });
    this.erlangDog = { a: this.map.get('哮天犬')!, center: centers.arenaS.clone() };
    this.buildShrines();
    void rng;
  }

  /** 35 尊按环落位：同一环的神均分该弧（角度由名册顺序决定，确定性） */
  private buildShrines(): void {
    const ps = this.crowd.poolSet();
    if (!ps) return;
    const g = new VGeo();
    const halos: Halo[] = [];
    const total = new Map<string, number>();
    for (const d of DEITIES) { const k = RING_KEY[d.name] ?? d.home; total.set(k, (total.get(k) ?? 0) + 1); }
    const seen = new Map<string, number>();
    const spots: ShrineSpot[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const d of DEITIES) {
      // 石像/头光不走 scaleHeavenGeometry（运行期自建网格），RING 又全是缩放前的天宫坐标，
      // 故用 heavenY/heavenPoint 同一套换算：y=heavenY(y)、x/z/r 同乘 HEAVEN_SCALE。
      const key = RING_KEY[d.name] ?? d.home;
      const base = RING[key] ?? RING.arena;
      const ring = { ...base, y: heavenY(base.y) };
      // ring.y 已在上面的构造里走 heavenY（世界口径），不再二次抬升
      const n = total.get(key) ?? 1;
      const i = seen.get(key) ?? 0;
      seen.set(key, i + 1);
      const full = ring.a1 - ring.a0 > Math.PI * 1.99;
      const a = ring.a0 + (ring.a1 - ring.a0) * (full ? i / n : (n === 1 ? 0.5 : i / (n - 1)));
      const px0 = ring.x + Math.cos(a) * ring.r;
      const pz0 = ring.z + Math.sin(a) * ring.r;
      const ry = Math.atan2(px0 - ring.x, pz0 - ring.z);   // 朝外：来人自殿前/台外看见面部
      const px = px0 * HEAVEN_SCALE, pz = pz0 * HEAVEN_SCALE;
      const spec = statueSpec(d, px, ring.y, pz, ry);
      spots.push({ name: d.name, home: d.home, ring: key, x: px, y: ring.y, z: pz, cx: ring.x, cz: ring.z, r: ring.r, ringY: base.y });
      const one = new VGeo();
      const hs: Halo[] = [];
      buildStatue(one, spec, hs);
      e.set(0, ry, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(px, ring.y, pz), q, new THREE.Vector3(1, 1, 1));
      one.bake(m);
      g.merge(one);
      // 头光在局部系里给出，随石像一起落位
      const v = new THREE.Vector3();
      for (const hl of hs) {
        v.set(hl.x, hl.y, hl.z).applyMatrix4(m);
        halos.push({ x: v.x, y: v.y, z: v.z, rx: hl.rx, ry: hl.ry, r: hl.r, color: hl.color, yaw: ry });
      }
    }
    // 石像：W12_MAT（顶点色）+ 全 35 尊合并成 1 张网格 → 1 个 draw call
    const glowMat = ps.get('halo').mesh.material as THREE.Material;
    this.shrine = new THREE.Mesh(g.geo(), W12_MAT);
    this.shrine.name = 'sky_pantheon';
    this.shrine.castShadow = true;
    this.shrine.frustumCulled = false;
    ps.scene.add(this.shrine);
    this.shrine.userData.statues = spots;
    // 头光：细环（TorusGeometry 半径 1、管径 0.032 → 面积约 0.1m²/尊），小面积 glow
    const haloGeo = new THREE.TorusGeometry(1, 0.032, 3, 18);
    this.halos = new BeastPool(ps.scene, haloGeo, glowMat, 96, 'sky_halo');
    this.halos.mesh.castShadow = false;
    const base = this.halos.alloc(halos.length);
    for (let i = 0; i < halos.length; i++) {
      const hl = halos[i];
      e.set(0, hl.yaw, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(hl.x, hl.y, hl.z), q, new THREE.Vector3(hl.rx, hl.ry, 1));
      this.halos.set(base + i, m, new THREE.Color(hl.color));
    }
    this.halos.flush();
  }

  update(t: number, dt: number): void {
    const moon = this.map.get('嫦娥仙子');
    if (moon) {
      moon.pos.x += 0; // 广寒台内环绕
      // 每帧复位必须用抬升后的台面（旧 209），否则嫦娥会被拉回人间上方 200m 的空中。
      const [mx, my, mz] = heavenPoint(40 + Math.cos(t * 0.5) * 6, 209.12, -55 + Math.sin(t * 0.5) * 6);
      moon.pos.set(mx, my, mz);
      moon.yaw += dt * 0.8;
    }
    // 哮天犬绕二郎神
    if (this.erlangDog) {
      const er = this.map.get('二郎神杨戬');
      const c = er ? er.pos : this.erlangDog.center;
      // 脚底取御道面（Actor 原点在脚底，补偿 0）；不跟二郎神的 y —— 他的脚底是台面
      // 206.12，比御道铺装顶低 0.14，且战斗幕会被 havoc 抬到空中。
      const dx = Math.cos(t * 1.4) * 7;
      const dz = Math.sin(t * 1.4) * 7;
      const onRoad = Math.abs((c.x + dx) / HEAVEN_SCALE) <= DOG_GROUND.halfX
        && Math.abs((c.z + dz) / HEAVEN_SCALE) <= DOG_GROUND.halfZ;
      this.erlangDog.a.pos.set(c.x + dx, heavenY(onRoad ? DOG_GROUND.roadY : DOG_GROUND.deckY), c.z + dz);
      this.erlangDog.a.yaw = t * 1.4 + Math.PI / 2;
    }
    // 观音莲波
    this.ringT -= dt;
    if (this.ringT <= 0) {
      this.ringT = 7;
      const gy = this.map.get('观音菩萨');
      if (gy) this.vfx.ring(gy.pos.clone().setY(gy.pos.y + 1.2), 0x9fe8ff, 10, 1.4);
    }
  }

  /** 台账/自检用：36 尊面数与冠持座分布（不参与渲染） */
  shrineReport(): { statues: number; tris: number; crowns: string[]; holds: string[]; seats: string[] } {
    const crowns = new Set<string>(), holds = new Set<string>(), seats = new Set<string>();
    let tris = 0;
    for (const d of DEITIES) {
      const lk = lookOf(d);
      crowns.add(lk.crown); holds.add(lk.hold); seats.add(lk.seat);
      const one = new VGeo();
      tris += buildStatue(one, statueSpec(d, 0, 0, 0, 0));
    }
    return { statues: DEITIES.length, tris, crowns: [...crowns], holds: [...holds], seats: [...seats] };
  }
}

/** 自检用：单尊像面数（含座与背光实体，不含 glow 细环）。编排者可在任意脚本里直接调 */
export function statueTris(spec: StatueSpec): number {
  return buildStatue(new VGeo(), spec);
}

/** 自检用：36 尊的冠/持/座矩阵，供台账与人工复核（不参与渲染） */
export function pantheonMatrix(): { name: string; crown: string; hold: string; seat: string; build: string; seated: boolean; tris: number }[] {
  return DEITIES.map((d) => {
    const lk = lookOf(d);
    return { name: d.name, crown: lk.crown, hold: lk.hold, seat: lk.seat, build: lk.build, seated: lk.seated, tris: statueTris(statueSpec(d, 0, 0, 0, 0)) };
  });
}
