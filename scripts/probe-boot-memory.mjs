/**
 * PERF-001 R1：启动内存「先测量后动刀」探针。
 *
 *   node scripts/probe-boot-memory.mjs --self-test     # 门负例自证，rc=0
 *   node scripts/probe-boot-memory.mjs                 # 真机 1 次，写 boot-memory-profile.json
 *   node scripts/probe-boot-memory.mjs --repeat 3      # 3 次取中位数（PERF-002 验收）
 *   node scripts/probe-boot-memory.mjs --low           # ?low=1（PERF-002 R4）
 *   node scripts/probe-boot-memory.mjs --lowmem-sim    # 注入 navigator.deviceMemory=2（QA-008 R1）
 *
 * 采样双轨：页面内 setInterval(200ms) 写数组（主线程被同步烘焙阻塞时仍能在间隙留痕），
 * 外部只等 booted 后一次性取回；不靠外部定时 evaluate 假装「每 2s 都有样本」。
 * 阶段归因直接读 world.ts 的 window.__phase（含 flush@ / post@），不猜、不拍脑袋。
 *
 * QA-004 披露：无浏览器/预览地址 → gate=SKIPPED、mode=degraded、PASS.all=null。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'artifacts');
const PROFILE = path.join(ART, 'boot-memory-profile.json');
const TIMELINE = path.join(ART, 'spec', 'PERF-001-boot-timeline.json');
const STAGE_ATTR = path.join(ART, 'spec', 'PERF-001-stage-attribution.json');
const BOOT_HW = path.join(ART, 'boot-hw.json');
// PERF-001 R2：8ms 时间预算切片的真机台账（切片数 / 同步占用 / 逐任务分布）。
const R2_SLICES = path.join(ART, 'spec', 'PERF-001-r2-slices.json');
const argv = process.argv.slice(2);
const SELF_TEST = argv.includes('--self-test');
const LOW = argv.includes('--low');
const LOWMEM_SIM = argv.includes('--lowmem-sim');
const repeatArg = argv.indexOf('--repeat');
const REPEAT = repeatArg >= 0 ? Math.max(1, Math.min(10, Number(argv[repeatArg + 1]) || 1)) : 1;
const BASE_URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4186/';
const URL = BASE_URL + (LOW && !BASE_URL.includes('?') ? '?low=1' : '');

export const BOOT_LIMITS = {
  heapPeakMB: 1536,
  bootSeconds: 120,
  settledMB: 600,
  minSamples: 3,
  maxProgressStallSeconds: 4,
};

/** 纯函数判定：--self-test 注入伪造 profile 证明门会 FAIL。 */
export function evaluateBoot(profile) {
  if (!profile || profile.booted !== true) {
    return { ok: false, gate: 'FAIL', reason: 'not-booted' };
  }
  if (!Array.isArray(profile.timeline) || profile.timeline.length < BOOT_LIMITS.minSamples) {
    return { ok: false, gate: 'FAIL', reason: 'insufficient-samples' };
  }
  if (!Number.isFinite(profile.heapPeakMB) || profile.heapPeakMB <= 0) {
    return { ok: false, gate: 'FAIL', reason: 'no-heap-samples' };
  }
  if (profile.heapPeakMB > BOOT_LIMITS.heapPeakMB) {
    return { ok: false, gate: 'FAIL', reason: 'heap-peak-over-budget', heapPeakMB: profile.heapPeakMB };
  }
  if (!Number.isFinite(profile.bootSeconds) || profile.bootSeconds > BOOT_LIMITS.bootSeconds) {
    return { ok: false, gate: 'FAIL', reason: 'boot-too-slow', bootSeconds: profile.bootSeconds };
  }
  if (!Number.isFinite(profile.settledMB) || profile.settledMB > BOOT_LIMITS.settledMB) {
    return { ok: false, gate: 'FAIL', reason: 'settled-over-budget', settledMB: profile.settledMB };
  }
  if (!Array.isArray(profile.pageErrors) || profile.pageErrors.length > 0) {
    return { ok: false, gate: 'FAIL', reason: 'page-errors', pageErrors: profile.pageErrors };
  }
  if ((profile.maxStallSeconds ?? 0) > BOOT_LIMITS.maxProgressStallSeconds) {
    return { ok: false, gate: 'FAIL', reason: 'progress-stall', maxStallSeconds: profile.maxStallSeconds };
  }
  // QA-008 R1：--lowmem-sim 是「提示卡 + 自动低配」的验收工况，缺任一即 FAIL。
  // 与启动内存门分账：这一门过不代表 heap 达标，反之亦然。
  if (profile.lowmemSim === true) {
    const q = profile.qa008;
    if (!q || q.promptShown !== true || q.perfMode !== 'low' || q.deviceMemoryGB !== 2) {
      return { ok: false, gate: 'FAIL', reason: 'qa008-lowmem-sim-not-degraded', qa008: q ?? null };
    }
  }
  return { ok: true, gate: 'PASS', reason: 'boot-within-budget' };
}

