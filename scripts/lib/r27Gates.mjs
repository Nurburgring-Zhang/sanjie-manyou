/**
 * FIX-006（三门 fail-closed）+ FIX-004 R4（capNotHit）的唯一判定实现。
 *
 * 为什么 tris 基线必须自己算：
 *   `window.__qingming.world.assetAudit` 是 BakerStats，只有 groups[*].triangles，
 *   **没有 totalTris 字段**。旧门 `assetAudit?.totalTris === null → true` 因此恒真
 *   （fail-open 真空通过，INV-02 违例）。`__perf().tris` 是逐帧绘制量，随相机/剔除
 *   变化（实测 77652695 → 77329817），也不能当静态基线。
 *   本模块用 sum(groups[*].triangles) 作为「世界烘焙后静态总三角数」，
 *   与随包 shipped 的 artifacts/r27-tris-baseline.json diff。
 *
 * 判定全部为纯函数：--self-test 可注入伪造台账，证明门真的会 FAIL。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCap, readBudget } from './capGate.mjs';

export const TRIS_BASELINE_REL = 'artifacts/r27-tris-baseline.json';
export const TRIS_BASELINE_SCHEMA = 'r27-tris-baseline/v1';

// 门槛常量的唯一代码定义；同名同值必须登记在 docs/QA-GATE-THRESHOLDS.md，
// scripts/qa/check-gates.mjs 会逐脚本比对，改代码不改文档即 rc=1（QA-003 R1）。
export const DEBRIS_MIN_STEPS = 600;           // destruction.ts TRACE_CAP = 600（1/120 固定步，5s）
export const DEBRIS_MIN_DISTINCT_SAMPLES = 75; // 轨迹内不同 y 值数下限
export const DEBRIS_TAIL_N = 10;               // 收敛判据取末 10 样本
export const DEBRIS_TAIL_MAX_DELTA = 0.01;     // 末 10 样本相邻 |Δy| 必须 < 0.01
export const SETTLE_FAILED_MUST_BE = 0;
export const GATE_MAX_ERRORS = 0;
export const GATE_MIN_PASS = 1;

export const GATE_THRESHOLDS = {
  debrisMinSteps: DEBRIS_MIN_STEPS,
  debrisMinDistinctSamples: DEBRIS_MIN_DISTINCT_SAMPLES,
  debrisTailN: DEBRIS_TAIL_N,
  debrisTailMaxDelta: DEBRIS_TAIL_MAX_DELTA,
  settleFailedMustBe: SETTLE_FAILED_MUST_BE,
};

export function sumBakedTriangles(assetAudit) {
  if (!assetAudit || typeof assetAudit.groups !== 'object' || assetAudit.groups === null) return null;
  let total = 0;
  let groups = 0;
  for (const v of Object.values(assetAudit.groups)) {
    if (!Number.isFinite(v?.triangles)) return null;
    total += v.triangles;
    groups++;
  }
  return groups > 0 && total > 0 ? total : null;
}

export function readTrisBaseline(root) {
  const p = path.join(root, TRIS_BASELINE_REL);
  try {
    return { baseline: JSON.parse(fs.readFileSync(p, 'utf8')), error: null, path: p };
  } catch (e) {
    return { baseline: null, error: String(e.message || e), path: p };
  }
}

/** R1：totalTris / 基线任一缺失 → { ok:false, reason:'no-tris-baseline' }，绝不真空通过。 */
export function gateTrisUnchanged({ trisBefore, trisAfter, baseline, baselineError }) {
  if (!Number.isFinite(trisBefore) || trisBefore <= 0
    || !Number.isFinite(trisAfter) || trisAfter <= 0) {
    return { ok: false, gate: 'FAIL', reason: 'no-tris-baseline', trisBefore, trisAfter };
  }
  if (baselineError || !baseline || !Number.isFinite(baseline.totalTris)) {
    return { ok: false, gate: 'FAIL', reason: 'no-tris-baseline', baselineError: baselineError ?? 'missing' };
  }
  if (baseline.schema !== TRIS_BASELINE_SCHEMA) {
    return { ok: false, gate: 'FAIL', reason: 'no-tris-baseline', detail: 'baseline schema 不匹配' };
  }
  if (trisBefore !== baseline.totalTris) {
    return { ok: false, gate: 'FAIL', reason: 'tris-baseline-drift', trisBefore, baseline: baseline.totalTris };
  }
  if (trisAfter !== trisBefore) {
    return { ok: false, gate: 'FAIL', reason: 'tris-changed', trisBefore, trisAfter };
  }
  return { ok: true, gate: 'PASS', reason: 'tris-freeze', trisBefore, trisAfter, baseline: baseline.totalTris };
}

