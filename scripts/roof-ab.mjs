/** 三界前后对照：node scripts/roof-ab.mjs <tag> [old|new]   —— 一次会话拍 3 个机位
 *  机位：人间河岸铺面 / 天宫南天门街区 / 地府丰都鬼市
 */
import puppeteer from 'puppeteer-core';

const TAG = process.argv[2] || 'ab';
const MODE = process.argv[3] === 'old' ? 'old' : 'new';
const URLX = 'http://127.0.0.1:4263/' + (MODE === 'old' ? '?roofOld=1' : '');
const UA = '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const SHOTS = [
  // 人间：河右岸那排商业铺面（用户截图位置）
  { name: 'renjian', cam: [112, 17, 64], look: [96, 7, 46], fov: 45 },
  // 天宫：南天门 / 城内街屋
  { name: 'tiangong', cam: [26, 222, -54], look: [0, 210, -85], fov: 55 },
  // 地府：丰都鬼市
  { name: 'difu', cam: [541, -247, 131], look: [534, -252, 124], fov: 40 },
];

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
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = '#hud,.hud,#topbar,#bottombar,#minimap,#poi-guide,.guide,#loading{display:none!important}';
  document.head.appendChild(css);
});

for (const s of SHOTS) {
  let applied = false;
  for (let attempt = 0; attempt < 4 && !applied; attempt++) {
    try {
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
      }, s.cam.concat(s.look, [s.fov]));
      applied = true;
    } catch (e) {
      console.log('cam retry', String(e).slice(0, 50));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!applied) { console.log('cam FAILED', s.name); continue; }
  await new Promise((r) => setTimeout(r, 900));
  const file = `screenshots/roof/${TAG}-${s.name}-${MODE}.png`;
  for (let i = 0; i < 4; i++) {
    try { await page.screenshot({ path: file, timeout: 60000 }); console.log('shot', file); break; }
    catch (e) { console.log('retry', String(e).slice(0, 50)); await new Promise((r) => setTimeout(r, 1500)); }
  }
}
await browser.close();
