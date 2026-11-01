/**
 * 视觉巡检第 3 轮探针：定点/传送截图 + kit 台账 + 简单像素统计。
 *
 * 用法：
 *   node scripts/probe-lane3.mjs shot <out.png> cam <x> <y> <z> <tx> <ty> <tz> [hide=regex]
 *   node scripts/probe-lane3.mjs shot <out.png> tp <poiKey> [hide=regex]
 *   node scripts/probe-lane3.mjs audit <out.json> [hide=regex]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://127.0.0.1:4247/';
const [mode, out, how, ...rest] = process.argv.slice(2);
const hideArg = rest.find((a) => a.startsWith('hide='));
const hideRe = hideArg ? new RegExp(hideArg.slice(5)) : null;
const nums = rest.filter((a) => !a.startsWith('hide=')).map(Number);

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text().slice(0, 300)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming && !!window.__qingming.engine, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1200));

const info = await page.evaluate(([mode, how, nums, hideSrc]) => {
  const Q = window.__qingming;
  const e = Q.engine;
  const re = hideSrc ? new RegExp(hideSrc) : null;
  let hidden = 0, shown = 0;
  if (re) {
    e.scene.traverse((o) => {
      if (!o.isMesh || !o.name || !re.test(o.name)) return;
      o.visible = false;
      hidden++;
    });
  }
  if (how === 'cam') {
    e.stopCinema();
    const [px, py, pz, tx, ty, tz] = nums;
    e.camera.position.set(px, py, pz);
    e.lookTarget.set(tx, ty, tz);
    const dx = tx - px, dy = ty - py, dz = tz - pz;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
  } else if (how === 'tp') {
    const ok = Q.world.teleport(String(nums[0]));
    if (!ok) return { error: 'teleport failed', key: nums[0] };
  } else {
    e.stopCinema();
  }
  const cam = e.camera.position;
  return { cam: [+cam.x.toFixed(1), +cam.y.toFixed(1), +cam.z.toFixed(1)], hidden };
}, [mode, how, how === 'tp' ? [rest.find((a) => !a.startsWith('hide='))] : nums, hideRe ? hideRe.source : null]);

await new Promise((r) => setTimeout(r, 1800));
if (mode === 'audit') {
  const audit = await page.evaluate(() => {
    const w = window.__qingming.world;
    return { detail: w.assetAudit?.detail ?? null, detailBounds: w.assetAudit?.detailBounds ?? null, groups: w.assetAudit?.groups ?? null };
  });
  fs.writeFileSync(out, JSON.stringify({ info, audit }, null, 1));
  console.log('audit', out, JSON.stringify(info));
} else {
  const buf = await page.screenshot({ path: out });
  // 粗粒度亮度统计：中位/均值/p95，以及近白像素占比
  const stats = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const cv = window.__qingming.engine.renderer.domElement;
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    g.drawImage(cv, 0, 0, 320, 180);
    const d = g.getImageData(0, 0, 320, 180).data;
    const lum = [];
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      lum.push(l);
      if (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244) white++;
    }
    lum.sort((a, b) => a - b);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    return {
      mean: +mean.toFixed(1),
      median: +lum[Math.floor(lum.length / 2)].toFixed(1),
      p95: +lum[Math.floor(lum.length * 0.95)].toFixed(1),
      whitePct: +((white / lum.length) * 100).toFixed(1),
    };
  });
  console.log('shot', out, JSON.stringify(info), JSON.stringify(stats), 'bytes', buf.length);
}
await browser.close();
