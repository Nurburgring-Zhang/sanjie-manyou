/**
 * npcSweep 计量探针（审计 E1 的护航探针，SPEC-全面审计-20261104.md §2 P1-3）。
 *
 * 原理：页面运行时 monkey-patch `world.impacts.npcSweep` 实例方法（不碰 src/，
 * 不进确定性门），逐次记录耗时；采样窗结束后输出分布与负载规模。
 * 每帧分配次数用 调用次数×walker数×(clone数) 代理——修复前每个 walker 一次 clone。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-npc-sweep-cost.mjs
 *   可选：SWEEP_MS（采样窗，默认 12000）/ SWEEP_OUT
 * 退出码：0 = 采样完成（测量探针，不设红绿门——判定看修复前后对比）。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const SWEEP_MS = Number(process.env.SWEEP_MS || 12000);
const OUT = process.env.SWEEP_OUT || path.resolve('artifacts/npc-sweep-cost.json');

let browser = null;
let code = 2;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  console.log('[sweep] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 附身模式才会跑 npcSweep（world.update 里 player.mode==='avatar' 分支）——探针里强制切入
  await page.evaluate(() => {
    const pl = window.__qingming.world.player;
    if (pl?.mode === 'soul' && typeof pl.toggleMode === 'function') pl.toggleMode();
  });
  await new Promise((r) => setTimeout(r, 800));
  const mode = await page.evaluate(() => window.__qingming.world.player.mode);
  console.log('[sweep] player.mode =', mode);

  const win = await page.evaluate(async (ms) => {
    const imp = window.__qingming.world.impacts;
    if (!imp || typeof imp.npcSweep !== 'function') return { fatal: 'impacts.npcSweep 不可达' };
    const dts = [];
    let walkers = 0, vehicles = 0, calls = 0;
    const orig = imp.npcSweep.bind(imp);
    imp.npcSweep = (v, w) => {
      const t0 = performance.now();
      orig(v, w);
      const dt = performance.now() - t0;
      calls++; dts.push(dt);
      walkers = w.length; vehicles = v.length;
    };
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, ms));
    imp.npcSweep = orig;
    return { dts, walkers, vehicles, calls, windowMs: +(performance.now() - t0).toFixed(0) };
  }, SWEEP_MS);

  if (win.fatal) {
    console.error('[sweep] FATAL:', win.fatal);
  } else {
    const s = win.dts.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))].toFixed(3) : 0);
    const out = {
      generatedAt: new Date().toISOString(),
      url: URL,
      windowMs: win.windowMs,
      calls: win.calls,
      walkersPerCall: win.walkers,
      vehiclesPerCall: win.vehicles,
      cloneProxyPerCall: win.walkers * win.vehicles,
      ms: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? +s[s.length - 1].toFixed(3) : 0, mean: +(s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(3) },
      note: 'monkey-patch 实例方法计时，含 patch 开销 ~µs 级；修复对比看同探针前后差值',
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log(`[sweep] 采样 ${win.windowMs}ms：npcSweep 调用 ${win.calls} 次（每 3 帧一次）`);
    console.log(`[sweep] 负载：walkers=${win.walkers} vehicles=${win.vehicles} clone代理=${win.walkers * win.vehicles}/次`);
    console.log(`[sweep] 单次耗时 ms：p50=${out.ms.p50} p95=${out.ms.p95} p99=${out.ms.p99} max=${out.ms.max} mean=${out.ms.mean}`);
    console.log('[sweep] 写出 →', OUT);
    code = win.calls > 0 ? 0 : 1;
  }
} catch (err) {
  console.error('[sweep] FAILED:', String(err).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
