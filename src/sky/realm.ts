import * as THREE from 'three';
import { Baker, SignMesher, SignAtlas, shade, type BGroup } from '../city/bake';
import { roofOn, C } from '../city/buildings';
import { PoolSet, MAX_CLOUDS } from '../actors/pools';
import { buildWindFlora } from './flora';
import { RNG } from '../core/rng';
import { LINGXIAO_WIN, paneGrid, buildCloudTerrace, buildIslandSkirt, islandFallAngle, skyJitter, skyRoofOn, skyStackedRoof, skyDougongRing, skyCaihuaBand, cloudBall, CS_BASE, CS_DEEP, CS_TOP, GOLD_LINE, GOLD_ROOF, GOLD_TRIM } from './palace';
import { buildIslandKeel } from './expansion';

// ============ 天宫：云海/南天门/凌霄殿/蟠桃园/丹房/莲台/广寒/星河 ============
export interface SkyCenters {
  arena: THREE.Vector3; gate: THREE.Vector3; palace: THREE.Vector3; court: THREE.Vector3;
  pantao: THREE.Vector3; furnace: THREE.Vector3; lotus: THREE.Vector3; lotus2: THREE.Vector3;
  moon: THREE.Vector3; high: THREE.Vector3; arenaW: THREE.Vector3; arenaE: THREE.Vector3;
  arenaN: THREE.Vector3; arenaS: THREE.Vector3;
}

