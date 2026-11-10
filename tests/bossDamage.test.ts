import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ArenaBoss } from '../src/game/boss';
import { Survival } from '../src/game/survival';
import { JULING, type BossSpec } from '../src/data/boss';
import { bus } from '../src/core/rng';
import type { Vfx } from '../src/fx/vfx';

/**
 * FIX-010 R6：Boss→玩家战斗闭环单测。
 * 注入 clock（毫秒）/ rng / 玩家坐标 / survival，全部外部驱动，无 Date.now、无 DOM 依赖。
 * 玩家固定站在距 Boss（home 原点）1m 处 ≤ attackReach，Boss 无化身（pos = home）。
 */
const vfx = new Proxy({}, { get: () => () => {} }) as unknown as Vfx;

interface MakeOpts { damage?: [number, number]; reach?: number; cooldown?: number }

function make(over: MakeOpts = {}) {
  let now = 0;
  const clock = () => now;                       // 注入时钟（毫秒）
  const playerPos = new THREE.Vector3(1, 0, 0);  // 距 Boss 1m ≤ attackReach 3.2
  const survival = new Survival();
  survival.clock = clock;                        // 无敌帧与 Boss 冷却共用同一注入时钟
  const spec: BossSpec = {
    ...JULING,
    bossDamageToPlayer: over.damage ?? [12, 20],
    attackReach: over.reach ?? 3.2,
    attackCooldown: over.cooldown ?? 1800,
    interval: [999, 999],                        // 拉长招式间隔，避免状态机 knockback 干扰
  };
  const boss = new ArenaBoss(
    spec, undefined, new THREE.Vector3(0, 0, 0), vfx,
    () => undefined, () => {}, () => {},
    { survival, clock, getPlayerPos: () => playerPos },
  );
  boss.rng = () => 0.9;                         // 注入确定性 rng：阶段 2 也不会选中 grab
  return { boss, survival, setNow: (t: number): void => { now = t; } };
}

describe('FIX-010 · Boss→玩家伤害 / 无敌帧 / 晕倒沿', () => {
  it('① 判定距离内一次攻击 hp 减 12，且统一 emit player:damaged', () => {
    const { boss, survival } = make();
    const spy = vi.spyOn(bus, 'emit');
    boss.update(0);
    expect(survival.hp).toBe(88);
    expect(spy).toHaveBeenCalledWith('player:damaged', { hp: 88, amount: 12, source: 'boss' });
    spy.mockRestore();
  });

  it('② 阶段 2 一次攻击 hp 减 20', () => {
    const { boss, survival, setNow } = make();
    boss.phase = 2;
    setNow(2000);                                // 越过 cooldown 与无敌帧
    boss.update(0);
    expect(survival.hp).toBe(80);
  });

  it('③ 800ms 内第二次不扣血（同 source 无敌帧）', () => {
    const { boss, survival, setNow } = make({ cooldown: 100 });  // cooldown 调小，让判定能再触发
    boss.update(0);
    expect(survival.hp).toBe(88);
    setNow(400);                                 // ≥ cooldown 但 < 800ms 无敌帧
    boss.update(0);                              // Boss 判定触发，但 survival.damage 去重
    expect(survival.hp).toBe(88);
    expect(survival.damage(12, { source: 'boss' })).toBe(false);  // 直接验证同 source 去重
    expect(survival.hp).toBe(88);
  });

  it('④ 攻击间隔 < cooldown 不触发', () => {
    const { boss, survival, setNow } = make();  // cooldown = 1800
    boss.update(0);
    expect(survival.hp).toBe(88);
    setNow(900);                                 // < 1800 cooldown，但已 > 800 无敌帧（排除其干扰）
    boss.update(0);
    expect(survival.hp).toBe(88);
  });

  it('⑤ hp 打到 0 触发 onFaint 一次（不重复）', () => {
    const { boss, survival, setNow } = make({ damage: [100, 100] });
    const onFaint = vi.fn();
    survival.onFaint = onFaint;
    boss.update(0);
    expect(survival.hp).toBe(0);
    expect(onFaint).toHaveBeenCalledTimes(1);
    expect(survival.faints).toBe(1);
    setNow(5000);                                // 冷却到、再攻击：hp 已 0，一次性闩不得再触发
    boss.update(0);
    expect(onFaint).toHaveBeenCalledTimes(1);
    expect(survival.faints).toBe(1);
  });
});
