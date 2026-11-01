/**
 * 屋面机检：加载 ?roofAudit=1 的全城，读 Baker 的逐构件台账并汇总。
 *
 *   node scripts/roof-audit.mjs                         # 汇总
 *   node scripts/roof-audit.mjs --at 534,-252,124 --at 540,-257,107
 *   node scripts/roof-audit.mjs --thin 30               # 打印前 30 条薄片的调用栈
 *
 * 判据（见 bake.ts RoofPiece）：
 *   down = 面法线朝下（ny<−0.25）的三角形数；out = 顶点超出标称屋面包络的最大距离（m）；
 *   thin = AABB 最小边 <0.32m 且最长边 >0.8m 的「薄片」。
 */
import puppeteer from 'puppeteer-core';

const UA = process.env.CHROME_BIN || `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1155\\chrome-win\\chrome.exe`;
const URL = (process.env.DEV_URL || 'http://127.0.0.1:4263/') + '?roofAudit=1';
const argv = process.argv.slice(2);
const ats = [];
let thinN = 0;
let nearBox = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--at') ats.push(argv[++i].split(',').map(Number));
  else if (argv[i] === '--thin') thinN = Number(argv[++i]);
  else if (argv[i] === '--near') nearBox = argv[++i].split(',').map(Number); // x,y,z,r
}

