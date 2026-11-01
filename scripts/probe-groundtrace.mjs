/** 地坪归因：在 bridge-top 机位把 ground 台账投影到屏幕，列出落在「深色区块」矩形内的构件 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width:1280, height:720 });
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,1000));
const out = await p.evaluate(() => {
  const e = window.__qingming.engine; e.stopCinema();
  e.camera.position.set(-22.7, 110.7, -32.8); e.lookTarget.set(0, 12, 0);
  const dx = 0 + 22.7, dy = 12 - 110.7, dz = 0 + 32.8, d = Math.hypot(dx, dy, dz);
  e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / d);
  e.camera.updateMatrixWorld(true); e.camera.updateProjectionMatrix();
  const V3 = e.camera.position.constructor;
  const rect = { x0: 600, x1: 1060, y0: 260, y1: 500 }; // 深色区块在 1280×720 里的屏幕范围
  const rows = [];
  for (const t of (window.__groundTrace || [])) {
    const v = new V3(t.x, t.y, t.z).project(e.camera);
    if (v.z < -1 || v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * 1280, sy = (-v.y * 0.5 + 0.5) * 720;
    if (sx < rect.x0 || sx > rect.x1 || sy < rect.y0 || sy > rect.y1) continue;
    rows.push({ ...t, sx: Math.round(sx), sy: Math.round(sy) });
  }
  const bySpan = rows.sort((a, b) => b.span - a.span);
  return { total: (window.__groundTrace || []).length, hit: bySpan.length, top: bySpan.slice(0, 8) };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
