import { Baker, BGroup, SignAtlas, SignMesher, shade } from './bake';
import { C, dougongBand, roofOn } from './buildings';
import { buildFanlouInterior, buildXiangguoHallInterior } from './interiors';

// ============ W14：樊楼 / 相国寺 的楼体（空腔，能看进去） ============
/**
 * 本文件只建「壳」：台基 / 柱网 / 墙（前墙留门洞）/ 腰檐 / 平座勾阑 / 屋顶 / 匾额 / 仪门。
 *
 * **楼板不在这里建**：W13 的室内函数（interiors.ts）已经把楼板占满 22×16 / 26×18 整幅
 * （樊楼 slab() 两张板 + 梯井两处开洞，板上皮 4.56 / 9.06；相国寺地面 0.06），再叠一层
 * 0.24 的板只会与它们共面 z-fight。同理，内衬板壁（±10.45 / ±7.45、±12.45 / ±8.45）、
 * 露明梁架、楼梯、陈设也全部由 W13 自建，本文件一律不重复。
 *
 * 地坪锁定：W13 的 F1 / F 硬编码 0.06，所以台基顶面只能是 0.06（台基再高就会把 L1 的
 * 柜台/酒瓮整排埋进台基里）。三级台明 / 双层须弥座因此只能做**平面上的三/三道叠涩**：
 * 樊楼 0.06 / 0.04 / 0.02 三道逐级外扩（台明 2.15+0.6+0.6），相国寺 下枋 0.02 → 束腰
 * 0.04（内收 0.4）→ 上枋 0.06（外挑 0.25），总高都只有 6cm，读作台明而不是高台。
 * 要真 0.5–0.9m 高台必须改 interiors.ts 的 F1（超出本包写权限）。
 *
 * 朝向：两座楼的立面（+z 门洞、二层格扇、三层挑台）都朝**汴河大街**。落位在街北侧，
 * 故整组用 Baker/SignMesher 的 180° 枢轴（yawAbout）翻过来——室内函数的 +z 前檐同样被翻，
 * 门洞/窗/匾三者的朝向自动一致（interiors.ts 的镜像街屋也用这一招）。
 *
 * 随机性：只用坐标 hash（hash01），不消耗 world.ts 的共享 rng 流。
 */

const WOOD_D = C.woodDark;      // 桐油深褐
const WOOD_M = C.wood;          // 梁木褐
const ZHU = C.woodRed;          // 市井朱
const ZHU_D = 0x6e3a26;
const STONE = 0x8d8a80;         // 青石（与 interiors.ts 的 W13.ash 同值）
const STONE_L = 0x9d988c;
const STONE_D = 0x6f6c62;
const GOLD = 0xb08a34;
const LAMP = 0xffb060;

interface Stage {
  box(g: BGroup, w: number, h: number, d: number, lu: number, y: number, lv: number, hex: number, ry?: number, rx?: number, rz?: number): void;
  cyl(g: BGroup, rt: number, rb: number, h: number, seg: number, lu: number, y: number, lv: number, hex: number, ry?: number, rx?: number, rz?: number): void;
}

/** 局部坐标台（正面 +z）：与 interiors.ts 的 makeStage 同构，c×c 偏移后交给 Baker */
function makeStage(b: Baker, cx: number, cz: number): Stage {
  return {
    box: (g, w, h, d, lu, y, lv, hex, ry = 0, rx = 0, rz = 0) => b.box(g, w, h, d, cx + lu, y, cz + lv, hex, ry, rx, rz),
    cyl: (g, rt, rb, h, seg, lu, y, lv, hex, ry = 0, rx = 0, rz = 0) => b.cyl(g, rt, rb, h, seg, cx + lu, y, cz + lv, hex, ry, rx, rz),
  };
}

