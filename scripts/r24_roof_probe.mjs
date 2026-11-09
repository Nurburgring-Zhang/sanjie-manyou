/**
 * R24：定位用户截图「为什么还有一片巨型屋顶」。
 * ① 枚举所有 roof/瓦 相关合批网格的包围盒，找异常巨大的单块屋顶；
 * ② 从 y=400 向下打网格射线，统计「最上层是屋顶」的采样点分布与高度；
 * ③ 复现高空俯瞰机位实拍。
 * 用法：node scripts/r24_roof_probe.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2600));

const setCam = (c) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(c[3], c[4], c[5]);
  const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
};

const report = { at: new Date().toISOString(), url: URL, pageErrors: errs, shots: [] };

report.roofMeshes = await page.evaluate(() => {
  const q = window.__qingming;
  const out = [];
  q.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    if (!/roof/i.test(n)) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const pos = o.geometry.attributes.position;
    out.push({
      name: n,
      min: [bb.min.x, bb.min.y, bb.min.z].map((v) => +v.toFixed(1)),
      max: [bb.max.x, bb.max.y, bb.max.z].map((v) => +v.toFixed(1)),
      spanX: +(bb.max.x - bb.min.x).toFixed(1),
      spanZ: +(bb.max.z - bb.min.z).toFixed(1),
      verts: pos ? pos.count : 0,
    });
  });
  return out.sort((a, b) => b.spanX * b.spanZ - a.spanX * a.spanZ).slice(0, 25);
});

// 只做 9 个采样点的轻量射线（整场景三角面达千万级，网格射线会触发 CDP 超时）
report.grid = await page.evaluate(() => {
  const q = window.__qingming, THREE = q.THREE;
  const meshes = [];
  q.scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const samples = [];
  for (const x of [-3000, 0, 3000]) {
    for (const z of [-3000, 0, 3000]) {
      ray.set(new THREE.Vector3(x, 300, z), down);
      const top = ray.intersectObjects(meshes, false)[0];
      samples.push({ x, z, top: top ? (top.object.name || '(unnamed)') + '@' + top.point.y.toFixed(2) : null });
    }
  }
  return { meshCount: meshes.length, samples };
});

const CAMS = [
  { id: 'A-high-oblique', label: '高空斜俯瞰（复现用户第二张）', cam: [0, 1500, 4200, 0, 0, -3200] },
  { id: 'B-top-down', label: '正俯瞰', cam: [0, 2600, 200, 0, 0, 0] },
];
for (const c of CAMS) {
  await page.evaluate(setCam, c.cam);
  await new Promise((r) => setTimeout(r, 1800));
  const file = path.join(OUT, 'r24-roof-' + c.id + '.png');
  await page.screenshot({ path: file });
  report.shots.push({ id: c.id, label: c.label, cam: c.cam, file });
  console.log('shot', c.id, '->', file);
}

fs.writeFileSync(path.join(OUT, 'r24-roof-probe.json'), JSON.stringify(report, null, 2));
console.log('roof meshes (largest first):');
console.log(JSON.stringify(report.roofMeshes.slice(0, 12), null, 1));
console.log('top samples:', JSON.stringify((report.grid.samples || []).slice(0, 10)));
await browser.close();
