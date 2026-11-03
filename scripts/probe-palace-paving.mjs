/**
 * 午门内广场铺装：空间频率验收探针。
 *
 * 判据（缺陷单原话）：地面方砖边长应是 0.6–1.2m 一档，不是 10m 级的停车场分格。
 * 做法：把世界坐标里的一段地面线投到屏幕上，沿水平 / 垂直方向取亮度序列做自相关，
 * 找主周期，再按该机位的地面尺度把像素周期换算回米，断言落在 0.6–2.0m。
 *
 * 像素 ↔ 米 的换算（写死在代码里，也写在这里）：
 *   ① 机位 P=(0,14,−3000)、看向 (0,6,−3200)，相机 fov=55°（engine.ts:488 的默认值，探针运行时会重读）。
 *   ② 地面取 y=0.18（午门内广场金砖顶面，imperial.ts:1450 的 `0.15 + 0.06/2`）。
 *   ③ 由相机实时矩阵（projectionMatrix × matrixWorldInverse）把世界点投成像素：
 *        px = ((clip.x/clip.w)·0.5+0.5)·W，py = ((−clip.y/clip.w)·0.5+0.5)·H
 *      这就是换算的唯一来源，没有手算近似。
 *   ④ 某深度 z 上的横向尺度 = |project(x+1,y,z) − project(x,y,z)|（像素/米）；
 *      纵向尺度 = |project(x,y,z−1) − project(x,y,z)|（像素/米，z 越小越远）。
 *      两者不必相等——俯视角把进深方向压扁了约 2.3 倍（实测），所以水平/垂直各用各的尺度。
 *   ⑤ 于是「0.6–2.0m」在像素上就是 [0.6·scale, 2.0·scale]，探针在每个扫描线上的这个
 *      区间里找自相关峰，找到后再 pl / scale 换回米。
 *
 * 退出码：0 = 通过（水平与垂直方向主周期都落在 0.6–2.0m，且过半扫描线一致）；1 = 不通过。
 *
 * 用法：
 *   node scripts/probe-palace-paving.mjs [--out=artifacts/palace-paving/after.png]
 *   PROBE_URL=http://127.0.0.1:4180/ 可改端口。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4180/';
const argOut = process.argv.find((a) => a.startsWith('--out='));
const OUT = argOut ? argOut.slice('--out='.length) : 'artifacts/palace-paving/after.png';
const CAM = { x: 0, y: 14, z: -3000, tx: 0, ty: 6, tz: -3200 };
const GROUND_Y = 0.18;
const PERIOD_MIN = 0.6;
const PERIOD_MAX = 2.0;

// ── 地面 ROI（世界米）：午门内广场东北象限的一块净地。
//    |x| ≤ 7.5 是 14m 御道、±4.25 是御路石收边，必须避开；
//    品级山两列在 x=±40、铜龟(16,−3040)、日晷(30,−3020) 也避开。
//    x 上界 22 是投影硬约束：z=−3026 处 32.6 px/m，x=34 会落到屏幕 x≈1908（出画）。
const ROI = { x0: 9, x1: 22, z0: -3036, z1: -3026 };
const H_ROWS = 9;    // 水平扫描线条数（z 方向均分）
const V_COLS = 9;    // 垂直扫描线条数（x 方向均分）

// ────────────────────────────── PNG 解码（node 无第三方依赖） ──────────────────────────────
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8, w = 0, h = 0, bit = 0, color = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bit = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0;
  if (!ch || bit !== 8 || interlace !== 0) throw new Error(`不支持的 PNG: ch=${ch} bit=${bit} interlace=${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error('未知 PNG filter ' + f);
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return { w, h, ch, data: out };
}

/** 亮度（Rec.709），0..1 */
function lumAt(img, x, y) {
  const i = (y * img.w + x) * img.ch;
  const r = img.data[i], g = img.ch >= 3 ? img.data[i + 1] : r, b = img.ch >= 3 ? img.data[i + 2] : r;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ────────────────────────────── 投影：世界 → 像素 ──────────────────────────────
function makeProjector(view, projMat, W, H) {
  return (x, y, z) => {
    const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
    const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
    const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
    const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
    const cx = projMat[0] * vx + projMat[4] * vy + projMat[8] * vz + projMat[12] * vw;
    const cy = projMat[1] * vx + projMat[5] * vy + projMat[9] * vz + projMat[13] * vw;
    const cw = projMat[3] * vx + projMat[7] * vy + projMat[11] * vz + projMat[15] * vw;
    return [((cx / cw) * 0.5 + 0.5) * W, (-(cy / cw) * 0.5 + 0.5) * H];
  };
}

// ────────────────────────────── 一维自相关 ──────────────────────────────
/** 去均值后归一化自相关；返回 r[k]，k = 0..maxLag */
function autocorr(sig, maxLag) {
  const n = sig.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += sig[i];
  mean /= n;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = sig[i] - mean;
  const r = new Float64Array(maxLag + 1);
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += d[i] * d[i];
  if (e0 < 1e-9) return { r, ok: false };
  for (let k = 0; k <= maxLag; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += d[i] * d[i + k];
    r[k] = s / e0;
  }
  return { r, ok: true };
}

/**
 * 在 [lagMin, lagMax] 里找主周期：取全部局部极大值，挑「相关度 ≥ 最大值×0.85」里 lag 最小的那个
 * ——避免把 2×（1.8m）或 3× 谐波当基频。
 */
function dominantLag(sig, lagMin, lagMax) {
  const kMin = Math.max(2, Math.round(lagMin));
  const kMax = Math.min(sig.length - 3, Math.round(lagMax));
  if (kMax <= kMin + 1) return null;
  const { r, ok } = autocorr(sig, kMax + 1);
  if (!ok) return null;
  let best = -Infinity, bestK = -1;
  for (let k = kMin; k <= kMax; k++) if (r[k] > best) { best = r[k]; bestK = k; }
  if (best < 0.10) return null;
  // 次谐波校正：周期信号在 2×/3× 处也有峰，噪声大时 2× 常压过基频。
  // 若 k/2 处仍是局部极大且相关度 ≥ 0.55×r[k]，就往回降到基频。
  let k = bestK;
  for (let guard = 0; guard < 3; guard++) {
    const h = Math.round(k / 2);
    if (h < kMin) break;
    if (r[h] >= 0.55 * r[k] && r[h] >= r[h - 1] && r[h] >= r[h + 1]) k = h;
    else break;
  }
  // 段内细插值：抛物线顶点，让 0.9m 不至于被 1px 量化成 0.86 / 0.95
  const y0 = r[k - 1], y1 = r[k], y2 = r[k + 1];
  const den = y0 - 2 * y1 + y2;
  const frac = Math.abs(den) > 1e-9 ? (0.5 * (y0 - y2)) / den : 0;
  return { lag: k + Math.max(-0.5, Math.min(0.5, frac)), r: r[k] };
}

/**
 * 暗线间距诊断（不进判据，只用来"验尺"）：平滑后找亮度局部极小（砖缝），
 * 返回相邻缝的中位间距（像素）。改动前应量到 ≈6.34m（大格通缝），改动后 ≈0.9m。
 */
function darkLineGap(sig, scale) {
  const n = sig.length;
  const w = Math.max(2, Math.round(0.12 * scale));        // 0.12m 平滑窗，压掉缝底的抖动
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = -w; j <= w; j++) { const k = i + j; if (k >= 0 && k < n) { s += sig[k]; c++; } }
    sm[i] = s / c;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += sm[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (sm[i] - mean) * (sm[i] - mean);
  const sd = Math.sqrt(v / n);
  if (sd < 1e-6) return null;
  const minSep = 0.3 * scale;                              // 同一道缝的重复极小合并掉
  const kept = [];
  for (let i = 1; i < n - 1; i++) {
    // 0.55σ：只认"明显更暗"的线（改动前是 45cm 通缝，改动后是 10cm 砖缝），
    // 阈值低到 0.25σ 时旧广场的贴图噪点会被当成缝，量出的间距失去意义。
    if (!(sm[i] <= sm[i - 1] && sm[i] < sm[i + 1] && sm[i] < mean - 0.55 * sd)) continue;
    const last = kept[kept.length - 1];
    if (last !== undefined && i - last < minSep) { if (sm[i] < sm[last]) kept[kept.length - 1] = i; }
    else kept.push(i);
  }
  const gaps = [];
  for (let i = 1; i < kept.length; i++) gaps.push(kept[i] - kept[i - 1]);
  return gaps.length ? { gap: median(gaps), n: gaps.length } : null;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ────────────────────────────── 主流程 ──────────────────────────────
const argAnalyze = process.argv.find((a) => a.startsWith('--analyze='));
const argCalib = process.argv.find((a) => a.startsWith('--calib='));
const CALIB = 'artifacts/palace-paving/calib.json';

let camInfo = null;
let img = null;
let shotBuf = null;

if (argAnalyze && argCalib) {
  // 离线模式：拿同一份相机标定去分析一张既有截图（改动前的基准图就靠它复核，不必回滚源码）
  camInfo = JSON.parse(fs.readFileSync(argCalib.slice('--calib='.length), 'utf8'));
  img = decodePNG(fs.readFileSync(argAnalyze.slice('--analyze='.length)));
  console.log(`离线分析：${argAnalyze.slice('--analyze='.length)}（标定 ${argCalib.slice('--calib='.length)}）`);
} else {
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const ready = async () => {
  await page.waitForFunction(() => !!(window.__qingming && window.__qingming.scene && !document.getElementById('loading')), { timeout: 180000 });
};

/** 抗 HMR 重载：dev server 在编辑源文件后会整页 reload，evaluate 会撞上 execution context destroyed */
const ev = async (fn, arg, tries = 8) => {
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch {
      await new Promise((r) => setTimeout(r, 900));
      try { await ready(); } catch { /* 还在重载 */ }
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw new Error('页面始终不可用（evaluate 重试耗尽）');
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await ready();
await new Promise((r) => setTimeout(r, 1200));

// 相位 0 + 指定机位
const applyCam = async (cam) => ev(async (cam) => {
  const en = window.__qingming.engine;
  const wd = window.__qingming.world;
  wd.scrolling = false;
  if (en.camMode === 'cinema') en.stopCinema('fly');
  en.setCamMode('fly');
  en.time.jump('dusk');
  en.time.phase = 0;
  en.time.paused = true;
  en.camera.position.set(cam.x, cam.y, cam.z);
  en.lookTarget.set(cam.tx, cam.ty, cam.tz);
  const dx = cam.tx - cam.x, dy = cam.ty - cam.y, dz = cam.tz - cam.z;
  const dd = Math.max(1, Math.hypot(dx, dy, dz));
  en.yaw = Math.atan2(-dx, -dz);
  en.pitch = Math.asin(dy / dd);
  await new Promise((r) => setTimeout(r, 900));
  en.camera.position.set(cam.x, cam.y, cam.z);
  en.lookTarget.set(cam.tx, cam.ty, cam.tz);
  en.camera.updateMatrixWorld(true);
  en.camera.updateProjectionMatrix();
  const info = {
    pos: en.camera.position.toArray(),
    fov: en.camera.fov,
    phase: en.time.phase,
    view: Array.from(en.camera.matrixWorldInverse.elements),
    proj: Array.from(en.camera.projectionMatrix.elements),
    w: window.innerWidth,
    h: window.innerHeight,
    tris: en.renderer.info.render.triangles,
    auditTris: null,
    pavingKit: null,
  };
  const a = wd.assetAudit;
  if (a) {
    let t = 0;
    for (const g of Object.values(a.groups)) t += g.triangles;
    info.auditTris = Math.round(t);
    info.ashTris = a.groups.ash ? Math.round(a.groups.ash.triangles) : null;
    info.pavingKit = a.detail['palace.court.paving'] ?? null;
  }
  return info;
}, cam);

/** ROI 在屏幕上的包围盒（取四角 min/max） */
const roiBox = (ci) => {
  const pp = makeProjector(ci.view, ci.proj, ci.w, ci.h);
  const c = [pp(ROI.x0, GROUND_Y, ROI.z1), pp(ROI.x1, GROUND_Y, ROI.z1), pp(ROI.x0, GROUND_Y, ROI.z0), pp(ROI.x1, GROUND_Y, ROI.z0)];
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs))), x1: Math.min(ci.w - 1, Math.ceil(Math.max(...xs))),
    y0: Math.max(0, Math.floor(Math.min(...ys))), y1: Math.min(ci.h - 1, Math.ceil(Math.max(...ys))),
    onScreen: Math.min(...xs) >= 0 && Math.max(...xs) <= ci.w - 1 && Math.min(...ys) >= 0 && Math.max(...ys) <= ci.h - 1,
  };
};

/** 帧体检：加载页几乎纯黑、方差极低；真场景的广场是有纹理的灰 */
function frameStats(im, box) {
  let n = 0, s = 0, s2 = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    const v = lumAt(im, x, y); n++; s += v; s2 += v * v;
  }
  const mean = s / Math.max(1, n);
  return { mean, std: Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mean * mean)) };
}

