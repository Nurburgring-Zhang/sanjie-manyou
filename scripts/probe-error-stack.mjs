/**
 * 运行时错误监听探针：加载页面采样 N 秒，捕获 pageerror 的完整堆栈并按去重汇总。
 *
 * 为什么需要它：LoAF 归因探针在 30s 采样窗内捕获到 52×「Cannot read properties of undefined
 * (reading 'toFixed')」，但 puppeteer 的 pageerror 只有 message 没有堆栈，无法定位。
 * 本探针在页面内挂 window.onerror（带 error.stack）+ unhandledrejection，把堆栈带回来。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-error-stack.mjs
 *   可选：ERR_MS（采样毫秒，默认 30000）/ ERR_OUT
 * 退出码：0 = 采样完成（有无错误都不影响退出码——本探针是测量）；环境失败才 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ERR_MS = Number(process.env.ERR_MS || 30000);
const OUT = process.env.ERR_OUT || path.resolve('artifacts/error-stack.json');
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
let code = 1;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // 必须在导航前注入：带堆栈捕获（pageerror 只有 message）
  await page.evaluateOnNewDocument(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => {
      window.__errs.push({ kind: 'error', msg: String(e.message).slice(0, 160), stack: String(e.error?.stack || '').split('\n').slice(0, 6).join(' | ') });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      window.__errs.push({ kind: 'rejection', msg: String(r?.message || r).slice(0, 160), stack: String(r?.stack || '').split('\n').slice(0, 6).join(' | ') });
    });
  });

  console.log('[errstack] goto', URL);
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  console.log(`[errstack] loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s，进入 ${ERR_MS / 1000}s 采样窗`);
  await sleep(ERR_MS);

  const errs = await page.evaluate(() => window.__errs);
  // 按 堆栈首帧 归组（同一处代码反复抛 = 同一组）
  const groups = new Map();
  for (const e of errs) {
    const key = e.stack ? e.stack.split(' | ')[1] || e.stack.split(' | ')[0] : e.msg;
    if (!groups.has(key)) groups.set(key, { msg: e.msg, sample: e.stack, count: 0, kind: e.kind });
    groups.get(key).count++;
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count);
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, windowMs: ERR_MS, total: errs.length, groups: list }, null, 1));

  console.log(`\n[errstack] 共 ${errs.length} 条错误，${list.length} 组：`);
  for (const g of list.slice(0, 6)) {
    console.log(`  ×${g.count} [${g.kind}] ${g.msg}`);
    console.log(`      ${String(g.sample).slice(0, 260)}`);
  }
  console.log('[errstack] 写出 →', OUT);
  code = 0;
} catch (err) {
  console.error('[errstack] FAILED:', String(err).slice(0, 300));
  code = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
