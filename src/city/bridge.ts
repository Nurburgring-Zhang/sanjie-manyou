import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import { C } from './buildings';
import {
  BRIDGE_HALF, bridgeDeckY, MAIN_BRIDGES, bridgeHalfSpan, bridgeProfileY,
  BRIDGE_END_Y, type BridgeSpec,
} from './layout';
import { riverCenterZ, riverHalfWidth, RIVER_WATER_Y } from './river';

// ============ 虹桥：贯木拱桥全复刻 ============
export function buildBridge(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const N = 26;
  const W = 10.4;
  // 桥面板（阶梯式密铺，随拱肋起伏）
  for (let i = 0; i < N; i++) {
    const z0 = -BRIDGE_HALF + (BRIDGE_HALF * 2 * i) / N;
    const z1 = -BRIDGE_HALF + (BRIDGE_HALF * 2 * (i + 1)) / N;
    const zm = (z0 + z1) / 2;
    const y = bridgeDeckY(zm);
    const len = z1 - z0;
    b.box('wood', W, 0.3, len * 1.6, 0, y, zm, shade(0x7a5230, 0.92 + 0.14 * (i % 2)), 0, 0, 0);
  }
  // 贯木拱肋（三道纵向弧梁 × 双层）
  for (const lane of [-4.1, -3.1, 0, 3.1, 4.1]) {
    let pz = -BRIDGE_HALF, py = bridgeDeckY(-BRIDGE_HALF) - 1.05;
    for (let z = -BRIDGE_HALF + 6; z <= BRIDGE_HALF + 0.1; z += 6) {
      const y = bridgeDeckY(Math.min(z, BRIDGE_HALF)) - 1.05 - Math.sin((Math.min(z, BRIDGE_HALF) / BRIDGE_HALF) * Math.PI / 2) * 0 + 0;
      const dz = z - pz, dy = y - py;
      const len = Math.hypot(dz, dy);
      const midZ = (z + pz) / 2, midY = (y + py) / 2;
      b.box('wood', 0.62, 0.72, len * 1.06, lane, midY, midZ, shade(0x5e3e22, 0.9 + 0.2 * ((lane + 5) % 2)), 0, -Math.atan2(dy, dz), 0);
      pz = z; py = y;
    }
  }
  // 桥面横枋
  for (let z = -BRIDGE_HALF + 4; z < BRIDGE_HALF; z += 6) {
    b.box('wood', W + 0.5, 0.22, 0.4, 0, bridgeDeckY(z) + 0.26, z, 0x6a4526);
  }
  // 栏杆 + 霓虹沿口
  for (const side of [-1, 1]) {
    const x = side * (W / 2 - 0.15);
    let pz = -BRIDGE_HALF, py = bridgeDeckY(-BRIDGE_HALF) + 1.15;
    for (let z = -BRIDGE_HALF + 4.8; z <= BRIDGE_HALF + 0.1; z += 4.8) {
      const y = bridgeDeckY(Math.min(z, BRIDGE_HALF)) + 1.15;
      b.box('wood', 0.14, 0.1, Math.hypot(z - pz, y - py) * 1.08, x, (y + py) / 2, (z + pz) / 2, 0x8a3324, 0, -Math.atan2(y - py, z - pz), 0);
      b.box('wood', 0.14, 0.1, Math.hypot(z - pz, y - py) * 1.08, x, (y + py) / 2 - 0.5, (z + pz) / 2, 0x8a3324, 0, -Math.atan2(y - py, z - pz), 0);
      b.box('glow', 0.07, 0.07, Math.hypot(z - pz, y - py) * 1.08, x + side * 0.12, (y + py) / 2 + 0.62, (z + pz) / 2, shade(side > 0 ? C.neonCyan : C.neonMag, 0.55), 0, -Math.atan2(y - py, z - pz), 0);
      // 望柱
      b.box('wood', 0.2, 1.15, 0.2, x, bridgeDeckY(z) + 0.62, z, 0x8a3324);
      b.box('glow', 0.24, 0.1, 0.24, x, bridgeDeckY(z) + 1.26, z, z % 9.6 < 4.8 ? C.neonGold : C.neonCyan);
      pz = z; py = y;
    }
  }
  // 桥头华表 × 4
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 7.2, z = sz * (BRIDGE_HALF + 2.5);
    b.cyl('wood', 0.22, 0.3, 6.4, 8, x, 3.2, z, 0x8a3324);
    b.box('wood', 1.3, 0.18, 0.18, x, 5.6, z, 0x8a3324);
    b.box('glow', 0.5, 0.5, 0.5, x, 6.7, z, sz > 0 ? C.neonMag : C.neonCyan, 0, 0, Math.PI / 4);
    b.cyl('wall', 0.7, 0.85, 0.5, 8, x, 0.25, z, shade(C.stone, 1));
  }
  // ---- 桥面摊棚：四座食棚（两两分列桥两端，中间留出过桥通道） ----
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const z = sz * (BRIDGE_HALF - 7.5);
      const x = sx * 3.3;
      const dy = bridgeDeckY(z);
      b.box('wood', 2.4, 0.1, 1.6, x, dy + 0.85, z, shade(C.wood, 0.98));
      for (const ox of [-1.05, 1.05]) {
        b.box('wood', 0.1, 0.84, 0.1, x + ox, dy + 0.42, z + 0.65, C.woodDark);
        b.box('wood', 0.1, 0.84, 0.1, x + ox, dy + 0.42, z - 0.65, C.woodDark);
      }
      // 布棚
      for (const oz of [-1, 1]) {
        b.box('fabric', 2.8, 0.07, 1.5, x, dy + 2.35, z + oz * 0.45, sz * sx > 0 ? 0x9d2933 : 0x2a5c42, 0, oz * 0.24, 0);
      }
      b.box('wood', 2.9, 0.12, 0.12, x, dy + 2.62, z, C.woodDark);
      for (const ox of [-1.3, 1.3]) b.cyl('wood', 0.06, 0.08, 2.6, 5, x + ox, dy + 1.3, z - 0.9, C.woodDark);
      // 台面器物
      for (let k = 0; k < 3; k++) b.cyl('ceramic', 0.14, 0.1, 0.1, 8, x - 0.7 + k * 0.7, dy + 0.95, z + 0.1, 0x8a7a6a);
      b.cyl('glow', 0.16, 0.12, 0.05, 8, x + 0.2, dy + 0.98, z - 0.2, 0xff9a3c);
      b.box('glow', 0.26, 0.34, 0.26, x + 1.3, dy + 2.1, z - 0.9, C.lantern);
      b.box('wood', 0.04, 0.5, 0.04, x + 1.3, dy + 2.4, z - 0.9, C.woodDark);
      // 桌凳：棚下两张条凳（器件工厂）
      b.box('wood', 1.4, 0.08, 0.34, x, dy + 0.5, z + 1.15, C.wood);
      for (const ox of [-0.55, 0.55]) b.box('wood', 0.08, 0.46, 0.08, x + ox, dy + 0.23, z + 1.15, C.woodDark);
      b.kit('bridge.stall', 1);
    }
  }
  // 桥名匾（两侧）
  for (const sz of [-1, 1]) {
    sg.quad(atlas.text('bridgename' + sz, '虹橋', 220, 80, {
      color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(10,8,14,0.85)', border: 'rgba(255,179,0,.9)', fontPx: 56,
    }), 4.6, 1.7, sz * 5.6, bridgeDeckY(sz * 44) + 3.6, sz * 44, 0);
  }
  // ---- WS-32 桥面石作 5 件（全部按既有桥面几何取高度，不新增任何构建入口）----
  bridgeCrownPad(b);        // C-ITM-0068 桥心垫石
  bridgeImperialApron(b);   // C-ITM-0074 桥心青石（御道衔接段）
  bridgeArchBands(b);       // C-ITM-0070 木楔铁箍
  bridgeStoneArch(b);       // C-ITM-0071 石拱券
  bridgeSeaHorseRail(b);    // C-ITM-0072 海马瑞兽石栏
  // ---- R-BRIDGE：主河段其余 7 座桥（石拱/叠梁拱/廊桥/浮桥/木梁）----
  buildMainCrossings(b, sg, atlas);
}

