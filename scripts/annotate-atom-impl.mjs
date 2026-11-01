/**
 * 为 artifacts/world-atoms.json 的每个条目补 `impl`：实现状态 / 资产路径 / 明确阻塞说明。
 *
 * 状态取自真实源码，不是自评：
 *  - implemented：有确定构建函数，且该函数在当前源码中存在（脚本会逐条校验）
 *  - procedural：由通用程序化管线生成（人群/植被实例化），逐卡无独立网格
 *  - spec-only：只有材质/工艺设定，没有对应网格
 *  - data-only：只有数据与交互价目，没有网格
 *  - blocked：暂无可落地路径，附阻塞原因
 *
 * 用法：node scripts/annotate-atom-impl.mjs [--check]
 *   --check 只校验、不写盘（供测试调用）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const JSON_PATH = path.join(ROOT, 'artifacts', 'world-atoms.json');
const MD_PATH = path.join(ROOT, 'artifacts', 'world-atoms-status.md');
const checkOnly = process.argv.includes('--check');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sourceCache = new Map();
function source(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, read(file));
  return sourceCache.get(file);
}
function hasExport(file, fn) {
  try {
    // 允许非导出函数（interiors.ts 的地标构建器是模块内函数）与导出常量构建器（itemKit 用 const）
    return new RegExp(`(?:export\\s+)?(?:function|class|const)\\s+${fn}\\b`).test(source(file));
  } catch {
    return false;
  }
}

/** 地标与专项：名称关键词 → 构建函数（file#fn），按顺序命中第一条 */
const BUILDERS = [
  [['孙羊'], 'src/city/interiors.ts#buildSunyang'],
  [['十千'], 'src/city/interiors.ts#buildShiqian'],
  [['府衙', '大堂'], 'src/city/interiors.ts#buildYamenHall'],
  [['閻羅', '阎罗'], 'src/sky/underworld.ts#buildUnderworld'],
  [['奈何'], 'src/sky/hells.ts#buildNaiheSystem'],
  [['孟婆'], 'src/sky/hells.ts#buildMengpoZhuang'],
  [['三生'], 'src/sky/hells.ts#buildSansheng'],
  [['望鄉', '望乡'], 'src/sky/hells.ts#buildWangxiang'],
  [['十八', '獄', '狱'], 'src/sky/hells.ts#buildEighteenHells'],
  [['豐都', '丰都', '鬼城'], 'src/sky/expansion.ts#buildUnderworldExpansion'],
  [['南天'], 'src/sky/realm.ts#buildSkyRealm'],
  [['凌霄'], 'src/sky/realm.ts#buildSkyRealm'],
  [['瑤池', '瑶池'], 'src/sky/palace.ts#buildYaochi'],
  [['蟠桃'], 'src/sky/realm.ts#buildSkyRealm'],
  [['廣寒', '广寒'], 'src/sky/realm.ts#buildSkyRealm'],
  [['兜率'], 'src/sky/realm.ts#buildSkyRealm'],
  [['大慶', '大庆', '垂拱', '紫宸'], 'src/city/imperial.ts#buildImperialCity'],
  [['宣德'], 'src/city/imperial.ts#buildImperialCity'],
  [['虹橋', '虹桥', '州橋', '州桥'], 'src/city/bridge.ts#buildBridge'],
  [['碼頭', '码头'], 'src/city/buildings.ts#buildDock'],
  [['城牆', '城墙', '城門', '城门'], 'src/city/buildings.ts#buildCityWall'],
  [['塔'], 'src/city/buildings.ts#buildPagoda'],
  [['勾欄', '勾栏', '瓦子'], 'src/city/buildings.ts#buildGoulan'],
  [['酒樓', '酒樓', '酒樓', '正店', '腳店', '脚店', '茶坊', '腳店'], 'src/city/buildings.ts#buildBuilding'],
];

const REALM_DEFAULT = {
  human: 'src/city/buildings.ts#buildBuilding',
  sky: 'src/sky/realm.ts#buildSkyRealm',
  underworld: 'src/sky/underworld.ts#buildUnderworld',
};

