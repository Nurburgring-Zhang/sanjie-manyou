/**
 * P2·构件超出自身标称包围盒 —— 抓「屋顶斜插出白板」「翻面」这一类。
 *
 * 背景（用户原话）：「有些建筑的屋顶还是错误的，天界人间界地府都有这个问题，彻底解决！」
 * 现场：河岸铺面的屋顶上斜插出许多白色薄片，朝不同方向斜指。
 *
 * 原理：屋面类几何是**按单位足迹建好、再按实例缩放摆位**的。
 * 只要几何自身顶点超出了标称盒（x/z ∈ [−0.5, 0.5]、y ∈ [0, 1]），
 * 每个实例都会按自己的尺寸把这个越界放大 —— 于是大房子上的越界成了"斜插出来的板子"。
 * 因此**不需要逐实例扫描**，逐几何检查本地包围盒即可，且结论与实例无关。
 *
 * 判据：
 *   A. 任一屋面类几何的本地包围盒，x/z 超出 ±0.75 或 y 超出 [−0.15, 1.45] 的幅度 > 0.02 → 报；
 *   B. 任一屋面类几何里「面法线朝下（ny < −0.5）」的三角面占比 > 2% → 报（翻面）。
 *
 * 用法：PROBE_URL=http://localhost:4173/ node scripts/probe-bbox-escape.mjs
 * 退出码 0 = 无越界且无翻面；1 = 有。
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';
const TOL = 0.02;
const BOX = { xz: 0.75, yMin: -0.15, yMax: 1.45 };
const FLIP_RATIO = 0.02;

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate(({ tol, box, flipRatio }) => {
  const THREE = window.__qingming.THREE;
  const scene = window.__qingming.scene;
  // 只查「按单位足迹建模、按实例缩放」的屋面/饰件类几何
  const KIND = /(roof|gable|tent|shed|thatch|blockroof|gwall|slab|eave|fabric)/;
  const seen = new Set();
  const rows = [];

  const objs = [];
  scene.traverse((o) => {
    if (o.isInstancedMesh || o.isMesh) objs.push(o);
  });

  for (const o of objs) {
    const nm = o.name || '';
    if (!KIND.test(nm)) continue;
    // 跳过合批后的大网格（`city_*` 动辄几百万面）——它们不是「按单位足迹建模再实例缩放」的几何，
    // 逐三角算法线会把页面拖死（实测直接崩掉渲染进程）。
    if (nm.startsWith('city_')) continue;
    const g = o.geometry;
    if (!g || !g.getAttribute('position')) continue;
    const triAll = Math.floor((g.index ? g.index.count : g.getAttribute('position').count) / 3);
    if (triAll > 200000) continue;
    // 同一份几何会被多个网格复用，按 geometry.uuid 去重
    if (seen.has(g.uuid)) continue;
    seen.add(g.uuid);

    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const ex = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const ez = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));

    // 翻面统计
    const pos = g.getAttribute('position');
    const idx = g.index ? g.index.array : null;
    const triCount = Math.floor((idx ? idx.length : pos.count) / 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    let down = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      const L = n.length();
      if (L < 1e-9) continue;
      if (n.y / L < -0.5) down++;
    }
    const flip = triCount ? down / triCount : 0;

    const escape = Math.max(ex - box.xz, ez - box.xz, box.yMin - bb.min.y, bb.max.y - box.yMax);
    const bad = escape > tol || flip > flipRatio;
    if (bad) {
      rows.push({
        mesh: nm,
        tris: triCount,
        bbox: [+bb.min.x.toFixed(3), +bb.min.y.toFixed(3), +bb.min.z.toFixed(3),
               +bb.max.x.toFixed(3), +bb.max.y.toFixed(3), +bb.max.z.toFixed(3)],
        escape: +escape.toFixed(3),
        downFacingRatio: +flip.toFixed(3),
        reason: [escape > tol ? 'bbox' : '', flip > flipRatio ? 'flip' : ''].filter(Boolean).join('+'),
      });
    }
  }
  return { checkedGeometries: seen.size, badCount: rows.length, rows: rows.slice(0, 40) };
}, { tol: TOL, box: BOX, flipRatio: FLIP_RATIO });

console.log(JSON.stringify(out, null, 1));
const pass = out.badCount === 0;
console.log(pass ? 'PASS' : `FAIL (${out.badCount} 个几何越界/翻面)`);
await browser.close();
process.exit(pass ? 0 : 1);
