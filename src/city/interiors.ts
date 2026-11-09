import { Baker, SignMesher, SignAtlas, shade, BGroup } from './bake';
import { buildRoomLiving } from './roomLiving';
import * as THREE from 'three';
import { RNG } from '../core/rng';
import {
  table, stool, jar, bowl, tray, vase, cabinet, censer, cushion, scrollRack, type ItemBuilder,
} from './itemKit';
import { C, roofOn, zhilingWindow } from './buildings';
import { bridgeDeckY } from './layout';
import { buildShiqianInteriorAtoms, buildSunyangInteriorAtoms, buildYamenInteriorAtoms } from './detailKit';
import { weapon, bed, screen, wineSea, fruitDish, ewer, foodBox, teaStove, wineBoard, accountDesk, accountDeskSmall, waterVat, manger, incenseBowl, soupCauldron, soupLadle, firewoodStack, bambooFlume, stoveEyes, soupTokens, teaLedger, soupMat, latticeBooth } from './itemKit';
import {
  plaqueSunyang, plaqueYamen, railingScreen, waterFireSticks, petitionDrum, gong, stable, beautyRail,
  fireTongs, jadeMortar, jadeVanity, whisk, armillary, gourd, vajraRing,
  gavel, vermilionBrush, fateTube, boundaryPost, incenseDing, jadeRailing, soulChain, stele,
} from './itemKit';
import {
  doubleStove, woodStair, ceremonialGate, xiezhiScreen, stonePavilion, jailBars, nightDrum, teaShed,
  candleArray, dizangNiche, coupletEast, coupletWest, stoneBaluster, wishCords, brokenSteleScreen,
  tearStone, boneHandrail, mistCurtain, baguaFurnace, goldenElixir, featherRobe, phoenixCarriage,
} from './itemKit';
import {
  crate, cashChest, goodsCrate, brokenCrate, moneyGateBox, meritBox, brocadeBox, pasteBucket, waterPail,
  slopPail, fruitBarrel, bathTub, wineWarmer, hundredEyeCabinet, medicineScale, copperMill, incenseScale,
  incenseSealMold, teaMill, teaSieve, fruitScale, wineDish, cakeStove, inkstone, pawnLedger, paperWrap,
  registerBook, ledgerBook, guestLedger, goldenLionCenser, bronzeDing, ironDing, spiralStair, woodLadder,
} from './itemKit';
import {
  wineCounter, steamerStack, teaWineCarry, eaveFruitBasket, paperVilla, spiritCoinString,
  pulsePillow, balanceScale, beastLock, windowGrille, beamScale,
  shoeLast, awlBasket, tailorRule, tailorShears,
  privateBooth, stageCurtain, arenaRail, puppetStage, shadowScreen, sandRing, brassGong,
  mooringPost, sackStack, persianRug, guildBoard, wellWindlass, ferrySign,
  horsePost, bookCase, bambooPlanter, guardClub, clothesChest, toolRack, strawMat, clothesPole,
  chickenCoop, ceramicStool, stoneLion, relicCasket, wineCarryPole,
} from './itemKit';
import {
  signTube, signTubeEscape, greatDrum, elixirFurnace, fairScale,
  greatStove, teaCarryLoad, backStove, hallPlaque,
} from './itemKit';
import {
  smallClayStove, kitchenClayStove, twinClayStove, sharedStoveShed, eaveClayStove, snowFirePit,
  officialMeasure, officialHu, grainDou, stoneStelae, meritSteleRow, teaStallSeat,
  fruitShopRack, porcelainShopRack, capShopRack, incenseShopRack, studyPlaque, peachOffering,
  cargoCrane, godownAwning, grainDryingYard, grainCart,
  stoneWaterVat, clayWaterVat, yardWell, brokenWillow, wallLocust, camelGodown, culvertMouth, woodArchway,
  pilgrimShed, fishStall, stallRow, stallAwning, bowRack,
  fodderTrough, fodderStack, camelShed, notionCarry, marketDrum,
} from './itemKit';

// ============ 重点建筑可进入内饰（B1） ============
// 依据：docs/assets/47-重点建筑室内装修全表.md 逐间表（孙羊正店 R01-R16/十千脚店 R01-R08/府衙 R01-R15）
// 45 卷八字段外壳规格；室内光一律暖黄 #FFC66E（三界光色纪律：人间禁霓虹入室）
// 实装策略：正面「通间格扇全卸」成敞廊（47 卷孙羊 R02 前檐条款），房间级简装 + 陈设精描逐件

const HALL = 0xffc66e;   // CJ-26 室内暖黄（47 卷 §0.2 三界光色基准）
const BRICK = 0x5a6472;  // M-03 青砖/素方砖
const JIN = 0x2b2b2b;    // 玄墨（金砖沥青描黑端，纯黑禁用）

/** 八仙桌：独板面 0.9×0.75 + 四腿（47 卷 C-ITM-0084） */
function table8(b: Baker, x: number, z: number, y: number): void {
  b.box('wood', 0.95, 0.07, 0.95, x, y + 0.76, z, shade(C.wood, 1.06));
  for (const dx of [-0.38, 0.38]) for (const dz of [-0.38, 0.38]) {
    b.box('wood', 0.08, 0.72, 0.08, x + dx, y + 0.4, z + dz, C.woodDark);
  }
  b.box('glow', 0.1, 0.14, 0.1, x, y + 0.88, z, HALL); // 桌烛
}

/** 酒瓮 + 封泥红签（47 卷 C-ITM-0091，陶 #955539 签 #9D2933） */
function jar9(b: Baker, x: number, y: number, z: number): void {
  b.cyl('wood', 0.3, 0.38, 0.9, 7, x, y + 0.45, z, shade(0x955539, 0.94 + (x % 3) * 0.03));
  b.cyl('wood', 0.2, 0.24, 0.08, 7, x, y + 0.94, z, 0x9d2933);
}

// ---------- 孙羊正店（226,66 20×13 三层 15m，正店之首） ----------
function buildSunyang(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const cx = 226, cz = 66, w = 20, d = 13;
  const hw = w / 2, hd = d / 2;
  const fz = cz + hd;      // 正面 z=72.5
  const bz = cz - hd + 0.2; // 背墙内面 z=59.7
  // 台基 + 底层素方砖地（R02）
  b.box('wall', w + 1.4, 0.6, d + 1.4, cx, 0.3, cz, C.stone);
  b.box('wall', w - 0.4, 0.1, d - 0.4, cx, 0.67, cz, shade(BRICK, 0.92));
  // L1 墙体（背/侧实墙 0.6→4.2；正面通间格扇全卸→角柱敞廊）
  b.box('wall', w, 3.9, 0.4, cx, 2.55, bz, C.plaster);
  b.box('wall', 0.4, 3.9, d, cx - hw + 0.2, 2.55, cz, C.plaster);
  b.box('wall', 0.4, 3.9, d, cx + hw - 0.2, 2.55, cz, C.plaster);
  for (const s of [-1, 1]) b.box('wall', 2.4, 3.9, 0.4, cx + s * (hw - 1.2), 2.55, fz - 0.2, C.plaster);
  // R03 酒垆柜台（榆木整厚板）+ 银酒海 + 名酒单水牌 + 三碗不过冈匾
  b.box('wood', 3.6, 1.1, 0.65, 221.8, 1.22, 60.9, C.wood);
  b.box('wood', 3.6, 0.08, 0.75, 221.8, 1.8, 60.9, shade(C.woodDark, 1.1));
  sg.quad(atlas.text('syjiudan', '名酒單', 128, 224, { color: '#2b2b2b', vertical: true, fontPx: 52, bg: 'rgba(244,236,216,0.92)' }), 0.5, 0.88, 221.8, 2.6, bz + 0.05, 0);
  sg.quad(atlas.text('sywan', '三碗不過岡', 384, 96, { color: '#ffd700', fontPx: 60, bg: 'rgba(43,43,43,0.9)', border: 'rgba(255,215,0,0.55)' }), 2.6, 0.65, 226, 3.3, bz + 0.06, 0);
  // R02 散座堂：八仙桌×10 + 板壁裙板海石榴色带
  for (const [tx, tz] of [[218.5, 64.5], [222.5, 64.5], [226.5, 64.5], [230.5, 64.5], [234, 64.5], [218.5, 68.5], [222.5, 68.5], [226.5, 68.5], [230.5, 68.5], [234, 68.5]] as const) {
    table8(b, tx, tz, 0.72);
  }
  b.box('wood', w - 0.8, 0.9, 0.12, cx, 1.5, bz + 0.28, shade(C.woodRed, 0.9)); // 裙板高900
  for (const lx of [220, 224, 228, 232]) { // 堂内吊灯排（暖黄主光）
    b.box('glow', 0.34, 0.46, 0.34, lx, 3.35, cz + 1.5, 0xffa04e);
    b.box('wood', 0.04, 0.6, 0.04, lx, 3.85, cz + 1.5, C.woodDark);
  }
  // 梯口围栏（楼梯穿楼板处读作楼梯间开口）
  for (const pz of [70.9, 69.4]) b.box('wood', 1.35, 0.09, 0.09, 233.4, 5.15, pz, shade(C.woodRed, 1.05));
  // R05 木楼梯（东侧北上，踏面暖亮木 #8B5E3C 导向）
  for (let i = 0; i < 13; i++) {
    b.box('wood', 1.3, 0.12, 0.8, 233.4, 0.78 + i * 0.3, 70.9 - i * 0.74, 0x8b5e3c);
  }
  // L2 楼板（顶=4.65 压住腰檐檐口 4.5）+ 腰檐 + 平座栏杆
  b.box('wood', w, 0.3, d, cx, 4.5, cz, shade(C.woodDark, 0.96));
  roofOn(b, w + 0.8, d + 0.8, 4.5, cx, cz, 0, shade(C.tile, 1.15));
  b.box('wood', w - 0.6, 0.09, 0.09, cx, 5.17, fz + 0.04, shade(C.woodRed, 1.08));
  for (let pp = 0; pp <= 5; pp++) b.box('wood', 0.09, 0.55, 0.09, cx - (w - 0.6) / 2 + (w - 0.6) * pp / 5, 4.95, fz + 0.04, C.woodRed);
  // L2 墙（背/侧 4.5→7.3）+ 临街直棂窗
  b.box('wall', w, 3.1, 0.4, cx, 6.05, bz, C.plaster);
  b.box('wall', 0.4, 3.1, d, cx - hw + 0.2, 6.05, cz, C.plaster);
  b.box('wall', 0.4, 3.1, d, cx + hw - 0.2, 6.05, cz, C.plaster);
  // L2 临街立面：四樘直棂窗（放大到 1.9×1.7）+ 窗下槛墙 + 腰檐椽头
  // 原来只有 1.5×1.5 小窗贴在白墙上，远看就是一条空墙
  for (const wx of [219, 223.5, 228.5, 233]) {
    zhilingWindow(b, wx, 6.45, fz - 0.2, 1.9, 1.7, 0, true);
    b.box('wood', 2.1, 0.16, 0.12, wx, 5.52, fz - 0.24, shade(C.woodDark, 1.1));
    b.box('wall', 2.1, 0.9, 0.1, wx, 5.0, fz - 0.24, shade(C.plaster, 0.94));
    b.kit('sunyang.l2Window', 1, 6.45);
  }
  for (let r = 0; r < 10; r++) {
    b.box('wood', 0.14, 0.14, 0.7, cx - 7.4 + r * 1.65, 4.68, fz - 0.1, shade(C.woodDark, 1.05));
    b.kit('sunyang.l2Rafter', 1, 4.68);
  }
  // 二层檐下斗栱带（每间一朵，简化为栌斗+华拱）
  for (let i = 0; i < 5; i++) {
    const bx2 = cx - 8 + i * 4;
    b.box('wood', 0.5, 0.24, 0.5, bx2, 5.72, fz - 0.12, shade(C.woodRed, 1.08));
    b.box('wood', 0.34, 0.14, 0.8, bx2, 5.9, fz - 0.05, shade(C.woodRed, 1.12));
  }
  for (const lx of [221, 226, 231]) { // 二层廊灯（暖黄）
    b.box('glow', 0.3, 0.4, 0.3, lx, 6.9, cz, 0xffa04e);
    b.box('wood', 0.04, 0.5, 0.04, lx, 7.3, cz, C.woodDark);
  }
  for (const s of [-1, 1]) b.box('wall', 1.6, 3.1, 0.4, cx + s * (hw - 0.8), 6.05, fz - 0.2, C.plaster);
  // L2 四雅间分隔（R06 主雅间西首 + R08 宴聚大间东首，可撤槅扇简化为门洞）
  for (const px of [221.5, 226, 230.5]) b.box('wood', 0.25, 3.1, d - 1.6, px, 6.05, cz - 0.2, C.wood);
  for (const px of [221.5, 230.5]) b.box('wood', 0.9, 2.4, 0.25, px, 5.8, fz - 1.4, C.wood); // 门洞留空
  table8(b, 223.8, 66.5, 4.65);
  table8(b, 228.3, 66.5, 4.65);
  table8(b, 232.8, 66.5, 4.65);
  // R06 芙蓉屏风六扇（绢 #F4ECD8 花 #9D2933 叶 #4A8B6F）
  for (let i = 0; i < 6; i++) {
    b.box('wood', 0.5, 2.6, 0.06, 219 + i * 0.52, 5.9, bz + 0.5, i % 2 ? 0xf4ecd8 : shade(0x9d2933, 1.05));
  }
  // L3 楼板（顶=7.75 压住二层腰檐檐口 7.6）+ 天阁 R14
  b.box('wood', w, 0.3, d, cx, 7.6, cz, shade(C.woodDark, 0.92));
  roofOn(b, w + 0.8, d + 0.8, 7.6, cx, cz, 0, shade(C.tile, 1.1));
  b.box('wall', w, 2.45, 0.4, cx, 9.0, bz, C.plaster);
  b.box('wall', 0.4, 2.45, d, cx - hw + 0.2, 9.0, cz, C.plaster);
  b.box('wall', 0.4, 2.45, d, cx + hw - 0.2, 9.0, cz, C.plaster);
  for (const s of [-1, 1]) { // 东西美人靠
    b.box('wood', 0.09, 0.09, d - 1, cx + s * (hw - 0.7), 8.75, cz, shade(0x8b5e3c, 1.05));
    b.box('wood', 0.09, 0.6, 0.09, cx + s * (hw - 0.7), 8.4, cz - (d - 1) / 2, 0x8b5e3c);
    b.box('wood', 0.09, 0.6, 0.09, cx + s * (hw - 0.7), 8.4, cz + (d - 1) / 2, 0x8b5e3c);
  }
  b.box('wood', w - 1, 0.09, 0.09, cx, 8.75, cz + hd - 0.7, shade(0x8b5e3c, 1.05)); // 南美人靠
  // L3 天阁临街格窗：原只有美人靠 + 灯笼，临街面全空
  for (const wx of [219.5, 224, 229, 233.5]) {
    zhilingWindow(b, wx, 9.05, cz + hd - 1.35, 1.5, 1.3, 0, true);
    b.box('wood', 1.7, 0.12, 0.1, wx, 8.34, cz + hd - 1.4, shade(C.woodRed, 1.05));
    b.kit('sunyang.l3Window', 1, 9.05);
  }
  for (let r = 0; r < 7; r++) b.box('wood', 0.1, 0.9, 0.1, cx - 7.6 + r * 2.5, 8.5, cz + hd - 1.42, shade(C.woodRed, 1.02));
  b.kit('sunyang.l3Rail', 7, 8.5);
  for (const lx of [219, 223.3, 228.7, 233]) b.box('glow', 0.3, 0.42, 0.3, lx, 9.65, cz + hd - 1.1, shade(0xff6a4a, 1.0)); // 红纱灯笼
  sg.quad(atlas.text('sytiange', '天閣', 160, 80, { color: '#ffd700', fontPx: 52, bg: 'rgba(43,43,43,0.85)' }), 1.5, 0.75, cx, 9.6, bz + 0.06, 0);
  // 山花封板（L3 墙顶 10.2 与曲面屋顶间接缝封死）
  b.box('wall', w, 0.5, d, cx, 10.0, cz, shade(C.plaster, 0.88));
  // 主屋顶 + 斗拱 + 匾
  roofOn(b, w + 0.5, d + 0.5, 10.2, cx, cz, 0, C.tile);
  sg.quad(atlas.text('sybian', '孫羊正店', 512, 128, { color: '#ffe9c8', glow: '#ff2d95', bg: 'rgba(12,10,18,0.88)', border: 'rgba(255,45,149,.8)', fontPx: 96 }), 5.5, 1.375, cx, 8.35, fz + 0.14, 0);
  // 欢门（R01 彩楼欢门：四柱双梁 + 彩帛五层 + NH-02 字管 + 灯球）
  const gx = cx, gz = cz + hd + 2.6, gw = 13, gh = 7.2;
  for (const px of [-gw / 2, gw / 2]) for (const pz of [-1.2, 1.2]) {
    b.box('wood', 0.34, gh, 0.34, gx + px, gh / 2 + 0.5, gz + pz, C.woodDark);
  }
  for (const py of [gh + 0.4, gh - 1.1]) {
    b.box('wood', gw + 0.6, 0.3, 0.3, gx, py + 0.5, gz, C.woodDark);
    b.box('wood', 0.3, 0.3, 2.8, gx, py + 0.5, gz, C.woodDark);
  }
  for (let k = 0; k < 7; k++) {
    const lx = -gw / 2 + (gw * k) / 6;
    b.box('glow', 0.45, 0.45, 0.45, gx + lx, gh + 0.85, gz, k % 2 ? C.neonMag : C.neonGold);
    if (k > 0 && k < 6) b.box('glow', 0.16, 1.1, 0.16, gx + lx, gh - 0.05, gz, C.neonMag);
  }
  b.box('glow', 5.6, 0.14, 0.14, gx, gh + 0.12, gz + 1.35, C.neonMag); // 「孫羊店」桃红字管（R01 条款）
  // 欢门彩帛：两梁之间垂六幅彩帛 + 灯球（原只有轮廓与字管）
  for (let k = 0; k < 6; k++) {
    const lx = -gw / 2 + 1.1 + (gw - 2.2) * k / 5;
    const col = [0x9d2933, 0xd4b76a, 0x2a5c42, 0x9d2933, 0xd4b76a, 0x2a5c42][k];
    b.box('fabric', 0.9, 1.5, 0.05, gx + lx, gh - 0.45, gz + 1.3, col);
    b.box('glow', 0.12, 0.12, 0.12, gx + lx, gh - 1.25, gz + 1.32, 0xffd27a);
    b.kit('sunyang.huanmenCloth', 1, gh - 0.4);
  }
  for (const s of [-1, 1]) {
    sg.quad(atlas.text(`syhuang${s}`, '孫羊', 64, 224, { color: '#fff', vertical: true, fontPx: 46, bg: 'rgba(10,8,16,0.55)' }), 1.15, 4.1, gx + s * (gw / 2 - 0.6), 4.2, gz + 1.6, 0);
  }
  // R15/R16 后院：双眼大灶 + 烟道 + 酒瓮 24 具三行
  b.box('wall', 1.8, 1.5, 1.1, 218.5, 1.35, 55.5, BRICK);
  b.box('glow', 0.5, 0.3, 0.05, 218.5, 0.9, 56.06, 0xff7f50);
  b.box('wall', 0.55, 3.4, 0.55, 218.5, 3.4, 55.2, shade(BRICK, 0.85));
  for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) {
    jar9(b, 221.5 + i * 1.75, 0.05, 58.1 - r * 1.5);
  }
  b.box('wall', 12.5, 1.8, 0.35, 227, 0.95, 53.6, shade(BRICK, 0.96)); // 酒瓮场围墙
  // L1 檐下灯笼 12 串简化为 6 盏（R01 红纱灯笼条款）
  for (const lx of [217.5, 221.5, 226, 230.5, 234.5]) b.box('glow', 0.26, 0.36, 0.26, lx, 3.55, fz + 0.5, 0xff8a5a);
}

// ---------- 十千脚店（122,64 15×11 两层 9.5m，灯箱名物） ----------
function buildShiqian(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const cx = 122, cz = 64, w = 15, d = 11;
  const hw = w / 2, hd = d / 2;
  const fz = cz + hd;
  const bz = cz - hd + 0.2;
  b.box('wall', w + 1.4, 0.6, d + 1.4, cx, 0.3, cz, C.stone);
  b.box('wall', w - 0.4, 0.1, d - 0.4, cx, 0.67, cz, shade(BRICK, 0.9));
  // L1（0.6→4.0）：背/侧实墙 + 正门与角柱（井字欢门檐廊 R01）
  b.box('wall', w, 3.4, 0.4, cx, 2.3, bz, C.plaster);
  b.box('wall', 0.4, 3.4, d, cx - hw + 0.2, 2.3, cz, C.plaster);
  b.box('wall', 0.4, 3.4, d, cx + hw - 0.2, 2.3, cz, C.plaster);
  for (const s of [-1, 1]) b.box('wall', 1.7, 3.4, 0.4, cx + s * (hw - 0.85), 2.3, fz - 0.2, C.plaster);
  // R02 柜区 + R03 散座 6 组
  b.box('wood', 2.8, 1.05, 0.6, cx - 3.4, 1.2, bz + 0.5, C.wood);
  b.box('wood', 2.8, 0.08, 0.7, cx - 3.4, 1.76, bz + 0.5, shade(C.woodDark, 1.1));
  b.cyl('wood', 0.5, 0.55, 0.5, 8, cx - 1.2, 0.92, bz + 0.7, 0x955539); // 空瓮倒扣（R03 界断）
  b.cyl('wood', 0.5, 0.55, 0.5, 8, cx + 1.2, 0.92, bz + 0.7, 0x955539);
  for (const lx of [cx - 3, cx + 1.5]) { // 堂内吊灯（暖黄）
    b.box('glow', 0.3, 0.4, 0.3, lx, 3.15, cz + 1.5, 0xffa04e);
    b.box('wood', 0.04, 0.5, 0.04, lx, 3.6, cz + 1.5, C.woodDark);
  }
  for (const [tx, tz] of [[cx - 4.5, cz + 1.6], [cx - 0.5, cz + 1.6], [cx + 3.5, cz + 1.6], [cx - 4.5, cz + 4], [cx - 0.5, cz + 4], [cx + 3.5, cz + 4]] as const) {
    table8(b, tx, tz, 0.72);
  }
  // R05 楼梯
  for (let i = 0; i < 11; i++) b.box('wood', 1.2, 0.12, 0.75, cx + 5.6, 0.78 + i * 0.315, cz + 4.2 - i * 0.72, 0x8b5e3c);
  // L2 楼板/墙/窗
  b.box('wood', w, 0.3, d, cx, 4.15, cz, shade(C.woodDark, 0.96));
  roofOn(b, w + 0.8, d + 0.8, 4.3, cx, cz, 0, shade(C.tile2, 1.15));
  b.box('wall', w, 2.7, 0.4, cx, 5.65, bz, C.plaster);
  b.box('wall', 0.4, 2.7, d, cx - hw + 0.2, 5.65, cz, C.plaster);
  b.box('wall', 0.4, 2.7, d, cx + hw - 0.2, 5.65, cz, C.plaster);
  for (const wx of [cx - 4, cx, cx + 4]) {
    zhilingWindow(b, wx, 5.9, fz - 0.2, 1.5, 1.5, 0, true);
    b.box('wood', 1.7, 0.14, 0.1, wx, 5.06, fz - 0.24, shade(C.woodDark, 1.08));
    b.box('wall', 1.7, 0.7, 0.09, wx, 4.66, fz - 0.24, shade(C.plaster, 0.94));
    b.kit('shiqian.l2Window', 1, 5.9);
  }
  for (let r = 0; r < 9; r++) {
    b.box('wood', 0.12, 0.12, 0.62, cx - 6.4 + r * 1.6, 4.34, fz - 0.08, shade(C.woodDark, 1.05));
    b.kit('shiqian.rafter', 1, 4.34);
  }
  // R04/R05 二层小阁子 ×2（西半，东半敞廊）
  b.box('wood', 0.22, 2.4, d - 1.4, cx - 2.2, 5.6, cz - 0.2, C.wood);
  b.box('wood', 4, 2.4, 0.22, cx - 4.4, 5.6, cz + 1.6, C.wood);
  table8(b, cx - 4.2, cz - 0.8, 4.3);
  table8(b, cx - 0.9, cz - 0.8, 4.3);
  b.box('wood', w - 0.6, 0.08, 0.08, cx + 2.4, 4.75, fz - 0.6, shade(C.woodRed, 1.05)); // 敞廊矮栏
  // 山花封板（L2 墙顶 7.0 封死）+ 主屋顶 + 匾
  b.box('wall', w, 0.4, d, cx, 6.85, cz, shade(C.plaster, 0.88));
  roofOn(b, w + 0.5, d + 0.5, 7.0, cx, cz, 0, C.tile2);
  sg.quad(atlas.text('sqbian', '十千腳店', 448, 112, { color: '#ffe9c8', glow: '#00e5ff', bg: 'rgba(12,10,18,0.88)', border: 'rgba(0,229,255,.8)', fontPx: 88 }), 4.8, 1.2, cx, 5.6, fz + 0.14, 0);
  // 双灯箱「十千」「腳店」（R01 名物实装：门东/门西 木绢方箱透烛光）
  for (const [sx, txt, key] of [[cx - hw + 0.85, '十千', 'sqdx'], [cx + hw - 0.85, '腳店', 'sqdj']] as const) {
    b.box('wood', 0.62, 0.9, 0.62, sx, 2.55, fz + 0.55, shade(C.wood, 0.95));
    b.box('glow', 0.5, 0.78, 0.5, sx, 2.55, fz + 0.55, HALL);
    sg.quad(atlas.text(key, txt, 96, 160, { color: '#2b2b2b', vertical: true, fontPx: 64, bg: 'rgba(244,236,216,0.94)' }), 0.5, 0.82, sx, 2.55, fz + 0.88, 0);
  }
  // 楹联（R01 井字欢门条款：十千沽一斗／一醉解千愁）
  sg.quad(atlas.text('sqlian1', '十千沽一斗', 96, 320, { color: '#f0ead6', vertical: true, fontPx: 56, bg: 'rgba(46,78,126,0.85)' }), 0.75, 2.6, cx - 2.6, 2.1, fz + 0.5, 0);
  sg.quad(atlas.text('sqlian2', '一醉解千愁', 96, 320, { color: '#f0ead6', vertical: true, fontPx: 56, bg: 'rgba(46,78,126,0.85)' }), 0.75, 2.6, cx + 2.6, 2.1, fz + 0.5, 0);
  // 井字欢门缚彩（降档两道）
  for (const px of [-hw + 0.4, hw - 0.4]) b.box('wood', 0.26, 4.6, 0.26, cx + px, 2.9, fz + 1.6, C.woodDark);
  b.box('wood', w - 0.4, 0.26, 0.26, cx, 5.35, fz + 1.6, C.woodDark);
  b.box('glow', 1.4, 0.12, 0.12, cx, 5.6, fz + 1.6, C.neonCyan);
  // 欢门彩帛四幅 + 灯球（与孙羊同制但降档：四幅、单色青）
  for (let k = 0; k < 4; k++) {
    const lx = cx - 4.5 + k * 3;
    b.box('fabric', 0.8, 1.2, 0.05, lx, 4.7, fz + 1.62, 0x2a5c42);
    b.box('glow', 0.1, 0.1, 0.1, lx, 4.15, fz + 1.64, 0x9fe8ff);
    b.kit('shiqian.huanmenCloth', 1, 4.7);
  }
  // 檐下灯笼 6 盏（R01 条款）
  for (let i = 0; i < 6; i++) b.box('glow', 0.24, 0.32, 0.24, cx - 5.5 + i * 2.2, 3.5, fz + 0.5, 0xff8a5a);
  // R06 后院客舍：木榻 6 具 + R07 马槽 2
  for (let i = 0; i < 6; i++) {
    b.box('wood', 1.9, 0.42, 0.85, cx - 5 + (i % 3) * 2.6, 0.42, 54.5 - Math.floor(i / 3) * 1.6, shade(C.wood, 0.9));
    b.box('wood', 1.7, 0.06, 0.7, cx - 5 + (i % 3) * 2.6, 0.66, 54.5 - Math.floor(i / 3) * 1.6, 0xd4b76a); // 苇席
  }
  for (const mx of [cx - 1, cx + 1.6]) b.box('wood', 1.4, 0.5, 0.55, mx, 0.45, 55.2, shade(C.stone, 0.9));
}

