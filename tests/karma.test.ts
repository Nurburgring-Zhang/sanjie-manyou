import { describe, it, expect } from 'vitest';
import { Karma, tierOf, REALM_TIERS } from '../src/game/karma';
import { bus } from '../src/core/rng';

// P1-5 六道阶位单测：业力产出/晕倒代价/换阶广播阈值/序列化。

describe('P1-5 · Karma 六道阶位', () => {
  it('tierOf 阈值表：0=人道 300=修罗 800=畜生 1600=饿鬼 3200=天道 6400=佛道', () => {
    expect(tierOf(0).name).toBe('人道');
    expect(tierOf(299).name).toBe('人道');
    expect(tierOf(300).name).toBe('修罗道');
    expect(tierOf(799).name).toBe('修罗道');   // 799 < 800 阈值
    expect(tierOf(800).name).toBe('畜生道');
    expect(tierOf(1600).name).toBe('饿鬼道');
    expect(tierOf(3200).name).toBe('天道');
    expect(tierOf(9999).name).toBe('佛道');
  });

  it('gain 累积 + 换阶沿广播（karma:ascend 事件）', () => {
    const k = new Karma();
    let ascended = '';
    bus.on('karma:ascend', (e) => { ascended = (e as { tier: string }).tier; });
    k.gain(300, 'human');                       // 人道→修罗沿
    expect(ascended).toBe('修罗道');
    expect(k.karma).toBe(300);
    k.gain(1, 'human');                         // 未过新阈值，无新广播
    expect(ascended).toBe('修罗道');
  });

  it('晕倒代价：penalty -100 不低于 0', () => {
    const k = new Karma();
    k.gain(50, 'human');
    k.penalty();
    expect(k.karma).toBe(0);                    // 50-100 → 钳 0
    k.gain(500, 'heaven');
    k.penalty();
    expect(k.karma).toBe(400);
  });

  it('byRealm 分账：三界动词各自累计', () => {
    const k = new Karma();
    k.gain(2, 'human');
    k.gain(8, 'heaven');
    k.gain(5, 'underworld');
    expect(k.byRealm).toEqual({ human: 2, heaven: 8, underworld: 5 });
  });

  it('serialize/deserialize roundtrip', () => {
    const k = new Karma();
    k.gain(700, 'human');
    const snap = k.serialize();
    const k2 = new Karma();
    k2.deserialize(snap);
    expect(k2.karma).toBe(700);
    expect(tierOf(k2.karma).name).toBe('修罗道');   // 700 ∈ [300,800)
  });

  it('REALM_TIERS 单调递增（表健康性）', () => {
    for (let i = 1; i < REALM_TIERS.length; i++) {
      expect(REALM_TIERS[i].at).toBeGreaterThan(REALM_TIERS[i - 1].at);
    }
  });
});
