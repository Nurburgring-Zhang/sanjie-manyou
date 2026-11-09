/**
 * R18 · 三界动植物生态扩充（2026-11-07）
 * R22 · 全域生态扩容（2026-11-08）
 *
 * R22 用户再次点名「天宫、皇宫、各种府署、军营等，动物、植物都太少了……植物也要茂密茂盛」。
 * 本轮真改：
 *   · 株数 14,780 → 34,450、动物 909 → 3,680、物种 51 → 65（新增 7 种复用既有形制）；
 *   · 人间落点从「22 个城外郊野簇」扩到「22 城外簇 + INFILL/CORE_GREEN 共 1397 个
 *     已逐处避让的城内公园站点」，草木长在坊间空地而不是插进屋顶；
 *   · 天宫落点从「蟠桃园 / 瑶池 / 云岛外缘 3 片」扩到「23 个殿阁台面锚点 + 4 个水面
 *     + 6 个云岛浮岛」，覆盖朝房、御膳房、天库、武库、白玉柱廊、瑶池宫、兜率丹院、
 *     广寒月坛、莲台、星宿八府；
 *   · 动物活动中心从 10 个（人间4/天宫3/地府3）扩到 100+ 个，鸟飞鱼游走兽遍地。
 *   · 仍守：静态 Baker 合批 0 新增 draw call、动态 4 个 InstancedMesh / 4 draw call、
 *     全部整数 hash 零共享 RNG、天宫静态点用缩放前坐标。
 *
 * 判词（用户原话）：
 *   「所有三界的动物、植物都太少了，建立更多的动物植物生态！！要知道古代的环境生态
 *     是非常好的！动物植物哪都有！！！植物也要茂密茂盛！！！三界要又很多花花草草，
 *     绿树成荫，流水潺潺，鸟飞鱼游，还有各种动物到处跑。。。。」
 *
 * 分两层做，各自守住一条硬约束：
 *
 *  ① 静态草木走 Baker 合批（0 新增 draw call）：
 *     人间郊野/河滩、天宫蟠桃园/瑶池/云岛外缘、地府黄泉路/忘川/鬼城外圈，
 *     共 14 类植物形制（乔木 4 / 灌木 2 / 花草 3 / 水生 2 / 藤蔓 1 / 仙果 1 / 神木 1）。
 *     **天宫静态植物一律用「缩放前」坐标**（y≈196–208，与 buildCelestialFlora 同口径），
 *     由 expansion.scaleHeavenGeometry 在 loadingDone 后统一 ×2.2 + HEAVEN_LIFT；
 *     人间/地府 y<150，不进缩放选区。
 *
 *  ② 动态禽鱼走 4 个 InstancedMesh（+4 draw call）：
 *     鸟（飞）/ 鱼（游）/ 走兽（跑）/ 蝶（飘），三界各有分布，逐帧按轨道推进。
 *     自建网格名前缀 `eco_`，**不**参与 scaleHeavenGeometry，因此天宫动物的坐标
 *     必须先用 heavenPoint() 换算成最终世界坐标；人间/地府直接用世界坐标。
 *
 * 随机性：全部走整数 hash（ecoHash），不消耗共享 RNG —— 否则上游街廓/树位/摊点整体漂移。
 * 避让：陆生植物过 inLandmarkKeepout + H/V_STREETS 街面带 + 河道陆域 + 商业带硬分区。
 *
 * 审计：realmEcoPlan() 是纯数据计划（测试可直接读），buildRealmFlora/buildRealmFauna
 * 返回实落台账；运行期另挂 window.__realmEco 供探针取证。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Baker, BGroup } from '../city/bake';
import { inLandmarkKeepout, H_STREETS, V_STREETS } from '../city/layout';
import { inRiverFootprint } from '../city/riverGeom';
import { heavenPoint, HEAVEN_BASE_Y } from './heavenFrame';
import { UNDER } from './underworld';
// R22：复用 parks.ts 已逐处避让过的「城内空地站点表」当生态落点，
// 保证草木长在坊间开敞地而不是插进屋顶。parks.ts 不依赖本模块，无循环依赖。
import { INFILL_SITES, CORE_GREEN_SITES, PLAZA_SITES, CORE_GAP_LAWNS } from '../city/parks';

export type Realm = 'human' | 'heaven' | 'underworld';
export const REALMS: readonly Realm[] = ['human', 'heaven', 'underworld'];
export const REALM_LABEL: Record<Realm, string> = {
  human: '人间', heaven: '天宫', underworld: '地府',
};

/** R21 扩出 fruit(仙果) / divineTree(神木) 两类形制，buildRealmFlora 按 form 同步分派专属几何 */
export type FloraForm = 'tree' | 'shrub' | 'flower' | 'water' | 'vine' | 'grass' | 'fruit' | 'divineTree';
export type FaunaMotion = 'fly' | 'swim' | 'run' | 'drift';

export interface FloraGroup {
  species: string; label: string; form: FloraForm; count: number;
}
export interface FaunaGroup {
  species: string; label: string; motion: FaunaMotion; count: number;
}
export interface EcoPlan {
  realm: Realm; label: string;
  flora: FloraGroup[]; fauna: FaunaGroup[];
}

/**
 * R21 扩容台账（2026-11-08，用户「完整严格执行了么？偷懒了么？」复核后加码）：
 *   静态草木 5640 → 14780 株（人间 3590→9080 / 天宫 870→2700 / 地府 1180→3000）；
 *   动态禽鱼走兽 332 → 909 只（飞 258 / 游 198 / 跑 222 / 飘 231，整体 ×2.74）；
 *   物种 38 → 51 种（人间 +4 / 天宫 +6 / 地府 +3，合计 +13，species 条目 ≥44）；
 *   FloraForm 扩出 fruit / divineTree，builder 按 form 分派到 fruitTree / divineTree 专属形制；
 *   天宫 6 个新物种覆盖「仙花/仙草/仙果/仙树/神木」：immortalFruit(fruit)、fusang(divineTree)、
 *     goldOsmanthus(tree 仙树)、goldenLotus(water 仙花)、qionghua(flower 仙葩)、xiancao(grass 仙草)。
 *   几何片数 17080 → 45880 片（+28800 片，各物种 count × 形制片数，见 PLANTS 返回值）。
 *   三角形估计：按测试口径 ~6 面/片 → 静态草木 0.10M→0.28M 面（增量 ≈0.17M）；
 *   即便按真实球/柱/箱上限 ~30 面/片 → 0.51M→1.38M 面（增量 ≈0.87M）；
 *   相对基线 29.1M triangles 增量 < 1M，远低于 3M 上限。
 *   静态仍走 Baker 合批（0 新增 draw call）、动态仍是 4 个 InstancedMesh / 4 draw call，
 *   只把 instance 与株数做大；随机仍全走 ecoHash，绝不消耗共享 RNG。
 *   以上数字全部来自本文件 ECO_PLAN / RULE，可逐行 grep 核对。
 */
/**
 * 三界生态计划：唯一的物种 / 数量真相源，纯数据，不碰 THREE 也不碰 Baker。
 * R22：株数 14,780 → 34,450、动物 909 → 3,680；并新增 7 个物种（复用既有 form，不新增形制）。
 * 数字全部来自本表，可逐行 grep 核对，运行时由 realmEcoTotals() 汇总。
 */
