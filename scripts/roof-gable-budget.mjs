/**
 * 三角面预算核算：读 world.assetAudit（Baker.stats()）里的分区三角面与 kit 计数，
 * 把这次「补端坡/山墙」的增量单独算出来。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4289/ node scripts/roof-gable-budget.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4289/';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate(() => {
  const a = window.__qingming.world.assetAudit;
  const groups = a.groups;
  const tris = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, Math.round(v.triangles)]));
  const total = Object.values(tris).reduce((s, v) => s + v, 0);
  const d = a.detail;
  const roofKits = Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('roof.') || k.startsWith('palace.wing') || k.startsWith('palace.shop')));
  return {
    tris,
    total,
    endHip: d['roof.endHip'] ?? 0,
    gableEnd: d['roof.gableEnd'] ?? 0,
    roofKits,
    calls: window.__qingming.engine.renderer.info.render.calls,
    sceneTris: window.__qingming.engine.renderer.info.render.triangles,
  };
});

const ADD_PER_HIP = 48;   // 12 环 × 2 三角 × 2 端
const ADD_PER_GABLE = 2;  // 单三角（双面由法线给，三角数不变）
const added = out.endHip * ADD_PER_HIP + out.gableEnd * ADD_PER_GABLE;
console.log(`总三角面（Baker 合批前口径）: ${out.total.toLocaleString()}`);
for (const [k, v] of Object.entries(out.tris)) console.log(`  ${k.padEnd(10)} ${String(v).padStart(10)}`);
console.log(`\n本次新增:`);
console.log(`  roof.endHip  ${out.endHip} 顶 × ${ADD_PER_HIP} 面 = ${(out.endHip * ADD_PER_HIP).toLocaleString()}`);
console.log(`  roof.gableEnd ${out.gableEnd} 片 × ${ADD_PER_GABLE} 面 = ${(out.gableEnd * ADD_PER_GABLE).toLocaleString()}`);
console.log(`  合计 +${added.toLocaleString()} 面（预算 +400,000）`);
for (const [k, v] of Object.entries(out.roofKits)) console.log(`  kit ${k} = ${v}`);
console.log(`渲染 drawCalls=${out.calls}  sceneTris=${out.sceneTris}`);
await browser.close();
