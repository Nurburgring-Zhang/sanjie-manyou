/**
 * 交互点-地面贴合探针（审计 P1-1 的整类机检）。
 *
 * 为什么需要它：蟠桃赏赐交互点曾把预缩放坐标当地球坐标直写（world.ts registerInteractions），
 * 落在距真实瑶池 ~1950m 的空里，distanceToSquared<25 永不成立——玩法整体不可达，且
 * tsc/vitest 全绿。这类「注册点飘了」的 bug 只能靠运行时对账：交互点 y 必须贴着玩家
 * 真实站面（player.groundHeight）。
 *
 * 判据：
 *   - 天宫带（pos.y > 2085 = 150 + HEAVEN_LIFT，与 player.groundHeight 的天宫阈值一致）：
 *     |pos.y − groundHeight(x,z,pos.y)| ≤ 2m，逐点断言，任一超差即 BLOCK。
 *   - 其余界带只报告不判（人间/地府的贴地规则不同，避免假红）。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-interact-reach.mjs
 * 退出码：0 = PASS / 1 = BLOCK / 2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.REACH_OUT || path.resolve('artifacts/interact-reach.json');
const HEAVEN_BAND_Y = 2085; // 150 + HEAVEN_LIFT(1935)，与 player.groundHeight 的天宫阈值同源
const TOL = 2;

let browser = null;
let code = 2;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  console.log('[reach] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2000));

  const result = await page.evaluate((bandY, tol) => {
    const w = window.__qingming.world;
    if (!w?.interact?.list || !w?.player?.groundHeight) return { fatal: 'interact.list 或 player.groundHeight 不可达' };
    const rows = [];
    for (const it of w.interact.list) {
      const gy = Number(w.player.groundHeight(it.pos.x, it.pos.z, it.pos.y));
      const grounded = Number.isFinite(gy);
      const dy = grounded ? +(it.pos.y - gy).toFixed(2) : null;
      rows.push({ label: String(it.label).slice(0, 24), x: +it.pos.x.toFixed(1), y: +it.pos.y.toFixed(2), z: +it.pos.z.toFixed(1), gy: grounded ? +gy.toFixed(2) : null, dy, grounded, band: it.pos.y > bandY ? 'heaven' : 'other' });
    }
    const heaven = rows.filter((r) => r.band === 'heaven');
    // 只判「有确定地面」的点；非有限地面（浮空交互位，如骑龙点）单列 floatingWarns 待设计裁决
    const bad = heaven.filter((r) => r.grounded && Math.abs(r.dy) > tol);
    const floatingWarns = heaven.filter((r) => !r.grounded);
    return { total: rows.length, heavenCount: heaven.length, bad, floatingWarns, rows };
  }, HEAVEN_BAND_Y, TOL);

  if (result.fatal) {
    console.error('[reach] FATAL:', result.fatal);
  } else {
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, ...result }, null, 1));
    console.log(`[reach] 交互点总数 ${result.total}，天宫带 ${result.heavenCount}`);
    for (const r of result.rows.filter((x) => x.band === 'heaven')) {
      const tag = !r.grounded ? 'WARN' : Math.abs(r.dy) <= TOL ? 'OK ' : 'BAD';
      console.log(`  ${tag} ${r.label} world(${r.x},${r.y},${r.z}) ground=${r.gy} dy=${r.dy}`);
    }
    code = result.bad.length === 0 ? 0 : 1;
    console.log(code === 0 ? '\n[reach] RESULT=PASS' : `\n[reach] RESULT=BLOCK（${result.bad.length} 点超差）`);
    if (result.floatingWarns.length) console.log(`[reach] WARN：${result.floatingWarns.length} 个天宫交互点无确定地面（浮空位，需设计裁决：意图浮空 or 缺 PLATFORMS 登记）`);
  }
} catch (err) {
  console.error('[reach] FAILED:', String(err).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