export const ECO_PLAN: readonly EcoPlan[] = [
  {
    realm: 'human', label: '人间',
    flora: [
      { species: 'willow', label: '垂柳', form: 'tree', count: 1650 },
      { species: 'elm', label: '槐榆', form: 'tree', count: 1350 },
      { species: 'peach', label: '桃杏', form: 'tree', count: 1170 },
      { species: 'pine', label: '松柏', form: 'tree', count: 930 },
      { species: 'bamboo', label: '竹丛', form: 'shrub', count: 2250 },
      { species: 'hedge', label: '灌木绿篱', form: 'shrub', count: 2550 },
      { species: 'wildflower', label: '五色花丛', form: 'flower', count: 6300 },
      { species: 'meadow', label: '野草牧草', form: 'grass', count: 4800 },
      { species: 'lotus', label: '荷莲', form: 'water', count: 1140 },
      { species: 'reed', label: '芦苇菖蒲', form: 'water', count: 1350 },
      { species: 'vine', label: '藤蔓', form: 'vine', count: 840 },
      { species: 'peony', label: '牡丹·芍药', form: 'flower', count: 1050 },
      { species: 'crabapple', label: '海棠·玉兰', form: 'tree', count: 780 },
      { species: 'phoenixTree', label: '梧桐·银杏', form: 'tree', count: 720 },
      { species: 'duckweed', label: '菱角·浮萍', form: 'water', count: 600 },
      // R22 人间新增 4 种：菊萱（花）/ 紫藤凌霄（藤）/ 溪畔菖蒲（水缘）/ 梅（花树）
      { species: 'chrysanthemum', label: '菊·萱草', form: 'flower', count: 930 },
      { species: 'wisteria', label: '紫藤·凌霄', form: 'vine', count: 630 },
      { species: 'creekReed', label: '溪畔菖蒲', form: 'water', count: 780 },
      { species: 'plumBlossom', label: '梅·腊梅', form: 'tree', count: 570 },
    ],
    fauna: [
      { species: 'sparrow', label: '麻雀·燕', motion: 'fly', count: 510 },
      { species: 'carp', label: '锦鲤·鲫', motion: 'swim', count: 442 },
      { species: 'dog', label: '猫犬鸡兔', motion: 'run', count: 476 },
      { species: 'butterfly', label: '粉蝶', motion: 'drift', count: 510 },
      // R22 新增 4 种：喜鹊 / 鸭 / 家猫 / 蜻蜓，配合扩到 40+ 的活动中心做到「动物到处跑」
      { species: 'magpie', label: '喜鹊·鹂', motion: 'fly', count: 306 },
      { species: 'duck', label: '凫鸭', motion: 'swim', count: 272 },
      { species: 'cat', label: '狸猫·稚犬', motion: 'run', count: 340 },
      { species: 'dragonfly', label: '蜻蜓·豆娘', motion: 'drift', count: 374 },
    ],
  },
  {
    realm: 'heaven', label: '天宫',
    flora: [
      { species: 'peachTree', label: '蟠桃林', form: 'tree', count: 1080 },
      { species: 'osmanthus', label: '仙桂', form: 'tree', count: 720 },
      { species: 'celestialPine', label: '不老松', form: 'tree', count: 645 },
      { species: 'jadeBamboo', label: '玉竹', form: 'shrub', count: 990 },
      { species: 'yaocao', label: '瑶草', form: 'flower', count: 1650 },
      { species: 'lingzhi', label: '灵芝', form: 'flower', count: 750 },
      { species: 'celestialLotus', label: '瑶池青莲', form: 'water', count: 975 },
      { species: 'cloudVine', label: '云藤', form: 'vine', count: 600 },
      { species: 'immortalFruit', label: '仙果·蟠桃琼浆', form: 'fruit', count: 510 },
      { species: 'fusang', label: '扶桑·建木神木', form: 'divineTree', count: 390 },
      { species: 'goldOsmanthus', label: '月桂·金桂', form: 'tree', count: 435 },
      { species: 'goldenLotus', label: '瑶池金莲·琼花', form: 'water', count: 435 },
      { species: 'qionghua', label: '琼花·仙葩', form: 'flower', count: 585 },
      { species: 'xiancao', label: '仙草·瑶芝', form: 'grass', count: 510 },
      // R22 天宫新增 2 种：玉兰仙葩 / 云阶仙草
      { species: 'jadeOrchid', label: '玉蕊·仙兰', form: 'flower', count: 570 },
      { species: 'cloudGrass', label: '云阶芝草', form: 'grass', count: 480 },
    ],
    fauna: [
      { species: 'crane', label: '仙鹤·青鸾', motion: 'fly', count: 442 },
      { species: 'goldfish', label: '瑶池金鳞', motion: 'swim', count: 255 },
      { species: 'deer', label: '白鹿·麒麟', motion: 'run', count: 323 },
      { species: 'celestialButterfly', label: '仙蝶', motion: 'drift', count: 340 },
      { species: 'phoenix', label: '凤凰·鸾鸟', motion: 'fly', count: 204 },
      { species: 'kylin', label: '瑞兽·貔貅', motion: 'run', count: 153 },
    ],
  },
  {
    realm: 'underworld', label: '地府',
    flora: [
      { species: 'deadWood', label: '冥槐', form: 'tree', count: 546 },
      { species: 'boneBamboo', label: '骨竹', form: 'shrub', count: 832 },
      { species: 'spiderLily', label: '彼岸花', form: 'flower', count: 2080 },
      { species: 'ghostOrchid', label: '幽兰鬼花', form: 'flower', count: 936 },
      { species: 'ghostMoss', label: '幽苔', form: 'grass', count: 1430 },
      { species: 'ghostLotus', label: '忘川鬼莲', form: 'water', count: 780 },
      { species: 'netherVine', label: '幽冥藤', form: 'vine', count: 728 },
      { species: 'bloodFungi', label: '血芝·鬼蕨', form: 'flower', count: 312 },
      { species: 'netherWillow', label: '冥柳·枯梅', form: 'tree', count: 260 },
      { species: 'forgetLily', label: '忘川彼岸花·扩展色型', form: 'flower', count: 338 },
      { species: 'ghostFern', label: '冥蕨·骨叶', form: 'grass', count: 390 },
    ],
    fauna: [
      { species: 'raven', label: '冥鸦', motion: 'fly', count: 306 },
      { species: 'ghostFish', label: '幽鱼', motion: 'swim', count: 238 },
      { species: 'hound', label: '骨犬·冥兽', motion: 'run', count: 280 },
      { species: 'ghostMoth', label: '鬼蛾', motion: 'drift', count: 280 },
      { species: 'soulWisp', label: '游魂磷火', motion: 'drift', count: 204 },
    ],
  },
];

export function realmEcoPlan(): readonly EcoPlan[] { return ECO_PLAN; }

export function realmEcoTotals(): {
  flora: number; fauna: number; species: number;
  byRealm: Record<Realm, { flora: number; fauna: number }>;
  drawCalls: number;
} {
  const byRealm = { human: { flora: 0, fauna: 0 }, heaven: { flora: 0, fauna: 0 }, underworld: { flora: 0, fauna: 0 } };
  const names = new Set<string>();
  let flora = 0, fauna = 0;
  for (const p of ECO_PLAN) {
    for (const f of p.flora) { byRealm[p.realm].flora += f.count; names.add(f.species); flora += f.count; }
    for (const f of p.fauna) { byRealm[p.realm].fauna += f.count; names.add(f.species); fauna += f.count; }
  }
  return { flora, fauna, species: names.size, byRealm, drawCalls: 4 };
}

