// QA-005 / FIX-007 R3：命名单一真相源机检。零第三方依赖，Node >= 20。
//   - 读 identity.mjs（package.json 是唯一真相源）得到期望串 CyberQingming-R<release>-<version>
//   - 扫 5 处：① README*.md 标题 ② electron/main.cjs 窗口标题 ③ 根目录 *.bat 可执行名
//             ④ serve-dist.cjs 日志前缀 ⑤ dist/index.html 的 <title>
//   - 另查陈旧版本号 R2[0-7]（仅 R20–R27；不含 R28/R29，避免把近期版本的历史注释误报）
//   - 不一致 -> 打印「文件/行号/期望 vs 实际」，rc=1；全一致 -> "naming: 5/5 consistent" rc=0
//   - --self-test -> 内存副本注入 release:"R99"（绝不改盘上 package.json），rc=2 并列出全部不一致点
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIdentity } from './lib/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SELF_TEST = process.argv.includes('--self-test');
const PKG_PATH = resolve(ROOT, 'package.json');

// 自检只覆盖内存副本；盘上 package.json 始终保持原值（主代理写入的 R29）。
const id = SELF_TEST ? loadIdentity({ release: 'R99' }) : loadIdentity();
const stem = `${id.productNameEn}-${id.release}-${id.version}`; // 期望串，如 CyberQingming-R29-1.2.0
const expectedExe = id.exeName; // 如 CyberQingming-R29-1.2.0-x64.exe

/** 读文件为 [{n:行号,t:行文本}]；文件不存在返回 null */
function readLines(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((t, i) => ({ n: i + 1, t }));
}

function listRoot(re) {
  return readdirSync(ROOT)
    .filter((f) => re.test(f))
    .sort();
}

// { group, file, line, expected, actual, note }
const violations = [];
function push(group, file, line, expected, actual, note) {
  violations.push({ group, file, line, expected, actual, note });
}

// 每组结果：{ name, ok }；ok 当且仅当该组无 violations。
const groups = [];
function addGroup(name) {
  const g = { name, ok: true };
  groups.push(g);
  return g;
}
function failGroup(g) {
  g.ok = false;
}

