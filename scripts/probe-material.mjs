/** 材质爆白防线：金属度/清漆/环境反射必须压在阈值下，否则掠射角会整片返白 */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,600));
const r = await p.evaluate(() => {
  const out = {};
  window.__qingming.engine.scene.traverse((o) => {
    const m = o.material;
    if (!m || !o.name?.startsWith('city_')) return;
    const g = o.name.replace(/^city_/, '').replace(/_\d+$/, '');
    if (out[g]) return;
    out[g] = { metalness: m.metalness ?? null, roughness: m.roughness ?? null, clearcoat: m.clearcoat ?? null, env: m.envMapIntensity ?? null, toneMapped: m.toneMapped, map: m.map ? m.map.image?.width ?? -1 : 0 };
  });
  return out;
});
const metal = r.metal ?? {}, ceramic = r.ceramic ?? {};
const leaf = r.leaf ?? {};
console.log(JSON.stringify({ metal, ceramic, leaf, pass: (metal.metalness ?? 0) <= 0.4 && (metal.env ?? 0) <= 0.5 && (ceramic.clearcoat ?? 0) <= 0.6 && (leaf.map ?? 0) > 0 }, null, 1));
await b.close();
