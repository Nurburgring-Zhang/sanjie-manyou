/**
 * institutions.ts —— 全城官署 / 军营「实体院落」补建（R19 续）
 *
 * 用户判词：「其他衙门、军营、等等机构建筑都他妈哪去了？？？—— 衙门仅 1 座实体院落 + 4 牌坊」。
 * buildYamen 尾部 OFFICES 四座只有「两柱 + 一枋 + 一匾」的窄牌坊，完全没有建筑体量。
 * 本文件为 10 座官署 + 2 处军营各建一座有实体体量的院落：照壁 / 仪门（三门制）/ 正堂
 * （屋顶·格窗·台基）/ 两庑六房 / 后堂 / 院墙 / 石狮旗杆 / 匾额，并按机构职能加特色件
 * （樞密院旗鼓甲仗库、國子監辟雍泮池讲堂、欽天監观星台、太醫院药圃药柜、御史臺獬豸狱舍…）。
 *
 * 约束：
 *  · 全部走 Baker 合批，只复用 bake.ts 既有材质组，不新增材质组 / 独立 Mesh / draw call；
 *  · 零 RNG 消耗——显式整数坐标表 + 固定序列，不调用 rng.range / rng.chance / Math.random；
 *  · 本文件只依赖 './bake'（不 import buildings.ts），避免 buildings ↔ institutions 循环依赖；
 *    色板与屋顶原语在文件内自建，数值与 buildings.ts 的 C 对齐。
 *  · 落位：|z| 400–4200、|x| ≤ 4000，避开汴河 |z|<31、街屋带 |z|60–140、开封府(560,−62)、
 *    宫城(z≈−3000)、城墙内侧 |x|>4500、环城大路 |x|/|z| = 900/1700/2500/3300/4100 ±55；
 *    坐标取 parks.ts 网格格心 x≡120(mod 240) / z≡110(mod 220)，与公园站点错开半个步长。
 */
import { Baker, SignMesher, SignAtlas, shade, type BGroup } from './bake';
import { buildRoomLiving } from './roomLiving';

/**
 * R22：起居资产 variant 的确定性整数 hash（院落坐标 + 房号 + 东西向）。
 * 禁止 Math.random / 共享 RNG，保证同一院落每次构建落位逐字节一致。
 */
function instVariant(x: number, z: number, k: number, sd: number): number {
  return Math.abs(Math.round(x * 0.13 + z * 0.07 + k * 17 + sd * 31)) % 997;
}

/** R22 起居落位台账：各房间函数回传，buildInstitutions 汇总，不依赖模块级共享状态 */
interface LivingLedger { rooms: number; items: number; }

// ============ 色板（与 buildings.ts 的 C 同源；本文件不反向依赖 buildings）============
const IC = {
  woodRed: 0xa63a2b, woodDark: 0x4a3220, wood: 0x6b4a2b,
  plaster: 0xe8e4da, plaster2: 0xd8cbaa, stone: 0x87847a,
  tile: 0x333a45, tile2: 0x3f4752, ridge: 0x272d36,
  winGlow: 0xffc66e, neonCyan: 0x00e5ff, neonGold: 0xffb300,
  wallGray: 0x5a6472, field: 0x5a6e3f, road: 0x8a7f6a, earth: 0x8f7f63,
  metal: 0xb8a06a, water: 0x2f5d70, lacquer: 0x9d2933,
} as const;

/** 台账 / 匾额 key 前缀：inst.<name>、inst.total 等均可 grep */
const KIT_PREFIX = 'inst.';

/** 院落之间最小净距（m）；坐标表实际间距均 > 900m */
export const INST_MIN_GAP_M = 40;
/** 允许的城内开阔带（|z|） */
export const INST_Z_BAND: readonly [number, number] = [400, 4200];
/** 与 parks.ts 网格对齐的格心步长（院落中心取半格，避开站点 ±7m 抖动） */
export const INST_GRID_STEP_X = 240;
export const INST_GRID_STEP_Z = 220;

// ============ 机构清单（显式整数坐标表）============
export type InstFeature =
  | 'archive'   // 大理寺：案牍库 + 戒石铭
  | 'marshal'   // 樞密院：军事旗鼓 + 甲仗库
  | 'ritual'    // 太常寺：编钟架 + 祭器库
  | 'censor'    // 御史臺：獬豸 + 狱舍
  | 'academy'   // 翰林院：藏书阁 + 碑亭
  | 'imperial'  // 國子監：辟雍泮池 + 讲堂
  | 'medical'   // 太醫院：药圃 + 药柜
  | 'astral'    // 欽天監：观星台 + 圭表
  | 'works'     // 將作監：工坊棚 + 木料堆 + 窑炉
  | 'treasury'  // 太府寺：府库 + 斗斛
  | 'camp';     // 军营（走 buildCamp，形制另成一套）

export interface InstitutionSite {
  key: string;        // inst.<key> 台账 / 匾额 key 后缀
  name: string;       // 仪门匾额文字（机构名，繁体）
  hallName: string;   // 正堂堂号匾（军营为空）
  x: number; z: number;   // 院落中心，显式整数
  size: number;       // 院落外廓边长（m），40–70
  feature: InstFeature;
  roofTone: number;   // 屋面明暗档，按机构拉开差异
}

/**
 * 12 座院落。x ≡ 120 (mod 240)、z ≡ 110 (mod 220)，即 parks.ts 网格「格心」；
 * 全部 |z| ≥ 550，避开汴河 / 街屋带 / 开封府 / 宫城；全部 |x| + size/2 < 4000。
 * 院落彼此间距 > 900m（≥ INST_MIN_GAP_M）。
 */
export const INSTITUTION_SITES: readonly InstitutionSite[] = [
  { key: 'dali',         name: '大理寺', hallName: '慎刑堂', x: -1080, z:   550, size: 52, feature: 'archive',   roofTone: 1.02 },
  { key: 'shumi',        name: '樞密院', hallName: '機要堂', x:  1080, z:   770, size: 66, feature: 'marshal',   roofTone: 0.86 },
  { key: 'taichang',     name: '太常寺', hallName: '禮樂堂', x: -2040, z:  1210, size: 54, feature: 'ritual',    roofTone: 1.10 },
  { key: 'yushitai',     name: '御史臺', hallName: '肅政堂', x:  2040, z:  1430, size: 56, feature: 'censor',    roofTone: 0.94 },
  { key: 'hanlin',       name: '翰林院', hallName: '摛文堂', x: -1560, z:  -770, size: 50, feature: 'academy',   roofTone: 1.06 },
  { key: 'guozijian',    name: '國子監', hallName: '彝倫堂', x:  3000, z:  2090, size: 68, feature: 'imperial',  roofTone: 1.14 },
  { key: 'taiyiyuan',    name: '太醫院', hallName: '濟世堂', x: -2760, z: -1210, size: 46, feature: 'medical',   roofTone: 1.00 },
  { key: 'qintianjian',  name: '欽天監', hallName: '觀象堂', x:  3720, z:  3190, size: 48, feature: 'astral',    roofTone: 0.90 },
  { key: 'jiangzuojian', name: '將作監', hallName: '營繕堂', x: -3480, z: -1870, size: 60, feature: 'works',     roofTone: 0.96 },
  { key: 'taifusi',      name: '太府寺', hallName: '邦計堂', x:  1560, z: -2090, size: 58, feature: 'treasury',  roofTone: 1.08 },
  { key: 'jinjun',       name: '禁軍營', hallName: '',      x:  3960, z:  1430, size: 68, feature: 'camp',      roofTone: 0.88 },
  { key: 'xiangjun',     name: '廂軍營', hallName: '',      x: -3960, z:  3410, size: 62, feature: 'camp',      roofTone: 0.92 },
];

export const INST_TOTAL = INSTITUTION_SITES.length;

// ============ 合批原语（只用 bake.ts 既有 BGroup）============

