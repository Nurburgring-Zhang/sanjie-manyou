import * as THREE from 'three';
import { RNG } from '../core/rng';
import { Baker, SignMesher, SignAtlas, shade, roofProfile } from './bake';
import { Plot, WALL_X, GATE_Z, H_STREETS, streetPlots, inLandmarkKeepout } from './layout';
import { buildLandmarkInteriors } from './interiors';
import { buildDetailedEave, buildDetailedFacade } from './detailKit';
import { buildGatePalaceFittings, buildDevotionalWorks } from './architecture';
// 只读取坊心与路廊判据（imperial → buildings 已是既有单向环，本文件只在函数体内调用，不参与模块初始化）
import { wardCells, roadBlocked, wardReserved } from './imperial';

// ============ 配色 ============
/** 三界调色板——对齐 docs/assets/44-材质色彩总谱.md（CJ 人间本体/NH 霓虹/DF 地府） */
export const C = {
  woodRed: 0xa63a2b, // CJ-07 市井朱
  woodDark: 0x4a3220, // CJ-05 桐油深褐
  wood: 0x6b4a2b, // CJ-04 梁木褐
  plaster: 0xe8e4da, // CJ-06 灰泥白
  plaster2: 0xd8cbaa, // CJ-01 汴京土黄（亮端）
  stone: 0x87847a, // 青石 M-08
  tile: 0x333a45, // CJ-03 瓦灰黑（配合屋面贴图改为明暗调制：贴图不再自带底色）
  tile2: 0x3f4752, // 瓦灰黑亮端（剪边瓦）
  ridge: 0x272d36, // 正脊玄端
  winGlow: 0xffc66e, // CJ-26 灯笼暖黄 2700K
  lantern: 0xff5a3c,
  neonCyan: 0x00e5ff, // NH-01 官霓·电青（官方，常亮）
  neonMag: 0xff2e88, // NH-02 商霓·桃红（商业，2Hz 可闪）
  neonGold: 0xffb300, // 金饰/欢门主灯
  neonGreen: 0x8fd45f, // NH-04 工霓·黄绿（原 0xb8ff2e 纯荧光，檐口灯带远看像一块塑料板，降饱和）
  neonPurple: 0x8a2be2, // NH-03 玄霓·电紫（玄门/纸马铺）
  neonOrange: 0xff9e00, // NH-05 食霓·琥珀（食肆，呼吸 0.5Hz）
  wallGray: 0x5a6472, // CJ-02 青砖灰
  field: 0x5a6e3f, road: 0x8a7f6a, earth: 0x8f7f63, // 街道加深与地坪出对比
  ghostGreen: 0x3dff9c, // DF-01 磷绿（地府专用光色，人间禁用）
  ghostBlue: 0x4d7cff, // DF-02 幽蓝冥火
};

/** 街屋三色阶：按 idx 轮转，避免整条街只有两种墙色/三种屋面。shade() 在线性空间相乘，档位按实测 sRGB 拉开 */
const WALL_TONES = [C.plaster, C.plaster2, shade(C.plaster, 0.86), shade(C.plaster2, 0.8), shade(C.plaster2, 0.7)];
const WOOD_TONES = [C.woodRed, shade(C.woodRed, 0.68), C.wood, shade(C.wood, 1.35), C.woodDark];
const ROOF_TONES = [C.tile, C.tile2, shade(C.tile2, 1.35), shade(C.tile, 0.78), shade(C.ridge, 2.4)];

// ============ 单体宋式建筑 ============
interface BuildOpt {
  x: number; z: number; ry: number; w: number; d: number;
  floors: number; ornate?: boolean; neon?: number;
  signText?: string; signColor?: string; signGlow?: string; signBg?: string;
  winGlow?: boolean; roofC?: number; wallC?: number; woodC?: number;
  /** 形制：shop 店铺 / house 民居 / tavern 酒肆 / teahouse 茶坊 / manor 宅院 / gate 牌楼 / shed 草棚 */
  kind?: string;
  /** 是否已有手工室内壳（interiors.ts 的 9 座）：true 跳过通用室内衬。缺省 false = 补通用衬 */
  hasInterior?: boolean;
}

/** 曲面反宇屋檐的檐口点（局部系）：t=1 处 h=0.5、y=H·(0.16+0.15u²)，与 bake 的 ring(1) 同式 */
function eavePoint(axis: 'z' | 'x', s: number, u: number, sw: number, sd: number, H: number): [number, number, number] {
  const yy = H * (0.16 + 0.15 * u * u);
  const lat = u * 0.5;
  return axis === 'z' ? [lat * sw, yy, s * 0.5 * sd] : [s * 0.5 * sw, yy, lat * sd];
}

/**
 * 连续檐口环（连檐 + 滴水唇）：沿曲面 t=1 的檐口折线逐段铺，取代原来 4 条直箱。
 * 直箱跨在反宇檐口上时两端必然翘起/下陷（剖面 y 从檐中的 0.16H 抬到角上的 0.31H），
 * 四角两条箱体还各按自己的边长收头，交接处错台——街面看就是「檐口被啃掉几块」。
 * 每边 SEG 段：连檐 2 面 + 滴水 2 面，四边合计 4·SEG·4 面，与旧 8 箱 + 8 滴基本持平。
 */