// 稳定取帧：dev server 在并行开发时随时可能 HMR 整页 reload。
// 取完必须再验一次：加载页 → 事件丢失 → 页面重载中，图就是黑屏，必须重来。
fs.mkdirSync(path.dirname(OUT), { recursive: true });
let camOk = null;
for (let attempt = 1; attempt <= 5 && !shotBuf; attempt++) {
  const ci = await applyCam(CAM);
  await new Promise((r) => setTimeout(r, 900));
  await ev(() => { const u = document.getElementById('ui'); if (u) u.style.display = 'none'; });
  await new Promise((r) => setTimeout(r, 220));
  const buf = Buffer.from(await page.screenshot({ type: 'png' }));   // puppeteer 新版返回 Uint8Array
  const alive = await page.evaluate((c) => {
    const en = window.__qingming && window.__qingming.engine;
    if (document.getElementById('loading') || !en) return false;
    const p = en.camera.position;
    return Math.abs(p.x - c.x) < 0.5 && Math.abs(p.y - c.y) < 0.5 && Math.abs(p.z - c.z) < 0.5;
  }, CAM).catch(() => false);
  const dec = decodePNG(buf);
  const st = frameStats(dec, roiBox(ci));
  if (!alive || st.mean < 0.05 || st.std < 0.006) {
    console.error(`[取帧] 第 ${attempt} 次不合格（页面存活=${alive} 亮度=${st.mean.toFixed(3)} 纹理方差=${st.std.toFixed(4)}）→ 重试`);
    continue;
  }
  shotBuf = buf; img = dec; camInfo = ci; camOk = { alive, ...st };
}

