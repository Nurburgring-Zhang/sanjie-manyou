import * as THREE from 'three';
import { Baker, shade } from '../city/bake';
import { RNG } from '../core/rng';

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

export interface WindFloraReport { tris: number; plants: number; drawCalls: number; species: Record<string, number> }
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
  windFloraReport.plants = Object.values(species).reduce((a, b) => a + b, 0);
  windFloraReport.drawCalls = 1;
  windFloraReport.species = species;
  return windFloraReport;
}
