import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from '../city/bake';
import { roofOn } from '../city/buildings';
import { buildCountryside } from '../city/infill';
import { RIVER_WATER_Y } from '../city/river';
import { buildPostStation } from './desertOutpost';
import { RNG } from '../core/rng';
// 山林生机（乔木/花丛/溪瀑/神兽锚点）：flora.ts 只 import type，运行时无环
import { buildMountainLife, type MountainSite } from '../sky/flora';
// R24 山上建筑室内陈设（主庙/厢房/廊庑/六件庙观/远景地标）：确定性 hash，零共享 RNG
import { furnishMountainBuilding, mtInteriorSeed, type MtBuildingType } from '../city/mountainInteriors';
// PERF-001 R2：地形顶点循环接入统一 8ms 时间预算 + 真实进度上报。
import { getBakeBudget } from '../core/bakeBudget';

// ============ 方圆百里山河：程序化地形高度场（五岳/天山/昆仑/沙漠/草原/森林/河湖） ============

// ---- 确定性值噪声 ----
function hash2(ix: number, iz: number): number {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
function fbm(x: number, z: number, oct = 3): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += (vnoise(x * f, z * f) * 2 - 1) * amp; amp *= 0.5; f *= 2.1; }
  return v; // 约 -1..1
}

// ---- 山川定义 ----
/** 山形制：七岳各走一套剖面，不再是同一个锥换缩放 */
export type MountainForm = 'blocky' | 'pyramidal' | 'rolling' | 'ridged' | 'twin' | 'parallel' | 'plateau';
export interface Mountain {
  name: string; x: number; z: number; h: number; r: number; snow: number; poe: string;
  /** 地貌形制（决定剖面/褶皱/峰列） */
  form: MountainForm;
  /** 主脊走向（弧度，0=+x，π/2=+z）：ridged/twin/parallel/pyramidal 的脊线与峡谷按此旋转 */
  axis: number;
  /** 雪线（0..1，按 h 归一）：覆盖 snow 字段的派生值，便于逐山定线 */
  snowLine?: number;
  /** 主溪流起始方位（弧度）：从山腰下到山脚 */
  streamAng: number;
  /** 是否配瀑布（泰山/华山/天山） */
  waterfall?: boolean;
}
/** R24：用户「三山五岳都那么小？？山体大小整体放大一倍，长宽高都加大一倍」。
 *  h（高）与 r（水平长宽半径）统一 ×2；x/z 保持不动 —— 七座山中心到城心的径向距离
 *  最小 15,231m（泰山），放大后最大 r=16,000m（昆仑）仍在城外，不会压进 |x|,|z|≤5000 的城池。
 *  所有下游（植被带、溪流、瀑布、地标、山体造型、探针台账）都按 m.h / m.r 归一，自动适配。 */
const MTN_R24_SCALE = 2;
export const MOUNTAINS: Mountain[] = ([
  // 泰山：浑圆厚重、方顶（superquadric 台体）、南坡十八盘台阶、顶上南天门
  // 五岳的 snowLine 压在 1.1 以上 = 秋季无雪盖（真实五岳秋季就是满山葱郁）；雪只留给天山/昆仑
  { name: '泰山', x: 14000, z: -6000, h: 1550, r: 3600, snow: 0.86, form: 'blocky',    axis: Math.PI / 2, snowLine: 1.12, streamAng: 0.95, waterfall: true, poe: '东岳泰山·五岳独尊' },
  // 华山：五峰如莲、四面绝壁、一条苍龙岭险道
  { name: '华山', x: -15000, z: 4000, h: 1700, r: 3200, snow: 0.82, form: 'pyramidal', axis: -Math.PI / 2, snowLine: 1.14, streamAng: 2.35, waterfall: true, poe: '西岳华山·奇险天下第一' },
  // 衡山：舒缓连绵、多峰、山林茂密
  { name: '衡山', x: 2000, z: 16500, h: 1250, r: 3900, snow: 0.95, form: 'rolling',   axis: 0, snowLine: 1.16, streamAng: 0.35, poe: '南岳衡山·五岳独秀' },
  // 恒山：东西横亘、峭壁夹峙（中央一道峡谷）、悬空寺贴崖
  { name: '恒山', x: -3500, z: -16200, h: 1350, r: 3500, snow: 0.8, form: 'ridged',    axis: 0, snowLine: 1.12, streamAng: 1.9, poe: '北岳恒山·人天北柱' },
  // 嵩山：双峰对峙、中间峡谷、少林在山脚
  { name: '嵩山', x: 9500, z: 10500, h: 1150, r: 3000, snow: 0.97, form: 'twin',      axis: 0, snowLine: 1.18, streamAng: 2.6, poe: '中岳嵩山·少林祖庭' },
  // 天山：三列平行山脉 + 雪线 + 冰川谷
  { name: '天山', x: -22000, z: -16000, h: 3300, r: 7000, snow: 0.52, form: 'parallel',  axis: 0, snowLine: 0.56, streamAng: 0.6, waterfall: true, poe: '天山·雪峰连绵七千里' },
  // 昆仑：高原来台、万山之祖、雪峰连绵、山体最厚重
  { name: '昆仑', x: -27000, z: 4000, h: 3800, r: 8000, snow: 0.45, form: 'plateau',   axis: 0, snowLine: 0.5, streamAng: 2.9, poe: '昆仑·万山之祖，西王母道场' },
] as Mountain[]).map((m) => ({ ...m, h: m.h * MTN_R24_SCALE, r: m.r * MTN_R24_SCALE }));
export interface Lake { name: string; x: number; z: number; rx: number; rz: number }
export const LAKES: Lake[] = [
  { name: '东洋巨泽', x: 11000, z: 5500, rx: 3000, rz: 2300 },
  { name: '北泽', x: -9000, z: -11500, rx: 1000, rz: 800 },
  { name: '南湖', x: 6200, z: -12500, rx: 750, rz: 620 },
  { name: '西湖泊', x: -8600, z: 9500, rx: 850, rz: 700 },
];
/**
 * 引水渠：城外河与城墙水关之间的那一段（`waterLink.ts` 的闸/跌水就落在这些坐标上）。
 *
 * 三级水位都是既有真相源，不另写第二份：
 *   城内汴河 **+1.0**（`city/river.ts` RIVER_WATER_Y）→ 护城河 **−0.35**（`city/imperial.ts` 冻结值）
 *   → 城外河 **−2.2**（本文件）。总落差 3.2m，分两级跌水，中间夹护城河这一「澳」：
 *   西/东河：水关外口 → 高渠 +1.0 → 跌水 1.35m → 护城河 −0.35 → 跌水 1.85m → 河面 −2.2；
 *   南/北河：护城河外岸 → 跌水 1.85m → 河面 −2.2。
 *
 * 为什么不是一级 3.2m：护城河水位由 `imperial.ts` 拥有（本轮冻结，改不得），
 * 河道必须从它上方过；把 3.2m 拆成「闸—澳—闸」正是宋代汴河澳闸的做法，
 * 且每一级都有可见的闸槽/叠梁闸/绞关/跌水槽，不是凭空消失。
 */
export interface RiverLink {
  /** 水关外口 |坐标|（城墙外皮 5007.3；`river.ts` 的 RIVER_END 5012 正好停在台体外口）*/
  wall: number;
  /** 护城河内岸 / 外岸 |坐标| */
  moatIn: number;
  moatOut: number;
  /** 第二级跌水（1.85m）的堰顶 |坐标|：西/东在护城河外岸，南/北在河头上游 69m */
  weir: number;
  /** 河头 |坐标|：跌水脚，河面从这里起算 */
  head: number;
  /** 西/东河为 true（有水关外高渠那一段），南/北河为 false（护城河直接接抬高渠） */
  gate: boolean;
}
/**
 * 河流折线（大地坐标）。首点必须在城墙外皮之外 ≥230m ——
 * 河床带的纵向外延是 `R + 80`（约 230m），再靠近就会伸进城里把城内地面挖穿。
 * `spring: true` 的河尾在山脚以石砌泉洞收口（`waterLink.ts`），不再是 alpha 淡出。
 */
export interface RiverDef { pts: [number, number][]; w: number; link?: RiverLink; spring?: boolean }
export const RIVERS: RiverDef[] = [
  { pts: [[-5246, 0], [-9000, 600], [-15000, 1400], [-22000, 2600]], w: 130, spring: true,  // 西河（昆仑雪水）
    link: { wall: 5012, moatIn: 5137, moatOut: 5183, weir: 5183, head: 5246, gate: true } },
  { pts: [[5246, 0], [8000, 900], [11000, 4500]], w: 150,                                    // 东河（入巨泽）
    link: { wall: 5012, moatIn: 5137, moatOut: 5183, weir: 5183, head: 5246, gate: true } },
  { pts: [[-2200, -5420], [-1600, -9500], [-6000, -11500]], w: 90, spring: true,             // 北河（草原）
    link: { wall: 0, moatIn: 5137, moatOut: 5183, weir: 5351, head: 5420, gate: false } },
  { pts: [[2600, 5420], [3600, 9800], [6200, 11800]], w: 100, spring: true,                  // 南河（森林）
    link: { wall: 0, moatIn: 5137, moatOut: 5183, weir: 5351, head: 5420, gate: false } },
  { pts: [[13100, -4300], [12200, -1500], [11000, 3800]], w: 90, spring: true },             // 泰山河（入泽）
];
export const DESERT = { cx: -16000, cz: -14500, rx: 9500, rz: 7500 };
export const GRASS = { cx: 1500, cz: -11000, rx: 8000, rz: 5000 };

export function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ============ 七岳形制：每座山一套剖面 ============
/**
 * 旧版七山共用 `h * pow(1 - md, 1.9)` 一个锥（只有 h/r 不同），所以用户看到的是
 * 「七座山长得一模一样」。这里按真实地貌给每座山一套独立的归一化高度场：
 *
 *   泰山 blocky    超二次方（方）台体 + 平顶 + 南坡十八盘台阶化
 *   华山 pyramidal 四面绝壁 + 五峰如莲 + 苍龙岭窄脊
 *   衡山 rolling   宽基座 + 6 个高斯峰（舒缓连绵）
 *   恒山 ridged    东西长脊 + 中央峡谷（峭壁夹峙）
 *   嵩山 twin      东西双峰 + 中间深切峡谷
 *   天山 parallel  三列平行山脊 + 不归零的冰川谷底
 *   昆仑 plateau   陡缘高台 + 台上五座雪峰
 *
 * 返回值归一到 ≈1（再乘 m.h），各形制的最大高度由 MOUNTAIN_K 标定到 m.h ±3%。
 * 全程只用确定性 vnoise/fbm，不碰 Math.random。
 */
const MOUNTAIN_K: Record<MountainForm, number> = {
  blocky: 1.0, pyramidal: 1.0, rolling: 1.05, ridged: 1.2, twin: 0.91, parallel: 1.08, plateau: 1.015,
};

// R21 远景骨架常量：山脊/冲沟只用 ≥300m 波长的低频有符号函数，103m 网格(62000/600)才读得出棱线。
// ridgeAmp/gullyAmp 是归一化高度 k 的幅度(×m.h 后约 ±300m 起伏)，零均值不整体抬高峰顶。
const MTN_SKELETON = { ridgeFreq: 1.7, ridgeAmp: 0.11, gullyCount: 7, gullyAmp: 0.095 } as const;

/** 把 (u,v) 旋到山脊坐标系：a 沿 axis，b 垂直 axis */
function ridgeRot(u: number, v: number, axis: number): [number, number] {
  const c = Math.cos(axis), s = Math.sin(axis);
  return [u * c + v * s, -u * s + v * c];
}

function mountainField(m: Mountain, x: number, z: number): number {
  const u = (x - m.x) / m.r, v = (z - m.z) / m.r;
  const [a, b] = ridgeRot(u, v, m.axis);
  let k: number;
  switch (m.form) {
    case 'blocky': {
      // R19：旧式 1−smoothstep(0.34,1.0) 是一条平滑钟形，600 段网格实拍仍读作「绿色大山包」。
      // 改成台状断崖：中心 0.50 半径内近满高的平顶，0.50→0.80 陡降收成崖壁；
      // 再沿 |a|≈|b| 的对角线抬出四条硬棱，远景才能读出「方顶 + 绝壁」而不是圆丘。
      const sq = Math.pow(Math.pow(Math.abs(a), 4) + Math.pow(Math.abs(b), 4), 0.25);
      // R21：方顶台体更方（超二次方权重 0.68→0.84）、断崖更陡（过渡带 0.50→0.80 收成 0.52→0.66）
      const rn = sq * 0.84 + Math.hypot(u, v) * 0.16;
      const plateau = 1 - smoothstep(0.52, 0.66, rn);
      k = Math.pow(Math.max(0, plateau), 0.42);
      const diag = 1 - Math.min(1, Math.abs(Math.abs(a) - Math.abs(b)) / 0.10);
      k = Math.min(1.08, k + diag * Math.min(1, k * 2) * 0.13);   // 对角硬棱 0.09→0.13
      // 十八盘：**世界坐标的南坡（v>0）**把连续坡面量化成十级石阶。
      // 不能用旋转后的 b：泰山 axis=π/2 时 b=-u，台阶会跑到西坡（实拍是一条贴在左坡的黑带），
      // 从南面看反而看不到登山道。
      const wedge = smoothstep(0.06, 0.26, v) * (1 - smoothstep(0.42, 0.7, Math.abs(u)));
      if (wedge > 0 && k > 0.02) {
        const steps = 10;
        const terr = (Math.floor(k * steps) + 0.55) / steps;
        k = k * (1 - 0.6 * wedge) + terr * 0.6 * wedge;
      }
      k *= 1 + fbm(a * 2.2 + m.x * 0.01, b * 2.2, 3) * 0.05;
      break;
    }
    case 'pyramidal': {
      // 四面绝壁：rn 很小就把高度放掉（1.42 倍拉伸让山脚落在 r 附近）
      const rn = Math.hypot(a, b) * 1.42;
      // R21：尖峰更尖（收尖指数 1.18）、峰体略收（0.72→0.66）
      k = Math.pow(1 - smoothstep(0.02, 0.66, rn), 1.18);
      // 五峰如莲：五瓣环列，各有独立峰顶
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + 0.32;
        const px = Math.cos(ang) * 0.4, pz = Math.sin(ang) * 0.4;
        const d2 = ((a - px) * (a - px) + (b - pz) * (b - pz)) / (0.155 * 0.155);
        k = Math.max(k, 0.86 * Math.exp(-d2));
      }
      // 苍龙岭：沿 +axis 伸出的一道窄脊（宽 0.11r，长到 1.28r）
      if (a > 0.05) {
        // R21：苍龙岭窄脊更窄更长（宽 0.055→0.038、长 1.28→1.45、抬高 0.66→0.72）
        const spur = Math.exp(-((b / 0.038) ** 2)) * (1 - smoothstep(0.35, 1.45, a)) * 0.72;
        k = Math.max(k, spur);
      }
      k *= 1 + fbm(a * 3.1 + m.x * 0.01, b * 3.1 + 7.7, 3) * 0.05;
      break;
    }
    case 'rolling': {
      // 舒缓连绵：宽基座 + 六个缓峰（σ 0.30–0.36r，最大坡度约 43°）
      const rn = Math.hypot(u / 1.12, v);
      k = 0.4 * (1 - smoothstep(0.16, 1.3, rn));
      const peaks: [number, number, number, number][] = [
        [-0.36, -0.18, 0.86, 0.36], [0.32, -0.32, 0.8, 0.34], [0.48, 0.28, 0.76, 0.32],
        [-0.22, 0.4, 0.74, 0.33], [0.04, 0.1, 1.0, 0.3], [-0.54, 0.26, 0.7, 0.3],
      ];
      for (const [px, pz, hh, sg] of peaks) {
        const d2 = ((u - px) * (u - px) + (v - pz) * (v - pz)) / (sg * sg);
        k = Math.max(k, hh * Math.exp(-d2));
      }
      k *= 1 + fbm(u * 2 + m.x * 0.01, v * 2 + 3.3, 3) * 0.05;
      break;
    }
    case 'ridged': {
      // 东西横亘：长轴 1.48r、短轴 0.66r；中央一道峡谷把山体劈成南北两壁
      // R21：刃脊更窄更长（长轴 1.48→1.78、短轴 0.66→0.50）、中央峡谷更深（0.46→0.62）
      const rn = Math.hypot(a / 1.78, b / 0.50);
      k = 1 - smoothstep(0.06, 0.8, rn);
      const canyon = Math.exp(-((b / 0.085) ** 2)) * (1 - smoothstep(0.1, 0.92, Math.abs(a)));
      k = Math.max(0, k - canyon * 0.62);
      // 脊上锯齿：东西横亘的多峰（波长约 0.55r）
      k *= 0.9 + 0.1 * Math.sin(a * 11.5 + 1.3) + 0.05 * fbm(a * 6.2, b * 4.1, 2);
      break;
    }
    case 'twin': {
      // 双峰对峙：东西两峰各 0.66/0.62 高，中间一道深峡谷
      const rn = Math.hypot(a / 1.06, b / 0.92);
      const base = 0.52 * (1 - smoothstep(0.16, 1.1, rn));
      const p1 = 0.66 * Math.exp(-(((a - 0.38) ** 2) / (2 * 0.24 ** 2) + (b ** 2) / (2 * 0.3 ** 2)));
      const p2 = 0.62 * Math.exp(-(((a + 0.38) ** 2) / (2 * 0.25 ** 2) + (b ** 2) / (2 * 0.31 ** 2)));
      k = base + Math.max(p1, p2);
      const gorge = Math.exp(-((a / 0.13) ** 2)) * (1 - smoothstep(0.02, 0.72, Math.abs(b)));
      k = Math.max(0, k - gorge * 0.5);   // R21：双峰间峡谷更深 0.3→0.5
      k *= 1 + fbm(a * 3.4 + 2.2, b * 3.4, 3) * 0.05;
      break;
    }
    case 'parallel': {
      // 三列平行山脉：沿 axis 各一条长脊，脊间是冰川谷；每条脊各有一个主峰
      k = 0;
      // R21：三列脊收窄（w 0.155/0.17/0.15 → 0.115/0.125/0.11）让列间谷更明显
      const rows: [number, number, number, number][] = [[-0.48, 0.84, 0.115, -0.26], [0, 1.0, 0.125, 0.1], [0.48, 0.88, 0.11, 0.44]];
      for (const [off, hh, w, bump] of rows) {
        const rr = Math.hypot(a / 1.55, (b - off) / w);
        const kk = hh * (1 - smoothstep(0.04, 1.0, rr)) * (0.9 + 0.1 * Math.exp(-(((a - bump) / 0.35) ** 2)));
        k = Math.max(k, kk);
      }
      // 冰川谷底不归零：两列脊之间是一条 0.17h 高的冰碛谷
      k = Math.max(k, 0.11 * (1 - smoothstep(0.3, 1.24, Math.hypot(a / 1.62, b / 0.92))));  // R21：谷底 0.17→0.11 更深
      k *= 1 + fbm(a * 2.4 + 5.1, b * 5, 3) * 0.04;
      break;
    }
    default: {
      // 高原来台：0.76h 的宽台面 + 陡缘，台上再立五座雪峰（0.96–1.02h）
      const rn = Math.hypot(u, v);
      // R21：高原来台断崖更陡（台缘过渡 0.5→1.02 收成 0.62→0.90）
      k = 0.76 * (1 - smoothstep(0.62, 0.90, rn)) + 0.05 * (1 - smoothstep(0, 0.72, rn));
      const peaks: [number, number, number, number][] = [
        [-0.26, -0.2, 0.22, 0.1], [0.3, -0.28, 0.2, 0.09], [0.2, 0.3, 0.18, 0.1], [-0.36, 0.22, 0.16, 0.09], [0.02, -0.02, 0.12, 0.12],
      ];
      // 峰项只做"台面上加雪峰"：乘台缘掩码后**叠加**在台面上，不能写成 `max(k, 0.79+bump)`——
      // 那样会在台缘外造出一圈 0.79 高的假台面（实测把华山抬到 3162m），且掩码本身把外缘切成 70° 陡壁。
      const peakMask = 1 - smoothstep(0.8, 1.02, rn);
      for (const [px, pz, hh, sg] of peaks) {
        const bump = hh * Math.exp(-(((u - px) ** 2 + (v - pz) ** 2) / (sg * sg)));
        k += bump * peakMask;
      }
      k *= 1 + fbm(u * 2.6 + m.x * 0.01, v * 2.6, 3) * 0.035;
      break;
    }
  }
  // ---- V-02 形制微地貌：多频确定性噪声，只在山体半径内按距离/坡高权重叠加 ----
  // 城内不受影响：terrainHeight 在 |x|,|z|<5200 方形内直接 return 0，且只在
  // u,v∈[-1.7,1.7]（各山体半径附近）调用本函数；rnAll>1.18 的山脚权重归零，与城郊平原平滑衔接。
  // 频率按 600 段网格（103m/格）选取：最细纹波长 ≥350m（≥3 格），不产生混叠；
  // 全程走整数格 hash 的 vnoise/fbm，禁用 Math.random / Date.now。
  const rnAll = Math.hypot(u, v);
  // ---- R23：每座山留一面「能走上去」的普通山峰斜面 ----
  // 用户反馈：可以三面悬崖峭壁，但必须有一面是倾斜的普通山坡，且满山有树有草有花。
  // 在**世界南坡**（v>0，朝城内一侧、玩家看得到也走得到）开 ±~53° 扇区，用从山脚(rnAll≈1.22)
  // 线性升到峰顶的连续缓坡替换断崖：坡度 ≈ 0.94h/(1.22r)（恒山 1350/4270 ≈ 17°），远低于步行上限。
  // 其余三面完全保留 blocky / pyramidal / plateau 的绝壁形制，不动既有山形特征。
  const walkAz = Math.atan2(u, v);                       // 0 = 正南 (+v)
  const walkSector = 1 - smoothstep(0.40, 0.95, Math.abs(walkAz));
  const walkRadial = (1 - smoothstep(0.92, 1.30, rnAll)) * smoothstep(0.02, 0.16, rnAll);
  const walkMask = walkSector * walkRadial;
  const walkRamp = Math.pow(Math.max(0, 1 - rnAll / 1.22), 1.06) * 0.94;
  // 坡面要「能走」：扇区内把 V-02 高频地貌与 R21 骨架噪声压掉 3/4，避免局部陡坎
  const walkCalm = 1 - walkMask * 0.75;
  const detailW = (1 - smoothstep(0.58, 1.18, rnAll)) * smoothstep(0.02, 0.20, k) * walkCalm;
  if (detailW > 0) {
    const relX = x * 0.0016, relZ = z * 0.0016;                          // 世界米坐标
    const relLow = fbm(relX * 0.5, relZ * 0.5, 2);                        // 低频起伏（~1.2km / 600m）
    const relMid = vnoise(relX * 1.4 + 11.7, relZ * 1.4 - 5.1) * 2 - 1;   // 中频棱面（~450m）
    const relRibs = vnoise(a * 8.0 + 3.3, b * 1.2 - 7.9) * 2 - 1;         // 沿主脊拉长的岩壁竖纹
    let relD = 0;
    switch (m.form) {
      case 'blocky': {
        // 台状断崖 / 平顶方岩：环山梯田层级 + 顶部削平 + 崖壁竖纹
        const terrace = (Math.floor(k * 18) + 0.5) / 18;
        relD = (terrace - k) * 0.5 + relRibs * 0.05 + Math.abs(relMid) * 0.03
          + (0.86 - k) * smoothstep(0.80, 0.96, k) * 0.45;
        break;
      }
      case 'pyramidal': {
        // 尖锐棱线与三角面：|噪声| 折成 V 形硬折角（非平滑），叠放射状棱脊
        const facet = 0.5 - Math.abs(vnoise(relX * 1.8, relZ * 1.8) * 2 - 1);
        relD = facet * 0.14 + Math.abs(relMid) * 0.06 + relRibs * 0.03;
        break;
      }
      case 'rolling': {
        // 舒缓连绵：只留低频宽起伏，几乎不加高频（保持「独秀」的柔和）
        relD = relLow * 0.07 + relMid * 0.025;
        break;
      }
      case 'ridged': {
        // 锯齿脊：沿主脊(a)高频齿列 + 中央峡谷再细切一刀
        const saw = Math.abs(Math.sin(a * 24.0 + 1.3)) - 0.5;
        const gorge = Math.exp(-((b / 0.06) ** 2));
        relD = saw * 0.09 * (1 - smoothstep(0.05, 0.9, Math.abs(b))) + relRibs * 0.04 - gorge * 0.10;
        break;
      }
      case 'twin': {
        // 双峰对峙：中间峡谷深切 + 两峰内侧陡壁竖纹
        const gorge = Math.exp(-((a / 0.11) ** 2));
        relD = -gorge * 0.14 + relRibs * 0.06 + Math.abs(relMid) * 0.04;
        break;
      }
      case 'parallel': {
        // 三列平行山脉 + 冰川刻槽：垂直主脊(b)方向高频槽纹
        const grooves = Math.abs(Math.sin(b * 20.0 + relLow * 2.0)) - 0.5;
        relD = grooves * 0.07 + relLow * 0.05 + relRibs * 0.03;
        break;
      }
      default: { // plateau
        // 高原来台：台面宽波纹 + 陡缘竖纹 + 雪峰棱线
        const rim = smoothstep(0.62, 0.86, rnAll) * (1 - smoothstep(0.86, 1.0, rnAll));
        relD = relLow * 0.05 + relRibs * 0.07 * rim + Math.abs(relMid) * 0.03;
        break;
      }
    }
    // R19：原幅度（0.03–0.14 相对量）在 103m/格网格上被顶点插值抹平，实拍仍是圆包；整体放大 2.1 倍。
    k = Math.max(0, k + relD * detailW * 2.1);
  }
  // ---- R21 远景骨架：≥300m 尺度的山脊线与放射冲沟（低频有符号，103m 网格可读） ----
  // 远景机位 4–15km 外、每格 103m：<200m 细节必被采样抹平。这里只用 ≥400m 波长的低频有符号函数
  // 直接抬/压归一化高度 k，冲沟两侧在顶点色坡度(slopeRock)上被放大成明暗棱线，远景能数出山脊与沟壑。
  // 全部确定性 vnoise/fbm，零 RNG；山脚(rnAll>1.12)与峰顶(rnAll<0.06)权重归零，与城郊平原平滑衔接。
  const skelW = (1 - smoothstep(0.50, 1.12, rnAll)) * smoothstep(0.03, 0.22, k) * walkCalm;
  if (skelW > 0) {
    // 低频山脊骨架：沿主脊 a 拉长(a*1.7→波长≈1.3km)、b 收紧，fbm 有符号(-1..1)双向起伏、零均值。
    const ridgeN = fbm(a * MTN_SKELETON.ridgeFreq + 4.1, b * 2.9 - 2.7, 2);
    // 放射冲沟：极角整数倍频率开 2*gullyCount 道脊/沟，相位只依赖角度 → 沿半径(坡向)连续；
    // gullyCount 为整数保证 θ=±π 处无缝；低频 fbm 扰动让沟线随山势摆动而非笔直。
    const ang = Math.atan2(v, u);
    const gullyN = Math.cos(ang * MTN_SKELETON.gullyCount * 2
      + fbm(u * 0.8 + 7.3, v * 0.8 - 3.1, 2) * 0.7);
    const radial = smoothstep(0.06, 0.40, rnAll) * (1 - smoothstep(0.85, 1.12, rnAll));
    const skeleton = ridgeN * MTN_SKELETON.ridgeAmp + gullyN * MTN_SKELETON.gullyAmp * radial;
    k = Math.max(0, k + skeleton * skelW);
  }
  // R23：扇区内把断崖平滑替换成可攀登缓坡，扇区外原样保留（三面绝壁仍在）
  if (walkMask > 0) k = k * (1 - walkMask * 0.88) + walkRamp * walkMask * 0.88;
  return k * MOUNTAIN_K[m.form];
}

