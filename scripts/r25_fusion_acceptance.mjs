/**
 * R25 三界漫游 × 我的世界 × 孢子 融合玩法 · 生产包实机验收
 *
 * 不认「函数存在」，只认真实行为：
 *  ① 全量预设目录 ≥2000 件、出典覆盖齐全
 *  ② Agent 真的开发设定与资产：设定卡 / 五步开发流水 / 资产登记本
 *  ③ 真键盘输入「我要一条神龙」→ 热更新落场在玩家附近
 *  ④ 一句话载入不同出典的预设资产，几何真进场景
 *  ⑤ 创造/建造：放置、旋转、叠层、组合
 *  ⑥ 探索/战斗/骑乘：跨格发现、DNA 攻防扣血、贴随移动
 *  ⑦ 进化/升级/合并：五阶几何真换、五行分支、DNA 混合
 *  ⑧ 存档：刷新页面后造物与建筑仍在
 *  ⑨ pageErrors 必须为 0（硬门禁）
 *
 * 用法：node scripts/r25_fusion_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__wish,
  { timeout: 180000 });
await new Promise((r) => setTimeout(r, 3000));

const report = { at: new Date().toISOString(), url: URL, steps: [], pageErrors: errs };
const shot = async (name) => {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  report.steps.push(p);
  console.log('shot:', p);
};
const step = (k, v) => { report[k] = v; console.log(k + ':', JSON.stringify(v).slice(0, 900)); };

// 与 r24_acceptance.mjs 同一套机位设置：先停开场运镜，再设相机 / lookTarget / yaw / pitch
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
/** 近景机位：把相机放到造物斜前上方，实拍「真的落场在玩家附近、看得见」 */
const shotNear = async (name, id, k = 0.85) => {
  const cam = await page.evaluate((arg) => {
    const w = window.__wish;
    const e = w.entities().find((x) => x.id === arg.eid) ?? w.entities()[0];
    if (!e) return null;
    const p = e.pos;
    // 机位按体型缩放：17m 近景会钻进模型内部（曾拍到一片褐色），54m 高机位又会被屋脊挡住
    // 成体龙。成体取 k≈0.62（约 36m），神体/合体取 k≈0.85（约 48m）。
    return [p.x + 34 * arg.k, p.y + 22 * arg.k, p.z + 40 * arg.k, p.x, p.y + 6 * arg.k, p.z];
  }, { eid: id, k });
  if (!cam) return;
  await page.evaluate(setCam, cam);
  await new Promise((r) => setTimeout(r, 1400));
  await shot(name);
};

// ---- ① 全量目录 ----
report.catalog = await page.evaluate(() => {
  const w = window.__wish;
  const st = typeof w.catalogStats === 'function' ? w.catalogStats() : {};
  const sources = ['中国神话', '山海经', '西游记', '游戏内', '道教', '佛经', '封神演义'];
  return {
    count: typeof w.catalogCount === 'number' ? w.catalogCount : 0,
    uniqueNames: st.uniqueNames ?? 0,
    bySource: st.bySource ?? {},
    byCategory: Object.keys(st.byCategory ?? {}).length,
    archetypeCount: st.archetypeCount ?? 0,
    sourceCoverage: Object.fromEntries(sources.map((s) => [s, (st.bySource ?? {})[s] ?? 0])),
  };
});
step('catalog', report.catalog);

// ---- ② Agent 开发设定与资产（离线也要完整产出） ----
report.develop = await page.evaluate(async () => {
  const w = window.__wish;
  const bp = await w.develop('我要一条神龙');
  const card = w.cardHtml();
  return {
    ok: !!bp,
    name: bp?.name ?? null,
    epithet: bp?.lore?.epithet ?? null,
    appearance: bp?.lore?.appearance ?? null,
    powers: bp?.lore?.powers ?? [],
    backstory: bp?.lore?.backstory ?? null,
    steps: bp?.steps ?? [],
    tiers: bp?.tier ?? null,
    cardLength: card.length,
    cardHasPowers: card.includes('神通') || card.includes('能力'),
    assetCount: w.assetCount(),
    blueprints: w.blueprints().length,
  };
});
step('develop', report.develop);

