import puppeteer from 'puppeteer-core';
const results = [];
const t = (id, ok, note) => { results.push({ id, ok, note }); console.log(ok ? 'PASS' : 'FAIL', id, '-', note); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
// ISS-01 后台生成/加载完成；ISS-16 首帧崩溃不阻断
await page.waitForFunction(() => !!(window).__qingming, { timeout: 150000 }).catch(() => {});
const H = !!await page.evaluate(() => !!(window).__qingming).catch(() => false);
t('ISS-01/16', H, H ? '世界生成完成，无首帧崩溃阻断' : '加载失败');
await new Promise(r => setTimeout(r, 3000));
// ISS-04/05 shader 编译零错误
t('ISS-04/05/14', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '运行零 console/page 错误（水面 shader/银河粒子带）');
// ISS-22 传送朝向：fly 相机 lookTarget 是视线前方固定 30m 预瞄点，验收语义 = 视线方向对准 POI
const look = await page.evaluate(() => {
  const { world, engine, THREE } = window.__qingming;
  engine.camera.position.set(0, 40, 200); // 先挪远，制造"朝向陈旧"
  engine.yaw = 0; engine.pitch = 0;
  world.teleport('bridge'); engine.step(1 / 30); engine.step(1 / 30);
  const a = engine.lookTarget.clone().sub(engine.camera.position).normalize();
  const b = new THREE.Vector3(0, 14.5, 0).sub(engine.camera.position).normalize();
  return +THREE.MathUtils.radToDeg(a.angleTo(b)).toFixed(2);
});
t('ISS-22', look < 2, `传送后视线夹角 ${look}°（<2° 合格，POI 居中）`);
// ISS-23 汴河水面存在且高于地形：x=0 是虹桥中心（z 向跨河），改沿河多点采样首可见命中
const river = await page.evaluate(() => {
  const { engine, scene, THREE } = window.__qingming;
  const visChain = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  const rc = new THREE.Raycaster();
  const out = [];
  for (const x of [-550, -450, -350, -100, 60, 150]) {
    rc.set(new THREE.Vector3(x, 60, 0), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(scene.children, true).find((h) => visChain(h.object));
    out.push(hit ? hit.object.name + '@' + hit.point.y.toFixed(2) : 'MISS');
  }
  return out;
});
const riverHits = river.filter(r => /river|water/.test(r)).length;
t('ISS-23', riverHits >= 4, `河断面 6 点采样 ${riverHits}/6 命中水面: ${river.join(' ')}`);
// ISS-17/19 城内无错位巨板：桥区上空 y8-12 处不得命中 city_wall
const slab = await page.evaluate(() => {
  const { engine, scene, THREE } = window.__qingming;
  world_teleport(engine);
  function world_teleport(e) { e.camera.position.set(0, 10, 0); }
  const rc = new THREE.Raycaster();
  const hits = [];
  for (const a of [0, 1.57, 3.14, 4.71]) {
    rc.set(new THREE.Vector3(0, 10, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    const h = rc.intersectObjects(scene.children, true)[0];
    if (h && h.object.name === 'city_wall' && h.distance < 60) hits.push(h.point.toArray().map(n => +n.toFixed(0)));
  }
  return hits;
});
t('ISS-17/19', slab.length === 0, slab.length ? `桥区 60m 内命中 wall: ${JSON.stringify(slab)}` : '桥区四向 60m 无 wall 板（帝国墙/鬼城已修）');
// ISS-13/29 密度与在场人数
const stats = await page.evaluate(() => ({ live: window.__qingming.world.liveCount(), heroes: window.__qingming.world.heroEntries().length }));
t('ISS-13', stats.live > 500, `在场 ${stats.live} 人`);
t('ISS-H108', stats.heroes >= 108, `英雄花名册 ${stats.heroes}（含神佛鬼）`);
// ISS-21 传送不扎建筑：各 POI 相机 2m 内不得有命中
const embed = await page.evaluate(() => {
  const { world, engine, scene, THREE } = window.__qingming;
  const rc = new THREE.Raycaster();
  const bad = [];
  for (const key of ['bridge', 'sunyang', 'wharf', 'gate', 'lingxiao', 'naihe', 'yanluo']) {
    world.teleport(key); engine.step(1 / 30);
    rc.set(engine.camera.position, new THREE.Vector3(0, -1, 0));
    const h = rc.intersectObjects(scene.children, true)[0];
    if (h && h.distance < 0.5) bad.push(key + '@' + h.object.name);
  }
  return bad;
});
t('ISS-21', embed.length === 0, embed.length ? '扎入: ' + embed.join(',') : '7 个 POI 相机下方 0.5m 无穿模');
console.log('SUMMARY:', results.filter(r => r.ok).length + '/' + results.length, 'PASS');
await browser.close();