export function buildSkyRealm(b: Baker, sg: SignMesher, atlas: SignAtlas, ps: PoolSet, scene: THREE.Scene, rng: RNG): SkyCenters {
  const arena = new THREE.Vector3(0, 206, 0);
  const gate = new THREE.Vector3(0, 203, -85);
  const palace = new THREE.Vector3(0, 214, 95);
  const court = new THREE.Vector3(0, 214, 74);
  const pantao = new THREE.Vector3(-150, 201, 45);
  const furnace = new THREE.Vector3(-120, 208, -20); // B6 迁正 10 卷 spec（原 150,204,25 与瑶池带冲突）
  const lotus = new THREE.Vector3(120, 206, 120);
  const lotus2 = new THREE.Vector3(152, 205, 142);
  const moon = new THREE.Vector3(40, 209, -55);
  const high = new THREE.Vector3(0, 223, -12);
  const centers: SkyCenters = {
    arena, gate, palace, court, pantao, furnace, lotus, lotus2, moon, high,
    arenaW: new THREE.Vector3(-38, 208, -8), arenaE: new THREE.Vector3(38, 208, 8),
    arenaN: new THREE.Vector3(0, 208, -22), arenaS: new THREE.Vector3(0, 208, 24),
  };

  // 云台：三级石座 + 台面铺砖 + 栏杆望柱 + 正面踏道，不再是光面圆鼓
  const platform = (x: number, y: number, z: number, r: number, gold = false): void => {
    const stone = gold ? shade(0x9c8452, 1) : shade(0x7e7a8c, 1);
    // W3/F8：座径 1.0/0.96/0.90 → 0.975/0.93/0.88 —— 岩石倒锥（顶径 0.94r）必须在石座外侧，
    // 否则土褐色石鼓会从岩体里穿出来，侧视仍是「圆盘」。座顶比台沿（1.01r）低 0.035r，
    // 读法从「光面石鼓」变「须弥座压在岩体上」。
    b.cyl('wall', r * 0.975, r * 0.93, 3.0, 28, x, y - 1.5, z, stone);
    b.cyl('wall', r * 0.93, r * 0.88, 2.2, 28, x, y - 4.1, z, shade(stone, 0.86));
    b.cyl('wall', r * 0.88, r * 0.83, 1.8, 28, x, y - 6.1, z, shade(stone, 0.74));
    // 台面铺砖：金台改**深色抛光石**（近黑，带冷调），替掉旧的土褐 0x6f6656——
    // 旧色从空中看整座岛读成"棕色饼干"，与参考图 R1 的深色镜面地完全相反。
    b.cyl('ground', r * 0.965, r * 0.965, 0.12, 28, x, y + 0.06, z, gold ? 0x2e2c33 : 0x565264);
    // 台沿石带
    b.cyl('wall', r * 1.01, r * 1.01, 0.3, 28, x, y - 0.05, z, shade(stone, 1.12));
    // 望柱与横栏：28 根柱 + 两道压栏
    const n = 28;
    // W3：瀑布口方位与 palace.islandFalls 同一套哈希；有瀑布的台（r ≥ 17）在栏杆上让开 2–3 根
    const skirtSeed = x * 1.7 + z * 2.3 + r;
    const fallA = islandFallAngle(skirtSeed);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (r >= 17 && Math.cos(a - fallA) > 0.955) continue;
      const px = x + Math.cos(a) * r * 0.975;
      const pz = z + Math.sin(a) * r * 0.975;
      b.box('wall', 0.34, 1.0, 0.34, px, y + 0.6, pz, shade(stone, 1.2), -a);
      if (i % 2 === 0) b.box('metal', 0.1, 0.22, 0.1, px, y + 1.18, pz, gold ? GOLD_TRIM : 0x9aa6b8);
    }
    b.cyl('wall', r * 0.99, r * 0.99, 0.16, 28, x, y + 0.86, z, shade(stone, 1.06), 0, 0, 0, true);
    b.cyl('wall', r * 0.99, r * 0.99, 0.1, 28, x, y + 0.32, z, shade(stone, 0.96), 0, 0, 0, true);
    // 正面踏道：三级石阶
    for (let k = 0; k < 3; k++) {
      b.box('wall', 7 - k * 1.4, 0.34, 1.5, x, y - 0.17 - k * 0.34, z + r * 0.97 + 0.75 - k * 1.1, shade(stone, 1.05 - k * 0.05));
    }
    // W3/F1：台缘金环整圈 16–40 m²，原走 glow（toneMapped:false）直接打满 → 金台改 wood 组压档
    if (gold) b.cyl('wood', r * 1.02, r * 1.02, 0.06, 28, x, y + 0.02, z, GOLD_ROOF, 0, 0, 0, true);
    else b.cyl('glow', r * 1.02, r * 1.02, 0.06, 28, x, y + 0.02, z, 0x00e5ff, 0, 0, 0, true);
    // WS-46 → W3：底盘由「玉盘 + 垂云 + 云团簇」改为「岩石倒锥 + 岩腰垂云 + 瀑布 + 垂藤」
    // （buildIslandSkirt 内部顺序：倒锥 → 玉盘 → 岩腰云 → 瀑布 → 垂藤 → 云团簇）
    buildIslandSkirt(b, x, y, z, r, skirtSeed);
    buildIslandKeel(b, x, y, z, r, skirtSeed);
    b.kit('heaven.platform', 1, y);
    b.kit('heaven.platformPost', n, y);
    b.kit('heaven.platformStep', 3, y);
  };

  // 斗法云台（主战场）
  platform(arena.x, arena.y, arena.z, 44, true);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box('glow', 1.2, 1.2, 1.2, arena.x + Math.cos(a) * 40, arena.y + 0.8, arena.z + Math.sin(a) * 40, i % 2 ? GOLD_LINE : 0x00e5ff, 0, 0, Math.PI / 4);
  }
  // 南天门（重写：城台+墩台+门洞+门楼+飞檐，全结构连贯）
  platform(gate.x, gate.y, gate.z, 30);
  // 城台墩座
  b.box('wall', 44, 8, 18, gate.x, gate.y + 4, gate.z, shade(0x6a5a3e, 1));
  // 城台面砖
  b.box('wall', 44, 0.4, 18, gate.x, gate.y + 8.2, gate.z, shade(0x8a7a5e, 1));
  // 门洞两侧墩柱
  for (const sx of [-1, 1]) {
    b.box('wood', 4, 22, 4, gate.x + sx * 14, gate.y + 11, gate.z, shade(0x7a5a2e, 1));
    b.box('wood', 1.0, 22, 1.0, gate.x + sx * 14, gate.y + 11, gate.z + 2.2, shade(GOLD_TRIM, 1));
    b.box('glow', 0.4, 20, 0.4, gate.x + sx * 16, gate.y + 11, gate.z, 0x00e5ff);
    roofOn(b, 9, 9, gate.y + 22, gate.x + sx * 14, gate.z, 0, shade(0x8a6a2a, 1.1));
  }
  // 主门楼（横梁+斗拱+双檐）
  b.box('wood', 40, 3, 5, gate.x, gate.y + 24.5, gate.z, shade(0x8a6a2e, 1));
  b.box('wood', 36, 2, 4, gate.x, gate.y + 27, gate.z, shade(0xa08040, 1));
  // W23：斗拱带由「正面一排 12 片 0.5 厚贴片」改成「一圈密排出挑 + 檐枋落脚 + 彩画带」
  //   檐枋 37×0.75×4.4（顶 231.78）扛住 68 攒栌斗；下檐基准 232.5 不动，门楼高度不涨
  b.box('wood', 37, 0.75, 4.4, gate.x, gate.y + 28.4, gate.z, shade(0x8a6a2e, 1.05));
  skyDougongRing(b, gate.x, gate.y + 29.5, gate.z, 36.8, 4.4, 0, 1.2, GOLD_TRIM);
  skyCaihuaBand(b, gate.x, gate.y + 28.4, gate.z, 37, 4.4, 0);
  b.box('wall', 36, 10, 2.4, gate.x, gate.y + 12, gate.z + 2.8, shade(0x6e4a24, 1.05));
  // W23：单檐 → 重檐叠顶（下檐 46×12.5 / 上檐 34×9；顶层 34 ≥ 12 仍走庑殿，脊上另悬九色光轮）
  skyStackedRoof(b, gate.x, gate.y + 29.5, gate.z, 46, 12.5, 2, 3.05, 0, 'wudian', shade(0x9a7a32, 1.15), GOLD_TRIM);
  sg.quad(atlas.text('skygate', '南天門', 420, 110, { color: '#fff', glow: '#00e5ff', bg: 'rgba(6,10,22,0.9)', border: 'rgba(0,229,255,.9)', fontPx: 78 }), 10, 2.6, gate.x, gate.y + 25, gate.z + 4.6, 0);
  for (const sx of [-1, 1]) {
    sg.quad(atlas.text(`skybanner${sx}`, sx < 0 ? '霧鎖南天' : '雲封北闕', 90, 340, { color: '#ffe9b8', glow: '#ffb300', vertical: true, fontPx: 56, bg: 'rgba(10,8,14,0.6)' }), 1.5, 5.6, gate.x + sx * 10, gate.y + 12, gate.z + 3.5, 0);
  }
  // ---- W19：凌霄宝殿 T-GZ-001 按《天宫资产全录》重建 ----
  // 结构层次（10 卷 §T-GZ-001）：台基三层 → 丹陛御路 → 石栏杆 → 柱网 14 蟠龙金柱 → 额枋
  //   → 斗拱 14 组 → 下檐 → 上檐（重檐庑殿顶）→ 正脊 → 鸱吻 → 宝顶。
  // 竖向锚点：云台台面 214.12（DECK）→ 台明顶 = 殿内地坪 218.80（FLR，= palace.ts lingxiaoNave 的 y）
  //   → 檐柱顶 229.40（檐柱 10.6m，W24 由 9m 抬 1.6m）→ 额枋 230.30 → 斗拱 230.11–230.91
  //   → 下檐 230.91 起（52×32、举高 3.24）→ 上檐 235.41 起（40×25.2、举高 4.37）→ 正脊 239.78。
  // W24：殿身墙顶 229.2 → 230.8（殿身 10.4 → 12.0m）。下檐不动——檐口 48×29.5 与台基底盘 48×32 齐平，
  //   动它会让屋面反挑出台基剪影；只抬上檐并把上檐加宽到 40×25.2（对 34×20 上层殿身出檐 0.76 → 1.44m），
  //   两层檐的高低差由 3.72 提到 4.50m，侧视才读得成「重檐」而不是「一顶金盖」。
  // 台基按文档 3 层 × 2m = 6m，底面 212.80；台面露明 4.68m，最下 1.32m 压在云台石座内——
  //   台面若抬到 220.12 会把 palace.ts 的室内地坪（218.96）埋进台基，室内属另一系统，本包不动。
  platform(palace.x, palace.y, palace.z, 46, true);
  const DECK = palace.y + 0.12;   // 云台台面（台基脚下的地面）
  const FLR = palace.y + 4.8;     // 台明顶 = 殿内地坪
  const MB = 0xb4b0a8;            // 汉白玉：线性 0.465，旧 0xd8d0c0 线性 0.688 乘 3.2 后裁白
  const JIN = 0x9a7c1e;           // 蟠龙金柱贴金
  const JIND = shade(JIN, 0.42);  // 柱身缠龙的暗色环/龙身
  const PAINT = 0x2b4a52;         // 和玺彩画青绿底
  const CXS = [-20, -13.25, -6.5, 6.5, 13.25, 20]; // 5 开间：明间 13 + 4×6.75 = 面阔 40
  const CZ = 11;                                    // 檐柱进深半宽 11 → 进深 22

  // ① 台基三层须弥座：每层 2m（下枋 0.5 / 下枭 0.3 / 束腰 0.6 / 上枭 0.3 / 上枋 0.3）。
  // W48：面阔按 2.7273× 放大到 240m 后，台基若保持 32m 进深会伸到 z=113（世界），
  //   把东西朝房（北缘 z=136.4）压在台基下面；故进深收窄到 24.2（世界 145.2，南缘 136.4），
  //   宽度保持 48（世界 288）。三叠逐层收 2m（宽）/ 0.8m（深），顶叠 44×22.6 仍包住 40×22 的殿身。
  const TIERS: [number, number][] = [[48, 24.2], [46, 23.4], [44, 22.6]];
  for (let i = 0; i < 3; i++) {
    const [tw, td] = TIERS[i];
    const y0 = FLR - 6 + i * 2;
    b.box('ash', tw, 0.5, td, palace.x, y0 + 0.25, palace.z, shade(MB, 0.97));
    b.box('ash', tw - 0.44, 0.3, td - 0.44, palace.x, y0 + 0.65, palace.z, shade(MB, 0.93));
    b.box('ash', tw - 1.2, 0.6, td - 1.2, palace.x, y0 + 1.1, palace.z, shade(MB, 0.86));  // 束腰内凹 0.6
    b.box('ash', tw - 0.44, 0.3, td - 0.44, palace.x, y0 + 1.55, palace.z, shade(MB, 1.02));
    b.box('ash', tw, 0.3, td, palace.x, y0 + 1.85, palace.z, shade(MB, 1.06));             // 上枋
  }
  // ② 正面丹陛御路（W48：由本段预缩放坐标系迁到文件末尾「世界坐标」段重建）
  //   旧版 24 级 0.195×0.3（4.68m 升 / 7.2m 跑）在 2.7273× 后升 28.1m、跑 43.2m，
  //   起点在台基南缘（世界 z≈138），落在前庭平台上；级别加到 36 级，踏面 1.14、踢面 0.92。
  //   本段不再出任何踏步——预缩放坐标里的踏步会被二次缩放拉长到台基体内。
  // ③ 台基石栏杆：望柱间距 2.4m、通高 1.2m（柱身 1.04 + 柱头 0.16），两道寻杖，正面（−z）让开丹陛
  const RL = 22, RD = 11.3;                        // 顶层台明 44×22.6 的半宽
  const post = (px: number, pz: number): void => {
    b.box('ash', 0.22, 1.04, 0.22, px, FLR + 0.52, pz, shade(MB, 1.02));
    b.box('ash', 0.32, 0.16, 0.32, px, FLR + 1.12, pz, shade(MB, 1.12));
  };
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const ry = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / 2.4));
    for (let i = 0; i <= n; i++) post(ax + (dx * i) / n, az + (dz * i) / n);
    for (const [yy, th] of [[0.94, 0.14], [0.48, 0.12]] as const) {
      b.box('ash', len, th, 0.16, (ax + bx) / 2, FLR + yy, (az + bz) / 2, shade(MB, 1.0), ry);
    }
  };
  const FX = palace.x, FZ = palace.z;
  // 正面（−z，朝南天门）留 6.6m 丹陛口，其余三面连续
  rail(FX - RL, FZ - RD, FX - 3.3, FZ - RD);
  rail(FX + 3.3, FZ - RD, FX + RL, FZ - RD);
  rail(FX - RL, FZ + RD, FX + RL, FZ + RD);
  rail(FX - RL, FZ - RD, FX - RL, FZ + RD);
  rail(FX + RL, FZ - RD, FX + RL, FZ + RD);
  // 墙身（厚实红色，金色液金纹饰）——WS-11 掏空为殿身壳：外轮廓与旧实心块逐面一致
  // （x ±20 / z 84·106 / y 218.5–230.8），仅开**南面（−z，朝南天门）**明间门 + 东西两面各 4 樘支摘窗洞
  // W24：墙顶 229.2 → 230.8（殿身 10.4 → 12.0m），檐柱/额枋/斗拱同步抬 1.6m，下檐基准 230.91
  // W48：门洞由 +z 面翻到 −z 面——南天门在 −z，殿门必须正对它；背面（+z）改为整面朱墙。
  {
    const HY0 = palace.y + 4.5, HY1 = palace.y + 16.8;
    const WC = shade(0xd2381f, 1.0), HWIN = LINGXIAO_WIN;
    // W48：墙身由 'wall' 改 'wood'。wall 组是 MeshLambertMaterial + emissive 0x3a3d48（冷灰自发光），
    //   天宫主殿朝南的立面常年背光，冷灰 emissive 把朱红拉成紫褐；wood 组无 emissive，红能站住。
    const WG = 'wood' as const;
    // 山墙（东西两侧）必须是**实心朱墙**：中式宫殿的山墙本不开窗，窗在檐面的隔扇上。
    // 旧版按 LINGXIAO_WIN 在此开 4 樘窗洞，被 enlargeLingxiao 的 2.7273× 顶点缩放后
    // 变成 7.6m × 5.2m 的黑洞（用户原话「天宫变大了，窗户不要跟着变大」）。
    // 室内房间自身的窗由 palace.ts 室内壳负责，不受此处影响。
    for (const sx of [-1, 1]) {
      b.box(WG, 0.6, HY1 - HY0, 20.8, palace.x + sx * 19.7, (HY0 + HY1) / 2, palace.z, WC);
    }
    b.box(WG, 40, HY1 - HY0, 0.6, palace.x, (HY0 + HY1) / 2, palace.z + 10.7, WC);
    for (const sx of [-1, 1]) b.box(WG, 14, HY1 - HY0, 0.6, palace.x + sx * 13, (HY0 + HY1) / 2, palace.z - 10.7, WC);
    b.box(WG, 12, HY1 - 221.7, 0.6, palace.x, (221.7 + HY1) / 2, palace.z - 10.7, WC);
    // 正檐满布六抹隔扇：中式宫殿的「窗」是檐面隔扇上的菱花格心，不是山墙上的洞。
    // 旧版檐面只有两片 14m 朱红平板，放大 2.7273× 后整面读成一块红板。
    // 这里按五开间逐间铺隔扇：竖梃分扇、三道抹头、格心加密菱花线、下段裙板。
    {
      const fz = palace.z - 11.06;
      const yBot = HY0 + 0.6, yTop = HWIN.head + 1.25;
      const bays: [number, number][] = [[-20, -13.25], [-13.25, -6.5], [-6.5, 6.5], [6.5, 13.25], [13.25, 20]];
      for (const [x0, x1] of bays) {
        const w = x1 - x0, mx = (x0 + x1) / 2;
        // 隔扇扇宽同样受 ×6.0 影响：世界 ≤2m ⇒ 扇宽 ≤0.333m 预缩放（旧 1.1 会到 6.6m）
        const leaves = Math.max(8, Math.round(w / 0.32));
        for (let i = 0; i <= leaves; i++) {
          b.box('wood', 0.045, yTop - yBot, 0.12, x0 + (w * i) / leaves, (yBot + yTop) / 2, fz, GOLD_TRIM);
        }
        for (const yy of [yBot, yBot + (yTop - yBot) * 0.62, yTop]) {
          b.box('wood', w, 0.13, 0.14, mx, yy, fz, GOLD_TRIM);
        }
        const gy0 = yBot + (yTop - yBot) * 0.12, gy1 = yBot + (yTop - yBot) * 0.62;
        const n = Math.max(5, Math.round(w / 0.34));
        for (let i = 0; i < n; i++) {
          b.box('wood', 0.055, gy1 - gy0, 0.1, x0 + (w * (i + 0.5)) / n, (gy0 + gy1) / 2, fz, shade(GOLD_TRIM, 1.16));
        }
        b.box('wood', w, gy0 - yBot, 0.12, mx, (yBot + gy0) / 2, fz + 0.01, shade(0xa82c18, 0.95));
      }
    }
  }
  // 墙面金色装饰线（走马板下沿；上沿那条由匾额压住，已删）
  b.box('wood', 40, 0.5, 0.3, palace.x, palace.y + 8, palace.z - 11.2, GOLD_TRIM);
  // ④ 柱网 14 根蟠龙金柱：前后檐各 6（5 开间）+ 东西山面各 1（中柱），φ0.95、高 10.6m。
  //   柱心落在 40×22 的殿身线上（与文档通面阔/进深同数），故前后檐柱半嵌墙身、明间两根立于门洞中。
  //   W24：柱高 9 → 10.6（柱顶 229.40 = 额枋底），缠龙环间距同步由 1.7 放到 1.95，五道仍匀布柱身。
  const column = (cx: number, cz: number, ox: number, oz: number): void => {
    b.cyl('ash', 0.6, 0.66, 0.34, 10, cx, FLR + 0.17, cz, shade(MB, 0.94));       // 汉白玉柱础
    b.cyl('wood', 0.475, 0.475, 10.6, 10, cx, FLR + 5.3, cz, JIN);                 // 金柱 φ0.95 高 10.6
    for (let k = 0; k < 5; k++) b.cyl('wood', 0.5, 0.5, 0.18, 10, cx, FLR + 1.5 + k * 1.95, cz, JIND); // 缠龙暗环 ×5
    b.cyl('wood', 0.56, 0.56, 0.34, 10, cx, FLR + 10.28, cz, shade(JIN, 0.72));    // 柱头箍
    b.box('wood', 0.34, 0.3, 0.5, cx + ox * 0.52, FLR + 5.3, cz + oz * 0.52, shade(JIN, 1.08)); // 龙头
    b.box('wood', 0.24, 0.46, 0.36, cx + ox * 0.42, FLR + 4.7, cz + oz * 0.42, JIND);           // 龙身
  };
  for (const sx of CXS) for (const sz of [-1, 1]) column(palace.x + sx, palace.z + sz * CZ, 0, sz);
  for (const sx of [-1, 1]) column(palace.x + sx * 20, palace.z, sx, 0);
  // ⑤ 额枋：断面 0.9×0.6，沿 14 根柱顶一圈；和玺彩画青绿底 + 上下金线（W24 基准抬到 229.85）
  const arch = (len: number, cx: number, cz: number, ry: number): void => {
    b.box('wood', len, 0.9, 0.6, cx, FLR + 11.05, cz, PAINT, ry);
    b.box('wood', len + 0.1, 0.14, 0.64, cx, FLR + 11.42, cz, shade(PAINT, 1.5), ry);
    b.box('wood', len + 0.1, 0.14, 0.64, cx, FLR + 10.68, cz, shade(PAINT, 1.5), ry);
  };
  arch(41.2, palace.x, palace.z + CZ, 0);
  arch(41.2, palace.x, palace.z - CZ, 0);
  arch(23.2, palace.x + 20, palace.z, Math.PI / 2);
  arch(23.2, palace.x - 20, palace.z, Math.PI / 2);
  // ⑥ 斗栱密排（W23）：旧版是一柱一攒的 14 片 0.5 厚贴墙薄片，侧看只有薄薄一层；
  //   现沿 41.2×23.2 额枋外皮 1.2m 一攒 → 2·round((41.2+23.2)/1.2) = 108 攒，
  //   栌斗贴柱头外皮、两跳华栱外挑面 0.44/0.66、下昂斜置顶到檐口——侧视有进深，「密排」才读得出来。
  skyDougongRing(b, palace.x, 230.91, palace.z, 41.2, 23.2, 0, 1.2, GOLD_TRIM);
  // ⑦ 和玺彩画带（W23）：额枋外皮 0.42m 青绿底 + 每 2.4m 一道金线，露出在攒与攒之间的 0.6–0.9m 缝里
  skyCaihuaBand(b, palace.x, FLR + 11.05, palace.z, 40.6, 22.6, 0);
  // ⑦ 下檐 + 上檐 = 重檐叠檐（W23 → W24）：下檐 52×32（基准 230.91、举高 3.24）→
  //   层间 12 根短柱 + 额枋 → 上檐 40×25.2（基准 235.41、举高 4.37、正脊 239.78）。
  //   W23 的上檐按 0.74/0.72 递推只有 38.5×23，檐口 35.5×21.3 对 34×20 上层殿身只挑 0.76/0.64m，
  //   远看仍是一顶金盖；W24 用 top 覆写把上檐撑到檐口 36.9×23.3（出檐 1.44/1.63m），
  //   两层檐高低差 3.72 → 4.50m，「上檐短、下檐长」的层次才立得住。
  //   端坡/四垂脊 10 段贴面/瓦垄/瓦当滴水/脊兽仍全部由 skyRoofOn 出。
  skyStackedRoof(b, palace.x, 230.91, palace.z, 52, 32, 2, 4.5, 0, 'wudian', GOLD_ROOF, GOLD_TRIM,
    { w: 40, d: 25.2 });
  // 上檐斗栱密排：栌斗外皮贴上层殿身（34×20）外皮 → 2·round((34.3+20.3)/1.2) = 92 攒
  skyDougongRing(b, palace.x, 235.41, palace.z, 34.3, 20.3, 0, 1.2, GOLD_TRIM);
  // ⑧ 上层殿身：34×20 朱红围脊墙（231.55–235.41），盖住下檐正脊（234.15）与两端鸱吻，再由上檐压住——
  //   「重檐」的重在这一层；上檐檐口 36.9×23.3，比墙身出挑 1.44/1.63m；
  //   层间短柱（18.2×11.4，12 根）落在墙外 1.2m 的下檐屋面上，柱头与上檐栌斗对位
  b.box('wood', 34, 3.86, 20, palace.x, 233.48, palace.z, shade(0xd2381f, 1.0));
  b.box('wood', 34.5, 0.34, 20.5, palace.x, 235.75, palace.z, PAINT);              // 上层额枋
  b.box('wood', 34.6, 0.14, 20.6, palace.x, 235.97, palace.z, GOLD_TRIM);          // 上金线
  // 上层支摘窗：**硬指标 —— 世界口径 ≤2m**。
  // 凌霄殿整块选区被 2.2× 与 2.7273× 连乘 = **×6.0**，所以预缩放尺寸必须 ≤ 2/6 = 0.333m。
  // 旧版 7 扇 ×1.4m（世界 8.4m）→ 上一版改到 0.92m（世界 5.5m）都仍然超标，本版收到 0.32m。
  const WIN = 0.32;
  const NP = 53;   // 34m 面阔 / 0.64m 轴距
  for (let i = 0; i < NP; i++) {
    const wx = palace.x - 17 + (i + 0.5) * (34 / NP);
    for (const sz of [-1, 1]) b.box('wood', WIN, WIN, 0.2, wx, 233.4, palace.z + sz * 10, 0x2a1a10);
  }
  const NPZ = 31;  // 20m 进深 / 0.64m 轴距
  for (let i = 0; i < NPZ; i++) {
    const wz = palace.z - 10 + (i + 0.5) * (20 / NPZ);
    for (const sx of [-1, 1]) b.box('wood', 0.2, WIN, WIN, palace.x + sx * 17, 233.4, wz, 0x2a1a10);
  }
  // ⑨ 上檐已由 ⑦ 的 skyStackedRoof 顶层一次出齐（庑殿 40×25.2、正脊 12.6m、鸱吻 1.2m、
  //   w≥18 的脊兽），此段不再单开一层屋顶；正脊顶 239.78+0.31 = 240.09，宝顶座 240.04 正好压上。
  // ⑨ 宝顶：鎏金葫芦 2.5m（座 0.3 + 下球 0.85 + 束腰 0.3 + 上球 0.6 + 尖 0.42）
  b.cyl('metal', 0.88, 1.0, 0.42, 10, palace.x, 240.25, palace.z, shade(GOLD_ROOF, 0.82));
  b.cyl('metal', 0.64, 0.8, 0.85, 10, palace.x, 240.87, palace.z, GOLD_ROOF);
  b.cyl('metal', 0.34, 0.48, 0.3, 8, palace.x, 241.44, palace.z, shade(GOLD_ROOF, 1.12));
  b.cyl('metal', 0.46, 0.36, 0.6, 10, palace.x, 241.89, palace.z, GOLD_ROOF);
  b.cyl('metal', 0.08, 0.2, 0.42, 8, palace.x, 242.4, palace.z, shade(GOLD_ROOF, 1.2));
  // ⑩ 檐角走兽 10 件（0.2m 蹲兽，只在下檐四角，沿垂脊下段 3+3+2+2）
  //   下檐基准 230.91 / 举高 3.24（W24 起），坡面半宽仍 52×32 → 48.0 / 29.54
  const hipAt = (su: number, sdz: number, t: number): [number, number, number] => {
    const e = Math.pow(t, 1.6), hh = 0.16 + 0.34 * e;
    return [palace.x + su * hh * 48, 230.91 + (1 - e + 0.16 * t * t * t + 0.15 * t * t) * 3.24, palace.z + sdz * hh * 29.54];
  };
  for (const [su, sdz, ts] of [[1, 1, [0.84, 0.88, 0.92]], [-1, 1, [0.84, 0.88, 0.92]],
    [1, -1, [0.86, 0.9]], [-1, -1, [0.86, 0.9]]] as [number, number, number[]][]) {
    for (const t of ts) {
      const [hx, hy, hz] = hipAt(su, sdz, t);
      const yaw2 = Math.atan2(su * 48, sdz * 29.54);
      b.box('roof', 0.2, 0.2, 0.2, hx, hy + 0.3, hz, shade(GOLD_TRIM, 0.92), yaw2);
      b.box('roof', 0.13, 0.14, 0.13, hx, hy + 0.47, hz, shade(GOLD_TRIM, 1.1), yaw2);
    }
  }
  // ⑪ 匾额：13m×2.6m「凌霄寶殿」，悬明间额枋之下、门洞上方（明间净宽 13m，两侧金柱正好夹住）
  // W48：随殿门翻到 −z 面，招牌转 180°（SignMesher 的 ry=π 让正面朝南天门）
  sg.quad(atlas.text('lingxiao', '凌霄寶殿', 640, 152, { color: '#ffe9b8', glow: '#ffd25e', bg: 'rgba(12,8,4,0.92)', border: 'rgba(255,210,94,.95)', fontPx: 104 }), 13, 2.6, palace.x, FLR + 7.8, palace.z - 11.32, Math.PI);
  b.box('wood', 13.5, 0.24, 0.16, palace.x, FLR + 9.18, palace.z - 11.36, GOLD_TRIM);
  b.box('wood', 13.5, 0.24, 0.16, palace.x, FLR + 6.42, palace.z - 11.36, GOLD_TRIM);
  for (const sx of [-1, 1]) b.box('wood', 0.26, 2.76, 0.16, palace.x + sx * 6.62, FLR + 7.8, palace.z - 11.36, GOLD_TRIM);
  // 丹墀（玉帝早朝班位）——W48 迁到世界坐标前庭段（原预缩放坐标会被 2.7273× 拉成 54m 长条）

  // ================= W48：凌霄宫殿前区（宫台 / 大台阶 / 前庭）—— 世界坐标直写 =================
  // 本段之外的凌霄殿几何走「预缩放坐标 → 2.2× → 2.7273×」；宫台/台阶/前庭是承托放大后
  // 288×145.2m 台基的新构件，必须按**最终世界尺寸**落位。若也写预缩放坐标，它们会被
  // 2.7273× 再拉一遍（旧前庭铺装/旌旗/香炉正是这样被撕成 50m 长条的）。
  // HW 逆变换把世界坐标换回烘焙坐标：这些点全在 k 选区之外，只吃 2.2×。
  const HW = 2.2;
  const wx = (v: number): number => v / HW;
  const wy = (v: number): number => 196 + (v - 196) / HW;
  const wz = (v: number): number => v / HW;
  /** 世界坐标盒（尺寸按世界口径给，内部折回烘焙坐标） */
  const WB = (g: BGroup, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void => {
    b.box(g, w / HW, h / HW, d / HW, wx(x), wy(y), wz(z), hex, ry, rx, rz);
  };
  const WC = (g: BGroup, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void => {
    b.cyl(g, rt / HW, rb / HW, h / HW, seg, wx(x), wy(y), wz(z), hex, ry, rx, rz);
  };
  const LXK = 2.7273;
  const W_DECK = 196 + (palace.y + 0.12 - 196) * HW;                    // 235.86 宫台面（= 2.2× 云台面）
  const W_TOP = 233 + (196 + (palace.y + 4.8 - 196) * HW - 233) * LXK;  // 268.89 台明顶（= 放大后台基顶）
  const W_BASE_FRONT = 209 + ((palace.z - 12.1) * HW - 209) * LXK;      // 136.44 台基南缘（顶层台明前缘）
  const GS = 6.0;                                                       // 设计尺寸 → 世界（2.2 × 2.7273）
  const JADE = 0xd8d0c0, GOLDV = GOLD_TRIM;

  // ① 宫台：300×153.6 矩形浮台，承住放大后 288×145.2 的台基（南缘与台基南缘齐平）
  WB('ash', 300, 1.4, 153.6, 0, W_DECK - 0.7, 213.4, shade(0x8f8a80, 1.04));  // 台面
  WB('ash', 304, 1.6, 157.6, 0, W_DECK - 2.2, 213.4, shade(0x827d76, 0.98));  // 上枭
  WB('ash', 308, 2.4, 161.6, 0, W_DECK - 4.2, 213.4, shade(0x6f6b66, 0.96));  // 束腰
  WB('ash', 312, 2.8, 165.6, 0, W_DECK - 6.8, 213.4, shade(0x77726c, 0.94));  // 下枋
  // 岩体三级收口，沉进云海面（197）以下——读作浮岛而不是薄盘
  WB('ash', 296, 7, 152, 0, W_DECK - 11.7, 213.4, shade(0x6a6660, 0.98));
  WB('ash', 274, 9, 140, 0, W_DECK - 19.7, 213.4, shade(0x605c57, 0.96));
  WB('ash', 248, 11, 124, 0, W_DECK - 30.2, 213.4, shade(0x57534f, 0.98));
  WB('ash', 206, 15, 102, 0, W_DECK - 43.2, 213.4, shade(0x4f4c48, 0.96));
  // 宫台缘云团：把矩形岩台接进云海（cloudBall 是攒批云的公共入口，与本岛既有云团同源）
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const cx2 = -150 + 300 * t;
    cloudBall(b, cx2, W_DECK - 20 - (i % 3) * 3, 137.5, 15 + (i % 4) * 3, 700 + i);
    cloudBall(b, cx2, W_DECK - 22 - (i % 3) * 3, 289.5, 15 + ((i + 2) % 4) * 3, 730 + i);
  }
  b.kit('palace.podium', 8, W_DECK);

  // ② 前庭平台：112×46，南缘 95.6（让开斗法云台北缘 96.8），北接宫台
  WB('ash', 112, 1.2, 46, 0, W_DECK - 0.6, 118.6, shade(0x9a948a, 1.04));
  WB('ash', 116, 1.4, 50, 0, W_DECK - 1.9, 118.6, shade(0x86817a, 0.99));
  WB('ash', 120, 2.4, 54, 0, W_DECK - 3.8, 118.6, shade(0x726e69, 0.96));
  WB('ash', 112, 6, 46, 0, W_DECK - 8, 118.6, shade(0x64605b, 0.98));
  WB('ash', 96, 8, 38, 0, W_DECK - 15, 118.6, shade(0x5a5753, 0.96));
  WB('ash', 76, 10, 30, 0, W_DECK - 24, 118.6, shade(0x524f4c, 0.98));
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    cloudBall(b, -50 + 100 * t, W_DECK - 19 - (i % 3) * 2, 96.5, 12 + (i % 3) * 3, 760 + i);
  }
  b.kit('palace.forecourt', 6, W_DECK);

  // ③ 前庭栏杆：望柱 + 两道寻杖（世界尺度 6m 高，与台基栏杆同档）；南缘中段让开 40m 台阶口
  const gpost = (px: number, pz: number, y0: number): void => {
    WB('ash', 0.9, 5.6, 0.9, px, y0 + 2.8, pz, shade(0xcfc8b8, 1.04));
    WB('ash', 1.3, 0.6, 1.3, px, y0 + 5.9, pz, shade(0xded6c4, 1.1));
  };
  const grail = (ax: number, az: number, bx: number, bz: number, y0: number): void => {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const ry = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / 9));
    for (let i = 0; i <= n; i++) gpost(ax + (dx * i) / n, az + (dz * i) / n, y0);
    WB('ash', len, 0.5, 0.34, (ax + bx) / 2, y0 + 4.9, (az + bz) / 2, shade(0xd6cfbe, 1.02), ry);
    WB('ash', len, 0.4, 0.28, (ax + bx) / 2, y0 + 2.6, (az + bz) / 2, shade(0xc8c1b0, 0.98), ry);
  };
  grail(-56, 95.9, -21, 95.9, W_DECK);
  grail(21, 95.9, 56, 95.9, W_DECK);
  grail(-56, 95.9, -56, 136.2, W_DECK);
  grail(56, 95.9, 56, 136.2, W_DECK);
  b.kit('palace.forecourtRail', 4);

  // ④ 大台阶 36 级：台明顶 268.89 → 宫台面 235.86，跑 39.8m（37°），踏面 1.10 / 踢面 0.92
  const NSTEP = 36;
  const zTop = W_BASE_FRONT, zBot = 96.6;
  const RUN = (zTop - zBot) / NSTEP, RISE = (W_TOP - W_DECK) / NSTEP;
  for (let i = 0; i < NSTEP; i++) {
    const yTop = W_TOP - i * RISE;
    WB('ash', 40, yTop - W_DECK, RUN, 0, (W_DECK + yTop) / 2, zTop - (i + 0.5) * RUN,
      shade(0xcfc8b8, i % 2 ? 1.0 : 1.05));
  }
  b.kit('palace.grandStair', NSTEP, W_DECK);
  // 御路石 + 云龙浮雕 8 段（整块斜板，坡度与踏步一致）
  const SANG = Math.atan2(W_TOP - W_DECK, zTop - zBot);
  const SLOPE = Math.hypot(zTop - zBot, W_TOP - W_DECK) + 1.2;
  WB('ash', 7, 1.0, SLOPE, 0, (W_TOP + W_DECK) / 2 + 1.0, (zTop + zBot) / 2, shade(0xded6c4, 1.08), 0, -SANG, 0);
  for (let k = 0; k < 8; k++) {
    const t = (k + 0.5) / 8;
    WB('ash', 5.0, 0.28, 2.6, 0, W_DECK + (W_TOP - W_DECK) * t + 1.55, zBot + (zTop - zBot) * t,
      shade(0xb8b09e, 0.9), 0, -SANG, 0);
  }
  for (const s2 of [-1, 1]) {
    WB('ash', 2.4, 1.2, SLOPE, s2 * 21.2, (W_TOP + W_DECK) / 2 + 1.6, (zTop + zBot) / 2, shade(0xe6dece, 1.1), 0, -SANG, 0);
  }
  // 台阶两侧望柱（10 对）+ 斜寻杖两道
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const pz = zBot + (zTop - zBot) * t, py = W_DECK + (W_TOP - W_DECK) * t;
    for (const s2 of [-1, 1]) {
      WB('ash', 1.0, 6.2, 1.0, s2 * 23.4, py + 3.1, pz, shade(0xd6cfbe, 1.06));
      WB('ash', 1.4, 0.6, 1.4, s2 * 23.4, py + 6.5, pz, shade(0xe6dece, 1.12));
    }
  }
  for (const s2 of [-1, 1]) {
    WB('ash', 0.7, 0.7, SLOPE, s2 * 23.4, (W_TOP + W_DECK) / 2 + 5.2, (zTop + zBot) / 2, shade(0xded6c4, 1.04), 0, -SANG, 0);
    WB('ash', 0.6, 0.6, SLOPE, s2 * 23.4, (W_TOP + W_DECK) / 2 + 3.4, (zTop + zBot) / 2, shade(0xd2cbb9, 1.0), 0, -SANG, 0);
  }
  b.kit('palace.stairRail', 20, W_DECK);

  // ⑤ 前庭铺装：104×40 玉墁地 + 分缝 + 御路金线（夹出 21.6m 中央朝觐通道）
  WB('ash', 104, 0.14, 40, 0, W_DECK + 0.07, 118, shade(0xd0c8b8, 1.0));
  for (let xl = -48; xl <= 48; xl += 8) WB('ground', 0.5, 0.06, 40, xl, W_DECK + 0.15, 118, shade(0x6e5e40, 0.5));
  for (let zl = 100; zl <= 136; zl += 8) WB('ground', 104, 0.06, 0.5, 0, W_DECK + 0.15, zl, shade(0x6e5e40, 0.5));
  b.kit('palace.paving', 1, W_DECK);
  b.kit('palace.pavingJoint', 19, W_DECK + 0.15);
  for (const s2 of [-1, 1]) WB('glow', 0.6, 0.1, 40, s2 * 10.8, W_DECK + 0.19, 118, GOLD_LINE);
  b.kit('palace.royalLine', 2, W_DECK + 0.19);

  // ⑥ 品级山：8 对石标（当朝班位），沿御路两侧错列
  for (let i = 0; i < 8; i++) {
    const pz = 102 + i * 4.5;
    for (const s2 of [-1, 1]) {
      const px = s2 * (27 + (i % 2) * 13);
      WB('ash', 2.0, 1.0, 2.0, px, W_DECK + 0.5, pz, shade(0xa8a190, 1.02));
      WB('ash', 1.4, 2.8, 1.4, px, W_DECK + 2.4, pz, shade(0xbdb6a4, 1.06));
      WB('ash', 1.7, 0.34, 1.7, px, W_DECK + 3.9, pz, shade(0xd0c8b8, 1.1));
    }
  }
  b.kit('palace.rankStone', 16, W_DECK);

  // ⑦ 旌旗：石座 + 旗杆 + 旗面 + 飘带 + 顶饰（按 GS 放大到世界尺度，顶饰 ≤ 台明顶）
  const wBanner = (bx: number, bz: number, sd: number, cloth: number, kit: string): void => {
    WB('ash', 0.9 * GS, 0.3 * GS, 0.9 * GS, bx, W_DECK + 0.15 * GS, bz, shade(0x8a8298, 1.06));
    WC('wood', 0.1 * GS, 0.15 * GS, 3.0 * GS, 6, bx, W_DECK + 1.8 * GS, bz, shade(0x5a3a24, 1.05));
    WB('fabric', 1.15 * GS, 1.42 * GS, 0.06 * GS, bx + 0.58 * GS * sd, W_DECK + 2.6 * GS, bz, cloth);
    WB('fabric', 0.34 * GS, 0.6 * GS, 0.05 * GS, bx + 1.0 * GS * sd, W_DECK + 1.86 * GS, bz, shade(cloth, 0.78));
    WC('metal', 0.11 * GS, 0.15 * GS, 0.16 * GS, 6, bx, W_DECK + 3.34 * GS, bz, shade(GOLDV, 1.05));
    WB('glow', 0.14 * GS, 0.14 * GS, 0.14 * GS, bx, W_DECK + 3.48 * GS, bz, 0xffd25e, 0, 0, Math.PI / 4);
    b.kit(kit, 1, W_DECK + 2.6 * GS);
  };
  // ⑧ 戟架：石脚 + 双柱 + 上下横枋 + n 杆戟（横刃 + 戟尖 + 红缨）
  const wHalberdRack = (hx: number, hz: number, n: number, kit: string): void => {
    const w = (0.6 + n * 0.42) * GS;
    WB('ash', w + 0.5 * GS, 0.22 * GS, 0.9 * GS, hx, W_DECK + 0.11 * GS, hz, shade(0x8a8298, 1.05));
    for (const s2 of [-1, 1]) WB('wood', 0.18 * GS, 2.1 * GS, 0.18 * GS, hx + s2 * (w / 2), W_DECK + 1.05 * GS, hz, shade(0x5a3a24, 1.02));
    WB('wood', w + 0.2 * GS, 0.14 * GS, 0.14 * GS, hx, W_DECK + 2.0 * GS, hz, shade(0x5a3a24, 1.12));
    WB('wood', w + 0.2 * GS, 0.12 * GS, 0.12 * GS, hx, W_DECK + 0.5 * GS, hz, shade(0x4a2e1c, 1));
    for (let k = 0; k < n; k++) {
      const ax = hx - w / 2 + (k + 0.5) * (w / n);
      WB('wood', 0.07 * GS, 2.5 * GS, 0.07 * GS, ax, W_DECK + 1.25 * GS, hz, shade(0x6b4a2b, 1.06));
      WB('metal', 0.34 * GS, 0.26 * GS, 0.06 * GS, ax + 0.16 * GS, W_DECK + 2.36 * GS, hz, 0x9aa6b8, 0, 0, -0.25);
      WB('metal', 0.06 * GS, 0.34 * GS, 0.06 * GS, ax, W_DECK + 2.5 * GS, hz, 0xb8c0c8);
      WB('fabric', 0.16 * GS, 0.3 * GS, 0.04 * GS, ax, W_DECK + 2.0 * GS, hz + 0.06 * GS, 0xa02818);
    }
    b.kit(kit, 1, W_DECK + 1.1 * GS);
  };
  // ⑨ 大鼓（庙鼓尺度 × GS）：双立柱鼓架 + 抱鼓墩 + 朱漆鼓身 + 牛皮双面 + 两圈鼓钉 + 鼓槌
  // 反光（用户点名）：鼓身走 wood 组（roughness 0.82 / metalness 0.03 / 无清漆），
  // 天宫强光下不会沿鼓身拉出镜面高光带；鼓面走 fabric（roughness 0.92 + sheen 0.25）。
  const wDrum = (dx2: number, dz2: number, kit: string): void => {
    const R = 0.55 * GS, HALF = 0.43 * GS, AXLE = 1.0 * GS;
    for (const s2 of [-1, 1]) {
      WB('wood', 0.3 * GS, 0.16 * GS, 0.94 * GS, dx2 + s2 * 0.76 * GS, W_DECK + 0.08 * GS, dz2, shade(0x4a2e1c, 1.0));
      WB('wood', 0.18 * GS, AXLE, 0.2 * GS, dx2 + s2 * 0.76 * GS, W_DECK + AXLE / 2 + 0.08 * GS, dz2, shade(0x5a3a24, 1.06));
      WB('metal', 0.24 * GS, 0.1 * GS, 0.26 * GS, dx2 + s2 * 0.76 * GS, W_DECK + AXLE + 0.13 * GS, dz2, shade(GOLDV, 0.9));
    }
    WB('wood', 1.6 * GS, 0.12 * GS, 0.14 * GS, dx2, W_DECK + 0.2 * GS, dz2, shade(0x4a2e1c, 1.02));
    WC('wood', R, R, HALF * 2, 16, dx2, W_DECK + AXLE, dz2, 0xa8321f, 0, 0, Math.PI / 2);
    for (const s2 of [-1, 1]) {
      WC('fabric', R * 0.94, R * 0.94, 0.08 * GS, 16, dx2 + s2 * (HALF - 0.04 * GS), W_DECK + AXLE, dz2, 0x7a6349, 0, 0, Math.PI / 2);
      WC('wood', R * 1.04, R * 1.04, 0.12 * GS, 16, dx2 + s2 * (HALF * 0.72), W_DECK + AXLE, dz2, shade(0x5e1a12, 1.0), 0, 0, Math.PI / 2);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const s2 of [-1, 1]) {
        WB('metal', 0.1 * GS, 0.1 * GS, 0.06 * GS, dx2 + Math.cos(a) * R * 0.72, W_DECK + AXLE + Math.sin(a) * R * 0.72, dz2 + s2 * (HALF + 0.03 * GS), 0xb08a3c);
      }
    }
    b.kit(kit, 1, W_DECK + AXLE);
  };
  // ⑩ 铜香炉：石座 + 三足 + 炉身 + 炉口 + 炉盖 + 双耳 + 香火
  const wCenser = (cx2: number, cz2: number, kit: string): void => {
    WC('ash', 0.62 * GS, 0.72 * GS, 0.3 * GS, 8, cx2, W_DECK + 0.15 * GS, cz2, shade(JADE, 0.94));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.5;
      WC('metal', 0.09 * GS, 0.11 * GS, 0.5 * GS, 6, cx2 + Math.cos(a) * 0.32 * GS, W_DECK + 0.5 * GS, cz2 + Math.sin(a) * 0.32 * GS, 0x7a6230);
    }
    WC('metal', 0.46 * GS, 0.38 * GS, 0.62 * GS, 12, cx2, W_DECK + 1.05 * GS, cz2, 0x8a6a2e);
    WC('metal', 0.5 * GS, 0.5 * GS, 0.08 * GS, 12, cx2, W_DECK + 1.4 * GS, cz2, 0xb08a3c);
    WC('metal', 0.34 * GS, 0.46 * GS, 0.34 * GS, 12, cx2, W_DECK + 1.6 * GS, cz2, 0x8a6a2e);
    for (const s2 of [-1, 1]) WB('metal', 0.12 * GS, 0.3 * GS, 0.08 * GS, cx2 + s2 * 0.4 * GS, W_DECK + 1.42 * GS, cz2, 0xb08a3c, 0, 0, s2 * 0.35);
    WC('glow', 0.16 * GS, 0.1 * GS, 0.34 * GS, 6, cx2, W_DECK + 1.9 * GS, cz2, GOLD_LINE);
    b.kit(kit, 1, W_DECK + 1.05 * GS);
  };
  // 布点：御路两侧三件一列（香炉 / 大鼓 / 戟架），旌旗向外两排
  for (const s2 of [-1, 1]) {
    wCenser(s2 * 32, 103, 'palace.censer');
    wDrum(s2 * 32, 113, 'palace.drum');
    wHalberdRack(s2 * 32, 124, 3, 'palace.halberdRack');
  }
  for (const [ax2, az2] of [[40, 100], [49, 112], [40, 124], [49, 134]] as const) {
    wBanner(ax2, az2, 1, 0xa02818, 'palace.banner');
    wBanner(-ax2, az2, -1, 0x2a4a7a, 'palace.banner');
  }
  // 丹墀：5 级石阶（玉帝早朝班位），压在台阶南端与御路之间
  for (let s2 = 0; s2 < 5; s2++) {
    WB('wall', 60 - s2 * 3.2, 1.2, 4.6, 0, W_DECK + 0.6 - s2 * 0.24, 99.4 - s2 * 1.6, shade(0x8a8298, 1 - s2 * 0.04));
  }
  b.kit('palace.danchi', 5, W_DECK);
  // 蟠桃园
  platform(pantao.x, pantao.y, pantao.z, 27);
  // 蟠桃树（重做）：旧版是「木棍 + 一个粉圆锥 + 三个发光方块」，那就是一只路灯罩。
  // 现在是：三段落差树干 → 3 主枝 → 8 团球冠（深绿）→ 10 团淡粉花簇 → 6 枚桃实（带高光）→ 树下落花。
  // 花簇/桃实/落花走 ceramic 器物组（Physical 釉面 + 有 UV），不再跟叶片共用材质。
  // 花/果专用球：sphere() 的 UV 是 0.24/m 世界展开 —— 一颗 0.9m 的花只采到 256² 贴图的 24%，
  // 斑与瓣脉全被稀释成纯色。这里改成对象空间 2.4× 平铺（一颗果读 2–3 张图），
  // 器物仍走各自的世界展开，观感不受影响。
  // 瓣/缝的明暗写进顶点色：共用 albedo 必须保持中性（全城器物也用它），粉色细节只能落在几何上。
  const bloom = (mode: 'blossom' | 'peach', r: number, seg: number, x: number, y: number, z: number, hex: number, ry: number, sx = 1, sy = 1, sz = 1): void => {
    const geo = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6)));
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.4, uv.getY(i) * 2.4);
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ny = THREE.MathUtils.clamp(pos.getY(i) / r, -1, 1);
      const th = Math.atan2(pos.getZ(i), pos.getX(i));
      let k: number;
      if (mode === 'blossom') {
        k = 0.94 + 0.07 * Math.cos(th * 5) * Math.sin(Math.acos(ny));
        k *= 0.90 + 0.10 * (ny + 1) * 0.5;
      } else {
        let d = th - 1.2;
        d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
        k = (1 - 0.10 * Math.exp(-(d * d) / 0.05)) * (0.95 + 0.05 * Math.cos(th - 0.6));
        k *= 0.94 + 0.06 * (ny + 1) * 0.5;
      }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.addGeo('ceramic', geo, x, y, z, hex, ry, 0, 0, sx, sy, sz);
  };
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const px = pantao.x + Math.cos(a) * 15, pz = pantao.z + Math.sin(a) * 11;
    // 尺度：原树高 ~5m / 岛径 54m（比 0.09），特写里只有「灌木」感。按 0.25–0.35 目标放大 2.8×，
    // 树高 ~14m、冠幅 ~8m，桃实 0.56m 可辨。所有尺寸都挂在 s 上，改这一处即可整体缩放。
    const s = (0.92 + (i % 3) * 0.1) * 2.8;
    const lean = Math.sin(i * 2.1) * 0.06;
    b.cyl('trunk', 0.26 * s, 0.42 * s, 1.0 * s, 7, px, pantao.y + 0.5 * s, pz, 0x6b4a2e, 0, 0, lean * 0.3);
    b.cyl('trunk', 0.17 * s, 0.26 * s, 1.0 * s, 7, px + lean * 0.5 * s, pantao.y + 1.45 * s, pz, 0x5f4129, 0, 0, lean * 0.7);
    b.cyl('trunk', 0.1 * s, 0.17 * s, 0.9 * s, 6, px + lean * 1.0 * s, pantao.y + 2.35 * s, pz, 0x553a25, 0, 0, lean);
    b.cyl('trunk', 0.46 * s, 0.62 * s, 0.24 * s, 8, px, pantao.y + 0.12 * s, pz, 0x5a3e28);
    for (let k = 0; k < 3; k++) {
      const ba = a + (k / 3) * Math.PI * 2 + 0.4;
      b.cyl('trunk', 0.05 * s, 0.1 * s, 1.3 * s, 5,
        px + Math.cos(ba) * 0.48 * s, pantao.y + 2.5 * s, pz + Math.sin(ba) * 0.48 * s, 0x5a3f28,
        -ba, Math.cos(ba) * 0.5, -Math.sin(ba) * 0.5);
    }
    const clumps: [number, number, number, number][] = [
      [0, 3.7, 0, 1.5], [1.25, 3.4, 0.3, 1.15], [-1.15, 3.45, 0.5, 1.1],
      [0.4, 3.35, -1.2, 1.05], [-0.55, 3.6, -0.95, 1.0], [0.95, 4.2, 0.6, 0.88],
      [-0.8, 4.25, -0.35, 0.85], [0.1, 4.65, 0.15, 0.72],
    ];
    clumps.forEach(([ox, oy, oz, r], ci) => {
      b.sphere('leaf', r * s, 8, px + ox * s, pantao.y + oy * s, pz + oz * s, shade(ci % 2 === 0 ? 0x3f6a3c : 0x4a7a44, 0.94 + (ci % 3) * 0.06));
    });
    for (let k = 0; k < 10; k++) {
      const fa = (k / 10) * Math.PI * 2 + a;
      const fr = (1.35 + (k % 3) * 0.25) * s;
      const cy = pantao.y + (3.35 + (k % 4) * 0.34) * s;
      const cx = px + Math.cos(fa) * fr, cz = pz + Math.sin(fa) * fr;
      // 花簇迁 ceramic：leaf 组带暗绿 emissive、且没有 UV 缓冲（leafTex 只采到一个常数像素），
      // 粉花在 leaf 里永远发灰发绿。
      // 每簇 3 瓣球（r=0.16–0.20s ⇒ 0.41–0.63m），错位 0.12–0.16s ⇒ 簇包络 0.28–0.36s
      // （0.72–1.13m，与旧单球 0.32s 同量级）。单球在清漆高光下读成「粉色气球」；
      // 三瓣一簇的剪影才是花，远看仍是原来的粉色团块。
      for (let j = 0; j < 3; j++) {
        const la = fa + j * 2.0944;
        const lo = (0.12 + j * 0.02) * s;
        bloom('blossom', (0.16 + ((k + j) % 3) * 0.02) * s, 20,
          cx + Math.cos(la) * lo, cy + (j === 1 ? 0.04 : -0.02) * s, cz + Math.sin(la) * lo,
          (k + j) % 3 === 0 ? 0xe695b4 : 0xdd7fa1, la);
      }
    }
    b.kit('pantao.blossom', 10, pantao.y + 3.35 * s);
    for (let k = 0; k < 6; k++) {
      const fa = (k / 6) * Math.PI * 2 + a * 1.7;
      const fx = px + Math.cos(fa) * 1.1 * s, fz = pz + Math.sin(fa) * 1.1 * s;
      const fy = pantao.y + (2.75 + (k % 3) * 0.3) * s;
      // 桃实：半径 0.2s（0.52–0.63m），压成扁球（横 1.12×、竖 0.94×）—— 近景靠剪影就能和圆花簇分开。
      // 16 段球 + 比旧值更深的桃红：扁球棱线在高光下最显眼，段数不足会读成「粉色多面骰子」。
      bloom('peach', 0.2 * s, 16, fx, fy, fz, k % 2 === 0 ? 0xd25f7a : 0xc9526d, fa, 1.12, 0.94, 1.04);
      b.sphere('glow', 0.075 * s, 5, fx + 0.06 * s, fy + 0.11 * s, fz, 0xffd0dc);
    }
    b.kit('pantao.peach', 6, pantao.y + 2.75 * s);
    // 落花同迁 ceramic：地面不再留 leaf 的暗绿自发光小块，花与叶彻底分开。
    for (let k = 0; k < 8; k++) {
      const fa = (k / 8) * Math.PI * 2;
      b.box('ceramic', 0.18 * s, 0.02, 0.11 * s, px + Math.cos(fa) * 1.8 * s, pantao.y + 0.05, pz + Math.sin(fa) * 1.8 * s, k % 2 === 0 ? 0xe8b0c4 : 0xf0c0d0, fa, 0, 0);
    }
    b.kit('pantao.petalFall', 8, pantao.y + 0.05);
  }
  // WS-38：后圈（西侧 idx=3）桃王树挂「九千年桃王挂牌」——金牌红绫，铭「三千六百株之长」
  itmPeachKingTag(b, pantao.x + Math.cos((3 / 7) * Math.PI * 2 + 0.3) * 15, pantao.z + Math.sin((3 / 7) * Math.PI * 2 + 0.3) * 11, pantao.y);
  sg.quad(atlas.text('pantao', '蟠桃園', 300, 84, { color: '#ffd7e4', glow: '#ff9ac8', bg: 'rgba(14,6,10,0.8)', border: 'rgba(255,154,200,.8)', fontPx: 58 }), 6, 1.7, pantao.x, pantao.y + 8.6, pantao.z + 10, 0);
  // 丹房（太上老君）
  platform(furnace.x, furnace.y, furnace.z, 19);
  b.box('wood', 9, 5, 7, furnace.x - 4, furnace.y + 2.5, furnace.z, shade(0x6a5a3e, 1));
  roofOn(b, 11, 9, furnace.y + 5, furnace.x - 4, furnace.z, 0, shade(0x8a6a2a, 1), 0x00e5ff);
  b.cyl('wall', 1.7, 2.1, 3.6, 10, furnace.x + 3.4, furnace.y + 1.8, furnace.z, shade(0x4a3a2e, 1));
  b.cyl('glow', 1.1, 1.4, 0.8, 10, furnace.x + 3.4, furnace.y + 0.6, furnace.z, 0xff7a2d);
  sg.quad(atlas.text('furnace', '兜率宮', 240, 72, { color: '#d8f2ff', glow: '#00e5ff', bg: 'rgba(6,10,14,0.85)', fontPx: 50 }), 5, 1.5, furnace.x - 4, furnace.y + 7.6, furnace.z + 3.6, 0);
  // 莲台（如来/观音）
  const lotusPad = (p: THREE.Vector3, r: number): void => {
    platform(p.x, p.y, p.z, r + 8);
    b.cyl('wall', r, r * 1.15, 1.1, 16, p.x, p.y + 0.55, p.z, shade(0xd8c8a0, 1));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      b.box('wall', 1.6, 0.5, 3.4, p.x + Math.cos(a) * (r + 1.4), p.y + 1.1, p.z + Math.sin(a) * (r + 1.4), i % 2 ? shade(0xe8b8c8, 1) : shade(0xd8a8b8, 1), -a + Math.PI / 2, 0, 0.18);
    }
    b.cyl('glow', r * 0.8, r * 0.8, 0.1, 16, p.x, p.y + 1.14, p.z, 0xffd25e, 0, 0, 0, true);
  };
  lotusPad(lotus, 5);
  lotusPad(lotus2, 3.6);
  // 广寒月台
  platform(moon.x, moon.y, moon.z, 17);
  b.cyl('trunk', 0.2, 0.36, 4.2, 5, moon.x + 5, moon.y + 2.1, moon.z - 3, shade(0x6a5a4a, 1));
  b.cyl('leaf', 1.2, 2.2, 2.4, 7, moon.x + 5, moon.y + 5.2, moon.z - 3, shade(0xd8c878, 1));
  sg.quad(atlas.text('moon', '廣寒宮', 260, 76, { color: '#e8e4ff', glow: '#b26bff', bg: 'rgba(10,8,18,0.8)', border: 'rgba(178,107,255,.7)', fontPx: 52 }), 5.4, 1.6, moon.x, moon.y + 7.6, moon.z + 6, 0);
  // ---- W23：广寒阁（重檐叠顶 + 密排斗栱 + 彩画带）----
  // 月台中央是嫦娥环绕圈（r=6，deities.ts 沿此圆走位），阁退到台北 z=−66：台面 r17、
  // 铺装 r16.4、栏杆 r16.6，阁基 9.4×8.2 的角点 (44.7,−70.1) 距台心 15.7 仍在铺装内，
  // 南沿 z=−61.9 距环绕圈 1.9m；桂树在 (45,−58) 与阁东沿 44.3 让开 0.7m，不压树也不挡匾。
  {
    const GX = 40, GZ = -66, GB = moon.y + 0.12;   // 台面 209.12
    // 门/窗同色是旧版遗留：门用 0x241a18（与武库/将台门一致），窗才用窗洞暗色 0x2a1a10。
    const WALL = shade(0xb8b2a6, 0.98), DOOR = 0x241a18;   // 白玉（清单内的合规白）不改新色
    b.box('ash', 9.4, 0.55, 8.2, GX, GB + 0.275, GZ, shade(0xb8b2a6, 0.9));
    b.box('wall', 8, 3, 6.8, GX, GB + 2.05, GZ, WALL);
    b.box('wood', 8.6, 0.85, 7.4, GX, GB + 3.35, GZ, shade(0x2f5f5a, 1.04));     // 额枋（和玺彩画底）
    b.box('wood', 2.4, 2.6, 0.2, GX, GB + 1.6, GZ + 3.46, DOOR);                 // 南面门
    // 两侧窗：×2.2 档，预缩放上限 0.909m。旧版整块 1.3×1.1 会到 2.86×2.42m；
    // 本版 2×2 分格，每格 0.63×0.53 ×2.2 = 1.39×1.17m ≤2 ✔，格间 0.04（0.09m）木棂。
    for (const s of [-1, 1]) {
      const wx = GX + s * 2.9, wz = GZ + 3.46;
      paneGrid(b, 'wood', 'z', wx, GB + 2.2, wz, 1.3, 1.1, 0.18, 2, 2, 0.04, 0x2a1a10);
      b.box('wood', 0.04, 1.1, 0.05, wx, GB + 2.2, wz + 0.10, shade(0x4a3220, 1.0));
      b.box('wood', 1.3, 0.04, 0.05, wx, GB + 2.2, wz + 0.10, shade(0x4a3220, 1.0));
    }
    skyDougongRing(b, GX, GB + 3.78, GZ, 8.4, 7.2, 0, 1.2, GOLD_TRIM);           // 26 攒
    skyCaihuaBand(b, GX, GB + 3.35, GZ, 8.6, 7.4, 0);
    // 叠顶：下檐 11.4×9.6（檐口 5.26/4.43，斗栱昂嘴 5.05/4.45 都在檐内）→ 上檐 8.44×6.91 攒尖 + 宝顶
    skyStackedRoof(b, GX, GB + 3.78, GZ, 11.4, 9.6, 2, 2, 0, 'zanjian', shade(0x5c6878, 1.08), GOLD_TRIM);
  }

  // ---- W18：钟楼 / 鼓楼（T-GZ-013 钟楼 (28,207,88) / T-GZ-014 鼓楼 (-28,207,88)，10 卷 §三）----
  // 文档坐标的 y=207 是旧广场面；已实装的凌霄台面为 214.12，照 207 建会被整台埋掉 7m。
  // 故 x/z 严格取文档、y 落在凌霄台面（偏差与理由见 W18 交付报告「风险」节）。
  buildBellDrumTower(b, sg, atlas, 28, 88, true);
  buildBellDrumTower(b, sg, atlas, -28, 88, false);
  // WS-38：钟鼓楼器物随楼迁位——悬杵撞木挂钟侧、更签筒/值楼茶炉在钟楼台基、雷纹鼓槌/鼓谱玉简在鼓楼台基
  itmBellStriker(b, 26.9, 222.7, 88);
  itmHourTube(b, 26.6, 214.14, 81.4);
  itmWatchStove(b, 29.4, 214.14, 81.4);
  itmDrumMallet(b, -26.6, 214.14, 81.4);
  itmDrumScore(b, -29.4, 214.14, 81.4);

  // ---- W18：朝房×2（T-GZ-008 东朝房 (40,206,50) / T-GZ-009 西朝房 (-40,206,50)）----
  // 10 卷：面阔五间约 18m、进深 6m、高 5m；灰砖白墙、朱柱青瓦（西为黑柱）；前廊木栏朱漆；
  // 匾「文班待詔」/「武班待旨」+ 檐下班灯（青底金字「文」/ 黑底金字「武」）。
  // 台面沿用 realm.platform（三级石座 + 铺砖 + 望柱寻杖 + 三级踏道 + 岩体裙边），朝房只盖在台面上
  platform(40, 206, 50, 12);
  buildCourtRoom(b, sg, atlas, 40, 50, true);
  platform(-40, 206, 50, 12);
  buildCourtRoom(b, sg, atlas, -40, 50, false);

  // ---- W18：御膳房 / 天库 / 武库（T-GZ-010/011/012）----
  // 正堂已由 palace.buildTianfuAnnex 按文档坐标建好（歇山/歇山/庑殿），本段补「全院」：
  // 10 卷给的 30×22 / 26×20 / 28×24 是院落尺度，原实现只有一座正堂，院墙、库门、侧库房全缺。
  buildKitchenCourt(b, sg, atlas);   // 御膳房 全院 30×22：灶间雨棚 / 冰鉴房 / 茶房 / 烟囱五色炊烟 / 后园
  buildTreasureCourt(b, sg, atlas);  // 天库   全院 26×20：库门包铜 / 三进库房 / 守库房 / 墙头符光巡更
  buildArmoryCourt(b, sg, atlas);    // 武库   全院 28×24：厚墙铁门 / 甲胄库 / 阵器房 / 演武小院 / 石戟架
  // ---- 将台（十幕战场点将） ----
  platform(0, 214, 20, 12);
  b.box('wall', 13, 2.2, 9, 0, 214 + 1.1, 20, shade(0xd8c8a0, 1));
  b.box('wall', 9, 1.4, 6.5, 0, 214 + 2.9, 20, shade(0xc8b888, 1.02));
  // 檐柱 4 根（W23 由背后 2 根补成四角：重檐要有一圈额枋落脚，前排柱让开帅案 1.8m）
  for (const sx of [-1, 1]) {
    b.box('wood', 0.4, 6.5, 0.4, sx * 3.4, 214 + 6.5, 17.9, shade(0xa63a2b, 1.1));
    b.box('wood', 0.4, 6.5, 0.4, sx * 3.4, 214 + 6.5, 22.1, shade(0xa63a2b, 1.1));
  }
  // W23：将台亭 单檐 9×4 → 重檐叠顶（10×6，顶层 7.4 < 12 自动攒尖+宝顶）+ 18 攒密排斗栱 + 彩画带
  b.box('wood', 7.2, 0.62, 3.8, 0, 214 + 9.5, 20, shade(GOLD_TRIM, 0.95));
  skyCaihuaBand(b, 0, 214 + 9.5, 20, 7.2, 3.8, 0);
  skyDougongRing(b, 0, 214 + 9.8, 20, 7.2, 3.8, 0, 1.2, GOLD_TRIM);
  skyStackedRoof(b, 0, 214 + 9.8, 20, 10, 6, 2, 1.9, 0, 'zanjian', shade(0x3a6b8c, 1.05), GOLD_TRIM);
  sg.quad(atlas.text('jiangtai', '將臺', 180, 56, { color: '#ffe9b8', glow: '#ff2e88', bg: 'rgba(12,8,10,0.85)', border: 'rgba(255,46,136,.8)', fontPx: 44 }), 3.4, 1.05, 0, 214 + 11.2, 23.2, 0);
  // 将台陈设：四角旗门、战鼓、兵器架、帅案令旗（台面原本空无一物）
  // W48：凌霄前庭的陈设已迁到「世界坐标」段（wBanner/wDrum/wCenser/wHalberdRack），
  //   这里恢复预缩放坐标版给将台用（台面 214.12，尺寸不走 6× 世界放大）。
  const fy = 214.12;
  const banner = (bx: number, bz: number, sd: number, cloth: number, kit: string): void => {
    b.box('ash', 0.9, 0.3, 0.9, bx, fy + 0.15, bz, shade(0x8a8298, 1.06));
    b.cyl('wood', 0.1, 0.15, 3.0, 6, bx, fy + 1.8, bz, shade(0x5a3a24, 1.05));
    b.box('fabric', 1.15, 1.42, 0.06, bx + 0.58 * sd, fy + 2.6, bz, cloth);
    b.box('fabric', 0.34, 0.6, 0.05, bx + 1.0 * sd, fy + 1.86, bz, shade(cloth, 0.78));
    b.cyl('metal', 0.11, 0.15, 0.16, 6, bx, fy + 3.34, bz, shade(GOLD_TRIM, 1.05));
    b.box('glow', 0.14, 0.14, 0.14, bx, fy + 3.48, bz, 0xffd25e, 0, 0, Math.PI / 4);
    b.kit(kit, 1, fy + 2.6);
  };
  const halberdRack = (hx: number, hz: number, n: number, kit: string): void => {
    const w = 0.6 + n * 0.42;
    b.box('ash', w + 0.5, 0.22, 0.9, hx, fy + 0.11, hz, shade(0x8a8298, 1.05));
    for (const s2 of [-1, 1]) b.box('wood', 0.18, 2.1, 0.18, hx + s2 * (w / 2), fy + 1.05, hz, shade(0x5a3a24, 1.02));
    b.box('wood', w + 0.2, 0.14, 0.14, hx, fy + 2.0, hz, shade(0x5a3a24, 1.12));
    b.box('wood', w + 0.2, 0.12, 0.12, hx, fy + 0.5, hz, shade(0x4a2e1c, 1));
    for (let k = 0; k < n; k++) {
      const ax = hx - w / 2 + (k + 0.5) * (w / n);
      b.box('wood', 0.07, 2.5, 0.07, ax, fy + 1.25, hz, shade(0x6b4a2b, 1.06));
      b.box('metal', 0.34, 0.26, 0.06, ax + 0.16, fy + 2.36, hz, 0x9aa6b8, 0, 0, -0.25);
      b.box('metal', 0.06, 0.34, 0.06, ax, fy + 2.5, hz, 0xb8c0c8);
      b.box('fabric', 0.16, 0.3, 0.04, ax, fy + 2.0, hz + 0.06, 0xa02818);
    }
    b.kit(kit, 1, fy + 1.1);
  };
  const drum = (dx2: number, dz2: number, kit: string): void => {
    buildTempleDrum(b, dx2, fy, dz2);
    b.kit(kit, 1, fy + 1.0);
  };
  const censer = (cx2: number, cz2: number, kit: string): void => {
    b.cyl('ash', 0.62, 0.72, 0.3, 8, cx2, fy + 0.15, cz2, shade(0xd8d0c0, 0.94));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.5;
      b.cyl('metal', 0.09, 0.11, 0.5, 6, cx2 + Math.cos(a) * 0.32, fy + 0.5, cz2 + Math.sin(a) * 0.32, 0x7a6230);
    }
    b.cyl('metal', 0.46, 0.38, 0.62, 12, cx2, fy + 1.05, cz2, 0x8a6a2e);
    b.cyl('metal', 0.5, 0.5, 0.08, 12, cx2, fy + 1.4, cz2, 0xb08a3c);
    b.cyl('metal', 0.34, 0.46, 0.34, 12, cx2, fy + 1.6, cz2, 0x8a6a2e);
    for (const s2 of [-1, 1]) b.box('metal', 0.12, 0.3, 0.08, cx2 + s2 * 0.4, fy + 1.42, cz2, 0xb08a3c, 0, 0, s2 * 0.35);
    b.cyl('glow', 0.16, 0.1, 0.34, 6, cx2, fy + 1.9, cz2, GOLD_LINE, 0, 0, 0, true);
    b.kit(kit, 1, fy + 1.05);
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box('wall', 0.5, 0.4, 0.5, sx * 7.4, 214 + 0.4, 20 + sz * 6.6, shade(0xa63a2b, 1));
      b.cyl('wood', 0.1, 0.14, 7.4, 6, sx * 7.4, 214 + 4.1, 20 + sz * 6.6, 0x5a3a24);
      b.box('fabric', 1.5, 2.6, 0.06, sx * 7.4 + 0.8, 214 + 6.2, 20 + sz * 6.6, sz > 0 ? 0xa63a2b : 0x2a4a7a);
      b.box('glow', 0.18, 0.5, 0.18, sx * 7.4, 214 + 7.9, 20 + sz * 6.6, GOLD_LINE);
      b.kit('jiangtai.banner', 1, 214 + 6);
    }
  }
  // 台面铺装：两道同心环缝（16 段切向石条，open 圆柱只有侧壁、俯视看不见）+ 八道放射缝
  for (const rr of [7.4, 10.6]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      b.box('ground', 2.95, 0.03, 0.14, Math.cos(a) * rr, fy + 0.04, 20 + Math.sin(a) * rr, shade(0x6e5e40, 0.5), Math.PI / 2 - a);
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box('ground', 0.13, 0.03, 3.2, Math.cos(a) * 9, fy + 0.04, 20 + Math.sin(a) * 9, shade(0x6e5e40, 0.5), Math.PI / 2 - a);
  }
  b.kit('jiangtai.paving', 10, fy + 0.04);
  // 陈设（旧版鼓与兵器架整具落在台心方墩里，看不见）：鼓/戟架/香炉移到 r≈9 的环带上
  for (const sx of [-1, 1]) {
    drum(sx * 8.8, 24.4, 'jiangtai.drum');
    halberdRack(sx * 9.3, 16.6, 3, 'jiangtai.weaponRack');
    censer(sx * 9.2, 20.6, 'jiangtai.censer');
  }
  // 八旗环列（正面踏道留空；杆高 3.55，压在台面 +4m 内）
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    if (Math.abs(a - Math.PI / 2) < 0.5) continue;
    banner(Math.cos(a) * 10.4, 20 + Math.sin(a) * 10.4, Math.cos(a) >= 0 ? 1 : -1, k % 2 ? 0x2a4a7a : 0xa02818, 'jiangtai.rimBanner');
  }
  b.box('wood', 2.6, 0.14, 1.2, 0, 214 + 3.6, 20, 0x6b4a2b);
  for (const sx of [-1, 1]) b.box('wood', 0.14, 0.7, 0.14, sx * 1.1, 214 + 3.2, 19.5, 0x4a3220);
  b.box('glow', 0.5, 0.6, 0.05, 0, 214 + 4.2, 20.4, 0xff2e88);
  b.kit('jiangtai.commandDesk', 1, 214 + 3.8);
  // WS-20：将台外缘三圈（6m 云纹铺装带 / 望柱寻杖 + 石灯 / 云海石护栏 + 云头）
  // 台面砖顶 fy=214.12，副阶压到 213.72（低 0.4），正面（+z，机位侧）补三级踏道
  buildCloudTerrace(b, {
    cx: 0, cz: 20, rIn: 12, rOut: 18, yTop: fy - 0.4, kit: 'jiangtai',
    stone: 0x8a8498, paving: 0x565264, joint: 0x332e3c, glowC: 0x00e5ff,
    lamps: 5, heads: 10, step: true, pier: 206.12,
  });
  // WS-38：将台宝器与仙迹——台顶东侧战鼓（鼓大于武库制）+ 台前两侧镇台石狮（誓师时睁眼）
  itmAltarWarDrum(b, 3.0, 217.6, 21.9);
  for (const sx of [-1, 1]) itmStoneLion(b, sx * 7.2, fy, 25.6, sx < 0 ? 0.18 : -0.18);
  // ---- W18：星宿八府（T-GZ-015~022，10 卷 §三 东西两列岛链，各占一座独立小岛）----
  // 旧版把九府压在 r≈222–234 的 r=10 圆盘上、台面 214 且只有 8.5×4.4×6.2 的值房壳；
  // 10 卷给的是「岛基→府门→正堂→星台」四段，正堂面阔 3 间≈12m，星台/龙庭/幻月园等各有其制。
  // 本版：岛径 24–27m（buildIslandSkirt 岩体裙边 + 石作台面 + 岛缘望柱 + 登岛石阶），
  // 正堂复用 palace.skyRoofOn（歇山，脊/垂脊/瓦垄/瓦当齐备），匾额取府名，府旗按四方旗色。
  buildStarPalaces(b, sg, atlas);
  // 星官公廨（B6 编排件，非 10 卷条目）：凌霄台后方的值房，保留原地（同一套形制，不新增 id）
  platform(0, 214, 130, 9);
  b.box('wall', 8.5, 4.4, 6.2, 0, 214 + 2.2, 130, shade(0x5a6472, 1.04));
  b.box('wood', 9, 0.35, 6.7, 0, 214 + 4.6, 130, shade(0x6b4a2b, 1));
  roofOn(b, 10.5, 7.6, 214 + 4.9, 0, 130, 0, shade(C.tile, 1.08), 0x00e5ff);
  sg.quad(atlas.text('stargs', '星官公廨', 260, 60, { color: '#d8f2ff', glow: '#00e5ff', bg: 'rgba(8,10,16,0.86)', border: 'rgba(0,229,255,.75)', fontPx: 44 }), 4.4, 1.1, 0, 214 + 8.2, 133.8, 0);
  // 东西朝房已按 10 卷迁回 (40,206,50)/(-40,206,50) 并由 buildCourtRoom 重建，此处不再重复落位

  // ---- WS-43：云崖渡口 / 莲台法会区 / 朝房 / 凌霄广场 8 件 T-ITM 器物 ----
  for (const sx of [-1, 1]) itmCloudRaft(b, sx * 4.6, 201, -125, sx * 0.1);          // T-ITM-0020 下界云槎×2（门外云崖渡口 0,201,-125）
  itmLotusThrone(b, lotus.x, 207.1, lotus.z);                                        // T-ITM-0069 千瓣白玉莲台（莲台法会区主坛中央）
  itmSandalCenser(b, lotus.x, 206.12, lotus.z + 10);                                 // T-ITM-0073 檀香云炉（坛前）
  // 迎宾茶灶 / 点卯玉牌：随朝房迁位到「前廊外」（新朝房面阔沿 z、正面朝广场，故落在 ±34.2 的台面空处）
  itmTeaStove(b, 34.2, 206.12, 55.2);                                                // T-ITM-0079 迎宾茶灶（东朝房茶水间前廊）
  itmRollCallTokens(b, -34.2, 206.12, 55.2);                                         // T-ITM-0083 点卯玉牌×36（西朝房门前点卯案）
  itmOracleRubbing(b, 9.6, 214.12, 133.8, 0);                                        // T-ITM-0163 大罗天谶碑拓片（碑亭未实装，寄置凌霄广场）
  for (let k = 0; k < 3; k++) itmQingSeat(b, 7.5 + k * 2.1, 214.12, 136.6, Math.PI); // T-ITM-0164 三清讲经席×3（讲经台未实装，寄置凌霄广场）
  // W23：门楼改重檐后正脊由 235.1 升到 238.8（232.5 + 3.05 + 2.96 + 脊面 0.31），光轮随脊上移
  itmNineColorWheel(b, gate.x, 238.8, gate.z);                                       // T-ITM-0173 九色光轮（九光阙未实装，寄挂南天门门楼正脊）

  // ---- 云海 ----
  const cloud = ps.get('cloud');
  const cloudBase = cloud.alloc(MAX_CLOUDS);
  let ci = 0;
  const puff = (x: number, y: number, z: number, s: number, tint = 0): void => {
    if (ci >= MAX_CLOUDS) return;
    _cm.makeScale(s, s * 0.62, s);
    _cm.setPosition(x, y, z);
    _cc.setHex(0xdfeeff).offsetHSL(0, 0, -0.05 * tint);
    cloud.set(cloudBase + ci, _cm, _cc);
    ci++;
  };
  // 大云（台间隔断）：比 puff 更扁（squash 0.26），云心沉在云海面之下，只露一层云丘
  const bigCloud = (x: number, y: number, z: number, s: number, hex = 0xe8f2fc): void => {
    if (ci >= MAX_CLOUDS) return;
    _cm.makeScale(s, s * 0.26, s);
    _cm.setPosition(x, y, z);
    _cc.setHex(hex);
    cloud.set(cloudBase + ci, _cm, _cc);
    ci++;
  };
  const plats: [number, number, number, number][] = [
    [arena.x, arena.y, arena.z, 44], [gate.x, gate.y, gate.z, 30], [palace.x, palace.y, palace.z, 46],
    [pantao.x, pantao.y, pantao.z, 27], [furnace.x, furnace.y, furnace.z, 19], [lotus.x, lotus.y, lotus.z, 15],
    [lotus2.x, lotus2.y, lotus2.z, 12], [moon.x, moon.y, moon.z, 17],
    // WS-20：瑶池水盘此前不在云台上，池岸 r≈33 底下是 200m 空腔；补一圈云托把「空台」垫进云海
    [150, 206, 20, 33],
  ];
  for (const [px, py, pz, pr] of plats) {
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2;
      // WS-46：云托由「盘沿一圈小云球」下沉为「盘下云根」——压到玉盘垂云之下、团径放大到 7.5–12，
      // 与台底云团簇连读成一根云柱；rng 调用数与顺序不变，既有世界生成序列不漂移
      puff(px + Math.cos(a) * pr * 0.72, py - 18.5 - Math.abs(Math.sin(i * 2.7)) * 1.8, pz + Math.sin(a) * pr * 0.72, rng.range(5, 8) * 1.5, i % 3);
    }
  }
  const bridge = (a: THREE.Vector3, bb: THREE.Vector3): void => {
    const d = a.distanceTo(bb);
    const n = Math.floor(d / 8);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      puff(a.x + (bb.x - a.x) * t, a.y + (bb.y - a.y) * t - 6.2 + Math.sin(t * Math.PI) * -2, a.z + (bb.z - a.z) * t, rng.range(3.6, 5.6), i % 2);
    }
  };
  bridge(gate, arena); bridge(arena, palace); bridge(arena, pantao); bridge(arena, furnace); bridge(arena, moon); bridge(palace, lotus);
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-280, 300), z = rng.range(-150, 170), y = rng.range(176, 198);
    // 避开主斗法台上空，保证战场可视
    if (Math.hypot(x - arena.x, (z - arena.z) * 1.2) < 75) continue;
    // WS-46：散云从「低于云板」抬到云海面之上（197–204），改读作浮在云海上的云气
    puff(x, 197 + (y - 176) * (7 / 22), z, rng.range(3.5, 9), i % 4);
  }
  // 台间视觉隔断：三朵大云（半径 54 / 48 / 44）自云海面升起，填掉台与台之间的空档，
  // 断开「几张盘子并排」的读法；云心沉到 191、竖向压到 0.26，顶面 ≤205，
  // 只在云海面（≈196.6）上露 ≤8m 云丘——够不到任何岛体（最低台面 201），不吞岛不遮庙
  bigCloud(-114, 191.0, 14, 54);
  bigCloud(104, 191.0, 74, 48);
  bigCloud(6, 191.0, -118, 44);

  // ---- WS-46 / W16：五级云海——三片薄云板外扩到 r1600 + 两级 6.5–7.5m 厚阶梯云台 ----
  // 判词（W16）：「天宫漂在一个灰水塘上」。三层 1.3–1.8m 薄板在 r 906–1180 就断了，云海没有纵深，
  // 天宫与人间之间只剩一张白纸。本段把云海重排成 5 级、自内向外逐级下沉的平台：
  //   r 700  顶面 196.6（厚 6.5）——天宫都城的承天台，三环岛群的岩体照样埋进这一层
  //   r 1050 顶面 193.6（厚 7.5）——第一级阶梯云台（厚台，立面 3.0m）
  //   r 1300 / 1450 / 1600 顶面 191.4 / 189.6 / 188.0——三片薄云板，外缘推到 1600
  // 半径严格递减、顶面严格递增，没有一级被上一级遮住；两级厚台本身就是 3.0m / 1.8m 的可见台阶立面。
  // 抖动一律走 skyJitter / seaNoise，不消耗 rng：既有世界生成序列逐值不变。
  const SEA = [
    { y: 187.30, r: 1600, th: 1.4, seg: 44, tint: CS_DEEP, amp: 3.6, lobes: 22, rin: 1456, rout: 1592 },
    { y: 188.85, r: 1450, th: 1.5, seg: 40, tint: CS_DEEP, amp: 3.0, lobes: 20, rin: 1306, rout: 1442 },
    { y: 190.60, r: 1300, th: 1.6, seg: 36, tint: CS_BASE, amp: 2.6, lobes: 34, rin: 1056, rout: 1292 },
    { y: 189.85, r: 1050, th: 7.5, seg: 36, tint: CS_BASE, amp: 2.2, lobes: 40, rin: 706, rout: 1042 },
    { y: 193.35, r: 700, th: 6.5, seg: 34, tint: CS_TOP, amp: 1.6, lobes: 54, rin: 0, rout: 690 },
  ];
  let seaLobes = 0;
  for (let li = 0; li < SEA.length; li++) {
    const L = SEA[li];
    const top = L.y + L.th / 2;
    // 板体：薄板一件；厚云台（厚 > 3m）拆上下两层色阶，把 7m 侧壁读成「两层云」而不是一面石墙
    if (L.th > 3) {
      const hUp = L.th * 0.58, hDn = L.th - hUp;
      b.cyl('fabric', L.r, L.r, hUp, L.seg, 0, L.y + hDn / 2, 0, L.tint);
      b.cyl('fabric', L.r * 0.996, L.r * 0.996, hDn, L.seg, 0, L.y - hUp / 2, 0, shade(L.tint, 0.93));
      // 台脚云浪：沿外缘下半圈再挂 12 团，把台阶立面底沿打碎（否则 7.5m 直边在侧视里是一条硬线）
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + skyJitter(i + li * 53, 27.1) * 0.3;
        const br = 34 + skyJitter(i + li * 53, 28.3) * 40;
        b.cyl('fabric', br * 0.7, br, 3.2 + skyJitter(i + li * 53, 29.7) * 2.6, 10,
          Math.cos(a) * L.r * 0.995, L.y - L.th * 0.36, Math.sin(a) * L.r * 0.995,
          shade(L.tint, 0.9 + skyJitter(i + li * 53, 30.9) * 0.06), a);
        seaLobes++;
      }
    } else {
      b.cyl('fabric', L.r, L.r, L.th, L.seg, 0, L.y, 0, L.tint);
    }
    // 起伏云团：噪声场（seaNoise）+ 哈希错落，板面读出絮状起伏而不是镜面平板
    for (let i = 0; i < L.lobes; i++) {
      const a = skyJitter(i + li * 97, 1.3) * Math.PI * 2;
      const rr = L.rin + (L.rout - L.rin) * Math.sqrt(skyJitter(i + li * 97, 2.1));
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const lr = 46 + skyJitter(i + li * 97, 3.7) * 104;
      const yy = top - 0.9 + skyJitter(i + li * 97, 4.9) * L.amp + seaNoise(x, z) * L.amp * 0.55;
      b.cyl('fabric', lr * (0.72 + skyJitter(i + li * 97, 5.3) * 0.2), lr, 2.2 + skyJitter(i + li * 97, 6.1) * 1.8, 12, x, yy, z, shade(L.tint, 0.95 + skyJitter(i + li * 97, 7.9) * 0.11), skyJitter(i + li * 97, 8.3) * 6.28);
      seaLobes++;
    }
    // 边缘云浪：把圆板剪影打成不规则云沿（否则 900 半径的正圆边在远景读出「白盘子」）
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + skyJitter(i + li * 31, 9.1) * 0.2;
      const er = L.r * (0.972 + skyJitter(i + li * 31, 9.7) * 0.03);
      const lr2 = 88 + skyJitter(i + li * 31, 10.3) * 108;
      b.cyl('fabric', lr2 * 0.76, lr2, 2.4 + skyJitter(i + li * 31, 11.1) * 2.2, 10, Math.cos(a) * er, top - 0.5, Math.sin(a) * er, shade(L.tint, 0.94 + skyJitter(i + li * 31, 12.7) * 0.1), a);
      seaLobes++;
    }
  }
  // 云底：最下层底板（r1600 板，底面 186.6）下再挂一层下凸云团，人间仰视「云天花板」不读作平白圆盘
  for (let i = 0; i < 26; i++) {
    const a = skyJitter(i, 13.1) * Math.PI * 2;
    const rr = Math.sqrt(skyJitter(i, 14.3)) * 1520;
    const lr3 = 62 + skyJitter(i, 15.7) * 96;
    b.cyl('fabric', lr3 * 0.7, lr3, 2.4 + skyJitter(i, 16.3) * 1.8, 10, Math.cos(a) * rr, 186.1 + skyJitter(i, 17.9) * 1.2, Math.sin(a) * rr, shade(CS_DEEP, 0.9 + skyJitter(i, 18.7) * 0.08), a);
  }
  b.kit('sky.cloudSea.sheet', 5, 190);
  b.kit('sky.cloudSea.lobe', seaLobes, 193);
  b.kit('sky.cloudSea.under', 26, 188);
  b.kit('sky.cloudSea.gapCloud', 3, 193);

  // ---- WS-46 / W16：外缘渐变云浪（打散云海与天空的硬地平线）----
  // 最外层云板（r1600）的圆边在远景仍读成一条笔直的地平线，把云海与天空切成两半。
  // 半径再外扩 60–150（1570–1720 + 云浪自身 55–105）、高度下沉 1–2m（185.9）、
  // 色取 CS_DEEP×0.88，一圈 48 朵把硬边化成渐隐的云脚。
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2 + skyJitter(i, 31.7) * 0.12;
    const rr = 1570 + skyJitter(i, 32.9) * 150;
    const lr4 = 62 + skyJitter(i, 33.7) * 56;
    b.cyl('fabric', lr4 * 0.7, lr4, 2.8 + skyJitter(i, 34.9) * 2.4, 10,
      Math.cos(a) * rr, 185.9 + skyJitter(i, 35.3) * 1.5, Math.sin(a) * rr,
      shade(CS_DEEP, 0.87 + skyJitter(i, 36.1) * 0.05), a);
  }
  b.kit('sky.cloudSea.fringe', 48, 186);

  // ---- WS-46 / W3：天光光柱降档（跨文件过曝的现场处置）----
  // beautify.ts:41-54 的「天光光柱」是三层加性锥（opacity 0.028/0.05/0.085，r 9–13、y 150–290），
  // 原先衬在暗城郭前读作柔光；云海铺白后同一束光叠在近白背景上直接过曝成白柱——
  // lingxiao-front 实测该光柱投影占屏 x[308,472] y[30,622]，把云海与天空切成两半。
  // 该 Group 在「仙界装点」段（本段之后）才 scene.add，而几何烘焙在「合拢万象」段，
  // 故本段接管一次性 scene.add：光柱入场时 ①三层锥 opacity 压到 SHAFT_DIM，
  // ②柱心云海面补一圈云团把断面接住（下端不凭空断掉）。四束光柱同口径，数量不变。
  // W3 复核：钩子仍在，且 world.ts 的段序为「云起天宫(本段) → 仙界装点(beautify) → 合拢万象(build)」，
  // 四束全部经 scene.add 入场、全部命中；下面再加一次现场兜底扫描，钩子被绕过（热重载/段序调整）也不漏。
  const sceneAdd = scene.add.bind(scene);
  (scene as unknown as { add: (...o: THREE.Object3D[]) => THREE.Scene }).add = (...objs: THREE.Object3D[]): THREE.Scene => {
    for (const o of objs) o.traverse((c) => tameLightShaft(b, c));
    return sceneAdd(...objs);
  };
  for (const o of scene.children.slice()) o.traverse((c) => tameLightShaft(b, c));


  // ---- 星河 ----
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(1500 * 3); const sc = new Float32Array(1500 * 3);
  const cA = new THREE.Color();
  for (let i = 0; i < 1500; i++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.02, Math.PI * 0.46);
    const r = 40000;
    sp[i * 3] = Math.cos(th) * Math.sin(ph + Math.PI / 2) * r;
    sp[i * 3 + 1] = Math.abs(Math.cos(ph)) * r;
    sp[i * 3 + 2] = Math.sin(th) * Math.sin(ph + Math.PI / 2) * r;
    cA.setHSL(rng.pick([0.08, 0.52, 0.6, 0.12]), 0.5, rng.range(0.6, 0.95));
    sc[i * 3] = cA.r; sc[i * 3 + 1] = cA.g; sc[i * 3 + 2] = cA.b;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, fog: false, toneMapped: false }));
  stars.name = 'stars';
  scene.add(stars);
  // 银河带（加厚散化，避免侧视成一条线）
  const mwGeo = new THREE.BufferGeometry();
  const mp = new Float32Array(1100 * 3);
  for (let i = 0; i < 1100; i++) {
    const t = rng.range(-1, 1);
    const th = t * Math.PI;
    mp[i * 3] = Math.cos(th) * 36000 + rng.gauss(0, 4200);
    mp[i * 3 + 1] = 22000 + Math.sin(th * 2.2) * 6200 + rng.gauss(0, 3100);
    mp[i * 3 + 2] = Math.sin(th) * 36000 + rng.gauss(0, 4200);
  }
  mwGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const mw = new THREE.Points(mwGeo, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, color: 0x8ea8d8, transparent: true, opacity: 0.18, fog: false, toneMapped: false }));
  mw.name = 'milkyway';
  scene.add(mw);

  // ---- 仙灵神兽：仙鹤 8 / 麒麟 2 / 螭龙 2 / 天马 2（全部并入既有材质组，零新增 draw call）----
  buildCelestialBeasts(b);

  // ---- 风动仙植/鬼植：瑶池莲花、蟠桃园灵芝与瑶草、地府彼岸花/枯木/幽冥藤 ----
  // 这些必须走自建网格（Baker 烘完顶点色就写死，做不出风），由 onBeforeRender 自走时，
  // 只新增 1 个 draw call，不依赖 world/engine。
  buildWindFlora(scene);

  return centers;
}

