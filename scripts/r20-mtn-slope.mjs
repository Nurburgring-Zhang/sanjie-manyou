/** 从渲染网格实测山体坡度分布（判断 slopeRock 阈值实际覆盖率），结果并入 r20-mtn-diag.json */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 2000));
const stats = await page.evaluate(() => {
  const T = window.__qingming.scene.getObjectByName('terrain');
  const pos = T.geometry.attributes.position;
  const N = 601, STEP = 62000 / 600;
  const Y = (i) => pos.getY(i);
  const hist = new Array(12).fill(0), srHist = new Array(10).fill(0);
  let n = 0, slow = 0, mid = 0, steep = 0, sum = 0, srSum = 0;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let iy = 1; iy < N - 1; iy++) {
    for (let ix = 1; ix < N - 1; ix++) {
      const i = iy * N + ix;
      const x = pos.getX(i), z = pos.getZ(i), y = Y(i);
      if (!(y > 45 && Math.hypot(x - 14000, z + 6000) < 3600)) continue;
      const gx = (Y(i + 1) - Y(i - 1)) / (2 * STEP);
      const gz = (Y(i + N) - Y(i - N)) / (2 * STEP);
      const s = Math.hypot(gx, gz);
      const sr = ss(0.45, 1.10, s);
      n++; sum += s; srSum += sr;
      hist[Math.min(11, Math.floor(s * 4))]++;
      srHist[Math.min(9, Math.floor(sr * 10))]++;
      if (s < 0.45) slow++; else if (s > 1.10) steep++; else mid++;
    }
  }
  return {
    roiCount: n, meanSlope: +(sum / n).toFixed(3), meanSlopeRock: +(srSum / n).toFixed(3),
    slowLt0_45Pct: +(100 * slow / n).toFixed(2), midPct: +(100 * mid / n).toFixed(2), steepGt1_10Pct: +(100 * steep / n).toFixed(2),
    histSlope_0_25step: hist, histSlopeRock_0_1step: srHist,
    note: 'slopeRock 未含 rockBias 扰动；按渲染网格 103m/格中心差分实测',
  };
});
const jf = 'artifacts/r20-mtn-diag.json';
const j = JSON.parse(fs.readFileSync(jf, 'utf-8'));
j.slope = stats;
fs.writeFileSync(jf, JSON.stringify(j, null, 2));
console.log('SLOPE:', JSON.stringify(stats));
await browser.close();
