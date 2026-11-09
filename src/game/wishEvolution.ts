// ============================================================================
// 三界造物 · 孢子式进化体系（融合终版垂直切片）· src/game/wishEvolution.ts
//
// 每个已生成实体持有 dna（体型/速度/攻击/防御/灵性/元素/颜色 7 维）、level、
// xp、stage（卵→幼体→成体→灵体→神体 5 阶）、abilities 与外形参数 form。
// 全纯逻辑、确定性（整数 hash，无 Math.random），Node 下单测可直接 import。
// ============================================================================

export type Stage = '卵' | '幼体' | '成体' | '灵体' | '神体';
export const STAGES: Stage[] = ['卵', '幼体', '成体', '灵体', '神体'];
/** 各阶 XP 阈值（达到即进入对应阶，共 5 阶） */
export const XP_THRESHOLDS: number[] = [0, 100, 300, 700, 1500];
export const STAGE_ABILITIES: string[] = ['孕育', '感知', '腾跃', '通灵', '化形'];

/** 7 维 DNA：体型 / 速度 / 攻击 / 防御 / 灵性 / 元素 / 颜色 */
export interface DNA {
  size: number;
  speed: number;
  attack: number;
  defense: number;
  spirit: number;
  element: string;
  color: number;
}
/** 外形参数：evolve 时按 dna 改造 */
export interface EvolvableForm {
  scale: number;
  glow: number;
  aura: number;
  extraLimbs: number;
}
export interface Evolvable {
  id: string;
  name: string;
  dna: DNA;
  level: number;
  xp: number;
  stage: Stage;
  stageIndex: number;
  abilities: string[];
  form: EvolvableForm;
  /** R25 演变分支：按五行分化，影响 glow / aura / extraLimbs，几何真的不同 */
  lineage?: string;
  /** R26 吞噬体系：累计吞掉的造物数（存档向后兼容，缺省视为 0） */
  devoured?: number;
}

const ELEMENTS = ['金', '木', '水', '火', '土', '风', '雷', '光', '暗'];
const PALETTE = [0xd4af37, 0x4fa8a0, 0xa8503c, 0x7a5cff, 0xf0ead8, 0x8fd8ff];

/**
 * R25「孢子式演变」：进化不是单线五阶放大，而是按五行分出九条形态支系。
 * 每条支系改写 forge 读到的 glow / aura / extraLimbs，并解锁专属能力名，
 * 因此同样阶位、不同五行的两只造物，几何与能力都不一样。
 */
export interface Lineage {
  name: string;
  desc: string;
  glow: number;
  aura: number;
  limbs: number;
}
export const LINEAGES: Record<string, Lineage> = {
  '金': { name: '锋曜', desc: '鳞甲锐化，金芒裁云', glow: 0.10, aura: 0.04, limbs: 0 },
  '木': { name: '青荣', desc: '枝角滋生，藤甲缠身', glow: -0.04, aura: 0.26, limbs: 1 },
  '水': { name: '潜渊', desc: '鳍尾舒展，水纹覆体', glow: 0.02, aura: 0.18, limbs: 1 },
  '火': { name: '焚霄', desc: '鬃焰腾起，赤纹灼天', glow: 0.30, aura: 0.10, limbs: 0 },
  '土': { name: '镇岳', desc: '骨节厚重，岩甲隆起', glow: -0.08, aura: 0.02, limbs: 1 },
  '风': { name: '凌虚', desc: '翼膜增生，浮环成双', glow: 0.05, aura: 0.30, limbs: 2 },
  '雷': { name: '霆殛', desc: '脊棘带电，光弧环身', glow: 0.26, aura: 0.14, limbs: 0 },
  '光': { name: '曜灵', desc: '金辉外放，三重祥云', glow: 0.36, aura: 0.22, limbs: 0 },
  '暗': { name: '幽玄', desc: '影纹内敛，虚肢潜生', glow: -0.12, aura: 0.28, limbs: 2 },
};

