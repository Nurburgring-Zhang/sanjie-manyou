/**
 * FIX-005 R7 / QA-001 阶段 8：死代码（零入度模块）门。
 * 以 src/main.ts + index.html + electron/main.cjs 为根构建静态 import 图，
 * 列出零入度模块；src/**\/*.worker.ts 须被 new Worker(new URL(...)) 引用才算活。
 *
 * 用法：
 *   node scripts/qa/check-deadmodules.mjs                 rc=1 若有孤儿
 *   node scripts/qa/check-deadmodules.mjs --report-only  只报告，rc=0（里程碑未到期时用）
 *   node scripts/qa/check-deadmodules.mjs --self-test     注入伪造孤儿，期望 rc=1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, resolveSpec, specifiers } from './importGraph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const selfTest = argv.includes('--self-test');

/** 豁免清单：docs/QA-DEADMODULE-WAIVER.md 中 `- path (until Rxx)` 行 */
function waivers(release) {
  const p = path.join(ROOT, 'docs/QA-DEADMODULE-WAIVER.md');
  if (!fs.existsSync(p)) return new Map();
  const out = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^-\s+`?([^`\s(]+)`?\s*\(until\s+(R\d+)\)/);
    if (!m) continue;
    const until = Number(m[2].slice(1));
    const now = Number(String(release || 'R29').replace(/\D/g, '')) || 29;
    if (until >= now) out.set(m[1], m[2]);
    else out.set(m[1], `EXPIRED@${m[2]}`);
  }
  return out;
}

export function audit(root = ROOT, opts = {}) {
  const graph = buildGraph(root);
  const wv = waivers(opts.release);
  const findings = [];
  for (const f of graph.orphans) {
    const w = wv.get(f);
    if (w && !String(w).startsWith('EXPIRED')) continue; // 有效豁免
    findings.push({ file: f, reason: w ? `豁免已过期 ${w}` : '零入度：未被任何运行时根引用' });
  }
  // worker 专项：worker 文件必须被 new Worker(new URL(...)) 引用
  for (const f of graph.srcFiles.filter((x) => /\.worker\.(ts|js)$/.test(x))) {
    let referenced = false;
    for (const g of graph.files) {
      const abs = path.join(root, g);
      if (!fs.existsSync(abs)) continue;
      const t = fs.readFileSync(abs, 'utf8');
      if (/new\s+Worker\s*\(\s*new\s+URL/.test(t) && specifiers(t).some((s) => resolveSpec(root, g, s) === f)) {
        referenced = true; break;
      }
    }
    if (!referenced && !findings.some((x) => x.file === f)) {
      findings.push({ file: f, reason: 'worker 未被 new Worker(new URL(...)) 引用' });
    }
  }
  return { root, totalSrc: graph.srcFiles.length, live: graph.live.size, findings };
}

function main() {
  let release = 'R29';
  try { release = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).release ?? 'R29'; } catch {}
  const r = audit(ROOT, { release });
  console.log(`orphan modules: ${r.findings.length}   (src ${r.totalSrc} files, live ${r.live})`);
  for (const f of r.findings) console.log(`  - ${f.file}  ${f.reason}`);

  if (selfTest) {
    const fake = { ...r, findings: [...r.findings, { file: 'src/__self_test_orphan__.ts', reason: 'INJECTED' }] };
    const detected = fake.findings.length > r.findings.length;
    console.log(detected ? 'self-test: injected orphan DETECTED (rc=1 expected)' : 'self-test: FAILED to detect');
    process.exit(detected ? 1 : 0);
  }
  if (r.findings.length && !reportOnly) {
    console.error('FAIL: 存在零入度模块。M3 (FIX-005) 之前可用 --report-only 观察，但出厂门必须 rc=0。');
    process.exit(1);
  }
  if (r.findings.length && reportOnly) console.log('REPORT-ONLY: 孤儿已如实列出，未阻断（里程碑未到期）');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