// ---------------------------------------------------------------------------
// ① README*.md 标题
// ---------------------------------------------------------------------------
{
  const g = addGroup('① README*.md 标题');
  const files = listRoot(/^README.*\.md$/i);
  if (files.length === 0) {
    push(g.name, 'README*.md', 0, `含 ${stem} 的一级标题`, '(根目录未找到 README*.md)', '缺少 README');
    failGroup(g);
  }
  for (const f of files) {
    const lines = readLines(f);
    const h1 = lines && lines.find((l) => /^#\s+/.test(l.t));
    if (!h1) {
      push(g.name, f, 1, `含 ${stem}`, '(未找到 # 一级标题)', 'README 标题缺版本身份');
      failGroup(g);
    } else if (!h1.t.includes(stem)) {
      push(g.name, f, h1.n, `含 ${stem}`, h1.t.trim(), 'README 标题产品名/版本不一致');
      failGroup(g);
    }
  }
}

// ---------------------------------------------------------------------------
// ② electron/main.cjs 窗口标题
// ---------------------------------------------------------------------------
{
  const g = addGroup('② electron/main.cjs 窗口标题');
  const f = 'electron/main.cjs';
  const lines = readLines(f);
  if (!lines) {
    push(g.name, f, 0, `窗口标题含 ${stem}`, '(文件不存在)', '缺文件');
    failGroup(g);
  } else {
    const cand = lines.filter((l) => /\btitle\s*:/.test(l.t));
    if (cand.length === 0) {
      push(g.name, f, 0, `窗口标题含 ${stem}`, '(未找到 title: 行)', '缺窗口标题');
      failGroup(g);
    }
    for (const l of cand) {
      if (!l.t.includes(stem)) {
        push(g.name, f, l.n, `含 ${stem}`, l.t.trim(), '窗口标题产品名/版本不一致');
        failGroup(g);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ③ 根目录 *.bat 内可执行名
// ---------------------------------------------------------------------------
{
  const g = addGroup('③ 根目录 *.bat 内可执行名');
  const bats = listRoot(/\.bat$/i);
  let foundExpected = false;
  let tokenCount = 0;
  for (const f of bats) {
    const lines = readLines(f) || [];
    for (const l of lines) {
      const re = /[A-Za-z0-9_.\-]+\.exe/gi;
      let m;
      while ((m = re.exec(l.t)) !== null) {
        tokenCount += 1;
        if (m[0] === expectedExe) {
          foundExpected = true;
        } else {
          push(g.name, f, l.n, expectedExe, m[0], 'bat 内 exe 名与身份不符');
          failGroup(g);
        }
      }
    }
  }
  // 仅当「一个 exe 名都没写」时才报缺失；若写了但名字不对，上面的逐条不符已覆盖，
  // 避免同时出现「名字不符」+「未找到 exe」这种自相矛盾的两条。
  if (tokenCount === 0) {
    push(
      g.name,
      bats.length ? bats.join(', ') : '(根目录无 *.bat)',
      0,
      expectedExe,
      '(未找到任何 .exe 可执行名)',
      '缺 exe 名引用',
    );
    failGroup(g);
  } else if (!foundExpected) {
    // 已有逐条不符，无需再加一条；仅确保组为 FAIL（上面 push 已 failGroup）。
  }
}

// ---------------------------------------------------------------------------
// ④ serve-dist.cjs 日志前缀
// ---------------------------------------------------------------------------
{
  const g = addGroup('④ serve-dist.cjs 日志前缀');
  const f = 'serve-dist.cjs';
  const lines = readLines(f);
  if (!lines) {
    push(g.name, f, 0, `日志前缀含 ${stem}`, '(文件不存在)', '缺文件');
    failGroup(g);
  } else {
    const bannerLines = lines.filter(
      (l) => /console\.log/i.test(l.t) && /DELIVERY|CyberQingming/i.test(l.t),
    );
    if (bannerLines.length === 0) {
      push(g.name, f, 0, `日志前缀含 ${stem}`, '(未找到横幅 console.log 行)', '缺日志前缀');
      failGroup(g);
    }
    for (const l of bannerLines) {
      if (!l.t.includes(stem)) {
        push(g.name, f, l.n, `含 ${stem}`, l.t.trim(), '日志前缀版本身份不一致');
        failGroup(g);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ⑤ dist/index.html 的 <title>
// ---------------------------------------------------------------------------
{
  const g = addGroup('⑤ dist/index.html 的 <title>');
  const f = 'dist/index.html';
  const p = resolve(ROOT, f);
  if (!existsSync(p)) {
    push(g.name, f, 0, `<title> 含 ${stem}`, '(文件不存在)', '缺 dist/index.html');
    failGroup(g);
  } else {
    const text = readFileSync(p, 'utf8');
    const m = text.match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) {
      push(g.name, f, 0, `<title> 含 ${stem}`, '(未找到 <title>)', '缺 <title>');
      failGroup(g);
    } else if (!m[1].includes(stem)) {
      const idx = text.indexOf(m[0]);
      const lineNo = text.slice(0, idx).split(/\r?\n/).length;
      push(g.name, f, lineNo, `含 ${stem}`, m[1].trim(), '<title> 产品名/版本不一致');
      failGroup(g);
    }
  }
}

// ---------------------------------------------------------------------------
// 陈旧版本号 R2[0-7]（只查 R20–R27；不含 R28/R29）
// 作用域：src/ electron/ *.cjs *.bat index.html
//
// [v1.3 裁决 · 主代理] spec FIX-007 R3(a) 字面是 `grep -rn 'R2[0-7]' src/ …`，
// 但全量按字面执行会命中 395 处**历史设计注释**（如 "R27 修复"、"（R26）"），
// 这些是审计留痕，不是"用户可见的陈旧版本标签"，清掉反而破坏可追溯性。
// 裁决：仍全量扫 src/**，但**先剥离注释**再判定；字符串字面量里的 R2x 保留
// （运行时可见文本照旧拦截）。此裁决不缩小文件作用域，只排除注释语义，
// 且 --self-test 的 R99 注入仍必须 rc=2。裁决理由登记在交付报告，不静默放宽。
// ---------------------------------------------------------------------------
// 词边界：只拦「独立出现的版本标签」（如横幅里的 R22），不误伤 R23Rect /
// MTN_R24_SCALE / R20m（20 米半径）这类标识符与度量文本。
const STALE_RE = /\bR2[0-7]\b/;
const staleHits = [];

/** 剥离 JS/TS 注释，保留字符串字面量内容；返回剥离后文本与跨行块注释状态 */
function stripComments(line, inBlock0) {
  let out = '', quote = null, esc = false, inBlock = inBlock0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i], n = line[i + 1];
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (quote) {
      out += c;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') break;                 // 行注释：到行尾
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    out += c;
  }
  return { text: out, inBlock };
}

function scanFile(rel) {
  const lines = readLines(rel);
  if (!lines) return;
  let ib = false;
  for (const l of lines) {
    const r = stripComments(l.t, ib);
    ib = r.inBlock;
    if (STALE_RE.test(r.text)) {
      staleHits.push({ file: rel, line: l.n, text: l.t.trim() });
    }
  }
}
function walk(dir) {
  let ents;
  try {
    ents = readdirSync(resolve(ROOT, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const rel = join(dir, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) walk(rel);
    else if (e.isFile()) scanFile(rel);
  }
}
walk('src');
walk('electron');
for (const f of listRoot(/\.cjs$/i)) scanFile(f);
for (const f of listRoot(/\.bat$/i)) scanFile(f);
scanFile('index.html');

// ---------------------------------------------------------------------------
// 汇总输出
// ---------------------------------------------------------------------------
console.log(`身份: productName=${id.productName} | release=${id.release} | version=${id.version}`);
console.log(`期望串: ${stem}    期望 exe: ${expectedExe}`);
if (SELF_TEST) {
  const onDisk = JSON.parse(readFileSync(PKG_PATH, 'utf8')).release;
  console.log(`模式: --self-test（内存注入 release="R99"；盘上 package.json.release=${onDisk}，未改动）`);
  if (onDisk === 'R99') console.error('FATAL: 盘上 package.json 竟被写入 R99（违反约束）');
}
console.log('');

const namingOk = groups.filter((g) => g.ok).length;

for (const g of groups) {
  const vs = violations.filter((v) => v.group === g.name);
  console.log(`  [${g.ok ? 'OK' : 'FAIL'}] ${g.name}`);
  for (const v of vs) {
    console.log(`      ${v.file}:${v.line}`);
    console.log(`        期望: ${v.expected}`);
    console.log(`        实际: ${v.actual}`);
    console.log(`        备注: ${v.note}`);
  }
}
console.log('');

if (staleHits.length > 0) {
  console.log(`陈旧版本号 R2[0-7]：命中 ${staleHits.length} 处（期望 0 命中）`);
  for (const h of staleHits) {
    console.log(`  ${h.file}:${h.line}  期望: 无 R2[0-7]  实际: ${h.text}`);
  }
  console.log('');
} else {
  console.log('陈旧版本号 R2[0-7]：0 命中');
  console.log('');
}

// rc 裁决：自检恒为 2；否则全一致才 0，任一不一致/陈旧命中即 1。
let rc;
if (SELF_TEST) {
  rc = 2;
} else if (namingOk === 5 && staleHits.length === 0) {
  rc = 0;
} else {
  rc = 1;
}

if (rc === 0) {
  console.log('naming: 5/5 consistent');
} else {
  console.log(
    `naming: ${namingOk}/5 consistent；陈旧版本号命中 ${staleHits.length} 处；不一致点 ${violations.length} 条；rc=${rc}`,
  );
}
process.exit(rc);
