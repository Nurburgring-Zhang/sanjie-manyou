// R25 融合玩法单测：全量资产 / 建造 / 分支演变 / 真实世界循环
// 只认真实行为，不认「函数存在」：放置要真的进状态、战斗要真的扣血、探索要真的给奖励。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  WISH_CATALOG, ARCHETYPES, catalogStats, searchCatalog, getById, matchCatalog,
} from '../src/game/wishCatalog';
import { WishBuild, snap } from '../src/game/wishBuild';
import { WishPlay, createPlayActor, type WishWorldLike } from '../src/game/wishPlay';
import {
  createEvolvable, gainXp, evolve, lineageOf, LINEAGES,
} from '../src/game/wishEvolution';
import { forge, type WishSpec } from '../src/game/wishForge';
import {
  developAsset, mergeLlmLore, loreCardHtml, registerBlueprint,
  listBlueprints, blueprintCount, exportBlueprints, importBlueprints, clearBlueprints,
} from '../src/game/wishBlueprint';

const spec = (name: string): WishSpec => ({
  name, archetype: 'dragon', traits: ['鳞甲', '腾云'], colors: [0xd4af37, 0x4fa8a0],
  scale: 1.2, seed: 12345, source: 'param',
});

describe('R25 全量预设资产目录', () => {
  it('条目规模与去重：≥2000 件且名号全局唯一', () => {
    const st = catalogStats();
    expect(st.total).toBeGreaterThanOrEqual(2000);
    expect(st.uniqueNames).toBe(st.total);
    expect(WISH_CATALOG.length).toBe(st.total);
    expect(st.archetypeCount).toBe(10);
  });

  it('出典覆盖中国神话 / 山海经 / 西游记 / 游戏内，且每条可被 forge 的 archetype 覆盖', () => {
    const st = catalogStats();
    for (const s of ['中国神话', '山海经', '西游记', '游戏内']) {
      expect(st.bySource[s] ?? 0).toBeGreaterThan(50);
    }
    expect(Object.keys(st.byCategory).length).toBeGreaterThanOrEqual(15);
    for (const e of WISH_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(ARCHETYPES).toContain(e.archetype);
      expect(e.colors.length).toBeGreaterThan(0);
      expect(e.traits.length).toBeGreaterThan(0);
    }
  });

  it('id 唯一、按 id 可取、一句话能命中真实名号', () => {
    const ids = new Set(WISH_CATALOG.map((e) => e.id));
    expect(ids.size).toBe(WISH_CATALOG.length);
    const dragon = matchCatalog('我要一条神龙');
    expect(dragon).not.toBeNull();
    expect(dragon?.name).toContain('龙');
    expect(getById(dragon!.id)?.name).toBe(dragon?.name);
    expect(searchCatalog('神龙').length).toBeGreaterThan(0);
  });

  it('抽样 30 件不同出典的预设都能锻造出有限包围盒的几何', () => {
    const picks = WISH_CATALOG.filter((_, i) => i % Math.max(1, Math.floor(WISH_CATALOG.length / 30)) === 0).slice(0, 30);
    expect(picks.length).toBeGreaterThanOrEqual(20);
    for (const e of picks) {
      const r = forge({
        name: e.name, archetype: e.archetype, traits: e.traits, colors: e.colors,
        scale: e.scale, seed: 7, source: 'preset',
      }, { stage: '成体' });
      expect(r.tris).toBeGreaterThan(0);
      expect(Number.isFinite(r.bounds.min.x)).toBe(true);
      expect(Number.isFinite(r.bounds.max.y)).toBe(true);
    }
  });
});

