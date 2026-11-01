// 极简补间：电影运镜与图鉴飞行用
export interface TweenTask { t: number; dur: number; from: number[]; to: number[]; onU: (v: number[]) => void; onEnd?: () => void; ease: (k: number) => number; }

export const easeInOut = (k: number): number => k * k * (3 - 2 * k);
export const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);

export class Tweener {
  private list: TweenTask[] = [];
  to(from: number[], to: number[], dur: number, onU: (v: number[]) => void, onEnd?: () => void, ease = easeInOut): void {
    this.list.push({ t: 0, dur, from: [...from], to: [...to], onU, onEnd, ease });
  }
  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i];
      k.t += dt;
      const r = Math.min(1, k.t / k.dur);
      const e = k.ease(r);
      const out = k.from.map((f, j) => f + (k.to[j] - f) * e);
      k.onU(out);
      if (r >= 1) { this.list.splice(i, 1); k.onEnd?.(); }
    }
  }
  clear(): void { this.list.length = 0; }
}
