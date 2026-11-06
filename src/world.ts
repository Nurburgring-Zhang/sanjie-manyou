import * as THREE from 'three';
// 天宫穹顶高阶色。原值 0x14245c（深海军蓝）/ 0xffcf94（桃色）在 applyLighting 之后
// 以 k*0.9 覆盖淡蓝灰天顶，两者混成整片紫褐，把白玉/金瓦/云海全糊掉。
// 改成「晴空蓝 → 暖白金」的仙家天光，并把权重降到 0.55，让 applyLighting 的 _skyTopC 仍有一半话语权。
const _skyTopHigh = new THREE.Color(0x4d8ecb);
const _skyMidHigh = new THREE.Color(0xbcd8ee);
const _skyBotHigh = new THREE.Color(0xf2e6cd);
import { Engine } from './core/engine';
import { Baker, BakerStats, SignAtlas, SignMesher } from './city/bake';
import { buildNav, POIS, bridgeDeckY } from './city/layout';
import { buildAllCityBuildings, buildBridgePlaza } from './city/buildings';
import { buildRiverbank } from './city/riverbank';
import { buildCentralBelt } from './city/centralbelt';
import { buildWaterBranches } from './city/water';
import { buildParks } from './city/parks';
import { buildRiverEnds } from './city/riverends';
import { buildBridge } from './city/bridge';
import { River } from './city/river';
import { buildGround, buildStalls, buildTrees, buildLanterns, buildKites, StallInfo } from './city/props';
import { UnitSystems } from './city/units';
import { Crowd, Nameplates, setCameraRef } from './actors/crowd';
import { HeroStage, bakeWuSongBowls } from './actors/heroes';
import { bakeHeroStageProps, INTERIOR_LIGHTS, buildStreetInteriors, buildLandmarkInteriors2, STREET_HOUSE_SLOTS_W13 } from './city/interiors';
import { POINTS, PEACH_GRANT } from './data/interactPoints';
import { LEVEL_ORDER, LEVEL_TOTAL, levelOf, firstOpenIndex, countLevelDone } from './data/levelPlan';
import { CreatureSystem, spawnZhaoGongming } from './sky/creatures';
import { buildGhostFlora, buildCelestialFlora } from './sky/flora';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { PoiGuide } from './game/poiGuide';
import { Survival } from './game/survival';
import { ensureWorkshopBase, voxelStore, VOX } from './rt/voxelStore';
import { buildVoxelMesh } from './game/voxelMesh';
import { buildSkyRealm, SkyCenters } from './sky/realm';
import { DeityStage } from './sky/deities';
import { Havoc, SKY_STAND_Y } from './sky/havoc';
import { DEITIES } from './data/deities';
import { ArenaBoss } from './game/boss';
import { JULING } from './data/boss';
import { Vfx } from './fx/vfx';
import { Soundscape } from './audio/scape';
import { RNG, bus } from './core/rng';
import { GLOW_MAT, CLOUD_MAT } from './actors/pools';
import { PlayerController, PLATFORMS } from './game/player';
import { InteractSystem } from './game/interact';
import { ImpactSystem } from './game/physics';
import { MountSystem } from './city/mounts';
import { buildUnderworld, spawnUnderworldCast, UNDER, spawnGhostSprawl, duckweed } from './sky/underworld';
import { buildYanluoInterior, buildMengpoZhuang, buildNaiheSystem, buildSansheng, buildWangxiang, spawnHellKeepers, spawnNaiheGuards, HELL_LIGHTS } from './sky/hells';
import { buildLingxiaoInterior, buildDoushuaiInterior, buildGuanghanInterior, buildYaochi, buildTianfuAnnex, SKY_LIGHTS } from './sky/palace';
import { buildUnderworldExpansion, buildCloudSeaView, CloudSeaHandle } from './sky/expansion';
import { beautifyHeaven } from './sky/beautify';
import { buildSkyExpansion } from './sky/expansion';
import { HEAVEN_BASE_LIFTED, HEAVEN_LIFT, HEAVEN_Y_MIN, heavenPoint } from './sky/heavenFrame';
import { buildTerrain, terrainHeight, waterAt as terrainWaterAt, scatterVegetation } from './world/terrain';
import { MOUNTAINS } from './world/terrain';
import { buildDesertOutpost } from './world/desertOutpost';
import { buildImperialCity, wardCells, wardReserved } from './city/imperial';
import { buildFanlou, buildXiangguo } from './city/landmarks2';
import { WardInfill } from './city/infill';
import { buildPavement } from './city/pavement';
import { buildInteractProps } from './city/props';

const raf = (): Promise<void> => new Promise((r) => {
  // MessageChannel 在后台标签页也不会被节流，保证分帧生成总能推进
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); r(); };
    ch.port2.postMessage(0);
  } else requestAnimationFrame(() => r());
});
/**
 * 等一段真正的空闲。V8 的 idle GC 只在这时跑——同步让帧（raf）只切任务，不触发回收，
 * 于是「一堆已死的 typed array」会一直压在堆上，直到下一次 V8 自己觉得该收。
 * timeout 是兜底：浏览器不空闲时最多等这么久，不会把加载卡住。
 */
const idle = (timeoutMs: number): Promise<void> => new Promise((r) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => r(), { timeout: timeoutMs });
  else setTimeout(r, Math.min(timeoutMs, 120));
});
/**
 * 堆归因开关：只认 URL 查询参数 `?heapAudit=1`（`?heapAudit=0` 关闭）。
 *
 * 选 URL 而不是 `window.__heapAudit` 的理由：
 *   ① 不依赖注入时序——`evaluateOnNewDocument` 若晚于模块求值，开关会静默失效；URL 在导航时
 *      就已确定，dev server / preview / 打包 Electron 三处语义一致。
 *   ② 可见、可审计：地址栏与日志里就写着「这次是归因跑」，不会被上一轮探针残留的全局变量
 *      悄悄把生产载入拖慢 400ms（这正是本次要修掉的失败模式）。
 *   ③ 任何探针不必改启动顺序就能复用，只要在 URL 上带参数。
 */
const heapAuditEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const v = new URLSearchParams(window.location.search).get('heapAudit');
    return v !== null && v !== '0' && v !== 'false';
  } catch { return false; }
};
/**
 * 把一块几何的所有缓冲**当场**还给分配器。
 *
 * `dispose()` 只释放 GPU 侧；`attributes = {}` 只是把源数组变成垃圾，要等 V8 回收。
 * 合批期间 V8 恰恰不回收——实测 32 个批次里堆只涨不落（1525MB → 2252MB），峰值就是
 * 「源全集 + 产物全集」两份。`ArrayBuffer.transfer(0)` 是唯一能同步归还后备存储的手段
 * （独立实测：30×20MB 分配后逐块 transfer(0)，堆 601MB → 1MB，零 GC 参与）。
 */
function releaseGeometry(g: THREE.BufferGeometry): void {
  const freed = new Set<ArrayBufferLike>();
  const release = (arr: ArrayLike<number> | undefined): void => {
    if (!arr) return;
    const a = arr as ArrayLike<number> & { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
    const buf = a.buffer as (ArrayBuffer & { transfer?: (n: number) => ArrayBuffer }) | undefined;
    if (!buf || buf.byteLength === 0 || freed.has(buf)) return;
    freed.add(buf);
    // 只 detach 独占整块缓冲的视图；共享/带偏移的视图交给 GC，免得把别人的数据一起 detach 掉
    if (a.byteOffset !== 0 || a.byteLength !== buf.byteLength) return;
    if (typeof buf.transfer !== 'function') return;
    try { buf.transfer(0); } catch { /* 已 detach 或不可迁移：退回让 GC 回收 */ }
  };
  for (const name of Object.keys(g.attributes)) release((g.getAttribute(name) as THREE.BufferAttribute).array);
  if (g.index) release(g.index.array);
  g.attributes = {};
  g.index = null;
}

/**
 * 合批：数组内容与 `mergeGeometries(meshes, false)` 逐字节相同，内存行为相反。
 *
 *   ① 第一遍只读 `position.count` 求总量，一次分配目标数组（不碰顶点数据）；
 *   ② 第二遍逐块 blit，每拷完一块立刻 `releaseGeometry`（dispose + 解引用 + transfer(0)）；
 *   ③ 于是任意时刻只有「目标 + 当前一块」两份，而不是两份全集。
 * 属性类型原样保留（Float32 位置/UV、Int16 法线、Uint16 顶点色），不做任何转换。
 * 带 index 或属性集不一致的批返回 null（源保持原样、照常出图，只是没合）。
 */
function mergeExact(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  const first = meshes[0].geometry as THREE.BufferGeometry;
  if (first.index) return null;
  const names = Object.keys(first.attributes);
  let total = 0;
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    if (g.index) return null;
    for (const name of names) if (!g.attributes[name]) return null;
    total += (g.getAttribute('position') as THREE.BufferAttribute).count;
  }
  if (total === 0) return null;
  const slots = names.map((name) => {
    const proto = first.getAttribute(name) as THREE.BufferAttribute;
    const arr = new (proto.array.constructor as new (n: number) => Float32Array | Int16Array | Uint16Array)(total * proto.itemSize);
    return { name, itemSize: proto.itemSize, arr, off: 0, normalized: proto.normalized };
  });
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const g = m.geometry as THREE.BufferGeometry;
    for (const s of slots) {
      const a = g.getAttribute(s.name) as THREE.BufferAttribute;
      (s.arr as Float32Array).set(a.array as Float32Array, s.off);
      s.off += a.array.length;
    }
    m.removeFromParent();
    g.dispose();
    // 只 dispose 不解除引用的话，源数组仍被 meshes[]（以及 first）钉住；
    // 而只解引用不同步归还，就要等 V8 回收——合批期间它不回收。两步都做。
    releaseGeometry(g);
    meshes[i] = null as unknown as THREE.Mesh;
  }
  const out = new THREE.BufferGeometry();
  for (const s of slots) out.setAttribute(s.name, new THREE.BufferAttribute(s.arr, s.itemSize, s.normalized));
  return out;
}

/** 一块几何的全部属性字节（用来把合批切成内存有界的批次） */
function geometryBytes(geo: THREE.BufferGeometry): number {
  let n = 0;
  for (const name of Object.keys(geo.attributes)) n += (geo.getAttribute(name) as THREE.BufferAttribute).array.byteLength;
  if (geo.index) n += geo.index.array.byteLength;
  return n;
}

const _white = new THREE.Color(0xffffff);
const _sunDir = new THREE.Vector3();
// ---- 天宫界域配色（参考「栖光·中式天宫」系列：淡蓝灰天 + 暖金晨光 + 翻涌白云）----
// 人间黄昏是血红，直接套到天宫上就没有"仙境"感；y>150 时按高度过渡到这一套。
const _skyTopC = new THREE.Color(0x7e97b4);   // 天顶：淡蓝灰
const _skyMidC = new THREE.Color(0xa8c4dc);   // 中段霾带：比天顶更亮更浅
const _skyBotC = new THREE.Color(0xeadcc6);   // 近地平：晨光暖白
const _skyFogC = new THREE.Color(0xa8b6c6);   // 雾：云白偏冷（0xc9d4de 太浅，1km 外整片洗成白）
const _skySunC = new THREE.Color(0xffd7a0);   // 日照：夕照暖金
const _skyFillC = new THREE.Color(0x8fb0dc);  // 补光：冷蓝灰（参考图背光面色）
const _skyHemiC = new THREE.Color(0xbcd0e4);  // 半球天光：冷蓝
const _underFog = new THREE.Color(0x1a0508);
const _underSun = new THREE.Color(0x661a14);
const _underHemi = new THREE.Color(0x2a5a42);
const _underGnd = new THREE.Color(0x101820);
const _underTop = new THREE.Color(0x0d0308);
const _underMid = new THREE.Color(0x1b0709);
const _underBot = new THREE.Color(0x3a0a10);

export interface HeroEntry { code: string; name: string; nick: string; group: string; doing: string; weapon: string; desc: string; x: number; z: number; sky: boolean }

/** 目标链上的一步：给 HUD 直接渲染（name/objective）与给探针断言（key/index） */
export interface ObjectiveStep {
  key: string;
  /** POI 显示名（HUD 的「下一个：XXX」直接用这个） */
  name: string;
  objective: string;
  /** 在目标链中的 1 基序号（含已完成节点） */
  index: number;
  total: number;
}

/** 活体神佛演员落位账（world.deitySpots，探针读点） */
export interface DeityActorSpot {
  name: string; home: string;
  /** 缩放前口径（DeityStage 摆人用的原值） */
  preX: number; preY: number; preZ: number;
  /** heavenPoint 换算后的世界落点（脚底） */
  x: number; y: number; z: number;
  /** 缩放前环心与水平半径（判定「半径 ×HEAVEN_SCALE」用） */
  cx: number; cz: number; r: number;
}

