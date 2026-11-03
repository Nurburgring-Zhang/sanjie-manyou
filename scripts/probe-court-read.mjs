/**
 * B5v2 机检：天宫东西柱列院「远景可读性」——主次 / 收分 / 中轴 / 明度分区。
 *
 * 判据（artifacts 实测口径，改前基线见 artifacts/_B5）：
 *   ① 在 hero 与 court_close 两个机位，把柱列院 ROI（台基底 / 台面 / 柱顶 12 角投影凸包）
 *      按「到形心的归一化半径」切三带：中心 d<0.42 / 中环 0.42–0.72 / 外圈 0.72–1；
 *   ② 三带**两两平均明度差 ≥6**（有主次，不是一块白）；
 *   ③ 每带明度**标准差 ≥8**（带内有层次，不是死平色块）；
 *   ④ 墙体（ROI 整体）**16 级明度带中占比 ≥2% 的档数 ≥6**（汉白玉分级的可读性下限）；
 *   ⑤ 净增三角面 ≤0（`--base-tris` 与本次 staticTris 对账，缺省取本文件记录的门槛）。
 *
 * ROI 来源：palace.ts 建造时写进 `window.__tiangong.roi` 的世界坐标（与建造同源同常量），
 * 本脚本不另抄一份尺寸——台基一改收分，ROI 自动跟随。
 *
 * 退出码：0 = PASS，1 = BLOCK，2 = USAGE_ERROR。
 * 用法：
 *   PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-court-read.mjs
 *   PREVIEW_URL=... node scripts/probe-court-read.mjs --reuse artifacts/_B5   # 只量既有 PNG，不出新图
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';

const URL = process.env.PREVIEW_URL || 'http://localhost:4180/';
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const OUT = argOf('--out', 'artifacts/_B5v2');
const REUSE = argOf('--reuse', null);
const ONLY = (argOf('--views', '') || '').split(',').filter(Boolean);
/** 改前基线 staticTris（B5，2026-11-03 实测）；净增面必须 ≤0 */
const BASE_TRIS = Number(argOf('--base-tris', '0')) || null;

// 与 _multishot.mjs 同机位（任务给定）
const VIEWS = [
  { name: 'hero', p: [300, 2280, -210], t: [0, 2230, 200] },
  { name: 'court_close', p: [-150, 2240, 90], t: [-230, 2228, 190] },
].filter((v) => !ONLY.length || ONLY.includes(v.name));

/** 零依赖 PNG 解码（与 scripts/probe-roof-from-air.mjs 同一口径） */
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

// ---- 凸包（Andrew monotone chain）----
function hullOf(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
const polyArea = (H) => {
  let s = 0;
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
};
/** 极径表：形心 → 各角度到凸包边界的半径（0.5° 一档） */
function radiusTable(H, C, buckets = 720) {
  const R = new Float32Array(buckets);
  const edges = [];
  for (let i = 0; i < H.length; i++) edges.push([H[i], H[(i + 1) % H.length]]);
  for (let b = 0; b < buckets; b++) {
    const th = (b + 0.5) / buckets * Math.PI * 2;
    const dx = Math.cos(th), dy = Math.sin(th);
    let best = 0;
    for (const [p, q] of edges) {
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p[0] - C[0]) * ey - (p[1] - C[1]) * ex) / den;   // 射线参数
      const s = ((p[0] - C[0]) * dy - (p[1] - C[1]) * dx) / den;   // 边参数
      if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
    }
    R[b] = best || 1;
  }
  return R;
}
function inside(H, x, y) {
  let sign = 0;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cr === 0) continue;
    const s = Math.sign(cr);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 300000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1200));
if (!REUSE) mkdirSync(OUT, { recursive: true });

const rows = [];
const overlayJobs = [];
let fail = 0;
const reasons = [];

