@echo off
chcp 65001 >nul
title 赛博上河 CyberQingming · R29 · v1.2.0
cd /d "%~dp0"
set "GAME_EXE=CyberQingming-R29-1.2.0-x64.exe"

rem ===== 本文件由 scripts/gen-launchers.mjs 生成，禁止手维护 exe 名 =====
if exist "%GAME_EXE%" (
  echo 正在启动 %GAME_EXE% ...
  start "" "%GAME_EXE%"
  exit /b 0
)

echo ============================================================
echo   [提示] 未找到游戏主程序：%GAME_EXE%
echo.
echo   原因：交付包内缺少这个可执行文件，或它已被改名 / 移到别处。
echo   别担心，不影响游玩 —— 本包附带免安装的本地服务器启动方式：
echo.
echo       node serve-dist.cjs
echo       然后浏览器打开 http://127.0.0.1:4173/
echo       （需先执行 npm install ^&^& npm run build 生成 dist\ 目录）
echo ============================================================
echo.
set /p RUN="是否现在用 serve-dist.cjs 启动本地服务器？[Y/N] "
if /I not "%RUN%"=="Y" (
  echo   已取消。随时可以手动运行：node serve-dist.cjs
  pause
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没检测到 Node.js，请先安装 Node.js ^>= 18 再重试。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo   [错误] 缺少 dist\index.html，请先执行：npm install ^&^& npm run build
  pause
  exit /b 1
)
start "" http://127.0.0.1:4173/
node serve-dist.cjs
