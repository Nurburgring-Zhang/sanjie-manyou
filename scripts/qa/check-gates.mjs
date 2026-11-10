/**
 * QA-003 / QA-001 阶段 10：验收脚本 fail-closed 静态门。
 *  R1 扫 scripts/** 中 fail-open / 吞异常 / 门槛常量与宣称口径不一致
 *  R2 每个验收脚本须响应 --self-test：实跑，注入 >=2 伪造负例，放过即 rc=1
 *  R3 模板：scripts/qa/template-acceptance.mjs（本脚本会检查它存在）
 *
 * 用法：node scripts/qa/check-gates.mjs [--report-only] [--self-test]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const selfTest = argv.includes('--self-test');

const FAIL_OPEN = [
  // 只认「真的判为通过」的写法。裸 \bPASS\b 会把 `PASS: { all: false }` 这种
  // 明确失败结果误报成 fail-open（R29 M2 实测误报 r27_acceptance.mjs）。
  { re: /(?:===\s*null|==\s*null|===\s*undefined)[\s\S]{0,140}?(?:ok\s*:\s*true|pass\s*[:=]\s*true|gate\s*[:=]\s*(?:'PASS'|"PASS")|PASS\.all\s*=\s*true)/g, tag: 'null->ok:true (fail-open)' },
  { re: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\n\s*)*\}/g, tag: '空 catch 吞异常' },
  { re: /if\s*\([^)]*(?:undefined|null)[^)]*\)[\s\S]{0,80}?(?:gate|ok|pass)\s*[:=]\s*(?:'PASS'|"PASS"|true)/g, tag: '门槛缺失判为 PASS' },
];

function collectScripts(root) {
  const dir = path.join(root, 'scripts');
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/^(?:.*acceptance.*|.*probe.*|r\d+.*)\.mjs$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** 门槛宣称映射：docs/QA-GATE-THRESHOLDS.md 中 `- NAME = 123` */
function declaredThresholds(root) {
  const p = path.join(root, 'docs/QA-GATE-THRESHOLDS.md');
  const out = new Map();
  if (!fs.existsSync(p)) return out;
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/^-\s+`?([A-Z_][A-Z0-9_]*)`?\s*=\s*(\d+(?:\.\d+)?)/gm)) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

export function audit(root = ROOT) {
  const scripts = collectScripts(root);
  const thresholds = declaredThresholds(root);
  const staticFindings = [];
  const noSelfTest = [];
  const selfTestFail = [];

  for (const p of scripts) {
    const rel = path.relative(root, p).split(path.sep).join('/');
    const t = fs.readFileSync(p, 'utf8');
    // 模板骨架自带 fail-closed 的 null→SKIPPED 判定，正则会误报，按显式标记跳过静态检
    const isTemplate = /__QA_TEMPLATE__/.test(t);
    if (!isTemplate) for (const f of FAIL_OPEN) {
      const hits = [...t.matchAll(f.re)];
      if (hits.length) staticFindings.push({ file: rel, tag: f.tag, count: hits.length });
    }
    for (const [name, val] of thresholds) {
      const m = t.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)`));
      if (m && Number(m[1]) !== val) {
        staticFindings.push({ file: rel, tag: `门槛常量 ${name}=${m[1]} ≠ 宣称 ${val}`, count: 1 });
      }
    }
    if (!/--self-test/.test(t)) { noSelfTest.push(rel); continue; }
    const r = spawnSync(process.execPath, [p, '--self-test'], { cwd: root, encoding: 'utf8', timeout: 20000 });
    // 契约统一（QA-003 R2 + FIX-006 R4 / QA-005）：脚本内部注入 >=2 负例并自证「门判 FAIL」，
    // 打印 SELF_TEST=PASS。退出码允许两种合法口径：
    //   rc=0（QA-003 R2：自检通过即 0）
    //   rc=2（FIX-006 / QA-005：负例全部判 FAIL，故沿用验收失败码 2）
    // rc=1 / TIMEOUT / 无 PASS 字样 = self-test 失败或门腐烂，仍一律计入 selfTestFail。
    const passed = (r.status === 0 || r.status === 2) && /SELF_TEST\s*=\s*PASS/.test(r.stdout || '');
    if (!passed) selfTestFail.push({ file: rel, rc: r.status, out: ((r.stdout || '') + (r.stderr || '') + (r.error?.message || '')).replace(/\s+/g, ' ').slice(-260) });
  }
  return { scripts: scripts.length, staticFindings, noSelfTest, selfTestFail, thresholds: [...thresholds] };
}

function main() {
  if (selfTest) {
    console.log('self-test: 注入 (a) `if (x == null) ok:true` (b) 空 catch → 静态检必须各命中 1');
    const fake = "if (x == null) { ok: true }\ntry { gate() } catch { }\nconst MAX_ITEMS = 999\n";
    let hit = 0;
    for (const f of FAIL_OPEN) if ([...fake.matchAll(f.re)].length) hit++;
    console.log(`self-test: ${hit}/3 fail-open 模式命中`);
    console.log(hit >= 2 ? 'SELF_TEST=PASS：负例被静态检拦住' : 'SELF_TEST=FAIL：负例漏检');
    process.exit(hit >= 2 ? 0 : 1); // 检测到 = 门有效，rc=0（与 QA-003 R2 契约一致）
  }
  const r = audit(ROOT);
  console.log(`check-gates: ${r.scripts} acceptance/probe scripts | static ${r.staticFindings.length} | selfTestFail ${r.selfTestFail.length} | noSelfTest ${r.noSelfTest.length}`);
  for (const x of r.staticFindings.slice(0, 30)) console.log(`  [static] ${x.file} ${x.tag} ×${x.count}`);
  for (const x of r.selfTestFail.slice(0, 20)) console.log(`  [selfTest] ${x.file} rc=${x.rc} ${x.out.replace(/\n/g, ' ')}`);
  if (r.noSelfTest.length) console.log(`  [coverage] ${r.noSelfTest.length} 个脚本尚未实现 --self-test（QA-003 R2，M3 到期）`);
  if (!fs.existsSync(path.join(ROOT, 'scripts/qa/template-acceptance.mjs'))) {
    console.error('FAIL [R3]: 缺少 scripts/qa/template-acceptance.mjs');
    process.exit(1);
  }
  if (r.staticFindings.length || r.selfTestFail.length) {
    if (reportOnly) console.log('REPORT-ONLY: 静态/自检发现已如实列出，未阻断（M1 阶段）');
    else { console.error('FAIL: 验收脚本存在 fail-open 或 self-test 无效'); process.exit(1); }
  }
  if (r.noSelfTest.length && !reportOnly) {
    console.error('FAIL [R2]: 存在无 --self-test 的验收脚本');
    process.exit(1);
  }
  console.log('check-gates: OK');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
