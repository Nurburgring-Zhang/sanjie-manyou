import * as THREE from 'three';
import { Baker, shade } from '../city/bake';
import { RNG } from '../core/rng';
// 只为类型（`import type` 编译期擦除，不构成 terrain → flora 的运行时环）
import type { Mountain } from '../world/terrain';

/** 山上五色花丛（与 terrain.ts 顶点色 FLOWER_COLORS 同序：两处一个是地形色斑、一个是实体花丛） */
const FLOWER_COLORS = [0xff5478, 0xffb300, 0x9a6bff, 0xff6ad5, 0xff7a3c, 0xffe14d];

// ============ B10 植物精化：仙植 14 选 6 / 鬼植 10 选 6（10/30 卷 T-PLT/D-PLT 表） ============
// 静态烘焙散布（glow/wood/trunk/leaf 组，零新增材质）；彼岸花/忘忧曼陀罗/醉霞石榴已有

/** 坐标 hash → 局部 LCG：新增细节只从坐标取随机，不消耗共享 rng（否则下游落点会整体漂移） */
function plantRnd(x: number, z: number, salt: number): () => number {
  let s = (Math.imul((Math.round(x * 97) ^ Math.round(z * 131) ^ salt) >>> 0, 2654435761) >>> 0) || 1;
  return (): number => ((s = (Math.imul(s ^ (s >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
}

/** 倾倒位移：与 Baker.push 的欧拉序（R = Ry·Rx·Rz）一致，把 +Y 按方位 a、俯仰 p 倾出 len */
function tipOf(a: number, pitch: number, len: number): [number, number, number] {
  const ca = Math.cos(a) * pitch, sa = Math.sin(a) * pitch, cz = Math.cos(ca);
  return [Math.sin(ca) * len, cz * Math.cos(sa) * len, cz * Math.sin(sa) * len];
}

/** 外张叶/瓣的盒片中心：ry=-(a+π/2) 让片宽落在切向，rx=-p 让叶尖沿方位 a 外倾 */
function bladeOff(a: number, pitch: number, len: number): [number, number, number] {
  const s = Math.sin(pitch) * len * 0.5, c = Math.cos(pitch) * len * 0.5;
  return [Math.cos(a) * s, c, Math.sin(a) * s];
}

/** 鬼植六类（30 卷 D-PLT：黄泉芦/尸香魔芋/鬼灯笼果/引魂木/白骨苔/夜哭竹） */
export function buildGhostFlora(b: Baker, rng: RNG): void {
  const y = -260;
  // 黄泉芦 12 片（忘川两岸：秆青灰穗白，芦花=鬼火种子）
  // 旧版一竿=一根圆柱+一个发光方块；改为三段带俯仰的秆 + 两段渐细白穗 + 一粒鬼火
  for (let i = 0; i < 12; i++) {
    const bx = rng.range(-380, 380), bz = y === -260 ? (rng.chance(0.5) ? rng.range(-90, -84) : rng.range(-36, -30)) : -60;
    for (let k = 0; k < 7; k++) {
      const rx = bx + rng.range(-1.6, 1.6), rz = bz + rng.range(-1.2, 1.2);
      const roll = rng.range(-0.08, 0.08);
      const prnd = plantRnd(rx, rz, 0x71);
      const hh = 1.9 + prnd() * 0.7;
      const a = 0.4 + k * 0.9;
      let cx = rx, cy = y, cz = rz;
      for (let n = 0; n < 3; n++) {
        const len = hh / 3;
        const p = roll + n * 0.06;
        const [dx, dy, dz] = tipOf(a, p, len);
        b.cyl('wood', 0.024, 0.04 - n * 0.006, len, 4, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
          shade(0x6a7a72, 0.9 + n * 0.07), 0, Math.sin(a) * p, -Math.cos(a) * p, true);
        cx += dx; cy += dy; cz += dz;
      }
      // 芦花：两段上细下粗的白穗 + 一粒鬼火种（点状 glow）
      b.box('leaf', 0.13, 0.36, 0.05, cx, cy + 0.16, cz, 0xd8d8cc, -(a + Math.PI / 2), -0.18, 0);
      b.box('leaf', 0.07, 0.3, 0.035, cx + Math.sin(a) * 0.12, cy + 0.44, cz - Math.cos(a) * 0.12,
        0xe4e4d8, -(a + Math.PI / 2), -0.26, 0);
      b.sphere('glow', 0.035, 4, cx + Math.sin(a) * 0.2, cy + 0.6, cz - Math.cos(a) * 0.2, 0xd8d8cc);
    }
  }
  // 尸香魔芋 7 株（荒野骨林：佛焰苞暗紫近黑 #2B1B3D 上限）
  // 旧版是一根开口锥扣在花葶上；改为六片暗紫大瓣围杯 + 肉穗 + 基生三叶
  for (let i = 0; i < 7; i++) {
    const ax = rng.range(-440, 460), az = rng.range(-350, 260);
    if (Math.hypot(ax, az - 40) < 160) continue; // 避开主城区带
    const prnd = plantRnd(ax, az, 0x81);
    b.cyl('wood', 0.13, 0.2, 0.8, 5, ax, y + 0.4, az, 0x3a2c34);
    b.cyl('wood', 0.1, 0.13, 0.7, 5, ax, y + 1.12, az, shade(0x3a2c34, 1.16));
    for (let k = 0; k < 6; k++) {
      const pa = (k / 6) * Math.PI * 2 + prnd() * 0.4;
      const pp = 0.34 + prnd() * 0.24;
      const len = 1.2 + prnd() * 0.3;
      const [ox, oy, oz] = bladeOff(pa, pp, len);
      b.box('leaf', 0.62, len, 0.07, ax + Math.cos(pa) * 0.12 + ox, y + 1.42 + oy, az + Math.sin(pa) * 0.12 + oz,
        k % 2 ? 0x2b1b3d : 0x37224a, -(pa + Math.PI / 2), -pp, 0);
    }
    b.cyl('wood', 0.075, 0.12, 1.5, 6, ax, y + 2.0, az, 0x5a3c50);
    b.sphere('glow', 0.09, 4, ax, y + 2.78, az, 0xb06a86);
    for (let k = 0; k < 3; k++) {
      const pa = k * 2.1 + 0.5;
      const [ox, oy, oz] = bladeOff(pa, 0.62, 0.85);
      b.box('leaf', 0.36, 0.85, 0.05, ax + ox, y + 0.32 + oy, az + oz, 0x3c2a44, -(pa + Math.PI / 2), -0.62, 0);
    }
  }
  // 鬼灯笼果 28 丛（丰都巷口：苞衣橙红半透+绿光核）
  // 旧版是两根茎 + 一个发光方块；改为两段带俯仰的茎 + 四片苞衣 + 球果（蓝绿核只留点状 glow）
  for (let i = 0; i < 28; i++) {
    const gx = rng.range(180, 420), gz = rng.range(60, 260);
    const prnd = plantRnd(gx, gz, 0x91);
    const a0 = prnd() * Math.PI * 2;
    let cx = gx, cy = y, cz = gz;
    for (let n = 0; n < 2; n++) {
      const len = 0.66;
      const p = 0.06 + n * 0.1;
      const [dx, dy, dz] = tipOf(a0, p, len);
      b.cyl('wood', 0.045 - n * 0.01, 0.07 - n * 0.015, len, 4, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
        shade(0x4a3c33, 0.94 + n * 0.1), 0, Math.sin(a0) * p, -Math.cos(a0) * p, true);
      cx += dx; cy += dy; cz += dz;
    }
    const lanternC = shade(0xff7a2d, 0.92 + prnd() * 0.16);
    for (let k = 0; k < 4; k++) {
      const pa = a0 + (k / 4) * Math.PI * 2 + prnd() * 0.3;
      const [ox, oy, oz] = bladeOff(pa, 1.15, 0.42);
      b.box('leaf', 0.14, 0.42, 0.03, cx + ox, cy + 0.12 + oy, cz + oz, shade(lanternC, 0.86), -(pa + Math.PI / 2), -1.15, 0);
    }
    b.sphere('leaf', 0.14, 5, cx, cy + 0.2, cz, lanternC, 0, 0, 0, 1, 1.18, 1);
    b.sphere('glow', 0.045, 4, cx, cy + 0.2, cz, 0x3dff9c);
  }
  // 引魂木 3 株（黄泉路岔口：灰白枯树白絮如幡）
  // 旧版一株=一根圆柱+四条发光片；改为分段枯干 + 四根带俯仰枯枝 + 白絮（叶片）+ 一点冷光
  for (const [tx, tz] of [[300, 40], [260, 8], [340, 40]] as const) {
    const prnd = plantRnd(tx, tz, 0xa1);
    let cx = tx, cy = y, cz = tz;
    for (let n = 0; n < 3; n++) {
      const len = 2.7;
      const p = 0.02 + n * 0.03;
      const a = 0.7 + n * 1.3;
      const [dx, dy, dz] = tipOf(a, p, len);
      b.cyl('wood', 0.24 - n * 0.05, 0.34 - n * 0.06, len, 5, cx + dx * 0.5, cy + dy * 0.5, cz + dz * 0.5,
        shade(0xc8c4b8, 0.9 + n * 0.06), 0, Math.sin(a) * p, -Math.cos(a) * p);
      cx += dx; cy += dy; cz += dz;
    }
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + prnd() * 0.5;
      const p = 0.75 + prnd() * 0.4;
      const len = 1.5 + prnd() * 0.8;
      const by0 = y + 4.6 + k * 0.5;
      const [dx, dy, dz] = tipOf(a, p, len);
      b.cyl('wood', 0.045, 0.1, len, 4, tx + Math.cos(a) * 0.2 + dx * 0.5, by0 + dy * 0.5, tz + Math.sin(a) * 0.2 + dz * 0.5,
        shade(0xc8c4b8, 1.0), 0, Math.sin(a) * p, -Math.cos(a) * p, true);
      // 白絮如幡：从枯枝梢头垂下的一幅窄幡（贴切"引魂"意象）
      b.box('leaf', 0.24, 1.25, 0.025, tx + Math.cos(a) * 0.2 + dx, by0 + dy - 0.66, tz + Math.sin(a) * 0.2 + dz,
        0xd8d8cc, -(a + Math.PI / 2), 0.07, 0);
      b.sphere('glow', 0.03, 4, tx + Math.cos(a) * 0.2 + dx, by0 + dy, tz + Math.sin(a) * 0.2 + dz, 0xd8d8cc);
    }
  }
  // 白骨苔 8 毯（荒野/枉死城外：踩踏亮绿足印的静态毯）
  for (let i = 0; i < 8; i++) {
    const mx = rng.range(-300, 300), mz = rng.range(-330, -260);
    b.box('glow', rng.range(3, 7), 0.06, rng.range(2, 5), mx, y + 0.04, mz, shade(0xd8d4c8, 0.9), rng.range(0, 3));
  }
  // 夜哭竹 36 竿（孟婆庄后：墨绿节痕如泪滴）
  // 旧版是 4m 高的单根深色圆柱 + 一粒光点，俯视读作一片枯杆；改为分节竹竿 + 竹节环 + 梢部竹叶
  for (let i = 0; i < 36; i++) {
    const px = -48 + rng.range(-8, 8), pz = -140 + rng.range(-10, 4);
    const h = rng.range(3.2, 5.6);
    const lean = rng.range(-0.09, 0.09);
    const segs = 3;
    let cy = y;
    let cx = px;
    for (let sg = 0; sg < segs; sg++) {
      const sh = h / segs;
      b.cyl('wood', 0.055 - sg * 0.008, 0.07 - sg * 0.008, sh, 5, cx, cy + sh / 2, pz, 0x2c4a34, 0, 0, lean);
      b.cyl('wood', 0.085 - sg * 0.01, 0.085 - sg * 0.01, 0.055, 6, cx, cy + sh, pz, 0x466a4c, 0, 0, 0);
      b.kit('flora.bambooNode', 1, cy + sh);
      cy += sh * 0.985;
      cx += Math.sin(lean) * sh;
    }
    // 梢部竹叶：四向斜展的窄叶
    for (let lf = 0; lf < 5; lf++) {
      const a = (lf / 5) * Math.PI * 2 + i * 0.7;
      b.box('leaf', 0.07, 0.42, 0.22, cx + Math.cos(a) * 0.24, cy - 0.2 + lf * 0.06, pz + Math.sin(a) * 0.24, 0x3e6e48, a, 0.55, 0.2);
    }
    b.kit('flora.bambooLeaf', 5, cy);
    // 泪痕：一处竹节下的冷白滴点
    b.box('glow', 0.035, 0.12, 0.035, cx, y + rng.range(1.0, h - 0.6), pz + 0.08, 0x9ab8a8);
    b.kit('flora.nightBamboo', 1, y + h / 2);
  }
  // 血珊瑚 D-PLT-007：血池浅滩与血池岸（池心 (-1400, 300)、外沿 R150；浅滩 R<130 立在水里）
  // 落点用就地 LCG，不借共享 rng——否则下游仙植的位置会整体漂移
  const POOL_X = -1400, POOL_Z = 300;
  let cs = (Math.imul(Math.round(POOL_X * 3 + POOL_Z * 7) ^ 0x9e3779b9, 2654435761) >>> 0) || 53;
  const crand = (): number => ((cs = (Math.imul(cs ^ (cs >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + (crand() - 0.5) * 0.14;
    const inPool = i % 3 !== 0;
    const rr = inPool ? 102 + crand() * 26 : 152 + crand() * 16;
    const cxx = POOL_X + Math.cos(a) * rr, czz = POOL_Z + Math.sin(a) * rr;
    if (Math.hypot(cxx + 1500, czz - 180) < 10) continue; // 让开幽冥路牌
    bloodCoral(b, cxx, czz, 0.8 + crand() * 0.9, inPool ? y + 0.6 : y);
  }
  // 祭台骨缘 D-PLT-008：三生石祭场石台外缘 R10.4 一环（错开四角幡杆 R9.6）
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + Math.PI / 24;
    altarBoneEdge(b, 24 + Math.cos(a) * 10.4, -108 + Math.sin(a) * 10.4, 0.85 + crand() * 0.3, a, y + 0.12);
  }
}

/** 仙植六类（10 卷 T-PLT：瑶草/九叶灵芝/垂云竹/星辉花/含露昙花/五色虹藤） */
export function buildCelestialFlora(b: Baker, rng: RNG): void {
  // 瑶草 60 丛采样（蟠桃园：叶尖垂露夜发光）
  // 旧版一丛=一根 0.24 高锥 + 一个发光点；改为 3~5 片外张窄叶 + 叶尖垂露
  for (let i = 0; i < 60; i++) {
    const a = rng.range(0, 6.28), r = rng.range(8, 32);
    const gx = -150 + Math.cos(a) * r, gz = 40 + Math.sin(a) * r;
    const prnd = plantRnd(gx, gz, 0xb1);
    const a0 = prnd() * 6.28;
    const nl = 3 + Math.floor(prnd() * 3);
    for (let k = 0; k < nl; k++) {
      const pa = a0 + (k / nl) * Math.PI * 2 + prnd() * 0.3;
      const p = 0.52 + prnd() * 0.3;
      const len = 0.3 + prnd() * 0.16;
      const [ox, oy, oz] = bladeOff(pa, p, len);
      b.box('leaf', 0.1, len, 0.022, gx + ox, 202.05 + oy, gz + oz,
        shade(0x4a7a44, 1.15 + k * 0.07), -(pa + Math.PI / 2), -p, 0);
    }
    const [dx, dy, dz] = bladeOff(a0 + 0.4, 0.85, 0.46);
    b.sphere('glow', 0.028, 4, gx + dx, 202.05 + dy, gz + dz, 0xdfffe8);
  }
  // 九叶灵芝 36 株（兜率药圃：九叶轮生赤紫云纹）
  // 旧版一根 0.3 圆柱 + 一块发光板；改为两段茎 + 扁球菌盖 + 九片轮生叶 + 盖心一点光
  for (let i = 0; i < 36; i++) {
    const gx = -120 + rng.range(-9, 9), gz = -20 + rng.range(-7, 7);
    const prnd = plantRnd(gx, gz, 0xc1);
    const a0 = prnd() * 6.28;
    let lx = gx, ly = 208.05, lz = gz;
    for (let n = 0; n < 2; n++) {
      const p = 0.05 + n * 0.07;
      const [dx, dy, dz] = tipOf(a0, p, 0.16);
      b.cyl('wood', 0.032 - n * 0.008, 0.06 - n * 0.012, 0.16, 5, lx + dx * 0.5, ly + dy * 0.5, lz + dz * 0.5,
        shade(0x8a4a5e, 0.94 + n * 0.08), 0, Math.sin(a0) * p, -Math.cos(a0) * p, true);
      lx += dx; ly += dy; lz += dz;
    }
    b.sphere('leaf', 0.2, 7, lx, ly + 0.02, lz, 0x8a4a5e, 0, 0, 0, 1, 0.32, 1);
    for (let k = 0; k < 9; k++) {
      const pa = a0 + (k / 9) * Math.PI * 2;
      const p = 0.34 + (k % 3) * 0.05;
      const rr2 = 0.16 + Math.sin(p) * 0.17;
      b.box('leaf', 0.1, 0.34, 0.03, lx + Math.cos(pa) * rr2, ly + Math.cos(p) * 0.17, lz + Math.sin(pa) * rr2,
        shade(0xa85a72, 0.92 + (k % 3) * 0.07), -(pa + Math.PI / 2), -p, 0);
    }
    b.sphere('glow', 0.035, 4, lx, ly + 0.09, lz, 0xf0b0c0);
  }
  // 垂云竹 40 竿（蟠桃园南缘：梢部下垂如云堕）
  // 旧版一竿=一根 8m 四棱柱 + 一片斜叶；改为 9 节分段（每 0.8m，节环微粗）+ 每竿 6~8 片窄叶 + 梢部逐节下弯
  for (let i = 0; i < 40; i++) {
    const gx = -150 + rng.range(-30, 30), gz = 40 + rng.range(28, 34);
    const lean = rng.range(-0.1, 0.1);
    const sway = rng.range(-0.4, 0.4);
    const prnd = plantRnd(gx, gz, 0xd1);
    const h = 7.0 + prnd() * 1.6;
    const nseg = 9;
    const a0 = prnd() * 6.28;
    const path: [number, number, number][] = [];
    let lx = gx, ly = 202, lz = gz, lr = 0.085;
    for (let n = 0; n < nseg; n++) {
      const len = (h / nseg) * 1.05;
      const p = lean * 0.6 + n * 0.012 + (n > 5 ? (n - 5) * 0.055 : 0) + sway * 0.05;
      const [dx, dy, dz] = tipOf(a0, p, len);
      const rr = 0.085 * (1 - n * 0.05);
      b.cyl('leaf', rr, lr, len, 5, lx + dx * 0.5, ly + dy * 0.5, lz + dz * 0.5,
        shade(0x4a7a44, 1.1 + n * 0.014), 0, Math.sin(a0) * p, -Math.cos(a0) * p, true);
      b.cyl('leaf', rr * 1.24, rr * 1.24, 0.055, 6, lx + dx, ly + dy, lz + dz,
        shade(0x4a7a44, 1.34), 0, Math.sin(a0) * p, -Math.cos(a0) * p, true);
      lx += dx; ly += dy; lz += dz; lr = rr;
      path.push([lx, ly, lz]);
    }
    const nl = 6 + (sway > 0 ? 2 : 0);
    for (let k = 0; k < nl; k++) {
      const idx = Math.min(nseg - 1, 4 + Math.floor((k / nl) * (nseg - 4)));
      const [px2, py2, pz2] = path[idx];
      const pa = a0 + k * 0.9 + prnd() * 0.25;
      const droop = k % 3 === 2;
      const p = droop ? 1.52 + prnd() * 0.34 : 0.62 + prnd() * 0.22;
      const len = 0.5 + prnd() * 0.22;
      const [ox, oy, oz] = bladeOff(pa, p, len);
      b.box('leaf', 0.08, len, 0.02, px2 + ox, py2 + oy, pz2 + oz,
        shade(0x4a7a44, 1.12 + (k % 3) * 0.06), -(pa + Math.PI / 2), -p, 0);
    }
  }
  // 星辉花 50 朵（天河正下方浮云带：五瓣星形银蓝与天河同频）
  // 旧版一个方块；改为五片径向盒片围成星 + 星心一点光
  for (let i = 0; i < 50; i++) {
    const gx = rng.range(-500, 500), gz = rng.range(-120, 200);
    const gy = rng.range(236, 244);
    const prnd = plantRnd(gx, gz, 0xe1);
    const a0 = prnd() * 6.28;
    for (let k = 0; k < 5; k++) {
      const pa = a0 + (k / 5) * Math.PI * 2;
      b.box('leaf', 0.3, 0.03, 0.11, gx + Math.cos(pa) * 0.15, gy + (k % 2) * 0.035, gz + Math.sin(pa) * 0.15,
        shade(0xa8c8ff, 0.9 + k * 0.04), -pa);
    }
    b.sphere('glow', 0.05, 4, gx, gy + 0.02, gz, 0xe8f0ff);
    if (i % 3 === 0) b.sphere('glow', 0.026, 4, gx, gy + 0.14, gz, 0xfff0c8);
  }
  // 含露昙花 3 株（莲台法会区：素白透金，三千年一开）
  // 旧版一根柱 + 两个发光方块；改为外八瓣素白 + 内六瓣透金 + 花托 + 一点金心
  for (const [ex, ez] of [[54, -6], [60, -14], [48, -18]] as const) {
    const prnd = plantRnd(ex, ez, 0xf1);
    b.cyl('leaf', 0.09, 0.14, 2.0, 5, ex, 211, ez, 0x6a8a6a);
    for (let k = 0; k < 8; k++) {
      const pa = (k / 8) * Math.PI * 2 + prnd() * 0.2;
      const p = 0.85 + prnd() * 0.2;
      const len = 0.62;
      const [ox, oy, oz] = bladeOff(pa, p, len);
      b.box('leaf', 0.2, len, 0.04, ex + ox, 212.02 + oy, ez + oz, 0xfffdf5, -(pa + Math.PI / 2), -p, 0);
    }
    for (let k = 0; k < 6; k++) {
      const pa = (k / 6) * Math.PI * 2 + 0.5;
      const p = 0.5 + prnd() * 0.15;
      const len = 0.4;
      const [ox, oy, oz] = bladeOff(pa, p, len);
      b.box('leaf', 0.14, len, 0.035, ex + ox, 212.08 + oy, ez + oz, 0xfff0c2, -(pa + Math.PI / 2), -p, 0);
    }
    b.cyl('leaf', 0.06, 0.05, 0.12, 6, ex, 212.04, ez, 0xe8d8a0);
    b.sphere('glow', 0.07, 4, ex, 212.2, ez, 0xffd700);
  }
  // 五色虹藤 8 架（彩虹弧两端桥头+蟠桃园篱）
  // 旧版一根柱 + 四块彩色发光片；改为五段藤蔓 + 每节一叶 + 五色花（小球）
  for (let i = 0; i < 8; i++) {
    const vx = (i < 4 ? -4 + i * 2.6 : -160 + (i - 4) * 6), vz = (i < 4 ? -100 + (i % 2) * 3 : 70);
    const vy = i < 4 ? 208 : 202.5;
    const prnd = plantRnd(vx, vz, 0x101);
    const a0 = prnd() * 6.28;
    let lx = vx, ly = vy, lz = vz;
    for (let n = 0; n < 5; n++) {
      const p = 0.1 + n * 0.05;
      const aa = a0 + n * 0.4;
      const [dx, dy, dz] = tipOf(aa, p, 0.52);
      b.cyl('wood', 0.032 - n * 0.004, 0.05 - n * 0.005, 0.52, 4, lx + dx * 0.5, ly + dy * 0.5, lz + dz * 0.5,
        shade(0x6a8a5a, 0.94 + n * 0.04), 0, Math.sin(aa) * p, -Math.cos(aa) * p, true);
      lx += dx; ly += dy; lz += dz;
      const pa = a0 + n * 1.7;
      const [ox, oy, oz] = bladeOff(pa, 0.9, 0.3);
      b.box('leaf', 0.14, 0.3, 0.03, lx + ox, ly + oy, lz + oz,
        shade(0x4a7a44, 1.14), -(pa + Math.PI / 2), -0.9, 0);
    }
    for (let k = 0; k < 5; k++) {
      b.sphere('leaf', 0.075, 4, lx + Math.cos(a0 + k * 1.3) * 0.22, ly - 0.15 - k * 0.42, lz + Math.sin(a0 + k * 1.3) * 0.22,
        [0xff6a7a, 0xffb300, 0x3dff9c, 0x4d7cff, 0xe8a6bc][k], 0, 0, 0, 1, 0.8, 1);
    }
  }
}

/**
 * 血珊瑚 D-PLT-007：竖枝珊瑚，暗红半透、枝杈如指爪（血池浅滩与血池岸）
 * 三层分枝：血泥根 → 3~5 主枝 → 每枝两叉细梢；梢端偶结暗红光珠（液流）
 */
export function bloodCoral(b: Baker, x: number, z: number, s: number, y = -260): void {
  let seed = (Math.imul(Math.round(x * 41 + z * 13) ^ 0x85ebca6b, 2246822519) >>> 0) || 23;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const baseC = 0x5a1414;
  const tipC = 0x9a2a32;
  // 根部血泥堆：让珊瑚从池底"长"出来而不是浮在水面
  b.cyl('leaf', 0.3 * s, 0.52 * s, 0.24 * s, 7, x, y + 0.1 * s, z, shade(0x3a0e12, 1.0));
  const stems = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + rnd() * 0.5;
    const lean = 0.12 + rnd() * 0.22;
    const h1 = (0.6 + rnd() * 0.6) * s;
    const out1 = 0.16 * s + Math.sin(lean) * h1;
    b.cyl('leaf', 0.1 * s, 0.17 * s, h1, 6, x + Math.cos(a) * 0.16 * s, y + Math.cos(lean) * h1 * 0.5, z + Math.sin(a) * 0.16 * s,
      shade(baseC, 0.9 + rnd() * 0.2), 0, Math.sin(a) * lean, -Math.cos(a) * lean);
    const tx = x + Math.cos(a) * out1, ty = y + Math.cos(lean) * h1, tz = z + Math.sin(a) * out1;
    for (let k = 0; k < 2; k++) {
      const a2 = a + (k ? 1 : -1) * (0.45 + rnd() * 0.4);
      const lean2 = 0.3 + rnd() * 0.3;
      const h2 = (0.36 + rnd() * 0.36) * s;
      b.cyl('leaf', 0.05 * s, 0.1 * s, h2, 5, tx, ty + h2 * 0.42, tz, shade(baseC, 1.12 + rnd() * 0.16),
        0, Math.sin(a2) * lean2, -Math.cos(a2) * lean2);
      if (rnd() > 0.45) {
        b.cyl('leaf', 0.028 * s, 0.052 * s, 0.28 * s, 4, tx + Math.cos(a2) * 0.14 * s, ty + h2 + 0.1 * s, tz + Math.sin(a2) * 0.14 * s,
          shade(tipC, 0.95 + rnd() * 0.2), 0, Math.sin(a2) * 0.5, -Math.cos(a2) * 0.5);
      }
    }
    // 液流：少量梢端光珠，血池暗到只剩这一点红
    if (rnd() > 0.55) b.box('glow', 0.09 * s, 0.09 * s, 0.09 * s, tx, ty + 0.46 * s, tz, 0x8a1a24);
  }
  b.kit('flora.bloodCoral', 1, y);
  b.kit('flora.bloodCoralBranch', stems * 3, y + 0.5 * s);
}

/**
 * 祭台骨缘 D-PLT-008：祭台外缘的白骨环（碎骨横铺 + 颅骨 + 立骨桩 + 骨隙白骨苔）
 * 单簇落位由调用方沿环均分；ry 只用于簇内朝向，不改变环位
 */
export function altarBoneEdge(b: Baker, x: number, z: number, s: number, ry: number, y = -260): void {
  let seed = (Math.imul(Math.round(x * 29 + z * 43) ^ 0x1b873593, 2654435761) >>> 0) || 29;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 374761393) >>> 0) / 4294967296);
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + sn * dz, z - sn * dx + c * dz];
  const boneC = 0xd8d0bc;
  // 横铺碎骨：绕簇心散落，长短不一，压住台沿
  const bones = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < bones; i++) {
    const [bx, bz] = at((rnd() - 0.5) * 1.0 * s, (rnd() - 0.5) * 0.7 * s);
    const r0 = (0.045 + rnd() * 0.03) * s;
    b.cyl('ash', r0, r0 * 1.25, (0.45 + rnd() * 0.55) * s, 5, bx, y + r0 * 1.25, bz,
      shade(boneC, 0.86 + rnd() * 0.26), ry + rnd() * 3.14, 0, Math.PI / 2);
  }
  // 颅骨：颅腔 + 颌 + 两眼窝（眼窝用 trunk 深色，暗部才读得出是头骨）
  const [sx2, sz2] = at((rnd() - 0.5) * 0.5 * s, (rnd() - 0.5) * 0.4 * s);
  const skullC = shade(boneC, 0.96 + rnd() * 0.12);
  b.cyl('ash', 0.15 * s, 0.19 * s, 0.26 * s, 6, sx2, y + 0.13 * s, sz2, skullC);
  b.box('ash', 0.24 * s, 0.11 * s, 0.2 * s, sx2, y + 0.055 * s, sz2, shade(skullC, 0.92), ry);
  for (const e of [-1, 1]) {
    const [ex, ez] = at(e * 0.06 * s, 0.17 * s);
    b.box('trunk', 0.055 * s, 0.05 * s, 0.03 * s, ex, y + 0.16 * s, ez, 0x16100e, ry);
  }
  // 立骨桩：约半数簇一根，竖插在骨堆里
  if (rnd() > 0.5) {
    const [px2, pz2] = at((rnd() - 0.5) * 0.6 * s, (rnd() - 0.5) * 0.5 * s);
    b.cyl('ash', 0.04 * s, 0.055 * s, 0.46 * s, 5, px2, y + 0.23 * s, pz2, shade(boneC, 1.02), 0, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2);
  }
  // 骨隙白骨苔：骨白里透一点冷绿，别让整簇是死白
  if (rnd() > 0.35) {
    const [mx, mz] = at((rnd() - 0.5) * 0.9 * s, (rnd() - 0.5) * 0.7 * s);
    b.box('leaf', 0.3 * s, 0.04 * s, 0.22 * s, mx, y + 0.02 * s, mz, 0xa8b49a, ry + rnd());
  }
  b.kit('flora.altarBoneEdge', 1, y);
  b.kit('flora.altarBone', bones + 1, y);
}
// ============ 风动仙植 / 鬼植（自建网格 + 顶点级风摆 + 明暗脉动） ============
// 为什么另起一套网格：Baker 是静态合批，顶点色烘完后写死，做不出风。
// 这里把「仙植（蟠桃园灵芝/瑶草、瑶池莲花）」与「鬼植（彼岸花、枯木、幽冥藤）」各自烘进
// 一张自建 BufferGeometry，逐顶点带 aSway（按高度归一）与 aPhase（每株相位），
// 由 onBeforeCompile 注入两条极轻的正弦位移 + 一条亮度脉动：
//   · 位移 ≤ 0.10m —— 只求「活着」，不做出台风；
//   · 亮度 ±7% —— 叶片在风里翻面时的高光变化，成本为零。
// 全部植物共用一份材质 → 新增 1 个 draw call；uTime 由 onBeforeRender 自走时，
// 不依赖 engine / world（这两个文件本轮不归我改）。

const _fbM = new THREE.Matrix4(), _fbQ = new THREE.Quaternion(), _fbE = new THREE.Euler();
const _fbV = new THREE.Vector3(), _fbS = new THREE.Vector3(), _fbC = new THREE.Color();

/** 风动批：位置/法线/顶点色 + aSway/aPhase 两条风属性 */
class WindBatch {
  private p: number[] = [];
  private n: number[] = [];
  private c: number[] = [];
  private ph: number[] = [];
  private sw: number[] = [];
  private base = 0;
  private top = 1;
  private phase = 0;
  tris = 0;

  /** 设定当前这一株的基准高、梢高与相位（后续所有构件按高度归一取摆动权重） */
  plant(base: number, top: number, phase: number): void {
    this.base = base;
    this.top = Math.max(base + 0.06, top);
    this.phase = phase;
  }

  private add(geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, ry: number, rx: number, rz: number, sx = 1, sy = 1, sz = 1): void {
    const src = geo.index ? geo.toNonIndexed() : geo;
    if (src !== geo) geo.dispose();
    _fbE.set(rx, ry, rz);
    _fbQ.setFromEuler(_fbE);
    _fbV.set(x, y, z);
    _fbS.set(sx, sy, sz);
    _fbM.compose(_fbV, _fbQ, _fbS);
    src.applyMatrix4(_fbM);
    const pos = src.getAttribute('position');
    const nrm = src.getAttribute('normal');
    _fbC.setHex(hex);
    const span = this.top - this.base;
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      this.p.push(pos.getX(i), vy, pos.getZ(i));
      this.n.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      const h = THREE.MathUtils.clamp((vy - this.base) / span, 0, 1);
      const ao = 0.82 + 0.18 * h;               // 贴地压暗，读得出「从土里长出来」
      this.c.push(_fbC.r * ao, _fbC.g * ao, _fbC.b * ao);
      this.ph.push(this.phase);
      this.sw.push(Math.pow(h, 1.35));
    }
    this.tris += pos.count / 3;
    src.dispose();
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), x, y, z, hex, ry, rx, rz);
  }

  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false), x, y, z, hex, ry, rx, rz);
  }

  sphere(r: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6))), x, y, z, hex, ry, rx, rz, sx, sy, sz);
  }

  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sw, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.ph, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** 风动材质：顶点色 + 双面 + 顶点位移 + 亮度脉动。asm 由 onBeforeCompile 注入，uTime 自走时 */
function windMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    sh.vertexShader = `uniform float uTime;\nattribute float aSway;\nattribute float aPhase;\nvarying float vPhase;\n${sh.vertexShader}`;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vPhase = aPhase;
      float sw = aSway;
      transformed.x += sin(uTime * 1.25 + aPhase) * 0.105 * sw;
      transformed.z += cos(uTime * 0.93 + aPhase * 1.7) * 0.088 * sw;
      transformed.y += sin(uTime * 1.71 + aPhase * 0.7) * 0.022 * sw;`);
    sh.fragmentShader = `uniform float uTime;\nvarying float vPhase;\n${sh.fragmentShader}`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= 0.932 + 0.068 * sin(uTime * 1.9 + vPhase);`);
    mat.userData.shader = sh;
  };
  return mat;
}

export interface WindFloraReport { tris: number; plants: number; drawCalls: number; species: Record<string, number>; fauna?: number }
export const windFloraReport: WindFloraReport = { tris: 0, plants: 0, drawCalls: 0, species: {} };

/** 莲花：茎 + 圆叶 + 三层花瓣（8 外 / 6 中 / 5 内）+ 花蕊。池中漂浮，摆动最轻 */
function lotusPlant(w: WindBatch, x: number, z: number, waterY: number, phase: number, scale: number): void {
  const h = (0.55 + 0.35 * ((phase * 7.3) % 1)) * scale;
  w.plant(waterY - 0.1, waterY + h + 0.4 * scale, phase);
  w.cyl(0.028 * scale, 0.045 * scale, h, 6, x, waterY + h / 2, z, 0x3f5a34);
  // 圆叶：一片高叶（有缺口的一侧用暗色薄片压住，避免整圆像盘子）
  const padY = waterY + 0.04;
  w.cyl(0.34 * scale, 0.3 * scale, 0.025, 12, x + 0.36 * scale, padY, z - 0.24 * scale, 0x2f5a3a);
  w.box(0.16 * scale, 0.03, 0.1 * scale, x + 0.36 * scale, padY + 0.01, z - 0.24 * scale - 0.3 * scale, 0x24462e);
  for (const [ox, oz] of [[0.36, -0.24], [-0.3, 0.22], [0.1, 0.34]] as [number, number][]) {
    if (ox === 0.36) continue;
    w.cyl(0.26 * scale, 0.24 * scale, 0.02, 10, x + ox * scale, padY - 0.01, z + oz * scale, 0x2a4f34);
  }
  // 花朵：三层花瓣
  const fy = waterY + h;
  const layers: [number, number, number, number, number][] = [
    [8, 1.02, 0.42, 0.14, 0xf2bfd2],
    [6, 0.66, 0.36, 0.08, 0xf8dfe8],
    [5, 0.34, 0.3, 0.02, 0xfff4ef],
  ];
  for (let li = 0; li < layers.length; li++) {
    const [n, pit, len, rr, hex] = layers[li];
    for (let k = 0; k < n; k++) {
      const pa = (k / n) * Math.PI * 2 + li * 0.42 + phase;
      const [ox, oy, oz] = bladeOff(pa, pit, len * scale);
      w.box((0.19 - li * 0.03) * scale, len * scale, 0.028 * scale,
        x + Math.cos(pa) * rr * scale + ox, fy + oy, z + Math.sin(pa) * rr * scale + oz,
        hex, -(pa + Math.PI / 2), -pit, 0);
    }
  }
  // 花托 + 花蕊
  w.cyl(0.07 * scale, 0.1 * scale, 0.08 * scale, 8, x, fy + 0.03 * scale, z, 0xe8dcc0);
  for (let k = 0; k < 8; k++) {
    const pa = (k / 8) * Math.PI * 2 + phase;
    w.cyl(0.008 * scale, 0.012 * scale, 0.1 * scale, 4, x + Math.cos(pa) * 0.05 * scale, fy + 0.1 * scale, z + Math.sin(pa) * 0.05 * scale, 0xf0d878);
    w.sphere(0.018 * scale, 5, x + Math.cos(pa) * 0.05 * scale, fy + 0.16 * scale, z + Math.sin(pa) * 0.05 * scale, 0xffe9a0);
  }
}

