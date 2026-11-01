import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade, roofProfile, type BGroup } from '../city/bake';

// ============ B5：天宫三殿内饰（47 卷 §一凌霄/§三兜率/§四广寒；瑶池水榭因与兜率壳坐标带冲突延 B6 迁正一并做——留痕） ============
// 天宫光色纪律：玉白 #FFF3D8 宫光；金色三档见下；不老化只光变

// ============ W3：天宫金饰色阶（F1 金顶过曝）============
// 判据：star9 画面均值 140.5 / yaochi 147.1（人间正常 85–110），金瓦近白。
// 机制：旧金 #d8b028 = sRGB(216,176,40) = 线性(0.686,0.434,0.012)；wood/roof/metal 组吃
// 主光 1.4 + 补光 0.95 + 半球 0.55 + 环境 0.35 ≈ 3.2，乘完线性(2.20,1.39,0.04)，
// ACES 之后读成 sRGB(248,240,78)——金顶不是「亮」，是「白」。所以压的不是曝光（那会连累人间），是金饰反照率。
// 三档分工（括注旧值 → 新值，单位为 sRGB 通道倍数）：
//   GOLD_ROOF 金瓦/金脊/金宝顶/台缘金环（#d8b028、#ffb300 ×0.7）
//   GOLD_TRIM 大面构件：额枋、斗拱、柱头箍、御路、金线带（#d8b028 ×0.64，受光面再收一档）
//   GOLD_LINE 细金线/檐口灯管/描边：只用于 glow 且单件 < 0.5m²（#ffd700、#f5c542 ×0.74）。
//             glow 是 MeshBasicMaterial + toneMapped:false，像素即最终值，不按受光面收；
//             但面积一上去就整片打满，所以大面一律走 metal/wood 组，只留细线做点缀。
export const GOLD_ROOF = 0x9a7c1e;
export const GOLD_TRIM = 0x8a6e1b;
export const GOLD_LINE = 0xbd9a2c;

const JADE_L = 0xfff3d8;  // 玉白宫光
const GOLD = GOLD_LINE;   // 御路金（原 #ffd700）：檐下金环带/背屏/藻井等细金饰
const GOLD2 = GOLD_TRIM;  // 凌霄金（原 #f5c542）：柱身贴金等受光构件
const AZURE = 0x88abda;   // 天青
const MOON_S = 0xdcdce8;  // 月华银

// ============ W17：天宫高精度屋顶（庑殿 / 歇山 / 攒尖） ============
// 「金纸扣盒子」的根因在几何，不在配色：Baker.roofC 的曲面单元（bake.ts buildCurvedUnit）的
// side 循环只造 ±z 两片坡面，±x 两端是敞口，旧 roofOn 用一段阶梯板 + 檐口细条兜底 ——
// 侧看能看进空腔，俯看只剩一片亮金。skyRoofOn 只补几何，roofOn / roofC 一行不动。
// 单座面数：曲面壳与旧 roofOn 同量（不计入增量），新增构件 1.3–1.7k 面。

/** 曲面单元常量，与 bake.ts 的 RIDGE_HALF / UNIT_KICK / CORNER_RISE 同值（那边未导出，这里复刻） */
const SKY_RN = 0.16;
const SKY_KICK = 0.16;
const SKY_RISE = 0.15;

export type SkyRoofKind = 'wudian' | 'xieshan' | 'zanjian';

/**
 * 天宫高精度屋顶：反宇曲面 + 双向封闭坡面 + 垂脊/戗脊贴面 + 正脊鸱吻 + 檐口封板连檐 + 脊兽。
 * 瓦垄走 roofC 的顶点色条纹（ROOF_RIB_PITCH=0.34）；瓦当/滴水由 roofC 内部 eaveTrim 自动补
 * （big=max(sx,sz)≥5 即触发），本函数不再重铺。
 * @param y 檐口基准面（墙顶）；@param h 脊高（相对 y）
 */
export function skyRoofOn(
  b: Baker, x: number, y: number, z: number, w: number, d: number, h: number,
  ry: number, kind: SkyRoofKind, tileC: number, trimC: number,
): void {
  // 形制差异只动三个数：脊高系数 / 出檐系数（攒尖最陡、歇山最缓且出檐最大）
  const kH = kind === 'wudian' ? 1 : kind === 'xieshan' ? 0.97 : 1.1;
  const kE = kind === 'wudian' ? 1 : kind === 'xieshan' ? 1.012 : 0.99;
  const sx = w * 0.9231 * kE;
  const sz = d * 0.9231 * kE;
  const H = h * kH;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const W3 = (lx: number, ly: number, lz: number): [number, number, number] =>
    [x + lx * cosr + lz * sinr, y + ly, z - lx * sinr + lz * cosr];
  // 曲面单元 (u 横向, t 脊→檐) → 局部点：公式逐字对齐 bake.ts 的 ring()，差一点脊就会浮起或埋进瓦面
  const S = (u: number, t: number): [number, number, number] => {
    const e = Math.pow(t, 1.6);
    const hh = SKY_RN + (0.5 - SKY_RN) * e;
    return [u * hh * sx, (roofProfile(t) + SKY_KICK * t * t * t + SKY_RISE * t * t * u * u) * H, hh * sz];
  };
  const P = (u: number, t: number, side: 1 | -1): [number, number, number] => {
    const s = S(u, t);
    return W3(s[0], s[1], side * s[2]);
  };
  // 沿 3D 线段摆一根脊：Euler('XYZ') 是 Rx·Ry·Rz，rx 必须为 0，方向只能由 ry/rz 表达。
  // 局部 X 的世界方向 = (cosγ·cosβ, sinγ, −cosγ·sinβ)，故 β=atan2(−dz,dx)、γ=atan2(dy,水平长)。
  const segOn = (p0: number[], p1: number[], thick: number, wide: number, hex: number, ext = 0): void => {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const hl = Math.hypot(dx, dz);
    b.box('roof', Math.hypot(hl, dy) + ext, thick, wide,
      (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5, (p0[2] + p1[2]) * 0.5,
      hex, Math.atan2(-dz, dx), 0, Math.atan2(dy, hl));
  };

  // ① 屋面：反宇曲面 + 瓦垄顶点色（rib=true；不铺瓦垄 box）
  // 瓦垄是顶点色乘子（RIB_HI 1.24）：金瓦线性 0.32 × 1.24 × 3.2 = 1.27 → 垄脊被裁成纯白，
  // 一条条白亮纹就是"过曝反光"。这里把瓦面本身压到 0.66，垄脊才落在 0.86 不裁顶。
  b.roofC('roof', x, y, z, shade(tileC, 0.66), ry, sx, H, sz, 0, 0, true);

  // ② 两端坡面：旧 roofC 只造 ±z 两坡，±x 是敞口。沿 t 分 8 段，段宽取两端较大者让相邻段互压，
  //    接缝正好压在四条垂脊下面
  const NEND = 8;
  for (const su of [-1, 1] as const) {
    for (let i = 0; i < NEND; i++) {
      const a = S(su, i / NEND), c = S(su, (i + 1) / NEND);
      segOn(W3(a[0], a[1], 0), W3(c[0], c[1], 0), 0.17, Math.max(a[2], c[2]) * 1.99, shade(tileC, 0.9), 0.1);
    }
  }

  // 收山：山花退进檐口，歇山的正脊与山花基角都落在这条线上
  const shouShan = Math.min(1.2, w * 0.055);
  const Xi = sx * 0.5 - shouShan;
  const hi = Xi / sx;
  const ei = Math.max(0, (hi - SKY_RN) / (0.5 - SKY_RN));
  const ti = Math.pow(ei, 0.625);
  const yb = (roofProfile(ti) + SKY_KICK * ti * ti * ti + SKY_RISE * ti * ti) * H;
  const zb = hi * sz;

  // ③ 垂脊：沿 u=±1 棱线 10 段贴面（直条会在坡中浮起）。歇山从山花基角起，庑殿/攒尖从脊端起
  //    大殿（w≥30）垂脊加厚成 0.52×0.66 并压金——远看四条戗脊是脊不是瓦缝
  const big = w >= 30;
  const segs = 10;
  const tStart = kind === 'xieshan' ? ti : 0.02;
  for (const su of [-1, 1] as const) {
    for (const sdz of [-1, 1] as const) {
      for (let k = 0; k < segs; k++) {
        const t0 = tStart + ((1 - tStart) * k) / segs;
        const t1 = tStart + ((1 - tStart) * (k + 1)) / segs;
        segOn(P(su, t0, sdz), P(su, t1, sdz), big ? 0.52 : 0.34, big ? 0.66 : 0.46,
          big ? shade(trimC, 0.92) : shade(tileC, 0.72), 0.18);
      }
    }
  }

  // ④ 正脊 + 鸱吻 1.2m（大殿 2.0m）/ 攒尖宝顶
  const ry0 = y + H;
  if (kind === 'zanjian') {
    // 攒尖无正脊：0.32×0.32 的平盖就是宝顶座
    b.cyl('roof', 0.62, 0.92, 0.32, 10, x, ry0 + 0.12, z, shade(tileC, 0.6), ry);
    b.cyl('roof', 0.9, 0.56, 0.44, 10, x, ry0 + 0.5, z, trimC, ry);
    b.cyl('roof', 0.26, 0.34, 0.34, 8, x, ry0 + 0.88, z, shade(trimC, 1.05), ry);
    b.cyl('glow', 0.17, 0.17, 0.2, 8, x, ry0 + 1.12, z, shade(GOLD_LINE, 0.9), ry);
  } else {
    const rh = kind === 'xieshan' ? Xi : sx * 0.17;
    // 脊座：曲面单元的脊顶是 0.32 宽的平盖（一块平台），两片缓坡把它盖成一条脊线
    for (const sg of [-1, 1] as const) {
      segOn(W3(0, H + 0.14, 0), W3(0, H - 0.04, sg * 0.16 * sz), 0.2, rh * 2, shade(tileC, 0.66), 0.1);
    }
    const rr = ry0 + 0.12;
    const rlx = Math.cos(ry), rlz = -Math.sin(ry);
    const BH = big ? 0.52 : 0.26, BD = big ? 0.74 : 0.44;
    b.box('roof', rh * 2, BH, BD, x, rr + BH * 0.24, z, shade(tileC, 0.58), ry);
    b.box('roof', rh * 2 + 0.3, big ? 0.16 : 0.1, BD + 0.06, x, rr + BH * 0.78, z, shade(trimC, 0.9), ry); // 脊面压金线
    const CK = big ? 1.7 : 1;
    for (const e2 of [-1, 1] as const) {
      const px = x + rlx * e2 * rh, pz = z + rlz * e2 * rh;
      b.box('roof', 0.5 * CK, 1.2 * CK, 0.6 * CK, px, rr + 0.58 * CK, pz, shade(tileC, 0.64), ry, 0, e2 * 0.14);      // 鸱吻身
      b.box('roof', 0.3 * CK, 0.44 * CK, 0.5 * CK, px - rlx * e2 * 0.18 * CK, rr + 1.22 * CK, pz - rlz * e2 * 0.18 * CK,
        shade(tileC, 0.58), ry, 0, e2 * 0.52);                                                                          // 卷尾
      b.box('roof', 0.14 * CK, 0.3 * CK, 0.26 * CK, px + rlx * e2 * 0.05 * CK, rr + 1.4 * CK, pz + rlz * e2 * 0.05 * CK,
        shade(trimC, 1.0), ry, 0, e2 * 0.62);                                                                           // 吻尖金
    }
  }

  // ⑤ 檐口封板 + 连檐：沿曲面檐口环（t=1：中部低 0.16H、四角翘到 0.31H）一圈分段
  const FSC = 5;
  const eaveY = (SKY_KICK + SKY_RISE) * H;
  const ring: [number, number, number][][] = [
    Array.from({ length: FSC + 1 }, (_, i) => P(1 - (2 * i) / FSC, 1, 1)),
    Array.from({ length: FSC + 1 }, (_, i) => W3(-sx * 0.5, eaveY, sz * 0.5 - (sz * i) / FSC)),
    Array.from({ length: FSC + 1 }, (_, i) => P(-1 + (2 * i) / FSC, 1, -1)),
    Array.from({ length: FSC + 1 }, (_, i) => W3(sx * 0.5, eaveY, -sz * 0.5 + (sz * i) / FSC)),
  ];
  const outN: [number, number, number][] = [
    [sinr, 0, cosr], [-cosr, 0, sinr], [-sinr, 0, -cosr], [cosr, 0, -sinr],
  ];
  for (let s2 = 0; s2 < 4; s2++) {
    const o = outN[s2], pts = ring[s2];
    for (let i = 0; i < FSC; i++) {
      const q0 = [pts[i][0] + o[0] * 0.07, pts[i][1] - 0.15, pts[i][2] + o[2] * 0.07];
      const q1 = [pts[i + 1][0] + o[0] * 0.07, pts[i + 1][1] - 0.15, pts[i + 1][2] + o[2] * 0.07];
      segOn(q0, q1, 0.3, 0.13, shade(tileC, 0.56), 0.12);                                            // 封板 0.12 厚
      segOn([q0[0], q0[1] + 0.2, q0[2]], [q1[0], q1[1] + 0.2, q1[2]], 0.09, 0.2, shade(trimC, 0.88), 0.12); // 连檐
      // 大殿檐口压脊：0.2m 鎏金脊线压在瓦口上。三层檐各一条，40m 外三层檐口因此各有「檐 + 脊」两条可数的线
      if (w >= 30) segOn([q0[0], q0[1] + 0.3, q0[2]], [q1[0], q1[1] + 0.3, q1[2]], 0.2, 0.2, shade(GOLD_LINE, 1.02), 0.12);
    }
  }

  // ⑥ 歇山：上檐补成等截面 + 山花板 + 博缝板 + 山花下沿戗脊
  if (kind === 'xieshan') {
    const zTop = 0.16 * sz; // 曲面单元脊顶平盖的半宽，山花顶边取这个宽
    // 曲面单元沿 t 收窄（那是庑殿的形），山花以内必须补齐成等截面，否则通长的正脊会悬在半空
    for (let i = 0; i < NEND; i++) {
      const t0 = i / NEND, t1 = (i + 1) / NEND;
      const h0 = SKY_RN + (0.5 - SKY_RN) * Math.pow(t0, 1.6);
      const h1 = SKY_RN + (0.5 - SKY_RN) * Math.pow(t1, 1.6);
      if (h1 * sx >= Xi) break;
      const wd = Xi - h0 * sx;
      if (wd < 0.08) continue;
      const xm = (h0 + h1) * sx * 0.25 + Xi * 0.5;
      const a = S(1, t0), c = S(1, t1);
      for (const sdz of [-1, 1] as const) {
        segOn([xm, a[1], sdz * a[2]], [xm, c[1], sdz * c[2]], 0.18, wd, shade(tileC, 0.97), 0.06);
      }
    }
    for (const su of [-1, 1] as const) {
      const cp = W3(su * Xi, 0, 0);
      const wAt = (f: number): number => 2 * zb + (zTop * 2 - 2 * zb) * f;
      for (let k = 0; k < 4; k++) {
        const f0 = k / 4, f1 = (k + 1) / 4;
        const ya = yb + (H - yb) * f0, yc = yb + (H - yb) * f1;
        b.box('roof', 0.2, yc - ya + 0.08, (wAt(f0) + wAt(f1)) * 0.5, cp[0], y + (ya + yc) * 0.5, cp[2],
          shade(tileC, 0.64), ry);
      }
      for (const sg of [-1, 1] as const) {
        segOn(W3(su * Xi, yb, sg * zb), W3(su * Xi, H, sg * zTop), 0.26, 0.16, shade(trimC, 0.92), 0.08); // 博缝板
      }
      for (let k = 0; k < 6; k++) {
        segOn(W3(su * Xi, yb, -zb + (2 * zb * k) / 6), W3(su * Xi, yb, -zb + (2 * zb * (k + 1)) / 6),
          0.26, 0.34, shade(tileC, 0.68), 0.06);                                                        // 戗脊
      }
    }
  }

  // ⑦ 脊兽：垂脊下段大殿 5 只 / 小建筑 3 只（小建筑加了是噪点）
  if (w >= 18) {
    const nBeast = big ? 5 : 3;
    const ss = big ? [0.34, 0.3, 0.27, 0.24, 0.21] : [0.26, 0.22, 0.18];
    for (const su of [-1, 1] as const) {
      for (const sdz of [-1, 1] as const) {
        for (let k = 0; k < nBeast; k++) {
          const p = P(su, (big ? 0.58 : 0.5) + k * 0.085, sdz);
          const q = ss[k];
          const yaw2 = ry + Math.atan2(su * sx, sdz * sz);
          b.box('roof', q, q * 1.5, q, p[0], p[1] + 0.17 + q * 0.5, p[2], shade(trimC, 0.86), yaw2);
          b.box('roof', q * 0.62, q * 0.55, q * 0.62, p[0], p[1] + 0.17 + q * 1.5, p[2], shade(trimC, 1.04), yaw2);
        }
      }
    }
  }

  // ⑧ 四角翘角：贴住檐角（内收 0.16）而不是外推到空中，高度取檐口
  for (const [ou, od, dir] of [[-1, -1, -1], [1, -1, 1], [-1, 1, 1], [1, 1, -1]] as const) {
    const p = W3(ou * (sx * 0.5 - 0.16), eaveY + 0.02, od * (sz * 0.5 - 0.16));
    b.box('roof', 0.52, 0.14, 0.24, p[0], p[1], p[2], shade(trimC, 0.95), ry + dir * 0.39, 0, dir * 0.5);
  }
}

// ============ W23：层叠飞檐 / 密排斗栱 / 和玺彩画带 ============
// 判词（用户原话）：「层层飞檐」「复杂红金色飞檐」「雕梁画柱」。旧主殿是单檐，斗栱是一柱一攒的
// 14 片 0.5 厚贴墙薄片——侧看只有薄薄一层，读不出「出挑」，更没有「层层」。
// 三个构件各管一层，彼此不重叠：
//   skyStackedRoof 出叠檐（每层仍调 skyRoofOn，端坡/垂脊/瓦垄/瓦当/脊兽不重做）+ 层间短柱/额枋；
//   skyDougongRing 把贴片改成出挑（栌斗 0.34³ 贴额枋外皮，两跳华栱外挑面 0.44/0.66，下昂斜置）；
//   skyCaihuaBand 在额枋外皮贴 0.42m 彩画带（青绿底 0x2f5f5a + 每 2.4m 一道金线）。
// 面数账：叠檐每层 ≈2.6k 面（skyRoofOn 本体；曲面壳与旧单檐同量，不计增量）；
//   斗栱每攒 84 面（7 个 box：栌斗 1 + 华栱 2 + 下昂 1 + 令栱 1 + 散斗 2）；彩画带 4 + Σround(L/2.4) 个 box。
// 色纪律：瓦 GOLD_ROOF 走 skyRoofOn 内部 0.66 档、斗栱 GOLD_TRIM 压到 ≤0.96、彩画 0x2f5f5a、
//   短柱 0xa63a2b ×0.92——都在「反照率 × 3.2 < 0.8」以内，且全程不碰 glow（glow 只留给匾心/宝顶）。

/**
 * 矩形檐圈均分：把 n 个点按边长匀布到 ±hw/±hd 的矩形上（转角不入点，段中均分）。
 * 返回 [世界 x, 世界 z, 该边外法向的 box yaw]——yaw 使 box 的局部 +Z 指向墙外、局部 X 沿檐口。
 * 斗栱攒与叠檐短柱共用同一套分布，柱头与栌斗才对得上位。
 */
function ringSlots(x: number, z: number, hw: number, hd: number, ry: number, n: number): [number, number, number][] {
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const put = (lx: number, lz: number, yaw: number): [number, number, number] =>
    [x + lx * cosr + lz * sinr, z - lx * sinr + lz * cosr, yaw];
  const nTot = Math.max(4, Math.round(n));
  const cA = Math.max(1, Math.min(Math.floor(nTot / 2) - 1, Math.round((nTot * hw) / (2 * (hw + hd)))));
  const cB = Math.max(1, Math.floor(nTot / 2) - cA);
  const out: [number, number, number][] = [];
  for (let i = 0; i < cA; i++) {
    const t = (-0.5 + (i + 0.5) / cA) * 2 * hw;
    out.push(put(t, hd, ry));                    // +Z 檐
    out.push(put(-t, -hd, ry + Math.PI));        // −Z 檐
  }
  for (let i = 0; i < cB; i++) {
    const t = (-0.5 + (i + 0.5) / cB) * 2 * hd;
    out.push(put(hw, t, ry + Math.PI / 2));      // +X 檐
    out.push(put(-hw, -t, ry - Math.PI / 2));    // −X 檐
  }
  return out;
}

/**
 * 重檐 / 三滴叠檐：自下而上每层 面阔 ×0.74、进深 ×0.72、垂直抬 tierH，逐层调 skyRoofOn。
 * 层与层之间补一圈短柱 + 额枋，否则叠檐悬空：柱脚埋进下层屋面 0.20×举高（不浮在坡面上），
 * 柱顶止于上檐基准面，柱身落点在上一层檐口内 0.26、额枋压在上檐檐下。
 * 顶层面阔 < 12m 自动改 'zanjian'（skyRoofOn 的攒尖分支自带宝顶）；下檐不吃攒尖——攒尖的宝顶
 * 会从下层屋面捅穿上层檐，故 kind 传 'zanjian' 时下檐自动退成庑殿，只有顶层允许攒尖。
 * @param tierH 每层抬升（取下层檐高的 0.92–1.05；屋面举高：非顶层 0.72×tierH、顶层 0.97×tierH）
 * @param y 下檐檐口基准面（与 skyRoofOn 同值）；@param kind 下檐形制
 * @param topPlan 顶层覆写（W24）：w/d 直接给顶层檐口面阔/进深（不给则按 0.74/0.72 递推），
 *   riseK 为顶层举高系数（默认 0.97）。凌霄上檐用 40×25.2 —— 递推值 38.5×23 对 34×20 的上层殿身
 *   只挑 0.76m，远看仍像一顶金盖；覆写后出檐 1.44m，「重檐」才分得开。
 */
/**
 * 围脊（重檐建筑上、下层屋面与上层殿身交接处的那道脊）：沿上层殿身外皮一圈，
 * 高度取屋面在该面外皮上的实测值（用 roofProfile 反解，不靠系数估），脊身 0.36 高、0.5 宽。
 * 四角各加一尊 0.5m 脊兽——从 3/4 视角与俯视都能数出「这条脊比下层瓦面高出一截」。
 * @param hw,hd 上层殿身外皮半宽/半深；@param sx,sz,H 下层曲面的半宽/半深/举高
 */
function ridgeRing(
  b: Baker, x: number, z: number, hw: number, hd: number,
  sx: number, sz: number, H: number, ry: number, tileC: number, trimC: number,
): void {
  const yAt = (dist: number, half: number): number => {
    const hh = Math.min(0.5, Math.max(SKY_RN, dist / half));
    const t = Math.pow((hh - SKY_RN) / (0.5 - SKY_RN), 1 / 1.6);
    return (roofProfile(t) + SKY_KICK * t * t * t) * H;
  };
  const yz = yAt(hd, sz), yx = yAt(hw, sx);
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const put = (lx: number, lz: number): [number, number] => [x + lx * cosr + lz * sinr, z - lx * sinr + lz * cosr];
  for (const s of [-1, 1] as const) {
    const [ax, az] = put(0, s * hd);
    b.box('roof', 2 * hw + 0.7, 0.36, 0.5, ax, yz + 0.34, az, shade(trimC, 0.95), ry);
    b.box('roof', 2 * hw + 0.5, 0.1, 0.34, ax, yz + 0.56, az, shade(tileC, 0.6), ry);   // 脊面瓦
    const [bx, bz] = put(s * hw, 0);
    b.box('roof', 0.5, 0.36, 2 * hd + 0.7, bx, yx + 0.34, bz, shade(trimC, 0.95), ry);
    b.box('roof', 0.34, 0.1, 2 * hd + 0.5, bx, yx + 0.56, bz, shade(tileC, 0.6), ry);
  }
  const yy = (yz + yx) * 0.5 + 0.36;
  for (const su of [-1, 1] as const) for (const sd of [-1, 1] as const) {
    const [cx, cz] = put(su * hw, sd * hd);
    b.box('roof', 0.36, 0.5, 0.36, cx, yy + 0.25, cz, shade(trimC, 1.06), ry);
    b.box('roof', 0.22, 0.24, 0.22, cx, yy + 0.62, cz, shade(trimC, 0.86), ry);
  }
}

export function skyStackedRoof(
  b: Baker, x: number, y: number, z: number, w: number, d: number,
  tiers: number, tierH: number, ry: number, kind: SkyRoofKind, tileC: number, trimC: number,
  topPlan?: { w?: number; d?: number; riseK?: number },
): void {
  const n = Math.max(2, Math.min(3, Math.round(tiers)));
  const wTop = topPlan?.w ?? w * Math.pow(0.74, n - 1);
  const dTop = topPlan?.d ?? d * Math.pow(0.72, n - 1);
  // ============ 三重檐（大殿，w≥46 且 d≥30）：凌霄宝殿 52×32 走这一支 ============
  // 判词（用户原话）：「天宫的建筑结构正确吗」「三层檐、三条脊」。旧版 tiers=2 只有上下两檐，
  // 远看是「一顶金帽扣在红盒子上」。三层檐不能靠把 2 层复制三遍（上层檐会把殿身整个埋掉），
  // 必须按宋式叠檐：下檐 52×32 → 层间朱红殿身 34×20（realm.ts 已建）→ 中檐 40×25.2 →
  // 第三层殿身 26×15（本函数新建，含窗光/额枋/斗栱/彩画）→ 上檐 37×24 → 正脊 + 鸱吻 + 宝顶。
  // 竖向（以 y=下檐檐口 230.91 为 0，tierH=4.5）：
  //   下檐檐口 0 / 下檐举高 1.0t（=4.5）→ 围脊1 落在 1.23（实测：屋面在 34×20 外皮的高度）
  //   中檐檐口 1.0t（235.41，realm 的上层斗栱/额枋锚点不动）/ 举高 1.0t → 正脊 239.91（被第三层殿身包住）
  //   第三层殿身 1.10t–2.60t（235.86–242.61）/ 上檐檐口 2.60t / 举高 5.6 → 正脊 248.21
  // 三条檐口的实际高差：4.50 / 7.20（放大 ×2.2 后：9.9m / 15.8m），40m 外能数。
  const grand = n === 2 && w >= 46 && d >= 30 && kind !== 'zanjian';
  if (grand) {
    const cosr = Math.cos(ry), sinr = Math.sin(ry);
    const put = (lx: number, lz: number): [number, number] => [x + lx * cosr + lz * sinr, z - lx * sinr + lz * cosr];
    const floorPlate = shade(0xa02818, 1.0);
    // ① 下檐：52×32，举高 1.0×tierH（旧 0.72 太扁，远看是金板）
    const rise1 = tierH;
    skyRoofOn(b, x, y, z, w, d, rise1, ry, 'wudian', tileC, trimC);
    // ② 围脊 1：下檐屋面与上层殿身（34×20）交接
    const w2 = w * 34 / 52, d2 = d * 20 / 32;
    ridgeRing(b, x, z, w2 * 0.5, d2 * 0.5, w * 0.9231, d * 0.9231, rise1, ry, tileC, trimC);
    // ③ 上层殿身窗光（realm.ts 的 7+7+4+4 樘支摘窗只做了黑窗洞，这里补窗纸光；
    //    位置逐樘对齐 realm 的 wx = -15+i*5 / wz = -7.5+i*5，按 w/52、d/32 缩放）
    const yWin = y + tierH * 0.55;                       // 233.4
    for (let i = 0; i < 7; i++) {
      const wx = x + (-15 + i * 5) * (w / 52);
      for (const sz of [-1, 1] as const) {
        b.box('glow', 1.05, 1.15, 0.05, wx, yWin, z + sz * (d2 * 0.5 + 0.12), shade(0xffe3a8, 0.72));
      }
    }
    for (let i = 0; i < 4; i++) {
      const wz = z + (-7.5 + i * 5) * (d / 32);
      for (const sx of [-1, 1] as const) {
        b.box('glow', 0.05, 1.15, 1.05, x + sx * (w2 * 0.5 + 0.12), yWin, wz, shade(0xffe3a8, 0.72));
      }
    }
    // ④ 中檐：即 realm 的「上檐」位置（40×25.2），斗栱/额枋锚点 235.41 不变
    const y2 = y + tierH;
    const rise2 = tierH * 1.0;
    skyRoofOn(b, x, y2, z, wTop, dTop, rise2, ry, 'wudian', tileC, trimC);
    // ⑤ 第三层殿身 26×15：从 1.10t 起（埋进中檐 1.3m，避免墙脚悬空），到上檐檐口 2.60t
    const w3 = wTop * 0.65, d3 = dTop * 0.595;
    const y3 = y + tierH * 2.6;                           // 242.61
    const yb3 = y + tierH * 1.1;                          // 235.86
    const h3 = y3 - yb3;
    b.box('wall', w3, h3, d3, x, yb3 + h3 * 0.5, z, floorPlate);
    // 走马板（上沿金线）+ 上下枋
    b.box('wood', w3 + 0.3, 0.24, d3 + 0.3, x, y3 - 0.5, z, shade(0x2b4a52, 1.2));
    b.box('wood', w3 + 0.36, 0.12, d3 + 0.36, x, y3 - 0.36, z, trimC);
    // 第三层檐柱：四角 + 前后各 2 根中柱 + 两侧各 1 根，柱脚落到围脊内的屋面（下段被屋面挡住，不悬空）
    //   柱身 0x8a6e1b 贴金 + 三道缠龙暗环，柱头箍压在额枋下——远看第三层不是一块光板墙
    const colY0 = yb3 + 1.5, colY1 = y3 - 0.55;
    const colAt = (cx2: number, cz2: number): void => {
      b.cyl('wood', 0.36, 0.4, colY1 - colY0, 8, cx2, (colY0 + colY1) * 0.5, cz2, shade(GOLD_TRIM, 1.12));
      for (let k = 0; k < 3; k++) b.cyl('wood', 0.42, 0.42, 0.14, 8, cx2, colY0 + 0.9 + k * 1.5, cz2, shade(GOLD_TRIM, 0.72));
      b.cyl('wood', 0.5, 0.5, 0.3, 8, cx2, colY1 - 0.12, cz2, shade(GOLD_TRIM, 0.86));
    };
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) colAt(x + sx * (w3 * 0.5 + 0.12), z + sz * (d3 * 0.5 + 0.12));
    for (const sx of [-1, 1] as const) for (const t of [-1 / 3, 1 / 3] as const) colAt(x + sx * (w3 * 0.5 + 0.12), z + t * d3);
    for (const sz of [-1, 1] as const) colAt(x, z + sz * (d3 * 0.5 + 0.12));
    // 窗：正面 7 樘、背面 7 樘、两侧各 4 樘（黑框 + 暖窗光 + 金窗楣）
    const wy3 = y3 - 2.1;
    for (let i = 0; i < 7; i++) {
      const wx = x + (-10.5 + i * 3.5) * (w3 / 26);
      for (const sz of [-1, 1] as const) {
        b.box('wood', 1.5, 1.8, 0.22, wx, wy3, z + sz * (d3 * 0.5 + 0.02), 0x2a1a10);
        b.box('glow', 1.1, 1.35, 0.05, wx, wy3, z + sz * (d3 * 0.5 + 0.15), shade(0xffe3a8, 0.7));
        b.box('wood', 1.62, 0.14, 0.3, wx, wy3 + 1.02, z + sz * (d3 * 0.5 + 0.06), shade(GOLD_TRIM, 1.05));
      }
    }
    for (let i = 0; i < 4; i++) {
      const wz = z + (-4.5 + i * 3.0) * (d3 / 15);
      for (const sx of [-1, 1] as const) {
        b.box('wood', 0.22, 1.8, 1.5, x + sx * (w3 * 0.5 + 0.02), wy3, wz, 0x2a1a10);
        b.box('glow', 0.05, 1.35, 1.1, x + sx * (w3 * 0.5 + 0.15), wy3, wz, shade(0xffe3a8, 0.7));
      }
    }
    // ⑥ 第三层额枋 + 和玺彩画 + 密排斗栱（26.5×15.5，1.3m 一攒 = 64 攒）
    b.box('wood', w3 + 0.6, 0.4, d3 + 0.6, x, y3 - 0.2, z, 0x2b4a52);
    b.box('wood', w3 + 0.66, 0.14, d3 + 0.66, x, y3 - 0.02, z, shade(GOLD_TRIM, 1.0));
    skyCaihuaBand(b, x, y3 - 0.2, z, w3 + 0.6, d3 + 0.6, ry);
    skyDougongRing(b, x, y3, z, w3 + 0.5, d3 + 0.5, ry, 1.3, trimC);
    // ⑦ 围脊 2：中檐屋面与第三层殿身交接
    ridgeRing(b, x, z, w3 * 0.5, d3 * 0.5, wTop * 0.9231, dTop * 0.9231, rise2, ry, tileC, trimC);
    // ⑧ 上檐：37×24 檐口（出挑第三层殿身 4.2/3.2m），举高 5.6 → 正脊 248.21，坡度 30°
    const rise3 = 5.6;
    skyRoofOn(b, x, y3, z, w3 + 11, d3 + 9, rise3, ry, 'wudian', tileC, trimC);
    // ⑨ 鎏金宝顶 2.6m（realm 的旧宝顶 240.0–242.6 已被第三层殿身包在体内，此处是新的顶饰）
    const ry3 = y3 + rise3 + 0.3;
    b.cyl('metal', 1.02, 1.16, 0.5, 10, x, ry3 + 0.25, z, shade(GOLD_ROOF, 0.82));
    b.cyl('metal', 0.74, 0.92, 0.92, 10, x, ry3 + 0.96, z, GOLD_ROOF);
    b.cyl('metal', 0.4, 0.56, 0.32, 8, x, ry3 + 1.58, z, shade(GOLD_ROOF, 1.12));
    b.cyl('metal', 0.5, 0.4, 0.62, 10, x, ry3 + 2.05, z, GOLD_ROOF);
    b.cyl('glow', 0.1, 0.22, 0.44, 8, x, ry3 + 2.6, z, shade(GOLD_LINE, 1.0));
    // ⑩ 第三层殿身四角垂脊走兽已由 skyRoofOn（w≥18）出；此处补四角挂铃
    for (const su of [-1, 1] as const) for (const sd of [-1, 1] as const) {
      const [cx, cz] = put(su * (w3 * 0.5 - 0.2), sd * (d3 * 0.5 - 0.2));
      b.box('metal', 0.18, 0.5, 0.18, cx, y3 - 1.4, cz, shade(GOLD_TRIM, 0.8), ry);
      b.box('glow', 0.24, 0.24, 0.24, cx, y3 - 1.72, cz, shade(0xfff3d8, 0.5), ry);
    }
    // ⑪ 下层殿身（realm 的 40×22 朱红实墙）立面雕饰：走马板金线两道 + 五间槛窗（格心三槅）
    //    + 檐下宫灯 8 盏。旧版这面 40m 宽、12m 高的墙是整片朱红，40m 外只剩「一块红布」。
    const wL = w * 40 / 52, dL = d * 22 / 32;
    for (const yy of [y - 0.8, y - 8.2]) {
      b.box('wood', wL + 0.3, 0.26, 0.24, x, yy, z + dL * 0.5 + 0.24, shade(GOLD_TRIM, 0.92));
      b.box('wood', wL + 0.3, 0.26, 0.24, x, yy, z - dL * 0.5 - 0.24, shade(GOLD_TRIM, 0.92));
      b.box('wood', 0.24, 0.26, dL + 0.3, x + wL * 0.5 + 0.24, yy, z, shade(GOLD_TRIM, 0.92));
      b.box('wood', 0.24, 0.26, dL + 0.3, x - wL * 0.5 - 0.24, yy, z, shade(GOLD_TRIM, 0.92));
    }
    const wyL = y - 5.4;
    for (const sx of [-1, 1] as const) for (const t of [-15, -9, 9, 15] as const) {
      const wx = x + t;
      for (const sz of [-1, 1] as const) {
        b.box('wood', 3.5, 3.3, 0.18, wx, wyL, z + sz * (dL * 0.5 + 0.02), 0x2a1a10);
        b.box('glow', 2.9, 2.7, 0.05, wx, wyL, z + sz * (dL * 0.5 + 0.11), shade(0xffe3a8, 0.6));
        for (const m of [-0.72, 0, 0.72] as const) b.box('wood', 0.1, 2.7, 0.06, wx + m, wyL, z + sz * (dL * 0.5 + 0.14), shade(0x8a6e1b, 0.9));
        b.box('wood', 3.7, 0.16, 0.3, wx, wyL + 1.78, z + sz * (dL * 0.5 + 0.06), shade(GOLD_TRIM, 1.05));
      }
      void sx;
    }
    for (const sz of [-1, 1] as const) for (const t of [-7.5, 0, 7.5] as const) {
      const wz = z + t;
      for (const sx of [-1, 1] as const) {
        b.box('wood', 0.18, 3.3, 3.5, x + sx * (wL * 0.5 + 0.02), wyL, wz, 0x2a1a10);
        b.box('glow', 0.05, 2.7, 2.9, x + sx * (wL * 0.5 + 0.11), wyL, wz, shade(0xffe3a8, 0.6));
        for (const m of [-0.72, 0, 0.72] as const) b.box('wood', 0.06, 2.7, 0.1, x + sx * (wL * 0.5 + 0.14), wyL, wz + m, shade(0x8a6e1b, 0.9));
      }
      void sz;
    }
    for (let i = 0; i < 8; i++) {
      const lx = x - 17.5 + i * 5;
      b.box('wood', 0.1, 1.1, 0.1, lx, y - 1.4, z + dL * 0.5 + 0.9, shade(0x6b2a22, 0.9));
      b.cyl('glow', 0.42, 0.42, 0.85, 8, lx, y - 2.0, z + dL * 0.5 + 0.9, shade(0xffcf7a, 0.72));
      b.cyl('wood', 0.46, 0.46, 0.1, 8, lx, y - 1.55, z + dL * 0.5 + 0.9, shade(GOLD_TRIM, 0.8));
      b.cyl('wood', 0.46, 0.46, 0.1, 8, lx, y - 2.46, z + dL * 0.5 + 0.9, shade(GOLD_TRIM, 0.8));
    }
    return;
  }
  const kTop: SkyRoofKind = wTop < 12 ? 'zanjian' : kind;
  const kLow: SkyRoofKind = kind === 'zanjian' ? 'wudian' : kind;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const put = (lx: number, lz: number): [number, number] => [x + lx * cosr + lz * sinr, z - lx * sinr + lz * cosr];
  for (let i = 0; i < n; i++) {
    const isTop = i === n - 1;
    const wi = isTop ? wTop : w * Math.pow(0.74, i);
    const di = isTop ? dTop : d * Math.pow(0.72, i);
    const yi = y + i * tierH;
    const rise = tierH * (isTop ? (topPlan?.riseK ?? 0.97) : 0.72);
    skyRoofOn(b, x, yi, z, wi, di, rise, ry, isTop ? kTop : kLow, tileC, trimC);
    if (isTop) continue;
    // 层间：短柱一圈（8–12 根）+ 柱头箍 + 额枋圈
    const nextTop = i + 1 === n - 1;
    const wn = nextTop ? wTop : w * Math.pow(0.74, i + 1);
    const dn = nextTop ? dTop : d * Math.pow(0.72, i + 1);
    const yn = y + (i + 1) * tierH;
    const hwN = wn * 0.4615 - 0.26, hdN = dn * 0.4615 - 0.26;
    const yBot = yi + rise * 0.2;
    for (const [cx2, cz2, yaw2] of ringSlots(x, z, hwN, hdN, ry, wn < 14 ? 8 : 12)) {
      b.box('wood', 0.3, yn - yBot, 0.3, cx2, (yBot + yn) * 0.5, cz2, shade(0xa63a2b, 0.92), yaw2);
      b.box('wood', 0.44, 0.16, 0.44, cx2, yn - 0.1, cz2, shade(trimC, 0.86), yaw2);
    }
    for (const s of [-1, 1] as const) {
      const [ax, az] = put(0, s * (hdN + 0.14));
      b.box('wood', 2 * hwN + 0.56, 0.34, 0.28, ax, yn - 0.22, az, shade(trimC, 0.9), ry);
      const [bx, bz] = put(s * (hwN + 0.14), 0);
      b.box('wood', 0.28, 0.34, 2 * hdN, bx, yn - 0.22, bz, shade(trimC, 0.9), ry);
    }
  }
}

