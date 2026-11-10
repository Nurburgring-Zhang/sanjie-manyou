import { describe, it, expect, beforeEach } from 'vitest';
import {
  BAKE_FRAME_BUDGET_MS,
  PROGRESS_SATURATION_K,
  FRACTION_REPORT_STEP,
  getBakeBudget,
  resetBakeBudget,
  configureBakeBudget,
} from '../src/core/bakeBudget';

/**
 * PERF-001 R2 单测。
 * 重点不是「跑通」，而是证明三件容易做假的事：
 *   ① 没到 8ms 不让帧（不能退化成每块都 await，那会把启动拖成 vsync 等待）；
 *   ② 到 8ms 才让帧，且让帧广播的 slices 与 taskFraction() 口径一致；
 *   ③ 任务内进度严格单调、永不饱和到 1（否则 2s 采样又会出现进度停滞）。
 */
describe('PERF-001 R2 bake 时间预算切片', () => {
  beforeEach(() => resetBakeBudget());

  it('预算常量冻结为 spec 的 8ms，平滑常数 >0', () => {
    expect(BAKE_FRAME_BUDGET_MS).toBe(8);
    expect(PROGRESS_SATURATION_K).toBeGreaterThan(0);
  });

  it('未达 8ms 预算：tick 同步返回 false，零让帧', async () => {
    const b = getBakeBudget();
    b.beginScope('stage-A');
    expect(await b.tick(100)).toBe(false); // 首块无上一块耗时
    expect(await b.tick(104)).toBe(false); // 累计 4ms
    expect(await b.tick(107)).toBe(false); // 累计 7ms
    expect(b.stats().slices).toBe(0);
    expect(b.taskFraction()).toBe(0);
  });

  it('累计达到 8ms：让帧一次，且广播的 scopeSlices 与 taskFraction 一致', async () => {
    const b = getBakeBudget();
    b.beginScope('stage-A');
    const seen: number[] = [];
    const off = configureBakeBudget((info) => seen.push(info.scopeSlices));
    try {
      await b.tick(100);
      await b.tick(105);
      expect(await b.tick(114)).toBe(true); // 累计 14ms ≥ 8ms
      expect(b.stats().slices).toBe(1);
      expect(seen).toEqual([1]);
      expect(b.taskFraction()).toBeCloseTo(1 / (1 + PROGRESS_SATURATION_K), 6);
      expect(b.stats().maxSpanMs).toBeGreaterThanOrEqual(9);
    } finally {
      off();
    }
  });

  it('beginScope 重置任务内切片计数，但不丢全局累计', async () => {
    const b = getBakeBudget();
    b.beginScope('A');
    b.noteExternalSlice(9);
    b.noteExternalSlice(9);
    expect(b.taskFraction()).toBeCloseTo(2 / (2 + PROGRESS_SATURATION_K), 6);
    expect(b.stats().slices).toBe(2);
    b.beginScope('B');
    expect(b.taskFraction()).toBe(0);
    expect(b.stats().slices).toBe(2);
    expect(b.currentStage()).toBe('B');
  });

  it('任务内进度严格单调递增且恒 <1（永不饱和 → 进度不会停住）', () => {
    const b = getBakeBudget();
    b.beginScope('long-task');
    const vals: number[] = [];
    for (let i = 0; i < 40; i++) {
      b.noteExternalSlice(8);
      vals.push(b.taskFraction());
    }
    for (let i = 0; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(0);
      expect(vals[i]).toBeLessThan(1);
      if (i > 0) expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
    // 第 40 片仍在推进，不是早就钉死在 0.97
    expect(vals[39]).toBeGreaterThan(vals[20]);
  });

  it('flush 的 noteExternalSlice 并入统一遥测，externalSlices 可审计', () => {
    const b = getBakeBudget();
    b.beginScope('flush@皇城·街巷铺装');
    b.noteExternalSlice(8.4);
    b.noteExternalSlice(9.1);
    const s = b.stats();
    expect(s.slices).toBe(2);
    expect(s.externalSlices).toBe(2);
    expect(s.ticks).toBe(0);
    expect(s.lastSpanMs).toBe(9.1);
    expect(s.stages[0].stage).toBe('flush@皇城·街巷铺装');
    expect(s.stages[0].slices).toBe(2);
  });

  it('stats() 字段完整且预算值透出，可供 probe-boot-memory 写台账', () => {
    const s = getBakeBudget().stats();
    expect(s.budgetMs).toBe(8);
    expect(s.slices).toBe(0);
    expect(s.totalSyncMs).toBe(0);
    expect(s.maxSpanMs).toBe(0);
    expect(s.lastSpanMs).toBe(0);
    expect(s.ticks).toBe(0);
    expect(s.externalSlices).toBe(0);
    expect(Array.isArray(s.stages)).toBe(true);
  });

  it('onSlice 可退订；reset 清空监听器与全部计数', () => {
    const b = getBakeBudget();
    let hits = 0;
    const off = configureBakeBudget(() => { hits++; });
    b.beginScope('A');
    b.noteExternalSlice(8);
    expect(hits).toBe(1);
    off();
    b.noteExternalSlice(8);
    expect(hits).toBe(1);
    resetBakeBudget();
    b.noteExternalSlice(8);
    expect(hits).toBe(1); // reset 后监听器已清空
    expect(b.stats().slices).toBe(1);
    expect(b.stats().stages).toEqual([]);
    expect(b.currentStage()).toBe('(unset)');
  });

  it('builder 自报真实进度优先于切片数估计，且钳在 [0,1]', () => {
    const b = getBakeBudget();
    b.beginScope('山河·地形');
    b.noteExternalSlice(8); // 即使已有切片，显式进度也应优先
    expect(b.taskFraction()).toBeGreaterThan(0);
    b.reportFraction(0.42);
    expect(b.taskFraction()).toBeCloseTo(0.42, 6);
    b.reportFraction(1.8);
    expect(b.taskFraction()).toBe(1);
    b.reportFraction(-3);
    expect(b.taskFraction()).toBe(1); // 单调，不回退
  });

  it('reportFraction 按 FRACTION_REPORT_STEP 节流，避免每个顶点改一次 DOM', () => {
    const b = getBakeBudget();
    b.beginScope('山河·地形');
    let broadcasts = 0;
    const off = configureBakeBudget(() => { broadcasts++; });
    try {
      for (let i = 0; i <= 1000; i++) b.reportFraction(i / 1000);
      // 0→1 每 0.004 一次，量级应为数百而非上千，且不出现 0 次
      expect(broadcasts).toBeGreaterThan(100);
      expect(broadcasts).toBeLessThan(1000);
      expect(broadcasts).toBeLessThanOrEqual(Math.ceil(1 / FRACTION_REPORT_STEP) + 1);
      expect(b.stats().fractionReports).toBe(broadcasts);
      expect(b.taskFraction()).toBe(1);
    } finally {
      off();
    }
  });

  it('beginScope 清除显式进度并回退到切片数渐近插值', () => {
    const b = getBakeBudget();
    b.beginScope('山河·地形');
    b.reportFraction(0.85);
    expect(b.taskFraction()).toBe(0.85);
    b.beginScope('筑城·街屋群');
    expect(b.taskFraction()).toBe(0);
    b.noteExternalSlice(8);
    expect(b.taskFraction()).toBeCloseTo(1 / (1 + PROGRESS_SATURATION_K), 6);
  });
});
