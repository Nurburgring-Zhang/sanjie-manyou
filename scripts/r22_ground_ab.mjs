/**
 * R22 画面根因 A/B：23 号坊间机位那片「褐色大格网」到底是哪种合批几何？
 * 列出场景 mesh 名前缀分组 + 世界包围盒 y，再分别隐藏「地面组 / 草木组」各拍一张，
 * 用于判断公园层草坪是否被更高的石板铺装盖住。
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4173/ node scripts/r22_ground_ab.mjs
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
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2200));

await page.evaluate(() => {
  const e = window.__qingming.engine;
  e.stopCinema();
  const c = [360, 22, 250], t = [320, 2, 180];
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(t[0], t[1], t[2]);
  const dx = t[0] - c[0], dy = t[1] - c[1], dz = t[2] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
});
await new Promise((r) => setTimeout(r, 1400));
await page.screenshot({ path: path.join(OUT, 'r22-ab-A-normal.png') });

const census = await page.evaluate(() => {
  const { engine, THREE } = window.__qingming;
  const groups = {};
  engine.scene.traverse((o) => {
    if (!o.isMesh) return;
    const base = (o.name || '(unnamed)').replace(/_\d+$/, '');
    const g = groups[base] || (groups[base] = { count: 0, visible: 0, yMin: Infinity, yMax: -Infinity });
    g.count++;
    if (o.visible) g.visible++;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (bb) {
      const wy = o.position.y;
      g.yMin = Math.min(g.yMin, bb.min.y + wy);
      g.yMax = Math.max(g.yMax, bb.max.y + wy);
    }
  });
  return Object.entries(groups)
    .map(([name, g]) => ({ name, ...g, yMin: +g.yMin.toFixed(2), yMax: +g.yMax.toFixed(2) }))
    .sort((a, b) => b.count - a.count);
});
console.log('=== mesh 分组（前 30）===');
for (const g of census.slice(0, 30)) console.log(`${g.name.padEnd(28)} n=${String(g.count).padStart(4)} vis=${String(g.visible).padStart(4)} y=${g.yMin}…${g.yMax}`);

// B：隐藏所有「地面/铺装」类合批网格
const hideGround = await page.evaluate(() => {
  let n = 0;
  window.__qingming.engine.scene.traverse((o) => {
    if (o.isMesh && /ground|earth|pave|tile|stone|ash/i.test(o.name || '') && o.visible) { o.visible = false; n++; }
  });
  return n;
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(OUT, 'r22-ab-B-noground.png') });

// C：恢复地面，改隐藏所有「草木/草坪」类合批网格
const hideLeaf = await page.evaluate(() => {
  let n = 0;
  window.__qingming.engine.scene.traverse((o) => {
    if (o.isMesh) {
      if (/ground|earth|pave|tile|stone|ash/i.test(o.name || '')) { o.visible = true; }
      else if (/leaf|lawn|grass|trunk|flower|bamboo/i.test(o.name || '') && o.visible) { o.visible = false; n++; }
    }
  });
  return n;
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(OUT, 'r22-ab-C-noleaf.png') });

fs.writeFileSync(path.join(OUT, 'r22-ground-ab.json'), JSON.stringify({ census, hideGround, hideLeaf }, null, 2));
console.log('\nhideGround', hideGround, 'hideLeaf', hideLeaf);
await browser.close();