/**
 * 密排斗栱一圈：沿檐下一圈按 pitch（建议 1.2m）布攒，攒数 = 2·round((w+d)/pitch)，单圈上限 160。
 * 一攒 7 件（84 面）：栌斗 0.34³ + 两跳华栱 0.5×0.22×0.22（外挑面 0.44 / 0.66）+ 下昂 0.7×0.18×0.18
 * 斜置（昂嘴外高内低、顶到檐口）+ 令栱 0.62×0.16×0.2 + 散斗 2×0.16³。
 * 与旧 dougong() 的差别：旧版是贴在墙面上的 0.5 厚薄片，这里每一跳都朝墙外挑出，侧看有进深。
 * 栌斗外皮贴 x±w/2 / z±d/2 的额枋（柱头）外皮——w/d 传额枋外皮尺寸，不是屋面尺寸。
 * @param y 檐口基准面（与 skyRoofOn 同值：墙顶/额枋顶），整攒自 y 向下挂 0.80
 * @param hex 斗栱主色（金饰走 GOLD_TRIM；函数内部压到 ≤0.96 防「过曝反光」）
 */
export function skyDougongRing(
  b: Baker, x: number, y: number, z: number, w: number, d: number,
  ry: number, pitch: number, hex: number, k = 1,
): void {
  const n = Math.max(8, Math.min(200, 2 * Math.round((w + d) / Math.max(0.5, pitch))));
  const y0 = y - 0.8 * k;
  const K = k;
  for (const [sx, sz, yaw] of ringSlots(x, z, w * 0.5, d * 0.5, ry, n)) {
    const ox = Math.sin(yaw), oz = Math.cos(yaw);   // 出挑方向：朝墙外
    const at = (out: number): [number, number] => [sx + ox * out * K, sz + oz * out * K];
    const p = at(0.17);
    b.box('wood', 0.34 * K, 0.34 * K, 0.34 * K, p[0], y0 + 0.17 * K, p[1], shade(hex, 0.86), yaw);   // 栌斗（外皮贴额枋）
    const p1 = at(0.33);
    b.box('wood', 0.5 * K, 0.22 * K, 0.22 * K, p1[0], y0 + 0.45 * K, p1[1], shade(hex, 0.96), yaw);   // 一跳华栱，外挑面 0.44
    const p2 = at(0.55);
    b.box('wood', 0.5 * K, 0.22 * K, 0.22 * K, p2[0], y0 + 0.66 * K, p2[1], shade(hex, 0.92), yaw);   // 二跳华栱，外挑面 0.66
    const p3 = at(0.5);
    b.box('wood', 0.7 * K, 0.18 * K, 0.18 * K, p3[0], y0 + 0.6 * K, p3[1], shade(hex, 0.8), yaw - Math.PI / 2, 0, 0.5); // 下昂
    const p4 = at(0.62);
    b.box('wood', 0.62 * K, 0.16 * K, 0.2 * K, p4[0], y0 + 0.71 * K, p4[1], shade(hex, 0.94), yaw);   // 令栱
    for (const t of [-1, 1] as const) {
      b.box('wood', 0.16 * K, 0.16 * K, 0.16 * K, p4[0] + Math.cos(yaw) * t * 0.23 * K, y0 + 0.8 * K, p4[1] - Math.sin(yaw) * t * 0.23 * K,
        shade(hex, 0.88), yaw);                                                        // 散斗 ×2
    }
  }
}

/**
 * 和玺彩画带：额枋外皮贴一条 0.42m 高的带子（wood 组，青绿底 0x2f5f5a），每 2.4m 一道 0.12 宽金线。
 * 斗栱密排之后，彩画只在攒与攒之间露出 0.2–0.9m 一段——正是「雕梁画柱」里那条被栱眼切碎的青绿带。
 * @param w,d 额枋外皮尺寸（与 skyDougongRing 同一套 w/d，带子自动再外贴 0.035）
 */
export function skyCaihuaBand(b: Baker, x: number, y: number, z: number, w: number, d: number, ry: number): void {
  const PAINT = 0x2f5f5a;   // 和玺彩画青绿底（线性 0.09 × 3.2 = 0.29，远低于 0.8）
  const HB = 0.42, TB = 0.07;
  const hw = w * 0.5, hd = d * 0.5;
  const cosr = Math.cos(ry), sinr = Math.sin(ry);
  const put = (lx: number, lz: number, yaw: number): [number, number, number] =>
    [x + lx * cosr + lz * sinr, z - lx * sinr + lz * cosr, yaw];
  for (const s of [-1, 1] as const) {
    const a = put(0, s * (hd + TB * 0.5), ry);
    b.box('wood', w + TB * 2, HB, TB, a[0], y, a[1], PAINT, a[2]);                  // ±Z 底带
    const c = put(s * (hw + TB * 0.5), 0, ry + s * Math.PI / 2);
    b.box('wood', d + TB * 2, HB, TB, c[0], y, c[1], PAINT, c[2]);                  // ±X 底带
    const nW = Math.max(1, Math.round(w / 2.4)), nD = Math.max(1, Math.round(d / 2.4));
    for (let i = 0; i < nW; i++) {
      const g = put((-0.5 + (i + 0.5) / nW) * w, s * (hd + TB + 0.015), ry);
      b.box('wood', 0.12, HB - 0.06, 0.03, g[0], y, g[1], shade(GOLD_TRIM, 0.9), g[2]);
    }
    for (let i = 0; i < nD; i++) {
      const g = put(s * (hw + TB + 0.015), (-0.5 + (i + 0.5) / nD) * d, ry + s * Math.PI / 2);
      b.box('wood', 0.12, HB - 0.06, 0.03, g[0], y, g[1], shade(GOLD_TRIM, 0.9), g[2]);
    }
  }
}

// ============ W25：天宫其余殿宇的骨架 + 园亭楼阁台 ============
// 判词（用户原话）：「皇宫的建筑怎么他妈的这么粗糙」「天宫的建筑结构正确吗」。
// 旧版除凌霄殿外，御膳房 / 天库 / 武库 / 看园厅 / 瑶池宫正殿都是「实心盒 + 一顶屋面」：
// 没有檐柱、没有额枋、没有斗栱，屋面直接扣在盒子上；水榭没有坐凳栏杆；园里没有亭，也没有楼。
// 本段补的是结构层，不是贴图：柱列落地 → 额枋压柱头 → 斗栱出挑托檐 → 台基有须弥座。

/** 檐柱列 + 额枋 + 和玺彩画 + 密排斗栱（台基由 realm 的院落台明或本文件另建，不重复） */
function eaveFrame(
  b: Baker, x: number, z: number, w: number, d: number,
  yBase: number, eaveY: number, k: number, skipZ?: 1 | -1,
): void {
  const yArch = eaveY - 0.55;                    // 额枋中线（斗栱栌斗压在其外皮上）
  const hc = Math.max(1.6, yArch - yBase - 0.2);
  const nx = Math.max(2, Math.round(w / 3.4));
  const nz = Math.max(2, Math.round(d / 3.4));
  const cs: [number, number][] = [];
  for (let i = 0; i <= nx; i++) {
    const px = (-0.5 + i / nx) * w;
    if (skipZ !== 1) cs.push([px, d / 2 + 0.36]);
    if (skipZ !== -1) cs.push([px, -d / 2 - 0.36]);
  }
  for (let i = 1; i < nz; i++) {
    const pz = (-0.5 + i / nz) * d;
    cs.push([w / 2 + 0.36, pz], [-w / 2 - 0.36, pz]);
  }
  for (const [lx, lz] of cs) {
    b.cyl('ash', 0.3, 0.34, 0.22, 8, x + lx, yBase + 0.11, z + lz, shade(0xb4b0a8, 0.96));
    b.cyl('wood', 0.24, 0.25, hc, 8, x + lx, yBase + 0.22 + hc / 2, z + lz, shade(0xa63a2b, 1.04));
    b.cyl('wood', 0.3, 0.3, 0.16, 8, x + lx, yBase + 0.22 + hc - 0.08, z + lz, shade(GOLD_TRIM, 0.92));
  }
  b.box('wood', w + 0.95, 0.42, d + 0.95, x, yArch, z, 0x2b4a52);
  b.box('wood', w + 1.02, 0.1, d + 1.02, x, yArch + 0.22, z, shade(GOLD_TRIM, 1.0));
  skyCaihuaBand(b, x, yArch, z, w + 0.95, d + 0.95, 0);
  skyDougongRing(b, x, eaveY, z, w + 0.72, d + 0.72, 0, 1.5, GOLD_TRIM, k);
}

/** 坐凳栏杆一圈：凳面 0.46 + 靠背寻杖 0.94 + 短柱；gapSide 侧留 gapW 宽的口子 */
function benchRailRect(
  b: Baker, x: number, z: number, hw: number, hd: number, y0: number,
  gapSide: 's' | 'n' | 'e' | 'w' | '', gapW: number, hex: number,
): void {
  const seg = (ax: number, az: number, len: number, alongX: boolean): void => {
    if (len < 0.5) return;
    const bw = alongX ? len : 0.42, bd = alongX ? 0.42 : len;
    b.box('wood', bw, 0.12, bd, ax, y0 + 0.46, az, hex);
    b.box('wood', bw, 0.1, bd, ax, y0 + 0.94, az, shade(hex, 0.92));
    const n = Math.max(1, Math.round(len / 1.1));
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (len * i) / n;
      const px = ax + (alongX ? t : 0), pz = az + (alongX ? 0 : t);
      b.box('wood', 0.1, 0.34, 0.1, px, y0 + 0.23, pz, shade(hex, 0.8));
      if (i > 0 && i < n) b.box('wood', 0.08, 0.44, 0.08, px, y0 + 0.7, pz, shade(hex, 0.9));
    }
  };
  for (const s of [-1, 1] as const) {
    const gapZ = (s > 0 && gapSide === 's') || (s < 0 && gapSide === 'n');
    const L = 2 * hw;
    if (gapZ) {
      const sg = Math.max(0.5, (L - gapW) / 2);
      seg(x - (gapW + sg) / 2, z + s * hd, sg, true);
      seg(x + (gapW + sg) / 2, z + s * hd, sg, true);
    } else seg(x, z + s * hd, L, true);
    const gapX = (s > 0 && gapSide === 'e') || (s < 0 && gapSide === 'w');
    const D = 2 * hd;
    if (gapX) {
      const sg = Math.max(0.5, (D - gapW) / 2);
      seg(x + s * hw, z - (gapW + sg) / 2, sg, false);
      seg(x + s * hw, z + (gapW + sg) / 2, sg, false);
    } else seg(x + s * hw, z, D, false);
  }
}

/** 四角攒尖亭：须弥座台基 + 四柱 + 坐凳栏杆 + 额枋斗栱 + 攒尖顶（自带宝顶）+ 三级踏跺 */
function cornerPavilion(b: Baker, x: number, y: number, z: number, s: number): void {
  const MO = 0xb4b0a8, RED = 0xa63a2b;
  b.box('ash', 2 * s + 2.6, 0.3, 2 * s + 2.6, x, y + 0.15, z, shade(MO, 0.98));
  b.box('ash', 2 * s + 2.1, 0.3, 2 * s + 2.1, x, y + 0.45, z, shade(MO, 0.88));   // 束腰
  b.box('ash', 2 * s + 2.5, 0.3, 2 * s + 2.5, x, y + 0.75, z, shade(MO, 1.04));
  const y0 = y + 0.9;
  for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) {
    b.cyl('ash', 0.32, 0.36, 0.24, 8, x + sx * s, y0 + 0.12, z + sz * s, shade(MO, 0.94));
    b.cyl('wood', 0.27, 0.28, 3.5, 8, x + sx * s, y0 + 2.0, z + sz * s, RED);
    b.cyl('wood', 0.31, 0.31, 0.18, 8, x + sx * s, y0 + 3.66, z + sz * s, shade(GOLD_TRIM, 0.9));
  }
  const yT = y0 + 3.8;
  b.box('wood', 2 * s + 0.7, 0.36, 2 * s + 0.7, x, yT, z, 0x2b4a52);
  b.box('wood', 2 * s + 0.76, 0.1, 2 * s + 0.76, x, yT + 0.2, z, GOLD_TRIM);
  skyCaihuaBand(b, x, yT, z, 2 * s + 0.7, 2 * s + 0.7, 0);
  skyDougongRing(b, x, yT + 0.32, z, 2 * s + 0.5, 2 * s + 0.5, 0, 1.1, GOLD_TRIM, 0.55);
  benchRailRect(b, x, z, s - 0.1, s - 0.1, y0, 's', 1.5, shade(RED, 0.96));
  skyRoofOn(b, x, yT + 0.32, z, 2 * s + 2.6, 2 * s + 2.6, 2.5, 0, 'zanjian', shade(0x5c6878, 1.08), GOLD_TRIM);
  for (let k = 0; k < 3; k++) b.box('ash', 2.0, 0.3, 0.34, x, y + 0.15 + k * 0.3, z + s + 1.25 + (2 - k) * 0.34, shade(MO, 1.0 + k * 0.01));
  b.box('wood', 1.5, 0.42, 0.12, x, y0 + 3.15, z + s + 0.12, shade(GOLD_TRIM, 0.7));
  b.box('glow', 1.2, 0.3, 0.05, x, y0 + 3.15, z + s + 0.2, shade(0xfff3d8, 0.55));
}

/**
 * 两层楼阁：须弥座台基 → 一层墙身/檐柱/额枋/斗栱 → 腰檐（下檐）→ 平座（斗栱 + 栏杆）→
 * 二层墙身 → 上檐歇山 → 外楼梯（13 级）+ 楼梯口（平座栏杆开口）。
 * 尺寸固定（10×8 / 7×5.6），落点由调用者给；y = 台基底（云台铺装面）。
 */
function storeyTower(b: Baker, x: number, y: number, z: number): void {
  const MO = 0xb4b0a8, RED = 0xa63a2b, W1 = 10, D1 = 8, W2 = 7, D2 = 5.6;
  b.box('ash', W1 + 2.6, 0.34, D1 + 2.6, x, y + 0.17, z, shade(MO, 0.98));
  b.box('ash', W1 + 2.1, 0.34, D1 + 2.1, x, y + 0.51, z, shade(MO, 0.88));
  b.box('ash', W1 + 2.5, 0.32, D1 + 2.5, x, y + 0.84, z, shade(MO, 1.04));
  const y0 = y + 1.0;
  // 一层：墙身 + 板门 + 两樘直棂窗
  b.box('wall', W1, 3.6, D1, x, y0 + 1.8, z, shade(0xd8d0c0, 0.98));
  b.box('wood', 2.6, 2.9, 0.3, x, y0 + 1.45, z + D1 / 2 + 0.02, 0x2a1a10);
  b.box('glow', 2.0, 2.2, 0.06, x, y0 + 1.45, z + D1 / 2 + 0.18, shade(0xffe3a8, 0.5));
  for (const sx of [-1, 1] as const) {
    b.box('wood', 1.5, 1.4, 0.24, x + sx * 3.0, y0 + 2.2, z + D1 / 2 + 0.04, 0x2a1a10);
    b.box('glow', 1.1, 1.0, 0.05, x + sx * 3.0, y0 + 2.2, z + D1 / 2 + 0.17, shade(0xffe3a8, 0.55));
  }
  eaveFrame(b, x, z, W1, D1, y0, y0 + 4.1, 0.6);
  // 腰檐：13.5×10.5（檐口 12.5×9.7），举高 2.4 —— 二层墙身从屋面里长出来
  skyRoofOn(b, x, y0 + 4.1, z, 13.5, 10.5, 2.4, 0, 'wudian', shade(0x5c6878, 1.0), GOLD_TRIM);
  // 平座：楼板 8.8×7.4 + 平座斗栱 + 栏杆（+x 侧留楼梯口 1.5）
  const bY = y0 + 5.0;
  b.box('wood', W2 + 1.8, 0.24, D2 + 1.8, x, bY, z, shade(0x6b4a2b, 1.0));
  b.box('wood', W2 + 2.0, 0.1, D2 + 2.0, x, bY + 0.16, z, shade(RED, 0.9));
  skyDougongRing(b, x, bY - 0.06, z, W2 + 1.4, D2 + 1.4, 0, 1.2, GOLD_TRIM, 0.45);
  benchRailRect(b, x, z, W2 / 2 + 0.75, D2 / 2 + 0.75, bY + 0.12, 'e', 1.5, shade(RED, 0.94));
  // 二层：墙身 + 窗 + 额枋 + 斗栱 + 上檐（歇山）
  b.box('wall', W2, 3.3, D2, x, bY + 0.3 + 3.3 / 2, z, shade(0xd8d0c0, 1.0));
  for (let i = 0; i < 4; i++) {
    const wx = x - 2.4 + i * 1.6;
    for (const sz of [-1, 1] as const) {
      b.box('wood', 1.0, 1.2, 0.2, wx, bY + 2.3, z + sz * (D2 / 2 + 0.03), 0x2a1a10);
      b.box('glow', 0.74, 0.9, 0.05, wx, bY + 2.3, z + sz * (D2 / 2 + 0.14), shade(0xffe3a8, 0.62));
    }
  }
  eaveFrame(b, x, z, W2, D2, bY + 0.3, bY + 3.7, 0.45);
  skyRoofOn(b, x, bY + 3.7, z, W2 + 2.4, D2 + 2.2, 2.6, 0, 'xieshan', shade(0x5c6878, 1.06), GOLD_TRIM);
  // 外楼梯：台基顶（y0）→ 平座（bY），13 级 0.31 踢面 / 0.33 踏面，落在 +x 侧
  const nS = 13, rise = (bY - y0) / nS, tread = 0.33;
  for (let i = 0; i < nS; i++) {
    const top = y0 + (i + 1) * rise;
    const zz = z + (nS / 2) * tread - (i + 0.5) * tread;
    b.box('ash', 1.5, rise + 0.1, tread + 0.02, x + W1 / 2 + 1.6, top - (rise + 0.1) / 2, zz, shade(MO, 0.98 + (i % 2) * 0.04));
    if (i % 2 === 0) for (const s of [-1, 1] as const) b.box('wood', 0.1, 0.9, 0.1, x + W1 / 2 + 1.6 + s * 0.72, top + 0.45, zz, shade(RED, 0.9));
  }
  for (const s of [-1, 1] as const) {
    b.box('wood', 0.12, 0.12, nS * tread, x + W1 / 2 + 1.6 + s * 0.72, y0 + (bY - y0) / 2 + 0.95, z, shade(RED, 0.95), 0, -Math.atan2(bY - y0, nS * tread), 0);
  }
}

/** 须弥座台 + 望柱栏杆 + 踏道（巡天将台：旧版只有一圈发光底盘，台身直接立在云上） */
function stoneTerrace(b: Baker, x: number, y: number, z: number, hw: number, hd: number, top: number, stair: 'n' | 's'): void {
  const MO = 0x9a948c;
  b.box('ash', 2 * hw + 2.4, 0.34, 2 * hd + 2.4, x, y + 0.17, z, shade(MO, 0.98));
  b.box('ash', 2 * hw + 1.9, 0.36, 2 * hd + 1.9, x, y + 0.52, z, shade(MO, 0.88));   // 束腰
  b.box('ash', 2 * hw + 2.2, 0.34, 2 * hd + 2.2, x, y + 0.87, z, shade(MO, 1.04));
  // 望柱 + 两道寻杖：每 2.2m 一根；踏道所在面留 3.4m 口
  const gap = 3.4;
  const post = (px: number, pz: number): void => {
    b.box('ash', 0.26, 1.06, 0.26, px, top + 0.53, pz, shade(MO, 1.04));
    b.box('ash', 0.36, 0.14, 0.36, px, top + 1.13, pz, shade(MO, 1.14));
  };
  const rail = (ax: number, az: number, bx: number, bz: number, skip: boolean): void => {
    if (skip) {
      const dx = bx - ax, dz = bz - az;
      const t0 = 0.5 - gap / Math.hypot(dx, dz) / 2, t1 = 1 - t0;
      rail(ax, az, ax + dx * t0, az + dz * t0, false);
      rail(ax + dx * t1, az + dz * t1, bx, bz, false);
      return;
    }
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const ry2 = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= n; i++) post(ax + (dx * i) / n, az + (dz * i) / n);
    for (const yy of [0.94, 0.5]) b.box('ash', len, 0.14, 0.14, (ax + bx) / 2, top + yy, (az + bz) / 2, shade(MO, 1.0), ry2);
  };
  rail(x - hw, z + hd, x + hw, z + hd, stair === 's');
  rail(x - hw, z - hd, x + hw, z - hd, stair === 'n');
  rail(x - hw, z - hd, x - hw, z + hd, false);
  rail(x + hw, z - hd, x + hw, z + hd, false);
  // 踏道：13 级，外侧宽 3.2
  const nS = 13, rise = (top - y) / nS, tread = 0.34;
  const sz0 = stair === 'n' ? z - hd - 0.4 : z + hd + 0.4;
  for (let i = 0; i < nS; i++) {
    const dir = stair === 'n' ? -1 : 1;
    b.box('ash', 3.2, rise + 0.08, tread + 0.02, x, y + (i + 1) * rise - (rise + 0.08) / 2, sz0 + dir * (nS - i - 0.5) * tread, shade(MO, 1.0 + (i % 2) * 0.03));
  }
}

/** 月华坛（广寒）：须弥座 0.78 + 望柱寻杖 + 南踏道；坛面标高必须等于室内陈设的 fy */
function moonAltar(b: Baker, x: number, y: number, z: number, hw: number, hd: number, top: number): void {
  const MO = 0xdcdce8;
  const h = top - y;
  b.box('ash', 2 * hw, 0.22, 2 * hd, x, y + 0.11, z, shade(MO, 0.9));
  b.box('ash', 2 * hw - 0.3, h - 0.42, 2 * hd - 0.3, x, y + h / 2, z, shade(MO, 0.82));   // 束腰
  b.box('ash', 2 * hw + 0.24, 0.2, 2 * hd + 0.24, x, top - 0.1, z, shade(MO, 1.02));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = x + Math.cos(a) * (hw + 0.05), pz = z + Math.sin(a) * (hd + 0.05);
    if (Math.sin(a) > 0.7) continue;                       // 南面留给踏道
    b.box('ash', 0.2, 0.86, 0.2, px, top + 0.43, pz, shade(MO, 1.06));
    b.box('ash', 0.28, 0.12, 0.28, px, top + 0.9, pz, shade(MO, 1.16));
  }
  for (const s of [-1, 1] as const) {
    b.box('ash', 2 * hw, 0.1, 0.1, x, top + 0.78, z + s * hd, shade(MO, 1.0));
  }
  for (let k = 0; k < 4; k++) b.box('ash', 2.2, 0.2, 0.32, x, y + 0.1 + k * 0.2, z + hd + 1.0 - k * 0.22, shade(MO, 1.0));
}


export function buildLingxiaoInterior(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  buildSkyInteriorShells(b, sg, atlas);
  const x = 0, z = 95;
  const fy = 214 + 5.6; // 顶层台基顶（殿内地面）
  // 金砖地面高光映像带（R02：对缝≤1mm 沥青描黑+桐油映像 80%——Baker 无镜面，用玉白高光片表意）
  b.box('glow', 17, 0.06, 14, x, fy + 0.04, z, shade(0x2b2b2b, 1.6));
  // 九龙金漆背屏（R02/T-ITM-0002：北正位高 5m 五联扇）+ 明黄云锦帷六幅两侧
  for (let i = 0; i < 5; i++) {
    const h = i === 2 ? 5.0 : 4.2;
    b.box('wood', 1.9, h, 0.22, x - 4.0 + i * 2.0, fy + h / 2, z - 9.8, 0xc3272b);
    b.box('glow', 1.7, h - 0.5, 0.06, x - 4.0 + i * 2.0, fy + h / 2, z - 9.66, shade(GOLD, 0.75));
  }
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    b.box('glow', 0.8, 6.0, 0.1, x + s * (6.6 + k * 0.8), fy + 3.4, z - 9.5, shade(GOLD2, 0.55 - k * 0.08));
  }
  // 蟠龙金柱贴金环带（既有 8 柱 x±?, 沿柱高 3 道金环——查 realm 柱距 12 间隔）
  for (const px of [-12, -4, 4, 12]) for (const pz of [-6, 6]) {
    b.cyl('glow', 0.62, 0.62, 0.16, 10, x + px, fy + 3.2 + (pz > 0 ? 0 : 4), z + pz, shade(GOLD, 0.8));
    b.cyl('glow', 0.62, 0.62, 0.16, 10, x + px, fy + 1.4 + (pz > 0 ? 0 : 4), z + pz, shade(GOLD, 0.65));
  }
  // 斗八藻井三层（R03：方井 6.4→八角 4.8→圆井顶心明镜 2.4，蟠龙衔珠贴金凸 3mm）
  const ay = 214 + 14.2;
  b.box('glow', 6.4, 0.4, 6.4, x, ay, z, shade(0x1e3a5f, 1.1));
  b.cyl('glow', 2.4, 2.4, 0.35, 8, x, ay + 0.25, z, shade(0x1e3a5f, 1.25), 0, 0, Math.PI / 8);
  b.cyl('glow', 1.2, 1.2, 0.3, 12, x, ay + 0.5, z, GOLD);
  b.cyl('glow', 0.4, 0.4, 0.45, 8, x, ay + 0.75, z, JADE_L); // 顶心明镜（接天光光柱）
  // 璎珞垂珠一圈（井沿：珠金穗粉）
  for (let k = 0; k < 12; k++) {
    const a = k * 0.5236;
    b.box('glow', 0.06, 0.55, 0.06, x + Math.cos(a) * 2.3, ay - 0.35, z + Math.sin(a) * 2.3, k % 2 ? GOLD : 0xffb7c5);
  }
  // 蟠龙金烛台 ×2（T-ITM-0005 高 1.4 焰玉白）
  for (const s of [-1, 1]) {
    b.cyl('wood', 0.12, 0.3, 1.4, 8, x + s * 5.5, fy + 0.7, z + 2, GOLD2);
    b.box('glow', 0.16, 0.4, 0.16, x + s * 5.5, fy + 1.6, z + 2, JADE_L);
  }
  void sg; void atlas;
}

/**
 * 兜率宫丹院（R02：八卦铜砖满铺 + 丹位火养圈 + 紫金丹炉八卦浮刻 + 丹方玉简架）。
 * W25 修正：兜率宫正殿是 realm.ts 的 9×5×7 实心盒（未掏空），旧版这组"室内陈设"整组埋在盒体里，
 * 只有丹炉东半边从墙面穿出，其余全部不可见。现移到殿南的露天丹院（平台 r=19，中心 -124,-32，
 * 与 realm 的室外丹灶 -116.6,-20 净距 13m），器物面落在云台铺装 208.12，不再悬空/穿模。
 */
export function buildDoushuaiInterior(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const x = -124, z = -32;
  const fy = 208.14;
  // 丹院台面：8.4×8.4 八卦砖台（比八卦砖阵大一圈，砖不是直接浮在云上）
  b.box('ash', 9.4, 0.18, 9.4, x, fy - 0.09, z, shade(0x6a5a48, 1.0));
  b.box('ash', 10.2, 0.12, 10.2, x, fy - 0.24, z, shade(0x5a4c3c, 0.96));
  // 八卦铜砖地面（64 格意向 8×8 阴刻）
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    b.box('glow', 0.92, 0.05, 0.92, x - 3.7 + c * 1.06, fy + 0.03, z - 3.7 + r * 1.06, shade(0xb87333, 0.8 + ((r + c) % 2) * 0.25));
  }
  // 炉位火养圈（全宫唯一 #4E7A5E）
  b.cyl('glow', 1.6, 1.6, 0.06, 16, x, fy + 0.06, z, 0x4e7a5e);
  // 紫金丹炉（T-ITM-0028 高 2.6 三足承雷纹+八卦浮刻+炉口丹火呼吸——静态柱表意，动态既有 ember）
  b.cyl('wood', 1.1, 1.5, 1.8, 10, x, fy + 1.5, z, shade(0xb87333, 1.1));
  b.cyl('wood', 0.5, 0.9, 0.8, 10, x, fy + 2.8, z, shade(0xb87333, 1.2));
  for (let k = 0; k < 8; k++) { const a = k * 0.785; b.box('glow', 0.14, 0.5, 0.06, x + Math.cos(a) * 1.28, fy + 1.6, z + Math.sin(a) * 1.28, shade(GOLD, 0.7), -a); }
  for (let k = 0; k < 3; k++) { const a = k * 2.094; b.box('wood', 0.2, 0.9, 0.2, x + Math.cos(a) * 1.15, fy + 0.45, z + Math.sin(a) * 1.15, shade(0x26282c, 1.3)); }
  b.cyl('glow', 0.42, 0.62, 0.9, 8, x, fy + 3.6, z, 0xff7f50, 0, 0, 0, true); // 丹火柱（0.5Hz 呼吸由 vfx ember 叠加）
  // 丹方玉简架（西侧 36 枚白玉朱字意向）+ 百药柜（东侧 99 屉铜签）
  b.box('wood', 0.6, 3.2, 4.5, x - 4.9, fy + 1.6, z, shade(0x223a5e, 1.15));
  for (let k = 0; k < 4; k++) b.box('glow', 0.62, 0.05, 4.1, x - 4.9, fy + 0.7 + k * 0.75, z, 0xf2efe9);
  b.box('wood', 0.6, 3.0, 4.0, x + 4.9, fy + 1.5, z, 0xd4b76a);
  for (let k = 0; k < 5; k++) b.box('glow', 0.5, 0.04, 3.6, x + 4.9, fy + 0.6 + k * 0.6, z, shade(0xd4a017, 0.6));
  // 星辉灯两盏（#F8F8FF）：立在砖台东缘，不在炉火正上方
  for (const s of [-1, 1]) b.box('glow', 0.26, 0.36, 0.26, x + s * 3.0, fy + 2.6, z + 4.5, 0xf8f8ff);
  void sg; void atlas;
}