// ---------- 府衙大堂（560,-74 22×12 单檐歇山，R03 肃字档） ----------
// 原堂心 (560,−20) 落在河面足迹内（半宽 31）：水面恢复后整院泡在河里，现沿 z 南迁 54m 到岸上，
// 照壁接城内南北街南端尽头（z=−60），堂前留 4.5m 月台。
function buildYamenHall(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const cx = 560, cz = -74, w = 22, d = 12;
  const hw = w / 2, hd = d / 2;
  const fz = cz + hd;
  const bz = cz - hd + 0.2;
  b.box('wall', w + 1.6, 0.9, d + 1.6, cx, 0.45, cz, C.stone); // 台基高0.9（45卷）
  b.box('wall', w - 0.4, 0.12, d - 0.4, cx, 0.96, cz, shade(JIN, 1.35)); // R03 金砖 640 对缝沥青描黑
  // 墙体（0.9→4.4，下碱青砖 1.2m + 上部竹编灰泥）
  b.box('wall', w, 1.2, 0.4, cx, 1.5, bz, BRICK);
  b.box('wall', w, 2.3, 0.4, cx, 3.25, bz, C.plaster);
  for (const s of [-1, 1]) {
    b.box('wall', 0.4, 1.2, d, cx + s * (hw - 0.2), 1.5, cz, BRICK);
    b.box('wall', 0.4, 2.3, d, cx + s * (hw - 0.2), 3.25, cz, C.plaster);
  }
  // 正面：中门开（三门制简化）+ 次间槛窗 + 角柱
  for (const s of [-1, 1]) b.box('wall', 4.4, 3.5, 0.4, cx + s * (hw - 2.2), 2.65, fz - 0.2, C.plaster);
  for (const s of [-1, 1]) b.box('wall', 5.4, 0.9, 0.4, cx + s * 3.6, 1.35, fz - 0.2, BRICK);
  // R03 金柱 4 根（朱皮）+ 柱础抱鼓石
  for (const px of [-5.5, 5.5]) for (const pz of [-2.5, 2.5]) {
    b.cyl('wood', 0.34, 0.38, 3.5, 8, cx + px, 2.65, cz + pz, C.woodRed);
    b.box('wall', 0.78, 0.34, 0.78, cx + px, 1.13, cz + pz, shade(C.stone, 1.06));
    b.kit('yamen.columnBase', 1, 1.1);
  }
  // 檐下铺作：官式建筑不做彩帛，靠斗栱与椽头立规格
  for (let i = 0; i < 9; i++) {
    const bx = cx - 9 + i * 2.25;
    b.box('wood', 0.5, 0.26, 0.5, bx, 4.42, fz + 0.12, C.woodRed);
    b.box('wood', 0.36, 0.16, 0.9, bx, 4.62, fz + 0.22, shade(C.woodRed, 1.12));
    b.box('wood', 0.22, 0.14, 0.22, bx - 0.34, 4.76, fz + 0.22, C.woodRed);
    b.box('wood', 0.22, 0.14, 0.22, bx + 0.34, 4.76, fz + 0.22, C.woodRed);
    b.kit('yamen.bracket', 1, 4.5);
  }
  for (let i = 0; i < 11; i++) {
    b.box('wood', 0.14, 0.14, 0.8, cx - 10 + i * 2, 4.24, fz + 0.34, shade(C.woodDark, 1.05));
    b.kit('yamen.rafter', 1, 4.24);
  }
  // 门楣格心（中门上方：两横枋之间竖棂）
  b.box('wood', 5.6, 0.26, 0.18, cx, 4.06, fz + 0.08, C.woodDark);
  b.box('wood', 5.6, 0.12, 0.14, cx, 3.4, fz + 0.08, C.woodDark);
  for (let i = 0; i < 8; i++) b.box('wood', 0.08, 0.56, 0.08, cx - 2.45 + i * 0.7, 3.72, fz + 0.12, C.woodDark);
  b.kit('yamen.doorLattice', 1, 3.7);
  // 判案长案 + 座屏五扇（海水朝阳：水青日金）+ 匾
  b.box('wood', 2.4, 0.12, 1.0, cx, 1.62, cz - 3.2, shade(C.woodDark, 1.12));
  for (const dx of [-1.0, 1.0]) b.box('wood', 0.12, 0.72, 0.8, cx + dx, 1.2, cz - 3.2, C.woodDark);
  for (let i = 0; i < 5; i++) {
    const hgt = i === 2 ? 2.5 : 2.2; // 中扇高、两侧低（座屏规整制）
    b.box('wood', 0.6, hgt, 0.07, cx - 1.44 + i * 0.72, 1.25 + hgt / 2, cz - 4.35, 0xf4ecd8);
    b.box('wood', 0.6, 0.22, 0.09, cx - 1.44 + i * 0.72, 1.3 + hgt, cz - 4.35, 0x8a6a3a); // 屏帽
    b.box('wood', 0.5, 0.34, 0.09, cx - 1.44 + i * 0.72, 1.18, cz - 4.35, 0x3a6b8c);       // 海水纹裙带
    b.box('wood', 0.64, 0.16, 0.3, cx - 1.44 + i * 0.72, 1.02, cz - 4.35, C.woodDark);      // 屏座
  b.box('wood', 3.7, 0.18, 0.12, cx, 3.62, cz - 4.35, C.woodDark); // 屏顶通枋（五扇一体）
  }
  b.cyl('wood', 0.42, 0.42, 0.06, 16, cx, 2.66, cz - 4.44, 0xb8862e, 0, Math.PI / 2); // 旭日金环（木底）
  b.cyl('glow', 0.2, 0.2, 0.07, 12, cx, 2.66, cz - 4.43, 0xd4a017, 0, Math.PI / 2);    // 旭日芯（暗金不炸）
  // 匾「明鏡高懸」字面：原 z=bz+0.06 落在后墙实体内、且被 2.5m 座屏遮死；
  // 现随匾板改挂门内门楣下（板 fz−0.35 … fz−0.25），字面朝堂心
  sg.quad(atlas.text('yamming', '明鏡高懸', 448, 112, { color: '#ffd700', fontPx: 88, bg: 'rgba(43,43,43,0.92)', border: 'rgba(255,215,0,0.5)' }), 4.4, 1.1, cx, 3.2, fz - 0.37, 0);
  // 官灯两盏（案后两侧，吊索到平闇——不悬空不穿板）
  for (const s2 of [-1, 1]) {
    b.box('wood', 0.05, 0.62, 0.05, cx + s2 * 3.2, 3.8, cz - 3.4, C.woodDark); // 吊索
    b.box('glow', 0.32, 0.42, 0.32, cx + s2 * 3.2, 3.35, cz - 3.4, HALL);
  }
  for (const s of [-1, 1]) {
    b.box('wood', 1.6, 0.08, 0.08, cx + s * 6.5, 0.6, cz + 3.4, C.woodDark);
    for (let i = 0; i < 4; i++) {
      const px = cx + s * 6.5 - 0.6 + i * 0.4;
      b.box('wood', 0.06, 0.95, 0.06, px, 1.55, cz + 3.4, 0xa63a2b);
      b.box('wood', 0.06, 0.9, 0.06, px, 1.52, cz + 3.4, 0x2b2b2b);
    }
  }
  // 六房案牍架沿侧墙 4 具（R06-R11 简化）
  for (let i = 0; i < 4; i++) {
    b.box('wood', 0.5, 2.0, 2.2, cx - hw + 0.65, 1.95, cz - 3.6 + i * 2.4, shade(C.woodDark, 1.04));
    b.box('wood', 0.52, 0.06, 2.0, cx - hw + 0.65, 2.4, cz - 3.6 + i * 2.4, shade(0xf4ecd8, 0.95)); // 卷宗层
    b.box('wood', 0.52, 0.06, 2.0, cx - hw + 0.65, 1.75, cz - 3.6 + i * 2.4, shade(0xf4ecd8, 0.9));
  }
  // 山花封板（墙顶 4.4 与屋顶间接缝）+ 平闇天花（R03 满搭到墙内缘）
  b.box('wall', w + 0.2, 0.4, d + 0.2, cx, 4.28, cz, shade(C.plaster, 0.9));
  b.box('wood', w - 0.5, 0.14, d - 0.5, cx, 4.12, cz, shade(C.woodDark, 1.15));
  b.box('wood', w - 1.6, 0.1, d - 1.6, cx, 4.24, cz, shade(0x3a6b8c, 0.85));
  b.box('wood', w - 0.5, 0.5, 0.3, cx, 4.0, cz - hd + 0.35, shade(C.woodDark, 1.05)); // 背墙顶枋压缝
  // 后堂小憩间：榻 + 屏风（给 bed/screen 两类器件真实落点，临街可见）
  bed(b, cx + 7.4, 0.95, cz - 4.6, 0.9);
  screen(b, cx + 9.4, 0.95, cz - 4.6, 0.9);
  b.kit('yamen.restRoom', 1, 0.95);

  // 门前仪仗：两对戟（府衙威仪），也给"兵器"类器件一个真实落点
  for (const sx of [-1, 1]) for (const k of [0, 1]) {
    weapon(b, cx + sx * (hw - 1.2 + k * 1.6), 0.95, fz + 2.2 + k * 1.4, 1.0, 2);
    b.kit('yamen.halberd', 1, 0.95);
  }

  // 主屋顶 + 斗拱带
  roofOn(b, w + 0.6, d + 0.6, 4.4, cx, cz, 0, C.tile);
  // 封檐板与山花：檐口与山墙顶端原本有缝，低机位能透出浅色背景，读作"白板"
  b.box('roof', w + 1.0, 0.42, 0.3, cx, 4.32, cz + hd + 0.2, shade(C.tile, 0.9));
  b.box('roof', w + 1.0, 0.42, 0.3, cx, 4.32, cz - hd - 0.2, shade(C.tile, 0.9));
  for (const s2 of [-1, 1]) {
    b.box('wall', 0.34, 2.4, d + 0.5, cx + s2 * (hw + 0.05), 5.5, cz, shade(C.plaster, 0.92));
    b.box('roof', 0.44, 0.36, d + 0.7, cx + s2 * (hw + 0.05), 6.72, cz, shade(C.tile, 0.94));
    b.kit('yamen.gable', 1, 5.5);
  }
  sg.quad(atlas.text('yamSign', '開封府', 384, 112, { color: '#ffe9c8', glow: '#ffd25e', bg: 'rgba(12,10,18,0.88)', border: 'rgba(255,210,94,.8)', fontPx: 88 }), 4.4, 1.28, cx, 3.62, fz + 0.16, 0);
}

/** 孙羊正店 R01–R16 席面器用落位（局部坐标，随楼体整体 180° 转向） */
function dressSunyang(b: Baker): void {
  const F = 0.72, L2 = 4.65, L3 = 7.75;
  wineBoard(b, 217.2, 0.6, 72.9, 1);
  waterVat(b, 234.2, 0.6, 72.9, 0.9);
  b.kit('interior.sunyang.R01', 2, 0.6);

  for (const [x, z] of [[222.5, 64.5], [230.5, 68.5], [218.5, 68.5]] as const) fruitDish(b, x, 1.515, z, 1);
  foodBox(b, 226.5, 1.515, 64.5, 1);
  ewer(b, 234, 1.515, 64.5, 1);
  b.kit('interior.sunyang.R02', 5, F);

  wineSea(b, 220.6, 1.84, 60.75, 1);
  wineSea(b, 223.2, 1.84, 61.05, 1);
  ewer(b, 221.9, 1.84, 60.9, 1);
  wineBoard(b, 224.6, 0.72, 60.3, 1);
  b.kit('interior.sunyang.R03', 4, F);

  accountDesk(b, 217.6, 0.72, 62.2, 1);
  accountDeskSmall(b, 218.6, 0.72, 61.4, 0.9);
  teaLedger(b, 217.4, 1.82, 62.2, 1);
  b.kit('interior.sunyang.R04', 3, F);

  teaStove(b, 231.8, 0.72, 61.6, 1);
  foodBox(b, 231.2, 0.72, 62.3, 1);
  b.kit('interior.sunyang.R05', 2, F);

  wineSea(b, 232.8, 5.445, 66.5, 1);
  ewer(b, 233.1, 5.445, 66.8, 1);
  foodBox(b, 234.7, 4.65, 61.6, 1);
  b.kit('interior.sunyang.R06', 3, L2);

  teaStove(b, 228.3, 5.445, 66.5, 1);
  fruitDish(b, 228.6, 5.445, 66.2, 1);
  accountDeskSmall(b, 227.3, 4.65, 61.5, 0.9);
  b.kit('interior.sunyang.R07', 3, L2);

  foodBox(b, 223.8, 5.445, 66.5, 1);
  ewer(b, 224.2, 5.445, 66.85, 1);
  fruitDish(b, 223.5, 5.445, 66.3, 1);
  b.kit('interior.sunyang.R08', 3, L2);

  incenseBowl(b, 217.4, 4.65, 66.3, 1);
  accountDeskSmall(b, 220.3, 4.65, 61.4, 0.9);
  teaLedger(b, 220.3, 5.5, 61.4, 1);
  b.kit('interior.sunyang.R09', 3, L2);

  incenseBowl(b, 218, 4.65, 64.9, 1);
  soupMat(b, 219.3, 4.65, 64.9, 1);
  b.kit('interior.sunyang.R10', 2, L2);

  accountDesk(b, 228.6, 4.65, 61.2, 1);
  teaLedger(b, 228.6, 5.75, 61.2, 1);
  incenseBowl(b, 227, 4.65, 62.2, 1);
  b.kit('interior.sunyang.R11', 3, L2);

  teaStove(b, 231.2, 4.65, 69.9, 1);
  foodBox(b, 231.8, 4.65, 70.4, 1);
  b.kit('interior.sunyang.R12', 2, L2);

  wineSea(b, 234.8, 4.65, 61.3, 1);
  incenseBowl(b, 234.4, 4.65, 62.4, 1);
  soupMat(b, 234.6, 4.65, 67.9, 1);
  b.kit('interior.sunyang.R13', 3, L2);

  teaStove(b, 226, 7.75, 68.2, 1);
  wineSea(b, 226.6, 7.75, 67.3, 1);
  soupMat(b, 225, 7.75, 68.6, 1);
  b.kit('interior.sunyang.R14', 3, L3);

  soupCauldron(b, 219, 0.05, 56.8, 0.45);
  soupLadle(b, 220.3, 0.05, 57.3, 0.7);
  stoveEyes(b, 217, 0.05, 57.4, 1);
  waterVat(b, 216.8, 0.05, 58.6, 0.8);
  b.kit('interior.sunyang.R15', 4, 0.05);

  bambooFlume(b, 226, 0.05, 54.35, 0.8);
  firewoodStack(b, 230.2, 0.05, 54.1, 0.75);
  b.kit('interior.sunyang.R16', 2, 0.05);
}

/** 十千脚店 R01–R08 席面器用落位（局部坐标，随楼体整体 180° 转向） */
function dressShiqian(b: Baker): void {
  const F = 0.72, L2 = 4.3;
  wineBoard(b, 117, 0.6, 70, 1);
  waterVat(b, 128, 0.6, 69.9, 0.8);
  b.kit('interior.shiqian.R01', 2, 0.6);

  wineSea(b, 118, 1.8, 59.15, 1);
  ewer(b, 119.05, 1.8, 59.2, 1);
  teaLedger(b, 118.55, 1.8, 59.25, 1);
  teaStove(b, 125.2, 0.72, 59.6, 1);
  foodBox(b, 126.1, 0.72, 59.4, 1);
  b.kit('interior.shiqian.R02', 5, F);

  for (const [x, z] of [[121.5, 65.6], [117.5, 68], [125.5, 68]] as const) fruitDish(b, x, 1.515, z, 1);
  foodBox(b, 125.5, 1.515, 65.6, 1);
  ewer(b, 117.5, 1.515, 65.6, 1);
  b.kit('interior.shiqian.R03', 5, F);

  ewer(b, 121.4, 5.095, 63.5, 1);
  foodBox(b, 120.75, 5.095, 63.45, 1);
  wineSea(b, 122.6, 4.3, 67.6, 1);
  latticeBooth(b, 125.6, 4.3, 59.2, 1);
  b.kit('interior.shiqian.R04', 4, L2);

  teaStove(b, 117.8, 5.095, 63.2, 1);
  fruitDish(b, 117.5, 5.095, 62.85, 1);
  soupMat(b, 116.2, 4.3, 61.9, 1);
  b.kit('interior.shiqian.R05', 3, L2);

  accountDeskSmall(b, 126.2, 0, 53.6, 1);
  teaLedger(b, 126.2, 0.85, 53.6, 1);
  incenseBowl(b, 125, 0, 54.9, 1);
  b.kit('interior.shiqian.R06', 3, 0);

  manger(b, 117.5, 0, 51.3, 1);
  waterVat(b, 126.4, 0, 51.6, 0.8);
  b.kit('interior.shiqian.R07', 2, 0);

  waterVat(b, 126.8, 0, 57.4, 0.85);
  bambooFlume(b, 121, 0, 57.2, 0.8);
  firewoodStack(b, 127.8, 0, 56, 0.8);
  b.kit('interior.shiqian.R08', 3, 0);
}

/** 府衙 R01–R12 席面器用落位（大堂一座通间，R13–R15 无壳未落） */
function dressYamen(b: Baker): void {
  const F = 1.02;
  waterVat(b, 551, 0, -66.2, 0.9);
  firewoodStack(b, 569, 0, -66.2, 0.9);
  b.kit('interior.yamen.R01', 2, 0);

  waterVat(b, 556.2, 0, -63.5, 0.8);
  accountDeskSmall(b, 564, 0, -63.5, 1);
  b.kit('interior.yamen.R02', 2, 0);

  teaStove(b, 562.4, F, -77, 1);
  soupMat(b, 560.5, F, -75.6, 1);
  ewer(b, 559.9, 1.96, -77.1, 1);
  b.kit('interior.yamen.R03', 3, F);

  accountDesk(b, 554.2, F, -73.8, 1);
  teaLedger(b, 554.2, 2.12, -73.8, 1);
  ewer(b, 554.7, 2.12, -73.8, 1);
  b.kit('interior.yamen.R04', 3, F);

  incenseBowl(b, 565.9, F, -78.8, 1);
  soupMat(b, 565.4, F, -77.6, 1);
  b.kit('interior.yamen.R05', 2, F);

  accountDeskSmall(b, 554.2, F, -78.3, 1);
  teaLedger(b, 554.2, 1.87, -78.3, 1);
  b.kit('interior.yamen.R06', 2, F);

  teaStove(b, 554, F, -74.3, 1);
  soupTokens(b, 554.9, F, -74.1, 1);
  b.kit('interior.yamen.R07', 2, F);

  accountDesk(b, 554.6, F, -70.2, 1);
  teaLedger(b, 554.6, 2.12, -70.2, 1);
  b.kit('interior.yamen.R08', 2, F);

  accountDeskSmall(b, 565.8, F, -78.3, 1);
  teaLedger(b, 565.8, 1.87, -78.3, 1);
  b.kit('interior.yamen.R09', 2, F);

  incenseBowl(b, 565.6, F, -74.2, 1);
  fruitDish(b, 567.8, 1.82, -73.8, 1);
  b.kit('interior.yamen.R10', 2, F);

  teaStove(b, 565.2, F, -69.3, 1);
  foodBox(b, 564.5, F, -69.1, 1);
  b.kit('interior.yamen.R11', 2, F);

  waterVat(b, 568, F, -75.4, 0.8);
  soupMat(b, 569, F, -71.8, 1);
  foodBox(b, 567.9, F, -70.9, 1);
  b.kit('interior.yamen.R12', 3, F);
}

/** 室内点光规格（B1：自发光陈设不照亮墙面，需真光源；暖黄 2700K 系，distance 限室内） */
export const INTERIOR_LIGHTS: { x: number; y: number; z: number; color: number; int: number; dist: number }[] = [
  { x: 226, y: 3.0, z: 66.5, color: 0xffa04e, int: 95, dist: 14 },  // 孙羊 L1 堂（物理单位 candela）
  { x: 219.5, y: 2.9, z: 62.5, color: 0xffa04e, int: 55, dist: 10 }, // 孙羊 L1 西端补光（酒垆/武松区）
  { x: 226, y: 6.15, z: 64.5, color: 0xffa04e, int: 120, dist: 13 }, // 孙羊 L2 雅间
  { x: 122, y: 2.9, z: 65.5, color: 0xffa04e, int: 80, dist: 12 },  // 十千 L1 堂
  { x: 122, y: 5.9, z: 64, color: 0xffa04e, int: 55, dist: 10 },    // 十千 L2 阁
  { x: 560, y: 3.5, z: -74.5, color: 0xffb25e, int: 170, dist: 17 }, // 府衙大堂
  // 三大殿：殿内无窗，只有自发光宫灯时梁下/宝座全是黑的。每殿两盏（宝座区 + 殿心），
  // 落点压在天花梁架下 0.6m、避开藻井井口；暖黄 2700K，与人间室内光同一色系。
  { x: 0, y: 10.9, z: -3292, color: 0xffc27a, int: 50, dist: 70 },   // 太和殿·宝座区（压低，避免金屏过曝）
  { x: 0, y: 10.9, z: -3258, color: 0xffc27a, int: 90, dist: 70 },   // 太和殿·殿心
  { x: 0, y: 10.3, z: -3504, color: 0xffc27a, int: 40, dist: 55 },   // 中和殿·宝座区
  { x: 0, y: 10.3, z: -3476, color: 0xffc27a, int: 70, dist: 55 },   // 中和殿·殿心
  { x: 0, y: 10.5, z: -3718, color: 0xffc27a, int: 45, dist: 65 },   // 保和殿·宝座区
  { x: 0, y: 10.5, z: -3672, color: 0xffc27a, int: 85, dist: 65 },   // 保和殿·殿心
];

/** 孙羊正店二批器物落位（R01 匾额 / R03 柜台栏 / R09 玉环 / R14 天阁三件 / R15 灶间 / R16 柴场） */
function dressSunyangBatch2(b: Baker): void {
  const F = 0.72, L2 = 4.65, L3 = 7.75;
  plaqueSunyang(b, 226, 7.7, 72.56, 1);
  b.kit('interior.batch2.sunyang.R01', 1, 7.7);

  railingScreen(b, 221.9, F, 62.2, 1);
  b.kit('interior.batch2.sunyang.R03', 1, F);

  vajraRing(b, 217.2, L2, 63.6, 1);
  b.kit('interior.batch2.sunyang.R09', 1, L2);

  beautyRail(b, 226, L3, 60.8, 1);
  jadeVanity(b, 232.4, L3, 60.6, 1);
  armillary(b, 219.7, L3, 60.6, 1);
  b.kit('interior.batch2.sunyang.R14', 3, L3);

  gourd(b, 218.6, 0.05, 54.15, 1);
  b.kit('interior.batch2.sunyang.R15', 1, 0.05);

  fireTongs(b, 231.2, 0.05, 54.5, 1);
  b.kit('interior.batch2.sunyang.R16', 1, 0.05);
}

/** 十千脚店二批器物落位（R07 马厩 / R08 后院药钵） */
function dressShiqianBatch2(b: Baker): void {
  stable(b, 123.6, 0, 51, 1);
  b.kit('interior.batch2.shiqian.R07', 1, 0);

  jadeMortar(b, 124.4, 0, 56.2, 1);
  b.kit('interior.batch2.shiqian.R08', 1, 0);
}

/** 府衙二批器物落位（R01 门厅鼓锣 / R02 台基栏杆 / R03 公堂匾与案上三件 / R06 棍架 / R09 界桩锁链 / 门前鼎碑） */
function dressYamenBatch2(b: Baker): void {
  const F = 1.02; // 金砖地面（台基 0.9 + 金砖 0.12）
  petitionDrum(b, 552.6, 0.9, -67.3, 1);
  gong(b, 567.6, 0.9, -67.3, 1);
  b.kit('interior.batch2.yamen.R01', 2, 0.9);

  jadeRailing(b, 556, 0.9, -66.42, 1);
  jadeRailing(b, 564, 0.9, -66.42, 1);
  b.kit('interior.batch2.yamen.R02', 2, 0.9);

  // 明鏡高懸匾：后墙被 2.5m 座屏占满（屏顶 3.91 / 平闇 4.05），改挂门内门楣下、正面朝堂心
  plaqueYamen(b, 560, 2.55, -68.3, 1);
  gavel(b, 561.05, 1.96, -76.75, 1);
  vermilionBrush(b, 559.15, 1.96, -76.85, 1);
  fateTube(b, 560.05, 1.96, -76.75, 1);
  b.kit('interior.batch2.yamen.R03', 4, F);

  whisk(b, 561.55, F, -77.15, 1);
  b.kit('interior.batch2.yamen.R04', 1, F);

  waterFireSticks(b, 551.2, F, -79.05, 1);
  b.kit('interior.batch2.yamen.R06', 1, F);

  boundaryPost(b, 566.9, F, -69.3, 1);
  soulChain(b, 570.2, 1.62, -69, 1);
  b.kit('interior.batch2.yamen.R09', 2, F);

  incenseDing(b, 556.8, 0.9, -67.4, 1);
  incenseDing(b, 563.2, 0.9, -67.4, 1);
  stele(b, 549, 0.9, -67.2, 1);
  b.kit('interior.batch2.yamen.gate', 3, 0.9);
}

/** 孙羊正店三批器物落位（梯段扶索 / R16 梯与残碑 / L3 天阁三宝） */
function dressSunyangBatch3(b: Baker): void {
  const F = 0.72, L3 = 7.75;
  boneHandrail(b, 232.55, F, 70.6, 1);
  b.kit('interior.batch3.sunyang.stair', 1, F);

  woodStair(b, 234.9, 0.05, 56.8, 1);
  brokenSteleScreen(b, 222, 0.05, 54.1, 1);
  b.kit('interior.batch3.sunyang.R16', 2, 0.05);

  phoenixCarriage(b, 219.6, L3, 63.9, 0.85);
  featherRobe(b, 222.6, L3, 62.9, 1);
  baguaFurnace(b, 232.6, L3, 64.6, 1);
  b.kit('interior.batch3.sunyang.R14', 3, L3);
}

/** 十千脚店三批器物落位（R08 后院灶与茶棚 / L2 西阁子挂件） */
function dressShiqianBatch3(b: Baker): void {
  const L2 = 4.36;
  doubleStove(b, 125.8, 0, 56.3, 1);
  teaShed(b, 127.9, 0, 54.5, 1);
  tearStone(b, 128.6, 0, 56.4, 1);
  b.kit('interior.batch3.shiqian.R08', 3, 0);

  wishCords(b, 122, L2, 62.2, 1);
  mistCurtain(b, 122, L2, 64.4, 1);
  b.kit('interior.batch3.shiqian.R04', 2, L2);
}

/** 府衙三批器物落位（门厅更鼓与石栏 / R01 仪门 / R02 照壁 / R03 楹联与金丹 / R10 戒石亭 / R09 牢栅与地藏龛 / R06 白烛阵） */
function dressYamenBatch3(b: Baker): void {
  const F = 1.02; // 金砖地面（台基 0.9 + 金砖 0.12）
  nightDrum(b, 570.2, 0.9, -67.5, 1);
  stoneBaluster(b, 554.8, 0.9, -67.7, 1);
  stoneBaluster(b, 565.2, 0.9, -67.7, 1);
  b.kit('interior.batch3.yamen.gate', 3, 0.9);

  ceremonialGate(b, 560, F, -70.6, 1);
  b.kit('interior.batch3.yamen.R01', 1, F);

  xiezhiScreen(b, 556, F, -72.4, 1);
  b.kit('interior.batch3.yamen.R02', 1, F);

  coupletEast(b, 554.5, 1.7, -71.05, 1);
  coupletWest(b, 565.5, 1.7, -71.05, 1);
  goldenElixir(b, 558.95, 1.96, -77.55, 1);
  b.kit('interior.batch3.yamen.R03', 3, F);

  candleArray(b, 551, F, -72.2, 1);
  b.kit('interior.batch3.yamen.R06', 1, F);

  jailBars(b, 569.4, F, -79.35, 1);
  dizangNiche(b, 566.6, F, -79.35, 1);
  b.kit('interior.batch3.yamen.R09', 2, F);

  stonePavilion(b, 567.1, F, -76.6, 1);
  b.kit('interior.batch3.yamen.R10', 1, F);
}

/** 孙羊正店四批真物件落位（R04 库房账房 / R01 门厅 / R03 酒垆 / R02 散座 / R15 灶间 / R16 柴场 / L2 药房 / L3 天阁） */
function dressSunyangBatch4(b: Baker): void {
  const F = 0.72, L2 = 4.65, L3 = 7.75;
  crate(b, 217.1, F, 60.6, 1);
  cashChest(b, 218.05, F, 60.5, 1);
  goodsCrate(b, 219, F, 60.5, 1);
  pasteBucket(b, 219.6, F, 61.2, 1);
  brocadeBox(b, 219.3, F, 62.3, 1);
  medicineScale(b, 217.85, 1.82, 61.96, 1);
  inkstone(b, 217.03, 1.82, 61.95, 1);
  b.kit('interior.batch4.sunyang.R04', 7, F);

  moneyGateBox(b, 221.6, F, 71.2, 1);
  meritBox(b, 231.4, F, 71.2, 1);
  b.kit('interior.batch4.sunyang.R01', 2, F);

  wineWarmer(b, 222.79, 1.84, 60.9, 1);
  b.kit('interior.batch4.sunyang.R03', 1, 1.84);

  wineDish(b, 226.8, 1.515, 64.85, 1);
  b.kit('interior.batch4.sunyang.R02', 1, 1.515);

  waterPail(b, 235, F, 62.4, 1);
  b.kit('interior.batch4.sunyang.eastAisle', 1, F);

  cakeStove(b, 216.95, 0.05, 56.15, 1);
  slopPail(b, 218.2, 0.05, 58.9, 1);
  b.kit('interior.batch4.sunyang.R15', 2, 0.05);

  brokenCrate(b, 216.9, 0.05, 54.2, 1);
  fruitBarrel(b, 220.2, 0.05, 54.2, 1);
  copperMill(b, 220.05, 0.05, 55, 1);
  ironDing(b, 216.85, 0.05, 55.2, 0.8);
  b.kit('interior.batch4.sunyang.yard', 4, 0.05);

  woodLadder(b, 231, 0.05, 53.15, 1);
  b.kit('interior.batch4.sunyang.R16', 1, 0.05);

  hundredEyeCabinet(b, 217.45, L2, 68, 1);
  b.kit('interior.batch4.sunyang.R09', 1, L2);

  ledgerBook(b, 229.05, 5.75, 61.15, 1);
  b.kit('interior.batch4.sunyang.R07', 1, 5.75);

  incenseScale(b, 228.2, L3, 63.2, 1);
  incenseSealMold(b, 229.4, L3, 63.2, 1);
  goldenLionCenser(b, 227.05, L3, 64.7, 1);
  b.kit('interior.batch4.sunyang.R14', 3, L3);
}

/** 十千脚店四批真物件落位（R02 柜区投宿登记 / R03 散座 / R06 客舍 / R08 后院） */
function dressShiqianBatch4(b: Baker): void {
  teaSieve(b, 119.45, 1.8, 59.2, 1);
  paperWrap(b, 119.85, 1.8, 59.2, 1);
  guestLedger(b, 117.42, 1.8, 59.33, 1);
  b.kit('interior.batch4.shiqian.R02', 3, 1.8);

  fruitScale(b, 124.2, 0.72, 66.9, 1);
  b.kit('interior.batch4.shiqian.R03', 1, 0.72);

  bathTub(b, 115.3, 0, 56.6, 1);
  b.kit('interior.batch4.shiqian.R06', 1, 0);

  teaMill(b, 128.95, 0, 57.5, 1);
  spiralStair(b, 115, 0, 51.6, 1);
  b.kit('interior.batch4.shiqian.R08', 2, 0);
}

/** 府衙四批真物件落位（R06 六房当票 / R08 六房登记案 / R01 门厅铜鼎） */
function dressYamenBatch4(b: Baker): void {
  const F = 1.02;
  pawnLedger(b, 549.65, 2.95, -75.2, 1);
  b.kit('interior.batch4.yamen.R06', 1, 2.95);

  registerBook(b, 555, 2.12, -70, 1);
  b.kit('interior.batch4.yamen.R08', 1, 2.12);

  bronzeDing(b, 558, F, -69.15, 0.9);
  b.kit('interior.batch4.yamen.R01', 1, F);
}

/** 孙羊正店五批商货落位（R01 门厅筐篮担 / R02 傀儡棚 / R03 酒垆 / R04 库房作坊 / R06 波斯毯 / R08 雅间阁子 / R09 书函 / R14 天阁戏幔四宝 / R15 蒸笼 / R16 后院货堆） */
function dressSunyangBatch5(b: Baker): void {
  const F = 0.72, L2 = 4.65, L3 = 7.75;
  eaveFruitBasket(b, 228.6, 2.32, 71.9, 1);
  bambooPlanter(b, 234.9, F, 70.7, 1);
  wineCarryPole(b, 220.1, F, 71.4, 1);
  b.kit('interior.batch5.sunyang.R01', 3, F);

  puppetStage(b, 234.4, F, 66.9, 1);
  b.kit('interior.batch5.sunyang.R02', 1, F);

  wineCounter(b, 226.4, F, 61.6, 1);
  b.kit('interior.batch5.sunyang.R03', 1, F);

  pulsePillow(b, 217.55, 1.82, 62.47, 1);
  balanceScale(b, 217.1, 1.28, 60.6, 1);
  beastLock(b, 218.9, 1.0, 60.81, 1);
  shoeLast(b, 218.75, F, 63.5, 1);
  awlBasket(b, 219.55, F, 63.35, 1);
  tailorRule(b, 220.35, F, 63.55, 1);
  tailorShears(b, 219.15, F, 63.9, 1);
  b.kit('interior.batch5.sunyang.R04', 7, F);

  persianRug(b, 232.8, 4.655, 66.5, 1);
  b.kit('interior.batch5.sunyang.R06', 1, L2);

  privateBooth(b, 222.9, L2, 62.6, 1);
  b.kit('interior.batch5.sunyang.R08', 1, L2);

  bookCase(b, 218.75, L2, 66.95, 1);
  b.kit('interior.batch5.sunyang.R09', 1, L2);

  stageCurtain(b, 230.35, L3, 60.35, 0.76);
  brassGong(b, 229.7, L3, 61.4, 1);
  arenaRail(b, 220.2, L3, 67.2, 1);
  relicCasket(b, 228.7, L3, 65.9, 1);
  b.kit('interior.batch5.sunyang.R14', 4, L3);

  steamerStack(b, 220.45, 0.05, 56.45, 1);
  b.kit('interior.batch5.sunyang.R15', 1, 0.05);

  mooringPost(b, 233.4, 0.05, 52.6, 1);
  sackStack(b, 224.4, 0.05, 52.7, 1);
  toolRack(b, 217.6, 0.05, 53.1, 1);
  chickenCoop(b, 234.6, 0.05, 54.6, 1);
  b.kit('interior.batch5.sunyang.R16', 4, 0.05);
}

