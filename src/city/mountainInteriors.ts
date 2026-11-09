import { Baker } from './bake';
import type { BGroup } from './bake';

// ============ 山上建筑室内陈设（R24） ============
// 用户「所有山上的建筑，内部的物品、物体、家具、摆设、装饰、饰品、日常用品呢？？？」
// 旧实现：山顶主庙正殿 16×5×10m 是空壳，山林庙观六件只有外壳、塔/亭/牌坊/廊/经幢等
// 远景地标全是「光板几何」，没有任何可辨识的内部器物。本文件给出可复用的陈设库：
//
//   · 按建筑类型分「高 / 中 / 低」三档资产组合（高=主庙正殿全套礼佛/起居陈设，
//     中=厢房/山门/香亭/遥参亭/廊庑/主题标志建筑，低=16 组通用远景地标/石碣/冰纹窗等）；
//   · 一切随机只走整数坐标 hash（mh），零 Math.random / 零 rng.range / 零 rng.chance，
//     不消耗全工程共享的 RNG(20260905) 序列；
//   · 全部走 Baker 合批 b.box / b.cyl / b.kit，零新增材质组 / Mesh / 常驻 draw call；
//   · 每座建筑落位后打 b.kit 台账（mt.interior.*），运行期可在 world.assetAudit.detail 读，
//     真实计数、不硬编码。

/** 确定性整数 hash（0..1）：坐标/种子派生，零共享 RNG。 */
function mh(seed: number, k: number): number {
  let n = (Math.imul(seed | 0, 374761393) + Math.imul(k | 0, 668265263) + 0x51c3a7) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
/** 坐标 hash → 整数种子（建筑中心折算成小整数，避免浮点进 hash 丢精度）。 */
export function mtInteriorSeed(x: number, z: number): number {
  return (Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(z) | 0, 19349663) ^ 0x2f6b1d) | 0;
}

export type MtTier = 'high' | 'mid' | 'low';
/** 山上建筑类型：殿 / 厢房 / 门 / 廊 / 六件庙观 / 远景地标各件 / 主题件。 */
export type MtBuildingType =
  | 'mainHall' | 'sideRoom' | 'gate' | 'corridor' | 'moonTerrace'
  | 'incensePavilion' | 'yuanCanPavilion' | 'cliffGate' | 'iceWindow' | 'snowGallery' | 'stoneStele'
  | 'tower' | 'pavilion' | 'paifang' | 'plank' | 'carving' | 'steps' | 'sutraPillar' | 'mountainGate'
  | 'southGate' | 'dragonRidge' | 'hangingTemple' | 'shaolinGate' | 'snowSutra' | 'jadePool'
  | 'generic';

export interface MtInteriorOpts {
  type: MtBuildingType;
  /** 建筑中心与室内地坪上皮的世界坐标 */
  cx: number; cy: number; cz: number;
  /** 面阔(x) / 进深(z) / 净高 */
  w: number; d: number; h: number;
  /** 确定性种子（坐标 hash），用于分档 / 抖动 / 取件 */
  seed: number;
  /** 显式档位；不传则按类型 + hash 自动分档 */
  tier?: MtTier;
  /** 朝向：+1 表示门在 +z（南向），-1 表示门在 -z；影响供案/蒲团的前后关系 */
  front?: 1 | -1;
}

// ---- 器物调色（复用既有材质组语义，不新增组） ----
const G = {
  wood: 0x6b4a2b, woodD: 0x4a3220, lac: 0x5a231c, gold: 0xcaa02e,
  stone: 0x8f8b80, white: 0xd8cdb4, paper: 0xe6dcc2, fabric: 0xb9a08a,
  bronze: 0x8a6a3a, iron: 0x4a4030, clay: 0x955539, red: 0x9d2933,
  glow: 0xffcf7a, leaf: 0x3e5a34, cyan: 0xcfe6f2,
} as const;

type DrawFn = (b: Baker, x: number, y: number, z: number, s: number, ry: number) => void;

