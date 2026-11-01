import * as THREE from 'three';
import { RNG } from '../core/rng';
import { Baker, SignMesher, SignAtlas, shade } from './bake';
import { C } from './buildings';
import { SpotRegistry } from '../data/jobs';
import { bowl, jar, tray, cabinet, scrollRack, censer, vase, umbrella, book, fan, table, stool } from './itemKit';
import { buildPavementDetail } from './pavement';
import { flowerBush } from './interiors';
import { RIVER_END, riverCenterZ, riverHalfWidth } from './river';

// ============ 市井道具：地面/街面/摊位/柳树/灯笼/纸鸢 ============
export interface StallInfo { x: number; z: number; y: number; ry: number; kind: 'stall' | 'food' | 'fortune' | 'letter'; label: string }

// 街面/广场数据（buildGround 与 ISS-31 石板铺装层共用，保证石板落在真实街面上）
export const STREETS_H = [
  { x0: -600, x1: 452, z: 52, w: 11 }, { x0: -560, x1: 440, z: -52, w: 9 },
  { x0: 120, x1: 440, z: 96, w: 8 }, { x0: 470, x1: 620, z: 52, w: 11 },
];
export const STREETS_V = [
  { z0: -120, z1: 96, x: -420, w: 7 }, { z0: -96, z1: 96, x: -238, w: 8 }, { z0: -96, z1: 52, x: -60, w: 6 },
  { z0: 52, z1: 96, x: 60, w: 6 }, { z0: -96, z1: -52, x: 60, w: 6 }, { z0: 52, z1: 96, x: 190, w: 7 },
  { z0: 52, z1: 96, x: 300, w: 7 }, { z0: -52, z1: 96, x: 396, w: 7 }, { z0: -60, z1: 240, x: 560, w: 8 },
];
export const PLAZAS = [
  { x: 250, z: 78, w: 200, d: 34 }, { x: -40, z: -68, w: 120, d: 26 },
];

export function buildGround(b: Baker): void {
  // 归因标签：地坪构件一律打 `ground.*` kit，令 `assetAudit.detail` 可按模块统计。
  // 之前排查「桥区那片近黑地坪是谁铺的」时，因为没有标签只能靠 grep 常量与顶点色反查，三轮未果。
  b.kit('ground.slabN', 1, 0);
  b.box('ground', 1320, 0.5, 396, 0, -0.25, 228, 0x877959);
  b.kit('ground.slabS', 1, 0);
  b.box('ground', 1320, 0.5, 396, 0, -0.25, -228, shade(0x877959, 0.94));
  // 河床：城内 1320 段仍是直槽；城外按 ±5600 铺 6 段，横向随蜿蜒漂移，
  // 否则水面延伸出去而河床没有，水会像一条悬空的槽。
  b.kit('ground.riverBed', 1, -2.5);
  // 河床/河道：原 0x1c2a34 在黄昏光照下线性仅 [3,6,9]/255，读成一块纯黑空洞
  //（桥东那片「孤零零的空地」就是它：groundTrace 实测 hex=0x1c2a34、y=−2、span=201、c=[3,6,9]）。
  // 改成可读的深水蓝，俯视时才像河而不是洞。
  b.box('ground', 1320, 0.5, 60, 0, -2.5, 0, 0x24455c);
  // 城外河床：宽度/蜿蜒必须与 river.ts 的水带同源（旧式 out^1.35 蜿蜒在 x=4000 处把河心推到 z≈51，
  // 河床与水带双双钻进河岸商业带）。现在两处共用 riverCenterZ / riverHalfWidth，河床比水面宽 6m。
  for (const sg of [-1, 1] as const) {
    for (let x = RIVER_END; x > 600; x -= 200) {
      const x1 = Math.max(600, x - 200);
      const mx = sg * ((x + x1) / 2);
      b.box('ground', x - x1 + 2, 0.5, riverHalfWidth(mx) * 2 + 6, mx, -2.3, riverCenterZ(mx), 0x24455c);
    }
  }
  // 岸坡
  b.kit('ground.bankSlope', 2, -0.82);
  for (const s of [1, -1]) {
    b.box('ground', 1320, 0.5, 12.6, 0, -0.82, s * 36.2, shade(0x7c6f52, 1), 0, s * 0.128, 0);
  }
  // ---- 汴河石砌驳岸：岸墙 + 压顶 + 望柱 + 纤道（原两岸是裸坡，河像一条水沟） ----
  for (const s of [1, -1]) {
    b.box('wall', 1240, 2.0, 1.4, 10, 0.1, s * 30.6, shade(0x6a6055, 1));
    b.box('wall', 1240, 0.26, 1.8, 10, 1.24, s * 30.6, shade(0x7d7264, 1.02));
    for (let x = -600; x <= 620; x += 11) {
      b.box('wall', 0.42, 0.95, 0.42, x, 1.78, s * 30.6, shade(0x7d7264, 1.06));
      if ((x / 11) % 3 === 0) b.box('glow', 0.14, 0.18, 0.14, x, 2.32, s * 30.6, s > 0 ? 0x00e5ff : 0xffb300);
    }
    // 临水踏步：每 180m 一处，可下到水面
    for (const sx of [-420, -238, -60, 180, 400]) {
      for (let st = 0; st < 3; st++) {
        b.box('wall', 9, 0.34, 1.1, sx, 0.9 - st * 0.34, s * (31.2 + st * 0.9), shade(0x6a6055, 1.04 - st * 0.04));
      }
    }
  }
  // 南岸纤道（船工拉纤的硬土带）
  b.kit('ground.towpath', 2, 0.05);
  b.box('ground', 1240, 0.12, 4.6, 10, 0.05, -34.2, shade(0x6e6557, 1.0));
  b.box('ground', 1240, 0.08, 1.2, 10, 0.11, -32.0, shade(0x7a705f, 1.02));
  // 街面
  for (const st of STREETS_H) {
    b.box('ground', st.x1 - st.x0, 0.14, st.w, (st.x0 + st.x1) / 2, 0.04, st.z, shade(C.road, 1));
  }
  for (const st of STREETS_V) {
    b.box('ground', st.w, 0.14, st.z1 - st.z0, st.x, 0.04, (st.z0 + st.z1) / 2, shade(C.road, 0.97));
  }
  // 城内铺装：把两片裸沙地压成街区块地面，空地读作城里而非城外荒滩
  for (const s of [1, -1]) {
    b.box('ground', 1240, 0.06, 116, 10, 0.015, s * 92, shade(C.road, 0.9));
    b.box('ground', 1240, 0.04, 8, 10, 0.05, s * 118, shade(C.road, 1.02));
  }
  // 东西向巷道（街区内部通路）
  for (const z of [70, 108, -70, -108]) {
    b.box('ground', 1240, 0.05, 5.5, 10, 0.035, z, shade(C.road, 0.96));
  }
  // 市集广场
  for (const pz of PLAZAS) {
    b.box('ground', pz.w, 0.15, pz.d, pz.x, 0.045, pz.z, shade(C.road, pz.x > 0 ? 1.1 : 1.05));
  }
  // 街道霓虹嵌入线已移除（空中呈光格网格伪影）
  // ---- WS-32 码头水工 6 件：随驳岸/河岸一起落位，不新增构建入口 ----
  buildWharfWorks(b);
  // ---- R1：河道贯通——城外 4.4km 石砌驳岸沿河铺到城墙内皮，两端石拱涵洞收口，桥头泊船 ----
  buildRiverEdges(b);
  // ---- WS-41 户外 27 件：渔村 / 渡口 / 仓区 / 驿路 / 庙市仙苑 / 城缘（同批烘焙） ----
  buildWs41Outdoor(b);
  // ---- WS-45 铺装分层 / 广场纹样 / 郊野土路：石板之上的薄件层，与地坪同批烘焙，0 新增 draw call ----
  buildPavementDetail(b);
}

/**
 * 主枝端点：与 Baker.push 的欧拉序一致（rx=sin a·pitch、rz=-cos a·pitch 把 +Y 倾到方位 a）。
 * 返回长度为 len 的枝梢位移，让"画进去的枝"和"摆上去的团"共用同一套朝向，不会枝冠错位。
 */
function boughTip(a: number, pitch: number, len: number): [number, number, number] {
  const ca = Math.cos(a) * pitch, sa = Math.sin(a) * pitch, cz = Math.cos(ca);
  return [Math.sin(ca) * len, cz * Math.cos(sa) * len, cz * Math.sin(sa) * len];
}

/**
 * 垂柳：三段收分干（微倾）→ 四主枝（带俯仰）→ 八团球冠 → 十八条垂丝（三段渐细）。
 * 旧版冠是 6 团"截锥+顶锥"、柳丝是 9 根开口锥，侧看是一摞盘子；现在干分段收分、冠是压扁球团、
 * 柳丝用盒片三段收窄，才有一眼认得出的垂柳剪影。伪随机由坐标决定，重建不跳位。
 */
export function willow(b: Baker, x: number, z: number, s: number, cyber: boolean): void {
  let seed = (Math.imul(Math.round(x * 17 + z * 31) ^ 0x9e3779b9, 2654435761) >>> 0) || 7;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const trunkC = shade(0x4a3520, 0.92 + rnd() * 0.16);
  const leafBase = cyber ? 0x2a7a72 : 0x466e3e;
  const lean = (rnd() - 0.5) * 0.12;
  const h = 3.4 * s;
  const ta = rnd() * Math.PI * 2;
  // 根：底盘鼓起 + 四条外张板根（临水柳的根颈是剪影的一部分）
  b.cyl('trunk', 0.28 * s, 0.5 * s, 0.36 * s, 8, x, 0.18 * s, z, shade(trunkC, 0.88));
  for (let i = 0; i < 4; i++) {
    const a = ta + (i / 4) * Math.PI * 2 + rnd() * 0.5;
    const p = 1.14 + rnd() * 0.18;
    const [dx, dy, dz] = boughTip(a, p, 0.62 * s);
    b.cyl('trunk', 0.05 * s, 0.17 * s, 0.62 * s, 5, x + dx * 0.5, 0.12 * s + dy * 0.5, z + dz * 0.5,
      shade(trunkC, 0.82), 0, Math.sin(a) * p, -Math.cos(a) * p);
  }
  // 三段收分干：0.29→0.235→0.165→0.10，逐段加俯仰，整棵树微微弯过去（柳干不直）
  let cx = x, cy = 0.3 * s, cz = z;
  const segH = [0.5, 0.34, 0.22];
  const segR = [0.29, 0.235, 0.165, 0.1];
  for (let i = 0; i < 3; i++) {
    const len = h * segH[i] * 1.05;
    const p = 0.05 + lean * (2 + i) + i * 0.02;
    const [dx, dy, dz] = boughTip(ta, p, len);
    b.cyl('trunk', segR[i + 1] * s, segR[i] * s, len, 7, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
      shade(trunkC, 0.98 + i * 0.05), 0, Math.sin(ta) * p, -Math.cos(ta) * p);
    cx += dx; cy += dy; cz += dz;
  }
  const topX = cx, topY = cy, topZ = cz;
  const crownY = topY + 0.4 * s;
  // 四主枝：俯仰 52°~65°，梢头各顶一团冠
  const tips: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const a = ta + (i / 4) * Math.PI * 2 + rnd() * 0.45;
    const p = 0.92 + rnd() * 0.22;
    const len = (1.35 + rnd() * 0.5) * s;
    const [dx, dy, dz] = boughTip(a, p, len);
    const by0 = topY - 0.18 * s;
    b.cyl('trunk', 0.05 * s, 0.105 * s, len, 5, topX + dx * 0.5, by0 + dy * 0.5, topZ + dz * 0.5,
      shade(trunkC, 1.05), 0, Math.sin(a) * p, -Math.cos(a) * p);
    tips.push([topX + dx, by0 + dy, topZ + dz]);
  }
  // 冠：八团压扁球（同色两档），芯团压顶、外团落在主枝梢头
  const clumps: [number, number, number, number][] = [
    [0, 0.6, 0, 1.55], [0, 1.0, -0.05, 1.02], [-0.28, 0.12, -0.95, 1.0], [0.26, 0.16, 0.9, 1.04],
  ];
  clumps.forEach(([ox, oy, oz, cs], i) => {
    const r = cs * s;
    b.sphere('leaf', r, 7, topX + ox * s, crownY + oy * s, topZ + oz * s,
      shade(leafBase, 0.88 + i * 0.05 + rnd() * 0.05), rnd() * 3.14, 0, 0, 1.1, 0.82, 1.1);
  });
  tips.forEach(([tx, ty, tz], i) => {
    const r = (0.82 + rnd() * 0.26) * s;
    b.sphere('leaf', r, 7, tx, ty + 0.12 * s, tz, shade(leafBase, 0.95 + i * 0.04 + rnd() * 0.05),
      rnd() * 3.14, 0, 0, 1.12, 0.78, 1.12);
  });
  // 冠缘叶簇：12 团小球咬在冠面外缘，把"八个球"的球缘打碎成叶团的起伏
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.5;
    const rr = (1.0 + rnd() * 0.62) * s;
    b.sphere('leaf', (0.33 + rnd() * 0.2) * s, 5, topX + Math.cos(a) * rr,
      crownY + (0.52 + (rnd() - 0.5) * 0.95) * s, topZ + Math.sin(a) * rr,
      shade(leafBase, 1.0 + rnd() * 0.13), rnd() * 3.14, 0, 0, 1.16, 0.8, 1.16);
  }
  // 柳丝：冠缘 18 条，每条三段盒片（0.42/0.34/0.24），宽 0.13→0.085→0.04 渐细，垂 2~4m
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.5;
    const rr = (0.84 + rnd() * 0.8) * s;
    const drop = (2.0 + rnd() * 2.0) * (0.72 + 0.28 * s);
    const fx = topX + Math.cos(a) * rr, fz = topZ + Math.sin(a) * rr;
    const fy = crownY + (0.42 - rnd() * 0.9) * s;
    const sway = (rnd() - 0.5) * 0.2;
    const y1 = fy - drop * 0.44, y2 = fy - drop * 0.76, y3 = fy - drop;
    const c = shade(leafBase, 1.04 + rnd() * 0.12);
    b.box('leaf', 0.13 * s, (fy - y1) * 1.04, 0.03 * s, fx, (fy + y1) / 2, fz, c, a, 0, sway);
    b.box('leaf', 0.085 * s, (y1 - y2) * 1.04, 0.026 * s, fx + Math.sin(a) * sway * 0.12, (y1 + y2) / 2, fz + Math.cos(a) * sway * 0.12,
      shade(c, 1.06), a, 0, sway * 1.6);
    b.box('leaf', 0.04 * s, (y2 - y3) * 1.04, 0.02 * s, fx + Math.sin(a) * sway * 0.24, (y2 + y3) / 2, fz + Math.cos(a) * sway * 0.24,
      shade(c, 1.12), a, 0, sway * 2.3);
  }
  b.kit('flora.willow', 1, 0);
  b.kit('flora.willowClump', 8, crownY);
  b.kit('flora.willowFrond', 18, crownY);
}

/**
 * 松柏：根鼓 + 两段收分干 + 五层球状叶团（每层 3 个压扁球，自下而上收小）+ 顶梢尖团。
 * 旧版是 5 层开口锥套成"塔"，锥面在近景是平的；针叶感改由"层间咬合 + 球面碎化"承担——
 * 球竖向半高大于层距，层与层之间没有透光缝，远看仍是一支实心塔冠。
 */
export function conifer(b: Baker, x: number, z: number, s: number, dark = false): void {
  let seed = (Math.imul(Math.round(x * 23 + z * 11) ^ 0x85ebca6b, 2246822519) >>> 0) || 11;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 374761393) >>> 0) / 4294967296);
  const trunkC = dark ? 0x33281c : 0x3f3020;
  const leafC = dark ? 0x2a4a34 : 0x35603c;
  const h = (5.4 + rnd() * 2.2) * s;
  const lean = (rnd() - 0.5) * 0.05;
  b.cyl('trunk', 0.3 * s, 0.46 * s, 0.52 * s, 7, x, 0.26 * s, z, shade(trunkC, 0.9));
  b.cyl('trunk', 0.16 * s, 0.31 * s, h * 0.44, 7, x, 0.52 * s + h * 0.22, z, trunkC, 0, lean, lean * 0.8);
  b.cyl('trunk', 0.08 * s, 0.17 * s, h * 0.52, 7, x + lean * 0.3 * s, 0.52 * s + h * 0.44 + h * 0.26, z, shade(trunkC, 1.05));
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = (1.9 - t * 1.32) * s * (0.92 + rnd() * 0.16);
    const cy2 = 1.2 * s + t * (h - 2.3 * s);
    const c = shade(leafC, 0.9 + i * 0.045 + rnd() * 0.05);
    b.sphere('leaf', r, 7, x, cy2, z, c, rnd() * 3.14, 0, 0, 1.24, 0.5, 1.24);
    for (let k = 0; k < 2; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * (0.52 + rnd() * 0.2);
      b.sphere('leaf', r * 0.64, 6, x + Math.cos(a) * rr, cy2 + (rnd() - 0.35) * 0.3 * s, z + Math.sin(a) * rr,
        shade(c, 1.07), rnd() * 3.14, 0, 0, 1.14, 0.54, 1.14);
    }
    b.kit('flora.coniferTier', 1, cy2);
  }
  // 顶梢：竖椭球收尖（旧版是单根开口锥）
  b.sphere('leaf', 0.36 * s, 6, x + lean * 0.5 * s, h - 0.2 * s, z, shade(leafC, 1.16), 0, 0, 0, 1, 2.0, 1);
  b.kit('flora.conifer', 1, h / 2);
}

