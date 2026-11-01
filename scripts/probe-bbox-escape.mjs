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
 * ── 2026-11-02 判据收敛（旧判据的两个已知误报）──────────────────────────────
 *  ① 名字曾用宽松子串匹配 `(roof|gable|…|eave|fabric)`：`heavenMist`（云团球体）里含
 *     "eave"（h-e-a-v-e-n 的 e-a-v-e 子串），整颗球被当成屋面；
 *  ② 球体/圆柱/圆环天然半面朝下，闭合盒体的底面也天然朝下（12 面里 2 面 = 16.7%），
 *     两者都会把「朝下三角占比」直接顶过 2%，而它们都不是绕序错误。
 *
 *  收敛后的判定：
 *   1. 几何族按**名字 token** 精确匹配（按非字母切分、整词比对），只查单/双坡屋面族：
 *      roof / gable / tent / shed / thatch / blockroof / gwall / slab / eave；
 *   2. 旋转体一律排除：Sphere / Icosahedron / Cylinder / Cone / Torus / Capsule / Lathe / Tube…
 *      （云团、树冠、灯罩、柱、鼓都在这一类）；
 *   3. 仍排除合批网格（`city_` 前缀，动辄百万面，逐三角算法线会把渲染进程拖死）
 *      与 triCount > 200000；
 *   4. 朝下三角只统计「非底面」：ny < −0.5 且三角形质心高于包围盒底部 8% 的带宽。
 *      闭合体（盒、台）的底盖是正常构造，不算翻面；被写反的屋面一定出现在屋面高度上。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4269/ node scripts/probe-bbox-escape.mjs
 * 退出码 0 = 无越界且无翻面；1 = 有。
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';
const TOL = 0.02;
const BOX = { xz: 0.75, yMin: -0.15, yMax: 1.45 };
const FLIP_RATIO = 0.02;
const BOTTOM_BAND = 0.08;

/** 屋面族：整词匹配（`heavenMist`、`infill_fabric_*` 因此不会被误收） */
const ROOF_FAMILIES = new Set(['roof', 'gable', 'tent', 'shed', 'thatch', 'blockroof', 'gwall', 'slab', 'eave']);
/** 旋转体：球/柱/锥/环一类，天然有朝下的面，一律不参与翻面判定 */
const SOLID_OF_REVOLUTION = /(Sphere|Icosahedron|Dodecahedron|Octahedron|Tetrahedron|Cylinder|Cone|Torus|Capsule|Lathe|Tube)Geometry/;

const tokensOf = (name) => name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const familyOf = (name) => tokensOf(name).find((t) => ROOF_FAMILIES.has(t)) || null;

function chromePath() {
  const env = process.env.CHROME_BIN;
  if (env && fs.existsSync(env)) return env;
  const base = `${process.env.LOCALAPPDATA}\\ms-playwright`;
  for (const dir of ['chromium-1243', 'chromium-1155', 'chromium-1223']) {
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const p = `${base}\\${dir}\\${sub}\\chrome.exe`;
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('找不到可用的 Chromium：请设置 CHROME_BIN');
}

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
const waitReady = async () => {
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
};
await waitReady();
await new Promise((r) => setTimeout(r, 1200));

// dev server 会因并发编辑热更/整页重载；evaluate 失败时重等就绪再试
const evaluateWithRetry = async (fn, arg) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (err) {
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      await waitReady().catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
    }
  }
};