export class World {
  crowd!: Crowd;
  units!: UnitSystems;
  heroStage!: HeroStage;
  deities!: DeityStage;
  havoc!: Havoc;
  /** 首个可打 Boss（天宫擂台 · 巨灵神） */
  boss!: ArenaBoss;
  /** 已了结的际遇（图鉴写回的唯一真相源；Boss 胜利后追加一条） */
  codexLog: { code: string; name: string; note: string }[] = [];
  /** 关卡目标状态：open / done。目标不能只显示不判定，否则等于装饰 */
  objectiveDone: Record<string, boolean> = {};
  private objT = 0;
  river!: River;
  vfx!: Vfx;
  audio = new Soundscape();
  atlas = new SignAtlas();
  centers!: SkyCenters;
  /** 活体神佛演员落位账（探针读点）：缩放前口径 + heavenPoint 换算后的世界落点 + 环心/半径 */
  deitySpots: DeityActorSpot[] = [];
  /** 机检停摆开关：探针量落位时冻结 DeityStage 的每日编排（嫦娥绕月、哮天犬绕二郎神） */
  deityHold = false;
  player!: PlayerController;
  interact!: InteractSystem;
  impacts!: ImpactSystem;
  mounts!: MountSystem;
  heightAt: ((x: number, z: number) => number) | null = null;
  private interactProps!: ReturnType<typeof buildInteractProps>;
  private stalls: StallInfo[] = [];
  heroIndex = new Map<string, { name: string; nick: string; group: string }>();
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ambientLight!: THREE.AmbientLight;
  private fill!: THREE.DirectionalLight;
  /** 虹桥水面反射面（Reflector）。它的 onBeforeRender 会把整场再提交一遍，由 mirrorHot 闸门控制 */
  mirror!: Reflector;
  /**
   * 镜子在画面上是否大到值得为它重画一次全城。
   * 判据是「镜面四角投影到屏幕后的包围盒高度」，滞回 12px 开 / 7px 关 ——
   * 低于这个尺度时那块水面在画面上只是一条几像素的亮带，重画全城换不来任何可见差异。
   */
  mirrorHot = false;
  /** 是否已经画过至少一帧反射贴图（首帧强制画一次，避免闸门一上来就停在一张空图上） */
  mirrorPrimed = false;
  private readonly mirrorProbe = new THREE.Vector3();
  private domeMat!: THREE.ShaderMaterial;
  /** 天穹球。跟随相机平移，见 applyLighting 里的说明 */
  private skyDome!: THREE.Mesh;
  /** R19：云海视图句柄。全城 flush 完之后建，之后每帧按相机高度淡出（地面视角必须看不见） */
  private cloudSea: CloudSeaHandle | null = null;
  private starsMesh?: THREE.Points;
  private milkyMesh?: THREE.Points;
  private glowMats: THREE.Material[] = [];
  private densitySetting = 1;
  private hazeRings: THREE.Mesh[] = [];
  /** 只属于阳间天穹的层（云海/星河/天河）：下探幽冥必须整层关掉，否则从地府仰望会看到阳间云带倒挂 */
  private skyLayers: THREE.Object3D[] = [];
  private hazeMatRef: THREE.MeshBasicMaterial | null = null;
  phaseName = '';
  private _lastT = 0;
  private _frame = 0;
  /** E1：npcSweep 的 walker 复用数组（原地压实，避免每 3 帧 filter 新数组） */
  private _npcWalkers: import('./actors/types').Actor[] = [];
  playerWeapon = { mult: 1, label: '双拳' };
  scrolling = false;
  creatures: CreatureSystem | null = null;
  /** P1-2 玩法实体：生存循环（血量/饥饿/晕倒迁地府）——probe-economy 同代探针验收 */
  readonly survival = new Survival();
  /** P1-4：已造物数量（main 注入；条件节点 c-creation 用） */
  creationCount = 0;
  voxelMesh: THREE.Mesh | null = null;
  voxelStore: typeof voxelStore = voxelStore;   // P1-2：探针/存档从实例取（避免 HMR 双实例分裂）
  poiGuide: PoiGuide | null = null;
  assetAudit: BakerStats | null = null;
  private dynamicLights: { l: THREE.PointLight; base: number }[] = []; // 精修5：室内/界域点光（昼夜节律驱动）
  private scrollT = 0;
  /** 当前音轨所属界域：renjian / tiangong / difu（只在跨界时切换） */
  private audioRealm = '';

  constructor(private engine: Engine) { }

