import type { Baker, BGroup } from '../city/bake';
import { shade } from '../city/bake';
import type { RNG } from '../core/rng';
import { terrainSurfaceY } from './terrain';

const SAND = 0xc8b48a;
const MUD = 0x8c6a46;
const DARK_WOOD = 0x4a3220;
const CANVAS = 0xc3ae8a;
const STONE = 0x7a7468;
const PALM_LEAF = 0x5e7a3a;

export function buildDesertOutpost(
  b: Baker,
  x: number,
  z: number,
  heightAt: (x: number, z: number) => number,
  rng: RNG,
): void {
  // 绿洲水面与石砌池沿：水面取池沿最高地形，避免沙丘把水盘埋掉或架空
  const ox = x + 14, oz = z - 8;
  let poolY = heightAt(ox, oz);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    poolY = Math.max(poolY, heightAt(ox + Math.cos(a) * 15.6, oz + Math.sin(a) * 15.6));
  }
  poolY += 0.18;
  b.cyl('water', 15, 15, 0.12, 32, ox, poolY, oz, 0x3a6f78);
  // 石砌池壁：从水面下缘一直落到沙面，避免水盘像悬空圆盘（沙丘无法下挖，用砌壁造出积水盆地）
  b.cyl('ash', 15.3, 15.3, 4.4, 32, ox, poolY - 0.16 - 2.2, oz, shade(STONE, 0.98));
  // 石砌池沿：两层错缝块石，顶面与水面齐平，遮住水盘与沙面的接缝
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    b.box('ash', 1.5, 0.5, 0.78, ox + Math.cos(a) * 15.4, poolY + 0.1, oz + Math.sin(a) * 15.4, shade(STONE, 1.02 + (i % 3) * 0.05), -a);
    if (i % 2 === 0) {
      b.box('ash', 1.1, 0.34, 0.62, ox + Math.cos(a + 0.1) * 15.9, poolY + 0.44, oz + Math.sin(a + 0.1) * 15.9, shade(STONE, 0.94 + (i % 3) * 0.05), -a);
    }
  }
  b.kit('desert.well', 1, poolY);

  // 商站：夯土台、U 形墙、角楼与门洞
  const cx = x - 24;
  const cz = z + 14;
  // 台基顶取堡内最高地形：此前按中心点取高，沙丘把院内井圈、草料埋掉，只剩井架浮在沙面
  let hiY = -1e9, loY = 1e9;
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
    const hh = heightAt(cx + sx * 11.5, cz + sz * 8.6);
    hiY = Math.max(hiY, hh); loY = Math.min(loY, hh);
  }
  const baseY = hiY + 0.55;
  b.box('earth', 25, baseY - loY + 2.4, 19, cx, (baseY + loY - 2.4) / 2, cz, shade(SAND, 0.92));
  b.box('earth', 24, 4.2, 0.8, cx, baseY + 2.35, cz - 9, MUD);
  b.box('earth', 0.8, 4.2, 18, cx - 12, baseY + 2.35, cz, MUD);
  b.box('earth', 0.8, 4.2, 18, cx + 12, baseY + 2.35, cz, shade(MUD, 0.93));
  for (const side of [-1, 1]) {
    b.box('earth', 7.2, 4.2, 0.8, cx + side * 8.4, baseY + 2.35, cz + 9, shade(MUD, 0.96));
    b.box('wood', 0.3, 3.5, 0.3, cx + side * 4.8, baseY + 1.9, cz + 9, DARK_WOOD);
    b.box('roof', 8.4, 0.25, 1.2, cx + side * 8.4, baseY + 4.55, cz + 9, shade(SAND, 0.8));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('earth', 2.8, 6.2, 2.8, cx + sx * 11.2, baseY + 3.1, cz + sz * 7.6, shade(MUD, 0.9), 0);
    b.pyramid('roof', 0.1, 0.7, cx + sx * 11.2, baseY + 6.4, cz + sz * 7.6, shade(SAND, 0.72), 0, 3.8, 1.2, 3.8);
  }
  b.box('wood', 9.6, 0.35, 1.1, cx, baseY + 4.55, cz + 9, DARK_WOOD);
  b.box('glow', 4.8, 0.12, 0.12, cx, baseY + 4.0, cz + 9.45, 0xffb36e);

  // 院内脏乱差不可取：井、饮马槽、草料、货堆、遮阳棚 —— 商站是有人起居劳作的院子
  const fy2 = baseY;
  b.cyl('ash', 1.05, 1.2, 0.9, 12, cx - 7.4, fy2 + 0.45, cz - 5.2, shade(STONE, 1.05));
  b.cyl('water', 0.85, 0.85, 0.1, 12, cx - 7.4, fy2 + 0.86, cz - 5.2, 0x2e5a60);
  for (const s3 of [-1, 1]) b.box('wood', 0.16, 1.9, 0.16, cx - 7.4 + s3 * 1.25, fy2 + 1.05, cz - 5.2, DARK_WOOD);
  b.box('wood', 2.9, 0.18, 0.18, cx - 7.4, fy2 + 1.95, cz - 5.2, DARK_WOOD);
  b.cyl('wood', 0.2, 0.22, 0.26, 8, cx - 7.4, fy2 + 1.55, cz - 5.2, 0x6a4a2c);
  b.kit('desert.yardWell', 1, fy2);
  // 饮马槽
  b.box('wood', 3.0, 0.62, 0.85, cx + 3.4, fy2 + 0.31, cz - 6.4, 0x6a4a2c);
  b.box('water', 2.7, 0.08, 0.6, cx + 3.4, fy2 + 0.54, cz - 6.4, 0x2e5a60);
  b.kit('desert.trough', 1, fy2);
  // 草料捆
  for (let k = 0; k < 5; k++) {
    const hx = cx + 7.2 - (k % 3) * 1.5, hz = cz - 5.6 + Math.floor(k / 3) * 1.4;
    b.box('leaf', 1.4, 0.62, 0.9, hx, fy2 + 0.31 + Math.floor(k / 3) * 0.62, hz, shade(0xb99a54, 0.9 + (k % 2) * 0.1), k * 0.4);
  }
  b.kit('desert.hay', 5, fy2);
  // 院内货堆（羊毛包与陶罐）
  for (let k = 0; k < 4; k++) {
    b.box('fabric', 1.5, 0.85, 1.1, cx - 8.4 + (k % 2) * 1.7, fy2 + 0.42, cz + 5.4 + Math.floor(k / 2) * 1.3, shade(CANVAS, 0.88 + (k % 3) * 0.04), k * 0.12);
  }
  b.kit('desert.woolBale', 4, fy2);
  // 遮阳棚：四柱 + 双坡苇席顶（单块平板俯视会读成地上摊着的一块白布）
  const awY = fy2 + 2.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.box('wood', 0.2, 2.4, 0.2, cx + 2.2 + sx * 2.6, fy2 + 1.2, cz + 5.2 + sz * 1.8, DARK_WOOD);
  }
  for (const s4 of [-1, 1]) {
    b.box('fabric', 3.0, 0.09, 4.3, cx + 2.2 + s4 * 1.5, awY + 0.14, cz + 5.2, shade(CANVAS, 0.72), 0, 0, s4 * 0.1);
    for (let r = 0; r < 5; r++) {
      b.box('fabric', 2.95, 0.05, 0.12, cx + 2.2 + s4 * 1.5, awY + 0.22, cz + 5.2 - 1.6 + r * 0.8, shade(CANVAS, 0.5), 0, 0, s4 * 0.1);
    }
  }
  b.box('wood', 0.16, 0.16, 4.5, cx + 2.2, awY + 0.34, cz + 5.2, DARK_WOOD);
  b.kit('desert.awning', 1, fy2);

  // 集市帐篷：四柱 + 双坡顶 + 后幅围布 + 地上铺席（原先只有一块平顶布，远看像两根光杆）
  const tents: [number, number][] = [[x + 36, z + 18], [x + 42, z + 4], [x - 58, z - 18]];
  for (const [tx, tz] of tents) {
    const ty = heightAt(tx, tz);
    for (const [dx, dz] of [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.8], [2.4, 1.8]] as const) {
      b.box('wood', 0.16, 2.7, 0.16, tx + dx, ty + 1.35, tz + dz, DARK_WOOD);
    }
    for (const s5 of [-1, 1]) {
      b.box('fabric', 2.9, 0.1, 4.4, tx + s5 * 1.35, ty + 3.05, tz, shade(CANVAS, 0.84), 0, 0, s5 * 0.22);
    }
    b.box('wood', 0.14, 0.14, 4.5, tx, ty + 3.4, tz, DARK_WOOD);
    b.box('fabric', 0.1, 2.4, 4.0, tx - 2.55, ty + 1.85, tz, shade(CANVAS, 0.8), 0, 0, -0.05);
    b.box('fabric', 5.0, 0.08, 2.4, tx, ty + 0.1, tz + 0.8, shade(CANVAS, 0.76));
    b.kit('desert.tent', 1, ty);
  }

  // 棕榈树
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    const r = 19 + (i % 3) * 3;
    const px = x + 14 + Math.cos(a) * r;
    const pz = z - 8 + Math.sin(a) * r;
    const py = heightAt(px, pz);
    b.cyl('trunk', 0.24, 0.4, 5.8 + (i % 2) * 0.8, 7, px, py + 2.9, pz, shade(0x6a4d32, 1.02), 0, 0, 0.03);
    for (let k = 0; k < 7; k++) {
      const la = k * 0.897;
      b.box('leaf', 3.3, 0.08, 0.7, px + Math.cos(la) * 1.5, py + 5.9 + (k % 2) * 0.35, pz + Math.sin(la) * 1.5, shade(PALM_LEAF, 0.9 + (k % 3) * 0.06), la, 0.15);
    }
    b.kit('desert.palm', 1, py);
    // 胡杨：棕榈间穿插，沙地才有西陲树种层次
    if (i % 2 === 0) {
      const hx = x - 30 + i * 11 + rng.range(-4, 4);
      const hz = z + 30 - i * 4 + rng.range(-4, 4);
      poplar(b, hx, heightAt(hx, hz), hz, rng.range(0.85, 1.2));
    }
  }

  // 商队货箱、陶瓮和火塘
  for (let i = 0; i < 8; i++) {
    const ox = x + 20 + (i % 4) * 2.1;
    const oz = z + 12 - Math.floor(i / 4) * 2.3;
    const oy = heightAt(ox, oz);
    b.box('wood', 1.0, 0.82, 0.9, ox, oy + 0.41, oz, shade(0x7a5a36, 0.9 + (i % 3) * 0.06), i * 0.21);
    b.box('metal', 0.08, 0.78, 0.94, ox - 0.4, oy + 0.42, oz, 0x4a4e54, i * 0.21);
    b.kit('desert.crate', 1, oy);
  }
  for (let i = 0; i < 5; i++) {
    const ox = x + 18 + i * 1.2;
    const oz = z + 5;
    const oy = heightAt(ox, oz);
    b.cyl('ceramic', 0.28, 0.4, 0.82, 9, ox, oy + 0.41, oz, shade(0x955539, 0.9));
    b.kit('desert.amphora', 1, oy);
  }
  const fx = x + 27;
  const fz = z - 2;
  const fy = heightAt(fx, fz);
  b.cyl('wall', 1.4, 1.6, 0.28, 12, fx, fy + 0.14, fz, STONE);
  b.cyl('glow', 0.55, 0.8, 0.45, 9, fx, fy + 0.35, fz, 0xff7a3c);
  for (let i = 0; i < 3; i++) b.box('wood', 1.8, 0.16, 0.16, fx, fy + 0.15, fz, DARK_WOOD, i * 1.047);
  b.kit('desert.fire', 1, fy);

  // 路标与商道石
  for (let i = 0; i < 4; i++) {
    const wx = x + 52 + i * 12;
    const wz = z - 6 + i * 3;
    const wy = heightAt(wx, wz);
    b.box('wall', 0.55, 2.2 + (i % 2) * 0.5, 0.55, wx, wy + 1.1, wz, shade(STONE, 1.02), 0.2);
    b.box('wood', 1.8, 0.28, 0.14, wx, wy + 2.1, wz, DARK_WOOD, -0.4);
    b.kit('desert.waystone', 1, wy);
  }

  // 风蚀岩群与兽骨
  for (let i = 0; i < 18; i++) {
    const rx = x + rng.range(-95, 95);
    const rz = z + rng.range(-75, 75);
    if (Math.hypot(rx - x, rz - z) < 26) continue;
    const ry = heightAt(rx, rz);
    const s = rng.range(0.8, 3.2);
    b.cyl('wall', s * 0.35, s * 0.75, s, 5 + (i % 3), rx, ry + s * 0.45, rz, shade(STONE, 0.82 + rng.range(0, 0.18)), rng.range(0, 6.28), rng.range(-0.16, 0.16));
    if (i % 3 === 0) b.box('wall', s * 1.3, s * 0.42, s * 0.8, rx + s * 0.7, ry + s * 0.2, rz, shade(STONE, 0.88), rng.range(0, 6.28));
    b.kit('desert.rock', 1, ry);
  }
  for (let i = 0; i < 4; i++) {
    const bx = x - 55 + i * 3.2;
    const bz = z - 28;
    const by = heightAt(bx, bz);
    b.box('wall', 1.2, 0.12, 0.16, bx, by + 0.12, bz, 0xd8d0bc, i * 0.6, 0, 0.1);
    b.kit('desert.bone', 1, by);
  }

  // 天山雪莲 T-PLT-005：峰腰雪线带（绕峰 2.7~3.7km、海拔 300~1200m）。城里没有第二个
  // 能拿到真实 heightAt 的高海拔落点，故借本函数同批烘焙；坐标在天山，不在商站。
  // 用就地 LCG 而非共享 rng：否则 world.ts 后续 scatterVegetation 的 1500 棵树会整体漂移
  const TX = -22000, TZ = -16000;
  let ss = (Math.imul(Math.round(TX * 5 + TZ * 3) ^ 0x27d4eb2f, 2246822519) >>> 0) || 59;
  const srand = (): number => ((ss = (Math.imul(ss ^ (ss >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (srand() - 0.5) * 0.1;
    const rr = 2700 + (i % 5) * 250 + (srand() - 0.5) * 140;
    const lx = TX + Math.cos(a) * rr, lz = TZ + Math.sin(a) * rr * 0.94;
    const ly = meshHeight(heightAt, lx, lz);
    if (ly < 300 || ly > 1200) continue;
    snowLotus(b, lx, ly, lz, 0.85 + srand() * 0.45);
  }

// ---- 商队货栈：两座土坯库房 + 围墙 + 货堆（沙站原本只有帐篷与箱子，没有"屯货"的建筑） ----
  // 库房原在 (-38,16)/(-44,-6)，其中第一座正好穿过夯土堡西墙与西南角楼 —— 挪到堡西南外的货栈院里
  const depots: [number, number, number][] = [[-44, 36, 9.5], [-46, 50, 8]];
  for (const [dx, dz, dw] of depots) {
    const ax = x + dx, az = z + dz;
    const ay = heightAt(ax, az);
    b.box('earth', dw, 3.4, dw * 0.72, ax, ay + 1.7, az, shade(0xb59a72, 1));
    b.box('earth', dw + 0.6, 0.4, dw * 0.72 + 0.6, ax, ay + 3.6, az, shade(0xa88c66, 1));
    b.box('wood', 1.4, 2.2, 0.16, ax, ay + 1.1, az + dw * 0.36 + 0.1, 0x4a3520);
    for (const s2 of [-1, 1]) b.cyl('wood', 0.08, 0.1, 2.4, 5, ax + s2 * 2.4, ay + 1.2, az + dw * 0.36 + 0.3, 0x4a3520);
    b.box('fabric', dw * 0.9, 0.06, 2.2, ax, ay + 2.5, az + dw * 0.36 + 1.1, 0x8a7452, 0, 0.18, 0);
    for (let k = 0; k < 5; k++) {
      b.box('wood', 0.9, 0.7, 0.8, ax - 2 + (k % 3) * 1.3, ay + 0.35, az + dw * 0.5 + 1.4 + Math.floor(k / 3) * 0.9, shade(0x7a5a36, 0.92 + (k % 2) * 0.1), k * 0.18);
      b.kit('desert.depotCrate', 1, ay);
    }
    b.kit('desert.depot', 1, ay);
  }
  // 货栈院墙：紧贴两座库房围一圈（北侧正对驼道处留断口），与夯土堡互不侵入
  for (let k = 0; k < 10; k++) {
    const wx2 = x - 64 + k * 3.2;
    const wy2 = heightAt(wx2, z + 27);
    b.box('earth', 3.0, 1.6, 0.5, wx2, wy2 + 0.8, z + 27, shade(0xb59a72, 0.94), 0.02 * (k % 3));
  }
  for (let k = 0; k < 10; k++) {
    const wx2 = x - 64 + k * 3.2;
    const wy2 = heightAt(wx2, z + 58);
    b.box('earth', 3.0, 1.4, 0.5, wx2, wy2 + 0.7, z + 58, shade(0xb59a72, 0.9), 0.02 * (k % 3));
  }
  for (let k = 0; k < 10; k++) {
    for (const wxw of [x - 65.5, x - 35.5]) {
      const wz2 = z + 28.6 + k * 3.2;
      const wy2 = heightAt(wxw, wz2);
      b.box('earth', 0.5, 1.5, 3.0, wxw, wy2 + 0.75, wz2, shade(0xb59a72, 0.92), 0.02 * (k % 3));
    }
  }
  b.kit('desert.depotWall', 40, heightAt(x, z + 27));
}

/** 胡杨：虬曲主干 + 稀疏金叶冠（西陲大漠标志树种） */
export function poplar(b: Baker, x: number, y: number, z: number, s = 1): void {
  let seed = (Math.imul(Math.round(x * 7 + z * 13) ^ 0x27d4eb2d, 2246822519) >>> 0) || 5;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const h = (4.6 + rnd() * 2.6) * s;
  b.cyl('trunk', 0.16 * s, 0.36 * s, h, 6, x, y + h / 2, z, 0x5a4630, 0, 0, (rnd() - 0.5) * 0.12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rnd();
    b.cyl('trunk', 0.08 * s, 0.14 * s, 1.6 * s, 5, x + Math.cos(a) * 0.5 * s, y + h * 0.72, z + Math.sin(a) * 0.5 * s, 0x5e4a32, 0, Math.sin(a) * 0.7, -Math.cos(a) * 0.7);
    b.cyl('leaf', 0.5 * s, 0.9 * s, 1.0 * s, 7, x + Math.cos(a) * 1.5 * s, y + h * 0.86, z + Math.sin(a) * 1.5 * s, shade(0xc8a23a, 0.9 + rnd() * 0.2), rnd() * 3.14, 0, 0, true, 1, 0.7, 1);
    b.kit('flora.poplarCrown', 1, y + h * 0.86);
  }
  b.cyl('leaf', 0.6 * s, 1.1 * s, 1.2 * s, 7, x, y + h * 1.0, z, shade(0xd4ae42, 1.05), 0, 0, 0, true, 1, 0.75, 1);
  b.kit('flora.poplar', 1, y + h / 2);
}

/**
 * 天山雪莲 T-PLT-005：莲座叶 + 白苞 + 淡青花心
 * 解析高度场与渲染网格有插值差（网格 206m 一格），必须踩网格面，否则整丛浮空或被雪坡吞掉
 */
function meshHeight(terrain: (x: number, z: number) => number, x: number, z: number): number {
  const step = 62000 / 300, half = 31000;
  const fx = (x + half) / step, fz = (z + half) / step;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const x0 = ix * step - half, x1 = x0 + step, z0 = iz * step - half, z1 = z0 + step;
  const h00 = terrain(x0, z0), h10 = terrain(x1, z0), h01 = terrain(x0, z1), h11 = terrain(x1, z1);
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/** 局部坡度：渲染面四点梯度给 Baker 的 rx/rz，倾角封顶 25°；gap 是超出封顶后的残余坡差（每米抬升） */
function slopeFrame(x: number, z: number): { rx: number; rz: number; gap: number } {
  const e = 6;
  const gx = (terrainSurfaceY(x + e, z) - terrainSurfaceY(x - e, z)) / (2 * e);
  const gz = (terrainSurfaceY(x, z + e) - terrainSurfaceY(x, z - e)) / (2 * e);
  const g = Math.hypot(gx, gz);
  if (g < 1e-6) return { rx: 0, rz: 0, gap: 0 };
  const th = Math.atan(g), lim = (25 * Math.PI) / 180;
  const k = Math.sin(Math.min(th, lim)) / g;
  return { rx: -gz * k, rz: gx * k, gap: Math.sin(Math.max(0, th - lim)) };
}

export function snowLotus(b: Baker, x: number, y: number, z: number, s = 1): void {
  let seed = (Math.imul(Math.round(x * 19 + z * 7) ^ 0x27d4eb2f, 2246822519) >>> 0) || 31;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 374761393) >>> 0) / 4294967296);
  const leafC = 0x3e6a52;
  const { rx, rz, gap } = slopeFrame(x, z);
  const cz = Math.cos(rz), sz = Math.sin(rz), cx = Math.cos(rx), sx = Math.sin(rx);
  // 与 Baker 的 Rx·Ry·Rz 同序：局部点先绕 Z 再绕 X，植株重心始终落在倾斜后的坡面上
  const at = (lx: number, ly: number, lz: number): [number, number, number] => {
    const x1 = lx * cz - ly * sz, y1 = lx * sz + ly * cz;
    return [x + x1, y + y1 * cx - lz * sx, z + y1 * sx + lz * cx];
  };
  // 外圈莲座叶：平铺外展，长度与出叶角都带抖，免得读成一朵规则花
  const out = 7 + Math.floor(rnd() * 3);
  for (let i = 0; i < out; i++) {
    const a = (i / out) * Math.PI * 2 + rnd() * 0.35;
    const len = (0.5 + rnd() * 0.22) * s;
    const r0 = 0.1 * s + len * 0.5;
    const [wx, wy, wz] = at(Math.cos(a) * r0, 0.055 * s, Math.sin(a) * r0);
    b.box('leaf', 0.17 * s, 0.045 * s, len, wx, wy, wz,
      shade(leafC, 0.84 + rnd() * 0.28), a, rx, rz);
  }
  // 内圈短叶：压在花苞下缘，遮住苞脚
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4 + rnd() * 0.3;
    const [wx, wy, wz] = at(Math.cos(a) * 0.22 * s, 0.13 * s, Math.sin(a) * 0.22 * s);
    b.box('leaf', 0.14 * s, 0.04 * s, (0.3 + rnd() * 0.12) * s, wx, wy, wz,
      shade(leafC, 1.02 + rnd() * 0.18), a + 0.5, rx, rz);
  }
  // 雪：叶面上一层薄白（贴地雪堆，把根压进坡里）
  const [nx, ny, nz] = at(0, -0.03 * s, 0);
  b.cyl('leaf', 0.42 * s, 0.56 * s, 0.1 * s, 9, nx, ny, nz, shade(0xe4ecf0, 0.98), 0, rx, rz);
  // 碎石苔垫：0.15m 厚的外扩裙，沿法线下压残余坡差，接缝在陡坡侧也不露
  const padR = 0.76 * s;
  const [gx0, gy0, gz0] = at(0, -(padR * gap + 0.03), 0);
  b.cyl('ash', 0.58 * s, padR, 0.15, 9, gx0, gy0, gz0, shade(0x8b8578, 0.96), 0, rx, rz);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
    const rr = (0.5 + rnd() * 0.24) * s;
    const [wx, wy, wz] = at(Math.cos(a) * rr, -padR * gap + 0.045, Math.sin(a) * rr);
    b.box('ash', 0.14 * s, 0.11 * s, 0.18 * s, wx, wy, wz,
      shade(0x8b8578, 0.82 + rnd() * 0.3), a + rnd(), rx, rz);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.1;
    const [wx, wy, wz] = at(Math.cos(a) * 0.44 * s, -padR * gap + 0.06, Math.sin(a) * 0.44 * s);
    b.box('leaf', 0.24 * s, 0.05 * s, 0.3 * s, wx, wy, wz, shade(0x4c5a44, 0.9 + rnd() * 0.2), a, rx, rz);
  }
  b.kit('flora.snowLotusSkirt', 11, y);
  // 白苞 6 片：微外倾的长苞片，顶端收尖
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.2;
    const lean = 0.1 + rnd() * 0.1;
    const [wx, wy, wz] = at(Math.cos(a) * 0.11 * s, 0.34 * s, Math.sin(a) * 0.11 * s);
    b.cyl('leaf', 0.022 * s, 0.15 * s, (0.44 + rnd() * 0.1) * s, 5, wx, wy, wz,
      shade(0xe8f0ec, 0.94 + rnd() * 0.12), 0, Math.sin(a) * lean + rx, -Math.cos(a) * lean + rz);
  }
  // 内层短苞 3 片：更白，围住花心
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.9;
    const [wx, wy, wz] = at(Math.cos(a) * 0.06 * s, 0.42 * s, Math.sin(a) * 0.06 * s);
    b.cyl('leaf', 0.018 * s, 0.1 * s, 0.26 * s, 5, wx, wy, wz, 0xf6fbf8, 0, rx, rz);
  }
  // 淡青花心 + 蕊
  const [fx, fy, fz] = at(0, 0.5 * s, 0);
  b.cyl('glow', 0.055 * s, 0.085 * s, 0.1 * s, 6, fx, fy, fz, 0xa8dce4);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const [wx, wy, wz] = at(Math.cos(a) * 0.06 * s, 0.58 * s, Math.sin(a) * 0.06 * s);
    b.box('glow', 0.02 * s, 0.09 * s, 0.02 * s, wx, wy, wz, 0xd8f4f8);
  }
  b.kit('flora.snowLotus', 1, y);
  b.kit('flora.snowLotusBract', 9, y + 0.4 * s);
}