/**
 * R2：门槛与 README 宣称口径一致——固定步 600 步 / 75 个不同 y 样本 / 末 10 样本收敛。
 * 跑不满不是「降低门槛」，而是 DEGRADED-性能 + skip（不计入 PASS）。
 */
export function gateDebrisFell(trace) {
  if (!Array.isArray(trace) || trace.length === 0) {
    return { ok: false, gate: 'FAIL', reason: 'no-physics-trace', steps: 0, note: 'DEGRADED-性能（skip，不算 pass）' };
  }
  const steps = trace.length;
  if (steps < GATE_THRESHOLDS.debrisMinSteps) {
    return {
      ok: false, gate: 'FAIL', reason: 'degraded-performance', steps,
      required: GATE_THRESHOLDS.debrisMinSteps, note: 'DEGRADED-性能（skip，不算 pass）',
    };
  }
  const samples = new Set(trace).size;
  if (samples < GATE_THRESHOLDS.debrisMinDistinctSamples) {
    return { ok: false, gate: 'FAIL', reason: 'debris-samples-insufficient', steps, samples,
      required: GATE_THRESHOLDS.debrisMinDistinctSamples };
  }
  const tail = trace.slice(-GATE_THRESHOLDS.debrisTailN);
  let maxDelta = 0;
  for (let i = 1; i < tail.length; i++) maxDelta = Math.max(maxDelta, Math.abs(tail[i] - tail[i - 1]));
  if (!(maxDelta < GATE_THRESHOLDS.debrisTailMaxDelta)) {
    return { ok: false, gate: 'FAIL', reason: 'debris-not-converged', maxDelta, tail };
  }
  return { ok: true, gate: 'PASS', reason: 'debris-fell', steps, samples, maxDelta, tail };
}

/** R3：settleFailed === 0 纳入 PASS.all（此前只是遥测字段）。 */
export function gateSettleOk(settle) {
  if (!settle || settle.done !== true) {
    return { ok: false, gate: 'FAIL', reason: 'settle-not-done', settle };
  }
  if (!Number.isInteger(settle.failed) || settle.failed !== GATE_THRESHOLDS.settleFailedMustBe) {
    return { ok: false, gate: 'FAIL', reason: 'settle-failed', settle };
  }
  return { ok: true, gate: 'PASS', reason: 'settle-clean', checked: settle.checked, fixed: settle.fixed };
}

/** R4：capNotHit 门，豁免单缺失/过期/额度不匹配一律 fail-closed。 */
export function gateCapNotHit(solids, root) {
  const { budget, error } = readBudget(root);
  return evaluateCap(solids, budget, error);
}

/** 汇总四门；all 用 Object.values 全真才算真，不做任何短路放行。 */
export function evaluateHardened(input, root) {
  const { baseline, baselineError } = readTrisBaseline(root);
  const gates = {
    capNotHit: gateCapNotHit(input.solids, root),
    trisUnchanged: gateTrisUnchanged({
      trisBefore: input.trisBefore, trisAfter: input.trisAfter, baseline, baselineError,
    }),
    debrisFell: gateDebrisFell(input.physicsTrace),
    settleOk: gateSettleOk(input.settle),
  };
  return {
    gates,
    bools: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v.ok === true])),
    all: Object.values(gates).every((g) => g.ok === true),
    thresholds: GATE_THRESHOLDS,
    baseline: baseline ?? null,
    baselineError,
  };
}