/**
 * 仙桂：根鼓 + 两段短干 + 八团浑圆冠 + 冠缘 26 点金花。
 * 与柳（垂丝）、松柏（层塔）区分：冠更圆更矮、金花是"点"不是"团"，
 * 所以花用小球缀在冠缘而不是发光块——远看是一树碎金，近看是一团圆叶。
 */
export function osmanthus(b: Baker, x: number, z: number, s: number): void {
  let seed = (Math.imul(Math.round(x * 13 + z * 29) ^ 0x1b873593, 2654435761) >>> 0) || 13;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const trunkC = 0x4a3a26;
  const leafC = 0x35583a;
  const h = (2.6 + rnd() * 0.9) * s;
  const ta = rnd() * Math.PI * 2;
  b.cyl('trunk', 0.3 * s, 0.44 * s, 0.4 * s, 7, x, 0.2 * s, z, shade(trunkC, 0.92));
  let cx = x, cy = 0.34 * s, cz = z;
  const segR = [0.29, 0.185, 0.115];
  const segH = [0.56, 0.5];
  for (let i = 0; i < 2; i++) {
    const len = h * segH[i] * 1.06;
    const a = ta + i * 0.6;
    const p = 0.05 + (rnd() - 0.5) * 0.12;
    const [dx, dy, dz] = boughTip(a, p, len);
    b.cyl('trunk', segR[i + 1] * s, segR[i] * s, len, 7, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
      shade(trunkC, 0.98 + i * 0.08), 0, Math.sin(a) * p, -Math.cos(a) * p);
    cx += dx; cy += dy; cz += dz;
  }
  // 冠：八团压扁球（内收外放），中心 lifted 0.5s
  const crownY = cy + 0.5 * s;
  const clumps: [number, number, number, number][] = [
    [0, 0.28, 0, 1.32], [-0.78, 0.08, 0.3, 1.02], [0.74, 0.04, -0.26, 0.98],
    [0.2, 0.52, 0.68, 0.86], [-0.24, 0.48, -0.72, 0.82], [0.9, 0.3, 0.5, 0.74],
    [-0.86, 0.36, -0.32, 0.76], [0.05, 0.68, -0.05, 0.8],
  ];
  clumps.forEach(([ox, oy, oz, cs], i) => {
    const r = cs * s;
    b.sphere('leaf', r, 7, cx + ox * s, crownY + oy * s, cz + oz * s,
      shade(leafC, 0.9 + i * 0.045 + rnd() * 0.05), rnd() * 3.14, 0, 0, 1.08, 0.86, 1.08);
  });
  // 金花：26 点小球（0.05~0.07m），缀在冠下缘——夜里也读得出"桂"
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.6;
    const rr = (0.72 + rnd() * 0.8) * s;
    b.sphere('leaf', (0.042 + rnd() * 0.022) * s, 4, cx + Math.cos(a) * rr,
      crownY + (-0.5 + rnd() * 0.86) * s, cz + Math.sin(a) * rr, i % 3 ? 0xf0c860 : 0xf7dc8e);
  }
  b.kit('flora.osmanthusCrown', 8, crownY);
  b.kit('flora.osmanthus', 1, h / 2);
}

/**
 * 青莲：水面荷叶 + 荷花（贴水面 y≈1.02，供汴河近岸与瑶池使用）
 * 叶为扁圆盘；花改成"外 8 瓣 + 内 6 瓣"的薄刃层叠 + 花托 + 露珠，
 * 旧版是内外两层开口锥——俯看是两圈深色圆环，不像莲。
 */
export function lotus(b: Baker, x: number, z: number, s: number, waterY = 1.02): void {
  let seed = (Math.imul(Math.round(x * 7 + z * 19) ^ 0x27d4eb2f, 2246822519) >>> 0) || 17;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const pads = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < pads; i++) {
    const a = (i / pads) * Math.PI * 2 + rnd();
    const rr = (0.6 + rnd() * 1.5) * s;
    // 叶径 1.1~1.4m（原 0.7m 在近岸俯视读作萍不读作莲）
    const pd = (0.55 + rnd() * 0.15) * s;
    const py = waterY + 0.02 + rnd() * 0.05 * s;
    b.cyl('leaf', pd * 0.86, pd, 0.05, 10, x + Math.cos(a) * rr, py, z + Math.sin(a) * rr,
      shade(0x2f6a42, 0.86 + rnd() * 0.22), rnd() * 3.14, rnd() * 0.12, 0, false);
    b.kit('flora.lotusPad', 1, waterY);
  }
  const fw = 1.3;
  const flowers = 1 + (rnd() > 0.5 ? 1 : 0);
  for (let i = 0; i < flowers; i++) {
    const a = rnd() * Math.PI * 2, rr = (0.5 + rnd() * 0.9) * s;
    const fx = x + Math.cos(a) * rr, fz = z + Math.sin(a) * rr;
    const fb = waterY + 0.15;
    const fs = s * fw;
    b.cyl('leaf', 0.03 * fs, 0.05 * fs, 0.34 * fs, 5, fx, fb + 0.12 * fs, fz, 0x3e6a42);
    // 外瓣 8：薄刃外张 58°~68°
    for (let k = 0; k < 8; k++) {
      const pa = (k / 8) * Math.PI * 2 + a * 2 + rnd() * 0.14;
      const pp = 0.98 + rnd() * 0.2;
      const len = 0.4 * fs;
      const [dx, dy, dz] = boughTip(pa, pp, len * 0.5);
      b.cyl('leaf', 0.014 * fs, 0.078 * fs, len, 4, fx + dx, fb + 0.26 * fs + dy, fz + dz,
        k % 2 ? 0xcf7aa6 : 0xe8a6bc, 0, Math.sin(pa) * pp, -Math.cos(pa) * pp, false, 1, 1, 0.52);
    }
    // 内瓣 6：更陡更短，围住花托
    for (let k = 0; k < 6; k++) {
      const pa = (k / 6) * Math.PI * 2 + a * 2 + 0.5;
      const pp = 0.52 + rnd() * 0.16;
      const len = 0.27 * fs;
      const [dx, dy, dz] = boughTip(pa, pp, len * 0.5);
      b.cyl('leaf', 0.012 * fs, 0.056 * fs, len, 4, fx + dx, fb + 0.34 * fs + dy, fz + dz,
        0xf0c2d2, 0, Math.sin(pa) * pp, -Math.cos(pa) * pp, false, 1, 1, 0.5);
    }
    b.cyl('leaf', 0.085 * fs, 0.06 * fs, 0.12 * fs, 6, fx, fb + 0.46 * fs, fz, 0xd8c460);
    b.sphere('glow', 0.035 * fs, 4, fx, fb + 0.54 * fs, fz, 0xfff3d0);
    b.kit('flora.lotusFlower', 1, fb + 0.46 * fs);
  }
  b.kit('flora.lotus', 1, waterY);
}

/** 牧草：郊野草丛——6~10 片斜出叶带，给城外大片裸地一个地表层 */
export function pasture(b: Baker, x: number, z: number, s: number): void {
  let seed = (Math.imul(Math.round(x * 31 + z * 17) ^ 0x9e3779b9, 2246822519) >>> 0) || 19;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const n = 6 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const lean = 0.18 + rnd() * 0.28;
    const hh = (0.55 + rnd() * 0.7) * s; // 丛高上限 1.05 → 1.25
    b.box('leaf', 0.07 * s, hh, 0.12 * s, x + Math.cos(a) * 0.18 * s, hh / 2, z + Math.sin(a) * 0.18 * s,
      shade(0x86923c, 0.82 + rnd() * 0.3), a, lean * Math.cos(a), lean * Math.sin(a));
  }
  b.kit('flora.pasture', 1, 0);
}

/**
 * 迎宾茶灶：砖砌灶台 + 铜壶 + 烟囱 + 茶旗——驿路与村口的施茶点
 * 自下而上组装：砖灶身 → 灶膛火 → 灶面灶眼 → 铜壶 → 烟囱 → 茶旗 → 茶案茶碗
 */
export function teaStove(b: Baker, x: number, z: number, s: number, ry = 0, y0 = 0): void {
  let seed = (Math.imul(Math.round(x * 43 + z * 11) ^ 0x85ebca6b, 2246822519) >>> 0) || 37;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  const brick = 0x8a5a44;
  const brass = 0xb87333;
  // 砖砌灶身：三层错缝收分
  for (let k = 0; k < 3; k++) {
    b.box('earth', (1.5 - k * 0.14) * s, 0.22 * s, (1.05 - k * 0.08) * s, x, y0 + (0.11 + k * 0.22) * s, z,
      shade(brick, 0.88 + (k % 2) * 0.14), ry);
  }
  // 灶膛：深色膛口衬暖火——夜里驿路上唯一一眼认得出的暖点
  const [fx, fz] = at(0, 0.53 * s);
  b.box('trunk', 0.62 * s, 0.38 * s, 0.14 * s, fx, y0 + 0.3 * s, fz, 0x1c1410, ry);
  b.box('glow', 0.5 * s, 0.26 * s, 0.08 * s, fx, y0 + 0.28 * s, fz, 0xff7a2a, ry);
  // 灶面石板 + 三个灶眼
  b.box('ash', 1.58 * s, 0.1 * s, 1.12 * s, x, y0 + 0.72 * s, z, shade(0x8c857a, 1.03), ry);
  for (let i = 0; i < 3; i++) {
    const [px2, pz2] = at((i - 1) * 0.42 * s, -0.12 * s);
    b.cyl('ash', 0.24 * s, 0.24 * s, 0.06 * s, 9, px2, y0 + 0.8 * s, pz2, 0x2a2622, ry);
  }
  // 铜壶两口：壶身 + 壶盖 + 提梁 + 壶嘴
  for (let i = 0; i < 2; i++) {
    const [hx, hz] = at((i ? 1 : -1) * 0.42 * s, -0.12 * s);
    const hy = y0 + 0.88 * s;
    b.cyl('metal', 0.25 * s, 0.32 * s, 0.36 * s, 10, hx, hy, hz, shade(brass, 0.94 + i * 0.12), ry);
    b.cyl('metal', 0.1 * s, 0.2 * s, 0.1 * s, 8, hx, hy + 0.22 * s, hz, shade(brass, 1.14), ry);
    b.box('metal', 0.36 * s, 0.05 * s, 0.05 * s, hx, hy + 0.32 * s, hz, 0x8a5a2a, ry);
    const [sx2, sz2] = at((i ? 1 : -1) * 0.42 * s, 0.26 * s);
    b.cyl('metal', 0.035 * s, 0.06 * s, 0.3 * s, 6, sx2, hy + 0.04 * s, sz2, shade(brass, 1.02), 0, 1.1, 0);
  }
  // 烟囱：后左角，砖身 + 瓦帽
  const [cx2, cz2] = at(-0.52 * s, -0.42 * s);
  b.box('earth', 0.34 * s, 0.5 * s, 0.34 * s, cx2, y0 + 0.3 * s, cz2, shade(brick, 0.94), ry);
  b.cyl('earth', 0.14 * s, 0.19 * s, 1.7 * s, 8, cx2, y0 + 1.3 * s, cz2, shade(brick, 0.86), ry);
  b.box('roof', 0.52 * s, 0.1 * s, 0.52 * s, cx2, y0 + 2.2 * s, cz2, shade(C.tile2, 0.92), ry + Math.PI / 4);
  // 茶旗：立杆 + 横挑 + 布幡 + 杆顶灯（远处先看见这面幡）
  const [gx2, gz2] = at(0.96 * s, 0.46 * s);
  b.cyl('wood', 0.055 * s, 0.07 * s, 2.5 * s, 5, gx2, y0 + 1.25 * s, gz2, C.woodDark, ry);
  b.box('wood', 0.8 * s, 0.08 * s, 0.08 * s, gx2 - 0.36 * s * c, y0 + 2.36 * s, gz2 + 0.36 * s * sn, C.woodDark, ry);
  b.box('fabric', 0.62 * s, 0.78 * s, 0.03 * s, gx2 - 0.36 * s * c, y0 + 1.94 * s, gz2 + 0.36 * s * sn, shade(0xd8c8a0, 0.98), ry);
  b.box('glow', 0.1 * s, 0.1 * s, 0.1 * s, gx2, y0 + 2.52 * s, gz2, 0xffb300);
  b.box('glow', 0.16 * s, 0.24 * s, 0.16 * s, gx2, y0 + 1.5 * s, gz2, 0xffcf8a);
  // 茶案：矮桌 + 三只茶碗 + 一只陶壶（摆在灶身侧后方，不挡灶膛火光）
  const [tx2, tz2] = at(-1.35 * s, 0.1 * s);
  b.box('wood', 1.15 * s, 0.07 * s, 0.52 * s, tx2, y0 + 0.42 * s, tz2, shade(C.wood, 1.04), ry);
  for (const sx3 of [-1, 1]) {
    const [lx, lz] = at(-1.35 * s + sx3 * 0.46 * s, 0.1 * s);
    b.box('wood', 0.08 * s, 0.4 * s, 0.08 * s, lx, y0 + 0.2 * s, lz, C.woodDark, ry);
  }
  for (let i = 0; i < 3; i++) {
    const [bx2, bz2] = at(-1.66 * s + i * 0.3 * s, 0.1 * s);
    b.cyl('ceramic', 0.075 * s, 0.055 * s, 0.08 * s, 7, bx2, y0 + 0.49 * s, bz2, shade(0xd8d8d0, 0.9 + rnd() * 0.12));
  }
  b.cyl('ceramic', 0.14 * s, 0.17 * s, 0.26 * s, 8, tx2 + 0.4 * s * c, y0 + 0.58 * s, tz2 - 0.4 * s * sn, shade(0x6a7a6a, 1.0));
  b.kit('flora.teaStove', 1, y0 + 0.6 * s);
  b.kit('flora.teaStovePot', 2, y0 + 0.9 * s);
  b.kit('flora.teaFlag', 1, y0 + 2.2 * s);
}

/**
 * 醉霞石榴：三干丛生小乔木 + 橙红果实（庭院树种）
 * 干分两段带俯仰（丛生石榴不是三根直棍），冠用压扁球团，果挂冠下缘、顶带宿萼。
 */
export function pomegranate(b: Baker, x: number, z: number, s: number): void {
  let seed = (Math.imul(Math.round(x * 37 + z * 23) ^ 0x1b873593, 2654435761) >>> 0) || 41;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const trunkC = 0x53402a;
  const leafC = 0x2f5a34;
  const h = (1.9 + rnd() * 0.6) * s;
  // 三干丛生：每干两段、逐段外张，单干会读成小柳树
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd() * 0.5;
    let sx2 = x + Math.cos(a) * 0.08 * s, sy2 = 0, sz2 = z + Math.sin(a) * 0.08 * s;
    for (let k = 0; k < 2; k++) {
      const len = h * (k ? 0.46 : 0.62) * (0.88 + rnd() * 0.2);
      const p = (0.12 + rnd() * 0.1) * (k ? 1.3 : 1);
      const [dx, dy, dz] = boughTip(a, p, len);
      b.cyl('trunk', (0.055 - k * 0.012) * s, (0.125 - k * 0.03) * s, len, 5,
        sx2 + dx * 0.5, sy2 + dy * 0.5, sz2 + dz * 0.5,
        shade(trunkC, 0.9 + i * 0.04 + k * 0.07), 0, Math.sin(a) * p, -Math.cos(a) * p);
      sx2 += dx; sy2 += dy; sz2 += dz;
    }
  }
  const crownY = h * 0.92;
  const clumps: [number, number, number, number][] = [
    [0, 0.45, 0, 1.1], [-0.64, 0.28, 0.26, 0.86], [0.62, 0.22, -0.3, 0.82],
    [0.16, 0.14, 0.64, 0.74], [-0.2, 0.64, -0.56, 0.68], [0.5, 0.66, 0.42, 0.62], [-0.5, 0.16, 0.5, 0.66],
  ];
  clumps.forEach(([ox, oy, oz, cs], i) => {
    const r = cs * s;
    b.sphere('leaf', r, 7, x + ox * s, crownY + oy * s, z + oz * s,
      shade(leafC, 0.88 + i * 0.045 + rnd() * 0.07), rnd() * 3.14, 0, 0, 1.06, 0.84, 1.06);
  });
  // 果实 12 枚：球形果 + 宿萼小锥，挂在冠下缘
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.4;
    const rr = (0.44 + rnd() * 0.68) * s;
    const fy = crownY - 0.42 * s + rnd() * 0.6 * s;
    const fx2 = x + Math.cos(a) * rr, fz2 = z + Math.sin(a) * rr;
    const fc = shade(0xe0738e, 0.9 + rnd() * 0.2);
    b.sphere('leaf', 0.095 * s, 5, fx2, fy, fz2, fc, rnd() * 3.14, 0, 0, 1, 1.12, 1);
    b.cyl('leaf', 0.03 * s, 0.052 * s, 0.06 * s, 4, fx2, fy + 0.11 * s, fz2, shade(fc, 0.62));
  }
  b.kit('flora.pomegranateCrown', 7, crownY);
  b.kit('flora.pomegranateFruit', 12, h * 0.85);
  b.kit('flora.pomegranate', 1, h / 2);
}

/**
 * 银霜橘：深绿密冠 + 覆霜白果（果园带与庭院）
 * 与石榴区分：不分干、冠更低更密，果小巧偏白，霜色压过橙色调。
 */