// ============ 桥面石作（WS-32）：垫石 / 御道衔接青石 / 木楔铁箍 / 石拱券 / 海马瑞兽石栏 ============
/** 既有踏步板顶面：板厚 0.3、板心落在 bridgeDeckY 上 */
function deckTopAt(z: number): number {
  return bridgeDeckY(z) + 0.15;
}

/**
 * C-ITM-0068 桥心垫石：桥心青石车辙垫板（双辙槽深 15mm）。
 * 落拱顶 z=0 的踏步上，板底压进木桥面 8mm、板面高出 63mm；辙槽沉入板面，辙唇磨亮。
 */
export function bridgeCrownPad(b: Baker): void {
  const z = 0;
  const y = bridgeDeckY(z) + 0.18;      // 板心（板厚 0.1 → 板底 9.23，压进踏步板顶 9.2376）
  const w = 4.6, d = 3.4;
  b.box('ash', w - 1.1, 0.1, d, 0, y, z, shade(C.stone, 1.07));
  for (const sx of [-1, 1]) {
    b.box('ash', 0.5, 0.08, d + 0.12, sx * (w / 2 - 0.28), y - 0.012, z, shade(C.stone, 0.93));
    b.box('ash', 0.3, 0.13, d + 0.26, sx * (w / 2 - 0.02), y - 0.004, z, shade(C.stone, 0.85));
  }
  for (const sz of [-1, 1]) b.box('ash', w + 0.24, 0.1, 0.34, 0, y - 0.012, z + sz * (d / 2 + 0.14), shade(C.stone, 0.9));
  // 双辙槽：槽底沉 15mm，两侧留磨亮的辙唇
  for (const sx of [-0.82, 0.82]) {
    b.box('ash', 0.15, 0.04, d - 0.4, sx, y + 0.032, z, shade(C.stone, 0.55));
    b.box('ash', 0.05, 0.03, d - 0.4, sx - 0.1, y + 0.058, z, shade(C.stone, 1.26));
    b.box('ash', 0.05, 0.03, d - 0.4, sx + 0.1, y + 0.058, z, shade(C.stone, 1.26));
  }
  b.kit('bridge.crownPad', 1, y);
}

/**
 * C-ITM-0074 桥心青石：御道与桥面的衔接段（车辙双槽深 25mm，比桥心垫石浅一级）。
 * 既有末级踏步板心在 z=±46.15、板长 5.91（端面达 ±49.1）、台面 1.483，桥脚离地 0.85m；
 * 三级青石踏步把这段空白填到街面，御道由此上桥。两端各一铺。
 */