/** FIX-006 R4：三个 spec 指定负例 + cap 门负例 + 正例，全部可被 r27_acceptance.mjs 注入。 */
export function runSelfTest() {
  const goodBaseline = { schema: TRIS_BASELINE_SCHEMA, totalTris: 77652695 };
  const goodTrace = Array.from({ length: 600 }, (_, i) => +(1.5 - i * 0.001).toFixed(3));
  // 末尾 10 个必须收敛：把尾部钉成同一个值
  for (let i = 590; i < 600; i++) goodTrace[i] = 0.9;

  const cases = [
    {
      name: '负例1 totalTris=null（旧门 fail-open 真空通过）→ FAIL(no-tris-baseline)',
      run: () => gateTrisUnchanged({ trisBefore: null, trisAfter: null, baseline: goodBaseline, baselineError: null }),
      wantReason: 'no-tris-baseline',
    },
    {
      name: '负例1b 基线文件缺失 → FAIL(no-tris-baseline)',
      run: () => gateTrisUnchanged({ trisBefore: 77652695, trisAfter: 77652695, baseline: null, baselineError: 'ENOENT' }),
      wantReason: 'no-tris-baseline',
    },
    {
      name: '负例2 physicsTrace.steps=10（旧门 ≥3 样本即过）→ FAIL(degraded-performance)',
      run: () => gateDebrisFell(Array.from({ length: 10 }, (_, i) => 1 - i * 0.1)),
      wantReason: 'degraded-performance',
    },
    {
      name: '负例3 settleFailed=3（旧门只是遥测不进 PASS）→ FAIL(settle-failed)',
      run: () => gateSettleOk({ done: true, checked: 100, fixed: 3, failed: 3 }),
      wantReason: 'settle-failed',
    },
    {
      name: '负例4 capDropped 有值但豁免单缺失 → FAIL(no-budget-waiver)',
      run: () => evaluateCap({ capDropped: 1323227 }, null, null),
      wantReason: 'no-budget-waiver',
    },
    {
      name: '正例1 基线一致且破坏前后 tris 恒定 → PASS(tris-freeze)',
      run: () => gateTrisUnchanged({ trisBefore: 77652695, trisAfter: 77652695, baseline: goodBaseline, baselineError: null }),
      wantOk: true,
    },
    {
      name: '正例2 600 步 / 75 样本 / 末段收敛 → PASS(debris-fell)',
      run: () => gateDebrisFell(goodTrace),
      wantOk: true,
    },
    {
      name: '正例3 settle.failed=0 → PASS(settle-clean)',
      run: () => gateSettleOk({ done: true, checked: 4510, fixed: 163, failed: 0 }),
      wantOk: true,
    },
  ];
  const rows = cases.map((c) => {
    const got = c.run();
    const ok = c.wantOk
      ? got.ok === true
      : got.ok === false && got.reason === c.wantReason;
    return { name: c.name, expect: c.wantOk ? 'PASS' : 'FAIL', got: got.gate, reason: got.reason ?? null, ok };
  });
  return {
    cases: rows,
    negativeCases: rows.filter((r) => r.expect === 'FAIL').length,
    all: rows.every((r) => r.ok),
  };
}

// QA-003 R2：本库也在 check-gates.mjs 的扫描范围（r\d+.*\.mjs），须能独立响应 --self-test。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  && process.argv.includes('--self-test')) {
  const r = runSelfTest();
  console.log(r.all ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL');
  console.log(`negativeCases=${r.negativeCases} total=${r.cases.length}`);
  process.exit(r.all ? 0 : 1);
}