/**
 * 广寒宫月华坛（R02：冰纹白玉砖 / 冰魄屏风 / 月白无影光；R06 玉兔灯阵 12 错频）。
 * W25 修正：旧版陈设直接摆在大月台中央、离台面 0.78m（fy=209.9 vs 台面 209.12），正压在
 * 嫦娥环绕圈（r=6，deities.ts 沿此圆走位）上，且同一位置还重复种了一棵桂树（realm.ts 在
 * (45,-58) 已有主桂）。现改为：坛起在月台中央（须弥座 6.8×7.4，坛面 209.9 = 陈设 fy），
 * 屏风/香炉/隔扇都落在坛面；玉兔灯收到坛内 r2.3–2.8；重复桂树删除，只留玉兔灯阵。
 */
export function buildGuanghanInterior(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const x = 40, z = -55;
  const fy = 209.9;                       // 坛面标高（= 旧陈设 fy，器物不必重排高度）
  moonAltar(b, x, 209.12, z, 3.4, 3.7, fy);
  // 冰纹白玉砖（冷光地面）+ 月白无影宫光带：收到坛面以内
  b.box('glow', 6.2, 0.05, 6.6, x, fy + 0.04, z, shade(0xf2efe9, 0.9));
  for (let k = 0; k < 6; k++) b.box('glow', 1.2, 0.05, 0.1, x - 2.6 + k * 1.05, fy + 0.06, z + (k % 2 ? 1.0 : -1.0), shade(0xa8c8e8, 0.7));
  // 冰魄屏风五扇（T-ITM-0068：框冰魄石半透+夜显星图）
  for (let i = 0; i < 5; i++) {
    b.box('glow', 0.9, 2.4, 0.08, x - 2.4 + i * 1.2, fy + 1.2, z - 3.2, shade(0xa8c8e8, 0.55 + (i === 2 ? 0.15 : 0)));
  }
  // 月华香炉（炉烟凝月轮）
  b.cyl('glow', 0.4, 0.5, 0.6, 8, x, fy + 0.35, z - 1.8, shade(0xf2efe9, 1.05));
  b.cyl('glow', 0.28, 0.1, 1.1, 6, x, fy + 1.2, z - 1.8, shade(0xfffdf5, 0.5), 0, 0, 0, true);
  // 玉兔宫灯 12 盏（错相位，灯座落在坛面 r2.3–2.8，不再悬到坛外）
  for (let k = 0; k < 12; k++) {
    const a = k * 0.5236, r = 2.3 + (k % 3) * 0.25;
    b.box('glow', 0.2, 0.3, 0.2, x + Math.cos(a) * r, fy + 0.7 + (k % 4) * 0.3, z + Math.sin(a) * r, shade(0xf8f8ff, 0.55 + 0.15 * (k % 3)));
  }
  // 玉版隔扇（白玉透光 8 樘南面）
  for (let k = 0; k < 8; k++) b.box('glow', 1.3, 2.6, 0.08, x - 5.2 + k * 1.5, fy + 1.3, z + 3.3, shade(0xf2efe9, 0.75));
  void sg; void atlas;
}

/** 天宫室内点光（玉白/丹火/月白——物理单位） */
// WS-20：四殿各补 1–2 盏低档点光（玉白 0xfff4dc / 瑶池偏金 0xffe6b8）。强度档位 0.25–0.45 按 100 cd 归一（25–45）：
// 本工程点光走 three r180 物理单位，既有 SKY_LIGHTS 为 40–140 cd，按字面写 0.3 cd 在 18m 处照度 <0.001 lux，等于假灯。
// 落点压在各殿天花/梁下：凌霄 −0.7（室内天花 222.56）、星宿 −1.45（天花 217.95）、瑶池宫 −1.6（廊顶板底 211.50）、
// 瑶池主亭 −0.25（梁底 212.40），蟠桃园保持 207.5（看园厅屋面止于 206.7，该层只余园内空腔）。
export const SKY_LIGHTS: { x: number; y: number; z: number; color: number; int: number; dist: number }[] = [
  { x: 0, y: 214 + 9.5, z: 95, color: 0xfff3d8, int: 140, dist: 22 },    // 凌霄明间玉白
  // 背屏金辉：点光色不是反照率，不随金饰压档（压它等于改室内照明/曝光，本包不动）
  { x: 0, y: 214 + 6.5, z: 89, color: 0xffd700, int: 40, dist: 10 },     // 凌霄背屏金辉
  { x: -120, y: 208 + 3.6, z: -20, color: 0xff7f50, int: 90, dist: 12 },   // 兜率丹火（B6 迁正）
  { x: -120, y: 208 + 2.6, z: -17, color: 0xf8f8ff, int: 45, dist: 9 },    // 兜率星辉补（B6 迁正）
  { x: 40, y: 209 + 3.2, z: -55, color: 0xf8f8ff, int: 80, dist: 14 },   // 广寒月白
  { x: 150, y: 206 + 4.5, z: 20, color: 0xfff3d8, int: 100, dist: 16 },   // 瑶池主亭玉白
  { x: -13.6, y: 222.3, z: 92.4, color: 0xfff4dc, int: 30, dist: 20 },   // 凌霄西翼 R02 梁下（原值 223 会落进 222.56 天花）
  { x: 13.6, y: 222.3, z: 97.6, color: 0xfff4dc, int: 30, dist: 20 },    // 凌霄东翼 R03 梁下
  { x: 150, y: 212.25, z: 20, color: 0xffe6b8, int: 28, dist: 18 },      // 瑶池主亭檐梁下（梁底 212.4）
  { x: 204, y: 211.35, z: 20, color: 0xfff4dc, int: 35, dist: 22 },      // 瑶池宫中廊梁下（廊顶板底 211.50）
  { x: -150, y: 207.5, z: 45, color: 0xfff4dc, int: 32, dist: 24 },      // 蟠桃园心：看园厅屋面止于 206.7，此层只余园内空腔
  { x: 220, y: 217.55, z: 80, color: 0xfff4dc, int: 26, dist: 18 },      // 星宿·亢金龙府室内（原值 219 会落进 218.9 屋面）
];

// ============ WS-46：云海色系与浮岛底盘（玉盘 + 垂云 + 云团簇） ============
// 三视角验证判词：浮岛底缘是一圈深色石鼓，鼓下直接露出人间里坊网格，整片「上界」读成
// 「贴在城市上方的几张圆盘」。本段把每座云台的底盘换成「云团簇 + 玉盘」，色系统一到云海
// （冷白—淡青—玉灰），与 realm.ts 的三层云海连读成「岛浮云上」，不再是「盘贴城上」。
// 云色档位按「受光后」定：这三支同时用于云海三层、云帘、云团与玉盘。
// 旧值 CS_TOP 0xaabecd（线性 0.41）× 3.2 总光照 = 1.31，ACES 后落到 219–235，
// 三层云板叠起来就是一整片白，俯视读出「白盘子」而不是云海。压到 0.19/0.27 线性一带后，
// 受光落在 0.6–0.9，云团之间才有明暗层次。
export const CS_DEEP = 0x33414e;   // 云海底面（朝向人间的一侧）
export const CS_BASE = 0x41505d;   // 云海主体
export const CS_TOP = 0x4e5d68;    // 云海顶面 / 受光面
export const CS_JADE = 0x5e6c77;   // 玉盘

/** 确定性抖值：同参数同结果，且不消耗 RNG——云海不得扰动既有世界生成序列（城郭/植被/幽冥） */
export function skyJitter(i: number, s: number): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 74.7) * 43758.5453;
  return v - Math.floor(v);
}

// ============ 天宫体积云：多层半透明云片（替换「云球」） ============
// 旧 cloudBall 是三个 8/9 边锥台叠成的**闭合**团（104 面/团），受光后剪影就是一个实体球冠，
// 近景读成棉花球。现在每团云改成 3 层 × 3 张交叉竖片 + 1 张水平片 = 10 张软边云片（20 面/团）：
//   · 每张云片是一张程序化 alpha 的四边形：多瓣积云图案 + 径向蒙版，四边 alpha 先归零再出境，
//     所以**任何角度都看不到四边形本身的边**（无剪影、无硬边、没有 alphaTest 造成的锯齿边）；
//   · 三层用不同 y / 不同尺度 / 不同透明度叠起来，横向错位，远看是一摞有明暗层的云堆而不是一颗球；
//   · 顶点色按「上亮下暗」烘死（顶 ×1.08 / 底 ×0.80），不依赖光照，天光变化不会把云推回纯白；
//   · depthWrite:false + DoubleSide：片与片之间的穿插不会互相切出硬口，飞进云里也是渐隐而不是穿模。
// 材质是新建的 cloud（MeshBasicMaterial + RGBA 顶点色），因为 Baker 的 14 个材质组全是 Opaque、
// 且 bake.ts 不在本流可改范围内：几何先攒在模块缓冲，由 expansion.ts（唯一拿得到 scene 的允许文件）
// 在全部浮岛建完后统一挂场景（按象限分 4 个 mesh，各 1 个 draw call，可被视锥剔除）。
const CLOUD_LAYERS: readonly (readonly [number, number, number, number, number])[] = [
  // [y 偏移/r, 半宽/r, 半高/r, 不透明度, 明度系数] —— 顶窄而亮 / 中宽而实 / 底宽而暗
  [-0.30, 0.86, 0.34, 0.28, 1.06],
  [-0.66, 1.04, 0.44, 0.34, 1.00],
  [-1.04, 1.16, 0.48, 0.30, 0.86],
];
/** 水平片：[y 偏移/r, 半宽/r, 不透明度, 明度系数]——俯视时竖片只剩一条线，靠它铺满云面 */
const CLOUD_LID: readonly [number, number, number, number] = [-0.58, 1.02, 0.20, 0.95];
const CLOUD_TINT: readonly [number, number, number] = [0xcfe1ef, 0xb9cddd, 0x93a9bb]; // 顶/中/底
const CLOUD_LID_TINT = 0xa9bccc;
const CLOUD_V_TOP = 1.08;  // 单片竖向梯度（线性乘子）：上端
const CLOUD_V_BOT = 0.80;  // 下端

interface CloudBuf { p: number[]; uv: number[]; c: number[]; verts: number }
const cloudBufs: CloudBuf[] = Array.from({ length: 4 }, () => ({ p: [], uv: [], c: [], verts: 0 }));
const _cloudC = new THREE.Color();
let cloudMat: THREE.MeshBasicMaterial | null = null;

/** 云片贴图：多瓣积云 + 径向软边。只在浏览器里建（node/vitest 下不触碰 canvas）。 */
function cloudSheetTexture(): THREE.CanvasTexture {
  const SZ = 512;
  const cv = document.createElement('canvas');
  cv.width = SZ; cv.height = SZ;
  const g2 = cv.getContext('2d')!;
  let sd = 20261031;
  const rnd = (): number => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
  const lobe = (x: number, y: number, r: number, a: number): void => {
    const rg = g2.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(255,255,255,${a})`);
    rg.addColorStop(0.5, `rgba(255,255,255,${a * 0.66})`);
    rg.addColorStop(0.8, `rgba(255,255,255,${a * 0.22})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = rg;
    g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2); g2.fill();
  };
  // 底部一条厚云 + 上方 15 瓣参差团块：刻意不做正圆（正圆就是又一个球）
  lobe(SZ * 0.5, SZ * 0.6, SZ * 0.34, 0.9);
  for (let i = 0; i < 15; i++) {
    lobe(SZ * (0.2 + rnd() * 0.6), SZ * (0.28 + rnd() * 0.34), SZ * (0.07 + rnd() * 0.13), 0.38 + rnd() * 0.34);
  }
  // 软边：径向蒙版把四边 alpha 收到 0，四边形永远不会露边
  g2.globalCompositeOperation = 'destination-in';
  const mask = g2.createRadialGradient(SZ / 2, SZ / 2, 0, SZ / 2, SZ / 2, SZ / 2);
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(0.58, 'rgba(255,255,255,0.94)');
  mask.addColorStop(0.86, 'rgba(255,255,255,0.34)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = mask;
  g2.fillRect(0, 0, SZ, SZ);
  g2.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.name = 'cloudSheet';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function cloudSheetMaterial(): THREE.MeshBasicMaterial {
  if (!cloudMat) {
    cloudMat = new THREE.MeshBasicMaterial({
      map: cloudSheetTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return cloudMat;
}

/** 单片云：以 (ox,oy,oz) 为心，沿 U/H 两轴展开 2hw×2hh，顶点色（线性 RGBA）带竖向明暗与逐层不透明度。 */
function cloudSheet(
  bf: CloudBuf,
  ox: number, oy: number, oz: number,
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
  hw: number, hh: number,
  tint: THREE.Color, alpha: number,
  kBot = CLOUD_V_BOT, kTop = CLOUD_V_TOP,
): void {
  const ax = ox - ux * hw - vx * hh, ay = oy - uy * hw - vy * hh, az = oz - uz * hw - vz * hh;
  const bx = ox + ux * hw - vx * hh, by = oy + uy * hw - vy * hh, bz = oz + uz * hw - vz * hh;
  const cx = ox + ux * hw + vx * hh, cy = oy + uy * hw + vy * hh, cz = oz + uz * hw + vz * hh;
  const dx = ox - ux * hw + vx * hh, dy = oy - uy * hw + vy * hh, dz = oz - uz * hw + vz * hh;
  const rB = tint.r * kBot, gB = tint.g * kBot, bB = tint.b * kBot;
  const rT = tint.r * kTop, gT = tint.g * kTop, bT = tint.b * kTop;
  const push = (x: number, y: number, z: number, u: number, v: number, r: number, g: number, b: number): void => {
    bf.p.push(x, y, z); bf.uv.push(u, v); bf.c.push(r, g, b, alpha); bf.verts++;
  };
  push(ax, ay, az, 0, 0, rB, gB, bB);
  push(bx, by, bz, 1, 0, rB, gB, bB);
  push(cx, cy, cz, 1, 1, rT, gT, bT);
  push(ax, ay, az, 0, 0, rB, gB, bB);
  push(cx, cy, cz, 1, 1, rT, gT, bT);
  push(dx, dy, dz, 0, 1, rT, gT, bT);
}

/**
 * 云团：3 层交叉云片 + 1 张水平片。yTop 贴岩腰、整体向下堆，r = 6–18m。
 * 面数：10 张片 = 20 面（旧版三锥台 104 面）。不写 Baker —— 透明混合无法用它的不透明材质组表达。
 */
export function cloudBall(b: Baker, x: number, yTop: number, z: number, r: number, seed: number): void {
  void b;
  const bf = cloudBufs[(x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0)];
  const jx = (skyJitter(seed, 1.7) - 0.5) * r * 0.28;
  const jz = (skyJitter(seed, 2.3) - 0.5) * r * 0.28;
  for (let li = 0; li < CLOUD_LAYERS.length; li++) {
    const [dy, hwK, hhK, alpha, tintK] = CLOUD_LAYERS[li];
    const lx = x + jx * (0.3 + li * 0.35), lz = z + jz * (0.3 + li * 0.35);
    const ly = yTop + dy * r;
    const hw = hwK * r * (0.93 + skyJitter(seed, 12.1 + li) * 0.14);
    const hh = hhK * r * (0.93 + skyJitter(seed, 13.7 + li) * 0.14);
    _cloudC.setHex(CLOUD_TINT[li]).multiplyScalar(tintK * (0.95 + skyJitter(seed, 15.3 + li) * 0.1));
    const yaw0 = skyJitter(seed, 17.9 + li) * Math.PI;
    for (let p = 0; p < 3; p++) {
      const a = yaw0 + (p * Math.PI) / 3;
      cloudSheet(bf, lx, ly, lz, Math.cos(a), 0, Math.sin(a), 0, 1, 0, hw, hh, _cloudC, alpha);
    }
  }
  const [ldy, lhw, lAlpha, lTintK] = CLOUD_LID;
  _cloudC.setHex(CLOUD_LID_TINT).multiplyScalar(lTintK);
  const lYaw = skyJitter(seed, 21.3) * Math.PI;
  cloudSheet(bf, x + jx * 0.2, yTop + ldy * r, z + jz * 0.2,
    Math.cos(lYaw), 0, Math.sin(lYaw), -Math.sin(lYaw), 0, Math.cos(lYaw),
    lhw * r, lhw * r, _cloudC, lAlpha, 0.94, 1.0);
}

/** 把攒下的云片挂进场景（由 expansion.buildSkyExpansion 末尾调用）。返回三角面数，供台账核对。 */
export function flushSkyCloudSheets(scene: THREE.Scene): number {
  let tris = 0;
  for (let i = 0; i < cloudBufs.length; i++) {
    const bf = cloudBufs[i];
    if (bf.verts === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bf.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bf.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(bf.c, 4));
    geo.computeBoundingSphere();
    tris += bf.verts / 3;
    bf.p.length = 0; bf.uv.length = 0; bf.c.length = 0; bf.verts = 0;
    const mesh = new THREE.Mesh(geo, cloudSheetMaterial());
    mesh.name = 'sky_cloudSheets_' + i;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
  return tris;
}

// ============ W3 / F8：浮岛底——岩石倒锥 + 瀑布 + 垂藤（替换「土褐色圆盘 + 白色泡沫圈」） ============
/** 岩石色（ash 组深灰岩，0x6a6a70 一档）：比云海（0x93a7ba）暗两档，侧视读岩不读云 */
const ROCK_K = 0x6a6a70;
/** 云海顶面标高（realm.ts 三层云海最上层 y=196 + 厚 1.3 的上表面）：瀑布、水雾、岩腰垂云都按此收口 */
const CLOUD_TOP = 196.65;
/** 瀑布水色：water 组是 MeshBasicMaterial + toneMapped:false，写亮色就是一条白带 */
const WATER_K = 0x3f7086;
/** 垂藤叶色（leaf 组） */
const VINE_K = 0x3f6a45;

/** 岛缘瀑布口方位（同一座岛恒定）：realm.ts 的三级石座栏杆据此留 2–3 根望柱的空当 */
export function islandFallAngle(seed: number): number {
  return skyJitter(seed, 51.7) * Math.PI * 2;
}

/**
 * 浮岛底盘：岩石倒锥（三级收口 + 错位岩瓣）+ 玉盘 + 岩腰垂云 + 瀑布 + 垂藤 + 云团簇。
 * drop = 玉盘中心相对台面的下沉量（有三级石座的云台 7.6；只有发光环的浅台 1.4）。
 * W3/F8：旧版只有「玉盘 + 云帘 + 云球」，侧视读成「土褐色圆盘 + 白色泡沫圈」——台座以下没有岩体，
 * 云帘又贴在最外圈。本版把台座以下整体换成岩体，云退到岩腰当腰线，瀑布与垂藤沿岩面走。
 */
export function buildIslandSkirt(b: Baker, x: number, y: number, z: number, r: number, seed: number, drop = 7.6, hang = 1, balls = 0): void {
  const jr = r * 0.9;
  const py = y - drop;
  // ---- 岩石倒锥：顶径 0.94r → 中段 0.58r → 底尖 0.12r（三级收口），高 = 盘径 ×0.55–0.85 ----
  // 起挂点 y−2.6 = 三级石座第二叠下沿（realm.ts platform 的座径同时收到 0.975r，岩体在它外侧）。
  // 石座 / 玉盘段（y−2.6 .. y−8.3）取 max(锥面, 座径 + 0.014r)：岩体不会陷进座里、座也不会从岩皮里
  // 穿出来，土褐色石鼓从此外包一层岩；低于此段才是纯锥面。轮廓按 8 段采样成锥台，法线/朝向随段走。
  // 底尖落到云海面（196.65）之下，被 190 / 193 两层云板挡在人间的视线之外（风险见交付报告）。
  const rockTopY = y - 2.6;
  // 底尖原本会落到云海面（196.65）之下 6–25m，从云海边（r 1180）下方仰视能看见岩尖剪影。
  // 收口到 187.5（低于 190 云板 2.5m），尖端永远被云板挡住。
  // 截断下限 187.5 → 184.5：低岛（r≈16–22、rockTopY≈206）原先被 `rockTopY−187.5` 卡住，
  // 实测 h/r 只有 0.43–0.44（`probe-display` 4.4 断言 ≥0.5 因此不过）。放宽 3m 后矮岛也能有正常锥高，
  // 尖端仍低于 190/193 两层云板，从人间仰视不会露出岩尖。
  const hRock = Math.min(r * (0.55 + skyJitter(seed, 41.3) * 0.3), rockTopY - 184.5);
  const MID = 0.58; // 三级收口的腰位：顶径 0.94r → 腰 0.58r → 尖 0.12r
  const R3 = r * 0.12;
  // 石座轮廓（realm.ts platform 三叠 0.975 / 0.93 / 0.88）+ 玉盘（0.87 → 0.83）
  const baseR = (yy: number): number => {
    const d = y - yy;
    return d <= 3 ? 0.975 - 0.045 * (d / 3)
      : d <= 5.2 ? 0.93 - 0.05 * ((d - 3) / 2.2)
        : d <= 7 ? 0.88 - 0.05 * ((d - 5.2) / 1.8)
          : 0.87 - 0.04 * Math.min(1, (d - 7) / 1.2);
  };
  const rockR = (yy: number): number => {
    const t = (rockTopY - yy) / hRock;
    const cone = t <= 0 ? r * 0.94
      : t <= MID ? r * (0.94 + (MID - 0.94) * (t / MID))
        : t >= 1 ? R3 : r * (MID + (0.12 - MID) * ((t - MID) / (1 - MID)));
    return yy > y - 8.3 ? Math.max(cone, r * baseR(yy) + r * 0.014) : cone;
  };
  const SL = 8;
  // W24/W25 岩层色带：8 段锥面按 3/3/2 分成三条水平岩层（0–37.5%h / 37.5–75%h / 75–100%h），
  //   shade 乘子取 1.23 / 0.76 / 1.21 —— 落到 sRGB 即 0x75757b → 0x5d5d62 → 0x74747a（117/93/116），
  //   相邻层明度差 20.5% / 19.8%（W24 的 1.08/0.828/1.06 只有 11.8%/12.4%，远处糊成一块灰）。
  //   色带是逐段常量：三段各由 3/3/2 个独立锥台拼成，段与段之间没有插值，边界是阶跃；
  //   段内只有 Baker 的接触 AO（线性 ×0.82→1.0，≈9% sRGB）制造同一层的上下微差，不跨层渐变。
  //   只动颜色：段数、半径、高度全不变（不加厚度、不重做锥体）。
  const ROCK_BANDS = [1.23, 0.76, 1.21];
  const bandOf = (k: number): number => (k < 3 ? 0 : k < 6 ? 1 : 2);
  for (let k = 0; k < SL; k++) {
    const ya = rockTopY - (hRock * k) / SL, yb = rockTopY - (hRock * (k + 1)) / SL;
    b.cyl('ash', rockR(ya), rockR(yb), ya - yb, 18, x, (ya + yb) / 2, z,
      shade(ROCK_K, ROCK_BANDS[bandOf(k)] + (skyJitter(seed, 42.7) - 0.5) * 0.016));
  }
  // 腰箍：0.94 → 0.58 的陡收处加一圈薄岩台，读成「一级岩台」而不是一段直角锥面
  const yMid = rockTopY - hRock * MID;
  b.cyl('ash', rockR(yMid) * 1.06, rockR(yMid) * 1.03, 0.34, 18, x, yMid, z, shade(ROCK_K, 1.12));
  // 岩瓣 6–10 块：角度 / 高度 / 半径三向抖动错位，把 18 边形锥台的整圆剪影打碎
  const nL = 6 + Math.floor(skyJitter(seed, 43.1) * 5);
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * Math.PI * 2 + skyJitter(i + seed, 44.9) * 0.7;
    const ly = rockTopY - hRock * (0.06 + skyJitter(i + seed, 45.7) * 0.52);
    const rr = rockR(ly) * (0.97 + skyJitter(i + seed, 47.9) * 0.1);
    b.pyramid('ash', 0.2, 1, x + Math.cos(a) * rr, ly, z + Math.sin(a) * rr,
      shade(ROCK_K, 0.84 + skyJitter(i + seed, 48.1) * 0.3), a,
      r * (0.10 + skyJitter(i + seed, 49.3) * 0.08), hRock * (0.18 + skyJitter(i + seed, 46.3) * 0.24), r * (0.06 + skyJitter(i + seed, 49.9) * 0.05));
  }
  // 玉盘：缩进岩体内（旧 0.9r 会在岩面外露出一圈玉色盘沿，正是「白色泡沫圈」的一半）
  b.cyl('ash', r * 0.86, r * 0.83, 1.2, 28, x, py, z, shade(CS_JADE, 1.02));
  b.cyl('ash', r * 0.87, r * 0.87, 0.26, 28, x, py + 0.34, z, shade(CS_JADE, 1.12));
  b.kit('sky.islandSkirt.jadePlate', 2, py);
  // 垂云：改挂岩腰（云海面之上 0.9m）贴岩面绕一圈，把岩与云接住，不再贴盘缘成一圈白泡沫
  const collarY = Math.max(y - 11.5, CLOUD_TOP + 0.9);
  const collarR = rockR(collarY) + 0.75;
  const nH = Math.max(10, Math.min(40, Math.round((Math.PI * 2 * jr) / 6.5))); // 与旧口径同值，kit 计数不漂
  const hTop = collarY;
  for (let i = 0; i < nH; i++) {
    const a = (i / nH) * Math.PI * 2;
    const hx = x + Math.cos(a) * collarR, hz = z + Math.sin(a) * collarR;
    const hh = (1.4 + skyJitter(i + seed, 1.9) * 1.6) * hang;
    b.box('fabric', 3.0 + skyJitter(i + seed, 2.7) * 1.8, hh, 0.55, hx, hTop - hh / 2, hz, shade(CS_BASE, 0.9 + skyJitter(i + seed, 3.3) * 0.12), Math.PI / 2 - a);
    b.box('fabric', 1.7 + skyJitter(i + seed, 4.1) * 0.9, 0.5 * hang, 0.45, hx, hTop - hh - 0.22 * hang, hz, shade(CS_TOP, 0.95), Math.PI / 2 - a);
  }
  b.kit('sky.islandSkirt.cloudHang', nH * 2, hTop);
  // 瀑布：岩口一处垂 2–3 道水帘（沿岩面分三段内收，不悬空），落点补水雾
  if (r >= 17) islandFalls(b, x, y, z, seed, rockR);
  // 垂藤：沿岩面上缘每 5–7m 一挂 3–5 段（leaf 组），段长随 jitter
  const nV = Math.max(6, Math.round((Math.PI * 2 * jr) / (5 + skyJitter(seed, 57.3) * 2)));
  for (let i = 0; i < nV; i++) {
    const a = (i / nV) * Math.PI * 2 + skyJitter(i + seed, 58.1) * 0.16;
    const segN = 3 + Math.floor(skyJitter(i + seed, 58.9) * 3);
    let vy = rockTopY - skyJitter(i + seed, 59.3) * 1.2;
    for (let s2 = 0; s2 < segN; s2++) {
      const len = 0.8 + skyJitter(i + seed + s2 * 7, 60.1) * 1.1;
      const rr = rockR(vy - len / 2) + 0.2;
      b.box('leaf', 0.16, len, 0.16, x + Math.cos(a) * rr, vy - len / 2, z + Math.sin(a) * rr, shade(VINE_K, 0.9 + skyJitter(i + seed, 61.7) * 0.25), Math.PI / 2 - a);
      if (s2 % 2 === 1) b.box('leaf', 0.52, 0.3, 0.36, x + Math.cos(a) * (rr + 0.2), vy - len / 2, z + Math.sin(a) * (rr + 0.2), shade(VINE_K, 1.05), Math.PI / 2 - a);
      vy -= len + 0.05;
    }
  }
  // 云团簇：挂岩腰外圈。低岛的岩腰落在云海面（196.65）以下——原样挂上去整组云会被云海面吞掉
  // （`shot-hide sky_cloudSheets` A/B 实测：藏掉 4 个云片 mesh 画面几乎不变），所以云团中心再取一个
  // 「云海面 + 0.55r」的下限：低岛读成从云海里升起的一圈积云，高岛仍贴岩腰。
  const nb = balls || (r >= 30 ? 14 : r >= 18 ? 11 : 8);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + skyJitter(i + seed, 5.3) * 0.55;
    const rr = collarR + 1.0 + skyJitter(i + seed, 6.1) * 6;
    const br = Math.min(18, Math.max(6, r * 0.2 + skyJitter(i + seed, 7.7) * 8));
    const cy = Math.max(collarY + 0.8 - skyJitter(i + seed, 8.9) * br * 0.35, CLOUD_TOP + 0.55 * br);
    cloudBall(b, x + Math.cos(a) * rr, cy, z + Math.sin(a) * rr, br, i * 5 + seed);
  }
  b.kit('sky.islandSkirt.cloudBall', nb, collarY);
}

/** 岛缘瀑布：2–3 道水帘（宽 3–8m）从岩口垂到云海面，沿锥面分三段内收，落点补三团水雾 */
function islandFalls(b: Baker, x: number, y: number, z: number, seed: number, rockR: (yy: number) => number): void {
  const fa = islandFallAngle(seed);
  const nF = 2 + Math.floor(skyJitter(seed, 52.3) * 2);
  // 水帘自岩口（y−2.3，已在石座之外）垂下，到云海面 +1m 收进云里
  const y0 = y - 2.3, y1 = CLOUD_TOP + 1.0;
  for (let k = 0; k < nF; k++) {
    const a = fa + (k - (nF - 1) / 2) * (0.06 + skyJitter(seed + k, 53.9) * 0.03);
    const wdt = 3 + skyJitter(seed + k, 54.7) * 5;
    for (let s2 = 0; s2 < 3; s2++) {
      const ya = y0 + ((y1 - y0) * s2) / 3, yb = y0 + ((y1 - y0) * (s2 + 1)) / 3;
      const rr = rockR((ya + yb) / 2) + 0.42;
      b.box('water', wdt * (1 - s2 * 0.1), ya - yb + 0.2, 0.26 + s2 * 0.08,
        x + Math.cos(a) * rr, (ya + yb) / 2, z + Math.sin(a) * rr,
        shade(WATER_K, 0.92 + s2 * 0.05), Math.PI / 2 - a);
    }
    for (let m2 = 0; m2 < 3; m2++) {
      const am = a + (m2 - 1) * 0.17;
      const rr = rockR(CLOUD_TOP) + 1.4 + (m2 % 2) * 2.6;
      const sr = 3.4 + skyJitter(seed + k * 3 + m2, 55.1) * 3.2;
      b.cyl('fabric', sr * 0.7, sr, 1.6 + skyJitter(seed + k * 3 + m2, 56.3) * 1.2, 8,
        x + Math.cos(am) * rr, CLOUD_TOP + 1.4, z + Math.sin(am) * rr,
        shade(CS_TOP, 0.96 + skyJitter(seed + k * 3 + m2, 56.9) * 0.06), am);
    }
  }
}

// ============ WS-20：云海台地外缘三圈陈设（jiangtai / yaochi 共用） ============
// 一圈望柱寻杖（每 4m）+ 石灯（每 20m）、二圈 6m 云纹铺装带（ground + 分缝）、三圈云海石护栏 + 云头
export interface CloudTerraceSpec {
  cx: number; cz: number; rIn: number; rOut: number; yTop: number; kit: string;
  stone: number; paving: number; joint: number; glowC: number;
  skip?: (a: number, px: number, pz: number) => boolean;
  lamps?: number; heads?: number; fascia?: number; step?: boolean; pier?: number;
  stoneK?: number; glowK?: number;
}

export function buildCloudTerrace(b: Baker, o: CloudTerraceSpec): void {
  const { cx, cz, rIn, rOut, yTop, kit } = o;
  const N = 60, rm = (rIn + rOut) / 2, wRad = rOut - rIn;
  const st = o.stone, pv = o.paving, jt = o.joint, gl = o.glowC;
  const K = o.stoneK ?? 1, G = o.glowK ?? 1; // 石材/发光整体明度系数（高位俯视过曝时逐台压档）
  const skip: (a: number, px: number, pz: number) => boolean = o.skip ?? (() => false);
  // du 沿切向、dw 沿径向的局部偏置，供卷云块在同一环带上错位
  const PX = (a: number, rr: number, du: number, dw: number): number => cx + Math.cos(a) * rr - Math.sin(a) * du + Math.cos(a) * dw;
  const PZ = (a: number, rr: number, du: number, dw: number): number => cz + Math.sin(a) * rr + Math.cos(a) * du + Math.sin(a) * dw;
  const cut = (a: number, rr: number): boolean => skip(a, PX(a, rr, 0, 0), PZ(a, rr, 0, 0));

  // 二圈：6m 云纹铺装带（60 段楔石）+ 放射缝 + 两道环缝 + 卷云纹
  let bays = 0;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    if (cut(a, rm)) continue;
    b.box('ground', 4.36, 0.3, wRad, PX(a, rm, 0, 0), yTop - 0.15, PZ(a, rm, 0, 0), shade(pv, 0.9 + (k % 3) * 0.05), Math.PI / 2 - a);
    bays++;
  }
  b.kit(kit + '.pavingBand', bays, yTop);
  let joints = 0;
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * Math.PI * 2;
    if (cut(a, rm)) continue;
    b.box('ground', 0.16, 0.05, wRad, PX(a, rm, 0, 0), yTop + 0.02, PZ(a, rm, 0, 0), jt, Math.PI / 2 - a);
    joints++;
  }
  for (const dr of [-1 / 3, 1 / 3]) {
    const rr = rm + dr * wRad;
    for (let k = 0; k < N; k++) {
      const a = ((k + 0.5) / N) * Math.PI * 2;
      if (cut(a, rr)) continue;
      b.box('ground', 4.3, 0.05, 0.16, PX(a, rr, 0, 0), yTop + 0.02, PZ(a, rr, 0, 0), jt, Math.PI / 2 - a);
      joints++;
    }
  }
  b.kit(kit + '.pavingJointBand', joints, yTop + 0.02);
  let motifs = 0;
  for (let k = 0; k < N; k += 2) {
    const a = (k / N) * Math.PI * 2 + 0.1;
    if (cut(a, rm)) continue;
    for (const [du, dw, len, tone] of [[-1.5, 1.35, 1.5, 0.8], [-0.1, 2.05, 1.05, 0.87], [1.1, 1.5, 0.62, 0.94], [-1.95, 2.6, 0.72, 0.74]] as const) {
      b.box('ash', len, 0.07, 0.3, PX(a, rm, du, dw), yTop + 0.03, PZ(a, rm, du, dw), shade(st, tone * K), Math.PI / 2 - a);
    }
    b.box('glow', 0.3, 0.06, 0.3, PX(a, rm, 1.35, 0.4), yTop + 0.035, PZ(a, rm, 1.35, 0.4), shade(gl, G), Math.PI / 2 - a);
    motifs++;
  }
  b.kit(kit + '.cloudMotif', motifs, yTop + 0.03);

  // 一圈：望柱（每 4m，顶带柱头）+ 上下两道寻杖 + 石灯（每 20m）
  const rRail = rOut - 0.42;
  const nP = Math.max(8, Math.round((Math.PI * 2 * rRail) / 4));
  let posts = 0;
  for (let k = 0; k < nP; k++) {
    const a = (k / nP) * Math.PI * 2;
    if (cut(a, rRail)) continue;
    b.box('ash', 0.34, 1.12, 0.34, PX(a, rRail, 0, 0), yTop + 0.56, PZ(a, rRail, 0, 0), shade(st, 1.06 * K), -a);
    b.box('ash', 0.46, 0.13, 0.46, PX(a, rRail, 0, 0), yTop + 1.19, PZ(a, rRail, 0, 0), shade(st, 1.16 * K), -a);
    posts++;
  }
  for (let k = 0; k < nP; k++) {
    const a = ((k + 0.5) / nP) * Math.PI * 2;
    if (cut(a, rRail)) continue;
    for (const yy of [yTop + 1.02, yTop + 0.6]) {
      b.box('ash', 4.4, 0.12, 0.14, PX(a, rRail, 0, 0), yy, PZ(a, rRail, 0, 0), shade(st, 1.02 * K), Math.PI / 2 - a);
    }
  }
  b.kit(kit + '.edgeRail', posts, yTop + 0.6);
  const nl = o.lamps ?? 0, rL = rOut - 1.15;
  let lamps = 0;
  for (let k = 0; k < nl; k++) {
    const a = ((k + 0.5) / nl) * Math.PI * 2;
    if (cut(a, rL)) continue;
    const lx = PX(a, rL, 0, 0), lz = PZ(a, rL, 0, 0);
    b.box('ash', 0.8, 0.22, 0.8, lx, yTop + 0.11, lz, shade(st, 1.0 * K), -a);
    b.box('ash', 0.34, 1.0, 0.34, lx, yTop + 0.72, lz, shade(st, 0.92 * K), -a);
    b.box('ash', 0.54, 0.12, 0.54, lx, yTop + 1.3, lz, shade(st, 1.1 * K), -a);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('ash', 0.09, 0.52, 0.09, lx + sx * 0.25, yTop + 1.62, lz + sz * 0.25, shade(st, 1.02 * K));
    b.box('glow', 0.44, 0.42, 0.44, lx, yTop + 1.62, lz, shade(gl, G));
    b.pyramid('ash', 0.14, 0.66, lx, yTop + 2.0, lz, shade(st, 1.12 * K), 0, 1, 0.36, 1);
    b.box('ash', 0.1, 0.14, 0.1, lx, yTop + 2.2, lz, shade(st, 1.24 * K));
    lamps++;
  }
  b.kit(kit + '.stoneLamp', lamps, yTop + 1.6);

  // 三圈：云海石护栏（栏板 + 压顶，压在铺装外缘下方）+ 云头（三段卷云块 + 弱光）
  let panels = 0;
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * Math.PI * 2;
    const rr = rOut + 0.15;
    if (cut(a, rr)) continue;
    b.box('ash', 4.3, 0.94, 0.3, PX(a, rr, 0, 0), yTop - 0.53, PZ(a, rr, 0, 0), shade(st, (0.88 + (k % 2) * 0.07) * K), Math.PI / 2 - a);
    b.box('ash', 4.3, 0.16, 0.52, PX(a, rr, 0, 0), yTop - 0.02, PZ(a, rr, 0, 0), shade(st, 1.04 * K), Math.PI / 2 - a);
    panels++;
  }
  b.kit(kit + '.cloudParapet', panels, yTop - 0.5);
  const nh = o.heads ?? 0;
  let heads = 0;
  for (let k = 0; k < nh; k++) {
    const a = ((k + 0.25) / nh) * Math.PI * 2;
    const rr = rOut + 0.5;
    if (cut(a, rr)) continue;
    b.box('ash', 1.7, 0.3, 0.56, PX(a, rr, 0, 0), yTop + 0.3, PZ(a, rr, 0, 0), shade(st, 1.08 * K), Math.PI / 2 - a);
    b.box('ash', 1.05, 0.26, 0.44, PX(a, rr, 0.35, 0.42), yTop + 0.62, PZ(a, rr, 0.35, 0.42), shade(st, 1.12 * K), Math.PI / 2 - a + 0.3);
    b.box('ash', 0.62, 0.22, 0.34, PX(a, rr, 0.72, 0.78), yTop + 0.92, PZ(a, rr, 0.72, 0.78), shade(st, 1.18 * K), Math.PI / 2 - a + 0.62);
    b.box('glow', 0.3, 0.22, 0.3, PX(a, rr, 0.2, 0.2), yTop + 0.5, PZ(a, rr, 0.2, 0.2), shade(gl, G));
    heads++;
  }
  b.kit(kit + '.cloudHead', heads, yTop + 0.6);

  // 平座承托：外缘向内的须弥座斜面（6m 悬挑不能凭空浮着）
  const fh = o.fascia ?? 1.6;
  b.cyl('ash', rOut, rIn * 0.985, fh, 44, cx, yTop - 0.3 - fh / 2, cz, shade(st, 0.84 * K));
  b.kit(kit + '.apronFascia', 1, yTop - 0.3 - fh / 2);
  // 廊柱：副阶悬在下层台面之上时，柱位与望柱同位落地（将台悬在斗法云台上方 8m）
  if (o.pier !== undefined) {
    const py0 = o.pier, hg = yTop - 0.3 - py0 - 0.3;
    let piers = 0;
    for (let k = 0; k < nP; k++) {
      const a = (k / nP) * Math.PI * 2;
      if (cut(a, rRail)) continue;
      b.box('ash', 0.44, 0.3, 0.44, PX(a, rRail, 0, 0), py0 + 0.15, PZ(a, rRail, 0, 0), shade(st, 0.8 * K), -a);
      b.box('ash', 0.3, hg, 0.3, PX(a, rRail, 0, 0), py0 + 0.3 + hg / 2, PZ(a, rRail, 0, 0), shade(st, 0.92 * K), -a);
      piers++;
    }
    b.kit(kit + '.edgePier', piers, py0);
  }
  if (o.step) {
    for (let k = 0; k < 3; k++) b.box('ash', 9, 0.16, 0.62, cx, yTop + 0.28 - k * 0.14, cz + rIn + 0.31 + k * 0.62, shade(st, (1.02 + k * 0.02) * K));
    b.kit(kit + '.apronStep', 3, yTop + 0.2);
  }
}