/**
 * 单件器物字典：24 类可辨识物件，覆盖「供器 / 家具 / 摆设 / 装饰 / 饰品 / 日常用品」。
 * 每件用 1~4 个 b.box/b.cyl 合批，尺寸均为人类尺度（0.1~3m）。
 */
const MT_ITEMS: Record<string, { n: string; draw: DrawFn }> = {
  // —— 礼佛供器 ——
  altar: { n: '供案', draw: (b, x, y, z, s) => {
    b.box('lacquer', 2.2 * s, 0.9 * s, 0.7 * s, x, y + 0.45 * s, z, G.lac);
    b.box('wood', 2.35 * s, 0.1 * s, 0.8 * s, x, y + 0.95 * s, z, G.gold);
  } },
  censer: { n: '香炉', draw: (b, x, y, z, s) => {
    b.cyl('metal', 0.36 * s, 0.42 * s, 0.34 * s, 10, x, y + 0.17 * s, z, G.bronze);
    b.cyl('metal', 0.42 * s, 0.40 * s, 0.08 * s, 10, x, y + 0.36 * s, z, G.iron);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.cyl('metal', 0.05 * s, 0.06 * s, 0.18 * s, 5, x + Math.cos(a) * 0.3 * s, y + 0.09 * s, z + Math.sin(a) * 0.3 * s, G.iron);
    }
  } },
  candle: { n: '烛台', draw: (b, x, y, z, s) => {
    b.cyl('lacquer', 0.05 * s, 0.09 * s, 0.5 * s, 6, x, y + 0.25 * s, z, G.red);
    b.cyl('glow', 0.05 * s, 0.05 * s, 0.16 * s, 5, x, y + 0.58 * s, z, G.glow);
  } },
  banner: { n: '幡幢', draw: (b, x, y, z, s, ry) => {
    b.cyl('wood', 0.04 * s, 0.04 * s, 2.6 * s, 5, x, y + 1.3 * s, z, G.woodD);
    b.box('fabric', 0.5 * s, 1.6 * s, 0.04 * s, x + 0.28 * s, y + 1.7 * s, z, G.gold, ry);
    b.box('fabric', 0.16 * s, 0.5 * s, 0.04 * s, x + 0.28 * s, y + 0.7 * s, z, G.red, ry);
  } },
  cushion: { n: '蒲团', draw: (b, x, y, z, s) => {
    b.cyl('fabric', 0.42 * s, 0.46 * s, 0.16 * s, 10, x, y + 0.08 * s, z, G.fabric);
  } },
  sutra: { n: '经卷', draw: (b, x, y, z, s) => {
    for (let k = 0; k < 3; k++) b.cyl('fabric', 0.09 * s, 0.09 * s, 0.5 * s, 6, x - 0.16 * s + k * 0.16 * s, y + 0.09 * s, z, G.paper, 0, 0, Math.PI / 2);
  } },
  vase: { n: '瓶花', draw: (b, x, y, z, s) => {
    b.cyl('ceramic', 0.16 * s, 0.22 * s, 0.5 * s, 8, x, y + 0.25 * s, z, G.white);
    b.cyl('leaf', 0.03 * s, 0.03 * s, 0.34 * s, 5, x, y + 0.66 * s, z, G.leaf);
    b.box('glow', 0.16 * s, 0.12 * s, 0.16 * s, x + 0.08 * s, y + 0.82 * s, z, G.red);
  } },
  screen: { n: '屏风', draw: (b, x, y, z, s, ry) => {
    b.box('lacquer', 2.4 * s, 2.0 * s, 0.09 * s, x, y + 1.0 * s, z, G.lac, ry);
    b.box('fabric', 2.1 * s, 1.7 * s, 0.04 * s, x, y + 1.0 * s, z + 0.06 * s, G.paper, ry);
    for (const u of [-1, 1]) b.box('wood', 0.1 * s, 2.1 * s, 0.14 * s, x + u * 1.2 * s, y + 1.05 * s, z, G.woodD, ry);
  } },
  coffer: { n: '藻井', draw: (b, x, y, z, s) => {
    b.box('wood', 3.2 * s, 0.14 * s, 3.2 * s, x, y, z, G.woodD);
    for (const u of [-1, 1]) for (const v of [-1, 1]) b.box('wood', 0.14 * s, 0.2 * s, 3.2 * s, x + u * 1.5 * s, y - 0.1 * s, z, G.gold);
    b.box('glow', 1.0 * s, 0.08 * s, 1.0 * s, x, y - 0.14 * s, z, G.gold);
    b.cyl('metal', 0.16 * s, 0.22 * s, 0.2 * s, 6, x, y - 0.3 * s, z, G.bronze);
  } },
  idol: { n: '神像', draw: (b, x, y, z, s) => {
    b.box('lacquer', 1.4 * s, 0.5 * s, 1.0 * s, x, y + 0.25 * s, z, G.gold);       // 莲座
    b.box('ash', 0.9 * s, 1.4 * s, 0.6 * s, x, y + 1.2 * s, z, G.white);          // 身
    b.cyl('ash', 0.28 * s, 0.32 * s, 0.45 * s, 8, x, y + 2.1 * s, z, G.white);    // 首
    b.box('glow', 0.5 * s, 0.5 * s, 0.06 * s, x, y + 2.15 * s, z + 0.3 * s, G.gold); // 背光
  } },
  plaque: { n: '匾额', draw: (b, x, y, z, s, ry) => {
    b.box('lacquer', 2.6 * s, 0.8 * s, 0.12 * s, x, y, z, G.lac, ry);
    b.box('glow', 2.3 * s, 0.55 * s, 0.04 * s, x, y, z + 0.08 * s, G.gold, ry);
  } },
  lantern: { n: '宫灯', draw: (b, x, y, z, s) => {
    b.cyl('wood', 0.03 * s, 0.03 * s, 0.5 * s, 4, x, y + 0.7 * s, z, G.woodD);
    b.box('glow', 0.34 * s, 0.46 * s, 0.34 * s, x, y + 0.3 * s, z, G.glow);
    b.box('wood', 0.4 * s, 0.08 * s, 0.4 * s, x, y + 0.56 * s, z, G.woodD);
    b.box('fabric', 0.06 * s, 0.24 * s, 0.06 * s, x, y - 0.05 * s, z, G.red);
  } },
  woodfish: { n: '木鱼', draw: (b, x, y, z, s) => {
    b.cyl('wood', 0.2 * s, 0.22 * s, 0.22 * s, 8, x, y + 0.11 * s, z, G.woodD);
  } },
  chime: { n: '磬', draw: (b, x, y, z, s) => {
    b.cyl('metal', 0.3 * s, 0.34 * s, 0.06 * s, 10, x, y + 0.6 * s, z, G.bronze, 0, Math.PI / 2);
    for (const u of [-1, 1]) b.cyl('wood', 0.03 * s, 0.03 * s, 0.6 * s, 4, x + u * 0.35 * s, y + 0.3 * s, z, G.woodD);
  } },
  bowl: { n: '净水钵', draw: (b, x, y, z, s) => {
    b.cyl('ceramic', 0.24 * s, 0.3 * s, 0.18 * s, 10, x, y + 0.09 * s, z, G.white);
    b.cyl('water', 0.22 * s, 0.22 * s, 0.02 * s, 10, x, y + 0.17 * s, z, G.cyan);
  } },
  incenseBox: { n: '香盒', draw: (b, x, y, z, s) => {
    b.box('lacquer', 0.34 * s, 0.16 * s, 0.26 * s, x, y + 0.08 * s, z, G.red);
  } },
  // —— 家具 / 起居 / 日常用品 ——
  stoneLamp: { n: '石灯', draw: (b, x, y, z, s) => {
    b.cyl('ash', 0.28 * s, 0.36 * s, 0.3 * s, 6, x, y + 0.15 * s, z, G.stone);
    b.cyl('ash', 0.12 * s, 0.16 * s, 0.7 * s, 6, x, y + 0.65 * s, z, G.stone);
    b.box('glow', 0.3 * s, 0.34 * s, 0.3 * s, x, y + 1.12 * s, z, G.glow);
    b.pyramid('ash', 0.02 * s, 0.42 * s, x, y + 1.3 * s, z, G.stone, 0, 1, 0.2 * s, 0.14 * s);
  } },
  stoneTable: { n: '石桌', draw: (b, x, y, z, s) => {
    b.cyl('ash', 0.7 * s, 0.76 * s, 0.14 * s, 12, x, y + 0.76 * s, z, G.stone);
    b.cyl('ash', 0.24 * s, 0.3 * s, 0.7 * s, 10, x, y + 0.37 * s, z, G.stone);
  } },
  stoneStool: { n: '石凳', draw: (b, x, y, z, s) => {
    b.cyl('ash', 0.26 * s, 0.3 * s, 0.44 * s, 8, x, y + 0.22 * s, z, G.stone);
  } },
  sutraRack: { n: '经卷架', draw: (b, x, y, z, s, ry) => {
    for (const u of [-1, 1]) b.box('wood', 0.1 * s, 1.7 * s, 0.1 * s, x + u * 0.7 * s, y + 0.85 * s, z, G.woodD, ry);
    for (let k = 0; k < 3; k++) b.box('wood', 1.5 * s, 0.07 * s, 0.4 * s, x, y + 0.35 * s + k * 0.5 * s, z, G.wood, ry);
    for (let k = 0; k < 4; k++) b.cyl('fabric', 0.08 * s, 0.08 * s, 0.4 * s, 6, x - 0.5 * s + k * 0.33 * s, y + 1.35 * s, z, G.paper, 0, 0, Math.PI / 2);
  } },
  bed: { n: '床榻', draw: (b, x, y, z, s, ry) => {
    b.box('wood', 2.0 * s, 0.3 * s, 1.0 * s, x, y + 0.35 * s, z, G.wood, ry);
    b.box('fabric', 1.9 * s, 0.12 * s, 0.9 * s, x, y + 0.56 * s, z, G.paper, ry);
    b.box('wood', 2.0 * s, 0.9 * s, 0.1 * s, x, y + 0.65 * s, z - 0.45 * s, G.woodD, ry);
  } },
  table: { n: '方桌', draw: (b, x, y, z, s) => {
    b.box('wood', 0.95 * s, 0.08 * s, 0.95 * s, x, y + 0.76 * s, z, G.wood);
    for (const u of [-1, 1]) for (const v of [-1, 1]) b.box('wood', 0.07 * s, 0.72 * s, 0.07 * s, x + u * 0.38 * s, y + 0.4 * s, z + v * 0.38 * s, G.woodD);
  } },
  cabinet: { n: '立柜', draw: (b, x, y, z, s, ry) => {
    b.box('wood', 1.1 * s, 1.9 * s, 0.55 * s, x, y + 0.95 * s, z, G.woodD, ry);
    b.box('metal', 0.08 * s, 0.24 * s, 0.05 * s, x, y + 1.1 * s, z + 0.3 * s, G.bronze, ry);
  } },
  chest: { n: '木箱', draw: (b, x, y, z, s) => {
    b.box('wood', 0.9 * s, 0.6 * s, 0.55 * s, x, y + 0.3 * s, z, G.woodD);
    b.box('metal', 0.1 * s, 0.1 * s, 0.06 * s, x, y + 0.42 * s, z + 0.29 * s, G.bronze);
  } },
  waterVat: { n: '水缸', draw: (b, x, y, z, s) => {
    b.cyl('ceramic', 0.72 * s, 0.78 * s, 0.72 * s, 12, x, y + 0.36 * s, z, G.clay);
    b.cyl('water', 0.66 * s, 0.66 * s, 0.02 * s, 12, x, y + 0.68 * s, z, G.cyan);
  } },
  clothesRack: { n: '衣架', draw: (b, x, y, z, s, ry) => {
    for (const u of [-1, 1]) b.box('wood', 0.07 * s, 1.7 * s, 0.07 * s, x + u * 0.6 * s, y + 0.85 * s, z, G.woodD, ry);
    b.box('wood', 1.3 * s, 0.08 * s, 0.08 * s, x, y + 1.6 * s, z, G.wood, ry);
    b.box('fabric', 0.5 * s, 0.9 * s, 0.05 * s, x + 0.2 * s, y + 1.0 * s, z, G.paper, ry);
  } },
  rug: { n: '地毯', draw: (b, x, y, z, s, ry) => {
    b.box('fabric', 2.6 * s, 0.03 * s, 1.8 * s, x, y + 0.02 * s, z, G.red, ry);
    b.box('fabric', 2.2 * s, 0.032 * s, 1.4 * s, x, y + 0.025 * s, z, G.gold, ry);
  } },
  drum: { n: '法鼓', draw: (b, x, y, z, s) => {
    b.cyl('wood', 0.42 * s, 0.42 * s, 0.5 * s, 12, x, y + 0.75 * s, z, G.red, 0, 0, Math.PI / 2);
    for (const u of [-1, 1]) b.box('wood', 0.08 * s, 0.7 * s, 0.08 * s, x + u * 0.5 * s, y + 0.35 * s, z, G.woodD);
  } },
  bell: { n: '铜钟', draw: (b, x, y, z, s) => {
    b.cyl('metal', 0.3 * s, 0.46 * s, 0.8 * s, 12, x, y + 1.0 * s, z, G.bronze);
    b.box('wood', 0.1 * s, 0.1 * s, 1.4 * s, x, y + 1.85 * s, z, G.woodD);
    for (const u of [-1, 1]) b.box('wood', 0.1 * s, 1.9 * s, 0.1 * s, x + u * 0.6 * s, y + 0.95 * s, z, G.woodD);
  } },
};