/** 彼岸花：花茎 + 六出花瓣（基部外张、端部反卷）+ 六根卷曲花蕊；红到发暗 */
function spiderLily(w: WindBatch, x: number, z: number, y: number, s: number, phase: number): void {
  const h = 0.78 * s;
  w.plant(y, y + h + 0.46 * s, phase);
  w.cyl(0.022 * s, 0.034 * s, h, 5, x, y + h / 2, z, 0x3a2a26);
  r0(w, x, y, z, s, phase, h);
  // 基部草叶：三片细长暗绿（彼岸花开花时无叶，这三片是邻株的草）
  for (let k = 0; k < 3; k++) {
    const pa = phase + k * 2.1;
    const [ox, oy, oz] = bladeOff(pa, 0.9, 0.34 * s);
    w.box(0.035 * s, 0.34 * s, 0.012 * s, x + ox, y + 0.1 * s + oy, z + oz, 0x2a3a28, -(pa + Math.PI / 2), -0.9, 0);
  }
}

function r0(w: WindBatch, x: number, y: number, z: number, s: number, phase: number, h: number): void {
  for (let k = 0; k < 6; k++) {
    const a = phase + (k / 6) * Math.PI * 2;
    // 花瓣基部：外张 55°
    const p = 1.0 + (k % 2) * 0.12;
    const [ox, oy, oz] = bladeOff(a, p, 0.44 * s);
    w.box(0.075 * s, 0.44 * s, 0.022 * s, x + ox, y + h + oy, z + oz, 0x8e1520, -(a + Math.PI / 2), -p, 0);
    // 端部：反卷（更外、更平、更暗）
    const p2 = p + 0.5;
    const [ox2, oy2, oz2] = bladeOff(a, p2, 0.26 * s);
    w.box(0.055 * s, 0.26 * s, 0.018 * s, x + ox2 * 1.55, y + h + oy2 * 1.0 + 0.02 * s, z + oz2 * 1.55, 0x640c16, -(a + Math.PI / 2), -p2, 0);
  }
  // 花蕊：六根细丝，先冲上再外弯，端部卷曲小药
  for (let k = 0; k < 6; k++) {
    const a = phase + (k / 6) * Math.PI * 2 + 0.26;
    const baseY = y + h + 0.03 * s;
    const sx = x + Math.cos(a) * 0.03 * s, sz = z + Math.sin(a) * 0.03 * s;
    w.cyl(0.008 * s, 0.012 * s, 0.26 * s, 4, sx, baseY + 0.13 * s, sz, 0xb03a34);
    const mx = sx + Math.cos(a) * 0.1 * s, mz = sz + Math.sin(a) * 0.1 * s;
    w.cyl(0.006 * s, 0.008 * s, 0.16 * s, 4, mx, baseY + 0.3 * s, mz, 0xa8322c, 0, 0.55, 0);
    const ex = mx + Math.cos(a) * 0.14 * s, ez = mz + Math.sin(a) * 0.14 * s;
    w.cyl(0.005 * s, 0.006 * s, 0.1 * s, 4, ex, baseY + 0.34 * s, ez, 0x8e1c20, 0, 1.05, 0);
    w.sphere(0.014 * s, 5, ex, baseY + 0.4 * s, ez, 0xff7a60);   // 花药一点亮（整株唯一高光）
  }
}

