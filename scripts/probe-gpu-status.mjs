/**
 * GPU 状态探针（审计 F4 / 联网检索发现 W1 的工程化）。
 *
 * 为什么需要它：打包态 frameP95=58ms 与 dev 25ms 的差异，检索给出的头号嫌疑不是代码，
 * 而是「GPU 进程不可用 → SwiftShader 软渲染回退」「驱动电源管理降频」「Defender 重扫」。
 * 在归因代码之前必须先排除环境伪影：本探针读真实渲染后端字符串与 WebGL2/浮点纹理能力，
 * 任何非硬件后端（SwiftShader / llvmpipe / Basic Render）直接 BLOCK。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-gpu-status.mjs      # dev 抽查
 *   PROBE_URL=file:///…/release-vNN/win-unpacked/resources/app.asar 环境下同用法（打包态核）
 * 退出码：0 = 硬件后端；1 = 软渲染回退或环境失败（打包态流水线把它当红灯）。
 * 输出：artifacts/gpu-status.json + 控制台摘要。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.GPU_OUT || path.resolve('artifacts/gpu-status.json');
const SOFT = /swiftshader|llvmpipe|softpipe|basic\s*render|angle\s*\((?:google|microsoft).*software/i;

let browser = null;
let code = 2;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-renderer-backgrounding'],
    protocolTimeout: 240000,
  });
  const page = await browser.newPage();
  console.log('[gpu] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000, protocolTimeout: 240000 });
  // dev 页面要等引擎起来；file:// 打包页同理（loading 消失）
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const info = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { fatal: 'WebGL 不可用' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR));
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return {
      vendor,
      renderer,
      webgl2: !!window.WebGL2RenderingContext && !!gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      contextAttributes: gl.getContextAttributes(),
    };
  });

  if (info.fatal) {
    console.error('[gpu] FATAL:', info.fatal);
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, ...info }, null, 1));
    code = 1;
  } else {
    const soft = SOFT.test(info.renderer) || SOFT.test(info.vendor);
    const verdict = soft ? 'SOFT_FALLBACK' : 'HARDWARE';
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, verdict, ...info }, null, 1));
    console.log('[gpu] vendor  :', info.vendor);
    console.log('[gpu] renderer:', info.renderer);
    console.log('[gpu] webgl2  :', info.webgl2, '| maxTexture:', info.maxTexture);
    console.log('[gpu] VERDICT :', verdict);
    code = soft ? 1 : 0;
  }
} catch (err) {
  console.error('[gpu] FAILED:', String(err).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
