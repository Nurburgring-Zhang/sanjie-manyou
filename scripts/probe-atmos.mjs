/**
 * 大气探针（W1：A2 天空发紫 / A1 远景糊成一块色 / C1 地府只剩剪影）
 *
 * 三条判据都落成像素级断言，不认「看着差不多」：
 *
 *  A2  机位 (0,90,320)→(0,2,-100)，天空 ROI（排除 HUD 与山体）里
 *      「H∈[270,330] 且 chroma<22」的像素占比 ≤ 15%；
 *      且同一机位下 10° 与 40° 仰角的色相相差 ≥ 25°（要有明确的暖→冷过渡，
 *      不是整片停在紫灰）。
 *
 *  A1  同一机位，取地面距离 300m 与 3000m 两处屋面色相，按 FogExp2 的
 *      T = exp(-(density·d)²) 做去雾校正后，两者色相相差 ≤ 15°。
 *      远处若被雾压成同一块土色，去雾后也回不来，色相会跟近处对不上。
 *
 *  C1  机位 (0,-195,130)→(0,-232,0)（阎罗殿 u_hero），殿体 ROI 亮度
 *      p95−p05 ≥ 45，殿体与背景雾的 ΔE76 ≥ 20，且相机→主体 92m 处
 *      雾透过率 ≥ 0.35；最后断言「同一相机、只挪玩家位置」时
 *      雾色与雾密度逐值不变（applyHellDepth 不得读玩家状态）。
 *
 * 去雾校正的诚实边界：渲染管线是 ACES tonemap + bloom + Grade，
 * 严格的去雾要在 tonemap 前的线性 HDR 上做；这里只能对 8bit 显示值
 * 先转线性再反雾，属于近似。它足够判「远景是不是被雾压平」，
 * 但不能当成物理辐射度测量。
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-atmos.mjs [outdir]
 * 退出码：0 = PASS，1 = BLOCK。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const OUT = process.argv[2] || 'artifacts/_W1_atmos';
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const W = 1600, H = 900;

/* ── PNG 解码（bitDepth 8 / colorType 2|6 / 非隔行） ───────────────── */
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3, st = w * bpp;
  const out = Buffer.alloc(h * st);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const ln = raw.subarray(p, p + st); p += st;
    const c = out.subarray(y * st, (y + 1) * st);
    const pr = y > 0 ? out.subarray((y - 1) * st, y * st) : null;
    for (let x = 0; x < st; x++) {
      const a = x >= bpp ? c[x - bpp] : 0, b2 = pr ? pr[x] : 0, cc = pr && x >= bpp ? pr[x - bpp] : 0;
      let v = ln[x];
      if (f === 1) v += a;
      else if (f === 2) v += b2;
      else if (f === 3) v += (a + b2) >> 1;
      else if (f === 4) {
        const pp = a + b2 - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - cc);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b2 : cc;
      }
      c[x] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

/* ── 色彩工具 ───────────────────────────────────────────────────── */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** HSV：h∈[0,360)，chroma = max−min（0..255 口径，与判据一致） */
function toHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, chroma: d, v: mx / 255 };
}

const hueDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin2srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * FogExp2 去雾：three 的 fogFactor = 1 − exp(−(density·depth)²)，
 * 即 T = exp(−(density·depth)²)。在线性空间反解物体色。
 */
function defog(rgb, fog, density, dist) {
  const T = Math.exp(-Math.pow(density * dist, 2));
  if (T < 0.05) return null;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const o = srgb2lin(rgb[i] / 255), f = srgb2lin(fog[i] / 255);
    const c = Math.min(1, Math.max(0, (o - f * (1 - T)) / T));
    out[i] = lin2srgb(c) * 255;
  }
  return out;
}

/* ── 区域统计 ───────────────────────────────────────────────────── */
function regionPixels(img, r, cb) {
  for (let y = Math.max(0, r.y0); y < Math.min(img.h, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x < Math.min(img.w, r.x1); x++) {
      const i = (y * img.w + x) * img.bpp;
      cb(img.data[i], img.data[i + 1], img.data[i + 2], x, y);
    }
  }
}

function lumaQuantiles(img, r) {
  const L = [];
  regionPixels(img, r, (R, G, B) => L.push(luma(R, G, B)));
  L.sort((a, b) => a - b);
  const q = (p) => L[Math.min(L.length - 1, Math.floor((L.length - 1) * p))];
  return { p05: q(0.05), p50: q(0.5), p95: q(0.95), n: L.length };
}

