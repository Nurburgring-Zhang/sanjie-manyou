import { Baker, shade } from './bake';
import type { BGroup, SignMesher, SignAtlas } from './bake';
import { furnishPalaceInterior } from './palaceInterior';
import { C } from './buildings';
import { roofOn } from './buildings';
import { bridgeDeckY } from './layout';
// 七山庙观的山顶台面标高与草原/仓场地面标高：与地基建造共用同一解析高度函数，静态件不靠硬编码标高
import { terrainHeight, terrainSurfaceY } from '../world/terrain';

// ============ 宋式建筑细部构件库（据《营造法式》与《清明上河图》图像资料） ============

/** 斗拱带：檐下斗栱层（栌斗+散斗+泥道拱两跳简化），沿面阔均布 */
export function dougongBand(b: Baker, cx: number, cy: number, cz: number, w: number, ry: number, color: number): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const bays = Math.max(3, Math.round(w / 1.6));
  for (let i = 0; i <= bays; i++) {
    const lx = -w / 2 + (w * i) / bays;
    const wx = cx + lx * cosr, wz = cz - lx * sinr;
    // 栌斗（大斗）
    b.box('wood', 0.42, 0.22, 0.42, wx, cy, wz, color, ry);
    // 一跳华拱（前伸）
    b.box('wood', 0.3, 0.14, 0.72, wx, cy + 0.18, wz + 0.3 * cosr, color, ry);
    // 泥道拱（横栱）
    b.box('wood', 0.9, 0.13, 0.26, wx, cy + 0.32, wz, color, ry);
    // 散斗
    b.box('wood', 0.2, 0.1, 0.2, wx - 0.42 * cosr, cy + 0.44, wz + 0.42 * sinr, color, ry);
    b.box('wood', 0.2, 0.1, 0.2, wx + 0.42 * cosr, cy + 0.44, wz - 0.42 * sinr, color, ry);
  }
  // 额枋（檐柱间的横木）
  b.box('wood', w, 0.28, 0.2, cx, cy - 0.3, cz, shade(color, 0.85), ry);
}

/** 直棂窗：竖木条窗（宋式典型），窗框内密排竖棂，内芯透暖光 */
export function zhilingWindow(b: Baker, cx: number, cy: number, cz: number, w: number, h: number, ry: number, lit: boolean): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  // 窗框
  b.box('wood', w, h, 0.12, cx, cy, cz, C.woodDark, ry);
  if (lit) b.box('glow', w - 0.16, h - 0.16, 0.06, cx, cy, cz + 0.04 * cosr, C.winGlow, ry);
  // 竖棂
  const slats = Math.max(3, Math.round(w / 0.18));
  for (let i = 1; i < slats; i++) {
    const lx = -w / 2 + (w * i) / slats;
    b.box('wood', 0.06, h - 0.14, 0.05, cx + lx * cosr, cy, cz + 0.08 * cosr, C.woodDark, ry);
  }
}

/** 垂脊走兽：垂脊末端的小兽队列（简化 3 只） */
export function roofBeasts(b: Baker, x: number, y: number, z: number, ry: number, dir: number): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  for (let i = 0; i < 3; i++) {
    const d = (0.32 + i * 0.3) * dir;
    b.box('roof', 0.14, 0.2 - i * 0.03, 0.14, x + sinr * d, y + 0.16 - i * 0.02, z + cosr * d, C.ridge, ry);
  }
}

/** 望火楼：消防瞭望塔（《东京梦华录》记载汴京望火楼） */
export function buildWatchtower(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number): void {
  // 四柱高架
  for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as const) {
    b.box('wood', 0.34, 10.5, 0.34, x + ox, 5.25, z + oz, shade(C.woodDark, 1));
  }
  // 斜撑
  for (const s of [-1, 1]) {
    b.box('wood', 0.22, 0.22, 3.4, x + s * 1.4, 3.4, z + 1.4, C.woodDark, 0, 0.72, 0);
    b.box('wood', 0.22, 3.4, 0.22, x + s * 1.4, 3.4, z - 1.4, C.woodDark, 0, 0.72, 0);
  }
  // 瞭望亭
  b.box('wood', 4.2, 0.3, 4.2, x, 10.6, z, shade(C.wood, 1));
  for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]] as const) {
    b.box('wood', 0.26, 2.4, 0.26, x + ox, 11.8, z + oz, C.woodRed);
  }
  roofOn(b, 6.2, 6.2, 13.1, x, z, 0, shade(C.tile, 1.1), C.neonGold);
  // 旗帜 + 大鼓
  b.box('wood', 0.14, 5.4, 0.14, x + 2.6, 13.3, z + 2.6, C.woodDark);
  b.box('glow', 1.5, 1.1, 0.05, x + 3.3, 15.2, z + 2.6, 0xd84a3a, 0.3);
  b.cyl('wood', 0.7, 0.7, 0.9, 10, x - 1.2, 11.9, z + 1.2, 0x7a3a1a);
  sg.quad(atlas.text('wanghuo', '望火樓', 220, 66, { color: '#ffe9c8', glow: '#ff9a3c', bg: 'rgba(12,10,18,0.85)', border: 'rgba(255,153,60,.8)', fontPx: 46 }), 3.4, 1.0, x, 9.2, z, 0);
}

/** 牌坊：两柱一间式冲天牌坊（街市标志） */
export function buildPaifang(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number, name: string, key: string, neon: number): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  for (const s of [-1, 1]) {
    b.cyl('wood', 0.3, 0.38, 8.2, 8, x + s * 3.2 * cosr, 4.1, z + s * 3.2 * sinr, shade(C.woodRed, 1.05));
    // 戗柱斜撑
    b.box('wood', 0.22, 0.22, 2.6, x + s * 4.9 * cosr, 3.4, z + s * 4.9 * sinr, C.woodDark, ry + s * 0.5, 0, 0);
    // 柱础
    b.cyl('wall', 0.62, 0.75, 0.6, 8, x + s * 3.2 * cosr, 0.3, z + s * 3.2 * sinr, shade(C.stone, 0.95));
  }
  // 额枋 + 花板 + 顶
  b.box('wood', 8.6, 0.5, 0.5, x, 6.6, z, shade(C.woodRed, 1.05), ry);
  b.box('wood', 8.6, 0.9, 0.36, x, 7.5, z, shade(0x2a4a3a, 1), ry);
  b.box('roof', 9.6, 1.4, 0.7, x, 8.4, z, shade(C.tile, 1.12), ry, 0, 0);
  b.box('glow', 8.2, 0.14, 0.14, x, 8.05, z, neon, ry);
  sg.quad(atlas.text('pf_' + key, name, 320, 84, { color: '#ffe9c8', glow: '#' + neon.toString(16).padStart(6, '0'), bg: 'rgba(14,20,26,0.9)', border: 'rgba(255,179,0,.8)', fontPx: 58 }), 5.4, 1.4, x, 7.5, z, ry);
}

/** 瓮城：主门外矩形套城（三面墙，开口朝城墙；旧版两翼墙与门楼叠在城门台里） */
export function buildWengcheng(b: Baker, x: number, z: number, ry: number): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const put = (g: BGroup, w: number, h: number, d: number, lx: number, lz: number, y: number, hex: number): void => {
    b.box(g, w, h, d, x + lx * cosr + lz * sinr, y, z - lx * sinr + lz * cosr, hex, ry);
  };
  // 三面墙：内端贴城墙外皮（lz=+17），外端 35m；墙高 12.5（新城墙 15.8 的八成，瓮城本应低一档）
  const H = 12.5;
  for (const s of [-1, 1]) {
    put('earth', 4.4, H, 37, s * 17, 0.5, H / 2, shade(0x8f8070, 0.99));
    put('ash', 4.8, 0.32, 37, s * 17, 0.5, H + 0.16, 0x9a9282);
    // 外垛口：每 4.2m 一垛（两翼墙内端顶到城门台侧面，不留断缝）
    for (let k = 0; k < 9; k++) put('ash', 0.9, 1.2, 2.0, s * 17, 17 - k * 4.2, H + 0.9, 0x9a9282);
  }
  put('earth', 38, H, 4.4, 0, -18, H / 2, shade(0x94856f, 1.01));
  put('ash', 38.4, 0.32, 4.8, 0, -18, H + 0.16, 0x9a9282);
  for (let k = -4; k <= 4; k++) put('ash', 2.2, 1.2, 0.9, k * 4.1, -18, H + 0.9, 0x9a9282);
  // 瓮城门洞：暗腔 + 双扇门
  put('lacquer', 11, 8.6, 0.24, 0, -20.2, 4.4, 0x161417);
  for (const s of [-1, 1]) put('lacquer', 5.2, 7.6, 0.3, s * 2.7, -20.4, 3.9, 0x7a1f1a);
  // 瓮城门楼：木身 + 单檐歇山（落在最外一道墙上）
  put('wood', 13, 5.5, 6.5, 0, -18, H + 2.75, 0xa63a2b);
  for (const s of [-1, 1]) for (const k of [-1, 0, 1]) put('wood', 0.4, 5.5, 0.4, k * 4.4, -18 + s * 3.3, H + 2.75, shade(0xa63a2b, 0.84));
  roofOn(b, 17, 10, H + 5.5, x - 18 * sinr, z - 18 * cosr, ry, shade(0x35594c, 1.02), undefined, 1.8);
  put('glow', 0.5, 0.5, 0.5, -5.5, -21.4, H + 1.4, C.lantern);
  put('glow', 0.5, 0.5, 0.5, 5.5, -21.4, H + 1.4, C.lantern);
}

/** 角楼：城墙四角「墩台 + 三层飞檐 + 顶层阁楼」——全城最高的军事制高点 */
export function buildJiaolou(b: Baker, x: number, z: number): void {
  // 墩台：三层收分夯土（19.4/17.8/16.2 × 6.0/5.4/4.4 = 15.8m），与新城墙压顶齐平。
  // 旧版台身只 9.5m 高：墙加高到 15.8 后会把整座塔的下两层吃掉，故墩台与三层木身一并抬升。
  b.box('ash', 20.4, 1.0, 20.4, x, 0.5, z, 0x8b877b);
  b.box('earth', 19.4, 6.0, 19.4, x, 3.0, z, shade(0x8a7b66, 0.95));
  b.box('earth', 17.8, 5.4, 17.8, x, 8.7, z, shade(0x8f8070, 1));
  b.box('earth', 16.2, 4.4, 16.2, x, 13.6, z, shade(0x94856f, 1.02));
  b.box('ash', 16.6, 0.32, 16.6, x, 15.96, z, 0x9a9282);
  // 墩顶垛口：四面各 3 垛（与马面同语言，角台首先是一座碉堡）
  for (const s of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      b.box('ash', 2.4, 1.2, 0.7, x + k * 4.8, 16.72, z + s * 7.6, 0x9a9282);
      b.box('ash', 0.7, 1.2, 2.4, x + s * 7.6, 16.72, z + k * 4.8, 0x9a9282);
    }
  }
  b.box('ash', 15.0, 0.34, 15.0, x, 16.29, z, 0x9c9a90);
  // 三层飞檐：木身 + 曲面瓦顶，逐层退进（6.8 / 6.4 / 6.0m 层高）
  const tiers: [number, number, number][] = [[12.6, 16.46, 6.8], [10.2, 23.5, 6.4], [8.0, 30.1, 6.0]];
  tiers.forEach(([w2, y2, h2], i) => {
    b.box('wood', w2, h2, w2, x, y2 + h2 / 2, z, shade(0xa63a2b, 1 - i * 0.05));
    // 四面当心间：板门/直棂窗 + 点状窗光（不做通长灯带）
    for (const s of [-1, 1]) {
      b.box('lacquer', 1.7, 2.3, 0.2, x, y2 + h2 * 0.5, z + s * (w2 / 2 + 0.02), 0x2a1c12);
      b.box('glow', 1.2, 1.7, 0.1, x, y2 + h2 * 0.5, z + s * (w2 / 2 + 0.14), C.winGlow);
      b.box('lacquer', 0.2, 2.3, 1.7, x + s * (w2 / 2 + 0.02), y2 + h2 * 0.5, z, 0x2a1c12);
      b.box('glow', 0.1, 1.7, 1.2, x + s * (w2 / 2 + 0.14), y2 + h2 * 0.5, z, C.winGlow);
    }
    // 檐下斗栱两道（前后檐），檐角点灯
    for (const s of [-1, 1]) dougongBand(b, x, y2 + h2 - 0.45, z + s * (w2 / 2 + 0.55), w2 - 1, 0, 0xd8b028);
    b.box('glow', 0.34, 0.4, 0.34, x, y2 + h2 - 0.9, z + w2 / 2 + 0.35, C.lantern);
    roofOn(b, w2 + 3.2, w2 + 3.2, y2 + h2, x, z, i * 0.06, shade(0x35594c, 1.04 + i * 0.02));
  });
  // 顶层阁楼（W26 新增）：4.5m 高敞亭——鼓座 + 平座栏杆 + 8 柱 + 歇山顶 + 宝顶
  b.box('ash', 7.4, 2.05, 7.4, x, 37.95, z, 0x968e7e);                  // 鼓座（从三层瓦顶中升起）
  b.box('ash', 8.8, 0.3, 8.8, x, 39.13, z, 0x9c9a90);                   // 平座
  for (const su of [-1, 0, 1]) for (const sv of [-1, 0, 1]) {
    if (su === 0 && sv === 0) continue;
    b.box('ash', 0.46, 0.24, 0.46, x + su * 2.7, 39.4, z + sv * 2.7, 0x9a9282);
    b.box('wood', 0.3, 4.5, 0.3, x + su * 2.7, 41.53, z + sv * 2.7, shade(0xa63a2b, 1.02));
  }
  // 一圈栏杆：四面上下寻杖 + 每面 4 望柱
  for (const s of [-1, 1]) {
    b.box('wood', 8.3, 0.1, 0.1, x, 40.5, z + s * 4.1, 0x8a3324);
    b.box('wood', 8.3, 0.08, 0.08, x, 40.05, z + s * 4.1, 0x8a3324);
    b.box('wood', 0.1, 0.1, 8.3, x + s * 4.1, 40.5, z, 0x8a3324);
    b.box('wood', 0.08, 0.08, 8.3, x + s * 4.1, 40.05, z, 0x8a3324);
    for (let k = -2; k <= 2; k++) {
      b.box('wood', 0.13, 1.15, 0.13, x + k * 2.05, 40.1, z + s * 4.1, 0x8a3324);
      b.box('wood', 0.13, 1.15, 0.13, x + s * 4.1, 40.1, z + k * 2.05, 0x8a3324);
    }
  }
  // 阑额
  for (const s of [-1, 1]) {
    b.box('wood', 5.7, 0.26, 0.2, x, 43.45, z + s * 2.7, shade(C.woodDark, 1.06));
    b.box('wood', 0.2, 0.26, 5.7, x + s * 2.7, 43.45, z, shade(C.woodDark, 1.06));
  }
  roofOn(b, 9.6, 9.6, 43.78, x, z, 0, shade(0x35594c, 1.08), undefined, 2.6);
  // 宝顶 + 顶灯（点状）
  b.cyl('metal', 0.34, 0.62, 0.9, 8, x, 46.9, z, 0xd8b028);
  b.cyl('metal', 0.18, 0.34, 0.5, 8, x, 47.45, z, 0xd8b028);
  b.box('glow', 0.3, 0.3, 0.3, x, 47.9, z, C.neonGold);
}

/** 影壁（独立式屏风墙） */
export function buildYingbi(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, ry: number, name: string, key: string): void {
  b.box('wall', 7, 4.6, 0.8, x, 2.3, z, shade(0xcfc4a6, 1), ry);
  b.box('roof', 8, 0.6, 1.4, x, 4.9, z, shade(C.tile, 1.08), ry, 0, 0);
  sg.quad(atlas.text('yb_' + key, name, 320, 100, { color: '#ffe9c8', glow: '#00e5ff', bg: 'rgba(10,14,22,0.9)', border: 'rgba(0,229,255,.7)', fontPx: 62 }), 4.6, 1.44, x, 2.6, z, ry);
}

/** 帝王级重檐庑殿顶（双层檐） */
export function doubleEaveRoof(b: Baker, w: number, d: number, y: number, x: number, z: number, ry: number): void {
  roofOn(b, w + 14, d + 12, y, x, z, ry, shade(0x8a6a2a, 1.05), 0xffd25e);
  roofOn(b, w * 0.62, d * 0.6, y + 4.6, x, z, ry, shade(0x9a7a32, 1.05), 0xffd25e);
}

