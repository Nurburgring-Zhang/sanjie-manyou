import * as THREE from 'three';
import type { Actor } from '../actors/types';
import type { Random } from '../actors/behaviors';
import type { Vfx } from '../fx/vfx';
import type { PlayerController } from './player';
import { bus, RNG } from '../core/rng';
import type { BossSpec } from '../data/boss';

/**
 * 擂台 Boss 状态机（首个遭遇：天宫擂台 · 巨灵神）。
 *
 * 为什么单开一份而不是改 `sky/havoc.ts`：havoc 是**自动播放的名场面**，玩家输入改不了任何状态，
 * 按 `SPEC-游戏工程规范.md` §10 不能算 Boss。这里做的是可打的：玩家出手 → 掉血 → 阶段跃迁 →
 * 被击中 → 复位重开，全部可被 `scripts/probe-boss.mjs` 断言。
 *
 * 状态流转：idle →（玩家进 34m）engage → telegraph → active → engage … → dead
 *           玩家被 active 命中 → reset()（回恢复点，Boss 血量复位，等待 respawnDelay）
 */
export type BossState = 'idle' | 'engage' | 'telegraph' | 'active' | 'dead' | 'respawning';

/**
 * 旧路径默认随机源：core/rng 的 mulberry32（固定种子，与 behaviors/crowd 同款口径）。
 * 出招判定影响 sim（grab/sweep 分支改变后续全部行为序列），必须可复现；
 * 联机 / 回放 / 无头测试必须显式注入 rng——照 behaviors.ts / crowd.ts 的注入规矩。
 */
const DEFAULT_RNG: Random = (() => {
  const r = new RNG(0x5e7a1);
  return () => r.next();
})();

export class ArenaBoss {
  readonly spec: BossSpec;
  hp: number;
  phase: 1 | 2 = 1;
  state: BossState = 'idle';
  defeated = false;
  /** 累计被玩家命中次数（诊断用，probe 断言用） */
  hits = 0;
  /** 玩家被击退次数 */
  knockbacks = 0;
  /** 最近一次起手的招式（'' = 还没起手）；探针用它断言「阶段 2 才允许抓取」 */
  lastMove: 'sweep' | 'grab' | '' = '';
  readonly home = new THREE.Vector3();
  private timer = 0;
  private cd = 0;
  private respawnT = 0;
  /** 连续脱离战斗的时长（脱战回血与状态收口共用的闸门） */
  private outT = 0;
  /** 击败后战果条保留时长（秒，sim-time） */
  private defeatFade = 3;
  private bar: HTMLDivElement | null = null;
  private fill: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private next: 'sweep' | 'grab' = 'sweep';
  /** 注入随机源：出招判定（rollMove）用。默认 DEFAULT_RNG 单机行为可复现；测试/回放显式传入 */
  rng: Random = DEFAULT_RNG;
  /** P2-3：HUD 文本缓存——只有变化才写 DOM（旧版每帧 new span + replaceChildren） */
  private numSpan: HTMLSpanElement | null = null;
  private lastLabel = '';
  private lastNum = '';

  constructor(
    spec: BossSpec,
    private actor: Actor | undefined,
    home: THREE.Vector3,
    private vfx: Vfx,
    /** 玩家在「化身与交互」步才创建，Boss 在「云起天宫」步就先于玩家存在 —— 必须传 getter，不能传实例 */
    private getPlayer: () => PlayerController | undefined,
    private onDefeat: () => void,
    private onKnockback: () => void,
  ) {
    this.spec = spec;
    this.hp = spec.maxHp;
    this.home.copy(home);
    this.mountHud();
    this.syncHud();
  }

  /** Boss 世界坐标（有化身用化身，没有就用擂台心） */
  pos(): THREE.Vector3 {
    return this.actor ? this.actor.pos : this.home;
  }

  private playerPos(): THREE.Vector3 {
    const pc = this.getPlayer();
    const a = pc?.actor;
    return a ? a.pos : this.home;
  }

  private dist(): number {
    const b = this.pos(), p = this.playerPos();
    return Math.hypot(b.x - p.x, b.z - p.z);
  }

  /** 抓取的阶段闸门：只有阶段 2 允许（探针可直接读这个字段） */
  get canGrab(): boolean { return this.phase === 2; }

  /**
   * 招式选择：阶段 1 一律横扫，抓取是阶段 2 的专属招式。
   * 用显式守卫，而不是在概率表达式里夹一个 `phase === 2` —— 以后改概率或加招式时，
   * 不会顺手把阶段 1 的抓取放出来。
   */
  private rollMove(): 'sweep' | 'grab' {
    if (!this.canGrab) return 'sweep';
    return this.rng() < 0.45 ? 'grab' : 'sweep';
  }

