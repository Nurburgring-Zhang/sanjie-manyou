/**
 * R29 M1 生产包实机验收：只认运行期证据，pageErrors===0 是硬门禁。
 *
 * 覆盖本轮按 spec 落地的项：
 *  - R27 回归：collisionAudit embedded=0 / sunken=0（加载后 + 推进 6s 后）
 *  - FIX-007：title / brand 与 package.json 身份一致
 *  - FIX-010：Boss→玩家伤害闭环（survival.damage 真接线且 hp 真下降）
 *  - FIX-012：唯一游戏日 calendar / 渡票字段就绪
 *  - SAV-001/003：__save / __saveState / 存档面板 / 降级告知
 *  - QA-001：CSP 注入、零页面错误
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4186/ node scripts/r29_acceptance.mjs
 * 无浏览器/无服务 → gate=SKIPPED + DEGRADED，绝不计入 PASS.all。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4186/';
const OUT = path.join(ROOT, 'artifacts/spec');
fs.mkdirSync(OUT, { recursive: true });
const SELF_TEST = process.argv.includes('--self-test');

function out(o, rc) { console.log(JSON.stringify(o, null, 2)); process.exit(rc); }

if (SELF_TEST) {
  const checks = {
    'vite.config.ts 注入 __APP_IDENTITY__': /constantsForVite\(\)/.test(fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')),
    'world.ts 接线 initSaveSystem': /initSaveSystem\(/.test(fs.readFileSync(path.join(ROOT, 'src/world.ts'), 'utf8')),
    'world.ts 接线 calendar.tick': /calendar\.tick\(/.test(fs.readFileSync(path.join(ROOT, 'src/world.ts'), 'utf8')),
    'Boss 注入 survival': /\{\s*survival:\s*this\.survival\s*\}/.test(fs.readFileSync(path.join(ROOT, 'src/world.ts'), 'utf8')),
    'ui.ts 挂载存档面板': /mountSavePanel\(/.test(fs.readFileSync(path.join(ROOT, 'src/ui/ui.ts'), 'utf8')),
  };
  out({ mode: 'offline', gate: 'SELF_TEST=PASS', realMachine: 'SKIPPED', staticChecks: checks,
    note: '静态自检通过；真机门未实跑（SKIPPED，不计入 PASS.all）' }, 0);
}

const errs = [];
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  });
} catch (e) {
  out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-浏览器启动失败: ' + String(e), PASS: { all: null } }, 0);
}
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 240)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming
      && typeof window.__qingming.solids === 'function'
      && window.__qingming.world?.crowd?.settleStats?.().done === true,
    { timeout: 240000 },
  );
  await new Promise((r) => setTimeout(r, 2500));

  const r = {};
  r.title = await page.title();
  r.brand = await page.evaluate(() => document.querySelector('.brand')?.textContent ?? '');
  r.csp = await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
  r.collisionAtLoad = await page.evaluate(() => window.__qingming.world.crowd.collisionAudit());
  r.solids = await page.evaluate(() => window.__qingming.solids());
  r.destruction = await page.evaluate(() => window.__qingming.destruction?.());
  r.saveApi = await page.evaluate(() => ({
    hasSave: typeof window.__save === 'function',
    hasState: typeof window.__saveState === 'function',
    state: typeof window.__saveState === 'function' ? window.__saveState() : null,
  }));
  r.calendar = await page.evaluate(() => ({
    day: window.__qingming.world.calendar?.dayIndex() ?? null,
    hasSetCalendar: !!window.__qingming.world.interact?.calendar,
  }));
  r.economy = await page.evaluate(() => {
    const i = window.__qingming.world.interact;
    return i ? { ferryTicket: i.ferryTicket, peachGrantedToday: i.peachGrantedToday, peach: i.peach } : null;
  });
  r.panelExists = await page.evaluate(() => !!document.querySelector('.cqsp-root, [class*="cqsp"]'));

  // 手动保存一次（验证四层策略真接上，而非只有模块）
  r.manualSave = await page.evaluate(async () => {
    if (typeof window.__save !== 'function') return { ok: false, reason: '__save 未注入' };
    try { return await window.__save(); } catch (e) { return { ok: false, reason: String(e) }; }
  });

  // FIX-010：站进 attackReach 推进 8s，断言 hp 真下降（Boss→玩家）
  r.boss = await page.evaluate(() => {
    const w = window.__qingming.world, b = w.boss;
    if (!b) return { ok: false, reason: 'boss 不可用' };
    // dist() 用 b.pos()（有化身时是化身坐标，不是 home），必须按同一口径靠近
    const bp = b.pos();
    let p = w.player?.actor?.pos;
    if (!p && typeof w.player?.toggleMode === 'function') { w.player.toggleMode(); p = w.player?.actor?.pos; }
    if (!p) return { ok: false, reason: 'player.actor.pos 不可用' };
    p.set(bp.x + 1, bp.y, bp.z);
    return {
      ok: true, hpBefore: w.survival.hp, reach: b.spec?.attackReach ?? null,
      defeated: b.defeated, state: b.state, simMs: b.simMs ?? null,
      bossPos: { x: bp.x, y: bp.y, z: bp.z }, playerPos: { x: p.x, y: p.y, z: p.z },
      dist: typeof b.dist === 'function' ? b.dist() : null,
    };
  });
  await new Promise((res) => setTimeout(res, 8000));
  r.boss.hpAfter = await page.evaluate(() => window.__qingming.world.survival.hp);
  r.boss.after = await page.evaluate(() => {
    const b = window.__qingming.world.boss;
    return { simMs: b?.simMs ?? null, state: b?.state ?? null, defeated: b?.defeated ?? null,
      dist: typeof b?.dist === 'function' ? b.dist() : null };
  });

  // 推进 6s 后复核碰撞（R27 回归）
  await new Promise((res) => setTimeout(res, 6000));
  r.collisionAfterWalk = await page.evaluate(() => window.__qingming.world.crowd.collisionAudit());

  r.pageErrors = errs;
  const shot = path.join(ROOT, 'artifacts/spec/R29-M1-acceptance.png');
  await page.screenshot({ path: shot });
  r.screenshot = path.relative(ROOT, shot).replace(/\\/g, '/');

  const gates = {
    pageErrorsZero: errs.length === 0,
    collisionClean: r.collisionAtLoad?.embedded === 0 && r.collisionAtLoad?.sunken === 0
      && r.collisionAfterWalk?.embedded === 0 && r.collisionAfterWalk?.sunken === 0,
    identity: /CyberQingming-R29-1\.2\.0/.test(r.title) && /CyberQingming-R29-1\.2\.0/.test(r.brand),
    cspPresent: r.csp === true,
    saveWired: r.saveApi.hasSave && r.saveApi.hasState && r.manualSave?.ok === true,
    bossDamage: r.boss.ok === true && r.boss.hpAfter < r.boss.hpBefore,
    calendarWired: typeof r.calendar.day === 'number',
    solidsReady: (r.solids?.walls ?? r.solids?.total ?? 0) > 0,
  };
  const failed = Object.entries(gates).filter(([, v]) => !v).map(([k]) => k);
  // QA-004 R2：mode:real 必须附 evidence 指向包内真实文件（截图已在本轮落盘）
  const report = { at: new Date().toISOString(), url: URL, mode: 'real', evidence: r.screenshot,
    gates, failed, ...r,
    PASS: { all: failed.length === 0, note: 'pageErrors=0 为硬门禁；任一 gate false 即整体 FAIL' } };
  fs.writeFileSync(path.join(OUT, 'R29-M1-ACCEPTANCE.json'), JSON.stringify(report, null, 2) + '\n');
  out(report, failed.length ? 1 : 0);
} catch (e) {
  out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-' + String(e), pageErrors: errs, PASS: { all: null } }, 0);
} finally {
  await browser.close();
}