/** 十千脚店五批商货落位（R01 渡资牌 / R03 茶酒担与影戏亮子 / R06 纸马角与客舍箱席 / R07 井与拴马桩 / R08 沙圈衣杆官秤） */
function dressShiqianBatch5(b: Baker): void {
  const F = 0.72;
  ferrySign(b, 116.4, F, 69.0, 1);
  b.kit('interior.batch5.shiqian.R01', 1, F);

  teaWineCarry(b, 116.3, F, 62.6, 1);
  shadowScreen(b, 115.9, F, 65.4, 1);
  b.kit('interior.batch5.shiqian.R03', 2, F);

  paperVilla(b, 124.6, 0, 53.2, 1);
  spiritCoinString(b, 125.2, 0, 52.6, 1);
  clothesChest(b, 118.3, 0, 54.5, 1);
  strawMat(b, 119.9, 0.69, 54.5, 1);
  b.kit('interior.batch5.shiqian.R06', 4, 0);

  wellWindlass(b, 128.9, 0, 51.0, 1);
  horsePost(b, 115.2, 0, 52.6, 1);
  b.kit('interior.batch5.shiqian.R07', 2, 0);

  sandRing(b, 119.9, 0, 55.95, 0.62);
  clothesPole(b, 123.0, 0, 55.0, 1);
  beamScale(b, 123.6, 0, 58.0, 1);
  b.kit('interior.batch5.shiqian.R08', 3, 0);
}

/** 府衙五批商货落位（R01 门后哨棒 / R02 仪门石狮 / R06 牙帖榜 / R09 护窗铁栅 / R10 廊下坐墩） */
function dressYamenBatch5(b: Baker): void {
  const F = 1.02;
  guardClub(b, 554.0, F, -68.65, 1);
  b.kit('interior.batch5.yamen.R01', 1, F);

  stoneLion(b, 560, F, -70.6, 1);
  b.kit('interior.batch5.yamen.R02', 1, F);

  guildBoard(b, 555.6, 1.9, -79.55, 1);
  b.kit('interior.batch5.yamen.R06', 1, F);

  windowGrille(b, 570.56, F, -76.9, 1);
  b.kit('interior.batch5.yamen.R09', 1, F);

  ceramicStool(b, 566.4, F, -72.7, 1);
  b.kit('interior.batch5.yamen.R12', 1, F);
}

/** 孙羊正店六批商货落位（R01 门厅货担与市鼓 / R03 酒垆量器 / R04 库房三栈 / R05 巾帽架 / L2 药栈与斋匾 / L3 天阁供案 / R16 后院棚车井缸） */
function dressSunyangBatch6(b: Baker): void {
  const F = 0.72, L2 = 4.65, L3 = 7.75, Y = 0.05;
  notionCarry(b, 223.3, F, 71.7, 1);
  eaveClayStove(b, 217.7, F, 70.8, 1);
  marketDrum(b, 233.6, F, 71.6, 1);
  b.kit('interior.batch6.sunyang.R01', 3, F);

  grainDou(b, 230.3, F, 60.45, 1);
  b.kit('interior.batch6.sunyang.R03', 1, F);

  fruitShopRack(b, 216.75, F, 65.9, 1);
  porcelainShopRack(b, 216.75, F, 67.6, 1);
  b.kit('interior.batch6.sunyang.R04', 2, F);

  capShopRack(b, 234.2, F, 62.9, 1);
  b.kit('interior.batch6.sunyang.R05', 1, F);

  incenseShopRack(b, 217.35, L2, 70.4, 1);
  studyPlaque(b, 219.9, 6.25, 59.96, 1);
  b.kit('interior.batch6.sunyang.R09', 2, L2);

  peachOffering(b, 233.8, L3, 68.4, 1);
  b.kit('interior.batch6.sunyang.R14', 1, L3);

  grainDryingYard(b, 220.9, Y, 50.9, 1);
  camelGodown(b, 217.0, Y, 50.4, 1);
  grainCart(b, 221.8, Y, 52.65, 1);
  sharedStoveShed(b, 223.4, Y, 50.5, 1);
  godownAwning(b, 226.4, Y, 50.9, 1);
  cargoCrane(b, 232.0, Y, 51.0, 1);
  woodArchway(b, 226.4, Y, 53.0, 1);
  b.kit('interior.batch6.sunyang.R16a', 7, Y);

  brokenWillow(b, 219.2, Y, 52.0, 1);
  culvertMouth(b, 219.9, Y, 53.0, 1);
  clayWaterVat(b, 215.9, Y, 52.2, 1);
  wallLocust(b, 235.2, Y, 50.4, 1);
  b.kit('interior.batch6.sunyang.R16b', 4, Y);

  stoneWaterVat(b, 215.4, Y, 56.8, 1);
  yardWell(b, 215.3, Y, 54.3, 1);
  b.kit('interior.batch6.sunyang.R16c', 2, Y);
}

/** 十千脚店六批商货落位（R01 檐下弓架 / R03 列棚与茶座 / R05 陶缸摊棚火塘小灶 / R06 香客棚 / R07 草料槽垛与驼棚 / R08 后厨三灶与鱼摊） */
function dressShiqianBatch6(b: Baker): void {
  const F = 0.72;
  bowRack(b, 115.4, F, 60.6, 1);
  b.kit('interior.batch6.shiqian.R01', 1, F);

  stallRow(b, 122.0, F, 61.0, 1);
  teaStallSeat(b, 124.3, F, 63.4, 1);
  b.kit('interior.batch6.shiqian.R03', 2, F);

  clayWaterVat(b, 126.3, F, 62.3, 1);
  stallAwning(b, 119.2, F, 68.7, 1);
  snowFirePit(b, 121.6, F, 69.9, 1);
  smallClayStove(b, 115.4, F, 67.3, 1);
  b.kit('interior.batch6.shiqian.R05', 4, F);

  pilgrimShed(b, 121.9, 0, 56.3, 1);
  b.kit('interior.batch6.shiqian.R06', 1, 0);

  fodderTrough(b, 115.4, 0, 50.2, 1);
  fodderStack(b, 115.5, 0, 55.2, 1);
  camelShed(b, 117.5, 0, 55.9, 1);
  b.kit('interior.batch6.shiqian.R07', 3, 0);

  kitchenClayStove(b, 115.6, F, 63.6, 1);
  b.kit('interior.batch6.shiqian.R02', 1, F);

  twinClayStove(b, 124.2, 0, 57.05, 1);
  fishStall(b, 119.6, 0, 50.3, 1);
  b.kit('interior.batch6.shiqian.R08', 2, 0);
}

/** 府衙六批商货落位（R06 官斛官尺 / R08 库房官斛与碑碣 / R09 功德碑林 / R04 廊下茶座） */
function dressYamenBatch6(b: Baker): void {
  const F = 1.02;
  teaStallSeat(b, 551.4, F, -70.4, 1);
  b.kit('interior.batch6.yamen.R04', 1, F);

  officialMeasure(b, 550.9, F, -74.4, 1);
  b.kit('interior.batch6.yamen.R06', 1, F);

  officialHu(b, 551.2, F, -76.6, 1);
  stoneStelae(b, 552.6, F, -78.4, 1);
  b.kit('interior.batch6.yamen.R08', 2, F);

  meritSteleRow(b, 569.2, F, -74.6, 1);
  b.kit('interior.batch6.yamen.R09', 1, F);
}

/** 孙羊正店 WS-41 器物落位（R06 雅间堂匾 / R14 天阁签筒 / R15 灶间大灶 / R16 后院丹炉与后灶） */
function dressSunyangBatch7(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const L2 = 4.65, L3 = 7.75, Y = 0.05;
  // 宅匾「積善堂」：C-ITM-0401（木金漆 · 正房堂匾）——積善坊卢宅正房无室内壳，落 L2 主雅间北壁堂位
  hallPlaque(b, 224.6, 6.9, 60.02, 1);
  sg.quad(atlas.text('jishantang', '積善堂', 384, 112, { color: '#ffd700', bg: 'rgba(0,0,0,0)' }), 2.7, 0.79, 224.6, 6.9, 60.15, 0);
  b.kit('interior.batch7.sunyang.R06', 1, 6.9);

  // 脱险签筒：C-ITM-0330（竹 · 廊下求签）——镇江王庙廊下无室内壳，落 L3 天阁供案东侧
  signTubeEscape(b, 234.4, L3, 70.6, 1);
  b.kit('interior.batch7.sunyang.R14', 1, L3);

  // 双眼猛火灶：C-ITM-0267（砖铁 · 灶间）——飯鋪灶间无室内壳，落 R15 大灶厨主灶位
  greatStove(b, 221.6, Y, 57.7, 1);
  b.kit('interior.batch7.sunyang.R15', 1, Y);

  // 三足丹炉：C-ITM-0178（铁铜 · 丹房）——上清观丹房无室内壳，落 R16 后院香药炮制作坊
  elixirFurnace(b, 228.8, Y, 58.2, 1);
  // 后灶：C-ITM-0455（砖土 · 后灶间）——小店附宅后灶，落 R16 后院后院墙下
  backStove(b, 231.8, Y, 55.9, 1);
  b.kit('interior.batch7.sunyang.R16', 2, Y);
}

/** 十千脚店 WS-41 器物落位（R06 香客棚签筒 / R03 散座茶担） */
function dressShiqianBatch7(b: Baker): void {
  const F = 0.72;
  // 感应签筒 ×2：C-ITM-0171（竹 · 签案求签）——上清观签案无室内壳，落 R06 香客棚东侧签案位
  signTube(b, 123.5, 0, 55.9, 1);
  signTube(b, 124.5, 0, 55.9, 1);
  b.kit('interior.batch7.shiqian.R06', 2, 0);

  // 茶担：C-ITM-0314（竹铜 · 亭内凉茶热茶）——柳林茶亭无室内壳，落 R03 散座堂东侧茶位
  teaCarryLoad(b, 127.8, F, 66.4, 1);
  b.kit('interior.batch7.shiqian.R03', 1, F);
}

/** 府衙 WS-41 器物落位（R01 门厅暮鼓 / R06 六房天平） */
function dressYamenBatch7(b: Baker): void {
  const F = 1.02;
  // 暮鼓：C-ITM-0176（皮木 · 鼓楼击鼓）——上清观鼓楼无室内壳，落 R01 门厅鼓位（与登闻鼓、更鼓分立）
  greatDrum(b, 560.3, 0.9, -67.6, 1);
  b.kit('interior.batch7.yamen.R01', 1, 0.9);

  // 公平秤（天平）：C-ITM-0227（铜木 · 楼前亭复秤）——市楼前亭无室内壳，落 R06 户房官秤位
  fairScale(b, 552.3, F, -72.9, 1);
  b.kit('interior.batch7.yamen.R06', 1, F);
}

/** 三地标内饰总装（buildings.ts 手工地标段调用，替代通用盒体） */
export function buildLandmarkInteriors(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // 孙羊正店/十千脚店都在北岸正街北侧，须面向 -z 的街道。
  // 两座地标按 +z 正面写成，这里整组 180° 转向（后院因此落到屋后、欢门对着街）。
  b.yawAbout(226, 66); sg.yawAbout(226, 66);
  buildSunyang(b, sg, atlas);
  buildSunyangInteriorAtoms(b);
  dressSunyang(b);
  dressSunyangBatch2(b);
  dressSunyangBatch3(b);
  dressSunyangBatch4(b);
  dressSunyangBatch5(b);
  dressSunyangBatch6(b);
  dressSunyangBatch7(b, sg, atlas);
  b.yawAbout(); sg.yawAbout();

  b.yawAbout(122, 64); sg.yawAbout(122, 64);
  buildShiqian(b, sg, atlas);
  buildShiqianInteriorAtoms(b);
  dressShiqian(b);
  dressShiqianBatch2(b);
  dressShiqianBatch3(b);
  dressShiqianBatch4(b);
  dressShiqianBatch5(b);
  dressShiqianBatch6(b);
  dressShiqianBatch7(b);
  b.yawAbout(); sg.yawAbout();

  buildYamenHall(b, sg, atlas);
  buildYamenInteriorAtoms(b);
  dressYamen(b);
  dressYamenBatch2(b);
  dressYamenBatch3(b);
  dressYamenBatch4(b);
  dressYamenBatch5(b);
  dressYamenBatch6(b);
  dressYamenBatch7(b);
}

/** 英雄叙事道具烘焙（B4）：杨志草标宝刀（州桥）+ 花荣箭靶（射圃） */
export function bakeHeroStageProps(b: Baker): void {
  // 杨志卖刀（CH-C-017：宝刀插草标横抱怀中）@ 州桥 (0,20)
  const dy = bridgeDeckY(21.4) + 0.02; // 桥面基准（与杨志/牛二同高程）
  b.box('wood', 0.06, 0.85, 0.03, 2.2, dy + 0.42, 21.4, 0x6e7e76, 0.5, 0, 0.18); // 宝刀斜倚
  b.box('wood', 0.05, 0.3, 0.05, 2.2, dy + 0.95, 21.4, 0x9aa04a, 0.5, 0, -0.3);  // 草标
  b.box('wood', 0.04, 0.22, 0.04, 2.32, dy + 0.9, 21.3, 0x9aa04a, -0.4, 0, 0.25);
  // 州桥夜市灯彩（精修5，20 卷 E15 州桥夜市：桥栏 8 盏+两岸灯串杆）
  for (let i = 0; i < 8; i++) {
    const z = 12 + i * 7;
    const deck = bridgeDeckY(z);
    b.box('wood', 0.08, 1.1, 0.08, 14.2, deck + 0.6, z, 0x2c2018);
    b.box('glow', 0.26, 0.36, 0.26, 14.2, deck + 1.35, z, i % 2 ? 0xff8a5a : 0xffa04e);
    b.box('wood', 0.08, 1.1, 0.08, -14.2, deck + 0.6, z, 0x2c2018);
    b.box('glow', 0.26, 0.36, 0.26, -14.2, deck + 1.35, z, i % 2 ? 0xffa04e : 0xff8a5a);
  }
  for (const sx of [-20, 20]) {
    b.box('wood', 0.14, 5.2, 0.14, sx, 2.6, 44, C.woodDark);
    for (let k = 0; k < 5; k++) b.cyl('glow', 0.2, 0.2, 0.3, 6, sx - 3 + k * 1.5, 5.4 - Math.sin(k / 4 * Math.PI) * 1.6, 44, k % 2 ? C.lantern : C.neonGold);
  }
  // 花荣射柳箭靶 ×2（柳林射圃 (-450,90)，CH-C-009 教习）
  for (const [tx, tz] of [[-442, 96], [-452, 99]] as const) {
    b.cyl('wood', 0.55, 0.55, 0.12, 10, tx, 1.5, tz, 0xd8ccae, 0, Math.PI / 2);
    b.cyl('wood', 0.2, 0.2, 0.13, 10, tx, 1.5, tz, 0xa63a2b, 0, Math.PI / 2);
    b.box('wood', 0.1, 1.5, 0.1, tx, 0.75, tz + 0.1, C.woodDark);
  }
}


// ============ v3 W4：9 座程序化街屋室内壳（店铺 / 民居 / 酒肆 / 茶坊） ============
// 缘起：三处地标（孙羊 / 十千 / 府衙）有手工室内壳，其余街屋由 buildBuilding 造出实心体块
// （b.box('wall', w, bodyH+0.8, d, …)），室内一律为空、器物只能"按语义就近"摆在屋外。
// 本段给 9 座「字面定位」的街屋各补一层室内壳：
//   地坪 + 踢脚 + 四面内衬墙（正面留门洞与两樘支摘窗洞）+ 露明梁架（两榀抬梁 / 檩 / 椽 / 望板）
//   + 门内影壁或屏门 + 按形制摆 8–15 件陈设（每件用相对房间中心的 x/z 与朝向落位）。
//
// 四条纪律：
//  ① 不取用 rng 的随机流（只读 seed 当盐），world.ts 的 RNG 调用序列零扰动；
//  ② 不新增 b.kit() id（台账 838/838 不动，件量记在既有 itemKit 自带的 id 上）；
//  ③ 大面不用 wall 组（自带蓝灰自发光）：内衬墙用板壁 wood / 夯土 earth；
//     陶瓷 ceramic、铜器 metal、布幔 fabric、漆器 lacquer、灯芯 glow（小面积）；
//  ④ 尺寸按宋式：桌高 0.79（表 0.74+台面）、凳高 0.46、柜台 0.95、床榻 2.1×1.2、酒瓮 0.83。
//
// 可见性（务必转告编排者）：街屋体块是单面（FrontSide）闭合壳，相机进到体块内部后外墙面
// 被剔除，室内壳才可见——即本段解决的是「进屋之后」的室内。若要让街上也望得进店面，
// 需要在 buildings.ts 的 buildBuilding 给这 9 座开正面门洞（本文件无权改）。

/** 街屋形制：店铺 / 民居 / 酒肆 / 茶坊 */
export type StreetRoomKind = 'shop' | 'house' | 'tavern' | 'teahouse';

export interface StreetHouseSpec {
  /** 房屋中心（与 buildBuilding 的 x/z 同义） */
  x: number;
  z: number;
  /** 面阔 / 进深（buildBuilding 的 w / d，含墙厚） */
  w: number;
  d: number;
  kind: StreetRoomKind;
  /** 正面朝向；本表只用 0 与 π（0 = 朝 +z，π = 朝 -z，与 buildBuilding 同义） */
  ry?: number;
  /** 室内地平，缺省 0.6（= buildBuilding 台基面）；仓廒类 0.86 */
  y0?: number;
  /** 檐下净高，缺省 3.2 */
  h?: number;
  /** 店名 */
  name?: string;
  /** 货架摆货行当（店铺用） */
  trade?: 'medicine' | 'pawn' | 'paper' | 'incense' | 'general';
  /** 幌子内侧字面（1–5 字，缺省不贴） */
  banner?: string;
}

/**
 * 9 座街屋锚点。全部是代码里**字面定位**的实体房屋（buildings.ts 的固定 buildBuilding 调用
 * 与 props.ts 的 propGranary），不是 streetPlots 的随机地块——
 * 随机地块的 x 依赖 rng 在 scatterVegetation 之后的内部状态，离线不可复算，
 * 把猜出来的坐标写死会把室内壳摆到房屋之间 1.5–5m 的空隙里（悬空）。
 * 编排者若要改挂到随机地块上，在 buildings.ts 的 emit 里用 plot 组 houses 传给本函数即可。
 */
export const STREET_HOUSE_SLOTS: StreetHouseSpec[] = [
  { x: 168, z: 64, w: 9, d: 8, kind: 'shop', name: '趙太丞家', trade: 'medicine', banner: '太丞家' },
  { x: 258, z: 64, w: 10, d: 8, kind: 'shop', name: '解', trade: 'pawn', banner: '解當' },
  { x: 352, z: 66, w: 12, d: 9, kind: 'shop', name: '王家紙馬', trade: 'paper', banner: '王家紙馬' },
  { x: 40, z: 62, w: 10, d: 8, kind: 'shop', name: '香藥鋪', trade: 'incense', banner: '香藥' },
  { x: -36, z: 62, w: 11, d: 9, kind: 'teahouse', name: '茶坊' },
  { x: 540, z: 118, w: 16, d: 10, kind: 'teahouse', name: '上清茶寮' },
  { x: -258, z: 36.6, w: 8.4, d: 5.2, ry: Math.PI, y0: 0.86, h: 4.0, kind: 'tavern', name: '倉前酒肆', banner: '酒' },
  { x: -208, z: 36.6, w: 8.4, d: 5.2, ry: Math.PI, y0: 0.86, h: 4.0, kind: 'house', name: '倉前民家' },
  { x: -330, z: 36.6, w: 8.4, d: 5.2, ry: Math.PI, y0: 0.86, h: 4.0, kind: 'house', name: '轉運倉民家' },
];

/** 坐标 hash（0–1）：替掉 rng 抽签，房间之间才会出现器物差异而不扰动共享随机流 */
function h01(x: number, z: number, k: number): number {
  let h = Math.imul((Math.round(x * 53) ^ 0x9e3779b9) + k * 0x27d4eb2d, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const R_PLANK = 0x6b4a2b;   // M-05 板壁
const R_PLANK_D = 0x3a2c22; // 板壁压暗（棂条 / 门框）
const R_BEAM = 0x5a3f26;    // 梁枋
const R_DECK = 0x3f2c1c;    // 望板（桐油深褐）
const R_EARTH = 0xb9a988;   // 夯土墙（民居）
const R_BRICK = 0x6b7076;   // 素方砖地
const R_BRICK_L = 0x474c52; // 砖缝

interface Room {
  b: Baker;
  sg: SignMesher;
  atlas: SignAtlas;
  cx: number;
  cz: number;
  /** 净空半阔 / 半深 */
  u: number;
  v: number;
  y0: number;
  h: number;
  salt: number;
  box: (g: BGroup, w: number, hh: number, dd: number, lu: number, y: number, lv: number, hex: number, rx?: number, rz?: number) => void;
  cyl: (g: BGroup, rt: number, rb: number, hh: number, seg: number, lu: number, y: number, lv: number, hex: number, rx?: number, rz?: number) => void;
  put: (fn: ItemBuilder, lu: number, y: number, lv: number, s?: number) => void;
  banner: (text: string, key: string, bw: number, bh: number, lu: number, y: number, lv: number, ry: number) => void;
}

function makeRoom(b: Baker, sg: SignMesher, atlas: SignAtlas, s: StreetHouseSpec, idx: number): Room {
  const cx = s.x, cz = s.z;
  return {
    b, sg, atlas, cx, cz,
    u: s.w / 2 - 0.3,
    v: s.d / 2 - 0.3,
    y0: s.y0 ?? 0.6,
    h: s.h ?? 3.2,
    salt: h01(cx, cz, idx),
    box: (g, w, hh, dd, lu, y, lv, hex, rx = 0, rz = 0) => b.box(g, w, hh, dd, cx + lu, y, cz + lv, hex, 0, rx, rz),
    cyl: (g, rt, rb, hh, seg, lu, y, lv, hex, rx = 0, rz = 0) => b.cyl(g, rt, rb, hh, seg, cx + lu, y, cz + lv, hex, 0, rx, rz),
    put: (fn, lu, y, lv, sc = 1) => fn(b, cx + lu, y, cz + lv, sc),
    banner: (text, key, bw, bh, lu, y, lv, ry) => {
      sg.quad(atlas.text(key, text, 128, 256, {
        color: '#f0ead6', vertical: true, fontPx: 52, bg: 'rgba(43,43,43,0.82)',
      }), bw, bh, cx + lu, y, cz + lv, ry);
    },
  };
}

/**
 * 室内壳公共段：地坪 / 内衬墙（正面门洞 + 两樘窗洞）/ 踢脚 / 角柱 / 门框 /
 * 露明梁架（两榀抬梁 + 檩 + 椽 + 望板）/ 支摘窗内侧扇。
 * 返回地坪上皮高度（陈设的落位基准）。
 */
function roomShell(R: Room, floor: 'brick' | 'wood' | 'earth'): number {
  const { box, cyl, u, v, y0, h } = R;
  const top = y0 + h;
  const F = y0 + 0.02;
  const t = 0.12;
  const dW = Math.min(1.7, u * 0.52);
  const winOut = dW / 2 + 1.55;
  const sillY = F + 1.02;
  const headY = F + 2.04;
  const wallG: BGroup = floor === 'earth' ? 'earth' : 'wood';
  const wallC = floor === 'earth' ? R_EARTH : R_PLANK;

  // ① 地坪（素方砖 / 木地板 / 夯土三合土）
  if (floor === 'brick') {
    box('ash', u * 2, 0.14, v * 2, 0, F - 0.07, 0, R_BRICK);
    for (let i = -2; i <= 2; i++) {
      box('ash', u * 2, 0.012, 0.03, 0, F + 0.004, i * v * 0.4, R_BRICK_L);
      box('ash', 0.03, 0.012, v * 2, i * u * 0.4, F + 0.004, 0, R_BRICK_L);
    }
  } else if (floor === 'wood') {
    box('wood', u * 2, 0.14, v * 2, 0, F - 0.07, 0, 0x7a5636);
    for (let i = -3; i <= 3; i++) box('wood', u * 2, 0.01, 0.026, 0, F + 0.003, i * v * 0.27, R_DECK);
  } else {
    box('earth', u * 2, 0.14, v * 2, 0, F - 0.07, 0, 0x8a7a5e);
    box('earth', u * 2 - 0.7, 0.012, v * 2 - 0.7, 0, F + 0.002, 0, 0x7a6a4e);
  }

  // ② 内衬墙：背 / 左右整墙，正面分三段留门洞与窗洞
  box(wallG, u * 2 + t * 2, h, t, 0, y0 + h / 2, -(v + t / 2), wallC);
  for (const su of [-1, 1]) box(wallG, t, h, v * 2 + t * 2, su * (u + t / 2), y0 + h / 2, 0, shade(wallC, 0.96));
  const segW = u - dW / 2;
  for (const su of [-1, 1]) {
    box(wallG, segW, sillY - y0, t, su * (dW / 2 + segW / 2), (y0 + sillY) / 2, v + t / 2, wallC);
    box(wallG, u - winOut, headY - sillY, t, su * (winOut + (u - winOut) / 2), (sillY + headY) / 2, v + t / 2, wallC);
  }
  box(wallG, u * 2, top - headY, t, 0, (headY + top) / 2, v + t / 2, wallC);

  // ③ 踢脚线（0.32 高，压住墙根与地板缝）
  box('wood', u * 2, 0.32, 0.06, 0, y0 + 0.18, -(v - 0.03), R_PLANK_D);
  for (const su of [-1, 1]) {
    box('wood', 0.06, 0.32, v * 2, su * (u - 0.03), y0 + 0.18, 0, R_PLANK_D);
    box('wood', segW, 0.32, 0.06, su * (dW / 2 + segW / 2), y0 + 0.18, v - 0.03, R_PLANK_D);
  }

  // ④ 四角柱
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    box('wood', 0.16, h, 0.16, su * (u - 0.05), y0 + h / 2, sv * (v - 0.05), R_PLANK_D);
  }

  // ⑤ 门框 + 门槛（门洞 1.7m 上限，留一条通到街上的开口）
  for (const su of [-1, 1]) box('wood', 0.15, 2.12, 0.17, su * (dW / 2 + 0.075), y0 + 1.06, v - 0.02, R_PLANK_D);
  box('wood', dW + 0.4, 0.16, 0.2, 0, y0 + 2.14, v - 0.02, R_PLANK_D);
  box('ash', dW + 0.3, 0.14, 0.24, 0, y0 + 0.07, v - 0.02, 0x8d8a80);

  // ⑥ 梁架：两榀抬梁（柱 + 大梁 + 瓜柱 + 平梁 + 脊瓜柱 + 叉手）
  const ridgeY = top - 0.18;
  const eaveY = top - 0.62;
  const run = v;
  const rise = ridgeY - eaveY;
  const slope = Math.atan2(rise, run);
  const diag = Math.hypot(run, rise);
  const beamY = y0 + h * 0.7;
  const flatY = ridgeY - 0.34;
  for (const sv of [-1, 1]) {
    const fv = sv * v * 0.45;
    for (const su of [-1, 1]) {
      const pu = su * (u - 0.5);
      cyl('wood', 0.1, 0.115, beamY - y0 + 0.06, 8, pu, (y0 + beamY) / 2, fv, R_PLANK);
      box('ash', 0.34, 0.16, 0.34, pu, y0 + 0.08, fv, 0x8d8a80);
    }
    box('wood', u * 2 - 0.9, 0.22, 0.2, 0, beamY, fv, R_BEAM);
    for (const su of [-1, 1]) box('wood', 0.14, flatY - beamY, 0.14, su * 0.55, (beamY + flatY) / 2, fv, R_PLANK);
    box('wood', 1.5, 0.17, 0.17, 0, flatY, fv, R_PLANK);
    box('wood', 0.13, ridgeY - flatY, 0.13, 0, (flatY + ridgeY) / 2, fv, R_BEAM);
    for (const su of [-1, 1]) box('wood', 0.085, 0.6, 0.085, su * 0.42, flatY + 0.14, fv, R_DECK, 0, su * 0.55);
  }

  // ⑦ 檩条（脊檩 + 金檩 + 檐檩，沿面阔方向）
  const purlin = (lv: number, py: number, r = 0.085) => cyl('wood', r, r, u * 2 + 0.2, 8, 0, py, lv, R_BEAM, 0, Math.PI / 2);
  purlin(0, ridgeY + 0.06, 0.1);
  for (const sv of [-1, 1]) {
    purlin(sv * run * 0.42, eaveY + rise * 0.58);
    purlin(sv * run * 0.82, eaveY + rise * 0.18);
  }

  // ⑧ 椽 + 望板 + 脊（露明造：不是一块平板，望板下能看见椽与檩）
  const nR = Math.max(5, Math.round((u * 2) / 0.44));
  for (let i = 0; i < nR; i++) {
    const lu = -u + 0.22 + (u * 2 - 0.44) * (i / (nR - 1));
    for (const sv of [-1, 1]) {
      box('wood', 0.07, 0.07, diag - 0.12, lu, (ridgeY + eaveY) / 2 - 0.07, sv * run * 0.5, R_DECK, sv * slope, 0);
    }
  }
  for (const sv of [-1, 1]) {
    box('wood', u * 2, 0.045, diag, 0, (ridgeY + eaveY) / 2 + 0.03, sv * run * 0.5, R_DECK, sv * slope, 0);
  }
  box('wood', u * 2 + 0.1, 0.18, 0.16, 0, ridgeY + 0.15, 0, R_BEAM);

  // ⑨ 支摘窗内侧扇：下扇固定、上扇以窗楣为铰支起 45°，撑杆落地
  for (const su of [-1, 1]) {
    const wu = su * ((dW / 2 + winOut) / 2);
    box('wood', 1.3, 0.08, 0.07, wu, headY - 0.04, v - 0.06, R_PLANK_D);
    box('wood', 1.3, 0.08, 0.07, wu, sillY + 0.04, v - 0.06, R_PLANK_D);
    for (const s2 of [-1, 1]) box('wood', 0.08, headY - sillY, 0.07, wu + s2 * 0.61, (sillY + headY) / 2, v - 0.06, R_PLANK_D);
    box('wood', 1.18, 0.5, 0.05, wu, sillY + 0.3, v - 0.11, R_PLANK);
    for (let k = -1; k <= 1; k++) box('wood', 0.04, 0.44, 0.04, wu + k * 0.34, sillY + 0.3, v - 0.15, R_PLANK_D);
    box('wood', 1.18, 0.6, 0.045, wu, sillY + 0.92, v - 0.32, 0x7a5636, 0.78, 0);
    box('wood', 0.035, 0.68, 0.035, wu + su * 0.46, sillY + 0.6, v - 0.22, R_PLANK_D, 0.52, 0);
  }

  return F;
}

/** 室内吊灯：木钩 → 索 → glow 灯笼（人间室内一律暖黄 #FFC66E 系） */
function roomLamp(R: Room, lu: number, lv: number): void {
  const { box, y0, h } = R;
  const ly = y0 + h - 0.72;
  box('wood', 0.05, h * 0.16, 0.05, lu, ly + 0.42, lv, R_PLANK_D);
  box('glow', 0.3, 0.4, 0.3, lu, ly, lv, 0xffa04e);
  box('wood', 0.36, 0.05, 0.36, lu, ly + 0.22, lv, R_PLANK_D);
  box('wood', 0.28, 0.04, 0.28, lu, ly - 0.22, lv, R_PLANK_D);
}

/** 门内影壁 / 屏门：偏置在门内一侧（留 1.2m 通行口），挡住院外直视 */
function doorScreen(R: Room, F: number, kind: StreetRoomKind, side: number): void {
  const { box, u, v } = R;
  const lu = side * u * 0.52;
  const lv = v - 1.05;
  if (kind === 'house') {
    box('earth', 1.5, 1.85, 0.24, lu, F + 0.92, lv, R_EARTH);
    box('ash', 1.62, 0.12, 0.36, lu, F + 1.9, lv, 0x8d8a80);
    box('wood', 1.5, 0.1, 0.3, lu, F + 0.06, lv, 0x6b4a2b);
  } else if (kind === 'tavern') {
    for (const k of [-1, 1]) {
      box('wood', 0.66, 1.86, 0.07, lu + k * 0.36, F + 0.93, lv, 0xf4ecd8);
      box('wood', 0.06, 1.86, 0.1, lu + k * 0.69, F + 0.93, lv, R_PLANK_D);
    }
  } else {
    for (const k of [-1, 0, 1]) {
      box('wood', 0.52, 2.02, 0.07, lu + k * 0.54, F + 1.01, lv, R_PLANK_D);
      box('wood', 0.44, 1.72, 0.05, lu + k * 0.54, F + 1.01, lv + 0.06, 0xf4ecd8);
    }
  }
}

/** 矮桌（茶坊/酒肆用，0.45 高）：面板 + 四腿 + 一圈牙板 */
function lowTable(R: Room, lu: number, lv: number, F: number, w = 1.0, d = 0.6): void {
  const { box } = R;
  box('lacquer', w, 0.07, d, lu, F + 0.44, lv, 0x4a2a20);
  box('wood', w - 0.12, 0.06, d - 0.12, lu, F + 0.37, lv, 0x6b4a2b);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    box('wood', 0.07, 0.4, 0.07, lu + su * (w / 2 - 0.09), F + 0.2, lv + sv * (d / 2 - 0.09), R_PLANK_D);
  }
}

