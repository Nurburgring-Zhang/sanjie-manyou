/**
 * 场景取证：在指定点位附近列出所有网格（名称 / 实例数 / 三角面 / 材质），
 * 用来回答「这片屋顶到底是谁造的」以及改前改后的三角面预算。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4289/ node scripts/roof-gable-scene.mjs [x] [z] [半径]
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4289/';
const PX = Number(process.argv[2] ?? 2200);
const PZ = Number(process.argv[3] ?? 2400);
const R = Number(process.argv[4] ?? 260);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(({ px, pz, r }) => {
  const THREE = window.__qingming.THREE;
  const scene = window.__qingming.scene;
  const probe = new THREE.Box3(new THREE.Vector3(px - r, -400, pz - r), new THREE.Vector3(px + r, 900, pz + r));
  const rows = [];
  const m4 = new THREE.Matrix4();
  const ib = new THREE.Box3();
  let totalTris = 0, meshes = 0, instTot = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    meshes++;
    if (!g.boundingBox) g.computeBoundingBox();
    const pos = g.getAttribute('position');
    const tri = Math.floor((g.index ? g.index.count : pos.count) / 3);
    const inst = o.isInstancedMesh ? o.count : 1;
    instTot += inst;
    const tris = tri * inst;
    if (o.isInstancedMesh) {
      // 逐实例判交集：只统计落进探针盒里的实例
      let hits = 0;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        m4.premultiply(o.matrixWorld);
        ib.copy(g.boundingBox).applyMatrix4(m4);
        if (ib.intersectsBox(probe)) hits++;
      }
      if (!hits) return;
      totalTris += tri * hits;
      rows.push({ name: o.name || '(unnamed)', mat: o.material?.name || '?', tri, inst: hits, tris: tri * hits, bbox: 'instanced' });
      return;
    }
    ib.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    if (!ib.intersectsBox(probe)) return;
    totalTris += tris;
    rows.push({
      name: o.name || '(unnamed)', mat: o.material?.name || '?', tri, inst, tris,
      bbox: `${ib.min.x.toFixed(0)},${ib.min.y.toFixed(0)},${ib.min.z.toFixed(0)} .. ${ib.max.x.toFixed(0)},${ib.max.y.toFixed(0)},${ib.max.z.toFixed(0)}`,
    });
  });
  rows.sort((a, b) => b.tris - a.tris);
  return { totalTris, meshes, instTot, rows: rows.slice(0, 32), calls: window.__qingming.engine.renderer.info.render.calls };
}, { px: PX, pz: PZ, r: R });

console.log(`region (${PX},${PZ}) r=${R}  totalTris=${out.totalTris}  meshes=${out.meshes}  instances=${out.instTot}`);
for (const r of out.rows) {
  console.log(`${r.name.padEnd(36)} tri=${String(r.tri).padStart(6)} x${String(r.inst).padStart(4)} = ${String(r.tris).padStart(8)}  ${r.bbox}  mat=${r.mat}`);
}
await browser.close();
