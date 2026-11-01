// 零依赖 PNG 解码 + 像素统计：给"画面到底多黑/多白"一个可复算的数字，
// 避免只靠肉眼判断渲染结果（屋顶是否真的发黑、地面是否真的过曝）。
// 用法：node scripts/png-stats.mjs <png> [x0,y0,x1,y1] ...
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9]; inter = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || inter !== 0) throw new Error(`unsupported png bd=${bd} inter=${inter}`);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (!ch) throw new Error(`unsupported color type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

function region(img, r) {
  const [x0, y0, x1, y1] = r;
  let n = 0, sr = 0, sg = 0, sb = 0;
  let lum = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const rr = img.data[i], gg = img.data[i + 1] ?? rr, bb = img.data[i + 2] ?? rr;
      sr += rr; sg += gg; sb += bb; n++;
      lum.push(0.2126 * rr + 0.7152 * gg + 0.0722 * bb);
    }
  }
  lum.sort((a, b) => a - b);
  const q = (f) => Math.round(lum[Math.min(lum.length - 1, Math.floor(f * lum.length))]);
  return {
    mean: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    lum: Math.round(lum.reduce((a, b) => a + b, 0) / n),
    p05: q(0.05), p50: q(0.5), p95: q(0.95),
  };
}

const [, , file, ...rest] = process.argv;
const img = decodePng(fs.readFileSync(file));
console.log(`# ${file} ${img.w}x${img.h}`);
console.log('ALL', JSON.stringify(region(img, [0, 0, img.w, img.h])));
for (const s of rest) {
  const r = s.split(',').map(Number);
  console.log(s, JSON.stringify(region(img, r)));
}
