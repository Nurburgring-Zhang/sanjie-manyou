import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore - srcTreeSha.mjs 无 .d.ts，vitest 以 ESM 运行时解析
import { srcTreeSha } from '../scripts/lib/srcTreeSha.mjs';
import { WORLD_ATOM_CATALOG } from '../src/data/worldAtomCatalog.generated';
import { ATOM_ANATOMY, auditWorldAtoms, REQUIRED_ROOM_FIELDS } from '../src/data/worldAtoms';

// ROOT 由 import.meta.url 推导，不依赖 cwd。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('世界原子资产清单', () => {
  it('全库计数与 99 卷汇总一致', () => {
    expect(WORLD_ATOM_CATALOG.schemaVersion).toBe(1);
    expect(WORLD_ATOM_CATALOG.totals.regions).toBe(37);
    expect(WORLD_ATOM_CATALOG.totals.buildings).toBe(139);
    expect(WORLD_ATOM_CATALOG.totals.organismSpecies).toBe(69);
    expect(WORLD_ATOM_CATALOG.totals.landforms).toBe(30);
    expect(WORLD_ATOM_CATALOG.totals.items).toBe(838);
    expect(WORLD_ATOM_CATALOG.totals.characterCards).toBe(243);
    expect(WORLD_ATOM_CATALOG.totals.characterIndividuals).toBe(373);
    expect(WORLD_ATOM_CATALOG.totals.materialCards).toBe(25);
    expect(WORLD_ATOM_CATALOG.totals.patternCards).toBe(22);
  });

  it('建筑索引、逐座材质与 104 间室内都可追溯', () => {
    expect(WORLD_ATOM_CATALOG.buildings.length).toBe(139);
    expect(WORLD_ATOM_CATALOG.detailedBuildings.length).toBeGreaterThanOrEqual(100);
    expect(WORLD_ATOM_CATALOG.interiors.length).toBe(12);
    const rooms = WORLD_ATOM_CATALOG.interiors.flatMap((b) => b.rooms);
    expect(rooms.length).toBe(104);
    for (const room of rooms) {
      expect(room.id).toMatch(/^R\d{2}$/);
      for (const field of REQUIRED_ROOM_FIELDS) {
        expect(room[field], `${room.buildingId}/${room.id} 缺 ${field}`).not.toBe('');
      }
    }
  });

  it('838 件物品、243 张角色卡、32 类植物与 37 类生物均有 ID 索引', () => {
    expect(WORLD_ATOM_CATALOG.items).toBe(838);
    expect(WORLD_ATOM_CATALOG.detailedItems.length).toBeGreaterThanOrEqual(174);
    expect(WORLD_ATOM_CATALOG.characters.length).toBe(243);
    expect(WORLD_ATOM_CATALOG.plants.length).toBe(32);
    expect(WORLD_ATOM_CATALOG.creatures.length).toBe(37);
    for (const c of WORLD_ATOM_CATALOG.characters) expect(c.name.length).toBeGreaterThan(0);
    for (const id of WORLD_ATOM_CATALOG.itemIds) expect(id).toMatch(/^[TCD]-ITM-\d{4}$/);
  });

  it('每类资产的原子解剖都有几何、材质、贴图策略与证据锚', () => {
    const domains = Object.keys(ATOM_ANATOMY);
    expect(domains).toEqual(expect.arrayContaining([
      'architecture', 'interior', 'furniture', 'object', 'plant', 'creature',
      'character', 'transport', 'terrain', 'material', 'pattern', 'lighting',
    ]));
    for (const domain of domains) {
      const parts = ATOM_ANATOMY[domain as keyof typeof ATOM_ANATOMY];
      expect(parts.length, `${domain} 无原子部件`).toBeGreaterThan(0);
      for (const part of parts) {
        expect(part.geometry.length, `${domain}/${part.id} 缺几何`).toBeGreaterThan(0);
        expect(part.materials.length, `${domain}/${part.id} 缺材质`).toBeGreaterThan(0);
        expect(part.texture.length, `${domain}/${part.id} 缺贴图策略`).toBeGreaterThan(0);
        expect(part.evidence.length, `${domain}/${part.id} 缺证据锚`).toBeGreaterThan(0);
      }
    }
  });

  it('审计把尚未精细化的缺口显式报出，而不是宣称全部完成', () => {
    const audit = auditWorldAtoms(WORLD_ATOM_CATALOG);
    expect(audit.missingRoomFields).toBe(0);
    expect(audit.itemMaterialGap).toBe(WORLD_ATOM_CATALOG.totals.items - WORLD_ATOM_CATALOG.detailedItems.length);
    expect(audit.buildingMaterialGap).toBe(WORLD_ATOM_CATALOG.buildings.length - WORLD_ATOM_CATALOG.detailedBuildings.length);
    expect(audit.complete).toBe(false);
  });
});

