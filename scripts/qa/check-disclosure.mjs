/**
 * QA-004 R1 / R2 / QA-001 S12 / X04：联网 / 真机声称四态披露机检。
 *
 * R1 凡字段名含 real|online|live|真实|联网|真机 的**声称字段**，必须在其同级对象
 *    存在 mode ∈ {real, mocked, offline, degraded}；缺失 → rc=1。
 * R2 mode:real 的项必须带 evidence，且该路径指向包内真实文件；否则 → rc=1。
 * R3 制度文档见 docs/DISCLOSURE.md（四态定义 + R28 反面判例）。
 *
 * 【扫描范围 —— 合理子集，逐条显式登记理由，禁止整目录无脑豁免】
 *  QA-004 允许「限制到合理子集，避免几百个历史证据 JSON 误报」。本脚本采用
 *  **显式 INCLUDE**（只扫下列文件），而不是「扫全部再豁免目录」：
 *   - artifacts/spec 目录下的全部 .json：QA-001/002/004 制度生效后的证据目录；
 *   - EXPLICIT_JSON_SCOPE 列出的现行披露记录（逐条带理由）；
 *   - DOC_SCOPE 交付向文档（逐条带理由）。
 *  其余 artifacts/*.json（R18~R27 历史真机证据、性能探针数据）不在子集内，
 *  理由见 OUT_OF_SCOPE_NOTES：它们的 world.live / realm / aliveChunks 等是
 *  计数器与领域词，不是运行期联网声称；回溯改造会制造大量误报（QA-004 明令避免）。
 *
 * 【声称键判定】按「词」而非「子串」：realm / alive / midAlive / realmY 不算声称字段；
 *   英文 real|online|live 按 camelCase 分词后整词命中，中文 真实|联网|真机 按子串命中。
 *
 * 用法：
 *   node scripts/qa/check-disclosure.mjs              # 正常模式 rc=0
 *   node scripts/qa/check-disclosure.mjs --self-test  # 构造 { "realX": true } 无 mode，必须 rc=1
 *   （--report-only 同义，兼容打包门；X04 依赖 --self-test 的 rc!=0）
 * 零第三方依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../gen-docs.mjs';

// ---------------------------------------------------------------------------
// 显式 INCLUDE 子集（逐条理由）
// ---------------------------------------------------------------------------
const EXPLICIT_JSON_SCOPE = [
  { rel: 'artifacts/r28-runtime.json', reason: 'FIX-003 键整改后的现行 R28 验收输出：含 onlineResearch 声称字段，须同级带 mode' },
  { rel: 'artifacts/r28-acceptance.json', reason: 'FIX-003 新验收输出（备选布局，R28 交付包使用；文件不存在则跳过，不静默判绿）' },
  { rel: 'artifacts/MANIFEST.json', reason: 'QA-007 生成物三态清单（备选，文件不存在则跳过）' },
  { rel: 'artifacts/DISCLOSURE-REGISTRY.json', reason: '披露登记表（备选，文件不存在则跳过）' },
];
const SPEC_DIR = 'artifacts/spec';           // QA 证据目录：制度生效后新增的披露记录落此，自动纳管
const DOC_SCOPE = [
  { rel: 'README.md', reason: '现行布局主交付 README（交付向文档）' },
  { rel: 'README-DELIVERY.md', reason: 'R28 交付包布局 README（交付向文档，文件不存在则跳过）' },
  { rel: 'docs/交付报告.md', reason: '交付报告（交付向文档）' },
];
// 明确排除的制度文档：它们定义术语、收录反面判例，不构成运行期声称，故不参与声称字段扫描。
const EXCLUDED_DOCS = [
  { rel: 'docs/DISCLOSURE.md', reason: '本规约自身：定义四态、收录 R28 反面判例（含无 mode 的负例文本），不是运行期声称' },
  { rel: 'docs/QA-NUMBERS.md', reason: 'QA-002 制度文档：只讲数字占位符，不含联网/真机声称' },
];
// 不在子集内的历史证据 / 探针数据：逐类理由（避免几百个历史证据 JSON 误报）
const OUT_OF_SCOPE_NOTES = [
  'R18~R27 历史真机证据 JSON（r18-runtime.json … r27-collision-runtime.json）：早于 QA-004 制度，字段沿用旧口径，不追溯改造',
  '性能 / 内存 / 归因探针数据（baseline-M0.json、p95-attrib*.json、_p95_smoke.json 等）：world.live 是存活对象计数器，realm / aliveChunks 是领域词，非联网声称',
  'r26-agent-runtime.json：devourReal 是吞噬行为判定字段，非联网声称',
  'world-atoms.json / scene-item-attribution.json 等台账：realm 是领域分区词，非联网声称',
];

const MODES = new Set(['real', 'mocked', 'offline', 'degraded']);
const CLAIM_WORDS = new Set(['real', 'online', 'live']);

/** 声称键判定：英文按 camelCase 分词整词命中；中文按子串命中 */
export function isClaimKey(key) {
  const segs = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  return segs.some((s) => CLAIM_WORDS.has(s.toLowerCase())) || /真实|联网|真机/.test(key);
}

