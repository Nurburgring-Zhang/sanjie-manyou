/**
 * R22 层级探针：在 23 号坊间裸地区域 (x 240–400, z 120–240) 统计各合批组顶点的 y 分布，
 * 用来确定「公园草坪」与「城内地坪铺装」谁盖住谁，以及要抬到多高。
 * 用法：PREVIEW_URL=http://127.0.0.1:4173/ node scripts/r22_yprobe.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2000));

const data = await page.evaluate(() => {
  const { engine } = window.__qingming;
  const X0 = 240, X1 = 400, Z0 = 120, Z1 = 240;
  const out = {};
  engine.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const base = (o.name || '(unnamed)').replace(/_\d+$/, '');
    if (!/city_(earth|ash|leaf|ground|wood|roof|fabric)/i.test(base)) return;
    const pos = o.geometry.attributes.position;
    const m = o.matrixWorld.elements;
    const ys = [];
    const step = Math.max(1, Math.floor(pos.count / 400000));
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i) * m[0] + pos.getY(i) * m[4] + pos.getZ(i) * m[8] + m[12];
      const y = pos.getX(i) * m[1] + pos.getY(i) * m[5] + pos.getZ(i) * m[9] + m[13];
      const z = pos.getX(i) * m[2] + pos.getY(i) * m[6] + pos.getZ(i) * m[10] + m[14];
      if (x < X0 || x > X1 || z < Z0 || z > Z1 || y < -1 || y > 3) continue;
      ys.push(y);
    }
    if (!ys.length) return;
    ys.sort((a, b) => a - b);
    const q = (p) => +ys[Math.floor(p * (ys.length - 1))].toFixed(3);
    const g = out[base] || (out[base] = { samples: 0, hist: {} });
    g.samples += ys.length;
    for (const y of ys) {
      const k = (Math.round(y * 20) / 20).toFixed(2);
      g.hist[k] = (g.hist[k] || 0) + 1;
    }
    g.quantiles = { p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), max: +ys[ys.length - 1].toFixed(3) };
  });
  // 每个组只保留最常见的 y 层
  for (const k of Object.keys(out)) {
    out[k].topLayers = Object.entries(out[k].hist).sort((a, b) => b[1] - a[1]).slice(0, 10);
    delete out[k].hist;
  }
  return out;
});
console.log(JSON.stringify(data, null, 2));
fs.writeFileSync('artifacts/r22-yprobe.json', JSON.stringify(data, null, 2));
await browser.close();