// ============ 仙灵神兽（用户点名「精灵神兽」）：仙鹤 / 麒麟 / 螭龙 / 天马 ============
// 造型口径：一律「先立骨架线，再蒙管/球」，不用方块堆——60m 外要能凭剪影认出物种。
// 材质口径同天宫：白羽/白石 → ash、鳞甲金铜 → metal、鬃尾深色 → trunk、鞍褥 → fabric、丹顶/眼 → glow。
const _bDir = new THREE.Vector3(), _bMid = new THREE.Vector3(), _bUp = new THREE.Vector3(0, 1, 0);
const _bQ = new THREE.Quaternion(), _bM = new THREE.Matrix4(), _bS = new THREE.Vector3(1, 1, 1);
const _bP0 = new THREE.Vector3(), _bP1 = new THREE.Vector3();

/** 两点之间的锥形管（肢体/躯干/龙身的基本件）：几何先在世界系摆好再交给 Baker 合批 */
function tube(b: Baker, g: BGroup, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r0: number, r1: number, seg: number, hex: number): void {
  _bP0.set(x0, y0, z0); _bP1.set(x1, y1, z1);
  const h = _bP0.distanceTo(_bP1);
  if (h < 1e-4) return;
  const geo = new THREE.CylinderGeometry(r1, r0, h, seg, 1, false);
  _bDir.subVectors(_bP1, _bP0).normalize();
  _bQ.setFromUnitVectors(_bUp, _bDir);
  _bMid.addVectors(_bP0, _bP1).multiplyScalar(0.5);
  _bM.compose(_bMid, _bQ, _bS);
  geo.applyMatrix4(_bM);
  b.addGeo(g, geo, 0, 0, 0, hex);
}

