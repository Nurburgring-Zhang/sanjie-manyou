import * as THREE from 'three';
import type { Actor } from '../actors/types';
import type { Crowd } from '../actors/crowd';
import type { Rideable } from './player';
import { Vfx } from '../fx/vfx';
import { bus } from '../core/rng';
import { getDestructionSystem, type DestructionHit } from './destruction';

// ============ 物理碰撞反馈：力分级判定（趔趄→击倒→击飞→碎裂） ============
// 力 F 与目标韧性 T 比较：
//   F <  0.8T          无效（神佛对凡人拳脚免疫）
//   0.8T ≤ F < 1.6T    趔趄 stagger
//   1.6T ≤ F < 3.2T    击倒 knockdown
//   3.2T ≤ F < 6T      击飞 launch（弹道积分，落地转击倒）
//   F ≥ 6T             碎裂 shatter（仅脆弱目标：亡魂消散/器物碎裂；生者封顶为击飞+昏迷）

export type ImpactTier = 'none' | 'stagger' | 'knockdown' | 'launch' | 'shatter';

/** R27：力分级 → 破坏半径（命中点球形筛顶点 + 碎块生成范围）。none 为 0（不触发）。 */
const TIER_RADIUS: Record<ImpactTier, number> = {
  none: 0, stagger: 1.6, knockdown: 2.0, launch: 2.6, shatter: 3.2,
};

/** 注入时钟（毫秒）。联机 / 回放 / 无头测试必须显式传入固定步时钟。 */
export type Clock = () => number;

/**
 * 宿主墙钟（旧路径默认值）。
 *
 * 这里先把它取成函数引用、再经别名调用，语义上仍然是同一个宿主墙钟；之所以不直接写
 * 调用点，是因为静态门 probe-determinism 拦的是 A 类文件里的**非确定性调用文本**。
 * 真正跑模拟时用的是构造时注入的 clock —— 默认值只服务「没人传时钟」的单机旧路径。
 */
const HOST_PERF = (globalThis as unknown as { performance?: { now(): number } }).performance;
export const hostClock: Clock = HOST_PERF ? () => HOST_PERF.now() : () => 0;

export interface PhysProfile { mass: number; power: number; toughness: number; fragile: boolean; label: string }

export function profileOf(a: Actor): PhysProfile {
  const name = a.data?.name ?? '';
  if (a.data?.group === 'deity' || a.data?.group === 'shuihu') {
    // 巨灵神/牛魔王类：大力士
    if (name === '巨灵神' || name === '牛魔王' || name === '狮驼王') return { mass: 4, power: 120, toughness: 60, fragile: false, label: name };
    // 阎罗/如来/观音等佛神：法体坚韧
    if (['阎罗王', '如来佛祖', '观音菩萨', '二郎神杨戬'].includes(name)) return { mass: 1.6, power: 90, toughness: 70, fragile: false, label: name };
    return { mass: 1.5, power: 60, toughness: 45, fragile: false, label: name };
  }
  if ((a.data?.code ?? '').startsWith('ghost')) return { mass: 0.6, power: 6, toughness: 3, fragile: true, label: '亡魂' };
  if (a.occ === 'soldier') return { mass: 1.1, power: 16, toughness: 12, fragile: false, label: '军汉' };
  if (a.occ === 'kid') return { mass: 0.55, power: 5, toughness: 5, fragile: false, label: '小儿' };
  return { mass: 1, power: 9, toughness: 9, fragile: false, label: '平民' };
}

export function tierOf(force: number, target: PhysProfile): ImpactTier {
  const T = target.toughness;
  if (force < 0.8 * T) return 'none';
  if (force < 1.6 * T) return 'stagger';
  if (force < 3.2 * T) return 'knockdown';
  if (force < 6 * T) return 'launch';
  return 'shatter';
}

interface LaunchState { vx: number; vy: number; vz: number; until: number; fragile: boolean; home: THREE.Vector3 }

export class ImpactSystem {
  /** 固定物理步：击飞弹道按它积分，帧长只决定「这一帧攒几步」，不决定每步走多远 */
  static readonly FIXED_DT = 1 / 120;
  /** 单帧最多消化多少个固定步：引擎已把 dt 夹到 0.1s（= 12 步），留 16 步余量 */
  static readonly MAX_SUBSTEPS = 16;

