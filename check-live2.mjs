import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1280,720'] });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!(window).__qingming, { timeout: 150000 });
const r = await page.evaluate(() => {
  const { world, engine } = window.__qingming;
  // 初始 live vs 现在隐藏的原因分布
  const hidden = world.crowd.actors.filter(a => a.hidden);
  const byOcc = {};
  for (const a of hidden) byOcc[a.occ] = (byOcc[a.occ] || 0) + 1;
  const clock = world.clock;
  return { total: world.crowd.actors.length, hidden: hidden.length, byOcc,
    time: clock ? clock.hhmm() : '?', day: clock ? clock.day : '?' };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