export function eaveRingOn(b: Baker, x: number, y: number, z: number, ry: number, sw: number, sd: number, H: number, hex: number): void {
  const SEG = 10;
  const fh = Math.max(0.16, Math.min(0.34, H * 0.1));
  const pos: number[] = [];
  const quad = (a: number[], b2: number[], c: number[], d: number[]): void => {
    pos.push(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2]);
    pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  };
  for (const axis of ['z', 'x'] as const) {
    for (const s of [1, -1] as const) {
      for (let i = 0; i < SEG; i++) {
        const u0 = -1 + (2 * i) / SEG, u1 = -1 + (2 * (i + 1)) / SEG;
        const a = eavePoint(axis, s, u0, sw, sd, H), b2 = eavePoint(axis, s, u1, sw, sd, H);
        // ① 连檐：檐口外皮往下 fh 的一道板
        quad(a, b2, [b2[0], b2[1] - fh, b2[2]], [a[0], a[1] - fh, a[2]]);
        // ② 滴水唇：再外挑 0.1、下垂 0.2，把檐口收成一条压得住的深色厚边
        const o = 0.1, drop = 0.2;
        const oa: [number, number, number] = axis === 'z' ? [a[0], a[1] - fh, a[2] + s * o] : [a[0] + s * o, a[1] - fh, a[2]];
        const ob: [number, number, number] = axis === 'z' ? [b2[0], b2[1] - fh, b2[2] + s * o] : [b2[0] + s * o, b2[1] - fh, b2[2]];
        quad([a[0], a[1] - fh, a[2]], [b2[0], b2[1] - fh, b2[2]], ob, oa);
        quad(oa, ob, [ob[0], ob[1] - drop, ob[2]], [oa[0], oa[1] - drop, oa[2]]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  b.addGeo('roof', geo, x, y, z, shade(hex, 0.7), ry);
}

/**
 * 连续垂脊带：沿角线（u=±1）整条铺一段，取代「沿角线摆 steps 个方块」。
 * 方块之间留缝、每块又按自己的朝向转，街面 20m 处读成一排锯齿；连续带把脊线锁成一条。
 * 每段 4 面（顶面 2 + 外侧面 2），4 条垂脊 × SEG 段。
 */
function hipRibbonOn(b: Baker, x: number, y: number, z: number, ry: number, SW: number, SD: number, H: number, hex: number): void {
  const SEG = 10, RIDGE_F = 0.16, KICK = 0.16, CORNER = 0.15;
  const hAt = (t: number): number => RIDGE_F + (0.5 - RIDGE_F) * Math.pow(t, 1.6);
  const yAt = (t: number): number => H * (roofProfile(t) + KICK * Math.pow(t, 3) + CORNER * t * t);
  const pos: number[] = [];
  const quad = (a: number[], b2: number[], c: number[], d: number[]): void => {
    pos.push(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2]);
    pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  };
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const pt = (t: number): [number, number, number] => {
        const f = hAt(t);
        return [sx * f * SW, yAt(t), sz * f * SD];
      };
      // 水平面内的法向（垂直于角线的水平切线）
      const dirAt = (t: number): [number, number] => {
        const f = hAt(t);
        const dx = sx * f * SW, dz = sz * f * SD;
        const L = Math.hypot(dx, dz) || 1;
        return [-dz / L, dx / L];
      };
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        const p0 = pt(t0), p1 = pt(t1);
        // 带宽随 t 收细：正脊端 0.34 → 檐角 0.22（宋式垂脊本来就往角上收）
        const w0 = 0.34 - 0.12 * t0, w1 = 0.34 - 0.12 * t1;
        const d0 = dirAt(t0), d1 = dirAt(t1);
        const top = (p: number[], d2: number[], wid: number): [number[], number[]] => {
          const hw = wid / 2;
          const l: [number, number, number] = [p[0] + d2[0] * hw, p[1] + 0.20, p[2] + d2[1] * hw];
          const r: [number, number, number] = [p[0] - d2[0] * hw, p[1] + 0.20, p[2] - d2[1] * hw];
          return [l, r];
        };
        const [l0, r0] = top(p0, d0, w0);
        const [l1, r1] = top(p1, d1, w1);
        quad(l0, l1, r1, r0);                                   // 顶面
        quad(r0, r1, [p1[0], p1[1] - 0.06, p1[2]], [p0[0], p0[1] - 0.06, p0[2]]); // 外侧面
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  b.addGeo('roof', geo, x, y, z, shade(hex, 0.72), ry);
}

/**
 * 瓦垄灯带：把一整条通长发光条切成「灯管 + 暗段」。
 * 旧实现是 o.w*0.9 一根不断开的条，远看是一条横贯整栋的紫/绿绸带（用户三次投诉的那条）。
 * 宋式檐灯本来就是逐盏挂的，段长 2.6m、间距 3.2m 才是灯。
 */
function lampRun(b: Baker, len: number, at: (lx: number) => [number, number], y: number, color: number, ry: number, axis: 'x' | 'z'): void {
  const TUBE = 2.6, PITCH = 3.2;
  const n = Math.max(1, Math.floor(len / PITCH));
  const span = n * PITCH - (PITCH - TUBE);
  if (span > len) {
    const [gx, gz] = at(0);
    const L = Math.max(0.8, len * 0.86);
    b.box('glow', axis === 'x' ? L : 0.08, 0.08, axis === 'x' ? 0.08 : L, gx, y, gz, color, ry);
    return;
  }
  const off = (len - span) / 2;
  for (let i = 0; i < n; i++) {
    const lx = off + i * PITCH - len / 2 + TUBE / 2;
    const [gx, gz] = at(lx);
    b.box('glow', axis === 'x' ? TUBE : 0.08, 0.08, axis === 'x' ? 0.08 : TUBE, gx, y, gz, color, ry);
  }
}

/** 歇山/庑殿顶（四棱台近似）+ 霓虹檐边 */
export function roofOn(b: Baker, w: number, d: number, y: number, x: number, z: number, ry: number, tileC: number, neon?: number, hOverride?: number): void {
  const h = hOverride ?? Math.min(w, d) * 0.2 + 0.45;
  const sw = w * 0.905, sd = d * 0.905;
  // 曲面单元的实际檐口 = ±0.5×(sw×1.02)、正脊平顶 = ±0.16×(sw×1.02)。
  // 旧版正脊按 sw×0.39 画，是平顶宽度的 2.4 倍：屋脊两端（连同鸱吻）悬在坡面上方 2m+，
  // 牌楼这种 d=2.9 的窄屋顶更极端——脊比屋顶进深还长。这里统一以单元平顶为唯一依据。
  const SW = sw * 1.02, SD = sd * 1.02;
  const H = h * 1.06;
  const RIDGE_F = 0.16;                       // = bake.ts RIDGE_HALF（未导出，同值）
  const KICK = 0.16, CORNER = 0.15;           // = bake.ts UNIT_KICK / CORNER_RISE（未导出，同值）
  const hAt = (t: number): number => RIDGE_F + (0.5 - RIDGE_F) * Math.pow(t, 1.6);
  // 角线（u=±1）上的曲面高度：角部同时吃到檐口上挑与起翘，必须与 bake 的 ring() 同式
  const hipY = (t: number): number => H * (roofProfile(t) + KICK * Math.pow(t, 3) + CORNER * t * t);
  // 曲面反宇屋顶（单一连续曲面：脊陡坡缓+檐口上挑+角部起翘），替换三层棱台
  // 第 12 个参数 rib=true：让 roofC 按 worldW 烘瓦垄顶点色条纹（贴图在这里必被 mip 抹平）
  b.roofC('roof', x, y, z, tileC, ry, SW, H, SD, 0, 0, true);
  // 檐口（连檐 + 滴水）：曲面屋顶收到檐边时厚度归零，仰视/侧视整片屋顶会消失成一条线。
  // 用**连续檐口环**（沿曲面 t=1 折线逐段）替代 4 条直箱：直箱跨在反宇檐口上必翘/必陷，
  // 四角还各按自己的边长收头，交接处错台——街面看就是「檐口被啃掉几块」。
  eaveRingOn(b, x, y, z, ry, SW, SD, H, tileC);
  b.kit('roof.eaveFascia', 8, y);
  // 粗垄不再铺箱体。真正的瓦垄（0.34m 一垄）已由 roofC 的顶点色条纹按世界尺度烘在曲面上，
  // 这里再铺 3.2m 一根、0.95m 宽的直箱反而读成"压在瓦面上的横梁"：
  // 直箱弦线在上凸曲面上必然抬高，水平顶面正对天光，30m 级屋顶实测是一排白梁（相国寺）。
  // 保留 kit 计数语义（数量按原公式记，供资产清单核对），几何交给 roofC。
  if (Math.min(w, d) >= 14 && w <= 60) {
    const ribs = Math.max(5, Math.min(64, Math.round(w / 3.2)));
    b.kit('roof.tileRib', ribs * 2, y + H * 0.5);
  }
  // 四条垂脊：贴住曲面的角线（u=±1），从正脊平顶四角落到檐角。
  // 旧版只给 w>60 的宫殿铺，且参数化用 s 而非 s^1.6，脊点不在角线上——街屋四坡顶因此只有
  // 一条正脊"浮"在瓦面上，没有任何一条脊落在两坡交线。现在所有 roofOn 屋顶统一铺。
  // 且从「沿角线摆方块」改成**连续脊带**：方块之间的缝在街面 20m 处读成一排锯齿。
  hipRibbonOn(b, x, y, z, ry, SW, SD, H, tileC);
  {
    const hipLen = Math.hypot(0.34 * SW, 0.34 * SD, H);
    const steps = Math.max(4, Math.min(96, Math.round(hipLen / 1.1)));
    b.kit('roof.hipRidge', steps * 4, y + H * 0.5);
  }
  // 正脊 + 两端鸱吻（沿屋脊方向）：长度严格等于曲面单元的正脊平顶（±0.16·SW）
  const rlx = Math.cos(ry), rlz = -Math.sin(ry);
  const ridgeHalf = RIDGE_F * SW;
  b.box('roof', ridgeHalf * 2, 0.2, 0.42, x, y + H + 0.04, z, C.ridge, ry);
  for (const e of [-1, 1]) {
    b.box('roof', 0.5, 0.95, 0.55, x + rlx * e * ridgeHalf, y + H + 0.5, z + rlz * e * ridgeHalf, C.ridge, ry, 0, e * 0.18); // 鸱吻
  }
  b.box('roof', 0.34, 0.52, 0.34, x + rlx * ridgeHalf * 0.72, y + H + 0.24, z + rlz * ridgeHalf * 0.72, C.ridge, ry, 0, 0.45);
  b.box('roof', 0.34, 0.52, 0.34, x - rlx * ridgeHalf * 0.72, y + H + 0.24, z - rlz * ridgeHalf * 0.72, C.ridge, ry, 0, -0.45);
  // 四角翘角：贴住檐角（sw/2, sd/2）而不是 0.707 倍外推到空中，高度取檐口而不是脊顶
  const hw = sw * 0.5 - 0.16, hd = sd * 0.5 - 0.16;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  for (const [ox, oz, dir] of [[-hw, -hd, -1], [hw, -hd, 1], [-hw, hd, 1], [hw, hd, -1]] as const) {
    const wx = x + ox * cosr + oz * sinr, wz = z - ox * sinr + oz * cosr;
    b.box('roof', 0.5, 0.14, 0.24, wx, y + 0.16, wz, C.ridge, ry + dir * 0.39, 0, dir * 0.5);
  }
  // 檐口封板已移除（建筑密集时呈线状噪声）；墙顶延伸已保证结构连续
  // 檐口霓虹灯带（四边，贴檐口外缘）
  if (neon !== undefined) {
    // 灯管化：整条通长的 0.1m 方条在 20m 以上的檐口上远看是一条"绿绸带"。改成每 3.2m 一段、
    // 段长 2.6m 的短灯管，两端各坐一个 0.18m 灯座（metal 深色）；两灯管之间正好 0.6m 暗段
    //（0.18 灯座 + 0.24 空隙 + 0.18 灯座），灯管才读成"灯"而不是"带"。
    // 对位曲面檐口外缘（曲面底面 y=0，边长 sw×sd）
    const exF = (sd / 2) * 0.99, exS = (sw / 2) * 0.99, ln = 0.1;
    const TUBE = 2.6, PITCH = 3.2, CAP = 0.18, CAP_W = ln * 1.35;
    const at = (lx: number, lz: number): [number, number] => [x + lx * cosr + lz * sinr, z - lx * sinr + lz * cosr];
    // 沿一条檐边均布灯管，返回每段的 [起点, 长度]（起点以边中点为 0）
    const runs = (L: number): [number, number][] => {
      const n = Math.max(1, Math.floor(L / PITCH));
      const span = n * PITCH - (PITCH - TUBE); // n 段灯管 + (n-1) 个 0.6m 暗段
      if (span > L) return [[0, Math.max(0.8, L * 0.86)]]; // 短檐不足一段：单段居中收短
      const off = (L - span) / 2, out: [number, number][] = [];
      for (let i = 0; i < n; i++) out.push([off + i * PITCH - L / 2, TUBE]);
      return out;
    };
    const capHex = shade(0x3f444b, 0.9);
    // 灯管必须坐在**檐口曲线上**：反宇檐口 t=1 处 y = H·(0.16 + 0.15u²)，u 为沿边归一化坐标。
    // 旧版一律放 y+0.05（= 曲面的底面），实测比檐口低 0.16H（2.6m 举高就是 0.37m），
    // 灯带整条悬在檐下空气里——「檐下一条横贯整栋的紫条」就是这么来的。
    const eaveY = (u: number): number => H * (0.16 + 0.15 * u * u);
    let tubes = 0;
    for (const s of [-1, 1]) {
      for (const [t0, tl] of runs(sw * 0.99)) { // 两条长边（沿本地 x）
        const lx = t0 + tl / 2;
        const u = lx / Math.max(1e-3, sw * 0.5);
        const [gx, gz] = at(lx, s * exF);
        b.box('glow', tl, ln, ln, gx, y + eaveY(u) + 0.02, gz, neon, ry);
        for (const e of [-1, 1]) {
          const [bx, bz] = at(lx + e * (tl / 2 + CAP / 2), s * exF);
          b.box('metal', CAP, CAP_W, CAP_W, bx, y + eaveY(u) + 0.02, bz, capHex, ry);
        }
        tubes++;
      }
      for (const [t0, tl] of runs(sd * 0.99)) { // 两条短边（沿本地 z）
        const lz = t0 + tl / 2;
        const u = lz / Math.max(1e-3, sd * 0.5);
        const [gx, gz] = at(s * exS, lz);
        b.box('glow', ln, ln, tl, gx, y + eaveY(u) + 0.02, gz, neon, ry);
        for (const e of [-1, 1]) {
          const [bx, bz] = at(s * exS, lz + e * (tl / 2 + CAP / 2));
          b.box('metal', CAP_W, CAP_W, CAP, bx, y + eaveY(u) + 0.02, bz, capHex, ry);
        }
        tubes++;
      }
    }
    b.kit('eave.lampTube', tubes, y);
  }
  buildDetailedEave(b, {
    x, y, z, w, d, ry, roofC: tileC,
    // neon 不再传给 detailKit：roofOn 自己已经在四条檐边各铺了「2.6m 灯管 + 0.6m 暗段」，
    // detailKit 的 neon 是**一条 0.9w 通长不间断的条**，两条叠在同一檐口上，
    // 结果通长条盖住灯管间隙，整栋读成一条紫/绿绸带。只保留分段灯管这一条真源。
    neon: undefined,
    tier: w * d >= 150 || neon !== undefined ? 'near' : 'mid',
  });
}

// ============ W9 建筑形制分型：六种形制 + 通用室内衬 ============
// 缘起：buildBuilding 原来对 shop/house/tavern/teahouse/manor 全部用「方体主体 + roofOn 四坡顶 +
// 同一组立面装饰」，整条街俯瞰是一片同款屋脊。本段按 kind + 尺寸 + 层数分派形制，各有自己的
// 屋面、出檐与檐口做法。三条纪律：
//  ① 只新增独立函数，不动 roofOn 的签名与既有行为；
//  ② 不新增材质、不改 C 常量、不新增 b.kit() id（本段一次 kit 都不调）；
//  ③ 全部用 b.box / 既有 roofC，单件 12 面，面数可逐件核算。
type Form = 'gable' | 'shopfront' | 'pavilion' | 'hall' | 'gateframe' | 'shed' | 'hip';
type MatG = 'wood' | 'wall' | 'ash' | 'earth' | 'roof' | 'ground' | 'glow' | 'metal' | 'ceramic' | 'fabric' | 'lacquer';

/** 形制分派：只读 o.kind / o.w / o.d / o.floors / o.ornate，调用方入参语义不变 */
function pickForm(o: BuildOpt, hasInterior: boolean): Form {
  const kind = o.kind ?? 'shop';
  if (kind === 'gate' || o.w < 5) return 'gateframe';                    // 牌楼 / 门楼：无主体墙
  if (kind === 'shed' || o.w < 6) return 'shed';                         // 草棚：单坡 + 三面席墙
  if (o.floors >= 2 && o.w >= 10) return 'pavilion';                     // 楼阁：整圈腰檐 + 平座
  if (o.ornate || (kind === 'manor' && o.w >= 14)) return 'hall';        // 五脊殿：垂脊 + 大鸱吻
  if (kind === 'shop' && o.d >= 9 && o.floors === 1 && !hasInterior) return 'shopfront'; // 前店后宅：两段不同高
  if ((kind === 'house' || kind === 'manor') && o.w < 12) return 'gable'; // 悬山民居
  return 'hip';                                                          // 余下：既有四坡顶
}

/**
 * 斜面板：箱体局部 X = 下坡方向、Y = 法线、Z = 檐向。
 * rx 必须恒为 0 —— three 的 Euler('XYZ') 是 Rx·Ry·Rz，rx=0 时才退化成 Ry·Rz，坡度只能靠 rz 表达。
 * 若把坡度写进 rx（既有 roofOn 的瓦垄就是这么写的，且注释已承认被瓦面埋住），ry=π 的一侧会把坡上下翻
 * （实测 Euler(0.4, π, 0) 把 +Z 转到 (0, +0.389, -0.921)）。rot：π/2 = 檐向沿面阔，0 = 檐向沿进深。
 */
function pane(b: Baker, g: MatG, x: number, z: number, ry: number, lx: number, y: number, lz: number,
  downSlope: number, alongEave: number, thick: number, rot: number, tilt: number, hex: number): void {
  const wx = x + Math.cos(ry) * lx + Math.sin(ry) * lz;
  const wz = z - Math.sin(ry) * lx + Math.cos(ry) * lz;
  b.box(g, downSlope, thick, alongEave, wx, y, wz, hex, ry + rot, 0, tilt);
}

/** 山花 / 山面填充：3 级梯级，每级顶宽收在该高度处的屋面容宽内（步进填充，永不穿出瓦面） */
function gableFillOn(b: Baker, g: MatG, x: number, z: number, ry: number, lx: number, baseY: number, h: number,
  halfAt: (f: number) => number, hex: number): void {
  const steps: [number, number][] = [[0.3, 0.94], [0.58, 0.9], [0.84, 0.86]];
  for (const [f, k] of steps) {
    const halfZ = Math.max(0.4, halfAt(f) * k);
    const wx = x + Math.cos(ry) * lx;
    const wz = z - Math.sin(ry) * lx;
    b.box(g, 0.18, h * f, halfZ * 2, wx, baseY + (h * f) / 2, wz, hex, ry);
  }
}

/**
 * 两坡屋面的**瓦垄坡面**：一整片四边形，按 0.34m 垄距把瓦垄明暗烘进顶点色。
 * 旧版每坡只铺 4 道「通长脊筋」——0.34m 垄距被扔掉，4 根 0.15m 细条在 20m 外读不出来，
 * 两坡因此退化成两块灰板。列数按世界面阔算，垄距与 roofC 的 RIB_PITCH 同一口径。
 * 顶点写在屋面局部系里（y 从 0=檐口 到 h=正脊），落位由 addGeo 的 y 参数补。
 */
export function gableSlopeRibbed(b: Baker, x: number, y: number, z: number, ry: number,
  hw: number, hd: number, h: number, s: number, hex: number): void {
  const K = Math.max(8, Math.round((2 * hw) / 0.34));
  const pos: number[] = [];
  const col: number[] = [];
  const ribAt = (lx: number): number => 1.0 + 0.22 * Math.cos((lx * Math.PI * 2) / 0.34);
  const vert = (lx: number, ly: number, lz: number, c: number): void => {
    pos.push(lx, ly, lz);
    col.push(c, c, c);
  };
  for (let i = 0; i < K; i++) {
    const lx0 = -hw + (2 * hw * i) / K, lx1 = -hw + (2 * hw * (i + 1)) / K;
    const c0 = ribAt(lx0), c1 = ribAt(lx1);
    // 脊（lz=0, ly=h）→ 檐（lz=s·hd, ly=0）
    vert(lx0, h, 0, c0); vert(lx1, h, 0, c1); vert(lx1, 0, s * hd, c1);
    vert(lx0, h, 0, c0); vert(lx1, 0, s * hd, c1); vert(lx0, 0, s * hd, c0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  b.addGeo('roof', geo, x, y, z, hex, ry);
}

/**
 * 悬山两坡：一条正脊 + 前后两坡。屋面挑出山墙 0.35m（檩头外露，悬山标志），
 * 檐口平直、无四角起翘，两端砌山花把这坡下的三角空腔封住。
 */
function gableRoofOn(b: Baker, w: number, d: number, y: number, x: number, z: number, ry: number,
  tileC: number, wallC: number, neon?: number, hOverride?: number): void {
  const hw = w / 2 + 0.35, hd = d / 2 + 0.55;
  const h = hOverride ?? Math.min(w, d) * 0.26 + 0.55;
  const a = Math.atan2(h, hd), len = Math.hypot(h, hd);
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  for (const s of [-1, 1] as const) {
    // 前后两坡（直坡，不做反宇与起翘）：瓦垄 0.34m 一垄烘进顶点色，
    // 替代旧版「4 道通长脊筋」——4 根 0.15m 细条在街面距离上读成一整块灰板。
    gableSlopeRibbed(b, x, y, z, ry, hw, hd, h, s, shade(tileC, s > 0 ? 1.04 : 0.94));
    // 檐口平直：连檐 + 滴水一道通长
    const [ex, ez] = at(0, s * hd);
    b.box('roof', hw * 2, 0.16, 0.36, ex, y - 0.04, ez, shade(tileC, 0.7), ry);
    b.box('roof', hw * 2, 0.1, 0.18, ex, y - 0.16, ez, shade(tileC, 0.5), ry);
    // 椽头：檐下 4 根
    for (let i = 0; i < 4; i++) {
      const lx = (-0.66 + 0.44 * i) * hw;
      const [rx2, rz2] = at(lx, s * (hd - 0.22));
      b.box('wood', 0.14, 0.15, 0.46, rx2, y - 0.14, rz2, shade(C.woodDark, 1.06), ry);
    }
  }
  // 博风板：两端沿坡边一条压板，把「屋面挑出山墙」的悬山收头交代清楚
  for (const sx of [-1, 1] as const) {
    for (const s of [-1, 1] as const) {
      pane(b, 'wood', x, z, ry, sx * (hw - 0.06), y + h / 2 + 0.09, (s * hd) / 2, len, 0.3, 0.12,
        Math.PI / 2, s * a, shade(C.woodDark, 1.12));
    }
  }
  // 正脊（一条通长）+ 两端小收头（悬山不做鸱吻）
  b.box('roof', hw * 2 + 0.14, 0.26, 0.46, x, y + h + 0.07, z, C.ridge, ry);
  for (const s of [-1, 1] as const) {
    const [px, pz] = at(s * (hw - 0.16), 0);
    b.box('roof', 0.3, 0.36, 0.5, px, y + h + 0.14, pz, C.ridge, ry);
  }
  // 檩头：山墙外露的檩子端头（两坡各 2 根 × 两端，出挑 0.35）
  for (const sx of [-1, 1] as const) {
    for (const s of [-1, 1] as const) {
      for (let k = 0; k < 2; k++) {
        const t = 0.32 + k * 0.34;
        const [px, pz] = at(sx * (w / 2 + 0.14), s * hd * t);
        b.box('wood', 0.4, 0.15, 0.15, px, y + h * (1 - t) - 0.08, pz, shade(C.woodDark, 0.92), ry);
      }
    }
  }
  // 山墙外露：两端山花（墙顶 0.12 之上起，避开与外墙共面）
  for (const sx of [-1, 1] as const) {
    gableFillOn(b, 'wall', x, z, ry, sx * (w / 2 - 0.09), y + 0.12, h - 0.12,
      (f) => Math.min(d / 2 - 0.2, hd * (1 - f)), shade(wallC, 0.94));
  }
  if (neon !== undefined) {
    // 檐灯分段（旧版 w*0.9 一根通长条，街面看是一条横贯整栋的绸带）
    lampRun(b, w * 0.94, (lx) => at(lx, hd + 0.02), y + 0.02, neon, ry, 'x');
  }
}

/**
 * 五脊殿（庑殿）：曲面四坡 + 一条正脊 + 四条垂脊 + 两条戗脊，正脊两端鸱吻放大到 1.2m。
 * 曲面沿用 roofC（与 roofOn 同一套 s 参数），垂脊沿曲面分段贴；±x 山面用 3 级山花封住开口。
 */
function hipHallRoofOn(b: Baker, w: number, d: number, y: number, x: number, z: number, ry: number,
  tileC: number, neon?: number, hOverride?: number): void {
  const h = hOverride ?? Math.min(w, d) * 0.26 + 0.6;
  const sw = w * 0.905, sd = d * 0.905, H = h * 1.06;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  b.roofC('roof', x, y, z, tileC, ry, sw * 1.02, H, sd * 1.02, 0, 0, true);
  // 连檐 + 滴水一圈：同 roofOn，用连续檐口环代替 4 条直箱（直箱在反宇檐口上必错台）
  eaveRingOn(b, x, y, z, ry, sw * 1.02, sd * 1.02, H, tileC);
  // 四条垂脊：沿曲面的角线（u=±1），t 从正脊平顶端点到檐角，逐段贴面。
  // 旧版参数化用 t 而非 t^1.6，脊点落在瓦面中间；且下面另铺了 8 段"戗脊"，横坐标固定
  // 在 0.2·sw——不在角线上，只是散落在坡面上的方块。庑殿只有"一正脊 + 四垂脊"共五脊，
  // 故删掉那 8 段错位方块，把四条垂脊改到真实角线。再改成连续脊带（方块间留缝 = 锯齿）。
  const hipLen = Math.hypot(0.34 * sw * 1.02, 0.34 * sd * 1.02, H);
  const steps = Math.max(4, Math.min(96, Math.round(hipLen / 1.1)));
  hipRibbonOn(b, x, y, z, ry, sw * 1.02, sd * 1.02, H, tileC);
  b.kit('roof.hipRidge', steps * 4, y + H * 0.5);
  // ±x 山面：3 级山花封口（板壁，避免大面积 wall 组泛蓝灰）
  for (const sx of [-1, 1] as const) {
    gableFillOn(b, 'wood', x, z, ry, sx * sw * 0.19, y + 0.1, H * 0.9,
      (f) => sd * (0.16 + 0.34 * Math.pow(Math.max(0.02, 1 - f), 0.625)) * 0.92, shade(C.woodDark, 0.92));
  }
  // 正脊 + 鸱吻 1.2m（两端各一，含卷尾）
  const rlx = Math.cos(ry), rlz = -Math.sin(ry);
  // 正脊长度严格等于曲面平顶（±0.16×檐口半跨），旧值 0.26·sw 会让脊端与鸱吻悬出坡面
  const ridgeHalf = 0.16 * sw * 1.02;
  b.box('roof', ridgeHalf * 2, 0.22, 0.46, x, y + H + 0.05, z, C.ridge, ry);
  for (const e2 of [-1, 1] as const) {
    const px = x + rlx * e2 * ridgeHalf, pz = z + rlz * e2 * ridgeHalf;
    b.box('roof', 0.52, 1.2, 0.62, px, y + H + 0.6, pz, C.ridge, ry, 0, e2 * 0.16);
    b.box('roof', 0.34, 0.4, 0.5, px - rlx * e2 * 0.22, y + H + 1.18, pz - rlz * e2 * 0.22, C.ridge, ry, 0, e2 * 0.5);
  }
  // 四角翘角（贴住檐角，高度取檐口）
  const hwx = sw * 0.5 - 0.16, hdz = sd * 0.5 - 0.16;
  for (const [ox, oz, dir] of [[-hwx, -hdz, -1], [hwx, -hdz, 1], [-hwx, hdz, 1], [hwx, hdz, -1]] as const) {
    const [px, pz] = at(ox, oz);
    b.box('roof', 0.5, 0.14, 0.24, px, y + 0.16, pz, C.ridge, ry + dir * 0.39, 0, dir * 0.5);
  }
  if (neon !== undefined) {
    // 檐灯按段挂（2.6m 灯管 + 0.6m 暗段），旧版是 sw*0.9 一根通长条——远看就是一条绸带。
    for (const s of [-1, 1] as const) {
      lampRun(b, sw * 0.94, (lx) => at(lx, s * sd * 0.495), y + H * 0.16 + 0.02, neon, ry, 'x');
    }
  }
  // detailKit 的通长 neon 条不再叠（roofOn/hipHallRoofOn 已有分段灯管，两条叠一起会读成绸带）
  buildDetailedEave(b, { x, y, z, w, d, ry, roofC: tileC, neon: undefined, tier: 'near' });
}

/**
 * 楼阁腰檐 + 平座：腰檐是完整一圈四坡（外挑 0.95、下坡 0.32），不是 0.28m 腰线板；
 * 平座是挑出 0.8m 的木平台 + 勾阑（寻杖 + 蜀柱），落在腰檐内沿之上，不穿出檐口。
 */
function waistRingOn(b: Baker, w: number, d: number, y: number, x: number, z: number, ry: number,
  tileC: number, woodC: number): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const out = 0.95, drop = 0.32, po = 0.8;
  const a = Math.atan2(drop, out), len = Math.hypot(out, drop);
  // ① 腰檐整圈：前后坡（檐向沿面阔）+ 两山坡（檐向沿进深），四角互搭
  for (const s of [-1, 1] as const) {
    pane(b, 'roof', x, z, ry, 0, y - drop / 2, s * (d / 2 + out / 2), len, w + out * 2, 0.18, Math.PI / 2, s * a,
      shade(tileC, 1.06));
    pane(b, 'roof', x, z, ry, s * (w / 2 + out / 2), y - drop / 2, 0, len, d + out * 2, 0.18, 0, -s * a,
      shade(tileC, 1.0));
    const [fx, fz] = at(0, s * (d / 2 + out));
    b.box('roof', w + out * 2, 0.16, 0.22, fx, y - drop - 0.05, fz, shade(tileC, 0.68), ry);
    const [gx, gz] = at(s * (w / 2 + out), 0);
    b.box('roof', 0.22, 0.16, d + out * 2, gx, y - drop - 0.05, gz, shade(tileC, 0.68), ry);
  }
  // ② 平座：挑出 0.8 的木平台一圈 + 勾阑（外沿寻杖两道 + 蜀柱）
  for (const s of [-1, 1] as const) {
    const [px, pz] = at(0, s * (d / 2 + po / 2));
    b.box('wood', w + po * 2, 0.16, po, px, y + 0.06, pz, shade(woodC, 0.86), ry);
    const [qx, qz] = at(s * (w / 2 + po / 2), 0);
    b.box('wood', po, 0.16, d + po * 2, qx, y + 0.06, qz, shade(woodC, 0.86), ry);
    const [rx1, rz1] = at(0, s * (d / 2 + po - 0.06));
    b.box('wood', w + po * 2 - 0.12, 0.09, 0.09, rx1, y + 0.66, rz1, shade(C.woodRed, 1.06), ry);
    b.box('wood', w + po * 2 - 0.12, 0.07, 0.07, rx1, y + 0.42, rz1, shade(C.woodRed, 0.94), ry);
    for (let i = 0; i < 4; i++) {
      const lx = (-0.42 + 0.28 * i) * (w + po * 2);
      const [ux, uz] = at(lx, s * (d / 2 + po - 0.06));
      b.box('wood', 0.09, 0.66, 0.09, ux, y + 0.35, uz, C.woodRed, ry);
    }
    const [sx1, sz1] = at(s * (w / 2 + po - 0.06), 0);
    b.box('wood', 0.09, 0.09, d + po * 2 - 0.12, sx1, y + 0.66, sz1, shade(C.woodRed, 1.06), ry);
    b.box('wood', 0.07, 0.07, d + po * 2 - 0.12, sx1, y + 0.42, sz1, shade(C.woodRed, 0.94), ry);
    for (let i = 0; i < 3; i++) {
      const lz = (-0.34 + 0.34 * i) * (d + po * 2);
      const [ux, uz] = at(s * (w / 2 + po - 0.06), lz);
      b.box('wood', 0.09, 0.66, 0.09, ux, y + 0.35, uz, C.woodRed, ry);
    }
  }
}

/**
 * 前店后宅屋顶：前 2/3 单坡（低）+ 后 1/3 两坡悬山（高），
 * 接缝处后段前脸是一道矮墙（0.93m，压瓦顶），两段屋顶高差从这里读出来。
 */
function shopfrontRoofOn(b: Baker, o: BuildOpt, bodyTop: number, roofC: number, woodC: number, wallC: number,
  neon?: number): void {
  const { x, z, ry, w, d } = o;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const seam = d / 2 - (2 * d) / 3;   // = -d/6：前段与后段分界
  const highY = bodyTop + 0.75;       // 前段单坡在接缝侧的高边
  const eaveZ = d / 2 + 0.55;
  const drop = 0.65;
  const z0 = seam - 0.25, z1 = eaveZ;
  const run = z1 - z0;
  const a = Math.atan2(drop, run);
  const [fx, fz] = at(0, (z0 + z1) / 2);
  // ① 前段单坡：脊侧高、檐口低，压住敞开的铺面。
  // 旧版是一整片素板 + 3 道装饰脊筋（0.34m 垄距完全没有），俯视就是一整块灰板；
  // 这里换成带瓦垄顶点色的坡面（与悬山同一套 0.34m 垄距），坡顶落在接缝、坡脚落在檐口。
  {
    const [sx0, sz0] = at(0, z0);
    gableSlopeRibbed(b, sx0, highY - drop, sz0, ry, (w + 0.3) / 2, run, drop, 1, shade(roofC, 1.02));
  }
  const [ex, ez] = at(0, z1);
  b.box('roof', w + 0.3, 0.16, 0.32, ex, highY - drop - 0.02, ez, shade(roofC, 0.7), ry);
  for (let i = 0; i < 4; i++) {
    const [rx2, rz2] = at((-0.6 + 0.4 * i) * (w / 2), z1 - 0.24);
    b.box('wood', 0.14, 0.14, 0.44, rx2, highY - drop - 0.08, rz2, shade(C.woodDark, 1.06), ry);
  }
  if (neon !== undefined) lampRun(b, w * 0.9, (lx) => at(lx, eaveZ), highY - drop + 0.03, neon, ry, 'x');
  // ② 后段升高：三面矮墙（后 + 左右）+ 接缝矮墙，抬到 backTop
  const backTop = bodyTop + 1.05;
  const wallH = backTop - (bodyTop + 0.12);
  const wY = (bodyTop + 0.12 + backTop) / 2;
  const segD = seam + d / 2;
  {
    const [bx, bz] = at(0, -(d / 2 - 0.09));
    b.box('wall', w, wallH, 0.18, bx, wY, bz, shade(wallC, 0.96), ry);
    for (const s2 of [-1, 1] as const) {
      const [px, pz] = at(s2 * (w / 2 - 0.09), (seam - d / 2) / 2);
      b.box('wall', 0.18, wallH, Math.max(1.2, segD), px, wY, pz, shade(wallC, 0.96), ry);
    }
    const [sx2, sz2] = at(0, seam);
    b.box('wall', w, backTop - bodyTop, 0.22, sx2, (bodyTop + backTop) / 2, sz2, shade(wallC, 0.9), ry);
    b.box('roof', w + 0.3, 0.16, 0.6, sx2, backTop + 0.06, sz2, shade(roofC, 1.02), ry);
  }
  // ③ 后段两坡悬山（高于前段）
  const bd = Math.max(2.4, d / 3 - 0.4);
  const [gx2, gz2] = at(0, -d / 3 - 0.2);
  gableRoofOn(b, w + 0.3, bd, backTop, gx2, gz2, ry, shade(roofC, 1.04), wallC, undefined, undefined);
}

/** 牌楼 / 门楼：2–4 根柱 + 一道楼顶 + 匾额，没有主体墙（所以不落台基、不做室内衬） */
function gateFrameOn(b: Baker, sg: SignMesher, atlas: SignAtlas, o: BuildOpt, idx: number): void {
  const { x, z, ry, w, d } = o;
  const woodC = o.woodC ?? C.woodDark;
  const roofC = o.roofC ?? C.tile;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const H = Math.min(7.0, 4.4 + w * 0.26);
  const xs = w >= 7 ? [-w / 2 + 0.45, -w * 0.17, w * 0.17, w / 2 - 0.45] : [-w / 2 + 0.45, w / 2 - 0.45];
  for (const lx of xs) {
    const [px, pz] = at(lx, 0);
    b.box('ash', 0.72, 0.3, 0.72, px, 0.15, pz, 0x8b867a, ry);          // 柱础
    b.box('ash', 0.5, 0.62, 0.5, px, 0.55, pz, 0x82806f, ry);           // 夹杆石
    b.box('wood', 0.34, H - 0.86, 0.34, px, 0.86 + (H - 0.86) / 2, pz, shade(woodC, 1.0), ry);
    b.box('wood', 0.62, 0.18, 0.5, px, H - 0.55, pz, shade(C.woodRed, 0.98), ry); // 小斗
    // 戗柱（朝内斜撑）
    const t2 = lx > 0 ? -1 : 1;
    const [cx2, cz2] = at(lx + t2 * 0.5, 0.42);
    b.box('wood', 0.13, 1.7, 0.13, cx2, 0.8, cz2, shade(woodC, 0.9), ry, 0, t2 * 0.4);
  }
  // 额枋两道 + 花板 + 匾额
  const [bx, bz] = at(0, 0);
  b.box('wood', w + 0.6, 0.3, 0.42, bx, H - 0.3, bz, shade(C.woodRed, 1.02), ry);
  b.box('wood', w + 0.3, 0.16, 0.5, bx, H - 0.02, bz, shade(C.woodRed, 0.88), ry);
  const pw = Math.min(w * 0.62, 4.6);
  b.box('lacquer', pw, 0.9, 0.22, bx, H - 1.0, bz, shade(C.woodDark, 1.04), ry);
  b.box('wood', pw + 0.3, 0.1, 0.3, bx, H - 1.5, bz, shade(C.neonGold, 0.45), ry);
  if (o.signText) {
    const [sx2, sz2] = at(0, 0.14);
    sg.quad(atlas.text(`sign${idx}`, o.signText, 512, 144, {
      color: o.signColor ?? '#ffe9c8', glow: o.signGlow, bg: o.signBg ?? 'rgba(12,10,18,0.88)',
      border: o.signGlow ?? 'rgba(255,179,0,0.8)', fontPx: 104,
    }), pw, (pw * 144) / 512, sx2, H - 1.0, sz2, ry);
  }
  // 楼顶：小悬山压在额枋上
  const rd = Math.min(3.4, Math.max(2.2, d));
  gableRoofOn(b, w + 1.0, rd, H + 0.02, x, z, ry, roofC, o.wallC ?? C.plaster, o.neon, 1.15);
  if (o.neon !== undefined) {
    const [gx2, gz2] = at(0, rd / 2 + 0.6);
    lampRun(b, w * 0.86, (lx) => at(lx, rd / 2 + 0.6), H - 0.02, o.neon, ry, 'x');
  }
}

/** 草棚：单坡顶 + 三面席墙 + 无窗，屋面用 fabric 组苇席色 0xd4b76a */
function shedOn(b: Baker, o: BuildOpt): void {
  const { x, z, ry, w, d } = o;
  const MAT = 0xd4b76a;   // 苇席（与 45 卷勾栏席棚同色，不改 C）
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const wallH = 2.45, sideH = 1.55, backY = 2.78, drop = 0.9;
  const [px0, pz0] = at(0, 0);
  b.box('earth', w + 0.5, 0.22, d + 0.5, px0, 0.11, pz0, 0x8f7f63, ry);          // 夯土台基
  // 三面席墙（后墙顶到单坡后檐，侧墙压到前檐以下，否则会从坡面戳出去）
  const [bx, bz] = at(0, -(d / 2 - 0.1));
  b.box('fabric', w, wallH, 0.1, bx, 0.22 + wallH / 2, bz, shade(MAT, 0.94), ry);
  for (const s2 of [-1, 1] as const) {
    const [qx, qz] = at(s2 * (w / 2 - 0.1), 0);
    b.box('fabric', 0.1, sideH, d, qx, 0.22 + sideH / 2, qz, shade(MAT, 0.9), ry);
  }
  // 单坡顶：后高前低（苇席），檐口一道压边
  const run = d + 0.7;
  const a = Math.atan2(drop, run);
  pane(b, 'fabric', x, z, ry, 0, backY - drop / 2, 0, Math.hypot(run, drop), w + 0.7, 0.09, Math.PI / 2, a, MAT);
  for (let i = 0; i < 2; i++) {
    const lz = (-0.25 + 0.5 * i) * d;
    pane(b, 'fabric', x, z, ry, 0, backY - drop / 2 - 0.09, lz, Math.hypot(run, drop) * 0.9, 0.1, 0.06,
      Math.PI / 2, a, shade(MAT, 0.82));
  }
  const [ex, ez] = at(0, run / 2);
  b.box('fabric', w + 0.7, 0.12, 0.18, ex, backY - drop - 0.04, ez, shade(MAT, 0.88), ry);
  for (const s2 of [-1, 1] as const) {
    const [cx2, cz2] = at(s2 * (w / 2 - 0.14), run / 2 - 0.1);
    const pH = backY - drop - 0.26;   // 前柱顶压到前檐下，不戳出苇席
    b.box('wood', 0.14, pH, 0.14, cx2, 0.22 + pH / 2, cz2, C.woodDark, ry);
  }
}

/**
 * 通用室内衬（每座 ≤ 40 件 / 非铺面 15 件 ≈180 面，铺面 20 件 ≈240 面）：
 * 地坪 + 后墙内壁 + 一盏吊灯 + 一桌二凳（铺面再补一组货架）。
 * 只解决「从门洞看进去是纯黑空腔」；梁架与陈设细节留给 interiors.ts 的 9 座手工壳。
 */
function genericInteriorOn(b: Baker, o: BuildOpt, wallC: number, woodC: number, kind: string): void {
  const { x, z, ry, w, d, floors } = o;
  const bodyH = floors * 3.2;
  const bodyTop = 0.6 + bodyH;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const isHouse = kind === 'house' || kind === 'manor';
  // ① 地坪（民居夯土 / 余下木地板，厚 0.06）
  {
    const [px, pz] = at(0, 0);
    if (isHouse) b.box('earth', w - 0.5, 0.06, d - 0.5, px, 0.63, pz, 0x9a8a6c, ry);
    else b.box('wood', w - 0.5, 0.06, d - 0.5, px, 0.63, pz, shade(woodC, 0.74), ry);
  }
  // ② 后墙内壁：比 0.18 厚外壳的内皮再内缩 0.12（不与外壳共面），wall 组压暗 0.72
  {
    const [px, pz] = at(0, -(d / 2 - 0.18 - 0.12 - 0.04));
    b.box('wall', w - 0.7, bodyH - 0.3, 0.08, px, 0.6 + (bodyH - 0.3) / 2, pz, shade(wallC, 0.72), ry);
  }
  // ③ 吊灯：木杆 + 0.22×0.3×0.22 灯罩，房间中心偏后
  {
    const [px, pz] = at(0, -d * 0.12);
    b.box('wood', 0.06, 0.46, 0.06, px, bodyTop - 0.31, pz, shade(C.woodDark, 0.9), ry);
    b.box('glow', 0.22, 0.3, 0.22, px, bodyTop - 0.69, pz, C.winGlow, ry);
  }
  // ④ 一桌二凳（桌面 1.2×0.75×0.6，凳 0.35 见方，腿高按宋式 0.42/0.72）
  const tw = Math.min(1.2, w * 0.32), td = Math.min(0.6, d * 0.18);
  const tbX = -w * 0.1, tbZ = d * 0.06;
  {
    const [px, pz] = at(tbX, tbZ);
    b.box('wood', tw, 0.07, td, px, 1.38, pz, shade(woodC, 1.12), ry);
    for (const sx2 of [-1, 1] as const) {
      for (const sz2 of [-1, 1] as const) {
        const [lx2, lz2] = at(tbX + sx2 * (tw / 2 - 0.09), tbZ + sz2 * (td / 2 - 0.09));
        b.box('wood', 0.07, 0.72, 0.07, lx2, 1.02, lz2, shade(C.woodDark, 0.9), ry);
      }
    }
    for (const s2 of [-1, 1] as const) {
      const stX = tbX + s2 * (tw / 2 + 0.42);
      const [sx3, sz3] = at(stX, tbZ + 0.16);
      b.box('wood', 0.35, 0.06, 0.35, sx3, 1.08, sz3, shade(woodC, 0.98), ry);
      for (const t2 of [-1, 1] as const) {
        const [lx3, lz3] = at(stX + t2 * 0.12, tbZ + 0.16);
        b.box('wood', 0.05, 0.42, 0.31, lx3, 0.87, lz3, shade(C.woodDark, 0.86), ry);
      }
    }
  }
  // ⑤ 铺面：后墙一组货架（3 层薄板 + 两侧板）
  if (kind === 'shop' || kind === 'tavern' || kind === 'teahouse') {
    const sw2 = Math.min(2.0, w * 0.55), sd2 = 0.34;
    const shelZ = -(d / 2 - 0.18 - 0.12 - 0.04 - 0.2);
    for (const s2 of [-1, 1] as const) {
      const [px, pz] = at(s2 * (sw2 / 2 - 0.03), shelZ);
      b.box('wood', 0.06, 1.7, sd2, px, 1.51, pz, shade(C.woodDark, 0.95), ry);
    }
    for (let i = 0; i < 3; i++) {
      const [px, pz] = at(0, shelZ);
      b.box('wood', sw2, 0.05, sd2, px, 1.11 + i * 0.5, pz, shade(woodC, 1.0), ry);
    }
  }
}

/** 斗拱带：檐下斗栱（栌斗+华拱+泥道拱+散斗），沿面阔均布 —— 宋式木构标志 */
export function dougongBand(b: Baker, cx: number, cy: number, cz: number, w: number, ry: number, color: number): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const bays = Math.max(3, Math.round(w / 1.6));
  for (let i = 0; i <= bays; i++) {
    const lx = -w / 2 + (w * i) / bays;
    const wx = cx + lx * cosr, wz = cz - lx * sinr;
    b.box('wood', 0.42, 0.22, 0.42, wx, cy, wz, color, ry);
    b.box('wood', 0.3, 0.14, 0.72, wx, cy + 0.18, wz + 0.3 * cosr, color, ry);
    b.box('wood', 0.9, 0.13, 0.26, wx, cy + 0.32, wz, color, ry);
    b.box('wood', 0.2, 0.1, 0.2, wx - 0.42 * cosr, cy + 0.44, wz + 0.42 * sinr, color, ry);
    b.box('wood', 0.2, 0.1, 0.2, wx + 0.42 * cosr, cy + 0.44, wz - 0.42 * sinr, color, ry);
  }
  b.box('wood', w, 0.28, 0.2, cx, cy - 0.3, cz, shade(color, 0.85), ry);
}

/** 直棂窗：竖棂密排（宋式典型窗），内透暖光 */
export function zhilingWindow(b: Baker, cx: number, cy: number, cz: number, w: number, h: number, ry: number, lit: boolean): void {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  // 局部 +z 偏移必须同时投影到 x/z 两个世界轴，否则 ry=π 的一面窗会把光心和棂条甩到墙背面
  const at = (lx: number, lz: number): [number, number] => [cx + lx * cosr + lz * sinr, cz - lx * sinr + lz * cosr];
  const [bx, bz] = at(0, -0.02);
  b.box('wood', w + 0.14, h + 0.14, 0.08, bx, cy, bz, 0x1c130c, ry); // 暗框内凹底
  b.box('wood', w, h, 0.12, cx, cy, cz, C.woodDark, ry);
  if (lit) {
    const [gx, gz] = at(0, 0.05);
    b.box('glow', w - 0.16, h - 0.16, 0.06, gx, cy, gz, C.winGlow, ry);
  }
  const slats = Math.max(3, Math.round(w / 0.2));
  for (let i = 1; i < slats; i++) {
    const lx = -w / 2 + (w * i) / slats;
    const [sx, sz] = at(lx, 0.09);
    b.box('wood', 0.06, h - 0.14, 0.06, sx, cy, sz, C.woodDark, ry);
  }
}

export function buildBuilding(b: Baker, sg: SignMesher, atlas: SignAtlas, o: BuildOpt, idx: number): void {
  const { x, z, ry, w, d, floors } = o;
  const hasInterior = o.hasInterior === true;   // 已有手工室内壳（interiors.ts 的 9 座）
  const form = pickForm(o, hasInterior);        // W9 形制分派：见文件上方的 pickForm
  const kind = o.kind ?? 'shop';
  const frontOpen = form === 'shopfront';        // 前店后宅：前半 2/3 敞开
  const bodyH = floors * 3.2;
  const wallC = o.wallC ?? WALL_TONES[idx % 5];
  const roofC = o.roofC ?? ROOF_TONES[idx % 5];
  const woodC = o.woodC ?? WOOD_TONES[idx % 5];
  const neon = o.neon;
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const face = (dz: number): [number, number] => [x + sin * dz, z + cos * dz];
  const doorW = Math.min(2.6, w * 0.32); // 既有门宽语义（立面门扇与开窗过滤都用它）
  const openW = Math.min(2.4, Math.max(1.6, doorW)); // 门洞净宽（≥1.6），对准既有门位（局部 x=0）
  const openH = 2.2; // 门洞净高（≥2.2）
  const doorHead = 0.6 + openH; // 门楣底 = 2.8
  const winW = 1.15, winH = 1.35, winSill = 0.6 + 1.15; // 窗洞 1.15×1.35，下沿离地 1.15

  // 0) 形制分流：牌楼/门楼与草棚都没有「主体墙 + 空腔」，单独成体，不参与壳体、立面与室内衬
  if (form === 'gateframe') {
    gateFrameOn(b, sg, atlas, o, idx);
    return;
  }
  if (form === 'shed') {
    shedOn(b, o);
    return;
  }

  // 1) 台基
  b.box('wall', w + 1.4, 0.6, d + 1.4, x, 0.3, z, C.stone);

  // 2) 主体：四面墙 + 闷顶的空腔壳体（原为单一实心体，室内被完全挡住；壳体在 2b 段拼装）
  //    墙顶仍向上延伸 0.8m 伸入屋顶内部填补金字塔开口，外轮廓与旧实心体逐面一致
  const bodyTop = 0.6 + bodyH;
  // 墙裙：贴图里画不出「只在墙根」的砖砌——UV 按 0.24/m 平铺，一堵 10m 墙会把贴图重复 2.4 次，
  // 墙裙就变成满墙横条。改成一圈 0.9m 高的石裙 + 石压顶线，物理上只在墙根。
  // 正面一段在门洞处断开：0.9m 高的石裙若通长，会把门洞下半截（0.6–1.5m）堵死，门口就进不去了。
  {
    const [bkx, bkz] = face(-(d / 2 + 0.04)), [bkx2, bkz2] = face(-(d / 2 + 0.05));
    b.box('ash', w + 0.08, 0.9, 0.12, bkx, 1.05, bkz, 0x8a8272, ry);
    b.box('ash', w + 0.16, 0.1, 0.2, bkx2, 1.52, bkz2, 0x9a9282, ry);
    const [fkx, fkz] = face(d / 2 + 0.04), [fkx2, fkz2] = face(d / 2 + 0.05);
    // 前店后宅的铺面整间敞开：石裙只留两端墙垛，不再按 1.6–2.4m 门洞切一刀
    const gap = frontOpen ? w - 2 * Math.min(1.0, w * 0.14) : openW;
    const sk1 = (w + 0.08 - gap) / 2, sk2 = (w + 0.16 - gap) / 2;
    for (const s2 of [-1, 1]) {
      const lx1 = s2 * (gap / 2 + sk1 / 2), lx2 = s2 * (gap / 2 + sk2 / 2);
      b.box('ash', sk1, 0.9, 0.12, fkx + cos * lx1, 1.05, fkz - sin * lx1, 0x8a8272, ry);
      b.box('ash', sk2, 0.1, 0.2, fkx2 + cos * lx2, 1.52, fkz2 - sin * lx2, 0x9a9282, ry);
    }
  }
  for (const sx of [-1, 1]) {
    b.box('ash', 0.12, 0.9, d + 0.08, x + sx * (w / 2 + 0.04), 1.05, z, 0x8a8272);
    b.box('ash', 0.2, 0.1, d + 0.16, x + sx * (w / 2 + 0.05), 1.52, z, 0x9a9282);
  }
  // 上部收分墙体（屋顶内部，略窄，撑住坡面）：悬山的腔内净空只有 h 高，
  // 收分块压到 0.45h × 0.44d 才不顶穿平直坡面（四坡顶仍按原尺寸）
  {
    // 屋面内的封腔体：不能按「一个长方体」直接塞进去。四坡屋面在 y=0.9H 处的净宽只剩
    // 0.16·跨度（RIDGE_HALF 平顶），旧版 0.6w×0.6d×2.2m 的方块四角从四条坡面上戳出，
    // 近景在脊两侧读成两条浅色墙带。改为三级收分，每级顶面都落在该高度处的屋面容宽内。
    const capD = form === 'gable' ? d * 0.44 : d * 0.5;
    if (form === 'gable') {
      const capH = Math.min(w, d) * 0.12 + 0.1;
      b.box('wall', w * 0.6, capH, capD, x, bodyTop + capH / 2, z, shade(wallC, 0.85));
    } else {
      const H0 = Math.min(w, d) * 0.2 + 0.45;
      const steps: [number, number][] = [[0.30, 0.30], [0.55, 0.23], [0.76, 0.17]];
      let y0 = 0;
      for (const [fh, fw] of steps) {
        const y1 = H0 * fh;
        b.box('wall', w * fw, y1 - y0, d * fw, x, bodyTop + (y0 + y1) / 2, z, shade(wallC, 0.85));
        y0 = y1;
      }
    }
  }
  // 层间腰线 + 挑檐栏杆（二层以上临街平座，宋式勾阑）；楼阁的平座改成整圈，在屋顶段统一做
  if (floors > 1) {
    for (let f = 1; f < floors; f++) {
      const fy = 0.6 + f * bodyH / floors;
      b.box('wood', w + 0.2, 0.28, d + 0.2, x, fy, z, C.woodDark);
      if (form === 'pavilion') continue;
      // 平座栏杆：沿正面（扶手+望柱×5）
      const fz = z + d / 2 + 0.24;
      b.box('wood', w - 0.6, 0.09, 0.09, x, fy + 0.52, fz, shade(C.woodRed, 1.08), ry);
      b.box('wood', w - 0.6, 0.07, 0.07, x, fy + 0.28, fz, shade(C.woodRed, 0.95), ry);
      for (let pp = 0; pp <= 4; pp++) {
        b.box('wood', 0.09, 0.55, 0.09, x - (w - 0.6) / 2 + (w - 0.6) * pp / 4, fy + 0.3, fz, C.woodRed, ry);
      }
    }
  }

  // 3) 正面装饰：按 idx 分 4 型（板壁铺面 / 灰泥民居 / 柜台铺面 / 门第），整条街不再共用一个模板
  const cosR = Math.cos(ry), sinR = Math.sin(ry);
  const lat = (lx: number, lz: number): [number, number] => [x + cosR * lx + sinR * lz, z - sinR * lx + cosR * lz];
  const boxAt = (g: 'wall' | 'wood' | 'roof' | 'fabric' | 'glow' | 'ground' | 'ceramic' | 'metal' | 'lacquer' | 'ash', w2: number, h2: number, d2: number, lx: number, ly: number, lz: number, hex: number, extraRy = 0, rx = 0, rz = 0): void => {
    const [wx, wz] = lat(lx, lz);
    b.box(g, w2, h2, d2, wx, ly, wz, hex, ry + extraRy, rx, rz);
  };
  const faceZ = d / 2 + 0.1;
  const floorH = bodyH / floors;
  const facadeType = (idx % 4) + 1;
  const baysOf = (f: number): number[] => {
    const n = Math.max(1, Math.min(3, Math.round((w - 1.4) / 3.2)));
    const span = Math.max(1, w - 3.0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(n === 1 ? 0 : -span / 2 + (span * i) / (n - 1));
    if (f > 0) return out;
    return out.filter((lx) => Math.abs(lx) >= doorW / 2 + 0.7);
  };
  const litOf = (i: number, f: number): boolean => (i + f + idx) % 3 !== 0;

  // 2b) 空腔壳体拼装：墙厚 0.18 正好是 interiors.ts 内衬墙的外退量（u = w/2-0.3、衬墙厚 0.12），
  //     衬墙外皮 ±(w/2-0.18)/±(d/2-0.18) 与外墙内皮对接，不叠面、不留缝。
  {
    // 墙头只允许高出 bodyTop 0.16m：屋面出檐改为墙外 0.6m 后，檐口在墙面处的瓦面高度
    // 只有 +0.17m（10m×8m 实例），旧值 0.8m 会从前后坡的下段直接戳出屋面。
    // 屋顶内部空腔由上面的三级收分封腔体填充，不再靠墙头堵。
    const t = 0.18, yBot = 0.6;
    const yTop = bodyTop + (form === 'gable' || form === 'shopfront' ? 0.12 : 0.16);
    const yMid = (yBot + yTop) / 2;
    const wh = yTop - yBot, hw = w / 2, hd = d / 2;
    // 后墙 + 左右山墙（山墙角料扣掉前后墙厚，四角不叠面）
    boxAt('wall', w, wh, t, 0, yMid, -(hd - t / 2), wallC);
    for (const s2 of [-1, 1]) boxAt('wall', t, wh, d - 2 * t, s2 * (hw - t / 2), yMid, 0, wallC);
    if (frontOpen) {
      // 前店后宅：前半 2/3 敞开——前墙只剩两端墙垛 + 门楣以上一道通长过梁，中间整间对街开敞
      const pierW = Math.min(1.0, w * 0.14);
      for (const s2 of [-1, 1]) boxAt('wall', pierW, wh, t, s2 * (hw - pierW / 2), yMid, hd - t / 2, wallC);
      boxAt('wall', w - 2 * pierW, yTop - 2.9, t, 0, (2.9 + yTop) / 2, hd - t / 2, wallC);
    } else {
    // 前墙洞口：门（净宽 openW × 净高 openH）+ 一层开间的窗（对齐 baysOf(0) 的窗位）
    const holes: { x0: number; x1: number; y0: number; y1: number }[] = [
      { x0: -openW / 2, x1: openW / 2, y0: yBot, y1: doorHead },
    ];
    for (const lx of baysOf(0)) {
      if (Math.abs(lx) - winW / 2 < openW / 2 + 0.15) continue; // 与门洞之间至少留 0.15 墙垛
      if (Math.abs(lx) + winW / 2 > hw - 0.35) continue; // 不切穿山墙角
      holes.push({ x0: lx - winW / 2, x1: lx + winW / 2, y0: winSill, y1: winSill + winH });
    }
    holes.sort((p, q) => p.x0 - q.x0);
    // 洞口之间的整高墙垛。前墙外皮留在 d/2（= 旧实心体前脸）：墙裙/板壁/装饰柱仍凸出在外，
    // 立面装饰内表面最近处 faceZ-0.03 与墙皮留 0.07 净距，无一被穿透。
    let cur = -hw;
    for (const h0 of holes) {
      if (h0.x0 > cur) boxAt('wall', h0.x0 - cur, wh, t, (cur + h0.x0) / 2, yMid, hd - t / 2, wallC);
      cur = Math.max(cur, h0.x1);
      // 洞口上墙（门楣 / 窗上墙）与下墙（窗下槛墙）
      if (h0.y1 < yTop) boxAt('wall', h0.x1 - h0.x0, yTop - h0.y1, t, (h0.x0 + h0.x1) / 2, (h0.y1 + yTop) / 2, hd - t / 2, wallC);
      if (h0.y0 > yBot) boxAt('wall', h0.x1 - h0.x0, h0.y0 - yBot, t, (h0.x0 + h0.x1) / 2, (yBot + h0.y0) / 2, hd - t / 2, wallC);
    }
    if (cur < hw) boxAt('wall', hw - cur, wh, t, (cur + hw) / 2, yMid, hd - t / 2, wallC);
    }
    // 闷顶板：封住屋顶内腔（屋面在墙内皮处只比 bodyTop 高 ~0.1m，板厚 0.12 居中于 bodyTop 才不会顶穿瓦面）
    boxAt('wall', w - 2 * t, 0.12, d - 2 * t, 0, bodyTop, 0, shade(wallC, 0.9));
  }

  /** 整幅立面面板按门洞切开（左/右两段 + 门楣上方一条）：位置与覆盖范围不变，只让开洞口 */
  const facePanel = (g: 'wood' | 'wall', pw: number, py0: number, py1: number, pz: number, hex: number, pd: number): void => {
    const side = pw / 2 - openW / 2;
    if (side > 0.02) for (const s2 of [-1, 1]) boxAt(g, side, py1 - py0, pd, s2 * (openW / 2 + side / 2), (py0 + py1) / 2, pz, hex);
    if (py1 > doorHead + 0.02) boxAt(g, openW, py1 - doorHead, pd, 0, (doorHead + py1) / 2, pz, hex);
  };

  const LEAF_A = 1.53; // 门扇旋开角 ≈88°：留 2° 虚掩，免与墙面共面
  /** 门扇旋开：铰在门扇自己的边（sgn=+1 表示关着时朝 -x 展开），open=+1 向室内开、-1 向街面开 */
  const leafAt = (g: 'wood' | 'lacquer', hx: number, hz: number, lw2: number, lh: number, ly: number, hex: number, sgn: number, open: number, pd = 0.15): void => {
    const ux = -sgn * Math.cos(LEAF_A), uz = -open * Math.sin(LEAF_A);
    boxAt(g, lw2, lh, pd, hx + (ux * lw2) / 2, ly, hz + (uz * lw2) / 2, hex, Math.atan2(-uz, ux));
  };

  if (frontOpen) {
    // 前店后宅：铺面敞开，立面不放板壁 / 灰泥 / 格窗 / 门扇——檐柱、柜台与挑檐由 3b 的 shop 段承担
  } else if (facadeType === 4) {
    // 型 4 门第：双开板门（门钉 3×6）+ 门簪 + 两侧槛墙
    const gw = Math.min(2.8, w * 0.36), gw2 = gw / 2, lw2 = gw2 - 0.04, leafZ = d / 2 + 0.02;
    // 门扇原为贴墙闭合（会把门洞堵死）：改铰在各自门边、向街面开 88°。
    // 不向内开：室内内衬洞口只有 1.7m 宽，2.8m 宽的双扇向内开会直接撞穿内衬墙。
    const ca = Math.cos(LEAF_A), sa = Math.sin(LEAF_A);
    for (const s2 of [-1, 1]) {
      const segW = Math.max(0.8, (w - gw) / 2 - 0.4);
      boxAt('wall', segW, 1.6, 0.18, (s2 * (gw / 2 + 0.3 + segW / 2)), 1.4, faceZ + 0.04, shade(wallC, 0.94));
      const ux = -s2 * ca, uz = sa, ex = Math.atan2(-uz, ux);
      leafAt('lacquer', s2 * gw2, leafZ, lw2, 2.7, 1.95, shade(C.woodRed, 0.62), s2, -1, 0.12);
      // 门钉跟着门扇一起转：沿扇长 dAlong、门扇外法线 0.08m（原来贴在闭合门扇正面 faceZ+0.16）
      for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 6; c2++) {
        const xs = -gw2 + 0.24 + ((gw - 0.48) * c2) / 5;
        if (Math.sign(xs) !== s2) continue;
        const da = gw2 - Math.abs(xs);
        boxAt('metal', 0.06, 0.06, 0.05, s2 * gw2 + ux * da + Math.sin(ex) * 0.08, 1.32 + r2 * 0.5, leafZ + uz * da + Math.cos(ex) * 0.08, shade(C.neonGold, 0.62), ex);
      }
    }
    b.kit('facade.gateWall', 2);
    b.kit('facade.gateStud', 18, 1.9);
    for (const s2 of [-1, 1]) boxAt('wood', 0.22, 0.22, 0.32, (s2 * gw) / 3, 3.34, faceZ + 0.14, C.woodDark);
    b.kit('facade.gatePin', 2, 3.34);
    for (let f = 1; f < floors; f++) {
      const wy = 0.6 + f * floorH + floorH * 0.5;
      for (const [i, lx] of baysOf(f).entries()) {
        const [wx, wz] = lat(lx, faceZ + 0.14);
        zhilingWindow(b, wx, wy, wz, 1.05, 1.2, ry, litOf(i, f));
      }
    }
  } else {
    // 单开正门（型 4 自带双开板门）：原为贴在 faceZ 的暗色「假门洞」平板，壳体开洞后必须让开通路，
    // 改铰在门扇右边缘、向室内开 88°（宽/高/材质/数量不变，只改姿态）
    leafAt('wood', Math.min(2.0, doorW) / 2, d / 2 - 0.02, Math.min(2.0, doorW), 2.4, 1.8, 0x2a1c12, 1, 1);
    if (facadeType === 1) {
      // 型 1 板壁铺面：深色木板墙 + 直棂窗（整幅板壁按门洞切成左右两段 + 门楣上方一条）
      facePanel('wood', w - 1.0, 0.6, 0.6 + bodyH - 0.9, faceZ + 0.02, shade(woodC, 0.66), 0.1);
      b.kit('facade.plankWall', 1);
      const seams = Math.max(3, Math.min(7, Math.round(w / 1.6)));
      for (let s2 = 1; s2 < seams; s2++) {
        const slx = -w / 2 + 0.5 + ((w - 1.0) * s2) / seams;
        // 落在门洞里的板缝不能悬在洞口正中：改从门楣上起（条数与 x 位置不变，只截短）
        const sTop = bodyH - 0.35, sBot = Math.abs(slx) < openW / 2 + 0.03 ? doorHead : 0.65;
        boxAt('wood', 0.05, sTop - sBot, 0.05, slx, (sTop + sBot) / 2, faceZ + 0.07, shade(woodC, 0.42));
      }
      b.kit('facade.plankSeam', seams - 1);
      for (let f = 0; f < floors; f++) {
        const wy = 0.6 + f * floorH + floorH * 0.55;
        for (const [i, lx] of baysOf(f).entries()) {
          const [wx, wz] = lat(lx, faceZ + 0.14);
          zhilingWindow(b, wx, wy, wz, 1.05, 1.25, ry, litOf(i, f));
        }
      }
    } else if (facadeType === 2) {
      // 型 2 灰泥民居：C.plaster 墙 + 支摘窗（上扇斜撑、下扇窗心）；灰泥整幅铺面同样按门洞切三段
      facePanel('wall', w - 0.9, 0.6, 0.6 + bodyH - 0.6, faceZ + 0.02, shade(wallC, 1.06), 0.08);
      b.kit('facade.plasterFace', 1);
      // ry=π 时世界 X 轴与局部 X 轴反向，斜撑的俯仰要跟着翻号
      const tilt = 0.5 * Math.cos(ry);
      for (let f = 0; f < floors; f++) {
        const wy = 0.6 + f * floorH + floorH * 0.5;
        const bays = baysOf(f);
        for (const [i, lx] of bays.entries()) {
          boxAt('wood', 1.15, 0.9, 0.1, lx, wy - 0.42, faceZ + 0.09, shade(woodC, 0.72));
          if (litOf(i, f)) boxAt('glow', 0.98, 0.72, 0.06, lx, wy - 0.42, faceZ + 0.15, C.winGlow);
          boxAt('wood', 1.15, 0.85, 0.07, lx, wy + 0.5, faceZ + 0.3, shade(woodC, 0.9), 0, tilt, 0);
        }
        b.kit('facade.propWindow', bays.length, wy);
      }
    } else {
      // 型 3 柜台铺面：木栏柜 + 上部格窗
      const cw = w - 1.8;
      boxAt('wood', cw, 0.5, 0.24, 0, 0.95, faceZ + 0.16, shade(woodC, 0.9));
      boxAt('wood', cw + 0.24, 0.1, 0.62, 0, 1.25, faceZ + 0.28, shade(woodC, 1.14));
      for (const s2 of [-1, 1]) boxAt('wood', 0.18, 1.35, 0.18, (s2 * cw) / 2, 0.86, faceZ + 0.28, C.woodDark);
      b.kit('facade.counterRail', 1);
      for (let f = 0; f < floors; f++) {
        const wy = f === 0 ? 2.7 : 0.6 + f * floorH + floorH * 0.5;
        const bays = baysOf(f);
        for (const [i, lx] of bays.entries()) {
          boxAt('wood', 1.25, 0.95, 0.1, lx, wy, faceZ + 0.09, shade(woodC, 0.8));
          if (litOf(i, f)) boxAt('glow', 1.05, 0.75, 0.06, lx, wy, faceZ + 0.15, C.winGlow);
          for (let k = 1; k < 3; k++) boxAt('wood', 0.05, 0.9, 0.05, lx - 0.28 + (0.56 * k), wy, faceZ + 0.18, shade(woodC, 0.5));
        }
        b.kit('facade.counterLattice', bays.length, wy);
      }
    }
  }
  // 装饰柱（木色档，凸出正面 0.12m）
  const nCols = Math.max(2, Math.round(w / 4));
  for (let i = 0; i <= nCols; i++) {
    const lx = -w / 2 + 0.4 + ((w - 0.8) * i) / nCols;
    // 门洞中线附近不许立柱：偶数 nCols 时 lx 正好落在 x=0，会有一根 0.4m 的木柱杵在门洞中央
    if (Math.abs(lx) < openW / 2 + 0.55) continue;
    boxAt('wood', 0.4, bodyH - 0.2, 0.4, lx, 0.6 + (bodyH - 0.2) / 2, faceZ + 0.12, shade(woodC, 0.9 + 0.2 * (i % 2)));
  }
  // 匾额
  if (o.signText) {
    const [sx, sz2] = face(d / 2 + 0.14);
    // 悬山 / 前店后宅的墙顶只到 bodyTop+0.12，原 5.5m 宽匾（高 1.55）会顶穿平直坡面：
    // 这两型把匾压到 3.2m 宽（高 0.9），并把匾心夹在门楣与墙顶之间
    const sw = Math.min(w * 0.5, form === 'gable' || form === 'shopfront' ? 3.2 : 5.5);
    const sh = sw * 144 / 512;
    // 匾额底面必须高出门楣（doorHead=2.8）：一层店 bodyH*0.75=2.4，旧值会让匾盖住门洞上半，
    // 从街上只剩 0.6–1.7m 的一条缝能看进店里。
    const sy = Math.min(Math.max(bodyH * 0.75, doorHead + sh / 2 + 0.06), bodyTop + 0.1 - sh / 2);
    sg.quad(atlas.text(`sign${idx}`, o.signText, 512, 144, {
      color: o.signColor ?? '#ffe9c8', glow: o.signGlow, bg: o.signBg ?? 'rgba(12,10,18,0.88)',
      border: o.signGlow ?? 'rgba(255,179,0,0.8)', fontPx: 104,
    }), sw, sh, sx, sy, sz2, ry);
  }

  // 3b) 形制分型：店铺柜台挑檐 / 民居宅院门楼影壁 / 酒肆茶坊酒旗（kind 已在函数头声明）
  if (kind === 'house' || kind === 'manor') {
    const wallZ = d / 2 + 1.9;
    const gateW = kind === 'manor' ? 5.2 : 2.9;
    const segW = Math.max(1.2, (w + 1.2 - gateW) / 2);
    for (const s2 of [-1, 1]) {
      boxAt('wall', segW, 2.5, 0.42, s2 * (gateW / 2 + segW / 2), 1.25, wallZ, shade(C.plaster, 0.93));
      boxAt('roof', segW + 0.2, 0.24, 0.9, s2 * (gateW / 2 + segW / 2), 2.56, wallZ, C.tile);
    }
    boxAt('wood', 0.32, 3.4, 0.32, -gateW / 2, 1.7, wallZ, C.woodDark);
    boxAt('wood', 0.32, 3.4, 0.32, gateW / 2, 1.7, wallZ, C.woodDark);
    boxAt('wood', gateW, 0.28, 0.5, 0, 3.5, wallZ, C.woodDark);
    boxAt('roof', gateW + 1.4, 0.3, 1.4, 0, 3.76, wallZ, shade(C.tile, 1.05));
    boxAt('wood', gateW * 0.7, 2.2, 0.12, 0, 1.1, wallZ + 0.22, 0x2a1c12);
    boxAt('wall', gateW * 0.8, 0.22, 0.6, 0, 0.11, wallZ + 0.36, C.stone);
    // 影壁
    boxAt('wall', gateW * 1.2, 2.2, 0.3, 0, 1.1, wallZ - 2.6, shade(C.plaster2, 0.92));
    boxAt('roof', gateW * 1.3, 0.2, 0.6, 0, 2.3, wallZ - 2.6, C.tile);
    if (kind === 'manor') {
      for (const s2 of [-1, 1]) {
        boxAt('wall', 0.5, 1.1, 0.5, s2 * (gateW / 2 + 1.1), 0.55, wallZ + 0.7, C.stone);
        boxAt('wall', 0.72, 0.7, 0.66, s2 * (gateW / 2 + 1.1), 1.42, wallZ + 0.7, C.stone);
      }
    }
    b.kit('building.courtyardGate', 1);
  } else if (kind === 'shop') {
    const cz2 = d / 2 + 0.6;
    boxAt('wood', Math.min(3.2, w * 0.45), 1.05, 0.6, 0, 1.15, cz2, C.wood);
    boxAt('wood', Math.min(3.4, w * 0.48), 0.1, 0.78, 0, 1.72, cz2, shade(C.wood, 1.1));
    for (let i = 0; i < 3; i++) {
      boxAt('wood', 0.9, 0.06, 0.4, -1.2 + i * 1.2, 1.28 + i * 0.26, cz2 - 0.55, C.woodDark);
      boxAt('ceramic', 0.16, 0.18, 0.16, -1.2 + i * 1.2, 1.38 + i * 0.26, cz2 - 0.55, 0x7a6a52);
    }
    // 挑檐 + 檐柱
    boxAt('roof', w * 0.92, 0.14, 1.5, 0, 3.34, d / 2 + 0.85, shade(roofC, 1.12));
    for (const s2 of [-1, 1]) boxAt('wood', 0.14, 3.2, 0.14, s2 * w * 0.42, 1.6, d / 2 + 1.45, C.woodDark);
    b.kit('building.shopCounter', 1);
  } else if (kind === 'tavern' || kind === 'teahouse') {
    const px2 = w / 2 - 0.7;
    boxAt('wood', 0.16, 6.4, 0.16, px2, 3.2, d / 2 + 1.3, C.woodDark);
    boxAt('fabric', 1.15, 2.4, 0.06, px2 + 0.1, 4.7, d / 2 + 1.85, kind === 'tavern' ? 0x9d2933 : 0x2a5c42);
    boxAt('wood', 0.1, 0.1, 1.3, px2, 5.92, d / 2 + 1.85, C.woodDark);
    boxAt('glow', 0.3, 0.4, 0.3, px2, 6.55, d / 2 + 1.3, C.lantern);
    b.kit('building.wineFlag', 1);
  }

  // 4) 屋顶：按形制分派（roofOn 的签名与既有行为原样保留，只在这里决定给谁用）
  // 出檐反算：roofOn 的实际檐口 = 0.4615×入参面阔（0.5×0.905×1.02）。旧版统一传 w+0.5，
  // 檐口落在墙外皮以内 0.15m——屋顶没有出檐，反而被墙头包围；楼阁的通高檐柱（±d/2+0.42）
  // 更是直接从瓦面里戳出来。这里按「墙外皮 + 0.6m」反算入参，宋式出檐 0.5–0.8m 取中值。
  const rw = (w / 2 + 0.6) / 0.4615, rd = (d / 2 + 0.6) / 0.4615;
  const rH = Math.min(w, d) * 0.26 + 0.6;
  if (form === 'gable') {
    // 悬山民居：两坡 + 檩头出挑，檐口平直（顶替原来的四坡顶）
    gableRoofOn(b, w + 0.3, d + 0.3, bodyTop, x, z, ry, roofC, wallC, neon, Math.min(w, d) * 0.26 + 0.55);
    if (floors > 1) for (let f = 1; f < floors; f++) waistRingOn(b, w, d, 0.6 + (bodyH * f) / floors, x, z, ry, roofC, woodC);
  } else if (form === 'hall') {
    hipHallRoofOn(b, rw, rd, bodyTop, x, z, ry, roofC, neon, rH);
    if (floors > 1) for (let f = 1; f < floors; f++) waistRingOn(b, w, d, 0.6 + (bodyH * f) / floors, x, z, ry, roofC, woodC);
  } else if (form === 'pavilion') {
    roofOn(b, rw, rd, bodyTop, x, z, ry, roofC, neon, rH);
    // 腰檐改整圈四坡 + 平座（替换原来的 0.28m 腰线板与单面栏杆）
    for (let f = 1; f < floors; f++) waistRingOn(b, w, d, 0.6 + (bodyH * f) / floors, x, z, ry, roofC, woodC);
    // 通高檐柱：从地面一通到二层檐下，穿过腰檐与平座（宋式通柱造）
    for (const szn of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        const [px, pz] = lat((-0.4 + 0.4 * i) * w, szn * (d / 2 + 0.42));
        b.box('wood', 0.3, bodyH - 0.2, 0.3, px, 0.6 + (bodyH - 0.2) / 2, pz, shade(woodC, 0.96), ry);
      }
    }
    for (const sxn of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        const [px, pz] = lat(sxn * (w / 2 + 0.42), (-0.34 + 0.34 * i) * d);
        b.box('wood', 0.3, bodyH - 0.2, 0.3, px, 0.6 + (bodyH - 0.2) / 2, pz, shade(woodC, 0.96), ry);
      }
    }
  } else if (form === 'shopfront') {
    shopfrontRoofOn(b, o, bodyTop, roofC, woodC, wallC, neon);
  } else {
    roofOn(b, rw, rd, bodyTop, x, z, ry, roofC, neon, rH);
    if (floors > 1) {
      // 腰檐：楼阁/五脊殿/悬山都走 waistRingOn（整圈四坡裙檐 + 平座）；
      // 旧版这一支直接再调一次 roofOn——等于在半腰插一整座带正脊与鸱吻的屋顶，
      // 上层墙身从这座"假屋顶"里穿出来，正是"上层屋面插进下层屋面"的来源。
      waistRingOn(b, w, d, 0.6 + bodyH / floors, x, z, ry, roofC, woodC);
    }
  }

  // 5) 斗拱带（ornate 或两层以上）
  if (o.ornate || floors >= 2) {
    const [fx, fz] = face(d / 2 + 0.05);
    // 斗栱带总高 0.93（cy-0.44 压槽 → cy+0.49 散斗顶）。旧值 cy=bodyTop-0.15 让散斗顶
    // 高出屋面 0.29m，从檐口上方戳出一排小方块；压到 bodyTop-0.55 后顶面正好在檐檩下。
    dougongBand(b, fx, bodyTop - 0.55, fz, w + 0.5, ry, shade(C.woodRed, 1.1));
  }

  // 6) 彩楼欢门（ornate 专属）
  if (o.ornate) {
    const gx = x + sin * (d / 2 + 2.4), gz = z + cos * (d / 2 + 2.4);
    const gw = Math.min(w + 3, 13), gh = 7.2;
    for (const px of [-gw / 2, gw / 2]) for (const pz of [-1.2, 1.2]) {
      const wx2 = gx + Math.cos(ry) * px + sin * pz;
      const wz2 = gz - Math.sin(ry) * px + cos * pz;
      // 立柱加粗 + 抱鼓石 + 斜撑：原来 0.34m 细柱在远处撑不住顶梁，读作"浮板"
      b.box('wood', 0.5, gh, 0.5, wx2, gh / 2 + 0.5, wz2, C.woodDark, ry);
      b.box('wall', 0.86, 0.5, 0.86, wx2, 0.25, wz2, C.stone, ry);
      b.box('wood', 0.16, 1.8, 0.16, wx2, gh - 0.9, wz2, shade(C.woodRed, 1.05), ry, 0, 0.5);
    }
    for (const py of [gh + 0.4, gh - 1.1]) {
      b.box('wood', gw + 0.6, 0.3, 0.3, gx, py + 0.5, gz, C.woodDark, ry);
      b.box('wood', 0.3, 0.3, 2.8, gx, py + 0.5, gz, C.woodDark, ry);
    }
    for (let k = 0; k < 7; k++) {
      const lx = -gw / 2 + (gw * k) / 6;
      const lxx = gx + Math.cos(ry) * lx, lzz = gz - Math.sin(ry) * lx;
      // 悬挂式檐灯：吊索 + 灯盖 + 灯身 + 灯托 + 灯坠，五件都在一条垂直线上。
      // 旧版是 `b.box('glow', 0.5,0.5,0.5, …, 0, 0.78)`——一个绕 Z 轴滚转 45° 的发光立方：
      // 斜置立方体的轮廓就是一枚菱形（远看像被拉长的「卐/文字」），下面只接一根 0.16m 细杆、
      // 杆顶还差 0.1m 断开，于是读成「一排悬空、朝不同方向斜指的黄片」。
      // 宋式檐灯本来就是竖着挂的，不该有滚转。
      b.box('wood', 0.05, 0.5, 0.05, lxx, gh + 0.72, lzz, C.woodDark, ry);
      b.box('ceramic', 0.3, 0.1, 0.3, lxx, gh + 0.43, lzz, shade(0x6b2c20, 1.0), ry);
      b.box('glow', 0.26, 0.34, 0.26, lxx, gh + 0.21, lzz, neon ?? C.neonGold, ry);
      b.box('ceramic', 0.22, 0.06, 0.22, lxx, gh + 0.01, lzz, shade(0x6b2c20, 0.9), ry);
      b.box('fabric', 0.05, 0.24, 0.05, lxx, gh - 0.16, lzz, 0xb03030, ry);
    }
    for (const s of [-1, 1]) {
      const lx = s * (gw / 2 - 0.6);
      sg.quad(atlas.text(`huang${idx}${s}`, o.signText ? o.signText.slice(0, 2) : '酒', 64, 224, {
        color: '#fff', glow: o.signGlow ?? '#ffb300', vertical: true, fontPx: 46, bg: 'rgba(10,8,16,0.55)',
      }), 1.15, 4.1, gx + Math.cos(ry) * lx + sin * 1.6, 4.2, gz - Math.sin(ry) * lx + cos * 1.6, ry);
    }
  }
  // 7) 通用室内衬：门洞看进去不再是纯黑空腔（9 座手工室内壳由 o.hasInterior 跳过）
  if (!hasInterior) genericInteriorOn(b, o, wallC, woodC, kind);

  buildDetailedFacade(b, {
    x, z, ry, w, d, floors, lit: !!o.winGlow, windows: false,
    door: !frontOpen && facadeType !== 4,   // 敞开铺面不放门扇（柜台与檐柱由 shop 段承担）
    tier: o.ornate || w >= 14 || floors >= 3 ? 'near' : 'mid',
  });
}

