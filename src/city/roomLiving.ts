/**
 * R17 · 三档起居资产库（2026-11-07）
 *
 * 判词（用户原话）：
 *   「很多房间里缺少家具、物品、生活用品、洗漱用品、起居用品、装饰装潢等。
 *     构建一批资产，分高中低档，各档物品随机组合，放置到对应档次的房间中。
 *     所有房间中都要有资产。」
 *
 * 与 R16 商铺陈设（interiors.ts 的 TRADE_KIT）的分工：
 *   · R16 铺的是「营生器物」——柜台、货架、药柜、灶台、算盘，读的是**这间店做什么**；
 *   · R17 铺的是「过日子的痕迹」——床榻、箱笼、脸盆、妆奁、巾架、灯檠、盆景、挂轴，
 *     读的是**谁住在这里、过得讲究还是将就**。两层叠加，不替换、不删除既有陈设。
 *
 * 硬约束：
 *   ① 随机性只走坐标 hash（同 interiors.ts 的 r16hash / h01 约定），**绝不消耗共享 RNG**，
 *      否则整座城的街廓/树位/摊点会整体漂移；
 *   ② 每间必落六大类各 ≥1 件，低档也不许空房；
 *   ③ 面数：绝大多数器件是单盒/单柱（1 片 = 12 面），只有床榻、妆台、博古架拆 2 片；
 *      挂件贴墙不占地，不干扰 shopInterior.test.ts 的「最大空白矩形」判据（只会更满）；
 *   ④ 资产按房间档次推导（面阔 + 业态 + 坐标 hash），不是全城随机撒，
 *      御街大铺/钱庄茶楼偏高档，窄面铺/面馆杂货偏低档。
 *
 * 审计：beginLivingAudit() / endLivingAudit() 把每间实际落位记下来，
 * tests/roomLiving.test.ts 直接读它判「所有房间都有资产 / 六类覆盖 / 三档组合不重样」。
 *
 * R18 · 密度扩容（2026-11-08，用户「每间房还是太空、物件太少，需要补充」）：
 *   · 资产库 90 → 180 件：三档各 30 → 60 件，六类各 5 → 10 件（每档六类各补 5 件，
 *     重点补洗漱 / 起居 / 功能 / 装饰：铜盆·沐巾架·妆奁·唾盂·灯檠·香炉·屏风·挂轴·
 *     盆景·地毯·锦帐·箱笼·药臼·算盘·账簿·更漏…），全部用现有 BGroup + 几何原语表达。
 *   · 每档每间件数 高 11 / 中 9 / 低 7 → 高 16 / 中 13 / 低 10（base 六类各一 + extra）。
 *   · 全量台账 2903 间 / 26377 件（均 9.1 件）→ 约 38114 件（均约 13.1 件），
 *     ≤ 45000 件、每间 ≤ 16 件；三角形增量约 0.17M（< 1.5M，全场景 29.1M）。
 *   · 前 12 件落位仍用 R17 的 SLOTS 与坐标公式，逐字节不变（不改动已有器物坐标）；
 *     第 13~16 件用新增 EXTRA_SLOTS（全贴墙贴角），并按坐标 hash 做确定性 90° 朝向变化。
 *   · 随机性仍只走坐标 hash，不消耗共享 RNG(20260905)；全部 Baker 合批，
 *     不新增材质组 / draw call / 独立 Mesh。
 *
 * R19 · 立体骨架件结构性修复（2026-11-08，揭顶剖视「只见地板 + 零星贴地色块」）：
 *   · 根因：旧 pick 六类各取一件 + 额外件随机命中大量薄片，180 件里 108 件（60%）是薄片/小件，
 *     living 29 / wash 24 / decor 19 / daily 18 / goods 17 类几乎没有能产出实心盒的立体件；
 *     recording Baker 实测 solids 仅 高 3 / 中 2 / 低 0（判据 h>0.25 且 min(w,d)>0.2）。
 *   · 资产库 180 → 198 件：每档每类补 1 件立体骨架件（六类各 1，共 18 件），
 *     顶箱柜 / 花几 / 米柜 / 盥洗柜 / 雕花衣架 / 落地屏风 / 高柜 / 货架 / 灶台 / 脸盆架 /
 *     木床架 / 座屏 / 碗柜 / 粮柜 / 水缸架 / 瓦盆架 / 铺板床 / 神龛，全部 box / stand 形制。
 *   · 立体骨架件下限 FRAME_MIN：高 8 / 中 6 / 低 5 件（h≥0.45m 且 min(w,d)≥0.35m，
 *     isFrameAsset() 判据），高档明显多于低档；每间总件数仍 16 / 13 / 10。
 *   · pickLivingAssets() 改三段式：① 先按坐标 hash 取 FRAME_MIN 件骨架（furniture / living 优先）；
 *     ② 补齐六类覆盖；③ 薄片点缀补到总件数。薄片不再占据主导。
 *   · 仍只走 lh() 坐标 hash，不消耗共享 RNG(20260905)；仍全部 Baker 合批，无新 draw call / Mesh。
 */
import type { Baker, BGroup } from './bake';

export type RoomTier = 'high' | 'mid' | 'low';
export const ROOM_TIERS: readonly RoomTier[] = ['high', 'mid', 'low'];
export const ROOM_TIER_LABEL: Record<RoomTier, string> = {
  high: '高档', mid: '中档', low: '低档',
};

/** 用户点名的六类：家具 / 物品 / 生活用品 / 洗漱用品 / 起居用品 / 装饰装潢 */
export type LivingCategory = 'furniture' | 'goods' | 'daily' | 'wash' | 'living' | 'decor';
export const LIVING_CATEGORIES: readonly LivingCategory[] = [
  'furniture', 'goods', 'daily', 'wash', 'living', 'decor',
];
export const LIVING_CATEGORY_LABEL: Record<LivingCategory, string> = {
  furniture: '家具', goods: '物品', daily: '生活用品',
  wash: '洗漱用品', living: '起居用品', decor: '装饰装潢',
};

/** 形制：单盒 / 圆柱 / 台面+腿（2 片）/ 贴墙挂件 / 立灯（2 片） */
type Shape = 'box' | 'cyl' | 'stand' | 'hang' | 'lamp';

export interface LivingAsset {
  key: string;
  /** 中文名（报告与审计直接读） */
  n: string;
  cat: LivingCategory;
  g: BGroup;
  shape: Shape;
  /** 面阔 / 高 / 进深（米） */
  w: number; h: number; d: number;
  hex: number;
  hex2?: number;
}

function A(
  key: string, n: string, cat: LivingCategory, g: BGroup, shape: Shape,
  w: number, h: number, d: number, hex: number, hex2?: number,
): LivingAsset {
  return { key, n, cat, g, shape, w, h, d, hex, hex2 };
}

const C = {
  lacquer: 0x4a2a20, lacquerLite: 0x6e3a26, wood: 0x6b4a2b, woodDark: 0x3f2c1c,
  elm: 0x8a6a3a, cloth: 0xe6dcc2, silk: 0xd8b45a, paper: 0xd8cbb0,
  bronze: 0x8a6a3a, iron: 0x4a4030, clay: 0x955539, jade: 0x9fb8a0,
  porcelain: 0xe6e2d6, red: 0x9d2933, green: 0x3f6a3c, glow: 0xffb066,
};