/** 四坡举折顶：递缩台 + 正脊 + 鸱吻。用 Baker 原语自建，避免依赖 buildings.ts 的 roofOn。 */
function hipRoof(b: Baker, x: number, y: number, z: number, w: number, d: number, tone: number): void {
  const c = shade(IC.tile, tone);
  b.box('roof', w * 1.10, 0.24, d * 1.10, x, y, z, shade(c, 0.82));
  b.box('roof', w * 0.88, 0.30, d * 0.88, x, y + 0.30, z, shade(c, 0.95));
  b.box('roof', w * 0.64, 0.32, d * 0.64, x, y + 0.62, z, c);
  b.box('roof', w * 0.34, 0.22, d * 0.34, x, y + 0.90, z, shade(c, 1.06));
  b.box('roof', w * 0.36, 0.26, 0.46, x, y + 1.06, z, IC.ridge);
  for (const s of [-1, 1]) {
    b.box('roof', 0.52, 0.86, 0.52, x + s * w * 0.18, y + 1.30, z, IC.ridge);
  }
  b.kit(KIT_PREFIX + 'roof', 7, y);
}

/** 直棂格窗（朝 +z）：木框 + 暖光窗心 + 竖棂 + 横枋 */
function latticeWindow(b: Baker, x: number, y: number, z: number, w: number, h: number): void {
  b.box('wood', w, h, 0.14, x, y, z, shade(IC.woodDark, 0.9));
  b.box('glow', w - 0.24, h - 0.24, 0.10, x, y, z + 0.10, IC.winGlow);
  for (let i = 1; i < 5; i++) {
    b.box('wood', 0.07, h - 0.20, 0.16, x - w / 2 + (i * w) / 5, y, z + 0.16, IC.woodDark);
  }
  b.box('wood', w, 0.09, 0.16, x, y, z + 0.16, IC.woodDark);
  b.kit(KIT_PREFIX + 'latticeWindow', 7, y);
}

/** 石狮（底座 + 身 + 首 + 前爪） */
function stoneLion(b: Baker, x: number, z: number): void {
  b.box('ash', 1.5, 0.5, 1.5, x, 0.25, z, IC.stone);
  b.cyl('ash', 0.44, 0.56, 1.2, 6, x, 1.10, z, shade(IC.stone, 1.06));
  b.sphere('ash', 0.46, 6, x, 1.95, z, shade(IC.stone, 1.10));
  for (const s of [-1, 1]) {
    b.box('ash', 0.18, 0.5, 0.34, x + s * 0.22, 0.85, z + 0.34, IC.stone);
  }
  b.kit(KIT_PREFIX + 'lion', 5, 1.0);
}

/** 旗杆（础石 + 杆 + 顶饰 + 旗面） */
function bannerPole(b: Baker, x: number, z: number, h: number, flagHex: number): void {
  b.box('ash', 1.1, 0.4, 1.1, x, 0.20, z, IC.stone);
  b.cyl('wood', 0.13, 0.18, h, 6, x, h / 2, z, IC.woodDark);
  b.box('metal', 0.36, 0.36, 0.36, x, h + 0.10, z, IC.metal);
  b.box('fabric', 2.0, 2.8, 0.07, x + 1.05, h - 1.8, z, flagHex);
  b.kit(KIT_PREFIX + 'pole', 4, h / 2);
}

/** 一段带瓦帽的院墙 */
function wallRun(b: Baker, g: BGroup, w: number, h: number, d: number, x: number, y: number, z: number, capW: number, capD: number): void {
  const c = shade(IC.wallGray, 1.04);
  b.box(g, w, h, d, x, y, z, c);
  b.box('roof', capW, 0.20, capD, x, y + h / 2 + 0.10, z, shade(IC.tile2, 1.02));
}

// ============ 官署院落各构件（南 = +z，北 = −z，与开封府同朝向）============

/** 照壁：院外南侧一字形影壁，带壁柱、瓦脊与兽面装饰 */
function screenWall(b: Baker, cx: number, cz: number, size: number): void {
  const w = size * 0.50, h = 3.4;
  b.box('wall', w, h, 0.8, cx, h / 2, cz, shade(IC.plaster2, 0.92));
  for (const s of [-1, 1]) {
    b.box('wood', 0.7, h + 0.6, 0.9, cx + s * (w / 2 - 0.2), (h + 0.6) / 2, cz, shade(IC.woodRed, 0.8));
  }
  b.box('roof', w + 1.2, 0.30, 1.5, cx, h + 0.35, cz, shade(IC.tile, 1.06));
  b.box('roof', w + 1.2, 0.20, 0.44, cx, h + 0.58, cz, IC.ridge);
  for (let i = -2; i <= 2; i++) {
    b.box('glow', 0.30, 0.30, 0.10, cx + i * (w / 6), h * 0.62, cz - 0.46, IC.neonGold);
  }
  b.kit(KIT_PREFIX + 'screenWall', 9, h / 2);
}

/** 仪门（三门制）：四柱三间、门额、瓦顶、朱漆门扇与门钉、机构名匾额 */
function ritualGate(b: Baker, sg: SignMesher, atlas: SignAtlas, s: InstitutionSite, gateHalf: number): void {
  const cx = s.x, z = s.z + s.size / 2;
  const posts = [-gateHalf, -gateHalf * 0.38, gateHalf * 0.38, gateHalf];
  for (const px of posts) {
    b.box('ash', 1.1, 0.4, 1.1, cx + px, 0.20, z, 0x8f8b7d);
    b.box('wood', 0.62, 4.6, 0.62, cx + px, 2.30, z, shade(IC.woodRed, 0.8));
  }
  // 两侧门墙
  for (const sd of [-1, 1]) {
    b.box('wall', gateHalf * 0.9, 3.4, 0.5, cx + sd * gateHalf * 1.35, 1.70, z, shade(IC.plaster, 0.94));
  }
  b.box('wood', gateHalf * 2 + 1.4, 0.42, 0.7, cx, 4.72, z, IC.woodDark);
  hipRoof(b, cx, 5.00, z, gateHalf * 2 + 2.0, 2.4, s.roofTone);
  // 中门 + 两侧门扇
  for (const [dx, dw] of [[0, 2.0], [-gateHalf * 0.72, 1.3], [gateHalf * 0.72, 1.3]] as const) {
    b.box('lacquer', dw, 3.6, 0.18, cx + dx, 1.80, z + 0.16, shade(IC.woodRed, 0.72));
    for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) {
      b.box('metal', 0.08, 0.08, 0.05, cx + dx - dw * 0.32 + c2 * dw * 0.32, 1.0 + r2 * 0.72, z + 0.28, shade(IC.neonGold, 0.6));
    }
  }
  // 机构名匾额（双面可读）
  sg.quad(atlas.text('instGate.' + s.key, s.name, 512, 144, {
    color: '#ffe9c8', bg: 'rgba(20,10,8,0.9)', border: 'rgba(255,179,0,0.8)', fontPx: 104,
  }), 4.6, 1.30, cx, 4.62, z + 0.42, 0);
  b.kit(KIT_PREFIX + 'ritualGate', 1, 2.3);
}

