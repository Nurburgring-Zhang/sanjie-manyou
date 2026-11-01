import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1600,900', '--use-angle=default'] });
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
await shot([0, U + 9, 25], [40, U + 2, 70], 'b2-hells-ring.png', 2000);       // 狱环东北向俯瞰（蒸笼/铜柱/刀山）
await shot([95, U + 3.5, 42], [95, U + 1.5, 60], 'b2-hell22-steam.png');       // 蒸笼狱近观（重狱）
await shot([0, U + 6, 74], [0, U + 3.5, 54], 'b2-yanluo-court.png', 2000);     // 阎罗殿庭内（案/骨屏/烛阵/地藏龛）
await shot([-36, U + 2.4, -127], [-42, U + 1.2, -134], 'b2-mengpo.png');       // 孟婆庄主棚（锅/碗架/灯）
const stats = await page.evaluate(() => {
  const w = window.__qingming.world;
  const keepers = w.crowd.actors.filter(a => a.data && String(a.data.code).startsWith('keeper')).length;
  return { keepers, live: w.liveCount() };
});
console.log('STATS:', JSON.stringify(stats));
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
