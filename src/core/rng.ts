// 确定性随机数（mulberry32）：同种子同城市，可复现、可测试
export class RNG {
  private s: number;
  readonly seed: number;
  constructor(seed: number) { this.seed = seed >>> 0; this.s = this.seed; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  gauss(mean = 0, dev = 1): number {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return mean + dev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

// 简易事件总线：战斗播报/雷声/鼓点/UI 提示等解耦通信
type Handler = (payload?: unknown) => void;
export class Bus {
  private map = new Map<string, Set<Handler>>();
  on(evt: string, fn: Handler): void {
    let set = this.map.get(evt);
    if (!set) { set = new Set(); this.map.set(evt, set); }
    set.add(fn);
  }
  emit(evt: string, payload?: unknown): void {
    const set = this.map.get(evt);
    if (set) for (const fn of set) fn(payload);
  }
}
export const bus = new Bus();