// ============ 特殊建筑 ============
interface WallBand { y0: number; y1: number; w: number; g: 'ash' | 'earth'; hex: number; kit: string }

/** 夯土两段的明度基准：原色线性亮度 0.40/0.35，比包砖段（0.22–0.29）亮近 1.8×，远看就是一条浅色带。
 *  乘 0.78 / 0.76（-22% / -24%）后降到 0.31 / 0.26，与包砖 0x7d8288–0x8f949a 同梯队，仍是暖色但不再发白 */
const EARTH_LOW = shade(0xbfa77a, 0.78);
const EARTH_HIGH = shade(0xb59b72, 0.76);

/** 墙身七道收分带（下宽上窄）：条石基础 → 包砖 → 夯土 → 砖腰线 → 夯土，逐层内收 0.15–0.3m */
const WALL_BANDS: WallBand[] = [
  { y0: 0.00, y1: 0.55, w: 8.60, g: 'ash', hex: 0x8b867a, kit: 'wall.courseStone' },
  { y0: 0.55, y1: 1.15, w: 8.30, g: 'ash', hex: 0x827c70, kit: 'wall.courseStone' },
  { y0: 1.15, y1: 3.45, w: 8.00, g: 'ash', hex: 0x7d8288, kit: 'wall.courseBrick' },
  { y0: 3.45, y1: 3.80, w: 7.80, g: 'ash', hex: 0x8f949a, kit: 'wall.courseBrick' },
  { y0: 3.80, y1: 6.55, w: 7.55, g: 'earth', hex: EARTH_LOW, kit: 'wall.courseEarth' },
  { y0: 6.55, y1: 6.90, w: 7.35, g: 'ash', hex: 0x878c92, kit: 'wall.courseBrick' },
  { y0: 6.90, y1: 9.50, w: 7.00, g: 'earth', hex: EARTH_HIGH, kit: 'wall.courseEarth' },
];