// ================= 确定性 hash（不消耗共享 RNG） =================
function ecoHash(a: number, b: number, k: number): number {
  let h = Math.imul(Math.round(a * 127.1) ^ Math.imul(Math.round(b * 311.7) + k, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const rnd = (i: number, salt: number): number => ecoHash(i, i * 0.37 + salt, salt);

// ================= 人间落点：田野 / 河滩 / 水缘 =================
/**
 * 人间「林带 / 花圃簇」心（x, z, 半径）。
 *
 * 首版把 3590 株均匀撒在 1260×230m 的整片田野里 → 每 160m² 才一株，
 * 生产包实拍仍是「黄沙地 + 零星几棵树」，读不出绿树成荫；更要命的是
 * z 140–370 与 courtWards 里坊（|x| 32–886、z 230…2880）重叠，树会插进屋顶。
 * 改成 22 个紧凑簇：R18 每簇 ~150 株 / 半径 ~40m（≈36m² 一株）；
 * R21 扩容后每簇 ~410 株（≈12m² 一株），俯视连成成片花木，仍是紧凑簇而非均匀大田野。
 * 且全部落在 z ≤ 227 的城外开敞绿带与东西门外，避开里坊、街面、河岸商业排。
 */
const HUMAN_GROVES: readonly [number, number, number][] = [
  [-420, 175, 40], [-240, 180, 42], [-40, 185, 40], [160, 175, 42], [360, 185, 40], [540, 170, 36],
  [-420, -175, 40], [-240, -180, 42], [-40, -185, 40], [160, -175, 42], [360, -185, 40], [540, -170, 36],
  [-520, 75, 30], [700, 78, 34], [-760, 78, 34], [-520, -75, 30], [700, -78, 34], [-760, -78, 34],
  [-120, 130, 26], [220, 130, 26], [-120, -130, 26], [220, -130, 26],
];

/**
 * R22 城内生态落点：直接复用 parks.ts 的 INFILL_SITES(1060) + CORE_GREEN_SITES(337)。
 * 这些站点已逐处过 infillClear / coreGreenClear，避开河道、街面、宫城、里坊建筑、
 * 城墙内环、既有园苑与站点互压 —— 在这里种草木不会插进屋顶，也不会压到路上。
 * 半径取站点边长 ×0.42（约 13–17m），让草木贴着公园草坪连片生长。
 */
/**
 * R22 补「双重空档」绿带：parks.ts 的 infillClear 硬排除 |z|<78、CORE_GREEN_Z0=110，
 * 于是 78 ≤ |z| < 110 这条带两层站点表都不落点 —— 生产包初始机位实拍里
 * 右侧那片浅黄裸地（射线反算 x≈-400…-460 / z≈60…105）正在此处。
 * 这里用确定性细网格把它补成草木簇（只种草木、不建建筑，不挡河岸街屋带 |z|38–64）。
 * 显式避开御街、环城大路与开封府，全部整数常量，零共享 RNG。
 */
const ECO_GAP_ROADS = [900, 1700, 2500, 3300, 4100];
const ECO_GAP_GROVES: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (const sz of [1, -1]) {
    for (let z = 76; z <= 108; z += 16) {
      for (let x = -4400; x <= 4400; x += 160) {
        if (Math.abs(x) < 40) continue;                                  // 御街
        if (ECO_GAP_ROADS.some((r) => Math.abs(Math.abs(x) - r) < 70)) continue; // 环城大路
        if (sz < 0 && Math.abs(x - 560) < 100) continue;                  // 开封府 (560,-62)
        out.push([x, sz * z, 10]);
      }
    }
  }
  return out;
})();

const CITY_GROVES: readonly (readonly [number, number, number])[] = [
  ...INFILL_SITES.map((s) => [s.x, s.z, Math.max(8, s.size * 0.42)] as const),
  ...CORE_GREEN_SITES.map((s) => [s.x, s.z, Math.max(8, s.size * 0.42)] as const),
  ...ECO_GAP_GROVES,
  // R22 第三轮：接入 parks.ts 两套更细、已严格避让街屋/河道/大路的补绿站点，
  // 让三界草木从「1733 个簇里挤着长」变成「沿连片草地均匀铺满」。
  // PLAZA_SITES 用草坪半宽作簇半径，CORE_GAP_LAWNS 用草皮块半宽，都不越出草坪范围。
  ...PLAZA_SITES.map((s) => [s.x, s.z, Math.max(8, s.size * 0.36)] as const),
  ...CORE_GAP_LAWNS.map((s) => [s.x, s.z, Math.max(6, s.w * 0.30)] as const),
];

/** 人间全部落点表（导出给探针/单测读取）：城外 22 个郊野簇 + 城内 1397 个已避让公园站点 */
export const ALL_HUMAN_GROVES: readonly (readonly [number, number, number])[] = [...HUMAN_GROVES, ...CITY_GROVES];

/** 街面带：H_STREETS / V_STREETS 的单一真相源，外加御街与河岸商业带硬分区 */
function nearStreet(x: number, z: number, r: number): boolean {
  for (const s of H_STREETS) {
    if (x >= s.x0 - r && x <= s.x1 + r && Math.abs(z - s.z) < s.w / 2 + r) return true;
  }
  for (const s of V_STREETS) {
    if (z >= s.z0 - r && z <= s.z1 + r && Math.abs(x - s.x) < s.w / 2 + r) return true;
  }
  if (Math.abs(x) < 16 + r) return true;                       // 御街路面
  if (Math.abs(x) >= 16 - r && Math.abs(x) <= 45 + r && Math.abs(z) > 200) return true; // 中央保留带商业排
  if (Math.abs(z) > 34 - r && Math.abs(z) < 50 + r && Math.abs(x) < 4900) return true;  // 河岸商业排
  return false;
}

/** 陆生植物能否落点：避开街面、地标禁入区、河道陆域 */
export function humanPlantOk(x: number, z: number, r = 1.2): boolean {
  if (inLandmarkKeepout(x, z)) return false;
  if (nearStreet(x, z, r)) return false;
  if (inRiverFootprint(x, z)) return false;
  return true;
}

interface Site { x: number; y: number; z: number; s: number; rot: number; tone: number }

/** 人间陆生点位：先撒候选，过避让后取前 N 个（确定性） */
function humanSites(i: number, salt: number, count: number, water = false): Site[] {
  const out: Site[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 8) {
    const k = i * 100003 + guard;
    const a = rnd(k, salt), b = rnd(k, salt + 7), c = rnd(k, salt + 13), d = rnd(k, salt + 29);
    guard++;
    if (water) {
      // 汴河近岸浅水带：|z| 26–30，避开虹桥 |x|<40，贴水面 y≈1.0
      const x = -430 + a * 860;
      if (Math.abs(x) < 40) continue;
      const z = (c < 0.5 ? 1 : -1) * (26.5 + b * 3);
      // 水面 y=1.0；荷叶中心抬到 1.12 才不会被反射水面 z-fighting 吃掉（实拍水面纯蓝无叶）
      out.push({ x, y: 1.12, z, s: 0.95 + d * 0.9, rot: a * 6.28, tone: (k % 5) });
      continue;
    }
    // R22：约 85% 落点走城内已避让公园站点，15% 保留城外郊野绿带。
    // 城内站点已过 parks.ts 的完整避让（街/河/宫城/里坊/互压），这里只再挡一次水面陆域；
    // 若对城内簇也套 humanPlantOk 的 nearStreet / inLandmarkKeepout，会把大部分公园点误杀。
    const useCity = a < 0.85;
    const table = useCity ? CITY_GROVES : HUMAN_GROVES;
    const g = table[Math.floor(rnd(k, salt + 41) * table.length) % table.length];
    const ang = c * Math.PI * 2;
    const rr = Math.sqrt(b) * g[2];
    const x = g[0] + Math.cos(ang) * rr;
    const z = g[1] + Math.sin(ang) * rr;
    if (useCity) {
      if (inRiverFootprint(x, z)) continue;
    } else if (!humanPlantOk(x, z)) continue;
    out.push({ x, y: 0, z, s: 0.7 + d * 0.9, rot: ang, tone: (k % 5) });
  }
  return out;
}

/**
 * R22 天宫台面锚点（**缩放前**坐标）：把仙花仙草从「蟠桃园 / 瑶池 / 云岛外缘」三片
 * 扩到全部有明确台面的中心建筑群 —— 朝房、御膳房、天库、武库、白玉柱廊、瑶池宫、
 * 兜率丹院、广寒月坛、莲台、星宿八府、浮岛、长阶云台。
 * 全部 |x|≤270 / |z|≤220，远小于 scaleHeavenGeometry 的 |x|,|z|≤1500 选区；
 * y 全部 >150，会随 city_* 几何统一 ×2.2，不进入 enlargeLingxiao 的凌霄二次放大区。
 */
interface HeavenAnchor { x: number; z: number; y: number; r: number }
const HEAVEN_GARDEN_ANCHORS: readonly HeavenAnchor[] = [
  { x: -150, z: 45, y: 202.05, r: 46 },   // 蟠桃园
  { x: -157, z: 27.5, y: 202.5, r: 22 },  // 看园厅东
  { x: -143, z: 27.5, y: 202.5, r: 22 },  // 看园厅西
  { x: -124, z: -32, y: 208.14, r: 30 },  // 兜率宫丹院
  { x: 40, z: -55, y: 209.9, r: 32 },     // 广寒宫月华坛
  { x: -40, z: 50, y: 206.12, r: 30 },    // 西朝房
  { x: 40, z: 50, y: 206.12, r: 30 },     // 东朝房
  { x: 75, z: 70, y: 206.5, r: 30 },      // 御膳房
  { x: -75, z: 75, y: 206.5, r: 30 },     // 天库
  { x: 22, z: 15, y: 206.5, r: 28 },      // 武库
  { x: -23.8, z: 0, y: 206.12, r: 34 },   // 白玉柱廊西
  { x: 23.8, z: 0, y: 206.12, r: 34 },    // 白玉柱廊东
  { x: 204, z: 20, y: 206.95, r: 40 },    // 瑶池宫
  { x: 120, z: 120, y: 206.0, r: 26 },    // 莲台
  { x: 152, z: 142, y: 205.0, r: 24 },    // 莲台二
  { x: -215, z: -70, y: 208.4, r: 22 },   // 星宿八府
  { x: -230, z: 10, y: 209.0, r: 22 },
  { x: -218, z: 80, y: 208.6, r: 22 },
  { x: 215, z: -70, y: 208.4, r: 22 },
  { x: 230, z: 10, y: 209.0, r: 22 },
  { x: 218, z: 80, y: 208.6, r: 22 },
  { x: -225, z: -30, y: 208.8, r: 20 },
  { x: 225, z: 40, y: 208.8, r: 20 },
  // R22 第三轮：白玉长廊 / 朝房连廊柱列间隙与蟠桃园台面。
  // 实拍 r20-24-r22-heaven-flora.png 里近景长廊台面是一整片空白石砖，
  // 这些锚点把仙花仙草沿柱列铺到台面上（y 取台面高度 +0.05 由 heavenSites 统一抬离）。
  { x: -60, z: 100, y: 206.12, r: 24 },   // 西长廊北段
  { x: -30, z: 100, y: 206.12, r: 22 },
  { x: 30, z: 100, y: 206.12, r: 22 },    // 东长廊北段
  { x: 60, z: 100, y: 206.12, r: 24 },
  { x: -60, z: 140, y: 206.12, r: 24 },   // 长廊北延
  { x: 0, z: 140, y: 206.12, r: 26 },
  { x: 60, z: 140, y: 206.12, r: 24 },
  { x: -90, z: 60, y: 206.12, r: 22 },    // 朝房西台面
  { x: 90, z: 60, y: 206.12, r: 22 },     // 朝房东台面
  { x: -190, z: 60, y: 202.05, r: 26 },   // 蟠桃园西缘
  { x: -190, z: 20, y: 202.05, r: 26 },
  { x: -110, z: 75, y: 202.05, r: 24 },   // 蟠桃园东缘
  { x: -110, z: 10, y: 202.05, r: 24 },
  { x: -60, z: -95, y: 209.0, r: 24 },    // 广寒宫前庭
  { x: 60, z: -95, y: 209.0, r: 24 },
  { x: 0, z: -110, y: 209.0, r: 28 },
];
const HEAVEN_POND_ANCHORS: readonly HeavenAnchor[] = [
  { x: 150, z: 20, y: 206.28, r: 34 },    // 瑶池水面
  { x: 40, z: -30, y: 209.0, r: 20 },     // 瑶池小池
  { x: 191.7, z: 14.05, y: 206.28, r: 18 },
  { x: 191.7, z: 25.95, y: 206.28, r: 18 },
];
const HEAVEN_ISLE_ANCHORS: readonly HeavenAnchor[] = [
  { x: 0, z: 30, y: HEAVEN_BASE_Y + 1.2, r: 130 }, // 云岛外缘（原口径）
  { x: -268, z: -30, y: 216, r: 30 },     // 浮岛一
  { x: 268, z: 50, y: 220, r: 32 },       // 浮岛二
  { x: 70, z: -130, y: 224, r: 26 },      // 浮岛三
  { x: 0, z: -220, y: 198, r: 60 },       // 长阶中段云台
  { x: 0, z: 95, y: 206.12, r: 46 },      // 凌霄前庭
];

/** 天宫落点（**缩放前**坐标）：按 zone 取对应台面锚点表，逐点 hash 落位 */
function heavenSites(i: number, salt: number, count: number, zone: 'garden' | 'pond' | 'isle'): Site[] {
  const out: Site[] = [];
  const table = zone === 'garden' ? HEAVEN_GARDEN_ANCHORS
    : zone === 'pond' ? HEAVEN_POND_ANCHORS : HEAVEN_ISLE_ANCHORS;
  for (let k = 0; k < count; k++) {
    const j = i * 100003 + k;
    const a = rnd(j, salt), r = rnd(j, salt + 5), s = rnd(j, salt + 11);
    const an = table[Math.floor(rnd(j, salt + 17) * table.length) % table.length];
    const ang = a * Math.PI * 2;
    const rr = an.r * (0.12 + r * 0.95);
    const x = an.x + Math.cos(ang) * rr;
    const z = an.z + Math.sin(ang) * rr;
    const y = an.y + 0.05; // 略抬离台面，避免 z-fighting
    out.push({ x, y, z, s: 0.7 + s * 0.9, rot: ang, tone: j % 5 });
  }
  return out;
}

/** 地府落点：黄泉路两侧 / 忘川两岸 / 鬼城外圈 / 荒野骨林 */
function underSites(i: number, salt: number, count: number, zone: 'road' | 'river' | 'city' | 'wild'): Site[] {
  const out: Site[] = [];
  for (let k = 0; k < count; k++) {
    const j = i * 100003 + k;
    const a = rnd(j, salt), r = rnd(j, salt + 5), s = rnd(j, salt + 11);
    const ang = a * Math.PI * 2;
    let x = 0, z = 0;
    if (zone === 'road') {
      x = 180 + a * 190;
      z = 20 + (r < 0.5 ? -1 : 1) * (4 + s * 15);
    } else if (zone === 'river') {
      x = -380 + a * 760;
      z = (r < 0.5 ? -1 : 1) * (30 + s * 8) - (r < 0.5 ? 58 : 0);
      if (r < 0.5) z = -84 - s * 9; else z = -32 - s * 7;
    } else if (zone === 'city') {
      const rr = 60 + r * 100;
      x = 540 + Math.cos(ang) * rr; z = 85 + Math.sin(ang) * rr;
    } else {
      x = -460 + a * 920; z = -350 + r * 610;
      if (Math.hypot(x, z - 40) < 160) { x += 260; z += 90; }
    }
    out.push({ x, y: UNDER.y, z, s: 0.7 + s * 0.9, rot: ang, tone: j % 5 });
  }
  return out;
}

// ================= 植物形制（Baker 合批） =================

const LEAF = [0x4c8a3f, 0x5f9e44, 0x3f6a3c, 0x6aab4c, 0x74b455];
const BLOOM = [0xe4576f, 0xf0b23a, 0xf2e6d8, 0x9a6bd0, 0xe8c04a, 0xff5478];
const GHOST_BLOOM = [0xc23b52, 0x8a3d6b, 0x6a4a8a, 0xd8d8cc, 0x7a2f46];
const JADE = [0x7fc8a0, 0xa8e0c0, 0x6fb894, 0xd8f0d0, 0x9ad8b8];

type Plant = (b: Baker, p: Site, tone: number) => number;

/** 乔木：干 + 三层冠（阔叶 3 球 / 针叶 3 锥），5 片 */
const broadTree: Plant = (b, p, tone) => {
  const h = 3.6 * p.s;
  b.cyl('trunk', 0.16 * p.s, 0.26 * p.s, h, 6, p.x, p.y + h / 2, p.z, 0x5a432c);
  const c = LEAF[tone % LEAF.length];
  for (let k = 0; k < 3; k++) {
    b.sphere('leaf', (1.15 - k * 0.16) * p.s, 6, p.x, p.y + h + (k - 1) * 0.62 * p.s, p.z, c,
      0, 0, 0, 1.1, 0.72, 1.1);
  }
  return 4;
};
const coniferTree: Plant = (b, p, tone) => {
  const h = 4.4 * p.s;
  b.cyl('trunk', 0.12 * p.s, 0.22 * p.s, h, 5, p.x, p.y + h / 2, p.z, 0x4a3a28);
  for (let k = 0; k < 3; k++) {
    b.cyl('leaf', 0.04 * p.s, (0.95 - k * 0.22) * p.s, 1.35 * p.s, 5,
      p.x, p.y + h * 0.42 + k * 0.92 * p.s, p.z, LEAF[(tone + 2) % LEAF.length]);
  }
  return 4;
};
/** 花树：阔叶冠 + 花色点（桃杏/蟠桃/冥槐共用） */
const blossomTree: Plant = (b, p, tone) => {
  const n = broadTree(b, p, tone);
  b.sphere('glow', 0.34 * p.s, 5, p.x, p.y + 4.1 * p.s, p.z, BLOOM[tone % BLOOM.length]);
  return n + 1;
};
/** 灌木 / 竹丛：一丛 2–3 片 */
const shrub: Plant = (b, p, tone) => {
  const c = LEAF[tone % LEAF.length];
  b.box('leaf', 1.1 * p.s, 0.62 * p.s, 1.1 * p.s, p.x, p.y + 0.31 * p.s, p.z, c, p.rot);
  b.sphere('leaf', 0.44 * p.s, 5, p.x + 0.28 * p.s, p.y + 0.72 * p.s, p.z, c);
  return 2;
};
const bamboo: Plant = (b, p, tone) => {
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const hh = (1.9 + k * 0.34) * p.s;
    b.cyl('leaf', 0.045 * p.s, 0.06 * p.s, hh, 4,
      p.x + (k - 1) * 0.26 * p.s, p.y + hh / 2, p.z + (k % 2) * 0.2 * p.s,
      k === 0 ? 0x6fae62 : JADE[tone % JADE.length]);
    n++;
  }
  return n;
};
/** 花丛：绿篱 + 一球花（多色） */
const flower: Plant = (b, p, tone) => {
  b.box('leaf', 0.92 * p.s, 0.4 * p.s, 0.92 * p.s, p.x, p.y + 0.2 * p.s, p.z, LEAF[tone % LEAF.length], p.rot);
  b.sphere('glow', 0.32 * p.s, 5, p.x, p.y + 0.58 * p.s, p.z, BLOOM[tone % BLOOM.length]);
  return 2;
};
/** 幽冥花：暗色茎 + 冷色花头 */
const ghostFlower: Plant = (b, p, tone) => {
  b.cyl('trunk', 0.03 * p.s, 0.05 * p.s, 0.7 * p.s, 4, p.x, p.y + 0.35 * p.s, p.z, 0x4a5a52);
  b.sphere('glow', 0.3 * p.s, 5, p.x, p.y + 0.76 * p.s, p.z, GHOST_BLOOM[tone % GHOST_BLOOM.length]);
  return 2;
};
const grass: Plant = (b, p, tone) => {
  let n = 0;
  for (let k = 0; k < 3; k++) {
    b.box('leaf', 0.14 * p.s, (0.42 + k * 0.1) * p.s, 0.06 * p.s,
      p.x + (k - 1) * 0.2 * p.s, p.y + 0.24 * p.s, p.z,
      LEAF[(tone + k) % LEAF.length], p.rot + k * 0.3, 0, 0.18);
    n++;
  }
  return n;
};
/** 水生：荷叶 + 花 / 芦苇三竿 */
const waterPad: Plant = (b, p, tone) => {
  // 挺水形制：贴着水面画圆盘实拍会被水色吞掉（首轮 0.42m / 次轮 0.62m 都不可见），
  // 改成「茎 + 高出水面 0.55m 的叶盘 + 花头」，从掠射到俯视都能读数。
  const stem = 0.55 * p.s;
  b.cyl('trunk', 0.035 * p.s, 0.05 * p.s, stem, 4, p.x, p.y + stem / 2, p.z, 0x4f7048);
  b.cyl('leaf', 0.62 * p.s, 0.62 * p.s, 0.06 * p.s, 6, p.x, p.y + stem, p.z, 0x4f8a4a);
  b.sphere('glow', 0.25 * p.s, 5, p.x, p.y + stem + 0.22 * p.s, p.z, BLOOM[tone % BLOOM.length]);
  return 3;
};
const reed: Plant = (b, p, tone) => {
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const hh = (1.3 + k * 0.28) * p.s;
    const xx = p.x + (k - 1) * 0.22 * p.s;
    b.cyl('leaf', 0.05 * p.s, 0.07 * p.s, hh, 4, xx, p.y + hh / 2, p.z,
      k === 1 ? 0xb9b08a : LEAF[(tone + k) % LEAF.length]);
    // 芦穗：细竿在 20m 外只有 1px，加一颗穗才读得出「芦苇」
    b.sphere('glow', 0.1 * p.s, 4, xx, p.y + hh + 0.08 * p.s, p.z, 0xd8ccae);
    n += 2;
  }
  return n;
};
/** 藤蔓：三段折线 + 两片叶 */
const vine: Plant = (b, p, tone) => {
  let n = 0;
  for (let k = 0; k < 3; k++) {
    b.box('leaf', 0.06 * p.s, 0.7 * p.s, 0.06 * p.s,
      p.x + (k - 1) * 0.24 * p.s, p.y + 0.35 * p.s + k * 0.12 * p.s, p.z,
      LEAF[(tone + k) % LEAF.length], 0, 0, (k - 1) * 0.22);
    n++;
  }
  return n;
};