/** 雪线高度（米）：逐山可覆盖；默认按 snow 折减（原口径 0.78 倍） */
function snowLineOf(m: Mountain): number {
  return m.h * (m.snowLine ?? Math.min(0.9, Math.max(0.55, m.snow * 0.78)));
}

/** 林线高度（米）：雪线下方留一段裸岩带 */
function treeLineOf(m: Mountain): number {
  return Math.min(m.h * 0.62, snowLineOf(m) * 0.94);
}

/** 大地高度场（米）。城内（半径<5200）保持 0 平原 */
export function terrainHeight(x: number, z: number): number {
  // 城内必须整体压平：旧版只压平「半径 5250 的圆盘」，而城墙是 5000 的**方形**（角半径 7071），
  // 于是四角落在地形爬升段上——实测护城河沿线 t=±3000 处地形已到 +4~+8m，
  // 护城河水面（−0.35）在那一带重新被地形吞掉。方形内一律归零，圆盘外仍保留山峦。
  if (Math.abs(x) < 5200 && Math.abs(z) < 5200) return 0;
  const d = Math.hypot(x, z);
  const cityMask = smoothstep(5250, 7800, d);
  if (cityMask <= 0) return 0;
  let h = fbm(x * 0.00023, z * 0.00023, 4) * 110 + fbm(x * 0.0011 + 7.3, z * 0.0011 + 3.1, 3) * 26;
  // 沙丘
  const dd = Math.hypot((x - DESERT.cx) / DESERT.rx, (z - DESERT.cz) / DESERT.rz);
  if (dd < 1.15) h += (1 - smoothstep(0.7, 1.15, dd)) * (14 + Math.abs(fbm(x * 0.0017, z * 0.0017, 2)) * 34);
  // 群山：按形制逐座计算（不再是同一个锥）
  for (const m of MOUNTAINS) {
    const u = (x - m.x) / m.r, v = (z - m.z) / m.r;
    if (u > 1.7 || u < -1.7 || v > 1.7 || v < -1.7) continue;
    const peak = m.h * mountainField(m, x, z);
    if (peak > h) h = peak;
  }
  // 河流切割（仅低地）。旧版没有高度上限：泰山河/西河的末段已经爬进山脚（rn 0.42–0.65），
  // 下切公式把 900–1400m 的山坡直接压到 −6 —— 山脚被切出一道千尺深崖（实拍泰山左侧的绿色裂谷），
  // 形制四量测的最大坡度也被它污染到 73°。山体段一律不再下切，河尾自然埋进山脚（泉洞收口）。
  if (h < 180) {
    for (const r of RIVERS) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const dist = distToSeg(x, z, ax, az, bx, bz);
        if (dist < r.w * 0.5) { h = Math.min(h, -6); break; }
        if (dist < r.w * 0.5 + 90) {
          const bank = -6 + (dist - r.w * 0.5) / 90 * 26;
          if (bank < h) h = bank;
          break;
        }
      }
    }
  }
  // 湖泊
  for (const l of LAKES) {
    const ld = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
    if (ld < 1.25) {
      const bed = -11 * (1 - smoothstep(0.75, 1.25, ld));
      if (bed < h) h = bed;
    }
  }
  return Math.max(-14, h * cityMask);
}

// 地形渲染网格：R24 山体放大一倍后，最远的昆仑（x=-27000, r=16000）外缘到 -43000，
// 旧 62000（half 31000）会把山脚裁掉 —— 域扩到 124000 / 600 = 206.7m 一格。
// 山体尺寸与网格步长同步 ×2，单座山占的格数不变，相对细节不退化；顶点数仍 360k，零性能增量。
const TERRAIN_SIZE = 124000, TERRAIN_SEG = 600;
const TERRAIN_HALF = TERRAIN_SIZE / 2, TERRAIN_STEP = TERRAIN_SIZE / TERRAIN_SEG;

/** 渲染面高度：按地形网格双线性取样（含城内 0.5m 下沉），贴地构件不浮空也不被吞 */
export function terrainSurfaceY(x: number, z: number): number {
  const gx = (x + TERRAIN_HALF) / TERRAIN_STEP, gz = (z + TERRAIN_HALF) / TERRAIN_STEP;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const at = (i: number, j: number): number => {
    const px = -TERRAIN_HALF + i * TERRAIN_STEP, pz = -TERRAIN_HALF + j * TERRAIN_STEP;
    return terrainHeight(px, pz) - 0.5 * (1 - smoothstep(5200, 6400, Math.hypot(px, pz)));
  };
  const h00 = at(ix, iz), h10 = at(ix + 1, iz), h01 = at(ix, iz + 1), h11 = at(ix + 1, iz + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** 水面高度：该点若为河/湖水面则返回水面 y，否则 null */
export function waterAt(x: number, z: number): number | null {
  for (const r of RIVERS) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      if (distToSeg(x, z, ax, az, bx, bz) < r.w * 0.34) return -2.2;
    }
  }
  for (const l of LAKES) {
    if (Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz) < 0.92) return -3.4;
  }
  return null;
}

// ============ 七岳形制四量测（坡度角 / 峰数 / 脊走向 / 峰顶平坦度） ============
/**
 * 判据不是「看着不一样」，而是同一套采样口径下的四个量互不全同。口径：
 *  · 采样 96×96、覆盖 2.5r，3×3 平滑两遍（压掉噪声伪峰，与 206.7m 渲染网格同量级）；
 *  · 最大坡度角：相邻采样点中心差分的最大坡度；
 *  · 峰数：>0.76×峰值 的连通块（4 邻域，面积≥2 格）——方顶/高原会并成 1 块；
 *  · 脊走向：高度>0.25 峰值的单元上，梯度结构张量主方向的垂线（东西向脊 ≈ 0°）；
 *  · 峰顶平坦度：0.30r 圆盘内、落在该盘中位数 ±7% 的面积占比。
 */
export interface MountainShape {
  name: string; form: MountainForm;
  maxH: number; peakAt: [number, number];
  maxSlopeDeg: number; peaks: number; ridgeAzDeg: number; summitFlat: number;
}

export function mountainShapeStats(): MountainShape[] {
  const N = 96;
  return MOUNTAINS.map((m) => {
    const span = m.r * 2.5;
    let hs = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      // 只量形制本身（解析山体场），不含河床下切/邻山/大地起伏——
      // 否则泰山河的末段下切会把"最大坡度"顶到 70°+，量到的就不是这座山的形制。
      const px = m.x + (i / (N - 1) - 0.5) * span, pz = m.z + (j / (N - 1) - 0.5) * span;
      hs[j * N + i] = Math.max(0, m.h * mountainField(m, px, pz));
    }
    for (let pass = 0; pass < 2; pass++) {
      const sm = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= N || ii < 0 || ii >= N) continue;
          s += hs[jj * N + ii]; c++;
        }
        sm[j * N + i] = s / c;
      }
      hs = sm;
    }
    let max = -1e9, mx = 0, mz = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const hv = hs[j * N + i];
      if (hv > max) { max = hv; mx = m.x + (i / (N - 1) - 0.5) * span; mz = m.z + (j / (N - 1) - 0.5) * span; }
    }
    const st = span / (N - 1);
    let slope = 0;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const gx = (hs[j * N + i + 1] - hs[j * N + i - 1]) / (2 * st);
      const gz = (hs[(j + 1) * N + i] - hs[(j - 1) * N + i]) / (2 * st);
      slope = Math.max(slope, Math.hypot(gx, gz));
    }
    // 峰数：连通块
    const seen = new Uint8Array(N * N);
    let peaks = 0;
    for (let j0 = 0; j0 < N; j0++) for (let i0 = 0; i0 < N; i0++) {
      const s0 = j0 * N + i0;
      if (seen[s0] || hs[s0] < max * 0.76) continue;
      let cnt = 0;
      const stack = [s0];
      seen[s0] = 1;
      while (stack.length) {
        const s = stack.pop()!;
        const j = (s / N) | 0, i = s % N;
        cnt++;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dj, di] of nb) {
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= N || ii < 0 || ii >= N) continue;
          const s2 = jj * N + ii;
          if (seen[s2] || hs[s2] < max * 0.76) continue;
          seen[s2] = 1;
          stack.push(s2);
        }
      }
      if (cnt >= 2) peaks++;
    }
    // 脊走向：梯度结构张量
    let jxx = 0, jzz = 0, jxz = 0;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      if (hs[j * N + i] < max * 0.25) continue;
      const gx = (hs[j * N + i + 1] - hs[j * N + i - 1]) / (2 * st);
      const gz = (hs[(j + 1) * N + i] - hs[(j - 1) * N + i]) / (2 * st);
      const w = Math.hypot(gx, gz);
      jxx += w * gx * gx; jzz += w * gz * gz; jxz += w * gx * gz;
    }
    const thetaG = (0.5 * Math.atan2(2 * jxz, jxx - jzz) * 180) / Math.PI;
    const az = ((thetaG + 90 + 90) % 180) - 90;
    // 峰顶平坦度
    const disc: number[] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = (i / (N - 1) - 0.5) * span, dz = (j / (N - 1) - 0.5) * span;
      if (Math.hypot(dx, dz) <= m.r * 0.3) disc.push(hs[j * N + i]);
    }
    disc.sort((a, b) => a - b);
    const med = disc[Math.floor(disc.length / 2)] || 0;
    let flat = 0;
    for (const hv of disc) if (Math.abs(hv - med) <= med * 0.07) flat++;
    return {
      name: m.name, form: m.form,
      maxH: Math.round(max), peakAt: [Math.round(mx - m.x), Math.round(mz - m.z)],
      maxSlopeDeg: +(Math.atan(slope) * 180 / Math.PI).toFixed(1),
      peaks, ridgeAzDeg: +az.toFixed(1),
      summitFlat: +(flat / Math.max(1, disc.length)).toFixed(3),
    };
  });
}

/**
 * 实际峰位：多数形制的最高点不在几何中心（双峰/长脊/五瓣），庙观与点景必须落在真峰上。
 * 两级搜索（±0.55r 粗网格 → ±0.07r 细网格），y 取解析峰与渲染面的较大者。
 */
const SUMMITS = new Map<string, { x: number; y: number; z: number }>();
export function mountainSummit(m: Mountain): { x: number; y: number; z: number } {
  const hit = SUMMITS.get(m.name);
  if (hit) return hit;
  let bx = m.x, bz = m.z, best = -1e9;
  const scan = (cx: number, cz: number, half: number, step: number): void => {
    for (let dz = -half; dz <= half + 1e-6; dz += step) {
      for (let dx = -half; dx <= half + 1e-6; dx += step) {
        const x = cx + dx, z = cz + dz;
        const y = terrainHeight(x, z);
        if (y > best) { best = y; bx = x; bz = z; }
      }
    }
  };
  scan(m.x, m.z, m.r * 0.55, m.r * 0.055);
  scan(bx, bz, m.r * 0.07, m.r * 0.0117);
  const y = Math.max(best, terrainSurfaceY(bx, bz));
  const out = { x: bx, y, z: bz };
  SUMMITS.set(m.name, out);
  return out;
}

/** 七山生机站点（给 flora.buildMountainLife） */
export function mountainSites(): MountainSite[] {
  return MOUNTAINS.map((m) => ({
    m, summit: mountainSummit(m),
    treeLine: treeLineOf(m), snowLine: snowLineOf(m),
    streamAng: m.streamAng, waterfall: !!m.waterfall,
  }));
}

// ============ 河道足迹与河床带（WS-WATER-BED） ============
/**
 * 为什么要有这一层：地形渲染网格 62000/300 = **206.7m 一格**，而城外河道只有 90–150m 宽。
 * `terrainHeight()` 在河道里「挖槽到 −6」只对落在槽内的**顶点**生效，而槽里往往一个顶点都没有，
 * 双线性插值出来的地形面（两侧顶点各在 +2…+20）直接盖在水面 −2.2 之上 —— 整段河的水面看不见。
 * 实测改前：沿 5 条河每 200m 一条垂直射线，只有 **43.75%** 的采样点能看到水面，最差一段地形
 * 比水面高 21m（西河 −21401,2497）。用户看到的就是「断断续续的深蓝/深绿斑块，没头没尾」。
 *
 * 两条绕过代价大的路：
 *  ① 全网格加密到 600 段：顶点 ×4（9.1 万 → 36 万），`山河·地形` 约 2.6s → ~11s，不可接受；
 *  ② 把挖槽加宽到 300m+：`terrainHeight` 是所有落地构件的唯一真相源，等于改世界轮廓。
 * 取第三条——**只在河道上动刀**：
 *  ① 与河道足迹相交的地形三角面**整片剔除**（豁口），断裂口留在粗网格上；
 *  ② 沿河折线另建一条高分辨率**河床带**（纵向 40m 一段、折角/两端 5m；横向 19–21 列，水边 8–25m 加密），
 *     高度仍取 `terrainHeight` + 与粗网格渲染面接平，颜色仍取 `biomeColor`，与两岸色带连续。
 * 实测代价：地形剔除 1150 面，河床带 4.0 万顶点 / 7.6 万三角面；`山河·地形` 内新增两段耗时
 * 剔豁口 ~10ms + 建带 ~37ms（预算 400ms）。改后同口径覆盖 240/240 = 100%，西河断面最低点
 * 由 +2.89m 变成 −2.48m（水面 −2.2）。
 */
const RIVER_EDGE_PAD = 16;   // 水面带半宽（河宽/2+10，斜接最多 1.06）之外再留的余量
const RIVER_HOLE_CLEAR = 60; // 三角面 6 点取样必须离水面带外缘这么远才保留（见 carveRiverHoles）

interface RiverSeg { ax: number; az: number; dx: number; dz: number; l2: number; hw: number; lim2: number; ri: number }
const RIVER_SEGS: RiverSeg[] = [];
for (let ri = 0; ri < RIVERS.length; ri++) {
  const r = RIVERS[ri];
  const hw = r.w * 0.5;
  const lim = hw + RIVER_EDGE_PAD + 620;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const ax = r.pts[i][0], az = r.pts[i][1];
    const dx = r.pts[i + 1][0] - ax, dz = r.pts[i + 1][1] - az;
    RIVER_SEGS.push({ ax, az, dx, dz, l2: dx * dx + dz * dz || 1, hw, lim2: lim * lim, ri });
  }
}
let _footRi = -1;

/** 河道足迹余量（米）：到最近中心线距离 − 该河水面带半宽。负值 = 落在水面带内 */
function riverFoot(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < RIVER_SEGS.length; i++) {
    const s = RIVER_SEGS[i];
    let t = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x - s.ax - s.dx * t, pz = z - s.az - s.dz * t;
    const d2 = px * px + pz * pz;
    if (d2 < s.lim2) {
      const d = Math.sqrt(d2) - s.hw - RIVER_EDGE_PAD;
      if (d < best) { best = d; _footRi = s.ri; }
    }
  }
  return best;
}

