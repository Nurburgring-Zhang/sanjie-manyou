import { Baker, SignMesher, SignAtlas, shade } from '../city/bake';
import { RNG } from '../core/rng';
import { UNDER } from './underworld';

/**
 * 丰都鬼城街区底景：冥土大地、青石街巷、街灯幡旗、界墙牌坊与街面杂物。
 * 90 座鬼铺此前散落在幽冥虚空上（地府主地块只有 760×400），本模块把街区垫实。
 */
export const FENGDU = {
  x0: 260,
  z0: 10,
  colGap: 40,
  rowGap: 30,
  cols: 15,
  rows: 6,
  edgeX0: 190,
  edgeX1: 890,
  edgeZ0: -10,
  edgeZ1: 190,
};
/** 主街（两侧对望的铺面）与后巷（背靠背的窄巷）分档 */
const LANE_MAIN_W = 16;
const LANE_ALLEY_W = 9;
/** 街尾收口位置：机位在 x=240 朝 +x 看，丰都街面雾下 ~230m 外已读不清，收口必须落在 160m 处 */
const STREET_END_X = 400;

const EARTH = 0x211a20;
const PAVE = 0x39333d;
const PAVE_LIGHT = 0x4b4450;
const CURB = 0x585062;
const DITCH = 0x120e12;
const WALL = 0x241a22;
const STONE = 0x2c2a32;
const PHOS = 0x3dff9c;
const RED = 0xff3a4a;
const ICE = 0xbaffef;

export function buildFengduGround(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  const y = UNDER.y;
  const { x0, z0, colGap, rowGap, cols, rows, edgeX0, edgeX1, edgeZ0, edgeZ1 } = FENGDU;
  const cx = (edgeX0 + edgeX1) / 2;
  const cz = (edgeZ0 + edgeZ1) / 2;
  const W = edgeX1 - edgeX0;
  const D = edgeZ1 - edgeZ0;

  // ---- 冥土远景：一圈暗地压住天空底色，鬼城不再悬在橙色虚空上 ----
  b.cyl('ground', 9000, 9000, 0.8, 36, 0, y - 1.6, 0, 0x150d13);
  // ---- 城区台地 ----
  b.box('ground', W, 0.8, D, cx, y - 0.4, cz, EARTH);
  b.box('ground', W - 8, 0.2, D - 8, cx, y + 0.05, cz, shade(EARTH, 1.15));

  // ---- 街巷：东西向六道 + 南北向七道，路心引路石、两侧路缘与明沟 ----
  const lanesZ: number[] = [];
  const mainLanes: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    const z = z0 + rowGap * r + rowGap / 2;
    lanesZ.push(z);
    if (r % 2 === 0) mainLanes.push(z);
  }
  for (let r = 0; r < lanesZ.length; r++) {
    const z = lanesZ[r];
    const lw = r % 2 === 0 ? LANE_MAIN_W : LANE_ALLEY_W;
    b.box('ground', W, 0.14, lw, cx, y + 0.12, z, PAVE);
    if (r % 2 === 0) b.box('ground', W, 0.05, 3.2, cx, y + 0.2, z, PAVE_LIGHT);
    if (r % 2 === 0) {
      for (const s of [-1, 1]) {
        b.box('ground', W, 0.22, 1.1, cx, y + 0.16, z + s * (lw / 2 + 0.5), CURB);
        b.box('ground', W, 0.16, 1.3, cx, y + 0.02, z + s * (lw / 2 + 1.7), DITCH);
        b.kit('fengdu.curb', 1, y);
        b.kit('fengdu.ditch', 1, y);
      }
    }
    b.kit('fengdu.lane', 1, y);
  }
  const lanesX: number[] = [];
  for (let c = 0; c < cols - 1; c++) {
    if (c % 2) continue;
    lanesX.push(x0 + colGap * c + colGap / 2);
  }
  for (const x of lanesX) {
    b.box('ground', 14, 0.14, D - 20, x, y + 0.12, cz, PAVE);
    b.box('ground', 2.6, 0.05, D - 20, x, y + 0.2, cz, PAVE_LIGHT);
    for (const s of [-1, 1]) {
      b.box('ground', 1.0, 0.22, D - 20, x + s * 7.4, y + 0.16, cz, CURB);
      b.box('ground', 1.2, 0.16, D - 20, x + s * 8.6, y + 0.02, cz, DITCH);
    }
    b.kit('fengdu.lane', 1, y);
  }

  // ---- 街灯：石座 + 木柱 + 铁笼 + 鬼火 ----
  for (const z of mainLanes) {
    for (let x = edgeX0 + 30; x <= edgeX1 - 26; x += 40) {
      for (const s of [-1, 1]) {
        const lx = x + (s > 0 ? 11 : -11);
        const lz = z + s * 7.6;
        b.box('wall', 0.7, 0.32, 0.7, lx, y + 0.16, lz, STONE);
        b.cyl('wood', 0.1, 0.14, 3.5, 6, lx, y + 1.9, lz, 0x1c141a);
        b.box('metal', 0.34, 0.6, 0.34, lx, y + 3.9, lz, 0x2a2622);
        b.box('glow', 0.26, 0.44, 0.26, lx, y + 3.9, lz, ((x / 40) | 0) % 3 === 0 ? RED : PHOS);
        b.box('metal', 0.42, 0.06, 0.42, lx, y + 4.24, lz, 0x3a342c);
        b.box('metal', 0.06, 0.4, 0.06, lx, y + 4.5, lz, 0x2a2622);
        b.kit('fengdu.streetLamp', 1, y + 3.9);
      }
    }
  }

  // ---- 招魂幡：长街两侧高幡，破布低垂 ----
  for (const z of mainLanes) {
    for (let k = 0; k < 5; k++) {
      const px = edgeX0 + 90 + k * ((W - 180) / 4) + rng.range(-12, 12);
      const pz = z + (k % 2 ? 9.6 : -9.6);
      b.cyl('wood', 0.08, 0.12, 5.2, 6, px, y + 2.6, pz, 0x201820);
      b.box('fabric', 0.9, 2.6, 0.05, px + 0.5, y + 4.0, pz, k % 2 ? 0x2a5c42 : 0x5c1b24);
      b.box('metal', 0.16, 0.16, 0.16, px + 0.95, y + 2.6, pz, 0x5c4a32);
      b.kit('fengdu.soulBanner', 1, y + 4);
    }
  }

  // ---- 枯柏：鬼城无叶枯木，枝干扭曲 ----
  for (let k = 0; k < 34; k++) {
    const px = rng.range(edgeX0 + 26, edgeX1 - 26);
    const pz = rng.range(edgeZ0 + 26, edgeZ1 - 26);
    if (lanesZ.some((z) => Math.abs(pz - z) < 10) || lanesX.some((x) => Math.abs(px - x) < 8)) continue;
    const th = rng.range(3.4, 5.6);
    b.cyl('wood', 0.16, 0.34, th, 6, px, y + th / 2, pz, 0x1a1418);
    for (let br = 0; br < 4; br++) {
      const a = rng.range(0, 6.28);
      const by = y + th * (0.5 + br * 0.12);
      b.box('wood', 0.12, rng.range(1.2, 2.2), 0.12, px + Math.cos(a) * 0.7, by, pz + Math.sin(a) * 0.7, 0x1a1418, a, 0, 0.5 + rng.range(0, 0.3));
    }
    b.kit('fengdu.deadTree', 1, y + th / 2);
  }

  // ---- 界墙：南北两道阴砖墙 + 望柱 + 墙头鬼火 ----
  for (const wz of [edgeZ0 + 4, edgeZ1 - 4]) {
    b.box('ash', W, 5.2, 2.0, cx, y + 2.6, wz, WALL);
    b.box('roof', W, 0.5, 3.0, cx, y + 5.4, wz, 0x141018);
    for (let x = edgeX0 + 10; x <= edgeX1 - 10; x += 26) {
      b.box('ash', 1.0, 6.2, 1.4, x, y + 3.1, wz, shade(WALL, 1.2));
      b.box('glow', 0.22, 0.3, 0.22, x, y + 6.5, wz, x % 52 === 0 ? PHOS : RED);
      b.kit('fengdu.wallPost', 1, y + 6);
    }
    b.kit('fengdu.wall', 1, y);
  }
  for (const wx of [edgeX0 + 4, edgeX1 - 4]) {
    b.box('ash', 2.0, 5.2, D - 12, wx, y + 2.6, cz, WALL);
    b.box('roof', 3.0, 0.5, D - 12, wx, y + 5.4, cz, 0x141018);
    b.kit('fengdu.wall', 1, y);
  }

  // ---- 丰都牌坊：四柱三间 + 匾额「豐都」+ 门灯 ----
  const gx = edgeX0 + 30;
  const gz = lanesZ[2];
  for (let c = 0; c < 4; c++) {
    const px = gx + (c - 1.5) * 4.4;
    b.box('ash', 1.3, 9.2, 1.3, px, y + 4.6, gz, 0x2a2028);
    b.box('ash', 1.9, 0.8, 1.9, px, y + 0.4, gz, STONE);
    b.kit('fengdu.paifangPost', 1, y);
  }
  b.box('ash', 17, 1.4, 2.0, gx, y + 9.4, gz, 0x1c1218);
  b.box('roof', 19, 0.9, 3.4, gx, y + 10.3, gz, 0x0f0a10);
  for (const s of [-1, 1]) {
    b.box('ash', 5.4, 1.1, 1.8, gx + s * 6.4, y + 7.4, gz, 0x1c1218);
    b.box('roof', 6.4, 0.7, 3.0, gx + s * 6.4, y + 8.1, gz, 0x0f0a10);
    b.box('glow', 0.5, 0.8, 0.5, gx + s * 8.6, y + 6.6, gz, s < 0 ? RED : PHOS);
  }
  sg.quad(atlas.text('fengdu-gate', '豐都', 300, 110, {
    color: '#b8ffd8', glow: '#3dff9c', bg: 'rgba(4,8,6,0.92)', border: 'rgba(61,255,156,.9)', fontPx: 78,
  }), 6.4, 2.3, gx, y + 8.4, gz + 1.06, 0);
  b.kit('fengdu.paifang', 1, y + 9);

  // ---- 街口石狮与香炉供桌 ----
  for (const [sx, sz] of [[edgeX0 + 46, gz + 9], [edgeX0 + 46, gz - 9]] as const) {
    b.box('wall', 0.9, 0.7, 1.0, sx, y + 0.35, sz, STONE);
    b.box('wall', 0.7, 0.8, 0.8, sx, y + 1.1, sz, shade(STONE, 1.15));
    b.box('wall', 0.5, 0.45, 0.55, sx, y + 1.7, sz, shade(STONE, 1.25));
    b.box('glow', 0.09, 0.09, 0.06, sx, y + 1.78, sz + 0.3, RED);
    b.kit('fengdu.stoneLion', 1, y + 1);
  }
  for (const x of lanesX) {
    for (const z of [lanesZ[0], lanesZ[lanesZ.length - 1]]) {
      b.box('wood', 1.8, 0.12, 0.8, x, y + 0.74, z, 0x2c2018);
      for (const s of [-1, 1]) b.box('wood', 0.12, 0.72, 0.12, x + s * 0.72, y + 0.36, z, 0x1c1414);
      b.cyl('metal', 0.28, 0.22, 0.32, 10, x, y + 0.96, z, 0x3a342a);
      for (let i = 0; i < 3; i++) b.box('glow', 0.02, 0.3, 0.02, x - 0.1 + i * 0.1, y + 1.15, z, 0xffcf90);
      b.kit('fengdu.offeringTable', 1, y + 0.9);
    }
  }

  // ---- 鬼市棚：布篷摊位，撑起街市密度 ----
  const stalls = 14;
  for (let k = 0; k < stalls; k++) {
    const lane = mainLanes[k % mainLanes.length];
    const px = rng.range(edgeX0 + 60, edgeX1 - 60);
    const pz = lane + (k % 2 ? 5.4 : -5.4);
    b.box('wood', 2.4, 0.1, 1.5, px, y + 0.86, pz, 0x3a2c22);
    for (const s of [-1, 1]) {
      b.box('wood', 0.09, 0.86, 0.09, px + s * 1.05, y + 0.43, pz + 0.6, 0x241a12);
      b.box('wood', 0.09, 0.86, 0.09, px + s * 1.05, y + 0.43, pz - 0.6, 0x241a12);
    }
    b.box('fabric', 3.0, 0.06, 2.2, px, y + 2.3, pz, k % 3 === 0 ? 0x2a5c42 : k % 3 === 1 ? 0x5c1b24 : 0x3a3448, 0, 0.14);
    for (const s of [-1, 1]) b.box('wood', 0.08, 2.3, 0.08, px + s * 1.35, y + 1.15, pz - 0.9, 0x201820);
    for (let i = 0; i < 3; i++) b.box('ceramic', 0.16, 0.14, 0.16, px - 0.6 + i * 0.6, y + 0.98, pz, 0x53605a);
    b.box('glow', 0.22, 0.3, 0.22, px + 1.35, y + 1.95, pz - 0.9, k % 2 ? PHOS : RED);
    b.kit('fengdu.ghostStall', 1, y + 1);
  }

  // ---- 街面杂物：骨堆、陶罐、破车、纸钱 ----
  for (let k = 0; k < 60; k++) {
    const px = rng.range(edgeX0 + 20, edgeX1 - 20);
    const pz = rng.range(edgeZ0 + 20, edgeZ1 - 20);
    if (rng.chance(0.5)) {
      const n = 2 + ((rng.next() * 3) | 0);
      for (let i = 0; i < n; i++) {
        b.box('wall', 0.1, 0.5, 0.1, px + rng.range(-0.5, 0.5), y + 0.2, pz + rng.range(-0.5, 0.5), 0xcfc7ae, rng.range(0, 3.14), 0, rng.range(-1.2, 1.2));
      }
      b.kit('fengdu.bonePile', 1, y + 0.2);
    } else {
      b.cyl('ceramic', 0.22, 0.28, 0.4, 9, px, y + 0.2, pz, 0x4a524c);
      b.kit('fengdu.potShard', 1, y + 0.2);
    }
  }
  for (let k = 0; k < 6; k++) {
    const lane = mainLanes[k % mainLanes.length];
    const px = rng.range(edgeX0 + 80, edgeX1 - 80);
    const pz = lane + (k % 2 ? 3.4 : -3.4);
    b.box('wood', 1.6, 0.12, 0.9, px, y + 0.55, pz, 0x2a2018, rng.range(-0.6, 0.6), 0.18);
    for (const s of [-1, 1]) b.cyl('wood', 0.5, 0.5, 0.12, 10, px + s * 0.8, y + 0.5, pz, 0x1c1414, 0, 0, Math.PI / 2);
    b.kit('fengdu.brokenCart', 1, y + 0.5);
  }
  for (let k = 0; k < 50; k++) {
    const px = rng.range(edgeX0 + 16, edgeX1 - 16);
    const pz = rng.range(edgeZ0 + 16, edgeZ1 - 16);
    b.box('glow', 0.16, 0.02, 0.16, px, y + 0.16, pz, 0xd8d0b0, rng.range(0, 3.14));
    b.kit('fengdu.paperScrap', 1, y + 0.16);
  }
  // 街心鬼火（贴地冷光斑，压住大片暗地）
  for (let k = 0; k < 26; k++) {
    const lane = mainLanes[k % mainLanes.length];
    const px = rng.range(edgeX0 + 40, edgeX1 - 40);
    b.cyl('glow', 0.7, 1.1, 0.03, 10, px, y + 0.2, lane + rng.range(-5, 5), ICE, 0, 0, 0, true);
    b.kit('fengdu.wispLight', 1, y + 0.2);
  }
  // ---- 鬼市街面：每 12–18m 一组市井件，左右交替，街心留 11m 以上通行带 ----
  const endZ = mainLanes[1] ?? lanesZ[lanesZ.length - 1];
  buildStreetMarket(b, y, mainLanes, edgeX0, edgeX1, endZ);
  // ---- 地面磨损：石缝、碎裂石板、干涸血渍与香灰，全部贴地薄板 ----
  buildLaneWear(b, y, mainLanes, edgeX0, edgeX1);
  // ---- 七道南北巷：巷口小牌坊 + 巷内市井件（独立 LCG，不动共享 rng 流） ----
  buildLaneAlleys(b, y, lanesX, lanesZ, edgeZ0, edgeZ1);
  // ---- 主街街心：中线两侧压街砖带 + 每 30m 的街心界石 / 引魂灯座 ----
  buildStreetAxis(b, y, mainLanes, lanesX, edgeX0, edgeX1, STREET_END_X, endZ);
  // ---- 街尾收口：过街城门 + 层叠雾墙，把长街透视收在实体上 ----
  buildStreetGate(b, sg, atlas, y, STREET_END_X, endZ);
  buildStreetFog(b, y, STREET_END_X, endZ);
  // ---- WS-34 门楼与街市构件（8 件 / 8 座）：三道主街街口四门 + 巷口井亭/挂符梁/门前碑/无名神龛 ----
  buildFengduGates(b, sg, atlas, y);
  // ---- v2：沿主街补招牌 / 幌子 / 灯笼串 / 路边货摊（街面五件缺三件的补丁） ----
  buildLaneSigns(b, sg, atlas, y, mainLanes, edgeX0, edgeX1);
}

