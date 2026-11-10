// QA-001 阶段 8 引用本路径；主实现在 scripts/qa/check-deadmodules.mjs（FIX-005 R7）。转发 shim。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'qa/check-deadmodules.mjs');
const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
