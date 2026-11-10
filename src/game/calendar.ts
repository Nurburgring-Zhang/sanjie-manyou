/**
 * 游戏日（全仓唯一来源）· FIX-012 R1 / FEAT-010 / FEAT-015 共用。
 *
 *   dayIndex = floor(clockMs * speed / 86400000)
 *
 * speed 唯一取自 src/core/palette.ts 的 TimeOfDay.speed（现状 1/420，即一昼夜 7 分钟实时）；
 * 禁止在别处自算日界/复制该常量。
 *
 * 时间源纪律（INV-01）：clock 由外部注入、tick(clockMs) 由外部驱动；
 * 不以 Math.random / Date.now 作为唯一时间源，便于无头测试与回放。
 */
import { TimeOfDay } from '../core/palette';

export interface Calendar {
  dayIndex(): number;
  onNewDay(cb: (d: number) => void): void;
  /** 外部驱动的时间推进点（毫秒）；跨游戏日时触发 onNewDay 回调 */
  tick(clockMs: number): void;
}

export const MS_PER_DAY = 86_400_000;

/** 时钟速度唯一取自 palette.ts，禁止别处复制常量 */
export function daySpeed(): number {
  return new TimeOfDay().speed;
}

export interface CalendarOptions {
  /** 注入时钟（毫秒）。不注入时时间完全由 tick(clockMs) 驱动 */
  clock?: () => number;
  /** 基准偏移（毫秒），随存档持久化；读档后 dayIndex 从该偏移续算 */
  baseOffsetMs?: number;
  /** 覆盖 speed（回放 / 加速测试用）；默认 daySpeed()，即 palette.ts 的 TimeOfDay.speed */
  speed?: number;
  /** 基准偏移变化时回调，供存档层持久化 */
  onPersistOffset?: (baseOffsetMs: number) => void;
}

/** createCalendar 返回带持久化能力的句柄（结构上仍是 Calendar） */
export interface CalendarHandle extends Calendar {
  serialize(): { baseOffsetMs: number };
  restore(s?: { baseOffsetMs?: number } | null): void;
}

export function createCalendar(opts: CalendarOptions = {}): CalendarHandle {
  const speed = opts.speed ?? daySpeed();
  const clock = opts.clock ?? null;
  let baseOffsetMs = opts.baseOffsetMs ?? 0;
  let lastTickMs = 0;
  // -1 = 尚未初始化；首次进入某日不触发 onNewDay（防止启动瞬间误清每日计数）
  let currentDay = -1;
  const callbacks: Array<(d: number) => void> = [];

  const dayOf = (clockMs: number): number =>
    Math.floor((clockMs + baseOffsetMs) * speed / MS_PER_DAY);

  const advance = (clockMs: number): void => {
    const d = dayOf(clockMs);
    if (d === currentDay) return;
    const first = currentDay === -1;
    currentDay = d;
    if (!first) for (const cb of callbacks) cb(d);
  };

  return {
    dayIndex(): number {
      const ms = clock ? clock() : lastTickMs;
      advance(ms);
      return currentDay < 0 ? 0 : currentDay;
    },
    onNewDay(cb): void { callbacks.push(cb); },
    tick(clockMs: number): void {
      lastTickMs = clockMs;
      advance(clockMs);
    },
    serialize(): { baseOffsetMs: number } { return { baseOffsetMs }; },
    restore(s): void {
      if (s && Number.isFinite(s.baseOffsetMs)) {
        baseOffsetMs = Number(s.baseOffsetMs);
        currentDay = -1;            // 用新偏移重算
        opts.onPersistOffset?.(baseOffsetMs);
      }
    },
  };
}