/**
 * v2 街面招幌与灯笼串：旧版三道主街只有棚摊、路灯与幡旗，两侧铺面没有招牌、没有幌子、
 * 也没有一串灯笼——「店铺要有招牌/幌子/柜台/货物/灯笼」五件里缺三件。
 * 本函数沿主街按固定步距补：挑杆幌子（布招+灯笼）/ 匾额招牌 / 横跨街心的灯笼串 / 路边货摊（柜台+货物）。
 * 位置取街沿 ±8.6m（主街半宽 8m），不侵入街心通行带，也不依赖 90 座鬼铺的 rng 抖动坐标。
 */
function buildLaneSigns(b: Baker, sg: SignMesher, atlas: SignAtlas, y: number, mainLanes: number[], x0: number, x1: number): void {
  const NAMES = ['賭鬼坊', '餓鬼食肆', '紙扎鋪', '棺材鋪', '鬼客棧', '雜貨鬼鋪', '義莊', '城隍分殿'];
  const top = y + 0.19;
  let n = 0;
  for (const z of mainLanes) {
    for (let x = x0 + 20; x <= Math.min(x1, 400); x += 17) {
      const side = (n % 2 === 0) ? 1 : -1;
      const pz = z + side * 8.6;
      // 挑杆幌子：立柱 + 挑臂 + 布招 + 挑灯
      b.cyl('wood', 0.11, 0.15, 3.6, 6, x, top + 1.8, pz, 0x241c16);
      b.box('wood', 1.4, 0.1, 0.1, x - side * 0.7, top + 3.5, pz, 0x3a2c22);
      b.box('fabric', 0.64, 1.5, 0.05, x - side * 1.2, top + 2.78, pz, n % 3 === 0 ? 0x8a1a1a : 0x3a2c22);
      b.box('glow', 0.22, 0.3, 0.22, x - side * 0.7, top + 3.14, pz, n % 2 ? 0x3dff9c : 0xffb347);
      // 匾额招牌：每三根挂一块
      if (n % 3 === 0) {
        b.box('ash', 2.1, 0.74, 0.12, x, top + 4.02, pz, 0x2a2622);
        b.box('wood', 2.3, 0.12, 0.16, x, top + 4.44, pz, 0x3a2c22);
        sg.quad(atlas.text('fdsign' + n, NAMES[Math.floor(n / 3) % NAMES.length], 224, 80, {
          color: '#e8e3d5', bg: 'rgba(42,38,34,0.95)', border: 'rgba(201,179,128,.55)', fontPx: 46,
        }), 1.9, 0.62, x, top + 4.02, pz + side * 0.09, side > 0 ? 0 : Math.PI);
      }
      n++;
    }
    // 横跨街心的灯笼串：每 34m 一道麻绳 + 五盏灯笼
    for (let x = x0 + 30; x <= Math.min(x1, 400); x += 34) {
      b.box('wood', 0.05, 0.05, 17.4, x, top + 4.62, z, 0x2a201a);
      for (let k = 0; k < 5; k++) {
        const lz = z - 6.8 + k * 3.4;
        b.cyl('metal', 0.03, 0.03, 0.32, 4, x, top + 4.45, lz, 0x3a3a42);
        b.box('glow', 0.34, 0.42, 0.34, x, top + 4.14, lz, k % 2 ? 0xffb347 : 0x8a1a1a);
      }
    }
    // 路边货摊：柜台 + 货物三件 + 布篷（与挑杆错开半拍，避免同点叠件）
    for (let x = x0 + 30; x <= Math.min(x1, 400); x += 34) {
      const side = (Math.round((x - x0) / 34) % 2 === 0) ? -1 : 1;
      const pz = z + side * 7.2;
      b.box('wood', 2.4, 0.78, 0.86, x, top + 0.39, pz, 0x3a2c22);
      b.box('wood', 2.6, 0.1, 1.0, x, top + 0.82, pz, 0x4a3c33);
      for (let k = 0; k < 3; k++) {
        b.cyl('ceramic', 0.19, 0.15, 0.34, 7, x - 0.7 + k * 0.7, top + 1.03, pz + 0.1, k % 2 ? 0x4a3c33 : 0x2e3436);
        b.box('glow', 0.1, 0.05, 0.1, x - 0.7 + k * 0.7, top + 1.21, pz + 0.1, k % 2 ? 0xc9b380 : 0x3dff9c);
      }
      for (const s of [-1, 1]) b.cyl('wood', 0.06, 0.07, 2.5, 5, x + s * 1.15, top + 1.25, pz - side * 0.5, 0x241c16);
      b.box('fabric', 2.7, 0.08, 1.5, x, top + 2.48, pz - side * 0.2, 0x3a2c22);
      b.box('glow', 0.2, 0.26, 0.2, x + 1.15, top + 2.2, pz - side * 0.5, 0xffb347);
    }
  }
  // 铺面檐灯与门招：鬼铺坐标带 ±5m rng 抖动（在 expansion.ts 里生成，本文件碰不到），
  // 故按街区网格（x=260+i*40，行距 30）铺一排檐灯与招板——不改铺面，只把「一排店」的存在照亮。
  const X0 = 260, COL = 40;
  for (const z of mainLanes) {
    for (const side of [-1, 1]) {
      const fz = z + side * 9.2;
      for (let i = 0; i < 4; i++) {
        const x = X0 + i * COL;
        for (const dx of [-8, 8]) {
          b.box('metal', 0.06, 0.3, 0.06, x + dx, top + 3.5, fz, 0x2a2622);
          b.box('glow', 0.36, 0.44, 0.36, x + dx, top + 3.2, fz, (i + (side > 0 ? 1 : 0)) % 2 ? 0xffb347 : 0x8a1a1a);
          b.box('metal', 0.42, 0.06, 0.42, x + dx, top + 2.95, fz, 0x2a2622);
        }
        b.box('ash', 2.4, 0.66, 0.1, x, top + 3.2, fz - side * 0.12, 0x22201e);
        b.box('glow', 2.1, 0.06, 0.05, x, top + 3.44, fz - side * 0.18, 0xc9b380);
        // 铺面透光板：黑场最深处只有自发光能读出来，给每格铺面一块暖光窗板 + 门槛灯带
        b.box('glow', 2.6, 1.5, 0.05, x, top + 1.75, fz - side * 0.22, 0x3a2c18);
        b.box('glow', 1.9, 0.9, 0.05, x, top + 1.75, fz - side * 0.26, 0x6b4a1e);
        b.box('glow', 2.2, 0.08, 0.06, x, top + 0.32, fz - side * 0.2, 0xffb347);
      }
    }
  }
  b.kit('fengdu.sign', n, top + 3.5);
}


type BoxGroup = Parameters<Baker['box']>[0];

/** 局部确定性随机：不触碰共享 rng 流，否则下游 90 座鬼铺坐标整体漂移 */
function h01(a: number, b: number, salt: number): number {
  let s = (Math.imul((Math.round(a * 8) ^ Math.round(b * 16)) ^ salt, 2246822519) >>> 0) || 1;
  s = (Math.imul(s ^ (s >>> 15), 2246822519) + 374761393) >>> 0;
  s = (Math.imul(s ^ (s >>> 13), 3266489917) + 668265263) >>> 0;
  return s / 4294967296;
}

