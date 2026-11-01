/**
 * 目标链验证（工作流 G）：目标不只是「脚下最近的点」，而是一条 17 节点的推进链。
 * 断言：
 *  A1 total === 17
 *  A2 初始 done === 0（开场运镜/出生点不误判达成）
 *  A3 初始 next 是链首 yinyanggate，index === 1
 *  A4 传送到 next 并抵达 → done 递增 1，next 换成链上下一个（index === 2）
 *  A5 HUD 常驻行「目标 1/17 · 下一个：紫宸殿」，达成闪字「目标 1/17 达成」且可见
 *  A6 乱序完成（naihe）→ done 仍递增 1，但 next 不倒退（仍是 zichen）
 *  A7 非链节点（bridge）标记 done 不计进度
 *  A8 全链模拟置 done → done === 17、next === null、nextObjective() === null
 *  A9 还原 objectiveDone → 回到 done 2 / next zichen（链可重入）
 * 运行：先 `npx vite dev --port 4201`，再 `node scripts/probe-goalchain.mjs`
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL ?? 'http://localhost:4173/';
const CHROME = process.env.PROBE_CHROME
  ?? '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail: pass ? detail : { ...detail, FAIL: true } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await sleep(1200);

const progress = () => p.evaluate(() => window.__qingming.world.objectiveProgress());
const step = () => p.evaluate(() => {
  const s = window.__qingming.world.nextObjective();
  return s ? { key: s.key, name: s.name, objective: s.objective, index: s.index, total: s.total } : null;
});
const hud = () => p.evaluate(() => {
  const main = document.getElementById('goalMain');
  const flash = document.getElementById('goalFlash');
  return {
    main: main?.textContent ?? '',
    flash: flash?.textContent ?? '',
    flashOpacity: flash ? Number(getComputedStyle(flash).opacity) : -1,
  };
});
const setDone = (key, val) => p.evaluate((k, v) => {
  const w = window.__qingming.world;
  if (v) w.objectiveDone[k] = true; else delete w.objectiveDone[k];
}, key, val);
const waitDone = (n, timeout = 15000) => p.waitForFunction(
  (t) => window.__qingming.world.objectiveProgress().done >= t, { timeout, polling: 100 }, n);

// ---- A1 / A2 / A3：基线 ----
const base = await progress();
const first = await step();
check('A1 total=17', base.total === 17, { progress: base });
check('A2 基线 done=0', base.done === 0, { progress: base });
check(
  'A3 链首=yinyanggate/index=1',
  base.nextKey === 'yinyanggate' && first?.key === 'yinyanggate' && first?.index === 1,
  { progress: base, step: first },
);

// ---- A4：传送到当前 next → 抵达递增，next 前移 ----
await p.evaluate((k) => window.__qingming.world.teleport(k), base.nextKey);
await waitDone(base.done + 1);
const after1 = await progress();
const step2 = await step();
check(
  'A4 抵达后 done+1 且 next 前移',
  after1.done === base.done + 1 && after1.nextKey !== base.nextKey && step2?.index === 2
    && after1.next === step2?.name && after1.nextKey === step2?.key,
  { before: base, after: after1, step2 },
);

// ---- A5：HUD 常驻行 + 达成闪字 ----
await sleep(700);
const hud1 = await hud();
check(
  'A5 HUD 显示 N/17 与下一个',
  hud1.main.includes(`目标 ${after1.done}/${after1.total}`) && hud1.main.includes('下一个：') && hud1.main.includes(after1.next ?? '@'),
  hud1,
);
check(
  'A5b HUD 达成闪字',
  hud1.flash.includes(`目标 ${after1.done}/${after1.total} 达成`) && hud1.flashOpacity > 0.5,
  hud1,
);

// ---- A6：乱序完成不倒退 next ----
await p.evaluate(() => window.__qingming.world.teleport('naihe'));
await waitDone(after1.done + 1);
const after2 = await progress();
check(
  'A6 乱序完成 done+1 且 next 不变',
  after2.done === after1.done + 1 && after2.nextKey === after1.nextKey,
  { before: after1, after: after2 },
);

// ---- A7：非链节点不计进度 ----
await setDone('bridge', true);
const afterBridge = await progress();
check('A7 非链节点不计 done', afterBridge.done === after2.done, { before: after2, after: afterBridge });
await setDone('bridge', false);

// ---- A8：全链置 done → next null ----
const snapshot = await p.evaluate(() => ({ ...window.__qingming.world.objectiveDone }));
let guard = 0;
let sim = await progress();
while (sim.nextKey && guard++ < 40) {
  await setDone(sim.nextKey, true);
  sim = await progress();
}
const endStep = await step();
check(
  'A8 全完成 done=17/next=null',
  sim.done === 17 && sim.total === 17 && sim.next === null && sim.nextKey === null && endStep === null,
  { progress: sim, step: endStep, iterations: guard },
);

// ---- A8b：全完成时 HUD 常驻行应切到「全部达成」，不能留着空的下一个 ----
await sleep(600);
const hudAll = await hud();
check('A8b HUD 显示全部达成', hudAll.main.includes('17/17') && hudAll.main.includes('全部达成'), hudAll);

// ---- A9：还原后链可重入 ----
await p.evaluate((snap) => {
  const w = window.__qingming.world;
  for (const k of Object.keys(w.objectiveDone)) if (!(k in snap)) delete w.objectiveDone[k];
  for (const k of Object.keys(snap)) w.objectiveDone[k] = snap[k];
}, snapshot);
const restored = await progress();
check(
  'A9 还原后 done=2/next=zichen',
  restored.done === after2.done && restored.nextKey === after2.nextKey,
  { progress: restored },
);

// ---- 出图：HUD 实际渲染位置 ----
await sleep(700);
await p.screenshot({ path: 'screenshots/probe-goalchain.png' });

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ ok: failed.length === 0, url: URL, results, hud: await hud() }, null, 1));
await b.close();
process.exit(failed.length === 0 ? 0 : 1);
