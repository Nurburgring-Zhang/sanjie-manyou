/**
 * FIX-001 R4：src 树摘要（单一实现，供 build-scene-attribution.mjs 与 vitest 测试共用）。
 *
 * 算法（写死，勿改）：sha256(按路径排序的全部 src 目录下 .ts 文件内容拼接)
 *   - 路径按相对 root 的 POSIX 风格字典序排序；
 *   - 仅拼接文件内容（不含路径、不含分隔符），零第三方依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function srcTreeSha(root) {
  const srcDir = path.join(root, 'src');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.ts')) files.push(p);
    }
  };
  if (fs.existsSync(srcDir)) walk(srcDir);
  const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
  files.sort((a, b) => {
    const ra = rel(a), rb = rel(b);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(fs.readFileSync(f));
  return h.digest('hex');
}