export function frostOrange(b: Baker, x: number, z: number, s: number): void {
  let seed = (Math.imul(Math.round(x * 17 + z * 47) ^ 0x9e3779b9, 2246822519) >>> 0) || 43;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const trunkC = 0x453a28;
  const leafC = 0x1f4a30;
  const h = (2.0 + rnd() * 0.7) * s;
  const ta = rnd() * Math.PI * 2;
  // 根鼓 + 两段短干（橘树干矮，冠几乎落到半腰）
  b.cyl('trunk', 0.26 * s, 0.38 * s, 0.34 * s, 6, x, 0.17 * s, z, shade(trunkC, 0.9));
  let cx = x, cy = 0.3 * s, cz = z;
  for (let i = 0; i < 2; i++) {
    const len = h * (i ? 0.42 : 0.48) * 1.05;
    const a = ta + i * 0.7;
    const p = 0.05 + (rnd() - 0.5) * 0.1;
    const [dx, dy, dz] = boughTip(a, p, len);
    b.cyl('trunk', (0.13 - i * 0.035) * s, (0.24 - i * 0.05) * s, len, 6, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
      shade(trunkC, 0.98 + i * 0.08), 0, Math.sin(a) * p, -Math.cos(a) * p);
    cx += dx; cy += dy; cz += dz;
  }
  const crownY = cy + 0.34 * s;
  const clumps: [number, number, number, number][] = [
    [0, 0.26, 0, 1.0], [-0.62, 0.12, 0.34, 0.86], [0.58, 0.08, -0.3, 0.84],
    [0.16, 0.46, 0.58, 0.72], [-0.2, 0.42, -0.62, 0.7], [0.7, 0.4, 0.4, 0.64], [-0.66, 0.34, -0.46, 0.66],
  ];
  clumps.forEach(([ox, oy, oz, cs], i) => {
    const r = cs * s;
    b.sphere('leaf', r, 7, x + ox * s, crownY + oy * s, z + oz * s,
      shade(leafC, 0.86 + i * 0.045 + rnd() * 0.08), rnd() * 3.14, 0, 0, 1.04, 0.82, 1.04);
  });
  // 白霜果 15 枚：小球果，四分之一带青；霜面另加一枚极小高光片（盒片）
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2 + rnd() * 0.35;
    const rr = (0.4 + rnd() * 0.68) * s;
    const fy = crownY - 0.4 * s + rnd() * 0.66 * s;
    const fx2 = x + Math.cos(a) * rr, fz2 = z + Math.sin(a) * rr;
    const fc = i % 4 === 0 ? 0xbcd8d4 : 0xdfeee8;
    b.sphere('leaf', 0.085 * s, 5, fx2, fy, fz2, shade(fc, 0.92 + rnd() * 0.14), rnd() * 3.14, 0, 0, 1, 1.1, 1);
    if (i % 4 === 0) b.box('leaf', 0.035 * s, 0.02 * s, 0.035 * s, fx2, fy + 0.075 * s, fz2, 0xe8f4f0);
  }
  b.kit('flora.frostOrangeCrown', 7, crownY);
  b.kit('flora.frostOrangeFruit', 15, h * 0.75);
  b.kit('flora.frostOrange', 1, h / 2);
}

const CANOPY = [0xa83a32, 0x2a7a8a, 0x8a5aa8, 0xa87a2a, 0x3a7a4a];
const FOOD_LABELS = ['香飲子', '灌肺炒肺', '旋煎羊白腸', '冰雪冷元子', '胖貝', '野味攤'];
const GOODS_LABELS = ['雜貨', '花擔', '果品', '紙畫', '日用家計', '繡品', '首飾', '故衣'];

import { inLandmarkKeepout } from './layout';

export function buildStalls(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG, spots: SpotRegistry): StallInfo[] {
  const out: StallInfo[] = [];
  const add = (x: number, z: number, y: number, ry: number, kind: StallInfo['kind']): void => {
    if (inLandmarkKeepout(x, z)) return;
    const label = kind === 'food' ? rng.pick(FOOD_LABELS) : kind === 'fortune' ? '測字卦攤' : kind === 'letter' ? '代書書信' : rng.pick(GOODS_LABELS);
    out.push({ x, z, y, ry, kind, label });
    spots.add(x, z, kind === 'food' ? 'food' : kind === 'fortune' ? 'fortune' : kind === 'letter' ? 'letter' : 'stall', y);
  };
  // 北岸市集（孙羊正店—瓦子一带）
  for (let i = 0; i < 14; i++) add(rng.range(140, 372), rng.range(62, 94), 0.1, rng.range(0, Math.PI), rng.chance(0.35) ? 'food' : 'stall');
  // 虹桥桥头密集摊
  for (let i = 0; i < 6; i++) add(rng.range(-40, 40), 40 + rng.range(2, 14), 0.1, rng.range(0, Math.PI), rng.chance(0.4) ? 'food' : 'stall');
  for (let i = 0; i < 4; i++) add(rng.range(-30, 30), -40 - rng.range(2, 12), 0.1, rng.range(0, Math.PI), 'stall');
  // 南岸市集
  for (let i = 0; i < 8; i++) add(rng.range(-120, 30), rng.range(-84, -56), 0.1, rng.range(0, Math.PI), rng.chance(0.3) ? 'food' : 'stall');
  // 码头
  for (let i = 0; i < 4; i++) add(rng.range(-260, -210), rng.range(46, 64), 0.1, rng.range(0, Math.PI), 'stall');
  // 城门内
  for (let i = 0; i < 3; i++) add(rng.range(480, 560), rng.range(60, 76), 0.1, rng.range(0, Math.PI), 'stall');
  // 卦摊/代书 固定
  add(-150, 44, 0.1, rng.range(0, Math.PI), 'fortune');
  add(330, 60, 0.1, rng.range(0, Math.PI), 'letter');

  for (const s of out) {
    const cos = Math.cos(s.ry), sin = Math.sin(s.ry);
    // 柜台
    b.box('wood', 2.5, 0.85, 1.1, s.x, 0.42 + s.y, s.z, shade(C.wood, 1), s.ry);
    // 四柱 + 斜棚
    for (const px of [-1.15, 1.15]) for (const pz of [-0.45, 0.45]) {
      b.box('wood', 0.09, 2.3, 0.09, s.x + cos * px + sin * pz, 1.15 + s.y, s.z - sin * px + cos * pz, C.woodDark, s.ry);
    }
    b.box('roof', 2.9, 0.1, 1.8, s.x, 2.4 + s.y, s.z, rng.pick(CANOPY), s.ry, 0.16);
    // 货品：柜台面上的小件用台面高度，落地家具用地面高度（旧版一律台面高度 → 柜/觚悬空）
    const counterTop = 0.845 + s.y;
    const ground = s.y;
    if (s.kind === 'food') {
      bowl(b, s.x + cos * -0.7 + sin * 0.1, counterTop, s.z - sin * -0.7 + cos * 0.1, 1);
      bowl(b, s.x + cos * 0.0 + sin * 0.1, counterTop, s.z - sin * 0.0 + cos * 0.1, 1);
      jar(b, s.x + cos * 0.72 + sin * 0.1, counterTop, s.z - sin * 0.72 + cos * 0.1, 0.75);
      umbrella(b, s.x + cos * -1.35, ground, s.z - sin * -1.35, 0.9);
    } else if (s.kind === 'fortune') {
      censer(b, s.x + cos * 0.2, counterTop, s.z - sin * 0.2, 0.9);
      scrollRack(b, s.x + cos * -1.2, ground, s.z - sin * -1.2, 0.85);
    } else if (s.kind === 'letter') {
      book(b, s.x + cos * 0.2, counterTop, s.z - sin * 0.2, 0.9);
      scrollRack(b, s.x + cos * -1.2, ground, s.z - sin * -1.2, 1);
    } else {
      jar(b, s.x + cos * -0.65 + sin * 0.1, counterTop, s.z - sin * -0.65 + cos * 0.1, 0.8);
      tray(b, s.x + cos * 0.25 + sin * 0.1, counterTop, s.z - sin * 0.25 + cos * 0.1, 0.85);
      fan(b, s.x + cos * 0.85 + sin * 0.1, counterTop, s.z - sin * 0.85 + cos * 0.1, 0.9);
      cabinet(b, s.x + cos * 1.45, ground, s.z - sin * 1.45, 0.55);
      vase(b, s.x + cos * 2.05, ground, s.z - sin * 2.05, 0.8);
      stool(b, s.x + cos * -1.3, ground, s.z - sin * -1.3, 1);
    }
    // 招幌 + 灯
    sg.quad(atlas.text(`stall_${s.x | 0}_${s.z | 0}`, s.label, 80, 220, {
      color: s.kind === 'food' ? '#ffe2b0' : '#d8f2ff', glow: s.kind === 'food' ? '#ff9a3c' : '#00e5ff',
      vertical: true, fontPx: 40, bg: 'rgba(8,10,16,0.6)',
    }), 0.85, 2.3, s.x + sin * 1.3, 1.9 + s.y, s.z + cos * 1.3, s.ry + Math.PI);
    b.box('glow', 0.3, 0.4, 0.3, s.x + cos * 1.3, 2.15 + s.y, s.z - sin * 1.3, s.kind === 'food' ? 0xff9a3c : C.neonCyan, 0, 0, 0);
  }
  return out;
}

/** 独立 LCG：植物/器物抖动专用随机源。不消耗共享 rng，既有柳/松/桂/莲/草的布局才不会整体漂移。 */
function scatterRnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** 落点到最近街心（街中线）的距离；落点不在该街范围内则该街不计 */
function streetGap(x: number, z: number): number {
  let g = Infinity;
  for (const s of STREETS_H) if (x > s.x0 && x < s.x1) { const d = Math.abs(z - s.z); if (d < g) g = d; }
  for (const s of STREETS_V) if (z > s.z0 && z < s.z1) { const d = Math.abs(x - s.x); if (d < g) g = d; }
  return g;
}

/** 簇心 + 极坐标抖动：半径 1.5~rMax、角度随机；不满足街/禁区/同种最小间距就重抽，8 次不成退回簇心（簇心均为原实测净空点） */
function scatter(rnd: () => number, cx: number, cz: number, rMax: number, minD: number, near: [number, number][], ok: (x: number, z: number) => boolean): [number, number] {
  for (let k = 0; k < 8; k++) {
    const a = rnd() * Math.PI * 2;
    const r = 1.5 + rnd() * (rMax - 1.5);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!ok(x, z)) continue;
    let clash = false;
    for (const [px, pz] of near) {
      const dx = x - px, dz = z - pz;
      if (dx * dx + dz * dz < minD * minD) { clash = true; break; }
    }
    if (!clash) return [x, z];
  }
  return [cx, cz];
}

export function buildTrees(b: Baker, rng: RNG): void {
  for (let x = -580; x < 430; x += rng.range(22, 40)) {
    willow(b, x + rng.range(-6, 6), 45.5, rng.range(0.85, 1.3), rng.chance(0.12));
    if (rng.chance(0.5)) willow(b, x + rng.range(-8, 8), -45.5 - rng.range(0, 6), rng.range(0.85, 1.3), rng.chance(0.12));
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-560, 600), z = rng.chance(0.5) ? rng.range(120, 380) : rng.range(-380, -120);
    willow(b, x, z, rng.range(0.9, 1.5), rng.chance(0.1));
  }
  // 松柏林带：城外与寺观周边（原只有柳树，缺常绿骨架）
  for (let i = 0; i < 22; i++) {
    const x = rng.range(-560, 620), z = rng.chance(0.5) ? rng.range(150, 320) : rng.range(-320, -150);
    conifer(b, x, z, rng.range(0.85, 1.35), rng.chance(0.5));
  }
  for (let i = 0; i < 8; i++) conifer(b, 540 + rng.range(-16, 16), 118 + rng.range(-14, 14), rng.range(0.8, 1.1), true);
  // 桃林两处（河岸桃花意象，第七轮植被细化）
  for (let i = 0; i < 9; i++) willow(b, -320 + i * 14 + rng.range(-3, 3), 40 + rng.range(0, 8), rng.range(0.7, 1.0), true);
  for (let i = 0; i < 7; i++) willow(b, 320 + i * 15 + rng.range(-3, 3), -44 - rng.range(0, 7), rng.range(0.7, 1.0), true);
  // 仙桂：寺院、官署、酒楼庭前（短冠金花，与柳/松柏区分）
  // 两株原在河心（534,−26 / 548,22，水面半宽 31）：官署随府衙南迁到新衙前，另一株挪到照壁东侧
  for (const [gx, gz] of [[586, -67], [534, -67], [470, 96], [300, 100], [-150, 98], [-268, -78], [150, -96], [372, 74]] as const) {
    osmanthus(b, gx + rng.range(-3, 3), gz + rng.range(-3, 3), rng.range(0.85, 1.25));
  }
  // 青莲：汴河近岸浅水带（贴水面，避开主航道 |z|<34）
  for (let x = -430; x < 430; x += rng.range(16, 30)) {
    if (Math.abs(x) < 40) continue; // 虹桥下留空
    const s2 = rng.range(0.8, 1.4);
    // 汴河水面 ±31（river.ts 水面 1320×62），莲丛贴水缘 27~29.5，不能放到岸上
    if (rng.chance(0.7)) lotus(b, x + rng.range(-4, 4), 27.5 + rng.range(-1.2, 1.6), s2, 1.02);
    if (rng.chance(0.62)) lotus(b, x + rng.range(-4, 4), -27.5 + rng.range(-1.6, 1.2), s2, 1.02);
  }
  // 牧草：城外田野与河滩（城内不种，免得穿透铺装）
  for (let i = 0; i < 120; i++) {
    const x = rng.range(-600, 620);
    const z = rng.chance(0.5) ? rng.range(120, 330) : rng.range(-330, -120);
    pasture(b, x, z, rng.range(0.9, 1.9));
  }
  // 庭院树与茶灶：簇心 + 极坐标抖动（半径 1.5~rMax、角度随机）+ 尺寸 0.85~1.25 随机。
  // 随机源走独立 LCG（scatterRnd），不消耗共享 rng —— 否则上游柳/松/桂/莲/草的取数会整体错位。
  // 簇心沿用原实测净空点，抖动只在其光环内；落点数量与 kit 计数不变（石榴 15 / 橘 17 / 茶灶 15）。
  // 两条硬约束：距街心 ≥5m（不占路面，茶灶硬要求）、不进地标禁入区。
  const prnd = scatterRnd(0x5eed2f1b);
  const size = (): number => 0.85 + prnd() * 0.40;
  const plantOk = (x: number, z: number): boolean => streetGap(x, z) >= 5 && !inLandmarkKeepout(x, z);
  const put = (cl: [number, number, number, number][], minD: number, place: (x: number, z: number) => void): void => {
    const placed: [number, number][] = [];
    for (const [cx, cz, n, rMax] of cl) for (let i = 0; i < n; i++) {
      const [x, z] = scatter(prnd, cx, cz, rMax, minD, placed, plantOk);
      placed.push([x, z]);
      place(x, z);
    }
  };
  // 石榴 15：城内南肩 6 + 村口 5 + 塔院果园 4（簇心 = 原固定坐标所在净空带；冠径 ~2.6m，同种间距 ≥2.8m）
  put([
    [497, 41, 2, 3.0], [543, 41.5, 2, 3.0], [589, 41, 2, 3.0],
    [-638, 50, 3, 4.0], [-618, 62, 2, 4.0],
    [503, 146, 2, 4.5], [552, 151, 2, 4.5],
  ], 2.8, (x, z) => pomegranate(b, x, z, size()));
  // 银霜橘 17：城内南肩 3 + 村口 2 + 塔院果园 12（果园四簇三株，脱开原 26×15 方格感）
  put([
    [497, 43, 1, 2.8], [548, 43, 1, 2.8], [596, 42.5, 1, 2.8],
    [-620, 62, 2, 3.6],
    [498, 137, 3, 4.5], [523, 150, 3, 4.5], [549, 139, 3, 4.5], [574, 155, 3, 4.5],
  ], 2.8, (x, z) => frostOrange(b, x, z, size()));
  // 迎宾茶灶 15：村口 5 + 郊野路旁 4 + 城内南肩 4 + 码头甲板 2
  // 灶身带茶案/茶旗横伸（足迹 ~4.5m），一灶一簇、抖动 2.5m 内，同种间距 ≥4.5m；
  // 码头两处收 2.0m（甲板 x -259/-217、z 17/31，塔吊杆 -223 都在边距外）
  put([
    [-640, 54, 1, 2.5], [-616, 66, 1, 2.5], [-646, 62, 1, 2.5], [-604, 68, 1, 2.5], [-628, 44, 1, 2.5],
    [-432, 88, 1, 2.0], [-410, 92, 1, 2.5], [-388, 88, 1, 2.5], [-432, 80, 1, 2.0],
    [478, 41, 1, 2.5], [512, 43, 1, 2.5], [548, 40.5, 1, 2.5], [586, 42.5, 1, 2.5],
    [-256, 22.5, 1, 2.0], [-226, 24, 1, 2.0],
  ], 4.5, (x, z) => teaStove(b, x, z, size(), (prnd() - 0.5) * 0.5, z > 10 && z < 30 ? 1.15 : 0));

  // ---- R16：核心河岸五色花带（判据 ⑤「整个城市都要这样」）----
  // 只走坐标 hash，**一次都不取共享 rng**：上面 柳/松/桂/莲/果木/茶灶 的取数与下游
  // （buildLanterns / buildStalls）逐值不变。110 丛 × 44 面 ≈ 4.8k，落在 +800k 预算的尾款里。
  let fb = 0;
  for (const sz of [1, -1] as const) {
    for (let x = -600; x < 610; x += 22) {
      if (Math.abs(x) < 46) continue;                              // 虹桥桥头让开
      const hx = x + (flr(x * 0.013, sz + 3) - 0.5) * 8;
      const z = sz * (46.6 + flr(x * 0.017, sz + 9) * 1.5);
      if (inLandmarkKeepout(hx, z)) continue;
      flowerBush(b, hx, z, 0.92, fb % 5);
      fb++;
    }
  }
  b.kit('core.flower', fb, 0);
}