/** 夯土段水平分带：两道 ±6% 明度、外挑 6cm 的窄带，把 2.75m / 2.6m 的整片同色夯土打断 */
const EARTH_COURSES: { y: number; h: number; w: number; hex: number }[] = [
  { y: 5.10, h: 0.26, w: 7.61, hex: shade(EARTH_LOW, 1.06) },
  { y: 8.20, h: 0.24, w: 7.06, hex: shade(EARTH_HIGH, 0.94) },
];

const WALL_DECK = 10.22;   // 墙顶作业面：既有 7.3×0.7 压顶条上皮 10.2 + 石压面
const PARAPET_H = 1.1;     // 女墙高
const COPE_H = 0.25;       // 压脊厚
const WALK_X = 462.9;      // 马道中心线（内侧 3m 走道 461.4–464.4）
/** 角楼落点（沿墙均布，本城只建东墙故四座）：马道被角楼墩台占住，肋/门洞在此让开 */
const CORNER_TOWER_Z = [-186.5, -46, 150, 396.5];

/** 马道标高：距城门每米抬高 0.0075，150m 处封顶 1.1m，坡度沿墙 */
function wallDeckY(z: number): number {
  return WALL_DECK + Math.min(1.1, Math.abs(z - GATE_Z) * 0.0075);
}

export function buildCityWall(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const segs: [number, number][] = [[-14, GATE_Z - 7], [GATE_Z + 7, 400], [-190, -14]];
  for (const [z0, z1] of segs) {
    const len = z1 - z0;
    if (len <= 0) continue;
    const zc = (z0 + z1) / 2;
    b.box('wall', 6.5, 9.5, len, WALL_X, 4.75, zc, C.wallGray);
    // 墙身：七道内收的条石/包砖/夯土带包住既有直墙，8.6m 收到 7.0m，外轮廓才有收分
    for (const band of WALL_BANDS) {
      b.box(band.g, band.w, band.y1 - band.y0, len, WALL_X, (band.y0 + band.y1) / 2, zc, band.hex);
      b.kit(band.kit, 1, (band.y0 + band.y1) / 2);
    }
    // 夯土段两道水平分带（±6% 明度、外挑 6cm）：单色 2.7m 高的夯土墙身不再是一片平涂
    for (const course of EARTH_COURSES) {
      b.box('earth', course.w, course.h, len, WALL_X, course.y, zc, course.hex);
      b.kit('wall.earthCourse', 1, course.y);
    }
    // 伸缩缝：每 46m 一道，逐层包一圈出挑 4cm 的深色细条
    let joints = 0;
    for (let jz = z0 + 23; jz < z1 - 4; jz += 46) {
      for (const band of WALL_BANDS) {
        b.box('ash', band.w + 0.08, band.y1 - band.y0, 0.26, WALL_X, (band.y0 + band.y1) / 2, jz, 0x4c4a42);
      }
      joints++;
    }
    if (joints > 0) b.kit('wall.joint', joints, 5.0);
    b.box('wall', 7.3, 0.7, len, WALL_X, 9.85, zc, shade(C.wallGray, 0.85));
    // 压顶外表改石压面（wall 组自带蓝灰自发光，做石/土会泛冷光）
    b.box('ash', 7.36, 0.72, len, WALL_X, 9.86, zc, 0x8d8a80);
    b.kit('wall.coping', 1, 9.86);
    const n = Math.floor(len / 3.2);
    // 加固肋每 3.2m 一道：原实现整条 7m 宽肋横穿马道，肋顶 11.25 只比马道面高约 1.05m，
    // 3m 走道被一串"矮洞"截断。改法：肋体保留成两段（外坡 / 内坡各 1.70m），马道穿过处开成门洞——
    // 两侧补 0.32m 厚侧壁、顶上补一道过梁把肋顶连回去（结构不断），门洞内壁再压一圈石框。
    const RIB_TOP = 11.25, RIB_D = 1.30;
    let ribCaps = 0;
    for (let i = 0; i < n; i++) {
      const z = z0 + 1.6 + (len * i) / n;
      const deck = wallDeckY(z);
      // 肋顶没入马道后（|z-GATE_Z| 约 104m 以外，马道标高 11.0 以上）已不形成矮洞，保持整肋不再开洞；
      // 角楼墩台（±3.3m）占住马道处同理让开，避免门框插进角楼身
      const inTower = CORNER_TOWER_Z.some((tz) => Math.abs(z - tz) < 3.6);
      if (inTower || RIB_TOP - deck <= 0.25) {
        b.box('wall', 7.0, 1.1, RIB_D, WALL_X, 10.7, z, shade(C.wallGray, 0.8));
        b.box('ash', 7.04, 1.10, RIB_D + 0.06, WALL_X, 10.70, z, 0x8d8a80); // 加固肋包石（原肋是 wall 组，泛蓝灰）
        b.box('ash', 7.02, 0.16, RIB_D + 0.04, WALL_X, 11.33, z, 0x9c9a90); // 加固肋石压顶
        b.kit('wall.ribSheath', 1, 10.7);
        ribCaps++;
        continue;
      }
      // 加固肋改作「墙面扶壁」：只占墙两侧各 1.6m 进深，中间 3.8m 马道完全贯通。
      // 旧做法是在 1.1m 高的肋上开 2.05m 高的门洞，必然长出 2m 侧壁，整条马道变成一排白栅栏（gate 机位实测）。
      for (const s of [-1, 1]) {
        b.box('wall', 1.6, 1.1, RIB_D, WALL_X + s * 0.8, 10.7, z, shade(C.wallGray, 0.8));
        b.box('ash', 1.62, 1.10, RIB_D + 0.06, WALL_X + s * 0.8, 10.70, z, 0x8d8a80);
        b.box('ash', 1.60, 0.16, RIB_D + 0.04, WALL_X + s * 0.8, 11.33, z, 0x9c9a90);
        b.kit('wall.ribSheath', 1, 10.7);
        ribCaps++;
      }
    }
    if (ribCaps > 0) b.kit('wall.ribCap', ribCaps, 11.33);
    b.box('glow', 0.1, 0.08, len, WALL_X + 3.3, 9.9, zc, C.neonCyan);
    b.box('glow', 0.1, 0.08, len, WALL_X - 3.3, 9.9, zc, C.neonCyan);
    // 内侧女墙：连续 1.1m 矮墙 + 0.25m 压脊
    b.box('ash', 1.0, PARAPET_H, len, WALL_X + 3.15, WALL_DECK + PARAPET_H / 2, zc, 0x8d9094);
    b.box('roof', 1.14, COPE_H, len, WALL_X + 3.15, WALL_DECK + PARAPET_H + COPE_H / 2, zc, C.ridge);
    b.kit('wall.parapet', 1, WALL_DECK + PARAPET_H / 2);
    b.kit('wall.parapetCope', 1, WALL_DECK + PARAPET_H + COPE_H / 2);
    // 外侧垛口：2.2m 一垛（垛宽 1.6 / 口宽 0.6），逐垛起压脊
    let merlons = 0;
    for (let mz = z0 + 1.1; mz < z1 - 0.7; mz += 2.2) {
      b.box('ash', 0.6, PARAPET_H, 1.6, WALL_X - 3.35, WALL_DECK + PARAPET_H / 2, mz, 0x8a8f95);
      b.box('roof', 0.74, COPE_H, 1.7, WALL_X - 3.35, WALL_DECK + PARAPET_H + COPE_H / 2, mz, C.ridge);
      merlons++;
    }
    if (merlons > 0) {
      b.kit('wall.merlon', merlons, WALL_DECK + PARAPET_H / 2);
      b.kit('wall.merlonCope', merlons, WALL_DECK + PARAPET_H + COPE_H / 2);
    }
    b.box('glow', 0.05, 0.06, len, WALL_X - 3.69, WALL_DECK - 0.12, zc, C.neonCyan);
    b.kit('wall.parapetGlow', 1, WALL_DECK - 0.12);
    // 马道：内侧 3m 走道，0.75% 找坡，逐 6m 一段铺石（两侧牙石）
    let decks = 0;
    for (let za = z0; za < z1 - 0.01; za += 6) {
      const zb = Math.min(z1, za + 6);
      const dz = zb - za, tilt = -Math.atan2(wallDeckY(zb) - wallDeckY(za), dz), ym = (wallDeckY(za) + wallDeckY(zb)) / 2;
      b.box('ash', 3.0, 0.26, dz + 0.06, WALK_X, ym - 0.13, (za + zb) / 2, 0x9a9382, 0, tilt, 0);
      b.box('ash', 0.24, 0.3, dz + 0.06, WALK_X - 1.62, ym - 0.11, (za + zb) / 2, 0x8f887a, 0, tilt, 0);
      b.box('ash', 0.24, 0.3, dz + 0.06, WALK_X + 1.62, ym - 0.11, (za + zb) / 2, 0x8f887a, 0, tilt, 0);
      decks++;
    }
    b.kit('wall.walkway', decks, WALL_DECK + 0.4);
  }
  // 门洞：两侧墩 + 拱梁
  b.box('wall', 7.5, 9.5, 3.4, WALL_X, 4.75, GATE_Z - 5.2, shade(C.wallGray, 0.9));
  b.box('wall', 7.5, 9.5, 3.4, WALL_X, 4.75, GATE_Z + 5.2, shade(C.wallGray, 0.9));
  for (let i = 0; i < 4; i++) {
    const w = 10.4 - i * 2.6;
    b.box('wall', 7.5, 1.15, w, WALL_X, 5.0 + 9.5 + i * 1.15, GATE_Z, shade(C.wallGray, 0.9 - i * 0.04));
  }
  // 墩身包石：门道两壁与墩面换成条石（原来整块 wall 组，泛蓝灰）
  for (const s of [-1, 1]) {
    b.box('ash', 7.62, 9.5, 3.44, WALL_X, 4.75, GATE_Z + s * 5.2, 0x7f848a);
  }
  b.kit('gateTower.pierFace', 2, 4.75);
  // 既有 13×17 石平台（y 13.5–14.9）包一层石挑檐，作为城台的出挑压顶
  b.box('ash', 13.12, 1.42, 17.12, WALL_X, 14.2, GATE_Z, 0x8a867a);
  b.kit('gateTower.cornice', 1, 14.2);
  // 城楼：城台 + 台明 + 一层柱廊 + 腰檐 + 二层 + 庑殿顶
  buildGateTower(b, sg, atlas);
  // 门道：门额石 + 排叉柱 + 门槛石（门道贯通可穿行）
  b.box('ash', 7.66, 0.52, 7.3, WALL_X, 9.26, GATE_Z, 0x9a9588);
  b.kit('gateTower.lintel', 1, 9.26);
  for (const s of [-1, 1]) {
    const pz = GATE_Z + s * 3.34;
    for (let i = 0; i < 4; i++) {
      b.cyl('wood', 0.14, 0.16, 8.5, 6, WALL_X - 3.3 + i * 2.2, 4.25, pz, shade(C.woodRed, 0.66));
    }
    b.box('wood', 7.3, 0.34, 0.3, WALL_X, 8.6, pz, shade(C.woodRed, 0.72));
    b.kit('gateTower.portalColumn', 4, 4.25);
    b.kit('gateTower.portalBeam', 1, 8.6);
  }
  b.box('ash', 7.3, 0.16, 6.9, WALL_X, 0.08, GATE_Z, 0x8d8a80);
  b.kit('gateTower.threshold', 1, 0.08);
  // 门道照明：原为一道 6.4m 长的品红 glow 横杆横在门洞正中（贯通后被读成"封条"），
  // 改成两侧门柱壁灯 + 门额下一道细灯带
  for (const s of [-1, 1]) {
    b.box('metal', 0.3, 0.46, 0.3, WALL_X + 0.1, 4.6, GATE_Z + s * 3.15, 0x4a4e54);
    b.box('glow', 0.2, 0.3, 0.2, WALL_X + 0.26, 4.6, GATE_Z + s * 3.15, C.neonMag);
  }
  b.box('glow', 0.1, 0.1, 5.4, WALL_X + 0.12, 8.9, GATE_Z, C.neonGold);
  // 千斤闸（C-ITM-0011 / C-ITM-0297 / D-ITM-0070）：本城只有东门一处门洞，故三件同名条目各落一处
  // 独立闸位——门道外/中/内三道门限（459.8 / 462.0 / 464.2，正好落在两排排叉柱之间）。
  // 闸板半启，门道净高保持 ≥2.6m 可通行；闸槽只贴门道两壁，不占马道、不动墩身。
  qianjinGate(b, WALL_X - 2.2, 2.6);
  qianjinGate(b, WALL_X, 3.7);
  qianjinGate(b, WALL_X + 2.2, 4.8);
  // 角楼：墙体两端两座 + 长墙中段两座（本城只建东墙，故四座沿墙均布）
  for (const tz of CORNER_TOWER_Z) buildCornerTower(b, tz);
  // WS-36 城门与宫门构件 16 件（双阙 / 铺首 / 拒马 / 拴桩 / 地衣 / 绣帘 / 绣墩 /
  // 斗拱 / 簋尊 / 拱骨 / 鹤顶 / 缆桩 / 摊贩担 / 望柱）：落既有门、殿、桥表面，0 新增 draw call
  buildGatePalaceFittings(b);
}

