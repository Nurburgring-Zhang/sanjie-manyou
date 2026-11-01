import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from '../city/bake';
import { FENGDU } from './fengduGround';

/**
 * 丰都鬼城逐铺细节批（90 座鬼铺轻量原子）。
 * 屋顶、檐口、门窗、雨棚、灯笼、招牌与十二类外摆一并落地；构件随楼体朝向与残破倾斜。
 */
export interface GhostShopSign {
  sg: SignMesher;
  atlas: SignAtlas;
  label: string;
  key: string;
}

export interface GhostShopSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  kind: number;
  sink: number;
  tilt?: number;
  /** 铺面朝向（0 面 +z，π 面 −z），成街时两排对望 */
  ry?: number;
  sign?: GhostShopSign;
}

const WOOD_DARK = 0x2a201c;
const WOOD_WEATHER = 0x3b2e26;
const STONE = 0x2b2a31;
const STONE_LIGHT = 0x3d3c44;
const IRON = 0x4a4650;
const CLOTH_ROT = 0x5a4a3c;
const PAPER = 0xb9ac90;
const LACQ = 0x351a17;
const AMBER = 0xffb45e;
const GHOST = 0x8effc8;
const BLOOD = 0xff4436;
const CHILL = 0x7ea6ff;
const ROOF_TILE = 0x171c21;
const ROOF_RIB = 0x232b31;
const ROOF_EAVE = 0x0e1216;

/** 由坐标决定的稳定伪随机，避免同批重建时构件跳位 */
function hasher(x: number, z: number, salt: number): () => number {
  let s = (Math.imul(Math.round(x * 13 + z * 7) ^ salt, 2246822519) >>> 0) || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 374761393) >>> 0;
    return s / 4294967296;
  };
}

