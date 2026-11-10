/**
 * FIX-002 R3 / QA-001 S07：文档相对引用悬空检查。
 *
 * 扫描范围：根目录 README 系列 .md、docs 目录下全部 .md、electron/ 全部文件、
 *           根目录 bat、serve-dist.cjs。抽取其中的 artifacts/…、docs/…、*.log、*.json
 *           相对引用，逐一查文件是否在包内；不在且未显式登记 [外部] → rc=1 逐条列出。
 *
 * 【白名单原则】下方 EXTERNAL_WHITELIST 是脚本顶部显式常量，逐条带理由注释，
 *   且都是**精确引用串**（或含 <模板占位>/glob 的显式串），不是整目录豁免。
 *   这些条目全部来自 docs/ 下的历史设计稿（R 系列之前的 SPEC / 融合方案 / 重建稿），
 *   它们引用的是「规划中产物」「示例存档名」「模板文件名」，从未随包交付。
 *   现行交付文档（README / 交付报告）不靠白名单过门 —— 见最终报告逐条清单。
 *
 * 占位符内部 json 名：形如 {{json:<台账>#<pointer>}} 的 <台账> 指向 artifacts/
 *   下真实台账，算有效引用；本脚本显式校验该台账是否存在（不存在则判悬空，
 *   fail-closed，不静默）。
 *
 * 用法：node scripts/check-doc-refs.mjs   （--report-only 同义，兼容打包门）
 * 成功打印 "0 dangling refs"；零第三方依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, PLACEHOLDER_RE } from './gen-docs.mjs';

// ============================================================================
// [外部] 白名单：逐条精确登记 + 理由。禁止整目录无脑豁免。
// 归类理由统一说明：以下全部出自 docs/ 历史设计稿（完整设计方案合订本、
// MC融合方案、重建-v2、融合终版、PHASE2-PLAN、PROBLEM-SPEC、融合任务书），
// 属于「规划/示例/模板」性质的路径，从未随 R29 包交付，不是当前交付文档的失引。
// ============================================================================
const EXTERNAL_WHITELIST = [
  // [外部] V10 多人存档确定性：存档差异回放模板名，<fixture> 为占位符，非实际文件
  { ref: 'artifacts/replays/<fixture>.diff.json', reason: '历史设计稿 V10：回放差异模板名（含 <fixture> 占位符），从未产出' },
  // [外部] V10 多人存档确定性 / PROBLEM-SPEC：示例存档状态文件名
  { ref: 'task-state.json', reason: '历史设计稿 V10：确定性存档示例状态文件名，未随包交付' },
  // [外部] V10 多人存档确定性：0/1/2 号存档槽示例文件名
  { ref: 'slot.0.json', reason: '历史设计稿 V10：存档槽示例文件名，未随包交付' },
  { ref: 'slot.1.json', reason: '历史设计稿 V10：存档槽示例文件名，未随包交付' },
  { ref: 'slot.2.json', reason: '历史设计稿 V10：存档槽示例文件名，未随包交付' },
  // [外部] V10 多人存档确定性：存档索引 / 同步元数据示例文件名
  { ref: 'index.json', reason: '历史设计稿 V10：存档索引示例文件名，未随包交付' },
  { ref: 'sync.json', reason: '历史设计稿 V10：同步元数据示例文件名，未随包交付' },
  // [外部] V11 性能与工程：失败留现场的探针产物名模板，<name>/<build> 为占位符
  { ref: 'artifacts/probe-<name>-<build>.json', reason: '历史设计稿 V11：探针产物名模板（含 <name>/<build> 占位符），非实际文件' },
  // [外部] V12 路线图与验收：三次采样基线名模板，<build> 为占位符
  { ref: 'artifacts/baseline-<build>.json', reason: '历史设计稿 V12：基线采样名模板（含 <build> 占位符），非实际文件' },
  // [外部] V15 涌现叙事：karma 探针规划产物，原文标注「验收证据，不是玩家存档」/「待建」
  { ref: 'artifacts/karma-run.json', reason: '历史设计稿 V15：karma 探针规划产物（原文 [待建]），从未产出' },
  { ref: 'artifacts/karma-run.md', reason: '历史设计稿 V15：karma 探针规划产物（原文 [待建]），从未产出' },
  { ref: 'karma-run.json', reason: '历史设计稿 V15：同上，正文以裸文件名提及，显式登记' },
  // [外部] V5 建造系统：蓝图示例文件名
  { ref: 'docs/blueprints/3bay.json', reason: '历史设计稿 V5：三开间蓝图示例文件名，未随包交付' },
  // [外部] V5 建造系统：构建日志示例名
  { ref: 'build.log', reason: '历史设计稿 V5：构建日志示例名，未随包交付' },
  // [外部] PROBLEM-SPEC：校验记录示例文件名
  { ref: 'verify-record.json', reason: '历史稿 PROBLEM-SPEC：校验记录示例文件名，未随包交付' },
  // [外部] 完整设计方案合订本 / 融合终版 / 重建稿：性能基线规划产物（原文 [待建]）
  { ref: 'artifacts/perf-baseline.json', reason: '历史设计稿：性能基线规划产物（原文 [待建]），从未产出' },
  { ref: 'perf-baseline.json', reason: '历史设计稿：同上，正文以裸文件名提及，显式登记' },
  // [外部] 完整设计方案合订本 / 重建稿：v2 基线快照规划文件
  { ref: 'artifacts/BASELINE-v2.md', reason: '历史设计稿：v2 基线快照规划文件，从未产出' },
  // [外部] 完整设计方案合订本 / 重建稿：探针运行记录目录 glob / 模板名
  { ref: 'artifacts/probe-runs/*.json', reason: '历史设计稿：探针运行记录 glob 表达式，非实际文件' },
  { ref: 'artifacts/probe-runs/<name>-<date>.json', reason: '历史设计稿：探针运行记录名模板（含 <name>/<date> 占位符），非实际文件' },
  { ref: 'artifacts/probe-runs/<name>.json', reason: '历史设计稿：探针运行记录名模板（含 <name> 占位符），非实际文件' },
  // [外部] 完整设计方案合订本 / 重建稿：Agent 载荷示例文件名
  { ref: 'payload.json', reason: '历史设计稿：Agent 载荷示例文件名，未随包交付' },
  // [外部] 完整设计方案合订本 / 重建稿：载入归因规划产物
  { ref: 'load-attrib-20261105.json', reason: '历史设计稿：载入归因规划产物（带日期），从未产出' },
  // [外部] 完整设计方案合订本 / 重建稿 / 融合终版：基准/存档/生物示例文件名
  { ref: 'h2-bench.json', reason: '历史设计稿：H2 基准示例文件名，未随包交付' },
  { ref: 'dragon.json', reason: '历史设计稿：龙资产示例文件名，未随包交付' },
  { ref: 'h4-idb-save.json', reason: '历史设计稿：H4 存档示例文件名，未随包交付' },
  { ref: 'h7-move-lod.json', reason: '历史设计稿：H7 移动 LOD 示例文件名，未随包交付' },
  // [外部] 融合任务书：引用了未产出的合订卷名
  { ref: 'docs/完整设计方案-融合终版.md', reason: '历史稿 融合任务书：引用未产出的合订卷（包内为 完整设计方案-合订本-20261104.md）' },
];
const WHITELIST = new Map(EXTERNAL_WHITELIST.map((w) => [w.ref, w.reason]));

// 路径引用：artifacts/ 或 docs/ 开头，允许中文/<模板占位>/*glob/:行号，排除空白与成对标点
const PATH_RE = /(?:artifacts|docs)\/[^\s`"'()\[\]{},;|\\\uff08\uff09\uff0c\uff1b\uff1a\u3001\u3002\u300b\u300d]+/gu;
// 裸文件名：*.json / *.log（负向 lookbehind 防止从标识符中间起匹配）
const BARE_RE = /(?<![\w.])[A-Za-z][\w.-]*\.(?:json|log)\b/g;
// JS 控制台 API / 代码标识符，不是文件引用（正则形态误命中，显式排除并注明理由）
const NOT_A_FILE = new Set(['console.log', 'console.error', 'console.warn', 'console.info', 'console.debug']);

function trim(r) {
  r = r.replace(/:\d+(?:-\d+)?$/u, '');   // 去掉 :行号 / :起-止
  r = r.replace(/\/\.md$/u, '');            // "xxx.json/.md" 简写 → json
  return r.replace(/[.,;:)\]}>\u3001\u3002\uff0c\uff1b\uff1a\u300b\u300d\uff09]+$/gu, '');
}

function inUrl(text, idx) {
  // 外部 URL 里的 docs/… 片段不是包内引用
  return /https?:\/\//.test(text.slice(Math.max(0, idx - 24), idx));
}

function collectFiles() {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  for (const f of fs.readdirSync(ROOT)) {
    if (/^README.*\.md$/i.test(f) || /\.bat$/i.test(f)) out.push(path.join(ROOT, f));
  }
  walk(path.join(ROOT, 'docs'));
  walk(path.join(ROOT, 'electron'));
  out.push(path.join(ROOT, 'serve-dist.cjs'));
  return [...new Set(out)].filter((p) => fs.existsSync(p)).sort();
}

function exists(ref, fromFile) {
  const cands = [path.join(ROOT, ref), path.resolve(path.dirname(fromFile), ref)];
  if (!ref.includes('/')) cands.push(path.join(ROOT, 'artifacts', ref));
  return cands.some((c) => fs.existsSync(c));
}

function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text[i] === '\n') n++;
  return n;
}

function main() {
  const files = collectFiles();
  /** ref -> { count, files:Set, lines:[] , whitelisted } */
  const refs = new Map();
  const placeholderErrors = [];
  const add = (ref, file, line, whitelisted = false) => {
    if (!refs.has(ref)) refs.set(ref, { count: 0, files: new Set(), lines: [], whitelisted });
    const v = refs.get(ref);
    v.count++;
    v.files.add(file);
    if (v.lines.length < 4) v.lines.push(`${file}:${line}`);
    v.whitelisted = v.whitelisted || whitelisted;
  };

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const text = fs.readFileSync(abs, 'utf8');

    // 占位符内部台账名：指向 artifacts/ 下真实台账，算有效；缺失则 fail-closed 判悬空
    PLACEHOLDER_RE.lastIndex = 0;
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const ledger = m[1].trim();
      const p = path.join(ROOT, 'artifacts', ledger);
      if (!fs.existsSync(p)) {
        placeholderErrors.push(`  [占位符台账缺失] ${rel}:${lineOf(text, m.index)} :: {{json:${m[1]}#${m[2]}}} → artifacts/${ledger} 不存在`);
      }
    }

    const found = new Map(); // ref -> 首次出现的行号
    PATH_RE.lastIndex = 0;
    for (const m of text.matchAll(PATH_RE)) {
      if (inUrl(text, m.index)) continue;
      const r = trim(m[0]);
      if (r && !found.has(r)) found.set(r, lineOf(text, m.index));
    }
    BARE_RE.lastIndex = 0;
    for (const m of text.matchAll(BARE_RE)) {
      if (NOT_A_FILE.has(m[0])) continue;
      // 路径引用的 basename 已由 PATH_RE 按完整路径解析，不能再当裸文件名二次检查：
      // 否则 `artifacts/spec/PERF-001.json` 会额外产生一条裸 `PERF-001.json` 并误判悬空。
      if (m.index > 0 && text[m.index - 1] === '/') continue;
      if (inUrl(text, m.index)) continue;
      const r = trim(m[0]);
      if (r && !found.has(r)) found.set(r, lineOf(text, m.index));
    }
    for (const [ref, line] of found) {
      if (/^https?:/.test(ref)) continue;
      const wl = WHITELIST.has(ref);
      add(ref, rel, line, wl);
    }
  }

  // 逐条判存在；白名单条目视为 [外部] 合法
  const dangling = [];
  for (const [ref, v] of refs) {
    if (v.whitelisted) continue;
    // 只要任一出现位置能解析到实体即可
    if (![...v.files].some((f) => exists(ref, path.join(ROOT, f)))) {
      dangling.push({ ref, ...v });
    }
  }
  for (const e of placeholderErrors) dangling.push({ ref: e, placeholder: true });

  const total = refs.size + placeholderErrors.length;
  const wlCount = [...refs.values()].filter((v) => v.whitelisted).length;
  console.log(`check-doc-refs: ${files.length} files | ${total} refs | ${wlCount} [外部] | ${dangling.length} dangling`);
  if (dangling.length) {
    console.error(`FAIL: ${dangling.length} 悬空引用（rc=1）`);
    for (const d of dangling) {
      if (d.placeholder) { console.error(d.ref); continue; }
      console.error(`  [悬空] ${JSON.stringify(d.ref)}  ×${d.count}  @ ${d.lines.join(', ')}`);
    }
    process.exit(1);
  }
  console.log('0 dangling refs');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
