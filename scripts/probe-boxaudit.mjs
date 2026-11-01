import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless: true, args: ['--no-sandbox','--enable-unsafe-swiftshader','--enable-precise-memory-info'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:4243/?boxAudit=1', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit, { timeout: 240000, polling: 300 });
const r = await p.evaluate(() => {
  const A = window.__boxAudit;
  const rows = Object.entries(A.byGroup).sort((a,b)=>b[1].cullable-a[1].cullable);
  return {
    total: A.total, cullable: A.cullable, dup: A.dup, dupTris: A.dupTris,
    cullPct: +(A.cullable/A.total*100).toFixed(2), dupPct: +(A.dup/A.total*100).toFixed(3),
    topCull: rows.slice(0,10), topDup: Object.entries(A.byGroup).sort((a,b)=>b[1].dup-a[1].dup).slice(0,8),
    tris: window.__qingming.world.assetAudit.groups,
  };
});
console.log(JSON.stringify(r, null, 1).slice(0, 3000));
await b.close();
