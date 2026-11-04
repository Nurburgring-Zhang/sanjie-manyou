import { defineConfig, type Plugin } from 'vite';

/**
 * P0-8：打包态 CSP 注入（仅 build——dev server 不注入，HMR/探针不受影响）。
 *
 * 为什么放这里而不是 index.html meta：connect-src 需要两套口径——
 *   dev（vite dev server）要放行 localhost http+ws（HMR、探针）；
 *   打包（file:// 页面）必须 connect-src 'none'——实测 file:// 页面 'self' 会把
 *   file:// 也视为同源放行，fetch('file:///C:/Windows/win.ini') 能读出真实内容
 *   （P0-8 探针 n3 实锤 LEN=92）。本游戏零联网，'none' 是唯一安全口径。
 * script-src 保留 'unsafe-inline'（index.html 的 __errs 内联段需要）——残余风险
 * 记账：需先存在 HTML 注入点才可利用；升级路径=构建期移除内联段并注入 hash。
 */
const STRICT_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:";

function injectCspForElectron(): Plugin {
  return {
    name: 'p08-electron-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>
  <meta http-equiv="Content-Security-Policy" content="${STRICT_CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1600, target: 'es2022' },
  server: { port: 5173, strictPort: false },
  plugins: [injectCspForElectron()],
});