// ============ 千斤闸（城门防务）============
// C-ITM-0011 / C-ITM-0297 / D-ITM-0070 三件同名条目：城防闸随门洞，本城只有东门一处门洞，
// 故一套门洞内设三处独立闸位（外 / 中 / 内门限），各自带石闸槽、闸板与顶部绞盘。
/** 一套千斤闸：门洞两侧石质竖槽 + 闸板（木/铁板 + 铁箍）+ 绞盘/绳索/配重
 *  x = 闸板所在门道断面；leafBottom = 闸板下沿标高（半启，门道保持可通行） */
function qianjinGate(b: Baker, x: number, leafBottom: number): void {
  const zc = GATE_Z;
  const HALF = 3.26, LH = 3.4, SLOT = 3.47;      // 闸板半宽 / 闸板高 / 闸槽中心
  const leafTop = leafBottom + LH;
  // 1) 门洞两侧石质闸槽：槽体（顶到门道过梁）+ 槽口暗线 + 槽底石槛
  for (const s of [-1, 1]) {
    b.box('ash', 0.52, 8.24, 0.30, x, 4.28, zc + s * SLOT, 0x7b776b);
    b.box('ash', 0.10, 8.10, 0.07, x, 4.25, zc + s * (SLOT - 0.16), shade(0x2e2b26, 1.0));
    b.box('ash', 0.56, 0.20, 0.44, x, 0.26, zc + s * SLOT, 0x8a867a);
  }
  b.kit('gate.qianjinSlot', 2, 4.28);
  // 2) 闸板：5 块木闸板 + 三道铁箍（带铆钉）+ 两端立铁 + 吊环
  const pw = (HALF * 2) / 5;
  for (let i = 0; i < 5; i++) {
    const pz = zc - HALF + pw * (i + 0.5);
    b.box('wood', 0.16, LH, pw - 0.06, x, leafBottom + LH / 2, pz, shade(C.woodDark, i % 2 ? 0.9 : 1.12));
  }
  b.kit('gate.qianjinLeaf', 5, leafBottom + LH / 2);
  for (const t of [0.18, 0.5, 0.82]) {
    const by = leafBottom + LH * t;
    b.box('metal', 0.22, 0.24, HALF * 2 + 0.04, x, by, zc, 0x4e4a42);
    for (let r = 0; r < 11; r++) {
      const rz = zc - HALF + 0.22 + (r * (HALF * 2 - 0.44)) / 10;
      b.box('metal', 0.25, 0.08, 0.08, x, by, rz, 0x7a7468);
    }
  }
  b.kit('gate.qianjinBand', 3, leafBottom + LH / 2);
  for (const s of [-1, 1]) {
    b.box('metal', 0.2, LH, 0.12, x, leafBottom + LH / 2, zc + s * (HALF - 0.07), 0x4a463e);
    b.box('metal', 0.12, 0.24, 0.12, x, leafTop + 0.12, zc + s * 1.05, 0x6a655c);
  }
  // 3) 启闭机构：绞盘（滚筒 + 两端绳轮 + 轴承石座 + 摇柄）挂在门额石下
  const wy = 8.5;
  b.cyl('metal', 0.28, 0.28, 5.0, 8, x, wy, zc, 0x585349, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    b.cyl('wood', 0.4, 0.4, 0.16, 10, x, wy, zc + s * 2.18, shade(C.woodDark, 1.1), 0, Math.PI / 2);
    b.box('ash', 0.54, 0.5, 0.36, x, wy, zc + s * 2.62, 0x8a867a);
  }
  b.box('metal', 0.86, 0.1, 0.1, x + 0.38, wy, zc - 2.4, 0x6b665c);
  b.box('wood', 0.12, 0.36, 0.12, x + 0.76, wy - 0.16, zc - 2.4, C.woodDark);
  b.kit('gate.qianjinWinch', 1, wy);
  // 4) 吊绳：绞盘 → 闸板上沿
  const ropeLen = Math.max(0.18, wy - 0.26 - leafTop);
  for (const oz of [-1.2, 0, 1.2]) {
    b.box('fabric', 0.075, ropeLen, 0.075, x, leafTop + ropeLen / 2, zc + oz, 0x6b5b3e);
  }
  b.kit('gate.qianjinRope', 3, leafTop + ropeLen / 2);
  // 5) 配重：铁块 + 铁箍 + 吊耳 + 吊链（挂在滚筒出绳侧）
  const cwx = x + 0.66, cwz = zc + 1.6, cwy = leafTop - 0.8;
  b.box('metal', 0.46, 0.82, 0.52, cwx, cwy, cwz, 0x4a453c);
  b.box('metal', 0.52, 0.12, 0.58, cwx, cwy + 0.45, cwz, 0x6a655c);
  b.box('metal', 0.1, 0.3, 0.1, cwx, cwy + 0.62, cwz, 0x6a655c);
  const cBot = cwy + 0.72, cTop = wy - 0.1;
  const links = Math.max(2, Math.round((cTop - cBot) / 0.42));
  for (let k = 0; k < links; k++) {
    b.box('metal', 0.08, (cTop - cBot) / links - 0.05, 0.08, cwx, cBot + ((cTop - cBot) * (k + 0.5)) / links, cwz, 0x5c574d);
  }
  b.kit('gate.qianjinWeight', 1, cwy);
}

/** 城楼：城台（补住墙顶 9.5 到旧平台 13.5 的 4m 空档）+ 台明 + 一层柱廊 + 腰檐 + 二层 + 庑殿顶 */
function buildGateTower(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const cx = WALL_X, cz = GATE_Z;
  // 城台：11.2×15.8，比墙顶 7.3 宽出约 2m/侧，把墙顶与既有平台连成一座墩台
  b.box('ash', 11.2, 4.0, 15.8, cx, 11.5, cz, 0x8f8b7f);
  b.box('ash', 11.44, 0.26, 16.04, cx, 10.9, cz, 0x7c786d);
  b.box('ash', 11.44, 0.26, 16.04, cx, 13.3, cz, 0x7c786d);
  b.kit('gateTower.plinth', 1, 11.5);
  b.kit('gateTower.plinthCourse', 2, 12.1);
  // 台明：既有平台（13.5–14.9）上皮再起一道石台
  b.box('ash', 11.8, 0.3, 15.4, cx, 15.05, cz, 0x9c988c);
  b.kit('gateTower.podium', 1, 15.05);
  // 一层殿身：门洞上方既有四层拱券块（13.9–18.5）全部收进此体量内
  b.box('wood', 8.4, 4.2, 12.6, cx, 17.3, cz, shade(C.woodRed, 0.74));
  b.kit('gateTower.hallOne', 1, 17.3);
  // 一层柱廊：前后各 4 柱，中央明间 4.9m 正对门洞（明间净宽够挂 4.4m 匾）
  for (const s of [-1, 1]) {
    for (const lz of [-6.4, -2.45, 2.45, 6.4]) {
      b.box('ash', 0.64, 0.34, 0.64, cx + s * 4.75, 15.37, cz + lz, 0x9a9689);
      b.cyl('wood', 0.19, 0.23, 3.64, 8, cx + s * 4.75, 17.36, cz + lz, shade(C.woodRed, 1.02));
      b.kit('gateTower.columnBase', 1, 15.37);
      b.kit('gateTower.column', 1, 17.36);
    }
    b.box('wood', 0.36, 0.44, 13.2, cx + s * 4.75, 18.98, cz, shade(C.woodRed, 0.9));
    b.box('wood', 0.54, 0.2, 13.4, cx + s * 4.75, 19.26, cz, shade(C.woodRed, 1.12));
  }
  b.kit('gateTower.architrave', 4, 19.1);
  // 直棂窗：一层四面各 2
  for (const s of [-1, 1]) {
    for (const lz of [-4.4, 4.4]) zhilingWindow(b, cx + s * 4.22, 17.5, cz + lz, 1.15, 1.5, s > 0 ? Math.PI / 2 : -Math.PI / 2, s * lz > 0);
    for (const lx of [-2.0, 2.0]) zhilingWindow(b, cx + lx, 17.5, cz + s * 6.32, 1.15, 1.5, s > 0 ? 0 : Math.PI, s > 0);
  }
  b.kit('gateTower.windowOne', 8, 17.5);
  // 一层前檐立面补白：8.4×12.6 的正立面原来只有 8 樘直棂小窗，远看是一整块木板。
  // 补壁柱（对齐柱廊开间 ±2.45 明间界 / ±6.05 角柱位，出墙 0.2m）、槛墙 0.9m、
  // 额枋下悬鱼 2 件、门额两侧楹联板 2 块（空板，不写字）。
  {
    const faceX = cx + 4.2;                                   // 一层前檐墙面
    const pilHex = shade(C.woodRed, 0.6);
    for (const lz of [-6.05, -2.45, 2.45, 6.05]) {
      b.box('wood', 0.2, 3.56, 0.42, faceX + 0.1, 16.98, cz + lz, pilHex);
    }
    b.kit('gateTower.pilaster', 4, 16.98);
    // 槛墙：0.9m 高，填满壁柱之间的三个开间（明间 4.48 / 两侧次间 3.18）
    for (const [lz, pw] of [[0, 4.48], [-4.25, 3.18], [4.25, 3.18]] as const) {
      b.box('ash', 0.18, 0.9, pw, faceX + 0.09, 15.65, cz + lz, shade(0x9c988c, 0.9));
    }
    b.kit('gateTower.sillWall', 3, 15.65);
    for (const s of [-1, 1]) {
      // 悬鱼：吊杆挂在额枋底（18.76），鱼身垂到 17.82，落在门额与直棂窗之间
      b.box('wood', 0.09, 0.32, 0.09, cx + 4.6, 18.6, cz + s * 3.3, shade(C.woodDark, 1.1));
      b.box('lacquer', 0.07, 0.62, 0.3, cx + 4.6, 18.13, cz + s * 3.3, shade(C.woodRed, 0.78));
      // 楹联板：贴明间两侧壁柱面，板心留空（不写字）
      b.box('lacquer', 0.06, 2.3, 0.36, faceX + 0.23, 17.45, cz + s * 2.45, shade(C.woodDark, 0.9));
      b.box('lacquer', 0.03, 2.1, 0.26, faceX + 0.27, 17.45, cz + s * 2.45, shade(0x2a1c12, 1.0));
    }
    b.kit('gateTower.hangingFish', 2, 18.3);
    b.kit('gateTower.coupletBoard', 2, 17.45);
  }
  // 腰檐（一层檐）：出檐 1.9m 的浅坡檐，檐口 15.6×18.4
  b.roofC('roof', cx, 19.4, cz, shade(C.tile, 1.06), 0, 15.6, 1.5, 18.4);
  for (const [w2, d2, ox, oz] of [[15.6, 0.34, 0, 9.2], [15.6, 0.34, 0, -9.2], [0.34, 18.4, 7.8, 0], [0.34, 18.4, -7.8, 0]] as const) {
    b.box('roof', w2, 0.3, d2, cx + ox, 19.38, cz + oz, shade(C.tile, 0.78));
  }
  b.kit('gateTower.skirtEave', 1, 19.4);
  b.kit('gateTower.skirtFascia', 4, 19.38);
  // 二层：自柱网（9.5×13.2）收进 2m 到 6.6×10.6，由腰檐中穿出
  b.box('wood', 6.6, 3.6, 10.6, cx, 21.2, cz, shade(C.woodRed, 0.8));
  b.box('wood', 7.0, 0.22, 11.0, cx, 19.5, cz, shade(C.woodDark, 1.05));
  b.kit('gateTower.hallTwo', 1, 21.2);
  for (const s of [-1, 1]) {
    for (const lz of [-2.6, 2.6]) zhilingWindow(b, cx + s * 3.32, 21.8, cz + lz, 1.25, 1.5, s > 0 ? Math.PI / 2 : -Math.PI / 2, s * lz > 0);
    for (const lx of [-1.5, 1.5]) zhilingWindow(b, cx + lx, 21.8, cz + s * 5.32, 1.25, 1.5, s > 0 ? 0 : Math.PI, s > 0);
  }
  b.kit('gateTower.windowTwo', 8, 21.8);
  // 屋顶：庑殿（脊沿墙向）；roofOn 的脊沿本地 x，故整体转 90°
  roofOn(b, 15.2, 11.2, 23.0, cx, cz, Math.PI / 2, shade(C.tile, 1.08), C.neonGold, 2.6);
  b.kit('gateTower.roof', 1, 23.0);
  // 门匾：移到一层檐下明间正中（两柱之间，不再贴墙）
  b.box('lacquer', 0.12, 1.48, 4.6, cx + 4.22, 17.95, cz, shade(C.woodDark, 0.92));
  b.box('wood', 0.34, 0.14, 4.7, cx + 4.4, 18.72, cz, shade(C.neonGold, 0.55));
  sg.quad(atlas.text('gatename', '上東門', 220, 64, { color: '#fff', glow: '#00e5ff', bg: 'rgba(8,12,22,0.85)', border: 'rgba(0,229,255,.7)', fontPx: 44 }), 4.4, 1.28, cx + 4.3, 17.95, cz, Math.PI / 2);
  b.kit('gateTower.plaque', 1, 17.95);
}

/** 角楼：墙顶一层小楼 + 攒尖顶，台座与马道同高相接（本城只建东墙，故四座沿墙均布） */
function buildCornerTower(b: Baker, z: number): void {
  const x = WALL_X;
  const walk = wallDeckY(z);
  const top = walk + 0.45;                   // 台明顶面比马道高 0.45
  b.box('ash', 6.6, top - WALL_DECK, 6.6, x, (WALL_DECK + top) / 2, z, 0x8b867a);
  b.box('ash', 6.9, 0.2, 6.9, x, top - 0.1, z, 0x9c988c);
  b.kit('cornerTower.plinth', 1, (WALL_DECK + top) / 2);
  // 一层身 + 四角柱
  b.box('wood', 3.9, 2.7, 3.9, x, top + 1.45, z, shade(C.woodRed, 0.76));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl('wood', 0.15, 0.17, 2.9, 8, x + sx * 1.86, top + 1.55, z + sz * 1.86, shade(C.woodRed, 0.98));
  }
  b.kit('cornerTower.body', 1, top + 1.45);
  b.kit('cornerTower.column', 4, top + 1.55);
  // 额枋四面
  for (const [w2, d2, ox, oz] of [[4.34, 0.3, 0, 1.94], [4.34, 0.3, 0, -1.94], [0.3, 4.34, 1.94, 0], [0.3, 4.34, -1.94, 0]] as const) {
    b.box('wood', w2, 0.28, d2, x + ox, top + 2.94, z + oz, shade(C.woodRed, 1.08));
  }
  b.kit('cornerTower.architrave', 4, top + 2.94);
  // 直棂窗：四面各一
  zhilingWindow(b, x + 1.97, top + 1.5, z, 1.05, 1.15, Math.PI / 2, true);
  zhilingWindow(b, x - 1.97, top + 1.5, z, 1.05, 1.15, -Math.PI / 2, false);
  zhilingWindow(b, x, top + 1.5, z + 1.97, 1.05, 1.15, 0, true);
  zhilingWindow(b, x, top + 1.5, z - 1.97, 1.05, 1.15, Math.PI, false);
  b.kit('cornerTower.window', 4, top + 1.5);
  // 攒尖顶 + 连檐 + 宝顶
  const roofY = top + 3.1;
  b.roofC('roof', x, roofY, z, shade(C.tile, 1.05), 0, 6.2, 2.15, 6.2);
  // 攒尖：roofC 的顶面是 0.32×面阔 的平顶（bake.ts RIDGE_HALF），6.2m 顶会留下 2m 见方的
  // 平顶台。补一个与平顶同径、0.55m 高的锥盖把台面收成尖，宝顶再坐在锥尖上。
  b.cyl('roof', 0.04, 1.02, 0.55, 6, x, roofY + 2.15 + 0.275, z, shade(C.tile, 0.96));
  for (const [w2, d2, ox, oz] of [[6.2, 0.28, 0, 3.1], [6.2, 0.28, 0, -3.1], [0.28, 6.2, 3.1, 0], [0.28, 6.2, -3.1, 0]] as const) {
    b.box('roof', w2, 0.28, d2, x + ox, roofY + 0.02, z + oz, shade(C.tile, 0.78));
  }
  b.kit('cornerTower.eave', 4, roofY);
  b.cyl('metal', 0.17, 0.24, 0.42, 8, x, roofY + 2.9, z, shade(C.neonGold, 0.5));
  b.cyl('metal', 0.3, 0.1, 0.4, 8, x, roofY + 3.28, z, shade(C.neonGold, 0.66));
  b.kit('cornerTower.finial', 2, roofY + 3.1);
  // 与马道相接：两端踏石（墙体尽头那侧不外挑）
  for (const s of [-1, 1]) {
    const sz2 = z + s * 3.6;
    if (sz2 < -189.4 || sz2 > 399.4) continue;
    b.box('ash', 2.6, 0.2, 1.0, WALK_X, walk + 0.1, sz2, 0x9a9382);
    b.kit('cornerTower.step', 1, walk + 0.1);
  }
}

// 塔身十三层：C-ITM-0200 —— 开宝寺塔八角十三层楼阁式（塔心柱 0202 / 塔窗 0204 同批挂在塔体上）
// 既有 5 层用 5.6m 层高 + 0.86 收分，收到 13 层塔身半径只剩 0.87m（比塔刹还细），
// 故改为 3.9m 层高 + 0.26m 等差收分：13 层通高 55.9m，对齐 20 卷 030 条「总高 55m」。
const PAGODA_STORIES = 13;
const PAGODA_BASE_Y = 1.2;      // 台基面
const PAGODA_STORY_H = 3.9;
const PAGODA_R0 = 6.2;
const PAGODA_TAPER = 0.26;
const PAGODA_CAP_Y = PAGODA_BASE_Y + (PAGODA_STORIES - 1) * PAGODA_STORY_H + 3.81; // 51.81：刹座面 = 末层平座顶

const pagodaRadius = (f: number): number => PAGODA_R0 - f * PAGODA_TAPER;
const pagodaStoryY = (f: number): number => PAGODA_BASE_Y + f * PAGODA_STORY_H;

export function buildPagoda(b: Baker): void {
  const x = 540, z = 200;
  b.box('wall', 17, 1.2, 17, x, 0.6, z, C.stone);
  // 琉璃砖面（C-ITM-0199）塔基部分：台基上沿一圈琉璃压边（四面，每面 20 块）
  {
    const gr = 8.5, gy = 1.02;
    let baseTiles = 0;
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 20; j++) {
        const off = -gr + 0.44 + j * 0.85;
        const odd = j % 3 === 1;
        if (k < 2) {
          const sz = k === 0 ? 1 : -1;
          b.box('ceramic', 0.8, 0.34, 0.12, x + off, gy, z + sz * gr, odd ? shade(0xc9a13a, 1.0) : shade(0x3f7a4a, 1.05));
        } else {
          const sx = k === 2 ? 1 : -1;
          b.box('ceramic', 0.12, 0.34, 0.8, x + sx * gr, gy, z + off, odd ? shade(0xc9a13a, 1.0) : shade(0x3f7a4a, 1.05));
        }
        baseTiles++;
      }
    }
    b.kit('pagoda.glazedBrick', baseTiles, gy);
  }
  const bronze = shade(C.neonGold, 0.55);
  const bronzeD = shade(C.neonGold, 0.4);

  // 塔心柱：C-ITM-0202 —— 木心柱一柱到顶，柱顶抵刹座（刹杆即其向上延伸的延续）。
  // 十三层塔身是有皮无腔的实心体，心柱按结构真实位置落在塔心，逐层做出错位券洞。
  {
    const coreBot = 0.55, coreTop = PAGODA_CAP_Y;
    b.cyl('wood', 0.80, 0.96, coreTop - coreBot, 8, x, (coreTop + coreBot) / 2, z, shade(C.woodDark, 1.02));
    let niches = 0;
    for (let f = 0; f < PAGODA_STORIES; f++) {
      const cy = pagodaStoryY(f) + 1.15;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4 + (f % 2) * (Math.PI / 4);   // 券洞层错：每层旋 45°
        b.box('wood', 0.52, 1.42, 0.30, x + Math.sin(a) * 0.90, cy, z + Math.cos(a) * 0.90, shade(C.woodDark, 1.16), a);
        b.box('wood', 0.34, 0.16, 0.34, x + Math.sin(a) * 0.92, cy + 0.78, z + Math.cos(a) * 0.92, shade(C.woodRed, 0.78), a);
        niches++;
      }
    }
    b.kit('pagoda.heartColumn', PAGODA_STORIES, coreTop / 2);
    b.kit('pagoda.heartNiche', niches, coreTop / 2);
  }

  let winTotal = 0;
  for (let f = 0; f < PAGODA_STORIES; f++) {
    const y0 = pagodaStoryY(f);
    const r = pagodaRadius(f);
    const rNext = pagodaRadius(f + 1);
    const bodyH = 2.3;
    b.cyl('wood', r, r * 1.06, bodyH, 8, x, y0 + bodyH / 2, z, shade(C.woodRed, 1 - f * 0.012));
    b.cyl('roof', r + 1.30, r + 2.00, 0.80, 8, x, y0 + 2.72, z, shade(C.tile, 1 + f * 0.012));
    // 壁柱：八棱塔身的八根角柱
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      b.box('wood', 0.26, bodyH, 0.26, x + Math.sin(a) * (r + 0.10), y0 + bodyH / 2, z + Math.cos(a) * (r + 0.10), shade(C.woodRed, 0.86));
    }
    b.kit('pagoda.pilaster', 8, y0 + bodyH / 2);
    // 壶门 / 塔窗：每层八面四门四窗，逐层旋 45°（券洞层错），十三层共 48 窗
    const faceR = r * 0.95;
    const dw = Math.min(1.45, r * 0.30);
    const doorCy = y0 + 1.16;
    let doors = 0, wins = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const px = Math.sin(a), pz = Math.cos(a);
      const lat = (off: number): [number, number] => [x + px * faceR + Math.cos(a) * off, z + pz * faceR - Math.sin(a) * off];
      if (f > 0 && (k + f) % 2 === 0) {
        // 塔窗：C-ITM-0204 —— 砖券瞭望口（暗腔 + 两侧门桯 + 窗台 + 三块券脸石）
        const ww = Math.min(0.54, r * 0.14), wh = 0.94;
        b.box('ash', ww + 0.06, wh, 0.10, x + px * (faceR - 0.02), y0 + 1.20, z + pz * (faceR - 0.02), 0x2b2925, a);
        for (const s of [-1, 1]) {
          const [jx, jz] = lat(s * (ww / 2 + 0.06));
          b.box('ash', 0.11, wh, 0.17, jx, y0 + 1.20, jz, 0x6f6b60, a);
          const [ax2, az2] = lat(s * 0.17);
          b.box('ash', 0.15, 0.19, 0.16, ax2, y0 + 1.20 + wh / 2 + 0.03, az2, 0x6f6b60, a, 0, s * 0.66);
        }
        b.box('ash', ww + 0.32, 0.12, 0.19, x + px * faceR, y0 + 1.20 - wh / 2 - 0.07, z + pz * faceR, 0x87847a, a);
        b.box('ash', ww + 0.30, 0.13, 0.18, x + px * faceR, y0 + 1.20 + wh / 2 + 0.10, z + pz * faceR, 0x87847a, a);
        wins++;
      } else {
        // 壶门：木框 + 暖光门心 + 门额
        b.box('wood', dw, 1.85, 0.24, x + px * faceR, doorCy, z + pz * faceR, shade(C.woodDark, 1.05), a);
        b.box('glow', dw - 0.28, 1.50, 0.06, x + px * (faceR + 0.13), doorCy - 0.03, z + pz * (faceR + 0.13), f % 2 ? C.winGlow : C.neonGold, a);
        b.box('wood', dw + 0.22, 0.18, 0.18, x + px * (faceR + 0.05), y0 + 2.16, z + pz * (faceR + 0.05), shade(C.woodRed, 0.9), a);
        doors++;
      }
    }
    if (doors > 0) b.kit('pagoda.doorway', doors, doorCy);
    if (wins > 0) { b.kit('pagoda.window', wins, y0 + 1.20); winTotal += wins; }
    // 琉璃砖面（C-ITM-0199）塔身外皮：每层一道壶门下的琉璃带（三层色：琥珀/翠绿/琥珀）
    {
      const gr = r * 0.962;
      let tiles = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const px = Math.sin(a), pz = Math.cos(a);
        for (let j = 0; j < 9; j++) {
          const off = (j - 4) * 0.5;
          b.box('ceramic', 0.46, 0.22, 0.11,
            x + px * gr + Math.cos(a) * off, y0 + 0.14, z + pz * gr - Math.sin(a) * off,
            j % 3 === 1 ? shade(0xc9a13a, 1.0) : shade(0x3f7a4a, 1.05), a);
          tiles++;
        }
      }
      b.kit('pagoda.glazedBrick', tiles, y0 + 0.14);
    }
    // 平座：补掉檐顶与上层塔身之间的空档，上宽下窄做成挑台
    b.cyl('wood', rNext + 0.95, rNext + 0.58, 0.62, 8, x, y0 + 3.50, z, shade(C.woodDark, 1.1));
    b.kit('pagoda.balcony', 1, y0 + 3.50);
    // 千佛砖龛（C-ITM-0206）：平座外圈分层小龛——每层八面各 5 龛（龛框 + 暗腔 + 小佛像）
    {
      const nr = 0.924 * (rNext + 0.76) + 0.01;   // 挑台该高度的八棱面心
      let nichesN = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const px = Math.sin(a), pz = Math.cos(a);
        for (let j = 0; j < 5; j++) {
          const off = (j - 2) * 0.52;
          b.box('ash', 0.40, 0.46, 0.10, x + px * nr + Math.cos(a) * off, y0 + 3.46, z + pz * nr - Math.sin(a) * off, 0x6f6b60, a);
          b.box('ash', 0.27, 0.32, 0.08, x + px * (nr + 0.02) + Math.cos(a) * off, y0 + 3.44, z + pz * (nr + 0.02) - Math.sin(a) * off, 0x35322c, a);
          b.box('ceramic', 0.14, 0.22, 0.07, x + px * (nr + 0.06) + Math.cos(a) * off, y0 + 3.44, z + pz * (nr + 0.06) - Math.sin(a) * off, shade(0xd8c9a2, 1.0), a);
          nichesN++;
        }
      }
      b.kit('pagoda.buddhaNiche', nichesN, y0 + 3.46);
    }
    // 望柱 + 寻杖
    const railR = rNext + 0.86;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      b.box('wood', 0.16, 0.62, 0.16, x + Math.sin(a) * railR, y0 + 3.70, z + Math.cos(a) * railR, shade(C.woodRed, 0.92));
    }
    b.kit('pagoda.baluster', 8, y0 + 3.70);
    for (let k = 0; k < 8; k++) {
      const a0 = (k * Math.PI) / 4, a1 = ((k + 1) * Math.PI) / 4;
      const dx = Math.sin(a1) - Math.sin(a0), dz = Math.cos(a1) - Math.cos(a0);
      const mx = Math.sin(a0) + Math.sin(a1), mz = Math.cos(a0) + Math.cos(a1);
      b.box('wood', Math.hypot(dx, dz) * railR, 0.09, 0.09, x + (mx / 2) * railR, y0 + 3.92, z + (mz / 2) * railR, shade(C.woodRed, 1.05), Math.atan2(-dz, dx));
    }
    b.kit('pagoda.railing', 8, y0 + 3.92);
    // 檐角起翘：四对角各一块，rz 抬外侧端；檐下角灯
    const eaveR = (r + 2.00) * 0.7071;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const dx = sx * eaveR, dz = sz * eaveR;
      b.box('roof', 0.46, 0.13, 0.22, x + dx, y0 + 2.55, z + dz, C.ridge, Math.atan2(-dz, dx), 0, 0.5);
      b.box('glow', 0.15, 0.22, 0.15, x + dx * 0.97, y0 + 2.32, z + dz * 0.97, C.neonGold);
    }
    b.kit('pagoda.eaveFlip', 4, y0 + 2.55);
    b.kit('pagoda.cornerLamp', 4, y0 + 2.32);
    b.cyl('glow', r + 1.34, r + 1.34, 0.12, 8, x, y0 + 2.42, z, f % 2 ? C.neonCyan : C.neonGold, 0, 0, 0, true);
  }
  b.kit('pagoda.storey13', PAGODA_STORIES, PAGODA_CAP_Y / 2);
  b.kit('pagoda.windowTotal', winTotal, PAGODA_CAP_Y / 2);

  // 塔刹：露盘 → 覆钵 → 相轮六圈 → 宝珠 → 刹杆（无 glow 杆）
  const capY = PAGODA_CAP_Y;
  b.cyl('metal', 1.7, 2.1, 0.3, 12, x, capY + 0.15, z, bronze);
  b.kit('pagoda.dewPlate', 1, capY + 0.15);
  b.cyl('roof', 1.55, 2.0, 1.2, 12, x, capY + 0.9, z, shade(C.ridge, 1.25));
  b.kit('pagoda.bowl', 1, capY + 0.9);
  b.cyl('metal', 0.09, 0.12, 4.6, 6, x, capY + 2.15, z, bronzeD);
  b.kit('pagoda.mast', 1, capY + 2.15);
  for (let k = 0; k < 6; k++) {
    const rad = 1.4 - k * 0.17;
    b.cyl('metal', rad, rad, 0.13, 12, x, capY + 1.85 + k * 0.34, z, k % 2 ? shade(bronze, 1.18) : bronze);
  }
  b.kit('pagoda.ring', 6, capY + 1.85);
  b.cyl('metal', 0.14, 0.4, 0.55, 8, x, capY + 3.98, z, shade(bronze, 1.3));
  b.cyl('metal', 0.3, 0.15, 0.22, 8, x, capY + 4.3, z, shade(bronze, 1.45));
  b.kit('pagoda.finial', 2, capY + 4.1);
  // 塔院围墙（C-ITM-0208）：围塔一圈（x 512–552 / z 170–230），东墙留门朝城内南北街
  pagodaCourtWall(b, x, z);
}

