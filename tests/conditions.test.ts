import { describe, it, expect } from 'vitest';
import { evalConditions, topCondition } from '../src/game/conditions';

// P1-4 条件节点单测：6 个资源轴触发器的阈值/优先级/互斥（H6 修订与 G1 口径）。

const base = { coins: 200, yinde: 0, peach: 3, hunger: 100, bossesDown: 0, hasCreation: false };

describe('P1-4 · 条件节点', () => {
  it('饥饿告急优先级最高（<30 触发，排最前）', () => {
    const all = evalConditions({ ...base, hunger: 20, coins: 10 });
    expect(all[0].key).toBe('c-hunger');
    expect(topCondition({ ...base, hunger: 20, coins: 10 })!.target).toBe('bridge');
  });

  it('铜钱告急：<50 → 码头扛包；≥100 且未造物 → Y 造物', () => {
    expect(topCondition({ ...base, coins: 30 })!.key).toBe('c-coins');
    expect(topCondition({ ...base, coins: 120 })!.key).toBe('c-creation');
  });

  it('阴德 ≥10 → 冥途牒提示', () => {
    expect(topCondition({ ...base, yinde: 15 })!.key).toBe('c-yinde');
    expect(evalConditions({ ...base, yinde: 9 }).some((c) => c.key === 'c-yinde')).toBe(false);
  });

  it('Boss 伏誅 → 更深狱层提示（有造物后消失）', () => {
    expect(topCondition({ ...base, bossesDown: 1 })!.key).toBe('c-boss');
    expect(evalConditions({ ...base, bossesDown: 1, hasCreation: true }).some((c) => c.key === 'c-boss')).toBe(false);
  });

  it('蟠桃满仓 ≥9 → 兑铜钱提示', () => {
    expect(topCondition({ ...base, peach: 9, hasCreation: true })!.key).toBe('c-peach');   // hasCreation=true 抑制更高优先的 c-creation
    expect(evalConditions({ ...base, peach: 8 }).some((c) => c.key === 'c-peach')).toBe(false);
  });

  it('全达标 → 无触发（null）', () => {
    expect(topCondition({ coins: 200, yinde: 5, peach: 5, hunger: 100, bossesDown: 0, hasCreation: true })).toBeNull();
  });

  it('多触发并存：优先级排序正确（hunger 0 < coins 0）', () => {
    const all = evalConditions({ coins: 10, yinde: 0, peach: 9, hunger: 10, bossesDown: 0, hasCreation: false });
    expect(all.map((c) => c.key)).toEqual(['c-hunger', 'c-coins', 'c-peach']);
  });
});