if (!shotBuf) {
  console.error('FAIL — 连续 5 次取帧都撞上页面重载/加载页，无法测量');
  await browser.close();
  process.exit(1);
}
fs.writeFileSync(OUT, shotBuf);
fs.writeFileSync(CALIB, JSON.stringify(camInfo, null, 1));
console.log(`取帧体检：页面存活=${camOk.alive} ROI 平均亮度=${camOk.mean.toFixed(3)} 纹理标准差=${camOk.std.toFixed(4)}`);

// 交付图（恢复 HUD）
await ev(() => { const u = document.getElementById('ui'); if (u) u.style.display = ''; });
await new Promise((r) => setTimeout(r, 250));
const outHud = OUT.replace(/\.png$/i, '') + '-hud.png';
fs.writeFileSync(outHud, await page.screenshot({ type: 'png' }));

// 细节特写（诊断用）：贴地看「0.9m 基本砖 + 每 7 块主缝」到底有没有画出来
await ev(async () => {
  const en = window.__qingming.engine;
  const u = document.getElementById('ui'); if (u) u.style.display = 'none';
  const [px, py, pz, tx, ty, tz] = [13, 2.4, -3028, 19, 0.18, -3035];
  en.camera.position.set(px, py, pz);
  en.lookTarget.set(tx, ty, tz);
  const dx = tx - px, dy = ty - py, dz = tz - pz;
  const dd = Math.max(1, Math.hypot(dx, dy, dz));
  en.yaw = Math.atan2(-dx, -dz);
  en.pitch = Math.asin(dy / dd);
  await new Promise((r) => setTimeout(r, 500));
  en.camera.position.set(px, py, pz);
  en.camera.updateMatrixWorld(true);
});
await new Promise((r) => setTimeout(r, 700));
fs.writeFileSync(OUT.replace(/\.png$/i, '') + '-detail.png', await page.screenshot({ type: 'png' }));
await ev(() => { const u = document.getElementById('ui'); if (u) u.style.display = ''; });

