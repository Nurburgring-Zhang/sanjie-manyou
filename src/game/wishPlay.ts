// ============================================================================
// 三界造物 · 造物世界循环 · src/game/wishPlay.ts
//
// R25：把「探索 / 战斗 / 骑乘」从面板按钮变成每帧真实运行的世界行为。
//  探索：造物持续跟随玩家或自行巡游，跨过新的地格即「发现」，产出灵力与铜钱；
//  战斗：造物与敌对试炼妖兽按 DNA attack/defense 实时结算 HP，击杀产出奖励；
//        靠近世界 Boss 时造物也会造成真实（但不会越权击杀）的伤害；
//  骑乘：造物每帧贴随玩家，玩家移动时造物真的跟着走，不是一次性挪位。
//
// 纪律：不改共享 RNG、不用 Math.random；奖励走 world.interact.earn 进入既有三币经济；
//      世界对象按鸭子类型访问，World 未装配完成（载入期）时全部安全降级。
// ============================================================================
import * as THREE from 'three';
import type { Evolvable } from './wishEvolution';
import type { WishSpec } from './wishForge';

export type Behavior = 'follow' | 'roam' | 'guard' | 'ride';

export interface PlayActor {
  id: string;
  name: string;
  group: THREE.Object3D;
  ev: Evolvable;
  behavior: Behavior;
  hostile: boolean;
  hp: number;
  maxHp: number;
  baseY: number;
  pos: { x: number; y: number; z: number };
  home: { x: number; z: number };
  phase: number;
  lastCell: string;
  cells: Set<string>;
  cooldown: number;
}

export type PlayEventKind = 'discover' | 'combat' | 'kill' | 'boss' | 'ride' | 'build';

export interface PlayEvent {
  kind: PlayEventKind;
  text: string;
  xp: number;
  coins: number;
  actorId?: string;
}

/** 只依赖 World 的这几处既有接口，避免循环 import */
export interface WishWorldLike {
  player?: { actor?: { pos?: { x: number; y: number; z: number } } };
  interact?: { earn?: (n: number) => void };
  boss?: {
    hp: number;
    defeated: boolean;
    spec?: { maxHp: number };
    pos?: () => THREE.Vector3;
  };
}

export interface PlayReport {
  discoveries: number;
  hits: number;
  kills: number;
  bossHits: number;
  bossDamage: number;
  xpAwarded: number;
  coinsAwarded: number;
  travelled: number;
  actors: number;
  hostiles: number;
}

const CELL = 46;          // 探索地格边长（米）
const ENGAGE = 26;        // 造物交战距离
const BOSS_RANGE = 90;    // 参与世界 Boss 战的距离
const HIT_INTERVAL = 0.9;

function cellOf(x: number, z: number): string {
  return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
}

/** 稳定整数哈希：决定跟随偏移与巡游相位，保证同一 id 行为可复现 */
function ihash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function createPlayActor(
  id: string, name: string, group: THREE.Object3D, ev: Evolvable,
  pos: { x: number; y: number; z: number }, behavior: Behavior = 'follow', hostile = false,
): PlayActor {
  const maxHp = Math.max(40, Math.round(60 + ev.dna.defense * 1.6 + ev.dna.size * 0.8 + ev.level * 6));
  return {
    id, name, group, ev, behavior, hostile,
    hp: maxHp, maxHp,
    baseY: pos.y,
    pos: { ...pos },
    home: { x: pos.x, z: pos.z },
    phase: (ihash(id) % 628) / 100,
    lastCell: cellOf(pos.x, pos.z),
    cells: new Set<string>([cellOf(pos.x, pos.z)]),
    cooldown: HIT_INTERVAL,
  };
}

export class WishPlay {
  private actors = new Map<string, PlayActor>();
  private t = 0;
  private bossTimer = 0;
  private world: WishWorldLike | null;
  private emit: (e: PlayEvent) => void;
  readonly report: PlayReport = {
    discoveries: 0, hits: 0, kills: 0, bossHits: 0, bossDamage: 0,
    xpAwarded: 0, coinsAwarded: 0, travelled: 0, actors: 0, hostiles: 0,
  };

  constructor(world: WishWorldLike | null, emit: (e: PlayEvent) => void) {
    this.world = world;
    this.emit = emit;
  }

