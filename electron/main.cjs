const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    title: '赛博上河 · NEON BIANJING',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.on('did-finish-load', () => console.log('[electron] page loaded OK'));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[electron] load FAILED', code, desc));
  process.on('exit', () => console.log('[electron] exiting'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
