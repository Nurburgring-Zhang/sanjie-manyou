// ============================================================================
// 生存循环（P1-2 玩法实体·第一块）· src/game/survival.ts
//
// 游戏循环：饥饿随时间下降 → 归零扣血 → 血量归零「晕倒」被送往孟婆庄（地府重生，
// 与三界联动）扣一半铜钱作为代价；吃小吃摊食物/蟠桃恢复。
// 与既有系统的接缝（全部回调注入，零反向依赖）：
//   - world 每帧 tick(dt)（挂 engine.addUpdate 的 world.update 里调用）
//   - interact.save() 时持久化（hp/hunger 进 SaveDataV2.survival）
//   - Boss onDefeat 时 world 调 onBossDefeated(specId) 发利品
//
// FIX-010 R3/R4：damage() 成为唯一扣血入口——Boss 命中 / 饥饿 / 任何来源都走这里。
//   同 source 800ms 无敌帧防 tick 连击秒杀；入口统一 emit 'player:damaged' 供 HUD 订阅。
//   [裁决] 饥饿是每帧连续小额扣血，套 800ms 无敌帧会退化成分段扣血，故 hunger 豁免
//   无敌帧但仍走同一入口（不再直接减 hp）——此冲突 spec 未覆盖，见交付报告显式披露。
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
/** FIX-010 R3：受击无敌帧（毫秒）——同 source 在该窗口内只结算一次 */
export const IFRAME_MS = 800;

export interface DamageOptions { source?: string }

export class Survival {
  hp = HP_MAX;
  hunger = HUNGER_MAX;
  faints = 0;
  bossesDown = 0;
  /** 晕倒时由 world 注入的迁移动作（送孟婆庄重生 + 罚金） */
  onFaint: (() => void) | null = null;
  private fainted = false;
  /** 注入时钟（毫秒）：无敌帧判定用。默认用 tick(dt) 累积的 sim-time；测试/回放显式注入 */
  clock: (() => number) | null = null;
  private simMs = 0;
  /** 各 source 最近一次结算时间（毫秒）——同 source 800ms 内只结算一次 */
  private lastDamageAt = new Map<string, number>();

  private now(): number { return this.clock ? this.clock() : this.simMs; }

  tick(dt: number): void {
    this.simMs += dt * 1000;
    // 饥饿消耗
    this.hunger = Math.max(0, this.hunger - HUNGER_DRAIN_PER_SEC * dt);
    // 饿空扣血 / 饱腹回血
    if (this.hunger <= 0) {
      // FIX-010 R4：饥饿扣血改走唯一入口 damage()（source:'hunger'，豁免无敌帧）
      this.damage(STARVE_DMG_PER_SEC * dt, { source: 'hunger' });
    } else if (this.hunger >= 80 && this.hp < HP_MAX) {
      this.hp = Math.min(HP_MAX, this.hp + REGEN_PER_SEC * dt);  // 回血非扣血，不进 damage()
    }
    // 晕倒沿统一收敛到 damage()（fainted 闩保证一次性），此处不再重复判定
  }

  /** 晕倒迁移完成由 world 调：复位生命（不在 tick 内复位，避免迁移途中再扣） */
  revive(): void {
    this.fainted = false;
    this.hp = HP_MAX * 0.6;                       // 复活只回六成血——死亡要有代价
    this.hunger = Math.max(this.hunger, 40);      // 孟婆庄一碗汤垫底
  }

  /**
   * 受伤：唯一扣血入口（Boss 命中 / 饥饿 / 任何来源都走这里）。
   * @returns 是否本次触发晕倒（hp 打到 0 且首次沿）
   */
  damage(n: number, opts: DamageOptions = {}): boolean {
    const source = opts.source ?? 'unknown';
    const now = this.now();
    // FIX-010 R3：同 source 800ms 无敌帧；[裁决] hunger 每帧连续小额扣血，豁免此帧
    if (source !== 'hunger') {
      const last = this.lastDamageAt.get(source);
      if (last !== undefined && now - last < IFRAME_MS) return false;
      this.lastDamageAt.set(source, now);
    }
    this.hp = Math.max(0, this.hp - n);
    // FIX-010 R4：入口内统一发事件（HUD 红晕 / hp 条闪烁，订阅方 ui.ts）
    bus.emit('player:damaged', { hp: this.hp, amount: n, source });
    // 晕倒沿：沿用既有一次性闩（原 :45-50 / :64-67），不新建死亡机制
    if (this.hp <= 0 && !this.fainted) {
      this.fainted = true;
      this.faints++;
      bus.emit('ui:toast', '眼前一黑……醒来时已躺在孟婆庄的竹榻上');
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

  /** 持久化快照（SaveDataV2.survival）——字段名不改名，保持兼容 */
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
