// ============================================================================
// 生存循环（P1-2 玩法实体·第一块）· src/game/survival.ts
//
// 游戏循环：饥饿随时间下降 → 归零扣血 → 血量归零「晕倒」被送往孟婆庄（地府重生，
// 与三界联动）扣一半铜钱作为代价；吃小吃摊食物/蟠桃恢复。
// 与既有系统的接缝（全部回调注入，零反向依赖）：
//   - world 每帧 tick(dt)（挂 engine.addUpdate 的 world.update 里调用）
//   - interact.save() 时持久化（hp/hunger 进 SaveDataV2.survival）
//   - Boss onDefeat 时 world 调 onBossDefeated(specId) 发利品
// ============================================================================
import { bus } from '../core/rng';

export interface SurvivalState {
  hp: number;             // 0–100
  hunger: number;         // 0–100（100=饱）
  faints: number;         // 晕倒次数（诊断/成就）
  bossesDown: number;     // 击败 Boss 数（利品账）
}

export const HP_MAX = 100;
export const HUNGER_MAX = 100;
const HUNGER_DRAIN_PER_SEC = 100 / (20 * 60);   // 饱→空 20 分钟
const STARVE_DMG_PER_SEC = 2;                    // 饿空后每秒扣 2 血
const REGEN_PER_SEC = 1.5;                       // 饱(≥80)时回血
const FAINT_COIN_PENALTY_RATIO = 0.5;            // 晕倒罚金：铜钱减半

export class Survival {
  hp = HP_MAX;
  hunger = HUNGER_MAX;
  faints = 0;
  bossesDown = 0;
  /** 晕倒时由 world 注入的迁移动作（送孟婆庄重生 + 罚金） */
  onFaint: (() => void) | null = null;
  private fainted = false;

  tick(dt: number): void {
    // 饥饿消耗
    this.hunger = Math.max(0, this.hunger - HUNGER_DRAIN_PER_SEC * dt);
    // 饿空扣血 / 饱腹回血
    if (this.hunger <= 0) {
      this.hp = Math.max(0, this.hp - STARVE_DMG_PER_SEC * dt);
    } else if (this.hunger >= 80 && this.hp < HP_MAX) {
      this.hp = Math.min(HP_MAX, this.hp + REGEN_PER_SEC * dt);
    }
    // 晕倒沿：血量归零触发一次（false→true 沿），world.onFaint 执行迁移
    if (this.hp <= 0 && !this.fainted) {
      this.fainted = true;
      this.faints++;
      bus.emit('ui:toast', '眼前一黑……醒来时已躺在孟婆庄的竹榻上');
      this.onFaint?.();
    }
  }

  /** 晕倒迁移完成由 world 调：复位生命（不在 tick 内复位，避免迁移途中再扣） */
  revive(): void {
    this.fainted = false;
    this.hp = HP_MAX * 0.6;                       // 复活只回六成血——死亡要有代价
    this.hunger = Math.max(this.hunger, 40);      // 孟婆庄一碗汤垫底
  }

  /** 受伤（Boss 命中/AOE）：返回是否晕倒 */
  damage(n: number): boolean {
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0 && !this.fainted) {
      this.fainted = true;
      this.faints++;
      this.onFaint?.();
      return true;
    }
    return false;
  }

  /** 进食：回饥饿；蟠桃类回血更多。返回实际入口述 */
  eat(hungerGain: number, hpGain = 0): string {
    this.hunger = Math.min(HUNGER_MAX, this.hunger + hungerGain);
    this.hp = Math.min(HP_MAX, this.hp + hpGain);
    return `饥饿 +${hungerGain}${hpGain > 0 ? ` 生命 +${hpGain}` : ''}`;
  }

  /** Boss 击败利品：蟠桃 +1（资源轴联动）；击杀计数 */
  bossReward(): number {
    this.bossesDown++;
    return 1;                                       // 利品蟠桃数（世界观：伏妖记功）
  }

  /** 晕倒罚金系数（world 读取后扣铜钱） */
  get coinPenaltyRatio(): number { return FAINT_COIN_PENALTY_RATIO; }

  state(): SurvivalState {
    return { hp: Math.round(this.hp), hunger: Math.round(this.hunger), faints: this.faints, bossesDown: this.bossesDown };
  }

  /** 持久化快照（SaveDataV2.survival） */
  serialize(): SurvivalState { return this.state(); }

  deserialize(s: Partial<SurvivalState>): void {
    if (typeof s.hp === 'number') this.hp = Math.max(0, Math.min(HP_MAX, s.hp));
    if (typeof s.hunger === 'number') this.hunger = Math.max(0, Math.min(HUNGER_MAX, s.hunger));
    if (typeof s.faints === 'number') this.faints = s.faints;
    if (typeof s.bossesDown === 'number') this.bossesDown = s.bossesDown;
    // 全量审核 2026-11-07（C14）：读档是新会话起点，不继承上一会话的「晕倒吸态」。
    // 旧实现按 hp<=0 预置 fainted；而 onFaint 把 I.save() 排在 revive() 之前（world.ts），
    // 会把 hp:0 写进档 → 读档后 fainted 恒 true → damage/faint 沿 hp<=0&&!fainted 永久失效。
    // 写档时序这一根因已在 world.ts 修复，此处同时保证旧档 / 坏档不再把玩家锁进吸态。
    this.fainted = false;
  }
}