  /** 玩家出手：真实输入（KeyJ / 屏幕点击）经 world 转到这里 */
  playerAttack(): boolean {
    if (this.defeated || this.state === 'dead' || this.state === 'respawning') return false;
    if (this.cd > 0) return false;
    if (this.dist() > this.spec.meleeRange) {
      bus.emit('ui:toast', `太远了 —— 靠近${this.spec.name}再出手`);
      return false;
    }
    this.cd = this.spec.hitCooldown;
    const dmg = this.spec.hitDamage[this.phase - 1];
    this.hp = Math.max(0, this.hp - dmg);
    this.hits++;
    this.vfx.burst(this.pos().clone().add(new THREE.Vector3(0, 3.2, 0)), 26, 0xffd27a, 9, 1, 1.2);
    bus.emit('sfx:pick');
    // 阶段跃迁：跨越阈值的那一次立即换阶段（HUD 文案与特效同步）
    const ratio = this.hp / this.spec.maxHp;
    if (this.phase === 1 && ratio <= this.spec.phase2At) {
      this.phase = 2;
      bus.emit('ui:toast', `${this.spec.name} · ${this.spec.phaseName[1]}`);
      bus.emit('sfx:gong');
      this.vfx.ring(this.pos().clone().setY(this.pos().y + 0.4), 0xff5a3c, 22, 0.8);
    }
    if (this.hp === 0) {
      this.state = 'dead';
      this.defeated = true;
      this.defeatFade = 3;
      this.syncHud();   // 让「已伏誅 0/320」先显示出来，再由 update 计时淡出
      bus.emit('ui:toast', `${this.spec.name} 伏誅 —— 图鉴已收录`);
      bus.emit('sfx:buddha');
      this.vfx.burst(this.pos().clone().add(new THREE.Vector3(0, 4, 0)), 120, 0xffe6a8, 18, 1.4, 2.2);
      this.onDefeat();
    }
    this.syncHud();
    return true;
  }

  /** 失败：被命中 → 回恢复点 + 血量复位（代价是这次际遇进度清零） */
  private knockback(reason: string): void {
    this.knockbacks++;
    bus.emit('ui:toast', `${reason} —— 被${this.spec.name}击退，本次际遇归零`);
    bus.emit('sfx:boom');
    this.state = 'respawning';
    this.respawnT = this.spec.respawnDelay;
    // 代价 = 位置清零 + 脱战回血（15%/s）。不再一击满血：那样站桩玩家永远赢不了，
    // 一场 32 次命中的仗被一次失误全部抹平，是设计缺陷而不是难度。
    this.syncHud();
    this.onKnockback();
  }