// ============ 驿路（WS-33）：C-ITM-0365 驿楼 / C-ITM-0369 望楼 ============

/**
 * 郊野驿站：驿楼（两层夯土平顶＋签票房＋马厩＋旗杆）与望楼（烽燧高台＋垛口＋旗）。
 * 站区落在东郊驿道东侧 52m（infill COUNTRY_ROADS 东段 (5600,−420)→(5790,−980) 路肩外，路向 1.243）。
 * 台基四角与每根柱脚都取 heightAt（调用方传 terrainHeight），坡差由夯土台与柱脚吃掉，不浮空。
 */
export function buildPostStation(
  b: Baker,
  x: number,
  z: number,
  ry: number,
  heightAt: (x: number, z: number) => number,
): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * ca + lz * sa, z - lx * sa + lz * ca];
  const boxAt = (g: BGroup, w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number, dry = 0, rxx = 0, rzz = 0): void => {
    const [px, pz] = at(lx, lz);
    b.box(g, w, h, d, px, ly, pz, hex, ry + dry, rxx, rzz);
  };
  const gAt = (lx: number, lz: number): number => { const [px, pz] = at(lx, lz); return heightAt(px, pz); };

  // ---- 驿楼：夯土台基压到四角最低点，台面取最高点 ----
  let hi = -1e9, lo = 1e9;
  for (const [lx, lz] of [[-12, -8.5], [12, -8.5], [-12, 8.5], [12, 8.5], [0, -8.5], [0, 8.5], [-12, 0], [12, 0]] as const) {
    const g = gAt(lx, lz);
    hi = Math.max(hi, g); lo = Math.min(lo, g);
  }
  const pad = hi + 0.6;
  b.box('earth', 25, pad - lo + 2.4, 18, x, (pad + lo - 2.4) / 2, z, shade(SAND, 0.86), ry);
  // 一层（裙肩加宽收分）＋门洞＋双扇板门（面向驿道 = 局部 −Z）
  boxAt('earth', 17.6, 1.4, 12.1, 0, pad + 0.7, 0, shade(MUD, 1.03));
  boxAt('earth', 17, 4.6, 11.5, 0, pad + 2.3, 0, MUD);
  boxAt('ash', 2.7, 3.3, 0.3, 0, pad + 1.65, -5.72, 0x241f1a);
  for (const s of [-1, 1]) {
    boxAt('wood', 0.28, 3.5, 0.44, s * 1.45, pad + 1.75, -5.72, 0x6a4a2c);
    boxAt('lacquer', 1.24, 2.9, 0.1, s * 0.68, pad + 1.5, -5.8, 0x7a2f22, s * 0.2);
    boxAt('metal', 0.14, 0.14, 0.14, s * 0.26, pad + 1.62, -5.88, 0x4a4e54);
  }
  boxAt('wood', 3.1, 0.26, 0.5, 0, pad + 3.5, -5.72, 0x7a5533);
  // 券窗：窗洞＋木框＋中棂＋外挂苇帘（44 卷 040：驿楼券窗小洞糊 M-15，外挂苇帘 M-16）
  const win = (lx: number, lz: number, ly: number, w: number, h: number, dr: number): void => {
    boxAt('ash', w, h, 0.24, lx, ly, lz, 0x241f1a, dr);
    boxAt('wood', w + 0.3, 0.14, 0.3, lx, ly + h / 2 + 0.07, lz, 0x6a4a2c, dr);
    boxAt('wood', w + 0.3, 0.16, 0.34, lx, ly - h / 2 - 0.08, lz, 0x5a3e22, dr);
    boxAt('wood', 0.1, h, 0.28, lx, ly, lz, 0x5a3e22, dr);
    boxAt('fabric', w, 0.46, 0.1, lx, ly + h / 2 - 0.18, lz, 0xa89268, dr, 0, 0.12);
  };
  for (const s of [-1, 1]) {
    win(s * 5.2, -5.76, pad + 2.4, 1.1, 1.5, 0);
    win(s * 5.2, 5.76, pad + 2.4, 1.1, 1.5, Math.PI);
    win(s * 8.52, 0.4, pad + 2.4, 1.1, 1.5, (s * Math.PI) / 2);
  }
  // 腰檐（平座挑出一圈，把两层分开）＋椽头
  for (const s of [-1, 1]) {
    boxAt('roof', 19.8, 0.28, 1.5, 0, pad + 4.72, s * 6.15, shade(SAND, 0.72));
    boxAt('roof', 1.5, 0.28, 13.4, s * 9.05, pad + 4.72, 0, shade(SAND, 0.72));
    for (let k = 0; k < 9; k++) boxAt('wood', 0.2, 0.2, 0.9, -8.4 + k * 2.1, pad + 4.5, s * 6.05, DARK_WOOD);
    for (let k = 0; k < 6; k++) boxAt('wood', 0.9, 0.2, 0.2, s * 8.95, pad + 4.5, -4.8 + k * 1.92, DARK_WOOD);
  }
  // 二层（收进）＋券窗
  boxAt('earth', 13.6, 3.9, 9.2, 0, pad + 6.85, 0, shade(MUD, 1.06));
  for (const s of [-1, 1]) {
    win(s * 2.6, -4.58, pad + 6.6, 0.95, 1.25, 0);
    win(s * 6.82, -2.2, pad + 6.6, 0.95, 1.25, (s * Math.PI) / 2);
    win(s * 6.82, 2.2, pad + 6.6, 0.95, 1.25, (s * Math.PI) / 2);
  }
  // 平顶：草泥抹面（土掺麦秸）2% 排水坡＋女墙
  boxAt('earth', 14.4, 0.3, 9.9, 0, pad + 8.95, 0, SAND, 0, 0, 0.02);
  for (const s of [-1, 1]) {
    boxAt('earth', 14.4, 0.62, 0.42, 0, pad + 9.4, s * 4.85, shade(SAND, 0.8));
    boxAt('earth', 0.42, 0.62, 9.9, s * 7.0, pad + 9.4, 0, shade(SAND, 0.8));
  }
  // 夜间灯笼（禁霓虹，只留 #FFC66E 暖灯）
  for (const s of [-1, 1]) {
    boxAt('wood', 0.08, 0.52, 0.08, s * 2.6, pad + 4.24, -6.0, DARK_WOOD);
    boxAt('glow', 0.3, 0.44, 0.3, s * 2.6, pad + 3.64, -6.0, 0xffc66e);
    boxAt('metal', 0.34, 0.06, 0.34, s * 2.6, pad + 3.9, -6.0, 0x4a4e54);
  }
  // 签票房柜台（门东侧）＋签筒
  boxAt('wood', 4.6, 1.05, 0.7, -4.4, pad + 0.55, -6.1, 0x6a4a2c);
  boxAt('wood', 4.8, 0.12, 0.9, -4.4, pad + 1.12, -6.1, 0x7a5533);
  for (let k = 0; k < 3; k++) boxAt('ceramic', 0.3, 0.4, 0.3, -5.6 + k * 1.2, pad + 1.38, -6.1, shade(0x955539, 0.95));
  // ---- 马厩：六柱单坡席顶＋草槽＋干草（柱脚逐根落到实地） ----
  for (const lx of [9.6, 13.2, 16.8]) {
    for (const lz of [-4.4, 3.6]) {
      const g = gAt(lx, lz) - 0.8;
      const top = pad + 3.0;
      boxAt('wood', 0.24, top - g, 0.24, lx, (top + g) / 2, lz, DARK_WOOD);
      boxAt('ash', 0.36, 0.18, 0.36, lx, g + 0.09, lz, 0x8d897e);
    }
  }
  for (const lz of [-4.4, 3.6]) boxAt('wood', 8.0, 0.22, 0.22, 13.2, pad + 2.94, lz, DARK_WOOD);
  boxAt('fabric', 8.8, 0.12, 9.6, 13.2, pad + 3.34, -0.4, 0xd4b76a, 0, 0.14);
  for (let k = 0; k < 4; k++) boxAt('wood', 8.9, 0.08, 0.12, 13.2, pad + 3.44, -4.0 + k * 2.4, 0x7a5533, 0, 0.14);
  for (let k = 0; k < 2; k++) {
    boxAt('wood', 4.4, 0.55, 0.9, 12.4, pad + 0.28, -1.6 + k * 3.0, 0x6a4a2c);
    boxAt('water', 4.2, 0.06, 0.7, 12.4, pad + 0.52, -1.6 + k * 3.0, 0x2e5a60);
    boxAt('leaf', 1.6, 0.6, 0.8, 15.8, pad + 0.3, -1.6 + k * 3.0, shade(0xb99a54, 0.94));
  }
  // ---- 旗杆＋胡旗 ----
  const fg = gAt(-11.4, -3.6) - 0.4;
  const [fx, fz] = at(-11.4, -3.6);
  b.cyl('ash', 0.5, 0.62, 0.5, 8, fx, fg + 0.25, fz, shade(STONE, 0.95));
  b.cyl('wood', 0.14, 0.26, 11.4, 7, fx, fg + 5.9, fz, 0x6a4a2c);
  b.pyramid('metal', 0.02, 0.2, fx, fg + 11.8, fz, 0x8a8e96, 0, 1, 0.5, 1);
  b.box('fabric', 0.06, 3.4, 1.15, fx + 0.62, fg + 4.6, fz, 0x9e3a2a);
  for (const t of [-0.5, 0.5]) b.box('fabric', 0.05, 1.5, 0.34, fx + 0.9, fg + 3.4, fz + t * 1.35, shade(0x9e3a2a, 1.15), 0, 0, 0.2);
  // 站前踏跺：逐级取坡面高，从台面下到驿道
  const sFoot = gAt(0, -13.5);
  for (let k = 0; k < 4; k++) {
    const ly = pad - (k + 1) * ((pad - sFoot) / 5);
    boxAt('ground', 4.8, 0.34, 0.92, 0, ly - 0.12, -9.3 - k * 0.9, shade(SAND, 0.82));
  }
  // 拴马桩三＋草垛
  for (let k = 0; k < 3; k++) {
    const lx = -6.5 + k * 2.2;
    boxAt('ash', 0.3, 1.15, 0.3, lx, pad + 0.58, -7.4, shade(STONE, 1.02));
    boxAt('metal', 0.42, 0.08, 0.12, lx, pad + 1.0, -7.4, 0x4a4e54);
  }
  boxAt('leaf', 2.2, 1.3, 1.8, 9.4, pad + 0.65, 6.2, shade(0xb99a54, 0.9));
  b.kit('post.relayTower', 1, pad);

  // ---- 望楼：夯土高台（收分）＋台顶垛口＋烽盆＋旗＋木登梯 ----
  const WLX = -27, WLZ = -14;
  let whi = -1e9, wlo = 1e9;
  for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6], [0, 0]] as const) {
    const g = gAt(WLX + dx, WLZ + dz);
    whi = Math.max(whi, g); wlo = Math.min(wlo, g);
  }
  const wpad = whi + 0.4;
  const [wx, wz] = at(WLX, WLZ);
  b.box('earth', 8.4, wpad - wlo + 1.8, 8.4, wx, (wpad + wlo - 1.8) / 2, wz, shade(SAND, 0.9), ry);
  b.pyramid('earth', 4.05, 5.15, wx, wpad + 3.5, wz, MUD, ry, 1, 7.0, 1);
  boxAt('earth', 6.4, 0.36, 6.4, WLX, wpad + 7.18, WLZ, shade(SAND, 0.94));
  // 垛口十二（每边三，段间即垛口）
  const merlon = (lx: number, lz: number, alongX: boolean): void => {
    boxAt('earth', alongX ? 1.35 : 0.44, 0.92, alongX ? 0.44 : 1.35, WLX + lx, wpad + 7.82, WLZ + lz, shade(MUD, 0.92));
  };
  for (const k of [-1.8, 0, 1.8]) {
    merlon(k, -2.8, true); merlon(k, 2.8, true);
    merlon(-2.8, k, false); merlon(2.8, k, false);
  }
  // 烽盆（明火 #FFC66E）＋铁承台＋三足
  boxAt('metal', 1.0, 0.12, 1.0, WLX, wpad + 7.42, WLZ, 0x4a4e54);
  b.cyl('metal', 0.62, 0.74, 0.62, 12, wx, wpad + 7.78, wz, 0x4a4e54);
  b.cyl('glow', 0.4, 0.5, 0.32, 10, wx, wpad + 8.06, wz, 0xffc66e);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    b.cyl('metal', 0.07, 0.1, 0.42, 5, wx + Math.cos(a) * 0.42, wpad + 7.46, wz + Math.sin(a) * 0.42, 0x44484f);
  }
  // 望楼旗
  const [pfx, pfz] = at(WLX + 2.2, WLZ + 2.2);
  b.cyl('wood', 0.1, 0.16, 6.4, 6, pfx, wpad + 10.5, pfz, 0x6a4a2c);
  b.pyramid('metal', 0.02, 0.13, pfx, wpad + 13.74, pfz, 0x8a8e96, 0, 1, 0.4, 1);
  b.box('fabric', 0.05, 2.2, 0.95, pfx + 0.5, wpad + 12.2, pfz, 0x9e3a2a);
  // 木登梯：踏棍逐级取坡面，梯脚落在望楼西侧实地
  const [lgx, lgz] = at(WLX - 5.2, WLZ - 1.2);
  const gFoot = heightAt(lgx, lgz);
  for (let k = 0; k < 9; k++) {
    const t = (k + 0.5) / 9;
    const [rx2, rz2] = at(WLX - 5.2 + t * 1.7, WLZ - 1.2);
    b.box('wood', 0.95, 0.09, 0.3, rx2, gFoot + 0.3 + t * (wpad + 7.3 - gFoot - 0.3), rz2, shade(DARK_WOOD, 1.15));
  }
  for (const s of [-1, 1]) {
    const [rx2, rz2] = at(WLX - 5.2 + 0.85, WLZ - 1.2 + s * 0.52);
    b.box('wood', 0.1, 8.2, 0.1, rx2, (gFoot + wpad + 7.3) / 2, rz2, DARK_WOOD, 0, 0.2);
  }
  // 望楼门洞（西侧，对着站区）
  boxAt('ash', 0.3, 2.1, 1.4, WLX - 3.62, wpad + 1.05, WLZ, 0x241f1a);
  boxAt('wood', 0.4, 0.22, 1.7, WLX - 3.66, wpad + 2.2, WLZ, 0x6a4a2c);
  b.kit('post.watchTower', 1, wpad);
}