/**
 * 沿主街摆市井件：招魂幡、纸钱堆、香炉、油灯架、骨灯、判官案、枷锁架、引路灯八类轮转。
 * 落位在离街心 6.3–6.6m 的路缘带（通行带 ≥11m），与 7.6m 处的既有街灯错开、互不相撞。
 */
function buildStreetMarket(b: Baker, y: number, lanes: number[], x0: number, x1: number, endZ: number): void {
  const laneTop = y + 0.19;
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    let px = x0 + 34;
    for (let i = 0; px < x1 - 44; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const dz = 6.45 + (h01(i, li, 31) - 0.5) * 0.3;
      const blocked = lane === endZ && px > STREET_END_X - 10 && px < STREET_END_X + 42;
      if (!blocked) {
        streetProp(b, laneTop, px, lane + side * dz, side, (i * 3 + li * 5) % 8, i * 131 + li * 977 + 11);
        b.kit('fengdu.streetProp', 1, y);
      }
      px += 12 + h01(i, li, 61) * 6;
    }
  }
}

function streetProp(b: Baker, y: number, px: number, pz: number, side: number, kind: number, seed: number): void {
  const ry = side > 0 ? Math.PI : 0;
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const r = (k: number): number => h01(seed, k, 7919);
  const at = (lx: number, lz: number): [number, number] => [px + lx * cs + lz * sn, pz - lx * sn + lz * cs];
  const bx = (g: BoxGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, pry = 0, prx = 0, prz = 0): void => {
    const [wx, wz] = at(lx, lz);
    b.box(g, w, h, d, wx, y + ly, wz, hex, ry + pry, prx, prz);
  };
  const cy = (g: BoxGroup, rt: number, rb: number, hh: number, seg: number, lx: number, ly: number, lz: number, hex: number, prx = 0, prz = 0, open = false): void => {
    const [wx, wz] = at(lx, lz);
    b.cyl(g, rt, rb, hh, seg, wx, y + ly, wz, hex, ry, prx, prz, open);
  };
  switch (kind) {
    case 0: { // 招魂幡：石座木杆，横臂垂破布
      const cloth = r(1) > 0.5 ? 0x5c1b24 : 0x24483a;
      bx('ash', 0.7, 0.3, 0.7, 0, 0.15, 0, 0x2c2a33);
      bx('ash', 0.52, 0.14, 0.52, 0, 0.37, 0, 0x3b3746);
      cy('wood', 0.055, 0.085, 4.9, 6, 0, 2.45, 0, 0x1e1720);
      bx('wood', 0.07, 0.07, 1.25, 0, 4.72, 0.5, 0x241c1a);
      bx('wood', 0.1, 0.1, 0.1, 0, 4.72, 0.06, 0x3a2c22);
      bx('fabric', 0.6, 2.0, 0.035, 0, 3.7, 0.98, cloth);
      for (let i = 0; i < 3; i++) bx('fabric', 0.14 + r(i + 2) * 0.1, 0.34, 0.03, -0.2 + i * 0.2, 2.55, 0.98, shade(cloth, 0.8));
      bx('metal', 0.12, 0.14, 0.12, 0, 4.86, 0.98, 0x4a4030);
      bx('glow', 0.09, 0.12, 0.09, 0, 4.96, 0.98, r(9) > 0.5 ? PHOS : RED);
      b.kit('fengdu.soulFlag', 1, y + 3.7);
      break;
    }
    case 1: { // 纸钱堆：纸锭叠压、竹筐、散落纸钱
      const n = 4 + ((r(1) * 3) | 0);
      for (let i = 0; i < n; i++) {
        const a = r(i + 2);
        bx('fabric', 0.46 - i * 0.03, 0.035, 0.32, (a - 0.5) * 0.3, 0.04 + i * 0.045, (r(i + 9) - 0.5) * 0.25, shade(0xd2c49c, 0.82 + a * 0.3), (a - 0.5) * 0.8);
      }
      cy('ceramic', 0.24, 0.2, 0.3, 9, 0.62, 0.15, 0.15, 0x4c564e);
      for (let i = 0; i < 3; i++) bx('fabric', 0.16, 0.02, 0.12, -0.5 + i * 0.28, 0.02, 0.42 + i * 0.1, 0xc8b894, r(i) * 1.4);
      bx('glow', 0.06, 0.02, 0.06, 0.1, 0.2, 0.2, 0x6a6a52);
      b.kit('fengdu.paperPile', 1, y + 0.2);
      break;
    }
    case 2: { // 香炉：石台、铜炉、香灰、残香与供果
      bx('ash', 0.78, 0.4, 0.78, 0, 0.2, 0, 0x2f2c36);
      bx('ash', 0.66, 0.08, 0.66, 0, 0.44, 0, 0x413d4a);
      cy('metal', 0.3, 0.21, 0.34, 10, 0, 0.65, 0, 0x4a4238);
      cy('metal', 0.33, 0.3, 0.07, 10, 0, 0.84, 0, 0x554a3c);
      cy('ash', 0.24, 0.24, 0.04, 10, 0, 0.86, 0, 0x6a6670);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + r(i);
        bx('glow', 0.018, 0.44, 0.018, Math.cos(a) * 0.08, 1.12, Math.sin(a) * 0.08, 0xffcf90);
        bx('glow', 0.03, 0.05, 0.03, Math.cos(a) * 0.08, 1.36, Math.sin(a) * 0.08, 0xff7a2d);
      }
      for (let i = 0; i < 2; i++) cy('ceramic', 0.1, 0.09, 0.16, 8, -0.46 + i * 0.92, 0.52, 0.1, 0xb8734a);
      b.kit('fengdu.censerStone', 1, y + 0.6);
      break;
    }
    case 3: { // 油灯架：木框三层油盏，焰口朝街
      bx('ash', 1.5, 0.16, 0.5, 0, 0.08, 0, 0x2f2c36);
      for (const s of [-1, 1]) bx('wood', 0.12, 2.3, 0.12, s * 0.66, 1.15, 0, 0x241b16);
      bx('wood', 1.44, 0.09, 0.12, 0, 1.9, 0, 0x2e2218);
      bx('wood', 1.44, 0.07, 0.1, 0, 1.05, 0, 0x2e2218);
      for (let i = -1; i <= 1; i++) {
        cy('metal', 0.15, 0.1, 0.14, 8, i * 0.44, 1.99, 0, 0x4a4238);
        bx('glow', 0.1, 0.14, 0.1, i * 0.44, 2.12, 0, 0xffb45e);
        bx('glow', 0.12, 0.03, 0.12, i * 0.44, 2.2, 0, 0x7a5a30);
      }
      b.kit('fengdu.oilLampStand', 1, y + 1.9);
      break;
    }
    case 4: { // 骨灯：股骨围笼，灯芯透绿
      bx('ash', 0.62, 0.16, 0.62, 0, 0.08, 0, 0x2c2a33);
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2) + 0.4;
        bx('ash', 0.09, 0.72, 0.09, Math.cos(a) * 0.24, 0.48, Math.sin(a) * 0.24, 0xb9ae94, a);
      }
      cy('ash', 0.32, 0.3, 0.09, 9, 0, 0.72, 0, 0xa89e86, 0, 0, true);
      cy('glow', 0.17, 0.16, 0.44, 8, 0, 1.0, 0, PHOS);
      cy('ash', 0.28, 0.34, 0.1, 9, 0, 1.26, 0, 0xa89e86, 0, 0, true);
      bx('ash', 0.14, 0.16, 0.14, 0, 1.4, 0, 0xc4baa0);
      b.kit('fengdu.boneLantern', 1, y + 1.0);
      break;
    }
    case 5: { // 判官案：公案、案卷、印匣、惊堂木与两侧灯
      bx('lacquer', 1.5, 0.12, 0.66, 0, 0.86, 0.1, 0x351a17);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx('wood', 0.1, 0.82, 0.1, sx * 0.64, 0.41, 0.1 + sz * 0.26, 0x241b16);
      bx('lacquer', 1.34, 0.42, 0.06, 0, 0.56, 0.4, 0x3d1f1c);
      cy('fabric', 0.06, 0.06, 0.42, 8, -0.36, 0.94, 0.02, 0xcfc4a6, 0, Math.PI / 2);
      cy('fabric', 0.06, 0.06, 0.38, 8, -0.06, 0.94, 0.06, 0xc8bda0, 0, Math.PI / 2);
      bx('fabric', 0.34, 0.03, 0.24, 0.3, 0.94, 0.1, 0xd8cfb2, 0.2);
      bx('metal', 0.14, 0.16, 0.14, 0.56, 0.99, -0.06, 0x6a5a3a);
      bx('metal', 0.05, 0.1, 0.05, 0.56, 1.12, -0.06, 0x7a6a44);
      bx('wood', 0.2, 0.05, 0.07, 0.06, 0.95, -0.16, 0x5a4228);
      for (const s of [-1, 1]) {
        bx('wood', 0.06, 1.6, 0.06, s * 0.94, 0.8, -0.24, 0x241b16);
        bx('glow', 0.14, 0.2, 0.14, s * 0.94, 1.7, -0.24, s < 0 ? RED : PHOS);
        bx('metal', 0.16, 0.05, 0.16, s * 0.94, 1.83, -0.24, 0x4a4030);
      }
      bx('wood', 0.44, 0.06, 0.4, 0.2, 0.44, -0.5, 0x2e2218);
      for (const s of [-1, 1]) bx('wood', 0.06, 0.44, 0.06, 0.2 + s * 0.16, 0.22, -0.5, 0x241b16);
      b.kit('fengdu.judgeDesk', 1, y + 0.9);
      break;
    }
    case 6: { // 枷锁架：石柱横梁挂枷，铁链垂地
      for (const s of [-1, 1]) {
        bx('ash', 0.2, 1.95, 0.2, s * 0.72, 0.98, 0, 0x2f2c36);
        bx('ash', 0.3, 0.16, 0.3, s * 0.72, 0.08, 0, 0x3b3746);
        bx('wood', 0.1, 0.7, 0.1, s * 0.9, 0.42, 0, 0x241b16, 0, 0, s * 0.5);
      }
      bx('ash', 1.78, 0.18, 0.24, 0, 2.04, 0, 0x3b3746);
      for (let i = 0; i < 2; i++) {
        const lx = -0.34 + i * 0.72;
        bx('wood', 0.86, 0.05, 0.26, lx, 1.78, 0.02, 0x5a4228);
        bx('wood', 0.34, 0.12, 0.26, lx - 0.28, 1.68, 0.02, 0x5a4228);
        bx('wood', 0.34, 0.12, 0.26, lx + 0.28, 1.68, 0.02, 0x5a4228);
        for (let k = 0; k < 4; k++) bx('metal', 0.05, 0.09, 0.05, lx, 1.5 - k * 0.11, 0.02 + (k % 2 ? 0.03 : -0.03), 0x4a4650);
      }
      b.kit('fengdu.cangueRack', 1, y + 1.6);
      break;
    }
    default: { // 引路灯：石灯柱，冷芯照地
      bx('ash', 0.56, 0.3, 0.56, 0, 0.15, 0, 0x2c2a33);
      bx('ash', 0.34, 1.35, 0.34, 0, 0.98, 0, 0x35323e);
      bx('ash', 0.5, 0.1, 0.5, 0, 1.7, 0, 0x413d4a);
      bx('glow', 0.24, 0.34, 0.24, 0, 1.94, 0, ICE);
      for (const s of [-1, 1]) bx('ash', 0.06, 0.4, 0.06, s * 0.14, 1.94, 0.14, 0x413d4a);
      bx('ash', 0.46, 0.12, 0.46, 0, 2.17, 0, 0x35323e);
      bx('ash', 0.16, 0.18, 0.16, 0, 2.3, 0, 0x4a4652);
      cy('glow', 0.8, 0.9, 0.02, 12, 0, 0.205, 0, 0x2a6a5a, 0, 0, true);
      b.kit('fengdu.guideLamp', 1, y + 1.9);
      break;
    }
  }
}