// ---------- 店铺：柜台 + 三层货架（按行当）+ 账桌 + 算盘 + 秤 + 钱柜 + 吊灯 + 幌子内侧 ----------
function dressShop(R: Room, spec: StreetHouseSpec, idx: number, F: number): void {
  const { box, cyl, u, v, y0, put, salt } = R;
  const cv = v - 1.15;

  // ① 柜台：榆木整厚板 2.9×0.62，台面高 0.95（宋式柜台 0.90–0.95）
  box('wood', 2.9, 0.86, 0.6, 0, F + 0.45, cv, R_PLANK);
  box('lacquer', 3.04, 0.07, 0.74, 0, F + 0.925, cv, 0x4a2a20);
  box('lacquer', 2.84, 0.86, 0.06, 0, F + 0.45, cv + 0.32, 0x6e3a26);
  for (const su of [-1, 1]) box('wood', 0.13, 0.9, 0.68, su * 1.45, F + 0.45, cv, R_PLANK_D);

  // ② 右墙三层货架（0.48 / 1.02 / 1.56 三层，按行当摆货）
  const rx0 = u - 0.32;
  for (const sv of [-1, 1]) box('wood', 0.09, 1.94, 0.1, rx0, F + 0.97, -0.75 + sv * 1.2, R_PLANK_D);
  box('wood', 0.04, 1.94, 2.42, rx0 + 0.24, F + 0.97, -0.75, shade(R_PLANK, 0.84));
  const tiers = [0.48, 1.02, 1.56];
  for (const ty of tiers) box('wood', 0.5, 0.05, 2.44, rx0, F + ty, -0.75, R_PLANK);
  const trade = spec.trade ?? 'general';
  for (let ti = 0; ti < tiers.length; ti++) {
    for (let k = 0; k < 4; k++) {
      const gz = -1.56 + k * 0.54;
      const gy = F + tiers[ti] + 0.03;
      const pick = (ti * 4 + k + Math.round(salt * 3)) % 4;
      if (trade === 'medicine') {
        if (pick < 2) put(jar, rx0, gy, gz, 0.42 + pick * 0.05);
        else if (pick === 2) put(bowl, rx0, gy, gz, 0.9);
        else box('fabric', 0.2, 0.16, 0.2, rx0, gy + 0.08, gz, 0xd8cbb0);
      } else if (trade === 'pawn') {
        if (pick === 0) put(scrollRack, rx0, gy, gz, 0.34);
        else if (pick === 1) box('lacquer', 0.28, 0.16, 0.18, rx0, gy + 0.08, gz, 0x5a1f18);
        else box('fabric', 0.22, 0.14, 0.16, rx0, gy + 0.07, gz, 0xd8cbb0);
      } else if (trade === 'paper') {
        if (pick < 2) put(vase, rx0, gy, gz, 0.42);
        else box('fabric', 0.18, 0.24, 0.14, rx0, gy + 0.12, gz, 0xe6dcc2);
      } else {
        if (pick < 2) box('fabric', 0.2, 0.12, 0.16, rx0, gy + 0.06, gz, 0xd8cbb0);
        else put(jar, rx0, gy, gz, 0.38);
      }
    }
  }

  // ③ 背墙货架（2.4m 宽，三层，摆大件 / 存货）
  const bz0 = -(v - 0.28);
  box('wood', 2.48, 0.06, 0.46, 1.0, F + 1.9, bz0, R_PLANK);
  for (const su of [-1, 1]) box('wood', 0.1, 1.9, 0.44, 1.0 + su * 1.2, F + 0.95, bz0, R_PLANK_D);
  for (const ty of [0.52, 1.06, 1.62]) box('wood', 2.42, 0.05, 0.44, 1.0, F + ty, bz0, R_PLANK);
  for (let k = 0; k < 3; k++) {
    put(jar, 0.0 + k * 0.9, F + 0.57, bz0, 0.62);
    put(bowl, 0.35 + k * 0.9, F + 1.11, bz0, 1.0);
    box('fabric', 0.3, 0.22, 0.26, 0.65 + k * 0.9, F + 1.78, bz0, 0xd8cbb0);
  }

  // ④ 账桌（账房位，靠左墙）
  put(accountDesk, -(u - 1.15), F, v - 2.75, 1.0);
  put(teaLedger, -(u - 1.15), F + 1.11, v - 2.75, 1.0);

  // ⑤ 算盘（柜台面，七档十四珠）
  box('lacquer', 0.42, 0.03, 0.24, 1.05, F + 0.975, cv, 0x2e1a16);
  for (let i = 0; i <= 6; i++) box('metal', 0.012, 0.014, 0.22, 1.05 - 0.18 + i * 0.06, F + 0.995, cv, 0xb08a34);
  for (let i = 0; i < 14; i++) {
    box('wood', 0.022, 0.036, 0.022, 1.05 - 0.16 + ((i % 7) * 0.052), F + 1.0, cv + (i < 7 ? -0.06 : 0.06), 0x6b4a2b);
  }

  // ⑥ 秤（亏手杆秤，柜台面）
  put(balanceScale, -1.05, F + 0.96, cv, 0.85);

  // ⑦ 钱柜（柜台内角，铁箍木柜）
  put(cashChest, 2.6, F, v - 0.55, 0.95);

  // ⑧ 坐柜（后墙柜，四门三抽）
  put(cabinet, -(u - 0.72), F, -(v - 0.5), 0.95);

  // ⑨ 柜台后酒坛 / 货篓
  put(jar, 1.9, F, cv + 0.05, 1.0);
  put(jar, 1.55, F, cv + 0.4, 0.82);

  // ⑩ 幌子内侧（右墙高处，字面朝室内）+ 吊灯
  box('fabric', 0.06, 1.62, 0.68, u - 0.1, y0 + 1.96, v - 2.2, 0x9d2933);
  box('wood', 0.08, 0.1, 0.78, u - 0.1, y0 + 2.8, v - 2.2, R_PLANK_D);
  if (spec.banner) R.banner(spec.banner, `sti${idx}b`, 0.56, 1.42, u - 0.14, y0 + 1.96, v - 2.2, -Math.PI / 2);
  roomLamp(R, -1.6, 0.9);
  roomLamp(R, 1.6, 1.2);
}

// ---------- 民居：灶台 + 水缸 + 碗架 + 桌凳（1 桌 4 凳）+ 床榻 + 箱笼 + 灯檠 + 神龛 + 门帘 ----------
function dressHouse(R: Room, F: number): void {
  const { box, cyl, u, v, y0, put } = R;

  // ① 灶台（夯土灶身 + 石灶面 + 双眼灶口 + 双锅 + 烟道）
  const ku = -(u - 0.84), kv = -(v - 0.66);
  box('earth', 1.22, 0.6, 0.68, ku, F + 0.3, kv, 0xa8926a);
  box('ash', 1.3, 0.1, 0.74, ku, F + 0.65, kv, 0x8d8a80);
  for (const su of [-1, 1]) {
    box('glow', 0.3, 0.12, 0.06, ku + su * 0.32, F + 0.22, kv + 0.37, 0xff7a2a);
    cyl('metal', 0.2, 0.16, 0.08, 10, ku + su * 0.32, F + 0.73, kv, 0x4a4030);
  }
  box('earth', 0.26, 1.5, 0.26, ku + 0.52, F + 1.38, kv - 0.2, 0x9a8768);
  put(waterPail, ku + 0.06, F, kv + 0.5, 0.85);

  // ② 水缸（灰陶大缸，缸沿压一块木盖）
  put(waterVat, -(u - 0.62), F, -0.25, 0.6);
  box('wood', 0.62, 0.04, 0.62, -(u - 0.62), F + 0.62, -0.25, R_PLANK);

  // ③ 碗架（两层，摞碗 + 陶盆）
  const rx0 = -(u - 0.28);
  for (const sv of [-1, 1]) box('wood', 0.07, 1.12, 0.08, rx0, F + 0.56, 0.95 + sv * 0.46, R_PLANK_D);
  for (const ty of [0.52, 1.02]) box('wood', 0.34, 0.05, 0.98, rx0, F + ty, 0.95, R_PLANK);
  for (let k = 0; k < 4; k++) {
    put(bowl, rx0, F + 0.57, 0.55 + k * 0.26, 0.85);
    if (k % 2 === 0) put(bowl, rx0, F + 1.07, 0.68 + k * 0.3, 0.7);
  }

  // ④ 桌凳：1 桌 4 凳（桌高 0.79 / 凳高 0.46）
  put(table, 0.75, F, 0.45, 1.0);
  put(bowl, 0.4, F + 0.79, 0.3, 0.9);
  put(tray, 1.1, F + 0.79, 0.6, 0.8);
  for (const su of [-1, 1]) {
    put(stool, 0.75 + su * 1.02, F, 0.45, 1.0);
    put(stool, 0.75, F, 0.45 + su * 0.82, 1.0);
  }

  // ⑤ 床榻 2.1×1.2（框 + 苇席面 + 枕 + 帐架）
  const bu = 1.5, bv = -(v - 0.72);
  box('wood', 2.1, 0.16, 1.2, bu, F + 0.34, bv, R_PLANK_D);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    box('wood', 0.1, 0.34, 0.1, bu + su * 0.98, F + 0.17, bv + sv * 0.52, R_PLANK);
  }
  box('fabric', 1.94, 0.1, 1.04, bu, F + 0.46, bv, 0xd8d2c4);
  box('fabric', 0.46, 0.13, 0.3, bu - 0.7, F + 0.57, bv, 0xcfc8b8);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    box('wood', 0.08, 1.55, 0.08, bu + su * 1.02, F + 0.78, bv + sv * 0.58, R_PLANK_D);
  }
  box('fabric', 2.16, 0.04, 1.28, bu, F + 1.55, bv, 0xb9a08a);
  for (const su of [-1, 1]) box('fabric', 0.04, 1.1, 1.24, bu + su * 1.04, F + 1.0, bv, 0xb9a08a);

  // ⑥ 箱笼（樟木箱 + 藤箱）
  put(clothesChest, u - 0.55, F, -0.45, 0.95);
  box('wood', 0.5, 0.34, 0.36, u - 0.55, F + 0.72, -1.1, 0x8a6a3a, 0, 0.02);

  // ⑦ 灯檠（0.9m 灯架 + 油灯）
  const lu2 = -(u - 0.55), lv2 = v - 1.55;
  box('wood', 0.28, 0.06, 0.28, lu2, F + 0.03, lv2, R_PLANK_D);
  box('wood', 0.07, 0.86, 0.07, lu2, F + 0.46, lv2, R_PLANK_D);
  box('wood', 0.3, 0.05, 0.3, lu2, F + 0.9, lv2, R_PLANK_D);
  box('glow', 0.12, 0.16, 0.12, lu2, F + 1.0, lv2, 0xffb066);
  cyl('ceramic', 0.09, 0.1, 0.1, 8, lu2, F + 0.94, lv2, 0x8a7a5e);

  // ⑧ 神龛（背墙，龛体 + 香炉 + 双烛 + 牌位）
  const nu = -1.5, nv = -(v - 0.26);
  box('wood', 0.78, 0.9, 0.34, nu, F + 0.45, nv, 0x6e3a26);
  box('wood', 0.9, 0.08, 0.42, nu, F + 0.93, nv, R_PLANK_D);
  box('wood', 0.7, 0.6, 0.06, nu, F + 1.2, nv - 0.08, 0x4a2a20);
  box('fabric', 0.4, 0.42, 0.03, nu, F + 1.2, nv - 0.02, 0xd8cbb0);
  put(censer, nu, F + 0.95, nv + 0.08, 0.55);
  for (const su of [-1, 1]) box('glow', 0.05, 0.16, 0.05, nu + su * 0.3, F + 1.06, nv + 0.06, 0xffc66e);

  // ⑨ 门帘（半卷布帘，挂在门楣内侧）
  box('fabric', 1.36, 1.8, 0.05, 0, y0 + 1.12, v - 0.16, 0x9d2933);
  box('wood', 1.5, 0.06, 0.09, 0, y0 + 2.05, v - 0.16, R_PLANK_D);
  box('fabric', 1.36, 0.22, 0.06, 0, y0 + 0.32, v - 0.15, 0x7a1f26);

  roomLamp(R, 0.2, -0.2);
}

// ---------- 酒肆：酒垆 + 酒瓮 5 + 长条食案 2 + 条凳 4 + 酒旗内侧 + 酒牌 4 + 帐台 + 灶间 ----------
function dressTavern(R: Room, spec: StreetHouseSpec, idx: number, F: number): void {
  const { box, cyl, u, v, y0, put } = R;

  // ① 酒垆（夯土垆台 + 木台面 0.95 + 挡板 + 银酒海）
  const gu = -2.2, gv = 1.2;
  box('earth', 1.8, 0.84, 0.86, gu, F + 0.42, gv, 0xa8926a);
  box('wood', 1.94, 0.07, 0.96, gu, F + 0.9, gv, R_PLANK);
  box('lacquer', 1.8, 0.84, 0.05, gu, F + 0.44, gv + 0.44, 0x6e3a26);
  for (const su of [-1, 1]) box('wood', 0.14, 0.9, 0.94, gu + su * 0.9, F + 0.44, gv, R_PLANK_D);
  put(wineSea, gu - 0.42, F + 0.95, gv, 1.5);
  put(wineSea, gu + 0.36, F + 0.95, gv + 0.1, 1.2);
  // 垆前两只坛子（酒瓮就地取酒）
  put(jar, gu - 1.16, F, gv - 0.5, 1.15);
  put(jar, gu - 0.42, F, gv - 0.62, 1.0);

  // ② 酒瓮 5 只（0.86 高，沿背墙一行）
  for (let k = 0; k < 5; k++) {
    put(jar, -1.95 + k * 0.78, F, -(v - 0.44), 1.3);
    box('fabric', 0.34, 0.04, 0.34, -1.95 + k * 0.78, F + 0.86, -(v - 0.44), 0x9d2933);
  }

  // ③ 长条食案 2 张（2.0×0.62，案高 0.75）+ 条凳 4 条
  for (const au of [-0.3, 1.9]) {
    box('wood', 2.0, 0.09, 0.64, au, F + 0.71, 0.5, 0x7a5636);
    box('wood', 1.86, 0.07, 0.5, au, F + 0.64, 0.5, R_PLANK);
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      box('wood', 0.09, 0.64, 0.09, au + su * 0.9, F + 0.32, 0.5 + sv * 0.24, R_PLANK_D);
    }
    for (const sv of [-1, 1]) {
      box('wood', 1.7, 0.07, 0.34, au, F + 0.3, 0.5 + sv * 0.66, 0x7a5636);
      for (const su of [-1, 1]) box('wood', 0.09, 0.28, 0.3, au + su * 0.76, F + 0.14, 0.5 + sv * 0.66, R_PLANK_D);
    }
    for (let k = 0; k < 4; k++) put(bowl, au - 0.66 + k * 0.44, F + 0.75, 0.5, 0.7);
    box('ceramic', 0.16, 0.28, 0.16, au + 0.72, F + 0.75, 0.35, 0x8a7a5e);
  }

  // ④ 酒旗内侧（右墙高挂，字朝室内）
  box('fabric', 0.06, 1.9, 0.72, u - 0.1, y0 + 2.15, -0.5, 0x9d2933);
  box('wood', 0.08, 0.1, 0.86, u - 0.1, y0 + 3.1, -0.5, R_PLANK_D);
  if (spec.banner) R.banner(spec.banner, `sti${idx}k`, 0.6, 1.66, u - 0.14, y0 + 2.15, -0.5, -Math.PI / 2);

  // ⑤ 酒牌 4 面（右墙一行，墨书酒名）
  for (let k = 0; k < 4; k++) {
    const pz = 0.35 + k * 0.46;
    box('wood', 0.05, 0.42, 0.3, u - 0.07, y0 + 1.72, pz, 0xe6dcc2);
    box('wood', 0.03, 0.06, 0.26, u - 0.1, y0 + 1.84, pz, 0x2b2b2b);
    box('wood', 0.03, 0.04, 0.26, u - 0.1, y0 + 1.72, pz, 0x2b2b2b);
  }

  // ⑥ 帐台（东端，围合高台 + 账簿）
  put(accountDesk, 2.85, F, -(v - 0.85), 0.85);
  put(teaLedger, 2.85, F + 1.11 * 0.85, -(v - 0.85), 0.85);

  // ⑦ 灶间（西端：砖土灶 + 铁锅 + 蒸笼 + 柴堆）
  const su0 = -(u - 0.9), sv0 = -(v - 0.58);
  box('earth', 1.06, 0.86, 0.78, su0, F + 0.43, sv0, 0xa8926a);
  box('ash', 1.14, 0.09, 0.84, su0, F + 0.9, sv0, 0x8d8a80);
  cyl('metal', 0.26, 0.22, 0.1, 10, su0, F + 0.98, sv0, 0x4a4030);
  box('glow', 0.34, 0.12, 0.06, su0, F + 0.24, sv0 + 0.42, 0xff7a2a);
  put(steamerStack, su0, F + 1.02, sv0, 0.62);
  put(firewoodStack, su0 + 0.72, F, sv0 - 0.15, 0.72);

  roomLamp(R, -1.9, 1.7);
  roomLamp(R, 1.0, 0.7);
}

// ---------- 茶坊：茶灶 + 汤瓶 + 茶盏架 + 矮桌 3 + 蒲团 6 + 屏风 + 挂画 + 香炉 ----------
function dressTeahouse(R: Room, F: number): void {
  const { box, cyl, u, v, y0, put } = R;

  // ① 茶灶（砖砌灶体 0.62 + 铜茶炉 + 灶口火光 + 双汤瓶）
  const cu = -(u - 1.02), cv = v - 1.4;
  box('ash', 0.98, 0.62, 0.72, cu, F + 0.31, cv, 0x6b7076);
  box('ash', 1.06, 0.08, 0.8, cu, F + 0.64, cv, 0x8d8a80);
  put(teaStove, cu, F + 0.68, cv, 1.0);
  box('glow', 0.3, 0.12, 0.06, cu, F + 0.2, cv + 0.38, 0xff7a2a);
  for (const su of [-1, 1]) {
    // 汤瓶：铜瓶身 + 提梁 + 长流
    const tu = cu + su * 0.62, tv = cv + 0.22;
    cyl('metal', 0.14, 0.17, 0.34, 10, tu, F + 0.85, tv, 0x8a6a3a);
    box('metal', 0.04, 0.26, 0.04, tu + su * 0.16, F + 1.0, tv, 0x6a5a3a, 0, su * 0.5);
    box('metal', 0.26, 0.03, 0.03, tu - su * 0.16, F + 0.94, tv, 0x6a5a3a, 0, su * 0.24);
    cyl('metal', 0.1, 0.12, 0.05, 8, tu, F + 1.04, tv, 0x6a5a3a);
  }
  put(waterVat, -(u - 0.55), F, v - 2.9, 0.55);

  // ② 茶盏架（右墙… 用左墙内侧，三层，摞茶盏）
  const ru = -(u - 0.3);
  for (const sv of [-1, 1]) box('wood', 0.07, 1.24, 0.08, ru, F + 0.62, 0.2 + sv * 0.5, R_PLANK_D);
  for (const ty of [0.5, 0.84, 1.18]) box('wood', 0.36, 0.05, 1.06, ru, F + ty, 0.2, R_PLANK);
  for (let k = 0; k < 3; k++) {
    put(bowl, ru, F + 0.55, -0.1 + k * 0.3, 0.62);
    put(bowl, ru, F + 0.89, -0.1 + k * 0.3, 0.62);
    put(bowl, ru, F + 1.23, -0.1 + k * 0.3, 0.62);
  }

  // ③ 矮桌 3 张 + 蒲团 6 只（每桌两位）
  for (const [tu, tv] of [[-0.9, 1.3], [1.5, 1.6], [-0.2, -0.9]] as const) {
    lowTable(R, tu, tv, F, 1.0, 0.6);
    put(tray, tu - 0.24, F + 0.47, tv, 0.7);
    put(bowl, tu + 0.22, F + 0.47, tv, 0.62);
    put(cushion, tu, F, tv - 0.62, 0.95);
    put(cushion, tu, F, tv + 0.62, 0.95);
  }
  if (u > 6) { // 16m 通间（上清觀茶寮）东半再加两席，免得半堂空着
    for (const [tu, tv] of [[4.6, 1.2], [4.6, -1.4]] as const) {
      lowTable(R, tu, tv, F, 1.0, 0.6);
      put(tray, tu - 0.24, F + 0.47, tv, 0.7);
      put(bowl, tu + 0.22, F + 0.47, tv, 0.62);
      put(cushion, tu, F, tv - 0.62, 0.95);
      put(cushion, tu, F, tv + 0.62, 0.95);
    }
  }

  // ④ 屏风（三扇连屏，靠背墙西段）
  put(screen, 1.6, F, -(v - 0.55), 0.8);

  // ⑤ 挂画（背墙东段，画心 + 上下杆）
  const pu = 3.4, pv = -(v - 0.06);
  box('fabric', 0.62, 1.16, 0.03, pu, y0 + 1.98, pv, 0xe6dcc2);
  box('fabric', 0.46, 0.86, 0.012, pu, y0 + 1.98, pv + 0.03, 0xcbbfa2);
  for (const sy of [1.32, 2.62]) box('metal', 0.72, 0.035, 0.035, pu, y0 + sy, pv + 0.01, 0x6a5a3a);

  // ⑥ 香炉（铜炉 + 矮几）
  const xu = -1.9, xv = -(v - 0.66);
  box('wood', 0.56, 0.34, 0.42, xu, F + 0.17, xv, 0x6e3a26);
  box('lacquer', 0.62, 0.05, 0.46, xu, F + 0.36, xv, 0x4a2a20);
  put(censer, xu, F + 0.4, xv, 0.75);

  roomLamp(R, -2.6, 1.2);
  roomLamp(R, 1.4, -0.4);
}

/**
 * 9 座街屋室内壳总装（由编排者在 world.ts 的「筑城营街」组里接线，一行：
 *   `buildStreetInteriors(baker, sg, this.atlas, rng);`）
 * 返回实际建成的房间数。只读 `rng.seed` 当盐，不推进共享随机流。
 */
export function buildStreetInteriors(
  b: Baker, sg: SignMesher, atlas: SignAtlas, rng?: RNG, houses: StreetHouseSpec[] = STREET_HOUSE_SLOTS,
): number {
  const salt = rng ? (rng.seed & 0x3f) : 0;
  let built = 0;
  for (let i = 0; i < houses.length; i++) {
    const s = houses[i];
    if (!(s.w >= 7.4 && s.d >= 4.6)) continue; // 布局常量按净空 ≥3.4×2.0m 设计，过小的棚屋跳过
    const mirrored = Math.abs((s.ry ?? 0) - Math.PI) < 1e-6;
    if (mirrored) { b.yawAbout(s.x, s.z); sg.yawAbout(s.x, s.z); }
    const R = makeRoom(b, sg, atlas, s, i + salt);
    const floor = s.kind === 'shop' ? 'brick' : s.kind === 'house' ? 'earth' : 'wood';
    const F = roomShell(R, floor);
    doorScreen(R, F, s.kind, s.kind === 'tavern' ? 1 : -1);
    if (s.kind === 'shop') dressShop(R, s, i, F);
    else if (s.kind === 'house') dressHouse(R, F);
    else if (s.kind === 'tavern') dressTavern(R, s, i, F);
    else dressTeahouse(R, F);
    // R17：9 座手工街屋同样落三档起居资产（与 2894 间铺面同一套资产表、同一套审计）。
    // 必须在 yawAbout 复位之前调用，镜像街屋的局部坐标才和 dress* 一起被正确翻转。
    buildRoomLiving(b, {
      cx: s.x, cz: s.z, w: R.u * 2, d: R.v * 2, y0: F, h: R.h,
      ux: 1, uz: 0, vx: 0, vz: 1,
      variant: i, trade: s.trade, compact: false,
    });
    if (mirrored) { b.yawAbout(); sg.yawAbout(); }
    built++;
  }
  return built;
}

/** 9 间室内点光（可选）：编排者若要沿用 INTERIOR_LIGHTS 的灯组，直接拼接本表即可 */
export const STREET_INTERIOR_LIGHTS: { x: number; y: number; z: number; color: number; int: number; dist: number }[] =
  STREET_HOUSE_SLOTS.map((s) => ({
    x: s.x, y: (s.y0 ?? 0.6) + 1.9, z: s.z, color: 0xffa04e, int: 42, dist: 9,
  }));


// ============ v3 W13：四处地标室内（樊楼 / 州桥 / 相国寺 / 上清观） ============
// 用户要求（原话）：「房间的房顶、屋檐、梁柱、窗门、墙体应该是什么样子，内部的屋顶、灯具、
// 家具、装饰、物品、生活用品、起居用品（或者商业用品、工作用品）、日杂用品、花草酒水茶具
// 文房四宝等等应该是在哪里、什么样子……」
// 本段只做**室内实体与桥面市集**（人由 crowd/heroes 负责，不在本文件）。
//
// 四处地标 2026-10-29 代码实况（决定了本段哪几处能直接接线）：
//   州桥   —— bridge.ts 已有桥体：中心 (0,0)，桥面宽 10.4，纵向 ±48，剖面 bridgeDeckY() = 0.7+8.4(1-(z/48)^2)，
//             桥心（z=0）桥面高 9.1。桥面是敞面（无墙无顶），**不需要开洞**，可直接往桥面上摆市集。
//   上清观 —— buildings.ts:1522 `(540,118) w16 d10 floors1`，buildBuilding 已改成空腔壳体（墙厚 0.18），
//             净空 15.4×9.4×3.2，正面开 2.4×2.2 门洞 → **可进屋**。
//             但 interiors.ts 的 STREET_HOUSE_SLOTS 第 6 项把同一空腔当「上清茶寮」茶坊装了内饰，
//             接线时必须把该条从 buildStreetInteriors 的入参里滤掉（见文件末 W13 说明）。
//   樊楼   —— 全仓库无此楼：src/ 里没有 22×16 三层楼体、没有坐标、没有 POI（只在 SPEC 里点名）。
//   相国寺 —— 同上：无殿身、无坐标。
//   后两处按用户指示不强行塞进实心体：写成**自带内衬/楼板/梁架**的独立函数，默认不并入装配，
//   等编排者先建楼体/殿身并开正面门洞后，传入锚点调用即可。
//
// 纪律（与本文件前段一致并加严）：
//   ① 随机性只用坐标 hash（h01），不碰 world.ts 的共享 rng 链；
//   ② 不新增 b.kit() id：器件全部复用 itemKit 既有 builder（其自带 item.* 台账 id 不变）；
//   ③ 大面不用 wall 组（自带蓝灰自发光）：内衬走 wood / earth，石作走 ash；
//      陶瓷 ceramic、铜器 metal、布幔 fabric、漆器 lacquer、灯芯 glow（小面积）；
//   ④ 尺寸按宋式：桌高 0.79、凳高 0.46、柜台 0.95、条凳 0.46、酒瓮 0.83–0.93、门槛 0.1。

const W13 = {
  plank: R_PLANK,        // 板壁
  plankD: R_PLANK_D,     // 板壁压暗（棂条/门框/桌腿）
  beam: R_BEAM,          // 梁枋
  deck: R_DECK,          // 望板
  brick: R_BRICK,        // 素方砖地
  brickL: R_BRICK_L,     // 砖缝
  ash: 0x8d8a80,         // 青石
  ashL: 0x9d988c,        // 青石亮端（甬道/压顶）
  ashD: 0x6f6c62,        // 青石暗端（碑面/门槛缝）
  earth: 0xa8926a,       // 夯土
  gold: 0xb08a34,        // 铜金
  goldD: 0x7d6220,       // 铜金暗
  zhu: 0xa63a2b,         // 朱
  zhuD: 0x6e3a26,        // 朱漆暗
  silk: 0xf4ecd8,        // 绢
  paper: 0xe6dcc2,       // 纸/经卷
  ink: 0x2b2b2b,         // 墨
  bronze: 0x6a5a3a,      // 青铜
  lacq: 0x4a2a20,        // 漆器
};

interface Stage {
  cx: number;
  cz: number;
  box(g: BGroup, w: number, h: number, d: number, lu: number, y: number, lv: number, hex: number, ry?: number, rx?: number, rz?: number): void;
  cyl(g: BGroup, rt: number, rb: number, h: number, seg: number, lu: number, y: number, lv: number, hex: number, ry?: number, rx?: number, rz?: number): void;
  item(fn: ItemBuilder, lu: number, y: number, lv: number, s?: number): void;
}

/** 局部坐标台（面向 +z 的室内）：lu 沿面阔、lv 沿进深（+ 为前檐），y 为绝对标高 */
function makeStage(b: Baker, cx: number, cz: number): Stage {
  return {
    cx, cz,
    box: (g, w, h, d, lu, y, lv, hex, ry = 0, rx = 0, rz = 0) => b.box(g, w, h, d, cx + lu, y, cz + lv, hex, ry, rx, rz),
    cyl: (g, rt, rb, h, seg, lu, y, lv, hex, ry = 0, rx = 0, rz = 0) => b.cyl(g, rt, rb, h, seg, cx + lu, y, cz + lv, hex, ry, rx, rz),
    item: (fn, lu, y, lv, s = 1) => fn(b, cx + lu, y, cz + lv, s),
  };
}

/** 条凳（宋式长凳 1.8×0.32，凳高 0.46）：面 + 四腿 + 两枨 */
function bench(S: Stage, lu: number, lv: number, y: number, len = 1.8, ry = 0): void {
  S.box('wood', len, 0.07, 0.32, lu, y + 0.44, lv, 0x7a5636, ry);
  for (const s of [-1, 1]) {
    S.box('wood', 0.08, 0.44, 0.28, lu + s * (len / 2 - 0.12) * Math.cos(ry), y + 0.22, lv - s * (len / 2 - 0.12) * Math.sin(ry), W13.plankD, ry);
  }
  S.box('wood', len - 0.3, 0.05, 0.05, lu, y + 0.14, lv, W13.plankD, ry);
}