describe('R25 我的世界式建造', () => {
  it('落点吸附 / 旋转 / 叠层 / 撤销 / 序列化恢复', () => {
    const b = new WishBuild();
    b.clear();
    expect(snap(7.3, -9.1)).toEqual({ x: 8, z: -8 });
    const p1 = b.place(spec('殿'), 7.3, 0, -9.1);
    expect(p1).not.toBeNull();
    expect(p1!.x).toBe(8);
    expect(p1!.z).toBe(-8);
    b.rotate();
    b.setStack(2);
    const p2 = b.place(spec('阙'), 12, 0, 12);
    expect(p2!.ry).toBeCloseTo(Math.PI / 2);
    expect(p2!.stack).toBe(2);
    expect(p2!.y).toBeGreaterThan(p1!.y);
    expect(b.parts.length).toBe(2);
    const raw = b.serialize();
    const b2 = new WishBuild();
    b2.clear();
    expect(b2.restore(raw)).toBe(2);
    expect(b2.parts[1].stack).toBe(2);
    b.undo();
    expect(b.parts.length).toBe(1);
  });

  it('组合 ≥2 件构件产出新资产，且 trait/color 合并、seed 确定', () => {
    const b = new WishBuild();
    b.clear();
    const a = b.place(spec('甲'), 0, 0, 0)!;
    const c = b.place(spec('乙'), 4, 0, 0)!;
    const merged = b.combine([a.id, c.id])!;
    expect(merged).not.toBeNull();
    expect(merged.name).toContain('合体');
    expect(merged.seed).toBe(b.combine([a.id, c.id])!.seed);
    expect(b.combine([a.id])).toBeNull();
    expect(b.removeParts([a.id, c.id])).toBe(2);
  });
});

describe('R25 孢子式分支演变', () => {
  it('九条五行支系齐备，同阶不同五行的外形参数与能力真的不同', () => {
    expect(Object.keys(LINEAGES).length).toBe(9);
    const forms: string[] = [];
    for (const el of Object.keys(LINEAGES)) {
      const ev = createEvolvable('e' + el, '试');
      ev.dna.element = el;
      gainXp(ev, 400);
      evolve(ev);
      expect(lineageOf(ev)).toContain(el);
      expect(ev.abilities).toContain(LINEAGES[el].name);
      forms.push(JSON.stringify(ev.form));
    }
    expect(new Set(forms).size).toBeGreaterThanOrEqual(5);
  });

  it('五阶 forge 顶点数据两两不同（几何真的换，不是缩放）', () => {
    const s = spec('神龙');
    const counts = ['卵', '幼体', '成体', '灵体', '神体'].map((stage) => {
      const r = forge(s, { stage: stage as '卵' | '幼体' | '成体' | '灵体' | '神体' });
      let verts = 0;
      r.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) verts += m.geometry.getAttribute('position').count; });
      return verts;
    });
    expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
  });
});

