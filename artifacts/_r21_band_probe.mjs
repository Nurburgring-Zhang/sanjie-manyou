/**
 * R21 山体植被带 / 层理「顶点色 buffer」运行时取证。
 * 单 browser 实例 / 单 page / finally 显式 browser.close()。
 *
 * 借 window.__qingming.scene.getObjectByName('terrain') 读顶点色 + position，
 * 以泰山 ROI (14000,-6000,r=3600, y>45) 按高度分 5 带，统计每带 RGB 均值
 * 与 16 桶亮度直方图；另做一次可逆 MeshBasicMaterial(vertexColors,fog:false)
 * 诊断截图，用于区分「顶点色 buffer 本身没梯度」还是「渲染链把梯度冲淡」。
 *
 * 用法（修前基线）：
 *   PROBE_URL=http://127.0.0.1:4173/ PROBE_TAG=baseline \
 *   PROBE_SHOT=artifacts/_r21_before.png PROBE_BASIC_SHOT=artifacts/_r21_before_basic.png \
 *   CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
 *   node artifacts/_r21_band_probe.mjs
 *
 * 用法（修后，直编 vite dev 5176）：
 *   PROBE_URL=http://127.0.0.1:5176/ PROBE_TAG=fixed \
 *   PROBE_SHOT=artifacts/_r21_after.png PROBE_BASIC_SHOT=artifacts/_r21_after_basic.png ...
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4173/';
const TAG = process.env.PROBE_TAG || 'baseline';
const SHOT = process.env.PROBE_SHOT || '';
const BASIC_SHOT = process.env.PROBE_BASIC_SHOT || '';
const OUT_JSON = 'artifacts/r21-mtn-band.json';
const EDGE = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const P = [10500, 700, -3900];
const C = [14000, 850, -6000];
const NB = 5, NH = 16;

let LAUNCH_COUNT = 0, PAGE_COUNT = 0, browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  LAUNCH_COUNT++;
  const page = await browser.newPage(); PAGE_COUNT++;
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CON:' + m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2600));
  await page.evaluate(() => { try { window.__qingming.world.teleport('countryside'); } catch (e) { /* ignore */ } });
  await new Promise((r) => setTimeout(r, 500));

  const setView = () => page.evaluate(([p, c]) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
    e.camera.position.set(p[0], p[1], p[2]);
    const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
    e.lookTarget.set(c[0], c[1], c[2]);
  }, [P, C]);
  await setView();
  await new Promise((r) => setTimeout(r, 1600));

  const data = await page.evaluate((NB, NH) => {
    const q = window.__qingming, T = q.scene.getObjectByName('terrain');
    if (!T) return { terrainFound: false };
    const geo = T.geometry, col = geo.attributes.color, pos = geo.attributes.position, arr = col.array;
    const mat = T.material;
    const material = {
      type: mat.type, vertexColors: mat.vertexColors, fog: mat.fog,
      hasMap: !!mat.map, mapColorSpace: mat.map?.colorSpace ?? null,
      onBeforeCompileHasHaze: typeof mat.onBeforeCompile === 'function' && /uFarHaze/.test(mat.onBeforeCompile.toString()),
      cacheKey: typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey() : null,
      toneMapping: q.engine.renderer.toneMapping, exposure: q.engine.renderer.toneMappingExposure,
    };
    const mesh = {
      name: T.name, posCount: pos.count, colorCount: col.count, colorItemSize: col.itemSize,
      colorArrayType: arr.constructor.name, indexCount: geo.index?.count ?? null,
    };
    const cx = 14000, cz = -6000, R = 3600, H = 1550;
    const mk = () => ({ n: 0, sr: 0, sg: 0, sb: 0, sl: 0, hist: new Array(NH).fill(0) });
    const all = mk();
    const bands = Array.from({ length: NB }, mk);
    for (let i = 0; i < col.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const r = arr[i * 3], g = arr[i * 3 + 1], b = arr[i * 3 + 2];
      const L = (r + g + b) / 3;
      const hi = Math.max(0, Math.min(NH - 1, Math.floor(L * NH)));
      const put = (a) => { a.n++; a.sr += r; a.sg += g; a.sb += b; a.sl += L; a.hist[hi]++; };
      put(all);
      if (y > 45 && Math.hypot(x - cx, z - cz) < R) {
        const bi = Math.max(0, Math.min(NB - 1, Math.floor((y / H) * NB)));
        put(bands[bi]);
      }
    }
    const fin = (a) => ({
      n: a.n,
      meanRGB: [a.sr / a.n, a.sg / a.n, a.sb / a.n].map((v) => +v.toFixed(4)),
      meanL: +(a.sl / Math.max(1, a.n)).toFixed(4),
      histL16: a.hist,
      histPct: a.hist.map((h) => +(100 * h / Math.max(1, a.n)).toFixed(2)),
    });
    const roiHist = new Array(NH).fill(0);
    bands.forEach((b) => b.hist.forEach((h, k) => { roiHist[k] += h; }));
    const roiN = bands.reduce((s, b) => s + b.n, 0);
    const roiPct = roiHist.map((h) => +(100 * h / Math.max(1, roiN)).toFixed(2));
    // 双峰：两个局部峰，间隔 >=3 桶，各峰占比 >=6%
    const peaks = [];
    for (let k = 1; k < NH - 1; k++)
      if (roiPct[k] >= roiPct[k - 1] && roiPct[k] >= roiPct[k + 1] && roiPct[k] >= 6) peaks.push(k);
    let bimodal = false, peakPair = null;
    for (let a = 0; a < peaks.length; a++) for (let b = a + 1; b < peaks.length; b++)
      if (peaks[b] - peaks[a] >= 3) { bimodal = true; peakPair = [peaks[a], peaks[b]]; }
    const meanL = bands.map((b) => b.n ? +(b.sl / b.n).toFixed(4) : 0);
    const pairs = [];
    for (let i = 0; i < NB; i++) for (let j = i + 1; j < NB; j++)
      pairs.push({ bands: [i, j], dL: +Math.abs(meanL[i] - meanL[j]).toFixed(4) });
    return {
      terrainFound: true,
      bundle: [...document.querySelectorAll('script[type="module"]')].map((s) => s.src.split('/').pop()),
      material, mesh, colorAll: fin(all),
      bands: bands.map((b, i) => ({ band: i, yRange: [+(i * H / NB).toFixed(0), +((i + 1) * H / NB).toFixed(0)], ...fin(b) })),
      bandMeanL: meanL, pairDiffs: pairs, pairsGe012: pairs.filter((p) => p.dL >= 0.12).length,
      roiHistL16: roiHist, roiHistPct: roiPct, roiN,
      lumiPeaks: peaks, bimodal, peakPair,
      nonEmptyBuckets: roiPct.filter((p) => p >= 1).length,
    };
  }, NB, NH);

  if (SHOT) { await setView(); await new Promise((r) => setTimeout(r, 900)); await page.screenshot({ path: SHOT }); }

  // 可逆诊断：MeshBasicMaterial 直接显示顶点色（去光照/去雾/去贴图），判断梯度是否在 buffer 里
  if (BASIC_SHOT) {
    await page.evaluate(() => {
      const q = window.__qingming, T = q.scene.getObjectByName('terrain'), THREE = q.THREE;
      window.__r21SavedMat = T.material;
      T.material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    });
    await setView(); await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: BASIC_SHOT });
    await page.evaluate(() => {
      const T = window.__qingming.scene.getObjectByName('terrain');
      if (window.__r21SavedMat) { T.material = window.__r21SavedMat; window.__r21SavedMat = null; }
    });
  }

  let j = {};
  if (fs.existsSync(OUT_JSON)) { try { j = JSON.parse(fs.readFileSync(OUT_JSON, 'utf-8')); } catch (e) { /* ignore */ } }
  j[TAG] = {
    url: URL, tag: TAG, ts: new Date().toISOString(), cameraPos: P, lookTarget: C,
    launchCount: LAUNCH_COUNT, pageCount: PAGE_COUNT, errors: errs,
    shot: SHOT || null, basicShot: BASIC_SHOT || null, ...data,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(j, null, 2));
  console.log('TAG', TAG, 'terrainFound', data.terrainFound);
  console.log('BUNDLE', JSON.stringify(data.bundle));
  console.log('MATERIAL', JSON.stringify(data.material));
  console.log('MESH', JSON.stringify(data.mesh));
  console.log('COLOR_ALL_RGB', JSON.stringify(data.colorAll?.meanRGB), 'L', data.colorAll?.meanL);
  console.log('BAND_MEAN_L', JSON.stringify(data.bandMeanL));
  console.log('BANDS_RGB', JSON.stringify(data.bands?.map((b) => b.meanRGB)));
  console.log('PAIRS_GE_0.12', data.pairsGe012, 'of', data.pairDiffs?.length);
  console.log('ROI_HIST_PCT', JSON.stringify(data.roiHistPct));
  console.log('NONEMPTY_BUCKETS', data.nonEmptyBuckets, 'BIMODAL', data.bimodal, 'peaks', JSON.stringify(data.lumiPeaks));
  console.log('ERRORS', errs.length ? errs.slice(0, 4).join(' | ') : 'NONE');
  console.log('WROTE', OUT_JSON, SHOT || '', BASIC_SHOT || '');
} finally {
  if (browser) await browser.close();
  console.log('LAUNCH_COUNT', LAUNCH_COUNT, 'PAGE_COUNT', PAGE_COUNT, 'BROWSER_CLOSED: YES');
}