export interface BeastTally { id: string; count: number; tris: number }
/** 每种仙灵的数量与实测面数（构建时用 Baker 台账差值记账，供交付与自检读取） */
export const beastReport: BeastTally[] = [];

function tallyStart(b: Baker): number {
  const g = b.stats().groups;
  let t = 0;
  for (const k of Object.keys(g) as BGroup[]) t += g[k].triangles;
  return t;
}

/** 仙鹤：长腿长颈、白羽、黑三级飞羽、丹顶、金喙。spread=true 为振翅姿态 */
export function celestialCrane(b: Baker, x: number, y: number, z: number, ry: number, spread: boolean): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (u: number, v: number): [number, number] => [x + ca * u + sa * v, z - sa * u + ca * v];
  const W = 0xf6f6ee, WD = 0xdcdcd0, LEG = 0x4a4640, BLK = 0x1e1e26, RED = 0xc0392b, GOLD = 0xc8a848;
  // 腿：跗蹠（细长外露）+ 胫（被体羽遮住上半）+ 三趾
  for (const sd of [-1, 1]) {
    const [lx, lz] = at(sd * 0.075, 0.0);
    b.cyl('ash', 0.021, 0.027, 0.62, 5, lx, y + 0.31, lz, LEG);
    const [kx, kz] = at(sd * 0.075, 0.03);
    b.cyl('ash', 0.028, 0.04, 0.3, 5, kx, y + 0.74, kz, shade(LEG, 1.08));
    b.box('ash', 0.09, 0.028, 0.19, kx, y + 0.015, kz, shade(LEG, 0.92), ry);
  }
  // 躯干：细长纺锤（crane 的身体是扁长的，不是球）
  b.sphere('ash', 0.22, 10, x, y + 1.0, z, W, ry, 0, 0, 0.8, 0.88, 1.75);
  const [rx0, rz0] = at(0, -0.3);
  b.sphere('ash', 0.16, 8, rx0, y + 0.97, rz0, WD, ry, 0, 0, 0.82, 0.86, 1.0);
  // 尾羽：四束向后下方铺开（黑端）
  for (let k = 0; k < 4; k++) {
    const [tx, tz] = at((k - 1.5) * 0.07, -0.62 - (k % 2) * 0.06);
    b.box('ash', 0.075, 0.045, 0.44, tx, y + 0.96 - k * 0.02, tz, k === 1 || k === 2 ? BLK : WD, ry, -0.18, 0);
  }
  // 收翅：贴身的覆羽（略鼓）+ 三级飞羽（黑，垂在体侧后缘）
  for (const sd of [-1, 1]) {
    const [wx, wz] = at(sd * 0.17, -0.02);
    b.sphere('ash', 0.15, 8, wx, y + 1.04, wz, W, ry, 0, 0, 0.5, 0.72, 1.45);
    for (let k = 0; k < 3; k++) {
      const [fx, fz] = at(sd * (0.17 + k * 0.015), -0.24 - k * 0.09);
      b.box('ash', 0.045, 0.2, 0.34, fx, y + 1.0 - k * 0.02, fz, k === 2 ? BLK : WD, ry, 0.12, sd * 0.08);
    }
  }
  if (spread) {
    // 振翅：翼面外上反 + 五根初级飞羽扇形张开
    for (const sd of [-1, 1]) {
      const [wx, wz] = at(sd * 0.45, 0.0);
      b.box('ash', 0.86, 0.045, 0.44, wx, y + 1.2, wz, W, ry, 0, sd * 0.5);
      for (let k = 0; k < 5; k++) {
        const t = 0.24 + k * 0.16;
        const [px2, pz2] = at(sd * t, 0.24 + k * 0.045);
        b.box('ash', 0.19, 0.03, 0.6, px2, y + 1.25 + k * 0.03, pz2, k > 2 ? BLK : WD, ry + sd * 0.16, -0.16, sd * (0.58 + k * 0.05));
      }
    }
  }
  // 颈：四段 S 形（长颈是仙鹤的第一识别特征），从体前向上收细
  const neck: [number, number, number, number][] = [
    [0, 1.12, 0.2, 0.062], [0, 1.28, 0.3, 0.052], [0, 1.44, 0.33, 0.044], [0, 1.58, 0.32, 0.038],
  ];
  for (let i = 0; i < neck.length - 1; i++) {
    const [u0, v0, h0, r0] = [neck[i][0], neck[i][2], neck[i][1], neck[i][3]];
    const [u1, v1, h1, r1] = [neck[i + 1][0], neck[i + 1][2], neck[i + 1][1], neck[i + 1][3]];
    const [ax, az] = at(u0, v0), [bx, bz] = at(u1, v1);
    tube(b, 'ash', ax, y + h0, az, bx, y + h1, bz, r0, r1, 7, W);
  }
  // 头 + 喙 + 丹顶
  const [hx, hz] = at(0, 0.35);
  b.sphere('ash', 0.072, 8, hx, y + 1.63, hz, W, ry, 0, 0, 0.9, 0.9, 1.15);
  b.sphere('glow', 0.038, 6, hx, y + 1.7, hz, RED);
  tube(b, 'metal', hx, y + 1.62, hz, hx + sa * 0.26, y + 1.56, hz + ca * 0.26, 0.022, 0.006, 5, GOLD);
  for (const sd of [-1, 1]) {
    const [ex, ez] = at(sd * 0.062, 0.36);
    b.box('trunk', 0.028, 0.028, 0.028, ex, y + 1.64, ez, BLK, ry);
  }
}

/** 麒麟：鹿身、牛尾、马蹄、独角、鳞甲、鬃如火焰。尺寸 ~2.2m 长 / 1.55m 高 */
export function celestialQilin(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (u: number, v: number): [number, number] => [x + ca * u + sa * v, z - sa * u + ca * v];
  const GOLD2 = 0xd9b46a, BELLY = 0xe9dcc0, SCALE = 0x8a6a2e, MANE = 0x2f6f7a, HORN = 0xf0e6cc;
  // 四腿：大腿 → 小腿 → 蹄（前腿略直、后腿带飞节）
  for (const [su, sv] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as [number, number][]) {
    const [hx, hz] = at(su * 0.27, sv * 0.62);
    const [kx, kz] = at(su * 0.3, sv * 0.55 + (sv > 0 ? 0.06 : -0.06));
    tube(b, 'metal', hx, y + 0.98, hz, kx, y + 0.5, kz, 0.13, 0.085, 7, shade(GOLD2, 0.94));
    const [ox, oz] = at(su * 0.3, sv * 0.58);
    tube(b, 'metal', ox, y + 0.52, oz, ox, y + 0.1, oz, 0.08, 0.065, 6, shade(GOLD2, 0.88));
    b.box('trunk', 0.19, 0.12, 0.24, ox, y + 0.06, oz, 0x3a2a1e, ry);                 // 蹄
  }
  b.sphere('metal', 0.42, 11, x + sa * 0.02, y + 1.06, z + ca * 0.02, GOLD2, ry, 0, 0, 0.86, 0.94, 1.55); // 躯干
  const [cx, cz] = at(0, 0.62);
  b.sphere('metal', 0.3, 9, cx, y + 1.02, cz, shade(GOLD2, 1.04), ry, 0, 0, 0.9, 0.95, 0.95); // 胸
  const [rx2, rz2] = at(0, -0.66);
  b.sphere('metal', 0.3, 9, rx2, y + 1.04, rz2, shade(GOLD2, 1.02), ry, 0, 0, 0.92, 0.95, 0.95); // 臀
  // 颈（两段）+ 头
  const [n0x, n0z] = at(0, 0.78), [n1x, n1z] = at(0, 0.92);
  tube(b, 'metal', n0x, y + 1.2, n0z, n1x, y + 1.44, n1z, 0.2, 0.15, 8, GOLD2);
  const [hx2, hz2] = at(0, 1.02);
  b.sphere('metal', 0.19, 9, hx2, y + 1.5, hz2, shade(GOLD2, 1.06), ry, 0, 0, 0.86, 0.9, 1.15); // 头
  const [sx2, sz2] = at(0, 1.24);
  const [hx3, hz3] = at(0, 1.06);
  tube(b, 'metal', hx3, y + 1.47, hz3, sx2, y + 1.42, sz2, 0.13, 0.095, 7, BELLY);    // 吻（收分）
  b.box('trunk', 0.1, 0.07, 0.06, sx2 + sa * 0.03, y + 1.42, sz2 + ca * 0.03, 0x3a2a20, ry); // 鼻
  b.box('trunk', 0.13, 0.05, 0.15, sx2, y + 1.35, sz2, 0x4a3428, ry);                 // 口
  for (const sd of [-1, 1]) {
    const [ex, ez] = at(sd * 0.11, 1.06);
    b.box('glow', 0.06, 0.05, 0.04, ex, y + 1.53, ez, 0xffd25e, ry);                  // 眼
    const [ax, az] = at(sd * 0.12, 0.95);
    b.box('metal', 0.06, 0.16, 0.05, ax, y + 1.62, az, shade(HORN, 0.96), ry, 0, sd * 0.35); // 耳
  }
  // 独角：从额头向后上方翘，带环形节
  const [ux, uz] = at(0, 1.08);
  tube(b, 'metal', ux, y + 1.6, uz, ux - sa * 0.06, y + 1.86, uz - ca * 0.06, 0.055, 0.03, 6, HORN);
  tube(b, 'metal', ux - sa * 0.06, y + 1.86, uz - ca * 0.06, ux - sa * 0.26, y + 1.98, uz - ca * 0.26, 0.03, 0.01, 6, HORN);
  for (let k = 0; k < 3; k++) b.cyl('metal', 0.045 - k * 0.01, 0.05 - k * 0.01, 0.03, 6, ux, y + 1.66 + k * 0.1, uz, shade(HORN, 1.1));
  // 鬃：沿颈脊七片火焰状（青碧）
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const [mx, mz] = at(0, 0.78 + t * 0.24);
    const [bx, bz] = at(0, 0.72 + t * 0.26);
    b.box('metal', 0.1, 0.2 + Math.sin(t * Math.PI) * 0.1, 0.05, bx, y + 1.36 + t * 0.2, bz, shade(MANE, 0.9 + t * 0.2), ry, 0, -0.3);
    void mx; void mz;
  }
  // 鳞甲：躯干两侧三排，每排五片（沿体轴叠瓦）
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
    const v = -0.6 + k * 0.24;
    const ang = (r - 1) * 0.62;
    const [px2, pz2] = at(Math.sin(ang) * 0.34, v);
    b.box('ash', 0.16, 0.035, 0.13, px2, y + 1.03 + Math.cos(ang) * 0.33, pz2, shade(SCALE, 1 + (r === 1 ? 0.14 : 0)), ry, 0, ang);
  }
  // 尾：四段上扬 + 焰状尾穗
  let tx = 0, tz = 0, ty = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, az] = at(0, -0.82 - k * 0.16);
    const [bx2, bz2] = at(0, -0.98 - k * 0.2);
    tube(b, 'metal', ax, y + 1.06 + k * 0.1, az, bx2, y + 1.14 + k * 0.14, bz2, 0.1 - k * 0.018, 0.085 - k * 0.018, 6, shade(GOLD2, 0.96));
    tx = bx2; tz = bz2; ty = y + 1.14 + k * 0.14;
  }
  b.sphere('metal', 0.11, 7, tx, ty + 0.06, tz, MANE, ry, 0, 0, 1, 1.9, 1);
  for (let k = 0; k < 3; k++) {
    b.box('metal', 0.05, 0.3 - k * 0.05, 0.06, tx + (k - 1) * 0.08, ty + 0.2, tz, shade(MANE, 0.88 + k * 0.08), ry, 0.3, (k - 1) * 0.35);
  }
}