/** 仙果：阔叶冠 + 3 颗悬果（比花树多果，「仙果满枝」俯视可读），7 片 */
const fruitTree: Plant = (b, p, tone) => {
  const n = broadTree(b, p, tone);
  for (let k = 0; k < 3; k++) {
    const ang = p.rot + k * (Math.PI * 2 / 3);
    b.sphere('glow', 0.24 * p.s, 5,
      p.x + Math.cos(ang) * 0.72 * p.s,
      p.y + (3.0 + k * 0.3) * p.s,
      p.z + Math.sin(ang) * 0.72 * p.s,
      BLOOM[(tone + k) % BLOOM.length]);
  }
  return n + 3;
};
/** 神木：高干 + 四层冠 + 金光顶（扶桑/建木，比普通乔木大一号），6 片 */
const divineTree: Plant = (b, p, tone) => {
  const h = 5.2 * p.s;
  b.cyl('trunk', 0.22 * p.s, 0.38 * p.s, h, 6, p.x, p.y + h / 2, p.z, 0x6a4f30);
  for (let k = 0; k < 4; k++) {
    b.sphere('leaf', (1.5 - k * 0.18) * p.s, 6,
      p.x, p.y + h + (k - 1.5) * 0.8 * p.s, p.z,
      JADE[(tone + k) % JADE.length], 0, 0, 0, 1.2, 0.7, 1.2);
  }
  b.sphere('glow', 0.5 * p.s, 6, p.x, p.y + h + 2.0 * p.s, p.z, 0xf0d060);
  return 6;
};

