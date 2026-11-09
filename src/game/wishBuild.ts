// ============================================================================
// 三界造物 · 建造模式（我的世界式放置 / 旋转 / 堆叠 / 组合 / 存档）· src/game/wishBuild.ts
//
// R25：此前「创造」只是把输入框聚焦一下，没有任何可放置、可拼装的资产。
// 本模块维护真实的构件状态：网格落点、90° 旋转、层叠、缩放、撤销、组合，
// 并把布局写进 localStorage —— 刷新页面后造物与建筑都还在（补齐 R24 残留第 7 条）。
//
// 几何生成由 wishPanel 负责（forge + scene.add），本模块只管确定性状态，便于单测。
// 纪律：不用 Math.random、不引入新依赖、localStorage 不可用时降级为内存。
// ============================================================================
import type { WishSpec } from './wishForge';

export interface BuildPart {
  id: string;
  spec: WishSpec;
  x: number;
  y: number;
  z: number;
  ry: number;
  scale: number;
  stack: number;
  catalogId?: string;
  blueprintId?: string;
}

export interface BuildSnapshot {
  version: number;
  parts: BuildPart[];
}

const KEY = 'cyber-qingming.wish.build.v1';
const MAX_PARTS = 400;
const GRID = 4;           // 落点吸附网格（米）
const LAYER = 3.2;        // 每叠一层抬高（米）

function mem(): { raw: string } { return { raw: '' }; }
let FALLBACK = mem();

function storeGet(): string {
  try { return (globalThis as unknown as { localStorage?: Storage }).localStorage?.getItem(KEY) ?? FALLBACK.raw; }
  catch { return FALLBACK.raw; }
}
function storeSet(raw: string): void {
  FALLBACK.raw = raw;
  try { (globalThis as unknown as { localStorage?: Storage }).localStorage?.setItem(KEY, raw); } catch { /* 内存兜底 */ }
}

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** 落点吸附：让构件能一格一格拼起来，而不是随机散落 */
export function snap(x: number, z: number): { x: number; z: number } {
  return { x: Math.round(x / GRID) * GRID, z: Math.round(z / GRID) * GRID };
}

export class WishBuild {
  enabled = false;
  parts: BuildPart[] = [];
  ry = 0;
  scale = 1;
  stack = 0;
  private history: BuildSnapshot[] = [];
  private seq = 0;

  constructor() {
    this.restore(storeGet());
  }

  toggle(): boolean { this.enabled = !this.enabled; return this.enabled; }
  enter(): void { this.enabled = true; }
  exit(): void { this.enabled = false; }

  rotate(delta = Math.PI / 2): number {
    this.ry = (this.ry + delta) % (Math.PI * 2);
    return this.ry;
  }
  setScale(s: number): number {
    this.scale = Math.min(3, Math.max(0.3, Number.isFinite(s) ? s : 1));
    return this.scale;
  }
  setStack(n: number): number {
    this.stack = Math.min(8, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
    return this.stack;
  }

  private snapshot(): BuildSnapshot {
    return { version: 1, parts: this.parts.map((p) => ({ ...p, spec: { ...p.spec } })) };
  }

  /** 放置一件资产到玩家附近（真实构件，可撤销 / 可存档） */
  place(spec: WishSpec, x: number, y: number, z: number, catalogId?: string, blueprintId?: string): BuildPart | null {
    if (this.parts.length >= MAX_PARTS) return null;
    this.history.push(this.snapshot());
    if (this.history.length > 40) this.history.shift();
    const s = snap(x, z);
    const part: BuildPart = {
      id: `bp-${this.seq++}-${hashStr(spec.name + this.seq).toString(36)}`,
      spec: { ...spec },
      x: s.x, y: y + this.stack * LAYER, z: s.z,
      ry: this.ry, scale: this.scale * spec.scale,
      stack: this.stack, catalogId, blueprintId,
    };
    this.parts.push(part);
    this.save();
    return part;
  }

  /** 只放置预览（不进状态）：用于光标跟随的半透明构件 */
  previewPoint(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const s = snap(x, z);
    return { x: s.x, y: y + this.stack * LAYER, z: s.z };
  }

  undo(): BuildPart[] {
    const prev = this.history.pop();
    if (!prev) return [];
    this.parts = prev.parts;
    this.save();
    return this.parts;
  }

  clear(): void {
    this.history.push(this.snapshot());
    this.parts = [];
    this.save();
  }

  /** 组合：把若干构件合成一件新资产（我的世界式「合并」） */
  combine(ids: string[]): WishSpec | null {
    const picked = this.parts.filter((p) => ids.includes(p.id));
    if (picked.length < 2) return null;
    const traits = Array.from(new Set(picked.flatMap((p) => p.spec.traits))).slice(0, 8);
    const colors = Array.from(new Set(picked.flatMap((p) => p.spec.colors))).slice(0, 4);
    const seed = picked.reduce((h, p) => (h ^ (p.spec.seed >>> 0) ^ hashStr(p.id)) >>> 0, 2166136261 >>> 0);
    const name = `${picked[0].spec.name}${picked.length}合体`;
    return {
      name,
      archetype: picked[0].spec.archetype,
      traits: traits.length ? traits : ['合体', '构筑'],
      colors: colors.length ? colors : [0xd4af37, 0x8fd8ff],
      scale: Math.min(2.2, Math.round(picked.reduce((s, p) => s + p.scale, 0) / picked.length * 100) / 100 + 0.2),
      seed: seed >>> 0,
      source: 'param',
    };
  }

  removeParts(ids: string[]): number {
    const before = this.parts.length;
    this.parts = this.parts.filter((p) => !ids.includes(p.id));
    this.save();
    return before - this.parts.length;
  }

  serialize(): string {
    try { return JSON.stringify(this.snapshot()); } catch { return '{"version":1,"parts":[]}'; }
  }
  save(): void { storeSet(this.serialize()); }

  restore(raw: string): number {
    let n = 0;
    try {
      const o = JSON.parse(raw) as BuildSnapshot;
      if (o && o.version === 1 && Array.isArray(o.parts)) {
        this.parts = o.parts.filter((p) => p && p.spec && Number.isFinite(p.x) && Number.isFinite(p.z));
        this.seq = this.parts.length;
        n = this.parts.length;
      }
    } catch { /* 首次运行 / 损坏存档：空布局 */ }
    return n;
  }

  stats(): { enabled: boolean; parts: number; ry: number; scale: number; stack: number; grid: number } {
    return { enabled: this.enabled, parts: this.parts.length, ry: this.ry, scale: this.scale, stack: this.stack, grid: GRID };
  }
}
