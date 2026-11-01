import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
// ISS-22 修正断言：视线方向与 POI 方向夹角 < 2°
const ang = await page.evaluate(() => {
  const { world, engine, THREE } = window.__qingming;
  engine.camera.position.set(0, 40, 200); engine.yaw = 0; engine.pitch = 0;
  world.teleport('bridge');
  engine.step(1 / 30); engine.step(1 / 30);
  const dir = new THREE.Vector3().subVectors(engine.lookTarget, engine.camera.position).normalize();
  const want = new THREE.Vector3(0, 14.5, 0).sub(engine.camera.position).normalize();
  return +THREE.MathUtils.radToDeg(dir.angleTo(want)).toFixed(2);
});
console.log((ang < 2 ? 'PASS' : 'FAIL') + ' ISS-22 传送视线夹角 ' + ang + '°（<2° 合格）');
// ISS-23 修正断言：河断面 y∈[-1,1] 必须有水面/地坪层（过滤动态飞行单位）
const river = await page.evaluate(() => {
  const { scene, THREE } = window.__qingming;
  const rc = new THREE.Raycaster();
  rc.set(new THREE.Vector3(0, 60, 0), new THREE.Vector3(0, -1, 0));
  const hs = rc.intersectObjects(scene.children, true);
  return hs.filter(h => h.point.y > -1.5 && h.point.y < 1.5).map(h => h.object.name + '@' + h.point.y.toFixed(2));
});
console.log((river.length ? 'PASS' : 'FAIL') + ' ISS-23 河断面 0m 层: ' + JSON.stringify(river));
await browser.close();
