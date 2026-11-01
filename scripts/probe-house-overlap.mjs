/**
 * 房屋干涉消解验收探针（tier0/tier1 里坊）。
 *
 * 机检三件事：
 *   ① 离线普查：w9OverlapProbe() 与生产同一套 planWard → wardWall → emitFill → 消解，
 *      输出改前 / 改后 OBB 相交对数；改后必须只剩 shop-shop 豁免（应为 0）。
 *   ② 生产台账：window.__infillDrop —— 与场景同一批桶的 pre/post、按 kind 的删除分布、
 *      店铺改前/改后件数（逐实例数组比对）。
 *   ③ 出图：俯视里坊 / 临街店铺 / tier1 远档，三张均做亮度与近白占比统计，防空白帧。
 *
 * 用法：node scripts/probe-house-overlap.mjs
 *   URL=http://127.0.0.1:4255/   W=1600 H=900   OUT=screenshots/house-overlap
 * 退出码：0 = 全过；1 = 有判据不满足。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://127.0.0.1:4255/';
const OUT = process.env.OUT || 'screenshots/house-overlap';
const W = Number(process.env.W || 1600);
const H = Number(process.env.H || 900);

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  protocolTimeout: 300000,
  args: [`--window-size=${W},${H}`, '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('[console] ' + m.text().slice(0, 300));
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming,
  { timeout: 300000, polling: 250 },
);
const loadMs = Date.now() - t0;
await new Promise((r) => setTimeout(r, 1200));

// ---- ① 离线普查（与生产同一套规划器 + 消解器） ----
const probe = await page.evaluate(async () => {
  const mod = await import('/src/city/infill.ts');
  return mod.w9OverlapProbe();
});

// ---- ② 生产构建台账 ----
const live = await page.evaluate(() => window.__infillDrop ?? null);
const timings = await page.evaluate(() => window.__loadTimings ?? null);
const infillStep = Array.isArray(timings)
  ? (timings.find(([k]) => String(k).includes('里坊民居')) || [null, null])[1]
  : null;

fs.mkdirSync(OUT, { recursive: true });

// ---- ③ 三张图 ----
const scene = await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
  const d = window.__infillDrop;
  return { wards: d?.wards ?? [], shops: d?.shopSamples ?? [] };
});

const nearest = (tier, x, z) => {
  let best = null, bd = Infinity;
  for (const w of scene.wards) {
    if (w.tier !== tier) continue;
    const d = Math.hypot(w.cx - x, w.cz - z);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
};
const ward0 = nearest(0, 1300, 1300) || { cx: 1300, cz: 1300 };
const ward1 = nearest(1, 2100, 2100) || { cx: 2100, cz: 2100 };

const setCam = async (pos, target) => {
  await page.evaluate(([p, t]) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(p[0], p[1], p[2]);
    e.lookTarget.set(t[0], t[1], t[2]);
    const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.camera.lookAt(t[0], t[1], t[2]);
    e.camera.updateMatrixWorld(true);
  }, [pos, target]);
  await new Promise((r) => setTimeout(r, 1400));
};

/**
 * 直接解 PNG 算亮度统计。WebGL canvas 没开 preserveDrawingBuffer，
 * 事后 drawImage 拿到的是已清空的缓冲（三张图都会被误判成全黑）；
 * 截图文件本身是完整的，用 stdlib zlib 解非隔行 8bit RGB/RGBA 即可。
 */
function pngStats(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png: ' + file);
  let pos = 8, w = 0, h = 0, bit = 0, color = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bit = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bit !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
    throw new Error(`unsupported png ${bit}bit color=${color} interlace=${interlace}`);
  }
  const ch = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = x >= ch && y > 0 ? out[o - stride + x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[o + x] = v & 255;
    }
  }
  const lum = [];
  let white = 0, n = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * ch;
      lum.push(0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]);
      n++;
      if (out[i] > 244 && out[i + 1] > 244 && out[i + 2] > 244) white++;
    }
  }
  lum.sort((a, b) => a - b);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  return {
    mean: +mean.toFixed(1),
    median: +lum[Math.floor(lum.length / 2)].toFixed(1),
    p95: +lum[Math.floor(lum.length * 0.95)].toFixed(1),
    whitePct: +((white / n) * 100).toFixed(1),
  };
}

const shots = [];
const shoot = async (name, pos, target) => {
  await setCam(pos, target);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  const stats = pngStats(file);
  shots.push({ name, file, pos, target, stats });
};

// 俯视里坊：站在 tier0 坊心南侧上方，能同时看到多户屋顶与院墙
await shoot(
  '01-top-ward.png',
  [ward0.cx - 70, 125, ward0.cz + 105],
  [ward0.cx, 0, ward0.cz],
);

