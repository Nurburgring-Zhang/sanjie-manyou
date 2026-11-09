/**
 * R26 生产包实机验收：WorkBuddy 能力集成 / Agent 资产流水线 / 8 机位截图验证 / 吞噬体系
 *
 * 只认真实行为，不认「函数存在」：
 *  ① 能力注册表 ≥40 项、14 域、bridge 如实分级，UI 里逐条可查
 *  ② 提示文案逐字匹配「xxx正在生成。。。。请稍后。」/「xxx生成完毕，出现在你面前！」
 *  ③ 真键盘输入「我要一条神龙」→ 热载入在玩家附近 + 生成完毕提示
 *  ④ 8 机位离屏截图验证真的出 8 张图并铺进面板（不是一句验证通过）
 *  ⑤ 未命中内置资产时流水线 8 步全链真实执行，verify 由真实渲染器注入
 *  ⑥ 精细化几何真的进场景（顶点数因本体不同而不同）
 *  ⑦ 吞噬真的改 DNA / XP / 能力 / 外形，猎物真的从场景消失
 *  ⑧ 刷新后造物与吞噬计数仍在
 *  ⑨ pageErrors === 0（硬门禁）
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4183/ node scripts/r26_agent_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4183/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__wish
    && typeof window.__wish.pipeline === 'function' && typeof window.__wish.devour === 'function',
  { timeout: 180000 });
await new Promise((r) => setTimeout(r, 3000));

const report = { at: new Date().toISOString(), url: URL, steps: [], pageErrors: errs };
const shot = async (name) => {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  report.steps.push(p);
  console.log('shot:', p);
};
const step = (k, v) => { report[k] = v; console.log(k + ':', JSON.stringify(v).slice(0, 1100)); };

const setCam = (c) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(c[3], c[4], c[5]);
  const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
};
const shotNear = async (name, id, k = 0.7) => {
  const cam = await page.evaluate((arg) => {
    const w = window.__wish;
    const e = w.entities().find((x) => x.id === arg.eid) ?? w.entities()[0];
    if (!e) return null;
    const p = e.pos;
    return [p.x + 34 * arg.k, p.y + 22 * arg.k, p.z + 40 * arg.k, p.x, p.y + 6 * arg.k, p.z];
  }, { eid: id, k });
  if (!cam) return;
  await page.evaluate(setCam, cam);
  await new Promise((r) => setTimeout(r, 1400));
  await shot(name);
};

// ---- ① 能力注册表 + 能力库 UI ----
report.capabilities = await page.evaluate(() => {
  const w = window.__wish;
  const c = w.capabilities();
  const btn = Array.from(document.querySelectorAll('#wish-panel button')).find((b) => b.textContent.includes('能力库'));
  btn?.click();
  const panel = document.querySelector('#wish-caps');
  return {
    total: c.total,
    byDomain: c.stats.byDomain,
    domainCount: Object.keys(c.stats.byDomain).length,
    byBridge: c.stats.byBridge,
    planCount: w.planCapabilities('构建一件新的中国神话游戏资产').length,
    btnFound: !!btn,
    shown: panel?.classList.contains('show') ?? false,
    details: panel?.querySelectorAll('details').length ?? 0,
    bridgeTags: panel?.querySelectorAll('.cap-bridge').length ?? 0,
    hasOfflineNote: (panel?.textContent ?? '').includes('不能直接执行本机进程'),
    textLength: (panel?.textContent ?? '').length,
  };
});
step('capabilities', report.capabilities);
await shot('r26-agent-01-capabilities');

// ---- ② 提示文案 + 离线资料卡 ----
report.script = await page.evaluate(() => {
  const w = window.__wish;
  const c = w.offlineResearch('夔牛', ['独足', '雷音'], '山海经');
  return {
    notice: w.noticeText('神龙'), done: w.doneText('神龙'),
    cardKeys: Object.keys(c).length,
    cardFilled: Object.values(c).every((v) => Array.isArray(v)
      ? v.length > 0 : (typeof v === 'boolean' ? true : String(v).trim().length > 0)),
    imageRefs: c.imageRefs.length, videoRefs: c.videoRefs.length, sources: c.sources.length,
    devourable: c.devourable, evolve: c.evolve, worldImpact: c.worldImpact.slice(0, 80),
  };
});
step('script', report.script);

// ---- ③ 真键盘输入「我要一条神龙」→ 热载入 ----
await page.evaluate(() => document.querySelector('#wish-caps')?.classList.remove('show'));
await page.evaluate(() => { const i = document.querySelector('#wish-panel-input'); if (i) { i.value = ''; i.focus(); } });
await page.keyboard.type('我要一条神龙', { delay: 40 });
await shot('r26-agent-02-wish-input');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__wish.entities().length > 0, { timeout: 60000 });
report.spawn = await page.evaluate(() => {
  const w = window.__wish;
  const e = w.entities()[w.entities().length - 1];
  const pp = window.__qingming.world.player?.actor?.pos ?? null;
  return {
    entity: e,
    nearMeters: e && pp ? Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z) : null,
    basis: pp ? 'player.actor.pos' : 'camera(fallback)',
    status: document.querySelector('#wish-status')?.textContent ?? '',
    pipelineVisible: (document.querySelector('#wish-pipeline')?.textContent ?? '').length,
    pipelineText: (document.querySelector('#wish-pipeline')?.textContent ?? '').slice(0, 700),
    verifyImgs: document.querySelectorAll('#wish-verify img').length,
    loreVisible: document.querySelector('#wish-lore')?.classList.contains('show') ?? false,
  };
});
step('spawn', report.spawn);
await shot('r26-agent-03-hotload');

// ---- ④ 8 机位截图验证报告 ----
report.validation = await page.evaluate(() => {
  const w = window.__wish;
  const v = w.validation();
  return v ? {
    ok: v.ok, views: v.views, passed: v.passed, total: v.total,
    shots: v.shots.length, bounds: v.bounds, note: v.note,
    firstShotPrefix: (v.shots[0] ?? '').slice(0, 22),
    details: v.details.map((d) => ({ id: d.id, label: d.label, pass: d.pass, coverage: d.coverage, colorBuckets: d.colorBuckets })),
  } : null;
});
step('validation', report.validation);
await shot('r26-agent-04-validation');

// ---- ⑤ 未命中内置资产：完整 8 步流水线 ----
report.pipeline = await page.evaluate(async () => {
  const w = window.__wish;
  const r = await w.spawn('九霄琉璃星麟兽');
  const p = w.pipeline();
  return {
    spawned: r?.ok ?? false,
    reused: p?.reused ?? null,
    ok: p?.ok ?? null,
    stages: p?.steps.map((s) => s.stage) ?? [],
    details: p?.steps.map((s) => ({ stage: s.stage, ok: s.ok, detail: s.detail.slice(0, 110) })) ?? [],
    researchFields: p?.research ? Object.keys(p.research).length : 0,
    researchOffline: p?.research?.offline ?? null,
    designParts: p?.design?.parts.length ?? 0,
    capabilities: p?.capabilities.length ?? 0,
    notice: p?.notice ?? '', doneNotice: p?.doneNotice ?? '',
    verifyNote: p?.verifyNote ?? '',
    submitSteps: r?.pipelineSteps ?? [],
    submitValidation: r?.validation ?? null,
    submitReused: r?.reused ?? null,
    domText: (document.querySelector('#wish-pipeline')?.textContent ?? '').slice(0, 800),
    domLength: (document.querySelector('#wish-pipeline')?.textContent ?? '').length,
  };
});
step('pipeline', report.pipeline);
await shot('r26-agent-05-pipeline');

// ---- ⑥ 精细化几何真的进场景 ----
await page.evaluate(() => {
  const w = window.__wish;
  // 补几件不同原型的预设，确保几何差异断言有足够样本
  for (const nm of ['哪吒', '九色鹿', '凌霄宝殿', '风火轮', '九尾狐']) w.spawnByName(nm);
});
report.geometry = await page.evaluate(() => {
  const w = window.__wish;
  return Array.from(w.panel.entityMap.values()).slice(0, 8).map((e) => ({
    name: e.name, archetype: e.spec.archetype,
    verts: e.group.children[0]?.geometry?.getAttribute('position')?.count ?? 0,
    traits: e.spec.traits.length, colors: e.spec.colors.length,
  }));
});
step('geometry', report.geometry);

// ---- ⑦ 吞噬：DNA / XP / 能力 / 外形 / 猎物消失 ----
report.devour = await page.evaluate(() => {
  const w = window.__wish;
  let a = w.spawnByName('应龙'), b = w.spawnByName('穷奇');
  const ids = w.entities().filter((e) => !e.hostile).map((e) => e.id);
  if (!a || !b) { a = ids[0] ?? null; b = ids[1] ?? null; }
  if (!a || !b || a === b) return { error: '需要两件不同造物', ids };
  const snap = () => {
    const e = w.panel.entityMap.get(a);
    return {
      xp: e.ev.xp, dna: { ...e.ev.dna }, abilities: [...e.ev.abilities],
      devoured: e.ev.devoured ?? 0,
      verts: e.group.children[0]?.geometry?.getAttribute('position')?.count ?? 0,
      form: { ...e.ev.form }, lineage: e.ev.lineage,
    };
  };
  const before = snap();
  const r = w.devour(a, b);
  const after = snap();
  return {
    predator: a, prey: b, ok: r?.ok ?? false, reason: r?.reason ?? null,
    absorbed: r?.absorbed ?? null,
    before, after,
    preyGone: !w.entities().some((e) => e.id === b),
    devourCount: w.devourCount(),
    status: document.querySelector('#wish-status')?.textContent ?? '',
    entitiesAfter: w.entities().length,
  };
});
step('devour', report.devour);
await shot('r26-agent-06-devour');

// ---- 神龙近景（用户原话的资产真的出现在玩家附近）----
const dragonId = await page.evaluate(() => window.__wish.entities().find((e) => e.name.includes('神龙'))?.id ?? null);
if (dragonId) {
  await page.evaluate((id) => window.__wish.interact(id, '孵化'), dragonId);
  await shotNear('r26-agent-07-dragon-close', dragonId, 0.62);
}

// ---- 元素级证据：8 机位缩略图网格 / 流水线卡片（不受面板滚动位置影响）----
for (const [sel, name] of [
  ['#wish-verify', 'r26-agent-09-verify-grid'],
  ['#wish-pipeline', 'r26-agent-10-pipeline-card'],
]) {
  const el = await page.$(sel);
  if (el) {
    const p = `${OUT}/${name}.png`;
    try { await el.screenshot({ path: p }); report.steps.push(p); console.log('shot:', p); }
    catch (e) { console.log('element shot failed', sel, String(e)); }
  }
}

// ---- ⑧ 刷新存档：造物与吞噬计数仍在 ----
const beforeReload = await page.evaluate(() => {
  window.__wish.saveState();
  return { entities: window.__wish.entities().length, devoured: window.__wish.entities().reduce((n, e) => n + (e.devoured ?? 0), 0) };
});
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__wish, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2500));
report.persistence = await page.evaluate(() => ({
  entities: window.__wish.entities().length,
  devoured: window.__wish.entities().reduce((n, e) => n + (e.devoured ?? 0), 0),
  blueprints: window.__wish.blueprints().length,
  buildParts: window.__wish.buildParts().length,
}));
report.persistence.beforeReload = beforeReload;
step('persistence', report.persistence);
await shot('r26-agent-08-reload');

// ---- 硬门禁与结论 ----
report.pageErrors = errs;
const caps = report.capabilities, sc = report.script, sp = report.spawn;
const v = report.validation, pl = report.pipeline, dv = report.devour, pv = report.persistence;
const FULL_CHAIN = ['lookup', 'notice', 'research', 'design', 'build', 'verify', 'hotload', 'done'];
report.pass = {
  capabilityRegistry: caps.total >= 40 && caps.domainCount >= 10
    && caps.byBridge['offline'] > 0 && caps.byBridge['in-browser'] > 0,
  capabilityUI: caps.btnFound && caps.shown && caps.details >= 10
    && caps.bridgeTags >= 40 && caps.hasOfflineNote,
  noticeWording: sc.notice === '神龙正在生成。。。。请稍后。' && sc.done === '神龙生成完毕，出现在你面前！',
  researchCard: sc.cardKeys >= 20 && sc.cardFilled && sc.imageRefs > 0 && sc.videoRefs > 0,
  wishHotloaded: sp.entity?.name?.includes('神龙') === true
    && sp.status.includes('生成完毕，出现在你面前！')
    && (sp.nearMeters ?? Infinity) < 40 && sp.basis === 'player.actor.pos',
  validation8Views: !!v && v.views === 8 && v.passed >= 6 && v.shots === 8
    && sp.verifyImgs === 8 && v.firstShotPrefix.startsWith('data:image/png'),
  pipelineVisible: sp.pipelineVisible > 200 && sp.pipelineText.includes('内置资产命中')
    && sp.pipelineText.includes('直接复用') && sp.loreVisible,
  pipelineFullChain: pl.spawned && pl.reused === false && pl.ok === true
    && JSON.stringify(pl.stages) === JSON.stringify(FULL_CHAIN)
    && pl.researchFields >= 20 && pl.designParts > 0 && pl.capabilities > 0,
  pipelineResearchCard: pl.domLength > 400 && pl.domText.includes('检索与设计') && pl.domText.includes('详细设计'),
  pipelineVerifyInjected: pl.verifyNote.includes('机位') && (pl.submitValidation?.total ?? 0) === 8,
  doneWording: pl.doneNotice.includes('生成完毕，出现在你面前！') && pl.notice.includes('正在生成'),
  geometryRefined: report.geometry.length >= 3
    && report.geometry.every((g) => g.verts > 0)
    && new Set(report.geometry.map((g) => g.verts)).size > 1,
  devourReal: dv.ok === true && dv.preyGone === true
    && dv.after.xp > dv.before.xp && dv.after.devoured > dv.before.devoured
    && dv.devourCount >= 1 && (dv.absorbed?.abilities ?? []).includes('吞噬'),
  persistence: pv.entities > 0 && pv.devoured >= 1,
  noPageErrors: errs.length === 0,
};
report.pass.all = Object.values(report.pass).every(Boolean);
fs.writeFileSync(`${OUT}/r26-agent-runtime.json`, JSON.stringify(report, null, 2));
console.log('\nPASS:', JSON.stringify(report.pass, null, 2));
console.log('pageErrors:', JSON.stringify(errs));
await browser.close();
if (!report.pass.all) process.exitCode = 1;
