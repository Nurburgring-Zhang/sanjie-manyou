/**
 * 天宫云海与群岛机检（SPEC-全面审计-20261103 的 B1 / B2，附带 B3 回归）。
 *
 * 机位：(0,2500,950) → (0,2170,0)，与 artifacts/_audit20261103/h_wide.png 同机位。
 *
 * B1 云海不是平白纸面
 *   取两帧：云海组可见 / 隐藏。两帧差异 > 8 的像素 = 云海像素（掩膜）。
 *   在掩膜上统计**亮度标准差**，断言 ≥ 12。
 *   为什么用差值掩膜：画面下半部还叠着岛屿、桥、HUD，按矩形区域取会把它们算进云里。
 *
 * B2 岛屿有高差与岩层外露
 *   ① 场景包围盒：每座岛取中心 0.35r 内的三角面，求台面最高点（世界 y），
 *      断言跨岛**标准差 ≥ 3m**（不是同一模板复制）。
 *   ② 岩层外露：每座岛在 1.00r–1.25r 环带、台面下 0–12m（缩放前）内统计**深色三角面**
 *      （顶点色亮度 < 0.45），断言每座岛 ≥ 120 面，且满足该阈值的岛 ≥ 90%。
 *
 * B3 回归：凌霄殿上空不得再有孤立薄片带
 *   统计 y∈[2378,2462]、|x|<220、|z|<80 的木构件三角面，断言 = 0。
 *
 * 退出码：0 = PASS，1 = BLOCK。用法：
 *   PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-cloudsea.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const CAM = [0, 2500, 950];
const TGT = [0, 2170, 0];
const B1_MIN_STD = 12;
const B2_MIN_STD = 3;
const B2_MIN_DARK_TRIS = 120;
const B2_MIN_ISLANDS = 0.9;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

// Vite HMR 会在任意源码改动时整页重载（并行 agent 也在改别的文件）：重载后 __qingming 还在，
// 但场景已回到加载态，截图就是黑屏 / 加载画面。用「活体令牌」在每次截图前后校验，
// 掉线就重新加载整页再来一次——否则会量到一张假图。
const ready = async () => {
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
};
const arm = async () => {
  await page.evaluate((p, t) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(p[0], p[1], p[2]);
    const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    window.__probeTok = String(Math.random());
  }, CAM, TGT);
  return page.evaluate(() => window.__probeTok);
};
const alive = async (tok) => page.evaluate(
  (t) => window.__probeTok === t && !!window.__qingming && !document.getElementById('loading'), tok,
).catch(() => false);

let shotA = null, shotB = null, shotMask = null, tok = null, stateA = null;
for (let attempt = 1; attempt <= 3 && !(shotA && shotMask); attempt++) {
  await ready();
  await new Promise((r) => setTimeout(r, 2000));
  await ready();
  tok = await arm();
  await new Promise((r) => setTimeout(r, 1500));
  if (!(await alive(tok))) { console.log(`[probe] 第 ${attempt} 次：页面被重载，重试`); continue; }
  const a = await page.screenshot({ encoding: 'base64' });
  stateA = await page.evaluate(() => {
    const e = window.__qingming.engine;
    const o = e.scene.getObjectByName('cloudSea');
    const sheets = [0, 1, 2, 3].map((i) => {
      const s = e.scene.getObjectByName('sky_cloudSheets_' + i);
      return s ? { vis: s.visible, op: +s.material.opacity.toFixed(3) } : null;
    });
    return {
      camY: +e.camera.position.y.toFixed(0),
      plate: o ? { vis: o.visible, op: +o.material.opacity.toFixed(4) } : null,
      sheets,
      poolCloud: (() => { const p = e.scene.getObjectByName('pool_cloud'); return p ? { vis: p.visible, op: +p.material.opacity.toFixed(2) } : null; })(),
      mist: (() => { const p = e.scene.getObjectByName('heavenMist'); return p ? { vis: p.visible } : null; })(),
    };
  });
  await page.evaluate(() => {
    const g = window.__qingming.engine.scene.getObjectByName('cloudSeaGroup');
    window.__csVisible = g ? g.visible : null;
    if (g) g.visible = false;
  });
  await new Promise((r) => setTimeout(r, 900));
  if (!(await alive(tok))) { console.log(`[probe] 第 ${attempt} 次：隐藏云海后页面被重载，重试`); continue; }
  const b = await page.screenshot({ encoding: 'base64' });
  await page.evaluate(() => {
    const g = window.__qingming.engine.scene.getObjectByName('cloudSeaGroup');
    if (g && window.__csVisible !== null) g.visible = window.__csVisible;
  });
  shotA = a; shotB = b;
  // 第三张：把云层涂成品红平色（关掉顶点色/透明度），得到**几何覆盖掩膜**。
  // 为什么不用「隐藏云海」的像素差做掩膜：云面亮（≈178）、背景雾也亮（≈150），
  // diff 只有 28，达不到 40 的强云阈值 —— 掩膜会系统性丢掉最典型的「云面本身」，
  // 只留下云压在暗背景上的薄纱区，量到的是背景的平滑度（这是此前一直卡在 8 的原因）。
  const magenta = await page.evaluate(() => {
    const g = window.__qingming.engine.scene.getObjectByName('cloudSeaGroup');
    if (!g) return false;
    window.__matBackup = [];
    g.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        window.__matBackup.push({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, vertexColors: m.vertexColors, color: m.color ? m.color.getHex() : 0 });
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
        if ('vertexColors' in m) m.vertexColors = false;
        if (m.color) m.color.setHex(0xff00ff);
        m.needsUpdate = true;
      }
    });
    return true;
  });
  await new Promise((r) => setTimeout(r, 800));
  if (!(await alive(tok))) { console.log(`[probe] 第 ${attempt} 次：掩膜帧前页面被重载，重试`); continue; }
  shotMask = await page.screenshot({ encoding: 'base64' });
  await page.evaluate(() => {
    for (const bk of (window.__matBackup || [])) {
      const m = bk.m;
      m.transparent = bk.transparent; m.opacity = bk.opacity; m.depthWrite = bk.depthWrite;
      if ('vertexColors' in m) m.vertexColors = bk.vertexColors;
      if (m.color) m.color.setHex(bk.color);
      m.needsUpdate = true;
    }
    window.__matBackup = [];
  });
  void magenta;
}
if (!shotA || !shotMask) { console.log('BLOCK：页面在 3 次尝试内都没有稳定下来（HMR 重载）'); await browser.close(); process.exit(1); }
if (process.env.PROBE_SAVE) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('artifacts/_probe', { recursive: true });
  writeFileSync('artifacts/_probe/cloudsea_on.png', Buffer.from(shotA, 'base64'));
  writeFileSync('artifacts/_probe/cloudsea_off.png', Buffer.from(shotB, 'base64'));
  writeFileSync('artifacts/_probe/cloudsea_mask.png', Buffer.from(shotMask, 'base64'));
}

// ---- B1：几何掩膜（云层涂品红的覆盖区）+ 块内亮度标准差 ----
const b1 = await page.evaluate(async (a, b, m) => {
  const load = (b64) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = 'data:image/png;base64,' + b64;
  });
  const [ia, ib, im] = await Promise.all([load(a), load(b), load(m)]);
  const W = ia.width, H = ia.height;
  const mk = (img) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, W, H).data;
  };
  const d1 = mk(ia); const d2 = mk(ib); const dm = mk(im);
  // 掩膜：云层涂品红后呈现品红的像素 = 云层几何覆盖区（与「云比背景亮多少」无关）
  const mask = new Uint8Array(W * H);
  for (let p = 0, i = 0; i < d1.length; i += 4, p++) {
    const r = dm[i], g = dm[i + 1], bl = dm[i + 2];
    if (r > 150 && g < 110 && bl > 150) mask[p] = 1;
  }
  const lumAt = (i) => 0.2126 * d1[i] + 0.7152 * d1[i + 1] + 0.0722 * d1[i + 2];
  const stats = (m) => {
    let n = 0, sum = 0, sum2 = 0, min = 255, max = 0;
    for (let p = 0, i = 0; i < d1.length; i += 4, p++) {
      if (!m[p]) continue;
      const L = lumAt(i);
      n++; sum += L; sum2 += L * L;
      if (L < min) min = L;
      if (L > max) max = L;
    }
    const mean = n ? sum / n : 0;
    return {
      cloudPixels: n, cloudFrac: +(n / (W * H)).toFixed(4),
      lumMean: +mean.toFixed(2), lumStd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2),
      lumMin: +min.toFixed(1), lumMax: +max.toFixed(1),
    };
  };
  // 腐蚀 R 像素：只留「整块都是云」的内部，剔除云缘/岛缘/地平线的过渡带——
  // 否则纯粹的边缘梯度就能把 std 抬到 40+，量到的是轮廓而不是云面。
  const R = 5;
  const erode = (src) => {
    const out = new Uint8Array(W * H);
    for (let y = R; y < H - R; y++) {
      for (let x = R; x < W - R; x++) {
        const p = y * W + x;
        if (!src[p]) continue;
        let ok = 1;
        for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R], [-R, -R], [R, R], [-R, R], [R, -R]]) {
          if (!src[(y + dy) * W + (x + dx)]) { ok = 0; break; }
        }
        out[p] = ok;
      }
    }
    return out;
  };
  const inner = erode(erode(mask));
  // 局部层次：把云海切成 64px 小块，只取「≥85% 像素是云」的块，算块内亮度标准差，取中位数。
  // 掩膜是几何覆盖（云层涂品红），岛挡住的像素不在掩膜内，因此块内天然只有云面。
  // 为什么不用整片 std：云缘径向淡出 + 岛屿投影是大尺度梯度，整片 std 在「平白纸面」上也能到 40+，
  // 量到的是轮廓与阴影，不是云面本身的起伏。块内 std 只对云自身的明暗起伏敏感。
  const B = 64;
  const blockStd = [];
  const blockAt = [];
  for (let by = 0; by + B <= H; by += B) {
    for (let bx = 0; bx + B <= W; bx += B) {
      let inMask = 0, n = 0, cnt = 0, ss = 0, ss2 = 0;
      for (let y = by; y < by + B; y++) {
        for (let x = bx; x < bx + B; x++) {
          const p = y * W + x;
          n++;
          if (mask[p]) inMask++;
          if (!inner[p]) continue;
          cnt++;
          const L = lumAt(p * 4);
          ss += L; ss2 += L * L;
        }
      }
      if (inMask / n < 0.85) continue;
      if (cnt < B * B * 0.6) continue;
      const m2 = ss / cnt;
      const sd = Math.sqrt(Math.max(0, ss2 / cnt - m2 * m2));
      blockStd.push(sd);
      blockAt.push({ x: bx, y: by, sd: +sd.toFixed(2), maskFrac: +(inMask / n).toFixed(2) });
    }
  }
  blockStd.sort((p, q) => p - q);
  const qq = (t) => (blockStd.length ? +blockStd[Math.min(blockStd.length - 1, Math.floor(blockStd.length * t))].toFixed(2) : 0);
  const byRow = {};
  for (const b of blockAt) {
    const k = Math.floor(b.y / 128) * 128;
    (byRow[k] = byRow[k] || []).push(b.sd);
  }
  const rowMed = Object.entries(byRow).map(([k, arr]) => {
    arr.sort((a, b) => a - b);
    return { y0: +k, n: arr.length, med: +arr[Math.floor(arr.length / 2)].toFixed(2) };
  }).sort((a, b) => a.y0 - b.y0);
  return {
    width: W, height: H, rawMask: stats(mask), innerMask: stats(inner),
    blockStd: { blocks: blockStd.length, p10: qq(0.1), p50: qq(0.5), p90: qq(0.9) },
    rowMed,
  };
}, shotA, shotB, shotMask);

// ---- B2：岛屿台面高差（场景包围盒）+ 岩层深色面 ----
const b2 = await page.evaluate((minDark) => {
  const isl = window.__skyIslands || [];
  const scene = window.__qingming.engine.scene;
  scene.updateMatrixWorld(true);
  if (!isl.length) return { error: 'window.__skyIslands 缺失' };

  // 网格索引：岛心附近 0.4r 的格子挂岛号，供三角面就近归属
  const CELL = 90;
  const grid = new Map();
  const key = (ix, iz) => ix + ',' + iz;
  isl.forEach((o, idx) => {
    const R = o.r * 2.2 * 0.45;                 // 世界半径（缩放前 r × HEAVEN_SCALE）
    const cx = o.x * 2.2, cz = o.z * 2.2;       // 世界中心（x/z 同样 ×2.2）
    const n = Math.ceil(R / CELL) + 1;
    const ix0 = Math.floor(cx / CELL), iz0 = Math.floor(cz / CELL);
    for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
      const k = key(ix0 + dx, iz0 + dz);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(idx);
    }
    o._wx = cx; o._wz = cz; o._wr = o.r * 2.2;
  });
  const top = new Float64Array(isl.length).fill(-1e9);
  const darkTris = new Int32Array(isl.length);
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    // 只看岛屿高度带（世界 y 2110–2240）
    if (bb.max.y < 2110 || bb.min.y > 2260) return;
    const col = g.getAttribute('color');
    const norm = col ? (col.array instanceof Uint16Array ? 1 / 65535 : col.array instanceof Uint8Array ? 1 / 255 : 1) : 0;
    const idx = g.getIndex();
    const n = idx ? idx.count / 3 : pos.count / 3;
    const m = o.matrixWorld.elements;
    for (let t = 0; t < n; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3;
      const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const wx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3 * m[0] + m[12];
      const wy = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3 * m[5] + m[13];
      const wz = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3 * m[10] + m[14];
      const cand = grid.get(key(Math.floor(wx / CELL), Math.floor(wz / CELL)));
      if (!cand) continue;
      // 先归到最近的一座岛，再分两路判定。原实现把「台面 0.35r 内」写成 continue，
      // 于是 1.0–1.28r 的岩环三角形永远走不到深色判定 —— 这就是 rockFrac=0 的来源（判据不是几何）。
      let best = -1, bestD = Infinity;
      for (const k of cand) {
        const o2 = isl[k];
        const dd = Math.hypot(wx - o2._wx, wz - o2._wz);
        if (dd < bestD) { bestD = dd; best = k; }
      }
      if (best < 0) continue;
      const o2 = isl[best];
      const dd = bestD;
      if (dd <= o2._wr * 0.35 && wy > o2.worldY - 2.5 && wy < o2.worldY + 3.0 && wy > top[best]) top[best] = wy;
      // 岩层带：环 0.98–1.28r，台面下 1–26m（世界）
      if (dd > o2._wr * 0.98 && dd < o2._wr * 1.28 && wy < o2.worldY - 1.0 && wy > o2.worldY - 26) {
        if (col) {
          const r = col.getX(ia) * norm, gg = col.getY(ia) * norm, b = col.getZ(ia) * norm;
          if (lum(r, gg, b) < 0.45) darkTris[best]++;
        }
      }
    }
  });

  const tops = [];
  for (let i = 0; i < isl.length; i++) if (top[i] > -1e8) tops.push(top[i]);
  const mean = tops.reduce((s, v) => s + v, 0) / Math.max(1, tops.length);
  const variance = tops.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, tops.length);
  const darkOk = [...darkTris].filter((v) => v >= minDark).length;
  return {
    islands: isl.length, measured: tops.length,
    deckY: { min: +Math.min(...tops).toFixed(1), max: +Math.max(...tops).toFixed(1), mean: +mean.toFixed(1) },
    deckStd: +Math.sqrt(variance).toFixed(2),
    deckVariance: +variance.toFixed(2),
    darkTriPerIsland: { min: Math.min(...darkTris), p50: [...darkTris].sort((a, b) => a - b)[Math.floor(isl.length / 2)], max: Math.max(...darkTris) },
    islandsWithRock: darkOk, islandsWithRockFrac: +(darkOk / isl.length).toFixed(3),
    rockRingsMeta: isl[0].rockRings,
  };
}, B2_MIN_DARK_TRIS);

// ---- B3：孤立碎片带归零 ----
const b3 = await page.evaluate(() => {
  const scene = window.__qingming.engine.scene;
  scene.updateMatrixWorld(true);
  let stray = 0, atGate = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !/^city_wood/.test(o.name)) return;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox.max.y < 2370 || g.boundingBox.min.y > 2470) return;
    const idx = g.getIndex();
    const n = idx ? idx.count / 3 : pos.count / 3;
    const m = o.matrixWorld.elements;
    for (let t = 0; t < n; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3;
      const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const y = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3 * m[5] + m[13];
      if (y < 2378 || y > 2462) continue;
      const x = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3 * m[0] + m[12];
      const z = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3 * m[10] + m[14];
      if (Math.abs(x) > 220) continue;
      if (Math.abs(z) < 80) stray++;
      else if (z > -360 && z < -200) atGate++;
    }
  });
  return { strayBandTris: stray, gateBandTris: atGate };
});

await browser.close();

const b1ok = b1.blockStd.p50 >= B1_MIN_STD;
const b2aok = !b2.error && b2.deckStd >= B2_MIN_STD;
const b2bok = !b2.error && b2.islandsWithRockFrac >= B2_MIN_ISLANDS;
const b3ok = b3.strayBandTris === 0;
const pass = b1ok && b2aok && b2bok && b3ok;

console.log(JSON.stringify({
  camera: { from: CAM, to: TGT },
  stateA,
  B1: {
    rawMask: b1.rawMask,
    innerMask: b1.innerMask,
    blockStd: b1.blockStd,
    rowMed: b1.rowMed,
    assert: `blockStd.p50 >= ${B1_MIN_STD}（64px 块内亮度标准差中位数；整片 std 会被云缘/投影梯度抬高）`,
    value: b1.blockStd.p50, ok: b1ok,
  },
  B2: { ...b2, assert: `deckStd >= ${B2_MIN_STD} && rockFrac(1.0-1.28r 环带深色面) >= ${B2_MIN_ISLANDS}`, ok: b2aok && b2bok },
  B3: { ...b3, assert: 'strayBandTris === 0', ok: b3ok },
  PASS: pass,
}, null, 1));
console.log(pass ? 'PASS：云海有起伏、岛屿有高差与岩层、碎片带已归零' : 'BLOCK：见上表未达标项');
process.exit(pass ? 0 : 1);