/** 正堂：台基 + 堂身 + 前檐柱 + 格窗 + 朱漆大门 + 举折顶 + 堂号匾（R22 接入起居资产） */
function mainHall(b: Baker, sg: SignMesher, atlas: SignAtlas, s: InstitutionSite): LivingLedger {
  const cx = s.x, h = s.size / 2, hz = s.z - h * 0.10;
  const hw = s.size * 0.46, hd = s.size * 0.24, hh = 5.0;
  b.box('ash', hw + 2.4, 0.7, hd + 2.0, cx, 0.35, hz, shade(IC.stone, 1.02));
  b.box('wall', hw, hh, hd, cx, 0.7 + hh / 2, hz, shade(IC.plaster, 0.96));
  for (const dx of [-hw * 0.42, -hw * 0.14, hw * 0.14, hw * 0.42]) {
    b.box('wood', 0.42, hh, 0.42, cx + dx, 0.7 + hh / 2, hz + hd / 2 + 0.25, shade(IC.woodRed, 0.85));
  }
  for (const dx of [-hw * 0.30, hw * 0.30]) {
    latticeWindow(b, cx + dx, 0.7 + hh * 0.55, hz + hd / 2 + 0.10, hw * 0.22, hh * 0.34);
  }
  const dw = hw * 0.22;
  b.box('lacquer', dw, hh * 0.62, 0.18, cx, 0.7 + hh * 0.31, hz + hd / 2 + 0.16, shade(IC.woodRed, 0.74));
  for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) {
    b.box('metal', 0.09, 0.09, 0.05, cx - dw * 0.32 + c2 * dw * 0.32, 1.05 + r2 * 0.72, hz + hd / 2 + 0.28, shade(IC.neonGold, 0.6));
  }
  hipRoof(b, cx, 0.7 + hh, hz, hw, hd, s.roofTone);
  sg.quad(atlas.text('instHall.' + s.key, s.hallName, 384, 108, {
    color: '#ffe9c8', bg: 'rgba(20,10,8,0.86)', border: 'rgba(255,179,0,0.7)', fontPx: 76,
  }), 3.4, 0.96, cx, 0.7 + hh - 0.55, hz + hd / 2 + 0.36, 0);
  // R22：实心墙盒内落起居资产，揭顶剖视可见；variant 走坐标 hash，零 RNG。
  const living = buildRoomLiving(b, {
    cx, cz: hz, w: hw * 0.82, d: hd * 0.8, y0: 0.7, h: hh,
    ux: 1, uz: 0, vx: 0, vz: 1,
    variant: instVariant(s.x, s.z, 0, 0), tier: 'high',
  });
  b.kit(KIT_PREFIX + 'mainHall', 1, 3.0);
  return { rooms: 1, items: living.count };
}

/** 两庑六房：东西各 3 间，朝院一面开直棂窗（R22 每间接入起居资产） */
function sideRooms(b: Baker, s: InstitutionSite): LivingLedger {
  const cx = s.x, cz = s.z, h = s.size / 2;
  const rw = s.size * 0.13, rd = s.size * 0.145, rh = 3.3;
  let rooms = 0, items = 0;
  for (const sd of [-1, 1]) {
    const wx = cx + sd * h * 0.66;
    for (let k = 0; k < 3; k++) {
      const wz = cz + h * (0.62 - k * 0.38);
      b.box('wall', rw, rh, rd, wx, rh / 2, wz, shade(IC.plaster, 0.92));
      hipRoof(b, wx, rh, wz, rw, rd, s.roofTone);
      // 朝院内的一侧（−sd 方向）贴门框 + 暖光窗心
      const faceX = wx - sd * (rw / 2 + 0.09);
      b.box('wood', 0.14, 2.1, rd * 0.62, faceX, 1.15, wz, IC.woodDark);
      b.box('glow', 0.08, 1.7, rd * 0.50, faceX - sd * 0.06, 1.15, wz, IC.winGlow);
      for (let m = -1; m <= 1; m++) {
        b.box('wood', 0.10, 1.7, 0.08, faceX - sd * 0.10, 1.15, wz + m * rd * 0.18, IC.woodDark);
      }
      const living = buildRoomLiving(b, {
        cx: wx, cz: wz, w: rw * 0.8, d: rd * 0.8, y0: 0, h: rh,
        ux: 1, uz: 0, vx: 0, vz: 1,
        variant: instVariant(s.x, s.z, k, sd), tier: 'mid',
      });
      rooms++; items += living.count;
      b.kit(KIT_PREFIX + 'sixRooms', 1, 1.7);
    }
  }
  return { rooms, items };
}

/** 后堂：内院北端，体量略小于正堂（R22 接入起居资产） */
function backHall(b: Baker, s: InstitutionSite): LivingLedger {
  const cx = s.x, h = s.size / 2, bz = s.z - h * 0.66;
  const bw = s.size * 0.34, bd = s.size * 0.17, bh = 4.0;
  b.box('ash', bw + 1.6, 0.5, bd + 1.4, cx, 0.25, bz, IC.stone);
  b.box('wall', bw, bh, bd, cx, 0.5 + bh / 2, bz, shade(IC.plaster2, 0.90));
  for (const dx of [-bw * 0.30, bw * 0.30]) {
    b.box('wood', bw * 0.22, bh * 0.34, 0.14, cx + dx, 0.5 + bh * 0.56, bz + bd / 2 + 0.10, IC.woodDark);
    b.box('glow', bw * 0.22 - 0.2, bh * 0.34 - 0.2, 0.10, cx + dx, 0.5 + bh * 0.56, bz + bd / 2 + 0.18, IC.winGlow);
  }
  hipRoof(b, cx, 0.5 + bh, bz, bw, bd, s.roofTone);
  const living = buildRoomLiving(b, {
    cx, cz: bz, w: bw * 0.8, d: bd * 0.8, y0: 0.5, h: bh,
    ux: 1, uz: 0, vx: 0, vz: 1,
    variant: instVariant(s.x, s.z, 3, 0), tier: 'high',
  });
  b.kit(KIT_PREFIX + 'backHall', 1, 2.2);
  return { rooms: 1, items: living.count };
}

/** 院墙：东西墙 + 北墙 + 南墙（仪门两侧各一段）+ 瓦帽 */
function courtWall(b: Baker, s: InstitutionSite, gateHalf: number): void {
  const cx = s.x, cz = s.z, h = s.size / 2, wh = 3.0, wt = 0.7;
  for (const sd of [-1, 1]) {
    wallRun(b, 'wall', wt, wh, 2 * h, cx + sd * h, wh / 2, cz, wt + 0.5, 2 * h + 0.4);
  }
  wallRun(b, 'wall', 2 * h, wh, wt, cx, wh / 2, cz - h, 2 * h + 0.4, wt + 0.5);
  const seg = h - gateHalf;
  for (const sd of [-1, 1]) {
    wallRun(b, 'wall', seg, wh, wt, cx + sd * (gateHalf + seg / 2), wh / 2, cz + h, seg + 0.4, wt + 0.5);
  }
  b.kit(KIT_PREFIX + 'courtWall', 8, wh / 2);
}

