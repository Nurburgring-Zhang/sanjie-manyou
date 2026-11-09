/**
 * R23 第四轮诊断：皇宫俯瞰/近景为什么仍以灰白铺装为主？
 * 用 Raycaster 从上往下打，读出宫城取样点的最上层网格与 y 值，
 * 再做「只隐藏 city_ground / 只隐藏 leaf」的严格 A/B 实拍。
 *
 * 用法：node scripts/r23_palace_ab.mjs
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
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming,
  { timeout: 180000 },
);
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

// 取样点：07/08 号机位可见的宫城东西两侧院落带与夹道
const SAMPLES = [
  [225, -3160], [315, -3220], [495, -3160], [675, -3300],
  [225, -3560], [405, -3620], [585, -3700], [855, -3440],
];

const probe = await page.evaluate((samples) => {
  const q = window.__qingming;
  const THREE = q.THREE;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const rows = samples.map(([x, z]) => {
    ray.set(new THREE.Vector3(x, 90, z), down);
    const hits = ray.intersectObjects(q.scene.children, true)
      .filter((h) => h.object.isMesh && h.object.visible)
      .slice(0, 6)
      .map((h) => ({ name: h.object.name || '(unnamed)', y: +h.point.y.toFixed(4) }));
    return { x, z, hits };
  });
  const groundMeshes = [];
  q.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    if (!/ground|leaf|lawn/i.test(n)) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    groundMeshes.push({
      name: n,
      min: [bb.min.x, bb.min.y, bb.min.z].map((v) => +v.toFixed(2)),
      max: [bb.max.x, bb.max.y, bb.max.z].map((v) => +v.toFixed(2)),
      tris: o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3,
    });
  });
  return { rows, groundMeshes: groundMeshes.slice(0, 40) };
}, SAMPLES);

const report = { at: new Date().toISOString(), url: URL, samples: probe.rows,
  groundMeshes: probe.groundMeshes, shots: [], pageErrors: errs };

const CAMS = [
  { id: 'A-normal', cam: [0, 250, -2660, 0, 0, -3440] },
  { id: 'B-nocityground', cam: [0, 250, -2660, 0, 0, -3440], hide: /city_ground|ground/i },
  { id: 'C-close-normal', cam: [220, 30, -3010, 220, 0, -3160] },
];

for (const c of CAMS) {
  let hidden = 0;
  if (c.hide) {
    hidden = await page.evaluate((pattern) => {
      const re = new RegExp(pattern, 'i');
      let n = 0;
      window.__r23Hidden = [];
      window.__qingming.scene.traverse((o) => {
        if (o.isMesh && o.visible && re.test(o.name || '')) {
          o.visible = false; window.__r23Hidden.push(o); n++;
        }
      });
      return n;
    }, c.hide.source);
  }
  await page.evaluate(setCam, c.cam);
  await new Promise((r) => setTimeout(r, 1600));
  const file = path.join(OUT, 'r23-palace-' + c.id + '.png');
  await page.screenshot({ path: file });
  report.shots.push({ id: c.id, file, hidden });
  console.log('shot', c.id, 'hidden=' + hidden, '->', file);
  if (hidden) {
    await page.evaluate(() => {
      for (const o of window.__r23Hidden || []) o.visible = true;
      window.__r23Hidden = [];
    });
  }
}

fs.writeFileSync(path.join(OUT, 'r23-palace-ab.json'), JSON.stringify(report, null, 2));
console.log('probe =>', path.join(OUT, 'r23-palace-ab.json'));
console.log(JSON.stringify(probe.rows.slice(0, 3), null, 2));
await browser.close();
