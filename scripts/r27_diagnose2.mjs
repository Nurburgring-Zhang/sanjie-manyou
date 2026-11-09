/**
 * R27 残留诊断 2：把 collisionAudit 的 embedded / sunken 逐样本拆开，
 * 并对比「立即 settleAll 后」与「跑若干帧后」的审计值，定位是哪条逐帧路径把人挪回去。
 * 只读游戏状态（settleAll 是已有的真实修复函数，不是伪造统计）。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4186/';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming
    && typeof window.__qingming.world.crowd.settleAll === 'function',
  { timeout: 240000 });
await new Promise((r) => setTimeout(r, 3000));

const detail = await page.evaluate(() => {
  const q = window.__qingming;
  const c = q.world.crowd;
  const audit = c.collisionAudit();
  const rows = audit.sample.map((s) => {
    const a = c.actors.find((x) => x.id === s.id);
    if (!a) return { id: s.id, missing: true };
    const { x, y, z } = a.pos;
    return {
      id: s.id, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2),
      freeze: !!a.freeze, attach: !!a.attach, sky: !!a.sky, hidden: !!a.hidden,
      action: a.action ?? null, occ: a.occ ?? null,
      wsOwn: c.walkSurfaceAt(x, z, y),
      wsAny: c.walkSurfaceAt(x, z),
      blockedOwn: q.solidBlockedAt(x, z, y),
      blocked0: q.solidBlockedAt(x, z, 0),
    };
  });
  return { audit, rows, settle: c.settleStats() };
});

const afterSettle = await page.evaluate(() => {
  const c = window.__qingming.world.crowd;
  const r = c.settleAll();
  return { r, auditNow: c.collisionAudit() };
});
await new Promise((r) => setTimeout(r, 1200));
const afterFrames = await page.evaluate(() => ({
  audit: window.__qingming.world.crowd.collisionAudit(),
  settle: window.__qingming.world.crowd.settleStats(),
}));

const out = { url: URL, detail, afterSettle, afterFrames };
console.log(JSON.stringify(out, null, 2));
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/r27-diagnose2.json', JSON.stringify(out, null, 2));
await browser.close();