/** 植物：名称关键词 → 构建函数 */
const PLANT_BUILDERS = [
  [['柳'], 'src/city/props.ts#willow'],
  [['松', '柏', '槐'], 'src/city/props.ts#conifer'],
  [['竹', '夜哭'], 'src/sky/flora.ts#buildGhostFlora'],
  [['蘆', '芦'], 'src/sky/flora.ts#buildGhostFlora'],
  [['魔芋', '曼陀羅', '曼陀罗'], 'src/sky/flora.ts#buildGhostFlora'],
  [['燈籠', '灯笼'], 'src/sky/flora.ts#buildGhostFlora'],
  [['引魂'], 'src/sky/flora.ts#buildGhostFlora'],
  [['苔'], 'src/sky/flora.ts#buildGhostFlora'],
  [['瑤草', '瑶草', '靈芝', '灵芝', '垂雲', '垂云', '星輝', '星辉', '曇花', '昙花', '虹藤'], 'src/sky/flora.ts#buildCelestialFlora'],
  [['桃'], 'src/sky/realm.ts#buildSkyRealm'],
  [['胡楊', '胡杨'], 'src/world/desertOutpost.ts#poplar'],
  [['青萍'], 'src/sky/underworld.ts#duckweed'],
  [['仙桂', '桂'], 'src/city/props.ts#osmanthus'],
  [['青蓮', '青莲', '蓮'], 'src/city/props.ts#lotus'],
  [['牧草'], 'src/city/props.ts#pasture'],
  [['血珊瑚'], 'src/sky/flora.ts#bloodCoral'],
  [['祭台骨緣', '祭台骨缘'], 'src/sky/flora.ts#altarBoneEdge'],
  [['天山雪蓮', '天山雪莲'], 'src/world/desertOutpost.ts#snowLotus'],
  [['迎賓茶灶', '迎宾茶灶'], 'src/city/props.ts#teaStove'],
  [['醉霞石榴'], 'src/city/props.ts#pomegranate'],
  [['銀霜橘', '银霜橘'], 'src/city/props.ts#frostOrange'],
];

/** 生物：名称关键词 → 系统 */
const CREATURE_REF = 'src/sky/creatures.ts#CreatureSystem';

function pick(map, name, realm) {
  for (const [keys, ref] of map) {
    if (keys.some((k) => name.includes(k))) return ref;
  }
  return null;
}

/** 文档表头/规则行被当成条目解析出来的脏数据：显式标成 not-asset，而不是假装是物种 */
function isDocRow(name) {
  return /\||…|資產 ID|资产 ID|全錄|全录|規則|规则/.test(name) || /^[TCD]-[A-Z]{2,3}-/.test(name.trim());
}

function statusOfRef(ref) {
  if (!ref) return null;
  const [file, fn] = ref.split('#');
  if (!fs.existsSync(path.join(ROOT, file))) return { ok: false, reason: `缺文件 ${file}` };
  if (!hasExport(file, fn)) return { ok: false, reason: `${file} 无导出函数 ${fn}` };
  return { ok: true };
}

let _itemKitSrc = null;
/** SERVICE_BUILDERS 内的器件（席面器用族）：按键名检查是否已登记 */
function serviceHas(key) {
  if (_itemKitSrc === null) {
    const f = path.join(ROOT, 'src/city/itemKit.ts');
    _itemKitSrc = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }
  const at = _itemKitSrc.indexOf('export const SERVICE_BUILDERS');
  if (at < 0) return false;
  const block = _itemKitSrc.slice(at, _itemKitSrc.indexOf('};', at) + 2);
  return block.includes(key);
}

