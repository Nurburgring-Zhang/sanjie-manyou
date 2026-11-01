import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1600,900', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));
const shot = async (cam, look, file, wait = 1300) => {
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
await shot([219.6, 2.5, 61.6], [229.5, 0.9, 67.8], 'b1-sunyang-hall.png');      // 堂内：柜台+武松+桌阵+敞前
await shot([231.5, 5.7, 61.2], [221.5, 5.2, 68.5], 'b1-sunyang-2f.png');        // 二层雅间向西
await shot([555.5, 2.5, -16.2], [562.5, 1.3, -23.2], 'b1-yamen-hall.png');      // 府衙大堂向东北：案+屏+匾
await shot([9.5, 9.5, 33], [0.5, 6.5, 19], 'b4-yangzhi-zhouqiao.png', 1800);    // 州桥杨志近景
await shot([226, 4.2, 85.5], [226, 6.5, 66], 'b1-sunyang-street.png', 1800);    // 正店街面正观：欢门+匾
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
