/** 场景清单：列出 Points / InstancedMesh 与自发光大件，用于定位「画面上的爆白/白块」 */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--window-size=1200,700','--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(process.env.PREVIEW_URL||'http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));
const rows = await p.evaluate(() => {
  const out = [];
  window.__qingming.engine.scene.traverse((o) => {
    if (!o.name) return;
    const t = o.type;
    if (t !== 'Points' && t !== 'InstancedMesh' && t !== 'Sprite' && t !== 'Mesh') return;
    const m = o.material || {};
    out.push({
      n: o.name, t,
      count: o.geometry?.attributes?.position?.count ?? 0,
      inst: o.count ?? 0,
      tri: Math.round((o.geometry?.attributes?.position?.count ?? 0) / 3),
      color: m.color ? '#' + m.color.getHexString() : '-',
      mat: m.type,
      size: m.size ?? null, att: m.sizeAttenuation ?? null,
      op: m.opacity, tm: m.toneMapped, transparent: m.transparent,
      y: +(o.position?.y ?? 0).toFixed(0),
    });
  });
  return out;
});
// 按名字前缀聚类（去掉尾部 _数字）后按三角面排序，先看「谁占了画面」
const agg = new Map();
for (const r of rows) {
  const k = r.n.replace(/_\d+$/, '');
  const a = agg.get(k) || { k, n: 0, tri: 0, type: r.t, mat: r.mat, color: r.color };
  a.n++; a.tri += r.tri || 0; agg.set(k, a);
}
const list = [...agg.values()].sort((a, b) => b.tri - a.tri);
for (const a of list.slice(0, 26)) console.log(JSON.stringify(a));
await b.close();
