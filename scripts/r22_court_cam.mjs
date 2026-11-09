/**
 * R22：为「25 号 樞密院庭院起居陈设」试拍候选机位，找出能真正看到院内 buildCourtLife 陈设的构图。
 * 樞密院中心 (1080, 770)，size=66 → 院落约 x 1047–1113 / z 737–803。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const CAMS = [
  { tag: 'A', c: [1080, 2, 765], p: [1080, 26, 806] },   // 院南上方俯看院内
  { tag: 'B', c: [1080, 2, 762], p: [1052, 18, 796] },   // 院西南角低空斜看
  { tag: 'C', c: [1080, 2, 770], p: [1080, 42, 815] },   // 正南较高俯视
  { tag: 'D', c: [1080, 2, 775], p: [1112, 14, 792] },   // 院东南侧贴院墙
];
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__qingming.world.teleport('bridge'));
await new Promise((r) => setTimeout(r, 1500));

for (const cam of CAMS) {
  await page.evaluate(({ c, p }) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(p[0], p[1], p[2]);
    e.lookTarget.set(c[0], c[1], c[2]);
    const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / d);
  }, { c: cam.c, p: cam.p });
  await new Promise((r) => setTimeout(r, 1100));
  await page.screenshot({ path: `artifacts/r22-courtcam-${cam.tag}.png` });
  console.log(cam.tag, 'p=', cam.p, 'c=', cam.c);
}
await browser.close();