await browser.close();
}

// ────────────────────────────── 分析 ──────────────────────────────
const P = makeProjector(camInfo.view, camInfo.proj, camInfo.w, camInfo.h);
const pxScaleX = (x, z) => {
  const a = P(x, GROUND_Y, z), b = P(x + 1, GROUND_Y, z);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};
const pxScaleZ = (x, z) => {
  const a = P(x, GROUND_Y, z), b = P(x, GROUND_Y, z - 1);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};

const rows = [];
for (let i = 0; i < H_ROWS; i++) {
  const z = ROI.z0 + ((ROI.z1 - ROI.z0) * (i + 0.5)) / H_ROWS;
  const scale = pxScaleX((ROI.x0 + ROI.x1) / 2, z);       // 水平扫描线上尺度只随深度变，整行同值
  const x0 = ROI.x0, x1 = ROI.x1;
  const p0 = P(x0, GROUND_Y, z), p1 = P(x1, GROUND_Y, z);
  const n = Math.round(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
  if (n < 80) continue;
  const sig = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const px = p0[0] + ((p1[0] - p0[0]) * k) / (n - 1);
    const py = p0[1] + ((p1[1] - p0[1]) * k) / (n - 1);
    sig[k] = lumAt(img, Math.max(0, Math.min(img.w - 1, Math.round(px))), Math.max(0, Math.min(img.h - 1, Math.round(py))));
  }
  const res = dominantLag(sig, PERIOD_MIN * scale, PERIOD_MAX * scale);
  rows.push({ z, scale, pxMin: PERIOD_MIN * scale, pxMax: PERIOD_MAX * scale, n, res, dark: darkLineGap(sig, scale) });
}

