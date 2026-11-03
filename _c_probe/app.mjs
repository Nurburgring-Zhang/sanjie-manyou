import puppeteer from 'puppeteer-core';
import { CHROME } from '../scripts/chromePath.mjs';

const PORT = process.env.PORT || '4299';
const OUT = process.env.OUT_DIR || 'screenshots';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE_ERR', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('PAGE_EXC', String(e).slice(0, 600)));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 600000 });
console.log('READY_MS=' + (Date.now() - t0));

const info = await page.evaluate(() => {
  const q = window.__qingming;
  const r = q.engine.renderer.info.render;
  return {
    calls: r.calls, tris: r.triangles,
    gallery: window.__heavenGalleryStats ?? null,
  };
});
console.log('INFO=' + JSON.stringify(info));

const shots = [
  { name: 'app-heaven-arc', p: [0, 980, 2400], l: [0, 240, 1320] },
  { name: 'app-heaven-fall', p: [478, 430, 1787], l: [414, 250, 1545] },
  { name: 'app-heaven-gallery-inside', p: [1452, 214, 120], l: [1360, 213, 320] },
];
for (const s of shots) {
  await page.evaluate((v) => {
    const { engine } = window.__qingming;
    engine.camera.position.set(v.p[0], v.p[1], v.p[2]);
    engine.lookTarget.set(v.l[0], v.l[1], v.l[2]);
    engine.yaw = Math.atan2(-(engine.lookTarget.x - engine.camera.position.x), -(engine.lookTarget.z - engine.camera.position.z));
    engine.pitch = Math.asin(Math.max(-1, Math.min(1, (engine.lookTarget.y - engine.camera.position.y) / Math.max(1e-3, engine.camera.position.distanceTo(engine.lookTarget)))));
    engine.setCamMode('fly');
    engine.stopCinema();
  }, s);
  await new Promise((r) => setTimeout(r, 1800));
  const file = `${OUT}/${s.name}.png`;
  await page.screenshot({ path: file });
  console.log('SHOT=' + file);
}
await browser.close();