// ============ WS-36 城门与宫门构件（16 件，逐条按 20 卷资产全录落位） ============
/**
 * 全部构件由 buildCityWall 统一调用：与城墙/城门/宫门同批进同一 Baker（0 新增 draw call）。
 * 坐标锚点（既有体量一律不动，只在其表面落件）：
 *  · 宣德門 imperial.ts:161-164 —— px=0 / pz=-3700，门线 z=-2950，门身 150×10×10（z −2955…−2945），
 *    墩台 x=±90（12×15×12）；双阙落在墩台之外 ±108。
 *  · 大庆殿 / 垂拱殿 / 紫宸殿 imperial.ts:166-273 —— z = −3280 / −3640 / −4040，
 *    台基顶 3.3 / 2.2 / 2.2，台基前脸逐层收进 3m。
 *  · 上東門 buildings.ts:698-780（WALL_X=462 / GATE_Z=52）；虹桥 bridge.ts（z ∈ [−48,48]，桥面宽 10.4）。
 */
const PALACE_GATE_Z = -2950;      // 午门门线（W-N 内收：中轴与门线不动，只把北墙从 −4450 收到 −4000）
const DAQING = { x: 0, z: -3260, halfW: 100, halfD: 42, baseY: 4.65 };   // 太和殿（大慶殿）
const CHUIGONG = { x: 0, z: -3480, halfW: 70, halfD: 35, baseY: 4.65 };  // 中和殿（垂拱殿）
const ZICHEN = { x: 0, z: -3690, halfW: 90, halfD: 39, baseY: 4.65 };    // 保和殿（紫宸殿）
const PALACE_MARBLE = 0xd2c9b6;   // 汉白玉（与 imperial.ts 同色）

const CINNABAR = 0x9d2933;       // 红罗
const CARPET_EDGE = 0x651a22;    // 锦边
const SILK_GOLD = 0xc9a13a;      // 织金
const GILT = 0xd8b028;           // 鎏金
const BRONZE = 0x8a7a52;         // 铜
const VERDIGRIS = 0x4e7a5e;      // 铜绿
const QING = 0x2f5a4a;           // 青彩画
const LV = 0x2a6b5a;             // 绿彩画

/** 平铺地毯：毯面 + 两道锦边（边压在毯面上 2cm，不共面） */
function carpetPanel(b: Baker, cx: number, cy: number, cz: number, w: number, d: number, hex: number): void {
  b.box('fabric', w, 0.06, d, cx, cy, cz, hex);
  for (const s of [-1, 1]) b.box('fabric', 0.2, 0.02, d, cx + s * (w / 2 - 0.1), cy + 0.04, cz, CARPET_EDGE);
  for (const s of [-1, 1]) b.box('fabric', w, 0.02, 0.2, cx, cy + 0.04, cz + s * (d / 2 - 0.1), CARPET_EDGE);
}

/** 垂挂踢面：台基立面上一段地毯（含两侧锦边） */
function carpetRiser(b: Baker, x: number, z: number, y0: number, y1: number, w: number, face: number): void {
  const h = y1 - y0;
  b.box('fabric', w, h, 0.06, x, (y0 + y1) / 2, z, CINNABAR);
  for (const s of [-1, 1]) b.box('fabric', 0.18, h, 0.03, x + s * (w / 2 - 0.09), (y0 + y1) / 2, z + face * 0.04, CARPET_EDGE);
  b.box('fabric', w, 0.1, 0.03, x, (y0 + y1) / 2 + h / 2 - 0.1, z + face * 0.04, SILK_GOLD);
}

// ---- C-ITM-0001 双阙墩台：夯土包砖 · 高 11m · 上起观楼（门楼两侧，2 座） ----
function quePier(b: Baker, cx: number, cz: number): void {
  // 石台基两层（条石压面 + 压顶出挑）
  b.box('ash', 11.4, 1.2, 11.4, cx, 0.6, cz, 0x8d8a80);
  b.box('ash', 11.7, 0.18, 11.7, cx, 1.29, cz, 0x9c9a90);
  // 包砖台身九皮、逐皮内收 0.13（夯土芯外包砖，收分 1.12m）
  for (let i = 0; i < 9; i++) {
    const w = 10.4 - i * 0.13;
    b.box('wall', w, 1.0, w, cx, 1.7 + i * 1.0, cz, shade(C.wallGray, 0.92 + (i % 3) * 0.05));
  }
  // 四角隅石两段（随收分退台）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('ash', 0.62, 4.5, 0.62, cx + sx * 5.12, 3.45, cz + sz * 5.12, 0x8b877b);
    b.box('ash', 0.58, 4.5, 0.58, cx + sx * 4.72, 7.95, cz + sz * 4.72, 0x8b877b);
  }
  // 两道石挑檐带
  for (const [y, w] of [[4.62, 10.02], [7.42, 9.72]] as const) b.box('ash', w, 0.22, w, cx, y, cz, 0x94907f);
  // 顶：夯土露明带 + 砖压顶 + 石台明（合计到 11.0）
  b.box('earth', 9.3, 0.36, 9.3, cx, 10.38, cz, shade(C.earth, 1.04));
  b.box('wall', 9.5, 0.26, 9.5, cx, 10.69, cz, shade(C.wallGray, 1.04));
  b.box('ash', 9.9, 0.16, 9.9, cx, 10.9, cz, 0x9c9a90);
  // 观楼平座栏杆：四面上下寻杖 + 每面五望柱
  for (const s of [-1, 1]) {
    b.box('wood', 9.2, 0.1, 0.1, cx, 11.86, cz + s * 4.5, 0x8a3324);
    b.box('wood', 9.2, 0.08, 0.08, cx, 11.42, cz + s * 4.5, 0x8a3324);
    for (let i = 0; i < 5; i++) b.box('wood', 0.14, 0.9, 0.14, cx - 4.4 + i * 2.2, 11.45, cz + s * 4.5, 0x8a3324);
    b.box('wood', 0.1, 0.1, 9.2, cx + s * 4.5, 11.86, cz, 0x8a3324);
    b.box('wood', 0.08, 0.08, 9.2, cx + s * 4.5, 11.42, cz, 0x8a3324);
    for (let i = 0; i < 5; i++) b.box('wood', 0.14, 0.9, 0.14, cx + s * 4.5, 11.45, cz - 4.4 + i * 2.2, 0x8a3324);
  }
  // 观楼四柱 + 柱础 + 阑额
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('ash', 0.5, 0.2, 0.5, cx + sx * 2.3, 11.08, cz + sz * 2.3, 0x9c9a90);
    b.cyl('wood', 0.17, 0.2, 2.4, 8, cx + sx * 2.3, 12.3, cz + sz * 2.3, shade(C.woodRed, 1.02));
  }
  for (const s of [-1, 1]) {
    b.box('wood', 5.1, 0.26, 0.2, cx, 13.42, cz + s * 2.3, shade(C.woodRed, 0.94));
    b.box('wood', 0.2, 0.26, 5.1, cx + s * 2.3, 13.42, cz, shade(C.woodRed, 0.94));
  }
  b.box('wood', 5.0, 0.16, 5.0, cx, 11.16, cz, shade(C.woodDark, 1.05)); // 楼板
  // 阙楼顶：歇山小殿 + 官霓檐灯 + 宝顶
  roofOn(b, 8.4, 8.4, 13.55, cx, cz, 0, shade(C.tile, 1.06), C.neonGold, 2.1);
  b.cyl('metal', 0.14, 0.22, 0.4, 8, cx, 15.9, cz, shade(GILT, 0.62));
  b.cyl('metal', 0.26, 0.1, 0.34, 8, cx, 16.2, cz, shade(GILT, 0.8));
  b.kit('gate.quePier', 1, 5.6);
  b.kit('gate.queTower', 1, 12.4);
}

// ---- C-ITM-0003 铺首衔环：鎏金铜 · 兽面衔环（门扇内外，4 件） ----
function pumenRing(b: Baker, x: number, y: number, z: number, face: number): void {
  const zz = z + face * 0.16;
  // 兽面底盘（外圈厚沿 + 内盘）
  b.cyl('metal', 0.9, 0.9, 0.08, 16, x, y, z + face * 0.04, 0xa87f18, 0, Math.PI / 2);
  b.cyl('metal', 0.74, 0.8, 0.14, 16, x, y, z + face * 0.13, GILT, 0, Math.PI / 2);
  // 兽面：额 / 眉 / 目 / 鼻梁 / 鼻头 / 颊 / 角 / 獠牙
  b.box('metal', 0.5, 0.18, 0.1, x, y + 0.3, zz + face * 0.1, shade(GILT, 1.06), 0, 0, 0);
  for (const s of [-1, 1]) {
    b.box('metal', 0.3, 0.1, 0.09, x + s * 0.21, y + 0.17, zz + face * 0.12, shade(GILT, 0.9), 0, 0, s * 0.38);
    b.cyl('metal', 0.095, 0.095, 0.1, 10, x + s * 0.2, y + 0.05, zz + face * 0.14, 0x3a2a10, 0, Math.PI / 2);
    b.cyl('metal', 0.055, 0.055, 0.08, 8, x + s * 0.2, y + 0.05, zz + face * 0.19, shade(GILT, 0.72), 0, Math.PI / 2);
    b.box('metal', 0.22, 0.14, 0.08, x + s * 0.34, y - 0.1, zz + face * 0.09, shade(GILT, 0.94));
    b.box('metal', 0.18, 0.1, 0.08, x + s * 0.3, y + 0.36, zz + face * 0.08, shade(GILT, 1.12), 0, 0, s * 0.5);
    b.box('metal', 0.06, 0.1, 0.06, x + s * 0.14, y - 0.22, zz + face * 0.16, shade(GILT, 0.8));
  }
  b.box('metal', 0.14, 0.34, 0.1, x, y + 0.02, zz + face * 0.11, shade(GILT, 0.92));
  b.box('metal', 0.26, 0.14, 0.12, x, y - 0.17, zz + face * 0.13, shade(GILT, 1.08));
  // 鬃：沿盘缘八道放射
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    b.box('metal', 0.08, 0.22, 0.07, x + Math.cos(a) * 0.82, y + Math.sin(a) * 0.82, zz + face * 0.04, shade(GILT, 0.78), 0, 0, a - Math.PI / 2);
  }
  // 门钉八枚
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.cyl('metal', 0.055, 0.055, 0.07, 8, x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6, zz + face * 0.06, shade(GILT, 0.7), 0, Math.PI / 2);
  }
  // 双环（各八段折环，穿鼻而下）
  for (const hx of [-0.24, 0.24]) {
    const cy = y - 0.52;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.box('metal', 0.085, 0.1, 0.07, x + hx + Math.cos(a) * 0.26, cy + Math.sin(a) * 0.26, zz + face * 0.18, k % 2 ? shade(GILT, 1.02) : shade(GILT, 0.82), 0, 0, a);
    }
    b.box('metal', 0.06, 0.12, 0.06, x + hx, y - 0.26, zz + face * 0.16, shade(GILT, 0.66));
  }
  b.kit('gate.pumenRing', 1, y);
}

// ---- C-ITM-0006 拒马叉子：木铁 · 交叉拒马（广场前沿，6 座） ----
function juma(b: Baker, x: number, z: number, y0: number): void {
  const poleH = 2.6, lean = 0.66;
  const half = (poleH / 2) * Math.sin(lean);
  const rise = (poleH / 2) * Math.cos(lean);
  const cy = y0 + rise;
  // 两副 X 形交叉杆（沿 z 前后各一副），杆头削尖为铁
  for (const sz of [-0.42, 0.42]) {
    for (const d of [-1, 1]) {
      b.box('wood', 0.15, poleH, 0.15, x, cy, z + sz, shade(C.woodDark, 0.96 + d * 0.04), 0, 0, d * lean);
      // 铁枪尖（顺杆向顶端）
      b.box('metal', 0.11, 0.34, 0.11, x - d * (half + 0.06), y0 + 2 * rise + 0.12, z + sz, 0x40444a, 0, 0, d * lean);
      // 杆中铁箍
      b.box('metal', 0.19, 0.12, 0.19, x, cy, z + sz, 0x555a60, 0, 0, d * lean);
    }
  }
  // 横撑两道 + 斜撑
  for (const yy of [0.52, 1.16]) b.box('wood', 0.12, 0.12, 1.06, x, y0 + yy, z, shade(C.wood, 1.02));
  for (const sz of [-1, 1]) b.box('wood', 0.1, 0.1, 1.12, x, y0 + 0.86, z + sz * 0.24, shade(C.wood, 0.94), 0, sz * 0.7, 0);
  // 落地垫木 + 铁钉
  b.box('wood', 1.9, 0.12, 1.15, x, y0 + 0.06, z, shade(C.woodDark, 0.86));
  for (const sx of [-0.7, 0.7]) for (const sz of [-0.42, 0.42]) b.box('metal', 0.08, 0.1, 0.08, x + sx, y0 + 0.14, z + sz, 0x4a4e54);
  b.kit('gate.juma', 1, cy);
}

// ---- C-ITM-0012 麒麟拴桩：石桩铜环（门东侧麟厩，2 座） ----
function qilinPost(b: Baker, x: number, z: number): void {
  b.box('ash', 1.02, 0.24, 1.02, x, 0.12, z, 0x77746a);            // 石座
  b.box('ash', 1.14, 0.1, 1.14, x, 0.28, z, 0x8b877b);             // 座压顶
  b.cyl('ash', 0.17, 0.23, 1.46, 8, x, 1.05, z, 0x8d8a80);         // 石桩（下粗上细）
  b.box('ash', 0.46, 0.16, 0.46, x, 1.83, z, 0x9c9a90);            // 桩头
  b.box('ash', 0.3, 0.12, 0.3, x, 1.96, z, 0xa5a294);              // 云头
  for (const s of [-1, 1]) b.box('ash', 0.16, 0.06, 0.3, x + s * 0.2, 1.98, z, 0x9c9a90, 0, 0, s * 0.3);
  // 铜鼻 + 双环（穿鼻，各八段）
  b.box('metal', 0.12, 0.24, 0.1, x, 1.62, z + 0.22, BRONZE);
  for (const sx of [-0.1, 0.1]) {
    const cy = 1.42;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.box('metal', 0.07, 0.085, 0.06, x + sx + Math.cos(a) * 0.21, cy + Math.sin(a) * 0.21, z + 0.28, k % 2 ? BRONZE : VERDIGRIS, 0, 0, a);
    }
  }
  // 系绳（麻索绕桩一道，垂头）
  b.box('fabric', 0.07, 0.86, 0.07, x - 0.2, 1.2, z + 0.16, 0x6b5b3e, 0, 0, 0.24);
  b.box('fabric', 0.28, 0.07, 0.28, x, 1.5, z, 0x6b5b3e);
  b.kit('gate.qilinPost', 1, 1.0);
}

// ---- C-ITM-0021 红罗地衣：织物 · 通殿长毯（太和殿御道：广场 → 踏道 → 殿内） ----
function carpetDaqing(b: Baker): void {
  const { x: hx, z: hz } = DAQING;
  const w = 4.4;
  const zPlaza = hz + 120;      // 广场南端
  const zBase = hz + 50;        // 台基前缘（顶层台基半深 50）
  // 广场段平铺（地坪顶 0.155）
  carpetPanel(b, hx, 0.19, (zPlaza + zBase + 30) / 2, w, zPlaza - (zBase + 30), CINNABAR);
  // 踏道段：五级随踏步抬升（毯面贴踏步，不悬空）
  for (let i = 0; i < 5; i++) {
    carpetPanel(b, hx, 0.19 + i * 0.93, zBase + 27 - i * 6.0, w, 6.4, CINNABAR);
  }
  // 台基面 → 殿内（殿内地面 4.87）
  carpetPanel(b, hx, DAQING.baseY + 0.22, (zBase + hz - 16) / 2, w, Math.abs(zBase - (hz - 16)), CINNABAR);
  // 织金团花：广场段每 6m 一朵 + 殿内三朵
  let flowers = 0;
  for (let z = zPlaza - 6; z > zBase + 34; z -= 6) {
    b.cyl('fabric', 0.58, 0.58, 0.02, 12, hx, 0.23, z, SILK_GOLD);
    b.cyl('fabric', 0.3, 0.3, 0.03, 12, hx, 0.235, z, shade(CINNABAR, 1.16));
    flowers++;
  }
  for (const z of [hz + 30, hz + 8, hz - 12]) {
    b.cyl('fabric', 0.62, 0.62, 0.02, 12, hx, DAQING.baseY + 0.26, z, SILK_GOLD);
    b.cyl('fabric', 0.32, 0.32, 0.03, 12, hx, DAQING.baseY + 0.265, z, shade(CINNABAR, 1.16));
    flowers++;
  }
  // 南端流苏
  for (let i = 0; i < 9; i++) b.box('fabric', 0.1, 0.03, 0.26, hx - w / 2 + 0.2 + i * 0.44, 0.2, zPlaza + 0.16, SILK_GOLD);
  b.kit('city.carpetDaqing', 1, 1.1);
  b.kit('city.carpetFlower', flowers, 0.23);
}

