/**
 * QA-003 R3：新验收脚本模板（fail-closed 骨架 + mode 披露 + --self-test 桩）。
 * 复制本文件到 scripts/ 下改名后使用；禁止删除 --self-test 分支。
 * __QA_TEMPLATE__  ← check-gates 静态检据此跳过本骨架文件（其 decide() 里的
 *                     null 判定是「判 SKIPPED」而非 fail-open，正则会误报）。
 *
 * 三条铁律：
 *  1. 任何「数据缺失 / 探针没跑到 / 超时」都判 SKIPPED 或 FAIL，**绝不判 PASS**（INV-02 fail-closed）。
 *  2. 输出必须带 mode ∈ {real, mocked, offline, degraded}（QA-004 机检）。
 *  3. --self-test 注入 >=2 个伪造负例，逐个断言门确实判 FAIL/SKIPPED；
 *     全部拦住 → 打印 SELF_TEST=PASS 且 rc=0（门正常），放过任一负例 → rc=1（门腐烂）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SELF_TEST = process.argv.includes('--self-test');
export const GATE_MAX_ERRORS = 0;      // 宣称门槛，登记在 docs/QA-GATE-THRESHOLDS.md
export const GATE_MIN_PASS = 1;

/** 统一的门判定：缺数据绝不放行 */
export function decide(name, observed, predicate, mode = 'real') {
  if (observed === null || observed === undefined || observed === 'SKIPPED') {
    return { name, mode, gate: 'SKIPPED', note: 'DEGRADED-未取到观测值，skip 与 pass 分账，不计入 PASS.all' };
  }
  const ok = predicate(observed);
  return { name, mode, gate: ok ? 'PASS' : 'FAIL', note: ok ? '' : `观测值不满足判据：${JSON.stringify(observed)}` };
}

function run() {
  const results = [];
  if (SELF_TEST) {
    // 负例 1：观测值缺失 → 必须判 SKIPPED，绝不放行
    results.push(decide('inject-missing', null, () => true));
    // 负例 2：观测值明确不满足判据 → 必须判 FAIL
    results.push(decide('inject-bad', { pageErrors: 7 }, (o) => o.pageErrors <= GATE_MAX_ERRORS));
    const leaked = results.filter((r) => r.gate === 'PASS');
    const out = { mode: 'mocked', results, negativeCases: results.length, leaked: leaked.length,
      verdict: leaked.length ? 'FAIL_OPEN' : 'SELF_TEST=PASS' };
    console.log(JSON.stringify(out, null, 2));
    console.log(leaked.length ? 'SELF_TEST=FAIL：负例被放行，门已腐烂' : 'SELF_TEST=PASS：2/2 负例被拦');
    process.exit(leaked.length ? 1 : 0);
  }
  const p = path.join(ROOT, 'artifacts/spec/template-observation.json');
  const observed = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  results.push(decide('template-gate', observed, (o) => (o?.pageErrors ?? 1) <= GATE_MAX_ERRORS));
  const skips = results.filter((r) => r.gate === 'SKIPPED');
  const fails = results.filter((r) => r.gate === 'FAIL');
  const out = {
    mode: 'real', results,
    PASS: { all: fails.length === 0 && skips.length === 0 && results.length >= GATE_MIN_PASS, passes: results.length - skips.length - fails.length, skips: skips.length, fails: fails.length },
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.PASS.all ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
