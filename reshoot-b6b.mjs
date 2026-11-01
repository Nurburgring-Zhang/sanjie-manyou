import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1600,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errors.push('CON:' + m.text().slice(0, 120)); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));
const shot = async (cam, look, file, wait = 1600) => {
  await page.evaluate(([c, l]) => {
    const e = window.__qingming.engine;
    if (e.camMode !== 'fly') e.setCamMode('fly');
    e.camera.position.set(c[0], c[1], c[2]);
    e.yaw = Math.atan2(-(l[0] - c[0]), -(l[2] - c[2]));
    e.pitch = Math.asin(Math.max(-1, Math.min(1, (l[1] - c[1]) / Math.hypot(l[0] - c[0], l[1] - c[1], l[2] - c[2]))));
  }, [cam, look]);
  await new Promise(r => setTimeout(r, wait));
  await page.screenshot({ path: `screenshots/${file}` });
  console.log('shot', file);
};
await shot([22, 213, -24], [22, 208.5, -37], 'b6b-jiangtai.png', 2000);       // 巡天将台+帅旗五方令旗
await shot([-75, 211, 2], [-75, 207.5, 16], 'b6b-wuku.png');                  // 武库
const p = await page.evaluate(() => window.__perf());
console.log('PERF:', JSON.stringify(p));
// 泰山翁仲远证（程序化：庙差异件无法镜头远拉断言，用几何计数代理——改为PERF对比+庙名匾已在audit mt_泰山机位）
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