/** 街面磨损层：横向石缝、翘边碎板、干涸血渍与香灰，全部贴在铺装面 +0.01~0.03 */
function buildLaneWear(b: Baker, y: number, lanes: number[], x0: number, x1: number): void {
  const top = y + 0.19;
  const span = x1 - x0 - 12;
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    let px = x0 + 6;
    for (let i = 0; px < x1 - 6; i++) {
      const wdt = 0.1 + h01(i, li, 17) * 0.12;
      b.box('ground', wdt, 0.016, LANE_MAIN_W, px, top + 0.006, lane, 0x1f1c24);
      px += 2.8 + h01(i, li, 29) * 1.8;
    }
    for (const s of [-1, 1]) b.box('ground', span, 0.016, 0.09, (x0 + x1) / 2, top + 0.006, lane + s * 3.2, 0x1f1c24);
    b.kit('fengdu.stoneSeam', 1, top);
    for (let i = 0; i < 90; i++) {
      const bx0 = x0 + 10 + h01(i, li, 71) * (x1 - x0 - 20);
      const bz0 = lane + (h01(i, li, 73) - 0.5) * 13;
      const bw = 0.8 + h01(i, li, 79) * 0.9;
      const bd = 0.7 + h01(i, li, 83) * 0.8;
      const turn = h01(i, li, 89) * 3.14;
      b.box('ground', bw + 0.16, 0.012, bd + 0.16, bx0, top + 0.002, bz0, 0x14121a, turn);
      b.box('ground', bw, 0.02, bd, bx0, top + 0.012, bz0, shade(PAVE_LIGHT, 0.72 + h01(i, li, 97) * 0.5), turn, (h01(i, li, 101) - 0.5) * 0.06, (h01(i, li, 103) - 0.5) * 0.06);
    }
    b.kit('fengdu.brokenSlab', 90, top);
    for (let i = 0; i < 26; i++) {
      const bx0 = x0 + 12 + h01(i, li, 107) * (x1 - x0 - 24);
      const bz0 = lane + (h01(i, li, 109) - 0.5) * 12;
      const rr = 0.6 + h01(i, li, 113) * 1.4;
      b.cyl('ground', rr, rr * 0.86, 0.014, 9, bx0, top + 0.003, bz0, 0x3a1016, h01(i, li, 127) * 3.14);
      b.cyl('ground', rr * 0.5, rr * 0.42, 0.016, 8, bx0 + rr * 0.2, top + 0.004, bz0 - rr * 0.1, 0x240a0e, 0);
    }
    b.kit('fengdu.bloodStain', 26, top);
    for (let i = 0; i < 22; i++) {
      const bx0 = x0 + 14 + h01(i, li, 131) * (x1 - x0 - 28);
      const bz0 = lane + (h01(i, li, 137) - 0.5) * 12;
      const rr = 0.45 + h01(i, li, 139) * 0.7;
      b.cyl('ground', rr, rr * 0.9, 0.012, 8, bx0, top + 0.003, bz0, 0x33303a, 0);
      for (let k = 0; k < 3; k++) b.cyl('ash', 0.08, 0.12, 0.05, 6, bx0 + (h01(k, i, 149) - 0.5) * 0.5, top + 0.028, bz0 + (h01(k, i, 151) - 0.5) * 0.5, 0x4a4650);
      b.box('glow', 0.015, 0.2, 0.015, bx0 + 0.2, top + 0.1, bz0 + 0.1, 0x8a8070);
    }
    b.kit('fengdu.incenseAsh', 22, top);
  }
}

/** 过街城门：两墩一门洞 + 门额匾 + 城楼，落在街面铺装上 */
function buildStreetGate(b: Baker, sg: SignMesher, atlas: SignAtlas, y: number, gx: number, gz: number): void {
  const gy = y + 0.19;
  const PW = 3.2;
  const PH = 11.2;
  b.box('ash', PW + 1.6, 0.34, 15.6, gx, gy + 0.17, gz, 0x332f3a);
  b.kit('fengdu.gateBase', 1, y);
  for (const s of [-1, 1]) {
    const pz = gz + s * 5.5;
    b.box('ash', PW, PH, 2.8, gx, gy + 0.34 + PH / 2, pz, 0x2a2630);
    b.box('ash', PW + 0.5, 0.9, 3.2, gx, gy + 0.8, pz, 0x35313e);
    b.box('ash', PW + 0.4, 0.34, 3.2, gx, gy + 0.34 + PH, pz, 0x413d4a);
    for (let k = 0; k < 5; k++) b.box('ash', 0.12, 1.4, 0.12, gx - PW / 2 - 0.02, gy + 2.2 + k * 1.9, pz, 0x35313e);
    b.kit('fengdu.gatePier', 1, y + 6);
  }
  const arch = [[8.4, 0.6, 6.9], [7.0, 0.55, 7.4], [5.6, 0.5, 7.9]] as const;
  for (const [wz, th, yy] of arch) b.box('ash', PW + 0.2, th, wz, gx, gy + yy, gz, 0x2f2b36);
  b.box('ash', PW + 0.2, 3.1, 8.4, gx, gy + 9.68, gz, 0x2a2630);
  b.kit('fengdu.gateArch', 4, y + 7.5);
  b.box('ash', PW + 0.7, 2.4, 15.4, gx, gy + PH + 1.2, gz, 0x2a2630);
  sg.quad(atlas.text('fengdu-gate-end', '鬼門關', 320, 96, {
    color: '#c8ffe4', glow: '#3dff9c', bg: 'rgba(4,8,6,0.94)', border: 'rgba(61,255,156,.9)', fontPx: 68,
  }), 6.0, 1.05, gx - (PW + 0.7) / 2 - 0.12, gy + PH + 1.2, gz, -Math.PI / 2);
  b.kit('fengdu.gateSign', 1, y + PH + 1.2);
  for (const s of [-1, 1]) {
    const pz = gz + s * 3.9;
    b.box('metal', 0.06, 0.3, 0.06, gx - PW / 2 - 0.15, gy + 6.45, pz, 0x3a3440);
    b.box('glow', 0.2, 0.28, 0.2, gx - PW / 2 - 0.15, gy + 6.16, pz, s < 0 ? RED : PHOS);
    b.box('glow', 0.26, 0.04, 0.26, gx - PW / 2 - 0.15, gy + 6.33, pz, 0x5a4a2a);
  }
  b.kit('fengdu.gateLamp', 2, y + 6.1);
  const ty = gy + PH + 2.4;
  b.box('ash', 5.2, 0.3, 13.2, gx, ty + 0.15, gz, 0x35313e);
  for (const s of [-1, 1]) {
    b.box('ash', 0.34, 0.8, 13.2, gx + s * 2.4, ty + 0.7, gz, 0x2f2b36);
    b.box('ash', 5.2, 0.8, 0.34, gx, ty + 0.7, gz + s * 6.4, 0x2f2b36);
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
    b.box('wood', 0.2, 2.2, 0.2, gx + sx * 2.0, ty + 1.4, gz - 4.6 + k * 3.06, 0x201820);
  }
  b.box('wood', 3.8, 2.0, 12.2, gx, ty + 1.5, gz, 0x2a1e24);
  for (let k = 0; k < 4; k++) b.box('glow', 0.1, 0.9, 1.9, gx - 2.0, ty + 1.6, gz - 4.2 + k * 2.8, k % 2 ? 0x2a6a4a : 0x6a2a30);
  b.roofC('roof', gx, ty + 2.6, gz, 0x11151a, Math.PI / 2, 13.8, 2.5, 6.4);
  b.box('roof', 0.34, 0.26, 12.4, gx, ty + 5.02, gz, 0x232b31);
  for (const s of [-1, 1]) b.box('roof', 6.6, 0.16, 0.5, gx, ty + 2.74, gz + s * 6.6, 0x0e1216);
  b.kit('fengdu.gateTower', 1, y + PH + 4);
}

/** 城门后的层叠雾墙：三排高低错落的雾柱 + 背幕，收在街廊内，挡住透视尽头的天空 */
function buildStreetFog(b: Baker, y: number, gx: number, gz: number): void {
  const gy = y + 0.19;
  const fx = gx + 16;
  b.box('ash', 2.0, 15, 18, fx + 18, gy + 7.5, gz, 0x241d2c);
  for (let row = 0; row < 3; row++) {
    const h = 7.5 + row * 2.6;
    const zSpan = 15 - row * 2;
    const n = 5 + row;
    for (let i = 0; i < n; i++) {
      const pz = gz - zSpan / 2 + (i / (n - 1)) * zSpan;
      const hh = Math.min(13.5, h * (0.72 + h01(i, row, 131) * 0.5));
      b.box('ash', 3.0 + row, hh, (zSpan / n) * 0.72, fx + row * 5, gy + hh / 2, pz, shade(0x2c2434, 1 + row * 0.22));
    }
  }
  for (let i = 0; i < 3; i++) b.box('ash', 2.0, 1.1 - i * 0.2, 14 - i * 2, fx + 4 + i * 3, gy + 0.55, gz, shade(0x3a3044, 1 + i * 0.12));
  b.kit('fengdu.fogWall', 1, y + 6);
}

/** 独立 LCG（数值配方常数）：巷道与街心件只用这条流，共享 rng 一 draw 不取，既有 90 座鬼铺坐标不漂 */
function laneRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 七道南北巷：巷口各一座 2 柱 1 间小牌坊 + 一块巷口牌，巷内按 14–20m 步距左右交替摆
 * 招魂幡 / 骨灯 / 纸钱堆 / 锁链桩 / 判词碑。落位在离巷心 3.9–4.4m 的路缘带，
 * 巷身最窄处净通行 5.5m；横街口连路缘明沟一并让开（主街 ±11.6m、后巷 ±7.6m）。
 */
function buildLaneAlleys(b: Baker, y: number, lanesX: number[], lanesZ: number[], ez0: number, ez1: number): void {
  const top = y + 0.19;
  const cz = (ez0 + ez1) / 2;
  const half = (ez1 - ez0 - 20) / 2;
  const zA = cz - half;
  const zB = cz + half;
  const wideZ = lanesZ.filter((_, i) => i % 2 === 0);
  const narrowZ = lanesZ.filter((_, i) => i % 2 === 1);
  const clear = (z: number): boolean =>
    !wideZ.some((v) => Math.abs(z - v) < 11.6) && !narrowZ.some((v) => Math.abs(z - v) < 7.6);
  for (let li = 0; li < lanesX.length; li++) {
    const lx = lanesX[li];
    const rnd = laneRng(0x51ed27 + li * 2246822519);
    // 巷口：两端各一座小牌坊，内侧再挂一块巷口牌（两侧交替）
    for (const dir of [1, -1]) {
      const mz = dir > 0 ? zA + 6 : zB - 6;
      lanePaifang(b, top, lx, mz);
      laneProp(b, top, lx + dir * 4.05, mz + dir * 4.6, dir, 5, li * 97 + (dir > 0 ? 13 : 71));
    }
    // 巷内：14–20m 步距，落进横街（含路缘明沟）就顺移到下一开敞段，左右交替
    let pz = zA + 13;
    let side = li % 2 === 0 ? 1 : -1;
    let kind = li % 5;
    let placed = 0;
    while (pz < zB - 14) {
      if (!clear(pz)) {
        pz += 1.2;
        continue;
      }
      laneProp(b, top, lx + side * (3.9 + rnd() * 0.5), pz, side, kind, (li * 131 + kind * 37 + Math.round(pz)) >>> 0);
      placed++;
      side = -side;
      kind = (kind + 1) % 5;
      pz += 14 + rnd() * 6;
    }
    if (placed > 0) b.kit('fengdu.lane.prop', placed, top);
  }
}

/** 巷口小牌坊：2 柱 1 间，柱心距 7.4m（净通行 6.6m），脊高 5.9m，与主牌坊同一套石材 */
function lanePaifang(b: Baker, y: number, lx: number, pz: number): void {
  const PX = 3.7;
  for (const s of [-1, 1]) {
    b.box('ash', 1.0, 0.34, 1.0, lx + s * PX, y + 0.17, pz, 0x332f3a);
    b.box('ash', 0.75, 5.0, 0.75, lx + s * PX, y + 2.84, pz, 0x2a2630);
    b.box('ash', 0.95, 0.3, 0.95, lx + s * PX, y + 5.42, pz, 0x413d4a);
    b.box('ash', 0.86, 0.5, 0.86, lx + s * PX, y + 3.5, pz, 0x35323e);
    b.kit('fengdu.lane.paifangPost', 1, y + 2.6);
  }
  b.box('ash', 8.6, 0.5, 1.1, lx, y + 5.02, pz, 0x1c1218);
  b.box('roof', 9.6, 0.34, 1.9, lx, y + 5.55, pz, 0x0f0a10);
  b.box('roof', 8.2, 0.22, 1.3, lx, y + 5.83, pz, 0x121018);
  for (const s of [-1, 1]) {
    b.box('lacquer', 3.0, 0.68, 0.04, lx, y + 4.42, pz + s * 0.6, 0x1a1218);
    for (let i = 0; i < 3; i++) b.box('glow', 0.34, 0.024, 0.02, lx - 0.66 + i * 0.66, y + 4.42, pz + s * 0.625, i === 1 ? 0x8a2a2a : 0x2a7a5a);
    b.box('metal', 0.05, 0.3, 0.05, lx + s * 2.2, y + 4.6, pz, 0x3a3440);
    b.box('glow', 0.3, 0.4, 0.3, lx + s * 2.2, y + 4.25, pz, s < 0 ? RED : PHOS);
    b.box('metal', 0.36, 0.05, 0.36, lx + s * 2.2, y + 4.48, pz, 0x4a4030);
    b.box('metal', 0.36, 0.05, 0.36, lx + s * 2.2, y + 4.02, pz, 0x4a4030);
  }
  b.kit('fengdu.lane.paifang', 1, y + 5);
}

