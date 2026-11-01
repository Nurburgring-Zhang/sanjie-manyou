import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import { C } from './buildings';
import { BRIDGE_HALF, bridgeDeckY } from './layout';
import { riverCenterZ, riverHalfWidth } from './river';

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
  // ---- R1：主桥之外的三处过河构造（石拱桥 / 木梁桥 / 浮桥）----
  buildSecondaryCrossings(b, sg, atlas);
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

// ============ R1：主桥之外的三处过河构造 ============
// 用户原话「河上只有桥，没有其他通道，不然船怎么运行？可以有多座桥，以及很多船。」
// 位置：石拱桥 −1680 / 木梁桥 +1620 / 浮桥 −2480；彼此间距 800–1680m，全部让开主桥 ±300m。
// 三座都按「桥面 + 双侧栏杆 + 桥墩」造，浮桥另留 12m 通航孔（中间抬成一座木桁架）。
export const SECONDARY_CROSSINGS = { stone: -1680, timber: 1620, pontoon: -2480 } as const;

const STONE_W = 6.6;
const DECK_T = 0.42;

/** 桥轴沿 z，桥面顶标高只随 |dz| 变（抛物线拱背）；half 为水线半宽 */
function stoneDeckY(dz: number, half: number): number {
  const t = dz / half;
  return 2.0 + 2.7 * (1 - t * t);
}

export function buildSecondaryCrossings(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  stoneArchBridge(b, sg, atlas, SECONDARY_CROSSINGS.stone, '永寧橋');
  timberBeamBridge(b, sg, atlas, SECONDARY_CROSSINGS.timber, '通濟橋');
  pontoonBridge(b, sg, atlas, SECONDARY_CROSSINGS.pontoon, '浮梁');
  b.kit('bridge.crossing', 3, 1.6);
}

/** 桥名匾两面各一（桥轴沿 z，匾面朝 ±x） */
function bridgePlaque(sg: SignMesher, atlas: SignAtlas, key: string, name: string, x: number, y: number, z: number, faceX: number): void {
  for (const s of [-1, 1]) {
    sg.quad(atlas.text(key + s, name, 220, 76, {
      color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(10,8,14,0.85)', border: 'rgba(255,179,0,.9)', fontPx: 54,
    }), 3.2, 1.1, x + s * faceX, y, z, (s * Math.PI) / 2);
  }
}

/**
 * 三孔石拱桥（西城 · 永寧橋）：中孔 12m 为通航孔，两侧各 8.5m。
 * 桥面抛物线拱背，两端各四级石踏步落到岸上；双侧栏板 + 望柱 + 霓虹沿口。
 */