/** 到单条河中心线折线的水平距离（端点外取端点半径） */
function riverPolyDist(r: RiverDef, x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const d = distToSeg(x, z, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

type GridSampler = (x: number, z: number) => number;

/**
 * 粗网格渲染面的精确高度：按 PlaneGeometry 的三角剖分（a-b-d / b-c-d）逐三角面线性插值，
 * 不是双线性。河床带外缘与地形接缝就压在这上面 —— 差 0.12m 藏进地形底下，不会露缝也不会 z-fighting。
 */
function makeGridSampler(H: Float32Array): GridSampler {
  const N = TERRAIN_SEG + 1;
  return (x: number, z: number): number => {
    const gx = THREE.MathUtils.clamp((x + TERRAIN_HALF) / TERRAIN_STEP, 0, TERRAIN_SEG - 1e-6);
    const gz = THREE.MathUtils.clamp((z + TERRAIN_HALF) / TERRAIN_STEP, 0, TERRAIN_SEG - 1e-6);
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const u = gx - ix, v = gz - iz;
    const i00 = iz * N + ix, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
    if (u + v <= 1) return H[i00] * (1 - u - v) + H[i01] * v + H[i10] * u;
    return H[i01] * (1 - u) + H[i11] * (u + v - 1) + H[i10] * (1 - v);
  };
}

/**
 * 河床带断面高度。三段：
 *  ① 水面带内（d ≤ 水面带外缘）：强制压到水面 −0.7（`terrainHeight` 在城郊被 cityMask 缩放过，
 *     槽只剩 −0.3，光靠解析值仍会露底；压下去的只是「比水面高的那点」，深槽 −6 原样保留）；
 *  ② 水面带外 0→13m：解析值接管，河岸按 26/90 的既有坡度抬起来 —— 水陆交界是斜坡岸，不是断崖；
 *  ③ 岸外 80→170m：过渡到粗网格渲染面（−0.12），外缘整个藏在粗网格底下，看不到接缝也不 z-fighting。
 */
function riverBedY(analytic: number, d: number, wEdge: number, coarse: number, forceY: number, forceK = 0): number {
  const wIn = Math.max(forceK, 1 - smoothstep(wEdge - 12, wEdge + 1, d));
  const forced = analytic + (forceY - analytic) * wIn;
  let y = analytic < forced ? analytic : forced;
  const wOut = smoothstep(wEdge + 80, wEdge + 170, d);
  if (wOut > 0) y += (coarse - 0.12 - y) * wOut;
  return y;
}

interface BedStation { x: number; z: number; nx: number; nz: number }

/**
 * 河床带的强制床面。默认压到水面 −0.7（−2.9）；引水渠段（水关外口 → 第二级跌水堰顶）
 * 只压到**当地地面下 0.15m**（且不高于 −0.55）——因为那一段的水面在 −0.35 或 +1.0，
 * 都比地面高，若仍按 −2.9 下挖，护城河与高渠底下会是一道 2m 深的空槽。
 */
function bedForceY(x: number, z: number, analytic: number): number {
  _forceK = 0;
  for (const r of RIVERS) {
    const L = r.link;
    if (!L) continue;
    const alongX = Math.abs(r.pts[0][0]) > Math.abs(r.pts[0][1]);
    const u = Math.abs(alongX ? x : z);
    const v = alongX ? Math.abs(z) : Math.abs(x - r.pts[0][0]);
    if (v < 170 && u > 5000 && u <= L.weir) { _forceK = 1; return Math.min(analytic - 0.15, -0.55); }
  }
  return WATER_RIVER_Y - 0.7;
}
/** 上一次 `bedForceY` 是否落在引水渠段（1=是）：渠道的横向断面必须整条压平，
 *  不能像河道那样按「到折线的距离」收口——折线端点外那一段的距离是球面距离，
 *  会把护城河底抬高到水面之上（实测 −5160,0 处床面 0.00 盖住 −0.35 的護城河）。 */
let _forceK = 0;

/** 沿河折线每 step 米一个断面，两端各外延 ext 米（豁口在河头尾是个圆形，不外延盖不住） */
function riverStations(r: RiverDef, step: number, ext: number): BedStation[] {
  const P = r.pts, np = P.length;
  const pts: { x: number; z: number }[] = [];
  const dirs: { x: number; z: number }[] = [];
  for (let i = 0; i < np - 1; i++) {
    const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) || 1;
    dirs.push({ x: (P[i + 1][0] - P[i][0]) / L, z: (P[i + 1][1] - P[i][1]) / L });
  }
  // 折角 >12° 的顶点与两端：地形高度在那里是「到顶点的半径」函数（等值线是圆），
  // 40m 一档的四边形在半径 45m 处会插出 ~2m 误差（实测北河 74° 弯），所以 140m 内加密到 1/3。
  const sharp: boolean[] = [];
  for (let i = 0; i < np; i++) {
    if (i === 0 || i === np - 1) { sharp.push(true); continue; }
    const dot = dirs[i - 1].x * dirs[i].x + dirs[i - 1].z * dirs[i].z;
    sharp.push(dot < 0.978);
  }
  const fine = step / 8, near = 140;
  // 两端外延：近端 fine、远端 step；方向按「离端点由远到近」/「由近到远」排，行序不能反（反了法线朝下被背面剔除）
  const extPts = (bx: number, bz: number, ux: number, uz: number, sign: number, rev: boolean): void => {
    const ds: number[] = [];
    for (let s = fine; s <= ext + 0.01; s += s < near ? fine : step) ds.push(s);
    if (rev) ds.reverse();
    for (const s of ds) pts.push({ x: bx + ux * s * sign, z: bz + uz * s * sign });
  };
  extPts(P[0][0], P[0][1], dirs[0].x, dirs[0].z, -1, true);
  for (let i = 0; i < np - 1; i++) {
    const ax = P[i][0], az = P[i][1];
    const L = Math.hypot(P[i + 1][0] - ax, P[i + 1][1] - az) || 1;
    const ux = dirs[i].x, uz = dirs[i].z;
    for (let s = 0; s < L - 0.01;) {
      pts.push({ x: ax + ux * s, z: az + uz * s });
      s += ((sharp[i] && s < near) || (sharp[i + 1] && L - s < near)) ? fine : step;
    }
  }
  pts.push({ x: P[np - 1][0], z: P[np - 1][1] });
  extPts(P[np - 1][0], P[np - 1][1], dirs[np - 2].x, dirs[np - 2].z, 1, false);
  // 法线取前后站平均方向：弯道处断面跟着转，不在弯心折出尖角（与水面带的斜接同向）
  const out: BedStation[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    out.push({ x: pts[i].x, z: pts[i].z, nx: -tz, nz: tx });
  }
  // 法线再平滑三遍（±3 站）：折角如果只靠一站完成转动，半径 70m 处的四边形会摊成 37° 扇形，
  // 插值高度误差实测 ~1m（北河 74° 弯）；摊到 6~7 站后降到 ~0.1m。
  for (let pass = 0; pass < 3; pass++) {
    const nx0 = out.map((s) => s.nx), nz0 = out.map((s) => s.nz);
    for (let i = 0; i < out.length; i++) {
      const a = Math.max(0, i - 1), b = Math.min(out.length - 1, i + 1);
      const vx = nx0[a] * 0.25 + nx0[i] * 0.5 + nx0[b] * 0.25;
      const vz = nz0[a] * 0.25 + nz0[i] * 0.5 + nz0[b] * 0.25;
      const l = Math.hypot(vx, vz) || 1;
      out[i].nx = vx / l; out[i].nz = vz / l;
    }
  }
  return out;
}

/** 断面横向列偏置：水边 8–46m 加密（岸坡看得出形状），岸外粗（只是接平粗网格） */
function bedOffsets(wEdge: number, R: number): number[] {
  const o: number[] = [0];
  for (const v of [0.45 * wEdge, 0.8 * wEdge, wEdge, wEdge + 8, wEdge + 22, wEdge + 46, wEdge + 90, wEdge + 145]) {
    if (v < R - 6) o.push(v, -v);
  }
  if (R > wEdge + 210) { const m = (wEdge + 145 + R) * 0.5; o.push(m, -m); }
  o.push(R, -R);
  o.sort((a, b) => a - b);
  return o;
}

/**
 * 剔豁口：三角形取样点（3 顶点 + 3 边中点）只要有一点落进「水面带外缘 + 60m」就整片剔除。
 * 60m 的理由：右等腰直角三角形这 6 个取样点的覆盖半径 = L·√2/6 = 48.7m，
 * 于是**任何保留下来的三角形，其内部任意点离水面带外缘都还有 ≥11m** —— 不会穿水，是可证的。
 * 同时按「哪条河造成的」记账最大外延（reach），河床带宽度按它算，一格都不浪费。
 */
function carveRiverHoles(geo: THREE.BufferGeometry): { index: Uint32Array; reach: number[]; removed: number } {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const src = geo.getIndex()!.array;
  const keep: number[] = [];
  const reach: number[] = new Array(RIVERS.length).fill(0);
  let removed = 0;
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t], b = src[t + 1], c = src[t + 2];
    const ax = pos.getX(a), az = pos.getZ(a);
    const bx = pos.getX(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cz = pos.getZ(c);
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    if (riverFoot(mx, mz) > RIVER_HOLE_CLEAR + 160) { keep.push(a, b, c); continue; }
    const sx = [ax, bx, cx, (ax + bx) * 0.5, (bx + cx) * 0.5, (cx + ax) * 0.5];
    const sz = [az, bz, cz, (az + bz) * 0.5, (bz + cz) * 0.5, (cz + az) * 0.5];
    let foot = 1e9;
    for (let k = 0; k < 6; k++) {
      const f = riverFoot(sx[k], sz[k]);
      if (f < foot) foot = f;
    }
    if (foot >= RIVER_HOLE_CLEAR) { keep.push(a, b, c); continue; }
    removed++;
    const ri = _footRi;
    const r = RIVERS[ri];
    const wEdge = r.w * 0.5 + RIVER_EDGE_PAD;
    const dm = Math.max(riverPolyDist(r, ax, az), riverPolyDist(r, bx, bz), riverPolyDist(r, cx, cz));
    if (dm - wEdge > reach[ri]) reach[ri] = dm - wEdge;
  }
  return { index: new Uint32Array(keep), reach, removed };
}

interface BedBuf { p: number[]; c: number[]; u: number[]; idx: number[] }

/** 单条河的河床带：顶点色/材质与地形同一套，外缘压在粗网格面下 0.12m */
function appendRiverBed(buf: BedBuf, r: RiverDef, reach: number, gridY: GridSampler): number {
  const hw = r.w * 0.5;
  const wEdge = hw + RIVER_EDGE_PAD;
  const R = Math.max(wEdge + 40, wEdge + reach + 10);
  const step = 40;
  const st = riverStations(r, step, R + 80);
  const offs = bedOffsets(wEdge, R);
  const cols = offs.length;
  const base = buf.p.length / 3;
  const c = _bedCol;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    for (let j = 0; j < cols; j++) {
      const off = offs[j];
      const x = s.x + s.nx * off, z = s.z + s.nz * off;
      const d = riverPolyDist(r, x, z);
      const ha = terrainHeight(x, z);
      const forceY = bedForceY(x, z, ha);
      const y = riverBedY(ha, d, wEdge, gridY(x, z), forceY, _forceK);
      biomeColor(x, z, ha, c);
      // 湿河床压暗一档：透水看到的是河底，不是草地
      const wet = 1 - smoothstep(hw - 4, hw + 34, d);
      const k = 1 - 0.3 * wet;
      buf.p.push(x, y, z);
      buf.c.push(c.r * k, c.g * k, c.b * k);
      buf.u.push((x + TERRAIN_HALF) / TERRAIN_SIZE, 1 - (z + TERRAIN_HALF) / TERRAIN_SIZE);
    }
  }
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = base + i * cols + j, b = a + 1, cc = a + cols, dd = a + cols + 1;
      buf.idx.push(a, b, cc, b, dd, cc);
    }
  }
  return st.length * cols;
}

const _bedCol = new THREE.Color();

// ============ 城内地面肌理（WS-47）：坊格色偏 / 街巷暗带 / 踩踏痕 ============
// 全部落在既有顶点色数组里，零几何、零 draw call、零新增贴图；噪声一律走上面的确定性 hash2/vnoise，
// 不碰 Math.random、不消耗任何外部 RNG，重建逐像素一致。
const FANG = 276;               // 坊格边长（米），与里坊排布同尺度
const FANG_INV = 1 / FANG;

/** 两个八度值噪声（约 -1..1），用来抖动坊界坐标 */
function vn2(x: number, z: number): number {
  return (vnoise(x, z) * 2 - 1) * 0.62 + (vnoise(x * 2.17 + 5.7, z * 2.17 - 3.1) * 2 - 1) * 0.38;
}

/**
 * 单轴巷道带：dist=到最近坊界的距离（米），line=该坊界序号。
 * 返回 0（坊内）→ 约 1（巷心）。真实巷宽 3–6m，206.7m 的地形网格表达不了，
 * 这里用 34–60m 的软坡表征，配逐条街强度与断街，避免高空读成规则网格。
 */
function fangLane(dist: number, line: number, salt: number): number {
  const h = hash2(line * 3 + salt, salt * 7 + 19);
  if (h < 0.14) return 0;                                    // 断街：约七分之一整条淡出
  const w = 34 + h * 26;                                     // 软坡半径
  return (1 - smoothstep(w * 0.15, w, dist)) * (0.66 + h * 0.39);
}

/** 城内地面第二层顶点色：坊内暖亮、巷带冷暗、高频踩踏痕。w=城区权重 0..1 */
function cityGroundDetail(x: number, z: number, out: THREE.Color, w: number): void {
  // 坊界坐标抖动 ±8m（两个八度值噪声）
  const jx = vn2(x * 0.0052 + 11.3, z * 0.0052 - 4.7) * 8;
  const jz = vn2(x * 0.0052 - 33.9, z * 0.0052 + 27.4) * 8;
  const gx = (x + jx) * FANG_INV, gz = (z + jz) * FANG_INV;
  const cx = Math.floor(gx), cz = Math.floor(gz);
  const fx = gx - cx, fz = gz - cz;
  const dx = Math.min(fx, 1 - fx) * FANG, dz = Math.min(fz, 1 - fz) * FANG;
  // 巷带沿街低频起伏：市口段清晰、宅院段淡出，进一步打断等距感
  const laneMask = 0.75 + 0.25 * (vn2(x * 0.0007 + 7.1, z * 0.0007 - 2.3) * 0.5 + 0.5);
  const lane = Math.max(
    fangLane(dx, fx < 0.5 ? cx : cx + 1, 3),
    fangLane(dz, fz < 0.5 ? cz : cz + 1, 5),
  ) * laneMask;
  // 逐坊基底：四级离散明暗（±2.5% / ±7.5%，最小步进 5%），保证相邻坊 ΔL 有台阶而不是连续随机糊成一片
  const step = Math.floor(hash2(cx * 5 + 211, cz * 7 - 97) * 4) - 1.5;
  const warm = 0.5 + step * 0.18 + (hash2(cx * 11 - 43, cz * 3 + 149) - 0.5) * 0.36;
  const slow = vn2(x * 0.0013 + 41.7, z * 0.0013 - 8.9);     // 片区级慢变
  const grain = fbm(x * 0.021 + 3.7, z * 0.021 - 6.1, 2);    // 车辙踩踏/砖屑/夯土补丁（±4%）
  const lum = 1 + step * 0.05 + slow * 0.018 - lane * 0.085 + grain * 0.053;
  // 冷暖：坊内提红压蓝，巷带反过来
  const tint = (((warm - 0.5) * 0.03 + 0.012) * (1 - lane) - lane * 0.03) * w;
  const k = 1 + (lum - 1) * w;
  out.r *= k * (1 + tint);
  out.g *= k;
  out.b *= k * (1 - tint * 1.7);
}

// ============ R21 植被垂直带谱 / 岩相层理 / 远景地标（R21b 实证精修；零 RNG） ============
// 带谱：5 条硬边界高对比色带，亮度刻意拉成阶梯。R21 首版 4 带被岩相层整片覆盖成同一米褐
// （MeshBasic 直显顶点色实证见 artifacts/r21-mtn-band.json 的 baseline），故本轮：
//   山脚阔叶深绿 → 山腰针叶墨绿 → 高山灌丛黄绿 → 裸岩浅赭 → 峰顶亮岩；雪线白另给天山/昆仑。
// 每带 local 宽 0.2（泰山 310m ≥300m），使 5 带 RGB 均值 / 亮度形成可数梯度。
const VEGETATION_BANDS = [0x2f6b22, 0x1a3a14, 0x9db23a, 0xc9ad7a, 0xead9b4] as const;
const SNOW_BAND_COLOR = 0xe6edf2;
// 层理/冲沟明暗端点：亮端 ≥0xc8b89c、暗端 ≤0x2e2a24；R21b 改二值亮/暗带，直方图出双峰。
const STRATA_LIGHT = 0xd8c8a8, STRATA_DARK = 0x2e2a24;
// 层理相位频率：由旧 local*8.5 降到 local*2.5，半周期带宽 ≈0.2*h ≥300m，103m 网格可读。
const STRATA_BAND_FREQ = 2.5;
/** 每座山的 4 条带边界(local)：5 带；雪山把带压进雪线以下，保证带宽 ≥300m。 */
function bandEdgesOf(snow: number): [number, number, number, number] {
  const top = snow < 1 ? snow * 0.92 : 1.0;
  return [top * 0.2, top * 0.4, top * 0.6, top * 0.8];
}
// 远景地标：高对比暖金/朱红/亮白/赭黄（金瓦/朱柱/白石/发光/赭墙），替换旧暗瓦冷色。
const MTN_LANDMARK_COLORS = {
  gold: 0xbd9a2c, vermilion: 0x93372a, white: 0xd8cdb4, glow: 0xffd25e, ochre: 0xc08a3e,
} as const;
// 每山地标组数（V-02 旧 8 → R21 ≥16），远景能数出成组点位。
const MTN_LANDMARK_GROUPS = 16;
// R21b：柱/阙统一高度比例。首版 0.5~0.62S 的孤柱高达 100m+ 且悬在坡外，
// 改为 ≤0.26S，并给每个含柱 case 补贯通额枋/楼顶，成完整牌坊/山门。
const MTN_PILLAR_RATIO = 0.26;

/**
 * R24 远景地标「人类尺度常量表」（单位：米）。
 *
 * 修前：buildMountainLandmarks 把主尺度写成 `S = min(m.r*0.075, m.h*0.22)`——它随山体
 * 半径/高度线性放大。R24 把七岳 h/r 整体 ×2 后，泰山 S=540m、昆仑 S=1200m，
 * 七层楼阁塔的「标称高度」= 1.32·S（塔刹中心 `y0+S*1.32`）于是达到
 * 泰山 ≈713m / 昆仑 ≈1584m；亭/牌坊/廊/经幢同理全是几百米高的怪物，完全不是人类尺度。
 *
 * 修后：S 不再读 m.r / m.h，改由本表按「地标类型」钉死为固定米数常量。
 * 各 case 内的几何尺寸一律是 `S × 系数`（系数原样保留），故最终世界尺寸恒定落在
 * 人类尺度区间，且**与山体大小解耦**——山体保持 ×2 不变，建筑缩回正常比例。
 *
 * 换算（总高 ≈ 系数 × 基准）：
 *   · 七层楼阁塔 TOWER=21  → 1.32×21 ≈ 27.7m（目标 18~40m 主塔档）
 *   · 重檐攒尖亭 PAVILION=16 → 0.62×16 ≈ 9.9m（目标 6~12m 亭台档）
 *   · 石牌坊 PAIFANG=22 → 0.31×22 ≈ 6.8m 柱高，含楼顶通高 ≈0.5×22 ≈ 11m（8~14m 牌坊档）
 *   · 关隘山门 GATE=20 → ≈0.5×20 ≈ 10m
 *   · 悬空栈道/长阶/摩崖 CORRIDOR=11 → 单件 ≈0.1~0.4×11 ≈ 1~4.4m（廊庑 4~7m 档）
 *   · 经幢群 STELE=9 → 单幢 ≈0.4×9 ≈ 3.6m
 *   · 站点台基 SITE=8 → 台基 0.8×8 = 6.4m 见方、封顶 0.42×8 = 3.36m 高
 *   · 每山主题标志建筑 THEME=19 → 南天门/悬空寺/山门等通高 ≈9~27m
 * 柱/阙高度 = 各自基准 × MTN_PILLAR_RATIO(0.26)，杜绝孤立高柱。
 */
const LM_METERS = {
  SITE: 8,        // 站点台基/柱脚基准
  TOWER: 21,      // 七层楼阁塔
  PAVILION: 16,   // 重檐攒尖亭
  PAIFANG: 22,    // 石牌坊
  GATE: 20,       // 关隘山门
  CORRIDOR: 11,   // 悬空栈道 / 登山长阶 / 摩崖刻石
  STELE: 9,       // 经幢群
  THEME: 19,      // 每山主题标志建筑
} as const;
/** 8 类通用地标 → 人类尺度基准（米）；索引 = switch 的 kind(0..7)。 */
const LM_KIND_METERS: readonly number[] = [
  LM_METERS.TOWER,      // 0 七层楼阁塔
  LM_METERS.PAVILION,   // 1 重檐攒尖亭
  LM_METERS.PAIFANG,    // 2 石牌坊
  LM_METERS.CORRIDOR,   // 3 悬空栈道
  LM_METERS.CORRIDOR,   // 4 摩崖刻石
  LM_METERS.CORRIDOR,   // 5 登山长阶
  LM_METERS.STELE,      // 6 经幢群
  LM_METERS.GATE,       // 7 关隘山门（default）
];
/** 8 类通用地标 → 陈设建筑类型（供 furnishMountainBuilding 按类型分档取件）。 */
const LM_FURNISH_TYPE: readonly MtBuildingType[] = [
  'tower', 'pavilion', 'paifang', 'plank', 'carving', 'steps', 'sutraPillar', 'mountainGate',
];
/** 每山主题标志建筑 → 陈设建筑类型。 */
const THEME_FURNISH_TYPE: Record<string, MtBuildingType> = {
  '泰山': 'southGate', '华山': 'dragonRidge', '衡山': 'generic', '恒山': 'hangingTemple',
  '嵩山': 'shaolinGate', '天山': 'snowSutra', '昆仑': 'jadePool',
};

