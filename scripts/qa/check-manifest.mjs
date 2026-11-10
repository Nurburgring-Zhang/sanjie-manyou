/**
 * QA-007 R3：静态扫 tests/ 与 scripts/ 中 readFile/readFileSync 读取的 artifacts 路径字面量
 * → 与 artifacts/MANIFEST.json 对账，未登记 → rc=1。
 *
 * 扫描规则（确定、可复现，与 MANIFEST 自洽）：
 *  - 遍历 tests/** 与 scripts/** 下 .mjs/.js/.cjs/.ts；
 *  - 仅当文件文本含 readFile( 或 readFileSync( 调用时，收集该文件里形如
 *    'artifacts/<...>.<json|md|txt|log>' 的静态字符串字面量（运行时动态拼接路径不在此列）；
 *  - 规范化为相对 artifacts/ 的路径，与 MANIFEST.artifacts[].path 比对；
 *  - 扫描器自身（本文件）跳过：它读取 MANIFEST 属工具运行行为，且 MANIFEST.json 已登记，
 *    跳过可避免把扫描器实现里的正则字面量误判为消费者。
 *  - 同时校验 MANIFEST：state 三态合法、regenerable 必有 generator 且文件存在、
 *    external-skip 必有 skipGuard。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SELF = path.resolve(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'artifacts', 'MANIFEST.json');
const EXTS = new Set(['.mjs', '.js', '.cjs', '.ts']);
const LEGAL_STATES = new Set(['shipped+regenerable', 'shipped', 'external-skip']);
const LITERAL_RE = /['"`](artifacts\/[^'"`\n]+?\.(?:json|md|txt|log))['"`]/g;
const norm = (p) => String(p).replace(/^artifacts\//, '').replace(/\\/g, '/');

function collect(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.isFile() && EXTS.has(path.extname(e.name))) out.push(p);
  }
}

function scanConsumers() {
  const files = [];
  collect(path.join(ROOT, 'tests'), files);
  collect(path.join(ROOT, 'scripts'), files);
  files.sort();
  const found = new Map(); // normPath -> Set<consumerRel>
  for (const f of files) {
    if (path.resolve(f) === SELF) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (!/\breadFile(?:Sync)?\s*\(/.test(text)) continue;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    for (const m of text.matchAll(LITERAL_RE)) {
      const n = norm(m[1]);
      if (!found.has(n)) found.set(n, new Set());
      found.get(n).add(rel);
    }
  }
  return found;
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('FATAL: artifacts/MANIFEST.json 缺失');
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const registered = new Map();
  const problems = [];
  for (const e of entries) {
    if (!LEGAL_STATES.has(e.state)) problems.push(`state 非法: ${e.path} -> ${e.state}`);
    const n = norm(e.path);
    if (registered.has(n)) problems.push(`重复登记: ${e.path}`);
    registered.set(n, e);
    if (e.state === 'shipped+regenerable') {
      if (!e.generator) problems.push(`regenerable 缺 generator: ${e.path}`);
      else if (!fs.existsSync(path.join(ROOT, e.generator))) problems.push(`generator 文件不存在: ${e.generator}`);
    }
    if (e.state === 'external-skip' && !e.skipGuard) problems.push(`external-skip 缺 skipGuard: ${e.path}`);
  }
  const consumers = scanConsumers();
  const unregistered = [];
  for (const [n, files] of [...consumers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!registered.has(n)) unregistered.push({ n, files: [...files].sort() });
  }
  console.log(`check-manifest: consumers=${consumers.size} entries=${entries.length} 未登记=${unregistered.length} 违规=${problems.length}`);
  for (const u of unregistered) console.error(`未登记: artifacts/${u.n}  <- ${u.files.join(', ')}`);
  for (const p of problems) console.error(`MANIFEST 违规: ${p}`);
  if (unregistered.length || problems.length) {
    console.error('check-manifest: FAIL');
    process.exit(1);
  }
  console.log('check-manifest: PASS 0 未登记 / 0 违规');
}

main();
