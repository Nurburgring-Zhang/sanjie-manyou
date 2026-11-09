/**
 * R24：复现用户截图「午门内上下两片巨大灰板 + 中间一条远景缝」，
 * 并用 Raycaster 读出这些灰板的真实网格与高度，定位结构错误。
 * 用法：node scripts/r24_wumen_probe.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2600));

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

const CAMS = [
  { id: 'A-tunnel-inside', label: '城台内部（复现用户截图）', cam: [0, 5.2, -2952, 0, 5.0, -3100] },
  { id: 'B-south-approach', label: '午门南侧正视', cam: [0, 5.2, -2890, 0, 5.0, -2950] },
  { id: 'C-hall-inside', label: '五凤楼殿内', cam: [0, 17.4, -2938, 0, 17.0, -2962] },
];

const report = { at: new Date().toISOString(), url: URL, shots: [], pageErrors: errs };
for (const c of CAMS) {
  await page.evaluate(setCam, c.cam);
  await new Promise((r) => setTimeout(r, 1500));
  const file = path.join(OUT, 'r24-wumen-' + c.id + '.png');
  await page.screenshot({ path: file });
  report.shots.push({ id: c.id, label: c.label, cam: c.cam, file });
  console.log('shot', c.id, '->', file);
}

// 从城台内部向上/向下/向北打三条射线，读出「灰板」是谁
report.rays = await page.evaluate(() => {
  const q = window.__qingming, THREE = q.THREE;
  const at = new THREE.Vector3(0, 5.2, -2952);
  const dirs = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1] };
  const out = {};
  for (const [k, d] of Object.entries(dirs)) {
    const ray = new THREE.Raycaster(at, new THREE.Vector3(...d).normalize(), 0, 400);
    out[k] = ray.intersectObjects(q.scene.children, true)
      .filter((h) => h.object.isMesh && h.object.visible).slice(0, 5)
      .map((h) => ({ name: h.object.name || '(unnamed)', dist: +h.distance.toFixed(2), y: +h.point.y.toFixed(2) }));
  }
  return out;
});

fs.writeFileSync(path.join(OUT, 'r24-wumen-probe.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.rays, null, 2));
await browser.close();
