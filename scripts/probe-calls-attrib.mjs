/**
 * draw call 逐对象归因（配合 probe-calls-sweep.mjs 使用）。
 *
 * 扫掠探针只回答「峰值是多少」，这个探针回答「这 632 次是谁画出来的」：
 * 钩 `WebGLRenderer.renderBufferDirect`，按 pass（main / 水面反射 / 阴影）与对象名分桶计数，
 * 在六个固定机位各取**总 call 最高的那一帧**的账本，避免又掉回单点采样。
 *
 * 分组口径：
 *   - `pool_*` = 角色/道具实例池（pools.ts）
 *   - `court_*` / `infill_*` = WardInfill 的分桶（infill.ts）
 *   - `city_*` = bake.ts 静态合批 · `veh_*` = 船队/车辆 · 其他原样
 *
 * 用法：PROBE_URL=http://localhost:4249/ node scripts/probe-calls-attrib.mjs [topN]
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:4249/';
const TOPN = Number(process.argv[2]) || 24;

const VIEWS = [
  { name: '开场街面', p: [-197, 14, 36], t: [0, 8, -60] },
  { name: '御街中轴', p: [0, 30, 2400], t: [0, 20, -2000] },
  { name: '高空俯瞰', p: [0, 1200, 1215], t: [0, 0, 0] },
  { name: '虹桥桥面', p: [0, 34, 64], t: [0, 10, -6] },
  { name: '天宫外景', p: [420, 360, 420], t: [0, 275, 0] },
  { name: '地府阎罗殿', p: [0, -200, 152], t: [0, -232, 0] },
];

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

// 装钩子：只装一次，逐帧重置账本
await page.evaluate(() => {
  const e = window.__qingming.engine;
  const r = e.renderer;
  const orig = r.renderBufferDirect;
  window.__frame = null;
  // 主 pass 也渲染进 composer 的 render target，所以「非空 target」不能当反射判据。
  // 用 Reflector 自己的 render target 做身份比较：只有那一个 target 才是水面反射。
  let mirrorRT = null;
  e.scene.traverse((o) => { if (o.isReflector && !mirrorRT) mirrorRT = o.getRenderTarget(); });
  window.__mirrorRT = mirrorRT;
  const groupOf = (name) => {
    if (!name) return '(unnamed)';
    if (name.startsWith('pool_')) return 'pool_' + name.slice(5);
    if (name.startsWith('city_')) return 'city';
    if (name.startsWith('veh_')) return name.split('_').slice(0, 3).join('_');
    const parts = name.split('_');
    return parts.length >= 2 ? parts[0] + '_' + parts[1] : name;
  };
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const f = window.__frame;
    if (f) {
      const isDepth = !!material && (material.isMeshDepthMaterial === true || material.isMeshDistanceMaterial === true);
      const pass = isDepth ? 'shadow' : (window.__mirrorRT && r.getRenderTarget() === window.__mirrorRT ? 'refl' : 'main');
      const g = groupOf(object && object.name);
      const rec = f.by[g] || (f.by[g] = { main: 0, refl: 0, shadow: 0 });
      rec[pass]++;
      f.total++;
    }
    return orig.call(this, camera, scene, geometry, material, object, group);
  };
});

const out = [];
for (const v of VIEWS) {
  const best = await page.evaluate((vv) => new Promise((resolve) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(vv.p[0], vv.p[1], vv.p[2]);
    const dx = vv.t[0] - vv.p[0], dy = vv.t[1] - vv.p[1], dz = vv.t[2] - vv.p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.camera.updateMatrixWorld(true);
    let n = 0;
    let peak = null;
    const tick = () => {
      window.__frame = { total: 0, by: {} };
      requestAnimationFrame(() => {
        const f = window.__frame;
        window.__frame = null;
        const reported = e.renderer.info.render.calls;
        const cur = { reported, captured: f.total, by: f.by, hot: window.__qingming.world ? window.__qingming.world.mirrorHot : null, shadowTick: n };
        if (!peak || reported > peak.reported) peak = cur;
        if (++n < 80) requestAnimationFrame(tick);
        else resolve(peak);
      });
    };
    requestAnimationFrame(tick);
  }), v);

  const domainOf = (g) => {
    if (g.startsWith('pool_')) return 'pool(角色/道具池)';
    if (g.startsWith('court_')) return 'court(御街分桶)';
    if (g.startsWith('infill_')) return 'infill(里坊分桶)';
    if (g.startsWith('city')) return 'city(静态合批)';
    if (g.startsWith('veh_')) return 'veh(船队/车)';
    if (g.startsWith('sky_') || g.startsWith('cloud')) return 'sky(天空/云)';
    if (g.startsWith('water_') || g.startsWith('bian_') || g === 'water_rivers') return 'water(水系)';
    if (g.startsWith('ward_all')) return 'ward_all(全城小件)';
    if (g.startsWith('lod_')) return 'lod(剪影卡)';
    return 'other(其它)';
  };
  const dom = {};
  for (const [k, s] of Object.entries(best.by)) {
    const d = dom[domainOf(k)] || (dom[domainOf(k)] = { main: 0, refl: 0, shadow: 0, n: 0 });
    d.main += s.main; d.refl += s.refl; d.shadow += s.shadow; d.n++;
  }
  const rows = Object.entries(best.by).map(([k, s]) => ({ g: k, main: s.main, refl: s.refl, shadow: s.shadow, tot: s.main + s.refl + s.shadow }))
    .sort((a, b) => b.tot - a.tot);
  const sumPass = rows.reduce((a, r) => ({ main: a.main + r.main, refl: a.refl + r.refl, shadow: a.shadow + r.shadow }), { main: 0, refl: 0, shadow: 0 });
  out.push({ view: v.name, reported: best.reported, captured: best.captured, sumPass, rows, dom });
  console.log(`\n=== ${v.name}  reported=${best.reported}  captured=${best.captured}  main=${sumPass.main} refl=${sumPass.refl} shadow=${sumPass.shadow}  groups=${rows.length}  mirrorHot=${best.hot}`);
  for (const [d, s] of Object.entries(dom).sort((a, b) => (b[1].main + b[1].refl + b[1].shadow) - (a[1].main + a[1].refl + a[1].shadow))) {
    console.log(`  ${d.padEnd(20)} mesh组 ${String(s.n).padStart(3)}  main ${String(s.main).padStart(3)} / refl ${String(s.refl).padStart(3)} / shadow ${String(s.shadow).padStart(3)}`);
  }
  if (TOPN > 0) {
    console.log('  -- 明细 --');
    for (const r of rows.slice(0, TOPN)) {
      console.log(`  ${r.g.padEnd(22)} total ${String(r.tot).padStart(4)}  (main ${String(r.main).padStart(3)} / refl ${String(r.refl).padStart(3)} / shadow ${String(r.shadow).padStart(3)})`);
    }
    const rest = rows.slice(TOPN);
    if (rest.length) console.log(`  … 其余 ${rest.length} 组共 ${rest.reduce((a, r) => a + r.tot, 0)} 次`);
  }
}

console.log('\n' + JSON.stringify(out.map((o) => ({ view: o.view, reported: o.reported, ...o.sumPass })), null, 1));
await browser.close();