export function lineageOf(e: Evolvable): string {
  const l = LINEAGES[e.dna.element];
  return l ? `${e.dna.element}·${l.name}` : '混元·未定';
}
export function lineageDesc(e: Evolvable): string {
  return LINEAGES[e.dna.element]?.desc ?? '五行未定，形态随阶位自然演化';
}

const clamp01 = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function hashText(s: string): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}
function h01(seed: number, i: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** XP 落在哪一阶（0..4） */
export function stageForXp(xp: number): number {
  let idx = 0;
  const v = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) if (v >= XP_THRESHOLDS[i]) idx = i;
  return idx;
}

export function createEvolvable(id: string, name: string, seed?: number): Evolvable {
  const sd = seed ?? hashText(id + '|' + name);
  const pick = (i: number, min: number, max: number): number =>
    min + Math.floor(h01(sd, i) * (max - min + 1));
  const el = ELEMENTS[Math.floor(h01(sd, 6) * ELEMENTS.length)];
  const lin = LINEAGES[el];
  return {
    id,
    name,
    dna: {
      size: pick(1, 20, 60),
      speed: pick(2, 15, 70),
      attack: pick(3, 10, 65),
      defense: pick(4, 10, 60),
      spirit: pick(5, 15, 75),
      element: el,
      color: PALETTE[Math.floor(h01(sd, 7) * PALETTE.length)],
    },
    level: 1,
    xp: 0,
    stage: '卵',
    stageIndex: 0,
    abilities: ['孕育'],
    form: { scale: 1, glow: 0.2, aura: 0.4, extraLimbs: 0 },
    lineage: lin ? `${el}·${lin.name}` : '混元·未定',
  };
}

/** 累积经验（level 只增不减，避免 upgrade 消耗 xp 时回退） */
export function gainXp(e: Evolvable, amount: number): Evolvable {
  const n = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  e.xp += n;
  e.level = Math.max(e.level, 1 + Math.floor(e.xp / 120));
  return e;
}

/** 换阶：达到阈值则进阶，并按 dna 改造外形参数；原地修改并返回详情 */
export function evolve(e: Evolvable): { ev: Evolvable; changed: boolean; from: Stage; to: Stage } {
  const from = e.stage;
  const target = stageForXp(e.xp);
  const changed = target > e.stageIndex;
  if (changed) {
    e.stageIndex = target;
    e.stage = STAGES[target];
    e.form.scale = Math.round((1 + target * 0.18 + e.dna.size / 300) * 100) / 100;
    e.form.glow = Math.round((0.2 + target * 0.15 + e.dna.spirit / 500) * 100) / 100;
    e.form.aura = Math.round((0.4 + target * 0.2 + e.dna.spirit / 400) * 100) / 100;
    e.form.extraLimbs = Math.min(4, Math.floor(target / 2) + (e.dna.spirit > 60 ? 1 : 0));
    // R25 演变分支：同一阶位按五行分化，forge 读到的外形参数真的不同（不是只缩放）
    const lin = LINEAGES[e.dna.element];
    e.lineage = lineageOf(e);
    if (lin) {
      e.form.glow = Math.round(clamp01(e.form.glow + lin.glow, 0.05, 1.4) * 100) / 100;
      e.form.aura = Math.round(clamp01(e.form.aura + lin.aura, 0.05, 2.0) * 100) / 100;
      if (target >= 2) e.form.extraLimbs = Math.min(4, e.form.extraLimbs + lin.limbs);
      if (!e.abilities.includes(lin.name)) e.abilities.push(lin.name);
    }
    for (const a of STAGE_ABILITIES.slice(0, target + 1)) {
      if (!e.abilities.includes(a)) e.abilities.push(a);
    }
  }
  return { ev: e, changed, from, to: e.stage };
}

export type UpgradeDim = 'size' | 'speed' | 'attack' | 'defense' | 'spirit';