function stoneArchBridge(b: Baker, sg: SignMesher, atlas: SignAtlas, x0: number, name: string): void {
  const cz = riverCenterZ(x0);
  const half = riverHalfWidth(x0);
  const W = STONE_W;
  const deckY = (dz: number): number => stoneDeckY(dz, half);
  const ARCH = [
    { a: -6.0, c: 6.0, rise: 3.6, spring: 0.3 },    // 中孔：水面以上净高 2.9，小船可过
    { a: 8.4, c: 16.9, rise: 2.6, spring: 0.4 },
    { a: -16.9, c: -8.4, rise: 2.6, spring: 0.4 },
  ];
  const archTop = (dz: number): number => {
    for (const g of ARCH) {
      if (dz > g.a && dz < g.c) {
        const t = (dz - (g.a + g.c) / 2) / ((g.c - g.a) / 2);
        return g.spring + g.rise * Math.sqrt(Math.max(0, 1 - t * t));
      }
    }
    return 0.35;
  };
  // 拱腹墙：1.5m 切片自拱线砌到桥面板底（曲面 intrados 才读成"拱"，不是一块方板）
  const S = 1.5;
  for (let dz = -half; dz < half - 0.01; dz += S) {
    const zc = dz + S / 2;
    const top = deckY(zc) - DECK_T;
    const bot = archTop(zc);
    if (top - bot > 0.03) {
      b.box('ash', W, top - bot, S + 0.02, x0, (top + bot) / 2, cz + zc, shade(C.stone, 0.96 + (Math.abs(Math.round(zc)) % 3) * 0.025));
    }
  }
  // 桥墩 / 桥台：自河床 −2.4 砌到拱脚
  for (const [z0, z1] of [[6, 8.4], [-8.4, -6], [16.7, half], [-half, -16.7]] as const) {
    b.box('ash', W + 0.4, 2.75, z1 - z0, x0, -1.02, cz + (z0 + z1) / 2, shade(C.stone, 0.9));
  }
  // 分水尖（上下游各一，45° 菱面）
  for (const pz of [7.2, -7.2]) {
    for (const sx of [-1, 1]) {
      b.box('ash', 1.5, 5.6, 1.5, x0 + sx * (W / 2 + 0.28), 0.4, cz + pz, shade(C.stone, 1.02), Math.PI / 4);
    }
  }
  // 桥面板（14 段随拱背起坡）
  const NSEG = 14;
  for (let i = 0; i < NSEG; i++) {
    const z0 = -half + (2 * half * i) / NSEG;
    const z1 = -half + (2 * half * (i + 1)) / NSEG;
    const zm = (z0 + z1) / 2;
    const ang = -Math.atan2(deckY(z1) - deckY(z0), z1 - z0);
    b.box('ash', W, DECK_T, (z1 - z0) * 1.05, x0, deckY(zm) - DECK_T / 2, cz + zm, shade(C.stone, 1.04), 0, ang, 0);
    b.box('ash', W - 1.3, 0.06, (z1 - z0) * 1.02, x0, deckY(zm) + 0.03, cz + zm, shade(C.stone, 0.9), 0, ang, 0);
  }
  // 栏板：望柱 + 双道横杆 + 霓虹沿口
  const posts: number[] = [];
  for (let dz = -20.4; dz <= 20.41; dz += 4.08) posts.push(dz);
  for (const sx of [-1, 1]) {
    const px = x0 + sx * (W / 2 - 0.28);
    for (const dz of posts) {
      const y = deckY(dz);
      b.box('ash', 0.34, 1.2, 0.34, px, y + 0.6, cz + dz, shade(C.stone, 1.06));
      b.box('ash', 0.44, 0.12, 0.44, px, y + 1.24, cz + dz, shade(C.stone, 1.14));
      if (Math.abs(dz) > 19) b.box('glow', 0.2, 0.26, 0.2, px, y + 1.42, cz + dz, C.lantern);
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const zA = cz + posts[i], zB = cz + posts[i + 1];
      const yA = deckY(posts[i]), yB = deckY(posts[i + 1]);
      const ang = -Math.atan2(yB - yA, zB - zA);
      const len = Math.hypot(zB - zA, yB - yA);
      b.box('ash', 0.22, 0.16, len, px, (yA + yB) / 2 + 0.94, (zA + zB) / 2, shade(C.stone, 1.0), 0, ang, 0);
      b.box('ash', 0.2, 0.12, len, px, (yA + yB) / 2 + 0.54, (zA + zB) / 2, shade(C.stone, 0.96), 0, ang, 0);
      b.box('glow', 0.1, 0.1, len, x0 + sx * (W / 2 + 0.02), (yA + yB) / 2 + 1.28, (zA + zB) / 2, sx > 0 ? C.neonCyan : C.neonMag, 0, ang, 0);
    }
  }
  // 拱券脸石：每孔 11 块，随椭圆拱线倾斜
  for (const g of ARCH) {
    const span = g.c - g.a, mid = (g.a + g.c) / 2, R = span / 2;
    const NS = 11;
    for (let k = 0; k < NS; k++) {
      const a0 = (Math.PI * k) / NS, a1 = (Math.PI * (k + 1)) / NS;
      const dz1 = mid + R * Math.cos(a0), dz2 = mid + R * Math.cos(a1);
      const y1 = g.spring + g.rise * Math.sin(a0), y2 = g.spring + g.rise * Math.sin(a1);
      const ang = -Math.atan2(y2 - y1, dz2 - dz1);
      const len = Math.hypot(dz2 - dz1, y2 - y1) * 1.12;
      for (const sx of [-1, 1]) {
        b.box('ash', 0.34, 0.62, len, x0 + sx * (W / 2 + 0.1), (y1 + y2) / 2 + 0.1, cz + (dz1 + dz2) / 2,
          shade(C.stone, 1.06 + (k % 2) * 0.06), 0, ang, 0);
      }
    }
    // 拱顶龙门石
    b.box('ash', 0.4, 0.74, 0.9, x0, g.spring + g.rise + 0.16, cz + mid, shade(C.stone, 1.18));
  }
  // 两端四级石踏步（自桥面 2.0 落到岸面 0）
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const top = 1.6 - i * 0.4;
      b.box('ash', W, top, 1.15, x0, top / 2, cz + s * (half + 0.62 + i * 1.12), shade(C.stone, 0.98 + i * 0.03));
    }
    b.box('ash', W + 0.6, 0.16, 1.4, x0, 0.08, cz + s * (half + 4.6), shade(C.stone, 0.94));
  }
  bridgePlaque(sg, atlas, 'bridge_stone', name, x0, deckY(0) + 1.9, cz, W / 2 + 0.2);
  b.kit('bridge.stoneArchSecondary', 1, 3.4);
}

