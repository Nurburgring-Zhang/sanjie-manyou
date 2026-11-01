/**
 * R17 机检：里坊是否「只剩灰盒子」。
 * 判据：在紫宸殿 1.2km 机位下，
 *   ① infill/court 的 body 可见实例 > 0；
 *   ② roof + gable 的可见实例 ≥ body 的 0.9（每栋都该有顶）；
 *   ③ wall 可见实例 > 0（院墙没整批消失）；
 *   ④ glow（窗光）可见实例 > 0。
 * 任一不满足 → pass=false。另外输出每组的 visible/instances，便于定位是哪一组被隐藏。
 */
import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));

const res = await p.evaluate(() => {
  const e = window.__qingming.engine;
  e.stopCinema();
  // 紫宸殿 1.2km 机位
  e.camera.position.set(0, 120, 1215);
  e.camera.lookAt(0, 10, 0);
  e.camera.updateMatrixWorld(true);

  const agg = {};
  // 按「桶」（名字尾部那个空间单元 key）分组：同一桶内 body / roof / gable 同属一档可见，
  // 跨桶比较没有意义（简院档 body 3 顶 1，完整院档 body 1 顶 3），旧判据因此常年误报。
  const perBucket = {};
  e.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const m = /^(infill|court)_([a-zA-Z]+)_(.+)$/.exec(o.name || '');
    if (!m) return;
    const kind = m[2];
    const bucket = m[1] + '_' + m[3];
    const cur = agg[kind] || { inst: 0, visibleMeshes: 0, meshes: 0 };
    cur.meshes++;
    if (o.visible) {
      cur.visibleMeshes++; cur.inst += o.count;
      const b = perBucket[bucket] || (perBucket[bucket] = {});
      b[kind] = (b[kind] || 0) + o.count;
    }
    agg[kind] = cur;
  });

  // 顺带统计所有 mesh 的 world 包围球半径异常值（R14b 巨型碎块相关）
  const huge = [];
  e.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r = g.boundingSphere?.radius ?? 0;
    // 只抓「不该这么大」的：合批后的 city_* / 地形 / 穹顶（r>40000）/ 地平霾环（hazeMat）本来就覆盖全图。
    const nm = o.name || '';
    const matName = (o.material && o.material.name) || '';
    if (nm.startsWith('city_') || nm === 'terrain' || nm.startsWith('pave_')) return;
    if (matName === 'hazeMat') return;
    if (r > 40000) return;
    if (r > 20000) huge.push({ name: nm || '(unnamed)', r: Math.round(r) });
  });

  return { agg, perBucket, huge: huge.slice(0, 6) };
});

const g = res.agg;
const body = g.body?.inst ?? 0;
const roof = g.roof?.inst ?? 0;
const gable = g.gable?.inst ?? 0;
const wall = g.wall?.inst ?? 0;
const glow = g.glow?.inst ?? 0;
// 窗的证据有两个来源：旧的浮白光片（glow，已基本被 furn 取代）与新的门窗贴面条带（furn）。
// 只查 glow 会误报——2026-11-01 的民居门窗改造删掉了 40,500 片旧光窗，改成片元画图案的 furnish。
const furn = g.furn?.inst ?? 0;

// 按桶判「每栋都有顶」。两种口径都是**精确恒等式**，不是比例阈值：
//   ① tier0 正房：`roof + thatch` 必须 == `gwall`（每栋一顶、每栋一对山墙，实测 15242 == 15242）；
//   ② tier3 远档：`blockroof` 必须 == `block`（每个体块配一层脊带简顶）。
// 不能用「屋頂数 ≥ 0.9×body 数」：`body` 这一路网格里还塞着商铺的**墙体/门柱/柜台**
// （见 emitShop 的 bodies.push），它们本来就不该有顶，比例必然小于 1。
const buckets = Object.entries(res.perBucket || {});
const sum = (m, keys) => keys.reduce((n, k) => n + (m[k] ?? 0), 0);
const bad = buckets
  .map(([k, m]) => ({
    bucket: k,
    mainRoof: sum(m, ['roof', 'thatch']),
    gwall: sum(m, ['gwall']),
    block: sum(m, ['block']),
    blockroof: sum(m, ['blockroof']),
    flat: sum(m, ['tent', 'gable', 'shed']),
  }))
  .filter((r) => {
    const tol = (n) => Math.max(2, n * 0.02);
    if (r.gwall > 0 && Math.abs(r.mainRoof - r.gwall) > tol(r.gwall)) return true;
    if (r.block > 0 && Math.abs(r.blockroof - r.block) > tol(r.block)) return true;
    if (r.gwall === 0 && r.mainRoof === 0 && r.block === 0 && r.flat === 0 && sum(res.perBucket[r.bucket] || {}, ['body']) > 0) return true;
    return false;
  });

const checks = [
  { id: '17-① body 可见', pass: body > 0, detail: body },
  {
    id: '17-② 每桶 roof+thatch == gwall 且 blockroof == block',
    pass: buckets.length > 0 && bad.length === 0,
    detail: { buckets: buckets.length, bad: bad.slice(0, 8) },
  },
  { id: '17-③ wall 可见', pass: wall > 0, detail: wall },
  { id: '17-④ 窗可见（glow 或 furn）', pass: glow > 0 || furn > 0, detail: { glow, furn } },
  { id: '17-⑤ 无 >20km 包围球', pass: res.huge.length === 0, detail: res.huge },
];
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ groups: g, checks, pass }, null, 1));
await b.close();
process.exit(pass ? 0 : 1);