type ItemKey = keyof typeof MT_ITEMS;

/** 依档位取器物清单：高/中/低三档资产组合，档内再用 hash 决定增删与摆动。 */
function tierItems(type: MtBuildingType, tier: MtTier, seed: number): ItemKey[] {
  // 高档：主庙正殿全套礼佛 + 起居陈设（固定骨架，hash 只做 ±8% 摆动，不删件）
  if (tier === 'high') return [
    'idol', 'altar', 'censer', 'candle', 'banner', 'cushion', 'sutra', 'vase', 'screen',
    'coffer', 'plaque', 'lantern', 'woodfish', 'chime', 'bowl', 'incenseBox', 'sutraRack',
    'stoneLamp', 'rug', 'drum', 'bell', 'candle', 'vase', 'cushion',
  ];
  // 中档：厢房 / 山门 / 亭 / 廊 / 主题件，按类型给一组基础件，再按 hash 补 2~4 件
  const base: ItemKey[] = (() => {
    switch (type) {
      case 'sideRoom': return ['bed', 'table', 'cabinet', 'chest', 'waterVat', 'lantern', 'rug', 'clothesRack'];
      case 'gate': case 'mountainGate': case 'shaolinGate': case 'southGate': return ['lantern', 'banner', 'drum', 'plaque', 'stoneLamp', 'censer'];
      case 'incensePavilion': return ['censer', 'altar', 'candle', 'banner', 'cushion', 'stoneLamp'];
      case 'yuanCanPavilion': return ['stoneTable', 'stoneStool', 'stoneLamp', 'vase', 'incenseBox'];
      case 'corridor': case 'snowGallery': return ['lantern', 'stoneStool', 'censer', 'vase', 'sutraRack'];
      case 'cliffGate': return ['lantern', 'banner', 'censer', 'stoneLamp'];
      case 'hangingTemple': return ['altar', 'censer', 'candle', 'cushion', 'banner', 'sutra', 'plaque'];
      case 'jadePool': return ['vase', 'censer', 'stoneLamp', 'rug'];
      default: return ['censer', 'stoneLamp', 'banner', 'vase', 'cushion', 'sutra', 'lantern', 'incenseBox'];
    }
  })();
  // 再按 hash 从候选池补 1~3 件，避免同一类型每座千篇一律
  const known: ItemKey[] = base.slice();
  const extra: ItemKey[] = ['table', 'cabinet', 'chest', 'waterVat', 'clothesRack', 'sutraRack', 'chime', 'woodfish', 'bowl', 'rug', 'drum', 'bell', 'stoneTable', 'stoneStool'];
  const nAdd = 1 + Math.floor(mh(seed, 71) * 3);
  for (let i = 0; i < nAdd; i++) {
    const key = extra[Math.floor(mh(seed, 101 + i * 7) * extra.length)];
    if (!known.includes(key)) known.push(key);
  }
  return known;
}

