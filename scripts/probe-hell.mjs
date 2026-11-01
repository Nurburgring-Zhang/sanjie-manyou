/**
 * 地府两项验证：
 *  A) 越走越黑：三个纵深节点的画面平均亮度必须单调下降，最深处「伸手不见五指」（均值 < 45/255）
 *  B) 地府不跑回城里：在奈何桥按住 W 前进 2.5 秒，相机高度必须仍在 y < -100（旧版会瞬移回城）
 */
import puppeteer from 'puppeteer-core';
import zlib from 'node:zlib';
import fs from 'node:fs';

function decodePng(buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    off += len + 12;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride); let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++], row = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b2 = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b2; else if (f === 3) v += (a + b2) >> 1;
      else if (f === 4) { const pa = Math.abs(b2 - c), pb = Math.abs(a - c), pc = Math.abs(a + b2 - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c; }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
const lum = (png) => {
  const { ch, data } = decodePng(png); let s = 0, n = 0;
  for (let i = 0; i < data.length; i += ch * 7) { s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
  return +(s / n).toFixed(1);
};

const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width:1280, height:720 });
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1500));

// A) 同一纵深走廊上的三点采样（换 POI 会同时换几何与灯光，测不出「深度」本身）
const shots = {};
for (const [name, z] of [['z-70', -70], ['z-200', -200], ['z-330', -330]]) {
  await p.evaluate(([zz]) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(0, -242, zz);
    e.lookTarget.set(0, -240, zz - 40);
    e.yaw = 0; e.pitch = 0;
  }, [z]);
  await new Promise(r=>setTimeout(r,1200));
  const file = `screenshots/hell-${name}.png`;
  await p.screenshot({ path: file, clip: { x: 340, y: 110, width: 600, height: 430 } });
  shots[name] = { file, lum: lum(fs.readFileSync(file)) };
}

// B) 地府走两步不跑回城里
await p.evaluate(() => window.__qingming.world.teleport('naihe'));
await new Promise(r=>setTimeout(r,1200));
const before = await p.evaluate(() => ({ y: window.__qingming.engine.camera.position.y }));
await p.keyboard.down('KeyW');
await new Promise(r=>setTimeout(r,2500));
await p.keyboard.up('KeyW');
await new Promise(r=>setTimeout(r,400));
const after = await p.evaluate(() => ({ y: window.__qingming.engine.camera.position.y, py: window.__qingming.world.player.actor.pos.y }));
console.log(JSON.stringify({
  shots,
  monotonicDark: shots['z-70'].lum > shots['z-200'].lum && shots['z-200'].lum > shots['z-330'].lum,
  pitchBlack: shots['z-330'].lum < 45,
  staysInHell: after.y < -100 && after.py < -100,
  before, after,
}, null, 1));
await b.close();