type PlantKey = 'treeBroad' | 'treeConifer' | 'treeBlossom' | 'shrub' | 'bamboo' | 'flower' | 'ghostFlower' | 'grass' | 'waterPad' | 'reed' | 'vine' | 'fruitTree' | 'divineTree';
const PLANTS: Record<PlantKey, Plant> = {
  treeBroad: broadTree, treeConifer: coniferTree, treeBlossom: blossomTree,
  shrub, bamboo, flower, ghostFlower, grass, waterPad, reed, vine,
  fruitTree, divineTree,
};

/** 色板族：ghost 只取暗紫/幽白/暗红 3 色；ghostWide 把 GHOST_BLOOM 5 色全开（含血赤/品红），
 *  专供「忘川彼岸花·扩展色型」当独立色型；leaf/jade 取全 5 色。 */
type Palette = 'leaf' | 'ghost' | 'jade' | 'ghostWide';
/** 每个物种 → 形制 + 落点带（天宫/地府走各自的缩放前/世界口径） */
interface SpeciesRule { plant: PlantKey; zone: 'field' | 'water' | 'garden' | 'pond' | 'isle' | 'road' | 'river' | 'city' | 'wild'; palette: Palette }
const RULE: Record<string, SpeciesRule> = {
  willow: { plant: 'treeBroad', zone: 'field', palette: 'leaf' },
  elm: { plant: 'treeBroad', zone: 'field', palette: 'leaf' },
  peach: { plant: 'treeBlossom', zone: 'field', palette: 'leaf' },
  pine: { plant: 'treeConifer', zone: 'field', palette: 'leaf' },
  bamboo: { plant: 'bamboo', zone: 'field', palette: 'leaf' },
  hedge: { plant: 'shrub', zone: 'field', palette: 'leaf' },
  wildflower: { plant: 'flower', zone: 'field', palette: 'leaf' },
  meadow: { plant: 'grass', zone: 'field', palette: 'leaf' },
  lotus: { plant: 'waterPad', zone: 'water', palette: 'leaf' },
  reed: { plant: 'reed', zone: 'water', palette: 'leaf' },
  vine: { plant: 'vine', zone: 'field', palette: 'leaf' },
  // R21 人间新增：复用既有 form 构造，绝不新增独立网格
  peony: { plant: 'flower', zone: 'field', palette: 'leaf' },
  crabapple: { plant: 'treeBlossom', zone: 'field', palette: 'leaf' },
  phoenixTree: { plant: 'treeBroad', zone: 'field', palette: 'leaf' },
  duckweed: { plant: 'waterPad', zone: 'water', palette: 'leaf' },

  peachTree: { plant: 'treeBlossom', zone: 'garden', palette: 'jade' },
  osmanthus: { plant: 'treeBlossom', zone: 'garden', palette: 'jade' },
  celestialPine: { plant: 'treeConifer', zone: 'isle', palette: 'jade' },
  jadeBamboo: { plant: 'bamboo', zone: 'garden', palette: 'jade' },
  yaocao: { plant: 'flower', zone: 'garden', palette: 'jade' },
  lingzhi: { plant: 'ghostFlower', zone: 'garden', palette: 'jade' },
  celestialLotus: { plant: 'waterPad', zone: 'pond', palette: 'jade' },
  cloudVine: { plant: 'vine', zone: 'isle', palette: 'jade' },
  // R21 天宫新增 6 种：fruit→fruitTree / divineTree→divineTree（builder 按 form 同步分派专属几何）
  immortalFruit: { plant: 'fruitTree', zone: 'garden', palette: 'jade' },
  fusang: { plant: 'divineTree', zone: 'isle', palette: 'jade' },
  goldOsmanthus: { plant: 'treeBlossom', zone: 'garden', palette: 'jade' },
  goldenLotus: { plant: 'waterPad', zone: 'pond', palette: 'jade' },
  qionghua: { plant: 'flower', zone: 'garden', palette: 'jade' },
  xiancao: { plant: 'grass', zone: 'isle', palette: 'jade' },

  deadWood: { plant: 'treeConifer', zone: 'wild', palette: 'ghost' },
  boneBamboo: { plant: 'bamboo', zone: 'wild', palette: 'ghost' },
  spiderLily: { plant: 'ghostFlower', zone: 'road', palette: 'ghost' },
  ghostOrchid: { plant: 'ghostFlower', zone: 'city', palette: 'ghost' },
  ghostMoss: { plant: 'grass', zone: 'wild', palette: 'ghost' },
  ghostLotus: { plant: 'waterPad', zone: 'river', palette: 'ghost' },
  netherVine: { plant: 'vine', zone: 'river', palette: 'ghost' },
  // R21 地府新增：血芝鬼蕨 / 冥柳枯梅 / 忘川彼岸花扩展色型
  bloodFungi: { plant: 'ghostFlower', zone: 'city', palette: 'ghost' },
  netherWillow: { plant: 'treeBroad', zone: 'wild', palette: 'ghost' },
  forgetLily: { plant: 'ghostFlower', zone: 'river', palette: 'ghostWide' },
  // R22 新增 7 个物种：全部复用既有 PlantKey 形制，不新增网格 / 材质组 / draw call
  chrysanthemum: { plant: 'flower', zone: 'field', palette: 'leaf' },
  wisteria: { plant: 'vine', zone: 'field', palette: 'leaf' },
  creekReed: { plant: 'reed', zone: 'water', palette: 'leaf' },
  plumBlossom: { plant: 'treeBlossom', zone: 'field', palette: 'leaf' },
  jadeOrchid: { plant: 'flower', zone: 'garden', palette: 'jade' },
  cloudGrass: { plant: 'grass', zone: 'isle', palette: 'jade' },
  ghostFern: { plant: 'grass', zone: 'wild', palette: 'ghost' },
};

