import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
const r = await page.evaluate(() => {
  const { world, engine, scene, THREE } = window.__qingming;
  engine.camera.position.set(210, 80, 140);
  engine.lookTarget.set(210, 0, 100);
  engine.step(1 / 30);
  const rc = new THREE.Raycaster();
  const out = [];
  for (const du of [[0, 0], [30, 0], [0, 40], [-40, -30]]) {
    rc.setFromCamera(new THREE.Vector2(du[0] * 0.02, du[1] * 0.02), engine.camera);
    const h = rc.intersectObjects(scene.children, true)[0];
    if (h) {
      let o = h.object; const ch = [];
      for (let i = 0; i < 2 && o; i++) { ch.push(o.name || o.type); o = o.parent; }
      out.push({ obj: ch.join('<'), p: h.point.toArray().map(n => +n.toFixed(0)), d: +h.distance.toFixed(0) });
    } else out.push(null);
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
