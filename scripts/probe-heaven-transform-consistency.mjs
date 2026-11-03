/**
 * probe-heaven-transform-consistency.mjs —— 凌霄二次放大「只有一份」的静态机检（纯 Node）。
 *
 * 背景：`palace.ts`（室内点光换算）与 `expansion.ts`（几何放大）各写过一份凌霄选区常量，
 * 2026-11-03 实测**阈值不一致**：palace 用 233、expansion 用 230（同一 pre-lift 口径）。
 * 差 3m 的选区 ⇒ 落在 [230,233) 的构件「几何被放大、灯没被放大」，最多错位 2.7273×3 ≈ 8m。
 * 已统一到 `src/sky/heavenFrame.ts`。
 *
 * 判据（全部为静态文本/常量检查，不做运行时几何比对）：
 *   A1  heavenFrame 导出 LINGXIAO_SCALE / LINGXIAO_ANCHOR_PRESCALE / LINGXIAO_HALF_X|Z / LINGXIAO_Y_MIN_PRESCALE
 *   A2  palace.ts 与 expansion.ts 都从 './heavenFrame' import 上述名字
 *   A3  两个文件里**不再出现**字面量 `2.7273`
 *   A4  两个文件里**不再出现**把选区下界写成字面量（`LX_YMIN = 233` / `LINGXIAO_Y_MIN = 230 + …`）
 *
 * 诚实边界：本门只证明「常量单源、没有手抄副本」，不证明运行时变换真的逐值一致
 * （后者需要导出 skyLightWorld 做数值对比，属下一步）。
 *
 * 用法：node scripts/probe-heaven-transform-consistency.mjs
 * 退出码 0=PASS / 1=BLOCK / 2=用法错误
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const F = {
  frame: resolve(ROOT, 'src/sky/heavenFrame.ts'),
  palace: resolve(ROOT, 'src/sky/palace.ts'),
  expansion: resolve(ROOT, 'src/sky/expansion.ts'),
};

for (const [k, p] of Object.entries(F)) {
  if (!existsSync(p)) {
    console.error(`USAGE_ERROR: 找不到 ${k} -> ${p}`);
    process.exit(2);
  }
}

const frame = readFileSync(F.frame, 'utf8');
const palace = readFileSync(F.palace, 'utf8');
const expansion = readFileSync(F.expansion, 'utf8');

const REQ = ['LINGXIAO_SCALE', 'LINGXIAO_ANCHOR_PRESCALE', 'LINGXIAO_HALF_X', 'LINGXIAO_HALF_Z', 'LINGXIAO_Y_MIN_PRESCALE'];

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const palaceCode = stripComments(palace);
const expansionCode = stripComments(expansion);

const A1 = REQ.every((n) => new RegExp(`export const ${n}\\b`).test(frame));
const importHas = (src, names) => {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/heavenFrame'/);
  if (!m) return false;
  const got = m[1].split(',').map((s) => s.trim());
  return names.every((n) => got.includes(n));
};
const A2 = importHas(palace, REQ) && importHas(expansion, REQ);
const A3 = !/2\.7273/.test(palaceCode) && !/2\.7273/.test(expansionCode);
const A4 =
  !/LX_YMIN\s*=\s*\d/.test(palaceCode) &&
  !/LINGXIAO_Y_MIN\s*=\s*\d+\s*\+/.test(expansionCode) &&
  !/LINGXIAO_ANCHOR\s*=\s*\{\s*x:\s*0,\s*y:\s*233/.test(expansionCode);

console.log('A1 heavenFrame 导出 5 个常量              ' + (A1 ? 'PASS' : 'FAIL'));
console.log('A2 两个文件都从 heavenFrame import        ' + (A2 ? 'PASS' : 'FAIL'));
console.log('A3 两文件无字面量 2.7273                  ' + (A3 ? 'PASS' : 'FAIL'));
console.log('A4 两文件无手抄的选区下界                 ' + (A4 ? 'PASS' : 'FAIL'));

if (!A1) console.log('  ← 缺: ' + REQ.filter((n) => !new RegExp(`export const ${n}\\b`).test(frame)).join(', '));
if (!A2) {
  console.log('  palace  import 齐全: ' + importHas(palace, REQ));
  console.log('  expansion import 齐全: ' + importHas(expansion, REQ));
}

const ok = A1 && A2 && A3 && A4;
console.log(ok ? 'RESULT=PASS' : 'RESULT=BLOCK');
console.log('备注：本门是静态常量检查，不替代运行时逐值比对。');
process.exit(ok ? 0 : 1);
