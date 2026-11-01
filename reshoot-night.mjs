import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1600,900', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => { const e = window.__qingming.engine; e.time.paused = true; e.time.jump('night'); });
await new Promise(r => setTimeout(r, 800));
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
await shot([231.5, 1.85, 68.2], [221.0, 1.25, 62.0], 'b1-sunyang-hall.png');
await shot([231.8, 5.9, 63.4], [222.0, 5.6, 66.6], 'b1-sunyang-2f.png');
await shot([560, 2.6, -13.6], [560, 1.4, -23], 'b1-yamen-hall.png'); // 正南轴向：匾-案-屏一线
await shot([3.2, 8.6, 25.2], [0.4, 7.5, 20.0], 'b4-yangzhi-zhouqiao.png', 1800); // 贴桥面近观，水面出画
await shot([228.5, 5.4, 91], [225.5, 7.4, 64], 'b1-sunyang-street.png', 1800); // 欢门退至中景
// 府衙金楔射线定位
const probe = await page.evaluate(() => {
  const { THREE, scene } = window.__qingming;
  const rc = new THREE.Raycaster();
  const org = new THREE.Vector3(555.2, 2.2, -16.4);
  const tgt = new THREE.Vector3(559, 2.6, -23.5); // 金楔区域
  const dir = tgt.clone().sub(org).normalize();
  rc.set(org, dir);
  const lines = [];
  for (const ch of scene.children) {
    if (!ch.visible) continue;
    for (const x of rc.intersectObject(ch, true).slice(0, 2)) {
      const f = x.face; if (!f) continue;
      const va = x.object.geometry.attributes.position;
      const vs = [f.a, f.b, f.c].map(i => [va.getX(i), va.getY(i), va.getZ(i)]);
      const cx = (vs[0][0] + vs[1][0] + vs[2][0]) / 3, cy = (vs[0][1] + vs[1][1] + vs[2][1]) / 3, cz2 = (vs[0][2] + vs[1][2] + vs[2][2]) / 3;
      lines.push(`${ch.name || ch.type}@${x.distance.toFixed(1)} ctr=(${cx.toFixed(1)},${cy.toFixed(1)},${cz2.toFixed(1)})`);
    }
    if (lines.length > 5) break;
  }
  return lines;
});
console.log('YAMEN CONES:', probe.join(' | '));
console.log('ERRORS:', errors.length ? errors.join('|') : 'NONE');
await browser.close();
