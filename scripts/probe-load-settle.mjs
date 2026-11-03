/**
 * probe-load-settle.mjs — 合批前 settle 的载入代价实测（改前 / 改后同一把尺）
 *
 * 背景：world.generate() 在跑完 33 个生成步之后、compactStatic 之前，曾无条件执行
 *   await Promise.all([idle(800), sleep(400)])      // 取慢者 ⇒ 硬下界 400ms
 * 这段落在 __loadStartAt..__loadEndAt 之间，即整段计入 engineMs。它存在的唯一理由是让
 * __heapPre 的读数稳定（等 idle GC 结算），属于测量仪器，不该由生产载入付费。
 *
 * 本探针对照两档：
 *   off —— 不带 ?heapAudit：生产路径，完全跳过 idle/sleep，__heapPre 写 -1（未测量）
 *   on  —— 带 ?heapAudit=1：堆归因路径，保留 settle，__heapPre 有效
 *
 * 断言：
 *   A1  median(engineMs_off) ≤ median(engineMs_on) - 300ms
 *   A2  on 档每轮 __heapAuditOn=true、__heapPre>0、settleMs≥390
 *   A3  off 档每轮 __heapAuditOn=false、__heapPre=-1、settleMs=0
 *   A4  两档 staticTris 完全一致（纯时序改动，几何产出必须不变）
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-load-settle.mjs [--runs 2] [--json out.json]
 * 退出码：0=全过 1=断言失败 2=用法/环境错误
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

const RUNS = Number(argOf('--runs', '2'));
const BASE = process.env.PREVIEW_URL || argOf('--url', 'http://127.0.0.1:4180/');
const JSON_OUT = argOf('--json', '');

if (!Number.isFinite(RUNS) || RUNS < 1) {
  console.error('用法：node scripts/probe-load-settle.mjs [--runs 2] [--json out.json]');
  process.exit(2);
}

const withAudit = (on) => {
  const u = new URL(BASE);
  if (on) u.searchParams.set('heapAudit', '1');
  else u.searchParams.delete('heapAudit');
  return u.toString();
};

const one = async (audit, runIdx) => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      '--window-size=1200,700',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 700 });
    const url = withAudit(audit);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(
      () => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit,
      { timeout: 300000, polling: 200 },
    );
    // 生成结束即取值；settle / compactStatic 都已经在 __loadEndAt 之前结算完毕。
    const data = await page.evaluate(() => {
      const w = window;
      const audit = w.__qingming?.world?.assetAudit;
      let staticTris = 0;
      if (audit && audit.groups) {
        for (const k of Object.keys(audit.groups)) staticTris += audit.groups[k].triangles;
      }
      return {
        engineMs: Math.round((w.__loadEndAt ?? 0) - (w.__loadStartAt ?? 0)),
        navToEngineMs: Math.round(w.__loadStartAt ?? 0),
        settleMs: Math.round(w.__settleMs ?? 0),
        heapPre: typeof w.__heapPre === 'number' ? w.__heapPre : null,
        heapPost: typeof w.__heapPost === 'number' ? w.__heapPost : null,
        heapAuditOn: w.__heapAuditOn === true,
        staticTris: Math.round(staticTris),
        flushMs: Math.round(w.__flushMs ?? 0),
      };
    });
    return { mode: audit ? 'on' : 'off', run: runIdx, url, ...data };
  } finally {
    await browser.close();
  }
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const runs = { off: [], on: [] };
for (let i = 0; i < RUNS; i++) {
  for (const mode of ['off', 'on']) {
    const r = await one(mode === 'on', i + 1);
    runs[mode].push(r);
    console.log(
      `[${mode} run ${i + 1}] engineMs=${r.engineMs} navToEngine=${r.navToEngineMs} ` +
        `settleMs=${r.settleMs} heapPre=${r.heapPre} staticTris=${r.staticTris} flush=${r.flushMs}ms`,
    );
  }
}

const offMs = runs.off.map((r) => r.engineMs);
const onMs = runs.on.map((r) => r.engineMs);
const medOff = median(offMs);
const medOn = median(onMs);
const delta = medOn - medOff;

const fails = [];
if (!(medOff <= medOn - 300)) {
  fails.push(`A1 engineMs 降幅不足：median(off)=${medOff} median(on)=${medOn} delta=${delta}（要求 ≥300ms）`);
}
for (const r of runs.on) {
  if (!r.heapAuditOn) fails.push(`A2 on 档第 ${r.run} 轮 __heapAuditOn 非 true`);
  if (!(r.heapPre > 0)) fails.push(`A2 on 档第 ${r.run} 轮 __heapPre 无效（${r.heapPre}）`);
  if (!(r.settleMs >= 390)) fails.push(`A2 on 档第 ${r.run} 轮 settleMs=${r.settleMs}，settle 未真正执行`);
}
for (const r of runs.off) {
  if (r.heapAuditOn) fails.push(`A3 off 档第 ${r.run} 轮 __heapAuditOn 非 false`);
  if (r.heapPre !== -1) fails.push(`A3 off 档第 ${r.run} 轮 __heapPre=${r.heapPre}，应为 -1`);
  if (r.settleMs !== 0) fails.push(`A3 off 档第 ${r.run} 轮 settleMs=${r.settleMs}，应完全跳过`);
}
const tris = new Set([...runs.off, ...runs.on].map((r) => r.staticTris));
if (tris.size !== 1) fails.push(`A4 staticTris 前后不一致：${[...tris].join(' / ')}`);

console.log('');
console.log(`engineMs  off=[${offMs.join(', ')}] median=${medOff}`);
console.log(`engineMs  on =[${onMs.join(', ')}] median=${medOn}`);
console.log(`DELTA median(on)-median(off) = ${delta}ms（要求 ≥300ms）`);
console.log(`STATIC TRIS (off/on) = ${runs.off[0].staticTris} / ${runs.on[0].staticTris}`);
console.log(`heapPre  off=[${runs.off.map((r) => r.heapPre).join(', ')}] on=[${runs.on.map((r) => r.heapPre).join(', ')}]`);

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, runs, medOff, medOn, delta, fails }, null, 2));

if (fails.length) {
  console.error('\nFAIL:');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nPASS: settle 只在 ?heapAudit=1 下执行，生产载入省下 ≥300ms，几何产出不变。');