// 临街视角：先选一间门前最开阔的铺面——沿门脸法线做短射线，取 3.5m 外首个遮挡最远的样本，
// 避免相机退到隔壁院墙里（上一版 15m 机位就撞上了对面的墙）。
const shopPick = await page.evaluate(() => {
  const Q = window.__qingming;
  const T = Q?.THREE;
  const list = (window.__infillDrop?.shopSamples ?? []).slice(0, 10);
  if (!T || !list.length) return [];
  const ray = new T.Raycaster();
  const o = new T.Vector3(), d = new T.Vector3();
  ray.far = 22;
  const out = [];
  for (const s of list) {
    o.set(s.x, 2.2, s.z);
    d.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    ray.set(o, d);
    let block = null;
    for (const h of ray.intersectObjects(Q.engine.scene.children, true)) {
      if (h.distance <= 3.5) continue; // 3.5m 内是柜台 / 檐柱自身
      block = h.distance;
      break;
    }
    out.push({ ...s, block });
  }
  return out;
});
const shop = shopPick.length
  ? shopPick.sort((a, b) => (b.block ?? 99) - (a.block ?? 99))[0]
  : scene.shops[0];

// 临街视角：3/4 侧前方，退到门前最开阔处
if (shop) {
  const nx = Math.sin(shop.yaw), nz = Math.cos(shop.yaw);
  const tx = Math.cos(shop.yaw), tz = -Math.sin(shop.yaw);
  const back = Math.max(8, Math.min(13, (shop.block ?? 13) - 1.5));
  await shoot(
    '02-street-shop.png',
    [shop.x + nx * back + tx * 3.5, 3.2, shop.z + nz * back + tz * 3.5],
    [shop.x, 2.6, shop.z],
  );
} else {
  await shoot(
    '02-street-shop.png',
    [ward0.cx + 20, 6, ward0.cz + 20],
    [ward0.cx, 3, ward0.cz],
  );
}

// tier1 远档：距坊心约 460m，看整片简院是否明显变稀
await shoot(
  '03-tier1-far.png',
  [ward1.cx + 180, 150, ward1.cz + 420],
  [ward1.cx, 0, ward1.cz],
);

// ---- 同环境 A/B：?noOverlap=1 再载一次，量出这步新增的真实 CPU 成本 ----
// headless SwiftShader 的绝对载入时间与用户机器不可比（当前 40s+ vs 用户基线 8.7s），
// 所以用「同一环境、同一条加载流水线」的里坊步骤差值作为增量证据。
const abPage = await browser.newPage();
await abPage.setViewport({ width: W, height: H });
const abUrl = URL + (URL.includes('?') ? '&' : '?') + 'noOverlap=1';
const tab0 = Date.now();
await abPage.goto(abUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
await abPage.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming,
  { timeout: 300000, polling: 250 },
);
const loadMsNoOverlap = Date.now() - tab0;
const timingsNoOverlap = await abPage.evaluate(() => window.__loadTimings ?? null);
const infillStepNoOverlap = Array.isArray(timingsNoOverlap)
  ? (timingsNoOverlap.find(([k]) => String(k).includes('里坊民居')) || [null, null])[1]
  : null;
const reportNoOverlap = await abPage.evaluate(() => window.__infillDrop ?? null);
await abPage.close();
const infillDelta = infillStep != null && infillStepNoOverlap != null
  ? +(infillStep - infillStepNoOverlap).toFixed(1)
  : null;

// ---- 判据 ----
const realPost = (r) => (r ? r.post - r.postShopShop : NaN);
const sameStore = (a) => {
  if (!a) return false;
  const ka = Object.keys(a.shopPartsByKey).sort();
  const kb = Object.keys(a.shopPartsByKeyAfter).sort();
  if (ka.join('|') !== kb.join('|')) return false;
  for (const k of ka) if (a.shopPartsByKey[k] !== a.shopPartsByKeyAfter[k]) return false;
  return true;
};

