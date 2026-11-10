// QA-001 阶段 10 引用本路径；主实现在 scripts/qa/check-gates.mjs（QA-003）。转发 shim。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'qa/check-gates.mjs');
const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
