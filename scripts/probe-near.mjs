/**
 * 场景对象取证：把某世界坐标邻域内的网格/实例找出来（含 InstancedMesh 与带变换的网格）。
 * 用法：node scripts/probe-near.mjs <x> <y> <z> <r> [nameRegex]
 */
import puppeteer from 'puppeteer-core';

const [X, Y, Z, R, FILTER] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=900,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
await page.goto(process.env.URL || 'http://127.0.0.1:4247/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming?.engine, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 800));

const out = await page.evaluate(([X, Y, Z, R, FILTER]) => {
  const THREE = window.__qingming.THREE;
  const re = FILTER ? new RegExp(FILTER, 'i') : null;
  const target = new THREE.Vector3(X, Y, Z);
  const hits = [];
  const v = new THREE.Vector3();
  window.__qingming.engine.scene.traverse((o) => {
    const name = o.name || o.type;
    if (re && !re.test(name)) return;
    if (o.isInstancedMesh) {
      let near = 0, minY = 1e9, maxY = -1e9;
      const m = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        if (v.distanceTo(target) <= R) { near++; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
      }
      if (near) hits.push({ name, type: 'instanced', count: o.count, near, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), mat: o.material?.name || o.material?.type });
      return;
    }
    if (!o.isMesh || !o.geometry?.getAttribute) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    // 局部包围盒中心做快速剔除
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    if (!bb.containsPoint(target) && bb.distanceToPoint(target) > R) return;
    let near = 0, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.distanceTo(target) <= R) { near++; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
    }
    if (near) hits.push({ name, type: 'mesh', near, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), mat: o.material?.name || o.material?.type, pos: o.position.toArray().map((n) => +n.toFixed(1)) });
  });
  return hits.sort((a, b) => b.near - a.near).slice(0, 30);
}, [Number(X), Number(Y), Number(Z), Number(R), FILTER || null]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