// ---- C-ITM-0053 红罗地衣：织物 · 团窠纹（保和殿通殿） ----
function carpetZichen(b: Baker): void {
  const hz = ZICHEN.z;
  const w = 3.6;
  const zPlaza = hz + 96;
  const zBase = hz + 46;
  carpetPanel(b, 0, 0.19, (zPlaza + zBase) / 2, w, zPlaza - zBase, CINNABAR);
  for (let i = 0; i < 5; i++) carpetPanel(b, 0, 0.19 + i * 0.93, zBase + 24 - i * 5.4, w, 5.8, CINNABAR);
  carpetPanel(b, 0, ZICHEN.baseY + 0.22, (zBase + hz - 14) / 2, w, Math.abs(zBase - (hz - 14)), CINNABAR);
  let medallions = 0;
  const medal = (z: number, y: number): void => {
    b.cyl('fabric', 0.52, 0.52, 0.02, 12, 0, y, z, SILK_GOLD);
    b.cyl('fabric', 0.32, 0.32, 0.03, 12, 0, y + 0.005, z, shade(CINNABAR, 1.2));
    b.cyl('fabric', 0.11, 0.11, 0.04, 8, 0, y + 0.01, z, SILK_GOLD);
    medallions++;
  };
  for (let z = zPlaza - 5; z > zBase + 6; z -= 11) medal(z, 0.23);
  for (const z of [hz + 26, hz + 4, hz - 16]) medal(z, ZICHEN.baseY + 0.26);
  b.kit('city.carpetZichen', 1, 2.2);
  b.kit('city.carpetMedallion', medallions, 2.25);
}

// ---- C-ITM-0037 绣帘：织物 · 缠枝纹（中和殿格扇，4 幅） ----
function xiulian(b: Baker, x: number, z: number, w: number, y0 = 2.42): void {
  const topY = y0 + 6.2, botY = y0;
  const h = topY - botY;
  // 格扇门框（框住帘子，帘才读成"门帘"而不是挂布）
  for (const s of [-1, 1]) b.box('wood', 0.18, h + 0.34, 0.16, x + s * (w / 2 + 0.12), (topY + botY) / 2, z - 0.1, shade(C.woodDark, 1.05));
  b.box('wood', w + 0.42, 0.2, 0.16, x, topY + 0.18, z - 0.1, shade(C.woodDark, 1.1));
  b.box('wood', w + 0.42, 0.14, 0.2, x, botY - 0.08, z - 0.1, shade(C.woodDark, 0.92));
  // 帘杆 + 铜环
  b.box('wood', w + 0.5, 0.09, 0.09, x, topY + 0.08, z - 0.02, shade(C.woodRed, 0.9));
  for (const s of [-1, 1]) b.cyl('metal', 0.07, 0.07, 0.1, 8, x + s * (w / 2 + 0.2), topY + 0.08, z - 0.02, GILT, 0, Math.PI / 2);
  // 帘身（五道褶）+ 缠枝纹（竖向金线、两道横襕、六朵缠枝花）
  b.box('fabric', w, h, 0.06, x, (topY + botY) / 2, z, shade(CINNABAR, 0.98));
  for (let i = 0; i < 5; i++) {
    const lx = -w / 2 + (w * (i + 1)) / 6;
    b.box('fabric', 0.1, h - 0.1, 0.05, x + lx, (topY + botY) / 2, z + 0.05, shade(CINNABAR, i % 2 ? 0.88 : 1.08));
  }
  for (const yy of [topY - 0.55, botY + 0.5]) b.box('fabric', w - 0.1, 0.14, 0.02, x, yy, z + 0.07, SILK_GOLD);
  for (let i = 0; i < 6; i++) {
    const lx = -w / 2 + 0.55 + ((w - 1.1) * i) / 5;
    const ly = botY + 1.1 + ((topY - botY - 2.2) * ((i * 7) % 6)) / 5;
    b.cyl('fabric', 0.16, 0.16, 0.02, 8, x + lx, ly, z + 0.075, shade(SILK_GOLD, 0.95), 0, Math.PI / 2);
    b.box('fabric', 0.03, 0.3, 0.02, x + lx, ly + 0.2, z + 0.075, shade(SILK_GOLD, 0.86), 0, 0, 0.5);
  }
  // 束带 + 帘钩
  for (const s of [-1, 1]) {
    b.box('fabric', 0.1, 0.5, 0.08, x + s * (w / 2 - 0.35), botY + 1.75, z + 0.06, SILK_GOLD, 0, 0, s * 0.25);
    b.box('metal', 0.06, 0.3, 0.06, x + s * (w / 2 + 0.02), botY + 1.62, z + 0.06, GILT, 0, 0, s * 0.6);
  }
  b.kit('gate.xiulian', 1, topY);
}

// ---- C-ITM-0039 / C-ITM-0054 绣墩 / 宫娥绣墩：藤木 · 鼓形 ----
function xiudun(b: Baker, x: number, y: number, z: number, s: number, padHex: number, kitId: string): void {
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.box('wood', 0.1 * s, 0.16, 0.1 * s, x + Math.cos(a) * 0.17 * s, y + 0.08, z + Math.sin(a) * 0.17 * s, shade(C.woodDark, 0.9));
  }
  b.cyl('wood', 0.24 * s, 0.2 * s, 0.16, 12, x, y + 0.24, z, shade(C.wood, 1.02));
  b.cyl('wood', 0.27 * s, 0.27 * s, 0.16, 12, x, y + 0.4, z, shade(C.wood, 1.1));
  b.cyl('wood', 0.2 * s, 0.24 * s, 0.14, 12, x, y + 0.52, z, shade(C.wood, 0.96));
  // 藤箍两道（细环，压在鼓腹上下）
  b.cyl('wood', 0.252 * s, 0.252 * s, 0.035, 12, x, y + 0.3, z, shade(0x8a6a3a, 1.12));
  b.cyl('wood', 0.252 * s, 0.252 * s, 0.035, 12, x, y + 0.5, z, shade(0x8a6a3a, 1.12));
  // 坐垫（织金缘 + 心）
  b.cyl('fabric', 0.245 * s, 0.245 * s, 0.06, 12, x, y + 0.62, z, padHex);
  b.cyl('fabric', 0.18 * s, 0.18 * s, 0.02, 12, x, y + 0.66, z, shade(padHex, 1.18));
  b.kit(kitId, 1, y + 0.4);
}

// ---- C-ITM-0041 斗拱彩画组：木彩 · 五铺作双杪（紫宸殿檐下，214 攒 + 转角斜栱） ----
function dougongZichen(b: Baker): void {
  const hx = ZICHEN.x, hz = ZICHEN.z;
  const halfW = ZICHEN.halfW, halfD = ZICHEN.halfD;
  const y = 24.4;   // 新保和殿檐口 25.0（旧殿 2 层台基顶 2.2 + 殿身 17 → 24）
  const put = (x: number, z: number, ry: number, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number): void => {
    const cr = Math.cos(ry), sr = Math.sin(ry);
    b.box('wood', w, h, d, x + lx * cr + lz * sr, y + ly, z - lx * sr + lz * cr, hex, ry);
  };
  // 一攒五铺作：栌斗 → 华栱两跳 → 泥道栱/慢栱 → 令栱 + 散斗 + 耍头
  const set = (x: number, z: number, ry: number, dx: number, dz: number): void => {
    put(x, z, ry, 0.54, 0.24, 0.54, 0, 0, 0, GILT);              // 栌斗
    put(x, z, ry, 0.32, 0.17, 0.95, 0, 0.2, 0.42, QING);         // 华栱头跳
    put(x, z, ry, 0.28, 0.16, 0.8, 0, 0.42, 0.6, QING);          // 华栱二跳
    put(x, z, ry, 1.0, 0.16, 0.26, 0, 0.34, 0.02, LV);           // 泥道栱
    put(x, z, ry, 1.5, 0.15, 0.26, 0, 0.52, 0.02, LV);           // 慢栱
    put(x, z, ry, 0.84, 0.14, 0.24, 0, 0.62, 0.86, QING);        // 令栱
    put(x, z, ry, 0.2, 0.12, 0.2, -0.62, 0.6, 0.02, GILT);       // 散斗
    put(x, z, ry, 0.2, 0.12, 0.2, 0.62, 0.6, 0.02, GILT);
    put(x, z, ry, 0.2, 0.12, 0.2, 0, 0.7, 0.86, GILT);
    put(x, z, ry, 0.22, 0.16, 0.72, 0, 0.76, 0.92, 0x8a3324);    // 耍头
    put(x, z, ry, 0.16, 0.1, 0.16, -0.74, 0.5, 0.02, 0x8a3324);  // 栱头彩画端
    put(x, z, ry, 0.16, 0.1, 0.16, 0.74, 0.5, 0.02, 0x8a3324);
    if (dx !== 0 && dz !== 0) {
      // 转角铺作：45° 斜栱两跳（指向角外）
      const ry2 = Math.atan2(dx, dz);
      b.box('wood', 0.3, 0.16, 0.95, x + dx * 0.34, y + 0.26, z + dz * 0.34, QING, ry2);
      b.box('wood', 0.26, 0.14, 0.8, x + dx * 0.66, y + 0.46, z + dz * 0.66, LV, ry2);
      b.box('wood', 0.18, 0.12, 0.2, x + dx * 0.92, y + 0.56, z + dz * 0.92, GILT, ry2);
    }
  };
  let n = 0;
  // 前后檐各 62 攒（含四角）
  for (let i = 0; i <= 61; i++) {
    const lx = -halfW + (i * 2 * halfW) / 61;
    const dx = i === 0 ? -1 : i === 61 ? 1 : 0;
    for (const sz of [-1, 1] as const) {
      set(hx + lx, hz + sz * (halfD + 0.42), sz > 0 ? 0 : Math.PI, dx, sz);
      n++;
    }
  }
  // 两山各 45 攒（去掉与转角重复的两端）
  for (let j = 1; j <= 45; j++) {
    const lz = -halfD + (j * 2 * halfD) / 46;
    for (const sx of [-1, 1] as const) {
      set(hx + sx * (halfW + 0.42), hz + lz, sx > 0 ? Math.PI / 2 : -Math.PI / 2, sx, 0);
      n++;
    }
  }
  b.kit('city.dougongZichen', n, y);
}

// ---- C-ITM-0052 簋尊礼器：铜 · 仿古礼器（紫宸殿后阁架，6 件） ----
function guizunRack(b: Baker, x: number, y: number, z: number): void {
  // 后阁架：两立板 + 两层隔板 + 挡头
  for (const s of [-1, 1]) b.box('wood', 0.12, 1.5, 0.62, x + s * 1.34, y + 0.75, z, shade(C.woodDark, 1.08));
  for (const sy of [0.3, 1.0]) b.box('wood', 2.8, 0.08, 0.64, x, y + sy, z, shade(C.wood, 1.02));
  b.box('wood', 2.8, 0.06, 0.1, x, y + 1.46, z - 0.28, shade(C.woodDark, 0.95));
  // 三簋（下层）+ 三尊（上层）
  const gui = (cx: number, cy: number): void => {
    b.cyl('metal', 0.16, 0.16, 0.07, 12, cx, cy + 0.04, z, VERDIGRIS);        // 圈足
    b.cyl('metal', 0.22, 0.16, 0.22, 12, cx, cy + 0.18, z, BRONZE);           // 腹
    b.cyl('metal', 0.24, 0.24, 0.05, 12, cx, cy + 0.31, z, shade(BRONZE, 1.1)); // 口沿
    b.cyl('metal', 0.06, 0.25, 0.1, 12, cx, cy + 0.38, z, shade(BRONZE, 0.92)); // 盖
    b.cyl('metal', 0.045, 0.045, 0.08, 8, cx, cy + 0.46, z, GILT);             // 盖钮
    for (const s of [-1, 1]) b.box('metal', 0.07, 0.11, 0.13, cx + s * 0.25, cy + 0.24, z, BRONZE, 0, 0, s * 0.2); // 双耳
  };
  const zun = (cx: number, cy: number): void => {
    b.cyl('metal', 0.14, 0.15, 0.06, 12, cx, cy + 0.03, z, VERDIGRIS);        // 圈足
    b.cyl('metal', 0.17, 0.14, 0.3, 12, cx, cy + 0.2, z, BRONZE);             // 身
    b.cyl('metal', 0.24, 0.18, 0.1, 12, cx, cy + 0.4, z, shade(BRONZE, 1.12));// 外撇口
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      b.box('metal', 0.035, 0.34, 0.12, cx + Math.cos(a) * 0.19, cy + 0.22, z + Math.sin(a) * 0.19, shade(BRONZE, 0.86), Math.PI / 2 - a);
    }
    b.box('metal', 0.16, 0.02, 0.12, cx, cy + 0.44, z, shade(0x3a2a10, 1));   // 口内暗腔
  };
  for (const ox of [-0.9, 0, 0.9]) {
    gui(x + ox, y + 0.34);
    zun(x + ox, y + 1.04);
  }
  b.kit('gate.guizun', 6, y + 0.8);
}

// ---- C-ITM-0056 拱骨交叠组：圆木 · 编木交叠（虹桥拱体） ----
function archWeave(b: Baker): void {
  let logs = 0;
  // 下层长骨：横贯桥宽（每 4m 一道）
  for (let k = 0; k < 19; k++) {
    const z = -36 + k * 4;
    b.cyl('wood', 0.2, 0.2, 9.8, 8, 0, bridgeDeckY(z) - 1.58, z, shade(0x5e3e22, 0.94 + (k % 3) * 0.07), 0, 0, Math.PI / 2);
    logs++;
  }
  // 上层短骨：错半跨叠压，两端错头
  for (let k = 0; k < 18; k++) {
    const z = -34 + k * 4;
    const ox = k % 2 ? 0.35 : -0.35;
    b.cyl('wood', 0.17, 0.17, 8.6, 8, ox, bridgeDeckY(z) - 1.86, z, shade(0x6a4526, 0.9 + (k % 4) * 0.05), 0, 0, Math.PI / 2);
    logs++;
  }
  // 交叠节点：木楔 + 铁钉（压在长短骨相交处）
  for (let k = 0; k < 9; k++) {
    const z = -34 + k * 8;
    const y = bridgeDeckY(z) - 1.7;
    b.box('wood', 0.3, 0.22, 0.24, 0, y, z, shade(0x7a5230, 1.05), 0, 0.7, 0);
    b.box('metal', 0.08, 0.06, 0.08, 0, y + 0.14, z, 0x555a60);
  }
  b.kit('city.hongqiaoArchWeave', logs, 0);
}

// ---- C-ITM-0061 华表仙鹤顶：木雕 · 立鹤引颈（虹桥桥头华表，4 座） ----
function craneFinial(b: Baker, x: number, z: number): void {
  const y0 = 6.95;   // 既有华表宝珠顶面（bridge.ts:50-57 顶珠 6.45–6.95）
  b.cyl('wood', 0.36, 0.44, 0.16, 8, x, y0 + 0.08, z, shade(0x8a3324, 1.04));
  for (const s of [-1, 1]) b.cyl('wood', 0.04, 0.05, 0.52, 6, x + s * 0.09, y0 + 0.42, z - 0.02, shade(0xd8cbaa, 0.96));
  // 身
  b.box('wood', 0.34, 0.3, 0.64, x, y0 + 0.8, z, shade(0xf2ecdc, 0.98));
  // 翅（两片，贴身后收）
  for (const s of [-1, 1]) b.box('wood', 0.06, 0.22, 0.52, x + s * 0.19, y0 + 0.84, z - 0.02, shade(0xe8e4da, 0.9), 0, 0, s * 0.08);
  // 尾（三片扇形）
  for (let i = 0; i < 3; i++) b.box('wood', 0.1, 0.08, 0.34, x + (i - 1) * 0.09, y0 + 0.78 + (i % 2) * 0.04, z - 0.44, shade(0x4a3220, 1.05), 0, 0.16, (i - 1) * 0.3);
  // 颈（前倾）+ 头 + 喙 + 丹顶
  b.cyl('wood', 0.075, 0.095, 0.62, 8, x, y0 + 1.08, z + 0.22, shade(0xf2ecdc, 1.02), 0, 0.42);
  b.box('wood', 0.16, 0.14, 0.24, x, y0 + 1.34, z + 0.4, shade(0xf2ecdc, 1.04));
  b.box('wood', 0.05, 0.05, 0.3, x, y0 + 1.32, z + 0.64, shade(0xc9a13a, 1.1));
  b.box('wood', 0.09, 0.07, 0.11, x, y0 + 1.43, z + 0.36, 0xb0302a);
  for (const s of [-1, 1]) b.box('wood', 0.05, 0.04, 0.1, x + s * 0.05, y0 + 1.38, z + 0.48, 0x2a1c12);
  b.kit('gate.craneFinial', 1, y0 + 0.8);
}

