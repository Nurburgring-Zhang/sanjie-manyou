/** 阴影预算验证：视锥必须裁到 ≤160m 且 far ≤800；同帧 calls 不得反弹 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width:1280, height:720 });
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,2000));
const r = await p.evaluate(() => {
  const e = window.__qingming.engine;
  let sun = null;
  e.scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) sun = o; });
  const c = sun.shadow.camera;
  return { left: c.left, right: c.right, far: c.far, map: sun.shadow.mapSize.x, calls: e.renderer.info.render.calls };
});
const span = Math.max(Math.abs(r.left), Math.abs(r.right));
console.log(JSON.stringify({ ...r, span, withinBudget: span <= 160 && r.far <= 800, callsOk: r.calls <= 650 }));
await b.close();