describe('原子清单的实现状态台账', () => {
  const atoms = JSON.parse(fs.readFileSync('artifacts/world-atoms.json', 'utf8')) as {
    buildings: { id: string; impl: { status: string; assetRef?: string; blocker?: string } }[];
    items: { id: string; impl: { status: string; assetRef?: string; blocker?: string } }[];
    characters: { id: string; impl: { status: string; assetRef?: string; blocker?: string } }[];
    plants: { id: string; impl: { status: string; assetRef?: string; blocker?: string } }[];
    creatures: { id: string; impl: { status: string; assetRef?: string; blocker?: string } }[];
  };
  const legal = new Set(['implemented', 'procedural', 'spec-only', 'data-only', 'blocked', 'not-asset']);

  it('五域条目都带 impl，且状态合法、资产路径或阻塞说明至少一项', () => {
    const all = [...atoms.buildings, ...atoms.items, ...atoms.characters, ...atoms.plants, ...atoms.creatures];
    expect(all.length).toBe(139 + 838 + 243 + 32 + 37);
    for (const e of all) {
      expect(e.impl, `${e.id} 缺 impl`).toBeTruthy();
      expect(legal.has(e.impl.status), `${e.id} 状态非法：${e.impl.status}`).toBe(true);
      expect(Boolean(e.impl.assetRef || e.impl.blocker), `${e.id} 既无资产路径也无阻塞说明`).toBe(true);
    }
  });

  it('建筑全部有构建函数锚点，角色/生物锚到程序化系统', () => {
    expect(atoms.buildings.filter((b) => b.impl.status === 'implemented').length).toBe(139);
    expect(atoms.characters.filter((c) => c.impl.status === 'procedural').length).toBe(243);
    expect(atoms.creatures.filter((c) => c.impl.status === 'procedural').length).toBe(37);
  });

  it('缺口以明确状态记账：物品 838 已全部具备实现状态，植物已无缺口', () => {
    expect(atoms.items.filter((i) => i.impl.status === 'implemented').length).toBe(838);
    expect(atoms.items.filter((i) => i.impl.status === 'spec-only').length).toBe(0);
    expect(atoms.items.filter((i) => i.impl.status === 'data-only').length).toBe(0);
    expect(atoms.plants.filter((p) => p.impl.status === 'blocked').length).toBe(0);
    expect(atoms.plants.filter((p) => p.impl.status === 'not-asset').length).toBe(4);
  });
});

describe('FIX-001 台账再生链 / QA-007 三态清单', () => {
  it('attribution.generatedFromCommitOrSha === 当前 src 树 sha（防台账陈旧）', () => {
    const attr = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/scene-item-attribution.json'), 'utf8'));
    expect(attr.generatedFromCommitOrSha).toBe(srcTreeSha(ROOT));
  });

  it('MANIFEST 中每个 regenerable 项的 generator 文件存在', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/MANIFEST.json'), 'utf8'));
    const regenerable = manifest.artifacts.filter((a: { state: string }) => a.state === 'shipped+regenerable');
    expect(regenerable.length).toBeGreaterThan(0);
    for (const a of regenerable) {
      expect(typeof a.generator).toBe('string');
      expect(fs.existsSync(path.join(ROOT, a.generator as string)), `generator 不存在: ${a.generator}`).toBe(true);
    }
  });
});