export function bridgeImperialApron(b: Baker): void {
  const deckEnd = deckTopAt(46.15);
  const stepTop = [deckEnd - 0.37, deckEnd - 0.74, deckEnd - 1.11];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const zc = 48.9 + i * 1.25 + 0.625;
      const top = stepTop[i];
      const h = top + 0.1;
      // 每级三块错缝青石
      for (let k = 0; k < 3; k++) {
        b.box('ash', 5.2 / 3 - 0.06, h, 1.25, (k - 1) * (5.2 / 3), top - h / 2, s * (zc + (k % 2 ? 0.05 : -0.05)), shade(C.stone, 0.93 + k * 0.06));
      }
      // 两侧牙石比踏面高出 0.12
      for (const sx of [-1, 1]) b.box('ash', 0.34, h + 0.12, 1.31, sx * 2.72, top - h / 2 + 0.06, s * zc, shade(C.stone, 0.84));
      // 车辙双槽 25mm
      for (const sx of [-0.82, 0.82]) b.box('ash', 0.16, 0.035, 1.1, sx, top - 0.012, s * zc, shade(C.stone, 0.55));
    }
    // 街面散水（与正街石板同高）
    b.box('ash', 5.7, 0.14, 1.9, 0, 0.07, s * 53.6, shade(C.stone, 0.96));
    for (const sx of [-0.82, 0.82]) b.box('ash', 0.16, 0.03, 1.7, sx, 0.128, s * 53.6, shade(C.stone, 0.55));
    b.kit('bridge.imperialApron', 1, deckEnd);
  }
}

/**
 * C-ITM-0070 木楔铁箍：贯木拱肋相贯节点的加固件（上下一对木楔 + 双道铁箍 + 四枚铆钉）。
 * 取外道与中道拱肋（x=−4.1 / 0 / +4.1），沿 z 每 12m 一组，共 24 组；箍随肋的切线倾斜。
 */
export function bridgeArchBands(b: Baker): void {
  for (const lane of [-4.1, 0, 4.1]) {
    for (let z = -42; z <= 42; z += 12) {
      const s = (bridgeDeckY(z + 6) - bridgeDeckY(z - 6)) / 12;
      const rx = -Math.atan2(s, 1);
      const ca = Math.cos(rx), sa = Math.sin(rx);
      const y0 = bridgeDeckY(z) - 1.05;
      const at = (dy: number, dz: number): [number, number, number] => [lane, y0 + dy * ca - dz * sa, z + dy * sa + dz * ca];
      // 两道铁箍（箍带比肋大 0.08~0.12）
      for (const dz of [-0.13, 0.13]) {
        const [bx, by, bz] = at(0, dz);
        b.box('metal', 0.78, 0.86, 0.18, bx, by, bz, dz < 0 ? 0x4a4e54 : shade(0x4a4e54, 0.86), 0, rx, 0);
      }
      // 箍周锈晕环（20mm）
      const [nx, ny, nz] = at(0, 0);
      b.box('metal', 0.84, 0.92, 0.06, nx, ny, nz, 0x6a4526, 0, rx, 0);
      // 上下一对木楔，45° 打入
      for (const dy of [-0.3, 0.3]) {
        const [wx, wy, wz] = at(dy, 0);
        b.box('wood', 0.34, 0.24, 0.26, wx, wy, wz, 0x7a5230, 0, rx, 0.78);
      }
      // 铆钉四枚，露在箍面
      for (const dx of [-0.32, 0.32]) for (const dy of [-0.3, 0.3]) {
        const [qx, qy, qz] = at(dy, -0.235);
        b.box('metal', 0.08, 0.08, 0.05, qx + dx, qy, qz, 0x9aa0a8, 0, rx, 0);
      }
      b.kit('bridge.wedgeBand', 1, y0);
    }
  }
}

/**
 * C-ITM-0071 石拱券：桥两端的拱脚券（拱下圈石）+ 桥台。
 * 拱脚线取拱肋底的包络 bridgeDeckY−1.45，桥台自地面砌到该线，券脸石沿曲线外包两皮；
 * |z|>44 处肋已近地，收成 1.16 高的承台托住末级踏步。贯木拱由此落脚，不再凭空落地。
 */
export function bridgeStoneArch(b: Baker): void {
  const W = 10.4;
  const spring = (z: number): number => (Math.abs(z) <= 44 ? Math.max(0.55, bridgeDeckY(z) - 1.45) : 1.16);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 10; k++) {
      const zc = 37.6 + k * 1.22;
      const top = spring(zc);
      // 两皮错缝条石：下皮小、上皮大，压顶石外挑 0.1
      b.box('ash', W - 0.26, top * 0.6 + 0.02, 1.1, 0, top * 0.3, s * zc, shade(C.stone, 0.88));
      b.box('ash', W - 0.1, top * 0.44 + 0.02, 1.1, 0, top * 0.78, s * zc, shade(C.stone, 0.96));
      b.box('ash', W + 0.2, 0.16, 1.06, 0, top + 0.02, s * zc, shade(C.stone, 1.12));
    }
    // 券脸石：两外脸各一铺六块，沿拱脚曲线出挑 0.07（南端镜像，倾角随 s 取反）
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const zc = 38.05 + k * 1.0;
        const yA = spring(zc - 0.5), yB = spring(zc + 0.5);
        const ang = -Math.atan2(yB - yA, 1.0) * s;
        b.box('ash', 0.3, 0.66, Math.hypot(yB - yA, 1.0) * 0.94, sx * (W / 2 + 0.07), (yA + yB) / 2 - 0.1, s * zc, shade(C.stone, 1.02 + (k % 2) * 0.07), 0, ang, 0);
      }
    }
  }
  b.kit('bridge.stoneArchRing', 2, 1.3);
}

