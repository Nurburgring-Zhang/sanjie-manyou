/**
 * probe-heaven-convention.mjs —— 天宫坐标口径的静态机检（纯 Node，不开浏览器）。
 *
 * 背景：同一类 bug 已连续踩到三次——
 *   ① 天宫窗户被 2.7273× 顶点缩放放大成 7.6m 黑洞
 *   ② 神像/石像只加 `+ HEAVEN_LIFT`、x/z 没乘 2.2，整尊埋进台基（低 21.8m）
 *   ③ 活体神佛演员读 `SkyCenters` 的混合口径，同样低 21.8m
 *   ④ 天宫 POI 只补 `+ HEAVEN_LIFT`，水平偏 96–180m
 * 共同点：位置换算写成「加法」而不是 `heavenY()` / `heavenPoint()`。
 *
 * 判据：
 *   A. `+ HEAVEN_LIFT` 出现在「位置」语境（同行为 set/position/y=/pos/px/pz 等）→ BLOCK
 *   B. 文件用了 `HEAVEN_LIFT` 但没 import `heavenY` / `heavenPoint` → WARN（可能在做非位置用途）
 *
 * 允许的例外（写在 ALLOW 里，必须带理由）：见下方数组。
 *
 * 用法：node scripts/probe-heaven-convention.mjs
 * 退出码：0 = 无 A 类；1 = 有 A 类；2 = 用法错误
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

/** 已知合法用法：文件:行号相对片段 → 理由。空表示一个都不放过。 */
const ALLOW = [
  // heavenFrame.ts 是唯一真相源，它自己就是加法定义
  { file: 'src/sky/heavenFrame.ts', why: '换算定义处' },
  // expansion.ts 的顶点变换是缩放管线本身
  { file: 'src/sky/expansion.ts', why: '缩放管线实现处（不是消费方）' },
];

const POS_HINT = /(\bset\s*\(|\bposition\b|\bpos\b|\.y\s*=|y:\s*|px|pz|\btranslate\b)/;
/**
 * 阈值语境的反向排除：`clamp(x, lo, hi + HEAVEN_LIFT)` / `a < b + HEAVEN_LIFT`
 * 这类是「把抬高后的门槛写出来」，不是坐标换算，属于合法用法。
 */
const THRESHOLD_HINT = /(clamp\(|Math\.(min|max)\(|[<>]=?\s*[^=]|smoothstep)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function main() {
  if (!existsSync(SRC)) {
    console.error('USAGE_ERROR: 找不到 ' + SRC);
    return 2;
  }
  const files = walk(SRC);
  const additive = [];
  const warn = [];

  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (ALLOW.some((a) => a.file === rel)) continue;
    const text = readFileSync(f, 'utf8');
    const lines = text.split(/\r?\n/);
    const hasCanonical = /from ['"].*heavenFrame['"]/.test(text) && /heaven(Y|Point)\b/.test(text);
    let usedBare = false;

    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!L.includes('HEAVEN_LIFT')) continue;
      usedBare = true;
      // 跳过注释行
      const code = L.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (!code.includes('HEAVEN_LIFT')) continue;
      if (/\+\s*HEAVEN_LIFT/.test(code) && POS_HINT.test(code) && !THRESHOLD_HINT.test(code)) {
        additive.push({ rel, line: i + 1, text: L.trim().slice(0, 130) });
      }
    }
    if (usedBare && !hasCanonical) warn.push(rel);
  }

  console.log(`SCANNED=${files.length} files`);
  console.log(`A_ADDITIVE=${additive.length}（位置换算写成 +HEAVEN_LIFT）`);
  for (const a of additive.slice(0, 40)) console.log(`  BLOCK ${a.rel}:${a.line}  ${a.text}`);
  if (additive.length > 40) console.log(`  … 另有 ${additive.length - 40} 条`);
  console.log(`B_NO_CANONICAL_IMPORT=${warn.length}（用了 HEAVEN_LIFT 但没 import heavenY/heavenPoint）`);
  for (const w of warn.slice(0, 20)) console.log(`  WARN  ${w}`);

  const ok = additive.length === 0;
  console.log(ok ? 'RESULT=PASS' : 'RESULT=BLOCK');
  console.log('备注：本门只做静态文本匹配，命中的必须人工判定是否真是位置换算；未命中不等于没问题。');
  return ok ? 0 : 1;
}

process.exit(main());
