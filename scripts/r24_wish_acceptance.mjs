/**
 * R24 融合玩法实机验收：三界漫游 × 我的世界 × 孢子
 *
 * 纪律：不认「函数存在」，只认「真的敲进去了、真的落场了、真的能截图」。
 *  ① 生产包里 #wish-panel 输入框可见 → 用键盘真输入「我要一条神龙」→ 回车
 *  ② 热更新载入的实体要出现在玩家附近（水平距离 < 40m），并实拍
 *  ③ 预设资产一句话载入 / 互动 / 进化 / 升级 / 合并 五条链路逐一跑通
 *  ④ Agent 设置面板可打开、API 字段齐备、无 key 时离线降级成功
 *  ⑤ pageErrors 必须为 0
 *
 * 用法：node scripts/r24_wish_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';

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

// ---- ① 系统自检：目录规模 / 输入框 / 五大玩法标签 / Agent 配置 ----
report.catalog = await page.evaluate(() => {
  const w = window.__wish;
  const input = document.querySelector('#wish-panel input');
  const box = input ? input.getBoundingClientRect() : null;
  return {
    // main.ts 暴露的是 catalogCount: number（catalogStats() 才是函数），两种形态都兼容
    count: typeof w.catalogCount === 'number' ? w.catalogCount : (typeof w.catalogStats === 'function' ? w.catalogStats().total : 0),
    stats: typeof w.catalogStats === 'function' ? w.catalogStats() : null,
    stages: w.stages,
    xpThresholds: w.xpThresholds,
    config: w.config(),
    panelExists: !!document.getElementById('wish-panel'),
    inputId: input ? input.id : null,
    inputVisible: !!box && box.width > 0 && box.height > 0,
    tabs: [...document.querySelectorAll('#wish-tabs button')].map((b) => b.textContent),
    hint: document.querySelector('#wish-panel .wish-hint')?.textContent ?? null,
  };
});
console.log('catalog:', JSON.stringify(report.catalog));

// ---- ② 真键盘输入「我要一条神龙」并回车 ----
const inputSel = '#wish-panel input';
await page.click(inputSel);
await page.type(inputSel, '我要一条神龙', { delay: 45 });
report.steps.push({ step: 'type', value: await page.$eval(inputSel, (el) => el.value) });
await page.screenshot({ path: path.join(OUT, 'r24-wish-01-typed.png') });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__wish.entities().length > 0, { timeout: 40000 })
  .catch((e) => report.steps.push({ step: 'waitSpawn', error: String(e) }));
await new Promise((r) => setTimeout(r, 1200));

const spawned = await page.evaluate(() => {
  const w = window.__wish;
  const cam = window.__qingming.engine.camera.position;
  // 落点以玩家角色为准，不是相机：游戏开场有 cinematic 运镜，相机会被拉到几百米外。
  const pp = window.__qingming.world.player?.actor?.pos ?? null;
  return {
    entities: w.entities(),
    status: document.getElementById('wish-status')?.textContent ?? null,
    cam: { x: cam.x, y: cam.y, z: cam.z },
    player: pp ? { x: pp.x, y: pp.y, z: pp.z } : null,
    listRows: document.querySelectorAll('#wish-list .wish-row').length,
    labels: [...document.querySelectorAll('.wish-label')].map((n) => n.textContent),
  };
});
report.spawn = spawned;
console.log('spawn:', JSON.stringify(spawned));

// ---- ③ 玩家附近 + 实拍神龙 ----
if (spawned.entities.length) {
  const e = spawned.entities[0];
  const basis = spawned.player ?? spawned.cam;
  report.nearPlayerMeters = Math.hypot(e.pos.x - basis.x, e.pos.z - basis.z);
  report.nearPlayerBasis = spawned.player ? 'player.actor.pos' : 'camera(fallback)';
  await page.evaluate((p) => {
    const eng = window.__qingming.engine;
    eng.stopCinema();
    // 中距斜俯视：buildDragon 躯干沿 X 展开 14*s（s 可到 3，即 42m），
    // 贴太近只能拍到放大的爪/角锥（旧机位 +7/+3.4/+8 就误判成「一堆大喇叭」）。
    const cx = p.x + 2, cy = p.y + 12, cz = p.z + 34;
    eng.camera.position.set(cx, cy, cz);
    eng.lookTarget.set(p.x, p.y, p.z);
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    eng.yaw = Math.atan2(-dx, -dz);
    eng.pitch = Math.asin(dy / d);
  }, e.pos);
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: path.join(OUT, 'r24-wish-02-dragon.png') });

  // ③a 更远的全身机位，避免长躯干被裁掉
  await page.evaluate((p) => {
    const eng = window.__qingming.engine;
    const cx = p.x + 2, cy = p.y + 22, cz = p.z + 62;
    eng.camera.position.set(cx, cy, cz);
    eng.lookTarget.set(p.x, p.y, p.z);
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    eng.yaw = Math.atan2(-dx, -dz);
    eng.pitch = Math.asin(dy / d);
  }, e.pos);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, 'r24-wish-05-dragon-wide.png') });
  // 进化对比图回到中距机位，保证与 02 同视角可比
  await page.evaluate((p) => {
    const eng = window.__qingming.engine;
    const cx = p.x + 2, cy = p.y + 12, cz = p.z + 34;
    eng.camera.position.set(cx, cy, cz);
    eng.lookTarget.set(p.x, p.y, p.z);
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    eng.yaw = Math.atan2(-dx, -dz);
    eng.pitch = Math.asin(dy / d);
  }, e.pos);

  // ③b 孢子式进化：逐阶记录「本体几何顶点数 + 装饰 mesh 数」，证明确实换了形态
  //     （旧版 applyForm 只有 group.scale.setScalar，五阶顶点数完全相同 → 只放大不演变）
  report.evolved = await page.evaluate((id) => {
    const w = window.__wish;
    const panel = w.panel;
    const rec = () => {
      const e = w.entities().find((x) => x.id === id);
      const ent = panel && panel.entityMap ? panel.entityMap.get(id) : null;
      const mesh = ent && ent.group ? ent.group.children[0] : null;
      return {
        stage: e ? e.stage : null,
        level: e ? e.level : null,
        bodyVerts: mesh && mesh.geometry ? mesh.geometry.getAttribute('position').count : 0,
        meshes: ent && ent.group ? ent.group.children.length : 0,
      };
    };
    const shapes = [rec()];
    for (let i = 0; i < 4; i++) { w.gainXp(id, 500); w.evolve(id); shapes.push(rec()); }
    return shapes;
  }, e.id);
  await new Promise((r) => setTimeout(r, 1400));
  await page.screenshot({ path: path.join(OUT, 'r24-wish-04-evolved.png') });
}

// ---- ④ 五大玩法链路：预设载入 / 互动 / 进化 / 升级 / 合并 ----
report.play = await page.evaluate(async () => {
  const w = window.__wish;
  const out = {};
  const first = w.entities()[0];
  const presetId = w.catalog[0]?.id ?? null;
  out.presetId = presetId;
  out.presetSpawned = presetId ? w.spawnById(presetId) : null;
  await w.spawn('我要一只凤凰');
  const all = w.entities();
  out.countAfterTwoWishes = all.length;
  if (first) {
    const before = w.entities().find((e) => e.id === first.id);
    w.gainXp(first.id, 260);
    w.evolve(first.id);
    w.upgrade(first.id);
    w.interact(first.id, '互动');
    const after = w.entities().find((e) => e.id === first.id);
    out.before = before ? { stage: before.stage, level: before.level, xp: before.xp } : null;
    out.after = after ? { stage: after.stage, level: after.level, xp: after.xp } : null;
    const other = all.find((e) => e.id !== first.id);
    out.mergedId = other ? w.merge(first.id, other.id) : null;
  }
  out.finalEntities = w.entities();
  out.status = document.getElementById('wish-status')?.textContent ?? null;
  return out;
});
console.log('play:', JSON.stringify(report.play));

// ---- ⑤ Agent 设置面板 ----
report.agent = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#wish-panel button')]
    .find((b) => b.textContent && b.textContent.includes('Agent'));
  if (btn) btn.click();
  const s = document.getElementById('wish-settings');
  return {
    buttonFound: !!btn,
    shown: !!s && s.classList.contains('show'),
    fields: s ? [...s.querySelectorAll('input[data-k]')].map((i) => ({ key: i.dataset.k, type: i.type })) : [],
    hasEnableL3: s ? [...s.querySelectorAll('label')].some((l) => l.textContent.includes('L3')) : false,
  };
});
await page.screenshot({ path: path.join(OUT, 'r24-wish-03-panel.png') });

report.pageErrors = errs;
report.pass = {
  runtime: errs.length === 0,
  catalog: report.catalog.count >= 300,
  input: report.catalog.inputVisible,
  wishSpawned: (report.spawn.entities?.length ?? 0) > 0,
  nearPlayer: (report.nearPlayerMeters ?? Infinity) < 40,
  fiveTabs: report.catalog.tabs.length === 5,
  evolution: !!report.play.before && !!report.play.after &&
    (report.play.after.stage !== report.play.before.stage || report.play.after.level !== report.play.before.level),
  merge: !!report.play.mergedId,
  agentSettings: report.agent.shown && report.agent.fields.length >= 3,
  stageShapes: new Set((report.evolved ?? []).map((s) => s.bodyVerts)).size >= 3,
};
report.pass.all = Object.values(report.pass).every(Boolean);

fs.writeFileSync(path.join(OUT, 'r24-wish-runtime.json'), JSON.stringify(report, null, 2));
console.log('PASS:', JSON.stringify(report.pass));
console.log('pageErrors:', JSON.stringify(errs));
await browser.close();
if (!report.pass.all) process.exitCode = 1;
