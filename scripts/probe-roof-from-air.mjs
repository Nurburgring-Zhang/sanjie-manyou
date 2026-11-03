/**
 * W2v2 机检：远景 LOD / 夜间瓦色 / 街面灯笼与招幌 / 皇宫前庭陈设。
 *
 * 判据（artifacts/SPEC-全面审计-20261103.md 的 A1/A5 修正版）：
 *   ① 固定机位 (0,90,320) → (0,2,−100)，记录相机 xyz 与 time.phase；
 *   ② 300–800m 带内 infill_block_*（含 blockroof）实例占「建筑体量实例」≤ 25%；
 *   ③ 同带内可见屋面中 ≥4 个瓦色档各占 ≥5%（8 档最近邻匹配 ROOF_COLORS）；
 *   ④ 同带内 ≥60% 可见屋面用 ≥42 面几何；
 *   ⑤ A5 街面机位：60m 内灯笼实例 ≥20、画面内可见（像素复核）≥6、招幌可见 ≥3；
 *   ⑥ 净增三角面 ≤0：降面（窗光 −y 面、压顶/门罩 −y 面）抵掉 A5/A3' 的新增几何。
 *
 * 退出码：0 = PASS，1 = BLOCK。
 * 用法：PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-roof-from-air.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const URL = process.env.PREVIEW_URL || 'http://localhost:4180/';
const OUT = 'artifacts/_W2v2/probe';
mkdirSync(OUT, { recursive: true });

// ---- A1 固定机位（远景屋顶）与 A5 街面机位（虹桥南岸街，相机在街心、朝东看整条铺面） ----
const A1 = { pos: [0, 90, 320], target: [0, 2, -100], phase: 'dusk' };
const A5 = { pos: [-46, 4.2, -50], target: [40, 3.4, -54], phase: 'night' };

const ROOF_COLORS = [0x5c6878, 0x4e5a68, 0x6a6156, 0x7a6248, 0x8a7a4e, 0x9a8a62, 0x596470, 0x6f6656];

/** 零依赖 PNG 解码（与 scripts/png-stats.mjs 同一口径） */
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

/** 在 (cx,cy) 附近 r 像素内找"灯笼像素"：暖色且足够亮（GLOW_MAT 是 unlit + 不 toneMap，夜景里最亮的一类） */
function lanternPixelNear(img, cx, cy, r) {
  let best = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(img.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(img.w - 1, cx + r); x++) {
      const i = (y * img.w + x) * img.ch;
      const rr = img.data[i], gg = img.data[i + 1], bb = img.data[i + 2];
      const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      const warm = rr - bb;
      if (lum >= 90 && warm >= 14) best = Math.max(best, lum);
    }
  }
  return best;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));

async function ensureReady() {
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 180000 });
}

async function setView(v) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await ensureReady();
      await page.evaluate((vv) => {
        const e = window.__qingming.engine;
        e.stopCinema();
        e.time.jump(vv.phase);
        e.camera.position.set(vv.pos[0], vv.pos[1], vv.pos[2]);
        const dx = vv.target[0] - vv.pos[0], dy = vv.target[1] - vv.pos[1], dz = vv.target[2] - vv.pos[2];
        const d = Math.max(1, Math.hypot(dx, dy, dz));
        e.yaw = Math.atan2(-dx, -dz);
        e.pitch = Math.asin(dy / d);
      }, v);
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ============ A1 ============
await setView(A1);
const a1cam = await page.evaluate(() => {
  const e = window.__qingming.engine;
  return { pos: [e.camera.position.x, e.camera.position.y, e.camera.position.z], phase: e.time.phase, yaw: e.yaw, pitch: e.pitch };
});
await page.screenshot({ path: `${OUT}/roof-air-dusk.png` });

