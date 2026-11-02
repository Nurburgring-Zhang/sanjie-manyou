// 探针专用 vite 配置：关掉 HMR。
// 仓库里同时有多个 agent 在改 src，HMR 会在截图/取证到一半时整页重载，
// 探针报 "Execution context was destroyed"——不是探针本身的问题。
// 保留文件监听：探针每次重新 goto 时要拿到最新模块（watch 关掉会一直吃旧的 transform 缓存）。
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1600, target: 'es2022' },
  server: { port: 4289, strictPort: true, hmr: false },
});
