/**
 * R27 视觉前后对照：同一批机位、同一视口、同一时刻，分别拍「修复前 / 修复后」。
 *
 * 用户 R27 判词：宫城左右灰色墙体边缘有蓝色士兵半嵌进墙里；角色陷地；角色穿墙进室内。
 * 本脚本把机位钉死，生成可直接对照的 PNG；验收数据另见 r27_collision_acceptance.mjs。
 *
 * 用法：
 *   TAG=before PREVIEW_URL=http://127.0.0.1:4184/ node scripts/r27_visual_compare.mjs
 *   TAG=after  PREVIEW_URL=http://127.0.0.1:4186/ node scripts/r27_visual_compare.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4184/';
const TAG = process.env.TAG || 'before';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

// p = 相机位置，c = lookTarget（与 r19/r22 验收脚本同一口径）。
// 用户截图是「从午门南侧朝北望太和殿」：相机 z 约 -2860（午门 z1=-2950 以南），
// 看向 z=-3260 的太和殿；左右灰色斜墙是宫墙/门墩入画边缘，蓝色士兵碎片就贴在那条边。
// 5 号贴到仪仗东班阵列（x=300,z=-3220）看侍卫与墙；6 号看街屋室内穿墙/陷地。
const CAMS = [
  { id: '01-wumen-axis', c: [0, 12, -3300], p: [0, 11, -2860] },
  { id: '02-wumen-axis-wide', c: [0, 16, -3300], p: [0, 26, -2820] },
  { id: '03-wumen-gate-inside', c: [0, 12, -3260], p: [0, 7, -2955] },
  { id: '04-court-guard-east', c: [300, 2, -3220], p: [372, 12, -3150] },
  { id: '05-court-guard-west', c: [-300, 2, -3220], p: [-372, 12, -3150] },
  { id: '06-street-house', c: [200, 4, 42], p: [200, 9, 98] },
];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 2500));

const out = { at: new Date().toISOString(), tag: TAG, url: URL, cams: CAMS, shots: [], pageErrors: errs };
for (const cam of CAMS) {
  await page.evaluate(({ c, p }) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(p[0], p[1], p[2]);
    e.lookTarget.set(c[0], c[1], c[2]);
    const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
  }, cam);
  await new Promise((r) => setTimeout(r, 1200));
  const f = `${OUT}/r27-${TAG}-${cam.id}.png`;
  await page.screenshot({ path: f });
  out.shots.push(f);
  console.log('shot:', f);
}

// 运行时统计（R26 基线没有这些句柄时如实记 null，不伪造）
out.runtime = await page.evaluate(() => {
  const w = window.__qingming;
  const q = (fn) => { try { return fn(); } catch (e) { return 'ERR:' + String(e).slice(0, 120); } };
  return {
    solids: typeof w.solids === 'function' ? q(() => w.solids()) : null,
    destruction: typeof w.destruction === 'function' ? q(() => w.destruction()) : null,
    collisionAudit: q(() => w.world?.crowd?.collisionAudit?.() ?? null),
    perf: q(() => window.__perf?.() ?? null),
    bundle: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')),
  };
});
fs.writeFileSync(`${OUT}/r27-${TAG}-runtime.json`, JSON.stringify(out, null, 2));
console.log('runtime:', JSON.stringify(out.runtime).slice(0, 1200));
console.log('pageErrors:', errs.length, errs.slice(0, 5));
await browser.close();
