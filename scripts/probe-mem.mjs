/**
 * probe-mem.mjs — 载入期峰值堆 / 常驻几何字节 / 静态面数台账
 *
 * 只读运行时，不写 src。口径固定，前后对比才有意义：
 *   1) 采样：evaluateOnNewDocument 起一个 40ms 定时器读 performance.memory.usedJSHeapSize，
 *      取全程序列最大值 = 峰值堆。三个独立进程各跑一次，报中位数与极值。
 *   2) 常驻几何：遍历 scene 里所有 city_* / 其它 Mesh 的 geometry，
 *      累加每个 attribute 的 array.byteLength + index.byteLength。
 *   3) 静态面：world.assetAudit 逐组三角面 + detail 台账；renderer.info 只作旁证。
 *
 * 用法： node scripts/probe-mem.mjs [--runs 3] [--url http://127.0.0.1:4243/] [--json out.json] [--no-audit]
 *        PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-mem.mjs --runs 1
 *
 * 本探针默认给目标 URL 加上 `?heapAudit=1`（见 src/world.ts 的 heapAuditEnabled）：
 * 只有开启堆归因，合批前才会等 idle 结算点、__heapPre 才是「合批真实起点」。
 * 生产载入不带该参数，也就不会为这次读数付 400ms；`--no-audit` 就是走这条生产路径，
 * 用来对照「省掉 settle 后峰值堆是否抬升」。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const RUNS = Number(argOf('--runs', '3'));
const TARGET = argOf('--url', process.env.PREVIEW_URL || 'http://127.0.0.1:4243/');
const JSON_OUT = argOf('--json', '');
// 默认带 ?heapAudit=1：settle 只在归因开启时执行，__heapPre 才是「合批真实起点」。
// --no-audit 走生产路径（跳过 settle），用于对照「不等的代价」是否体现在峰值堆上。
const AUDIT = !argv.includes('--no-audit');
const withAuditParam = (base, on) => {
  const u = new URL(base);
  if (on) u.searchParams.set('heapAudit', '1');
  else u.searchParams.delete('heapAudit');
  return u.toString();
};
const PAGE_URL = withAuditParam(TARGET, AUDIT);

const one = async (runIdx) => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      '--window-size=1200,700',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 700 });
  await page.evaluateOnNewDocument(() => {
    const w = window;
    w.__heapSamples = [];
    w.__heapPeak = 0;
    const tick = () => {
      const m = performance.memory;
      if (!m) return;
      const v = m.usedJSHeapSize;
      w.__heapSamples.push(v);
      if (v > w.__heapPeak) w.__heapPeak = v;
    };
    w.__heapTimer = setInterval(tick, 40);
    tick();
  });
  const t0 = Date.now();
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit,
    { timeout: 300000, polling: 200 },
  );
  const loadMs = Date.now() - t0;
  // 让合批 + 首帧着色器编译落定，再读常驻
  await new Promise((r) => setTimeout(r, 2500));

  const data = await page.evaluate(() => {
    const Q = window.__qingming;
    const scene = Q.scene;
    const audit = Q.world.assetAudit;
    const groups = {};
    let tris = 0;
    if (audit) {
      for (const k of Object.keys(audit.groups)) {
        const g = audit.groups[k];
        groups[k] = { vertices: Math.round(g.vertices), triangles: Math.round(g.triangles) };
        tris += g.triangles;
      }
    }
    // 常驻几何字节：不区分来源（含地形/植被/实例池），只看总量与最大的几块
    let attrBytes = 0, idxBytes = 0, meshCount = 0;
    const perMesh = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry;
      let b = 0;
      let verts = 0;
      for (const name of Object.keys(geo.attributes)) {
        const a = geo.attributes[name];
        b += a.array.byteLength;
        verts = Math.max(verts, a.count);
      }
      if (geo.index) b += geo.index.array.byteLength;
      attrBytes += b; idxBytes += geo.index ? geo.index.array.byteLength : 0;
      meshCount++;
      perMesh.push({ name: o.name || '(unnamed)', bytes: b, verts, tris: (geo.index ? geo.index.count : verts) / 3, instanced: !!o.isInstancedMesh });
    });
    perMesh.sort((a, b) => b.bytes - a.bytes);
    const mem = performance.memory;
    return {
      heapPeakMB: +(window.__heapPeak / 1048576).toFixed(0),
      heapEndMB: +(mem.usedJSHeapSize / 1048576).toFixed(0),
      heapTotalMB: +(mem.totalJSHeapSize / 1048576).toFixed(0),
      samples: window.__heapSamples.length,
      staticTris: Math.round(tris),
      groups,
      detail: audit ? audit.detail : {},
      attrMB: +(attrBytes / 1048576).toFixed(1),
      idxMB: +(idxBytes / 1048576).toFixed(1),
      meshCount,
      topMeshes: perMesh.slice(0, 12),
      renderer: {
        calls: Q.engine.renderer.info.render.calls,
        tris: Q.engine.renderer.info.render.triangles,
        geometries: Q.engine.renderer.info.memory.geometries,
        textures: Q.engine.renderer.info.memory.textures,
      },
      loadTimings: (window.__loadTimings || []).slice(0, 10),
      flushMs: Math.round(window.__flushMs ?? 0),
      texMs: window.__texMs ?? null,
      // 归因自证：带 ?heapAudit=1 时 __heapAuditOn 必须为 true 且 __heapPre 有效；
      // 这两位同时提供改前/改后口径，避免「以为在量堆、其实走的是生产路径」。
      heapAuditOn: window.__heapAuditOn === true,
      heapPreMB: typeof window.__heapPre === 'number' ? window.__heapPre : null,
      settleMs: Math.round(window.__settleMs ?? 0),
    };
  });
  await browser.close();
  return { run: runIdx, loadMs, ...data };
};

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await one(i + 1);
  runs.push(r);
  console.log(
    `[run ${i + 1}] load=${r.loadMs}ms heapPeak=${r.heapPeakMB}MB heapEnd=${r.heapEndMB}MB heapPre=${r.heapPreMB}MB ` +
      `attr=${r.attrMB}MB idx=${r.idxMB}MB staticTris=${r.staticTris} meshes=${r.meshCount} flush=${r.flushMs}ms settle=${r.settleMs}ms`,
  );
  if (i === 0) {
    const top = Object.entries(r.groups)
      .sort((a, b) => b[1].triangles - a[1].triangles)
      .slice(0, 8)
      .map(([k, v]) => `${k}=${(v.triangles / 1000).toFixed(0)}k`)
      .join(' ');
    console.log(`           groups: ${top}`);
    console.log(`           topMeshes: ${r.topMeshes.slice(0, 6).map((m) => `${m.name}=${(m.bytes / 1048576).toFixed(0)}MB/${Math.round(m.tris / 1000)}kf`).join(' ')}`);
  }
}

const peaks = runs.map((r) => r.heapPeakMB).sort((a, b) => a - b);
const median = peaks[Math.floor(peaks.length / 2)];
console.log(`\nPEAK MB: [${peaks.join(', ')}]  median=${median}  targets: <=1536`);
console.log(`STATIC TRIS: ${runs[0].staticTris}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ runs, median }, null, 2));

// 台账自证：没进堆归因就等于没量到「合批真实起点」，此时 heapPeak 仍可看，但 pre/post 归因不成立。
const noAudit = AUDIT ? runs.filter((r) => !r.heapAuditOn || !(r.heapPreMB > 0)) : [];
if (noAudit.length) {
  console.error(
    `\nWARN: ${noAudit.length}/${runs.length} 轮未进入堆归因（heapAuditOn/heapPre 无效）——` +
      `请确认 URL 已带 ?heapAudit=1（本探针默认追加，目标=${PAGE_URL}）`,
  );
  process.exitCode = 1;
}
