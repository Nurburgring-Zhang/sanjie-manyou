// ============================================================================
// 三界造物 · 垂直切片单测（≥8 条）· tests/wish.test.ts
// 覆盖：目录数量与分类、意图量词与黑名单、forge 确定性、merge 确定性、
//       进化 5 阶、xp 阈值、序列化 roundtrip、离线 resolveWish 不抛错。
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  WISH_CATALOG, catalogStats, searchCatalog, getById, matchCatalog, ARCHETYPES,
} from '../src/game/wishCatalog';
import { forge, forgeBytes, type WishSpec } from '../src/game/wishForge';
import { parseIntent, resolveWish, isRefused } from '../src/game/wishAgent';
import {
  createEvolvable, gainXp, evolve, upgrade, merge,
  serialize, deserialize, STAGES, XP_THRESHOLDS, stageForXp,
} from '../src/game/wishEvolution';

const spec = (over?: Partial<WishSpec>): WishSpec => ({
  name: '测试龙', archetype: 'dragon', traits: ['鳞甲', '腾云', '金光'],
  colors: [0xd4af37, 0x4fa8a0, 0xa8503c], scale: 1.2, seed: 20261104, source: 'param',
  ...over,
});

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('wishCatalog 全量预设资产目录', () => {
  it('① 条目 ≥300、名字唯一、字段完整、分类与 archetype 覆盖齐全', () => {
    const st = catalogStats();
    expect(st.total).toBeGreaterThanOrEqual(300);
    expect(st.uniqueNames).toBe(st.total);
    expect(new Set(WISH_CATALOG.map((e) => e.name)).size).toBe(st.total);
    for (const c of ['神', '仙', '佛', '鬼', '魔', '怪', '神兽', '妖精', '西游角色', '建筑', '兵器', '物品', '植物', '载具', '家具']) {
      expect(st.byCategory[c] ?? 0).toBeGreaterThan(0);
    }
    expect(st.bySource['山海经']).toBeGreaterThan(0);
    expect(st.bySource['西游记']).toBeGreaterThan(0);
    expect(st.archetypeCount).toBeGreaterThanOrEqual(8);
    for (const a of ARCHETYPES) expect(st.byArchetype[a] ?? 0).toBeGreaterThan(0);
    for (const e of WISH_CATALOG) {
      expect(e.id && e.name && e.category && e.source && e.archetype).toBeTruthy();
      expect(e.traits.length).toBeGreaterThan(0);
      expect(e.colors.length).toBeGreaterThan(0);
      expect(e.scale).toBeGreaterThan(0);
      expect(e.lore).toContain(e.name);
    }
  });

  it('② searchCatalog / getById / matchCatalog 检索正确', () => {
    expect(searchCatalog('凤凰').some((e) => e.name === '凤凰')).toBe(true);
    const one = WISH_CATALOG[0];
    expect(getById(one.id)?.name).toBe(one.name);
    expect(matchCatalog('我要一条神龙')?.name).toBe('神龙');
    expect(searchCatalog('').length).toBe(WISH_CATALOG.length);
    expect(getById('not-exist')).toBeUndefined();
  });
});

describe('wishAgent 中文意图解析与三级 resolve', () => {
  it('③ 量词消歧：一条神龙 / 两只凤凰 / 一座亭子 / 三株灵芝', () => {
    const a = parseIntent('我要一条神龙');
    expect(a.count).toBe(1);
    expect(a.archetype).toBe('dragon');
    expect(a.catalogId).toBeTruthy();
    const b = parseIntent('来两只凤凰');
    expect(b.count).toBe(2);
    expect(b.archetype).toBe('bird');
    const c = parseIntent('造一座亭子');
    expect(c.count).toBe(1);
    expect(c.archetype).toBe('building');
    expect(parseIntent('给我三株灵芝').count).toBe(3);
  });

  it('④ 黑名单越界词直接 refuse（三段式话术）', () => {
    expect(isRefused('我要一枚炸弹')).toBe(true);
    const r = parseIntent('我要一枚炸弹');
    expect(r.refused).toBe(true);
    expect(r.reason).toContain('越界');
  });

  it('⑤ 离线 resolveWish：L1 命中预设 / L2 兜底 / refuse，均不抛错', async () => {
    const a = await resolveWish('我要一条神龙');
    expect(a.ok).toBe(true);
    expect(a.tier).toBe('L1');
    expect(a.catalogId).toBeTruthy();
    expect(a.spec.archetype).toBe('dragon');
    const b = await resolveWish('变一个软乎乎的圆球');
    expect(b.ok).toBe(true);
    expect(['L2', 'L3']).toContain(b.tier);
    expect(b.spec.archetype).toBeTruthy();
    const c = await resolveWish('我要一枚炸弹');
    expect(c.ok).toBe(false);
    expect(c.tier).toBe('refuse');
  });
});

