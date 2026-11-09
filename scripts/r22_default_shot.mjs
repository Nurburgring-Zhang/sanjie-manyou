/**
 * R22 画面级根因定位：默认机位 + 23 号坊间机位 + 03 号俯瞰机位，各拍一张图，
 * 并用「相机射线 × y=0 平面」纯数学求交反算屏幕网格对应的世界坐标。
 * 不做全场景 intersectObjects（合批后 7800 万面会卡死无头浏览器）。
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4173/ node scripts/r22_default_shot.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
const W = 1600, H = 900;
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2500));

const setCam = (c) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(c[3], c[4], c[5]);
  const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
};

/** 屏幕 16×9 网格 → y=0 平面世界坐标；同时回报相机位置与朝向 */
const groundGrid = () => {
  const { engine, THREE } = window.__qingming;
  const cam = engine.camera;
  const ray = new THREE.Raycaster();
  const grid = [];
  for (let iy = 0; iy < 9; iy++) {
    const row = [];
    for (let ix = 0; ix < 16; ix++) {
      const ndc = new THREE.Vector2((ix + 0.5) / 16 * 2 - 1, -((iy + 0.5) / 9 * 2 - 1));
      ray.setFromCamera(ndc, cam);
      const dy = ray.ray.direction.y;
      if (dy >= -1e-6) { row.push(null); continue; }
      const t = -ray.ray.origin.y / dy;
      if (t <= 0 || t > 200000) { row.push(null); continue; }
      const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
      row.push([Math.round(p.x), Math.round(p.z)]);
    }
    grid.push(row);
  }
  return {
    camera: [Math.round(cam.position.x), Math.round(cam.position.y), Math.round(cam.position.z)],
    grid,
  };
};

const report = { url: URL, bundle: null, cams: [], pageErrors: errs };
report.bundle = await page.evaluate(() =>
  Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')));

const CAMS = [
  { tag: 'default', file: 'r22-final-default.png' },
  { tag: 'grove', file: 'r22-final-grove.png', cam: [360, 22, 250, 320, 2, 180] },
  { tag: 'infill', file: 'r22-final-infill.png', cam: [500, 120, 440, 500, 0, 185] },
];

for (const c of CAMS) {
  if (c.cam) { await page.evaluate(setCam, c.cam); await new Promise((r) => setTimeout(r, 1400)); }
  await page.screenshot({ path: path.join(OUT, c.file) });
  const g = await page.evaluate(groundGrid);
  report.cams.push({ tag: c.tag, file: c.file, ...g });
  console.log(`=== ${c.tag} camera=${JSON.stringify(g.camera)} ===`);
  // 只打印第 3/5/7 行（中远景）的 x 范围，供定位裸地
  for (const row of [2, 4, 6]) {
    const xs = g.grid[row].filter(Boolean).map((p) => p[0]);
    const zs = g.grid[row].filter(Boolean).map((p) => p[1]);
    console.log(`  row${row}: x ${Math.min(...xs)}…${Math.max(...xs)}  z ${Math.min(...zs)}…${Math.max(...zs)}`);
  }
}

fs.writeFileSync(path.join(OUT, 'r22-default-ray.json'), JSON.stringify(report, null, 2));
console.log('\npageErrors', errs.length);
await browser.close();
