// FIX-007 R2 / R4：生成 ROOT/START-GAME.bat（生成物，禁止手维护 exe 名）。
// 字节稳定：固定行数组 + 固定 CRLF + 固定 UTF-8，无时间戳/随机量；重复生成内容完全一致。
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exeName, release, version, productName } from './lib/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'START-GAME.bat');

// exe 名一律从 identity 取，绝不硬编码。
const lines = [
  '@echo off',
  'chcp 65001 >nul',
  `title ${productName} · ${release} · v${version}`,
  'cd /d "%~dp0"',
  `set "GAME_EXE=${exeName}"`,
  '',
  'rem ===== 本文件由 scripts/gen-launchers.mjs 生成，禁止手维护 exe 名 =====',
  'if exist "%GAME_EXE%" (',
  '  echo 正在启动 %GAME_EXE% ...',
  '  start "" "%GAME_EXE%"',
  '  exit /b 0',
  ')',
  '',
  'echo ============================================================',
  'echo   [提示] 未找到游戏主程序：%GAME_EXE%',
  'echo.',
  'echo   原因：交付包内缺少这个可执行文件，或它已被改名 / 移到别处。',
  'echo   别担心，不影响游玩 —— 本包附带免安装的本地服务器启动方式：',
  'echo.',
  'echo       node serve-dist.cjs',
  'echo       然后浏览器打开 http://127.0.0.1:4173/',
  'echo       （需先执行 npm install ^&^& npm run build 生成 dist\\ 目录）',
  'echo ============================================================',
  'echo.',
  'set /p RUN="是否现在用 serve-dist.cjs 启动本地服务器？[Y/N] "',
  'if /I not "%RUN%"=="Y" (',
  '  echo   已取消。随时可以手动运行：node serve-dist.cjs',
  '  pause',
  '  exit /b 0',
  ')',
  'where node >nul 2>nul',
  'if errorlevel 1 (',
  '  echo   [错误] 没检测到 Node.js，请先安装 Node.js ^>= 18 再重试。',
  '  pause',
  '  exit /b 1',
  ')',
  'if not exist "dist\\index.html" (',
  '  echo   [错误] 缺少 dist\\index.html，请先执行：npm install ^&^& npm run build',
  '  pause',
  '  exit /b 1',
  ')',
  'start "" http://127.0.0.1:4173/',
  'node serve-dist.cjs',
];

const content = lines.join('\r\n') + '\r\n';
const buf = Buffer.from(content, 'utf8');

let same = false;
if (existsSync(OUT)) {
  same = readFileSync(OUT).equals(buf);
}
writeFileSync(OUT, buf);

console.log(`gen-launchers: ${OUT}`);
console.log(`  exeName = ${exeName}`);
console.log(`  bytes   = ${buf.length}（CRLF / UTF-8）`);
console.log(`  ${same ? '内容与上次一致，字节稳定（未变化）' : '已写入'}`);