describe('wishForge 确定性程序化几何', () => {
  it('⑥ 同 spec 双跑顶点数据逐字节一致；tris ≤20000；bounds 有效', () => {
    const s = spec();
    const a = forgeBytes(s), b = forgeBytes(s);
    expect(a.length).toBeGreaterThan(0);
    expect(bytesEq(a, b)).toBe(true);
    const r = forge(s);
    expect(r.tris).toBeGreaterThan(0);
    expect(r.tris).toBeLessThanOrEqual(20000);
    expect(r.bounds.isEmpty()).toBe(false);
    expect(r.group.children.length).toBeGreaterThan(0);
  });

  it('⑦ 10 种 archetype 均可生成；不同 seed 几何不同', () => {
    for (const a of ARCHETYPES) {
      const r = forge(spec({ archetype: a }));
      expect(r.tris).toBeGreaterThan(0);
      expect(r.tris).toBeLessThanOrEqual(20000);
      expect([
        r.bounds.min.x, r.bounds.min.y, r.bounds.min.z,
        r.bounds.max.x, r.bounds.max.y, r.bounds.max.z,
      ].every(Number.isFinite)).toBe(true);
    }
    expect(bytesEq(forgeBytes(spec({ seed: 1 })), forgeBytes(spec({ seed: 2 })))).toBe(false);
  });
});

describe('wishEvolution 孢子式进化', () => {
  it('⑧ XP 阈值单调，stageForXp 分段正确（低于阈值不换阶）', () => {
    for (let i = 1; i < XP_THRESHOLDS.length; i++) expect(XP_THRESHOLDS[i]).toBeGreaterThan(XP_THRESHOLDS[i - 1]);
    expect(XP_THRESHOLDS.length).toBe(STAGES.length);
    expect(stageForXp(0)).toBe(0);
    expect(stageForXp(99)).toBe(0);
    expect(stageForXp(100)).toBe(1);
    expect(stageForXp(300)).toBe(2);
    expect(stageForXp(700)).toBe(3);
    expect(stageForXp(1500)).toBe(4);
  });

  it('⑨ 进化 5 阶：依次达阈值换阶并按 dna 改造外形', () => {
    const e = createEvolvable('e1', '测试兽');
    expect(e.stage).toBe('卵');
    const got: string[] = [];
    for (let i = 1; i < STAGES.length; i++) {
      gainXp(e, XP_THRESHOLDS[i] - e.xp);
      const r = evolve(e);
      expect(r.changed).toBe(true);
      got.push(e.stage);
    }
    expect(got).toEqual(STAGES.slice(1));
    expect(e.stage).toBe('神体');
    expect(e.abilities.length).toBeGreaterThanOrEqual(5);
    expect(e.form.scale).toBeGreaterThan(1);
    expect(evolve(e).changed).toBe(false);
  });

  it('⑩ upgrade 消耗 xp 升维度；xp 不足返回 ok:false', () => {
    const e = createEvolvable('e2', '测试兽');
    expect(upgrade(e).ok).toBe(false);
    gainXp(e, 200);
    const before = e.dna.attack;
    const r = upgrade(e, 'attack');
    expect(r.ok).toBe(true);
    expect(e.dna.attack).toBe(before + 8);
    expect(e.xp).toBe(140);
  });

  it('⑪ merge 确定性 / 顺序无关 / 名称合成', () => {
    const a = createEvolvable('a', '青龙', 11);
    const b = createEvolvable('b', '白虎', 22);
    gainXp(a, 350); evolve(a);
    gainXp(b, 120); evolve(b);
    const m1 = merge(a, b), m2 = merge(a, b), m3 = merge(b, a);
    expect(m1).toEqual(m2);
    expect(m1).toEqual(m3);
    expect(m1.name).not.toBe(a.name);
    expect(m1.name.length).toBeGreaterThan(1);
    expect(m1.abilities).toContain('融合');
  });

  it('⑫ serialize / deserialize roundtrip 恒等', () => {
    const e = createEvolvable('e3', '麒麟', 7);
    gainXp(e, 760); evolve(e);
    expect(deserialize(serialize(e))).toEqual(e);
  });
});