/** 消耗 xp 升一个维度（默认升当前最低维，确定性）；xp 不足返回 ok:false */
export function upgrade(e: Evolvable, dim?: UpgradeDim, cost = 60): { ev: Evolvable; ok: boolean; reason?: string } {
  if (e.xp < cost) return { ev: e, ok: false, reason: `灵力不足（需 ${cost}，现有 ${e.xp}）` };
  e.xp -= cost;
  const keys: UpgradeDim[] = ['size', 'speed', 'attack', 'defense', 'spirit'];
  const key = dim ?? keys.reduce((best, k) => (e.dna[k] < e.dna[best] ? k : best), keys[0]);
  e.dna[key] = Math.min(100, e.dna[key] + 8);
  e.level = Math.max(e.level, 1 + Math.floor(e.xp / 120));
  return { ev: e, ok: true };
}

function mixColor(a: number, b: number, w: number): number {
  const r = Math.round(((a >> 16) & 255) * w + ((b >> 16) & 255) * (1 - w));
  const g = Math.round(((a >> 8) & 255) * w + ((b >> 8) & 255) * (1 - w));
  const bl = Math.round((a & 255) * w + (b & 255) * (1 - w));
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255);
}
function mergeName(a: string, b: string, seed: number): string {
  const head = a.slice(0, Math.min(2, a.length));
  const tail = b.slice(Math.max(0, b.length - Math.min(2, b.length)));
  const SUF = ['·合灵', '·混元', '·化生', '·双生'];
  return head + tail + SUF[seed % SUF.length];
}

/**
 * 两实体 DNA 加权混合产出新实体（含名称合成）。
 * 顺序无关：先按 id 规范化；权重由 level 决定；全程整数运算，确定性。
 */
export function merge(a: Evolvable, b: Evolvable): Evolvable {
  const [x, y] = a.id <= b.id ? [a, b] : [b, a];
  const seed = hashText(x.id + '|' + y.id + '|' + x.xp + '|' + y.xp);
  const w = (x.level + 1) / (x.level + y.level + 2);
  const mix = (p: number, q: number): number => Math.round(p * w + q * (1 - w));
  const dna: DNA = {
    size: mix(x.dna.size, y.dna.size),
    speed: mix(x.dna.speed, y.dna.speed),
    attack: mix(x.dna.attack, y.dna.attack),
    defense: mix(x.dna.defense, y.dna.defense),
    spirit: mix(x.dna.spirit, y.dna.spirit),
    element: [x.dna.element, y.dna.element].sort().join('·'),
    color: mixColor(x.dna.color, y.dna.color, w),
  };
  const stageIndex = Math.max(x.stageIndex, y.stageIndex);
  return {
    id: 'merge-' + (seed >>> 0).toString(36),
    name: mergeName(x.name, y.name, seed),
    dna,
    level: Math.max(x.level, y.level) + 1,
    xp: Math.floor((x.xp + y.xp) / 2),
    stage: STAGES[stageIndex],
    stageIndex,
    abilities: Array.from(new Set([...x.abilities, ...y.abilities, '融合'])),
    form: {
      scale: Math.round(((x.form.scale + y.form.scale) / 2 * 1.1) * 100) / 100,
      glow: Math.round(((x.form.glow + y.form.glow) / 2 + 0.1) * 100) / 100,
      aura: Math.round(((x.form.aura + y.form.aura) / 2 + 0.1) * 100) / 100,
      extraLimbs: Math.min(4, Math.max(x.form.extraLimbs, y.form.extraLimbs) + 1),
    },
  };
}

/**
 * R26「吞噬」：孢子式弱肉强食的基本玩法。
 * 与 merge（对等融合成新个体）不同，吞噬是单向夺取：
 *   · 捕食者吸收猎物 DNA（猎物更强处吸收更多，弱处仍 +1 保底）
 *   · 获得猎物 XP + 阶位奖励，继承猎物专属能力，解锁「吞噬」
 *   · 猎物灵性显著更高时改写五行元素 → lineage 分支改变 → forge 几何真的换形态
 *   · form 的 scale / aura / extraLimbs 增长，UI 调 applyForm 重锻整件几何
 *   · 猎物本身不被修改（由 WishPanel.removeEntity 从世界里真正移除）
 * 纪律：确定性、原地修改 predator、阶差超过 1 阶拒绝（防越级秒吞）。
 */