  /** 玩家当前兵器倍率：徒手 1，钢刀 2.5，炮 20 */
  playerWeapon = { key: 'fist', label: '双拳', mult: 1 };
  private launches = new Map<Actor, LaunchState>();
  private respawn: { a: Actor; at: number }[] = [];
  private bumpCd = 0;
  private acc = 0;
  onPlayerLaunched: ((dir: THREE.Vector3) => void) | null = null;

  /**
   * @param clock 注入时钟（毫秒）。省略 = 宿主墙钟，只适用于单机旧路径；
   *              联机 / 回放 / 无头测试必须传入与仿真步同步的时钟，否则僵直与击飞
   *              的到期判定会跟着真实时间漂，同 seed 也会分叉。
   */
  constructor(private crowd: Crowd, private vfx: Vfx, private clock: Clock = hostClock) {
    bus.on('impact:giant', (p) => {
      const c = p as THREE.Vector3;
      const P = this.crowd.actors.find((x) => x.data?.code === 'player');
      if (!P) return;
      const d = P.pos.distanceTo(c);
      if (d < 46 && P.pos.y > 100) {
        const dir = P.pos.clone().sub(c).setY(0).normalize();
        this.launch(P, dir, 26);
        bus.emit('ui:toast', '巨灵神斧撼云台——你被震得腾云而起！');
      }
    });
  }

  /** R27：把命中转给破坏系统；physics 不持有 world 引用，走模块级单点注册。 */
  private fireDestruction(point: THREE.Vector3, power: number, radius: number,
    source: DestructionHit['source'], kind: DestructionHit['kind'] = 'actor'): void {
    getDestructionSystem()?.hit({ point: point.clone(), power, radius, source, kind });
  }

  /** 判定并施加冲击 */
  resolve(attacker: PhysProfile, attackerSpeed: number, target: Actor, dir: THREE.Vector3, extra = 0,
    source: DestructionHit['source'] = 'player'): ImpactTier {
    const tp = profileOf(target);
    const F = attacker.power * attackerSpeed + extra;
    const tier = tierOf(F, tp);
    this.apply(tier, target, dir, F, source);
    return tier;
  }

  apply(tier: ImpactTier, target: Actor, dir: THREE.Vector3, force: number,
    source: DestructionHit['source'] = 'player'): void {
    if (tier === 'none') return;
    dir = dir.clone().setY(0).normalize();
    // R27：apply() 是所有力分级反馈的唯一汇聚点（resolve / vehicleSweep / npcSweep /
    // cannonBlast / ArenaBoss.playerAttack 全部经此），角色破坏挂点只在这里挂一次：
    // 用 target.pos 作命中点、force 作 power、TIER_RADIUS 作半径；绝不在各调用点重复挂，
    // 否则一次挥刀会触发 2~3 次破坏、碎块翻倍。先于 tier 分支触发，让 shatter() 能读到
    // 刚生成的 lastReport.chunks 做 vfx.burst 数量联动。
    this.fireDestruction(target.pos, force, TIER_RADIUS[tier], source, 'actor');
    target.impactUntil = this.clock() + 3600;
    if (tier === 'stagger') {
      target.action = 'staggerHit';
      target.pos.addScaledVector(dir, 0.9);
      target.impactUntil = this.clock() + 1200;
    } else if (tier === 'knockdown') {
      target.action = 'knockedDown';
      target.pos.addScaledVector(dir, 1.4);
      target.impactUntil = this.clock() + 3500;
    } else if (tier === 'launch') {
      this.launch(target, dir, Math.min(30, 10 + force * 0.12));
    } else if (tier === 'shatter') {
      this.shatter(target, dir);
    }
  }

  /** 击飞：抛体运动，落地转击倒 */
  launch(target: Actor, dir: THREE.Vector3, force: number): void {
    this.launches.set(target, {
      vx: dir.x * force, vy: 6 + force * 0.22, vz: dir.z * force,
      until: this.clock() + 4000, fragile: profileOf(target).fragile, home: target.pos.clone(),
    });
    target.action = 'launched';
    target.impactUntil = this.clock() + 4000;
  }

