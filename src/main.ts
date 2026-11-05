import * as THREE from 'three';
import { Engine } from './core/engine';
import { World } from './world';
import { STATION } from './data/shuihu';
import { initUI } from './ui/ui';
import { BuildMode } from './game/buildMode';

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
  const uiTick = initUI(engine, world);

  await world.init((p, label) => {
    bar.style.width = (p * 100).toFixed(0) + '%';
    tip.textContent = label + '……';
  });
  bar.style.width = '100%';

  // P1-2 建造模式：G 键切换、hotbar、射线放/拆（world.voxelMesh 由载入链产出）
  const build = new BuildMode(() => engine.scene, () => engine.camera);
  build.init(world.voxelMesh!, document.getElementById('ui')!);
  (window as unknown as Record<string, unknown>)['__build'] = build;

  engine.addUpdate({ update: (t, dt) => { world.update(t, dt); } });
  engine.addUpdate({ update: (_t, dt) => { uiTick(dt); } });
  engine.start();

  window.clearInterval(poemTimer);
  window.setTimeout(() => loading.classList.add('done'), 350);
  window.setTimeout(() => loading.remove(), 1800);

  engine.startCinema();
  // 自动化测试句柄（不影响正常游玩）
  (window as unknown as Record<string, unknown>)['__qingming'] = { engine, world, THREE, scene: engine.scene };
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
