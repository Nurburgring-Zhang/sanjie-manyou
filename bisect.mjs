import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1200,675'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 675 });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
// 进入同一高空机位
await page.evaluate(() => {
  const { engine } = window.__qingming;
  engine.camera.position.set(240, 60, 190);
  engine.lookTarget.set(180, 6, 90);
  engine.yaw = Math.atan2(-(engine.lookTarget.x - engine.camera.position.x), -(engine.lookTarget.z - engine.camera.position.z));
  engine.pitch = Math.asin(Math.max(-1, Math.min(1, (engine.lookTarget.y - engine.camera.position.y) / engine.camera.position.distanceTo(engine.lookTarget))));
  engine.setCamMode('fly');
  engine.stopCinema();
});
await new Promise(r => setTimeout(r, 1500));
const steps = [
  ['base', () => {}],
  ['no-dome', () => { const d = window.__qingming.scene.children.find(c => c.geometry && c.geometry.type === 'SphereGeometry'); if (d) d.visible = false; }],
  ['no-haze', () => { window.__qingming.scene.children.filter(c => c.name === '').forEach(() => {}); const h = window.__qingming.scene.children.filter(c => c.type === 'Mesh' && c.geometry?.type === 'RingGeometry'); h.forEach(x => x.visible = false); }],
  ['no-glow', () => { const g = window.__qingming.scene.getObjectByName('city_glow'); if (g) g.visible = false; }],
];
for (const [name, fn] of steps) {
  await page.evaluate(fn);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `screenshots/bisect-${name}.png` });
  console.log('shot', name);
}
await browser.close();