const a1 = await page.evaluate(() => {
  const { engine, scene, THREE } = window.__qingming;
  const cam = engine.camera;
  const ROOF = [0x5c6878, 0x4e5a68, 0x6a6156, 0x7a6248, 0x8a7a4e, 0x9a8a62, 0x596470, 0x6f6656];
  const pal = ROOF.map((h) => new THREE.Color(h));
  const nearest = (c) => {
    let bi = -1, bd = 1e9;
    for (let i = 0; i < pal.length; i++) {
      const dr = c.r - pal[i].r, dg = c.g - pal[i].g, db = c.b - pal[i].b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), pv = new THREE.Vector3();
  let massAll = 0, massVis = 0, blockBodyAll = 0, blockRoofAll = 0, blockBody = 0, blockRoof = 0;
  const roof = { total: 0, ge42: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0], triHist: {} };
  let staticTris = 0, glowInst = 0, slabInst = 0;
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    if (!g) return;
    const tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    staticTris += tri * n;
    if (o.name === 'ward_all_glow') glowInst += o.count;
    if (/_slab_/.test(o.name)) slabInst += o.count;
    if (!o.isInstancedMesh || !/^(infill|court)_/.test(o.name)) return;
    const isBlockBody = /_block_/.test(o.name);
    const isBlockRoof = /_blockroof_/.test(o.name);
    const isMass = /_(body|roof|gable|tent|thatch|shed|gwall|block|blockroof)_/.test(o.name);
    const isRoof = /_(roof|gable|tent|thatch|shed|blockroof)_/.test(o.name);
    const vis = o.visible;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      const d = v.distanceTo(cam.position);
      const inBand = d >= 300 && d <= 800;
      const onScreen = (() => {
        pv.copy(v).project(cam);
        return pv.x >= -1 && pv.x <= 1 && pv.y >= -1 && pv.y <= 1 && pv.z >= -1 && pv.z <= 1;
      })();
      if (inBand) {
        if (isMass) { massAll++; if (vis) massVis++; }
        if (isBlockBody) { blockBodyAll++; if (vis) blockBody++; }
        if (isBlockRoof) { blockRoofAll++; if (vis) blockRoof++; }
        if (isRoof && !isBlockRoof && onScreen && vis) {
          roof.total++;
          roof.triHist[tri] = (roof.triHist[tri] ?? 0) + 1;
          if (tri >= 42) roof.ge42++;
          if (o.instanceColor) {
            const c = new THREE.Color().fromBufferAttribute(o.instanceColor, i);
            roof.bands[nearest(c)]++;
          }
        }
      }
    }
  });
  const bandPct = roof.bands.map((n) => +(n / Math.max(1, roof.total) * 100).toFixed(1));
  return {
    staticTris,
    renderedTris: engine.renderer.info.render.triangles,
    calls: engine.renderer.info.render.calls,
    glowInst, slabInst,
    band: {
      massAll, massVis, blockBody, blockRoof, blockBodyAll, blockRoofAll,
      blockShare: +((blockBody + blockRoof) / Math.max(1, massVis) * 100).toFixed(2),
      blockShareAll: +((blockBodyAll + blockRoofAll) / Math.max(1, massAll) * 100).toFixed(2),
    },
    roof: {
      total: roof.total, ge42Share: +(roof.ge42 / Math.max(1, roof.total) * 100).toFixed(1),
      bands: roof.bands, bandPct, bandsOver5: bandPct.filter((p) => p >= 5).length,
      triHist: roof.triHist,
    },
  };
});

// 夜间同机位（自发光色调前后对比用，不作几何判据）
await setView({ ...A1, phase: 'night' });
const nightCam = await page.evaluate(() => window.__qingming.engine.time.phase);
await page.screenshot({ path: `${OUT}/roof-air-night.png` });

// ============ A5 ============
await setView(A5);
const a5cam = await page.evaluate(() => {
  const e = window.__qingming.engine;
  return { pos: [e.camera.position.x, e.camera.position.y, e.camera.position.z], phase: e.time.phase };
});
const shotBuf = await page.screenshot({ path: `${OUT}/street-night.png` });

const a5 = await page.evaluate(() => {
  const { engine } = window.__qingming;
  const cam = engine.camera;
  const items = (window.__w2Street ?? []).map((f) => {
    const wp = new (window.__qingming.THREE.Vector3)(f.x, f.y, f.z);
    const d = wp.distanceTo(cam.position);
    const p = wp.clone().project(cam);
    return {
      ...f, d: +d.toFixed(2),
      px: +((p.x * 0.5 + 0.5) * window.innerWidth).toFixed(1),
      py: +((0.5 - p.y * 0.5) * window.innerHeight).toFixed(1),
      inFrame: p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1 && p.z >= -1 && p.z <= 1,
    };
  });
  const lanterns = items.filter((i) => i.kind === 'lantern');
  const banners = items.filter((i) => i.kind === 'banner');
  const within = (arr, r) => arr.filter((i) => i.d <= r);
  return {
    lanternsIn60: within(lanterns, 60),
    bannersIn60: within(banners, 60),
    lanternTotal: lanterns.length, bannerTotal: banners.length,
    // 按来源分桶：旧版只有 riverside（沿河铺面）与 tavern（酒肆单灯）两类，新增 door/shop 两类
    lanternBySrcIn60: within(lanterns, 60).reduce((acc, l) => { acc[l.src] = (acc[l.src] ?? 0) + 1; return acc; }, {}),
    bannerBySrcIn60: within(banners, 60).reduce((acc, b) => { acc[b.src] = (acc[b.src] ?? 0) + 1; return acc; }, {}),
  };
});

