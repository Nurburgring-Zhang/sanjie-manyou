/**
 * PERF-001 R2：烘焙时间切片的单一真相源。
 *
 * spec 原文：「bake.ts 全量同步烘焙改为任务队列 + 每帧 ≤8ms 预算切片（复用
 * engine.ts ChunkGate / occlusion.beginFrame 同类机制）；约束：切片不得改变烘焙结果的
 * 确定性（任务序固定、rng 注入，INV-01）」。
 *
 * 改造前工程现状（必须先说清，否则容易把已有实现重复做一遍）：
 *   - `bake.ts flush()` 已有「累计装配 ≥8ms 才让帧」，但把 8 硬编码在局部；
 *   - `buildings.ts` 是「每 30 条街屋让一帧」、`imperial.ts` 是「每 3 坊让一帧」，
 *     两者与耗时无关：轻机器上白等 16.7ms vsync，重机器上单块仍可能远超 8ms；
 *   - 三处口径分裂，且进度条只在任务边界推进，实测出现 21.45s 的进度停滞。
 *
 * 本模块做的事（只有两件，刻意收窄）：
 *   ① 把「何时让帧」统一成按累计同步耗时 8ms 判定，三处共用同一个常量与同一套遥测；
 *   ② 每次真正让帧时广播一次 onSlice，让 world.ts 在**任务内部**推进进度条。
 *
 * 刻意不做的事：
 *   - 不把 push()/boxFast() 改成 async。它们是几十万次调用的热路径，改异步会波及
 *     全部 builder，并给 rng 消耗序引入不可控的 await 点，直接违反 INV-01。
 *   - 让帧只发生在**原先就存在的 await 点**（三处循环开头），语句顺序、rng 序列、
 *     几何字节逐值不变；变的只是「这一帧要不要让」。已由截图 SSIM 门与 tris 冻结门复核。
 *   - 让帧用 MessageChannel 宏任务而不是 requestAnimationFrame：flush() 的实测注释
 *     已证明「2.3ms 的活等 16.7ms 的帧」会让让帧本身成为主成本。宏任务同样把主线程
 *     交还浏览器渲染，单次同步占用仍被 8ms 预算卡住，但不白付 vsync 等待。
 *
 * 进度语义（诚实边界）：world.ts 用真实切片数做渐近插值 `s/(s+K)`，单调、严格递增、
 * 永不饱和，因此 2s 采样的进度差恒 >0。它表示「当前任务内已推进的切片量」，
 * **不是精确完成百分比**；精确权重进度条属于 PERF-002 R1，不在此冒充。
 */

export const BAKE_FRAME_BUDGET_MS = 8;

/** 进度渐近插值的平滑常数：越大越慢接近任务区间上沿，但每片都严格递增。 */
export const PROGRESS_SATURATION_K = 8;

/** 真实进度上报的节流步长：避免每个顶点都改一次 DOM 进度条。 */
export const FRACTION_REPORT_STEP = 0.004;

export interface BakeSliceInfo {
  /** 本次让帧前累计的同步占用（ms）。 */
  spanMs: number;
  /** 全局累计让帧次数。 */
  slices: number;
  /** 当前 scope（任务）内累计让帧次数。 */
  scopeSlices: number;
  stage: string;
}

export interface BakeBudgetStats {
  budgetMs: number;
  slices: number;
  totalSyncMs: number;
  maxSpanMs: number;
  lastSpanMs: number;
  ticks: number;
  /** 由 flush() 等未走 tick() 的外部让帧点并入的切片数。 */
  externalSlices: number;
  /** builder 自报真实进度的次数（节流后），用于证明长任务内进度确实在推进。 */
  fractionReports: number;
  stages: { stage: string; slices: number; syncMs: number }[];
}