const out = await evaluateWithRetry(({ tol, box, flipRatio, bottomBand, families, solidRe }) => {
  const THREE = window.__qingming.THREE;
  const scene = window.__qingming.scene;
  const fam = new Set(families);
  const solid = new RegExp(solidRe);
  const seen = new Set();
  const rows = [];
  const excluded = { family: 0, solid: 0, batched: 0, tooBig: 0 };

  scene.traverse((o) => {
    if (!(o.isInstancedMesh || o.isMesh)) return;
    const nm = o.name || '';
    const g = o.geometry;
    if (!g || !g.getAttribute('position')) return;
    if (nm.startsWith('city_')) { excluded.batched++; return; }
    if (solid.test(g.type)) { excluded.solid++; return; }
    const toks = nm.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const family = toks.find((t) => fam.has(t));
    if (!family) { excluded.family++; return; }
    const pos = g.getAttribute('position');
    const triAll = Math.floor((g.index ? g.index.count : pos.count) / 3);
    if (triAll > 200000) { excluded.tooBig++; return; }
    // 同一份几何会被多个网格复用，按 geometry.uuid 去重
    if (seen.has(g.uuid)) return;
    seen.add(g.uuid);

    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const ex = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const ez = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
    const height = Math.max(1e-9, bb.max.y - bb.min.y);
    const bottomCut = bb.min.y + height * bottomBand;

    // 翻面统计：只计「非底面」的朝下三角
    const posA = g.getAttribute('position');
    const idx = g.index ? g.index.array : null;
    const triCount = Math.floor((idx ? idx.length : posA.count) / 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    let down = 0, downBottom = 0, downSurface = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(posA, i0); b.fromBufferAttribute(posA, i1); c.fromBufferAttribute(posA, i2);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      const L = n.length();
      if (L < 1e-9) continue;
      if (n.y / L < -0.5) {
        down++;
        const cy = (a.y + b.y + c.y) / 3;
        if (cy <= bottomCut) downBottom++; else downSurface++;
      }
    }
    const flip = triCount ? downSurface / triCount : 0;
    const flipAll = triCount ? down / triCount : 0;

    const escape = Math.max(ex - box.xz, ez - box.xz, box.yMin - bb.min.y, bb.max.y - box.yMax);
    const bad = escape > tol || flip > flipRatio;
    rows.push({
      mesh: nm,
      family,
      geoType: g.type,
      tris: triCount,
      bbox: [+bb.min.x.toFixed(3), +bb.min.y.toFixed(3), +bb.min.z.toFixed(3),
             +bb.max.x.toFixed(3), +bb.max.y.toFixed(3), +bb.max.z.toFixed(3)],
      escape: +escape.toFixed(3),
      downTris: down,
      downBottom,
      downSurface,
      downFacingRatio: +flip.toFixed(3),
      downFacingRatioInclBottom: +flipAll.toFixed(3),
      reason: [escape > tol ? 'bbox' : '', flip > flipRatio ? 'flip' : ''].filter(Boolean).join('+'),
      bad,
    });
  });
  const badRows = rows.filter((r) => r.bad);
  return {
    checkedGeometries: seen.size,
    excluded,
    checked: rows.length,
    flipOver2: rows.filter((r) => r.downFacingRatio > flipRatio).length,
    badCount: badRows.length,
    rows,
  };
}, { tol: TOL, box: BOX, flipRatio: FLIP_RATIO, bottomBand: BOTTOM_BAND, families: [...ROOF_FAMILIES], solidRe: SOLID_OF_REVOLUTION.source });

console.log(JSON.stringify(out, null, 1));
console.log(`受检几何 ${out.checked}（族外排除 ${out.excluded.family} / 旋转体排除 ${out.excluded.solid} / 合批排除 ${out.excluded.batched} / 超面数排除 ${out.excluded.tooBig}）`);
console.log(`朝下三角占比 > ${(FLIP_RATIO * 100).toFixed(0)}% 的几何：${out.flipOver2} 个`);
for (const r of out.rows.filter((x) => x.downFacingRatio > FLIP_RATIO)) {
  console.log(`  - ${r.mesh} [${r.family}] ${r.geoType}: ${(r.downFacingRatio * 100).toFixed(1)}%（含底盖 ${(r.downFacingRatioInclBottom * 100).toFixed(1)}%）`);
}
const pass = out.badCount === 0;
console.log(pass ? 'PASS' : `FAIL (${out.badCount} 个几何越界/翻面)`);
await browser.close();
process.exit(pass ? 0 : 1);