function biomeColor(x: number, z: number, h: number, out: THREE.Color, skyBot?: THREE.Color): void {
  const dd = Math.hypot((x - DESERT.cx) / DESERT.rx, (z - DESERT.cz) / DESERT.rz);
  const gd = Math.hypot((x - GRASS.cx) / GRASS.rx, (z - GRASS.cz) / GRASS.rz);
  if (h > 20) {
    // 山地：林带 → 裸岩 → 雪顶。七山按各自雪线/林线分带，山脚再叠五色花丛。
    out.setHex(0x4e6e3c).lerp(_rock.setHex(0x5c6266), smoothstep(120, 520, h));
    for (const m of MOUNTAINS) {
      const u = (x - m.x) / m.r, v = (z - m.z) / m.r;
      if (Math.abs(u) > 1.25 || Math.abs(v) > 1.25) continue;
      const local = h / m.h;                       // 0..1 相对高度
      const snow = snowLineOf(m) / m.h;           // 五岳 >1.1（秋季无雪）；天山 0.56 / 昆仑 0.5
      // ===== R21 植被垂直带谱：4 条硬边界高对比色带 + 雪线白（仅雪山），带宽 ≥300m 远景可数 =====
      const [e1, e2, e3, e4] = bandEdgesOf(snow);
      // 边界低频抖动（~1.1km）让带线随山势起伏而非笔直等色线；幅度 ±0.02 ≈ 30m，不糊边界。
      const edgeN = (vnoise(x * 0.0009 + 3.1, z * 0.0009 - 1.7) - 0.5) * 0.04;
      const q1 = e1 + edgeN, q2 = e2 + edgeN, q3 = e3 + edgeN, q4 = e4 + edgeN;
      // 链式窄过渡 lerp：每段整段纯色、边界 0.02(~30m) 硬切；5 带亮度阶梯，不用互相抵消的连续插值。
      _bandColor.setHex(VEGETATION_BANDS[0])
        .lerp(_bandB.setHex(VEGETATION_BANDS[1]), smoothstep(q1 - 0.02, q1 + 0.02, local))
        .lerp(_bandB.setHex(VEGETATION_BANDS[2]), smoothstep(q2 - 0.02, q2 + 0.02, local))
        .lerp(_bandB.setHex(VEGETATION_BANDS[3]), smoothstep(q3 - 0.02, q3 + 0.02, local))
        .lerp(_bandB.setHex(VEGETATION_BANDS[4]), smoothstep(q4 - 0.02, q4 + 0.02, local));
      out.lerp(_bandColor, 0.96);                 // 高权重铺满，盖住底层 0x4e6e3c→0x5c6266 渐变
      // 五色花丛：只在山脚阔叶带内低频聚片，避免中高带彩色噪点干扰"数色带"。
      if (local < q1 * 0.9 && m.form !== 'pyramidal') {
        const patch = vnoise(x * 0.0021 + m.x * 0.01, z * 0.0021 - m.z * 0.01);
        const cluster = smoothstep(0.58, 0.76, patch);
        if (cluster > 0) {
          const hue = vnoise(x * 0.00063 + 31.7 + m.x * 0.001, z * 0.00063 - 12.9 + m.z * 0.001);
          const ci = Math.min(FLOWER_COLORS.length - 1, Math.floor(hue * FLOWER_COLORS.length));
          out.lerp(_flower.setHex(FLOWER_COLORS[ci]), cluster * 0.18);
        }
      }
      // 雪线白：仅 snowLine<1 的天山/昆仑；五岳 snowLine>1.1 的 local 够不到，绝不硬造雪山。
      if (snow < 1) {
        const snowW = smoothstep(snow * 0.9, snow * 0.9 + 0.05, local);
        if (snowW > 0) out.lerp(_snow.setHex(SNOW_BAND_COLOR), snowW * 0.96);
      }
      // 天山冰川：脊间谷底（local 0.2~0.55）给一层冰蓝
      if (m.form === 'parallel') {
        const glacier = smoothstep(0.2, 0.3, local) * (1 - smoothstep(0.5, 0.6, local));
        out.lerp(_ice.setHex(0x9fc4d2), glacier * 0.4);
      }
      // ===== R21b 层理 / 冲沟：只在真陡崖 + 峰顶局部生效，缓坡保留 5 植被带色 =====
      // 实证：首版 slopeRock 阈值 0.42/1.02 被 R21 山形骨架(±300m 起伏)顶到全山≈1，
      // out.lerp(_strataRock, rockW*0.92) 把带谱整片盖成 tone≈0.5 的均匀米褐（baseline 实测）。
      // 本轮：① 阈值上移 0.85/1.50；② rockW 封顶 0.62，带谱色透出；③ 层理二值亮/暗带 → 双峰。
      // 确定性：中心差分只调纯函数 terrainHeight；条纹走 vnoise/fbm 整数格 hash；零 Math.random / 零 RNG。
      if (h > 45) {
        const S = 200;                                    // 差分步长≈2 格，只留大尺度崖壁
        const gx = (terrainHeight(x + S, z) - terrainHeight(x - S, z)) / (2 * S);
        const gz = (terrainHeight(x, z + S) - terrainHeight(x, z - S)) / (2 * S);
        const slope = Math.hypot(gx, gz);
        // 低频阈值扰动(~700m)让露岩成片、缓坡留绿，而非全山同步换色。
        const rockBias = (vnoise(x * 0.0016 + 11.3, z * 0.0014 - 6.8) - 0.5) * 0.50;
        const slopeRock = smoothstep(0.85 + rockBias, 1.50 + rockBias, slope);
        const bandRock = smoothstep(q4 - 0.05, q4 + 0.05, local);   // 峰顶带
        const snowGuard = 1 - smoothstep(snow * 0.86, snow * 1.0, local);
        const heightGate = smoothstep(45, 140, h);
        // 封顶 0.62：即便陡崖也保留 ≥38% 植被带色，5 带均值不会被岩色拉平。
        const rockW = Math.min(0.62, Math.max(slopeRock * 0.62, bandRock * 0.30) * snowGuard * heightGate);
        if (rockW > 0.001) {
          const cliff = smoothstep(1.20, 1.90, slope);
          // 层理：频率 local*2.5（带宽 ≈0.2*h ≥300m）；stripe 经窄阈值二值化成亮带/暗带。
          const bandPhase = local * STRATA_BAND_FREQ + vnoise(x * 0.0008 - 3.1, z * 0.0007 + 8.4) * 0.5;
          const stripe = Math.sin(bandPhase * Math.PI * 2);
          const lit = smoothstep(-0.15, 0.15, stripe);   // 0=暗带 / 1=亮带，硬切换出双峰
          // 竖沟：主波长 ~550m、次级 ~240m，z 低频使沟沿坡向连续；有符号双向，仅做小幅调制。
          const g1 = vnoise(x * 0.0018 + 19.3, z * 0.0004 - 4.1) * 2 - 1;
          const g2 = vnoise(x * 0.0042 - 7.7, z * 0.0009 + 12.5) * 2 - 1;
          const g3 = fbm(x * 0.0011 + 5.5, z * 0.0005 - 2.7, 2);
          const gully = g1 * 0.62 + g2 * 0.26 + g3 * 0.12;   // -1..1 有符号
          // tone 主值落在 0(暗带 0x2e2a24) 或 0.86(亮带 0xd8c8a8)，竖沟/断崖只 ±0.10 微调。
          const tone = Math.max(0, Math.min(1, lit * 0.86 + gully * 0.10 + cliff * 0.10));
          _strataRock.setHex(STRATA_DARK).lerp(_breakRock.setHex(STRATA_LIGHT), tone);
          out.lerp(_strataRock, rockW * 0.90);
        }
      }
      break;
    }
  } else if (dd < 1) {
    out.setHex(0xd8c08a).lerp(_rock.setHex(0xc0a070), smoothstep(0.5, 1, dd) * 0.4);
  } else if (gd < 1) {
    out.setHex(0x7a9a4e);
  } else if (h > 4) {
    out.setHex(0x44603a);
  } else {
    out.setHex(0x5a7a44);
  }
  // 城内地表为夯土/市井色（非草地）
  const dc = Math.hypot(x, z);
  const cityMask = 1 - smoothstep(4300, 5400, dc);
  if (cityMask > 0) {
    out.lerp(_cityCol.setHex(0x9a8462), cityMask); // 城区底色提暖，高空不再灰蓝
    cityGroundDetail(x, z, out, cityMask);         // 第二层：坊格/街巷/踩踏痕
  }
  // 大气透视：远处融入黛青山色（远山如黛，避免破碎剪影）
  // 视觉审核 2026-11-07（V-01）：旧常量 0xc8bfa8 是暖米灰，与注释的「黛青」正好相反——
  // 4km 外的七岳被染成亮米色光滑锥台，浮在暮色橙天上像未上贴图的低模纸板。
  // 山体(h>20)改走冷黛青并提高混合权重，平地保留暖色（避免整片远郊一并发灰）。
  const d = Math.hypot(x, z);
  const hazeW = smoothstep(12000, 30000, d);
  const isMtn = h > 20;
  // R21b：顶点远雾对山体的混入由 0.58 降到 0.20（烘焙进顶点色，会冲淡色带/雪白对比）；
  // V-01 片元远雾 shader 链(onBeforeCompile/uFarHaze) 与 customProgramCacheKey 原样保留、不动。
  out.lerp(_haze.setHex(isMtn ? 0x77828e : 0xb8ac94), hazeW * (isMtn ? 0.20 : 0.30));
}
/** 山上五色花丛（顶点色版）：与 flora 的花丛同色系，远看是成片色斑 */
const FLOWER_COLORS = [0xff5478, 0xffb300, 0x9a6bff, 0xff6ad5, 0xff7a3c, 0xffe14d];
const _rock = new THREE.Color(), _snow = new THREE.Color(), _wet = new THREE.Color(), _haze = new THREE.Color(), _cityCol = new THREE.Color(), _white2 = new THREE.Color();
const _forest = new THREE.Color(), _flower = new THREE.Color(), _ice = new THREE.Color();
// R20 岩相分层专用临时色（与 biomeColor 既有 _rock/_forest 等互不干扰，用完即弃）
const _cliffRock = new THREE.Color(), _ochreRock = new THREE.Color(), _breakRock = new THREE.Color(), _strataRock = new THREE.Color(), _alpineRock = new THREE.Color();
// R21 带谱链式 lerp 临时色（用完即弃，不新增材质组）
const _bandColor = new THREE.Color(), _bandB = new THREE.Color();

export interface TerrainResult { heightAt: typeof terrainHeight; waterMeshes: number }

/** 生成整个大地（单网格顶点色）+ 水面 */
/** 七山庙观：山巅一庙（45 卷 4.1 城外庙观节）——名称/瓦色/剪边按山定 */
const MOUNTAIN_TEMPLES: Record<string, { nm: string; roof: number; trim: number }> = {
  '泰山': { nm: '碧霞祠', roof: 0x4e7a5e, trim: 0xffd25e },   // 铜瓦铜锈绿
  '华山': { nm: '鎮江王廟', roof: 0x3b4045, trim: 0x00e5ff },
  '衡山': { nm: '祝融殿', roof: 0x3a6b8c, trim: 0xff9e00 },   // 火神祝融赤霄剪边
  '恒山': { nm: '北嶽廟', roof: 0x454b52, trim: 0xffb300 },
  '嵩山': { nm: '中嶽廟', roof: 0x3b4045, trim: 0xb8ff2e },   // 少林祖庭
  '天山': { nm: '雪簾禪院', roof: 0xc6d2de, trim: 0x00e5ff }, // 雪顶冷灰瓦（旧 0xe8ecf2 近白，暖光下烧成白团）
  '昆仑': { nm: '瑤池行宮', roof: 0x3a6b8c, trim: 0xd8b0ff }, // 西王母道场
};

function buildMountainTemple(b: Baker, sg: SignMesher, atlas: SignAtlas, m: Mountain, h: number): void {
  const t = MOUNTAIN_TEMPLES[m.name];
  if (!t) return;
  // 地形网格 206m 间距线性插值会漏掉解析峰值：取周边 5 点解析高度最大值，庙建在宽台基上避免被山体吞没
  let peak = h;
  for (const [ox, oz] of [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70], [50, 50], [-50, -50]]) {
    peak = Math.max(peak, terrainHeight(m.x + ox, m.z + oz));
  }
  const gy = peak + 0.3;
  const PLAT = gy + 0.7;          // 山顶切坡台面（WS-33 六件共用标高）
  // ===== R24 主庙：把 16×5×10m、只有 5m 高的空壳放大成 32×14×20m 的主庙尺度 =====
  // 用户「大的变小、小的变大，主庙要变大、变精致、奢华豪华」：正殿放大约 2.8×，
  // 补重檐庑殿金瓦顶 / 朱柱 / 须弥台基 / 匾额 / 格扇门 / 廊庑 / 月台 / 丹陛，并做全套内部陈设。
  const W = 32, D = 20, H = 14;   // 面阔 / 进深 / 净高（米）
  const HY0 = PLAT + 2.5;         // 须弥台基顶 = 正殿地坪上皮
  const GOLD = 0xcf9a2c, VERM = 0x9d2f22, STONE = 0x8f8b80, STONE2 = 0xaa9f88, JADE = 0xd8cdb4;
  const seed = mtInteriorSeed(m.x, m.z);

  // ① 山顶切坡平台（放大到 72×56，顶面仍 PLAT = gy+0.7，六件落位口径不变）
  b.box('ground', 72, 3.2, 56, m.x, gy - 0.9, m.z, 0x87847a);

  // ② 须弥台基：主体 + 上下枋线脚 + 束腰 + 四周望柱栏板
  const pedH = HY0 - PLAT;
  b.box('wall', 44, pedH, 28, m.x, PLAT + pedH / 2, m.z, STONE);
  b.box('wall', 46, 0.24, 30, m.x, PLAT + 0.12, m.z, STONE2);
  b.box('wall', 46, 0.24, 30, m.x, HY0 - 0.12, m.z, STONE2);
  b.box('wall', 45, 0.18, 29, m.x, PLAT + pedH * 0.5, m.z, 0xa8a08c);
  for (let i = -5; i <= 5; i++)
    for (const s of [-1, 1]) b.box('ash', 0.3, 0.9, 0.3, m.x + i * 4, HY0 + 0.45, m.z + s * 14, JADE);
  for (const s of [-1, 1]) b.box('ash', 44, 0.5, 0.16, m.x, HY0 + 0.35, m.z + s * 14, JADE);

  // ③ 月台 + 丹陛 + 踏跺（南向 +z，明间正前方）
  const YT = m.z + 14;
  b.box('wall', W + 8, 0.5, 8, m.x, HY0 - 0.25, YT, STONE);
  b.box('wall', W + 9, 0.18, 8.6, m.x, HY0 - 0.52, YT, STONE2);
  b.box('ash', 5, 0.14, 6, m.x, HY0 + 0.03, m.z + 16, JADE, 0, 0.12, 0);      // 丹陛石（斜面御路）
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++)
      b.box('ash', 6, 0.18, 0.7, m.x + s * 7, HY0 - 0.1 - i * 0.14, m.z + 18 - i * 0.7, STONE);
  for (const s of [-1, 1]) b.box('ash', 0.3, 0.8, 0.3, m.x + s * (W / 2 + 3), HY0 + 0.4, YT, JADE);

  // ④ 正殿：薄壁壳（明间格扇全卸成敞廊，内部陈设可见）+ 朱柱 + 金瓦重檐庑殿顶
  const TW = 0.55;
  b.box('wall', W, H, TW, m.x, HY0 + H / 2, m.z - D / 2 + TW / 2, VERM);        // 后墙
  for (const s of [-1, 1])
    b.box('wall', TW, H, D - TW * 2, m.x + s * (W / 2 - TW / 2), HY0 + H / 2, m.z, VERM);  // 两山墙
  const doorW = 11, bayW = (W - doorW) / 2;
  for (const s of [-1, 1]) {
    const bx = m.x + s * (doorW / 2 + bayW / 2);
    b.box('lacquer', bayW - 0.3, H * 0.8, 0.16, bx, HY0 + H * 0.4, m.z + D / 2 - 0.1, 0x5a231c);   // 格扇裙板
    for (let k = 1; k < 7; k++)
      b.box('wood', 0.09, H * 0.8, 0.1, bx - bayW / 2 + (k * bayW) / 7, HY0 + H * 0.4, m.z + D / 2 - 0.01, 0x8a5a2a); // 直棂格扇
    b.box('wood', bayW, 0.28, 0.2, bx, HY0 + H * 0.82, m.z + D / 2 - 0.05, 0x6b4a2b);
  }
  b.box('wood', doorW + 1, 0.5, 0.4, m.x, HY0 + H * 0.84, m.z + D / 2 - 0.05, 0x6b4a2b);  // 明间额枋
  for (let c = -3; c <= 3; c++) {                                               // 前廊朱柱 6 根（明间不落柱，敞开看进殿内）
    if (c === 0) continue;
    const px = m.x + c * 4.6, pz = m.z + D / 2 - 0.4;
    b.cyl('wood', 0.5, 0.58, H, 10, px, HY0 + H / 2, pz, VERM);
    b.cyl('ash', 0.72, 0.78, 0.3, 10, px, HY0 + 0.15, pz, STONE);
    b.box('wood', 0.9, 0.24, 0.9, px, HY0 + H - 0.3, pz, 0x6b4a2b);
  }
  // 重檐庑殿顶：宽下檐（腰檐）+ 内收上层墙身 + 金瓦主顶 + 鸱吻
  roofOn(b, W + 8, D + 6, HY0 + H * 0.55, m.x, m.z, 0, GOLD, t.trim);
  b.box('wall', W - 2, H * 0.5, D - 2, m.x, HY0 + H * 0.75, m.z, VERM);
  roofOn(b, W + 3, D + 2, HY0 + H, m.x, m.z, 0, GOLD, t.trim);
  const rhMain = Math.min(W + 3, D + 2) * 0.2 + 0.45;
  for (const s of [-1, 1]) b.box('glow', 0.8, 1.1, 0.8, m.x, HY0 + H + rhMain, m.z + s * (D * 0.42), t.trim);

  // ⑤ 匾额（寺名，挂明间额枋上）+ 衬板
  b.box('lacquer', 7.6, 2.2, 0.2, m.x, HY0 + H * 0.9, m.z + D / 2 + 0.15, 0x5a231c);
  sg.quad(atlas.text('mt' + m.name, t.nm, 260, 72, {
    color: '#ffe9b8', glow: '#ffd25e', bg: 'rgba(12,10,14,0.9)', border: 'rgba(255,210,94,.85)', fontPx: 50,
  }), 7.2, 2.0, m.x, HY0 + H * 0.9, m.z + D / 2 + 0.27, 0);
  b.box('glow', 7.0, 0.22, 0.22, m.x, HY0 + H * 0.9 - 1.2, m.z + D / 2 + 0.35, t.trim);

  // ⑥ 主庙内部陈设（高/中/低三档之「高档」全套礼佛 + 起居陈设）
  furnishMountainBuilding(b, {
    type: 'mainHall', cx: m.x, cy: HY0, cz: m.z, w: W - 1.2, d: D - 1.2, h: H,
    seed, tier: 'high', front: 1,
  });

  // ⑦ 两侧厢房（放大）+ 廊庑（连廊）+ 内部陈设（中档）
  for (const sx of [-1, 1]) {
    const wx = m.x + sx * (W / 2 + 8), wy0 = PLAT + 0.6;
    b.box('wall', 12, 0.6, 14, wx, PLAT + 0.3, m.z - 2, STONE);
    b.box('wall', 10, 6, 12, wx, wy0 + 3, m.z - 2, 0xd8cbaa);
    roofOn(b, 12, 13, wy0 + 6, wx, m.z - 2, 0, shade(t.roof, 1.05));
    furnishMountainBuilding(b, {
      type: 'sideRoom', cx: wx, cy: wy0, cz: m.z - 2, w: 9, d: 11, h: 5.8,
      seed: seed ^ (sx * 131 + 7), tier: 'mid', front: 1,
    });
    // 廊庑：沿台基边缘的连廊（柱 + 单坡瓦顶），连正殿与厢房
    const lx = m.x + sx * (W / 2 + 2);
    for (let k = -2; k <= 2; k++)
      b.cyl('wood', 0.16, 0.18, 3.4, 6, lx, HY0 + 1.7, m.z - 2 + k * 2.2, VERM);
    b.box('roof', 3.2, 0.2, 11, lx, HY0 + 3.5, m.z - 2, shade(t.roof, 0.95));
    furnishMountainBuilding(b, {
      type: 'corridor', cx: lx, cy: HY0, cz: m.z - 2, w: 2.6, d: 10, h: 3.3,
      seed: seed ^ (sx * 977 + 13), tier: 'mid',
    });
  }

  // ⑧ 山门（南向，移到前庭外缘，放大）+ 内部陈设（中档）
  const GZ = m.z + 26;
  b.box('wall', 12, 7, 1.6, m.x, PLAT + 3.5, GZ, shade(0x5a6472, 1.02));
  roofOn(b, 14, 3.4, PLAT + 7, m.x, GZ, 0, shade(t.roof, 1.0));
  b.box('glow', 8, 0.24, 0.24, m.x, PLAT + 5.6, GZ - 0.9, t.trim);
  furnishMountainBuilding(b, {
    type: 'gate', cx: m.x, cy: PLAT, cz: GZ, w: 11, d: 2.4, h: 6.5,
    seed: seed ^ 0x51c3, tier: 'mid', front: 1,
  });

  // ⑨ B7 差异件（45 卷城外庙观节）：全部移到前庭平台面，避免与新台基/正殿穿插
  if (m.name === '嵩山') { // 石翁仲八尊夹道（45 卷 048）
    for (let k = 0; k < 8; k++) {
      const ox = m.x - 10.5 + (k % 4) * 7, oz = m.z + 22 + Math.floor(k / 4) * 5;
      b.box('wall', 0.8, 2.8, 0.8, ox, PLAT + 1.4, oz, shade(0x87847a, 1.05));
      b.box('wall', 0.5, 0.5, 0.5, ox, PLAT + 3.0, oz, shade(0x87847a, 0.95));
    }
  }
  if (m.name === '天山') { // 冰凌檐挂（45 卷 049：M-19 檐口垂凌）：挂在新主顶前檐
    for (let k = 0; k < 9; k++)
      b.cyl('ash', 0.08, 0.22, 1.1 + (k % 3) * 0.4, 5, m.x - 12 + k * 3, HY0 + H + rhMain * 0.4, m.z + D / 2 + 1.0, shade(0xc9dce8, 0.9), 0, Math.PI);
  }
  if (m.name === '昆仑') { // 白玉柱廊（45 卷 050：M-18 白玉柱）：前庭两列
    for (let k = 0; k < 6; k++)
      b.cyl('ash', 0.4, 0.45, 6.0, 8, m.x - 12.5 + k * 5, PLAT + 3.0, m.z + 20, shade(0xd6d1c4, 0.95));
  }
  // WS-33 山林庙观六件：香亭/遥参亭/悬空栈道门/冰纹窗/雪廊/石碣，按山分派
  buildSanctumPieces(b, sg, atlas, m, gy);
}