/**
 * 巷内单件：局部 +z 恒指巷心，六式各留一个自有 kit 名。
 * 0 招魂幡 / 1 骨灯 / 2 纸钱堆 / 3 锁链桩 / 4 判词碑 / 5 巷口牌
 */
function laneProp(b: Baker, y: number, px: number, pz: number, side: number, kind: number, seed: number): void {
  const ry = -side * (Math.PI / 2);
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const r = (k: number): number => h01(seed, k, 1471);
  const at = (lx: number, lz: number): [number, number] => [px + lx * cs + lz * sn, pz - lx * sn + lz * cs];
  const bx = (g: BoxGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, pry = 0, prx = 0, prz = 0): void => {
    const [wx, wz] = at(lx, lz);
    b.box(g, w, h, d, wx, y + ly, wz, hex, ry + pry, prx, prz);
  };
  const cy = (g: BoxGroup, rt: number, rb: number, hh: number, seg: number, lx: number, ly: number, lz: number, hex: number, prx = 0, prz = 0, open = false): void => {
    const [wx, wz] = at(lx, lz);
    b.cyl(g, rt, rb, hh, seg, wx, y + ly, wz, hex, ry, prx, prz, open);
  };
  switch (kind) {
    case 0: { // 招魂幡：细高杆，横臂垂破布，杆头一盏冷火
      const cloth = r(1) > 0.5 ? 0x5c1b24 : 0x24483a;
      bx('ash', 0.66, 0.3, 0.66, 0, 0.15, 0, 0x2c2a33);
      bx('ash', 0.48, 0.12, 0.48, 0, 0.36, 0, 0x3b3746);
      cy('wood', 0.05, 0.08, 4.9, 6, 0, 2.4, 0, 0x1e1720);
      bx('wood', 0.06, 0.06, 1.1, 0, 4.62, 0.46, 0x241c1a);
      bx('wood', 0.09, 0.09, 0.09, 0, 4.62, 0.04, 0x3a2c22);
      bx('fabric', 0.54, 2.15, 0.03, 0, 3.55, 0.9, cloth);
      for (let i = 0; i < 3; i++) bx('fabric', 0.12 + r(i + 2) * 0.08, 0.3, 0.026, -0.17 + i * 0.17, 2.32, 0.9, shade(cloth, 0.78));
      bx('metal', 0.1, 0.12, 0.1, 0, 4.74, 0.9, 0x4a4030);
      bx('glow', 0.08, 0.1, 0.08, 0, 4.85, 0.9, r(9) > 0.5 ? PHOS : RED);
      b.kit('fengdu.lane.banner', 1, y + 3.55);
      break;
    }
    case 1: { // 骨灯：四根股骨围成灯笼，冷芯透绿
      bx('ash', 0.54, 0.14, 0.54, 0, 0.07, 0, 0x2c2a33);
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2) + 0.35;
        bx('ash', 0.085, 0.78, 0.085, Math.cos(a) * 0.21, 0.46, Math.sin(a) * 0.21, 0xb9ae94, a);
      }
      cy('ash', 0.3, 0.28, 0.08, 9, 0, 0.72, 0, 0xa89e86, 0, 0, true);
      cy('glow', 0.16, 0.15, 0.42, 8, 0, 1.0, 0, PHOS);
      cy('ash', 0.31, 0.26, 0.09, 9, 0, 1.24, 0, 0xa89e86, 0, 0, true);
      bx('ash', 0.12, 0.14, 0.12, 0, 1.36, 0, 0xc4baa0);
      b.kit('fengdu.lane.boneLamp', 1, y + 1.0);
      break;
    }
    case 2: { // 纸钱堆：纸锭叠压、竹筐与散落纸钱
      const n = 4 + ((r(1) * 3) | 0);
      for (let i = 0; i < n; i++) {
        const a = r(i + 2);
        bx('fabric', 0.44 - i * 0.028, 0.032, 0.3, (a - 0.5) * 0.28, 0.035 + i * 0.042, (r(i + 9) - 0.5) * 0.22, shade(0xd2c49c, 0.82 + a * 0.3), (a - 0.5) * 0.8);
      }
      cy('ceramic', 0.22, 0.18, 0.28, 9, 0.58, 0.14, 0.14, 0x4c564e);
      for (let i = 0; i < 3; i++) bx('fabric', 0.15, 0.018, 0.11, -0.46 + i * 0.26, 0.02, 0.4 + i * 0.09, 0xc8b894, r(i) * 1.4);
      bx('glow', 0.05, 0.018, 0.05, 0.08, 0.18, 0.18, 0x6a6a52);
      b.kit('fengdu.lane.paperPile', 1, y + 0.2);
      break;
    }
    case 3: { // 锁链桩：石桩铁箍，一条链子垂向巷心
      bx('ash', 0.36, 0.16, 0.36, 0, 0.08, 0, 0x2f2c36);
      bx('ash', 0.26, 1.1, 0.26, 0, 0.71, 0, 0x35323e);
      bx('ash', 0.36, 0.1, 0.36, 0, 1.31, 0, 0x413d4a);
      bx('ash', 0.16, 0.16, 0.16, 0, 1.42, 0, 0x4a4652);
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        bx('metal', 0.12, 0.05, 0.05, 0, 1.12 - t * 1.02 - Math.sin(t * Math.PI) * 0.06, 0.12 + t * 1.0, 0x4a4650, i % 2 ? Math.PI / 2 : 0, 0, i % 2 ? 0.55 : 0);
      }
      bx('glow', 0.09, 0.02, 0.09, 0, 1.52, 0, 0x2a6a5a);
      b.kit('fengdu.lane.chainPost', 1, y + 1.3);
      break;
    }
    case 4: { // 判词碑：碑座碑首，碑面阴刻三行判词与朱印，侧立一盏红灯
      bx('ash', 1.15, 0.22, 0.64, 0, 0.11, 0, 0x2f2c36);
      bx('ash', 0.92, 0.16, 0.5, 0, 0.3, 0, 0x3b3746);
      bx('ash', 0.8, 1.48, 0.22, 0, 1.08, 0.02, 0x35323e, 0, 0.02, 0);
      bx('ash', 0.9, 0.14, 0.28, 0, 1.9, 0.02, 0x413d4a, 0, 0.02, 0);
      bx('lacquer', 0.62, 1.16, 0.025, 0, 1.06, 0.145, 0x18121a, 0, 0.02, 0);
      for (let i = 0; i < 4; i++) bx('glow', 0.32 - (i % 2) * 0.11, 0.028, 0.02, -0.07, 1.52 - i * 0.24, 0.165, 0x2a6a5a);
      bx('lacquer', 0.14, 0.14, 0.025, 0.2, 0.62, 0.165, 0xa8302a);
      bx('metal', 0.05, 0.52, 0.05, -0.54, 0.4, 0.06, 0x3a3440);
      bx('glow', 0.12, 0.16, 0.12, -0.54, 0.72, 0.06, RED);
      bx('metal', 0.16, 0.04, 0.16, -0.54, 0.84, 0.06, 0x4a4030);
      b.kit('fengdu.lane.verdictStele', 1, y + 1.06);
      break;
    }
    default: { // 巷口牌：木杆挑出一块挂牌，专给巷口用
      bx('ash', 0.5, 0.2, 0.5, 0, 0.1, 0, 0x2c2a33);
      bx('wood', 0.16, 2.5, 0.16, 0, 1.35, 0, 0x241b16);
      bx('wood', 0.08, 0.08, 0.92, 0, 2.5, 0.42, 0x241b16);
      bx('metal', 0.06, 0.12, 0.06, 0, 2.4, 0.62, 0x4a4030);
      bx('lacquer', 0.64, 1.05, 0.06, 0, 1.9, 0.62, 0x1c1218);
      for (let i = 0; i < 3; i++) bx('glow', 0.3, 0.026, 0.02, 0, 2.16 - i * 0.22, 0.655, i === 2 ? 0x8a2a2a : 0x2a7a5a);
      bx('glow', 0.08, 0.08, 0.08, 0, 2.62, 0.84, PHOS);
      b.kit('fengdu.lane.mouthPlaque', 1, y + 1.9);
      break;
    }
  }
}

/**
 * 主街街心：中线两侧 4.5m 各压一道 0.6m 宽条石带（明度比铺装高一档），每 3.3m 一块、留 10cm 缝；
 * 另每 30m 一块街心界石 / 引魂灯座，全部贴地（最高 0.26m），不占通行净空。
 */
function buildStreetAxis(b: Baker, y: number, lanes: number[], lanesX: number[], x0: number, x1: number, gateX: number, gateZ: number): void {
  const top = y + 0.19;
  const HALF = 4.5;
  const BED = 0x15131b;
  const STONE = shade(PAVE_LIGHT, 1.16);
  const xa = x0 + 6;
  const xb = x1 - 6;
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    for (const s of [-1, 1]) {
      const bz = lane + s * HALF;
      const runs: [number, number][] = lane === gateZ ? [[xa, gateX - 6], [gateX + 6, xb]] : [[xa, xb]];
      for (const [ra, rb] of runs) {
        const len = rb - ra;
        if (len < 2) continue;
        b.box('ground', len, 0.014, 0.76, ra + len / 2, top + 0.001, bz, BED);
        const n = Math.max(1, Math.round(len / 3.3));
        const seg = len / n;
        for (let i = 0; i < n; i++) {
          b.box('ground', seg - 0.1, 0.022, 0.6, ra + seg * (i + 0.5), top + 0.014, bz, shade(STONE, 0.93 + h01(i, li * 2 + (s > 0 ? 1 : 0), 181) * 0.14));
        }
      }
      b.kit('fengdu.axis.pressBand', 1, top);
    }
    // 街心界石 / 引魂灯座：30m 一块，跨路口与城门的让开
    let k = 0;
    for (let px = x0 + 22; px <= x1 - 22; px += 30, k++) {
      if (lane === gateZ && Math.abs(px - gateX) < 9) continue;
      if (lanesX.some((v) => Math.abs(v - px) < 5)) continue;
      if (k % 2 === 0) {
        b.box('ash', 1.28, 0.09, 0.5, px, top + 0.045, lane, 0x413d4a);
        b.box('ground', 1.26, 0.012, 0.06, px, top + 0.088, lane - 0.13, 0x14121a);
        b.box('ground', 1.26, 0.012, 0.06, px, top + 0.088, lane + 0.13, 0x14121a);
        b.box('glow', 0.08, 0.03, 0.08, px - 0.56, top + 0.1, lane, 0x2a6a5a);
        b.box('glow', 0.08, 0.03, 0.08, px + 0.56, top + 0.1, lane, 0x2a6a5a);
        b.kit('fengdu.axis.kerbStone', 1, top);
      } else {
        b.cyl('glow', 0.82, 0.9, 0.014, 12, px, top + 0.012, lane, 0x2a5a4a);
        b.cyl('ash', 0.44, 0.48, 0.04, 10, px, top + 0.04, lane, 0x413d4a);
        b.cyl('ash', 0.42, 0.46, 0.16, 10, px, top + 0.11, lane, 0x35323e);
        b.cyl('glow', 0.22, 0.22, 0.06, 10, px, top + 0.19, lane, ICE);
        b.cyl('ash', 0.36, 0.38, 0.1, 10, px, top + 0.21, lane, 0x3d3948, 0, 0, 0, true);
        b.kit('fengdu.axis.soulLamp', 1, top);
      }
    }
  }
}

