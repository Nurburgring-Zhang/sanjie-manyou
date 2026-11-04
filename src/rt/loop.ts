// ============================================================================
// 固定步主循环（P0-5）· src/rt/loop.ts
//
// 清单 v3 P0-5：「固定步主循环 + updatables 的 add/remove 对称」。engine.removeUpdate
// 已补（保序 splice）；本文件补另一半：与引擎帧循环解耦的**固定步**调度器——
// physics.ts 已有的 FIXED_DT=1/120 / MAX_SUBSTEPS=16 口径在此通用化，供玩家控制器等
// sim 消费方接入（接入本身是行为变化，属 P0-5b；本文件只交付基础设施，零行为变化）。
//
// 确定性纪律（spec §6）：每帧步数由 dt 唯一决定；注册顺序 = 执行顺序（数组保序）；
// remove 稳定（swap-remove 会破坏逐帧顺序）。同 seed 两次跑逐值一致可单测。
// ============================================================================

export interface FixedUpdatable { fixedUpdate(dt: number): void }

export class FixedStepLoop {
  static readonly FIXED_DT = 1 / 120;
  /** 单帧最多消化多少步：引擎已把 dt 夹到 0.1s（=12 步），留 16 步余量防「追帧→更掉帧」正反馈 */
  static readonly MAX_SUBSTEPS = 16;

  private items: FixedUpdatable[] = [];
  private acc = 0;
  private stepsThisFrame = 0;

  /** 注册。顺序 = 每步执行顺序（保序数组，不排序不去重——重复注册是调用方错误） */
  add(u: FixedUpdatable): void { this.items.push(u); }

  /** 注销。splice 保序；幂等（不存在返回 false） */
  remove(u: FixedUpdatable): boolean {
    const i = this.items.indexOf(u);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  get size(): number { return this.items.length; }

  /** 本帧实际走了几步（诊断/探针用） */
  get lastFrameSteps(): number { return this.stepsThisFrame; }

  /**
   * 每帧调用一次：按 dt 累积步数，逐步驱动全部注册者。
   * dt 单位秒；Math.max(0, dt) 防负帧；截断语义与 physics.ImpactSystem 同口径。
   */
  frame(dt: number): void {
    this.acc += Math.max(0, dt);
    let steps = 0;
    while (this.acc >= FixedStepLoop.FIXED_DT && steps < FixedStepLoop.MAX_SUBSTEPS) {
      this.acc -= FixedStepLoop.FIXED_DT;
      steps++;
      for (let i = 0; i < this.items.length; i++) this.items[i].fixedUpdate(FixedStepLoop.FIXED_DT);
    }
    // 掉帧太狠时丢掉多余积压，避免「追帧 → 更掉帧」的正反馈
    if (steps === FixedStepLoop.MAX_SUBSTEPS) this.acc = Math.min(this.acc, FixedStepLoop.FIXED_DT);
    this.stepsThisFrame = steps;
  }
}
