import { Baker, SignAtlas, SignMesher, shade } from './bake';
import { RNG } from '../core/rng';
import { C, roofOn } from './buildings';
import { dougongBand } from './architecture';
import { PALACE } from './imperial';
import { RIVER_END, RIVER_WATER_Y, riverCenterZ, riverHalfWidth } from './river';
import { buildWaterLinks } from './waterLink';

/**
 * R15-C · 河的两端收口（水关）。
 *
 * 判词（用户原话）：「为什么河还是没头没尾！！」
 * 事实：`river.ts` 的水面已从 −5000 铺到 +5000，但两端在城墙内皮处**平切**——
 * 水面撞上城墙底段的竖直面，既没有洞脸、也没有收窄，视觉上就是一条水带被刀切掉。
 * 旧 `props.ts` 的 `riverCulvert` 只在洞前做了一道 42m 平拱 + 铁栅，洞口与河同宽、
 * 没有闸门、没有驳岸收拢，读不出「水从这里出去」。
 *
 * 本文件在两端各建一座**完整水关**，从河面一侧看是四层收口：
 *  ① 20m 石砌翼墙（驳岸延伸）把 42m 河面**收拢**到 25.2m 洞口——这是"有头"的第一眼；
 *  ② 42m 宽 × 8.45m 高墩台，正面 14 块楔形券石起一道 25.2m × 4.5m 的石拱涵洞；
 *  ③ 洞身 11.5m 处两扇叠梁闸板（5 道梁 + 铁箍 + 铁链），链子穿过拱顶石槽接到墩台顶的绞关；
 *  ④ 墩台顶上 3 开间单檐水门楼，墙身顶 15.5m 与城墙同高，临城一面挂「汴河水關」匾。
 *
 * 尺寸全部由既有几何派生（不写第二份真相）：河宽取 `riverHalfWidth(±5000)`、
 * 水位取 `RIVER_WATER_Y`、城墙内皮取 `imperial.ts` 城墙底段（14.6 宽 / 中线 ±5000）。
 *
 * **不消耗共享 RNG**：所有落位由常量与 side 决定，调用本函数不推进世界随机序列，
 * 下游树木/摊位取数逐值不变（与 riverbank.ts 同一条纪律）。`rng` 参数保留是为了
 * 与 `world.ts` 其他 builder 同签名，本文件一个数都不取。
 */

// ============ 尺寸常量 ============
/** 城墙内皮：imperial.ts 城墙底段宽 14.6、中线 ±5000 → 5000 − 7.3 */
const WALL_INNER = 4992.7;
/** 城墙墙身顶（imperial.ts 三段夯土 15.5，压顶石 15.66/女墙 16.32 在它之上） */
const WALL_BODY_TOP = 15.5;
/** 拱脚落水面、拱顶 = 水面 + 4.5 */
const SPRING_Y = RIVER_WATER_Y;
const OPEN_H = 4.5;
const CROWN_Y = SPRING_Y + OPEN_H;
/** 涵洞内宽 = 末端河宽 × 0.6 → 42×0.6 = 25.2（半宽 12.6） */
const OPEN_HALF = riverHalfWidth(RIVER_END) * 0.6;
/** 墩台外缘：盖住旧驳岸（中线 河半宽+0.6、厚 1.4 → 外缘 22.3） */
const BANK_HALF = riverHalfWidth(RIVER_END) + 1.2;
/** 洞脸（临河面）到墙内皮 16m；再咬进城墙 1m，避免与城墙扑面共面闪烁 */
const FACE_X = WALL_INNER - 16;
const BACK_X = WALL_INNER + 1.0;
const BARREL = BACK_X - FACE_X;
/** 墩台顶面 8.45 + 0.3 压顶 = 走人面 8.75（旧涵洞压顶顶 8.6，被本层盖住） */
const MASS_TOP = 8.45;
const DECK_Y = MASS_TOP + 0.3;
/** 闸门平面：洞口内 11.5m（闸前留出看进洞的纵深，闸后是城墙扑面） */
const GATE_X = WALL_INNER - 4.5;
/** 驳岸延伸 20m，顶高 = 水面 + 1.4 */
const WING_LEN = 20;
const BANK_TOP = RIVER_WATER_Y + 1.4;
/** 拱券楔石 12–16 段，此处 14 段（拱顶正好落在石缝上，另加龙门石） */
const VOUSSOIRS = 14;

