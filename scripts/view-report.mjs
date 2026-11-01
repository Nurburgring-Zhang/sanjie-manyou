/**
 * 三视角出图的机器复核：对 screenshots/three-view/*.png 逐张算亮度分布，
 * 标出「过曝（p95 ≥ 235 且面积占比高）」「死黑（p50 < 28）」两类问题，
 * 避免只看缩略图漏掉整片发白/发黑。
 * 用法：node scripts/view-report.mjs [dir] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || inter !== 0) throw new Error('unsupported png');
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (!ch) throw new Error('unsupported color type');
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

const dir = process.argv[2] ?? 'screenshots/three-view';
const asJson = process.argv.includes('--json');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const rows = [];
for (const f of files) {
  const img = decodePng(fs.readFileSync(path.join(dir, f)));
  const n = img.w * img.h;
  let sum = 0, clip = 0, dark = 0;
  const lums = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += img.ch) {
    const r = img.data[j], g = img.data[j + 1] ?? r, b = img.data[j + 2] ?? r;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lums[i] = l; sum += l;
    if (l >= 235) clip++;
    if (l <= 12) dark++;
  }
  const sorted = Array.from(lums).sort((a, b) => a - b);
  const q = (p) => Math.round(sorted[Math.min(n - 1, Math.floor(p * n))]);
  const mean = Math.round(sum / n);
  const clipPct = +((clip / n) * 100).toFixed(2);
  const darkPct = +((dark / n) * 100).toFixed(2);
  const flags = [];
  if (clipPct > 4) flags.push('OVEREXPOSED');
  else if (q(0.5) > 155) flags.push('WASHED');   // 整屏发白：中位数高说明"没有暗部层次"
  if (mean < 30) flags.push('TOO_DARK');
  if (q(0.95) - q(0.05) < 25) flags.push('FLAT');
  rows.push({ file: f, mean, p05: q(0.05), p50: q(0.5), p95: q(0.95), clipPct, darkPct, flags });
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  console.log('file'.padEnd(28), 'mean  p05  p50  p95  clip%  dark%  flags');
  for (const r of rows) {
    console.log(
      r.file.padEnd(28),
      String(r.mean).padStart(4), String(r.p05).padStart(4), String(r.p50).padStart(4), String(r.p95).padStart(4),
      String(r.clipPct).padStart(6), String(r.darkPct).padStart(6), ' ', r.flags.join(',') || '-',
    );
  }
  const bad = rows.filter((r) => r.flags.length);
  console.log(`\n受检 ${rows.length} 张，其中 ${bad.length} 张有标记。`);
}