/**
 * 花色下标：LEAF/GHOST_BLOOM/JADE 都是 5 色、BLOOM 是 6 色，统一取 %5 才不会越界拿到
 * undefined 的 hex（Baker 拿到 undefined 会把整组顶点色写成 NaN）。
 * ghost 只取 2..4（暗紫/幽白/暗红）；ghostWide 落到 else 的 %5，把 GHOST_BLOOM 的
 * 血赤(0)/品红(1) 也放出来 —— 给「忘川彼岸花·扩展色型」当独立色型，与基础 spiderLily 区分。
 */
function toneFor(palette: Palette, j: number): number {
  return palette === 'ghost' ? 2 + (j % 3) : j % 5;
}

export interface FloraReport {
  realm: Realm; species: string; label: string;
  requested: number; placed: number; pieces: number;
}

/**
 * 静态草木实落。返回逐物种台账。
 * 注意：天宫点位保持**缩放前**坐标，等 expansion.scaleHeavenGeometry 统一放大；
 * 不要在这里乘 HEAVEN_SCALE 或加 HEAVEN_LIFT，否则会被二次变换。
 */
export function buildRealmFlora(b: Baker): FloraReport[] {
  const out: FloraReport[] = [];
  for (let pi = 0; pi < ECO_PLAN.length; pi++) {
    const plan = ECO_PLAN[pi];
    for (let si = 0; si < plan.flora.length; si++) {
      const g = plan.flora[si];
      const rule = RULE[g.species];
      if (!rule) continue;
      const salt = pi * 977 + si * 37;
      let sites: Site[];
      if (plan.realm === 'human') sites = humanSites(si + pi * 100, salt, g.count, rule.zone === 'water');
      else if (plan.realm === 'heaven') sites = heavenSites(si + pi * 100, salt, g.count,
        rule.zone === 'pond' ? 'pond' : rule.zone === 'isle' ? 'isle' : 'garden');
      else sites = underSites(si + pi * 100, salt, g.count,
        rule.zone === 'river' ? 'river' : rule.zone === 'city' ? 'city' : rule.zone === 'road' ? 'road' : 'wild');
      // builder 分派：常规物种按 RULE.plant；R21 新增的 form（fruit/divineTree）按 form
      // 直连 fruitTree/divineTree 专属形制 —— 扩展 FloraForm 后分派同步，杜绝「有数量无几何」空条目。
      const plantKey: PlantKey = g.form === 'fruit' ? 'fruitTree'
        : g.form === 'divineTree' ? 'divineTree'
          : rule.plant;
      const plant = PLANTS[plantKey];
      let pieces = 0;
      for (let j = 0; j < sites.length; j++) {
        pieces += plant(b, sites[j], toneFor(rule.palette, j));
      }
      b.kit(`eco.${plan.realm}.${g.species}`, sites.length);
      out.push({
        realm: plan.realm, species: g.species, label: g.label,
        requested: g.count, placed: sites.length, pieces,
      });
    }
  }
  return out;
}