// ============ 配色 ============
const STONE = 0x8a8272;
const STONE_D = 0x6f6859;
const STONE_L = 0xa39a86;
const STONE_XL = 0xb5ac96;
const IRON = 0x3a4048;
const TIMBER = 0x6b4a2b;
const TIMBER_D = 0x4a3220;

/** 涵洞内轮廓：半椭圆（半宽 OPEN_HALF、矢高 OPEN_H） */
const archY = (z: number): number => SPRING_Y + OPEN_H * Math.sqrt(Math.max(0, 1 - (z / OPEN_HALF) ** 2));

export function buildRiverEnds(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  void rng; // 故意不取数：水关落位是常量，不推进共享序列
  for (const s of [1, -1] as const) waterGate(b, sg, atlas, s);
  buildMoatSpouts(b);
  // R2：城外河与水关之间的引水渠（高渠 / 两级跌水闸 / 山脚泉洞）。
  // 放在这里而不是 world.ts，是因为 world.ts 本轮冻结；本函数已经拿到 baker/sg/atlas。
  buildWaterLinks(b, sg, atlas, rng);
}

// ============ 一、水关主体 ============
function waterGate(b: Baker, sg: SignMesher, atlas: SignAtlas, s: 1 | -1): void {
  const cz = riverCenterZ(s * RIVER_END);          // 末端河心（|x|>2600 恒为 0，仍按函数取）
  const xc = s * ((FACE_X + BACK_X) / 2);

  // ---- ① 两帮墩体：三段砌筑（河床基座 / 墩身 / 上部墙），每段收 0.09 出檐 ----
  for (const zs of [-1, 1] as const) {
    const zi = cz + zs * OPEN_HALF;
    const zo = cz + zs * BANK_HALF;
    const zc = (zi + zo) / 2;
    const d = Math.abs(zo - zi);
    b.box('ash', BARREL, SPRING_Y + 1.8 + 2.8, d, xc, (SPRING_Y + 1.8 - 2.8) / 2, zc, shade(STONE_D, 1.0));
    b.box('ash', BARREL, CROWN_Y - SPRING_Y, d - 0.2, xc, (SPRING_Y + CROWN_Y) / 2, zc, shade(STONE, 1.03));
    b.box('ash', BARREL, MASS_TOP - CROWN_Y, d - 0.4, xc, (CROWN_Y + MASS_TOP) / 2, zc, shade(STONE, 0.94));
  }

  // ---- ② 拱上填充：按 z 切片，自拱线砌到墩台顶（56 片，缝宽 0.06 咬合） ----
  // 取切片两端的**较高**拱线（max）而不是中点值：中点值会让石砌在切片边缘探进洞口
  // 最多 0.3m（探针实测 18 个顶点越界），从洞里看是一道凸出的石台。max 保证砌体永远
  // 不侵入洞内轮廓，代价是拱背留有 ≤0.25m 的施工台阶——它在券脸后面、洞里是暗的。
  const N = 56;
  for (let i = 0; i < N; i++) {
    const z0 = -OPEN_HALF + (2 * OPEN_HALF * i) / N;
    const z1 = z0 + (2 * OPEN_HALF) / N;
    const zm = (z0 + z1) / 2;
    const y0 = Math.max(archY(z0), archY(z1));
    if (MASS_TOP - y0 > 0.06) {
      b.box('ash', BARREL, MASS_TOP - y0, (z1 - z0) + 0.06, xc, (y0 + MASS_TOP) / 2, cz + zm,
        shade(STONE, 0.97 + (i % 3) * 0.02));
    }
  }

  // ---- ③ 洞脸拱券：14 块楔形石，比墙面外挑 0.22（券脸压住墙面，阴影线可读） ----
  for (let k = 0; k < VOUSSOIRS; k++) {
    const t0 = (Math.PI * k) / VOUSSOIRS;
    const t1 = (Math.PI * (k + 1)) / VOUSSOIRS;
    const z0 = OPEN_HALF * Math.cos(t0), y0 = SPRING_Y + OPEN_H * Math.sin(t0);
    const z1 = OPEN_HALF * Math.cos(t1), y1 = SPRING_Y + OPEN_H * Math.sin(t1);
    const mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
    // 椭圆 (a cos t, b sin t) 的外法线 ∝ (z/a², y/b²)；绕 x 转 θ 后局部 +y 指向法线
    const nz = mz / (OPEN_HALF * OPEN_HALF);
    const ny = (my - SPRING_Y) / (OPEN_H * OPEN_H);
    const nl = Math.hypot(nz, ny) || 1;
    const ang = Math.atan2(nz / nl, ny / nl);
    b.box('ash', 0.95, 0.86, Math.hypot(z1 - z0, y1 - y0) * 1.1,
      s * (FACE_X + 0.255), my + (ny / nl) * 0.43, cz + mz + (nz / nl) * 0.43,
      shade(STONE_L, 1.0 + (k % 2) * 0.05), 0, ang, 0);
  }
  // 龙门石（拱顶合龙那块，露头更大更亮）
  b.box('ash', 1.15, 0.86, 1.55, s * (FACE_X + 0.18), CROWN_Y + 0.16, cz, shade(STONE_XL, 1.18));

  // ---- ④ 压顶石 + 走人面 ----
  b.box('ash', BARREL + 0.9, 0.3, BANK_HALF * 2 + 1.6, s * (FACE_X + BARREL / 2 - 0.2), MASS_TOP + 0.15, cz,
    shade(STONE_L, 1.12));

  // ---- ⑤ 墩台顶护栏：临河一道（让开中间 3 开间与绞关）+ 两端横墙 ----
  for (const zs of [-1, 1] as const) {
    b.box('ash', 0.4, 1.0, BANK_HALF - 10.4, s * (FACE_X + 0.2), DECK_Y + 0.5, cz + zs * (10.4 + (BANK_HALF - 10.4) / 2),
      shade(STONE_L, 1.04));
    b.box('ash', BARREL + 0.9, 1.0, 0.4, xc, DECK_Y + 0.5, cz + zs * (BANK_HALF - 0.3), shade(STONE_L, 1.04));
    for (const e of [-1, 1] as const) {
      b.box('ash', 0.62, 1.34, 0.62, s * (FACE_X + 0.2), DECK_Y + 0.67, cz + zs * (e > 0 ? BANK_HALF - 0.3 : 10.4), STONE_XL);
      b.box('glow', 0.2, 0.26, 0.2, s * (FACE_X + 0.2), DECK_Y + 1.42, cz + zs * (e > 0 ? BANK_HALF - 0.3 : 10.4), C.neonGold);
    }
  }

  // ---- ⑥ 翼墙：20m 石砌驳岸，把 42m 河面收拢到洞口；顶 2.4 起、向城内三段渐降到 1.75 接旧驳岸 ----
  for (const zs of [-1, 1] as const) {
    const segs = 4;
    const tops = [BANK_TOP, BANK_TOP, BANK_TOP - 0.28, BANK_TOP - 0.65];
    for (let k = 0; k < segs; k++) {
      const ta = k / segs, tb = (k + 1) / segs;
      const ax = FACE_X + (FACE_X - WING_LEN - FACE_X) * ta;
      const bx = FACE_X + (FACE_X - WING_LEN - FACE_X) * tb;
      const az = OPEN_HALF + (BANK_HALF - 0.8 - OPEN_HALF) * ta;
      const bz = OPEN_HALF + (BANK_HALF - 0.8 - OPEN_HALF) * tb;
      const wax = s * ax, wbx = s * bx;
      const mx = (wax + wbx) / 2, mz = cz + zs * (az + bz) / 2;
      const len = Math.hypot(wbx - wax, bz - az);
      const ry = Math.atan2(-(bz - az), wbx - wax);
      const top = tops[k];
      b.box('ash', len + 0.28, top + 0.6, 1.3, mx, (top - 0.6) / 2, mz, shade(STONE, 0.98 + k * 0.015), ry);
      b.box('ash', len + 0.44, 0.22, 1.62, mx, top + 0.11, mz, shade(STONE_L, 1.06), ry);
      if (k < 3) b.box('glow', 0.2, 0.22, 0.2, mx, top + 0.36, mz, C.neonCyan);
      b.kit('water.wing', 1, top);
    }
  }

  // ---- ⑦ 水尺：洞口一侧的竖向石标（八段明暗，读数即水位） ----
  for (let i = 0; i < 8; i++) {
    b.box('ash', 0.5, 0.4, 0.42, s * (FACE_X - 0.06), SPRING_Y + 0.25 + i * 0.4, cz + (OPEN_HALF + 1.0),
      i % 2 ? STONE_XL : STONE_D);
  }

  sluiceGate(b, s, cz);

  // ---- ⑧ 水门楼：3 开间、单檐，墙身顶 15.5 与城墙同高 ----
  waterGateTower(b, sg, atlas, s, cz);

  // 洞口两盏门灯（夜里的"这里是河口"信标）：短挑臂自墩面伸出，灯挂在臂端
  for (const zs of [-1, 1] as const) {
    const lz = cz + zs * (OPEN_HALF + 2.2);
    b.box('metal', 1.1, 0.16, 0.16, s * (FACE_X - 0.35), CROWN_Y + 1.62, lz, IRON);
    b.box('metal', 0.26, 0.34, 0.26, s * (FACE_X - 0.86), CROWN_Y + 1.42, lz, IRON);
    b.box('glow', 0.34, 0.42, 0.34, s * (FACE_X - 0.86), CROWN_Y + 1.04, lz, C.lantern);
  }

  b.kit('water.culvert', 1, CROWN_Y);
}

