import puppeteer from 'puppeteer-core';
import { CHROME } from '../scripts/chromePath.mjs';

const URL = 'http://127.0.0.1:4291/gallery-probe.html';
const OUT = process.env.OUT_DIR || 'screenshots';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE_ERR', m.text()); });
page.on('pageerror', (e) => console.log('PAGE_EXC', String(e).slice(0, 800)));

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__galleryReady === true || !!window.__galleryError, { timeout: 180000 });
const err = await page.evaluate(() => window.__galleryError || null);
if (err) {
  console.log('BOOT_ERROR=' + err);
  await browser.close();
  process.exit(2);
}
const loadMs = Date.now() - t0;
const stats = await page.evaluate(() => ({ ...window.__gallery.stats }));
console.log('LOAD_MS=' + loadMs);
console.log('STATS=' + JSON.stringify(stats));

for (const view of ['inside', 'outside', 'top']) {
  await page.evaluate((v) => window.__gallery.setView(v), view);
  await new Promise((r) => setTimeout(r, 450));
  const file = `${OUT}/gallery-${view}.png`;
  await page.screenshot({ path: file });
  console.log('SHOT=' + file);
}

const draw = await page.evaluate(() => window.__gallery.draw());
console.log('DRAW=' + JSON.stringify(draw));
await browser.close();
