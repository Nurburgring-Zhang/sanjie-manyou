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
const shot = async (cam, look, file, wait = 1500) => {
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
await shot([0, 222, 108], [0, 218, 88], 'b5-lingxiao-court.png', 2000);   // 凌霄明间（藻井/背屏/帷）
await shot([150, 210, 34], [150, 207, 22], 'b5-doushuai-furnace.png');    // 兜率丹炉
await shot([40, 215, -48], [41, 212, -58], 'b5-guanghan.png', 1800);      // 广寒月华堂+桂庭
const p = await page.evaluate(() => window.__perf());
console.log('PERF:', JSON.stringify(p));
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
