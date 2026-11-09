// ============================================================================
// 三界造物 · 中国审美精细化部件库 · src/game/wishOrnament.ts
//
// R26：用户要求「对所有角色，无论人还是仙魔神佛、妖魔鬼怪、仙兽神兽妖兽魔兽等等，
// 全部进行模型优化，必须精细化、精致化、符合中国审美，符合传统神话传说、动画、
// 电影、电视剧、绘本中的优质形象」。
//
// 做法：直接复用 wishForge 的 Builder 三角汤原语，把冠冕 / 袍袖 / 玉带 / 披帛 /
// 莲台 / 头光 / 分叉鹿角 / 鲤须 / 鬃鬣 / 五趾爪 / 凤冠 / 翎眼 / 飞檐 / 斗拱 /
// 瓦垄 / 脊兽 / 槅扇 / 流苏 / 缠枝 等细节叠进**本体几何**，因此：
//   · 覆盖全部 10 个 archetype → 2320 件预设资产、全部角色一律生效；
//   · 零新增 Mesh / 零新增 draw call；
//   · children[0] 仍是本体，forgeBytes 确定性契约不变。
//
// 审美原则（与 roleDesign.ts 一致）：对称与留白、曲线优于直棱、朱青金为主、
// 低饱和矿物色、忌高饱和塑料感、国漫 / 工笔重彩的线条感。
// 纪律：纯确定性（整数 hash），禁止 Math.random；面数受 MAX_ORNAMENT_TRIS 硬约束，
//      保证单件 forge 结果 tris ≤ 20000 的既有测试断言不被打破。
// ============================================================================
// 只用 type-only import，避免与 wishForge 形成循环依赖（wishForge 会调用本模块）
import type { Builder, RGB, V3, WishSpec } from './wishForge';
import type { Stage } from './wishEvolution';
import { designFor, CN_PALETTE, type DesignDomain } from './roleDesign';

/** 本地 FNV-1a：与 wishForge / wishAgent 同款整数 hash，纯确定性 */
function hashText(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** 精细化装饰的面数硬预算：本体 + 阶位部件 + 装饰仍须 ≤ 20000 */
export const MAX_ORNAMENT_TRIS = 2600;

export interface OrnamentBounds { min: V3; max: V3 }

export interface OrnamentReport {
  parts: string[];
  trisBefore: number;
  trisAfter: number;
  added: number;
  domain: DesignDomain;
  palette: number[];
  budget: number;
}

function hexRGB(hex: number, k = 1): RGB {
  return {
    r: Math.min(1, ((hex >> 16) & 255) / 255 * k),
    g: Math.min(1, ((hex >> 8) & 255) / 255 * k),
    b: Math.min(1, (hex & 255) / 255 * k),
  };
}

/** 从 Builder 顶点数组求包围盒，让装饰按本体真实尺寸自适应摆放 */
export function builderBounds(b: Builder): OrnamentBounds {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const p = b.pos;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [-1, -1, -1], max: [1, 1, 1] };
  return { min, max };
}

/** 稳定伪随机（整数 hash，不触碰共享 RNG） */
function seq(seed: number): () => number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x85ebca6b) + 0x9e3779b9) >>> 0;
    x = (Math.imul(x ^ (x >>> 13), 0xc2b2ae35) + 0x7feb352d) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
}

/** 珠串 / 璎珞：沿水平环排小球，中国传统佩饰 */
function beads(b: Builder, cx: number, cy: number, cz: number, rx: number, rz: number, n: number, r: number, c: RGB): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.ellipsoid(cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz, r, r, r, 5, 3, c);
  }
}

/** 花瓣 / 放射背光：一圈锥体朝外或朝上 */
function petalRing(b: Builder, cx: number, cy: number, cz: number, r: number, h: number, n: number, c: RGB, up = true): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a), z = Math.sin(a);
    if (up) b.cone(cx + x * r, cy, cz + z * r, cx + x * (r + h * 0.35), cy + h, cz + z * (r + h * 0.35), r * 0.16, 5, c);
    else b.cone(cx + x * r, cy, cz + z * r, cx + x * (r + h), cy + h * 0.15, cz + z * (r + h), r * 0.14, 5, c);
  }
}

/** 飘带 / 披帛：分段起伏的窄片，曲线优于直棱 */
function ribbon(b: Builder, x: number, y: number, z: number, len: number, w: number, n: number, c: RGB, seed: number): void {
  const rnd = seq(seed);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const sway = Math.sin(t * Math.PI * 1.6 + seed % 6) * w * 1.6;
    b.box(x + sway, y - t * len, z + (rnd() - 0.5) * w * 0.6, w, len / n * 0.9, w * 0.16, c);
  }
}

