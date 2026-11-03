/**
 * 长帧归因探针（LoAF：Long Animation Frames API）。
 *
 * 为什么需要它：H5 五路消融把 dev p95=25.1ms 定性为「呈现侧偶发错过 vsync（噪声）」，但那是
 * 排除法（关掉谁都没用）。LoAF 是 Chrome 官方的长帧归因 API：每个 ≥50ms 的动画帧直接上报
 * scriptDuration / renderDuration / styleAndLayoutDuration / blockingDuration 与脚本归属
 * （invoker），把「我们的 JS 太慢」和「JS 之外的提交/合成侧错过 vsync」**正面分开**。
 *
 * 判读口径：
 *   - 采样窗内 LoAF 长帧 ≈ 0 且 rAF p95 仍 ~25ms ⇒ 「JS 不慢，长帧来自提交/合成侧」——
 *     噪声定性被正面证据坐实，P3-1b 该去查合成器/驱动/GC，而不是查脚本。
 *   - LoAF 帧的 scriptDuration 高且 invoker 指向具体脚本 ⇒ JS 归因成立，按 invoker 修。
 *   - LoAF renderDuration/style 高 ⇒ 排版/绘制归因（DOM/UI 层）。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-frame-pacing.mjs
 *   可选：PACE_MS（采样窗毫秒，默认 30000）/ PACE_OUT / PACE_HEADFUL=1
 *
 * 退出码：0 = 采样完成（长帧多少不影响退出码——本探针是测量，不是门）；环境失败才 1。
 * 输出：artifacts/frame-pacing.json + 控制台摘要。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const PACE_MS = Number(process.env.PACE_MS || 30000);
const HEADFUL = process.env.PACE_HEADFUL === '1';
const OUT = process.env.PACE_OUT || path.resolve('artifacts/frame-pacing.json');

const VIEWPORT = { width: 1980, height: 1080, deviceScaleFactor: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const round1 = (x) => +x.toFixed(1);
function quantile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (!n) return 0;
  return sortedAsc[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
}

let browser = null;
let code = 1;
const pageErrors = [];
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !HEADFUL,
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('[pace] NAVIGATED →', f.url()); });

  // 必须在导航前注入：buffered: true 才能把载入期的长帧也收进来
  await page.evaluateOnNewDocument(() => {
    window.__loaf = [];
    window.__loafUnsupported = null;
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__loaf.push({
            st: +e.startTime.toFixed(1),
            dur: +e.duration.toFixed(1),
            script: +e.scriptDuration.toFixed(1),
            render: +e.renderDuration.toFixed(1),
            style: +e.styleAndLayoutDuration.toFixed(1),
            blocking: +e.blockingDuration.toFixed(1),
            scripts: (e.scripts || []).slice(0, 5).map((s) => ({
              d: +s.duration.toFixed(1),
              n: (s.name || '').split('/').pop(),
              inv: s.invokerType ? `${s.invokerType}:${String(s.invoker || '').slice(0, 60)}` : '',
            })),
          });
        }
      });
      po.observe({ type: 'long-animation-frame', buffered: true });
    } catch (err) {
      window.__loafUnsupported = String(err).slice(0, 120);
    }
  });

  await page.setViewport(VIEWPORT);
  page.setDefaultTimeout(240000);
  console.log('[pace] goto', URL);
  const tGoto = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  console.log(`[pace] loaded in ${((Date.now() - tGoto) / 1000).toFixed(1)}s`);
  await sleep(2500); // crowd 铺开 / LOD 首落档 / 着色器首编译

  const meta = await page.evaluate(() => {
    const Q = window.__qingming;
    const e = Q.engine;
    const gl = e.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      backend: {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      },
      quality: { name: e.quality.name, pixelRatio: e.renderer.getPixelRatio() },
      loafUnsupported: window.__loafUnsupported,
      loafTotalSoFar: window.__loaf.length,
    };
  });
  console.log('[pace] backend:', meta.backend.renderer, '| quality:', JSON.stringify(meta.quality));
  if (meta.loafUnsupported) console.log('[pace] WARN: LoAF 不可用 →', meta.loafUnsupported);

  // 采样窗：起点记录清楚，只统计窗内的长帧（载入期长帧单列）
  const win = await page.evaluate(async (ms) => {
    const t0 = performance.now();
    const lo0 = window.__loaf.length;
    await new Promise((r) => setTimeout(r, ms));
    const frames = window.__qingming.engine.frameMs.slice();
    return { t0, lo0, frames, loAll: window.__loaf };
  }, PACE_MS);

  const inWindow = win.loAll.filter((e) => e.st >= win.t0);
  const durs = inWindow.map((e) => e.dur).sort((a, b) => a - b);
  const scriptSum = inWindow.reduce((a, e) => a + e.script, 0);
  const renderSum = inWindow.reduce((a, e) => a + e.render, 0);
  const styleSum = inWindow.reduce((a, e) => a + e.style, 0);
  const invokers = {};
  for (const e of inWindow) for (const s of e.scripts) {
    const k = s.inv || s.n || 'unknown';
    invokers[k] = (invokers[k] || 0) + s.d;
  }
  const topInvokers = Object.entries(invokers).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => ({ invoker: k, scriptMs: +v.toFixed(1) }));

  const f = win.frames.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const frameStats = {
    n: f.length,
    p50: round1(quantile(f, 0.5)),
    p95: round1(quantile(f, 0.95)),
    p99: round1(quantile(f, 0.99)),
    max: round1(f.length ? f[f.length - 1] : 0),
    over16: f.filter((x) => x > 16.8).length,
    over33: f.filter((x) => x > 33.4).length,
  };

  const loadPhase = win.loAll.filter((e) => e.st < win.t0);
  const attribution = inWindow.length === 0
    ? 'NO_LOAF: 采样窗内无 ≥50ms 长帧；若 frameStats.p95 仍 ~25ms ⇒ JS 之外（提交/合成侧）归因成立'
    : (scriptSum > renderSum + styleSum
      ? `JS_ATTRIBUTION: script ${round1(scriptSum)}ms 占主导；top invoker: ${topInvokers[0]?.invoker || '?'}`
      : `NON_JS_ATTRIBUTION: render ${round1(renderSum)}ms / style ${round1(styleSum)}ms 占主导（排版/绘制侧）`);

  const out = {
    generatedAt: new Date().toISOString(),
    url: URL,
    chrome: CHROME,
    window: { ms: PACE_MS },
    backend: meta.backend,
    quality: meta.quality,
    loafUnsupported: meta.loafUnsupported || null,
    loafLoadPhaseCount: loadPhase.length,
    loafWindowCount: inWindow.length,
    loafWindowStats: {
      p50: round1(quantile(durs, 0.5)),
      p95: round1(quantile(durs, 0.95)),
      max: round1(durs.length ? durs[durs.length - 1] : 0),
      scriptSumMs: round1(scriptSum),
      renderSumMs: round1(renderSum),
      styleSumMs: round1(styleSum),
    },
    topInvokers,
    frameStats,
    attribution,
    pageErrors,
    note: 'engine.frameMs 是引擎 dt×1000（Math.min(0.1,…) 截断上限 100ms）；LoAF 只报 ≥50ms 动画帧',
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

  console.log('\n[pace] ===== 采样窗结果 =====');
  console.log('frame p50/p95/p99/max :', frameStats.p50, '/', frameStats.p95, '/', frameStats.p99, '/', frameStats.max, 'ms  (n=' + frameStats.n + ')');
  console.log('帧 >16.8ms / >33.4ms  :', frameStats.over16, '/', frameStats.over33);
  console.log('LoAF 长帧数（窗内）    :', inWindow.length, '（载入期累计', meta.loafTotalSoFar, '）');
  if (inWindow.length) {
    console.log('LoAF dur p50/p95/max  :', out.loafWindowStats.p50, '/', out.loafWindowStats.p95, '/', out.loafWindowStats.max);
    console.log('归因合计 script/render/style :', out.loafWindowStats.scriptSumMs, '/', out.loafWindowStats.renderSumMs, '/', out.loafWindowStats.styleSumMs, 'ms');
    for (const t of topInvokers) console.log('  invoker', t.invoker, '→', t.scriptMs, 'ms');
  }
  console.log('ATTRIBUTION:', attribution);
  console.log('[pace] 写出 →', OUT);
  code = 0;
} catch (err) {
  console.error('[pace] FAILED:', String(err).slice(0, 400));
  code = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
