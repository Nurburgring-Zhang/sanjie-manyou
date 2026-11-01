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
const U = -260;
await shot([3, U + 4.2, -97], [0, U + 3.5, -60], 'b3-naihe-south.png');      // 南引道+碑亭+灯列
await shot([0, U + 4.8, -49], [0, U + 5.4, -60], 'b3-naihe-mirror.png');     // 桥心照魂镜
await shot([24, U + 3, -97], [24, U + 4, -110], 'b3-sansheng.png');          // 三生石三照面
await shot([-142, U + 18.5, -141], [-150, U + 16.5, -150], 'b3-wangxiang.png', 2000); // 台顶罗盘
const stats = await page.evaluate(() => {
  const w = window.__qingming.world;
  const guards = w.crowd.actors.filter(a => a.data && ['bridgeS', 'bridgeN', 'wxguard'].includes(a.data.code)).length;
  return { guards, live: w.liveCount() };
});
console.log('STATS:', JSON.stringify(stats));
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