/** WS-29 的四批器物：直接从 itemKit.ts 的 BATCH4_TABLE 解析正则表，避免在台账脚本里再抄一份 */
let _b4Rules = null;
function batch4Match(name) {
  if (_b4Rules === null) {
    const f = path.join(ROOT, 'src/city/itemKit.ts');
    const src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const at = src.indexOf('const BATCH4_TABLE');
    const seg = at < 0 ? '' : src.slice(at, src.indexOf('];', at));
    _b4Rules = [];
    for (const m of seg.matchAll(/\[\/(.+?)\/,\s*'([A-Za-z0-9_]+)'\]/g)) {
      try { _b4Rules.push([new RegExp(m[1]), m[2]]); } catch { /* 跳过非法正则 */ }
    }
  }
  const hit = _b4Rules.find(([re]) => re.test(name));
  return hit ? hit[1] : null;
}
function batch4Has(key) {
  const f = path.join(ROOT, 'src/city/itemKit.ts');
  const src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const at = src.indexOf('export const BATCH4_BUILDERS');
  if (at < 0) return false;
  return src.slice(at, src.indexOf('};', at) + 2).includes(key);
}

/** WS-26 的三批器物注册表 BATCH3_BUILDERS：按键名检查是否已登记 */
let _batch3Src = null;
function batch3Has(key) {
  if (_batch3Src === null) {
    const f = path.join(ROOT, 'src/city/itemKit.ts');
    _batch3Src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }
  const at = _batch3Src.indexOf('export const BATCH3_BUILDERS');
  if (at < 0) return false;
  const block = _batch3Src.slice(at, _batch3Src.indexOf('};', at) + 2);
  return block.includes(key);
}

/** WS-23 的二批器物注册表 BATCH2_BUILDERS：按键名检查是否已登记 */
let _batch2Src = null;
function batch2Has(key) {
  if (_batch2Src === null) {
    const f = path.join(ROOT, 'src/city/itemKit.ts');
    _batch2Src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }
  const at = _batch2Src.indexOf('export const BATCH2_BUILDERS');
  if (at < 0) return false;
  const block = _batch2Src.slice(at, _batch2Src.indexOf('};', at) + 2);
  return block.includes(key);
}

// 源码 ID 锚点索引：构建代码里显式写了某个台账 ID（注释锚点），说明这件确实在场景里落了地。
// 只扫构建目录（city/sky/world/actors），不扫 data/（那里是台账本体，会自我循环）。
let _idIndex = null;
function idAnchor(id) {
  if (_idIndex === null) {
    _idIndex = new Map();
    for (const dir of ['src/city', 'src/sky', 'src/world', 'src/actors']) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const f of fs.readdirSync(full)) {
        if (!f.endsWith('.ts')) continue;
        const txt = fs.readFileSync(path.join(full, f), 'utf8');
        const lines = txt.split(String.fromCharCode(10));
        for (let i = 0; i < lines.length; i++) {
          for (const m of lines[i].matchAll(/[CTD]-ITM-\d{4}/g)) {
            if (!_idIndex.has(m[0])) _idIndex.set(m[0], { file: `${dir}/${f}`, line: i + 1, text: lines[i].trim().slice(0, 80) });
          }
        }
      }
    }
  }
  return _idIndex.get(id) ?? null;
}

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
let SCENE_ATTR = {};
try {
  const arr = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/scene-item-attribution.json'), 'utf8'));
  for (const a of arr) SCENE_ATTR[a.id] = a;
} catch { SCENE_ATTR = {}; }
let unresolved = 0;
const stats = { implemented: 0, procedural: 0, 'spec-only': 0, 'data-only': 0, blocked: 0, 'not-asset': 0 };