/** 坐标 hash（0–1）：与 centralbelt / riverbank 同式，不消耗共享 RNG */
function flr(a: number, c: number): number {
  const v = Math.sin(a * 12.9898 + c * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function buildLanterns(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  // 街灯柱
  const spots: [number, number][] = [[-500, 58], [-420, 58], [-340, 58], [-260, 58], [-180, 58], [-100, 58], [-20, 58], [60, 58], [140, 58], [244, 58], [300, 58], [380, 58], [440, 58], [520, 58], [590, 58], [-420, -46], [-300, -46], [-180, -46], [-60, -46], [60, -46], [180, -46], [300, -46], [400, -46]];
  for (const [x, z] of spots) {
    b.cyl('wood', 0.09, 0.12, 3.6, 5, x, 1.8, z, C.woodDark);
    // 六角宫灯：灯身六棱柱 + 上下灯座 + 底穗（服化道第七轮）
    b.cyl('glow', 0.26, 0.26, 0.4, 6, x, 3.75, z, rng.chance(0.5) ? C.lantern : C.neonGold);
    b.cyl('wood', 0.3, 0.22, 0.06, 6, x, 3.98, z, C.woodDark);
    b.cyl('wood', 0.22, 0.3, 0.06, 6, x, 3.52, z, C.woodDark);
    b.box('glow', 0.05, 0.18, 0.05, x, 3.28, z, C.neonGold);
    if (rng.chance(0.4)) {
      sg.quad(atlas.text(`lp${x | 0}`, rng.pick(['酒', '茶', '香', '藥']), 64, 64, { color: '#fff', glow: '#ffb300', fontPx: 46 }), 0.62, 0.62, x, 3.75, z + 0.25, 0);
    }
  }
  // 跨街灯串（虹桥头 + 市集）
  for (const [x0, x1, z] of [[-70, 70, 46], [-70, 70, -46], [150, 350, 96], [170, 330, 58]] as const) {
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const sag = Math.sin(t * Math.PI) * 2.2;
      b.cyl('glow', 0.22, 0.22, 0.34, 6, x, 6.2 - sag, z, i % 2 ? C.lantern : C.neonGold);
      b.box('glow', 0.04, 0.12, 0.04, x, 5.9 - sag, z, C.neonGold);
    }
    b.box('wood', 0.14, 6.4, 0.14, x0, 3.2, z, C.woodDark);
    b.box('wood', 0.14, 6.4, 0.14, x1, 3.2, z, C.woodDark);
    // 悬挂线（连接两杆的悬索，分段下垂）

  }
}

export function buildKites(b: Baker): void {
  for (const [x, y, z] of [[-430, 22, 70], [-300, 26, -80], [250, 30, 110]] as const) {
    b.box('glow', 1.1, 1.1, 0.04, x, y, z, C.neonMag, 0.5, 0.4, Math.PI / 4);
    b.box('glow', 0.04, 2.2, 0.04, x, y - 1.6, z, C.neonCyan);
  }
}

// ============ 交互道具：棋桌/琴台/客栈/净房 ============
export function buildInteractProps(b: Baker, sg: SignMesher, atlas: SignAtlas): { chess: [number, number][]; qin: [number, number]; inn: [number, number]; toilet: [number, number][] } {
  // 棋桌 ×3
  const chess: [number, number][] = [[60, 64], [240, 92], [-36, 62]];
  for (const [x, z] of chess) {
    b.box('wood', 2.2, 0.16, 2.2, x, 1.05, z, shade(0x6a4526, 1));
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) {
      b.box('wood', 0.14, 1.0, 0.14, x + ox, 0.5, z + oz, C.woodDark);
    }
    b.box('wall', 1.7, 0.06, 1.7, x, 1.14, z, 0xd8c8a0);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      b.box('wood', 0.07, 0.07, 0.07, x - 0.6 + i * 0.3, 1.19, z - 0.6 + j * 0.3, (i + j) % 2 ? 0x1c1c22 : 0xe8e8e0);
    }
    for (const sx of [-1.5, 1.5]) {
      b.box('wood', 0.7, 0.5, 0.7, x + sx, 0.25, z, shade(0x8a3324, 1));
    }
  }
  // 琴台（瓦子旁）
  const qin: [number, number] = [306, 92];
  b.box('wood', 3.2, 0.2, 1.6, qin[0], 0.7, qin[1], shade(0x6a4526, 1));
  for (const ox of [-1.3, 1.3]) b.box('wood', 0.16, 0.7, 0.16, qin[0] + ox, 0.35, qin[1], C.woodDark);
  b.box('wood', 1.15, 0.09, 0.3, qin[0], 0.86, qin[1], 0x3a2a1a);
  // 琴台侧灯：原来只有一块悬空的青色发光方块（1.4m 高、无支撑），补灯杆与灯座
  b.box('wood', 0.12, 1.5, 0.12, qin[0] + 1.3, 0.75, qin[1], C.woodDark);
  b.box('wall', 0.5, 0.14, 0.5, qin[0] + 1.3, 0.07, qin[1], C.stone);
  b.box('metal', 0.62, 0.1, 0.62, qin[0] + 1.3, 1.62, qin[1], 0x3a3430);
  b.box('glow', 0.5, 0.46, 0.5, qin[0] + 1.3, 1.36, qin[1], C.neonCyan, 0, 0, 0);
  b.box('metal', 0.62, 0.1, 0.62, qin[0] + 1.3, 1.1, qin[1], 0x3a3430);
  b.kit('prop.qinLamp', 1, 1.4);
  // 客栈（后街）
  const inn: [number, number] = [206, 100];
  b.box('wall', 12, 3.2, 9, inn[0], 1.6, inn[1], 0xc9b891);
  b.box('roof', 13.6, 2.4, 10.6, inn[0], 3.9, inn[1], shade(C.tile, 1.1));
  b.box('wood', 2.2, 2.5, 0.14, inn[0], 1.3, inn[1] + 4.5, 0x2a1c12);
  for (let w = 0; w < 4; w++) b.box('glow', 0.72, 0.9, 0.08, inn[0] - 4 + w * 2.6, 2.3, inn[1] + 4.56, C.winGlow);
  b.box('glow', 2.6, 0.5, 0.4, inn[0], 3.4, inn[1] + 4.8, C.neonGold, 0, 0, 0);
  sg.quad(atlas.text('inn_sign', '客棧', 220, 70, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.88)', border: 'rgba(255,179,0,.8)', fontPx: 52 }), 3.4, 1.1, inn[0], 4.4, inn[1] + 4.7, 0);
  // 净房（城门内侧）+ 城墙角净处
  const toilet: [number, number][] = [[452, 40], [-104, -60]];
  for (const [x, z] of toilet) {
    b.box('wall', 2.4, 2.6, 2.4, x, 1.3, z, shade(0x8d8779, 0.95));
    b.box('roof', 3.0, 0.5, 3.0, x, 2.8, z, shade(C.tile2, 1.05));
    b.box('wood', 0.9, 1.7, 0.1, x, 0.9, z + 1.2, 0x2a1c12);
    b.box('glow', 0.4, 0.3, 0.05, x + 0.8, 1.9, z + 1.22, C.neonCyan);
  }
  sg.quad(atlas.text('toilet_sign', '淨房', 140, 56, { color: '#d8f2ff', glow: '#00e5ff', fontPx: 40, bg: 'rgba(8,12,22,0.8)' }), 1.6, 0.64, toilet[0][0], 2.2, toilet[0][1] + 1.25, 0);
  return { chess, qin, inn, toilet };
}

// ============ 汴河码头水工（WS-32）：泊船石鼻 / 水尺刻度 / 跳板 / 水门船闸 / 护仓栅栏 ============
/** 既有码头甲板台面：buildings.ts buildDock 的甲板箱心 0.9、高 0.5 → 上皮 1.15 */
const WHARF_DECK_Y = 1.15;

/**
 * 泊船石鼻（C-ITM-0065 / C-ITM-0076，各一）：甲板南缘的系船石鼻——
 * 石座嵌进甲板、压顶石出挑、鼻头外伸贴水面，鼻环方铁环磨亮，绳槽有三匝缆绳。
 * 落主泊位甲板（x −259…−217，z 17…31）南缘 z=17，让开既有缆桩（z=18.5）与货担（z=16.2）。
 */
export function wharfMooringNose(b: Baker, x: number, edgeZ: number): void {
  const top = WHARF_DECK_Y;
  b.box('ash', 1.72, 0.44, 1.25, x, top + 0.22, edgeZ + 0.58, shade(C.stone, 0.98));
  b.box('ash', 1.72, 0.16, 1.42, x, top + 0.5, edgeZ + 0.58, shade(C.stone, 1.1));
  b.box('ash', 1.08, 0.5, 0.5, x, top + 0.06, edgeZ - 0.2, shade(C.stone, 1.06));
  b.box('ash', 0.84, 0.3, 0.34, x, top - 0.06, edgeZ - 0.45, shade(C.stone, 0.92));
  // 鼻环：方环四边穿绳，环面磨亮
  const rz = edgeZ - 0.36, ry0 = top + 0.06;
  b.box('metal', 0.44, 0.07, 0.07, x, ry0 + 0.3, rz, 0x4a4e54);
  b.box('metal', 0.44, 0.07, 0.07, x, ry0 + 0.06, rz, 0x4a4e54);
  for (const sx of [-1, 1]) b.box('metal', 0.07, 0.3, 0.07, x + sx * 0.19, ry0 + 0.18, rz, shade(0x4a4e54, 1.1));
  // 缆绳三匝（M-13 纤维绳 #2B1B3D）
  for (let i = 0; i < 3; i++) b.box('fabric', 0.5, 0.06, 0.14, x, ry0 + 0.1 + i * 0.07, rz - 0.07, 0x2b1b3d);
  b.kit('wharf.mooringNose', 1, top + 0.2);
}

/**
 * 水尺刻度（C-ITM-0067，两处）：甲板缘支座石悬挑一根石柱，铜尺板刻 0.1m 一道、半米一长刻，
 * 尺面朝河心，水上可读段 1.0~2.0m。刻深按资产卷 5mm（这里用外贴细刻条表现）。
 */
export function wharfWaterGauge(b: Baker, x: number, edgeZ: number): void {
  const top = WHARF_DECK_Y;
  // 支座石（压在甲板边） + 悬挑立柱 + 柱帽
  b.box('ash', 0.9, 0.46, 0.9, x, top + 0.23, edgeZ + 0.2, shade(C.stone, 0.96));
  b.box('ash', 0.4, 2.3, 0.4, x, 1.05, edgeZ - 0.22, shade(C.stone, 1.02));
  b.box('ash', 0.5, 0.14, 0.5, x, 2.27, edgeZ - 0.22, shade(C.stone, 1.14));
  // 铜尺板 + 刻度
  b.box('metal', 0.3, 1.85, 0.06, x, 1.25, edgeZ - 0.44, 0xb08d57);
  for (let i = 0; i <= 18; i++) {
    const long = i % 5 === 4;
    b.box('ash', long ? 0.34 : 0.22, 0.026, 0.05, x, 0.4 + i * 0.1, edgeZ - 0.48, long ? 0x22201c : 0x4a4238);
  }
  for (const y of [0.5, 2.05]) b.box('metal', 0.5, 0.07, 0.5, x, y, edgeZ - 0.22, 0x3a3430);
  b.kit('wharf.waterGauge', 1, 1.3);
}

/**
 * 跳板（C-ITM-0215，两处）：甲板缘搭向水面的木跳板——板面横木条防滑、两侧边梁，
 * 落水端坐木浮墩（绑绳两道）。板根压甲板边 0.05，板头落到浮墩面 1.00（水面 1.0）。
 */
export function wharfGangplank(b: Baker, x: number, edgeZ: number): void {
  const z1 = edgeZ - 0.05, z0 = z1 - 1.95;
  const y1 = WHARF_DECK_Y + 0.03, y0 = 1.0;
  const ang = -Math.atan2(y1 - y0, z1 - z0);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  b.box('wood', 0.95, 0.12, 2.05, x, yc, zc, 0x6b4a2b, 0, ang, 0);
  // 横木条五道
  for (let i = 0; i < 5; i++) {
    const du = -0.8 + i * 0.4;
    b.box('wood', 0.92, 0.05, 0.12, x, yc + 0.08 * ca - du * sa, zc + 0.08 * sa + du * ca, 0x7a5230, 0, ang, 0);
  }
  // 两侧边梁
  for (const sx of [-1, 1]) b.box('wood', 0.1, 0.16, 2.05, x + sx * 0.44, yc + 0.02 * ca, zc + 0.02 * sa, 0x5e3e22, 0, ang, 0);
  // 落水端木浮墩 + 两道绑绳
  b.box('wood', 1.2, 0.28, 0.8, x, 0.92, z0 + 0.1, shade(0x5a4630, 1.02));
  for (let i = 0; i < 2; i++) b.box('fabric', 0.14, 0.16, 0.9, x + (i ? 0.42 : -0.42), 1.0, z0 + 0.1, 0x2b1b3d);
  b.kit('wharf.gangplank', 1, yc);
}

/**
 * 水门船闸（C-ITM-0390）：码头西口的漕运水门——两岸闸墩夹住航道，人字闸门敞靠墩侧，
 * 墩上斗门绞车（木绞盘 + 绞索盘）。航道上不放任何横梁/闸板：船行 z=8/13/−11 三道船道净空不破。
 * 闸槛沉在水下 0.15m（石槛顶 0.85，水面 1.0），只在水面留一道暗线。
 */
export function wharfLockGate(b: Baker, x: number): void {
  const PZ = 16.6;
  for (const s of [-1, 1]) {
    const z = s * PZ;
    // 闸墩：自河床（−2.2）砌出水面 3.1m
    b.box('ash', 2.4, 5.3, 2.2, x, 0.45, z, shade(C.stone, 0.94));
    b.box('ash', 2.7, 0.2, 2.5, x, 3.18, z, shade(C.stone, 1.12));
    // 上下游分水尖
    for (const sx of [-1, 1]) b.box('ash', 1.35, 4.9, 1.35, x + sx * 1.5, 0.55, z, shade(C.stone, 0.88), Math.PI / 4);
    // 门轴将军柱
    b.cyl('ash', 0.26, 0.32, 2.5, 8, x - 0.1, 1.85, s * (PZ - 1.28), shade(C.stone, 1.04));
    // 敞靠墩侧的人字闸门：门扇顺流贴墩，铁箍三道
    const lz = s * (PZ - 1.3);
    b.box('wood', 7.6, 2.4, 0.22, x + 4.0, 1.85, lz, shade(0x5e3e22, 1.0));
    for (const ox of [-3.2, 0, 3.2]) b.box('metal', 0.2, 2.5, 0.06, x + 4.0 + ox, 1.85, lz - s * 0.14, 0x4a4e54);
    for (const oy of [-0.9, 0.9]) b.box('metal', 7.6, 0.14, 0.06, x + 4.0, 1.85 + oy, lz - s * 0.14, shade(0x4a4e54, 0.9));
    // 门枕石（压住门扇下缘）
    b.box('ash', 0.8, 0.5, 0.4, x + 7.9, 0.75, lz, shade(C.stone, 0.9));
    if (s > 0) {
      // 斗门绞车：木绞盘 + 四根推杠 + 绞索盘
      b.cyl('wood', 0.46, 0.52, 1.05, 10, x - 0.3, 3.8, z - 0.1, shade(0x5e3e22, 1.04));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        b.box('wood', 1.3, 0.09, 0.09, x - 0.3 + Math.cos(a) * 0.55, 4.05, z - 0.1 + Math.sin(a) * 0.55, 0x6b4a2b, a, 0, 0);
      }
      b.cyl('metal', 0.34, 0.34, 0.1, 10, x - 0.3, 4.36, z - 0.1, 0x3a3430);
      // 绞索三匝盘在墩面
      for (let i = 0; i < 3; i++) b.cyl('fabric', 0.62 - i * 0.06, 0.62 - i * 0.06, 0.05, 12, x + 0.62, 3.32, z - 0.05, 0x2b1b3d);
    }
    b.kit('wharf.lockGate', 1, 1.8);
  }
  // 闸槛：两岸各一段石槛，贴闸墩收头（航道 z=8/13/−11 中间不落石，保证船底净空）
  for (const s of [-1, 1]) b.box('ash', 2.2, 0.7, 2.0, x, 0.5, s * (PZ - 0.7), shade(C.stone, 0.86));
  // 墩顶系船柱
  for (const s of [-1, 1]) for (const sx of [-1, 1]) b.cyl('wood', 0.16, 0.22, 0.9, 6, x + sx * 0.8, 3.6, s * (PZ + 0.6), C.woodDark);
}

/**
 * 护仓栅栏（C-ITM-0398）：漕运仓场沿汴河北岸的一周木栅尖桩——
 * 桩顶削尖并炭化防蛀（#2A1E14，翻越点磨亮），三道横档，正对码头路开 3.8m 栅门并立门柱灯笼。
 * 落在岸顶地面 z=32.4（驳岸压顶 31.5 之后），两端回折 1.9m 收头。
 */
