/**
 * FIX-004 R4 唯一判定实现：solids MAX_TOTAL 触顶豁免门。
 * 被 probe-solids-cap.mjs 与 lib/r27Gates.mjs 共同引用，避免两份判定漂移。
 *
 * 口径比 spec 的 `capDropped <= 豁免额` 更严：豁免额度必须与真机实测精确相等，
 * 且豁免单必须字段完整、版本正确、未过期、appliesTo 正确，否则 fail-closed。
 */
import fs from 'node:fs';
import path from 'node:path';

export const BUDGET_REQUIRED = [
  'schema', 'allowance', 'observedCapDropped', 'reason', 'owner',
  'expiresAt', 'sourceEvidence', 'appliesTo',
];

export const BUDGET_SCHEMA = 'solids-cap-waiver/v1';

export function readBudget(root) {
  const p = path.join(root, 'artifacts', 'solids-budget.json');
  try {
    return { budget: JSON.parse(fs.readFileSync(p, 'utf8')), error: null, path: p };
  } catch (e) {
    return { budget: null, error: String(e.message || e), path: p };
  }
}

export function evaluateCap(stats, budget, budgetLoadError = null) {
  if (!stats || !Number.isInteger(stats.capDropped) || stats.capDropped < 0) {
    return { ok: false, gate: 'FAIL', reason: 'no-cap-telemetry', capDropped: stats?.capDropped ?? null };
  }
  const capDropped = stats.capDropped;
  if (capDropped === 0) {
    return { ok: true, gate: 'PASS', mode: 'capNotHit', capDropped, allowance: 0 };
  }
  if (budgetLoadError) {
    return { ok: false, gate: 'FAIL', reason: 'budget-unreadable', capDropped, detail: budgetLoadError };
  }
  if (!budget || typeof budget !== 'object') {
    return { ok: false, gate: 'FAIL', reason: 'no-budget-waiver', capDropped };
  }
  const missing = BUDGET_REQUIRED.filter((k) => budget[k] === undefined || budget[k] === null || budget[k] === '');
  if (missing.length) {
    return { ok: false, gate: 'FAIL', reason: 'budget-schema-incomplete', capDropped, missing };
  }
  if (budget.schema !== BUDGET_SCHEMA) {
    return { ok: false, gate: 'FAIL', reason: 'budget-schema-version', capDropped, got: budget.schema };
  }
  if (!Number.isInteger(budget.allowance) || budget.allowance < 0) {
    return { ok: false, gate: 'FAIL', reason: 'bad-allowance', capDropped, allowance: budget.allowance };
  }
  if (budget.observedCapDropped !== capDropped || budget.allowance !== capDropped) {
    return {
      ok: false, gate: 'FAIL', reason: 'allowance-mismatch', capDropped,
      allowance: budget.allowance, observedCapDropped: budget.observedCapDropped,
      note: '豁免额度必须与该次真机实测精确相等，禁止预留大额度',
    };
  }
  const exp = Date.parse(budget.expiresAt);
  if (!Number.isFinite(exp)) {
    return { ok: false, gate: 'FAIL', reason: 'bad-expiresAt', capDropped, expiresAt: budget.expiresAt };
  }
  if (exp < Date.now()) {
    return { ok: false, gate: 'FAIL', reason: 'waiver-expired', capDropped, expiresAt: budget.expiresAt };
  }
  if (budget.appliesTo !== 'MAX_TOTAL') {
    return { ok: false, gate: 'FAIL', reason: 'bad-appliesTo', capDropped, appliesTo: budget.appliesTo };
  }
  return {
    ok: true, gate: 'PASS', mode: 'waived', capDropped, allowance: budget.allowance,
    reason: budget.reason, expiresAt: budget.expiresAt,
  };
}