// ---- C-ITM-0064 缆桩：木铁 · 系缆凸桩（虹桥桥脚两侧，6 座） ----
function mooringPost(b: Baker, x: number, z: number): void {
  const y0 = 1.37;   // 驳岸压顶面（props.ts:35-36）
  b.box('ash', 0.44, 0.12, 0.44, x, y0 + 0.06, z, 0x77746a);
  b.cyl('wood', 0.11, 0.15, 1.05, 8, x, y0 + 0.58, z, shade(0x5e3e22, 1.02));
  b.cyl('metal', 0.14, 0.14, 0.07, 10, x, y0 + 1.13, z, 0x555a60);           // 铁帽
  for (const yy of [0.42, 0.86]) b.cyl('metal', 0.165, 0.165, 0.06, 10, x, y0 + yy, z, 0x4a4e54);
  // 系缆凸桩（十字横木）
  b.box('wood', 0.56, 0.12, 0.12, x, y0 + 0.98, z, shade(0x4a3220, 1.06));
  b.box('wood', 0.12, 0.12, 0.56, x, y0 + 0.98, z, shade(0x4a3220, 1.06));
  // 铁环（八段）
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box('metal', 0.06, 0.075, 0.05, x + 0.2 + Math.cos(a) * 0.16, y0 + 0.82 + Math.sin(a) * 0.16, z + 0.1, k % 2 ? 0x6a655c : 0x4a4e54, 0, 0, a);
  }
  b.kit('gate.mooringPost', 1, y0 + 0.6);
}

// ---- C-ITM-0066 摊贩担：竹木 · 香饮担 / 杂货担（虹桥桥面两侧，2 副） ----
function vendorPole(b: Baker, x: number, z: number, kind: 'drink' | 'goods'): void {
  const y0 = bridgeDeckY(z) + 0.15;
  // 担架三脚 + 座圈
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    b.cyl('wood', 0.035, 0.05, 1.22, 6, x + Math.cos(a) * 0.34, y0 + 0.61, z + Math.sin(a) * 0.34, shade(C.woodDark, 1.04), 0, Math.cos(a) * 0.22, -Math.sin(a) * 0.22);
  }
  b.cyl('wood', 0.06, 0.06, 0.5, 8, x, y0 + 1.18, z, shade(C.wood, 1.06), 0, 0, Math.PI / 2);
  // 扁担（两端上翘）
  b.box('wood', 0.09, 0.09, 1.72, x, y0 + 1.26, z, shade(0x8a6a3a, 1.04));
  for (const s of [-1, 1]) b.box('wood', 0.08, 0.08, 0.5, x, y0 + 1.32, z + s * 0.98, shade(0x8a6a3a, 1.02), s * 0.22);
  // 两端挂筐（竹编：开口筒 + 三箍 + 吊绳）
  for (const s of [-1, 1]) {
    b.cyl('wood', 0.3, 0.24, 0.34, 10, x, y0 + 0.62, z + s * 1.02, shade(0xa8894f, 1.0));
    for (const yy of [0.48, 0.62, 0.76]) b.cyl('wood', 0.305 - Math.abs(yy - 0.62) * 0.2, 0.305 - Math.abs(yy - 0.62) * 0.2, 0.03, 10, x, y0 + yy, z + s * 1.02, shade(0x7a5f34, 1.1));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.box('fabric', 0.02, 0.5, 0.02, x + Math.cos(a) * 0.26, y0 + 1.02, z + s * 1.02 + Math.sin(a) * 0.26, 0x6b5b3e);
    }
  }
  if (kind === 'drink') {
    // 香饮担：铜汤壶 + 四盏 + 炭炉
    b.cyl('metal', 0.22, 0.26, 0.3, 10, x + 0.55, y0 + 0.2, z, BRONZE);
    b.cyl('metal', 0.08, 0.12, 0.14, 8, x + 0.55, y0 + 0.42, z, BRONZE);
    b.box('metal', 0.06, 0.06, 0.26, x + 0.55, y0 + 0.38, z + 0.28, BRONZE, 0.5);   // 流
    b.box('metal', 0.05, 0.18, 0.05, x + 0.55, y0 + 0.3, z - 0.26, BRONZE, 0, 0.4);  // 提梁
    for (let i = 0; i < 4; i++) b.cyl('ceramic', 0.07, 0.055, 0.09, 8, x - 0.5 + (i % 2) * 0.28, y0 + 0.2, z - 0.4 + Math.floor(i / 2) * 0.26, 0xe8e4da);
    b.cyl('metal', 0.19, 0.22, 0.2, 8, x - 0.55, y0 + 0.14, z + 0.42, 0x4a4e54);
    b.cyl('glow', 0.13, 0.13, 0.03, 8, x - 0.55, y0 + 0.25, z + 0.42, 0xff7a2a);
    // 幌子（立在担后，避开桥栏 x=±5.05）
    b.box('wood', 0.05, 1.5, 0.05, x + 0.3, y0 + 0.75, z - 1.55, C.woodDark);
    b.box('fabric', 0.56, 0.42, 0.03, x + 0.3, y0 + 1.3, z - 1.55, 0x9d2933);
  } else {
    // 杂货担：布包 + 木匣 + 秤
    b.box('fabric', 0.46, 0.26, 0.4, x + 0.52, y0 + 0.18, z + 0.12, 0x2a5c42);
    b.box('fabric', 0.4, 0.22, 0.34, x + 0.52, y0 + 0.4, z + 0.12, 0x7a4a2a);
    b.box('wood', 0.42, 0.22, 0.34, x - 0.52, y0 + 0.16, z - 0.06, shade(0x8a6a3a, 1.05));
    b.box('wood', 0.34, 0.18, 0.28, x - 0.52, y0 + 0.36, z - 0.06, shade(0x8a6a3a, 0.94));
    b.box('metal', 0.05, 0.05, 0.66, x, y0 + 0.9, z + 0.42, GILT, 0.4);            // 秤杆
    b.cyl('metal', 0.09, 0.1, 0.04, 8, x + 0.28, y0 + 0.76, z + 0.42, BRONZE);      // 秤盘
    b.box('wood', 0.05, 1.4, 0.05, x - 0.3, y0 + 0.7, z + 1.55, C.woodDark);
    b.box('fabric', 0.56, 0.36, 0.03, x - 0.3, y0 + 1.2, z + 1.55, 0x2a5c42);
  }
  b.kit(kind === 'drink' ? 'gate.vendorDrink' : 'gate.vendorGoods', 1, y0);
}

// ---- C-ITM-0073 望柱：青石 · 柱头狮子（州桥石栏 / 栏杆间断，16 根） ----
function stoneBaluster(b: Baker, x: number, z: number): void {
  const y0 = bridgeDeckY(z) + 0.15;   // 桥面踏步板顶
  const stone = 0x87847a;
  b.box('ash', 0.4, 0.14, 0.4, x, y0 + 0.07, z, shade(stone, 0.9));            // 柱础
  b.box('ash', 0.24, 1.0, 0.24, x, y0 + 0.64, z, shade(stone, 1.04));          // 柱身
  for (const yy of [0.4, 0.9]) b.box('ash', 0.27, 0.05, 0.27, x, y0 + yy, z, shade(stone, 0.82)); // 箍线
  b.box('ash', 0.3, 0.1, 0.3, x, y0 + 1.19, z, shade(stone, 1.1));             // 柱头座
  // 蹲狮：身 / 前腿 / 头 / 耳 / 鬃 / 尾
  b.box('ash', 0.26, 0.22, 0.3, x, y0 + 1.35, z, shade(stone, 1.12));
  b.box('ash', 0.2, 0.16, 0.12, x, y0 + 1.27, z + 0.18, shade(stone, 1.06));
  b.box('ash', 0.22, 0.19, 0.2, x, y0 + 1.55, z + 0.06, shade(stone, 1.16));
  for (const s of [-1, 1]) b.box('ash', 0.06, 0.07, 0.05, x + s * 0.09, y0 + 1.66, z + 0.06, shade(stone, 1.0));
  for (let k = 0; k < 5; k++) b.box('ash', 0.05, 0.08, 0.05, x - 0.12 + k * 0.06, y0 + 1.5 + (k % 2) * 0.04, z - 0.06, shade(stone, 0.9));
  b.box('ash', 0.06, 0.2, 0.06, x, y0 + 1.42, z - 0.2, shade(stone, 0.96));
  b.kit('gate.stoneBaluster', 1, y0 + 1.2);
}

/**
 * 城门与宫门构件总装（WS-36 16 件）。
 * 由 buildCityWall 调用：全部落在既有城门/宫门/桥体/台基表面上，不改任何既有坐标与体量。
 */
export function buildGatePalaceFittings(b: Baker): void {
  // —— 午门（imperial.ts buildMeridianGate：城台 236×36、门面 z = 门线 + 18）——
  // 双阙墩台：C-ITM-0001 —— 与 imperial.ts 的阙台同心（±150, z 门线 + 6）
  quePier(b, -150, PALACE_GATE_Z + 6);
  quePier(b, 150, PALACE_GATE_Z + 6);
  // 铺首衔环：C-ITM-0003 —— 中门朱扉内外各一对（门扇 x ±5.5，面 z = 门线 + 17.6）
  for (const s of [-1, 1]) for (const sx of [-1, 1]) pumenRing(b, sx * 5.5, 5.8, PALACE_GATE_Z + 17.6, s);
  // 拒马叉子：C-ITM-0006 —— 午门广场前沿（御街宽 26m，六座横列）
  for (let i = 0; i < 6; i++) juma(b, -10.5 + i * 4.2, PALACE_GATE_Z + 46, 0.14);
  // 麒麟拴桩：C-ITM-0012 —— 城台之外、宫墙南侧
  qilinPost(b, 132, PALACE_GATE_Z + 24);
  qilinPost(b, 138, PALACE_GATE_Z + 24);
  // 红罗地衣：C-ITM-0021 —— 太和殿御道（广场 → 踏道 → 殿内通毯）
  carpetDaqing(b);
  // 红罗地衣：C-ITM-0053 —— 保和殿通殿（团窠纹）
  carpetZichen(b);
  // 绣帘：C-ITM-0037 —— 中和殿前檐格扇四幅（新台基顶 4.65，帘挂 4.9–11.1）
  for (const lx of [-24, -8, 8, 24]) xiulian(b, CHUIGONG.x + lx, CHUIGONG.z + CHUIGONG.halfD + 0.47, 4.4, CHUIGONG.baseY + 0.25);
  // 绣墩：C-ITM-0039 —— 中和殿召对位（东侧前廊两排八座）
  for (let i = 0; i < 4; i++) {
    for (const sz of [0, 1]) xiudun(b, 30 + i * 6.4, CHUIGONG.baseY, CHUIGONG.z + CHUIGONG.halfD + 4.2 + sz * 1.8, 1, CINNABAR, 'gate.xiudun');
  }
  // 宫娥绣墩：C-ITM-0054 —— 保和殿席间（前廊两排二十座）
  for (let i = 0; i < 10; i++) {
    for (const sz of [0, 1]) xiudun(b, -54 + i * 12, ZICHEN.baseY, ZICHEN.z + ZICHEN.halfD + 4.0 + sz * 1.4, 0.92, 0x2a5c42, 'gate.gongeStool');
  }
  // 斗拱彩画组：C-ITM-0041 —— 保和殿檐下 214 攒（五铺作双杪 + 转角 45° 斜栱）
  dougongZichen(b);
  // 簋尊礼器：C-ITM-0052 —— 保和殿后阁架（殿身后檐台明）
  guizunRack(b, ZICHEN.x, ZICHEN.baseY, ZICHEN.z - ZICHEN.halfD - 3.6);
  // —— 虹桥（bridge.ts）——
  // 拱骨交叠组：C-ITM-0056 —— 拱体编木交叠（桥面下、既有五道纵梁之间）
  archWeave(b);
  // 华表仙鹤顶：C-ITM-0061 —— 桥头华表顶（4 座）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) craneFinial(b, sx * 7.2, sz * 50.5);
  // 缆桩：C-ITM-0064 —— 桥脚两侧（驳岸压顶，两岸各三座）
  for (const sz of [-1, 1]) for (const lx of [-8.2, 0, 8.2]) mooringPost(b, lx, sz * 30.6);
  // 摊贩担：C-ITM-0066 —— 桥面两侧（香饮担 / 杂货担）
  vendorPole(b, 4.15, 22, 'drink');
  vendorPole(b, -4.15, -22, 'goods');
  // 望柱：C-ITM-0073 —— 州桥石栏望柱（与虹桥同址，落在海马栏板四跨的分界处，每侧 8 根）
  for (const sx of [-1, 1]) {
    for (const lz of [4.8, 9.6, 14.4, 19.2]) {
      stoneBaluster(b, sx * 4.8, lz);
      stoneBaluster(b, sx * 4.8, -lz);
    }
  }
}

// ============ W-N 室内陈设：礼制布局（实装在 palaceInterior.ts） ============
/**
 * 三大殿室内陈设：件数按殿内可用面积分配（≈15㎡/件），宝座区为定值核心、不被稀释。
 * 分类台账：palace.interior.<kind>（三殿汇总）/ palace.hall.<殿>.<kind>（分殿明细）。
 */
export function furnishHall(b: Baker, o: { x: number; z: number; y: number; w: number; d: number; scale: number; salt: number }): void {
  furnishPalaceInterior(b, o);
}

/** 六宫各院陈设（每院 10 件）：宝座 1 + 屏风 1 + 香炉 1 + 宫灯 4 + 地毯 1 + 案几 2 */
export function furnishCourt(b: Baker, x: number, z: number, y: number, salt: number): void {
  const fy = y + 0.04;
  b.box('wall', 4.2, 0.9, 2.6, x, fy + 0.45, z, shade(PALACE_MARBLE, 0.94));
  b.box('ash', 4.4, 0.12, 2.8, x, fy + 0.96, z, PALACE_MARBLE);
  b.box('lacquer', 2.4, 0.5, 1.5, x, fy + 1.27, z, 0x7a1f16);
  b.box('fabric', 2.1, 0.14, 1.3, x, fy + 1.56, z, CINNABAR);
  b.box('lacquer', 2.4, 1.4, 0.28, x, fy + 2.1, z - 0.7, 0x7a1f16);
  b.box('metal', 2.0, 0.12, 0.16, x, fy + 2.75, z - 0.7, GILT);
  b.kit('palace.throne', 1, fy + 1.3);
  for (let i = -1; i <= 1; i++) {
    b.box('lacquer', 0.9, 2.2, 0.12, x + i * 0.95, fy + 2.1, z - 1.5, i % 2 ? 0x5e1c1c : 0x6b1f1a);
    b.box('metal', 0.94, 0.08, 0.16, x + i * 0.95, fy + 3.2, z - 1.5, GILT);
  }
  b.kit('palace.screen', 1, fy + 2.2);
  b.cyl('metal', 0.34, 0.24, 0.7, 10, x + 2.4, fy + 0.35, z + 1.0, 0x4a453c);
  b.box('glow', 0.2, 0.08, 0.2, x + 2.4, fy + 0.72, z + 1.0, 0xff7a2a);
  b.kit('palace.censer', 1, fy + 0.6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = x + sx * 8.5, cz = z + sz * 5.5;
    // 吊杆从灯顶 6.5 接到殿顶 8.0（旧版只到 7.0，灯在梁下悬空 1m）
    b.box('wood', 0.07, 1.5, 0.07, cx, fy + 5.95, cz, C.woodDark);
    b.box('fabric', 0.6, 0.9, 0.6, cx, fy + 4.3, cz, CINNABAR);
    b.box('glow', 0.4, 0.62, 0.4, cx, fy + 4.3, cz, 0xffc061);
  }
  b.kit('palace.lantern', 4, fy + 4.3);
  carpetPanel(b, x, fy + 0.03, z + 5.6, 3.4, 9.0, CINNABAR);
  b.kit('palace.carpet', 1, fy);
  for (const sx of [-1, 1]) {
    b.box('wood', 1.2, 0.1, 2.2, x + sx * 3.3, fy + 0.72, z + 2.2, shade(C.wood, 1.06));
    for (const a of [-1, 1]) for (const bq of [-1, 1]) b.box('wood', 0.12, 0.68, 0.12, x + sx * 3.3 + a * 0.5, fy + 0.34, z + 2.2 + bq * 0.95, C.woodDark);
    b.cyl('ceramic', 0.16, 0.11, 0.36, 10, x + sx * 3.3, fy + 0.95, z + 2.2, 0xe8e4da);
    b.kit('palace.desk', 1, fy + 0.8);
  }
}

