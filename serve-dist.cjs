/* CyberQingming R22 - zero-dependency static server for dist/
 * No npm install, no vite, no build needed. Requires Node.js >= 18.
 * Run: node serve-dist.cjs   (or double-click START-GAME.bat)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, 'dist');
const START_PORT = 4173;
const MAX_PORT = 4193;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function handle(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_) {
    return send(res, 400, 'Bad request');
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.resolve(ROOT, '.' + rel);
  // Prevent path traversal outside dist/
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found: ' + rel);
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(full).pipe(res);
  });
}

function listen(port) {
  const srv = http.createServer(handle);
  srv.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < MAX_PORT) {
      console.log('Port ' + port + ' in use, trying ' + (port + 1) + ' ...');
      listen(port + 1);
    } else {
      console.error('Cannot start server: ' + e.message);
      process.exitCode = 1;
    }
  });
  srv.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port + '/';
    // Bundle 名从 dist/index.html 动态读取，避免升级后横幅还显示旧版本误导用户。
    let bundle = '(unknown)';
    try {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const m = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
      if (m) bundle = 'assets/' + m[1];
    } catch (_) { /* index.html 已在启动前校验存在 */ }
    console.log('');
    console.log('  CyberQingming R22  -  FULL DELIVERY');
    console.log('  ----------------------------------------');
    console.log('  Game URL : ' + url);
    console.log('  Bundle   : ' + bundle);
    console.log('  Root     : ' + ROOT);
    console.log('  ----------------------------------------');
    console.log('  Keep this window open. Press Ctrl+C to stop.');
    console.log('');
    if (process.platform === 'win32' && !process.env.CYBERQINGMING_NO_OPEN) {
      try {
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      } catch (_) { /* browser auto-open is optional */ }
    }
  });
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('ERROR: dist/index.html not found next to this script.');
  process.exit(1);
}
listen(START_PORT);
