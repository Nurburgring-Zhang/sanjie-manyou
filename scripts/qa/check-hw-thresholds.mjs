/**
 * QA-008 R3 / QA-002 R2：硬件阈值「代码常量 ↔ 文档 ↔ 运行期台账」三处同源机检。
 *
 * 单一真相源 = `src/game/perfMode.ts` 的 HW_THRESHOLDS。
 * `docs/HW-REQUIREMENTS.md` 用 `{{json:boot-hw.json#thresholds.<key>}}` 渲染可见值，
 * `artifacts/boot-hw.json` 由 `probe-boot-memory.mjs` 从 `window.__qingming.hwThresholds` 落盘。
 * 本门校验：① 文档可见值与占位符 key 对应；② 文档值 == 源码常量；
 * ③ 运行期台账存在时其值也必须等于源码常量。任一不符 rc=1，绝不「大概一致」放过。
 *
 * 用法：node scripts/qa/check-hw-thresholds.mjs [--self-test] [--report-only]
 * 被 scripts/qa/check-numbers.mjs 复用（QA-008 验收要求由 check-numbers 覆盖同源机检）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC_REL = 'src/game/perfMode.ts';
export const DOC_REL = 'docs/HW-REQUIREMENTS.md';
export const JSON_REL = 'artifacts/boot-hw.json';

/** 从 HW_THRESHOLDS 块里抽 `key: number,`；不解析注释，避免把注释里的示例当常量。 */
export function parseSourceThresholds(srcText) {
  const start = srcText.indexOf('export const HW_THRESHOLDS');
  if (start < 0) throw new Error('找不到 HW_THRESHOLDS 定义');
  const end = srcText.indexOf('});', start);
  const body = (end > 0 ? srcText.slice(start, end) : srcText.slice(start, start + 3000))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const out = {};
  for (const m of body.matchAll(/^\s*([A-Za-z_]\w*)\s*:\s*(-?[\d.]+)\s*,/gm)) {
    out[m[1]] = Number(m[2]);
  }
  if (!Object.keys(out).length) throw new Error('HW_THRESHOLDS 里没解析到任何数字常量');
  return out;
}

/** 文档里 `8<!-- {{json:boot-hw.json#thresholds.minRamGB}} -->` 形式的可读值 + key。 */
export function parseDocThresholds(docText) {
  const out = {};
  const re = /(\d+(?:\.\d+)?)\s*<!--\s*\{\{json:boot-hw\.json#thresholds\.([A-Za-z_]\w*)\}\}\s*-->/g;
  for (const m of docText.matchAll(re)) out[m[2]] = Number(m[1]);
  return out;
}

/** 纯函数：三处比对。返回 findings 供调用方 deciding rc。 */
export function checkHwThresholds({ srcText, docText, jsonText = null }) {
  const findings = [];
  let src;
  try { src = parseSourceThresholds(srcText); }
  catch (e) { return { ok: false, findings: [`源码阈值解析失败：${e.message}`], compared: {} }; }
  const doc = parseDocThresholds(docText);
  const compared = {};
  for (const [key, value] of Object.entries(src)) {
    const row = { source: value, doc: doc[key] ?? null, runtime: null };
    compared[key] = row;
    if (!(key in doc)) {
      findings.push(`[QA-008 R3] 文档未用占位符声明阈值 ${key}（源码值 ${value}）；文档不得手抄或漏列`);
      continue;
    }
    if (doc[key] !== value) {
      findings.push(`[QA-008 R3] 阈值 ${key} 文档 ${doc[key]} ≠ 源码 ${value}`);
    }
  }
  for (const [key, value] of Object.entries(doc)) {
    if (!(key in src)) findings.push(`[QA-008 R3] 文档声明了源码中不存在的阈值 ${key}=${value}`);
  }
  if (jsonText !== null) {
    let run;
    try { run = JSON.parse(jsonText).thresholds ?? null; }
    catch (e) { findings.push(`[QA-008 R3] boot-hw.json 无法解析：${e.message}`); }
    if (run) {
      for (const [key, value] of Object.entries(src)) {
        compared[key].runtime = run[key] ?? null;
        if (run[key] !== value) findings.push(`[QA-008 R3] 阈值 ${key} 运行期台账 ${run[key]} ≠ 源码 ${value}`);
      }
    } else if (!findings.length) {
      findings.push('[QA-008 R3] boot-hw.json 缺 thresholds 字段');
    }
  }
  return { ok: findings.length === 0, findings, compared };
}

function selfTest() {
  const src = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');
  const doc = fs.readFileSync(path.join(ROOT, DOC_REL), 'utf8');
  const cases = [
    { name: '真实源码+文档 → PASS', s: src, d: doc, ok: true },
    { name: '文档手改 8→9 → FAIL', s: src, d: doc.replace(/(8)\s*<!--\s*\{\{json:boot-hw\.json#thresholds\.minRamGB/, '9<!-- {{json:boot-hw.json#thresholds.minRamGB'), ok: false },
    { name: '文档删掉一个阈值 → FAIL', s: src, d: doc.replace(/16\s*<!--\s*\{\{json:boot-hw\.json#thresholds\.recommendedRamGB\}\}\s*-->/, '16'), ok: false },
    { name: '源码常量被改但文档没跟 → FAIL', s: src.replace('minRamGB: 8,', 'minRamGB: 12,'), d: doc, ok: false },
  ];
  const rows = cases.map((c) => {
    const r = checkHwThresholds({ srcText: c.s, docText: c.d });
    return { name: c.name, expect: c.ok ? 'PASS' : 'FAIL', got: r.ok ? 'PASS' : 'FAIL', ok: r.ok === c.ok };
  });
  const all = rows.every((r) => r.ok);
  console.log(all ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL');
  console.log(JSON.stringify({ negativeCases: rows.filter((r) => r.expect === 'FAIL').length, cases: rows }, null, 2));
  process.exit(all ? 0 : 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function main() {
  const src = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');
  const doc = fs.readFileSync(path.join(ROOT, DOC_REL), 'utf8');
  const jsonPath = path.join(ROOT, JSON_REL);
  const jsonText = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : null;
  const r = checkHwThresholds({ srcText: src, docText: doc, jsonText });
  console.log(`check-hw-thresholds: 源码 ${Object.keys(r.compared).length} 项 | 运行期台账 ${jsonText ? '已比对' : 'SKIPPED(缺 boot-hw.json)'} | ${r.findings.length} findings`);
  if (!r.ok) {
    for (const f of r.findings) console.error(f);
    console.error('FAIL: 硬件阈值三处不同源（rc=1）');
    process.exit(1);
  }
  console.log('check-hw-thresholds: OK — 文档/源码/运行期阈值同源');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
