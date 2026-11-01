import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade } from '../city/bake';
import { roofOn } from '../city/buildings';
import { buildIslandSkirt, islandFallAngle, CS_BASE, CS_DEEP, CS_TOP, GOLD_LINE, GOLD_ROOF, GOLD_TRIM, skyJitter, flushSkyCloudSheets } from './palace';
import { buildEighteenHells } from './hells';
import { buildGhostShopDetail } from './fengduDetail';
import { buildFengduGround, FENGDU } from './fengduGround';
import { PoolSet } from '../actors/pools';
import { RNG } from '../core/rng';

// ============ 天庭广厦：方圆百里云海 + 群宫 + 天河 ============
const yieldFrameS = (): Promise<void> => new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r()); else setTimeout(r, 0); });

// ============ W47：南天门门洞贯通 ============
/**
 * 天宫南天门锚点，与 realm.ts `SkyCenters.gate` 同一个数（203 为云台面）。
 * 不改 realm.ts（禁改文件），本段只做两件事：摘掉堵死门洞的实心墩座、补回「两墩 + 券洞」。
 */
const SKY_GATE = { x: 0, y: 203, z: -85, w: 44, h: 8, d: 18 } as const;

type TypedArr = Float32Array | Int16Array | Uint16Array | Uint8Array | Int32Array;

/**
 * 从已烘焙的合并几何里按「整块盒体的 8 个角点」摘掉该盒体的 12 个三角形。
 * 判据是**三个顶点都落在角点 ±eps 内**：合并几何里同材质的其它构件（墩柱、面砖…）
 * 顶点都不落在这 8 个点上，所以不会误伤。
 *
 * 为什么必须这么做：realm.ts 的城台是一整块 44×8×18 实心盒（`b.box('wall', 44, 8, 18, …)`），
 * 它把 8m 高的门洞从地面一直堵到顶，射线打上去是一块 `#6a5a3e` 的棕灰色大板 —— 用户说的
 * 「门框中的棕灰色的大长方体」就是它。盒体没有洞，只能整块摘掉再用新几何重建。
 * @returns 摘掉的三角形数
 */
function stripBoxTriangles(scene: THREE.Scene, namePrefix: string, box: { x: number; y: number; z: number; w: number; h: number; d: number }): number {
  const EPS = 0.02;
  const hx = box.w / 2, hy = box.h / 2, hz = box.d / 2;
  const corners: number[][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([box.x + sx * hx, box.y + sy * hy, box.z + sz * hz]);
  const atCorner = (x: number, y: number, z: number): boolean => {
    for (const c of corners) if (Math.abs(x - c[0]) <= EPS && Math.abs(y - c[1]) <= EPS && Math.abs(z - c[2]) <= EPS) return true;
    return false;
  };
  const targets: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name.startsWith(namePrefix)) targets.push(m);
  });
  let removed = 0;
  for (const m of targets) {
    const g = m.geometry as THREE.BufferGeometry | undefined;
    const pos = g?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!g || !pos) continue;
    const idx = g.getIndex();
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const keep: number[] = [];
    let hit = 0;
    for (let t = 0; t < triCount; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3;
      const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const isBox = atCorner(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
        && atCorner(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
        && atCorner(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
      if (isBox) { hit++; continue; }
      keep.push(ia, ib, ic);
    }
    if (hit === 0) continue;
    const ng = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const src = g.getAttribute(name) as THREE.BufferAttribute;
      const is = src.itemSize;
      const Ctor = (src.array as TypedArr).constructor as new (n: number) => TypedArr;
      const dst = new Ctor(keep.length * is);
      for (let i = 0; i < keep.length; i++) {
        for (let k = 0; k < is; k++) dst[i * is + k] = (src.array as TypedArr)[keep[i] * is + k];
      }
      ng.setAttribute(name, new THREE.BufferAttribute(dst, is, src.normalized));
    }
    g.dispose();
    m.geometry = ng;
    ng.computeBoundingSphere();
    removed += hit;
  }
  return removed;
}

/**
 * 南天门城台重建：两墩 + 半圆券洞 + 券脸 + 抱框 + 门槛。
 * 尺寸全部按 pre-scale 天宫坐标写（本段几何在 buildCloudSeaView 里统一 ×2.2），
 * 与 realm.ts 的 44×8×18 城台同footprint，只把中间掏成能望穿的洞。
 */
function rebuildSkyGatePassage(b: Baker, gate: { x: number; y: number; z: number; w: number; h: number; d: number }): void {
  const { x: gx, y: gy, z: gz, w, h, d } = gate;
  const hw = w / 2;                 // 22
  const hd = d / 2;                 // 9
  const R = 5.4;                    // 券洞半宽 = 起券半径
  const YS = gy + 2.6;              // 起券线 205.6
  const TOP = gy + h;               // 211
  const WALL = shade(0x6a5a3e, 1);  // 与旧墩座同色，重建后前后观感一致
  // ① 两侧墩台（把洞口让到 ±R 之外，进深与旧城台一致）
  for (const s of [-1, 1]) {
    const pw = hw - R;              // 16.6
    b.box('wall', pw, h, d, gx + s * (R + pw / 2), gy + h / 2, gz, WALL);
  }
  // ② 起券线以上：按半圆逐层收进，填满拱肩（24 层 × 0.225，2.2× 后每层 0.5m，读成石砌层）
  const LAYERS = 24;
  const lh = (TOP - YS) / LAYERS;
  for (let i = 0; i < LAYERS; i++) {
    const yy = YS + (i + 0.5) * lh;
    const dy = Math.max(0, yy - YS);
    const halfGap = Math.sqrt(Math.max(0, R * R - dy * dy));
    const sw = hw - halfGap;
    if (sw <= 0.02) continue;
    for (const s of [-1, 1]) b.box('wall', sw, lh * 1.02, d, gx + s * (halfGap + sw / 2), yy, gz, shade(0x6a5a3e, 1 - (i % 3) * 0.02));
  }
  // ③ 券脸（拱券石圈）：19 块沿半圆排布，进深比墙面各出 0.2m，正面读成一圈券石
  const NV = 19;
  const arc = (Math.PI * (R + 0.28)) / NV;
  for (let i = 0; i < NV; i++) {
    const th = ((i + 0.5) / NV) * Math.PI;
    // 块宽取 1.45×弧长：块与块之间必须压住，留缝的话整圈券石会读成一把「齿」
    b.box('ash', arc * 1.45, 0.62, d + 0.4,
      gx + Math.cos(th) * (R + 0.29), YS + Math.sin(th) * (R + 0.29), gz,
      shade(0xb4b0a8, 1.02), 0, 0, th + Math.PI / 2);
  }
  // ④ 抱框（券洞两侧竖框，压边 + 金线）
  for (const s of [-1, 1]) {
    b.box('ash', 0.42, YS - gy, d + 0.34, gx + s * (R + 0.21), (gy + YS) / 2, gz, shade(0xb4b0a8, 1.06));
    b.box('glow', 0.1, YS - gy - 0.6, 0.1, gx + s * (R + 0.4), (gy + YS) / 2, gz + hd + 0.24, GOLD_LINE);
  }
  // ⑤ 门槛石 + 门洞铺地（比台面深一档，踏进去有「过门」的读数）
  b.box('ash', R * 2 + 0.9, 0.26, d, gx, gy + 0.13, gz, shade(0x8a8478, 0.9));
  b.box('ash', R * 2, 0.08, d - 1.2, gx, gy + 0.3, gz, shade(0x7a7468, 0.86));
}


/**
 * 天宫扩展（三环群岛/云桥/远景宫阙/云海）。**异步分片**：
 * 2200 颗星尘 + 700 天河粒子 + 900 云沿 + 76 岛 + 102 建筑，一次跑完 1.8s。
 * 在这几段长循环里插让帧，单次占用压到 ~0.3s。
 */
export async function buildSkyExpansion(b: Baker, ps: PoolSet, scene: THREE.Scene, rng: RNG): Promise<void> {
  // ---- 万里云海（远景低模云团，暗藏于雾中若隐若现） ----
  const cloud = ps.get('cloudFar');
  const base = cloud.alloc(2200);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < 2200; i++) {
    if (i > 0 && i % 900 === 0) await yieldFrameS();
    const x = rng.range(-9500, 9500), z = rng.range(-9500, 9500);
    if (Math.hypot(x, z) < 3000) continue; // 都城上空留出云隙
    const y = 400 + rng.range(0, 170) + Math.sin(x * 0.0009) * 40;
    e.set(0, rng.range(0, 6.28), 0);
    q.setFromEuler(e);
    const sc = rng.range(26, 72);
    m.compose(v.set(x, y, z), q, s.set(sc, sc * 0.4, sc));
    c.setHex(0xdfeeff).offsetHSL(0, 0, -rng.range(0, 0.08));
    cloud.set(base + i, m, c);
  }
  // ---- 群宫剪影（云海之上的远处仙宫） ----
  const palaces: [number, number, number][] = [
    [-7900, 470, 5700], [9200, 495, -7000], [11400, 510, 9200], [-10500, 500, -8400], [1300, 545, 15000],
  ];
  palaces.forEach(([x, y, z], i) => {
    b.box('wall', 60, 14, 34, x, y + 7, z, shade(0xcab8d8, 1.15));
    roofOn(b, 74, 44, y + 14.5, x, z, 0, shade(0xb0a0c8, 1.1), 0xe8d8f0);
    roofOn(b, 44, 26, y + 20.5, x, z, 0, shade(0xbcaac8, 1.05), 0xe8d8f0);
    for (let k = 0; k < 5; k++) {
      b.box('glow', 0.3, 10, 0.3, x - 24 + k * 12, y + 7, z + 17.4, k % 2 ? 0xffd25e : 0xffb300);
    }
    b.box('glow', 1.2, 1.2, 1.2, x, y + 30, z, 0xffd25e, 0, 0, Math.PI / 4);
    // 底部实体云团承托（大团白云，宫不悬空）
    // 云托不能用 glow：glow 是 unlit 自发光组，34–70m 半径的白圆柱会被 Bloom 整片拉爆，
    // 在人间平视时读成「远山上一排爆白光盘」——用户反复问的「闪光是什么」就是这里。
    // 改用 fabric（受光、有绒面光泽、走 ACES），云才会随天光变色而不是永远纯白。
    // 云托：r 34–58 的 near-white fabric 是天宫最大爆白源（藏掉后区域白像素 3156→0）。
    // 收半径 24–40、并把色压到 0xb9c6d6/0xb2bfcd（线性 ≈0.62，远低于 bloom 阈值 1.05）。
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      b.cyl('fabric', 24 + rng.range(0, 12), 38 + rng.range(0, 14), 16 + rng.range(0, 7), 10,
        x + Math.cos(a) * 26, y - 12 + rng.range(-3, 3), z + Math.sin(a) * 26,
        shade(0xb9c6d6, 1 - rng.range(0, 0.12)));
    }
    b.cyl('fabric', 34, 44, 18, 12, x, y - 15, z, 0xb2bfcd);
    void i;
  });
  // ---- 天河（柔光粒子带，非实体盒——盒段会在暮色下呈黑色剪影线） ----
  const hePts = new THREE.BufferGeometry();
  const hp = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) {
    if (i > 0 && i % 300 === 0) await yieldFrameS();
    const t = rng.range(-0.02, 1.02);
    const th = t * Math.PI;
    hp[i * 3] = -9000 + 18000 * t + rng.gauss(0, 300);
    hp[i * 3 + 1] = 540 + Math.sin(t * 5.2) * 60 + rng.gauss(0, 60);
    hp[i * 3 + 2] = -5200 + Math.sin(t * 3.1) * 1800 + rng.gauss(0, 200);
  }
  hePts.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  // 天河（柔光粒子带）。sizeAttenuation:false + 5.5px + 0.32 不透明度，在人间平视时是一整条
  // 横贯天空的灰白方块噪点（读作"画面噪点"而不是星汉）。压到 2.4px / 0.09：抬头看天宫时才是星屑。
  const heBand = new THREE.Points(hePts, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, color: 0xc8d8f2, transparent: true, opacity: 0.09, fog: false, toneMapped: false }));
  heBand.name = 'sky_river';
  scene.add(heBand);

  // ---- W16：天界都城（三环群岛 + 云桥 + 远景宫阙）。放在天河之后：本段一次 rng 都不取，
  // 放在末尾既不打乱上面 2200 团远景云与 700 点天河的取数序列，也不影响下游幽冥/植被。
  buildHeavenRings(b);
  // buildCloudSeaSheets(scene);  // W22 试做：alpha 云板在 1600m 尺度上读成"冰排"，且 fps 从 85 掉到 41，已停用
  // 天宫云片：至此全部浮岛（realm/palace 的云台 + 本段 hIsland 的三环 76 岛 + 远景宫阙）已发完云团，
  // 一次性把 palace.ts 攒下的软边云片挂进场景（按象限 4 个 mesh，透明层，depthWrite:false）
  flushSkyCloudSheets(scene);
  // ---- W47：南天门门洞贯通 ----
  // realm.ts 的城台是一整块 44×8×18 实心盒（门洞位置被它 100% 堵死，射线打上去是 #6a5a3e 大板）。
  // 先按 8 角点精确摘掉那 12 个三角形，再用同 footprint 的「两墩 + 券洞」补回。
  // 必须在 compactStatic 合批之前做：合批后同材质的城台与其它构件会并进同一块几何，无法再定位。
  // 城台盒心的世界 y 是「台面 + 半高」（realm.ts 写的是 gate.y + 4），不是台面本身
  const gateCut = stripBoxTriangles(scene, 'city_wall', {
    x: SKY_GATE.x, y: SKY_GATE.y + SKY_GATE.h / 2, z: SKY_GATE.z,
    w: SKY_GATE.w, h: SKY_GATE.h, d: SKY_GATE.d,
  });
  rebuildSkyGatePassage(b, SKY_GATE);
  if (typeof window !== 'undefined') (window as unknown as { __gateCut?: number }).__gateCut = gateCut;
}

// ============ 云海可调淡出：人间仰视不再被云海盘挡死 ============
// 实测（隐藏-对照）：人间仰头看到的"天空"不是穹顶——藏穹顶(r=46000)/霾环/雾/bloom，画面三段 hex 逐位不变，
// 只有藏 city_fabric 才变（#21252c→#534861）。云海整片压在人间正上方，palette.skyTop/skyBot 在人间不参与成像。
// 云海落点：realm.ts 的 5 级云海盘 + 云团 + 云沿 + 云底 + 外缘云浪、palace.ts 的岛腰垂云与水雾，
// 全走 b.cyl('fabric', …) 烘进同一个 city_fabric（Baker 按材质组合并，运行时没有独立 mesh）；
// 云团另有 4 片 sky_cloudSheets_*（palace.flushSkyCloudSheets）与实例池 pool_cloud / pool_cloudFar。
// 处置：把 city_fabric 里重心落在云海高度带的三角面切成独立 mesh「cloudSea」（fabric 材质的 clone，
// 淡出时才开 transparent+opacity，材质类型不变），与云片/云团/远景云一起挂进 cloudSeaGroup，按观察者高度淡出。

/** 云海高度带（世界 y）：人间最高构件 < 100m，天宫台面从 201m 起，181.5–200.5 这段只含云。 */
const CLOUD_SEA_Y_MIN = 181.5;
const CLOUD_SEA_Y_MAX = 200.5;
/** 淡出区间：≤90m（人间地面）0.06，≥180m（云上/天宫）1.0 */
const CLOUD_SEA_FADE_LO = 90;
const CLOUD_SEA_FADE_HI = 180;
const CLOUD_SEA_MIN_OPACITY = 0.06;

// ============ 云海造型（局部化 + 分层受光 + 软边） ============
// 判词：「天宫漂在一个灰水塘上」/「地上的深绿色是河是湖？？头尾呢」。
// 实测（shot-hide cloudSeaGroup，y=320 俯瞰）：藏前整屏灰蓝、藏后城市完整（34.9M→18.4M 三角面）。
// 根因两条：① 五级云盘最大 r=1600、外缘云浪到 1720，横向把整座汴京盖住；
//          ② 五层全是同一个 CS_* 冷灰，且顶/底/侧壁一色，看不出顶光与背光。
// 处置：把云海收成「以天宫为中心、半径 920m 的云团」，外沿 26% 半径内 alpha 渐隐，
//       并按层高 + 法线朝向重写顶点色（顶面暖白、侧面金红、底面冷蓝、背光紫灰）。
/** 云海横向半径（世界 m）：原 1600，收到 920 只罩天宫 */
const CLOUD_SEA_RADIUS = 430;
/** 渐隐起点（占半径比例）：从 0.74R 开始 alpha 收到 0 */
const CLOUD_SEA_EDGE = 0.66;
/** 顶点色层高范围（世界 y）：186.0 云底面 → 197.0 云海顶面 */
const CLOUD_SEA_Y0 = 185.5;
const CLOUD_SEA_Y1 = 197.2;
/** 天宫档主光方向（world.ts applyLighting 里 y>150 时的 lowSun = (0.62,0.31,0.72)） */
const SKY_SUN = new THREE.Vector3(0.62, 0.31, 0.72).normalize();

// ============ 天宫体量：等比放大 ============
// 实测（几何顶点直读，非估算）：凌霄宝殿 面阔 40m（柱网 x −20…+20）、进深 22m、
// 台基底 212.80 → 正脊 239.78 → 宝顶尖 242.61，总高 29.8m。
// 而承它的云盘半径 1600m：殿宽只占云盘直径的 1/80，读成「盘子里的小亭子」。
// 处置：把 y>150（天庭层）的烘焙几何绕 (0,196,0) 等比放大 HEAVEN_SCALE 倍，
// 台阶/栏杆/斗栱/瓦垄随之整体等比——不是逐构件改数，故不会错位。
/** 天宫等比放大倍数（凌霄宝殿 面阔 40→88 / 总高 29.8→65.6）。云海先切分，故云盘不受影响 */
const HEAVEN_SCALE = 2.2;
/** 放大基准面（云海顶面）：台基与云面的关系在放大后仍以它为锚 */
const HEAVEN_BASE_Y = 196;
/** 天庭层下界：汴京地面构件最高 <150m，y>150 只含天庭 */
const HEAVEN_Y_MIN = 150;

/** 天庭层等比放大（就地改顶点）。远景宫阙剪影（r 7.9–15km）不动，否则会被推出雾外。 */
function scaleHeavenGeometry(scene: THREE.Scene, s: number): number {
  if (s <= 1) return 0;
  let meshes = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!(m.name.startsWith('city_') || m.name.startsWith('sky_cloudSheets'))) return;
    const g = m.geometry as THREE.BufferGeometry | undefined;
    const pos = g?.getAttribute('position') as AnyAttr | undefined;
    if (!g || !pos) return;
    let any = false;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < HEAVEN_Y_MIN) continue;
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x) > 1500 || Math.abs(z) > 1500) continue;
      pos.setXYZ(i, x * s, HEAVEN_BASE_Y + (y - HEAVEN_BASE_Y) * s, z * s);
      any = true;
    }
    if (!any) return;
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    meshes++;
  });
  return meshes;
}

// ============ W47：凌霄宝殿二次放大（仙宫尺度） ============
// 现状（几何直读）：2.2× 后台基 105.6×70.4、柱网面阔 88、台基底 232.96 → 宝顶 317.7，总高 84.7。
// 对标太和殿（面阔 200 含廊庑 / 本体 64m）与用户要求「面阔 ≥150、总高 ≥120」，
// 天宫正殿应比皇宫正殿再大一档，故在 2.2× 之上再叠 1.75×：
//   面阔 88 → 154、总高 84.7 → 148.2、台基 184.8。
// 倍率取**等比**而不是 x/z 拉宽 + y 拉高：非等比会把蟠龙柱压成椭圆（差 20%），近看即穿帮。
// 只缩放「台基 + 殿身 + 屋面 + 室内陈设」这一块（|x|≤56、z 209±62、y≥230），
// 不动云台岩盘与岛裙：云台半径 197 仍大于放大后 184.8 的台基，殿不会悬空；
// 云台不动也就不会与南侧斗法云台（中心 z −17.6、半径 96.8）相撞。
const LINGXIAO_SCALE = 1.75;
/** 放大锚点：台基底（缩放时台基底面不动，殿身向上长高） */
const LINGXIAO_ANCHOR = { x: 0, y: 233, z: 209 } as const;
const LINGXIAO_HALF_X = 56;
const LINGXIAO_HALF_Z = 62;
const LINGXIAO_Y_MIN = 230;