  async init(onP: (p: number, label: string) => void): Promise<void> {
    const scene = this.engine.scene;
    const rng = new RNG(20260905);
    const baker = new Baker();
    const sg = new SignMesher();
    let stallsCache: StallInfo[] = [];
    let islandsCache: THREE.Vector3[] = [];

    // 任务允许异步：慢 builder 内部按块 await raf()，把「一次阻塞 2.7s」拆成「多次阻塞 ~0.3s」
    const tasks: [string, () => void | Promise<void>][] = [
      ['开天辟地', () => {
        this.buildLights(scene);
        this.crowd = new Crowd(scene, buildNav());
        POIS['yinyanggate'] = { name: '阴阳界（地府入口）', pos: new THREE.Vector3(470, 2, 24), radius: 14 };
        POIS['naihe'] = { name: '地府·奈何桥', pos: new THREE.Vector3(0, UNDER.y + 2, -60), radius: 18 };
        POIS['yanluo'] = { name: '地府·阎罗殿', pos: new THREE.Vector3(0, UNDER.y + 2, 60), radius: 22 };
        // 重建新增地标 POI（紫宸殿 y≈台基上）
        // 天宫·将台：boss 战恢复点（data/boss.ts:47 recoverPoi='jiangtai'），落斗法云台台面，不是巡天將臺。
        // 旧值 (0,214,20) 是混合口径（x/z 旧世界米 + y 缩放前米）：liftHeavenResiduals 只补 +HEAVEN_LIFT，
        // 实测 (0,2149,20) 埋进云台石座 4.26m（探针 ground=2147.28）。改走唯一换算 heavenPoint：
        // 落脚面取云台铺装顶 206.12（realm.ts:36 platform() 台面 y+0.12；havoc.ts:26 SKY_STAND_Y.arena），
        // z=9.09 即原世界 z=20÷2.2 —— 落在将台（realm.ts:699 platform(0,214,20,12)）台脚，
        // 并保留「将台/星宿中心差 10m」的既有导引间距（objectiveReached 注释）。
        // 远射线实测命中的是将台台面 2170.86：落点位于台身悬挑之下，探针只判近射线落脚面，不判净空。
        // 另：palace.ts:2067 的巡天將臺 (22,206,−35) 是独立建筑，与本 POI 的 boss 战场不是同一 host。
        POIS['jiangtai'] = { name: '天宫·将台', pos: new THREE.Vector3(...heavenPoint(0, 206.12, 9.09)), radius: 16, sky: true };
        POIS['zichen'] = { name: '紫宸殿', pos: new THREE.Vector3(0, 6, -4040), radius: 40 };
        POIS['fengdu'] = { name: '地府·丰都鬼城', pos: new THREE.Vector3(540, UNDER.y + 2, 85), radius: 120 };
        POIS['shibayu'] = { name: '地府·十八狱环', pos: new THREE.Vector3(0, UNDER.y + 2, 55), radius: 60 };
        POIS['mengpo'] = { name: '地府·孟婆庄', pos: new THREE.Vector3(-40, UNDER.y + 2, -132), radius: 12 };
        POIS['sansheng'] = { name: '地府·三生石', pos: new THREE.Vector3(24, UNDER.y + 2, -104), radius: 10 };
        POIS['wangxiang'] = { name: '地府·望乡台', pos: new THREE.Vector3(-150, UNDER.y + 18, -150), radius: 14 };
        POIS['workshop'] = { name: '营造司（体素建造）', pos: new THREE.Vector3(VOX.ox + 24, 1.2, VOX.oz + 24), radius: 40 };
        POIS['scroll'] = { name: '上河长卷（横向观画）', pos: new THREE.Vector3(-560, 9, 46), radius: 10 };
        // 天宫·星宿九府：host 待定——九府是 x≈±215~230、z −70~80 的两列岛链（realm.ts:2207 buildStarPalaces），
        // 没有单点可站；本 POI 是 B10「两列中点」的片区标记，只把混合口径收进 heavenPoint：
        // z=13.64 即原世界 z=30÷2.2，落脚面同斗法云台 206.12（远射线命中将台台面 2170.86，与将台同在悬挑下）。
        // 若日后为九府建岛链集散点，改 pos 即可，不动 radius 语义。
        POIS['star9'] = { name: '天宫·星宿九府', pos: new THREE.Vector3(...heavenPoint(0, 206.12, 13.64)), radius: 46, sky: true }; // B10 迁两列中点
        // 2026-11-01 巡检修复「传送凌霄宝殿 95% 纯白」：天宫几何在 sky/expansion.ts 里被整体放大
        // HEAVEN_SCALE=2.2×（绕 (0,196,0)），而 layout.ts 的 lingxiao 仍是**放大前**的 palace 锚点
        // (0,214,95)。放大后该点落在斗法云台台体内部（台面 y≈235.7，落点 y=214 埋进石座 21m），
        // 机位 (−34,234,147) 又停在云台与凌霄台之间的云团里、朝向还背着大殿——所以满屏纯白。
        // 实测放大后殿体：台基 z≈174–244、殿身 x±44、地坪 y≈246.2、宝顶 y≈298.5；
        // 云台台面 y≈235.7，丹陛台阶在 x±6.6 / z 237.6–253.4。落点取台阶以东 14m 的台面，
        // 机位见 CAM_OFF.lingxiao（相对本点，camera=(52,262,322)：从殿门一侧 72m 外斜俯，
        // 匾额/丹陛/朝房同框；星官公廨（z≈286）被让到画面左侧，不挡殿门）。
        POIS['lingxiao'].pos.set(14, 236, 250);
      }],
      // 分级载入：单步目标 ≤ 16ms×N 的主线程占用，超出就再拆一步。
      // 拆分只按「调用点」切，调用顺序与共享 rng 消耗顺序逐字不变，因此世界逐值可复现。
      ['山河·地形', async () => {
        const skyBotRef = { c: this.engine.time.skyBot };
        const tr = await buildTerrain(scene, skyBotRef, baker, sg, this.atlas);
        this.heightAt = tr.heightAt;
      }],
      ['山河·旷野', () => {
        buildDesertOutpost(baker, -16000, -14500, this.heightAt ?? terrainHeight, rng);
        scatterVegetation(this.crowd.poolSet(), rng, 1500);
      }],
      ['山河·四方', () => {
        for (const m of MOUNTAINS) {
          const h = terrainHeight(m.x, m.z);
          POIS['mt_' + m.name] = { name: m.name, pos: new THREE.Vector3(m.x, h + 6, m.z), radius: 60 };
        }
        POIS['greatlake'] = { name: '东洋巨泽', pos: new THREE.Vector3(11000, 1, 5500), radius: 40 };
        POIS['desert'] = { name: '西陲大漠', pos: new THREE.Vector3(-16000, terrainHeight(-16000, -14500) + 6, -14500), radius: 40 };
        POIS['grassland'] = { name: '北国草原', pos: new THREE.Vector3(1500, terrainHeight(1500, -11000) + 6, -11000), radius: 40 };
      }],
      ['筑城·街巷基层', () => {
        buildGround(baker);
      }],
      ['筑城·街屋群', async () => {
        await buildAllCityBuildings(baker, sg, this.atlas, rng);
      }],
      ['筑城·街屋内饰', () => {
        // WS-W4：9 座程序化街屋的室内壳（梁架/踢脚/门帘 + 店铺/民居/酒肆/茶坊四形制陈设）。
        // 单独给一支 RNG：不动上面这条共享序列，下游铺装/树木/摊位逐值不变。
        buildStreetInteriors(baker, sg, this.atlas, new RNG(0x5e7a1), STREET_HOUSE_SLOTS_W13);
        // W13：州桥桥面市集（摊 6 + 桥心井亭 + 望柱灯 8 + 桥头脚店）与上清观正殿（三清座/供案/丹炉/30 屉药柜）。
        // 樊楼与相国寺的宿主楼体尚不存在，按 W13 约定默认不建。
        buildLandmarkInteriors2(baker, sg, this.atlas);
      }],
      ['筑城·樊楼相国寺', () => {
        // W14：樊楼（三层酒楼）与相国寺大殿。楼体自带 W13 的室内（含楼板/楼梯/雅座/佛坛），
        // 落在 x=−620 一线——streetPlots 从 −596 起排、树域 −560..620，是城内唯一成带空地。
        buildFanlou(baker, sg, this.atlas);
        buildXiangguo(baker, sg, this.atlas);
      }],
      ['筑城·虹桥人流', () => {
        buildBridge(baker, sg, this.atlas);
        // 桥面人流：桥是长卷视觉核心，不能只有建筑没人
        for (let i = 0; i < 16; i++) {
          const z = -36 + i * 4.7;
          const x = ((i % 3) - 1) * 2.5 + (i % 2 ? 0.6 : -0.4);
          const a = this.crowd.spawnActor({
            occ: ['customer', 'peddler', 'scholar', 'vendor'][i % 4],
            pos: new THREE.Vector3(x, bridgeDeckY(z), z),
            freeze: true,
            action: ['stand', 'lookAround', 'chat'][i % 3],
          });
          a.yaw = i % 2 ? 0.4 : Math.PI - 0.4;
          a.speed = 0;
          // 过桥走向：每三人留一人沿桥面往返（其余定桩），桥不再是"站着的人"
          if (i % 3 === 0) {
            const lane = ((i / 3) % 3 - 1) * 1.7;
            const phase = i * 7.3;
            a.attach = (out) => {
              const span = 72;
              const tt = performance.now() / 1000 * 2.0 + phase;
              const m = ((tt % span) + span) % span;
              const dir = Math.floor(tt / span) % 2 === 0 ? 1 : -1;
              const z = dir > 0 ? -36 + m : 36 - m;
              out.pos.set(lane, bridgeDeckY(z), z);
              out.yaw = dir > 0 ? 0 : Math.PI;
              out.y = 0;
            };
            a.action = 'walk';
          }
        }
        // 桥面食棚摊主：站在柜台后
        for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
          const a = this.crowd.spawnActor({
            occ: 'vendor',
            pos: new THREE.Vector3(sx * 3.3, bridgeDeckY(sz * 36.5), sz * 36.5 - 1.3),
            freeze: true, action: 'stand',
          });
          a.yaw = sz > 0 ? Math.PI : 0;
        }
      }],
      ['皇城·宫城', async () => {
        await buildImperialCity(baker, sg, this.atlas, rng);
        // 城墙戍守：一圈守卒（沿墙顶马道）+ 四正门将军。
        // 墙顶标高跟 imperial.ts 的墙体尺寸保持一致（15.5m 墙身 + 0.32 压顶 ≈ 15.9），
        // 若城墙再加高，这里必须同步，否则人会陷进墙里或悬空。
        const WALL_TOP = 15.9;
        // 巡逻：用户明确要求「围墙上要有很多士兵来回的巡逻」。原先全员 freeze+stand 定桩，
        // 远看是一排不动的模型。改为每三人留一人沿墙往返（其余定桩守望），
        // 用 attach 驱位（与桥面行人同一套机制），不动角色池容量。
        const hold = (x2: number, z2: number, yaw2: number, general: boolean, axis: 'x' | 'z' = 'x', phase = 0): void => {
          const a = this.crowd.spawnActor({
            occ: 'soldier',
            pos: new THREE.Vector3(x2, WALL_TOP + 0.02, z2),
            yaw: yaw2, freeze: true, action: general ? 'stand' : 'walk',
            data: { name: general ? '守門將軍' : '守卒', nick: '', group: 'job', weapon: general ? '長戟' : '長槍',
              desc: general ? '城門樓上駐守' : '沿牆往來巡守', code: general ? 'gen' : 'soldier' },
          });
          a.scale = general ? 1.12 : 0.98 + (x2 + z2) % 7 * 0.01;
          if (general) return;
          const span = 74;                      // 往返 74m，两端各留 37m 巡视段
          a.attach = (out) => {
            const tt = performance.now() / 1000 * 1.15 + phase;
            const m = ((tt % span) + span) % span;
            const dir = Math.floor(tt / span) % 2 === 0 ? 1 : -1;
            const off = dir > 0 ? -span / 2 + m : span / 2 - m;
            if (axis === 'x') {
              out.pos.set(x2 + off, WALL_TOP + 0.02, z2);
              out.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
            } else {
              out.pos.set(x2, WALL_TOP + 0.02, z2 + off);
              out.yaw = dir > 0 ? 0 : Math.PI;
            }
            out.y = 0;
          };
        };
        let wi = 0;
        for (let t = -4800; t <= 4800; t += 240) {
          if (Math.abs(Math.abs(t % 2600)) < 60) continue;   // 让开三座门
          const ph = (wi++ % 17) * 0.37;                     // 相位错开，一排人不要同步齐步
          hold(t, 5000, Math.PI, false, 'x', ph);
          hold(t, -5000, 0, false, 'x', ph + 0.9);
          hold(5000, t, -Math.PI / 2, false, 'z', ph + 1.7);
          hold(-5000, t, Math.PI / 2, false, 'z', ph + 2.6);
        }
        for (const [gx, gz] of [[0, 5000], [0, -5000], [5000, 0], [-5000, 0]] as const) {
          hold(gx, gz, Math.atan2(-gx, -gz), true);
        }
      }],
      ['皇城·里坊民居', () => {
        // 里坊密集民居填充（数万栋连片院落，构成真实都城密度）
        new WardInfill(scene, rng, wardCells(), wardReserved);
      }],
      ['皇城·街巷铺装', () => {
        // 地坪细节层：石板铺装 + 坊区色斑（ISS-31 高空地坪观感）
        buildPavement(scene, rng);
        // 桥东/桥西广场：补掉 wardReserved 中央带留下的 200×200m 裸土
        buildBridgePlaza(baker, rng);
        // 河岸商业带（R2/R3）：x −4800..4800 两岸连续铺面，与里坊咬合、不留长空段
        buildRiverbank(baker);
        // R15-B：御街两厢商业带（临街排 554 + 后巷排 320 间 + 值房/小院/牌坊/行道树/水井）
        buildCentralBelt(baker, sg, this.atlas, rng);
        // R11：2 处大苑囿 + 6–10 处中小园林 + 4–6 处瓦舍勾栏
        buildParks(baker, sg, this.atlas, rng);
      }],
      ['筑城·水关收口', () => {
        // R15-C：汴河两端水关（涵洞+闸门+驳岸延伸+城墙水门楼）、御沟龙头吐水口
        buildRiverEnds(baker, sg, this.atlas, rng);
      }],
      ['筑城·水系支脉', () => {
        // R10：蔡河/五丈河两条支渠 + 4 处池沼 + 金明池（230m，带岛与拱桥）
        buildWaterBranches(baker, rng);
      }],
      ['装点市井', () => {
        buildTrees(baker, rng);
        buildLanterns(baker, sg, this.atlas, rng);
        buildKites(baker);
        bakeWuSongBowls(baker, rng);
        bakeHeroStageProps(baker);
        this.interactProps = buildInteractProps(baker, sg, this.atlas);
        stallsCache = buildStalls(baker, sg, this.atlas, rng, this.crowd.spots);
        for (let x = -560; x < 400; x += 55) this.crowd.spots.add(x, 36.5, 'tow');
      }],
      ['云起天宫', () => {
        this.centers = buildSkyRealm(baker, sg, this.atlas, this.crowd.poolSet(), scene, rng);
        // 天宫整层抬升：SkyCenters 是**缩放前**坐标，几何稍后由 scaleHeavenGeometry 统一放大+抬升；
        // 这里先把弧心抬到新高度，后续 DeityStage/Havoc/Boss/香炉 VFX 直接读到抬升后的值，
        // 不必在每个消费者里再写一遍 +HEAVEN_LIFT（那必然漏）。
        for (const v of Object.values(this.centers)) v.y += HEAVEN_LIFT;
        this.starsMesh = scene.getObjectByName('stars') as THREE.Points;
        this.milkyMesh = scene.getObjectByName('milkyway') as THREE.Points;
        this.skyLayers = ['stars', 'milkyway', 'sky_river', 'pool_cloudFar']
          .map((n) => scene.getObjectByName(n))
          .filter((o): o is THREE.Object3D => !!o);
      }],
      ['仙界装点', () => {
        islandsCache = beautifyHeaven(baker, scene, rng);
        // 云瀑粒子落点不是烘焙几何（vfx 按坐标喷粒子），随整层一起抬，否则水会从 1935m 下往上喷。
        for (const p of islandsCache) p.y += HEAVEN_LIFT;
      }],
      ['云海·宫阙群', async () => {
        await buildSkyExpansion(baker, this.crowd.poolSet(), scene, rng);
      }],
      ['云海·三殿内饰', () => {
        // B5：天宫三殿内饰（47 卷 §一/§三/§四；瑶池延 B6 迁正——坐标带与兜率壳冲突留痕）
        buildLingxiaoInterior(baker, sg, this.atlas);
        buildDoushuaiInterior(baker, sg, this.atlas);
        buildGuanghanInterior(baker, sg, this.atlas);
      }],
      ['云海·瑶池水榭', () => {
        buildYaochi(baker, sg, this.atlas); // B6：瑶池水榭（兜率已迁正让位）
      }],
      ['云海·仙植鬼植', () => {
        // B10 植物精化：鬼植六类+仙植六类（10/30 卷 PLT 表）
        buildGhostFlora(baker, rng);
        buildCelestialFlora(baker, rng);
      }],
      ['云海·天府附院', () => {
        buildTianfuAnnex(baker, sg, this.atlas); // B6 余项：御膳房/天库/武库/巡天将台
      }],
      ['幽冥开辟', () => {
        buildUnderworld(baker, sg, this.atlas, rng);
        duckweed(baker, rng);
      }],
      // 拆成 6 个独立步：原先一个 lambda 连调 6 个 builder，一旦某步变慢，整块加载静默卡住且分不清是哪一步。
      ['幽冥·丰都街', () => buildUnderworldExpansion(baker, sg, this.atlas, rng)],
      ['幽冥·阎罗殿', () => buildYanluoInterior(baker, sg, this.atlas)],
      ['幽冥·孟婆庄', () => buildMengpoZhuang(baker, sg, this.atlas)],
      ['三界演员贴地校正', () => {
        // P0-9 报障根修：120 位 freeze 演员按区域基准常量放置（y=-260/2153.26/2157.8 等），
        // 未贴该处烘焙网格实际顶面（探针 probe-realm-floor raycast 实锤 sink 0.36–0.9m）。
        // 逐演员从胸口向下 raycast，命中顶面即脚高（±0.35 容差内不动——浮台阶语义）。
        const ray = new THREE.Raycaster();
        ray.far = 300;
        const down = new THREE.Vector3(0, -1, 0);
        const org = new THREE.Vector3();
        let fixed = 0;
        let raycastBudget = 400;
        for (const a of this.crowd.actors) {
          if (!a.freeze || a.attach || a.hidden || raycastBudget <= 0) continue;
          const p = a.pos;
          const realm = p.y > 2085 ? 'heaven' : p.y < -200 ? 'underworld' : p.y > -200 && p.y < 2085 ? 'human' : 'void';
          if (realm === 'void') continue;
          // 粗判先行：人间 walkSurfaceY 覆盖（建筑/桥/街面）；天宫 PLATFORMS 圆盘已拍
          // 只有「两层判定都无法给出地面」的天宫/地府演员才走 raycast（性能：368×全场景遍历曾致载入超时）
          const ws = this.crowd.walkSurfaceAt(p.x, p.z, p.y);
          if (realm === 'human' || (realm === 'heaven' && ws !== null)) {
            if (ws !== null && p.y < ws - 0.35) { p.y = ws + 0.02; fixed++; }
            continue;
          }
          raycastBudget--;
          org.set(p.x, p.y + 1.0, p.z);
          ray.set(org, down);
          // 排除演员自身命中（合并 InstancedMesh 里自己的身体），取第一个低于脚 0.2m 的真地面
          const allHits = ray.intersectObject(scene, true);
          const hits = allHits.filter((h) => h.point.y <= p.y - 0.2 && !(h.object instanceof THREE.InstancedMesh));
          if (hits.length === 0) continue;
          const floorY = hits[0].point.y;
          if (p.y < floorY - 0.35) { p.y = floorY + 0.02; fixed++; }   // 只修"陷"，不修"浮"（浮是楼梯/桥梁语义）
        }
        if (fixed > 0) console.log(`[贴地校正] ${fixed} 位演员已贴到烘焙地面顶面`);
      }],
      ['营造司·体素台', () => {
        // P1-2 最小可玩闭环：城南偏东荒地 48×48 青石台，G 键建造模式（D3 体素首块落地）
        ensureWorkshopBase(voxelStore);
        this.voxelMesh = buildVoxelMesh(scene);
      }],
      ['幽冥·奈何桥', () => buildNaiheSystem(baker, sg, this.atlas)],
      ['幽冥·三生石', () => buildSansheng(baker, sg, this.atlas)],
      ['幽冥·望乡台', () => buildWangxiang(baker, sg, this.atlas)],
      ['合拢万象', async () => {
        this.assetAudit = baker.stats();
        const mats = await baker.build(scene);
        for (const k of Object.keys(mats)) {
          const m = mats[k as keyof typeof mats];
          if (m) this.glowMats.push(m);
        }
        sg.build(scene, this.atlas, 'city_signs');
        this.river = new River(scene);
        // B1 室内真点光（暖黄 2700K，distance 限堂内；自发光陈设只点缀不照亮）
        // 持续精修（对标 threejsresources/guides/water）：虹桥核心段低分辨率倒影面（512 target 避免满渲染二次 pass）
        const mirror = new Reflector(new THREE.PlaneGeometry(120, 40), {
          textureWidth: 512, textureHeight: 512, color: 0x5a6a66,
          clipBias: 0.003,
        });
        mirror.rotation.x = -Math.PI / 2;
        mirror.position.set(0, 0.145, -60);
        scene.add(mirror);
        mirror.updateMatrixWorld(true);
        this.mirror = mirror;
        // 反射闸门：Reflector 的 onBeforeRender 会把**整场**再从镜像相机画一遍。
        // 机位离开虹桥后这块 120×40m 的水面在画面上只剩几个像素，重画全城纯属浪费 ——
        // 直接不调用它，水面继续用上一张 512² 贴图（textureMatrix 也停在旧值，画面自洽，不会扭）。
        const mirrorRender = mirror.onBeforeRender;
        mirror.onBeforeRender = (renderer, s, camera, geometry, material, group) => {
          // 首帧无条件画一次：闸门可能一上来就判「太远」，那样贴图是一张从未渲染过的空图，
          // 水面上会是一条纯色暗带。先垫一张真图，之后才允许停更。
          if (!this.mirrorHot && this.mirrorPrimed) return;
          this.mirrorPrimed = true;
          mirrorRender.call(mirror, renderer, s, camera, geometry, material, group);
        };
        for (const L of SKY_LIGHTS) {
          const pl = new THREE.PointLight(L.color, L.int, L.dist, 1.8);
          pl.position.set(L.x, L.y, L.z);
          scene.add(pl);
          this.dynamicLights.push({ l: pl, base: L.int });
        }
        for (const L of HELL_LIGHTS) {
          const pl = new THREE.PointLight(L.color, L.int, L.dist, 1.8);
          pl.position.set(L.x, L.y, L.z);
          scene.add(pl);
          this.dynamicLights.push({ l: pl, base: L.int });
        }
        for (const L of INTERIOR_LIGHTS) {
          const pl = new THREE.PointLight(L.color, L.int, L.dist, 1.8);
          pl.position.set(L.x, L.y, L.z);
          scene.add(pl);
          this.dynamicLights.push({ l: pl, base: L.int });
        }
        this.vfx = new Vfx(scene);
        // 丹炉口（furnace.x + 3.4, 炉身 +2.4, furnace.z）也是缩放前口径：与演员同一套 heavenPoint
        this.vfx.addEmberSource(new THREE.Vector3(...heavenPoint(this.centers.furnace.x + 3.4, SKY_STAND_Y.furnace + 2.4, this.centers.furnace.z)));
        for (const w of islandsCache) this.vfx.addWaterfall(w);
        this.vfx.setPetals(0.12);
      }],
      ['众生入场', () => {
        this.crowd.spawnCrowd();
        for (const s of stallsCache) {
          if (s.kind === 'food') this.crowd.spawnStation('vendor', s.x, s.z, 0.1, 'cook', '烹制吃食', rng.range(0, 6.28));
          else this.crowd.spawnStation('vendor', s.x, s.z, 0.1, 'hawk', '摆摊吆喝', rng.range(0, 6.28));
        }
        this.crowd.spawnStation('vendor', -36, 58, 0.1, 'present', '茶博士点茶', 0);
        // P0-9 缺口修复：星宿九府每府驻场神仙（府主宣讲+侍从立班，走 heavenPoint 缩放前口径）
        {
          const starPalaces: [string, number, number, number][] = [
            ['角木蛟府', -220, 80, 209], ['奎木狼府', -230, 30, 209], ['斗牛宮', -225, -20, 210], ['虛日鼠府', -215, -70, 208],
            ['亢金龍府', 220, 80, 209], ['昴日雞宮', 230, 30, 209], ['心月狐府', 225, -20, 210], ['畢月烏府', 215, -70, 208],
          ];
          for (const [nm, sx, sz, sy] of starPalaces) {
            const [wx, wy, wz] = heavenPoint(sx + 1.5, sy + 0.16, sz);
            this.crowd.spawnStation('deity', wx, wz, wy + 0.02, 'pray', nm + '·府主宣讲', Math.atan2(-sx, -sz), { name: nm.slice(0, 3), nick: '星宿府主', group: 'deity', desc: nm + ' 府主宣讲星纲' });
            const [ox, oy, oz] = heavenPoint(sx - 1.2, sy + 0.16, sz + 0.8);
            this.crowd.spawnStation('deity', ox, oz, oy + 0.02, 'lookAround', nm + '·侍从立班', Math.atan2(-sx, -sz), { name: '星官侍从', nick: nm.slice(0, 2) + '侍从', group: 'deity', desc: nm + ' 侍从立班听讲' });
          }
        }
        // P0-9 报障修复②：三界 freeze 演员统一站立校正——天宫带按 PLATFORMS 圆盘取
        // 「≤脚高+1.2 的最高台面」拍齐（烘焙台面不进 walkSurfaceY 哈希，61 位演员曾全员悬空判定失败）
        const snap = (x: number, z: number, refY: number): number | null => {
          let best: number | null = null;
          for (const p of PLATFORMS) {
            const dx = x - p.x, dz = z - p.z;
            if (dx * dx + dz * dz < p.r * p.r && p.y <= refY + 1.2 && (best === null || p.y > best)) best = p.y;
          }
          return best;
        };
        for (const a of this.crowd.actors) {
          if (!a.freeze || a.attach || a.hidden) continue;
          const p = a.pos;
          if (p.y > 2085) {
            const hit = snap(p.x, p.z, p.y);
            if (hit !== null && Math.abs(p.y - hit) > 0.6) p.y = hit + 0.02;
          }
        }
        this.crowd.spawnStation('musician', 232, 58, 0.1, 'pluck', '栏前弹唱', 0);
        this.crowd.spawnStation('musician', 306, 66, 0.1, 'flute', '瓦子笛声', Math.PI);
        // 社会热点补全：茶坊/酒肆/赌坊/斗殴巷/闲话角/书场/庙宇/戏台/码头
        const reg = this.crowd.spots;
        const add = (x: number, z: number, kind: string): void => reg.add(x, z, kind);
        for (const [x, z] of [[-36, 58], [40, 58], [96, 58], [168, 58], [-6, 46], [76, 46], [-180, 58], [330, 58], [480, 60]] as const) add(x, z, 'tea');
        for (const [x, z] of [[226, 56], [122, 56], [258, 58], [352, 60], [-40, -58], [60, -58], [180, -58], [430, 60]] as const) add(x, z, 'wine');
        for (const [x, z] of [[210, 84], [280, 88], [340, 84], [470, 60], [-30, -70], [80, 62]] as const) add(x, z, 'dice');
        for (const [x, z] of [[356, 86], [84, 46], [-104, -62], [-330, 58]] as const) add(x, z, 'fight');
        for (const [x, z] of [[150, 66], [200, 88], [250, 68], [300, 92], [-60, 58], [-150, 58], [0, 58], [500, 60], [540, 56], [420, 88]] as const) add(x, z, 'social');
        for (const [x, z] of [[-30, 42], [306, 70]] as const) add(x, z, 'story');
        for (const [x, z] of [[540, 108], [540, 190], [-420, 88], [56, 58]] as const) add(x, z, 'shrine');
        for (const [x, z] of [[306, 82], [240, 88]] as const) add(x, z, 'stage');
        for (const [x, z] of [[-238, 30], [-206, 26], [-268, 28], [-150, 38]] as const) add(x, z, 'dock');
        // 外城坊民（里坊街道）
        const A = [900, 1700, 2500, 3300, 4100];
        const occs = ['customer', 'peddler', 'porter', 'merchant', 'lady'];
        for (let i = 0; i < 150; i++) {
          const ax = A[Math.floor(rng.next() * A.length)] * (rng.chance(0.5) ? 1 : -1);
          const az = A[Math.floor(rng.next() * A.length)] * (rng.chance(0.5) ? 1 : -1);
          const onX = rng.chance(0.5);
          const pos = onX ? new THREE.Vector3(rng.range(-4900, 4900), 0, az + rng.range(-5, 5)) : new THREE.Vector3(ax + rng.range(-5, 5), 0, rng.range(-4900, 4900));
          this.crowd.spawnActor({ occ: rng.pick(occs), pos });
        }
      }],
      ['豪杰登台', () => {
        this.heroStage = new HeroStage(this.crowd, rng, stallsCache, this.heightAt, terrainWaterAt);
        this.units = new UnitSystems(this.crowd.poolSet(), this.crowd, rng, this.heightAt ?? terrainHeight);
      }],
      ['神佛就位', () => {
        this.deities = new DeityStage(this.crowd, this.centers, rng, this.vfx);
        this.standDeityActors();
        this.havoc = new Havoc(this.crowd, this.deities, this.centers, this.vfx);
        // P1-1 资源轴：蟠桃宴幕 → 蟠桃 +1（蟠桃轴唯一 source；H6 断裂修复）
        this.havoc.onPeachBanquet = (n) => {
          this.interact.addPeach(n);
        };

        // P1-2 玩法实体：Boss 伏誅利品——蟠桃 +1（战斗→资源轴联动，闭环由 survival 计数）
        // 首个遭遇：擂台上的巨灵神。用已有个体做化身，不新增角色池消耗。
        this.boss = new ArenaBoss(
          JULING,
          this.deities.map.get(JULING.name),
          new THREE.Vector3(...heavenPoint(this.centers.arena.x, SKY_STAND_Y.arena, this.centers.arena.z)),
          this.vfx,
          () => this.player,
          () => {
            // 奖励必须改变状态：写回图鉴数据（只发事件不写数据 = 假奖励）
            if (!this.codexLog.some((e) => e.code === JULING.code)) {
              this.codexLog.push({ code: JULING.code, name: JULING.name, note: '天宫擂台 · 已伏誅' });
            }
            bus.emit('codex:unlock', JULING.code);
            // P1-2 生存循环利品：伏誅巨灵神 → 蟠桃 +2 + 铜钱 300 + 「伏魔锏」攻击 4.0
            // （装备梯度：双拳 1.0 < 钢刀 2.5 < 伏魔锏 4.0——Boss 专属顶级武器，战斗→成长闭环）
            this.interact.addPeach(2);
            this.interact.earn(300);
            if (this.playerWeapon.mult < 4) {
              this.playerWeapon = { mult: 4.0, label: '伏魔锏' };
              bus.emit('ui:toast', '巨灵神的伏魔锏归你所有——攻击力大幅提升！');
            }
            this.survival.bossReward();
          },
          () => { this.respawnPlayerAt(JULING.recoverPoi); },
        );
        spawnUnderworldCast(this.crowd, rng, this.vfx);
        spawnGhostSprawl(this.crowd, rng);
        spawnHellKeepers(this.crowd); // B2：六重狱狱卒头目
        spawnNaiheGuards(this.crowd); // B3：守桥南北+守台鬼差
        // B9：生物行为（牛头 90s 环/马面 150s 狱环/黑白无常对偶/骨犬循迹/灵猴绕桃）+赵公明天库驻守
        this.creatures = new CreatureSystem(this.crowd);
        spawnZhaoGongming(this.crowd);
      }],
      ['化身与交互', () => {
        this.mounts = new MountSystem(this.crowd.poolSet(), this.crowd);
        this.player = new PlayerController(this.engine, this.crowd, new THREE.Vector3(-20, 0, 58));
        this.mounts.player = this.player;
        this.engine.onAvatarDrag = (dx, dy) => this.player.avatarLookDrag(dx, dy);
        const applyCamCtl = (): void => {
          // 仅附身模式由玩家控制器接管相机；灵魂模式交还引擎自身 updateCamera
          this.engine.avatarCtl = this.player.mode === 'avatar' ? (dt) => this.player.update(this._lastT, dt) : null;
        };
        applyCamCtl();
        bus.on('player:mode', () => applyCamCtl());
        const fade = document.createElement('div');
        fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .45s;z-index:90;';
        document.getElementById('ui')!.appendChild(fade);
        this.player.setFadeEl(fade);
        this.interact = new InteractSystem(document.getElementById('ui')!, this.player);
        // P1-2 生存循环接线：晕倒 → 罚半铜钱 → 孟婆庄重生；Boss 伏誅 → 蟠桃利品（资源轴联动）
        this.survival.onFaint = () => {
          const I = this.interact;
          const penalty = Math.floor(I.coins * this.survival.coinPenaltyRatio);
          if (penalty > 0) { I.coins -= penalty; I.save(); }
          bus.emit('ui:toast', penalty > 0
            ? `晕倒于荒野——铜钱 -${penalty} 文，孟婆庄一碗汤垫底`
            : '晕倒于荒野——孟婆庄一碗汤垫底（身无长物，无从罚起）');
          this.respawnPlayerAt('mengpo');
          this.survival.revive();
        };
        this.stalls = stallsCache;
        this.poiGuide = new PoiGuide(document.getElementById('ui')!, () => []); // 精修3：POI 方位导引
        this.poiGuide.setDoneQuery((k) => !!this.objectiveDone[k]);
        this.registerInteractions();
        // 物理碰撞反馈：冲撞判定 + 攻击入口（KeyF/点击由 PlayerController 触发 attackHook）
        this.impacts = new ImpactSystem(this.crowd, this.vfx);
        this.player.attackHook = () => {
          if (this.player.state === 'foot') this.impacts.playerAttack(this.player.actor, this.playerWeapon.mult);
        };
      }],
      ['名牌图鉴', () => {
        setCameraRef(this.engine.camera);
        const names: { code: string; text: string; color: string }[] = [];
        for (const h of this.crowd.heroes) {
          if (!h.data) continue;
          const color = h.data.group === 'shuihu' ? '#ffb300' : h.data.group === 'deity' ? '#00e5ff' : '#ffd25e';
          names.push({ code: h.data.code ?? '', text: `${h.data.nick}·${h.data.name}`, color });
          this.heroIndex.set(h.data.code ?? '', { name: h.data.name, nick: h.data.nick, group: h.data.group });
        }
        this.crowd.nameplates = new Nameplates(scene, this.atlas, names);
      }],
    ];

