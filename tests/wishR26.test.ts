// R26 单测：吞噬体系 / 全量模型精细化 / 8 机位验证 / WorkBuddy 能力注册表
// 纪律：只认真实行为，不认「函数存在」——吞噬要真的改 DNA 与几何参数，
//      精修部件要真的进 parts 且面数不破预算，验证器无 WebGL 要如实降级。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARCHETYPES } from '../src/game/wishCatalog';
import { forge, type WishSpec } from '../src/game/wishForge';
import {
  createEvolvable, gainXp, evolve, devour, lineageOf, STAGES,
  type Evolvable,
} from '../src/game/wishEvolution';
import { ROLE_DESIGNS, designFor, CN_PALETTE, type DesignDomain } from '../src/game/roleDesign';
import { MAX_ORNAMENT_TRIS } from '../src/game/wishOrnament';
import { VALIDATION_VIEWS, validateAsset } from '../src/game/assetValidator';
import {
  AGENT_CAPABILITIES, capabilityStats, planCapabilities, capabilitiesByDomain,
  type CapDomain,
} from '../src/game/agentCapabilities';
import {
  noticeText, doneText, offlineResearch, designFromResearch, runAssetPipeline,
  type PipelineOptions, type PipelineStage,
} from '../src/game/assetPipeline';

const clone = (e: Evolvable): Evolvable => JSON.parse(JSON.stringify(e)) as Evolvable;
const spec = (name: string, archetype: WishSpec['archetype'] = 'dragon'): WishSpec => ({
  name, archetype, traits: ['鳞甲', '腾云'], colors: [0xd4af37, 0x4fa8a0],
  scale: 1.2, seed: 12345, source: 'param',
});

describe('R26 吞噬体系（孢子式弱肉强食）', () => {
  it('拒绝吞噬自身与越阶吞噬', () => {
    const a = createEvolvable('p1', '神龙');
    expect(devour(a, a).ok).toBe(false);
    const prey = createEvolvable('p2', '鲲鹏');
    prey.stageIndex = 4; prey.stage = '神体';
    const r = devour(createEvolvable('p3', '幼貔貅'), prey);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('修为不足');
  });

  it('吞噬真的吸收 DNA / XP / 能力 / 外形，且猎物不被改写', () => {
    const pred = createEvolvable('a1', '神龙');
    const prey = createEvolvable('b1', '青鸾');
    gainXp(prey, 260); evolve(prey);
    const before = clone(pred);
    const preyBefore = clone(prey);
    const r = devour(pred, prey);
    expect(r.ok).toBe(true);
    const a = r.absorbed!;
    expect(a.xp).toBeGreaterThan(0);
    expect(pred.xp).toBe(before.xp + a.xp);
    expect(pred.dna.size).toBeGreaterThanOrEqual(before.dna.size);
    expect(pred.dna.attack).toBeGreaterThanOrEqual(before.dna.attack);
    expect(pred.dna.spirit).toBeGreaterThanOrEqual(before.dna.spirit);
    expect(pred.abilities).toContain('吞噬');
    expect(pred.devoured).toBe(1);
    expect(pred.form.scale).toBeGreaterThan(before.form.scale);
    expect(pred.form.aura).toBeGreaterThan(before.form.aura);
    expect(pred.lineage).toBe(lineageOf(pred));
    expect(prey).toEqual(preyBefore);
  });

  it('猎物灵性显著更高时夺取五行本源，演变支系真的换一条', () => {
    const pred = createEvolvable('c1', '玄龟');
    const prey = createEvolvable('c2', '朱雀');
    pred.dna.element = '水'; pred.dna.spirit = 10;
    prey.dna.element = '火'; prey.dna.spirit = 90;
    const r = devour(pred, prey);
    expect(r.ok).toBe(true);
    expect(r.absorbed!.elementFrom).toBe('水');
    expect(r.absorbed!.elementTo).toBe('火');
    expect(pred.dna.element).toBe('火');
    expect(pred.lineage).toBe(lineageOf(pred));
    expect(pred.lineage).toContain('火');
  });

  it('吞噬确定性：同样输入两次结果逐字段一致', () => {
    const run = () => {
      const p = createEvolvable('d1', '白泽');
      const q = createEvolvable('d2', '穷奇');
      gainXp(q, 150); evolve(q);
      devour(p, q);
      return JSON.stringify(p);
    };
    expect(run()).toBe(run());
  });

  it('连续吞噬累计计数，且 XP 足够时自动进阶', () => {
    const pred = createEvolvable('e1', '饕餮');
    for (let i = 0; i < 3; i++) {
      const prey = createEvolvable('e-prey-' + i, '小妖');
      gainXp(prey, 120); evolve(prey);
      expect(devour(pred, prey).ok).toBe(true);
    }
    expect(pred.devoured).toBe(3);
    expect(pred.xp).toBeGreaterThan(0);
    expect(STAGES).toContain(pred.stage);
  });
});