/** 门殿陈设（午门 / 太和门）：宫灯 + 香炉 + 仪仗 */
export function furnishGateHall(b: Baker, x: number, z: number, y: number, scale: number, salt: number): void {
  const lampN = Math.round(6 * scale);
  const escN = Math.round(4 * scale);
  for (let i = 0; i < lampN; i++) {
    const cx = x - 12 + i * (24 / Math.max(1, lampN - 1));
    b.box('wood', 0.07, 1.1, 0.07, cx, y + 6.4, z, C.woodDark);
    b.box('fabric', 0.7, 1.0, 0.7, cx, y + 5.4, z, CINNABAR);
    b.box('glow', 0.46, 0.7, 0.46, cx, y + 5.4, z, 0xffc061);
  }
  b.kit('palace.lantern', lampN, y + 5.4);
  for (const sx of [-1, 1]) {
    b.cyl('metal', 0.42, 0.3, 0.9, 10, x + sx * 7, y + 0.45, z + 3.2, 0x4a453c);
    b.box('glow', 0.26, 0.1, 0.26, x + sx * 7, y + 0.92, z + 3.2, 0xff7a2a);
  }
  b.kit('palace.censer', 2, y + 0.7);
  for (let i = 0; i < escN; i++) {
    const sx = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    b.box('metal', 0.1, 3.6, 0.1, x + sx * (5.5 + k * 0.9), y + 1.8, z + 4.6, 0x8a8a80);
    b.box('metal', 0.4, 0.6, 0.09, x + sx * (5.5 + k * 0.9), y + 3.6, z + 4.6, 0xd8b028, 0, 0, sx * 0.3);
  }
  b.kit('palace.ceremonial', escN, y + 2.6);
  b.kit('palace.gateFurnishing', 1, y);
}

// ============ WS-40 塔/像/庙殿 25 件（逐条按 20 卷《汴京城市资产全录》材质/形制/位置落位） ============
/**
 * 全部构件由 buildAllCityBuildings 在 buildPagoda 之后统一调用，与既有城体同批进同一 Baker（0 新增 draw call）。
 * 坐标锚点（既有体量一律不动，只在其表面/院落里落件）：
 *  · 上清觀 buildings.ts（540, 118，w16 d10，台基顶 0.6）→ 三清殿抱厦落在殿前 z 124.5–131.5
 *  · 开宝寺塔 buildings.ts buildPagoda（540, 200）→ 塔身十三层 / 塔心柱 / 塔窗 直接长在塔体上
 *  · 塔院 pagodaCourtWall：x 512–552 / z 170–230 → 碑亭落在塔前西院（524, 180）
 *  · 汴河：水面 y=1.0（river.ts:54）、岸墙压顶 y=1.37 / |z|=30.6（props.ts:36）→ 泊位船体吃水在 z=28，系船桩落在 |z|=31.2
 *  · 东市/西市市楼 imperial.ts:275（±2800, 900，地面 0.24）→ 值事房贴楼东侧
 *  · 七山庙观 terrain.ts:194 buildMountainTemple（台基面 gy+0.7 / 三级台基顶 gy+2.25 / 殿身 gy+1.7–6.7）
 *  · 金耀门漕运仓 20 卷 056（4700, 120）→ 押粮官房落在仓西 4626
 *  · 草原敖包 20 卷 052（1500, −10500）
 */

const STONE_DK = 0x6f6b60;   // 青石暗
const STONE_LT = 0x9c9a90;   // 青石亮
const MUD_GOLD = 0xc9a13a;   // 泥金塑
const CLAY_GREY = 0xb8a06a;  // 泥塑
const CAST_BRONZE = 0x9a6b3a; // 铜铸
const BRONZE_LAC = 0xa87f18; // 铜漆
const JADE_WHITE = 0xe6e2d6; // 玉塑

type CrownKind = 'dao' | 'phoenix' | 'beads' | 'none';
type HoldKind = 'ruyi' | 'gui' | 'slip' | 'lotus' | 'peach' | 'none';
type MudraKind = 'fearless' | 'earth' | 'dhyana' | 'none';

interface DeitySpec {
  x: number; y: number; z: number;   // y = 须弥座底面
  h: number;                         // 像高（须弥座以上，不含座）
  ry?: number;
  seated?: boolean;
  robe: number; skin: number;
  crown?: CrownKind;
  halo?: number;                     // 头光色，0 = 无头光
  back?: boolean;                    // 背屏
  hold?: HoldKind;
  mudra?: MudraKind;
  seatW?: number;
  kit: string;
}

/** 神像：须弥座（圭角/下枋/束腰壸门/上枋/莲瓣）+ 坐立身（趺坐或立裙、腰胸肩三段、双臂双手）+ 头（面/耳/目/唇/冠）
 *  + 头光（环 + 放射光背）+ 背屏 + 持物 + 手印。绝不用单根圆柱糊成形。 */
function deity(b: Baker, s: DeitySpec): void {
  const ry = s.ry ?? 0, cos = Math.cos(ry), sin = Math.sin(ry);
  const X = (lx: number, lz: number): number => s.x + lx * cos + lz * sin;
  const Z = (lx: number, lz: number): number => s.z - lx * sin + lz * cos;
  const put = (
    g: 'ash' | 'wood' | 'metal' | 'fabric' | 'glow' | 'lacquer' | 'ceramic',
    w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, rz = 0, rx = 0,
  ): void => {
    b.box(g, w, h, d, X(lx, lz), s.y + ly, Z(lx, lz), hex, ry, rx, rz);
  };
  const h = s.h;
  const seated = s.seated ?? true;
  // ---- 须弥座 ----
  const sw = s.seatW ?? h * 0.72;
  const sd = sw * 0.72;
  const sh = Math.max(0.60, h * 0.30);
  put('ash', sw, sh * 0.18, sd, 0, sh * 0.09, 0, STONE_DK);                     // 圭角
  put('ash', sw * 0.96, sh * 0.16, sd * 0.96, 0, sh * 0.26, 0, 0x87847a);       // 下枋
  put('ash', sw * 0.78, sh * 0.34, sd * 0.78, 0, sh * 0.51, 0, STONE_DK);       // 束腰
  for (const s2 of [-1, 1]) {                                                   // 束腰壸门（前后各二）
    put('ash', sw * 0.20, sh * 0.18, 0.05, s2 * sw * 0.18, sh * 0.51, sd * 0.395, 0x5b574e);
    put('ash', sw * 0.20, sh * 0.18, 0.05, s2 * sw * 0.18, sh * 0.51, -sd * 0.395, 0x5b574e);
    put('ash', 0.05, sh * 0.18, sd * 0.20, s2 * sw * 0.395, sh * 0.51, 0, 0x5b574e);
  }
  put('ash', sw * 0.94, sh * 0.14, sd * 0.94, 0, sh * 0.75, 0, STONE_LT);       // 上枋
  for (let i = 0; i < 12; i++) {                                                 // 莲瓣一圈
    const a = (i / 12) * Math.PI * 2;
    const lx = Math.sin(a) * sw * 0.45, lz = Math.cos(a) * sd * 0.45;
    put('ash', 0.17, sh * 0.15, 0.10, lx, sh * 0.94, lz, 0xa5a294, a);
  }
  // ---- 身 ----
  const yb = sh;
  const legH = h * (seated ? 0.34 : 0.46);
  const torH = h * (seated ? 0.42 : 0.34);
  const headH = h * (seated ? 0.20 : 0.16);
  const neckH = h * 0.04;
  const shW = h * 0.30, dep = h * 0.19;
  const torBot = yb + legH;
  const neckTop = torBot + torH + neckH;
  const headY = yb + h - headH / 2;
  if (seated) {
    put('fabric', h * 0.48, h * 0.13, h * 0.30, 0, yb + h * 0.065, h * 0.01, s.robe);                 // 趺坐
    for (const s2 of [-1, 1]) {
      put('fabric', h * 0.16, h * 0.13, h * 0.27, s2 * h * 0.17, yb + h * 0.105, -h * 0.01, shade(s.robe, 1.08)); // 膝
      put('ash', h * 0.09, h * 0.05, h * 0.10, s2 * h * 0.10, yb + h * 0.035, h * 0.16, s.skin);       // 足
    }
    put('fabric', h * 0.52, h * 0.11, h * 0.07, 0, yb + h * 0.035, h * 0.15, shade(s.robe, 0.88));     // 裙裾垂座
  } else {
    put('fabric', h * 0.36, legH, h * 0.27, 0, yb + legH / 2, 0, s.robe);                              // 裙
    for (const s2 of [-1, 1]) {
      put('fabric', h * 0.13, legH * 0.98, h * 0.15, s2 * h * 0.09, yb + legH / 2, h * 0.02, shade(s.robe, 1.06));
      put('ash', h * 0.12, h * 0.05, h * 0.19, s2 * h * 0.09, yb + h * 0.026, h * 0.07, s.skin);        // 足
    }
  }
  put('fabric', shW * 0.72, torH * 0.30, dep * 0.88, 0, torBot + torH * 0.15, 0, shade(s.robe, 0.9));   // 腰
  put('fabric', shW, torH * 0.62, dep, 0, torBot + torH * 0.62, 0, s.robe);                            // 胸
  put('fabric', shW * 0.98, torH * 0.10, dep * 0.92, 0, torBot + torH * 0.97, 0, shade(s.robe, 1.12)); // 肩
  // 璎珞/霞帔：胸前两道金线 + 双肩披帛
  put('metal', shW * 0.62, 0.05, dep * 0.2, 0, torBot + torH * 0.66, dep * 0.5, shade(MUD_GOLD, 0.86));
  put('metal', shW * 0.5, 0.04, dep * 0.18, 0, torBot + torH * 0.5, dep * 0.5, shade(MUD_GOLD, 0.7));
  for (const s2 of [-1, 1]) {
    put('fabric', 0.14, torH * 0.9, dep * 0.55, s2 * shW * 0.46, torBot + torH * 0.5, dep * 0.05, shade(s.robe, 1.2), s2 * 0.06);
    // 上臂 + 前臂（前臂前伸，肘部收）
    put('fabric', h * 0.075, torH * 0.56, dep * 0.52, s2 * shW * 0.53, torBot + torH * 0.72, dep * 0.06, shade(s.robe, 0.96), s2 * 0.10);
    put('fabric', h * 0.062, torH * 0.40, dep * 0.5, s2 * shW * 0.54, torBot + torH * 0.34, dep * 0.34, shade(s.robe, 1.04), s2 * -0.18, -0.65);
  }
  // 手印
  const handY = torBot + torH * 0.30;
  if (s.mudra === 'fearless') {
    put('ash', h * 0.052, h * 0.10, h * 0.05, shW * 0.55, torBot + torH * 0.52, dep * 0.56, s.skin, -0.34);   // 右手施无畏
    put('ash', h * 0.055, h * 0.055, h * 0.075, 0, handY, dep * 0.5, s.skin);                                  // 左手禅定
  } else if (s.mudra === 'earth') {
    put('ash', h * 0.05, h * 0.10, h * 0.06, shW * 0.52, yb + legH * 0.72, dep * 0.42, s.skin, 0.2);           // 右手触地
    put('ash', h * 0.055, h * 0.055, h * 0.075, 0, handY, dep * 0.5, s.skin);
  } else {
    for (const s2 of [-1, 1]) put('ash', h * 0.055, h * 0.055, h * 0.075, s2 * shW * 0.18, handY, dep * 0.5, s.skin);
  }
  // ---- 头 ----
  put('ash', h * 0.055, neckH * 1.4, h * 0.055, 0, neckTop - neckH * 0.4, 0, shade(s.skin, 0.94));
  put('ash', h * 0.135, headH * 0.88, h * 0.125, 0, headY, 0, s.skin);
  put('ash', h * 0.098, headH * 0.52, h * 0.022, 0, headY - headH * 0.06, h * 0.064, shade(s.skin, 1.06));
  for (const s2 of [-1, 1]) {
    put('ash', h * 0.024, headH * 0.24, h * 0.024, s2 * h * 0.072, headY - headH * 0.02, 0, shade(s.skin, 0.88));
    put('ash', h * 0.020, headH * 0.045, h * 0.012, s2 * h * 0.030, headY + headH * 0.07, h * 0.066, 0x241a16);
  }
  put('ash', h * 0.024, headH * 0.07, h * 0.020, 0, headY - headH * 0.10, h * 0.066, shade(s.skin, 0.84));
  put('ash', h * 0.046, headH * 0.028, h * 0.012, 0, headY - headH * 0.23, h * 0.064, 0x8a3a30);
  // ---- 冠 ----
  const crownY = headY + headH * 0.44;
  if (s.crown === 'beads') {                        // 冕十二旒
    put('lacquer', h * 0.21, headH * 0.11, h * 0.14, 0, crownY + headH * 0.12, 0, 0x24242a);
    put('lacquer', h * 0.17, headH * 0.14, h * 0.12, 0, crownY, -h * 0.01, 0x33333a);
    for (let i = 0; i < 6; i++) {
      const lx = -h * 0.075 + i * h * 0.030;
      put('metal', h * 0.011, h * 0.11, h * 0.011, lx, crownY + headH * 0.02, h * 0.062, 0xd8b028);
      put('metal', h * 0.011, h * 0.11, h * 0.011, lx, crownY + headH * 0.02, -h * 0.062, 0xd8b028);
    }
  } else if (s.crown === 'phoenix') {               // 凤冠
    put('metal', h * 0.20, headH * 0.16, h * 0.13, 0, crownY, 0, shade(MUD_GOLD, 0.9));
    put('metal', h * 0.09, headH * 0.16, h * 0.09, 0, crownY + headH * 0.16, 0, MUD_GOLD);
    for (const s2 of [-1, 1]) {
      put('metal', h * 0.06, headH * 0.13, h * 0.07, s2 * h * 0.075, crownY + headH * 0.10, 0, shade(MUD_GOLD, 1.1), s2 * 0.3);
      put('glow', h * 0.028, h * 0.028, h * 0.028, s2 * h * 0.075, crownY + headH * 0.22, 0, 0xffd25e);
    }
  } else if (s.crown === 'dao') {                   // 道冠 + 簪
    put('ash', h * 0.10, headH * 0.20, h * 0.10, 0, crownY + headH * 0.04, 0, shade(s.skin, 0.7));
    put('metal', h * 0.16, headH * 0.03, h * 0.02, 0, crownY + headH * 0.10, 0, shade(MUD_GOLD, 0.8));
    put('metal', h * 0.035, headH * 0.05, h * 0.035, 0, crownY + headH * 0.18, 0, MUD_GOLD);
  } else {                                          // 螺发 + 肉髻（佛）
    put('ash', h * 0.14, headH * 0.16, h * 0.13, 0, crownY, -h * 0.004, shade(s.skin, 0.82));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      put('ash', h * 0.034, h * 0.034, h * 0.034, Math.sin(a) * h * 0.055, crownY + headH * 0.06, Math.cos(a) * h * 0.05, shade(s.skin, 0.72));
    }
    put('ash', h * 0.06, headH * 0.12, h * 0.06, 0, crownY + headH * 0.16, 0, shade(s.skin, 0.76));
  }
  // ---- 头光 + 背屏 ----
  if (s.halo) {
    const hz = -h * 0.055;
    b.cyl('glow', headH * 0.95, headH * 0.95, 0.09, 16, X(0, hz), s.y + headY, Z(0, hz), s.halo, 0, Math.PI / 2, 0, true);
    b.cyl('glow', headH * 1.28, headH * 1.28, 0.06, 16, X(0, hz - 0.02), s.y + headY, Z(0, hz - 0.02), shade(s.halo, 0.7), 0, Math.PI / 2, 0, true);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      put('metal', 0.06, headH * 0.34, 0.05, Math.sin(a) * headH * 1.12, headY + Math.cos(a) * headH * 1.12, hz - 0.01, shade(MUD_GOLD, 0.7), -a);
    }
  }
  if (s.back) {
    put('lacquer', h * 0.46, h * 0.62, 0.10, 0, yb + h * 0.50, -h * 0.16, 0x5e1c1c);
    put('lacquer', h * 0.30, h * 0.16, 0.09, 0, yb + h * 0.86, -h * 0.16, 0x7a2626);
    put('metal', h * 0.10, h * 0.12, 0.08, 0, yb + h * 0.98, -h * 0.16, shade(MUD_GOLD, 0.9));
    for (const s2 of [-1, 1]) put('metal', h * 0.07, h * 0.10, 0.08, s2 * h * 0.16, yb + h * 0.90, -h * 0.16, shade(MUD_GOLD, 0.78), s2 * 0.35);
  }
  // ---- 持物 ----
  const holdY = torBot + torH * 0.42;
  const holdZ = dep * 0.62;
  if (s.hold === 'ruyi') {
    put('metal', 0.05, 0.05, h * 0.30, 0, holdY, holdZ + h * 0.05, shade(MUD_GOLD, 1.05), 0, 0.22);
    put('metal', 0.12, 0.12, 0.05, 0, holdY + h * 0.05, holdZ + h * 0.21, MUD_GOLD);
  } else if (s.hold === 'gui') {
    put('ash', h * 0.07, h * 0.26, 0.024, 0, yb + legH + torH * 0.30, holdZ, 0xdcd6c4, 0, -0.10);
    put('metal', h * 0.05, 0.03, 0.03, 0, yb + legH + torH * 0.44, holdZ, shade(MUD_GOLD, 0.8));
  } else if (s.hold === 'slip') {
    put('wood', h * 0.11, h * 0.24, 0.014, 0, yb + legH + torH * 0.34, holdZ, shade(0x8a6a3a, 1.1));
    for (let i = 0; i < 4; i++) put('wood', 0.012, h * 0.22, 0.016, -h * 0.04 + i * h * 0.026, yb + legH + torH * 0.34, holdZ - 0.006, shade(0x6b5230, 1.0));
  } else if (s.hold === 'lotus') {
    put('wood', 0.03, h * 0.22, 0.03, 0, yb + legH + torH * 0.24, holdZ, shade(0x4a6b3a, 1.1));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      put('fabric', 0.09, 0.03, 0.14, Math.sin(a) * 0.06, yb + legH + torH * 0.38, holdZ + Math.cos(a) * 0.06, 0xe6b8c8, a);
    }
    put('glow', 0.05, 0.05, 0.05, 0, yb + legH + torH * 0.40, holdZ, 0xffd8e4);
  } else if (s.hold === 'peach') {
    put('ash', h * 0.09, h * 0.08, h * 0.09, 0, yb + legH + torH * 0.30, holdZ, 0xe8a0a8);
    put('ash', h * 0.05, h * 0.04, h * 0.05, h * 0.03, yb + legH + torH * 0.34, holdZ + 0.02, 0xf0c0c4);
    put('wood', 0.02, 0.02, 0.06, 0, yb + legH + torH * 0.36, holdZ, 0x4a6b3a);
  }
  b.kit(s.kit, 1, s.y + sh + h * 0.5);
}