// ============ 按机构职能的特色件 ============
function addFeature(b: Baker, sg: SignMesher, atlas: SignAtlas, s: InstitutionSite): void {
  const cx = s.x, cz = s.z, h = s.size / 2;
  const fx = cx + h * 0.32, fz = cz + h * 0.45;      // 前院东侧空地
  const gx = cx - h * 0.32, gz = cz + h * 0.45;      // 前院西侧空地
  const rx = cx + h * 0.58, rz = cz - h * 0.70;      // 后院东侧空地

  switch (s.feature) {
    case 'archive': {   // 大理寺：案牍库（四排高架）+ 戒石铭
      for (let i = 0; i < 4; i++) {
        const z = rz + i * 1.7;
        b.box('wood', 5.2, 2.6, 0.9, rx, 1.30, z, shade(IC.wood, 0.9));
        for (let k = 0; k < 3; k++) {
          b.box('wood', 5.0, 0.10, 0.7, rx, 0.6 + k * 0.8, z + 0.5, IC.woodDark);
        }
      }
      b.box('ash', 1.0, 2.4, 0.5, gx, 1.20, gz, IC.stone);
      sg.quad(atlas.text('instStele.' + s.key, '爾俸爾祿', 256, 384, {
        color: '#f0e2be', bg: 'rgba(30,26,20,0.9)', vertical: true, fontPx: 56,
      }), 0.85, 1.90, gx, 1.60, gz + 0.30, 0);
      b.kit(KIT_PREFIX + 'archive', 16, 1.3);
      break;
    }
    case 'marshal': {   // 樞密院：军事旗鼓 + 甲仗库
      b.box('ash', 3.4, 0.5, 3.4, gx, 0.25, gz, IC.stone);
      for (const sd of [-1, 1]) b.box('wood', 0.28, 2.6, 0.28, gx + sd * 1.2, 1.55, gz, IC.woodDark);
      b.box('wood', 3.0, 0.22, 0.30, gx, 2.85, gz, IC.wood);
      b.cyl('metal', 1.05, 1.05, 0.9, 10, gx, 1.85, gz, IC.metal, 0, Math.PI / 2, 0);
      for (let i = 0; i < 2; i++) b.box('fabric', 0.10, 1.2, 0.10, gx + (i ? 0.5 : -0.5), 1.85, gz + 0.6, IC.lacquer);
      bannerPole(b, gx - 3.2, gz, 12.0, IC.lacquer);
      for (let i = 0; i < 5; i++) {   // 甲仗库：一排甲胄柜 + 枪架
        b.box('wood', 1.5, 2.2, 1.0, rx - 3.0 + i * 1.6, 1.10, rz, shade(IC.woodDark, 1.05));
        b.box('metal', 1.3, 0.16, 0.10, rx - 3.0 + i * 1.6, 1.90, rz + 0.55, IC.metal);
        b.cyl('wood', 0.05, 0.07, 3.2, 5, rx - 3.0 + i * 1.6, 3.6, rz - 1.4, IC.wood, 0, 0, 0.18);
      }
      b.kit(KIT_PREFIX + 'marshal', 24, 2.0);
      break;
    }
    case 'ritual': {    // 太常寺：编钟架 + 祭器库
      for (const sd of [-1, 1]) b.box('wood', 0.30, 3.2, 0.30, fx + sd * 2.6, 1.60, fz, IC.woodDark);
      b.box('wood', 5.8, 0.28, 0.42, fx, 3.20, fz, shade(IC.woodRed, 0.85));
      b.box('wood', 5.8, 0.20, 0.34, fx, 2.10, fz, IC.woodDark);
      for (let i = 0; i < 6; i++) {
        b.cyl('metal', 0.30, 0.42, 0.72, 8, fx - 2.2 + i * 0.88, 2.62, fz, shade(IC.metal, 1.05));
      }
      for (let i = 0; i < 4; i++) {   // 祭器库：陶罐阵列
        b.cyl('ceramic', 0.42, 0.50, 1.1, 8, rx - 2.4 + i * 1.6, 0.55, rz, shade(IC.plaster2, 0.82));
      }
      b.kit(KIT_PREFIX + 'ritual', 16, 1.8);
      break;
    }
    case 'censor': {    // 御史臺：獬豸石雕 + 狱舍
      b.box('ash', 2.6, 0.5, 1.6, gx, 0.25, gz, IC.stone);
      b.box('ash', 1.7, 1.1, 0.9, gx, 1.05, gz, shade(IC.stone, 1.05));      // 身
      b.box('ash', 0.8, 0.8, 0.8, gx, 1.85, gz + 0.55, shade(IC.stone, 1.1)); // 首
      b.cyl('ash', 0.09, 0.16, 1.0, 5, gx, 2.70, gz + 0.55, IC.stone);       // 独角
      for (const sd of [-1, 1]) {
        b.box('ash', 0.22, 0.9, 0.22, gx + sd * 0.6, 0.70, gz + 0.4, IC.stone);
      }
      for (let i = 0; i < 3; i++) {   // 狱舍三间，带铁栅窗
        const z = rz + i * 3.2;
        b.box('wall', 4.4, 2.6, 3.0, rx, 1.30, z, shade(IC.wallGray, 0.88));
        b.box('roof', 5.0, 0.35, 3.6, rx, 2.78, z, shade(IC.tile, 0.92));
        for (let m = -1; m <= 1; m++) {
          b.box('metal', 0.09, 1.1, 0.10, rx - 2.25, 1.55, z + m * 0.5, IC.metal);
        }
        b.box('metal', 0.10, 0.10, 1.6, rx - 2.25, 1.55, z, IC.metal);
      }
      b.kit(KIT_PREFIX + 'censor', 22, 1.6);
      break;
    }
    case 'academy': {   // 翰林院：藏书阁（两层）+ 碑亭
      b.box('ash', 7.0, 0.6, 6.0, rx, 0.30, rz, IC.stone);
      b.box('wall', 6.2, 4.0, 5.2, rx, 2.60, rz, shade(IC.plaster, 0.94));
      b.box('roof', 7.2, 0.30, 6.2, rx, 4.75, rz, shade(IC.tile2, 1.04));
      b.box('wall', 5.2, 3.2, 4.4, rx, 6.50, rz, shade(IC.plaster2, 0.92));
      for (const sd of [-1, 1]) {
        b.box('wood', 2.0, 1.4, 0.14, rx + sd * 1.4, 6.5, rz + 2.25, IC.woodDark);
        b.box('glow', 1.8, 1.2, 0.10, rx + sd * 1.4, 6.5, rz + 2.33, IC.winGlow);
      }
      hipRoof(b, rx, 8.10, rz, 5.2, 4.4, s.roofTone);
      // 碑亭：四柱 + 攒尖小顶 + 石碑
      for (const dx of [-1.4, 1.4]) for (const dz of [-1.4, 1.4]) {
        b.box('wood', 0.28, 3.2, 0.28, fx + dx, 1.60, fz + dz, shade(IC.woodRed, 0.82));
      }
      b.cyl('roof', 0, 2.6, 1.6, 6, fx, 4.00, fz, shade(IC.tile, 1.06));
      b.box('ash', 0.9, 2.2, 0.4, fx, 1.10, fz, IC.stone);
      b.kit(KIT_PREFIX + 'academy', 16, 3.0);
      break;
    }
    case 'imperial': {  // 國子監：辟雍泮池（圆池 + 石栏 + 四桥）+ 讲堂
      const R = 5.0;
      b.cyl('ceramic', R, R, 0.35, 16, fx, 0.18, fz, shade(IC.water, 1.05));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.box('ash', 0.7, 0.7, 0.7, fx + Math.cos(a) * (R + 0.5), 0.35, fz + Math.sin(a) * (R + 0.5), IC.stone);
      }
      for (const sd of [-1, 1]) {
        b.box('ash', 2.2, 0.20, 1.4, fx + sd * (R + 0.9), 0.30, fz, IC.stone);
        b.box('ash', 1.4, 0.20, 2.2, fx, 0.30, fz + sd * (R + 0.9), IC.stone);
      }
      b.cyl('ash', 1.1, 1.1, 0.9, 8, fx, 0.75, fz, IC.stone);   // 辟雍台心
      sg.quad(atlas.text('instBiyong.' + s.key, '辟雍', 256, 128, {
        color: '#ffe9c8', bg: 'rgba(20,10,8,0.86)', border: 'rgba(255,179,0,0.7)', fontPx: 88,
      }), 2.2, 1.10, fx, 2.20, fz + 1.25, 0);
      // 讲堂：比正堂更宽的一间（后院西侧）
      const lw = s.size * 0.40, ld = s.size * 0.16;
      b.box('ash', lw + 1.6, 0.5, ld + 1.2, gx, 0.25, rz, IC.stone);
      b.box('wall', lw, 4.4, ld, gx, 2.70, rz, shade(IC.plaster, 0.95));
      for (const dx of [-lw * 0.3, 0, lw * 0.3]) {
        b.box('wood', lw * 0.20, 1.8, 0.14, gx + dx, 2.7, rz + ld / 2 + 0.10, IC.woodDark);
        b.box('glow', lw * 0.20 - 0.2, 1.6, 0.10, gx + dx, 2.7, rz + ld / 2 + 0.18, IC.winGlow);
      }
      hipRoof(b, gx, 4.90, rz, lw, ld, s.roofTone);
      b.kit(KIT_PREFIX + 'imperial', 26, 1.5);
      break;
    }
    case 'medical': {   // 太醫院：药圃（畦 + 药株）+ 百子药柜
      b.box('earth', 10.0, 0.18, 8.0, fx, 0.09, fz, shade(IC.earth, 0.92));
      for (let i = 0; i < 4; i++) {
        b.box('ground', 9.2, 0.12, 0.35, fx, 0.20, fz - 3.0 + i * 2.0, shade(IC.field, 1.02));
        for (let j = 0; j < 4; j++) {
          b.sphere('leaf', 0.42, 6, fx - 3.4 + j * 2.3, 0.55, fz - 3.0 + i * 2.0, shade(IC.field, 1.10));
        }
      }
      b.box('wood', 5.0, 2.8, 1.0, rx, 1.40, rz, shade(IC.wood, 0.92));   // 百子柜
      for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < 5; c2++) {
        b.box('wood', 0.86, 0.56, 0.08, rx - 1.9 + c2 * 0.95, 0.55 + r2 * 0.62, rz + 0.54, shade(IC.woodDark, 1.05));
        b.box('metal', 0.14, 0.10, 0.06, rx - 1.9 + c2 * 0.95, 0.55 + r2 * 0.62, rz + 0.60, IC.metal);
      }
      b.kit(KIT_PREFIX + 'medical', 44, 1.0);
      break;
    }
    case 'astral': {    // 欽天監：观星台（三层递缩高台 + 浑仪）+ 圭表
      for (let t = 0; t < 3; t++) {
        const w = 9.0 - t * 2.2;
        b.box('ash', w, 2.4, w, gx, 1.2 + t * 2.4, gz, shade(IC.stone, 1.02 - t * 0.06));
      }
      for (let t = 0; t < 5; t++) {   // 登台踏道
        b.box('ash', 1.6, 0.4, 1.2, gx + 5.2, 0.6 + t * 1.5, gz, IC.stone);
      }
      b.cyl('metal', 1.5, 1.5, 0.14, 12, gx, 7.9, gz, IC.metal, 0, Math.PI / 2, 0);  // 浑仪环
      b.cyl('metal', 1.1, 1.1, 0.12, 12, gx, 7.9, gz, shade(IC.metal, 0.9), 0, 0, Math.PI / 2);
      b.box('ash', 0.8, 3.6, 0.8, fx, 1.8, fz, IC.stone);      // 圭表
      b.box('ash', 0.5, 0.3, 7.0, fx, 0.15, fz + 3.6, IC.stone);
      sg.quad(atlas.text('instStar.' + s.key, '觀星臺', 256, 128, {
        color: '#ffe9c8', bg: 'rgba(20,10,8,0.86)', border: 'rgba(255,179,0,0.7)', fontPx: 76,
      }), 2.4, 1.10, gx, 5.4, gz + 2.4, 0);
      b.kit(KIT_PREFIX + 'astral', 16, 4.0);
      break;
    }
    case 'works': {     // 將作監：工坊棚 + 木料堆 + 窑炉
      for (const dx of [-4.0, 0, 4.0]) for (const dz of [-2.2, 2.2]) {
        b.box('wood', 0.34, 3.6, 0.34, rx + dx, 1.80, rz + dz, IC.woodDark);
      }
      b.box('roof', 10.0, 0.30, 6.0, rx, 3.75, rz, shade(IC.tile2, 0.94));
      for (let i = 0; i < 5; i++) {   // 木料堆：横放圆木
        b.cyl('wood', 0.34, 0.34, 5.0, 6, fx, 0.4 + Math.floor(i / 3) * 0.7, fz - 2.0 + (i % 3) * 0.8, IC.wood, 0, Math.PI / 2, 0);
      }
      b.box('ash', 3.0, 2.4, 3.0, gx, 1.20, gz, shade(IC.stone, 0.86));   // 窑炉
      b.box('glow', 1.2, 0.9, 0.10, gx, 0.85, gz + 1.55, IC.neonGold);
      b.box('ash', 0.9, 1.6, 0.9, gx, 3.20, gz, shade(IC.stone, 0.8));
      b.kit(KIT_PREFIX + 'works', 16, 1.8);
      break;
    }
    case 'treasury': {  // 太府寺：厚重府库 + 斗斛 / 秤
      const tw = s.size * 0.32, td = s.size * 0.16;
      b.box('ash', tw + 1.6, 0.6, td + 1.2, rx, 0.30, rz, IC.stone);
      b.box('wall', tw, 4.6, td, rx, 2.90, rz, shade(IC.wallGray, 1.02));
      for (const dx of [-tw * 0.30, tw * 0.30]) {
        b.box('metal', 0.9, 0.9, 0.14, rx + dx, 3.4, rz + td / 2 + 0.10, IC.metal);
      }
      hipRoof(b, rx, 5.20, rz, tw, td, s.roofTone);
      b.box('ash', 2.6, 1.0, 2.6, fx, 0.50, fz, IC.stone);      // 斗斛石台
      b.cyl('metal', 0.8, 0.95, 1.1, 8, fx, 1.55, fz, IC.metal);
      b.box('wood', 0.12, 0.12, 4.6, fx + 2.0, 2.2, fz, IC.woodDark);  // 秤杆
      b.cyl('metal', 0.28, 0.28, 0.5, 8, fx + 2.0, 1.9, fz - 2.0, IC.metal);
      b.kit(KIT_PREFIX + 'treasury', 14, 2.0);
      break;
    }
    default:
      break;   // 'camp' 在 buildInstitutions 里分流到 buildCamp，不进这里
  }
}

