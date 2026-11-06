/**
 * probe-sunken-npcs（用户报障取证②）：三界演员 y vs walkSurfaceY 逐个比对。
 *
 * 口径：演员站位 ≠ walkSurfaceY(x,z)（±0.6 容差）即「站错层」——输出三界各自的不匹配
 * 数量、样本坐标、正确层高，供 world 载入后自动校正（realmY 语义已有先例）。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-sunken-npcs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.SN_OUT || path.resolve('artifacts/sunken-npcs.json');

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
  await page.setViewport({ width: 1280, height: 720 });
  console.log('[sn] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2500));

  const res = await page.evaluate(async () => {
    const Q = window.__qingming;
    const B = await import('/src/actors/behaviors.ts');
    const out = { heaven: [], human: [], underworld: [], sampleByRealm: {} };

    for (const a of Q.world.crowd.actors) {
      if (a.hidden || a.attach || !a.freeze) continue;         // 定桩演员才比对（行走的动态自校正）
      const p = a.pos;
      const target = p.y > 2085 ? 'heaven' : p.y < -200 ? 'underworld' : 'human';
      const ws = B.walkSurfaceY(p.x, p.z, p.y);                 // 从当前脚高找可行走面
      const diff = ws === null ? null : +(p.y - ws).toFixed(2);
      const rec = { id: a.id, occ: a.occ, x: +p.x.toFixed(0), y: +p.y.toFixed(1), z: +p.z.toFixed(0), ws: ws === null ? null : +ws.toFixed(2), diff };
      if (ws === null) {
        out[target].push(rec);                                  // 站在无可行走面的位置（悬空/嵌地）
      } else if (Math.abs(diff) > 0.6 && diff > 0) {
        out[target].push(rec);                                  // 悬在面之上 0.6m+
      }
      (out.sampleByRealm[target] ||= []).push(rec);
    }
    for (const k of Object.keys(out.sampleByRealm)) out.sampleByRealm[k] = out.sampleByRealm[k].length;
    return out;
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(`[sn] 天宫站错层: ${res.heaven.length}`);
  for (const r of res.heaven.slice(0, 8)) console.log('  ', JSON.stringify(r));
  console.log(`[sn] 地府站错层: ${res.underworld.length}`);
  for (const r of res.underworld.slice(0, 8)) console.log('  ', JSON.stringify(r));
  console.log(`[sn] 人间站错层: ${res.human.length}`);
  for (const r of res.human.slice(0, 8)) console.log('  ', JSON.stringify(r));
  console.log('[sn] 各界演员数:', JSON.stringify(res.sampleByRealm));
  code = 0;
  console.log('[sn] RESULT = FORENSICS-DONE');
} catch (err) {
  console.error('[sn] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