// ============ 山林庙观六件（WS-33）：逐件 terrainHeight 九宫取样落地，任何一件都不悬空 ============

interface MtFoot { x: number; z: number; y: number; drop: number }

/** 落地点：九宫 terrainHeight 取样取最大（峰坡上取最大防被山体吞），drop 供台明补到坡脚 */
function mtFoot(x: number, z: number, half: number): MtFoot {
  let hi = -1e9, lo = 1e9;
  const q = half * 0.72;
  for (const [dx, dz] of [[0, 0], [half, 0], [-half, 0], [0, half], [0, -half], [q, q], [-q, -q], [q, -q], [-q, q]] as const) {
    const h = terrainHeight(x + dx, z + dz);
    hi = Math.max(hi, h);
    lo = Math.min(lo, h);
  }
  return { x, z, y: hi, drop: hi - lo };
}

/** 台明：砌到取样最高点 +0.18。山巅台基上的构件（floor=台面）只埋 1.6m，坡上构件一直砌到坡脚 */
function mtTerrace(b: Baker, f: MtFoot, w: number, d: number, hex: number, floor = -1e9): number {
  const top = Math.max(f.y, floor) + 0.18;
  const bot = floor > -1e9 && f.y < floor ? floor - 1.6 : f.y - f.drop - 1.4;
  b.box('ground', w, top - bot, d, f.x, (top + bot) / 2, f.z, hex);
  return top;
}

/** 踏跺：从坡脚 terrainHeight 起逐级升到台面，级高随坡度自适应，级身互相压叠不露空 */
function mtStairs(b: Baker, x: number, zFoot: number, n: number, w: number, run: number, yTop: number, hex: number): void {
  const yFoot = terrainHeight(x, zFoot);
  const rise = (yTop - yFoot) / n;
  for (let i = 0; i < n; i++) {
    const y = yFoot + rise * (i + 1);
    b.box('ash', w, rise + 0.45, run + 0.12, x, y - (rise + 0.45) / 2, zFoot - (i + 0.5) * run, hex);
  }
}

/** C-ITM-0321 香亭：泰山碧霞祠下院西庭，石铁焚香亭（44 卷归型：香亭石铁，卷棚同剪边） */
function mtIncensePavilion(b: Baker, m: Mountain, plat: number, roof: number, trim: number): void {
  const f = mtFoot(m.x - 22, m.z + 6, 4.4);
  const y = mtTerrace(b, f, 7.8, 7.8, 0x8b867a, plat);
  b.box('ash', 6.7, 0.3, 6.7, f.x, y + 0.15, f.z, 0x918d80);
  b.box('ash', 6.0, 0.24, 6.0, f.x, y + 0.42, f.z, 0x9b978a);
  const y0 = y + 0.54;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const px = f.x + sx * 2.4, pz = f.z + sz * 2.4;
    b.box('ash', 0.76, 0.26, 0.76, px, y0 + 0.13, pz, 0x8d897e);
    b.box('ash', 0.46, 3.0, 0.46, px, y0 + 1.5, pz, 0xa19d92);
    b.box('metal', 0.54, 0.16, 0.54, px, y0 + 0.36, pz, 0x4a4e54);
    b.box('metal', 0.52, 0.1, 0.52, px, y0 + 2.62, pz, 0x5a5e66);
  }
  for (const s of [-1, 1]) {
    b.box('metal', 5.0, 0.18, 0.22, f.x, y0 + 2.96, f.z + s * 2.4, 0x4a4e54);
    b.box('metal', 0.22, 0.18, 5.0, f.x + s * 2.4, y0 + 2.96, f.z, 0x4a4e54);
  }
  // 卷棚（低曲面）＋四道剪边
  roofOn(b, 7.0, 7.0, y0 + 3.1, f.x, f.z, 0, roof);
  for (const s of [-1, 1]) {
    b.box('glow', 6.8, 0.12, 0.12, f.x, y0 + 3.04, f.z + s * 3.5, trim);
    b.box('glow', 0.12, 0.12, 6.8, f.x + s * 3.5, y0 + 3.04, f.z, trim);
  }
  // 铁鼎（焚香）：炉身→口沿→三足→双耳→火
  b.cyl('metal', 0.72, 0.86, 0.78, 12, f.x, y0 + 0.39, f.z, 0x4a4e54);
  b.cyl('metal', 0.86, 0.8, 0.16, 12, f.x, y0 + 0.86, f.z, 0x5c6068);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    b.cyl('metal', 0.09, 0.12, 0.42, 5, f.x + Math.cos(a) * 0.6, y0 + 0.21, f.z + Math.sin(a) * 0.6, 0x44484f);
  }
  for (const s of [-1, 1]) b.box('metal', 0.16, 0.34, 0.5, f.x + s * 0.84, y0 + 0.92, f.z, 0x50545c);
  b.cyl('glow', 0.5, 0.58, 0.1, 12, f.x, y0 + 0.95, f.z, 0xff7a3c);
  for (let k = 0; k < 3; k++) {
    b.cyl('wood', 0.025, 0.03, 0.9, 4, f.x - 0.16 + k * 0.16, y0 + 1.4, f.z, 0x6a4a2c);
    b.cyl('glow', 0.032, 0.032, 0.09, 4, f.x - 0.16 + k * 0.16, y0 + 1.9, f.z, 0xffb36e);
  }
  // 南侧 供案＋二烛（上香交互的一侧）
  b.box('ash', 1.9, 0.58, 0.74, f.x, y0 + 0.29, f.z + 2.1, 0x8d897e);
  for (const s of [-1, 1]) {
    b.cyl('lacquer', 0.06, 0.09, 0.36, 6, f.x + s * 0.62, y0 + 0.76, f.z + 2.1, 0x8a2f24);
    b.cyl('glow', 0.05, 0.05, 0.14, 5, f.x + s * 0.62, y0 + 1.0, f.z + 2.1, 0xffcf7a);
  }
  // 幡杆二（东侧重檐外，风从西来先过幡）
  for (const s of [-1, 1]) {
    b.cyl('wood', 0.08, 0.1, 3.6, 6, f.x + s * 3.1, y0 + 1.8, f.z + 3.0, 0x6a4a2c);
    b.box('fabric', 0.66, 1.7, 0.05, f.x + s * 3.1 + 0.36, y0 + 2.5, f.z + 3.0, 0xc8a24a, 0.1 * s);
  }
  // R24：香亭补内部陈设（焚香器 / 供案 / 幡幢 / 蒲团 / 石灯，中档）
  furnishMountainBuilding(b, {
    type: 'incensePavilion', cx: f.x, cy: y0, cz: f.z, w: 6, d: 6, h: 3.2,
    seed: mtInteriorSeed(f.x, f.z), tier: 'mid',
  });
  b.kit('mt.incensePavilion', 1, y);
}

/** C-ITM-0348 遥参亭：嵩山中岳庙庙前歇脚亭（44 卷：遥参亭攒尖） */
function mtYuanCanPavilion(b: Baker, m: Mountain, roof: number, trim: number): void {
  const f = mtFoot(m.x + 7, m.z + 42, 3.9);
  const y = mtTerrace(b, f, 7.4, 7.4, 0x8a857a);
  mtStairs(b, f.x, f.z + 3.7 + 5 * 0.66, 5, 2.9, 0.66, y, 0x8a857a);
  b.box('ash', 6.4, 0.26, 6.4, f.x, y + 0.13, f.z, 0x938e82);
  const y0 = y + 0.26;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const px = f.x + sx * 2.5, pz = f.z + sz * 2.5;
    b.box('ash', 0.62, 0.24, 0.62, px, y0 + 0.12, pz, 0x8d897e);
    b.box('wood', 0.34, 3.0, 0.34, px, y0 + 1.5, pz, 0x7a4a2c);
    b.box('wood', 0.42, 0.14, 0.42, px, y0 + 2.42, pz, 0x8a5530);
  }
  // 美人靠：三面坐凳＋靠背（南面留踏步）
  for (const [ax, az, rot] of [[0, -2.5, 0], [-2.5, 0, Math.PI / 2], [2.5, 0, Math.PI / 2]] as const) {
    b.box('wood', 5.0, 0.12, 0.44, f.x + ax, y0 + 0.56, f.z + az, 0x7a4a2c, rot);
    b.box('wood', 5.0, 0.1, 0.12, f.x + ax, y0 + 0.96, f.z + az, 0x6a4a2c, rot);
    for (let k = 0; k < 4; k++) {
      const t = -0.39 + k * 0.26;
      b.box('wood', 0.09, 0.4, 0.09, f.x + ax + Math.cos(rot) * t * 5.0, y0 + 0.75, f.z + az - Math.sin(rot) * t * 5.0, 0x6a4a2c);
    }
  }
  // 石桌一、石凳四（远参歇脚）
  b.cyl('ash', 0.72, 0.78, 0.16, 12, f.x, y0 + 0.86, f.z, 0x96928a);
  b.cyl('ash', 0.26, 0.32, 0.78, 10, f.x, y0 + 0.39, f.z, 0x8b8780);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.cyl('ash', 0.26, 0.3, 0.44, 8, f.x + sx * 1.35, y0 + 0.22, f.z + sz * 1.35, 0x8f8b84);
  }
  // 攒尖顶＋四角起翘＋剪边＋宝顶
  b.pyramid('roof', 0.1, 4.5, f.x, y0 + 4.14, f.z, roof, 0, 1, 2.32, 1);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.box('roof', 1.1, 0.15, 0.36, f.x + sx * 2.92, y0 + 3.04, f.z + sz * 2.92, shade(roof, 0.92), -sx * sz * 0.785, 0, sx * 0.18);
  }
  for (const s of [-1, 1]) {
    b.box('glow', 6.2, 0.1, 0.1, f.x, y0 + 2.98, f.z + s * 3.18, trim);
    b.box('glow', 0.1, 0.1, 6.2, f.x + s * 3.18, y0 + 2.98, f.z, trim);
  }
  b.cyl('metal', 0.12, 0.16, 0.34, 8, f.x, y0 + 5.44, f.z, 0x4a4e54);
  b.cyl('glow', 0.05, 0.09, 0.5, 6, f.x, y0 + 5.86, f.z, trim);
  // R24：遥参亭补歇脚陈设（石桌 / 石凳 / 石灯 / 瓶花，中档）
  furnishMountainBuilding(b, {
    type: 'yuanCanPavilion', cx: f.x, cy: y0, cz: f.z, w: 6, d: 6, h: 3.2,
    seed: mtInteriorSeed(f.x, f.z), tier: 'mid',
  });
  b.kit('mt.yuanCanPavilion', 1, y);
}

/** C-ITM-0340 悬空栈道门：华山崖口，木石栈门＋悬挑栈道（柱脚逐根 terrainHeight 落坡，栈面悬出坡外） */
function mtCliffPlankGate(b: Baker, m: Mountain, roof: number, trim: number): void {
  const gx = m.x + 118, gz = m.z - 24;
  const f = mtFoot(gx, gz, 4.6);
  const deck = f.y + 1.25;
  // 栈面：沿等高线（z 向）铺九段板，逐段 terrainHeight 取样，板底由石柱托住
  for (let i = 0; i < 9; i++) {
    const zc = gz - 8 + i * 2;
    const g = Math.max(terrainHeight(gx - 1.2, zc), terrainHeight(gx + 1.2, zc));
    const y = Math.max(deck, g + 1.25);
    b.box('wood', 2.3, 0.18, 2.05, gx, y, zc, shade(0x6a4a2c, 0.94 + (i % 2) * 0.08));
    b.box('metal', 0.12, 0.1, 2.0, gx - 0.95, y + 0.14, zc, 0x4a4e54);
  }
  // 下坡侧三根石柱（柱脚取各自 terrainHeight，长柱脚让栈面悬在坡外）
  for (const lz of [-5.6, 0, 5.6]) {
    const px = gx + 1.35, pz = gz + lz;
    const g = terrainHeight(px, pz);
    const hgt = deck - g + 0.5;
    b.box('ash', 1.0, hgt, 1.1, px, deck - hgt / 2 + 0.06, pz, 0x6d685e);
    b.box('ash', 1.36, 0.26, 1.46, px, deck - 0.05, pz, 0x7a7468);
    // 斜撑（石柱→上部岩壁）
    b.box('wood', 0.22, 3.0, 0.22, px - 1.1, deck - 1.35, pz, 0x6a4a2c, 0, 0, -0.62);
  }
  // 门柱：一在坡上（短），一在悬挑石柱上（长），门楣跨 x
  for (const [px, grounded] of [[gx - 1.35, true], [gx + 1.35, false]] as const) {
    const g = grounded ? terrainHeight(px, gz) : deck;
    const h = deck + 3.9 - g;
    b.box('wood', 0.56, h, 0.56, px, g + h / 2, gz, 0x6a4a2c);
    if (grounded) b.box('ash', 0.86, 0.3, 0.86, px, g + 0.15, gz, 0x7d786c);
    b.box('metal', 0.64, 0.14, 0.64, px, g + 0.72, gz, 0x4a4e54);
    b.box('metal', 0.64, 0.12, 0.64, px, deck + 3.2, gz, 0x4a4e54);
  }
  b.box('lacquer', 3.5, 0.62, 0.5, gx, deck + 3.6, gz, 0x7a2f22);
  b.box('wood', 3.9, 0.24, 0.62, gx, deck + 4.02, gz, 0x6a4a2c);
  for (const s of [-1, 1]) {
    b.box('lacquer', 1.15, 2.7, 0.1, gx + s * 0.62, deck + 1.85, gz - 0.42, 0x7a2f22, -s * 0.5);
    b.box('metal', 0.16, 0.16, 0.16, gx + s * 1.28, deck + 2.6, gz, 0x4a4e54);
  }
  // 悬空侧栏杆（立柱＋上下两道木栏＋铁链）
  for (let i = 0; i <= 8; i++) {
    const zc = gz - 8 + i * 2;
    b.box('wood', 0.16, 1.12, 0.16, gx + 1.1, deck + 0.56, zc, 0x5a3e22);
  }
  for (const dy of [0.62, 1.02]) {
    b.box('wood', 0.1, 0.1, 16.3, gx + 1.1, deck + dy, gz, 0x6a4a2c);
  }
  b.box('metal', 0.06, 0.06, 16.3, gx + 1.1, deck + 0.34, gz, 0x565a62);
  // 崖口两侧石墩＋铁链
  for (const s of [-1, 1]) {
    const pz = gz + s * 8.6;
    const g = terrainHeight(gx, pz);
    b.box('ash', 1.3, 1.5, 1.3, gx, g + 0.55, pz, 0x726d62);
    b.box('metal', 0.1, 0.1, 2.4, gx, g + 1.2, pz - s * 1.3, 0x565a62, 0, 0.25);
  }
  b.box('glow', 0.3, 0.42, 0.3, gx - 1.62, deck + 2.9, gz, 0xffb36e); // 门灯
  b.box('glow', 3.4, 0.1, 0.1, gx, deck + 4.16, gz, trim);             // 门楣剪边
  roofOn(b, 4.2, 2.4, deck + 4.2, gx - 0.1, gz, 0, roof);              // 门楼小瓦顶
  // R24：悬空栈道门补门内陈设（灯笼 / 幡 / 香炉 / 石灯，中档）
  furnishMountainBuilding(b, {
    type: 'cliffGate', cx: gx, cy: deck, cz: gz, w: 3.4, d: 3.4, h: 3.2,
    seed: mtInteriorSeed(gx, gz), tier: 'mid',
  });
  b.kit('mt.cliffPlankGate', 1, deck);
}

/** C-ITM-0353 冰纹窗 12：雪帘禅院殿周四座窗屏 ×3 扇（木框＋冰裂格心＋双层糊：内绢外明瓦） */
function mtIceCrackWindows(b: Baker, m: Mountain, plat: number): void {
  let seed = (Math.imul(Math.round(m.x * 3 + m.z * 5), 1664525) ^ 0x51c3a7) >>> 0;
  const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (const [ox, oz] of [[-26, -17], [26, -17], [-26, 17], [26, 17]] as const) {
    const f = mtFoot(m.x + ox, m.z + oz, 3.5);
    const y = mtTerrace(b, f, 7.8, 1.6, 0x8b877c, plat);
    b.box('ash', 7.3, 0.24, 1.3, f.x, y + 0.12, f.z, 0x94907f);
    for (let k = 0; k < 4; k++) b.box('wood', 0.26, 2.6, 0.36, f.x - 3.3 + k * 2.2, y + 1.54, f.z, 0x6a4a2c);
    b.box('wood', 7.0, 0.22, 0.42, f.x, y + 2.95, f.z, 0x7a5533);
    b.box('wood', 7.0, 0.2, 0.42, f.x, y + 0.32, f.z, 0x6a4a2c);
    for (let k = 0; k < 3; k++) {
      const wx = f.x - 2.2 + k * 2.2;
      b.box('fabric', 1.74, 2.2, 0.06, wx, y + 1.62, f.z, 0xf4ecd8);
      for (let j = 0; j < 6; j++) {
        b.box('wood', 0.55 + rnd() * 1.1, 0.055, 0.08,
          wx + (rnd() - 0.5) * 0.55, y + 0.82 + j * 0.3 + rnd() * 0.14, f.z + 0.05, 0x6a4a2c, 0, 0, (rnd() - 0.5) * 1.75);
      }
      b.box('glow', 0.42, 0.42, 0.03, wx, y + 1.78, f.z + 0.06, 0xcfe6f2); // 明瓦
    }
    // 瓦小檐＋雪脊＋檐口冰凌（雪脊/冰凌不再用近白：0xeef3f8 / 0xf8f8ff 是山顶爆白的主色）
    b.box('roof', 7.9, 0.2, 1.1, f.x, y + 3.16, f.z, 0x3a4046);
    b.box('ash', 7.7, 0.12, 0.92, f.x, y + 3.29, f.z, 0xc7d3dd);
    for (let k = 0; k < 5; k++) {
      b.cyl('ash', 0.06, 0.16, 0.55, 5, f.x - 3.1 + k * 1.55, y + 2.9, f.z + 0.52, shade(0xc9dce8, 0.9), 0, Math.PI);
    }
    // R24：每座冰纹窗屏补贴墙陈设（香炉 / 石灯 / 蒲团，低档）
    furnishMountainBuilding(b, {
      type: 'iceWindow', cx: f.x, cy: y, cz: f.z, w: 7, d: 1.4, h: 3,
      seed: (mtInteriorSeed(f.x, f.z) ^ ((ox * 31 + oz * 17) | 0)) | 0, tier: 'low',
    });
    b.kit('mt.iceCrackWindow', 3, y);
  }
}

/** C-ITM-0354 雪廊：雪帘禅院西院墙内挡雪连廊（木柱＋单坡瓦顶＋雪脊冰凌） */
function mtSnowGallery(b: Baker, m: Mountain, plat: number, roof: number): void {
  const cx = m.x - 27.5;
  const bays = 9, span = 3.2;
  const z0 = m.z - (bays * span) / 2;
  const base = (px: number, pz: number): number => Math.max(terrainHeight(px, pz), plat);
  for (let i = 0; i < bays; i++) {
    const zc = z0 + (i + 0.5) * span;
    const fy = Math.max(base(cx - 1.35, zc), base(cx + 1.35, zc)) + 0.18;
    b.box('wood', 3.1, 0.18, span - 0.1, cx, fy, zc, shade(0x6a4a2c, 0.92 + (i % 3) * 0.05));
    // 外侧（西）挡雪矮墙＋雪压顶
    b.box('earth', 0.3, 1.0, span - 0.1, cx - 1.5, fy + 0.5, zc, 0x8b7f6a);
    b.box('ash', 0.44, 0.12, span - 0.1, cx - 1.5, fy + 1.06, zc, 0xc7d3dd);
    // 内侧（院）栏杆
    b.box('wood', 0.12, 0.1, span - 0.1, cx + 1.5, fy + 0.98, zc, 0x7a5533);
    b.box('wood', 0.1, 0.1, span - 0.1, cx + 1.5, fy + 0.56, zc, 0x6a4a2c);
    // 单坡瓦顶（向院内低，雪从外侧滑落）＋雪脊
    b.box('roof', 3.7, 0.16, span - 0.04, cx, plat + 2.62, zc, roof, 0, 0, -0.2);
    b.box('ash', 3.6, 0.12, span - 0.16, cx, plat + 2.74, zc, 0xc7d3dd, 0, 0, -0.2);
    b.box('wood', 3.5, 0.12, 0.14, cx, plat + 2.5, zc + span / 2 - 0.1, 0x7a5533);
    for (let k = 0; k < 3; k++) {
      b.cyl('ash', 0.05, 0.13, 0.5, 5, cx + 1.55, plat + 2.4, zc - 1.0 + k * 1.0, shade(0xc9dce8, 0.9), 0, Math.PI);
    }
  }
  // 柱列：逐柱 terrainHeight 取样（台基范围内取台面），柱脚一律落在实地
  for (let i = 0; i <= bays; i++) {
    const zb = z0 + i * span;
    for (const s of [-1, 1]) {
      const px = cx + s * 1.35;
      const g = base(px, zb) - 0.15;
      const hgt = plat + 2.55 - g;
      b.box('wood', 0.22, hgt, 0.22, px, g + hgt / 2, zb, 0x6a4a2c);
      b.box('ash', 0.34, 0.16, 0.34, px, g + 0.08, zb, 0x8d897e);
    }
  }
  // R24：雪廊补连廊陈设（灯笼 / 石凳 / 香炉 / 瓶花 / 经卷架，中档）
  furnishMountainBuilding(b, {
    type: 'snowGallery', cx, cy: plat, cz: m.z, w: 3, d: 28, h: 2.6,
    seed: mtInteriorSeed(cx, m.z), tier: 'mid',
  });
  b.kit('mt.snowGallery', 1, plat); // 一件连廊（9 开间在同一条廊身上）
}