// ============ WS-34 丰都街区门楼与街市构件（8 件 / 8 座） ============
// 落位纪律：门楼一律落在街面 x>842 / x<238 / z>170 的铺装尽头（越过 90 座鬼铺的 x/z 包络），
// 街心构件落在无铺面的 z 带（主街 20–30 / 80–90 / 140–150，后巷 50–60 / 110–120），
// 全部避开 119 组街面件、街灯 x=209+20k 网格、街心界石 x=212+30k、供桌与七巷牌坊。本段不取共享 rng。

/** 门楼局部系：local +x = 门宽（横断街巷），local +z = 门深（门面法向）；ly 为世界绝对高度 */
type GateFrame = {
  bx: (g: BoxGroup, lx: number, ly: number, lz: number, w: number, h: number, d: number, hex: number, pry?: number, prx?: number, prz?: number) => void;
  cy: (g: BoxGroup, rt: number, rb: number, hh: number, seg: number, lx: number, ly: number, lz: number, hex: number, prz?: number, open?: boolean) => void;
  py: (g: BoxGroup, rt: number, rb: number, lx: number, ly: number, lz: number, hex: number, sx: number, sy: number, sz: number) => void;
  rf: (g: BoxGroup, lx: number, ly: number, lz: number, hex: number, sx: number, sy: number, sz: number) => void;
  at: (lx: number, lz: number) => [number, number];
};

function gateFrame(b: Baker, gx: number, gz: number, ry: number): GateFrame {
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [gx + lx * cs + lz * sn, gz - lx * sn + lz * cs];
  return {
    at,
    bx: (g, lx, ly, lz, w, h, d, hex, pry = 0, prx = 0, prz = 0) => {
      const [wx, wz] = at(lx, lz);
      b.box(g, w, h, d, wx, ly, wz, hex, ry + pry, prx, prz);
    },
    cy: (g, rt, rb, hh, seg, lx, ly, lz, hex, prz = 0, open = false) => {
      const [wx, wz] = at(lx, lz);
      b.cyl(g, rt, rb, hh, seg, wx, ly, wz, hex, ry, 0, prz, open);
    },
    py: (g, rt, rb, lx, ly, lz, hex, sx, sy, sz) => {
      const [wx, wz] = at(lx, lz);
      b.pyramid(g, rt, rb, wx, ly, wz, hex, ry, sx, sy, sz);
    },
    rf: (g, lx, ly, lz, hex, sx, sy, sz) => {
      const [wx, wz] = at(lx, lz);
      b.roofC(g, wx, ly, wz, hex, ry, sx, sy, sz);
    },
  };
}

/** 青灰砖色板：全地府唯一「阳色」建材（青砖 + 白灰缝），其余地府石材一律暗灰 */
const QZ = { brick: 0x66705f, brickL: 0x707a68, brickD: 0x565f52, mortar: 0xcfd6c6, plinth: 0x5c645c, face: 0x6d7468, tile: 0x101418, ridge: 0x232a2e, warm: 0xffd9a0 };

export function buildFengduGates(b: Baker, sg: SignMesher, atlas: SignAtlas, y: number): void {
  const top = y + 0.19; // 街面铺装顶
  const edge = y + 0.15; // 台地内层顶（无铺装的巷尾）
  // 1 返阳门·青砖门楼：东街(z=25)东口 x=876，14m 双门洞，阳间窑色青砖（D-ITM-0075）
  fengduQingzhuanGate(b, sg, atlas, top, 876, 25);
  // 2 东·生门：北街(z=145)东口 x=879，常年砖封、门缝透天光（D-ITM-0115）
  fengduShengmen(b, sg, atlas, top, 879, 145);
  // 3 西市门：东街(z=25)西口 x=200，双扇敞开、纸扎货运驼道（D-ITM-0116 双门之一）
  fengduXishiGate(b, sg, atlas, top, 200, 25);
  // 4 北枉门：中巷(x=520)北口 z=181，砖封永闭（D-ITM-0116 双门之二）
  fengduBeiwangGate(b, sg, atlas, edge, 520, 181);
  // 5 六角井亭：东街与七巷之间的街心 (470,25)，亭顶开孔正对井口（D-ITM-0104）
  fengduWellPavilion(b, top, 470, 25);
  // 6 挂符梁：后巷(z=115)西口 x=210，梁下符纸串（D-ITM-0145）
  fengduTalismanBeam(b, top, 210, 115);
  // 7 门前碑：中巷(x=680)南口碑位 (687.6,145)，以碑为门匾（D-ITM-0174）
  fengduDoorStele(b, 687.6, 145, top);
  // 8 无名神龛：中巷(x=520)南口神龛位 (527.6,145)，龛中唯雾（D-ITM-0179）
  fengduNamelessShrine(b, 527.6, 145, top);
}

/** 砖砌墩身：墩心线脚 + 三道白灰缝（青砖门楼专用，砖缝是「如新」的唯一读法） */
function qzPier(g: GateFrame, lx: number, top: number, w: number, h: number, d: number, rows: number): void {
  g.bx('ash', lx, top + 0.5 + h / 2, 0, w, h, d, QZ.brick);
  g.bx('ash', lx, top + 0.86, 0, w + 0.4, 0.72, d + 0.3, QZ.plinth);
  g.bx('ash', lx, top + 3.6, 0, w + 0.2, 0.28, d + 0.16, QZ.brickL);
  g.bx('ash', lx, top + 0.5 + h - 0.2, 0, w + 0.22, 0.32, d + 0.18, QZ.brickL);
  for (let i = 0; i < rows; i++) g.bx('ash', lx, top + 1.9 + i * 2.3, 0, w - 0.02, 0.06, d + 0.02, QZ.mortar);
  for (let i = 0; i < 3; i++) g.bx('ash', lx, top + 1.2 + i * 2.9, 0, 0.05, 2.6, d + 0.02, QZ.mortar);
}

/**
 * 双扇板门：hinge 落在墩内缘（不脱墩），叶心 = hinge + 旋转半宽，门钉/铺首/铁箍随叶面同转。
 * p 为叶面旋角（含 s 符号），h 门高，half 叶半宽；warm 时在门后加一片温光（阳色透缝）。
 */
function leafPair(g: GateFrame, top: number, hingeLx: number, s: number, half: number, p: number, h: number, warm: boolean): void {
  const cs = Math.cos(p);
  const sn = Math.sin(p);
  const cxl = hingeLx - s * half * cs;
  const czl = -0.62 + s * half * sn;
  const lp = (dx: number, dz: number): [number, number] => [cxl + dx * cs + dz * sn, czl - dx * sn + dz * cs];
  g.bx('lacquer', cxl, top + 0.62 + h / 2, czl, half * 2, h, 0.16, 0x2a1a16, p);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const [dx, dz] = lp(-s * (half - 0.4) + s * c * 0.62, 0.1);
      g.bx('metal', dx, top + 1.3 + r * (h / 3.6), dz, 0.13, 0.13, 0.07, 0x6a5a3a, p);
    }
  }
  const [rx, rz] = lp(-s * 0.55, 0.11);
  g.bx('metal', rx, top + 2.9, rz, 0.22, 0.22, 0.05, 0x7a6a44, p);
  const [qx, qz] = lp(-s * 0.55, 0.15);
  g.bx('metal', qx, top + 2.82, qz, 0.17, 0.17, 0.03, 0x4a4030, p);
  if (warm) {
    const [wx2, wz2] = lp(0, 0.16);
    g.bx('glow', wx2, top + 0.62 + h / 2, wz2, half * 1.8, h - 0.3, 0.02, 0x2e2114, p);
  }
}

/** 1 返阳门·青砖门楼（D-ITM-0075）：台基 + 三墩两洞 + 门额「返陽門」+ 檐顶 + 门灯 */
function fengduQingzhuanGate(b: Baker, sg: SignMesher, atlas: SignAtlas, top: number, x: number, z: number): void {
  const g = gateFrame(b, x, z, Math.PI / 2);
  const W = 15.4;
  const D = 5.4;
  const PH = 9.6;
  g.bx('ash', 0, top + 0.23, 0, W, 0.46, D, QZ.plinth);
  g.bx('ash', 0, top + 0.52, 0, W - 0.4, 0.12, D - 0.4, QZ.face);
  b.kit('fengdu.gate.qingzhuan.base', 2, top + 0.4);
  for (const lx of [-5.6, 0, 5.6]) {
    qzPier(g, lx, top, 2.2, PH, 4.6, 3);
    b.kit('fengdu.gate.qingzhuan.pier', 1, top + PH / 2);
  }
  for (const s of [-1, 1]) {
    const hx = s * 2.8;
    g.bx('ash', hx, top + 8.0, 0, 3.5, 1.1, 4.66, QZ.brickL);
    g.bx('ash', hx, top + 7.15, 0, 3.5, 0.3, 4.74, QZ.face);
    g.bx('ash', hx, top + 0.62, -0.9, 3.5, 0.24, 0.5, QZ.face);
    g.bx('glow', hx, top + 4.4, 0.3, 3.2, 5.2, 0.04, 0x4a3a20);
    g.bx('glow', hx, top + 0.23, -2.2, 3.6, 0.02, 2.0, 0x5c4724);
    for (const d of [-1, 1]) leafPair(g, top, hx + d * 1.64, d, 0.8, d * 0.22, 6.3, true);
  }
  b.kit('fengdu.gate.qingzhuan.leaf', 4, top + 3.7);
  g.rf('roof', 0, top + 10.5, 0, QZ.tile, 17.2, 2.9, 7.0);
  g.bx('roof', 0, top + 13.3, 0, 15.6, 0.34, 0.44, QZ.ridge);
  for (const s of [-1, 1]) {
    g.bx('roof', 0, top + 10.58, s * 3.5, 17.6, 0.18, 0.6, QZ.tile);
    g.bx('roof', 0, top + 13.42, s * 0.5, 15.4, 0.12, 0.5, 0x1a2024);
  }
  b.kit('fengdu.gate.qingzhuan.eave', 4, top + 10.6);
  sg.quad(atlas.text('fengdu-gate-fanyang', '返陽門', 340, 100, {
    color: '#ffe4c0', glow: '#ff9a4a', bg: 'rgba(12,8,4,0.94)', border: 'rgba(255,154,74,.85)', fontPx: 72,
  }), 6.4, 1.15, x - 2.52, top + 9.0, z, -Math.PI / 2);
  b.kit('fengdu.gate.qingzhuan.sign', 1, top + 9.0);
  for (const s of [-1, 1]) {
    g.bx('metal', s * 5.6, top + 7.0, -2.1, 0.07, 0.6, 0.07, 0x3a3440);
    g.bx('glow', s * 5.6, top + 6.4, -2.1, 0.3, 0.42, 0.3, s < 0 ? 0xff9a4a : 0xffcf90);
    g.bx('metal', s * 5.6, top + 6.66, -2.1, 0.38, 0.06, 0.38, 0x4a4030);
    g.bx('ash', s * 5.6, top + 6.16, -2.1, 0.3, 0.06, 0.3, 0x4a4030);
  }
  b.kit('fengdu.gate.qingzhuan.lamp', 2, top + 6.4);
}

