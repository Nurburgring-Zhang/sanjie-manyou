// 冻结主线程取证：Debugger.pause 会触发 V8 中断，即使线程正在跑同步死循环也能停下，
// 停下后读 callFrames 就知道卡在某文件的哪一行（比逐步 console.log 快一个数量级）。
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:4173/';
const waitMs = Number(process.argv[3] || 25000);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 120000,
  args: ['--window-size=800,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[加载]')) console.log(t);
});
// Debugger 必须在页面冻住之前打开：冻住后 renderer 不再响应 Debugger.enable。
const client = await page.target().createCDPSession();
await client.send('Debugger.enable');

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('GOTO', e.message));
console.log(`wait ${waitMs}ms ...`);
await new Promise((r) => setTimeout(r, waitMs));
const paused = new Promise((resolve) => client.once('Debugger.paused', resolve));
await client.send('Debugger.pause').catch((e) => console.log('PAUSE-ERR', e.message));
const ev = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 15000))]);
if (!ev) {
  console.log('NO_PAUSE_EVENT');
} else {
  console.log('reason:', ev.reason);
  for (const [i, f] of ev.callFrames.slice(0, 14).entries()) {
    const { url: u, lineNumber, columnNumber } = f.location;
    console.log(`#${i} ${f.functionName || '(anon)'} @ ${u}:${lineNumber + 1}:${columnNumber + 1}`);
  }
  await client.send('Debugger.resume').catch(() => {});
}
await browser.close().catch(() => {});
process.exit(0);