// 瑶池水榭（B6 补建 10 卷 spec (150,206,20)：主亭莲井+鲛绡帷+九曲桥+石榴）
export function buildYaochi(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const cx = 150, cz = 20, wy = 206;
  b.cyl('glow', 24, 24, 0.3, 28, cx, wy + 0.1, cz, shade(0x7fffd4, 0.45), 0, 0, 0, true);
  b.cyl('wall', 25, 24.6, 0.5, 28, cx, wy + 0.2, cz, shade(0xf2efe9, 1.0), 0, 0, 0, true);
  // 池底（水面下 0.8m，earth 泥底，避免池内出现 ash/ground 白面）+ 水面
  // 上两圈都是 open 圆筒（只有侧壁无顶盖），旧版俯视会直接透到 200m 下人间地面
  b.cyl('earth', 24.9, 24.9, 0.5, 28, cx, 205.2, cz, 0x16261f);
  b.cyl('water', 23.8, 23.8, 0.16, 36, cx, 206.17, cz, 0x124456);
  // 水榭水中台：柱脚止于 208.2，补水后旧版「红柱悬在水面上」暴露
  b.cyl('ceramic', 9.2, 9.8, 2.06, 16, cx, 207.23, cz, 0x2a4442);
  for (const px of [-7, -3.5, 0, 3.5, 7]) for (const pz of [-3, 3]) b.cyl('wood', 0.22, 0.26, 4.2, 8, cx + px, wy + 4.3, cz + pz, 0xc3272b);
  // W23：额枋由 0.4 加到 0.9（密排斗栱要有落脚面）；檐口由 18.6×9 外扩到 20.6×10.2——
  //   旧檐口只比额枋宽 0.09，斗栱一出挑 0.85 就捅穿封板；外扩后檐口 9.51×4.71，
  //   昂嘴 9.35/4.60 仍落在檐内（水榭是 tiers=1：不叠檐，只加密排斗栱 + 彩画带）。
  b.box('wood', 17, 0.9, 7.5, cx, wy + 6.35, cz, shade(GOLD_TRIM, 1.05));
  skyDougongRing(b, cx, wy + 6.8, cz, 17, 7.5, 0, 1.2, GOLD_TRIM); // 40 攒
  skyCaihuaBand(b, cx, wy + 6.35, cz, 17, 7.5, 0);
  // W17：水榭改歇山（收山 + 山花 + 山花下沿戗脊）
  skyRoofOn(b, cx, wy + 6.8, cz, 20.6, 10.2, 2.35, 0, 'xieshan', shade(0x5c6878, 1.06), GOLD_TRIM);
  b.box('glow', 4.2, 0.3, 4.2, cx, wy + 5.9, cz, shade(0x1e3a5f, 1.15));
  b.cyl('glow', 0.9, 1.3, 0.6, 8, cx, wy + 5.6, cz, GOLD);
  for (let k = 0; k < 8; k++) { const a = k * 0.785; b.box('glow', 0.07, 0.5, 0.07, cx + Math.cos(a) * 1.0, wy + 5.35, cz + Math.sin(a) * 1.0, k % 2 ? GOLD : 0xffb7c5); }
  for (let k = 0; k < 8; k++) b.box('glow', 0.8, 4.0, 0.05, cx - 7.7 + k * 2.2, wy + 4.2, cz + 3.4, shade(0xfffdf5, 0.55));
  for (let k = 0; k < 3; k++) {
    const bx = cx - 24 + k * 9.6;
    b.box('wall', 10, 0.24, 2.2, bx, wy + 0.5, cz + 8 + (k % 2) * 3.5, shade(0xf2efe9, 1.02), k % 2 ? 0.35 : -0.2);
    b.box('glow', 9.6, 0.07, 0.07, bx, wy + 1.15, cz + 8 + (k % 2) * 3.5, GOLD2);
  }
  // W25：水榭四面补坐凳栏杆（旧版是十根孤柱立在水台上，柱间全空，读成「凉棚」）——
  //   凳面 0.46 / 靠背寻杖 0.94 挂在柱间，南面正中留 2.2m 上桥口；柱脚 208.20，栏杆坐在台面 208.26。
  benchRailRect(b, cx, cz, 7, 3, 208.26, 's', 2.2, shade(0xa63a2b, 1.02));
  // W25：池东岸补四角攒尖亭（10 卷「瑶池亭榭」缺亭：旧版整片瑶池只有一座水榭与三块桥板）
  //   台基 6.4×6.4 坐在池岸石环（r 24.8–33.2）上、避让压边石 r32.4 与环上 24 望柱 r32.2；
  //   亭心 r=29、方位 a=0.9（东南岸），与石榴（162,47.2）净距 7.5m。
  cornerPavilion(b, 168.03, 206.95, 42.72, 1.9);

  // ---- 瑶池池岸（旧版是一枚空水盘：池岸石环/望柱寻杖/蟠桃/仙鹤瑞兽/石桌香炉一次补齐） ----
  const BY = 206.95; // 池岸石面标高（水面 206.25，岸高 0.7）
  // 池岸石环：28 段楔石（外径 33 / 内径 25），压在原 25 半径的薄池沿上
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    b.box('ash', 7.9, 0.6, 8.4, cx + Math.cos(a) * 29, BY - 0.3, cz + Math.sin(a) * 29, shade(0xb8b2a4, 0.94 + (k % 3) * 0.04), Math.PI / 2 - a);
  }
  b.kit('yaochi.bank', 28, BY - 0.3);
  // 岸顶压边石
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2 + 0.055;
    b.box('ash', 8.1, 0.12, 1.5, cx + Math.cos(a) * 32.4, BY + 0.06, cz + Math.sin(a) * 32.4, shade(0xd8d0c0, 1.02), Math.PI / 2 - a);
  }
  b.kit('yaochi.bankEdge', 28, BY + 0.06);
  // 池岸栏杆：24 望柱（西南 2.45–3.0 rad 留九曲桥桥口）+ 上下两道寻杖
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    if (a > 2.45 && a < 3.0) continue;
    const px = cx + Math.cos(a) * 32.2, pz = cz + Math.sin(a) * 32.2;
    b.box('ash', 0.34, 1.06, 0.34, px, BY + 0.53, pz, shade(0xd8d0c0, 1.04), -a);
    b.box('ash', 0.44, 0.12, 0.44, px, BY + 1.12, pz, shade(0xd8d0c0, 1.14), -a);
    b.kit('yaochi.bankRail', 1, BY + 0.53);
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + Math.PI / 24;
    if (a > 2.45 && a < 3.0) continue;
    for (const yy of [BY + 0.94, BY + 0.5]) {
      b.box('ash', 8.6, 0.13, 0.13, cx + Math.cos(a) * 32.2, yy, cz + Math.sin(a) * 32.2, shade(0xd8d0c0, 1.06), Math.PI / 2 - a);
    }
    b.kit('yaochi.bankRailBeam', 2, BY + 0.72);
  }
  // 蟠桃树（重做）：干分三段收分 → 3 主枝 → 8 团球冠 → 花簇 → 桃实 → 树下落花
  // 旧版是"三个粉圆锥叠在木棍上"，远看像路灯罩，根本不是树。
  const peach = (a: number, rr: number, s: number): void => {
    const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    const lean = 0.05 + (a % 0.7) * 0.04;
    // 干：三段收分 + 微倾（real tree 不是直棍）
    b.cyl('trunk', 0.17 * s, 0.30 * s, 0.9 * s, 7, px, BY + 0.45 * s, pz, 0x6b4a2e, 0, 0, lean * 0.3);
    b.cyl('trunk', 0.11 * s, 0.17 * s, 0.95 * s, 7, px + lean * 0.4 * s, BY + 1.35 * s, pz, 0x5f4129, 0, 0, lean * 0.7);
    b.cyl('trunk', 0.06 * s, 0.11 * s, 0.85 * s, 6, px + lean * 0.9 * s, BY + 2.2 * s, pz, 0x553a25, 0, 0, lean);
    // 根盘
    b.cyl('trunk', 0.34 * s, 0.5 * s, 0.22 * s, 8, px, BY + 0.11 * s, pz, 0x5a3e28);
    // 3 主枝：向上外张，带俯仰
    for (let k = 0; k < 3; k++) {
      const ba = a + (k / 3) * Math.PI * 2 + 0.4;
      const by = BY + (2.3 + k * 0.25) * s;
      b.cyl('trunk', 0.035 * s, 0.075 * s, 1.15 * s, 5,
        px + Math.cos(ba) * 0.42 * s, by, pz + Math.sin(ba) * 0.42 * s, 0x5a3f28,
        -ba, Math.cos(ba) * 0.5, -Math.sin(ba) * 0.5);
    }
    // 冠：8 团圆球（叶团），三层错落；深浅两档绿
    const clumps: [number, number, number, number][] = [
      [0, 3.45, 0, 1.35], [1.15, 3.15, 0.25, 1.05], [-1.05, 3.2, 0.45, 1.0],
      [0.35, 3.1, -1.1, 0.95], [-0.5, 3.35, -0.85, 0.9], [0.85, 3.9, 0.55, 0.8],
      [-0.7, 3.95, -0.3, 0.78], [0.1, 4.35, 0.15, 0.66],
    ];
    clumps.forEach(([ox, oy, oz, r], i) => {
      const c = i % 2 === 0 ? 0x3f6a3c : 0x4a7a44;
      b.sphere('leaf', r * s, 8, px + ox * s, BY + oy * s, pz + oz * s, shade(c, 0.94 + (i % 3) * 0.06));
    });
    // 花簇：冠缘 10 团淡粉（不是发光块，是实体花球）
    for (let k = 0; k < 10; k++) {
      const fa = (k / 10) * Math.PI * 2 + a;
      const fr = (1.25 + (k % 3) * 0.22) * s;
      b.sphere('leaf', 0.3 * s, 6,
        px + Math.cos(fa) * fr, BY + (3.1 + (k % 4) * 0.32) * s, pz + Math.sin(fa) * fr, 0xe8a6bc);
    }
    // 桃实：6 枚垂在冠下（粉里透黄，带小高光）
    for (let k = 0; k < 6; k++) {
      const fa = (k / 6) * Math.PI * 2 + a * 1.7;
      const fxx = px + Math.cos(fa) * 1.05 * s, fzz = pz + Math.sin(fa) * 1.05 * s;
      const fyy = BY + (2.55 + (k % 3) * 0.28) * s;
      b.sphere('leaf', 0.19 * s, 6, fxx, fyy, fzz, 0xe0738e);
      b.sphere('glow', 0.07 * s, 5, fxx + 0.06 * s, fyy + 0.1 * s, fzz, 0xffd0dc);
    }
    // 树下落花：一圈 8 片
    for (let k = 0; k < 8; k++) {
      const fa = (k / 8) * Math.PI * 2;
      b.box('leaf', 0.16 * s, 0.02, 0.1 * s, px + Math.cos(fa) * rr * 0.12, BY + 0.03, pz + Math.sin(fa) * rr * 0.12, 0xe8b0c4, fa, 0, 0);
    }
    b.kit('yaochi.peachTree', 1, BY + 2.4 * s);
  };
  // 仙鹤（静态）：双腿 + 身 + 背羽 + 折颈 + 头 + 丹顶 + 喙 + 尾羽
  const crane = (a: number, rr: number, ry: number): void => {
    const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    const ca = Math.cos(ry), sa = Math.sin(ry);
    const lx = (d: number): number => px + ca * d;
    const lz = (d: number): number => pz + sa * d;
    for (const s2 of [-1, 1]) {
      b.cyl('metal', 0.05, 0.06, 0.78, 5, px - sa * s2 * 0.14, BY + 0.39, pz + ca * s2 * 0.14, shade(0x4a4450, 1.12));
    }
    b.box('ash', 0.95, 0.36, 0.42, px, BY + 0.96, pz, 0xf2efe9, ry);
    b.box('ash', 0.5, 0.2, 0.34, lx(0.06), BY + 1.18, lz(0.06), 0xfffdf5, ry);
    b.box('ash', 0.15, 0.58, 0.15, lx(0.58), BY + 1.32, lz(0.58), 0xf8f6f0, ry, 0, -0.28);
    b.box('ash', 0.34, 0.16, 0.16, lx(0.76), BY + 1.58, lz(0.76), 0xf8f6f0, ry);
    b.box('glow', 0.1, 0.1, 0.09, lx(0.76), BY + 1.69, lz(0.76), 0xff3a4a, ry);
    b.box('metal', 0.16, 0.05, 0.05, lx(0.97), BY + 1.56, lz(0.97), 0xc8a848, ry);
    b.box('ash', 0.44, 0.52, 0.2, lx(-0.6), BY + 1.0, lz(-0.6), 0xe8e3d5, ry, 0, 0.5);
    b.kit('yaochi.crane', 1, BY + 1.1);
  };
  // 瑞兽（静态石兽）：须弥座 + 身 + 四腿 + 头 + 鬃 + 尾
  const beast = (a: number, rr: number, ry: number): void => {
    const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    const ca = Math.cos(ry), sa = Math.sin(ry);
    b.box('ash', 1.6, 0.34, 0.96, px, BY + 0.17, pz, shade(0x9a948c, 1.02), ry);
    b.box('ash', 0.98, 0.62, 0.56, px, BY + 0.86, pz, shade(0x8a8478, 1.06), ry);
    for (const sd of [-1, 1]) for (const fz of [-0.34, 0.34]) {
      b.box('ash', 0.2, 0.42, 0.2, px + ca * sd * 0.34 - sa * fz, BY + 0.5, pz + sa * sd * 0.34 + ca * fz, shade(0x8a8478, 0.98), ry);
    }
    b.box('ash', 0.46, 0.52, 0.5, px + ca * 0.56, BY + 1.36, pz + sa * 0.56, shade(0x9a948c, 1.06), ry);
    for (let k = 0; k < 3; k++) b.box('ash', 0.14, 0.2, 0.42, px + ca * (0.34 - k * 0.2), BY + 1.62, pz + sa * (0.34 - k * 0.2), shade(0x7a7468, 1.04), ry);
    b.box('ash', 0.5, 0.16, 0.16, px - ca * 0.66, BY + 1.06, pz - sa * 0.66, shade(0x8a8478, 1.04), ry, 0, 0.42);
    b.box('glow', 0.1, 0.08, 0.06, px + ca * 0.78, BY + 1.42, pz + sa * 0.78, 0xffd25e, ry);
    b.kit('yaochi.beast', 1, BY + 0.86);
  };
  // 石桌石凳（亭榭前）
  const stoneSet = (a: number, rr: number): void => {
    const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    b.cyl('ash', 0.62, 0.72, 0.14, 8, px, BY + 0.07, pz, shade(0xb8b2a4, 1.02));
    b.cyl('ash', 0.3, 0.42, 0.8, 8, px, BY + 0.44, pz, shade(0xc8c0b0, 1.02));
    b.cyl('ash', 0.9, 0.9, 0.12, 10, px, BY + 0.88, pz, shade(0xd8d0c0, 1.0));
    for (let k = 0; k < 4; k++) {
      const sa2 = a + (k * Math.PI) / 2 + Math.PI / 4;
      const sx4 = px + Math.cos(sa2) * 1.55, sz4 = pz + Math.sin(sa2) * 1.55;
      b.cyl('ash', 0.3, 0.28, 0.44, 8, sx4, BY + 0.22, sz4, shade(0xc8c0b0, 1.04));
      b.cyl('ash', 0.36, 0.34, 0.1, 8, sx4, BY + 0.49, sz4, shade(0xd8d0c0, 1.06));
    }
    b.cyl('metal', 0.18, 0.14, 0.22, 8, px, BY + 1.05, pz, 0x8a6a2e);
    b.cyl('glow', 0.05, 0.04, 0.16, 5, px, BY + 1.23, pz, 0xffb300);
    b.kit('yaochi.stoneTable', 1, BY + 0.88);
  };
  // 铜香炉（亭榭前独立一尊）
  const censer = (a: number, rr: number): void => {
    const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    b.cyl('ash', 0.62, 0.72, 0.3, 8, px, BY + 0.15, pz, shade(0xc8c0b0, 0.98));
    for (let k = 0; k < 3; k++) {
      const a2 = k * 2.094 + 0.5;
      b.cyl('metal', 0.09, 0.11, 0.5, 6, px + Math.cos(a2) * 0.32, BY + 0.5, pz + Math.sin(a2) * 0.32, 0x7a6230);
    }
    b.cyl('metal', 0.46, 0.38, 0.62, 12, px, BY + 1.05, pz, 0x8a6a2e);
    b.cyl('metal', 0.5, 0.5, 0.08, 12, px, BY + 1.4, pz, 0xb08a3c);
    b.cyl('metal', 0.34, 0.46, 0.34, 12, px, BY + 1.6, pz, 0x8a6a2e);
    for (const s2 of [-1, 1]) b.box('metal', 0.12, 0.3, 0.08, px + s2 * 0.4, BY + 1.42, pz, 0xb08a3c, 0, 0, s2 * 0.35);
    b.cyl('glow', 0.16, 0.1, 0.34, 6, px, BY + 1.9, pz, 0xffb300, 0, 0, 0, true);
    b.kit('yaochi.censer', 1, BY + 1.05);
  };
  // 布点全部落在相机可见的西北—北弧（a≈3.0–5.5），避开西南桥口与南侧四株石榴
  peach(3.35, 29.2, 1); peach(4.0, 29.4, 1.08); peach(5.05, 29.0, 0.94);
  crane(3.7, 30.6, 2.3); crane(4.15, 30.4, 1.2); crane(5.25, 30.2, 4.1);
  beast(3.05, 30.4, 2.6); beast(5.5, 30.0, 0.4);
  stoneSet(4.45, 29.6);
  censer(4.9, 29.2);
  // 池面莲叶 24 片（避开主亭柱位），破一片空水
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.21;
    const rr = 8 + ((k * 7) % 13);
    const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    const sz2 = 0.6 + ((k * 5) % 5) * 0.14;
    b.cyl('leaf', sz2, sz2, 0.04, 7, px, 206.28, pz, shade(0x3f7a52, 0.9 + (k % 3) * 0.12), a);
    if (k % 5 === 0) b.cyl('glow', 0.12, 0.1, 0.22, 6, px, 206.42, pz, 0xffb7c5);
  }
  b.kit('yaochi.lotusPad', 24, 206.28);
  for (let k = 0; k < 4; k++) {
    const sx3 = cx - 12 + k * 8;
    // 石榴四株迁到池岸环上（旧版浮在池面 r≈21 的水上）
    b.cyl('trunk', 0.16, 0.26, 2.8, 5, sx3, BY + 1.4, cz + 27.2, shade(0x6a5a4a, 1.1));
    b.cyl('leaf', 1.0, 1.6, 1.8, 6, sx3, BY + 2.9, cz + 27.2, shade(0xff7f50, 0.85));
    b.box('glow', 0.12, 0.12, 0.12, sx3 + 0.7, BY + 2.6, cz + 27.2, 0xffb7c5);
  }
  b.kit('yaochi.pomegranate', 4, BY + 1.4);
  // WS-20：瑶池外缘三圈（6m 云纹铺装带 / 望柱寻杖 + 石灯 / 云海石护栏 + 云头）
  // 让开瑶池宫玉盘（204,20 r≈21.3）与西南九曲桥口 a∈[2.3,3.12]
  buildCloudTerrace(b, {
    cx, cz, rIn: 33.15, rOut: 39.15, yTop: 206.72, kit: 'yaochi',
    stone: 0xd8d0c0, paving: 0x5e5870, joint: 0x3a3546, glowC: 0x7fffd4,
    skip: (a, qx, qz) => (a > 2.3 && a < 3.12) || Math.hypot(qx - 204, qz - 20) < 23.4,
    lamps: 12, heads: 12, fascia: 1.1, stoneK: 0.8, glowK: 0.5,
  });
  sg.quad(atlas.text('yaochi', '瑤池', 200, 64, { color: '#ffe9b8', glow: '#ffd25e', fontPx: 52, bg: 'rgba(12,8,4,0.88)' }), 3.4, 1.1, cx, wy + 8.0, cz + 4.4, 0);
}

