/**
 * 禁軍營独立取证（R21）。
 *
 * 背景：主验收脚本 _r20_acceptance.mjs 的 21 格长时序里，跨 realm teleport 后
 * 第一次靠近 (3960,1430) 时，一块异步加载的巨大平台会横在相机前把整格糊成灰板；
 * 而在主流程里延长等待 / 重复 teleport 又会让 SwiftShader 触发
 * `WebGL context lost`（21 格 × 更长等待耗尽 GPU 资源）。
 *
 * 解法：用一条独立、干净、极短的浏览器会话，先在同区域 teleport 预热一次并丢掉该帧，
 * 再拍 -z 侧 75m 斜视定稿机位（实拍 r20-T2 证明该角度能看到方形营院、点将台、
 * 营房连排与红旗杆）。单 browser / 单 page / finally 显式 close。
 *
 * 用法：node scripts/r21_camp_shot.mjs
 * 输出：artifacts/r21-camp-jinjun.png + artifacts/r21-camp-jinjun.json
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
const W = 1600, H = 900;
fs.mkdirSync(OUT, { recursive: true });

const CAMS = [
  // ① 预热：同区域高远机位，只用来触发分区加载，截图丢弃
  { tag: 'warmup', c: [3960, 5, 1430], p: [3960, 150, 1780], keep: false },
  // ② 定稿：-z 侧斜视
  { tag: 'final', c: [3960, 5, 1430], p: [3960, 75, 1290], keep: true },
];

const result = { url: URL, cams: [], pageErrors: [], shots: 0 };
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000, timeout: 180000,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('pageerror', e => result.pageErrors.push('PAGE:' + String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') result.pageErrors.push('CONSOLE:' + m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming && !!window.__realmSnap,
    { timeout: 240000 },
  );
  await new Promise(r => setTimeout(r, 2200));
  result.bundle = await page.evaluate(
    () => [...document.querySelectorAll('script[type="module"]')].map(s => s.src.split('/').pop()),
  );

  for (const cam of CAMS) {
    const teleported = await page.evaluate(() => window.__qingming.world.teleport('bridge'));
    await new Promise(r => setTimeout(r, 900));
    await page.evaluate(({ c, p }) => {
      const e = window.__qingming.engine;
      e.stopCinema();
      const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
      e.camera.position.set(p[0], p[1], p[2]);
      const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
      const d = Math.max(1, Math.hypot(dx, dy, dz));
      e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
      e.lookTarget.set(c[0], c[1], c[2]);
    }, { c: cam.c, p: cam.p });
    await new Promise(r => setTimeout(r, 2200));
    const file = cam.keep
      ? path.join(OUT, 'r21-camp-jinjun.png')
      : path.join(OUT, '_r21-camp-warmup.png');
    await page.screenshot({ path: file });
    result.cams.push({ tag: cam.tag, teleported, file, bytes: fs.statSync(file).size, kept: cam.keep });
    if (cam.keep) result.shots++;
    process.stdout.write('.');
  }
  console.log('');
  result.ok = true;
} catch (e) {
  result.ok = false;
  result.error = String(e).slice(0, 400);
} finally {
  if (browser) await browser.close();
}
result.browserClosed = true;
fs.writeFileSync(path.join(OUT, 'r21-camp-jinjun.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