/** 一座官署院落：仪门 + 照壁 + 石狮旗杆 + 甬道 + 正堂 + 两庑六房 + 后堂 + 院墙 + 特色件 */
function buildCourt(b: Baker, sg: SignMesher, atlas: SignAtlas, s: InstitutionSite): LivingLedger {
  const cx = s.x, cz = s.z, h = s.size / 2;
  const gateHalf = h * 0.30;
  // 衙前广场：照壁 → 仪门 → 石狮 / 旗杆 / 甬道
  screenWall(b, cx, cz + h + 4.5, s.size);
  ritualGate(b, sg, atlas, s, gateHalf);
  for (const sd of [-1, 1]) {
    stoneLion(b, cx + sd * (gateHalf + 1.2), cz + h + 2.6);
    bannerPole(b, cx + sd * (h * 0.72), cz + h + 2.0, 9.0, IC.lacquer);
  }
  b.box('ground', 3.0, 0.12, h * 1.55, cx, 0.06, cz + h * 0.10, 0x9a9282);
  // 院内建筑（R22 各间已落起居资产，返回台账供汇总）
  const lh = mainHall(b, sg, atlas, s);
  const ls = sideRooms(b, s);
  const lb = backHall(b, s);
  courtWall(b, s, gateHalf);
  addFeature(b, sg, atlas, s);
  return {
    rooms: lh.rooms + ls.rooms + lb.rooms,
    items: lh.items + ls.items + lb.items,
  };
}