const browser = await puppeteer.launch({
  executablePath: UA, headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
let ready = false;
for (let i = 0; i < 1200; i++) {
  try {
    ready = await page.evaluate(() => !!(window.__qingming && window.__qingming.scene && !document.getElementById('loading')));
  } catch { ready = false; }
  if (ready) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) throw new Error('scene not ready');
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate((ATS, NEAR) => {
  const ps = window.__roofPieces || [];
  const sum = { pieces: ps.length, downTris: 0, downPieces: 0, outPieces: 0, outMax: 0, thinPieces: 0, byKind: {} };
  for (const p of ps) {
    sum.downTris += p.down;
    if (p.down > 0) sum.downPieces++;
    if (p.out > 1.5) sum.outPieces++;
    if (p.out > sum.outMax) sum.outMax = p.out;
    if (p.thin) sum.thinPieces++;
    const row = sum.byKind[p.kind] || (sum.byKind[p.kind] = { pieces: 0, down: 0, out: 0, thin: 0 });
    row.pieces++; row.down += p.down;
    if (p.out > 1.5) row.out++;
    if (p.thin) row.thin++;
  }
  sum.outMax = +sum.outMax.toFixed(3);
  const near = [];
  for (const at of ATS) {
    const hit = [];
    for (const p of ps) {
      const [x, y, z] = at;
      if (x < p.min[0] - 0.4 || x > p.max[0] + 0.4) continue;
      if (y < p.min[1] - 0.4 || y > p.max[1] + 0.4) continue;
      if (z < p.min[2] - 0.4 || z > p.max[2] + 0.4) continue;
      hit.push({
        kind: p.kind, down: p.down, out: +p.out.toFixed(2), thin: p.thin,
        min: p.min.map((v) => +v.toFixed(2)), max: p.max.map((v) => +v.toFixed(2)),
        stack: p.stack || '',
      });
    }
    near.push({ at, hits: hit.slice(0, 6), total: hit.length });
  }
  const stacks = new Map();
  for (const p of ps) {
    if (!p.thin || !p.stack) continue;
    const key = p.stack;
    stacks.set(key, (stacks.get(key) || 0) + 1);
  }
  const top = [...stacks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => ({ n, site: k }));
  // 「短杆」签名：两轴 < 0.5m、最长轴 1.2–4.5m —— 画面里斜插在屋面上的那批薄片
  const bars = [];
  const barSites = new Map();
  for (const p of ps) {
    if (!p.thin) continue;
    const dims = [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]].sort((a, b) => a - b);
    if (dims[0] > 0.62 || dims[1] > 0.62 || dims[2] < 3 || dims[2] > 30) continue;
    const key = p.stack || '(no stack)';
    barSites.set(key, (barSites.get(key) || 0) + 1);
    if (bars.length < 12) bars.push({ kind: p.kind, dims: dims.map((v) => +v.toFixed(2)), c: [0, 1, 2].map((i) => +((p.min[i] + p.max[i]) / 2).toFixed(1)), stack: p.stack || '' });
  }
  // 「浮空薄板」判据：薄片中心高于其所在 roofC 瓦面 ≥0.15m —— 直接对应用户看到的「斜插出屋面的薄片」
  const PROF = (t) => Math.pow(1 - t, 1.35);
  const RIDGE = 0.16, KICK = 0.16, RISE = 0.15;
  const roofs = [];
  for (const p of ps) if (p.kind === 'roofC' && p.roof) roofs.push({ min: p.min, max: p.max, r: p.roof });
  const surfaceAt = (r, px, py, pz) => {
    const cx = Math.cos(r.rx), sxq = Math.sin(r.rx);
    void cx; void sxq;
    // 用四元数做与 bake.ts 完全一致的反变换太贵，这里按小倾角近似（|rx|,|rz| < 0.3 时误差 < 3%）
    let x0 = px - r.x, y0 = py - r.y, z0 = pz - r.z;
    const cy = Math.cos(-r.ry), sy = Math.sin(-r.ry);
    let x1 = x0 * cy + z0 * sy, z1 = -x0 * sy + z0 * cy;
    const cz = Math.cos(-r.rz), sz = Math.sin(-r.rz);
    const x2 = x1 * cz - y0 * sz, y1 = x1 * sz + y0 * cz;
    const cx2 = Math.cos(-r.rx), sx2 = Math.sin(-r.rx);
    const y2 = y1 * cx2 - z1 * sx2, z2 = y1 * sx2 + z1 * cx2;
    const hx = r.sx * 0.5, hz = r.sz * 0.5;
    if (Math.abs(x2) > hx * 1.05 || Math.abs(z2) > hz * 1.05) return null;
    const frac = Math.abs(z2) / hz;
    const f = (frac - 2 * RIDGE) / (1 - 2 * RIDGE);
    const t = Math.pow(Math.max(0, Math.min(1, f)), 1 / 1.6);
    const u = Math.max(-1, Math.min(1, x2 / (Math.max(frac, 1e-3) * hx)));
    return { surf: (PROF(t) + KICK * t * t * t + RISE * t * t * u * u) * r.sy, localY: y2 };
  };
  let floatN = 0;
  const floatSites = new Map();
  const floatSamples = [];
  for (const p of ps) {
    if (!p.thin) continue;
    const cx = (p.min[0] + p.max[0]) / 2, cy = (p.min[1] + p.max[1]) / 2, cz = (p.min[2] + p.max[2]) / 2;
    for (const rf of roofs) {
      if (cx < rf.min[0] || cx > rf.max[0] || cz < rf.min[2] || cz > rf.max[2]) continue;
      if (cy < rf.min[1] - 0.5 || cy > rf.max[1] + 1.5) continue;
      const s = surfaceAt(rf.r, cx, cy, cz);
      if (!s) continue;
      const gap = s.localY - s.surf;
      if (gap > 0.15) {
        floatN++;
        const k = p.stack || '(no stack)';
        floatSites.set(k, (floatSites.get(k) || 0) + 1);
        if (floatSamples.length < 10) floatSamples.push({ kind: p.kind, gap: +gap.toFixed(2), c: [+cx.toFixed(1), +cy.toFixed(1), +cz.toFixed(1)], stack: k });
      }
      break;
    }
  }
  const floatTop = [...floatSites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ n, site: k }));
  const barTop = [...barSites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ n, site: k }));
  // 指定球域内的薄片（含完整调用栈），用于把「某处斜插薄片」定位到具体语句
  let nearThin = [];
  if (NEAR) {
    const [nx0, ny0, nz0, nr] = NEAR;
    for (const p of ps) {
      if (!p.thin) continue;
      const [nx0, ny0, nz0, nr] = NEAR;
      // AABB 与球域求交（长构件中心可能在几十米外，不能只比中心点）
      const dx = Math.max(p.min[0] - nx0, 0, nx0 - p.max[0]);
      const dy = Math.max(p.min[1] - ny0, 0, ny0 - p.max[1]);
      const dz = Math.max(p.min[2] - nz0, 0, nz0 - p.max[2]);
      if (Math.hypot(dx, dy, dz) > nr) continue;
      const cx = (p.min[0] + p.max[0]) / 2, cy = (p.min[1] + p.max[1]) / 2, cz = (p.min[2] + p.max[2]) / 2;
      nearThin.push({
        kind: p.kind, down: p.down,
        size: [+(p.max[0] - p.min[0]).toFixed(2), +(p.max[1] - p.min[1]).toFixed(2), +(p.max[2] - p.min[2]).toFixed(2)],
        c: [+cx.toFixed(1), +cy.toFixed(1), +cz.toFixed(1)],
        stack: p.stack || '',
      });
      if (nearThin.length >= 400) break;
    }
    nearThin.sort((a, b) => a.size[1] - b.size[1]);
    nearThin = nearThin.slice(0, 40);
  }
  return { sum, near, top, nearThin, barTop, bars, floatN, floatTop, floatSamples };
}, ats, nearBox);

console.log('SUMMARY', JSON.stringify(out.sum, null, 1));
console.log('FLOATING-PLATES', out.floatN);
for (const t of out.floatTop) console.log(String(t.n).padStart(6), t.site);
for (const t of out.floatSamples) console.log('  sample', JSON.stringify(t));
console.log('BAR-TOP');
for (const t of out.barTop) console.log(String(t.n).padStart(6), t.site);
console.log('BAR-SAMPLES');
for (const t of out.bars) console.log(JSON.stringify(t));
for (const n of out.near) console.log('NEAR', JSON.stringify(n, null, 1));
if (out.nearThin.length) {
  console.log('NEAR-THIN');
  for (const t of out.nearThin) console.log(JSON.stringify(t));
}
if (thinN) {
  console.log('THIN-SITES');
  for (const t of out.top.slice(0, thinN)) console.log(String(t.n).padStart(6), t.site);
} else {
  console.log('THIN-SITES(top10)');
  for (const t of out.top.slice(0, 10)) console.log(String(t.n).padStart(6), t.site);
}
await browser.close();
