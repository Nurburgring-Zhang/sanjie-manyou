import { defineConfig, type Plugin } from 'vite';
// FIX-007 R2 / QA-005：身份唯一真相源 = package.json，经 scripts/lib/identity.mjs 派生。
// @ts-ignore 零依赖 ESM 构建期模块，不进 tsconfig include；由 check-naming.mjs 守卫一致性
import { constantsForVite, loadIdentity } from './scripts/lib/identity.mjs';

/**
 * P0-8 / R28：打包态 CSP 注入（仅 build——dev server 不注入，HMR/探针不受影响）。
 *
 * 为什么放这里而不是 index.html meta：connect-src 需要两套口径——
 *   dev（vite dev server）要放行 localhost http+ws（HMR、探针）；
 *   打包（file:// 页面）R24~R26 用 connect-src 'none'，因为实测 file:// 页面 'self'
 *   会把 file:// 也视为同源放行，fetch('file:///C:/Windows/win.ini') 能读出真实内容
 *   （P0-8 探针 n3 实锤 LEN=92）。
 *
 * R28 真整改：内置 Agent 现在支持「可配置 API 的真实联网检索」（wishResearch.ts 的
 * brave/serper/bing/custom/webpage 端点），'none' 会把所有 https 请求在浏览器层硬阻断
 * ——实机日志：`Refused to connect because it violates ... connect-src 'none'`，
 * 检索状态被如实记成 cors，功能等于没有。因此改为显式放行 http/https/ws/wss **scheme**，
 * 但绝不放行 'self' 也绝不放行 file: —— P0-8 要防的 file:// 本地文件越权读取依旧被拦
 * （file: 不在白名单里），安全目标不变，只是允许 Agent 按配置访问外网检索端点。
 * 默认 research.enabled=false 时不发任何请求；启用后仅访问用户配置的端点。
 * script-src 保留 'unsafe-inline'（index.html 的 __errs 内联段需要）——残余风险
 * 记账：需先存在 HTML 注入点才可利用；升级路径=构建期移除内联段并注入 hash。
 */
const STRICT_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src http: https: ws: wss:; worker-src 'self' blob:";

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

/** FIX-007 R2：构建期把 identity.title 注入 <title>，并注入 __APP_IDENTITY__ 供 ui.ts 使用 */
function injectIdentityTitle(): Plugin {
  return {
    name: 'r29-identity-title',
    transformIndexHtml(html) {
      const title = String(loadIdentity().title);
      return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    },
  };
}

export default defineConfig({
  base: './',
  define: constantsForVite(),
  build: { chunkSizeWarningLimit: 1600, target: 'es2022' },
  server: { port: 5173, strictPort: false },
  plugins: [injectCspForElectron(), injectIdentityTitle()],
});
