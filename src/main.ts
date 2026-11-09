import * as THREE from 'three';
import { Engine } from './core/engine';
import { World } from './world';
import { STATION } from './data/shuihu';
import { initUI } from './ui/ui';
import { BuildMode } from './game/buildMode';
import { CreationSystem } from './game/creation';
import { WISH_CATALOG, catalogStats, searchCatalog, getById } from './game/wishCatalog';
import { resolveWish, parseIntent, loadAgentConfig } from './game/wishAgent';
import { STAGES, XP_THRESHOLDS } from './game/wishEvolution';
import { AGENT_CAPABILITIES, capabilityStats, planCapabilities } from './game/agentCapabilities';
import { noticeText, doneText, offlineResearch } from './game/assetPipeline';
import { solidsStats, solidBlocked } from './rt/solids';
import type { WishPanel } from './game/wishPanel';

// ============ 入口：加载 → 世界生成 → 开场运镜 ============
async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const loading = document.getElementById('loading')!;
  const bar = document.querySelector('#loading .load-bar i') as HTMLElement;
  const tip = document.querySelector('.load-tip') as HTMLElement;

  const poems = [
    '虹桥细浪，正店灯明 —— 人在画中行',
    '一朝步入画卷，一日梦回千年',
    '天上一场闹，人间满城灯',
  ];
  let poemI = 0;
  const poemTimer = window.setInterval(() => {
    const el = document.querySelector('.load-poem');
    if (el) el.textContent = poems[(++poemI) % poems.length];
  }, 2600);

  let engine: Engine;
  try {
    engine = new Engine(app);
  } catch (err) {
    tip.textContent = '您的浏览器不支持 WebGL2，请更换 Chrome / Edge 浏览器。';
    console.error(err);
    return;
  }
  const world = new World(engine);
  // 全量审核 2026-11-07（B-02 / 蓝队 §二.1）：调试句柄必须在 initUI() 首刷与
  // world.init() 内部所有代码之前注入。旧版放在 await world.init() 之后，导致
  // ① initUI 首刷读不到 world.interact（顶栏三币恒为空 / '-- 文'）；
  // ② 启动期 InteractSystem.save() 的 window.__qingming.world 必然 undefined，
  //    IDB 写档整段被跳过（不是 __saveSave 竞态，是 100% 确定的时序）。
  (window as unknown as Record<string, unknown>)['__qingming'] = {
    engine, world, THREE, scene: engine.scene,
    // R27 无头验收句柄：读统计 / 直接触发一次破坏命中（命中点世界坐标 + 半径）。
    solids: () => solidsStats(),
    // R27：直接查询某点是否有登记过的碰撞面（验收用它证明用户截图那堵宫墙真挡人、
    // 以及破坏命中后破口真的放行）。
    solidBlockedAt: (x: number, z: number, y = 0) => solidBlocked(x, z, 0.34, y, 1.7),
    destruction: () => world.destruction?.stats() ?? null,
    destructionHit: (x: number, y: number, z: number, power: number, radius: number,
      source?: 'player' | 'cannon' | 'vehicle' | 'boss' | 'test') =>
      world.destruction?.hit({ point: new THREE.Vector3(x, y, z), power, radius, source: source ?? 'test' }) ?? null,
  };
  const uiTick = initUI(engine, world);

  // ===== 三界造物 · 许愿台（融合终版垂直切片）：window.__wish 自动化验收句柄 =====
  const wishPanel = (window as unknown as Record<string, unknown>)['__wishPanel'] as WishPanel | undefined;
  const wishApi = {
    catalogCount: catalogStats().total,
    catalogStats,
    searchCatalog,
    getById,
    catalog: WISH_CATALOG,
    parseIntent,
    resolveWish,
    stages: STAGES,
    xpThresholds: XP_THRESHOLDS,
    config: () => { const c = loadAgentConfig(); return { ...c, apiKey: c.apiKey ? '****' : '' }; },
    entities: () => wishPanel?.entities() ?? [],
    spawn: (text: string) => wishPanel?.spawn(text) ?? Promise.resolve({ ok: false, tier: 'none', count: 0, spawned: [], reason: 'wishPanel 未初始化' }),
    spawnById: (id: string) => wishPanel?.spawnById(id) ?? null,
    evolve: (id: string) => wishPanel?.evolve(id),
    upgrade: (id: string) => wishPanel?.upgrade(id),
    merge: (a: string, b: string) => wishPanel?.merge(a, b) ?? null,
    gainXp: (id: string, n: number) => wishPanel?.gainXp(id, n),
    interact: (id: string, verb: string) => wishPanel?.interact(id, verb),
    select: (id: string) => wishPanel?.select(id),
    tick: (dt: number) => wishPanel?.tick(dt),
    // ===== R25 融合玩法：设定开发 / 全量资产 / 建造 / 五大玩法实证 =====
    assetCount: () => wishPanel?.assetCount() ?? 0,
    blueprints: () => wishPanel?.blueprints() ?? [],
    develop: (text: string) => wishPanel?.develop(text) ?? Promise.resolve(null),
    cardHtml: (name?: string) => wishPanel?.cardHtml(name) ?? '',
    spawnByName: (name: string) => wishPanel?.spawnByName(name) ?? null,
    spawnHostile: () => wishPanel?.spawnHostile() ?? null,
    setBehavior: (id: string, b: string) => wishPanel?.setBehavior(id, b as 'follow' | 'roam' | 'guard' | 'ride') ?? false,
    buildStats: () => wishPanel?.buildStats() ?? null,
    buildParts: () => wishPanel?.buildParts() ?? [],
    place: () => wishPanel?.placeSelected() ?? null,
    toggleBuild: () => wishPanel?.toggleBuild() ?? false,
    combineBuild: () => wishPanel?.combineBuild() ?? null,
    undoBuild: () => wishPanel?.undoBuild(),
    playReport: () => wishPanel?.playReport() ?? null,
    worldEvents: () => wishPanel?.worldEvents() ?? [],
    saveState: () => wishPanel?.saveState(),
    restoreState: () => wishPanel?.restoreState() ?? 0,
    clearState: () => wishPanel?.clearState(),
    importAssets: (json: string) => wishPanel?.importAssets(json) ?? 0,
    // ===== R26：吞噬体系 + 8 机位离屏截图验证 =====
    devour: (predator: string, prey: string) => wishPanel?.devour(predator, prey) ?? null,
    devourCount: () => wishPanel?.devourCount() ?? 0,
    devourResult: () => wishPanel?.lastDevourResult() ?? null,
    validation: () => wishPanel?.validation() ?? null,
    lastBlueprint: () => wishPanel?.blueprintSummary() ?? null,
    // ===== R26：WorkBuddy 能力注册表 / 资产构建流水线 / 提示文案 =====
    pipeline: () => wishPanel?.pipeline() ?? null,
    capabilities: () => ({ total: AGENT_CAPABILITIES.length, stats: capabilityStats() }),
    planCapabilities: (t: string) => planCapabilities(t).map((c) => c.id),
    noticeText: (n: string) => noticeText(n),
    doneText: (n: string) => doneText(n),
    offlineResearch: (n: string, traits?: string[], source?: string) => offlineResearch(n, traits, source),
    panel: wishPanel,
  };
  (window as unknown as Record<string, unknown>)['__wish'] = wishApi;
  // 每帧 tick 由 world.update 驱动（world.ts 已追加 onWishTick 调用）
  world.onWishTick = (dt) => { wishPanel?.tick(dt); };

  await world.init((p, label) => {
    bar.style.width = (p * 100).toFixed(0) + '%';
    tip.textContent = label + '……';
  });
  bar.style.width = '100%';

  // P1-2 建造模式：G 键切换、hotbar、射线放/拆（world.voxelMesh 由载入链产出）
  const build = new BuildMode(() => engine.scene, () => engine.camera);
  build.init(world.voxelMesh!, document.getElementById('ui')!);
  build.spend = (n) => world.interact.tryPay(n);
  build.earn = (n) => world.interact.earn(n);
  (window as unknown as Record<string, unknown>)['__build'] = build;

  // P1-2 造物链：Y 命令条 → 程序化生成 → 四门 → 落场（S10/S11 最小可玩版）
  const creation = new CreationSystem(document.getElementById('ui')!);
  creation.attachScene(engine.scene);
  creation.spend = (n) => world.interact.tryPay(n);
  creation.placement = (forward) => {
    const pl = world.player;
    const yaw = engine.yaw;
    const x = pl.actor.pos.x + Math.sin(yaw) * -forward;
    const z = pl.actor.pos.z + Math.cos(yaw) * -forward;
    const gy = pl.groundHeight(x, z, pl.actor.pos.y);
    return { x, y: Number.isFinite(gy) ? gy : pl.actor.pos.y, z };
  };
  (window as unknown as Record<string, unknown>)['__creation'] = creation;
  world.onRebuildCreations = () => { world.creationCount = creation.rebuildAll(); };
  // 全量审核 2026-11-07（B-01）：world.init() 内的「造物重演」载入任务已删除——
  // 它执行时本回调恒为 null（注入在 await 之后），花 100 文造的龙刷新即消失且钱不退。
  // 改在装配完成后显式触发一次；persist 实体已在 world.init() 读档阶段恢复到实体表。
  world.onRebuildCreations();
  const origSubmit = creation.submit.bind(creation);
  creation.submit = async (t?: string) => {
    const r = await origSubmit(t);
    if (r.ok) world.creationCount++;
    return r;
  };

  engine.addUpdate({ update: (t, dt) => { world.update(t, dt); } });
  engine.addUpdate({ update: (_t, dt) => { uiTick(dt); } });
  engine.start();

  window.clearInterval(poemTimer);
  window.setTimeout(() => loading.classList.add('done'), 350);
  window.setTimeout(() => loading.remove(), 1800);

  engine.startCinema();
  // 自动化测试句柄已提前到 initUI() 之前注入（B-02 / 蓝队 §二.1）。
  (window as unknown as Record<string, unknown>)['__STATION_PROBE'] = STATION;
  // 对标落地：draw-call 预算探针（bersus.io/threejsroadmap 纪律——每帧可观测）
  (window as unknown as Record<string, unknown>)['__perf'] = () => ({ calls: engine.renderer.info.render.calls, tris: engine.renderer.info.render.triangles });
}

// P1-2：boot() 原先无 catch——init 任一步抛错即 unhandled rejection，用户停在加载页无任何提示
boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const tip = document.querySelector('.load-tip');
  if (tip) tip.textContent = `加载失败：${msg}（按 F5 重试）`;
  console.error('[boot]', err);
});
