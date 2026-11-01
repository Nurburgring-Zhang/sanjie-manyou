/**
 * 三视角验证：对每个 POI 机位，围绕主体拍 正面 / 侧向 / 俯视 三张。
 * 用法：node scripts/three-view.mjs [poi...]
 * 输出：screenshots/three-view/<poi>-<front|side|top>.png
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const KEYS = process.argv.slice(2);
const DEFAULT_KEYS = [
  'gate', 'bridge', 'sunyang', 'shiqian', 'yamen', 'pagoda', 'washi', 'wharf',
  'zichen', 'lingxiao', 'yaochi', 'jiangtai', 'star9',
  'yanluo', 'sansheng', 'wangxiang', 'mengpo', 'fengdu', 'naihe', 'shibayu',
  'desert', 'countryside',
];
const keys = KEYS.length ? KEYS : DEFAULT_KEYS;
const OUT = 'screenshots/three-view';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE:' + String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CON:' + m.text().slice(0, 160)); });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1800));

const rows = [];
for (const key of keys) {
  const ok = await page.evaluate((k) => window.__qingming.world.teleport(k), key).catch(() => false);
  await new Promise((r) => setTimeout(r, 1200));
  const geo = await page.evaluate(() => {
    const e = window.__qingming.engine;
    const c = e.camera.position, t = e.lookTarget;
    const dx = t.x - c.x, dz = t.z - c.z;
    return {
      poi: [t.x, t.y - 2.5, t.z],
      dist: Math.max(12, Math.hypot(dx, c.y - t.y, dz)),
      az: Math.atan2(dz, dx),
    };
  });
  const [px, py, pz] = geo.poi;
  // 取景半径按主体尺度分档（之前统一 R=30，大建筑正面直接怼进屋顶）
  const BIG = new Set(['zichen', 'lingxiao', 'jiangtai', 'star9', 'yaochi', 'fengdu', 'shibayu']);
  const SMALL = new Set(['mengpo', 'countryside', 'desert', 'sansheng']);
  const R = BIG.has(key) ? 150 : SMALL.has(key) ? 32 : 56;
  // 主体尺度：紫宸殿面阔 208m、宝塔 60m 高，统一 R 会让俯视机位钻进屋顶内部
  // 天宫三环扩建后外环到 r≈580、远景宫阙到 r≈900，机位半径必须跟着放大，否则只拍到内环
  const RMAIN = { zichen: 300, lingxiao: 420, pagoda: 110, star9: 420, yaochi: 380, fengdu: 200, shibayu: 170, jiangtai: 360 };
  const R0 = RMAIN[key] ?? R;
  // 俯角也要按主体定：38m 的勾栏席棚在 14° 俯角 + R=56 时相机在 18m 高，正好压在棚顶上方
  const ELEV = { washi: 5, pagoda: 6, zichen: 10, lingxiao: 12 };
  const EV = ELEV[key] ?? 14;
  const el = (deg) => (deg * Math.PI) / 180;
  const view = (azDeg, elevDeg, r = R0) => [
    Math.cos(geo.az + el(azDeg)) * r * Math.cos(el(elevDeg)),
    r * Math.sin(el(elevDeg)),
    Math.sin(geo.az + el(azDeg)) * r * Math.cos(el(elevDeg)),
  ];
  const views = [
    ['front', view(0, EV)],
    ['side', view(90, EV)],
    ['top', view(0, 68, R0 * 1.9)],
  ];
  for (const [name, off] of views) {
    await page.evaluate(([x, y, z, tx, ty, tz]) => {
      const e = window.__qingming.engine;
      e.stopCinema();
      e.camera.position.set(x, y, z);
      e.lookTarget.set(tx, ty + 2.5, tz);
      const dx = tx - x, dy = ty + 2.5 - y, dz = tz - z;
      const d = Math.max(1, Math.hypot(dx, dy, dz));
      e.yaw = Math.atan2(-dx, -dz);
      e.pitch = Math.asin(dy / d);
      e.setCamMode('fly');
    }, [px + off[0], py + off[1], pz + off[2], px, py, pz]);
    await new Promise((r) => setTimeout(r, 550));
    await page.screenshot({ path: `${OUT}/${key}-${name}.png` });
  }
  rows.push({ key, ok, poi: geo.poi.map((v) => +v.toFixed(1)), dist: +R.toFixed(1) });
  console.log('3view', key, ok, rows.at(-1).poi.join(','), 'R=' + rows.at(-1).dist);
}
const stats = await page.evaluate(() => ({
  live: window.__qingming.world.liveCount(),
  calls: window.__qingming.engine.renderer.info.render.calls,
  tris: window.__qingming.engine.renderer.info.render.triangles,
}));
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({ rows, stats, errors }, null, 1));
console.log('STATS', JSON.stringify(stats));
console.log('ERRORS', errors.length ? errors.slice(0, 6).join(' | ') : 'NONE');
await browser.close();
