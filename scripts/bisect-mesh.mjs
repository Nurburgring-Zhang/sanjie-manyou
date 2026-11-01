/**
 * 白斑逐网格二分：固定机位，逐次只隐藏一个网格，比对同一块裁剪区的平均亮度。
 * 亮度明显下降者即为「画面白斑」的来源。一次加载、N 次截图，比逐次重启快一个数量级。
 * 用法：node scripts/bisect-mesh.mjs [x y z tx ty tz]
 */
import puppeteer from 'puppeteer-core';
import zlib from 'node:zlib';

function decodePng(buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += len + 12;
  }
  if (bd !== 8 || inter !== 0) throw new Error('unsupported png');
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const args = process.argv.slice(2).map(Number);
const CAM = args.length === 6 ? args : [1180, 26, 1180, 1230, 6, 1230];
const CLIP = { x: 1150, y: 150, width: 420, height: 320 };

const b = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true, args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));

const names = await p.evaluate(([px, py, pz, tx, ty, tz]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(px, py, pz);
  e.lookTarget.set(tx, ty, tz);
  const dx = tx - px, dy = ty - py, dz = tz - pz, d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz); e.pitch = Math.asin(dy / d);
  const out = [];
  e.scene.traverse((o) => { if (o.isMesh && o.name) out.push(o.name); });
  return out;
}, CAM);
console.log('meshes', names.length);

const lum = async () => {
  const buf = Buffer.from(await p.screenshot({ clip: CLIP }));
  const { ch, data } = decodePng(buf);
  let s = 0;
  for (let i = 0; i < data.length; i += ch) s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return s / (data.length / ch);
};

const setVisible = (name, v) => p.evaluate(([n, vv]) => {
  let hit = 0;
  window.__qingming.engine.scene.traverse((o) => { if (o.name === n) { o.visible = vv; hit++; } });
  return hit;
}, [name, v]);

await new Promise((r) => setTimeout(r, 900));
const base = await lum();
console.log('BASE_LUM', base.toFixed(2));
const rows = [];
for (const n of names) {
  if (!/^city_|^infill_|^court_|^ward_/.test(n)) continue;
  await setVisible(n, false);
  await new Promise((r) => setTimeout(r, 260));
  const v = await lum();
  await setVisible(n, true);
  rows.push({ n, drop: +(base - v).toFixed(2) });
}
rows.sort((a, b2) => b2.drop - a.drop);
console.log('TOP_DROP');
for (const r of rows.slice(0, 12)) console.log(r.drop, r.n);
await b.close();