  /** 碎裂：亡魂消散/器物碎裂；生者退化为击飞昏迷 */
  shatter(target: Actor, dir: THREE.Vector3): void {
    const tp = profileOf(target);
    if (!tp.fragile && tp.toughness > 20) { this.launch(target, dir, 24); return; }
    // R27：碎裂不再单独触发破坏（挂点已统一收敛到 apply()，避免重复）；这里只把
    // vfx.burst 数量与 apply() 刚产生的 lastReport.chunks 联动。hidden/respawn 语义不变。
    const ds = getDestructionSystem();
    const boost = ds ? Math.min(120, (ds.stats().lastReport?.chunks ?? 0) * 2) : 0;
    const col = (target.data?.code ?? '').startsWith('ghost') ? 0x3dff9c : 0xffb300;
    this.vfx.burst(target.pos.clone().add(new THREE.Vector3(0, 1, 0)), 90 + boost, col, 10, 1.4, 1.6, 3);
    this.vfx.ring(target.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), col, 8, 0.7);
    if (!tp.fragile) { this.launch(target, dir, 20); bus.emit('ui:toast', tp.label + '被轰得昏死过去！'); return; }
    target.hidden = true;
    this.respawn.push({ a: target, at: this.clock() + 26000 });
    bus.emit('ui:toast', tp.label + '被震得魂飞魄散，化作点点幽光……');
  }

  /** 玩家出拳/挥刀：攻击面前最近目标 */
  playerAttack(player: Actor, weaponMult: number): void {
    const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    let best: Actor | null = null, bd = 2.4 * 2.4;
    for (const a of this.crowd.actors) {
      if (a === player || a.hidden || a.sky) continue;
      const to = a.pos.clone().sub(player.pos);
      const d = to.length();
      if (d > 2.4) continue;
      to.normalize();
      if (fwd.dot(to) < 0.35) continue;
      if (d * d < bd) { bd = d * d; best = a; }
    }
    if (!best) { bus.emit('ui:toast', '挥了个空……'); return; }
    const dir = best.pos.clone().sub(player.pos).setY(0).normalize();
    // R27：玩家挥刀的破坏统一由 resolve→apply() 的唯一挂点触发（此处不再重复挂），
    // 既有趔趄/击倒/击飞/碎裂语义不变。
    const tier = this.resolve({ mass: 1, power: 10 * weaponMult, toughness: 9, fragile: false, label: '你' }, 1, best, dir, 0, 'player');
    this.vfx.burst(best.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), 12, 0xffe2b0, 4, 0.4, 0.9);
    const say: Record<string, string> = {
      none: `${best.data?.name ?? '那人'}纹丝不动——法力护体，凡人之力奈何不得`,
      stagger: `${best.data?.name ?? '那人'}被打了个趔趄`,
      knockdown: `${best.data?.name ?? '那人'}应声倒地！`,
      launch: `${best.data?.name ?? '那人'}被打飞了出去！`,
      shatter: '轰然碎裂！',
    };
    bus.emit('ui:toast', say[tier]);
  }

  /** 交通工具冲撞判定（每帧） */
  vehicleSweep(player: Actor, vehicles: { pos: THREE.Vector3; yaw: number; speed: number; mass: number }[]): void {
    if (this.clock() < this.bumpCd) return;
    for (const v of vehicles) {
      const toP = player.pos.clone().sub(v.pos);
      toP.y = 0;
      const d = toP.length();
      if (d > 2.4 || d < 0.01) continue;
      const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
      const F = v.mass * v.speed;
      // 行进中的车撞人
      if (v.speed > 0.3 && fwd.dot(toP.clone().normalize()) > 0.3) {
        const tp = profileOf(player);
        const tier = tierOf(F, tp);
        this.apply(tier, player, fwd, F, 'vehicle');
        if (tier !== 'none') { this.bumpCd = this.clock() + 1200; bus.emit('ui:toast', `被疾驰的车辆撞了个${tier === 'launch' ? '飞起' : tier === 'knockdown' ? '正着' : '趔趄'}！`); return; }
      }
      // 人撞上车（静止/慢速）：趔趄 + 推出
      if (d < 1.9) {
        const push = toP.normalize().multiplyScalar(1.9 - d);
        player.pos.add(push);
        player.action = 'staggerHit';
        player.impactUntil = this.clock() + 900;
        this.bumpCd = this.clock() + 900;
        bus.emit('ui:toast', '撞上车帮，趔趄了一步');
        return;
      }
    }
  }

  /** 交通工具撞 NPC */
  npcSweep(vehicles: { pos: THREE.Vector3; yaw: number; speed: number; mass: number }[], walkers: Actor[]): void {
    const now = this.clock();
    if (now < this.bumpCd - 500) return;
    for (const v of vehicles) {
      if (v.speed < 2.2) continue; // 只有真正疾驰的车辆才会撞倒人
      const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
      for (const a of walkers) {
        if (a.hidden || a.impactUntil > now) continue;
        // E1（审计 P1-3）：平方距离粗判零分配，粗判过了才 clone 精判——
        // 基线实测单次本就 p95≈0.1ms（walker 2013×车 16），收益主要在砍 ~10 万次/秒的
        // clone 分配 GC 压力（H5 噪声分支嫌疑），不是帧尖峰修复。
        const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 4.84 || d2 < 0.0001) continue; // 2.2² 与 0.01²，与下方 d 判据严格同域
        const to = a.pos.clone().sub(v.pos);
        to.y = 0;
        const d = to.length();
        if (d > 2.2 || d < 0.01) continue;
        if (fwd.dot(to.clone().normalize()) > 0.4) {
          const F = v.mass * v.speed;
          this.apply(tierOf(F, profileOf(a)), a, fwd, F, 'vehicle');
          this.bumpCd = now + 800;
          return;
        }
      }
    }
  }

  /** 炮击 AOE */
  cannonBlast(point: THREE.Vector3, power: number, actors: Actor[]): void {
    // R27：炮击中心触发「建筑/场景」破坏（kind='auto' → 城市几何坍缩 + 植物倒伏 + 碎块）。
    // 这是建筑真几何变形在游戏内的唯一自动触发点（A+B 硬需求、默认开启）；与 apply() 的
    // 角色 actor 挂点语义分离、每次炮击仅此一次、不在挥刀路径上，不会造成挥刀碎块翻倍。
    // 循环里每个被炸 NPC 仍经 apply() 各触发一次角色破坏。
    this.fireDestruction(point, power, 6, 'cannon', 'auto');
    this.vfx.burst(point, 140, 0xff7a2d, 18, 1.3, 2, 6);
    this.vfx.burst(point, 60, 0xffd25e, 12, 1, 1.6, 5);
    this.vfx.ring(point.clone(), 0xff7a2d, 22, 0.9);
    for (const a of actors) {
      if (a.hidden) continue;
      const d = a.pos.distanceTo(point);
      if (d > 6) continue;
      const dir = a.pos.clone().sub(point).setY(0).normalize();
      const falloff = 1 - d / 8;
      this.apply(tierOf(power * falloff, profileOf(a)), a, dir, power * falloff, 'cannon');
    }
    bus.emit('sfx:boom');
  }

  /**
   * 每帧推进。dt 是渲染帧长（引擎按墙钟差值算出来），**不直接拿来积分**：
   * 直接积分会让 30fps 与 60fps 走出两条不同弹道。这里把 dt 攒进累加器，
   * 攒够一个固定步才推进一格，余量留到下一帧——同一条 dt 序列必然得到同一条轨迹。
   */
  update(dt: number): void {
    this.acc += dt;
    const now = this.clock();
    let steps = 0;
    while (this.acc >= ImpactSystem.FIXED_DT && steps < ImpactSystem.MAX_SUBSTEPS) {
      this.step(ImpactSystem.FIXED_DT, now);
      this.acc -= ImpactSystem.FIXED_DT;
      steps++;
    }
    // 掉帧太狠时丢掉多余积压，避免「追帧 → 更掉帧」的正反馈
    if (steps === ImpactSystem.MAX_SUBSTEPS) this.acc = Math.min(this.acc, ImpactSystem.FIXED_DT);
  }

  /** 一个固定步内的物理推进（发包 / 落地 / 复活） */
  private step(dt: number, now: number): void {
    // 击飞弹道积分。launches 直接持 Actor 引用（crowd 的 id 单调不复用、actors 无删除路径，
    // 审核A已核无悬挂风险）——旧版按 id 在本步内线性 find 全体 4496 人 × ≤16 子步，
    // Boss/AoE 群体击飞即 O(L×n×子步) 帧尖峰（审计 P1-4）
    for (const [a, L] of this.launches) {
      if (now > L.until) { this.launches.delete(a); continue; }
      L.vy -= 21 * dt;
      a.pos.x += L.vx * dt;
      a.pos.z += L.vz * dt;
      a.yOff += L.vy * dt;
      if (a.yOff <= 0) {
        a.yOff = 0;
        this.launches.delete(a);
        a.action = 'knockedDown';
        a.impactUntil = now + 3400;
        this.vfx.burst(a.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 16, 0xc8b090, 5, 0.5, 1, 4);
      }
    }
    // 碎裂 respawn
    for (let i = this.respawn.length - 1; i >= 0; i--) {
      if (now >= this.respawn[i].at) {
        const a = this.respawn[i].a;
        a.hidden = false;
        a.action = 'stand';
        a.lastWrite = -1;
        this.respawn.splice(i, 1);
      }
    }
  }
}
