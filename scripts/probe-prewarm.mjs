/**
 * 验证「1×1 render-target 预渲染」能否把首次俯瞰全城的 2.5 秒卡顿挪进载入期。
 *
 * 上一轮已排除着色器编译：`renderer.compile()` 只花 50ms，预编译后首帧仍 3781ms。
 * 所以 2.5s 花在**首次绘制大场景时的几何/实例缓冲上传**（`city_*` 数百万顶点 + 516 个 InstancedMesh）。
 *
 * 本探针：载入后先渲染一帧到 1×1 render target（强制触发上传），**计时**，再从同一高空机位采帧。
 *   - 若 prewarmMs ≈ 2.5s 且随后 frameP95 变很小 ⇒ 预渲染有效，代价可直接读出来；
 *   - 若 prewarmMs 很小而随后仍卡 ⇒ 上传不是原因，需另找。
 *
 * 用法：PROBE_URL=http://localhost:4173/ node scripts/probe-prewarm.mjs
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

// ---- ① 1×1 render target 预渲染，计时 ----
const prewarmMs = await page.evaluate(() => {
  const THREE = window.__qingming.THREE;
  const e = window.__qingming.engine;
  const cam = e.camera;
  e.stopCinema();
  cam.position.set(0, 1200, 1215);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  e.scene.updateMatrixWorld(true);

  const rt = new THREE.WebGLRenderTarget(1, 1);
  const t0 = performance.now();
  const prev = e.renderer.getRenderTarget();
  e.renderer.setRenderTarget(rt);
  e.renderer.render(e.scene, cam);
  e.renderer.setRenderTarget(prev);
  const dt = performance.now() - t0;
  rt.dispose();
  return Math.round(dt);
});

// ---- ② 预渲染后，同一高空机位的首帧 ----
const after = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__qingming.engine;
  const cam = e.camera;
  cam.position.set(0, 1200, 1215);
  const dy = -1200, dz = -1215;
  const d = Math.max(1, Math.hypot(0, dy, dz));
  e.yaw = 0;
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
  note: '基线（无预渲染）：该机位首次 frameP95 = 2160 / 2228 / 2488ms',
  prewarmMs,
  after,
  verdict: after.frameP95 < 300
    ? `预渲染有效：把 ${prewarmMs}ms 挪进载入期，游戏内首帧降到 ${after.frameP95}ms`
    : '预渲染无效——上传不是主因',
}, null, 1));

await browser.close();