/** 高档：拔步床 / 博古架 / 妆奁 / 铜镜 / 盆景 / 宫灯 / 挂轴 / 瓷器 / 香具 */
const HIGH: LivingAsset[] = [
  // 家具
  A('canopyBed', '拔步床', 'furniture', 'lacquer', 'stand', 2.05, 0.62, 1.24, C.lacquer, C.silk),
  A('curioShelf', '博古架', 'furniture', 'wood', 'stand', 1.28, 1.78, 0.36, C.wood, C.elm),
  A('luohanCouch', '罗汉榻', 'furniture', 'lacquer', 'stand', 1.86, 0.52, 0.86, C.lacquerLite),
  A('roundDesk', '圆鼓桌', 'furniture', 'wood', 'stand', 1.02, 0.8, 1.02, C.elm),
  A('armchair', '圈椅', 'furniture', 'wood', 'box', 0.66, 0.92, 0.6, C.wood),
  // 物品
  A('porcelainVase', '青花瓶', 'goods', 'ceramic', 'cyl', 0.3, 0.56, 0.3, C.porcelain),
  A('jadeRuyi', '玉如意', 'goods', 'ceramic', 'box', 0.46, 0.08, 0.12, C.jade),
  A('bronzeDing', '铜鼎', 'goods', 'metal', 'cyl', 0.38, 0.42, 0.38, C.bronze),
  A('scrollBundle', '卷轴筒', 'goods', 'wood', 'cyl', 0.22, 0.62, 0.22, C.elm),
  A('teaCaddy', '锡茶罐', 'goods', 'metal', 'cyl', 0.2, 0.3, 0.2, C.iron),
  // 生活用品
  A('silkBox', '锦盒', 'daily', 'lacquer', 'box', 0.42, 0.22, 0.32, C.lacquerLite),
  A('chessBoard', '棋枰', 'daily', 'wood', 'box', 0.62, 0.06, 0.62, C.elm),
  A('incenseSet', '香具三事', 'daily', 'metal', 'stand', 0.38, 0.22, 0.24, C.bronze),
  A('fruitTray', '果碟', 'daily', 'ceramic', 'cyl', 0.34, 0.08, 0.34, C.porcelain),
  A('bookCaselet', '袖珍书箧', 'daily', 'wood', 'box', 0.46, 0.32, 0.3, C.woodDark),
  // 洗漱用品
  A('bronzeMirror', '铜镜妆奁', 'wash', 'metal', 'stand', 0.52, 0.66, 0.36, C.bronze, C.lacquer),
  A('basinStand', '盆架铜盆', 'wash', 'wood', 'stand', 0.48, 0.82, 0.44, C.wood, C.bronze),
  A('combCase', '梳篦匣', 'wash', 'lacquer', 'box', 0.32, 0.14, 0.22, C.lacquerLite),
  A('powderJar', '胭脂盒', 'wash', 'ceramic', 'cyl', 0.16, 0.12, 0.16, C.red),
  A('towelRack', '巾架', 'wash', 'wood', 'stand', 0.6, 1.12, 0.2, C.elm, C.cloth),
  // 起居用品
  A('silkQuilt', '锦被褥', 'living', 'fabric', 'box', 1.16, 0.16, 0.78, C.silk),
  A('brocadePillow', '绣枕', 'living', 'fabric', 'box', 0.42, 0.14, 0.26, C.cloth),
  A('bedCurtain', '帐幔', 'living', 'fabric', 'hang', 1.28, 1.4, 0.05, C.silk),
  A('bambooMat', '细竹簟', 'living', 'fabric', 'box', 1.2, 0.06, 0.86, 0xc9b48c),
  A('footWarmer', '铜脚炉', 'living', 'metal', 'cyl', 0.28, 0.2, 0.28, C.bronze),
  // 装饰装潢
  A('hangingScroll', '名人挂轴', 'decor', 'fabric', 'hang', 0.76, 1.32, 0.04, C.paper),
  A('palaceLantern', '宫灯', 'decor', 'glow', 'lamp', 0.36, 0.52, 0.36, C.glow, C.red),
  A('penjing', '松石盆景', 'decor', 'leaf', 'stand', 0.5, 0.44, 0.34, C.green, C.clay),
  A('screenPanel', '漆屏风', 'decor', 'lacquer', 'hang', 1.5, 1.6, 0.06, C.lacquer),
  A('carvedLattice', '雕花槅扇', 'decor', 'wood', 'hang', 0.9, 1.5, 0.06, C.wood),
  // R18 补 30 件（六类各 5）：重点补洗漱 / 起居 / 功能 / 装饰
  // 家具
  A('h18LacquerChest', '漆箱笼', 'furniture', 'lacquer', 'box', 0.9, 0.6, 0.5, C.lacquer),
  A('h18EmbroideredStool', '绣墩', 'furniture', 'fabric', 'cyl', 0.4, 0.44, 0.4, C.silk),
  A('h18BookShelf', '书架', 'furniture', 'wood', 'stand', 1.1, 1.8, 0.34, C.woodDark, C.elm),
  A('h18FoldingChair', '交椅', 'furniture', 'wood', 'box', 0.6, 0.95, 0.55, C.wood),
  A('h18WaistTable', '束腰几', 'furniture', 'lacquer', 'stand', 0.9, 0.5, 0.5, C.lacquerLite),
  // 物品
  A('h18Abacus', '算盘', 'goods', 'wood', 'box', 0.42, 0.06, 0.24, C.woodDark),
  A('h18Ledger', '账簿', 'goods', 'wood', 'box', 0.3, 0.05, 0.22, C.paper),
  A('h18Clepsydra', '更漏', 'goods', 'metal', 'cyl', 0.26, 0.5, 0.26, C.bronze),
  A('h18MedicineMortar', '药臼', 'goods', 'metal', 'cyl', 0.2, 0.18, 0.2, C.iron),
  A('h18SealBox', '印匣', 'goods', 'lacquer', 'box', 0.24, 0.14, 0.18, C.lacquerLite),
  // 生活用品
  A('h18Spittoon', '唾盂', 'daily', 'metal', 'cyl', 0.18, 0.16, 0.18, C.bronze),
  A('h18Censer', '香炉', 'daily', 'metal', 'cyl', 0.22, 0.24, 0.22, C.bronze),
  A('h18TeaStove', '茶炉', 'daily', 'metal', 'cyl', 0.3, 0.3, 0.3, C.iron),
  A('h18FoodCarrier', '提盒', 'daily', 'lacquer', 'box', 0.34, 0.4, 0.3, C.lacquer),
  A('h18CandleStand', '烛台', 'daily', 'metal', 'stand', 0.24, 0.6, 0.24, C.bronze, C.glow),
  // 洗漱用品
  A('h18BronzeBasin', '铜盆', 'wash', 'metal', 'cyl', 0.44, 0.18, 0.44, C.bronze),
  A('h18BathTowelStand', '沐巾架', 'wash', 'wood', 'stand', 0.62, 1.1, 0.2, C.elm, C.cloth),
  A('h18DressingCase', '妆奁', 'wash', 'lacquer', 'box', 0.4, 0.24, 0.3, C.lacquerLite),
  A('h18BronzeYi', '铜匜', 'wash', 'metal', 'cyl', 0.2, 0.16, 0.2, C.bronze),
  A('h18MirrorStand', '镜台', 'wash', 'wood', 'stand', 0.4, 0.7, 0.3, C.wood, C.bronze),
  // 起居用品
  A('h18WoolRug', '地毯', 'living', 'fabric', 'box', 1.6, 0.03, 1.1, C.red),
  A('h18BrocadeValance', '锦帐', 'living', 'fabric', 'hang', 1.3, 1.2, 0.05, C.silk),
  A('h18Bolster', '靠枕', 'living', 'fabric', 'box', 0.5, 0.16, 0.2, C.cloth),
  A('h18CensingBasket', '薰笼', 'living', 'metal', 'cyl', 0.3, 0.3, 0.3, C.bronze),
  A('h18SilkMat', '丝簟', 'living', 'fabric', 'box', 1.2, 0.05, 0.8, C.cloth),
  // 装饰装潢
  A('h18TableScreen', '砚屏', 'decor', 'lacquer', 'box', 0.5, 0.6, 0.14, C.lacquer),
  A('h18CoupletScroll', '对联挂轴', 'decor', 'fabric', 'hang', 0.3, 1.3, 0.04, C.paper),
  A('h18OrchidPenjing', '兰草盆景', 'decor', 'leaf', 'stand', 0.4, 0.4, 0.3, C.green, C.clay),
  A('h18WallVase', '壁瓶', 'decor', 'ceramic', 'hang', 0.18, 0.34, 0.12, C.porcelain),
  A('h18CoralStand', '珊瑚摆件', 'decor', 'metal', 'stand', 0.3, 0.5, 0.24, C.red, C.bronze),
  // R19 立体骨架件（六类各 1）：箱柜 / 几架 / 落地屏风，全部 box / stand，能产出实心盒
  A('h19CanopyCabinet', '顶箱柜', 'furniture', 'lacquer', 'box', 1.1, 1.9, 0.55, C.lacquer),
  A('h19FlowerStand', '花几', 'goods', 'wood', 'stand', 0.5, 0.9, 0.5, C.elm),
  A('h19RiceCabinet', '米柜', 'daily', 'wood', 'box', 0.7, 0.9, 0.5, C.woodDark),
  A('h19WashCabinet', '盥洗柜', 'wash', 'wood', 'stand', 0.7, 0.85, 0.5, C.wood, C.bronze),
  A('h19CarvedRack', '雕花衣架', 'living', 'wood', 'stand', 0.8, 1.5, 0.45, C.wood, C.cloth),
  A('h19FloorScreen', '落地屏风', 'decor', 'lacquer', 'box', 1.4, 1.7, 0.4, C.lacquer),
  // R22 扩容（六类各 3）：重点补洗漱 / 起居 / 功能 / 装饰，以立体骨架件为主
  A('h22DressingTable', '梳妆台', 'furniture', 'lacquer', 'stand', 1.10, 0.86, 0.56, C.lacquerLite, C.bronze),
  A('h22BookCabinet', '典籍柜', 'furniture', 'wood', 'box', 1.24, 1.95, 0.50, C.woodDark),
  A('h22TeaTable', '茶几', 'furniture', 'wood', 'stand', 0.86, 0.52, 0.62, C.elm),
  A('h22JadeCasket', '玉匣', 'goods', 'ceramic', 'box', 0.44, 0.24, 0.32, C.jade),
  A('h22IncenseClock', '香篆钟', 'goods', 'metal', 'cyl', 0.30, 0.34, 0.30, C.bronze),
  A('h22SealCase', '印盒', 'goods', 'lacquer', 'box', 0.30, 0.18, 0.24, C.lacquer),
  A('h22WineWarmer', '温酒器', 'daily', 'metal', 'cyl', 0.30, 0.36, 0.30, C.bronze),
  A('h22SnackBox', '点心盒', 'daily', 'lacquer', 'box', 0.42, 0.20, 0.34, C.lacquerLite),
  A('h22HandWarmer', '手炉', 'daily', 'metal', 'cyl', 0.22, 0.18, 0.22, C.bronze),
  A('h22BronzeEwer', '铜盉', 'wash', 'metal', 'cyl', 0.26, 0.30, 0.26, C.bronze),
  A('h22ToothRinseSet', '漱盂', 'wash', 'ceramic', 'cyl', 0.20, 0.16, 0.20, C.porcelain),
  A('h22RobeRack', '浴巾架', 'wash', 'wood', 'stand', 0.72, 1.24, 0.28, C.wood, C.cloth),
  A('h22SilkCanopy', '锦帐幔', 'living', 'fabric', 'hang', 1.40, 1.30, 0.05, C.silk),
  A('h22QuiltChest', '被褥柜', 'living', 'wood', 'box', 1.00, 0.90, 0.60, C.wood),
  A('h22BambooCouch', '竹夫人', 'living', 'wood', 'cyl', 0.30, 1.10, 0.30, C.elm),
  A('h22JadeScreen', '玉屏风', 'decor', 'ceramic', 'box', 0.90, 1.10, 0.24, C.jade),
  A('h22CeilingLantern', '宫灯架', 'decor', 'glow', 'lamp', 0.42, 0.60, 0.42, C.glow, C.red),
  A('h22FlowerVaseStand', '瓶花几', 'decor', 'wood', 'stand', 0.46, 0.94, 0.46, C.woodDark, C.porcelain),
];