// ============ B6 余项：御膳房/天库/武库/巡天将台（10 卷 §2.2） ============
export function buildTianfuAnnex(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  // 御膳房（75,206,70）：全院 30×22 + 九眼聚灵灶×3 + 醒神茶树行（后园）
  platform2(b, 75, 206, 70, 15);
  b.box('wall', 12, 3.8, 8, 75, 206 + 1.9, 70, shade(0xc8c0b0, 1.0));
  skyRoofOn(b, 75, 206 + 4.1, 70, 13.6, 9.4, 2.33, 0, 'xieshan', shade(0x5c6878, 0.96), GOLD_TRIM); // W17 膳房：歇山
  // W25：御膳房补檐柱 + 额枋 + 斗栱；+z 侧（灶间）不立柱——三灶列就摆在那面檐下，立柱会插进灶膛
  eaveFrame(b, 75, 70, 12, 8, 206, 206 + 4.1, 0.6, 1);
  for (let k = 0; k < 3; k++) { // 三灶列（W25：北墙 74 与旧灶膛 73.3 重叠 0.7m → 灶膛收到 74.1×75.7，灶眼移到北面可见）
    const kx = 69.5 + k * 5.5;
    b.box('wall', 3.2, 1.4, 1.6, kx, 206 + 0.7, 74.9, 0x5a6472);
    for (let e = 0; e < 3; e++) b.cyl('glow', 0.3, 0.3, 0.12, 8, kx - 0.9 + e * 0.9, 207.45, 75.72, 0xff7f50); // 九眼意象/灶
  }
  for (let k = 0; k < 6; k++) { b.cyl('trunk', 0.1, 0.14, 1.2, 5, 66 + k * 2.4, 206 + 0.6, 77.5, shade(0x6a5a4a, 1.1)); b.cyl('leaf', 0.5, 0.8, 0.9, 5, 66 + k * 2.4, 207.4, 77.5, shade(0xd8e8c8, 1.0)); } // 醒神茶树
  sg.quad(atlas.text('tianchu', '天廚', 160, 64, { color: '#ffe9b8', glow: '#ffd25e', fontPx: 46, bg: 'rgba(12,8,4,0.88)' }), 2.6, 1.0, 75, 206 + 5.2, 74.6, 0);
  // 天库（-75,207,75）：灵晶匣×9 + 夜明珠×6 恒亮 + 仙衡天平（赵公明驻守列 B9）
  platform2(b, -75, 207, 75, 13);
  b.box('wall', 11, 4.2, 7.5, -75, 207 + 2.1, 75, shade(0xc8c0b0, 0.98));
  skyRoofOn(b, -75, 207 + 4.5, 75, 12.6, 8.8, 2.21, 0, 'xieshan', shade(0x5c6878, 0.92), GOLD_TRIM); // W17 天库：歇山
  // W25：天库补檐柱列 + 额枋 + 斗栱（台明由 realm 的 26×20 院落台明承担，这里不再叠台基）
  eaveFrame(b, -75, 75, 11, 7.5, 207, 207 + 4.5, 0.55);
  for (let k = 0; k < 9; k++) b.box('glow', 0.6, 0.4, 0.4, -79.5 + (k % 3) * 4.4, 207 + 1.4, 73 + Math.floor(k / 3) * 2.2, shade(0x7fffd4, 0.7)); // 灵晶通货匣
  for (let k = 0; k < 6; k++) b.box('glow', 0.24, 0.24, 0.24, -73.4 + k * 1.4, 207 + 4.6, 78.2, 0xfff3d8); // 夜明珠恒亮一列
  b.box('wood', 0.12, 1.6, 0.12, -75, 207 + 1.6, 71.5, shade(GOLD_TRIM, 1.2)); b.box('wood', 1.4, 0.08, 0.08, -75, 207 + 2.35, 71.5, shade(GOLD_TRIM, 1.2)); // 仙衡天平
  sg.quad(atlas.text('tianku', '天庫', 160, 64, { color: '#ffe9b8', glow: '#ffd25e', fontPx: 46, bg: 'rgba(12,8,4,0.88)' }), 2.6, 1.0, -75, 207 + 5.6, 79.6, 0);
  // 武库（-75,206,15）：甲胄架×6 + 月牙戟长架×2 + 战鼓×2 + 火字令旗×8
  platform2(b, -75, 206, 15, 14);
  b.box('wall', 13, 5, 9, -75, 206 + 2.5, 15, shade(0x5a6472, 1.05));
  // 立面：13×5×9 的灰砖盒旧版正脸无门无窗，远看就是一整块大灰砖。
  // 补中央板门（暗腔 + 朱扉 + 门钉 + 门楣）与两侧槛窗（木框 + 直棂 + 石窗台）。
  {
    const y0 = 206, zf = 19.5;
    b.box('lacquer', 3.4, 4.0, 0.2, -75, y0 + 2.0, zf + 0.04, 0x241a18);
    for (const s of [-1, 1]) {
      b.box('lacquer', 1.62, 3.8, 0.18, -75 + s * 0.86, y0 + 1.92, zf + 0.16, shade(0x7a1f1a, 1.04));
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
        b.box('metal', 0.13, 0.13, 0.07, -75 + s * (0.46 + c * 0.8), y0 + 0.7 + r * 0.85, zf + 0.27, GOLD_TRIM);
      }
    }
    b.box('wood', 4.0, 0.32, 0.34, -75, y0 + 4.12, zf + 0.12, shade(0x4a3220, 1.1));
    for (const s of [-1, 1]) {
      const wx = -75 + s * 4.6;
      b.box('wood', 2.0, 1.8, 0.16, wx, y0 + 3.1, zf + 0.1, shade(0x4a3220, 1.0));
      b.box('glow', 1.72, 1.52, 0.05, wx, y0 + 3.1, zf + 0.2, shade(0xffc66e, 0.5));
      for (let k = 1; k < 4; k++) b.box('wood', 0.07, 1.52, 0.07, wx - 0.86 + (1.72 * k) / 4, y0 + 3.1, zf + 0.24, shade(0x4a3220, 0.9));
      b.box('ash', 2.24, 0.14, 0.36, wx, y0 + 2.13, zf + 0.12, 0xb4b0a8);
    }
    b.kit('sky.wuku.door', 1, y0 + 2.0);
    b.kit('sky.wuku.window', 2, y0 + 3.1);
    // 东西山面各两樘同制窗：只做正脸的话，侧看仍是两块光板
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const wz = 15 - 2.4 + k * 4.8;
        const wx = -75 + s * 6.51;
        b.box('wood', 0.16, 1.8, 2.0, wx, y0 + 3.1, wz, shade(0x4a3220, 1.0));
        b.box('glow', 0.05, 1.52, 1.72, wx + s * 0.1, y0 + 3.1, wz, shade(0xffc66e, 0.5));
        for (let m = 1; m < 4; m++) b.box('wood', 0.07, 1.52, 0.07, wx + s * 0.14, y0 + 3.1, wz - 0.86 + (1.72 * m) / 4, shade(0x4a3220, 0.9));
        b.box('ash', 0.36, 0.14, 2.24, wx + s * 0.02, y0 + 2.13, wz, 0xb4b0a8);
        b.kit('sky.wuku.window', 1, y0 + 3.1);
      }
    }
  }
  skyRoofOn(b, -75, 206 + 5.3, 15, 14.6, 10.4, 2.53, 0, 'wudian', shade(0x333a45, 1.12), GOLD_TRIM); // W17 武库：庑殿
  // W25：武库补檐柱列 + 额枋 + 斗栱（13×9 厚墙，柱列落在院落台明上）
  eaveFrame(b, -75, 15, 13, 9, 206, 206 + 5.3, 0.58);
  for (let k = 0; k < 6; k++) { b.box('wood', 0.16, 2.6, 0.16, -80.5 + k * 2.2, 206 + 1.3, 11.6, 0x3a4e6a); b.box('glow', 0.3, 0.2, 0.06, -80.5 + k * 2.2, 206 + 2.3, 11.7, shade(GOLD_TRIM, 0.8)); } // 甲胄架+甲光
  for (const sx of [-1, 1]) { b.box('wood', 0.2, 0.2, 7.5, -75 + sx * 4.8, 206 + 1.9, 11.8, 0x6b4a2b); for (let k = 0; k < 6; k++) b.box('wood', 0.06, 3.0, 0.06, -75 + sx * 4.8, 206 + 2.6, 8.5 + k * 1.2, shade(0xb8c0c8, 0.9), 0, 0, 0.06); } // 月牙戟长架×2（每架意象 18 杆列 6）
  for (const sx of [-1, 1]) b.cyl('wood', 0.8, 0.8, 1.1, 10, -75 + sx * 5.6, 206 + 0.6, 18.4, 0xa63a2b); // 战鼓×2
  for (let k = 0; k < 8; k++) b.box('glow', 0.3, 1.6, 0.05, -78.4 + k * 2.4, 206 + 2.2, 19.2, k % 2 ? 0xff7f50 : 0xa63a2b); // 火字令旗×8
  sg.quad(atlas.text('wuku', '武庫', 160, 64, { color: '#d8f2ff', glow: '#00e5ff', fontPx: 46, bg: 'rgba(8,10,16,0.88)' }), 2.6, 1.0, -75, 206 + 6.4, 19.8, 0);
  // 巡天将台（22,206,-35）：台基 16×16 通高 7 + 旗杆 12m + 五方令旗（十幕大战指挥中枢）
  platform2(b, 22, 206, -35, 11);
  b.box('wall', 12, 4.2, 12, 22, 206 + 2.1, -35, shade(0x5a6472, 1.08));
  b.box('wall', 10, 2.8, 10, 22, 206 + 5.6, -35, shade(0x6a7480, 1.02));
  // 台身立面：12×4.2 + 10×2.8 两层灰砖旧版四面光板，远看就是两块灰砖。
  // 补正面（+z，匾额同面）门洞（暗腔 + 朱扉）、两侧箭窗（石框 + 暗孔），台身才有「将台」的读法。
  {
    const y0 = 206, zf = -28.95;
    b.box('lacquer', 2.8, 3.2, 0.24, 22, y0 + 1.6, zf + 0.02, 0x241a18);
    for (const s of [-1, 1]) b.box('lacquer', 1.26, 3.0, 0.16, 22 + s * 0.7, y0 + 1.55, zf + 0.12, shade(0x7a1f1a, 1.02));
    b.box('wood', 3.4, 0.28, 0.32, 22, y0 + 3.34, zf + 0.1, shade(0x4a3220, 1.05));
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        const sx = 22 + s * (2.7 + k * 1.0);
        b.box('ash', 0.62, 1.46, 0.2, sx, y0 + 2.7, zf + 0.04, 0x9a9282);
        b.box('lacquer', 0.42, 1.24, 0.2, sx, y0 + 2.7, zf + 0.1, 0x161214);
      }
      for (const s of [-1, 1]) {
        const sz = -35 - 3.0 + k * 2.0;
        b.box('ash', 0.2, 1.46, 0.62, 22 + s * 6.04, y0 + 2.7, sz, 0x9a9282);
        b.box('lacquer', 0.2, 1.24, 0.42, 22 + s * 6.1, y0 + 2.7, sz, 0x161214);
      }
    }
    // 上层同样开一排小箭窗（10×2.8 的灰体块，正面 -29+1=… 取 -24.98 即 +z 外皮外 0.02）
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) b.box('lacquer', 0.34, 0.9, 0.18, 22 + s * (1.4 + k * 1.5), y0 + 5.5, -29.98, 0x161214);
    }
    b.kit('sky.jiangtai.door', 1, y0 + 1.6);
    b.kit('sky.jiangtai.slit', 14, y0 + 2.7);
  }
  skyRoofOn(b, 22, 206 + 7.2, -35, 11.6, 11.6, 2.77, 0, 'wudian', shade(0x333a45, 1.18), GOLD_TRIM); // W17 将台：庑殿
  b.box('wood', 0.18, 12, 0.18, 22, 206 + 6.2, -28.6, shade(GOLD_TRIM, 1.15)); // 帅旗杆 12m
  b.box('glow', 1.8, 1.0, 0.06, 22, 206 + 11.2, -28.3, GOLD_LINE, 0, 0, 0.08); // 帅字旗
  for (let k = 0; k < 5; k++) { const a = -1.57 + (k - 2) * 0.5; b.box('glow', 0.4, 2.2, 0.06, 22 + Math.sin(a) * 5.6, 206 + 7.4, -35 + Math.cos(a) * 5.6, [GOLD_LINE, 0x00e5ff, 0xa63a2b, 0x4a8b6f, 0xdcdce8][k], 0, 0, a); } // 五方令旗
  sg.quad(atlas.text('jiangtaiT', '巡天將臺', 280, 68, { color: '#d8f2ff', glow: '#00e5ff', fontPx: 48, bg: 'rgba(8,10,16,0.9)' }), 4.2, 1.0, 22, 206 + 8.8, -23.6, 0);
  // W25：将台补须弥座（三层）+ 台顶望柱寻杖（每 2.2m 一根，北面让开 3.4m 踏道）+ 13 级北踏道。
  //   旧版只有 platform2 的一圈发光底盘，12×12 台身直接落在云上，四面没有栏杆也没有下山路。
  stoneTerrace(b, 22, 206.12, -35, 5.7, 5.7, 210.2, 'n');
  // ---- W25：天辅东侧补两层楼阁（楼：腰檐 / 平座 / 栏杆 / 楼梯口）----
  // 落点 (75,18)：凌霄台、瑶池、武库之间的一块空域；自带云台玉盘（platform2 r=12），
  //   与御膳房（75,70）、武库（-75,15）、瑶池（150,20）、将台（22,-35）最近净距均 > 50m。
  platform2(b, 75, 206, 18, 12);
  storeyTower(b, 75, 206.45, 18);
  // WS-43：御膳房 / 天库 / 武库 器物（三殿身均为实心盒，且平台只有发光环墙没有台面 → 逐件补云石承板，器物面 206.12 / 207.12）
  const pad = (px: number, pz: number, w: number, d: number, py: number): void => {
    b.box('ash', w, 0.12, d, px, py - 0.06, pz, shade(0xd8d0c0, 1.02));
    b.box('glow', w - 0.2, 0.02, d - 0.2, px, py + 0.01, pz, shade(0x9fe8ff, 0.3));
  };
  for (let k = 0; k < 3; k++) {
    pad(69.5 + k * 5.5, 76.0, 1.5, 1.16, 206.12);
    itmNineEyeStove(b, 69.5 + k * 5.5, 206.12, 76.0);                                 // T-ITM-0085 九眼聚灵灶×3（灶间）
  }
  pad(81.8, 79.8, 1.6, 1.3, 206.12);
  itmIceCoffer(b, 81.8, 206.12, 79.8, -0.34);                                        // T-ITM-0086 天材冰鉴（冰鉴房）
  for (const sx of [-1, 1]) pad(75 + sx * 4.6, 80.2, 1.0, 1.0, 206.12);
  itmJadeFoodRail(b, 75, 206.12, 80.2);                                              // T-ITM-0087 玉馔云台（院中架空灵脉光轨）
  pad(67.6, 80.4, 1.6, 0.8, 206.12);
  itmRecipeRack(b, 67.6, 206.12, 80.4, 0);                                           // T-ITM-0091 仙厨菜谱玉简×30（菜谱架）
  pad(-68.4, 75, 0.8, 3.6, 207.12);
  itmNightPearlNiche(b, -68.4, 207.12, 75, 0);                                       // T-ITM-0093 库藏夜明珠×6（宝库龛位）
  pad(-81.6, 75, 1.4, 2.4, 207.12);
  itmLedgerRack(b, -81.6, 207.12, 75, 0);                                            // T-ITM-0094 天庭库簿玉简×12（簿册房架）
  pad(-75, 68.0, 1.2, 1.2, 207.12);
  itmImmortalBalance(b, -75, 207.12, 68.0, 0);                                       // T-ITM-0096 仙衡天平（天平间）
  for (const sx of [-1, 1]) {
    pad(-75 + sx * 4.8, 24.0, 2.0, 1.9, 206.12);
    itmWuKuDrum(b, -75 + sx * 4.8, 206.12, 24.0);                                    // T-ITM-0101 战鼓×2（演武小院）
  }
}
function platform2(b: import('../city/bake').Baker, x: number, y: number, z: number, r: number): void {
  b.cyl('glow', r, r, 0.5, 10, x, y + 0.2, z, shade(0xdfeeff, 0.5), 0, 0, 0, true); // 云台承托
  // WS-46：发光环台原来底下是空的，补「玉盘 + 垂云 + 云团簇」底盘，与主云台同一套云海色系
  buildIslandSkirt(b, x, y, z, r, x * 1.3 + z * 2.1, 1.4, 0.8, 8);
}

// ============ WS-11：天宫四殿室内壳（灵霄·瑶池·蟠桃·星宿，8 间 ×4 = 32 间） ============
// 殿身外壳在 realm.ts 掏空（外轮廓逐面坐标尺寸不变），本段只做壳内：
// 地面 + 踢脚 + 隔断 + 槅扇门/支摘窗 + 天花 + 案几榻架柜灯香几 + 鼎炉磬卷匣
const HALL_Y = 214; // 天宫云台基面（与 realm.ts arena/palace/pantao 同基准，勿另立）

type Side = 'n' | 's' | 'e' | 'w';
type Put = (g: BGroup, len: number, hh: number, wid: number, u: number, yy: number, w: number, hex: number) => void;

/** 家具局部系：u 沿器物长向、w 沿进深向；ax=false 时整件绕 Y 转 90°（长向落到 z） */
function at(b: Baker, ax: boolean, x: number, z: number): Put {
  return (g, len, hh, wid, u, yy, w, hex) => {
    if (ax) b.box(g, len, hh, wid, x + u, yy, z + w, hex);
    else b.box(g, len, hh, wid, x + w, yy, z + u, hex, Math.PI / 2);
  };
}

/** 长案：翘头 + 云纹牙板 + 金线（供案/书案通用），案面 = y+1.09 */
function fDesk(b: Baker, x: number, y: number, z: number, len: number, ax: boolean, wood: number, accent: number): void {
  const P = at(b, ax, x, z);
  P('wood', len, 0.14, 0.86, 0, y + 1.02, 0, shade(wood, 1.05));
  P('wood', len + 0.3, 0.09, 1.0, 0, y + 1.13, 0, shade(wood, 1.2));
  for (const su of [-1, 1]) for (const sw of [-1, 1]) P('wood', 0.14, 1.0, 0.14, su * (len / 2 - 0.3), y + 0.5, sw * 0.3, shade(wood, 0.86));
  P('wood', len - 0.4, 0.12, 0.08, 0, y + 0.88, 0, shade(wood, 0.76));
  for (const sw of [-1, 1]) P('glow', len - 0.5, 0.05, 0.05, 0, y + 1.19, sw * 0.5, shade(accent, 0.8));
}

/** 几：独板面 + 三弯腿 + 托泥 */
function fJi(b: Baker, x: number, y: number, z: number, len: number, ax: boolean, wood: number, accent: number): void {
  const P = at(b, ax, x, z);
  P('wood', len, 0.09, 0.62, 0, y + 0.58, 0, shade(wood, 1.12));
  P('wood', len + 0.1, 0.05, 0.7, 0, y + 0.64, 0, shade(accent, 0.9));
  for (const su of [-1, 1]) for (const sw of [-1, 1]) P('wood', 0.09, 0.54, 0.09, su * (len / 2 - 0.12), y + 0.27, sw * 0.23, shade(wood, 0.88));
  for (const sw of [-1, 1]) P('wood', len - 0.2, 0.06, 0.06, 0, y + 0.42, sw * 0.24, shade(wood, 0.76));
}

/** 榻：榻身 + 苇席 + 靠背 + 隐囊；bs 指定靠背朝向（+1 = 靠 +w 侧） */
function fTa(b: Baker, x: number, y: number, z: number, len: number, wid: number, ax: boolean, bs: number, wood: number, cloth: number, accent: number): void {
  const P = at(b, ax, x, z);
  P('wood', len, 0.42, wid, 0, y + 0.21, 0, shade(wood, 0.94));
  P('wood', len - 0.1, 0.1, wid - 0.1, 0, y + 0.47, 0, shade(0xd4b76a, 0.86));
  P('fabric', len - 0.5, 0.22, wid * 0.4, 0, y + 0.56, -bs * wid * 0.18, cloth);
  P('wood', len, 0.5, 0.14, 0, y + 0.7, bs * (wid / 2 - 0.07), shade(wood, 1.06));
  P('glow', len - 0.2, 0.05, 0.05, 0, y + 0.92, bs * (wid / 2 - 0.14), accent);
  P('fabric', 0.44, 0.26, 0.44, -len / 2 + 0.5, y + 0.62, -bs * wid * 0.22, shade(cloth, 1.15));
  for (const su of [-1, 1]) P('wood', 0.12, 0.16, 0.12, su * (len / 2 - 0.1), y + 0.08, 0, shade(wood, 0.8));
}

/** 书格：四柱 + 三层格板 + 卷册 */
function fJia(b: Baker, x: number, y: number, z: number, len: number, ax: boolean, wood: number, paper: number, accent: number): void {
  const P = at(b, ax, x, z);
  for (const su of [-1, 1]) for (const sw of [-1, 1]) P('wood', 0.1, 2.5, 0.1, su * (len / 2 - 0.05), y + 1.25, sw * 0.2, shade(wood, 0.92));
  for (let k = 0; k < 3; k++) {
    P('wood', len, 0.07, 0.5, 0, y + 0.55 + k * 0.8, 0, shade(wood, 1.06));
    const n = Math.max(2, Math.floor(len / 0.55));
    for (let i = 0; i < n; i++) P('ceramic', len / n - 0.12, 0.16, 0.16, -len / 2 + (len / n) * (i + 0.5), y + 0.68 + k * 0.8, 0, i % 2 ? paper : shade(paper, 0.82));
  }
  P('glow', len - 0.2, 0.04, 0.04, 0, y + 2.46, 0.21, shade(accent, 0.85));
}

/** 柜：对开门 + 铜环 + 顶箱 */
function fGui(b: Baker, x: number, y: number, z: number, len: number, ax: boolean, wood: number, accent: number): void {
  const P = at(b, ax, x, z);
  P('wood', len, 2.0, 0.62, 0, y + 1.0, 0, shade(wood, 0.98));
  P('wood', len + 0.1, 0.14, 0.72, 0, y + 2.06, 0, shade(wood, 1.12));
  P('wood', len - 0.1, 0.28, 0.66, 0, y + 2.27, 0, shade(wood, 0.9));
  for (const su of [-1, 1]) {
    P('wood', len / 2 - 0.08, 1.7, 0.06, su * (len / 4), y + 1.0, 0.33, shade(wood, 1.08));
    P('metal', 0.1, 0.1, 0.1, su * 0.1, y + 1.0, 0.39, shade(accent, 0.9));
  }
  P('glow', len - 0.3, 0.04, 0.04, 0, y + 1.9, 0.34, shade(accent, 0.7));
}

/** 灯架：立柱 + 三叉横担 + 三盏纱灯 */
function fLamp(b: Baker, x: number, y: number, z: number, hh: number, wood: number, lamp: number): void {
  b.cyl('wood', 0.1, 0.13, hh, 6, x, y + hh / 2, z, shade(wood, 1.02));
  b.cyl('wood', 0.34, 0.28, 0.1, 8, x, y + 0.05, z, shade(wood, 0.7));
  b.cyl('wood', 0.16, 0.16, 0.1, 8, x, y + hh - 0.05, z, shade(wood, 0.86));
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.4;
    const dx = Math.cos(a) * 0.42, dz = Math.sin(a) * 0.42;
    b.box('wood', 0.06, 0.06, 0.5, x + dx * 0.5, y + hh - 0.16, z + dz * 0.5, shade(wood, 0.9), -a + Math.PI / 2);
    b.box('glow', 0.22, 0.3, 0.22, x + dx, y + hh - 0.42, z + dz, lamp);
    b.box('glow', 0.26, 0.05, 0.26, x + dx, y + hh - 0.24, z + dz, shade(lamp, 0.8));
  }
}

/** 香几：高束腰几 + 铜炉 + 香烟 */
function fIncense(b: Baker, x: number, y: number, z: number, hh: number, wood: number, metal: number, lamp: number): void {
  b.box('wood', 0.7, 0.09, 0.7, x, y + hh, z, shade(wood, 1.1));
  b.box('wood', 0.5, 0.22, 0.5, x, y + hh - 0.16, z, shade(wood, 0.86));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.09, hh - 0.1, 0.09, x + sx * 0.24, y + (hh - 0.1) / 2, z + sz * 0.24, shade(wood, 0.92));
  b.box('wood', 0.66, 0.06, 0.66, x, y + 0.03, z, shade(wood, 0.72));
  b.cyl('metal', 0.26, 0.2, 0.26, 10, x, y + hh + 0.18, z, metal);
  b.cyl('metal', 0.28, 0.28, 0.05, 10, x, y + hh + 0.33, z, shade(metal, 1.2));
  b.cyl('glow', 0.07, 0.05, 0.16, 5, x, y + hh + 0.42, z, lamp, 0, 0, 0, true);
}

/** 鼎：三足 + 双耳 + 盖 + 焰 */
function fDing(b: Baker, x: number, y: number, z: number, s: number, metal: number, lamp: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.5;
    b.cyl('metal', 0.08 * s, 0.11 * s, 0.38 * s, 6, x + Math.cos(a) * 0.24 * s, y + 0.19 * s, z + Math.sin(a) * 0.24 * s, shade(metal, 0.82));
  }
  b.cyl('metal', 0.42 * s, 0.34 * s, 0.44 * s, 12, x, y + 0.6 * s, z, metal);
  b.cyl('metal', 0.46 * s, 0.46 * s, 0.06 * s, 12, x, y + 0.85 * s, z, shade(metal, 1.2));
  b.cyl('metal', 0.3 * s, 0.38 * s, 0.2 * s, 12, x, y + 0.98 * s, z, shade(metal, 0.9));
  for (const sx of [-1, 1]) b.box('metal', 0.07 * s, 0.2 * s, 0.07 * s, x + sx * 0.34 * s, y + 0.9 * s, z, shade(metal, 1.1), 0, 0, sx * 0.35);
  b.cyl('glow', 0.09 * s, 0.06 * s, 0.16 * s, 6, x, y + 1.12 * s, z, lamp, 0, 0, 0, true);
}

/** 炉：三足炉 + 盖 + 烟火 */
function fLu(b: Baker, x: number, y: number, z: number, s: number, metal: number, lamp: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.9;
    b.cyl('metal', 0.06 * s, 0.08 * s, 0.26 * s, 6, x + Math.cos(a) * 0.2 * s, y + 0.13 * s, z + Math.sin(a) * 0.2 * s, shade(metal, 0.8));
  }
  b.cyl('metal', 0.32 * s, 0.26 * s, 0.32 * s, 10, x, y + 0.42 * s, z, metal);
  b.cyl('metal', 0.34 * s, 0.34 * s, 0.05 * s, 10, x, y + 0.6 * s, z, shade(metal, 1.18));
  b.cyl('metal', 0.16 * s, 0.24 * s, 0.14 * s, 8, x, y + 0.68 * s, z, shade(metal, 0.92));
  b.cyl('glow', 0.06 * s, 0.04 * s, 0.14 * s, 5, x, y + 0.8 * s, z, lamp, 0, 0, 0, true);
}

/** 玉磬：木架 + 悬磬 + 槌 */
function fQing(b: Baker, x: number, y: number, z: number, s: number, jade: number, accent: number): void {
  for (const su of [-1, 1]) b.box('wood', 0.1, 1.4 * s, 0.1, x + su * 0.5 * s, y + 0.7 * s, z, shade(0x4a3220, 1.1));
  b.box('wood', 1.2 * s, 0.1, 0.12, x, y + 1.4 * s, z, shade(0x4a3220, 1.2));
  b.box('ash', 0.8 * s, 0.46 * s, 0.08, x, y + 1.0 * s, z, jade, 0, 0, 0.14);
  b.box('glow', 0.44 * s, 0.18 * s, 0.03, x, y + 1.0 * s, z + 0.06, shade(accent, 0.8));
  b.box('wood', 0.05, 0.6 * s, 0.05, x + 0.66 * s, y + 0.85 * s, z, shade(0x6b4a2b, 1.1), 0, 0, 0.5);
}

/** 卷册：玉简一摞 + 卷轴 */
function fJuan(b: Baker, x: number, y: number, z: number, s: number, paper: number, accent: number): void {
  for (let k = 0; k < 3; k++) b.box('ash', 0.62 * s, 0.06 * s, 0.44 * s, x, y + (0.03 + k * 0.07) * s, z + (k - 1) * 0.02 * s, shade(paper, 0.92 - k * 0.08));
  b.cyl('ceramic', 0.05 * s, 0.05 * s, 0.56 * s, 6, x, y + 0.26 * s, z - 0.14 * s, shade(accent, 0.7), 0, 0, Math.PI / 2);
}

/** 宝匣：漆匣 + 金扣 + 内透 */
function fXia(b: Baker, x: number, y: number, z: number, s: number, lacquer: number, accent: number): void {
  b.box('lacquer', 0.7 * s, 0.34 * s, 0.5 * s, x, y + 0.17 * s, z, lacquer);
  b.box('lacquer', 0.74 * s, 0.08 * s, 0.54 * s, x, y + 0.38 * s, z, shade(lacquer, 1.15));
  b.box('metal', 0.1 * s, 0.36 * s, 0.52 * s, x, y + 0.2 * s, z, shade(accent, 0.9));
  b.box('glow', 0.2 * s, 0.03 * s, 0.2 * s, x, y + 0.43 * s, z, shade(accent, 0.85));
}

interface RoomSpec {
  x: number; z: number; cw: number; cd: number;
  y: number; h: number; t: number;
  door: Side; win: Side; winY0: number; winY1: number;
  floorG: 'ash' | 'wood' | 'ground';
  floor: number; wood: number; accent: number; paper: number; lamp: number;
  divide: 'screen' | 'lattice' | 'curtain';
  ceil: 'coffer' | 'caisson' | 'rafter';
  shell: Side[];
  s: number;
  /** WS-38：房内锚点回调（既有家具全部建成后调用，只追加器物，不动既有家具） */
  furnish?: (b: Baker, a: RoomAnchors) => void;
}

/** WS-38：房内锚点——与 room() 内家具同一套 P2/at 公式重算，器物据此贴案面/架格/地面，不另立魔法数 */
export interface RoomAnchors {
  fy: number; s: number; axZ: boolean;
  cx: number; cz: number; iw: number; ih: number;
  /** 供案面心（案面标高 fy+1.09） */
  desk: [number, number];
  /** 书格面心（三层格板面 fy+0.55 / +1.35 / +2.15） */
  jia: [number, number];
}

/** 一间室内壳：四壁（可留殿身外墙）+ 地面 + 踢脚 + 隔断 + 槅扇门 + 支摘窗 + 天花 + 一整套陈设 */
function room(b: Baker, o: RoomSpec, kit: string): void {
  const { x, z, cw, cd, y, h, t } = o;
  const hw = cw / 2, hd = cd / 2, fy = y + 0.16, top = fy + h;
  const has = (side: Side): boolean => o.shell.includes(side);
  const ix0 = has('w') ? x - hw : x - hw + t, ix1 = has('e') ? x + hw : x + hw - t;
  const iz0 = has('n') ? z - hd : z - hd + t, iz1 = has('s') ? z + hd : z + hd - t;
  const cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
  const iw = (ix1 - ix0) / 2, ih = (iz1 - iz0) / 2;
  let items = 0;

  // ---- 地面 + 石缝/板缝（板块压在殿身基面之上 0.16，避免共面闪烁） ----
  b.box(o.floorG, cw, 0.16, cd, x, y + 0.08, z, o.floor);
  const jc = shade(o.floor, 0.55);
  if (o.floorG === 'wood') {
    for (let k = 1; k < 6; k++) b.box('wood', cw - 2 * t, 0.03, 0.06, cx, fy, z - hd + (cd * k) / 6, shade(o.wood, 0.78));
  } else {
    for (let k = 1; k < 4; k++) b.box('ash', 0.06, 0.03, cd - 2 * t, x - hw + (cw * k) / 4, fy, cz, jc);
    for (let k = 1; k < 3; k++) b.box('ash', cw - 2 * t, 0.03, 0.06, cx, fy, z - hd + (cd * k) / 3, jc);
  }
  // ---- 踢脚 ----
  const sk = shade(o.wood, 0.74);
  b.box('wood', ix1 - ix0, 0.22, 0.06, cx, fy + 0.11, iz0 + 0.03, sk);
  b.box('wood', ix1 - ix0, 0.22, 0.06, cx, fy + 0.11, iz1 - 0.03, sk);
  b.box('wood', 0.06, 0.22, iz1 - iz0, ix0 + 0.03, fy + 0.11, cz, sk);
  b.box('wood', 0.06, 0.22, iz1 - iz0, ix1 - 0.03, fy + 0.11, cz, sk);

  // ---- 四壁 + 门窗 ----
  const nAt = (side: Side): number => {
    if (has(side)) return side === 'n' ? z - hd + 0.06 : side === 's' ? z + hd - 0.06 : side === 'w' ? x - hw + 0.06 : x + hw - 0.06;
    return side === 'n' ? z - hd + t / 2 : side === 's' ? z + hd - t / 2 : side === 'w' ? x - hw + t / 2 : x + hw - t / 2;
  };
  const aRange = (side: Side): [number, number] => side === 'n' || side === 's'
    ? [x - (has('w') ? hw : hw - t), x + (has('e') ? hw : hw - t)]
    : [z - (has('n') ? hd : hd - t), z + (has('s') ? hd : hd - t)];
  const box2 = (g: BGroup, side: Side, a0: number, a1: number, y0: number, y1: number, thick: number, n: number, hex: number): void => {
    if (a1 - a0 < 0.03 || y1 - y0 < 0.03) return;
    const ca = (a0 + a1) / 2, cy = (y0 + y1) / 2;
    if (side === 'n' || side === 's') b.box(g, a1 - a0, y1 - y0, thick, ca, cy, n, hex);
    else b.box(g, thick, y1 - y0, a1 - a0, n, cy, ca, hex);
  };
  const wallC = 0xe8e4da, dadoC = shade(o.wood, 0.95);
  const inDir = (side: Side): number => side === 'n' || side === 'w' ? 1 : -1;

  const buildWall = (side: Side): void => {
    const [a0, a1] = aRange(side), mid = (a0 + a1) / 2, n = nAt(side);
    const isDoor = side === o.door, isWin = side === o.win;
    if (isDoor) {
      const dw = Math.min(2.6, a1 - a0 - 1.6), dh = Math.min(h - 0.55, 3.2);
      box2('wall', side, a0, mid - dw / 2, y, top, t, n, wallC);
      box2('wall', side, mid + dw / 2, a1, y, top, t, n, wallC);
      box2('wall', side, mid - dw / 2, mid + dw / 2, fy + dh, top, t, n, wallC);
    } else if (isWin) {
      const ww = Math.min(2.8, a1 - a0 - 1.6);
      box2('wall', side, a0, mid - ww / 2, y, top, t, n, wallC);
      box2('wall', side, mid + ww / 2, a1, y, top, t, n, wallC);
      box2('wall', side, mid - ww / 2, mid + ww / 2, y, o.winY0, t, n, wallC);
      box2('wall', side, mid - ww / 2, mid + ww / 2, o.winY1, top, t, n, wallC);
    } else {
      box2('wall', side, a0, a1, y, top, t, n, wallC);
      box2('wood', side, a0, a1, fy + 0.42, fy + 0.98, t + 0.04, n, dadoC); // 板壁腰线
    }
  };
  const buildDoor = (side: Side): void => {
    const [a0, a1] = aRange(side), mid = (a0 + a1) / 2, n = nAt(side);
    const dw = Math.min(2.6, a1 - a0 - 1.6), dh = Math.min(h - 0.55, 3.2);
    const fr = shade(o.wood, 0.7);
    box2('wood', side, mid - dw / 2 - 0.16, mid - dw / 2, fy, fy + dh + 0.18, 0.18, n, fr);
    box2('wood', side, mid + dw / 2, mid + dw / 2 + 0.16, fy, fy + dh + 0.18, 0.18, n, fr);
    box2('wood', side, mid - dw / 2 - 0.16, mid + dw / 2 + 0.16, fy + dh, fy + dh + 0.18, 0.18, n, fr);
    box2('wood', side, mid - dw / 2, mid + dw / 2, fy, fy + 0.12, 0.22, n, shade(o.wood, 0.56)); // 门槛
    for (const su of [-1, 1]) {
      const la = mid + (su * dw) / 4, half = dw / 4 - 0.03;
      box2('wood', side, la - half, la + half, fy + 0.12, fy + dh, 0.1, n, shade(o.wood, 0.92));
      box2('glow', side, la - half + 0.1, la + half - 0.1, fy + dh * 0.44, fy + dh - 0.12, 0.05, n, shade(o.paper, 0.8));
      for (let k = 1; k < 4; k++) {
        const va = la - half + (2 * half * k) / 4;
        box2('wood', side, va - 0.03, va + 0.03, fy + dh * 0.44, fy + dh - 0.12, 0.08, n, shade(o.wood, 0.62));
      }
      box2('wood', side, la - half + 0.05, la + half - 0.05, fy + 0.16, fy + dh * 0.42, 0.14, n, shade(o.wood, 1.06));
      box2('metal', side, la - 0.09, la + 0.09, fy + dh * 0.5, fy + dh * 0.5 + 0.18, 0.09, n, shade(o.accent, 0.85));
    }
  };
  const buildWin = (side: Side): void => {
    const [a0, a1] = aRange(side), mid = (a0 + a1) / 2, n = nAt(side), dir = inDir(side);
    const ww = Math.min(2.8, a1 - a0 - 1.6), y0 = o.winY0, y1 = o.winY1;
    const fr = shade(o.wood, 0.72), nn = n + dir * 0.04;
    box2('wood', side, mid - ww / 2 - 0.14, mid - ww / 2, y0 - 0.14, y1 + 0.14, 0.16, n, fr);
    box2('wood', side, mid + ww / 2, mid + ww / 2 + 0.14, y0 - 0.14, y1 + 0.14, 0.16, n, fr);
    box2('wood', side, mid - ww / 2, mid + ww / 2, y1, y1 + 0.14, 0.16, n, fr);
    box2('wood', side, mid - ww / 2, mid + ww / 2, y0 - 0.16, y0, 0.2, n, shade(o.wood, 0.66)); // 窗台
    box2('glow', side, mid - ww / 2 + 0.06, mid + ww / 2 - 0.06, y0 + 0.05, y1 - 0.05, 0.05, nn, shade(o.paper, 0.7));
    for (let k = 1; k < 6; k++) {
      const va = mid - ww / 2 + (ww * k) / 6;
      box2('wood', side, va - 0.025, va + 0.025, y0, y1, 0.08, nn, shade(o.wood, 0.6));
    }
    for (let k = 1; k < 3; k++) {
      const yy = y0 + ((y1 - y0) * k) / 3;
      box2('wood', side, mid - ww / 2, mid + ww / 2, yy - 0.025, yy + 0.025, 0.08, nn, shade(o.wood, 0.6));
    }
  };
  for (const side of ['n', 's', 'w', 'e'] as Side[]) {
    if (!has(side)) buildWall(side);
    if (side === o.door) buildDoor(side);
    if (side === o.win) buildWin(side);
  }

  // ---- 天花（望板封顶 + 井口枋 + 团花；可选藻井/露明椽） ----
  b.box('wood', ix1 - ix0 + 0.14, 0.18, iz1 - iz0 + 0.14, cx, top + 0.09, cz, shade(o.wood, 0.92));
  for (let k = 1; k < 3; k++) b.box('wood', ix1 - ix0, 0.14, 0.14, cx, top - 0.07, iz0 + ((iz1 - iz0) * k) / 3, shade(o.wood, 1.12));
  for (let k = 1; k < 4; k++) b.box('wood', 0.14, 0.14, iz1 - iz0, ix0 + ((ix1 - ix0) * k) / 4, top - 0.07, cz, shade(o.wood, 1.12));
  b.cyl('glow', Math.min(0.5, iw * 0.3), Math.min(0.5, iw * 0.3), 0.06, 10, cx, top - 0.15, cz, shade(o.accent, 0.85));
  if (o.ceil === 'caisson') {
    b.box('glow', Math.min(3.0, iw * 1.2), 0.16, Math.min(3.0, ih * 1.2), cx, top - 0.22, cz, shade(0x1e3a5f, 1.1));
    b.cyl('glow', Math.min(1.3, iw * 0.5), Math.min(1.5, iw * 0.58), 0.3, 8, cx, top - 0.44, cz, shade(o.accent, 0.9), 0, 0, Math.PI / 8);
    b.cyl('glow', 0.46, 0.46, 0.16, 10, cx, top - 0.64, cz, o.paper);
  } else if (o.ceil === 'rafter') {
    for (let k = 0; k < 7; k++) b.box('wood', ix1 - ix0, 0.12, 0.12, cx, top - 0.1, iz0 + ((iz1 - iz0) * (k + 0.5)) / 7, shade(o.wood, 0.84));
  }

  // ---- 隔断：屏风 / 格栅 / 帷幔（把一间分前堂后室，留 1.2–1.5 过道） ----
  const dv: [number, number] = o.door === 'n' ? [0, -1] : o.door === 's' ? [0, 1] : o.door === 'w' ? [-1, 0] : [1, 0];
  const axZ = dv[0] === 0;
  const fExt = axZ ? ih : iw, lExt = axZ ? iw : ih;
  const P2 = (f: number, l: number): [number, number] => [cx + dv[0] * f + dv[1] * l, cz + dv[1] * f - dv[0] * l];
  const fS = 0.1 * fExt, l0 = -lExt + 0.8, l1 = Math.max(l0 + 0.6, lExt - 1.5);
  const span = l1 - l0;
  if (span > 1.1) {
    if (o.divide === 'screen') {
      const n = 5, lw = span / n;
      for (let k = 0; k < n; k++) {
        const [px, pz] = P2(fS, l0 + lw * (k + 0.5)), ph = k === 2 ? 2.6 : 2.35;
        if (axZ) {
          b.box('wood', lw - 0.06, ph, 0.1, px, fy + ph / 2, pz, shade(o.wood, 1.08));
          b.box('glow', lw - 0.2, ph - 0.5, 0.05, px, fy + ph / 2 + 0.08, pz + 0.07, shade(o.paper, 0.66));
          b.box('glow', lw - 0.2, 0.3, 0.05, px, fy + 0.32, pz + 0.07, shade(o.wood, 0.7));
        } else {
          b.box('wood', 0.1, ph, lw - 0.06, px, fy + ph / 2, pz, shade(o.wood, 1.08));
          b.box('glow', 0.05, ph - 0.5, lw - 0.2, px + 0.07, fy + ph / 2 + 0.08, pz, shade(o.paper, 0.66));
          b.box('glow', 0.05, 0.3, lw - 0.2, px + 0.07, fy + 0.32, pz, shade(o.wood, 0.7));
        }
        b.cyl('wood', 0.1, 0.12, 0.1, 6, px, fy + 0.05, pz, shade(o.wood, 0.6));
      }
    } else if (o.divide === 'lattice') {
      const n = Math.max(4, Math.floor(span / 0.34));
      for (let k = 0; k <= n; k++) {
        const [px, pz] = P2(fS, l0 + (span * k) / n);
        b.box('wood', 0.07, 2.4, 0.07, px, fy + 1.2, pz, shade(o.wood, 0.98));
      }
      const [m0x, m0z] = P2(fS, l0), [m1x, m1z] = P2(fS, l1);
      if (axZ) {
        b.box('wood', span, 0.14, 0.16, (m0x + m1x) / 2, fy + 2.46, m0z, shade(o.wood, 1.14));
        b.box('wood', span, 0.12, 0.14, (m0x + m1x) / 2, fy + 0.08, m0z, shade(o.wood, 0.7));
      } else {
        b.box('wood', 0.16, 0.14, span, m0x, fy + 2.46, (m0z + m1z) / 2, shade(o.wood, 1.14));
        b.box('wood', 0.14, 0.12, span, m0x, fy + 0.08, (m0z + m1z) / 2, shade(o.wood, 0.7));
      }
    } else {
      const [m0x, m0z] = P2(fS, l0), [m1x, m1z] = P2(fS, l1);
      if (axZ) b.box('wood', span + 0.2, 0.1, 0.1, (m0x + m1x) / 2, top - 0.42, m0z, shade(o.wood, 0.86));
      else b.box('wood', 0.1, 0.1, span + 0.2, m0x, top - 0.42, (m0z + m1z) / 2, shade(o.wood, 0.86));
      for (let k = 0; k < 4; k++) {
        const f2 = l0 + (span * (k + 0.5)) / 4, [px, pz] = P2(fS, f2);
        if (axZ) {
          b.box('fabric', span / 4 - 0.1, top - fy - 1.0, 0.06, px, (top - 0.42 + fy + 0.2) / 2, pz, k % 2 ? 0xc8d8e8 : 0xe8d8c0);
          b.box('glow', span / 4 - 0.2, 0.1, 0.05, px, top - 0.5, pz, shade(o.accent, 0.7));
        } else {
          b.box('fabric', 0.06, top - fy - 1.0, span / 4 - 0.1, px, (top - 0.42 + fy + 0.2) / 2, pz, k % 2 ? 0xc8d8e8 : 0xe8d8c0);
          b.box('glow', 0.05, 0.1, span / 4 - 0.2, px, top - 0.5, pz, shade(o.accent, 0.7));
        }
      }
    }
    items += 1;
  }

  // ---- 陈设：供案（鼎/炉/卷册/宝匣）+ 架 + 榻 + 柜 + 香几 + 灯架×2 + 几 ----
  const S = o.s;
  const fBack = -fExt + 0.6;
  const deskLen = Math.max(1.6, Math.min(2 * lExt - 1.2, 4.2 * S));
  {
    const [dx0, dz0] = P2(fBack, 0);
    fDesk(b, dx0, fy, dz0, deskLen, axZ, o.wood, o.accent);
    items += 1;
    const [ax1, az1] = P2(fBack, -deskLen * 0.3);
    fDing(b, ax1, fy + 1.09, az1, 0.55 * S, 0xb08a3c, o.lamp); items += 1;
    const [ax2, az2] = P2(fBack, 0);
    fLu(b, ax2, fy + 1.09, az2, 0.5 * S, 0x8a6a2e, o.lamp); items += 1;
    const [ax3, az3] = P2(fBack, deskLen * 0.28);
    fXia(b, ax3, fy + 1.09, az3, 0.55 * S, 0x8a2a20, o.accent); items += 1;
    const [ax4, az4] = P2(fBack, deskLen * 0.12);
    fJuan(b, ax4, fy + 1.09, az4, 0.62 * S, o.paper, o.accent); items += 1;
  }
  {
    const [jx, jz] = P2(-0.05 * fExt, -(lExt - 0.28));
    fJia(b, jx, fy, jz, Math.max(1.0, Math.min(2.6 * S, 2 * fExt - 3.2, 3.1)), !axZ, o.wood, o.paper, o.accent); items += 1;
  }
  {
    const [tx, tz] = P2(-0.05 * fExt, lExt - 0.95);
    fTa(b, tx, fy, tz, Math.max(1.2, Math.min(2.4 * S, 2 * fExt - 3.6, 3.0)), Math.min(1.15 * S, 1.55), !axZ, 1, o.wood, 0xb04858, o.accent);
    items += 1;
  }
  {
    const gl = Math.max(0.9, Math.min(1.7 * S, 2 * lExt - 1.8));
    const [gx, gz] = P2(fExt - 0.4, -(lExt - 0.05 - gl / 2));
    fGui(b, gx, fy, gz, gl, axZ, o.wood, o.accent); items += 1;
  }
  {
    const [ix, iz] = P2(fBack + 1.3, lExt - 0.45);
    fIncense(b, ix, fy, iz, 0.95 * S, o.wood, 0xb08a3c, o.lamp); items += 1;
  }
  for (const sl of [-1, 1]) {
    const [lx, lz] = P2(fExt - 1.35, sl * (lExt - (lExt >= 2.4 ? 1.4 : 0.45)));
    fLamp(b, lx, fy, lz, 2.4, o.wood, o.lamp); items += 1;
  }
  {
    const [qx, qz] = P2(0.5 * fExt, 0);
    fJi(b, qx, fy, qz, Math.max(1.0, Math.min(1.8 * S, 2 * lExt - 2.0)), axZ, o.wood, o.accent); items += 1;
    for (const sl of [-1, 1]) {
      const [px, pz] = P2(0.5 * fExt, sl * 1.05);
      b.cyl('fabric', 0.42, 0.48, 0.2, 8, px, fy + 0.1, pz, shade(o.wood, 1.15));
    }
  }
  if (o.furnish) {
    const [dAx, dAz] = P2(fBack, 0);
    const [jAx, jAz] = P2(-0.05 * fExt, -(lExt - 0.28));
    o.furnish(b, { fy, s: S, axZ, cx, cz, iw, ih, desk: [dAx, dAz], jia: [jAx, jAz] });
  }
  b.kit(kit, items, fy);
}