/** 分叉鹿角：主干 + 两枝，龙 / 麒麟 / 仙兽共用 */
function antler(b: Builder, x: number, y: number, z: number, h: number, c: RGB, side: number): void {
  b.cone(x, y, z, x + side * h * 0.16, y + h, z - h * 0.1, h * 0.09, 6, c);
  for (let k = 1; k <= 2; k++) {
    const by = y + h * (0.42 + k * 0.2);
    b.cone(x + side * h * 0.05, by, z, x + side * h * (0.34 + k * 0.1), by + h * 0.24, z - h * 0.06, h * 0.05, 5, c);
  }
}

/** 中式冠冕：冠板 + 垂旒珠串 */
function crown(b: Builder, cx: number, top: number, cz: number, w: number, c: RGB, gold: RGB, tassels = 5): void {
  b.box(cx, top + w * 0.1, cz, w, w * 0.22, w * 0.7, c);
  b.box(cx, top + w * 0.24, cz, w * 1.06, w * 0.06, w * 0.76, gold);
  for (let i = 0; i < tassels; i++) {
    const x = cx + (i / (tassels - 1) - 0.5) * w * 0.8;
    for (let j = 0; j < 3; j++) b.ellipsoid(x, top - j * w * 0.13, cz + w * 0.36, w * 0.045, w * 0.045, w * 0.045, 4, 3, gold);
  }
}

/** 飞檐斗拱：四角起翘 + 层叠斗 + 瓦垄 + 脊兽 */
function roofDetail(b: Builder, cx: number, top: number, cz: number, w: number, d: number, c: RGB, gold: RGB): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(cx + sx * w * 0.46, top + w * 0.06, cz + sz * d * 0.46, w * 0.2, w * 0.06, d * 0.2, c);
    b.cone(cx + sx * w * 0.5, top + w * 0.07, cz + sz * d * 0.5,
      cx + sx * w * 0.58, top + w * 0.2, cz + sz * d * 0.58, w * 0.04, 5, gold);
    for (let k = 0; k < 2; k++) b.box(cx + sx * w * 0.42, top - w * (0.06 + k * 0.07), cz + sz * d * 0.42, w * 0.1, w * 0.05, d * 0.1, c);
  }
  for (let i = 0; i < 5; i++) {
    const x = cx + (i / 4 - 0.5) * w * 0.8;
    b.box(x, top + w * 0.02, cz, w * 0.035, w * 0.03, d * 0.86, gold);
  }
  for (let i = 0; i < 3; i++) b.cone(cx + (i - 1) * w * 0.24, top + w * 0.1, cz - d * 0.3, cx + (i - 1) * w * 0.24, top + w * 0.24, cz - d * 0.3, w * 0.05, 5, gold);
}

/**
 * 给本体叠加中国审美精细化部件。
 * 返回的 parts 会并入 forge 的语义部件清单，UI / 验收可读到「精细化」到底加了什么。
 */
