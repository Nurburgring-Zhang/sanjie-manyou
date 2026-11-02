/**
 * 受控相机扫掠：测 draw call 与帧耗的**峰值**，替代 verify-packaged 的单点读数。
 *
 * 为什么需要它（本项目已因"单点采样"误判过三次）：
 *   `calls` 是某一帧的 `renderer.info.render.calls`，而每帧可见集不同。
 *   同一份 release-v84 连测三次是 **608 / 460 / 597** —— 单点既不能判达标也不能判回归。
 *   `frameP95` 同理，必须在一组固定机位下逐帧采集。
 *
 * 判据（§0）：`calls` 全程 max ≤ 600。
 *
 * 用法：PROBE_URL=http://localhost:4173/ node scripts/probe-calls-sweep.mjs
 * 退出码 0 = 峰值 ≤600，1 = 超标。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';
const LIMIT = 600;
const HOLD_MS = 1500;

/** 六个固定机位：开场运镜附近 + 街面 + 高空 + 桥区 + 天宫 + 地府 */
const VIEWS = [
  { name: '开场街面', p: [-197, 14, 36], t: [0, 8, -60] },
  { name: '御街中轴', p: [0, 30, 2400], t: [0, 20, -2000] },
  { name: '高空俯瞰', p: [0, 1200, 1215], t: [0, 0, 0] },
  { name: '高空俯瞰#2', p: [0, 1200, 1215], t: [0, 0, 0] },
  { name: '虹桥桥面', p: [0, 34, 64], t: [0, 10, -6] },
  { name: '天宫外景', p: [420, 360, 420], t: [0, 275, 0] },
  { name: '地府阎罗殿', p: [0, -200, 152], t: [0, -232, 0] },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const v of VIEWS) {
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 120000 });
  const s = await page.evaluate((vv, hold) => new Promise((resolve) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(vv.p[0], vv.p[1], vv.p[2]);
    const dx = vv.t[0] - vv.p[0], dy = vv.t[1] - vv.p[1], dz = vv.t[2] - vv.p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.camera.updateMatrixWorld(true);

    const calls = [];
    const frames = [];
    let last = performance.now();
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      calls.push(e.renderer.info.render.calls);
      if (now - t0 < hold) requestAnimationFrame(tick);
      else {
        calls.sort((a, b) => a - b);
        frames.sort((a, b) => a - b);
        const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
        resolve({
          samples: calls.length,
          callsMax: calls[calls.length - 1] ?? 0,
          callsP50: q(calls, 0.5),
          frameP95: Math.round(q(frames, 0.95)),
          frameMax: Math.round(frames[frames.length - 1] ?? 0),
        });
      }
    };
    requestAnimationFrame(tick);
  }), v, HOLD_MS);
  rows.push({ name: v.name, ...s });
  console.log(
    `${s.callsMax > LIMIT ? 'FAIL' : 'ok  '}  ${v.name.padEnd(10)} calls max ${String(s.callsMax).padStart(4)}  p50 ${String(s.callsP50).padStart(4)}  frameP95 ${String(s.frameP95).padStart(4)}ms`,
  );
}

const maxCalls = Math.max(...rows.map((r) => r.callsMax));
const worstFrame = Math.max(...rows.map((r) => r.frameP95));
const pass = maxCalls <= LIMIT;
console.log(JSON.stringify({ limit: LIMIT, maxCalls, worstFrameP95: worstFrame, rows, pass }, null, 1));
await browser.close();
process.exit(pass ? 0 : 1);
