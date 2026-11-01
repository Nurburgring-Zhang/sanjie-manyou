import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1200,700'] });
const p = await b.newPage();
await p.goto((process.env.PREVIEW_URL||'http://localhost:4173/') + '?traceGlow=1', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));
const rows = await p.evaluate(() => {
  const t = window.__glowTrace || [];
  const big = t.map((g) => ({ v: Math.abs(g.w)*Math.abs(g.h)*Math.abs(g.d), x: Math.round(g.x), y: Math.round(g.y), z: Math.round(g.z), w: +g.w.toFixed(1), h: +g.h.toFixed(1), d: +g.d.toFixed(1), s: (g.stack||'').slice(0,110) }))
    .sort((a,b)=>b.v-a.v).slice(0, 16);
  // 方箱发光件：stack 不以 CYL/ROOFC/PYR 开头（box 只记调用栈）
  const boxes = t.filter((g) => !/^(CYL|ROOFC|PYR)/.test(g.stack || ''))
    .map((g) => ({ v: Math.abs(g.w)*Math.abs(g.h)*Math.abs(g.d), x: Math.round(g.x), y: Math.round(g.y), z: Math.round(g.z), w: +g.w.toFixed(1), h: +g.h.toFixed(1), d: +g.d.toFixed(1), s: (g.stack||'').slice(0,120) }))
    .sort((a,b)=>b.v-a.v).slice(0, 12);
  return { total: t.length, big, boxes, boxCount: boxes.length };
});
console.log('glowPrims', rows.total);
for (const g of rows.big) console.log('CYL', JSON.stringify(g));
console.log('--- box glow top ---');
for (const g of rows.boxes) console.log('BOX', JSON.stringify(g));
await b.close();