/**
 * C-ITM-0072 海马瑞兽石栏：桥两侧栏板浮雕（板高 0.9m，海水江崖衬底，兽身外凸 90mm）。
 * 挂既有栏杆外脸 x=±5.26（望柱 4.95~5.15、霓虹沿口 5.135~5.205 之间让开），
 * 随桥面坡度倾斜；每侧四铺，落在望柱间的四跨上（±2.4 / ±7.2 / ±12 / ±16.8）。
 */
export function bridgeSeaHorseRail(b: Baker): void {
  for (const sx of [-1, 1]) {
    for (const zc of [-16.8, -12, -7.2, -2.4, 2.4, 7.2, 12, 16.8]) {
      const slope = (bridgeDeckY(zc + 1.9) - bridgeDeckY(zc - 1.9)) / 3.8;
      const ang = -Math.atan2(slope, 1);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const yc = bridgeDeckY(zc) + 0.49;   // 板心：板高 1.26 → 高出桥面 0.55~0.96、埋进踏步 ≥0.29
      const put = (w: number, h: number, d: number, dx: number, dv: number, du: number, hex: number): void =>
        b.box('ash', w, h, d, sx * (5.26 + dx), yc + dv * ca - du * sa, zc + dv * sa + du * ca, hex, 0, ang, 0);
      // 板身
      put(0.16, 1.26, 4.42, 0, 0, 0, shade(C.stone, 0.98));
      // 上下框 + 两端立边
      put(0.08, 0.14, 4.42, 0.07, 0.55, 0, shade(C.stone, 1.1));
      put(0.08, 0.14, 4.42, 0.07, -0.56, 0, shade(C.stone, 0.9));
      for (const du of [-2.15, 2.15]) put(0.08, 1.16, 0.16, 0.07, 0, du, shade(C.stone, 1.04));
      // 海水江崖立水段：九段浪头压在栏板下缘（P-17 衬底）
      for (let i = 0; i < 9; i++) {
        const du = -1.9 + i * 0.475;
        put(0.06, 0.1 + (i % 3) * 0.05, 0.36, 0.09, -0.1, du, shade(C.stone, 0.86 + (i % 2) * 0.1));
      }
      // 海马：身 / 臀 / 颈 / 头 / 鬃 / 前后腿 / 尾 / 两朵浪
      put(0.12, 0.28, 1.05, 0.1, 0.16, -0.05, shade(C.stone, 1.12));
      put(0.12, 0.3, 0.4, 0.1, 0.22, -0.58, shade(C.stone, 1.08));
      put(0.12, 0.4, 0.24, 0.1, 0.34, 0.5, shade(C.stone, 1.12));
      put(0.12, 0.2, 0.36, 0.1, 0.44, 0.72, shade(C.stone, 1.16));
      put(0.1, 0.26, 0.14, 0.1, 0.38, 0.42, shade(C.stone, 0.92));
      put(0.1, 0.3, 0.13, 0.1, 0.0, 0.46, shade(C.stone, 1.06));
      put(0.1, 0.32, 0.13, 0.1, -0.02, -0.5, shade(C.stone, 1.06));
      put(0.1, 0.3, 0.15, 0.1, 0.3, -0.8, shade(C.stone, 1.04));
      put(0.08, 0.16, 0.22, 0.1, 0.04, 1.1, shade(C.stone, 1.14));
      put(0.08, 0.14, 0.2, 0.1, 0.02, -1.15, shade(C.stone, 1.02));
      b.kit('bridge.seaHorseRail', 1, yc);
    }
  }
}

// ============ R-BRIDGE：主河段桥梁群 ============
// 判词：「河上建立多座桥的问题，你他妈解决了吗？？？」
// 旧账：主河段只有虹桥一座；石拱(−1680)/木梁(+1620)/浮桥(−2480) 都在 1.6km 外，
// 且三座副桥的半跨直接取河半宽 —— 桥面止于水线、两端踏步踩在水里，高空俯视读不出「过河」。
// 现在桥位/半跨/桥面剖面收到 layout.ts 的 MAIN_BRIDGES 一份真源，本文件只负责造形。

export interface BridgeRecord {
  name: string;
  form: string;
  x: number;
  cz: number;
  halfSpan: number;
  span: number;
  wide: number;
  deckCrownY: number;
  /** 拱顶桥面高出水面（m）：水面恒 1.0 */
  crownClearance: number;
  /** 航道带（河半宽−4m）处桥面高出水面（m） */
  channelClearance: number;
}
export const BRIDGE_LEDGER: BridgeRecord[] = [];

/** 浮桥剖面（与 layout.pontoonDeckY 同口径；此处只用于造形，行走高程仍由 layout 提供） */
function pontoonDeckYOf(x: number, dz: number): number {
  const half = bridgeHalfSpan({ name: '', form: '浮桥', x, crown: 3.6, wide: 0 });
  const nav = riverHalfWidth(x) > 26 ? 18 : 6;
  const top = nav > 6 ? 6.2 : 4.6;
  const a = Math.abs(dz);
  if (a <= nav) return top;
  if (a <= nav + 3) return top - ((a - nav) / 3) * (top - 3.6);
  if (a <= 29) return 3.6;
  if (a >= half) return BRIDGE_END_Y;
  return 3.6 - ((a - 29) / (half - 29)) * (3.6 - BRIDGE_END_Y);
}

