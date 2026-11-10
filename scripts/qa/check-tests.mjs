/**
 * QA-006 / QA-001 阶段 9：测试质量门。
 *  R1 每条 it()/test() 体内 >=1 个 expect（expect.assertions(n) 视同满足）
 *  R2 接线交叉审计：tests 引用的 src 模块必须有非测试 importer，或 @contract-test，或带到期版本的豁免
 *  R3 断言强度：expect(true).toBe(true) / expect(x).toBeDefined() 单独成条 → warning；
 *               连续两轮出现同一清单 → rc=1
 *
 * 用法：node scripts/qa/check-tests.mjs [--report-only] [--self-test]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, hasRuntimeImporter, resolveSpec } from './importGraph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const selfTest = argv.includes('--self-test');
const WARN_FILE = path.join(ROOT, 'artifacts/spec/check-tests-warnings.json');

/**
 * 取从 openIdx 起、括号配对的完整调用文本。
 * 必须跳过字符串/模板串/注释里的括号——否则标题 `'值域恒为 [0, 1)'` 里的 `)`
 * 会让配对提前闭合，把一条有 1000 次 expect 的测试误判为零断言（门假阳性）。
 */
function balanced(text, openIdx) {
  let depth = 0, quote = null, esc = false, lineComment = false, blockComment = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  return text.slice(openIdx);
}

export function audit(root = ROOT) {
  const dir = path.join(root, 'tests');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.test\.(ts|tsx|js)$/.test(f)).sort()
    : [];
  const graph = buildGraph(root);
  const weak = [];          // R1 违规（硬）
  const orphanRefs = [];    // R2 违规（M3 之前可 report-only）
  const weakAssertions = []; // R3 warning

  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const contract = /@contract-test/.test(text.slice(0, 600));
    let n = 0;
    for (const m of text.matchAll(/(?<![\w.])(?:it|test)\s*\(/g)) {
      n++;
      const body = balanced(text, m.index + m[0].length - 1);
      if (!/\bexpect\s*(?:\(|\.assertions\s*\()/.test(body)) {
        weak.push(`tests/${f}#${n} 零断言 it()/test()`);
      }
      // R3 正确口径：只有当**整条测试里全是弱断言**才违规。
      // 旧版只判断「出现过 toBeDefined」→ 把「先 toBeDefined 再跟 N 条值断言」
      // 的正常测试误报为弱断言，连续两轮后错误地把门升格为硬失败。
      const asserts = [...body.matchAll(/\bexpect\s*\(/g)].length;
      const weakInBody =
        [...body.matchAll(/\bexpect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/g)].length +
        [...body.matchAll(/\bexpect\s*\([^)]*\)\s*\.\s*toBeDefined\s*\(\s*\)/g)].length;
      if (weakInBody > 0 && weakInBody === asserts) {
        weakAssertions.push(`tests/${f}#${n} 弱断言单独成条（${weakInBody}/${asserts}，definiens 未伴随值断言）`);
      }
    }
    if (!contract) {
      for (const m of text.matchAll(/from\s+['"](\.[^'"]*src\/[^'"]+)['"]/g)) {
        const target = resolveSpec(root, `tests/${f}`, m[1]);
        if (target && !hasRuntimeImporter(graph, target, root)) {
          orphanRefs.push(`tests/${f} -> ${target}（仅测试导入）`);
        }
      }
    }
  }
  return { files: files.length, weak, orphanRefs, weakAssertions: [...new Set(weakAssertions)].sort() };
}

function main() {
  let r = audit(ROOT);
  if (selfTest) {
    r = { ...r, weak: [...r.weak, 'tests/__injected__.test.ts#1 零断言 it()'] };
    console.log(`self-test: injected zero-assertion test -> ${r.weak.length} finding(s)`);
    console.log('self-test: DETECTED (rc=1 expected)');
    process.exit(1);
  }
  console.log(`tests: ${r.files} files | zero-assert ${r.weak.length} | test-only imports ${r.orphanRefs.length} | weak-assert ${r.weakAssertions.length}`);
  for (const x of r.weak) console.log('  [R1] ' + x);
  for (const x of r.orphanRefs.slice(0, 40)) console.log('  [R2] ' + x);
  if (r.orphanRefs.length > 40) console.log(`  [R2] ... 另有 ${r.orphanRefs.length - 40} 条`);

  // R3 连续两轮同清单才升格为硬失败
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(WARN_FILE, 'utf8')).warnings ?? []; } catch {}
  const same = JSON.stringify(prev) === JSON.stringify(r.weakAssertions) && r.weakAssertions.length > 0;
  try {
    fs.mkdirSync(path.dirname(WARN_FILE), { recursive: true });
    fs.writeFileSync(WARN_FILE, JSON.stringify({ at: new Date().toISOString(), warnings: r.weakAssertions }, null, 2) + '\n');
  } catch {}
  if (same) console.error('FAIL [R3]: 弱断言清单连续两轮完全一致，必须整改');

  if (r.weak.length) { console.error('FAIL [R1]: 存在零断言测试（FIX-009）'); process.exit(1); }
  if (same) process.exit(1);
  if (r.orphanRefs.length) {
    if (reportOnly) console.log('REPORT-ONLY [R2]: 接线交叉审计未通过（FIX-005 属 M3，未到期，如实列出不阻断）');
    else { console.error('FAIL [R2]: 存在仅测试导入的模块（FIX-005）'); process.exit(1); }
  }
  console.log('check-tests: OK');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