    // 加载流水线：逐步计时 + 让帧。任何一步超预算都要在控制台点名，
    // 否则「加载卡住」只能靠猜（本项目已被这个问题坑过两轮）。
    const LOAD_BUDGET_MS = 1200;
    const timings: [string, number][] = [];
    // 世界生成的起点（页面内时间戳）：把「首帧编译噪声」与「生成期阻塞」分开，否则阻塞度量永远被前段污染
    if (typeof window !== 'undefined') (window as unknown as { __loadStartAt?: number }).__loadStartAt = performance.now();
    // 分批落盘是「不卡死」的代价：同一材质会拆成几十个 mesh（draw call 翻倍）。全部步跑完后再合批。
    //
    // 合批的内存账（实测口径：`__heapPre` / `__heapPost` + probe-mem 的 40ms 采样峰值）：
    //   ① `mergeGeometries(geos)` 同持「源全集 + 目标全集」，峰值 3472MB；
    //   ② 只把源 `dispose()` + 解引用也不够——那只是把源数组变成垃圾，要等 V8 回收，
    //      而合批期间 V8 基本不回收（实测 32 个批次堆只涨不落：1525 → 2252MB），
    //      峰值仍然是两份全集；
    //   ③ 现在每拷完一块立刻 `transfer(0)` 同步归还后备存储（见 releaseGeometry），
    //      堆在一次拷贝之内就回落到合批前的水位。
    // 于是峰值 = 合批前水位 + 一批的「目标 + 源」两小份，批预算直接就是峰值预算；
    // 同时预算也是 draw call 预算（预算越小 → 合并后的 mesh 越多）。
    const COMPACT_BATCH_MB = 48;
    const compactStatic = async (): Promise<void> => {
      const byMat = new Map<THREE.Material, THREE.Mesh[]>();
      const taken = new Set<string>();
      let sources = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.name.startsWith('city_')) return;
        const mat = m.material as THREE.Material;
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat)!.push(m);
        taken.add(m.name);
        sources++;
      });
      const budget = COMPACT_BATCH_MB * 1024 * 1024;
      let merged = 0;
      let kept = 0;
      for (const [mat, meshes] of byMat) {
        if (meshes.length < 2) continue;
        const baseName = meshes[0].name.replace(/^city_/, '').replace(/_\d+$/, '');
        const cast = meshes[0].castShadow, recv = meshes[0].receiveShadow;
        // 大的先成批：批内「目标 + 源」的源侧上限由最大那块决定，降序才让峰值 ≈ 目标 + 单块。
        const sorted = meshes
          .map((m) => ({ m, b: geometryBytes(m.geometry as THREE.BufferGeometry) }))
          .sort((p, q) => q.b - p.b);
        let i = 0;
        let part = 0;
        while (i < sorted.length) {
          let bytes = 0;
          const batch: THREE.Mesh[] = [];
          while (i < sorted.length) {
            if (batch.length > 0 && bytes + sorted[i].b > budget) break;
            bytes += sorted[i].b;
            batch.push(sorted[i++].m);
          }
          // 单块批：合完还是 1 个 mesh，draw call 零收益，却要整份拷一次（实测这类纯拷贝
          // 有 12 块 / 554MB，最大一块 163MB）。留原样，名字也不动。
          if (batch.length < 2) { kept += 1; continue; }
          const geo = mergeExact(batch);
          if (!geo) { kept += batch.length; continue; }
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, mat);
          // 合并体的命名沿用 city_<组>[_序号]；序号要跳过保留块的原名，免得出现两个同名 mesh
          let n = part;
          let name = n === 0 ? 'city_' + baseName : 'city_' + baseName + '_' + n;
          while (taken.has(name)) name = 'city_' + baseName + '_' + ++n;
          taken.add(name);
          part = n + 1;
          mesh.name = name;
          mesh.castShadow = cast;
          mesh.receiveShadow = recv;
          mesh.matrixAutoUpdate = false;
          scene.add(mesh);
          merged++;
          await raf();
        }
      }
      if (merged) console.log(`[加载] 静态合批：${sources} 个网格 → ${merged + kept} 个（合并 ${merged}，保留单块 ${kept}，单批 ≤${COMPACT_BATCH_MB}MB）`);
    };
    // 相位标记（只写一个全局字符串，探针按它给 10–40ms 的堆采样分桶）：没有它就只能量到
    // 「载入峰值 2.1GB」，量不出峰值落在哪一步、以及落在「步骤」还是「flush」里——
    // 实测就是靠 flush@ / post@ 把 850MB 瞬态钉在 baker.flush 内部的。
    const phase = (p: string): void => { (window as unknown as { __phase?: string }).__phase = p; };
    for (let i = 0; i < tasks.length; i++) {
      onP(i / tasks.length, tasks[i][0]);
      await raf();
      // 逐步日志：主线程若被同步死循环冻住，这是唯一能定位到「哪一步」的线索。
      console.log(`[加载] ▶ ${tasks[i][0]}`);
      phase(tasks[i][0]);
      const t0 = performance.now();
      await tasks[i][1]();
      phase('flush@' + tasks[i][0]);
      // 每步落盘：几何量按步封顶，堆不再随全城线性增长（3GB 会直接把 V8 顶进 GC 悬崖）
      const _tf = performance.now();
      await baker.flush(scene);
      phase('post@' + tasks[i][0]);
      // 载入归因：步骤自报耗时只覆盖 tasks[i][1]()，flush（建 GPU 缓冲）与 compactStatic（合批）
      // 一直是黑账。实测总载入 28.7s，而 33 步自报合计只有约 14s —— 差额必须查清才能谈优化。
      {
        const w = window as unknown as { __flushMs?: number };
        w.__flushMs = (w.__flushMs ?? 0) + (performance.now() - _tf);
      }      const dt = performance.now() - t0;
      // 几何量台账：JS 堆一旦吃到 3GB 以上，V8 会进 GC 悬崖，表现就是「加载卡死」。
      const st = baker.stats();
      let tris = 0;
      const per: [string, number][] = [];
      for (const k of Object.keys(st.groups) as (keyof typeof st.groups)[]) {
        tris += st.groups[k].triangles;
        per.push([k as string, st.groups[k].triangles]);
      }
      per.sort((a, b) => b[1] - a[1]);
      const top = per.slice(0, 4).map(([k, v]) => k + '=' + Math.round(v / 1000) + 'k').join(' ');
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      console.log(`[加载] ✔ ${tasks[i][0]} ${dt.toFixed(0)}ms tris=${Math.round(tris / 1000)}k heap=${mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) : '?'}MB | ${top}`);
      timings.push([tasks[i][0], dt]);
      if (dt > LOAD_BUDGET_MS) console.warn(`[加载] ${tasks[i][0]} 超预算 ${dt.toFixed(0)}ms`);
      await raf();
    }
    // 合批前等一次 idle：给 idle GC 一个明确的结算点，`__heapPre` 才是「合批真实起点」，
    // 否则量到的是还没被回收的生成期垃圾（实测同一份代码 pre 在 1448–1873MB 之间乱跳）。
    // 但这只是**测量仪器**，不是生产载入的一部分：Promise.all 取慢者 ⇒ 硬下界 400ms，
    // 且整段落在 __loadStartAt..__loadEndAt 之内（即 engineMs，红线 12s 只剩几十毫秒余量）。
    // 故只在 ?heapAudit=1 时执行；关闭时连 idle/sleep 都不排，engineMs 直接省掉这一档。
    const heapAudit = heapAuditEnabled();
    if (typeof window !== 'undefined') (window as unknown as { __heapAuditOn?: boolean }).__heapAuditOn = heapAudit;
    if (heapAudit) {
      const tSettle = performance.now();
      phase('settle');
      await Promise.all([idle(800), new Promise<void>((resolve) => setTimeout(resolve, 400))]);
      (window as unknown as { __settleMs?: number }).__settleMs = Math.round(performance.now() - tSettle);
    }
    // 峰值堆归因：记录合批前后的堆。合并期**源几何与合并结果同时驻留**是原本的假设，
    // 改法见 compactStatic/releaseGeometry 的头注（同步归还，不再靠 GC 追赶）。
    // 归因关闭时不测量：写 -1 明确表示「未测量」，避免下游把 undefined 当 0、或读到同页上一轮的残留值。
    {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const w = window as unknown as { __heapPre?: number };
      w.__heapPre = heapAudit && mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1;
    }
    phase('compact');
    await compactStatic();
    phase('cloud');
    {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const w = window as unknown as { __heapPost?: number };
      if (mem) w.__heapPost = Math.round(mem.usedJSHeapSize / 1048576);
    }
    // R19：云海从 city_fabric 切出来单独淡出。必须在 compactStatic 之后——切分对象是合并后的整块几何，
    // 之前各步的 city_fabric 碎片还没合批，切一次会有大半云海留在原网格里继续糊在天上。
    this.cloudSea = buildCloudSeaView(scene);
    // 几何已由 scaleHeavenGeometry 统一「缩放 + 抬升」；下面把不经过顶点通道的几类对象补齐。
    this.liftHeavenResiduals();
    // 生成结束时间戳：与 __loadStartAt 一起界定「世界生成期」，把首帧着色器编译排除在阻塞统计外
    if (typeof window !== 'undefined') (window as unknown as { __loadEndAt?: number }).__loadEndAt = performance.now();
    if (typeof window !== 'undefined') {
      (window as unknown as { __loadTimings?: [string, number][] }).__loadTimings = timings.slice().sort((a, b) => b[1] - a[1]);
    }
    onP(0.97, '长卷徐展');
    await raf();
    phase('done');
    this.applyDensity();
    this.buildCinema();
    this.engine.applyQuality(this.engine.quality, true);
    bus.on('quality:change', () => this.applyDensity());
    bus.on('battle:report', () => { /* ticker 由 UI 订阅 */ });
    // 上河长卷：teleport('scroll') 启停见 teleport() 尾部置位；运镜在 update()
  }

  private buildLights(scene: THREE.Scene): void {
    this.sun = new THREE.DirectionalLight(0xffe0b0, 1.4);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    // 阴影预算：视锥裁到玩家周围 ±140m（规范 §6：玩家 120m），不是全场景 ±270m。
    // 好处 twofold：同尺寸 shadow map 下 texel 密度翻倍（檐口/斗栱的投影才立得住），
    // 且远野的 casting 被裁掉，阴影 pass 的几何量与 draw call 一起降。
    this.sun.shadow.camera.left = -120; this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120; this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 760;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x5a6fa8, 0x3a2c28, 0.55);
    scene.add(this.hemi);
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(this.ambientLight);
    // 背光补光：逆太阳方位的弱冷光，避免背光面（如山体东北坡）死黑
    this.fill = new THREE.DirectionalLight(0x8aa0c8, 0.95);
    this.fill.name = 'fill';
    scene.add(this.fill); scene.add(this.fill.target);
    // 三段式穹顶：h=0.5 是地平线；t=pow(h,0.45) 把 0°/10°/20°/40°/90° 仰角映到
    // 0.732/0.786/0.840/0.915/1.0。暖橙只守到 ~8°，8–21° 抬到亮蓝灰霾带，21° 以上
    // 再压到天顶蓝 —— 暖冷之间永远经过高亮度色，不会停在中性紫灰（旧两色直插的病灶）。
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x1a2b52) },
        uMid: { value: new THREE.Color(0x9fb4cc) },
        uBot: { value: new THREE.Color(0xd46a2e) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; varying vec3 vP;
        void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
        float t = pow(h, 0.45);
        vec3 c = mix(uBot, uMid, smoothstep(0.735, 0.845, t));
        c = mix(c, uTop, smoothstep(0.845, 0.99, t));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(46000, 32, 16), this.domeMat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    scene.add(dome);
    this.skyDome = dome;
    // 地平线霾环：罩住远地面掠射角伪影，颜色随时段更新
    const hazeMat = new THREE.MeshBasicMaterial({ color: 0x9a8698, transparent: true, opacity: 0.82, depthWrite: false, fog: false, toneMapped: false });
    hazeMat.name = 'hazeMat';
    const ring1 = new THREE.Mesh(new THREE.RingGeometry(14000, 21000, 48), hazeMat);
    ring1.rotation.x = -Math.PI / 2;
    ring1.position.y = 2.5;
    scene.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(20500, 33000, 48), hazeMat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 2.5;
    scene.add(ring2);
    this.hazeRings = [ring1, ring2];
    this.hazeMatRef = hazeMat;
  }

  private buildCinema(): void {
    // 开场：贴河低空东行 → 掠过虹桥 → 穿街市 → 抬升俯瞰全城 → 转天宫
    // 旧路径从 52m 高空横掠，第一眼看不到汴河与虹桥，只看到四排房子。
    const pos = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-540, 16, 74), new THREE.Vector3(-380, 12, 54), new THREE.Vector3(-240, 10, 44),
      new THREE.Vector3(-120, 22, 20), new THREE.Vector3(-10, 24, 4), new THREE.Vector3(70, 20, 28),
      new THREE.Vector3(150, 15, 54), new THREE.Vector3(270, 13, 50), new THREE.Vector3(390, 17, 44),
      new THREE.Vector3(480, 24, 48), new THREE.Vector3(540, 40, 78), new THREE.Vector3(320, 150, 168),
      // 末段是「钻到天宫底盘下方仰看」的镜头：旧值 214/210 是台面下 4m；抬升后同步 +HEAVEN_LIFT，
      // 否则开场会飞到 2150m 高台下的空气里，什么都看不到。最后一点 120 是回落人间，不动。
      new THREE.Vector3(0, 214 + HEAVEN_LIFT, 150), new THREE.Vector3(-60, 210 + HEAVEN_LIFT, 40), new THREE.Vector3(0, 120, 120),
    ]);
    const look = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-380, 5, 18), new THREE.Vector3(-260, 4, 4), new THREE.Vector3(-140, 3, 0),
      new THREE.Vector3(-20, 10, 0), new THREE.Vector3(0, 12, 0), new THREE.Vector3(120, 6, 40),
      new THREE.Vector3(180, 6, 40), new THREE.Vector3(280, 6, 26), new THREE.Vector3(400, 8, 18),
      // 视线目标同样跟着天宫底盘走（200/208 是旧台面下的仰视点）。
      new THREE.Vector3(480, 10, 26), new THREE.Vector3(320, 60, 80), new THREE.Vector3(60, 200 + HEAVEN_LIFT, 60),
      new THREE.Vector3(0, 208 + HEAVEN_LIFT, 10), new THREE.Vector3(0, 60, 60), new THREE.Vector3(0, 20, 60),
    ]);
    this.engine.setCinemaPath(pos, look, 84);
  }

  private applyLighting(t: number): void {
    const time = this.engine.time;
    const cam = this.engine.camera;
    // 天穹必须跟着相机走。球心固定在原点时，相机离原点 d 之后，视线正前方打到球壁要
    // 46000+d（本机位 d≈14950 → 59900m），超过 camera.far=52000 就被裁掉，
    // 露出 renderer 的纯黑清屏 —— 远景那块「巨大黑洞」就是被裁空的穹顶内壁，
    // 32×16 球的折边就是它锯齿状的多边形轮廓。穹顶是纯方向渐变、没有视差，
    // 平移跟随是天空盒的标准做法，且球壁距观察者恒为 46000，永远在 far 之内。
    this.skyDome.position.copy(cam.position);
    this.domeMat.uniforms.uTop.value.copy(time.skyTop);
    this.domeMat.uniforms.uMid.value.copy(time.skyMid);
    this.domeMat.uniforms.uBot.value.copy(time.skyBot);
    const fog = this.engine.scene.fog as THREE.FogExp2;
    fog.color.copy(time.fogColor);
    fog.density = time.fogDensity;
    this.sun.color.copy(time.sunColor);
    this.sun.intensity = time.sunI;
    // 太阳仰角下限 0.28：再低则背光墙只剩半球光，建筑读成黑色平板
    const sunDir = _sunDir.set(0.42, Math.max(0.28, 0.55 - Math.abs(time.phase - 0.4) * 0.6), 0.3).normalize();
    this.sun.position.copy(cam.position).addScaledVector(sunDir, 420);
    this.sun.target.position.copy(cam.position);
    // 背光补光跟随：置于太阳对面，消除背光面死黑
    this.fill.position.copy(cam.position).addScaledVector(_sunDir.set(-sunDir.x, 0.42, -sunDir.z).normalize(), 420);
    this.fill.target.position.copy(cam.position);
    this.fill.intensity = time.fillI;
    this.hemi.intensity = time.hemiI;
    this.ambientLight.intensity = time.ambient;
    // 分时段曝光：黄昏/黎明提亮，夜更深沉（幽冥层再于末端覆盖）
    const baseExp = 0.72 + time.hemiI * 0.22;
    this.engine.renderer.toneMappingExposure = baseExp;
    // 雾密度随相机高度收敛：街面 3.2×（巷弄纵深感，遮住远处空旷），高空恢复远景
    fog.density = time.fogDensity * THREE.MathUtils.lerp(2.4, 1, THREE.MathUtils.clamp(cam.position.y / 130, 0, 1));
    // 天庭高度：雾再按高度收敛，否则云上看下去只剩一片沙色浓雾，看不见脚下城郭
    // 天庭高度再收敛：原 0.34 仍把浮岛侧面糊成一片灰白（就是「薄饼感」的来源之一），
    // 降到 0.14 让 300–600m 外的岛锥露出岩层轮廓，同时保留远山的空气透视。
    // 120 是旧天宫云层下沿；整层抬升后按 +HEAVEN_LIFT 同步，否则在 2131 的天宫里雾永远是街面档。
    fog.density *= THREE.MathUtils.lerp(1, 0.14, THREE.MathUtils.clamp((cam.position.y - (120 + HEAVEN_LIFT)) / 110, 0, 1));
    if (this.hazeMatRef) {
      this.hazeMatRef.color.copy(time.fogColor).lerp(time.skyBot, 0.25);
      // 地平霾环（r=14–33km、opacity .82）按高度淡出：它在人间压远地平线掠射伪影是必要的，
      // 但升到云上会加一层灰（非主因，主因是穹顶，见 applySkyDomeTint）。120m 起、210m 归零。
      // 120m 起、210m 归零（旧天宫高度带）→ 整层抬升后同步 +HEAVEN_LIFT。
      this.hazeMatRef.opacity = 0.82 * (1 - THREE.MathUtils.clamp((cam.position.y - (120 + HEAVEN_LIFT)) / 90, 0, 1));
    }
    GLOW_MAT.color.setScalar(Math.min(1.02, time.neon));
    // 精修5：室内/界域点光昼夜节律（白天保 30% 暗处可读，夜满亮；与烘焙 glow 同源 neon）
    const li = 0.3 + 0.7 * time.neon;
    for (const d of this.dynamicLights) d.l.intensity = d.base * li;
    for (const m of this.glowMats) {
      (m as THREE.MeshBasicMaterial).color.setScalar(Math.min(1.02, time.neon));
    }
    CLOUD_MAT.color.copy(time.skyBot).lerp(_white, 0.55).multiplyScalar(0.9 + time.neon * 0.15);
    this.river.update(t, time.neon, time.fogColor, time.fogDensity);
    // 星河/银河仅夜间可见（黄昏留可见下限会在天际线浮白色方块带）
    if (this.starsMesh) (this.starsMesh.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp((time.neon - 0.95) * 2.2, 0, 0.92);
    if (this.milkyMesh) (this.milkyMesh.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp((time.neon - 0.95) * 1.1, 0, 0.5);
    // 天宫氛围：相机升到云海之上后，天穹/雾/日照整档换成「淡蓝灰天 + 暖金晨光」。
    // 参考视频里天宫的基调是晨间的清透蓝灰，不是人间的血红黄昏；不换的话云海会被染成红汤。
    // 旧阈值 150 是「天宫在 ~200m」时代的数；整层抬升后按 +HEAVEN_LIFT 同步。
    {
      const sf = THREE.MathUtils.clamp((cam.position.y - (150 + HEAVEN_LIFT)) / 90, 0, 1);
      if (sf > 0.001) {
        this.domeMat.uniforms.uTop.value.lerp(_skyTopC, sf);
        this.domeMat.uniforms.uMid.value.lerp(_skyMidC, sf);
        this.domeMat.uniforms.uBot.value.lerp(_skyBotC, sf);
        fog.color.lerp(_skyFogC, sf);
        fog.density = THREE.MathUtils.lerp(fog.density, 0.00006, sf);
        this.sun.color.lerp(_skySunC, sf);
        // 光比是参考图的命门：主光压到 ~18° 仰角、强度拉到 2.1，
        // 环境光砍到 0.22、半球光 0.38 —— 阴影才真正落地，玉白建筑才有明暗两面。
        this.sun.intensity = THREE.MathUtils.lerp(this.sun.intensity, 2.1, sf);
        const lowSun = _sunDir.set(0.62, 0.31, 0.72).normalize();
        this.sun.position.copy(cam.position).addScaledVector(lowSun, 420);
        this.sun.target.position.copy(cam.position);
        this.hemi.color.lerp(_skyHemiC, sf);
        this.hemi.intensity = THREE.MathUtils.lerp(this.hemi.intensity, 0.38, sf);
        // 冷补光从背光侧打，压住"背光面死黑"，同时保持色温对比（参考图背光面是冷蓝灰）
        this.fill.color.lerp(_skyFillC, sf);
        this.fill.intensity = THREE.MathUtils.lerp(this.fill.intensity, 0.85, sf);
        this.fill.position.copy(cam.position).addScaledVector(
          _sunDir.set(-lowSun.x, 0.34, -lowSun.z).normalize(), 420);
        this.fill.target.position.copy(cam.position);
        this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, 0.22, sf);
      }
    }
    // 地府氛围：仅当玩家真正下探到幽冥层（y<-100）才过渡，地面为 0
    if (this.player) {
      // 只认相机高度：旧版取 min(玩家.y, 相机.y)，玩家从殿前挪到荒野时 uf 从 0.79 跳到 1，
      // 同一机位雾色 #170407 → #150406、密度 0.01350 → 0.02243（C1 探针实测）。
      // 渲染结果只允许由「相机位置 + 时间相位」决定，玩家状态不得参与——否则同一帧
      // 换个人站法画面就换一套雾，可复现性直接没了。
      const depthY = cam.position.y;
      // 过渡带 120m → 60m：地府岩顶板在 −46…−104，进洞即该换天光；
      // 60m 让 u_hero（相机 −195）落到 uf=1，背景不再残留 21% 人间暮色暖雾。
      const uf = THREE.MathUtils.clamp((-depthY - 100) / 60, 0, 1);
      if (uf > 0.001) {
        fog.color.lerp(_underFog, uf);
        // 地府雾比人间浓一档：岩顶板在 −46…−104，从台面（−260）仰视有 120–210m，
        // 0.0042 的密度只吃 50%，岩板被半球光点亮后是一片灰紫平色（实测 RGB 113/94/111、p95=108）。
        // 0.0068 下 200m 只剩 16% 透射，岩顶才读成"洞顶"，而 60m 内的殿宇仍能看清结构。
        fog.density = THREE.MathUtils.lerp(fog.density, 0.0046, uf);
        this.sun.intensity *= 1 - uf * 0.92;
        this.sun.color.lerp(_underSun, uf);
        // 地府底光 0.58 → 0.72：naihe/wangxiang/fengdu 三处机位亮度只有 63/65/47，殿内与街面读不出结构
        this.hemi.intensity = THREE.MathUtils.lerp(this.hemi.intensity, 0.72, uf);
        this.hemi.color.lerp(_underHemi, uf);
        this.hemi.groundColor.lerp(_underGnd, uf);
        this.domeMat.uniforms.uTop.value.lerp(_underTop, uf);
        this.domeMat.uniforms.uMid.value.lerp(_underMid, uf);
        this.domeMat.uniforms.uBot.value.lerp(_underBot, uf);
        const skyHidden = uf > 0.5;
        for (const o of this.skyLayers) o.visible = !skyHidden;
        for (const r of this.hazeRings) r.visible = !skyHidden;
        if (this.starsMesh) (this.starsMesh.material as THREE.PointsMaterial).opacity *= 1 - uf;
        if (this.milkyMesh) (this.milkyMesh.material as THREE.PointsMaterial).opacity *= 1 - uf;
        this.engine.renderer.toneMappingExposure = THREE.MathUtils.lerp(baseExp, 1.8, uf);
      }
    }
  }

  /**
   * 地府命名 POI 保护系数：0 = 落在某个地府 POI 的可读半径内，1 = 完全在野外深域。
   *
   * `halo` 是给第三人称机位留的外扩：CAM_OFF 常把相机摆在落点后 70–90m（阎罗殿 92m），
   * 只按 POI 自身半径判，相机会被判成「野外」，目的地反而最黑。
   * 旧版用 min(相机, 玩家) 补这个盲区，代价是雾随玩家位置跳变；外扩半径只跟相机有关，
   * 同一相机永远得到同一结果。
   */
  private hellPoiShield(x: number, z: number, halo = 0): number {
    let shield = 1;
    for (const key in POIS) {
      const p = POIS[key];
      if (p.pos.y > -100) continue;              // 只保护地府层（人间/天宫都在 y > −100）
      const r = Math.min((p.radius || 14) + halo, 120);
      const d = Math.hypot(x - p.pos.x, z - p.pos.z);
      const t = THREE.MathUtils.clamp((d - r) / Math.max(6, r * 0.8), 0, 1);
      shield = Math.min(shield, t * t * (3 - 2 * t));
    }
    return shield;
  }

  /**
   * 地府纵深黑场：越往里越黑，最深处伸手不见五指。
   * 判词（用户原话）：「残骸与深渊都是往里走就逐渐变黑，最后伸手不见五指」。
   * **必须放在 applyLighting 末尾**：函数里既有「界域雾插值到常数 0.0046」又有「GLOW_MAT 重设」，
   * 放在前面会被无条件覆盖 —— 实测三个纵深点 density 全是 0.0046、亮度完全不随深度变化。
   */
  private applyHellDepth(): void {
    const cam = this.engine.camera;
    if (cam.position.y >= -100) return;
    const fog = this.engine.scene.fog as THREE.FogExp2;
    const dIn = Math.hypot(cam.position.x, cam.position.z + 60);   // 以奈何桥入口为原点
    const k = Math.pow(THREE.MathUtils.clamp(dIn / 240, 0, 1), 1.4);
    // 2026-11-01 修黑屏：原来 `density *= 1 + 9k`，阎罗殿（dIn≈212 → k≈0.83）把雾密度乘到 8.5 倍，
    // 92m 外殿体透过率≈0 ⇒ 传送到阎罗殿/十八狱是**满屏纯黑**（巡检实测中位亮度 1/255、p95 17）。
    // 这不是"越往里越黑"该有的效果——那两个是**目的地**，不是深渊。
    // 2026-11-01 二修（按 POI 分档）：全局钳制会把整层地府锁在一个密度上，深处永远到不了"伸手不见五指"。
    // 现在改成分档曲线：命名 POI 半径内保可读，POI 外随 shield 抬到 0.052（30m 处 9%、50m 处 0.1% ⇒ 接近全黑）。
    // 相机外扩 60m：CAM_OFF 把第三人称机位摆在落点后 70–90m（阎罗殿 92m），
    // 只按落点半径判会把**目的地本身**判成野外（首版实测：传送到阎罗殿后画面反而更黑）。
    // 外扩只读相机，不读玩家——旧版 min(相机, 玩家) 就是 C1「只挪玩家雾就跳变」的来源。
    const shield = this.hellPoiShield(cam.position.x, cam.position.z, 60);
    // POI 上限 0.0135 → 0.0105：92m 处透过率从 0.21 抬到 0.39（≥0.35 的验收线），
    // 殿体不再是雾里的剪影；POI 外仍按 shield 抬到 0.052（30m 处 9%、50m 处 0.1% ⇒ 近全黑），
    // 「往里走逐渐变黑」的纵深曲线不受影响。
    const cap = THREE.MathUtils.lerp(0.0105, 0.052, shield);
    fog.density = Math.min(fog.density * (1 + 9 * k), cap);
    // 颜色/自发光压暗同样分档：POI 内只压 35%，野外按原曲线压到 28%
    const dark = 0.72 * k * (0.35 + 0.65 * shield);
    fog.color.multiplyScalar(1 - dark);
    GLOW_MAT.color.multiplyScalar(1 - dark);
  }

  /**
   * 天宫穹顶染色：人间用的黄昏渐变（skyTop 蓝 / skyMid 亮蓝灰 / skyBot 暖橙）升到云上会把整个画面压成灰纸。
   * 证据：`shot-hide nodome`（仅隐藏 r>40000 的穹顶两网格）→ 天空变黑、浮岛岩锥立刻清晰；
   * 而改霾环/雾/云海材质均无视觉变化。必须写在本函数末尾：applyLighting 里会重设 uTop/uMid/uBot。
   */
  private applySkyDomeTint(): void {
    const cam = this.engine.camera;
    // 旧 120m 是天宫云层下沿；抬升后同步（否则天宫穹顶会提前 1935m 就染成仙家天色）。
    const k = THREE.MathUtils.clamp((cam.position.y - (120 + HEAVEN_LIFT)) / 90, 0, 1);
    if (k <= 0) return;
    const u = this.domeMat.uniforms;
    u.uTop.value.lerp(_skyTopHigh, k * 0.55);
    u.uMid.value.lerp(_skyMidHigh, k * 0.55);
    u.uBot.value.lerp(_skyBotHigh, k * 0.5);
  }

  /**
   * 活体神佛演员落位：DeityStage 构造之后补一次统一换算。
   *
   * DeityStage 用 SkyCenters 的**混合口径**摆人：x/z 是缩放前、y 已经 +HEAVEN_LIFT，
   * 且 y 取的是云台名义高而不是可站的面（arenaW/E/N/S 写 208 而台面 206.12、
   * palace 写 214 被凌霄殿台基整片埋掉、high 写 223 是斗法台上方的悬空点）。
   * 于是演员比台面低 12–22m、水平半径只有应给的 1/2.2，等于站在台基/岩体里面。
   *
   * 这里与天宫石像（sky_pantheon，deities.ts buildShrines）同一套口径收口：
   * 脚底取该 host 的落脚面 SKY_STAND_Y（与 Havoc 共用一张表），x/z 与环偏移
   * 仍是 DeityStage 的缩放前米，落位时统一走 heavenPoint —— 不另立第二套换算。
   */
  private standDeityActors(): void {
    const homes = new Map(DEITIES.map((d) => [d.name, d.home]));
    // 莲台顶面半径（realm.ts lotusPad：lotus r=5 / lotus2 r=3.6）。DeityStage 的环半径
    // 3.8 对 lotus2 会落到莲瓣斜面外、悬空 2.07m；莲台上的演员一律收到台面内。
    const LOTUS_TOP_R: Record<string, number> = { lotus: 5, lotus2: 3.6 };
    const spots: DeityActorSpot[] = [];
    for (const [name, a] of this.deities.map) {
      const home = homes.get(name) ?? 'arena';
      const c = this.centers[home as keyof SkyCenters] ?? this.centers.arena;
      let preX = a.pos.x;
      let preZ = a.pos.z;
      const lr = LOTUS_TOP_R[home];
      if (lr) {
        const dx = preX - c.x, dz = preZ - c.z;
        const d = Math.hypot(dx, dz);
        const lim = lr - 0.6;
        if (d > lim) { preX = c.x + (dx / d) * lim; preZ = c.z + (dz / d) * lim; }
      }
      const preY = SKY_STAND_Y[home] ?? a.pos.y - HEAVEN_LIFT;
      const [x, y, z] = heavenPoint(preX, preY, preZ);
      a.pos.set(x, y, z);
      spots.push({
        name, home, preX, preY, preZ, x, y, z,
        cx: c.x, cz: c.z, r: Math.hypot(preX - c.x, preZ - c.z),
      });
    }
    this.deitySpots = spots;
  }

  /**
   * 天宫整层抬升的补扫（幂等）。
   *
   * `scaleHeavenGeometry` 只改 Mesh 顶点；演员、POI、云团实例池是数据对象，不走那条通道：
   *  · 演员：SkyCenters 已在「云起天宫」早抬，但各模块自带的 spawn 常量（灵猴 202、赵公明 208 等）
   *    仍在旧高度，统一补一次；
   *  · POI：天宫点位写在 layout.ts / palace.ts，传送落点必须与几何同高；
   *  · pool_cloud：realm.ts 用实例矩阵在 206–214 摆的云团，不是顶点几何。
   * 判据用 [HEAVEN_Y_MIN, HEAVEN_BASE_LIFTED)：人间 <150、地府为负都不会被误抬；
   * 已经抬过的对象（≥2131）也不会被抬第二次，所以本函数可以安全重入。
   */
  private liftHeavenResiduals(): void {
    for (const a of this.crowd?.actors ?? []) {
      if (a.pos.y >= HEAVEN_Y_MIN && a.pos.y < HEAVEN_BASE_LIFTED) a.pos.y += HEAVEN_LIFT;
    }
    for (const key in POIS) {
      const p = POIS[key];
      if (p.sky && p.pos.y >= HEAVEN_Y_MIN && p.pos.y < HEAVEN_BASE_LIFTED) p.pos.y += HEAVEN_LIFT;
    }
    const pool = this.engine.scene.getObjectByName('pool_cloud') as THREE.InstancedMesh | undefined;
    if (pool?.isInstancedMesh) {
      const m = new THREE.Matrix4();
      let maxY = -Infinity;
      for (let i = 0; i < pool.count; i++) {
        pool.getMatrixAt(i, m);
        maxY = Math.max(maxY, m.elements[13]);
      }
      if (maxY > -Infinity && maxY < HEAVEN_BASE_LIFTED) {
        for (let i = 0; i < pool.count; i++) {
          pool.getMatrixAt(i, m);
          m.elements[13] += HEAVEN_LIFT;
          pool.setMatrixAt(i, m);
        }
        pool.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private updateIndoorBloom(): void {
    const p = this.engine.camera.position;
    const inside =
      (p.x > 215 && p.x < 237 && p.z > 58 && p.z < 73 && p.y < 11) ||
      (p.x > 113 && p.x < 131 && p.z > 57 && p.z < 71 && p.y < 9) ||
      (p.x > 548 && p.x < 572 && p.z > -33 && p.z < -7 && p.y < 8);
    this.engine.bloomScale = inside ? 0.22 : 1;
  }

  /**
   * 水面反射闸门：只看「镜面四角投到屏幕后的包围盒」。
   * 相机在镜面背后、或镜面已缩成一条几像素的线时，Reflector 的第二次整场渲染
   * （实测每机位 220–245 次 draw call）换不来任何可见差异，直接不调用它。
   */
  private updateMirrorGate(): void {
    const m = this.mirror;
    if (!m) return;
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, front = 0;
    for (let i = 0; i < 4; i++) {
      const p = this.mirrorProbe
        .set(i & 1 ? 60 : -60, i & 2 ? 20 : -20, 0)
        .applyMatrix4(m.matrixWorld)
        .applyMatrix4(cam.matrixWorldInverse);
      // 背后的角：NDC 会被负 w 翻转成镜像值，不能参与包围盒
      if (p.z > -0.5) continue;
      front++;
      p.applyMatrix4(cam.projectionMatrix);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // 四角全在相机背后（地府仰视就是这种情况）：整块水面根本不在画面里，不必重绘
    if (front === 0) { this.mirrorHot = false; return; }
    // 只跨过近平面一部分：镜面横跨整个视口，保守起见照画
    const onScreen = front < 4 ? true : maxX > -0.15 && minX < 0.15 && maxY > -0.15 && minY < 0.15;
    const px = (maxY - minY) * 0.5 * this.engine.renderer.domElement.clientHeight;
    if (!onScreen) this.mirrorHot = false;
    else if (px >= 12) this.mirrorHot = true;
    else if (px < 7) this.mirrorHot = false;
  }

  update(t: number, dt: number): void {
    // P1-2 生存循环：饥饿/回血/晕倒沿（附身模式才推进——灵魂观景不饿）
    if (this.player.mode === 'avatar') this.survival.tick(dt);

    this._lastT = t;
    this._frame++;
    this.updateMirrorGate();
    this.updateIndoorBloom();
    this.applyLighting(t);
    this.applyHellDepth();
    this.applySkyDomeTint();
    // 远景云海仅在高空可见（地面视角不遮挡城区）
    const cf = this.engine.scene.getObjectByName('pool_cloudFar');
    // 远景云海在旧天宫高度（120m 以上）才可见；整层抬升后改用 +HEAVEN_LIFT 的相对阈值。
    if (cf) cf.visible = this.engine.camera.position.y > 120 + HEAVEN_LIFT;
    // R19：云海盘按观察者高度淡出——地面 ≤90m 时整片隐藏，≥180m 才满不透明。
    // 缺这一句时云海永远是满不透明的一块暗板，从地面看就是横贯地平线的一条黑带/黑圆。
    this.cloudSea?.setViewerY(this.engine.camera.position.y);
    this.crowd.isNight = this.engine.time.phase > 0.16 && this.engine.time.phase < 0.86;
    this.heroStage.update(t, dt);
    this.units.update(t, dt);
    this.units.updatePlayerBoat();
    if (!this.deityHold) this.deities.update(t, dt);
    this.boss.update(dt);
    // 界域可行走平面：相机夹取要用它，否则地府/天宫里的移动会把相机夹回人间地面
    this.engine.realmFloor = this.player?.realmY ?? 1.7;
    // 关卡威胁接线（第一条）：望乡台 30m 内「乡愁拖慢」，移动系数降到 0.55。
    // 威胁文案自此不再是装饰——`probe-threat` 用同距离位移量对比判定。
    if (this.player?.actor) {
      const wp = POIS['wangxiang'];
      const a = this.player.actor.pos;
      const near = wp ? Math.hypot(a.x - wp.pos.x, a.z - wp.pos.z) < 30 : false;
      this.player.speedScale = near ? 0.55 : 1;
    }
    // 三界音轨：跨界才发事件（每帧发会把 gain 调度打满）
    const cy = this.engine.camera.position.y;
    // 旧 120 是「天宫在 200m」时代的分界；抬升后人在 1000m 中空不该再算天宫。
    const realm = cy < -100 ? 'difu' : cy > 120 + HEAVEN_LIFT ? 'tiangong' : 'renjian';
    if (realm !== this.audioRealm) {
      this.audioRealm = realm;
      bus.emit('realm:change', realm);
    }
    this.havoc.update(t, dt);
    this.phaseName = this.havoc.currentPhase();
    this.creatures?.update(dt); // B9 巡游推进
    this.poiGuide?.update(this.engine.camera, this.engine.camera.position, POIS as unknown as Record<string, { name: string; pos: THREE.Vector3 }>);
    this.tickObjectives(dt);
    // 上河长卷运镜：北岸街 2.5m/s 东移，视线轻俯街市（960m 后停在瓦子口）
    if (this.scrolling) {
      const cam = this.engine.camera;
      this.scrollT += dt;
      // 机位抬到 14m：9m 高度会从两三层铺面的屋顶上擦过去，屋顶占满画面（长卷机位实测）
      // 长卷改走河心望北岸：14m 贴街飞会从铺面屋顶上掠过（屋顶占满下半屏），河心视角才有《上河》的岸线纵深
      cam.position.set(-560 + this.scrollT * 2.5, 16 + Math.sin(this.scrollT * 0.15) * 0.7, 20 + Math.cos(this.scrollT * 0.11) * 1.4);
      this.engine.lookTarget.set(cam.position.x + 18, 5, 58);
      this.engine.yaw = Math.atan2(-(this.engine.lookTarget.x - cam.position.x), -(this.engine.lookTarget.z - cam.position.z));
      this.engine.pitch = Math.asin((this.engine.lookTarget.y - cam.position.y) / cam.position.distanceTo(this.engine.lookTarget));
      if (cam.position.x > 380) this.scrolling = false;
    }
    this.mounts.update(t, dt);
    if (this.player.mode !== 'avatar') this.player.update(t, dt);
    this.interact.update();
    if (this.player.mode === 'avatar') {
      this.impacts.update(dt);
      if (this.player.state === 'foot') {
        this.impacts.vehicleSweep(this.player.actor, this.units.traffic());
        if (this._frame % 3 === 0) {
          // E1（审计 P1-3）：复用预分配数组原地压实，替代每 3 帧 new 一个 ~2000 元素 filter 数组
          // （基线实测 ≈13 数组/秒）；npcSweep 内部仍会复查 hidden，缓存不过期也安全。
          const w = this._npcWalkers;
          w.length = 0;
          for (const a of this.crowd.actors) {
            if (!a.hidden && !a.freeze && !a.sky && !a.attach && !a.data) w.push(a);
          }
          this.impacts.npcSweep(this.units.traffic(), w);
        }
      }
    }
    this.vfx.update(dt);
    this.audio.update(dt, this.engine.time.neon); // 精修8：声景时段化;
    this.crowd.update(t, dt, this.engine.camera.position);
  }

  /** 全城交互点登记 */
  private registerInteractions(): void {
    const I = this.interact;
    // ===== B8：61 交互点全表注册（20 卷 §5.2；R/W 挂既有坐骑/开船系统不重复注册） =====
    // B10：瑶池蟠桃赏赐（三币律第三接口）。
    // 审计 P1-1 修复：旧版把预缩放坐标当地球坐标直写 (150,208.5,20)，而真实瑶池在世界
    // (330,2148.6,44)（heavenY(204)≈2148.6，PLATFORMS 表 (150,204,25) r19 是玩家站面）——
    // distanceToSquared<25 永不成立，玩法整体不可达。现走 heavenPoint，y 与平台表同款 204；
    // r 取 11 = 预缩放 5 × HEAVEN_SCALE(2.2)。
    I.add(new THREE.Vector3(...heavenPoint(PEACH_GRANT.x, 204, PEACH_GRANT.z)), 11, '在瑤池·蟠桃賞賜（蟠桃点→铜钱单向）', () => {
      I.openShop(PEACH_GRANT.name, PEACH_GRANT.goods);
    });
    for (const p of POINTS) {
      if (p.system) continue;
      const pos = new THREE.Vector3(p.x, 0.1, p.z);
      if (p.kind === 'eat' || p.kind === 'buy') {
        const goods = p.goods ?? [{ name: p.name, price: 2, act: 'present', say: p.desc }];
        I.add(pos, 4.2, `在${p.name}·${p.desc}`, () => { I.openShop(p.name, goods); });
      } else if (p.kind === 'gamble') {
        I.add(pos, 4.0, `在${p.name}·${p.desc}`, () => { I.openDice(); });
      } else if (p.kind === 'show') {
        const fee = parseInt(p.desc.match(/(\d+)/)?.[1] ?? '5', 10);
        I.add(pos, 4.4, `看·${p.name}`, () => I.openShop(p.name, [{ name: '門票', price: fee, act: 'sitTea', say: `看了场${p.name}，值回票价` }]));
      } else if (p.kind === 'song') {
        const fee = parseInt(p.desc.match(/(\d+)/)?.[1] ?? '2', 10);
        I.add(pos, 4.0, `听·${p.name}`, () => I.openShop(p.name, [{ name: '點曲', price: fee, act: 'pluck', say: `${p.name}一曲，绕梁三日` }]));
      }
    }
    const P = this.player;
    const stallsCache = this.stalls;
    // 小吃摊：买小吃 + 吃
    const foods = stallsCache.filter((s) => s.kind === 'food');
    for (const s of foods) {
      I.add(new THREE.Vector3(s.x, 0.1, s.z), 3.6, '在小吃摊买点吃的', () => {
        this.survival.eat(30, 10);   // P1-2 生存循环：进食回饥饿+少量血
        I.openShop('小吃摊', [
          { name: '煎鱼整套', price: 12, act: 'eat', say: '外焦里嫩，趁热吃完了' },
          { name: '灌肺炒肺', price: 8, act: 'eat', say: '街边风味，唇齿留香' },
          { name: '冰雪冷元子', price: 6, act: 'eat', say: '冰凉甜润，暑气全消' },
        ]);
      });
    }
    // 杂货摊：买玩意儿
    for (const s of stallsCache.filter((x) => x.kind === 'stall').slice(0, 10)) {
      I.add(new THREE.Vector3(s.x, 0.1, s.z), 3.4, '在摊上淘件玩意儿', () => {
        I.openShop('杂货摊', [
          { name: '糖人', price: 15, act: 'eat', say: '举着糖人，甜到心里' },
          { name: '汴京地图册', price: 40, act: 'present', say: '一册在手，全城任行' },
          { name: '纸鸢', price: 25, act: 'present', say: '买只纸鸢，春日正好' },
        ]);
      });
    }
    // 茶坊：喝茶
    for (const [x, z] of [[-36, 58], [40, 58], [168, 58], [330, 58], [480, 60]] as const) {
      I.add(new THREE.Vector3(x, 0.1, z), 3.4, '坐下喝碗茶', () => {
        if (I.tryPay(5)) I.act('sitTea', 8, '五文钱的雨前茶，喝得通体舒泰');
      });
    }
    // 正店/脚店：喝酒
    for (const [x, z, nm] of [[226, 56, '孙羊正店'], [122, 56, '十千脚店'], [-40, -58, '南岸酒肆'], [430, 60, '城门酒家']] as const) {
      I.add(new THREE.Vector3(x, 0.1, z), 3.8, '进' + nm + '喝酒', () => {
        I.openShop(nm, [
          { name: '羊羔酒一盏', price: 20, act: 'drink', say: '好酒入喉，暖意直上头顶' },
          { name: '招牌菜两道', price: 40, act: 'eat', say: '大快朵颐，不枉此行' },
          { name: '青梅酒一壶', price: 30, act: 'drink', say: '青梅煮酒，快意汴京' },
        ]);
      });
    }
    // 赌坊：骰宝
    for (const [x, z] of [[210, 84], [280, 88], [340, 84], [-30, -70]] as const) {
      I.add(new THREE.Vector3(x, 0.1, z), 3.4, '掷骰子押一把', () => I.openDice());
    }
    // 瓦子看戏
    I.add(new THREE.Vector3(306, 0.1, 78), 6, '坐在勾栏看戏', () => I.act('sitTea', 20, '锣鼓开场，胡旋如风，满堂喝彩'));
    I.add(new THREE.Vector3(240, 0.1, 88), 5, '听一场小唱', () => I.act('sitTea', 12, '清音婉转，众人屏息'));
    // 说书
    for (const [x, z] of [[-30, 42], [306, 70]] as const) {
      I.add(new THREE.Vector3(x, 0.1, z), 4.5, '坐听说书', () => I.act('sitTea', 14, '醒木一拍，千秋故事入耳来'));
    }
    // 听曲（乐伎）
    for (const [x, z] of [[232, 58], [306, 66]] as const) {
      I.add(new THREE.Vector3(x, 0.1, z), 4, '赏一曲（5 文）', () => {
        if (I.tryPay(5)) I.act('sitTea', 10, '一曲终了，绕梁三日');
      });
    }
    // 弹琴
    I.add(new THREE.Vector3(this.interactProps.qin[0], 0.1, this.interactProps.qin[1]), 3.6, '抚琴一曲', () => I.act('pluck', 9, '你端坐琴案，弹了一曲《平沙落雁》'));
    // 下棋
    for (const [x, z] of this.interactProps.chess) {
      I.add(new THREE.Vector3(x, 0.1, z), 3.4, '与人对弈五子棋', () => I.openGomoku());
    }
    // 客栈睡觉
    I.add(new THREE.Vector3(this.interactProps.inn[0], 0.1, this.interactProps.inn[1] + 4.2), 3.8, '开间房睡一觉（10 文）', () => {
      if (I.tryPay(10)) I.act('lieSleep', 6, '一夜好眠，神清气爽');
    });
    // 净房 / 墙角
    for (const [x, z] of this.interactProps.toilet) {
      I.add(new THREE.Vector3(x, 0.1, z), 3.2, '去净房方便一下', () => I.act('squatRel', 4, '……人有三急，解决了'));
    }
    // 码头扛包赚钱
    for (const [x, z] of [[-238, 38], [-252, 36], [-222, 36]] as const) {
      I.add(new THREE.Vector3(x, 0.95, z), 3.2, '帮码头扛包赚钱（+20 文）', () => {
        I.act('carryPole', 8, '你扛起货包往返奔走……');
        window.setTimeout(() => { I.earn(20); bus.emit('ui:toast', '工头丢给你 20 文工钱'); }, 8200);
      });
    }
    // 铁匠铺：买钢刀（攻击力提升，视觉佩刀）
    I.add(new THREE.Vector3(380, 0.1, 62), 4, '汤隆铁匠铺：买口钢刀（30 文）', () => {
      if (this.playerWeapon.mult > 1) { bus.emit('ui:toast', '你已佩着钢刀'); return; }
      if (I.tryPay(30)) {
        this.playerWeapon = { mult: 2.5, label: '钢刀' };
        const bladeSlot = this.crowd.poolSet().get('blade').alloc(1);
        this.player.actor.propPool = 'blade';
        this.player.actor.slots.prop = bladeSlot;
        this.player.actor.lastWrite = -1;
        bus.emit('ui:toast', '钢刀到手！挥刀（F/点击）威力大增');
      }
    });
    // 凌振大炮：炮击汴河（击飞/碎裂级火力）
    I.add(new THREE.Vector3(-320, 0.1, 42), 4.5, '助凌振点炮——轰击汴河！', () => {
      bus.emit('ui:toast', '凌振大笑三声，火炮轰然点火——');
      const target = new THREE.Vector3(-280 + Math.random() * 40, 0, -6 + Math.random() * 16);
      window.setTimeout(() => this.impacts.cannonBlast(target, 200, this.crowd.actors), 900);
    });
    // 骑坐骑
    for (const m of this.mounts.rideables) {
      I.add(m.pos.clone(), 4.2, '骑上' + m.name + (m.flying ? '（可飞天）' : ''), () => {
        this.player.mounted = m;
        this.player.state = 'mount';
        this.player.actor.pos.set(m.pos.x, m.pos.y + m.riderAnchor, m.pos.z);
        bus.emit('ui:toast', '你翻身上' + m.name + '——' + (m.flying ? 'Space 升空，Ctrl 下降，能一路飞进天宫' : 'Shift 疾驰，E 下马'));
      }, () => this.player.mounted !== m && this.player.state === 'foot');
    }
    // 开船
    I.add(new THREE.Vector3(this.units.playerBoat.x, 0.4, this.units.playerBoat.z), 4.5, '跳上小船去开船', () => {
      this.player.boat = this.units.playerBoat;
      this.units.playerBoat.driven = true;
      this.player.state = 'boat';
      this.player.actor.pos.set(this.units.playerBoat.x - 1.6, -0.5, this.units.playerBoat.z - 1.6);
      bus.emit('ui:toast', '你跳上小船——W 前进，A/D 转舵，E 靠岸下船');
    }, () => !this.units.playerBoat.driven && this.player.state === 'foot');
    // 阴阳界与返阳门提示
    I.add(new THREE.Vector3(470, 0, 24), 5, '步入「阴阳界」，直下地府', () => {
      this.player.actor.pos.set(0, UNDER.y, -130);
      bus.emit('ui:toast', '一步踏出，阳间灯火熄灭——幽冥到了');
    });
    I.add(new THREE.Vector3(0, UNDER.y, -124), 5, '走「返阳门」回汴京', () => {
      this.player.actor.pos.set(472, 0, 28);
      bus.emit('ui:toast', '你回到了阳间——人间烟火扑面而来');
    });
  }

  setDensity(f: number): void {
    this.densitySetting = f;
    this.applyDensity();
  }

  private applyDensity(): void {
    const f = this.densitySetting * this.engine.quality.crowd;
    const walkers = this.crowd.actors.filter((a) => !a.data && !a.freeze && !a.sky && !a.attach);
    const keep = Math.floor(walkers.length * f);
    walkers.forEach((a, i) => {
      const want = i < keep || (a.id * 7919) % 100 < 12;
      a.hidden = !want;
    });
    bus.emit('crowd:density', keep);
  }

  focusHero(code: string): void {
    const h = this.crowd.heroes.find((x) => x.data?.code === code);
    if (!h) return;
    this.engine.focusOn(h.pos.clone().add(new THREE.Vector3(0, h.yOff, 0)), 6 + h.scale * 6, 8);
    bus.emit('hero:focus', {
      name: h.data!.name, nick: h.data!.nick, group: h.data!.group,
      weapon: h.data!.weapon, desc: h.data!.desc, doing: h.doing,
    });
  }

  /** 传送机位：部分 POI 默认偏移会扎进建筑/云层，单独给视角 */
  private static CAM_OFF: Record<string, [number, number, number]> = {
    bridge: [9, 5.5, 13], sunyang: [14, 14, -34], shiqian: [9, 4.5, -13], washi: [30, 7, -54],
    wharf: [10, 12, 25], southbank: [-9, 5, -10], countryside: [26, 16, -34],
    gate: [38, 20, 44], yamen: [26, 15, 30], pagoda: [62, 36, 92],
    nantianmen: [-4, 10, 26], lingxiao: [38, 26, 72], pantao: [16, 12, 16],
    jiangtai: [14, 15, 27], star9: [72, 40, 92],
    naihe: [30, 16, 30], yanluo: [0, 26, 92],
    fengdu: [-300, 5.5, 0], zichen: [96, 30, 172],
    yinyanggate: [8, 5, 10], desert: [34, 22, 44], mengpo: [17, 9, 15], sansheng: [16, 10, 20], wangxiang: [22, 12, 26], shibayu: [0, 40, 70],
  };

  teleport(key: string): boolean {
    const poi = POIS[key];
    if (!poi) return false;
    this.engine.stopCinema();
    const p = poi.pos;
    // 化身必须一起动：只移机位的话，玩家脚步一更新就把相机拉回原处，
    // 表现为「传送后面板显示到了，走两步又回到原地」（probe-level 实测目标行仍是原点附近的 POI）。
    if (this.player?.actor) {
      this.player.actor.pos.set(p.x, p.y + 0.5, p.z);
    }
    const off = World.CAM_OFF[key] ?? [12, 7, 16];
    const cx = this.engine.camera.position;
    cx.set(p.x + off[0], p.y + off[1], p.z + off[2]);
    this.engine.lookTarget.set(p.x, p.y + 2.5, p.z);
    this.engine.setCamMode('fly');
    // setCamMode('fly') 对已处于 fly 的相机早退，yaw/pitch 不会重算——
    // 首帧 updateCamera 会用陈旧朝向覆盖 lookTarget（传送后看向随机方向的真实玩法 bug）
    const dx = this.engine.lookTarget.x - cx.x, dy = this.engine.lookTarget.y - cx.y, dz = this.engine.lookTarget.z - cx.z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    this.engine.yaw = Math.atan2(-dx, -dz);
    this.engine.pitch = Math.asin(THREE.MathUtils.clamp(dy / dist, -1, 1));
    bus.emit('ui:toast', '已传送：' + poi.name);
    bus.emit('sfx:teleport');
    this.scrolling = key === 'scroll'; // 进 scroll POI 启横移观画，其余传送即停
    if (this.scrolling) this.scrollT = Math.max(0, (this.engine.camera.position.x + 560) / 2.5); // 无缝接上传送落点
    return true;
  }

  /** 当前所在关卡节点（目标/威胁/恢复点），供 HUD 与探针读取 */
  levelNow(): { key: string; name: string; objective: string; dist: number } | null {
    return this.poiGuide?.current() ?? null;
  }

  /**
   * 目标链：按 `LEVEL_ORDER`（人间 → 天宫 → 地府）返回第一个未完成节点。
   * 只认 `LEVEL_PLAN` 的 17 个节点——`poiGuide` 额外导引的桥/府衙/孙羊正店等键
   * 会被 `tickObjectives` 标记 done，但不属于关卡进度；全部完成返回 null。
   * 顺序固定（不按距离漂移），玩家在任意位置看到的「下一个」都是同一目标，
   * 否则「走近另一个点再退回」会让 HUD 的下一个目标来回跳。
   */
  nextObjective(): ObjectiveStep | null {
    const i = firstOpenIndex(this.objectiveDone);
    if (i < 0) return null;
    const key = LEVEL_ORDER[i];
    return { key, name: POIS[key]?.name ?? key, objective: levelOf(key).objective, index: i + 1, total: LEVEL_TOTAL };
  }

  /** 进度快照（HUD 与探针共用）：done 只数 17 个关卡节点；next 为显示名，无则 null */
  objectiveProgress(): { done: number; total: number; next: string | null; nextKey: string | null } {
    const n = this.nextObjective();
    return {
      done: countLevelDone(this.objectiveDone),
      total: LEVEL_TOTAL,
      next: n ? n.name : null,
      nextKey: n ? n.key : null,
    };
  }

  /** 目标判定：Boss 节点看战绩，其余节点看「是否走遍」（距离进入节点半径） */
  private objectiveReached(key: string): boolean {
    if (key === 'jiangtai') return !!this.boss?.defeated;
    const poi = POIS[key];
    if (!poi) return false;
    // 必须按**化身**距离判定：相机是第三人称偏移 45m，用相机距离会出现「人没走到就判达成」
    const a = this.player?.actor?.pos;
    if (!a) return false;
    const d = Math.hypot(a.x - poi.pos.x, a.z - poi.pos.z);
    // 半径系数压到 0.2：将台与星宿九府中心只差 10m，宽半径会让「传送到将台」顺手点亮星宿九府
    return d <= Math.max(6, (poi.radius ?? 14) * 0.2);
  }

  private tickObjectives(dt: number): void {
    this.objT -= dt;
    if (this.objT > 0) return;
    this.objT = 0.4;
    const n = this.poiGuide?.current();
    if (!n || this.objectiveDone[n.key]) return;
    if (!this.objectiveReached(n.key)) return;
    this.objectiveDone[n.key] = true;
    if (!this.codexLog.some((e) => e.code === 'node:' + n.key)) {
      this.codexLog.push({ code: 'node:' + n.key, name: n.name, note: '已达成 · ' + n.objective });
    }
    // 只有目标链节点才计进度：桥/府衙等导引点也会被 tickObjectives 标记 done，
    // 但它们不在 LEVEL_ORDER 里，若照发事件会让 HUD 闪出「目标 0/17 达成」。
    const inChain = LEVEL_ORDER.includes(n.key);
    const prog = this.objectiveProgress();
    bus.emit('ui:toast', inChain ? `目标达成：${n.name}（${prog.done}/${prog.total}）` : `目标达成：${n.name}`);
    bus.emit('sfx:pick');
    if (inChain) {
      // HUD 顶部短暂显示「目标 N/17 达成」；next 由 HUD 轮询 objectiveProgress 兜底刷新
      bus.emit('objective:done', { key: n.key, name: n.name, ...prog });
    }
  }

  /** 复位：把玩家的**化身**送到恢复点（teleport 只动机位，不动化身 —— 二者必须一起动） */
  respawnPlayerAt(key: string): boolean {
    const poi = POIS[key];
    if (!poi) return false;
    if (this.player?.actor) this.player.actor.pos.set(poi.pos.x, poi.pos.y + 0.5, poi.pos.z);
    return this.teleport(key);
  }

  heroEntries(): HeroEntry[] {
    return this.crowd.heroes.filter((h) => h.data).map((h) => ({
      code: h.data!.code ?? '', name: h.data!.name, nick: h.data!.nick, group: h.data!.group,
      doing: h.doing, weapon: h.data!.weapon ?? '', desc: h.data!.desc ?? '',
      x: h.pos.x, z: h.pos.z, sky: h.pos.y > 120,
    }));
  }

  liveCount(): number {
    return this.crowd.actors.filter((a) => !a.hidden).length;
  }
}