/** 凌霄殿与朝房（z 162.8）一并放大，避免放大后的台基（z 147.4 起）把朝房埋进去 */
function enlargeLingxiao(scene: THREE.Scene, k: number): number {
  if (k <= 1) return 0;
  const a = LINGXIAO_ANCHOR;
  let meshes = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith('city_')) return;
    const g = m.geometry as THREE.BufferGeometry | undefined;
    const pos = g?.getAttribute('position') as AnyAttr | undefined;
    if (!g || !pos) return;
    let any = false;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < LINGXIAO_Y_MIN) continue;
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x - a.x) > LINGXIAO_HALF_X || Math.abs(z - a.z) > LINGXIAO_HALF_Z) continue;
      pos.setXYZ(i, a.x + (x - a.x) * k, a.y + (y - a.y) * k, a.z + (z - a.z) * k);
      any = true;
    }
    if (!any) return;
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    meshes++;
  });
  return meshes;
}

/**
 * 南天门背面补匾。
 *
 * 现场取证：`SignMesher.quad` 其实已经生成双面（背面镜像 UV，文字正读），但正面匾挂在
 * 门楼 z −176.9，而门楼「横梁 40×3×5」（z −192.5…−181.5）整块挡在它后面 —— 从背面看，
 * 匾被自己的梁遮死，所以「只有一侧有牌匾」。
 *
 * 做法：把 `city_signs` 里属于这块匾的三角形整体复制一份，沿 −z 平移到门楼背面外侧
 * （z −193.1，比梁背面 −192.5 再出 0.6m），背面即获得一块同样可读的匾。
 * 只复制三角形，不动任何既有实例。
 */
function cloneGatePlaque(scene: THREE.Scene): number {
  const ZF = (SKY_GATE.z + 4.6) * HEAVEN_SCALE;   // 正面匾世界 z = −176.88
  const ZB = -193.1;                              // 背面匾落位（门楼梁背面 −192.5，再出 0.6）
  const Y0 = HEAVEN_BASE_Y + (SKY_GATE.y + 25 - HEAVEN_BASE_Y) * HEAVEN_SCALE; // 266.4
  const HX = 11.5, HY = 3.6, EZ = 0.25;
  let added = 0;
  const targets: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name.startsWith('city_signs')) targets.push(m);
  });
  for (const m of targets) {
    const g = m.geometry as THREE.BufferGeometry | undefined;
    const pos = g?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!g || !pos || g.getIndex()) continue;     // 匾是 non-indexed（SignMesher 逐三角推入）
    const nv = pos.count;
    const clone: number[] = [];
    for (let t = 0; t < nv / 3; t++) {
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (Math.abs(z - ZF) > EZ || Math.abs(x) > HX || Math.abs(y - Y0) > HY) { ok = false; break; }
      }
      if (ok) clone.push(t * 3, t * 3 + 1, t * 3 + 2);
    }
    if (!clone.length) continue;
    const ng = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const src = g.getAttribute(name) as THREE.BufferAttribute;
      const is = src.itemSize;
      const Ctor = (src.array as TypedArr).constructor as new (n: number) => TypedArr;
      const dst = new Ctor((nv + clone.length) * is);
      for (let i = 0; i < nv; i++) for (let k = 0; k < is; k++) dst[i * is + k] = (src.array as TypedArr)[i * is + k];
      for (let j = 0; j < clone.length; j++) {
        const s = clone[j];
        for (let k = 0; k < is; k++) dst[(nv + j) * is + k] = (src.array as TypedArr)[s * is + k];
      }
      if (name === 'position') {
        // 不是平移，是「绕 Y 轴 180°」：SignMesher.quad 生成了两块共面的面片
        // （+z 法线用正常 UV、−z 法线用镜像 UV，后者才是从背面正读的那块）。
        // 如果只平移，从背面看到的是原本朝 +z 的那块，字是反的（实测截图为「門天南」）。
        // 转 180° 后，原本朝 +z 的面改为朝 −z，从背面读就是正的。
        for (let j = 0; j < clone.length; j++) {
          const s = clone[j];
          const sx = (src.array as TypedArr)[s * is] as number;
          const sz = (src.array as TypedArr)[s * is + 2] as number;
          dst[(nv + j) * is] = -sx;
          dst[(nv + j) * is + 2] = ZB + ZF - sz;
        }
      }
      ng.setAttribute(name, new THREE.BufferAttribute(dst, is, src.normalized));
    }
    g.dispose();
    m.geometry = ng;
    ng.computeBoundingSphere();
    added += clone.length / 3;
  }
  return added;
}

const _cloudUnder = new THREE.Color(0x46566b);   // 云底 / 背光下沿：冷蓝灰
const _cloudMid = new THREE.Color(0x6f7f97);     // 中层：中性
const _cloudTop = new THREE.Color(0x9aabc1);     // 顶层受光面：冷白（再叠向光暖色）
const _cloudSun = new THREE.Color(0xd9b183);     // 向光面（低角度侧光 → 金红）
const _cloudShade = new THREE.Color(0x5f5c80);   // 背光面：紫灰

/**
 * 观察者高度 → 云海不透明度。人间（≤90m）压到 0.06 让穹顶渐变显出来；
 * 升空到 ≥180m 恢复 1.0（天宫视角与原画面一致）；中间 smoothstep，避免传送瞬间硬跳。
 * NaN/Infinity 视为未知高度 → 保持 1.0（宁可不淡出，也不让天宫突然缺云）。
 */
export function cloudSeaOpacityAt(y: number): number {
  if (!Number.isFinite(y)) return 1;
  if (y <= CLOUD_SEA_FADE_LO) return CLOUD_SEA_MIN_OPACITY;
  if (y >= CLOUD_SEA_FADE_HI) return 1;
  const t = (y - CLOUD_SEA_FADE_LO) / (CLOUD_SEA_FADE_HI - CLOUD_SEA_FADE_LO);
  return CLOUD_SEA_MIN_OPACITY + (1 - CLOUD_SEA_MIN_OPACITY) * t * t * (3 - 2 * t);
}

export interface CloudSeaHandle {
  /** cloudSeaGroup：切出的云海 mesh + 云片 + 云团/远景云实例池 */
  readonly group: THREE.Group;
  /** 当前生效的不透明度（0.06–1） */
  readonly opacity: number;
  /** 已纳入的网格数（首次绑定后才准确） */
  readonly meshCount: number;
  /** 从 city_fabric 切出的云海顶点数 */
  readonly plateVertices: number;
  /** 每帧由 world.ts 调用：y 越低越透明（≤90m 时 0.06），≥180m 时 1.0 */
  setViewerY(y: number): void;
}

type AnyAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
interface CloudSeaSplit { cloud: THREE.BufferGeometry | null; rest: THREE.BufferGeometry | null; verts: number }

/** 按三角面重心是否落在云海高度带，把 fabric 几何切成「云海 / 其余」两份（输出均为非索引）。 */
function splitCloudSeaGeometry(geo: THREE.BufferGeometry): CloudSeaSplit {
  const pos = geo.getAttribute('position') as AnyAttr | undefined;
  if (!pos) return { cloud: null, rest: null, verts: 0 };
  const nrm = geo.getAttribute('normal') as AnyAttr | undefined;
  const col = geo.getAttribute('color') as AnyAttr | undefined;
  const uv = geo.getAttribute('uv') as AnyAttr | undefined;
  const idx = geo.index ? (geo.index.array as ArrayLike<number>) : null;
  const triCount = Math.floor((idx ? idx.length : pos.count) / 3);
  const isCloud = new Uint8Array(triCount);
  let cloudTris = 0;
  const vAt = (t: number, k: number): number => (idx ? idx[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    const cy = (pos.getY(vAt(t, 0)) + pos.getY(vAt(t, 1)) + pos.getY(vAt(t, 2))) / 3;
    if (cy >= CLOUD_SEA_Y_MIN && cy <= CLOUD_SEA_Y_MAX) { isCloud[t] = 1; cloudTris++; }
  }
  if (cloudTris === 0) return { cloud: null, rest: null, verts: 0 };
  const parts = (want: 0 | 1): THREE.BufferGeometry | null => {
    const tris = want ? cloudTris : triCount - cloudTris;
    if (tris === 0) return null;
    const out = new THREE.BufferGeometry();
    const fill = (name: string, src: AnyAttr | undefined): void => {
      if (!src) return;
      const size = src.itemSize;
      const arr = new Float32Array(tris * 3 * size);
      let w = 0;
      for (let t = 0; t < triCount; t++) {
        if (isCloud[t] !== want) continue;
        for (let k = 0; k < 3; k++) {
          const v = vAt(t, k);
          for (let c = 0; c < size; c++) arr[w++] = c === 0 ? src.getX(v) : c === 1 ? src.getY(v) : c === 2 ? src.getZ(v) : src.getW(v);
        }
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    };
    fill('position', pos);
    fill('normal', nrm);
    fill('color', col);
    fill('uv', uv);
    out.computeBoundingSphere();
    return out;
  };
  return { cloud: parts(1), rest: parts(0), verts: cloudTris * 3 };
}

/** 加载尚未结束时不切分：city_fabric 还在按步 flush，切早了会漏掉同批/后续批次的云海。 */
const loadingDone = (): boolean => typeof document === 'undefined' || !document.getElementById('loading');

const smoothstep01 = (e0: number, e1: number, x: number): number => {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 云海顶点色：层高梯度（底冷 → 顶暖白）× 法线朝向（向光金红 / 背光紫灰）× 低频噪声 */
function cloudSeaTint(out: THREE.Color, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const h = Math.min(1, Math.max(0, (y - CLOUD_SEA_Y0) / (CLOUD_SEA_Y1 - CLOUD_SEA_Y0)));
  if (h < 0.55) out.copy(_cloudUnder).lerp(_cloudMid, h / 0.55);
  else out.copy(_cloudMid).lerp(_cloudTop, (h - 0.55) / 0.45);
  const d = nx * SKY_SUN.x + ny * SKY_SUN.y + nz * SKY_SUN.z;
  if (d > 0) out.lerp(_cloudSun, Math.min(0.5, d * 0.55));
  else out.lerp(_cloudShade, Math.min(0.42, -d * 0.5));
  // 低频起伏：单层大面积平色是「水塘」的主因之一，用两段正弦打散（无 rng，可复现）
  const n = Math.sin(x * 0.011 + z * 0.007) * 0.5
    + Math.sin(x * 0.0041 - z * 0.0127) * 0.3
    + Math.sin(x * 0.031 + z * 0.023) * 0.2;
  out.multiplyScalar(1 + n * 0.17);
}

/** 云海外沿的方位抖动：让渐隐边界是云絮状的，而不是又一个同心圆 */
function cloudEdgeWobble(ang: number): number {
  return 0.5 + 0.30 * Math.sin(ang * 3 + 1.1) + 0.14 * Math.sin(ang * 7 + 2.3) + 0.08 * Math.sin(ang * 13 + 0.4);
}

/**
 * 云海重造型（就地改几何）：① 丢掉重心在 920m 之外的三角面；② 顶点色改写成云色（vec4，alpha 做径向渐隐）。
 * @returns 保留的顶点数（0 = 整片都没了）
 */
function sculptCloudSea(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as AnyAttr | undefined;
  if (!pos) return 0;
  const nrm = geo.getAttribute('normal') as AnyAttr | undefined;
  const uv = geo.getAttribute('uv') as AnyAttr | undefined;
  const triCount = Math.floor(pos.count / 3);
  const keep = new Uint8Array(triCount);
  let kept = 0;
  const rMax = CLOUD_SEA_RADIUS * 1.02;
  for (let t = 0; t < triCount; t++) {
    const cx = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3;
    const cz = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
    if (Math.hypot(cx, cz) <= rMax) { keep[t] = 1; kept++; }
  }
  if (kept === 0) return 0;
  const n = kept * 3;
  const pOut = new Float32Array(n * 3);
  const nOut = nrm ? new Float32Array(n * 3) : null;
  const uOut = uv ? new Float32Array(n * 2) : null;
  const cOut = new Float32Array(n * 4);
  const col = new THREE.Color();
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    if (!keep[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      pOut[w * 3] = x; pOut[w * 3 + 1] = y; pOut[w * 3 + 2] = z;
      let nx = 0, ny = 1, nz = 0;
      if (nOut && nrm) {
        nx = nrm.getX(v); ny = nrm.getY(v); nz = nrm.getZ(v);
        nOut[w * 3] = nx; nOut[w * 3 + 1] = ny; nOut[w * 3 + 2] = nz;
      }
      if (uOut && uv) { uOut[w * 2] = uv.getX(v); uOut[w * 2 + 1] = uv.getY(v); }
      cloudSeaTint(col, x, y, z, nx, ny, nz);
      cOut[w * 4] = col.r; cOut[w * 4 + 1] = col.g; cOut[w * 4 + 2] = col.b;
      const r = Math.hypot(x, z);
      const rEdge = CLOUD_SEA_RADIUS * (0.84 + 0.16 * cloudEdgeWobble(Math.atan2(z, x)));
      cOut[w * 4 + 3] = 1 - smoothstep01(CLOUD_SEA_EDGE, 1, r / rEdge);
      w++;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pOut, 3));
  if (nOut) geo.setAttribute('normal', new THREE.BufferAttribute(nOut, 3));
  else geo.deleteAttribute('normal');
  if (uOut) geo.setAttribute('uv', new THREE.BufferAttribute(uOut, 2));
  else geo.deleteAttribute('uv');
  // 旧的 vec3 顶点色必须先删，否则同名属性保留 3 分量、USE_COLOR_ALPHA 不生效
  geo.setAttribute('color', new THREE.BufferAttribute(cOut, 4));
  geo.computeBoundingSphere();
  return n;
}

/** 云海材质：吃光（Physical，带 sheen 的绒面），顶点色带 alpha → 外沿可控渐隐，depthWrite 关掉便于叠体积 */
function cloudSeaMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'cloudSeaMat',
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    // 云不反环境：env 强度压到 0.12（默认 1.0 会把整片云拉成纯白，实测第一次接线即 255 全白）
    envMapIntensity: 0.12,
    sheen: 0.2,
    sheenRoughness: 0.95,
    sheenColor: new THREE.Color(0xc9b394),
    side: THREE.DoubleSide,
  });
  return mat;
}

/** 天宫云雾：成团立体云（InstancedMesh 球体 + 边缘 alpha 淡出 + shader 里缓慢流动） */
interface MistRig {
  mesh: THREE.InstancedMesh;
  uniforms: { uTime: THREE.IUniform<number> };
}

/**
 * 云雾缭绕：以天宫正殿（0, 95）为中心的 4 圈云团——云根（托住台基）、冠云（压住飞檐）、
 * 缭绕环（150–430m）与外缘云幕（430–760m）。全部吃场景主光（MeshStandard），
 * 片元里按「法线·视线」做边缘淡出，球体因此读成云絮而不是白球；顶点着色器里按时间缓慢起伏。
 * 只 +1 draw call。
 */
