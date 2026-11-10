/**
 * R29 M2 · r27 验收权威入口（FIX-006 + FIX-004 R4）。
 *
 *   node scripts/r27_acceptance.mjs --self-test       # 注入负例，期望全部 FAIL，rc=2
 *   node scripts/r27_acceptance.mjs --init-baseline   # 真机重采 BakerStats 三角数，写随包基线
 *   node scripts/r27_acceptance.mjs                   # 真机全量验收，rc=0 且 PASS.all=true
 *   grep -n 'no-tris-baseline' scripts/r27_acceptance.mjs   # 期望命中
 *
 * 真机实现放在 r27_collision_acceptance.mjs（R27 原有 19 门全流程），本入口负责：
 *   ① --self-test 的门负例自证（FIX-006 R4 / QA-003 R2）
 *   ② --init-baseline 的静态三角数基线重采（FIX-006 R1）
 *   ③ 全量跑完后**独立复核**报告：PASS.all / hardenedGates.all / pageErrors / 报告新鲜度，
 *      不盲信子进程 rc，防止「旧报告复活」造成的假绿。
 *
 * spec 退出码统一约定：--self-test 打印 SELF_TEST=PASS 且以 rc=2 退出
 * （FIX-006 / QA-005 口径），check-gates.mjs 已按同一契约接受 rc∈{0,2}。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSelfTest, sumBakedTriangles, readTrisBaseline, TRIS_BASELINE_SCHEMA, GATE_THRESHOLDS,
} from './lib/r27Gates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(ROOT, 'artifacts', 'r27-collision-runtime.json');
const BASELINE = path.join(ROOT, 'artifacts', 'r27-tris-baseline.json');
const argv = process.argv.slice(2);
const SELF_TEST = argv.includes('--self-test');
const INIT_BASELINE = argv.includes('--init-baseline');
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4186/';

function out(o, rc) {
  console.log(JSON.stringify(o, null, 2));
  process.exit(rc);
}

function selfTest() {
  const r = runSelfTest();
  // 负例1 的 reason 字面量必须在本文件可 grep 命中（spec 验收命令）：
  // no-tris-baseline —— 基线/totalTris 任一缺失就 FAIL，绝不 fail-open。
  const noTrisBaselineCase = r.cases.find((c) => c.reason === 'no-tris-baseline');
  // 精确对应 spec R4 的三个注入负例：totalTris=null / steps=10 / settleFailed=3
  const specThree = [
    r.cases.find((c) => c.reason === 'no-tris-baseline'),
    r.cases.find((c) => c.reason === 'degraded-performance'),
    r.cases.find((c) => c.reason === 'settle-failed'),
  ];
  const allThreeFail = specThree.every((c) => !!c && c.got === 'FAIL' && c.ok);
  const ok = r.all && !!noTrisBaselineCase && allThreeFail;
  out({
    mode: 'offline',
    gate: ok ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL',
    note: ok
      ? '3 个 spec 指定负例（totalTris=null / steps=10 / settleFailed=3）全部 FAIL，门未腐烂；按 FIX-006 口径 rc=2'
      : '存在负例被放过，门已腐烂，必须修复',
    noTrisBaseline: r.cases.filter((c) => c.reason === 'no-tris-baseline').map((c) => c.name),
    specThreeNegatives: specThree.map((c) => ({ name: c.name, got: c.got, reason: c.reason })),
    negativeCases: r.negativeCases, cases: r.cases, thresholds: GATE_THRESHOLDS,
    realMachine: 'SKIPPED', PASS: { all: null, note: 'SELF_TEST 不计入 PASS.all' },
  }, ok ? 2 : 1);
}

async function chrome() {
  if (process.env.CHROME || process.env.EDGE) return process.env.CHROME || process.env.EDGE;
  const m = await import('./chromePath.mjs');
  return m.CHROME;
}

/** FIX-006 R1：基线取「世界烘焙后静态总三角数」，不是逐帧 __perf().tris。 */
async function initBaseline() {
  let puppeteer;
  try { puppeteer = await import('puppeteer-core'); }
  catch (e) { out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-puppeteer-core: ' + e.message, PASS: { all: null } }, 0); }
  const exe = await chrome();
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--no-proxy-server', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(
      () => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit,
      { timeout: 240000 },
    );
    const audit = await page.evaluate(() => window.__qingming.world.assetAudit);
    const totalTris = sumBakedTriangles(audit);
    if (totalTris === null) {
      out({ mode: 'real', gate: 'FAIL', reason: 'no-tris-baseline', note: 'assetAudit.groups 不可用，拒绝写空基线', PASS: { all: false } }, 1);
    }
    // 不含时间戳：同一构建重复 --init-baseline 产出字节一致（QA-001 S06 口径）
    const payload = {
      schema: TRIS_BASELINE_SCHEMA,
      source: 'window.__qingming.world.assetAudit (BakerStats.groups[*].triangles 求和)',
      sampledBy: 'scripts/r27_acceptance.mjs --init-baseline',
      url: URL,
      totalTris,
      groups: Object.fromEntries(Object.entries(audit.groups)
        .sort(([a], [b]) => a < b ? -1 : 1)
        .map(([k, v]) => [k, { vertices: v.vertices, triangles: v.triangles }])),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2));
    out({ mode: 'real', gate: 'PASS', reason: 'baseline-written', path: 'artifacts/r27-tris-baseline.json',
      totalTris, groups: Object.keys(payload.groups).length, PASS: { all: true } }, 0);
  } finally { await browser.close(); }
}

