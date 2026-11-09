/** R21 一次性聚类诊断：峰顶橙棕构件按 70m 网格聚类，输出 mesh / 包围盒 / 尺寸 / 颜色，定位大方块来源。 */
import puppeteer from 'puppeteer-core';
const EDGE = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5176/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2600));
  await page.evaluate(() => { try { window.__qingming.world.teleport('countryside'); } catch (e) { /* ignore */ } });
  await new Promise((r) => setTimeout(r, 600));
  const out = await page.evaluate(() => {
    const q = window.__qingming;
    const cells = new Map();
    q.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pos = g.attributes.position, col = g.attributes.color;
      if (!pos || !col) return;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < 13000 || x > 15200 || z < -7200 || z > -4600 || y < 1250) continue;
        const r = col.getX(i), gg = col.getY(i), b = col.getZ(i);
        const orange = r > 0.38 && gg > 0.12 && gg < 0.55 && b < 0.24 && r > gg * 1.35;
        if (!orange) continue;
        const key = `${Math.floor(x / 70)},${Math.floor(z / 70)}`;
        let c = cells.get(key);
        if (!c) { c = { n: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], sr: 0, sg: 0, sb: 0, meshes: new Set() }; cells.set(key, c); }
        c.n++; c.sr += r; c.sg += gg; c.sb += b; c.meshes.add(o.name || '(anon)');
        c.min[0] = Math.min(c.min[0], x); c.min[1] = Math.min(c.min[1], y); c.min[2] = Math.min(c.min[2], z);
        c.max[0] = Math.max(c.max[0], x); c.max[1] = Math.max(c.max[1], y); c.max[2] = Math.max(c.max[2], z);
      }
    });
    const r3 = (a) => a.map((v) => +v.toFixed(0));
    return [...cells.entries()].filter(([, c]) => c.n >= 6).map(([k, c]) => ({
      cell: k, n: c.n, mesh: [...c.meshes].join('|'),
      bb: [r3(c.min), r3(c.max)],
      size: r3([c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]]),
      rgb: [+(c.sr / c.n).toFixed(3), +(c.sg / c.n).toFixed(3), +(c.sb / c.n).toFixed(3)],
    })).sort((a, b) => b.bb[0][1] - a.bb[0][1]);
  });
  console.log(JSON.stringify(out, null, 2));
} finally {
  if (browser) await browser.close();
  console.log('BROWSER_CLOSED: YES');
}