/** 螭龙：绕柱盘升（螺旋），四爪、独角、鲵须、背鳍、鳞脊 */
export function celestialDragon(b: Baker, cx: number, cy: number, cz: number, radius: number, y0: number, y1: number, turns: number, phase: number): void {
  const N = 34;
  const R0 = radius;
  const GOLD3 = 0xc9a24a, GOLD4 = 0xe4c87a, BELLY2 = 0xe8d9a8, FIN = 0x2f6f7a;
  const ang = (i: number): number => phase + (i / N) * turns * Math.PI * 2;
  const pt = (i: number): [number, number, number] => {
    const a = ang(i);
    const t = i / N;
    return [cx + Math.cos(a) * (R0 - 0.25 * t), y0 + (y1 - y0) * t + Math.sin(a * 3) * 0.12, cz + Math.sin(a) * (R0 - 0.25 * t)];
  };
  // 龙身：26 段锥管，头部略粗、尾部收细
  for (let i = 0; i < N; i++) {
    const [x0, yy0, z0] = pt(i);
    const [x1, yy1, z1] = pt(i + 1);
    const t = i / N;
    const r = 0.3 * (1 - t * 0.62) + 0.06;
    tube(b, 'metal', x0, yy0, z0, x1, yy1, z1, r, r * 0.94, 8, shade(GOLD3, 0.86 + t * 0.28));
    if (i % 2 === 0) {
      // 背鳍：沿脊背（+Y）立起，根部插进龙身，顶端后掠；腹甲压在龙腹（-Y）
      const mx = (x0 + x1) / 2, my2 = (yy0 + yy1) / 2, mz = (z0 + z1) / 2;
      const a2 = ang(i + 0.5);
      b.box('metal', 0.045, (0.3 - t * 0.16), 0.09, mx, my2 + r * 0.75, mz, shade(FIN, 0.9 + t * 0.3), a2, -0.5, 0);
      b.box('ash', 0.1, 0.05, 0.15, mx, my2 - r * 0.82, mz, shade(BELLY2, 0.96), a2);
    }
  }
  // 头：在龙头端（i=N）外伸，体积放大两倍
  const [hx0, hy0, hz0] = pt(N);
  const [hx1, hy1, hz1] = pt(N - 1);
  const dx = hx0 - hx1, dz = hz0 - hz1;
  const dl = Math.max(0.001, Math.hypot(dx, dz));
  const fx = dx / dl, fz = dz / dl;
  b.sphere('metal', 0.34, 10, hx0 + fx * 0.2, hy0 + 0.08, hz0 + fz * 0.2, GOLD4, Math.atan2(fx, fz), 0, 0, 1, 0.9, 1.25);
  b.box('metal', 0.26, 0.2, 0.34, hx0 + fx * 0.5, hy0 + 0.02, hz0 + fz * 0.5, shade(GOLD4, 1.04), Math.atan2(fx, fz));  // 吻
  b.box('trunk', 0.22, 0.08, 0.3, hx0 + fx * 0.52, hy0 - 0.1, hz0 + fz * 0.52, 0x4a3428, Math.atan2(fx, fz));           // 口
  for (const sd of [-1, 1]) {
    b.sphere('glow', 0.055, 6, hx0 + fx * 0.34 - fz * sd * 0.14, hy0 + 0.16, hz0 + fz * 0.34 + fx * sd * 0.14, 0xff3a2e); // 眼
    // 角：独角向后
    tube(b, 'metal', hx0 - fx * 0.05 - fz * sd * 0.1, hy0 + 0.26, hz0 - fz * 0.05 + fx * sd * 0.1,
      hx0 - fx * 0.5 - fz * sd * 0.16, hy0 + 0.52, hz0 - fz * 0.5 + fx * sd * 0.16, 0.05, 0.012, 5, 0xf0e6cc);
    // 鲵须：两根向后飘的长须
    tube(b, 'metal', hx0 + fx * 0.6 - fz * sd * 0.12, hy0 - 0.04, hz0 + fz * 0.6 + fx * sd * 0.12,
      hx0 + fx * 0.9 - fz * sd * 0.4, hy0 - 0.3, hz0 + fz * 0.9 + fx * sd * 0.4, 0.022, 0.008, 4, 0xe8dcc0);
  }
  // 四爪：沿身每 6 段一只，爪三趾
  for (let k = 0; k < 4; k++) {
    const i = 4 + k * 6;
    const [lx, ly, lz] = pt(i);
    const a2 = ang(i);
    const ox = Math.cos(a2) * 0.5, oz = Math.sin(a2) * 0.5;
    const ky = ly - 0.45;
    tube(b, 'metal', lx, ly, lz, lx + ox, ky, lz + oz, 0.11, 0.08, 6, shade(GOLD3, 1.05));   // 上臂
    tube(b, 'metal', lx + ox, ky, lz + oz, lx + ox * 1.25, ly - 0.9, lz + oz * 1.25, 0.075, 0.05, 5, shade(GOLD3, 0.94));
    for (let c = 0; c < 3; c++) {
      const ca2 = a2 + (c - 1) * 0.4;
      b.box('metal', 0.05, 0.05, 0.16, lx + ox * 1.3 + Math.cos(ca2) * 0.1, ly - 0.94, lz + oz * 1.3 + Math.sin(ca2) * 0.1, shade(BELLY2, 0.98), ca2); // 爪趾
    }
  }
  // 尾鳍：末端三片
  const [ex2, ey2, ez2] = pt(0);
  for (let k = 0; k < 3; k++) {
    const a2 = ang(0) + (k - 1) * 0.5;
    b.box('metal', 0.06, 0.34, 0.16, ex2 + Math.cos(a2) * 0.18, ey2 - 0.16, ez2 + Math.sin(a2) * 0.18, shade(FIN, 1.05), a2, 0, 0.25);
  }
}

/** 天马：四蹄、长颈、鬃尾、鞍褥、双翼（御马厩／云道旁） */
export function celestialHorse(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (u: number, v: number): [number, number] => [x + ca * u + sa * v, z - sa * u + ca * v];
  const COAT = 0xf0ece2, MANE = 0x2e3a52, HOOF = 0x2a2622, WING = 0xe8eef8;
  for (const [su, sv] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as [number, number][]) {
    const [tx, tz] = at(su * 0.24, sv * 0.56);
    const [kx, kz] = at(su * 0.26, sv * 0.52);
    const [fx, fz] = at(su * 0.26, sv * 0.56);
    tube(b, 'ash', tx, y + 0.98, tz, kx, y + 0.52, kz, 0.11, 0.075, 6, shade(COAT, 0.94));
    tube(b, 'ash', kx, y + 0.55, kz, fx, y + 0.1, fz, 0.07, 0.055, 6, shade(COAT, 0.88));
    b.box('trunk', 0.17, 0.11, 0.2, fx, y + 0.06, fz, HOOF, ry);
  }
  b.sphere('ash', 0.4, 11, x, y + 1.06, z, COAT, ry, 0, 0, 0.8, 0.9, 1.5);              // 躯干
  const [cx2, cz2] = at(0, 0.58);
  b.sphere('ash', 0.29, 9, cx2, y + 1.04, cz2, shade(COAT, 1.02), ry, 0, 0, 0.9, 0.95, 0.95);
  const [rx3, rz3] = at(0, -0.62);
  b.sphere('ash', 0.29, 9, rx3, y + 1.06, rz3, shade(COAT, 1.0), ry, 0, 0, 0.9, 0.95, 0.95);
  const [n0x, n0z] = at(0, 0.74), [n1x, n1z] = at(0, 0.86);
  tube(b, 'ash', n0x, y + 1.2, n0z, n1x, y + 1.46, n1z, 0.19, 0.13, 8, COAT);
  const [hx, hz] = at(0, 0.96);
  b.sphere('ash', 0.16, 8, hx, y + 1.52, hz, shade(COAT, 1.04), ry, 0, 0, 0.8, 0.85, 1.3);
  const [mx, mz] = at(0, 1.16);
  b.box('ash', 0.16, 0.14, 0.22, mx, y + 1.46, mz, shade(COAT, 0.98), ry);               // 吻
  for (const sd of [-1, 1]) {
    const [ex, ez] = at(sd * 0.1, 1.0);
    b.box('glow', 0.05, 0.045, 0.04, ex, y + 1.56, ez, 0xffe9a8, ry);
    const [ax, az] = at(sd * 0.1, 0.9);
    b.box('ash', 0.05, 0.14, 0.04, ax, y + 1.66, az, shade(COAT, 0.96), ry, 0, sd * 0.3);
  }
  // 鬃：沿颈脊 6 片深色
  for (let k = 0; k < 6; k++) {
    const t = k / 5;
    const [mx2, mz2] = at(0, 0.72 + t * 0.22);
    b.box('trunk', 0.06, 0.18, 0.12, mx2, y + 1.34 + t * 0.24, mz2, shade(MANE, 0.9 + t * 0.2), ry, 0, -0.35);
  }
  // 鞍褥：腹带 + 鞍垫
  const [sx2, sz2] = at(0, -0.02);
  b.box('fabric', 0.78, 0.14, 0.6, sx2, y + 1.36, sz2, 0x2a4a7a, ry);
  b.box('fabric', 0.7, 0.5, 0.06, sx2, y + 1.06, sz2, 0xa02818, ry);
  // 尾：五段垂弧
  for (let k = 0; k < 5; k++) {
    const [tx0, tz0] = at(0, -0.88 - k * 0.1);
    const [tx1, tz1] = at(0, -1.0 - k * 0.12);
    tube(b, 'trunk', tx0, y + 1.2 - k * 0.14, tz0, tx1, y + 1.12 - k * 0.18, tz1, 0.08 - k * 0.01, 0.07 - k * 0.01, 5, shade(MANE, 0.95));
  }
  // 双翼：三层羽片外张（天马标志）
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const [wx, wz] = at(sd * (0.2 + k * 0.1), 0.05 + k * 0.06);
      b.box('ash', 0.66 - k * 0.12, 0.04, 0.34, wx, y + 1.36 + k * 0.1, wz, shade(WING, 1.02 - k * 0.04), ry, 0, sd * (0.5 + k * 0.16));
    }
  }
}

/** 布点：仙鹤（蟠桃园/云台/南天门前）、麒麟（南天门前）、螭龙（南天门双柱盘升）、天马（云道旁） */
function buildCelestialBeasts(b: Baker): void {
  beastReport.length = 0;
  const t0 = tallyStart(b);
  // 仙鹤 8：蟠桃园 4（2 立 1 展翅 1 立）、斗法云台沿 2、南天门前 2
  celestialCrane(b, -138, 201.12, 40, 0.55, false);
  celestialCrane(b, -157, 201.12, 37, -1.85, false);
  celestialCrane(b, -146, 201.12, 56, 2.35, true);
  celestialCrane(b, -163, 201.12, 51, 0.15, false);
  celestialCrane(b, 19, 206.12, 26, -2.55, true);
  celestialCrane(b, -21, 206.12, 23, 1.15, false);
  celestialCrane(b, -11.5, 203.12, -66, 0.25, false);
  celestialCrane(b, 11.5, 203.12, -66, -0.25, true);
  beastReport.push({ id: 'crane', count: 8, tris: Math.round(tallyStart(b) - t0) });
  // 麒麟 2：南天门内侧御道两厢（面朝来客）
  const t1 = tallyStart(b);
  celestialQilin(b, -7.6, 203.12, -69, 0.12);
  celestialQilin(b, 7.6, 203.12, -69, -0.12);
  beastReport.push({ id: 'qilin', count: 2, tris: Math.round(tallyStart(b) - t1) });
  // 螭龙 2：盘在南天门两根墩柱上（柱 4×22×4，柱心 ±14,-85；自 211 起盘到 223）
  const t2 = tallyStart(b);
  celestialDragon(b, -14, 203.12, -85, 3.1, 211.6, 223.4, 1.55, 0.4);
  celestialDragon(b, 14, 203.12, -85, 3.1, 211.6, 223.4, 1.55, Math.PI + 0.4);
  beastReport.push({ id: 'dragon', count: 2, tris: Math.round(tallyStart(b) - t2) });
  // 天马 2：南天门东侧云道旁
  const t3 = tallyStart(b);
  celestialHorse(b, 21, 203.12, -64, 1.25);
  celestialHorse(b, 25.5, 203.12, -70, -1.5);
  beastReport.push({ id: 'horse', count: 2, tris: Math.round(tallyStart(b) - t3) });
}

const _cm = new THREE.Matrix4();
const _cc = new THREE.Color();

/** 云海起伏噪声场：三重正弦叠加（无状态、无 rng），值域 ≈ ±1，读作绵延云浪而非随机抖动 */
function seaNoise(x: number, z: number): number {
  return Math.sin(x * 0.0121 + 0.7) * 0.46 + Math.cos(z * 0.0143 - 0.4) * 0.32 + Math.sin((x - z) * 0.0237) * 0.22;
}

/**
 * 天光光柱透明度压档（0.028/0.05/0.085 → ×0.18）：W3 复核后由 0.3 再降一档。
 * 原 0.3 档下三层加性锥中心累计仍有 ~0.049 的加性叠加（≈ +12/255），在近白云海上仍读作「亮柱」；
 * 0.18 档中心累计 ~0.029（≈ +7/255），只余云隙透下来的方向感，不再是一根白柱。
 */
const SHAFT_DIM = 0.18;
/** 光柱材质是四束共用的同一批 material：用 WeakSet 保证每张材质只压一次档（否则 0.3⁴ 直接压没） */
const _shaftDimmed = new WeakSet<THREE.Material>();
/** 柱心云圈同理：同一束光柱只补一次（钩子与兜底扫描可能各命中一次） */
const _shaftCollared = new WeakSet<THREE.Object3D>();

/**
 * 天光光柱降档：beautify.ts 的「云隙垂光」由三层加性锥组成，云海铺白后整根过曝成白柱。
 * 入场时把三层锥的 opacity 压档，并在柱心的云海面补一圈云团，把光柱断面接进云里。
 * 只认 name==='light_shaft'，其余 scene.add 一律原样放行。
 */
function tameLightShaft(b: Baker, o: THREE.Object3D): void {
  if (!o || o.name !== 'light_shaft') return;
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material;
    const arr = Array.isArray(m) ? m : m ? [m] : [];
    for (const mm of arr) {
      const basic = mm as THREE.MeshBasicMaterial;
      if (typeof basic.opacity === 'number' && !_shaftDimmed.has(mm)) {
        basic.opacity *= SHAFT_DIM;
        _shaftDimmed.add(mm);
      }
    }
  });
  if (_shaftCollared.has(o)) return;
  _shaftCollared.add(o);
  // 锥底 y=150 埋在云海之下，可见的断面在云海顶面（196.6）：柱心补一圈云团把断面接住。
  // W3 加密：柱心盘 1 + 外圈 14（旧 8），每束 15 件、四束 60 件，把细柱断面的硬边吃掉。
  const sx = o.position.x, sz = o.position.z;
  b.cyl('fabric', 30, 34, 2.6, 12, sx, 195.6, sz, shade(CS_BASE, 0.98));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + skyJitter(i, 21.3) * 0.35;
    const rr = 12 + skyJitter(i, 22.1) * 12;
    const s = 8 + skyJitter(i, 23.7) * 8;
    b.cyl('fabric', s * 0.7, s, 3.0 + skyJitter(i, 24.3) * 1.6, 10,
      sx + Math.cos(a) * rr, 197.2 + skyJitter(i, 25.1) * 1.2, sz + Math.sin(a) * rr,
      shade(CS_TOP, 0.94 + skyJitter(i, 26.3) * 0.08), a);
  }
  b.kit('sky.cloudSea.shaftCollar', 15, 196);
}

// ============ WS-38：天宫台面宝器与仙迹（将台 / 钟鼓楼 / 蟠桃园 8 件 T-ITM 逐件建模） ============
// 材质口径同 palace.ts：玉/石 → ash（浅色）、金铜 → metal、宝光 → glow、木作 → wood、锦绫 → fabric、瓷皿 → ceramic
// 每件首行「// 名称：T-ITM-xxxx」= 台账锚点注释（scripts/annotate-atom-impl.mjs 按源码 ID 锚点收录）
const STON_L = 0x9a948c;   // 青石（浅）
const STON_D = 0x7a7468;   // 青石（深）
const BRZ2 = 0xb08a3c;     // 铜
const BRZD2 = 0x7a6230;    // 暗铜

// ============ 庙鼓（殿前/将台共用）：鼓身改亚光朱漆 ============
/**
 * 庙鼓：双立柱鼓架 + 抱鼓墩 + 朱漆鼓身 + 牛皮双面 + 两圈鼓钉 + 鼓槌。
 *
 * 反光修复（用户 2026-11-01 点名「鼓这样反光合理吗」）：
 * 旧版鼓身走 lacquer 组，而 bake.ts 的 lacquer 是
 *   MeshPhysicalMaterial{ roughness 0.36, clearcoat 0.85, clearcoatRoughness 0.14, envMapIntensity 0.65 }
 * ——清漆层参数接近车漆，鼓身圆柱在掠射角会拉出一条连续镜面高光带，读成玻璃/塑料。
 * bake.ts 不归本轮改，故从调用侧换材质组：鼓身改走 wood 组
 *   MeshStandardMaterial{ roughness 0.82, metalness 0.03, 无 clearcoat }
 * 木纹贴图恰好给出「漆下有木」的层次，但没有镜面高光。鼓面继续用 fabric（roughness 0.92 + sheen 0.25）
 * 并压到暗牛皮色 0x8a7358 —— 0xd8c8a0 在强光 + bloom 下会直接烧成白团。
 * 尺度按庙鼓：鼓径 1.1 / 鼓身长 0.86 / 鼓轴 1.0 → 鼓顶 1.55m（不高过人）。
 */
export function buildTempleDrum(b: Baker, x: number, deckY: number, z: number): void {
  const R = 0.55, HALF = 0.43, AXLE = 1.0;
  const LAC = 0xa8321f;   // 朱漆（wood 组木纹贴图会再压暗一档，取值比目标色亮一档）
  const RIM = 0x5e1a12;   // 近蒙皮的两道漆箍
  const HIDE = 0x7a6349;  // 牛皮（再压一档：0x8a7358 在强光 + bloom 下仍偏亮）
  const GOLDV = GOLD_TRIM;
  for (const s2 of [-1, 1]) {
    b.box('wood', 0.3, 0.16, 0.94, x + s2 * 0.76, deckY + 0.08, z, shade(0x4a2e1c, 1.0));                       // 抱鼓墩
    b.box('wood', 0.18, AXLE, 0.2, x + s2 * 0.76, deckY + AXLE / 2 + 0.08, z, shade(0x5a3a24, 1.06));           // 立柱
    b.box('metal', 0.24, 0.1, 0.26, x + s2 * 0.76, deckY + AXLE + 0.13, z, shade(GOLDV, 0.9));                  // 柱头铜箍
    b.box('wood', 0.1, 0.09, 0.6, x + s2 * 0.76, deckY + 0.3, z, shade(0x4a2e1c, 1.08));                        // 侧枨
  }
  b.box('wood', 1.6, 0.12, 0.14, x, deckY + 0.2, z, shade(0x4a2e1c, 1.02));                                     // 底横枨
  b.cyl('wood', R, R, HALF * 2, 20, x, deckY + AXLE, z, LAC, 0, Math.PI / 2);                                   // 鼓身（20 段）
  for (const s2 of [-1, 1]) {
    b.cyl('wood', R + 0.015, R + 0.015, 0.07, 20, x, deckY + AXLE, z + s2 * 0.33, RIM, 0, Math.PI / 2);         // 漆箍
    b.cyl('fabric', R - 0.01, R - 0.01, 0.05, 20, x, deckY + AXLE, z + s2 * (HALF - 0.005), HIDE, 0, Math.PI / 2); // 蒙皮
    for (let k = 0; k < 16; k++) {                                                                              // 鼓边钉圈 16 颗
      const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
      b.box('metal', 0.07, 0.07, 0.05, x + Math.cos(a) * 0.47, deckY + AXLE + Math.sin(a) * 0.47, z + s2 * (HALF + 0.02), shade(GOLDV, 0.92));
    }
    for (let k = 0; k < 12; k++) {                                                                              // 鼓身侧钉 12 颗
      const a = (k / 12) * Math.PI * 2;
      b.box('metal', 0.06, 0.06, 0.045, x + Math.cos(a) * (R + 0.012), deckY + AXLE + Math.sin(a) * (R + 0.012), z + s2 * 0.37, shade(GOLDV, 0.86));
    }
  }
  b.cyl('wood', 0.034, 0.042, 0.56, 6, x + 0.66, deckY + 0.44, z + 0.36, shade(0x6b3a22, 1.1), 0, 0.55, 0.95);   // 鼓槌柄
  b.cyl('metal', 0.085, 0.085, 0.16, 8, x + 0.83, deckY + 0.7, z + 0.52, shade(GOLDV, 1.02), 0, 0.55, 0.95);     // 包铜槌头
}

// 将台战鼓：T-ITM-0180
/** 将台战鼓：铜架四柱 + 双横枋 + 蒙革鼓身（鼓大于武库制）+ 双面革 + 三圈鼓钉 + 雷纹带 */
function itmAltarWarDrum(b: Baker, x: number, y: number, z: number): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box('metal', 0.15, 1.82, 0.15, x + sx * 0.74, y + 0.91, z + sz * 0.52, shade(BRZ2, 0.92));
    b.box('metal', 0.34, 0.12, 1.3, x + sx * 0.74, y + 0.06, z, shade(BRZD2, 1.02));
    b.box('metal', 0.17, 0.14, 1.28, x + sx * 0.74, y + 1.72, z, shade(BRZ2, 1.06));
    b.box('metal', 0.1, 0.1, 1.1, x + sx * 0.74, y + 1.02, z, shade(BRZD2, 1.04));
  }
  b.cyl('lacquer', 0.86, 0.86, 0.92, 16, x, y + 1.0, z, shade(0x8a2a20, 1.02), 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    b.cyl('fabric', 0.87, 0.87, 0.05, 16, x + sx * 0.47, y + 1.0, z, shade(0xd8c8a0, 1.02), 0, 0, Math.PI / 2);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.box('metal', 0.08, 0.08, 0.05, x + sx * 0.5, y + 1.0 + Math.sin(a) * 0.74, z + Math.cos(a) * 0.74, shade(0xf5c542, 0.9));
    }
    for (let k = 0; k < 4; k++) {                       // 雷纹带
      const a = (k / 4) * Math.PI * 2 + 0.4;
      b.box('glow', 0.14, 0.1, 0.02, x + sx * 0.47, y + 1.0 + Math.sin(a) * 0.44, z + Math.cos(a) * 0.44, shade(0xffd25e, 0.6));
    }
  }
  b.kit('sky.item.altarWarDrum', 1, y + 1.0);
}

// 镇台活化石狮：T-ITM-0183
/** 镇台活化石狮：须弥座 + 身 + 四腿 + 头 + 鬃九旋 + 双目（誓师时睁眼）+ 尾 + 前爪（青石圆雕） */
function itmStoneLion(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('ash', 1.1, 0.34, 0.84, x, y + 0.17, z, shade(STON_L, 1.0), ry);          // 须弥座
  b.box('ash', 0.98, 0.1, 0.72, x, y + 0.39, z, shade(STON_L, 1.1), ry);
  const by = y + 0.44;
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const [px, pz] = L(su * 0.28, sw * 0.26);
    b.box('ash', 0.2, 0.46, 0.2, px, by + 0.23, pz, shade(STON_D, 1.0), ry);      // 四腿
  }
  const [bx2, bz2] = L(0, -0.06);
  b.box('ash', 0.66, 0.6, 0.54, bx2, by + 0.74, bz2, shade(STON_L, 1.04), ry);    // 身
  const [hx, hz] = L(0, 0.24);
  b.box('ash', 0.5, 0.46, 0.42, hx, by + 1.26, hz, shade(STON_L, 1.08), ry);      // 头
  const [jx, jz] = L(0, 0.44);
  b.box('ash', 0.34, 0.2, 0.16, jx, by + 1.14, jz, shade(STON_D, 1.06), ry);      // 吻/口
  for (let k = 0; k < 9; k++) {                                                    // 鬃九旋
    const a = (k / 9) * Math.PI * 2;
    const [sx2, sz2] = L(Math.cos(a) * 0.28, 0.2 + Math.sin(a) * 0.16);
    b.box('ash', 0.11, 0.11, 0.13, sx2, by + 1.36 + Math.cos(a) * 0.12, sz2, shade(STON_D, 1.1 + (k % 2) * 0.08), ry, 0, a);
  }
  for (const su of [-1, 1]) {                                                      // 双目（誓师睁眼）
    const [ex, ez] = L(su * 0.14, 0.47);
    b.box('glow', 0.09, 0.06, 0.03, ex, by + 1.3, ez, shade(0xffd25e, 0.85), ry);
  }
  const [tx2, tz2] = L(0, -0.34);
  b.box('ash', 0.14, 0.5, 0.14, tx2, by + 0.86, tz2, shade(STON_D, 0.96), ry, 0, 0.42); // 尾
  const [px2, pz2] = L(0, 0.4);
  b.box('ash', 0.3, 0.12, 0.26, px2, by + 0.1, pz2, shade(STON_D, 1.02), ry);     // 前爪
  b.kit('sky.item.stoneLion', 1, y);
}

// 悬杵撞木：T-ITM-0104
/** 悬杵撞木：两道吊绳 + 吊环 + 横悬木（悬木包铜）+ 双铁箍 + 铜撞头（自动撞钟机关，钟侧） */
function itmBellStriker(b: Baker, x: number, topY: number, z: number): void {
  for (const sx of [-1, 1]) {
    b.box('fabric', 0.035, 0.8, 0.035, x - 0.5 + sx * 0.44, topY - 0.4, z, shade(0x8a7a5a, 0.85));
    b.box('metal', 0.08, 0.07, 0.08, x - 0.5 + sx * 0.44, topY - 0.03, z, shade(BRZD2, 1));
  }
  b.cyl('trunk', 0.11, 0.12, 1.66, 8, x - 0.5, topY - 0.86, z, shade(0x6a4a30, 1.08), 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) b.box('metal', 0.08, 0.26, 0.26, x - 0.5 + sx * 0.56, topY - 0.86, z, shade(BRZD2, 1.05));
  b.cyl('metal', 0.17, 0.17, 0.22, 10, x - 1.36, topY - 0.86, z, shade(BRZ2, 1.06), 0, 0, Math.PI / 2);
  b.kit('sky.item.bellStriker', 1, topY - 0.8);
}