/** QA-008 独立门：不与 heap 预算门混算，单独输出 PASS/FAIL。 */
export function evaluateQa008(runtime, lowmemSim) {
  if (!lowmemSim) return { ok: null, gate: 'SKIPPED', reason: 'QA-008 断言仅在 --lowmem-sim 工况执行' };
  const ok = runtime.promptShown === true && runtime.perfMode === 'low'
    && runtime.hwProfile?.deviceMemoryGB === 2 && runtime.bootPhase === 'ready';
  return {
    ok, gate: ok ? 'PASS' : 'FAIL',
    reason: ok ? 'lowmem-sim 提示卡出现且自动进低配' : 'lowmem-sim 未触发完整降级披露',
    promptShown: runtime.promptShown, perfMode: runtime.perfMode,
    deviceMemoryGB: runtime.hwProfile?.deviceMemoryGB ?? null,
    bootPhase: runtime.bootPhase,
    degradedItems: runtime.perfDecision?.degraded ?? [],
  };
}

/** 按 __phase 分桶，delta = 该阶段内最大 heap − 进入该阶段时的 heap。 */
export function attributeStages(timeline) {
  const stages = new Map();
  let prevPhase = null;
  for (const s of timeline) {
    if (!s.phase) continue;
    if (!stages.has(s.phase)) {
      stages.set(s.phase, { stage: s.phase, samples: 0, firstT: s.t, lastT: s.t,
        entryHeapMB: s.heapMB, maxHeapMB: s.heapMB, deltaMB: 0 });
    }
    const b = stages.get(s.phase);
    b.samples++;
    b.lastT = s.t;
    if (Number.isFinite(s.heapMB)) {
      b.maxHeapMB = Math.max(b.maxHeapMB ?? 0, s.heapMB);
      if (!Number.isFinite(b.entryHeapMB)) b.entryHeapMB = s.heapMB;
    }
    prevPhase = s.phase;
  }
  for (const b of stages.values()) {
    b.deltaMB = +(((b.maxHeapMB ?? 0) - (b.entryHeapMB ?? 0))).toFixed(1);
    b.durationMs = b.lastT - b.firstT;
  }
  const sorted = [...stages.values()].sort((a, b) => b.deltaMB - a.deltaMB);
  return { byStage: sorted, top3: sorted.slice(0, 3), prevPhase };
}

/** 进度停滞：相邻 2 次采样进度不变的连续时长（秒）。 */
export function maxProgressStall(timeline) {
  let stallStart = null, max = 0;
  let prevProgress = null;
  for (const s of timeline) {
    if (!Number.isFinite(s.progress)) continue;
    if (prevProgress !== null && s.progress <= prevProgress) {
      if (stallStart === null) stallStart = s.t;
    } else {
      if (stallStart !== null) max = Math.max(max, (s.t - stallStart) / 1000);
      stallStart = null;
    }
    prevProgress = s.progress;
  }
  if (stallStart !== null && timeline.length) {
    max = Math.max(max, (timeline[timeline.length - 1].t - stallStart) / 1000);
  }
  return +max.toFixed(2);
}