export function wharfGranaryFence(b: Baker): void {
  const FZ = 32.4, X0 = -272, X1 = -204;
  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= n; i++) {
      const px = x0 + (dx * i) / n, pz = z0 + (dz * i) / n;
      b.box('wood', 0.16, 1.55, 0.16, px, 0.775, pz, shade(0x5a4630, 0.94 + (i % 2) * 0.08));
      b.cyl('wood', 0.02, 0.13, 0.26, 4, px, 1.66, pz, 0x2a1e14, Math.PI / 4);
    }
    for (const y of [0.42, 0.92, 1.34]) {
      b.box('wood', 0.09, 0.1, len, (x0 + x1) / 2, y, (z0 + z1) / 2, shade(0x6b4a2b, y > 1 ? 1.06 : 0.94), Math.atan2(ux, uz));
    }
  };
  const gatePost = (x: number, z: number): void => {
    b.box('ash', 0.3, 1.95, 0.3, x, 0.975, z, shade(C.stone, 1.04));
    b.box('ash', 0.42, 0.16, 0.42, x, 1.99, z, shade(C.stone, 1.14));
    b.box('glow', 0.22, 0.3, 0.22, x, 2.22, z, C.lantern);
  };
  // 前栅：三道仓门（正门对码头路 x=−238，两侧对东西仓房 x=−214 / −264）
  run(X0, FZ, -265.1, FZ); run(-262.9, FZ, -239.9, FZ); run(-236.1, FZ, -215.1, FZ); run(-212.9, FZ, X1, FZ);
  for (const [gx, hw] of [[-264, 1.1], [-238, 1.9], [-214, 1.1]] as const) {
    gatePost(gx - hw, FZ); gatePost(gx + hw, FZ);
  }
  // 两端回折收头（朝岸里折 1.9m）
  run(X0, FZ, X0, FZ + 1.9);
  run(X1, FZ, X1, FZ + 1.9);
  b.kit('wharf.granaryFence', 1, 0.9);
}

/** 码头水工总装：由 buildGround 在驳岸之后调用（与既有码头甲板同批烘焙，0 新增 draw call） */
export function buildWharfWorks(b: Baker): void {
  // 泊船石鼻 ×2（C-ITM-0065 / C-ITM-0076）：主泊位甲板南缘，两处石鼻夹在缆桩与货担之间
  wharfMooringNose(b, -252, 17);
  wharfMooringNose(b, -228, 17);
  // 水尺刻度 ×2（C-ITM-0067）：主泊位与西泊位甲板缘各一，尺面朝河心
  wharfWaterGauge(b, -249.5, 17);
  wharfWaterGauge(b, -264, 17);
  // 跳板 ×2（C-ITM-0215）：主泊位 x−234、西泊位 x−270，搭向水面
  wharfGangplank(b, -233.2, 17);
  wharfGangplank(b, -270, 17);
  // 水门船闸（C-ITM-0390）：码头西口 x=−296，闸墩夹航道、人字门敞靠墩侧
  wharfLockGate(b, -296);
  // 护仓栅栏（C-ITM-0398）：仓场沿河一周木栅尖桩
  wharfGranaryFence(b);
}

// ============ WS-41 户外/器物 27 件：河岸渔村 · 渡口 · 仓区 · 郊野 · 庙市仙苑 ============
// 世界锚定：汴河水面 y=1.0（river.ts 水面平面），驳岸压顶上皮 y=1.37，岸上地面 y=0。
// 全部由 buildGround 末尾一次调用烘焙（与既有点景同批，0 新增 draw call）。
// 命名：水缘件 wharf.*，陆上件 prop.*。每件前置锚点注释「<名称>：<台账ID>」。

const W41_HULL = 0x6b4a2b;    // 船板木（同 CJ-04）
const W41_PILE = 0x5a4630;    // 木桩（沉水侧偏暗）
const W41_STONE = 0x8d8a80;   // 条石（岸顶压顶同色系）
const W41_BRICK = 0x5a6472;   // 青砖（CJ-02）
const W41_THATCH = 0xa8926a;  // 茅草顶
const W41_JADE = 0xe4e8e0;    // 白玉（仙苑用，人间只在庙园出现）
const W41_JADE_D = 0xc8d0cc;  // 玉阴面

/** 渔船：C-ITM-0379（鸭划子 · 木 · 6 艘 · 小埠）——平底小舟，水线 y=1.0、吃水 0.26 */
function wharfFishingBoat(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  b.box('wood', 1.02, 0.11, 3.3, x, 0.8, z, shade(W41_HULL, 0.78), ry);
  for (const sx of [-1, 1]) {
    const [px, pz] = at(sx * 0.49, 0);
    b.box('wood', 0.1, 0.46, 3.26, px, 1.02, pz, shade(W41_HULL, 0.94), ry);
    const [qx, qz] = at(sx * 0.52, 0);
    b.box('wood', 0.15, 0.07, 3.3, qx, 1.27, qz, shade(W41_HULL, 1.14), ry);
  }
  for (const sz of [-1, 1]) {
    const [bx, bz] = at(0, sz * 1.8);
    b.box('wood', 0.88, 0.09, 0.7, bx, 1.04, bz, shade(W41_HULL, 1.02), ry, sz * 0.46, 0);
  }
  for (const dz of [-0.86, 0.04, 0.94]) {
    const [mx, mz] = at(0, dz);
    b.box('wood', 0.96, 0.06, 0.24, mx, 1.17, mz, shade(W41_HULL, 1.08), ry);
  }
  const [ox, oz] = at(0.6, -0.42);
  b.cyl('wood', 0.028, 0.034, 1.65, 5, ox, 1.22, oz, shade(W41_HULL, 1.1), ry, 0, 0.22);
  const [rx1, rz1] = at(-0.52, 1.46);
  b.cyl('fabric', 0.028, 0.028, 0.5, 4, rx1, 1.3, rz1, 0x2b1b3d, 0, 0.4, 1.1);
  b.kit('wharf.fishingBoat', 1, 1.0);
}

/** 小埠头：C-ITM-0382（碎石木桩 · 1 处 · 水缘）——乱石坡台接岸、十二根木桩托三层铺板 */
function wharfFishJetty(b: Baker, x: number, zEdge: number): void {
  for (let i = 0; i < 4; i++) {
    b.box('ash', 5.0 - i * 0.24, 0.26, 0.95, x, 0.13 + i * 0.28, zEdge - 1.9 + i * 0.64, shade(W41_STONE, 0.9 + i * 0.04));
  }
  for (const px of [-1.9, -0.64, 0.64, 1.9]) {
    for (const pz of [-0.6, 5.1]) {
      b.cyl('wood', 0.13, 0.15, 2.4, 6, x + px, 0.0, zEdge + pz, shade(W41_PILE, 0.94 + (px > 0 ? 0.08 : 0)));
    }
  }
  for (let i = 0; i < 3; i++) {
    b.box('wood', 4.2, 0.1, 1.62, x, 1.12, zEdge + 0.18 + i * 1.58, shade(W41_HULL, 1.0 + i * 0.04));
  }
  for (const px of [-2.0, 2.0]) b.box('wood', 0.16, 0.14, 4.9, x + px, 1.16, zEdge + 1.8, shade(W41_HULL, 0.9));
  b.kit('wharf.fishJetty', 1, 1.12);
}

/** 埠头马道：C-ITM-0383（条石 · 1 处 · 河沿）——条石缓坡自岸上地面抬到岸顶，接出挑石埠台 */
function wharfStoneMooring(b: Baker, x: number, zLand: number): void {
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    b.box('ash', 6.2, 0.24, 1.06, x, 0.12 + t * 1.26, zLand + 7.4 - i * 1.06, shade(W41_STONE, 0.88 + t * 0.16));
  }
  for (const sx of [-1, 1]) {
    b.box('ash', 0.34, 0.46, 7.9, x + sx * 3.14, 0.62, zLand + 3.4, shade(W41_STONE, 0.84), 0, 0.16, 0);
  }
  b.box('ash', 7.2, 0.3, 3.4, x, 1.02, zLand - 1.6, shade(W41_STONE, 1.06));
  b.box('ash', 7.4, 0.16, 3.7, x, 1.26, zLand - 1.6, shade(W41_STONE, 1.16));
  for (const sx of [-1, 1]) {
    for (const pz of [0.4, 2.9]) b.cyl('wood', 0.16, 0.19, 2.6, 6, x + sx * 3.1, 0.2, zLand - 1.6 - pz + 1.4, W41_PILE);
  }
  b.kit('wharf.stoneMooring', 1, 1.02);
}

/** 渡船：C-ITM-0384（官渡平底船 · 木 · 2 艘 · 河心）——五米平底，方艏方艉，水线 y=1.0 */
function wharfFerryBoat(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  b.box('wood', 1.74, 0.14, 5.3, x, 0.78, z, shade(W41_HULL, 0.76), ry);
  for (const sx of [-1, 1]) {
    const [px, pz] = at(sx * 0.84, 0);
    b.box('wood', 0.13, 0.56, 5.24, px, 1.06, pz, shade(W41_HULL, 0.92), ry);
    const [qx, qz] = at(sx * 0.88, 0);
    b.box('wood', 0.2, 0.08, 5.3, qx, 1.37, qz, shade(W41_HULL, 1.12), ry);
  }
  for (const sz of [-1, 1]) {
    const [bx, bz] = at(0, sz * 2.6);
    b.box('wood', 1.7, 0.5, 0.16, bx, 1.1, bz, shade(W41_HULL, 1.0), ry);
  }
  for (const dz of [-1.9, -0.7, 0.5, 1.7]) {
    const [mx, mz] = at(0, dz);
    b.box('wood', 1.66, 0.07, 0.3, mx, 1.2, mz, shade(W41_HULL, 1.06), ry);
  }
  // 艉橹一根 + 前后缆桩
  const [ox, oz] = at(-0.7, -2.2);
  b.cyl('wood', 0.05, 0.06, 3.0, 6, ox, 1.5, oz, shade(W41_HULL, 1.04), ry, 0, 0.3);
  for (const sz of [-1, 1]) {
    const [px2, pz2] = at(0, sz * 2.2);
    b.cyl('wood', 0.09, 0.11, 0.5, 6, px2, 1.5, pz2, shade(W41_PILE, 1.0));
  }
  b.kit('wharf.ferryBoat', 1, 1.0);
}

/** 缆桩：C-ITM-0385（木铁 · 4 根 · 埠头）——石座木桩、双道铁箍、缆绳三匝（y0 为埠台面高） */
function wharfBollard(b: Baker, x: number, z: number, y0 = 0): void {
  b.box('ash', 0.46, 0.16, 0.46, x, y0 + 0.08, z, shade(W41_STONE, 0.94));
  b.cyl('wood', 0.15, 0.19, 1.15, 8, x, y0 + 0.74, z, shade(W41_PILE, 1.0));
  b.cyl('wood', 0.22, 0.19, 0.1, 8, x, y0 + 1.36, z, shade(W41_PILE, 1.14));
  for (const oy of [0.42, 1.02]) b.cyl('metal', 0.2, 0.2, 0.05, 8, x, y0 + oy, z, 0x4a4e54, 0, 0, 0, true);
  for (let i = 0; i < 3; i++) b.cyl('fabric', 0.215, 0.215, 0.05, 8, x, y0 + 0.7 + i * 0.07, z, 0x2b1b3d, 0, 0, 0, true);
  b.kit('wharf.bollard', 1, y0 + 0.74);
}

/** 跳板：C-ITM-0386（木 · 2 处 · 埠头）——接舷板，自埠台面落到船舷，两道横木防滑 */
function wharfFerryPlank(b: Baker, x: number, z0: number, z1: number): void {
  const y0 = 1.3, y1 = 1.1;
  const ang = Math.atan2(y0 - y1, z0 - z1);
  const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  b.box('wood', 0.86, 0.11, Math.abs(z0 - z1), x, yc, zc, shade(W41_HULL, 1.02), 0, ang, 0);
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.3;
    b.box('wood', 0.82, 0.05, 0.12, x, y0 + (y1 - y0) * t + 0.08, z0 + (z1 - z0) * t, shade(W41_HULL, 1.14), 0, ang, 0);
  }
  for (const sx of [-1, 1]) b.box('wood', 0.09, 0.14, Math.abs(z0 - z1), x + sx * 0.4, yc + 0.03, zc, shade(W41_HULL, 0.88), 0, ang, 0);
  b.kit('wharf.ferryPlank', 1, yc);
}

/** 渡口草棚：C-ITM-0387（茅竹 · 1 座 · 埠侧）——四柱茅顶茶棚，内置茶案、长凳与渡资牌位 */
function wharfFerryShed(b: Baker, x: number, z: number): void {
  const HW = 2.1, HD = 1.55, H = 2.3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box('wood', 0.11, H, 0.11, x + sx * HW, H / 2, z + sz * HD, shade(W41_HULL, 0.94));
  }
  for (const sz of [-1, 1]) b.box('wood', HW * 2 + 0.2, 0.11, 0.11, x, H + 0.02, z + sz * HD, shade(W41_HULL, 0.9));
  b.box('roof', HW * 2 + 1.1, 0.14, HD * 2 + 1.0, x, H + 0.2, z, shade(W41_THATCH, 0.96), 0, 0.12, 0);
  b.box('roof', HW * 2 + 0.6, 0.16, 0.4, x, H + 0.2, z, shade(W41_THATCH, 0.8));
  b.box('fabric', HW * 2 + 1.0, 0.24, 0.04, x, H + 0.02, z + HD + 0.52, 0xc8bb98);
  b.box('wood', 1.7, 0.08, 0.6, x, 0.78, z + 0.15, shade(C.wood, 1.02));
  for (const sx of [-1, 1]) b.box('wood', 0.09, 0.76, 0.09, x + sx * 0.7, 0.4, z + 0.15, C.woodDark);
  for (const sz of [-1, 1]) {
    b.box('wood', 1.5, 0.07, 0.34, x, 0.44, z - sz * 1.05, shade(C.wood, 0.98));
    for (const sx of [-1, 1]) b.box('wood', 0.07, 0.42, 0.08, x + sx * 0.6, 0.22, z - sz * 1.05, C.woodDark);
  }
  b.cyl('ceramic', 0.15, 0.18, 0.28, 8, x - 0.5, 0.96, z + 0.15, 0x6a7a6a);
  b.cyl('metal', 0.07, 0.06, 0.1, 6, x + 0.42, 0.86, z + 0.15, 0xb87333);
  b.kit('wharf.ferryShed', 1, H);
}

/**
 * 悬山双坡瓦顶（小体量建筑专用，5 个面片 60 面）：
 * roofOn 的曲面庑殿顶单顶 1070 面（roofC 234 + 檐口 8 + 椽 12 + 瓦滴 18 + 风铃 4 + 檩 8），
 * 渔舍/仓廒这类 4m 级棚屋用它必破「小建筑 ≤800 面」；且仓廒原制是悬山不是庑殿。
 * 注：Baker 的 rx 绕世界 X 轴、与 ry 无关（已实测），故屋顶可在世界轴直接铺，不受建筑 ry 影响。
 */
function propGableRoof(b: Baker, w: number, d: number, y: number, x: number, z: number, tileC: number): void {
  const rise = Math.min(w, d) * 0.34;
  const half = d * 0.5 + 0.42;
  const pitch = Math.atan2(rise, half);
  const slope = Math.hypot(half, rise) + 0.12;
  for (const sz of [1, -1]) {
    b.box('roof', w, 0.16, slope, x, y + rise * 0.5, z + sz * half * 0.5, shade(tileC, 0.94 + (sz > 0 ? 0.06 : 0)), 0, sz * pitch, 0);
  }
  b.box('roof', w + 0.3, 0.18, 0.34, x, y + rise + 0.02, z, C.ridge);
  for (const sx of [-1, 1]) b.box('wood', 0.12, rise + 0.3, d + 0.84, x + sx * (w / 2 - 0.02), y + rise * 0.45, z, C.woodDark);
}

/** 小体量建筑通用壳（有顶有柱）：台基 + 三面墙 + 四角柱 + 曲面瓦顶 + 板门 + 暖光窗 */
function propHut(b: Baker, x: number, z: number, w: number, d: number, ry: number, wallC: number, tileC: number, wallG: 'wall' | 'earth' | 'ash', columns: boolean): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  const h = 2.2;
  b.box('ash', w + 0.5, 0.24, d + 0.5, x, 0.12, z, shade(W41_STONE, 0.94), ry);
  b.box(wallG, w, h, d, x, h / 2 + 0.24, z, wallC, ry);
  if (columns) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const [px, pz] = at(sx * (w / 2 + 0.12), sz * (d / 2 + 0.12));
        b.box('wood', 0.15, h + 0.34, 0.15, px, (h + 0.34) / 2 + 0.24, pz, C.woodDark, ry);
      }
    }
    for (const sz of [-1, 1]) {
      const [bx, bz] = at(0, sz * (d / 2 + 0.12));
      b.box('wood', w + 0.44, 0.12, 0.12, bx, h + 0.52, bz, C.woodDark, ry);
    }
  }
  propGableRoof(b, w + 1.0, d + 1.0, h + 0.36, x, z, tileC);
  const [dx2, dz2] = at(0, d / 2 + 0.04);
  b.box('wood', Math.min(1.05, w * 0.34), 1.55, 0.1, dx2, 1.02, dz2, 0x2a1c12, ry);
  const [wx2, wz2] = at(w * 0.32, d / 2 + 0.07);
  b.box('glow', 0.58, 0.56, 0.06, wx2, 1.58, wz2, C.winGlow, ry);
}

