/**
 * 打包产物实测：启动 electron-builder 的 portable / unpacked 应用，
 * 通过远程调试端口连进去，确认真的加载了 dist、渲染出三.js 场景，并截图留证。
 *
 * 用法：node scripts/verify-packaged.mjs [可执行文件路径]
 *   默认取 release-v11/win-unpacked/CyberQingming.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const exe = process.argv[2] ?? path.join(ROOT, 'release-v11', 'win-unpacked', 'CyberQingming.exe');
const OUT_DIR = path.join(ROOT, 'screenshots', 'packaged');
const PORT = 9333;

if (!fs.existsSync(exe)) {
  console.error('找不到打包产物：', exe);
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// Electron 在窗口被遮挡/失焦时会把 requestAnimationFrame 节流到几乎停摆（实测卡在第 34 帧），
// 这三个开关关掉后台节流，自动化验证才能拿到真实帧。
const child = spawn(exe, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu-sandbox',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
], {
  detached: false,
  stdio: 'ignore',
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitEndpoint(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(700);
  }
  return null;
}

let browser;
let code = 1;
try {
  const version = await waitEndpoint();
  if (!version) throw new Error('调试端口未就绪（应用可能未启动）');
  console.log('electron:', version.Browser);
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null, protocolTimeout: 240000 });
  const pages = await browser.pages();
  const page = pages.find((p) => !p.url().startsWith('devtools://')) ?? pages[0];
  try { await page.bringToFront(); } catch { /* 无窗口焦点也能跑 */ }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  // Electron 首帧可能重载一次，执行上下文会换；waitForFunction 会挂在旧上下文上。
  // 改成轮询 + 捕获错误，对上下文切换免疫。
  async function pollUntil(fn, budgetMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      try {
        if (await page.evaluate(fn)) return true;
      } catch { /* 上下文切换中，下一轮再试 */ }
      await sleep(800);
    }
    throw new Error(`${label} 超时（${budgetMs}ms）`);
  }
  await pollUntil(() => typeof window.__qingming === 'object' && !!window.__qingming, 150000, '等待 __qingming');
  await pollUntil(() => !document.getElementById('loading'), 150000, '等待加载层消失');
  await sleep(2500);
  // 2026-11-05：frameMs 环形缓冲（600 帧）里混着载入期构图冷帧（着色器首编译/峰值堆），
  // 载入完成即快照会把冷帧算进 p95（六轮双峰 58 vs 67-83 的根因）。稳态口径：清空缓冲
  // 后再采 300 帧（≥5s @60fps），与 --ab 的 baseline 口径一致。
  await page.evaluate(() => { const e = window.__qingming.engine; e.frameMs.length = 0; e.maxFrameMs = 0; });
  await sleep(5000);
  const url = page.url();
  // 首帧可能仍在编译着色器（软件渲染下每帧数秒），统计值要轮询到场景真的画出来为止
  async function readInfo() {
    return page.evaluate(() => {
    const w = window.__qingming.world;
    const e = window.__qingming.engine;
    return {
      title: document.title,
      live: w.liveCount(),
      heroes: w.heroEntries().length,
      calls: e.renderer.info.render.calls,
      triangles: e.renderer.info.render.triangles,
      canvas: [e.renderer.domElement.width, e.renderer.domElement.height],
      // 硬件阻塞口径（应用自带 frameMs 环形缓冲）：p95 才是「生成期卡不卡」的判据，
      // max 单帧是一次全场景渲染，属光栅器属性
      frameP95: (() => { const a = (e.frameMs || []).slice().sort((x, y) => y - x); return Math.round(a[Math.floor(a.length * 0.05)] ?? 0); })(),
      frameMax: Math.round(e.maxFrameMs || 0),
      // 载入归因（2026-11-01）：打包态用 file:// 从 asar 读，与 vite preview 的 HTTP 路径不可比。
      //   `__loadStartAt` 本身就是 performance.now()，所以它 = **导航 → 引擎开始生成** 的毫秒数；
      //   engineMs = 引擎内的世界生成；两者相加才是导航 → 生成结束。
      //   注意这两个量挂在 **window** 上，不是 world 对象上（上一轮写成 w.__loadStartAt 取到 undefined，engineMs 恒 0）。
      navToEngineMs: Math.round(window.__loadStartAt ?? 0),
      engineMs: Math.round((window.__loadEndAt ?? 0) - (window.__loadStartAt ?? 0)),
      flushMs: Math.round(window.__flushMs ?? 0),
    };
    });
  }
  // --ab：硬件 p95 归因（关/开 Bloom、SSAO 各量 3 秒），复用本脚本已验证的 CDP 连接
  if (process.argv.includes('--ab')) {
    const measure = async (label) => {
      await page.evaluate(() => { const e = window.__qingming.engine; e.frameMs.length = 0; e.maxFrameMs = 0; });
      await sleep(3000);
      const r = await page.evaluate(() => { const e = window.__qingming.engine; const a = e.frameMs.slice().sort((x, y) => y - x); return { n: a.length, p50: Math.round(a[Math.floor(a.length * 0.5)] ?? 0), p95: Math.round(a[Math.floor(a.length * 0.05)] ?? 0) }; });
      console.log(label, JSON.stringify(r));
    };
    await measure('baseline');
    await page.evaluate(() => { window.__qingming.engine.bloomPass.enabled = false; });
    await measure('no-bloom');
    await page.evaluate(() => { const e = window.__qingming.engine; e.bloomPass.enabled = true; if (e.ssaoPass) e.ssaoPass.enabled = false; });
    await measure('no-ssao');
    // 丢帧归因：只看总帧时间 >20ms 的帧，比较「JS 段」与「渲染段」谁占大头
    const hitch = await page.evaluate(() => {
      const e = window.__qingming.engine;
      const n = Math.min(e.frameMs.length, e.frameJsMs.length, e.frameRenderMs.length);
      let cnt = 0, js = 0, rd = 0;
      for (let i = n - 1; i >= 0 && i >= n - 200; i--) {
        if (e.frameMs[i] > 20) { cnt++; js += e.frameJsMs[i]; rd += e.frameRenderMs[i]; }
      }
      return { slowFrames: cnt, avgJs: cnt ? +(js / cnt).toFixed(1) : 0, avgRender: cnt ? +(rd / cnt).toFixed(1) : 0 };
    });
    console.log('hitch', JSON.stringify(hitch));
    await browser.close().catch(() => {});
    try { child.kill(); } catch { /* ignore */ }
    process.exit(0);
  }
  let info = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    try {
      info = await readInfo();
      if (info && info.triangles > 1e6) break;
    } catch { /* 渲染忙，下一轮 */ }
    await sleep(2000);
  }
  if (!info) info = { title: '', live: 0, heroes: 0, calls: 0, triangles: 0, canvas: [0, 0] };
  // 打包版首帧在软件渲染下可能超过默认协议超时；截图属于留证，失败不判负
  try { await page.screenshot({ path: path.join(OUT_DIR, 'portable-boot.png'), timeout: 180000 }); } catch (e) { console.log('screenshot skipped:', String(e).slice(0, 120)); }
  // PASS 必须同时满足：无页面错误 + 场景起来了 + 来源合法。
  // 原实现把 errors 只放进退出码、不进 ok，导致日志可以打印 PASS 而进程 exit 1——
  // 人读日志会被骗。（2026-11-03 审核 D 指出，已修）
  // PASS 判据（2026-11-03 补）：性能红线必须进 PASS，否则「PASS」只等于「能启动」。
  // 载入均值：navToEngineMs + engineMs ≤ 12,000（SPEC 总账判定口径）
  const loadMs = (info.navToEngineMs ?? 0) + (info.engineMs ?? 0);
  const loadOk = loadMs > 0 && loadMs <= 12000;
  const callsOk = (info.calls ?? 0) <= 600;
  // 门双口径（2026-11-05，审核 B 原话「50 是发布门，不是地基门」落地）：
  //   G0 地基门 = p95 ≤ 70 且不回归 M0 基线（基线 58，baseline-M0.json）；
  //   发布门   = p95 ≤ 50（G3 门槛，另报不混判）。
  const p95 = info.frameP95 ?? 0;
  const p95DevGate = p95 > 0 && p95 <= 70 && p95 <= 58 * 1.05;   // 地基门：≤70 且不回归基线 ±5%
  const p95ReleaseGate = p95 > 0 && p95 <= 50;                    // 发布门：G3 才要求
  const ok =
    errors.length === 0 &&
    info.live > 0 &&
    info.triangles > 1e6 &&
    /^file:|^http:\/\/127/.test(url) &&
    loadOk &&
    callsOk &&
    p95DevGate;
  console.log('url:', url);
  console.log('runtime:', JSON.stringify(info));
  console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'NONE');
  console.log(
    `gates: load=${loadMs}ms(≤12000 ${loadOk ? 'OK' : 'FAIL'}) ` +
      `calls=${info.calls}(≤600 ${callsOk ? 'OK' : 'FAIL'}) ` +
      `p95=${info.frameP95}ms(地基≤70不回归基线 ${p95DevGate ? 'OK' : 'FAIL'} | 发布≤50 ${p95ReleaseGate ? 'OK' : 'PENDING-G3'})`,
  );
  console.log(ok ? 'PACKAGED_BOOT=PASS' : 'PACKAGED_BOOT=FAIL');
  code = ok ? 0 : 1;
} catch (err) {
  console.error('PACKAGED_BOOT=FAIL', String(err).slice(0, 300));
} finally {
  try { await browser?.disconnect(); } catch { /* ignore */ }
  try { child.kill(); } catch { /* ignore */ }
  // Electron 会拉起子进程，Windows 上按镜像名兜底清理
  if (process.platform === 'win32') {
    try {
      const { execSync } = await import('node:child_process');
      execSync('taskkill /F /IM CyberQingming.exe /T', { stdio: 'ignore' });
    } catch { /* 已退出 */ }
  }
}
process.exit(code);