  update(dt: number): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.defeated) {
      // P-05 / UI-02：击败后旧版直接 return，syncHud 再不被调用 → 「已伏誅 0/320」血条锁死常驻。
      // 战果保留 3s 供玩家看到，然后淡出（用 sim-time dt，不用墙钟定时器）。
      if (this.defeatFade > 0) {
        this.defeatFade -= dt;
        if (this.defeatFade <= 0 && this.bar) this.bar.style.opacity = '0';
      }
      return;
    }
    if (this.state === 'respawning') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.state = 'engage';
      return;
    }
    const d = this.dist();
    // 脱战回血：玩家被击退/离开 34m 之外，Boss 每秒回 15% —— 离开是有代价的，但不会被一次失误清零
    // 脱战 2.5s 后才开始回血（4%/s）：闪避 1.2s 不算脱战，否则「撤一步回血」会让仗永远打不完
    if (!this.defeated && d > this.spec.engageRange) this.outT += dt; else this.outT = 0;
    // 全量审核 2026-11-07（P-05 / UI-02）：数值层早已把「离开 34m 超过 2.5s」当脱战，
    // 但状态层原本**没有任何回 idle 的分支** —— 一旦 engage 就永久停在
    // engage→telegraph→active→engage 环里：血条整会话常驻、玩家回人间后天宫 Boss 仍空转放招发音效。
    // 这里复用同一 outT 闸门做状态收口，与回血语义一致（幂等）。
    if (!this.defeated && this.outT > 2.5 && this.state !== 'idle') {
      this.state = 'idle';
      this.timer = 0;
      this.outT = 0;
      this.syncHud();
      return;
    }
    if (this.outT > 2.5 && this.hp < this.spec.maxHp) {
      this.hp = Math.min(this.spec.maxHp, this.hp + this.spec.maxHp * 0.04 * dt);
      this.syncHud();
    }
    if (this.state === 'idle') {
      if (d <= this.spec.engageRange) {
        this.state = 'engage';
        this.timer = this.spec.interval[this.phase - 1];
        bus.emit('ui:toast', `${this.spec.name} 拦住了去路 —— 按 J 出手`);
        this.syncHud();
      }
      return;
    }
    if (this.state === 'engage') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.next = this.rollMove();
        this.lastMove = this.next;   // 起手即记录：探针按 phase + lastMove 断言阶段闸门
        const t = this.next === 'sweep' ? this.spec.sweep.telegraph : this.spec.grab.telegraph;
        this.timer = t;
        this.state = 'telegraph';
        // 前摇三通道：地面预警环 + 低频轰鸣 + 文案
        const r = this.next === 'sweep' ? this.spec.sweep.range : this.spec.grab.range;
        this.vfx.ring(this.pos().clone().setY(this.pos().y + 0.3), this.next === 'sweep' ? 0xff3a2a : 0xffb300, r, t);
        bus.emit('sfx:drum');
      }
      return;
    }
    if (this.state === 'telegraph') {
      this.timer -= dt;
      if (this.timer <= 0) {
        // 兜底守卫：阶段 1 绝不放擒拿（正常 rollMove 不会产出，防未来改概率/阶段回退）
        if (this.next === 'grab' && !this.canGrab) {
          this.next = 'sweep';
          this.lastMove = 'sweep';
        }
        const cfg = this.next === 'sweep' ? this.spec.sweep : this.spec.grab;
        this.timer = cfg.active;
        this.state = 'active';
        this.vfx.burst(this.pos().clone().setY(this.pos().y + 1.2), 40, 0xffb060, 14, 1, 1.4);
        if (d <= cfg.range) this.knockback(this.next === 'sweep' ? '横扫命中' : '擒拿得手');
      }
      return;
    }
    if (this.state === 'active') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'engage';
        this.timer = this.spec.interval[this.phase - 1];
      }
    }
  }

  // ---- HUD：自带一条血条，不侵入 ui.ts（面板开合自成一套，避免相互耦合） ----
  private mountHud(): void {
    if (typeof document === 'undefined' || document.getElementById('bossbar')) return;
    const wrap = document.createElement('div');
    wrap.id = 'bossbar';
    // 全量审核 2026-11-07（UI-01）：旧版挂 document.body、z-index:30，脱离 #ui 管控 ——
    // H 键隐藏全部 UI 后红条仍在，且盖住顶栏/toast。改挂 #ui 内并把 z 收进 20–29 带。
    wrap.style.cssText = 'position:absolute;left:50%;top:66px;transform:translateX(-50%);width:min(420px,52vw);'
      + 'pointer-events:none;opacity:0;transition:opacity .3s;z-index:24;font:12px/1.4 system-ui,sans-serif;color:#f2e6cf;';
    const name = document.createElement('div');
    name.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px;text-shadow:0 1px 3px #000;';
    const label = document.createElement('div');
    const track = document.createElement('div');
    track.style.cssText = 'height:7px;background:rgba(10,12,18,.72);border:1px solid rgba(210,180,120,.5);border-radius:4px;overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#8a1f16,#ff6a3c);transition:width .18s;';
    this.label = name;
    track.appendChild(fill);
    wrap.appendChild(name); wrap.appendChild(track);
    (document.getElementById('ui') ?? document.body).appendChild(wrap);
    this.bar = wrap; this.fill = fill;
    this.hudName = label;
    void label;
  }
  private hudName: HTMLDivElement | null = null;

  private syncHud(): void {
    if (!this.bar || !this.fill || !this.label) return;
    const active = !this.defeated && this.state !== 'idle';
    this.bar.style.opacity = active || this.defeated ? '1' : '0';
    this.fill.style.width = `${(this.hp / this.spec.maxHp) * 100}%`;
    // P2-3：只有文本变化才碰 DOM（旧版每帧 new span + replaceChildren）
    const labelText = `${this.spec.name} · ${this.defeated ? '已伏誅' : this.spec.phaseName[this.phase - 1]}`;
    if (labelText !== this.lastLabel) {
      this.lastLabel = labelText;
      this.label.textContent = labelText;
      this.numSpan = document.createElement('span');
      this.label.appendChild(this.numSpan);
      this.lastNum = '';
    }
    const numText = `${Math.round(this.hp)} / ${this.spec.maxHp}`;
    if (numText !== this.lastNum && this.numSpan) {
      this.lastNum = numText;
      this.numSpan.textContent = numText;
    }
  }
}
