@echo off
chcp 65001 >nul
title 赛博上河 · NEON BIANJING
cd /d "%~dp0"
echo ================================================
echo   赛博上河 · NEON BIANJING
echo   正在启动本地服务器...
echo ================================================
if not exist dist\index.html (
  echo 首次运行需要构建，请先执行 npm install && npm run build
  pause
  exit /b
)
start "" http://localhost:4173/
npx vite preview --port 4173
