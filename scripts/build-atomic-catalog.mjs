import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOC_DIR = path.join(ROOT, 'docs', 'assets');
const OUT_DIR = path.join(ROOT, 'artifacts');
const GEN_TS = path.join(ROOT, 'src', 'data', 'worldAtomCatalog.generated.ts');
const OUT_JSON = path.join(OUT_DIR, 'world-atoms.json');
const OUT_MD = path.join(OUT_DIR, 'world-atoms.md');

const docNames = fs.readdirSync(DOC_DIR).filter((f) => f.endsWith('.md')).sort();
const docs = new Map(docNames.map((name) => [name, fs.readFileSync(path.join(DOC_DIR, name), 'utf8')]));
const allText = [...docs.values()].join('\n');

const realmOf = (id) => id.startsWith('T-') ? 'sky' : id.startsWith('C-') ? 'human' : 'underworld';
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const uniqueSorted = (items) => [...new Set(items)].sort(natural);
const cleanCells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
const cleanName = (text, id) => {
  let out = text.replace(/^#+\s*/, '').replace(/^\d+(?:\.\d+)*\s*/, '');
  out = out.replaceAll(id, '').replace(/^[：:、\s+＋|]+/, '');
  out = out.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, ' ').trim();
  return out || id;
};

const idSources = new Map();
for (const [name, text] of docs) {
  for (const id of text.match(/\b[TCD]-(?:GZ|HOU|ITM|PLT|CRT)-\d{2,4}\b/g) ?? []) {
    const set = idSources.get(id) ?? new Set();
    set.add(name);
    idSources.set(id, set);
  }
}

const buildingIdSet = new Set(
  (allText.match(/\b[TCD]-(?:GZ|HOU)-\d{2,3}\b/g) ?? []),
);
const buildingIds = uniqueSorted(buildingIdSet);
const buildingNameMap = new Map();
for (const [name, text] of docs) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#')) continue;
    const ids = [...new Set(line.match(/\b[TCD]-(?:GZ|HOU)-\d{2,3}\b/g) ?? [])];
    for (const id of ids) buildingNameMap.set(id, cleanName(line, id));
  }
}

const detailedMap = new Map();
function addDetailed(id, source, name, fields) {
  const existing = detailedMap.get(id);
  if (existing) {
    Object.assign(existing.fields, fields);
    existing.source = uniqueSorted([...existing.source.split(','), source]).join(', ');
    existing.name = existing.name || name;
  } else {
    detailedMap.set(id, { id, name: name || buildingNameMap.get(id) || id, realm: realmOf(id), source, fields });
  }
}

{
  const lines = docs.get('45-人间建筑材质逐座全表.md').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^###\s+([CH]-GZ-\d{3}|C-HOU-\d{2})\s+(.+)$/);
    if (heading) {
      current = heading[1];
      const existing = detailedMap.get(current);
      addDetailed(current, '45-人间建筑材质逐座全表.md', cleanName(heading[2], current), existing?.fields ?? {});
      continue;
    }
    if (!current) continue;
    const cells = cleanCells(line);
    if (cells.length >= 2 && ['屋顶', '墙体', '台基', '门窗', '彩画纹样', '霓虹件', '老化磨损', '形制备注'].includes(cells[0])) {
      addDetailed(current, '45-人间建筑材质逐座全表.md', buildingNameMap.get(current) ?? current, { [cells[0]]: cells.slice(1).join(' | ') });
    }
  }
}

{
  const lines = docs.get('46-地府建筑材质逐座全表.md').split(/\r?\n/);
  let currentIds = [];
  for (const line of lines) {
    const headingIds = [...new Set(line.match(/\bD-(?:GZ|HOU)-\d{2,3}\b/g) ?? [])];
    if (line.startsWith('#') && headingIds.length) {
      currentIds = headingIds;
      for (const id of currentIds) addDetailed(id, '46-地府建筑材质逐座全表.md', buildingNameMap.get(id) ?? id, {});
      continue;
    }
    if (!currentIds.length) continue;
    const cells = cleanCells(line);
    if (cells.length < 2 || cells[0] === '构件' || cells[0] === '字段') continue;
    for (const id of currentIds) {
      addDetailed(id, '46-地府建筑材质逐座全表.md', buildingNameMap.get(id) ?? id, { [cells[0]]: cells.slice(1).join(' | ') });
    }
  }
  let tableRow = 0;
  for (const line of lines) {
    const idMatch = line.match(/^\|\s*(D-GZ-\d{3})\s+([^|]+)\|/);
    if (!idMatch) continue;
    const cells = cleanCells(line);
    if (cells.length < 2) continue;
    tableRow++;
    const fields = {};
    for (let i = 1; i < cells.length; i++) fields[`逐座字段${i}-${tableRow}`] = cells[i];
    addDetailed(idMatch[1], '46-地府建筑材质逐座全表.md', idMatch[2].trim(), fields);
  }
}