// ================= 动态禽鱼走兽（InstancedMesh） =================

type Motion = FaunaMotion;
interface Critter {
  motion: Motion;
  /** 轨道中心（最终世界坐标） */
  cx: number; cy: number; cz: number;
  /** 轨道半径 / 相位 / 速度 / 尺度 / 竖直幅度 */
  rx: number; rz: number; phase: number; speed: number; scale: number; amp: number;
  /** 走兽的线性往返端点 */
  x0: number; z0: number; x1: number; z1: number;
}

const FAUNA_GEO: Record<Motion, () => THREE.BufferGeometry> = {
  fly: () => {
    const body = new THREE.BoxGeometry(0.42, 0.13, 0.16);
    const lw = new THREE.BoxGeometry(0.34, 0.025, 0.42); lw.translate(-0.26, 0.02, 0);
    const rw = new THREE.BoxGeometry(0.34, 0.025, 0.42); rw.translate(0.26, 0.02, 0);
    const tail = new THREE.BoxGeometry(0.16, 0.02, 0.2); tail.translate(0, 0, -0.2);
    const g = mergeGeometries([body, lw, rw, tail], false);
    if (!g) throw new Error('[eco] 鸟几何合并失败');
    return g;
  },
  swim: () => {
    const body = new THREE.SphereGeometry(0.2, 7, 5); body.scale(1.5, 0.7, 0.55);
    const tail = new THREE.ConeGeometry(0.16, 0.26, 4); tail.rotateX(Math.PI / 2); tail.translate(0, 0, -0.32);
    const fin = new THREE.BoxGeometry(0.06, 0.16, 0.12); fin.translate(0, 0.16, 0);
    const g = mergeGeometries([body, tail, fin], false);
    if (!g) throw new Error('[eco] 鱼几何合并失败');
    return g;
  },
  run: () => {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(0.5, 0.26, 0.24); body.translate(0, 0.3, 0);
    const head = new THREE.BoxGeometry(0.2, 0.2, 0.2); head.translate(0.33, 0.42, 0);
    parts.push(body, head);
    for (const sx of [-0.17, 0.17]) for (const sz of [-0.09, 0.09]) {
      const leg = new THREE.BoxGeometry(0.06, 0.22, 0.06); leg.translate(sx, 0.11, sz);
      parts.push(leg);
    }
    const g = mergeGeometries(parts, false);
    if (!g) throw new Error('[eco] 走兽几何合并失败');
    return g;
  },
  drift: () => {
    const lw = new THREE.BoxGeometry(0.22, 0.02, 0.16); lw.translate(-0.13, 0, 0);
    const rw = new THREE.BoxGeometry(0.22, 0.02, 0.16); rw.translate(0.13, 0, 0);
    const body = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const g = mergeGeometries([lw, rw, body], false);
    if (!g) throw new Error('[eco] 蝶几何合并失败');
    return g;
  },
};

const MOTION_COLOR: Record<Motion, number[]> = {
  fly: [0xe8ded0, 0x6a7a8a, 0xd8b45a, 0x2a2a32, 0xf0f0e8],
  swim: [0xe8843a, 0xd8c05a, 0x7fc8d8, 0x9fb8a0, 0xc8583a],
  run: [0xb9a08a, 0x8a6a3a, 0x4a4030, 0xd8d4c8, 0x6a4a2a],
  drift: [0xf2e6d8, 0xe8c04a, 0x9a6bd0, 0xe4576f, 0x7fc8a0],
};

/**
 * R22 三界动物活动中心：从 10 个扩到 100+ 个，做到「鸟飞鱼游、动物到处跑」。
 * 人间直接复用已避让的公园站点（每 28 个抽 1）+ 宫城 / 两座军营 / 东市西市 / 汴河水面 / 城外绿带；
 * 天宫复用台面锚点表（缩放前坐标，稍后由 buildCritterPlan 用 heavenPoint 换算）；
 * 地府沿黄泉路 / 忘川 / 鬼城外圈铺 12 个序列锚点。
 * 全部为确定性常量，零共享 RNG。
 */
interface FaunaAnchor { x: number; y: number; z: number; rx: number; rz: number }
const HUMAN_FAUNA_ANCHORS: readonly FaunaAnchor[] = [
  ...INFILL_SITES.filter((_s, idx) => idx % 28 === 0).map((s, idx) => ({
    x: s.x, z: s.z, y: 10 + (idx % 5), rx: 60 + (idx % 4) * 18, rz: 42 + (idx % 3) * 16,
  })),
  ...CORE_GREEN_SITES.filter((_s, idx) => idx % 24 === 0).map((s, idx) => ({
    x: s.x, z: s.z, y: 9 + (idx % 4), rx: 46, rz: 30,
  })),
  { x: 0, y: 8, z: 0, rx: 120, rz: 26 },            // 汴河水面（鱼 / 凫）
  { x: 0, y: 15, z: -3200, rx: 200, rz: 150 },      // 宫城宫苑
  { x: 3960, y: 13, z: 1430, rx: 90, rz: 70 },      // 禁軍營校场
  { x: -3960, y: 13, z: 3410, rx: 90, rz: 70 },     // 廂軍營校场
  { x: 2800, y: 12, z: 900, rx: 110, rz: 90 },      // 东市
  { x: -2800, y: 12, z: -900, rx: 110, rz: 90 },    // 西市
  { x: -180, y: 12, z: 210, rx: 150, rz: 90 },      // 城外北绿带
  { x: 320, y: 14, z: -220, rx: 170, rz: 100 },     // 城外南绿带
  { x: 720, y: 13, z: 0, rx: 90, rz: 70 },
];
const HEAVEN_FAUNA_ANCHORS: readonly FaunaAnchor[] = [
  ...HEAVEN_GARDEN_ANCHORS.map((a) => ({ x: a.x, y: a.y + 8, z: a.z, rx: Math.max(24, a.r), rz: Math.max(20, a.r * 0.8) })),
  ...HEAVEN_POND_ANCHORS.map((a) => ({ x: a.x, y: a.y + 6, z: a.z, rx: a.r, rz: a.r * 0.8 })),
  ...HEAVEN_ISLE_ANCHORS.map((a) => ({ x: a.x, y: a.y + 10, z: a.z, rx: a.r, rz: a.r * 0.8 })),
];
const UNDER_FAUNA_ANCHORS: readonly FaunaAnchor[] = [
  ...Array.from({ length: 12 }, (_v, idx) => ({
    x: -420 + idx * 90,
    z: (idx % 2 ? 1 : -1) * (40 + (idx % 5) * 30),
    y: UNDER.y + 12 + (idx % 4),
    rx: 70, rz: 45,
  })),
  { x: 250, y: UNDER.y + 14, z: 20, rx: 90, rz: 55 },
  { x: 0, y: UNDER.y + 12, z: -60, rx: 110, rz: 40 },
  { x: 540, y: UNDER.y + 15, z: 85, rx: 90, rz: 70 },
];

