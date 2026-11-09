/**
 * R22 精确 A/B：只隐藏 city_ground 合批网格，确认褐色格网就是它；
 * 并输出 city_ground / city_earth / city_leaf 的世界包围盒，给出铺装板覆盖范围。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
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
  e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / d);
});
await new Promise((r) => setTimeout(r, 1400));

const boxes = await page.evaluate(() => {
  const { engine, THREE } = window.__qingming;
  const out = [];
  engine.scene.traverse((o) => {
    if (!o.isMesh || !/^city_(ground|earth|leaf|ash)/i.test(o.name || '')) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const r = (v) => Math.round(v);
    out.push({ name: o.name, visible: o.visible,
      x: [r(bb.min.x), r(bb.max.x)], y: [+bb.min.y.toFixed(2), +bb.max.y.toFixed(2)], z: [r(bb.min.z), r(bb.max.z)],
      verts: o.geometry.attributes.position?.count ?? 0 });
  });
  return out;
});
console.log('=== 合批网格包围盒 ===');
for (const b of boxes) console.log(`${b.name.padEnd(24)} x=${JSON.stringify(b.x).padEnd(18)} y=${JSON.stringify(b.y).padEnd(16)} z=${JSON.stringify(b.z).padEnd(18)} v=${b.verts}`);

const hidden = await page.evaluate(() => {
  let n = 0;
  window.__qingming.engine.scene.traverse((o) => {
    if (o.isMesh && /^city_ground/i.test(o.name || '') && o.visible) { o.visible = false; n++; }
  });
  return n;
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'artifacts/r22-ab-D-nocityground.png' });
console.log('\nhidden city_ground meshes =', hidden);
fs.writeFileSync('artifacts/r22-pave-probe.json', JSON.stringify({ boxes, hidden }, null, 2));
await browser.close();