/** 中档：木榻 / 衣柜 / 脸盆 / 妆盒 / 油灯 / 挂画 / 陶瓶 */
const MID: LivingAsset[] = [
  A('woodBed', '木榻', 'furniture', 'wood', 'stand', 1.9, 0.48, 1.1, C.wood, C.cloth),
  A('wardrobe', '立柜', 'furniture', 'wood', 'box', 1.06, 1.72, 0.52, C.woodDark),
  A('squareTable', '方桌', 'furniture', 'wood', 'stand', 0.94, 0.78, 0.94, C.elm),
  A('backChair', '靠背椅', 'furniture', 'wood', 'box', 0.48, 0.88, 0.46, C.wood),
  A('lowCabinet', '矮柜', 'furniture', 'wood', 'box', 0.86, 0.72, 0.42, C.woodDark),
  A('earthenJar', '陶瓮', 'goods', 'ceramic', 'cyl', 0.5, 0.72, 0.5, C.clay),
  A('bambooBasket', '竹箧', 'goods', 'wood', 'cyl', 0.42, 0.36, 0.42, C.elm),
  A('oilCan', '油篓', 'goods', 'wood', 'cyl', 0.34, 0.46, 0.34, C.wood),
  A('coinPouch', '钱褡', 'goods', 'fabric', 'box', 0.34, 0.24, 0.16, 0xc9b48c),
  A('inkBox', '墨匣', 'goods', 'wood', 'box', 0.32, 0.14, 0.24, C.woodDark),
  A('riceBin', '米桶', 'daily', 'wood', 'cyl', 0.56, 0.6, 0.56, C.elm),
  A('bowlStack', '碗摞', 'daily', 'ceramic', 'cyl', 0.32, 0.22, 0.32, C.porcelain),
  A('teaTray', '茶盘', 'daily', 'wood', 'box', 0.44, 0.06, 0.32, C.wood),
  A('sewingBox', '针线笸箩', 'daily', 'fabric', 'box', 0.38, 0.16, 0.3, C.cloth),
  A('firePan', '炭盆', 'daily', 'metal', 'cyl', 0.44, 0.24, 0.44, C.iron),
  A('woodBasin', '木脸盆', 'wash', 'wood', 'cyl', 0.46, 0.2, 0.46, C.wood, C.woodDark),
  A('washStool', '洗漱小凳', 'wash', 'wood', 'box', 0.34, 0.38, 0.34, C.woodDark),
  A('dressingBox', '妆盒', 'wash', 'lacquer', 'box', 0.34, 0.18, 0.26, C.lacquerLite),
  A('waterDipper', '铜匜', 'wash', 'metal', 'cyl', 0.2, 0.16, 0.2, C.bronze),
  A('clothRail', '巾杆', 'wash', 'wood', 'stand', 0.62, 1.0, 0.16, C.elm, C.cloth),
  A('strawMattress', '草褥', 'living', 'fabric', 'box', 1.1, 0.2, 0.74, 0xc9b48c),
  A('clothPillow', '布枕', 'living', 'fabric', 'box', 0.4, 0.13, 0.24, C.cloth),
  A('doorCurtain', '布门帘', 'living', 'fabric', 'hang', 1.08, 1.5, 0.05, C.red),
  A('reedBlind', '苇帘', 'living', 'fabric', 'hang', 1.0, 1.24, 0.05, 0xc9b48c),
  A('quiltRoll', '卷被', 'living', 'fabric', 'box', 0.66, 0.24, 0.38, C.cloth),
  A('paperScroll', '年画挂轴', 'decor', 'fabric', 'hang', 0.62, 1.0, 0.04, C.paper),
  A('oilLamp', '油灯檠', 'decor', 'glow', 'lamp', 0.24, 0.42, 0.24, C.glow, C.woodDark),
  A('clayFlower', '瓦盆花', 'decor', 'leaf', 'stand', 0.36, 0.34, 0.3, C.green, C.clay),
  A('wallGourd', '壁上葫芦', 'decor', 'wood', 'hang', 0.24, 0.4, 0.12, C.elm),
  A('redPaperCut', '窗花', 'decor', 'fabric', 'hang', 0.5, 0.46, 0.03, C.red),
  // R18 补 30 件（六类各 5）
  // 家具
  A('m18ClothesRack', '衣架', 'furniture', 'wood', 'stand', 0.8, 1.5, 0.3, C.wood, C.elm),
  A('m18BoardCabinet', '板柜', 'furniture', 'wood', 'box', 1.0, 1.3, 0.46, C.woodDark),
  A('m18Bench', '长凳', 'furniture', 'wood', 'box', 1.1, 0.44, 0.3, C.elm),
  A('m18SmallStool', '小杌', 'furniture', 'wood', 'cyl', 0.32, 0.38, 0.32, C.wood),
  A('m18Cupboard', '碗橱', 'furniture', 'wood', 'stand', 0.9, 1.4, 0.4, C.woodDark, C.elm),
  // 物品
  A('m18Abacus', '算盘', 'goods', 'wood', 'box', 0.4, 0.06, 0.22, C.woodDark),
  A('m18AccountBook', '账簿', 'goods', 'wood', 'box', 0.28, 0.05, 0.2, C.paper),
  A('m18Steelyard', '杆秤', 'goods', 'wood', 'box', 0.9, 0.06, 0.08, C.elm),
  A('m18OilJar', '油罐', 'goods', 'ceramic', 'cyl', 0.26, 0.34, 0.26, C.clay),
  A('m18CoinString', '钱串', 'goods', 'fabric', 'box', 0.24, 0.1, 0.16, 0xc9b48c),
  // 生活用品
  A('m18MedicineMortar', '药臼', 'daily', 'metal', 'cyl', 0.2, 0.18, 0.2, C.iron),
  A('m18Kettle', '汤壶', 'daily', 'metal', 'cyl', 0.24, 0.28, 0.24, C.bronze),
  A('m18Brazier', '火盆', 'daily', 'metal', 'cyl', 0.4, 0.22, 0.4, C.iron),
  A('m18FoodBox', '食盒', 'daily', 'wood', 'box', 0.36, 0.34, 0.3, C.wood),
  A('m18Ladle', '铜勺', 'daily', 'metal', 'box', 0.28, 0.04, 0.1, C.bronze),
  // 洗漱用品
  A('m18CopperBasin', '铜盆', 'wash', 'metal', 'cyl', 0.42, 0.18, 0.42, C.bronze),
  A('m18FaceTowelBar', '面巾架', 'wash', 'wood', 'stand', 0.58, 1.0, 0.16, C.elm, C.cloth),
  A('m18DressingCase', '妆奁', 'wash', 'lacquer', 'box', 0.36, 0.2, 0.28, C.lacquerLite),
  A('m18Spittoon', '唾盂', 'wash', 'metal', 'cyl', 0.16, 0.14, 0.16, C.bronze),
  A('m18RinsePot', '净手壶', 'wash', 'ceramic', 'cyl', 0.22, 0.28, 0.22, C.clay),
  // 起居用品
  A('m18FeltRug', '毡毯', 'living', 'fabric', 'box', 1.4, 0.03, 1.0, 0xb9a08a),
  A('m18CottonValance', '棉帐', 'living', 'fabric', 'hang', 1.1, 1.3, 0.05, C.cloth),
  A('m18BuckwheatPillow', '荞枕', 'living', 'fabric', 'box', 0.42, 0.13, 0.24, C.cloth),
  A('m18CottonQuilt', '棉被', 'living', 'fabric', 'box', 0.9, 0.22, 0.64, C.cloth),
  A('m18RushMat', '蒲席', 'living', 'fabric', 'box', 1.1, 0.06, 0.76, 0xc9b48c),
  // 装饰装潢
  A('m18FloorScreen', '素屏风', 'decor', 'wood', 'hang', 1.3, 1.5, 0.06, C.wood),
  A('m18PaintingScroll', '书画挂轴', 'decor', 'fabric', 'hang', 0.6, 1.05, 0.04, C.paper),
  A('m18PottedPlant', '盆栽', 'decor', 'leaf', 'stand', 0.36, 0.36, 0.3, C.green, C.clay),
  A('m18ClayCenser', '陶香炉', 'decor', 'ceramic', 'cyl', 0.2, 0.22, 0.2, C.clay),
  A('m18LampStand', '灯檠', 'decor', 'glow', 'lamp', 0.24, 0.5, 0.24, C.glow, C.woodDark),
  // R19 立体骨架件（六类各 1）
  A('m19TallCabinet', '高柜', 'furniture', 'wood', 'box', 1.0, 1.8, 0.5, C.woodDark),
  A('m19ShelfStand', '货架', 'goods', 'wood', 'stand', 0.9, 1.3, 0.4, C.wood, C.elm),
  A('m19StoveBench', '灶台', 'daily', 'earth', 'box', 0.9, 0.7, 0.6, 0xa8926a),
  A('m19WashStand', '脸盆架', 'wash', 'wood', 'stand', 0.6, 0.9, 0.5, C.wood, C.woodDark),
  A('m19BedFrame', '木床架', 'living', 'wood', 'stand', 1.5, 0.6, 0.9, C.wood, C.cloth),
  A('m19ScreenStand', '座屏', 'decor', 'wood', 'box', 1.2, 1.4, 0.35, C.wood),
  // R22 扩容（六类各 3）：中档补成套生活器物与洗漱/起居件
  A('m22ChestOfDrawers', '屉柜', 'furniture', 'wood', 'box', 0.94, 1.10, 0.48, C.wood),
  A('m22Bench', '条凳', 'furniture', 'wood', 'stand', 1.20, 0.46, 0.38, C.elm),
  A('m22CornerShelf', '角架', 'furniture', 'wood', 'stand', 0.62, 1.42, 0.62, C.woodDark),
  A('m22AccountBox', '账匣', 'goods', 'wood', 'box', 0.44, 0.22, 0.32, C.woodDark),
  A('m22ScaleBeam', '秤杆架', 'goods', 'wood', 'stand', 0.50, 1.05, 0.40, C.wood, C.iron),
  A('m22OilJar', '油瓮', 'goods', 'ceramic', 'cyl', 0.42, 0.62, 0.42, C.clay),
  A('m22WaterBucket', '水桶', 'daily', 'wood', 'cyl', 0.38, 0.42, 0.38, C.woodDark),
  A('m22BroomStand', '帚架', 'daily', 'wood', 'stand', 0.40, 0.96, 0.36, C.wood),
  A('m22DishRack', '碗架', 'daily', 'wood', 'box', 0.74, 0.86, 0.40, C.elm),
  A('m22WashBasinSet', '盥洗盆', 'wash', 'ceramic', 'cyl', 0.44, 0.20, 0.44, C.porcelain),
  A('m22CombBox', '梳具匣', 'wash', 'wood', 'box', 0.34, 0.16, 0.24, C.wood),
  A('m22ClothesRail', '衣巾架', 'wash', 'wood', 'stand', 0.78, 1.34, 0.30, C.wood, C.cloth),
  A('m22MattressRoll', '铺盖卷', 'living', 'fabric', 'box', 0.92, 0.26, 0.52, C.cloth),
  A('m22Headrest', '枕箱', 'living', 'wood', 'box', 0.46, 0.22, 0.30, C.woodDark),
  A('m22BedScreen', '床围', 'living', 'fabric', 'hang', 1.14, 0.92, 0.05, C.cloth),
  A('m22DoorGodPrint', '门神年画', 'decor', 'fabric', 'hang', 0.56, 0.94, 0.04, C.red),
  A('m22PotPlantStand', '盆花架', 'decor', 'wood', 'stand', 0.42, 0.82, 0.42, C.wood, C.green),
  A('m22WallLantern', '壁灯', 'decor', 'glow', 'lamp', 0.26, 0.42, 0.26, C.glow, C.woodDark),
];