function zeroRealm() { return { tasks: 0, vertices: 0, triangles: 0, bytes: 0 }; }

function out(o, rc) {
  console.log(JSON.stringify(o, null, 2));
  process.exit(rc);
}

function selfTest() {
  const good = {
    booted: true, bootSeconds: 40, heapPeakMB: 900, settledMB: 400,
    maxStallSeconds: 1.5, pageErrors: [],
    timeline: [{ t: 0, heapMB: 100 }, { t: 1000, heapMB: 300 }, { t: 2000, heapMB: 900 }],
  };
  const cases = [
    { name: 'booted=false → FAIL', p: { ...good, booted: false }, reason: 'not-booted' },
    { name: '采样不足 → FAIL', p: { ...good, timeline: [] }, reason: 'insufficient-samples' },
    { name: 'heapPeakMB=3072 超预算 → FAIL', p: { ...good, heapPeakMB: 3072 }, reason: 'heap-peak-over-budget' },
    { name: 'bootSeconds=180 超时 → FAIL', p: { ...good, bootSeconds: 180 }, reason: 'boot-too-slow' },
    { name: 'settledMB=900 超常驻预算 → FAIL', p: { ...good, settledMB: 900 }, reason: 'settled-over-budget' },
    { name: 'pageErrors 非空 → FAIL', p: { ...good, pageErrors: ['PAGE:x'] }, reason: 'page-errors' },
    { name: '进度停滞 >4s → FAIL', p: { ...good, maxStallSeconds: 9 }, reason: 'progress-stall' },
    { name: 'QA-008 lowmem-sim 无提示卡 → FAIL', p: { ...good, lowmemSim: true, qa008: { promptShown: false, perfMode: 'low', deviceMemoryGB: 2 } }, reason: 'qa008-lowmem-sim-not-degraded' },
    { name: 'QA-008 lowmem-sim 未自动低配 → FAIL', p: { ...good, lowmemSim: true, qa008: { promptShown: true, perfMode: 'normal', deviceMemoryGB: 2 } }, reason: 'qa008-lowmem-sim-not-degraded' },
    { name: '全项合规 → PASS', p: good, ok: true },
  ];
  const rows = cases.map((c) => {
    const g = evaluateBoot(c.p);
    return { name: c.name, expect: c.ok ? 'PASS' : 'FAIL', got: g.gate, reason: g.reason,
      ok: c.ok ? g.ok === true : (g.ok === false && g.reason === c.reason) };
  });
  const all = rows.every((r) => r.ok);
  out({ mode: 'offline', gate: all ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL',
    negativeCases: rows.filter((r) => r.expect === 'FAIL').length, cases: rows,
    realMachine: 'SKIPPED', PASS: { all: null } }, all ? 0 : 1);
}

async function resolveChrome() {
  if (process.env.CHROME || process.env.EDGE) return process.env.CHROME || process.env.EDGE;
  const m = await import('./chromePath.mjs');
  return m.CHROME;
}