/** 山顶庙观台面标高：与 terrain.ts buildMountainTemple 同一取样（峰点 + 六向 70/50m 取最大）
 *  台基面 = gy + 0.7、三级台基顶 = gy + 2.25、殿身 1.7–6.7、殿顶 6.9 */
function templeDeck(mx: number, mz: number): { gy: number; plat: number; floorY: number } {
  let peak = terrainHeight(mx, mz);
  for (const [ox, oz] of [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70], [50, 50], [-50, -50]] as const) {
    peak = Math.max(peak, terrainHeight(mx + ox, mz + oz));
  }
  const gy = peak + 0.3;
  return { gy, plat: gy + 0.7, floorY: gy + 2.25 };
}

/** 献殿抱厦：既有山巅正殿（terrain.ts 16×5×10 实心殿身）前檐下接一间石柱敞廊，
 *  神像落在廊内殿心位——殿身是实心体，像必须落在可见的前廊才不是"藏进盒子里的假件"。 */
function shrinePorch(b: Baker, mx: number, mz: number, gy: number, w: number, roofC: number, trimC: number): number {
  const floor = gy + 2.25;
  const front = mz + 4.8;                 // 殿身前檐（殿身 10 深 → 前脸 mz+5）
  const d = 3.5;
  const cz = front + d / 2;
  // 廊台明（三级台基顶 24×17 收在 mz±8.5，台明不出台基边）
  b.box('ash', w + 1.2, 0.16, d + 0.3, mx, floor + 0.08, cz + 0.1, STONE_LT);
  // 踏跺：从台明面 2.16 逐级落到一级台基顶 1.2（五级，级高 0.21）
  for (let i = 0; i < 5; i++) {
    b.box('ash', w * 0.46, 0.21, 0.52, mx, floor - 0.11 - i * 0.21, front + d + 0.3 + i * 0.5, 0x8d8a80);
  }
  // 四根石柱 + 柱础
  for (const sx of [-1, 1]) {
    for (const fx of [0.14, 0.44]) {
      const px = mx + sx * w * fx;
      b.box('ash', 0.62, 0.16, 0.62, px, floor + 0.08, front + d - 0.35, 0x8a867a);
      b.cyl('ash', 0.20, 0.235, 3.55, 8, px, floor + 1.86, front + d - 0.35, shade(STONE_LT, 1.02));
      b.box('ash', 0.34, 0.18, 0.34, px, floor + 3.66, front + d - 0.35, 0x8a867a);
    }
  }
  // 阑额 + 斗子
  b.box('wood', w + 0.4, 0.24, 0.24, mx, floor + 3.62, front + d - 0.35, shade(C.woodRed, 0.92));
  for (const sx of [-1, 1]) b.box('wood', 0.22, 0.22, d, mx + sx * (w / 2 + 0.2), floor + 3.62, cz, shade(C.woodRed, 0.92));
  // 抱厦顶（低于正殿檐口 6.9，压在檐下）
  roofOn(b, w + 2.4, d + 2.6, floor + 3.95, mx, cz, 0, roofC, trimC, 1.35);
  b.box('glow', w + 0.6, 0.10, 0.10, mx, floor + 3.80, front + d - 0.3, trimC);
  return front + 1.4;
}

/** 云房（C-ITM-0323）：石木挂单道舍——石墙身 + 木前檐柱 + 瓦顶 + 门枕窗 */
function cloudRoom(b: Baker, x: number, y: number, z: number, ry: number, wallC: number, roofC: number, kit: string): void {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const P = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const put = (g: 'ash' | 'wood' | 'wall' | 'roof' | 'glow', w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number): void => {
    const [wx, wz] = P(lx, lz);
    b.box(g, w, h, d, wx, y + ly, wz, hex, ry);
  };
  const W = 5.4, D = 4.2, H = 2.5;
  put('ash', W + 0.8, 0.3, D + 0.8, 0, 0.15, 0, 0x8b887c);            // 台基
  put('wall', W, H, 0.34, 0, 0.30 + H / 2, -D / 2 + 0.17, wallC);     // 后墙
  for (const s of [-1, 1]) put('wall', 0.34, H, D, s * (W / 2 - 0.17), 0.30 + H / 2, 0, shade(wallC, 0.94));
  put('wall', W, 0.55, 0.30, 0, 0.57, D / 2 - 0.15, shade(wallC, 0.88));   // 前檐槛墙
  for (const s of [-1, 1]) put('wood', 0.20, H, 0.20, s * (W / 2 - 0.25), 0.30 + H / 2, D / 2 - 0.2, C.woodRed);
  put('wood', W, 0.20, 0.20, 0, 0.30 + H - 0.1, D / 2 - 0.2, shade(C.woodDark, 1.02));
  put('wood', 1.0, 1.6, 0.10, 0, 1.15, D / 2 - 0.28, 0x2a1c12);      // 板门
  put('glow', 0.62, 0.5, 0.05, W * 0.28, 1.62, D / 2 - 0.24, C.winGlow); // 窗
  put('wood', 0.72, 0.6, 0.06, W * 0.28, 1.62, D / 2 - 0.28, C.woodDark);
  roofOn(b, W + 1.8, D + 1.8, y + 0.30 + H + 0.12, x, z, ry, roofC, 0, 1.0);
  b.kit(kit, 1, y + 1.4);
}

/** 小体量砖木房（值事房 / 押粮官房 / 禅房）：台基 + 三面砖墙 + 前檐柱 + 柜台 + 瓦顶 */
function brickRoom(b: Baker, x: number, y: number, z: number, ry: number, w: number, d: number, hgt: number,
  wallC: number, roofC: number, kit: string): void {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const P = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const put = (g: 'ash' | 'wood' | 'wall' | 'roof' | 'glow' | 'metal', w2: number, h2: number, d2: number, lx: number, ly: number, lz: number, hex: number): void => {
    const [wx, wz] = P(lx, lz);
    b.box(g, w2, h2, d2, wx, y + ly, wz, hex, ry);
  };
  put('ash', w + 0.9, 0.30, d + 0.9, 0, 0.15, 0, 0x8b887c);                 // 台基
  put('ash', w + 0.5, 0.13, d + 0.5, 0, 0.36, 0, STONE_LT);                 // 台明
  const fy = 0.42;
  put('wall', w, hgt, 0.32, 0, fy + hgt / 2, -d / 2 + 0.16, wallC);          // 后墙
  for (const s of [-1, 1]) put('wall', 0.32, hgt, d, s * (w / 2 - 0.16), fy + hgt / 2, 0, shade(wallC, 0.95));
  for (const s of [-1, 1]) put('wood', 0.22, hgt, 0.22, s * (w / 2 - 0.24), fy + hgt / 2, d / 2 - 0.22, C.woodRed);
  put('wood', w, 0.22, 0.22, 0, fy + hgt - 0.11, d / 2 - 0.22, shade(C.woodDark, 1.04));   // 阑额
  put('wood', w * 0.86, 0.52, 0.26, 0, fy + 0.26, d / 2 - 0.14, shade(C.wood, 1.04));       // 柜台（柜脚落地，旧版 ly=fy+0.42 悬空 15cm）
  put('wood', w * 0.86 + 0.2, 0.10, 0.52, 0, fy + 0.57, d / 2 - 0.02, shade(C.wood, 1.16)); // 台面
  put('glow', 0.60, 0.62, 0.05, -w * 0.26, fy + hgt * 0.62, d / 2 - 0.24, C.winGlow);       // 窗
  put('wood', 0.72, 0.72, 0.06, -w * 0.26, fy + hgt * 0.62, d / 2 - 0.28, C.woodDark);
  put('wood', 1.05, 2.0, 0.10, w * 0.22, fy + 1.0, d / 2 - 0.26, 0x2a1c12);                 // 门（门槛落地，旧版底边悬空 42cm）
  roofOn(b, w + 1.7, d + 1.7, y + fy + hgt + 0.10, x, z, ry, roofC, 0, Math.min(w, d) * 0.22 + 0.45);
  b.kit(kit, 1, y + fy + hgt / 2);
}

/** 草亭（C-ITM-0313）：六柱攒尖茅顶——石台明、竹柱、阑额挂落、攒尖草顶、石桌 */
function thatchPavilion(b: Baker, x: number, z: number): void {
  const R = 3.0;
  b.box('ash', 6.6, 0.26, 6.6, x, 0.13, z, 0x8b887c);
  b.box('ash', 6.1, 0.12, 6.1, x, 0.32, z, STONE_LT);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = x + Math.sin(a) * R, pz = z + Math.cos(a) * R;
    b.cyl('ash', 0.24, 0.28, 0.18, 8, px, 0.44, pz, 0x82806f);
    b.cyl('wood', 0.13, 0.16, 2.85, 6, px, 1.92, pz, shade(0x8a6a3a, 1.02));
    b.box('wood', 0.22, 0.16, 0.22, px, 3.36, pz, shade(C.woodDark, 1.05));
  }
  // 阑额（六边形六段）
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + Math.PI / 6, a1 = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6;
    const dx = Math.sin(a1) - Math.sin(a0), dz = Math.cos(a1) - Math.cos(a0);
    b.box('wood', Math.hypot(dx, dz) * R, 0.18, 0.14, x + (Math.sin(a0) + Math.sin(a1)) / 2 * R, 3.24, z + (Math.cos(a0) + Math.cos(a1)) / 2 * R,
      shade(C.woodDark, 0.96), Math.atan2(-dz, dx));
    // 挂落（倒挂楣子）
    b.box('wood', Math.hypot(dx, dz) * R * 0.92, 0.26, 0.06, x + (Math.sin(a0) + Math.sin(a1)) / 2 * R, 3.02, z + (Math.cos(a0) + Math.cos(a1)) / 2 * R,
      shade(C.wood, 1.06), Math.atan2(-dz, dx));
  }
  // 攒尖茅顶：六棱锥 + 顶簪 + 茅草束
  b.cyl('roof', 0.16, R + 1.05, 2.15, 6, x, 4.42, z, 0x9a8a52);
  b.cyl('roof', 0.10, R + 0.55, 0.42, 6, x, 3.78, z, 0x8a7a46);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box('roof', 0.22, 0.10, 0.62, x + Math.sin(a) * (R + 0.82), 3.42, z + Math.cos(a) * (R + 0.82), 0x877741, a, 0.22);
  }
  b.cyl('wood', 0.10, 0.10, 0.5, 6, x, 5.62, z, shade(C.woodDark, 1.1));
  b.box('glow', 0.14, 0.16, 0.14, x, 5.9, z, C.neonGreen);
  // 亭内石桌
  b.cyl('ash', 0.52, 0.60, 0.14, 12, x, 0.86, z, STONE_LT);
  b.cyl('ash', 0.26, 0.30, 0.62, 10, x, 0.48, z, STONE_DK);
  b.kit('city.thatchedPavilion', 1, 2.2);
}

/** 碑亭（C-ITM-0210）：石木「京城寶剎」碑——石台基、四石柱、石阑额、瓦顶、碑座碑身碑首 */
function stelePavilion(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number): void {
  b.box('ash', 5.8, 0.34, 5.8, x, 0.17, z, 0x8b887c);
  b.box('ash', 5.2, 0.14, 5.2, x, 0.41, z, STONE_LT);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * 1.9, pz = z + sz * 1.9;
    b.box('ash', 0.66, 0.20, 0.66, px, 0.58, pz, 0x8a867a);
    b.cyl('ash', 0.21, 0.25, 2.9, 8, px, 2.13, pz, shade(STONE_LT, 1.0));
    b.box('ash', 0.36, 0.18, 0.36, px, 3.66, pz, 0x8a867a);
  }
  for (const s of [-1, 1]) {
    b.box('ash', 4.3, 0.26, 0.24, x, 3.68, z + s * 1.9, 0x94907f);
    b.box('ash', 0.24, 0.26, 4.3, x + s * 1.9, 3.68, z, 0x94907f);
  }
  roofOn(b, 7.2, 7.2, 3.92, x, z, 0, shade(C.tile, 1.05), C.neonCyan, 1.5);
  b.cyl('metal', 0.12, 0.18, 0.34, 8, x, 5.5, z, shade(GILT, 0.7));
  // 碑：龟趺 + 碑身 + 碑首
  b.box('ash', 2.1, 0.28, 1.3, x, 0.62, z, 0x8d8a80);
  b.box('ash', 1.5, 0.34, 1.0, x, 0.91, z, STONE_LT);                       // 龟趺座
  b.box('ash', 0.9, 0.18, 0.62, x, 1.14, z + 0.34, 0x87836f);               // 龟首
  b.box('ash', 1.06, 1.9, 0.30, x, 2.14, z, 0x9a9789);                      // 碑身
  b.box('ash', 1.28, 0.22, 0.42, x, 3.20, z, 0x8d8a80);                     // 碑首
  b.box('ash', 1.44, 0.14, 0.52, x, 3.36, z, STONE_LT);
  sg.quad(atlas.text('stele_jingcheng', '京城寶剎', 200, 320, { color: '#2a2118', vertical: true, fontPx: 62, bg: 'rgba(228,220,200,0.96)', border: 'rgba(110,100,82,.9)' }), 0.86, 1.72, x, 2.14, z + 0.17, 0);
  b.kit('temple.stelePavilion', 1, 2.1);
}