export function buildGhostShopDetail(b: Baker, o: GhostShopSpec): void {
  const { x, y, z, w, d, h, kind, sink } = o;
  const tilt = o.tilt ?? 0;
  const ry = o.ry ?? 0;
  const rx = tilt * 0.6;
  const rz = tilt;
  const cx = x;
  const cy = y + h / 2 - sink;
  const cz = z;
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  const v = new THREE.Vector3();
  const P = (lx: number, ly: number, lz: number): [number, number, number] => {
    v.set(lx, ly, lz).applyMatrix4(rot);
    return [cx + v.x, cy + v.y, cz + v.z];
  };
  const cosR = Math.cos(ry);
  const sinR = Math.sin(ry);
  const groundY = y - sink;
  /** 地面构件：只随铺面朝向转，不随残破倾斜，件件落地 */
  const Pg = (lx: number, lz: number): [number, number] => [cx + lx * cosR + lz * sinR, cz - lx * sinR + lz * cosR];
  const gx = (g: Parameters<Baker['box']>[0], bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, hex: number, pry = 0): void => {
    const [wx, wz] = Pg(lx, lz);
    b.box(g, bw, bh, bd, wx, groundY + ly, wz, hex, ry + pry);
  };
  const gc = (g: Parameters<Baker['cyl']>[0], rt: number, rb: number, ch: number, seg: number, lx: number, ly: number, lz: number, hex: number, open = false): void => {
    const [wx, wz] = Pg(lx, lz);
    b.cyl(g, rt, rb, ch, seg, wx, groundY + ly, wz, hex, ry, 0, 0, open);
  };
  /** 贴楼构件：与楼体同倾同向 */
  const bx = (g: Parameters<Baker['box']>[0], bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, hex: number, erx = 0): void => {
    const [ax, ay, az] = P(lx, ly, lz);
    b.box(g, bw, bh, bd, ax, ay, az, hex, ry, rx + erx, rz);
  };

  const front = d / 2;
  const doorH = Math.min(2.1, h * 0.62);

  // ---- 屋顶：反宇屋面 + 檐口 + 瓦垄 + 屋脊 + 翘角 ----
  const roofH = Math.max(1.5, h * 0.42);
  const roofBaseLy = h / 2 - h * 0.03;
  const [rfx, rfy, rfz] = P(0, roofBaseLy, 0);
  b.roofC('roof', rfx, rfy, rfz, ROOF_TILE, ry, w * 1.32, roofH, d * 1.32, rx, rz);
  b.kit('fengdu.roof', 1, groundY + h);
  // 檐口薄板：压出檐下阴影线
  bx('roof', w * 1.36, 0.14, d * 1.36, 0, roofBaseLy + 0.02, 0, ROOF_EAVE);
  b.kit('fengdu.eave', 1, groundY + h);
  // 瓦垄：前后两坡各九道，垄背抬出屋面形成读得见的瓦条
  const slope = Math.atan2(roofH, d * 0.66);
  for (let k = 0; k < 9; k++) {
    const lx = (k - 4) * (w * 1.2 / 9);
    for (const s of [-1, 1]) {
      const lz = s * d * 0.42;
      const ly = roofBaseLy + roofH * 0.34;
      bx('roof', 0.17, 0.11, d * 0.8, lx, ly, lz, ROOF_RIB, s > 0 ? slope : -slope);
    }
  }
  b.kit('fengdu.tileRib', 18, groundY + h);
  // 瓦当：檐口一列圆瓦头，给屋面一条硬轮廓
  for (let k = 0; k < 15; k++) {
    const lx = -w * 0.64 + k * (w * 1.28 / 14);
    for (const s of [-1, 1]) bx('roof', 0.22, 0.24, 0.18, lx, roofBaseLy + 0.08, s * d * 0.66, shade(ROOF_RIB, 1.15));
  }
  b.kit('fengdu.tileEnd', 30, groundY + h);
  // 正脊 + 脊头。roofC 是**四坡顶**：t=0 的脊环只有 0.32 单位宽，世界尺度下平顶仅 0.32×1.32w ≈ 0.42w。
  // 旧写法按 w*0.96 铺满面阔，两端各越出平顶约 0.27w；越出段下方已没有瓦面承托（只剩檐口薄板），
  // 于是这条 0.34m 宽的正脊在街面上读成一根横跨屋面、两端悬空的横条。
  // 与九道瓦垄同源（固定长度/高度铺直条，而屋面是曲面 + 四坡收分），正脊只能压在实际平顶上。
  const ridgeLen = w * 0.40;
  bx('roof', ridgeLen, 0.22, 0.34, 0, roofBaseLy + roofH * 0.97, 0, shade(ROOF_TILE, 1.3));
  for (const s of [-1, 1]) bx('roof', 0.3, 0.5, 0.34, s * ridgeLen * 0.5, roofBaseLy + roofH * 1.02, 0, shade(ROOF_TILE, 1.45), 0);
  b.kit('fengdu.ridge', 1, groundY + h + roofH);
  // 四角起翘
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bx('roof', 0.42, 0.16, 0.5, sx * w * 0.66, roofBaseLy + 0.16, sz * d * 0.66, ROOF_EAVE);
    }
  }
  b.kit('fengdu.cornerTip', 4, groundY + h);
  // 檐下椽头与斗栱（正面）
  for (let k = 0; k < 8; k++) {
    bx('wood', 0.11, 0.11, 0.5, -w * 0.42 + k * (w * 0.84 / 7), h / 2 - 0.2, front + 0.42, WOOD_WEATHER);
  }
  b.kit('fengdu.rafterHead', 8, groundY + h - 0.2);
  for (let k = 0; k < 4; k++) {
    const lx = -w * 0.3 + k * (w * 0.6 / 3);
    bx('wood', 0.34, 0.26, 0.46, lx, h / 2 - 0.42, front + 0.3, shade(WOOD_WEATHER, 1.1));
    bx('wood', 0.2, 0.16, 0.3, lx, h / 2 - 0.62, front + 0.36, WOOD_DARK);
  }
  b.kit('fengdu.bracket', 4, groundY + h - 0.4);

  // ---- 墙体：墙裙、墙角柱、山墙压边 ----
  bx('ash', w * 1.02, 0.62, d * 1.02, 0, -h / 2 + 0.31, 0, shade(STONE, 0.9));
  for (const s of [-1, 1]) {
    bx('wood', 0.24, h, 0.24, s * (w / 2 - 0.16), 0, front - 0.12, WOOD_DARK);
    b.kit('fengdu.cornerPost', 1, groundY + h / 2);
  }
  b.kit('fengdu.wallSkirt', 1, groundY);

  // ---- 基座与门槛 ----
  bx('ash', w * 1.05, 0.36, d * 1.05, 0, -h / 2 + 0.18, 0, STONE);
  bx('ash', w * 1.11, 0.14, d * 1.11, 0, -h / 2 + 0.07, 0, shade(STONE, 0.82));
  bx('wood', w * 0.36, 0.16, 0.32, 0, -h / 2 + 0.44, front + 0.08, WOOD_DARK);
  b.kit('fengdu.base', 2, groundY);
  b.kit('fengdu.threshold', 1, groundY + 0.4);

  // ---- 铺面板壁与檐柱：下层整面木作，不再是石墙开几个洞 ----
  bx('wood', w * 0.99, doorH + 0.5, 0.06, 0, -h / 2 + (doorH + 0.5) / 2, front + 0.01, shade(WOOD_WEATHER, 0.76));
  bx('wood', w * 0.99, 0.22, 0.09, 0, -h / 2 + doorH + 0.58, front + 0.04, shade(WOOD_DARK, 1.25));
  b.kit('fengdu.shopfront', 1, groundY + doorH);
  // ---- 立面开间：面阔大者分三间，逐间板门与直棂窗 ----
  const bays = w > 24 ? 3 : w > 15 ? 2 : 1;
  const bayW = w / bays;
  const doorBaseLy = -h / 2 + 0.36;
  for (let bi = 0; bi < bays; bi++) {
    const bcx = (bi - (bays - 1) / 2) * bayW;
    const dW = Math.min(bayW * 0.46, 1.8);
    // 开间檐柱：柱础 + 柱身，给铺面立起木构节奏
    bx('ash', 0.42, 0.26, 0.42, bcx - bayW / 2, -h / 2 + 0.13, front + 0.12, STONE);
    bx('wood', 0.3, doorH + 0.68, 0.3, bcx - bayW / 2, -h / 2 + (doorH + 0.68) / 2, front + 0.12, shade(WOOD_DARK, 1.1));
    b.kit('fengdu.bayPost', 1, groundY + doorH / 2);
    const faceZ = front + 0.06;
    // 门框：立颊 + 门额
    bx('wood', 0.18, doorH + 0.2, 0.22, bcx - dW / 2 - 0.09, doorBaseLy + doorH / 2, faceZ, WOOD_DARK);
    bx('wood', 0.18, doorH + 0.2, 0.22, bcx + dW / 2 + 0.09, doorBaseLy + doorH / 2, faceZ, WOOD_DARK);
    bx('wood', dW + 0.36, 0.2, 0.24, bcx, doorBaseLy + doorH + 0.1, faceZ, WOOD_DARK);
    // 两扇板门 + 铁钉 + 门环
    for (let side = -1; side <= 1; side += 2) {
      const lx = bcx + side * dW * 0.25;
      bx('wood', dW * 0.47, doorH * 0.94, 0.1, lx, doorBaseLy + doorH / 2, front + 0.12, shade(WOOD_WEATHER, 0.9));
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          bx('metal', 0.07, 0.07, 0.05, lx + (c - 1) * dW * 0.13, doorBaseLy + 0.55 + r * doorH * 0.26, front + 0.18, IRON);
        }
      }
      bx('metal', 0.12, 0.12, 0.06, bcx + side * dW * 0.07, doorBaseLy + doorH * 0.42, front + 0.18, 0x6b5a3a);
      b.kit('fengdu.door', 1, groundY + doorH / 2);
      b.kit('fengdu.doorStud', 9, groundY + doorH / 2);
      b.kit('fengdu.doorRing', 1, groundY + doorH * 0.42);
    }
    // 直棂小窗：窗框 + 棂条 + 窗后鬼火
    const winW = Math.max(0.7, bayW * 0.22);
    const winH = Math.max(0.8, doorH * 0.46);
    for (let side = -1; side <= 1; side += 2) {
      const wx = bcx + side * (bays === 1 ? w * 0.33 : bayW * 0.33);
      const wy = doorBaseLy + doorH * 0.62;
      bx('glow', winW * 0.92, winH * 0.92, 0.06, wx, wy, front + 0.04, kind === 9 ? CHILL : GHOST);
      bx('wood', winW, 0.09, 0.1, wx, wy + winH / 2, front + 0.1, WOOD_DARK);
      bx('wood', winW, 0.09, 0.1, wx, wy - winH / 2, front + 0.1, WOOD_DARK);
      bx('wood', 0.09, winH, 0.1, wx - winW / 2, wy, front + 0.1, WOOD_DARK);
      bx('wood', 0.09, winH, 0.1, wx + winW / 2, wy, front + 0.1, WOOD_DARK);
      for (let sl = 0; sl < 4; sl++) {
        bx('wood', 0.045, winH * 0.9, 0.06, wx - winW * 0.33 + sl * winW * 0.22, wy, front + 0.13, shade(WOOD_WEATHER, 0.85));
      }
      b.kit('fengdu.window', 1, groundY + 2);
      b.kit('fengdu.windowSlat', 4, groundY + 2);
    }
  }

  // ---- 二层立面：腰檐、挑台栏板与格窗，避免高楼只剩一张空墙 ----
  if (h > 5.2) {
    const midLy = h / 2 - 1.55;
    bx('roof', w * 1.04, 0.12, 1.05, 0, midLy, front + 0.3, ROOF_EAVE);
    for (let k = 0; k < 4; k++) bx('wood', 0.2, 0.3, 0.4, -w * 0.3 + k * (w * 0.6 / 3), midLy - 0.22, front + 0.16, WOOD_DARK);
    // 挑台栏板
    bx('wood', w * 0.9, 0.5, 0.12, 0, midLy + 0.34, front + 0.5, shade(WOOD_WEATHER, 0.95));
    for (let k = 0; k < 7; k++) bx('wood', 0.1, 0.62, 0.1, -w * 0.42 + k * (w * 0.84 / 6), midLy + 0.34, front + 0.52, WOOD_DARK);
    // 二层格窗
    const upperN = Math.max(2, bays + 1);
    for (let k = 0; k < upperN; k++) {
      const lx = (k - (upperN - 1) / 2) * (w * 0.66 / upperN);
      const wy = midLy + 0.86;
      const uw = Math.min(0.82, (w * 0.66 / upperN) * 0.5);
      bx('glow', uw * 0.86, 0.96, 0.05, lx, wy, front + 0.14, k % 2 ? AMBER : GHOST);
      bx('wood', uw, 1.1, 0.08, lx, wy, front + 0.1, WOOD_DARK);
      for (let sl = 0; sl < 3; sl++) bx('wood', 0.045, 1.0, 0.05, lx - uw * 0.32 + sl * uw * 0.32, wy, front + 0.16, WOOD_WEATHER);
      bx('wood', uw * 1.1, 0.07, 0.08, lx, wy + 0.56, front + 0.14, WOOD_DARK);
      bx('wood', uw * 1.1, 0.07, 0.08, lx, wy - 0.56, front + 0.14, WOOD_DARK);
      b.kit('fengdu.upperWindow', 1, groundY + h - 1.6);
    }
    b.kit('fengdu.midEave', 1, groundY + h - 1.5);
    b.kit('fengdu.balustrade', 1, groundY + h - 1.2);
  }

  // ---- 破布雨棚：斜铺布篷 + 撑杆 + 竹骨 ----
  const awnW = Math.min(w * 0.88, 9);
  const awnY = -h / 2 + 0.36 + doorH + 0.36;
  const awnD = 1.35;
  const [ax, ay, az] = P(0, awnY, front + awnD / 2 - 0.1);
  b.box('fabric', awnW, 0.07, awnD, ax, ay, az, CLOTH_ROT, ry, rx - 0.34, rz);
  const posts = awnW > 6 ? [-1, 0, 1] : [-1, 1];
  for (const s of posts) {
    const [px, py, pz] = P(s * awnW * 0.42, awnY - 0.62, front + awnD - 0.16);
    b.cyl('wood', 0.055, 0.07, 1.35, 6, px, py, pz, WOOD_DARK);
    b.kit('fengdu.awningPost', 1, groundY);
  }
  for (let k = 0; k < 4; k++) {
    const [sx2, sy2, sz2] = P(-awnW / 2 + (k + 0.5) * (awnW / 4), awnY + 0.06, front + awnD / 2 - 0.1);
    b.box('wood', 0.06, 0.06, awnD * 0.96, sx2, sy2, sz2, WOOD_WEATHER, ry, rx - 0.34, rz);
  }
  b.kit('fengdu.awning', 1, groundY + doorH + 0.4);
  b.kit('fengdu.awningRib', 4, groundY + doorH + 0.4);

  // ---- 匾额：门楣上的铺名 ----
  if (o.sign) {
    const { sg, atlas } = o.sign;
    const uv = atlas.text(o.sign.key, o.sign.label, 256, 84, {
      color: '#d8ffe8', glow: '#3dff9c', bg: 'rgba(4,8,6,0.9)', border: 'rgba(61,255,156,.75)', fontPx: 52,
    });
    const signH = Math.min(w * 0.5, 5.2) * 0.33;
    const [sx3, sy3, sz3] = P(0, awnY + 0.72, front + 0.14);
    sg.quad(uv, Math.min(w * 0.5, 5.2), signH, sx3, sy3, sz3, ry);
    b.kit('fengdu.signboard', 1, groundY + doorH + 1);
  }

  // ---- 灯笼：铁钩 + 纸灯 + 灯芯 ----
  for (let s = -1; s <= 1; s += 2) {
    const [hx, hy, hz] = P(s * w * 0.3, awnY - 0.1, front + awnD - 0.24);
    b.box('metal', 0.06, 0.42, 0.06, hx, hy - 0.22, hz, IRON);
    b.cyl('glow', 0.21, 0.26, 0.44, 8, hx, hy - 0.6, hz, kind === 1 ? BLOOD : AMBER);
    b.box('metal', 0.1, 0.06, 0.1, hx, hy - 0.4, hz, 0x5c4a32);
    b.kit('fengdu.lantern', 1, groundY + doorH);
    b.kit('fengdu.lanternHook', 1, groundY + doorH);
  }

  // ---- 门前配件：台明踏步、门枕石、挑幌与檐下灯（按铺位格位固定覆盖 74%）----
  const cell = Math.round((x - FENGDU.x0) / FENGDU.colGap) + Math.round((z - FENGDU.z0) / FENGDU.rowGap) * FENGDU.cols;
  if (((cell % 4) + 4) % 4 !== 0) {
    const fy = (g: Parameters<Baker['box']>[0], bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, hex: number): void => {
      const [wx, wz] = Pg(lx, lz);
      b.box(g, bw, bh, bd, wx, y + 0.16 + ly, wz, hex, ry);
    };
    const stepW = Math.min(w * 0.44, 4.8);
    fy('ash', stepW, 0.34, 0.52, 0, 0.17, front + 0.34, STONE_LIGHT);
    fy('ash', stepW * 0.9, 0.16, 0.34, 0, 0.08, front + 0.74, shade(STONE, 1.15));
    const dsx = Math.min(bayW * 0.46, 1.8) / 2 + 0.42;
    for (const s of [-1, 1]) {
      fy('ash', 0.36, 0.4, 0.46, s * dsx, 0.54, front + 0.4, STONE_LIGHT);
      fy('ash', 0.3, 0.1, 0.4, s * dsx, 0.95, front + 0.4, shade(STONE_LIGHT, 1.2));
    }
    b.kit('fengdu.doorStep', 2, groundY + 0.3);
    b.kit('fengdu.doorStone', 2, groundY + 0.3);
    const fr = hasher(x, z, 53);
    const bs = fr() > 0.5 ? 1 : -1;
    const cloth = fr() > 0.5 ? 0x5c1b24 : 0x24483a;
    bx('wood', 0.08, 0.08, 1.7, bs * w * 0.42, awnY + 0.42, front + 0.8, WOOD_DARK);
    bx('wood', 0.1, 0.1, 0.12, bs * w * 0.42, awnY + 0.42, front + 0.06, WOOD_DARK);
    bx('fabric', 0.05, 1.2, 0.62, bs * w * 0.42, awnY - 0.05, front + 1.62, cloth);
    bx('fabric', 0.055, 0.22, 0.62, bs * w * 0.42, awnY - 0.72, front + 1.62, shade(cloth, 0.72));
    for (const s of [-1, 1]) {
      bx('metal', 0.1, 0.06, 0.3, s * w * 0.34, awnY + 0.62, front + 0.2, IRON);
      bx('metal', 0.04, 0.2, 0.04, s * w * 0.34, awnY + 0.5, front + 0.34, IRON);
      bx('glow', 0.17, 0.26, 0.17, s * w * 0.34, awnY + 0.3, front + 0.34, s < 0 ? GHOST : AMBER);
      bx('metal', 0.22, 0.05, 0.22, s * w * 0.34, awnY + 0.44, front + 0.34, 0x5c4a32);
    }
    b.kit('fengdu.shopBanner', 1, groundY + doorH + 0.6);
    b.kit('fengdu.eaveLamp', 2, groundY + doorH + 0.6);
  }

  // ---- 竖招：沿街立起的半幅布招 ----
  const [sgx, sgy, sgz] = P(w * 0.42, -h / 2 + doorH + 0.2, front + 0.24);
  b.box('wood', 0.1, 1.5, 0.5, sgx, sgy + 0.75, sgz, WOOD_DARK, ry, rx, rz);
  b.box('glow', 0.06, 0.36, 0.4, sgx, sgy + 1.34, sgz, kindAccent(kind), ry, rx, rz);
  b.box('glow', 0.06, 0.3, 0.36, sgx, sgy + 0.86, sgz, shade(kindAccent(kind), 0.7), ry, rx, rz);

  // ---- 十二类铺面外摆 ----
  buildStall(kind, b, { gx, gc, groundY, w, d, front });
  b.kit('fengdu.stall', 1, groundY);

  // ---- 街面残迹：断砖、纸钱、瓦砾 ----
  const r = hasher(x, z, 17);
  const debris = 3 + Math.floor(r() * 4);
  for (let i = 0; i < debris; i++) {
    const dx = (r() - 0.5) * w * 1.15;
    const dz = front + 0.9 + r() * 1.6;
    const sz = 0.12 + r() * 0.16;
    gx('wall', sz * 1.6, sz, sz, dx, sz / 2, dz, r() > 0.5 ? STONE_LIGHT : STONE, r() * 3.14);
  }
  b.kit('fengdu.debris', debris, groundY);
}

