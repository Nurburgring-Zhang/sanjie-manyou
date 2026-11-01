import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--window-size=800,600'],
});
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
for (const key of ['mt_泰山', 'shibayu']) {
  const r = await page.evaluate((key) => {
    const { world, engine, scene, THREE } = window.__qingming;
    world.teleport(key); engine.step(1 / 30);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), engine.camera);
    const hits = rc.intersectObjects(scene.children, true).slice(0, 3);
    return {
      cam: engine.camera.position.toArray().map(n => +n.toFixed(0)),
      look: engine.lookTarget.toArray().map(n => +n.toFixed(0)),
      hits: hits.map(h => {
        let o = h.object; const chain = [];
        for (let i = 0; i < 2 && o; i++) { chain.push(o.name || o.type); o = o.parent; }
        return { d: +h.distance.toFixed(0), obj: chain.join('<'), p: h.point.toArray().map(n => +n.toFixed(0)) };
      }),
    };
  }, key);
  console.log(key, JSON.stringify(r));
}
await browser.close();