function annotate(entry, domain, name) {
  let impl;
  if (domain === 'building') {
    const ref = pick(BUILDERS, name, entry.realm) ?? REALM_DEFAULT[entry.realm] ?? null;
    const ok = statusOfRef(ref);
    impl = ok?.ok
      ? { status: 'implemented', assetRef: ref, note: entry.hasMaterialDetail === false ? '几何已建，逐座材质字段缺' : '几何与材质字段齐备' }
      : { status: 'blocked', blocker: `构建函数缺失：${ref}（${ok?.reason ?? '未知'}）` };
  } else if (domain === 'item') {
    const id = typeof entry === 'string' ? entry : entry.id;
    const detailed = data.detailedItems.find((d) => d.id === id);
    const itemName = (data.itemIdNames && data.itemIdNames[id]) || (detailed && detailed.name) || '';
    // 关键词表与 src/city/itemKit.ts#builderForName 保持一致；命中即有可复用的程序化器件
    const ITEM_PATTERNS = [
      [/香炉|博山炉|熏炉/, 'censer'], [/灯|烛台|长明灯/, 'lantern'], [/坛|瓮|罐|酿坛/, 'jar'],
      [/瓶|净瓶|壶/, 'bottle'], [/觚|花觚|玉瓶/, 'vase'], [/盘|供盘|托盘/, 'tray'],
      [/碗|盏|杯|盂/, 'bowl'], [/镜/, 'mirror'], [/屏风|屏/, 'screen'], [/蒲团|坐垫|席垫/, 'cushion'],
      [/琴/, 'qin'], [/杵臼|玉杵|药杵/, 'pestle'], [/柜|药柜|匣/, 'cabinet'], [/简架|书案|架/, 'scrollRack'],
      [/斧|钺|仪仗|镫|鞭/, 'axe'], [/旗|幡|帏|帷|帐/, 'flag'], [/玺|印/, 'seal'], [/钟|磬/, 'bell'],
      [/桌|案/, 'table'], [/凳|椅|座/, 'stool'], [/伞|蓋|盖/, 'umbrella'], [/扇/, 'fan'], [/書|书|卷|冊|册/, 'book'],
      [/刀|槍|枪|劍|剑|戟|矛|戈|斧|鉞|钺/, 'weapon'], [/榻|床/, 'bed'],
    ];
    // 席面器用族（WS-4）：SERVICE_BUILDERS 已建模的物件，按名优先匹配；
    // C-ITM-0093 与 C-ITM-0108 都叫「账台」，按 ID 特判小账台
    const SERVICE_PATTERNS = [
      [/银酒海/, 'wineSea'], [/果菜碟/, 'fruitDish'], [/注子/, 'ewer'], [/食盒/, 'foodBox'],
      [/茶汤炉/, 'teaStove'], [/名酒单水牌|水牌/, 'wineBoard'], [/天井水缸|水缸/, 'waterVat'],
      [/马槽/, 'manger'], [/香插石钵/, 'incenseBowl'], [/孟婆汤锅/, 'soupCauldron'],
      [/汤勺/, 'soupLadle'], [/柴垛/, 'firewoodStack'], [/引水竹枧|竹枧/, 'bambooFlume'],
      [/灶膛双眼/, 'stoveEyes'], [/取汤竹筹|竹筹/, 'soupTokens'], [/忘川茶账/, 'teaLedger'],
      [/孟婆位/, 'soupMat'], [/小阁子/, 'latticeBooth'], [/账台/, 'accountDesk'],
    ];
    // 二批器物（WS-23）：23 件天宫宝器 / 人间附属 / 地府石作，按名优先命中
    const BATCH2_PATTERNS = [
      [/长柄火钳/, 'fireTongs'], [/捣药玉钵/, 'jadeMortar'], [/白玉妆台/, 'jadeVanity'],
      [/拂尘/, 'whisk'], [/璇玑玉衡/, 'armillary'], [/药葫芦/, 'gourd'], [/金刚琢/, 'vajraRing'],
      [/孫羊正店/, 'plaqueSunyang'], [/栏杆隔断/, 'railingScreen'], [/天阁凭栏/, 'beautyRail'],
      [/明鏡高懸/, 'plaqueYamen'], [/水火棍/, 'waterFireSticks'], [/登闻鼓/, 'petitionDrum'],
      [/開道锣|开道锣/, 'gong'], [/马厩/, 'stable'], [/惊堂木/, 'gavel'], [/朱笔/, 'vermilionBrush'],
      [/善恶签筒/, 'fateTube'], [/止步界桩/, 'boundaryPost'], [/焚香鼎/, 'incenseDing'],
      [/白玉栏杆/, 'jadeRailing'], [/锁魂链/, 'soulChain'], [/界碑/, 'stele'],
    ];
    // 源码 ID 锚点：该条目的台账 ID 出现在构建代码里（如 `// 千斤闸：C-ITM-0011 …`）→ 视为已落地
    if (!impl) {
      const anc = idAnchor(id);
      if (anc) {
        impl = {
          status: 'implemented',
          assetRef: `${anc.file}#L${anc.line}`,
          note: `源码 ID 锚点：${anc.text}`,
        };
      }
    }

    // WS-30 核查表：49 条「建筑/标牌构件」按代码实测归属（needle 必须真的出现在该文件里）
    if (!impl && SCENE_ATTR[id]) {
      const a = SCENE_ATTR[id];
      let body = '';
      try { body = fs.readFileSync(path.join(ROOT, a.file), 'utf8'); } catch { body = ''; }
      if (a.needle && body.includes(a.needle)) {
        impl = {
          status: 'implemented',
          assetRef: `${a.file}#L${a.line}`,
          note: `场景构件（代码实测命中「${a.needle}」）：${a.name}`,
        };
      }
    }

    // 场景构件：这些条目不是可拾取器物，而是某座建筑的组成件（欢门/点将台/桥券/三生石面/台基等）。
    // 按其真实落地的构建函数归属，避免长期挂在 spec-only 下假装"没建模"。
    const SCENE_ITEMS = [
      [/彩楼欢门/, 'src/city/interiors.ts#buildLandmarkInteriors', '孙羊正店彩楼欢门（构件已建，kit sunyang.huanmenCloth）'],
      [/井字欢门/, 'src/city/interiors.ts#buildLandmarkInteriors', '十千脚店井字欢门（kit shiqian.huanmenCloth）'],
      [/点将台/, 'src/sky/realm.ts#buildSkyRealm', '天宫将台（kit jiangtai.*）'],
      [/黑玉砖地面/, 'src/sky/underworld.ts#buildUnderworld', '阎罗殿黑玉砖地坪'],
      [/閻羅殿|阎罗殿/, 'src/sky/underworld.ts#buildUnderworld', '阎罗殿匾额（sign quad）'],
      [/桥身拱券/, 'src/sky/underworld.ts#buildUnderworld', '奈何桥拱券'],
      [/守桥岗/, 'src/sky/underworld.ts#buildUnderworld', '奈何桥守桥岗'],
      [/桥头碑/, 'src/sky/underworld.ts#buildUnderworld', '奈何桥南北桥头碑'],
      [/魂痕桥面/, 'src/sky/underworld.ts#buildUnderworld', '奈何桥桥面魂痕'],
      [/导雾槽/, 'src/sky/underworld.ts#buildUnderworld', '奈何桥导雾槽'],
      [/石身/, 'src/sky/hells.ts#buildSansheng', '三生石石身（WS-17 重建）'],
      [/石顶刻字/, 'src/sky/hells.ts#buildSansheng', '三生石顶刻字'],
      [/前世面|今生面|来世面/, 'src/sky/hells.ts#buildSansheng', '三生石三面镜/铭文'],
      [/苔字/, 'src/sky/hells.ts#buildSansheng', '三生石隐显苔字'],
      [/台基/, 'src/sky/hells.ts#buildWangxiang', '望乡台台基'],
      [/守台棚位/, 'src/sky/hells.ts#buildWangxiang', '望乡台守台棚（kit wangxiang.keeperHut）'],
    ];
    const sceneItem = itemName ? SCENE_ITEMS.find(([re]) => re.test(itemName)) : null;
    if (sceneItem && statusOfRef(sceneItem[1])?.ok) {
      impl = { status: 'implemented', assetRef: sceneItem[1], note: `场景构件：${sceneItem[2]}` };
    }

    // 四批器物（WS-29）：正则表从 itemKit.ts 现读，命中即算已建模
    const b4Key = itemName ? batch4Match(itemName) : null;
    if (!impl && b4Key && batch4Has(b4Key)) {
      impl = {
        status: 'implemented',
        assetRef: `src/city/itemKit.ts#BATCH4_BUILDERS.${b4Key}`,
        note: '四批器物：已建模并在孙羊/十千/府衙室内落位',
      };
    }

    // 三批器物（WS-26）：22 件人间附属 / 地府石作 / 天宫宝器
    const BATCH3_PATTERNS = [
      [/木楼梯/, 'woodStair'], [/双眼大灶/, 'doubleStove'], [/獬豸照壁/, 'xiezhiScreen'],
      [/仪门/, 'ceremonialGate'], [/戒石亭/, 'stonePavilion'], [/牢栅/, 'jailBars'],
      [/更鼓/, 'nightDrum'], [/茶棚/, 'teaShed'], [/白烛阵/, 'candleArray'],
      [/地藏龛/, 'dizangNiche'], [/楹联·东|楹联东/, 'coupletEast'], [/楹联·西|楹联西/, 'coupletWest'],
      [/望柱栏板/, 'stoneBaluster'], [/祈愿红绳/, 'wishCords'], [/残碑影壁/, 'brokenSteleScreen'],
      [/泪痕石/, 'tearStone'], [/雾幕/, 'mistCurtain'], [/骨阶扶索/, 'boneHandrail'],
      [/八卦紫金丹炉|紫金丹炉/, 'baguaFurnace'], [/九转金丹/, 'goldenElixir'],
      [/凤辇/, 'phoenixCarriage'], [/霓裳羽衣/, 'featherRobe'],
    ];
    const b3Key = itemName ? (BATCH3_PATTERNS.find(([re]) => re.test(itemName)) ?? [null, null])[1] : null;
    if (b3Key && batch3Has(b3Key)) {
      impl = {
        status: 'implemented',
        assetRef: `src/city/itemKit.ts#BATCH3_BUILDERS.${b3Key}`,
        note: '三批器物：已建模并在孙羊/十千/府衙室内落位',
      };
    }
    const b2Key = impl ? null : (itemName ? (BATCH2_PATTERNS.find(([re]) => re.test(itemName)) ?? [null, null])[1] : null);
    if (!impl && b2Key && batch2Has(b2Key)) {
      impl = {
        status: 'implemented',
        assetRef: `src/city/itemKit.ts#BATCH2_BUILDERS.${b2Key}`,
        note: '二批器物：已建模并在孙羊正店/十千脚店/府衙室内落位',
      };
    }
    const svcKey = impl ? null : (id === 'C-ITM-0108'
      ? 'accountDeskSmall'
      : (itemName ? (SERVICE_PATTERNS.find(([re]) => re.test(itemName)) ?? [null, null])[1] : null));
    if (!impl && svcKey && serviceHas(svcKey)) {
      impl = {
        status: 'implemented',
        assetRef: `src/city/itemKit.ts#SERVICE_BUILDERS.${svcKey}`,
        note: '席面器用族：已建模并在对应室内房间落位（孙羊正店/十千脚店/府衙）',
      };
    }
    const hit = svcKey ? null : (itemName ? ITEM_PATTERNS.find(([re]) => re.test(itemName)) : null);
    if (impl) {
      // 已由 SERVICE_BUILDERS 判定，跳过名称表
    } else if (hit) {
      const key = hit[1];
      const ok = statusOfRef(`src/city/itemKit.ts#${key}`);
      impl = ok?.ok
        ? { status: 'implemented', assetRef: `src/city/itemKit.ts#${key}`, note: '品类器件已建模并在摊位/室内使用；该条目本体未单独落到指定位置' }
        : { status: 'spec-only', assetRef: 'src/city/props.ts#buildStalls', blocker: `器件构建函数缺失：${key}` };
    } else if (detailed) {
      impl = {
        status: 'spec-only',
        assetRef: 'src/city/props.ts#buildStalls',
        blocker: '有材质/工艺设定，但该件物品无独立网格；仅摊面与交互点有代表件',
      };
    } else {
      impl = {
        status: 'data-only',
        assetRef: 'src/data/interactPoints.ts#POINTS',
        blocker: '仅条目 ID 与价目/交互登记，无材质设定与网格；需按资产卷逐件补建模',
      };
    }
  } else if (domain === 'character') {
    impl = {
      status: 'procedural',
      assetRef: 'src/actors/crowd.ts#Crowd.spawnActor',
      blocker: '人物由共享体型/衣饰池程序化生成，逐卡无独立网格与贴图；卡面差异落在数据与配色',
    };
  } else if (domain === 'plant') {
    if (isDocRow(name)) {
      impl = { status: 'not-asset', blocker: '文档表头/规则行，非物种条目；需在资产卷修正解析源' };
      stats[impl.status] = (stats[impl.status] ?? 0) + 1;
      entry.impl = impl;
      return;
    }
    const ref = pick(PLANT_BUILDERS, name, entry.realm);
    const ok = statusOfRef(ref);
    impl = ref && ok?.ok
      ? { status: 'implemented', assetRef: ref }
      : { status: 'blocked', blocker: ref ? `构建函数缺失：${ref}` : '该物种暂无专属构建函数，仅有条目与设定' };
  } else if (domain === 'creature') {
    const ok = statusOfRef(CREATURE_REF);
    impl = ok?.ok
      ? { status: 'procedural', assetRef: CREATURE_REF, blocker: '生物按系统统一建模（移动/巡游体），逐类无独立网格与贴图' }
      : { status: 'blocked', blocker: `生物系统缺失：${CREATURE_REF}` };
  }
  stats[impl.status] = (stats[impl.status] ?? 0) + 1;
  if (impl.status === 'blocked') unresolved++;
  entry.impl = impl;
}