/** 坐标 hash（0–1）：构件色调差异只认坐标，不碰共享 rng（重建逐值不变） */
function hash01(x: number, z: number, k: number): number {
  let h = Math.imul((Math.round(x * 53) ^ 0x9e3779b9) + k * 0x27d4eb2d, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 平面上的三道叠涩台明：外圈低、内圈高，读作三级踏步（台基总高受 W13 地坪锁定） */
function apronRing(S: Stage, hx: number, hz: number, hx0: number, hz0: number, y0: number, y1: number, hex: number): void {
  const h = y1 - y0, yc = (y0 + y1) / 2;
  S.box('ash', hx * 2, h, hz - hz0, 0, yc, (hz + hz0) / 2, hex);
  S.box('ash', hx * 2, h, hz - hz0, 0, yc, -(hz + hz0) / 2, hex);
  S.box('ash', hx - hx0, h, hz0 * 2, (hx + hx0) / 2, yc, 0, hex);
  S.box('ash', hx - hx0, h, hz0 * 2, -(hx + hx0) / 2, yc, 0, hex);
}

/** 一圈腰檐：四面檐板（出挑 out、落檐 drop）+ 檐口封边，四角互搭（宋式转角搭交） */
function waistEave(S: Stage, w: number, d: number, y: number, out: number, drop: number, tileC: number): void {
  const len = Math.hypot(out, drop);
  const a = Math.atan2(drop, out);
  const th = 0.16;
  for (const s of [-1, 1]) {
    S.box('roof', w + out * 2, th, len, 0, y - drop / 2, s * (d / 2 + out / 2), shade(tileC, 1.04), 0, s * a, 0);
    S.box('roof', w + out * 2 + 0.2, 0.22, 0.2, 0, y - drop - 0.05, s * (d / 2 + out), shade(tileC, 0.66));
    S.box('roof', len, th, d + out * 2, s * (w / 2 + out / 2), y - drop / 2, 0, shade(tileC, 0.99), 0, 0, -s * a);
    S.box('roof', 0.2, 0.22, d + out * 2 + 0.2, s * (w / 2 + out), y - drop - 0.05, 0, shade(tileC, 0.66));
  }
}

/** 勾阑一圈（寻杖 + 盆唇 + 望柱），落在平座板上皮 */
function railingRing(S: Stage, hx: number, hz: number, y: number, posts: number, longPosts: number): void {
  const r1 = shade(ZHU, 1.06), r2 = shade(ZHU, 0.94);
  for (const s of [-1, 1]) {
    S.box('wood', hx * 2, 0.09, 0.09, 0, y + 0.92, s * hz, r1);
    S.box('wood', hx * 2, 0.07, 0.07, 0, y + 0.52, s * hz, r2);
    for (let i = 0; i < longPosts; i++) {
      const lx = -hx + (2 * hx * i) / (longPosts - 1);
      S.box('wood', 0.09, 0.96, 0.09, lx, y + 0.48, s * hz, ZHU_D);
    }
    S.box('wood', 0.09, 0.09, hz * 2, s * hx, y + 0.92, 0, r1);
    S.box('wood', 0.07, 0.07, hz * 2, s * hx, y + 0.52, 0, r2);
    for (let i = 1; i < posts; i++) {
      const lz = -hz + (2 * hz * i) / (posts - 1);
      S.box('wood', 0.09, 0.96, 0.09, s * hx, y + 0.48, lz, ZHU_D);
    }
  }
}

/** 格扇（棂条窗）：只做框 + 棂条，不做背板——W13 的板壁/发光格窗就在 0.1m 后，光正好当窗纸透出来 */
function geshan(S: Stage, lu: number, lv: number, y: number, w: number, h: number, ry: number): void {
  const th = 0.09, fw = 0.09;
  const c = Math.cos(ry), sn = Math.sin(ry);
  const px = (lx: number): number => lu + lx * c;
  const pz = (lx: number): number => lv - lx * sn;
  const D = shade(WOOD_D, 1.06), D2 = WOOD_D;
  S.box('wood', w, fw, th, lu, y + h / 2 - fw / 2, lv, D, ry);                       // 上抹头
  S.box('wood', w, fw * 1.7, th, lu, y - h / 2 + fw * 0.85, lv, D, ry);              // 下裙板压条
  for (const s of [-1, 1]) S.box('wood', fw, h, th, px(s * (w / 2 - fw / 2)), y, pz(s * (w / 2 - fw / 2)), D2, ry); // 边挺
  const inner = h - fw * 2.7;
  const bars = Math.max(3, Math.round(w / 0.34));
  for (let i = 1; i < bars; i++) {
    const lx = -w / 2 + (w * i) / bars;
    S.box('wood', 0.045, inner, th * 0.8, px(lx), y, pz(lx), D2, ry);
  }
  S.box('wood', w - fw * 2, 0.05, th * 0.8, lu, y + h * 0.16, lv, D2, ry);
}

// ============ 樊楼（三层酒楼，22×16，层净高 4.2，正面 +z） ============
/**
 * 樊楼楼体 + 室内（一句调用）。
 *
 * 宿主约定（与 interiors.ts 的 buildFanlouInterior 对齐）：
 *   净空 20.9×14.9（半阔 10.45 / 半深 7.45）、楼板上皮 4.56 / 9.06、L3 望板底 13.26、
 *   梯井在东侧 x 8.45..10.45（L2 洞 z 1.0..5.9、L3 洞 z −5.0..−0.2）。
 * 本壳体外皮 22×16（半阔 11 / 半深 8），故檐柱与内衬板壁之间留 0.55 的檐廊。
 *
 * 默认落位 (−620, 71)：北岸正街（汴河大街）西端街口北侧，前檐朝 −z 临街；
 * 周围无街屋（streetPlots 自 x≈−596 起排）、无农舍（buildFarms 自 −580 起）、无随机树
 * （柳/松 x 域 −560..620）。台基顶 0.06、总高 17.87（脊顶），三层 22×16 体块。
 */
export function buildFanlou(b: Baker, sg: SignMesher, atlas: SignAtlas, x = -620, z = 71): void {
  b.yawAbout(x, z);
  sg.yawAbout(x, z);
  fanlouShell(b, sg, atlas, x, z);
  buildFanlouInterior(b, sg, atlas, x, z);
  b.yawAbout();
  sg.yawAbout();
}

function fanlouShell(b: Baker, sg: SignMesher, atlas: SignAtlas, cx: number, cz: number): void {
  const S = makeStage(b, cx, cz);
  const HW = 11, HD = 8;               // 外皮半阔 / 半深（22×16）
  const F1 = 0.06;                     // 台基顶 = W13 地坪
  const L2 = 4.56, L3 = 9.06, TOP = 13.26;
  const EW_A = 4.26, EW_B = 8.76;      // 两道腰檐从楼板下皮起挑

  // ===== ① 台基（三级叠涩，顶 0.06）=====
  apronRing(S, HW + 2.8, HD + 3.2, HW + 2.2, HD + 2.6, -0.30, 0.02, shade(STONE, 0.92)); // 三级（最低）
  apronRing(S, HW + 2.2, HD + 2.6, HW + 1.6, HD + 2.0, -0.30, 0.04, STONE);              // 二级
  apronRing(S, HW + 1.6, HD + 2.0, 10.45, 7.45, -0.30, 0.06, STONE_L);                   // 一级台明（顶 0.06）

  // ===== ② 柱网：面阔 5 间（4.4 柱距）× 进深 3 间（5.33 柱距），通高檐柱 16 根 =====
  const xs = [-11, -6.6, -2.2, 2.2, 6.6, 11];
  const zs = [-8, -8 / 3, 8 / 3, 8];
  const cols: [number, number][] = [];
  for (const lx of xs) cols.push([lx, 8], [lx, -8]);
  for (const lz of zs.slice(1, 3)) cols.push([-11, lz], [11, lz]);
  for (const [lx, lz] of cols) {
    const tone = 0.94 + hash01(cx + lx, cz + lz, 7) * 0.12;
    S.box('ash', 0.64, 0.30, 0.64, lx, F1 + 0.15, lz, STONE_D);
    S.cyl('wood', 0.19, 0.208, TOP - F1, 8, lx, F1 + (TOP - F1) / 2, lz, shade(ZHU, tone));
  }

  // ===== ③ 阑额 / 地栿（每层一圈，通柱承重）=====
  for (const y of [4.30, 8.80, 13.05]) {
    S.box('wood', 21.4, 0.26, 0.20, 0, y, 8, shade(WOOD_M, 1.06));
    S.box('wood', 21.4, 0.26, 0.20, 0, y, -8, shade(WOOD_M, 1.06));
    S.box('wood', 0.20, 0.26, 15.4, 11, y, 0, shade(WOOD_M, 1.06));
    S.box('wood', 0.20, 0.26, 15.4, -11, y, 0, shade(WOOD_M, 1.06));
  }
  S.box('wood', 21.4, 0.22, 0.20, 0, F1 + 0.13, 8, shade(WOOD_D, 1.12));
  S.box('wood', 21.4, 0.22, 0.20, 0, F1 + 0.13, -8, shade(WOOD_D, 1.12));
  S.box('wood', 0.20, 0.22, 15.4, 11, F1 + 0.13, 0, shade(WOOD_D, 1.12));
  S.box('wood', 0.20, 0.22, 15.4, -11, F1 + 0.13, 0, shade(WOOD_D, 1.12));

  // ===== ④ 一层敞铺：无墙，只柱 + 门罩（门洞 3.60 净宽 × 3.60 净高）=====
  for (const s of [-1, 1]) S.box('wood', 0.26, 3.20, 0.34, s * 1.93, F1 + 1.60, 8, shade(ZHU, 0.88));
  S.box('wood', 4.34, 0.34, 0.42, 0, F1 + 3.77, 8, shade(WOOD_D, 1.08));
  S.box('ash', 3.60, 0.12, 0.62, 0, F1 + 0.06, 8, STONE_L);

  // ===== ⑤ 二层 / 三层：前檐格扇（5 间）× 三面板壁 =====
  for (const sy of [L2, L3]) {
    for (const lx of [-8.8, -4.4, 0, 4.4, 8.8]) geshan(S, lx, 7.62, sy + 1.90, 3.50, 2.30, 0);
    S.box('wood', 21.0, 4.10, 0.16, 0, sy + 2.06, -7.60, shade(WOOD_M, 0.96));   // 后檐板壁
    S.box('wood', 0.16, 4.10, 15.0, 10.60, sy + 2.06, 0, shade(WOOD_M, 0.94));   // 两山板壁
    S.box('wood', 0.16, 4.10, 15.0, -10.60, sy + 2.06, 0, shade(WOOD_M, 0.94));
  }

  // ===== ⑥ 三层腰檐（每层一圈，出挑 1.0 / 落檐 0.34）=====
  waistEave(S, HW * 2, HD * 2, EW_A, 1.0, 0.34, C.tile);
  waistEave(S, HW * 2, HD * 2, EW_B, 1.0, 0.34, C.tile);

  // ===== ⑦ 三层挑台（平座出挑 1.30）+ 勾阑 =====
  const po = 1.30;
  S.box('wood', HW * 2 + po * 2, 0.14, po, 0, 9.13, HD + po / 2, shade(WOOD_D, 1.05));
  S.box('wood', HW * 2 + po * 2, 0.14, po, 0, 9.13, -(HD + po / 2), shade(WOOD_D, 1.05));
  S.box('wood', po, 0.14, HD * 2, HW + po / 2, 9.13, 0, shade(WOOD_D, 1.05));
  S.box('wood', po, 0.14, HD * 2, -(HW + po / 2), 9.13, 0, shade(WOOD_D, 1.05));
  railingRing(S, HW + po - 0.07, HD + po - 0.07, 9.20, 3, 7);
  // 平座下斜撑
  for (const s of [-1, 1]) {
    for (const lx of [-8.2, 0, 8.2]) S.box('wood', 0.14, 0.14, 1.5, lx, 8.72, s * (HD + 0.62), shade(WOOD_D, 0.94), 0, s * 0.62, 0);
    for (const lz of [-4.6, 0, 4.6]) S.box('wood', 1.5, 0.14, 0.14, s * (HW + 0.62), 8.72, lz, shade(WOOD_D, 0.94), 0, 0, -s * 0.62);
  }

  // ===== ⑧ 四坡屋顶（roofOn）+ 封檐板 + 正脊 / 鸱吻 / 宝顶 =====
  // 26.0×19.5 → 檐口 ±12.0 / ±9.0（出挑 1.0）；脊高 4.35×1.06=4.611 → 脊顶 17.87
  roofOn(b, 26.0, 19.5, TOP, cx, cz, 0, C.tile);
  const ridY = TOP + 4.611;
  // 封檐板：roofOn 的檐口封边在檐下 fh 处，曲面檐口比墙顶高 0.74，中间会透光——补一圈
  for (const s of [-1, 1]) {
    S.box('wood', 23.7, 0.80, 0.18, 0, TOP + 0.39, s * 8.85, shade(WOOD_D, 1.02));
    S.box('wood', 0.18, 0.80, 17.7, s * 11.85, TOP + 0.39, 0, shade(WOOD_D, 1.02));
  }
  S.box('roof', 7.9, 0.34, 0.94, 0, ridY + 0.12, 0, C.ridge);
  for (const s of [-1, 1]) S.box('roof', 0.56, 1.05, 0.74, s * 3.82, ridY + 0.66, 0, shade(C.ridge, 1.16));
  S.cyl('metal', 0.16, 0.30, 0.50, 8, 0, ridY + 0.34, 0, GOLD);
  S.cyl('metal', 0.30, 0.10, 0.28, 8, 0, ridY + 0.72, 0, GOLD);

  // ===== ⑨ 彩楼欢门（正店门面）+ 酒旗 + 灯笼 + 前庭 =====
  const GZ0 = 10.4, GZ1 = 12.6;        // 欢门前后两榀
  for (const s of [-1, 1]) {
    for (const lz of [GZ0, GZ1]) {
      S.box('wood', 0.28, 8.6, 0.28, s * 4.9, 4.36, lz, shade(WOOD_D, 1.1));
      S.box('ash', 0.62, 0.26, 0.62, s * 4.9, 0.13, lz, STONE_D);
      S.box('wood', 0.16, 3.4, 0.16, s * 4.35, 2.4, lz + 0.3, shade(WOOD_D, 1.0), 0, 0, s * 0.16);
    }
  }
  S.box('wood', 10.3, 0.30, 0.30, 0, 8.5, GZ0, shade(ZHU, 1.02));
  S.box('wood', 10.3, 0.30, 0.30, 0, 8.5, GZ1, shade(ZHU, 1.02));
  S.box('wood', 10.3, 0.22, 0.22, 0, 6.3, GZ1, shade(ZHU, 0.96));
  for (const lz of [GZ0, GZ1]) {
    // 彩帛（欢门的繁盛感就靠这一排垂帛，自主梁 8.5 垂到 6.6）
    for (let i = 0; i < 7; i++) {
      S.box('fabric', 0.9, 1.9, 0.05, -4.2 + i * 1.4, 7.55, lz, [0x9d2933, 0x2a5c42, 0xd4b76a][i % 3]);
    }
    S.box('glow', 0.26, 0.34, 0.26, -4.2, 5.0, lz, LAMP);
    S.box('glow', 0.26, 0.34, 0.26, 4.2, 5.0, lz, LAMP);
    S.box('glow', 0.30, 0.38, 0.30, 0, 4.30, lz, LAMP);
  }
  // 人字彩顶（两坡各自以脊为高点向外落，不是一个 X 交叉）
  for (const s of [-1, 1]) S.box('roof', 11.4, 0.18, 0.96, 0, 8.84, (GZ0 + GZ1) / 2 + s * 0.41, shade(C.tile2, 1.06), 0, s * 0.52, 0);
  S.box('roof', 11.6, 0.24, 0.36, 0, 9.14, (GZ0 + GZ1) / 2, C.ridge);
  S.box('glow', 0.34, 0.34, 0.34, 0, 9.46, (GZ0 + GZ1) / 2, LAMP, 0, 0, Math.PI / 4);
  // 匾「樊樓」（挂在欢门次梁下，朝街）
  sg.quad(atlas.text('w14fanlou', '樊樓', 384, 128, { color: '#ffd700', glow: '#ff5a1e', bg: 'rgba(26,12,8,0.92)', border: 'rgba(255,180,60,.55)', fontPx: 96 }), 3.0, 1.0, cx, 5.52, cz + GZ1 + 0.16, 0);
  // 酒旗（望子）
  S.box('wood', 0.18, 6.6, 0.18, -10.6, 3.3, GZ0, shade(WOOD_D, 1.1));
  S.box('wood', 1.5, 0.12, 0.12, -9.9, 6.5, GZ0, shade(WOOD_D, 1.1));
  S.box('fabric', 1.4, 3.2, 0.05, -9.9, 4.85, GZ0, 0x9d2933);
  S.box('fabric', 1.2, 0.5, 0.03, -9.9, 5.95, GZ0 + 0.04, 0xd4b76a);
  // 门灯 2
  for (const s of [-1, 1]) {
    S.box('glow', 0.30, 0.40, 0.30, s * 2.6, 3.28, 8.34, LAMP);
    S.box('wood', 0.06, 0.44, 0.06, s * 2.6, 3.68, 8.34, shade(WOOD_D, 1.1));
  }
  // 前庭铺装（接北岸正街西端，路面 0.11）
  S.box('ash', 40, 0.05, 5.2, 0, 0.025, 14.0, shade(STONE, 0.94));
}

// ============ 相国寺大殿（26×18，净高 7.6，门洞 ≥3.4） ============
/**
 * 相国寺大殿 + 山门 + 神道（一句调用，室内同样由本函数转调 W13）。
 *
 * 宿主约定（与 buildXiangguoHallInterior 对齐）：净空 24.9×16.9（半阔 12.45 / 半深 8.45）、
 * 净高 7.6、门洞 3.52 净宽 × 3.50 净高（内衬决定）、两侧不设实墙外皮（回廊贴殿身，廊跨
 * x 12.5..16.8 由 W13 自建）、回廊台顶 0.42。
 *
 * 默认落位 (−620, 170)：北岸正街西端街口以北的开阔地，前檐朝 −z 面向汴河大街 / 樊楼；
 * 神道沿 x=−620 直落樊楼后院（世界 z 79..151）。
 * 该带 x<−580 无街屋、无农舍、无随机树，是城内唯一成片空地。
 */
export function buildXiangguo(b: Baker, sg: SignMesher, atlas: SignAtlas, x = -620, z = 170): void {
  b.yawAbout(x, z);
  sg.yawAbout(x, z);
  xiangguoShell(b, sg, atlas, x, z);
  buildXiangguoHallInterior(b, sg, atlas, x, z);
  b.yawAbout();
  sg.yawAbout();
  // 神道（不参与枢轴，直接世界坐标）：殿前踏跺 → 樊楼后院（世界 z 79..149）
  b.box('ash', 8, 0.10, 70, x, 0.05, z - 56, shade(STONE, 0.97));
  for (const s of [-1, 1]) b.box('ash', 0.4, 0.13, 70, x + s * 4.2, 0.065, z - 56, STONE_L);
}

function xiangguoShell(b: Baker, sg: SignMesher, atlas: SignAtlas, cx: number, cz: number): void {
  const S = makeStage(b, cx, cz);
  const HX = 13, HZ = 9;               // 外皮 26×18
  const F = 0.06;
  const TOP = 7.6;

  // ===== ① 双层须弥座（下枋 / 束腰 / 上枋，顶 0.06）+ 前月台 =====
  // 三层是「上下叠」不是「平铺」：下枋最宽、束腰内收 0.4、上枋外挑 0.25 压住束腰，
  // 这样每一层的顶面都留得出来（平铺式的嵌套会互相盖住，只剩最上一圈可见）。
  apronRing(S, HX + 1.6, HZ + 1.6, 13.0, 9.0, -0.30, 0.02, shade(STONE, 0.9));            // 下枋（最宽）
  apronRing(S, HX + 1.2, HZ + 1.2, 13.0, 9.0, 0.02, 0.04, STONE_D);                        // 束腰（内收 0.4）
  apronRing(S, HX + 1.45, HZ + 1.45, 12.45, 8.45, 0.04, 0.06, STONE_L);                    // 上枋（顶 0.06）
  S.box('ash', 29.2, 0.36, 8.55, 0, -0.12, 14.725, shade(STONE, 0.98));                     // 月台（z 10.45..19.0）
  S.box('ash', 29.0, 0.02, 8.4, 0, 0.07, 14.725, STONE_L);                                  // 月台压面
  S.box('ash', 28.0, 0.34, 1.0, 0, -0.13, 19.5, shade(STONE, 0.9));                         // 踏跺一级（顶 0.04）
  S.box('ash', 26.0, 0.32, 0.9, 0, -0.14, 20.45, shade(STONE, 0.86));                       // 踏跺二级（顶 0.02）

  // ===== ② 檐柱一圈：面阔 5 间（5.2）× 进深 3 间（6.0）= 16 根 =====
  const xs = [-13, -7.8, -2.6, 2.6, 7.8, 13];
  const zs = [-9, -3, 3, 9];
  const cols: [number, number][] = [];
  for (const lx of xs) cols.push([lx, 9], [lx, -9]);
  for (const lz of zs.slice(1, 3)) cols.push([-13, lz], [13, lz]);
  for (const [lx, lz] of cols) {
    const tone = 0.94 + hash01(cx + lx, cz + lz, 11) * 0.12;
    S.box('ash', 0.94, 0.30, 0.94, lx, F + 0.15, lz, STONE_D);
    S.cyl('wood', 0.30, 0.325, TOP - F, 10, lx, F + (TOP - F) / 2, lz, shade(ZHU, tone));
  }

  // ===== ③ 前后檐墙（两侧不设外皮，交回廊）+ 门洞 3.80 净宽 × 3.62 净高 =====
  for (const s of [-1, 1]) {
    S.box('wood', 11.3, TOP, 0.55, s * 7.55, F + TOP / 2, 8.725, shade(WOOD_M, 0.92));      // 前檐两翼
    S.box('wood', 3.80, TOP - 3.62, 0.55, 0, F + 3.62 + (TOP - 3.62) / 2, 8.725, shade(WOOD_M, 0.92));
  }
  S.box('wood', 26.4, TOP, 0.55, 0, F + TOP / 2, -8.725, shade(WOOD_M, 0.88));             // 后檐墙
  for (const s of [-1, 1]) S.box('wood', 0.26, 3.62, 0.40, s * 2.03, F + 1.81, 8.66, shade(ZHU, 0.9));
  S.box('wood', 4.32, 0.34, 0.46, 0, F + 3.79, 8.66, shade(WOOD_D, 1.08));                  // 门楣
  S.box('ash', 3.80, 0.14, 0.66, 0, F + 0.07, 8.66, STONE_L);                               // 门槛石

  // ===== ④ 斗栱带（四面，直接调用 buildings.ts 的 dougongBand）=====
  const dgC = shade(ZHU, 1.14);
  dougongBand(b, cx, F + 7.02, cz + 9.0, 26, 0, dgC);
  dougongBand(b, cx, F + 7.02, cz - 9.0, 26, Math.PI, dgC);
  dougongBand(b, cx - 13, F + 7.02, cz, 17.4, -Math.PI / 2, shade(dgC, 0.98));
  dougongBand(b, cx + 13, F + 7.02, cz, 17.4, Math.PI / 2, shade(dgC, 0.98));

  // ===== ⑤ 单檐歇山（roofOn 曲面四坡）: 30.8×22.2 → 檐口 ±14.2 / ±10.25，脊顶 12.78 =====
  roofOn(b, 30.8, 22.2, TOP, cx, cz, 0, C.tile);
  const ridY = TOP + 4.89 * 1.06;
  for (const s of [-1, 1]) {
    S.box('wood', 27.6, 0.72, 0.18, 0, TOP + 0.34, s * 10.1, shade(WOOD_D, 1.0));           // 封檐板
    S.box('wood', 0.18, 0.72, 20.2, s * 14.05, TOP + 0.34, 0, shade(WOOD_D, 1.0));
  }
  S.box('roof', 9.6, 0.36, 1.0, 0, ridY + 0.14, 0, C.ridge);                                // 正脊
  for (const s of [-1, 1]) S.box('roof', 0.60, 1.20, 0.80, s * 4.65, ridY + 0.72, 0, shade(C.ridge, 1.18)); // 鸱吻
  // 角脊 4 条（沿曲面角线分段落小斗石，贴面不浮空——不用旋转箱，避免 XYZ 欧拉复合角错位）
  {
    const A = 30.8 * 0.905 * 1.02, B = 22.2 * 0.905 * 1.02, sy = 4.89 * 1.06;
    const hh = (t: number): number => 0.16 + 0.34 * Math.pow(t, 1.6);
    const yy = (t: number): number => (1 - Math.pow(t, 1.6) + 0.16 * Math.pow(t, 3) + 0.15 * t * t) * sy;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const t = 0.96 - i * 0.12;
        S.box('roof', 0.34, 0.24, 0.34, su * hh(t) * A, TOP + yy(t) + 0.09, sv * hh(t) * B, shade(C.ridge, 1.12));
      }
    }
  }

  // ===== ⑥ 山门（3 开间：明间净宽 3.92 × 3.60 净高）=====
  const GX = 6.2, GZ = 15.6, GMX = 2.2;
  for (const lx of [-GX, -GMX, GMX, GX]) {
    for (const s of [-1, 1]) {
      S.box('ash', 0.72, 0.24, 0.72, lx, F + 0.12, GZ + s * 2.1, STONE_D);
      S.cyl('wood', 0.24, 0.26, 4.54, 8, lx, F + 2.27, GZ + s * 2.1, shade(ZHU, 0.98));
    }
    S.box('wood', 0.44, 0.30, 4.6, lx, F + 4.40, GZ, shade(WOOD_D, 1.05));                 // 梁
  }
  for (const s of [-1, 1]) {
    S.box('wood', 12.6, 0.34, 0.30, 0, F + 4.18, GZ + s * 2.1, shade(ZHU, 1.0));           // 阑额
    S.box('wood', 12.9, 0.20, 0.34, 0, F + 4.62, GZ + s * 2.1, shade(WOOD_D, 1.08));       // 压斗枋
  }
  for (const s of [-1, 1]) S.box('wood', 8.0, 1.0, 0.24, s * 4.2, F + 3.10, GZ + 2.1, shade(WOOD_M, 0.95)); // 两山填板
  // 板门两扇（关着，门钉 12 枚）
  for (const s of [-1, 1]) {
    S.box('wood', 1.94, 3.50, 0.14, s * 0.98, F + 1.81, GZ + 2.06, 0x8a3a28);
    S.box('wood', 1.94, 0.12, 0.16, s * 0.98, F + 3.02, GZ + 2.06, shade(WOOD_D, 1.1));
    S.box('glow', 0.16, 0.16, 0.08, s * 0.30, F + 1.95, GZ + 2.14, GOLD);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      S.box('metal', 0.07, 0.07, 0.06, s * (0.45 + c * 0.9), F + 0.85 + r * 0.95, GZ + 2.14, GOLD);
    }
  }
  S.box('wood', 4.4, 0.30, 0.34, 0, F + 3.72, GZ + 2.1, shade(WOOD_D, 1.1));               // 门额
  // 山门小屋顶（悬山两坡）
  roofOn(b, 14.2, 6.4, F + 4.72, cx, cz + GZ, 0, C.tile);
  S.box('roof', 5.4, 0.26, 0.8, 0, F + 4.72 + 1.834 + 0.07, GZ, C.ridge);
  for (const s of [-1, 1]) S.box('roof', 0.42, 0.72, 0.56, s * 2.6, F + 4.72 + 1.9, GZ, shade(C.ridge, 1.14));
  // 匾「大相國寺」（挂在门额上，朝神道）
  sg.quad(atlas.text('w14xiangguo', '大相國寺', 448, 112, { color: '#ffd700', glow: '#ffb300', bg: 'rgba(30,22,20,0.92)', border: 'rgba(255,215,0,.55)', fontPx: 84 }), 3.7, 0.94, cx, F + 4.30, cz + GZ + 2.30, 0);

  // ===== ⑦ 殿前石灯一对（神道尽端，踏跺之外）=====
  for (const s of [-1, 1]) {
    S.box('ash', 0.62, 0.18, 0.62, s * 5.0, F + 0.09, 21.6, STONE);
    S.cyl('ash', 0.16, 0.20, 1.10, 8, s * 5.0, F + 0.70, 21.6, STONE_D);
    S.box('ash', 0.54, 0.46, 0.54, s * 5.0, F + 1.44, 21.6, STONE_L);
    S.box('glow', 0.26, 0.24, 0.26, s * 5.0, F + 1.44, 21.6, LAMP);
    S.box('ash', 0.70, 0.12, 0.70, s * 5.0, F + 1.72, 21.6, STONE);
  }
}