function meanRgb(img, r) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  regionPixels(img, r, (R, G, B) => { sr += R; sg += G; sb += B; n++; });
  return [sr / n, sg / n, sb / n];
}

/** 统计「紫灰」像素：H∈[270,330] 且 chroma<22 */
function purpleGreyFrac(img, r) {
  let hit = 0, n = 0;
  regionPixels(img, r, (R, G, B) => {
    const { h, chroma } = toHsv(R, G, B);
    n++;
    if (h >= 270 && h <= 330 && chroma < 22) hit++;
  });
  return { frac: hit / n, hit, n };
}

/**
 * 屋面取色：先用"暗部"把屋顶选出来——瓦顶在画面里始终比夯土街面与雾色暗，
 * 取盒内未去雾亮度最低的 30% 作候选，再对候选去雾、按 chroma 加权求圆形中位色相。
 * 两端选到的才都是"屋顶这一类像素"，不会一端落进水面或夯土广场。
 */
function roofHue(img, r, opt = {}) {
  const { fog = null, density = 0, dist = 0 } = opt;
  const L = [];
  regionPixels(img, r, (R, G, B) => L.push(luma(R, G, B)));
  L.sort((a, b) => a - b);
  const cut = L[Math.floor((L.length - 1) * 0.3)];
  const bins = new Float64Array(72);
  let used = 0;
  regionPixels(img, r, (R, G, B) => {
    if (luma(R, G, B) > cut) return;
    let px = [R, G, B];
    if (fog) {
      const d = defog(px, fog, density, dist);
      if (!d) return;
      px = d;
    }
    const { h, chroma } = toHsv(px[0], px[1], px[2]);
    if (chroma < 12) return;
    used++;
    bins[Math.min(71, Math.floor(h / 5))] += 1;
  });
  let best = 0, bestW = -1;
  for (let i = 0; i < 72; i++) {
    const w = bins[(i + 71) % 72] + bins[i] + bins[(i + 1) % 72];
    if (w > bestW) { bestW = w; best = i; }
  }
  return { hue: best * 5 + 2.5, used, cut: +cut.toFixed(1), mean: meanRgb(img, r).map((v) => Math.round(v)), top: [...bins.keys()].sort((a, b) => bins[b] - bins[a]).slice(0, 3).map((i) => `${i * 5}°:${Math.round(bins[i])}`).join(' ') };
}