/** 低档：土炕 / 草席 / 矮桌 / 瓦盆 / 粗陶碗 / 竹帘 —— 将就但绝不空房 */
const LOW: LivingAsset[] = [
  A('earthenKang', '土炕', 'furniture', 'earth', 'box', 1.8, 0.44, 1.0, 0xb9a988),
  A('lowTable', '矮桌', 'furniture', 'wood', 'stand', 0.78, 0.42, 0.62, C.woodDark),
  A('crudeStool', '木墩', 'furniture', 'wood', 'cyl', 0.34, 0.38, 0.34, C.wood),
  A('crateChest', '板箱', 'furniture', 'wood', 'box', 0.76, 0.48, 0.46, C.woodDark),
  A('poleRack', '竹竿架', 'furniture', 'wood', 'stand', 0.9, 1.2, 0.18, C.elm),
  A('clayPot', '粗陶罐', 'goods', 'ceramic', 'cyl', 0.34, 0.42, 0.34, C.clay),
  A('wickerBasket', '柳条筐', 'goods', 'wood', 'cyl', 0.44, 0.34, 0.44, 0x9a7b4a),
  A('sackBundle', '布包袱', 'goods', 'fabric', 'box', 0.46, 0.28, 0.34, 0xc9b48c),
  A('gourdDipper', '葫芦瓢', 'goods', 'wood', 'cyl', 0.2, 0.16, 0.2, C.elm),
  A('firewoodPile', '柴捆', 'goods', 'wood', 'box', 0.68, 0.36, 0.4, C.woodDark),
  A('riceBowl', '粗碗', 'daily', 'ceramic', 'cyl', 0.2, 0.12, 0.2, C.porcelain),
  A('waterBucket', '水桶', 'daily', 'wood', 'cyl', 0.34, 0.4, 0.34, C.woodDark),
  A('broom', '扫帚', 'daily', 'wood', 'cyl', 0.16, 0.92, 0.16, 0x9a7b4a),
  A('grainSack', '粮袋', 'daily', 'fabric', 'box', 0.5, 0.56, 0.38, 0xc9b48c),
  A('clayStove', '小泥炉', 'daily', 'earth', 'cyl', 0.38, 0.34, 0.38, 0xa8926a),
  A('chippedBasin', '豁口瓦盆', 'wash', 'ceramic', 'cyl', 0.4, 0.18, 0.4, 0x8a7a5e),
  A('washCloth', '洗脸巾', 'wash', 'fabric', 'box', 0.32, 0.06, 0.24, C.cloth),
  A('woodComb', '木梳', 'wash', 'wood', 'box', 0.18, 0.04, 0.1, C.woodDark),
  A('soapStone', '皂角石', 'wash', 'ash', 'box', 0.16, 0.08, 0.14, 0x8d8a80),
  A('rinseJug', '提水瓦壶', 'wash', 'ceramic', 'cyl', 0.24, 0.3, 0.24, C.clay),
  A('strawMat', '草席', 'living', 'fabric', 'box', 1.1, 0.08, 0.76, 0xc9b48c),
  A('ragQuilt', '补丁被', 'living', 'fabric', 'box', 0.92, 0.22, 0.66, 0xb9a08a),
  A('strawPillow', '草枕', 'living', 'fabric', 'box', 0.36, 0.12, 0.22, 0xc9b48c),
  A('strawCurtain', '草帘', 'living', 'fabric', 'hang', 1.0, 1.4, 0.05, 0xb9a988),
  A('hempScreen', '麻布隔帘', 'living', 'fabric', 'hang', 0.9, 1.3, 0.05, 0xb9a08a),
  A('paperLamp', '纸灯笼', 'decor', 'glow', 'lamp', 0.24, 0.36, 0.24, C.glow, C.red),
  A('doorGodPrint', '门神纸', 'decor', 'fabric', 'hang', 0.46, 0.62, 0.03, C.red),
  A('wildFlowerJar', '野花瓦罐', 'decor', 'leaf', 'stand', 0.28, 0.3, 0.24, C.green, C.clay),
  A('strawCharm', '草编挂饰', 'decor', 'wood', 'hang', 0.24, 0.36, 0.06, 0xc9b48c),
  A('clayTile', '瓦当摆件', 'decor', 'ash', 'box', 0.24, 0.2, 0.12, 0x8d8a80),
  // R18 补 30 件（六类各 5）
  // 家具
  A('l18PlankChest', '木板箱', 'furniture', 'wood', 'box', 0.8, 0.46, 0.44, C.woodDark),
  A('l18StrawStool', '草墩', 'furniture', 'fabric', 'cyl', 0.34, 0.34, 0.34, 0xc9b48c),
  A('l18BambooRack', '竹架', 'furniture', 'wood', 'stand', 0.7, 1.1, 0.24, C.elm),
  A('l18Crate', '货箱', 'furniture', 'wood', 'box', 0.6, 0.5, 0.5, C.wood),
  A('l18LowBench', '条凳', 'furniture', 'wood', 'box', 0.9, 0.4, 0.28, C.woodDark),
  // 物品
  A('l18BambooAbacus', '竹算盘', 'goods', 'wood', 'box', 0.36, 0.06, 0.2, C.elm),
  A('l18HempRope', '麻绳', 'goods', 'fabric', 'box', 0.3, 0.12, 0.24, 0xc9b48c),
  A('l18Gourd', '葫芦', 'goods', 'wood', 'cyl', 0.18, 0.26, 0.18, C.elm),
  A('l18CoinString', '钱串', 'goods', 'fabric', 'box', 0.2, 0.08, 0.14, 0xc9b48c),
  A('l18EarthBasket', '土筐', 'goods', 'wood', 'cyl', 0.4, 0.3, 0.4, 0x9a7b4a),
  // 生活用品
  A('l18StoneMortar', '石臼', 'daily', 'ash', 'cyl', 0.26, 0.24, 0.26, 0x8d8a80),
  A('l18EarthenKettle', '瓦壶', 'daily', 'ceramic', 'cyl', 0.22, 0.28, 0.22, C.clay),
  A('l18Firewood', '柴禾', 'daily', 'wood', 'box', 0.6, 0.3, 0.36, C.woodDark),
  A('l18ChippedBowl', '破碗', 'daily', 'ceramic', 'cyl', 0.18, 0.1, 0.18, C.porcelain),
  A('l18WoodDipper', '木瓢', 'daily', 'wood', 'cyl', 0.18, 0.14, 0.18, C.elm),
  // 洗漱用品
  A('l18DentedBasin', '瘪铜盆', 'wash', 'metal', 'cyl', 0.38, 0.16, 0.38, C.bronze),
  A('l18FaceClothRail', '面巾杆', 'wash', 'wood', 'stand', 0.5, 0.9, 0.14, C.elm, C.cloth),
  A('l18WoodCase', '木妆匣', 'wash', 'wood', 'box', 0.3, 0.16, 0.22, C.woodDark),
  A('l18RinseJug', '瓦净壶', 'wash', 'ceramic', 'cyl', 0.2, 0.26, 0.2, C.clay),
  A('l18FineComb', '篦子', 'wash', 'wood', 'box', 0.16, 0.03, 0.1, C.woodDark),
  // 起居用品
  A('l18StrawPad', '草垫', 'living', 'fabric', 'box', 1.0, 0.06, 0.7, 0xc9b48c),
  A('l18HempCurtain', '布帘', 'living', 'fabric', 'hang', 0.9, 1.3, 0.05, 0xb9a08a),
  A('l18ChaffPillow', '荞壳枕', 'living', 'fabric', 'box', 0.36, 0.12, 0.22, C.cloth),
  A('l18OldQuilt', '旧棉被', 'living', 'fabric', 'box', 0.86, 0.2, 0.6, 0xb9a08a),
  A('l18ReedMat', '苇席', 'living', 'fabric', 'box', 1.0, 0.05, 0.72, 0xc9b48c),
  // 装饰装潢
  A('l18PaperScreen', '纸屏风', 'decor', 'wood', 'hang', 1.1, 1.4, 0.05, C.paper),
  A('l18NewYearPrint', '年画', 'decor', 'fabric', 'hang', 0.42, 0.58, 0.03, C.red),
  A('l18WildGrass', '野草盆', 'decor', 'leaf', 'stand', 0.26, 0.28, 0.22, C.green, C.clay),
  A('l18ClayIncense', '泥香炉', 'decor', 'earth', 'cyl', 0.2, 0.2, 0.2, 0xa8926a),
  A('l18RushLamp', '草灯', 'decor', 'glow', 'lamp', 0.2, 0.32, 0.2, C.glow, C.red),
  // R19 立体骨架件（六类各 1）
  A('l19Cupboard', '碗柜', 'furniture', 'wood', 'box', 0.8, 1.1, 0.45, C.woodDark),
  A('l19GrainChest', '粮柜', 'goods', 'wood', 'box', 0.9, 0.8, 0.5, C.wood),
  A('l19WaterVatStand', '水缸架', 'daily', 'wood', 'stand', 0.6, 0.7, 0.6, C.woodDark),
  A('l19BasinRack', '瓦盆架', 'wash', 'wood', 'stand', 0.55, 0.8, 0.5, C.wood, C.clay),
  A('l19Bedframe', '铺板床', 'living', 'wood', 'stand', 1.3, 0.5, 0.8, C.woodDark, C.cloth),
  A('l19GodShelf', '神龛', 'decor', 'wood', 'box', 0.6, 0.9, 0.4, C.woodDark),
  // R22 扩容（六类各 3）：低档也要有成件家具与洗漱/起居用品，不再只有薄片
  A('l22PlankCabinet', '板柜', 'furniture', 'wood', 'box', 0.84, 1.16, 0.44, C.woodDark),
  A('l22LowStool', '矮凳', 'furniture', 'wood', 'stand', 0.48, 0.40, 0.48, C.wood),
  A('l22CrateShelf', '箱架', 'furniture', 'wood', 'stand', 0.86, 1.02, 0.48, C.wood),
  A('l22FirewoodBox', '柴箱', 'goods', 'wood', 'box', 0.72, 0.52, 0.50, C.woodDark),
  A('l22RopeCoil', '绳捆', 'goods', 'earth', 'cyl', 0.34, 0.26, 0.34, 0xa8926a),
  A('l22GourdBottle', '葫芦瓶', 'goods', 'earth', 'cyl', 0.24, 0.38, 0.24, C.clay),
  A('l22GrainSack', '米袋', 'daily', 'fabric', 'box', 0.52, 0.62, 0.44, C.cloth),
  A('l22ClayStove', '泥灶', 'daily', 'earth', 'box', 0.70, 0.58, 0.60, 0xa8926a),
  A('l22KindlingRack', '柴架', 'daily', 'wood', 'stand', 0.60, 0.72, 0.44, C.woodDark),
  A('l22WoodenBasin', '木盆', 'wash', 'wood', 'cyl', 0.42, 0.20, 0.42, C.wood),
  A('l22WashClothRail', '巾杆', 'wash', 'wood', 'stand', 0.58, 0.96, 0.24, C.wood, C.cloth),
  A('l22RinseCup', '漱杯', 'wash', 'ceramic', 'cyl', 0.16, 0.14, 0.16, C.clay),
  A('l22StrawPalliasse', '草铺', 'living', 'fabric', 'box', 0.98, 0.18, 0.68, 0xc9b48c),
  A('l22ClothBundle', '包袱', 'living', 'fabric', 'box', 0.48, 0.28, 0.40, C.cloth),
  A('l22RushCurtain', '草苫帘', 'living', 'fabric', 'hang', 0.92, 1.06, 0.05, 0xc9b48c),
  A('l22PaperCharm', '门符', 'decor', 'fabric', 'hang', 0.28, 0.52, 0.03, C.paper),
  A('l22ClayPotPlant', '瓦盆草花', 'decor', 'leaf', 'stand', 0.34, 0.46, 0.34, C.green, C.clay),
  A('l22RushLampStand', '草灯架', 'decor', 'glow', 'lamp', 0.22, 0.48, 0.22, C.glow, C.woodDark),
];

