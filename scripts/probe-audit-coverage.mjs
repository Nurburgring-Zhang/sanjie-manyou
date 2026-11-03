/**
 * probe-audit-coverage.mjs —— 审计 spec 的缺陷编号是否都挂了机检探针（纯 Node，秒级）。
 *
 * 目的：`artifacts/SPEC-全面审计-20261103.md` 里有 A1–A5 / B1–B8 / C1 / N1–N3 等编号，
 * 但「编号存在」不等于「有探针」。本门逐个编号检查其上下文（±6 行）里是否出现
 * 一个**真实存在且可编译**的 `scripts/probe-*.mjs`。
 *
 * 判据：
 *   COVERED   该编号附近出现存在的 probe 文件，且 `node --check` 通过
 *   BROKEN    引用了 probe，但文件不存在或语法错
 *   NAKED     附近没有任何 probe 引用（= 只有描述、没有机检）
 *
 * 退出码：0 = 无 BROKEN 且 NAKED 比例 ≤ 阈值；1 = 有 BROKEN 或 NAKED 超阈值；2 = 用法错误
 *
 * 诚实边界：这是**文本邻近**检查，不证明探针真的覆盖了该缺陷的语义。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = resolve(ROOT, 'artifacts/SPEC-全面审计-20261103.md');
const PROBE_DIR = resolve(ROOT, 'scripts');
/**
 * 「合法无探针」白名单：必须逐条给理由。
 * 棘轮原则：只准加**有依据**的条目（现象不成立 / 用户裁定关闭），不准因为「不好测」往这里塞。
 */
const ALLOW_NO_PROBE = [
  { id: 'A4', why: '复核后现象不成立：虹桥 crown 9.1m、34 段随拱起伏，不是平板路' },
  { id: 'B4', why: '用户 2026-11-03 裁定：天宫不跟随昼夜，属设计决定' },
];

if (!existsSync(SPEC)) {
  console.error('USAGE_ERROR: 找不到 ' + SPEC);
  process.exit(2);
}

const probes = new Set(
  readdirSync(PROBE_DIR).filter((f) => /^probe-.*\.mjs$/.test(f)).map((f) => f.replace(/\.mjs$/, '')),
);
const syntaxCache = new Map();
const syntaxOk = (name) => {
  if (syntaxCache.has(name)) return syntaxCache.get(name);
  const r = spawnSync(process.execPath, ['--check', resolve(PROBE_DIR, name + '.mjs')], { encoding: 'utf8' });
  const ok = r.status === 0;
  syntaxCache.set(name, ok);
  return ok;
};

const allLines = readFileSync(SPEC, 'utf8').split(/\r?\n/);
// 只扫「缺陷 → 探针 对照表」之后的登记区。
// 正文里到处有 A1–A5 / B1/B2 这类散文提法，若整篇扫，一次提及即可能被判 COVERED，
//   —— 这正是上一轮承认的宽松点。收窄到登记表后，「该 ID 的登记行有没有探针」才是真判据。
const tableStart = allLines.findIndex((l) => l.includes('缺陷 → 探针 对照表'));
if (tableStart < 0) {
  console.error('USAGE_ERROR: 找不到「缺陷 → 探针 对照表」小节，无法判定覆盖');
  process.exit(2);
}
const lines = allLines.slice(tableStart);
const ID_RE = /\b(A[1-5]|B[1-8]|C1|N[1-3])\b/g;

const found = new Map(); // id -> [lineIdx...]
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(ID_RE);
  if (!m) continue;
  for (const id of new Set(m)) {
    if (!found.has(id)) found.set(id, []);
    found.get(id).push(i);
  }
}

const rows = [];
for (const [id, idxs] of [...found.entries()].sort()) {
  let covered = null;
  let broken = null;
  for (const i of idxs) {
    // 只认**同一行**的探针引用。±N 行窗口会把邻近编号的探针算过来，制造假 COVERED
    // （首版用 ±6 行，结果 A2–A5 全被算成 probe-roof-from-air、B8 被算成 probe-court-read）。
    const refs = [...lines[i].matchAll(/probe-[a-z0-9-]+/g)].map((x) => x[0]);
    for (const r of refs) {
      if (!probes.has(r)) broken = broken || r;
      else if (syntaxOk(r)) covered = covered || r;
      else broken = broken || r;
    }
  }
  rows.push({ id, covered, broken, hits: idxs.length });
}

const n = rows.length;
const naked = rows.filter((r) => !r.covered).length;
const brokenRows = rows.filter((r) => r.broken).length;

console.log(`SPEC=${SPEC}`);
console.log(`IDS=${n}  COVERED=${n - naked}  NAKED=${naked}  BROKEN=${brokenRows}`);
console.log('');
for (const r of rows) {
  const tag = r.covered ? 'COVERED' : r.broken ? 'BROKEN ' : 'NAKED  ';
  console.log(`  ${tag} ${r.id.padEnd(3)} ${r.covered || (r.broken ? '坏引用:' + r.broken : '(无探针引用)')}`);
}

const allowIds = new Set(ALLOW_NO_PROBE.map((a) => a.id));
const unallowedNaked = rows.filter((r) => !r.covered && !allowIds.has(r.id));
const ok = brokenRows === 0 && unallowedNaked.length === 0;
console.log('');
console.log(`NAKED=${naked}（其中白名单 ${naked - unallowedNaked.length}、未登记 ${unallowedNaked.length}）`);
for (const r of unallowedNaked) console.log(`  未登记 NAKED: ${r.id}`);
console.log(ok ? 'RESULT=PASS' : 'RESULT=BLOCK');
console.log('备注：文本邻近检查，不证明探针覆盖了该缺陷的语义。');
process.exit(ok ? 0 : 1);
