/**
 * probe-ledger-coverage.mjs —— 总账「每条未完成项都必须有机检证据」的机检门。
 *
 * 判据（对应 goal 完成条件）：
 *   `artifacts/SPEC-总账.md` 里每一行带 🔴 或 🟡 的表格行，
 *   必须引用一个**真实存在**的 `scripts/probe-*.mjs`，
 *   并且在同行里给出结论关键字（PASS / BLOCK / 实测 / 证据）。
 *
 * 诚实边界（写在输出里，不假装执法）：
 *   本脚本只能证明「这条挂了探针并且探针文件在」，**不能证明探针跑过、更不能证明结论为真**。
 *   内容级真实性仍需人/审核 agent 复核。
 *
 * 用法：node scripts/probe-ledger-coverage.mjs
 * 退出码：0 = 全部有证据；1 = 有未完成项缺证据；2 = 用法/读文件错误。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = resolve(ROOT, 'artifacts/SPEC-总账.md');
const PROBE_DIR = resolve(ROOT, 'scripts');
const VERDICT_RE = /(PASS|BLOCK|实测|证据|已验证|已跑)/;

/** 语法自检：文件存在 ≠ 探针能用。`node --check` 能抓到重复 import 这类编译期错误。 */
function syntaxOk(name) {
  const r = spawnSync(process.execPath, ['--check', resolve(PROBE_DIR, name + '.mjs')], { encoding: 'utf8' });
  return r.status === 0;
}

function main() {
  if (!existsSync(LEDGER)) {
    console.error('USAGE_ERROR: 找不到 ' + LEDGER);
    return 2;
  }
  const probes = new Set(
    readdirSync(PROBE_DIR)
      .filter((f) => /^probe-.*\.mjs$/.test(f))
      .map((f) => f.replace(/\.mjs$/, '')),
  );

  const lines = readFileSync(LEDGER, 'utf8').split(/\r?\n/);
  const open = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L.startsWith('|')) continue;
    if (!L.includes('🔴') && !L.includes('🟡')) continue;
    // 取第一个单元格作为编号
    const cells = L.split('|').map((s) => s.trim());
    const id = cells[1] ?? `L${i + 1}`;
    const refs = [...L.matchAll(/probe-[a-z0-9-]+/g)].map((m) => m[0]);
    const existing = refs.filter((r) => probes.has(r));
    const missing = refs.filter((r) => !probes.has(r));
    const broken = existing.filter((r) => !syntaxOk(r));
    const hasVerdict = VERDICT_RE.test(L);
    open.push({ line: i + 1, id, refs, existing, missing, broken, hasVerdict, text: L.slice(0, 90) });
  }

  console.log(`LEDGER=${LEDGER}`);
  console.log(`OPEN_ITEMS=${open.length}（🔴/🟡 行数）`);
  console.log(`KNOWN_PROBES=${probes.size}`);

  let bad = 0;
  for (const o of open) {
    const okProbe = o.existing.length > 0;
    const okVerdict = o.hasVerdict;
    const pass = okProbe && okVerdict && o.missing.length === 0 && o.broken.length === 0;
    if (!pass) bad++;
    const why = [
      okProbe ? '' : '缺探针',
      okVerdict ? '' : '缺结论关键字',
      o.missing.length ? `引用不存在:${o.missing.join(',')}` : '',
      o.broken.length ? `语法错:${o.broken.join(',')}` : '',
    ].filter(Boolean).join(' / ');
    console.log(`${pass ? 'OK  ' : 'FAIL'} L${o.line} [${o.id}] probe=${o.existing.join(',') || '(none)'}${why ? '  ← ' + why : ''}`);
  }

  console.log(
    bad === 0
      ? 'RESULT=PASS（所有未完成项都挂了存在的探针；探针是否真跑过仍须人工/审核复核）'
      : `RESULT=BLOCK（${bad} 条未完成项缺机检证据）`,
  );
  return bad === 0 ? 0 : 1;
}

process.exit(main());