/** 全量真机验收 + 独立复核，不盲信子进程 rc。 */
async function runFull() {
  const { baseline, baselineError } = readTrisBaseline(ROOT);
  if (!baseline) {
    out({
      mode: 'offline', gate: 'FAIL', reason: 'no-tris-baseline',
      note: '基线缺失：先跑 node scripts/r27_acceptance.mjs --init-baseline',
      baselineError, PASS: { all: false },
    }, 1);
  }
  const before = fs.existsSync(RUNTIME) ? fs.statSync(RUNTIME).mtimeMs : 0;
  await import('./r27_collision_acceptance.mjs');
  if (!fs.existsSync(RUNTIME) || fs.statSync(RUNTIME).mtimeMs <= before) {
    out({ mode: 'degraded', gate: 'FAIL', reason: 'stale-acceptance-report',
      note: '验收脚本未产出新报告，拒绝读旧报告冒充本次结果', PASS: { all: false } }, 1);
  }
  const rep = JSON.parse(fs.readFileSync(RUNTIME, 'utf8'));
  const hardened = rep.hardenedGates ?? null;
  const checks = {
    passAll: rep.PASS?.all === true,
    hardenedAll: hardened?.all === true,
    capNotHit: hardened?.bools?.capNotHit === true,
    trisUnchanged: hardened?.bools?.trisUnchanged === true,
    debrisFell: hardened?.bools?.debrisFell === true,
    settleOk: hardened?.bools?.settleOk === true,
    pageErrorsZero: Array.isArray(rep.pageErrors) && rep.pageErrors.length === 0,
    debrisStepsGE600: (hardened?.gates?.debrisFell?.steps ?? 0) >= GATE_THRESHOLDS.debrisMinSteps,
  };
  const ok = Object.values(checks).every(Boolean);
  out({
    mode: 'real', gate: ok ? 'PASS' : 'FAIL', url: URL,
    evidence: 'artifacts/r27-collision-runtime.json',
    checks, hardenedGates: hardened?.gates ?? null,
    pageErrors: rep.pageErrors, PASS: { all: ok },
  }, ok ? 0 : 2);
}

if (SELF_TEST) selfTest();
else if (INIT_BASELINE) initBaseline().catch((e) => out({
  mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-' + String(e), PASS: { all: null },
}, 0));
else runFull().catch((e) => out({
  mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-' + String(e), PASS: { all: null },
}, 0));
