import * as THREE from 'three';
import type { Actor } from '../actors/types';
import type { Crowd } from '../actors/crowd';
import type { Rideable } from './player';
import { Vfx } from '../fx/vfx';
import { bus } from '../core/rng';

// ============ 物理碰撞反馈：力分级判定（趔趄→击倒→击飞→碎裂） ============
// 力 F 与目标韧性 T 比较：
//   F <  0.8T          无效（神佛对凡人拳脚免疫）
//   0.8T ≤ F < 1.6T    趔趄 stagger
//   1.6T ≤ F < 3.2T    击倒 knockdown
//   3.2T ≤ F < 6T      击飞 launch（弹道积分，落地转击倒）
//   F ≥ 6T             碎裂 shatter（仅脆弱目标：亡魂消散/器物碎裂；生者封顶为击飞+昏迷）

export type ImpactTier = 'none' | 'stagger' | 'knockdown' | 'launch' | 'shatter';

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
  /** 玩家当前兵器倍率：徒手 1，钢刀 2.5，炮 20 */
  playerWeapon = { key: 'fist', label: '双拳', mult: 1 };
  private launches = new Map<number, LaunchState>();
  private respawn: { a: Actor; at: number }[] = [];
  private bumpCd = 0;
  onPlayerLaunched: ((dir: THREE.Vector3) => void) | null = null;

  constructor(private crowd: Crowd, private vfx: Vfx) {
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

  /** 判定并施加冲击 */
  resolve(attacker: PhysProfile, attackerSpeed: number, target: Actor, dir: THREE.Vector3, extra = 0): ImpactTier {
    const tp = profileOf(target);
    const F = attacker.power * attackerSpeed + extra;
    const tier = tierOf(F, tp);
    this.apply(tier, target, dir, F);
    return tier;
  }

  apply(tier: ImpactTier, target: Actor, dir: THREE.Vector3, force: number): void {
    if (tier === 'none') return;
    dir = dir.clone().setY(0).normalize();
    target.impactUntil = performance.now() + 3600;
    if (tier === 'stagger') {
      target.action = 'staggerHit';
      target.pos.addScaledVector(dir, 0.9);
      target.impactUntil = performance.now() + 1200;
    } else if (tier === 'knockdown') {
      target.action = 'knockedDown';
      target.pos.addScaledVector(dir, 1.4);
      target.impactUntil = performance.now() + 3500;
    } else if (tier === 'launch') {
      this.launch(target, dir, Math.min(30, 10 + force * 0.12));
    } else if (tier === 'shatter') {
      this.shatter(target, dir);
    }
  }

  /** 击飞：抛体运动，落地转击倒 */
  launch(target: Actor, dir: THREE.Vector3, force: number): void {
    this.launches.set(target.id, {
      vx: dir.x * force, vy: 6 + force * 0.22, vz: dir.z * force,
      until: performance.now() + 4000, fragile: profileOf(target).fragile, home: target.pos.clone(),
    });
    target.action = 'launched';
    target.impactUntil = performance.now() + 4000;
  }

  /** 碎裂：亡魂消散/器物碎裂；生者退化为击飞昏迷 */
  shatter(target: Actor, dir: THREE.Vector3): void {
    const tp = profileOf(target);
    if (!tp.fragile && tp.toughness > 20) { this.launch(target, dir, 24); return; }
    const col = (target.data?.code ?? '').startsWith('ghost') ? 0x3dff9c : 0xffb300;
    this.vfx.burst(target.pos.clone().add(new THREE.Vector3(0, 1, 0)), 90, col, 10, 1.4, 1.6, 3);
    this.vfx.ring(target.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), col, 8, 0.7);
    if (!tp.fragile) { this.launch(target, dir, 20); bus.emit('ui:toast', tp.label + '被轰得昏死过去！'); return; }
    target.hidden = true;
    this.respawn.push({ a: target, at: performance.now() + 26000 });
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
    const tier = this.resolve({ mass: 1, power: 10 * weaponMult, toughness: 9, fragile: false, label: '你' }, 1, best, dir);
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
    if (performance.now() < this.bumpCd) return;
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
        this.apply(tier, player, fwd, F);
        if (tier !== 'none') { this.bumpCd = performance.now() + 1200; bus.emit('ui:toast', `被疾驰的车辆撞了个${tier === 'launch' ? '飞起' : tier === 'knockdown' ? '正着' : '趔趄'}！`); return; }
      }
      // 人撞上车（静止/慢速）：趔趄 + 推出
      if (d < 1.9) {
        const push = toP.normalize().multiplyScalar(1.9 - d);
        player.pos.add(push);
        player.action = 'staggerHit';
        player.impactUntil = performance.now() + 900;
        this.bumpCd = performance.now() + 900;
        bus.emit('ui:toast', '撞上车帮，趔趄了一步');
        return;
      }
    }
  }

  /** 交通工具撞 NPC */
  npcSweep(vehicles: { pos: THREE.Vector3; yaw: number; speed: number; mass: number }[], walkers: Actor[]): void {
    if (performance.now() < this.bumpCd - 500) return;
    for (const v of vehicles) {
      if (v.speed < 2.2) continue; // 只有真正疾驰的车辆才会撞倒人
      const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
      for (const a of walkers) {
        if (a.hidden || a.impactUntil > performance.now()) continue;
        const to = a.pos.clone().sub(v.pos);
        to.y = 0;
        const d = to.length();
        if (d > 2.2 || d < 0.01) continue;
        if (fwd.dot(to.clone().normalize()) > 0.4) {
          const F = v.mass * v.speed;
          this.apply(tierOf(F, profileOf(a)), a, fwd, F);
          this.bumpCd = performance.now() + 800;
          return;
        }
      }
    }
  }

  /** 炮击 AOE */
  cannonBlast(point: THREE.Vector3, power: number, actors: Actor[]): void {
    this.vfx.burst(point, 140, 0xff7a2d, 18, 1.3, 2, 6);
    this.vfx.burst(point, 60, 0xffd25e, 12, 1, 1.6, 5);
    this.vfx.ring(point.clone(), 0xff7a2d, 22, 0.9);
    for (const a of actors) {
      if (a.hidden) continue;
      const d = a.pos.distanceTo(point);
      if (d > 6) continue;
      const dir = a.pos.clone().sub(point).setY(0).normalize();
      const falloff = 1 - d / 8;
      this.apply(tierOf(power * falloff, profileOf(a)), a, dir, power * falloff);
    }
    bus.emit('sfx:boom');
  }

  update(dt: number): void {
    const now = performance.now();
    // 击飞弹道积分
    for (const [id, L] of this.launches) {
      const a = this.crowd.actors.find((x) => x.id === id);
      if (!a) { this.launches.delete(id); continue; }
      if (now > L.until) { this.launches.delete(id); continue; }
      L.vy -= 21 * dt;
      a.pos.x += L.vx * dt;
      a.pos.z += L.vz * dt;
      a.yOff += L.vy * dt;
      if (a.yOff <= 0) {
        a.yOff = 0;
        this.launches.delete(id);
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
