/**
 * R27 残留诊断 3：抓「首帧 settleAll 刚完成」的瞬间，定位固定嵌墙角色 id=1490
 * 为什么没被首帧收敛修掉，以及后续哪一帧被逐帧兜底救回。只读 + 调用已有真实修复函数。
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
    && window.__qingming.world.crowd.settleStats?.().done === true,
  { timeout: 240000 });

const read = () => page.evaluate(() => {
  const q = window.__qingming, c = q.world.crowd;
  const audit = c.collisionAudit();
  const ids = audit.sample.map((s) => s.id);
  const rows = ids.slice(0, 6).map((id) => {
    const a = c.actors.find((x) => x.id === id);
    if (!a) return { id, missing: true };
    const { x, y, z } = a.pos;
    return {
      id, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2),
      freeze: !!a.freeze, attach: !!a.attach, sky: !!a.sky, hidden: !!a.hidden,
      action: a.action ?? null, occ: a.occ ?? null,
      wsOwn: c.walkSurfaceAt(x, z, y), wsAny: c.walkSurfaceAt(x, z),
      blockedOwn: q.solidBlockedAt(x, z, y), blocked0: q.solidBlockedAt(x, z, 0),
    };
  });
  return { audit, rows, frame: c.frame, settle: c.settleStats() };
});

const t0 = await read();
const forced = await page.evaluate(() => {
  const c = window.__qingming.world.crowd;
  const r = c.settleAll();
  return { r, auditNow: c.collisionAudit() };
});
await new Promise((r) => setTimeout(r, 400));
const t1 = await read();
await new Promise((r) => setTimeout(r, 2000));
const t2 = await read();

const out = { at: new Date().toISOString(), url: URL, t0, forced, t1, t2 };
console.log(JSON.stringify(out, null, 2));
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/r27-diagnose3.json', JSON.stringify(out, null, 2));
await browser.close();