function buildHeavenMist(scene: THREE.Scene, scale: number): MistRig {
  const CX = 0, CZ = 95;
  const yOf = (y: number): number => 196 + (y - 196) * scale;
  const spots: [number, number, number, number, number, number][] = []; // x,y,z,rXZ,rY,alpha
  const push = (x: number, y: number, z: number, r: number, sy: number, a: number): void => {
    // 位置随天宫放大，尺寸只随 √scale（全跟随会把云团撑成 150m 的大白球）
    const rs = Math.sqrt(scale);
    spots.push([CX + x * scale, yOf(y), CZ + z * scale, r * rs, sy * rs, a]);
  };
  // ① 云海表层：整片云团的「云丘」——从正上方看，云海的可读性主要来自这些丘与丘之间的暗谷
  for (let i = 0; i < 150; i++) {
    const a = skyJitter(i, 351.7) * Math.PI * 2;
    const rr = Math.sqrt(skyJitter(i, 352.9)) * 400;
    // 外沿 0.78R 起压薄，避免云丘在盘边排成硬边
    const edge = 1 - smoothstep01(0.66, 1.0, rr / 430);
    // 云丘下沉到盘面以下（188–196.5）：读成从云海里长出来的丘，而不是漂在云面上的白球
    push(Math.cos(a) * rr, 188 + skyJitter(i, 353.7) * 8.5, Math.sin(a) * rr,
      26 + skyJitter(i, 354.1) * 62, 0.34 + skyJitter(i, 355.3) * 0.24,
      (0.16 + skyJitter(i, 356.7) * 0.26) * edge);
  }
  // ①b 云根：正殿台基四周 + 台底，把「殿骑在云上」做实
  // W47：云根环原先贴到 r 26（放大后 57m），正压在凌霄台基与丹陛上，把殿身下半截糊成一片白。
  //      外推 1.6×、压低不透明度 —— 云托住台基，但不吃台基。
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + skyJitter(i, 301.7) * 0.35;
    const rr = 42 + skyJitter(i, 302.9) * 112;
    push(Math.cos(a) * rr, 192 + skyJitter(i, 303.7) * 20, Math.sin(a) * rr,
      16 + skyJitter(i, 304.1) * 20, 0.55 + skyJitter(i, 305.3) * 0.25, 0.17 + skyJitter(i, 306.7) * 0.16);
  }
  // ② 冠云：正殿屋面之上与两侧
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + skyJitter(i, 311.3) * 0.4;
    const rr = 20 + skyJitter(i, 312.7) * 78;
    push(Math.cos(a) * rr, 238 + skyJitter(i, 313.9) * 20, Math.sin(a) * rr,
      9 + skyJitter(i, 314.3) * 9, 0.6 + skyJitter(i, 315.1) * 0.2, 0.10 + skyJitter(i, 316.3) * 0.12);
  }
  // ③ 缭绕环：宫阙外的第一圈云海气团
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + skyJitter(i, 321.7) * 0.5;
    const rr = 110 + skyJitter(i, 322.9) * 190;
    push(Math.cos(a) * rr, 191 + skyJitter(i, 323.7) * 18, Math.sin(a) * rr,
      24 + skyJitter(i, 324.1) * 26, 0.42 + skyJitter(i, 325.3) * 0.3, 0.22 + skyJitter(i, 326.9) * 0.22);
  }
  // ④ 外缘云幕：让云海外沿继续往天空化开
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + skyJitter(i, 331.3) * 0.4;
    const rr = 240 + skyJitter(i, 332.7) * 200;
    push(Math.cos(a) * rr, 188 + skyJitter(i, 333.1) * 12, Math.sin(a) * rr,
      40 + skyJitter(i, 334.3) * 45, 0.34 + skyJitter(i, 335.7) * 0.22, 0.2 + skyJitter(i, 336.1) * 0.22);
  }

  const geo = new THREE.IcosahedronGeometry(1, 2);
  const n = spots.length;
  const phase = new Float32Array(n);
  const opacity = new Float32Array(n);
  // W47：云团反照率收到「受光面不过 1.0 线性」的档。
  // 现场取证：旧值 color 0xffffff + instanceColor 0xe4ebf6（线性 0.78/0.85/0.94），
  // 天宫主光 1.4 + 补光 0.95 + 半球 0.55 + 环境 0.35 ≈ 3.2 倍照度，乘积 2.5–3.0，
  // ACES 之后整团裁成 (255,255,255) —— 用户看到的「一片死白」就是这一步。
  // 现取 albedo≈0.29 线性（0x969fac）→ 受光 0.9、背光 0.4，留出可见的明暗过渡。
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
    // 云团不反环境（默认 envMapIntensity 1.0 会把云团拉成白球）
    envMapIntensity: 0.1,
    // 顶点色不用；云的冷暖靠 instanceColor + 场景主光/补光分出来
  }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const [x, y, z, r, sy, a] = spots[i];
    e.set(0, skyJitter(i, 341.9) * Math.PI * 2, 0);
    q.setFromEuler(e);
    // 横向各向异性：正圆球在正上方看是一圈圆圈，压扁 + 拉长后读成云絮
    m4.compose(v.set(x, y, z), q, s.set(r * (0.85 + skyJitter(i, 345.1) * 0.6), Math.max(6, r * sy), r * (0.7 + skyJitter(i, 342.7) * 0.6)));
    mesh.setMatrixAt(i, m4);
    // 云色：冷调的两档中性灰蓝（暖/冷由场景主光与补光自己分）。
    // 旧值 0xe4ebf6 / 0xcdd8e8 是「近白反照率」，任何直射光都会把它顶到裁白；这里压到中调。
    const warm = skyJitter(i, 343.1);
    c.setHex(warm > 0.55 ? 0x9aa5b5 : 0x828d9e);
    mesh.setColorAt(i, c);
    phase[i] = skyJitter(i, 344.3) * 6.283;
    opacity[i] = a;
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacity, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'heavenMist';
  mesh.renderOrder = 6;

  const uniforms = { uTime: { value: 0 } };
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;\nattribute float aOpacity;\nvarying float vMistAlpha;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        // 球面法线扰动：不扰动的话每团都是「光滑白球」，一屏几十个圆球读成棉花球而不是云
        objectNormal += vec3(
          sin(position.x * 3.7 + aPhase + uTime * 0.21),
          sin(position.y * 3.1 + aPhase * 1.3 - uTime * 0.17),
          sin(position.z * 4.1 + aPhase * 0.7 + uTime * 0.13)) * 0.42;
        objectNormal = normalize(objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float mph = aPhase + position.x * 0.35;
        transformed.x += sin(uTime * 0.16 + mph) * 0.10;
        transformed.y += sin(uTime * 0.23 + mph * 1.7) * 0.10;
        transformed.z += cos(uTime * 0.13 + mph * 1.3) * 0.10;
        vMistAlpha = aOpacity;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMistAlpha;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // 边缘淡出：只保留「法线朝向相机」的核心，剪影处 alpha→0。
        // 用 pow 而不是窄 smoothstep —— 窄带宽会让球体 90% 面积不透明，几十个球叠起来就是「棉花球」。
        float mistRim = clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0);
        // W47 上下面分层：朝上的面吃天光（1.0），朝下的面最暗（0.62）。
        // 没有这一条时，一团云在屏幕上是一块亮度均匀的半透明白斑，
        // 叠上几十团就读成"一片死白"；有了它每团自带顶亮底暗的立体感。
        float mistUp = clamp(vNormal.y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor.rgb *= mix(0.62, 1.0, mistUp);
        // 总不透明度再压 0.62：242 团互相叠的地方，单团 alpha 再低也会累加到 1.0
        gl_FragColor.a *= vMistAlpha * 0.62 * pow(mistRim, 2.4);`);
  };
  scene.add(mesh);
  return { mesh, uniforms };
}

let _cloudSeaView: { scene: THREE.Scene; handle: CloudSeaHandle } | null = null;
/** 凌霄殿二次放大只允许跑一次：bind() 若被重入（loadingDone 竞态）会把台基放大两次 */
let palaceScaled = false;

/**
 * 建立云海视图句柄（同一 scene 幂等）。加载完成后调用一次，之后每帧 `setViewerY(相机/化身 y)`。
 * 若在加载期间调用，会等加载结束后的首次 setViewerY 再绑定（绑定是一次性切分，约 50–100ms）。
 */
export function buildCloudSeaView(scene: THREE.Scene): CloudSeaHandle {
  if (_cloudSeaView && _cloudSeaView.scene === scene) return _cloudSeaView.handle;
  const group = new THREE.Group();
  group.name = 'cloudSeaGroup';
  scene.add(group);

  /** 参与淡出的材质 + 它原本的不透明度（云团实例池是 0.64，云片/云海是 1） */
  const layers: { mat: THREE.Material; base: number }[] = [];
  /** 切出来的云海材质：淡出时翻 transparent，恢复满不透明时翻回不透明通道 */
  const plateMats: THREE.Material[] = [];
  /** 切出来的云海 mesh：贴地（0.06 档）直接整片隐藏，省掉全屏 alpha 叠层的填充开销 */
  const plateMeshes: THREE.Mesh[] = [];
  const seen = new Set<THREE.Material>();
  const track = (mat: THREE.Material | THREE.Material[] | undefined): void => {
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (seen.has(m)) continue;
      seen.add(m);
      layers.push({ mat: m, base: m.opacity });
    }
  };

  let bound = false;
  let plateVertices = 0;
  let meshCount = 0;
  let opacity = 1;
  let mist: MistRig | null = null;
  let lastT = 0;

  const bind = (): boolean => {
    // ① 切出烘焙在 city_fabric 里的云海（5 级云盘 / 云沿 / 云底 / 岛腰垂云 / 水雾）
    let plates = 0;
    const fabrics: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /^city_fabric(_\d+)?$/.test(m.name)) fabrics.push(m);
    });
    const cutClouds: THREE.BufferGeometry[] = [];
    for (const src of fabrics) {
      const split = splitCloudSeaGeometry(src.geometry as THREE.BufferGeometry);
      if (!split.cloud) continue;
      const srcMat = src.material as THREE.Material;
      if (split.rest) {
        // 其余 fabric 仍叫 city_fabric：既有探针（shot-hide city_fabric）与后续合批都按这个名字
        const rest = new THREE.Mesh(split.rest, srcMat);
        rest.name = src.name;
        rest.castShadow = src.castShadow;
        rest.receiveShadow = src.receiveShadow;
        rest.matrixAutoUpdate = false;
        scene.add(rest);
      }
      cutClouds.push(split.cloud);
      scene.remove(src);
      (src.geometry as THREE.BufferGeometry).dispose();
    }
    // ② 天宫体量：把 y>150 的全部烘焙几何绕 (0, 196, 0) 等比放大。
    //    凌霄宝殿（realm.ts 建，面阔 40 / 进深 22 / 台基底 212.8 → 宝顶 242.4）在 1600m 云盘上
    //    只有「几十米的小亭」的量级；放大后才有「高大恢弘」的尺度。云海已先切出，不受影响。
    const scaled = scaleHeavenGeometry(scene, HEAVEN_SCALE);
    void scaled;
    // ②b W47：凌霄宝殿在 2.2× 之上再叠 1.75×（面阔 88→154、总高 84.7→148.2）。
    //     必须在 2.2× 之后、云海成片之前，且只跑一次（bind 若被重入会把台基放大两次）。
    if (!palaceScaled) {
      palaceScaled = true;
      const n = enlargeLingxiao(scene, LINGXIAO_SCALE);
      if (typeof window !== 'undefined') (window as unknown as { __lxScaled?: number }).__lxScaled = n;
    }
    // ③ 云海重造型（裁半径 + 分层顶点色 + 径向 alpha）与成片
    for (const cloudGeo of cutClouds) {
      const kept = sculptCloudSea(cloudGeo);
      if (kept === 0) { cloudGeo.dispose(); continue; }
      const mat = cloudSeaMaterial();
      const cloud = new THREE.Mesh(cloudGeo, mat);
      cloud.name = plates === 0 ? 'cloudSea' : 'cloudSea_' + plates;
      cloud.matrixAutoUpdate = false;
      cloud.frustumCulled = false;
      group.add(cloud);
      track(mat);
      plateMats.push(mat);
      plateMeshes.push(cloud);
      plateVertices += kept;
      plates++;
    }
    // ④ 天宫云雾（成团立体云，随帧缓慢流动）
    mist = buildHeavenMist(scene, HEAVEN_SCALE);
    // ② 云片（4 个独立 mesh，承载岛腰 178 团云）与云团/远景云实例池：attach 进组（保持世界变换）
    //    名字沿用原名：shot-hide / probe-scene 等探针按名字前缀取证，改名会断掉既有工具链
    for (let i = 0; i < 4; i++) {
      const o = scene.getObjectByName('sky_cloudSheets_' + i);
      if (!o) continue;
      track((o as THREE.Mesh).material as THREE.Material);
      group.attach(o);
    }
    for (const n of ['pool_cloud', 'pool_cloudFar']) {
      const o = scene.getObjectByName(n);
      if (!o) continue;
      track((o as THREE.Mesh).material as THREE.Material);
      group.attach(o);
    }
    for (const c of group.children) {
      c.userData.cloudSea = c.name.startsWith('cloudSea') ? 'plate'
        : c.name.startsWith('sky_cloudSheets') ? 'puffSheet'
        : c.name === 'pool_cloud' ? 'puffPool' : 'farPool';
    }
    meshCount = group.children.reduce((n, c) => n + ((c as THREE.Mesh).isMesh ? 1 : 0), 0);
    group.userData.cloudSea = { plates, plateVertices, meshes: meshCount };
    // ⑤ W47：南天门背面补匾（正面匾被门楼横梁从背面遮死，这里复制一块到梁背外侧）
    const plaqueTris = cloneGatePlaque(scene);
    if (typeof window !== 'undefined') (window as unknown as { __gatePlaqueTris?: number }).__gatePlaqueTris = plaqueTris;
    bound = plates > 0 || meshCount > 0;
    return bound;
  };

  const handle: CloudSeaHandle = {
    group,
    get opacity() { return opacity; },
    get meshCount() { return meshCount; },
    get plateVertices() { return plateVertices; },
    setViewerY(y: number): void {
      if (!bound && !(loadingDone() && bind())) return;
      // 云雾流动：world.ts 每帧调一次 setViewerY，正好当帧钟用（不受 applyLighting 影响）
      const nowS = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
      if (lastT > 0) {
        const dt = Math.min(0.25, Math.max(0, nowS - lastT));
        if (mist) mist.uniforms.uTime.value += dt;
        if (mist) mist.mesh.rotation.y += dt * 0.006;
      }
      lastT = nowS;
      const op = cloudSeaOpacityAt(y);
      if (op === opacity) return;
      opacity = op;
      for (const l of layers) l.mat.opacity = l.base * op;
      // 云海是 6–10 层同心云盘叠起来的体积，逐层用 nominal 会叠加饱和：0.06×10 层 ≈ 46% 遮挡、
      // 0.3×10 层 ≈ 97%，肉眼看就是「开关」而不是渐变。按 1/6 次幂反解成逐层不透明度，
      // 让「穿透后的等效遮挡」≈ cloudSeaOpacityAt(y)（readPixels 实测）：y=120 ≈45%、140 ≈80%、170 ≈99%。
      const layerOp = 1 - Math.pow(1 - op, 1 / 6);
      for (const m of plateMats) m.opacity = layerOp;
      // 贴地整片隐藏：0.06 档肉眼已不可见，但仍是全屏 alpha 叠层（软光栅实测 52→22fps）。
      // 规格允许「≤0.06 或直接 visible=false」，取后者换掉这份填充开销。
      const hide = op <= CLOUD_SEA_MIN_OPACITY + 1e-9;
      for (const m of plateMeshes) m.visible = !hide;
      // 云海材质常驻 transparent（顶点 alpha 做外沿渐隐），不再在两条通道间翻：
      // 翻通道必须 needsUpdate 重编译，且 OPAQUE 宏会把 alpha 强制成 1，外沿渐隐会失效。
      // depthWrite 保持 false：半透明云海若写深度，会把后面的云片/云团按深度剔掉，整片读成一堵暗墙。
    },
  };
  // 加载已完成（正常接线：world.ts 在 load 之后建句柄）→ 立即切分，切分开销落在加载段而非首帧
  if (loadingDone()) bind();
  _cloudSeaView = { scene, handle };
  return handle;
}

/**
 * 云海体积层（W22）：参考「栖光·天宫」系列里，云是画面主角、占一半以上，
 * 而我们之前只有一块平板 + 若干球团，读起来是"结冰的湖面"。
 * 这里叠 4 层带**程序化软边 alpha** 的环形云板：半径 320→1700、高度 188.4→197.2、
 * 每层独立透明度与 UV 缩放，边缘靠 alpha 自然散开，不再有硬圆边。
 * 全部 depthWrite:false + transparent，靠绘制顺序叠出体积感；draw call 只 +4。
 */
function buildCloudSeaSheets(scene: THREE.Scene): void {
  // 程序化云纹：多尺度径向斑点 + 阈值化软边（无外部贴图）
  const SZ = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = SZ;
  const cx = cv.getContext('2d')!;
  cx.fillStyle = '#000'; cx.fillRect(0, 0, SZ, SZ);
  const blob = (x: number, y: number, r: number, a: number): void => {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
  };
  for (let i = 0; i < 260; i++) {
    const r = 18 + Math.random() * 96;
    blob(Math.random() * SZ, Math.random() * SZ, r, 0.16 + Math.random() * 0.3);
  }
  for (let i = 0; i < 900; i++) {
    blob(Math.random() * SZ, Math.random() * SZ, 4 + Math.random() * 18, 0.22 + Math.random() * 0.3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const layers: [number, number, number, number, number][] = [
    // [内径, 外径, y, 不透明度, UV 重复]
    [240, 620, 197.2, 0.55, 3],
    [420, 1050, 195.0, 0.62, 5],
    [620, 1450, 192.4, 0.5, 7],
    [760, 1720, 188.6, 0.38, 9],
  ];
  for (const [r0, r1, y, op, rep] of layers) {
    const geo = new THREE.RingGeometry(r0, r1, 96, 6);
    geo.rotateX(-Math.PI / 2);
    const map = tex.clone();
    map.needsUpdate = true;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(rep, rep);
    const mat = new THREE.MeshBasicMaterial({
      map, transparent: true, opacity: op, depthWrite: false,
      color: 0xf2f7fc, toneMapped: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    mesh.name = 'cloudSeaSheet';
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

// ============ 幽冥扩张：丰都鬼城 + 十八狱环 ============
// 丰都十二类铺面（46 卷 D-HOU-01..12）与十八狱名，按设定卷落地
const FENGDU_KINDS = ['賭鬼坊', '餓鬼食肆', '紙扎鋪', '棺材鋪', '義莊', '城隍分殿', '鬼客棧', '怨婦樓', '戲鬼樓', '雜貨鬼鋪', '墳墓宅', '遊魂廟'];
const PRISON_NAMES = ['拔舌獄', '剪刀獄', '鐵樹獄', '孽鏡獄', '蒸籠獄', '銅柱獄', '刀山獄', '冰山獄', '油鍋獄', '牛坑獄', '石壓獄', '舂臼獄', '血池獄', '枉死獄', '鑊湯獄', '寒冰獄', '剝皮獄', '火床獄'];

export function buildUnderworldExpansion(b: Baker, sg: SignMesher, atlas: SignAtlas, rng: RNG): void {
  const y = -260;
  // 街区底景：冥土台地、街巷、街灯幡旗、界墙牌坊、街面杂物（必须先于屋舍，屋舍落在实地上）
  buildFengduGround(b, sg, atlas, rng);
  // 鬼城丰都（阎罗殿以东的幽暗街区）。y 基准 -260 必须加到每个高度上，否则 90 座鬼屋全部落到人间地表
  for (let i = 0; i < 90; i++) {
    const kind = i % 12;
    const x = FENGDU.x0 + (i % FENGDU.cols) * FENGDU.colGap + rng.range(-5, 5);
    const z = FENGDU.z0 + Math.floor(i / FENGDU.cols) * FENGDU.rowGap + rng.range(-4, 4);
    const w2 = rng.range(24, 34), d2 = rng.range(7, 12);
    const hh = kind === 5 ? rng.range(6, 8) : kind === 7 || kind === 8 ? rng.range(6.5, 9) : rng.range(3.4, 6);
    // 残破三档：0 完好 / 1 倾颓（微倾+下沉）/ 2 半塌（斜置+深沉+收分）
    const tier = i % 3;
    const tilt = tier === 0 ? 0 : tier === 1 ? 0.045 : 0.09;
    const sink = tier === 0 ? 0 : tier === 1 ? 0.5 : 1.3;
    const shrink = tier === 2 ? 0.88 : 1;
    const wallC = kind === 3 ? 0x1c141c : kind === 4 ? 0x2e2420 : kind === 10 ? 0x242028 : rng.chance(0.5) ? 0x241a20 : 0x1c2226;
    // 隔排对望：偶数排面 +z、奇数排面 −z，长街两侧都有铺面，不再半边空场
    const ry = Math.floor(i / FENGDU.cols) % 2 === 0 ? 0 : Math.PI;
    b.box('ash', w2 * shrink, hh, d2 * shrink, x, y + hh / 2 - sink, z, wallC, ry, tilt, tilt * 0.6);
    // 逐铺细节：屋顶檐口、基座、板门、直棂窗、雨棚、灯笼、匾额与十二类外摆
    buildGhostShopDetail(b, {
      x, z, y, w: w2 * shrink, d: d2 * shrink, h: hh, kind, sink, tilt, ry,
      sign: { sg, atlas, label: FENGDU_KINDS[kind], key: 'fengdu-shop-' + kind },
    });
  }
  // 十八狱逐狱装置（B2，46 卷 §4.2 配置表实装，替换旧三色轮换简环）
  buildEighteenHells(b, sg, atlas);
  // 血池
  b.cyl('glow', 130, 150, 0.4, 22, -1400, y + 0.4, 300, 0x8a1420, 0, 0, 0, true);
  b.cyl('glow', 90, 90, 0.3, 18, -1400, y + 0.7, 300, 0xff3a4a, 0, 0, 0, true);
  // 幽冥路牌
  b.box('wall', 3, 9, 1, -1500, y + 4.5, 180, 0x1c141c, 0, 0, 0.05);
}

// ============ W16：天界都城——三环群岛 / 云桥 / 远景宫阙 ============
// 判词（用户原话）：「恢弘庞大的天宫怎么就剩这点建筑了？」「以前的无数建筑群哪去了？」
// 成因：既有天宫只有 10 处中心（全部落在 r ≤ 240），云海上因此只剩「二十来个小圆盘」；
// 外围是三层薄云板直接推到 900–1180 的空白，没有第二层城市。
// 做法：以内环 12 / 中环 24 / 外环 40 三环群岛把「都城密度」铺出来，配 12 座云桥与
// 12 座远景宫阙，天宫从「一组台地」读成「一座建在层层云海上的都城」。
// 五条纪律（沿用 W16，W18 只增补）：
//  ① 不移动任何既有建筑：只在外围加岛，落位前对既有占位圈做径向避让求解。W18 起星宿八府
//     （T-GZ-015~022）按 10 卷迁到 r≈222–236 的独立小岛，占位圈按岛径 + 净空重算；
//  ② 全部抖动用 skyJitter 坐标哈希，一次 rng 都不消耗——下游城郭/植被/幽冥序列逐值不变；
//  ③ 不新增 b.kit() id、不新增材质组；裙边只读调用 buildIslandSkirt，屋顶只读调用 roofOn；
//  ④ 色板：石材 0x7e7a8c 一带（线性 0.21，×3.2 光照 = 0.66 < 0.8）、瓦 0x333a45~0x5c6878、
//     金饰用 palace 的 GOLD_ROOF / GOLD_TRIM / GOLD_LINE 三档，glow 只做匾/幡头/脊饰点光；
//  ⑤ 面数（逐件口径）：岛 76 座（裙边 2–6k，岩锥 576 + 垂云 ≤960 + 垂藤 ≤2.2k + 云团 ≤1.5k）
//     ≈0.26M；建筑 102 座（台基/殿身/柱列 ~1k + 斗栱带 ≤0.4k + 屋顶 1.5–6.5k + 匾幡 0.2k）≈0.40M；
//     云桥 12 座（每跨 20–38 段 × 桥面+双栏板+望柱，各 ~1.6k）≈0.02M；远景 12 座（各 ≤300）≈0.003M；
//     云海 5 级（5 盘 + 178 云团 + 100 云沿 + 台脚 24 团）≈0.02M。合计 ≈0.7M。
//
// ============ W18：岛屿质量（「岛是一片褐色饼干」的四个成因逐个处置） ============
// 判词（用户原话）：「岛是扁平的褐色圆盘（像一片饼干），台面是土地色，没有石作」
//                    「建筑相对岛太小，每座岛留下大片空坪」。
//  ① 台面石作：土褐色 ground 圆盘 → 浅灰石 ash 0x86828f（线性 0.238 × 3.2 = 0.76 < 0.8），
//     压 2 圈同心石缝（2.4–2.8m 一段的切向细条，只做环不做网格），俯视读「石墁地」不读土坪；
//  ② 岛缘栏杆：望柱间距 ≈5m、柱高 1.0m（柱头出挑压顶）+ 上下两道寻杖（0.42 / 0.84 高），
//     朝环心的登岛口与瀑布口各留空（瀑布方位与 palace.islandFallAngle 同一套哈希）；
//  ③ 登岛石阶：朝环心一侧三级石阶（宽 3.2–4.8m、逐级外挑 1.05m）+ 阶下石托，
//     悬空读作「挑出的登岛口」而不是凭空断掉；
//  ④ 尺度：单座建筑占地由岛径的 24–32% 提到 62–66%（只改尺寸不改数量），亭子 w = 0.55×岛径；
//     檐高上限同步抬档（hDian 7→15m、hGe/hGuan 12m、hTing 9m），放大后不会变成矮胖饼。
//  ⑤ W18 面数增量（逐件口径）：岛 +145k（石缝 33r + 栏杆 57r + 石阶 48，Σr≈1801 减旧望柱 19k）；
//     屋顶壳随面阔线性增长 +164k（外环 40 座 +1.4k / 中环 32 座 +2.25k / 内环 30 座 +1.2k）；
//     realm 侧 15 座文档建筑与 8 座星宿府岛净 +22k（已扣旧九府/旧朝房对/旧天库武库对 80k）。
//     合计 ≈0.33M，天宫一层 0.70M → 1.03M（300 万预算的 11%）。
const H_STONE = 0x7e7a8c;    // 天宫石材（线性 0.21）
const H_STONE_L = 0x86828f;  // 受光上限：线性 0.238 × 3.2 = 0.76 < 0.8（0x8e8a98 会到 0.87）
const H_STONE_D = 0x6a6678;
const H_DECK = 0x86828f;     // W18 台面石作（与 H_STONE_L 同值：受光 0.76 < 0.8）
const H_JOINT = 0x4a4760;    // 同心石缝（比台面暗两档，只做 0.16m 细线）
const H_PAVE = 0x565264;     // 台面铺砖（与 realm.platform 同档）
const H_RED = 0xb8b2a6;      // 玉白殿身（参考图主体色；朱红只留门窗与柱头）
const H_RED_D = 0x9c968a;    // 玉白背光面
const H_BRICK = 0x8a8478;    // 暖灰砖（原青砖在玉白群殿里显得脏）
const H_WOOD = 0x6b4a2b;
const H_WOOD_D = 0x4a3220;
const H_TILE = 0x35594c;     // 青绿琉璃（压暗一档：0x46705f 在玉白群殿里糊成一片灰绿）
const H_TILE2 = 0x3f4752;
const H_TILE_L = 0x5c6878;   // 瓦灰青（上限）

type HForm = 'dian' | 'ge' | 'lou' | 'tai' | 'guan' | 'ta' | 'ting';

interface HIsle { x: number; z: number; y: number; r: number; a: number; }

/** 既有天宫占位圈（x, z, 净空半径）：三环岛落位前逐一避让，绝不压既有建筑/浮岛 */
const H_KEEP: [number, number, number][] = [
  [0, 0, 50], [0, -85, 34], [0, 95, 50], [0, 20, 20], [0, 130, 14],
  [-150, 45, 31], [-120, -20, 23], [120, 120, 23], [152, 142, 17], [40, -55, 21],
  [150, 20, 37],                                       // 瑶池水盘
  [-40, 50, 16], [40, 50, 16],                         // 东西朝房（T-GZ-008/009，18×6）
  // 星宿八府（T-GZ-015~022）：W18 起各占一座岛径 22–26m 的独立小岛（半径为岛径一半），
  // 占位按 28 留净空——再大就会把 r 220–300 内环带挤到「整条带都站不下」，逼出 r=9 的碎岛
  [-220, 80, 28], [-230, 30, 28], [-225, -20, 28], [-215, -70, 28],
  [220, 80, 28], [230, 30, 28], [225, -20, 28], [215, -70, 28],
  // beautify.ts 的三座云瀑浮岛（实占：台径 15/17/13 + 台上小亭外挑 ≈1m，不再按 22 保守留净空）
  [-268, -30, 17], [268, 50, 18], [70, -130, 15],
];

/** palace.buildIslandSkirt 的岩锥底端截断平面（低于 190/193 两层云板，锥尖不露）。 */
const SKIRT_FLOOR_Y = 184.5;
/** 每座岛的目标高径比：岩锥高 / 岛半径（机检下限 0.60，取 0.64 留余量）。 */
const SKIRT_K = 0.64;

/**
 * 环岛台面标高：把「岩锥可用高度」补足到 0.64r。
 *
 * buildIslandSkirt 把倒锥底端钳在 SKIRT_FLOOR_Y，锥高只能是 min(自然项, 台面 − 2.6 − 184.5)。
 * 台面 198–208 的低岛，r 越大被削得越狠（r=46 只剩 10.9m 岩体，k=0.24）——云面（196.65）以上
 * 只剩几米岩皮，侧视就是一块浮在云上的饼。锥底线是 palace.ts 里的常量（本轮禁改），
 * 所以在落位侧补：台面抬到「锥底 + 2.6 + 0.64r」，岩锥随岛一起长高。
 * 石座 / 台面 / 栏杆 / 建筑 / 瀑布 / 云托全部挂在 is.y 上（hIsland、hStair、hBridge、hOuterFall
 * 都读 is.y），抬一个数整座岛整体跟随，不会出现「只抬岩锥、建筑悬空」。
 *
 * 自然项 = r×(0.55 + 0.30·skyJitter(seed, 41.3))：j ≤ 0.30 的岛本来就长不到 0.64r，
 * 抬它只会让岛悬得更高而不加岩，故保持原高度（这类岛 k 落在 0.55–0.64，不是被云板削的）。
 */
function islandY(baseY: number, r: number, seed: number): number {
  if (0.55 + 0.3 * skyJitter(seed, 41.3) <= SKIRT_K) return baseY;
  return Math.max(baseY, SKIRT_FLOOR_Y + 2.6 + r * SKIRT_K);
}

/** 岩层色（= palace.ts 的 ROCK_K，裙边倒锥用的同一档灰岩） */
const KEEL_ROCK = 0x6a6a70;

/**
 * 岩锥下延（岩颈）：把裙边锥尖补到云海底。
 *
 * buildIslandSkirt 的锥高 = min(自然锥高, 台面 − 2.6 − 184.5)，自然锥高只有 0.55–0.85r。
 * 于是低岛的锥尖常常停在云海面（196.65）上下：近看是一块底部悬空的饼，而不是从云里长出来的岛。
 * 本函数沿同色岩层把锥尖再往下补到云海底（CLOUD_SEA_Y_MIN = 181.5，云层带的底面），
 * 只加岩体——台面 / 石座 / 栏杆 / 建筑 / 瀑布 / 云托全部仍挂在 is.y 上，不会脱节。
 *
 * 半径取锥尖的 0.12r（逐段微收）：下延段是「扎进云里的岩颈」，不是细尖刺，也不会把岛读成另一座山。
 * 锥高公式与 palace.ts 一致（本文件禁改那一侧），锥尖本来就在云海底以下时直接跳过。
 */
export function buildIslandKeel(b: Baker, x: number, y: number, z: number, r: number, seed: number): void {
  const rockTopY = y - 2.6;
  const hRock = Math.min(r * (0.55 + skyJitter(seed, 41.3) * 0.3), rockTopY - SKIRT_FLOOR_Y);
  const tipY = rockTopY - hRock;
  if (tipY <= CLOUD_SEA_Y_MIN + 0.5) return;
  const SEG = 4;
  const rTip = r * 0.12;
  for (let k = 0; k < SEG; k++) {
    const ya = tipY - ((tipY - CLOUD_SEA_Y_MIN) * k) / SEG;
    const yb = tipY - ((tipY - CLOUD_SEA_Y_MIN) * (k + 1)) / SEG;
    b.cyl('ash', rTip * (1 - 0.02 * k), rTip * (1 - 0.02 * (k + 1)), ya - yb, 12,
      x, (ya + yb) / 2, z, shade(KEEL_ROCK, 0.9 + k * 0.05));
  }
}

/**
 * 一环群岛落位：角度均布 + ±6° 哈希抖动，半径带内哈希取值，落位后做两级径向避让。
 * ① 对既有建筑占位圈（H_KEEP）：星宿九府在 r≈226–234（内环带内偏内）、beautify 的云瀑浮岛在
 *    r≈270（带正中），只往外推会在 r1 上撞死——故沿径向线双向扫描，净空 ≥0 的候选里取
 *    离目标半径最近者，整条带都不可行时才按最大缺口收岛径；
 * ② 对同环已落岛：40 岛 9° 步距遇上两侧各 ±6° 抖动会错位交叉（实测最近两岛重叠 13m），
 *    故已落岛作为互斥占位参与同一套求解。
 * 同参数同结果，不依赖调用顺序。
 */
function hRing(n: number, r0: number, r1: number, d0: number, d1: number, seed: number, isl = 1, avoid: HIsle[] = [], skirtSeed = 0): HIsle[] {
  const out: HIsle[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (skyJitter(i, seed) - 0.5) * (Math.PI / 15);
    const rWant = r0 + (r1 - r0) * skyJitter(i, seed + 1.7);
    // W20：外环岛径 ×1.6（反透视放大）。放大的是整座岛连同岛上的单体——若只放大建筑不放大岛，
    // 台基半宽 1.23r 会越过盘缘 0.23r 直接悬空，所以两者必须同倍。
    let rad = (d0 + (d1 - d0) * skyJitter(i, seed + 2.3)) * isl;
    const cr = Math.cos(a), sr = Math.sin(a);
    // 净空（≥0 = 站得下）：径向 R 处本岛与既有占位圈 / 同环已落岛 / 指定环（外环躲中环）的最小间隙
    const gapAt = (R: number): number => {
      let g = Infinity;
      for (const [kx, kz, kr] of H_KEEP) {
        g = Math.min(g, Math.hypot(cr * R - kx, sr * R - kz) - rad - kr - 3);
      }
      for (const p of out) {
        g = Math.min(g, Math.hypot(cr * R - p.x, sr * R - p.z) - rad - p.r - 4);
      }
      for (const p of avoid) {
        g = Math.min(g, Math.hypot(cr * R - p.x, sr * R - p.z) - rad - p.r - 8);
      }
      return g;
    };
    let rr = rWant, bestGap = gapAt(rWant);
    if (bestGap < 0) {
      let bestCost = Infinity;
      for (let R = r0; R <= r1 + 0.001; R += 0.5) {
        const g = gapAt(R);
        if (g < 0) continue;
        const cost = Math.abs(R - rWant);
        if (cost < bestCost) { bestCost = cost; rr = R; bestGap = g; }
      }
      if (bestCost === Infinity) {
        // 整条带都站不下：回到缺口最大的半径，按缺口收岛径（下限 9m）
        let worstR = rWant, worstG = gapAt(rWant);
        for (let R = r0; R <= r1 + 0.001; R += 0.5) {
          const g = gapAt(R);
          if (g > worstG) { worstG = g; worstR = R; }
        }
        rr = worstR;
        rad = Math.max(9, rad + Math.min(0, worstG));
        bestGap = gapAt(rr);
      }
    }
    void bestGap;
    out.push({ x: cr * rr, z: sr * rr, y: islandY(198 + 26 * skyJitter(i, seed + 3.1), rad, skirtSeed + i * 7), r: rad, a });
  }
  return out;
}

// ============ W18：岛面石作 / 岛缘栏杆 / 登岛石阶 ============
/** 岛面石作：浅灰石墁地（ash 0x86828f）+ 2 圈同心石缝（切向细条，只做环不做网格） */
function hDeck(b: Baker, x: number, y: number, z: number, r: number): void {
  b.cyl('ash', r * 0.962, r * 0.962, 0.16, 26, x, y + 0.08, z, H_DECK);
  for (const rr of [r * 0.42, r * 0.74]) {
    const n = Math.max(10, Math.round((Math.PI * 2 * rr) / 2.6));
    const len = ((Math.PI * 2 * rr) / n) * 1.04;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.box('ash', len, 0.03, 0.16, x + Math.cos(a) * rr, y + 0.165, z + Math.sin(a) * rr, H_JOINT, Math.PI / 2 - a);
    }
  }
}

/** 岛缘栏杆：望柱（间距 ≈5m、柱高 1.0m、柱头出挑压顶）+ 上下两道寻杖；登岛口、瀑布口与
 *  W20 长阶口留空（gateA = 白玉长阶的出挑方位，口宽按阶宽 10m 算，避免望柱从阶面上穿出来）。 */
function hRim(b: Baker, is: HIsle, seed: number, gateA?: number): void {
  const { x, y, z, r } = is;
  const rr = r * 0.952;
  const n = Math.max(10, Math.round((Math.PI * 2 * rr) / 5));
  const stairA = is.a + Math.PI;                    // 登岛口（朝环心）
  const fallA = islandFallAngle(seed);              // 瀑布口（与 palace 同一套哈希）
  const gap = Math.asin(Math.min(1, 2.4 / rr));     // 登岛口半角（口宽 ≈4.8m）
  const gapJ = Math.asin(Math.min(1, 6.4 / rr));    // 长阶口半角（口宽 ≈12.8m）
  const near = (a: number, c: number, w2: number): boolean =>
    Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) < w2;
  const cut = (a: number): boolean =>
    near(a, stairA, gap) || (r >= 17 && near(a, fallA, 0.11)) || (gateA !== undefined && near(a, gateA, gapJ));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (cut(a)) continue;
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
    b.box('ash', 0.3, 1.0, 0.3, px, y + 0.5, pz, shade(H_DECK, 1.02), -a);
    b.box('ash', 0.42, 0.12, 0.42, px, y + 1.06, pz, shade(H_DECK, 1.12), -a);
  }
  const chord = 2 * rr * Math.sin(Math.PI / n);
  for (const hy of [0.42, 0.84]) {
    for (let i = 0; i < n; i++) {
      const am = ((i + 0.5) / n) * Math.PI * 2;
      if (cut(am)) continue;
      b.box('ash', chord * 1.04, 0.1, 0.12, x + Math.cos(am) * rr, y + hy, z + Math.sin(am) * rr,
        shade(H_DECK, 0.98), Math.PI / 2 - am);
    }
  }
}

/** 登岛石阶：朝环心一侧三级石阶（宽 3.2–4.8m、逐级外挑 1.05m）+ 阶下石托 */
function hStair(b: Baker, is: HIsle, seed: number): void {
  const { x, y, z, r } = is;
  const a = is.a + Math.PI;
  const ca = Math.cos(a), sa = Math.sin(a);
  const wd = 3.2 + skyJitter(seed, 12.7) * 1.6;
  const ry = Math.PI / 2 - a;
  for (let k = 0; k < 3; k++) {
    const rad = r * 0.972 + 0.55 + k * 1.05;
    b.box('ash', wd - k * 0.3, 0.34, 1.1, x + ca * rad, y + 0.13 - 0.34 * (k + 0.5), z + sa * rad,
      shade(H_DECK, 1.02 - k * 0.05), ry);
  }
  // 石托：内缘贴石座面（0.972r）、外缘托住最外一级（2.6m 深），三级台阶不悬空
  const rad2 = r * 0.972 + 1.3;
  b.box('ash', wd * 0.56, 1.7, 2.6, x + ca * rad2, y - 1.15, z + sa * rad2, shade(H_STONE, 0.92), ry);
}

/** 台基：三叠收分石座 + 台面铺砖 + 台沿石带 + 正面三级踏道；返回台面标高 */
function hPlinth(b: Baker, x: number, y: number, z: number, w: number, d: number, hh: number, ry: number, gold: boolean): number {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  b.box('ash', w * 1.2, hh * 0.36, d * 1.2, x, y + hh * 0.18, z, shade(H_STONE, 0.9), ry);
  b.box('ash', w * 1.1, hh * 0.34, d * 1.1, x, y + hh * 0.52, z, H_STONE, ry);
  b.box('ash', w, hh * 0.3, d, x, y + hh * 0.85, z, shade(H_STONE_L, 1.02), ry);
  b.box('ground', w * 0.98, 0.12, d * 0.98, x, y + hh + 0.02, z, gold ? shade(GOLD_ROOF, 0.5) : H_PAVE, ry);
  for (let k = 0; k < 3; k++) {
    const [px, pz] = at(0, d * 0.6 + 0.9 + k * 0.95);
    b.box('wall', w * 0.34, hh * 0.34, 1.1, px, y + hh * (0.85 - k * 0.3), pz, shade(H_STONE_L, 0.96 + k * 0.04), ry);
  }
  return y + hh + 0.12;
}

/** 殿身：四面墙（正面留门洞）+ 门框门扇 + 侧墙支摘窗 */
function hBody(b: Baker, x: number, y: number, z: number, w: number, d: number, hh: number, ry: number, wallC: number, seed: number, door: boolean): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  // W18：墙厚上限 0.62 → 1.1（放大到 w≈60 的殿后，0.62m 墙会读成纸板），门洞宽上限同抬
  const t = Math.max(0.32, Math.min(1.1, w * 0.034));
  const dw = door ? Math.min(w * 0.3, 6.2) : 0;
  for (const sg of [-1, 1]) {
    const sw = (w - dw) / 2;
    if (sw > 0.08) {
      const [px, pz] = at(sg * (dw / 2 + sw / 2), d / 2);
      b.box('wall', sw, hh, t, px, y + hh / 2, pz, wallC, ry);
    }
    const [qx, qz] = at(sg * w / 2, 0);
    b.box('wall', t, hh, d, qx, y + hh / 2, qz, shade(wallC, 0.94), ry);
  }
  { const [px, pz] = at(0, -d / 2); b.box('wall', w, hh, t, px, y + hh / 2, pz, shade(wallC, 0.96), ry); }
  if (door) {
    for (const sg of [-1, 1]) {
      const [px, pz] = at(sg * dw / 2, d / 2);
      b.cyl('wood', 0.2, 0.26, hh, 8, px, y + hh / 2, pz, shade(H_RED, 1.02), ry);
    }
    const [lx2, lz2] = at(0, d / 2);
    b.box('wood', dw * 0.98, 0.34, 0.34, lx2, y + hh - 0.18, lz2, GOLD_TRIM, ry);
    const [mx2, mz2] = at(0, d / 2 - 0.18);
    b.box('ground', dw * 0.86, hh * 0.84, 0.1, mx2, y + hh * 0.42, mz2, shade(H_WOOD_D, 0.8), ry);
    for (let k = 0; k < 3; k++) {
      const [nx2, nz2] = at((k - 1) * dw * 0.26, d / 2 - 0.1);
      b.box('metal', 0.07, 0.07, 0.05, nx2, y + hh * 0.52, nz2, GOLD_TRIM, ry);
    }
  }
  // 侧墙支摘窗：每侧 2 樘（只在大殿做，避免小殿面数膨胀）
  if (w >= 12) {
    for (const sg of [-1, 1]) {
      for (const oz of [-0.28, 0.28]) {
        const [px, pz] = at(sg * w / 2, d * oz);
        b.box('ground', 0.1, hh * 0.26, d * 0.22, px, y + hh * 0.58, pz, shade(H_WOOD_D, 0.85), ry);
        b.box('wood', 0.14, 0.16, d * 0.3, px, y + hh * 0.44, pz, H_WOOD, ry);
      }
    }
  }
  void seed;
}

/** 檐下斗栱带一圈：沿矩形周圈均布 n 攒（栌斗 + 外挑华栱），带转角收头 */
function hDougong(b: Baker, x: number, y: number, z: number, w: number, d: number, ry: number, n: number, hex: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  const P = 2 * (w + d);
  const cnt = Math.max(4, Math.min(n, Math.round(P / 1.5)));
  for (let i = 0; i < cnt; i++) {
    const t = ((i + 0.5) / cnt) * P;
    let lx: number, lz: number, nx: number, nz: number, ang: number;
    if (t < w) { lx = -w / 2 + t; lz = d / 2; nx = 0; nz = 1; ang = 0; }
    else if (t < w + d) { lx = w / 2; lz = d / 2 - (t - w); nx = 1; nz = 0; ang = Math.PI / 2; }
    else if (t < 2 * w + d) { lx = w / 2 - (t - w - d); lz = -d / 2; nx = 0; nz = -1; ang = Math.PI; }
    else { lx = -w / 2; lz = -d / 2 + (t - 2 * w - d); nx = -1; nz = 0; ang = -Math.PI / 2; }
    const [px, pz] = at(lx, lz);
    b.box('wood', 0.44, 0.34, 0.44, px, y, pz, hex, ry + ang);
    const [qx, qz] = at(lx + nx * 0.36, lz + nz * 0.36);
    b.box('wood', 0.28, 0.2, 0.66, qx, y + 0.1, qz, shade(hex, 1.08), ry + ang);
  }
}

/** 圆形斗栱带（塔/亭）：沿半径均布 n 攒 */
function hDougongRound(b: Baker, x: number, y: number, z: number, r: number, n: number, hex: number, ry: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 8;
    b.box('wood', 0.34, 0.28, 0.34, x + Math.cos(a) * r, y, z + Math.sin(a) * r, hex, -a + Math.PI / 2);
    b.box('wood', 0.2, 0.16, 0.56, x + Math.cos(a) * (r + 0.3), y + 0.08, z + Math.sin(a) * (r + 0.3), shade(hex, 1.08), -a + Math.PI / 2);
  }
  void ry;
}

/** 腰檐 / 副阶：四面斜坡板 + 檐口滴水唇（比 roofOn 便宜一半：8 件 = 96 面） */
function hSkirt(b: Baker, x: number, y: number, z: number, w: number, d: number, ry: number, out: number, drop: number, hex: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  const tl = Math.atan2(drop, out);
  for (const sg of [-1, 1]) {
    const psi = sg > 0 ? ry - Math.PI / 2 : ry + Math.PI / 2;
    const [px, pz] = at(0, sg * (d / 2 + out / 2));
    b.box('roof', out * 1.06, 0.2, w + out * 2, px, y - drop / 2, pz, hex, psi, 0, -tl);
    const [ex, ez] = at(0, sg * (d / 2 + out));
    b.box('roof', 0.26, 0.3, w + out * 2, ex, y - drop - 0.06, ez, shade(hex, 0.66), psi);
  }
  for (const sg of [-1, 1]) {
    const psi = sg > 0 ? ry : ry + Math.PI;
    const [px, pz] = at(sg * (w / 2 + out / 2), 0);
    b.box('roof', out * 1.06, 0.2, d + out * 2, px, y - drop / 2, pz, hex, psi, 0, -tl);
    const [ex, ez] = at(sg * (w / 2 + out), 0);
    b.box('roof', 0.26, 0.3, d + out * 2, ex, y - drop - 0.06, ez, shade(hex, 0.66), psi);
  }
}

/** 平座栏杆：平座板 + 周圈望柱 + 四面寻杖 */
function hRail(b: Baker, x: number, y: number, z: number, w: number, d: number, ry: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  b.box('wood', w, 0.18, d, x, y, z, H_WOOD_D, ry);
  const P = 2 * (w + d);
  const n = Math.max(8, Math.round(P / 2.8));
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * P;
    let lx: number, lz: number;
    if (t < w) { lx = -w / 2 + t; lz = d / 2; }
    else if (t < w + d) { lx = w / 2; lz = d / 2 - (t - w); }
    else if (t < 2 * w + d) { lx = w / 2 - (t - w - d); lz = -d / 2; }
    else { lx = -w / 2; lz = -d / 2 + (t - 2 * w - d); }
    const [px, pz] = at(lx, lz);
    b.box('wood', 0.16, 0.92, 0.16, px, y + 0.55, pz, shade(H_RED_D, 1.06), ry);
    b.box('wood', 0.26, 0.1, 0.26, px, y + 1.05, pz, H_WOOD_D, ry);
  }
  for (const sg of [-1, 1]) {
    const [px, pz] = at(0, sg * d / 2);
    b.box('wood', w, 0.12, 0.12, px, y + 0.92, pz, H_WOOD_D, ry);
    const [qx, qz] = at(sg * w / 2, 0);
    b.box('wood', 0.12, 0.12, d, qx, y + 0.92, qz, H_WOOD_D, ry);
  }
}

/** 幡：石座 + 旗杆 + 旗面 + 飘带 + 金顶 + 幡头点光（每座建筑的「幡」项） */
function hBanner(b: Baker, x: number, y: number, z: number, sd: number, cloth: number, hh: number): void {
  b.box('ash', 0.36, 0.2, 0.36, x, y + 0.1, z, shade(H_STONE, 1.02));
  b.cyl('wood', 0.07, 0.11, hh, 5, x, y + hh / 2, z, shade(H_WOOD_D, 1.06));
  b.box('fabric', 0.86, 1.2, 0.05, x + 0.45 * sd, y + hh * 0.74, z, cloth);
  b.box('fabric', 0.28, 0.46, 0.04, x + 0.76 * sd, y + hh * 0.56, z, shade(cloth, 0.74));
  b.cyl('metal', 0.08, 0.1, 0.14, 6, x, y + hh + 0.05, z, shade(GOLD_TRIM, 1.06));
  b.box('glow', 0.11, 0.11, 0.11, x, y + hh + 0.18, z, GOLD_LINE, 0, 0, Math.PI / 4);
}

/** 匾额：木框 + 金版 + 两道光刻字线（无字碑式，靠金/青光读「匾」；不引 SignAtlas） */
function hPlaque(b: Baker, x: number, y: number, z: number, w: number, hh: number, ry: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  b.box('wood', w + 0.42, hh + 0.28, 0.2, x, y, z, H_WOOD_D, ry);
  const [gx, gz] = at(0, 0.15);
  b.box('metal', w, hh, 0.07, gx, y, gz, GOLD_TRIM, ry);
  const [sx2, sz2] = at(0, 0.21);
  b.box('glow', w * 0.72, Math.max(0.08, hh * 0.14), 0.03, sx2, y + hh * 0.16, sz2, GOLD_LINE, ry);
  b.box('glow', w * 0.46, Math.max(0.07, hh * 0.11), 0.03, sx2, y - hh * 0.18, sz2, GOLD_LINE, ry);
}

/** 前廊柱列（前后两面各 n 根），带柱础与柱头金箍。W18：柱径随檐高放粗（hh 7m→15m 时 0.24→0.51） */
function hColonnade(b: Baker, x: number, y: number, z: number, w: number, d: number, hh: number, ry: number, n: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  const k = Math.max(0.85, Math.min(hh / 7, 2.2));
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + (w * i) / (n - 1);
    for (const sg of [-1, 1]) {
      const [px, pz] = at(lx, sg * (d / 2 + 0.52));
      b.cyl('wood', 0.24 * k, 0.3 * k, hh, 7, px, y + hh / 2, pz, shade(H_RED, 1.04), ry);
      b.cyl('wood', 0.28 * k, 0.28 * k, 0.2 * k, 7, px, y + hh - 0.14 * k, pz, GOLD_TRIM, ry);
      b.cyl('wall', 0.34 * k, 0.38 * k, 0.24 * k, 7, px, y + 0.12 * k, pz, H_STONE_D, ry);
    }
  }
}

/** 殿（庑殿顶）：台基 → 殿身 → 柱列 → 额枋 → 斗栱带 → 庑殿顶 → 金脊 → 匾 + 幡 */
function hDian(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number, vh = 1): void {
  const w = s * 2.3, d = s * 1.65;
  // W18：檐高上限由 7m 抬到 15m（建筑放大到岛径 62–66% 后，7m 墙会读成「矮胖饼」）
  // W20：vh = 外环 1.6。面阔随岛径 ×1.6 之后，檐高上限若仍卡 15m，外环 40 座殿会读成「摊开的矮厅」，
  // 故上限同步抬到 24m——「高大恢弘」靠的不是把台基铺大，而是宽高同比。
  const hh = Math.max(3.4, Math.min(s * 0.92, 15.0 * vh));
  const top = hPlinth(b, x, y, z, w * 1.06, d * 1.06, Math.max(1.1, s * 0.26), ry, s > 11);
  hBody(b, x, top, z, w, d, hh, ry, H_RED, seed, true);
  hColonnade(b, x, top, z, w, d, hh, ry, w >= 16 ? 5 : 4);
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  for (const sg of [-1, 1]) {
    const [px, pz] = at(0, sg * d / 2);
    b.box('wood', w + 0.7, 0.5, 0.5, px, top + hh - 0.22, pz, GOLD_TRIM, ry);
  }
  hDougong(b, x, top + hh + 0.12, z, w + 0.55, d + 0.55, ry, 16, GOLD_TRIM);
  const rw = w + 3.2, rd = d + 3.2;
  const ry0 = top + hh + 0.34;
  roofOn(b, rw, rd, ry0, x, z, ry, H_TILE_L, s > 9.5 ? GOLD_LINE : undefined);
  b.box('metal', w * 0.6, 0.24, 0.4, x, ry0 + (Math.min(rw, rd) * 0.2 + 0.45) * 1.06 + 0.12, z, GOLD_ROOF, ry);
  const [px2, pz2] = at(0, d / 2 + 0.28);
  hPlaque(b, px2, top + hh * 0.74, pz2, Math.min(w * 0.32, 5.2), Math.max(0.9, s * 0.16), ry);
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * (w / 2 + 1.5), d / 2 + 2.4);
    hBanner(b, bx, top, bz, sg, sg > 0 ? H_RED : 0x2a4a7a, Math.max(3.6, s * 0.62));
  }
}

/** 阁（两层带腰檐）：下檐副阶 + 平座栏杆 + 上层收分 + 顶檐 */
function hGe(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number, vh = 1): void {
  const w = s * 2.15, d = s * 1.6;
  const h1 = Math.max(3.0, Math.min(s * 0.62, 12.0 * vh)), h2 = Math.max(2.4, Math.min(s * 0.44, 8.0 * vh));
  const top = hPlinth(b, x, y, z, w * 1.05, d * 1.05, Math.max(0.95, s * 0.22), ry, false);
  hBody(b, x, top, z, w, d, h1, ry, H_RED_D, seed, true);
  hColonnade(b, x, top, z, w, d, h1, ry, w >= 14 ? 5 : 4);
  hSkirt(b, x, top + h1 + 0.12, z, w, d, ry, Math.max(0.95, s * 0.2), Math.max(0.85, s * 0.19), H_TILE2);
  hRail(b, x, top + h1 + 0.3, z, w + 1.9, d + 1.8, ry);
  const w2 = w * 0.72, d2 = d * 0.72, y2 = top + h1 + 0.85;
  hBody(b, x, y2, z, w2, d2, h2, ry, H_RED, seed + 3, true);
  hDougong(b, x, y2 + h2 + 0.1, z, w2 + 0.45, d2 + 0.45, ry, 12, GOLD_TRIM);
  const rw = w2 + 2.6, rd = d2 + 2.6, ry0 = y2 + h2 + 0.3;
  roofOn(b, rw, rd, ry0, x, z, ry, H_TILE_L, s > 9.5 ? GOLD_LINE : undefined);
  b.box('metal', w2 * 0.58, 0.2, 0.34, x, ry0 + (Math.min(rw, rd) * 0.2 + 0.45) * 1.06 + 0.1, z, GOLD_ROOF, ry);
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  const [px2, pz2] = at(0, d2 / 2 + 0.24);
  hPlaque(b, px2, y2 + h2 * 0.7, pz2, Math.min(w2 * 0.36, 4.4), Math.max(0.8, s * 0.14), ry);
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * (w / 2 + 1.3), d / 2 + 2.2);
    hBanner(b, bx, top, bz, sg, sg > 0 ? 0x2a4a7a : H_RED, Math.max(3.4, s * 0.58));
  }
}

/** 楼（三层带平座）：两层腰檐 + 两道平座 + 顶檐 */
function hLou(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number): void {
  let w = s * 2.1, d = s * 1.55;
  const hips: number[] = [
    Math.max(2.6, Math.min(s * 0.5, 9.0)),
    Math.max(2.3, Math.min(s * 0.4, 7.0)),
    Math.max(2.0, Math.min(s * 0.34, 6.0)),
  ];
  const top = hPlinth(b, x, y, z, w * 1.04, d * 1.04, Math.max(0.85, s * 0.2), ry, false);
  let yy = top;
  for (let f = 0; f < 3; f++) {
    hBody(b, x, yy, z, w, d, hips[f], ry, f === 1 ? H_BRICK : H_RED, seed + f * 5, f === 0);
    if (f === 0) hColonnade(b, x, yy, z, w, d, hips[f], ry, 4);
    yy += hips[f];
    if (f < 2) {
      hSkirt(b, x, yy + 0.1, z, w, d, ry, Math.max(0.8, s * 0.17), Math.max(0.7, s * 0.16), H_TILE2);
      hRail(b, x, yy + 0.26, z, w + 1.6, d + 1.5, ry);
      w *= 0.8; d *= 0.8; yy += 0.72;
    }
  }
  hDougong(b, x, yy + 0.1, z, w + 0.4, d + 0.4, ry, 12, GOLD_TRIM);
  const rw = w + 2.4, rd = d + 2.4, ry0 = yy + 0.3;
  roofOn(b, rw, rd, ry0, x, z, ry, H_TILE_L, s > 10 ? GOLD_LINE : undefined);
  b.box('metal', w * 0.56, 0.2, 0.32, x, ry0 + (Math.min(rw, rd) * 0.2 + 0.45) * 1.06 + 0.1, z, GOLD_ROOF, ry);
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  const [px2, pz2] = at(0, s * 0.78 + 0.22);
  hPlaque(b, px2, top + s * 0.7, pz2, Math.max(1.4, s * 0.5), Math.max(0.75, s * 0.13), ry);
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * (s * 1.25 + 1.2), s * 0.95 + 1.9);
    hBanner(b, bx, top, bz, sg, sg > 0 ? H_RED : 0x2a4a7a, Math.max(3.2, s * 0.55));
  }
}

/** 台（无墙，只有柱 + 顶）：三层石台 + 周圈栏板 + 柱网 + 梁枋 + 斗栱 + 大顶 + 香火 */
function hTai(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number): void {
  const w = s * 2.2, d = s * 1.6;
  const hh = Math.max(3.2, Math.min(s * 0.78, 12.0));
  const top = hPlinth(b, x, y, z, w * 1.14, d * 1.14, Math.max(1.4, s * 0.34), ry, true);
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  // 周圈栏板（台缘一圈矮石栏）
  const P = 2 * (w * 1.14 + d * 1.14);
  const nr = Math.max(10, Math.round(P / 3.4));
  for (let i = 0; i < nr; i++) {
    const t = ((i + 0.5) / nr) * P;
    const hw = w * 0.57, hd = d * 0.57;
    let lx: number, lz: number;
    if (t < hw * 2) { lx = -hw + t; lz = hd; }
    else if (t < hw * 2 + hd * 2) { lx = hw; lz = hd - (t - hw * 2); }
    else if (t < hw * 4 + hd * 2) { lx = hw - (t - hw * 2 - hd * 2); lz = -hd; }
    else { lx = -hw; lz = -hd + (t - hw * 4 - hd * 2); }
    const [px, pz] = at(lx, lz);
    b.box('wall', 0.26, 0.92, 0.26, px, top + 0.34, pz, shade(H_STONE_L, 1.04), ry);
  }
  // 柱网 2×3 + 梁枋
  for (let ix = 0; ix < 3; ix++) {
    for (const sg of [-1, 1]) {
      const [px, pz] = at(-w / 2 + (w * ix) / 2, sg * d / 2);
      b.cyl('wood', 0.3, 0.36, hh, 8, px, top + hh / 2, pz, shade(H_RED, 1.05), ry);
      b.cyl('wood', 0.34, 0.34, 0.24, 8, px, top + hh - 0.16, pz, GOLD_TRIM, ry);
      b.cyl('wall', 0.42, 0.46, 0.28, 8, px, top + 0.14, pz, H_STONE_D, ry);
    }
  }
  for (const sg of [-1, 1]) {
    const [px, pz] = at(0, sg * d / 2);
    b.box('wood', w + 1.0, 0.52, 0.6, px, top + hh - 0.06, pz, GOLD_TRIM, ry);
    const [qx, qz] = at(sg * w / 2, 0);
    b.box('wood', 0.6, 0.46, d + 1.0, qx, top + hh - 0.06, qz, GOLD_TRIM, ry);
  }
  hDougong(b, x, top + hh + 0.24, z, w + 1.2, d + 1.2, ry, 14, GOLD_TRIM);
  const ry0 = top + hh + 0.46;
  roofOn(b, w + 4.0, d + 4.0, ry0, x, z, ry, H_TILE2);
  b.box('metal', w * 0.7, 0.26, 0.42, x, ry0 + (Math.min(w + 4, d + 4) * 0.2 + 0.45) * 1.06 + 0.14, z, GOLD_ROOF, ry);
  // 香炉（香火点光，小面积）
  const [cx2, cz2] = at(0, d / 2 + 2.6);
  b.cyl('metal', 0.6, 0.5, 1.0, 10, cx2, top + 0.5, cz2, shade(GOLD_TRIM, 1.04), ry);
  b.cyl('glow', 0.3, 0.2, 0.4, 6, cx2, top + 1.16, cz2, GOLD_LINE);
  const [px2, pz2] = at(0, d / 2 + 0.26);
  hPlaque(b, px2, top + hh * 0.7, pz2, Math.min(w * 0.3, 4.6), Math.max(0.85, s * 0.15), ry);
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * (w / 2 + 1.4), d / 2 + 2.4);
    hBanner(b, bx, top, bz, sg, sg > 0 ? 0x2a4a7a : H_RED, Math.max(3.6, s * 0.6));
  }
  void seed;
}

/** 观（重檐歇山）：下檐副阶 + 上层收分 + 歇山顶 + 山花 + 博风板 */
function hGuan(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number, vh = 1): void {
  const w = s * 2.25, d = s * 1.68;
  const hh = Math.max(3.2, Math.min(s * 0.72, 12.0 * vh)), h2 = Math.max(2.0, Math.min(s * 0.4, 6.5 * vh));
  const top = hPlinth(b, x, y, z, w * 1.05, d * 1.05, Math.max(1.0, s * 0.24), ry, false);
  hBody(b, x, top, z, w, d, hh, ry, shade(H_RED_D, 1.02), seed, true);
  hColonnade(b, x, top, z, w, d, hh, ry, 4);
  hSkirt(b, x, top + hh + 0.1, z, w, d, ry, Math.max(1.1, s * 0.24), Math.max(0.9, s * 0.2), H_TILE2);
  hDougong(b, x, top + hh * 0.86, z, w + 0.6, d + 0.6, ry, 14, GOLD_TRIM);
  const w2 = w * 0.66, d2 = d * 0.66, y2 = top + hh + 0.55;
  hBody(b, x, y2, z, w2, d2, h2, ry, H_RED, seed + 2, false);
  const rw = w2 + 2.8, rd = d2 + 2.8, ry0 = y2 + h2 + 0.2;
  roofOn(b, rw, rd, ry0, x, z, ry, H_TILE_L, s > 9.5 ? GOLD_LINE : undefined);
  // 山花：两端山面的三角填充（三级梯级）+ 博风板
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  const rh = Math.min(rw, rd) * 0.2 + 0.45;
  for (const sg of [-1, 1]) {
    for (const [f, k] of [[0.26, 0.78], [0.52, 0.52], [0.76, 0.26]] as const) {
      const [px, pz] = at(sg * (rw * 0.5 - 0.2), 0);
      b.box('wood', 0.2, rh * 0.3, rd * k, px, ry0 + rh * f, pz, shade(H_WOOD_D, 1.1), ry);
    }
    const [bx, bz] = at(sg * (rw * 0.5 - 0.1), 0);
    b.box('wood', 0.28, rh * 0.9, 0.4, bx, ry0 + rh * 0.45, bz, GOLD_TRIM, ry, 0, sg * 0.5);
  }
  b.box('metal', w2 * 0.6, 0.22, 0.36, x, ry0 + rh * 1.06 + 0.12, z, GOLD_ROOF, ry);
  const [px2, pz2] = at(0, d / 2 + 0.26);
  hPlaque(b, px2, top + hh * 0.72, pz2, Math.min(w * 0.3, 4.8), Math.max(0.85, s * 0.15), ry);
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * (w / 2 + 1.4), d / 2 + 2.3);
    hBanner(b, bx, top, bz, sg, sg > 0 ? 0xb08a3c : 0x2a4a7a, Math.max(3.4, s * 0.58));
  }
}

/** 塔（3–7 层密檐）：八角石座 + 逐层收分塔身 + 密檐 + 檐角起翘 + 每层斗栱 + 塔刹 */
function hTa(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number): void {
  const floors = 3 + Math.floor(skyJitter(seed, 5.5) * 5);
  const baseR = s * 0.62;
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  // 八角石座（两级）
  b.cyl('wall', baseR * 1.5, baseR * 1.62, 1.3, 8, x, y + 0.65, z, H_STONE, ry);
  b.cyl('wall', baseR * 1.34, baseR * 1.46, 0.9, 8, x, y + 1.75, z, shade(H_STONE_L, 1.02), ry);
  b.cyl('ground', baseR * 1.36, baseR * 1.36, 0.12, 8, x, y + 2.22, z, H_PAVE, ry);
  let yy = y + 2.28, rr = baseR * 1.3;
  const h0 = Math.max(1.9, s * 0.44);
  for (let f = 0; f < floors; f++) {
    const hh = h0 * (1 - f * 0.075);
    b.cyl('wall', rr, rr * 1.03, hh, 8, x, yy + hh / 2, z, f % 2 ? H_BRICK : H_RED, ry);
    // 密檐：两叠出檐 + 檐口滴水唇
    b.cyl('roof', rr * 1.42, rr * 1.62, 0.34, 8, x, yy + hh + 0.16, z, shade(H_TILE_L, 0.94), ry);
    b.cyl('roof', rr * 1.38, rr * 1.42, 0.26, 8, x, yy + hh + 0.44, z, shade(H_TILE_L, 1.04), ry);
    b.cyl('roof', rr * 0.96, rr * 1.42, 0.2, 8, x, yy + hh + 0.66, z, H_TILE, ry);
    // 八角檐角起翘
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      b.box('roof', 0.46, 0.18, 0.46, x + Math.cos(a) * rr * 1.56, yy + hh + 0.42, z + Math.sin(a) * rr * 1.56, shade(H_TILE_L, 1.1), -a, 0, 0.34);
    }
    // 每层斗栱带（8 攒，压在檐下）
    hDougongRound(b, x, yy + hh - 0.12, z, rr * 1.06, 8, GOLD_TRIM, ry);
    yy += hh + 0.72;
    rr *= 0.9;
  }
  // 塔刹：覆钵 + 相轮三重 + 宝珠
  b.cyl('metal', rr * 1.5, rr * 1.9, 0.44, 8, x, yy + 0.12, z, shade(GOLD_TRIM, 1.06), ry);
  b.cyl('metal', rr * 0.7, rr * 0.95, 0.4, 8, x, yy + 0.5, z, GOLD_TRIM, ry);
  b.cyl('metal', 0.14, 0.2, Math.max(1.6, s * 0.42), 6, x, yy + 0.7 + Math.max(0.8, s * 0.21), z, GOLD_ROOF, ry);
  for (let k = 0; k < 3; k++) {
    b.cyl('metal', 0.42 - k * 0.08, 0.46 - k * 0.08, 0.08, 8, x, yy + 1.0 + k * 0.3, z, GOLD_LINE, ry);
  }
  b.box('glow', 0.24, 0.24, 0.24, x, yy + 0.82 + Math.max(1.6, s * 0.42), z, GOLD_LINE, 0, 0, Math.PI / 4);
  // 幡（塔基一侧）
  const [bx, bz] = at(baseR * 2.0, 0);
  hBanner(b, bx, y, bz, 1, H_RED, Math.max(3.4, s * 0.6));
}

/** 亭（四角攒尖）：小台基 + 四柱 + 额枋 + 斗栱 + 攒尖顶 + 宝顶 + 幡 */
function hTing(b: Baker, x: number, y: number, z: number, s: number, ry: number, seed: number, vh = 1): void {
  const w = s * 1.75;
  // W18：亭子直径放到岛径的 0.55（单亭岛 s = 0.63r → w = 1.1r），檐高与攒尖高同步抬档
  const hh = Math.max(2.8, Math.min(s * 0.62, 9.0 * vh));
  const top = hPlinth(b, x, y, z, w * 1.1, w * 1.1, Math.max(0.7, s * 0.18), ry, false);
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  for (const sx2 of [-1, 1]) {
    for (const sz2 of [-1, 1]) {
      const [px, pz] = at(sx2 * w * 0.42, sz2 * w * 0.42);
      b.cyl('wood', 0.2, 0.26, hh, 7, px, top + hh / 2, pz, shade(H_RED, 1.04), ry);
      b.cyl('wall', 0.3, 0.34, 0.22, 7, px, top + 0.11, pz, H_STONE_D, ry);
    }
  }
  for (const sg of [-1, 1]) {
    const [px, pz] = at(0, sg * w * 0.42);
    b.box('wood', w * 0.92, 0.3, 0.26, px, top + hh - 0.12, pz, GOLD_TRIM, ry);
    const [qx, qz] = at(sg * w * 0.42, 0);
    b.box('wood', 0.26, 0.3, w * 0.92, qx, top + hh - 0.12, qz, GOLD_TRIM, ry);
  }
  hDougong(b, x, top + hh + 0.18, z, w * 0.94, w * 0.94, ry, 8, GOLD_TRIM);
  const rh = Math.max(1.8, Math.min(s * 0.44, 6.0));
  b.pyramid('roof', 0.06, w * 0.74, x, top + hh + 0.34 + rh / 2, z, H_TILE_L, ry, 1, rh, 1);
  // 四条垂脊（攒尖的辨识度）
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const [px, pz] = at(Math.cos(a) * w * 0.4, Math.sin(a) * w * 0.4);
    b.box('roof', 0.2, rh * 0.55, 0.2, px, top + hh + 0.34 + rh * 0.5, pz, shade(H_TILE_L, 0.72), ry, 0, 0);
  }
  b.cyl('metal', 0.16, 0.26, 0.5, 8, x, top + hh + 0.34 + rh + 0.2, z, GOLD_ROOF, ry);
  b.box('glow', 0.16, 0.16, 0.16, x, top + hh + 0.34 + rh + 0.5, z, GOLD_LINE, 0, 0, Math.PI / 4);
  const [px2, pz2] = at(0, w * 0.42 + 0.3);
  hPlaque(b, px2, top + hh * 0.78, pz2, Math.max(1.3, w * 0.52), Math.max(0.7, s * 0.13), ry);
  const [bx, bz] = at(-w * 0.72, w * 0.5);
  hBanner(b, bx, top, bz, -1, H_RED, Math.max(3.0, s * 0.5));
  void seed;
}

/** 形制分派（vh = 檐高/脊高上限倍率，W20 外环 1.6 用；其余环保持 1） */
function hForm(b: Baker, kind: HForm, x: number, y: number, z: number, s: number, ry: number, seed: number, vh = 1): void {
  if (kind === 'dian') hDian(b, x, y, z, s, ry, seed, vh);
  else if (kind === 'ge') hGe(b, x, y, z, s, ry, seed, vh);
  else if (kind === 'lou') hLou(b, x, y, z, s, ry, seed);
  else if (kind === 'tai') hTai(b, x, y, z, s, ry, seed);
  else if (kind === 'guan') hGuan(b, x, y, z, s, ry, seed, vh);
  else if (kind === 'ta') hTa(b, x, y, z, s, ry, seed);
  else hTing(b, x, y, z, s, ry, seed, vh);
}

/** 建筑落位（按岛上的座数取布局，系数 × 岛半径）：[局部径向 x, 局部切向 z, 尺寸系数]
 *  多座时沿切向铺开（同一径向上前后叠会互相遮住正面），主殿压在岛心偏外一侧。
 *  W18：单座 0.32 → 0.56（hDian w=2.3s ⇒ 占地 = 1.29r ≈ 岛径的 64%；亭子另取 0.63 ⇒ 0.55 岛径）；
 *  两座 0.25/0.24 → 0.29/0.29（各占岛径 33%、合占 ≈ 67%，切向间距 0.68r > 单座面阔 0.667r，不互咬）；
 *  三座主殿 0.29 → 0.38、配殿 0.195 → 0.265（配殿与主殿径向留 0.01r 缝，读作厢房贴主殿）。 */
const H_LAY: [number, number, number][][] = [
  [[0, 0, 0.56]],
  [[0.09, -0.34, 0.29], [-0.09, 0.34, 0.29]],
  [[0.25, 0, 0.38], [-0.29, -0.33, 0.265], [-0.29, 0.33, 0.265]],
];

/** 一座岛：石作台面 + 岛缘栏杆 + 登岛石阶 + 石座 + 裙边 + 建筑
 *  gateA：W20 白玉长阶的出挑方位（只有宿主岛传，岛缘栏杆在此留口） */
function hIsland(b: Baker, is: HIsle, seed: number, kinds: HForm[], vh = 1, gateA?: number): void {
  const { x, y, z, r } = is;
  // 石座：三级收分（岩体倒锥在它外侧，见 buildIslandSkirt）
  b.cyl('ash', r * 0.975, r * 0.93, 2.6, 22, x, y - 1.3, z, H_STONE);
  b.cyl('ash', r * 0.93, r * 0.88, 1.9, 22, x, y - 3.55, z, shade(H_STONE, 0.88));
  // 台面：浅灰石墁地 + 两圈同心石缝（W18 之前是土褐色 ground 圆盘）
  hDeck(b, x, y, z, r);
  // 台沿石压面
  b.cyl('ash', r * 1.0, r * 1.0, 0.26, 24, x, y - 0.04, z, shade(H_STONE_L, 1.04));
  // 岛缘栏杆（望柱 1.0m + 两道寻杖）与登岛石阶（朝环心三级）
  hRim(b, is, seed, gateA);
  hStair(b, is, seed);
  // 裙边只读复用 palace.ts 的岩体倒锥 + 垂云 + 瀑布 + 垂藤 + 云团簇
  buildIslandSkirt(b, x, y, z, r, seed);
  buildIslandKeel(b, x, y, z, r, seed);
  // 建筑（朝向环心，加 ±0.09 rad 抖动）
  const lay = H_LAY[Math.min(kinds.length, 3) - 1];
  const face = (Math.PI * 3) / 2 - is.a + (skyJitter(seed, 9.1) - 0.5) * 0.18;
  for (let k = 0; k < kinds.length; k++) {
    const [lx, lz] = lay[k];
    const sf = kinds.length === 1 && kinds[0] === 'ting' ? 0.63 : lay[k][2];
    const cr = Math.cos(is.a), sr = Math.sin(is.a);
    const bx = x + (lx * cr - lz * sr) * r;
    const bz = z + (lx * sr + lz * cr) * r;
    // 上限 15.6 → 26：内环 r 46 的单殿可以长到 w≈60m（放大的屋顶壳同步抬档，见交付报告）；
    // 塔按 22 收口（塔基是八边形、占地本就不按面阔算，再放大只会得到一根细高杆）
    const cap = (kinds[k] === 'ta' ? 22 : 26) * vh;
    const s2 = Math.max(4.0, Math.min(r * sf, cap));
    hForm(b, kinds[k], bx, y + 0.16, bz, s2, face + (skyJitter(seed + k, 11.3) - 0.5) * 0.14, seed + k * 13, vh);
  }
}

/** 云桥：桥面宽 4.6–5.8、长 = 两岛间距，两侧望柱 + 栏板 + 寻杖，桥下 2–3 云墩 */
function hBridge(b: Baker, A: HIsle, B: HIsle, seed: number): void {
  const dx = B.x - A.x, dz = B.z - A.z;
  const dl = Math.hypot(dx, dz);
  if (dl < A.r + B.r + 6) return;
  const ux = dx / dl, uz = dz / dl;
  const ax = A.x + ux * A.r * 0.82, az = A.z + uz * A.r * 0.82;
  const bx = B.x - ux * B.r * 0.82, bz = B.z - uz * B.r * 0.82;
  const span = Math.hypot(bx - ax, bz - az);
  if (span < 16) return;
  const y0 = A.y + 0.14, y1 = B.y + 0.14;
  const wd = 4.6 + skyJitter(seed, 3.3) * 1.2;
  const arch = Math.min(4.4, span * 0.028);
  const ry = Math.atan2(-(bz - az), bx - ax);
  const at = (t: number): [number, number, number] => [
    ax + (bx - ax) * t,
    y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * arch,
    az + (bz - az) * t,
  ];
  const segs = Math.max(5, Math.round(span / 6));
  for (let i = 0; i < segs; i++) {
    const [x0, ya, z0] = at(i / segs), [x1, yb2, z1] = at((i + 1) / segs);
    const sl = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (ya + yb2) / 2;
    const tilt = Math.atan2(yb2 - ya, sl);
    b.box('ash', sl * 1.04, 0.46, wd, mx, my, mz, shade(H_STONE_L, 1.0 - (i % 3) * 0.02), ry, 0, tilt);
    for (const sg of [-1, 1]) {
      const ox = Math.sin(ry) * sg * (wd / 2 - 0.2), oz = Math.cos(ry) * sg * (wd / 2 - 0.2);
      b.box('ash', sl * 1.04, 0.52, 0.16, mx + ox, my + 0.5, mz + oz, shade(H_STONE, 0.97), ry, 0, tilt);
    }
    if (i % 2 === 0) {
      for (const sg of [-1, 1]) {
        const ox = Math.sin(ry) * sg * (wd / 2 - 0.2), oz = Math.cos(ry) * sg * (wd / 2 - 0.2);
        b.box('ash', 0.3, 1.12, 0.3, mx + ox, my + 0.56, mz + oz, shade(H_STONE_L, 1.05), ry, 0, tilt);
        b.box('ash', 0.4, 0.12, 0.4, mx + ox, my + 1.16, mz + oz, shade(H_STONE_L, 1.1), ry);
      }
    }
  }
  // 桥下云墩 2–3 座
  const piers = 2 + (skyJitter(seed, 5.7) > 0.5 ? 1 : 0);
  for (let k = 0; k < piers; k++) {
    const t = 0.28 + k * (0.44 / Math.max(1, piers - 1));
    const [px, py, pz] = at(t);
    b.box('ash', wd * 0.66, 0.5, 2.0, px, py - 0.5, pz, shade(H_STONE, 0.9), ry);
    b.cyl('fabric', 2.6, 3.6, 5.2, 9, px, py - 3.3, pz, shade(CS_BASE, 0.98), ry);
    b.cyl('fabric', 1.9, 2.9, 4.6, 8, px, py - 7.6, pz, CS_DEEP);
  }
}

/** 远景宫阙（W20 反透视核心）：体块 ×3.0 + 大屋顶 + 金脊 + 3–4 层叠檐。
 *  参考原文原话：「正常透视里，远处的东西应该变小。但天上宫阙会故意把远处的宫殿、山体和
 *  天门做得特别巨大」——12 座远景宫阙（r 700–900）整体 ×3.0，画面上与内环近处的殿同高
 *  甚至更高；「远也大」靠这一条撑起来，不是靠加数量。
 *  层叠飞檐用 roofOn 小尺寸叠（面阔 ≤32m，正好落在 roofC 的免瓦垄档，单层 ≈1.1k 面），
 *  一座宫阙读成「巨台 + 三重檐塔冠」，在 800m 处仍是可辨的天际线。 */
// 远景宫阙放大倍率：3.0 时 100m 的体块比中央凌霄殿还大，主次颠倒 —— 远处反而抢了主体。
// 收到 1.6，让「中央殿群 > 内环 > 中环 > 外环 > 远景」形成正确的视觉等级。
const FAR_K = 1.6;
function hFarPalace(b: Baker, i: number): void {
  const a = (i / 12) * Math.PI * 2 + (skyJitter(i, 71.3) - 0.5) * 0.14;
  const rr = 700 + skyJitter(i, 72.7) * 200;
  const y = 200 + skyJitter(i, 73.9) * 26;
  const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
  const sc = (0.8 + skyJitter(i, 75.1) * 0.6) * FAR_K;
  const w = 26 * sc, d = 17 * sc, bh = 11 * sc;
  // 云座：底径按 0.46w 收口（旧口径 46*sc 在三倍体块下会到 190m，云柱会把外环岛群整段吞掉）
  {
    const y0 = 191.6, y1 = y - 1.2;
    const hUp = (y1 - y0) * 0.56, hDn = (y1 - y0) * 0.44;
    b.cyl('fabric', w * 0.38, w * 0.46, hUp, 11, x, y1 - hUp / 2, z, shade(CS_BASE, 0.98), a);
    b.cyl('fabric', w * 0.46, w * 0.56, hDn, 11, x, y0 + hDn / 2, z, CS_DEEP, a);
  }
  // 台基 + 殿身（×3 体块）
  b.box('ash', w * 1.16, 3.2 * sc, d * 1.16, x, y + 1.6 * sc, z, shade(H_STONE, 0.9), a);
  b.box('wall', w, bh, d, x, y + 3.2 * sc + bh / 2, z, i % 3 === 0 ? H_BRICK : shade(H_RED_D, 1.0), a);
  const ryTop = y + 3.2 * sc + bh;
  // 大屋顶：roofOn 实做（800m 外瓦垄看不见，但飞近宫阙上空时这是唯一的细节来源）
  // 远景宫阙在 r 700–900（×3 后体宽 100m+）：旧调用走 roofOn，w>30 会烘 0.34m 瓦垄 =>
  // 单顶 682 列 × 6 环 × 2 侧 ≈ 4.9 万顶点，50 座屋顶把世界生成拖到 4 分钟以上（实测启动超 240s 不返回）。
  // 900m 外本来就看不见瓦垄，改走 roofC 的 rib=false（同一曲面、不做条纹），单顶降到 1182 顶点。
  b.pyramid('roof', 0.06, 1, x, ryTop, z, H_TILE_L, a, w * 0.53, Math.min(w * 1.06, d * 1.34) * 0.3, d * 0.67);
  const rh0 = Math.min(w * 1.06, d * 1.34) * 0.2 + 0.45;
  b.box('metal', w * 0.9, 0.5 * FAR_K, 0.7 * FAR_K, x, ryTop + rh0 * 1.02 + 0.2, z, GOLD_ROOF, a);
  // 层叠飞檐：3–4 层，面阔 32 → 23 → 17 → 12
  let ty = ryTop + rh0 + 0.9;
  const tiers = 3 + (skyJitter(i, 76.3) > 0.5 ? 1 : 0);
  let tw = Math.min(w * 0.46, 32), td = Math.min(d * 0.52, 24);
  for (let t2 = 0; t2 < tiers; t2++) {
    const th = bh * 0.3;
    b.box('wall', tw * 0.74, th, td * 0.74, x, ty + th / 2, z, t2 % 2 ? H_BRICK : shade(H_RED_D, 1.02), a);
    b.pyramid('roof', 0.06, 1, x, ty + th, z, H_TILE_L, a, tw * 0.5, Math.min(tw, td) * 0.3, td * 0.5);
    b.box('metal', tw * 0.62, 0.34, 0.44, x, ty + th + Math.min(tw, td) * 0.2 + 0.6, z, GOLD_ROOF, a);
    ty += th + Math.min(tw, td) * 0.2 + 0.95;
    tw *= 0.72; td *= 0.72;
  }
  // 双幡 + 脊饰点光（点状，12 座共 12 枚）
  const cr = Math.cos(a), sr = Math.sin(a);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * (w / 2 + 1.4 * sc), d / 2 + 1.6 * sc);
    b.cyl('wood', 0.16 * FAR_K, 0.22 * FAR_K, 7.6 * sc, 5, bx, y + 3.8 * sc, bz, H_WOOD_D, a);
    b.box('fabric', 1.5 * sc, 3.0 * sc, 0.1, bx + 0.8 * sc, y + 5.6 * sc, bz, sg > 0 ? H_RED : 0x2a4a7a, a);
  }
  b.box('glow', 0.5, 0.5, 0.5, x, ty + 0.6, z, GOLD_LINE, a, 0, Math.PI / 4);
}

// ============ W20：天宫「巨物感 + 仙气」 ============
// 判词（用户原话）：「高大瑰丽神奇、仙风十足、云雾缭绕」「精致、仙境、高大恢弘又仙气十足、
// 雕梁画柱还精致华贵华丽」，参照 500 万赞天宫短片与「栖光」的中式天宫 AI 短片。原文提炼出
// 的可执行画面语言，本段逐条落地（不凭想象加元素）：
//  ① 近处大、远处也大——原文：「正常透视里，远处的东西应该变小。但天上宫阙会故意把远处的
//    宫殿、山体和天门做得特别巨大」。外环 40 岛连岛带建筑线性 ×1.6（岛径与单体必须同倍，
//    否则台基半宽 1.23r 会越过盘缘悬空），远景宫阙 12 座整体 ×3.0；
//  ② 母题：白玉长阶 / 云海天门 / 悬空宫殿 / 云桥仙台 / 天宫茶席——本段取前三 + 圆形仙门；
//  ③ 元素：汉白玉登天石阶、层叠飞檐、白色瀑布坠入云层、狭窄悬空长廊横跨画面、巨大圆形仙门 +
//    满月、千年苍松前景、雕花木栏、白色台基 + 红金建筑、白玉柱的重复节奏、前景石狮、宫墙浮雕；
//  ④ 配色：汉白玉偏暖白 / 朱红柱 / 鎏金瓦 / 青绿彩画，天空淡蓝灰、晨光柔和暖金；
//  ⑤ 比例：人物极小、建筑巨大——长阶宽 10m（≈6 人并排）、匾额 10m、月盘 55m、门楼 60m。
// 纪律：一次共享 rng 都不取（全部 skyJitter 坐标哈希，下游城郭/植被/幽冥序列逐值不变）；
// 不新增 b.kit() id、不新增材质组；glow 只做点状小面积（环上 10 枚 0.5m、廊下 8 盏 0.4m、
// 门楼 8 枚 0.35m），绝不拿 glow 去铺檐口连续灯带——那是前两轮「过曝反光」的根因。
// 白玉长阶的压顶/望柱头原先取 0xc6c0b1（线性 0.56）：在天宫档主光（2.1，低角度侧光）下
// 线性亮度 ≈1.12，越过 UnrealBloomPass 阈值 1.05 —— 150m 长的两条压顶因此沿长度方向拉出
// 两道刺眼白色长条（y=1200 俯视实测：全分辨率 x[528,730] y[440,536] 两条平行光带）。
// 压到 0xa8a294（线性 0.36）后受光 ≈0.72，仍在阈值下，玉白质感保留。
const W_JADE = 0x9d9689;      // 汉白玉（132 级踏步拼成 150m 斜面，过亮就是「漏光板」）
const W_JADE_HI = 0x99937f;   // 望柱头 / 压顶（原 0xc6c0b1 受光 1.12 → 越过 bloom 阈值）
const W_JADE_D = 0x767065;    // 阶竖板 / 檐下阴面
const W_JADE_DD = 0x615d50;   // 阶底石托（暗三档，仰视才读得出厚度）
const W_TILE_C = 0x5c6878;    // 青瓦（受光上限档）
const W_TILE_D = 0x46505c;
const W_RED_C = 0xa63a2b;     // 朱柱（任务指定）
const W_RED_DD = 0x8a2f24;
const W_WALL_R = 0x93372a;    // 宫墙（面积比柱大，再压一档）
const W_FLOOR_R = 0x6b3a22;   // 红木地板
// 月盘：用户报的「刺眼白色长条」就是它 —— 55m 直径 × 1.8m 厚的暖白圆盘竖立在环心，
// 正上方俯视时只剩一条 55m 长的边，线性亮度 0.68×1.6≈1.1 越过 bloom 阈值 1.05，
// 于是整条边被 bloom 拉成一道白光（隐藏 city_fabric 后该条消失；射线取证命中点
// (-475,267,693)、法线水平、顶点色 #d8ceb8，正是这两片 cyl）。
// 压到 0xa9a291（线性 0.40，受光 ≈0.65）并减薄，月盘仍在，但不再漏光。
const W_MOON = 0x7b849f;      // 月盘冷银（原 0xd8ceb8 受光 1.1 越 bloom 阈值）
const W_CLOUD_Y = 196.65;     // 云海顶面（palace.ts 的 CLOUD_TOP 未导出，同值复刻）

/** B1 白玉长阶：汉白玉踏步 132 级 / 长 150m / 宽 10m，两侧栏板 + 望柱 + 双寻杖，末端没入云海。
 *  宿主岛 = 内环第 5 座（-124, 198，y 213，r 39）；方向 129°（朝外偏 +z）。选向不是按「最高岛」
 *  取的：内环 12 座里朝外 150m 的净空最宽的一条是这座岛 129° 方向（最近的中环岛留 26m），
 *  其余方向会被中环/外环岛压到 10m 以内。坐标由布局直接算出，不写死。 */
const W_STAIR = { dir: 129, len: 150, wid: 10, steps: 132 };

interface WStairGeom { x0: number; z0: number; x1: number; z1: number; dx: number; dz: number; y0: number; y1: number; }

function hJadeStair(b: Baker, is: HIsle): WStairGeom {
  const ang = (W_STAIR.dir * Math.PI) / 180;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const { len, wid, steps } = W_STAIR;
  const x0 = is.x + dx * is.r * 0.94, z0 = is.z + dz * is.r * 0.94;
  const y0 = is.y + 0.16;
  const x1 = x0 + dx * len, z1 = z0 + dz * len;
  const y1 = W_CLOUD_Y - 1.5;                     // 末端沉到云面下 1.5m：最后十来级没入云海
  const ry = Math.atan2(-dz, dx);
  const drop = y0 - y1, tread = len / steps, rise = drop / steps;
  const tilt = Math.atan2(-drop, len);
  const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2, midY = (y0 + y1) / 2;
  const px = -dz, pz = dx;                        // 行进方向的左法线
  // ① 踏步：单块厚 = 2.6 倍踢面，上下互叠，踏面不漏缝
  const hStep = Math.max(0.34, rise * 2.6);
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps;
    const cx = x0 + dx * len * t, cz = z0 + dz * len * t;
    const top = y0 - rise * (k + 1);
    // 明暗节律：3 亮 3 暗（原先只有 0.018 的微差）。150m 长阶在 1km 外俯视时踏步本身已亚像素，
    // 一条均匀亮面会被读成"漏光的板子"；按 6 级一组的明暗节奏把整条斜面拆成可读的踏步带。
    b.box('ash', wid, hStep, tread * 1.02, cx, top - hStep / 2, cz, shade(W_JADE, k % 6 < 3 ? 1 : 0.82), ry);
    // 踏面前缘暗线：远看是「级」的节奏，近看是石棱（0.07m 高，不抢面）
    b.box('ash', wid, 0.07, 0.14, cx + dx * tread * 0.5, top + 0.015, cz + dz * tread * 0.5, W_JADE_D, ry);
  }
  // ② 阶底石托：整块斜面。仰视时阶下不能是空的（悬空长阶一旦露底就破功）
  b.box('ash', wid * 0.94, 1.1, len * 1.004, midX, midY - 0.74, midZ, W_JADE_DD, ry, 0, tilt);
  // ③ 栏板（两侧）+ 压顶：板底压到踏面下 0.05m，斜向随坡。
  // **必须分段**：150m 一整条的压顶/寻杖在掠射视角下是一条镜面高光带（天空 env + 低角度主光），
  // bloom 一叠就是用户说的「刺眼的白色长条 / 漏光的板子」（y=1200 俯视实测：全屏最亮的连续白条）。
  // 按 5m 一段断开后，高光被切成逐段短反光，整体仍读作连续栏板。
  const SEGN = 30;
  const segL = (len * 1.002) / SEGN;
  for (const sg of [-1, 1]) {
    const ox = px * sg * (wid / 2 - 0.3), oz = pz * sg * (wid / 2 - 0.3);
    for (let i = 0; i < SEGN; i++) {
      const t = (i + 0.5) / SEGN;
      const sx2 = x0 + dx * len * t + ox, sz2 = z0 + dz * len * t + oz;
      const sy2 = y0 - drop * t;
      b.box('ash', segL * 0.94, 1.3, 0.6, sx2, sy2 + 0.62, sz2, W_JADE, ry, 0, tilt);
      b.box('ash', segL * 0.94, 0.16, 0.8, sx2, sy2 + 1.34, sz2, W_JADE_HI, ry, 0, tilt);
    }
  }
  // ④ 望柱 50 对（3m 一根，柱身竖直、柱头出挑压顶），柱脚踩在踏面上
  const nP = 50;
  for (let i = 0; i <= nP; i++) {
    const t = i / nP;
    const cx = x0 + dx * len * t, cz = z0 + dz * len * t;
    const sy = y0 - drop * t;
    for (const sg of [-1, 1]) {
      const ox = px * sg * (wid / 2 - 0.3), oz = pz * sg * (wid / 2 - 0.3);
      b.box('ash', 0.42, 1.52, 0.42, cx + ox, sy + 0.74, cz + oz, W_JADE, ry);
      b.box('ash', 0.58, 0.18, 0.58, cx + ox, sy + 1.58, cz + oz, W_JADE_HI, ry);
    }
  }
  // ⑤ 双寻杖（随坡倾斜）——同样分段，理由见 ③
  for (const sg of [-1, 1]) {
    const ox = px * sg * (wid / 2 - 0.3), oz = pz * sg * (wid / 2 - 0.3);
    for (let i = 0; i < SEGN; i++) {
      const t = (i + 0.5) / SEGN;
      const sx2 = x0 + dx * len * t + ox, sz2 = z0 + dz * len * t + oz;
      const sy2 = y0 - drop * t;
      b.box('ash', segL * 0.9, 0.2, 0.26, sx2, sy2 + 1.44, sz2, W_JADE_HI, ry, 0, tilt);
      b.box('ash', segL * 0.9, 0.16, 0.22, sx2, sy2 + 1.06, sz2, W_JADE, ry, 0, tilt);
    }
  }
  // ⑥ 顶端踏跺台（接岛面）与末端云台（半没入云海）
  b.box('ash', wid + 3.4, 0.6, 3.6, x0 - dx * 1.6, is.y + 0.02, z0 - dz * 1.6, W_JADE, ry);
  b.box('ash', wid + 7.0, 1.7, 12.0, x1 + dx * 4.2, W_CLOUD_Y - 0.35, z1 + dz * 4.2, W_JADE_D, ry);
  for (let i = 0; i < 5; i++) {
    const a2 = ang + (i - 2) * 0.34;
    const rr = 5.5 + skyJitter(i, 92.1) * 3.5;
    b.cyl('fabric', rr * 0.72, rr, 2.4, 9, x1 + Math.cos(a2) * (7 + i * 1.6), W_CLOUD_Y + 0.9,
      z1 + Math.sin(a2) * (7 + i * 1.6), shade(CS_TOP, 0.96 + skyJitter(i, 93.7) * 0.06), a2);
  }
  return { x0, z0, x1, z1, dx, dz, y0, y1 };
}

/** B2 云海天门：60m 高、4 柱 3 间牌楼，白玉柱 + 红金飞檐 + 匾额，立在 r≈650 的云海上。
 *  方位 270°（与既有南天门同一条 −z 轴，过南天门再往外望就是它）；该方位最近的外环岛留 58m。 */
function hCloudGate(b: Baker, cx: number, cy: number, cz: number, ry: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [cx + lx * cr + lz * sr, cz - lx * sr + lz * cr];
  const lv = (h: number): number => cy + h;
  // 三级汉白玉台基（宽 92 → 72）
  b.box('ash', 92, 1.1, 26, cx, lv(0.55), cz, W_JADE_D, ry);
  b.box('ash', 82, 1.1, 22, cx, lv(1.65), cz, W_JADE, ry);
  b.box('ash', 72, 1.2, 18, cx, lv(2.8), cz, W_JADE_HI, ry);
  // 四根白玉柱（边柱细、里柱粗）+ 柱础 + 柱头金箍——「巨大白色石柱的重复节奏」
  const colX = [-27, -9, 9, 27];
  for (let i = 0; i < 4; i++) {
    const [px, pz] = at(colX[i], 0);
    const rad = i === 0 || i === 3 ? 2.5 : 3.1;
    b.cyl('ash', rad * 1.42, rad * 1.52, 2.4, 10, px, lv(4.6), pz, W_JADE_HI, ry);
    b.cyl('ash', rad * 0.9, rad, 43, 10, px, lv(3.4 + 21.5), pz, W_JADE, ry);
    b.cyl('metal', rad * 0.95, rad * 0.95, 1.2, 10, px, lv(43.6), pz, GOLD_TRIM, ry);
  }
  // 额枋两道（朱红）+ 金线
  for (const [yy, hh, zz] of [[45.9, 3.0, 4.4], [42.2, 1.5, 3.6]] as const) {
    b.box('wood', 64, hh, zz, cx, lv(yy), cz, W_RED_C, ry);
    b.box('metal', 64.2, 0.32, zz + 0.2, cx, lv(yy - hh / 2 - 0.1), cz, GOLD_TRIM, ry);
  }
  // 斗栱带（沿两柱之间密布）
  hDougong(b, cx, lv(47.5), cz, 62, 5.2, ry, 20, GOLD_TRIM);
  // 三顶：中间高、两侧低（牌楼形制），屋面用 roofOn 真做曲面反宇。
  // 侧顶檐口必须压在上额枋顶（47.4）之上，否则会被额枋埋掉（原先写 46.2 就是埋了）
  const [rx0, rz0] = at(0, 0);
  roofOn(b, 30, 17, lv(49.4), rx0, rz0, ry, W_TILE_C, GOLD_LINE);
  for (const sg of [-1, 1]) {
    const [sx2, sz2] = at(sg * 21, 0);
    roofOn(b, 20, 15, lv(47.9), sx2, sz2, ry, W_TILE_C, GOLD_LINE);
  }
  // 宝顶（金属，非 glow）
  b.cyl('metal', 0.7, 1.1, 1.8, 8, rx0, lv(53.4), rz0, GOLD_ROOF, ry);
  // 匾额（10m 宽 —— 与长阶同级尺度）
  const [qx, qz] = at(0, 2.9);
  hPlaque(b, qx, lv(38.6), qz, 10, 3.2, ry);
  // 檐角点光 4 枚（0.35m，点状；不做檐口灯带）
  for (const sg of [-1, 1]) {
    for (const sz3 of [-1, 1]) {
      const [gx, gz] = at(sg * 14.2, sz3 * 7.9);
      b.box('glow', 0.35, 0.35, 0.35, gx, lv(49.9), gz, GOLD_LINE, ry, 0, Math.PI / 4);
    }
  }
  // 双幡 + 云脚（门楼不能像插在玻璃板上）
  for (const sg of [-1, 1]) {
    const [bx, bz] = at(sg * 33, 9.5);
    hBanner(b, bx, lv(2.9), bz, sg, sg > 0 ? W_RED_C : 0x2a4a7a, 12);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const rr = 38 + skyJitter(i, 95.3) * 16;
    b.cyl('fabric', 7 + skyJitter(i, 96.1) * 4, 11 + skyJitter(i, 96.7) * 6, 3.0,
      cx + Math.cos(a) * rr, lv(-0.6), cz + Math.sin(a) * rr * 0.55, shade(CS_BASE, 0.97 + skyJitter(i, 97.3) * 0.07), a);
  }
}

/** B3 悬空长廊：横跨两座云桥仙台之间，长 263m、宽 6m；一侧宫墙带浮雕、一侧开放柱列，
 *  红木地板 + 40 根柱列 + 窄瓦顶。整条廊沿世界 x 轴铺（两端同 z 同高），故侧倾可用 rx 表达。 */
/**
 * 天宫弧形长廊（复用并升级）：沿 r=R 的圆弧走 48 段，不是两点间的直弦。
 * 参考「云海长廊」：一侧宫墙（青绿彩画 + 浮雕壁板），一侧敞开俯瞰云海；
 * 金砖地面（金线分格）、白玉望柱 + 双层寻杖、檐下垂宫灯、青绿琉璃瓦顶随弧起伏。
 * 单位：米。y0 = 廊面标高。
 */
function hSkyArcCorridor(b: Baker, cx: number, cz: number, R: number, a0: number, a1: number, y0: number): void {
  const segs = 48;
  const W = 6.2;                     // 廊宽
  const WALL_OFF = -2.9;             // 宫墙在 −o 侧
  const GOLD = 0xffd25e, JADE = 0xb8b2a6, CAIHUA = 0x2f5f5a;
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + (a1 - a0) * (i / segs);
    const t1 = a0 + (a1 - a0) * ((i + 1) / segs);
    const tm = (t0 + t1) * 0.5;
    const arc = Math.abs(t1 - t0) * R;
    const mx = cx + Math.cos(tm) * R, mz = cz + Math.sin(tm) * R;
    const ry = -tm - Math.PI / 2;    // 让局部 x 沿切向
    const nx = Math.cos(tm), nz = Math.sin(tm);   // 径向（向外为 +o）
    // ① 金砖地面（金线分格）
    b.box('lacquer', arc * 1.03, 0.5, W, mx, y0, mz, i % 2 ? 0x6b4a2c : 0x74502e, ry);
    b.box('metal', arc * 1.03, 0.06, 0.09, mx, y0 + 0.28, mz, GOLD, ry);
    for (const o of [-1.6, 1.6]) {
      b.box('metal', arc * 1.03, 0.04, 0.06, mx + nx * o, y0 + 0.27, mz + nz * o, 0x9a7c1e, ry);
    }
    // ② 石梁（廊下承托）
    b.box('ash', arc * 1.03, 1.0, W - 0.6, mx, y0 - 0.78, mz, 0x6a6678, ry);
    // ③ 宫墙（−o 侧）：墙板 + 彩画带 + 浮雕壁板（每段交替：青绿 / 玉白）
    const wx = mx + nx * WALL_OFF, wz = mz + nz * WALL_OFF;
    b.box('wall', arc * 1.03, 4.4, 0.42, wx, y0 + 2.4, wz, i % 3 === 0 ? 0x8a8478 : 0xb8b2a6, ry);
    b.box('wood', arc * 1.03, 0.42, 0.5, wx, y0 + 4.4, wz, CAIHUA, ry);
    b.box('metal', arc * 1.03, 0.06, 0.54, wx, y0 + 4.66, wz, GOLD, ry);
    // 浮雕壁板：0.9×1.4 的深色薄板，逐段错位（读作满铺雕刻）
    if (i % 2 === 0) {
      b.box('ceramic', arc * 0.62, 1.5, 0.1, wx - nx * 0.22, y0 + 2.5, wz - nz * 0.22, 0x6f8f92, ry);
      b.box('metal', arc * 0.64, 0.08, 0.12, wx - nx * 0.23, y0 + 3.28, wz - nz * 0.23, GOLD, ry);
    }
    // ④ 柱列（开放侧）：每段一根，柱头斗栱小攒
    if (i % 2 === 0) {
      const px = mx + nx * 2.6, pz = mz + nz * 2.6;
      b.cyl('wood', 0.24, 0.3, 4.6, 8, px, y0 + 2.5, pz, 0x8a3226);
      b.box('ash', 0.62, 0.26, 0.62, px, y0 + 0.32, pz, JADE, ry);
      b.box('wood', 0.9, 0.22, 0.9, px, y0 + 4.9, pz, CAIHUA, ry);
      b.box('metal', 1.06, 0.1, 1.06, px, y0 + 5.04, pz, GOLD, ry);
      // 垂宫灯
      b.cyl('wood', 0.03, 0.03, 0.5, 4, px, y0 + 4.6, pz, 0x4a3220);
      b.sphere('glow', 0.22, 6, px, y0 + 4.2, pz, 0xffb84a);
    }
    // ⑤ 白玉望柱 + 双层寻杖（开放侧栏杆）
    for (const hy of [y0 + 0.9, y0 + 0.52]) {
      b.box('ash', arc * 1.03, 0.1, 0.12, mx + nx * 2.95, hy, mz + nz * 2.95, JADE, ry);
    }
    b.box('ash', 0.16, 1.06, 0.16, mx + nx * 2.95, y0 + 0.53, mz + nz * 2.95, 0xd0cabc, ry);
    // ⑥ 青绿琉璃瓦顶（随弧，前后两坡 + 正脊）
    const roofY = y0 + 5.16;
    for (const sgn of [-1, 1] as const) {
      b.box('roof', arc * 1.05, 0.22, 3.5, mx + nx * sgn * 1.55, roofY + 0.34, mz + nz * sgn * 1.55, 0x35594c, ry, sgn * 0.16, 0);
    }
    b.box('roof', arc * 1.05, 0.3, 0.42, mx, roofY + 0.78, mz, 0x4e6a61, ry);
    b.box('metal', arc * 1.02, 0.08, 0.5, mx, roofY + 0.96, mz, 0x9a7c1e, ry);
  }
  // 两端石阶 + 端柱
  for (const aA of [a0, a1]) {
    const ex = cx + Math.cos(aA) * R, ez = cz + Math.sin(aA) * R;
    b.box('ash', 5.2, 0.9, 4.4, ex, y0 - 0.45, ez, 0x6a6678, -aA);
    b.box('ash', 5.6, 0.22, 4.8, ex, y0 + 0.02, ez, 0xb8b2a6, -aA);
  }
}

function hRoundGate(b: Baker, cx: number, cy: number, cz: number, theta: number): void {
  const R = 40, N = 32, arc = (Math.PI * 2 * R) / N;
  const c = Math.cos(theta), s = Math.sin(theta);
  const ux = c, uz = -s;                          // 环平面内的水平轴
  for (let i = 0; i < N; i++) {
    const al = ((i + 0.5) / N) * Math.PI * 2;
    const wx = cx + ux * Math.cos(al) * R, wz = cz + uz * Math.cos(al) * R;
    const wy = cy + Math.sin(al) * R;
    b.box('ash', 4.6, arc * 1.03, 3.4, wx, wy, wz, shade(W_JADE, 0.97 + 0.03 * (i % 2)), theta, 0, al);
    // 环身外缘一圈薄檐（正面读出层次，不做灯带）
    b.box('ash', 1.2, arc * 0.94, 4.2, cx + ux * Math.cos(al) * (R + 2.4), cy + Math.sin(al) * (R + 2.4),
      cz + uz * Math.cos(al) * (R + 2.4), W_JADE_D, theta, 0, al);
  }
  // 月盘：55m 直径，悬在环心（轴线沿环法线；rz 先把圆柱轴放平、ry 再转到法线方向）
  b.cyl('fabric', 27.5, 27.5, 1.2, 32, cx, cy, cz, W_MOON, theta + Math.PI / 2, 0, Math.PI / 2);
  b.cyl('fabric', 26.4, 26.4, 0.26, 32, cx + Math.sin(theta) * 1.0, cy, cz + Math.cos(theta) * 1.0,
    shade(W_MOON, 1.04), theta + Math.PI / 2, 0, Math.PI / 2);
  // 环内缘 10 枚点光（0.5m × 0.5m；分散 36°，不是连续灯带）
  for (let i = 0; i < 10; i++) {
    const al = (i / 10) * Math.PI * 2 + 0.2;
    b.box('glow', 0.5, 0.5, 0.3, cx + ux * Math.cos(al) * (R - 4.6), cy + Math.sin(al) * (R - 4.6),
      cz + uz * Math.cos(al) * (R - 4.6), GOLD_LINE, theta, 0, al);
  }
  // 月门台：三级玉台 + 六步踏跺（环脚埋进云里 2m，不悬空）
  b.box('ash', 62, 1.2, 16, cx, W_CLOUD_Y + 0.6, cz, W_JADE_D, theta);
  b.box('ash', 54, 1.2, 13, cx, W_CLOUD_Y + 1.7, cz, W_JADE, theta);
  b.box('ash', 46, 1.3, 10, cx, W_CLOUD_Y + 2.9, cz, W_JADE_HI, theta);
  for (let k = 0; k < 6; k++) {
    b.box('ash', 20 - k * 0.6, 0.34, 1.2, cx + Math.sin(theta) * (9 + k * 1.2), W_CLOUD_Y + 2.7 - k * 0.34,
      cz + Math.cos(theta) * (9 + k * 1.2), shade(W_JADE, 1 - k * 0.02), theta);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    b.cyl('fabric', 5.5 + skyJitter(i, 98.1) * 3, 9 + skyJitter(i, 98.9) * 4, 2.6,
      cx + Math.cos(a) * 34, W_CLOUD_Y + 0.6, cz + Math.sin(a) * 34, shade(CS_BASE, 0.97 + skyJitter(i, 99.3) * 0.06), a);
  }
}

/** B5a 石狮：2.4m 高，须弥座 + 狮身 + 头 + 鬃 + 四腿 + 绣球（20 件，≈0.5k 面） */
function hLion(b: Baker, x: number, y: number, z: number, ry: number, sc: number): void {
  const cr = Math.cos(ry), sr = Math.sin(ry);
  const P = (lx: number, ly: number, lz: number): [number, number, number] =>
    [x + (lx * cr + lz * sr) * sc, y + ly * sc, z + (-lx * sr + lz * cr) * sc];
  const put = (w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number): void => {
    const [px, py, pz] = P(lx, ly, lz);
    b.box('ash', w * sc, h * sc, d * sc, px, py, pz, hex, ry);
  };
  put(2.0, 0.85, 1.4, 0, 0.42, 0, W_JADE_D);          // 须弥座
  put(1.72, 0.28, 1.14, 0, 0.98, 0, W_JADE_HI);        // 座顶线
  put(1.26, 0.96, 0.8, 0, 1.62, 0, W_JADE);            // 身
  put(0.98, 0.8, 0.86, 0, 1.66, 0.1, shade(W_JADE, 1.03)); // 胸
  put(0.66, 0.62, 0.66, 0, 2.28, 0.12, W_JADE_HI);     // 头
  put(0.44, 0.28, 0.32, 0, 2.16, 0.5, W_JADE);         // 吻
  put(0.16, 0.22, 0.14, 0.27, 2.56, 0.08, W_JADE_HI);  // 耳
  put(0.16, 0.22, 0.14, -0.27, 2.56, 0.08, W_JADE_HI);
  for (let i = 0; i < 5; i++) {                        // 鬃（五团）
    const a = -0.9 + i * 0.45;
    put(0.24, 0.26, 0.24, Math.sin(a) * 0.38, 2.42 - Math.abs(a) * 0.12, -0.28, shade(W_JADE_D, 1.1));
  }
  for (const sx2 of [-1, 1]) {
    for (const sz2 of [-1, 1]) put(0.24, 0.86, 0.28, sx2 * 0.42, 1.0, sz2 * 0.28, shade(W_JADE_D, 1.02));
  }
  put(0.3, 0.62, 0.3, 0, 1.9, -0.5, W_JADE_D);         // 尾
  put(0.34, 0.26, 0.26, 0, 2.2, -0.62, W_JADE_HI);
  const [balX, balY, balZ] = P(0.44, 0.5, 0.56);
  b.cyl('ash', 0.3 * sc, 0.34 * sc, 0.6 * sc, 8, balX, balY, balZ, W_JADE_HI, ry);   // 绣球
}

/** B5b 千年苍松：4–6 段弯曲树干 + 5 层团簇冠，高 14–18m、冠幅 ≈12m（前景框景） */
function hPine(b: Baker, x: number, y: number, z: number, sc: number, seed: number): void {
  const H = 16 * sc;
  const lean = skyJitter(seed, 101.3) * Math.PI * 2;
  let cx = x, cz = z, cy = y;
  const segN = 5;
  for (let i = 0; i < segN; i++) {
    const t0 = i / segN, t1 = (i + 1) / segN;
    const segH = (H * 0.86) / segN;
    const drift = (0.18 + skyJitter(seed + i, 102.7) * 0.42) * sc * (1 - t0 * 0.5);
    const nx2 = Math.cos(lean + i * 0.62), nz2 = Math.sin(lean + i * 0.62);
    b.cyl('trunk', (0.6 - t1 * 0.42) * sc, (0.6 - t0 * 0.42) * sc, segH * 1.06, 6,
      cx + nx2 * drift * 0.5, cy + segH * 0.5, cz + nz2 * drift * 0.5, shade(0x4a3a28, 0.94 + i * 0.03));
    cx += nx2 * drift; cz += nz2 * drift; cy += segH;
  }
  // 主枝 5 根（横出，虬曲横生）
  for (let i = 0; i < 5; i++) {
    const a = lean + 1.1 + i * 1.15 + skyJitter(seed + i, 103.9) * 0.5;
    const len = (4.4 - i * 0.55) * sc;
    b.cyl('trunk', 0.13 * sc, 0.24 * sc, len, 5, x + Math.cos(a) * len * 0.42, y + H * (0.42 + i * 0.09),
      z + Math.sin(a) * len * 0.42, shade(0x4a3a28, 0.96), a, 0, Math.PI / 2);
  }
  // 五层团簇冠（每层 3 团 + 1 心团，冠幅 12m → 顶部 6m）
  for (let t2 = 0; t2 < 5; t2++) {
    const tt = t2 / 4;
    const cy2 = y + H * (0.48 + tt * 0.46);
    const cr2 = (4.0 - tt * 1.9) * sc;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + skyJitter(seed + t2, 104.3) * 1.3;
      b.cyl('leaf', cr2 * 0.66, cr2 * 0.95, 1.5 * sc, 9, x + Math.cos(a) * cr2 * 0.62, cy2,
        z + Math.sin(a) * cr2 * 0.62, shade(0x2f5a3a, 0.84 + t2 * 0.05), a, 0, 0, true);
    }
    b.cyl('leaf', cr2 * 0.52, cr2 * 0.78, 1.2 * sc, 9, x, cy2 + 0.42 * sc, z, shade(0x2f5a3a, 0.92 + t2 * 0.05),
      tt * 2.1, 0, 0, true);
  }
}

/** C 外环瀑布：每座岛补 1 道 6–14m 宽水帘，自盘缘垂到云海面（196.65），落点补水雾云团。
 *  方位取 islandFallAngle + 1.85（避开 buildIslandSkirt 自带的 2–3 道窄瀑，岛缘上不叠在一起）。 */
function hOuterFall(b: Baker, is: HIsle, seed: number): void {
  const a = islandFallAngle(seed) + 1.85 + (skyJitter(seed, 88.1) - 0.5) * 0.5;
  const wd = 6 + skyJitter(seed, 89.3) * 8;
  // yTop 必须高于云面：外环岛 y 落在 198–224，低岛若按「岛面−3.2」算会得到 194.8 < 196.65，
  // 水帘就倒挂进云板里。改为「岛缘下 1.2m」与「云面 +1.5m」取高者，落差 1.5–26m。
  const yBot = W_CLOUD_Y + 0.4;
  const yTop = Math.max(is.y - 1.2, W_CLOUD_Y + 1.5);
  const segN = 4;
  for (let i = 0; i < segN; i++) {
    const ya = yTop + ((yBot - yTop) * i) / segN, yb = yTop + ((yBot - yTop) * (i + 1)) / segN;
    const rr = is.r * 0.982 + i * 0.34;
    b.box('water', wd * (1 - i * 0.05), ya - yb + 0.3, 0.34,
      is.x + Math.cos(a) * rr, (ya + yb) / 2, is.z + Math.sin(a) * rr,
      shade(0x8fc4d8, 0.94 + i * 0.05), Math.PI / 2 - a);
  }
  // 落水口石唇 + 落点水雾
  b.box('ash', wd + 1.6, 0.6, 1.4, is.x + Math.cos(a) * is.r * 0.99, yTop + 0.3, is.z + Math.sin(a) * is.r * 0.99, W_JADE_D, Math.PI / 2 - a);
  for (let i = 0; i < 3; i++) {
    const am = a + (i - 1) * 0.2;
    const rr = is.r * 0.88 + 2.4 + (i % 2) * 2.6;
    const sr = 4.2 + skyJitter(seed + i, 90.7) * 3.4;
    b.cyl('fabric', sr * 0.7, sr, 1.8 + skyJitter(seed + i, 91.1) * 1.2, 9,
      is.x + Math.cos(am) * rr, W_CLOUD_Y + 1.2, is.z + Math.sin(am) * rr, shade(CS_TOP, 0.97 + skyJitter(seed + i, 91.9) * 0.06), am);
  }
  b.box('water', wd * 0.9, 0.3, 1.4, is.x + Math.cos(a) * (is.r * 0.88 + 1.4), W_CLOUD_Y + 0.6, is.z + Math.sin(a) * (is.r * 0.88 + 1.4), 0x9fd0e0, Math.PI / 2 - a);
}

/** W20 母题总装：五件 + 外环瀑布群。全部只用 skyJitter，不碰共享 rng。 */
function buildW20(b: Baker, inner: HIsle[], outer: HIsle[]): void {
  // ---- B1 白玉长阶（宿主：内环第 5 岛） ----
  const host = inner[4];
  const st = hJadeStair(b, host);
  // ---- B5 前景石狮 2 对 + 苍松 3 株（守在长阶入口） ----
  // 一对压在顶端踏跺台上（横向 ±5.0，踏跺台宽 13.4），一对下到长阶第 7m 处（横向 ±3.4，落在栏板内）
  for (const sg of [-1, 1]) {
    const ox = -st.dz * sg, oz = st.dx * sg;
    const face = Math.atan2(st.dx, st.dz);          // 面朝来路（下坡方向）
    hLion(b, st.x0 - st.dx * 2.0 + ox * 5.0, host.y + 0.16, st.z0 - st.dz * 2.0 + oz * 5.0, face, 1.0);
    hLion(b, st.x0 + st.dx * 7.0 + ox * 3.4, host.y - 0.62, st.z0 + st.dz * 7.0 + oz * 3.4, face, 0.92);
  }
  for (let i = 0; i < 3; i++) {
    const a = (W_STAIR.dir * Math.PI) / 180 + (i - 1) * 0.62 + 0.1;
    const rr = host.r * (0.62 + 0.08 * i);
    hPine(b, host.x + Math.cos(a) * rr, host.y + 0.16, host.z + Math.sin(a) * rr,
      0.9 + skyJitter(i, 111.7) * 0.22, 1201 + i * 17);
  }
  // ---- B4 圆形仙门 + 月盘（长阶末端外 46m，环脚埋进云面 2m） ----
  const gx = st.x1 + st.dx * 46, gz = st.z1 + st.dz * 46;
  hRoundGate(b, gx, W_CLOUD_Y + 38, gz, Math.atan2(-st.dx, -st.dz));
  // ---- B2 云海天门（r 650，−z 轴，正对南天门） ----
  hCloudGate(b, 0, W_CLOUD_Y, -650, 0);
  // ---- B3 悬空长廊（r 660 的 ±11.5° 两座云桥仙台之间，弦长 263m） ----
  const R = 660, half = (11.5 * Math.PI) / 180;
  const c1 = Math.cos(Math.PI / 2 - half) * R, c2 = Math.cos(Math.PI / 2 + half) * R;
  const cz = Math.cos(half) * R;
  hSkyArcCorridor(b, 0, 0, 660, Math.PI / 2 - half, Math.PI / 2 + half, 202);
  // ---- C 外环 12 岛各 1 道宽水帘（6–14m） ----
  for (let i = 0; i < outer.length; i += 3) {
    if (i >= 36) break;
    hOuterFall(b, outer[i], 1511 + i * 7);
  }
}

/**
 * 天界都城总装：三环群岛 + 12 座云桥 + 12 座远景宫阙 + W20 五母题。
 * 全部走 skyJitter 哈希，不消耗共享 rng——既有世界生成序列逐值不变。
 */
export function buildHeavenRings(b: Baker): void {
  const inner = hRing(12, 220, 300, 26, 46, 11, 1, [], 401);
  const mid = hRing(24, 340, 430, 18, 34, 23, 1, [], 907);
  // W20：外环 40 岛 ×1.6（反透视），并把中环 24 岛作为互斥占位——放大后 470−38 会与 430+34 在
  // 径向上叠；内环/中环的落位与 W18 完全一致，只有外环因放大而重排。
  const outer = hRing(40, 470, 580, 12, 24, 37, 1.25, mid, 1511);
  // 形制序列：内环偏殿阁楼观（政治/仪典），中环殿阁混排，外环只留殿亭观阁（低模仍带可辨屋顶）
  const SEQ_IN: HForm[] = ['dian', 'ge', 'ta', 'lou', 'guan', 'tai', 'dian', 'ge', 'ting', 'guan', 'lou', 'ta'];
  const SEQ_MID: HForm[] = ['dian', 'ge', 'ting', 'guan', 'lou', 'ta', 'tai'];
  const SEQ_OUT: HForm[] = ['dian', 'ting', 'guan', 'ge'];
  let seq = 0;
  for (let i = 0; i < inner.length; i++) {
    const n = i % 2 === 0 ? 3 : 2;
    const kinds: HForm[] = [];
    for (let k = 0; k < n; k++) kinds.push(SEQ_IN[(seq + k) % SEQ_IN.length]);
    // W20：第 5 座岛是白玉长阶的宿主，岛缘栏杆在长阶方位留 12.8m 口
    hIsland(b, inner[i], 401 + i * 7, kinds, 1, i === 4 ? (W_STAIR.dir * Math.PI) / 180 : undefined);
    seq += n;
  }
  for (let i = 0; i < mid.length; i++) {
    const n = i % 3 === 0 ? 2 : 1;
    const kinds: HForm[] = [];
    for (let k = 0; k < n; k++) kinds.push(SEQ_MID[(seq + k) % SEQ_MID.length]);
    hIsland(b, mid[i], 907 + i * 7, kinds);
    seq += n;
  }
  for (let i = 0; i < outer.length; i++) {
    // vh = 1.6：岛径与单体同步放大后，檐高上限也要抬到 24/19/14m，否则读成「摊开的矮厅」
    hIsland(b, outer[i], 1511 + i * 7, [SEQ_OUT[(seq + i) % SEQ_OUT.length]], 1.6);
  }
  // ---- 云桥 12 座：内环 → 中环（角向最近 + 高差最小者） ----
  const usedMid = new Set<number>();
  let bridges = 0;
  for (let i = 0; i < inner.length; i++) {
    const A = inner[i];
    let best = -1, bestScore = Infinity;
    for (let j = 0; j < mid.length; j++) {
      if (usedMid.has(j)) continue;
      let da = Math.abs(mid[j].a - A.a) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > Math.PI * 0.34) continue;
      const score = da * 60 + Math.abs(mid[j].y - A.y) * 0.8;
      if (score < bestScore) { bestScore = score; best = j; }
    }
    if (best < 0) continue;
    usedMid.add(best);
    hBridge(b, A, mid[best], 2201 + i * 11);
    bridges++;
  }
  // ---- 远景宫阙 12 座（r 700–900，整体 ×3.0） ----
  for (let i = 0; i < 12; i++) hFarPalace(b, i);
  // ---- W20 五母题 + 外环瀑布群 ----
  buildW20(b, inner, outer);
  void bridges;
}
