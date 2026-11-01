import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1600,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
// 模拟用户截图机位：御街上空高处俯瞰
await page.evaluate(() => {
  const { engine } = window.__qingming;
  engine.camera.position.set(240, 60, 190);
  engine.lookTarget.set(180, 6, 90);
  engine.yaw = Math.atan2(-(engine.lookTarget.x - engine.camera.position.x), -(engine.lookTarget.z - engine.camera.position.z));
  engine.pitch = Math.asin(Math.max(-1, Math.min(1, (engine.lookTarget.y - engine.camera.position.y) / engine.camera.position.distanceTo(engine.lookTarget))));
  engine.setCamMode('fly');
  engine.stopCinema();
});
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: 'screenshots/high-angel.png' });
console.log('high view shot');
await browser.close();
