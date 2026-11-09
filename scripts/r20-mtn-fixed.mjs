/**
 * R20 山体「修后」同机位取证：连 vite dev（直接编译修复后的 src/world/terrain.ts），
 * 用与 _r20_acceptance.mjs 第 13 格完全相同的机位出图，并读修后顶点色直方图做量化对比。
 * 不碰 dist/、不跑 build。用法：PREVIEW_URL=http://127.0.0.1:5173/ node scripts/r20-mtn-fixed.mjs
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:5173/';
const OUT = 'artifacts';
const P = [10500, 700, -3900]; // 相机位置
const C = [14000, 850, -6000]; // lookTarget
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 220)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CON:' + m.text().slice(0, 220)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 2600));
await page.evaluate(() => { try { window.__qingming.world.teleport('countryside'); } catch (e) { /* ignore */ } });
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(([p, c]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
  e.camera.position.set(p[0], p[1], p[2]);
  const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
  e.lookTarget.set(c[0], c[1], c[2]);
}, [P, C]);
await new Promise((r) => setTimeout(r, 1600));
const file = `${OUT}/r20-mtn-diag-06-fixed.png`;
await page.screenshot({ path: file });

const after = await page.evaluate(() => {
  const q = window.__qingming;
  const T = q.scene.getObjectByName('terrain');
  const mat = T.material, col = T.geometry.attributes.color, pos = T.geometry.attributes.position;
  const arr = col.array, n = col.count;
  const mk = () => ({ n: 0, sr: 0, sg: 0, sb: 0, min: [9, 9, 9], max: [-9, -9, -9], hist: new Array(16).fill(0), green: 0, grey: 0, dark: 0, rock: 0 });
  const ALL = mk(), ROI = mk();
  const put = (a, r, g, b) => {
    a.n++; a.sr += r; a.sg += g; a.sb += b;
    a.min[0] = Math.min(a.min[0], r); a.min[1] = Math.min(a.min[1], g); a.min[2] = Math.min(a.min[2], b);
    a.max[0] = Math.max(a.max[0], r); a.max[1] = Math.max(a.max[1], g); a.max[2] = Math.max(a.max[2], b);
    const L = (r + g + b) / 3;
    a.hist[Math.max(0, Math.min(15, Math.floor(L * 16)))]++;
    if (g > r * 1.15 && g > b * 1.15) a.green++;
    if (Math.abs(r - g) < 0.07 && Math.abs(g - b) < 0.10) a.grey++;
    if (L < 0.18) a.dark++;
    if (r >= g * 0.92 && b <= g * 0.95 && L > 0.18) a.rock++;
  };
  for (let i = 0; i < n; i++) {
    const r = arr[i * 3], g = arr[i * 3 + 1], b = arr[i * 3 + 2];
    put(ALL, r, g, b);
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    if (y > 45 && Math.hypot(x - 14000, z + 6000) < 3600) put(ROI, r, g, b);
  }
  const fin = (a) => ({
    n: a.n, mean: [+(a.sr / a.n).toFixed(4), +(a.sg / a.n).toFixed(4), +(a.sb / a.n).toFixed(4)],
    min: a.min.map((v) => +v.toFixed(4)), max: a.max.map((v) => +v.toFixed(4)), histL16: a.hist,
    greenPct: +(100 * a.green / a.n).toFixed(2), greyPct: +(100 * a.grey / a.n).toFixed(2),
    darkPct: +(100 * a.dark / a.n).toFixed(2), rockPct: +(100 * a.rock / a.n).toFixed(2),
  });
  return {
    url: location.href, bundle: [...document.querySelectorAll('script[type="module"]')].map((s) => s.src.split('/').pop()),
    material: { type: mat.type, vertexColors: mat.vertexColors, fog: mat.fog,
      cacheKey: typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey() : null },
    colorAll: fin(ALL), colorRoi: fin(ROI),
  };
});

const jf = `${OUT}/r20-mtn-diag.json`;
const j = JSON.parse(fs.readFileSync(jf, 'utf-8'));
j.after = { ...after, file, cameraPos: P, lookTarget: C, errors: errs,
  note: 'vite dev 直接编译修复后的 src/；4173 生产 dist 未改动，等 team-lead 统一 build 复拍' };
fs.writeFileSync(jf, JSON.stringify(j, null, 2));
console.log('AFTER_URL:', after.url, 'BUNDLE:', JSON.stringify(after.bundle));
console.log('AFTER_ROI:', JSON.stringify(after.colorRoi));
console.log('BEFORE_ROI:', JSON.stringify(j.colorRoi));
console.log('ERRORS:', errs.length ? errs.slice(0, 6).join(' | ') : 'NONE');
console.log('WROTE:', file);
await browser.close();