/** 灵霄殿东西墙支摘窗洞：realm.ts 开洞与本段窗心共用这组数字（窗心对齐房心） */
export const LINGXIAO_WIN = { sill: 220.0, head: 221.9, half: 1.4, zs: [87.2, 92.4, 97.6, 102.8] } as const;

/** 灵霄殿明间：既有大朝堂补地面/台明/踏跺/山墙上段/平棊（中央留方井接既有斗八藻井） */
function lingxiaoNave(b: Baker): void {
  const x = 0, z = 95, y = HALL_Y + 4.8, fy = y + 0.16;
  b.box('ash', 17.2, 0.16, 20.8, x, y + 0.08, z, shade(0x2e2e2e, 1));
  for (let k = 1; k < 4; k++) b.box('ash', 0.06, 0.03, 20.6, x - 8.6 + (17.2 * k) / 4, fy, z, shade(0x171717, 1));
  for (let k = 1; k < 5; k++) b.box('ash', 17.0, 0.03, 0.06, x, fy, z - 10.4 + (20.8 * k) / 5, shade(0x171717, 1));
  b.box('ash', 17, 0.62, 14, x, fy + 0.31, z, shade(0xd8d0c0, 1));
  b.box('ash', 12, 0.16, 0.9, x, y + 0.08, 105.65, shade(0x2e2e2e, 1));
  b.box('ash', 8, 0.3, 1.0, x, fy + 0.15, z + 7.5, shade(0xd0c8b8, 1));
  for (let k = 0; k < 3; k++) b.box('ash', 13, 0.4, 0.9, x, fy - 0.56 - k * 0.4, 106.45 + k * 0.9, shade(0xd0c8b8, 1 - k * 0.04));
  for (const sx of [-1, 1]) b.box('wall', 0.24, 3.9, 20.8, x + sx * 8.48, 224.4, z, shade(0xa02818, 1.04));
  const cy = HALL_Y + 12.2;
  b.box('wood', 17.2, 0.18, 7.2, x, cy, 88.2, shade(0x3a2418, 1.12));
  b.box('wood', 17.2, 0.18, 7.2, x, cy, 101.8, shade(0x3a2418, 1.12));
  b.box('wood', 5.4, 0.18, 6.4, -5.9, cy, 95, shade(0x3a2418, 1.12));
  b.box('wood', 5.4, 0.18, 6.4, 5.9, cy, 95, shade(0x3a2418, 1.12));
  // 藻井井壁：封住平棊方井与既有承板（228.0）之间的敞口竖井，斜视不漏空腔
  for (const [wx2, wz2, ww2, dd2] of [[0, 91.8, 6.7, 0.16], [0, 98.2, 6.7, 0.16], [-3.2, 95, 0.16, 6.4], [3.2, 95, 0.16, 6.4]] as const) {
    b.box('wall', ww2, 1.92, dd2, wx2, cy + 0.96, wz2, shade(0x1e3a5f, 1.1));
  }
  for (const sx of [-1, 1]) b.box('wood', 0.2, 0.26, 20.8, x + sx * 8.5, cy - 0.2, z, shade(GOLD_LINE, 0.75));
  for (const [dx, dz] of [[-5.9, 88.2], [5.9, 88.2], [-5.9, 101.8], [5.9, 101.8]] as const) {
    b.cyl('glow', 1.0, 1.0, 0.05, 8, dx, cy - 0.12, dz, shade(GOLD_LINE, 0.62));
    b.cyl('glow', 0.5, 0.5, 0.05, 8, dx, cy - 0.16, dz, 0xfff3d8);
  }
  for (const sx of [-1, 1]) b.box('wood', 0.06, 0.22, 20.8, x + sx * 8.56, fy + 0.11, z, shade(0xa63a2b, 0.72));
  for (const sz of [-1, 1]) b.box('wood', 17.2, 0.22, 0.06, x, fy + 0.11, z + sz * 10.36, shade(0xa63a2b, 0.72));
  b.kit('interior.lingxiao.nave', 6, fy);
}

/** 灵霄殿：东西两翼 8 间厢房（门朝明间，外墙开支摘窗） */
function lingxiaoRooms(b: Baker): void {
  const y = HALL_Y + 4.8, h = 3.6, t = 0.3, s = 1.5;
  const zs = LINGXIAO_WIN.zs;
  const dv2: ('screen' | 'lattice' | 'curtain')[] = ['curtain', 'screen', 'lattice', 'screen'];
  const fl = [0x2e2e2e, 0xf2efe9, 0x2e2e2e, 0x243244];
  for (let i = 0; i < 4; i++) {
    room(b, { x: 14, z: zs[i], cw: 10.8, cd: 5.2, y, h, t, door: 'w', win: 'e',
      winY0: LINGXIAO_WIN.sill, winY1: LINGXIAO_WIN.head, floorG: 'ash', floor: fl[i],
      wood: 0xa63a2b, accent: GOLD_LINE, paper: 0xfff3d8, lamp: 0xfff3d8,
      divide: dv2[i], ceil: i === 1 ? 'caisson' : 'coffer', shell: ['e'], s,
      furnish: (bb, aa) => furnishLingxiao(bb, aa, i) }, `interior.lingxiao.R0${i + 1}`);
    room(b, { x: -14, z: zs[i], cw: 10.8, cd: 5.2, y, h, t, door: 'e', win: 'w',
      winY0: LINGXIAO_WIN.sill, winY1: LINGXIAO_WIN.head, floorG: 'ash', floor: fl[3 - i],
      wood: 0xa63a2b, accent: GOLD_LINE, paper: 0xfff3d8, lamp: 0xfff3d8,
      divide: dv2[(i + 2) % 4], ceil: i === 2 ? 'caisson' : 'coffer', shell: ['w'], s,
      furnish: (bb, aa) => furnishLingxiao(bb, aa, i + 4) }, `interior.lingxiao.R0${i + 5}`);
  }
}

/** 瑶池宫正殿：池东玉盘上的廊院（中廊 + 南北两排各 4 间厢房） */
function yaochiPalace(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const CX = 204, CZ = 20, W = 34, D = 20, T = 0.6, H = 6.2, Y = 206.95;
  const x0 = CX - W / 2, z0 = CZ - D / 2, z1 = CZ + D / 2;
  b.cyl('glow', 21, 21, 0.5, 28, CX, 206.0, CZ, shade(0x7fffd4, 0.4), 0, 0, 0, true);
  b.cyl('ash', 21.3, 20.5, 0.4, 28, CX, 206.32, CZ, shade(0xd8d0c0, 1.02));
  b.box('ash', W + 1.6, 0.55, D + 1.6, CX, 206.68, CZ, shade(0xf2efe9, 1));
  b.box('ash', 3.8, 0.5, 6.8, 185.3, 206.66, CZ, shade(0xe8e0d0, 1));
  b.kit('yaochi.palaceHall', 1, 206.32);
  // WS-20：薄玉盘改「云上浮岛」——盘下 7 根向下收的云柱（fabric 三段云瓣 + glow 夹缝内透），限 hypot ≤ 26
  const PY = 206.12; // 玉盘底面
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.42;
    const rr = 5.2 + (k % 3) * 4.6;
    const qx = CX + Math.cos(a) * rr, qz = CZ + Math.sin(a) * rr;
    if (Math.hypot(qx - 204, qz - 20) > 26) continue;
    const hh = 9 + (k % 4) * 1.5;
    const hC = Math.max(1.6, hh - 6.4);
    b.cyl('fabric', 3.4 + (k % 3) * 0.45, 2.3, 3.0, 9, qx, PY - 1.5, qz, shade(0xc4d8e8, 0.94 + (k % 2) * 0.05), a);
    b.cyl('glow', 2.55, 2.55, 0.24, 9, qx, PY - 3.02, qz, shade(0x9fe8ff, 0.5), 0, 0, 0, true);
    b.cyl('fabric', 2.2, 1.25, 3.4, 9, qx, PY - 4.7, qz, shade(0xd0e2f0, 0.9), a);
    b.cyl('glow', 1.5, 1.5, 0.22, 9, qx, PY - 6.42, qz, shade(0x9fe8ff, 0.5), 0, 0, 0, true);
    b.cyl('fabric', 1.3, 0.5, hC, 9, qx, PY - 6.4 - hC / 2, qz, shade(0xb8cee2, 0.86), a);
    b.kit('yaochi.cloudPillar', 1, PY - hh / 2);
  }
  // 盘缘垂云帘：只服务宫体浮岛（hypot(px-204,pz-20) ≤ 26），避让朝池一面 a∈[π±0.85]
  // —— 那一侧玉盘紧贴瑶池池沿（x≈183 vs 池岸 183.6），挂帘会读成「池沿挂白布」；帘身改窄改暗
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2;
    if (a > Math.PI - 0.85 && a < Math.PI + 0.85) continue;
    const qx = CX + Math.cos(a) * 19.4, qz = CZ + Math.sin(a) * 19.4;
    if (Math.hypot(qx - 204, qz - 20) > 26) continue;
    const hh = 2.2 + (k % 4) * 0.4;
    b.box('fabric', 4.4, hh, 0.16, qx, 206.06 - hh / 2, qz, shade(0xb9cfe0, 0.86 + (k % 3) * 0.05), Math.PI / 2 - a);
    b.box('fabric', 2.6, 0.4, 0.14, qx, 206.06 - hh - 0.16, qz, shade(0xa8bccd, 0.92), Math.PI / 2 - a);
    b.box('glow', 4.0, 0.08, 0.1, qx, 206.08, qz, shade(0x9fe8ff, 0.5), Math.PI / 2 - a);
    b.kit('yaochi.cloudCurtain', 1, 206.06 - hh / 2);
  }
  b.box('wall', W, H, T, CX, Y + H / 2, z0 + T / 2, shade(0xd8d0c0, 1));
  b.box('wall', W, H, T, CX, Y + H / 2, z1 - T / 2, shade(0xd8d0c0, 1));
  b.box('wall', T, H, D, CX + W / 2 - T / 2, Y + H / 2, CZ, shade(0xd8d0c0, 1));
  const dw = 3.6, dh = 4.2;
  b.box('wall', T, H, CZ - dw / 2 - z0, x0 + T / 2, Y + H / 2, (z0 + CZ - dw / 2) / 2, shade(0xd8d0c0, 1));
  b.box('wall', T, H, z1 - CZ - dw / 2, x0 + T / 2, Y + H / 2, (z1 + CZ + dw / 2) / 2, shade(0xd8d0c0, 1));
  b.box('wall', T, H - dh, dw, x0 + T / 2, Y + dh + (H - dh) / 2, CZ, shade(0xd8d0c0, 1));
  skyRoofOn(b, CX, Y + H, CZ, W + 2, D + 2, 4.85, 0, 'wudian', shade(0x5c6878, 1.1), GOLD_TRIM); // W17 瑶池宫正殿：庑殿
  // W25：瑶池宫正殿补台基须弥座 + 檐柱列 + 额枋 + 斗栱——
  //   旧版 34×20 的实心盒直接压在一枚 0.55 厚的薄板上，柱列/额枋/斗栱一概没有。
  //   台基三层外轮廓 36×22（玉盘 r21.3，角点 21.1 仍在盘内，不悬空）。
  b.box('ash', W + 2.0, 0.24, D + 2.0, CX, 206.32, CZ, shade(0xd8d0c0, 0.94));
  b.box('ash', W + 1.2, 0.24, D + 1.2, CX, 206.56, CZ, shade(0xd8d0c0, 0.86));
  b.box('ash', W + 1.8, 0.22, D + 1.8, CX, 206.8, CZ, shade(0xe8e0d0, 1.02));
  eaveFrame(b, CX, CZ, W, D, Y, Y + H, 0.85);
  b.box('wood', 14, 0.5, 0.7, CX, Y + H + 2.4, CZ, shade(GOLD_TRIM, 1.05));
  sg.quad(atlas.text('yaochiGong', '瑤池宮', 400, 106, { color: '#fff3e0', glow: '#ffd25e', bg: 'rgba(12,8,4,0.9)', border: 'rgba(255,210,94,.9)', fontPx: 74 }), 4.6, 1.22, x0 - 0.06, Y + 3.4, CZ, -Math.PI / 2);
  const cyTop = Y + 4.55;
  b.box('ash', 32.8, 0.16, 5.0, CX, Y + 0.08, CZ, shade(0xe8e0d0, 1));
  b.box('wood', 32.8, 0.18, 5.0, CX, cyTop + 0.09, CZ, shade(0x3a2418, 1.1));
  for (const sz of [-1, 1]) b.box('wood', 32.8, 0.2, 0.14, CX, cyTop - 0.08, CZ + sz * 2.3, shade(GOLD_LINE, 0.6));
  for (let k = 0; k < 4; k++) {
    b.box('glow', 0.3, 0.42, 0.3, 190 + k * 9.4, Y + 3.95, CZ, 0xfff3d8);
    b.box('wood', 0.06, 0.55, 0.06, 190 + k * 9.4, Y + 4.45, CZ, shade(0x6b4a2b, 1));
  }
  b.kit('interior.yaochi.corridor', 8, Y + 0.16);
  for (let r2 = 0; r2 < 2; r2++) {
    for (let c2 = 0; c2 < 4; c2++) {
      const rx = 191.7 + c2 * 8.2, rz = r2 === 0 ? 14.05 : 25.95;
      room(b, { x: rx, z: rz, cw: 8.2, cd: 6.9, y: Y, h: 4.6, t: 0.3,
        door: r2 === 0 ? 's' : 'n', win: r2 === 0 ? 'n' : 's',
        winY0: Y + 0.9, winY1: Y + 2.8, floorG: c2 === 1 ? 'wood' : 'ash',
        floor: c2 === 1 ? 0x8b5e3c : (c2 === 3 ? 0xf2efe9 : 0xdcd6c6),
        wood: 0xc3272b, accent: GOLD_LINE, paper: 0xfffdf5, lamp: 0xfff3d8,
        divide: (['screen', 'lattice', 'curtain', 'lattice'] as const)[(r2 + c2) % 4],
        ceil: c2 === 2 ? 'caisson' : 'coffer', shell: [r2 === 0 ? 'n' : 's'], s: 1.4,
        furnish: (bb, aa) => furnishYaochi(bb, aa, r2 * 4 + c2) },
        `interior.yaochi.R0${r2 * 4 + c2 + 1}`);
    }
  }
}

/** 蟠桃园厅：园台南侧东/西两座看园厅（各 4 间 + 中廊）；台基把园内 60 丛瑶草压到台下 */
function pantaoHalls(b: Baker): void {
  const Y = 202.5, T = 0.5, W = 12, D = 11, H = 4.2, CZ = 27.5;
  for (let h = 0; h < 2; h++) {
    const hx = h === 0 ? -157 : -143;
    b.box('ash', W + 1.2, 1.38, D + 1.2, hx, 201.81, CZ, shade(0xc8c0b0, 1));
    b.box('wall', W / 2 - 0.9, H, T, hx - (W / 4 + 0.45), Y + H / 2, 22.25, shade(0xc8c0b0, 0.98));
    b.box('wall', W / 2 - 0.9, H, T, hx + (W / 4 + 0.45), Y + H / 2, 22.25, shade(0xc8c0b0, 0.98));
    b.box('wall', 1.8, H - 3.0, T, hx, Y + 3.0 + (H - 3.0) / 2, 22.25, shade(0xc8c0b0, 0.98));
    b.box('wall', W, H, T, hx, Y + H / 2, 32.75, shade(0xc8c0b0, 0.98));
    for (const sx of [-1, 1]) b.box('wall', T, H, D - 2 * T, hx + sx * (W / 2 - T / 2), Y + H / 2, CZ, shade(0xc8c0b0, 0.98));
    skyRoofOn(b, hx, Y + H, CZ, W + 1.2, D + 1.2, 2.89, 0, 'xieshan', shade(0x5c6878, 0.98), GOLD_TRIM); // W17 看园厅：歇山
    // W25：看园厅补檐柱列 + 额枋 + 斗栱（旧版屋面直接扣在 12×11 的墙上，檐下是空的）
    eaveFrame(b, hx, CZ, 11.4, 10.4, Y, Y + H, 0.4);
    b.kit(h === 0 ? 'pantao.hallWest' : 'pantao.hallEast', 1, Y);
    b.box('wood', 2.2, 0.16, 10, hx, Y + 0.08, CZ, shade(0x8b5e3c, 1));
    b.box('wood', 2.2, 0.16, 10, hx, Y + 3.3, CZ, shade(0x4a3220, 1.1));
    b.box('glow', 0.3, 0.42, 0.3, hx, Y + 2.85, CZ, 0xfff3d8);
    b.kit('interior.pantao.corridor', 1, Y + 0.16);
    // WS-38 园具：檐下采桃玉篮架（每厅三篮，二厅合六）+ 门后桃木仙锄（每厅一柄，合二）
    itmPeachBasketRack(b, hx, Y + 0.16, CZ + 3.9, 3);
    itmPeachHoe(b, hx - 0.95, Y + 0.16, CZ - 4.1, 0.12);
    for (let r2 = 0; r2 < 2; r2++) {
      for (let c2 = 0; c2 < 2; c2++) {
        const wx = c2 === 0 ? -1 : 1;
        room(b, { x: hx + wx * 3.3, z: r2 === 0 ? 25 : 30, cw: 4.4, cd: 5.0, y: Y, h: 3.4, t: 0.3,
          door: wx < 0 ? 'e' : 'w', win: r2 === 0 ? 's' : 'n', winY0: Y + 0.85, winY1: Y + 2.5,
          floorG: (r2 + c2) % 2 ? 'wood' : 'ash', floor: (r2 + c2) % 2 ? 0x8b5e3c : 0xcfc6b4,
          wood: 0x6b4a2b, accent: 0xd4b76a, paper: 0xfffdf5, lamp: 0xfff3d8,
          divide: (['lattice', 'screen', 'curtain'] as const)[(r2 * 2 + c2) % 3],
          ceil: 'rafter', shell: [wx < 0 ? 'w' : 'e', r2 === 0 ? 's' : 'n'], s: 1.3,
          furnish: (bb, aa) => furnishPantao(bb, aa, h * 4 + r2 * 2 + c2) },
          `interior.pantao.R0${h * 4 + r2 * 2 + c2 + 1}`);
      }
    }
  }
}

/** 星宿府：八座星宿府各一间值房（府身盒在 realm.ts 掏空，门开 +z 匾额面） */
function xingxiuRooms(b: Baker): void {
  const y = HALL_Y + 0.15, h = 3.55, t = 0.3, s = 1.3;
  const spots: [number, number][] = [[-220, 80], [-230, 30], [-225, -20], [-215, -70], [220, 80], [230, 30], [225, -20], [215, -70]];
  for (let i = 0; i < 8; i++) {
    const [px, pz] = spots[i];
    room(b, { x: px, z: pz, cw: 7.7, cd: 5.4, y, h, t, door: 's', win: 'n',
      winY0: y + 0.95, winY1: y + 2.55, floorG: i % 2 ? 'wood' : 'ash',
      floor: i % 2 ? 0x6b4a2b : 0x4a4f58, wood: 0x3a4e6a, accent: 0x00e5ff, paper: 0xd8f2ff, lamp: 0x9fe8ff,
      divide: (['lattice', 'screen', 'curtain'] as const)[i % 3], ceil: 'rafter', shell: ['n', 's', 'e', 'w'], s,
      furnish: (bb, aa) => furnishXingxiu(bb, aa, i) },
      `interior.xingxiu.R0${i + 1}`);
  }
}

/** 天宫四殿 32 间室内壳总装（buildLingxiaoInterior 首行调用；只加不改既有陈设） */
export function buildSkyInteriorShells(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  lingxiaoNave(b);
  lingxiaoRooms(b);
  yaochiPalace(b, sg, atlas);
  pantaoHalls(b);
  xingxiuRooms(b);
  buildLingxiaoNaveRelics(b);
}

// ============ WS-38：天宫宝器与仙迹（灵霄/瑶池/蟠桃/星宿 26 件 T-ITM 逐件建模） ============
// 材质口径（限 BGroup 十四组）：玉/石 → ash（浅色）、金铜 → metal、宝光 → glow、
// 木作 → wood、漆器 → lacquer、锦绫 → fabric、瓷皿 → ceramic。不进点光配置（12 盏已封顶）。
// 每件首行「// 名称：T-ITM-xxxx」= 台账锚点注释（scripts/annotate-atom-impl.mjs 按源码 ID 锚点收录）
const JADEW = 0xfff8ef;   // 白玉（比殿内玉光更白一档）
const JADEB = 0xdcdce8;   // 青玉
const BRZ = 0xb08a3c;     // 铜
const BRZD = 0x7a6230;    // 暗铜
const LQCR = 0x8a2a20;    // 朱漆
const IRONB = 0x2a2f38;   // 玄铁 / 陨铁

/** 局部系取点器：u 沿器物长向、w 沿进深向，绕 Y 转 ry（ry=0 时即世界 x/z） */
function lframe(x: number, z: number, ry: number): (u: number, w: number) => [number, number] {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  return (u, w) => [x + ca * u - sa * w, z + sa * u + ca * w];
}
/** 案面局部系：与 fDesk/at() 同一套约定（axZ=false 时整体转 90°） */
function onDesk(a: RoomAnchors, u: number, w: number): [number, number] {
  return lframe(a.desk[0], a.desk[1], a.axZ ? 0 : Math.PI / 2)(u, w);
}
function deskRy(a: RoomAnchors): number { return a.axZ ? 0 : Math.PI / 2; }

// 通明长烛：T-ITM-0161
/** 通明长烛：三足铜座 + 束腰柱 + 承烛盘 + 1.5m 巨烛 + 蜡泪 + 焰（烛高 1.5、可燃一月） */
function itmTallCandle(b: Baker, x: number, y: number, z: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.4;
    b.cyl('metal', 0.05, 0.08, 0.26, 6, x + Math.cos(a) * 0.17, y + 0.13, z + Math.sin(a) * 0.17, shade(BRZD, 0.92));
  }
  b.cyl('metal', 0.26, 0.2, 0.1, 12, x, y + 0.31, z, BRZ);
  b.cyl('metal', 0.08, 0.14, 0.44, 8, x, y + 0.58, z, shade(BRZ, 0.86));
  b.cyl('metal', 0.33, 0.22, 0.07, 12, x, y + 0.84, z, shade(BRZ, 1.14));
  for (let k = 0; k < 4; k++) {
    const a = k * 1.571 + 0.3;
    b.box('glow', 0.09, 0.15 + (k % 2) * 0.07, 0.06, x + Math.cos(a) * 0.25, y + 0.74, z + Math.sin(a) * 0.25, shade(JADEW, 0.9), -a);
  }
  b.cyl('ceramic', 0.15, 0.17, 1.5, 10, x, y + 1.63, z, 0xfffaf0);
  b.cyl('metal', 0.03, 0.03, 0.1, 5, x, y + 2.43, z, IRONB);
  b.cyl('glow', 0.13, 0.03, 0.09, 6, x, y + 2.53, z, 0xfff3d8, 0, 0, 0, true);
  b.cyl('glow', 0.06, 0.02, 0.26, 6, x, y + 2.62, z, 0xffd25e, 0, 0, 0, true);
  b.kit('palace.item.tallCandle', 1, y + 1.6);
}

// 传令金牌：T-ITM-0162
/** 传令金牌：正堂令架（双柱 + 三道横枋 + 底座）+ 12 面金牌红绫分五等轻重 */
function itmGoldTokenRack(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  for (const su of [-1, 1]) {
    const [px, pz] = L(su * 1.9, 0);
    b.box('wood', 0.16, 1.94, 0.18, px, y + 0.97, pz, shade(0x5a3a24, 1.04), ry);
    const [fx2, fz2] = L(su * 1.9, 0);
    b.box('wood', 0.34, 0.1, 0.44, fx2, y + 0.05, fz2, shade(0x4a2e1c, 1), ry);
  }
  for (const hy of [0.24, 1.05, 1.86]) b.box('wood', 3.96, hy === 1.05 ? 0.1 : 0.14, 0.16, x, y + hy, z, shade(0x4a2e1c, 1.06), ry);
  for (let i = 0; i < 12; i++) {
    const row = i < 6 ? 0 : 1;
    const railY = row === 0 ? 1.86 : 1.05;
    const [gx, gz] = L(-1.65 + (i % 6) * 0.66, 0.06);
    b.box('fabric', 0.12, 0.36, 0.04, gx, y + railY - 0.18, gz, 0xa02818, ry);
    b.box('metal', 0.28, 0.34, 0.05, gx, y + railY - 0.52, gz + 0.02, shade(row ? GOLD_TRIM : GOLD_LINE, 1), ry);
    b.box('glow', 0.19, 0.2, 0.02, gx, y + railY - 0.52, gz + 0.06, shade(GOLD_TRIM, 0.85), ry);
    b.box('metal', 0.1, 0.06, 0.06, gx, y + railY - 0.33, gz + 0.02, shade(BRZD, 1), ry);
  }
  b.kit('palace.item.goldTokenRack', 1, y + 1.0);
}

// 传旨玉音铃：T-ITM-0158
/** 传旨玉音铃：独板小几 + 铜铃架 + 悬玉铃（铃身/铃口/铃钮/铃舌）+ 红绫，摇铃传声至各宫 */
function itmJadeBell(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('wood', 0.94, 0.12, 0.62, x, y + 0.52, z, shade(0x6b4a2b, 1.08), ry);
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const [px, pz] = L(su * 0.36, sw * 0.22);
    b.box('wood', 0.09, 0.48, 0.09, px, y + 0.24, pz, shade(0x5a3a24, 0.9), ry);
  }
  const [mx, mz] = L(0.3, 0);
  b.cyl('metal', 0.05, 0.07, 1.0, 8, mx, y + 1.08, mz, BRZ);
  b.box('metal', 0.5, 0.06, 0.06, mx - 0.22, y + 1.56, mz, BRZ, ry);
  const [bx, bz] = L(-0.2, 0);
  b.cyl('ash', 0.14, 0.2, 0.3, 10, bx, y + 1.34, bz, shade(JADEW, 1.06));
  b.cyl('ash', 0.21, 0.16, 0.06, 10, bx, y + 1.2, bz, shade(JADEW, 0.94));
  b.cyl('ash', 0.05, 0.05, 0.09, 6, bx, y + 1.53, bz, JADEW);
  b.box('metal', 0.04, 0.14, 0.04, bx, y + 1.16, bz, BRZD, ry);
  b.cyl('glow', 0.16, 0.16, 0.02, 10, bx, y + 1.3, bz, shade(0xfff3d8, 0.75));
  for (const s of [-1, 1]) b.box('fabric', 0.06, 0.3, 0.03, bx + s * 0.17, y + 1.04, bz, 0xa02818, ry);
  b.kit('palace.item.jadeBell', 1, y + 1.2);
}

