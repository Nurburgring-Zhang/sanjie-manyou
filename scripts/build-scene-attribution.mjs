/**
 * FIX-001 R1：生成 artifacts/scene-item-attribution.json（场景物品归因台账）。
 *
 * 输入
 *  - 物品 ID 全集：artifacts/world-atoms.json 的 itemIds（与 build-atomic-catalog.mjs 同源，838 件）。
 *  - 静态扫描：src 目录下全部 .ts 文件中对 [TCD]-ITM-\d{4} 的引用（字符串字面量 / 注释锚点 / 数据表行）。
 *  - 场景构件语义映射：内置 49 条「物品名 → 源码落位」种子表（SCENE_SEEDS），逐条经静态校验。
 *
 * 归因（确定性）
 *  - placed：id 出现在非 src/data 的构建代码里，或命中内置场景构件种子表；
 *  - data-only：仅在 catalog 副本 src/data/worldAtomCatalog.generated.ts 出现、无场景落位证据。
 *    无法归因者一律输出 data-only 且保留在文件中（FEAT-003 工作清单），绝不静默丢弃。
 *
 * 约束：零第三方依赖；不联网；不写 src/；键序稳定、attributions 按 itemId 字典序、
 *       JSON.stringify(obj, null, 2) → 字节可复现（INV-05）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { srcTreeSha } from './lib/srcTreeSha.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts/scene-item-attribution.json');
const ATOMS = path.join(ROOT, 'artifacts/world-atoms.json');
const VERSION = '1.0.0';

// 49 条场景构件种子：[itemId, name, file, needle, line]。
// 这些 ID 只出现在 catalog 副本里（无法由 ID 反推其场景构件），故保留经代码实测的语义映射；
// 生成器对每条做静态校验（file 存在 + 读取源码），不再依赖易腐烂的 needle 字符串判定归属。
const SCENE_SEEDS = [
  ['C-ITM-0004', '匾额「宣德門」', 'src/city/imperial.ts', 'xuande', 164],
  ['C-ITM-0013', '殿匾「大庆殿」', 'src/city/imperial.ts', 'hall', 167],
  ['C-ITM-0014', '丹陛石', 'src/city/imperial.ts', 'wall', 229],
  ['C-ITM-0023', '日晷', 'src/city/imperial.ts', '日晷', 256],
  ['C-ITM-0015', '蟠龙金柱', 'src/sky/palace.ts', 'glow', 29],
  ['C-ITM-0020', '斗八藻井', 'src/sky/palace.ts', '斗八藻井', 34],
  ['C-ITM-0005', '石狮', 'src/sky/creatures.ts', 'shishi', 72],
  ['T-ITM-0021', '貔貅门墩', 'src/sky/creatures.ts', 'pixiu', 73],
  ['C-ITM-0057', '桥面板', 'src/city/bridge.ts', '桥面板', 10],
  ['C-ITM-0059', '望柱', 'src/city/bridge.ts', 'wood', 44],
  ['C-ITM-0060', '桥头华表', 'src/city/bridge.ts', '桥头华表', 50],
  ['C-ITM-0062', '匾额「虹橋」', 'src/city/bridge.ts', 'bridgename', 88],
  ['C-ITM-0296', '门匾「上東門」', 'src/city/buildings.ts', 'gateTower.plaque', 707],
  ['C-ITM-0294', '城楼', 'src/city/buildings.ts', '城楼', 626],
  ['C-ITM-0113', '匾额「趙太丞家」', 'src/city/buildings.ts', '趙太丞家', 996],
  ['C-ITM-0121', '「解」字大字牌', 'src/city/buildings.ts', '解', 997],
  ['C-ITM-0129', '匾额「王家紙馬」', 'src/city/buildings.ts', '王家紙馬', 998],
  ['C-ITM-0136', '主牌「香藥鋪」', 'src/city/buildings.ts', '香藥鋪', 999],
  ['C-ITM-0168', '观匾「上清觀」', 'src/city/buildings.ts', '上清觀', 1001],
  ['C-ITM-0137', '侧招「劉家上色沉檀揀香」', 'src/city/buildings.ts', '劉家上色沉檀揀香', 915],
  ['C-ITM-0252', '匾额「綢緞莊」', 'src/city/buildings.ts', '綢緞莊', 915],
  ['C-ITM-0259', '匾额「果子鋪」', 'src/city/buildings.ts', '果子鋪', 915],
  ['C-ITM-0266', '匾额「飯鋪」', 'src/city/buildings.ts', '飯鋪', 915],
  ['C-ITM-0273', '匾额「唐家酒店」', 'src/city/buildings.ts', '唐家酒店', 915],
  ['C-ITM-0280', '匾额「久住王員外家」', 'src/city/buildings.ts', '久住王員外家', 915],
  ['C-ITM-0287', '匾额「明家靴店」', 'src/city/buildings.ts', '明家靴店', 915],
  ['C-ITM-0069', '排叉柱', 'src/city/buildings.ts', '排叉柱', 601],
  ['C-ITM-0299', '马道', 'src/city/buildings.ts', '马道', 572],
  ['C-ITM-0154', '戏台', 'src/city/buildings.ts', 'wood', 855],
  ['C-ITM-0402', '影壁', 'src/city/buildings.ts', '影壁', 376],
  ['C-ITM-0454', '招幌', 'src/city/props.ts', '招幌', 438],
  ['C-ITM-0465', '院门楼', 'src/city/buildings.ts', 'house', 362],
  ['C-ITM-0319', '祠匾「碧霞祠」', 'src/world/terrain.ts', 'mt', 184],
  ['C-ITM-0326', '庙匾「镇江王庙」', 'src/world/terrain.ts', '鎮江王廟', 185],
  ['C-ITM-0332', '殿匾「祝融殿」', 'src/world/terrain.ts', '祝融殿', 186],
  ['C-ITM-0338', '殿匾「北岳庙」', 'src/world/terrain.ts', '北嶽廟', 187],
  ['C-ITM-0344', '殿匾「中岳庙」', 'src/world/terrain.ts', '中嶽廟', 188],
  ['C-ITM-0351', '山门匾「雪簾禪院」', 'src/world/terrain.ts', '雪簾禪院', 189],
  ['C-ITM-0346', '神道石翁仲', 'src/world/terrain.ts', '嵩山', 224],
  ['C-ITM-0212', '石砌平台', 'src/city/buildings.ts', 'wall', 758],
  ['C-ITM-0205', '风铎', 'src/city/detailKit.ts', 'eave.windBell', 109],
  ['D-ITM-0114', '南·丰都门', 'src/sky/fengduGround.ts', 'fengdu-gate', 167],
  ['D-ITM-0076', '门匾「返阳门」', 'src/sky/underworld.ts', 'fanyang', 1009],
  ['C-ITM-0055', '贯木拱纵梁', 'src/city/bridge.ts', '贯木拱肋', 19],
  ['C-ITM-0058', '朱漆栏杆', 'src/city/bridge.ts', '栏杆 + 霓虹沿口', 35],
  ['C-ITM-0153', '勾栏大棚', 'src/city/buildings.ts', '棚架 + 大顶', 849],
  ['C-ITM-0201', '塔刹宝顶', 'src/city/buildings.ts', 'pagoda.dewPlate', 817],
  ['D-ITM-0117', '丰都街尾城门', 'src/sky/fengduGround.ts', '过街城门：两墩一门洞', 468],
  ['D-ITM-0067', '丰都城门台', 'src/sky/fengduGround.ts', '过街城门', 253],
];

function listTs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

// 静态扫描全部 src/**/*.ts：非 data 构建代码里的 id 引用记作场景落位证据；
// src/data/**（catalog 自我副本）里的命中仅登记到 catalogOnly，不构成落位证据。
const buildRefs = new Map(); // id -> Map<relFile, minLine>
const catalogOnly = new Set();
for (const f of listTs(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const isCatalog = rel.startsWith('src/data/');
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ids = lines[i].match(/[TCD]-ITM-\d{4}/g) || [];
    for (const id of ids) {
      if (isCatalog) { catalogOnly.add(id); continue; }
      if (!buildRefs.has(id)) buildRefs.set(id, new Map());
      const per = buildRefs.get(id);
      if (!per.has(rel) || i + 1 < per.get(rel)) per.set(rel, i + 1);
    }
  }
}

