/**
 * R27 运行期诊断：把 collisionAudit 报出的 embedded / sunken 拆开看，
 * 区分「真嵌墙」与「站在多层楼板 / 城墙顶被审计口径误判」。
 * 只读，不改任何游戏状态。
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
    && typeof window.__qingming.solidBlockedAt === 'function',
  { timeout: 240000 });
await new Promise((r) => setTimeout(r, 3000));

const out = await page.evaluate(() => {
  const w = window.__qingming.world;
  const blocked = window.__qingming.solidBlockedAt;
  const embedded = [];
  const all = [];
  for (const a of w.crowd.actors) {
    if (a.hidden || a.attach || a.sky) continue;
    if (a.pos.y < -60 || a.pos.y > 120) continue;
    const rec = {
      id: a.id, x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(2),
      freeze: !!a.freeze, action: a.action ?? null, code: a.data?.code ?? null,
      occ: a.data?.occ ?? null, venue: a.data?.venue ?? null,
      hitAtOwnY: blocked(a.pos.x, a.pos.z, a.pos.y),
      hitAtFoot0: blocked(a.pos.x, a.pos.z, 0),
      hitAtYminus1: blocked(a.pos.x, a.pos.z, Math.max(0, a.pos.y - 1)),
    };
    all.push(rec);
    if (rec.hitAtOwnY) embedded.push(rec);
  }
  return {
    totalActors: w.crowd.actors.length,
    judged: all.length,
    embeddedCount: embedded.length,
    embedded: embedded.slice(0, 40),
    highActors: all.filter((r) => r.y > 2).slice(0, 30),
    audit: w.crowd.collisionAudit(),
    solids: window.__qingming.solids(),
  };
});
console.log(JSON.stringify(out, null, 2));
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/r27-diagnose.json', JSON.stringify(out, null, 2));
await browser.close();