/** 桥面标高：浮桥走平桥剖面，其余走抛物线拱背 */
function deckYOf(s: BridgeSpec, dz: number): number {
  return s.form === '浮桥' ? pontoonDeckYOf(s.x, dz) : bridgeProfileY(s, dz);
}

function ledgerPush(s: BridgeSpec): void {
  const cz = riverCenterZ(s.x);
  const half = bridgeHalfSpan(s);
  const crownY = s.form === '浮桥' ? pontoonDeckYOf(s.x, 0) : s.crown;
  const hw = riverHalfWidth(s.x);
  const channel = deckYOf(s, Math.min(hw - 4, half * 0.8));
  BRIDGE_LEDGER.push({
    name: s.name,
    form: s.form,
    x: s.x,
    cz: +cz.toFixed(2),
    halfSpan: +half.toFixed(2),
    span: +(half * 2).toFixed(2),
    wide: s.wide,
    deckCrownY: +crownY.toFixed(2),
    crownClearance: +(crownY - RIVER_WATER_Y).toFixed(2),
    channelClearance: +(channel - RIVER_WATER_Y).toFixed(2),
  });
}

/** 桥面板：沿 z 分段随拱背起伏，段间带倾角 */
function deckRun(bk: Baker, s: BridgeSpec, mat: 'ash' | 'wood', cz: number): void {
  const half = bridgeHalfSpan(s);
  const N = 34;
  for (let i = 0; i < N; i++) {
    const z0 = -half + (2 * half * i) / N;
    const z1 = -half + (2 * half * (i + 1)) / N;
    const zm = (z0 + z1) / 2;
    const y0 = deckYOf(s, z0), y1 = deckYOf(s, z1), ym = deckYOf(s, zm);
    const ang = -Math.atan2(y1 - y0, z1 - z0);
    bk.box(mat, s.wide, 0.34, (z1 - z0) * 1.06, s.x, ym - 0.17, cz + zm,
      shade(mat === 'ash' ? C.stone : C.wood, 1 + (i % 3) * 0.018), 0, ang, 0);
    if (i % 4 === 0) {
      bk.box(mat, s.wide - 0.9, 0.05, (z1 - z0) * 0.92, s.x, ym + 0.015, cz + zm, shade(C.stone, 0.9), 0, ang, 0);
    }
  }
}

/** 栏杆：望柱 + 双道横杆 + 外侧霓虹沿口，随桥面坡度逐跨倾斜 */
function railRun(bk: Baker, s: BridgeSpec, cz: number): void {
  const half = bridgeHalfSpan(s);
  for (const sd of [-1, 1]) {
    const px = s.x + sd * (s.wide / 2 - 0.24);
    const n = Math.max(8, Math.round((2 * half) / 4.2));
    let pz = -half + 1.0, py = deckYOf(s, pz) + 1.02;
    for (let k = 0; k <= n; k++) {
      const z = -half + 1.0 + ((2 * half - 2.0) * k) / n;
      const y = deckYOf(s, z) + 1.02;
      bk.box('wood', 0.2, 1.06, 0.2, px, y - 0.53, cz + z, 0x8a3324);
      bk.box('glow', 0.16, 0.1, 0.16, px, y + 0.12, cz + z, k % 2 ? C.neonCyan : C.neonGold);
      if (k > 0) {
        const dz = z - pz, dy = y - py;
        const len = Math.hypot(dz, dy);
        const ang = -Math.atan2(dy, dz);
        bk.box('wood', 0.12, 0.1, len * 1.04, px, (y + py) / 2, cz + (z + pz) / 2, 0x8a3324, 0, ang, 0);
        bk.box('wood', 0.1, 0.08, len * 1.04, px, (y + py) / 2 - 0.36, cz + (z + pz) / 2, 0x7a2a20, 0, ang, 0);
        bk.box('glow', 0.06, 0.06, len * 1.02, s.x + sd * (s.wide / 2 + 0.02), (y + py) / 2 + 0.38, cz + (z + pz) / 2,
          sd > 0 ? C.neonCyan : C.neonMag, 0, ang, 0);
      }
      pz = z; py = y;
    }
  }
}

/** 桥头：桥台 + 两级踏步落到纤道 + 石墩灯 */
function headRun(bk: Baker, s: BridgeSpec, cz: number, mat: 'ash' | 'wood'): void {
  const half = bridgeHalfSpan(s);
  const endY = deckYOf(s, half);
  for (const sd of [-1, 1]) {
    const zA = half - 1.25;
    const top = Math.max(0.5, deckYOf(s, sd > 0 ? zA : -zA) - 0.32);
    bk.box(mat, s.wide + 0.6, top, 2.5, s.x, top / 2, cz + sd * zA, shade(C.stone, 0.9));
    // 两级踏步：0.62 / 0.32 倍桥端高，落在纤道
    for (let k = 0; k < 2; k++) {
      const h = endY * (0.62 - k * 0.3);
      if (h <= 0.05) continue;
      bk.box(mat, s.wide + 0.2, h, 0.74, s.x, h / 2, cz + sd * (half + 0.4 + k * 0.72), shade(C.stone, 0.94 + k * 0.05));
    }
    for (const sx of [-1, 1]) {
      bk.box('ash', 0.52, 1.06, 0.52, s.x + sx * (s.wide / 2 - 0.06), endY + 0.53, cz + sd * (half - 0.15), shade(C.stone, 1.04));
      bk.box('glow', 0.36, 0.14, 0.36, s.x + sx * (s.wide / 2 - 0.06), endY + 1.14, cz + sd * (half - 0.15), sd > 0 ? C.neonMag : C.neonCyan);
    }
  }
}