const buildings = buildingIds.map((id) => ({
  id,
  realm: realmOf(id),
  kind: id.includes('-HOU-') ? 'template' : 'building',
  name: buildingNameMap.get(id) ?? id,
  sources: [...(idSources.get(id) ?? [])].sort(),
  hasMaterialDetail: detailedMap.has(id),
}));
const detailedBuildings = [...detailedMap.values()].sort((a, b) => natural(a.id, b.id));

const interiors = [];
{
  const lines = docs.get('47-重点建筑室内装修全表.md').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+[^#].*?（([TCD]-GZ-\d{3})）/);
    if (heading) {
      const id = heading[1];
      const name = line.replace(/^##\s+/, '').replace(/（[^）]+）\s*$/, '').replace(/^[一二三四五六七八九十]+、/, '').trim();
      current = { id, name, realm: realmOf(id), roomCount: 0, rooms: [], source: '47-重点建筑室内装修全表.md' };
      interiors.push(current);
      continue;
    }
    if (!current) continue;
    const roomMatch = line.match(/^\|\s*(R\d{2})\s*([^|]*)\|/);
    if (!roomMatch) continue;
    const cells = cleanCells(line);
    if (cells.length < 7) continue;
    current.rooms.push({
      buildingId: current.id,
      id: roomMatch[1],
      name: roomMatch[2].trim(),
      ground: cells[1],
      walls: cells[2],
      ceiling: cells[3],
      doorsWindows: cells[4],
      lighting: cells[5],
      screens: cells.slice(6).join(' | '),
      source: '47-重点建筑室内装修全表.md',
    });
  }
  for (const building of interiors) building.roomCount = building.rooms.length;
}

const itemIds = uniqueSorted(allText.match(/\b[TCD]-ITM-\d{4}\b/g) ?? []);
// 物品名：资产卷表格行 `| C-ITM-0001 | 双阙墩台 | ... |`；近半数条目只有编号没有名字
const itemNameMap = new Map();
for (const text of docs.values()) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const idCell = cells.find((c) => /^[TCD]-ITM-\d{4}$/.test(c));
    if (!idCell) continue;
    const idx = cells.indexOf(idCell);
    const nm = (cells[idx + 1] ?? '').replace(/[`*]/g, '').trim();
    if (nm && !itemNameMap.has(idCell)) itemNameMap.set(idCell, nm);
  }
}
const detailedItems = [];
{
  const lines = docs.get('47-重点建筑室内装修全表.md').split(/\r?\n/);
  const seen = new Set();
  for (const line of lines) {
    const idMatch = line.match(/^\|\s*([TCD]-ITM-\d{4})\s+([^|]+)\|/);
    if (!idMatch || seen.has(idMatch[1])) continue;
    const cells = cleanCells(line);
    if (cells.length < 6) continue;
    seen.add(idMatch[1]);
    detailedItems.push({
      id: idMatch[1],
      name: idMatch[2].trim(),
      material: cells[1],
      textureDirection: cells[2],
      metalwork: cells[3],
      wear: cells[4],
      light: cells.slice(5).join(' | '),
      source: '47-重点建筑室内装修全表.md',
    });
  }
}

function loadCharacters(file, realm) {
  const entries = [];
  for (const line of docs.get(file).split(/\r?\n/)) {
    const match = line.match(/^###\s+(CH-[TCD]-(?:\d{3}|N\d{2}))\s+(.+)$/);
    if (!match) continue;
    const name = match[2].replace(/[（(].*?[）)]/g, '').trim();
    entries.push({ id: match[1], name: name || match[1], realm, source: file });
  }
  return entries;
}
const characters = [
  ...loadCharacters('41-天宫角色全录.md', 'sky'),
  ...loadCharacters('42-人间角色全录.md', 'human'),
  ...loadCharacters('43-地府角色全录.md', 'underworld'),
].sort((a, b) => natural(a.id, b.id));

function indexAsset(kind) {
  const pattern = new RegExp(`\\b[TCD]-${kind}-\\d{2,4}\\b`, 'g');
  const ids = uniqueSorted(allText.match(pattern) ?? []);
  return ids.map((id) => {
    let name = id;
    for (const [file, text] of docs) {
      const line = text.split(/\r?\n/).find((row) => row.includes(id));
      if (!line) continue;
      const cells = cleanCells(line);
      const cellName = cells.find((cell, index) => index > 0 && !cell.includes(id) && cell.length > 0 && cell.length < 80);
      name = cellName ?? cleanName(line, id);
      return { id, name, source: file };
    }
    return { id, name, source: '' };
  });
}

const totals = {
  regions: 37,
  buildings: 139,
  organismSpecies: 69,
  landforms: 30,
  items: 838,
  characterCards: 243,
  characterIndividuals: 373,
  materialCards: 25,
  patternCards: 22,
};

const catalog = {
  schemaVersion: 1,
  totals,
  buildings,
  detailedBuildings,
  interiors,
  items: itemIds.length,
  itemIdNames: Object.fromEntries(itemIds.map((id) => [id, itemNameMap.get(id) ?? null])),
  itemIds,
  detailedItems,
  characters,
  plants: indexAsset('PLT'),
  creatures: indexAsset('CRT'),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(GEN_TS), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(
  GEN_TS,
  `import type { WorldAtomCatalog } from './worldAtoms';\n\nexport const WORLD_ATOM_CATALOG: WorldAtomCatalog = ${JSON.stringify(catalog, null, 2)};\n`,
);

const roomCount = interiors.reduce((sum, building) => sum + building.rooms.length, 0);
const gapItems = totals.items - detailedItems.length;
const gapBuildings = buildings.length - detailedBuildings.length;
const md = `# 赛博上河世界原子资产清单\n\n` +
  `> 由 \`scripts/build-atomic-catalog.mjs\` 从 docs/assets 的 13 卷设定自动生成。不要手改生成文件；改设定或解析器后重跑。\n\n` +
  `## 全库计数\n\n` +
  `| 项目 | 数量 |\n| --- | ---: |\n` +
  `| 区域 | ${totals.regions} |\n| 建筑/模板索引 | ${buildings.length} |\n| 有逐座材质字段 | ${detailedBuildings.length} |\n` +
  `| 重点室内建筑 | ${interiors.length} |\n| 重点室内房间 | ${roomCount} |\n| 物品 ID | ${itemIds.length} |\n` +
  `| 有逐件材质精描 | ${detailedItems.length} |\n| 角色卡 | ${characters.length} |\n` +
  `| 植物 ID | ${catalog.plants.length} |\n| 生物 ID | ${catalog.creatures.length} |\n| 材质卡 | ${totals.materialCards} |\n| 纹样卡 | ${totals.patternCards} |\n\n` +
  `## 重点室内逐座覆盖\n\n` +
  `| 建筑 | ID | 房间数 |\n| --- | --- | ---: |\n` +
  interiors.map((b) => `| ${b.name} | ${b.id} | ${b.rooms.length} |`).join('\n') + '\n\n' +
  `## 显式缺口\n\n` +
  `- 建筑逐座材质：${detailedBuildings.length}/${buildings.length}，尚缺 ${gapBuildings} 座（主要为天宫与资产卷中未单列材质的条目）。\n` +
  `- 物品逐件精描：${detailedItems.length}/${itemIds.length}，尚缺 ${gapItems} 件；ID 已全量索引，不等于全部已建模。\n` +
  `- 角色逐卡：${characters.length} 张卡，不等于全部已具独立网格、贴图、骨架与动作。\n` +
  `- 植物/生物：${catalog.plants.length} 类植物与 ${catalog.creatures.length} 类生物已有 ID 索引，运行时模型仍按批次提升。\n` +
  `- 本文只证明文档覆盖与字段完整性，不证明视觉精度；视觉质量必须由实际截图、运行时探针和独立复核给出。\n\n` +
  `## 机器可读产物\n\n` +
  `- \`artifacts/world-atoms.json\`：完整实体、房间、物品精描、角色、植物、生物索引。\n` +
  `- \`src/data/worldAtomCatalog.generated.ts\`：测试与构建使用的类型化副本。\n` +
  `- \`src/data/worldAtoms.ts\`：12 个域、逐域原子解剖与审计函数。\n`;
fs.writeFileSync(OUT_MD, md);

console.log(JSON.stringify({
  buildings: buildings.length,
  detailedBuildings: detailedBuildings.length,
  interiors: interiors.length,
  rooms: roomCount,
  items: itemIds.length,
  detailedItems: detailedItems.length,
  characters: characters.length,
  plants: catalog.plants.length,
  creatures: catalog.creatures.length,
  outputs: [path.relative(ROOT, GEN_TS), path.relative(ROOT, OUT_JSON), path.relative(ROOT, OUT_MD)],
}, null, 2));