function evidenceExists(ev) {
  if (typeof ev !== 'string' || !ev.trim()) return false;
  const r = ev.trim().replace(/\\/g, '/');
  const cands = [path.join(ROOT, r), path.join(ROOT, 'artifacts', r)];
  return cands.some((c) => fs.existsSync(c));
}

/** 审计单个对象：返回该对象上的违规列表 */
function auditObject(obj, where) {
  const bad = [];
  const keys = Object.keys(obj);
  const claims = keys.filter(isClaimKey);
  if (!claims.length) return bad;
  const hasMode = Object.prototype.hasOwnProperty.call(obj, 'mode');
  if (!hasMode) {
    bad.push(`${where} :: 声称字段 [${claims.join(', ')}] 缺同级 mode（∈ real|mocked|offline|degraded）`);
    return bad;
  }
  if (!MODES.has(obj.mode)) {
    bad.push(`${where} :: mode=${JSON.stringify(obj.mode)} 不在四态集合内`);
  }
  if (obj.mode === 'real') {
    if (!Object.prototype.hasOwnProperty.call(obj, 'evidence')) {
      bad.push(`${where} :: mode:real 缺 evidence（必须指向包内真实文件）`);
    } else if (!evidenceExists(obj.evidence)) {
      bad.push(`${where} :: mode:real 的 evidence=${JSON.stringify(obj.evidence)} 指向的文件不在包内`);
    }
  }
  return bad;
}

function walkJson(node, where, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkJson(v, `${where}[${i}]`, out));
    return;
  }
  out.push(...auditObject(node, where));
  for (const k of Object.keys(node)) walkJson(node[k], `${where}.${k}`, out);
}

/** 文档扫描：内联 JSON 对象字面量（带引号键）里的声称字段 */
function scanDocs() {
  const out = [];
  for (const d of DOC_SCOPE) {
    const p = path.join(ROOT, d.rel);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/\{[^{}]*\}/g)) {
      const lit = m[0];
      const keys = [...lit.matchAll(/"([^"]+)"\s*:/g)].map((x) => x[1]);
      if (!keys.some(isClaimKey)) continue;
      const obj = {};
      for (const km of lit.matchAll(/"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/g)) {
        let v = km[2];
        if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { /* 保留原串 */ } }
        else if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (v === 'null') v = null;
        else v = Number(v);
        obj[km[1]] = v;
      }
      out.push(...auditObject(obj, `${d.rel} 内联对象 @行${text.slice(0, m.index).split('\n').length}`));
    }
  }
  return out;
}

function collectJsonFiles() {
  const out = [];
  const spec = path.join(ROOT, SPEC_DIR);
  if (fs.existsSync(spec)) {
    for (const f of fs.readdirSync(spec).filter((x) => x.endsWith('.json'))) out.push(path.join(spec, f));
  }
  for (const x of EXPLICIT_JSON_SCOPE) {
    const p = path.join(ROOT, x.rel);
    if (fs.existsSync(p)) out.push(p);
  }
  return [...new Set(out)].sort();
}

function auditAll() {
  const violations = [];
  const files = collectJsonFiles();
  let jsonObjects = 0;
  for (const p of files) {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { violations.push(`${rel} :: JSON 解析失败：${String(e.message || e)}`); continue; }
    const before = violations.length;
    walkJson(j, rel, violations);
    if (violations.length === before) jsonObjects++;
  }
  violations.push(...scanDocs());
  return { files, violations };
}

function main() {
  const argv = process.argv.slice(2);
  const selfTest = argv.includes('--self-test');

  if (selfTest) {
    // QA-004 负例：{ "realX": true } 无 mode，门必须拦下 → rc=1（X04 依赖）
    const injected = { realX: true };
    const hits = auditObject(injected, '<self-test 负例>');
    console.log('check-disclosure --self-test: 注入 { "realX": true }（无 mode）');
    console.log(`check-disclosure --self-test: 命中 ${hits.length} 条违规`);
    for (const h of hits) console.log('  ' + h);
    const detected = hits.length > 0;
    console.log(detected
      ? 'SELF_TEST=DETECTED：负例被拦下（rc=1 expected）'
      : 'SELF_TEST=MISSED：负例漏检（门腐烂）');
    // 契约：--self-test 本身必须 rc!=0，打包门 X04 以此判定负例门有效
    process.exit(detected ? 1 : 2);
  }

  const r = auditAll();
  const docCount = DOC_SCOPE.filter((d) => fs.existsSync(path.join(ROOT, d.rel))).length;
  console.log(`check-disclosure: ${r.files.length} json | ${docCount} docs | ${r.violations.length} violations`);
  console.log(`  INCLUDE 子集：artifacts/spec/*.json + ${EXPLICIT_JSON_SCOPE.length} 条显式登记；排除制度文档 ${EXCLUDED_DOCS.length} 份（逐条理由见脚本顶部）`);
  if (r.violations.length) {
    console.error(`FAIL: ${r.violations.length} 处披露违规（rc=1）`);
    for (const v of r.violations) console.error('  [披露违规] ' + v);
    process.exit(1);
  }
  console.log('check-disclosure: OK — 0 disclosure violations');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