// 更签筒：T-ITM-0107
/** 更签筒：竹筒 + 筒座 + 九支更签（签分九更，签头朱记）+ 签绳（功曹抽签定更次） */
function itmHourTube(b: Baker, x: number, y: number, z: number): void {
  b.box('wood', 0.34, 0.06, 0.34, x, y + 0.03, z, shade(0x4a3220, 1.0));
  b.cyl('ceramic', 0.15, 0.13, 0.6, 10, x, y + 0.36, z, shade(0xc8b878, 1.02));
  b.cyl('ceramic', 0.16, 0.16, 0.05, 10, x, y + 0.04, z, shade(0x6b4a2b, 0.9));
  for (let k = 0; k < 9; k++) {                    // 九支更签
    const a = (k / 9) * Math.PI * 2;
    b.box('ash', 0.035, 0.78, 0.035, x + Math.cos(a) * 0.07, y + 0.68, z + Math.sin(a) * 0.07, shade(0xfff8ef, 0.96 + (k % 2) * 0.06), 0, Math.cos(a) * 0.06, Math.sin(a) * 0.06);
    b.box('glow', 0.04, 0.05, 0.04, x + Math.cos(a) * 0.11, y + 1.02, z + Math.sin(a) * 0.11, shade(0xc0392b, 0.9));
  }
  b.kit('sky.item.hourTube', 1, y + 0.3);
}

// 值楼茶炉：T-ITM-0112
/** 值楼茶炉：三足小红炉 + 炉身（朱漆）+ 炭口火光 + 粗茶壶（壶身/壶嘴/提梁）+ 炭斗（功曹守更慰藉） */
function itmWatchStove(b: Baker, x: number, y: number, z: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.5;
    b.cyl('metal', 0.05, 0.07, 0.24, 6, x + Math.cos(a) * 0.22, y + 0.12, z + Math.sin(a) * 0.22, shade(BRZD2, 0.95));
  }
  b.cyl('lacquer', 0.26, 0.28, 0.34, 12, x, y + 0.41, z, shade(0x8a2a20, 1.02));
  b.cyl('metal', 0.28, 0.28, 0.05, 12, x, y + 0.6, z, shade(BRZD2, 1.05));
  b.box('glow', 0.16, 0.12, 0.06, x, y + 0.34, z + 0.26, shade(0xff7f50, 0.85));      // 炭口
  b.cyl('ceramic', 0.15, 0.17, 0.2, 10, x, y + 0.73, z, shade(0xd8c8b0, 1.02));      // 茶壶身
  b.cyl('ceramic', 0.09, 0.12, 0.05, 10, x, y + 0.85, z, shade(0xd8c8b0, 1.08));
  b.box('ceramic', 0.16, 0.04, 0.05, x + 0.2, y + 0.74, z, shade(0xd8c8b0, 0.98), 0, 0, -0.3); // 壶嘴
  b.box('ceramic', 0.05, 0.14, 0.05, x - 0.16, y + 0.79, z, shade(0xd8c8b0, 0.98));  // 提梁
  b.cyl('glow', 0.06, 0.04, 0.1, 6, x, y + 0.92, z, 0xfff3d8, 0, 0, 0, true);       // 茶气
  b.kit('sky.item.watchStove', 1, y + 0.4);
}

// 雷纹鼓槌：T-ITM-0109
/** 雷纹鼓槌：槌架（双柱 + 横档）+ 双槌（包铜木槌，槌头雷纹）+ 槌绳（击鼓动画音效配套） */
function itmDrumMallet(b: Baker, x: number, y: number, z: number): void {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.07, 0.62, 0.07, x + sx * 0.36, y + 0.31, z, shade(0x5a3a24, 1.02));
    b.box('wood', 0.2, 0.06, 0.2, x + sx * 0.36, y + 0.03, z, shade(0x4a3220, 1.0));
  }
  b.box('wood', 0.78, 0.06, 0.08, x, y + 0.58, z, shade(0x5a3a24, 1.1));
  for (let i = 0; i < 2; i++) {
    const my = y + 0.66 + i * 0.09, mz = z - 0.09 + i * 0.18;
    b.cyl('wood', 0.028, 0.033, 0.44, 6, x + 0.06, my, mz, shade(0x6b4a2b, 1.06), 0, 0, Math.PI / 2);  // 槌柄
    b.cyl('metal', 0.075, 0.075, 0.15, 8, x - 0.2, my, mz, shade(BRZ2, 1.05), 0, 0, Math.PI / 2);        // 包铜槌头
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      b.box('glow', 0.1, 0.035, 0.014, x - 0.2, my + Math.cos(a) * 0.06, mz + Math.sin(a) * 0.06, shade(0xffd25e, 0.6));
    }
    b.box('fabric', 0.06, 0.16, 0.014, x + 0.24, my - 0.1, mz, shade(0xa02818, 0.95));                  // 槌绳
  }
  b.kit('sky.item.drumMallet', 1, y + 0.5);
}

// 鼓谱玉简：T-ITM-0110
/** 鼓谱玉简：简托 + 玉简三片（记更鼓十八路节奏）+ 鼓点符纹（阅读彩蛋） */
function itmDrumScore(b: Baker, x: number, y: number, z: number): void {
  b.box('wood', 0.3, 0.06, 0.24, x, y + 0.03, z, shade(0x5a3a24, 1.02));            // 简托
  for (const sx of [-1, 1]) b.box('wood', 0.04, 0.14, 0.2, x + sx * 0.12, y + 0.12, z, shade(0x4a3220, 1.0));
  for (let k = 0; k < 3; k++) b.box('ash', 0.34, 0.03, 0.2, x, y + 0.1 + k * 0.035, z + (k - 1) * 0.01, shade(0xfff8ef, 0.97 - k * 0.04), 0, 0, 0.1);
  for (let k = 0; k < 5; k++) b.box('glow', 0.04, 0.014, 0.02, x - 0.12 + k * 0.06, y + 0.19, z + 0.06, shade(0x7fd8ff, 0.7 - k * 0.06));
  b.kit('sky.item.drumScore', 1, y);
}

// 九千年桃王挂牌：T-ITM-0024
/** 九千年桃王挂牌：系绳 + 铜环 + 金牌（铭「三千六百株之长」三行）+ 双条红绫（系于后圈桃王树干） */
function itmPeachKingTag(b: Baker, tx: number, tz: number, baseY: number): void {
  const gy = baseY + 2.32, bz = tz + 0.46;
  for (const sx of [-1, 1]) b.box('trunk', 0.03, 0.44, 0.03, tx + sx * 0.16, gy + 0.34, bz - 0.19, shade(0x4a3220, 1), 0, 0.22);
  b.cyl('metal', 0.05, 0.05, 0.03, 8, tx, gy + 0.19, bz, shade(0xf5c542, 1), 0, 0, Math.PI / 2);
  b.box('metal', 0.52, 0.36, 0.06, tx, gy, bz, shade(GOLD_LINE, 1.02));
  b.box('metal', 0.56, 0.05, 0.08, tx, gy + 0.19, bz, shade(GOLD_LINE, 1.14));
  for (let k = 0; k < 3; k++) b.box('glow', 0.34 - k * 0.08, 0.03, 0.02, tx, gy + 0.1 - k * 0.08, bz + 0.035, shade(0xc0392b, 0.85));
  for (const sx of [-1, 1]) b.box('fabric', 0.12, 0.6, 0.03, tx + sx * 0.2, gy - 0.46, bz + 0.01, shade(0xa02818, 1));
  b.kit('sky.item.peachKingTag', 1, gy);
}

// ============ WS-43：南天门 / 莲台法会区 / 朝房 / 凌霄广场 8 件 T-ITM data-only 补建 ============
// 台账 10 卷：§T-ITM-0020 云崖渡口 / §0069·0073 莲台法会区 T-GZ-007 / §0079 东朝房 / §0083 西朝房 /
// §0163·0164 大罗宫（远宫仅外观层，未实装，按 WS-43 寄置凌霄广场）/ §0173 九光阙（未实装，寄挂南天门门楼正脊）。
// 材质口径同 WS-38：玉/石 → ash、金铜 → metal、宝光 → glow、木作 → wood、漆器 → lacquer、锦绫 → fabric、瓷皿 → ceramic。
const JADEW3 = 0xc9c4b8;   // 白玉（0xfff8ef 线性 0.94×3.2=3.0，必裁成纯白）

/** 下界云槎：槎身（八段收分）+ 龙骨 + 舷板云纹 + 椽篷三架 + 双橹 + 槎尾云涛（云崖渡口，乘槎下界/返程载具） */
// 下界云槎：T-ITM-0020
function itmCloudRaft(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  for (let i = 0; i < 8; i++) {
    const u = -3.5 + i * 1.0;
    const t = i / 7;
    const wd = 1.9 * Math.sin(Math.PI * (0.14 + t * 0.72));
    const [px, pz] = L(u, 0);
    b.box('wood', wd, 0.6, 1.06, px, y + 0.72, pz, shade(0x8a6a3e, 0.94 + (i % 3) * 0.05), ry);   // 槎身分段
    b.box('wood', wd + 0.12, 0.16, 1.2, px, y + 1.06, pz, shade(0x6b4a2b, 1.04), ry);              // 舷板
    b.box('glow', wd * 0.62, 0.04, 0.05, px, y + 1.15, pz + 0.52, shade(0x9fe8ff, 0.55), ry);      // 云纹舷光
    b.box('glow', wd * 0.62, 0.04, 0.05, px, y + 1.15, pz - 0.52, shade(0x9fe8ff, 0.45), ry);
  }
  const [kx, kz] = L(0, 0);
  b.box('wood', 0.22, 0.3, 7.4, kx, y + 0.32, kz, shade(0x5a3a24, 1.06), ry);                      // 龙骨
  for (const su of [-1, 1]) {                                                                       // 首尾上翘
    const [px, pz] = L(su * 4.0, 0);
    b.box('wood', 0.5, 0.3, 1.5, px, y + 1.2, pz, shade(0x8a6a3e, 1.16), ry, su * 0.24);
    b.cyl('wood', 0.1, 0.14, 1.2, 6, px, y + 1.5, pz, shade(0x6b4a2b, 1.12), ry, su * 0.3);
  }
  for (let k = 0; k < 3; k++) {                                                                     // 椽篷三架（半圆拱肋 + 篷布）
    const [px, pz] = L(-1.4 + k * 1.4, 0);
    for (let j = 0; j < 5; j++) {
      const aa = (j / 4) * Math.PI;
      const zz = Math.cos(aa) * 0.66, yy = Math.sin(aa) * 0.5;
      b.box('wood', 0.09, 0.09, 0.46, px, y + 1.5 + yy, pz - zz, shade(0x6b4a2b, 1.06), ry, aa - Math.PI / 2);
      b.box('fabric', 0.1, 0.34, 0.42, px, y + 1.6 + yy * 0.92, pz - zz * 0.96, shade(0xb8a888, 0.92 + (j % 2) * 0.06), ry, aa - Math.PI / 2);
    }
  }
  const [rx0, rz0] = L(-1.4, 0);
  b.box('wood', 3.4, 0.1, 0.1, rx0, y + 2.0, rz0, shade(0x5a3a24, 1.12), ry);                       // 篷脊
  for (const sw of [-1, 1]) {                                                                        // 双橹
    const [px, pz] = L(-2.6, sw * 0.9);
    b.cyl('wood', 0.06, 0.08, 2.6, 6, px, y + 1.0, pz, shade(0x6b4a2b, 1.08), ry, 0, sw * 0.5);
    b.box('wood', 0.1, 0.5, 0.5, px, y + 0.22, pz, shade(0x7a5a36, 1.02), ry, 0, sw * 0.5);
  }
  for (let k = 0; k < 4; k++) {                                                                      // 槎尾云涛
    const [px, pz] = L(-4.3 - (k % 2) * 0.5, -0.5 + k * 0.34);
    b.cyl('fabric', 0.44, 0.62, 0.34, 8, px, y + 0.86 + (k % 2) * 0.12, pz, shade(0xdfeeff, 0.96 - k * 0.03), ry);
    b.cyl('glow', 0.3, 0.3, 0.06, 8, px, y + 1.02 + (k % 2) * 0.12, pz, shade(0x9fe8ff, 0.4), ry, 0, 0, true);
  }
  b.kit('sky.item.cloudRaft', 1, y);
}

/** 千瓣白玉莲台：莲蓬芯（九莲子）+ 六层千瓣环（外展 114 瓣，瓣尖透光）+ 圈下垂瓣 + 瓣间金光 + 莲座裙（主坛中央） */
// 千瓣白玉莲台：T-ITM-0069
function itmLotusThrone(b: Baker, x: number, y: number, z: number): void {
  // 与角色站立面（主坛鼓顶）齐平铺展：瓣环内径 ≥1.2，如来/观音站位不被吞没
  b.cyl('ash', 3.9, 4.4, 0.26, 20, x, y - 0.12, z, shade(0xe8e0d0, 0.94));                     // 莲座裙
  b.cyl('glow', 3.62, 3.62, 0.06, 20, x, y + 0.01, z, shade(0xffd25e, 0.62), 0, 0, 0, true);    // 瓣间金光
  const LAYER: [number, number, number, number, number][] = [
    // n, 半径, 高, 瓣宽, 外倾
    [14, 3.28, 0.16, 0.62, 0.16],
    [16, 2.92, 0.2, 0.54, 0.23],
    [18, 2.54, 0.24, 0.48, 0.31],
    [20, 2.16, 0.28, 0.42, 0.39],
    [22, 1.78, 0.32, 0.36, 0.47],
    [24, 1.42, 0.36, 0.3, 0.55],
  ];
  for (let li = 0; li < LAYER.length; li++) {
    const [n, r, hh, pw, tilt] = LAYER[li];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + li * 0.22;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      b.box('ash', pw, hh, 1.3 - li * 0.12, px, y + 0.04 + li * 0.035, pz, shade(0xfff8ef, 1.02 - li * 0.02), -a + Math.PI / 2, 0, tilt);
      b.box('glow', pw * 0.5, 0.05, 0.14, px + Math.cos(a) * 0.62, y + 0.06 + li * 0.035, pz + Math.sin(a) * 0.62, shade(0xffd25e, 0.5 + li * 0.05), -a + Math.PI / 2, 0, tilt);
    }
  }
  for (let k = 0; k < 12; k++) {                                                                  // 圈下垂瓣
    const a = (k / 12) * Math.PI * 2 + 0.26;
    b.box('ash', 0.52, 0.34, 0.9, x + Math.cos(a) * 3.7, y - 0.28, z + Math.sin(a) * 3.7, shade(0xe8dccc, 0.96), -a + Math.PI / 2, 0, -0.62);
  }
  b.cyl('ash', 1.16, 1.16, 0.22, 14, x, y + 0.11, z, shade(0xfff8ef, 1.06));                     // 莲蓬
  for (let k = 0; k < 9; k++) {                                                                    // 九莲子
    const a = (k / 9) * Math.PI * 2;
    b.cyl('glow', 0.07, 0.07, 0.04, 6, x + Math.cos(a) * 0.52, y + 0.23, z + Math.sin(a) * 0.52, shade(0xffd25e, 0.7));
  }
  b.kit('sky.item.lotusThrone', 1, y);
}

/** 檀香云炉：石座 + 三足 + 青铜炉身 + 云纹盖（九朵云瓣 + 云钮）+ 双耳 + 莲形香烟（坛前，恒常燃香） */
// 檀香云炉：T-ITM-0073
function itmSandalCenser(b: Baker, x: number, y: number, z: number): void {
  b.box('ash', 0.92, 0.22, 0.92, x, y + 0.11, z, shade(STON_L, 1.04));                       // 石座
  b.box('ash', 0.68, 0.08, 0.68, x, y + 0.26, z, shade(STON_L, 1.12));
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.5;
    b.cyl('metal', 0.08, 0.11, 0.3, 6, x + Math.cos(a) * 0.24, y + 0.45, z + Math.sin(a) * 0.24, shade(BRZD2, 0.92)); // 三足
  }
  b.cyl('metal', 0.42, 0.34, 0.46, 12, x, y + 0.83, z, shade(BRZ2, 1.06));                    // 炉身
  b.cyl('metal', 0.47, 0.47, 0.07, 12, x, y + 1.09, z, shade(BRZ2, 1.2));                     // 炉口
  for (const sx of [-1, 1]) b.box('metal', 0.1, 0.26, 0.07, x + sx * 0.44, y + 1.06, z, shade(BRZ2, 1.14), 0, 0, sx * 0.36); // 双耳
  for (let k = 0; k < 9; k++) {                                                                 // 云纹盖
    const a = (k / 9) * Math.PI * 2;
    b.box('metal', 0.24, 0.12, 0.22, x + Math.cos(a) * 0.26, y + 1.22, z + Math.sin(a) * 0.26, shade(BRZ2, 1.1 + (k % 2) * 0.08), -a);
  }
  b.cyl('metal', 0.16, 0.26, 0.16, 10, x, y + 1.34, z, shade(BRZ2, 1.16));
  b.cyl('metal', 0.07, 0.1, 0.12, 8, x, y + 1.47, z, shade(BRZD2, 1.08));                     // 云钮
  for (let k = 0; k < 5; k++) {                                                                 // 莲形香烟
    const a = (k / 5) * Math.PI * 2;
    b.cyl('glow', 0.11, 0.05, 0.34 + (k % 2) * 0.16, 6, x + Math.cos(a) * 0.14, y + 1.7 + (k % 2) * 0.1, z + Math.sin(a) * 0.14, shade(0xdfeeff, 0.34), 0, 0, 0, true);
  }
  b.kit('sky.item.sandalCenser', 1, y);
}

/** 迎宾茶灶：小红炉（三足朱漆 + 炭口火光）+ 铜壶 + 提梁 + 茶盘 + 天青茶盏二只 + 茶气（茶水间，醒神茶交互） */
// 迎宾茶灶：T-ITM-0079
function itmTeaStove(b: Baker, x: number, y: number, z: number): void {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.5;
    b.cyl('metal', 0.05, 0.07, 0.26, 6, x + Math.cos(a) * 0.24, y + 0.13, z + Math.sin(a) * 0.24, shade(BRZD2, 0.95)); // 三足
  }
  b.cyl('lacquer', 0.3, 0.32, 0.38, 12, x, y + 0.45, z, shade(0x8a2a20, 1.02));                 // 炉身
  b.cyl('metal', 0.32, 0.32, 0.05, 12, x, y + 0.66, z, shade(BRZD2, 1.06));                     // 炉口圈
  b.box('glow', 0.18, 0.13, 0.05, x, y + 0.36, z + 0.3, shade(0xff7f50, 0.86));                 // 炭口
  b.cyl('ceramic', 0.16, 0.19, 0.22, 10, x, y + 0.8, z, shade(0xd8c8b0, 1.02));                  // 铜壶（壶身）
  b.cyl('ceramic', 0.09, 0.13, 0.05, 8, x, y + 0.93, z, shade(0xd8c8b0, 1.1));
  b.box('ceramic', 0.2, 0.045, 0.05, x + 0.22, y + 0.82, z, shade(0xd8c8b0, 0.98), 0, 0, -0.32); // 壶嘴
  b.box('ceramic', 0.05, 0.15, 0.05, x - 0.19, y + 0.88, z, shade(0xd8c8b0, 0.98));              // 提梁
  b.cyl('glow', 0.06, 0.04, 0.12, 5, x, y + 1.02, z, shade(0xdfeeff, 0.35), 0, 0, 0, true);      // 茶气
  b.box('wood', 0.86, 0.07, 0.5, x + 0.72, y + 0.14, z, shade(0x8a6a3e, 1.06));                  // 茶盘
  for (let i = 0; i < 2; i++) {                                                                   // 天青茶盏二只
    b.cyl('ceramic', 0.09, 0.07, 0.09, 8, x + 0.56 + i * 0.3, y + 0.22, z - 0.16, shade(0x9fc8c8, 1.04));
    b.cyl('glow', 0.07, 0.07, 0.02, 8, x + 0.56 + i * 0.3, y + 0.27, z - 0.16, shade(0xd8f0e8, 0.6));
  }
  b.kit('sky.item.teaStove', 1, y);
}

/** 点卯玉牌：点卯案 + 刷光槽 + 三十六枚玉牌（三排十二列）+ 案头铜印 + 名牌签（门前点卯，每日彩蛋） */
// 点卯玉牌：T-ITM-0083
function itmRollCallTokens(b: Baker, x: number, y: number, z: number): void {
  b.box('wood', 2.5, 0.12, 0.86, x, y + 0.82, z, shade(0x6b4a2b, 1.08));                     // 案面
  b.box('wood', 2.62, 0.08, 0.98, x, y + 0.9, z, shade(0x5a3a24, 1.16));
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    b.box('wood', 0.13, 0.76, 0.13, x + su * 1.0, y + 0.38, z + sw * 0.3, shade(0x5a3a24, 0.94)); // 案腿
  }
  b.box('glow', 1.9, 0.03, 0.14, x, y + 0.95, z + 0.16, shade(0x9fe8ff, 0.6));                 // 刷光槽
  b.box('wood', 2.3, 0.9, 0.08, x, y + 1.42, z - 0.34, shade(0x3a4e6a, 1.14));                 // 牌架背板
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 12; col++) {
      const px = x - 1.0 + col * 0.18, py = y + 1.16 + row * 0.28;
      b.box('ash', 0.13, 0.22, 0.03, px, py, z - 0.28, shade(0xfff8ef, 0.95 + ((row + col) % 3) * 0.04)); // 玉牌
      b.box('glow', 0.09, 0.04, 0.02, px, py + 0.04, z - 0.26, shade(0x9fe8ff, 0.55));                      // 牌刻名讳（刷光）
    }
  }
  b.box('wood', 0.34, 0.2, 0.34, x + 1.02, y + 1.0, z + 0.24, shade(0x4a3220, 1.06));           // 铜印匣
  b.box('metal', 0.18, 0.12, 0.18, x + 1.02, y + 1.14, z + 0.24, shade(BRZ2, 1.06));            // 铜印
  b.kit('sky.item.rollCallTokens', 1, y);
}

/** 大罗天谶碑拓片：双柱碑架 + 横枋 + 展开拓片长卷（谶文行隐现）+ 上下卷轴 + 压卷玉镇（大罗宫未实装，寄置凌霄广场） */
// 大罗天谶碑拓片：T-ITM-0163
function itmOracleRubbing(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  for (const su of [-1, 1]) {
    const [px, pz] = L(su * 1.36, 0);
    b.box('ash', 0.36, 0.22, 0.52, px, y + 0.11, pz, shade(STON_L, 1.02), ry);                 // 柱础
    b.box('wood', 0.18, 2.5, 0.18, px, y + 1.36, pz, shade(0x4a3220, 1.06), ry);               // 碑架柱
  }
  b.box('wood', 3.14, 0.16, 0.2, x, y + 2.62, z, shade(0x4a3220, 1.14), ry);                   // 横枋
  b.box('fabric', 2.5, 1.44, 0.05, x, y + 1.78, z, shade(0xd8ccb8, 1.0), ry);                  // 拓片长卷
  for (const sw of [-1, 1]) {                                                                   // 上下卷轴
    const [px, pz] = L(0, sw * 0.05);
    b.cyl('wood', 0.08, 0.08, 2.62, 8, px, y + (sw > 0 ? 2.52 : 1.04), pz, shade(0x5a3a24, 1.1), 0, 0, Math.PI / 2);
  }
  for (let k = 0; k < 7; k++) {                                                                  // 谶文行（隐现）
    const [px, pz] = L(-0.86 + (k % 2) * 0.16, 0.04);
    const ink = k % 3 === 0;
    b.box('glow', 0.62 + (k % 3) * 0.34, 0.07, 0.02, px, y + 2.28 - k * 0.17, pz, ink ? shade(0xffd25e, 0.45) : shade(0x2a2a30, 0.9), ry);
  }
  const [jx, jz] = L(0.62, 0.16);
  b.box('ash', 0.2, 0.1, 0.2, jx, y + 1.06, jz, shade(JADEW3, 1.06), ry);                       // 压卷玉镇
  b.kit('sky.item.oracleRubbing', 1, y);
}

/** 三清讲经席：三重玉席（席面 + 席沿 + 前缘金线 + 中心云纹 + 四角玉钉）（讲经台未实装，寄置凌霄广场） */
// 三清讲经席：T-ITM-0164
function itmQingSeat(b: Baker, x: number, y: number, z: number, ry: number): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const L = (u: number, w: number): [number, number] => [x + ca * u - sa * w, z + sa * u + ca * w];
  b.box('ash', 0.88, 0.1, 0.88, x, y + 0.05, z, shade(0xfff8ef, 0.98), ry);                    // 玉席面
  b.box('ash', 1.0, 0.05, 1.0, x, y + 0.13, z, shade(0xdcdce8, 1.04), ry);                     // 席沿
  const [fx, fz] = L(0, 0.46);
  b.box('glow', 0.92, 0.02, 0.04, fx, y + 0.17, fz, shade(0xffd25e, 0.6), ry);                  // 前缘金线
  const [cx2, cz2] = L(0, 0);
  b.box('glow', 0.34, 0.02, 0.1, cx2, y + 0.17, cz2, shade(0xffd25e, 0.42), ry);                // 中心云纹
  b.box('glow', 0.12, 0.02, 0.3, cx2, y + 0.17, cz2, shade(0xffd25e, 0.42), ry);
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {                                          // 四角玉钉
    const [px, pz] = L(su * 0.44, sw * 0.44);
    b.cyl('metal', 0.04, 0.04, 0.05, 6, px, y + 0.18, pz, shade(BRZ2, 0.94), ry);
  }
  b.kit('sky.item.qingSeat', 1, y);
}

/** 九色光轮：铜托 + 立杆 + 外光环 + 铜圈 + 九色轮叶 + 外芒 + 中心宝珠（阙顶镇物，贵客到时加速） */
// 九色光轮：T-ITM-0173
function itmNineColorWheel(b: Baker, x: number, y: number, z: number): void {
  b.cyl('metal', 0.16, 0.28, 0.36, 8, x, y + 0.12, z, shade(BRZ2, 1.06));                       // 铜托
  b.cyl('metal', 0.09, 0.09, 1.05, 8, x, y + 0.72, z, shade(BRZ2, 1.12));                       // 立杆
  const NINE = [0xff3b30, 0xff9500, 0xffd60a, 0x34c759, 0x32ade6, 0x5856d6, 0xaf52de, 0xff2e88, 0xfff3d8];
  const wy = y + 1.62;
  b.cyl('glow', 1.34, 1.34, 0.1, 24, x, wy, z, shade(0xffd25e, 0.5), 0, Math.PI / 2, 0, true);  // 外光环
  b.cyl('metal', 1.1, 1.1, 0.05, 24, x, wy, z, shade(BRZ2, 0.86), 0, Math.PI / 2, 0, true);     // 铜圈
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    b.box('glow', 0.62, 0.26, 0.07, x + Math.cos(a) * 0.72, wy + Math.sin(a) * 0.72, z, NINE[k], 0, 0, a);      // 九色轮叶
    b.box('glow', 0.3, 0.1, 0.05, x + Math.cos(a) * 1.22, wy + Math.sin(a) * 1.22, z, NINE[k], 0, 0, a);        // 外芒
  }
  b.cyl('glow', 0.24, 0.24, 0.3, 10, x, wy, z, shade(0xfff3d8, 1.0), 0, Math.PI / 2);           // 中心宝珠
  b.cyl('metal', 0.1, 0.1, 0.44, 8, x, wy, z, shade(BRZ2, 1.2), 0, Math.PI / 2, 0);             // 轮轴（穿轮心，轴沿 z）
  b.kit('sky.item.nineColorWheel', 1, wy);
}