async function oneRun(puppeteer, exe, runIndex) {
  const errs = [];
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--no-proxy-server',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info',
      '--window-size=1600,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 240)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 240)); });
    await page.evaluateOnNewDocument((lowmemSim) => {
      if (lowmemSim) {
        Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 2 });
      }
      window.__bootSamples = [];
      const t0 = Date.now();
      window.__bootSampler = setInterval(() => {
        const w = window;
        if (w.__bootSamples.length >= 6000) return;
        const m = w.performance && w.performance.memory;
        const bar = document.querySelector('#loading .load-bar i');
        let solids = null;
        try { if (typeof w.__qingming?.solids === 'function') solids = w.__qingming.solids(); } catch { /* 未就绪 */ }
        let crowd = null;
        try { crowd = w.__qingming?.world?.crowd?.actors?.length ?? null; } catch { /* 未就绪 */ }
        w.__bootSamples.push({
          t: Date.now() - t0,
          heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
          phase: w.__phase || null,
          progress: bar ? (parseFloat(bar.style.width) || 0) : 100,
          solidsTotal: solids?.total ?? null,
          capDropped: solids?.capDropped ?? null,
          crowd,
        });
      }, 200);
    }, LOWMEM_SIM);

    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    let booted = true;
    await page.waitForFunction(
      () => !document.getElementById('loading') && !!window.__qingming?.world,
      { timeout: 240000, polling: 500 },
    ).catch(() => { booted = false; });
    const bootSeconds = +((Date.now() - t0) / 1000).toFixed(2);

    // PERF-001 R1 / QA-008 R2：loading 移除后一次性取回「逐任务几何台账 + 硬件档案 + 降档事实」。
    // 全部读运行期对象，不从报告或台账反推；缺字段如实留 null，门会 fail-closed。
    const runtime = await page.evaluate(() => {
      const q = window.__qingming || {};
      const card = document.getElementById('hw-prompt');
      const call = (f) => { try { return typeof f === 'function' ? f() : null; } catch { return null; } };
      return {
        hwProfile: q.hwProfile ?? null,
        perfDecision: q.perfDecision ?? null,
        perfMode: q.perfMode ?? null,
        bootPhase: call(q.bootPhase),
        bakeStages: call(q.bakeStages) ?? window.__bakeStages ?? [],
        // PERF-001 R2：8ms 时间预算切片遥测（缺字段留 null，绝不补 0 冒充未实施）。
        bakeBudget: call(q.bakeBudget),
        // PERF-001 R2 诊断：收尾各函数真实耗时（先测量后动刀，不猜函数）。
        r2Timings: window.__r2Timings ?? null,
        lowDecor: call(q.lowDecor),
        hwThresholds: q.hwThresholds ?? null,
        pixelRatio: call(() => q.engine.renderer.getPixelRatio()),
        shadowsEnabled: call(() => q.engine.renderer.shadowMap.enabled),
        crowd: call(() => q.world.crowd.actors.length),
        assetAuditGroups: call(() => q.world.assetAudit?.groups ?? null),
        promptShown: !!card,
        promptMode: card?.dataset?.perfMode ?? null,
        promptReason: card?.dataset?.reason ?? null,
      };
    });
    const qa008 = evaluateQa008(runtime, LOWMEM_SIM);

    // CDP 强制 GC 后读常驻堆，不用「等几秒自然回落」冒充 settled。
    let settledMB = null;
    try {
      const cdp = await page.createCDPSession();
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      settledMB = await page.evaluate(() => performance.memory
        ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null);
      await cdp.detach();
    } catch (e) { settledMB = null; }

    const timeline = await page.evaluate(() => {
      clearInterval(window.__bootSampler);
      return window.__bootSamples ?? [];
    });
    const heaps = timeline.map((s) => s.heapMB).filter(Number.isFinite);
    const heapPeakMB = heaps.length ? Math.max(...heaps) : null;
    const attribution = attributeStages(timeline);
    const maxStallSeconds = maxProgressStall(timeline);
    const profile = {
      runIndex, url: URL, low: LOW, lowmemSim: LOWMEM_SIM,
      booted, bootSeconds, heapPeakMB, settledMB, maxStallSeconds,
      sampleCount: timeline.length, pageErrors: errs,
      top3: attribution.top3, stageCount: attribution.byStage.length,
      runtime, qa008, timeline,
    };
    const gate = evaluateBoot(profile);
    return { ...profile, gate, attribution };
  } finally { await browser.close(); }
}