const img = decodePng(Buffer.from(shotBuf));
const litVisible = a5.lanternsIn60.filter((l) => l.inFrame && lanternPixelNear(img, Math.round(l.px), Math.round(l.py), 10) > 0);
const bannersVisible = a5.bannersIn60.filter((b) => b.inFrame);

// ============ 净面数（本流改动的账） ============
const bySrc = {};
for (const f of await page.evaluate(() => window.__w2Street ?? [])) {
  const k = `${f.kind}:${f.src}`;
  bySrc[k] = (bySrc[k] ?? 0) + 1;
}
const plots = {
  door: (bySrc['lantern:door'] ?? 0) / 2,
  shop: (bySrc['lantern:shop'] ?? 0) / 2,
  tavern: (bySrc['lantern:tavern'] ?? 0) / 2,
  riverside: bySrc['banner:riverside'] ?? 0,
};
// 每个铺/宅新增的盒子数（12 面/盒）：门灯 6 / 铺面 6 灯 + 1 幌 + 2 竿 = 9 / 酒肆 2 灯 − 旧 1 灯 = 5 / 沿河 +1 吊索
const a5AddedTris = 12 * (6 * plots.door + 9 * plots.shop + 5 * plots.tavern + 1 * plots.riverside);
// A3' 前庭陈设：24 盒御路石 + 铜龟(11 盒 + 2 球) + 铜鹤(7 盒 + 2 球 + 4 柱) + 日晷 13 盒 + 嘉量(5 盒 + 4 柱) + 品级山 16×4 盒
const A3_TRIS = (24 + 11 + 7 + 13 + 5 + 16 * 4) * 12 + (120 * 2 + 80 * 2) + (2 + 2) * 4 * 6 + 4 * 4 * 12;
const saved = { win: 2 * a1.glowInst, slab: 2 * a1.slabInst };
const net = a5AddedTris + A3_TRIS - saved.win - saved.slab;

// ============ 判定 ============
const checks = {
  blockShareLe25: a1.band.blockShare <= 25,
  roofBands4x5pct: a1.roof.bandsOver5 >= 4,
  roofGe42Share60: a1.roof.ge42Share >= 60,
  lanterns60ge20: a5.lanternsIn60.length >= 20,
  lanternsVisibleGe6: litVisible.length >= 6,
  bannersVisibleGe3: bannersVisible.length >= 3,
  netTrisLe0: net <= 0,
};
const pass = Object.values(checks).every(Boolean);

const report = {
  pass,
  cameras: {
    A1: { ...A1, actualPos: a1cam.pos, phase: a1cam.phase, yaw: +a1cam.yaw.toFixed(4), pitch: +a1cam.pitch.toFixed(4) },
    A1nightPhase: nightCam,
    A5: { ...A5, actualPos: a5cam.pos, phase: a5cam.phase },
  },
  a1,
  a5: {
    lanternsIn60: a5.lanternsIn60.length,
    lanternsInFrame: a5.lanternsIn60.filter((l) => l.inFrame).length,
    lanternsVisiblePixels: litVisible.length,
    bannersIn60: a5.bannersIn60.length,
    bannersVisible: bannersVisible.length,
    lanternTotal: a5.lanternTotal,
    bannerTotal: a5.bannerTotal,
    lanternBySrcIn60: a5.lanternBySrcIn60,
    bannerBySrcIn60: a5.bannerBySrcIn60,
    visibleSample: litVisible.slice(0, 8).map((l) => ({ x: l.x, y: l.y, z: l.z, d: l.d, s: l.s, src: l.src })),
  },
  budget: {
    staticTris: a1.staticTris,
    saved,
    a5AddedTris,
    a5Plots: plots,
    a3AddedTris: A3_TRIS,
    netTris: net,
  },
  checks,
  shots: [`${OUT}/roof-air-dusk.png`, `${OUT}/roof-air-night.png`, `${OUT}/street-night.png`],
};
console.log(JSON.stringify(report, null, 1));

await browser.close();
process.exit(pass ? 0 : 1);
