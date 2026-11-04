// ============================================================================
// preload（P0-8）· 沙箱内最小桥：contextBridge 只暴露三条白名单 IPC。
// 纪律（Electron 安全清单）：不暴露 ipcRenderer 本体、不暴露 fs/net 原语、
// 通道名固定、参数与返回值全部可结构化克隆。
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sanjieDesktop', {
  /** 诊断：应用/电子版本 */
  getVersion: () => ipcRenderer.invoke('app:version'),
  /** 受控退出（崩溃恢复 UI 用）：走主进程 win.close() 的优雅关闭 */
  requestQuit: () => ipcRenderer.invoke('window:close'),
  /** 受控外链：仅 https 且域名在主进程白名单内才会 openExternal */
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
