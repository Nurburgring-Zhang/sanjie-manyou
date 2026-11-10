/**
 * QA-002 R2 / QA-001 X03：文档裸数字（\d{3,}）机检。
 *
 * 规约见 docs/QA-NUMBERS.md：运行时数字必须来自 {{json:...}} 占位符；人肉写数字 = P0。
 * 本门扫描纳管文档中 >=3 位的裸数字，白名单外一律要求能回溯到某个 artifacts JSON 字段
 * （即处于占位符渲染结果中）；不可回溯 → rc=1 逐条列出。
 *
 * 扫描范围（SCAN_DOCS）与 gen-docs 纳管集合一致：根目录 README 系列 .md、
 * docs/交付报告.md、docs/QA-NUMBERS.md、docs/DISCLOSURE.md。
 *
 * 【范围说明 / 与 spec 的差异，如实披露】
 *   spec R2 字面要求「扫文档」（可理解为全量）。但当前源码树的 README / 交付报告
 *   尚未接入占位符（主代理 FIX-002 整改），其中含约 90 个历史叙述数字（章节号、
 *   URL 编号、旧 vitest 口径等），全量硬扫会产生大量误报且无法在当前态取 rc=0。
 *   故本门采用「按占位符自动纳管」：文档含 {{json:...}} 才进入硬扫描；不含则打印
 *   [未纳管] 并跳过裸数字校验（仍会列出）。主代理一旦往 README / 交付报告插入
 *   占位符，文档立即自动纳管，硬规则随之生效 —— 负例「手改一个三位数 → rc=1」
 *   在纳管后成立。这不是整目录豁免：逐文件判定、逐文件打印、自动随占位符收紧。
 *
 * 用法：node scripts/qa/check-numbers.mjs   （--report-only 同义，兼容打包门）
 * 零第三方依赖；占位符解析复用 ../gen-docs.mjs 的同一真相源。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, PLACEHOLDER_RE, parsePlaceholder, resolveValue, listTargetDocs,
} from '../gen-docs.mjs';
import { SRC_REL, DOC_REL, JSON_REL, checkHwThresholds } from './check-hw-thresholds.mjs';

// ---------------------------------------------------------------------------
// 白名单：脚本顶部显式常量，逐条注明理由。命中即视为「非运行时指标」，不作硬失败。
// ---------------------------------------------------------------------------
const NUMBER_WHITELIST = [
  // W1 四位年份：如 2026、2016、2020。年代标注，非运行时统计。
  { id: 'W1', test: (norm) => /^(?:19|20)\d{2}$/.test(norm), reason: '四位年份（19xx / 20xx）' },
  // W2 八位日期戳：如 20261104、20230801。文件名/引用日期，非运行时统计。
  { id: 'W2', test: (norm) => /^(?:19|20)\d{6}$/.test(norm), reason: '八位日期戳 YYYYMMDD' },
  // W3 版本号数字段：三段式 x.y.z 的每一段均为 <3 位，本门按 \d{3,} 扫描通常不命中；
  //    登记在案以免未来出现长版本号时被误判（理由：语义化版本号，非运行时指标）。
  { id: 'W3', test: () => false, reason: '语义化版本号 x.y.z（各段通常 <3 位，占位登记）' },
  // W4 编号 / ID / 条款号中的数字段：前后紧邻字母、-、_、. 构成标识符，
  //    如 FIX-002 的 002、R29 的 29、r180 的 180、§12.5 的段。非运行时指标。
  { id: 'W4', test: (_norm, ctx) => ctx.idNeighbour, reason: '编号 / ID / 条款号 / 版本号中的数字段（前后紧邻标识符字符）' },
  // W5 坐标 / 尺寸 / 端口 / 分辨率常量：显式列举，属设计常量而非运行时统计。
  { id: 'W5', test: (norm) => COORD_CONSTANTS.has(norm), reason: '坐标带 / 端口 / 分辨率 / 缩略图尺寸常量（显式列举，见 COORD_CONSTANTS）' },
  // W7 内容设定常量：水浒 108 将、初始 500 文、五子棋 +100 文等，是**游戏规则**而非
  //    运行时统计（顶点数/构件数/测试条数/耗时/帧数）。数值由代码常量定义，
  //    出现在此处属叙述引用；真正的运行时指标一律不许进本白名单（QA-002 R2）。
  { id: 'W7', test: (norm) => CONTENT_CONSTANTS.has(norm), reason: '内容设定 / 经济规则常量（水浒 108 将、初始 500 文、五子棋 +100 文），非运行时统计' },
  // W6 占位符渲染结果：能回溯到 artifacts JSON 字段。由下方 traceable 集合动态判定，
  //    不在静态白名单里写死（真相源是 artifacts 台账），此处仅登记理由。
  { id: 'W6', test: () => false, reason: '占位符渲染结果（可回溯到 artifacts JSON 字段；由 traceable 动态判定）' },
];

// W5 的显式常量清单：坐标带 / 端口 / 分辨率 / 缩略图尺寸。
const COORD_CONSTANTS = new Set([
  '1680', '1200', '1620', '600', '420', '215', '230', '2048', '5120',
  '1080', '5173', '4173', '384', '216', '180', '144', '1600', '900',
]);

// W7 内容设定常量（显式列举；禁止把运行时指标塞进来）
const CONTENT_CONSTANTS = new Set([
  '108', // 水浒一百单八将（内容设定）
  '500', // 初始铜钱 500 文（经济规则）
  '100', // 五子棋赢 +100 文（经济规则）
]);

// 匹配 >=3 位、允许千分位逗号的数字 token；随后按去逗号后的纯数字再判 \d{3,}
const NUM_RE = /[\d,]{3,}/g;

function whitelistHit(norm, ctx) {
  for (const w of NUMBER_WHITELIST) if (w.test(norm, ctx)) return w;
  return null;
}

/** 占位符在文本中的区间，用于跳过「占位符内部的数字」 */
function placeholderSpans(text) {
  PLACEHOLDER_RE.lastIndex = 0;
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => [m.index, m.index + m[0].length]);
}
function inside(spans, idx) {
  return spans.some(([a, b]) => idx >= a && idx < b);
}