export interface DevourResult {
  ev: Evolvable;
  ok: boolean;
  reason?: string;
  absorbed?: {
    xp: number;
    dna: Record<UpgradeDim, number>;
    abilities: string[];
    elementFrom: string;
    elementTo: string;
    lineage: string;
    stageFrom: Stage;
    stageTo: Stage;
  };
}

export function devour(predator: Evolvable, prey: Evolvable): DevourResult {
  if (!predator || !prey || predator.id === prey.id) {
    return { ev: predator, ok: false, reason: '不可吞噬自身' };
  }
  if (prey.stageIndex > predator.stageIndex + 1) {
    return { ev: predator, ok: false, reason: `修为不足：猎物「${prey.stage}」超出自身「${predator.stage}」一阶以上` };
  }
  const keys: UpgradeDim[] = ['size', 'speed', 'attack', 'defense', 'spirit'];
  const gained: Record<UpgradeDim, number> = { size: 0, speed: 0, attack: 0, defense: 0, spirit: 0 };
  for (const k of keys) {
    const delta = prey.dna[k] > predator.dna[k]
      ? Math.max(2, Math.round((prey.dna[k] - predator.dna[k]) * 0.35))
      : 1;
    const before = predator.dna[k];
    predator.dna[k] = Math.min(100, before + delta);
    gained[k] = predator.dna[k] - before;
  }
  const xpGain = Math.max(40, prey.xp + 40 + prey.stageIndex * 80);
  const stageFrom = predator.stage;
  gainXp(predator, xpGain);
  const r = evolve(predator);          // 吞噬带来的 XP 可直接触发进阶
  const newAbilities: string[] = [];
  for (const a of [...prey.abilities, '吞噬']) {
    if (!predator.abilities.includes(a)) { predator.abilities.push(a); newAbilities.push(a); }
  }
  // 夺其本源：猎物灵性远超捕食者时改写五行，九条演变支系真的换一条
  const elementFrom = predator.dna.element;
  let elementTo = elementFrom;
  if (prey.dna.spirit > predator.dna.spirit + 5 && prey.dna.element !== elementFrom) {
    predator.dna.element = prey.dna.element;
    elementTo = prey.dna.element;
  }
  predator.lineage = lineageOf(predator);
  predator.form.scale = Math.round((predator.form.scale + 0.05) * 100) / 100;
  predator.form.aura = Math.round((predator.form.aura + 0.08) * 100) / 100;
  predator.form.extraLimbs = Math.min(4, Math.max(predator.form.extraLimbs, Math.floor(prey.form.extraLimbs / 2) + 1));
  const lin = LINEAGES[predator.dna.element];
  if (lin) predator.form.glow = Math.round(clamp01(predator.form.glow + lin.glow * 0.4, 0.05, 1.4) * 100) / 100;
  predator.devoured = (predator.devoured ?? 0) + 1;
  return {
    ev: predator, ok: true,
    absorbed: {
      xp: xpGain, dna: gained, abilities: newAbilities,
      elementFrom, elementTo, lineage: predator.lineage,
      stageFrom, stageTo: r.to,
    },
  };
}

export function serialize(e: Evolvable): string {
  return JSON.stringify(e);
}
/** 反序列化 + 最小补齐（向后兼容）；roundtrip 对合法实体完全恒等 */
export function deserialize(raw: string): Evolvable {
  const o = JSON.parse(raw) as Evolvable;
  if (!o || !o.dna || typeof o.id !== 'string') throw new Error('bad evolvable');
  o.abilities = Array.isArray(o.abilities) ? o.abilities : ['孕育'];
  o.form = o.form ?? { scale: 1, glow: 0.2, aura: 0.4, extraLimbs: 0 };
  o.stageIndex = Number.isFinite(o.stageIndex) ? o.stageIndex : stageForXp(o.xp);
  o.stage = o.stage ?? STAGES[o.stageIndex];
  return o;
}