/** 桥名匾：桥两端各一（面朝 ±z），双面可读 */
function plaqueRun(sg: SignMesher, atlas: SignAtlas, s: BridgeSpec, cz: number): void {
  const half = bridgeHalfSpan(s);
  const key = 'bridge_name_' + s.x;
  for (const sd of [-1, 1]) {
    const y = deckYOf(s, sd * (half - 2.0)) + 2.45;
    sg.quad(atlas.text(key + sd, s.name, 220, 76, {
      color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(10,8,14,0.85)', border: 'rgba(255,179,0,.9)', fontPx: 54,
    }), 3.4, 1.15, s.x, y, cz + sd * (half - 1.6), 0);
  }
}

/**
 * 石拱桥：一孔（拱辰橋）或三孔（永寧橋）。
 * 拱腹墙按 2m 切片从拱线砌到桥面板底 —— 侧面读出的是曲面 intrados，不是一块方板。
 */
function stoneArchCrossing(bk: Baker, s: BridgeSpec, sg: SignMesher, atlas: SignAtlas): void {
  const cz = riverCenterZ(s.x);
  const hw = riverHalfWidth(s.x);
  const half = bridgeHalfSpan(s);
  const W = s.wide;
  const three = s.name === '永寧橋';
  const arcs = three
    ? [
      { c: 0, half: Math.min(9.2, hw * 0.4), spring: RIVER_WATER_Y + 0.5, rise: 4.7 },
      { c: -hw * 0.68, half: Math.min(4.8, hw * 0.22), spring: RIVER_WATER_Y + 0.35, rise: 3.0 },
      { c: hw * 0.68, half: Math.min(4.8, hw * 0.22), spring: RIVER_WATER_Y + 0.35, rise: 3.0 },
    ]
    : [{ c: 0, half: hw - 1.4, spring: RIVER_WATER_Y + 0.5, rise: 5.0 }];
  const archTop = (dz: number): number => {
    let y = 0.25;
    for (const g of arcs) {
      const t = (dz - g.c) / g.half;
      if (Math.abs(t) < 1) y = Math.max(y, g.spring + g.rise * Math.sqrt(1 - t * t));
    }
    return y;
  };
  for (let z0 = -half; z0 < half - 0.01; z0 += 2) {
    const zm = z0 + 1;
    if (Math.abs(zm) > half - 0.4) continue;
    const top = deckYOf(s, zm) - 0.34;
    const bot = archTop(zm);
    if (top - bot < 0.08) continue;
    for (const sx of [-1, 1]) {
      bk.box('ash', 0.64, top - bot, 2.04, s.x + sx * (W / 2 - 0.32), (top + bot) / 2, cz + zm,
        shade(C.stone, 0.95 + (Math.abs(Math.round(zm)) % 3) * 0.02));
    }
  }
  // 拱券脸石：沿椭圆拱线逐块倾斜，两外脸各一铺；拱顶龙门石
  for (const g of arcs) {
    const N = Math.max(9, Math.round(g.half * 1.4));
    for (let k = 0; k < N; k++) {
      const a0 = (Math.PI * k) / N, a1 = (Math.PI * (k + 1)) / N;
      const dz0 = g.c + g.half * Math.cos(a0), dz1 = g.c + g.half * Math.cos(a1);
      const y0 = g.spring + g.rise * Math.sin(a0), y1 = g.spring + g.rise * Math.sin(a1);
      const ang = -Math.atan2(y1 - y0, dz1 - dz0);
      const len = Math.hypot(dz1 - dz0, y1 - y0) * 1.12;
      for (const sx of [-1, 1]) {
        bk.box('ash', 0.36, 0.7, len, s.x + sx * (W / 2 + 0.04), (y0 + y1) / 2 + 0.06, cz + (dz0 + dz1) / 2,
          shade(C.stone, 1.04 + (k % 2) * 0.06), 0, ang, 0);
      }
    }
    bk.box('ash', 0.42, 0.86, 0.72, s.x, g.spring + g.rise + 0.12, cz + g.c, shade(C.stone, 1.18));
  }
  deckRun(bk, s, 'ash', cz);
  railRun(bk, s, cz);
  headRun(bk, s, cz, 'ash');
  plaqueRun(sg, atlas, s, cz);
  bk.kit('bridge.main.stoneArch', 1, s.crown);
  bk.kit('bridge.crossing', 1, s.crown);
}

