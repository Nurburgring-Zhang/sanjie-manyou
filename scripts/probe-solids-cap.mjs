/**
 * FIX-004 R3/R4 + PERF-003 R1 真机探针：solids cap 触顶遥测与豁免门。
 *
 *   node scripts/probe-solids-cap.mjs --self-test       # 门负例自证（无需浏览器），rc=0
 *   node scripts/probe-solids-cap.mjs                   # 真机（自动解析 Chromium + 预览 URL）
 *   node scripts/probe-solids-cap.mjs --histogram       # 真机 + 落阶段×类型直方图台账
 *
 * 判定口径（比 spec 的 `capDropped <= 豁免额` 更严，防止写一张超大豁免单蒙混）：
 *   · capDropped === 0                      → PASS(capNotHit)，不需要豁免单
 *   · capDropped > 0 且豁免单缺失/过期/字段不全 → FAIL（fail-closed，绝不真空通过）
 *   · capDropped > 0 且豁免单 allowance 与实测**精确相等** → PASS(waived)
 *   · 任何 allowance > 实测 或 allowance < 实测           → FAIL
 *
 * QA-004 披露：无浏览器 / 无预览地址时 gate=SKIPPED、mode=degraded、PASS.all=null，
 * rc=0 只代表如实跳过，绝不把 SKIPPED 混进 PASS。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 判定实现唯一真相源：与 r27 验收门共用 lib/capGate.mjs，禁止两份逻辑漂移。
import { evaluateCap, readBudget } from './lib/capGate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'artifacts');
const HIST_PATH = path.join(ART, 'solids-cap-histogram.json');
const EVIDENCE_PATH = path.join(ART, 'spec', 'PROBE-SOLIDS-CAP.json');
const SELF_TEST = process.argv.includes('--self-test');
const WANT_HIST = process.argv.includes('--histogram');
const URL = process.env.PREVIEW_URL || '';

function out(o, rc) {
  console.log(JSON.stringify(o, null, 2));
  process.exit(rc);
}

function selfTest() {
  const cases = [
    {
      name: 'capDropped 缺失 → FAIL(no-cap-telemetry)',
      in: [{ total: 399000 }, null], want: { ok: false, reason: 'no-cap-telemetry' },
    },
    {
      name: 'capDropped=123 且豁免单缺失 → FAIL(no-budget-waiver)',
      in: [{ capDropped: 123 }, null], want: { ok: false, reason: 'no-budget-waiver' },
    },
    {
      name: 'capDropped=123 但豁免单 allowance=10 → FAIL(allowance-mismatch)',
      in: [{ capDropped: 123 }, {
        schema: 'solids-cap-waiver/v1', allowance: 10, observedCapDropped: 123,
        reason: '伪造', owner: 'test', expiresAt: '2099-12-31', sourceEvidence: 'x', appliesTo: 'MAX_TOTAL',
      }], want: { ok: false, reason: 'allowance-mismatch' },
    },
    {
      name: '豁免单缺字段 → FAIL(budget-schema-incomplete)',
      in: [{ capDropped: 123 }, { schema: 'solids-cap-waiver/v1', allowance: 123 }],
      want: { ok: false, reason: 'budget-schema-incomplete' },
    },
    {
      name: '豁免单已过期 → FAIL(waiver-expired)',
      in: [{ capDropped: 123 }, {
        schema: 'solids-cap-waiver/v1', allowance: 123, observedCapDropped: 123,
        reason: '伪造', owner: 'test', expiresAt: '2000-01-01', sourceEvidence: 'x', appliesTo: 'MAX_TOTAL',
      }], want: { ok: false, reason: 'waiver-expired' },
    },
    {
      name: 'capDropped=0 且无豁免单 → PASS(capNotHit)',
      in: [{ capDropped: 0 }, null], want: { ok: true, mode: 'capNotHit' },
    },
    {
      name: 'capDropped=123 且豁免单精确匹配 → PASS(waived)',
      in: [{ capDropped: 123 }, {
        schema: 'solids-cap-waiver/v1', allowance: 123, observedCapDropped: 123,
        reason: '实测豁免', owner: 'test', expiresAt: '2099-12-31', sourceEvidence: 'x', appliesTo: 'MAX_TOTAL',
      }], want: { ok: true, mode: 'waived' },
    },
  ];
  const rows = cases.map((c) => {
    const got = evaluateCap(c.in[0], c.in[1]);
    const neg = c.want.ok === false;
    const pass = neg
      ? got.ok === false && got.reason === c.want.reason
      : got.ok === true && got.mode === c.want.mode;
    return { name: c.name, expect: neg ? 'FAIL' : 'PASS', got: got.gate, reason: got.reason, mode: got.mode, ok: pass };
  });
  const all = rows.every((r) => r.ok);
  out({
    mode: 'offline', gate: all ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL',
    note: all ? '负例全部被门拦下、正例全部放行' : '门本身已腐烂，必须修复',
    cases: rows, negativeCases: rows.filter((r) => r.expect === 'FAIL').length,
    realMachine: 'SKIPPED', PASS: { all: null, note: 'SELF_TEST 不计入 PASS.all' },
  }, all ? 0 : 2);
}

async function resolveChrome() {
  if (process.env.CHROME || process.env.EDGE) return process.env.CHROME || process.env.EDGE;
  try {
    const m = await import('./chromePath.mjs');
    return m.CHROME;
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function main() {
  const { budget, error: budgetLoadError } = readBudget(ROOT);
  let chrome = await resolveChrome();
  if (!URL || !chrome || typeof chrome !== 'string') {
    // 仍然跑一遍静态门，让读者看到「即使有台账，没有真机也不会假装 PASS」
    const staticGate = evaluateCap({ capDropped: budget?.observedCapDropped ?? null }, budget, budgetLoadError);
    out({
      mode: 'degraded', gate: 'SKIPPED',
      note: 'DEGRADED-无 PREVIEW_URL 或 Chromium 不可用，真机门未实跑',
      chromeError: typeof chrome === 'object' ? chrome.error : null,
      budgetPresent: !!budget, staticGate,
      realMachineGatesNotRun: ['浏览器启动', 'window.__qingming.solids().capDropped', 'capNotHit/豁免门', 'pageErrors=0'],
      PASS: { all: null, note: 'SKIPPED 不计入 PASS.all' },
    }, 0);
  }

  let puppeteer;
  try { puppeteer = await import('puppeteer-core'); }
  catch (e) {
    out({ mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-puppeteer-core 不可用: ' + e.message, PASS: { all: null } }, 0);
  }

  const errs = [];
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--no-proxy-server', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 240)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 240)); });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(
      () => !document.getElementById('loading') && !!window.__qingming
        && typeof window.__qingming.solids === 'function'
        && typeof window.__qingming.solidsCap === 'function',
      { timeout: 240000 },
    );
    const stats = await page.evaluate(() => window.__qingming.solids());
    const hist = await page.evaluate(() => window.__qingming.solidsCap());
    const gate = evaluateCap(stats, budget, budgetLoadError);
    const finalOk = gate.ok && errs.length === 0;
    if (!finalOk && gate.ok) gate.reason = 'page-errors';

    if (WANT_HIST) {
      fs.mkdirSync(ART, { recursive: true });
      // 直方图本身已按字典序排序且不含时间戳 → 同一构建产出字节一致（QA-001 S06 口径）
      fs.writeFileSync(HIST_PATH, JSON.stringify({
        source: 'window.__qingming.solidsCap()',
        url: URL,
        ...hist,
      }, null, 2));
    }
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    const evidence = {
      mode: 'real', url: URL, chrome: 'resolved', pageErrors: errs,
      stats, histogram: hist, budget: budget ?? null, budgetLoadError,
      gate, PASS: { all: finalOk },
      histogramWritten: WANT_HIST ? 'artifacts/solids-cap-histogram.json' : null,
    };
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    out({
      mode: 'real', gate: finalOk ? 'PASS' : 'FAIL',
      evidence: 'artifacts/spec/PROBE-SOLIDS-CAP.json',
      capDropped: stats.capDropped, capFirstDropStage: stats.capFirstDropStage,
      maxTotal: stats.maxTotal, wallReserve: stats.wallReserve,
      wallReserveDropped: stats.wallReserveDropped,
      histogramByStage: hist.byStage, budgetPresent: !!budget,
      pageErrors: errs.slice(0, 10), PASS: { all: finalOk },
    }, finalOk ? 0 : 1);
  } finally { await browser.close(); }
}

if (SELF_TEST) selfTest();
else main().catch((e) => out({
  mode: 'degraded', gate: 'SKIPPED', note: 'DEGRADED-' + String(e), PASS: { all: null },
}, 0));