/** 仓廒：C-ITM-0389（转运仓 6 座）/ C-ITM-0395（丰济仓 4 座）——高台防潮 + 砖木广厦 + 檐下通风格栅 */
function propGranary(b: Baker, x: number, z: number, w: number, d: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  b.box('ash', w + 0.9, 0.86, d + 0.9, x, 0.43, z, shade(W41_STONE, 0.9), ry);
  b.box('wall', w, 4.1, d, x, 0.86 + 2.05, z, W41_BRICK, ry);
  b.box('wood', w + 0.3, 0.16, 0.16, x, 4.94, z + 0, C.woodDark, ry);
  // 檐下通风格栅：仓廒靠檐口一排气窗（防潮）
  for (let i = 0; i < 5; i++) {
    const [gx, gz] = at(-w / 2 + 0.9 + i * (w - 1.8) / 4, d / 2 + 0.06);
    b.box('trunk', 0.5, 0.4, 0.06, gx, 4.3, gz, 0x2a1e14, ry);
  }
  // 仓门：板门 + 门框 + 门槛石
  const [mx, mz] = at(0, d / 2 + 0.05);
  b.box('wood', 1.5, 2.3, 0.12, mx, 2.0, mz, shade(C.woodDark, 0.92), ry);
  for (const sx of [-1, 1]) {
    const [px, pz] = at(sx * 0.84, d / 2 + 0.1);
    b.box('wood', 0.18, 2.5, 0.18, px, 2.1, pz, C.woodDark, ry);
  }
  const [tx, tz] = at(0, d / 2 + 0.16);
  b.box('ash', 1.9, 0.18, 0.5, tx, 0.92, tz, shade(W41_STONE, 1.04), ry);
  propGableRoof(b, w + 1.4, d + 1.4, 5.02, x, z, shade(C.tile2, 1.0));
}

/** 守仓兵铺：C-ITM-0393（砖木 · 2 座 · 仓门）——门前值房，柜台朝外，檐下一盏号灯 */
function propGuardPost(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  propHut(b, x, z, 3.4, 2.9, ry, shade(W41_BRICK, 1.06), C.tile2, 'wall', true);
  const [bx, bz] = at(0, 1.9);
  b.box('wood', 1.9, 0.8, 0.42, bx, 0.4, bz, shade(C.wood, 1.0), ry);
  const [lx, lz] = at(-1.5, 1.95);
  b.box('wood', 0.09, 1.5, 0.09, lx, 0.75, lz, C.woodDark, ry);
  b.box('glow', 0.24, 0.32, 0.24, lx, 1.6, lz, C.lantern, ry);
  b.kit('prop.guardPost', 1, 1.2);
}

/** 渔舍：C-ITM-0377（茅草木 · 10 座 · 村中）——悬山草顶土屋，檐下挂网、门口火塘 */
function propFishHut(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  propHut(b, x, z, 3.4, 3.0, ry, shade(0x9a8f74, 0.98), shade(W41_THATCH, 0.86), 'earth', true);
  // 檐下渔网架：立杆 + 横杆 + 网面
  const [px, pz] = at(1.9, 1.5);
  b.box('wood', 0.1, 2.1, 0.1, px, 1.05, pz, shade(W41_PILE, 1.0), ry);
  const [qx, qz] = at(1.05, 1.62);
  b.box('wood', 1.0, 0.08, 0.08, qx, 1.96, qz, shade(W41_PILE, 1.06), ry);
  b.box('fabric', 0.72, 0.72, 0.03, qx, 1.58, qz, 0x8a8f7a, ry);
  // 门口火塘
  const [fx, fz] = at(-1.75, 1.4);
  b.cyl('ash', 0.34, 0.4, 0.18, 8, fx, 0.09, fz, shade(W41_STONE, 0.9));
  b.box('glow', 0.2, 0.1, 0.2, fx, 0.2, fz, 0xff7a2a);
  b.kit('prop.fishHut', 1, 1.1);
}

/** 驿卒舍：C-ITM-0370（夯土 · 4 座 · 站北）——夯土小屋，平檐草顶，门前系马石 */
function propPostHouse(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  propHut(b, x, z, 3.1, 2.7, ry, shade(0xb59b72, 0.82), shade(W41_THATCH, 0.8), 'earth', true);
  const [sx2, sz2] = at(1.85, 1.2);
  b.box('ash', 0.32, 0.5, 0.32, sx2, 0.25, sz2, shade(W41_STONE, 1.0), ry);
  const [hx, hz] = at(-1.75, 1.35);
  b.box('wood', 0.09, 0.9, 0.09, hx, 0.45, hz, C.woodDark, ry);
  b.kit('prop.postHouse', 1, 1.1);
}

/** 道士舍：C-ITM-0337（石木 · 2 座 · 殿侧）——石砌墙身 + 木柱檐廊的守殿人居所 */
function propTaoistHut(b: Baker, x: number, z: number, ry: number): void {
  propHut(b, x, z, 3.2, 2.8, ry, shade(W41_STONE, 1.02), C.tile, 'ash', true);
  b.kit('prop.taoistHut', 1, 1.1);
}

/** 守庙人舍：C-ITM-0343（石木 · 1 座 · 殿侧）——殿侧守庙人居所，门侧立香炉与扫帚 */
function propTempleKeeperHut(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  propHut(b, x, z, 3.6, 3.0, ry, shade(W41_STONE, 0.96), C.tile, 'ash', true);
  const [fx, fz] = at(2.2, 1.5);
  b.cyl('metal', 0.16, 0.13, 0.3, 8, fx, 0.6, fz, 0x6a5a3a);
  b.cyl('metal', 0.19, 0.19, 0.05, 8, fx, 0.78, fz, 0x4a4030);
  b.box('glow', 0.05, 0.04, 0.05, fx, 0.76, fz, 0xff9e00);
  for (const a of [-0.5, 0, 0.5]) b.cyl('metal', 0.012, 0.012, 0.24, 4, fx + a * 0.06, 0.85, fz + a * 0.03, 0x6a5a3a, 0, 0, a);
  const [bx2, bz2] = at(-2.0, 1.42);
  b.box('wood', 0.07, 1.3, 0.07, bx2, 0.65, bz2, C.woodDark);
  b.box('fabric', 0.22, 0.3, 0.05, bx2, 0.16, bz2, 0xb89b6a);
  b.kit('prop.templeKeeperHut', 1, 1.1);
}

/** 更铺：C-ITM-0237（砖木 · 1 座 · 楼北）——巡防值房，砖身木柱，门前告示板与号灯 */
function propWatchPost(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  propHut(b, x, z, 4.0, 3.2, ry, shade(W41_BRICK, 1.1), C.tile, 'wall', true);
  const [bx, bz] = at(-2.6, 1.3);
  b.box('wood', 0.08, 1.9, 0.08, bx, 0.95, bz, C.woodDark, ry);
  b.box('wood', 0.08, 1.9, 0.08, bx + c * 1.1, 0.95, bz - sn * 1.1, C.woodDark, ry);
  const [px, pz] = at(-2.05, 1.32);
  b.box('wood', 1.5, 0.86, 0.05, px, 1.32, pz, shade(C.wood, 1.04), ry);
  b.box('fabric', 0.62, 0.62, 0.02, px, 1.36, pz + 0.04, 0xf4ecd8, ry);
  const [lx, lz] = at(2.4, 1.5);
  b.box('wood', 0.08, 1.3, 0.08, lx, 0.65, lz, C.woodDark, ry);
  b.box('glow', 0.22, 0.3, 0.22, lx, 1.4, lz, C.lantern, ry);
  b.kit('prop.watchPost', 1, 1.2);
}

/** 石堆敖包：C-ITM-0372（垒石经幡 · 1 座 · 坛心）——八层垒石高 3.1m、中心插柳、五色经幡满顶到 6m */
function propCairn(b: Baker, x: number, z: number): void {
  const rings: [number, number, number][] = [
    [0.24, 2.05, 0.5], [0.78, 1.88, 0.5], [1.32, 1.66, 0.48],
    [1.84, 1.4, 0.44], [2.32, 1.1, 0.4], [2.74, 0.76, 0.36],
  ];
  for (let i = 0; i < rings.length; i++) {
    const [y, r, h] = rings[i];
    b.cyl('ash', r * 0.94, r, h, 9, x, y, z, shade(W41_STONE, 0.88 + i * 0.045), (i * 0.47) % 3, 0, 0);
  }
  b.cyl('ash', 0.22, 0.38, 0.3, 7, x, 3.06, z, shade(W41_STONE, 1.16));
  // 插柳：中心柳杆 + 两枝柳条 + 五色经幡（自杆顶垂到石堆四面）
  b.cyl('wood', 0.05, 0.09, 4.4, 5, x, 3.95, z, shade(C.wood, 1.02));
  for (let i = 0; i < 2; i++) {
    const a = i * 3.1416 + 0.4;
    b.cyl('trunk', 0.02, 0.045, 1.5, 4, x + Math.cos(a) * 0.3, 5.5, z + Math.sin(a) * 0.3, 0x4a3520, 0, Math.sin(a) * 0.5, -Math.cos(a) * 0.5);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.2566 + 0.2;
    const col = [0x9d2933, 0xd4b76a, 0x2a5c42, 0xdfe6e2, 0x2e4e7e][i];
    b.box('fabric', 0.34, 0.72, 0.03, x + Math.cos(a) * 0.62, 5.5, z + Math.sin(a) * 0.62, col, a, 0.1, 0);
  }
  for (let i = 0; i < 2; i++) {
    const a = i * 3.1416 + 0.9;
    b.box('fabric', 0.02, 2.0, 0.02, x + Math.cos(a) * 0.3, 4.4, z + Math.sin(a) * 0.3, 0x8a7a5a);
  }
  b.kit('prop.cairn', 1, 3.1);
}

/** 射柳靶场：C-ITM-0315（柳桩彩绳 · 1 处 · 林间空地）——三道箭道，柳桩挂彩绳，起射线立界石 */
function propArcheryRange(b: Baker): void {
  const lanes = [-400, -390, -380];
  const z0 = 35.6, z1 = 44.4;
  for (const x of lanes) {
    // 柳桩（射柳之「柳」）：两段收分干 + 四团球冠，桩上挂彩绳两道
    b.cyl('trunk', 0.13, 0.22, 0.36, 6, x, 0.18, z1, shade(0x4a3520, 0.92));
    let lcx = x, lcy = 0.34, lcz = z1;
    for (let k = 0; k < 2; k++) {
      const len = k ? 0.95 : 1.15;
      const pa = 0.6 + k * 0.9;
      const p = 0.05 + k * 0.04;
      const [ddx, ddy, ddz] = boughTip(pa, p, len);
      b.cyl('trunk', 0.075 - k * 0.02, 0.13 - k * 0.03, len, 5,
        lcx + ddx * 0.5, lcy + ddy * 0.5, lcz + ddz * 0.5, shade(0x4a3520, 1.0 + k * 0.06),
        0, Math.sin(pa) * p, -Math.cos(pa) * p);
      lcx += ddx; lcy += ddy; lcz += ddz;
    }
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + 0.4;
      b.sphere('leaf', 0.5 - k * 0.05, 7, lcx + Math.cos(a) * 0.34, lcy + 0.12 + (k % 2) * 0.3, lcz + Math.sin(a) * 0.34,
        shade(0x466e3e, 0.98 + k * 0.05), a, 0, 0, 1.1, 0.85, 1.1);
    }
    for (const [yy, col] of [[1.48, 0x9d2933], [2.02, 0x2e4e7e]] as const) {
      b.box('fabric', 0.05, 0.05, z1 - z0, x, yy, (z0 + z1) / 2, col);
    }
    b.box('ash', 0.7, 0.22, 0.4, x, 0.11, z0, shade(W41_STONE, 0.95));
    // 靶：柳枝编面 + 朱心
    b.cyl('wood', 0.5, 0.5, 0.13, 10, x, 1.42, z1 - 0.55, 0xd8ccae, 0, Math.PI / 2);
    b.cyl('wood', 0.19, 0.19, 0.15, 10, x, 1.42, z1 - 0.55, 0xa63a2b, 0, Math.PI / 2);
    b.box('wood', 0.1, 1.4, 0.1, x, 0.7, z1 - 0.62, C.woodDark);
    b.kit('prop.archeryRange.lane', 1, 1.42);
  }
  b.kit('prop.archeryRange', 1, 0);
}

/** 庙市棚：C-ITM-0350（席竹 · 20 组 · 庙前街）——四柱席棚、摊案、货堆、垂席招帘 */
function propTempleStall(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box('wood', 0.09, 2.25, 0.09, x + c * sx * 1.26 + sn * sz * 0.96, 1.12, z - sn * sx * 1.26 + c * sz * 0.96, shade(C.woodDark, 1.05), ry);
  }
  b.box('fabric', 3.0, 0.07, 2.3, x, 2.3, z, shade(0xc8bb98, 0.96), ry, 0.09, 0);
  const [fx, fz] = at(0, 1.12);
  b.box('fabric', 2.9, 0.26, 0.04, fx, 2.14, fz, 0xb0a184, ry);
  b.box('wood', 2.3, 0.8, 0.8, x, 0.4, z, shade(C.wood, 1.02), ry);
  b.box('wood', 2.4, 0.06, 0.9, x, 0.83, z, shade(C.wood, 1.12), ry);
  for (let i = 0; i < 3; i++) {
    const [gx, gz] = at(-0.72 + i * 0.72, 0.05);
    b.cyl('ceramic', 0.11, 0.13, 0.16, 6, gx, 0.94, gz, i % 2 ? 0x9a7a52 : 0x7a6a52);
  }
  const [bx, bz] = at(0.95, -0.5);
  b.box('wood', 0.5, 0.42, 0.5, bx, 0.21, bz, shade(C.wood, 0.94), ry);
  b.box('glow', 0.14, 0.16, 0.14, bx, 1.34, bz, C.neonGold, ry);
  b.kit('prop.templeStall', 1, 0.4);
}

/** 古柏群：C-ITM-0347（千年柏 · 60 株 · 全庙）——根盘 + 两段扭干 + 五层平顶云冠（每层三团压扁球）+ 两道枯枝。
 *  旧版五层是"扁圆锥片"，侧看是一摞深色盘子；云冠改球团后层间有起伏，才是柏。 */
function propAncientCypress(b: Baker, x: number, z: number, s: number): void {
  let seed = (Math.imul(Math.round(x * 53 + z * 97) ^ 0x517cc1b7, 2654435761) >>> 0) || 47;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const h = (7.4 + Math.abs(Math.sin(x * 0.37 + z * 0.11)) * 2.2) * s;
  const trunkC = 0x3a2c1e;
  const leafC = 0x2f4a34;
  const ta = rnd() * Math.PI * 2;
  b.cyl('trunk', 0.44 * s, 0.64 * s, 0.5 * s, 7, x, 0.25 * s, z, 0x33281c);
  let cx = x, cy = 0.3 * s, cz = z;
  for (let i = 0; i < 2; i++) {
    const len = h * (i ? 0.34 : 0.5);
    const p = 0.04 + rnd() * 0.05;
    const a = ta + i * 1.1;
    const [dx, dy, dz] = boughTip(a, p, len);
    b.cyl('trunk', (0.2 - i * 0.04) * s, (0.4 - i * 0.06) * s, len, 7,
      cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5, shade(trunkC, 0.96 + i * 0.06),
      0, Math.sin(a) * p, -Math.cos(a) * p);
    cx += dx; cy += dy; cz += dz;
  }
  // 五层平顶云冠：每层一枚主团 + 两枚偏心团，横向 1.3 倍压到 0.4 高
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const cy2 = h * 0.5 + t * h * 0.42;
    const r = (2.05 - t * 1.35) * s;
    const c = shade(leafC, 0.9 + i * 0.05 + rnd() * 0.05);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i * 0.8 + rnd() * 0.35;
      const rr = r * (k === 0 ? 0.1 : 0.62);
      b.sphere('leaf', r * (k === 0 ? 1 : 0.58), 7, x + Math.cos(a) * rr, cy2 + (k ? (rnd() - 0.5) * 0.22 * s : 0),
        z + Math.sin(a) * rr, shade(c, 0.96 + k * 0.04), rnd() * 3.14, 0, 0, 1.3, 0.42, 1.3);
    }
  }
  b.cyl('trunk', 0.05, 0.11, 1.5, 5, x + 0.9 * s, h * 0.56, z + 0.5 * s, trunkC, 0, 0.9, 0.5);
  b.cyl('trunk', 0.05, 0.1, 1.3, 5, x - 0.8 * s, h * 0.5, z - 0.6 * s, trunkC, 0, -0.9, -0.5);
  b.kit('prop.ancientCypress', 1, h / 2);
}

/** 石阶：C-ITM-0341（朝岳阶 · 108 级 · 山门内）——9 段 × 12 级（LOD 压成 9 段可视踏步），总升 3.46m，
 *  自南端 z0（地面）拾级向北到 z1（岳台 3.46m），两侧垂带望柱与栏板逐段升高。 */
function propStoneSteps(b: Baker, x: number, z0: number, z1: number, w: number): void {
  const segs = 9, rise = 3.46 / segs, run = (z0 - z1) / segs;
  for (let i = 0; i < segs; i++) {
    const zc = z0 - run * (i + 0.5);
    const y = rise * (i + 1);
    b.box('ash', w, y, run, x, y / 2, zc, shade(W41_STONE, 0.84 + i * 0.02));
    for (let k = 0; k < 3; k++) {
      b.box('ash', w, 0.07, 0.26, x, y + 0.035, zc + run / 2 - 0.22 - k * (run - 0.44) / 2, shade(W41_STONE, 1.06 + k * 0.03));
    }
  }
  // 岳台：阶顶一方石坪（望河/朝岳的落脚面）
  b.box('ash', w + 1.2, 3.46, 4.2, x, 1.73, z1 - 2.1, shade(W41_STONE, 0.88));
  b.box('ash', w + 1.5, 0.16, 4.5, x, 3.5, z1 - 2.1, shade(W41_STONE, 1.1));
  // 两侧垂带：望柱 5 根 + 栏板 4 跨，标高随踏步抬升
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const zc = z0 - (z0 - z1) * i / 4;
      b.box('ash', 0.36, 0.46, 0.36, x + sx * (w / 2 + 0.2), 0.5 + 3.46 * (i / 4), zc, shade(W41_STONE, 0.92));
      if (i < 4) {
        b.box('ash', 0.26, 0.2, (z0 - z1) / 4 - 0.2, x + sx * (w / 2 + 0.2), 0.86 + 3.46 * ((i + 0.5) / 4), z0 - (z0 - z1) * (i + 0.5) / 4, shade(W41_STONE, 0.86));
      }
    }
    b.box('ash', 0.36, 0.46, 0.36, x + sx * (w / 2 + 0.2), 0.5 + 3.46, z1 - 3.9, shade(W41_STONE, 0.92));
  }
  b.kit('prop.stoneSteps', 1, 1.7);
}

