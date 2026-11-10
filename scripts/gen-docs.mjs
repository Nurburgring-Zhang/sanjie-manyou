/**
 * FIX-002 R1 / FIX-002 R4 / QA-001 S11：文档数字段机器生成 + 同步检查。
 *
 * 占位符语法：{{json:<台账文件名>#<点分 JSON pointer>[,|<fmt>]}}
 *   - <台账文件名>  ROOT/artifacts/<文件名> 首选；若不存在，回退 ROOT/<文件名>
 *     （后者仅为兼容如 {{ json : package.json # version }} 一类根级台账，属可选扩展）。
 *   - <点分 JSON pointer>  形如 destructionHit.vertsDeformed，支持数组下标
 *     （debrisEarly.0.destruction.vertsDeformed）。
 *   - 可选后缀「|,」= 千分位渲染（26999 → 26,999）；省略 = 原值原样输出。
 *     该后缀是可选项，本脚本已实现：fmt 段含 ',' 且取值为有限数值时按
 *     en-US 分组输出，否则按原始标量输出；详见 formatValue()。
 *
 * 渲染后的规范形态（占位符保留在 HTML 注释里，随可见值成对出现）：
 *   26,999<!-- {{json:r27-collision-runtime.json#destructionHit.vertsDeformed|,}} -->
 *
 * 为什么「替换后仍保留占位符」而不是把它抹掉：
 *   R4 要求 --check 能检出「改了 artifacts JSON 却忘了重渲染」。若占位符被一次性
 *   替换掉就再无真相源，render 退化为恒等函数，--check 永远绿。故采用
 *   「可见数字 + 注释内占位符」成对形态：默认写回只刷新可见数字，--check 把文档
 *   重渲染到内存再与盘上逐字节 diff。两种形态（裸露占位符 / 已成对）都能收敛到
 *   同一规范形态，保证幂等：render(render(x)) === render(x)。
 *
 * 目标文档（找不到即跳过，不崩 —— 对 README.md / README-DELIVERY.md 两种布局健壮）：
 *   根目录 README*.md、docs/交付报告.md、docs/QA-NUMBERS.md、docs/DISCLOSURE.md
 *
 * 用法：
 *   node scripts/gen-docs.mjs            # 渲染并写回（默认）
 *   node scripts/gen-docs.mjs --check    # 渲染到内存与盘上 diff；不一致 rc=1；成功打印 "docs in sync"
 *   node scripts/gen-docs.mjs --list     # 列出纳管文档/占位符/解析值（诊断）
 *
 * 约束：零第三方依赖；目标文件/字段缺失必须 rc=1 并逐条列明，禁止静默；
 *       有解析错误时一律不写回（避免半渲染污染文档）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** 占位符：{{json:<file>#<pointer[,|fmt]>}} —— file 与 rest 均不含 '#'/'}' */