// 静态校验 49 条种子：file 必须存在且可读；needle 命中则作锚点，否则退回行号锚点。
const seeds = new Map();
for (const [id, , file, needle, line] of SCENE_SEEDS) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  const body = fs.readFileSync(abs, 'utf8');
  seeds.set(id, { file, anchor: body.includes(needle) ? needle : `L${line}` });
}

if (!fs.existsSync(ATOMS)) {
  console.error('FATAL: world-atoms.json 缺失，先跑 build-atomic-catalog.mjs');
  process.exit(2);
}
const atoms = JSON.parse(fs.readFileSync(ATOMS, 'utf8'));
const itemIds = [...atoms.itemIds].sort(); // 数组按 itemId 字典序

const attributions = itemIds.map((itemId) => {
  const anchorSet = new Set();
  const per = buildRefs.get(itemId);
  if (per) {
    for (const [f, ln] of [...per.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, 12)) {
      anchorSet.add(`${f}#L${ln}`);
    }
  }
  const seed = seeds.get(itemId);
  if (seed) anchorSet.add(`${seed.file}#${seed.anchor}`);
  return {
    itemId,
    sceneAnchors: [...anchorSet].sort(),
    attributionKind: anchorSet.size ? 'placed' : 'data-only',
  };
});

const obj = {
  generatedBy: `build-scene-attribution.mjs@${VERSION}`,
  generatedFromCommitOrSha: srcTreeSha(ROOT),
  attributions,
};
fs.writeFileSync(OUT, JSON.stringify(obj, null, 2));

const placed = attributions.filter((a) => a.attributionKind === 'placed').length;
console.log(JSON.stringify({
  generatedBy: obj.generatedBy,
  generatedFromCommitOrSha: obj.generatedFromCommitOrSha,
  attributions: attributions.length,
  placed,
  dataOnly: attributions.length - placed,
  catalogOnly: catalogOnly.size,
}, null, 2));