/** 2 东·生门（D-ITM-0115）：砖封门洞 + 门缝一线天光 + 门前光斑 */
function fengduShengmen(b: Baker, sg: SignMesher, atlas: SignAtlas, top: number, x: number, z: number): void {
  const g = gateFrame(b, x, z, Math.PI / 2);
  const PH = 7.0;
  g.bx('ash', 0, top + 0.2, 0, 9.6, 0.4, 4.6, QZ.plinth);
  g.bx('ash', 0, top + 0.44, 0, 9.2, 0.1, 4.2, QZ.face);
  for (const s of [-1, 1]) qzPier(g, s * 3.0, top, 2.4, PH, 3.8, 2);
  g.bx('ash', 0, top + 7.6, 0, 4.6, 0.85, 3.9, QZ.brickL);
  g.bx('ash', 0, top + 8.14, 0, 4.9, 0.26, 4.1, QZ.face);
  // 封砖：7 皮 × 3 丁，砖缝留白（封门是新砖，与两侧旧墩明度差一档）
  for (let c = 0; c < 7; c++) {
    const off = c % 2 ? 0.28 : -0.28;
    for (let i = 0; i < 3; i++) {
      g.bx('ash', -1.18 + i * 1.18 + off, top + 1.06 + c * 0.93, -0.55, 1.12, 0.88, 0.62, shade(QZ.brickL, 1.04));
    }
    g.bx('ash', 0, top + 1.5 + c * 0.93, -0.86, 3.5, 0.05, 0.03, QZ.mortar);
  }
  // 门缝：中缝一线天光，门前地面一道光斑（全城唯一阳色，与返阳门呼应）
  g.bx('glow', 0, top + 3.5, -0.62, 0.11, 5.9, 0.12, 0xffe6b8);
  g.bx('glow', 0, top + 0.44, -1.9, 1.1, 0.02, 2.6, 0x6a5230);
  g.bx('glow', 0, top + 0.44, -1.1, 0.34, 0.02, 1.2, 0x8a6a38);
  g.rf('roof', 0, top + 8.4, 0, QZ.tile, 11.2, 1.8, 5.8);
  g.bx('roof', 0, top + 10.14, 0, 9.8, 0.2, 0.36, QZ.ridge);
  for (const s of [-1, 1]) g.bx('roof', 0, top + 8.48, s * 2.9, 11.6, 0.16, 0.5, QZ.tile);
  sg.quad(atlas.text('fengdu-gate-sheng', '生門', 240, 96, {
    color: '#d8e4c8', glow: '#9ad86a', bg: 'rgba(8,10,6,0.9)', border: 'rgba(154,216,106,.6)', fontPx: 68,
  }), 2.9, 1.0, x - 2.06, top + 6.55, z, -Math.PI / 2);
  b.kit('fengdu.gate.shengmen.sign', 1, top + 6.55);
  g.bx('metal', -3.9, top + 5.6, -1.6, 0.06, 0.4, 0.06, 0x3a3440);
  g.bx('glow', -3.9, top + 5.2, -1.6, 0.26, 0.34, 0.26, 0x9ad86a);
  g.bx('metal', -3.9, top + 5.4, -1.6, 0.32, 0.05, 0.32, 0x4a4030);
  b.kit('fengdu.gate.shengmen', 1, top);
  b.kit('fengdu.gate.shengmen.lamp', 1, top + 5.2);
}

/** 3 西市门（D-ITM-0116）：双扇敞开 + 门槛石 + 车辙 + 门楼 + 纸扎货垛 */
function fengduXishiGate(b: Baker, sg: SignMesher, atlas: SignAtlas, top: number, x: number, z: number): void {
  const g = gateFrame(b, x, z, Math.PI / 2);
  const PH = 8.2;
  g.bx('ash', 0, top + 0.25, 0, 14.6, 0.5, 6.0, QZ.plinth);
  g.bx('ash', 0, top + 0.54, 0, 14.2, 0.12, 5.6, 0x4e5250);
  for (const lx of [-4.9, 4.9]) {
    qzPier(g, lx, top, 2.6, PH, 4.8, 2);
  }
  b.kit('fengdu.gate.xishi.pier', 2, top + PH / 2);
  g.bx('ash', 0, top + 8.75, 0, 9.8, 0.7, 5.0, 0x565a52);
  g.bx('ash', 0, top + 0.62, 0, 7.4, 0.26, 1.6, 0x5a5e56);
  // 双扇全开：向城内敞开，铰点落在墩内缘（门钉随叶面同转）
  for (const s of [-1, 1]) {
    leafPair(g, top, s * 3.5, s, 1.75, s * 1.05, 6.4, false);
    g.bx('metal', s * 3.5, top + 0.72, -0.55, 0.18, 0.9, 0.18, 0x4a4650);
  }
  b.kit('fengdu.gate.xishi.leaf', 2, top + 3.9);
  // 驼道车辙：两道压进铺装的暗槽 + 门槛外碎石
  for (const s of [-1, 1]) {
    g.bx('ground', s * 1.7, top + 0.015, -2.6, 0.9, 0.02, 4.6, 0x241c18);
    g.bx('ground', s * 1.7, top + 0.015, 3.2, 0.9, 0.02, 2.4, 0x241c18);
  }
  // 纸扎货垛：麻纸包 + 竹筐 + 绳捆，堆在门内两侧（鬼市驼道货运）
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.bx('fabric', s * 5.4, top + 0.62 + i * 0.6, 2.1 - i * 0.16, 1.5 - i * 0.12, 0.56, 1.2, shade(0xb8a882, 1 - i * 0.06), s * 0.1);
      g.bx('metal', s * 5.4, top + 0.62 + i * 0.6, 2.1 - i * 0.16, 0.08, 0.6, 1.24, 0x4a4030);
    }
    g.cy('ceramic', 0.42, 0.34, 0.62, 9, s * 5.3, top + 0.31, 0.9, 0x5a5a48);
    g.bx('metal', s * 5.3, top + 0.64, 0.9, 0.12, 0.1, 0.9, 0x4a4030);
  }
  b.kit('fengdu.gate.xishi.bale', 6, top + 1.0);
  // 门楼：木台 + 四柱 + 板壁 + 直棂窗 + 檐
  g.bx('ash', 0, top + 9.2, 0, 9.4, 0.34, 5.8, 0x4e5250);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.bx('wood', sx * 3.9, top + 10.6, sz * 2.4, 0.34, 2.6, 0.34, 0x2a2018);
  }
  for (const sz of [-1, 1]) {
    g.bx('wood', 0, top + 10.9, sz * 2.5, 8.2, 1.9, 0.24, 0x241a18);
    for (let i = 0; i < 5; i++) g.bx('glow', -3.0 + i * 1.5, top + 11.0, sz * 2.63, 0.9, 1.0, 0.03, i % 2 ? 0x8a3a24 : 0x3a7a52);
  }
  g.rf('roof', 0, top + 11.9, 0, QZ.tile, 10.6, 2.0, 6.6);
  g.bx('roof', 0, top + 13.9, 0, 8.8, 0.24, 0.38, QZ.ridge);
  b.kit('fengdu.gate.xishi.tower', 1, top + 11.0);
  sg.quad(atlas.text('fengdu-gate-xishi', '西市門', 320, 100, {
    color: '#c8e8d0', glow: '#3dff9c', bg: 'rgba(6,10,8,0.92)', border: 'rgba(61,255,156,.75)', fontPx: 66,
  }), 4.4, 1.1, x - 2.56, top + 7.4, z, -Math.PI / 2);
  b.kit('fengdu.gate.xishi.sign', 1, top + 7.4);
  for (const s of [-1, 1]) {
    g.bx('metal', s * 6.3, top + 6.4, -2.3, 0.07, 0.7, 0.07, 0x3a3440);
    g.bx('glow', s * 6.3, top + 5.6, -2.3, 0.34, 0.5, 0.34, s < 0 ? 0xff3a4a : 0xffcf90);
    g.bx('metal', s * 6.3, top + 5.88, -2.3, 0.42, 0.06, 0.42, 0x4a4030);
  }
  b.kit('fengdu.gate.xishi', 1, top);
  b.kit('fengdu.gate.xishi.lamp', 2, top + 5.6);
}

/** 4 北枉门（D-ITM-0116 双门之二）：中巷北口砖封永闭，遥对枉死城 */
function fengduBeiwangGate(b: Baker, sg: SignMesher, atlas: SignAtlas, base: number, x: number, z: number): void {
  const g = gateFrame(b, x, z, 0);
  const PH = 6.8;
  g.bx('ash', 0, base + 0.18, 0, 7.6, 0.36, 2.9, QZ.plinth);
  g.bx('ash', 0, base + 0.4, 0, 7.2, 0.1, 2.6, QZ.face);
  for (const lx of [-2.6, 2.6]) {
    g.bx('ash', lx, base + 0.46 + PH / 2, 0, 1.8, PH, 2.3, QZ.brick);
    g.bx('ash', lx, base + 0.8, 0, 2.2, 0.66, 2.6, QZ.plinth);
    g.bx('ash', lx, base + 4.2, 0, 1.94, 0.24, 2.4, QZ.brickL);
    for (let i = 0; i < 2; i++) g.bx('ash', lx, base + 2.2 + i * 2.2, 0, 1.78, 0.05, 2.34, QZ.mortar);
  }
  b.kit('fengdu.gate.beiwang.pier', 2, base + PH / 2);
  g.bx('ash', 0, base + 7.1, 0, 4.4, 0.7, 2.4, QZ.brickL);
  // 封砖：5 皮 × 3 丁，砖面比两侧旧墩亮（永闭之门仍在新封）
  for (let c = 0; c < 5; c++) {
    const off = c % 2 ? 0.26 : -0.26;
    for (let i = 0; i < 3; i++) {
      g.bx('ash', -1.15 + i * 1.15 + off, base + 1.1 + c * 1.3, -0.25, 1.12, 1.26, 0.5, shade(QZ.brickL, 1.06));
    }
    g.bx('ash', 0, base + 1.72 + c * 1.3, -0.52, 3.2, 0.05, 0.03, QZ.mortar);
  }
  g.bx('lacquer', 0, base + 3.9, -0.52, 3.4, 0.16, 0.05, 0x1a1218);
  g.bx('lacquer', 0, base + 3.9, -0.55, 0.36, 0.34, 0.03, 0xa8302a);
  g.rf('roof', 0, base + 7.6, 0, QZ.tile, 9.0, 1.5, 4.2);
  g.bx('roof', 0, base + 9.06, 0, 7.6, 0.2, 0.34, QZ.ridge);
  sg.quad(atlas.text('fengdu-gate-beiwang', '枉', 96, 160, {
    color: '#c8e8d0', glow: '#3dff9c', bg: 'rgba(6,10,8,0.92)', border: 'rgba(61,255,156,.7)', fontPx: 96, vertical: true,
  }), 1.1, 2.1, x, base + 5.3, z - 1.28, Math.PI);
  b.kit('fengdu.gate.beiwang.sign', 1, base + 5.3);
  g.bx('metal', 3.1, base + 5.2, -1.25, 0.06, 0.4, 0.06, 0x3a3440);
  g.bx('glow', 3.1, base + 4.8, -1.25, 0.26, 0.34, 0.26, 0x3dff9c);
  g.bx('metal', 3.1, base + 5.0, -1.25, 0.32, 0.05, 0.32, 0x4a4030);
  b.kit('fengdu.gate.beiwang', 1, base);
  b.kit('fengdu.gate.beiwang.lamp', 1, base + 4.8);
}

/**
 * 5 六角井亭（D-ITM-0104）：六角石台 + 六柱缠幡 + 六道额枋 + 开孔六角檐 + 井口 + 亭心雾堆。
 * 亭顶檐用开口六棱台做，顶心天然留孔，正对井口；坠地者落于亭心软雾堆。
 */