/** 低档：远景通用地标 / 石碣 / 冰纹窗等，只给 3~6 件贴地供器（hash 选件）。 */
function lowItems(type: MtBuildingType, seed: number): ItemKey[] {
  const pool: ItemKey[] = ['censer', 'stoneLamp', 'cushion', 'banner', 'vase', 'sutra', 'incenseBox', 'stoneStool', 'plaque'];
  const fixed: ItemKey[] = type === 'stoneStele' || type === 'carving'
    ? ['censer', 'stoneLamp', 'cushion']
    : type === 'steps' || type === 'plank' || type === 'dragonRidge'
      ? ['stoneLamp', 'banner']
      : type === 'sutraPillar' || type === 'snowSutra'
        ? ['censer', 'sutra', 'vase']
        : ['censer', 'stoneLamp', 'cushion'];
  const out = [...fixed];
  const n = 1 + Math.floor(mh(seed, 211) * 3);
  for (let i = 0; i < n; i++) {
    const key = pool[Math.floor(mh(seed, 223 + i * 13) * pool.length)];
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** 类型 → 默认档位（显式 tier 优先）。 */
function tierOf(type: MtBuildingType, seed: number): MtTier {
  if (type === 'mainHall') return 'high';
  const mid: MtBuildingType[] = [
    'sideRoom', 'gate', 'corridor', 'moonTerrace', 'incensePavilion', 'yuanCanPavilion',
    'cliffGate', 'snowGallery', 'hangingTemple', 'southGate', 'shaolinGate', 'jadePool',
  ];
  if (mid.includes(type)) return 'mid';
  // 亭/塔/牌坊等开敞地标与主题件：hash 决定中/低（大件给中档，其余低档）
  const grand: MtBuildingType[] = ['tower', 'pavilion', 'paifang', 'mountainGate', 'snowSutra', 'dragonRidge'];
  if (grand.includes(type)) return mh(seed, 3) < 0.4 ? 'mid' : 'low';
  return 'low';
}

/**
 * 给一座山上建筑补内部陈设。确定性：档位、取件、摆动全走 mh(seed,k)，零共享 RNG。
 * 返回落位器物件数；同时打 b.kit 台账（world.assetAudit.detail 可断言）。
 */
export function furnishMountainBuilding(b: Baker, o: MtInteriorOpts): number {
  const tier = o.tier ?? tierOf(o.type, o.seed);
  const front = o.front ?? 1;
  const keys = tier === 'low' ? lowItems(o.type, o.seed) : tierItems(o.type, tier, o.seed);
  const hw = Math.max(0.6, o.w / 2);
  const hd = Math.max(0.6, o.d / 2);
  const hy = Math.max(2.0, o.h);
  const X = (u: number): number => o.cx + u;
  const Z = (v: number): number => o.cz + v;
  const Y = (y: number): number => o.cy + y;

  const place = (key: ItemKey, u: number, v: number, y: number, s: number, ry = 0): void => {
    const def = MT_ITEMS[key];
    if (!def) return;
    def.draw(b, X(u), Y(y), Z(v), s, ry);
  };

  let n = 0;
  if (tier === 'high') {
    // —— 主庙正殿：中轴礼佛序列 + 对称陈设，全部落在 32×14×20 净空内 ——
    const backZ = -front * hd * 0.55;
    place('screen', 0, backZ - 0.8, 0, 1.4); n++;                       // 背屏
    place('idol', 0, backZ + 0.4, 0, 1.15); n++;                        // 主尊
    for (const u of [-1, 1]) { place('idol', u * hw * 0.42, backZ + 0.2, 0, 0.72); n++; } // 胁侍
    place('altar', 0, backZ + hd * 0.75, 0, 1.3); n++;                  // 供案
    const ay = 1.2 * 1.3;                                                // 供案面高（scaled）
    place('censer', 0, ay, backZ + hd * 0.75, 1.0); n++;
    for (const u of [-1, 1]) { place('candle', u * 0.9, ay, backZ + hd * 0.75, 1.0); n++; }
    place('incenseBox', -1.6, ay, backZ + hd * 0.75, 1.0); n++;
    place('bowl', 1.6, ay, backZ + hd * 0.75, 1.0); n++;
    place('woodfish', -0.4, ay, backZ + hd * 0.75 + 0.1, 0.8); n++;
    place('chime', 0.5, ay - 0.2, backZ + hd * 0.75 - 0.1, 0.8); n++;
    for (const u of [-1, 1]) { place('banner', u * hw * 0.62, -front * hd * 0.1, 0, 1.1, u * 0.1); n++; }
    for (const u of [-1, 1]) { place('vase', u * hw * 0.5, 0, -front * hd * 0.35, 1.0); n++; }
    for (const u of [-1, 1]) { place('sutraRack', u * hw * 0.78, 0, 0, 0.9, Math.PI / 2); n++; }
    // 拜垫两排
    for (const v of [-0.2, 0.9]) for (const u of [-1.3, 1.3]) {
      place('cushion', u, front * (hd * 0.05 + v), 0, 1.0); n++;
    }
    place('rug', 0, 0.01, front * hd * 0.1, 1.2); n++;
    for (const u of [-1, 1]) for (const v of [-0.15, 0.35]) { place('lantern', u * hw * 0.6, hy * 0.66, front * v * hd, 1.0); n++; }
    place('coffer', 0, hy * 0.92, 0, Math.min(1.4, hw / 3)); n++;       // 藻井
    place('plaque', 0, hy * 0.82, front * (hd - 0.3), 1.1); n++;        // 门内匾额
    for (const u of [-1, 1]) { place('stoneLamp', u * hw * 0.3, 0, front * (hd - 1.2), 0.9); n++; }
    place('drum', -hw * 0.55, 0, front * hd * 0.25, 0.9); n++;
    place('bell', hw * 0.55, 0, front * hd * 0.25, 0.9); n++;
    place('sutra', 0, ay + 0.1, backZ + hd * 0.75 - 0.35, 1.0); n++;
  } else {
    // —— 中 / 低档：按器物清单在净空内确定性铺开（贴墙贴角，hash 摆动 ±8%）——
    const N = keys.length;
    for (let i = 0; i < N; i++) {
      const key = keys[i];
      const ring = i / Math.max(1, N);
      const ang = ring * Math.PI * 2 + mh(o.seed, 311 + i) * 0.6;
      const ru = Math.cos(ang) * hw * 0.72;
      const rv = Math.sin(ang) * hd * 0.72;
      const jitter = 0.92 + mh(o.seed, 411 + i) * 0.16;
      const y = key === 'lantern' || key === 'banner' || key === 'plaque'
        ? hy * (0.55 + mh(o.seed, 511 + i) * 0.2)
        : 0;
      const s = (tier === 'low' ? 0.7 : 0.9) * jitter;
      place(key, ru, rv, y, s, ang);
      n++;
    }
    // 中档补一套中心桌案/供案作视觉锚点
    if (tier === 'mid' && (o.type === 'sideRoom' || o.type === 'incensePavilion' || o.type === 'hangingTemple')) {
      place('altar', 0, 0, -front * hd * 0.3, 0.9); n++;
      place('censer', 0, 0.9 * 0.9, -front * hd * 0.3, 0.9); n++;
    }
  }

  // ---- 台账（真实计数，不硬编码）：主进程可经 world.assetAudit.detail 断言 ----
  b.kit('mt.interior.building', 1, o.cy);
  b.kit('mt.interior.' + tier, 1, o.cy);
  b.kit('mt.interior.' + o.type, 1, o.cy);
  b.kit('mt.interior.items', n, o.cy);
  return n;
}