/** 栏杆一段（望柱 + 上下枋，沿局部 u 轴）：用在楼阁平座/一览台/回廊外沿 */
function railRun(S: Stage, u0: number, u1: number, lv: number, y: number, posts: number): void {
  const len = u1 - u0;
  const mid = (u0 + u1) / 2;
  S.box('wood', len, 0.09, 0.09, mid, y + 0.92, lv, shade(W13.zhu, 1.06));
  S.box('wood', len, 0.07, 0.07, mid, y + 0.5, lv, shade(W13.zhu, 0.96));
  for (let i = 0; i < posts; i++) {
    const lu = u0 + (len * i) / (posts - 1);
    S.box('wood', 0.09, 0.96, 0.09, lu, y + 0.48, lv, W13.zhuD);
  }
}

// ---------- 州桥：桥面市集（6 摊 + 桥心井亭 + 望柱灯 8 + 桥头脚店） ----------
/** 桥面摊一座：案板 + 桌围 + 货堆 + 幌子 + 油灯。四条腿各自落在自己脚下那段桥面（斜坡不悬空） */
function bridgeStall(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, side: number, variant: number, idx: number): void {
  const yc = bridgeDeckY(z);
  const len = 2.1;   // 沿桥长（z）
  const wid = 0.78;  // 沿桥宽（x）
  const top = yc + 0.82;
  for (const dz of [-len / 2 + 0.2, len / 2 - 0.2]) {
    for (const dx of [-wid / 2 + 0.1, wid / 2 - 0.1]) {
      const gy = bridgeDeckY(z + dz);
      const hh = Math.max(0.14, top - 0.07 - gy);
      b.box('wood', 0.07, hh, 0.07, x + dx, gy + hh / 2, z + dz, W13.plankD);
    }
  }
  b.box('wood', wid, 0.07, len, x, top - 0.035, z, 0x7a5636);           // 案板
  b.box('wood', wid - 0.12, 0.05, len - 0.12, x, top - 0.095, z, W13.plank);
  for (const s2 of [-1, 1]) {                                            // 桌围（两长边）
    b.box('fabric', 0.025, 0.9, len - 0.14, x + s2 * (wid / 2 + 0.01), yc + 0.36, z, s2 * side > 0 ? 0x2a5c42 : 0x9d2933);
  }
  const gtop = top + 0.005;
  if (variant === 0) {
    // 酒摊：二瓮 + 三碗 + 注子
    jar(b, x, gtop, z - 0.5, 1.15);
    jar(b, x + 0.05, gtop, z + 0.12, 0.95);
    for (let k = 0; k < 3; k++) bowl(b, x - 0.13 + k * 0.13, gtop, z + 0.6, 0.55);
    ewer(b, x - 0.1, gtop, z + 0.92, 0.95);
  } else if (variant === 1) {
    // 炊饼果子摊：竹篮 + 果 + 三碟
    b.cyl('wood', 0.29, 0.25, 0.2, 10, x, gtop + 0.1, z - 0.6, 0xb08d4e);
    b.cyl('wood', 0.3, 0.3, 0.03, 10, x, gtop + 0.21, z - 0.6, 0x8a6a3a);
    for (let k = 0; k < 4; k++) b.cyl('ceramic', 0.06, 0.07, 0.07, 8, x - 0.14 + (k % 2) * 0.28, gtop + 0.26, z - 0.68 + Math.floor(k / 2) * 0.14, 0x8a3a2a);
    for (let k = 0; k < 3; k++) fruitDish(b, x, gtop, z + 0.15 + k * 0.3, 1.1);
    foodBox(b, x + 0.02, gtop, z + 0.98, 0.9);
  } else {
    // 布帛香药摊：三卷布 + 二纸包 + 香药袋
    for (let k = 0; k < 3; k++) {
      b.cyl('fabric', 0.11, 0.11, 0.7, 8, x - 0.22 + k * 0.22, gtop + 0.11, z - 0.35, [0x9d2933, 0x2a5c42, 0xd4b76a][k], 0, Math.PI / 2);
    }
    for (let k = 0; k < 2; k++) b.box('fabric', 0.26, 0.22, 0.3, x, gtop + 0.11, z + 0.22 + k * 0.32, 0xd8cbb0);
    b.box('fabric', 0.2, 0.24, 0.16, x + 0.02, gtop + 0.12, z + 0.95, 0x8a7a5e);
    tray(b, x - 0.05, gtop, z + 0.62, 0.9);
  }
  // 柜下货堆（退到摊后，不挡桥心通路）
  crate(b, x + side * 0.12, bridgeDeckY(z + len / 2 + 0.4), z + len / 2 + 0.4, 0.78);
  // 幌子：立杆 + 横臂 + 布招（布招朝向桥心，双面可读）
  const pz = z + len / 2 - 0.1;
  const pg = bridgeDeckY(pz);
  b.cyl('wood', 0.05, 0.065, 2.55, 6, x + side * 0.45, pg + 1.28, pz, W13.plankD);
  b.box('wood', 0.74, 0.05, 0.05, x + side * 0.45 - side * 0.37, pg + 2.48, pz, W13.plankD);
  const fx = x + side * 0.45 - side * 0.66;
  b.box('fabric', 0.05, 1.02, 0.44, fx, pg + 1.96, pz, [0x9d2933, 0x2a5c42, 0xc9a13a][idx % 3]);
  for (let k = 0; k < 3; k++) b.box('fabric', 0.02, 0.16, 0.05, fx + side * 0.01, pg + 1.38, pz - 0.13 + k * 0.13, 0xd8cbb0);
  if (variant !== 1) {
    sg.quad(atlas.text(`w13st${idx}`, ['酒', '布', '香'][variant % 3], 64, 96, { color: '#f0ead6', fontPx: 54, bg: 'rgba(43,43,43,0.75)' }), 0.32, 0.44, fx - side * 0.03, pg + 1.96, pz, Math.PI / 2);
  }
  // 油灯（摊端，灯芯只占 0.05 见方）
  const lz = z - len / 2 + 0.24;
  b.box('wood', 0.16, 0.03, 0.16, x, top + 0.015, lz, W13.plankD);
  b.cyl('wood', 0.045, 0.055, 0.16, 6, x, top + 0.1, lz, W13.plankD);
  b.cyl('ceramic', 0.11, 0.08, 0.08, 8, x, top + 0.22, lz, 0x6a5a44);
  b.box('glow', 0.05, 0.11, 0.05, x, top + 0.32, lz, 0xffb066);
}

/** 桥头脚店：三面板壁 + 悬山小顶 + 柜台 + 酒瓮 3。桥面是斜坡，先架一层找平木台 */
function bridgeHeadTavern(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number): void {
  const F = bridgeDeckY(z) + 0.28; // 找平后的室内地平
  const hw = 1.7, hd = 1.25;
  b.box('wood', hw * 2, 0.14, hd * 2, x, F - 0.07, z, 0x7a5636);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const gy = bridgeDeckY(z + dz * hd);
    const hh = Math.max(0.12, F - 0.14 - gy);
    b.box('wood', 0.12, hh, 0.12, x + dx * (hw - 0.1), gy + hh / 2, z + dz * (hd - 0.1), W13.plankD);
  }
  for (const dx of [-1, 1]) b.box('wood', 0.06, 0.26, hd * 2, x + dx * hw, F - 0.1, z, W13.plankD); // 台沿挡板
  b.box('ash', 3.0, 0.09, 0.22, x, F + 0.045, z - hd + 0.12, W13.ash);                              // 门槛石
  // 三面板壁（正面朝 -z 敞开）
  b.box('wood', hw * 2, 2.25, 0.1, x, F + 1.13, z + hd - 0.05, W13.plank);
  for (const dx of [-1, 1]) b.box('wood', 0.1, 2.25, hd * 2, x + dx * (hw - 0.05), F + 1.13, z, W13.plank);
  b.box('lacquer', hw * 2 - 0.12, 0.78, 0.05, x, F + 0.39, z + hd - 0.12, W13.zhuD);
  // 露明梁 + 檩 + 悬山小顶
  b.box('wood', hw * 2, 0.18, 0.16, x, F + 2.2, z, W13.beam);
  for (const dz of [-1, 1]) b.box('wood', hw * 2, 0.15, 0.13, x, F + 2.05, z + dz * hd * 0.62, W13.beam);
  roofOn(b, hw * 2 + 0.8, hd * 2 + 0.8, F + 2.3, x, z, 0, shade(C.tile, 1.06));
  // 柜台 + 台面 + 挡板
  b.box('wood', 2.4, 0.9, 0.55, x, F + 0.45, z - hd + 0.58, W13.plank);
  b.box('lacquer', 2.5, 0.07, 0.68, x, F + 0.94, z - hd + 0.58, W13.lacq);
  b.box('lacquer', 2.3, 0.8, 0.05, x, F + 0.42, z - hd + 0.88, W13.zhuD);
  // 酒瓮 3 + 酒海 + 碗摞 + 水牌
  jar(b, x - 0.82, F, z + 0.06, 1.25);
  jar(b, x + 0.16, F, z + 0.48, 1.1);
  jar(b, x + 1.06, F, z + 0.06, 1.2);
  wineSea(b, x - 0.42, F + 0.99, z - hd + 0.5, 1.5);
  for (let k = 0; k < 4; k++) bowl(b, x + 0.5, F + 0.99, z - hd + 0.32 + k * 0.1, 0.6);
  wineBoard(b, x + 1.45, F, z - hd + 1.15, 0.85);
  // 吊灯（索 + 灯身 + 盖底）
  b.box('wood', 0.04, 0.42, 0.04, x, F + 1.92, z - 0.15, W13.plankD);
  b.box('glow', 0.26, 0.34, 0.26, x, F + 1.55, z - 0.15, 0xffa04e);
  b.box('wood', 0.3, 0.04, 0.3, x, F + 1.75, z - 0.15, W13.plankD);
  // 幌子 + 招牌
  b.box('fabric', 0.5, 0.92, 0.04, x - hw + 0.36, F + 1.62, z - hd - 0.1, 0x9d2933);
  sg.quad(atlas.text('w13qt', '腳店', 96, 160, { color: '#f0ead6', vertical: true, fontPx: 58, bg: 'rgba(43,43,43,0.8)' }), 0.4, 0.7, x - hw + 0.36, F + 1.62, z - hd - 0.13, 0);
  sg.quad(atlas.text('w13qt2', '橋頭酒', 192, 64, { color: '#ffd700', fontPx: 48, bg: 'rgba(43,43,43,0.86)', border: 'rgba(255,215,0,0.5)' }), 1.15, 0.38, x, F + 2.0, z - hd + 0.02, 0);
}

/**
 * 州桥桥面市集：桥面摊 6 座（案板/货堆/幌子/油灯）+ 桥心井亭（井栏+井台+攒尖顶+亭灯）
 * + 桥栏望柱灯 8 盏 + 桥头脚店一间（柜台 + 酒瓮 3）。
 * 全部直接落在 bridgeDeckY 剖面上，穿桥不改桥（bridge.ts 一行不动）。
 */
export function buildZhouqiaoMarket(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // ① 桥面摊 6 座：西 3 / 东 3，避开既有 4 座食棚（z=±40.5）与桥心井亭
  const stalls: [number, number, number][] = [
    [-1, -26, 0], [-1, -12, 1], [-1, 20, 2],
    [1, -20, 1], [1, 6, 2], [1, 30, 0],
  ];
  for (let i = 0; i < stalls.length; i++) {
    const [side, z, variant] = stalls[i];
    bridgeStall(b, sg, atlas, side * 3.55, z, side, variant, i);
  }

  // ② 桥心井亭（z=0，桥面最高点 9.1；沿 x 偏 1.9m 让开 world.ts 的桥面人流中线 x≈0）
  {
    const px0 = -1.9;
    const y0 = bridgeDeckY(0);
    const hy = y0 + 2.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box('ash', 0.34, 0.12, 0.34, px0 + sx * 1.5, y0 + 0.06, sz * 1.5, W13.ashD);
      b.cyl('wood', 0.13, 0.155, 2.44, 8, px0 + sx * 1.5, y0 + 1.28, sz * 1.5, shade(C.woodRed, 0.94));
    }
    for (const sz of [-1, 1]) b.box('wood', 3.3, 0.2, 0.18, px0, hy, sz * 1.5, W13.beam);
    for (const sx of [-1, 1]) b.box('wood', 0.18, 0.2, 3.3, px0 + sx * 1.5, hy, 0, W13.beam);
    b.box('wood', 3.5, 0.14, 0.14, px0, y0 + 0.14, 0, W13.beam); // 地栿
    // 井台 + 井栏（八角石圈）+ 井水
    b.cyl('ash', 1.04, 1.1, 0.18, 8, px0, y0 + 0.09, 0, W13.ash);
    b.cyl('ash', 0.98, 1.02, 0.06, 8, px0, y0 + 0.21, 0, W13.ashL);
    b.cyl('water', 0.74, 0.74, 0.03, 8, px0, y0 + 0.19, 0, 0x14242c);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      b.box('ash', 0.5, 0.44, 0.14, px0 + Math.cos(a) * 0.9, y0 + 0.4, Math.sin(a) * 0.9, i % 2 ? W13.ash : W13.ashL, -a);
    }
    // 攒尖顶（四棱锥；rb=1 由 sx/sz 缩放成 3.9 见方）
    b.pyramid('roof', 0.06, 1, px0, hy + 0.72, 0, shade(C.tile, 1.1), 0, 2.76, 1.25, 2.76);
    for (const sz of [-1, 1]) b.box('roof', 3.96, 0.12, 0.2, px0, hy + 0.14, sz * 1.95, shade(C.tile, 0.72));
    for (const sx of [-1, 1]) b.box('roof', 0.2, 0.12, 3.96, px0 + sx * 1.95, hy + 0.14, 0, shade(C.tile, 0.72));
    b.cyl('wood', 0.1, 0.1, 0.3, 6, px0, hy + 1.5, 0, W13.gold); // 宝顶
    // 亭灯（一盏，灯芯小面积）
    b.box('wood', 0.04, 0.36, 0.04, px0, hy - 0.1, 0.5, W13.plankD);
    b.box('glow', 0.24, 0.3, 0.24, px0, hy - 0.42, 0.5, 0xffa04e);
    b.box('wood', 0.28, 0.04, 0.28, px0, hy - 0.26, 0.5, W13.plankD);
  }

  // ③ 桥栏望柱灯 8 盏（东西各 4，落在 bridge.ts 的望柱顶 ±5.05 / z=±9.6、±24）
  for (const sx of [-1, 1]) {
    for (const z of [-24, -9.6, 9.6, 24]) {
      const g = bridgeDeckY(z);
      const px = sx * 5.05;
      b.box('wood', 0.18, 0.08, 0.18, px, g + 1.35, z, W13.plankD);
      b.box('wood', 0.05, 0.4, 0.05, px, g + 1.59, z, W13.plankD);
      b.box('glow', 0.24, 0.32, 0.24, px, g + 1.97, z, 0xffa04e);
      b.box('wood', 0.3, 0.04, 0.3, px, g + 2.16, z, W13.plankD);
      b.box('wood', 0.24, 0.04, 0.24, px, g + 1.8, z, W13.plankD);
    }
  }

  // ④ 桥头脚店（南桥头 +x 侧，正面朝 -z 迎上岸人流；避开既有的 z=±40.5 食棚）
  bridgeHeadTavern(b, sg, atlas, 2.6, -44.2);
}

// ---------- 上清观：道观正殿（复用 buildings.ts 已建好的 (540,118) 16×10 空腔） ----------
/**
 * 上清观正殿室内：内衬（复用 roomShell：砖地/踢脚/四角柱/门框/露明抬梁+檩+椽+望板/支摘窗）
 * + 地面分带（门槛石/甬道/侧廊）+ 三清像座 3（三级台）+ 供案（香炉/烛台 2/供果盘 3）
 * + 铜鼎 + 磬 + 签筒 ×2 + 卦摊 + 丹炉 + 药柜（30 屉）+ 长明灯 2 + 吊灯 2。
 *
 * 注意：本函数占用 (540,118) 空腔。编排者若同时跑 buildStreetInteriors（其 STREET_HOUSE_SLOTS
 * 第 6 项 x:540 z:118「上清茶寮」也是这间屋），两套内饰会叠在同一空腔 → 必须把该条滤掉。
 */
export function buildShangqingHall(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const spec: StreetHouseSpec = { x: 540, z: 118, w: 16, d: 10, kind: 'house', name: '上清觀', y0: 0.6, h: 3.2 };
  const R = makeRoom(b, sg, atlas, spec, 68);
  const F = roomShell(R, 'brick');
  const { box, cyl, u, v } = R;
  const put = R.put;

  // ① 地面分带：中轴甬道（2.2m 素面）+ 两侧廊地压暗 + 门槛石
  box('ash', 2.2, 0.012, 8.4, 0, F + 0.006, 0.2, W13.ashL);
  for (const s2 of [-1, 1]) box('ash', u - 2.6, 0.01, v * 2 - 0.5, s2 * (2.6 + (u - 2.6) / 2), F + 0.005, 0, shade(W13.brick, 0.86));
  box('ash', 0.05, 0.014, v * 2 - 0.6, 0, F + 0.008, 0, W13.ashD);          // 甬道中线
  box('ash', 2.4, 0.1, 0.34, 0, F + 0.05, v - 0.18, W13.ash);               // 门槛石
  for (const s2 of [-1, 1]) box('ash', 0.16, 0.02, 0.3, s2 * 1.3, F + 0.01, v - 0.18, W13.ashD); // 门枕

  // ② 三清像座 3：三级须弥台 + 三座须弥座 + 龛背/背光/龛顶 + 牌位 + 座前香炉双烛
  const dz = -3.5;
  box('ash', 9.2, 0.16, 2.2, 0, F + 0.08, dz + 0.05, W13.ash);
  box('ash', 8.4, 0.16, 1.95, 0, F + 0.24, dz + 0.02, W13.ashL);
  box('ash', 7.6, 0.16, 1.7, 0, F + 0.40, dz, shade(W13.ashL, 1.04));
  for (let k = 0; k < 3; k++) {
    const lu = -2.55 + k * 2.55;
    box('wood', 1.5, 0.52, 1.05, lu, F + 0.74, dz, W13.zhuD);          // 座身
    box('ash', 1.62, 0.1, 1.12, lu, F + 0.53, dz, W13.ash);            // 下枋
    box('ash', 1.64, 0.08, 1.14, lu, F + 1.0, dz + 0.02, W13.ashL);    // 上枋
    for (let i = 0; i < 5; i++) box('wood', 0.2, 0.16, 0.05, lu - 0.56 + i * 0.28, F + 0.66, dz - 0.55, W13.gold); // 莲瓣
    box('lacquer', 2.0, 1.62, 0.07, lu, F + 1.72, dz - 0.96, 0x5a1f18); // 龛背板
    cyl('lacquer', 0.54, 0.54, 0.05, 16, lu, F + 2.1, dz - 0.9, W13.gold, Math.PI / 2, 0); // 背光（盘面朝殿内）
    box('lacquer', 2.16, 0.12, 0.5, lu, F + 2.56, dz - 0.78, W13.zhuD); // 龛顶
    box('wood', 0.46, 0.72, 0.05, lu, F + 1.42, dz - 0.42, W13.lacq);   // 牌位框
    box('fabric', 0.34, 0.56, 0.02, lu, F + 1.42, dz - 0.38, W13.paper);
    put(censer, lu, F + 1.04, dz + 0.12, 0.55);
    for (const s2 of [-1, 1]) {
      cyl('wood', 0.03, 0.045, 0.26, 6, lu + s2 * 0.62, F + 1.17, dz + 0.34, W13.zhuD);
      box('glow', 0.05, 0.1, 0.05, lu + s2 * 0.62, F + 1.35, dz + 0.34, 0xffc66e);
    }
  }

  // ③ 供案：5.2×0.92 长案 + 牙板 + 香炉 + 烛台 2 + 供果盘 3
  const az = -1.45;
  box('lacquer', 5.2, 0.12, 0.92, 0, F + 0.96, az, W13.lacq);
  box('wood', 4.9, 0.1, 0.8, 0, F + 0.88, az, W13.plank);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('wood', 0.12, 0.84, 0.12, sx * 2.4, F + 0.42, az + sz * 0.3, W13.lacq);
  for (const sz of [-1, 1]) box('wood', 4.9, 0.16, 0.06, 0, F + 0.74, az + sz * 0.4, W13.zhuD);
  put(censer, 0, F + 1.02, az, 1.05);
  for (const s2 of [-1, 1]) {
    cyl('metal', 0.13, 0.16, 0.06, 10, s2 * 1.35, F + 1.05, az, W13.bronze);   // 烛台座
    cyl('metal', 0.04, 0.05, 0.42, 8, s2 * 1.35, F + 1.28, az, W13.bronze);    // 烛杆
    cyl('fabric', 0.055, 0.055, 0.2, 8, s2 * 1.35, F + 1.58, az, 0xd8cbb0);    // 素烛
    box('glow', 0.045, 0.08, 0.045, s2 * 1.35, F + 1.71, az, 0xffc66e);
  }
  for (let k = 0; k < 3; k++) put(fruitDish, -1.95 + k * 1.95, F + 1.02, az - 0.14, 1.15);

  // ④ 铜鼎（堂心，鼎下设石台）
  box('ash', 1.34, 0.08, 1.34, 0, F + 0.04, 0.75, W13.ash);
  put(bronzeDing, 0, F + 0.08, 0.75, 1.1);

  // ⑤ 磬（西侧）：木架 + 折角石磬 + 系绳 + 槌座
  {
    const qu = -5.9, qv = 2.1;
    for (const s2 of [-1, 1]) box('wood', 0.08, 1.46, 0.08, qu + s2 * 0.55, F + 0.73, qv, W13.lacq);
    box('wood', 1.3, 0.09, 0.09, qu, F + 1.46, qv, W13.lacq);
    box('fabric', 0.02, 0.34, 0.02, qu, F + 1.28, qv, 0xd8cbb0);
    box('ash', 0.52, 0.34, 0.05, qu - 0.06, F + 1.06, qv, W13.ashD, 0, 0.3);
    box('ash', 0.34, 0.3, 0.05, qu + 0.28, F + 0.94, qv, 0x7a776e, 0, -0.46);
    box('wood', 0.52, 0.42, 0.42, qu + 0.95, F + 0.21, qv, W13.plankD);
    cyl('wood', 0.045, 0.055, 0.4, 6, qu + 0.95, F + 0.5, qv, 0xb08a34, 0, 1.15);
  }

  // ⑥ 签案 + 签筒 2（西前，香客入门即见）
  {
    const tu = -4.5, tv = 3.5;
    box('wood', 1.8, 0.06, 0.7, tu, F + 0.74, tv, W13.plank);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('wood', 0.07, 0.72, 0.07, tu + sx * 0.8, F + 0.36, tv + sz * 0.26, W13.plankD);
    put(signTube, tu - 0.3, F + 0.77, tv, 1);
    put(signTube, tu + 0.06, F + 0.77, tv - 0.05, 0.94);
    box('fabric', 0.34, 0.24, 0.26, tu + 0.5, F + 0.77, tv + 0.04, W13.paper);
    box('fabric', 0.3, 0.03, 0.22, tu + 0.5, F + 0.9, tv + 0.04, 0xd8cbb0);
  }

  // ⑦ 卦摊（东前）：矮桌 + 卦盘八卦 + 六爻铜钱 + 卦书 + 签筒 + 坐墩 2 + 幌「卜卦」
  {
    const gu = 4.6, gv = 3.35;
    box('wood', 1.5, 0.06, 0.78, gu, F + 0.62, gv, W13.plank);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('wood', 0.08, 0.6, 0.08, gu + sx * 0.64, F + 0.31, gv + sz * 0.3, W13.plankD);
    cyl('wood', 0.36, 0.36, 0.05, 12, gu - 0.18, F + 0.68, gv, W13.ink);      // 卦盘
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box('lacquer', 0.16, 0.012, 0.03, gu - 0.18 + Math.cos(a) * 0.25, F + 0.71, gv + Math.sin(a) * 0.25, i % 2 ? 0xcfc6a8 : 0x2b2b2b, -a);
    }
    for (let i = 0; i < 6; i++) cyl('metal', 0.03, 0.03, 0.012, 8, gu + 0.36 + (i % 3) * 0.09, F + 0.67, gv - 0.1 + Math.floor(i / 3) * 0.1, W13.gold);
    box('fabric', 0.3, 0.05, 0.24, gu + 0.34, F + 0.67, gv + 0.18, W13.paper); // 卦书
    put(fateTube, gu - 0.55, F + 0.65, gv + 0.1, 0.9);
    for (const s2 of [-1, 1]) cyl('ceramic', 0.2, 0.22, 0.4, 8, gu + s2 * 0.95, F + 0.2, gv - 0.1, 0x6a5a44); // 坐墩
    box('fabric', 0.05, 0.74, 0.5, gu + 1.05, F + 1.5, gv - 0.5, W13.ink);      // 幌
    sg.quad(atlas.text('w13gua', '卜卦', 64, 128, { color: '#f4ecd8', fontPx: 54, bg: 'rgba(30,30,30,0.86)' }), 0.3, 0.62, R.cx + gu + 1.02, F + 1.5, R.cz + gv - 0.5, -Math.PI / 2);
  }

  // ⑧ 丹炉 + 药碾 + 药罐（东后）：炉下石台、炭盆火光只留小面
  {
    const du = 5.1, dv = -1.25;
    box('ash', 1.16, 0.08, 1.16, du, F + 0.04, dv, W13.ash);
    put(elixirFurnace, du, F + 0.08, dv, 0.9);
    box('ash', 0.7, 0.24, 0.5, du - 0.95, F + 0.12, dv + 0.3, W13.ashD);   // 炭盆
    box('glow', 0.34, 0.05, 0.24, du - 0.95, F + 0.22, dv + 0.3, 0xff7a2a);
    cyl('metal', 0.16, 0.13, 0.12, 8, du - 1.65, F + 0.09, dv + 0.12, W13.bronze, 0, 1.2);
    for (let k = 0; k < 3; k++) put(jar, du - 1.5 + k * 0.42, F, dv - 0.62, 0.62 + k * 0.08);
  }

  // ⑨ 药柜 30 屉（5 列 × 6 行），沿东壁；每屉一铜环
  {
    const cu = u - 0.34, cv = -2.65;
    box('wood', 0.5, 2.14, 2.76, cu, F + 1.07, cv, 0x5a3a22);
    box('wood', 0.58, 0.1, 2.86, cu, F + 2.19, cv, W13.zhuD);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
      const ly = F + 0.24 + r * 0.31, lz = cv - 1.08 + c * 0.54;
      box('wood', 0.04, 0.27, 0.46, cu - 0.26, ly, lz, 0x7a5636);
      cyl('metal', 0.035, 0.035, 0.03, 6, cu - 0.29, ly, lz, W13.gold, 0, Math.PI / 2);
    }
    for (let k = 0; k < 2; k++) put(jar, cu, F + 2.24, cv - 0.6 + k * 1.1, 0.7);
  }

  // ⑩ 灯具：吊灯 2（roomLamp）+ 长明灯 2（灯檠）
  roomLamp(R, -3.2, 1.5);
  roomLamp(R, 3.2, 1.5);
  for (const s2 of [-1, 1]) {
    const lu = s2 * 1.95, lv = -0.55;
    box('wood', 0.3, 0.06, 0.3, lu, F + 0.03, lv, W13.plankD);
    cyl('wood', 0.05, 0.06, 1.02, 8, lu, F + 0.54, lv, W13.lacq);
    cyl('wood', 0.1, 0.13, 0.06, 8, lu, F + 1.07, lv, W13.lacq);
    cyl('ceramic', 0.11, 0.08, 0.08, 8, lu, F + 1.13, lv, 0x6a5a44);
    box('glow', 0.05, 0.1, 0.05, lu, F + 1.23, lv, 0xffc66e);
  }

  // ⑪ 两壁挂「道」字幡（小面积布，压住空墙）
  for (const s2 of [-1, 1]) {
    box('fabric', 0.04, 1.5, 0.5, s2 * (u - 0.12), F + 1.95, -0.4, s2 > 0 ? 0x2e4e7e : 0x9d2933);
    box('wood', 0.05, 0.06, 0.62, s2 * (u - 0.12), F + 2.73, -0.4, W13.plankD);
  }
}

// ---------- 樊楼：三层酒楼（22×16，层净高 4.2，正面 +z） ----------
/**
 * 樊楼室内（三层合计）：L1 大堂（柜台/酒垆/酒瓮 6/长食案 3+条凳 12/帐桌/酒牌）
 * + L2 雅座 4 间（隔断/一桌四椅/窗/帘/屏风/挂画/香炉）+ L3 一览台（栏杆/矮几/蒲团 4/灯 2）
 * + 两道 14 级楼梯（宽 1.2，带扶手）。
 *
 * **宿主楼体在代码里不存在**（src/ 无樊楼），故本函数自带内衬板壁、楼板（楼梯井开洞）、
 * 露明梁架与望板，可直接看见「内部」。编排者建好楼体后调用：
 *   `buildFanlouInterior(b, sg, atlas, 楼心X, 楼心Z);`
 * 宿主楼体要求：22×16 三层（每层净高 4.2）、正面 +z 开 ≥2.6m 门洞、东侧 8.45..10.45 的
 * 楼梯井不开楼板（或由本函数接管楼板）。
 */
