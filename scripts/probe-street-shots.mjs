/**
 * 街面取景：把相机放到街面/桥面，输出 PNG，用来人眼复核「排成线」与「水上行人」。
 * 只读场景，不改任何世界状态（除相机位姿）。
 *
 * 用法：PROBE_URL=http://localhost:4275/ node scripts/probe-street-shots.mjs
 * 输出：<tmp>/cq-r26/*.png
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH
  || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const OUT = path.join(os.tmpdir(), 'cq-r26');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
const ready = () => page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming,
  { timeout: 240000 },
);
await ready();
await new Promise((r) => setTimeout(r, 2500));
try { await ready(); } catch {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await new Promise((r) => setTimeout(r, 2500));
}
const evaluate = async (fn, arg) => {
  for (let i = 0; i < 3; i++) {
    try { return await page.evaluate(fn, arg); } catch (e) {
      if (!/context was destroyed|undefined/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      try { await ready(); } catch { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
    }
  }
  throw new Error('evaluate failed after reload retries');
};


const shots = [
  { name: '01-street-west', x: 120, y: 2.1, z: 52, yaw: Math.PI / 2, pitch: -0.03 },
  { name: '02-street-east', x: -260, y: 2.1, z: 52, yaw: -Math.PI / 2, pitch: -0.03 },
  { name: '03-bridge-river', x: 0, y: 12, z: 6, yaw: Math.PI, pitch: -0.22 },
  { name: '04-river-bank', x: -180, y: 3.2, z: 40, yaw: Math.PI, pitch: -0.12 },
  { name: '05-river-top', x: -80, y: 55, z: 0, yaw: Math.PI, pitch: -1.2 },
];

for (const s of shots) {
  await evaluate(async (s) => {
    const { engine } = window.__qingming;
    engine.stopCinema('fly');
    engine.setCamMode('fly');
    engine.camera.position.set(s.x, s.y, s.z);
    engine.yaw = s.yaw;
    engine.pitch = s.pitch;
    // 让 updateCamera 把 lookTarget 定下来，再渲染两帧
    engine.renderOnce(1 / 30);
    engine.renderOnce(1 / 30);
  }, s);
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: path.join(OUT, s.name + '.png') });
  console.log('shot', s.name);
}
console.log('out', OUT);
await browser.close();