type TierPool = Record<LivingCategory, LivingAsset[]>;

function makePool(list: LivingAsset[]): TierPool {
  const p = {} as TierPool;
  for (const c of LIVING_CATEGORIES) p[c] = [];
  for (const a of list) p[a.cat].push(a);
  return p;
}

/** 三档资产表：R22 后每档 84 件（六类各 14 件），三档合计 252 件 */
export const TIER_ASSETS: Record<RoomTier, TierPool> = {
  high: makePool(HIGH), mid: makePool(MID), low: makePool(LOW),
};

/** 每档配额：六类各一件 + 额外件；R22 提到高 28 / 中 23 / 低 18 件 */
export const TIER_QUOTA: Record<RoomTier, { base: number; extra: number }> = {
  high: { base: 6, extra: 22 },
  mid: { base: 6, extra: 17 },
  low: { base: 6, extra: 12 },
};

/**
 * R22 立体骨架件下限（可 grep 的硬指标）：每间房至少落这么多件「看得见的成件器物」。
 * 高 14 / 中 11 / 低 8，高档明显多于低档；配合 28 个贴墙舱位，房间从「几件点缀」变成「过日子的屋子」。
 */
export const FRAME_MIN: Record<RoomTier, number> = { high: 14, mid: 11, low: 8 };

