import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 1500));
const out = await page.evaluate(() => {
  const w = window.__qingming.world;
  const nt = w.crowd.actors.find(x => x.data && x.data.code === 'niutou');
  const r0 = w.creatures.runners[0];
  const before = { px: nt.pos.x, pz: nt.pos.z, ai: r0.aId, ntid: nt.id, tgt: r0.pts[r0.i] };
  w.creatures.update(0.5); // 直接调 0.5s
  const after = { px: nt.pos.x, pz: nt.pos.z };
  // 再验 world.update 是否在 step 链上
  const wuBefore = nt.pos.x;
  w.update(0, 1);
  const wuAfter = nt.pos.x;
  return { before, after, directCallDx: +(after.px - before.px).toFixed(2), worldUpdateDx: +(wuAfter - wuBefore).toFixed(2) };
});
console.log(JSON.stringify(out));
await browser.close();
