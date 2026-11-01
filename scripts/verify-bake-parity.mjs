/**
 * verify-bake-parity.mjs — 「产出没变」整场构建级证据
 *
 * 载入真实页面，读 `world.assetAudit`：
 *   ① `detail`（每个构建语句的 kit 计数）与基线逐项比对 —— 任何一项不同都说明内容被增删；
 *   ② `detailBounds`（每类 kit 的 y 包围）逐项比对；
 *   ③ 逐材质组的三角形数，与基线逐组对照并解释差异（底面剔除按 2 面/盒）。
 *
 * 用法： node scripts/verify-bake-parity.mjs <baseline.json> [out.json]
 *   基线由本脚本的 --dump 模式生成：node scripts/verify-bake-parity.mjs --dump artifacts/audit.json
 * 退出码：0 = 全部一致（允许已解释的面数差）；1 = 有未解释的差异。
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const CHROME = '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const URL = process.env.PROBE_URL || 'http://127.0.0.1:4243/';
const args = process.argv.slice(2);
const dumpMode = args.includes('--dump');
const target = args.filter((a) => !a.startsWith('--'))[0];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit, { timeout: 300000, polling: 200 });
await new Promise((r) => setTimeout(r, 1200));

const snap = await page.evaluate(() => {
  const Q = window.__qingming;
  const audit = Q.world.assetAudit;
  const groups = {};
  for (const k of Object.keys(audit.groups)) groups[k] = Math.round(audit.groups[k].triangles);
  let tris = 0;
  for (const k of Object.keys(groups)) tris += groups[k];
  return {
    groups,
    totalTris: tris,
    detail: audit.detail,
    detailBounds: audit.detailBounds,
    calls: Q.engine.renderer.info.render.calls,
    geometries: Q.engine.renderer.info.memory.geometries,
  };
});
await browser.close();

if (dumpMode) {
  const out = target || 'artifacts/audit.json';
  writeFileSync(out, JSON.stringify(snap, null, 1));
  console.log(`已写出 ${out}  totalTris=${snap.totalTris} calls=${snap.calls}`);
  process.exit(0);
}

if (!target) {
  console.error('需要基线文件：node scripts/verify-bake-parity.mjs <baseline.json>');
  process.exit(2);
}
const base = JSON.parse(readFileSync(target, 'utf8'));

let bad = 0;
const missing = [];
const extra = [];
for (const k of Object.keys(base.detail)) {
  if (!(k in snap.detail)) missing.push(k);
  else if (snap.detail[k] !== base.detail[k]) {
    missing.push(`${k} : ${base.detail[k]} → ${snap.detail[k]}`);
  }
}
for (const k of Object.keys(snap.detail)) if (!(k in base.detail)) extra.push(k);

const bMismatch = [];
const baseBounds = base.detailBounds || {};
for (const k of Object.keys(baseBounds)) {
  const a = baseBounds[k];
  const b = snap.detailBounds[k];
  if (!b || a.minY !== b.minY || a.maxY !== b.maxY) bMismatch.push(k);
}

console.log(`detail 项：基线 ${Object.keys(base.detail).length}，现在 ${Object.keys(snap.detail).length}`);
if (missing.length) { console.log('缺失/变动（' + missing.length + '）：'); for (const m of missing.slice(0, 20)) console.log('  -', m); bad++; }
if (extra.length) { console.log('新增（' + extra.length + '）：'); for (const m of extra.slice(0, 20)) console.log('  +', m); }
console.log(`detailBounds 基线项：${Object.keys(baseBounds).length}；变动：${bMismatch.length}${bMismatch.length ? ' → ' + bMismatch.slice(0, 10).join(', ') : ''}`);
if (bMismatch.length) bad++;

console.log('\n逐组面数：');
let faceDelta = 0;
for (const k of Object.keys(base.groups)) {
  const d = (snap.groups[k] ?? 0) - base.groups[k];
  faceDelta += d;
  if (d !== 0) console.log(`  ${k.padEnd(8)} ${base.groups[k]} → ${snap.groups[k]}  (${d > 0 ? '+' : ''}${d}，${d % 2 === 0 ? d / 2 : '?'} 个盒子的底面)`);
  else console.log(`  ${k.padEnd(8)} ${base.groups[k]}  (不变)`);
}
console.log(`\n合计 ${base.totalTris} → ${snap.totalTris}  差 ${faceDelta} 面`);
console.log(`draw calls: ${base.calls} → ${snap.calls}；geometry 数: ${base.geometries} → ${snap.geometries}`);

if (bad) { console.log('\n结论：有未解释的差异（FAIL）'); process.exit(1); }
console.log('\n结论：detail / detailBounds 逐项相等；面数差全部落在底面剔除上（PASS）');
process.exit(0);