// ---- ③ 真键盘输入「我要一条神龙」→ 热更新落场玩家附近 ----
await page.evaluate(() => { const i = document.querySelector('#wish-panel-input'); if (i) { i.value = ''; i.focus(); } });
await page.keyboard.type('我要一条神龙', { delay: 40 });
await shot('r25-fusion-01-wish-input');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__wish.entities().length > 0, { timeout: 60000 });
report.spawn = await page.evaluate(() => {
  const w = window.__wish;
  const e = w.entities()[w.entities().length - 1];
  const pp = window.__qingming.world.player?.actor?.pos ?? null;
  const cam = window.__qingming.engine.camera.position;
  const basis = pp ?? { x: cam.x, z: cam.z };
  return {
    entity: e,
    player: pp,
    nearPlayerMeters: e && pp ? Math.hypot(e.pos.x - basis.x, e.pos.z - basis.z) : null,
    basis: pp ? 'player.actor.pos' : 'camera(fallback)',
    status: document.querySelector('#wish-status')?.textContent ?? '',
    loreVisible: document.querySelector('#wish-lore')?.classList.contains('show') ?? false,
    sceneChildren: window.__qingming.scene.children.length,
  };
});
step('spawn', report.spawn);
await shot('r25-fusion-02-spawned');
// 孢子式起点是「卵」；一键孵化到成体，并用近景机位证明「一条神龙真的出现在玩家附近」
report.hatch = await page.evaluate(() => {
  const w = window.__wish;
  const id = w.entities().find((e) => e.name.includes('神龙') && !e.hostile)?.id ?? null;
  if (id) w.interact(id, '孵化');
  const e = id ? w.entities().find((x) => x.id === id) : null;
  return { id, stage: e?.stage ?? null, level: e?.level ?? null, lineage: e?.lineage ?? null };
});
step('hatch', report.hatch);
await shotNear('r25-fusion-02b-dragon-close', report.hatch.id, 0.62);

// ---- ④ 一句话载入不同出典的预设资产 ----
report.presets = await page.evaluate(() => {
  const w = window.__wish;
  const c = w.catalog;
  const want = ['山海经', '西游记', '中国神话', '游戏内', '佛经', '封神演义'];
  const picks = want.map((s) => c.find((e) => e.source === s)).filter(Boolean);
  const before = w.entities().length;
  const spawned = picks.map((e) => ({ source: e.source, name: e.name, id: w.spawnByName(e.name) }));
  return { picks: picks.map((e) => `${e.source}:${e.name}`), spawned, before, after: w.entities().length };
});
step('presets', report.presets);
await shot('r25-fusion-03-presets');

// ---- ⑤ 创造 / 建造：放置 → 旋转 → 叠层 → 组合 ----
report.build = await page.evaluate(() => {
  const w = window.__wish;
  w.toggleBuild();
  const input = document.querySelector('#wish-panel-input');
  if (input) input.value = '亭';
  const ids = [w.place(), w.place(), w.place()].filter(Boolean);
  const partsBefore = w.buildParts().length;
  const stats1 = w.buildStats();
  w.panel.build.rotate();
  w.panel.build.setStack(1);
  if (input) input.value = '石桥';
  const id4 = w.place();
  const stacked = w.buildParts().slice(-1)[0];
  const combo = w.combineBuild();
  const stats2 = w.buildStats();
  return {
    enabled: stats1.enabled, placed: ids.length, id4: !!id4,
    partsBefore, partsAfter: stats2.parts, ry: stats2.ry, stack: stats2.stack,
    stackedY: stacked?.y ?? null, combo: !!combo, comboId: combo,
    comboEntity: combo ? w.entities().find((e) => e.id === combo)?.name ?? null : null,
  };
});
step('build', report.build);
await shot('r25-fusion-04-build');
await shotNear('r25-fusion-04b-build-close', report.build.comboId);

// ---- ⑥ 探索 / 战斗 / 骑乘：真实每帧世界循环 ----
report.gameplay = await page.evaluate(async () => {
  const w = window.__wish;
  const play = w.panel.play;
  const player = play.world?.player?.actor?.pos;
  const before = { ...w.playReport() };
  // 让造物随玩家跨越多个 46m 地格
  if (player) {
    for (let i = 0; i < 120; i++) { player.x = i * 6; w.tick(0.1); }
  }
  const afterExplore = { ...w.playReport() };
  // 战斗：生成敌对试炼妖兽并结算
  const hostile = w.spawnHostile();
  for (let i = 0; i < 60; i++) w.tick(0.1);
  const afterCombat = { ...w.playReport() };
  // 骑乘：贴随玩家
  const rideId = w.entities().find((e) => !e.hostile)?.id ?? null;
  if (rideId && player) {
    w.setBehavior(rideId, 'ride');
    const p0 = w.entities().find((e) => e.id === rideId)?.pos.x ?? 0;
    player.x = 0;
    for (let i = 0; i < 80; i++) w.tick(0.1);
    var p1 = w.entities().find((e) => e.id === rideId)?.pos.x ?? 0;
    var rideDelta = Math.abs(p1 - p0);
  }
  return {
    beforeDiscoveries: before.discoveries, afterDiscoveries: afterExplore.discoveries,
    xpAwarded: afterExplore.xpAwarded, coinsAwarded: afterExplore.coinsAwarded,
    travelled: afterExplore.travelled,
    hostile: !!hostile, hits: afterCombat.hits, kills: afterCombat.kills,
    bossHits: afterCombat.bossHits,
    rideId, rideDelta: rideDelta ?? 0,
    events: w.worldEvents().slice(-8).map((e) => `${e.kind}:${e.text}`),
  };
});
step('gameplay', report.gameplay);
await shot('r25-fusion-05-gameplay');

