/**
 * probe-determinism.mjs —— 非确定性来源普查（纯 Node，不开浏览器）。
 *
 * 来源：V10《多人·存档·确定性》卷实测指出——仓库里 `Math.random` 127 处
 * （83 必改 / 44 可保留）、`performance.now()` 61 处（约 20 处进 sim）。
 * 这些是所有「同 seed 结果不同 / 回放分叉 / 联机街面不一致」的根。
 *
 * 本脚本做两件事：
 *   A（BLOCK）：`SIM_FILES` 里列出的文件必须**零**非确定性调用（棘轮：只准减不准增）
 *   B（REPORT）：全仓普查，按文件给出计数，供逐条裁决「必改 / 可保留」
 *
 * 诚实边界：静态文本匹配。命中不一定是缺陷（例如 UI 抖动），未命中也不代表确定
 * ——`RNG` 的种子用法、遍历顺序、`Set`/`Map` 迭代顺序都不在本门覆盖范围内。
 *
 * 用法：node scripts/probe-determinism.mjs
 * 退出码：0 = A 类干净；1 = A 类有命中；2 = 用法错误
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

/**
 * A 类：真·模拟路径。这些文件一旦引入非确定性，回放与联机必然分叉。
 * 棘轮原则：只准从这个清单里删文件，不准因为「改起来麻烦」把文件挪出去。
 */
const SIM_FILES = [
  'src/game/physics.ts',
  'src/actors/behaviors.ts',
  'src/actors/crowd.ts',
  'src/game/player.ts',
  'src/game/boss.ts',
  'src/sky/havoc.ts',
  'src/game/interact.ts',
];

/** 非确定性 API（正则 + 人类可读名） */
const PATTERNS = [
  { re: /\bMath\.random\s*\(/g, name: 'Math.random' },
  // 取引用（`const R = Math.random`）不命中上一条正则。这条专门抓它——
  // 引用可以随后被任意调用，所以 SIM_FILES 里出现一次就算违规。
  { re: /\bMath\.random\b(?!\s*\()/g, name: 'Math.random(ref)' },
  { re: /\bperformance\.now\s*\(/g, name: 'performance.now' },
  { re: /\bDate\.now\s*\(/g, name: 'Date.now' },
  { re: /\bnew\s+Date\s*\(/g, name: 'new Date' },
  // 审核 B 补强（2026-11-04）：裸 Date() 与 crypto 随机源同样是墙钟/熵依赖
  { re: /\bDate\s*\(\s*\)/g, name: 'Date()' },
  { re: /\bcrypto\.(getRandomValues|randomUUID)\b/g, name: 'crypto' },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 去掉注释与字符串字面量，避免把文档里的示例当成真调用 */
function stripNoise(text) {
  let out = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  out = out.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return out;
}

function main() {
  if (!existsSync(SRC)) {
    console.error('USAGE_ERROR: 找不到 ' + SRC);
    return 2;
  }
  const files = walk(SRC);
  const rows = [];
  const totals = Object.fromEntries(PATTERNS.map((p) => [p.name, 0]));

  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const code = stripNoise(readFileSync(f, 'utf8'));
    const hits = {};
    let any = 0;
    for (const p of PATTERNS) {
      const m = code.match(p.re);
      const n = m ? m.length : 0;
      if (n) { hits[p.name] = n; any += n; totals[p.name] += n; }
    }
    if (any) rows.push({ rel, any, hits });
  }

  rows.sort((a, b) => b.any - a.any);

  console.log(`SCANNED=${files.length} files`);
  console.log('TOTALS=' + JSON.stringify(totals));
  console.log('FILES_WITH_HITS=' + rows.length);
  console.log('\nTOP 20：');
  for (const r of rows.slice(0, 20)) {
    const detail = Object.entries(r.hits).map(([k, v]) => `${k}×${v}`).join(' ');
    console.log(`  ${String(r.any).padStart(4)}  ${r.rel}   ${detail}`);
  }

  // A 类：只查 SIM_FILES
  console.log('\nA 类（SIM_FILES 必须为零）：');
  let bad = 0;
  for (const sf of SIM_FILES) {
    const r = rows.find((x) => x.rel === sf);
    if (!r) {
      console.log(`  OK   ${sf}  0`);
      continue;
    }
    bad++;
    const detail = Object.entries(r.hits).map(([k, v]) => `${k}×${v}`).join(' ');
    console.log(`  FAIL ${sf}  ${r.any}   ${detail}`);
  }

  const ok = bad === 0;
  console.log(ok ? 'RESULT=PASS' : 'RESULT=BLOCK');
  console.log('备注：B 类清单里的每一处都需要人工裁决「必改 / 可保留」，本门不代替裁决。');
  return ok ? 0 : 1;
}

process.exit(main());
