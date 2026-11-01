/**
 * 命中三角面取证：从 A 到 B 打射线，输出命中面的三个世界顶点 + 法线 + 所属网格。
 * 用法：node scripts/probe-face.mjs <ax> <ay> <az> <bx> <by> <bz>
 */
import puppeteer from 'puppeteer-core';

const [AX, AY, AZ, BX, BY, BZ] = process.argv.slice(2).map(Number);
const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=800,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.goto(process.env.URL || 'http://127.0.0.1:4247/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming?.engine, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 600));
const out = await page.evaluate(([AX, AY, AZ, BX, BY, BZ]) => {
  const THREE = window.__qingming.THREE;
  const scene = window.__qingming.engine.scene;
  const a = new THREE.Vector3(AX, AY, AZ), b = new THREE.Vector3(BX, BY, BZ);
  const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
  const ray = new THREE.Raycaster(a, dir, 0.01, len + 0.01);
  const targets = [];
  scene.traverse((o) => { if (o.isMesh && o.visible && !/heavenMist|cloudSea|sky_cloudSheets|pool_cloud/.test(o.name || '')) targets.push(o); });
  const hits = ray.intersectObjects(targets, false).slice(0, 8);
  return hits.map((h) => {
    const g = h.object.geometry;
    const pa = g.getAttribute('position');
    const f = h.face;
    const verts = f ? [f.a, f.b, f.c].map((i) => {
      const v = new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(h.object.matrixWorld);
      return v.toArray().map((n) => +n.toFixed(2));
    }) : null;
    return {
      name: h.object.name || h.object.type,
      dist: +h.distance.toFixed(2),
      at: h.point.toArray().map((n) => +n.toFixed(2)),
      normal: f ? f.normal.toArray().map((n) => +n.toFixed(2)) : null,
      verts,
    };
  });
}, [AX, AY, AZ, BX, BY, BZ]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