  add(a: PlayActor): void { this.actors.set(a.id, a); this.refresh(); }
  remove(id: string): void { this.actors.delete(id); this.refresh(); }
  get(id: string): PlayActor | undefined { return this.actors.get(id); }
  all(): PlayActor[] { return Array.from(this.actors.values()); }
  size(): number { return this.actors.size; }

  setBehavior(id: string, b: Behavior): boolean {
    const a = this.actors.get(id);
    if (!a) return false;
    a.behavior = b;
    return true;
  }
  setAllBehavior(b: Behavior): void {
    for (const a of this.actors.values()) if (!a.hostile) a.behavior = b;
  }

  private refresh(): void {
    this.report.actors = this.actors.size;
    this.report.hostiles = Array.from(this.actors.values()).filter((a) => a.hostile).length;
  }

  private playerPos(): { x: number; y: number; z: number } {
    const p = this.world?.player?.actor?.pos;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, y: p.y ?? 0, z: p.z };
    return { x: 0, y: 0, z: 0 };
  }

  private reward(e: PlayEvent, xpTarget: string | undefined, onXp: (id: string, n: number) => void): void {
    this.emit(e);
    this.report.xpAwarded += e.xp;
    this.report.coinsAwarded += e.coins;
    if (e.xp > 0 && xpTarget) onXp(xpTarget, e.xp);
    if (e.coins > 0) {
      try { this.world?.interact?.earn?.(e.coins); } catch { /* 经济系统未就绪：只记事件，不抛错 */ }
    }
  }

  /**
   * 每帧真实世界循环。onXp 由 panel 注入（改 DNA / 自动进化 / 换几何）。
   * 返回本帧死亡实体 id，由 panel 移除模型。
   */
  tick(dt: number, onXp: (id: string, n: number) => void): string[] {
    const d = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    if (d <= 0) return [];
    this.t += d;
    this.bossTimer += d;
    const pp = this.playerPos();
    const dead: string[] = [];

    // ① 移动 / 探索：跟随、巡游、守卫、骑乘、敌对追击
    for (const a of this.actors.values()) {
      const before = { x: a.pos.x, z: a.pos.z };
      let tx = a.pos.x, tz = a.pos.z;
      if (a.hostile) {
        let near: PlayActor | null = null, bd = Infinity;
        for (const o of this.actors.values()) {
          if (o.hostile || o.hp <= 0) continue;
          const dd = Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
          if (dd < bd) { bd = dd; near = o; }
        }
        if (near) { tx = near.pos.x; tz = near.pos.z; }
        else { tx = pp.x; tz = pp.z; }
      } else if (a.behavior === 'follow' || a.behavior === 'ride') {
        const ang = a.phase + (ihash(a.id + 'off') % 100) / 100 * 0.8;
        const dist = a.behavior === 'ride' ? 0.6 : 4.2 + (ihash(a.id) % 7) * 0.4;
        tx = pp.x + Math.cos(ang) * dist;
        tz = pp.z + Math.sin(ang) * dist;
      } else if (a.behavior === 'roam') {
        const r = 9 + (ihash(a.id + 'r') % 12);
        tx = a.home.x + Math.cos(this.t * 0.22 + a.phase) * r;
        tz = a.home.z + Math.sin(this.t * 0.22 + a.phase) * r;
      }
      const k = Math.min(1, d * (a.hostile ? 1.1 : 1.7));
      a.pos.x += (tx - a.pos.x) * k;
      a.pos.z += (tz - a.pos.z) * k;
      const moved = Math.hypot(a.pos.x - before.x, a.pos.z - before.z);
      this.report.travelled += moved;
      a.group.position.x = a.pos.x;
      a.group.position.z = a.pos.z;
      a.group.position.y = a.baseY + Math.sin(this.t * 1.3 + a.phase) * 0.28
        + (a.behavior === 'ride' ? 0.9 : 0);
      a.group.rotation.y += d * 0.16;

      // 跨新地格 = 发现（每格只算一次，避免站着刷 XP）
      const c = cellOf(a.pos.x, a.pos.z);
      if (c !== a.lastCell) {
        a.lastCell = c;
        if (!a.cells.has(c)) {
          a.cells.add(c);
          this.report.discoveries++;
          const spots = ['汴河码头', '州桥夜市', '大相国寺', '皇城丹陛', '郊野桑田', '云台石径', '山间溪谷', '旧坊瓦肆'];
          const spot = spots[(ihash(c) >>> 0) % spots.length];
          this.reward({
            kind: 'discover', actorId: a.id, xp: 12, coins: 6,
            text: `探索：${a.name} 行至${spot}，发现新地格（累计 ${a.cells.size} 格）`,
          }, a.id, onXp);
        }
      }
    }

    // ② 造物对战：DNA attack / defense 实时结算
    const alive = Array.from(this.actors.values()).filter((a) => a.hp > 0);
    for (const a of alive) {
      a.cooldown -= d;
      if (a.cooldown > 0) continue;
      a.cooldown = HIT_INTERVAL;
      const foes = alive.filter((o) => o.hostile !== a.hostile && o.hp > 0
        && Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < ENGAGE);
      if (!foes.length) continue;
      foes.sort((p, q) => Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z) - Math.hypot(q.pos.x - a.pos.x, q.pos.z - a.pos.z));
      const target = foes[0];
      const dmg = Math.max(3, Math.round(6 + a.ev.dna.attack * 0.32 + a.ev.level * 1.4 - target.ev.dna.defense * 0.12));
      target.hp = Math.max(0, target.hp - dmg);
      this.report.hits++;
      this.emit({ kind: 'combat', actorId: a.id, xp: 0, coins: 0, text: `战斗：${a.name} 击中 ${target.name}，造成 ${dmg} 伤害（${target.hp}/${target.maxHp}）` });
      if (target.hp === 0) {
        this.report.kills++;
        dead.push(target.id);
        const winner = a.hostile ? target.id : a.id;
        this.reward({
          kind: 'kill', actorId: winner, xp: 90, coins: 36,
          text: `胜战：${a.name} 击溃 ${target.name}，获灵力 90 / 铜钱 36 文`,
        }, winner, onXp);
      }
    }
    for (const id of dead) this.remove(id);

    // ③ 参与世界 Boss 战：真实扣血，但保底 1 点，不越权触发击杀奖励
    const boss = this.world?.boss;
    if (boss && !boss.defeated && boss.hp > 1 && typeof boss.pos === 'function' && this.bossTimer >= 1.6) {
      this.bossTimer = 0;
      let bp: THREE.Vector3;
      try { bp = boss.pos(); } catch { bp = new THREE.Vector3(pp.x, pp.y, pp.z); }
      for (const a of this.actors.values()) {
        if (a.hostile || a.hp <= 0) continue;
        if (Math.hypot(a.pos.x - bp.x, a.pos.z - bp.z) > BOSS_RANGE) continue;
        // 助战有上限：累计最多削去 Boss 25% 血量，且保底 1 点，
        // 不越权击杀、也不把 Boss 打到残血而破坏既有斗法节奏。
        const cap = Math.max(1, Math.floor((boss.spec?.maxHp ?? boss.hp + this.report.bossDamage) * 0.25));
        if (this.report.bossDamage >= cap) break;
        const dmg = Math.min(
          Math.max(0, boss.hp - 1), cap - this.report.bossDamage,
          Math.max(1, Math.round(a.ev.dna.attack * 0.05 + a.ev.level)),
        );
        if (dmg <= 0) continue;
        boss.hp -= dmg;
        this.report.bossHits++;
        this.report.bossDamage += dmg;
        this.reward({
          kind: 'boss', actorId: a.id, xp: 20, coins: 0,
          text: `斗法：${a.name} 助战，对 Boss 造成 ${dmg} 伤害`,
        }, a.id, onXp);
      }
    }
    return dead;
  }

  /** 生成一只敌对试炼妖兽，供「战斗」玩法真实开打 */
  static hostileSpec(name = '试炼妖兽'): WishSpec {
    return {
      name, archetype: 'beast',
      traits: ['獠牙', '凶焰', '甲胄', '疾行'],
      colors: [0x8b2f2f, 0x2a2320, 0xffa03c],
      scale: 1.1, seed: ihash(name) >>> 0, source: 'param',
    };
  }
}
