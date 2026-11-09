/**
 * R21 一次性几何诊断：定位峰顶橙棕方块 / 中线白条列属于哪个合批 mesh、包围盒多大。
 * 单 browser / 单 page / finally 显式 close。只读，不改任何源码或 dist。
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:5176/';
const EDGE = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2600));
  await page.evaluate(() => { try { window.__qingming.world.teleport('countryside'); } catch (e) { /* ignore */ } });
  await new Promise((r) => setTimeout(r, 600));

  const out = await page.evaluate(() => {
    const q = window.__qingming;
    const meshes = [];
    // 泰山峰顶 ROI：画面中央那座山
    const X0 = 13600, X1 = 14600, Z0 = -6600, Z1 = -5400;
    const YMIN = 1650;
    const stat = () => ({ n: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
    const put = (s, x, y, z) => {
      s.n++;
      s.min[0] = Math.min(s.min[0], x); s.min[1] = Math.min(s.min[1], y); s.min[2] = Math.min(s.min[2], z);
      s.max[0] = Math.max(s.max[0], x); s.max[1] = Math.max(s.max[1], y); s.max[2] = Math.max(s.max[2], z);
    };
    q.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pos = g.attributes.position, col = g.attributes.color;
      const rec = { name: o.name || '(anon)', mat: o.material?.type, vcount: pos?.count ?? 0,
        hasColor: !!col, orange: stat(), white: stat(), hiAll: stat(), ochreN: 0 };
      if (col && pos) {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (x < X0 || x > X1 || z < Z0 || z > Z1) continue;
          const r = col.getX(i), gg = col.getY(i), b = col.getZ(i);
          // 橙棕/赭黄：红高、绿中、蓝低（线性空间）
          const isOrange = r > 0.38 && gg > 0.12 && gg < 0.55 && b < 0.24 && r > gg * 1.35;
          // 亮白/浅灰：三通道接近且偏高
          const isWhite = r > 0.45 && gg > 0.45 && b > 0.40 && Math.max(r, gg, b) - Math.min(r, gg, b) < 0.18;
          if (y > YMIN) {
            put(rec.hiAll, x, y, z);
            if (isOrange) { put(rec.orange, x, y, z); rec.ochreN++; }
            if (isWhite) put(rec.white, x, y, z);
          }
        }
      }
      meshes.push(rec);
    });
    const r3 = (a) => a.map((v) => +v.toFixed(0));
    return meshes.filter((m) => m.hiAll.n > 0).map((m) => ({
      name: m.name, mat: m.mat, vcount: m.vcount, hasColor: m.hasColor,
      hiAllN: m.hiAll.n, hiAllBB: m.hiAll.n ? [r3(m.hiAll.min), r3(m.hiAll.max)] : null,
      orangeN: m.orange.n, orangeBB: m.orange.n ? [r3(m.orange.min), r3(m.orange.max)] : null,
      whiteN: m.white.n, whiteBB: m.white.n ? [r3(m.white.min), r3(m.white.max)] : null,
    }));
  });
  console.log(JSON.stringify(out, null, 2));
} finally {
  if (browser) await browser.close();
  console.log('BROWSER_CLOSED: YES');
}