export function buildFanlouInterior(b: Baker, sg: SignMesher, atlas: SignAtlas, ax = 0, az = 0): void {
  const S = makeStage(b, ax, az);
  const u = 10.45, v = 7.45;          // 净空半阔 / 半深
  const F1 = 0.06;
  const F2 = 4.56, F3 = 9.06;         // 楼板上皮
  const H = 4.2;                      // 每层净高
  const TOP = 13.26;                  // L3 望板底

  // ===== 楼板（东侧留楼梯井）=====
  const slab = (yc: number, hz0: number, hz1: number): void => {
    S.box('wood', 19.45, 0.3, 16, -1.275, yc, 0, W13.deck);
    S.box('wood', 2.55, 0.3, hz0 + 8, 9.725, yc, (-8 + hz0) / 2, W13.deck);
    S.box('wood', 2.55, 0.3, 8 - hz1, 9.725, yc, (hz1 + 8) / 2, W13.deck);
  };
  slab(4.41, 1.0, 5.9);               // L2 楼板（L1→L2 梯井）
  slab(8.91, -5.0, -0.2);             // L3 楼板（L2→L3 梯井）

  // ===== 地面（L1 素方砖）+ 门槛石 =====
  S.box('ash', u * 2, 0.14, v * 2, 0, F1 - 0.07, 0, W13.brick);
  for (let i = -5; i <= 5; i++) {
    S.box('ash', u * 2, 0.012, 0.03, 0, F1 + 0.004, i * v * 0.18, W13.brickL);
    S.box('ash', 0.03, 0.012, v * 2, i * u * 0.18, F1 + 0.004, 0, W13.brickL);
  }
  S.box('ash', 2.6, 0.1, 0.34, 0, F1 + 0.05, v - 0.2, W13.ash);       // 门槛石（L1 门）
  // 地面分带：门内甬道 + 两侧廊地压暗（砖地本色作堂心）
  S.box('ash', 3.0, 0.012, v * 2 - 1.4, 0, F1 + 0.008, 0, W13.ashL);
  for (const s2 of [-1, 1]) S.box('ash', 2.2, 0.01, v * 2 - 0.9, s2 * (u - 1.1), F1 + 0.005, 0, shade(W13.brick, 0.86));

  // ===== 内衬墙（板壁）+ 一层正面门洞 =====
  const lining = (F: number, h: number, front: 'door' | 'window'): void => {
    S.box('wood', u * 2, h, 0.12, 0, F + h / 2, -v, W13.plank);
    for (const s2 of [-1, 1]) S.box('wood', 0.12, h, v * 2, s2 * u, F + h / 2, 0, shade(W13.plank, 0.96));
    if (front === 'door') {
      for (const s2 of [-1, 1]) S.box('wood', u - 1.4, h, 0.12, s2 * (1.4 + (u - 1.4) / 2), F + h / 2, v, W13.plank);
      S.box('wood', 2.8, h - 2.7, 0.12, 0, F + 2.7 + (h - 2.7) / 2, v, W13.plank);   // 门楣上墙
      S.box('wood', 2.9, 0.2, 0.2, 0, F + 2.72, v - 0.04, W13.beam);                  // 门楣
      for (const s2 of [-1, 1]) S.box('wood', 0.14, 2.7, 0.2, s2 * 1.42, F + 1.35, v - 0.04, W13.plankD);
    } else {
      S.box('wood', u * 2, h, 0.12, 0, F + h / 2, v, W13.plank);
    }
    // 踢脚线
    S.box('wood', u * 2, 0.3, 0.06, 0, F + 0.17, -(v - 0.04), W13.plankD);
    for (const s2 of [-1, 1]) S.box('wood', 0.06, 0.3, v * 2, s2 * (u - 0.04), F + 0.17, 0, W13.plankD);
    // 四角柱
    for (const s2 of [-1, 1]) for (const sv of [-1, 1]) S.box('wood', 0.18, h, 0.18, s2 * (u - 0.09), F + h / 2, sv * (v - 0.09), W13.plankD);
  };
  lining(F1, H, 'door');
  lining(F2, H, 'window');
  lining(F3, H - 0.1, 'window');

  // ===== 露明梁架（每层：大梁 3 榀 + 檩 4 道 + 椽）=====
  const frame = (F: number, yPlank: number, bays: number): void => {
    S.box('wood', u * 2, 0.06, v * 2, 0, yPlank, 0, W13.deck);                    // 望板
    const n = Math.max(8, Math.round((u * 2) / 0.5));
    for (let i = 0; i < n; i++) {
      const lu = -u + 0.25 + ((u * 2 - 0.5) * i) / (n - 1);
      S.box('wood', 0.07, 0.1, v * 2, lu, yPlank - 0.1, 0, shade(W13.deck, 1.08)); // 椽
    }
    for (let k = 0; k < bays; k++) {
      const lv = -v + 0.45 + ((v * 2 - 0.9) * k) / (bays - 1);
      S.cyl('wood', 0.1, 0.1, u * 2, 8, 0, yPlank - 0.26, lv, W13.beam, 0, 0, Math.PI / 2); // 檩
    }
    for (const lu of [-7, 0, 7]) {                                                 // 大梁 + 瓜柱
      S.box('wood', 0.26, 0.32, v * 2, lu, yPlank - 0.5, 0, W13.beam);
      for (const sv of [-1, 1]) S.box('wood', 0.18, 0.28, 0.18, lu, yPlank - 0.78, sv * v * 0.55, W13.plankD);
    }
  };
  frame(F1, F1 + H - 0.06, 4);        // L1 天花（望板贴 L2 楼板底）
  frame(F2, F2 + H - 0.06, 4);        // L2 天花

  // ===== 楼梯 ×2（14 级，宽 1.2，扶手 + 望柱）=====
  const stair = (Fb: number, z0: number, dz: number): void => {
    const rise = 4.5 / 14, run = 0.3;   // 楼板上下皮差 4.5（净高 4.2 + 板厚 0.3）
    for (let i = 0; i < 14; i++) {
      const lv = z0 + dz * i * run;
      S.box('wood', 1.2, 0.1, run + 0.04, 9.5, Fb + (i + 1) * rise - 0.05, lv, i % 2 ? 0x8b5e3c : 0x7f5436);
      S.box('wood', 1.2, 0.09, 0.06, 9.5, Fb + (i + 1) * rise - 0.11, lv, W13.plankD);
    }
    // 斜梁两侧
    for (const s2 of [-1, 1]) {
      const dzr = dz * (14 * run), dyr = 14 * rise;
      S.box('wood', 0.08, 0.22, Math.hypot(dzr, dyr), 9.5 + s2 * 0.62, Fb + dyr / 2, z0 + dzr / 2, W13.beam, 0, Math.atan2(dyr, dzr), 0);
    }
    // 扶手（开放侧）+ 望柱 4 根
    const dzr2 = dz * (14 * run), dyr2 = 14 * rise;
    S.box('wood', 0.07, 0.07, Math.hypot(dzr2, dyr2), 8.86, Fb + 0.92 + dyr2 / 2, z0 + dzr2 / 2, shade(W13.zhu, 1.02), 0, Math.atan2(dyr2, dzr2), 0);
    for (let i = 0; i <= 3; i++) {
      const lv = z0 + dz * i * (14 * run) / 3;
      S.box('wood', 0.07, 0.92, 0.07, 8.86, Fb + (i * 14 / 3) * rise + 0.46, lv, W13.lacq);
    }
    // 梯口围栏（落在上层楼板上皮，围住梯井的短边）
    S.box('wood', 1.7, 0.1, 0.1, 9.5, Fb + 4.5 + 0.95, z0 + dz * 4.3, shade(W13.zhu, 1.04));
  };
  stair(F1, 5.4, -1);                 // L1→L2（向 -z 上行）
  stair(F2, -0.4, -1);                // L2→L3

  // ===== L1 大堂 =====
  // ① 柜台（榆木整厚板，台面 0.95）+ 挡板 + 栏
  S.box('wood', 4.2, 0.9, 0.7, -6.4, F1 + 0.45, -5.3, W13.plank);
  S.box('lacquer', 4.34, 0.07, 0.84, -6.4, F1 + 0.94, -5.3, W13.lacq);
  S.box('lacquer', 4.1, 0.76, 0.05, -6.4, F1 + 0.42, -5.64, W13.zhuD);
  for (const s2 of [-1, 1]) S.box('wood', 0.16, 0.94, 0.78, -6.4 + s2 * 2.05, F1 + 0.47, -5.3, W13.plankD);
  // ② 酒垆（夯土垆台 + 木台面 + 银酒海 3 + 取酒瓮 2）
  S.box('earth', 2.6, 0.92, 1.0, -6.4, F1 + 0.46, -6.5, W13.earth);
  S.box('wood', 2.74, 0.07, 1.12, -6.4, F1 + 0.95, -6.5, W13.plank);
  S.item(wineSea, -7.2, F1 + 0.99, -6.5, 1.6);
  S.item(wineSea, -6.4, F1 + 0.99, -6.4, 1.35);
  S.item(wineSea, -5.7, F1 + 0.99, -6.55, 1.5);
  S.item(ewer, -6.0, F1 + 0.99, -6.4, 1.2);
  jar(b, ax - 9.3, F1, az - 6.85, 1.35);   // 垆台以西地面（不与垆台重叠）
  jar(b, ax - 8.45, F1, az - 6.85, 1.3);
  // ③ 酒瓮 6（沿后墙一行，瓮口封泥红签）
  for (let k = 0; k < 6; k++) {
    const lu = -2.8 + k * 1.24;
    jar(b, ax + lu, F1, az - 6.92, 1.42);
    b.box('fabric', 0.4, 0.05, 0.4, ax + lu, F1 + 1.0, az - 6.92, W13.zhu);
  }
  // ④ 长食案 3 + 条凳 12（案 2.6×0.78，案高 0.78；每案两两对坐 2 凳）
  for (const lu of [-6.2, 0, 6.2]) {
    S.box('wood', 2.6, 0.09, 0.82, lu, F1 + 0.74, -0.6, 0x7a5636);
    S.box('wood', 2.4, 0.07, 0.68, lu, F1 + 0.66, -0.6, W13.plank);
    for (const s2 of [-1, 1]) for (const sv of [-1, 1]) S.box('wood', 0.1, 0.66, 0.1, lu + s2 * 1.15, F1 + 0.33, -0.6 + sv * 0.3, W13.plankD);
    for (const sv of [-1, 1]) for (const s2 of [-1, 1]) bench(S, lu + s2 * 0.56, -0.6 + sv * 0.78, F1, 1.05); // 每案 4 条，合计 12
    // 案上器用：碟 + 碗 + 注子 + 酒盏
    for (let k = 0; k < 3; k++) fruitDish(b, ax + lu - 0.7 + k * 0.7, F1 + 0.79, az - 0.68, 1.05);
    ewer(b, ax + lu + 0.9, F1 + 0.79, az - 0.6, 1.1);
  }
  // ⑤ 帐桌（西墙下，面朝 +z）+ 账簿 + 算盘
  S.item(accountDesk, -8.9, F1, 3.4, 1);
  S.item(teaLedger, -8.9, F1 + 1.11, 3.4, 1);
  S.item(accountDeskSmall, -8.8, F1, 5.4, 0.9);
  // ⑥ 酒牌 6 面（后墙一行，墨书酒名）+ 水牌 2
  for (let k = 0; k < 6; k++) {
    const lu = -1.6 + k * 0.86;
    S.box('wood', 0.05, 0.46, 0.32, lu, F1 + 2.5, -v + 0.14, W13.paper);
    S.box('wood', 0.03, 0.05, 0.28, lu + 0.02, F1 + 2.62, -v + 0.14, W13.ink);
    S.box('wood', 0.03, 0.04, 0.28, lu + 0.02, F1 + 2.44, -v + 0.14, W13.ink);
    S.box('wood', 0.05, 0.04, 0.34, lu, F1 + 2.75, -v + 0.14, W13.plankD);
  }
  S.item(wineBoard, 5.6, F1, 6.2, 1.05);
  S.item(wineBoard, -2.4, F1, 6.9, 0.95);
  // ⑦ 吊灯 4（索 + 灯身 + 上下盖）
  for (const lu of [-6.4, -2.2, 2.2, 6.4]) {
    S.box('wood', 0.04, 0.5, 0.04, lu, F1 + 3.55, -0.4, W13.plankD);
    S.box('glow', 0.3, 0.4, 0.3, lu, F1 + 3.15, -0.4, 0xffa04e);
    S.box('wood', 0.34, 0.05, 0.34, lu, F1 + 3.37, -0.4, W13.plankD);
    S.box('wood', 0.28, 0.04, 0.28, lu, F1 + 2.93, -0.4, W13.plankD);
  }
  // ⑧ 门内影壁（屏门三扇，留 1.4m 通行口）
  for (const k of [-1, 0, 1]) {
    S.box('wood', 0.56, 2.05, 0.08, -2.0 + k * 0.6, F1 + 1.02, v - 1.5, W13.plankD);
    S.box('fabric', 0.46, 1.8, 0.04, -2.0 + k * 0.6, F1 + 1.02, v - 1.44, W13.silk);
  }
  S.box('wood', 0.06, 2.1, 0.1, -2.62, F1 + 1.05, v - 1.5, W13.lacq);
  S.box('wood', 0.06, 2.1, 0.1, -1.38, F1 + 1.05, v - 1.5, W13.lacq);

  // ===== L2 雅座 4 间 =====
  const parts = [-5.2, 0, 5.2, 8.36];
  for (const lu of parts) {
    // 隔断只做到 lv=5.6，前面 1.85m 留作雅座前廊（跑堂走菜），各间朝前廊开口
    S.box('wood', 0.16, 3.4, 13.05, lu, F2 + 1.7, -0.925, W13.plank);
    S.box('wood', 0.2, 0.16, 13.2, lu, F2 + 3.44, -0.9, W13.beam);             // 压顶枋
    S.box('wood', 0.22, 0.18, 0.24, lu, F2 + 2.42, 5.6, W13.plankD);           // 开口边柱
  }
  const rooms = [
    { c: -7.85, w: 5.1 }, { c: -2.6, w: 5.1 }, { c: 2.6, w: 5.1 }, { c: 6.8, w: 3.0 },
  ];
  for (let i = 0; i < rooms.length; i++) {
    const c = rooms[i].c;
    const half = rooms[i].w / 2;
    // 门帘（整幅挂在朝前廊的开口上）+ 门楣
    S.box('wood', rooms[i].w - 0.22, 0.18, 0.16, c, F2 + 2.5, 5.6, W13.beam);
    S.box('fabric', Math.min(rooms[i].w - 0.5, 3.2), 2.42, 0.05, c, F2 + 1.3, 5.62, i % 2 ? 0x9d2933 : 0x2a5c42);
    S.box('wood', Math.min(rooms[i].w - 0.4, 3.3), 0.06, 0.09, c, F2 + 2.46, 5.62, W13.plankD);
    for (let k = -1; k <= 1; k++) S.box('fabric', 0.05, 2.2, 0.03, c + k * (Math.min(rooms[i].w - 0.6, 3.0) / 3), F2 + 1.25, 5.65, 0xb9a08a);
    // 一桌四椅
    S.item(table, c, F2, 1.6, 0.8);
    S.item(vase, c - 0.3, F2 + 0.83, 1.4, 0.85);
    for (const s2 of [-1, 1]) {
      S.item(stool, c + s2 * 0.85, F2, 1.15, 0.92);
      S.item(stool, c + s2 * 0.85, F2, 2.05, 0.92);
    }
    // 窗（临街）
    zhilingWindow(b, ax + c, F2 + 1.95, az + v - 0.14, 1.7, 1.4, 0, i % 2 === 0);
    S.box('wood', 1.9, 0.12, 0.14, c, F2 + 1.2, v - 0.16, W13.plankD);        // 窗台
    // 屏风（后墙）+ 挂画（按房间宽度取偏移，不压隔断）
    S.item(screen, c, F2, -v + 0.7, 0.82);
    const po = half - 0.52;
    S.box('fabric', 0.56, 1.0, 0.03, c + po, F2 + 2.1, -v + 0.1, W13.paper);
    S.box('fabric', 0.42, 0.74, 0.012, c + po, F2 + 2.1, -v + 0.07, 0xcbbfa2);
    for (const sy of [1.55, 2.65]) S.box('metal', 0.66, 0.035, 0.035, c + po, F2 + sy, -v + 0.09, 0x6a5a3a);
    // 香几 + 香炉
    const xo = half - 0.85;
    S.box('wood', 0.52, 0.5, 0.44, c - xo, F2 + 0.25, -v + 0.55, W13.plank);
    S.box('lacquer', 0.58, 0.05, 0.5, c - xo, F2 + 0.52, -v + 0.55, W13.lacq);
    S.item(censer, c - xo, F2 + 0.55, -v + 0.55, 0.7);
    // 波斯毯 / 席
    S.box('fabric', 2.0, 0.02, 1.4, c, F2 + 0.01, 1.6, i % 2 ? 0x7a2f28 : 0x2f4a6b);
  }
  // L2 廊灯 2 + 楼梯口栏
  for (const lu of [-3.4, 3.4]) {
    S.box('wood', 0.04, 0.46, 0.04, lu, F2 + 3.5, 0.6, W13.plankD);
    S.box('glow', 0.28, 0.36, 0.28, lu, F2 + 3.14, 0.6, 0xffa04e);
    S.box('wood', 0.32, 0.05, 0.32, lu, F2 + 3.34, 0.6, W13.plankD);
  }
  S.box('wood', 0.1, 0.95, 0.1, 8.5, F2 + 0.48, 0.9, W13.zhuD);
  S.box('wood', 0.1, 0.95, 0.1, 8.5, F2 + 0.48, 5.8, W13.zhuD);
  S.box('wood', 0.09, 0.09, 5.0, 8.5, F2 + 0.95, 3.35, shade(W13.zhu, 1.03));
  sg.quad(atlas.text('w13fl2', '雅座', 128, 96, { color: '#ffd700', fontPx: 56, bg: 'rgba(43,43,43,0.8)' }), 1.0, 0.72, ax - 7.85, F2 + 3.0, az + 7.34, Math.PI);

  // ===== L3 一览台 =====
  for (let i = -7; i <= 7; i++) S.box('wood', u * 2, 0.012, 0.02, 0, F3 + 0.006, i * (v / 7.4), shade(0x7a5636, i % 2 ? 1.04 : 0.96));
  // 栏杆（前 + 两侧）与美人靠坐凳
  railRun(S, -u + 0.3, u - 0.3, v - 0.25, F3, 7);
  for (const s2 of [-1, 1]) {
    S.box('wood', 0.12, 0.9, v * 2 - 0.9, s2 * (u - 0.25), F3 + 0.45, -0.2, shade(W13.zhu, 0.98));
    S.box('wood', 0.3, 0.06, v * 2 - 1.0, s2 * (u - 0.45), F3 + 0.44, -0.2, 0x7a5636); // 坐凳面
  }
  S.box('wood', u * 2 - 1.0, 0.06, 0.3, 0, F3 + 0.44, v - 0.48, 0x7a5636);
  // 梯井围栏（L3 楼板洞西沿，x=8.45，z −5.0..−0.2）
  S.box('wood', 0.09, 0.09, 5.0, 8.45, F3 + 0.95, -2.6, shade(W13.zhu, 1.04));
  S.box('wood', 0.07, 0.07, 5.0, 8.45, F3 + 0.5, -2.6, shade(W13.zhu, 0.96));
  for (const lv of [-5.0, -2.6, -0.2]) S.box('wood', 0.09, 0.95, 0.09, 8.45, F3 + 0.48, lv, W13.zhuD);
  // 临街格窗 4 樘（在栏杆之上）
  for (const lu of [-7.6, -2.6, 2.6, 7.6]) {
    zhilingWindow(b, ax + lu, F3 + 1.9, az + v - 0.14, 1.5, 1.3, 0, true);
    S.box('wood', 1.7, 0.1, 0.12, lu, F3 + 1.2, v - 0.16, shade(W13.zhu, 1.02));
  }
  // 矮几 3 + 蒲团 4 + 灯 2（一览台）
  for (const [lu, lv] of [[-5.6, 3.4], [0, 2.0], [5.6, 3.4]] as const) {
    S.box('lacquer', 0.92, 0.07, 0.46, lu, F3 + 0.42, lv, W13.lacq);
    for (const s2 of [-1, 1]) for (const sv of [-1, 1]) S.box('wood', 0.07, 0.4, 0.07, lu + s2 * 0.4, F3 + 0.2, lv + sv * 0.17, W13.plankD);
    S.item(tray, lu - 0.1, F3 + 0.45, lv, 0.85);
    S.item(bowl, lu + 0.22, F3 + 0.45, lv + 0.02, 0.7);
  }
  S.item(cushion, -5.6, F3, 4.1, 0.85);
  S.item(cushion, -4.8, F3, 2.9, 0.85);
  S.item(cushion, 0, F3, 2.7, 0.85);
  S.item(cushion, 4.8, F3, 2.9, 0.85);
  S.item(cushion, 5.6, F3, 4.1, 0.85);
  for (const lu of [-3.0, 3.0]) {
    S.box('wood', 0.3, 0.06, 0.3, lu, F3 + 0.03, 5.4, W13.plankD);
    S.cyl('wood', 0.05, 0.06, 1.5, 8, lu, F3 + 0.78, 5.4, W13.lacq);
    S.cyl('wood', 0.1, 0.13, 0.06, 8, lu, F3 + 1.56, 5.4, W13.lacq);
    S.box('glow', 0.14, 0.18, 0.14, lu, F3 + 1.68, 5.4, 0xffb066);
  }
  // L3 梁架 + 望板（露明）
  frame(F3, TOP, 5);
  // 匾「一覽臺」
  sg.quad(atlas.text('w13fl3', '一覽臺', 256, 96, { color: '#ffd700', fontPx: 64, bg: 'rgba(30,26,22,0.9)', border: 'rgba(255,215,0,0.45)' }), 2.0, 0.75, ax, F3 + 3.1, az - v + 0.2, 0);
}

// ---------- 相国寺：大殿 + 两侧回廊（26×18，净高 7.6，正面 +z） ----------
/**
 * 相国寺大殿室内 + 回廊：佛坛（三级须弥座 + 主尊背光位 + 莲座 + 帷幔）、供桌（香炉/烛台 2/供果盘 3）、
 * 幡 4、钟 1、鼓 1、蒲团 12、经柜 2；回廊（东西各一道）：碑刻 6、香案、签筒。
 *
 * **宿主殿身在代码里不存在**（src/ 无相国寺），故本函数自带内衬墙、柱、露明梁架（大梁/平梁/檩/椽/望板）、
 * 两侧回廊的台基/廊柱/顶/栏杆。编排者建好殿身后调用：
 *   `buildXiangguoHallInterior(b, sg, atlas, 殿心X, 殿心Z);`
 * 宿主殿身要求：26×18 单层（净高 ≥7.6）、正面 +z 开 ≥3.4m 门洞、两侧不设实墙外皮（回廊贴殿身）。
 */
export function buildXiangguoHallInterior(b: Baker, sg: SignMesher, atlas: SignAtlas, ax = 0, az = 0): void {
  const S = makeStage(b, ax, az);
  const u = 12.45, v = 8.45;
  const F = 0.06;
  const TOP = 7.6;

  // ===== 地面：方砖 + 甬道 + 侧廊 + 门槛石 =====
  S.box('ash', u * 2, 0.14, v * 2, 0, F - 0.07, 0, W13.brick);
  for (let i = -8; i <= 8; i++) S.box('ash', u * 2, 0.012, 0.035, 0, F + 0.004, i * 1.9, W13.brickL);
  for (let i = -6; i <= 6; i++) S.box('ash', 0.035, 0.012, v * 2, i * 1.9, F + 0.004, 0, W13.brickL);
  S.box('ash', 3.0, 0.012, 11.6, 0, F + 0.008, 2.2, W13.ashL);                   // 甬道（门口通佛坛）
  for (const s2 of [-1, 1]) S.box('ash', u - 3.2, 0.01, v * 2 - 0.6, s2 * (3.2 + (u - 3.2) / 2), F + 0.006, 0, shade(W13.brick, 0.86));
  S.box('ash', 3.6, 0.12, 0.4, 0, F + 0.06, v - 0.22, W13.ash);                  // 门槛石
  for (const s2 of [-1, 1]) S.box('ash', 0.2, 0.03, 0.34, s2 * 1.9, F + 0.015, v - 0.22, W13.ashD);

  // ===== 内衬墙 + 正面门洞（3.4 宽）=====
  S.box('wood', u * 2, TOP, 0.14, 0, F + TOP / 2, -v, W13.plank);
  for (const s2 of [-1, 1]) S.box('wood', 0.14, TOP, v * 2, s2 * u, F + TOP / 2, 0, shade(W13.plank, 0.95));
  for (const s2 of [-1, 1]) S.box('wood', u - 1.8, TOP, 0.14, s2 * (1.8 + (u - 1.8) / 2), F + TOP / 2, v, W13.plank);
  S.box('wood', 3.6, TOP - 3.6, 0.14, 0, F + 3.6 + (TOP - 3.6) / 2, v, W13.plank); // 门楣上墙
  S.box('wood', 3.8, 0.24, 0.24, 0, F + 3.62, v - 0.06, W13.beam);
  for (const s2 of [-1, 1]) S.box('wood', 0.2, 3.6, 0.24, s2 * 1.86, F + 1.8, v - 0.06, W13.plankD);
  // 侧壁挂幡的横枋
  for (const s2 of [-1, 1]) S.box('wood', 0.16, 0.18, v * 2 - 1.0, s2 * (u - 0.1), F + 5.2, 0, W13.beam);

  // ===== 金柱 4 根 + 柱础 =====
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    S.box('ash', 0.9, 0.24, 0.9, sx * 6.2, F + 0.12, sz * 3.4, W13.ash);
    S.cyl('wood', 0.32, 0.36, 5.4, 10, sx * 6.2, F + 2.94, sz * 3.4, shade(W13.zhu, 0.94));
    // 柱头斗栱（栌斗 + 华拱 + 散斗）
    S.box('wood', 0.62, 0.2, 0.62, sx * 6.2, F + 5.74, sz * 3.4, shade(W13.zhu, 1.05));
    S.box('wood', 0.34, 0.18, 1.4, sx * 6.2, F + 5.93, sz * 3.4, shade(W13.zhu, 1.1));
    S.box('wood', 1.4, 0.18, 0.34, sx * 6.2, F + 5.93, sz * 3.4, shade(W13.zhu, 1.02));
    for (const dx of [-0.5, 0.5]) S.box('wood', 0.24, 0.14, 0.24, sx * 6.2 + dx, F + 6.1, sz * 3.4, shade(W13.zhu, 1.14));
  }

  // ===== 梁架（露明造：大梁 2 榀 + 平梁 + 脊瓜柱 + 檩 5 道 + 椽 + 望板）=====
  for (const sz of [-1, 1]) {
    S.box('wood', u * 2 - 1.2, 0.3, 0.34, 0, F + 6.16, sz * 3.4, W13.beam);       // 大梁（落在柱头斗栱上）
    for (const sx of [-1, 1]) S.box('wood', 0.22, 0.34, 0.22, sx * 3.0, F + 6.48, sz * 3.4, W13.plankD); // 瓜柱
    S.box('wood', 6.6, 0.24, 0.26, 0, F + 6.77, sz * 3.4, W13.beam);             // 平梁
    for (const sx of [-1, 1]) S.box('wood', 0.1, 0.5, 0.1, sx * 1.6, F + 7.05, sz * 3.4, W13.plankD, 0, 0, sx * 0.34); // 叉手
  }
  S.box('wood', 0.26, 0.9, 0.26, 0, F + 7.06, 0, W13.beam);                      // 脊瓜柱（平梁顶→脊檩底）
  // 檩：脊檩（z=0）+ 金檩（±3.4）+ 檐檩（±7.4）
  for (const [lv, py] of [[0, 7.5], [-3.4, 7.06], [3.4, 7.06], [-7.4, 6.0], [7.4, 6.0]] as const) {
    S.cyl('wood', 0.12, 0.12, u * 2 + 0.4, 8, 0, F + py, lv, W13.beam, 0, 0, Math.PI / 2);
  }
  // 椽（沿进深，前后各一坡）+ 望板
  {
    const dy = 7.5 - 6.0, dz = 7.4, L = Math.hypot(dy, dz), a = Math.atan2(dy, dz);
    const n = Math.round((u * 2) / 0.46);
    for (let i = 0; i < n; i++) {
      const lu = -u + 0.23 + ((u * 2 - 0.46) * i) / (n - 1);
      for (const sz of [-1, 1]) S.box('wood', 0.07, 0.1, L, lu, F + (7.5 + 6.0) / 2 - 0.08, sz * 3.7, shade(W13.deck, 1.06), 0, sz * a, 0);
    }
    for (const sz of [-1, 1]) S.box('wood', u * 2, 0.05, L, 0, F + (7.5 + 6.0) / 2 + 0.02, sz * 3.7, W13.deck, 0, sz * a, 0);
  }

  // ===== 佛坛（三级须弥座；lv=-6.6，进深 3.0）=====
  S.box('ash', 16.0, 0.22, 3.0, 0, F + 0.11, -6.6, W13.ash);
  S.box('ash', 14.6, 0.22, 2.7, 0, F + 0.33, -6.6, W13.ashL);
  S.box('ash', 13.2, 0.22, 2.4, 0, F + 0.55, -6.6, shade(W13.ashL, 1.03));
  S.box('wood', 12.8, 0.1, 2.1, 0, F + 0.71, -6.6, 0x6e3a26);                     // 坛面（朱漆）
  for (let k = 0; k < 9; k++) S.box('ash', 0.9, 0.12, 0.16, -5.4 + k * 1.35, F + 0.38, -5.28, W13.ashD); // 前沿踏跺
  // 主尊：莲座 + 背光 + 龛 + 帷幔（像位留空，交造像资产）
  S.cyl('ash', 1.05, 1.2, 0.24, 12, 0, F + 0.88, -6.9, W13.ashL);
  S.cyl('wood', 0.88, 0.98, 0.18, 12, 0, F + 1.09, -6.9, shade(W13.gold, 0.86));
  S.box('lacquer', 3.6, 4.3, 0.12, 0, F + 3.3, -7.55, 0x5a1f18);                 // 背光板
  S.cyl('lacquer', 1.5, 1.5, 0.1, 18, 0, F + 3.9, -7.48, W13.gold, 0, Math.PI / 2); // 大背光
  for (let i = 0; i < 10; i++) {                                                  // 火焰边
    const a = Math.PI * (i / 9) - Math.PI / 2;
    S.box('lacquer', 0.16, 0.42, 0.05, Math.cos(a) * 1.62, F + 3.9 + Math.sin(a) * 1.62, -7.44, 0xc9a13a, 0, 0, a + Math.PI / 2);
  }
  S.box('wood', 5.2, 0.22, 0.5, 0, F + 5.55, -7.35, W13.beam);                    // 龛顶
  for (const s2 of [-1, 1]) {
    S.box('fabric', 0.9, 3.9, 0.08, s2 * 1.55, F + 3.4, -7.42, 0x9d2933);         // 帷幔（两侧拢起）
    S.box('fabric', 0.5, 3.4, 0.1, s2 * 1.05, F + 3.2, -7.4, 0x7a1f26);
    // 胁侍座
    S.box('ash', 1.2, 0.5, 0.9, s2 * 3.3, F + 1.11, -6.9, W13.ashL);
    S.box('wood', 0.14, 0.1, 0.86, s2 * 3.3, F + 1.4, -6.9, W13.gold);
  }
  // 供桌（坛前）+ 香炉 + 烛台 2 + 供果盘 3 + 香筒
  S.box('lacquer', 5.8, 0.14, 1.0, 0, F + 1.0, -4.6, W13.lacq);
  S.box('wood', 5.5, 0.1, 0.9, 0, F + 0.92, -4.6, W13.plank);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.box('wood', 0.16, 0.86, 0.16, sx * 2.6, F + 0.43, -4.6 + sz * 0.34, W13.lacq);
  S.box('wood', 5.5, 0.2, 0.07, 0, F + 0.76, -4.14, W13.zhuD);
  S.item(censer, 0, F + 1.08, -4.6, 1.5);
  for (const s2 of [-1, 1]) {
    S.cyl('metal', 0.16, 0.2, 0.08, 10, s2 * 1.7, F + 1.11, -4.6, W13.bronze);
    S.cyl('metal', 0.05, 0.06, 0.5, 8, s2 * 1.7, F + 1.4, -4.6, W13.bronze);
    S.cyl('fabric', 0.07, 0.07, 0.26, 8, s2 * 1.7, F + 1.78, -4.6, 0xd8cbb0);
    S.box('glow', 0.055, 0.1, 0.055, s2 * 1.7, F + 1.96, -4.6, 0xffc66e);
  }
  for (let k = 0; k < 3; k++) fruitDish(b, ax - 2.3 + k * 2.3, F + 1.08, az - 4.78, 1.25);

  // ===== 幡 4（自梁下垂：幡杆 + 幡身 + 幡头横带 + 幡脚）=====
  for (let k = 0; k < 4; k++) {
    const lu = [-8.2, -3.2, 3.2, 8.2][k];
    S.cyl('wood', 0.045, 0.05, 3.7, 6, lu, F + 5.35, 2.6, W13.plankD);
    S.box('fabric', 0.66, 3.4, 0.05, lu, F + 4.6, 2.6, [0x9d2933, 0xd4b76a, 0x2a5c42, 0x9d2933][k]);
    S.box('fabric', 0.8, 0.2, 0.06, lu, F + 6.35, 2.6, W13.goldD);                 // 幡头横带
    for (let j = -1; j <= 1; j++) S.box('fabric', 0.1, 0.34, 0.04, lu + j * 0.24, F + 2.72, 2.6, 0xd8cbb0);
  }

  // ===== 钟 1（西侧）/ 鼓 1（东侧）=====
  {
    const zx = -9.9, zz = 5.4;
    for (const s2 of [-1, 1]) S.box('wood', 0.26, 4.2, 0.26, zx + s2 * 1.05, F + 2.1, zz, W13.lacq);
    S.box('wood', 2.6, 0.28, 0.32, zx, F + 4.24, zz, W13.beam);
    S.box('wood', 0.22, 0.66, 0.22, zx, F + 3.95, zz, W13.beam);
    S.cyl('metal', 0.6, 0.6, 1.2, 12, zx, F + 3.02, zz, W13.bronze);
    S.cyl('metal', 0.64, 0.64, 0.1, 12, zx, F + 3.58, zz, shade(W13.bronze, 1.22));
    S.cyl('metal', 0.64, 0.64, 0.1, 12, zx, F + 2.46, zz, shade(W13.bronze, 0.86));
    S.box('wood', 0.42, 0.06, 0.42, zx, F + 4.41, zz, W13.plankD);
    S.cyl('wood', 0.07, 0.09, 2.1, 8, zx + 1.6, F + 1.1, zz + 0.3, 0x8a6a3a, 0, 0, 0.14); // 钟杵
    S.box('wood', 0.5, 0.5, 0.5, zx + 1.6, F + 0.25, zz + 0.3, W13.plankD);                // 杵座
  }
  S.item(greatDrum, 9.9, F, 5.2, 1.05);
  S.box('wood', 1.4, 0.16, 1.4, 9.9, F + 0.08, 5.2, W13.plankD);

  // ===== 蒲团 12（两列各 6）=====
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 6; k++) {
      S.item(cushion, -7.5 + k * 3.0, F, -2.5 + r * 1.7, 0.95);
    }
  }
  // ===== 经柜 2（东西壁各一，五层经卷）=====
  for (const s2 of [-1, 1]) {
    const cu = s2 * (u - 0.42), cv = 0.6;
    S.box('wood', 0.62, 2.4, 3.1, cu, F + 1.2, cv, 0x5a3a22);
    for (const sy of [0.42, 0.98, 1.54, 2.1]) S.box('wood', 0.56, 0.06, 3.0, cu - s2 * 0.04, F + sy, cv, W13.plank);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
      S.cyl('fabric', 0.08, 0.08, 0.5, 8, cu - s2 * 0.02, F + 0.5 + r * 0.56, cv - 1.2 + k * 0.6, r % 2 ? 0xe6dcc2 : 0xd8cbb0, 0, Math.PI / 2);
    }
    S.box('wood', 0.05, 2.3, 0.05, cu - s2 * 0.34, F + 1.2, cv - 1.5, W13.plankD);
    S.box('wood', 0.05, 2.3, 0.05, cu - s2 * 0.34, F + 1.2, cv + 1.5, W13.plankD);
  }
  // ===== 长明灯 2 + 吊灯 4 =====
  for (const s2 of [-1, 1]) {
    const lu = s2 * 4.4, lv = -3.2;
    S.box('ash', 0.36, 0.1, 0.36, lu, F + 0.05, lv, W13.ash);
    S.cyl('wood', 0.06, 0.07, 1.3, 8, lu, F + 0.75, lv, W13.lacq);
    S.cyl('metal', 0.16, 0.11, 0.12, 10, lu, F + 1.44, lv, W13.bronze);
    S.box('glow', 0.07, 0.14, 0.07, lu, F + 1.56, lv, 0xffc66e);
  }
  for (const lu of [-6.0, -2.0, 2.0, 6.0]) {
    S.box('wood', 0.05, 0.9, 0.05, lu, F + 5.6, 0.0, W13.plankD);
    S.box('glow', 0.34, 0.46, 0.34, lu, F + 5.0, 0.0, 0xffa04e);
    S.box('wood', 0.4, 0.06, 0.4, lu, F + 5.26, 0.0, W13.plankD);
    S.box('wood', 0.32, 0.05, 0.32, lu, F + 4.74, 0.0, W13.plankD);
  }
  // 匾「大相國寺」（门内门楣下，朝殿内）
  sg.quad(atlas.text('w13xgs', '大相國寺', 448, 112, { color: '#ffd700', fontPx: 84, bg: 'rgba(30,22,20,0.9)', border: 'rgba(255,215,0,0.5)' }), 3.6, 0.9, ax, F + 3.15, az + v - 0.3, Math.PI);

  // ===== 回廊（东西各一道：台基 + 廊柱 + 梁檩 + 单坡顶 + 栏杆 + 碑刻 3 + 香案 + 签筒）=====
  for (const s2 of [-1, 1]) {
    const bx0 = s2 * 12.5, bx1 = s2 * 16.8;      // 廊跨 x（内沿贴殿身内衬墙 12.45，不留缝）
    const cxr = (bx0 + bx1) / 2;
    S.box('ash', Math.abs(bx1 - bx0), 0.36, 17.4, cxr, F + 0.12, 0, W13.ash);       // 廊台
    S.box('ash', Math.abs(bx1 - bx0) + 0.2, 0.08, 17.6, cxr, F + 0.32, 0, W13.ashL); // 压面
    for (let k = 0; k < 5; k++) {
      const lv = -7.6 + k * 3.8;
      S.box('ash', 0.3, 0.12, 0.3, s2 * 16.4, F + 0.42, lv, W13.ashD);
      S.cyl('wood', 0.14, 0.16, 3.0, 8, s2 * 16.4, F + 1.98, lv, shade(W13.zhu, 0.96));
    }
    S.box('wood', 3.9, 0.2, 0.2, s2 * 14.9, F + 3.56, -7.6, W13.beam);              // 横向梁（前后各一）
    S.box('wood', 3.9, 0.2, 0.2, s2 * 14.9, F + 3.56, 7.6, W13.beam);
    for (const lv of [-7.6, 7.6]) S.cyl('wood', 0.1, 0.1, 3.9, 8, s2 * 14.9, F + 3.72, lv, W13.beam, 0, 0, Math.PI / 2);
    S.cyl('wood', 0.1, 0.1, 17.2, 8, s2 * 16.1, F + 3.7, 0, W13.beam, 0, Math.PI / 2, 0);  // 纵向檐檩（承屋面）
    S.cyl('wood', 0.1, 0.1, 17.2, 8, s2 * 13.4, F + 3.96, 0, W13.beam, 0, Math.PI / 2, 0);  // 纵向内檩
    // 单坡顶（向院内低、向外高）
    S.box('roof', 4.0, 0.16, 17.2, cxr, F + 3.86, 0, shade(C.tile, 1.04), 0, 0, s2 * 0.14);
    S.box('roof', 4.2, 0.14, 17.4, cxr, F + 3.72, 0, shade(C.tile, 0.8), 0, 0, s2 * 0.14);
    // 外沿栏杆
    for (let k = 0; k < 6; k++) S.box('wood', 0.1, 0.95, 0.1, s2 * 16.55, F + 0.85, -7.6 + k * 3.04, W13.zhuD);
    S.box('wood', 0.09, 0.09, 16.4, s2 * 16.55, F + 1.3, 0, shade(W13.zhu, 1.04));
    S.box('wood', 0.07, 0.07, 16.4, s2 * 16.55, F + 0.86, 0, shade(W13.zhu, 0.96));
    // 碑刻 3 座（贴殿身外皮，碑面朝廊内）
    for (let k = 0; k < 3; k++) {
      const lv = -4.6 + k * 4.6;
      S.box('ash', 0.9, 0.24, 0.5, s2 * 13.3, F + 0.48, lv, W13.ashD);
      S.box('ash', 0.2, 1.6, 0.72, s2 * 13.36, F + 1.36, lv, W13.ash);
      S.box('ash', 0.26, 0.22, 0.84, s2 * 13.36, F + 2.26, lv, W13.ashL);
      for (let r = 0; r < 3; r++) S.box('ash', 0.02, 0.26, 0.5, s2 * 13.26, F + 1.82 - r * 0.36, lv, 0xe6dcc2);
      S.box('ash', 0.22, 0.1, 0.4, s2 * 13.3, F + 0.38, lv, W13.ash);
    }
    // 香案 + 签筒 2 + 香炉
    S.box('wood', 0.9, 0.08, 1.6, s2 * 14.6, F + 1.02, -2.4, W13.plank);
    for (const dz of [-0.6, 0.6]) S.box('wood', 0.8, 0.9, 0.1, s2 * 14.6, F + 0.55, -2.4 + dz, W13.plankD);
    S.item(censer, s2 * 14.6, F + 1.06, -2.4, 0.8);
    signTube(b, ax + s2 * 14.35, F + 1.06, az - 3.05, 1);
    signTube(b, ax + s2 * 14.35, F + 1.06, az - 2.9, 0.92);
    // 廊灯 2
    for (const lv of [-3.8, 3.8]) {
      S.box('wood', 0.05, 0.5, 0.05, s2 * 15.9, F + 3.2, lv, W13.plankD);
      S.box('glow', 0.24, 0.32, 0.24, s2 * 15.9, F + 2.86, lv, 0xffa04e);
    }
  }
}

