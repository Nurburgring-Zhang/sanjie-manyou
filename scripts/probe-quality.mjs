/** 自适应画质验证：软件渲染下帧时间必然超标，应在 ~150 帧内自动降档（高→中→低），并能读到档位变化 */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width:1280, height:720 });
await p.goto((process.env.PREVIEW_URL||'http://localhost:4173/') + '?slow=1', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
const t0 = Date.now();
let seen = [];
for (let i = 0; i < 26; i++) {
  await new Promise(r=>setTimeout(r,700));
  const q = await p.evaluate(() => {
    const e = window.__qingming.engine;
    return { q: e.quality.name, auto: e.qualityAuto, samples: e.frameSamples, avgMs: e.lastAvgMs, changes: e.qualityChanges, bloom: e.quality.bloom, shadow: e.quality.shadows };
  });
  if (!seen.length || seen[seen.length-1].q !== q.q) seen.push({ t: ((Date.now()-t0)/1000).toFixed(1), ...q });
  else { seen[seen.length-1] = { ...seen[seen.length-1], samples: q.samples, avgMs: q.avgMs, changes: q.changes }; }
}
console.log(JSON.stringify({ path: seen, downgraded: seen.some((s) => s.q !== 'high') }, null, 1));
await b.close();