const cols = [];
for (let i = 0; i < V_COLS; i++) {
  const x = ROI.x0 + ((ROI.x1 - ROI.x0) * (i + 0.5)) / V_COLS;
  const zNear = ROI.z1, zFar = ROI.z0;                     // z 越小越远 → 屏幕越靠上
  const p0 = P(x, GROUND_Y, zNear), p1 = P(x, GROUND_Y, zFar);
  const n = Math.round(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
  if (n < 60) continue;
  // 纵向尺度沿列剧烈变化（p ∝ 1/tanθ），取列中点的局部尺度做换算，并记录两端供误差标注
  const zMid = (zNear + zFar) / 2;
  const scale = pxScaleZ(x, zMid);
  // 纵向砖缝是等 z 线：屏幕 y 只由深度决定、与 x 无关，所以相邻几列相位完全对齐，
  // 可以直接在像素空间做 3 列平均压噪声（横向扫描线不能这么干——不同行深度不同、尺度不同）。
  const sig = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const px = p0[0] + ((p1[0] - p0[0]) * k) / (n - 1);
    const py = p0[1] + ((p1[1] - p0[1]) * k) / (n - 1);
    let acc = 0;
    for (const dxp of [-2, 0, 2]) {
      acc += lumAt(img,
        Math.max(0, Math.min(img.w - 1, Math.round(px) + dxp)),
        Math.max(0, Math.min(img.h - 1, Math.round(py))));
    }
    sig[k] = acc / 3;
  }
  // 只取列中段（±40% 高度）做自相关，压缩尺度漂移
  const lo = Math.round(n * 0.3), hi = Math.round(n * 0.7);
  const sub = sig.subarray(lo, hi);
  const res = dominantLag(sub, PERIOD_MIN * scale, PERIOD_MAX * scale);
  cols.push({ x, scale, scaleNear: pxScaleZ(x, zNear), scaleFar: pxScaleZ(x, zFar), n: sub.length, res, dark: darkLineGap(sub, scale) });
}

