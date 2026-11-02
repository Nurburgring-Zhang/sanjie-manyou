/**
 * 单机位取证（带重试）：PROBE_URL=http://127.0.0.1:4289/ node scripts/roof-gable-one.mjs <outId> x y z tx ty tz
 * 页面偶发首帧 WebGL 初始化失败（headless + 别人正在改 src），重试 3 次并打印 window.__errs。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4289/';
const OUT = path.join('screenshots', 'roof-gable', process.env.TAG || 'single');
const [id, ...nums] = process.argv.slice(2);
const [cx, cy, cz, tx, ty, tz] = nums.map(Number);
if (!id || nums.length !== 6) {
  console.error('usage: node scripts/roof-gable-one.mjs <id> x y z tx ty tz');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

for (let attempt = 1; attempt <= 3; attempt++) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
    await page.evaluate(() => { const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none'; });
    await new Promise((r) => setTimeout(r, 2200));
    const yaw = Math.atan2(-(tx - cx), -(tz - cz));
    const pitch = Math.asin(Math.max(-1, Math.min(1, (ty - cy) / Math.hypot(tx - cx, ty - cy, tz - cz))));
    await page.evaluate(({ cx, cy, cz, yaw, pitch }) => {
      const e = window.__qingming.engine;
      if (e.cinemaActive) e.stopCinema('fly');
      e.camMode = 'fly';
      e.avatarCtl = null;
      e.camera.position.set(cx, cy, cz);
      e.yaw = yaw; e.pitch = pitch;
      e.lookTarget.set(cx - Math.sin(yaw) * Math.cos(pitch) * 40, cy + Math.sin(pitch) * 40, cz - Math.cos(yaw) * Math.cos(pitch) * 40);
    }, { cx, cy, cz, yaw, pitch });
    await new Promise((r) => setTimeout(r, 900));
    const p = path.join(OUT, `${id}.png`);
    await page.screenshot({ path: p });
    console.log(`shot ${id} -> ${p} (attempt ${attempt})`);
    await browser.close();
    process.exit(0);
  } catch (err) {
    const errs = await (async () => {
      try { const pages = await browser.pages(); return await pages[0].evaluate(() => window.__errs ?? []); } catch { return ['(no page)']; }
    })();
    console.error(`attempt ${attempt} failed: ${String(err).slice(0, 200)}`);
    console.error(`page errors: ${JSON.stringify(errs).slice(0, 600)}`);
    await browser.close();
    if (attempt === 3) process.exit(1);
  }
}