export const PLACEHOLDER_RE = /\{\{json:([^}#]+)#([^}]+)\}\}/g;

/** 目标文档：按「布局健壮」原则发现，缺失静默跳过 */
const TARGET = [
  { kind: 'readmeGlob', pattern: /^README.*\.md$/i },
  { kind: 'fixed', rel: 'docs/交付报告.md' },
  { kind: 'fixed', rel: 'docs/QA-NUMBERS.md' },
  { kind: 'fixed', rel: 'docs/DISCLOSURE.md' },
  // QA-008 R3：硬件要求文档的阈值/实测矩阵必须来自 artifacts 台账，
  // 纳入后 check-numbers 自动纳管，禁止手抄运行期数字。
  { kind: 'fixed', rel: 'docs/HW-REQUIREMENTS.md' },
];

export function listTargetDocs() {
  const out = [];
  for (const t of TARGET) {
    if (t.kind === 'readmeGlob') {
      for (const f of fs.readdirSync(ROOT)) {
        if (t.pattern.test(f)) out.push({ rel: f, abs: path.join(ROOT, f) });
      }
    } else if (fs.existsSync(path.join(ROOT, t.rel))) {
      out.push({ rel: t.rel, abs: path.join(ROOT, t.rel) });
    }
  }
  // 去重并稳定排序
  const seen = new Set();
  return out.filter((d) => (seen.has(d.rel) ? false : (seen.add(d.rel), true)))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

/** 解析占位符内两段：file 与 rest(# 之后)。rest 再按 '|' 拆出 pointer 与 fmt 标志。 */
export function parsePlaceholder(rawFile, rawRest) {
  const file = rawFile.trim();
  const parts = rawRest.split('|');
  const pointer = parts[0].trim();
  const fmt = parts.slice(1).join('|').trim();
  return { file, pointer, fmt };
}

const jsonCache = new Map();
function loadJson(file) {
  if (jsonCache.has(file)) return jsonCache.get(file);
  const cands = [path.join(ROOT, 'artifacts', file), path.join(ROOT, file)];
  let used = null;
  for (const c of cands) { if (fs.existsSync(c)) { used = c; break; } }
  if (!used) {
    const r = { ok: false, reason: `artifacts/${file} 与 ROOT/${file} 均不存在（目标文件缺失）` };
    jsonCache.set(file, r); return r;
  }
  try {
    const data = JSON.parse(fs.readFileSync(used, 'utf8'));
    const r = { ok: true, data, used };
    jsonCache.set(file, r); return r;
  } catch (e) {
    const r = { ok: false, reason: `JSON 解析失败：${used} → ${String(e.message || e)}` };
    jsonCache.set(file, r); return r;
  }
}

/** 按点分路径取值；数组下标用数字段 */
function pointerGet(data, pointer) {
  let cur = data;
  for (const seg of pointer.split('.')) {
    if (cur === null || cur === undefined) return { ok: false, reason: `路径 ${pointer} 在 '${seg}' 处遇到空值` };
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) cur = cur[seg];
    else return { ok: false, reason: `字段 ${pointer} 不存在（断在 '${seg}'）` };
  }
  if (cur !== null && typeof cur === 'object') return { ok: false, reason: `字段 ${pointer} 不是标量（是 ${Array.isArray(cur) ? 'array' : 'object'}）` };
  return { ok: true, value: cur };
}

function formatValue(v, fmt) {
  const raw = String(v);
  if (fmt.includes(',')) {
    const n = typeof v === 'number' ? v : Number(raw.replace(/,/g, ''));
    if (Number.isFinite(n)) return n.toLocaleString('en-US', { maximumFractionDigits: 20 });
  }
  return raw;
}

/** 取单个占位符的渲染值；返回 { ok, value|reason, usedPath } */
export function resolveValue(file, pointer, fmt) {
  const j = loadJson(file);
  if (!j.ok) return { ok: false, reason: j.reason };
  const g = pointerGet(j.data, pointer);
  if (!g.ok) return { ok: false, reason: `${g.reason}（于 ${path.relative(ROOT, j.used).replace(/\\/g, '/')}）`, usedPath: j.used };
  return { ok: true, value: formatValue(g.value, fmt), usedPath: j.used };
}

/**
 * 把一段文本渲染成规范形态。
 * 返回 { text, errors[], placeholders[] }；errors 非空时 text 为「未改动原文」（调用方据此不写回）。
 */
export function renderDoc(text, docRel) {
  PLACEHOLDER_RE.lastIndex = 0;
  const matches = [...text.matchAll(PLACEHOLDER_RE)];
  const errors = [];
  const placeholders = [];
  let out = text;
  // 从后往前替换，避免前面的改动影响后面的 index
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const token = m[0];
    const { file, pointer, fmt } = parsePlaceholder(m[1], m[2]);
    const r = resolveValue(file, pointer, fmt);
    placeholders.push({ token, file, pointer, fmt, value: r.ok ? r.value : null });
    if (!r.ok) {
      errors.push(`  [MISSING] ${docRel} :: ${token} → ${r.reason}`);
      continue; // 保留原文，绝不静默吞掉
    }
    const tokenStart = m.index;
    const tokenEnd = tokenStart + token.length;
    // ① 若占位符包在 HTML 注释里，span 扩展到整个 <!-- ... -->
    const before = out.slice(0, tokenStart);
    const open = before.lastIndexOf('<!--');
    const inComment = open !== -1 && before.slice(open).indexOf('-->') === -1;
    let spanStart = tokenStart;
    let spanEnd = tokenEnd;
    if (inComment) {
      const close = out.indexOf('-->', tokenEnd);
      if (close !== -1) spanEnd = close + 3;
      spanStart = open;
    }
    // ② 把紧贴其前的「已渲染数字」并入 span（允许中间有空白）。
    // 必须包含小数部分：旧正则 (\d[\d,]*)\s*$ 遇到 6718.1 只吞掉末尾的 "1"，
    // 留下 "6718." 再拼新值 → 6718.6718.1，-c 检查因此永不幂等（R29 M2 实测）。
    const prefix = out.slice(0, spanStart);
    // 允许前导负号：负值（如下限 -640）若只吞数字，会留下原来那个 '-' 再拼新值
    // → `-` + `-640` = `--640`，且**每跑一次多一个负号**（2026-11-10 实测 README 出现 `---640`）。
    // 同时接受排版用的 U+2212（−），文档里负值常用它而不是 ASCII 连字符。
    // 用 [-−]* 而非 [-−]?：这样已经写坏的 `---640`（历史多次重渲染累积的负号）
    // 也能被整段吞掉并自愈成 `-640`，不必手工改文档。
    const num = prefix.match(/([-−]*(?:\d[\d,]*)(?:\.\d+)?)\s*$/);
    if (num) spanStart = prefix.length - num[0].length + (num[0].match(/^\s*/) || [''])[0].length;
    // 规范形态：可见值 + 注释内占位符
    const replacement = `${r.value}<!-- ${token} -->`;
    out = out.slice(0, spanStart) + replacement + out.slice(spanEnd);
  }
  return { text: out, errors, placeholders };
}

function lineDiff(a, b) {
  const la = a.split(/\r?\n/), lb = b.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) lines.push({ line: i + 1, disk: la[i] ?? '<无>', rendered: lb[i] ?? '<无>' });
  }
  return lines;
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const list = argv.includes('--list');
  const docs = listTargetDocs();
  const allErrors = [];
  const diffs = [];
  const changed = [];
  let phCount = 0;

  const renders = [];
  for (const d of docs) {
    const disk = fs.readFileSync(d.abs, 'utf8');
    const r = renderDoc(disk, d.rel);
    phCount += r.placeholders.length;
    allErrors.push(...r.errors);
    renders.push({ d, disk, r });
    if (list) {
      for (const p of r.placeholders) {
        console.log(`  ${d.rel} :: ${p.token} => ${p.value === null ? 'ERROR' : JSON.stringify(p.value)}`);
      }
    }
    if (r.errors.length === 0 && r.text !== disk) {
      const dl = lineDiff(disk, r.text);
      diffs.push({ rel: d.rel, lines: dl });
      changed.push({ d, text: r.text });
    }
  }

  if (list) {
    console.log(`gen-docs: ${docs.length} docs | ${phCount} placeholders | ${allErrors.length} errors`);
    for (const e of allErrors) console.log(e);
    process.exit(allErrors.length ? 1 : 0);
  }

  if (allErrors.length) {
    console.error(`gen-docs: FAIL — ${allErrors.length} 个占位符无法解析（目标文件/字段缺失，禁止静默）`);
    for (const e of allErrors) console.error(e);
    console.error('gen-docs: 未写回任何文档（避免半渲染）');
    process.exit(1);
  }

  if (check) {
    if (diffs.length) {
      console.error(`gen-docs: FAIL — ${diffs.length} 份文档与渲染结果不一致（改了台账忘了重渲染？）`);
      for (const df of diffs) {
        console.error(`  ${df.rel}: ${df.lines.length} 行差异`);
        for (const l of df.lines.slice(0, 20)) {
          console.error(`    L${l.line} 盘上: ${JSON.stringify(l.disk)}`);
          console.error(`    L${l.line} 渲染: ${JSON.stringify(l.rendered)}`);
        }
        if (df.lines.length > 20) console.error(`    ... 另有 ${df.lines.length - 20} 行`);
      }
      process.exit(1);
    }
    console.log(`gen-docs: ${docs.length} docs | ${phCount} placeholders`);
    console.log('docs in sync');
    process.exit(0);
  }

  // 默认：写回
  for (const c of changed) {
    fs.writeFileSync(c.d.abs, c.text, 'utf8');
    console.log(`gen-docs: updated ${c.d.rel}`);
  }
  console.log(`gen-docs: ${docs.length} docs | ${phCount} placeholders | ${changed.length} rewritten`);
  console.log('docs in sync');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
