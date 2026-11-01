import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1600,900', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));
const shot = async (cam, look, file, wait = 1400) => {
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
await shot([222.2, 1.9, 63.2], [231, 1.15, 68.2], 'b1-sunyang-hall.png');     // 堂内低机位：武松+桌阵+烛
await shot([230.8, 5.9, 62.5], [221.8, 5.3, 67.5], 'b1-sunyang-2f.png');      // 二层
await shot([554.8, 2.4, -16.6], [561.5, 1.2, -22.8], 'b1-yamen-hall.png');    // 府衙
await shot([7.2, 9.2, 30.5], [0.5, 7.4, 20.2], 'b4-yangzhi-zhouqiao.png', 1800);
await shot([226, 4.6, 84.5], [226, 6.8, 66], 'b1-sunyang-street.png', 1800);
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