/**
 * 立体骨架件判据：只有 box / stand 形制能产出 recording Baker 认可的实心盒调用
 * （cyl 不进 box 统计、hang 厚度恒 0.05、lamp 两段都过细/过矮，均不算成件）。
 * 门槛 h≥0.45m 且 min(w,d)≥0.35m，留足 ±10% sc 抖动与 stand 主体 0.7d 收缩的余量，
 * 保证选中的骨架件在真实几何里稳定满足探针判据 h>0.25 且 min(w,d)>0.2。
 */
export function isFrameAsset(a: LivingAsset): boolean {
  return (a.shape === 'box' || a.shape === 'stand')
    && a.h >= 0.45 && Math.min(a.w, a.d) >= 0.35;
}

/** 纯数据目录（测试与报告读它，不产生几何） */
export function livingAssetCatalog(): {
  tier: RoomTier; label: string; total: number;
  byCategory: Record<LivingCategory, string[]>;
}[] {
  return ROOM_TIERS.map((tier) => {
    const byCategory = {} as Record<LivingCategory, string[]>;
    let total = 0;
    for (const c of LIVING_CATEGORIES) {
      byCategory[c] = TIER_ASSETS[tier][c].map((a) => a.n);
      total += byCategory[c].length;
    }
    return { tier, label: ROOM_TIER_LABEL[tier], total, byCategory };
  });
}

