/**
 * R21 A/B 对比图合成：修前(4173 生产包) / 修后(5176 最新源码) 同机位并排。
 * 用 base64 data URI 内联两张 PNG，puppeteer+Edge 截图输出 r21-mtn-band-fixed.png。
 * 单 browser / 单 page / finally 显式 close。只读 artifacts，不改任何源码或 dist。
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BEFORE = 'artifacts/_r21_before.png';
const AFTER = 'artifacts/_r21_after.png';
const OUT = 'artifacts/r21-mtn-band-fixed.png';
const b64 = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#10131a;font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#e8e2d4}
  .wrap{display:flex;width:1600px}
  .cell{width:800px}
  .bar{height:54px;display:flex;align-items:center;justify-content:center;font-size:19px;
       letter-spacing:1px;border-bottom:2px solid #2a2f38;font-weight:600}
  .before .bar{background:#3a2a22;color:#f0bd91}
  .after  .bar{background:#1d3326;color:#a6e6af}
  img{width:800px;height:450px;display:block;object-fit:cover}
  .foot{width:1600px;padding:12px 20px;font-size:15px;line-height:1.7;color:#c8c2b4;
        border-top:2px solid #2a2f38;background:#161b24}
  .foot b{color:#ffd98a}
  .k{color:#9fe0a8;font-weight:600}
</style></head><body>
  <div class="wrap">
    <div class="cell before">
      <div class="bar">修前 · 4173 生产包 index-CxExxbix.js</div>
      <img src="${b64(BEFORE)}">
    </div>
    <div class="cell after">
      <div class="bar">修后 · 5176 最新源码（R21b）</div>
      <img src="${b64(AFTER)}">
    </div>
  </div>
  <div class="foot">
    <b>同机位</b> P=[10500,700,-3900] → C=[14000,850,-6000]　
    修前：整山均匀米白、无植被带 / 无层理明暗带，左右各一根巨大朱红孤柱 + 悬空方基座。
    修后：<span class="k">5 带亮度 0.0992→0.2021→0.2945→0.3849→0.5358</span>（7/10 对差 ≥0.12）、
    层理直方图<span class="k">双峰 peaks[1,7,9]</span>；孤柱消除、台基封顶 0.42S 成贴地矮宽台。
  </div>
</body></html>`;

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 120000, timeout: 120000,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 600, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), { timeout: 60000 });
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewport({ width: 1600, height: h, deviceScaleFactor: 1 });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('WROTE', OUT, 'height', h);
} finally {
  if (browser) await browser.close();
  console.log('BROWSER_CLOSED: YES');
}
