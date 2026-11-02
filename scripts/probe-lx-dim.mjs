import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:4289/', { waitUntil: 'domcontentloaded', timeout: 240000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 900));
const out = await p.evaluate(() => {
  const { scene } = window.__qingming;
  // 殿身外皮：y 300..330（窗带），|z-209|<80，|x|<200 —— 统计 |x| 的直方图找墙面/柱面
  const xs = {};
  const zs = [];
  let maxY = -1e9, minY = 1e9;
  const regionBox = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
  scene.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('city_')) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(x) > 200 || z < 100 || z > 330 || y < 230 || y > 520) continue;
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
      regionBox.minX = Math.min(regionBox.minX, x); regionBox.maxX = Math.max(regionBox.maxX, x);
      regionBox.minZ = Math.min(regionBox.minZ, z); regionBox.maxZ = Math.max(regionBox.maxZ, z);
      if (y > 296 && y < 334) {
        const ax = Math.abs(x);
        if (ax > 110 && ax < 130) xs[ax.toFixed(1)] = (xs[ax.toFixed(1)] || 0) + 1;
        if (ax > 116 && ax < 124) zs.push(z);
      }
    }
  });
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const topX = Object.entries(xs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  let total = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.name.startsWith('city_')) return;
    total += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return {
    region: Object.fromEntries(Object.entries(regionBox).map(([k, v]) => [k, +v.toFixed(1)])),
    maxY: +maxY.toFixed(2),
    wallPlaneHist: topX,
    wallZ: [+zmin.toFixed(1), +zmax.toFixed(1)],
    tris: Math.round(total),
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