describe('R26 全量模型精细化（10 类 archetype × 5 阶）', () => {
  it('设计资料库覆盖 10 类本体，每类都有真实参考与建模要点', () => {
    const keys = Object.keys(ROLE_DESIGNS) as DesignDomain[];
    expect(keys.length).toBe(10);
    for (const k of keys) {
      const d = designFor(k, '测试');
      expect(d.references.length).toBeGreaterThan(0);
      expect(d.notes.length).toBeGreaterThan(40);
      expect(designFor(k).title.length).toBeGreaterThan(0);
    }
    expect(CN_PALETTE['朱砂'] ?? Object.values(CN_PALETTE)[0]).toBeTypeOf('number');
  });

  it('每个 archetype 都挂上「精修·」部件，且单件面数不破 20000 预算', () => {
    expect(ARCHETYPES.length).toBe(10);
    expect(MAX_ORNAMENT_TRIS).toBeGreaterThan(0);
    for (const a of ARCHETYPES) {
      const r = forge(spec('精修-' + a, a), { stage: '成体' });
      expect(r.parts.filter((p) => p.startsWith('精修·')).length, `${a} 应含精修部件`).toBeGreaterThan(0);
      expect(r.tris).toBeGreaterThan(0);
      expect(r.tris, `${a} 面数`).toBeLessThanOrEqual(20000);
      expect(r.group.children[0]).toBeInstanceOf(THREE.Mesh);
    }
  });

  it('五阶几何各自不同，且每阶都有精修部件', () => {
    const seen = new Set<number>();
    for (const s of STAGES) {
      const r = forge(spec('五阶龙'), { stage: s });
      expect(r.parts.some((p) => p.startsWith('精修·'))).toBe(true);
      seen.add(r.tris);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('R26 8 机位截图验证器', () => {
  it('机位覆盖多角度 / 多高低 / 多距离', () => {
    expect(VALIDATION_VIEWS.length).toBe(8);
    const az = new Set(VALIDATION_VIEWS.map((v) => v.az));
    expect(az.size).toBeGreaterThanOrEqual(6);
    expect(VALIDATION_VIEWS.some((v) => v.el > 0)).toBe(true);
    expect(VALIDATION_VIEWS.some((v) => v.el < 0)).toBe(true);
    expect(VALIDATION_VIEWS.some((v) => v.dist > 1)).toBe(true);
    expect(VALIDATION_VIEWS.some((v) => v.dist === 1)).toBe(true);
  });

  it('无 renderer / 无 WebGL 时如实降级，不抛错也不伪造通过', () => {
    const g = new THREE.Group();
    const r1 = validateAsset(g, null as unknown as THREE.WebGLRenderer);
    expect(r1.ok).toBe(false);
    expect(r1.views).toBe(0);
    expect(r1.note).toContain('缺少');
    const r2 = validateAsset(null as unknown as THREE.Group, null as unknown as THREE.WebGLRenderer);
    expect(r2.ok).toBe(false);
    expect(r2.total).toBe(8);
  });
});

describe('R26 WorkBuddy 能力注册表', () => {
  it('能力条数 ≥40，14 类域全部有条目', () => {
    const st = capabilityStats();
    expect(AGENT_CAPABILITIES.length).toBeGreaterThanOrEqual(40);
    expect(st.total).toBe(AGENT_CAPABILITIES.length);
    const domains = Object.keys(st.byDomain) as CapDomain[];
    expect(domains.length).toBeGreaterThanOrEqual(10);
    for (const d of domains) {
      expect(st.byDomain[d], `${d} 应至少 1 条`).toBeGreaterThan(0);
      expect(capabilitiesByDomain(d).length).toBe(st.byDomain[d]);
    }
  });

  it('bridge 如实分级：in-browser / api / offline 都存在，offline 不冒充已实调用', () => {
    const st = capabilityStats();
    expect(Object.values(st.byBridge).every((n) => n >= 0)).toBe(true);
    expect(AGENT_CAPABILITIES.every((c) => ['in-browser', 'api', 'offline'].includes(c.bridge))).toBe(true);
    const offline = AGENT_CAPABILITIES.filter((c) => c.bridge === 'offline');
    expect(offline.length).toBeGreaterThan(0);
    expect(offline.every((c) => /桥接|契约|外部|本机|offline|需/.test(c.desc))).toBe(true);
  });

  it('planCapabilities 对「我要一条神龙」给出覆盖检索→建模→验证的能力链', () => {
    const plan = planCapabilities('我要一条神龙，还要多角度截图验证');
    expect(plan.length).toBeGreaterThan(0);
    const ds = new Set(plan.map((c) => c.domain));
    expect(ds.has('web-research')).toBe(true);
    expect(ds.has('3d-dev') || ds.has('3d-tools')).toBe(true);
    expect(ds.has('screenshot-verify')).toBe(true);
    expect(plan.every((c) => c.id && c.name && c.desc)).toBe(true);
  });
});

describe('R26 Agent 资产构建流水线（WorkBuddy 能力编排）', () => {
  const baseSpec: WishSpec = {
    name: '神龙', archetype: 'dragon', traits: ['鳞甲'], colors: [0xd4af37],
    scale: 1, seed: 7, source: 'param',
  };
  const opts = (over: Partial<PipelineOptions> = {}): PipelineOptions => ({
    specFor: () => baseSpec, ...over,
  });

  it('提示文案逐字匹配用户命令', () => {
    expect(noticeText('神龙')).toBe('神龙正在生成。。。。请稍后。');
    expect(doneText('神龙')).toBe('神龙生成完毕，出现在你面前！');
  });

  it('离线资料卡覆盖尺寸/形态/特征/能力/结构/功能/用途/关系/吞噬/进化/世界影响/后果/参考', () => {
    const c = offlineResearch('夔牛', ['独足', '雷音'], '山海经');
    expect(c.name).toBe('夔牛');
    expect(c.offline).toBe(true);
    for (const s of [c.origin, c.dimensions, c.form, c.structure, c.worldImpact, c.npcRelations, c.consequences]) {
      expect(s.length).toBeGreaterThan(4);
    }
    for (const a of [c.features, c.abilities, c.functions, c.uses, c.relations, c.imageRefs, c.videoRefs, c.sources]) {
      expect(a.length).toBeGreaterThan(0);
    }
    for (const b of [c.combat, c.crafting, c.usable, c.devourable, c.evolve, c.upgrade, c.creation, c.building]) {
      expect(typeof b).toBe('boolean');
    }
    const d = designFromResearch('夔牛', c, ['research-engineering', '3d-dev']);
    expect(d.parts.length).toBeGreaterThan(0);
    expect(d.palette.length).toBeGreaterThan(0);
    expect(d.budget).toBeGreaterThan(0);
  });

  it('未命中：8 步顺序真实，verify 被注入调用且产出最终 spec', async () => {
    const seen: PipelineStage[] = [];
    let verifyCalls = 0;
    const p = await runAssetPipeline('神龙', opts({
      onStep: (s) => seen.push(s.stage),
      verify: async () => {
        verifyCalls++;
        return { ok: true, shots: Array.from({ length: 8 }, (_, i) => `shot${i}`), views: 8, note: '8 机位截图验证通过 8/8' };
      },
    }));
    expect(p.reused).toBe(false);
    expect(p.ok).toBe(true);
    expect(seen).toEqual(['lookup', 'notice', 'research', 'design', 'build', 'verify', 'hotload', 'done']);
    expect(verifyCalls).toBe(1);
    expect(p.notice).toBe('神龙正在生成。。。。请稍后。');
    expect(p.doneNotice).toBe('神龙生成完毕，出现在你面前！');
    expect(p.spec).toEqual(baseSpec);
    expect(p.research).not.toBeNull();
    expect(p.design).not.toBeNull();
    expect(p.capabilities.length).toBeGreaterThan(0);
    expect(p.verifyNote).toContain('8 机位');
    expect(p.steps.every((s) => s.detail.length > 4)).toBe(true);
  });

  it('命中内置资产：直接复用，跳过检索/设计/构建/验证', async () => {
    const seen: PipelineStage[] = [];
    let verifyCalls = 0;
    const p = await runAssetPipeline('哪吒', opts({
      catalogHit: { id: 'xiyouji-061', name: '哪吒', source: '西游记', lore: '三坛海会大神', traits: ['风火轮', '混天绫'] },
      onStep: (s) => seen.push(s.stage),
      verify: async () => { verifyCalls++; return { ok: true, shots: [], views: 0, note: '' }; },
    }));
    expect(p.reused).toBe(true);
    expect(p.ok).toBe(true);
    expect(seen).toEqual(['lookup', 'reuse', 'done']);
    expect(verifyCalls).toBe(0);
    expect(p.steps.some((s) => s.stage === 'research' || s.stage === 'build' || s.stage === 'verify')).toBe(false);
    expect(p.spec?.source).toBe('preset');
    expect(p.verifyNote).toContain('跳过');
  });

  it('verify 不通过则流水线判定失败，不谎报热载入', async () => {
    const p = await runAssetPipeline('失败样本', opts({
      verify: async () => ({ ok: false, shots: [], views: 8, note: '仅 2/8 机位通过' }),
    }));
    expect(p.ok).toBe(false);
    expect(p.steps.find((s) => s.stage === 'verify')?.ok).toBe(false);
    expect(p.verifyNote).toContain('2/8');
  });

  it('联网检索返回 null 时如实降级离线，返回字段时按白名单合并', async () => {
    const off = await runAssetPipeline('白泽', opts({ research: async () => null }));
    expect(off.research?.offline).toBe(true);
    expect(off.steps.find((s) => s.stage === 'research')?.detail).toContain('离线');
    const on = await runAssetPipeline('白泽', opts({
      research: async () => ({ dimensions: '体长九尺', features: ['通万物之情'], sources: ['《云笈七签》'] }),
    }));
    expect(on.research?.offline).toBe(false);
    expect(on.research?.dimensions).toBe('体长九尺');
    expect(on.research?.features).toContain('通万物之情');
    expect(on.research?.sources).toContain('《云笈七签》');
  });

  it('specFor 抛错也不外抛到 UI，整链降级', async () => {
    const p = await runAssetPipeline('异常样本', opts({ specFor: () => { throw new Error('boom'); } }));
    expect(p.ok).toBe(false);
    expect(p.spec).toBeNull();
    expect(p.steps.find((s) => s.stage === 'build')?.ok).toBe(false);
  });
});
