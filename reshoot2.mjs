import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--window-size=1600,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
for (const [key, wait] of [['shibayu', 3500], ['zichen', 3000], ['fengdu', 3000], ['desert', 3000]]) {
  await page.evaluate(k => window.__qingming.world.teleport(k), key);
  await new Promise(r => setTimeout(r, wait));
  await page.screenshot({ path: `screenshots/${key}.png` });
  console.log('shot', key);
}
await browser.close();
