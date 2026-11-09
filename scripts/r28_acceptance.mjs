/**
 * R28 生产包实机验收：只认运行期真实行为，不认源码/台账汇报。
 *
 * 覆盖用户三组质问：
 *  ① 八类自然语言愿望能否真生成所求对象 / 内置资产是否直接复用 / 未命中是否真联网检索并设计生成
 *  ② 山上建筑比例 + 山上建筑内部陈设 + 全城所有店铺行业经营用品
 *  ③ 渲染降负载技术是否真实启用、中近景画质是否被保护、VRS/DVS 是否如实标注
 * 外加 R27 碰撞回归（embedded / sunken 必须仍为 0）。
 *
 * 用法： PREVIEW_URL=http://127.0.0.1:4186/ node scripts/r28_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4186/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const WISHES = [
  { text: '我要一只猫', shape: 'cat', min: 1 },
  { text: '我要一座皇宫', shape: 'palace', min: 1 },
  { text: '我要一座山', shape: 'mountain', min: 1 },
  { text: '我要一支军队', shape: 'army', min: 12 },
  { text: '我要天兵天将', shape: 'battalion', min: 12 },
  { text: '我要特斯拉汽车', shape: 'car', min: 1 },
  { text: '我要宇宙飞船', shape: 'spaceship', min: 1 },
  { text: '我要外星人', shape: 'alien', min: 1 },
];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 200)); });

// 真联网链路：拦截真实搜索端点，返回 Brave 风格 JSON。fetch 真的发出、响应真的被解析、
// 字段真的进 design —— 只是外网端点由本地 mock 应答（如实记入报告）。
const researchHits = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('api.search.brave.com') || u.includes('r28-mock-search')) {
    researchHits.push(req.method() + ' ' + u);
    // 搜索 API 带 apiKey 自定义头 → 浏览器会先发 OPTIONS 预检；必须正确应答，
    // 否则 fetch 会报 CORS（与 CSP 无关），联网链路就无法被真实验证。
    if (req.method() === 'OPTIONS') {
      req.respond({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
      return;
    }
    req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        web: { results: [
          { title: '家猫 体型 形态 特征', description: '家猫体长约 46 厘米，四肢短，瞳孔竖立，被毛短而密；善攀爬与夜行。', url: 'https://example.org/cat' },
          { title: '猫 结构 与 用途 参考', description: '骨架轻巧、尾长平衡；与人类共居捕鼠，可作伴侣动物。', url: 'https://example.org/cat2', image: 'https://example.org/cat.jpg' },
          { title: '猫 视频 行为参考', description: '行走、奔跑、跳跃的行为参考。', url: 'https://example.org/cat3', video: 'https://example.org/cat.mp4' },
        ] },
      }),
    });
  } else req.continue();
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__wish
    && typeof window.__perfBudget === 'function'
    && window.__qingming.world.crowd.settleStats?.().done === true,
  { timeout: 240000 });
await new Promise((r) => setTimeout(r, 2500));

const report = { at: new Date().toISOString(), url: URL, pageErrors: errs, shots: [] };
const step = (k, v) => { report[k] = v; console.log(k + ':', JSON.stringify(v).slice(0, 1000)); };
const shot = async (name) => {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  report.shots.push(p);
};
const setCam = (p, c) => page.evaluate(({ p, c }) => {
  const e = window.__qingming.engine;
  if (e.stopCinema) e.stopCinema();
  e.camera.position.set(p[0], p[1], p[2]);
  e.lookTarget.set(c[0], c[1], c[2]);
  const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
}, { p, c });

// ---- ① 台账：全城店铺行业经营用品 100% 覆盖 + 山上建筑内部陈设 ----
const ledger = await page.evaluate(() => {
  const d = window.__qingming.world.assetAudit?.detail ?? {};
  const keys = Object.keys(d).filter((k) => k.startsWith('shopint.') || k.startsWith('mt.') || k.startsWith('mtn.'));
  const pick = {};
  for (const k of keys) pick[k] = d[k];
  return { pick, totalDetailKeys: Object.keys(d).length };
});
step('assetLedger', ledger);

// ---- ② 性能技术：保护开关 / 分区剔除 / 阴影缓存 / 池稳态 ----
const perf0 = await page.evaluate(() => ({ budget: window.__perfBudget?.() ?? null, perf: window.__perf?.() ?? null }));
await new Promise((r) => setTimeout(r, 2200));
const perf1 = await page.evaluate(() => ({ budget: window.__perfBudget?.() ?? null, perf: window.__perf?.() ?? null }));
step('perfBudget', { before: perf0.budget, after: perf1.budget, perfCalls: perf1.perf?.calls ?? null, perfTris: perf1.perf?.tris ?? null });

// ---- ③ 八类真实愿望（默认离线：如实标注 bridge=offline） ----
const wishes = [];
for (const w of WISHES) {
  const r = await page.evaluate(async (text) => {
    const out = await window.__wish.panel.submit(text);
    return {
      ok: out.ok, tier: out.tier, count: out.count, reused: !!out.reused,
      spawned: (out.spawned ?? []).length, validation: out.validation ?? null,
      steps: out.pipelineSteps ?? [], metrics: window.__wishStats?.() ?? null,
    };
  }, w.text);
  wishes.push({ text: w.text, expectShape: w.shape, min: w.min, ...r });
}
step('wishes8', wishes);

// 拍愿望产物：把相机放到玩家前方看落场实体
await page.evaluate(() => {
  const w = window.__qingming.world;
  const p = w.player?.actor?.pos;
  if (p) window.__r28Player = { x: p.x, y: p.y, z: p.z };
});
const pp = await page.evaluate(() => window.__r28Player ?? null);
if (pp) {
  await setCam([pp.x + 14, pp.y + 7, pp.z + 16], [pp.x, pp.y + 1.5, pp.z]);
  await new Promise((r) => setTimeout(r, 900));
  await shot('r28-01-wish-generated');
}

// ---- ④ 内置资产直接复用（reuse 快路径） ----
const reuse = await page.evaluate(async () => {
  const out = await window.__wish.panel.submit('我要一条神龙');
  return { ok: out.ok, count: out.count, reused: !!out.reused, steps: out.pipelineSteps ?? [], metrics: window.__wishStats?.() ?? null };
});
step('reusePath', reuse);

// ---- ⑤ 真联网检索：配置 localStorage 后重新许愿，fetch 真发、响应真解析、结果进设计 ----
await page.evaluate(() => {
  localStorage.setItem('cyber-qingming.research.v1', JSON.stringify({
    enabled: true, provider: 'brave', apiKey: 'r28-acceptance-test',
    endpoint: 'https://api.search.brave.com/res/v1/web/search?q={q}',
  }));
});
const online = await page.evaluate(async () => {
  const out = await window.__wish.panel.submit('我要一只猫');
  const p = window.__wish.panel.pipeline?.() ?? null;
  return { ok: out.ok, count: out.count, steps: out.pipelineSteps ?? [],
    metrics: window.__wishStats?.() ?? null, pipeline: p };
});
step('onlineResearch', { ...online, researchHits });
await page.evaluate(() => { localStorage.removeItem('cyber-qingming.research.v1'); });

// ---- ⑥ 视觉证据：商业街 / 山顶主庙 ----
await setCam([200, 4, 42], [200, 9, 98]);
await new Promise((r) => setTimeout(r, 1000));
await shot('r28-02-shop-street');
await setCam([14120, 3230, -5560], [14000, 3120, -6000]);
await new Promise((r) => setTimeout(r, 1200));
await shot('r28-03-mountain-temple');

// ---- ⑦ R27 回归 ----
const regression = await page.evaluate(() => ({
  collision: window.__qingming.world.crowd.collisionAudit(),
  solids: window.__qingming.solids?.() ?? null,
  destruction: window.__qingming.destruction?.() ?? null,
}));
step('r27Regression', regression);

// ---- 硬门禁 ----
const D = ledger.pick;
const srcs = ['autoPlot', 'imperialFront', 'imperialBack'];
const shopAll = D['shopint.shopAll'] ?? 0;
const shopStocked = D['shopint.shopStocked'] ?? 0;
const srcCovered = srcs.every((s) => {
  const a = D[`shopint.src.${s}.all`] ?? 0;
  const b = D[`shopint.src.${s}.stocked`] ?? 0;
  return a > 0 && a === b;
});
const mtItems = D['mt.interior.items'] ?? 0;
const mtBuildings = D['mt.interior.building'] ?? 0;
const B = perf1.budget ?? {};
const P = {
  shopFullCoverage: shopAll > 2894 && shopAll === shopStocked,
  shopSourcesCovered: srcCovered,
  mountainInteriors: mtBuildings > 0 && mtItems > 0,
  mountainLandmarks: (D['mtn.landmark.count'] ?? 0) > 0,
  wishesEightOk: wishes.length === 8 && wishes.every((w) => w.ok && w.count >= w.min),
  wishesSemantic: wishes.every((w) => w.metrics?.shape === w.expectShape),
  wishesHonestOffline: wishes.every((w) => w.metrics?.researchBridge === 'offline'),
  pluralArmy: wishes.filter((w) => w.expectShape === 'army' || w.expectShape === 'battalion')
    .every((w) => w.count >= w.min),
  reuseFastPath: reuse.ok === true && reuse.reused === true,
  realOnlineResearch: researchHits.length > 0
    && online.metrics?.researchBridge === 'online'
    && online.metrics?.researchStatus === 'ok'
    && online.metrics?.designUsedResearch === true,
  perfBudgetExposed: !!B.protection && !!B.chunkGate && !!B.shadow && !!B.pools,
  nearQualityProtected: !!B.protection && Object.entries(B.protection)
    .filter(([k]) => k !== 'note' && k !== 'nearGuardM')
    .every(([, v]) => v === true),
  chunkCullingActive: (B.chunkGate?.culledFarObjects ?? 0) > 0
    && (B.chunkGate?.nearProtectedObjects ?? 0) > 0,
  shadowCached: (B.shadow?.skippedFrames ?? 0) > (perf0.budget?.shadow?.skippedFrames ?? 0),
  poolUploadSplit: (B.pools?.colorUploads ?? 0) <= (B.pools?.matrixUploads ?? 0),
  vrsDvsHonest: B.vrs?.implemented === false && B.dvs?.implemented === false
    && B.worker?.wired === false && B.halfResPost?.implemented === false,
  r27NoEmbedded: regression.collision.embedded === 0,
  r27NoSunken: regression.collision.sunken === 0,
  noPageErrors: errs.length === 0,
};
P.all = Object.values(P).every(Boolean);
step('PASS', P);

fs.writeFileSync(`${OUT}/r28-runtime.json`, JSON.stringify(report, null, 2));
console.log('report:', `${OUT}/r28-runtime.json`);
await browser.close();
if (!P.all) process.exitCode = 2;
