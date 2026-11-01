/** 目标状态机验证：抵达节点 → 目标置 done + 图鉴写回 + HUD 打勾；Boss 节点在未击杀前必须保持 open */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));
const snap = () => p.evaluate(() => {
  const w = window.__qingming.world;
  const n = w.levelNow();
  return {
    key: n?.key ?? '', dist: n ? Math.round(n.dist) : -1,
    done: n ? !!w.objectiveDone[n.key] : false,
    log: w.codexLog.map((e) => e.code).slice(-4),
    bossDefeated: !!w.boss?.defeated,
    label: [...document.querySelectorAll('div')].map((d)=>d.textContent||'').find((t)=>/✓/.test(t)) ?? '',
  };
});
const out = {};
// A) 抵达类节点：奈何桥
await p.evaluate(() => window.__qingming.world.teleport('naihe'));
await new Promise(r=>setTimeout(r,2500));
out.naihe = await snap();
// B) Boss 节点：未击杀前必须 open
await p.evaluate(() => window.__qingming.world.teleport('jiangtai'));
await new Promise(r=>setTimeout(r,1800));
out.jiangtaiOpen = await snap();
console.log(JSON.stringify(out, null, 1));
await b.close();