const checks = [
  {
    id: 'probe.pre>0（确实检出了干涉）',
    pass: probe.total.pre > 0,
    detail: { pre: probe.total.pre, post: probe.total.post, postShopShop: probe.total.postShopShop },
  },
  {
    id: 'probe.post==0（同一院内部除外）',
    pass: realPost(probe.total) === 0,
    detail: { post: probe.total.post, shopShop: probe.total.postShopShop, real: realPost(probe.total) },
  },
  {
    id: 'probe.shops 一件未删',
    pass: probe.total.shopsBefore === probe.total.shops
      && probe.total.shopParts === probe.total.shopPartsAfter
      && sameStore(probe.total),
    detail: {
      before: probe.total.shopsBefore, after: probe.total.shops,
      partsBefore: probe.total.shopParts, partsAfter: probe.total.shopPartsAfter,
      byKey: probe.total.shopPartsByKey,
    },
  },
  {
    id: 'live.obstacles>0（真实场景确有构件）',
    pass: !!live && live.obstacles > 0,
    detail: live ? { obstacles: live.obstacles, kept: live.kept, post: live.post, postShopShop: live.postShopShop } : null,
  },
  {
    id: 'live.post==0（同一院内部除外）',
    pass: !!live && realPost(live) === 0,
    detail: live ? { post: live.post, shopShop: live.postShopShop, real: realPost(live) } : null,
  },
  {
    id: 'live.shops 一件未删 / 逐数组相等',
    pass: !!live && live.shopsBefore === live.shops
      && live.shopParts === live.shopPartsAfter
      && sameStore(live)
      && (live.drops.shop ?? 0) === 0,
    detail: live ? {
      before: live.shopsBefore, after: live.shops,
      partsBefore: live.shopParts, partsAfter: live.shopPartsAfter,
      dropShop: live.drops.shop ?? 0,
      byKey: live.shopPartsByKey,
    } : null,
  },
  {
    id: '干涉新增 CPU ≤3s（同环境里坊步骤 A/B）',
    pass: infillDelta != null && infillDelta <= 3000,
    detail: { infillStepMs: infillStep, infillStepNoOverlap, delta: infillDelta },
  },
  {
    id: '按用户 8.7s 基线 + 增量 推算 ≤12s',
    pass: infillDelta != null && 8700 + infillDelta <= 12000,
    detail: { baselineMs: 8700, delta: infillDelta, projectedMs: infillDelta == null ? null : 8700 + infillDelta },
  },
  {
    id: '干涉消解耗时 <500ms',
    pass: !!live && live.ms < 500,
    detail: live ? { liveMs: live.ms, probeMs: probe.total.ms, breakdown: live.msBreakdown } : null,
  },
  {
    id: '载入绝对值（headless SwiftShader，仅记录不可比）',
    required: false,
    pass: loadMs <= 12000,
    detail: { loadMs, loadMsNoOverlap, infillStepMs: infillStep, infillStepNoOverlap, note: '本机 headless 全量载入 40s+，与用户 8.7s 基线不可直接比较' },
  },
  {
    id: '三张图非空白',
    pass: shots.length === 3 && shots.every((s) => s.stats.mean > 8 && s.stats.whitePct < 90),
    detail: shots.map((s) => ({ name: s.name, ...s.stats })),
  },
];

const pass = checks.every((c) => c.required === false || c.pass);
const report = {
  url: URL,
  loadMs,
  loadMsNoOverlap,
  infillStepMs: infillStep ?? null,
  infillStepNoOverlap: infillStepNoOverlap ?? null,
  infillDeltaMs: infillDelta,
  noOverlapHadReport: !!reportNoOverlap,
  overlapMs: { live: live?.ms ?? null, probe: probe.total.ms },
  msBreakdown: live?.msBreakdown ?? null,
  prePost: live ? {
    pre: live.pre >= 0 ? live.pre : null,
    preNote: live.pre >= 0 ? null : '生产端只跑消解（pre 由离线探针给出）',
    post: live.post,
    postShopShop: live.postShopShop,
    postReal: realPost(live),
    candidates: live.candidates,
    kept: live.kept,
    obstacles: live.obstacles,
    buckets: live.buckets,
  } : null,
  msBreakdown: live?.msBreakdown ?? null,
  drops: live?.drops ?? null,
  kindBefore: live?.kindBefore ?? null,
  kindAfter: live?.kindAfter ?? null,
  dropBy: live?.dropBy ?? null,
  byTier: live?.byTier ?? null,
  shops: live ? {
    before: live.shopsBefore,
    after: live.shops,
    partsBefore: live.shopParts,
    partsAfter: live.shopPartsAfter,
    byKeyBefore: live.shopPartsByKey,
    byKeyAfter: live.shopPartsByKeyAfter,
  } : null,
  probe: {
    rows: probe.rows,
    total: probe.total,
  },
  shots,
  pageErrors: pageErrors.slice(0, 10),
  checks,
  pass,
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log('SUMMARY', JSON.stringify({
  pass,
  load: {
    withOverlap: loadMs,
    withoutOverlap: loadMsNoOverlap,
    infillStepMs: infillStep,
    infillStepNoOverlap,
    deltaMs: infillDelta,
  },
  resolutionMs: live?.ms ?? null,
  msBreakdown: live?.msBreakdown ?? null,
  obstacles: live?.obstacles ?? null,
  candidates: live?.candidates ?? null,
  probe: { pre: probe.total.pre, post: probe.total.post, shopShop: probe.total.postShopShop, ms: probe.total.ms },
  shops: live ? { before: live.shopsBefore, after: live.shops, partsBefore: live.shopParts, partsAfter: live.shopPartsAfter } : null,
  drops: live?.drops ?? null,
  shots: shots.map((s) => s.name),
}, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(pass ? 0 : 1);
