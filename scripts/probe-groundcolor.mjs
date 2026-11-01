/** 按顶点色检索 city_ground：统计出现最多的色值及其包围盒，直接定位「深灰矩形」是哪一块 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,700));
const rows = await p.evaluate(() => {
  const e = window.__qingming.engine;
  let mesh = null;
  e.scene.traverse((o) => { if (o.isMesh && o.name === 'city_ground') mesh = o; });
  if (!mesh) return { err: 'no city_ground' };
  const g = mesh.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color');
  const buckets = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = [Math.round(col.getX(i) * 255 / 8) * 8, Math.round(col.getY(i) * 255 / 8) * 8, Math.round(col.getZ(i) * 255 / 8) * 8].join(',');
    let s = buckets.get(key);
    if (!s) { s = { n: 0, minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, y: 0 }; buckets.set(key, s); }
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    s.n++; s.y += y;
    if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x;
    if (z < s.minZ) s.minZ = z; if (z > s.maxZ) s.maxZ = z;
  }
  return [...buckets.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([k, s]) => ({
    rgb: k, verts: s.n, y: +(s.y / s.n).toFixed(2),
    x: [Math.round(s.minX), Math.round(s.maxX)], z: [Math.round(s.minZ), Math.round(s.maxZ)],
  }));
});
console.log(JSON.stringify(rows, null, 1));
await b.close();