/** 白玉阶：C-ITM-0357（九重玉阶 · 9 段 · 宫前）——九段白玉踏步自池沿下到水面，两侧玉栏 */
function propJadeSteps(b: Baker, x: number, z0: number, z1: number, w: number): void {
  const segs = 9, drop = 0.72 / segs, run = (z0 - z1) / segs;
  for (let i = 0; i < segs; i++) {
    const y = 0.72 - drop * i;
    const zc = z0 - run * (i + 0.5);
    b.box('ash', w, y, run + 0.02, x, y / 2, zc, shade(W41_JADE, 0.96 + (i % 2) * 0.04));
    b.box('ash', w + 0.12, 0.05, run * 0.88, x, y + 0.03, zc, shade(W41_JADE, 1.1));
  }
  for (const sx of [-1, 1]) {
    b.box('ash', 0.3, 0.86, z0 - z1, x + sx * (w / 2 + 0.16), 0.43, (z0 + z1) / 2, shade(W41_JADE_D, 0.98));
    for (let i = 0; i <= 2; i++) b.box('ash', 0.34, 0.5, 0.34, x + sx * (w / 2 + 0.16), 0.93, z0 - (z0 - z1) * i / 2, shade(W41_JADE, 1.1));
  }
  b.kit('prop.jadeSteps', 9, 0.4);
}

/** 瑶池：C-ITM-0359（温泉池 · 1 座 · 殿前）——白玉池沿、温泉水不冻、池面三处雾气。
 *  北沿留 6.4m 玉阶门洞（白玉阶 C-ITM-0357 由此下池），不做整圈封边。 */
function propJadePool(b: Baker, x: number, z: number, w: number, d: number): void {
  // 白玉档位整体下调（1.10/0.98/0.86 → 0.86/0.80/0.72）：
  // W41_JADE 0xe4e8e0 线性亮度 0.79，黄昏主光 1.35 时 0.79×1.1×1.35 ≈ 1.17 > 1 直接裁白，
  // 整池读成一块发光白台（深夜实测该区域 meanLum 192，藏掉 ash 组后降到 116）。
  // 压到 ≤0.86 后受光峰值 ≈0.92，石纹与池沿明暗重新可辨。
  b.box('ash', w + 1.1, 0.74, d + 1.1, x, 0.37, z, shade(W41_JADE_D, 0.82));
  const gate = 3.2;
  for (const sz of [-1, 1]) {
    if (sz > 0) {
      // 北沿断成两段，中间是玉阶入口
      for (const sx of [-1, 1]) {
        const segW = (w + 1.3 - gate * 2) / 2;
        b.box('ash', segW, 0.14, 0.36, x + sx * (gate + segW / 2), 0.79, z + sz * (d / 2 + 0.52), shade(W41_JADE, 0.86));
        b.box('ash', segW, 0.5, 0.34, x + sx * (gate + segW / 2), 0.5, z + sz * (d / 2 - 0.17), shade(W41_JADE, 0.8));
      }
    } else {
      b.box('ash', w + 1.3, 0.14, 0.36, x, 0.79, z + sz * (d / 2 + 0.52), shade(W41_JADE, 0.86));
      b.box('ash', w, 0.5, 0.34, x, 0.5, z + sz * (d / 2 - 0.17), shade(W41_JADE, 0.8));
    }
  }
  for (const sx of [-1, 1]) {
    b.box('ash', 0.36, 0.14, d + 1.3, x + sx * (w / 2 + 0.52), 0.79, z, shade(W41_JADE, 0.86));
    b.box('ash', 0.34, 0.5, d, x + sx * (w / 2 - 0.17), 0.5, z, shade(W41_JADE, 0.8));
  }
  // 水面必须压在池体实体顶（0.74）之上：原 y=0.6 被实体吞掉，整池读成一块白台而不是水
  b.box('water', w - 0.4, 0.04, d - 0.4, x, 0.755, z, 0x2b5a5a);
  b.box('ash', w - 0.6, 0.16, d - 0.6, x, 0.28, z, shade(W41_JADE, 0.72));
  // 池底六块卵石 + 三处不冻雾气
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047 + 0.3, rr = 1.6 + (i % 3) * 0.9;
    b.cyl('ash', 0.22, 0.28, 0.16, 6, x + Math.cos(a) * rr, 0.42, z + Math.sin(a) * rr * 0.55, shade(W41_STONE, 0.9 + (i % 2) * 0.1));
  }
  // 雾锥：0xdfeee8 线性亮度 0.815，深夜 ×1.18 = 0.961（离 1.05 只差 9%），
  // 六枚近白锥叠在池沿上就是一团「白雾球」；换 0xcfe0d8（0.71 → ×1.18 = 0.84）留出余量。
  for (let i = 0; i < 3; i++) {
    const ox = -2.6 + i * 2.6;
    b.cyl('glow', 0.6, 1.15, 0.5, 8, x + ox, 0.86, z + (i % 2 ? 0.6 : -0.5), 0xcfe0d8, 0, 0, 0, true);
    b.cyl('glow', 0.3, 0.65, 0.45, 8, x + ox, 1.24, z + (i % 2 ? 0.6 : -0.5), 0xcfe0d8, 0, 0, 0, true);
  }
  b.kit('prop.jadePool', 1, 0.37);
}

/** 蟠桃园：C-ITM-0362（仙桃树 · 12 株 · 殿后）——根盘 + 两段矮干 + 三俯仰主枝 + 六团球冠 + 八枚仙桃。
 *  与人间桃树区分：干更矮壮、冠更圆、果更大更粉。 */
function propPeachTree(b: Baker, x: number, z: number, s: number): void {
  let seed = (Math.imul(Math.round(x * 71 + z * 37) ^ 0x27d4eb2f, 2246822519) >>> 0) || 59;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const h = 2.4 * s;
  const trunkC = 0x53402a;
  const leafC = 0x35603c;
  const ta = rnd() * Math.PI * 2;
  b.cyl('trunk', 0.24 * s, 0.34 * s, 0.36 * s, 6, x, 0.18 * s, z, shade(trunkC, 0.94));
  let cx = x, cy = 0.3 * s, cz = z;
  for (let i = 0; i < 2; i++) {
    const len = h * (i ? 0.5 : 0.55);
    const a = ta + i * 0.5;
    const p = 0.08 + rnd() * 0.06;
    const [dx, dy, dz] = boughTip(a, p, len);
    b.cyl('trunk', (0.11 - i * 0.03) * s, (0.2 - i * 0.04) * s, len, 6,
      cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5, shade(trunkC, 1.0 + i * 0.06),
      0, Math.sin(a) * p, -Math.cos(a) * p);
    cx += dx; cy += dy; cz += dz;
  }
  const crownY = cy + 0.25 * s;
  for (let i = 0; i < 3; i++) {
    const a = ta + (i / 3) * Math.PI * 2 + rnd() * 0.4;
    const p = 0.9 + rnd() * 0.25;
    const len = (0.72 + rnd() * 0.34) * s;
    const [dx, dy, dz] = boughTip(a, p, len);
    b.cyl('trunk', 0.045 * s, 0.085 * s, len, 5, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
      shade(trunkC, 1.06), 0, Math.sin(a) * p, -Math.cos(a) * p);
  }
  const clumps: [number, number, number, number][] = [
    [0, 0.42, 0, 1.02], [-0.6, 0.24, 0.3, 0.84], [0.58, 0.2, -0.32, 0.82],
    [0.08, 0.08, 0.62, 0.72], [-0.22, 0.58, -0.54, 0.68], [0.5, 0.5, 0.48, 0.64],
  ];
  clumps.forEach(([ox, oy, oz, cs], i) => {
    const r = cs * s;
    b.sphere('leaf', r, 7, cx + ox * s, crownY + oy * s, cz + oz * s,
      shade(leafC, 0.95 + i * 0.05 + rnd() * 0.06), rnd() * 3.14, 0, 0, 1.05, 0.86, 1.05);
  });
  // 仙桃 8 枚：球果略拉长，粉白两档
  for (let i = 0; i < 8; i++) {
    const a = i * 0.785 + 0.3, rr = (0.4 + (i % 3) * 0.22) * s;
    b.sphere('leaf', 0.1 * s, 5, cx + Math.cos(a) * rr, crownY - 0.08 * s + (i % 2) * 0.32 * s,
      cz + Math.sin(a) * rr, i % 2 ? 0xe0738e : 0xe8a6bc, a, 0, 0, 1, 1.18, 1);
  }
  b.kit('prop.peachTree', 1, h / 2);
}

/** 结界玉柱：C-ITM-0363（玉 · 4 根 · 宫四角）——玉柱承霞光，柱身四道符纹，柱头明光 */
function propWardPillar(b: Baker, x: number, z: number): void {
  b.box('ash', 1.05, 0.3, 1.05, x, 0.15, z, shade(W41_JADE_D, 0.94));
  b.cyl('ash', 0.24, 0.31, 3.6, 8, x, 2.1, z, shade(W41_JADE, 0.84));
  b.cyl('ash', 0.36, 0.31, 0.22, 8, x, 4.0, z, shade(W41_JADE, 0.9));
  // 0xfff3d8 线性亮度 0.903 → 深夜档 neon 1.18 抬到 **1.066 > bloom 阈值 1.05**，
  // 是本次全量复查里唯一实测越线的自发光色（16 圈 + 4 柱头同色叠在宫角，起晕后是一串白光点）。
  // 换 0xe6d6b4（0.72 → ×1.18 = 0.85），四种柱身明光同步降档，肉眼只差一档暖度。
  b.cyl('glow', 0.19, 0.19, 0.3, 8, x, 4.24, z, 0xe6d6b4);
  for (let i = 0; i < 3; i++) b.cyl('glow', 0.42 + i * 0.11, 0.42 + i * 0.11, 0.05, 10, x, 1.15 + i * 1.0, z, i % 2 ? 0xe8c070 : 0xe6d6b4, 0, 0, 0, true);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.3;
    b.box('lacquer', 0.12, 0.42, 0.04, x + Math.cos(a) * 0.245, 2.4, z + Math.sin(a) * 0.245, 0x8a6a3a, a);
  }
  b.kit('prop.wardPillar', 1, 2.0);
}

/** 共井：C-ITM-0466（砖石辘轳 · 1 眼 · 院心）——砖砌井台 + 石井圈 + 辘轳架 + 木桶 */
function propSharedWell(b: Baker, x: number, z: number): void {
  b.cyl('ash', 1.2, 1.3, 0.34, 10, x, 0.17, z, shade(W41_STONE, 0.9));
  // 石井圈用开口筒：实心圆柱会把井口封成白盘，水面永远看不见
  b.cyl('ash', 0.96, 1.0, 0.12, 10, x, 0.4, z, shade(W41_STONE, 1.06), 0, 0, 0, true);
  // 井台实体顶 0.34：水面抬到 0.36 才露出；原 0x1e2c33 线性仅 [2,7,10]，井口读成黑洞
  b.cyl('water', 0.84, 0.84, 0.03, 8, x, 0.36, z, 0x24455c);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.1, 1.25, 0.1, x + sx * 0.74, 1.02, z, shade(C.wood, 1.0));
    b.box('ash', 0.26, 0.2, 0.26, x + sx * 0.74, 0.46, z, shade(W41_STONE, 1.0));
  }
  b.box('wood', 1.66, 0.12, 0.12, x, 1.66, z, shade(C.wood, 1.04));
  b.cyl('wood', 0.15, 0.15, 0.82, 8, x, 1.44, z, shade(C.wood, 1.08), 0, 0, Math.PI / 2);
  b.box('metal', 0.06, 0.06, 0.34, x + 0.22, 1.44, z + 0.22, 0x4a4e54, 0.5);
  b.box('wood', 0.05, 0.05, 0.2, x + 0.28, 1.44, z + 0.38, C.woodDark, 0.5);
  b.box('fabric', 0.02, 0.54, 0.02, x, 1.16, z + 0.16, 0xb89b6a);
  b.cyl('wood', 0.16, 0.13, 0.24, 8, x, 0.8, z + 0.16, shade(C.wood, 0.94), 0, 0, 0, true);
  b.kit('prop.sharedWell', 1, 0.3);
}

/** 塌垛口：C-ITM-0303（夯土 · 8 处豁口 · 墙顶）——旧垣残段九截、八处崩塌缺口，缺处散落夯块
 *  落在已建城墙段以东的垣线延长段（既有墙体止于 z=400，地面至 z=426），不覆盖既有雉堞。 */
function propRuinBreaches(b: Baker, x: number, z0: number): void {
  const seg = 1.0, gap = 1.42, n = 9;
  for (let i = 0; i < n; i++) {
    const z = z0 + i * (seg + gap) + seg / 2;
    const h = 3.0 + ((i * 7) % 5) * 0.16;
    b.box('earth', 4.0, h, seg, x, h / 2, z, shade(0xb59b72, 0.82 + (i % 3) * 0.06));
    b.box('earth', 4.3, 0.16, seg + 0.1, x, h + 0.08, z, shade(0x8d7a5c, 1.0));
    for (const sz of [-1, 1]) {
      b.box('ash', 0.7, 0.34, 0.34, x - 1.45, h - 0.22, z + sz * (seg / 2), shade(W41_STONE, 0.86));
    }
    if (i < n - 1) {
      for (let k = 0; k < 3; k++) {
        b.box('earth', 0.86 - k * 0.18, 0.26, 0.8 - k * 0.16, x + (k - 1) * 0.9, 0.14 + k * 0.02, z + seg / 2 + gap / 2, shade(0xb59b72, 0.7 + k * 0.08), k * 0.6);
      }
      b.kit('prop.ruinBreach', 1, 0);
    }
  }
}

/** 拴马桩：C-ITM-0248（石 · 8 根 · 街缘）——石座方桩，桩头刻莲瓣，铁环磨亮 */
function propHitchingPost(b: Baker, x: number, z: number): void {
  b.box('ash', 0.42, 0.14, 0.42, x, 0.07, z, shade(W41_STONE, 0.92));
  b.box('ash', 0.24, 1.05, 0.24, x, 0.62, z, shade(W41_STONE, 1.0));
  b.box('ash', 0.32, 0.16, 0.32, x, 1.2, z, shade(W41_STONE, 1.12));
  b.cyl('ash', 0.19, 0.13, 0.14, 8, x, 1.32, z, shade(W41_STONE, 1.18));
  b.cyl('metal', 0.09, 0.09, 0.04, 8, x, 0.95, z + 0.15, 0x4a4e54, 0, Math.PI / 2);
  b.box('metal', 0.05, 0.05, 0.1, x, 0.95, z + 0.12, 0x4a4e54);
  b.box('ash', 0.02, 0.1, 0.02, x, 0.8, z + 0.13, 0xe8e3d5);
  b.kit('prop.hitchingPost', 1, 0.6);
}

/** 鹤舍仙鹤：C-ITM-0179（活体 · 2 只 · 鹤舍）——丹顶白鹤，长颈伏背、单腿收立 */
function propCrane(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  for (const sx of [-1, 1]) b.cyl('metal', 0.022, 0.026, 0.64, 5, x + sx * 0.09, 0.32, z, 0x2a2620);
  b.cyl('ash', 0.19, 0.25, 0.56, 8, x, 0.86, z, 0xf0ece0, ry, Math.PI / 2);
  for (const sx of [-1, 1]) {
    const [wx, wz] = at(sx * 0.2, -0.04);
    b.box('ash', 0.06, 0.3, 0.4, wx, 0.9, wz, shade(0xe4e0d4, 1.0), ry);
  }
  const [nx, nz] = at(0, 0.3);
  b.cyl('ash', 0.045, 0.075, 0.5, 6, nx, 1.15, nz, 0xf0ece0, 0, 0.3, 0);
  const [hx, hz] = at(0, 0.55);
  b.box('ash', 0.14, 0.14, 0.22, hx, 1.42, hz, 0xf4f0e6, ry);
  b.box('glow', 0.1, 0.05, 0.1, hx, 1.5, hz, 0xd23a2a, ry);
  b.cyl('metal', 0.02, 0.035, 0.22, 5, hx, 1.42, hz + 0.16, 0xd8a24a, 0, Math.PI / 2, 0);
  const [tx, tz] = at(0, -0.4);
  for (let i = 0; i < 3; i++) b.box('ash', 0.1, 0.04, 0.42, tx + (i - 1) * 0.09, 0.98, tz, 0xe8e4d8, ry, 0.2, (i - 1) * 0.2);
  b.kit('prop.crane', 1, 0.86);
}