/** 枯木：递归分叉（干 → 主枝 → 侧枝 → 细梢），不是圆锥 */
function deadWood(w: WindBatch, x: number, z: number, y: number, s: number, phase: number, seed: number): number {
  let st = (Math.imul((Math.round(x * 31) ^ Math.round(z * 17) ^ seed) >>> 0, 2654435761) >>> 0) || 7;
  const rnd = (): number => ((st = (Math.imul(st ^ (st >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  const top = y + 4.2 * s;
  w.plant(y, top, phase);
  let tips = 0;
  const branch = (bx: number, by: number, bz: number, a: number, pitch: number, len: number, r: number, depth: number): void => {
    const [dx, dy, dz] = tipOf(a, pitch, len);
    const [ox, oy, oz] = tipOf(a, pitch, len * 0.5);
    w.cyl(r * 1.18, r, len, depth > 1 ? 6 : 5, bx + ox, by + oy, bz + oz, depth > 1 ? 0x4a4038 : 0x5a5048, 0, Math.sin(a) * pitch, -Math.cos(a) * pitch);
    const nx = bx + dx, ny = by + dy, nz = bz + dz;
    if (depth <= 0) {
      tips++;
      // 细梢：三根枯枝，末端略上挑
      for (let k = 0; k < 3; k++) {
        const a2 = a + (k - 1) * (0.5 + rnd() * 0.4);
        const [tx, ty, tz] = tipOf(a2, pitch * 0.4 + 0.1, len * 0.55);
        w.cyl(r * 0.35, r * 0.75, len * 0.55, 4, nx + tx * 0.5, ny + ty * 0.5, nz + tz * 0.5, 0x6a6058, 0, Math.sin(a2) * 0.5, -Math.cos(a2) * 0.5);
      }
      return;
    }
    const nb = depth >= 2 ? 2 : 2;
    for (let k = 0; k < nb; k++) {
      const a2 = a + (k ? 1 : -1) * (0.55 + rnd() * 0.5);
      const p2 = Math.max(0.12, pitch + (rnd() - 0.35) * 0.5);
      branch(nx, ny, nz, a2, p2, len * (0.6 + rnd() * 0.12), r * 0.6, depth - 1);
    }
  };
  // 主干：三段带微弯
  let cx = x, cy = y, cz = z;
  for (let n = 0; n < 3; n++) {
    const a = phase + n * 0.7;
    const p = 0.04 + n * 0.03;
    const len = 1.35 * s;
    const [dx, dy, dz] = tipOf(a, p, len);
    const [ox, oy, oz] = tipOf(a, p, len * 0.5);
    w.cyl((0.2 - n * 0.05) * s, (0.26 - n * 0.05) * s, len, 6, cx + ox, cy + oy, cz + oz, n === 0 ? 0x3e3630 : 0x4a4038, 0, Math.sin(a) * p, -Math.cos(a) * p);
    cx += dx; cy += dy; cz += dz;
  }
  // 主枝四根
  for (let k = 0; k < 4; k++) {
    const a = phase + k * 1.57 + 0.4;
    branch(cx, cy - 0.2 * s, cz, a, 0.55 + rnd() * 0.3, 1.5 * s, 0.14 * s, 2);
  }
  return tips;
}

/** 幽冥藤：挂在枯木冠/岩沿的垂藤，节节下沉，末梢卷曲，偶结幽光果 */
function netherVine(w: WindBatch, x: number, y: number, z: number, len: number, phase: number, seed: number): void {
  let st = (Math.imul((Math.round(x * 13) ^ Math.round(z * 29) ^ seed) >>> 0, 2246822519) >>> 0) || 11;
  const rnd = (): number => ((st = (Math.imul(st ^ (st >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  w.plant(y - len, y, phase);
  let cx = x, cy = y, cz = z;
  const n = 7;
  for (let k = 0; k < n; k++) {
    const dh = len / n;
    const sway = Math.sin(k * 1.3 + phase) * 0.06;
    const nx = cx + sway, ny = cy - dh, nz = cz + Math.cos(k * 1.1 + phase) * 0.05;
    w.cyl(0.016, 0.022, dh, 4, (cx + nx) / 2, (cy + ny) / 2, (cz + nz) / 2, 0x2a3a30);
    // 叶：三片掌状小叶
    for (let lf = 0; lf < 3; lf++) {
      const la = phase + k * 0.9 + lf * 2.1;
      const [ox, oy, oz] = bladeOff(la, 1.1, 0.16);
      w.box(0.11, 0.16, 0.012, nx + ox, ny + oy, nz + oz, lf === 1 ? 0x3a5a44 : 0x2c4636, -(la + Math.PI / 2), -1.1, 0);
    }
    if (k === n - 2 && rnd() > 0.35) w.sphere(0.035, 5, nx, ny, nz, 0x7ad8a8);
    if (k === n - 1) {
      // 末梢卷曲：两段小弧
      w.cyl(0.01, 0.014, 0.14, 4, nx + 0.04, ny - 0.06, nz, 0x2a3a30, 0, 0.9, 0);
      w.cyl(0.008, 0.01, 0.1, 4, nx + 0.1, ny - 0.14, nz, 0x2a3a30, 0, 1.6, 0);
    }
    cx = nx; cy = ny; cz = nz;
  }
}

/** 灵芝（风动版）：两段茎 + 扁球菌盖 + 轮生九叶 + 盖心光 */
function lingzhiPlant(w: WindBatch, x: number, z: number, y: number, s: number, phase: number): void {
  w.plant(y, y + 0.55 * s, phase);
  let lx = x, ly = y, lz = z;
  for (let n = 0; n < 2; n++) {
    const [dx, dy, dz] = tipOf(phase, 0.05 + n * 0.07, 0.18 * s);
    w.cyl((0.035 - n * 0.008) * s, (0.06 - n * 0.012) * s, 0.18 * s, 5, lx + dx * 0.5, ly + dy * 0.5, lz + dz * 0.5, 0x8a4a5e);
    lx += dx; ly += dy; lz += dz;
  }
  w.sphere(0.2 * s, 8, lx, ly + 0.02 * s, lz, 0x8a4a5e, 0, 0, 0, 1, 0.3, 1);
  for (let k = 0; k < 9; k++) {
    const pa = (k / 9) * Math.PI * 2 + phase;
    const p = 0.34 + (k % 3) * 0.05;
    const rr = (0.16 + Math.sin(p) * 0.17) * s;
    const [ox, oy, oz] = bladeOff(pa, p, 0.3 * s);
    w.box(0.1 * s, 0.3 * s, 0.03 * s, lx + Math.cos(pa) * rr + ox * 0.5, ly + 0.06 * s + oy, lz + Math.sin(pa) * rr + oz * 0.5,
      shade(0xa85a72, 0.92 + (k % 3) * 0.07), -(pa + Math.PI / 2), -p, 0);
  }
  w.sphere(0.03 * s, 5, lx, ly + 0.09 * s, lz, 0xf0b0c0);
}

/** 瑶草（风动版）：3~5 片外张窄叶 + 叶尖垂露 */
function yaocaoPlant(w: WindBatch, x: number, z: number, y: number, s: number, phase: number): void {
  w.plant(y, y + 0.42 * s, phase);
  const n = 3 + Math.round((phase * 10) % 3);
  for (let k = 0; k < n; k++) {
    const pa = phase + (k / n) * Math.PI * 2;
    const p = 0.52 + ((phase * 13 + k * 0.37) % 1) * 0.3;
    const len = (0.3 + ((phase * 7 + k) % 1) * 0.16) * s;
    const [ox, oy, oz] = bladeOff(pa, p, len);
    w.box(0.1 * s, len, 0.022 * s, x + ox, y + oy, z + oz, shade(0x4a7a44, 1.15 + k * 0.07), -(pa + Math.PI / 2), -p, 0);
  }
  const [dx, dy, dz] = bladeOff(phase + 0.4, 0.85, 0.46 * s);
  w.sphere(0.026 * s, 5, x + dx, y + dy, z + dz, 0xdfffe8);
}

/**
 * 构建风动仙植/鬼植并挂到场景（由 sky/realm.ts 在「云起天宫」步调用，此时 scene 已就绪）。
 * 只新增 1 个 draw call；三角形数记入 windFloraReport。
 */
export function buildWindFlora(scene: THREE.Scene): WindFloraReport {
  const w = new WindBatch();
  const species: Record<string, number> = { lotus: 0, spiderLily: 0, deadWood: 0, netherVine: 0, lingzhi: 0, yaocao: 0 };
  // ---- 瑶池莲花：池心 (150,20)，水面 206.25，水榭占 r≤10，花环放 r 12–21 ----
  const POND_X = 150, POND_Z = 20, WATER = 206.28;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.31;
    const rr = 12.5 + ((i * 2.7) % 1) * 7.5;
    lotusPlant(w, POND_X + Math.cos(a) * rr, POND_Z + Math.sin(a) * rr, WATER, 0.37 + i * 0.61, 0.95 + ((i * 0.37) % 1) * 0.35);
    species.lotus++;
  }
  // 近岸三丛（贴水面的矮花，给特写用）
  for (const [a, rr, s] of [[0.6, 9.6, 0.8], [2.4, 10.4, 0.72], [4.4, 9.9, 0.86]] as [number, number, number][]) {
    lotusPlant(w, POND_X + Math.cos(a) * rr, POND_Z + Math.sin(a) * rr, WATER, 1.7 + a, s);
    species.lotus++;
  }
  // ---- 蟠桃园：灵芝 10 + 瑶草 24（园心 -150,45；台面 202.05）----
  const GX = -150, GZ = 40, GY = 202.05;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.7;
    const rr = 6 + ((i * 3.1) % 1) * 5;
    lingzhiPlant(w, GX + Math.cos(a) * rr, GZ + Math.sin(a) * rr, GY, 1.0 + ((i * 0.23) % 1) * 0.4, 0.4 + i * 0.77);
    species.lingzhi++;
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + 0.2;
    const rr = 4 + ((i * 1.7) % 1) * 16;
    yaocaoPlant(w, GX + Math.cos(a) * rr, GZ + Math.sin(a) * rr, GY, 1.0 + ((i * 0.31) % 1) * 0.5, 0.9 + i * 0.43);
    species.yaocao++;
  }
  // ---- 地府（y=-260）：彼岸花 36 丛（黄泉路两侧）+ 枯木 5 株 + 幽冥藤 8 条 ----
  const UY = -260;
  for (let i = 0; i < 36; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const gx = 232 + Math.floor(i / 2) * 4.2 + ((i * 0.73) % 1) * 1.6;
    const gz = 20 + side * (3.2 + ((i * 1.3) % 1) * 2.4);
    const s = 0.9 + ((i * 0.41) % 1) * 0.5;
    spiderLily(w, gx, gz, UY, s, 0.3 + i * 0.58);
    if (i % 3 === 0) spiderLily(w, gx + 0.5 * s, gz + 0.4 * s, UY, s * 0.86, 2.1 + i * 0.58);
    species.spiderLily++;
  }
  const deadSpots: [number, number, number][] = [[224, UY, 10], [262, UY, -14], [296, UY, 30], [205, UY, 44], [330, UY, 6]];
  for (let i = 0; i < deadSpots.length; i++) {
    const [dx, dy, dz] = deadSpots[i];
    deadWood(w, dx, dz, dy, 1.0 + (i % 3) * 0.12, 0.5 + i * 1.3, 0x91 + i);
    species.deadWood++;
  }
  for (let i = 0; i < 8; i++) {
    const [dx, dy, dz] = deadSpots[i % deadSpots.length];
    netherVine(w, dx + 0.7 + (i % 2) * 0.5, dy + 2.6 + (i % 3) * 0.35, dz + 0.3, 2.2 + (i % 4) * 0.35, 0.2 + i * 0.9, 0x33 + i);
    species.netherVine++;
  }
  // ---- 七岳神兽神鸟：锚点在 buildMountainLife（山河·地形步）里落位，这里只做造型 ----
  const fauna = buildMountainFauna(w);
  const geo = w.geo();
  const mat = windMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky_windFlora';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.onBeforeRender = (): void => {
    const sh = (mesh.material as THREE.MeshStandardMaterial).userData.shader as { uniforms?: { uTime?: { value: number } } } | undefined;
    if (sh?.uniforms?.uTime) sh.uniforms.uTime.value = performance.now() * 0.001;
  };
  scene.add(mesh);
  windFloraReport.tris = Math.round(w.tris);
  windFloraReport.plants = Object.values(species).reduce((a, b) => a + b, 0) + fauna;
  windFloraReport.drawCalls = 1;
  windFloraReport.species = species;
  windFloraReport.fauna = fauna;
  if (typeof window !== 'undefined') (window as unknown as { __windFloraReport?: WindFloraReport }).__windFloraReport = windFloraReport;
  return windFloraReport;
}

// ============ 七岳山林生机（v92）：分带乔木 / 五色花丛 / 溪流瀑布 / 神兽神鸟锚点 ============
// 约束：树与花走 Baker 静态合批（trunk/leaf 既有组，零新增 draw call、零实例池占用——
// treeTrunk/treeCanopy 池已被 scatterVegetation 用掉 1500/1600，crane/qilin 池也被 mounts.ts 全额分配，
// 再 alloc 会抛「槽位不足」把世界初始化打断）。神兽神鸟走本文件既有的 WindBatch 风动合批（1 draw call）。
// 随机源全部是本山地种子 LCG 与坐标 hash，**不消耗共享 rng**：下游 scatterVegetation / 市井装饰逐值不变。

// 再强调一次：树与花走 Baker 静态合批（trunk/leaf 既有组，零新增 draw call、零实例池占用——
// treeTrunk/treeCanopy 池已被 scatterVegetation 用掉 1500/1600，crane/qilin 池也被 mounts.ts 全额分配，
// 再 alloc 会抛「槽位不足」把世界初始化打断）。神兽神鸟走本文件既有的 WindBatch 风动合批（1 draw call）。
export interface MountainSite {
  /** 山体定义（只读） */
  m: Mountain;
  /** 解析峰（多数形制的实际最高点不在几何中心） */
  summit: { x: number; y: number; z: number };
  /** 林线 / 雪线（米） */
  treeLine: number;
  snowLine: number;
  /** 溪流起始方位（弧度） */
  streamAng: number;
  /** 是否配瀑布 */
  waterfall: boolean;
}

export interface FaunaAnchor { x: number; y: number; z: number; kind: 'crane' | 'deer' | 'qingluan' | 'qilin' | 'tiger'; ry: number; s: number }

export interface MountainLifeReport {
  trees: Record<string, number>;
  shrubs: Record<string, number>;
  flowers: Record<string, number>;
  flowerColors: number;
  streams: Record<string, number>;
  waterfalls: { mountain: string; drop: number; at: [number, number, number] }[];
  fauna: Record<string, number>;
  faunaTotal: number;
  /** 近景取证用的密林中心（山名 → [x,y,z]） */
  groves: Record<string, [number, number, number]>;
  tris: number;
}

let lifeReport: MountainLifeReport | null = null;
export function getMountainLifeReport(): MountainLifeReport | null { return lifeReport; }

/** 本山专用 LCG：只吃坐标与 salt，绝不碰共享 rng */
function lifeRng(m: Mountain, salt: number): () => number {
  let s = (Math.imul(Math.round(m.x * 31 + m.z * 17) ^ salt, 2246822519) >>> 0) || 7;
  return (): number => ((s = (Math.imul(s ^ (s >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
}

function slopeAt(surfaceAt: (x: number, z: number) => number, x: number, z: number, e = 45): number {
  const gx = (surfaceAt(x + e, z) - surfaceAt(x - e, z)) / (2 * e);
  const gz = (surfaceAt(x, z + e) - surfaceAt(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

// 分带色：山脚阔叶（亮）→ 山腰针阔混 → 山腰以上针叶（墨绿）；都避开近白，防山顶爆白。
// v92 提亮一档：低太阳角下 0x2f5c3a 这类深绿会读成黑剪影（山腰近景实拍确认），
// 提亮后仍比草地深，近看是树、远看是林。
const LEAF_BROAD = [0x5f9e44, 0x6aab4c, 0x55963e, 0x74b455, 0x63a247];
const LEAF_MIXED = [0x4c8a3f, 0x579a46, 0x437c3a, 0x518f41];
const LEAF_CONIF = [0x3d7245, 0x46804c, 0x356842, 0x407848];

/** 单株乔木：针叶=三段锥，阔叶=扁球冠。返回构件数（诊断用） */
function mountainTree(b: Baker, x: number, y: number, z: number, band: number, s: number, hex: number, rot: number): void {
  const trunkC = 0x3b2b1c;
  if (band >= 2) {
    const h = 13 * s;
    b.cyl('trunk', 0.42 * s, 0.72 * s, h * 0.5, 5, x, y + h * 0.25, z, trunkC);
    for (let k = 0; k < 3; k++) {
      const w = (3.6 - k * 0.85) * s, hh = (6.4 - k * 1.4) * s;
      b.cyl('leaf', 0.12 * s, w, hh, 6, x, y + h * 0.42 + k * 3.4 * s, z, shade(hex, 0.94 + k * 0.06));
    }
  } else {
    const h = 11 * s;
    b.cyl('trunk', 0.5 * s, 0.82 * s, h * 0.55, 5, x, y + h * 0.28, z, trunkC);
    b.sphere('leaf', 3.4 * s, 5, x, y + h * 0.72, z, hex, rot, 0, 0, 1.0, 0.72, 0.95);
    if (band === 1) b.cyl('leaf', 0.1 * s, 2.2 * s, 4.2 * s, 6, x, y + h * 0.86, z, shade(hex, 0.9));
  }
}

/** 花丛：低矮灌木 + 4 团同色花球（同色成片，不撒彩虹点） */
function mountainFlowerBush(b: Baker, x: number, y: number, z: number, hex: number, s: number, rot: number): void {
  b.sphere('leaf', 0.85 * s, 5, x, y + 0.55 * s, z, 0x3b6b30, rot, 0, 0, 1.25, 0.62, 1.1);
  for (let k = 0; k < 4; k++) {
    const a = rot + k * Math.PI * 0.5;
    b.sphere('leaf', 0.32 * s, 4, x + Math.cos(a) * 0.55 * s, y + 0.72 * s + (k % 2) * 0.12 * s, z + Math.sin(a) * 0.55 * s, hex, 0, 0, 0, 1.15, 0.72, 1.15);
  }
}

/** 林下灌丛：一丛两球，填满乔木之间的裸地（近景"郁郁葱葱"主要靠它，单丛 ~72 面） */
function mountainShrub(b: Baker, x: number, y: number, z: number, hex: number, s: number, rot: number): void {
  b.sphere('leaf', 0.95 * s, 5, x, y + 0.5 * s, z, hex, rot, 0, 0, 1.35, 0.66, 1.2);
  b.sphere('leaf', 0.55 * s, 4, x + Math.cos(rot) * 0.7 * s, y + 0.62 * s, z + Math.sin(rot) * 0.7 * s, shade(hex, 1.12), 0, 0, 0, 1.1, 0.8, 1.05);
}

interface StreamPt { x: number; y: number; z: number }

/** 沿下坡方向追一条溪流：梯度下降 + 外向偏置（不会走进山体内部的局部洼地） */
function traceStream(site: MountainSite, surfaceAt: (x: number, z: number) => number, rnd: () => number): StreamPt[] {
  const m = site.m;
  let rr = m.r * 0.56;
  let start: StreamPt | null = null;
  // 找到山腰上一个确实有高度的起点（华山绝壁的 0.56r 已在山脚外）
  for (let k = 0; k < 10 && !start; k++) {
    const x = m.x + Math.cos(site.streamAng) * rr, z = m.z + Math.sin(site.streamAng) * rr;
    const y = surfaceAt(x, z);
    if (y > m.h * 0.1) start = { x, y, z };
    rr -= m.r * 0.05;
  }
  if (!start) return [];
  const pts: StreamPt[] = [start];
  let px = start.x, pz = start.z;
  for (let i = 0; i < 60; i++) {
    const y = surfaceAt(px, pz);
    if (y < 3.5) break;
    const gx = (surfaceAt(px + 40, pz) - surfaceAt(px - 40, pz)) / 80;
    const gz = (surfaceAt(px, pz + 40) - surfaceAt(px, pz - 40)) / 80;
    const ox = px - m.x, oz = pz - m.z;
    const ol = Math.hypot(ox, oz) || 1;
    let dx = -gx * 170 + (ox / ol) * 52 + (rnd() - 0.5) * 12;
    let dz = -gz * 170 + (oz / ol) * 52 + (rnd() - 0.5) * 12;
    const L = Math.hypot(dx, dz) || 1;
    px += (dx / L) * 68;
    pz += (dz / L) * 68;
    if (Math.hypot(px - m.x, pz - m.z) > m.r * 1.22) break;
    pts.push({ x: px, y: surfaceAt(px, pz), z: pz });
  }
  return pts;
}

/** 溪流缎带 + 岸石 + 源头泉眼。返回米数 */
function buildStreamRibbon(b: Baker, pts: StreamPt[], rnd: () => number): number {
  if (pts.length < 3) return 0;
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const dx = c.x - a.x, dz = c.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    len += L;
    const yaw = Math.atan2(dx, dz);
    const rx = -Math.atan2(c.y - a.y, L);
    const w = 10 + (i % 3) * 1.6;
    b.box('water', w, 0.5, L + 4, (a.x + c.x) / 2, (a.y + c.y) / 2 + 0.55, (a.z + c.z) / 2, 0x2f7f96, yaw, rx, 0);
    if (i % 3 === 1) { // 白沫：短段、窄、压在水面
      b.box('ash', w * 0.45, 0.28, L * 0.5, (a.x + c.x) / 2, (a.y + c.y) / 2 + 0.85, (a.z + c.z) / 2, 0xcfe4ea, yaw, rx, 0);
    }
    if (i % 2 === 0) { // 两岸石
      for (const sd of [-1, 1]) {
        const ox = Math.cos(yaw) * sd * (w * 0.5 + 3.5);
        const oz = -Math.sin(yaw) * sd * (w * 0.5 + 3.5);
        const rr = 1.6 + rnd() * 2.4;
        b.sphere('ash', rr, 5, a.x + ox, a.y + rr * 0.3, a.z + oz, shade(0x7d7f78, 0.86 + rnd() * 0.2), 0, 0, 0, 1.2, 0.6, 1.1);
      }
    }
  }
  // 源头泉眼：石砌小涵洞 + 一汪浅潭
  const s = pts[0];
  b.cyl('water', 7, 8, 0.6, 12, s.x, s.y + 0.4, s.z, 0x2f7f96);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.sphere('ash', 2.4 + rnd() * 1.2, 5, s.x + Math.cos(a) * 8.5, s.y + 0.6, s.z + Math.sin(a) * 8.5, 0x74766f, 0, 0, 0, 1.1, 0.75, 1.1);
  }
  return len;
}

/** 找最陡的崖面（用于瀑布）：28 方位 × 13 段径向，取落差最大的一跨 */
function findCliff(site: MountainSite, surfaceAt: (x: number, z: number) => number): { top: StreamPt; foot: StreamPt; drop: number } | null {
  const m = site.m;
  let best: { top: StreamPt; foot: StreamPt; drop: number } | null = null;
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    for (let f = 0.16; f <= 0.82; f += 0.05) {
      const x0 = m.x + Math.cos(a) * m.r * f, z0 = m.z + Math.sin(a) * m.r * f;
      const x1 = m.x + Math.cos(a) * m.r * (f + 0.13), z1 = m.z + Math.sin(a) * m.r * (f + 0.13);
      const y0 = surfaceAt(x0, z0), y1 = surfaceAt(x1, z1);
      const drop = y0 - y1;
      if (drop > 120 && (!best || drop > best.drop)) best = { top: { x: x0, y: y0, z: z0 }, foot: { x: x1, y: y1, z: z1 }, drop };
    }
  }
  return best;
}

/** 瀑布：贴着坡面走的水幕（沿落线逐段取样地表）+ 崖口水舌 + 潭 + 水雾 + 白沫 */
function buildWaterfall(
  b: Baker,
  c: { top: StreamPt; foot: StreamPt; drop: number },
  rnd: () => number,
  surfaceAt: (x: number, z: number) => number,
): void {
  const { top, foot } = c;
  const dx = foot.x - top.x, dz = foot.z - top.z;
  const dl = Math.hypot(dx, dz) || 1;
  const ox = (dx / dl) * 26, oz = (dz / dl) * 26; // 横向悬出 26m（避让 206m 网格的坡面鼓包）
  const yaw = Math.atan2(dx, dz);
  const N = 22, width = 32;
  // 关键：**逐段取渲染地表高度**，让水幕贴着坡面走。
  // 直弦（top→foot）在凸坡上会插进山体，只剩抬高的白板（实拍确认：一串孤立白 plank）。
  const pts: StreamPt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = top.x + dx * t, z = top.z + dz * t;
    pts.push({ x: x + ox, y: surfaceAt(x + ox, z + oz) + 1.4, z: z + oz });
  }
  for (let i = 0; i < N; i++) {
    const a = pts[i], e = pts[i + 1];
    const sx = e.x - a.x, sz = e.z - a.z;
    const ry = Math.atan2(sx, sz);
    const t = (i + 0.5) / N;
    const w = width; // 等宽：渐细会让每一段露出台阶边
    // 竖直水帘：一段一块，**下缘压到下一段地表以下 8m**，相邻段水平间距只有 ~19m（远小于 32m 宽），
    // 因此侧面互相重叠、读成一条连续落水，不会出现斜板旋转错位后的"钻石串"。
    const yTop = a.y + 2.0;
    const yBot = e.y - 8;
    const h = Math.max(6, yTop - yBot);
    const cy = (yTop + yBot) / 2;
    b.box('water', w, h, 6, a.x, cy, a.z, 0x54aec2, ry);
    // 白水带只留中间一条窄练（0.24w）：太宽会把整段读成白块
    b.box('ash', w * 0.24, h, 1.8, a.x + (ox / 26) * 2.4, cy + 0.6, a.z + (oz / 26) * 2.4, 0xbfe0e8, ry);
    if (i % 3 === 0) {
      b.box('fabric', w * 0.5, h * 0.55, 1.2, a.x + (ox / 26) * 4.5, cy + 2.0, a.z + (oz / 26) * 4.5, 0x9fc9d4, ry);
    }
  }
  // 崖口岩唇（水从石头缝里出来，不是凭空挂一条蓝带）
  b.box('ash', width * 1.3, 3.2, 10, top.x + ox * 0.35, top.y + 1.4, top.z + oz * 0.35, 0x6e695e, yaw);
  // 崖口水舌（溢流边缘）与底部潭
  b.box('water', width * 1.1, 1.4, 7, top.x + ox * 0.6, top.y + 0.6, top.z + oz * 0.6, 0x3f92a8, yaw);
  b.cyl('water', 38, 46, 0.9, 18, foot.x + ox * 0.6, foot.y + 0.35, foot.z + oz * 0.6, 0x2f7f96);
  // 潭缘白沫环
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.sphere('ash', 4 + rnd() * 3, 5, foot.x + ox * 0.6 + Math.cos(a) * 40, foot.y + 0.7, foot.z + oz * 0.6 + Math.sin(a) * 40,
      shade(0xc9e2e8, 0.9 + rnd() * 0.1), 0, 0, 0, 1.5, 0.35, 1.2);
  }
  // 水雾：低饱和冷白（fabric 受光，不走 glow，不会被 bloom 拉成白团）。
  // 14 团、半径 5–11、铺开 10–45m：太少太大会读成一个白球（实拍确认）。
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2, rr = 10 + rnd() * 35;
    b.sphere('fabric', 5 + rnd() * 6, 6, foot.x + ox * 0.6 + Math.cos(a) * rr, foot.y + 3 + rnd() * 22, foot.z + oz * 0.6 + Math.sin(a) * rr,
      shade(0xbcd6dd, 0.92 + rnd() * 0.1), 0, 0, 0, 1.35, 0.6, 1.35);
  }
  // 潭缘卵石
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    b.sphere('ash', 2 + rnd() * 2.6, 5, foot.x + ox * 0.6 + Math.cos(a) * 50, foot.y + 0.8, foot.z + oz * 0.6 + Math.sin(a) * 50,
      shade(0x777a72, 0.86 + rnd() * 0.2), 0, 0, 0, 1.2, 0.7, 1.2);
  }
}

/** 山形点景：每座山一件标志物（南天门/悬空寺/少林山门/冰川/瑶池），落在实地 */
function buildSignaturePiece(b: Baker, site: MountainSite, surfaceAt: (x: number, z: number) => number, rnd: () => number): void {
  const m = site.m;
  const put = (x: number, z: number): number => surfaceAt(x, z);
  if (m.name === '泰山') {
    // 南天门：山顶南侧石砌门阙（两柱一门楣 + 小瓦顶），对应"十八盘尽头"
    const x = site.summit.x, z = site.summit.z + 44, y = put(x, z);
    for (const sd of [-1, 1]) {
      b.box('ash', 2.6, 9.5, 2.6, x + sd * 6.5, y + 4.3, z, 0x9a958a);
      b.box('ash', 3.4, 0.8, 3.4, x + sd * 6.5, y + 0.4, z, 0x8f8a7e);
    }
    b.box('ash', 19, 1.8, 3.0, x, y + 9.2, z, 0x8f8a7e);
    b.box('roof', 21, 0.9, 4.6, x, y + 10.2, z, 0x3b4045);
    b.cyl('glow', 0.22, 0.3, 0.7, 6, x, y + 6.4, z + 1.7, 0xffd25e);
    b.kit('mtn.southGate', 1, y);
  } else if (m.name === '恒山') {
    // 悬空寺：峡谷南壁的贴崖木构（六柱撑出的半悬平台 + 三间小殿）
    const cx = m.x + m.r * 0.12, cz = m.z + m.r * 0.20;
    const cy = put(cx, cz);
    const deck = cy + 2.4;
    b.box('wood', 26, 0.6, 11, cx, deck, cz, 0x6a4a2c);
    for (let k = 0; k < 6; k++) {
      const px = cx - 11 + k * 4.4;
      const g = put(px, cz + 4.4);
      const hh = Math.max(0.5, deck - g + 0.4);
      b.box('wood', 0.42, hh, 0.42, px, deck - hh * 0.5, cz + 4.4, 0x5a3e22);
      b.box('ash', 0.9, 0.5, 0.9, px, g + 0.2, cz + 4.4, 0x7d786c);
    }
    for (let k = 0; k < 3; k++) {
      b.box('wall', 6.2, 3.2, 6.4, cx - 8 + k * 8, deck + 1.9, cz, 0xb8a88c);
      b.box('roof', 8.2, 1.2, 8.0, cx - 8 + k * 8, deck + 4.0, cz, 0x454b52);
    }
    b.kit('mtn.hangingTemple', 1, deck);
  } else if (m.name === '嵩山') {
    // 少林山门：山脚三开间门屋 + 八字墙（"少林在山脚"）
    const a = site.streamAng + 1.9;
    const x = m.x + Math.cos(a) * m.r * 1.03, z = m.z + Math.sin(a) * m.r * 1.03;
    const y = put(x, z);
    b.box('ash', 22, 1.2, 14, x, y + 0.6, z, 0x8d897e);
    b.box('wall', 17, 5.2, 8, x, y + 3.8, z, 0xc9b891);
    b.box('roof', 20, 1.6, 10.5, x, y + 7.0, z, 0x3b4045);
    for (const sd of [-1, 1]) b.box('wall', 1.2, 4.2, 12, x + sd * 12, y + 2.2, z + 2, 0xb0a084);
    b.box('wood', 3.2, 3.4, 1.0, x, y + 2.0, z + 4.2, 0x4a2f1c);
    b.kit('mtn.shaolinGate', 1, y);
  } else if (m.name === '天山') {
    // 冰川舌：脊间谷底的一列冰塔 + 冰面（"雪线 + 冰川"）
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      const a = -0.4;
      const bx = m.x + Math.cos(m.axis) * m.r * (t * 0.9 - 0.45) + Math.cos(a) * m.r * 0.26;
      const bz = m.z + Math.sin(m.axis) * m.r * (t * 0.9 - 0.45) + Math.sin(a) * m.r * 0.26;
      const y = put(bx, bz);
      b.box('ash', 34 - k * 2, 1.2, 44, bx, y + 0.6, bz, 0xa9c6d4, m.axis, 0, 0.02);
      b.cyl('ash', 0.6, 2.6, 7 + rnd() * 9, 5, bx + (rnd() - 0.5) * 22, y + 4, bz + (rnd() - 0.5) * 30, 0xb8d2de);
    }
    b.kit('mtn.glacier', 9, 0);
  } else if (m.name === '昆仑') {
    // 瑶池：高原台面上一汪碧水（西王母道场）
    const px = site.summit.x + m.r * 0.14, pz = site.summit.z + m.r * 0.10;
    const py = put(px, pz);
    b.cyl('water', 42, 48, 0.7, 20, px, py + 0.4, pz, 0x2f8fa0);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.cyl('ash', 1.1, 1.5, 2.6 + rnd() * 2.2, 6, px + Math.cos(a) * 52, py + 1.3, pz + Math.sin(a) * 52, 0xd6d1c4);
    }
    b.kit('mtn.yaochi', 1, py);
  }
}

/** 神兽锚点：每山 3 只（峰顶/山腰/溪畔各一），供 buildWindFlora 用 WindBatch 造型 */
const FAUNA_PLAN: Record<string, FaunaAnchor['kind'][]> = {
  '泰山': ['crane', 'crane', 'deer'],
  '华山': ['qingluan', 'qingluan', 'tiger'],
  '衡山': ['deer', 'deer', 'crane'],
  '恒山': ['qilin', 'qilin', 'crane'],
  '嵩山': ['tiger', 'tiger', 'crane'],
  '天山': ['qingluan', 'qingluan', 'qilin'],
  '昆仑': ['qilin', 'qilin', 'crane'],
};
let mountainFaunaAnchors: FaunaAnchor[] = [];
export function mountainFauna(): FaunaAnchor[] { return mountainFaunaAnchors; }

/**
 * 七岳山林生机总装。返回可机检台账（每山株数/花丛色数/溪长/瀑布落差/神兽数/密林中心）。
 * `heightAt` 用解析高度（判形制），`surfaceAt` 用渲染面（贴地落点不浮空）。
 */
export async function buildMountainLife(
  b: Baker,
  sites: MountainSite[],
  heightAt: (x: number, z: number) => number,
  surfaceAt: (x: number, z: number) => number,
): Promise<MountainLifeReport> {
  const rep: MountainLifeReport = {
    trees: {}, shrubs: {}, flowers: {}, flowerColors: FLOWER_COLORS.length, streams: {}, waterfalls: [], fauna: {}, faunaTotal: 0, groves: {}, tris: 0,
  };
  const triOf = (): number => {
    const st = b.stats();
    let t = 0;
    for (const k of Object.keys(st.groups)) t += st.groups[k as keyof typeof st.groups].triangles;
    return Math.round(t);
  };
  const t0 = triOf();
  mountainFaunaAnchors = [];
  for (let si = 0; si < sites.length; si++) {
    const site = sites[si];
    const m = site.m;
    const rnd = lifeRng(m, 0x7a11 + si * 37);
    const treeFrac = site.treeLine / m.h;
    const treeCount = 540;
    let placedTrees = 0;
    const groveCenters: { x: number; z: number; y: number }[] = [];
    // 6 片密林：给"山腰近景"取证用（散点在山体尺度上会太稀）。密林内 72 株/片，
    // 半径 300m → 平均 35m 一株；配合林下灌丛与花丛，近景才读得成"林"。
    for (let g = 0; g < 6 && groveCenters.length < 6; g++) {
      for (let tries = 0; tries < 28; tries++) {
        const a = rnd() * Math.PI * 2;
        const rr = m.r * (0.3 + rnd() * 0.45);
        const x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
        const y = surfaceAt(x, z);
        if (y < m.h * 0.08 || y > site.treeLine * 0.9) continue;
        if (slopeAt(surfaceAt, x, z, 40) > 1.1) continue;
        if (Math.hypot(x - site.summit.x, z - site.summit.z) < 140) continue;
        groveCenters.push({ x, z, y });
        break;
      }
    }
    let gi = 0;
    // 两遍：先按"正常林地"坡度（≤50°）铺，绝壁形制（华山 69.5°）铺不满时放宽到山崖附生（≤65°），
    // 保证"每座山 ≥400 株"是硬读数而不是靠放宽全局阈值糊出来。
    let guard = 0;
    for (const maxSlope of [1.18, 2.15]) {
      guard = 0;
      while (placedTrees < treeCount && guard++ < treeCount * 7) {
        let x: number, z: number;
        const inGrove = gi < groveCenters.length && placedTrees < treeCount * 0.8;
        if (inGrove) {
          const c = groveCenters[gi];
          // 密林半径 150m（不是 300）：72 株/片 → 平均 31m 一株，近景才读得成林
          const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 150;
          x = c.x + Math.cos(a) * rr; z = c.z + Math.sin(a) * rr;
          if ((placedTrees + 1) % 72 === 0) gi++;
        } else {
          const a = rnd() * Math.PI * 2, rr = m.r * (0.22 + Math.sqrt(rnd()) * 0.78);
          x = m.x + Math.cos(a) * rr; z = m.z + Math.sin(a) * rr;
        }
        const y = surfaceAt(x, z);
        if (y < m.h * 0.03 || y > site.treeLine) continue;
        if (Math.hypot(x - site.summit.x, z - site.summit.z) < 130) continue;
        if (slopeAt(surfaceAt, x, z, 38) > maxSlope) continue;
        const local = y / m.h;
        const band = local < treeFrac * 0.52 ? 0 : local < treeFrac * 0.82 ? 1 : 2;
        const palette = band === 0 ? LEAF_BROAD : band === 1 ? LEAF_MIXED : LEAF_CONIF;
        const hex = palette[Math.floor(rnd() * palette.length)];
        const s = 0.8 + rnd() * 0.75;
        mountainTree(b, x, y - 0.6, z, band, s, hex, rnd() * Math.PI * 2);
        placedTrees++;
        if (placedTrees % 60 === 0) await new Promise<void>((r) => setTimeout(r, 0));
      }
      if (placedTrees >= treeCount) break;
    }
    rep.trees[m.name] = placedTrees;
    // 近景取证点取"最高的那片密林"（山脚密林拍不出花木分带）
    let gBest = groveCenters[0];
    for (const g of groveCenters) if (!gBest || g.y > gBest.y) gBest = g;
    rep.groves[m.name] = gBest ? [gBest.x, gBest.y, gBest.z] : [m.x, m.h * 0.4, m.z];

    // 林下灌丛：每片密林 55 丛（~72 面/丛），填掉乔木之间的裸地
    let shrubs = 0;
    for (const c of groveCenters) {
      for (let k = 0; k < 55; k++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 150;
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        const y = surfaceAt(x, z);
        if (y < m.h * 0.03 || y > site.treeLine) continue;
        if (slopeAt(surfaceAt, x, z, 30) > 1.6) continue;
        // 灌丛 1.1–2.2 倍（0.7–0.8 倍的只有脚踝高，近景读成一粒黑点）
        mountainShrub(b, x, y - 0.3, z, LEAF_MIXED[Math.floor(rnd() * LEAF_MIXED.length)], 1.1 + rnd() * 1.1, rnd() * Math.PI * 2);
        shrubs++;
      }
    }
    rep.shrubs[m.name] = shrubs;

    // 五色花丛：12 片，每片同色 9 丛 —— 成片而不是均匀撒点。
    // 前 6 片直接压在密林中心：保证"山腰近景"一定拍得到五色花丛与花木同框。
    let patches = 0, bushes = 0;
    for (let g = 0; g < groveCenters.length && patches < 6; g++) {
      const c = groveCenters[g];
      const cHex = FLOWER_COLORS[patches % FLOWER_COLORS.length];
      for (let k = 0; k < 9; k++) {
        const aa = rnd() * Math.PI * 2, rr2 = Math.sqrt(rnd()) * 60;
        const fx = c.x + Math.cos(aa) * rr2, fz = c.z + Math.sin(aa) * rr2;
        const fy = surfaceAt(fx, fz);
        mountainFlowerBush(b, fx, fy - 0.2, fz, cHex, 0.85 + rnd() * 0.6, rnd() * Math.PI * 2);
        bushes++;
      }
      patches++;
    }
    for (const maxSlope of [0.62, 1.35]) {
      for (let p = patches; p < 12; p++) {
        const cHex = FLOWER_COLORS[p % FLOWER_COLORS.length];
        for (let tries = 0; tries < 24; tries++) {
          const a = rnd() * Math.PI * 2, rr = m.r * (0.3 + rnd() * 0.55);
          const cx = m.x + Math.cos(a) * rr, cz = m.z + Math.sin(a) * rr;
          const cy = surfaceAt(cx, cz);
          if (cy < m.h * 0.05 || cy > site.treeLine * 0.85) continue;
          if (slopeAt(surfaceAt, cx, cz, 30) > maxSlope) continue;
          if (Math.hypot(cx - site.summit.x, cz - site.summit.z) < 120) continue;
          for (let k = 0; k < 9; k++) {
            const aa = rnd() * Math.PI * 2, rr2 = Math.sqrt(rnd()) * 95;
            const fx = cx + Math.cos(aa) * rr2, fz = cz + Math.sin(aa) * rr2;
            const fy = surfaceAt(fx, fz);
            mountainFlowerBush(b, fx, fy - 0.2, fz, cHex, 0.8 + rnd() * 0.7, rnd() * Math.PI * 2);
            bushes++;
          }
          patches++;
          break;
        }
      }
      if (patches >= 10) break;
    }
    rep.flowers[m.name] = bushes;

    // 溪流 + 瀑布（泰山/华山/天山指定瀑布；其余山只走溪流）
    const pts = traceStream(site, surfaceAt, rnd);
    const len = buildStreamRibbon(b, pts, rnd);
    rep.streams[m.name] = Math.round(len);
    if (site.waterfall) {
      const cliff = findCliff(site, surfaceAt);
      if (cliff) {
        buildWaterfall(b, cliff, rnd, surfaceAt);
        rep.waterfalls.push({ mountain: m.name, drop: Math.round(cliff.drop), at: [cliff.top.x, cliff.top.y, cliff.top.z] });
      }
    }
    await new Promise<void>((r) => setTimeout(r, 0));

    // 点景
    buildSignaturePiece(b, site, surfaceAt, rnd);

    // 神兽锚点：峰顶附近 / 山腰密林 / 溪畔
    const plan = FAUNA_PLAN[m.name] ?? ['crane', 'deer', 'qilin'];
    const spots: { x: number; z: number }[] = [];
    const half = m.r * 0.05;
    spots.push({ x: site.summit.x + half, z: site.summit.z + half * 0.6 });
    spots.push({ x: groveCenters[1] ? groveCenters[1].x : m.x + m.r * 0.3, z: groveCenters[1] ? groveCenters[1].z : m.z + m.r * 0.2 });
    spots.push({ x: pts[Math.min(6, pts.length - 1)]?.x ?? m.x, z: pts[Math.min(6, pts.length - 1)]?.z ?? m.z + m.r * 0.5 });
    for (let k = 0; k < 3; k++) {
      const sp = spots[k];
      const y = surfaceAt(sp.x, sp.z);
      const kind = plan[k % plan.length];
      const s = kind === 'tiger' || kind === 'qilin' ? 2.6 : kind === 'deer' ? 2.9 : 2.4;
      mountainFaunaAnchors.push({ x: sp.x, y: y + (kind === 'crane' ? 1.2 * s : 0), z: sp.z, kind, ry: rnd() * Math.PI * 2, s });
      rep.fauna[m.name] = (rep.fauna[m.name] ?? 0) + 1;
      rep.faunaTotal++;
    }
    await new Promise<void>((r) => setTimeout(r, 0));
    void heightAt;
  }
  rep.tris = Math.max(0, triOf() - t0);
  lifeReport = rep;
  if (typeof window !== 'undefined') (window as unknown as { __mtnLifeStats?: MountainLifeReport }).__mtnLifeStats = rep;
  return rep;
}

// ---- 神兽神鸟造型（WindBatch，1 draw call；神化比例 2.4–2.9 倍，3km 外仍能凭剪影辨认） ----
function beastCrane(w: WindBatch, a: FaunaAnchor): void {
  const { x, y, z, s } = a;
  const ry = a.ry, ca = Math.cos(ry), sa = Math.sin(ry);
  w.plant(y, y + 3.6 * s, a.ry);
  for (const off of [-0.4, 0.4]) w.cyl(0.05 * s, 0.07 * s, 1.5 * s, 4, x + ca * off * s, y + 0.75 * s, z - sa * off * s, 0x2a2e34);
  w.sphere(0.9 * s, 7, x, y + 1.95 * s, z, 0xe8eef2, ry, 0, 0, 1.35, 0.9, 0.78);
  for (const sd of [-1, 1]) {
    w.box(0.5 * s, 0.5 * s, 1.5 * s, x + ca * sd * 0.8 * s, y + 2.05 * s, z - sa * sd * 0.8 * s, 0xdbe4ea, ry, 0, sd * 0.25);
  }
  w.cyl(0.13 * s, 0.3 * s, 1.5 * s, 5, x + ca * 0.6 * s, y + 2.95 * s, z - sa * 0.6 * s, 0xe8eef2, 0, 0.32, 0);
  w.sphere(0.26 * s, 5, x + ca * 0.85 * s, y + 3.75 * s, z - sa * 0.85 * s, 0xeef3f5);
  w.cyl(0.015 * s, 0.08 * s, 0.6 * s, 4, x + ca * 1.05 * s, y + 3.7 * s, z - sa * 1.05 * s, 0xffb300, ry + Math.PI / 2);
  w.sphere(0.1 * s, 4, x + ca * 0.9 * s, y + 3.95 * s, z - sa * 0.9 * s, 0xff3b30);
  for (let k = 0; k < 3; k++) {
    w.box(0.16 * s, 0.7 * s, 0.2 * s, x - ca * (0.9 + k * 0.15) * s, y + 2.2 * s - k * 0.1 * s, z + sa * (0.9 + k * 0.15) * s, 0xcfdae2, ry, 0.5, 0);
  }
}

function beastDeer(w: WindBatch, a: FaunaAnchor): void {
  const { x, y, z, s } = a;
  const ry = a.ry, ca = Math.cos(ry), sa = Math.sin(ry);
  w.plant(y, y + 3.2 * s, a.ry);
  for (const [ox, oz] of [[-0.45, 0.55], [0.45, 0.55], [-0.45, -0.55], [0.45, -0.55]] as const) {
    w.cyl(0.08 * s, 0.1 * s, 1.5 * s, 4, x + ca * ox * s - sa * oz * s, y + 0.75 * s, z - sa * ox * s - ca * oz * s, 0xd8d2c2);
  }
  w.sphere(0.9 * s, 6, x, y + 2.0 * s, z, 0xe4ded0, ry, 0, 0, 1.3, 0.85, 0.7);
  w.cyl(0.12 * s, 0.22 * s, 1.0 * s, 5, x + ca * 0.95 * s, y + 2.65 * s, z - sa * 0.95 * s, 0xe4ded0, 0, 0.4, 0);
  w.sphere(0.3 * s, 5, x + ca * 1.2 * s, y + 3.15 * s, z - sa * 1.2 * s, 0xe8e2d4, ry, 0, 0, 1.25, 0.95, 0.8);
  // 鹿角：两枝分叉
  for (const sd of [-1, 1]) {
    w.cyl(0.035 * s, 0.05 * s, 0.95 * s, 4, x + ca * 1.2 * s + Math.cos(ry + sd) * 0.16 * s, y + 3.72 * s, z - sa * 1.2 * s + Math.sin(ry + sd) * 0.16 * s, 0x6a5a44, 0, 0.4, sd * 0.5);
    w.cyl(0.03 * s, 0.04 * s, 0.5 * s, 4, x + ca * 1.05 * s + Math.cos(ry + sd) * 0.4 * s, y + 3.95 * s, z - sa * 1.05 * s + Math.sin(ry + sd) * 0.4 * s, 0x6a5a44, 0, -0.5, sd * 0.8);
  }
  w.box(0.14 * s, 0.4 * s, 0.14 * s, x - ca * 0.95 * s, y + 2.1 * s, z + sa * 0.95 * s, 0xe4ded0, ry, 0.5, 0);
}

function beastTiger(w: WindBatch, a: FaunaAnchor): void {
  const { x, y, z, s } = a;
  const ry = a.ry, ca = Math.cos(ry), sa = Math.sin(ry);
  w.plant(y, y + 3.0 * s, a.ry);
  for (const [ox, oz] of [[-0.45, 0.6], [0.45, 0.6], [-0.45, -0.6], [0.45, -0.6]] as const) {
    w.cyl(0.1 * s, 0.13 * s, 1.2 * s, 4, x + ca * ox * s - sa * oz * s, y + 0.6 * s, z - sa * ox * s - ca * oz * s, 0xd97a2a);
  }
  w.sphere(0.95 * s, 6, x, y + 1.6 * s, z, 0xd97a2a, ry, 0, 0, 1.35, 0.8, 0.72);
  for (let k = 0; k < 6; k++) { // 虎斑
    const t = -0.7 + k * 0.28;
    w.box(0.9 * s, 0.1 * s, 0.16 * s, x + ca * t * s, y + 2.05 * s, z - sa * t * s, 0x2a1c12, ry);
  }
  w.sphere(0.42 * s, 5, x + ca * 1.1 * s, y + 2.2 * s, z - sa * 1.1 * s, 0xe08a34, ry, 0, 0, 1.1, 0.95, 1.0);
  w.cyl(0.06 * s, 0.1 * s, 1.6 * s, 4, x - ca * 1.1 * s, y + 1.9 * s, z + sa * 1.1 * s, 0xc86a22, 0, 0.9, 0);
  for (const sd of [-1, 1]) w.box(0.14 * s, 0.14 * s, 0.08 * s, x + ca * 1.2 * s + Math.cos(ry + sd) * 0.2 * s, y + 2.5 * s, z - sa * 1.2 * s + Math.sin(ry + sd) * 0.2 * s, 0x2a1c12, ry);
}

function beastQilin(w: WindBatch, a: FaunaAnchor): void {
  const { x, y, z, s } = a;
  const ry = a.ry, ca = Math.cos(ry), sa = Math.sin(ry);
  w.plant(y, y + 3.4 * s, a.ry);
  for (const [ox, oz] of [[-0.5, 0.6], [0.5, 0.6], [-0.5, -0.6], [0.5, -0.6]] as const) {
    w.cyl(0.11 * s, 0.15 * s, 1.5 * s, 4, x + ca * ox * s - sa * oz * s, y + 0.75 * s, z - sa * ox * s - ca * oz * s, 0xb88a4a);
    w.box(0.24 * s, 0.16 * s, 0.3 * s, x + ca * ox * s - sa * oz * s, y + 0.08 * s, z - sa * ox * s - ca * oz * s, 0x8a6a2a);
  }
  w.sphere(1.0 * s, 6, x, y + 2.0 * s, z, 0xc89a58, ry, 0, 0, 1.3, 0.85, 0.75);
  for (let k = 0; k < 3; k++) w.cyl(0.12 * s, 0.2 * s, 0.5 * s, 4, x + ca * (-0.5 + k * 0.5) * s, y + 2.85 * s, z - sa * (-0.5 + k * 0.5) * s, 0xffcf5e);
  w.sphere(0.42 * s, 5, x + ca * 1.2 * s, y + 2.5 * s, z - sa * 1.2 * s, 0xd4a866, ry, 0, 0, 1.1, 0.95, 1.05);
  w.cyl(0.05 * s, 0.14 * s, 0.9 * s, 4, x + ca * 1.25 * s, y + 3.3 * s, z - sa * 1.25 * s, 0xffcf5e, 0, -0.35, 0);
  w.cyl(0.06 * s, 0.1 * s, 1.9 * s, 4, x - ca * 1.2 * s, y + 2.3 * s, z + sa * 1.2 * s, 0xffcf5e, 0, 0.7, 0);
  for (let k = 0; k < 4; k++) w.box(0.18 * s, 0.5 * s, 0.22 * s, x + ca * (-0.45 + k * 0.3) * s, y + 2.9 * s, z - sa * (-0.45 + k * 0.3) * s, 0xff7a2d);
}

function beastQingluan(w: WindBatch, a: FaunaAnchor): void {
  const { x, y, z, s } = a;
  const ry = a.ry, ca = Math.cos(ry), sa = Math.sin(ry);
  w.plant(y, y + 3.4 * s, a.ry);
  w.sphere(0.85 * s, 6, x, y + 2.1 * s, z, 0x3f9a92, ry, 0, 0, 1.25, 0.85, 0.75);
  // 展开的双翼
  for (const sd of [-1, 1]) {
    w.box(2.0 * s, 0.18 * s, 1.1 * s, x + ca * sd * 1.2 * s, y + 2.35 * s, z - sa * sd * 1.2 * s, 0x4fb0a2, ry, 0, sd * 0.35);
    for (let k = 0; k < 3; k++) w.box(0.35 * s, 0.1 * s, 0.9 * s - k * 0.2 * s, x + ca * sd * (1.9 + k * 0.25) * s, y + 2.45 * s, z - sa * sd * (1.9 + k * 0.25) * s, 0x62c4b2, ry, 0, sd * (0.45 + k * 0.12));
  }
  w.sphere(0.32 * s, 5, x + ca * 0.95 * s, y + 2.75 * s, z - sa * 0.95 * s, 0x54b8aa, ry, 0, 0, 1.1, 0.95, 1.1);
  w.cyl(0.02 * s, 0.07 * s, 0.5 * s, 4, x + ca * 1.15 * s, y + 2.7 * s, z - sa * 1.15 * s, 0xffcf5e, ry + Math.PI / 2);
  for (let k = 0; k < 3; k++) w.box(0.12 * s, 0.14 * s, 0.7 * s, x + ca * 0.9 * s, y + 2.95 * s + k * 0.1 * s, z - sa * 0.9 * s, 0xffcf5e, ry, 0.2, 0);
  // 长尾羽三根
  for (let k = 0; k < 3; k++) {
    w.box(0.16 * s, 0.1 * s, 2.6 * s, x - ca * (1.2 + k * 0.3) * s, y + 2.0 * s - k * 0.15 * s, z + sa * (1.2 + k * 0.3) * s, k === 1 ? 0x2f7f78 : 0x54b8aa, ry, 0.12, 0);
  }
}

export function buildMountainFauna(w: WindBatch): number {
  let n = 0;
  for (const a of mountainFaunaAnchors) {
    switch (a.kind) {
      case 'crane': beastCrane(w, a); break;
      case 'deer': beastDeer(w, a); break;
      case 'tiger': beastTiger(w, a); break;
      case 'qilin': beastQilin(w, a); break;
      default: beastQingluan(w, a); break;
    }
    n++;
  }
  return n;
}