/** 塔院围墙：四面院墙（夯土墙身 + 瓦顶压脊 + 角柱），东墙中开一门
 *  院落 40×60 以塔为心偏东留 3.5m 巡道、西侧留出 19m 前院给石亭 */
function pagodaCourtWall(b: Baker, px: number, pz: number): void {
  const x0 = px - 28, x1 = px + 12, z0 = pz - 30, z1 = pz + 30;
  const H = 2.6, TH = 0.62;
  // 沿 x 走向的墙（南北两道）
  const wallX = (zc: number, xa: number, xb: number): void => {
    const len = xb - xa, cx = (xa + xb) / 2;
    b.box('ash', len + 0.1, 0.26, TH + 0.14, cx, 0.13, zc, 0x87836f);
    b.box('wall', len, H, TH, cx, H / 2, zc, shade(C.plaster, 0.9));
    for (const s of [-1, 1]) b.box('roof', len + 0.24, 0.11, 0.44, cx, H + 0.06, zc + s * 0.24, shade(C.tile, 1.04), 0, s * 0.36, 0);
    b.box('roof', len + 0.2, 0.16, 0.22, cx, H + 0.16, zc, C.ridge);
    b.kit('pagoda.courtyardWall', 1, H / 2);
  };
  // 沿 z 走向的墙（东西两道）
  const wallZ = (xc: number, za: number, zb: number): void => {
    const len = zb - za, cz = (za + zb) / 2;
    b.box('ash', TH + 0.14, 0.26, len + 0.1, xc, 0.13, cz, 0x87836f);
    b.box('wall', TH, H, len, xc, H / 2, cz, shade(C.plaster, 0.9));
    for (const s of [-1, 1]) b.box('roof', 0.44, 0.11, len + 0.24, xc + s * 0.24, H + 0.06, cz, shade(C.tile, 1.04), 0, 0, -s * 0.36);
    b.box('roof', 0.22, 0.16, len + 0.2, xc, H + 0.16, cz, C.ridge);
    b.kit('pagoda.courtyardWall', 1, H / 2);
  };
  wallX(z0, x0, x1);
  wallX(z1, x0, x1);
  wallZ(x0, z0, z1);
  wallZ(x1, z0, pz - 2.1);
  wallZ(x1, pz + 2.1, z1);
  // 四角角柱
  for (const [cx2, cz2] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) {
    b.box('ash', 0.86, 0.3, 0.86, cx2, 0.15, cz2, 0x8a867a);
    b.box('ash', 0.7, H + 0.5, 0.7, cx2, (H + 0.5) / 2, cz2, 0x8f8b7d);
    b.box('roof', 1.0, 0.22, 1.0, cx2, H + 0.6, cz2, C.ridge);
  }
  b.kit('pagoda.courtyardPost', 4, H / 2);
  // 院门（东墙，净宽 4.2）：门柱 + 门额 + 小瓦顶 + 门槛 + 抱框
  for (const s of [-1, 1]) {
    b.box('ash', 0.72, 0.26, 0.72, x1, 0.13, pz + s * 2.1, 0x8a867a);
    b.box('wood', 0.56, 3.2, 0.56, x1, 1.6, pz + s * 2.1, shade(C.woodRed, 0.72));
  }
  b.box('ash', 0.9, 0.4, 4.9, x1, 3.4, pz, 0x8f8b7d);
  for (const s of [-1, 1]) b.box('roof', 1.06, 0.12, 5.7, x1 + s * 0.45, 3.7, pz, shade(C.tile, 1.05), 0, 0, -s * 0.32);
  b.box('roof', 0.26, 0.18, 5.7, x1, 3.82, pz, C.ridge);
  b.box('ash', 0.92, 0.16, 4.2, x1, 0.08, pz, 0x8d8a80);
  b.kit('pagoda.courtyardGate', 1, 1.6);
}

export function buildYamen(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // 大堂空心壳+内饰由 buildLandmarkInteriors 承接（47 卷府衙 R01-R15）
  // 照壁原本立在河心（z=−8.5，水面足迹 |z|<31 内）；整体南迁 54m 落到南岸岸上，
  // 照壁对着城内南北街南端尽头（V_STREETS x=560 的 z0=−60），大堂 z 中心 −74。
  const YZ = -62.5;
  b.box('wall', 30, 2.6, 0.8, 560, 1.3, YZ, shade(C.wallGray, 1.05));
  b.box('wood', 1, 6.2, 1, 548, 3.1, YZ, C.woodDark);
  b.box('wood', 1, 6.2, 1, 572, 3.1, YZ, C.woodDark);
  b.box('glow', 0.7, 0.7, 0.7, 548, 6.4, YZ, C.neonCyan, 0, 0, 0.78);
  b.box('glow', 0.7, 0.7, 0.7, 572, 6.4, YZ, C.neonCyan, 0, 0, 0.78);
  sg.quad(atlas.text('yabanner', '肅靜迴避', 64, 260, { color: '#ffec9e', vertical: true, fontPx: 44, bg: 'rgba(20,8,8,0.7)' }), 1.1, 4.4, 548, 3.6, YZ + 0.3, 0);
}

export function buildGoulan(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const x = 306, z = 78;
  // 围栏
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    b.box('wood', 0.22, 2.3, 0.22, x + Math.cos(a) * 24, 1.15, z + Math.sin(a) * 18, C.wood);
  }
  // 棚架
  for (const px of [-16, 16]) for (const pz of [-11, 11]) b.box('wood', 0.6, 8.5, 0.6, x + px, 4.25, z + pz, C.woodDark);
  // ---- 攒尖席棚（45 卷：直径 30m 圆锥攒尖、苇席 #D4B76A 搭接 0.3m、布幔压边、麻绳扎结）----
  // 旧版是两块 38×27 / 26×17 的平板箱体叠起来，从棚下看是一整块黑板，从空中看是一块灰色地砖。
  // 改成八棱攒尖：下檐椭圆(长轴 19m × 短轴 13.7m) → 顶部收尖，苇席面用 fabric 组（有经纬光泽，不像屋面瓦）。
  const MAT = 0xd4b76a;   // 新苇席
  const MAT2 = 0x8a5a2b;  // 旧席（补丁/搭接缝）
  // 檐口檩条：一圈方形木框承托席顶，棚下抬头能看到结构而不是空白
  for (const s of [-1, 1]) {
    b.box('wood', 34, 0.34, 0.34, x, 8.5, z + s * 11.6, C.woodDark);
    b.box('wood', 0.34, 0.34, 23.2, x + s * 17, 8.5, z, C.woodDark);
  }
  // 主锥面（八棱）
  b.cyl('fabric', 1.1, 19, 5.6, 8, x, 11.4, z, MAT, Math.PI / 8, 0, 0, false, 1, 1, 0.72);
  // 檐口下垂的布幔（压边）：开口圆柱，一截 1.0m 高的裙边
  b.cyl('fabric', 19.05, 19.35, 1.0, 8, x, 8.0, z, 0x9d2933, Math.PI / 8, 0, 0, true, 1, 1, 0.72);
  // 顶饰（宝顶）
  b.cyl('wood', 0.16, 0.5, 1.2, 8, x, 14.7, z, C.woodDark);
  b.box('glow', 0.5, 0.5, 0.5, x, 15.4, z, C.neonMag, 0, 0, Math.PI / 4);
  // 檐口霓虹灯管（赛博层）
  b.box('glow', 30, 0.12, 0.12, x, 8.35, z + 13.2, C.neonMag);
  b.box('glow', 30, 0.12, 0.12, x, 8.35, z - 13.2, C.neonMag);
  // 戏台
  b.box('wood', 12, 1.6, 9, x - 8, 0.8, z, C.wood);
  b.box('wood', 13, 0.3, 10, x - 8, 1.7, z, C.woodDark);
  sg.quad(atlas.text('goulan', '勾欄瓦舍', 320, 84, { color: '#ffd7ec', glow: '#ff2d95', bg: 'rgba(16,6,18,0.9)', border: 'rgba(255,45,149,.8)', fontPx: 56 }), 9, 2.4, x - 8, 8.0, z + 8, 0);
}

export function buildDock(b: Baker): void {
  // 码头平台 + 桩 + 短塔吊
  for (const [dx, dz, w, d] of [[-238, 24, 42, 14], [-206, 20, 18, 10], [-268, 22, 20, 10]] as const) {
    b.box('wood', w, 0.5, d, dx, 0.9, dz, shade(C.wood, 0.95));
    for (let i = 0; i <= w / 4; i++) for (const pz of [-d / 2 + 1, d / 2 - 1]) {
      b.cyl('wood', 0.24, 0.28, 3.4, 6, dx - w / 2 + i * 4, -0.2, dz + pz, shade(C.woodDark, 0.9));
    }
  }
  b.box('wood', 0.5, 9, 0.5, -226, 4.5, 30, C.woodDark);
  b.box('wood', 0.35, 5.5, 0.35, -223, 6.6, 26.4, C.woodDark, 0, 0, -0.6);
  b.box('wood', 0.06, 3.4, 0.06, -220.6, 4.9, 25.2, C.woodDark, 0, 0, -0.35);
  // ---- 漕运货栈：仓房退到岸带、门朝水（原坐标 z 5.5…12.5 落在水面足迹内，水面恢复后读作「三片屋顶浮在河上」）----
  // 真正的空带只有 34.8（R13 纤道外缘）…39.4（临河铺面挑檐最南缘）这 4.6m：
  // 仓房进深 3.2、屋面出檐 0.4 → 屋顶落在 35.15…39.15，两端各留 0.25m，不压纤道也不穿挑檐。
  // 装卸面朝 −z 接码头甲板，货堆与灯杆落在仓间空地。
  const SHED_Z = 37.15;
  const sheds: [number, number, number, number][] = [[-238, SHED_Z, 16, 3.2], [-214, SHED_Z, 10, 3.2], [-264, SHED_Z, 12, 3.2]];
  for (const [sx, sz, sw, sd] of sheds) {
    b.box('wall', sw, 3.6, sd, sx, 1.8, sz, shade(0xb5a582, 0.98));
    b.box('roof', sw + 1.1, 2.0, sd + 0.8, sx, 4.0, sz, shade(C.tile2, 1.05));
    b.box('roof', sw + 0.4, 0.26, 0.5, sx, 4.95, sz, C.ridge);
    for (let d = 0; d < 3; d++) {
      b.box('wood', 0.2, 2.8, 0.2, sx - sw / 2 + 1.1 + d * (sw - 2.2) / 2, 1.4, sz - sd / 2 - 0.1, C.woodDark);
    }
    b.box('wood', sw * 0.5, 2.4, 0.14, sx, 1.2, sz - sd / 2 - 0.12, 0x2a1c12);
    b.box('glow', 0.6, 0.7, 0.06, sx + sw * 0.3, 2.7, sz - sd / 2 - 0.16, C.winGlow);
    // 门前货堆与灯杆：落在仓间空地，不占纤道、不压铺面
    for (let c = 0; c < 3; c++) {
      b.box('wood', 1.1, 0.9, 1.1, sx + sw / 2 + 1.5 + c * 1.2, 0.45, sz, shade(0x6a5238, 0.95 + c * 0.06));
      if (c < 2) b.box('wood', 0.9, 0.7, 0.9, sx + sw / 2 + 1.5 + c * 1.2, 1.25, sz, 0x74603f);
    }
    b.cyl('wood', 0.09, 0.12, 3.6, 5, sx - sw / 2 - 0.9, 1.8, sz, C.woodDark);
    b.box('glow', 0.26, 0.36, 0.26, sx - sw / 2 - 0.9, 3.7, sz, C.lantern);
  }
  // 码头边的缆桩与货担
  for (let i = 0; i < 6; i++) {
    b.cyl('wood', 0.16, 0.22, 1.1, 6, -256 + i * 8, 1.5, 18.5, C.woodDark);
  }
  for (let i = 0; i < 4; i++) {
    b.box('wood', 1.2, 0.5, 0.7, -246 + i * 5.5, 1.15, 16.2, shade(0x6a5238, 1.02));
  }
}

export function buildFarms(b: Baker, rng: RNG): void {
  for (let i = 0; i < 7; i++) {
    const x = rng.range(-580, -380), z = rng.chance(0.5) ? rng.range(80, 150) : rng.range(-160, -70);
    const w = rng.range(5, 8), d = rng.range(4, 6);
    b.box('wall', w, 2.4, d, x, 1.2, z, 0xb5a582);
    b.box('roof', w + 1.6, 2.2, d + 1.6, x, 3.4, z, shade(C.tile2, 1.2));
    for (let fx = -1; fx <= 1; fx += 2) b.box('wood', 0.18, 1.1, 0.18, x + fx * w * 0.4, 0.55, z + d / 2 + 0.3, C.wood);
    // 田垄
    b.box('ground', 14, 0.3, 9, x + 12, 0.1, z + 8, C.field);
    b.box('ground', 14, 0.3, 9, x - 12, 0.1, z - 8, shade(C.field, 0.85));
  }
}

