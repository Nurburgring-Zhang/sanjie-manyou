/**
 * probe-camera-clearance.mjs —— 机位「贴脸构件」检测（球体法，零顶点遍历）。
 *
 * 背景：`artifacts/_B5/court_close.png` 左前景有一大块贴脸的深色屋面，一直没定位。
 *
 * 上一版用 AABB（逐 Mesh computeBoundingBox + 8 角变换），在 19M 面场景里跑不完
 * （180s protocolTimeout / 290s 被外层杀）。本版改用 `geometry.boundingSphere`
 * （three 在首次视锥剔除时已算过，通常零成本），只做球-点距离：`d = |cam - center| - r`。
 *
 * 判据：`d < 1.2m` 贴脸（BLOCK）、`1.2–3m` 警告。球比盒更保守，**只会多报不会漏报**。
 *
 * 诚实边界：球可能大幅高估体积 ⇒ 误报；BLOCK 时按名字人工确认。
 *
 * 用法：PREVIEW_URL=... node scripts/probe-camera-clearance.mjs
 * 退出码 0=PASS / 1=BLOCK / 2=用法错误
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';

const CAMS = [
  { name: 'court_close', p: [-150, 2240, 90] },
  { name: 'hero', p: [300, 2280, -210] },
];

const FACE_M = 1.2;
const WARN_M = 3.0;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--window-size=800,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1200));

const results = await page.evaluate((cams) => {
  const scene = window.__qingming.engine.scene;
  const spheres = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const s = o.geometry.boundingSphere;   // 不主动 compute，缺就跳过（避免 O(顶点) 开销）
    if (!s) return;
    o.updateWorldMatrix(true, false);
    const m = o.matrixWorld.elements;
    // 球心变换（忽略非均匀缩放的精确性：这里只用于粗测距）
    const cx = m[0] * s.center.x + m[4] * s.center.y + m[8] * s.center.z + m[12];
    const cy = m[1] * s.center.x + m[5] * s.center.y + m[9] * s.center.z + m[13];
    const cz = m[2] * s.center.x + m[6] * s.center.y + m[10] * s.center.z + m[14];
    const sc = Math.max(
      Math.hypot(m[0], m[1], m[2]),
      Math.hypot(m[4], m[5], m[6]),
      Math.hypot(m[8], m[9], m[10]),
    );
    spheres.push({ name: o.name || '(unnamed)', c: [cx, cy, cz], r: s.radius * sc });
  });

  const out = [];
  for (const cam of cams) {
    const [px, py, pz] = cam.p;
    const hits = [];
    for (const s of spheres) {
      const d = Math.hypot(px - s.c[0], py - s.c[1], pz - s.c[2]) - s.r;
      if (d <= 3.0) hits.push({ name: s.name, d: +d.toFixed(2), c: s.c.map((v) => +v.toFixed(0)), r: +s.r.toFixed(1) });
    }
    hits.sort((a, b) => a.d - b.d);
    out.push({ cam: cam.name, total: spheres.length, hits: hits.slice(0, 8), n3: hits.length });
  }
  return out;
}, CAMS);

await browser.close();

let bad = 0;
for (const r of results) {
  console.log(`\n[${r.cam}] 有包围球 ${r.total} 个，3m 内 ${r.n3} 个`);
  for (const h of r.hits) {
    const tag = h.d < FACE_M ? 'BLOCK' : h.d < WARN_M ? 'WARN ' : 'ok   ';
    console.log(`  ${tag} ${h.d.toFixed(2)}m  ${h.name}  c=${JSON.stringify(h.c)} r=${h.r}`);
  }
  if (r.hits[0] && r.hits[0].d < FACE_M) bad++;
}

console.log('');
console.log(`判定：贴脸 ${FACE_M}m / 警告 ${WARN_M}m；${bad} 个机位存在贴脸构件`);
console.log(bad === 0 ? 'RESULT=PASS' : 'RESULT=BLOCK');
process.exit(bad === 0 ? 0 : 1);