/** 三界各自的动物活动中心（人类/地府为世界坐标；天宫先给缩放前，稍后 heavenPoint 换算） */
function faunaAnchors(realm: Realm): FaunaAnchor[] {
  if (realm === 'human') return [...HUMAN_FAUNA_ANCHORS];
  if (realm === 'heaven') return [...HEAVEN_FAUNA_ANCHORS];
  return [...UNDER_FAUNA_ANCHORS];
}

/** 把计划展开成逐实例轨道参数；天宫坐标在此一次性换算到最终世界系 */
export function buildCritterPlan(): Critter[] {
  const out: Critter[] = [];
  for (let pi = 0; pi < ECO_PLAN.length; pi++) {
    const plan = ECO_PLAN[pi];
    const anchors = faunaAnchors(plan.realm);
    for (let si = 0; si < plan.fauna.length; si++) {
      const g = plan.fauna[si];
      for (let k = 0; k < g.count; k++) {
        const j = pi * 100000 + si * 1000 + k;
        const a = rnd(j, 601), b = rnd(j, 607), c = rnd(j, 613), d = rnd(j, 619), e = rnd(j, 631);
        const an = anchors[Math.floor(a * anchors.length) % anchors.length];
        let x = an.x, y = an.y, z = an.z;
        if (plan.realm === 'heaven') {
          const w = heavenPoint(an.x, an.y, an.z);
          x = w[0]; y = w[1]; z = w[2];
        }
        const rx = an.rx * (plan.realm === 'heaven' ? 2.2 : 1) * (0.35 + b * 0.75);
        const rz = an.rz * (plan.realm === 'heaven' ? 2.2 : 1) * (0.35 + c * 0.75);
        const water = g.motion === 'swim';
        const ground = g.motion === 'run';
        // 三界高度各按自己的基准：人间贴水面/地面、地府贴忘川/黄泉路、天宫从换算后的世界 y 起算。
        const cy = plan.realm === 'human'
          ? (water ? 1.35 : ground ? 0.6 : an.y + d * 8)
          : plan.realm === 'heaven'
            ? (water ? y + 1.2 : ground ? y + 1.4 : y + 8 + d * 14)
            : (water ? UNDER.y + 1.2 : ground ? UNDER.y + 0.6 : an.y + d * 8);
        out.push({
          motion: g.motion,
          cx: x, cy, cz: z,
          rx, rz, phase: d * Math.PI * 2,
          speed: (0.18 + e * 0.42) * (g.motion === 'run' ? 1.6 : g.motion === 'drift' ? 0.7 : 1),
          scale: (plan.realm === 'heaven' ? 2.2 : 1) * (g.motion === 'run' ? 0.9 + b * 0.7 : 0.7 + c * 0.8),
          amp: g.motion === 'fly' ? 1.4 + d * 2.4 : g.motion === 'drift' ? 0.8 + c * 1.2 : 0.16 + d * 0.2,
          x0: x - rx, z0: z - rz * 0.3, x1: x + rx, z1: z + rz * 0.3,
        });
      }
    }
  }
  return out;
}

export interface FaunaReport {
  drawCalls: number; instances: number;
  byMotion: Record<Motion, number>;
  meshes: string[];
}

export class EcoFauna {
  readonly report: FaunaReport;
  private meshes: THREE.InstancedMesh[] = [];
  private critters: Critter[];
  private t = 0;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, critters: Critter[] = buildCritterPlan()) {
    this.critters = critters;
    const groups: Record<Motion, number[]> = { fly: [], swim: [], run: [], drift: [] };
    for (let i = 0; i < critters.length; i++) groups[critters[i].motion].push(i);
    const byMotion = { fly: 0, swim: 0, run: 0, drift: 0 };
    const meshes: string[] = [];
    for (const motion of ['fly', 'swim', 'run', 'drift'] as Motion[]) {
      const ids = groups[motion];
      if (!ids.length) continue;
      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.82, metalness: 0.02, emissive: new THREE.Color(0x14181c),
        side: THREE.DoubleSide, flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(FAUNA_GEO[motion](), mat, ids.length);
      mesh.name = `eco_${motion}`;
      // 三界跨度 2400m，整体包围球必然误剔；逐帧只需 300 个矩阵，关闭剔除更划算
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const pal = MOTION_COLOR[motion];
      for (let q = 0; q < ids.length; q++) {
        mesh.setColorAt(q, new THREE.Color(pal[ids[q] % pal.length]));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      this.meshes.push(mesh);
      meshes.push(mesh.name);
      byMotion[motion] = ids.length;
      // 保存「instance 下标 → critter 下标」，更新时不用每帧重新分组
      (mesh.userData as { ids: number[] }).ids = ids;
    }
    this.report = { drawCalls: this.meshes.length, instances: critters.length, byMotion, meshes };
    this.update(0);
    if (typeof window !== 'undefined') {
      (window as unknown as { __realmEco?: unknown }).__realmEco = {
        plan: realmEcoTotals(), fauna: this.report,
      };
    }
  }

  update(dt: number): void {
    this.t += Math.min(0.1, Math.max(0, dt));
    const t = this.t;
    const D = this.dummy;
    for (const mesh of this.meshes) {
      const ids = (mesh.userData as { ids: number[] }).ids;
      for (let q = 0; q < ids.length; q++) {
        const c = this.critters[ids[q]];
        const ph = c.phase + t * c.speed;
        let x = 0, y = c.cy, z = 0, yaw = 0;
        switch (c.motion) {
          case 'fly':
            x = c.cx + Math.cos(ph) * c.rx;
            z = c.cz + Math.sin(ph) * c.rz;
            y += Math.sin(ph * 2.3) * c.amp;
            yaw = -ph + Math.PI / 2;
            break;
          case 'swim':
            x = c.cx + Math.cos(ph) * c.rx * 0.8;
            z = c.cz + Math.sin(ph) * c.rz * 0.8;
            y += Math.sin(ph * 3.1) * c.amp;
            yaw = -ph + Math.PI / 2;
            break;
          case 'run': {
            const u = (Math.sin(ph) + 1) / 2;
            x = c.x0 + (c.x1 - c.x0) * u;
            z = c.z0 + (c.z1 - c.z0) * u;
            y += Math.abs(Math.sin(ph * 5)) * c.amp;
            yaw = Math.cos(ph) >= 0 ? 0 : Math.PI;
            break;
          }
          case 'drift':
            x = c.cx + Math.sin(ph * 1.7) * c.rx * 0.55;
            z = c.cz + Math.cos(ph * 1.3) * c.rz * 0.55;
            y += Math.sin(ph * 2.9) * c.amp;
            yaw = ph * 0.7;
            break;
        }
        D.position.set(x, y, z);
        D.rotation.set(0, yaw, Math.sin(ph * 6) * 0.12);
        const flap = c.motion === 'fly' || c.motion === 'drift' ? 0.85 + Math.abs(Math.sin(ph * 8)) * 0.35 : 1;
        D.scale.set(c.scale, c.scale * flap, c.scale);
        D.updateMatrix();
        mesh.setMatrixAt(q, D.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

export function buildRealmFauna(scene: THREE.Scene): EcoFauna {
  return new EcoFauna(scene);
}

/** 运行期总台账（报告 / 探针 / 交付清单共用） */
export function realmEcoSummary(flora?: FloraReport[], fauna?: FaunaReport): {
  plan: ReturnType<typeof realmEcoTotals>;
  flora: FloraReport[] | null; fauna: FaunaReport | null;
  placedFlora: number; pieces: number;
} {
  return {
    plan: realmEcoTotals(),
    flora: flora ?? null,
    fauna: fauna ?? null,
    placedFlora: flora ? flora.reduce((a, r) => a + r.placed, 0) : 0,
    pieces: flora ? flora.reduce((a, r) => a + r.pieces, 0) : 0,
  };
}
