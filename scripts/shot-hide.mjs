/** 定点截图 + 可隐藏指定名字前缀的网格：node scripts/shot-hide.mjs <out> <x y z> <tx ty tz> <namePrefix|-> */
import puppeteer from 'puppeteer-core';
const [out, x, y, z, tx, ty, tz, pref] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--window-size=1600,900','--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto(process.env.PREVIEW_URL||'http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));
// 支持 poi：第 8 个参数为 poi key 时改用 teleport，机位由游戏自己算
let hide = pref || '-';
if (pref && pref.startsWith('poi:')) {
  const [key, hp] = pref.slice(4).split('|');
  hide = hp || '-';
  await p.evaluate((k) => window.__qingming.world.teleport(k), key);
  await new Promise(r=>setTimeout(r,1500));
}
const n = await p.evaluate(([px,py,pz,ax,ay,az,prefix]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(px,py,pz);
  e.lookTarget.set(ax,ay,az);
  const dx=ax-px, dy=ay-py, dz=az-pz, d=Math.max(1,Math.hypot(dx,dy,dz));
  e.yaw = Math.atan2(-dx,-dz); e.pitch = Math.asin(dy/d);
  let hidden = 0;
  if (prefix === 'nobloom') { e.bloomPass.enabled = false; return 1; }
  if (prefix === 'nodome') {
    let n = 0;
    e.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry; if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if ((g.boundingSphere?.radius ?? 0) > 40000) { o.visible = false; n++; }
    });
    return n;
  }
  if (prefix === 'nohaze') {
    let n = 0;
    e.scene.traverse((o) => { const m = o.material; if (o.isMesh && m && m.name === 'hazeMat') { o.visible = false; n++; } });
    return n;
  }
  if (prefix === 'nosky') {
    // 藏掉地平霾环（material.name==='hazeMat'）与穹顶（几何半径>40000）
    let n = 0;
    e.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if ((m && m.name === 'hazeMat') || (g.boundingSphere?.radius ?? 0) > 40000) { o.visible = false; n++; }
    });
    return n;
  }
  if (prefix === 'nofog') { e.scene.fog = null; return 1; }
  if (prefix === 'noenv') { e.scene.environment = null; return 1; }
  if (prefix === 'noshadow') { e.renderer.shadowMap.enabled = false; return 1; }
  if (prefix === 'nopbr') {
    // 验证假设：白斑来自 PBR 掠射角镜面（金属度/清漆 + envMap）
    const seen = new Set();
    e.scene.traverse((o) => {
      const m = o.material;
      if (!m || seen.has(m)) return;
      seen.add(m);
      if ('metalness' in m) m.metalness = 0;
      if ('clearcoat' in m) m.clearcoat = 0;
      if ('sheen' in m) m.sheen = 0;
      if ('envMapIntensity' in m) m.envMapIntensity = 0.05;
      if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.8);
      m.needsUpdate = true;
    });
    return seen.size;
  }
  if (prefix && prefix !== '-') {
    const list = prefix.split(',');
    e.scene.traverse((o) => {
      if (!o.name || !o.visible) return;
      if (list.some((q) => o.name.startsWith(q))) { o.visible = false; hidden++; }
    });
  }
  return { hidden, triAfter: e.renderer.info.render.triangles };
}, [Number(x),Number(y),Number(z),Number(tx),Number(ty),Number(tz), hide]);
await new Promise(r=>setTimeout(r,1500));
const tri2 = await p.evaluate(()=>window.__qingming.engine.renderer.info.render.triangles);
await p.screenshot({ path: out });
await b.close();
console.log('hidden', JSON.stringify(n), 'tri_after', tri2, out);