/**
 * 木梁桥（东城 · 通濟橋）：五道木排架 + 桥面板 + 双侧栏杆，中段起一座四柱茶亭。
 * 桥面 48m（含水线两侧桥台），净跨 42m；排架落在河床上，航道中心不落柱。
 */
function timberBeamBridge(b: Baker, sg: SignMesher, atlas: SignAtlas, x0: number, name: string): void {
  const cz = riverCenterZ(x0);
  const half = riverHalfWidth(x0);
  const W = 5.2;
  const L = 24;
  const deckY = (dz: number): number => 3.25 + 0.35 * (1 - (dz / L) * (dz / L));
  // 桥面板
  const NSEG = 16;
  for (let i = 0; i < NSEG; i++) {
    const z0 = -L + (2 * L * i) / NSEG, z1 = -L + (2 * L * (i + 1)) / NSEG;
    const zm = (z0 + z1) / 2;
    const ang = -Math.atan2(deckY(z1) - deckY(z0), z1 - z0);
    b.box('wood', W, 0.26, (z1 - z0) * 1.04, x0, deckY(zm) - 0.13, cz + zm, shade(C.wood, 1.0 + (i % 2) * 0.08), 0, ang, 0);
    if (i % 4 === 0) b.box('wood', W + 0.2, 0.12, 0.32, x0, deckY(zm) + 0.02, cz + zm, shade(C.woodDark, 1.06), 0, ang, 0);
  }
  // 排架：±18 / ±9 / 0，两柱一梁 + 斜撑 + 石础
  for (const dz of [-18, -9, 0, 9, 18]) {
    const yTop = deckY(dz) - 0.28;
    for (const sx of [-1, 1]) {
      b.box('wood', 0.28, yTop + 1.8, 0.28, x0 + sx * 2.0, (yTop - 1.8) / 2, cz + dz, shade(C.woodDark, 1.02));
      b.box('ash', 0.8, 0.5, 0.8, x0 + sx * 2.0, -1.95, cz + dz, shade(C.stone, 0.92));
      b.box('wood', 0.16, 1.5, 0.16, x0 + sx * 1.45, yTop - 0.85, cz + dz, shade(C.wood, 0.96), 0, 0, sx * 0.42);
    }
    b.box('wood', W + 0.6, 0.24, 0.3, x0, yTop, cz + dz, shade(C.woodDark, 1.08));
    b.box('wood', W + 0.2, 0.16, 0.5, x0, yTop + 0.16, cz + dz, shade(C.wood, 1.04));
  }
  // 双侧栏杆：立柱 4.6m 一根 + 双道横杆
  const posts: number[] = [];
  for (let dz = -23; dz <= 23.01; dz += 4.6) posts.push(dz);
  for (const sx of [-1, 1]) {
    const px = x0 + sx * (W / 2 - 0.18);
    for (const dz of posts) {
      b.box('wood', 0.2, 1.15, 0.2, px, deckY(dz) + 0.575, cz + dz, shade(C.woodDark, 1.04));
      b.box('glow', 0.16, 0.16, 0.16, px, deckY(dz) + 1.2, cz + dz, Math.abs(dz) > 22 ? C.lantern : C.neonGold);
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const zA = cz + posts[i], zB = cz + posts[i + 1];
      const yA = deckY(posts[i]), yB = deckY(posts[i + 1]);
      const ang = -Math.atan2(yB - yA, zB - zA);
      const len = Math.hypot(zB - zA, yB - yA);
      for (const dy of [0.9, 0.5]) b.box('wood', 0.14, 0.12, len, px, (yA + yB) / 2 + dy, (zA + zB) / 2, shade(C.wood, 1.06), 0, ang, 0);
    }
  }
  // 中段茶亭：四柱 + 额枋 + 双坡瓦顶（亭面阔跨桥面）
  const PY = deckY(0);
  for (const sx of [-1, 1]) {
    for (const dz of [-2.3, 2.3]) {
      b.box('wood', 0.22, 2.4, 0.22, x0 + sx * 1.9, PY + 1.2, cz + dz, shade(C.woodRed, 0.98));
      b.box('ash', 0.5, 0.16, 0.5, x0 + sx * 1.9, PY + 0.08, cz + dz, shade(C.stone, 1.02));
    }
    b.box('wood', 0.2, 0.3, 5.0, x0 + sx * 1.9, PY + 2.32, cz, shade(C.woodDark, 1.06));
  }
  for (const dz of [-2.3, 2.3]) b.box('wood', 4.0, 0.3, 0.2, x0, PY + 2.32, cz + dz, shade(C.woodDark, 1.06));
  for (const sx of [-1, 1]) {
    b.box('roof', 3.4, 0.2, 5.8, x0 + sx * 1.55, PY + 2.75, cz, shade(C.tile, 1.04), 0, 0, sx * 0.3);
  }
  b.box('roof', 0.5, 0.34, 5.9, x0, PY + 3.34, cz, shade(C.ridge, 1.1));
  b.box('glow', 3.9, 0.1, 0.1, x0, PY + 2.62, cz, C.neonCyan);
  for (const sx of [-1, 1]) b.box('glow', 0.22, 0.36, 0.22, x0 + sx * 1.5, PY + 2.05, cz - 2.1, C.lantern);
  // 两端八级木踏步（3.25 → 0）
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const top = 3.25 - 0.4 * i;
      b.box('wood', W, 0.16, 1.05, x0, top - 0.08, cz + s * (L + 0.55 + i * 1.0), shade(C.wood, 0.96 + i * 0.02));
      b.box('wood', W - 0.8, top, 0.9, x0, top / 2, cz + s * (L + 0.55 + i * 1.0), shade(C.woodDark, 0.92));
    }
  }
  bridgePlaque(sg, atlas, 'bridge_timber', name, x0, PY + 2.0, cz, W / 2 + 0.2);
  b.kit('bridge.timberSecondary', 1, 3.0);
}