for (const b of data.buildings) annotate(b, 'building', b.name);
const rawItemIds = data.itemIds.map((x) => (typeof x === 'string' ? x : (x && typeof x.id === 'string' ? x.id : String(x))));
data.itemIds = rawItemIds;
data.items = rawItemIds.map((id) => {
  const holder = { id };
  annotate(holder, 'item', holder);
  return holder;
});
for (const c of data.characters) annotate(c, 'character', c.name);
for (const p of data.plants) annotate(p, 'plant', p.name);
for (const c of data.creatures) annotate(c, 'creature', c.name);

const summary = {
  generatedAt: new Date().toISOString().slice(0, 19),
  counts: {
    buildings: data.buildings.length,
    items: data.items.length,
    characters: data.characters.length,
    plants: data.plants.length,
    creatures: data.creatures.length,
  },
  status: stats,
  blocked: unresolved,
};
data.implSummary = summary;

if (!checkOnly) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
  const lines = [
    '# 原子资产实现状态（由 scripts/annotate-atom-impl.mjs 生成）',
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- 建筑 ${summary.counts.buildings}：implemented ${count(data.buildings, 'implemented')}，blocked ${count(data.buildings, 'blocked')}`,
    `- 物品 ${summary.counts.items}：implemented ${count(data.items, 'implemented')}，spec-only ${count(data.items, 'spec-only')}，data-only ${count(data.items, 'data-only')}`,
    `- 角色 ${summary.counts.characters}：procedural ${count(data.characters, 'procedural')}`,
    `- 植物 ${summary.counts.plants}：implemented ${count(data.plants, 'implemented')}，blocked ${count(data.plants, 'blocked')}，not-asset ${count(data.plants, 'not-asset')}`,
    `- 生物 ${summary.counts.creatures}：procedural ${count(data.creatures, 'procedural')}`,
    '',
    '## 待办（按量级排序）',
    `1. 物品网格：${count(data.items, 'data-only')} 件仅数据，需按资产卷补逐件模型与材质。`,
    `2. 角色独立网格：${summary.counts.characters} 张卡目前共用人群体型池。`,
    `3. 植物专属模型：${count(data.plants, 'blocked')} 类无专属构建函数。`,
    `4. 建筑逐座材质：${data.buildings.filter((b) => b.hasMaterialDetail === false).length} 座缺材质字段。`,
    '',
  ];
  fs.writeFileSync(MD_PATH, lines.join('\n'));
}

function count(list, status) {
  return list.filter((x) => x.impl && x.impl.status === status).length;
}

console.log(JSON.stringify(summary, null, 1));
if (unresolved && !checkOnly) console.log(`存在 ${unresolved} 条 blocked，已在 world-atoms.json 内附阻塞说明`);
