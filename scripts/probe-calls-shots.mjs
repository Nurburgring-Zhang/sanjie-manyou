/**
 * 六机位截图：给 draw-call 改动做视觉对账（反射闸门 / 图层分流不许改动画面内容）。
 *
 * 与 probe-calls-sweep.mjs 用**同一组机位**，只是把 1.5s 的采样换成一张定帧。
 * 输出目录由 SHOT_DIR 指定，默认系统临时目录（不往仓库里堆 PNG）。
 *
 * 用法：PROBE_URL=http://localhost:4249/ node scripts/probe-calls-shots.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.PROBE_URL || 'http://localhost:4249/';
const DIR = process.env.SHOT_DIR || join(tmpdir(), 'cq-calls-shots');
mkdirSync(DIR, { recursive: true });

const VIEWS = [
  { name: '01-street', p: [-197, 14, 36], t: [0, 8, -60] },
  { name: '02-axis', p: [0, 30, 2400], t: [0, 20, -2000] },
  { name: '03-aerial', p: [0, 1200, 1215], t: [0, 0, 0] },
  { name: '04-bridge', p: [0, 34, 64], t: [0, 10, -6] },
  { name: '05-celestial', p: [420, 360, 420], t: [0, 275, 0] },
  { name: '06-underworld', p: [0, -200, 152], t: [0, -232, 0] },
];

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

for (const v of VIEWS) {
  const state = await page.evaluate(async (vv) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(vv.p[0], vv.p[1], vv.p[2]);
    const dx = vv.t[0] - vv.p[0], dy = vv.t[1] - vv.p[1], dz = vv.t[2] - vv.p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.camera.updateMatrixWorld(true);
    await new Promise((r) => setTimeout(r, 900));
    const w = window.__qingming.world;
    let instances = 0, meshes = 0;
    e.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      if (o.isInstancedMesh) instances += o.count;
    });
    return { mirrorHot: w ? w.mirrorHot : null, instances, meshes, calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles };
  }, v);
  await page.screenshot({ path: join(DIR, v.name + '.png') });
  console.log(`${v.name.padEnd(14)} calls ${String(state.calls).padStart(4)}  tris ${String(state.tris).padStart(9)}  meshes ${state.meshes}  instances ${state.instances}  mirrorHot=${state.mirrorHot}`);
}

console.log('shots -> ' + DIR);
await browser.close();