function yieldToBrowser(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

class BakeSliceBudget {
  private pendingMs = 0;
  private lastMark = 0;
  private slices = 0;
  private totalSyncMs = 0;
  private maxSpanMs = 0;
  private lastSpanMs = 0;
  private ticks = 0;
  private externalSlices = 0;
  private stage = '(unset)';
  private scopeStartSlices = 0;
  /** builder 自报的真实任务内进度；null 表示本任务没有可量化的分步点，回退到切片数渐近插值。 */
  private explicitFraction: number | null = null;
  private lastReportedFraction = -1;
  private fractionReports = 0;
  private stageRows: { stage: string; slices: number; syncMs: number }[] = [];
  private readonly listeners = new Set<(info: BakeSliceInfo) => void>();

  /** 开始一个任务 scope：按 scope 内的切片数推进任务内进度。 */
  beginScope(stage: string): void {
    this.stage = stage;
    this.scopeStartSlices = this.slices;
    this.lastMark = 0;
    this.pendingMs = 0;
    this.explicitFraction = null;
    this.lastReportedFraction = -1;
    this.stageRows.push({ stage, slices: 0, syncMs: 0 });
  }

  /**
   * builder 上报「本任务真实完成比例」（例如地形顶点循环 i/pos.count）。
   * 这是**精确进度**，优先于按切片数估计的渐近插值。节流后广播一次 onSlice，
   * 让 world.ts 把进度推到 DOM；不产生让帧，不影响几何或 rng 序列。
   */
  reportFraction(f: number): void {
    const v = Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0;
    if (v <= this.lastReportedFraction + FRACTION_REPORT_STEP) return;
    this.lastReportedFraction = v;
    this.explicitFraction = v;
    this.fractionReports++;
    this.emit(0);
  }

  onSlice(fn: (info: BakeSliceInfo) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 每个循环块开头调一次：累计上一块耗时，达到 8ms 才真正让帧。
   * @param now 仅供单测注入时间，生产恒为 performance.now()。
   */
  tick(now: number = performance.now()): Promise<boolean> | false {
    this.ticks++;
    const d = this.lastMark > 0 ? Math.max(0, now - this.lastMark) : 0;
    this.lastMark = now;
    this.totalSyncMs += d;
    this.pendingMs += d;
    if (d > this.maxSpanMs) this.maxSpanMs = d;
    const row = this.stageRows[this.stageRows.length - 1];
    if (row) row.syncMs += d;
    if (this.pendingMs < BAKE_FRAME_BUDGET_MS) return false;
    return this.doYield(this.pendingMs);
  }

  /** flush() 自带 pending 计时，让帧后把这一次切片并入统一遥测。 */
  noteExternalSlice(spanMs: number): void {
    this.slices++;
    this.externalSlices++;
    this.lastSpanMs = spanMs;
    if (spanMs > this.maxSpanMs) this.maxSpanMs = spanMs;
    const row = this.stageRows[this.stageRows.length - 1];
    if (row) row.slices++;
    this.emit(spanMs);
  }

  private async doYield(spanMs: number): Promise<boolean> {
    await yieldToBrowser();
    // 顺序要固定：先递增切片计数再广播，onSlice 回调读到的 slices / taskFraction()
    // 必须与 noteExternalSlice() 路径一致，否则第一片会广播 scopeSlices=0（进度不动）。
    this.slices++;
    this.lastSpanMs = spanMs;
    const row = this.stageRows[this.stageRows.length - 1];
    if (row) row.slices++;
    this.emit(spanMs);
    // 让帧期间浏览器渲染的时间不是我们的同步占用，不能计入下一片预算。
    this.pendingMs = 0;
    this.lastMark = performance.now();
    return true;
  }

  private emit(spanMs: number): BakeSliceInfo {
    const info: BakeSliceInfo = {
      spanMs,
      slices: this.slices,
      scopeSlices: Math.max(0, this.slices - this.scopeStartSlices),
      stage: this.stage,
    };
    for (const fn of this.listeners) fn(info);
    return info;
  }

  /** 由 world.ts 调用：优先用 builder 自报的精确进度，否则用切片数渐近插值。 */
  taskFraction(): number {
    if (this.explicitFraction !== null) return this.explicitFraction;
    const s = Math.max(0, this.slices - this.scopeStartSlices);
    return s / (s + PROGRESS_SATURATION_K);
  }

  currentStage(): string { return this.stage; }

  stats(): BakeBudgetStats {
    return {
      budgetMs: BAKE_FRAME_BUDGET_MS,
      slices: this.slices,
      totalSyncMs: Math.round(this.totalSyncMs * 100) / 100,
      maxSpanMs: Math.round(this.maxSpanMs * 100) / 100,
      lastSpanMs: Math.round(this.lastSpanMs * 100) / 100,
      ticks: this.ticks,
      externalSlices: this.externalSlices,
      fractionReports: this.fractionReports,
      stages: this.stageRows.map((r) => ({ ...r, syncMs: Math.round(r.syncMs * 100) / 100 })),
    };
  }

  reset(): void {
    this.pendingMs = 0; this.lastMark = 0; this.slices = 0;
    this.totalSyncMs = 0; this.maxSpanMs = 0; this.lastSpanMs = 0;
    this.ticks = 0; this.externalSlices = 0; this.fractionReports = 0;
    this.stage = '(unset)'; this.scopeStartSlices = 0;
    this.explicitFraction = null; this.lastReportedFraction = -1;
    this.stageRows = [];
    this.listeners.clear();
  }
}

const ACTIVE = new BakeSliceBudget();

export function getBakeBudget(): BakeSliceBudget { return ACTIVE; }
export function bakeBudgetStats(): BakeBudgetStats { return ACTIVE.stats(); }
export function configureBakeBudget(onSlice: (info: BakeSliceInfo) => void): () => void {
  return ACTIVE.onSlice(onSlice);
}
export function resetBakeBudget(): void { ACTIVE.reset(); }