for (const v of VIEWS) {
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
  await page.evaluate((vv) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(vv.p[0], vv.p[1], vv.p[2]);
    const dx = vv.t[0] - vv.p[0], dy = vv.t[1] - vv.p[1], dz = vv.t[2] - vv.p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
  }, v);
  await new Promise((r) => setTimeout(r, 1200));

  if (!REUSE) await page.screenshot({ path: `${OUT}/${v.name}.png` });

  // 投影 ROI：两院里取屏幕面积大的那一座（court_close 看西院、hero 看东院，不写死）
  const roi = await page.evaluate(() => {
    const { engine, THREE } = window.__qingming;
    const cam = engine.camera;
    cam.updateMatrixWorld(true);
    // project() 用的是 matrixWorldInverse，它由 renderer 在渲染时刷；探针在改相机后立即投影，
    // 必须自己刷一遍，否则拿到上一帧（或初始）的逆矩阵，投出来的坐标是错的。
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const W = window.innerWidth, H = window.innerHeight;
    const proj = (p) => {
      const q = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
      return [(q.x * 0.5 + 0.5) * W, (0.5 - q.y * 0.5) * H, q.z];
    };
    const courts = (window.__tiangong?.roi) ?? [];
    const out = [];
    for (const c of courts) {
      const pts = [...c.base, ...c.deck, ...c.cap].map(proj);
      out.push({ name: c.name, pts, deck: c.deck.map(proj), cap: c.cap.map(proj) });
    }
    let staticTris = 0;
    engine.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const g = o.geometry;
      if (!g) return;
      const tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      staticTris += tri * (o.isInstancedMesh ? o.count : 1);
    });
    return { courts: out, staticTris, W, H };
  });

  if (!roi.courts.length) {
    console.error('[BLOCK] window.__tiangong.roi 缺失——palace.ts 的 ROI 台账没生效');
    fail++;
    continue;
  }
  // 取「可见凸包面积」最大的一座：先和视口求交，避免选中屏幕外的院子
  let best = null;
  for (const c of roi.courts) {
    const H0 = hullOf(c.pts.map((p) => [p[0], p[1]]));
    const vis = H0.filter((p) => p[0] >= 0 && p[0] <= roi.W && p[1] >= 0 && p[1] <= roi.H).length;
    const a = vis >= 2 ? polyArea(H0) * (vis / H0.length) : 0;
    console.log(JSON.stringify({ court: c.name, hullArea: +polyArea(H0).toFixed(0), visiblePts: vis, score: +a.toFixed(0) }));
    if (!best || a > best.score) best = { ...c, hull: H0, score: a };
  }
  if (!best || best.score <= 0) {
    console.error('[BLOCK] 两个柱列院都不在画面内——机位或 ROI 台账不对');
    fail++;
    continue;
  }
  const H = best.hull;
  const C = H.reduce((s, p) => [s[0] + p[0] / H.length, s[1] + p[1] / H.length], [0, 0]);
  const R = radiusTable(H, C);

  const img = decodePng(readFileSync(`${REUSE ?? OUT}/${v.name}.png`));
  const x0 = Math.max(0, Math.floor(Math.min(...H.map((p) => p[0]))) - 2);
  const x1 = Math.min(img.w - 1, Math.ceil(Math.max(...H.map((p) => p[0]))) + 2);
  const y0 = Math.max(0, Math.floor(Math.min(...H.map((p) => p[1]))) - 2);
  const y1 = Math.min(img.h - 1, Math.ceil(Math.max(...H.map((p) => p[1]))) + 2);

  const acc = [3, 3, 3].map(() => ({ n: 0, s: 0, s2: 0 }));
  const colCnt = [0, 1, 2].map(() => new Map());
  const histAll = new Uint32Array(256);
  const bandHist = [0, 1, 2].map(() => new Uint32Array(256));
  let nAll = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(H, x, y)) continue;
      const i = (y * img.w + x) * img.ch;
      const R8 = img.data[i], G8 = img.data[i + 1], B8 = img.data[i + 2];
      const l = Math.round(0.2126 * R8 + 0.7152 * G8 + 0.0722 * B8);
      const dx = x - C[0], dy = y - C[1];
      const th = Math.atan2(dy, dx);
      const bi = Math.floor(((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2)) * 720) % 720;
      const d = Math.hypot(dx, dy) / Math.max(1, R[bi]);
      if (d > 1) continue;
      const k = d < 0.42 ? 0 : d < 0.72 ? 1 : 2;
      acc[k].n++; acc[k].s += l; acc[k].s2 += l * l;
      bandHist[k][l]++;
      histAll[l]++; nAll++;
      const key = ((R8 >> 4) << 8) | ((G8 >> 4) << 4) | (B8 >> 4);
      colCnt[k].set(key, (colCnt[k].get(key) ?? 0) + 1);
    }
  }
  // 每带的主色（4bit/通道）：用来判断这一带到底被什么占据
  const topColors = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => {
    const hex = '#' + (((k >> 8) & 15) * 17).toString(16).padStart(2, '0') + (((k >> 4) & 15) * 17).toString(16).padStart(2, '0') + ((k & 15) * 17).toString(16).padStart(2, '0');
    return `${hex}:${(c / n * 100).toFixed(0)}%`;
  });
  const bands = acc.map((a, k) => {
    const mean = a.n ? a.s / a.n : 0;
    const sd = a.n ? Math.sqrt(Math.max(0, a.s2 / a.n - mean * mean)) : 0;
    let lv = 0;
    for (let b = 0; b < 16; b++) {
      let s = 0;
      for (let i = b * 16; i < (b + 1) * 16; i++) s += bandHist[k][i];
      if (s >= a.n * 0.02) lv++;
    }
    return { n: a.n, mean: +mean.toFixed(2), std: +sd.toFixed(2), levels16: lv };
  });
  // 全区（= 墙体读数）：16 级明度带里占比 ≥2% 的档数
  let levels16All = 0, levels16Eff = 0;
  for (let b = 0; b < 16; b++) {
    let s = 0;
    for (let i = b * 16; i < (b + 1) * 16; i++) s += histAll[i];
    if (s >= nAll * 0.02) levels16All++;
    if (s >= nAll * 0.005) levels16Eff++;
  }
  const dAB = +(bands[0].mean - bands[1].mean).toFixed(2);
  const dBC = +(bands[1].mean - bands[2].mean).toFixed(2);
  const dAC = +(bands[0].mean - bands[2].mean).toFixed(2);
  const pairMin = Math.min(Math.abs(dAB), Math.abs(dBC), Math.abs(dAC));
  const stdMin = Math.min(...bands.map((b) => b.std));

  const row = {
    view: v.name, court: best.name, staticTris: roi.staticTris,
    roi: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    centroid: [+C[0].toFixed(1), +C[1].toFixed(1)],
    bands: { center: bands[0], mid: bands[1], outer: bands[2] },
    top: { center: topColors(colCnt[0], acc[0].n), mid: topColors(colCnt[1], acc[1].n), outer: topColors(colCnt[2], acc[2].n) },
    dMean: { center_mid: dAB, mid_outer: dBC, center_outer: dAC, pairMin },
    levels16All, levels16Eff,
  };
  rows.push(row);
  if (!REUSE) overlayJobs.push({ view: v.name, hull: best.hull, C, R: Array.from(R), x0, y0, x1, y1 });

  const bad = [];
  if (!(pairMin >= 6)) bad.push(`三带平均明度最小差 ${pairMin.toFixed(2)} < 6`);
  if (!(stdMin >= 8)) bad.push(`最小带内标准差 ${stdMin.toFixed(2)} < 8`);
  if (!(levels16All >= 6)) bad.push(`色阶数 ${levels16All} < 6`);
  if (bad.length) { fail += bad.length; reasons.push(`${v.name}: ${bad.join('；')}`); }
  console.log(JSON.stringify(row));
  if (!REUSE) writeFileSync(`${OUT}/${v.name}.json`, JSON.stringify(row, null, 2));
}

