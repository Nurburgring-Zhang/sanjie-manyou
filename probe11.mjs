import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
const r = await page.evaluate(() => {
  const { scene, THREE } = window.__qingming;
  const rc = new THREE.Raycaster();
  const pts = [];
  for (const [x, z] of [[100, 150], [300, 120], [150, 60], [350, 60], [0, 120], [-200, 150], [450, 100], [500, -50]]) {
    rc.set(new THREE.Vector3(x, 90, z), new THREE.Vector3(0, -1, 0));
    rc.far = 120;
    const hs = rc.intersectObjects(scene.children, true);
    const wallHit = hs.find(h => h.object.name === 'city_wall' && h.point.y < 2);
    pts.push({ x, z, hit: wallHit ? { y: +wallHit.point.y.toFixed(2) } : (hs[0] ? hs[0].object.name + '@' + hs[0].point.y.toFixed(1) : 'MISS') });
  }
  return pts;
});
console.log(JSON.stringify(r));
await browser.close();