// ============ 二、叠梁闸 + 铁链 + 绞关 ============
function sluiceGate(b: Baker, s: 1 | -1, cz: number): void {
  const gx = s * GATE_X;
  const LEAF_TOP = SPRING_Y + 3.3;                 // 闸板顶 4.3：半启状态，闸上留出 1.2m 看进洞
  const LW = OPEN_HALF - 0.42;                     // 单扇宽 12.18

  // 石门槽（闸板升降导轨）
  for (const zs of [-1, 1] as const) {
    b.box('metal', 0.64, 4.8, 0.5, gx, SPRING_Y + 2.4, cz + zs * (OPEN_HALF - 0.26), IRON);
    b.box('ash', 0.96, 0.34, 0.92, gx, SPRING_Y + 4.86, cz + zs * (OPEN_HALF - 0.26), STONE_D);
  }

  // 两扇叠梁闸板
  for (const zs of [-1, 1] as const) {
    const zc = cz + zs * (0.2 + LW / 2);
    for (let c = 0; c < 5; c++) {
      const y = SPRING_Y + 0.33 + c * 0.66;
      b.box('wood', 0.44, 0.62, LW, gx, y, zc, shade(TIMBER, 0.9 + (c % 2) * 0.14));
      for (const e of [-1, 1] as const) b.box('metal', 0.5, 0.15, 0.18, gx, y, zc + e * (LW / 2 - 0.4), IRON);
    }
    for (const k of [-0.34, 0, 0.34] as const) b.box('metal', 0.5, 3.32, 0.15, gx, SPRING_Y + 1.65, zc + k * LW, IRON);
    for (const y of [SPRING_Y + 1.35, SPRING_Y + 2.95] as const) {
      b.box('metal', 0.52, 0.15, LW - 0.2, gx, y, zc, shade(IRON, 1.18));
    }
    b.box('wood', 0.62, 0.22, LW, gx, SPRING_Y + 0.11, zc, TIMBER_D);
  }
  // 合缝立梃
  b.box('metal', 0.58, 3.34, 0.34, gx, SPRING_Y + 1.67, cz, shade(IRON, 1.3));

  // 铁链：闸板顶 → 拱顶石槽（每扇两根，长短随拱线）
  for (const zs of [-1, 1] as const) {
    for (const zl of [3.0, 5.5] as const) {
      const z = cz + zs * zl;
      const top = Math.min(archY(zl) - 0.12, LEAF_TOP + 1.2);
      chainRun(b, gx, LEAF_TOP, top, z);
      b.box('wall', 0.86, 0.3, 0.6, gx, archY(zl) + 0.02, z, 0x0a0e12);
    }
  }

  // 绞关：墩台顶两台，各一鼓 + 六杆 + 一段垂入走人面的链
  for (const zs of [-1, 1] as const) {
    const wx = s * (FACE_X + 2.2), wz = cz + zs * 6.0;
    b.box('ash', 2.1, 0.28, 2.1, wx, DECK_Y + 0.14, wz, shade(STONE_L, 1.04));
    b.cyl('metal', 0.6, 0.6, 1.0, 10, wx, DECK_Y + 0.78, wz, 0x4a4e54);
    b.cyl('wood', 0.72, 0.72, 0.16, 10, wx, DECK_Y + 1.32, wz, TIMBER);
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI * 2 * k) / 6;
      b.box('wood', 1.86, 0.12, 0.12, wx, DECK_Y + 1.36, wz, TIMBER_D, -a);
    }
    chainRun(b, wx, DECK_Y + 0.3, DECK_Y + 0.72, wz);
  }

  b.kit('water.sluice', 1, SPRING_Y + 2.2);
}

