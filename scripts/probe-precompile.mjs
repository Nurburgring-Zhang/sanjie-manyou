/**
 * 验证「预编译能否消除首次俯瞰全城的 2.5 秒卡顿」——**不改源码的可行性实验**。
 *
 * 背景：`probe-calls-sweep` 实测「高空俯瞰」机位首次 2488ms、紧接着第二次 15ms（calls 都是 368），
 * 说明这是"第一次见到全城"的一次性开销（着色器变体编译 / LOD 卡创建 / 贴图上传）。
 *
 * 本探针：
 *   ① 载入完成后，手动调 `renderer.compile(scene, camera)`，**计时**它花了多久；
 *   ② 再从同一个高空机位采样 1.5s 的帧耗；
 *   ③ 与「不预编译」的基线对比。
 *
 * 如果 ① 的耗时 ≈ 2.5s 且 ② 的首帧掉到 100ms 以内 ⇒ 预编译有效，代价是载入期多花这段时间。
 * 如果 ② 仍然卡 ⇒ 卡顿不只是着色器，需要另找。
 *
 * 用法：PROBE_URL=http://localhost:4173/ node scripts/probe-precompile.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

// ---- ① 预编译计时 ----
const compileMs = await page.evaluate(() => {
  const e = window.__qingming.engine;
  const cam = e.camera;
  // 用高频机位（高空俯瞰）编译：three 的 compile 会遍历场景编译材质程序
  cam.position.set(0, 1200, 1215);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  e.scene.updateMatrixWorld(true);
  const t0 = performance.now();
  e.renderer.compile(e.scene, cam);
  return Math.round(performance.now() - t0);
});

// ---- ② 预编译后，同一高空机位的帧耗 ----
const after = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  const cam = e.camera;
  cam.position.set(0, 1200, 1215);
  const dx = 0 - 0, dy = 0 - 1200, dz = 0 - 1215;
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
  cam.updateMatrixWorld(true);

  const frames = [];
  let last = performance.now();
  const t0 = performance.now();
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (now - t0 < 1500) requestAnimationFrame(tick);
    else {
      frames.sort((a, b) => a - b);
      const q = (p) => Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] ?? 0);
      resolve({ samples: frames.length, frameP95: q(0.95), frameMax: Math.round(frames[frames.length - 1] ?? 0) });
    }
  };
  requestAnimationFrame(tick);
}));

console.log(JSON.stringify({
  note: '对比基线：不预编译时该机位首次 frameP95 = 2160/2228/2488ms',
  compileMs,
  after,
  verdict: after.frameP95 < 200 ? '预编译有效（首帧已不卡）' : '预编译无效——卡顿不只是着色器',
}, null, 1));

await browser.close();
