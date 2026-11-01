/** draw call 预算验证：静态合批后 calls 必须显著下降（目标 ≤600） */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width:1280, height:720 });
p.on('console', (m) => { const t = m.text(); if (t.includes('静态合批')) console.log('LOG', t); });
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,2500));
const r = await p.evaluate(() => { const e = window.__qingming.engine; return { calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles, meshes: (() => { let n = 0; e.scene.traverse((o) => { if (o.isMesh) n++; }); return n; })() }; });
console.log(JSON.stringify(r));
await b.close();
