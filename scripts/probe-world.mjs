/** 世界规模验收：用 baker 的 detail 台账 + 角色池，逐条核对 SPEC 里「已实现未验收」的数量口径 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,800));
const r = await p.evaluate(() => {
  const w = window.__qingming.world;
  const d = w.assetAudit?.detail ?? {};
  const pick = (pre) => Object.entries(d).filter(([k]) => k.startsWith(pre)).reduce((a, [, v]) => a + v, 0);
  const actors = (w.crowd.actors || w.crowd.list || []);
  const gen = actors.filter((a) => a.data?.code === 'gen').length;
  const sol = actors.filter((a) => a.data?.code === 'soldier').length;
  const keys = Object.keys(d);
  return {
    detailKeys: keys.length,
    trees: pick('tree.') + pick('flora.') + pick('veg.'),
    shops: pick('shop.') + pick('stall.'),
    hell: pick('hell.') + pick('hells.'),
    corridor: pick('sky.') + pick('arc.'),
    fengdu: pick('fengdu.'),
    generals: gen, soldiers: sol,
    top: Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}=${v}`),
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
