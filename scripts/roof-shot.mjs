/** 单张取证照：node scripts/roof-shot.mjs name camx camy camz tx ty tz [fov] [url] */
import puppeteer from 'puppeteer-core';

const [NAME, CX, CY, CZ, TX, TY, TZ, FOV = 45, URLX = 'http://127.0.0.1:4263/'] = process.argv.slice(2);
const UA = process.env.CHROME_BIN || `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1155\\chrome-win\\chrome.exe`;
const browser = await puppeteer.launch({
  executablePath: UA, headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URLX, { waitUntil: 'domcontentloaded', timeout: 180000 });
let ok = false;
for (let i = 0; i < 900; i++) {
  try { ok = await page.evaluate(() => !!(window.__qingming && window.__qingming.scene && !document.getElementById('loading'))); } catch { ok = false; }
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!ok) throw new Error('not ready');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(([cx, cy, cz, tx, ty, tz, fov]) => {
  const e = window.__qingming.engine;
  const w = window.__qingming.world;
  if (w) w.scrolling = false;
  if (e.camMode === 'cinema') e.stopCinema('fly');
  e.camera.position.set(cx, cy, cz);
  e.camera.fov = fov; e.camera.updateProjectionMatrix();
  e.lookTarget.set(tx, ty, tz);
  const dx = tx - cx, dy = ty - cy, dz = tz - cz;
  const L = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / L);
  e.camera.updateMatrixWorld(true); e.scene.updateMatrixWorld(true);
  const css = document.createElement('style');
  css.textContent = '#hud,.hud,#topbar,#bottombar,#minimap,#poi-guide,.guide,#loading{display:none!important}';
  document.head.appendChild(css);
}, [+CX, +CY, +CZ, +TX, +TY, +TZ, +FOV]);
await new Promise((r) => setTimeout(r, 900));
for (let i = 0; i < 3; i++) {
  try { await page.screenshot({ path: `screenshots/roof/${NAME}.png`, timeout: 60000 }); console.log('shot', NAME); break; }
  catch (e) { console.log('retry', String(e).slice(0, 60)); await new Promise((r) => setTimeout(r, 1200)); }
}
await browser.close();
