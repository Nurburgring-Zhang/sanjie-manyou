/**
 * QA / FIX-005 R7 / QA-006 R2 共用：静态 import 图。
 * 零第三方依赖，Node >= 20，ESM。
 *
 * - 根：src/main.ts + index.html 的 <script src> + electron/main.cjs 的 require
 * - 边：静态 import / export from / 动态 import() / new Worker(new URL(...))
 * - 只处理相对说明符；bare specifier（three 等）不计入图
 */
import fs from 'node:fs';
import path from 'node:path';

const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];

/** 列出目录下所有源码文件（相对 root 的 posix 路径） */
export function walkSource(root, sub = 'src') {
  const base = path.join(root, sub);
  if (!fs.existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        out.push(path.relative(root, p).split(path.sep).join('/'));
      }
    }
  };
  walk(base);
  return out.sort();
}

/** 从一个文件文本里抽出所有相对说明符 */
export function specifiers(text) {
  const out = new Set();
  const pats = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bnew\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /<script[^>]+src=['"]([^'"]+)['"]/g,
  ];
  for (const re of pats) for (const m of text.matchAll(re)) {
    const s = m[1];
    if (s.startsWith('.') || s.startsWith('/')) out.add(s);
  }
  return [...out];
}

/** 把说明符解析成 root 相对路径；找不到返回 null */
export function resolveSpec(root, fromFile, spec) {
  let p = spec.startsWith('/')
    ? path.join(root, spec.replace(/^\//, ''))
    : path.resolve(path.dirname(path.join(root, fromFile)), spec);
  const candidates = [p, ...EXTS.map((e) => p + e), ...EXTS.map((e) => path.join(p, 'index' + e))];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return path.relative(root, c).split(path.sep).join('/');
    }
  }
  return null;
}

/** 构建活模块集合与入度表 */
export function buildGraph(root) {
  const srcFiles = walkSource(root);
  const roots = [];
  for (const r of ['src/main.ts', 'index.html', 'electron/main.cjs']) {
    if (fs.existsSync(path.join(root, r))) roots.push(r);
  }
  // 根文件（index.html / electron/main.cjs）参与图，但不计入 src 孤儿统计
  const files = [...new Set([...srcFiles, ...roots])].sort();
  const fileSet = new Set(files);
  const indeg = new Map(files.map((f) => [f, 0]));
  const edges = new Map(files.map((f) => [f, new Set()]));
  // worker 文件：只要被 new Worker(new URL(...)) 引用就会被边带到，无需额外根

  const link = (from, to) => {
    if (!to || !fileSet.has(to) || from === to) return;
    if (edges.get(from).has(to)) return;
    edges.get(from).add(to);
    indeg.set(to, indeg.get(to) + 1);
  };

  for (const f of [...files, ...roots]) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) continue;
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    for (const s of specifiers(text)) {
      const to = resolveSpec(root, f, s);
      link(f, to);
    }
  }

  // BFS from roots
  const live = new Set();
  const queue = roots.filter((r) => fileSet.has(r));
  while (queue.length) {
    const cur = queue.shift();
    if (live.has(cur)) continue;
    live.add(cur);
    for (const nxt of edges.get(cur) ?? []) if (!live.has(nxt)) queue.push(nxt);
  }

  const orphans = srcFiles.filter((f) => !live.has(f) && (indeg.get(f) ?? 0) === 0);
  return { root, srcFiles, files, fileSet, roots, edges, indeg, live, orphans };
}

/** 某个 src 模块是否有「非测试」importer（QA-006 R2） */
export function hasRuntimeImporter(graph, target, root) {
  if (!graph.fileSet.has(target)) return true; // 非 src 模块不审计
  let found = false;
  for (const f of graph.files) {
    if (f.startsWith('tests/')) continue;
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const s of specifiers(text)) {
      if (resolveSpec(root, f, s) === target) { found = true; break; }
    }
    if (found) break;
  }
  return found;
}