// 净增三角面（同一帧口径：staticTris 是场景全量，不含 culling）
const tris = rows.length ? rows[0].staticTris : null;
if (tris !== null && BASE_TRIS && tris > BASE_TRIS) {
  fail++;
  reasons.push(`净增三角面 ${tris - BASE_TRIS} > 0（本次 ${tris} / 基线 ${BASE_TRIS}）`);
}
if (tris !== null) console.log(JSON.stringify({ staticTris: tris, baseTris: BASE_TRIS, net: BASE_TRIS ? tris - BASE_TRIS : null }));

// ---- 三带覆盖图（证据：证明量的是院子本身；也用来读「哪一带被什么占据」）----
// 在 Node 里合成并编码 PNG：另开浏览器页会把游戏页放到后台（rAF 被节流），
// 且软件渲染下大画布 getImageData/putImageData 会撞 protocolTimeout。
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const job of overlayJobs) {
  const im = decodePng(readFileSync(`${OUT}/${job.view}.png`));
  const rgb = new Uint8Array(im.w * im.h * 3);
  const tint = [[255, 70, 70], [70, 235, 90], [70, 130, 255]];
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      const si = (y * im.w + x) * im.ch, di = (y * im.w + x) * 3;
      let r = im.data[si], g = im.data[si + 1], b = im.data[si + 2];
      if (x >= job.x0 && x <= job.x1 && y >= job.y0 && y <= job.y1 && inside(job.hull, x, y)) {
        const dx = x - job.C[0], dy = y - job.C[1];
        const th = Math.atan2(dy, dx);
        const bi = Math.floor(((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2)) * 720) % 720;
        const d = Math.hypot(dx, dy) / Math.max(1, job.R[bi]);
        if (d <= 1) {
          const k = d < 0.42 ? 0 : d < 0.72 ? 1 : 2;
          r = r * 0.5 + tint[k][0] * 0.5;
          g = g * 0.5 + tint[k][1] * 0.5;
          b = b * 0.5 + tint[k][2] * 0.5;
        }
      }
      rgb[di] = r; rgb[di + 1] = g; rgb[di + 2] = b;
    }
  }
  // 黄色凸包描边（3px）
  for (let i = 0; i < job.hull.length; i++) {
    const a = job.hull[i], b = job.hull[(i + 1) % job.hull.length];
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a[0] + (b[0] - a[0]) * s / steps), y = Math.round(a[1] + (b[1] - a[1]) * s / steps);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= im.w || yy >= im.h) continue;
        const di = (yy * im.w + xx) * 3;
        rgb[di] = 255; rgb[di + 1] = 0xe1; rgb[di + 2] = 0x4a;
      }
    }
  }
  writeFileSync(`${OUT}/${job.view}-bands.png`, encodePng(im.w, im.h, rgb));
}

await browser.close();
if (fail) {
  console.error(`[BLOCK] ${reasons.join(' | ')}`);
  process.exit(1);
}
console.log('[PASS] 三带明度分层 / 带内层次 / 色阶数 / 净面数 全部达标');
process.exit(0);
