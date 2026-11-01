/** 定点截图：node scripts/shot.mjs <out.png> <x> <y> <z> <tx> <ty> <tz> [w] [h] */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const [out, x, y, z, tx, ty, tz] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true, args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
// 就绪判据：加载页已移除 **且** 自动化句柄已挂上。只等 loading 消失会读到空全局量（约一半概率）
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__qingming.engine,
  { timeout: 120000 },
);
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(([px, py, pz, ax, ay, az]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(px, py, pz);
  e.lookTarget.set(ax, ay, az);
  const dx = ax - px, dy = ay - py, dz = az - pz;
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
}, [Number(x), Number(y), Number(z), Number(tx), Number(ty), Number(tz)]);
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: out });
await browser.close();
console.log('shot', out);