async function main() {
  let puppeteer;
  try { puppeteer = await import('puppeteer-core'); }
  catch (e) { out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-puppeteer-core: ' + e.message, PASS: { all: null } }, 0); }
  let exe;
  try { exe = await resolveChrome(); }
  catch (e) { out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-' + String(e), PASS: { all: null } }, 0); }
  if (!process.env.PREVIEW_URL && !(await isReachable(BASE_URL))) {
    out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-预览地址不可达: ' + BASE_URL, PASS: { all: null } }, 0);
  }

  const runs = [];
  for (let i = 1; i <= REPEAT; i++) {
    const r = await oneRun(puppeteer, exe, i);
    runs.push(r);
    console.log(`run ${i}/${REPEAT}: booted=${r.booted} boot=${r.bootSeconds}s peak=${r.heapPeakMB}MB settled=${r.settledMB}MB samples=${r.sampleCount} gate=${r.gate.gate}/${r.gate.reason}`);
  }
  fs.mkdirSync(ART, { recursive: true });
  fs.mkdirSync(path.dirname(TIMELINE), { recursive: true });
  const secs = runs.map((r) => r.bootSeconds).filter(Number.isFinite).sort((a, b) => a - b);
  const median = secs.length ? secs[Math.floor(secs.length / 2)] : null;
  const last = runs[runs.length - 1];
  // 随包摘要不含绝对时间戳；逐样本时间线另存 artifacts/spec/（运行期证据目录）。
  const summary = {
    schema: 'boot-memory-profile/v1',
    sampledBy: 'scripts/probe-boot-memory.mjs',
    url: URL, runs: REPEAT, low: LOW, lowmemSim: LOWMEM_SIM,
    limits: BOOT_LIMITS,
    medianBootSeconds: median,
    bootSeconds: secs,
    heapPeakMB: Math.max(...runs.map((r) => r.heapPeakMB ?? 0)),
    settledMB: last.settledMB,
    maxStallSeconds: Math.max(...runs.map((r) => r.maxStallSeconds ?? 0)),
    pageErrors: last.pageErrors,
    top3: last.top3,
    stages: last.attribution.byStage,
    stageCount: last.attribution.byStage.length,
    sampleCount: last.sampleCount,
    gates: runs.map((r) => r.gate),
    PASS: { all: runs.every((r) => r.gate.ok === true) },
  };
  // PERF-001 R1：把 Baker 的逐任务几何台账按界域聚合，落运行期证据。
  // 口径与 src/game/bakePlan.ts 的 summarizeByRealm 一致（未知 realm 归 shared）。
  const stages = Array.isArray(last.runtime?.bakeStages) ? last.runtime.bakeStages : [];
  const byRealm = { human: zeroRealm(), heaven: zeroRealm(), underworld: zeroRealm(), shared: zeroRealm() };
  for (const s of stages) {
    const cell = byRealm[s.realm] ?? byRealm.shared;
    cell.tasks += 1; cell.vertices += s.vertices || 0;
    cell.triangles += s.triangles || 0; cell.bytes += s.bytes || 0;
  }
  const total = stages.reduce((a, s) => ({
    vertices: a.vertices + (s.vertices || 0),
    triangles: a.triangles + (s.triangles || 0),
    bytes: a.bytes + (s.bytes || 0),
  }), { vertices: 0, triangles: 0, bytes: 0 });
  fs.writeFileSync(STAGE_ATTR, JSON.stringify({
    schema: 'perf-001-stage-attribution/v1',
    sampledBy: 'scripts/probe-boot-memory.mjs',
    source: 'window.__qingming.bakeStages() -> Baker.stageStats()（flush 落盘精确值）',
    url: URL, low: LOW, lowmemSim: LOWMEM_SIM, perfMode: last.runtime?.perfMode ?? null,
    total, byRealm,
    top10: [...stages].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    stages,
  }, null, 2));
  fs.writeFileSync(BOOT_HW, JSON.stringify({
    schema: 'boot-hw/v1',
    sampledBy: 'scripts/probe-boot-memory.mjs',
    url: URL, low: LOW, lowmemSim: LOWMEM_SIM,
    hwProfile: last.runtime?.hwProfile ?? null,
    perfDecision: last.runtime?.perfDecision ?? null,
    thresholds: last.runtime?.hwThresholds ?? null,
    qa008: last.qa008,
    runtime: {
      bootPhase: last.runtime?.bootPhase ?? null,
      pixelRatio: last.runtime?.pixelRatio ?? null,
      shadowsEnabled: last.runtime?.shadowsEnabled ?? null,
      crowd: last.runtime?.crowd ?? null,
      lowDecor: last.runtime?.lowDecor ?? null,
      promptShown: last.runtime?.promptShown ?? false,
      promptMode: last.runtime?.promptMode ?? null,
      promptReason: last.runtime?.promptReason ?? null,
    },
    measured: { bootSeconds: last.bootSeconds, heapPeakMB: last.heapPeakMB, settledMB: last.settledMB },
  }, null, 2));
  fs.writeFileSync(PROFILE, JSON.stringify({
    ...summary, bakeStageCount: stages.length,
    bakeTotal: total, bakeByRealm: byRealm,
    perfMode: last.runtime?.perfMode ?? null,
    bootPhase: last.runtime?.bootPhase ?? null,
    // PERF-001 R2：切片台账摘要。null 表示运行期没有该句柄（老包），不伪造 0。
    bakeBudget: last.runtime?.bakeBudget ?? null,
    qa008: last.qa008,
  }, null, 2));
  fs.writeFileSync(R2_SLICES, JSON.stringify({
    schema: 'perf-001-r2-slices/v1',
    sampledBy: 'scripts/probe-boot-memory.mjs',
    source: 'window.__qingming.bakeBudget() -> src/core/bakeBudget.ts',
    url: URL, low: LOW, lowmemSim: LOWMEM_SIM,
    budgetMs: 8,
    slices: last.runtime?.bakeBudget ?? null,
    // 收尾阶段逐函数真实耗时，用于定位 >4s 的单个同步块（不猜、不预填）。
    closingTimingsMs: last.runtime?.r2Timings ?? null,
    maxStallSeconds: summary.maxStallSeconds,
    bootSeconds: last.bootSeconds,
    note: 'R2 只削峰、不降常驻；heap 门结论以 boot-memory-profile.json 的 gates 为准。',
  }, null, 2));
  fs.writeFileSync(TIMELINE, JSON.stringify({
    at: new Date().toISOString(), url: URL,
    runs: runs.map((r) => ({ runIndex: r.runIndex, timeline: r.timeline, pageErrors: r.pageErrors })),
  }, null, 2));
  out({
    mode: 'real', gate: summary.PASS.all ? 'PASS' : 'FAIL',
    evidence: 'artifacts/boot-memory-profile.json',
    timelineEvidence: 'artifacts/spec/PERF-001-boot-timeline.json',
    stageEvidence: 'artifacts/spec/PERF-001-stage-attribution.json',
    hwEvidence: 'artifacts/boot-hw.json',
    runs: REPEAT, medianBootSeconds: median,
    heapPeakMB: summary.heapPeakMB, settledMB: summary.settledMB,
    maxStallSeconds: summary.maxStallSeconds, pageErrors: last.pageErrors.length,
    top3: summary.top3,
    bakeStageCount: stages.length, bakeTotal: total, bakeByRealm: byRealm,
    perfMode: last.runtime?.perfMode ?? null, qa008: last.qa008,
    PASS: { all: summary.PASS.all },
  }, summary.PASS.all ? 0 : 1);
}

/**
 * 用 node:http 直连，不依赖 curl。
 * 修前沿用 `curl -s -o /dev/null -w %{http_code}`，在 Windows Git Bash 上实测
 * `status=23`（写 /dev/null 失败）但 stdout 已是 "200" → 被误判成「预览地址不可达」，
 * 真机门直接走 SKIPPED/DEGRADED 假阴性。改用标准库后 2xx 即真可达。
 */
function isReachable(u) {
  return new Promise((resolve) => {
    let target;
    // 本模块顶层有 `const URL = BASE_URL + ...`（预览地址字符串），会遮蔽全局 URL 构造器；
    // 必须显式取 globalThis.URL，否则 `new URL()` 抛 TypeError 被吞成「不可达」。
    try { target = new globalThis.URL(u); } catch { resolve(false); return; }
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.get(target, (res) => {
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400;
      res.resume();
      resolve(ok);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

if (SELF_TEST) selfTest();
else main().catch((e) => out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-' + String(e), PASS: { all: null } }, 0));