/** 铁链：一串互成 90° 的链环（数量随长度，不取随机） */
function chainRun(b: Baker, x: number, y0: number, y1: number, z: number): void {
  const span = Math.abs(y1 - y0);
  if (span < 0.12) return;
  const n = Math.max(3, Math.round(span / 0.26));
  const step = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const odd = i % 2 === 1;
    b.box('metal', 0.11, 0.19, odd ? 0.07 : 0.17, x, y0 + step * (i + 0.5), z, IRON, 0, 0, odd ? 0.62 : -0.62);
  }
}

// ============ 三、水门楼（3 开间 / 单檐 / 墙身顶 15.5） ============
function waterGateTower(b: Baker, sg: SignMesher, atlas: SignAtlas, s: 1 | -1, cz: number): void {
  const HALL_Z = 9.6;                       // 半宽 → 19.2m，三开间各 6.4m
  const X0 = FACE_X + 3.7;                  // 临城面 4980.4
  const X1 = WALL_INNER - 1.7;              // 后墙 4991.0（咬进城台 1m，不露缝）
  const BOT = DECK_Y + 0.4;                 // 墙身底 9.15
  const CX = (X0 + X1) / 2;

  // 台明
  b.box('ash', X1 - X0 + 2.0, 0.4, HALL_Z * 2 + 1.4, s * (CX - 0.1), DECK_Y + 0.2, cz, shade(STONE_L, 1.06));
  // 墙身
  b.box('wall', X1 - X0, WALL_BODY_TOP - BOT, HALL_Z * 2, s * CX, (BOT + WALL_BODY_TOP) / 2, cz, shade(C.plaster2, 0.92));
  // 四根檐柱（明间两根在内侧，次间两根在角）
  for (const z of [-HALL_Z + 0.5, -3.2, 3.2, HALL_Z - 0.5] as const) {
    b.box('lacquer', 0.46, WALL_BODY_TOP - BOT, 0.46, s * (X0 + 0.1), (BOT + WALL_BODY_TOP) / 2 - 0.2, cz + z,
      shade(C.woodRed, 0.94));
  }
  // 明间：板门两扇
  for (const zs of [-1, 1] as const) {
    b.box('wood', 0.18, 3.4, 2.25, s * (X0 - 0.05), BOT + 1.85, cz + zs * 1.15, shade(TIMBER, 1.02));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      b.box('metal', 0.06, 0.16, 0.16, s * (X0 - 0.16), BOT + 0.95 + r * 0.95, cz + zs * (0.45 + c * 1.4), 0xd8b028);
    }
  }
  b.box('wood', 0.22, 0.34, 4.9, s * (X0 - 0.05), BOT + 3.72, cz, shade(C.woodDark, 1.08));
  // 次间：直棂窗（内透暖光）
  for (const zs of [-1, 1] as const) {
    const zc = cz + zs * 6.4;
    b.box('wood', 0.16, 2.4, 4.0, s * (X0 - 0.04), BOT + 2.6, zc, shade(C.woodDark, 1.04));
    b.box('glow', 0.1, 1.9, 3.3, s * (X0 - 0.12), BOT + 2.55, zc, C.winGlow);
    for (let k = -4; k <= 4; k++) b.box('wood', 0.1, 2.2, 0.11, s * (X0 - 0.18), BOT + 2.6, zc + k * 0.42, C.woodDark);
  }
  // 斗拱 + 额枋
  dougongBand(b, s * (X0 - 0.12), 15.02, cz, HALL_Z * 2 - 0.5, s * Math.PI / 2, 0xd8b028);
  // 单檐歇山（脊沿 z，与城台垂直）：檐口 15.5、脊 18.4
  roofOn(b, HALL_Z * 2 + 4.8, 10.6, WALL_BODY_TOP, s * (CX - 0.3), cz, Math.PI / 2, shade(0x35594c, 1.02), undefined, 2.75);
  // 匾位：临城一面（玩家从城里看得见）
  b.box('lacquer', 0.18, 1.9, 5.7, s * (X0 - 0.02), 13.35, cz, 0x1a1614);
  b.box('metal', 0.1, 2.05, 5.85, s * (X0 - 0.02), 13.35, cz, 0xd8b028);
  sg.quad(atlas.text('r15_culvert_gate', '汴河水關', 320, 88, {
    color: '#ffe9c8', glow: '#00e5ff', bg: 'rgba(10,14,22,0.9)', border: 'rgba(0,229,255,.7)', fontPx: 56,
  }), 5.0, 1.38, s * (X0 - 0.14), 13.36, cz, -s * Math.PI / 2);
  // 檐角灯
  for (const zs of [-1, 1] as const) {
    b.box('metal', 0.2, 0.26, 0.2, s * (X0 - 0.6), 14.95, cz + zs * 11.4, IRON);
    b.box('glow', 0.28, 0.34, 0.28, s * (X0 - 0.6), 15.24, cz + zs * 11.4, C.lantern);
  }
  b.kit('water.gate.tower', 1, WALL_BODY_TOP);
}