/** C-ITM-0380 石碣：恒山北嶽廟庙前石（「石碣村」刻字，打卡点） */
function mtStoneStele(b: Baker, sg: SignMesher, atlas: SignAtlas, m: Mountain): void {
  const f = mtFoot(m.x - 6, m.z + 56, 2.2);
  const y = mtTerrace(b, f, 3.6, 2.6, 0x87847a);
  b.box('ash', 3.1, 0.3, 2.1, f.x, y + 0.15, f.z, 0x8f8b80);
  b.box('ash', 2.3, 0.28, 1.5, f.x, y + 0.44, f.z, 0x99958a);
  b.box('ash', 1.5, 0.22, 1.1, f.x, y + 0.69, f.z, 0x8d897e);
  const sy = y + 0.8;
  b.box('ash', 1.42, 2.55, 0.44, f.x, sy + 1.27, f.z, 0x8a867c);
  b.box('ash', 1.58, 0.24, 0.56, f.x, sy + 2.66, f.z, 0x938f84);
  b.pyramid('ash', 0.12, 0.7, f.x, sy + 2.92, f.z, 0x87847a, 0, 1, 0.34, 0.7);
  // 「石碣村」刻字（竖排三字，字口压暗底）
  sg.quad(atlas.text('mt.steleBiejie', '石碣村', 96, 260, {
    color: '#e6e0c8', bg: 'rgba(24,22,20,0.55)', fontPx: 62, vertical: true,
  }), 0.62, 1.7, f.x, sy + 1.5, f.z + 0.235, 0);
  for (const ky of [0.72, 2.1]) b.box('metal', 1.5, 0.08, 0.5, f.x, sy + ky, f.z, 0x565a62);
  // 字口苔与碣脚苔
  for (let k = 0; k < 4; k++) {
    b.box('leaf', 0.28 + (k % 2) * 0.14, 0.06, 0.12, f.x - 0.4 + k * 0.28, sy + 0.9 + (k % 3) * 0.42, f.z + 0.23, shade(0x3e5a34, 0.9 + (k % 2) * 0.2));
  }
  // 供石＋双烛＋香炉
  b.box('ash', 1.7, 0.24, 0.6, f.x, y + 0.74, f.z + 1.05, 0x8b8780);
  for (const s of [-1, 1]) {
    b.cyl('lacquer', 0.054, 0.08, 0.3, 6, f.x + s * 0.5, y + 1.0, f.z + 1.05, 0x8a2f24);
    b.cyl('glow', 0.045, 0.045, 0.12, 5, f.x + s * 0.5, y + 1.2, f.z + 1.05, 0xffcf7a);
  }
  b.cyl('metal', 0.22, 0.28, 0.3, 8, f.x, y + 1.0, f.z + 0.62, 0x4a4e54);
  // R24：石碣补供石陈设（香炉 / 石灯 / 蒲团，低档）
  furnishMountainBuilding(b, {
    type: 'stoneStele', cx: f.x, cy: y, cz: f.z, w: 3.2, d: 2.4, h: 2.8,
    seed: mtInteriorSeed(f.x, f.z), tier: 'low',
  });
  b.kit('mt.stoneStele', 1, y);
}

/** 六件按山分派：泰山香亭、嵩山遥参亭、华山悬空栈道门、天山冰纹窗＋雪廊、恒山石碣 */
function buildSanctumPieces(b: Baker, sg: SignMesher, atlas: SignAtlas, m: Mountain, gy: number): void {
  const t = MOUNTAIN_TEMPLES[m.name];
  if (!t) return;
  const plat = gy + 0.7; // 64×48 山顶台基面（与 buildMountainTemple 的台基同高）
  switch (m.name) {
    case '泰山': mtIncensePavilion(b, m, plat, t.roof, t.trim); break;
    case '嵩山': mtYuanCanPavilion(b, m, t.roof, t.trim); break;
    case '华山': mtCliffPlankGate(b, m, t.roof, t.trim); break;
    case '天山': mtIceCrackWindows(b, m, plat); mtSnowGallery(b, m, plat, t.roof); break;
    case '恒山': mtStoneStele(b, sg, atlas, m); break;
    default: break;
  }
}

// ============ 七岳远景地标群（R21 布局 / R24 人类尺度）：每山 16 组 + 主题标志建筑 ============
/**
 * 用户「山上的风景建筑是什么？远景仍是光滑大包」诉求：V-02 每山 8 组、暗瓦冷色(0x3b4045/0x3a6b8c/
 * 0x4e7a5e)在远雾里被吃掉。R21 改为每山 MTN_LANDMARK_GROUPS=16 组、高对比暖金/朱红/亮白/
 * 赭黄配色(MTN_LANDMARK_COLORS)，并按每山主题补一组标志建筑（南天门+十八盘 / 苍龙岭 /
 * 悬空寺 / 少林山门 / 雪峰经幢 / 瑶池）。站点落在 0.36–0.70r 坡面，逐件 mtFoot 九宫取样落地。
 *
 * R24：用户「山变大了，山上的建筑是不是太大了，需要缩小到人类比例！！」——旧实现把主尺度
 * S=min(m.r*0.075, m.h*0.22) 绑死在山体半径上，山 ×2 后塔高达 713~1584m。本轮把 S 换成
 * LM_METERS 常量表（固定米数，按地标类型分档），山体尺寸保持不变、建筑缩回人类尺度。
 * 所有 case 几何系数原样保留，只把「基准」由「米/山」换成「米/常量」；零 RNG / 零 Math.random /
 * 零 Date、零新增 draw call，全部走 Baker 合批。
 */
function buildMountainLandmarks(b: Baker, m: Mountain): void {
  // R24：S 不再由 m.r / m.h 派生。站点台基用独立人类尺度基准，主体几何按 kind 取 LM_METERS 表。
  const SITE = LM_METERS.SITE;
  const C = MTN_LANDMARK_COLORS;
  // 种子只用小整数：hash2 内部 ix*374761393，输入超 ~2^24 会丢浮点精度，故按百米折算
  const sd = (Math.round(m.x / 100) * 31 + Math.round(m.z / 100) * 17 + 913) | 0;
  for (let k = 0; k < MTN_LANDMARK_GROUPS; k++) {
    const h1 = hash2(sd + k * 31, sd * 3 - k * 17 + 11);
    const h2 = hash2(sd * 5 - k * 13 + 5, sd + k * 29 + 41);
    const h3 = hash2(sd + k * 7 + 41, sd * 7 + k * 53 - 3);
    const ang = (k / MTN_LANDMARK_GROUPS) * Math.PI * 2 + (h1 - 0.5) * 0.5;
    const rad = m.r * (0.36 + 0.34 * h2);   // R21b：站点收进山腰坡面，不再落到山脚外成悬空孤柱
    let fx = m.x + Math.cos(ang) * rad, fz = m.z + Math.sin(ang) * rad;
    if (Math.abs(fx) < 5600 && Math.abs(fz) < 5600) { fx = m.x - Math.cos(ang) * rad; fz = m.z - Math.sin(ang) * rad; }
    const f = mtFoot(fx, fz, SITE * 0.42);
    const y0 = f.y + 0.3;
    // R21b/R24：台基封顶 0.42·SITE。陡坡上 f.drop 可达数百米，旧式「砌到坡脚」会把台基拉成
    // 100m+ 高方柱；封顶后成 3.36m 以内的矮宽台，顶面仍在 y0 贴建筑底面。
    const pierH = Math.min(f.drop + 0.3 + SITE * 0.06, SITE * 0.42);
    b.box('ground', SITE * 0.8, pierH, SITE * 0.8, fx, y0 - pierH / 2, fz, C.white);
    const kind = (k + Math.floor(h3 * 8)) % 8;
    // R24：主体建筑基准钉死为人类尺度常量（米），不再随 m.r / m.h 放大；case 内所有 S*系数
    // 因此全部落在真实营造尺度。PH 为该档柱/阙高度。
    const S = LM_KIND_METERS[kind];
    const PH = S * MTN_PILLAR_RATIO;
    switch (kind) {
      case 0: { // 七层楼阁塔：朱柱 + 层层金瓦挑檐 + 亮白塔身 + 发光塔刹
        let w = S * 0.4;
        for (let i = 0; i < 7; i++) {
          const yy = y0 + S * (0.06 + i * 0.17);
          b.box('ash', w, S * 0.15, w, fx, yy + S * 0.075, fz, C.white);
          b.box('roof', w * 1.4, S * 0.028, w * 1.4, fx, yy + S * 0.16, fz, C.gold);
          w *= 0.89;
        }
        b.box('glow', S * 0.03, S * 0.22, S * 0.03, fx, y0 + S * 1.32, fz, C.glow);
        break;
      }
      case 1: { // 重檐攒尖亭：朱柱(PH) + 贯通额枋 + 金/朱递减方顶 + 发光宝顶
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
          b.box('wood', S * 0.045, PH, S * 0.045, fx + sx * S * 0.18, y0 + PH / 2, fz + sz * S * 0.18, C.vermilion);
        b.box('ash', S * 0.5, S * 0.05, S * 0.5, fx, y0 + PH, fz, C.vermilion);   // 贯通四柱，不再四根孤柱
        for (let i = 0; i < 4; i++) {
          const w = S * 0.5 * (1 - i * 0.2);
          b.box('roof', w, S * 0.04, w, fx, y0 + PH + S * (0.06 + i * 0.06), fz, i % 2 ? C.vermilion : C.gold);
        }
        b.box('glow', S * 0.025, S * 0.12, S * 0.025, fx, y0 + PH + S * 0.30, fz, C.glow);
        break;
      }
      case 2: { // 石牌坊：白石双柱(PH) + 贯通额枋 + 金瓦楼顶 + 发光金匾 = 完整牌坊
        for (const s of [-1, 1]) b.box('ash', S * 0.07, PH, S * 0.07, fx + s * S * 0.26, y0 + PH / 2, fz, C.white);
        b.box('ash', S * 0.66, S * 0.08, S * 0.1, fx, y0 + PH * 0.80, fz, C.vermilion);   // 额枋贯通双柱
        b.box('roof', S * 0.7, S * 0.05, S * 0.16, fx, y0 + PH + S * 0.02, fz, C.gold);   // 楼顶
        b.box('glow', S * 0.3, S * 0.1, S * 0.02, fx, y0 + PH * 0.55, fz + S * 0.055, C.glow);
        break;
      }
      case 3: { // 悬空栈道：朱漆悬挑板 + 白石支柱，沿等高线九段
        for (let i = 0; i < 9; i++) {
          const zc = fz + (i - 4) * S * 0.13;
          const g = Math.max(terrainHeight(fx - S * 0.08, zc), terrainHeight(fx + S * 0.08, zc));
          const deck = Math.max(y0, g) + S * 0.06;
          b.box('wood', S * 0.16, S * 0.02, S * 0.13, fx, deck, zc, C.vermilion);
          b.box('ash', S * 0.03, Math.max(S * 0.02, deck - g), S * 0.03,
            fx + S * 0.07, (deck + g) / 2, zc, C.white);
        }
        break;
      }
      case 4: { // 摩崖刻石：贴地矮岩壁 + 金瓦压顶 + 三道发光字口（R21b 压低贴台基，不成悬空方块）
        b.box('ash', S * 0.9, S * 0.16, S * 0.32, fx, y0 + S * 0.08, fz, C.ochre);
        b.box('ash', S * 0.95, S * 0.05, S * 0.38, fx, y0 + S * 0.18, fz, C.gold);
        for (let i = 0; i < 3; i++)
          b.box('glow', S * 0.1, S * 0.10, S * 0.012,
            fx + (i - 1) * S * 0.24, y0 + S * 0.10, fz + S * 0.165, C.glow);
        break;
      }
      case 5: { // 登山长阶（十八盘意象）：白石 15 级逐点贴地
        const dl = Math.hypot(fx - m.x, fz - m.z) || 1;
        const ux = (fx - m.x) / dl, uz = (fz - m.z) / dl, rot = Math.atan2(ux, uz);
        for (let i = 0; i < 15; i++) {
          const sx = fx + ux * i * S * 0.09, sz = fz + uz * i * S * 0.09;
          const g = terrainHeight(sx, sz);
          b.box('ash', S * 0.2, S * 0.05, S * 0.1, sx, g + S * 0.025, sz, C.white, rot);
        }
        break;
      }
      case 6: { // 经幢群：白石五幢 + 金瓦方幢顶
        for (let i = 0; i < 5; i++) {
          const ox = fx + (i - 2) * S * 0.15;
          const g = terrainHeight(ox, fz);
          const hh = S * (0.26 + 0.05 * (i % 3));
          b.box('ash', S * 0.075, hh, S * 0.075, ox, g + hh / 2, fz, C.white);
          b.box('roof', S * 0.11, S * 0.08, S * 0.11, ox, g + hh + S * 0.04, fz, C.gold);
        }
        break;
      }
      default: { // 关隘山门：矮朱门台 + 发光门洞 + 白石双阙(PH) + 贯通额枋 + 金瓦重檐 = 完整山门
        b.box('ash', S * 0.66, S * 0.20, S * 0.16, fx, y0 + S * 0.10, fz, C.vermilion);
        b.box('glow', S * 0.15, S * 0.13, S * 0.02, fx, y0 + S * 0.09, fz + S * 0.09, C.glow);
        for (const s of [-1, 1]) b.box('ash', S * 0.12, PH, S * 0.12, fx + s * S * 0.32, y0 + S * 0.20 + PH / 2, fz, C.white);
        b.box('ash', S * 0.80, S * 0.05, S * 0.16, fx, y0 + S * 0.20 + PH, fz, C.vermilion);  // 额枋贯通双阙
        b.box('roof', S * 0.92, S * 0.06, S * 0.28, fx, y0 + S * 0.20 + PH + S * 0.06, fz, C.gold);
        b.box('roof', S * 0.72, S * 0.05, S * 0.24, fx, y0 + S * 0.20 + PH + S * 0.13, fz, C.vermilion);
        break;
      }
    }
    b.kit('mt.landmark' + kind, 1, y0);
    // R24：每座远景地标也补「内部/台面」陈设（低档为主、大件按 hash 升中档），全走坐标 hash。
    furnishMountainBuilding(b, {
      type: LM_FURNISH_TYPE[kind], cx: fx, cy: y0, cz: fz,
      w: S * 0.8, d: S * 0.8, h: S * 0.5,
      seed: (mtInteriorSeed(fx, fz) ^ (sd * 31 + k * 17)) | 0,
    });
  }
  // ---- 每山主题标志建筑（R21 布局 / R24 人类尺度）：复用 b.box/b.cyl 合批，确定性坐标，零 RNG ----
  // R24：主题件同样不再随山体放大，统一取 LM_METERS.THEME 人类尺度基准。
  const S = LM_METERS.THEME;
  const PH = S * MTN_PILLAR_RATIO;
  const tx = m.x + Math.cos(m.streamAng) * m.r * 0.30;
  const tz = m.z + Math.sin(m.streamAng) * m.r * 0.30;
  const tf = mtFoot(tx, tz, S * 0.5);
  const ty = tf.y + 0.3;
  switch (m.name) {
    case '泰山': { // 南天门 + 十八盘：矮台基 + 朱双阙(PH) + 贯通额枋 + 金瓦 + 长阶
      b.box('ash', S * 1.1, S * 0.12, S * 0.5, tx, ty + S * 0.06, tz, C.ochre);
      for (const s of [-1, 1])
        b.box('ash', S * 0.14, PH, S * 0.14, tx + s * S * 0.42, ty + S * 0.12 + PH / 2, tz, C.vermilion);
      b.box('ash', S * 1.05, S * 0.06, S * 0.16, tx, ty + S * 0.12 + PH, tz, C.vermilion);   // 额枋贯通双阙
      b.box('roof', S * 1.2, S * 0.06, S * 0.6, tx, ty + S * 0.12 + PH + S * 0.06, tz, C.gold);
      b.box('glow', S * 0.5, S * 0.12, S * 0.03, tx, ty + S * 0.12 + PH * 0.55, tz + S * 0.26, C.glow);
      for (let i = 0; i < 12; i++) {   // 十八盘长阶：逐点贴地（不再悬空成白条列）
        const sz2 = tz - i * S * 0.05;
        const g2 = terrainHeight(tx, sz2);
        b.box('ash', S * 0.5, S * 0.03, S * 0.08, tx, g2 + S * 0.015, sz2, C.white);
      }
      break;
    }
    case '华山': { // 苍龙岭：一道窄长亮白刃脊 + 两侧朱栏
      for (let i = 0; i < 16; i++) {
        const zz = tz - i * S * 0.07;
        b.box('ash', S * 0.16, S * 0.05, S * 0.09, tx, ty + S * 0.02, zz, C.white);
        for (const s of [-1, 1]) b.box('wood', S * 0.02, S * 0.09, S * 0.02, tx + s * S * 0.1, ty + S * 0.08, zz, C.vermilion);
      }
      break;
    }
    case '恒山': { // 悬空寺：亮白基岩 + 贴崖朱柱(PH) + 贯通长廊额枋 + 金瓦顶
      b.box('ash', S * 1.0, S * 0.1, S * 0.5, tx, ty, tz, C.white);
      for (let i = 0; i < 8; i++) {
        const xx = tx + (i - 3.5) * S * 0.13;
        b.box('wood', S * 0.05, PH, S * 0.05, xx, ty + PH / 2, tz, C.vermilion);
      }
      b.box('ash', S * 1.05, S * 0.05, S * 0.5, tx, ty + PH, tz, C.vermilion);   // 贯通八柱
      b.box('roof', S * 1.1, S * 0.06, S * 0.6, tx, ty + PH + S * 0.06, tz, C.gold);
      b.box('glow', S * 0.8, S * 0.04, S * 0.02, tx, ty + PH * 0.5, tz + S * 0.26, C.glow);
      break;
    }
    case '嵩山': { // 少林山门：朱红双阙(PH) + 白石额枋贯通 + 金瓦 + 发光匾
      for (const s of [-1, 1]) b.box('ash', S * 0.16, PH, S * 0.16, tx + s * S * 0.4, ty + PH / 2, tz, C.vermilion);
      b.box('ash', S * 0.95, S * 0.1, S * 0.2, tx, ty + PH * 0.92, tz, C.white);   // 额枋贯通双阙
      b.box('roof', S * 1.1, S * 0.07, S * 0.4, tx, ty + PH + S * 0.05, tz, C.gold);
      b.box('glow', S * 0.4, S * 0.12, S * 0.03, tx, ty + PH * 0.55, tz + S * 0.12, C.glow);
      break;
    }
    case '天山': { // 雪峰经幢：亮白经幢群 + 金顶 + 发光宝珠
      for (let i = 0; i < 7; i++) {
        const xx = tx + (i - 3) * S * 0.16;
        const hh = S * (0.3 + 0.06 * (i % 3));
        b.cyl('ash', S * 0.05, S * 0.06, hh, 8, xx, ty + hh / 2, tz, C.white);
        b.box('roof', S * 0.13, S * 0.06, S * 0.13, xx, ty + hh + S * 0.03, tz, C.gold);
      }
      b.box('glow', S * 0.08, S * 0.08, S * 0.08, tx, ty + S * 0.5, tz, C.glow);
      break;
    }
    case '昆仑': { // 瑶池：亮白环形池岸 + 发光水面 + 中央朱金亭
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.box('ash', S * 0.16, S * 0.08, S * 0.16, tx + Math.cos(a) * S * 0.5, ty, tz + Math.sin(a) * S * 0.5, C.white);
      }
      b.box('glow', S * 0.8, S * 0.02, S * 0.8, tx, ty + S * 0.01, tz, C.glow);
      b.box('wood', S * 0.06, PH, S * 0.06, tx, ty + PH / 2, tz, C.vermilion);
      b.box('roof', S * 0.5, S * 0.06, S * 0.5, tx, ty + PH + S * 0.04, tz, C.gold);
      break;
    }
    default: break;   // 衡山：16 组通用地标已足够，无额外主题件
  }
  // R24：主题标志建筑同样补陈设（中档，按主题取件），零共享 RNG。
  furnishMountainBuilding(b, {
    type: THEME_FURNISH_TYPE[m.name] ?? 'generic', cx: tx, cy: ty, cz: tz,
    w: S * 1.1, d: S * 0.6, h: S * 0.5,
    seed: mtInteriorSeed(tx, tz), tier: 'mid',
  });
  // 运行时台账：便于统计每山 / 总体地标组数（不影响几何、零 draw call）
  b.kit('mtn.landmark.count', MTN_LANDMARK_GROUPS);
  b.kit('mtn.landmark.' + m.name, MTN_LANDMARK_GROUPS);
}

// ---- 【停用·v92】远山三层色带：旧版"七座同形锥"的补丁，在光滑坡面上铺体块找层次。
// 新形制 + 顶点色林带/岩带/雪线 + 540 株乔木已取代它；30–60m 扁平板在 4km 外读作"撒了一坡灰卡片"，
// 正是用户投诉的高反光物体，故 buildTerrain 不再调用。代码保留仅供对照/回滚（BAND_MTNS 同）。
const BAND_MTNS = new Set(['嵩山', '泰山', '华山']);

