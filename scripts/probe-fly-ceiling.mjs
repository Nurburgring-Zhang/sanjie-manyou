/**
 * probe-fly-ceiling.mjs —— 飞行相机高度范围真机机检（用户 2026-11-09 反馈修复的验收门）。
 *
 * 【为什么有这个脚本】
 * 用户反馈：「目前镜头飞行到达不了天宫，飞行高度受限了。将镜头飞行高度范围调大一倍。」
 * 根因不是天宫太高，而是 `src/core/engine.ts` 的 fly 模式 clamp 硬编码上限 4000，
 * 而天宫整层被 `HEAVEN_LIFT=3870` 抬到 `HEAVEN_BASE_Y(196)+3870 = 4066`。
 * **上限 4000 比天宫地面还低 66m** —— 摇杆推到底也差一截，永远上不去。
 *
 * 只读代码得出「4000 < 4066」是算术，不是证据。本脚本跑真机，证明两件事：
 *   A. 从旧上限 4000 起持续上升，能**穿过** 4066 进入天宫层（旧墙真的没了）；
 *   B. 继续推到底会被**新上限**夹住，且新上限严格大于天宫基准面（不会飞进虚空）；
 *   C. 下限同样被夹住（不穿透地面），全程 pageErrors === 0。
 *
 * 【为什么断言值不写死】
 * 上限/下限/天宫基准面全部从 `window.__qingming.flyLimits()` 读运行期真值，探针内只保留
 * 「旧上限 4000」这一条历史基线（用于证明「放大一倍」确实发生了）。若 heavenFrame 抬高
 * 而 ceiling 没跟上，A 会立刻红——不会出现「探针自己抄了一份数所以永远绿」。
 *
 * 用法：
 *   PREVIEW_URL=http://127.0.0.1:4188/ node scripts/probe-fly-ceiling.mjs
 *   退出码 0=PASS / 1=FAIL / 2=用法错误
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4188/';
const OUT_DIR = path.resolve('artifacts/spec');
const OUT_JSON = path.join(OUT_DIR, 'fly-ceiling.json');
const OUT_PNG = path.join(OUT_DIR, 'fly-ceiling-heaven.png');

/** 修复前的硬编码上限（engine.ts 历史值）。保留为常量，用于证明「放大一倍」真实发生。 */
const LEGACY_CEILING = 4000;
/** 用户要求：高度范围整体放大一倍。 */
const DOUBLING_FACTOR = 2;

const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});