// ============ 街宅小件（城内地块 / 院门 / 街口）：7 件 + 匾额落地 ============
/** 入口木牌坊（C-ITM-0152）：两柱一间木构，花板题「積善堂」宅匾，落在宅院门前 */
function cityEntryPaifang(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, name: string, key: string, plaqueKit: string): void {
  const HW = 4.3;
  for (const s of [-1, 1]) {
    const px = x + s * HW;
    b.box('ash', 0.96, 0.34, 0.96, px, 0.17, z, 0x8d897d);          // 柱础
    b.box('ash', 0.66, 0.5, 0.66, px, 0.55, z, 0x82806f);           // 夹杆石
    b.box('wood', 0.46, 6.2, 0.46, px, 3.1, z, C.woodDark);         // 方柱
    for (const t of [-1, 1]) b.box('wood', 0.16, 2.1, 0.16, px, 1.05, z + t * 0.9, shade(C.wood, 0.9), 0, t * 0.42, 0); // 戗柱
    b.box('wood', 0.86, 0.2, 0.6, px, 5.32, z, shade(C.woodRed, 1.0)); // 小斗
  }
  b.box('wood', HW * 2 + 0.9, 0.42, 0.5, x, 5.6, z, shade(C.woodRed, 1.05));   // 额枋
  b.box('wood', HW * 2 + 0.4, 0.16, 0.62, x, 5.86, z, shade(C.woodRed, 0.9));
  b.box('lacquer', 6.4, 1.14, 0.26, x, 6.5, z, shade(C.woodDark, 1.05));       // 花板
  b.box('wood', 6.9, 0.14, 0.4, x, 7.14, z, shade(C.neonGold, 0.45));
  b.box('roof', 9.8, 0.32, 1.9, x, 7.36, z, shade(C.tile, 1.12));             // 小瓦顶
  b.box('roof', 8.4, 0.2, 0.42, x, 7.6, z, C.ridge);
  sg.quad(atlas.text(key, name, 336, 88, { color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(14,10,8,0.9)', border: 'rgba(255,179,0,.85)', fontPx: 52 }), 5.6, 1.0, x, 6.5, z + 0.17, 0);
  b.kit('city.paifangEntry', 1, 3.1);
  b.kit(plaqueKit, 1, 6.5);
}

/** 積善堂宅院门（院墙 + 门屋 + 门扇 + 影壁）：入口木牌坊的落地本体 */
function cityManorGate(b: Baker, x: number, z: number): void {
  const GW = 4.4, SEG = 6.0;
  for (const s of [-1, 1]) {
    const sx = x + s * (GW / 2 + SEG / 2);
    b.box('ash', SEG + 0.2, 0.3, 0.74, sx, 0.15, z, 0x87836f);
    b.box('wall', SEG, 2.7, 0.62, sx, 1.35, z, shade(C.plaster, 0.94));
    b.box('roof', SEG + 0.5, 0.24, 1.1, sx, 2.84, z, shade(C.tile, 1.02));
    b.box('roof', SEG + 0.5, 0.14, 0.36, sx, 3.04, z, C.ridge);
  }
  b.kit('city.manorWall', 2, 1.35);
  for (const s of [-1, 1]) {
    b.box('ash', 0.56, 0.26, 0.72, x + s * GW / 2, 0.13, z, 0x8a867a);
    b.box('wood', 0.38, 3.5, 0.52, x + s * GW / 2, 1.75, z, shade(C.woodRed, 0.7));
    b.box('metal', 0.16, 0.16, 0.3, x + s * 0.9, 3.62, z + 0.34, shade(0xd8b028, 0.6)); // 门簪
  }
  b.box('wood', GW + 0.9, 0.42, 0.56, x, 3.62, z, shade(C.woodRed, 0.8));
  b.box('roof', GW + 2.4, 0.3, 1.9, x, 3.93, z, shade(C.tile, 1.06));
  b.box('roof', GW + 2.4, 0.14, 0.4, x, 4.16, z, C.ridge);
  for (const s of [-1, 1]) {
    b.box('lacquer', GW / 2 - 0.06, 2.5, 0.1, x + s * GW / 4, 1.4, z, shade(C.woodRed, 0.55)); // 门扇
    b.cyl('metal', 0.13, 0.13, 0.05, 8, x + s * (GW / 4 + 0.7), 1.35, z + 0.08, shade(0xd8b028, 0.5), 0, Math.PI / 2); // 铺首
  }
  b.box('ash', GW + 0.4, 0.16, 1.0, x, 0.08, z + 0.1, 0x8d8a80);
  b.kit('city.manorGate', 1, 1.75);
  // 影壁（门内 3.2m）
  b.box('ash', GW + 1.6, 0.2, 0.56, x, 0.1, z - 3.2, 0x87836f);
  b.box('wall', GW + 1.2, 2.3, 0.34, x, 1.15, z - 3.2, shade(C.plaster2, 0.9));
  b.box('roof', GW + 1.7, 0.24, 0.8, x, 2.42, z - 3.2, shade(C.tile, 1.04));
  b.kit('city.manorScreen', 1, 1.15);
}

/** 上马石（C-ITM-0413）：三级石阶 + 卷云肩，宅院门前左右各一 */
function cityMountingStone(b: Baker, x: number, z: number): void {
  b.box('ash', 1.7, 0.3, 1.05, x, 0.15, z, 0x8b887c);
  b.box('ash', 1.26, 0.42, 0.86, x, 0.51, z, 0x83806f);
  b.box('ash', 0.94, 0.46, 0.66, x, 0.95, z, 0x8f8b7d);
  for (const s of [-1, 1]) b.box('ash', 0.3, 0.2, 0.5, x, 0.62, z + s * 0.62, 0x7d7a6c);
  b.kit('city.mountingStone', 1, 0.6);
}

/** 戍铺（C-ITM-0300）：军巡铺——台基、板壁、门窗、瓦顶、兵器架、长凳、火盆、灯 */
function cityGuardPost(b: Baker, x: number, z: number): void {
  b.box('ash', 5.0, 0.3, 4.2, x, 0.15, z, 0x8a867a);
  b.box('wall', 4.2, 2.5, 3.4, x, 1.55, z, shade(C.plaster2, 0.96));
  b.box('wood', 4.3, 0.18, 3.5, x, 2.86, z, C.woodDark);
  b.box('roof', 5.8, 0.3, 4.9, x, 2.98, z, shade(C.tile, 1.08));
  b.box('roof', 3.4, 0.2, 0.4, x, 3.18, z, C.ridge);
  b.box('wood', 1.2, 2.0, 0.14, x, 1.3, z + 1.72, 0x2a1c12);
  b.box('wood', 1.06, 0.92, 0.1, x + 1.35, 1.75, z + 1.72, C.woodDark);
  b.box('glow', 0.88, 0.74, 0.06, x + 1.35, 1.75, z + 1.78, C.winGlow);
  // 兵器架：三杆枪 + 一横刀
  for (let i = 0; i < 3; i++) b.cyl('wood', 0.05, 0.06, 2.6, 5, x - 1.7 + i * 0.42, 1.3, z + 2.3, shade(C.wood, 0.8));
  b.box('metal', 0.5, 0.06, 0.12, x - 1.49, 2.52, z + 2.3, 0x9aa0a6);
  b.box('wood', 0.16, 0.9, 0.14, x - 0.6, 0.45, z + 2.3, C.woodDark);
  // 长凳 + 火盆 + 门灯
  b.box('wood', 1.8, 0.12, 0.42, x + 1.2, 0.52, z + 2.35, shade(C.wood, 1.05));
  for (const s of [-1, 1]) b.box('wood', 0.14, 0.5, 0.36, x + 1.2 + s * 0.7, 0.26, z + 2.35, C.woodDark);
  b.cyl('metal', 0.34, 0.24, 0.4, 8, x - 1.5, 0.34, z + 1.9, 0x4a453c);
  b.box('glow', 0.42, 0.1, 0.42, x - 1.5, 0.5, z + 1.9, 0xff7a3c);
  b.cyl('wood', 0.07, 0.09, 3.1, 5, x + 2.1, 1.55, z + 1.9, C.woodDark);
  b.box('glow', 0.26, 0.34, 0.26, x + 2.1, 3.2, z + 1.9, C.lantern);
  b.kit('city.guardPost', 1, 1.55);
}

/** 排门板（C-ITM-0451）：铺面卸下的排门板靠墙斜码 + 落地平码 + 捆绳 */
function cityDoorPlanks(b: Baker, x: number, z: number): void {
  for (let i = 0; i < 4; i++) {
    b.box('wood', 0.09, 1.95, 0.52, x, 1.28, z - 0.9 + i * 0.56, shade(C.wood, 0.92 + (i % 2) * 0.1), 0, 0, 0.2);
  }
  for (let i = 0; i < 2; i++) {
    b.box('wood', 0.52, 0.09, 1.9, x + 0.62, 0.05 + i * 0.1, z - 0.4, shade(C.wood, 0.86));
  }
  b.box('fabric', 0.1, 0.06, 1.4, x + 0.05, 1.3, z, 0x6b5b3e);
  b.kit('city.doorPlank', 6, 1.0);
}

/** 嘉量（C-ITM-0022）：标准量器——石座 + 铜斛 + 四耳 + 盖钮，立于街口 */
function cityJialiang(b: Baker, x: number, z: number): void {
  b.box('ash', 1.15, 0.9, 1.15, x, 0.45, z, 0x8b887c);
  b.box('ash', 1.32, 0.12, 1.32, x, 0.96, z, 0x9a9789);
  b.box('metal', 0.6, 0.44, 0.6, x, 1.24, z, shade(0x6b5a34, 1.05));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('metal', 0.12, 0.3, 0.12, x + sx * 0.34, 1.3, z + sz * 0.34, shade(0x7a6733, 1.1));
  }
  b.box('metal', 0.72, 0.1, 0.72, x, 1.5, z, shade(0x7a6733, 1.0));
  b.cyl('metal', 0.08, 0.1, 0.2, 8, x, 1.64, z, shade(0xb08a2a, 1.2));
  b.box('lacquer', 0.9, 0.5, 0.06, x, 0.6, z + 0.6, shade(0x2a1c12, 1.0));
  b.kit('city.jialiang', 1, 1.24);
}

/** 地龙火道口（C-ITM-0038）：台基上方的火膛口——石框、铁栅、余烬、烟道、灰堆 */
function cityFireDuct(b: Baker, x: number, z: number): void {
  b.box('ash', 1.5, 0.24, 0.85, x, 0.72, z + 0.32, 0x8b887c);              // 台基上石踏
  b.box('ash', 1.7, 0.2, 0.32, x, 1.98, z, 0x8a867a);                      // 门楣
  for (const s of [-1, 1]) b.box('ash', 0.22, 1.3, 0.32, x + s * 0.74, 1.27, z, 0x8a867a);
  b.box('ash', 1.22, 1.2, 0.16, x, 1.25, z - 0.02, shade(0x2b2925, 1.0));  // 火膛暗腔
  for (let i = 0; i < 5; i++) b.box('metal', 0.06, 1.1, 0.1, x - 0.52 + i * 0.26, 1.25, z + 0.14, 0x4e4a42);
  b.box('metal', 1.24, 0.06, 0.1, x, 1.78, z + 0.14, 0x4e4a42);
  b.box('glow', 1.0, 0.16, 0.1, x, 0.88, z + 0.06, 0xff6a2a);              // 余烬
  b.box('ash', 0.38, 1.5, 0.32, x + 0.62, 2.92, z - 0.06, 0x86836f);       // 烟道
  b.box('ash', 0.56, 0.16, 0.46, x + 0.62, 3.74, z - 0.06, 0x9a9789);
  for (const [ox, oz, w2] of [[-0.95, 0.62, 0.7], [0.05, 0.86, 0.55], [0.95, 0.55, 0.6]] as const) {
    b.box('ash', w2, 0.22, 0.5, x + ox, 0.11, z + oz, 0x3a3833);            // 灰堆
  }
  b.kit('city.fireDuctMouth', 1, 1.25);
}

/** 花园石亭（C-ITM-0410）：仿木石构——石台基、四石柱、石枋、瓦顶、坐凳、石桌、花池，悬「守拙齋」斋匾 */
function cityGardenPavilion(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, name: string, key: string, plaqueKit: string): void {
  b.box('ash', 5.6, 0.36, 5.6, x, 0.18, z, 0x8b887c);
  b.box('ash', 4.9, 0.14, 4.9, x, 0.43, z, 0x9a9789);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * 1.85, pz = z + sz * 1.85;
    b.box('ash', 0.62, 0.22, 0.62, px, 0.6, pz, 0x8a867a);
    b.cyl('ash', 0.2, 0.24, 2.75, 8, px, 1.95, pz, 0x9c9889);
    b.box('ash', 0.34, 0.2, 0.34, px, 3.28, pz, 0x8a867a);
  }
  for (const [w2, d2, ox, oz] of [[4.1, 0.24, 0, 1.85], [4.1, 0.24, 0, -1.85], [0.24, 4.1, 1.85, 0], [0.24, 4.1, -1.85, 0]] as const) {
    b.box('ash', w2, 0.3, d2, x + ox, 3.52, z + oz, 0x94907f);
  }
  b.box('ash', 0.18, 0.5, 2.6, x + 1.86, 3.52, z, 0x87836f);               // 石额（朝院门一侧）
  sg.quad(atlas.text(key, name, 264, 64, { color: '#2a2118', bg: 'rgba(224,216,198,0.94)', border: 'rgba(120,110,92,.9)', fontPx: 40 }), 2.2, 0.54, x + 1.97, 3.52, z, Math.PI / 2);
  b.roofC('roof', x, 3.72, z, shade(C.tile, 1.06), 0, 6.4, 1.35, 6.4);
  b.cyl('ash', 0.16, 0.26, 0.5, 8, x, 5.3, z, 0x9a9789);
  b.kit('city.gardenPavilion', 1, 1.95);
  b.kit(plaqueKit, 1, 3.52);
  for (const s of [-1, 1]) {
    b.box('ash', 3.0, 0.16, 0.5, x, 0.98, z + s * 1.5, 0x8f8b7d);
    for (const t of [-1, 1]) b.box('ash', 0.4, 0.44, 0.44, x + t * 1.2, 0.7, z + s * 1.5, 0x827e6f);
  }
  b.cyl('ash', 0.62, 0.66, 0.16, 12, x, 0.56, z, 0x8f8b7d);
  b.cyl('ash', 0.3, 0.34, 0.5, 10, x, 0.3, z, 0x827e6f);
  for (const [ox, oz] of [[-3.6, -2.6], [3.4, 2.8]] as const) {
    b.box('ash', 1.6, 0.5, 1.2, x + ox, 0.25, z + oz, 0x8a867a);
    b.box('leaf', 1.4, 0.3, 1.0, x + ox, 0.55, z + oz, 0x35592f);
    b.box('glow', 0.16, 0.16, 0.16, x + ox - 0.3, 0.62, z + oz, 0xc8ff8a);
  }
  b.kit('city.pavilionBench', 2, 0.98);
}

/** 城内地块 / 院门 / 街口 7 件落位（WS-31） */
function buildCityStreetItems(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // ① 城内地块：積善堂宅院——入口木牌坊 + 院门影壁 + 上马石一对（匾「積善堂」）
  cityEntryPaifang(b, sg, atlas, 492, 41.6, '積善堂', 'sign_jishantang', 'city.plaqueJishanTang');
  cityManorGate(b, 492, 38);
  cityMountingStone(b, 486.6, 44.2);
  cityMountingStone(b, 497.4, 44.2);
  // ② 城门内街口：戍铺 + 排门板 + 嘉量
  cityGuardPost(b, 473, 40.5);
  cityDoorPlanks(b, 475.35, 40.5);
  cityJialiang(b, 479.6, 44.4);
  // ③ 上清觀台基：地龙火道口（落在装饰柱 536.2 与板门 539 之间的空档）
  cityFireDuct(b, 537.7, 123.1);
  // ④ 塔院西院：花园石亭（斋匾「守拙齋」）
  cityGardenPavilion(b, sg, atlas, 521, 213, '守拙齋', 'sign_shouzhuozhai', 'city.plaqueShouZhuoZhai');
}

// ============ W15 街口牌楼 / 坊内草棚 / 街口石敢当 ============
// 缘起：W11 的六种形制里 gate / shed 只有代码路径，本城的 streetPlots() 不产这两种 kind，
// 所以 gateframe / shed 一栋都没落地。本段给它们真实落位，四条纪律：
//  ① 随机性一律走坐标 hash（h01），**不插进 buildAllCityBuildings 的共享 rng 链**（下游数值逐位不变）；
//  ② 不新增材质、不改 C、不新增 b.kit() id（本段一次 kit 都不调）；
//  ③ 只用 b.box / b.cyl / 既有 roofOn / dougongBand / sg.quad，面数可逐件核算；
//  ④ 落位避让既有地标禁入区、摊位带与树带（见各表注释）。

/** 坐标 hash（0–1）：与 infill.ts / imperial.ts 的 h01 同式（+1 偏移），零状态、零 RNG */
function h01(a: number, b: number, c: number): number {
  let t = (Math.imul(Math.round(a) + 1, 0x27d4eb2d) ^ Math.imul(Math.round(b) + 1, 0x165667b1) ^ Math.imul(c + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** 坊内地坪：城内 terrainSurfaceY 恒为 −0.5（world/terrain：cityMask=0 → 高度 0，再 −0.5 下沉），
 *  草棚台基底压到 −0.52（入土 2cm）。不 import world/terrain：那会再造一条 terrain → buildings 的环，
 *  而城内高度是常量，常量更省。 */
const WARD_BASE = -0.52;

/**
 * 牌楼落位表（8 处）：沿 H_STREETS 的街口，距路口 8–9m，统一 ry=π/2（面阔跨街、脊跨街、匾额沿街可读）。
 * 净跨 = 街宽 + 1.2，柱心 = 街沿外 0.6m（11m 街 → 6.1；9m 街 → 5.1），**车道内不设柱**。
 * 避让（各落点 18m 内无冲突）：地标禁入区 [213,239,51,75] / 虹桥桥头摊带 x −40..40 /
 * 市集摊带 x 140..372 且 z≥62 / 码头摊带 x −260..−210 / 城门内摊带 480..560 且 z≥60 / 卦摊 (−150,44)。
 */
const PAIFANG_SITES: readonly (readonly [number, number, number, string])[] = [
  [-412, 52, 12.2, '御街'],      // 郊野路（x=−420）街口东 8m，北岸正街西端
  [52, 52, 12.2, '虹橋'],        // 桥东巷（x=60）街口西 8m，虹桥东北桥口
  [105, 52, 12.2, '十千腳店'],   // 十千脚店（x 114.5–129.5）铺前街口：坊门在侧、街口在店前
  [199, 52, 12.2, '孫羊正店'],   // 市场巷一（x=190）街口东 9m，孙羊正店门前
  [292, 52, 12.2, '瓦子'],       // 市场巷二（x=300）街口西 8m，勾栏瓦舍北
  [404, 52, 12.2, '相國寺'],     // 城门前路（x=396）街口东 8m
  [388, -52, 10.2, '州橋'],      // 城门前路（x=396）街口西 8m，南岸街
  [552, 52, 12.2, '大相國寺前'], // 城内南北街（x=560）街口西 8m
];

/**
 * 街口牌楼：2 柱跨街而立（柱脚在街沿外 0.6m）+ 柱头斗栱 + 一道小楼顶 + 正中匾额。
 * 柱身收到 0.32（柱心 6.1 → 柱面 57.94），与北侧铺面挑檐外缘（57.9）只擦 4cm，不构成穿模。
 */
function streetPaifangOn(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, span: number, name: string, key: string): void {
  const ry = Math.PI / 2;     // 面阔沿 z：跨街而立，匾额朝 ±x
  const H = 6.5;              // 柱高
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  for (const lx of [-span / 2, span / 2]) {
    const [px, pz] = at(lx, 0);
    b.box('ash', 0.88, 0.34, 0.88, px, 0.17, pz, 0x8d897d, ry);                            // 柱础石
    b.box('ash', 0.60, 0.56, 0.60, px, 0.62, pz, 0x82806f, ry);                            // 夹杆石
    b.box('wood', 0.32, H - 0.90, 0.32, px, 0.90 + (H - 0.90) / 2, pz, C.woodDark, ry);    // 方柱（6.5m）
    const t2 = lx > 0 ? -1 : 1;
    const [cx2, cz2] = at(lx + t2 * 0.56, 0.40);
    b.box('wood', 0.14, 1.80, 0.14, cx2, 0.90, cz2, shade(C.woodDark, 0.9), ry, 0, t2 * 0.42); // 戗柱
  }
  // 柱头铺作：本文件既有 dougongBand（9 攒 × 5 件 + 一道通长压槽）
  dougongBand(b, x, H - 0.44, z, span + 0.4, ry, shade(C.woodRed, 1.04));
  // 额枋 + 垫板
  b.box('wood', span + 1.0, 0.34, 0.48, x, H + 0.02, z, shade(C.woodRed, 1.02), ry);
  b.box('wood', span + 0.6, 0.16, 0.56, x, H + 0.26, z, shade(C.woodRed, 0.88), ry);
  // 匾额：匾板挂在压槽（5.62）之下，匾心 4.85，净空 4.15m（车马可过）
  const pw = Math.min(span * 0.46, 3.8), ph = (pw * 144) / 512;
  b.box('lacquer', pw + 0.36, ph + 0.34, 0.26, x, 4.85, z, shade(C.woodDark, 1.06), ry);
  const [qx, qz] = at(0, 0.19);
  sg.quad(atlas.text(key, name, 512, 144, {
    color: '#ffe9c8', glow: '#ffb300', bg: 'rgba(12,10,18,0.88)', border: 'rgba(255,179,0,0.8)', fontPx: 104,
  }), pw, ph, qx, 4.85, qz, ry);
  // 楼顶：小尺寸 roofOn（脊跨街），hOverride 1.2（不落瓦垄：w×d < 150）
  roofOn(b, span + 1.4, 2.9, H + 0.36, x, z, ry, C.tile, undefined, 1.2);
  // 柱头灯笼（吊杆 + 灯身）
  for (const lx of [-span / 2, span / 2]) {
    const [px, pz] = at(lx, 0.34);
    b.box('wood', 0.06, 0.46, 0.06, px, 5.80, pz, C.woodDark, ry);
    b.box('glow', 0.26, 0.36, 0.26, px, 5.40, pz, C.lantern, ry);
  }
}

function buildStreetPaifangs(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  for (let i = 0; i < PAIFANG_SITES.length; i++) {
    const [x, z, span, name] = PAIFANG_SITES[i];
    streetPaifangOn(b, sg, atlas, x, z, span, name, `paifang${i}`);
  }
}

interface ShedSpec { x: number; z: number; ry: number; w: number; d: number; use: number }

/**
 * 坊内草棚：单坡苇席顶（fabric 组 0xd4b76a）+ 三面席墙 + 无窗，3.5–6m 见方、檐高 2.25–2.60m。
 * 三种用途的差异（屋顶坡度 / 门口位置 / 棚下堆放）：
 *   柴棚 use=0 —— 落差 1.05（最陡）、檐高 2.25、正面长边敞开，棚前码柴垛；
 *   牲口棚 use=1 —— 落差 0.72（最缓）、檐高 2.60、门口在 −x 端头（正面补席墙封住），棚前置石槽；
 *   货棚 use=2 —— 落差 0.88、檐高 2.40、正面敞开但偏一端挂半截席帘，棚下码货箱。
 * 三型都是三面席墙。侧墙上段只补后 55% 且压在坡面下（顶 = eaveH + 0.35·drop − 0.2 ≤ 该处屋面高）。
 */
function wardShedOn(b: Baker, o: ShedSpec): void {
  const { x, z, ry, w, d, use } = o;
  const MAT = 0xd4b76a;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const drop = use === 0 ? 1.05 : use === 1 ? 0.72 : 0.88;
  const eaveH = use === 0 ? 2.25 : use === 1 ? 2.60 : 2.40;   // 前檐（低端）
  const backH = eaveH + drop;                                  // 后檐（高端）
  // 夯土台基：基底入土 2cm（坊内地表 terrainSurfaceY = −0.5），台基面即全棚的 y0 基准
  const foot = WARD_BASE;
  b.box('earth', w + 0.5, 0.24, d + 0.5, x, foot + 0.12, z, 0x8f7f63, ry);
  const y0 = foot + 0.24;
  // 背墙（贴后檐，顶压在坡面下 0.24）
  const [bx, bz] = at(0, -(d / 2 - 0.08));
  b.box('fabric', w, backH - 0.24, 0.1, bx, y0 + (backH - 0.24) / 2, bz, shade(MAT, 0.94), ry);
  // 侧墙：下段通长、上段只补后 55%（牲口棚的 −x 侧整片不封 = 门口）
  const upH = drop * 0.35 + 0.35;
  for (const s2 of [-1, 1] as const) {
    if (use === 1 && s2 < 0) continue;
    const [qx1, qz1] = at(s2 * (w / 2 - 0.08), 0);
    b.box('fabric', 0.1, eaveH - 0.55, d, qx1, y0 + (eaveH - 0.55) / 2, qz1, shade(MAT, 0.9), ry);
    const [qx2, qz2] = at(s2 * (w / 2 - 0.08), -(d * 0.225));
    b.box('fabric', 0.1, upH, d * 0.55, qx2, y0 + (eaveH - 0.55) + upH / 2, qz2, shade(MAT, 0.9), ry);
  }
  // 牲口棚：门口挪到 −x 端头 → 正面补第三面席墙（顶压到前檐下 0.24）
  if (use === 1) {
    const [fx, fz] = at(0, d / 2 - 0.08);
    b.box('fabric', w - 0.4, eaveH - 0.24, 0.1, fx, y0 + (eaveH - 0.24) / 2, fz, shade(MAT, 0.92), ry);
  }
  // 单坡顶：后高前低（苇席），檐口一道压边 + 两道搭接条
  // 全部构件统一在 y0 基准上叠加：屋面中心 y0 + backH − drop/2，前檐口落在 y0 + eaveH
  const run = d + 0.7;
  const a = Math.atan2(drop, run);
  pane(b, 'fabric', x, z, ry, 0, y0 + backH - drop / 2, 0, Math.hypot(run, drop), w + 0.6, 0.09, Math.PI / 2, a, MAT);
  for (let i = 0; i < 2; i++) {
    const lz = (-0.25 + 0.5 * i) * d;
    pane(b, 'fabric', x, z, ry, 0, y0 + backH - drop / 2 - 0.09, lz, Math.hypot(run, drop) * 0.9, 0.1, 0.06,
      Math.PI / 2, a, shade(MAT, 0.82));
  }
  const [ex, ez] = at(0, run / 2);
  b.box('fabric', w + 0.6, 0.12, 0.18, ex, y0 + eaveH - 0.04, ez, shade(MAT, 0.88), ry);
  // 前柱：柱顶压到前檐下 0.12（不留悬空），低于苇席上表面
  const pH = eaveH - 0.12;
  for (const s2 of [-1, 1] as const) {
    const [cx2, cz2] = at(s2 * (w / 2 - 0.14), run / 2 - 0.12);
    b.box('wood', 0.14, pH, 0.14, cx2, y0 + pH / 2, cz2, C.woodDark, ry);
  }
  // 用途件：柴垛 / 石槽 / 货箱（各 2–3 件，位置随门口走）
  if (use === 0) {
    for (let i = 0; i < 2; i++) {
      const [px, pz] = at(-w * 0.22 + i * 0.1, d / 2 + 0.55);
      b.box('wood', 1.5 - i * 0.2, 0.52, 0.9, px, y0 + 0.26 + i * 0.5, pz, shade(0x6a5238, 0.94 + i * 0.08), ry);
    }
  } else if (use === 1) {
    const [px, pz] = at(-(w / 2) - 0.75, d * 0.16);
    b.box('ash', 0.5, 0.44, 1.55, px, foot + 0.44, pz, 0x87836f, ry);               // 石槽
    b.box('ash', 0.34, 0.1, 1.4, px, foot + 0.69, pz, 0x2f2a22, ry);                // 槽内饮水
    const [fx, fz] = at(-(w / 2) - 0.7, -d * 0.26);
    b.box('fabric', 0.9, 0.5, 1.1, fx, foot + 0.55, fz, shade(MAT, 0.86), ry);       // 草料堆
  } else {
    for (let i = 0; i < 2; i++) {
      const [px, pz] = at(w * 0.18, d * 0.16 - i * 1.25);
      b.box('wood', 0.95, 0.72, 0.95, px, y0 + 0.36, pz, shade(0x6a5238, 0.92 + i * 0.1), ry);
    }
    // 半截席帘：横在正面偏一侧（宽沿面阔、厚 0.06），上端吊在前檐下
    const [px, pz] = at(-w * 0.3, run / 2 - 0.1);
    b.box('fabric', w * 0.5, pH - 0.9, 0.06, px, y0 + eaveH - 0.12 - (pH - 0.9) / 2, pz, shade(MAT, 0.8), ry);
  }
}

/**
 * 草棚落位：每坊 2–4 座，落在「坊心 → 坊墙」的两段环带（前 12 次尝试 r ∈ [half−70, half−42]，
 * 后 12 次收到 r ∈ [half−120, half−90]），每坊最多试 24 个坐标、到数即停。
 * 三道否判（实测 451 次尝试里卡掉 16 路廊 / 37 手工带 / 15 坊墙 / 6 间距）：
 *   ① roadBlocked(x, z, 包络 + 1.8m)：不压大路路廊；
 *   ② wardReserved：不进临河手工段 / 宫城 / 东西市；
 *   ③ 任意坊的 nominal 坊圈 |Chebyshev − half| ≥ 包络 + 6m：坊墙边线只歪 ±2.8m、四角歪 ±18m，
 *      留 6m 缓冲后实测最小净距 6.20m —— **不穿坊墙、不穿坊门**（本坊实测 ≥20.9m）。
 * 结果（复算脚本核验）：377 座 / 122 坊，每坊 2–4 座，柴棚 130 / 牲口棚 124 / 货棚 123。
 */
function buildWardSheds(b: Baker): void {
  const cells = wardCells();
  const placed: number[] = [];
  const ringClear = (x: number, z: number, env: number): boolean => {
    for (const c of cells) {
      const cheb = Math.max(Math.abs(x - c.cx), Math.abs(z - c.cz));
      if (Math.abs(cheb - c.half) < env + 6) return false;
    }
    return true;
  };
  for (const c of cells) {
    const want = 2 + Math.floor(h01(c.cx, c.cz, 4101) * 3);        // 2–4 座
    let got = 0;
    for (let i = 0; i < 24 && got < want; i++) {
      const band = i < 12 ? 0 : 1;
      const ang = h01(c.cx, c.cz, 4110 + i) * Math.PI * 2;
      const rad = c.half - (band ? 90 + 30 * h01(c.cx, c.cz, 4120 + i) : 42 + 28 * h01(c.cx, c.cz, 4120 + i));
      const x = c.cx + Math.cos(ang) * rad;
      const z = c.cz + Math.sin(ang) * rad;
      const w = 3.5 + 1.9 * h01(x, z, 4130);
      const d = 3.5 + 1.9 * h01(x, z, 4131);
      const env = Math.hypot(w, d) * 0.5;
      if (roadBlocked(x, z, env + 1.8)) continue;
      if (wardReserved(x, z)) continue;
      if (!ringClear(x, z, env)) continue;
      let clash = false;
      for (let k = 0; k < placed.length; k += 2) {
        if (Math.abs(placed[k] - x) < 16 && Math.abs(placed[k + 1] - z) < 16) { clash = true; break; }
      }
      if (clash) continue;
      placed.push(x, z);
      got++;
      wardShedOn(b, { x, z, ry: h01(x, z, 4140) * Math.PI * 2, w, d, use: Math.floor(h01(x, z, 4141) * 3) });
    }
  }
}

/** 石敢当：0.3×1.2×0.2 石条 + 立座 + 压顶，正面（朝街）刻字用 sg.quad */
function shiGandangOn(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, key: string): void {
  const ry = Math.PI / 2;   // 石面朝 ±x（沿街可读）
  b.box('ash', 0.52, 0.16, 0.44, x, 0.08, z, 0x87836f, ry);
  b.box('ash', 0.30, 1.20, 0.20, x, 0.76, z, 0x9a9689, ry);
  b.box('ash', 0.36, 0.10, 0.26, x, 1.41, z, 0x807c6d, ry);
  sg.quad(atlas.text(key, '石敢當', 96, 288, {
    color: '#2a2118', vertical: true, fontPx: 74, bg: 'rgba(214,206,188,0.92)', border: 'rgba(120,110,92,0.8)',
  }), 0.22, 0.66, x + 0.11, 0.78, z, ry);   // 96×288 的 UV 格 ↔ 0.22×0.66 的匾面：纵横比逐值相等，字不被拉扁
}

/** 井台：石台 + 井圈 + 井口暗腔 + 辘轳（两柱一轴 + 吊桶） */
function courtyardWellOn(b: Baker, x: number, z: number): void {
  b.box('ash', 2.0, 0.18, 2.0, x, 0.09, z, 0x8b887c);
  b.box('ash', 1.6, 0.14, 1.6, x, 0.24, z, 0x9a9789);
  b.cyl('ash', 0.64, 0.70, 0.66, 10, x, 0.62, z, 0x86826f);
  b.cyl('ash', 0.50, 0.50, 0.06, 10, x, 0.96, z, 0x241f1a);      // 井口暗腔
  for (const s of [-1, 1] as const) {
    b.box('wood', 0.14, 1.35, 0.14, x + s * 0.78, 0.98, z, C.woodDark);
  }
  b.cyl('wood', 0.09, 0.09, 1.42, 6, x, 1.62, z, shade(C.wood, 0.9), 0, 0, Math.PI / 2);
  b.box('fabric', 0.05, 0.34, 0.05, x, 1.42, z, 0x6b5b3e);        // 井绳（挂在轴上）
  b.cyl('wood', 0.17, 0.14, 0.28, 8, x, 1.12, z, shade(C.wood, 0.86)); // 吊桶（悬在井口上方）
}

/** 拴马桩：石座 + 石柱 + 顶石 + 铁环 */
function hitchingPostOn(b: Baker, x: number, z: number): void {
  b.box('ash', 0.52, 0.16, 0.52, x, 0.08, z, 0x87836f);
  b.box('ash', 0.34, 1.15, 0.34, x, 0.74, z, 0x8f8b7d);
  b.box('ash', 0.44, 0.12, 0.44, x, 1.36, z, 0x827e6f);
  b.box('metal', 0.06, 0.22, 0.06, x + 0.2, 1.06, z, 0x6a655c);
}

/** 街口杂项落位：石敢当 5 座（五座牌楼侧的街角）+ 塔院井台 2 处 + 孙羊正店门前拴马桩 2 根 */
function buildW15StreetMarks(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // 石敢当：贴路缘外 0.12m（路缘 57.5 → 57.62），避开檐柱（58.05）与柜台（58.6）
  const GD: readonly (readonly [number, number])[] = [[-408.8, 57.62], [55.2, 57.62], [108.2, 57.62], [295.2, 57.62], [407.2, 57.62]];
  for (let i = 0; i < GD.length; i++) shiGandangOn(b, sg, atlas, GD[i][0], GD[i][1], `shigandang${i}`);
  // 井台：塔院（x 512–552 / z 170–230）内两处空档——塔基 531.5–548.5（z 191.5–208.5）、石亭 518.2–523.8（z 210.2–215.8）
  courtyardWellOn(b, 526.5, 205);
  courtyardWellOn(b, 533.0, 219);
  // 拴马桩：孙羊正店（x 216–236，面阔 20m）门前两侧，落在地标禁入区内（该带不产自动地块）
  hitchingPostOn(b, 214.8, 58.4);
  hitchingPostOn(b, 237.2, 58.4);
}

// ============ 全城建筑总装 ============
/**
 * 已有手工室内壳的 9 座（坐标必须与 interiors.ts 的 STREET_HOUSE_SLOTS 一致）。
 * 这里按坐标判重而不是 import 那个常量：interiors.ts 已经 import 本文件，再反向 import 会成环。
 * 命中就不补通用室内衬，否则两层地坪/两道内壁会互相 z-fight。
 */
const BESPOKE_INTERIOR_AT: readonly (readonly [number, number])[] = [
  [168, 64], [258, 64], [352, 66], [40, 62], [-36, 62], [540, 118],
  [-258, 36.6], [-208, 36.6], [-330, 36.6],
];
function hasBespokeInterior(x: number, z: number): boolean {
  for (const [ax, az] of BESPOKE_INTERIOR_AT) if (Math.abs(ax - x) < 1.2 && Math.abs(az - z) < 3.5) return true;
  return false;
}

const yieldFrameB = (): Promise<void> => new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r()); else setTimeout(r, 0); });

/**
 * 全城街屋。**异步分片**：`sorted` 每条街屋要建街墙、后院、厢房、屋面、门窗、檐口，
 * 一次跑完实测 2.1s，整段阻塞主线程。现在每 30 条让一帧，单次占用降到 ~0.15s。
 */
export async function buildAllCityBuildings(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): Promise<void> {
  const shopSigns = ['綢緞莊', '香藥鋪', '解當鋪', '紙馬鋪', '明家靴店', '劉家上色沉檀揀香', '王家紙馬', '果子鋪', '飯鋪', '唐家酒店', '久住王員外家', '積善堂', '守拙齋', '萬貨全'];
  // NH-03 玄霓·电紫（0x8a2be2）按调色板只属于「玄门 / 纸马铺」，不参与街屋随机轮转：
  // 旧池子里 55% 的普通铺面会随机拿到紫色檐灯，配合 detailKit 的通长条读成「紫色发光横带」。
  // 紫色仍保留给显式指定的 王家紙馬（见下方的落位表）。
  const shopNeon = [C.neonMag, C.neonCyan, C.neonGreen, C.neonGold, C.neonOrange];
  let idx = 0;
  const emit = async (plots: Plot[], opt: { floors: [number, number]; ornateChance?: number }): Promise<void> => {
    // 街墙与后院：把"一排孤立房子"补成连续街墙 + 进深院落
    const sorted = [...plots].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && i % 30 === 0) await yieldFrameB();
      const p = sorted[i];
      const facing = p.ry === Math.PI ? -1 : 1;
      const frontZ = p.z + facing * (p.d / 2 + 0.18);
      const next = sorted[i + 1];
      if (next) {
        const gap = (next.x - next.w / 2) - (p.x + p.w / 2);
        if (gap > 1.2 && gap < 9) {
          // 院墙补缝：临街不再出现整段空洞
          b.box('wall', gap, 2.3, 0.5, p.x + p.w / 2 + gap / 2, 1.15, frontZ, shade(C.plaster, 0.94));
          b.box('roof', gap + 0.3, 0.22, 0.9, p.x + p.w / 2 + gap / 2, 2.32, frontZ, C.tile);
          b.box('wood', gap, 0.14, 0.6, p.x + p.w / 2 + gap / 2, 0.2, frontZ, C.stone);
        }
      }
      // 后院：后墙 + 两侧山墙 + 两间厢房
      const backZ = p.z - facing * (p.d / 2 + 7.2);
      b.box('wall', p.w + 1.2, 2.6, 0.5, p.x, 1.3, backZ, shade(C.plaster2, 0.92));
      for (const sx of [-1, 1]) {
        b.box('wall', 0.5, 2.4, 7.4, p.x + sx * (p.w / 2 + 0.35), 1.2, p.z - facing * (p.d / 2 + 3.6), shade(C.plaster2, 0.88));
      }
      for (const sx of [-1, 1]) {
        const wx2 = p.x + sx * p.w * 0.26;
        const wz2 = backZ + facing * 3.1;
        b.box('wall', p.w * 0.34, 2.5, 3.4, wx2, 1.25, wz2, shade(C.plaster, 0.9));
        // 双坡屋面 + 正脊（原来的平屋面板从上往下看就是一块黑板）
        for (const sz2 of [-1, 1]) {
          b.box('roof', p.w * 0.4, 0.16, 2.5, wx2, 2.62, wz2 + sz2 * 0.95, shade(C.tile, 0.94), 0, sz2 * 0.34, 0);
        }
        b.box('roof', p.w * 0.42, 0.2, 0.5, wx2, 3.02, wz2, C.ridge);
        b.box('glow', 0.7, 0.8, 0.06, wx2, 1.5, wz2 - facing * 1.75, C.winGlow);
      }
      b.kit('block.courtyard', 1);
      // 沿河铺面：幌子 + 灯笼串 + 檐下酒旗（河岸带 40m 内才加，避免全城泛滥）
      if (Math.abs(p.z) > 38 && Math.abs(p.z) < 62) {
        const fx2 = p.x + p.w * 0.34;
        const fz2 = frontZ + facing * 0.9;
        b.box('wood', 0.16, 7.0, 0.16, fx2, 3.5, fz2, C.woodDark);
        const bannerC = [0x9d2933, 0x2a5c42, 0x3a4a7a][Math.abs(Math.round(p.x)) % 3];
        b.box('fabric', 1.7, 3.1, 0.05, fx2 + 0.9, 5.1, fz2, bannerC);
        b.box('wood', 1.85, 0.1, 0.1, fx2 + 0.86, 6.68, fz2, C.woodDark);
        b.box('glow', 0.3, 0.4, 0.3, fx2, 7.15, fz2, C.lantern);
        // 檐下两盏串灯
        for (const s3 of [-1, 1]) {
          b.box('glow', 0.22, 0.3, 0.22, p.x + s3 * p.w * 0.28, 3.5, frontZ + facing * 0.6, C.lantern);
          b.box('wood', 0.04, 0.5, 0.04, p.x + s3 * p.w * 0.28, 3.9, frontZ + facing * 0.6, C.woodDark);
        }
        b.kit('riverside.banner', 1);
      }
    }
    for (const p of plots) {
      const pr = Math.max(p.w, p.d) / 2; // 包络检测：任一角入禁入区即让位
      if (inLandmarkKeepout(p.x, p.z) || inLandmarkKeepout(p.x - pr, p.z) || inLandmarkKeepout(p.x + pr, p.z) || inLandmarkKeepout(p.x, p.z - pr) || inLandmarkKeepout(p.x, p.z + pr)) continue;
      const floors = rng.int(opt.floors[0], opt.floors[1]);
      const neon = rng.chance(0.55) ? rng.pick(shopNeon) : undefined;
      buildBuilding(b, sg, atlas, {
        x: p.x, z: p.z, ry: p.ry, w: p.w, d: p.d, floors, neon,
        signText: p.sign, signGlow: neon !== undefined ? '#' + neon.toString(16).padStart(6, '0') : undefined,
        ornate: opt.ornateChance ? rng.chance(opt.ornateChance) : false,
        kind: p.kind,
        hasInterior: hasBespokeInterior(p.x, p.z),
        wallC: rng.chance(0.4) ? WALL_TONES[(idx * 3) % 5] : WALL_TONES[(idx * 3 + 2) % 5],
      }, idx++);
    }
  };
  // 北岸正街：主商业街
  await emit(streetPlots(H_STREETS[0], 1, rng, ['shop', 'shop', 'teahouse', 'tavern', 'house'], { gapMin: 1.5, gapMax: 5, wMin: 8, wMax: 16, dMin: 7, dMax: 12, signChance: 0.75, signs: shopSigns }), { floors: [1, 2], ornateChance: 0.16 });
  await emit(streetPlots(H_STREETS[0], -1, rng, ['shop', 'tavern', 'teahouse', 'house'], { gapMin: 2, gapMax: 6, wMin: 7, wMax: 14, dMin: 6, dMax: 10, signChance: 0.7, signs: shopSigns }), { floors: [1, 2] });
  // 南岸
  await emit(streetPlots(H_STREETS[1], 1, rng, ['house', 'shop', 'tavern', 'house'], { gapMin: 3, gapMax: 8, wMin: 6, wMax: 12, dMin: 5, dMax: 9, signChance: 0.5, signs: shopSigns }), { floors: [1, 2] });
  await emit(streetPlots(H_STREETS[1], -1, rng, ['house', 'house', 'shop'], { gapMin: 4, gapMax: 9, wMin: 6, wMax: 11, dMin: 5, dMax: 8, signChance: 0.4, signs: shopSigns }), { floors: [1, 2] });
  // 后街与城内
  await emit(streetPlots(H_STREETS[2], 1, rng, ['house', 'shop', 'house'], { gapMin: 3, gapMax: 7, wMin: 6, wMax: 12, dMin: 5, dMax: 9, signChance: 0.4, signs: shopSigns }), { floors: [1, 2] });
  await emit(streetPlots(H_STREETS[3], 1, rng, ['manor', 'house', 'shop'], { gapMin: 4, gapMax: 9, wMin: 8, wMax: 15, dMin: 7, dMax: 11, signChance: 0.3, signs: shopSigns }), { floors: [1, 2] });

  // 手工地标：孙羊正店/十千脚店/府衙大堂 = 可进入内饰版（B1，47 卷逐间表）
  buildLandmarkInteriors(b, sg, atlas);
  buildBuilding(b, sg, atlas, { x: 168, z: 64, ry: 0, w: 9, d: 8, floors: 1, signText: '趙太丞家', signGlow: '#3dff9c', neon: C.neonGreen, signColor: '#d9ffe9', hasInterior: true }, 63);
  buildBuilding(b, sg, atlas, { x: 258, z: 64, ry: 0, w: 10, d: 8, floors: 1, signText: '解', signGlow: '#ff2d95', neon: C.neonMag, signColor: '#ffe9c8', hasInterior: true }, 64);
  buildBuilding(b, sg, atlas, { x: 352, z: 66, ry: 0, w: 12, d: 9, floors: 1, signText: '王家紙馬', signGlow: '#b26bff', neon: C.neonPurple, hasInterior: true }, 65);
  buildBuilding(b, sg, atlas, { x: 40, z: 62, ry: 0, w: 10, d: 8, floors: 2, signText: '香藥鋪', signGlow: '#00e5ff', neon: C.neonCyan, hasInterior: true }, 66);
  buildBuilding(b, sg, atlas, { x: -36, z: 62, ry: 0, w: 11, d: 9, floors: 2, signText: '茶坊', signGlow: '#ffb300', neon: C.neonGold, hasInterior: true }, 67);
  buildBuilding(b, sg, atlas, { x: 540, z: 118, ry: 0, w: 16, d: 10, floors: 1, signText: '上清觀', signGlow: '#00e5ff', neon: C.neonCyan, wallC: 0xc4b598, hasInterior: true }, 68);
  buildYamen(b, sg, atlas);
  buildGoulan(b, sg, atlas);
  buildCityWall(b, sg, atlas);
  buildPagoda(b);
  // WS-40 塔/像/庙殿 25 件（塔 3 件已随 buildPagoda 长在塔体上，其余 22 件在此落位）
  buildDevotionalWorks(b, sg, atlas);
  // WS-31 街宅小件 7 件：城内地块/院门/街口（塔院石亭落在 buildPagoda 建好的塔院西院）
  buildCityStreetItems(b, sg, atlas);
  buildDock(b);
  buildFarms(b, rng);
  // W15：牌楼 / 草棚 / 街口杂项——随机性全走坐标 hash，不消耗 rng（下游序列逐位不变）
  buildStreetPaifangs(b, sg, atlas);
  buildWardSheds(b);
  buildW15StreetMarks(b, sg, atlas);
}

