import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--window-size=800,600'],
});
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));
const r = await page.evaluate(() => {
  const { scene } = window.__qingming;
  const out = {};
  const scan = (meshName, test) => {
    const mesh = scene.getObjectByName(meshName);
    if (!mesh) return 'NO MESH';
    const pos = mesh.geometry.getAttribute('position');
    let n = 0, sample = null;
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i), yy = pos.getY(i), z = pos.getZ(i);
      if (test(x, yy, z)) { n++; if (!sample) sample = [x, yy, z].map(v => +v.toFixed(0)); }
    }
    return { n, sample };
  };
  out.taishan_wall = scan('city_wall', (x, y, z) => x > 13300 && x < 14700 && z > -6700 && z < -5300 && y > 500);
  out.ring_glow = scan('city_glow', (x, y, z) => y < -200 && Math.hypot(x + 600, z - 900) < 400);
  out.fengdu_wall = scan('city_wall', (x, y, z) => y < -200 && x > 400 && x < 900 && Math.abs(z) < 100);
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