function buildMountainBands(b: Baker, m: Mountain): void {
  let seed = (Math.imul(Math.round(m.x * 0.31 + m.z * 0.17) ^ 0x51f1b3, 2246822519) >>> 0) || 7;
  const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345) >>> 0) / 4294967296);
  // 峰值取渲染面（网格双线性会漏掉解析尖峰），先粗后细，避免色带挂在偏心的伪峰上
  let px = m.x, pz = m.z, peak = -1e9, peakA = -1e9;
  for (let pass = 0; pass < 2; pass++) {
    const rad = pass === 0 ? 420 : 140, st = pass === 0 ? 140 : 35;
    const cx = px, ccz = pz;
    for (let dz = -rad; dz <= rad; dz += st) {
      for (let dx = -rad; dx <= rad; dx += st) {
        const y = terrainSurfaceY(cx + dx, ccz + dz);
        if (y > peak) { peak = y; px = cx + dx; pz = ccz + dz; }
        peakA = Math.max(peakA, terrainHeight(cx + dx, ccz + dz));
      }
    }
  }
  if (peak < 260) return;
  const hRef = Math.min(peak, peakA); // 等高线以解析峰为上限，保证每条带都找得到交点
  const step = m.r * 0.055;
  // 高度分带：沿方位角找等高交点，陡缓都落在同一海拔上，不是固定半径套圈
  const crossR = (a: number, target: number): number => {
    const ca = Math.cos(a), sa = Math.sin(a);
    let prev = 0, prevH = hRef;
    for (let r = step; r <= m.r * 1.22; r += step) {
      const y = terrainHeight(px + ca * r, pz + sa * r);
      if (prevH >= target && y < target) {
        let lo = prev, hi = r;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) * 0.5;
          if (terrainHeight(px + ca * mid, pz + sa * mid) >= target) lo = mid; else hi = mid;
        }
        return (lo + hi) * 0.5;
      }
      prev = r; prevH = y;
    }
    return -1;
  };
  // 块面贴着坡面（局部 Y 对准法线，Euler 反解精确），底面按四角逐一压到地表下，任何一角都不悬空
  const put = (a: number, r: number, w: number, d: number, lift: number, hex: number, grp: 'ash' | 'earth'): number => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = px + ca * r, z = pz + sa * r;
    if (Math.hypot(x - m.x, z - m.z) < 70) return -1; // 山巅庙观台基范围
    const e = Math.max(12, Math.min(w, d) * 0.5);
    const gx = (terrainSurfaceY(x + e, z) - terrainSurfaceY(x - e, z)) / (2 * e);
    const gz = (terrainSurfaceY(x, z + e) - terrainSurfaceY(x, z - e)) / (2 * e);
    const nl = Math.hypot(gx, 1, gz);
    const nx = -gx / nl, ny = 1 / nl, nz = -gz / nl;
    const rx = Math.atan2(nz, ny), rz = -Math.asin(Math.max(-1, Math.min(1, nx)));
    const ry = -(a + Math.PI / 2) + (rnd() - 0.5) * 0.1;
    const crx = Math.cos(rx), srx = Math.sin(rx), cry = Math.cos(ry), sry = Math.sin(ry), crz = Math.cos(rz), srz = Math.sin(rz);
    const xr0 = cry * crz, xr1 = -cry * srz, xr2 = sry;
    const yr0 = crx * srz + srx * sry * crz, yr1 = crx * crz - srx * sry * srz, yr2 = -srx * cry;
    const zr0 = srx * srz - crx * sry * crz, zr1 = srx * crz + crx * sry * srz, zr2 = crx * cry;
    const h = lift + 3;
    let cy = 1e9, top = -1e9;
    for (const [sx, sz] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]] as const) {
      const vx = sx * w, vz = sz * d;
      const by = yr0 * vx + yr1 * (-h * 0.5) + yr2 * vz;
      const bx = x + xr0 * vx + xr1 * (-h * 0.5) + xr2 * vz;
      const bz = z + zr0 * vx + zr1 * (-h * 0.5) + zr2 * vz;
      cy = Math.min(cy, terrainSurfaceY(bx, bz) - 1.2 - by);
      top = Math.max(top, yr0 * vx + yr1 * (h * 0.5) + yr2 * vz);
    }
    b.box(grp, w, h, d, x, cy, z, hex, ry, rx, rz);
    return cy + top;
  };
  // 块数与块宽按该高度的实际周长定（间距随半径增长），否则山脚一圈会摊出三百米宽的大板
  const ring = (fracs: number[], wK: number, dK: number, liftLo: number, liftHi: number, palette: number[], grp: 'ash' | 'earth', kit: string): void => {
    for (let i = 0; i < fracs.length; i++) {
      const target = hRef * fracs[i];
      let rSum = 0, rN = 0;
      for (let k = 0; k < 12; k++) {
        const r = crossR((k / 12) * Math.PI * 2, target);
        if (r > 0) { rSum += r; rN++; }
      }
      if (!rN) continue;
      const rEst = rSum / rN;
      const space = Math.max(12, Math.min(64, rEst * 0.1));
      const n = Math.max(18, Math.round((Math.PI * 2 * rEst) / space));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (i % 2) * (Math.PI / n) + (rnd() - 0.5) * 0.02; // 隔圈错缝，读成一条带而不是一圈点
        const r = crossR(a, target);
        if (r < 0) continue;
        const w = space * wK * (0.72 + rnd() * 0.5);
        const top = put(a, r + (rnd() - 0.5) * 16, w, w * dK * (0.8 + rnd() * 0.4), liftLo + rnd() * (liftHi - liftLo),
          shade(palette[k % palette.length], 0.9 + rnd() * 0.2), grp);
        if (top > 0) b.kit(kit, 1, top);
      }
    }
  };
  // 体块环带：**整组删除**。旧版四色 0xeef3f8/0xe1eaf2/0xf7fafd/0xd8e3ee 是用户看到的
  // 「山上成片高反光白块」；压暗到冷灰蓝后实拍仍在坡面排成一圈圈浅色板（30–60m 的扁平卡片，
  // 3.8km 外读作撒了一坡纸片）。顶点色已经有完整的林线/岩带/雪线分带（见 biomeColor），
  // 体块只剩"山脊棱线"这一项：它是沿脊走的长条岩骨，不是横着排的环带。
  // 山脊棱线：取最延展的 3 个方位往下铺岩脊，远看是山的"骨"
  const score: number[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    let sc = 0;
    for (let s = 1; s <= 9; s++) sc += Math.max(0, terrainHeight(px + Math.cos(a) * m.r * 0.1 * s, pz + Math.sin(a) * m.r * 0.1 * s));
    score.push(sc);
  }
  const picks: number[] = [];
  while (picks.length < 3) {
    let bi = -1, bv = -1;
    for (let k = 0; k < 24; k++) {
      if (score[k] <= bv) continue;
      let far = true;
      for (const p of picks) {
        const dd = Math.min(Math.abs(p - k), 24 - Math.abs(p - k));
        if (dd < 5) { far = false; break; }
      }
      if (far) { bv = score[k]; bi = k; }
    }
    if (bi < 0) break;
    picks.push(bi);
  }
  for (const k of picks) {
    const a0 = (k / 24) * Math.PI * 2;
    let side = 1;
    for (let s = 2; s <= 20; s++) {
      const r = m.r * 0.05 * s;
      if (terrainHeight(px + Math.cos(a0) * r, pz + Math.sin(a0) * r) < hRef * 0.34) break;
      // 沿脊线拉长、横向收窄：横跨脊背的宽块会在凸脊上被埋掉大半
      const w = 28 + rnd() * 18;
      const top = put(a0 + side * (0.3 * w / r), r, w, 72 + rnd() * 44, 10 + rnd() * 14, shade(0x55504a, 0.85 + rnd() * 0.25), 'ash');
      if (top > 0) b.kit('mt.ridgeSpine', 1, top);
      side = -side;
    }
  }
}

const yieldFrame = (): Promise<null> => new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r(null)); else setTimeout(() => r(null), 0); });

// ============ 城外河湖水面（WS-WATER） ============
/**
 * 旧实现：每段河一条 PlaneGeometry、每个湖一个 26 段 CircleGeometry，15 个网格共用
 * `MeshBasicMaterial({ color: 0x1a5a70, toneMapped: false })` —— 不吃太阳/半球光、不吃 FogExp2、
 * 不吃 ACES 色调映射，黄昏与深夜是同一块死青蓝；3.5km 的湖只有 26 段（外圈顶点间距 840m），
 * 边缘是肉眼可辨的多边形折线；圆盘没有岸线过渡、没有深浅、没有反光，远看就是「蓝灰盘子 / 黑洞」。
 *
 * 现在：湖、河各合并成 1 个 draw call；Standard 材质吃光、吃雾、吃色调映射；顶点 RGBA 做
 * 「深水→浅滩→湿沙岸」径向渐变并在外缘 alpha 归零（软岸线，不是硬边）；片元按世界坐标程序化
 * 扰动法线（无贴图、无 UV、零额外 draw call）；菲涅尔反射色每帧取 `scene.fog.color`，
 * 自动跟随昼夜/天穹/地府换档。
 */
export const WATER_RIVER_Y = -2.2;
export const WATER_LAKE_Y = -3.2;
/** 河道入湖时比湖面抬 0.08m，避免与湖面共面 z-fighting */
const WATER_LAKE_SEAM = 0.08;
/**
 * 引水渠段（R2「河没头没尾」）的三个水位与三个落点，全部是既有真相源的派生值：
 * 护城河 −0.35 在 `city/imperial.ts` 里拥有（本轮冻结，改不得）；水关外口 5007.3 = 城墙中线 5000 − 14.6/2。
 * `waterLink.ts` 与 `riverends.ts` 都从这里取，不另写第二份。
 */
export const LINK_WATER_Y = -0.35;
export const LINK_WALL_OUT = 5007.3;
export const LINK_MOAT_IN = 5137;
export const LINK_MOAT_OUT = 5183;

/** 水色带：t 是归一化半径（0=湖心/河心，1=水缘，>1=岸外透明区） */
const WATER_RAMP: { t: number; hex: number; a: number }[] = [
  { t: 0.00, hex: 0x0e354b, a: 0.975 },   // 深水
  { t: 0.24, hex: 0x104055, a: 0.972 },
  { t: 0.46, hex: 0x124b62, a: 0.965 },
  { t: 0.62, hex: 0x16596e, a: 0.955 },
  { t: 0.76, hex: 0x1e6c78, a: 0.942 },
  { t: 0.86, hex: 0x2b8085, a: 0.918 },
  { t: 0.92, hex: 0x3d8b84, a: 0.876 },   // 浅滩
  { t: 0.97, hex: 0x3f8f88, a: 0.900 },   // 浅滩（湖半径做了 2.2 次幂映射，这条带只落在最外 ~120m）
  { t: 0.995, hex: 0x7fae9c, a: 0.780 },  // 沙底浅水：偏青，贴岸近景才读得出是水而不是沙地
  { t: 1.03, hex: 0x9fb69a, a: 0.000 },   // 外缘 alpha 归零 → 软边
];
const WATER_RAMP_C = WATER_RAMP.map((s) => new THREE.Color(s.hex));
const _wRamp = new THREE.Color();

function waterRampIdx(t: number): number {
  let i = 0;
  while (i < WATER_RAMP.length - 2 && t > WATER_RAMP[i + 1].t) i++;
  return i;
}
function waterTint(t: number): THREE.Color {
  const i = waterRampIdx(t);
  const a = WATER_RAMP[i], b = WATER_RAMP[i + 1];
  const k = THREE.MathUtils.clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
  return _wRamp.copy(WATER_RAMP_C[i]).lerp(WATER_RAMP_C[i + 1], k);
}
function waterAlphaAt(t: number): number {
  const i = waterRampIdx(t);
  const a = WATER_RAMP[i], b = WATER_RAMP[i + 1];
  return a.a + (b.a - a.a) * THREE.MathUtils.clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
}

interface WaterBuild { p: number[]; n: number[]; c: number[]; d: number[]; idx: number[] }
const newWaterBuild = (): WaterBuild => ({ p: [], n: [], c: [], d: [], idx: [] });

function pushWaterVertex(g: WaterBuild, x: number, y: number, z: number, t: number, alphaK = 1): number {
  const col = waterTint(t);
  const i = g.p.length / 3;
  g.p.push(x, y, z);
  g.n.push(0, 1, 0);
  g.c.push(col.r, col.g, col.b, waterAlphaAt(t) * alphaK);
  g.d.push(THREE.MathUtils.clamp(t, 0, 1));
  return i;
}

interface WaterUniforms { uTime: { value: number }; uSky: { value: THREE.Color } }

/**
 * 水面材质：Standard（吃光/吃雾/吃 ACES）+ 两处注入。
 * ① 法线：世界坐标五组方向波的解析梯度，合成前逐波长过两道**乘性**滤波：
 *    a. 屏幕空间导数（`waterWaveLod`）：用 `fwidth` 求每像素覆盖的世界米数，换算成
 *       「一个波长占几个像素」，不足 28px 的整组淡出到 0，64px 以上全强度。俯视 300m 时
 *       6m 波只占 17px/波长，高光把它的 2–3 次谐波放大成点阵摩尔纹——这正是用户看到的
 *       斜向条纹带；抬到 28px 安全线后消失。ppw<2（Nyquist 硬下限）当然也在 0 区间。
 *    b. 视角仰角（`waterGrazeFade`）：`|dot(up, viewDir)|` 越小越先把高频压掉；70m 内
 *       闸门关闭（贴水时波纹必须还在动），260m 外全额生效。与 a 相乘，不是替代。
 *    长涌浪（314m/203m）两道滤波都几乎不衰减，所以水面不会变成一块死平涂。
 * ② 菲涅尔：把 diffuseColor 朝天空色 mix，上限锁死在 `clamp(fres*0.45, 0, 0.45)`——
 *    俯视只混 2%（读得出水色），掠射最多 45%（读得出天空/雾色）。天空色每帧取 scene.fog.color，
 *    水面永远和同一时刻的天穹/雾同色，夜景里不会变成黑洞。
 *    注意：这里**不能**用 `totalEmissiveRadiance +=` 写菲涅尔——ACES 在高光区会把它放大，
 *    实测同一个湖从 RGB(35,64,82) 冲到 (91,154,180)（俯视 ndv>0.9 时仍过曝）。mix 进 diffuse
 *    是以天空色为上界的有界运算，调参再也不会爆。
 */
function makeWaterMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, depthWrite: true,
    // envMapIntensity 必须压到 ~0.2：RoomEnvironment 是明亮的摄影棚环境，roughness 0.38 的水面
    // 在掠射角会整条反射成白带（实拍华山北望：西河在 6km 外是一条爆白横带 + 泛光）。
    // 菲涅尔色仍走 scene.fog.color，随昼夜换档；只是不再叠一层环境镜面。
    roughness: 0.82, metalness: 0.0, envMapIntensity: 0.05, side: THREE.DoubleSide, dithering: true,
  });
  mat.name = 'water';
  const uni: WaterUniforms = { uTime: { value: 0 }, uSky: { value: new THREE.Color(0x9fb4c4) } };
  mat.userData.water = uni;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.uniforms.uSky = uni.uSky;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aDepth;
