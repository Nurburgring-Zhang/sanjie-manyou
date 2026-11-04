// ============================================================================
// Electron 主进程（P0-8 安全硬化版）
//
// 清单 v3 P0-8：preload + 3 条白名单 IPC + CSP + setWindowOpenHandler + will-navigate 白名单。
// 验收（负样本三全 BLOCK）：外链导航 / window.open / 沙箱内 fetch file://。
//
// 安全基线：contextIsolation=true、nodeIntegration=false、sandbox=true（显式）；
// CSP 经 index.html meta（构建产物同源自隔离；dev 的 ws/http localhost 白名单条目仅影响 dev）。
// 安全探针：SANJIE_SECURITY_PROBE=1 时自动跑负样本并输出 [security] JSON（验收用，无此变量零影响）。
// ============================================================================
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

// ---- IPC 白名单（3 条，全部 handle 式：渲染端只能 invoke，不能自发事件） ----
ipcMain.handle('app:version', () => ({ app: app.getVersion(), electron: process.versions.electron }));

ipcMain.handle('window:close', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.close();
  return true;
});

/** 外链域名白名单：目前只放行本项目 GitHub（未来帮助页/发布页） */
const EXTERNAL_HOSTS = new Set(['github.com', 'www.github.com']);
ipcMain.handle('shell:open-external', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || !EXTERNAL_HOSTS.has(u.hostname)) return { ok: false, reason: 'host-not-allowed' };
    shell.openExternal(u.toString());
    return { ok: true };
  } catch {
    return { ok: false, reason: 'bad-url' };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    title: '赛博上河 · NEON BIANJING',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // P0-8：window.open 一律拒绝（游戏无外开需求；外链走受控 openExternal IPC）
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // P0-8：导航白名单——只允许 file:// 且落在 dist 目录内（本应用文档自身）；其余一律拦
  win.webContents.on('will-navigate', (e, url) => {
    const normalized = decodeURIComponent(url).replace(/\\/g, '/');
    const root = 'file://' + path.join(__dirname, '..', 'dist').replace(/\\/g, '/');
    if (!normalized.startsWith(root)) e.preventDefault();
  });

  // webview 禁用（未使用，防未来注入路径）
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.webContents.on('did-finish-load', () => console.log('[electron] page loaded OK'));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[electron] load FAILED', code, desc));
  process.on('exit', () => console.log('[electron] exiting'));

  // ---- 安全验收探针（SANJIE_SECURITY_PROBE=1 时启用；生产零影响） ----
  if (process.env.SANJIE_SECURITY_PROBE === '1') {
    win.webContents.on('did-finish-load', () => {
      (async () => {
        const results = {};
        try {
          // N1 外链导航：will-navigate 白名单拦截 → 1.2s 后仍是本页
          const before = win.webContents.getURL();
          await win.webContents.executeJavaScript("location.href = 'https://example.com/'; 'nav-attempted'");
          await new Promise((r) => setTimeout(r, 1200));
          results.n1_external_nav_blocked = win.webContents.getURL() === before;
          // N2 window.open：handler deny → 返回 null
          results.n2_window_open_deny = await win.webContents.executeJavaScript(
            "window.open('https://example.com/') === null",
          );
          // N3 沙箱内 fetch file://：CSP connect-src 'self'（file 页 opaque）→ 必须走 catch
          // CORS 失败的 fetch 不 reject，给 opaque response——必须读 body 验证（读出为空=不可泄露）
          results.n3_fetch_file_blocked = await win.webContents.executeJavaScript(
            "fetch('file:///C:/Windows/win.ini').then((r) => r.text()).then((t) => 'LEN=' + t.length + ':' + t.slice(0, 40)).catch((e) => 'CAUGHT:' + String(e).slice(0, 60))",
          );
          // 附加：preload 桥存在；白名单外 openExternal 被拒
          results.p4_preload_bridge = await win.webContents.executeJavaScript(
            "typeof window.sanjieDesktop === 'object' && typeof window.sanjieDesktop.getVersion === 'function'",
          );
          results.p5_open_external_blocked = JSON.stringify(
            await win.webContents.executeJavaScript("window.sanjieDesktop.openExternal('https://example.com/')"),
          );
          console.log('[security]', JSON.stringify(results));
          setTimeout(() => process.exit(0), 300);
        } catch (err) {
          console.log('[security]', JSON.stringify({ error: String(err).slice(0, 200) }));
          setTimeout(() => process.exit(1), 300);
        }
      })();
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