// ---------- W13 总装 ----------
export interface LandmarkW13Options {
  /** 州桥桥面市集（敞面，可直接接线） */
  zhouqiao?: boolean;
  /** 上清观正殿（复用 540,118 空腔；须同时把 STREET_HOUSE_SLOTS 的「上清茶寮」滤掉） */
  shangqing?: boolean;
  /** 樊楼（宿主楼体不存在，默认关） */
  fanlou?: boolean;
  /** 相国寺（宿主殿身不存在，默认关） */
  xiangguo?: boolean;
  /** 樊楼楼心（宿主建成后传真实坐标） */
  fanlouAt?: [number, number];
  /** 相国寺殿心 */
  xiangguoAt?: [number, number];
}

/**
 * 已把「上清茶寮」（x:540 z:118，与上清觀同一座空腔）让给上清观正殿的街屋表。
 * 接线时用它替代 STREET_HOUSE_SLOTS：
 *   `buildStreetInteriors(baker, sg, this.atlas, new RNG(0x5e7a1), STREET_HOUSE_SLOTS_W13);`
 * 若仍传默认表，茶坊的砖地/梁架/矮桌会和道观正殿叠在同一间屋里。
 */
export const STREET_HOUSE_SLOTS_W13: StreetHouseSpec[] =
  STREET_HOUSE_SLOTS.filter((s) => !(s.x === 540 && s.z === 118));

/**
 * W13 地标室内总装（由编排者在 world.ts 的「筑城营街」组里接线，一行：
 *   `buildLandmarkInteriors2(baker, sg, this.atlas);`）
 * 默认只建**能立即成立的**两处：州桥桥面市集 + 上清观正殿。
 * 樊楼/相国寺的宿主楼体尚不存在，传 `{ fanlou: true, fanlouAt: [x, z] }` 等显式开启。
 * 全程无随机数（四处的落位都是定值），不碰 world.ts 的共享 rng 链。
 */
export function buildLandmarkInteriors2(b: Baker, sg: SignMesher, atlas: SignAtlas, opt: LandmarkW13Options = {}): void {
  if (opt.zhouqiao !== false) buildZhouqiaoMarket(b, sg, atlas);
  if (opt.shangqing !== false) buildShangqingHall(b, sg, atlas);
  if (opt.fanlou) buildFanlouInterior(b, sg, atlas, ...(opt.fanlouAt ?? [0, 0]));
  if (opt.xiangguo) buildXiangguoHallInterior(b, sg, atlas, ...(opt.xiangguoAt ?? [0, 0]));
}

/**
 * W13 室内点光（可选，编排者拼进 world.ts 的 INTERIOR_LIGHTS 循环即可）。
 * 只给 3 盏：桥心井亭 / 上清观正殿 / 相国寺殿心——PointLight 数量直接影响片元开销，
 * 樊楼三层室内暂不点灯（宿主楼体建成后再补）。
 */
export const W13_INTERIOR_LIGHTS: { x: number; y: number; z: number; color: number; int: number; dist: number }[] = [
  { x: 0, y: 9.1 + 2.2, z: 0, color: 0xffa04e, int: 34, dist: 8 },      // 州桥桥心井亭
  { x: 540, y: 2.2, z: 118, color: 0xffa04e, int: 62, dist: 11 },       // 上清观正殿
  { x: 0, y: 3.2, z: 0, color: 0xffb25e, int: 90, dist: 16 },           // 相国寺殿心（宿主建成后启用）
];

// ============ R16：街铺业态室内（centralbelt / riverbank 共用） ============
// 判词（用户原话）：「所有店铺等场所内，应该有什么家具、摆设、布局、物品、装饰等，
// 以前设计开发过，现在怎么都没了，只剩桌椅？？？」
//
// 现场（对源核对）：本文件前四套 dress* 只服务 9 座手工街屋；centralbelt.ts（临街 559 + 后巷 320）
// 与 riverbank.ts（临水排 1017 + 内侧排 1004）的 2900 间铺面是**实心盒**，没有门洞也没有内衬，
// 进屋这件事在那两条街上根本不成立。本节给出能被这两条带直接调用的业态陈设库：
//
//   · 8 个业态，每业态 12 件常备 + 每形态 4 件独有（共 24 个器物名），单间 16 件；
//   · 同业态任意两种形态的器物集合差异 = 8/20 = 40%（要求 ≥20%）；
//   · 随机性只走坐标 hash，不消耗共享 RNG（与本文件既有约定一致）；
//   · 预算：单间 ≈ 200 面（2900 间 ≈ 580k），全部单件/双件构件，不用任何曲面屋顶。
//
// 与既有 dress* 的关系：不替换、不删除。9 座手工街屋继续走原来的 dressShop/dressTavern/
// dressTeahouse（它们本来就有柜台/货架/酒垆/茶灶），本节只补两条商业带那 2900 间。

export type ShopTrade = 'teahouse' | 'tavern' | 'cloth' | 'pharmacy' | 'bookshop' | 'bank' | 'noodle' | 'general';

export const SHOP_TRADES: readonly ShopTrade[] = [
  'teahouse', 'tavern', 'cloth', 'pharmacy', 'bookshop', 'bank', 'noodle', 'general',
];

export const TRADE_LABEL: Record<ShopTrade, string> = {
  teahouse: '茶楼', tavern: '酒楼', cloth: '布庄', pharmacy: '药铺',
  bookshop: '书坊', bank: '钱铺', noodle: '面馆', general: '杂货铺',
};

/** 器物形制：单盒 / 圆柱 / 桌（面+腿）/ 货架（背板+两层担）/ 架（两柱一横）/ 摞（三件小件） */
type Arche = 'box' | 'cyl' | 'table' | 'shelf' | 'frame' | 'stack';

interface ItemDef {
  /** 中文名（审计/报告直接用，判据「每类业态 ≥12 件可辨识器物」按它数） */
  n: string;
  g: BGroup;
  a: Arche;
  w: number; h: number; d: number;
  hex: number;
  hex2?: number;
  /** 长轴方向：'u' 沿面阔靠后墙，'v' 沿进深靠侧墙 */
  rot?: 'u' | 'v';
  /** 挂件：贴墙抬到 F + h*0.55 */
  wall?: boolean;
}

const T_WOOD = 0x6b4a2b;
const T_WOOD_D = 0x4a3220;
const T_LAC = 0x4a2a20;
const T_CLOTH = 0xe6dcc2;
const T_RED = 0x9d2933;
const T_CLAY = 0x955539;
const T_IRON = 0x4a4030;
const T_BRONZE = 0x8a6a3a;
const T_PAPER = 0xd8cbb0;
const T_STONE = 0x8d8a80;

/** 器物字典：55 个可辨识器件，8 个业态从里面组 24 件/业态 */
const ITEM: Record<string, ItemDef> = {
  // —— 通用家具 ——
  counter: { n: '柜台', g: 'wood', a: 'box', w: 2.4, h: 0.92, d: 0.62, hex: T_WOOD },
  shelf: { n: '货架', g: 'wood', a: 'shelf', w: 1.9, h: 1.86, d: 0.44, hex: T_WOOD },
  table: { n: '方桌', g: 'wood', a: 'table', w: 0.95, h: 0.78, d: 0.95, hex: T_WOOD },
  longTable: { n: '长条案', g: 'wood', a: 'table', w: 2.0, h: 0.76, d: 0.62, hex: T_LAC },
  stool: { n: '方凳', g: 'wood', a: 'box', w: 0.36, h: 0.46, d: 0.36, hex: T_WOOD_D },
  bench: { n: '长凳', g: 'wood', a: 'box', w: 1.4, h: 0.46, d: 0.32, hex: T_WOOD_D },
  cabinet: { n: '立柜', g: 'wood', a: 'box', w: 1.1, h: 1.9, d: 0.55, hex: T_WOOD_D },
  chest: { n: '木箱', g: 'wood', a: 'box', w: 0.9, h: 0.6, d: 0.55, hex: T_LAC },
  altar: { n: '供案', g: 'lacquer', a: 'box', w: 1.6, h: 0.95, d: 0.5, hex: T_LAC },
  screen: { n: '屏风', g: 'lacquer', a: 'box', w: 1.8, h: 1.85, d: 0.09, hex: T_CLOTH },
  mat: { n: '苇席', g: 'fabric', a: 'box', w: 1.5, h: 0.09, d: 1.5, hex: T_CLOTH },
  cushion: { n: '蒲团', g: 'fabric', a: 'box', w: 0.44, h: 0.16, d: 0.44, hex: 0xb9a08a },
  lantern: { n: '灯笼', g: 'glow', a: 'box', w: 0.3, h: 0.42, d: 0.3, hex: 0xffa04e },
  banner: { n: '幌子', g: 'fabric', a: 'box', w: 0.06, h: 1.5, d: 0.62, hex: T_RED, rot: 'v' },
  scroll: { n: '挂画', g: 'fabric', a: 'box', w: 0.7, h: 1.2, d: 0.04, hex: T_CLOTH, wall: true },
  brazier: { n: '火盆', g: 'metal', a: 'cyl', w: 0.62, h: 0.42, d: 0.62, hex: T_IRON },
  censer: { n: '香炉', g: 'metal', a: 'cyl', w: 0.36, h: 0.32, d: 0.36, hex: T_BRONZE },
  waterVat: { n: '水缸', g: 'ceramic', a: 'cyl', w: 0.76, h: 0.72, d: 0.76, hex: 0x7a6a52 },
  jar: { n: '陶坛', g: 'ceramic', a: 'cyl', w: 0.56, h: 0.86, d: 0.56, hex: T_CLAY },
  basket: { n: '竹筐', g: 'wood', a: 'cyl', w: 0.54, h: 0.4, d: 0.54, hex: 0x9a7b4a },
  sack: { n: '粮袋', g: 'fabric', a: 'box', w: 0.52, h: 0.62, d: 0.44, hex: 0xc9b48c },
  scoop: { n: '量斗', g: 'wood', a: 'box', w: 0.32, h: 0.26, d: 0.32, hex: 0x8a6a3a },
  // —— 茶 / 酒 ——
  kettle: { n: '汤瓶', g: 'metal', a: 'cyl', w: 0.32, h: 0.36, d: 0.32, hex: T_BRONZE },
  cupRow: { n: '盏列', g: 'ceramic', a: 'stack', w: 0.72, h: 0.2, d: 0.26, hex: 0xe6dcc2 },
  teaBoard: { n: '茶牌水牌', g: 'wood', a: 'box', w: 0.06, h: 0.9, d: 0.42, hex: T_PAPER, rot: 'v' },
  teaMill: { n: '茶碾', g: 'ash', a: 'box', w: 0.9, h: 0.4, d: 0.42, hex: T_STONE },
  wineBoard: { n: '酒牌', g: 'wood', a: 'box', w: 0.06, h: 0.44, d: 0.3, hex: T_PAPER, rot: 'v' },
  wineJar: { n: '酒瓮', g: 'ceramic', a: 'cyl', w: 0.62, h: 0.92, d: 0.62, hex: 0x8a5a3a },
  wineSea: { n: '银酒海', g: 'metal', a: 'cyl', w: 0.8, h: 0.72, d: 0.8, hex: 0x9a9a92 },
  // —— 布 ——
  rack: { n: '布架', g: 'wood', a: 'frame', w: 1.9, h: 1.72, d: 0.4, hex: T_WOOD, rot: 'u' },
  boltStack: { n: '布匹', g: 'fabric', a: 'stack', w: 0.86, h: 0.34, d: 0.42, hex: 0x2a5c42 },
  measuringRod: { n: '量尺', g: 'wood', a: 'box', w: 0.94, h: 0.05, d: 0.06, hex: 0xd4b76a },
  scissors: { n: '剪刀', g: 'metal', a: 'box', w: 0.28, h: 0.05, d: 0.1, hex: 0x8a8a86 },
  dyeVat: { n: '染缸', g: 'ceramic', a: 'cyl', w: 0.92, h: 0.8, d: 0.92, hex: 0x2f4a5a },
  // —— 药 ——
  drawerCabinet: { n: '百眼药柜', g: 'wood', a: 'box', w: 1.7, h: 1.92, d: 0.44, hex: T_WOOD_D, rot: 'u' },
  mortar: { n: '碾槽', g: 'ash', a: 'box', w: 1.1, h: 0.42, d: 0.44, hex: T_STONE },
  beamScale: { n: '杆秤', g: 'metal', a: 'frame', w: 0.9, h: 0.92, d: 0.3, hex: T_BRONZE, rot: 'u' },
  herbBale: { n: '药包', g: 'fabric', a: 'box', w: 0.36, h: 0.28, d: 0.28, hex: 0xcbbfa2 },
  medicineScale: { n: '戥子', g: 'metal', a: 'box', w: 0.34, h: 0.16, d: 0.22, hex: T_BRONZE },
  cauldron: { n: '药鼎', g: 'metal', a: 'cyl', w: 0.66, h: 0.56, d: 0.66, hex: T_IRON },
  // —— 书 ——
  bookStack: { n: '书堆', g: 'fabric', a: 'stack', w: 0.62, h: 0.44, d: 0.44, hex: 0xcbbfa2 },
  inkSlab: { n: '砚台笔架', g: 'ash', a: 'box', w: 0.54, h: 0.14, d: 0.3, hex: 0x2b2b2b },
  brushPot: { n: '笔筒', g: 'ceramic', a: 'cyl', w: 0.18, h: 0.26, d: 0.18, hex: 0x5a6472 },
  paperStack: { n: '纸垛', g: 'fabric', a: 'box', w: 0.62, h: 0.32, d: 0.46, hex: T_CLOTH },
  // —— 钱 ——
  abacus: { n: '算盘', g: 'lacquer', a: 'box', w: 0.46, h: 0.07, d: 0.28, hex: 0x2e1a16 },
  coinString: { n: '钱串', g: 'metal', a: 'box', w: 0.32, h: 0.38, d: 0.32, hex: 0xb08a34 },
  lockBox: { n: '钱箱', g: 'lacquer', a: 'box', w: 0.62, h: 0.46, d: 0.44, hex: 0x5a1f18 },
  ledgerStand: { n: '账簿架', g: 'wood', a: 'frame', w: 0.82, h: 1.1, d: 0.32, hex: T_WOOD, rot: 'u' },
  // —— 面馆 ——
  stove: { n: '灶台', g: 'earth', a: 'box', w: 1.1, h: 0.82, d: 0.68, hex: 0xa8926a },
  pot: { n: '铁锅', g: 'metal', a: 'cyl', w: 0.62, h: 0.26, d: 0.62, hex: T_IRON },
  bowlRow: { n: '面碗', g: 'ceramic', a: 'stack', w: 0.74, h: 0.18, d: 0.28, hex: 0xe6dcc2 },
  chopstickTub: { n: '筷筒', g: 'wood', a: 'cyl', w: 0.2, h: 0.3, d: 0.2, hex: 0x9a7b4a },
  steamer: { n: '蒸笼', g: 'wood', a: 'cyl', w: 0.52, h: 0.38, d: 0.52, hex: 0xb08a56 },
  firewood: { n: '柴堆', g: 'wood', a: 'box', w: 0.92, h: 0.5, d: 0.5, hex: 0x574530 },
  doughBoard: { n: '面案', g: 'wood', a: 'box', w: 1.2, h: 0.82, d: 0.68, hex: 0x8a6a3a },
  noodleRack: { n: '面架', g: 'wood', a: 'frame', w: 1.6, h: 1.6, d: 0.36, hex: T_WOOD, rot: 'u' },
  meatHook: { n: '肉钩', g: 'metal', a: 'frame', w: 0.6, h: 1.42, d: 0.12, hex: T_IRON, rot: 'u' },
  // —— 杂货 ——
  oilJar: { n: '油篓', g: 'wood', a: 'cyl', w: 0.46, h: 0.62, d: 0.46, hex: 0x8a5a2a },
  ropeCoil: { n: '绳圈', g: 'fabric', a: 'cyl', w: 0.42, h: 0.14, d: 0.42, hex: 0xb9a06a },
  fishBarrel: { n: '鱼盆', g: 'ceramic', a: 'cyl', w: 0.72, h: 0.42, d: 0.72, hex: 0x3a5a6a },
};

/**
 * 器物在房间里的**职能**：舱位布局按职能取件，不按清单顺序取件。
 * （旧版按清单顺序摆，第 5 件之后就被 maxItems 截断，永远只出现前 5 件。）
 */
type ItemRole = 'back' | 'mid' | 'seat' | 'small' | 'front' | 'wall';

const ITEM_ROLE: Record<string, ItemRole> = {
  counter: 'front', waterVat: 'front', fishBarrel: 'front', wineSea: 'front',
  shelf: 'back', rack: 'back', cabinet: 'back', drawerCabinet: 'back', screen: 'back',
  altar: 'back', ledgerStand: 'back', noodleRack: 'back', meatHook: 'back',
  // 幌子 / 水牌 / 酒牌是**挂**在门楣与墙上的，不是立在地上的板；按 small 摆会立在屋子中间挡路
  banner: 'wall', teaBoard: 'wall', wineBoard: 'wall',
  table: 'mid', longTable: 'mid', stove: 'mid', teaMill: 'mid', doughBoard: 'mid',
  mortar: 'mid', cauldron: 'mid', dyeVat: 'mid', brazier: 'mid',
  stool: 'seat', bench: 'seat', cushion: 'seat', mat: 'seat',
};

/** 需要配座具的中部主件 */
const SEATS_WITH = new Set(['table', 'longTable', 'altar', 'doughBoard']);

function roleOf(key: string): ItemRole {
  const def = ITEM[key];
  if (def?.wall) return 'wall';
  return ITEM_ROLE[key] ?? 'small';
}

/** 一行器物：id / 面阔向比例 / 进深向比例 / 形态掩码（0=全形态，1<<v）/ 缩放 */
type KitRow = readonly [string, number, number, number, number?];

const V0 = 1, V1 = 2, V2 = 4;

/** 8 业态 × (12 常备 + 3×4 独有) */
const TRADE_KIT: Record<ShopTrade, readonly KitRow[]> = {
  teahouse: [
    ['counter', 0.58, 0.66, 0], ['shelf', -0.72, 0.72, 0], ['table', -0.26, -0.18, 0],
    ['table', 0.34, 0.12, 0], ['stool', -0.32, -0.66, 0], ['stool', 0.42, -0.2, 0],
    ['jar', -0.82, -0.62, 0], ['lantern', 0.0, 0.0, 0], ['banner', 0.86, -0.34, 0],
    ['waterVat', -0.84, 0.06, 0], ['censer', 0.12, 0.78, 0], ['scroll', 0.0, 0.95, 0],
    ['screen', 0.62, -0.66, V0], ['cushion', -0.3, 0.1, V0], ['teaBoard', -0.9, 0.42, V0], ['kettle', 0.62, 0.6, V0],
    ['longTable', 0.0, 0.32, V1], ['cupRow', 0.16, 0.32, V1], ['mat', 0.0, -0.42, V1], ['jar', 0.72, 0.7, V1],
    ['stove', -0.66, 0.42, V2], ['teaMill', 0.66, 0.42, V2], ['basket', 0.7, 0.72, V2], ['firewood', -0.66, -0.14, V2],
  ],
  tavern: [
    ['counter', -0.62, 0.52, 0], ['wineSea', -0.62, 0.52, 0], ['wineJar', -0.86, 0.76, 0],
    ['longTable', -0.1, -0.2, 0], ['longTable', 0.56, 0.22, 0], ['bench', -0.1, -0.66, 0],
    ['bench', 0.56, -0.24, 0], ['jar', 0.88, 0.62, 0], ['lantern', 0.0, 0.0, 0],
    ['banner', 0.88, -0.5, 0], ['cabinet', 0.86, 0.8, 0], ['scroll', 0.0, 0.95, 0],
    ['wineBoard', -0.9, 0.34, V0], ['cupRow', 0.2, -0.2, V0], ['screen', -0.5, -0.7, V0], ['waterVat', 0.6, 0.74, V0],
    ['steamer', 0.56, 0.7, V1], ['pot', 0.72, 0.7, V1], ['firewood', 0.86, 0.34, V1], ['meatHook', -0.88, 0.1, V1],
    ['brazier', -0.5, 0.2, V2], ['abacus', -0.3, 0.52, V2], ['chest', 0.74, -0.6, V2], ['sack', -0.84, -0.4, V2],
  ],
  cloth: [
    ['rack', -0.66, 0.72, 0], ['rack', 0.2, 0.72, 0], ['boltStack', -0.2, 0.3, 0],
    ['counter', 0.56, 0.34, 0], ['cabinet', 0.86, 0.74, 0], ['chest', -0.86, -0.5, 0],
    ['table', 0.1, -0.24, 0], ['stool', 0.1, -0.66, 0], ['lantern', 0.0, 0.0, 0],
    ['banner', 0.88, -0.34, 0], ['scroll', 0.0, 0.95, 0], ['jar', -0.8, 0.28, 0],
    ['measuringRod', 0.56, 0.34, V0], ['abacus', 0.8, 0.34, V0], ['scissors', 0.36, 0.34, V0], ['dyeVat', -0.66, -0.2, V0],
    ['oilJar', 0.68, 0.76, V1], ['basket', -0.66, -0.2, V1], ['sack', 0.84, -0.44, V1], ['waterVat', -0.86, 0.76, V1],
    ['paperStack', 0.4, 0.76, V2], ['herbBale', 0.06, 0.72, V2], ['ropeCoil', -0.4, -0.66, V2], ['teaMill', -0.5, 0.34, V2],
  ],
  pharmacy: [
    ['drawerCabinet', -0.62, 0.86, 0], ['counter', 0.46, 0.42, 0], ['shelf', 0.86, 0.72, 0],
    ['mortar', -0.5, -0.1, 0], ['beamScale', 0.66, 0.42, 0], ['jar', -0.86, 0.74, 0],
    ['table', 0.1, -0.44, 0], ['stool', 0.46, -0.6, 0], ['lantern', 0.0, 0.0, 0],
    ['banner', 0.88, -0.34, 0], ['censer', 0.1, 0.8, 0], ['waterVat', -0.84, -0.3, 0],
    ['herbBale', -0.3, 0.62, V0], ['abacus', 0.28, 0.42, V0], ['medicineScale', 0.2, 0.42, V0], ['basket', -0.66, -0.62, V0],
    ['herbBale', 0.72, -0.16, V1], ['jar', 0.84, 0.16, V1], ['table', -0.1, 0.16, V1], ['sack', -0.72, 0.2, V1],
    ['cauldron', 0.6, -0.34, V2], ['chest', 0.86, 0.06, V2], ['screen', -0.4, 0.72, V2], ['mortar', -0.76, -0.6, V2],
  ],
  bookshop: [
    ['shelf', -0.7, 0.78, 0], ['shelf', 0.1, 0.78, 0], ['bookStack', -0.3, 0.3, 0],
    ['table', 0.5, -0.1, 0], ['stool', 0.5, -0.5, 0], ['inkSlab', 0.5, -0.1, 0],
    ['counter', 0.84, 0.6, 0], ['cabinet', -0.86, -0.44, 0], ['lantern', 0.0, 0.0, 0],
    ['banner', 0.88, -0.44, 0], ['scroll', 0.0, 0.95, 0], ['censer', 0.16, 0.72, 0],
    ['brushPot', 0.5, -0.1, V0], ['paperStack', -0.62, -0.6, V0], ['abacus', 0.84, 0.6, V0], ['screen', 0.4, 0.66, V0],
    ['cushion', 0.5, -0.5, V1], ['bookStack', 0.66, -0.6, V1], ['brushPot', 0.72, -0.1, V1], ['longTable', -0.2, -0.4, V1],
    ['brazier', -0.66, -0.16, V2], ['paperStack', 0.7, 0.3, V2], ['chest', 0.84, -0.3, V2], ['stool', -0.2, -0.7, V2],
  ],
  bank: [
    ['counter', 0.1, 0.5, 0], ['cabinet', -0.7, 0.82, 0], ['chest', 0.84, 0.7, 0],
    ['abacus', 0.1, 0.5, 0], ['beamScale', 0.62, 0.5, 0], ['lockBox', -0.2, 0.5, 0],
    ['stool', 0.6, -0.34, 0], ['table', -0.2, -0.44, 0], ['lantern', 0.0, 0.0, 0],
    ['banner', 0.88, -0.4, 0], ['waterVat', -0.84, -0.34, 0], ['scroll', 0.0, 0.95, 0],
    ['coinString', 0.3, 0.5, V0], ['ledgerStand', -0.6, 0.42, V0], ['screen', -0.4, -0.7, V0], ['sack', 0.84, -0.2, V0],
    ['oilJar', 0.3, 0.62, V1], ['brazier', 0.7, -0.2, V1], ['jar', -0.5, 0.56, V1], ['kettle', 0.74, 0.3, V1],
    ['paperStack', 0.74, 0.76, V2], ['inkSlab', 0.58, 0.42, V2], ['ropeCoil', -0.5, 0.5, V2], ['scoop', -0.2, -0.62, V2],
  ],
  noodle: [
    ['stove', -0.7, 0.62, 0], ['pot', -0.7, 0.62, 0], ['steamer', 0.72, 0.62, 0],
    ['longTable', -0.12, -0.16, 0], ['longTable', 0.56, 0.2, 0], ['bench', -0.12, -0.62, 0],
    ['bench', 0.56, -0.18, 0], ['bowlRow', -0.5, 0.3, 0], ['jar', -0.86, -0.5, 0],
    ['lantern', 0.0, 0.0, 0], ['banner', 0.88, -0.5, 0], ['waterVat', 0.84, 0.8, 0],
    ['firewood', -0.86, 0.16, V0], ['chopstickTub', -0.1, 0.24, V0], ['doughBoard', 0.4, 0.66, V0], ['basket', 0.86, 0.3, V0],
    ['noodleRack', 0.1, 0.72, V1], ['bowlRow', 0.5, 0.2, V1], ['kettle', -0.5, 0.24, V1], ['sack', -0.86, -0.64, V1],
    ['meatHook', 0.82, 0.34, V2], ['cupRow', 0.34, 0.2, V2], ['firewood', 0.7, -0.6, V2], ['pot', 0.4, 0.62, V2],
  ],
  general: [
    ['shelf', -0.7, 0.8, 0], ['shelf', 0.1, 0.8, 0], ['counter', 0.62, 0.4, 0],
    ['basket', -0.3, 0.24, 0], ['jar', 0.3, 0.24, 0], ['sack', -0.8, -0.34, 0],
    ['chest', 0.84, 0.56, 0], ['table', 0.1, -0.46, 0], ['stool', 0.5, -0.6, 0],
    ['lantern', 0.0, 0.0, 0], ['banner', 0.88, -0.44, 0], ['scoop', 0.6, 0.4, 0],
    ['oilJar', -0.86, 0.6, V0], ['ropeCoil', -0.4, 0.72, V0], ['fishBarrel', 0.62, 0.82, V0], ['measuringRod', 0.8, 0.4, V0],
    ['paperStack', 0.66, -0.1, V1], ['boltStack', -0.5, 0.3, V1], ['kettle', 0.42, 0.24, V1], ['basket', 0.86, 0.16, V1],
    ['meatHook', -0.7, 0.44, V2], ['oilJar', 0.66, 0.2, V2], ['sack', 0.9, 0.66, V2], ['firewood', -0.66, -0.6, V2],
  ],
};