varying vec2 vWaterXZ;
varying vec3 vWaterWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;
vWaterXZ = vWaterWorld.xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec3 uSky;
varying vec2 vWaterXZ;
varying vec3 vWaterWorld;
// ppw = 波长 / 每像素世界覆盖（像素/波长）。2px 只是「基频不混叠」的 Nyquist 线，
// 而水的镜面是法线的非线性函数，谐波会以 1/2、1/3 周期进入高光；实测 17px/波长仍
// 是点阵摩尔纹，故安全线取 28–64px。ppw<2 自然落在 0 区间内。
float waterWaveLod(float k, float pxSpan) {
  float ppw = 6.28318530718 / max(k * pxSpan, 1e-6);
  return smoothstep(28.0, 64.0, ppw);
}
// 仰角项：graze=0 正俯视 → 不压；graze=1 完全掠射 → 高频几乎全压，低频不动。
float waterGrazeFade(float k, float graze) {
  return 1.0 - 0.85 * graze * smoothstep(0.02, 0.35, k);
}
vec3 waterRipple(vec2 p, float t, float dist, float pxSpan, float graze) {
  float far = smoothstep(700.0, 2400.0, dist);
  vec2 d1 = normalize(vec2(0.86, 0.51));
  vec2 d2 = normalize(vec2(-0.63, 0.78));
  vec2 d3 = normalize(vec2(0.37, -0.93));
  vec2 d4 = normalize(vec2(-0.82, -0.57));
  vec2 d5 = normalize(vec2(0.95, -0.31));
  float k1 = 0.020, k2 = 0.031, k3 = 0.085, k4 = 0.420, k5 = 1.050;
  float a1 = waterWaveLod(k1, pxSpan) * waterGrazeFade(k1, graze);
  float a2 = waterWaveLod(k2, pxSpan) * waterGrazeFade(k2, graze);
  float a3 = waterWaveLod(k3, pxSpan) * waterGrazeFade(k3, graze) * (1.0 - 0.80 * far);
  float a4 = waterWaveLod(k4, pxSpan) * waterGrazeFade(k4, graze) * (1.0 - far);
  float a5 = waterWaveLod(k5, pxSpan) * waterGrazeFade(k5, graze) * (1.0 - far);
  vec2 g = cos(dot(p, d1) * k1 + t * 0.85) * 0.020 * a1 * d1
         + cos(dot(p, d2) * k2 - t * 0.62) * 0.016 * a2 * d2
         + cos(dot(p, d3) * k3 + t * 1.45) * 0.030 * a3 * d3
         + cos(dot(p, d4) * k4 + t * 2.35) * 0.055 * a4 * d4
         + cos(dot(p, d5) * k5 - t * 3.30) * 0.035 * a5 * d5;
  return normalize(vec3(-g.x, 1.0, -g.y));
}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  // 每像素覆盖的世界米数。fwidth = |dFdx| + |dFdy|（L1 和）比单轴步长大 √2，
  // 直接用来算「波长占几像素」会把足迹高估一倍，俯视机位会过度淡出（57px 的波当成 40px）；
  // 乘 1/√2 折算回单轴步长，等价于取两轴中较大的一步。
  float pxSpan = length(fwidth(vWaterXZ)) * 0.70710678;
  float dist = length(vViewPosition);
  // 视角仰角：1=正俯视，0=完全掠射；近景闸门 70–260m，贴水时不做仰角压制。
  float cosV = clamp(abs(normalize(cameraPosition - vWaterWorld).y), 0.0, 1.0);
  float graze = (1.0 - smoothstep(0.10, 0.55, cosV)) * smoothstep(70.0, 260.0, dist);
  vec3 wn = waterRipple(vWaterXZ, uTime, dist, pxSpan, graze);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  float ndv = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
  float fres = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSky * 0.92, clamp(fres * 0.45, 0.0, 0.45));
}`);
  };
  mat.onBeforeRender = (_r, scene) => {
    uni.uTime.value = performance.now() * 0.001;
    if (scene.fog) uni.uSky.value.copy(scene.fog.color);
  };
  return mat;
}

/** 湖：径向多环扇面（中心→外缘 alpha 归零），分段随半径自适应，岸边用低频噪声抖动成自然岸线 */
function addLakeWater(g: WaterBuild, l: Lake, seed: number, stats: { name: string; segs: number; spacing: number }[]): void {
  // 外圈顶点间距判据 < 250m：最长半轴 3000m 时 segs=115，间距 ~146m（旧版固定 26 段 = 840m）
  const segs = Math.max(48, Math.min(192, Math.round(Math.max(l.rx, l.rz) / 26)));
  const ph1 = seed * 1.7, ph2 = seed * 3.1 + 1.3, ph3 = seed * 5.3 + 2.7;
  const wob = (th: number): number =>
    1 + 0.030 * Math.sin(th * 3 + ph1) + 0.017 * Math.sin(th * 7 + ph2) + 0.009 * Math.sin(th * 13 + ph3);
  const KS = [0.16, 0.30, 0.44, 0.57, 0.68, 0.78, 0.86, 0.92, 0.96, 1.0, 1.03];
  const center = pushWaterVertex(g, l.x, WATER_LAKE_Y, l.z, 0);
  const rings: number[][] = [];
  for (const k of KS) {
    const ring: number[] = [];
    for (let a = 0; a < segs; a++) {
      const th = (a / segs) * Math.PI * 2;
      const w = wob(th);
      const x = l.x + Math.cos(th) * l.rx * k * w;
      const z = l.z + Math.sin(th) * l.rz * k * w;
      // 半径幂映射：浅滩/沙岸带按绝对尺度收窄（否则 3km 湖的「浅滩」会有 300m 宽，贴岸看就是一片沙滩）
      ring.push(pushWaterVertex(g, x, WATER_LAKE_Y, z, Math.pow(k * w, 2.2)));
    }
    rings.push(ring);
  }
  for (let a = 0; a < segs; a++) {
    const b = (a + 1) % segs;
    g.idx.push(center, rings[0][b], rings[0][a]);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const inn = rings[r], out = rings[r + 1];
    for (let a = 0; a < segs; a++) {
      const b = (a + 1) % segs;
      g.idx.push(inn[a], inn[b], out[a]);
      g.idx.push(inn[b], out[b], out[a]);
    }
  }
  // 实测外圈（k=1.0 环）相邻顶点间距
  const outer = rings[9];
  let maxSp = 0;
  for (let a = 0; a < segs; a++) {
    const b = (a + 1) % segs;
    const dx = g.p[outer[b] * 3] - g.p[outer[a] * 3];
    const dz = g.p[outer[b] * 3 + 2] - g.p[outer[a] * 3 + 2];
    maxSp = Math.max(maxSp, Math.hypot(dx, dz));
  }
  stats.push({ name: l.name, segs, spacing: Math.round(maxSp) });
}

/**
 * 河：沿折线一条连续缎带。转角用斜接（miter）补偿 1/cos(半角)，不再逐段拼 Plane 导致
 * 弯道内侧缺三角。
 *
 * R2（「河没头没尾」）：**两端不再 alpha 淡出**。旧版在端点外再插一个站
 * （宽度收到 30%、alpha 收到 0.05、外延 240m），于是 5 条河全在田野里凭空断头——
 * 垂直射线仍能打到几何（机检全绿），眼睛看到的却是空气。这是本轮修的病根。
 * 现在水面到端点仍是满 alpha，端点一律落在实体上：
 *   · 西/东河头＝跌水脚（`waterLink.ts` 船闸）；
 *   · 南/北河头＝护城河外岸跌水；
 *   · 河尾＝山脚石砌泉洞（`waterLink.ts`）；
 *   · 入湖的末端（东河、泰山河）沉到湖面下 0.06m，切边被湖面盖住——也不是淡出。
 */
const RIB_COLS = [-1, -0.92, -0.82, -0.68, -0.50, -0.28, 0, 0.28, 0.50, 0.68, 0.82, 0.92, 1];

function emitRibbon(g: WaterBuild, st: { x: number; z: number; y: number; hw: number; ak: number }[], halfW: number): void {
  const rows: number[][] = [];
  for (let i = 0; i < st.length; i++) {
    const p = st[i];
    const pp = st[Math.max(0, i - 1)], pn = st[Math.min(st.length - 1, i + 1)];
    let ax = pn.x - pp.x, az = pn.z - pp.z;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    // 斜接长度：1/cos(相邻两段夹角的一半)，限幅 1.9 防锐角尖刺
    let mx = p.x - pp.x, mz = p.z - pp.z;
    const ml = Math.hypot(mx, mz) || 1;
    const miter = 1 / Math.max(0.53, Math.abs((mx / ml) * ax + (mz / ml) * az));
    const px = -az, pz = ax;
    const row: number[] = [];
    for (const f of RIB_COLS) {
      const t = Math.pow(Math.abs(f), 1.15) * 1.03;
      row.push(pushWaterVertex(g, p.x + px * halfW * p.hw * miter * f, p.y, p.z + pz * halfW * p.hw * miter * f, t, p.ak));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < RIB_COLS.length - 1; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      g.idx.push(a, b, c, b, d, c);
    }
  }
}

function addRiverWater(g: WaterBuild, r: RiverDef): void {
  const P = r.pts, n = P.length;
  if (n < 2) return;
  const halfW = r.w * 0.5 + 10;
  const st: { x: number; z: number; y: number; hw: number; ak: number }[] = [];
  for (let i = 0; i < n; i++) st.push({ x: P[i][0], z: P[i][1], y: 0, hw: 1, ak: 1 });
  // 水位：河流 −2.2；接近湖面时降到湖面 +0.08，避免压在湖面上形成台阶
  for (const s of st) {
    let y = WATER_RIVER_Y;
    for (const l of LAKES) {
      const ld = Math.hypot((s.x - l.x) / l.rx, (s.z - l.z) / l.rz);
      if (ld < 1.06) y = Math.min(y, WATER_RIVER_Y + ((WATER_LAKE_Y + WATER_LAKE_SEAM) - WATER_RIVER_Y) * smoothstep(1.06, 0.70, ld));
    }
    s.y = y;
  }
  // 河尾真的落在湖里：最后一站压到湖面下，切边藏进湖面（不是把 alpha 收到 0）
  const last = st[n - 1];
  for (const l of LAKES) {
    const ld = Math.hypot((last.x - l.x) / l.rx, (last.z - l.z) / l.rz);
    if (ld < 0.92) last.y = Math.min(last.y, WATER_LAKE_Y - 0.06);
  }
  emitRibbon(g, st, halfW);
}

/** 渠/池条带：沿 u 轴铺，半宽与水位线性过渡；v 轴由 map 决定（x 向或 z 向） */
function linkStrip(
  g: WaterBuild,
  map: (u: number, v: number) => [number, number],
  u0: number, u1: number, hw0: number, hw1: number, y0: number, y1: number, segs: number, ak = 1, tScale = 1,
): void {
  const rows: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const u = u0 + (u1 - u0) * k;
    const hw = hw0 + (hw1 - hw0) * k;
    const y = y0 + (y1 - y0) * k;
    const row: number[] = [];
    for (const f of RIB_COLS) {
      const t = Math.pow(Math.abs(f), 1.15) * 1.03 * tScale;
      const [x, z] = map(u, f * hw);
      row.push(pushWaterVertex(g, x, y, z, t, ak));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < RIB_COLS.length - 1; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      g.idx.push(a, b, c, b, d, c);
    }
  }
}

/**
 * 引水渠水面（R2）：把城外河头与城墙水关之间那 240–420m 接成一条。
 * 逐段坐标与水位见 `RiverLink` 的注释；水舌（跌水）alpha 0.94、色阶偏浅，读得出是「流下来的水」。
 * 两段渠的宽度：水关洞口 34m（半宽 17）→ 护城河岸 42m；南/北渠恒 42m。
 */
export const LINK_HALF_CUL = 17;      // 水关外口半宽（34m；洞口内侧 25.2m 由 riverends 的翼墙收）
const HW_WIDE = 21;                   // 渠/堰/槽半宽（42m，与城内河同宽）
/** 第二级跌水的槽长（m）：1.85m 落差走 17m */
export const LINK_CHUTE2 = 17;

function addLinkWater(g: WaterBuild, r: RiverDef): void {
  const L = r.link;
  if (!L) return;
  // 轴向由折线首点定：|x|>|z| 走 x（西/东），否则走 z（南/北）
  const alongX = Math.abs(r.pts[0][0]) > Math.abs(r.pts[0][1]);
  const s0 = alongX ? Math.sign(r.pts[0][0]) || 1 : Math.sign(r.pts[0][1]) || 1;
  const cx = r.pts[0][0];
  const cz = r.pts[0][1];
  // 西/东：u 沿 ±x、v 沿 z（河道中线 z=0）；南/北：u 沿 ±z、v 沿 x（中线 x=cx，别丢了偏移）
  const map = (u: number, v: number): [number, number] => (alongX ? [s0 * u, cz + v] : [cx + v, s0 * u]);
  const hwRiver = r.w * 0.5 + 10;
  const yTop = L.gate ? RIVER_WATER_Y : LINK_WATER_Y;   // 渠水位：西/东 +1.0，南/北 −0.35
  const hw0 = L.gate ? LINK_HALF_CUL : HW_WIDE;
  const u0 = L.gate ? L.wall : L.moatOut;               // 渠首：水关外口 / 护城河外岸
  const uTop = L.gate ? L.moatIn : L.weir;              // 渠尾：护城河内岸 / 第二级堰顶

  // ① 渠：水位恒定，宽度从洞口 34m 展到 42m
  linkStrip(g, map, u0, uTop - 2, hw0, HW_WIDE, yTop, yTop, 10);
  // ② 堰前过渡：水面落到堰顶（−0.4）
  linkStrip(g, map, uTop - 2, uTop, HW_WIDE, HW_WIDE, yTop, yTop - 0.4, 2);
  // ③ 跌水 ①（仅西/东，1.35m）：堰顶 → 护城河 −0.35，槽长 10m
  if (L.gate) {
    linkStrip(g, map, L.moatIn, L.moatIn + 10, HW_WIDE, HW_WIDE, yTop - 0.4, LINK_WATER_Y, 4, 0.94, 0.86);
  }
  // ④ 跌水 ②（1.85m）：堰顶 → 跌水脚 −2.2
  linkStrip(g, map, L.weir, L.weir + LINK_CHUTE2, HW_WIDE, HW_WIDE, LINK_WATER_Y - 0.4, WATER_RIVER_Y, 6, 0.94, 0.86);
  // ⑤ 河头水池：−2.2，展宽到与河同宽，接上河头
  linkStrip(g, map, L.weir + LINK_CHUTE2, L.head, HW_WIDE, hwRiver, WATER_RIVER_Y, WATER_RIVER_Y, 6);
}

function buildWaterMesh(g: WaterBuild, mat: THREE.Material, name: string): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 4));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(g.d, 1));
  geo.setIndex(g.idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * 山河地形。**异步分片**：361,201 个顶点（600² 网格，V-02 加密）逐个算高度与 biome 色，加上 1024² 画布的 3300 次椭圆填充，
 * 一次跑完要十余秒 —— 整段主线程阻塞，玩家在加载页上看到的就是「卡住」。
 * PERF-001 R2：原「每 5000 顶点让一帧」是固定块数，单块仍可能 ~0.8s，且从不报进度，
 * 真机相位归因显示本阶段连续 14.75s 进度条完全静止（maxStallSeconds=19.85 的主因）。
 * 现在每 64 顶点做一次 8ms 预算 tick + 按 i/pos.count 上报真实进度；await 点仍在循环开头，
 * 顶点计算语句与调用顺序逐字不变（INV-01，由截图 SSIM 门与 tris 冻结门复核）。
 */
export async function buildTerrain(scene: THREE.Scene, skyBotRef?: { c: THREE.Color }, b?: Baker, sg?: SignMesher, atlas?: SignAtlas): Promise<TerrainResult> {
  const T: Record<string, number> = {};
  const mark = (k: string): void => { T[k] = Math.round(performance.now() - (T.__t0 ?? performance.now())); };
  T.__t0 = performance.now();
  const flushT = (): void => { if (typeof window !== 'undefined') (window as unknown as { __terrMs?: Record<string, number> }).__terrMs = T; };
  // R24：与模块级 TERRAIN_SIZE / TERRAIN_SEG 同源，避免山体放大后渲染域被裁切
  const SIZE = TERRAIN_SIZE, SEG = TERRAIN_SEG;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  /** 粗网格顶点渲染高度（剔除三角形后仍按原网格取样，河床带外缘要跟它接平） */
  const gridH = new Float32Array(pos.count);
  const c = new THREE.Color();
  // PERF-001 R2：探测粒度 64 顶点——按 8ms 累计同步预算让帧，而不是固定 5000 顶点。
  // 画布循环仍用原来的 yieldFrame()（它只有 3300 次轻量填充，不是停滞主因）。
  const PROBE_EVERY = 64;
  for (let i = 0; i < pos.count; i++) {
    if (i > 0 && i % PROBE_EVERY === 0) {
      await getBakeBudget().tick();
      // 顶点循环约占本任务 85% 的耗时，其余留给贴图/法线/山体/生态。
      getBakeBudget().reportFraction((i / pos.count) * 0.85);
    }
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    // 城区下沉 0.5m 防共面 z-fighting；汴河廊道（|z|<34, |x|<690）再压到 -3.6 让河床与水面露出
    const d = Math.hypot(x, z);
    const cityDip = 0.5 * (1 - smoothstep(5200, 6400, d));
    const inRiver = Math.abs(z) < 34 && Math.abs(x) < 690 ? 1 : 0;
    const vy = h - cityDip - 3.1 * inRiver * (1 - smoothstep(5200, 6400, d));
    pos.setY(i, vy);
    gridH[i] = vy;
    biomeColor(x, z, h, c, skyBotRef?.c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // PERF-001 R2：顶点循环收口，进度推到 85%，后续阶段由任务结束时的 pushProgress 统一收口。
  getBakeBudget().reportFraction(0.85);
  mark('vertexLoop');
  // 河道豁口：与水面带相交的三角面整片剔除（103.3m 网格仍表达不了 90–150m 的河，留着就盖住水面）
  const hole = carveRiverHoles(geo);
  geo.setIndex(new THREE.BufferAttribute(hole.index, 1));
  mark('riverHoles');
  geo.computeVertexNormals();
  mark('normals');
  // 程序化地表纹理（草地噪点+泥土斑块）。
  // 底色从暖米 #c8c0b0 改为中性浅灰 #c6c8c3：这张图是**乘性**贴图，暖米底会把所有顶点色
  // 往黄灰拽（山腰森林顶点色 0x4f8a3c × 米底 ≈ 橄榄褐，近景实拍确认"郁郁葱葱"起不来）。
  // 中性底只保留明度噪点，绿色由顶点色承担；城区夯土色本来就是暖赭，不受影响。
  const gc = document.createElement('canvas');
  gc.width = gc.height = 1024;
  const gctx = gc.getContext('2d')!;
  gctx.fillStyle = '#c6c8c3'; gctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 3000; i++) {
    if (i > 0 && i % 1200 === 0) await yieldFrame();
    gctx.fillStyle = `rgba(${60 + Math.random() * 120 | 0},${70 + Math.random() * 100 | 0},${30 + Math.random() * 60 | 0},${0.06 + Math.random() * 0.12})`;
    gctx.beginPath();
    gctx.ellipse(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 12, 2 + Math.random() * 8, Math.random() * 3, 0, 7);
    gctx.fill();
  }
  for (let i = 0; i < 300; i++) {
    gctx.fillStyle = `rgba(${140 + Math.random() * 60 | 0},${120 + Math.random() * 50 | 0},${80 + Math.random() * 40 | 0},${0.08 + Math.random() * 0.1})`;
    gctx.fillRect(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 15, 2 + Math.random() * 8);
  }
  mark('groundCanvas');
  const groundTex = new THREE.CanvasTexture(gc);
  flushT();
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  // 一张贴图铺 64m（旧版 120 次铺满 62km = 一格 516m，贴图里几十像素的泥斑被放大成 30–100m 的"霉斑"）
  groundTex.repeat.set(SIZE / 64, SIZE / 64);
  groundTex.anisotropy = 8;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  // 山体材质：roughness 0.95 / metalness 0（岩雪都是漫反射），envMapIntensity 压到 0.22 ——
  // RoomEnvironment 的 PMREM 在掠射角会给出整片天空反射，是"山体发亮"的第二个来源。
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.22, map: groundTex });
  // 视觉审核 2026-11-07（V-01）：七岳在 15–30km 外，低机位全局 FogExp2 密度≈0.0002，
  // 按平方衰减 15km 处雾因子已≈1，山体被整片吃成暖米灰平剪影——biomeColor 里写好的
  // 林带/岩带/雪线与「黛青」大气透视根本到不了屏幕。运行时 A/B 证据：
  //   `terrain.material.fog = false` → 七岳立刻显出完整绿色林带、裸岩与冷灰雪顶。
  // 因此只给 terrain 网格换一条**远距雾化曲线**，不动全局雾（其余物体照旧）：
  //   近城 <3km 沿用全局暖雾，和建筑/城墙保持同一空气；
  //   3–9km 平滑过渡；>9km 换成更缓的密度与冷黛青雾色，并把雾因子封顶 0.90，
  //   让远山既有大气透视又留住层次，不再像未上贴图的低模纸板。
  // onBeforeCompile 阶段 #include 尚未展开，必须替换 include 指令本身（不是展开后的代码）。
  const farHaze = {
    uFarHaze: { value: new THREE.Color(0x6a7788) },
    uFarDensity: { value: 0.000075 },
    uFarCap: { value: 0.90 },
  };
  const FAR_FOG_FRAGMENT = `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactorStd = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactorStd = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      float farK = smoothstep(3000.0, 9000.0, vFogDepth);
      float farF = mix(fogFactorStd, min(uFarCap, 1.0 - exp(-pow(uFarDensity * vFogDepth, 2.0))), farK);
      vec3 farC = mix(fogColor, uFarHaze, farK);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, farC, farF);
    #endif
  `;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFarHaze = farHaze.uFarHaze;
    shader.uniforms.uFarDensity = farHaze.uFarDensity;
    shader.uniforms.uFarCap = farHaze.uFarCap;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>',
        '#include <fog_pars_fragment>\nuniform vec3 uFarHaze; uniform float uFarDensity; uniform float uFarCap;')
      .replace('#include <fog_fragment>', FAR_FOG_FRAGMENT);
  };
  mat.customProgramCacheKey = () => 'terrain-far-haze-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mark('mesh');
  mesh.name = 'terrain';
  mesh.receiveShadow = true; // 山河大地接收建筑投影（影视级纵深）
  scene.add(mesh);
  // 河床带：把上面剔除的豁口补回来。同一份材质（顶点色 + 程序化地表贴图），外缘压在地形下 0.12m。
  const bedT0 = performance.now();
  const bedBuf: BedBuf = { p: [], c: [], u: [], idx: [] };
  const gridY = makeGridSampler(gridH);
  const bedReach: number[] = [];
  let bedVerts = 0;
  for (let i = 0; i < RIVERS.length; i++) {
    bedReach.push(Math.round(hole.reach[i]));
    bedVerts += appendRiverBed(bedBuf, RIVERS[i], hole.reach[i], gridY);
  }
  let bedTris = 0;
  if (bedBuf.idx.length) {
    const bedGeo = new THREE.BufferGeometry();
    bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(bedBuf.p, 3));
    bedGeo.setAttribute('color', new THREE.Float32BufferAttribute(bedBuf.c, 3));
    bedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bedBuf.u, 2));
    bedGeo.setIndex(bedBuf.idx);
    bedGeo.computeVertexNormals();
    bedGeo.computeBoundingSphere();
    const bed = new THREE.Mesh(bedGeo, mat);
    bed.name = 'terrain_bed';
    bed.receiveShadow = true;
    scene.add(bed);
    bedTris = bedBuf.idx.length / 3;
  }
  mark('riverBed');
  if (typeof window !== 'undefined') {
    (window as unknown as { __bedStats?: Record<string, unknown> }).__bedStats = {
      removedTris: hole.removed, bedVerts, bedTris, reach: bedReach,
      ms: Math.round(performance.now() - bedT0),
      terrainTris: (geo.getIndex()?.count ?? 0) / 3,
    };
  }

  // 水面（河/湖）：湖、河各合并成一个网格，材质见 makeWaterMaterial()
  const waterMat = makeWaterMaterial();  const lakeBuild = newWaterBuild(), riverBuild = newWaterBuild();
  const lakeStats: { name: string; segs: number; spacing: number }[] = [];
  LAKES.forEach((l, i) => addLakeWater(lakeBuild, l, i + 1, lakeStats));
  for (const r of RIVERS) addRiverWater(riverBuild, r);
  for (const r of RIVERS) addLinkWater(riverBuild, r);
  const group = new THREE.Group();
  group.name = 'world_water';
  const lakeMesh = buildWaterMesh(lakeBuild, waterMat, 'water_lakes');
  const riverMesh = buildWaterMesh(riverBuild, waterMat, 'water_rivers');
  lakeMesh.userData.lakeStats = lakeStats;
  lakeMesh.userData.attr = {
    material: 'MeshStandardMaterial(vertexColors+alpha, transparent, roughness 0.38, metalness 0)',
    vertexAlphaOuterRing: 0, lakeY: WATER_LAKE_Y, riverY: WATER_RIVER_Y,
  };
  group.add(lakeMesh, riverMesh);
  scene.add(group);
  const waterMeshes = 2;
  mark('water');
  // 七山庙观：山巅建庙（需 baker/sg/atlas，世界装配时传入）。
  // 位置取实际峰位（双峰/长脊/五瓣形制的几何中心可能是鞍部或峡谷），庙随峰走。
  if (b && sg && atlas) {
    for (const m of MOUNTAINS) {
      const s = mountainSummit(m);
      buildMountainTemple(b, sg, atlas, { ...m, x: s.x, z: s.z }, s.y);
    }
  }
  mark('mtnTemple');
  // 远山三层色带已停用：它是旧版"七座同形锥"的补丁（在光滑坡面上铺体块找层次）。
  // 新形制 + 顶点色林带/岩带/雪线 + 540 株乔木已经给足层次；实拍确认这些 30–60m 的
  // 扁平板在 4km 外读作"撒了一坡灰卡片"，正是用户投诉的高反光物体。
  mark('mtnBands');
  // 七岳远景地标群（V-02）：每山 8 组大尺度景点，先于山林生机登记（同为 Baker 合批）
  if (b) {
    for (const m of MOUNTAINS) buildMountainLandmarks(b, m);
    mark('mtnLandmarks');
  }
  // 七岳山林生机：分带乔木 / 五色花丛 / 溪流瀑布 / 神兽锚点（Baker 合批，零新增 draw call）
  if (b) {
    await buildMountainLife(b, mountainSites(), terrainHeight, terrainSurfaceY);
    mark('mtnLife');
  }
  // 城外郊野（田垄/村落/土路/山体细节）：与地形同批烘焙，且必须先于 scatterVegetation 登记田块
  if (b) {
    countryFields = buildCountryside(b, new RNG(0x2f6b1d), terrainSurfaceY, waterAt).fields;
    mark('countryside');
    // 驿路两件（WS-33）：驿楼／望楼落在东郊驿道 (5600,−420)→(5790,−980) 段东侧路肩外 52m，路向 1.243
    buildPostStation(b, 5744, -683, 1.243, terrainHeight);
    mark('postStation');
  }
  // 探针句柄：形制四量测按需计算（避免把 7×9216 次采样压进加载）
  if (typeof window !== 'undefined') {
    const w2 = window as unknown as Record<string, unknown>;
    w2.__mtnHeight = terrainHeight;
    w2.__mtnSurface = terrainSurfaceY;
    w2.__mtnStats = () => mountainShapeStats();
    w2.__mtnSummit = (name: string) => {
      const m = MOUNTAINS.find((mm) => mm.name === name);
      return m ? mountainSummit(m) : null;
    };
  }
  flushT();
  return { heightAt: terrainHeight, waterMeshes };
}

let countryFields: { x: number; z: number; r: number }[] = [];

function inCountryField(x: number, z: number): boolean {
  for (const f of countryFields) {
    const dx = x - f.x, dz = z - f.z;
    if (dx * dx + dz * dz < f.r * f.r) return true;
  }
  return false;
}

/** 森林/草原植被散布（实例化） */
export function scatterVegetation(ps: import('../actors/pools').PoolSet, rng: RNG, count = 1500): void {
  const trunk = ps.get('treeTrunk'), canopy = ps.get('treeCanopy');
  const base = { t: trunk.alloc(count), c: canopy.alloc(count) };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 8) {
    const x = rng.range(-26000, 28000), z = rng.range(-24000, 26000);
    const d = Math.hypot(x, z);
    if (d < 6200) continue; // 城内不种
    if (inCountryField(x, z)) continue; // 田里不长树
    const h = terrainHeight(x, z);
    if (h < 6 || h > 700) continue;
    const dd = Math.hypot((x - DESERT.cx) / DESERT.rx, (z - DESERT.cz) / DESERT.rz);
    if (dd < 1.05) continue;
    e.set(0, rng.range(0, 6.28), 0);
    q.setFromEuler(e);
    const s2 = rng.range(2.2, 4.6);
    m.compose(v.set(x, h, z), q, s.set(s2, s2, s2));
    trunk.set(base.t + placed, m, col(0x3a2a1a));
    m.compose(v.set(x, h + 0.55 * s2 / 3.4, z), q, s.set(s2, s2, s2));
    canopy.set(base.c + placed, m, col(rng.chance(0.72) ? 0x2e5a34 : 0x3e6a2e));
    placed++;
  }
  for (let i = placed; i < count; i++) { m.makeScale(0, 0, 0); trunk.set(base.t + i, m); canopy.set(base.c + i, m); }
}
const _tcol = new THREE.Color();
function col(hex: number, k = 1): THREE.Color { _tcol.setHex(hex).multiplyScalar(k); return _tcol; }
