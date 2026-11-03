import puppeteer from 'puppeteer-core';
import { CHROME } from '../scripts/chromePath.mjs';

const PORT = process.env.PORT || '4299';
const VIEWS = (process.env.VIEWS || 'fall,fallWide,dragon,dragonWide,bells,bellsLow,gallery,galleryAir,corridor').split(',');
const OUT = process.env.OUT_DIR || 'screenshots';
const PREFIX = process.env.PREFIX || 'c';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE_ERR', m.text()); });
page.on('pageerror', (e) => console.log('PAGE_EXC', String(e).slice(0, 1200)));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/_c_probe/index.html${process.env.MODE ? `?m=${process.env.MODE}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__cReady === true || !!window.__cError, { timeout: 300000 });
const err = await page.evaluate(() => window.__cError || null);
if (err) {
  console.log('BOOT_ERROR=' + err);
  await browser.close();
  process.exit(2);
}
console.log('LOAD_MS=' + (Date.now() - t0));
const stats = await page.evaluate(() => window.__c.stats);
console.log('STATS=' + JSON.stringify(stats));
console.log('HUD=' + (await page.evaluate(() => document.getElementById('hud').textContent)));

for (const view of VIEWS) {
  await page.evaluate((v) => window.__c.setView(v), view);
  await new Promise((r) => setTimeout(r, 500));
  const file = `${OUT}/${PREFIX}-${view}.png`;
  await page.screenshot({ path: file });
  console.log('SHOT=' + file);
}

console.log('DRAW=' + JSON.stringify(await page.evaluate(() => window.__c.draw())));
await browser.close();