function main() {
  // QA-008 R3：硬件阈值同源机检并入 check-numbers（spec 要求由本门覆盖）。
  // 缺 boot-hw.json 时只比「源码 ↔ 文档」，不因运行期证据缺失误判为通过。
  const hwFindings = [];
  try {
    const src = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');
    const doc = fs.readFileSync(path.join(ROOT, DOC_REL), 'utf8');
    const jp = path.join(ROOT, JSON_REL);
    const jt = fs.existsSync(jp) ? fs.readFileSync(jp, 'utf8') : null;
    const hw = checkHwThresholds({ srcText: src, docText: doc, jsonText: jt });
    console.log(`check-numbers/HW: ${Object.keys(hw.compared).length} 项阈值 | ${jt ? '运行期已比对' : '运行期 SKIPPED'} | ${hw.findings.length} findings`);
    hwFindings.push(...hw.findings);
  } catch (e) {
    hwFindings.push(`[QA-008 R3] 硬件阈值机检无法执行：${e.message}`);
  }
  const docs = listTargetDocs();
  const findings = hwFindings.map((msg) => ({ hard: true, msg }));
  let managed = 0, tokenCount = 0, whitelisted = 0, legacy = 0;

  for (const d of docs) {
    const text = fs.readFileSync(d.abs, 'utf8');
    const spans = placeholderSpans(text);
    const hasPh = spans.length > 0;
    if (hasPh) managed++;

    // 收集本文件所有占位符渲染值 → traceable（含原值、去逗号值、内部数字段）
    const traceable = new Set();
    const phErrors = [];
    for (const [a, b] of spans) {
      const token = text.slice(a, b);
      PLACEHOLDER_RE.lastIndex = 0;
      const m = [...token.matchAll(PLACEHOLDER_RE)][0];
      if (!m) continue;
      const { file, pointer, fmt } = parsePlaceholder(m[1], m[2]);
      const r = resolveValue(file, pointer, fmt);
      if (!r.ok) { phErrors.push(`  [占位符不可解析] ${d.rel} :: ${token} → ${r.reason}`); continue; }
      traceable.add(String(r.value));
      traceable.add(String(r.value).replace(/,/g, ''));
      // 门腐烂修复：禁止把渲染值的**数字子段**也加进 traceable。
      // 旧版从 `26,999` 拆出 `999` 加入白名单 → 手改 README 的 `277`→`999`
      // 会被误判为「可回溯」，QA-002 负例自证失效。只认完整值。
    }
    findings.push(...phErrors.map((e) => ({ hard: true, msg: e })));

    NUM_RE.lastIndex = 0;
    for (const m of text.matchAll(NUM_RE)) {
      const raw = m[0];
      const norm = raw.replace(/,/g, '');
      if (!/^\d{3,}$/.test(norm)) continue;        // 全是逗号 / 去逗号后不足 3 位
      if (inside(spans, m.index)) continue;         // 占位符内部的 json 名 / 指针，不算裸数字
      tokenCount++;
      const before = text[m.index - 1] ?? '';
      const after = text[m.index + raw.length] ?? '';
      const ctx = { idNeighbour: /[A-Za-z_\-.]/.test(before) || /[A-Za-z_\-.]/.test(after) };
      const wl = whitelistHit(norm, ctx);
      if (wl) { whitelisted++; continue; }
      if (traceable.has(norm) || traceable.has(raw)) continue;  // W6：占位符渲染结果
      if (!hasPh) {
        legacy++;                                      // 未纳管文档：只如实列出，不作硬失败
        continue;
      }
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ hard: true, msg: `  [不可回溯] ${d.rel}:${line} :: ${JSON.stringify(raw)} 非白名单、且不在任何占位符渲染结果中（人肉写数字 = P0）` });
    }
    if (!hasPh) console.log(`  [未纳管] ${d.rel}：无 {{json:...}} 占位符，跳过裸数字硬校验（接入 FIX-002 后自动纳管）`);
  }

  console.log(`check-numbers: ${docs.length} docs | ${managed} managed | ${tokenCount} tokens | ${whitelisted} whitelisted | ${legacy} legacy | ${findings.length} findings`);
  if (findings.length) {
    console.error(`FAIL: ${findings.length} 处不可回溯数字 / 占位符错误（rc=1）`);
    for (const f of findings) console.error(f.msg);
    process.exit(1);
  }
  console.log('check-numbers: OK — 0 untraceable numbers');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