// ============ 军营（营房连排 / 校场 / 点将台 / 旗杆 / 兵器架 / 营门）============
function buildCamp(b: Baker, sg: SignMesher, atlas: SignAtlas, s: InstitutionSite): LivingLedger {
  const cx = s.x, cz = s.z, h = s.size / 2;

  // ① 营墙：四边木栅栏（等距立柱 + 两道横枋），南面留营门
  const fenceH = 2.8, N = 9;
  for (const sd of [-1, 1]) {
    for (let i = 0; i <= N; i++) {
      const t = -h + (2 * h * i) / N;
      b.box('wood', 0.24, fenceH, 0.24, cx + sd * h, fenceH / 2, cz + t, IC.woodDark);
    }
    for (const yy of [1.0, 2.2]) {
      b.box('wood', 0.16, 0.16, 2 * h, cx + sd * h, yy, cz, shade(IC.wood, 0.9));
    }
  }
  for (let i = 0; i <= N; i++) {
    const t = -h + (2 * h * i) / N;
    b.box('wood', 0.24, fenceH, 0.24, cx + t, fenceH / 2, cz - h, IC.woodDark);
  }
  for (const yy of [1.0, 2.2]) {
    b.box('wood', 2 * h, 0.16, 0.16, cx, yy, cz - h, shade(IC.wood, 0.9));
    for (const sd of [-1, 1]) {
      b.box('wood', h * 0.62, 0.16, 0.16, cx + sd * h * 0.69, yy, cz + h, shade(IC.wood, 0.9));
    }
  }
  b.kit(KIT_PREFIX + 'campFence', 4 * (N + 1) + 6, fenceH / 2);

  // ② 营门：双柱 + 额枋 + 瓦顶 + 门扇 + 机构名匾
  const gz = cz + h, gw = 3.2;
  for (const sd of [-1, 1]) {
    b.box('ash', 1.0, 0.4, 1.0, cx + sd * gw, 0.20, gz, 0x8f8b7d);
    b.box('wood', 0.56, 4.4, 0.56, cx + sd * gw, 2.20, gz, shade(IC.woodRed, 0.84));
  }
  b.box('wood', gw * 2 + 1.0, 0.40, 0.6, cx, 4.50, gz, IC.woodDark);
  hipRoof(b, cx, 4.80, gz, gw * 2 + 1.6, 2.2, s.roofTone);
  for (const sd of [-1, 1]) {
    b.box('lacquer', gw * 0.9, 3.4, 0.16, cx + sd * gw * 0.5, 1.70, gz + 0.14, shade(IC.woodRed, 0.72));
  }
  sg.quad(atlas.text('instGate.' + s.key, s.name, 512, 144, {
    color: '#ffe9c8', bg: 'rgba(20,10,8,0.9)', border: 'rgba(255,179,0,0.8)', fontPx: 104,
  }), 4.6, 1.30, cx, 4.40, gz + 0.40, 0);
  b.kit(KIT_PREFIX + 'campGate', 1, 2.2);

  // ③ 营房连排：北排 5 间 + 东排 5 间，每间门 + 窗 + 坡顶（R22 每间落起居资产）
  const rw = s.size * 0.15, rd = s.size * 0.13, rh = 3.0;
  let rooms = 0, items = 0;
  for (let i = 0; i < 5; i++) {
    const bx = cx - h * 0.68 + i * (rw + 0.5);
    const bz = cz - h * 0.72;
    const lv = campRoom(b, bx, bz, rw, rd, rh, s.roofTone, 0, instVariant(s.x, s.z, i, 0));
    rooms += lv.rooms; items += lv.items;
  }
  for (let i = 0; i < 5; i++) {
    const bx = cx + h * 0.74;
    const bz = cz - h * 0.52 + i * (rd + 0.5);
    const lv = campRoom(b, bx, bz, rw, rd, rh, s.roofTone, 1, instVariant(s.x, s.z, i, 1));
    rooms += lv.rooms; items += lv.items;
  }

  // ④ 校场：中央平整地坪
  b.box('ground', s.size * 0.50, 0.10, s.size * 0.44, cx, 0.05, cz + h * 0.12, shade(IC.road, 0.92));
  for (let i = -2; i <= 2; i++) {
    b.box('ground', s.size * 0.46, 0.06, 0.20, cx, 0.11, cz + h * 0.12 + i * s.size * 0.08, shade(IC.road, 0.80));
  }

  // ⑤ 点将台：三层递缩台基 + 帐棚（圆锥）+ 帅旗
  const px = cx - h * 0.10, pz = cz - h * 0.10;
  for (let t = 0; t < 3; t++) {
    const w = 9.0 - t * 2.0;
    b.box('ash', w, 0.7, w, px, 0.35 + t * 0.7, pz, shade(IC.stone, 1.04 - t * 0.05));
  }
  b.cyl('fabric', 0, 3.0, 3.2, 8, px, 3.7, pz, shade(IC.lacquer, 0.92));
  bannerPole(b, px + 5.2, pz, 11.0, IC.lacquer);
  b.kit(KIT_PREFIX + 'campPlatform', 5, 2.0);

  // ⑥ 兵器架：木架 + 斜插枪杆 + 立盾
  const wx = cx + h * 0.34, wz = cz - h * 0.05;
  for (const sd of [-1, 1]) b.box('wood', 0.24, 2.2, 0.24, wx + sd * 2.6, 1.10, wz, IC.woodDark);
  b.box('wood', 5.6, 0.20, 0.28, wx, 2.10, wz, IC.wood);
  for (let i = 0; i < 6; i++) {
    b.cyl('wood', 0.05, 0.07, 3.4, 5, wx - 2.2 + i * 0.88, 2.5, wz - 0.4, IC.wood, 0, 0, 0.22);
    b.cyl('metal', 0.62, 0.62, 0.14, 8, wx - 2.2 + i * 0.88, 0.8, wz + 0.7, shade(IC.metal, 0.9), 0, Math.PI / 2, 0);
  }
  b.kit(KIT_PREFIX + 'campArmory', 15, 1.2);

  // ⑦ 营门两侧旗杆
  bannerPole(b, cx - gw - 3.0, gz + 1.5, 9.5, IC.lacquer);
  bannerPole(b, cx + gw + 3.0, gz + 1.5, 9.5, IC.lacquer);
  return { rooms, items };
}

/** 单间营房；rot=1 时进深/面阔互换，用于东侧一排（R22 接入起居资产，tier=low） */
function campRoom(b: Baker, x: number, z: number, w: number, d: number, h: number, tone: number, rot: number, variant: number): LivingLedger {
  const rw = rot ? d : w, rd = rot ? w : d;
  b.box('wall', rw, h, rd, x, h / 2, z, shade(IC.plaster2, 0.88));
  hipRoof(b, x, h, z, rw, rd, tone);
  b.box('wood', 1.2, 2.0, 0.14, x, 1.0, z + rd / 2 + 0.08, IC.woodDark);
  b.box('glow', 0.9, 1.1, 0.10, x, 2.0, z + rd / 2 + 0.14, IC.winGlow);
  const living = buildRoomLiving(b, {
    cx: x, cz: z, w: rw * 0.8, d: rd * 0.8, y0: 0, h,
    ux: 1, uz: 0, vx: 0, vz: 1,
    variant, tier: 'low',
  });
  b.kit(KIT_PREFIX + 'campRoom', 1, 1.5);
  return { rooms: 1, items: living.count };
}

// ============ R22 露天庭院陈设（正常视角可见的「过日子」器物）============
/**
 * 每座院落露天补生活陈设：花坛 / 树阵 / 鱼缸 / 水缸 / 石桌凳 / 廊下几案 /
 * 衣架 / 灯笼杆 / 竹帘架，再按 s.feature 补职能小件，军营另补营房器物。
 * 坐标全部由 s.x / s.z / s.size 与固定整数序列派生，零 RNG；只走既有 BGroup 与
 * b.box / b.cyl / b.sphere 合批，不新增材质组 / draw call。返回本座院落的器物
 * 件数与草木株数，供 buildInstitutions 登记 inst.courtLife.* 台账。
 */