/** 叠梁拱：六层直木梁逐层内收、每层两根斜梁在桥心交会，形成折线拱 */
function stackedCrossing(bk: Baker, s: BridgeSpec, sg: SignMesher, atlas: SignAtlas): void {
  const cz = riverCenterZ(s.x);
  const hw = riverHalfWidth(s.x);
  const W = s.wide;
  const lanes = [-W * 0.38, -W * 0.19, 0, W * 0.19, W * 0.38];
  const layers = 6;
  const yBase = RIVER_WATER_Y + 1.15;
  const yTop = s.crown - 1.9;
  const beam = (x: number, z0: number, y0: number, z1: number, y1: number, w: number, hgt: number, hex: number): void => {
    const dz = z1 - z0, dy = y1 - y0;
    const len = Math.hypot(dz, dy);
    bk.box('wood', w, hgt, len * 1.05, x, (y0 + y1) / 2, cz + (z0 + z1) / 2, hex, 0, -Math.atan2(dy, dz), 0);
  };
  for (let k = 0; k < layers; k++) {
    const t = k / (layers - 1);
    const y = yBase + (yTop - yBase) * t;
    const hl = (hw + 2.0) * (1 - 0.105 * t);
    const rise = 2.2 - 0.22 * k;
    for (const lane of lanes) {
      beam(s.x + lane, -hl, y - rise, 0, y, 0.5, 0.46, shade(0x6a4526, 0.93 + 0.05 * k));
      beam(s.x + lane, 0, y, hl, y - rise, 0.5, 0.46, shade(0x6a4526, 0.93 + 0.05 * k));
      // 梁端立柱：把上一层压在下一层的端头上
      for (const sd of [-1, 1]) {
        bk.box('wood', 0.28, Math.min(1.6, y - yBase + 0.6), 0.28, s.x + lane, (y - rise + y) / 2, cz + sd * hl - sd * 0.3, 0x5e3e22);
      }
    }
    // 横向系梁（每层 3 道，压住 5 道纵梁）
    for (const zz of [-hl * 0.55, 0, hl * 0.55]) {
      bk.box('wood', W * 0.86, 0.2, 0.3, s.x, y - rise * 0.45 + 0.2, cz + zz, 0x7a5230);
    }
  }
  deckRun(bk, s, 'wood', cz);
  railRun(bk, s, cz);
  headRun(bk, s, cz, 'wood');
  plaqueRun(sg, atlas, s, cz);
  bk.kit('bridge.main.stackedBeam', 1, s.crown);
  bk.kit('bridge.crossing', 1, s.crown);
}

/** 廊桥：木桥面 + 两排廊柱 + 随拱起坡的双坡廊顶 + 廊内挂灯 */
function coveredCrossing(bk: Baker, s: BridgeSpec, sg: SignMesher, atlas: SignAtlas): void {
  const cz = riverCenterZ(s.x);
  const half = bridgeHalfSpan(s);
  const W = s.wide;
  deckRun(bk, s, 'wood', cz);
  const n = Math.max(8, Math.round((2 * half) / 3.4));
  for (let k = 0; k <= n; k++) {
    const z = -half + 1.6 + ((2 * half - 3.2) * k) / n;
    const y = deckYOf(s, z);
    for (const sd of [-1, 1]) bk.box('wood', 0.22, 2.7, 0.22, s.x + sd * (W / 2 - 0.35), y + 1.35, cz + z, 0x7a2a20);
    bk.box('wood', W, 0.24, 0.2, s.x, y + 2.72, cz + z, 0x5e3e22);
    if (k % 3 === 1) bk.box('glow', 0.26, 0.34, 0.26, s.x, y + 2.35, cz + z, C.lantern);
  }
  // 双坡廊顶：沿桥面分 12 段，段段随拱背起坡
  const halfW = W / 2 + 0.75, rise = 1.5;
  const th = Math.atan2(rise, halfW);
  const L = Math.hypot(halfW, rise);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const z0 = -half + (2 * half * i) / N;
    const z1 = -half + (2 * half * (i + 1)) / N;
    const zm = (z0 + z1) / 2;
    const y = deckYOf(s, zm) + 2.82;
    const ang = -Math.atan2(deckYOf(s, z1) - deckYOf(s, z0), z1 - z0);
    for (const sd of [-1, 1]) {
      bk.box('roof', L, 0.16, (z1 - z0) * 1.12, s.x + sd * halfW * 0.5, y + rise / 2, cz + zm, 0x3a4450, 0, ang, -sd * th);
    }
    bk.box('roof', 0.42, 0.22, (z1 - z0) * 1.12, s.x, y + rise, cz + zm, 0x4a5560, 0, ang, 0);
  }
  railRun(bk, s, cz);
  headRun(bk, s, cz, 'ash');
  plaqueRun(sg, atlas, s, cz);
  bk.kit('bridge.main.covered', 1, s.crown);
  bk.kit('bridge.crossing', 1, s.crown);
}

/**
 * 浮桥：浮舟 + 2.6m 高排架托 3.6m 桥面（桥面高出水面 2.6m），中央留通航孔抬到 6.2m。
 * 宽河（通津橋）通航孔 36m 覆盖双向航道，浮舟只落在 |dz|≥21 的航道之外；
 * 窄河（浮梁，无船队航段）通航孔收成 12m，浮舟自 |dz|=8 起铺。
 */
