import puppeteer from 'puppeteer-core';
const spots = [
  ['bridge', 3500], ['sunyang', 3000], ['wharf', 3000], ['gate', 3000],
  ['lingxiao', 5000], ['jiangtai', 3500], ['star9', 3500],
  ['naihe', 5000], ['yanluo', 3000], ['fengdu', 3500], ['shibayu', 3000],
  ['zichen', 3000], ['mt_泰山', 4000], ['desert', 3500],
  ['yaochi', 3500], ['sansheng', 3000], ['wangxiang', 3500], ['mengpo', 3000], ['scroll', 3500],
];
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--window-size=1600,900', '--use-angle=default'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('PAGE:' + String(e).slice(0, 180)));
page.on('console', m => { if (m.type() === 'error') errors.push('CON:' + m.text().slice(0, 180)); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 3000));
for (const [key, wait] of spots) {
  const ok = await page.evaluate(k => window.__qingming.world.teleport(k), key).catch(e => { errors.push('TP:' + key); return false; });
  await new Promise(r => setTimeout(r, wait));
  await page.screenshot({ path: `screenshots/${key.replace(/[^\w一-龥]/g, '_')}.png` });
  console.log(`shot ${key} tp=${ok}`);
}
const stats = await page.evaluate(() => ({
  live: window.__qingming.world.liveCount(),
  heroes: window.__qingming.world.heroEntries().length,
}));
console.log('STATS:', JSON.stringify(stats));
console.log('ERRORS:', errors.length ? errors.slice(0, 12).join('\n') : 'NONE');
await browser.close();
