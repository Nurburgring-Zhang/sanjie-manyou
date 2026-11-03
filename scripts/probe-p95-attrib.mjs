/**
 * p95 归因探针：单变量消融（全部运行时注入，不改 src/）。
 *
 * 为什么需要它：`frameP95 = 67ms` 只说明「有尾部卡顿」，不说明是谁的。五路消融各自只关一件事，
 * 用「p95 相对 baseline 的变化」把 67ms 拆到具体子系统上；没有这一步，任何优化计划都是猜的。
 *
 * 口径（与 verify-packaged.mjs 的 frameP95 对齐）：
 *   - 清空 `engine.frameMs` 后连续采 200 帧，p95 = 升序第 round(0.95*(n-1)) 个（n=200 → 第 11 大）；
 *   - 每档先在同一机位静止 SETTLE_MS 再开始，机位固定为 (0,30,130) → (0,4,0)（默认出生点朝城心）；
 *   - 每档采两次（第 2 轮逆序执行，抵消漂移），一致性按两轮 p95 差报告。
 *
 * 三个已知混杂变量，本探针显式处理并记录：
 *   ① `autoQuality` 会在 avg>30ms 时自动降档（改 pixelRatio / 阴影 / bloom），六档顺序采样时它会让后几档
 *      悄悄跑在 med 上。这里在开测前 `qualityAuto=false` 并锁 high 档，实际档位写进 JSON。
 *   ② `dt` 被 `Math.min(0.1, …)` 截断，所以 max 的理论上限是 100ms；读到 100 只代表「至少一帧 ≥100ms」。
 *   ③ `frameRenderMs` 是 `composer.render()` 的 **CPU 提交**耗时，不是 GPU 完成时间；GPU 成本体现为
 *      rAF 间隔。因此「frame p95 升而 render p95 不升」= GPU/呈现侧；两者同升 = CPU 提交侧。
 *
 * D 档（setPixelRatio 1.0）在 devicePixelRatio=1 的机器上是 **no-op**，探针会如实标 NO-OP，
 * 并补一档 D′（0.5，像素数 ÷4）作为真正的填充率消融——否则「GPU 填充」这条根本没被验证过。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4180/ node scripts/probe-p95-attrib.mjs
 *   可选：P95_FRAMES / P95_SETTLE / P95_REPS / P95_HEADFUL=1 / P95_OUT
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4180/';
const FRAMES = Number(process.env.P95_FRAMES || 200);
const SETTLE_MS = Number(process.env.P95_SETTLE || 3000);
const REPS = Number(process.env.P95_REPS || 2);
const WARMUP_MS = Number(process.env.P95_WARMUP || 8000);
const HEADFUL = process.env.P95_HEADFUL === '1';
const OUT = process.env.P95_OUT || path.resolve('artifacts/p95-attrib.json');

// 固定机位：默认出生点，视线指向城心。p95 与视角强相关，六档必须共用同一条视线。
const VIEW = { name: 'spawn-city-centre', p: [0, 30, 130], t: [0, 4, 0] };
const VIEWPORT = { width: 1980, height: 1080, deviceScaleFactor: 1 };

const ONLY = process.env.P95_ARMS ? process.env.P95_ARMS.split(',').map((s) => s.trim()) : null;
const ARMS = [
  { id: 'baseline', label: 'baseline 原样', what: '不做任何消融' },
  { id: 'hud', label: 'A 关 HUD', what: '#ui/#bossbar/#interact-prompt display:none（隔离 DOM 布局与合成）' },
  { id: 'shadow', label: 'B 关阴影', what: 'renderer.shadowMap.enabled=false + sun.castShadow=false' },
  { id: 'post', label: 'C 关后处理', what: 'composer 只留 RenderPass（关 bloom/grade/output）' },
  { id: 'dpr1', label: 'D 像素比 1.0', what: 'renderer.setPixelRatio(1.0)（DPR=1 时为 no-op，如实标注）' },
  { id: 'dpr05', label: "D′ 像素比 0.5", what: 'setPixelRatio(0.5)，像素数 ÷4 —— D 档失效时验证填充率的替代档' },
  { id: 'geom', label: 'E 降几何 top3', what: '隐藏三角面最多的 3 个可见 mesh' },
].filter((a) => !ONLY || a.id === 'baseline' || ONLY.includes(a.id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function quantile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (!n) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))));
  return sortedAsc[i];
}

function summarize(frame, js, render, calls, tris, timedOut) {
  const f = frame.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const j = js.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const r = render.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const c = calls.slice().sort((a, b) => a - b);
  const t = tris.slice().sort((a, b) => a - b);
  const round1 = (x) => +x.toFixed(1);
  return {
    n: f.length,
    timedOut: !!timedOut,
    p50: round1(quantile(f, 0.5)),
    p95: round1(quantile(f, 0.95)),
    p99: round1(quantile(f, 0.99)),
    max: round1(f.length ? f[f.length - 1] : 0),
    mean: round1(f.reduce((a, b) => a + b, 0) / (f.length || 1)),
    over16: f.filter((x) => x > 16.8).length,
    over33: f.filter((x) => x > 33.4).length,
    over50: f.filter((x) => x > 50).length,
    over66: f.filter((x) => x > 66.8).length,
    drawCalls: Math.round(quantile(c, 0.5)),
    trianglesM: +((t.length ? t[t.length - 1] : 0) / 1e6).toFixed(2),
    jsP50: round1(quantile(j, 0.5)),
    jsP95: round1(quantile(j, 0.95)),
    renderP50: round1(quantile(r, 0.5)),
    renderP95: round1(quantile(r, 0.95)),
  };
}

// 稳定输出：中文按 2 列宽对齐（终端里默认中文占两格）
const dispW = (s) => [...String(s)].reduce((w, ch) => w + (/[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0);
const padW = (s, n) => String(s) + ' '.repeat(Math.max(0, n - dispW(s)));
const padStartW = (s, n) => ' '.repeat(Math.max(0, n - dispW(s))) + String(s);

function printTable(rows, baseline) {
  const head = ['档位', 'p50', 'p95', 'p99', 'max', 'calls', 'tris(M)', 'jsP95', 'renderP95', 'Δp95(ms)', 'Δp95(%)'];
  const widths = [26, 7, 7, 7, 7, 7, 8, 7, 10, 10, 9];
  const line = (cells) => cells.map((c, i) => padW(c, widths[i])).join(' ');
  console.log('\n' + line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    const d = r.deltaVsBaseline;
    const dm = d ? (d.p95Ms >= 0 ? '+' : '') + d.p95Ms.toFixed(1) : '—';
    const dp = d ? (d.p95Pct >= 0 ? '+' : '') + d.p95Pct.toFixed(1) + '%' : '—';
    console.log(
      line([
        r.label,
        r.primary.p50.toFixed(1),
        r.primary.p95.toFixed(1),
        r.primary.p99.toFixed(1),
        r.primary.max.toFixed(1),
        String(r.primary.drawCalls),
        r.primary.trianglesM.toFixed(2),
        r.primary.jsP95.toFixed(1),
        r.primary.renderP95.toFixed(1),
        dm,
        dp,
      ]),
    );
  }
}

function printSlowTable(rows) {
  const head = ['档位', '>16.8ms', '>33.4ms', '>50ms', '>66.8ms'];
  const widths = [26, 9, 9, 9, 9];
  const line = (cells) => cells.map((c, i) => padW(c, widths[i])).join(' ');
  console.log('\n慢帧占比（两轮均值，单轮 200 帧）：');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    const p = r.primary;
    const pct = (x) => `${((x / (r.reps[0]?.n || 200)) * 100).toFixed(1)}%`;
    console.log(line([r.label, pct(p.over16), pct(p.over33), pct(p.over50), pct(p.over66)]));
  }
}

// ---------------------------------------------------------------- 主流程
let browser;
let code = 1;
const pageErrors = [];
const runs = [];
try {
  console.log('[p95] chrome:', CHROME);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !HEADFUL,
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
  // 长跑 vite 会被 HMR 整体重载（任务已确认），重载会销毁执行上下文、让 page.evaluate 抛错。
  // 这里把导航与崩溃显式打出来，免得把「环境被重载」误读成「档位效应」。
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('[p95] NAVIGATED →', f.url()); });
  page.on('error', (e) => console.log('[p95] PAGE CRASH:', String(e).slice(0, 200)));
  await page.setViewport(VIEWPORT);
  page.setDefaultTimeout(240000);

  console.log('[p95] goto', URL);
  const tGoto = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  console.log(`[p95] loaded in ${((Date.now() - tGoto) / 1000).toFixed(1)}s`);

  // 等世界稳定：crowd 铺开、LOD 首落档、着色器首编译都在这段里发生
  await sleep(2500);

  const meta = await page.evaluate((view, settle) => {
    const Q = window.__qingming;
    const e = Q.engine;
    const gl = e.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');

    // —— 控制变量：冻结 autoQuality，锁 high 档 ——
    // 不锁的话，avg>30ms 时 autoQuality 会把 pixelRatio/阴影/bloom 换掉，六档就不再是单变量。
    const natural = { name: e.quality.name, qualityChanges: e.qualityChanges, qualityAuto: e.qualityAuto };
    e.qualityAuto = false;
    // QUALITY.high 的字面值，镜像 src/core/engine.ts:27（运行时注入，不改源码）
    const HIGH = { name: 'high', crowd: 1.0, bloom: true, shadows: true, shadowSize: 2048, pixelRatio: 2 };
    e.applyQuality(e.quality.name === 'high' ? e.quality : HIGH, true);

    // —— 固定机位 ——
    e.cinemaActive = false;
    e.avatarCtl = null;
    e.focusUntil = 0;
    e.tweener.clear();
    e.keys.clear();
    e.camMode = 'fly';
    const [px, py, pz] = view.p;
    const [tx, ty, tz] = view.t;
    const dx = tx - px, dy = ty - py, dz = tz - pz;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.camera.position.set(px, py, pz);
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.lookTarget.set(px - Math.sin(e.yaw) * 30, py + Math.sin(e.pitch) * 30, pz - Math.cos(e.yaw) * 30);
    e.camera.lookAt(e.lookTarget);
    e.camera.updateMatrixWorld(true);

    const basePR = e.renderer.getPixelRatio();
    const kit = {
      basePR,
      savedPasses: e.composer.passes.map((p) => p.enabled),
      hud: [],
      meshes: [],
      pin() {
        const eng = window.__qingming.engine;
        eng.camera.position.set(px, py, pz);
        eng.yaw = Math.atan2(-dx, -dz);
        eng.pitch = Math.asin(dy / d);
        eng.camMode = 'fly';
        eng.cinemaActive = false;
      },
      restore() {
        for (const { el, prev } of kit.hud) el.style.display = prev;
        kit.hud.length = 0;
        for (const { o } of kit.meshes) o.visible = true;
        kit.meshes.length = 0;
        e.renderer.shadowMap.enabled = true;
        const sun = e.scene.getObjectByName('sun');
        if (sun) sun.castShadow = true;
        e.composer.passes.forEach((p, i) => { p.enabled = kit.savedPasses[i]; });
        e.renderer.setPixelRatio(kit.basePR);
        e.composer.setPixelRatio(kit.basePR);
        e.onResize();
      },
      arm(id) {
        if (id === 'baseline') return { applied: true, detail: 'no-op' };
        if (id === 'hud') {
          const seen = new Set();
          for (const sel of ['#ui', '#bossbar', '#interact-prompt', '#toast']) {
            document.querySelectorAll(sel).forEach((el) => {
              if (seen.has(el)) return;
              seen.add(el);
              kit.hud.push({ el, prev: el.style.display });
              el.style.display = 'none';
            });
          }
          return { applied: kit.hud.length > 0, detail: `${kit.hud.length} node(s) display:none` };
        }
        if (id === 'shadow') {
          e.renderer.shadowMap.enabled = false;
          const sun = e.scene.getObjectByName('sun');
          if (sun) sun.castShadow = false;
          return { applied: e.renderer.shadowMap.enabled === false, detail: `sun=${sun ? sun.name : 'missing'}` };
        }
        if (id === 'post') {
          const names = [];
          e.composer.passes.forEach((p, i) => {
            p.enabled = i === 0;
            names.push(`${p.constructor?.name || 'Pass'}:${p.enabled ? 'on' : 'off'}`);
          });
          return { applied: e.composer.passes.filter((p) => p.enabled).length === 1, detail: names.join(',') };
        }
        if (id === 'dpr1' || id === 'dpr05') {
          const pr = id === 'dpr1' ? 1.0 : 0.5;
          const before = [e.renderer.domElement.width, e.renderer.domElement.height];
          e.renderer.setPixelRatio(pr);
          e.composer.setPixelRatio(pr);
          e.onResize();
          const after = [e.renderer.domElement.width, e.renderer.domElement.height];
          const effective = before[0] !== after[0] || before[1] !== after[1];
          return {
            applied: true,
            effective,
            detail: `pixelRatio ${kit.basePR}→${pr}, canvas ${before.join('x')}→${after.join('x')}`,
            note: effective ? '' : 'NO-OP：基线 DPR 已为 1，此档无法单变量地验证填充率；见 D′ 0.5',
          };
        }
        if (id === 'geom') {
          const cand = [];
          e.scene.traverse((o) => {
            if (!o.isMesh || !o.visible || !o.geometry) return;
            const g = o.geometry;
            const verts = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
            const inst = o.isInstancedMesh ? o.count : 1;
            const tris = (verts / 3) * inst;
            if (tris > 0) cand.push({ o, tris });
          });
          cand.sort((a, b) => b.tris - a.tris);
          const top = cand.slice(0, 3);
          top.forEach((t) => { t.o.visible = false; kit.meshes.push({ o: t.o }); });
          const named = {};
          for (const nm of ['city_roof_9', 'city_wood_11']) {
            const idx = cand.findIndex((c) => c.o.name === nm);
            named[nm] = idx >= 0 ? { rank: idx + 1, tris: Math.round(cand[idx].tris) } : 'absent';
          }
          return {
            applied: top.length === 3,
            detail: top.map((t) => `${t.o.name || '(unnamed)'}:${Math.round(t.tris / 1e6 * 100) / 100}M`).join(' + '),
            top: top.map((t) => ({ name: t.o.name || '(unnamed)', tris: Math.round(t.tris) })),
            named,
            candidateMeshes: cand.length,
          };
        }
        return { applied: false, detail: 'unknown arm' };
      },
    };
    window.__p95kit = kit;

    return {
      view,
      settle,
      backend: {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
      },
      viewport: {
        css: [window.innerWidth, window.innerHeight],
        dpr: window.devicePixelRatio,
        canvas: [e.renderer.domElement.width, e.renderer.domElement.height],
      },
      camera: {
        position: e.camera.position.toArray().map((v) => +v.toFixed(2)),
        yaw: +e.yaw.toFixed(4),
        pitch: +e.pitch.toFixed(4),
        lookTarget: e.lookTarget.toArray().map((v) => +v.toFixed(2)),
        camMode: e.camMode,
      },
      quality: { forced: e.quality.name, pixelRatio: e.renderer.getPixelRatio(), natural },
      passChain: e.composer.passes.map((p) => p.constructor?.name || 'Pass'),
      live: Q.world?.liveCount?.() ?? null,
      heroes: Q.world?.heroEntries?.().length ?? null,
    };
  }, VIEW, SETTLE_MS);

  console.log('[p95] backend:', meta.backend.renderer);
  console.log('[p95] viewport:', JSON.stringify(meta.viewport), 'camera:', JSON.stringify(meta.camera));
  console.log('[p95] quality:', JSON.stringify(meta.quality), 'passChain:', meta.passChain.join(' → '));
  if (meta.quality.natural.name !== 'high') {
    console.log(`[p95] NOTE: 载入期 autoQuality 已把档位从 high 降到 ${meta.quality.natural.name}（qualityChanges=${meta.quality.natural.qualityChanges}），六档统一锁回 high`);
  }

  async function measureArm(frames) {
    return page.evaluate((F) => new Promise((resolve) => {
      const e = window.__qingming.engine;
      e.frameMs.length = 0;
      e.frameJsMs.length = 0;
      e.frameRenderMs.length = 0;
      e.maxFrameMs = 0;
      const rec = { frame: [], js: [], render: [], calls: [], tris: [] };
      const t0 = performance.now();
      // 逐帧读「最后一格」而不是按索引累加：frameMs 是 600 帧环，按索引会在 shift 后错位；
      // 引擎的 push 发生在它自己的 rAF 里、比本回调早，所以 at(-1) 就是当前帧。
      const tick = () => {
        const n = e.frameMs.length;
        if (n > 0) {
          rec.frame.push(e.frameMs[n - 1]);
          rec.js.push(e.frameJsMs[e.frameJsMs.length - 1] ?? -1);
          rec.render.push(e.frameRenderMs[e.frameRenderMs.length - 1] ?? -1);
          rec.calls.push(e.renderer.info.render.calls);
          rec.tris.push(e.renderer.info.render.triangles);
        }
        if (rec.frame.length >= F) return resolve(rec);
        if (performance.now() - t0 > 60000) return resolve({ ...rec, timedOut: true });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), frames);
  }

  // 冷窗口丢弃：载入后的头几秒混着着色器首编译、LOD 首落档、世界构建后的第一次 major GC。
  // 不预热就采，单帧 100ms 的冷帧会直接污染 p95（冒烟实测 baseline p95=100 而 p50=16.7）。
  console.log(`\n[p95] warm-up ${WARMUP_MS}ms（丢弃）`);
  const warm = await page.evaluate((ms) => new Promise((resolve) => {
    const e = window.__qingming.engine;
    e.frameMs.length = 0;
    e.maxFrameMs = 0;
    const t0 = performance.now();
    const tick = () => {
      if (performance.now() - t0 >= ms) {
        const a = e.frameMs.slice().sort((x, y) => x - y);
        return resolve({
          frames: a.length,
          p50: +a[Math.floor(a.length * 0.5)]?.toFixed?.(1),
          max: +Math.max(...a).toFixed(1),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), WARMUP_MS);
  console.log('[p95] warm-up done:', JSON.stringify(warm));

  for (let rep = 1; rep <= REPS; rep++) {
    const order = rep % 2 === 1 ? ARMS : [...ARMS].reverse();
    console.log(`\n[p95] === rep ${rep}/${REPS}（${rep % 2 === 1 ? '正序' : '逆序'}）===`);
    for (const arm of order) {
      await page.evaluate(() => { const k = window.__p95kit; k.restore(); k.pin(); });
      const before = await page.evaluate(() => {
        const e = window.__qingming.engine;
        return { canvas: [e.renderer.domElement.width, e.renderer.domElement.height], pr: e.renderer.getPixelRatio() };
      });
      const effect = await page.evaluate((id) => window.__p95kit.arm(id), arm.id);
      await sleep(SETTLE_MS);
      const rec = await measureArm(FRAMES);
      const s = summarize(rec.frame, rec.js, rec.render, rec.calls, rec.tris, rec.timedOut);
      const after = await page.evaluate(() => {
        const e = window.__qingming.engine;
        return {
          canvas: [e.renderer.domElement.width, e.renderer.domElement.height],
          pr: e.renderer.getPixelRatio(),
          shadow: e.renderer.shadowMap.enabled,
          passes: e.composer.passes.filter((p) => p.enabled).length,
          cam: e.camera.position.toArray().map((v) => +v.toFixed(3)),
        };
      });
      const row = { id: arm.id, label: arm.label, what: arm.what, rep, ...s, effect, before, after };
      runs.push(row);
      const cameraOk = Math.hypot(...after.cam.map((v, i) => v - VIEW.p[i])) < 0.01;
      console.log(
        `  ${padW(arm.label, 18)} p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} p99=${s.p99.toFixed(1)} ` +
        `max=${s.max.toFixed(1)} calls=${s.drawCalls} tris=${s.trianglesM.toFixed(2)}M ` +
        `js95=${s.jsP95.toFixed(1)} rd95=${s.renderP95.toFixed(1)} n=${s.n}${s.timedOut ? ' TIMEOUT' : ''} ` +
        `cam=${cameraOk ? 'pinned' : 'DRIFT'}`,
      );
    }
  }

  // ---- 聚合 ----
  const byArm = new Map();
  for (const r of runs) {
    if (!byArm.has(r.id)) byArm.set(r.id, []);
    byArm.get(r.id).push(r);
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const baselineRuns = byArm.get('baseline') || [];
  const baseP95 = mean(baselineRuns.map((r) => r.p95));
  const baseP50 = mean(baselineRuns.map((r) => r.p50));
  const noiseBand = baselineRuns.length > 1
    ? Math.abs(baselineRuns[0].p95 - baselineRuns[1].p95)
    : 0;

  const arms = [];
  for (const arm of ARMS) {
    const rs = byArm.get(arm.id) || [];
    const primary = {
      p50: mean(rs.map((r) => r.p50)),
      p95: mean(rs.map((r) => r.p95)),
      p99: mean(rs.map((r) => r.p99)),
      max: Math.max(...rs.map((r) => r.max)),
      drawCalls: Math.round(mean(rs.map((r) => r.drawCalls))),
      trianglesM: mean(rs.map((r) => r.trianglesM)),
      jsP50: mean(rs.map((r) => r.jsP50)),
      jsP95: mean(rs.map((r) => r.jsP95)),
      renderP50: mean(rs.map((r) => r.renderP50)),
      renderP95: mean(rs.map((r) => r.renderP95)),
      over16: mean(rs.map((r) => r.over16)),
      over33: mean(rs.map((r) => r.over33)),
      over50: mean(rs.map((r) => r.over50)),
      over66: mean(rs.map((r) => r.over66)),
    };
    const rest = arm.id === 'baseline';
    const delta = rest
      ? null
      : {
          p95Ms: +(primary.p95 - baseP95).toFixed(2),
          p95Pct: +(((primary.p95 - baseP95) / (baseP95 || 1)) * 100).toFixed(1),
          p50Ms: +(primary.p50 - baseP50).toFixed(2),
          jsP95Ms: +(primary.jsP95 - mean(baselineRuns.map((r) => r.jsP95))).toFixed(2),
          renderP95Ms: +(primary.renderP95 - mean(baselineRuns.map((r) => r.renderP95))).toFixed(2),
          callsDelta: primary.drawCalls - Math.round(mean(baselineRuns.map((r) => r.drawCalls))),
          trianglesDeltaM: +(primary.trianglesM - mean(baselineRuns.map((r) => r.trianglesM))).toFixed(2),
        };
    const reps = rs.map((r) => ({ rep: r.rep, p50: r.p50, p95: r.p95, p99: r.p99, max: r.max, calls: r.drawCalls, trisM: r.trianglesM, n: r.n, timedOut: r.timedOut, over33: r.over33, over50: r.over50, over66: r.over66, jsP95: r.jsP95, renderP95: r.renderP95 }));
    const consistency = rs.length > 1
      ? {
          reps: reps.length,
          p95SpreadMs: +Math.abs(rs[0].p95 - rs[1].p95).toFixed(2),
          p95SpreadPct: +((Math.abs(rs[0].p95 - rs[1].p95) / (mean(rs.map((r) => r.p95)) || 1)) * 100).toFixed(1),
          sameDirectionAsBaseline: null,
          exceedsNoiseBand: Math.abs(rs[0].p95 - rs[1].p95) > noiseBand,
        }
      : null;
    arms.push({
      id: arm.id,
      label: arm.label,
      what: arm.what,
      primary,
      deltaVsBaseline: delta,
      reps,
      consistency,
      effect: rs[0]?.effect ?? null,
      canvas: { before: rs[0]?.before ?? null, after: rs[0]?.after ?? null },
      significant: arm.id !== 'baseline' && delta ? Math.abs(delta.p95Ms) > noiseBand : null,
    });
  }

  // ---- 归因：把「单变量消融带来的 p95 降幅」归一化 ----
  // 这是独立消融的归一化，不是可加分解：两档的收益作用在同一段墙钟上，不能相加当预算。
  const fillNoop = arms.find((a) => a.id === 'dpr1')?.effect;
  const candidates = arms.filter((a) => a.id !== 'baseline' && !(a.id === 'dpr1' && fillNoop && fillNoop.effective === false));
  const gains = candidates
    .map((a) => ({ id: a.id, label: a.label, gainMs: -(a.deltaVsBaseline?.p95Ms ?? 0), pct: -(a.deltaVsBaseline?.p95Pct ?? 0) }))
    .filter((g) => g.gainMs > 0);
  const totalGain = gains.reduce((s, g) => s + g.gainMs, 0);
  for (const g of gains) g.sharePct = +((g.gainMs / (totalGain || 1)) * 100).toFixed(1);
  gains.sort((a, b) => b.gainMs - a.gainMs);
  const top = gains[0] ?? null;
  const conclusion = top
    ? {
        primarySource: top.id,
        primaryLabel: top.label,
        p95DropMs: +top.gainMs.toFixed(2),
        p95DropPctOfBaseline: +(((top.gainMs / (baseP95 || 1)) * 100)).toFixed(1),
        shareOfMeasuredGainPct: top.sharePct,
        method: '单变量消融的归一化占位，不是可加分解；未超过噪声带的档位不参与占比',
        allGains: gains,
      }
    : {
        primarySource: 'none',
        primaryLabel: '无可归因（所有消融的 p95 变化都在噪声带内）',
        p95DropMs: 0,
        p95DropPctOfBaseline: 0,
        shareOfMeasuredGainPct: 0,
        method: '单变量消融的归一化占位，不是可加分解',
        allGains: [],
      };

  const payload = {
    generatedAt: new Date().toISOString(),
    url: URL,
    chrome: CHROME,
    protocol: {
      framesPerArm: FRAMES,
      settleMs: SETTLE_MS,
      reps: REPS,
      warmupMs: WARMUP_MS,
      orderNote: 'rep1 正序 / rep2 逆序，抵消漂移',
      percentile: 'asc[round(p*(n-1))]，n=200 时 p95 即第 11 大（与 verify-packaged 的降序 index 一致）',
      maxClampNote: 'engine dt 被 Math.min(0.1, …) 截断，max 的理论上限是 100ms',
      renderMsNote: 'frameRenderMs = composer.render() 的 CPU 提交耗时，不是 GPU 完成时间',
      injectedOnly: '全部消融经 page.evaluate 运行时注入，src/ 未改动',
    },
    view: VIEW,
    viewport: meta.viewport,
    backend: meta.backend,
    camera: meta.camera,
    quality: meta.quality,
    passChain: meta.passChain,
    world: { live: meta.live, heroes: meta.heroes },
    warmup: warm,
    noiseBandP95Ms: +noiseBand.toFixed(2),
    baseline: { p50: +baseP50.toFixed(2), p95: +baseP95.toFixed(2) },
    arms,
    conclusion,
    pageErrors: pageErrors.slice(0, 10),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log('\n[p95] wrote', OUT);

  printTable(arms, payload.baseline);
  printSlowTable(arms);

  console.log('\n一致性（每档两轮 p95 差，基线噪声带 ' + noiseBand.toFixed(2) + 'ms）：');
  for (const a of arms) {
    if (!a.consistency) continue;
    const c = a.consistency;
    console.log(`  ${padW(a.label, 18)} rep1=${a.reps[0].p95.toFixed(1)} rep2=${a.reps[1].p95.toFixed(1)} Δ=${c.p95SpreadMs}ms (${c.p95SpreadPct}%) ${c.exceedsNoiseBand ? '>噪声带' : '≤噪声带'}`);
  }

  console.log('\n效应自检（消融是否真的生效）：');
  for (const a of arms) {
    if (a.id === 'baseline') continue;
    const e = a.effect || {};
    console.log(`  ${padW(a.label, 18)} applied=${e.applied} effective=${e.effective === undefined ? 'n/a' : e.effective} :: ${e.detail || ''}${e.note ? ' | ' + e.note : ''}`);
  }
  const geom = arms.find((a) => a.id === 'geom')?.effect;
  if (geom?.named) console.log('[p95] top3 命名核对:', JSON.stringify(geom.named));

  console.log('\n相机固定核对:', JSON.stringify(meta.camera));
  console.log('结论：p95 的主要来源 =', conclusion.primaryLabel,
    `（−${conclusion.p95DropMs}ms，占实测可归因降幅的 ${conclusion.shareOfMeasuredGainPct}%）`);

  console.log('\n⚠ 口径提醒：');
  console.log('  · 六档是独立消融，降幅不能相加；占比只是「已测到的降幅」的归一化。');
  console.log('  · frameRenderMs 是 CPU 提交时间；GPU 成本只体现在 rAF 间隔（frameMs）上。');
  console.log('  · 任一档 p95 上升都按原值报告（见上表），未做修剪。');
  if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5));
  code = 0;
} catch (err) {
  console.error('[p95] FAILED:', String(err).slice(0, 600));
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, error: String(err).slice(0, 2000), pageErrors, partialRuns: runs }, null, 2), 'utf8');
  } catch { /* ignore */ }
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
}
process.exit(code);