// ============ 四、御沟端头：石雕龙头吐水口 ============
/**
 * 御沟（imperial.ts `buildPalaceMoat`）是一圈**闭合回环**，没有平切断头，
 * 因此不存在"端头"。真正会读成"断头"的，是午门桥 / 神武门桥把水面一刀截断的两处岸边——
 * 桥洞两侧各设一只石雕螭首（龙头 1.2m、吐水柱 0.3m 径）+ 一方承水池，
 * 让御沟在每座桥下都有"吐水—落池"的收口，而不是水面撞上桥台就没了。
 *
 * 落位：桥面 x∈[−23, 23]（imperial.ts 过沟石桥 46m 宽），石栏在 |p|<26 处断开，
 * 螭首放在 x=±26 的栏口上，正好是水面的两个"头"。
 */
function buildMoatSpouts(b: Baker): void {
  const RS = PALACE.z1 - 24;               // 南御沟中线 −2974
  const RN = PALACE.z0 + 24;               // 北御沟中线 −3976
  const EDGE = 4.65;                       // 岸石中线（buildPalaceMoat 的 ±4.65）
  for (const [zc, dir] of [[RS + EDGE, 1], [RN - EDGE, -1]] as const) {
    for (const x of [-26, 26] as const) dragonHead(b, x, zc, dir);
  }
}