// 待漏更香：T-ITM-0077
/** 待漏更香：三足铜座 + 透雕铜罩 + 香篆 + 烟柱 + 罩外九道更牙（一炷恰为一更） */
function itmHourIncense(b: Baker, x: number, y: number, z: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.6;
    b.cyl('metal', 0.05, 0.07, 0.3, 6, x + Math.cos(a) * 0.24, y + 0.15, z + Math.sin(a) * 0.24, BRZD);
  }
  b.cyl('metal', 0.34, 0.28, 0.06, 12, x, y + 0.33, z, shade(BRZ, 1.1));
  b.cyl('metal', 0.3, 0.3, 0.5, 12, x, y + 0.61, z, shade(BRZ, 0.92), 0, 0, 0, true);
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785;
    b.box('glow', 0.05, 0.26, 0.02, x + Math.cos(a) * 0.3, y + 0.62, z + Math.sin(a) * 0.3, shade(0xffd25e, 0.5 + (k % 2) * 0.2), -a);
  }
  b.cyl('metal', 0.34, 0.3, 0.06, 12, x, y + 0.89, z, shade(BRZ, 1.16));
  b.cyl('glow', 0.09, 0.05, 0.3, 6, x, y + 1.06, z, 0xffb300, 0, 0, 0, true);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    b.box('metal', 0.06, 0.1, 0.03, x + Math.cos(a) * 0.31, y + 0.42, z + Math.sin(a) * 0.31, shade(GOLD_TRIM, 0.9), -a);
  }
  b.kit('palace.item.hourIncense', 1, y + 0.6);
}

// 值殿名录：T-ITM-0160
/** 值殿名录：玉简册三片摞叠 + 铜扣 + 朱书行（记各殿值殿表） */
function itmRosterSlips(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  for (let k = 0; k < 3; k++) b.box('ash', 0.46, 0.05, 0.32, x, y + 0.025 + k * 0.055, z, shade(JADEW, 0.97 - k * 0.05), ry);
  const [cx2, cz2] = L(0.19, 0);
  b.box('metal', 0.05, 0.18, 0.34, cx2, y + 0.09, cz2, shade(BRZ, 0.9), ry);
  const [l1x, l1z] = L(0, 0.07);
  const [l2x, l2z] = L(0, -0.03);
  b.box('glow', 0.3, 0.012, 0.02, l1x, y + 0.19, l1z, shade(0xc0392b, 0.85), ry);
  b.box('glow', 0.22, 0.012, 0.02, l2x, y + 0.19, l2z, shade(0xc0392b, 0.7), ry);
  b.kit('palace.item.rosterSlips', 1, y);
}

// 灵墨玉简笔砚：T-ITM-0078
/** 灵墨玉简笔砚：砚台 + 墨池灵光 + 玉简 + 笔搁 + 玉管笔（笔尖凝光），案面各间一副 */
function itmInkSlabSet(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('ash', 0.26, 0.07, 0.2, x, y + 0.035, z, shade(JADEW, 1.0), ry);
  b.box('glow', 0.16, 0.02, 0.11, x, y + 0.075, z, shade(0x2a4a6a, 0.85), ry);
  const [sx2, sz2] = L(0.2, 0);
  b.box('ash', 0.24, 0.03, 0.17, sx2, y + 0.015, sz2, shade(JADEB, 0.98), ry);
  b.box('glow', 0.17, 0.008, 0.015, sx2, y + 0.032, sz2, shade(0x7fd8ff, 0.7), ry);
  const [px, pz] = L(0.2, -0.13);
  b.box('wood', 0.09, 0.05, 0.07, px, y + 0.025, pz, shade(0x6b4a2b, 1), ry);
  b.box('ceramic', 0.3, 0.028, 0.028, px, y + 0.065, pz, 0xe8e0d0, ry);
  b.box('metal', 0.06, 0.034, 0.034, px - 0.16, y + 0.065, pz, shade(GOLD_TRIM, 1), ry);
  b.box('glow', 0.07, 0.03, 0.03, px + 0.17, y + 0.065, pz, shade(0x9fe8ff, 0.9), ry);
  b.kit('palace.item.inkSlabSet', 1, y);
}

// 园志玉简：T-ITM-0027
/** 园志玉简：玉简五片编连 + 双道编绳 + 墨字行（记历代桃熟批次与偷桃案底） */
function itmGardenLog(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  for (let k = 0; k < 5; k++) {
    const [sx2, sz2] = L(-0.16 + k * 0.08, 0);
    b.box('ash', 0.068, 0.028, 0.4, sx2, y + 0.014, sz2, shade(JADEW, 0.97 - (k % 2) * 0.06), ry);
  }
  for (const w of [-0.13, 0.13]) {
    const [bx, bz] = L(0, w);
    b.box('ceramic', 0.44, 0.012, 0.02, bx, y + 0.032, bz, shade(0x6b4a2b, 1.1), ry);
  }
  const [tx, tz] = L(0, 0.02);
  b.box('glow', 0.3, 0.008, 0.09, tx, y + 0.034, tz, shade(0x3a2a1a, 0.9), ry);
  b.kit('palace.item.gardenLog', 1, y);
}

// 采桃玉篮：T-ITM-0022
/** 采桃玉篮：碧玉编篮（篮底 + 编条 + 篮沿 + 提梁 + 篮底灵纹 + 桃实）+ 檐下三层木架 */
function itmPeachBasketRack(b: Baker, x: number, y: number, z: number, n: number): void {
  // 木架：四柱 + 三层架板
  for (const su of [-1, 1]) for (const sw of [-1, 1]) b.box('wood', 0.1, 1.56, 0.1, x + su * 0.86, y + 0.78, z + sw * 0.26, shade(0x5a3a24, 0.96));
  for (let k = 0; k < 3; k++) b.box('wood', 1.86, 0.07, 0.6, x, y + 0.18 + k * 0.62, z, shade(0x6b4a2b, 1.06));
  // 篮 ×3（架上三层各一）
  for (let k = 0; k < n; k++) {
    const by = y + 0.215 + k * 0.62, bx = x + (k % 2 ? 0.28 : -0.28), bz = z;
    b.cyl('ash', 0.26, 0.22, 0.05, 10, bx, by + 0.03, bz, shade(JADEB, 0.94));          // 篮底
    for (let i = 0; i < 10; i++) {                                                       // 编条
      const a = (i / 10) * Math.PI * 2;
      b.box('ash', 0.035, 0.22, 0.035, bx + Math.cos(a) * 0.25, by + 0.16, bz + Math.sin(a) * 0.25, shade(JADEB, 1.02 + (i % 2) * 0.06), -a);
    }
    b.cyl('ash', 0.28, 0.28, 0.035, 10, bx, by + 0.27, bz, shade(JADEB, 1.1), 0, 0, 0, true); // 篮沿
    b.box('ash', 0.05, 0.05, 0.56, bx, by + 0.31, bz, shade(JADEB, 1.08), Math.PI / 2);       // 提梁
    b.cyl('glow', 0.2, 0.2, 0.015, 8, bx, by + 0.06, bz, shade(0x7fffd4, 0.55));              // 篮底灵纹
    for (let i = 0; i < 4; i++) {                                                             // 桃实
      const a = i * 1.571 + 0.5;
      b.cyl('glow', 0.075, 0.09, 0.13, 7, bx + Math.cos(a) * 0.12, by + 0.16, bz + Math.sin(a) * 0.12, 0xffb0c8);
    }
    b.kit('palace.item.peachBasket', 1, by + 0.12);
  }
  b.kit('palace.item.peachRack', 1, y + 0.8);
}

// 桃木仙锄：T-ITM-0023
/** 桃木仙锄：千年桃木柄 + 缠红绳 + 铜箍 + 铁锄头 + 锄头符光（斜倚门后） */
function itmPeachHoe(b: Baker, x: number, y: number, z: number, lean: number): void {
  const sa = Math.sin(lean), ca = Math.cos(lean);
  const at2 = (d: number): [number, number] => [x - d * sa, y + d * ca];
  const [hx, hy] = at2(0.85);
  b.cyl('trunk', 0.035, 0.05, 1.7, 6, hx, hy, z, shade(0x6a4a30, 1.08), 0, 0, lean);   // 桃木柄
  for (let k = 0; k < 4; k++) {
    const [rx2, ry2] = at2(0.36 + k * 0.1);
    b.cyl('fabric', 0.052, 0.052, 0.035, 6, rx2, ry2, z, shade(0xa02818, 1.0), 0, 0, lean); // 缠红绳
  }
  const [gx, gy] = at2(1.62);
  b.cyl('metal', 0.055, 0.055, 0.09, 6, gx, gy, z, BRZD, 0, 0, lean);                  // 铜箍
  const [bx, by] = at2(1.72);
  b.box('metal', 0.34, 0.1, 0.06, bx, by, z, shade(0x8a8a92, 1.05), 0, 0, lean + 0.1);   // 锄头
  b.box('metal', 0.12, 0.2, 0.055, bx - 0.13, by - 0.1, z, shade(0x8a8a92, 0.94), 0, 0, lean + 0.1);
  b.box('glow', 0.16, 0.026, 0.02, bx + 0.06, by + 0.03, z + 0.035, shade(0x7fd8ff, 0.8), 0, 0, lean + 0.1); // 符光
  b.kit('palace.item.peachHoe', 1, y + 0.9);
}

// 胭脂玉盒：T-ITM-0142
/** 胭脂玉盒：玉盒 + 玉盖 + 铜扣 + 盒内胭脂（映月生辉）+ 小铜镜 */
function itmRougeBox(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('ash', 0.34, 0.13, 0.24, x, y + 0.065, z, shade(JADEW, 1.02), ry);
  b.box('ash', 0.36, 0.055, 0.26, x, y + 0.16, z, shade(JADEW, 1.08), ry);
  b.box('metal', 0.05, 0.05, 0.26, x + 0.17, y + 0.12, z, shade(BRZ, 0.95), ry);
  b.cyl('glow', 0.09, 0.09, 0.02, 10, x, y + 0.185, z, shade(0xd94a6a, 0.85));
  b.cyl('glow', 0.05, 0.05, 0.012, 8, x, y + 0.2, z, 0xffb7c5);
  const [mx, mz] = L(0.28, 0);
  b.cyl('metal', 0.13, 0.13, 0.02, 12, mx, y + 0.12, mz, shade(BRZ, 1.1), 0, Math.PI / 2);
  b.box('metal', 0.03, 0.12, 0.03, mx, y + 0.05, mz, shade(BRZ, 0.9), ry);
  b.box('ash', 0.16, 0.02, 0.1, mx, y + 0.01, mz, shade(JADEB, 1.0), ry);
  b.kit('palace.item.rougeBox', 1, y);
}

// 乌羽翎笔：T-ITM-0143
/** 乌羽翎笔：笔山架（双峰）+ 乌羽笔（乌木笔杆 + 铜笔顶 + 笔尖凝月光 + 乌羽三缕） */
function itmRavenBrush(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('wood', 0.2, 0.05, 0.12, x, y + 0.025, z, shade(0x6b4a2b, 1.05), ry);            // 笔山座
  for (const su of [-1, 1]) {
    const [px2, pz2] = L(su * 0.075, 0);
    b.box('wood', 0.05, 0.11, 0.05, px2, y + 0.105, pz2, shade(0x6b4a2b, 1.1), ry);       // 笔山双峰
  }
  b.box('ceramic', 0.32, 0.03, 0.03, x, y + 0.13, z, 0x2a2430, ry);                       // 乌木笔杆
  const [tx2, tz2] = L(0.17, 0);
  b.box('glow', 0.06, 0.03, 0.03, tx2, y + 0.13, tz2, shade(0xdcdce8, 0.95), ry);         // 笔尖凝月光
  const [bt2, bz3] = L(-0.15, 0);
  b.box('metal', 0.05, 0.035, 0.035, bt2, y + 0.13, bz3, shade(GOLD_TRIM, 1), ry);         // 铜笔顶
  for (let k = 0; k < 3; k++) {
    const [fx2, fz2] = L(-0.2 - k * 0.04, 0);
    b.box('fabric', 0.14, 0.02, 0.07 - k * 0.015, fx2, y + 0.15 + k * 0.02, fz2, shade(0x1e1a20, 1.1 + k * 0.1), ry, 0, 0.1 * (k + 1)); // 乌羽三缕
  }
  b.kit('palace.item.ravenBrush', 1, y);
}

// 月露香墨：T-ITM-0144
/** 月露香墨：墨砚 + 砚池清冷墨光 + 墨锭（斜搁）+ 砚滴 + 墨匣 */
function itmMoonInk(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('ash', 0.3, 0.06, 0.22, x, y + 0.03, z, shade(JADEB, 1.02), ry);
  b.box('glow', 0.2, 0.02, 0.14, x, y + 0.065, z, shade(0x243244, 0.9), ry);
  b.box('lacquer', 0.1, 0.05, 0.14, x + 0.02, y + 0.1, z, shade(0x1e1a20, 1.15), ry, 0, 0.16);
  b.box('glow', 0.06, 0.01, 0.1, x + 0.02, y + 0.128, z, shade(0x9fe8ff, 0.55), ry);
  const [dx2, dz2] = L(0.22, 0.08);
  b.cyl('ceramic', 0.05, 0.06, 0.09, 8, dx2, y + 0.045, dz2, 0xe8e0d0);
  const [bx2, bz2] = L(-0.24, 0);
  b.box('lacquer', 0.18, 0.06, 0.16, bx2, y + 0.03, bz2, shade(LQCR, 0.9), ry);
  b.kit('palace.item.moonInk', 1, y);
}

// 劝酒葫芦：T-ITM-0132
/** 劝酒葫芦：紫金小葫芦成对（两球合范 + 腰束铜箍 + 铜塞 + 系带 + 锦垫） */
function itmWineGourd(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('fabric', 0.4, 0.035, 0.24, x, y + 0.018, z, shade(0x5a2a3a, 1.1), ry);   // 锦垫
  for (let i = 0; i < 2; i++) {
    const [gx, gz] = L(-0.09 + i * 0.18, i === 0 ? -0.03 : 0.05);
    b.cyl('lacquer', 0.1, 0.11, 0.14, 10, gx, y + 0.11, gz, shade(0x5a2a6a, 1.05));      // 下球
    b.cyl('lacquer', 0.055, 0.075, 0.08, 10, gx, y + 0.2, gz, shade(0x5a2a6a, 1.12));     // 腰
    b.cyl('lacquer', 0.075, 0.085, 0.1, 10, gx, y + 0.28, gz, shade(0x5a2a6a, 1.08));     // 上球
    b.cyl('metal', 0.085, 0.085, 0.018, 10, gx, y + 0.19, gz, shade(GOLD_TRIM, 0.9));      // 腰束
    b.cyl('metal', 0.032, 0.032, 0.05, 6, gx, y + 0.35, gz, shade(BRZ, 1.05));            // 铜塞
    b.box('fabric', 0.02, 0.16, 0.02, gx + 0.07, y + 0.26, gz, 0xa02818, ry, 0, 0.3);     // 系带
    b.cyl('glow', 0.06, 0.06, 0.012, 8, gx, y + 0.32, gz, shade(0xffd25e, 0.45));
  }
  b.kit('palace.item.wineGourd', 1, y + 0.2);
}

// 夜行斗篷：T-ITM-0147
/** 夜行斗篷：衣架（底座 + 立柱 + 横臂 + 挂钩）+ 夜织斗篷（三重褶 + 兜帽 + 银线）+ 系带 */
function itmNightCloak(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('wood', 0.86, 0.08, 0.5, x, y + 0.04, z, shade(0x4a3220, 1), ry);
  b.cyl('wood', 0.06, 0.09, 1.86, 8, x, y + 0.97, z, shade(0x5a3a24, 1.04));
  b.box('wood', 0.9, 0.07, 0.07, x, y + 1.8, z, shade(0x5a3a24, 1.1), ry);
  for (const su of [-1, 1]) {
    const [hx2, hz2] = L(su * 0.4, 0);
    b.box('metal', 0.04, 0.1, 0.04, hx2, y + 1.72, hz2, shade(BRZ, 0.95), ry);
  }
  for (let k = 0; k < 3; k++) {
    const [px, pz] = L(0, -0.06 - k * 0.02);
    b.box('fabric', 0.78 - k * 0.06, 1.5 - k * 0.12, 0.05, px, y + 0.95 - k * 0.03, pz, shade(0x1e1a28, 1.06 + k * 0.08), ry);
  }
  const [nx, nz] = L(0, 0.02);
  b.box('fabric', 0.34, 0.3, 0.24, nx, y + 1.62, nz, shade(0x1e1a28, 0.92), ry);
  const [sx2, sz2] = L(0.3, -0.09);
  b.box('glow', 0.03, 1.2, 0.02, sx2, y + 0.95, sz2, shade(0xdcdce8, 0.5), ry);       // 银线
  const [tieX, tieZ] = L(-0.2, -0.12);
  b.box('fabric', 0.1, 0.5, 0.02, tieX, y + 1.1, tieZ, shade(0xa02818, 0.85), ry);
  b.kit('palace.item.nightCloak', 1, y + 1.0);
}

// 穿山宝铲：T-ITM-0148
/** 穿山宝铲：铲架 + 玄铁短铲（柄 + 铜箍 + 铲头 + 铲头符光），倚架而立 */
function itmDigSpade(b: Baker, x: number, y: number, z: number, lean: number): void {
  const sa = Math.sin(lean), ca = Math.cos(lean);
  const at2 = (d: number): [number, number] => [x - d * sa, y + d * ca];
  b.box('wood', 0.3, 0.08, 0.3, x + 0.2, y + 0.04, z, shade(0x4a3220, 1.0));            // 铲架座
  b.box('wood', 0.07, 0.5, 0.07, x + 0.32, y + 0.25, z, shade(0x5a3a24, 1.02));
  b.box('wood', 0.24, 0.05, 0.05, x + 0.22, y + 0.48, z, shade(0x5a3a24, 1.08));
  const [hx, hy] = at2(0.68);
  b.cyl('wood', 0.035, 0.045, 1.36, 6, hx, hy, z, shade(0x6b4a2b, 1.06), 0, 0, lean);
  const [gx, gy] = at2(1.3);
  b.cyl('metal', 0.05, 0.05, 0.08, 6, gx, gy, z, BRZD, 0, 0, lean);
  const [bx, by] = at2(1.5);
  b.box('metal', 0.3, 0.34, 0.05, bx, by, z, shade(IRONB, 1.5), 0, 0, lean);
  b.box('metal', 0.22, 0.1, 0.045, bx - 0.05, by - 0.2, z, shade(IRONB, 1.35), 0, 0, lean);
  b.box('glow', 0.16, 0.02, 0.02, bx, by + 0.06, z + 0.032, shade(0x7fd8ff, 0.75), 0, 0, lean);
  b.kit('palace.item.digSpade', 1, y + 0.8);
}

// 日晷残片：T-ITM-0150
/** 日晷残片：石龛（三面围板 + 顶盖 + 台座）+ 残玉晷盘（斜置）+ 失传刻度 + 铜托 */
function itmSundialShard(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('ash', 0.86, 0.3, 0.6, x, y + 0.15, z, shade(0xb8b2a4, 1.0), ry);              // 台座
  for (const su of [-1, 1]) {
    const [wx2, wz2] = L(su * 0.38, 0);
    b.box('ash', 0.08, 0.9, 0.56, wx2, y + 0.75, wz2, shade(0xc8c0b0, 1.02), ry);
  }
  const [bx2, bz2] = L(0, -0.26);
  b.box('ash', 0.86, 0.9, 0.08, bx2, y + 0.75, bz2, shade(0xc8c0b0, 0.96), ry);
  b.box('ash', 0.94, 0.1, 0.66, x, y + 1.24, z, shade(0xd8d0c0, 1.04), ry);             // 龛顶
  b.cyl('metal', 0.16, 0.2, 0.1, 10, x, y + 0.35, z, shade(BRZ, 0.95));                // 铜托
  b.cyl('ash', 0.28, 0.28, 0.05, 12, x, y + 0.55, z, shade(JADEB, 0.98), 0, 0.42);    // 晷盘（斜置）
  b.cyl('ash', 0.14, 0.14, 0.05, 10, x + 0.16, y + 0.48, z + 0.16, shade(0xb8b2a4, 0.92), 0, 0.42); // 缺角残块
  for (let k = 0; k < 9; k++) {                                                         // 失传刻度
    const a = (k / 9) * Math.PI * 2;
    b.box('glow', 0.02, 0.012, 0.09, x + Math.cos(a) * 0.2, y + 0.6, z + Math.sin(a) * 0.17, shade(0x7fffd4, 0.6), 0, 0.42);
  }
  b.kit('palace.item.sundialShard', 1, y + 0.6);
}

// 心宿迷香：T-ITM-0139
/** 心宿迷香：漆香盒 + 天条符封（十字封条 + 朱印）+ 铜锁 + 系绳（不可开启） */
function itmHeartIncense(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('lacquer', 0.3, 0.16, 0.22, x, y + 0.08, z, shade(LQCR, 0.95), ry);
  b.box('lacquer', 0.32, 0.05, 0.24, x, y + 0.19, z, shade(LQCR, 1.12), ry);
  for (const u of [-0.06, 0.06]) {
    const [fx2, fz2] = L(u, 0);
    b.box('fabric', 0.055, 0.24, 0.26, fx2, y + 0.1, fz2, shade(0xd8c8a0, 0.95), ry);   // 符封
  }
  const [sx2, sz2] = L(0, 0);
  b.box('metal', 0.05, 0.05, 0.27, sx2, y + 0.1, sz2, shade(0xd8c8a0, 0.85), ry);       // 封条
  b.box('glow', 0.07, 0.07, 0.012, sx2, y + 0.1, sz2 + 0.125, shade(0xc0392b, 0.9), ry); // 朱印
  b.box('metal', 0.07, 0.08, 0.05, sx2, y + 0.24, sz2 + 0.12, shade(BRZ, 0.95), ry);     // 铜锁
  b.kit('palace.item.heartIncense', 1, y);
}

/** 冠架：三足座 + 立柱 + 冠托盘 + 托面宝光（蛟角冠/獬豸冠/天鸡冠共用） */
function crownStand(b: Baker, x: number, y: number, z: number, hh: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.5;
    b.box('wood', 0.07, 0.1, 0.07, x + Math.cos(a) * 0.18, y + 0.05, z + Math.sin(a) * 0.18, shade(0x4a3220, 0.9));
  }
  b.cyl('wood', 0.09, 0.13, hh, 8, x, y + hh / 2 + 0.1, z, shade(0x5a3a24, 1.02));
  b.cyl('wood', 0.3, 0.24, 0.07, 10, x, y + hh + 0.13, z, shade(0xd4b76a, 1.0));
  b.cyl('glow', 0.26, 0.26, 0.02, 10, x, y + hh + 0.18, z, shade(0xffd25e, 0.55));
}

// 蛟角冠：T-ITM-0113
// 蛟角冠：青铜角形冠 + 双蛟角（冠角可微动）+ 冠顶珠 + 冠架（角木蛟府正堂冠架）
function itmDragonCrown(b: Baker, x: number, y: number, z: number, ry: number): void {
  crownStand(b, x, y, z, 0.86);
  const cy2 = y + 1.08;
  b.cyl('metal', 0.18, 0.2, 0.16, 10, x, cy2 + 0.08, z, shade(BRZ, 1.02), ry);
  for (const su of [-1, 1]) {
    const [ax2, az2] = lframe(x, z, ry)(su * 0.17, 0);
    for (let k = 0; k < 3; k++) {
      const a2 = su * (0.5 + k * 0.36);
      b.box('metal', 0.06, 0.16, 0.06, ax2 + Math.sin(a2) * (0.06 + k * 0.05), cy2 + 0.2 + k * 0.11, az2, shade(BRZ, 1.06 - k * 0.04), ry, 0, a2 * 0.5);
    }
  }
  b.cyl('glow', 0.06, 0.06, 0.07, 8, x, cy2 + 0.2, z, shade(0x7fffd4, 0.85));
  b.box('metal', 0.34, 0.05, 0.26, x, cy2 + 0.01, z, shade(BRZ, 1.14), ry);
  b.kit('palace.item.dragonCrown', 1, y + 1.0);
}

// 角宿令牌：T-ITM-0116
/** 角宿令牌：玉牌 + 铜边 + 角纹（调本宿星力）+ 牌座（正堂案上） */
function itmHornToken(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('wood', 0.24, 0.06, 0.14, x, y + 0.03, z, shade(0x4a3220, 1.0), ry);            // 牌座
  b.box('ash', 0.26, 0.34, 0.035, x, y + 0.24, z, shade(JADEW, 1.04), ry);              // 玉牌
  for (const su of [-1, 1]) {
    const [ex2, ez2] = L(su * 0.115, 0);
    b.box('metal', 0.035, 0.34, 0.045, ex2, y + 0.24, ez2, shade(GOLD_TRIM, 0.95), ry);  // 铜边
  }
  b.box('metal', 0.26, 0.04, 0.045, x, y + 0.4, z, shade(GOLD_TRIM, 0.9), ry);
  const [tx2, tz2] = L(0, 0.024);
  b.box('glow', 0.16, 0.03, 0.012, tx2, y + 0.3, tz2, shade(0x7fffd4, 0.8), ry);        // 角纹
  b.box('glow', 0.09, 0.09, 0.012, tx2, y + 0.2, tz2, shade(0x7fffd4, 0.6), ry, 0, 0.6);
  b.kit('palace.item.hornToken', 1, y + 0.2);
}

// 金鳞宝甲：T-ITM-0118
/** 金鳞宝甲：甲架 + 甲身（六层金鳞）+ 护肩双片 + 护心镜 + 甲裙 + 夜微光（亢金龙府正堂甲架） */
function itmScaleArmor(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('wood', 0.72, 0.1, 0.42, x, y + 0.05, z, shade(0x4a3220, 1), ry);
  for (const su of [-1, 1]) {
    const [px, pz] = L(su * 0.3, 0);
    b.box('wood', 0.09, 2.0, 0.09, px, y + 1.05, pz, shade(0x5a3a24, 1.04), ry);
  }
  b.box('wood', 0.66, 0.07, 0.07, x, y + 2.02, z, shade(0x5a3a24, 1.1), ry);
  for (let r = 0; r < 6; r++) {                                                          // 六层金鳞
    const [ax, az] = L(0, -0.1);
    b.box('metal', 0.46 - r * 0.02, 0.09, 0.16, ax, y + 1.72 - r * 0.13, az, shade(GOLD_TRIM, 1.02 - (r % 2) * 0.1), ry);
    b.box('glow', 0.4 - r * 0.02, 0.012, 0.02, ax, y + 1.68 - r * 0.13, az - 0.085, shade(GOLD_LINE, 0.5), ry);
  }
  for (const su of [-1, 1]) {                                                            // 护肩
    const [sx2, sz2] = L(su * 0.29, 0);
    b.box('metal', 0.2, 0.1, 0.24, sx2, y + 1.76, sz2, shade(GOLD_LINE, 0.95), ry, 0, -su * 0.3);
  }
  const [mx, mz] = L(0, -0.19);
  b.cyl('glow', 0.12, 0.12, 0.03, 12, mx, y + 1.5, mz, shade(0xfff3d8, 0.9), 0, Math.PI / 2); // 护心镜
  for (let k = 0; k < 5; k++) {                                                          // 甲裙
    const [kx, kz] = L(-0.18 + k * 0.09, -0.12);
    b.box('fabric', 0.075, 0.34, 0.14, kx, y + 0.93, kz, shade(0x8a2a20, 0.95 + (k % 2) * 0.1), ry);
  }
  b.kit('palace.item.scaleArmor', 1, y + 1.2);
}

// 狼府星图壁挂：T-ITM-0127
/** 狼府星图壁挂：上下木轴 + 灵绢星图 + 星点 + 奎宿高亮三星 + 挂绳（正堂北墙） */
function itmWolfStarMap(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  for (const sy2 of [-0.58, 0.58]) b.box('wood', 1.7, 0.1, 0.1, x, y + sy2, z, shade(0x4a3220, 1.12), ry); // 上下轴
  b.box('fabric', 1.58, 1.12, 0.03, x, y, z, shade(0x223a5e, 0.98), ry);                   // 灵绢
  for (let k = 0; k < 14; k++) {                                                          // 星点
    const [sx2, sz2] = L(-0.66 + ((k * 37) % 13) * 0.11, 0);
    b.box('glow', 0.035, 0.035, 0.014, sx2, y - 0.42 + ((k * 23) % 9) * 0.1, sz2 + 0.02, shade(0xdcdce8, 0.4 + (k % 3) * 0.2), ry);
  }
  for (let k = 0; k < 3; k++) {                                                           // 奎宿高亮三星
    const [sx2, sz2] = L(0.16 + k * 0.18, 0);
    b.box('glow', 0.08, 0.08, 0.016, sx2, y - 0.06 + k * 0.09, sz2 + 0.025, shade(0x7fffd4, 0.95), ry, 0, Math.PI / 4);
  }
  b.box('fabric', 0.03, 0.3, 0.02, x, y + 0.73, z, shade(0xd8c8a0, 0.8), ry);              // 挂绳
  b.kit('palace.item.wolfStarMap', 1, y);
}

// 陨铁磨爪石：T-ITM-0126
/** 陨铁磨爪石：青石基座 + 陨铁石（三段磨面）+ 三道爪痕 + 磨痕微光（奎木狼府磨爪场） */
function itmMeteorClawStone(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.cyl('ash', 0.62, 0.72, 0.2, 10, x, y + 0.1, z, shade(0x9a948c, 1.0));
  b.box('metal', 0.86, 0.42, 0.62, x, y + 0.4, z, shade(IRONB, 1.25), ry);
  b.box('metal', 0.7, 0.16, 0.5, x, y + 0.68, z, shade(IRONB, 1.45), ry, 0.14);
  b.box('metal', 0.44, 0.1, 0.34, x, y + 0.78, z, shade(IRONB, 1.6), ry, 0.14);
  for (let k = 0; k < 3; k++) {                                                          // 爪痕（深可没指）
    const [cx2, cz2] = L(-0.18 + k * 0.2, -0.26);
    b.box('glow', 0.05, 0.3, 0.02, cx2, y + 0.44, cz2, shade(0x7fffd4, 0.55), ry);
  }
  const [gx2, gz2] = L(0.3, -0.28);
  b.box('glow', 0.02, 0.4, 0.02, gx2, y + 0.45, gz2, shade(0x9fe8ff, 0.4), ry);
  b.kit('palace.item.meteorClawStone', 1, y + 0.4);
}

// 獬豸冠：T-ITM-0128
/** 獬豸冠：铜冠 + 独角正直微翘 + 冠梁 + 冠架（斗木獬身份物，斗堂冠架） */
function itmXiezhiCrown(b: Baker, x: number, y: number, z: number, ry: number): void {
  crownStand(b, x, y, z, 0.8);
  const cy2 = y + 1.02;
  b.cyl('metal', 0.19, 0.21, 0.14, 10, x, cy2 + 0.07, z, shade(BRZ, 0.98), ry);
  b.box('metal', 0.34, 0.05, 0.26, x, cy2 + 0.01, z, shade(BRZ, 1.14), ry);
  for (let k = 0; k < 3; k++) {                                                          // 独角（三段微翘）
    b.box('metal', 0.07, 0.14, 0.07, x + 0.02 * k, cy2 + 0.2 + k * 0.13, z - 0.03, shade(BRZ, 1.1 - k * 0.05), ry, -0.06 * k);
  }
  b.cyl('glow', 0.045, 0.045, 0.05, 6, x + 0.04, cy2 + 0.56, z - 0.09, shade(0xdcdce8, 0.8));
  for (const su of [-1, 1]) {
    const [wx2, wz2] = lframe(x, z, ry)(su * 0.12, 0.06);
    b.box('metal', 0.05, 0.2, 0.05, wx2, cy2 + 0.16, wz2, shade(BRZ, 1.02), ry, 0, su * 0.24);
  }
  b.kit('palace.item.xiezhiCrown', 1, y + 1.0);
}

// 牛金牛铜铃：T-ITM-0129
/** 牛金牛铜铃：檐下悬绳 + 铃纽 + 铜铃身 + 铃口 + 金牛角铃舌（风动铃响），成对挂牛堂檐下 */
function itmOxBell(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  for (const su of [-1, 1]) {
    const [bx2, bz2] = L(su * 1.5, 0);
    b.box('fabric', 0.03, 0.34, 0.03, bx2, y + 0.17, bz2, shade(0x8a7a5a, 0.9), ry);       // 悬绳
    b.box('metal', 0.05, 0.06, 0.05, bx2, y - 0.02, bz2, shade(BRZ, 1.05), ry);            // 铃纽
    b.cyl('metal', 0.14, 0.2, 0.26, 10, bx2, y - 0.18, bz2, shade(BRZ, 1.02));             // 铃身
    b.cyl('metal', 0.21, 0.16, 0.05, 10, bx2, y - 0.32, bz2, shade(BRZ, 0.92));            // 铃口
    b.box('metal', 0.05, 0.16, 0.05, bx2, y - 0.4, bz2, shade(GOLD_TRIM, 0.9), ry, 0, su * 0.4); // 金牛角铃舌
    b.cyl('glow', 0.05, 0.05, 0.14, 6, bx2, y - 0.16, bz2, shade(0xffd25e, 0.7));
  }
  b.kit('palace.item.oxBell', 2, y);
}

// 报晓天鸡冠：T-ITM-0133
/** 报晓天鸡冠：赤金冠 + 冠顶红珠 + 冠梁双翼 + 冠架（昴日鸡身份物，正堂冠架） */
function itmRoosterCrown(b: Baker, x: number, y: number, z: number, ry: number): void {
  crownStand(b, x, y, z, 0.82);
  const cy2 = y + 1.04;
  b.cyl('metal', 0.18, 0.2, 0.15, 10, x, cy2 + 0.075, z, shade(0xd8a840, 1.06), ry);
  b.box('metal', 0.32, 0.05, 0.24, x, cy2 + 0.01, z, shade(0xd8a840, 1.14), ry);
  for (let k = 0; k < 3; k++) {                                                          // 冠齿（天鸡三距）
    b.box('metal', 0.05, 0.12 + k * 0.04, 0.05, x - 0.09 + k * 0.09, cy2 + 0.2 + k * 0.02, z + 0.04, shade(0xd8a840, 1.1 + k * 0.05), ry, 0, 0.2);
  }
  b.cyl('glow', 0.055, 0.055, 0.06, 8, x, cy2 + 0.3, z - 0.04, shade(0xff3a4a, 0.95));   // 冠顶红珠
  for (const su of [-1, 1]) {
    const [wx2, wz2] = lframe(x, z, ry)(su * 0.15, 0.02);
    b.box('metal', 0.06, 0.16, 0.05, wx2, cy2 + 0.12, wz2, shade(0xd8a840, 1.0), ry, 0, su * 0.3);
  }
  b.kit('palace.item.roosterCrown', 1, y + 1.0);
}