let result;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming,
    { timeout: 300000 },
  );
  await sleep(1500);

  // ---- 0) 运行期真值（单一真相源，不在探针里复写）----
  const limits = await page.evaluate(() => {
    const q = window.__qingming;
    q.engine.setCamMode('fly');
    return { ...q.flyLimits(), camMode: q.engine.camMode,
      cameraY: q.engine.camera.position.y };
  });

  // ---- A) 旧墙已移除：从 4000 起上升必须越过天宫基准面 ----
  const ascent = await page.evaluate(async (startY) => {
    const e = window.__qingming.engine;
    e.setCamMode('fly');
    e.camera.position.y = startY;
    const y0 = e.camera.position.y;
    e.keys.add('Space'); e.keys.add('ShiftLeft');   // 升 + 加速
    const t0 = performance.now();
    // 最多等 12s，够不够都由真实位置判定，不靠 sleep 猜。
    while (performance.now() - t0 < 12000) {
      await new Promise((r) => setTimeout(r, 120));
      if (e.camera.position.y > window.__qingming.flyLimits().heavenBase + 40) break;
    }
    e.keys.delete('Space'); e.keys.delete('ShiftLeft');
    return { y0, y1: e.camera.position.y, ms: Math.round(performance.now() - t0) };
  }, LEGACY_CEILING);

  // ---- B) 新上限夹住 + C) 新下限夹住 ----
  const clampTest = await page.evaluate(async () => {
    const e = window.__qingming.engine;
    const lim = window.__qingming.flyLimits();
    // 把相机推到远超上限的位置，再触发一次「有位移」的帧让 clamp 分支执行。
    e.camera.position.y = 1e6;
    e.keys.add('Space');
    await new Promise((r) => setTimeout(r, 600));
    e.keys.delete('Space');
    const afterUp = e.camera.position.y;

    e.camera.position.y = -1e6;
    e.keys.add('KeyC');                       // 下降
    await new Promise((r) => setTimeout(r, 600));
    e.keys.delete('KeyC');
    const afterDown = e.camera.position.y;
    return { lim, afterUp, afterDown };
  });

  // ---- 天宫层实景取证（证明相机确实能站在天宫高度并且画面正常）----
  await page.evaluate(() => {
    const q = window.__qingming;
    const e = q.engine;
    e.setCamMode('fly');
    // 天宫基准面之上 140m，站在凌霄宝殿正南侧俯瞰
    e.camera.position.set(0, q.flyLimits().heavenBase + 140, 900);
    e.lookTarget.set(0, q.flyLimits().heavenBase + 60, -400);
  });
  await sleep(1200);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: OUT_PNG });
  const finalY = await page.evaluate(() => window.__qingming.engine.camera.position.y);

  // ---- 判定 ----
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });

  add('A1-legacy-wall-removed',
    limits.ceiling > limits.heavenBase,
    `ceiling=${limits.ceiling} 必须 > heavenBase=${limits.heavenBase}（旧值 ${LEGACY_CEILING} 比天宫低 ${limits.heavenBase - LEGACY_CEILING}m）`);
  add('A2-range-doubled',
    limits.ceiling === LEGACY_CEILING * DOUBLING_FACTOR,
    `ceiling=${limits.ceiling} 应为 ${LEGACY_CEILING} × ${DOUBLING_FACTOR}（用户要求放大一倍）`);
  add('A3-ascent-crosses-heaven',
    ascent.y1 > limits.heavenBase,
    `从 y=${ascent.y0} 上升 ${Math.round(ascent.y1 - ascent.y0)}m → y=${ascent.y1.toFixed(1)}，必须越过 heavenBase=${limits.heavenBase}（耗时 ${ascent.ms}ms）`);
  add('B1-clamped-to-ceiling',
    Math.abs(clampTest.afterUp - limits.ceiling) < 1e-3,
    `推到 1e6 后应被夹到 ${limits.ceiling}，实测 ${clampTest.afterUp}`);
  add('C1-clamped-to-floor',
    Math.abs(clampTest.afterDown - limits.floor) < 1e-3,
    `推到 -1e6 后应被夹到 ${limits.floor}，实测 ${clampTest.afterDown}`);
  add('D1-heaven-view-frame',
    Math.abs(finalY - (limits.heavenBase + 140)) < 260 && fs.existsSync(OUT_PNG) && fs.statSync(OUT_PNG).size > 20000,
    `天宫机位 y=${finalY.toFixed(1)}，截图 ${fs.existsSync(OUT_PNG) ? fs.statSync(OUT_PNG).size + 'B' : '缺失'}`);
  add('E1-no-page-errors', errors.length === 0, `${errors.length} 条 page error`);

  const pass = checks.every((c) => c.ok);
  result = {
    schema: 'fly-ceiling/v1',
    sampledBy: 'scripts/probe-fly-ceiling.mjs',
    url: URL,
    mode: 'real',
    userRequest: '目前镜头飞行到达不了天宫，飞行高度受限了。将镜头飞行高度范围调大一倍。',
    rootCause: `fly 模式 clamp 上限硬编码 ${LEGACY_CEILING}，低于天宫基准面 ${limits.heavenBase}（HEAVEN_BASE_Y+HEAVEN_LIFT），差值 ${limits.heavenBase - LEGACY_CEILING}m`,
    limits,
    ascent,
    clampTest: { afterUp: clampTest.afterUp, afterDown: clampTest.afterDown },
    heavenViewY: finalY,
    screenshot: path.relative(path.resolve('.'), OUT_PNG).split(path.sep).join('/'),
    checks,
    pageErrors: errors,
    gate: pass ? 'PASS' : 'FAIL',
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
} catch (e) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    schema: 'fly-ceiling/v1', mode: 'real', gate: 'FAIL',
    error: String(e && e.stack ? e.stack : e), pageErrors: errors,
  }, null, 2));
  result = { gate: 'FAIL', checks: [], error: String(e && e.message ? e.message : e) };
} finally {
  await browser.close();
}

for (const c of result.checks ?? []) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  ${c.detail}`);
}
if (result.error) console.log(`ERROR  ${result.error}`);
console.log(`FLY_CEILING_GATE=${result.gate}`);
process.exit(result.gate === 'PASS' ? 0 : 1);