/** 石雕螭首 + 吐水柱 + 承水池（y 以御沟地面 −0.5 起算） */
function dragonHead(b: Baker, x: number, zWall: number, dir: 1 | -1): void {
  const y = 0.78;
  const zh = zWall + dir * 0.82;                       // 头心（外挑 0.82）
  b.box('ash', 0.95, 0.92, 0.6, x, y, zWall + dir * 0.25, shade(STONE_L, 1.04));   // 颈（嵌在岸石里）
  b.box('ash', 1.12, 0.96, 0.62, x, y + 0.02, zh, shade(STONE_L, 1.12));           // 头
  b.box('ash', 0.64, 0.44, 0.46, x, y - 0.10, zh + dir * 0.5, shade(STONE_L, 1.18)); // 吻
  b.box('ash', 0.52, 0.16, 0.34, x, y - 0.33, zh + dir * 0.44, shade(STONE, 1.0));  // 下颌
  b.cyl('water', 0.15, 0.15, 0.44, 8, x, y - 0.55, zh + dir * 0.56, 0x2a6070);      // 吐水柱 Ø0.3
  for (const s of [-1, 1] as const) {
    b.box('glow', 0.14, 0.13, 0.1, x + s * 0.32, y + 0.26, zh + dir * 0.32, C.neonCyan);       // 眼
    b.box('ash', 0.12, 0.52, 0.12, x + s * 0.36, y + 0.6, zh - dir * 0.06, shade(STONE_L, 1.22), 0, 0, s * 0.36); // 角
    b.box('ash', 0.1, 0.46, 0.1, x + s * 0.26, y + 0.34, zh + dir * 0.3, shade(STONE_L, 1.14), 0, 0, s * 0.22);   // 须
  }
  // 承水池（池面 1 个）
  const pz = zWall + dir * 2.45;
  b.box('ash', 3.0, 0.7, 2.0, x, -0.25, pz, shade(STONE, 0.98));
  for (const s of [-1, 1] as const) {
    b.box('ash', 3.0, 0.22, 0.24, x, 0.21, pz + s * 0.88, shade(STONE_L, 1.06));
    b.box('ash', 0.24, 0.22, 1.76, x + s * 1.38, 0.21, pz, shade(STONE_L, 1.06));
  }
  b.box('water', 2.5, 0.06, 1.5, x, 0.2, pz, 0x1a3a46);
  b.kit('water.head', 1, y);
}