// ============ 平民屋顶：三档距离剪影 + 定向法线瓦垄 + 按坊分片色板 ============
// 判词（用户原话，逐条对应）：
//  ①「平民的房屋，房顶全不正确！！」
//  ②「两坡悬山单元重做：明确的正脊（0.25m 高、带脊饰）、檐口 0.15m 厚的封檐板、山墙露头」
//  ③「屋面材质换成带方向性法线的（瓦垄方向），让不同坡面在不同光下有明暗差」
//  ④「按距离三档各做一套屋顶剪影，远档只保『脊线 + 檐口暗边』两条信息」
//  ⑤「屋顶色板扩到 6–8 档（青灰/深灰/褐/草/苇席），按坊分片，不再全城一色」

/** 屋顶色板 8 档：青灰 / 深灰 / 褐 / 草 / 苇席 / 青绿 / 土黄 / 铅灰（CJ-03 一带，线性都压在 0.2 以下） */
export const ROOF_PALETTE: readonly number[] = [
  0x333a45, 0x2a2f36, 0x4a3a2c, 0x6b6448, 0x9a8a5c, 0x3a4a42, 0x5a4a34, 0x444a52,
];

/** 按坊分片的屋顶色：同一坊同一色，相邻坊不同色，全城读成"分片铺开"而不是一色到底 */
export function wardRoofHex(cellX: number, cellZ: number, salt = 457): number {
  const h = Math.imul((cellX | 0) * 73856093 ^ (cellZ | 0) * 19349663 ^ salt, 2246822519) >>> 0;
  return ROOF_PALETTE[h % ROOF_PALETTE.length];
}

export type RoofTier = 1 | 2 | 3;

/** 距离三档：方形半径（与城郭同尺度）。1100m 内近档，2600m 内中档，由此向外远档 */
export function roofTierAt(x: number, z: number): RoofTier {
  const r = Math.max(Math.abs(x), Math.abs(z));
  return r < 1100 ? 1 : r < 2600 ? 2 : 3;
}

/**
 * 瓦垄坡面几何：沿檐向分 N 列，每列抬降交替 → 相邻列法线方向相反，
 * 两坡与垄沟在不同光位下自然出明暗差（不再靠整坡乘一个色差常数假装）。
 * 顶点色同步乘 RIB 明暗，贴图 mip 抹平后仍读得出垄。
 * 局部系：x = 沿檐向（宽度 W），y = 上，z = 下坡向（长度 L，0 在脊、L 在檐）。
 */
function ribbedSlopeGeo(W: number, L: number, H: number, N: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const RIBS = 0.34;           // 宋式筒瓦垄距
  const UV_TILE = 2.4;
  const drop = (i: number): number => (i % 2 === 0 ? 0.055 : -0.02);
  const shadeOf = (i: number): number => (i % 2 === 0 ? 1.16 : 0.82);
  for (let i = 0; i < N; i++) {
    const x0 = -W / 2 + (W * i) / N, x1 = -W / 2 + (W * (i + 1)) / N;
    const k0 = shadeOf(i), k1 = shadeOf(i + 1);
    const y0 = drop(i), y1 = drop(i + 1);
    const u0 = (x0 / UV_TILE), u1 = (x1 / UV_TILE);
    const v0 = 0, v1 = L / UV_TILE;
    // 两三角：脊端 (x,y,0) → 檐端 (x,y−H,L)。坡度同样烘进几何，不交给 rx。
    pos.push(
      x0, y0, 0, x1, y1, 0, x1, y1 - H, L,
      x0, y0, 0, x1, y1 - H, L, x0, y0 - H, L,
    );
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    col.push(k0, k0, k0, k1, k1, k1, k1, k1, k1, k0, k0, k0, k1, k1, k1, k0, k0, k0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  void RIBS;
  return g;
}

/**
 * 平坡面（中档用）：一整片斜板，1 个四边形 → 2 面。
 * 坡度必须烘进几何（脊端 y=0、檐端 y=−H），**不能**靠 push 的 rx 参数表达：
 * bake.push 用的是 Euler('XYZ') = Rx·Ry·Rz，rx≠0 且 ry=π 时会把坡上下翻，
 * 于是"屋顶"变成朝天的白色平板（实测：隐藏 city_roof_9 后画面平均亮度 178→62，
 * 说明这一批屋面本身就是白板）。ry 只负责朝向，坡度在几何里。
 */
function flatSlopeGeo(W: number, L: number, H: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const uvT = 2.4;
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -W / 2, 0, 0, W / 2, 0, 0, W / 2, -H, L,
    -W / 2, 0, 0, W / 2, -H, L, -W / 2, -H, L,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([
    -W / 2 / uvT, 0, W / 2 / uvT, 0, W / 2 / uvT, L / uvT,
    -W / 2 / uvT, 0, W / 2 / uvT, L / uvT, -W / 2 / uvT, L / uvT,
  ], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3));
  g.computeVertexNormals();
  return g;
}

export interface CommonerRoofOpt {
  x: number;
  z: number;
  /** 檐口标高（墙体顶面） */
  y: number;
  /** 面阔（沿檐向） */
  w: number;
  /** 进深（脊向垂直，前后坡跨此值） */
  d: number;
  ry: number;
  hex: number;
  /** 山墙色，近档做山花填充用 */
  wallC?: number;
  tier?: RoofTier;
}

/**
 * 平民两坡悬山屋顶（正房/厢房共用）。
 * 近档 1100m 内：定向法线瓦垄 + 0.25m 正脊带脊饰 + 0.15m 封檐板 + 山墙露头 + 檩头；
 * 中档 1100–2600m：正脊 + 封檐板 + 两片平坡（不烘垄、不做檩头）；
 * 远档 2600m 外：只留「脊线 + 檐口暗边」两条信息。
 * 面数：近档 ~2×N×2 + 脊/檐/檩头；中档 ~16；远档 ~24（两个薄箱）。
 */
export function commonerRoof(b: Baker, o: CommonerRoofOpt): void {
  const tier = o.tier ?? roofTierAt(o.x, o.z);
  const { x, z, y, w, d, ry, hex } = o;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + cosr * lx + sinr * lz, z - sinr * lx + cosr * lz];
  const overW = 0.34;   // 悬山：屋面挑出山墙 0.34m（檩头外露）
  const overD = 0.46;   // 前后檐出挑
  const W = w + overW * 2;
  const H = Math.max(0.9, Math.min(w, d) * 0.2 + 0.42);
  const L = d / 2 + overD;
  const ridgeY = y + H;

  if (tier === 3) {
    // 远档：只两条信息 —— 脊线（压暗）+ 檐口暗边。俯视 3km 外这两条就是屋顶的全部轮廓。
    const [rx, rz] = at(0, 0);
    b.box('roof', W, 0.3, 0.42, rx, ridgeY + 0.1, rz, shade(hex, 1.25), ry);
    const [ex, ez] = at(0, 0);
    b.box('roof', W, 0.1, d + overD * 2, ex, y - 0.02, ez, shade(hex, 0.55), ry);
    b.kit('roof.commonerFar', 1, ridgeY);
    return;
  }

  const N = tier === 1 ? Math.max(6, Math.min(14, Math.round(W / 0.95))) : 1;
  for (const s of [-1, 1] as const) {
    const [sx2, sz2] = at(0, 0);
    const geo = tier === 1 ? ribbedSlopeGeo(W, L, H, N) : flatSlopeGeo(W, L, H);
    // 局部 +z 从脊指向檐（坡度已烘在几何里）：s>0 时 +z 朝世界 +z，s<0 整片绕 Y 转 180°。
    // rx/rz 必须保持 0 —— 见 flatSlopeGeo 注释里的 Euler 陷阱。
    b.addGeo('roof', geo, sx2, ridgeY, sz2, tier === 1 ? hex : shade(hex, s > 0 ? 1.05 : 0.93),
      ry + (s > 0 ? 0 : Math.PI), 0, 0);
    // 封檐板 0.15m：檐口一道通长压边 + 一道更深的滴水唇
    const [ex, ez] = at(0, s * (d / 2 + overD));
    b.box('roof', W, 0.15, 0.3, ex, y - 0.05, ez, shade(hex, 1.1), ry);
    b.box('roof', W, 0.1, 0.16, ex, y - 0.16, ez, shade(hex, 0.5), ry);
    if (tier === 1) {
      // 檩头：山墙外露的檩子端头（悬山标志），两坡各 2 根 × 两端
      for (const sx of [-1, 1] as const) {
        for (let k = 0; k < 2; k++) {
          const t = 0.34 + k * 0.34;
          const [px, pz] = at(sx * (w / 2 + 0.1), s * (d / 2 + overD) * (1 - t));
          b.box('wood', 0.36, 0.14, 0.14, px, y + H * (1 - t) - 0.06, pz, shade(C.woodDark, 0.92), ry);
        }
      }
    }
  }
  // 正脊 0.25m + 两端脊饰（悬山不做鸱吻，做成小收头 + 一块脊心瓦）
  const [gx, gz] = at(0, 0);
  b.box('roof', W + 0.16, 0.25, 0.44, gx, ridgeY + 0.135, gz, shade(hex, 1.3), ry);
  for (const s of [-1, 1] as const) {
    const [px, pz] = at(s * (W / 2), 0);
    b.box('roof', 0.3, 0.4, 0.5, px, ridgeY + 0.2, pz, shade(hex, 1.45), ry);
  }
  if (tier === 1) {
    // 山墙露头：两端山花（墙顶之上逐级收进，避免与外墙共面闪烁）
    const wallC = o.wallC ?? 0x9a9080;
    for (const sx of [-1, 1] as const) {
      for (const [f, k] of [[0.3, 0.92], [0.62, 0.86]] as const) {
        const half = Math.max(0.3, (d / 2 - 0.15) * (1 - f));
        const [px, pz] = at(sx * (w / 2 - 0.07), 0);
        b.box('wall', 0.16, H * 0.36, half * 2, px, y + 0.12 + H * f, pz, shade(wallC, 1 - k * 0.06), ry);
      }
    }
  }
  b.kit(tier === 1 ? 'roof.commonerNear' : 'roof.commonerMid', 1, ridgeY);
}

// ============ 桥东广场：补掉「孤零零的一片」裸土 ============
// 判词（用户原话）：「这他妈孤零零的一片是什么，为什么没有和整个城市融为一体！」
// 成因：中央带 |x|<950 被 wardReserved 保留（不许建坊），而 streetPlots 只铺街两侧的排屋，
// 于是桥东/桥西各留出一块 200×200m 的纯土空地。这里只补「地面与市井」，不改任何既有建筑。
export function buildBridgePlaza(b: Baker, rng: RNG): void {
  const h = (a: number, c: number): number => {
    const v = Math.sin(a * 12.9898 + c * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  for (const sz of [1, -1] as const) {
    const z0 = sz * 38, z1 = sz * 300;
    // 铺装范围放大到 x 34–420、|z| 38–300：只补地面（y=0.06，低于街面 0.12 不会 z-fight），
    // 上一次按屏幕直觉只铺到 258×168，裸带仍在；这次按「宁可铺过、不可留空」处理，
    // 摊位与树仍只落在靠桥的 258 以内，避免压到既有院落。
    for (let x = 34; x < 420; x += 6) {
      for (let z = z0; sz > 0 ? z < z1 : z > z1; z += sz * 6) {
        const t = h(x * 0.11, z * 0.13);
        // y=0.22：必须高于地坪(0.12)与街面(0.12–0.2)，否则铺装被压在最底层，肉眼完全看不到
        // （前两轮「扩范围无效」的真因就是高度写成了 0.06）。
        b.box('ground', 5.7, 0.12, 5.7, x + 3, 0.22, z + sz * 3, shade(0x6b6670, 0.92 + t * 0.16));
      }
    }
    // 市井：两侧各 9 个摊位 + 8 棵树，靠广场外缘，留出中间 20m 通行
    for (let k = 0; k < 9; k++) {
      const px = 48 + k * 22 + h(k, sz) * 6;
      const pz = sz * (46 + (k % 3) * 12);
      b.box('wood', 2.2, 0.9, 1.4, px, 0.55, pz, 0x3a2c22);
      b.box('fabric', 2.8, 0.06, 1.9, px, 1.55, pz, k % 3 === 0 ? 0x2a5c42 : k % 3 === 1 ? 0x5c1b24 : 0x3a3448, 0, 0.12);
      for (const s of [-1, 1]) b.box('wood', 0.08, 1.0, 0.08, px + s * 1.1, 1.05, pz - 0.7, 0x201820);
      b.box('glow', 0.2, 0.28, 0.2, px + 1.1, 1.3, pz - 0.7, k % 2 ? 0xffb84a : 0x7dffd8);
      b.kit('plaza.stall', 1, 1.2);
    }
    for (let k = 0; k < 8; k++) {
      const px = 42 + k * 27 + h(k + 7, sz) * 8;
      const pz = sz * (150 + (k % 2) * 10);
      b.cyl('trunk', 0.18, 0.28, 3.2, 6, px, 1.6, pz, 0x5a4630);
      for (let c2 = 0; c2 < 5; c2++) {
        const a2 = c2 * 1.26;
        b.sphere('leaf', 1.5, 7, px + Math.cos(a2) * 1.1, 3.5 + (c2 % 2) * 0.5, pz + Math.sin(a2) * 1.1, shade(0x3f6a3c, 0.92 + (c2 % 3) * 0.06));
      }
      b.kit('plaza.tree', 1, 3.5);
    }
  }
  b.kit('plaza.pavers', 2, 0.22);
}