/** 泊位（C-ITM-0219 / C-ITM-0394）：汴河粮船——船底、两舷、甲板、船首尾起翘、拱篷、桅、舵、粮袋、缆 */
function grainBoat(b: Baker, x: number, z: number, ry: number, seed: number, laden: boolean): void {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const X = (lx: number, lz: number): number => x + lx * cos + lz * sin;
  const Z = (lx: number, lz: number): number => z - lx * sin + lz * cos;
  const put = (g: 'wood' | 'roof' | 'fabric' | 'metal' | 'ash', w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, rz = 0, rx = 0): void => {
    b.box(g, w, h, d, X(lx, lz), ly, Z(lx, lz), hex, ry, rx, rz);
  };
  // 船底吃水 0.35：水面 y=1.0
  put('wood', 8.8, 0.78, 2.5, 0, 0.72, 0, shade(C.wood, 0.8));
  for (const s of [-1, 1]) {
    put('wood', 8.4, 0.56, 0.20, 0, 1.44, s * 1.30, shade(C.wood, 0.94));
    put('wood', 8.6, 0.10, 0.26, 0, 1.74, s * 1.30, shade(C.woodDark, 1.1));   // 舷顶压条
  }
  put('wood', 8.2, 0.14, 2.44, 0, 1.52, 0, shade(C.wood, 1.08));               // 甲板
  // 船首/船尾起翘
  put('wood', 1.7, 0.16, 2.1, 4.55, 1.62, 0, shade(C.wood, 1.02), 0, -0.30);
  put('wood', 1.5, 0.16, 2.0, -4.5, 1.62, 0, shade(C.wood, 0.98), 0, 0.28);
  put('wood', 0.5, 0.34, 1.9, 5.3, 1.86, 0, shade(C.woodDark, 1.05));          // 船首挡板
  // 拱篷（半没入船体的圆筒，读成舱篷）
  b.cyl('roof', 0.92, 0.92, 2.9, 8, X(-0.4, 0), 1.52, Z(-0.4, 0), shade(C.tile, 1.1), ry, 0, Math.PI / 2);
  b.cyl('wood', 0.96, 0.96, 0.10, 8, X(-1.85, 0), 1.52, Z(-1.85, 0), shade(C.woodDark, 1.0), ry, 0, Math.PI / 2);
  b.cyl('wood', 0.96, 0.96, 0.10, 8, X(1.05, 0), 1.52, Z(1.05, 0), shade(C.woodDark, 1.0), ry, 0, Math.PI / 2);
  // 桅杆 + 横桁 + 卷帆
  put('wood', 0.16, 6.2, 0.16, 1.5, 4.6, 0, shade(C.woodDark, 1.05));
  put('wood', 0.10, 0.10, 2.9, 1.5, 7.3, 0, shade(C.woodDark, 1.0));
  put('fabric', 0.26, 0.30, 2.4, 1.5, 6.7, 0, 0x9d8a6a);
  // 舵 + 橹
  put('wood', 0.16, 1.9, 0.9, -5.2, 1.2, 0, shade(C.woodDark, 0.95), 0, 0.16);
  for (const s of [-1, 1]) put('wood', 3.2, 0.09, 0.09, -1.8, 2.2, s * 1.5, shade(C.wood, 0.9), 0.1, 0);
  // 粮袋（漕船满载）
  if (laden) {
    for (let i = 0; i < 6; i++) {
      const lx = -2.6 + (i % 3) * 1.05, lz = i < 3 ? -0.55 : 0.55;
      put('fabric', 0.92, 0.62, 0.86, lx, 1.90 + (seed + i) % 2 * 0.05, lz, 0x9a8a63);
      put('wood', 0.98, 0.06, 0.92, lx, 2.22, lz, 0x7a6a48);
    }
  }
  // 缆绳：船首系在舷侧桩上（盘绳一圈）
  put('fabric', 0.52, 0.12, 0.52, 3.55, 1.66, 0.85, 0x8a7a5a);
  put('fabric', 0.40, 0.10, 0.40, 3.55, 1.76, 0.85, 0x7a6a48);
  b.kit(laden ? 'city.grainBoat' : 'city.transferBoat', 1, 1.5);
}

/** 岸线泊位硬件：系船桩两颗 + 跳板 + 泊位石墩（落在 |z|=31.2 的岸墙压顶上，压顶面 1.37） */
function berthHardware(b: Baker, x: number, zBank: number, dir: number, kit: string): void {
  for (const s of [-1, 1]) {
    const px = x + s * 2.9;
    b.box('ash', 0.62, 0.16, 0.62, px, 1.45, zBank, 0x77746a);
    b.cyl('wood', 0.15, 0.20, 1.15, 8, px, 2.10, zBank, shade(0x5e3e22, 1.02));
    b.cyl('metal', 0.17, 0.17, 0.08, 10, px, 2.70, zBank, 0x4a4e54);
    for (const yy of [1.90, 2.35]) b.cyl('metal', 0.19, 0.19, 0.06, 10, px, yy, zBank, 0x555a60);
    b.box('wood', 0.62, 0.12, 0.12, px, 2.52, zBank, shade(0x4a3220, 1.06));
  }
  // 跳板：岸顶 1.37 → 甲板 1.6，板宽 0.62，探向水面
  b.box('wood', 0.66, 0.10, 3.1, x, 1.48, zBank - dir * 1.5, 0x8a6a3a, 0, dir * 0.09);
  b.box('wood', 0.70, 0.06, 0.24, x, 1.42, zBank - dir * 0.06, shade(C.woodDark, 1.0));
  b.kit(kit, 1, 1.9);
}

/** 云桥（C-ITM-0358）：瑶池上玉木小拱桥——池沿、拱板逐段起拱、两侧寻杖望柱、桥台 */
function cloudBridge(b: Baker, mx: number, mz: number, plat: number): void {
  const z0 = mz + 10.2, z1 = mz + 18.2;
  const span = z1 - z0;
  const top = plat + 0.34;
  // 瑶池：池沿 + 水面（桥下这一段是过桥的池身）
  b.box('ash', 15.0, 0.36, 9.4, mx, plat + 0.18, (z0 + z1) / 2, 0xc9c4b4);
  b.box('ash', 14.2, 0.10, 8.6, mx, plat + 0.30, (z0 + z1) / 2, 0xd8d3c4);
  b.box('water', 13.4, 0.06, 7.8, mx, plat + 0.28, (z0 + z1) / 2, 0x2a6d78);
  // 拱板：12 段按正弦起拱
  const N = 12, segL = span / N;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const y0 = top + Math.sin(Math.PI * t0) * 1.05, y1 = top + Math.sin(Math.PI * t1) * 1.05;
    const zc = z0 + (t0 + t1) / 2 * span;
    const dy = y1 - y0, dz = segL;
    b.box('ash', 2.4, 0.16, Math.hypot(dy, dz) + 0.06, mx, (y0 + y1) / 2, zc, 0xe8e4d8, 0, -Math.atan2(dy, dz), 0);
    // 桥板缝
    b.box('ash', 2.44, 0.05, 0.08, mx, (y0 + y1) / 2 + 0.09, zc + segL * 0.5, 0xd6d1c2);
  }
  // 两侧寻杖 + 望柱 + 拱肋
  for (const s of [-1, 1]) {
    for (let i = 0; i <= N; i += 2) {
      const t = i / N;
      const y = top + Math.sin(Math.PI * t) * 1.05;
      const pz = z0 + t * span;
      b.box('ash', 0.16, 0.78, 0.16, mx + s * 1.12, y + 0.42, pz, 0xe8e4d8);
      b.box('ash', 0.22, 0.10, 0.22, mx + s * 1.12, y + 0.84, pz, 0xf2efe6);
    }
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const y0 = top + Math.sin(Math.PI * t0) * 1.05, y1 = top + Math.sin(Math.PI * t1) * 1.05;
      b.box('ash', 0.12, 0.10, Math.hypot(y1 - y0, segL), mx + s * 1.12, (y0 + y1) / 2 + 0.76, z0 + (t0 + t1) / 2 * span, 0xe8e4d8, 0, -Math.atan2(y1 - y0, segL), 0);
      // 拱肋（桥腹）
      b.box('ash', 0.26, 0.30, Math.hypot(y1 - y0, segL), mx + s * 1.05, (y0 + y1) / 2 - 0.22, z0 + (t0 + t1) / 2 * span, 0xd8d3c2, 0, -Math.atan2(y1 - y0, segL), 0);
    }
  }
  // 两端桥台
  for (const sz of [0, 1]) {
    const pz = sz === 0 ? z0 - 0.55 : z1 + 0.55;
    b.box('ash', 3.2, 0.7, 1.3, mx, top - 0.05, pz, 0xdcd7c6);
    b.box('ash', 3.5, 0.16, 1.5, mx, top + 0.30, pz, 0xece8dc);
  }
  b.kit('temple.cloudBridge', 1, top + 0.6);
}

/** 云海观台（C-ITM-0336）：峰沿石台——台面、望柱栏板、踏跺、观景石案 */
function cloudSeaTerrace(b: Baker, x: number, z: number, plat: number): void {
  const W = 9.4, D = 7.2;
  b.box('ash', W, 0.62, D, x, plat + 0.31, z, 0x8d8a80);
  b.box('ash', W - 0.5, 0.14, D - 0.5, x, plat + 0.67, z, STONE_LT);
  // 三面栏板（临崖三面）+ 望柱
  const railY = plat + 0.74;
  for (const [w2, d2, ox, oz] of [[W, 0.24, 0, -D / 2], [0.24, D, -W / 2, 0], [0.24, D, W / 2, 0]] as const) {
    b.box('ash', w2, 0.72, d2, x + ox, railY + 0.36, z + oz, 0xd2cdbd);
    b.box('ash', w2 + 0.14, 0.12, d2 + 0.14, x + ox, railY + 0.76, z + oz, 0xf2efe6);
  }
  for (const [ox, oz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [-W / 2, 0], [W / 2, 0], [0, -D / 2]] as const) {
    b.box('ash', 0.34, 1.15, 0.34, x + ox, railY + 0.58, z + oz, 0xe2ddd0);
    b.box('ash', 0.42, 0.14, 0.42, x + ox, railY + 1.20, z + oz, 0xf2efe6);
  }
  // 踏跺（朝殿）
  for (let i = 0; i < 2; i++) b.box('ash', 3.0, 0.19, 0.55, x, plat + 0.40 - i * 0.19, z + D / 2 + 0.42 + i * 0.55, 0x8d8a80);
  // 观景石案 + 铜盘
  b.box('ash', 1.5, 0.72, 0.8, x, plat + 1.08, z - 1.2, STONE_LT);
  b.cyl('metal', 0.34, 0.28, 0.14, 12, x, plat + 1.50, z - 1.2, shade(BRONZE, 1.1));
  b.box('glow', 1.1, 0.08, 0.08, x, plat + 1.42, z - 1.2, C.neonGold);
  b.kit('temple.cloudSeaTerrace', 1, plat + 0.8);
}

/** 铁瓦殿面（C-ITM-0334）：衡山祝融殿黑铁瓦——同形铁壳整个包住既有瓦面 + 正脊鸱吻 + 四条垂脊 + 铁檐口 */
function ironRoof(b: Baker, mx: number, mz: number, gy: number): void {
  const y = gy + 6.9;                       // 既有 roofOn 起坡面
  const h = 12 * 0.2 + 0.45;                // 既有脊高 2.85
  const sw = 18.5 * 0.905 * 1.02 * 1.07;    // 既有壳宽 17.08 → 外扩 7%
  const sd = 12 * 0.905 * 1.02 * 1.07;
  const sy = (h * 1.06 + 0.72);
  b.roofC('metal', mx, y + 0.30, mz, 0x262a2e, 0, sw, sy, sd);
  // 正脊 + 两端鸱吻
  b.box('metal', sw * 0.62, 0.36, 0.52, mx, y + 0.30 + sy + 0.10, mz, 0x1e2226);
  b.box('metal', sw * 0.66, 0.12, 0.62, mx, y + 0.30 + sy + 0.30, mz, 0x2e343a);
  for (const s of [-1, 1]) {
    b.box('metal', 0.5, 1.05, 0.46, mx + s * sw * 0.31, y + 0.30 + sy + 0.62, mz, 0x1e2226, 0, 0, -s * 0.34);
    b.box('metal', 0.36, 0.34, 0.40, mx + s * sw * 0.34, y + 0.30 + sy + 1.16, mz, 0x2a3036, 0, 0, -s * 0.9);
  }
  // 四条垂脊：脊端 → 檐角
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x0 = mx + sx * sw * 0.30, z0 = mz + sz * 0.6, y0 = y + 0.30 + sy - 0.1;
    const x1 = mx + sx * sw * 0.52, z1 = mz + sz * sd * 0.50, y1 = y + 0.42;
    const dx = x1 - x0, dz = z1 - z0, dy = y1 - y0;
    const len = Math.hypot(dx, dz, dy);
    b.box('metal', len, 0.20, 0.26, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0x1e2226, Math.atan2(-dz, dx), 0, Math.atan2(dy, Math.hypot(dx, dz)));
  }
  // 铁檐口：四面一圈压檐板 + 滴水
  for (const s of [-1, 1]) {
    b.box('metal', sw * 0.99, 0.14, 0.20, mx, y + 0.40, mz + s * sd * 0.48, 0x30363c);
    b.box('metal', 0.20, 0.14, sd * 0.99, mx + s * sw * 0.48, y + 0.40, mz, 0x30363c);
  }
  b.kit('temple.ironRoof', 1, y + 1.6);
}

/** 祭台（C-ITM-0373）：敖包前牛羊供案——三级石台、木供案、牛羊牲、铜盘、香炉、长明灯 */
function offeringAltar(b: Baker, x: number, z: number, y: number): void {
  b.box('ash', 5.2, 0.34, 4.0, x, y + 0.17, z, 0x8b887c);
  b.box('ash', 4.6, 0.30, 3.4, x, y + 0.49, z, 0x8d8a80);
  b.box('ash', 4.0, 0.26, 2.9, x, y + 0.77, z, STONE_LT);
  const top = y + 0.90;
  // 木供案
  b.box('wood', 2.9, 0.14, 1.15, x, top + 0.62, z, shade(C.wood, 1.06));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.16, 0.62, 0.16, x + sx * 1.28, top + 0.31, z + sz * 0.44, C.woodDark);
  b.box('wood', 3.1, 0.12, 0.18, x, top + 0.72, z - 0.5, shade(C.woodDark, 1.1));
  // 牛羊牲（青铜小像：身 + 头 + 角 + 四足），伏在案面上（案面 top+0.69）
  for (const [sx, ox] of [[-1, -0.82], [1, 0.82]] as const) {
    const cy = top + 0.86, cz = z + 0.05;
    b.box('metal', 0.86, 0.34, 0.46, x + ox, cy, cz, sx < 0 ? 0x8a7a52 : 0x9a8a5e);
    b.box('metal', 0.30, 0.26, 0.32, x + ox + sx * 0.52, cy + 0.08, cz + 0.02, shade(0x8a7a52, 1.08));
    for (const t of [-1, 1]) b.box('metal', 0.06, 0.22, 0.06, x + ox + sx * 0.56, cy + 0.30, cz + t * 0.10, 0xb0a070, 0, 0, sx * 0.5);
    for (const dx2 of [-0.28, 0.28]) for (const dz2 of [-0.16, 0.16]) b.box('metal', 0.07, 0.16, 0.07, x + ox + dx2, top + 0.76, cz + dz2, 0x7a6a48);
  }
  // 铜盘 + 香炉
  b.cyl('metal', 0.34, 0.30, 0.10, 12, x, top + 0.74, z + 0.28, shade(BRONZE, 1.1));
  b.cyl('metal', 0.30, 0.22, 0.44, 10, x, top + 0.22, z + 1.30, shade(0x4a453c, 1.0));
  b.box('glow', 0.30, 0.10, 0.30, x, top + 0.46, z + 1.30, 0xff7a3c);
  for (let i = 0; i < 3; i++) b.cyl('wood', 0.02, 0.02, 0.34, 5, x - 0.08 + i * 0.08, top + 0.66, z + 1.30, 0x6b5230, 0, 0.2);
  // 两侧长明灯
  for (const s of [-1, 1]) {
    b.cyl('ash', 0.20, 0.26, 0.90, 8, x + s * 1.9, top - 0.06, z, STONE_DK);
    b.cyl('metal', 0.22, 0.16, 0.26, 8, x + s * 1.9, top + 0.52, z, shade(BRONZE, 0.9));
    b.box('glow', 0.18, 0.22, 0.18, x + s * 1.9, top + 0.72, z, 0xffb300);
  }
  b.kit('temple.offeringAltar', 1, top);
}