function buildCourtLife(b: Baker, s: InstitutionSite): { items: number; plants: number } {
  const cx = s.x, cz = s.z, H = s.size;
  let items = 0, plants = 0;
  // 计数包装：每片合批原语 = 1 件器物
  const box = (g: BGroup, w: number, ht: number, d: number, x: number, y: number, z: number, hex: number): void => {
    b.box(g, w, ht, d, x, y, z, hex); items++;
  };
  const cyl = (g: BGroup, rt: number, rb: number, ht: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void => {
    b.cyl(g, rt, rb, ht, seg, x, y, z, hex, ry, rx, rz); items++;
  };
  const sph = (g: BGroup, r: number, seg: number, x: number, y: number, z: number, hex: number): void => {
    b.sphere(g, r, seg, x, y, z, hex); items++;
  };
  // 一株草木：干 + 主冠 + 侧冠；每次调用记 1 株
  const tree = (x: number, z: number, seed: number): void => {
    const q = Math.abs(seed);
    const th = 1.5 + (q % 3) * 0.35;
    cyl('trunk', 0.16, 0.22, th, 6, x, th / 2, z, IC.woodDark);
    sph('leaf', 0.85 + (q % 2) * 0.2, 7, x, th + 0.5, z, shade(IC.field, 1.06));
    sph('leaf', 0.55, 6, x + 0.45, th + 0.2, z, shade(IC.field, 0.94));
    plants++;
  };
  // 固定锚点（相对 H 的比例），全部落在院内露天空地：前院 / 东西墙内侧 / 后院
  const ANCHORS: readonly [number, number][] = [
    [-0.20, 0.34], [0.20, 0.34], [-0.20, 0.20], [0.20, 0.20],
    [-0.44, 0.10], [0.44, 0.10], [-0.44, -0.10], [0.44, -0.10],
    [-0.24, -0.22], [0.24, -0.22], [-0.24, -0.44], [0.24, -0.44],
  ];
  // 通用器物：9 类轮转，覆盖花坛 / 鱼缸 / 水缸 / 石桌凳 / 廊下几案 / 衣架 / 灯笼杆 / 竹帘架
  for (let i = 0; i < ANCHORS.length; i++) {
    const x = cx + ANCHORS[i][0] * H, z = cz + ANCHORS[i][1] * H;
    switch (i % 9) {
      case 0: case 8: {   // 花坛：石框 + 土 + 三簇花
        box('ash', 2.4, 0.5, 2.4, x, 0.25, z, IC.stone);
        box('earth', 2.1, 0.12, 2.1, x, 0.56, z, shade(IC.earth, 0.92));
        for (let j = 0; j < 3; j++) sph('leaf', 0.34, 6, x - 0.7 + j * 0.7, 0.85, z - 0.4 + (j % 2) * 0.8, shade(IC.field, 1.1));
        break;
      }
      case 1: {           // 水缸
        cyl('ceramic', 0.7, 0.6, 1.1, 10, x, 0.55, z, shade(IC.plaster2, 0.82));
        cyl('water', 0.62, 0.62, 0.06, 10, x, 1.08, z, IC.water);
        break;
      }
      case 2: {           // 石桌凳：一桌四凳
        cyl('ash', 0.9, 0.9, 0.16, 10, x, 0.85, z, IC.stone);
        cyl('ash', 0.16, 0.2, 0.75, 6, x, 0.42, z, IC.stone);
        for (let j = 0; j < 4; j++) {
          const a = (j / 4) * Math.PI * 2;
          cyl('ash', 0.3, 0.3, 0.45, 8, x + Math.cos(a) * 1.3, 0.23, z + Math.sin(a) * 1.3, shade(IC.stone, 1.04));
        }
        break;
      }
      case 3: {           // 衣架：双柱 + 横枋 + 搭巾
        for (const sd of [-1, 1]) box('wood', 0.12, 1.9, 0.12, x + sd * 0.9, 0.95, z, IC.woodDark);
        box('wood', 2.1, 0.10, 0.14, x, 1.9, z, IC.wood);
        box('fabric', 0.9, 1.0, 0.04, x + 0.3, 1.3, z, shade(IC.plaster, 0.9));
        break;
      }
      case 4: {           // 灯笼杆：杆 + 暖光灯笼
        cyl('wood', 0.10, 0.12, 3.0, 6, x, 1.5, z, IC.woodDark);
        box('glow', 0.5, 0.6, 0.5, x, 2.8, z, IC.winGlow);
        box('lacquer', 0.6, 0.10, 0.6, x, 3.15, z, IC.lacquer);
        break;
      }
      case 5: {           // 廊下几案：案面 + 两腿 + 案上瓶
        box('wood', 1.8, 0.12, 0.7, x, 0.8, z, IC.wood);
        for (const sd of [-1, 1]) box('wood', 0.12, 0.78, 0.6, x + sd * 0.8, 0.4, z, IC.woodDark);
        cyl('ceramic', 0.18, 0.22, 0.4, 8, x, 1.06, z, shade(IC.plaster2, 0.9));
        break;
      }
      case 6: {           // 鱼缸：缸 + 水面 + 几架
        box('wood', 1.1, 0.5, 1.1, x, 0.25, z, IC.woodDark);
        cyl('ceramic', 0.5, 0.55, 0.7, 10, x, 0.85, z, shade(IC.plaster2, 0.86));
        cyl('water', 0.46, 0.46, 0.05, 10, x, 1.18, z, IC.water);
        break;
      }
      case 7: {           // 竹帘架：双柱 + 横杆 + 垂帘
        for (const sd of [-1, 1]) box('wood', 0.12, 2.4, 0.12, x + sd * 1.0, 1.2, z, IC.wood);
        box('wood', 2.2, 0.10, 0.14, x, 2.4, z, IC.woodDark);
        box('fabric', 1.8, 1.6, 0.04, x, 1.5, z, shade(IC.earth, 0.96));
        break;
      }
    }
  }
  // 树阵：10 株，固定坐标沿院墙内侧与前院角，全部露天
  const TREES: readonly [number, number][] = [
    [-0.46, 0.42], [0.46, 0.42], [-0.46, 0.24], [0.46, 0.24],
    [-0.46, -0.30], [0.46, -0.30], [-0.46, -0.46], [0.46, -0.46],
    [-0.10, 0.44], [0.10, 0.44],
  ];
  for (let i = 0; i < TREES.length; i++) tree(cx + TREES[i][0] * H, cz + TREES[i][1] * H, i + (s.x | 0));

  // 按机构职能补「过日子」的小件（与 addFeature 的礼制 / 军事构件互补）
  const ex = cx - 0.10 * H, ez = cz + 0.26 * H;
  const wx2 = cx + 0.14 * H, wz2 = cz + 0.26 * H;
  const nx = cx - 0.06 * H, nz = cz - 0.20 * H;
  switch (s.feature) {
    case 'archive': {   // 大理寺：案牍架 + 卷箱
      box('wood', 3.0, 2.2, 0.5, ex, 1.10, ez, IC.wood);
      for (let r = 0; r < 3; r++) box('wood', 2.8, 0.08, 0.55, ex, 0.4 + r * 0.7, ez + 0.28, IC.woodDark);
      for (let j = 0; j < 3; j++) box('wood', 0.7, 0.5, 0.7, wx2 - 0.8 + j * 0.8, 0.25, wz2, shade(IC.woodDark, 1.05));
      break;
    }
    case 'marshal': {   // 樞密院：甲仗架 + 旗鼓
      for (const sd of [-1, 1]) box('wood', 0.2, 2.4, 0.2, ex + sd * 1.4, 1.2, ez, IC.woodDark);
      box('wood', 3.0, 0.16, 0.24, ex, 2.3, ez, IC.wood);
      for (let j = 0; j < 3; j++) cyl('metal', 0.06, 0.08, 2.2, 5, ex - 0.9 + j * 0.9, 1.2, ez - 0.3, IC.metal, 0, 0, 0.2);
      cyl('wood', 0.9, 0.9, 0.5, 10, wx2, 1.5, wz2, IC.woodDark, 0, Math.PI / 2, 0);
      box('fabric', 0.06, 1.4, 0.06, wx2 + 1.0, 1.9, wz2, IC.lacquer);
      break;
    }
    case 'ritual': {    // 太常寺：编钟架 + 祭器案
      for (const sd of [-1, 1]) box('wood', 0.24, 2.8, 0.24, ex + sd * 2.2, 1.4, ez, IC.woodDark);
      box('wood', 4.8, 0.22, 0.34, ex, 2.8, ez, shade(IC.woodRed, 0.85));
      for (let j = 0; j < 5; j++) cyl('metal', 0.26, 0.34, 0.6, 8, ex - 1.8 + j * 0.9, 2.2, ez, IC.metal);
      box('wood', 2.6, 0.9, 0.8, wx2, 0.45, wz2, IC.wood);
      for (let j = 0; j < 3; j++) cyl('ceramic', 0.2, 0.24, 0.4, 8, wx2 - 0.8 + j * 0.8, 1.1, wz2, shade(IC.plaster2, 0.85));
      break;
    }
    case 'censor': {    // 御史臺：獬豸狱舍栏 + 状纸箱
      for (let j = 0; j < 5; j++) box('metal', 0.1, 1.6, 0.1, ex - 1.6 + j * 0.8, 0.8, ez, IC.metal);
      box('metal', 0.12, 0.12, 3.6, ex, 1.5, ez, IC.metal);
      for (let j = 0; j < 3; j++) box('wood', 0.8, 0.6, 0.8, wx2 - 0.9 + j * 0.9, 0.3, wz2, IC.woodDark);
      box('lacquer', 0.9, 0.9, 0.9, nx, 0.45, nz, IC.lacquer);
      break;
    }
    case 'academy': {   // 翰林院：书箱 + 碑亭
      for (let j = 0; j < 4; j++) box('wood', 1.0, 0.8, 0.7, ex - 1.5 + j * 1.0, 0.4, ez, shade(IC.wood, 0.95));
      for (const sd of [-1, 1]) box('wood', 0.2, 2.6, 0.2, wx2 + sd * 1.0, 1.3, wz2, IC.woodDark);
      box('roof', 2.4, 0.2, 2.4, wx2, 2.7, wz2, shade(IC.tile2, 1.02));
      box('ash', 0.8, 2.0, 0.3, wx2, 1.0, wz2, IC.stone);
      break;
    }
    case 'imperial': {  // 國子監：讲案 + 泮池石栏
      box('wood', 3.2, 0.9, 1.2, ex, 0.45, ez, IC.woodDark);
      box('wood', 3.4, 0.14, 1.3, ex, 1.0, ez, IC.wood);
      cyl('ceramic', 0.24, 0.28, 0.5, 8, ex, 1.35, ez, shade(IC.plaster2, 0.88));
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * Math.PI * 2;
        box('ash', 0.4, 0.6, 0.4, wx2 + Math.cos(a) * 2.2, 0.3, wz2 + Math.sin(a) * 2.2, IC.stone);
      }
      break;
    }
    case 'medical': {   // 太醫院：药柜 + 晒药架
      box('wood', 2.6, 2.2, 0.7, ex, 1.1, ez, shade(IC.wood, 0.92));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) box('wood', 0.55, 0.5, 0.08, ex - 0.9 + c * 0.6, 0.4 + r * 0.65, ez + 0.4, IC.woodDark);
      for (const sd of [-1, 1]) box('wood', 0.14, 1.6, 0.14, wx2 + sd * 1.4, 0.8, wz2, IC.woodDark);
      box('wood', 3.0, 0.1, 0.12, wx2, 1.6, wz2, IC.wood);
      for (let j = 0; j < 4; j++) box('leaf', 0.5, 0.06, 0.5, wx2 - 1.2 + j * 0.8, 1.3, wz2, shade(IC.field, 1.08));
      break;
    }
    case 'astral': {    // 欽天監：圭表 + 星图架
      box('ash', 0.5, 3.0, 0.5, ex, 1.5, ez, IC.stone);
      box('ash', 0.3, 0.2, 5.0, ex, 0.1, ez + 2.5, IC.stone);
      for (const sd of [-1, 1]) box('wood', 0.16, 2.2, 0.16, wx2 + sd * 1.2, 1.1, wz2, IC.woodDark);
      box('fabric', 2.6, 1.8, 0.06, wx2, 1.4, wz2, shade(IC.plaster2, 0.9));
      for (let j = 0; j < 4; j++) sph('glow', 0.1, 5, wx2 - 0.9 + j * 0.6, 1.8 - (j % 2) * 0.5, wz2 + 0.06, IC.winGlow);
      break;
    }
    case 'works': {     // 將作監：木料堆 + 工棚案
      for (let j = 0; j < 4; j++) cyl('wood', 0.3, 0.3, 3.6, 6, ex, 0.35 + (j % 2) * 0.65, ez - 1.2 + Math.floor(j / 2) * 0.7, IC.wood, 0, Math.PI / 2, 0);
      box('wood', 3.0, 0.12, 1.2, wx2, 0.9, wz2, IC.wood);
      for (const sd of [-1, 1]) box('wood', 0.16, 0.9, 1.0, wx2 + sd * 1.3, 0.45, wz2, IC.woodDark);
      for (let j = 0; j < 3; j++) box('metal', 0.5, 0.1, 0.2, wx2 - 0.7 + j * 0.7, 1.02, wz2, IC.metal);
      break;
    }
    case 'treasury': {  // 太府寺：斗斛 + 府库箱
      cyl('metal', 0.6, 0.75, 0.9, 8, ex, 0.7, ez, IC.metal);
      box('wood', 0.1, 0.1, 3.4, ex + 1.6, 1.6, ez, IC.woodDark);
      cyl('metal', 0.22, 0.22, 0.4, 8, ex + 1.6, 1.3, ez - 1.5, IC.metal);
      for (let j = 0; j < 4; j++) box('wood', 1.0, 0.9, 1.0, wx2 - 1.6 + j * 1.05, 0.45, wz2, shade(IC.woodDark, 1.02));
      break;
    }
    case 'camp': {      // 军营：营房门前列架 / 水缸 / 马槽 / 晾衣杆 / 伙房灶台 / 箭靶
      for (const sd of [-1, 1]) box('wood', 0.14, 1.8, 0.14, ex + sd * 1.3, 0.9, ez, IC.woodDark);
      box('wood', 2.8, 0.12, 0.2, ex, 1.7, ez, IC.wood);
      for (let j = 0; j < 4; j++) cyl('wood', 0.05, 0.07, 2.6, 5, ex - 1.0 + j * 0.7, 1.6, ez - 0.3, IC.wood, 0, 0, 0.2);
      cyl('ceramic', 0.65, 0.55, 1.0, 10, wx2, 0.5, wz2, shade(IC.plaster2, 0.82));
      cyl('water', 0.58, 0.58, 0.05, 10, wx2, 0.98, wz2, IC.water);
      box('wood', 2.6, 0.5, 0.8, nx, 0.25, nz, IC.woodDark);
      for (const sd of [-1, 1]) box('wood', 0.14, 0.5, 0.8, nx + sd * 1.2, 0.25, nz, IC.wood);
      for (const sd of [-1, 1]) cyl('wood', 0.1, 0.12, 2.4, 6, nx + sd * 1.4, 1.2, nz + 2.0, IC.woodDark);
      box('wood', 3.0, 0.1, 0.12, nx, 2.4, nz + 2.0, IC.wood);
      for (let j = 0; j < 3; j++) box('fabric', 0.5, 1.0, 0.04, nx - 0.8 + j * 0.8, 1.8, nz + 2.0, shade(IC.plaster, 0.86));
      box('ash', 2.0, 1.0, 1.4, ex, 0.5, ez - 3.0, shade(IC.stone, 0.86));
      cyl('metal', 0.6, 0.6, 0.3, 10, ex, 1.1, ez - 3.0, IC.metal);
      box('glow', 0.8, 0.6, 0.08, ex, 0.6, ez - 2.25, IC.neonGold);
      cyl('fabric', 0.9, 0.9, 0.16, 12, wx2 + 2.0, 1.4, wz2 - 1.0, shade(IC.plaster, 0.9), 0, Math.PI / 2, 0);
      cyl('lacquer', 0.3, 0.3, 0.18, 10, wx2 + 2.0, 1.4, wz2 - 0.9, IC.lacquer, 0, Math.PI / 2, 0);
      box('wood', 0.14, 1.6, 0.14, wx2 + 2.0, 0.8, wz2 - 1.0, IC.woodDark);
      break;
    }
    default:
      break;
  }
  return { items, plants };
}