/** 坐标 hash（0–1）：整数混合，不消耗共享 RNG */
function lh(a: number, b: number, k: number): number {
  let h = Math.imul(Math.round(a * 71) ^ Math.imul(Math.round(b * 37) + k, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const TRADE_BIAS: Record<string, number> = {
  bank: 0.18, teahouse: 0.12, cloth: 0.07, bookshop: 0.07,
  tavern: 0.03, pharmacy: 0, general: -0.08, noodle: -0.12,
};

export interface RoomTierInput {
  cx: number; cz: number; w: number; d: number;
  variant?: number; trade?: string; compact?: boolean;
}

/**
 * 房间档次的单一真相源：面阔 + 业态 + 坐标 hash，三档都有稳定占比。
 * 「对应档次」不是全城乱撒：12m 通间钱铺大概率高档，7m 窄铺面馆大概率低档。
 */
export function roomTierFor(s: RoomTierInput): RoomTier {
  const wide = Math.max(0, Math.min(1, (s.w - 7) / 10));
  const deep = Math.max(0, Math.min(1, (s.d - 5) / 9));
  const score = lh(s.cx, s.cz, (s.variant ?? 0) + 91) * 0.54
    + wide * 0.20 + deep * 0.08
    + (s.compact ? -0.12 : 0.06)
    + (s.trade ? (TRADE_BIAS[s.trade] ?? 0) : 0);
  return score > 0.66 ? 'high' : score > 0.34 ? 'mid' : 'low';
}

/**
 * R19 结构性挑选（三段式）：
 *   ① 先按坐标 hash 取 FRAME_MIN 件立体骨架件（furniture / living 优先），保证房间里看得见成件家具；
 *   ② 补齐六类覆盖（未覆盖类各取一件，优先该类骨架件）；
 *   ③ 从剩余未用资产里按坐标 hash 起点补齐到 TIER_QUOTA 总件数（薄片点缀，生活气息）。
 * 全程只用 lh() 坐标 hash（不消耗共享 RNG），同一坐标同一 variant 永远得到同一套组合；
 * 历史坑：lh()∈[0,1) 必须先乘 arr.length 再取整，否则 floor 恒 0 退化成固定套装。
 */
export function pickLivingAssets(tier: RoomTier, cx: number, cz: number, variant = 0): LivingAsset[] {
  const pool = TIER_ASSETS[tier];
  const quota = TIER_QUOTA[tier];
  const total = quota.base + quota.extra;
  const out: LivingAsset[] = [];
  const used = new Set<string>();
  const covered = new Set<LivingCategory>();
  let frames = 0;

  const take = (a: LivingAsset): void => {
    used.add(a.key);
    out.push(a);
    covered.add(a.cat);
    if (isFrameAsset(a)) frames++;
  };
  /** 从候选数组按坐标 hash 起点挑第一件未用资产；salt 进坐标与 hash 盐，不同阶段不撞起点 */
  const pickFrom = (arr: LivingAsset[], salt: number): boolean => {
    if (!arr.length) return false;
    const start = Math.floor(lh(cx + salt * 13.7, cz - salt * 7.3, variant + salt * 101) * arr.length) % arr.length;
    for (let probe = 0; probe < arr.length; probe++) {
      const a = arr[(start + probe) % arr.length];
      if (used.has(a.key)) continue;
      take(a);
      return true;
    }
    return false;
  };

  // ① 立体骨架件候选池：furniture / living 优先在前，其余类随后；hash 起点轮转取 FRAME_MIN 件
  const framePool: LivingAsset[] = [
    ...pool.furniture.filter(isFrameAsset),
    ...pool.living.filter(isFrameAsset),
    ...LIVING_CATEGORIES.filter((c) => c !== 'furniture' && c !== 'living')
      .flatMap((c) => pool[c].filter(isFrameAsset)),
  ];
  const fStart = Math.floor(lh(cx + 5.1, cz - 2.3, variant + 307) * (framePool.length || 1)) % (framePool.length || 1);
  for (let k = 0; k < framePool.length && frames < FRAME_MIN[tier]; k++) {
    const a = framePool[(fStart + k) % framePool.length];
    if (used.has(a.key)) continue;
    take(a);
  }

  // ② 六类覆盖：未覆盖类各取一件（优先该类骨架件，其次任意未用件）
  for (let i = 0; i < LIVING_CATEGORIES.length; i++) {
    const c = LIVING_CATEGORIES[i];
    if (covered.has(c)) continue;
    const arr = pool[c];
    pickFrom([...arr.filter(isFrameAsset), ...arr.filter((a) => !isFrameAsset(a))], 60 + i);
  }

  // ③ 补到 total 件：从剩余未用资产里按坐标 hash 起点轮转补齐（薄片点缀，生活气息）
  const rest: LivingAsset[] = [];
  for (const c of LIVING_CATEGORIES) for (const a of pool[c]) if (!used.has(a.key)) rest.push(a);
  const rStart = Math.floor(lh(cx + 9.9, cz - 4.4, variant + 503) * (rest.length || 1)) % (rest.length || 1);
  for (let k = 0; k < rest.length && out.length < total; k++) {
    const a = rest[(rStart + k) % rest.length];
    if (used.has(a.key)) continue;
    take(a);
  }
  return out;
}

// ---------------- 落位 ----------------

export interface LivingRoomSpec {
  cx: number; cz: number;
  /** 室内净空（面阔 / 进深） */
  w: number; d: number;
  /** 地坪上皮 y / 净高 */
  y0: number; h: number;
  /** local +u / +v 的世界方向（单位轴向量） */
  ux: number; uz: number; vx: number; vz: number;
  variant?: number;
  tier?: RoomTier;
  compact?: boolean;
  trade?: string;
  /**
   * R22：器件尺寸缩放，**只缩家具本体，不缩房间与舱位定位**。
   * 天宫 city_* 几何在 loadingDone 后会被逐顶点 ×2.2（凌霄殿再 ×2.7273），
   * 因此天宫调用方须传 1/2.2（普通殿）或 1/6（凌霄殿），让家具落到世界口径 0.5–1m。
   * 人间 / 地府不传，默认 1，既有器物尺寸逐字节不变。
   */
  scale?: number;
  /** 把器物脚印回写给调用方的审计表（interiors.ts 的 TradeRoomAudit） */
  record?: (key: string, name: string, u: number, v: number, wu: number, dv: number, top: number, wall: boolean) => void;
}

export interface LivingRoomAudit {
  cx: number; cz: number; tier: RoomTier;
  categories: LivingCategory[];
  items: { key: string; n: string; cat: LivingCategory }[];
  count: number; pieces: number;
}

let LIVING_AUDIT: LivingRoomAudit[] | null = null;
export function beginLivingAudit(): void { LIVING_AUDIT = []; }
export function endLivingAudit(): LivingRoomAudit[] {
  const out = LIVING_AUDIT ?? [];
  LIVING_AUDIT = null;
  return out;
}

/** R17 的 12 个贴墙 / 贴角舱位（相对 halfU / halfV）；挂件只占前 4 个高位。前 12 件沿用此表，逐字节不变。 */
const SLOTS: readonly [number, number][] = [
  [-0.86, 0.74], [0.86, 0.74], [-0.88, -0.06], [0.88, -0.06],
  [-0.72, -0.78], [0.72, -0.78], [-0.34, 0.86], [0.34, 0.86],
  [-0.38, 0.28], [0.38, 0.28], [0, -0.42], [0.58, -0.46],
];

/** R18 追加、R22 扩到 16 个：第 13~28 件用的高位贴墙 / 深角舱位，全部靠墙贴角，不占中央动线 */
const EXTRA_SLOTS: readonly [number, number][] = [
  [-0.9, 0.42], [0.9, 0.42], [-0.9, -0.44], [0.9, -0.44],
  [-0.52, 0.9], [0.52, -0.9], [-0.68, -0.9], [0.68, 0.9],
  // R22 新增 8 舱：与前 8 个错开 u/v，避免 28 件挤在同一圈
  [-0.78, 0.14], [0.78, 0.14], [-0.78, -0.72], [0.78, -0.72],
  [-0.2, 0.92], [0.2, -0.92], [-0.44, -0.62], [0.44, 0.62],
];

/**
 * 在一间房里落「过日子的痕迹」。返回落位件数。
 * 所有器件都贴墙贴角，不占进门动线；挂件不落地，不参与地面空白矩形计算。
 */
export function buildRoomLiving(b: Baker, s: LivingRoomSpec): { count: number; tier: RoomTier; pieces: number } {
  const tier = s.tier ?? roomTierFor(s);
  const variant = s.variant ?? 0;
  // R22：只作用于器件本体尺寸；舱位仍按房间 halfU/halfV 定位，房间尺度不受影响。
  const assetScale = s.scale ?? 1;
  const assets = pickLivingAssets(tier, s.cx, s.cz, variant);
  const halfU = s.w / 2, halfV = s.d / 2;
  const F = s.y0;
  const ax = Math.abs(s.ux), az = Math.abs(s.uz);
  const bx = Math.abs(s.vx), bz = Math.abs(s.vz);
  const put = {
    box: (g: BGroup, w: number, h: number, d: number, u: number, y: number, v: number, hex: number): void => {
      b.box(g, w * ax + d * bx, h, w * az + d * bz,
        s.cx + s.ux * u + s.vx * v, y, s.cz + s.uz * u + s.vz * v, hex);
    },
    cyl: (g: BGroup, r: number, h: number, u: number, y: number, v: number, hex: number): void => {
      b.cyl(g, r, r * 0.92, h, 5, s.cx + s.ux * u + s.vx * v, y, s.cz + s.uz * u + s.vz * v, hex);
    },
  };

  const cats = new Set<LivingCategory>();
  const recs: LivingRoomAudit['items'] = [];
  let pieces = 0;
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    // 前 12 件沿用 R17 的 SLOTS 与坐标公式（i 即原 slotCursor），逐字节不变；
    // 第 13~16 件用 R18 新增 EXTRA_SLOTS，全部贴墙贴角，不占中央动线。
    const jitter = Math.floor(lh(s.cx + i, s.cz - i, variant + 3) * 3);
    const [su, sv] = i < SLOTS.length
      ? SLOTS[(i + jitter) % SLOTS.length]
      : EXTRA_SLOTS[(i - SLOTS.length + jitter) % EXTRA_SLOTS.length];
    // 逐件 ±10% 尺寸抖动（坐标 hash，确定性）：避免整排房间读成同一套家具。
    const sc = 0.9 + lh(s.cx - i * 3.1, s.cz + i * 5.7, variant + 41) * 0.2;
    // R18：仅新增的第 13~16 件按坐标 hash 做确定性 90° 朝向变化（交换面阔/进深）。
    // 前 12 件 flip 恒 false，w/d 与 R17 完全一致，已有器物坐标与几何零改动。
    const flip = i >= SLOTS.length
      && lh(s.cx + i * 2.3, s.cz - i * 4.1, variant + 77) > 0.5;
    const w = (flip ? a.d : a.w) * sc * assetScale,
      h = a.h * sc * assetScale,
      d = (flip ? a.w : a.d) * sc * assetScale;
    const limU = Math.max(0.25, halfU - w / 2 - 0.2);
    const limV = Math.max(0.25, halfV - d / 2 - 0.2);
    const u = Math.max(-limU, Math.min(limU, su * halfU));
    const v = Math.max(-limV, Math.min(limV, sv * halfV));
    let n = 1;
    switch (a.shape) {
      case 'cyl':
        put.cyl(a.g, w / 2, h, u, F + h / 2, v, a.hex);
        break;
      case 'box':
        put.box(a.g, w, h, d, u, F + h / 2, v, a.hex);
        break;
      case 'stand':
        put.box(a.g, w, h * 0.12, d, u, F + h - h * 0.06, v, a.hex2 ?? a.hex);
        put.box(a.g, w * 0.86, h * 0.88, d * 0.7, u, F + h * 0.44, v, a.hex);
        n = 2;
        break;
      case 'lamp':
        put.box(a.g, w * 0.28, h * 0.7, d * 0.28, u, F + h * 0.35, v, a.hex2 ?? C.woodDark);
        put.box(a.g, w, h * 0.3, d, u, F + h * 0.85, v, a.hex);
        n = 2;
        break;
      case 'hang':
        put.box(a.g, w, h, 0.05, u, F + s.h * 0.56, v, a.hex);
        s.record?.(a.key, a.n, u, v, w, 0.05, F + s.h * 0.56 + h / 2, true);
        cats.add(a.cat); recs.push({ key: a.key, n: a.n, cat: a.cat });
        pieces += 1;
        continue;
    }
    s.record?.(a.key, a.n, u, v, w, d, F + h, false);
    cats.add(a.cat);
    recs.push({ key: a.key, n: a.n, cat: a.cat });
    pieces += n;
  }
  const count = recs.length;
  b.kit(`roomliving.${tier}.rooms`, 1);
  b.kit(`roomliving.${tier}.items`, count);
  if (LIVING_AUDIT) {
    LIVING_AUDIT.push({
      cx: s.cx, cz: s.cz, tier,
      categories: LIVING_CATEGORIES.filter((c) => cats.has(c)),
      items: recs, count, pieces,
    });
  }
  return { count, tier, pieces };
}
