import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PE:' + String(e).slice(0, 150)));
page.on('console', m => { if (m.type() === 'error') errs.push('CE:' + m.text().slice(0, 150)); });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const st = await page.evaluate(() => ({
    tip: document.querySelector('.load-tip')?.textContent,
    bar: document.querySelector('#loading .load-bar i')?.style.width,
    handle: !!(window).__qingming,
  })).catch(e => String(e).slice(0, 80));
  console.log(i * 10 + 's', JSON.stringify(st));
  if (st.handle) break;
}
console.log('ERRS:', errs.slice(0, 8).join('\n') || 'none');
await browser.close();
