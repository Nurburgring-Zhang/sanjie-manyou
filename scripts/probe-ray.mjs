/** 屏幕像素拾取：node scripts/probe-ray.mjs <x> <y> <camX camY camZ> <tx ty tz> —— 打印该像素命中的网格与材质 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const [sx, sy, cx, cy, cz, tx, ty, tz] = process.argv.slice(2).map(Number);
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--window-size=1600,900','--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto(process.env.PREVIEW_URL||'http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));
const res = await p.evaluate(([px, py, camx, camy, camz, lx, ly, lz]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(camx, camy, camz);
  e.lookTarget.set(lx, ly, lz);
  const dx = lx - camx, dy = ly - camy, dz = lz - camz;
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / d);
  e.camera.updateMatrixWorld(true);
  const ndc = { x: (px / 1600) * 2 - 1, y: -(py / 900) * 2 + 1 };
  const out = [];
  // three 由引擎带入，这里用 camera 自带的 raycast 依赖之外的构造：从投影反算方向
  const v = e.camera.position.clone();
  const dir = (() => {
    const m = e.camera.projectionMatrixInverse;
    const p2 = { x: ndc.x, y: ndc.y, z: 0.5 };
    const vec = new (e.camera.position.constructor)(p2.x, p2.y, p2.z).applyMatrix4(m);
    return vec.unproject ? vec : vec;
  })();
  void v; void dir;
  return { ok: true, need: 'three' };
}, [sx, sy, cx, cy, cz, tx, ty, tz]);
console.log(JSON.stringify(res));
await b.close();