// ============ 入口 ============
/**
 * 全城机构院落总入口。12 座（10 官署 + 2 军营），全部 Baker 合批、零 RNG。
 * 每类机构登记 inst.<key> 台账，另记 inst.court / inst.camp / inst.total 合计。
 */
export function buildInstitutions(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  let nCourt = 0, nCamp = 0;
  let courtItems = 0, courtPlants = 0, livingRooms = 0, livingItems = 0;
  for (const s of INSTITUTION_SITES) {
    let led: LivingLedger;
    if (s.feature === 'camp') { led = buildCamp(b, sg, atlas, s); nCamp++; }
    else { led = buildCourt(b, sg, atlas, s); nCourt++; }
    livingRooms += led.rooms; livingItems += led.items;
    // R22 露天庭院陈设：12 座全调（含军营），累加器物 / 草木件数
    const cl = buildCourtLife(b, s);
    courtItems += cl.items; courtPlants += cl.plants;
    b.kit(KIT_PREFIX + s.key, 1, 2.0);
  }
  b.kit(KIT_PREFIX + 'court', nCourt);
  b.kit(KIT_PREFIX + 'camp', nCamp);
  b.kit(KIT_PREFIX + 'total', INST_TOTAL);
  // R22 台账：庭院陈设 / 室内起居（键名前缀统一 inst.）
  b.kit(KIT_PREFIX + 'courtLife', 12, 0);
  b.kit(KIT_PREFIX + 'courtLife.item', courtItems, 0);
  b.kit(KIT_PREFIX + 'courtLife.plant', courtPlants, 0);
  b.kit(KIT_PREFIX + 'living.rooms', livingRooms, 0);
  b.kit(KIT_PREFIX + 'living.items', livingItems, 0);
}