/** 鹤舍：C-ITM-0179（活体 · 2 只 · 鹤舍）——开敞鹤舍（四柱茅顶）+ 水盆，舍前两只仙鹤 */
function propCraneHouse(b: Baker, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  const HW = 2.0, HD = 1.5, H = 2.35;
  b.box('ash', HW * 2 + 0.5, 0.2, HD * 2 + 0.5, x, 0.1, z, shade(W41_STONE, 0.94), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = at(sx * HW, sz * HD);
    b.box('wood', 0.12, H, 0.12, px, H / 2 + 0.2, pz, shade(C.wood, 0.98), ry);
  }
  for (const sz of [-1, 1]) {
    const [px, pz] = at(0, sz * HD);
    b.box('wood', HW * 2 + 0.24, 0.12, 0.12, px, H + 0.14, pz, C.woodDark, ry);
  }
  b.box('roof', HW * 2 + 1.2, 0.16, HD * 2 + 1.1, x, H + 0.3, z, shade(W41_THATCH, 0.92), ry, 0.1, 0);
  // 三面芦席围
  const [bx, bz] = at(0, -HD);
  b.box('fabric', HW * 2, 1.0, 0.05, bx, 0.72, bz, 0xb0a184, ry);
  for (const sx of [-1, 1]) {
    const [px2, pz2] = at(sx * HW, 0);
    b.box('fabric', 0.05, 1.0, HD * 2, px2, 0.72, pz2, 0xb0a184, ry);
  }
  // 水盆 + 栖架横杆
  b.cyl('ash', 0.42, 0.5, 0.24, 10, x, 0.32, z + 0.9 * Math.cos(ry), shade(W41_STONE, 1.02));
  b.cyl('water', 0.34, 0.34, 0.03, 8, x, 0.42, z + 0.9 * Math.cos(ry), 0x2b4a4a);
  const [rx, rz] = at(0, -0.5);
  b.cyl('wood', 0.05, 0.06, HW * 2 - 0.3, 5, rx, 1.35, rz, shade(C.wood, 1.06), ry, 0, Math.PI / 2);
  b.kit('prop.craneHouse', 1, H);
  const [c1x, c1z] = at(-1.1, 2.4);
  const [c2x, c2z] = at(1.2, 2.6);
  propCrane(b, c1x, c1z, ry - 0.5);
  propCrane(b, c2x, c2z, ry + 0.9);
}

/** WS-41 户外件总装：由 buildGround 在驳岸之后调用（与既有点景同批烘焙，0 新增 draw call） */
export function buildWs41Outdoor(b: Baker): void {
  // ---- 汴河南岸西段：石碣渔村（C-GZ-053）改落老城河湾（原东洋巨泽 12400,6200 在 62km 地形外） ----
  // 渔舍：C-ITM-0377（悬山草顶土屋，门朝河心 +z）
  for (const x of [-396, -388.5, -381, -373.5, -366]) propFishHut(b, x, -38.0, (x % 7) * 0.012);
  for (const x of [-392, -384.5, -377, -369.5, -362]) propFishHut(b, x, -43.6, (x % 5) * 0.014);
  // 小埠头：C-ITM-0382
  wharfFishJetty(b, -352, -31.3);
  // 渔船：C-ITM-0379（六艘泊于埠头两侧，水线 y=1.0）
  wharfFishingBoat(b, -366, -26.2, 0.12);
  wharfFishingBoat(b, -358, -24.8, -0.08);
  wharfFishingBoat(b, -350, -26.6, 0.16);
  wharfFishingBoat(b, -342, -25.0, -0.12);
  wharfFishingBoat(b, -334, -26.4, 0.06);
  wharfFishingBoat(b, -378, -25.4, -0.04);

  // ---- 汴河北岸中东段：西河昆仑渡口（C-GZ-054）改落老城河湾（原 −16000,3800 在城外） ----
  // 埠头马道：C-ITM-0383
  wharfStoneMooring(b, -132, 31.3);
  // 缆桩：C-ITM-0385（四根立于石埠台面 1.34，两前两后）
  for (const [bx, bz] of [[-135.0, 29.2], [-129.0, 29.2], [-135.0, 30.8], [-129.0, 30.8]] as const) wharfBollard(b, bx, bz, 1.34);
  // 跳板：C-ITM-0386
  wharfFerryPlank(b, -134.2, 27.6, 25.2);
  wharfFerryPlank(b, -129.8, 27.6, 25.2);
  // 渡船：C-ITM-0384（两艘并靠石埠台，艏对着跳板落点 z=25.2）
  wharfFerryBoat(b, -134.2, 22.6, 0.1);
  wharfFerryBoat(b, -129.8, 22.9, -0.14);
  // 渡口草棚：C-ITM-0387
  wharfFerryShed(b, -119, 36.4);

  // ---- 汴河北岸西段：漕运仓区（丰济仓 + 转运仓；护仓栅栏 C-ITM-0398 已在位） ----
  // 仓廒 ×4（丰济仓，门朝栅门 −z）：C-ITM-0395
  propGranary(b, -258, 36.6, 8.4, 5.2, Math.PI);
  propGranary(b, -208, 36.6, 8.4, 5.2, Math.PI);
  propGranary(b, -250, 43.2, 8.4, 4.2, Math.PI);
  propGranary(b, -220, 43.2, 8.4, 4.2, Math.PI);
  b.kit('prop.granary.fengji', 4, 2.5);
  // 仓廒 ×6（转运仓，门朝船闸方向 −z）：C-ITM-0389
  for (const x of [-330, -319, -308]) propGranary(b, x, 36.6, 8.4, 5.2, Math.PI);
  for (const x of [-330, -319, -308]) propGranary(b, x, 43.2, 8.4, 4.2, Math.PI);
  b.kit('prop.granary.transfer', 6, 2.5);
  // 守仓兵铺：C-ITM-0393（值房分据仓场两端，门朝正街 +z）
  propGuardPost(b, -340.5, 39.5, 0);
  propGuardPost(b, -297.5, 39.5, 0);

  // ---- 汴河北岸西端：驿路村口（丝路驿站 C-GZ-051 改落郊野驿路口） ----
  // 驿卒舍：C-ITM-0370（夯土小屋，前排门朝河 −z，后排门朝街 +z）
  for (const [hx, hz, hr] of [[-466, 37.4, Math.PI], [-458, 37.4, Math.PI], [-466, 43.4, 0], [-458, 43.4, 0]] as const) {
    propPostHouse(b, hx, hz, hr);
  }
  // 石堆敖包：C-ITM-0372（草原祭坛 C-GZ-052 改落城西驿路尽头）
  propCairn(b, -624, 40);

  // ---- 汴河北岸柳堤：郊野柳林茶亭射圃（C-GZ-043） ----
  // 射柳靶场：C-ITM-0315
  propArcheryRange(b);

  // ---- 城东庙市与仙苑（上清观东侧空地，避开城内南北街 x=556..564） ----
  // 庙市棚：C-ITM-0350（二十组，两列相对，夹一条市街）
  for (let i = 0; i < 10; i++) propTempleStall(b, 570 + i * 8, 106, (i % 3 - 1) * 0.04);
  for (let i = 0; i < 10; i++) propTempleStall(b, 572 + i * 8, 112.2, Math.PI + (i % 3 - 1) * 0.04);
  // 道士舍：C-ITM-0337
  propTaoistHut(b, 504, 108, 0);
  propTaoistHut(b, 516, 108, 0);
  // 守庙人舍：C-ITM-0343
  propTempleKeeperHut(b, 568, 122, Math.PI);
  // 鹤舍：C-ITM-0179
  propCraneHouse(b, 516, 131, Math.PI);
  // 石阶 108 级：C-ITM-0341（朝岳阶，自庙园南端登上岳台）
  propStoneSteps(b, 504, 152, 130, 6.4);
  // 古柏群：C-ITM-0347（六十株，庙园四周七列）
  const cypressRows: [number, number[]][] = [
    [120, [580, 592, 604, 616, 628, 640, 652]],
    [126, [574, 586, 598, 610, 622, 634, 646]],
    [132, [580, 592, 604, 616, 628, 640]],
    [138, [574, 586, 598, 610, 622, 634, 646]],
    [174, [574, 586, 598, 610, 622, 634, 646]],
    [180, [580, 592, 604, 616, 628, 640]],
    [186, [574, 586, 598, 610, 622, 634, 646]],
    [192, [580, 592, 604, 616, 628, 640]],
    [198, [574, 586, 598, 610, 622, 634, 646]],
  ];
  for (const [cz, xs] of cypressRows) {
    for (const cx of xs) propAncientCypress(b, cx, cz, 0.86 + ((cx + cz) % 7) * 0.045);
  }
  // 结界玉柱：C-ITM-0363
  propWardPillar(b, 586, 144);
  propWardPillar(b, 630, 144);
  propWardPillar(b, 586, 180);
  propWardPillar(b, 630, 180);
  // 瑶池：C-ITM-0359（天宫/昆仑瑶池行宫的水景改落人间庙园，见报告）
  propJadePool(b, 608, 158, 13.0, 7.4);
  // 白玉阶：C-ITM-0357（九重玉阶，自池北沿下到水面）
  propJadeSteps(b, 608, 162.4, 154.4, 6.0);
  // 蟠桃园：C-ITM-0362（十二株，池周）
  for (const px of [594, 601, 616, 623]) propPeachTree(b, px, 143.4, 0.95 + (px % 3) * 0.06);
  for (const px of [594, 601, 616, 623]) propPeachTree(b, px, 170.6, 1.0 + (px % 3) * 0.05);
  for (const [px, pz] of [[589, 151], [589, 165], [627, 151], [627, 165]] as const) propPeachTree(b, px, pz, 0.92);

  // ---- 城内：街缘拴马桩 / 共井 / 更铺 / 塌垛口 / 旧垣朝岳阶 ----
  // 拴马桩：C-ITM-0248（八根沿北岸正街南缘）
  for (const x of [150, 162, 174, 186, 198, 210, 222, 234]) propHitchingPost(b, x, 44.0);
  // 共井：C-ITM-0466（積善堂宅院前院院心）
  propSharedWell(b, 505, 34.5);
  // 更铺：C-ITM-0237
  propWatchPost(b, 438, 36, 0);
  // 塌垛口：C-ITM-0303（旧垣残段八处豁口，落在东墙 400 以外的垣线延长段 402..422）
  propRuinBreaches(b, 462, 402);
}

// ============ R1：河道贯通（城外驳岸延长 / 两端石拱涵洞 / 桥头泊船） ============
/**
 * 城外段石砌驳岸：x 640 → ±4992，两侧各一条，随 riverHalfWidth / riverCenterZ 走。
 * 剖面照抄城里那段（buildGround 的 1240m 驳岸）：2.0m 墙身 + 0.26 压顶 + 望柱 + 临水踏步。
 * 为什么必须补：R1 把水位恒定在 1.0（旧版 700m 外降到 −0.2 沉进地面），
 * 城外若没有这圈墙，水面就是一条离地 1m 的悬空带。
 */
export function buildRiverEdges(b: Baker): void {
  const SEG = 120;
  for (const s of [1, -1] as const) {
    for (let x = 628; x < RIVER_END - 2; x += SEG) {
      const x1 = Math.min(x + SEG, RIVER_END - 2);
      const xm = (x + x1) / 2;
      const zc = riverCenterZ(xm) + s * (riverHalfWidth(xm) + 0.6);
      const k = 0.98 + ((x / SEG) % 2) * 0.04;
      b.box('wall', x1 - x + 0.5, 2.0, 1.4, xm, 0.1, zc, shade(0x6a6055, k));
      b.box('wall', x1 - x + 0.5, 0.26, 1.8, xm, 1.24, zc, shade(0x7d7264, 1.02));
    }
    // 望柱：只在近城 2km 立（远处 0.3m 读不出来，白烧面数）；每 60m 一根，每三根一盏霓虹
    for (let x = 660; x <= 2600; x += 60) {
      const zc = riverCenterZ(x) + s * (riverHalfWidth(x) + 0.6);
      b.box('wall', 0.42, 0.95, 0.42, x, 1.78, zc, shade(0x7d7264, 1.04));
      if ((x / 60) % 3 === 0) b.box('glow', 0.14, 0.18, 0.14, x, 2.32, zc, s > 0 ? 0x00e5ff : 0xffb300);
    }
    // 临水踏步：每 240m 一处，与城里那五处同制
    for (let x = 760; x <= RIVER_END - 200; x += 240) {
      const zc = riverCenterZ(x) + s * (riverHalfWidth(x) + 0.6);
      for (let st = 0; st < 3; st++) {
        b.box('wall', 9, 0.34, 1.1, x, 0.9 - st * 0.34, zc + s * (0.6 + st * 0.9), shade(0x6a6055, 1.04 - st * 0.04));
      }
    }
  }
  b.kit('river.revetment', 4, 1.2);
  // 两端：水面在城墙内皮没入石拱涵洞（洞脸 + 拱券 + 铁栅 + 压顶），经水关出城接护城河
  riverCulvert(b, 1);
  riverCulvert(b, -1);
  // 桥头泊船：三处过河点各三艘，靠岸 19m 一线（15 艘往复船的航道在 |z|≤16，不打架）
  for (const [x, z, ry] of [[-1742, -19.0, 0.08], [-1733, -19.5, -0.05], [-1724, -18.8, 0.12]] as const) {
    wharfFishingBoat(b, x, z, ry);
  }
  for (const [x, z, ry] of [[1668, 19.0, -0.06], [1677, 19.5, 0.09], [1686, 18.9, -0.1]] as const) {
    wharfFishingBoat(b, x, z, ry);
  }
  for (const [x, z, ry] of [[-2556, 18.6, 0.05], [-2546, 18.9, -0.08]] as const) {
    wharfFerryBoat(b, x, z, ry);
  }
}

/**
 * 石拱涵洞（R1 的两端收口）：洞脸跨 42m（与末端河宽同宽）、拱脚落在水面 1.0、拱顶 5.4、洞身 12m。
 * 水面在洞内 3m 处没入暗背板 —— 读成"河从城墙下的水关流出去"，不是一刀平切的断头水。
 */
function riverCulvert(b: Baker, side: 1 | -1): void {
  const cz = riverCenterZ(side * RIVER_END);
  const hw = riverHalfWidth(side * RIVER_END);        // 21 → 洞脸 42m
  const TH = 12;
  const xBack = side * 4991.5, xFront = side * (4991.5 - TH), xc = side * (4991.5 - TH / 2);
  const SPRING = 1.0, RISE = 4.4, TOP = 8.2;
  // 两帮：洞脸外 7m 实墙，自河床 −2.8 砌到压顶
  for (const s of [-1, 1] as const) {
    b.box('ash', TH, TOP + 2.8, 7.0, xc, (TOP - 2.8) / 2, cz + s * (hw + 3.5), shade(C.stone, 0.95));
  }
  // 拱上填充：沿 z 切片，自拱线砌到压顶
  const N = 30;
  for (let i = 0; i < N; i++) {
    const dz0 = -hw + (2 * hw * i) / N, dz1 = -hw + (2 * hw * (i + 1)) / N;
    const dm = (dz0 + dz1) / 2;
    const t = dm / hw;
    const archY = SPRING + RISE * Math.sqrt(Math.max(0, 1 - t * t));
    if (TOP - archY > 0.05) {
      b.box('ash', TH, TOP - archY, Math.abs(dz1 - dz0) + 0.05, xc, (TOP + archY) / 2, cz + dm, shade(C.stone, 0.97 + (i % 3) * 0.02));
    }
  }
  // 拱券脸石：洞脸一圈 13 块
  for (let k = 0; k < 13; k++) {
    const a0 = (Math.PI * k) / 13, a1 = (Math.PI * (k + 1)) / 13;
    const dz1 = hw * Math.cos(a0), dz2 = hw * Math.cos(a1);
    const y1 = SPRING + RISE * Math.sin(a0), y2 = SPRING + RISE * Math.sin(a1);
    const ang = -Math.atan2(y2 - y1, dz2 - dz1);
    const len = Math.hypot(dz2 - dz1, y2 - y1) * 1.14;
    b.box('ash', 0.42, 0.72, len, xFront - side * 0.2, (y1 + y2) / 2, cz + (dz1 + dz2) / 2,
      shade(C.stone, 1.06 + (k % 2) * 0.06), 0, ang, 0);
  }
  b.box('ash', 0.5, 0.9, 1.2, xFront - side * 0.2, SPRING + RISE + 0.2, cz, shade(C.stone, 1.2)); // 龙门石
  // 洞内暗背板：水体在洞内 3m 处没入黑暗（水带到 ±4992，背板在 ±4991）
  b.box('wall', 0.5, RISE + 1.8, hw * 2 + 1.2, xBack - side * 0.4, SPRING + RISE / 2, cz, 0x0a0e12);
  // 铁栅：11 根露头 2.3m + 上下两道横槛
  for (let k = -5; k <= 5; k++) {
    b.box('metal', 0.26, 2.3, 0.12, xFront + side * 1.0, 2.15, cz + k * 2.5, 0x3a4048);
  }
  b.box('metal', 0.3, 0.16, hw * 2, xFront + side * 1.0, 3.3, cz, 0x3a4048);
  b.box('metal', 0.3, 0.16, hw * 2, xFront + side * 1.0, 1.0, cz, 0x3a4048);
  // 压顶 + 两侧女墙 + 两盏灯
  b.box('ash', TH + 0.8, 0.4, hw * 2 + 15, xc, TOP + 0.2, cz, shade(C.stone, 1.12));
  for (const s of [-1, 1] as const) {
    b.box('ash', TH + 0.6, 1.0, 0.5, xc, TOP + 0.9, cz + s * (hw + 6.4), shade(C.stone, 1.0));
    b.box('glow', 0.3, 0.4, 0.3, xFront + side * 0.1, TOP + 1.4, cz + s * (hw + 2.6), C.lantern);
  }
  b.kit('river.culvert', 1, 4.0);
}