/** 一个业态在某个形态下的器物名集合（审计/报告直接读，便于机检 ≥12 件与 ≥20% 差异） */
export function tradeItemNames(trade: ShopTrade, variant: number): string[] {
  const out: string[] = [];
  for (const r of TRADE_KIT[trade]) {
    const mask = r[3];
    if (mask !== 0 && (mask & (1 << (variant & 3))) === 0) continue;
    out.push(ITEM[r[0]].n);
  }
  return out;
}

/** 纯数据审计：每业态每形态件数 + 同业态三种形态两两差异比 */
export function shopInteriorAudit(): {
  trade: ShopTrade; label: string; perVariant: number[]; distinct: number;
  pairwise: number[]; minPairwise: number;
}[] {
  return SHOP_TRADES.map((trade) => {
    const sets = [0, 1, 2].map((v) => new Set(tradeItemNames(trade, v)));
    const pairwise: number[] = [];
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        const A = sets[a], B = sets[b];
        let inter = 0;
        for (const x of A) if (B.has(x)) inter++;
        const uni = A.size + B.size - inter;
        pairwise.push(uni > 0 ? (uni - inter) / uni : 0);
      }
    }
    const all = new Set<string>();
    for (const r of TRADE_KIT[trade]) all.add(ITEM[r[0]].n);
    return {
      trade, label: TRADE_LABEL[trade],
      perVariant: sets.map((s) => s.size),
      distinct: all.size,
      pairwise,
      minPairwise: Math.min(...pairwise),
    };
  });
}

/** 坐标 hash（0–1）：与 centralbelt / riverbank 同式，不消耗共享 RNG */
function r16hash(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** 花色 5 种：桃红 / 杏黄 / 梨白 / 紫 / 金——不许全是绿球（判据 ⑤） */
export const FLOWER_TONES = [0xe4576f, 0xf0b23a, 0xf2e6d8, 0x9a6bd0, 0xe8c04a] as const;

/** 花丛：一丛绿篱 + 一球花（44 面），5 色轮换。中央商业带与河岸带共用 */
export function flowerBush(b: Baker, x: number, z: number, s: number, tone: number): void {
  const c = FLOWER_TONES[((tone % 5) + 5) % 5];
  b.box('leaf', 1.05 * s, 0.5 * s, 1.05 * s, x, 0.25 * s, z, shade(0x3f6a3c, 0.94));
  b.sphere('leaf', 0.46 * s, 4, x, 0.62 * s, z, c);
  b.kit('belt.flower', 1, 0.6 * s);
}

/**
 * 山墙三角（双面各一片，共 2 面）：封住 `roofC` 曲面单元与双坡板顶两端的敞口。
 *
 * 判词：「很多房顶为什么两侧都是空的？？？审核所有宫殿、建筑！！！」
 * 现场：`centralbelt.frontShop` 的 `roofC` 是半圆筒形壳体，**两端本来就是敞口**；
 * `backShop` / `riverbank` 的双坡斜板也只铺到面阔两端就断，端头直接露出屋腔。
 * 逐顶补一块薄盒子封山会撑出屋面（矩形盒在檐口处高出曲面），补两块斜板又是 48 面/顶；
 * 三角单面只用 **2 面/顶端、4 面/顶**，是唯一能覆盖 3400 顶的写法。
 *
 * @param halfW 三角底半宽（进深方向，取屋面进深的 0.53 倍把檐口包住）
 * @param rise  脊高（从檐口算）
 * @param ry    旋转：法线朝 +z 用 0，朝 −z 用 π，朝 ±x 用 ∓π/2
 */
export function gableTriangle(b: Baker, halfW: number, rise: number, x: number, y: number, z: number, ry: number, hex: number): void {
  // 原三角：6 顶点、双法线（+z / −z 各一片），在 wall 组 FrontSide 下双面可见 —— 结构保持不变。
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -halfW, 0, 0, halfW, 0, 0, 0, rise, 0,
    halfW, 0, 0, -halfW, 0, 0, 0, rise, 0,
  ], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ], 3));
  // R20：粉刷肌理 UV 密度 0.24/m → 0.8/m，wallTex 真正重复，端头不再是一整片纯色。
  const GUV = 0.8;
  const uu = halfW * 2 * GUV, vv = rise * GUV;
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, uu, 0, uu * 0.5, vv, uu, 0, 0, 0, uu * 0.5, vv], 2));
  b.addGeo('wall', geo, x, y, z, hex, ry, 0, 0);

  // ---- R20 宋式山花装饰（判词「端头仍读作一整片无纹理的浅赭三角面」）----
  // 局部 XY 平面与三角同一套，z 略偏 ±off 免 z-fighting；ry 由 addGeo 统一处理，
  // 天然适配 centralbelt 的 ry=0/π 与 riverbank 的 ry=±π/2。全部尺寸由 halfW/rise
  // 确定性推导，不消耗共享 RNG；前后两面各一组（wall/wood 均为 FrontSide，须各自保证绕序）。
  const m = Math.min(halfW, rise);
  const off = 0.045;                       // 前后饰面各偏 0.045
  const bw = 0.18 * m;                     // 博风板宽（0.16~0.22 × min(halfW,rise)）
  const L = Math.max(1e-6, Math.hypot(halfW, rise));
  const uK = 0.8;                          // 木作 UV 密度
  const dpos: number[] = [], dnor: number[] = [], duv: number[] = [];
  // 压一个三角形；nz<0（背面）时反转绕序，FrontSide 材质下从两侧都可见。
  const tri = (a: [number, number], bb: [number, number], c: [number, number], zz: number, nz: number): void => {
    const p = nz > 0 ? [a, bb, c] : [a, c, bb];
    for (const q of p) { dpos.push(q[0], q[1], zz); dnor.push(0, 0, nz); duv.push(q[0] * uK, q[1] * uK); }
  };
  // 凸四边形 → 2 三角形；自动规范成从 +z 看逆时针（FrontSide 正确朝向）。
  const quad = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], zz: number, nz: number): void => {
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const q = cross >= 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
    tri(q[0], q[1], q[2], zz, nz);
    tri(q[0], q[2], q[3], zz, nz);
  };
  const bar = (cx: number, cy: number, hx: number, hy: number, zz: number, nz: number): void =>
    quad([cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy], zz, nz);
  const diamond = (cx: number, cy: number, rx: number, ry: number, zz: number, nz: number): void =>
    quad([cx - rx, cy], [cx, cy - ry], [cx + rx, cy], [cx, cy + ry], zz, nz);
  // 博风板：沿斜边 A→B 朝三角内法线 (nx,ny) 偏 bw；檐角内缘 y 钳到 0，不穿出底边。
  const barge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number, zz: number, nz: number): void =>
    quad([ax, ay], [bx, by], [bx + nx * bw, Math.max(0, by + ny * bw)], [ax + nx * bw, Math.max(0, ay + ny * bw)], zz, nz);
  // 团花 / 透气孔：6 段三角扇。
  const rosette = (cx: number, cy: number, r: number, zz: number, nz: number): void => {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      tri([cx, cy], [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], zz, nz);
    }
  };
  for (const s of [1, -1] as const) {
    const zz = s * off, nz = s;
    // 两条博风板：右斜边内法线 (-rise,-halfW)/L，左斜边内法线 (rise,-halfW)/L。
    barge(halfW, 0, 0, rise, -rise / L, -halfW / L, zz, nz);
    barge(-halfW, 0, 0, rise, rise / L, -halfW / L, zz, nz);
    // 悬鱼：脊点下方 rise*0.83 的小菱形吊饰。
    diamond(0, rise * 0.83, 0.06 * m, 0.085 * m, zz, nz);
    // 直棂山花格：中下部 4 根竖棂 + 2 根横枋，留出粉刷面不铺满。
    const yLo = rise * 0.12, yHi = rise * 0.5, cyMid = (yLo + yHi) / 2, hBar = (yHi - yLo) / 2;
    const sw = 0.03 * m;
    for (let i = 0; i < 4; i++) bar((-0.3 + 0.2 * i) * halfW, cyMid, sw, hBar, zz, nz);
    const fh = 0.028 * m, fx = 0.34 * halfW;
    bar(0, rise * 0.16, fx, fh, zz, nz);
    bar(0, rise * 0.46, fx, fh, zz, nz);
    // 悬鱼上方一个小圆团花 / 透气孔。
    rosette(0, rise * 0.66, 0.045 * m, zz, nz);
  }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  dgeo.setAttribute('normal', new THREE.Float32BufferAttribute(dnor, 3));
  dgeo.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  b.addGeo('wood', dgeo, x, y, z, 0x3a2a20, ry, 0, 0);
}


/** 按坐标挑业态与形态：同一街区不会整排同一种店 */
export function pickTrade(x: number, z: number): { trade: ShopTrade; variant: number } {
  const t = r16hash(x * 0.0021 + z * 0.0137, 977);
  const trade = SHOP_TRADES[Math.min(SHOP_TRADES.length - 1, (t * SHOP_TRADES.length) | 0)];
  const variant = Math.min(2, (r16hash(z * 0.031 + x * 0.017, 311) * 3) | 0);
  return { trade, variant };
}

export interface TradeRoomSpec {
  /** 房间中心（世界） */
  cx: number; cz: number;
  /** 室内净空：面阔（u）/ 进深（v） */
  w: number; d: number;
  /** 地坪上皮 y */
  y0: number;
  /** 净高 */
  h: number;
  trade: ShopTrade;
  variant: number;
  /** local +u（面阔）的世界方向，单位轴向量 */
  ux: number; uz: number;
  /** local +v（由门指向店内）的世界方向，单位轴向量 */
  vx: number; vz: number;
  /** 是否铺吊顶：roofC 屋盖下方必须铺，双坡板顶的下皮本身可见 */
  ceiling?: boolean;
  // 简装：桌/架/摞这类多构件形制塌成单盒（外围铺面用，省 60% 面数）
  compact?: boolean;
  /** 室内地坪面层：木 / 方砖 / 石板（缺省按业态取） */
  floor?: 'wood' | 'brick' | 'stone';
  /** 只落前 N 件（缺省全落） */
  maxItems?: number;
  /**
   * 来源标识（R24 台账用）：'imperialFront' / 'imperialBack' / 'autoPlot' 等。
   * 生成侧按此键打 `shopint.src.<src>.all`，本函数打 `shopint.src.<src>.stocked`，
   * 主进程即可按来源断言「全部店铺数 = 带行业经营用品店铺数」。不传则不记分项。
   */
  src?: string;
}

interface Put {
  box: (g: BGroup, w: number, h: number, d: number, u: number, y: number, v: number, hex: number) => void;
  cyl: (g: BGroup, rt: number, rb: number, h: number, seg: number, u: number, y: number, v: number, hex: number) => void;
}

// ---------- 室内陈设审计（纯记账，不产生几何） ----------
// 判据「每间 ≥12 件、同类店差异 ≥20%、最大空白地面矩形 < 房间短边 45%」不能靠肉眼数，
// 这里把每件器物的**平面脚印**记下来，测试与探针直接读。默认关闭，只在审计时开，
// 2900 间全量跑一次约 24k 条记录，正常游玩零开销。
export interface TradeItemAudit {
  key: string; name: string;
  x: number; z: number;
  /** 器物顶面世界高度（挂件记挂点） */
  top: number;
  /** 平面半宽（x / z） */
  hx: number; hz: number;
  /** 贴墙挂件（不占地） */
  wall: boolean;
}

export interface TradeRoomAudit {
  cx: number; cz: number;
  /** 室内净空 */
  w: number; d: number;
  y0: number; h: number;
  trade: ShopTrade; variant: number; compact: boolean;
  items: TradeItemAudit[];
  /** 几何片数（一件桌 = 面 + 腿 = 2 片）：用来估面数预算 */
  pieces: number;
}

let TRADE_AUDIT: TradeRoomAudit[] | null = null;

/** 开始记录后续每一次 buildTradeInterior 的落位 */
export function beginTradeInteriorAudit(): void { TRADE_AUDIT = []; }

/** 结束记录并取走结果 */
export function endTradeInteriorAudit(): TradeRoomAudit[] {
  const out = TRADE_AUDIT ?? [];
  TRADE_AUDIT = null;
  return out;
}

/**
 * 单间铺面室内：吊顶 + 按业态摆 16 件器物。
 * 不建地坪（台基顶面即地坪），不建墙（外墙由调用方做成薄壁 + 门洞）。
 * 返回落位件数，供调用方打 kit 台账。
 */
export function buildTradeInterior(b: Baker, s: TradeRoomSpec): number {
  // R24 台账：每间铺面恰好调用本函数一次 → shopint.shopAll 即「全部店铺数」的真实计数
  // （centralbelt 临街/后巷、riverbank、宫前/宫后商业街、buildings 自动地块全部经此入口）。
  b.kit('shopint.shopAll', 1, s.y0);
  const halfU = s.w / 2;
  const halfV = s.d / 2;
  const F = s.y0;
  const ax = Math.abs(s.ux), az = Math.abs(s.uz);
  const bx = Math.abs(s.vx), bz = Math.abs(s.vz);
  const put: Put = {
    box: (g, w, h, d, u, y, v, hex) => {
      b.box(g, w * ax + d * bx, h, w * az + d * bz, s.cx + s.ux * u + s.vx * v, y, s.cz + s.uz * u + s.vz * v, hex);
    },
    cyl: (g, rt, rb, h, seg, u, y, v, hex) => {
      b.cyl(g, rt, rb, h, seg, s.cx + s.ux * u + s.vx * v, y, s.cz + s.uz * u + s.vz * v, hex);
    },
  };

  // 吊顶：椽子看不见的一层望板（只给曲面屋盖的房间）
  if (s.ceiling) {
    put.box('wood', s.w, 0.09, s.d, 0, F + s.h - 0.06, 0, 0x3f2c1c);
    put.box('wood', s.w, 0.18, 0.2, 0, F + s.h - 0.18, 0, 0x5a3f26);
  }

  // 地坪面层：台基顶面是灰扑扑一整片「土」，铺一层木/砖/石面才有室内的读感。
  // 木楼板用 wood 组（自带板纹贴图），砖石才走 ash；再压几道缝，别让 12m 通间读成一整片泥地。
  const floor = s.floor ?? (s.trade === 'teahouse' || s.trade === 'tavern' || s.trade === 'noodle' ? 'wood'
    : s.trade === 'cloth' || s.trade === 'general' ? 'stone' : 'brick');
  if (floor === 'wood') {
    put.box('wood', s.w - 0.02, 0.05, s.d - 0.02, 0, F - 0.018, 0, 0x8a6440);
    for (let i = 1; i <= 4; i++) {
      put.box('wood', s.w - 0.08, 0.012, 0.035, 0, F + 0.009, -halfV + (s.d * i) / 5, 0x5a3f26);
    }
  } else {
    put.box('ash', s.w - 0.02, 0.036, s.d - 0.02, 0, F - 0.012, 0, floor === 'brick' ? 0x6b7076 : 0x8d8a80);
    for (let i = 1; i <= 3; i++) {
      put.box('ash', s.w - 0.08, 0.01, 0.03, 0, F + 0.006, -halfV + (s.d * i) / 4, 0x4a4f55);
      put.box('ash', 0.03, 0.01, s.d - 0.08, -halfU + (s.w * i) / 4, F + 0.006, 0, 0x4a4f55);
    }
  }
  // 踢脚：背墙与两山墙各一道（纯色木，压住墙根与地面的接缝）
  put.box('wood', s.w - 0.04, 0.3, 0.05, 0, F + 0.15, halfV - 0.03, 0x3a2c22);
  for (const su of [-1, 1]) put.box('wood', 0.05, 0.3, s.d - 0.04, su * (halfU - 0.03), F + 0.15, 0, 0x3a2c22);

  const room: TradeRoomAudit | null = TRADE_AUDIT
    ? { cx: s.cx, cz: s.cz, w: s.w, d: s.d, y0: s.y0, h: s.h, trade: s.trade, variant: s.variant, compact: s.compact === true, items: [], pieces: 0 }
    : null;
  if (room && TRADE_AUDIT) TRADE_AUDIT.push(room);
  const rec = (key: string, name: string, u: number, v: number, wu: number, dv: number, top: number, wall: boolean): void => {
    if (!room) return;
    room.items.push({
      key, name, wall, top,
      x: s.cx + s.ux * u + s.vx * v,
      z: s.cz + s.uz * u + s.vz * v,
      hx: (wu * ax + dv * bx) / 2,
      hz: (wu * az + dv * bz) / 2,
    });
  };

  /** 落一件器物：贴墙件自动贴墙、随面阔拉伸、按形制拆件。返回几何片数。 */
  const placeItem = (key: string, u: number, v: number, sc = 1): number => {
    const def = ITEM[key];
    if (!def) return 0;
    // 墙面家具随房间尺度拉伸：12m 通间里 2.4m 的柜台只占 1/5，读不成柜台
    const stretch = def.w >= 1.4 ? Math.min(2.0, Math.max(1, halfU / 4.6)) : 1;
    const w = def.w * sc * stretch, h = def.h * sc, d = def.d * sc;
    // 贴墙件朝向：rot='v' 时长轴转到进深方向
    const along = def.rot === 'v';
    const wu = along ? d : w;
    const dv = along ? w : d;
    const limU = Math.max(0.2, halfU - wu / 2 - 0.16);
    const limV = Math.max(0.2, halfV - dv / 2 - 0.16);
    const pu = Math.max(-limU, Math.min(limU, u));
    const pv = Math.max(-limV, Math.min(limV, v));
    if (def.wall) {
      put.box(def.g, w, h, 0.05, pu, F + s.h * 0.52, pv, def.hex);
      rec(key, def.n, pu, pv, w, 0.05, F + s.h * 0.52 + h / 2, true);
      return 1;
    }
    let pieces = 1;
    switch (def.a) {
      case 'box':
        put.box(def.g, wu, h, dv, pu, F + h / 2, pv, def.hex);
        break;
      case 'cyl':
        put.cyl(def.g, w / 2, (w / 2) * 0.92, h, 5, pu, F + h / 2, pv, def.hex);
        break;
      case 'table':
        if (s.compact) { put.box(def.g, wu, h, dv, pu, F + h / 2, pv, def.hex); break; }
        put.box(def.g, wu, 0.08, dv, pu, F + h - 0.04, pv, def.hex2 ?? shade(def.hex, 1.12));
        put.box(def.g, wu * 0.82, h - 0.08, dv * 0.24, pu, F + (h - 0.08) / 2, pv, def.hex);
        pieces = 2;
        break;
      case 'shelf':
        if (s.compact) { put.box(def.g, wu, h, dv * 0.9, pu, F + h / 2, pv, def.hex); break; }
        put.box(def.g, wu, h, dv * 0.9, pu, F + h / 2, pv, def.hex);
        put.box(def.g, wu * 0.94, 0.06, dv, pu, F + h * 0.52, pv, def.hex2 ?? shade(def.hex, 1.2));
        pieces = 2;
        break;
      case 'frame':
        if (s.compact) { put.box(def.g, wu, h, Math.max(0.12, dv), pu, F + h / 2, pv, def.hex); break; }
        put.box(def.g, 0.09, h, 0.09, pu - wu / 2 + 0.05, F + h / 2, pv, def.hex);
        put.box(def.g, 0.09, h, 0.09, pu + wu / 2 - 0.05, F + h / 2, pv, def.hex);
        put.box(def.g, wu, 0.09, 0.09, pu, F + h - 0.05, pv, def.hex);
        pieces = 3;
        break;
      case 'stack':
        if (s.compact) { put.box(def.g, wu, h, dv, pu, F + h / 2, pv, def.hex); break; }
        put.box(def.g, wu * 0.4, h, dv, pu - wu * 0.28, F + h / 2, pv, def.hex);
        put.box(def.g, wu * 0.4, h * 0.86, dv, pu, F + h * 0.43, pv, def.hex2 ?? shade(def.hex, 0.9));
        put.box(def.g, wu * 0.4, h * 0.7, dv, pu + wu * 0.28, F + h * 0.35, pv, def.hex);
        pieces = 3;
        break;
    }
    rec(key, def.n, pu, pv, wu, dv, F + h, false);
    return pieces;
  };

  // —— 舱位陈设：面阔分舱 × 进深分行 ——
  // 旧版把固定坐标的 16 行压在一间屋里，且 maxItems 数的是**几何片数**（一件桌 = 2 片），
  // 于是「16 件」实际只落 5–9 件，14m 通间也只在中间摆一套桌椅——这正是用户截图里的「空」。
  // 新版先铺骨架（后墙高柜 / 中部桌案 / 近门柜台），再补座具与小件，最后挂墙面装饰。
  const live = TRADE_KIT[s.trade].filter((r) => r[3] === 0 || (r[3] & (1 << (s.variant & 3))) !== 0);
  const pool = (role: ItemRole): string[] => {
    const out: string[] = [];
    for (const r of live) if (roleOf(r[0]) === role && !out.includes(r[0])) out.push(r[0]);
    return out;
  };
  const backP = pool('back'), midP = pool('mid'), seatP = pool('seat');
  const smallP = pool('small'), frontP = pool('front'), wallP = pool('wall');
  const take = (arr: string[], i: number): string | null => (arr.length ? arr[((i % arr.length) + arr.length) % arr.length] : null);
  const dining = s.trade === 'teahouse' || s.trade === 'tavern' || s.trade === 'noodle';

  const bays = Math.max(3, Math.min(5, Math.round(s.w / 3.4)));
  const bayW = s.w / bays;
  const vBack = halfV - 0.5;
  const vFront = -halfV + 0.95;
  const midRows = (() => {
    const half = s.d / 2;
    const span = Math.max(1.2, (half - 1.15) - (-half + 1.25));
    const gapMax = Math.max(2.2, Math.min(s.w, s.d) * 0.45);
    return Math.max(1, Math.min(5, Math.min(Math.ceil(span / gapMax) + 1, Math.floor(span / 2.6) + 1)));
  })();
  const midV = (r: number): number => {
    if (midRows === 1) return 0;
    const lo = vFront + 1.25, hi = vBack - 1.15;
    return lo + (hi - lo) * (r / (midRows - 1));
  };
  let count = 0;
  let pieces = 0;

  // ① 后墙整排高柜（货架 / 药柜 / 立柜 / 布架 / 屏风）
  for (let k = 0; k < bays; k++) {
    const backK = take(backP, k * 2 + (s.variant & 1));
    if (backK) { pieces += placeItem(backK, -halfU + (k + 0.5) * bayW, vBack); count++; }
  }
  // ② 中部骨架：餐茶酒按桌；其余隔舱一件桌案、一舱一件货
  const tables: { u: number; v: number }[] = [];
  for (let r = 0; r < midRows; r++) {
    const v = midV(r);
    for (let k = 0; k < bays; k++) {
      const u = -halfU + (k + 0.5) * bayW;
      // 门在 u=0：最靠门的那一排让出 1.3m 进门通道，别一开门就撞在桌角上
      if (r === 0 && Math.abs(u) < 1.3) continue;
      // 逐舱微差：尺寸 ±8%、进深 ±0.12m，避免整间读成一张等距网格
      const jit = 0.92 + ((k * 7 + r * 11) % 5) * 0.04;
      const vj = v + ((k % 3) - 1) * 0.12;
      if (dining) {
        const midK = take(midP, k + r * 2);
        if (!midK) continue;
        pieces += placeItem(midK, u, vj, jit); count++;
        if (SEATS_WITH.has(midK)) tables.push({ u, v: vj });
      } else if ((k + r) % 2 === 0) {
        const midK = take(midP, k + r);
        if (midK) { pieces += placeItem(midK, u, vj, jit); count++; }
      } else {
        const smallK = take(smallP, k * 3 + r);
        if (smallK) { pieces += placeItem(smallK, u, vj, jit); count++; }
      }
    }
  }
  // ③ 座具：每张桌两侧各一（有座具池才配）
  if (seatP.length) {
    for (let i = 0; i < tables.length; i++) {
      const seatK = take(seatP, i);
      if (!seatK) break;
      pieces += placeItem(seatK, tables[i].u - 0.74, tables[i].v + 0.04); count++;
      pieces += placeItem(seatK, tables[i].u + 0.74, tables[i].v + 0.04); count++;
    }
  }
  // ④ 近门柜台（门在 u=0，让开门板位置）
  for (let k = 0; k < bays; k += 2) {
    const u = -halfU + (k + 0.5) * bayW;
    if (Math.abs(u) < 1.1) continue;
    const frontK = take(frontP, k);
    if (frontK) { pieces += placeItem(frontK, u, vFront); count++; }
  }
  // ⑤ 小件补空：两侧山墙各一摞货
  for (let k = 0; k < bays; k++) {
    const smallK = take(smallP, k * 2 + 1);
    if (!smallK) break;
    const u = -halfU + (k + 0.5) * bayW;
    pieces += placeItem(smallK, u + bayW * 0.22, vBack - 0.75); count++;
  }
  // 墙面：背墙挂画两幅 + 门内一盏灯（不占地）
  const wallK = wallP.length ? wallP[0] : 'scroll';
  if (halfU > 2.2) { pieces += placeItem(wallK, -halfU * 0.55, vBack); count++; }
  if (halfU > 3.4) { pieces += placeItem(wallK, halfU * 0.55, vBack); count++; }
  pieces += placeItem('lantern', 0, -halfV + 1.9, 1); count++;

  // —— R17 起居资产叠加层（2026-11-07）——
  // R16 铺的是营生器物，这层补「谁住在这里」：家具 / 物品 / 生活 / 洗漱 / 起居 / 装饰六类。
  // 档次由面阔 + 业态 + 坐标 hash 推出，组合也只走坐标 hash（不消耗共享 RNG）；
  // 所有器件贴墙贴角，挂件不落地，因此 R16 的「最大空白矩形」判据只会更满、不会变差。
  const living = buildRoomLiving(b, {
    cx: s.cx, cz: s.cz, w: s.w, d: s.d, y0: F, h: s.h,
    ux: s.ux, uz: s.uz, vx: s.vx, vz: s.vz,
    variant: s.variant, compact: s.compact === true, trade: s.trade,
    record: (key, name, u, v, wu, dv, top, wall) => rec(key, name, u, v, wu, dv, top, wall),
  });
  pieces += living.pieces;
  if (room) room.pieces = pieces;
  // R24 台账（真实计数、不硬编码，运行期可读于 world.assetAudit.detail）：
  //   · shopint.shopStocked —— 带行业经营用品的店铺数：本业态 TRADE_KIT 实际落了 ≥1 件经营器物。
  //     与 shopint.shopAll 相等即证明「全城所有店铺都有对应业态经营用品」。
  //   · shopint.src.<src>.stocked —— 按来源分项（生成侧另有 .all），可按来源逐一断言覆盖。
  //   · shopint.stockItems —— 全城累计落位经营器件数（件数深度）。
  if (count > 0) {
    b.kit('shopint.shopStocked', 1, F);
    if (s.src) b.kit(`shopint.src.${s.src}.stocked`, 1, F);
  }
  b.kit('shopint.stockItems', count, F);
  b.kit(`shopint.${s.trade}.shop`, 1);
  b.kit(`shopint.${s.trade}.items`, count);
  b.kit(`shopint.variant${s.variant}`, 1);
  return count;
}
