/**
 * 屋顶「两端敞口」自动判据（用户第 N 次投诉屋顶，这次点出具体症状）。
 *
 * 用户原话：「很多房屋的房顶的前后面有贴图，**侧面是空的**」
 * 意思是：双坡屋顶只有前后两片坡面，**两端没有山墙/博风板封口**，从斜上方能看进屋顶内腔。
 *
 * 为什么此前的探针抓不到：现有判据查的是「法线朝上」「面数够不够」「朝下三角占比」，
 * 而"端头敞口"是**拓扑封闭性问题**，与面数、朝向都无关。
 * 而且我此前的验收机位是「水平平视」和「垂直俯视」——这两种角度恰好都看不到屋顶端头。
 *
 * 判据（对每个屋面族几何）：
 *   取该几何在屋脊方向上的两端（|u| 最大的 15% 三角面），检查其中是否存在**朝向端外的面**
 *   （法线在该轴上的分量 |n_u| > 0.5）。
 *   - 有 ⇒ 端头是封的；
 *   - 没有 ⇒ 端头敞口，从斜上方能看进内腔。
 *
 * 用法：PROBE_URL=http://localhost:4173/ node scripts/probe-roof-gable.mjs
 * 退出码 0 = 所有屋面族几何两端封闭；1 = 存在敞口。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';
const END_BAND = 0.15;     // 两端各取 |u| 最大的 15%
const NORMAL_MIN = 0.5;    // 端面法线在与脊垂直的轴上的分量下限

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate(({ endBand, normalMin }) => {
  const THREE = window.__qingming.THREE;
  const scene = window.__qingming.scene;
  // 只看"按单位足迹建模、按实例缩放"的屋面单元；合批网格跳过（几百万面会拖死）
  const ROOF = /(_roof|_gable|_tent|_shed|_thatch|_blockroof|_gwall|roofUnit|curved|twinRoof)/;
  const seen = new Set();
  const rows = [];

  const objs = [];
  scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) objs.push(o); });

  for (const o of objs) {
    const nm = o.name || '';
    if (!ROOF.test(nm)) continue;
    if (nm.startsWith('city_')) continue;
    const g = o.geometry;
    if (!g || !g.getAttribute('position')) continue;
    if (seen.has(g.uuid)) continue;
    seen.add(g.uuid);

    const pos = g.getAttribute('position');
    const idx = g.index ? g.index.array : null;
    const triCount = Math.floor((idx ? idx.length : pos.count) / 3);
    if (triCount === 0 || triCount > 200000) continue;

    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const spanX = bb.max.x - bb.min.x;
    const spanZ = bb.max.z - bb.min.z;
    // 脊向 = 跨度较大的那条水平轴；端头轴 = 另一条
    const ridgeAlongX = spanX >= spanZ;
    const endAxis = ridgeAlongX ? 'z' : 'x';
    const endMin = ridgeAlongX ? bb.min.z : bb.min.x;
    const endMax = ridgeAlongX ? bb.max.z : bb.max.x;
    const endSpan = endMax - endMin;
    if (endSpan < 1e-3) continue;

    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();

    let endTris = 0;
    let sealedTris = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      const cu = (ridgeAlongX ? (a.z + b.z + c.z) / 3 : (a.x + b.x + c.x) / 3);
      const norm = (cu - endMin) / endSpan;
      if (norm > endBand && norm < 1 - endBand) continue;   // 中段跳过
      endTris++;
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      const L = n.length();
      if (L < 1e-9) continue;
      const nu = Math.abs(ridgeAlongX ? n.z / L : n.x / L);
      if (nu > normalMin) sealedTris++;
    }

    // 端头三角很少（<4）说明几何根本没在两端建面
    const sealed = endTris >= 4 && sealedTris >= 2;
    if (!sealed) {
      rows.push({
        mesh: nm,
        tris: triCount,
        ridgeAlongX,
        endTris,
        sealedTris,
        bbox: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2),
               +bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)],
        verdict: endTris < 4 ? '端头几乎没有面（未封口）' : '端头有面但没有朝外的端面（敞口）',
      });
    }
  }
  return { checked: seen.size, bad: rows.length, rows: rows.slice(0, 30) };
}, { endBand: END_BAND, normalMin: NORMAL_MIN });

console.log(JSON.stringify(out, null, 1));
const pass = out.bad === 0;
console.log(pass ? 'PASS' : `FAIL（${out.bad} 个屋面几何两端敞口）`);
await browser.close();
process.exit(pass ? 0 : 1);