/** CIE76 ΔE（用 sRGB→XYZ→Lab，D65） */
function toLab([r, g, b]) {
  const f = (c) => { c = srgb2lin(c / 255); return c; };
  const R = f(r), G = f(g), B = f(b);
  let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  let Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  let Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = g2(X); Y = g2(Y); Z = g2(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const deltaE = (a, b) => {
  const A = toLab(a), B = toLab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

/* ── 场景控制 ───────────────────────────────────────────────────── */
const setCam = async (page, p, t) => {
  await waitReady(page);
  return page.evaluate(([pp, tt]) => {
  const e = window.__qingming.engine;
  e.stopCinema('fly');
  e.camera.position.set(pp[0], pp[1], pp[2]);
  const dx = tt[0] - pp[0], dy = tt[1] - pp[1], dz = tt[2] - pp[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
  e.camera.updateMatrixWorld(true);
  return { yaw: e.yaw, pitch: e.pitch };
}, [p, t]);
};

const setPose = async (page, yaw, pitch) => {
  await waitReady(page);
  return page.evaluate(([y, p]) => {
  const e = window.__qingming.engine;
  e.stopCinema('fly');
  e.yaw = y;
  e.pitch = p;
  e.camera.updateMatrixWorld(true);
}, [yaw, pitch]);
};

const readFog = (page) => page.evaluate(() => {
  const { engine } = window.__qingming;
  const f = engine.scene.fog;
  const c = engine.camera.position;
  return {
    color: '#' + f.color.getHexString(),
    density: f.density,
    cam: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
    exposure: engine.renderer.toneMappingExposure,
  };
});

const shot = async (page, name) => {
  const buf = Buffer.from(await page.screenshot({ path: `${OUT}/${name}.png` }));
  return decodePNG(buf);
};

/** vite 会因并发改文件整页重载；每一步前都等世界就绪，否则 evaluate 打到空 window */
const waitReady = async (page) => {
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 500));
};

/* ── 离线分析模式：node scripts/probe-atmos.mjs --analyze <png> ───── */
if (process.argv[2] === '--analyze') {
  const { readFileSync } = await import('node:fs');
  const img = decodePNG(readFileSync(process.argv[3]));
  console.log(`图片 ${img.w}x${img.h}`);
  // A2：天空 ROI 逐行统计紫灰占比
  console.log('\n天空 ROI 逐行（x 700–1300）：');
  for (let y = 40; y <= 200; y += 10) {
    const p = purpleGreyFrac(img, { x0: 700, y0: y, x1: 1300, y1: y + 10 });
    const m = meanRgb(img, { x0: 700, y0: y, x1: 1300, y1: y + 10 });
    const hsv = toHsv(m[0], m[1], m[2]);
    console.log(`  y=${String(y).padStart(3)}  紫灰 ${(p.frac * 100).toFixed(1).padStart(5)}%  RGB=${m.map((v) => Math.round(v)).join(',')}  H=${hsv.h.toFixed(0)} C=${hsv.chroma.toFixed(0)}`);
  }
  // 候选屋面色块
  const boxes = {
    'near-A 540-700/525-543': { x0: 540, x1: 700, y0: 525, y1: 543 },
    'near-B 540-700/524-536': { x0: 540, x1: 700, y0: 524, y1: 536 },
    'near-C 560-660/526-540': { x0: 560, x1: 660, y0: 526, y1: 540 },
    'near-D 620-760/525-545': { x0: 620, x1: 760, y0: 525, y1: 545 },
    'near-E 900-1040/525-545': { x0: 900, x1: 1040, y0: 525, y1: 545 },
    'far-500-1100/290-302': { x0: 500, x1: 1100, y0: 290, y1: 302 },
    'far-700-900/288-300': { x0: 700, x1: 900, y0: 288, y1: 300 },
  };
  console.log('\n候选色块（暗部 30%，去雾用当前场景雾参数时请配合浏览器模式）：');
  for (const [k, b] of Object.entries(boxes)) {
    const r = roofHue(img, b);
    console.log(`  ${k.padEnd(26)} meanRGB=${r.mean.join(',')} 暗部=${r.cut} 峰 ${r.top}`);
  }
  process.exit(0);
}

/* ── 主流程 ─────────────────────────────────────────────────────── */
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: [`--window-size=${W},${H}`, '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.setViewport({ width: W, height: H });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));

const fails = [];
const rows = [];

/* ===== A2 天空 ===== */
const A2_P = [0, 90, 320], A2_T = [0, 2, -100];
await setCam(page, A2_P, A2_T);
await new Promise((r) => setTimeout(r, 1200));
const air = await shot(page, 'a2_sky');
// 天空 ROI：标题栏（y<45）、左上目标条（x<400）与小地图（x>1300）之外，
// y≤150 一路都是纯天穹（山脊最高点约 y≈205，见 artifacts/_audit20261103/c_air.png）
const SKY = { x0: 700, y0: 45, x1: 1300, y1: 150 };
const purple = purpleGreyFrac(air, SKY);
const skyMean = meanRgb(air, SKY);
const skyHsv = toHsv(skyMean[0], skyMean[1], skyMean[2]);

// 10° / 40° 仰角：朝正南（+Z，无山体与天宫遮挡），采样画面中心 120×120
const elev = {};
for (const deg of [10, 40]) {
  await setPose(page, Math.PI, (deg * Math.PI) / 180);
  await new Promise((r) => setTimeout(r, 500));
  const img = await shot(page, `a2_elev${deg}`);
  const box = { x0: W / 2 - 60, y0: H / 2 - 60, x1: W / 2 + 60, y1: H / 2 + 60 };
  const mean = meanRgb(img, box);
  const { h, chroma } = toHsv(mean[0], mean[1], mean[2]);
  // 均匀性自检：仰角采样点必须落在天上，不能压到山/建筑
  let varAcc = 0, n = 0;
  regionPixels(img, box, (R, G, B) => { varAcc += Math.pow(luma(R, G, B) - luma(mean[0], mean[1], mean[2]), 2); n++; });
  elev[deg] = { rgb: mean.map((v) => Math.round(v)), hue: +h.toFixed(1), chroma: +chroma.toFixed(1), std: +Math.sqrt(varAcc / n).toFixed(2) };
  rows.push(`A2 仰角 ${deg}°  RGB=${elev[deg].rgb.join(',')}  H=${elev[deg].hue}  chroma=${elev[deg].chroma}  std=${elev[deg].std}`);
}
const hueGap = hueDiff(elev[10].hue, elev[40].hue);
console.log(`A2 天空 ROI 紫灰占比 ${(purple.frac * 100).toFixed(1)}%  (${purple.hit}/${purple.n})  均值 RGB=${skyMean.map((v) => Math.round(v)).join(',')}  H=${skyHsv.h.toFixed(1)} chroma=${skyHsv.chroma.toFixed(1)}`);
console.log(`A2 10° vs 40° 色相差 ${hueGap.toFixed(1)}°`);
if (!(purple.frac <= 0.15)) fails.push(`A2 紫灰像素占比 ${(purple.frac * 100).toFixed(1)}% > 15%`);
// 附加门：指定判据只数「低彩度紫」，而 23 的彩度刚好越过 22 就漏判；
// 整片天空读成紫时均值色相必然落在紫区，这条把「均值也是紫」一并拦住。
if (skyHsv.h >= 270 && skyHsv.h <= 330) fails.push(`A2 天空均值色相 ${skyHsv.h.toFixed(1)}° 落在紫区 [270,330]`);
if (!(hueGap >= 25)) fails.push(`A2 10°/40° 色相差 ${hueGap.toFixed(1)}° < 25°`);
if (elev[10].std > 8 || elev[40].std > 8) fails.push(`A2 仰角采样点不纯（std ${elev[10].std}/${elev[40].std} > 8），采样压到了几何`);

/* ===== A1 远景瓦色 ===== */
await setCam(page, A2_P, A2_T);
await new Promise((r) => setTimeout(r, 800));
const proj = await page.evaluate((ds) => {
  const e = window.__qingming.engine;
  const cam = e.camera;
  const V = cam.position.constructor;
  const dir = new V(); cam.getWorldDirection(dir);
  const hl = Math.hypot(dir.x, dir.z) || 1;
  return ds.map((d) => {
    const p = new V(cam.position.x + (dir.x / hl) * d, 4, cam.position.z + (dir.z / hl) * d);
    p.project(cam);
    return { d, sx: (p.x * 0.5 + 0.5) * innerWidth, sy: (-p.y * 0.5 + 0.5) * innerHeight };
  });
}, [300, 3000]);
const fogA1 = await readFog(page);
const fogRgb = [1, 3, 5].map((i) => parseInt(fogA1.color.slice(i, i + 2), 16));
// 采样盒（同机位）：
//  · 300m：投影点 (0,4,20) 正落在汴河水面上，屋面其实在南岸临河那一排
//    （屏幕 y 再往下 12–36px，对应地面距离 306–270m），所以盒子下移，并收窄到
//    一段连续瓦顶（x 540–700 是屋脊+瓦垄完整的一栋，避开中央红色鼓楼）。
//  · 3km：薄盒 ±6px，保证盒内像素的地面距离都逼近 3km（±10%），去雾用同一 depth。
const NEAR = { x0: 540, x1: 700, y0: Math.round(proj[0].sy) + 12, y1: Math.round(proj[0].sy) + 30 };
const FAR = { x0: 500, x1: 1100, y0: Math.round(proj[1].sy) - 5, y1: Math.round(proj[1].sy) + 7 };
const near = roofHue(air, NEAR, { fog: fogRgb, density: fogA1.density, dist: 300 });
const far = roofHue(air, FAR, { fog: fogRgb, density: fogA1.density, dist: 3000 });
const rawNear = roofHue(air, NEAR);
const rawFar = roofHue(air, FAR);
const hueGapA1 = hueDiff(near.hue, far.hue);
console.log(`A1 雾色 ${fogA1.color} density=${fogA1.density.toExponential(3)}`);
console.log(`A1 屏幕 y：300m→${proj[0].sy.toFixed(0)}px  3km→${proj[1].sy.toFixed(0)}px`);
console.log(`A1 近盒 meanRGB=${near.mean.join(',')} 暗部亮度=${near.cut} 样本=${near.used} 色相峰 ${near.top}`);
console.log(`A1 远盒 meanRGB=${far.mean.join(',')} 暗部亮度=${far.cut} 样本=${far.used} 色相峰 ${far.top}`);
console.log(`A1 去雾后色相：300m ${near.hue}°  3km ${far.hue}°  差 ${hueGapA1.toFixed(1)}°`);
console.log(`A1 未去雾色相：300m ${rawNear.hue}°  3km ${rawFar.hue}°  差 ${hueDiff(rawNear.hue, rawFar.hue).toFixed(1)}°（诊断用）`);
if (!(hueGapA1 <= 15)) fails.push(`A1 去雾后 300m/3km 色相差 ${hueGapA1.toFixed(1)}° > 15°`);
if (near.used < 200 || far.used < 200) fails.push(`A1 彩色样本不足（300m ${near.used} / 3km ${far.used}）`);

/* ===== C1 地府 ===== */
await waitReady(page);
await page.evaluate(() => window.__qingming.world.teleport('yanluo'));
await new Promise((r) => setTimeout(r, 1000));
await setCam(page, [0, -195, 130], [0, -232, 0]);
await new Promise((r) => setTimeout(r, 1200));
const hell = await shot(page, 'c1_hero');
const f1 = await readFog(page);
const ROI = { x0: 0, y0: 100, x1: W, y1: 800 };
const SUBJ = { x0: 420, y0: 200, x1: 1120, y1: 700 };
const BGS = [
  { x0: 30, y0: 120, x1: 200, y1: 400 },
  { x0: 1400, y0: 120, x1: 1570, y1: 400 },
];
const hist = lumaQuantiles(hell, ROI);
const subjRgb = meanRgb(hell, SUBJ);
let bgRgb = [0, 0, 0];
for (const r of BGS) {
  const m = meanRgb(hell, r);
  bgRgb = [bgRgb[0] + m[0] / 2, bgRgb[1] + m[1] / 2, bgRgb[2] + m[2] / 2];
}
const dE = deltaE(subjRgb, bgRgb);
const T92 = Math.exp(-Math.pow(f1.density * 92, 2));
console.log(`C1 亮度 p05=${hist.p05.toFixed(1)} p50=${hist.p50.toFixed(1)} p95=${hist.p95.toFixed(1)}  p95−p05=${(hist.p95 - hist.p05).toFixed(1)}`);
console.log(`C1 殿体 RGB=${subjRgb.map((v) => Math.round(v)).join(',')}  背景雾 RGB=${bgRgb.map((v) => Math.round(v)).join(',')}  ΔE76=${dE.toFixed(1)}`);
console.log(`C1 雾 ${f1.color} density=${f1.density.toFixed(5)}  相机→主体 92m 透过率 T=${T92.toFixed(3)}`);

// 同一相机、只挪玩家：雾色/密度必须逐值不变
await page.evaluate(() => {
  const w = window.__qingming.world;
  if (w.player?.actor?.pos) w.player.actor.pos.set(260, -259, 250);
});
await new Promise((r) => setTimeout(r, 700));
await setCam(page, [0, -195, 130], [0, -232, 0]);
await new Promise((r) => setTimeout(r, 600));
const f2 = await readFog(page);
const sameColor = f1.color === f2.color;
const sameDensity = Math.abs(f1.density - f2.density) <= 1e-9;
console.log(`C1 玩家移到 (260,−259,250) 后：雾 ${f2.color} density=${f2.density.toFixed(5)}  同色=${sameColor} 同密度=${sameDensity}`);
// 恢复玩家到殿前，避免污染后续机位
await waitReady(page);
await page.evaluate(() => window.__qingming.world.teleport('yanluo'));

if (!(hist.p95 - hist.p05 >= 45)) fails.push(`C1 p95−p05=${(hist.p95 - hist.p05).toFixed(1)} < 45`);
if (!(dE >= 20)) fails.push(`C1 殿体/背景 ΔE=${dE.toFixed(1)} < 20`);
if (!(T92 >= 0.35)) fails.push(`C1 92m 透过率 ${T92.toFixed(3)} < 0.35`);
if (!sameColor || !sameDensity) fails.push(`C1 雾随玩家位置跳变：${f1.color}/${f1.density.toFixed(5)} → ${f2.color}/${f2.density.toFixed(5)}`);

await browser.close();

console.log('\n逐项：');
for (const r of rows) console.log('  ' + r);
if (fails.length) {
  console.log('\nBLOCK');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('\nPASS');
process.exit(0);
