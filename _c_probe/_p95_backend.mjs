import puppeteer from 'puppeteer-core';
import { CHROME } from '../scripts/chromePath.mjs';

const EXPR = `(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { ok: false, why: 'no webgl' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    ok: true,
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
})()`;

const CONFIGS = [
  { name: 'headless-default', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] },
  { name: 'headless-d3d11', headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] },
  { name: 'headful-default', headless: false, args: ['--no-sandbox', '--window-size=800,600'] },
];
for (const cfg of CONFIGS) {
  let b;
  try {
    b = await puppeteer.launch({ executablePath: CHROME, headless: cfg.headless, args: cfg.args, protocolTimeout: 60000 });
    const p = await b.newPage();
    await p.goto('data:text/html,<html><body>x</body></html>');
    const r = await p.evaluate(EXPR);
    console.log(cfg.name, JSON.stringify(r));
  } catch (e) {
    console.log(cfg.name, 'ERR', String(e).slice(0, 200));
  } finally { try { await b?.close(); } catch {} }
}