describe('离线端到端：自然语言 → resolveWish → forge', () => {
  it('⑬ 多种愿望全链可用，几何有限且 tris ≤20000', async () => {
    for (const t of ['我要一条神龙', '来两只凤凰', '造一座亭子', '变一个软乎乎的圆球']) {
      const r = await resolveWish(t);
      expect(r.ok).toBe(true);
      expect(['L1', 'L2', 'L3']).toContain(r.tier);
      const g = forge(r.spec);
      expect(g.tris).toBeGreaterThan(0);
      expect(g.tris).toBeLessThanOrEqual(20000);
      expect([
        g.bounds.min.x, g.bounds.min.y, g.bounds.min.z,
        g.bounds.max.x, g.bounds.max.y, g.bounds.max.z,
      ].every(Number.isFinite)).toBe(true);
    }
    const refused = await resolveWish('我要一枚炸弹');
    expect(refused.ok).toBe(false);
    expect(refused.tier).toBe('refuse');
  });
});

describe('五阶形态演变（forge stage / form）', () => {
  it('⑭ 五阶几何两两不同、≥3 阶有新增可见部件、单件 tris ≤20000', () => {
    const rows = STAGES.map((stage) => {
      const r = forge(spec(), { stage });
      return { stage, r, bytes: forgeBytes(spec(), { stage }) };
    });
    // 打印五阶三角数 / 部件清单（主线程重拍 02/04/05 对比图时对照）
    for (const x of rows)
      console.log(`[五阶形态] ${x.stage}: tris=${x.r.tris}, 部件=${x.r.parts.length} [${x.r.parts.join(' / ')}]`);
    for (const x of rows) {
      expect(x.r.tris).toBeGreaterThan(0);
      expect(x.r.tris).toBeLessThanOrEqual(20000);
      expect(x.r.parts.length).toBeGreaterThan(0);
      expect([
        x.r.bounds.min.x, x.r.bounds.min.y, x.r.bounds.min.z,
        x.r.bounds.max.x, x.r.bounds.max.y, x.r.bounds.max.z,
      ].every(Number.isFinite)).toBe(true);
    }
    // 五阶顶点数据两两不同：形态确实「演变」，不只是缩放
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        expect(bytesEq(rows[i].bytes, rows[j].bytes)).toBe(false);
    // 至少 3 阶有专属新增可见部件（卵光茧 / 灵体光环 / 神体祥云+额外灵肢）
    expect(rows[0].r.parts).toContain('半透明光茧蛋壳');
    expect(rows[3].r.parts.some((p) => p.includes('发光光环'))).toBe(true);
    expect(rows[4].r.parts.some((p) => p.includes('祥云'))).toBe(true);
    expect(rows[4].r.parts.some((p) => p.includes('额外灵肢'))).toBe(true);
  });

  it('⑮ 带 stage 的 forge 仍确定性；form 变化会改变几何（glow/aura/extraLimbs 被读进几何）', () => {
    for (const stage of STAGES)
      expect(bytesEq(forgeBytes(spec(), { stage }), forgeBytes(spec(), { stage }))).toBe(true);
    // extraLimbs 驱动额外灵肢数量：同阶不同 form 顶点不同
    const a = forgeBytes(spec(), { stage: '神体', form: { extraLimbs: 0 } });
    const b = forgeBytes(spec(), { stage: '神体', form: { extraLimbs: 4 } });
    expect(bytesEq(a, b)).toBe(false);
    // WishSpec.stage 与 forge 第二参数两条契约等价
    expect(bytesEq(forgeBytes({ ...spec(), stage: '卵' }), forgeBytes(spec(), { stage: '卵' }))).toBe(true);
  });
});