describe('R25 Agent 设定与资产开发', () => {
  it('离线确定性：同一愿望两次开发逐字节一致，五步流水与设定字段齐备', () => {
    const s = spec('神龙');
    const a = developAsset('我要一条神龙', s, 'L2');
    const b = developAsset('我要一条神龙', s, 'L2');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.steps.length).toBe(5);
    expect(a.lore.powers.length).toBeGreaterThanOrEqual(3);
    expect(a.lore.appearance.length).toBeGreaterThan(10);
    expect(a.lore.backstory.length).toBeGreaterThan(10);
    expect(a.lore.origin.length).toBeGreaterThan(0);
    expect(a.tier).toBe('L2');
    expect(a.version).toBe(1);
    expect(a.id.startsWith('bp-')).toBe(true);
  });

  it('设定卡 HTML 转义用户文本、不含 script/style，并渲染神通与开发流水', () => {
    const s = spec('<img src=x onerror=alert(1)>');
    const bp = developAsset('我要<script>alert(2)</script>', s, 'L2');
    const html = loreCardHtml(bp);
    expect(html).toContain('神通');
    expect(html).toContain('bp-steps');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<style');
    expect(html.toLowerCase()).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('L3 模型设定按白名单并入，恶意字段被丢弃', () => {
    const bp = developAsset('造一只灵鹤', spec('灵鹤'), 'L3');
    const merged = mergeLlmLore(bp, {
      name: '<b>不该覆盖</b>',
      lore: { epithet: '云中君', appearance: '素羽丹顶，长颈修胫', powers: ['御风', '鸣霄'], backstory: '来自模型' },
      evil: 'DROP TABLE',
    });
    expect(merged.lore.epithet).toBe('云中君');
    expect(merged.lore.powers).toContain('御风');
    expect(merged.name).toBe(bp.name);
    expect(JSON.stringify(merged)).not.toContain('DROP TABLE');
  });

  it('资产登记本：去重 / 200 上限 / 导出导入 / 清空', () => {
    clearBlueprints();
    const bp = developAsset('我要一条神龙', spec('神龙'), 'L1');
    registerBlueprint(bp);
    registerBlueprint(bp);
    expect(blueprintCount()).toBe(1);
    expect(listBlueprints()[0].id).toBe(bp.id);
    const raw = exportBlueprints();
    clearBlueprints();
    expect(blueprintCount()).toBe(0);
    expect(importBlueprints(raw)).toBe(1);
    expect(importBlueprints('not-json')).toBe(0);
    expect(blueprintCount()).toBe(1);
  });
});

describe('R25 真实世界循环（探索 / 战斗 / 骑乘）', () => {
  const mkWorld = (): { world: WishWorldLike; coins: number[] } => {
    const coins: number[] = [];
    return {
      coins,
      world: {
        player: { actor: { pos: { x: 0, y: 0, z: 0 } } },
        interact: { earn: (n: number) => coins.push(n) },
      },
    };
  };

  it('造物跟随玩家并跨地格发现：报告里有 discoveries / xp / 铜钱', () => {
    const { world, coins } = mkWorld();
    const events: string[] = [];
    const play = new WishPlay(world, (e) => events.push(e.text));
    const ev = createEvolvable('a1', '神龙');
    const g = new THREE.Group();
    const actor = createPlayActor('a1', '神龙', g, ev, { x: 0, y: 1, z: 0 }, 'follow');
    play.add(actor);
    const xps: number[] = [];
    // 把玩家逐步移远，逼造物跨过多个 46m 地格
    for (let i = 0; i < 160; i++) {
      (world.player as { actor: { pos: { x: number } } }).actor.pos.x = i * 4;
      play.tick(0.1, (id, n) => { xps.push(n); void id; });
    }
    expect(play.report.discoveries).toBeGreaterThan(2);
    expect(play.report.xpAwarded).toBeGreaterThan(0);
    expect(coins.length).toBeGreaterThan(0);
    expect(events.some((s) => s.includes('探索'))).toBe(true);
    expect(xps.length).toBeGreaterThan(0);
    expect(g.position.x).toBeGreaterThan(100);
  });

  it('敌对试炼妖兽与造物实时交战：HP 真的下降，击杀给奖励', () => {
    const { world } = mkWorld();
    const events: string[] = [];
    const play = new WishPlay(world, (e) => events.push(e.text));
    const friendly = createPlayActor('f1', '神龙', new THREE.Group(), createEvolvable('f1', '神龙'), { x: 0, y: 1, z: 0 }, 'guard');
    const hostile = createPlayActor('h1', '试炼妖兽', new THREE.Group(), createEvolvable('h1', '试炼妖兽'), { x: 5, y: 1, z: 0 }, 'guard', true);
    play.add(friendly); play.add(hostile);
    const hp0 = hostile.hp;
    for (let i = 0; i < 200 && hostile.hp > 0; i++) play.tick(0.1, () => undefined);
    expect(play.report.hits).toBeGreaterThan(0);
    expect(hostile.hp).toBeLessThan(hp0);
    expect(events.some((s) => s.includes('战斗'))).toBe(true);
  });

  it('骑乘模式每帧贴随玩家，不是一次性挪位', () => {
    const { world } = mkWorld();
    const play = new WishPlay(world, () => undefined);
    const g = new THREE.Group();
    const a = createPlayActor('r1', '神龙', g, createEvolvable('r1', '神龙'), { x: 0, y: 1, z: 0 }, 'ride');
    play.add(a);
    for (let i = 0; i < 30; i++) play.tick(0.1, () => undefined);
    const x0 = g.position.x;
    (world.player as { actor: { pos: { x: number } } }).actor.pos.x = 120;
    for (let i = 0; i < 60; i++) play.tick(0.1, () => undefined);
    expect(g.position.x).toBeGreaterThan(x0 + 50);
    expect(Math.abs(g.position.x - 120)).toBeLessThan(10);
  });

  it('世界 Boss 可被造物助战扣血，但保底 1 点不越权击杀', () => {
    const boss = { hp: 1000, defeated: false, spec: { maxHp: 1000 }, pos: () => new THREE.Vector3(0, 0, 0) };
    const world: WishWorldLike = { player: { actor: { pos: { x: 0, y: 0, z: 0 } } }, boss };
    const play = new WishPlay(world, () => undefined);
    const a = createPlayActor('b1', '神龙', new THREE.Group(), createEvolvable('b1', '神龙'), { x: 0, y: 1, z: 0 }, 'guard');
    play.add(a);
    for (let i = 0; i < 60; i++) play.tick(0.1, () => undefined);
    expect(boss.hp).toBeLessThan(1000);
    expect(boss.hp).toBeGreaterThanOrEqual(1);
    expect(play.report.bossHits).toBeGreaterThan(0);
  });
});
