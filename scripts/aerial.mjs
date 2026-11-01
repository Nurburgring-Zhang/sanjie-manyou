/**
 * 全城俯瞰：用于整体结构验证（哪里是空的、哪里重复、哪里有洞）。
 * 用法：node scripts/aerial.mjs [height] [x] [z] ...
 * 默认拍四张：河岸近景 / 内城 / 全城 / 宫城。输出 screenshots/aerial/。
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = 'screenshots/aerial';
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ['bank', 0, 260, 120, [0, 8, -600]],
  ['core', 0, -700, 150, [0, 8, -2600]],
  ['city', 2600, -1800, 5200, [0, 0, -1200]],
  ['palace', 0, -2500, 110, [0, 14, -3800]],
  // 玩家平视：这才是"城市长什么样"的真正判据
  ['eye_bridge', 2, 46, 7.0, [0, 4, -12]],
  ['eye_street', -80, 52, 2.6, [380, 5, 52]],
  ['eye_gate', 418, 52, 2.6, [478, 13, 74]],
];

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE:' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CON:' + m.text().slice(0, 200)); });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));

for (const [name, x, z, alt, look] of SHOTS) {
  await page.evaluate(([cx, cz, a, lx, ly, lz]) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(cx, a, cz);
    e.lookTarget.set(lx, ly, lz);
    const dx = lx - cx, dy = ly - a, dz = lz - cz;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.setCamMode('fly');
  }, [x, z, alt, look[0], look[1], look[2]]);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const st = await page.evaluate(() => {
    const info = window.__qingming.engine.renderer.info.render;
    return { tris: info.triangles, calls: info.calls };
  });
  console.log('aerial', name, JSON.stringify(st));
}
console.log('ERRORS', errors.length ? errors.slice(0, 5) : 'NONE');
await browser.close();
