import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
const r = await page.evaluate(() => {
  const { scene, THREE } = window.__qingming;
  const rc = new THREE.Raycaster();
  const down = (x, z) => {
    rc.set(new THREE.Vector3(x, 80, z), new THREE.Vector3(0, -1, 0));
    const h = rc.intersectObjects(scene.children, true)[0];
    return h ? { obj: h.object.name, y: +h.point.y.toFixed(2), d: +h.distance.toFixed(0) } : 'MISS';
  };
  const mesh = scene.getObjectByName('city_ground');
  let nanCount = 0, bs = null;
  if (mesh) {
    mesh.geometry.computeBoundingSphere();
    bs = { center: mesh.geometry.boundingSphere.center.toArray().map(n => +n.toFixed(0)), radius: +mesh.geometry.boundingSphere.radius.toFixed(0) };
    const pa = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pa.count; i++) if (Number.isNaN(pa.getX(i)) || Number.isNaN(pa.getY(i)) || Number.isNaN(pa.getZ(i))) nanCount++;
  }
  return {
    north_210_60: down(210, 60), north_210_80: down(210, 80),
    south_210_300: down(210, 300), south_0_200: down(0, 200),
    river_0_0: down(0, 0), river_400_0: down(400, 0),
    bs, nanCount, visible: mesh?.visible, frustumCulled: mesh?.frustumCulled,
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