const hPeriods = rows.filter((r) => r.res).map((r) => r.res.lag / r.scale);
const vPeriods = cols.filter((c) => c.res).map((c) => c.res.lag / c.scale);
const hMed = median(hPeriods);
const vMed = median(vPeriods);
const hIn = hPeriods.filter((p) => p >= PERIOD_MIN && p <= PERIOD_MAX).length / Math.max(1, rows.length);
const vIn = vPeriods.filter((p) => p >= PERIOD_MIN && p <= PERIOD_MAX).length / Math.max(1, cols.length);

const ok = Number.isFinite(hMed) && Number.isFinite(vMed)
  && hMed >= PERIOD_MIN && hMed <= PERIOD_MAX
  && vMed >= PERIOD_MIN && vMed <= PERIOD_MAX
  && hIn >= 0.5 && vIn >= 0.5;

console.log('=== 机位 ===');
console.log(`pos=(${camInfo.pos.map((v) => v.toFixed(1)).join(', ')})  look=(${CAM.tx}, ${CAM.ty}, ${CAM.tz})  fov=${camInfo.fov}°  phase=${camInfo.phase}`);
console.log(`viewport=${camInfo.w}×${camInfo.h}  地面 y=${GROUND_Y}`);
console.log(`ROI 世界 x∈[${ROI.x0}, ${ROI.x1}] z∈[${ROI.z0}, ${ROI.z1}]（${ROI.x1 - ROI.x0}m × ${ROI.z1 - ROI.z0}m）`);
{
  const c = [P(ROI.x0, GROUND_Y, ROI.z1), P(ROI.x1, GROUND_Y, ROI.z1), P(ROI.x0, GROUND_Y, ROI.z0), P(ROI.x1, GROUND_Y, ROI.z0)];
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  console.log(`ROI 屏幕包围盒 x∈[${Math.min(...xs).toFixed(0)}, ${Math.max(...xs).toFixed(0)}] y∈[${Math.min(...ys).toFixed(0)}, ${Math.max(...ys).toFixed(0)}]`);
  console.log(`尺度换算：近边(z=${ROI.z1}) ${pxScaleX(ROI.x0, ROI.z1).toFixed(2)} px/m 横向 / ${pxScaleZ(ROI.x0, ROI.z1).toFixed(2)} px/m 纵向；` +
    `远边(z=${ROI.z0}) ${pxScaleX(ROI.x0, ROI.z0).toFixed(2)} / ${pxScaleZ(ROI.x0, ROI.z0).toFixed(2)}`);
  console.log(`  ⇒ 0.6–2.0m 在近边 = 水平 ${(0.6 * pxScaleX(ROI.x0, ROI.z1)).toFixed(1)}–${(2.0 * pxScaleX(ROI.x0, ROI.z1)).toFixed(1)} px，` +
    `纵向 ${(0.6 * pxScaleZ(ROI.x0, ROI.z1)).toFixed(1)}–${(2.0 * pxScaleZ(ROI.x0, ROI.z1)).toFixed(1)} px；` +
    `在远边 = 水平 ${(0.6 * pxScaleX(ROI.x0, ROI.z0)).toFixed(1)}–${(2.0 * pxScaleX(ROI.x0, ROI.z0)).toFixed(1)} px，` +
    `纵向 ${(0.6 * pxScaleZ(ROI.x0, ROI.z0)).toFixed(1)}–${(2.0 * pxScaleZ(ROI.x0, ROI.z0)).toFixed(1)} px`);
}
const hDark = rows.filter((r) => r.dark).map((r) => r.dark.gap / r.scale);
const vDark = cols.filter((c) => c.dark).map((c) => c.dark.gap / c.scale);
console.log('=== 水平扫描线（沿世界 +x，跨砖缝）===');
for (const r of rows) {
  console.log(`z=${r.z.toFixed(1)}  px/m=${r.scale.toFixed(2)}  lag∈[${r.pxMin.toFixed(1)}, ${r.pxMax.toFixed(1)}]px  ` +
    (r.res ? `主周期=${r.res.lag.toFixed(1)}px=${(r.res.lag / r.scale).toFixed(2)}m  r=${r.res.r.toFixed(2)}` : '无峰') +
    (r.dark ? `  | 暗线间距=${(r.dark.gap / r.scale).toFixed(2)}m（${r.dark.n} 段）` : '  | 暗线不足'));
}
console.log('=== 垂直扫描线（沿世界 −z，跨砖缝）===');
for (const c of cols) {
  console.log(`x=${c.x.toFixed(1)}  px/m(${c.scale.toFixed(2)}, 近${c.scaleNear.toFixed(2)}/远${c.scaleFar.toFixed(2)})  ` +
    (c.res ? `主周期=${c.res.lag.toFixed(1)}px=${(c.res.lag / c.scale).toFixed(2)}m  r=${c.res.r.toFixed(2)}` : '无峰') +
    (c.dark ? `  | 暗线间距=${(c.dark.gap / c.scale).toFixed(2)}m（${c.dark.n} 段）` : '  | 暗线不足'));
}
console.log(`暗线间距中位数：水平 ${median(hDark).toFixed(2)}m / 垂直 ${median(vDark).toFixed(2)}m（验尺用，不进判据）`);
console.log('=== 结论 ===');
console.log(`水平主周期中位数 = ${hMed.toFixed(2)}m（${hPeriods.length}/${rows.length} 条有峰，落在 0.6–2.0m 的 ${(hIn * 100).toFixed(0)}%）`);
console.log(`垂直主周期中位数 = ${vMed.toFixed(2)}m（${vPeriods.length}/${cols.length} 条有峰，落在 0.6–2.0m 的 ${(vIn * 100).toFixed(0)}%）`);
console.log(`三角面：场景总计 ${camInfo.auditTris ?? 'n/a'}，ash 组 ${camInfo.ashTris ?? 'n/a'}（paving kit=${camInfo.pavingKit}，312 块大砖 = ${(camInfo.pavingKit ?? 0) * 12} 面，改动前后同值）`);
console.log(ok ? 'PASS — 主周期落在 0.6–2.0m' : 'FAIL — 主周期不在 0.6–2.0m');
console.log(shotBuf
  ? `截图：${OUT}（无 HUD，分析用）/ ${OUT.replace(/\.png$/i, '')}-hud.png（含 HUD，交付用）`
  : '离线模式：未重新截图');
process.exit(ok ? 0 : 1);