export function addChineseOrnaments(b: Builder, spec: WishSpec, stage: Stage): OrnamentReport {
  const bounds = builderBounds(b);
  const { min, max } = bounds;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const w = Math.max(0.3, max[0] - min[0]), h = Math.max(0.3, max[1] - min[1]), d = Math.max(0.3, max[2] - min[2]);
  const top = max[1], bottom = min[1];
  const u = Math.min(w, h, d) * 0.5;      // 细节单位

  const domain = spec.archetype as DesignDomain;
  const design = designFor(domain, spec.name);
  const trad = Object.values(CN_PALETTE);
  const seed = hashText(spec.name + '|' + spec.archetype + '|' + stage);
  const rnd = seq(seed);
  const pickTrad = (i: number): number => trad[(Math.abs(seed + i * 7919) >>> 0) % trad.length];
  const gold = hexRGB(pickTrad(0), 1.05);
  const cinnabar = hexRGB(pickTrad(1), 0.95);
  const jade = hexRGB(pickTrad(2), 1.0);
  const ink = hexRGB(pickTrad(3), 0.8);
  const userMain = hexRGB(spec.colors[0] ?? design.palette[0] ?? 0xd4af37, 0.95);

  const density: Record<Stage, number> = { '卵': 0.28, '幼体': 0.55, '成体': 1, '灵体': 1.12, '神体': 1.25 };
  const k = density[stage] ?? 1;
  const parts: string[] = [];
  const start = b.tris;
  const budget = MAX_ORNAMENT_TRIS;
  /** 面数闸门：每加一组之前检查，绝不突破 20000 总预算 */
  const room = (need: number): boolean => (b.tris - start + need) <= budget;

  const add = (label: string, need: number, fn: () => void): void => {
    if (!room(need)) return;
    fn();
    parts.push(label);
  };

  switch (domain) {
    case 'dragon': {
      const headZ = cz + d * 0.42;
      add('分叉鹿角×2', 120, () => {
        antler(b, cx - w * 0.09, top - h * 0.02, headZ, h * 0.34 * k, gold, -1);
        antler(b, cx + w * 0.09, top - h * 0.02, headZ, h * 0.34 * k, gold, 1);
      });
      add('鲤须×2 / 鬃鬣', 180, () => {
        for (const s of [-1, 1]) {
          b.cone(cx + s * w * 0.1, cy + h * 0.12, headZ, cx + s * w * 0.3, cy + h * 0.02, headZ + d * 0.2, u * 0.05, 5, jade);
          for (let i = 0; i < 4; i++)
            b.cone(cx + s * w * 0.08, top - h * (0.08 + i * 0.06), headZ - d * (0.04 + i * 0.05),
              cx + s * w * 0.16, top - h * (0.02 + i * 0.06), headZ - d * (0.12 + i * 0.05), u * 0.08, 5, cinnabar);
        }
      });
      add('五趾爪尖', 160, () => {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const px = cx + sx * w * 0.3, pz = cz + sz * d * 0.24;
          for (let t = 0; t < 3; t++)
            b.cone(px, bottom + h * 0.05, pz, px + (t - 1) * u * 0.14, bottom - h * 0.02, pz + d * 0.05, u * 0.035, 4, gold);
        }
      });
      add('戏珠与祥云', 240, () => {
        b.ellipsoid(cx, top + h * 0.16, headZ + d * 0.16, u * 0.3, u * 0.3, u * 0.3, 8, 5, gold);
        for (let i = 0; i < 3; i++)
          b.ellipsoid(cx + (i - 1) * w * 0.32, bottom + h * 0.12, cz - d * 0.24, u * 0.5, u * 0.14, u * 0.28, 6, 3, jade);
      });
      add('鳞纹金带', 120, () => {
        for (let i = 0; i < 6; i++) b.box(cx, top - h * 0.06 - i * h * 0.05, cz - d * (0.3 - i * 0.08), w * 0.12, u * 0.05, d * 0.06, gold);
      });
      break;
    }
    case 'deity':
    case 'humanoid': {
      const divine = domain === 'deity';
      add(divine ? '冕旒 / 通天冠' : '巾帻 / 发髻', 200, () => {
        if (divine) crown(b, cx, top, cz, w * 0.7, ink, gold, 5);
        else {
          b.ellipsoid(cx, top + h * 0.04, cz, w * 0.2, h * 0.08, w * 0.2, 7, 4, ink);
          b.box(cx, top + h * 0.1, cz, w * 0.5, h * 0.04, w * 0.3, gold);
        }
      });
      add('交领右衽 / 宽袖', 180, () => {
        b.box(cx - w * 0.12, cy + h * 0.16, cz + d * 0.3, w * 0.2, h * 0.3, d * 0.05, cinnabar);
        for (const s of [-1, 1]) b.box(cx + s * w * 0.34, cy + h * 0.02, cz, w * 0.22, h * 0.28, d * 0.34, userMain);
      });
      add('玉带 / 佩玉', 160, () => {
        beads(b, cx, cy - h * 0.02, cz, w * 0.34, d * 0.28, 10, u * 0.055, gold);
        b.ellipsoid(cx + w * 0.3, cy - h * 0.16, cz + d * 0.2, u * 0.12, u * 0.16, u * 0.06, 6, 4, jade);
      });
      add('披帛飘带×2', 160, () => {
        ribbon(b, cx - w * 0.34, cy + h * 0.2, cz - d * 0.1, h * 0.7, u * 0.1, 5, jade, seed);
        ribbon(b, cx + w * 0.34, cy + h * 0.2, cz - d * 0.1, h * 0.7, u * 0.1, 5, cinnabar, seed + 17);
      });
      if (divine) {
        add('头光 / 背光', 200, () => {
          petalRing(b, cx, cy + h * 0.1, cz - d * 0.34, w * 0.4, u * 0.3, 12, gold, true);
          b.ellipsoid(cx, cy + h * 0.1, cz - d * 0.36, w * 0.42, h * 0.42, u * 0.06, 12, 4, gold);
        });
        add('莲台 / 法器', 220, () => {
          b.ellipsoid(cx, bottom - h * 0.04, cz, w * 0.5, h * 0.06, d * 0.5, 10, 3, jade);
          petalRing(b, cx, bottom, cz, w * 0.44, h * 0.14, 8, cinnabar, true);
          b.box(cx + w * 0.4, cy, cz + d * 0.2, w * 0.08, h * 0.34, d * 0.05, gold);
        });
      }
      break;
    }
    case 'spirit': {
      add('幽冥冠 / 素幡', 160, () => {
        crown(b, cx, top, cz, w * 0.6, ink, gold, 3);
        b.box(cx - w * 0.4, cy, cz, u * 0.05, h * 0.8, u * 0.05, ink);
        b.box(cx - w * 0.4, cy + h * 0.28, cz, w * 0.24, h * 0.3, u * 0.04, jade);
      });
      add('磷火 / 飘带', 200, () => {
        for (let i = 0; i < 3; i++) b.ellipsoid(cx + (i - 1) * w * 0.3, cy + h * 0.2, cz + d * 0.2, u * 0.12, u * 0.12, u * 0.12, 6, 4, gold);
        ribbon(b, cx + w * 0.3, cy + h * 0.2, cz - d * 0.1, h * 0.8, u * 0.1, 5, jade, seed);
      });
      break;
    }
    case 'beast': {
      add('双角 / 鬃鬣', 180, () => {
        antler(b, cx - w * 0.14, top, cz + d * 0.3, h * 0.22 * k, gold, -1);
        antler(b, cx + w * 0.14, top, cz + d * 0.3, h * 0.22 * k, gold, 1);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          b.cone(cx + Math.cos(a) * w * 0.18, cy + h * 0.18, cz + d * 0.26 + Math.sin(a) * d * 0.1,
            cx + Math.cos(a) * w * 0.3, cy + h * 0.34, cz + d * 0.26 + Math.sin(a) * d * 0.18, u * 0.07, 5, cinnabar);
        }
      });
      add('卷尾 / 火焰纹', 200, () => {
        for (let i = 0; i < 3; i++) b.ellipsoid(cx, cy + h * (0.05 + i * 0.12), cz - d * (0.4 + i * 0.08), u * (0.26 - i * 0.05), u * (0.26 - i * 0.05), u * 0.2, 6, 4, userMain);
        for (let i = 0; i < 4; i++) b.cone(cx + (i - 1.5) * w * 0.16, bottom, cz + d * 0.14, cx + (i - 1.5) * w * 0.16, cy + h * 0.1, cz + d * 0.2, u * 0.09, 5, gold);
      });
      add('铃铛 / 项饰', 120, () => { beads(b, cx, cy + h * 0.1, cz + d * 0.26, w * 0.24, d * 0.18, 8, u * 0.06, gold); });
      break;
    }
    case 'bird': {
      add('凤冠 / 翎眼', 160, () => {
        for (let i = 0; i < 3; i++) b.cone(cx + (i - 1) * w * 0.1, top, cz + d * 0.28, cx + (i - 1) * w * 0.14, top + h * 0.24, cz + d * 0.34, u * 0.05, 5, cinnabar);
        for (let i = 0; i < 5; i++) b.ellipsoid(cx + (i - 2) * w * 0.12, cy + h * 0.06, cz - d * 0.3, u * 0.1, u * 0.14, u * 0.05, 5, 3, jade);
      });
      add('翼羽分层 / 长尾翎', 240, () => {
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++)
          b.cone(cx + s * w * (0.2 + i * 0.06), cy + h * 0.05, cz, cx + s * w * (0.42 + i * 0.08), cy - h * 0.08, cz - d * 0.14, u * 0.09, 5, i % 2 ? gold : userMain);
        for (let i = 0; i < 3; i++) b.cone(cx + (i - 1) * w * 0.1, cy - h * 0.1, cz - d * 0.38, cx + (i - 1) * w * 0.22, cy - h * 0.3, cz - d * 0.7, u * 0.07, 5, jade);
      });
      break;
    }
    case 'building': {
      add('台基 / 栏杆', 160, () => {
        b.box(cx, bottom - h * 0.03, cz, w * 1.12, h * 0.06, d * 1.12, ink);
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++)
          b.box(cx + s * w * 0.52, bottom + h * 0.08, cz + (i / 3 - 0.5) * d * 0.9, u * 0.05, h * 0.14, u * 0.05, gold);
      });
      add('飞檐 / 斗拱 / 瓦垄 / 脊兽', 360, () => roofDetail(b, cx, top, cz, w, d, userMain, gold));
      add('槅扇 / 匾额', 200, () => {
        for (let i = 0; i < 3; i++) {
          b.box(cx + (i - 1) * w * 0.26, cy - h * 0.04, cz + d * 0.5, w * 0.2, h * 0.42, u * 0.04, ink);
          for (let j = 0; j < 3; j++) b.box(cx + (i - 1) * w * 0.26, cy - h * 0.04, cz + d * 0.52, w * 0.18, u * 0.035, u * 0.02, gold);
        }
        b.box(cx, cy + h * 0.3, cz + d * 0.52, w * 0.4, h * 0.12, u * 0.05, cinnabar);
        b.box(cx, cy + h * 0.3, cz + d * 0.54, w * 0.44, h * 0.015, u * 0.02, gold);
      });
      break;
    }
    case 'item': {
      add('底座 / 纹饰带', 160, () => {
        b.ellipsoid(cx, bottom - h * 0.03, cz, w * 0.42, h * 0.07, d * 0.42, 10, 3, ink);
        beads(b, cx, cy, cz, w * 0.34, d * 0.34, 10, u * 0.055, gold);
      });
      add('流苏 / 宝珠', 160, () => {
        for (let i = 0; i < 5; i++) b.cone(cx + (i - 2) * w * 0.14, cy - h * 0.24, cz + d * 0.2, cx + (i - 2) * w * 0.14, cy - h * 0.4, cz + d * 0.2, u * 0.045, 5, cinnabar);
        b.ellipsoid(cx, top + h * 0.1, cz, u * 0.2, u * 0.2, u * 0.2, 7, 4, gold);
      });
      break;
    }
    case 'vehicle': {
      add('帷盖 / 旗旄', 200, () => {
        b.box(cx, top + h * 0.06, cz, w * 1.05, h * 0.05, d * 0.85, cinnabar);
        for (const s of [-1, 1]) b.cone(cx + s * w * 0.48, top + h * 0.08, cz, cx + s * w * 0.6, top + h * 0.2, cz, u * 0.06, 5, gold);
        b.box(cx + w * 0.4, cy + h * 0.3, cz, u * 0.05, h * 0.6, u * 0.05, ink);
        b.box(cx + w * 0.4, cy + h * 0.48, cz + d * 0.08, w * 0.22, h * 0.2, u * 0.03, jade);
      });
      add('轮 / 璎珞', 200, () => {
        for (const s of [-1, 1]) beads(b, cx + s * w * 0.36, cy - h * 0.24, cz, u * 0.05, u * 0.3, 8, u * 0.05, gold);
        beads(b, cx, cy + h * 0.16, cz, w * 0.34, d * 0.34, 8, u * 0.05, jade);
      });
      break;
    }
    case 'plant': {
      add('缠枝 / 花苞', 200, () => {
        for (let i = 0; i < 3; i++) beads(b, cx, cy + h * (i * 0.16 - 0.1), cz, w * (0.24 + i * 0.06), d * (0.24 + i * 0.06), 7, u * 0.045, jade);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          b.cone(cx + Math.cos(a) * w * 0.14, top - h * 0.06, cz + Math.sin(a) * d * 0.14,
            cx + Math.cos(a) * w * 0.28, top + h * 0.1, cz + Math.sin(a) * d * 0.28, u * 0.08, 5, cinnabar);
        }
        b.ellipsoid(cx, top + h * 0.08, cz, u * 0.16, u * 0.16, u * 0.16, 6, 4, gold);
      });
      break;
    }
    default: {
      add('云纹 / 流苏', 120, () => { beads(b, cx, cy + h * 0.1, cz, w * 0.3, d * 0.3, 8, u * 0.05, gold); });
    }
  }

  // 所有 archetype 通用：一圈低饱和矿物色云纹，压住塑料感
  add('海水江崖 / 云雷纹', 120, () => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (rnd() - 0.5) * 0.2;
      b.box(cx + Math.cos(a) * w * 0.4, bottom + h * 0.06, cz + Math.sin(a) * d * 0.4, u * 0.12, u * 0.035, u * 0.12, i % 2 ? ink : jade);
    }
  });

  return {
    parts,
    trisBefore: start,
    trisAfter: b.tris,
    added: b.tris - start,
    domain,
    palette: [design.palette[0] ?? 0xd4af37, pickTrad(0), pickTrad(1), pickTrad(2)],
    budget,
  };
}