function pontoonCrossing(bk: Baker, s: BridgeSpec, sg: SignMesher, atlas: SignAtlas): void {
  const cz = riverCenterZ(s.x);
  const hw = riverHalfWidth(s.x);
  const half = bridgeHalfSpan(s);
  const W = s.wide;
  const nav = hw > 26 ? 18 : 6;
  const floatFrom = nav > 6 ? 21 : 8;
  const floatTo = hw - 0.8;
  for (const sd of [-1, 1]) {
    for (let a = floatFrom; a <= floatTo + 0.01; a += 2.2) {
      const z = sd * a;
      bk.cyl('wood', 0.56, 0.56, W + 0.5, 10, s.x, RIVER_WATER_Y + 0.06, cz + z,
        shade(0x5e3e22, 0.95 + (Math.round(a) % 3) * 0.03), 0, 0, Math.PI / 2);
      bk.box('metal', W + 0.6, 0.12, 0.16, s.x, RIVER_WATER_Y + 0.08, cz + z, 0x4a4e54);
      for (const ox of [-W / 2 + 0.55, W / 2 - 0.55]) {
        bk.box('wood', 0.26, 2.72, 0.26, s.x + ox, RIVER_WATER_Y + 1.36, cz + z, 0x5e3e22);
      }
      bk.box('wood', W + 0.4, 0.22, 0.3, s.x, 3.52, cz + z, 0x6b4a2b);
    }
    // 通航孔：四柱 + 上下弦 + 斜撑（水面以上净空 5.2m）
    for (const ox of [-W / 2 + 0.5, W / 2 - 0.5]) {
      bk.box('wood', 0.3, 6.5, 0.3, s.x + ox, 4.25, cz + sd * nav, 0x4a3220);
      bk.box('ash', 0.8, 0.5, 0.8, s.x + ox, -1.85, cz + sd * nav, shade(C.stone, 0.92));
    }
    bk.box('wood', W + 0.5, 0.28, 0.34, s.x, 7.5, cz + sd * nav, 0x5e3e22);
    bk.box('wood', W + 0.4, 0.26, 0.32, s.x, 6.2, cz + sd * nav, 0x6b4a2b);
    for (const ox of [-W / 2 + 0.5, W / 2 - 0.5]) {
      bk.box('wood', 0.16, 3.4, 0.16, s.x + ox, 5.4, cz + sd * (nav - 1.4), 0x5e3e22, 0, sd * 0.56, 0);
    }
  }
  deckRun(bk, s, 'wood', cz);
  railRun(bk, s, cz);
  headRun(bk, s, cz, 'wood');
  plaqueRun(sg, atlas, s, cz);
  bk.kit('bridge.main.pontoon', 1, 3.6);
  bk.kit('bridge.crossing', 1, 3.6);
}

/** 木梁桥：五道木排架落在河床 + 木桥面 + 中段四柱茶亭（通濟橋） */
function timberCrossing(bk: Baker, s: BridgeSpec, sg: SignMesher, atlas: SignAtlas): void {
  const cz = riverCenterZ(s.x);
  const hw = riverHalfWidth(s.x);
  const half = bridgeHalfSpan(s);
  const W = s.wide;
  const bents = [-half + 2, -hw * 0.8, -hw * 0.4, 0, hw * 0.4, hw * 0.8, half - 2];
  for (const dz of bents) {
    const yTop = deckYOf(s, dz) - 0.3;
    for (const sx of [-1, 1]) {
      bk.box('wood', 0.3, yTop + 1.6, 0.3, s.x + sx * (W / 2 - 0.6), (yTop - 1.6) / 2, cz + dz, 0x5e3e22);
      bk.box('ash', 0.8, 0.5, 0.8, s.x + sx * (W / 2 - 0.6), -1.9, cz + dz, shade(C.stone, 0.92));
      bk.box('wood', 0.16, 1.6, 0.16, s.x + sx * (W / 2 - 1.3), yTop - 0.9, cz + dz, 0x5e3e22, 0, 0, sx * 0.42);
    }
    bk.box('wood', W + 0.6, 0.24, 0.32, s.x, yTop, cz + dz, 0x6b4a2b);
  }
  // 中段茶亭：四柱 + 额枋 + 双坡瓦顶
  const PY = deckYOf(s, 0);
  for (const sx of [-1, 1]) {
    for (const dz of [-2.4, 2.4]) {
      bk.box('wood', 0.24, 2.5, 0.24, s.x + sx * 1.9, PY + 1.25, cz + dz, 0x7a2a20);
      bk.box('ash', 0.54, 0.16, 0.54, s.x + sx * 1.9, PY + 0.08, cz + dz, shade(C.stone, 1.02));
    }
    bk.box('wood', 0.2, 0.3, 5.2, s.x + sx * 1.9, PY + 2.42, cz, 0x5e3e22);
  }
  for (const dz of [-2.4, 2.4]) bk.box('wood', 4.2, 0.3, 0.2, s.x, PY + 2.42, cz + dz, 0x5e3e22);
  for (const sx of [-1, 1]) bk.box('roof', 3.6, 0.2, 6.0, s.x + sx * 1.6, PY + 2.85, cz, shade(C.tile, 1.04), 0, 0, sx * 0.3);
  bk.box('roof', 0.5, 0.34, 6.1, s.x, PY + 3.44, cz, shade(C.ridge, 1.1));
  bk.box('glow', 3.9, 0.1, 0.1, s.x, PY + 2.7, cz, C.neonCyan);
  deckRun(bk, s, 'wood', cz);
  railRun(bk, s, cz);
  headRun(bk, s, cz, 'wood');
  plaqueRun(sg, atlas, s, cz);
  bk.kit('bridge.main.timber', 1, s.crown);
  bk.kit('bridge.crossing', 1, s.crown);
}

/** 主河段桥梁群总装：虹桥本体已在 buildBridge 里造好，这里补其余 7 座并落台账 */
export function buildMainCrossings(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  BRIDGE_LEDGER.length = 0;
  for (const spec of MAIN_BRIDGES) {
    ledgerPush(spec);
    if (spec.form === '贯木拱') continue;
    if (spec.form === '石拱') stoneArchCrossing(b, spec, sg, atlas);
    else if (spec.form === '叠梁拱') stackedCrossing(b, spec, sg, atlas);
    else if (spec.form === '廊桥') coveredCrossing(b, spec, sg, atlas);
    else if (spec.form === '浮桥') pontoonCrossing(b, spec, sg, atlas);
    else timberCrossing(b, spec, sg, atlas);
  }
  b.kit('bridge.ledger', MAIN_BRIDGES.length, 0);
  // 自动化测试句柄：探针读 __bridges 拿每座桥的世界坐标/桥面高/跨度/形制
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)['__bridges'] = BRIDGE_LEDGER;
  }
}
