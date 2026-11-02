import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,800', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:4287/', { waitUntil: 'domcontentloaded', timeout: 240000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await p.evaluate(() => {
  const { world, scene, THREE } = window.__qingming;
  const c = world.centers;
  const HS = 2.2, HB = 196;
  const LX = 1.75, LY = 233, LZ = 209;
  const names = ['arena', 'gate', 'palace', 'court', 'pantao', 'furnace', 'moon', 'lotus', 'lotus2', 'high'];
  const centers = {};
  for (const n of names) {
    if (!c[n]) continue;
    const v = c[n];
    const s2 = [v.x * HS, HB + (v.y - HB) * HS, v.z * HS];
    const k = (n === 'palace' || n === 'court') ? LX : 1;
    centers[n] = {
      pre: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)],
      post22: s2.map((q) => +q.toFixed(2)),
      final: [s2[0], s2[1] + 0, s2[2] === null ? 0 : LZ + (s2[2] - LZ) * k].map((q) => +q.toFixed(2)),
    };
  }

  // 三角面统计
  const groups = {};
  let total = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    if (!o.name.startsWith('city_')) return;
    const key = o.name.replace(/^city_/, '').replace(/_\d+$/, '');
    groups[key] = (groups[key] || 0) + tri;
    total += tri;
  });

  // 凌霄殿包围盒：city_* 里 y>230、z 120..450、|x|<260 的顶点
  const box = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9, n: 0 };
  const boxWood = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9, n: 0 };
  const layerHist = {};
  scene.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('city_')) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y < 230 || z < 110 || z > 460 || Math.abs(x) > 260) continue;
      box.n++;
      box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
      box.minZ = Math.min(box.minZ, z); box.maxZ = Math.max(box.maxZ, z);
      if (o.name === 'city_wood' || o.name === 'city_wall' || o.name === 'city_roof' || o.name === 'city_metal') {
        boxWood.n++;
        boxWood.minX = Math.min(boxWood.minX, x); boxWood.maxX = Math.max(boxWood.maxX, x);
        boxWood.minY = Math.min(boxWood.minY, y); boxWood.maxY = Math.max(boxWood.maxY, y);
        boxWood.minZ = Math.min(boxWood.minZ, z); boxWood.maxZ = Math.max(boxWood.maxZ, z);
      }
      if (o.name === 'city_roof') {
        const k = Math.round(y / 5) * 5;
        layerHist[k] = (layerHist[k] || 0) + 1;
      }
    }
  });

  // 云台（石座）在 z 方向的边界：city_wall 在 y 200..240 的 z 范围
  const plat = { minZ: 1e9, maxZ: -1e9, minX: 1e9, maxX: -1e9, n: 0 };
  scene.traverse((o) => {
    if (!o.isMesh || o.name !== 'city_wall') return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 200 || y > 236) continue;
      const x = pos.getX(i), z = pos.getZ(i);
      if (z < 40 || z > 380 || Math.abs(x) > 200) continue;
      plat.n++;
      plat.minZ = Math.min(plat.minZ, z); plat.maxZ = Math.max(plat.maxZ, z);
      plat.minX = Math.min(plat.minX, x); plat.maxX = Math.max(plat.maxX, x);
    }
  });
  return { centers, total, groups, box, boxWood, plat, lxScaled: window.__lxScaled ?? null };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
