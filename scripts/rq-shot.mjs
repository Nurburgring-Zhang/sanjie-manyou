/** 批量定点取证：node scripts/rq-shot.mjs <shots.json> [port]
 *  shots.json: [{ name, pos:[x,y,z], target:[x,y,z], fov?, roofOnly? }]
 *  roofOnly=true 时隐藏除 roof 组以外的所有组，用来看「只有屋面」的形体。
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const SHOTS = process.argv[2];
const PORT = process.argv[3] ?? '4265';
const LIST = JSON.parse(fs.readFileSync(SHOTS, 'utf8'));
const OUT = 'screenshots/rq';
fs.mkdirSync(OUT, { recursive: true });

const EXE = '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: EXE, headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
// 冻结 HMR：别的 agent 一存盘 vite 就 reload，整城重载要 2–3 分钟，取证会被无限打断。
// 本项目 src 不用 WebSocket，禁掉 vite-hmr 连接不影响运行时。
await page.evaluateOnNewDocument(() => {
  const Orig = window.WebSocket;
  // @ts-ignore
  window.WebSocket = function (url, protocols) {
    if (String(url).includes('vite') || String(url).includes('/?')) {
      throw new Error('hmr disabled for audit');
    }
    return new Orig(url, protocols);
  };
  window.WebSocket.prototype = Orig.prototype;
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
let ok = false;
for (let i = 0; i < 900; i++) {
  try { ok = await page.evaluate(() => !!(window.__qingming && window.__qingming.scene && !document.getElementById('loading'))); } catch { ok = false; }
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!ok) throw new Error('not ready');
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = '#ui,#hud,.hud,#topbar,#bottombar,#minimap,#poi-guide,.guide,#loading{display:none!important}';
  document.head.appendChild(css);
});

async function ensureReady() {
  for (let i = 0; i < 240; i++) {
    try {
      const ok2 = await page.evaluate(() => !!(window.__qingming && window.__qingming.engine && window.__qingming.scene && !document.getElementById('loading')));
      if (ok2) return true;
    } catch { /* nav in flight */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

for (const s of LIST) {
  let alive = await ensureReady();
  if (!alive) { console.log('SKIP', s.name, 'page not ready'); continue; }
  let info;
  try {
    info = await page.evaluate((sh) => {
    if (!document.getElementById('rq-hide')) {
      const css = document.createElement('style');
      css.id = 'rq-hide';
      css.textContent = '#ui,#hud,.hud,#topbar,#bottombar,#minimap,#poi-guide,.guide,#loading{display:none!important}';
      document.head.appendChild(css);
    }
    const e = window.__qingming.engine;
    const w = window.__qingming.world;
    if (e.time) { e.time.paused = true; e.time.jump('dusk'); }
    if (w) w.scrolling = false;
    if (e.camMode === 'cinema') e.stopCinema('fly');
    const [cx, cy, cz] = sh.pos, [tx, ty, tz] = sh.target;
    e.camera.position.set(cx, cy, cz);
    e.camera.fov = sh.fov ?? 45; e.camera.updateProjectionMatrix();
    e.lookTarget.set(tx, ty, tz);
    const dx = tx - cx, dy = ty - cy, dz = tz - cz;
    const L = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / L);
    e.camera.updateMatrixWorld(true); e.scene.updateMatrixWorld(true);
    const scene = window.__qingming.scene;
    const cs = scene.getObjectByName('cloudSeaGroup');
    if (cs) cs.visible = !sh.hideClouds;
    scene.traverse((o) => {
      const n = o.name || '';
      if (!n.startsWith('city_')) return;
      if (sh.roofOnly) o.visible = /^city_roof/.test(n);
      else o.visible = true;
    });
    return { mode: e.camMode, roofOnly: !!sh.roofOnly };
  }, s);
  } catch (err) {
    console.log('RETRY after nav', s.name, String(err).slice(0, 80));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    alive = await ensureReady();
    if (!alive) { console.log('SKIP', s.name, 'reload failed'); continue; }
    info = await page.evaluate((sh) => {
      if (!document.getElementById('rq-hide')) {
        const css = document.createElement('style');
        css.id = 'rq-hide';
        css.textContent = '#ui,#hud,.hud,#topbar,#bottombar,#minimap,#poi-guide,.guide,#loading{display:none!important}';
        document.head.appendChild(css);
      }
      const e = window.__qingming.engine;
      const w = window.__qingming.world;
      if (w) w.scrolling = false;
      if (e.camMode === 'cinema') e.stopCinema('fly');
      const [cx, cy, cz] = sh.pos, [tx, ty, tz] = sh.target;
      e.camera.position.set(cx, cy, cz);
      e.camera.fov = sh.fov ?? 45; e.camera.updateProjectionMatrix();
      e.lookTarget.set(tx, ty, tz);
      const dx = tx - cx, dy = ty - cy, dz = tz - cz;
      const L = Math.max(1, Math.hypot(dx, dy, dz));
      e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / L);
      e.camera.updateMatrixWorld(true); e.scene.updateMatrixWorld(true);
      return { retried: true };
    }, s);
  }
  await new Promise((r) => setTimeout(r, 700));
  const file = `${OUT}/${s.name}.png`;
  for (let i = 0; i < 3; i++) {
    try { await page.screenshot({ path: file, timeout: 60000 }); break; }
    catch (e) { await new Promise((r) => setTimeout(r, 1200)); }
  }
  console.log('shot', s.name, JSON.stringify(info), '->', file);
}

// 恢复可见
await page.evaluate(() => {
  window.__qingming.scene.traverse((o) => { if ((o.name || '').startsWith('city_')) o.visible = true; });
});
await browser.close();
