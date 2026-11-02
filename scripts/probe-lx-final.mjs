import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,800', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:4289/', { waitUntil: 'domcontentloaded', timeout: 240000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 900));

// 只冻结「相机/玩家」，保留 world.update 与 engine.updateCamera 的调色板/灯光/天空更新
await p.evaluate(() => {
  const { engine, world, THREE } = window.__qingming;
  world.player.followCam = () => {};
  engine.avatarCtl = null;
  const orig = engine.updateCamera.bind(engine);
  window.__cam = { pos: [0, 300, -200], look: [0, 300, 200], fov: 50 };
  engine.updateCamera = (dt) => {
    orig(dt);
    const c = window.__cam;
    engine.camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    engine.camera.lookAt(new THREE.Vector3(c.look[0], c.look[1], c.look[2]));
    engine.camera.fov = c.fov;
    engine.camera.updateProjectionMatrix();
    engine.camera.updateMatrixWorld(true);
  };
  engine.time && engine.time.jump && engine.time.jump('dawn');
});

const shots = [
  { name: 'lx-a-gate-view', pos: [0, 268, -150], look: [0, 330, 200], fov: 55 },
  { name: 'lx-b-300m', pos: [0, 330, -235], look: [0, 330, 209], fov: 46 },
  { name: 'lx-c-side', pos: [430, 340, 140], look: [0, 300, 200], fov: 45 },
  { name: 'lx-g-interior-front', pos: [0, 286, 168], look: [0, 282, 250], fov: 60 },
  { name: 'lx-h-interior-top', pos: [0, 306, 162], look: [0, 272, 232], fov: 72 },
];
for (const s of shots) {
  const ok = await p.evaluate((cfg) => {
    const q = window.__qingming;
    if (!q) return false;
    window.__cam = { pos: cfg.pos, look: cfg.look, fov: cfg.fov };
    if (q.engine.scene.fog) { q.engine.scene.fog.near = 4000; q.engine.scene.fog.far = 12000; }
    return true;
  }, s);
  if (!ok) { console.log('NO WORLD', s.name); continue; }
  await new Promise((r) => setTimeout(r, 700));
  await p.screenshot({ path: `screenshots/${s.name}.png` });
  console.log('shot', s.name);
}
await b.close();