function fengduWellPavilion(b: Baker, top: number, x: number, z: number): void {
  const R = 2.95;
  b.cyl('ash', 3.5, 3.62, 0.36, 6, x, top + 0.18, z, 0x4c4852);
  b.cyl('ash', 3.4, 3.42, 0.06, 6, x, top + 0.39, z, 0x59545e);
  b.kit('fengdu.wellPavilion.plinth', 2, top + 0.2);
  // 井口：石圈 + 井内暗水 + 水面微光
  b.cyl('ash', 2.16, 2.24, 0.46, 12, x, top + 0.62, z, 0x3e3a44, 0, 0, 0, true);
  b.cyl('ash', 2.3, 2.3, 0.1, 12, x, top + 0.85, z, 0x4a4650, 0, 0, 0, true);
  b.cyl('ground', 2.1, 2.1, 0.06, 12, x, top + 0.4, z, 0x08080c);
  b.cyl('glow', 1.5, 1.5, 0.02, 10, x, top + 0.44, z, 0x1e2a34);
  b.kit('fengdu.wellPavilion.wellHead', 3, top + 0.6);
  // 六柱：柱础 + 柱身 + 缠幡（幡面朝外）
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    const px = x + Math.cos(a) * R;
    const pz = z + Math.sin(a) * R;
    b.box('ash', 0.48, 0.26, 0.48, px, top + 0.52, pz, 0x4a4650, -a);
    b.box('ash', 0.36, 0.14, 0.36, px, top + 0.71, pz, 0x565662, -a);
    b.box('wood', 0.28, 3.1, 0.28, px, top + 2.26, pz, 0x241a18, -a);
    b.box('fabric', 0.42, 1.3, 0.07, x + Math.cos(a) * (R + 0.2), top + 2.5, z + Math.sin(a) * (R + 0.2), k % 2 ? 0x5c1b24 : 0x24483a, -a + Math.PI / 2);
    b.box('fabric', 0.3, 0.4, 0.06, x + Math.cos(a) * (R + 0.21), top + 1.5, z + Math.sin(a) * (R + 0.21), k % 2 ? 0x3c1218 : 0x183026, -a + Math.PI / 2);
    b.kit('fengdu.wellPavilion.post', 1, top + 2.3);
  }
  // 六道额枋：弦向，半径 2.55，长 2.95
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    const m = a + Math.PI / 6;
    b.box('wood', 2.95, 0.24, 0.22, x + Math.cos(m) * 2.55, top + 3.6, z + Math.sin(m) * 2.55, 0x2a1e1a, m - Math.PI / 2);
  }
  b.kit('fengdu.wellPavilion.tie', 6, top + 3.6);
  // 开孔六角檐：rt 0.62 / rb 3.62，无端盖
  b.cyl('roof', 0.62, 3.62, 1.55, 6, x, top + 4.47, z, 0x13111a, 0, 0, 0, true);
  b.cyl('roof', 0.78, 0.66, 0.18, 6, x, top + 5.32, z, 0x1c1a22, 0, 0, 0, true);
  b.cyl('glow', 0.58, 0.58, 0.02, 8, x, top + 5.3, z, 0x6e7884);
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    const m = a + Math.PI / 6;
    b.box('roof', 3.62, 0.16, 0.42, x + Math.cos(m) * 3.36, top + 3.7, z + Math.sin(m) * 3.36, 0x1a1822, m - Math.PI / 2);
    b.box('roof', 0.2, 0.18, 0.5, x + Math.cos(a) * 3.5, top + 3.74, z + Math.sin(a) * 3.5, 0x22202a, -a);
  }
  b.kit('fengdu.wellPavilion.roof', 2, top + 4.5);
  // 亭心软雾堆：坠地者落点
  b.box('ash', 1.9, 0.4, 1.7, x, top + 0.86, z, 0x8e949c);
  b.box('ash', 1.4, 0.3, 1.24, x + 0.3, top + 1.2, z - 0.2, 0x9aa0a8);
  b.box('fabric', 1.1, 0.26, 1.0, x - 0.28, top + 1.5, z + 0.22, 0x7a828a);
  b.box('glow', 0.7, 0.04, 0.6, x, top + 1.02, z, 0x2a3a44);
  b.kit('fengdu.wellPavilion.mist', 4, top + 1.0);
  b.kit('fengdu.wellPavilion', 1, top);
}

/**
 * 6 挂符梁（D-ITM-0145）：后巷西口两柱一梁，梁下七串符纸，脊瓦压顶，
 * 符纸以左右微摆角表达「无风自摆」（静态烘焙不做动画，摆幅差按串错开）。
 */
function fengduTalismanBeam(b: Baker, top: number, x: number, z: number): void {
  const g = gateFrame(b, x, z, Math.PI / 2);
  for (const s of [-1, 1]) {
    g.bx('ash', s * 3.3, top + 0.21, 0, 0.86, 0.42, 0.86, 0x3e3a44);
    g.bx('ash', s * 3.3, top + 0.5, 0, 0.64, 0.18, 0.64, 0x4a4650);
    g.bx('wood', s * 3.3, top + 3.2, 0, 0.34, 5.4, 0.34, 0x2a1e18);
    g.bx('metal', s * 3.3, top + 5.4, 0, 0.42, 0.14, 0.42, 0x4a4650);
    g.bx('wood', s * 2.7, top + 5.62, 0, 0.9, 0.42, 0.5, 0x2e2218, s * 0.22);
    b.kit('fengdu.talismanBeam.post', 1, top + 3.2);
  }
  g.bx('wood', 0, top + 6.1, 0, 7.6, 0.42, 0.44, 0x2e2218);
  g.bx('wood', 0, top + 5.72, 0, 7.2, 0.2, 0.3, 0x241a14);
  g.bx('roof', 0, top + 6.38, 0, 7.9, 0.16, 0.9, 0x141218);
  for (const s of [-1, 1]) g.bx('roof', s * 3.9, top + 6.38, 0, 0.22, 0.14, 0.94, 0x1e1c24);
  b.kit('fengdu.talismanBeam', 1, top + 6.1);
  // 符纸串：7 串，每串 1 环 + 4 片，片片错角（无风自摆）
  for (let k = 0; k < 7; k++) {
    const lx = -3.0 + k;
    const sway = (k % 3 - 1) * 0.09;
    g.bx('metal', lx, top + 5.9, 0, 0.1, 0.14, 0.07, 0x4a4650);
    for (let i = 0; i < 4; i++) {
      const col = i === 0 && k % 4 === 0 ? 0xa8302a : shade(0xc8b894, 1 - i * 0.05);
      g.bx('fabric', lx + sway * i, top + 5.56 - i * 0.36, 0.01 * (i % 2), 0.24, 0.32, 0.02, col, 0, 0, sway * (i + 1));
    }
  }
  b.kit('fengdu.talismanBeam.talisman', 7, top + 4.6);
  for (const s of [-1, 1]) {
    g.bx('metal', s * 3.3, top + 5.9, 0.24, 0.05, 0.3, 0.05, 0x3a3440);
    g.bx('glow', s * 3.3, top + 5.62, 0.24, 0.2, 0.26, 0.2, 0xffcf90);
    g.bx('metal', s * 3.3, top + 5.78, 0.24, 0.26, 0.05, 0.26, 0x4a4030);
  }
  b.kit('fengdu.talismanBeam.lamp', 2, top + 5.6);
}

/** 7 门前碑（D-ITM-0174）：以碑为门匾——门框柱 + 门楣 + 门簪，碑立于门心，碑文即户名 */
function fengduDoorStele(b: Baker, x: number, z: number, top: number): void {
  const g = gateFrame(b, x, z, Math.PI / 2);
  for (const s of [-1, 1]) {
    g.bx('ash', s * 1.02, top + 0.16, 0, 0.42, 0.32, 0.6, 0x3e3a44);
    g.bx('wood', s * 1.02, top + 1.72, 0, 0.24, 3.1, 0.3, 0x2a1e18);
    g.bx('metal', s * 0.72, top + 3.34, -0.2, 0.16, 0.16, 0.18, 0x6a5a3a);
  }
  g.bx('wood', 0, top + 3.34, 0, 2.32, 0.3, 0.34, 0x2e2218);
  g.bx('roof', 0, top + 3.58, 0, 2.72, 0.16, 0.9, 0x141218);
  g.bx('roof', 0, top + 3.7, 0, 2.9, 0.1, 0.4, 0x1e1c24);
  b.kit('fengdu.doorStele.frame', 1, top + 3.3);
  g.bx('ash', 0, top + 0.15, 0, 1.7, 0.3, 0.78, 0x413d4a);
  g.bx('ash', 0, top + 0.4, 0, 1.42, 0.24, 0.62, 0x4a4652);
  g.bx('ash', 0, top + 1.46, 0, 1.26, 1.9, 0.34, 0x565460);
  g.py('ash', 0.14, 0.7, 0, top + 2.6, 0, 0x4a4652, 1, 0.44, 0.52);
  for (let i = 0; i < 4; i++) {
    g.bx('glow', -0.16, top + 2.14 - i * 0.26, -0.185, 0.62 - (i % 2) * 0.14, 0.05, 0.03, 0x2a7a5a);
  }
  g.bx('lacquer', 0.3, top + 1.06, -0.185, 0.2, 0.2, 0.03, 0xa8302a);
  b.kit('fengdu.doorStele', 1, top + 1.4);
  b.kit('fengdu.doorStele.inscription', 4, top + 1.8);
  g.bx('ash', 1.5, top + 0.12, -0.2, 0.46, 0.24, 0.46, 0x3e3a44);
  g.bx('ash', 1.5, top + 0.66, -0.2, 0.26, 0.86, 0.26, 0x4a4652);
  g.bx('glow', 1.5, top + 1.2, -0.2, 0.18, 0.26, 0.18, 0x3dff9c);
  g.bx('ash', 1.5, top + 1.36, -0.2, 0.4, 0.1, 0.4, 0x413d4a);
  b.kit('fengdu.doorStele.lamp', 1, top + 1.2);
}

/** 8 无名神龛（D-ITM-0179）：石台 + 敞口龛（龛中唯雾）+ 龛檐 + 供器 + 幡带 */
function fengduNamelessShrine(b: Baker, x: number, z: number, top: number): void {
  const g = gateFrame(b, x, z, Math.PI / 2);
  g.bx('ash', 0, top + 0.43, 0, 2.7, 0.86, 2.3, 0x3e3a44);
  g.bx('ash', 0, top + 0.9, 0, 2.5, 0.1, 2.1, 0x4c4854);
  g.bx('ash', 0, top + 0.16, -1.3, 2.0, 0.32, 0.5, 0x413d4a);
  g.bx('ash', 0, top + 0.46, -1.2, 2.0, 0.28, 0.36, 0x4a4652);
  b.kit('fengdu.namelessShrine.plinth', 3, top + 0.4);
  // 龛体：底板 + 背板 + 两侧板 + 顶板，正面（local −z）敞开
  g.bx('ash', 0, top + 1.03, 0, 2.3, 0.14, 1.9, 0x4a4652);
  g.bx('ash', 0, top + 2.05, 0.82, 2.3, 1.9, 0.26, 0x413d4a);
  for (const s of [-1, 1]) g.bx('ash', s * 1.0, top + 2.05, -0.06, 0.3, 1.9, 1.7, 0x413d4a);
  g.bx('ash', 0, top + 3.1, -0.06, 2.4, 0.3, 2.0, 0x4a4652);
  g.bx('ash', 0, top + 3.26, -0.06, 2.1, 0.12, 1.7, 0x3a3642);
  b.kit('fengdu.namelessShrine.niche', 1, top + 2.2);
  // 龛中唯雾：三团灰白雾 + 一点冷光，无人像
  g.bx('ash', 0, top + 1.55, -0.1, 1.14, 0.9, 1.0, 0x8e929a);
  g.bx('ash', 0.18, top + 2.0, -0.2, 0.72, 0.5, 0.66, 0x9aa0a8);
  g.bx('fabric', -0.2, top + 1.4, 0.05, 0.7, 0.62, 0.6, 0x7a828a);
  g.bx('glow', 0, top + 1.5, 0.66, 0.5, 0.36, 0.03, 0x4a5a66);
  b.kit('fengdu.namelessShrine.mist', 3, top + 1.7);
  g.rf('roof', 0, top + 3.3, -0.06, 0x13111a, 3.4, 0.85, 2.6);
  g.bx('roof', 0, top + 4.12, -0.06, 3.0, 0.12, 0.26, 0x1e1c24);
  b.kit('fengdu.namelessShrine.eave', 1, top + 3.4);
  // 供器：香炉 + 三炷香 + 双烛
  g.cy('metal', 0.22, 0.17, 0.24, 10, 0, top + 1.24, -0.5, 0x4a4238);
  g.cy('metal', 0.25, 0.22, 0.08, 10, 0, top + 1.38, -0.5, 0x554a3c);
  for (let i = 0; i < 3; i++) {
    g.bx('glow', -0.1 + i * 0.1, top + 1.62, -0.5, 0.018, 0.34, 0.018, 0xffcf90);
    g.bx('glow', -0.1 + i * 0.1, top + 1.8, -0.5, 0.03, 0.05, 0.03, 0xff7a2d);
  }
  for (const s of [-1, 1]) {
    g.cy('metal', 0.05, 0.06, 0.34, 8, s * 0.62, top + 1.29, -0.5, 0x4a4238);
    g.bx('glow', s * 0.62, top + 1.5, -0.5, 0.06, 0.14, 0.06, 0xffcf90);
  }
  b.kit('fengdu.namelessShrine.offering', 1, top + 1.3);
  // 幡带：檐角两条，风停幡不停
  for (const s of [-1, 1]) {
    g.bx('fabric', s * 1.34, top + 2.76, -0.5, 0.22, 0.92, 0.03, s < 0 ? 0x5c1b24 : 0x24483a, 0, 0, s * 0.08);
    g.bx('metal', s * 1.34, top + 3.22, -0.5, 0.06, 0.06, 0.06, 0x4a4650);
  }
  b.kit('fengdu.namelessShrine.banner', 2, top + 2.8);
  b.kit('fengdu.namelessShrine', 1, top);
}
