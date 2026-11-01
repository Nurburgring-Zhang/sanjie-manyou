// 载入探针：逐步打印 [加载] 日志，并在超时后判定主线程是否被同步死循环冻住。
// 用法：node scripts/probe-load.mjs [url] [ms]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:4173/';
const budget = Number(process.argv[3] || 90000);

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  protocolTimeout: 120000,
  args: ['--window-size=800,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
let last = '(none)';
page.on('console', (m) => {
  const t = m.text();
  if (!t.includes('[加载]')) return;
  if (t.includes('▶')) last = t;
  console.log(t);
});
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));

console.log('goto', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('GOTO', e.message));

const t0 = Date.now();
let loaded = false;
while (Date.now() - t0 < budget) {
  const ok = await page
    .waitForFunction(() => !document.getElementById('loading'), { timeout: 4000, polling: 500 })
    .then(() => true)
    .catch(() => false);
  if (ok) {
    loaded = true;
    console.log('LOADED', ((Date.now() - t0) / 1000).toFixed(1));
    break;
  }
}
console.log('LAST_STEP:', last);
console.log('LOADED:', loaded);
if (loaded) {
  const tm = await page.evaluate(() => window.__loadTimings ?? null).catch(() => null);
  console.log('TIMINGS', JSON.stringify(tm));
}
try {
  await page.evaluate(() => 1);
  console.log('MAIN_THREAD: alive');
} catch {
  console.log('MAIN_THREAD: BLOCKED');
}
await browser.close().catch(() => {});
process.exit(0);