/** 夯土残墙（C-ITM-0302）：x=462 线旧垣——夯层墙体、残高 2–4m、塌垛口、三处通行豁口、墙根夯土堆 */
function ruinedRampart(b: Baker, zFrom: number, zTo: number, gaps: number[]): void {
  const x = 462;
  let segs = 0;
  for (let z = zFrom; z < zTo - 0.5; z += 6) {
    const zc = z + 3;
    const inGap = gaps.some((g) => Math.abs(zc - g) < 3.1);
    if (inGap) continue;
    // 残高起伏（2.0–4.0），用坐标哈希做确定性变化
    const k = ((Math.round(z) * 2654435761) >>> 0) % 1000 / 1000;
    const hgt = 2.0 + k * 2.0;
    // 每段分三截砌：一截塌口（真锯口，不是贴一块深色方块），顶面高差做出残垣断口
    const notchAt = 1 + (Math.round(z * 7) % 2);
    const pl = 6.1 / 3;
    for (let i = 0; i < 3; i++) {
      const pz = zc - 3.05 + pl * (i + 0.5);
      const drop = i === notchAt ? 0.85 + k * 0.75 : (i === 0 ? 0.12 : 0.28);
      const ph = Math.max(0.9, hgt - drop);
      b.box('earth', 3.4, ph, pl + 0.02, x, ph / 2, pz, shade(0xa89070, 0.9 + k * 0.12 + i * 0.02));
      // 夯层线（每 0.4m 一道，随该截残高收头）
      for (let c = 1; c * 0.4 < ph - 0.1; c++) b.box('earth', 3.46, 0.05, pl + 0.02, x, c * 0.4, pz, shade(0x8a7454, 0.95));
    }
    // 墙根塌土
    b.box('earth', 1.4, 0.28, 6.1, x + 2.1, 0.14, zc, 0x9a8464);
    segs++;
  }
  // 段端收头（断口做圆钝）
  for (const ze of [zFrom, zTo - 0.6]) {
    b.box('earth', 3.2, 1.6, 1.2, x, 0.8, ze, 0x9a8464);
  }
  b.kit('city.rammedRuins', segs, 1.6);
}

/**
 * WS-40 总装（22 件 + 塔 3 件在 buildPagoda）。
 */
export function buildDevotionalWorks(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // 三清像：C-ITM-0169 —— 上清觀三清殿殿心（殿前抱厦，殿身是实心体，像落廊内殿心位）
  {
    const hx = 540;                      // 上清觀（540, 118）殿前
    const floor = 0.5;
    // 抱厦：台明 + 六柱 + 阑额 + 悬山小顶
    b.box('ash', 14.2, 0.50, 7.2, hx, 0.25, 128, 0x8b887c);
    b.box('ash', 13.4, 0.14, 6.6, hx, 0.57, 128, STONE_LT);
    for (const sx of [-1, 1]) for (const fx of [0.18, 0.44]) {
      const px = hx + sx * 13.4 * fx;
      b.cyl('ash', 0.20, 0.24, 0.16, 8, px, 0.62, 130.6, 0x82806f);
      b.cyl('wood', 0.18, 0.22, 3.30, 8, px, 2.35, 130.6, shade(C.woodRed, 1.02));
      b.box('wood', 0.34, 0.16, 0.34, px, 3.92, 130.6, C.woodDark);
    }
    for (const s of [-1, 1]) b.box('wood', 0.20, 3.30, 0.20, hx + s * 6.4, 2.35, 125.2, shade(C.woodRed, 0.94));
    b.box('wood', 13.0, 0.26, 0.22, hx, 3.92, 130.6, shade(C.woodDark, 1.05));
    b.box('wood', 13.0, 0.26, 0.22, hx, 3.92, 125.4, shade(C.woodDark, 1.05));
    roofOn(b, 15.0, 8.4, 4.06, hx, 128, 0, shade(C.tile, 1.06), C.neonCyan, 1.4);
    // 三清：玉清（中·持如意）/ 上清（东·持圭）/ 太清（西·持简）
    deity(b, { x: hx, y: floor + 0.14, z: 129.2, h: 2.35, robe: 0x7a2f28, skin: MUD_GOLD, crown: 'dao', halo: 0xffd25e, back: true, hold: 'ruyi', mudra: 'dhyana', kit: 'temple.sanqingYuqing' });
    deity(b, { x: hx - 4.1, y: floor + 0.14, z: 129.0, h: 2.30, robe: 0x2f4a6b, skin: MUD_GOLD, crown: 'dao', halo: 0xffd25e, back: true, hold: 'gui', mudra: 'dhyana', kit: 'temple.sanqingShangqing' });
    deity(b, { x: hx + 4.1, y: floor + 0.14, z: 129.0, h: 2.30, robe: 0x3a5a3a, skin: MUD_GOLD, crown: 'dao', halo: 0xffd25e, back: true, hold: 'slip', mudra: 'dhyana', kit: 'temple.sanqingTaiqing' });
  }

  // 碑亭：C-ITM-0210 —— 开宝寺塔塔院塔前西院，「京城寶剎」碑
  stelePavilion(b, sg, atlas, 524, 180);

  // 漕船泊位：C-ITM-0219 —— 汴河码头河沿 3 位（船在 z=28 水面，桩在 z=31.2 岸线）
  for (const bx of [-196, -180, -164] as const) {
    grainBoat(b, bx, 28.0, Math.PI, bx, true);
    berthHardware(b, bx, 31.2, 1, 'city.berthGear');
  }

  // 值事房（东市）：C-ITM-0230 —— 东市市楼东侧 2 间
  // 值事房（西市）：C-ITM-0250 —— 西市市楼东侧 2 间
  for (const [mx, key] of [[2800, 'city.clerkHouseEast'], [-2800, 'city.clerkHouseWest']] as const) {
    for (const bz of [896.2, 903.8] as const) {
      brickRoom(b, mx + 12.6, 0.24, bz, -Math.PI / 2, 5.0, 3.6, 2.5, shade(C.wallGray, 1.02), shade(C.tile, 1.08), key);
      b.box('glow', 0.22, 0.30, 0.22, mx + 10.2, 3.05, bz - 1.2, C.lantern);
      b.box('wood', 0.06, 0.5, 0.06, mx + 10.2, 3.4, bz - 1.2, C.woodDark);
    }
  }

  // 夯土残墙：C-ITM-0302 —— x=462 旧城墙遗址段（两端延伸段，三处豁口）
  ruinedRampart(b, -424, -196, [-352, -268]);
  ruinedRampart(b, 406, 430, [418]);

  // 草亭：C-ITM-0313 —— 郊野柳林茶亭 林缘六柱攒尖
  // 2026-11-01 巡检修复「亭顶穿出树冠、无可见树干」：原落位 (−450, 78) 与
  // actors/heroes.ts 的 ANCHORS.tree（鲁智深倒拔垂杨柳，运行时 Group `willow_uprooted`）
  // **完全同坐标**——树干被六柱亭身包住，5 片冠筒（半径 1.6、中心 y≈4.2）从茅顶正中穿出。
  // 亭子西移 12m 让开；柳树另行南移到 (−450, 80.5) 站到院墙外（见 heroes.ts 该行注释），
  // 两者现在相距 12m、互不穿插，柳干从地面到冠底完整可见。
  thatchPavilion(b, -462, 78);

  // ---- 七山庙观：神像 / 云房 / 禅席 / 云桥 / 铁瓦 / 观台 / 祭台 ----
  // 碧霞元君像：C-ITM-0320 —— 泰山（14000,−6000）元君殿殿心，凤冠霞帔
  {
    const m = { x: 14000, z: -6000 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 11.0, 0x4e7a5e, 0xffd25e);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.15, robe: 0xa63a2b, skin: MUD_GOLD, crown: 'phoenix', halo: 0xffd25e, back: true, hold: 'gui', mudra: 'dhyana', kit: 'temple.bixiaYuanjun' });
    // 云房：C-ITM-0323 —— 东西配挂单道舍 ×4
    for (const sx of [-1, 1]) {
      for (const oz of [-12, -17] as const) {
        cloudRoom(b, m.x + sx * 13, dk.plat, m.z + oz, -sx * Math.PI / 2, shade(C.plaster, 0.94), 0x4e7a5e, 'temple.cloudRoom');
      }
    }
  }
  // 镇江王像：C-ITM-0327 —— 华山（−15000,4000）镇江王庙大殿殿心，冕旒持圭
  {
    const m = { x: -15000, z: 4000 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 10.0, 0x3b4045, 0x00e5ff);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.25, robe: 0x2f4a6b, skin: CLAY_GREY, crown: 'beads', halo: 0x00e5ff, back: true, hold: 'gui', mudra: 'dhyana', kit: 'temple.zhenjiangWang' });
  }
  // 祝融像：C-ITM-0333 —— 衡山（2000,16500）祝融殿殿心，赤衣执简立像
  {
    const m = { x: 2000, z: 16500 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 10.0, 0x3a6b8c, 0xff9e00);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.55, seated: false, robe: 0xa63a2b, skin: CAST_BRONZE, crown: 'dao', halo: 0xff9e00, back: true, hold: 'slip', mudra: 'none', kit: 'temple.zhurong' });
    // 铁瓦殿面：C-ITM-0334 —— 殿顶黑瓦覆面（铁壳包住既有瓦面 + 正脊鸱吻 + 四条垂脊）
    ironRoof(b, m.x, m.z, dk.gy);
    // 云海观台：C-ITM-0336 —— 峰沿露天石台
    cloudSeaTerrace(b, m.x + 23, m.z + 15, dk.plat);
  }
  // 北岳大帝像：C-ITM-0339 —— 恒山（−3500,−16200）北岳庙大殿殿心，冕服持圭
  {
    const m = { x: -3500, z: -16200 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 10.0, 0x454b52, 0xffb300);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.30, robe: 0x2a3a4a, skin: MUD_GOLD, crown: 'beads', halo: 0xffb300, back: true, hold: 'gui', mudra: 'dhyana', kit: 'temple.beiyueDadi' });
  }
  // 中岳大帝像：C-ITM-0345 —— 嵩山（9500,10500）中岳庙大殿殿心，冕十二旒
  {
    const m = { x: 9500, z: 10500 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 10.0, 0x3b4045, 0xb8ff2e);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.35, robe: 0x6b2a20, skin: MUD_GOLD, crown: 'beads', halo: 0xb8ff2e, back: true, hold: 'gui', mudra: 'dhyana', kit: 'temple.zhongyueDadi' });
  }
  // 大雄殿佛坐像：C-ITM-0352 —— 天山（−22000,−16000）雪帘禅院大雄殿殿心，铜漆坐像
  {
    const m = { x: -22000, z: -16000 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 10.0, 0xe8ecf2, 0x00e5ff);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.20, robe: BRONZE_LAC, skin: BRONZE_LAC, crown: 'none', halo: 0xffd25e, back: false, hold: 'lotus', mudra: 'earth', kit: 'temple.buddhaSeated' });
    // 禅房坐席：C-ITM-0355 —— 禅房四席（蒲草坐禅位）
    const zx = m.x + 13, zz = m.z - 9;
    const fy = dk.plat;
    b.box('ash', 7.0, 0.28, 5.2, zx, fy + 0.14, zz, 0x8b887c);
    b.box('wall', 6.4, 2.3, 0.3, zx, fy + 1.43, zz - 2.4, shade(C.plaster, 0.96));
    for (const s of [-1, 1]) b.box('wall', 0.3, 2.3, 4.8, zx + s * 3.05, fy + 1.43, zz, shade(C.plaster, 0.92));
    for (const s of [-1, 1]) for (const t of [-1, 1]) b.cyl('wood', 0.16, 0.19, 2.3, 8, zx + s * 2.95, fy + 1.43, zz + t * 2.3, shade(C.woodRed, 0.98));
    b.box('wood', 6.4, 0.2, 0.2, zx, fy + 2.48, zz + 2.3, shade(C.woodDark, 1.02));
    roofOn(b, 7.6, 6.0, fy + 2.62, zx, zz, 0, 0xe8ecf2, 0x00e5ff, 1.1);
    // 四席：蒲团 + 坐台 + 香炉 + 灯
    for (let i = 0; i < 4; i++) {
      const px = zx - 2.2 + (i % 2) * 4.4, pz = zz - 1.2 + Math.floor(i / 2) * 2.4;
      b.box('wood', 1.5, 0.16, 1.1, px, fy + 0.36, pz, shade(C.woodDark, 1.02));
      b.cyl('fabric', 0.52, 0.58, 0.18, 12, px, fy + 0.52, pz, 0xb09a5e);
      b.cyl('fabric', 0.44, 0.44, 0.06, 12, px, fy + 0.63, pz, 0xc4ae72);
      b.box('glow', 0.3, 0.06, 0.3, px, fy + 0.30, pz + 0.42, 0xffb300);
    }
    b.cyl('metal', 0.24, 0.18, 0.3, 10, zx, fy + 0.43, zz - 2.1, shade(0x4a453c, 1.0));
    b.box('glow', 0.16, 0.12, 0.16, zx, fy + 0.62, zz - 2.1, 0xff7a3c);
    b.kit('temple.zenSeat', 4, fy + 0.5);
  }
  // 西王母像：C-ITM-0360 —— 昆仑（−27000,4000）瑶池行宫王母殿殿心，玉塑凤冠金帔
  {
    const m = { x: -27000, z: 4000 };
    const dk = templeDeck(m.x, m.z);
    const sz = shrinePorch(b, m.x, m.z, dk.gy, 10.0, 0x3a6b8c, 0xd8b0ff);
    deity(b, { x: m.x, y: dk.floorY + 0.16, z: sz, h: 2.30, robe: 0xe8e4da, skin: JADE_WHITE, crown: 'phoenix', halo: 0xd8b0ff, back: true, hold: 'peach', mudra: 'dhyana', kit: 'temple.xiwangmu' });
    // 云桥：C-ITM-0358 —— 瑶池上玉木小拱桥
    cloudBridge(b, m.x, m.z, dk.plat);
  }

  // 祭台：C-ITM-0373 —— 草原敖包（1500,−10500）包前，牛羊供案
  offeringAltar(b, 1500, -10500 + 5.6, terrainSurfaceY(1500, -10500 + 5.6));

  // 转运漕船泊位：C-ITM-0394 —— 汴河船闸（x=−296）闸外 4 位
  for (const bx of [-318, -336, -354, -372] as const) {
    grainBoat(b, bx, 28.0, 0, bx, false);
    berthHardware(b, bx, 31.2, 1, 'city.transferBerthGear');
  }

  // 押粮官房：C-ITM-0400 —— 金耀门漕运仓仓西（4626, 120），文书官房
  {
    const fy = terrainSurfaceY(4626, 120);
    brickRoom(b, 4626, fy, 120, Math.PI / 2, 6.2, 5.0, 2.7, shade(C.wallGray, 1.04), shade(C.tile, 1.06), 'city.grainOfficerRoom');
    // 官房器物：文书案（透过敞门可见）、卷宗架、印匣、仓号木牌。房间朝 +x，家具按世界轴排（长边沿 z）
    const floorY = fy + 0.42;
    b.box('wood', 0.86, 0.12, 1.7, 4627.55, floorY + 0.78, 121.3, shade(C.wood, 1.08));       // 案面
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      b.box('wood', 0.13, 0.74, 0.13, 4627.55 + sx * 0.3, floorY + 0.37, 121.3 + sz * 0.72, C.woodDark);
    }
    b.box('wood', 0.10, 0.62, 1.5, 4627.18, floorY + 0.36, 121.3, C.woodDark);                 // 案挡板
    b.box('lacquer', 0.26, 0.22, 0.34, 4627.62, floorY + 0.95, 120.62, 0x2a1c12);              // 印匣
    b.box('metal', 0.10, 0.06, 0.10, 4627.62, floorY + 1.09, 120.62, shade(GILT, 0.7));
    for (let i = 0; i < 3; i++) {                                                              // 卷宗架
      b.box('wood', 0.55, 0.08, 1.3, 4625.1, floorY + 0.10 + i * 0.42, 120.3, shade(C.wood, 0.94 + i * 0.05));
    }
    for (const sz of [-1, 1]) b.box('wood', 0.12, 1.3, 0.12, 4625.1, floorY + 0.65, 120.3 + sz * 0.6, C.woodDark);
    b.box('wood', 0.06, 1.5, 0.34, 4624.6, floorY + 1.55, 121.6, shade(C.woodDark, 1.0));       // 仓号牌杆
    b.box('lacquer', 0.05, 0.9, 0.5, 4624.6, floorY + 2.0, 121.6, 0x2a1c12);
    b.box('glow', 0.03, 0.72, 0.34, 4624.66, floorY + 2.0, 121.6, 0xffb300);
  }
}
