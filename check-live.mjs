import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1280,720'] });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!(window).__qingming, { timeout: 150000 });
const r = await page.evaluate(() => {
  const { world, engine } = window.__qingming;
  const samples = [];
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 900; k++) engine.step(1 / 30); // +30s 真实=1游戏时
    samples.push(`h${engine.time.hour?.() ?? '?'}:${world.liveCount()}`);
  }
  return samples;
});
console.log('LIVE_TIMELINE:', r.join(' '));
await browser.close();
