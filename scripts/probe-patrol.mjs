import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,2500));
const r = await p.evaluate(() => {
  const c = window.__qingming.world.crowd;
  const list = c.actors || c.list || [];
  const sol = list.filter((a) => a.data && a.data.code === 'soldier');
  const gen = list.filter((a) => a.data && a.data.code === 'gen');
  const movers = sol.filter((a) => typeof a.attach === 'function');
  const p0 = movers.slice(0, 3).map((a) => [a.pos.x.toFixed(1), a.pos.z.toFixed(1)]);
  return { total: list.length, soldiers: sol.length, generals: gen.length, patrol: movers.length, sample: p0 };
});
console.log(JSON.stringify(r));
await p.evaluate(()=>1);
await new Promise(r=>setTimeout(r,1200));
const r2 = await p.evaluate(() => {
  const c = window.__qingming.world.crowd;
  const list = c.actors || c.list || [];
  const movers = list.filter((a) => a.data && a.data.code === 'soldier' && typeof a.attach === 'function').slice(0,3);
  return movers.map((a) => [a.pos.x.toFixed(2), a.pos.z.toFixed(2)]);
});
console.log('after', JSON.stringify(r2));
await b.close();