// 晨啼音叉：T-ITM-0135
/** 晨啼音叉：金音叉（柄 + 双股 + 交叉座）+ 共鸣木箱 + 木座（正堂案，校准报晓音高） */
function itmDawnFork(b: Baker, x: number, y: number, z: number, ry: number): void {
  const L = lframe(x, z, ry);
  b.box('wood', 0.3, 0.09, 0.22, x, y + 0.045, z, shade(0x6b4a2b, 1.06), ry);            // 木座
  b.box('wood', 0.24, 0.12, 0.18, x, y + 0.15, z, shade(0x5a3a24, 1.04), ry);            // 共鸣箱
  b.box('glow', 0.02, 0.06, 0.1, x + 0.125, y + 0.15, z, shade(0xffd25e, 0.5), ry);      // 音孔
  b.cyl('metal', 0.025, 0.03, 0.24, 6, x, y + 0.33, z, shade(GOLD_TRIM, 1.0));            // 柄
  const [bx2, bz2] = L(0, 0);
  b.box('metal', 0.14, 0.05, 0.05, bx2, y + 0.45, bz2, shade(GOLD_TRIM, 1.05), ry);       // 交叉座
  for (const su of [-1, 1]) {
    const [px2, pz2] = L(su * 0.06, 0);
    b.box('metal', 0.035, 0.34, 0.035, px2, y + 0.64, pz2, shade(GOLD_TRIM, 1.08), ry);   // 双股
  }
  b.box('glow', 0.24, 0.02, 0.02, x, y + 0.81, z, shade(0xfff3d8, 0.55), ry);            // 音芒
  b.kit('palace.item.dawnFork', 1, y + 0.3);
}

/** 灵霄八间：案面各置一副灵墨玉简笔砚；R02 文书房另置值殿名录（T-ITM-0078 / T-ITM-0160） */
function furnishLingxiao(b: Baker, a: RoomAnchors, idx: number): void {
  const y = a.fy + 1.09, ry = deskRy(a);
  const [ix, iz] = onDesk(a, 1.55, 0);
  itmInkSlabSet(b, ix, y, iz, ry);
  if (idx === 1) {
    const [rx2, rz2] = onDesk(a, -0.55, 0);
    itmRosterSlips(b, rx2, y, rz2, ry);
  }
}

/** 瑶池八间：R01 窖室龛位 / R02 妆间 / R03 装间 / R04 器物间 / R05 书案间 / R06 酒窖 */
function furnishYaochi(b: Baker, a: RoomAnchors, idx: number): void {
  const y = a.fy + 1.09, ry = deskRy(a);
  if (idx === 0) {
    itmSundialShard(b, a.cx + 1.5, a.fy, a.cz + 2.6, 0);
  } else if (idx === 1) {
    const [px, pz] = onDesk(a, -0.85, 0);
    itmRougeBox(b, px, y, pz, ry);
  } else if (idx === 2) {
    itmNightCloak(b, a.cx + 0.9, a.fy, a.cz + 0.4, 0.3);
  } else if (idx === 3) {
    itmDigSpade(b, a.cx - 1.6, a.fy, a.cz + 0.9, 0.24);
    itmGlazedBricks(b, a.cx + 0.3, a.fy, a.cz + 2.72, 0);              // T-ITM-0176 备用琉璃阶砖×24（灯库砖垛）
  } else if (idx === 4) {
    const [bx, bz] = onDesk(a, 2.45, 0);
    itmRavenBrush(b, bx, y, bz, ry);
    const [mx, mz] = onDesk(a, -2.5, 0);
    itmMoonInk(b, mx, y, mz, ry);
  } else if (idx === 5) {
    const [gx, gz] = onDesk(a, 2.35, 0);
    itmWineGourd(b, gx, y, gz, ry);
  }
}

/** 蟠桃看园房：R01 案上园志玉简（T-ITM-0027） */
function furnishPantao(b: Baker, a: RoomAnchors, idx: number): void {
  if (idx !== 0) return;
  const [gx, gz] = onDesk(a, 1.42, 0);
  itmGardenLog(b, gx, a.fy + 1.09, gz, deskRy(a));
}

/** 星宿八府：角木蛟（蛟角冠 + 角宿令牌）/ 亢金龙（金鳞宝甲）/ 奎木狼（星图壁挂 + 府侧磨爪场）/ 斗牛宫（獬豸冠 + 檐下铜铃）/ 昴日鸡（天鸡冠 + 晨啼音叉）/ 心月狐（心宿迷香） */
function furnishXingxiu(b: Baker, a: RoomAnchors, idx: number): void {
  const y = a.fy + 1.09, ry = deskRy(a);
  if (idx === 0) {
    itmDragonCrown(b, a.cx + 0.9, a.fy, a.cz - 0.45, 0.4);
    const [tx2, tz2] = onDesk(a, -0.75, 0);
    itmHornToken(b, tx2, y, tz2, ry);
  } else if (idx === 1) {
    itmScaleArmor(b, a.cx + 0.8, a.fy, a.cz - 0.35, -0.3);
  } else if (idx === 2) {
    itmWolfStarMap(b, a.cx, a.fy + 2.34, a.cz - a.ih + 0.1, 0);
    itmMeteorClawStone(b, a.cx + 4.6, HALL_Y + 0.12, a.cz + 3.9, 0);   // 府东侧磨爪场（星宿府云台面 214.12）
    itmHiddenRobe(b, a.cx - 0.9, a.fy, a.cz - 0.8, 0.3);               // T-ITM-0124 下界私藏黄袍（藏物暗间木箱）
  } else if (idx === 3) {
    itmXiezhiCrown(b, a.cx + 0.9, a.fy, a.cz - 0.45, -0.2);
    itmOxBell(b, a.cx, a.fy + 4.2, a.cz + 3.45, 0);
    itmStarRaftModel(b, a.cx + 0.9, a.fy, a.cz - 0.8, 0.2);            // T-ITM-0131 星槎模型（共星台星台架）
  } else if (idx === 4) {
    itmRoosterCrown(b, a.cx + 0.9, a.fy, a.cz - 0.45, 0.3);
    const [fx2, fz2] = onDesk(a, 2.2, 0);
    itmDawnFork(b, fx2, y, fz2, ry);
  } else if (idx === 5) {
    const [hx2, hz2] = onDesk(a, 2.2, 0);
    itmHeartIncense(b, hx2, y, hz2, ry);
  } else if (idx === 6) {
    itmMeritRack(b, a.cx - 0.9, a.fy, a.cz - 0.8, 0);                  // T-ITM-0169 星官考功簿×12（考功房架）
  } else if (idx === 7) {
    itmCellarHatch(b, a.cx + 1.0, a.fy, a.cz - 0.75, 0);               // T-ITM-0149 机括地窖门（窖室入口）
    for (let k = 0; k < 4; k++) itmGrainSilo(b, a.cx - 2.85 + k * 0.75, a.fy, a.cz - 1.1, k * 0.4); // T-ITM-0151 五谷灵仓×4（粮囤廊）
  }
}

/** 灵霄明间台面：正堂两列通明长烛 + 传令金牌令架 + 传旨玉音铃（待漏更香见门前柱侧） */
function buildLingxiaoNaveRelics(b: Baker): void {
  const ny = HALL_Y + 5.58;          // 明间台明顶 219.58（与 lingxiaoNave 的 fy+0.62 同高）
  const fyFloor = HALL_Y + 4.96;     // 殿内地面 218.96（台明之外）
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) itmTallCandle(b, sx * 7.4, ny, 89.4 + k * 3.7);
  itmGoldTokenRack(b, -4.4, ny, 101.2, 0);
  itmJadeBell(b, 5.2, ny, 99.2, 0);
  for (const sx of [-1, 1]) itmHourIncense(b, sx * 5.7, fyFloor, 103.6);
}

// ============ WS-43：天厨 / 天库 / 武库 / 星宿府 14 件 T-ITM data-only 补建 ============
// 台账 10 卷 §T-GZ-010 御膳房 / §T-GZ-011 天库 / §T-GZ-012 武库 / §T-GZ-017~022 星宿九府。
// 材质口径同 WS-38：玉/石 → ash（浅色）、金铜 → metal、宝光 → glow、木作 → wood、漆器 → lacquer、锦绫 → fabric、瓷皿 → ceramic。
// 御膳房/天库/武库殿身是实心盒体，器物一律落台面外廊（台面 206.12 / 207.12），不塞进盒体；星宿府器物走 RoomAnchors 后区空地。

/** 九眼聚灵灶：玄铁灶身 + 九灶眼（文武地天水风雷山泽九色火）+ 炉门 + 烟囱 + 铜壶（灶间，烹饪小游戏主设备） */
// 九眼聚灵灶：T-ITM-0085
function itmNineEyeStove(b: Baker, x: number, y: number, z: number): void {
  b.box('metal', 1.24, 0.12, 0.92, x, y + 0.06, z, shade(IRONB, 1.55));              // 灶脚
  b.box('metal', 1.14, 0.58, 0.84, x, y + 0.41, z, shade(IRONB, 1.22));              // 灶身
  b.box('metal', 1.22, 0.1, 0.9, x, y + 0.75, z, shade(IRONB, 1.48));                // 灶面
  const FIRE = [0xff7a2d, 0xffd25e, 0x9fe8ff, 0x4fd2ff, 0x6be8a0, 0xc8b8ff, 0xff5a7a, 0xffb050, 0x8ec8ff];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const ex = x - 0.34 + c * 0.34, ez = z - 0.27 + r * 0.27;
      b.cyl('metal', 0.135, 0.135, 0.05, 8, ex, y + 0.82, ez, shade(IRONB, 1.78));                    // 灶眼圈
      b.cyl('glow', 0.1, 0.07, 0.1, 8, ex, y + 0.85, ez, FIRE[r * 3 + c], 0, 0, 0, true);             // 九色火
    }
  }
  b.box('metal', 0.38, 0.22, 0.06, x, y + 0.32, z + 0.44, shade(BRZ, 1.05));         // 炉门框
  b.box('glow', 0.3, 0.15, 0.03, x, y + 0.32, z + 0.48, shade(0xff7a2d, 0.9));       // 炉门火
  b.box('metal', 0.1, 1.05, 0.1, x + 0.46, y + 1.28, z - 0.3, shade(IRONB, 1.32));   // 烟囱
  b.cyl('metal', 0.14, 0.14, 0.08, 8, x + 0.46, y + 1.82, z - 0.3, shade(BRZ, 1.06));
  b.cyl('glow', 0.07, 0.05, 0.16, 5, x + 0.46, y + 1.93, z - 0.3, shade(0xdfeeff, 0.45), 0, 0, 0, true); // 炊烟
  b.cyl('metal', 0.17, 0.2, 0.2, 10, x, y + 0.99, z, shade(BRZ, 1.08));              // 铜壶
  b.cyl('metal', 0.1, 0.14, 0.06, 8, x, y + 1.12, z, shade(BRZ, 1.2));
  b.box('metal', 0.22, 0.045, 0.05, x + 0.21, y + 1.01, z, shade(BRZ, 1.02), 0, 0, -0.32); // 壶嘴
  b.box('metal', 0.05, 0.15, 0.05, x - 0.18, y + 1.07, z, shade(BRZ, 1.02));         // 提梁
  b.kit('palace.item.nineEyeStove', 1, y);
}

/** 天材冰鉴：玉鉴身 + 冰裂纹四壁 + 半启鉴盖 + 寒晶钮 + 双铜提环 + 鉴座（冰鉴房，恒温藏珍稀食材） */
// 天材冰鉴：T-ITM-0086
function itmIceCoffer(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('ash', 1.34, 0.16, 1.04, x, y + 0.08, z, shade(0x8a8f96, 1.12), ry);        // 鉴座
  b.box('ash', 1.24, 0.74, 0.94, x, y + 0.53, z, shade(JADEB, 1.0), ry);             // 鉴身（青玉）
  b.box('ash', 1.3, 0.08, 1.0, x, y + 0.94, z, shade(JADEB, 1.16), ry);              // 鉴口
  for (let k = 0; k < 5; k++) {                                                       // 冰裂纹（正背两面）
    const [fx, fz] = L(-0.34 + k * 0.17, 0.48);
    b.box('glow', 0.34 + k * 0.04, 0.025, 0.015, fx, y + 0.48 + (k % 2) * 0.13, fz, shade(0x9fe8ff, 0.62), ry, 0, 0.62 - k * 0.2);
    const [bx2, bz2] = L(-0.3 + k * 0.16, -0.48);
    b.box('glow', 0.3, 0.025, 0.015, bx2, y + 0.58 - (k % 2) * 0.11, bz2, shade(0x9fe8ff, 0.55), ry, 0, -0.5 + k * 0.18);
  }
  b.box('ash', 1.26, 0.12, 0.96, x, y + 1.05, z, shade(JADEB, 1.24), ry, 0.05);      // 鉴盖（微启）
  b.cyl('ash', 0.1, 0.14, 0.14, 6, x, y + 1.19, z, shade(0x9fe8ff, 0.95));           // 寒晶钮
  b.cyl('glow', 0.2, 0.2, 0.04, 10, x, y + 1.25, z, shade(0x9fe8ff, 0.5), 0, 0, 0, true); // 钮上寒光
  for (const su of [-1, 1]) {                                                         // 双铜提环
    const [hx2, hz2] = L(su * 0.5, 0.52);
    b.box('metal', 0.1, 0.06, 0.06, hx2, y + 0.9, hz2, shade(BRZ, 1.06), ry);
  }
  b.box('glow', 0.9, 0.02, 0.02, x, y + 0.99, z + 0.5, shade(0x9fe8ff, 0.55), ry);   // 寒气缝
  b.kit('palace.item.iceCoffer', 1, y);
}

/** 玉馔云台：双云柱（柱础 + 云头）+ 架空灵脉光轨 + 三条流光 + 轨上玉盘三只（尾部两盘「追尾」彩蛋） */
// 玉馔云台：T-ITM-0087
function itmJadeFoodRail(b: Baker, x: number, y: number, z: number): void {
  for (const sx of [-1, 1]) {
    b.cyl('ash', 0.3, 0.44, 0.24, 8, x + sx * 4.6, y + 0.12, z, shade(JADEB, 1.02));      // 柱础
    b.cyl('ash', 0.15, 0.22, 2.5, 8, x + sx * 4.6, y + 1.5, z, shade(JADEB, 1.1));       // 云柱
    b.cyl('glow', 0.46, 0.3, 0.2, 8, x + sx * 4.6, y + 2.78, z, shade(0x9fe8ff, 0.55));  // 云头
  }
  b.box('ash', 9.4, 0.14, 0.44, x, y + 2.5, z, shade(0xe8eef8, 1.06));                  // 光轨主梁
  const FLOW = [0x9fe8ff, 0x7fd8ff, 0xc8f0ff];
  for (let k = 0; k < 3; k++) b.box('glow', 9.2, 0.05, 0.08, x, y + 2.59, z - 0.14 + k * 0.14, FLOW[k]);
  const PLATE: [number, number, number][] = [[-2.6, 0, 0xffd25e], [0.4, -0.14, 0x9fe8ff], [1.2, 0.3, 0xffb0c8]];
  for (const [ox, oz, tint] of PLATE) {
    b.cyl('ash', 0.34, 0.28, 0.1, 10, x + ox, y + 2.66, z + oz, shade(JADEW, 1.02));    // 玉盘
    b.cyl('glow', 0.26, 0.26, 0.04, 10, x + ox, y + 2.72, z + oz, tint);                // 盘心菜光
    b.cyl('ash', 0.2, 0.16, 0.12, 8, x + ox, y + 2.8, z + oz, shade(JADEW, 1.12));      // 菜罩
  }
  b.kit('palace.item.jadeFoodRail', 1, y + 2.5);
}

/** 仙厨菜谱玉简：三格玉简架（宴/茶/素三色签）+ 三十枚玉简 + 朱字刻槽（菜谱架，阅读解锁新菜谱） */
// 仙厨菜谱玉简：T-ITM-0091
function itmRecipeRack(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const [px, pz] = L(su * 0.64, sw * 0.2);
    b.box('wood', 0.08, 2.4, 0.08, px, y + 1.2, pz, shade(0x6b4a2b, 1.06), ry);
  }
  const TAG = [0xffd25e, 0x9fe8ff, 0xd8e8c0];
  for (let k = 0; k < 3; k++) {
    const sy = y + 0.55 + k * 0.8;
    b.box('wood', 1.34, 0.06, 0.46, x, sy, z, shade(0x6b4a2b, 1.12), ry);                    // 格板
    const [tx0, tz0] = L(-0.66, 0.24);
    b.box('glow', 0.1, 0.22, 0.03, tx0, sy + 0.36, tz0, TAG[k], ry);                          // 宴/茶/素签
    for (let i = 0; i < 10; i++) {
      const [px, pz] = L(-0.54 + i * 0.12, 0);
      b.box('ash', 0.05, 0.32, 0.26, px, sy + 0.19, pz, shade(JADEW, 0.94 + (i % 3) * 0.05), ry);  // 玉简
      b.box('glow', 0.04, 0.02, 0.18, px, sy + 0.31, pz, shade(TAG[k], 0.62), ry);                  // 刻字槽
    }
  }
  b.kit('palace.item.recipeRack', 1, y + 0.55);
}

/** 库藏夜明珠：三尺龛架（六龛）+ 六座 + 六珠 + 光晕（宝库龛位，恒亮作库灯；少一颗触发寻宝） */
// 库藏夜明珠：T-ITM-0093
function itmNightPearlNiche(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('wood', 0.34, 2.56, 3.36, x, y + 1.28, z, shade(0x223a5e, 1.12), ry);         // 龛架背板
  for (const sw of [-1, 1]) {
    const [px, pz] = L(0.12, sw * 1.74);
    b.box('wood', 0.36, 2.56, 0.1, px, y + 1.28, pz, shade(0x223a5e, 1.26), ry);       // 龛架侧板
  }
  for (let k = 0; k < 3; k++) {
    const sy = y + 0.62 + k * 0.78;
    const [nx, nz] = L(0.08, 0);
    b.box('wood', 0.42, 0.08, 3.36, nx, sy, nz, shade(0x223a5e, 1.2), ry);             // 龛板
    for (let i = 0; i < 2; i++) {
      const [px, pz] = L(0.28, -0.86 + i * 1.72);
      b.cyl('metal', 0.14, 0.18, 0.1, 8, px, sy + 0.09, pz, shade(BRZ, 1.06));          // 珠座
      b.cyl('glow', 0.13, 0.13, 0.26, 10, px, sy + 0.27, pz, 0xfff3d8);                 // 夜明珠
      b.cyl('glow', 0.26, 0.26, 0.05, 10, px, sy + 0.27, pz, shade(0xfff3d8, 0.4), 0, Math.PI / 2, 0, true); // 光晕
    }
  }
  b.kit('palace.item.nightPearlNiche', 1, y + 0.6);
}

/** 天庭库簿玉简：双格帐架 + 十二册玉簿（分年记档，册脊铜签）+ 架顶符光（读天庭「财政年报」彩蛋） */
// 天庭库簿玉简：T-ITM-0094
function itmLedgerRack(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const [px, pz] = L(su * 0.5, sw * 1.0);
    b.box('wood', 0.09, 1.92, 0.09, px, y + 0.96, pz, shade(0x4a3220, 1.08), ry);
  }
  for (let k = 0; k < 2; k++) {
    const sy = y + 0.62 + k * 0.72;
    b.box('wood', 1.08, 0.07, 2.1, x, sy, z, shade(0x4a3220, 1.14), ry);                       // 帐架格板
    for (let i = 0; i < 6; i++) {
      const [px, pz] = L(0, -0.82 + i * 0.33);
      b.box('ash', 0.9, 0.1, 0.26, px, sy + 0.09, pz, shade(JADEB, 0.98 + (i % 3) * 0.04), ry); // 玉簿（平叠）
      const [mx2, mz2] = L(0.44, -0.82 + i * 0.33);
      b.box('metal', 0.06, 0.12, 0.2, mx2, sy + 0.09, mz2, shade(BRZ, 0.92), ry);              // 册脊铜签
    }
  }
  b.box('glow', 1.0, 0.03, 0.03, x, y + 1.9, z, shade(0x9fe8ff, 0.55), ry);                    // 架顶符光
  b.kit('palace.item.ledgerRack', 1, y + 0.6);
}

/** 仙衡天平：玉座 + 玉衡立柱 + 铜衡杆 + 双铜盘（各三链）+ 衡心宝光（天平间，趣味称「功德」） */
// 仙衡天平：T-ITM-0096
function itmImmortalBalance(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('ash', 0.94, 0.18, 0.94, x, y + 0.09, z, shade(JADEB, 1.04), ry);              // 玉座
  b.box('ash', 0.62, 0.14, 0.62, x, y + 0.25, z, shade(JADEB, 1.14), ry);              // 座上承台
  b.cyl('ash', 0.07, 0.11, 1.52, 8, x, y + 1.06, z, shade(JADEW, 1.06));               // 玉衡立柱
  b.box('metal', 2.3, 0.07, 0.09, x, y + 1.84, z, shade(BRZ, 1.1), ry);                // 铜衡杆
  for (const su of [-1, 1]) {
    const [px, pz] = L(su * 1.14, 0);
    b.box('metal', 0.1, 0.1, 0.1, px, y + 1.8, pz, shade(BRZ, 1.22), ry);              // 衡端
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.5;
      b.box('metal', 0.02, 0.62, 0.02, px + Math.cos(a) * 0.2, y + 1.48, pz + Math.sin(a) * 0.2, shade(BRZD, 1.05)); // 三链
    }
    b.cyl('metal', 0.32, 0.26, 0.08, 12, px, y + 1.13, pz, shade(BRZ, 1.06));          // 铜盘
    b.cyl('glow', 0.24, 0.24, 0.03, 12, px, y + 1.19, pz, shade(0xffd25e, 0.5));       // 盘心光
  }
  b.cyl('glow', 0.09, 0.09, 0.1, 8, x, y + 1.92, z, shade(0xfff3d8, 0.8));             // 衡心宝光
  b.kit('palace.item.immortalBalance', 1, y);
}

/** 战鼓：铜环鼓架（双立柱 + 双铜环）+ 蒙革鼓身 + 双面鼓皮 + 雷纹鼓钉 + 双槌（演武小院开战鼓点音源） */
// 战鼓：T-ITM-0101
function itmWuKuDrum(b: Baker, x: number, y: number, z: number): void {
  for (const sw of [-1, 1]) {
    b.box('metal', 0.15, 1.74, 0.15, x, y + 0.87, z + sw * 0.78, shade(BRZ, 0.94));           // 立柱
    b.box('metal', 0.34, 0.1, 0.56, x, y + 0.05, z + sw * 0.78, shade(BRZD, 1.04));           // 柱脚
    b.box('metal', 0.4, 0.12, 0.16, x, y + 1.66, z + sw * 0.78, shade(BRZ, 1.08));            // 柱头
    b.cyl('metal', 0.66, 0.66, 0.1, 16, x, y + 0.98, z + sw * 0.34, shade(BRZ, 1.14), 0, Math.PI / 2, 0, true); // 铜环
  }
  b.cyl('lacquer', 0.64, 0.64, 0.92, 16, x, y + 0.98, z, shade(LQCR, 1.02), 0, Math.PI / 2);  // 鼓身
  for (const sw of [-1, 1]) {
    b.cyl('fabric', 0.65, 0.65, 0.05, 16, x, y + 0.98, z + sw * 0.47, shade(0xd8c8a0, 1.02), 0, Math.PI / 2); // 鼓皮
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      b.box('glow', 0.16, 0.04, 0.03, x + Math.cos(a) * 0.4, y + 0.98 + Math.sin(a) * 0.4, z + sw * 0.5, shade(0xffd25e, 0.55), 0, 0, a); // 雷纹
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.box('metal', 0.07, 0.07, 0.05, x + Math.cos(a) * 0.58, y + 0.98 + Math.sin(a) * 0.58, z + sw * 0.5, shade(GOLD_TRIM, 0.9)); // 鼓钉
    }
  }
  for (let i = 0; i < 2; i++) {
    b.cyl('wood', 0.03, 0.035, 0.62, 6, x + 0.8, y + 0.32, z + 0.04 + i * 0.16, shade(0x6b4a2b, 1.06), 0, 0, 0.4);  // 槌柄
    b.cyl('metal', 0.08, 0.08, 0.17, 8, x + 0.66, y + 0.58, z + 0.04 + i * 0.16, shade(BRZ, 1.06), 0, 0, 0.4);      // 包铜槌头
  }
  b.kit('palace.item.wukuDrum', 1, y + 0.98);
}

/** 下界私藏黄袍：木箱 + 折叠黄锦 + 锦缘金线 + 压角玉镇 + 半开箱盖（奎木狼府藏物暗间，翻开触发星官紧张对话） */
// 下界私藏黄袍：T-ITM-0124
function itmHiddenRobe(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('wood', 0.94, 0.56, 0.68, x, y + 0.28, z, shade(0x6b4a2b, 1.04), ry);        // 箱身
  for (const sw of [-1, 1]) {
    const [hx2, hz2] = L(0, sw * 0.31);
    b.box('metal', 0.12, 0.1, 0.05, hx2, y + 0.34, hz2, shade(BRZ, 1.0), ry);          // 铜扣
  }
  b.box('fabric', 0.74, 0.16, 0.5, x, y + 0.62, z, shade(0xd4b76a, 1.06), ry);         // 黄锦（折叠）
  b.box('fabric', 0.6, 0.1, 0.38, x, y + 0.73, z, shade(0xe8c86a, 1.04), ry);
  b.box('glow', 0.5, 0.02, 0.02, x, y + 0.79, z, shade(0xffd25e, 0.6), ry);           // 锦缘金线
  const [gx2, gz2] = L(-0.3, 0.16);
  b.box('ash', 0.16, 0.1, 0.16, gx2, y + 0.83, gz2, shade(JADEW, 1.06), ry);           // 压角玉镇
  const [lx2, lz2] = L(0.42, 0);
  b.box('wood', 0.66, 0.1, 0.54, lx2, y + 0.74, lz2, shade(0x5a3a24, 1.08), ry, 0, -0.34); // 半开箱盖
  b.kit('palace.item.hiddenRobe', 1, y);
}

/** 星槎模型：星台木架 + 缩比槎身（首尾上翘）+ 三桅云帆 + 槎尾云纹光（斗牛宫星台架，读天河渡口史彩蛋） */
// 星槎模型：T-ITM-0131
function itmStarRaftModel(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const [px, pz] = L(su * 0.4, sw * 0.26);
    b.box('wood', 0.07, 0.4, 0.07, px, y + 0.2, pz, shade(0x4a3220, 0.98), ry);      // 架腿
  }
  b.box('wood', 1.02, 0.07, 0.68, x, y + 0.43, z, shade(0x5a3a24, 1.1), ry);          // 星台架面
  b.box('glow', 0.9, 0.02, 0.02, x, y + 0.47, z + 0.3, shade(0x9fe8ff, 0.55), ry);    // 台沿星线
  b.box('wood', 0.3, 0.14, 0.84, x, y + 0.55, z, shade(0x8a6a3e, 1.05), ry);          // 槎身（中段）
  for (const su of [-1, 1]) {                                                          // 首尾上翘
    const [px, pz] = L(0, su * 0.48);
    b.box('wood', 0.24, 0.16, 0.2, px, y + 0.62, pz, shade(0x8a6a3e, 1.16), ry, su * 0.42);
  }
  for (let k = 0; k < 3; k++) {                                                        // 三桅云帆
    const [px, pz] = L(-0.24 + k * 0.24, 0);
    b.box('wood', 0.03, 0.34, 0.03, px, y + 0.76, pz, shade(0x6b4a2b, 1.1), ry);
    b.box('fabric', 0.03, 0.2, 0.16, px, y + 0.82, pz, shade(0xe8f0f8, 0.96), ry);
  }
  b.box('glow', 0.3, 0.05, 0.05, x, y + 0.56, z - 0.42, shade(0x9fe8ff, 0.6), ry);    // 槎尾云纹光
  b.kit('palace.item.starRaftModel', 1, y);
}

/** 机括地窖门：石框窖口 + 滑轨 + 半开滑板 + 三重暗销（三色铜销）+ 窥窖铜环 + 窖内幽光（虚日鼠府窖室入口） */
// 机括地窖门：T-ITM-0149
function itmCellarHatch(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  const SFRAME = 0x9a948c;                                                           // 窖口青石
  for (const sw of [-1, 1]) {
    const [px, pz] = L(0, sw * 0.62);
    b.box('ash', 1.62, 0.16, 0.16, px, y + 0.08, pz, shade(SFRAME, 1.02), ry);      // 窖口前/后石框
  }
  for (const su of [-1, 1]) {
    const [px, pz] = L(su * 0.73, 0);
    b.box('ash', 0.16, 0.16, 1.24, px, y + 0.08, pz, shade(SFRAME, 0.98), ry);       // 窖口左/右石框
    const [qx, qz] = L(su * 0.8, 0);
    b.box('metal', 0.08, 0.08, 1.4, qx, y + 0.2, qz, shade(BRZ, 0.86), ry);          // 滑轨
  }
  b.box('lacquer', 1.34, 0.06, 1.06, x, y + 0.02, z, shade(0x14161c, 1.0), ry);      // 窖口暗腔
  b.box('glow', 0.9, 0.02, 0.12, x, y + 0.06, z + 0.3, shade(0x7fd8ff, 0.35), ry);   // 窖底幽光
  const [sx2, sz2] = L(0.62, 0);
  b.box('wood', 1.1, 0.12, 1.02, sx2, y + 0.26, sz2, shade(0x4a3220, 1.1), ry);      // 滑板（半开）
  b.box('wood', 1.16, 0.06, 1.08, sx2, y + 0.33, sz2, shade(0x5a3a24, 1.16), ry);     // 滑板压条
  const PINS = [GOLD_TRIM, 0xd8d0c0, 0xc88a5a];
  for (let k = 0; k < 3; k++) {                                                      // 三重暗销
    const [px, pz] = L(-0.72, -0.4 + k * 0.4);
    b.cyl('metal', 0.05, 0.05, 0.1, 6, px, y + 0.2, pz, PINS[k]);
    b.cyl('glow', 0.03, 0.03, 0.03, 6, px, y + 0.27, pz, shade(PINS[k], 0.8));
  }
  const [rx2, rz2] = L(0.42, 0);
  b.cyl('metal', 0.11, 0.11, 0.04, 8, rx2, y + 0.38, rz2, shade(BRZ, 1.06), 0, Math.PI / 2, 0, true); // 窥窖铜环
  b.kit('palace.item.cellarHatch', 1, y);
}

/** 五谷灵仓：竹编囤箩（下收上敞）+ 三道箍 + 灵米冒尖（微光）+ 斗签（粮囤廊，取一捧喂灵鸽/仙鹿） */
// 五谷灵仓：T-ITM-0151
function itmGrainSilo(b: Baker, x: number, y: number, z: number, ry: number): void {
  b.cyl('wood', 0.42, 0.34, 0.78, 12, x, y + 0.39, z, shade(0xb99a54, 1.02), ry);    // 箩身
  for (let k = 0; k < 3; k++) {
    b.cyl('wood', 0.43 - k * 0.02, 0.43 - k * 0.02, 0.05, 12, x, y + 0.18 + k * 0.24, z, shade(0x8a6a3e, 0.92), ry, 0, 0, true); // 竹箍
  }
  b.cyl('glow', 0.39, 0.39, 0.06, 12, x, y + 0.8, z, shade(0xe8f0d8, 0.92));          // 灵米面
  b.cyl('glow', 0.24, 0.37, 0.14, 10, x, y + 0.88, z, shade(0xe8f0d8, 1.0));          // 米冒尖
  for (let k = 0; k < 5; k++) {                                                        // 米粒光点
    const a = k * 1.256;
    b.box('glow', 0.05, 0.03, 0.05, x + Math.cos(a) * 0.2, y + 0.96, z + Math.sin(a) * 0.2, shade(0xfff3d8, 0.78));
  }
  b.box('wood', 0.16, 0.3, 0.03, x + 0.36, y + 0.58, z, shade(0xd8c8a0, 1.0), ry, 0, 0.3); // 斗签
  b.kit('palace.item.grainSilo', 1, y);
}

/** 星官考功簿：三格考功架（宿名朱签 + 四色宿签）+ 十二册玉简簿（分宿分册）+ 架顶考功铜镜 */
// 星官考功簿：T-ITM-0169
function itmMeritRack(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  for (const su of [-1, 1]) {
    const [px, pz] = L(su * 0.52, 0);
    b.box('wood', 0.1, 2.34, 0.42, px, y + 1.17, pz, shade(0x3a4e6a, 1.06), ry);      // 架柱
  }
  const SUN = [0xff6b6b, 0x9fe8ff, 0xd8e8c0, 0xffd25e];
  for (let k = 0; k < 3; k++) {
    const sy = y + 0.55 + k * 0.8;
    b.box('wood', 1.1, 0.07, 0.5, x, sy, z, shade(0x3a4e6a, 1.14), ry);                 // 格板
    for (let i = 0; i < 4; i++) {
      const [px, pz] = L(-0.36 + i * 0.24, 0);
      b.box('ash', 0.2, 0.32, 0.34, px, sy + 0.2, pz, shade(JADEW, 0.94 + (i % 3) * 0.04), ry); // 玉简簿
      b.box('glow', 0.16, 0.03, 0.26, px, sy + 0.31, pz, shade(0xffd25e, 0.5), ry);               // 朱字
      b.box('glow', 0.02, 0.1, 0.28, px, sy + 0.37, pz, SUN[i], ry);                              // 宿色签
    }
  }
  b.cyl('metal', 0.26, 0.26, 0.05, 12, x, y + 2.4, z, shade(BRZ, 1.1), ry, Math.PI / 2);          // 考功铜镜
  b.cyl('glow', 0.18, 0.18, 0.03, 12, x, y + 2.4, z, shade(0xfff3d8, 0.5), ry, Math.PI / 2);
  b.kit('palace.item.meritRack', 1, y + 0.55);
}

/** 备用琉璃阶砖：木托 + 二十四块琉璃阶砖（七色成套三层错缝）+ 砖面釉光（灯库，鹤撞事件库存源） */
// 备用琉璃阶砖：T-ITM-0176
function itmGlazedBricks(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('wood', 1.34, 0.12, 0.9, x, y + 0.06, z, shade(0x4a3220, 1.04), ry);           // 木托
  const SEVEN = [0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x4dabf7, 0xb197fc, 0xf783ac];
  for (let layer = 0; layer < 3; layer++) {
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const i = layer * 8 + r * 4 + c;
        const [px, pz] = L(-0.45 + c * 0.3 + layer * 0.05, -0.22 + r * 0.44);
        b.box('ceramic', 0.29, 0.1, 0.42, px, y + 0.17 + layer * 0.1, pz, SEVEN[i % 7], ry);        // 阶砖
        b.box('glow', 0.27, 0.015, 0.04, px, y + 0.23 + layer * 0.1, pz, shade(SEVEN[i % 7], 1.2), ry); // 釉光
      }
    }
  }
  b.kit('palace.item.glazedBricks', 1, y);
}