/**
 * 浮桥（西城 · 浮梁）：二十四只木浮舟托 4.4m 桥面，中间 12m 抬成木桁架通航孔。
 * 两端各四级石踏步上岸，缆绳系在岸上缆桩。
 */
function pontoonBridge(b: Baker, sg: SignMesher, atlas: SignAtlas, x0: number, name: string): void {
  const cz = riverCenterZ(x0);
  const half = riverHalfWidth(x0);
  const W = 4.4;
  const LOW = 1.55, HIGH = 3.5, GAP = 6, RAMP = 4.5;
  const deckY = (dz: number): number => {
    const a = Math.abs(dz);
    if (a <= GAP) return HIGH;
    if (a <= GAP + RAMP) return HIGH - ((a - GAP) / RAMP) * (HIGH - LOW);
    return LOW;
  };
  // 浮舟（横卧圆木，轴沿 x）
  for (const s of [-1, 1]) {
    for (let a = GAP + RAMP + 0.7; a <= half - 0.2; a += 1.4) {
      const dz = s * a;
      b.cyl('wood', 0.52, 0.52, W + 0.3, 10, x0, 0.95, cz + dz, shade(0x5e3e22, 0.96 + (Math.round(a) % 3) * 0.03), 0, 0, Math.PI / 2);
      b.box('metal', W + 0.4, 0.1, 0.16, x0, 0.95, cz + dz, 0x4a4e54);
    }
  }
  // 桥面：低段 / 斜段 / 抬升段，逐段随坡
  const run = (za: number, zb: number): void => {
    const n = Math.max(1, Math.round(Math.abs(zb - za) / 2.2));
    for (let i = 0; i < n; i++) {
      const d0 = za + ((zb - za) * i) / n, d1 = za + ((zb - za) * (i + 1)) / n;
      const dm = (d0 + d1) / 2;
      const ang = -Math.atan2(deckY(d1) - deckY(d0), d1 - d0);
      b.box('wood', W, 0.26, Math.abs(d1 - d0) * 1.04, x0, deckY(dm) - 0.13, cz + dm, shade(C.wood, 1.0 + (i % 2) * 0.07), 0, ang, 0);
    }
  };
  run(-half + 0.2, -GAP - RAMP);
  run(-GAP - RAMP, -GAP);
  run(-GAP, GAP);
  run(GAP, GAP + RAMP);
  run(GAP + RAMP, half - 0.2);
  // 通航孔桁架：两端立柱 + 上弦 + 斜杆（水面以上净空 2.5m）
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) {
      b.box('wood', 0.26, HIGH + 1.8, 0.26, x0 + sx * 1.7, (HIGH - 1.8) / 2, cz + s * GAP, shade(C.woodDark, 1.04));
      b.box('ash', 0.7, 0.5, 0.7, x0 + sx * 1.7, -1.85, cz + s * GAP, shade(C.stone, 0.92));
    }
    b.box('wood', W + 0.4, 0.26, 0.3, x0, HIGH - 0.45, cz + s * GAP, shade(C.woodDark, 1.08));
    for (const sx of [-1, 1]) {
      b.box('wood', 0.16, 3.0, 0.16, x0 + sx * 1.7, HIGH - 1.5, cz + s * (GAP - 0.9), shade(C.wood, 1.0), 0, s * 0.55, 0);
    }
  }
  // 栏杆：立柱 3m 一根 + 双道横杆（随桥面起坡）
  const posts: number[] = [];
  for (let dz = -half + 0.4; dz <= half - 0.39; dz += 3.0) posts.push(dz);
  for (const sx of [-1, 1]) {
    const px = x0 + sx * (W / 2 - 0.15);
    for (const dz of posts) {
      b.box('wood', 0.18, 1.05, 0.18, px, deckY(dz) + 0.52, cz + dz, shade(C.woodDark, 1.02));
      b.box('glow', 0.14, 0.2, 0.14, px, deckY(dz) + 1.12, cz + dz, Math.abs(dz) > half - 1 ? C.lantern : C.neonGold);
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const zA = cz + posts[i], zB = cz + posts[i + 1];
      const yA = deckY(posts[i]), yB = deckY(posts[i + 1]);
      const ang = -Math.atan2(yB - yA, zB - zA);
      const len = Math.hypot(zB - zA, yB - yA);
      for (const dy of [0.82, 0.44]) b.box('wood', 0.13, 0.11, len, px, (yA + yB) / 2 + dy, (zA + zB) / 2, shade(C.wood, 1.05), 0, ang, 0);
    }
  }
  // 缆绳 + 岸上缆桩 + 四级石踏步
  for (const s of [-1, 1]) {
    const zEnd = cz + s * (half - 0.6), zPost = cz + s * (half + 2.6);
    b.box('fabric', 0.1, 0.1, 3.4, x0, LOW - 0.1, (zEnd + zPost) / 2, 0x2b1b3d, 0, 0.12, 0);
    b.cyl('wood', 0.18, 0.22, 1.1, 8, x0, 0.55, zPost, shade(0x5a4630, 1.0));
    b.cyl('metal', 0.2, 0.2, 0.06, 8, x0, 0.92, zPost, 0x4a4e54);
    for (let i = 0; i < 4; i++) {
      const top = 1.2 - i * 0.3;
      if (top <= 0.05) break;
      b.box('ash', W, top, 1.1, x0, top / 2, cz + s * (half + 0.6 + i * 1.05), shade(C.stone, 0.98 + i * 0.03));
    }
  }
  bridgePlaque(sg, atlas, 'bridge_pontoon', name, x0, HIGH + 1.0, cz, W / 2 + 0.2);
  b.kit('bridge.pontoon', 1, 1.7);
}