// ============ W18：按《天宫资产全录》10 卷 §三 补全 T-GZ-008~022（15 座） ============
// 判词（用户原话）：「按照文档要求……完善补全优化整个天宫建筑群」。
// 口径：
//  ① 中心坐标逐字取 10 卷（x/z 不改）；y 取已实装台面标高——凌霄台 214.12、广场与西侧 206.12；
//  ② 材质组只用白名单 wood/wall/ash/earth/roof/ground/glow/leaf/trunk/ceramic/metal/fabric/lacquer；
//     石材 0x7e7a8c、台面石作 0x86828f（线性 0.238 × 3.2 = 0.76 < 0.8）、瓦 0x333a45–0x5c6878，
//     金饰只取 palace 的 GOLD_ROOF / GOLD_TRIM / GOLD_LINE 三档，glow 只做匾心、灯牌、脊饰点光；
//  ③ 不新增 b.kit() id（本段不调 kit）、不新增材质、不消耗共享 rng（抖动用 skyJitter）；
//  ④ 屋顶一律 palace.skyRoofOn（垂脊/戗脊/瓦垄/瓦当/脊兽齐备），形制在三档里分配：
//     朝房歇山、御膳房歇山（灶间单坡 + 烟囱）、天库庑殿、武库庑殿、钟鼓楼攒尖、星宿府歇山。
const W18_STONE = 0x7e7a8c;
const W18_DECK = 0x86828f;
const W18_JOINT = 0x4a4760;
const W18_BRICK = 0x5a6472;
const W18_TILE = 0x5c6878;
const W18_WOOD = 0x6b4a2b;
const W18_WOOD_D = 0x4a3220;
const W18_RED = 0xa02818;
const W18_WHITE = 0xd8d4c8;

/** 台面石作：浅灰石墁地 + 两圈同心石缝（切向细条，只做环不做网格） */
function w18Deck(b: Baker, x: number, y: number, z: number, r: number): void {
  b.cyl('ash', r, r, 0.16, 22, x, y + 0.08, z, W18_DECK);
  for (const rr of [r * 0.5, r * 0.8]) {
    const n = Math.max(8, Math.round((Math.PI * 2 * rr) / 2.6));
    const len = ((Math.PI * 2 * rr) / n) * 1.04;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.box('ash', len, 0.03, 0.16, x + Math.cos(a) * rr, y + 0.165, z + Math.sin(a) * rr, W18_JOINT, Math.PI / 2 - a);
    }
  }
}

/**
 * 朝房（T-GZ-008 东 (40,206,50) / T-GZ-009 西 (-40,206,50)）：
 * 10 卷：面阔五间约 18m、进深 6m、高 5m；硬山廊房→前廊→值房三间；灰砖白墙、朱柱青瓦（西为黑柱）；
 * 前廊木栏朱漆；匾「文班待詔」/「武班待旨」+ 檐下班灯（青底金字「文」/ 黑底金字「武」）。
 * 面阔沿 z（朝房列在广场东西两侧，正面朝广场），三档形制里硬山取歇山最近。
 */
function buildCourtRoom(b: Baker, sg: SignMesher, atlas: SignAtlas, cx: number, cz: number, east: boolean): void {
  const ry = east ? -Math.PI / 2 : Math.PI / 2;
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (u: number, v: number): [number, number] => [cx + u * ca + v * sa, cz - u * sa + v * ca];
  const base = 206.12;                          // platform(±40,206,50,12) 台面
  const W = 18, D = 6, H = 5.0;
  const colC = east ? W18_RED : 0x26262c;
  const wallC = east ? W18_WHITE : 0xd0cabc;
  const tileC = east ? W18_TILE : shade(W18_TILE, 0.88);
  // ① 台基 18.8 × 0.7 × 7.6（前廊压在同一台明上）+ 台明石面
  b.box('ash', W + 0.8, 0.7, D + 1.6, cx, base + 0.35, cz, shade(W18_STONE, 0.98), ry);
  b.box('ash', W + 0.4, 0.1, D + 1.2, cx, base + 0.75, cz, W18_DECK, ry);
  const fy = base + 0.8;
  // ② 后墙 + 侧墙（灰砖白墙）
  { const [px, pz] = at(0, -D / 2); b.box('wall', W, H, 0.46, px, fy + H / 2, pz, wallC, ry); }
  for (const s of [-1, 1]) {
    const [px, pz] = at(s * W / 2, 0);
    b.box('wall', 0.46, H, D, px, fy + H / 2, pz, shade(wallC, 0.95), ry);
  }
  // ③ 前脸五间：明间开门（3.6m）、次梢四间墙 + 支摘窗
  const dw = 3.6;
  for (const s of [-1, 1]) {
    const uc = s * (dw / 2 + (W - dw) / 4);
    const [px, pz] = at(uc, D / 2);
    b.box('wall', (W - dw) / 2, H, 0.42, px, fy + H / 2, pz, wallC, ry);
    for (const o of [-1, 1]) {
      // 支摘窗：朝房只吃 ×2.2，预缩放上限 0.909m。旧版整块 2.3×1.7 会到 5.06×3.74m。
      // 本版 3×2 分格：每格 0.733×0.825 ×2.2 = 1.61×1.82m ≤2 ✔，格间 0.05（0.11m）朱漆棂。
      const uc2 = uc + (o * (W - dw)) / 5.2;
      const WW = 2.3, WH = Math.min(1.7, H * 0.34), GAP = 0.05;
      const nx = 3, ny = 2;
      const cw = (WW - GAP * (nx - 1)) / nx, ch = (WH - GAP * (ny - 1)) / ny;
      for (let ix = 0; ix < nx; ix++) {
        const ox = -WW / 2 + cw / 2 + ix * (cw + GAP);
        for (let iy = 0; iy < ny; iy++) {
          const oy = -WH / 2 + ch / 2 + iy * (ch + GAP);
          const [wx, wz] = at(uc2 + ox, D / 2 + 0.24);
          b.box('ground', cw, ch, 0.08, wx, fy + H * 0.58 + oy, wz, shade(W18_WOOD_D, 0.85), ry);
        }
      }
      for (let k = 1; k < nx; k++) {
        const ox = -WW / 2 + k * (cw + GAP) - GAP / 2;
        const [mx, mz] = at(uc2 + ox, D / 2 + 0.29);
        b.box('wood', GAP, WH, 0.10, mx, fy + H * 0.58, mz, shade(W18_WOOD, 1.06), ry);
      }
      for (let k = 1; k < ny; k++) {
        const oy = -WH / 2 + k * (ch + GAP) - GAP / 2;
        const [mx, mz] = at(uc2, D / 2 + 0.29);
        b.box('wood', WW, GAP, 0.10, mx, fy + H * 0.58 + oy, mz, shade(W18_WOOD, 1.06), ry);
      }
      const [sx, sz] = at(uc2, D / 2 + 0.24);
      b.box('wood', 2.6, 0.16, 0.22, sx, fy + H * 0.42, sz, shade(W18_WOOD, 1.06), ry);
    }
  }
  // 门框门扇（朱漆）+ 门钉
  for (const s of [-1, 1]) { const [px, pz] = at(s * dw / 2, D / 2 + 0.06); b.cyl('wood', 0.2, 0.26, H, 8, px, fy + H / 2, pz, shade(colC, 1.02), ry); }
  { const [px, pz] = at(0, D / 2 + 0.06); b.box('wood', dw + 0.3, 0.34, 0.34, px, fy + H - 0.2, pz, GOLD_TRIM, ry); }
  { const [px, pz] = at(0, D / 2 - 0.16); b.box('ground', dw * 0.92, H * 0.82, 0.1, px, fy + H * 0.41, pz, shade(W18_WOOD_D, 0.82), ry); }
  for (let k = 0; k < 3; k++) {
    const [px, pz] = at((k - 1) * dw * 0.26, D / 2 - 0.1);
    b.box('metal', 0.09, 0.09, 0.06, px, fy + H * 0.5, pz, GOLD_TRIM, ry);
  }
  // ④ 前廊六柱（五间分柱）+ 朱漆木栏（明间留空）
  for (let i = 0; i < 6; i++) {
    const u = -W / 2 + (W * i) / 5;
    const [px, pz] = at(u, D / 2 + 0.95);
    b.cyl('wood', 0.24, 0.3, H, 7, px, fy + H / 2, pz, shade(colC, 1.04), ry);
    b.cyl('wood', 0.27, 0.27, 0.18, 7, px, fy + H - 0.12, pz, GOLD_TRIM, ry);
    b.cyl('ash', 0.33, 0.37, 0.22, 7, px, fy + 0.11, pz, shade(W18_STONE, 1.04), ry);
  }
  for (let i = 0; i < 5; i++) {
    if (i === 2) continue;                      // 明间（中央一间）留作入口
    const uc = -W / 2 + (W * (i + 0.5)) / 5;
    const [px, pz] = at(uc, D / 2 + 0.95);
    b.box('wood', W / 5 - 0.1, 0.16, 0.12, px, fy + 0.92, pz, shade(W18_RED, 1.0), ry);
    b.box('wood', W / 5 - 0.1, 0.12, 0.1, px, fy + 0.42, pz, shade(W18_RED, 0.92), ry);
    for (let k = 0; k < 3; k++) {
      const [vx, vz] = at(uc - (W / 10) * 0.62 + k * (W / 10) * 0.62, D / 2 + 0.95);
      b.box('wood', 0.1, 0.62, 0.1, vx, fy + 0.62, vz, shade(W18_RED, 1.06), ry);
    }
  }
  // ⑤ 额枋 + 檐下歇山顶（skyRoofOn）
  for (const s of [-1, 1]) {
    const [px, pz] = at(0, s * (D / 2 + 0.75));
    b.box('wood', W + 0.9, 0.46, 0.4, px, fy + H - 0.16, pz, GOLD_TRIM, ry);
  }
  skyRoofOn(b, cx, fy + H + 0.2, cz, W + 2.8, D + 2.4, 2.5, ry, 'xieshan', tileC, GOLD_TRIM);
  // ⑥ 匾额 + 班灯（青底金字「文」/ 黑底金字「武」）
  { const [px, pz] = at(0, D / 2 + 1.15);
    sg.quad(atlas.text(east ? 'w18cfE' : 'w18cfW', east ? '文班待詔' : '武班待旨', 260, 64,
      { color: '#ffe9b8', glow: '#ffd25e', bg: east ? 'rgba(10,22,34,0.9)' : 'rgba(8,8,10,0.92)', border: 'rgba(255,210,94,.85)', fontPx: 46 }),
      4.2, 1.1, px, fy + H * 0.82, pz, ry); }
  { const [px, pz] = at(W / 2 + 1.9, D / 2 + 0.9);
    b.box('wood', 0.7, 1.5, 0.14, px, fy + H * 0.66, pz, east ? 0x223a5e : 0x101014, ry);
    b.box('glow', 0.56, 1.32, 0.05, px, fy + H * 0.66, pz, east ? 0x88abda : 0x2a2a30, ry);
    const [sx2, sz2] = at(W / 2 + 2.0, D / 2 + 0.9);
    sg.quad(atlas.text(east ? 'w18cfCharE' : 'w18cfCharW', east ? '文' : '武', 96, 96,
      { color: east ? '#ffe9b8' : '#ffd25e', glow: east ? '#88abda' : '#ffd25e', fontPx: 66, bg: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)' }),
      1.0, 1.0, sx2, fy + H * 0.66, sz2, ry); }
  void colC;
}

/**
 * 御膳房（T-GZ-010 (75,206,70)）：10 卷 全院 30×22、灶间面阔 7 间、后园 12×10；
 * 砖木构、青瓦朱柱、灶间前脸贴耐火云纹砖、烟囱出五色炊烟、匾「天廚」（匾由 palace 已建）。
 * 正堂（12×8 + 三灶列 + 茶树）已在 palace.buildTianfuAnnex，本段只补院落：台明 / 院墙 / 门楼 /
 * 灶间前脸 / 冰鉴房 / 茶房 / 烟囱 / 后园圃垣。
 */
function buildKitchenCourt(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const X = 75, Z = 70, Y = 206;
  const HW = 15, HD = 11;                        // 30×22 的全院半宽
  // ① 台明：石墁地（顶面 206.0，与 palace 器物垫板 206.12 同一基准） + 须弥座
  b.box('ash', HW * 2, 0.5, HD * 2, X, Y - 0.25, Z, shade(W18_STONE, 0.96));
  b.box('ash', HW * 2 + 1.2, 1.1, HD * 2 + 1.2, X, Y - 0.55, Z, shade(W18_STONE, 0.9));
  for (const o of [-7.2, 0, 7.2]) b.box('ash', 0.14, 0.03, HD * 2 - 1.2, X + o, Y + 0.015, Z, W18_JOINT);
  // ② 院墙（青砖 0.45 厚 2.8 高，南面留 4.6m 门洞）
  const wH = 2.8, wT = 0.45;
  b.box('wall', HW * 2, wH, wT, X, Y + wH / 2, Z + HD, W18_BRICK);
  b.box('wall', HW * 2, wH, wT, X, Y + wH / 2, Z - HD, W18_BRICK);
  for (const s of [-1, 1]) {
    b.box('wall', wT, wH, HD * 2, X + s * HW, Y + wH / 2, Z, shade(W18_BRICK, 0.96));
    b.box('wall', (HW * 2 - 4.6) / 2, wH, wT, X + s * (4.6 + (HW * 2 - 4.6) / 2) / 2 * 1.0, Y + wH / 2, Z - HD, shade(W18_BRICK, 1.02));
  }
  // ③ 门楼（门洞 4.6：双门柱 + 门额 + 小歇山顶）
  for (const s of [-1, 1]) b.cyl('wood', 0.26, 0.32, wH + 1.1, 8, X + s * 2.5, Y + (wH + 1.1) / 2, Z - HD, shade(W18_RED, 1.04));
  b.box('wood', 5.6, 0.42, 0.5, X, Y + wH + 0.9, Z - HD, GOLD_TRIM);
  b.box('wood', 4.6, 1.1, 0.16, X, Y + wH + 1.9, Z - HD, shade(W18_WOOD_D, 1.02));
  b.box('glow', 4.0, 0.7, 0.05, X, Y + wH + 1.9, Z - HD - 0.1, GOLD_LINE);
  skyRoofOn(b, X, Y + wH + 2.5, Z - HD, 7.4, 3.6, 1.5, 0, 'xieshan', W18_TILE, GOLD_TRIM);
  sg.quad(atlas.text('w18tcGate', '天廚', 170, 62, { color: '#ffe9b8', glow: '#ffd25e', bg: 'rgba(12,8,4,0.9)', border: 'rgba(255,210,94,.85)', fontPx: 46 }),
    2.6, 0.95, X, Y + wH + 1.9, Z - HD - 0.2, Math.PI);
  // ④ 灶间前脸：耐火云纹砖背屏立在灶列（74.5）之后 1.9m（76.4），三灶成壁龛；云纹刻线两道
  b.box('wall', 12.6, 2.6, 0.5, X, Y + 1.3, Z + 6.4, shade(0x6a5a4a, 1.0));
  for (let k = 0; k < 7; k++) {
    b.box('ground', 1.2, 0.16, 0.06, X - 5.4 + k * 1.8, Y + 1.9, Z + 6.12, shade(W18_WOOD_D, 0.9), 0, 0, Math.PI / 4);
    b.box('ground', 1.2, 0.16, 0.06, X - 5.4 + k * 1.8, Y + 0.8, Z + 6.12, shade(W18_WOOD_D, 0.9), 0, 0, Math.PI / 4);
  }
  // ⑤ 冰鉴房（西）/ 茶房（东）：各 5×8 砖房 + 单坡顶 + 板门
  const side = (sx: number, sz: number): void => {
    b.box('ash', 5.6, 0.5, 8.6, sx, Y + 0.25, sz, shade(W18_STONE, 0.98));
    b.box('wall', 5, 3.2, 0.4, sx, Y + 2.1, sz + 4, shade(W18_BRICK, 1.04));
    b.box('wall', 5, 3.2, 0.4, sx, Y + 2.1, sz - 4, shade(W18_BRICK, 1.04));
    for (const s2 of [-1, 1]) b.box('wall', 0.4, 3.2, 8, sx + s2 * 2.5, Y + 2.1, sz, shade(W18_BRICK, 0.96));
    b.box('roof', 6.0, 0.22, 9.0, sx, Y + 3.85, sz, shade(W18_TILE, 0.92), 0, 0.14);
    b.box('wood', 1.4, 2.4, 0.14, sx, Y + 1.2, sz + 4.1, shade(W18_WOOD_D, 0.95));
  };
  side(X - 11.6, Z + 2);
  side(X + 11.6, Z - 3);
  // ⑥ 烟囱（1.8×7.2×1.8 青砖 + 五色炊烟）：10 卷「烟囱出五色炊烟（随菜色变化）」；
  //    立在灶列东端（86.6, 74.6），从灶间壁龛旁起烟，不压后园茶树
  b.box('wall', 1.8, 7.2, 1.8, X + 11.6, Y + 3.6, Z + 4.6, shade(W18_BRICK, 1.06));
  b.box('ash', 2.1, 0.3, 2.1, X + 11.6, Y + 7.3, Z + 4.6, shade(W18_STONE, 1.02));
  const SMOKE = [0xff7f50, 0xffd25e, 0x8fd8a0, 0x8fb8e8, 0xc8a0e8];
  for (let k = 0; k < 5; k++) {
    b.cyl('glow', 0.26 - k * 0.03, 0.2 - k * 0.02, 0.5, 6, X + 11.6 + (skyJitter(k, 71.3) - 0.5) * 1.4, Y + 7.7 + k * 0.55, Z + 4.6 + (skyJitter(k, 72.9) - 0.5) * 1.4, shade(SMOKE[k], 0.62), 0, 0, 0, true);
  }
  // ⑦ 后园圃垣：南边由灶间背屏（z=76.4）充当界墙，另补北 / 东 / 西三条矮石沿 + 两盏石灯；
  //    茶树由 palace 已种在 (66..78, 77.5)，圃区正好包住
  b.box('ash', 18, 0.34, 0.28, X, Y + 0.17, Z + 10.4, shade(W18_STONE, 1.02));
  for (const s of [-1, 1]) {
    b.box('ash', 0.28, 0.34, 4.0, X + s * 9, Y + 0.17, Z + 8.4, shade(W18_STONE, 1.02));
    b.cyl('ash', 0.24, 0.3, 1.3, 6, X + s * 7.6, Y + 0.65, Z - 4.4, shade(W18_STONE, 1.04));
    b.box('glow', 0.26, 0.3, 0.26, X + s * 7.6, Y + 1.45, Z - 4.4, shade(0xffd25e, 0.55));
  }
}

/**
 * 天库（T-GZ-011 (-75,207,75)）：10 卷 全院 26×20、主库面阔 5 间、墙高 4.5m、青砖厚墙、铁力木门包铜、
 * 三进库房 + 守库房 + 天平间；墙头夜有符光巡更线；匾「天庫」由 palace 已建。正堂本体不复制。
 */
function buildTreasureCourt(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const X = -75, Z = 75, Y = 207;
  const HW = 13, HD = 10;                        // 26×20
  b.box('ash', HW * 2, 0.5, HD * 2, X, Y - 0.25, Z, shade(W18_STONE, 0.94));
  b.box('ash', HW * 2 + 1.2, 1.2, HD * 2 + 1.2, X, Y - 0.6, Z, shade(W18_STONE, 0.88));
  const wH = 4.5, wT = 0.55;                     // 10 卷：墙高 4.5m、青砖厚墙
  b.box('wall', HW * 2, wH, wT, X, Y + wH / 2, Z + HD, W18_BRICK);
  b.box('wall', HW * 2, wH, wT, X, Y + wH / 2, Z - HD, W18_BRICK);
  // 东墙留库门洞（4.2 宽）：拆两段 + 门额墙，西墙整片
  b.box('wall', wT, wH, HD * 2, X - HW, Y + wH / 2, Z, shade(W18_BRICK, 0.96));
  for (const s of [-1, 1]) {
    b.box('wall', wT, wH, HD - 2.1, X + HW, Y + wH / 2, Z + s * (2.1 + (HD - 2.1) / 2), shade(W18_BRICK, 0.96));
  }
  // 符光巡更线：墙头四道细 glow（10 卷「墙头夜有符光巡更线」）
  for (const s of [-1, 1]) {
    b.box('glow', HW * 2 - 0.6, 0.1, 0.06, X, Y + wH + 0.05, Z + s * HD, shade(0x7fd8ff, 0.5));
    b.box('glow', 0.06, 0.1, HD * 2 - 0.6, X + s * HW, Y + wH + 0.05, Z, shade(0x7fd8ff, 0.5));
  }
  // 库门（东墙 x=-62）：门洞 4.2、铁力木门包铜双扇 + 门枕石 + 貔貅门墩 ×2
  b.box('wall', wT, wH - 3.4, 4.2, X + HW, Y + 3.4 + (wH - 3.4) / 2, Z, W18_BRICK);
  for (const s of [-1, 1]) b.box('wood', 0.22, 3.4, 1.95, X + HW, Y + 1.7, Z + s * 1.0, shade(W18_WOOD_D, 0.9));
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
    b.box('metal', 0.06, 0.1, 0.34, X + HW + 0.14, Y + 0.7 + k * 1.0, Z - 1.5 + j * 1.4, shade(GOLD_TRIM, 0.9));
  }
  b.box('ash', 0.9, 0.4, 5.2, X + HW - 0.4, Y + 0.2, Z, shade(W18_STONE, 1.0));
  for (const s of [-1, 1]) {
    b.box('ash', 1.2, 0.9, 1.2, X + HW - 0.4, Y + 0.45, Z + s * 4.4, shade(W18_STONE, 1.04));
    b.box('glow', 0.14, 0.1, 0.14, X + HW - 0.4, Y + 0.95, Z + s * 4.4, shade(GOLD_LINE, 0.8));
  }
  // 三进库房：北廊房 20×4.2 + 南廊房 12×4.2（各带单坡顶），守库房 6×6（西南角）
  const wing = (wx: number, wz: number, ww: number, wd: number): void => {
    b.box('wall', ww, 3.4, wd, wx, Y + 1.7, wz, shade(W18_BRICK, 1.02));
    b.box('roof', ww + 1.0, 0.2, wd + 1.2, wx, Y + 3.55, wz, shade(W18_TILE, 0.94), 0, 0.13);
    for (const s2 of [-1, 1]) b.box('wood', 0.22, 2.6, 0.16, wx + s2 * (ww / 2 - 0.8), Y + 1.3, wz + wd / 2 + 0.2, shade(W18_WOOD_D, 0.96));
  };
  wing(X, Z + 7.2, 20, 4.2);
  wing(X, Z - 7.4, 12, 4.0);
  wing(X - 9.0, Z - 2.0, 6, 6);
  // 天平间标识（仙衡天平本体在 palace）：石台 + 玉盘
  b.box('ash', 2.4, 0.5, 2.4, X + 3.0, Y + 0.25, Z - 4.4, shade(W18_STONE, 1.06));
  b.cyl('ash', 0.7, 0.8, 0.2, 12, X + 3.0, Y + 5.6, Z - 4.4, shade(W18_DECK, 1.04));
}

/**
 * 武库（T-GZ-012 (-75,206,15)）：10 卷 全院 28×24、大库面阔 7 间、梁下高 6m、厚墙铁门、
 * 门前立石戟架、地铺粗石、演武小院；匾「武庫」由 palace 已建。正堂本体不复制。
 */
function buildArmoryCourt(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const X = -75, Z = 15, Y = 206;
  const HW = 14, HD = 12;                        // 28×24
  b.box('ash', HW * 2, 0.5, HD * 2, X, Y - 0.25, Z, shade(W18_STONE, 0.92));
  b.box('ash', HW * 2 + 1.4, 1.3, HD * 2 + 1.4, X, Y - 0.65, Z, shade(W18_STONE, 0.86));
  const wH = 4.0, wT = 0.7;                      // 厚墙 0.7
  b.box('wall', HW * 2, wH, wT, X, Y + wH / 2, Z + HD, shade(W18_BRICK, 0.94));
  b.box('wall', HW * 2, wH, wT, X, Y + wH / 2, Z - HD, shade(W18_BRICK, 0.94));
  // 东墙留铁门洞（4.6）：拆两段 + 门额墙；西墙整片
  b.box('wall', wT, wH, HD * 2, X - HW, Y + wH / 2, Z, shade(W18_BRICK, 0.9));
  for (const s of [-1, 1]) {
    b.box('wall', wT, wH, HD - 2.3, X + HW, Y + wH / 2, Z + s * (2.3 + (HD - 2.3) / 2), shade(W18_BRICK, 0.9));
  }
  // 铁门（东墙 x=-61）：门洞 4.6 + 两扇玄铁门 + 门钉 + 门额
  b.box('wall', wT, wH - 3.6, 4.6, X + HW, Y + 3.6 + (wH - 3.6) / 2, Z, shade(W18_BRICK, 1.0));
  for (const s of [-1, 1]) {
    b.box('metal', 0.24, 3.4, 2.1, X + HW, Y + 1.7, Z + s * 1.05, shade(0x4a5060, 1.0));
    for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) b.box('metal', 0.07, 0.12, 0.12, X + HW + 0.16, Y + 0.8 + k * 1.0, Z + s * (0.5 + j * 1.0), shade(GOLD_TRIM, 0.86));
  }
  b.box('wood', 5.4, 0.34, 0.3, X + HW + 0.1, Y + wH, Z, GOLD_TRIM, Math.PI / 2);
  // 侧库房：甲胄库（北）/ 阵器房（南），各 7×6 × 3.8；贴西院墙内侧（x -88.5..-81.5），
  // 与 13m 宽的正堂（x -81.5..-68.5）正好相接不互咬
  const wing = (wz: number): void => {
    b.box('wall', 7, 3.8, 6, X - 10, Y + 1.9, wz, shade(W18_BRICK, 1.0));
    b.box('roof', 8.0, 0.22, 7.0, X - 10, Y + 3.98, wz, shade(W18_TILE, 0.9), 0, 0.14);
    b.box('wood', 1.6, 2.8, 0.14, X - 10, Y + 1.4, wz + 3.1, shade(W18_WOOD_D, 0.94));
  };
  wing(Z + 7.6);
  wing(Z - 7.6);
  // 演武小院：粗石地坪 + 五道步位刻线（10 卷「地铺粗石划演武步位」），落在正堂与东院墙之间的 6.4m 带
  b.box('ash', 6.4, 0.08, 7, X + 10, Y + 0.04, Z, shade(W18_STONE, 0.84));
  for (let k = 0; k < 5; k++) b.box('ash', 0.12, 0.03, 6.2, X + 7.6 + k * 1.2, Y + 0.09, Z, W18_JOINT);
  // 石戟架 ×2（门内两侧，10 卷「门前立石戟架」）
  for (const s of [-1, 1]) {
    const gx = X + HW - 3.4, gz = Z + s * 4.6;
    b.box('ash', 0.9, 0.5, 2.4, gx, Y + 0.25, gz, shade(W18_STONE, 1.04));
    for (let k = 0; k < 3; k++) {
      b.box('wood', 0.08, 2.8, 0.08, gx, Y + 1.4, gz - 0.8 + k * 0.8, shade(W18_WOOD, 1.06));
      b.box('metal', 0.34, 0.24, 0.06, gx + 0.16, Y + 2.62, gz - 0.8 + k * 0.8, shade(0x9aa6b8, 1.0), 0, 0, -0.22);
      b.box('fabric', 0.16, 0.3, 0.05, gx, Y + 2.2, gz - 0.8 + k * 0.8, shade(W18_RED, 0.9));
    }
  }
}