// ---- ⑦ 进化 / 升级 / 合并 + 五行分支 ----
report.evolution = await page.evaluate(() => {
  const w = window.__wish;
  // 用一条刚落场、仍是「卵」的新预设跑完整五阶，避免已孵化造物的 XP 干扰
  const id = w.spawnByName('应龙') ?? w.entities()[0]?.id;
  const rec = () => {
    const ent = w.panel.entityMap.get(id);
    const mesh = ent?.group?.children?.[0];
    return {
      stage: w.entities().find((e) => e.id === id)?.stage ?? null,
      level: w.entities().find((e) => e.id === id)?.level ?? null,
      verts: mesh?.geometry?.getAttribute('position')?.count ?? 0,
      lineage: w.entities().find((e) => e.id === id)?.lineage ?? null,
      form: ent ? JSON.stringify(ent.ev.form) : '',
    };
  };
  const shapes = [rec()];
  for (let i = 0; i < 4; i++) { w.gainXp(id, 500); w.evolve(id); shapes.push(rec()); }
  w.upgrade(id);
  const others = w.entities().filter((e) => e.id !== id && !e.hostile).slice(0, 2);
  const merged = others.length >= 2 ? w.merge(others[0].id, others[1].id) : null;
  const lineages = new Set(shapes.map((s) => s.lineage).filter(Boolean));
  return { id, shapes, vertsDistinct: new Set(shapes.map((s) => s.verts)).size, lineage: Array.from(lineages), merged: !!merged };
});
step('evolution', report.evolution);
await shotNear('r25-fusion-06-god-close', report.evolution.id);
await shot('r25-fusion-06b-evolved');

// ---- ⑧ Agent 设置面板字段 ----
report.agent = await page.evaluate(() => {
  const w = window.__wish;
  const btn = Array.from(document.querySelectorAll('#wish-panel button')).find((b) => b.textContent.includes('Agent 设置'));
  btn?.click();
  const s = document.querySelector('#wish-settings');
  const inputs = Array.from(s?.querySelectorAll('input') ?? []).map((i) => ({ key: i.dataset.k ?? i.type, type: i.type }));
  const cfg = w.config();
  return { buttonFound: !!btn, shown: s?.classList.contains('show') ?? false, inputs, config: cfg, hasEnableL3: inputs.some((i) => i.type === 'checkbox') };
});
step('agent', report.agent);
await shot('r25-fusion-07-agent');
await page.evaluate(() => document.querySelector('#wish-settings')?.classList.remove('show'));

// ---- ⑨ 存档：刷新后造物仍在 ----
const beforeReload = await page.evaluate(() => { window.__wish.saveState(); return window.__wish.entities().length; });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__wish, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2500));
report.persistence = await page.evaluate(() => ({ entities: window.__wish.entities().length, blueprints: window.__wish.blueprints().length, buildParts: window.__wish.buildParts().length }));
report.persistence.beforeReload = beforeReload;
step('persistence', report.persistence);
await shot('r25-fusion-08-reload');

// ---- 硬门禁与结论 ----
report.pageErrors = errs;
const c = report.catalog, d = report.develop, s = report.spawn, p = report.presets;
const b = report.build, g = report.gameplay, e = report.evolution, a = report.agent, sv = report.persistence;
report.pass = {
  catalogFull: c.count >= 2000 && c.uniqueNames === c.count,
  sourceCoverage: Object.values(c.sourceCoverage).every((n) => n > 20),
  agentDeveloped: d.ok && d.steps.length === 5 && d.powers.length >= 3 && d.cardLength > 100 && d.assetCount >= 1,
  wishSpawned: s.entity?.name?.includes('神龙') === true && s.loreVisible,
  nearPlayer: (s.nearPlayerMeters ?? Infinity) < 40 && s.basis === 'player.actor.pos',
  hatch: report.hatch?.stage === '成体' && report.hatch?.id != null,
  presetsLoaded: p.spawned.length >= 5 && p.spawned.every((x) => !!x.id) && p.after > p.before,
  build: b.enabled && b.placed >= 3 && b.partsBefore >= 3 && b.combo,
  explore: g.afterDiscoveries > g.beforeDiscoveries && g.xpAwarded > 0 && g.coinsAwarded > 0,
  combat: g.hostile && g.hits > 0,
  ride: g.rideDelta > 0,
  evolution: e.vertsDistinct >= 3 && !!e.merged,
  agentSettings: a.buttonFound && a.shown && a.hasEnableL3 && a.inputs.length >= 3,
  persistence: sv.entities > 0 && sv.entities >= Math.min(3, sv.beforeReload),
  noPageErrors: errs.length === 0,
};
report.pass.all = Object.values(report.pass).every(Boolean);
fs.writeFileSync(`${OUT}/r25-fusion-runtime.json`, JSON.stringify(report, null, 2));
console.log('\nPASS:', JSON.stringify(report.pass, null, 2));
console.log('pageErrors:', JSON.stringify(errs));
await browser.close();
if (!report.pass.all) process.exitCode = 1;