function kindAccent(kind: number): number {
  const list = [BLOOD, 0xff7a2d, 0xbaffef, 0x5a3a26, GHOST, 0xffd25e, 0x62ffb0, 0x4d7cff, 0xb26bff, 0xbaffef, 0x8a8a92, GHOST];
  return list[kind % 12];
}

type GxFn = (g: Parameters<Baker['box']>[0], w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, pry?: number) => void;
type GcFn = (g: Parameters<Baker['cyl']>[0], rt: number, rb: number, h: number, seg: number, lx: number, ly: number, lz: number, hex: number, open?: boolean) => void;

interface StallCtx {
  gx: GxFn;
  gc: GcFn;
  groundY: number;
  w: number;
  d: number;
  front: number;
}

function buildStall(kind: number, b: Baker, c: StallCtx): void {
  const f = c.front + 1.1;
  const kit = (id: string, n = 1, yy = 0): void => b.kit('fengdu.stall.' + id, n, c.groundY + yy);
  switch (kind) {
    case 0: { // 赌鬼坊：赌桌、骰盅、赌凳、散落筹码
      c.gx('wood', 1.5, 0.1, 1.0, 0.4, 0.78, f, WOOD_WEATHER);
      for (let s = -1; s <= 1; s += 2) {
        c.gx('wood', 0.1, 0.76, 0.1, 0.4 + s * 0.62, 0.38, f - 0.38, WOOD_DARK);
        c.gx('wood', 0.1, 0.76, 0.1, 0.4 + s * 0.62, 0.38, f + 0.38, WOOD_DARK);
      }
      c.gc('ceramic', 0.17, 0.2, 0.3, 8, 0.35, 0.98, f, 0x4a5a52);
      for (let i = 0; i < 3; i++) c.gx('glow', 0.04, 0.04, 0.04, 0.3 + i * 0.1, 0.86, f + 0.1, 0xf2e6c8);
      for (let s = -1; s <= 1; s += 2) {
        c.gx('wood', 0.34, 0.06, 0.34, 0.4 + s * 0.95, 0.42, f + 0.2, WOOD_DARK);
        c.gx('wood', 0.28, 0.4, 0.06, 0.4 + s * 0.95, 0.2, f + 0.2, WOOD_DARK);
      }
      for (let i = 0; i < 5; i++) c.gx('glow', 0.07, 0.03, 0.07, -0.9 + i * 0.42, 0.02, f - 0.7, i % 2 ? 0xd8b45e : 0xc86a4a);
      kit('gambleTable'); kit('diceCup'); kit('stool', 2, 0.2); kit('chips', 5);
      break;
    }
    case 1: { // 餓鬼食肆：灶台、汤锅、破碗、蒸笼
      c.gx('wall', 1.1, 0.7, 0.9, -0.4, 0.35, f, STONE);
      c.gc('metal', 0.42, 0.36, 0.5, 12, -0.4, 0.95, f, 0x3f3b34);
      c.gc('glow', 0.34, 0.3, 0.06, 12, -0.4, 1.2, f, 0xff7a2d);
      for (let i = 0; i < 3; i++) c.gc('ceramic', 0.13, 0.09, 0.09, 8, 0.5 + i * 0.26, 0.05, f + 0.3, 0x7a6a52);
      for (let i = 0; i < 2; i++) c.gc('wood', 0.3, 0.3, 0.16, 10, 0.75, 0.08 + i * 0.17, f - 0.3, 0xa08a62);
      c.gx('wood', 0.08, 0.5, 0.08, 0.1, 0.65, f + 0.1, WOOD_DARK);
      kit('stove'); kit('pot'); kit('brokenBowl', 3); kit('steamer', 2);
      break;
    }
    case 2: { // 紙扎鋪：纸扎人、纸马、竹骨架
      for (let s = -1; s <= 1; s += 2) {
        c.gx('fabric', 0.44, 0.8, 0.3, s * 0.8, 0.42, f, PAPER);
        c.gx('fabric', 0.24, 0.24, 0.24, s * 0.8, 0.94, f, 0xc8b89a);
        c.gx('glow', 0.1, 0.04, 0.04, s * 0.8, 0.9, f + 0.14, BLOOD);
      }
      c.gx('fabric', 0.9, 0.5, 0.34, 0.1, 0.5, f + 0.6, 0xc4b492);
      for (let i = 0; i < 4; i++) c.gx('wood', 0.05, 0.05, 0.6, 0.05 + (i - 1.5) * 0.22, 0.03, f + 0.6, 0x9a8a68, i * 0.2);
      c.gx('fabric', 0.5, 0.4, 0.04, -0.9, 0.02, f - 0.5, 0xd8cbaa, 0.4);
      kit('paperEffigy', 2); kit('paperHorse'); kit('bambooFrame', 4); kit('paperMoney');
      break;
    }
    case 3: { // 棺材鋪：两口棺、斜靠棺盖、刨花
      for (let i = 0; i < 2; i++) {
        c.gx('lacquer', 0.62, 0.46, 2.0, -0.6 + i * 0.9, 0.23, f + 0.3, LACQ);
        c.gx('lacquer', 0.52, 0.1, 1.86, -0.6 + i * 0.9, 0.5, f + 0.3, shade(LACQ, 1.35));
      }
      c.gx('lacquer', 0.56, 1.9, 0.1, 0.75, 0.95, f - 0.1, shade(LACQ, 1.2));
      for (let i = 0; i < 4; i++) c.gx('wood', 0.1, 0.03, 0.4, -1.0 + i * 0.12, 0.02, f + 1.2, 0x8a7a5c, i * 0.7);
      kit('coffin', 2); kit('coffinLid'); kit('shavings', 4);
      break;
    }
    case 4: { // 義莊：停尸板、白布、香炉、长明灯
      for (let i = 0; i < 2; i++) {
        c.gx('wood', 0.9, 0.12, 2.1, -0.5, 0.42, f + 1.0 + i * 1.4, WOOD_WEATHER);
        c.gx('fabric', 0.86, 0.1, 1.8, -0.5, 0.54, f + 1.0 + i * 1.4, 0xd8d2c4);
        c.gx('fabric', 0.5, 0.06, 0.5, -0.5, 0.62, f + 0.6 + i * 1.4, 0xcfc8b8);
        for (let s = -1; s <= 1; s += 2) c.gx('wood', 0.1, 0.42, 0.1, -0.5 + s * 0.4, 0.21, f + 0.2 + i * 1.4, WOOD_DARK);
      }
      c.gc('metal', 0.28, 0.22, 0.3, 8, 0.9, 0.15, f - 0.2, 0x4e4636);
      for (let i = 0; i < 3; i++) c.gx('glow', 0.02, 0.24, 0.02, 0.86 + i * 0.04, 0.36, f - 0.2, 0xffd9a0);
      c.gc('glow', 0.1, 0.12, 0.22, 8, 1.2, 0.11, f + 0.4, AMBER);
      kit('bier', 2); kit('shroud', 2); kit('censer'); kit('eternalLamp');
      break;
    }
    case 5: { // 城隍分殿：石狮、香炉、鼓、签筒
      for (let s = -1; s <= 1; s += 2) {
        c.gx('wall', 0.36, 0.5, 0.5, s * (c.w * 0.34), 0.25, f - 0.2, STONE_LIGHT);
        c.gx('wall', 0.3, 0.3, 0.32, s * (c.w * 0.34), 0.62, f - 0.24, STONE_LIGHT);
        c.gx('wall', 0.16, 0.14, 0.14, s * (c.w * 0.34), 0.8, f - 0.3, STONE_LIGHT);
      }
      c.gc('metal', 0.4, 0.3, 0.5, 10, 0, 0.25, f - 0.2, 0x4b4438);
      for (let i = 0; i < 3; i++) c.gx('glow', 0.02, 0.3, 0.02, (i - 1) * 0.1, 0.62, f - 0.2, 0xffcf90);
      c.gc('wood', 0.36, 0.36, 0.55, 12, 0.85, 0.28, f - 0.1, 0x7a2c22);
      c.gc('ceramic', 0.09, 0.09, 0.36, 8, -0.85, 0.18, f - 0.1, 0x8a7a5c);
      kit('stoneLion', 2); kit('censer'); kit('drum'); kit('divinationTube');
      break;
    }
    case 6: { // 鬼客棧：酒坛、拴马桩、草料、卦幌
      for (let i = 0; i < 3; i++) c.gc('ceramic', 0.24, 0.3, 0.62, 10, -1.0 + i * 0.42, 0.31, f - 0.2, 0x4a4a52);
      c.gx('wall', 0.16, 0.9, 0.16, c.w * 0.4, 0.45, f + 0.4, STONE);
      c.gx('wood', 0.9, 0.05, 0.05, c.w * 0.4, 0.8, f + 0.4, WOOD_DARK);
      for (let i = 0; i < 3; i++) c.gx('fabric', 0.3, 0.18, 0.36, 0.9 + i * 0.34, 0.09, f + 0.6, 0x9a8a52, i * 0.3);
      c.gx('fabric', 0.5, 1.2, 0.03, -c.w * 0.38, 1.5, f - 0.4, CLOTH_ROT);
      kit('wineJar', 3); kit('horsePost'); kit('fodder', 3); kit('banner');
      break;
    }
    case 7: { // 怨婦樓：妆台、铜镜、晾衣竿、红绫、水盆
      c.gx('wood', 1.0, 0.08, 0.5, -0.5, 0.82, f, WOOD_WEATHER);
      for (let s = -1; s <= 1; s += 2) c.gx('wood', 0.09, 0.82, 0.09, -0.5 + s * 0.44, 0.41, f - 0.18, WOOD_DARK);
      c.gc('metal', 0.26, 0.26, 0.03, 12, -0.5, 1.05, f - 0.1, 0x6d7a86);
      c.gx('metal', 0.3, 0.02, 0.3, -0.5, 0.86, f + 0.1, 0x5a6670);
      c.gx('wood', 2.4, 0.06, 0.06, 0.4, 1.8, f + 0.7, WOOD_DARK);
      for (let i = 0; i < 2; i++) c.gx('fabric', 0.5, 1.0, 0.04, 0.2 + i * 0.9, 1.3, f + 0.7, i ? 0x8a2c34 : 0xb04a58);
      c.gc('ceramic', 0.26, 0.18, 0.2, 10, 1.0, 0.1, f - 0.2, 0x5a6a72);
      kit('dresser'); kit('bronzeMirror'); kit('clothesPole'); kit('redSilk', 2); kit('washBasin');
      break;
    }
    case 8: { // 戲鬼樓：幕布、锣鼓、戏牌、灯架
      c.gx('fabric', 3.0, 2.2, 0.06, 0.2, 1.3, f + 0.5, 0x5c1b24);
      for (let s = -1; s <= 1; s += 2) c.gx('wood', 0.1, 2.6, 0.1, 0.2 + s * 1.5, 1.3, f + 0.5, WOOD_DARK);
      c.gc('metal', 0.4, 0.4, 0.12, 12, -1.1, 0.5, f, 0x8a6a2a);
      c.gx('wood', 0.1, 0.5, 0.1, -1.1, 0.25, f, WOOD_DARK);
      c.gc('wood', 0.3, 0.3, 0.4, 10, 1.2, 0.2, f, 0x7a2c22);
      c.gx('wood', 0.4, 0.9, 0.05, 1.9, 1.0, f - 0.2, 0x6a5a3c);
      for (let i = 0; i < 3; i++) c.gx('glow', 0.14, 0.18, 0.14, -1.6 + i * 0.5, 1.9, f + 0.2, AMBER);
      kit('stageCurtain'); kit('gong'); kit('drum'); kit('playBoard'); kit('lampRack');
      break;
    }
    case 9: { // 雜貨鬼鋪：货箱、陶瓮、秤、竹筐
      for (let i = 0; i < 3; i++) {
        c.gx('wood', 0.5, 0.42, 0.42, -1.0 + i * 0.55, 0.21, f, 0x6a5238, i * 0.15);
        if (i < 2) c.gx('wood', 0.44, 0.34, 0.38, -1.0 + i * 0.55, 0.59, f, 0x74603f, i * 0.15);
      }
      for (let i = 0; i < 2; i++) c.gc('ceramic', 0.24, 0.3, 0.5, 10, 0.7 + i * 0.5, 0.25, f + 0.2, 0x53605a);
      c.gx('metal', 0.9, 0.04, 0.04, 0.7, 0.8, f - 0.3, 0x5a544a);
      c.gc('metal', 0.12, 0.14, 0.06, 10, 0.32, 0.78, f - 0.3, 0x6a6456);
      c.gc('wood', 0.26, 0.2, 0.3, 10, 1.5, 0.15, f - 0.2, 0x8a7448);
      kit('crate', 3); kit('jar', 2); kit('steelyard'); kit('basket');
      break;
    }
    case 10: { // 墳墓宅：坟包、墓碑、纸钱堆、香
      c.gc('wall', 0.6, 0.9, 0.7, 10, -0.6, 0.2, f + 0.6, 0x3a3a30);
      c.gx('wall', 0.5, 0.75, 0.14, -0.6, 0.38, f + 1.1, 0x4a4a42);
      c.gx('glow', 0.16, 0.05, 0.02, -0.6, 0.5, f + 1.18, BLOOD);
      for (let i = 0; i < 3; i++) c.gx('fabric', 0.22, 0.03, 0.22, 0.6 + i * 0.12, 0.02 + i * 0.04, f + 0.5, 0xd2c8a8, i * 0.5);
      for (let i = 0; i < 3; i++) c.gx('glow', 0.015, 0.26, 0.015, 0.3 + i * 0.1, 0.13, f + 1.0, 0xffd9a0);
      c.gx('wall', 0.24, 0.22, 0.24, 0.9, 0.11, f - 0.3, STONE);
      kit('graveMound'); kit('tombstone'); kit('paperMoneyPile', 3); kit('incense', 3);
      break;
    }
    default: { // 遊魂廟：香案、香炉、幡杆、签筒、供果
      c.gx('wood', 1.6, 0.1, 0.7, 0.2, 0.72, f, WOOD_WEATHER);
      for (let s = -1; s <= 1; s += 2) c.gx('wood', 0.12, 0.72, 0.12, 0.2 + s * 0.66, 0.36, f - 0.24, WOOD_DARK);
      c.gc('metal', 0.3, 0.24, 0.34, 10, 0.2, 0.94, f, 0x4b4438);
      for (let i = 0; i < 3; i++) c.gx('glow', 0.02, 0.3, 0.02, 0.14 + i * 0.06, 1.14, f, 0xffcf90);
      for (let i = 0; i < 3; i++) c.gc('ceramic', 0.1, 0.12, 0.12, 8, -0.5 + i * 0.24, 0.82, f + 0.16, 0xb8734a);
      c.gx('wood', 0.12, 3.2, 0.12, 1.2, 1.6, f + 0.6, WOOD_DARK);
      c.gx('fabric', 0.56, 1.5, 0.04, 1.2, 2.2, f + 0.6, 0x2a5c42);
      c.gc('ceramic', 0.08, 0.08, 0.34, 8, -1.0, 0.17, f, 0x8a7a5c);
      kit('offeringTable'); kit('censer'); kit('bannerPole'); kit('banner'); kit('divinationTube'); kit('offeringFruit', 3);
      break;
    }
  }
}