/**
 * 钟楼（T-GZ-013 (28,207,88)）/ 鼓楼（T-GZ-014 (-28,207,88)）：
 * 10 卷：台基 8×8 高 3m → 楼身两层 8m → 悬钟/悬鼓层 4m → 楼顶十字脊鎏金宝顶；
 * 匾「晨鐘醒世」/「暮鼓催雲」；钟为玄铜（钟高 2.4m）、鼓面径 1.8m。
 * 形制按三档取「攒尖」（四坡同陡 + 鎏金宝顶，方形钟鼓楼最贴）；台基按台面尺度收到 1.6m。
 * y 落在凌霄台面 214.12（文档 207 是旧广场面，照 207 建会被整台埋掉 7m——见交付报告风险节）。
 */
function buildBellDrumTower(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, z: number, isBell: boolean): void {
  const y0 = 214.12;
  const tileC = isBell ? 0x3f6f6a : 0x6a4a3a;    // 钟楼青绿瓦 / 鼓楼赭瓦（同制不同色，航拍可分辨）
  const tileD = shade(tileC, 0.78);
  b.box('ash', 8.2, 1.6, 8.2, x, y0 + 0.8, z, shade(W18_STONE, 0.98));
  b.box('ash', 7.6, 0.12, 7.6, x, y0 + 1.66, z, W18_DECK);
  const fy = y0 + 1.72;
  // 一层楼身 6.6×6.6×5.2（青砖墙 + 南面门洞 + 板门 + 门钉），四角朱柱
  b.box('wall', 6.6, 5.2, 0.5, x, fy + 2.6, z + 3.05, W18_BRICK);
  for (const s of [-1, 1]) b.box('wall', 0.5, 5.2, 6.6, x + s * 3.05, fy + 2.6, z, shade(W18_BRICK, 0.94));
  for (const s of [-1, 1]) b.box('wall', 2.0, 5.2, 0.5, x + s * 2.3, fy + 2.6, z - 3.05, shade(W18_BRICK, 1.02));
  b.box('wall', 2.6, 0.9, 0.5, x, fy + 4.75, z - 3.05, shade(W18_BRICK, 1.02));
  b.box('wood', 2.3, 3.9, 0.14, x, fy + 1.95, z - 3.12, shade(W18_WOOD_D, 0.86));
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
    b.box('metal', 0.1, 0.1, 0.06, x - 0.7 + k * 0.7, fy + 1.2 + j * 1.1, z - 3.2, shade(GOLD_TRIM, 0.92));
  }
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    b.cyl('wood', 0.26, 0.32, 5.2, 7, x + s * 3.3, fy + 2.6, z + t * 3.3, shade(W18_RED, 1.04));
  }
  // 腰檐（四面挑檐板，外沿下压）
  for (const s of [-1, 1]) {
    b.box('roof', 8.2, 0.22, 1.7, x, fy + 5.05, z + s * 3.95, tileD, 0, 0, s * 0.32);
    b.box('roof', 1.7, 0.22, 8.2, x + s * 3.95, fy + 5.05, z, tileD, 0, -s * 0.32, 0);
  }
  // 平座 + 敞亭四柱 + 额枋 + 栏板
  const py = fy + 5.35;
  b.box('ash', 6.2, 0.24, 6.2, x, py, z, shade(W18_STONE, 1.06));
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    b.cyl('wood', 0.24, 0.3, 3.4, 7, x + s * 2.6, py + 1.7, z + t * 2.6, shade(W18_RED, 1.06));
  }
  for (const s of [-1, 1]) {
    b.box('wood', 5.8, 0.4, 0.3, x, py + 3.3, z + s * 2.6, GOLD_TRIM);
    b.box('wood', 0.3, 0.4, 5.8, x + s * 2.6, py + 3.3, z, GOLD_TRIM);
    b.box('wood', 5.4, 0.5, 0.16, x, py + 0.36, z + s * 2.6, shade(W18_WOOD_D, 1.0));
    b.box('wood', 0.16, 0.5, 5.4, x + s * 2.6, py + 0.36, z, shade(W18_WOOD_D, 1.0));
  }
  // 攒尖顶（skyRoofOn：垂脊/瓦垄/瓦当/鎏金宝顶）
  skyRoofOn(b, x, py + 3.5, z, 6.8, 6.8, 4.2, 0, 'zanjian', tileC, GOLD_TRIM);
  if (isBell) {
    // 万年玄铜晨钟（T-ITM-0103）：吊杆 + 蒲牢钮 + 钟身 2.4m + 钟口 + 两道星名铭带
    b.cyl('metal', 0.1, 0.1, 1.0, 6, x, py + 3.15, z, shade(GOLD_TRIM, 1.1));
    b.cyl('metal', 0.5, 0.62, 0.3, 10, x, py + 2.6, z, shade(0x8a7a4a, 1.1));
    b.cyl('metal', 0.85, 1.15, 2.2, 14, x, py + 1.42, z, shade(0x6a6a4a, 1.06));
    b.cyl('metal', 1.18, 1.2, 0.14, 14, x, py + 0.38, z, shade(0x6a6a4a, 1.16));
    for (const hh of [1.15, 1.85]) {
      b.cyl('metal', 0.9 + hh * 0.08, 0.92 + hh * 0.08, 0.08, 14, x, py + hh, z, shade(GOLD_TRIM, 0.9));
    }
  } else {
    // 日月催更鼓（T-ITM-0108）：双柱鼓架 + 横枋 + 朱漆鼓身 + 双面革 + 十六鼓钉
    for (const s of [-1, 1]) {
      b.box('wood', 0.2, 1.5, 0.2, x + s * 1.15, py + 0.85, z, shade(W18_WOOD_D, 1.04));
      b.box('wood', 0.28, 0.16, 1.5, x + s * 1.15, py + 0.1, z, shade(W18_WOOD_D, 0.94));
    }
    b.box('wood', 2.6, 0.16, 0.2, x, py + 1.56, z, shade(W18_WOOD_D, 1.1));
    b.cyl('lacquer', 0.9, 0.9, 1.1, 16, x, py + 1.1, z, shade(0x8a2a20, 1.02), 0, Math.PI / 2);
    for (const s of [-1, 1]) {
      b.cyl('fabric', 0.92, 0.92, 0.05, 16, x, py + 1.1, z + s * 0.56, shade(0xd8c8a0, 1.02), 0, Math.PI / 2);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.box('metal', 0.09, 0.09, 0.05, x + Math.cos(a) * 0.76, py + 1.1 + Math.sin(a) * 0.76, z + s * 0.6, shade(GOLD_TRIM, 0.9));
      }
    }
  }
  // 长明灯 ×2（T-ITM-0106，顶层两角指位灯）
  for (const s of [-1, 1]) {
    b.cyl('metal', 0.12, 0.16, 0.5, 8, x + s * 2.4, py + 3.5, z - 2.4, shade(GOLD_TRIM, 1.06));
    b.cyl('glow', 0.14, 0.1, 0.2, 8, x + s * 2.4, py + 3.86, z - 2.4, GOLD_LINE);
  }
  sg.quad(atlas.text(isBell ? 'w18bell' : 'w18drum', isBell ? '晨鐘醒世' : '暮鼓催雲', 220, 64,
    { color: '#ffe9b8', glow: '#ffd25e', bg: 'rgba(10,10,16,0.9)', border: 'rgba(255,210,94,.85)', fontPx: 46 }),
    3.4, 1.0, x, fy + 4.3, z - 3.34, Math.PI);
}

/**
 * 星宿八府（T-GZ-015~022）：每府一座独立小岛（岛径 24–27m，岩体裙边只读调用 palace.buildIslandSkirt），
 * 岛面石作 + 岛缘望柱寻杖 + 登岛石阶；府 = 台基 + 三间正堂（skyRoofOn 歇山）+ 匾额（府名）+ 星宿旗。
 * 旗色按四方：东青 0x2f6f5a / 西白 0xdfe4ea / 北玄 0x1e2230。
 * 注：八府分属东（角·亢·心）、西（奎·昴·毕）、北（斗牛·虚）三宫，南宫七宿无一在八府之内，
 *     故本版未用赤旗——不是漏做，是设定里没有南宫府。
 */
function buildStarPalaces(b: Baker, sg: SignMesher, atlas: SignAtlas): void {
  const EAST = 0x2f6f5a, WEST = 0xdfe4ea, NORTH = 0x1e2230;
  // [府名, 匾, x, z, 台面 y, 岛半径（岛径 22–26m，两列间距 50m 留 2–4m 净空）, 旗色, 标识件 0..7]
  const LIST: [string, string, number, number, number, number, number, number][] = [
    ['角木蛟府', '角宿府', -220, 80, 209, 24, EAST, 0],
    ['奎木狼府', '奎宿府', -230, 30, 209, 23, WEST, 2],
    ['斗牛宮', '斗牛宮', -225, -20, 210, 25, NORTH, 3],
    ['虛日鼠府', '虛日府', -215, -70, 208, 23, NORTH, 7],
    ['亢金龍府', '亢宿府', 220, 80, 209, 24, EAST, 1],
    ['昴日雞宮', '昴日宮', 230, 30, 209, 23, WEST, 4],
    ['心月狐府', '心宿府', 225, -20, 210, 24, EAST, 5],
    ['畢月烏府', '畢宿府', 215, -70, 208, 23, WEST, 6],
  ];
  for (let i = 0; i < LIST.length; i++) {
    const [nm, sign, x, z, y, r, flagC, sig] = LIST[i];
    const seed = 1701 + i * 37;
    const a = Math.atan2(z, x);
    const ry = (Math.PI * 3) / 2 - a;            // 面朝环心（与 expansion.hIsland 同一套口径）
    starIsland(b, x, y, z, r, a, seed);
    starHall(b, sg, atlas, x, y + 0.16, z, ry, flagC, sig, seed, i, nm, sign);
  }
}

/** 星宿府小岛：石座 + 石作台面 + 岛缘望柱寻杖 + 登岛三级石阶 + 岩体裙边（只读调用） */
function starIsland(b: Baker, x: number, y: number, z: number, r: number, a: number, seed: number): void {
  b.cyl('ash', r * 0.975, r * 0.93, 2.4, 20, x, y - 1.15, z, W18_STONE);
  b.cyl('ash', r * 0.93, r * 0.87, 1.8, 20, x, y - 3.25, z, shade(W18_STONE, 0.88));
  w18Deck(b, x, y, z, r * 0.962);
  b.cyl('ash', r, r, 0.26, 22, x, y - 0.04, z, shade(W18_DECK, 1.06));
  // 岛缘：望柱 ≈5m 一根 + 上下两道寻杖，登岛口（朝环心）与瀑布口留空
  const rim = r * 0.952;
  const n = Math.max(8, Math.round((Math.PI * 2 * rim) / 5));
  const inA = a + Math.PI;
  const fallA = islandFallAngle(seed);
  const gap = Math.asin(Math.min(1, 2.4 / rim));
  const near = (aa: number, cc: number, ww: number): boolean =>
    Math.abs(Math.atan2(Math.sin(aa - cc), Math.cos(aa - cc))) < ww;
  for (let i = 0; i < n; i++) {
    const aa = (i / n) * Math.PI * 2;
    if (near(aa, inA, gap) || near(aa, fallA, 0.12)) continue;
    const px = x + Math.cos(aa) * rim, pz = z + Math.sin(aa) * rim;
    b.box('ash', 0.3, 1.0, 0.3, px, y + 0.5, pz, shade(W18_DECK, 1.02), -aa);
    b.box('ash', 0.42, 0.12, 0.42, px, y + 1.06, pz, shade(W18_DECK, 1.12), -aa);
  }
  const chord = 2 * rim * Math.sin(Math.PI / n);
  for (const hy of [0.42, 0.84]) {
    for (let i = 0; i < n; i++) {
      const am = ((i + 0.5) / n) * Math.PI * 2;
      if (near(am, inA, gap) || near(am, fallA, 0.12)) continue;
      b.box('ash', chord * 1.04, 0.1, 0.12, x + Math.cos(am) * rim, y + hy, z + Math.sin(am) * rim, shade(W18_DECK, 0.98), Math.PI / 2 - am);
    }
  }
  // 登岛三级石阶 + 阶下石托（石托内缘贴石座面 0.972r，外缘托住最外一级，不悬空）
  const ca = Math.cos(inA), sa = Math.sin(inA);
  for (let k = 0; k < 3; k++) {
    const rad = r * 0.972 + 0.55 + k * 1.05;
    b.box('ash', 3.6 - k * 0.3, 0.34, 1.1, x + ca * rad, y + 0.13 - 0.34 * (k + 0.5), z + sa * rad, shade(W18_DECK, 1.02 - k * 0.05), Math.PI / 2 - inA);
  }
  b.box('ash', 2.0, 1.6, 2.6, x + ca * (r * 0.972 + 1.3), y - 1.1, z + sa * (r * 0.972 + 1.3), shade(W18_STONE, 0.92), Math.PI / 2 - inA);
  buildIslandSkirt(b, x, y, z, r, seed, 7.6, 1, 9);
  buildIslandKeel(b, x, y, z, r, seed);
}

/** 星宿府正堂：台基 + 三间正堂（歇山）+ 匾 + 星宿旗 + 逐府标识件 */
function starHall(b: Baker, sg: SignMesher, atlas: SignAtlas, x: number, y: number, z: number, ry: number, flagC: number, sig: number, seed: number, idx: number, nm: string, sign: string): void {
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (u: number, v: number): [number, number] => [x + u * ca + v * sa, z - u * sa + v * ca];
  const W = sig === 3 ? 19 : 12, D = 8, H = 4.4;
  const tileC = sig === 1 ? 0x6a5a2a : sig === 6 ? 0x333a45 : W18_TILE;   // 亢金龍金瓦 / 畢月烏墨瓦 / 余青瓦
  // 逐府木构色（10 卷各府「建材与色彩」）：苍 / 金铜 / 黄褐 / 青黄 / 丹顶红 / 紫檀 / 墨 / 灰砖
  const wallC = [0x3f5a52, 0x6a5626, 0x6a5a3e, 0x4a5a52, 0x9e2a18, 0x4a2a3c, 0x2a2a32, 0x5a6472][sig];
  // 台基 + 台面
  b.box('ash', W + 3, 1.0, D + 3, x, y + 0.5, z, shade(W18_STONE, 1.0), ry);
  b.box('ash', W + 2.4, 0.12, D + 2.4, x, y + 1.06, z, W18_DECK, ry);
  const fy = y + 1.12;
  // 后墙 / 侧墙 / 前脸（三间：明间 3.2 门、次间墙 + 支摘窗）
  { const [px, pz] = at(0, -D / 2); b.box('wall', W, H, 0.5, px, fy + H / 2, pz, shade(wallC, 0.92), ry); }
  for (const s of [-1, 1]) {
    const [px, pz] = at(s * W / 2, 0);
    b.box('wall', 0.5, H, D, px, fy + H / 2, pz, shade(wallC, 0.86), ry);
    const [qx, qz] = at(s * (1.6 + (W - 3.2) / 4), D / 2);
    b.box('wall', (W - 3.2) / 2, H, 0.42, qx, fy + H / 2, qz, wallC, ry);
    // 星宿支摘窗：×2.2 档，预缩放上限 0.909m。旧版整块 2.6×1.3 → 5.72×2.86m。
    // 本版 3×2 分格：每格 0.833×0.625 ×2.2 = 1.83×1.38m ≤2 ✔，格间 0.05（0.11m）木棂。
    const uc = s * (1.6 + (W - 3.2) / 4);
    const WW = Math.min(2.6, (W - 3.2) / 3), WH = 1.3, GAP = 0.05;
    const nx = 3, ny = 2;
    const cw = (WW - GAP * (nx - 1)) / nx, ch = (WH - GAP * (ny - 1)) / ny;
    for (let ix = 0; ix < nx; ix++) {
      const ox = -WW / 2 + cw / 2 + ix * (cw + GAP);
      for (let iy = 0; iy < ny; iy++) {
        const oy = -WH / 2 + ch / 2 + iy * (ch + GAP);
        const [wx, wz] = at(uc + ox, D / 2 + 0.24);
        b.box('ground', cw, ch, 0.08, wx, fy + H * 0.58 + oy, wz, shade(W18_WOOD_D, 0.86), ry);
      }
    }
    for (let k = 1; k < nx; k++) {
      const ox = -WW / 2 + k * (cw + GAP) - GAP / 2;
      const [mx, mz] = at(uc + ox, D / 2 + 0.29);
      b.box('wood', GAP, WH, 0.10, mx, fy + H * 0.58, mz, shade(W18_WOOD, 1.04), ry);
    }
    for (let k = 1; k < ny; k++) {
      const oy = -WH / 2 + k * (ch + GAP) - GAP / 2;
      const [mx, mz] = at(uc, D / 2 + 0.29);
      b.box('wood', WW, GAP, 0.10, mx, fy + H * 0.58 + oy, mz, shade(W18_WOOD, 1.04), ry);
    }
  }
  for (const s of [-1, 1]) { const [px, pz] = at(s * 1.6, D / 2 + 0.06); b.cyl('wood', 0.18, 0.24, H, 7, px, fy + H / 2, pz, shade(W18_RED, 1.1), ry); }
  { const [px, pz] = at(0, D / 2 + 0.06); b.box('wood', 3.5, 0.3, 0.3, px, fy + H - 0.18, pz, GOLD_TRIM, ry); }
  { const [px, pz] = at(0, D / 2 - 0.14); b.box('ground', 3.0, H * 0.8, 0.1, px, fy + H * 0.4, pz, shade(W18_WOOD_D, 0.84), ry); }
  // 檐柱 ×4 + 额枋 + 歇山顶
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const [px, pz] = at(s * (W / 2 + 0.45), t * (D / 2 + 0.6));
    b.cyl('wood', 0.22, 0.28, H + 0.3, 7, px, fy + H / 2, pz, shade(W18_RED, 1.04), ry);
    b.cyl('ash', 0.3, 0.34, 0.22, 7, px, fy + 0.11, pz, shade(W18_STONE, 1.04), ry);
  }
  for (const s of [-1, 1]) { const [px, pz] = at(0, s * (D / 2 + 0.6)); b.box('wood', W + 1.0, 0.42, 0.36, px, fy + H + 0.05, pz, GOLD_TRIM, ry); }
  skyRoofOn(b, x, fy + H + 0.25, z, W + 3.2, D + 2.8, 2.8, ry, 'xieshan', tileC, GOLD_TRIM);
  // 匾（府名）：挂在檐柱之间、歇山出檐（≈D/2+1.4）以内，不做外挑
  { const [px, pz] = at(0, D / 2 + 0.72);
    sg.quad(atlas.text('w18star' + idx, sign, 200, 62, { color: '#ffe9b8', glow: '#ffd25e', bg: 'rgba(10,12,16,0.9)', border: 'rgba(255,210,94,.85)', fontPx: 44 }),
      3.2, 1.0, px, fy + H * 0.86, pz, ry); }
  // 星宿旗（旗色按四方）
  { const [fx0, fz0] = at(W / 2 + 2.4, D / 2 + 1.2);
    b.box('ash', 0.5, 0.24, 0.5, fx0, y + 0.12, fz0, shade(W18_STONE, 1.06));
    b.cyl('wood', 0.09, 0.13, 6.4, 6, fx0, y + 3.3, fz0, shade(W18_WOOD_D, 1.06));
    const [fx1, fz1] = at(W / 2 + 3.2, D / 2 + 1.2);
    b.box('fabric', 1.5, 2.0, 0.06, fx1, y + 5.0, fz1, flagC, ry);
    const [fx2, fz2] = at(W / 2 + 3.75, D / 2 + 1.2);
    b.box('fabric', 0.5, 0.72, 0.05, fx2, y + 4.0, fz2, shade(flagC, 0.72), ry);
    b.cyl('metal', 0.09, 0.11, 0.16, 6, fx0, y + 6.6, fz0, shade(GOLD_TRIM, 1.06));
    b.box('glow', 0.12, 0.12, 0.12, fx0, y + 6.76, fz0, GOLD_LINE, 0, 0, Math.PI / 4); }
  // ---- 逐府标识件（10 卷各府「外观特征」，全部落在岛面空处，不压台基/正堂）----
  if (sig === 0) {
    // 角木蛟：星台出挑如角（5m 高石台 + 蛟首吻兽）+ 脊端蛟首
    const [ax, az] = at(W / 2 + 3.0, -D / 2 - 1.4);
    b.box('ash', 3.4, 5.0, 3.4, ax, y + 2.5, az, shade(W18_STONE, 1.02), ry);
    b.box('ash', 3.9, 0.3, 3.9, ax, y + 5.1, az, W18_DECK, ry);
    b.box('wood', 1.1, 0.8, 0.5, ax, y + 5.6, az, shade(0x3a6b8c, 1.2), ry, 0.32);
    b.box('roof', 0.8, 1.0, 0.6, x, fy + H + 3.3, z, shade(tileC, 0.7), ry, 0, 0.4);
  } else if (sig === 1) {
    // 亢金龍：龙庭（15m 圆庭，置于堂前）+ 龙珠双灯
    const [cx2, cz2] = at(0, D / 2 + 8.4);
    b.cyl('ash', 5.6, 5.6, 0.3, 18, cx2, y + 0.15, cz2, shade(W18_STONE, 0.9), ry);
    b.cyl('glow', 5.3, 5.3, 0.06, 18, cx2, y + 0.33, cz2, shade(GOLD_LINE, 0.34), 0, 0, 0, true);
    for (const s of [-1, 1]) {
      const [px, pz] = at(s * 2.4, D / 2 + 1.5);
      b.cyl('metal', 0.16, 0.2, 0.4, 8, px, y + 3.4, pz, shade(GOLD_TRIM, 1.06));
      b.cyl('glow', 0.28, 0.28, 0.4, 10, px, y + 3.8, pz, GOLD_LINE);
    }
  } else if (sig === 2) {
    // 奎木狼：陨铁磨爪石（三痕）+ 脊端狼首
    const [rx2, rz2] = at(-W / 2 - 2.6, D / 2 + 1.0);
    b.box('ash', 2.6, 1.9, 2.2, rx2, y + 0.95, rz2, shade(0x3a3a42, 1.0), ry);
    for (let k = 0; k < 3; k++) {
      const [qx, qz] = at(-W / 2 - 2.4, D / 2 + 1.0 - 0.55 + k * 0.5);
      b.box('ground', 1.5, 0.09, 0.12, qx, y + 0.75 + k * 0.35, qz, shade(0x16161a, 1.0), ry, 0, 0.34);
    }
    b.box('roof', 0.7, 0.9, 0.5, x, fy + H + 3.2, z, shade(tileC, 0.66), ry, 0, 0.36);
  } else if (sig === 3) {
    // 斗牛宮：双连正堂（中脊相连）+ 门分左右宿灯 + 铜铃
    { const [px, pz] = at(0, 0); b.box('wall', 0.4, H, D, px, fy + H / 2 + 0.01, pz, shade(wallC, 0.8), ry); }
    for (const s of [-1, 1]) {
      const [px, pz] = at(s * 1.4, D / 2 + 1.3);
      b.box('glow', 0.3, 0.42, 0.3, px, y + 5.2, pz, s < 0 ? 0x3dff9c : GOLD_LINE);
      b.cyl('wood', 0.12, 0.14, 0.3, 5, px, y + 4.6, pz, shade(0xb87333, 1.0));
    }
  } else if (sig === 4) {
    // 昴日雞：高台栖架（6m 梧木三枝）+ 日晷纹铜镜
    const [mx, mz] = at(-W / 2 - 2.2, D / 2 + 1.4);
    b.box('ash', 2.2, 6.0, 2.2, mx, y + 3.0, mz, shade(W18_STONE, 1.0), ry);
    for (let k = 0; k < 3; k++) b.box('wood', 3.2 - k * 0.5, 0.22, 0.22, mx, y + 6.2 + k * 0.5, mz, shade(W18_WOOD, 1.06), ry);
    const [dx2, dz2] = at(0, D / 2 + 0.28);
    b.cyl('glow', 0.9, 0.9, 0.08, 14, dx2, fy + H * 0.7, dz2, shade(GOLD_LINE, 0.5), 0, Math.PI / 2);
  } else if (sig === 5) {
    // 心月狐：幻月纱屏（三叠绯纱）+ 粉紫点光
    for (let k = 0; k < 3; k++) {
      const [px, pz] = at(-3.2 + k * 3.2, D / 2 + 2.4 + k * 0.5);
      b.box('fabric', 2.4, 2.8, 0.05, px, y + 1.9, pz, shade(0xb04858, 0.78 - k * 0.06), ry + 0.2 * k);
      b.cyl('glow', 0.14, 0.1, 0.5, 6, px, y + 3.4, pz, shade(0xc8a0dc, 0.7));
    }
  } else if (sig === 6) {
    // 畢月烏：星轨院（堂前铜盘流沙 + 三足乌灯）
    const [sx2, sz2] = at(0, D / 2 + 7.0);
    b.cyl('metal', 3.4, 3.4, 0.4, 20, sx2, y + 0.36, sz2, shade(0x7a6230, 1.0), ry);
    b.cyl('ash', 3.2, 3.2, 0.1, 20, sx2, y + 0.58, sz2, shade(W18_DECK, 0.94), ry);
    for (let k = 0; k < 3; k++) {
      b.cyl('glow', 0.1, 0.06, 2.8, 6, sx2, y + 0.66, sz2, shade(0xdcdce8, 0.4), (k * Math.PI) / 3 + ry, Math.PI / 2);
    }
    { const [lx2, lz2] = at(W / 2 + 3.4, -1.2);
      b.cyl('metal', 0.4, 0.5, 0.6, 8, lx2, y + 1.1, lz2, shade(0x2a2832, 1.0));
      b.cyl('glow', 0.3, 0.22, 0.5, 6, lx2, y + 1.7, lz2, shade(0xdcdce8, 0.7)); }
  } else {
    // 虛日鼠：机关滑门半开 + 五谷囤三只
    { const [px, pz] = at(-1.0, D / 2 + 0.4); b.box('wall', 1.8, 2.8, 0.18, px, fy + 1.4, pz, shade(W18_BRICK, 1.1), ry + 0.28); }
    for (let k = 0; k < 3; k++) {
      const [px, pz] = at(W / 2 + 2.2 + k * 1.1, -1.6);
      b.cyl('ceramic', 0.42, 0.52, 0.9, 8, px, y + 0.55, pz, shade(0xb8a070, 0.96));
      b.cyl('glow', 0.36, 0.4, 0.1, 8, px, y + 1.04, pz, shade(0xd4b76a, 0.55));
    }
  }
  void nm; void seed;
}
