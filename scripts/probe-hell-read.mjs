/**
 * C1 地府可读性探针（W4）
 *
 * 判据（SPEC-全面审计-20261103 §3 C1）：u_hero 机位亮度直方图 p95 − p05 ≥ 60，
 * 且中央主体（阎罗殿）与背景的亮度差 ≥ 18。
 *
 * 四个取样点：阎罗殿前 / 奈何桥 / 十八狱入口 / 忘川，外加 u_hero 两个状态：
 *   u_hero      —— 玩家已在地府（正常游玩状态；applyLighting 的 uf=1）
 *   u_hero_fly  —— 玩家留在人间、只把自由相机开下去（审计原图的拍摄方式；uf≈0.79）
 *
 * 直方图只统计 HUD 外的画面区（上 145px 小地图/标题、下 100px 操作条裁掉），
 * 否则 HUD 的白字会把 p95 抬起来，测到的是界面不是场景。
 *
 * 退出码：0 = PASS，1 = BLOCK。
 *   node scripts/probe-hell-read.mjs [outdir]
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const OUT = process.argv[2] || 'artifacts/_W4_hell';
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const W = 1600, H = 900;
const ROI = { x0: 0, y0: 145, x1: W, y1: 800 };       // 去掉 HUD 后的画面区
const SUBJ = { x0: Math.round(W * 0.35), y0: Math.round(H * 0.45), x1: Math.round(W * 0.65), y1: Math.round(H * 0.72) };
const BG = [
  { x0: Math.round(W * 0.02), y0: Math.round(H * 0.20), x1: Math.round(W * 0.14), y1: Math.round(H * 0.75) },
  { x0: Math.round(W * 0.86), y0: Math.round(H * 0.20), x1: Math.round(W * 0.98), y1: Math.round(H * 0.75) },
];

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

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 区域统计：p05/p50/p95（亮度）与区域均值亮度和 RGB 均值 */
function regionStat(img, r) {
  const L = [];
  let sr = 0, sg = 0, sb = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = (y * img.w + x) * img.bpp;
      const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
      L.push(luma(R, G, B)); sr += R; sg += G; sb += B;
    }
  }
  L.sort((a, b) => a - b);
  const q = (pp) => L[Math.min(L.length - 1, Math.floor((L.length - 1) * pp))];
  const n = L.length;
  return { p05: q(0.05), p50: q(0.5), p95: q(0.95), mean: luma(sr / n, sg / n, sb / n), rgb: [sr / n, sg / n, sb / n] };
}

function analyse(buf) {
  const img = decodePNG(buf);
  const all = regionStat(img, ROI);
  const subj = regionStat(img, SUBJ);
  let bgL = 0, bgN = 0;
  for (const r of BG) bgL += regionStat(img, r).mean * ((r.x1 - r.x0) * (r.y1 - r.y0));
  for (const r of BG) bgN += (r.x1 - r.x0) * (r.y1 - r.y0);
  const bg = bgL / bgN;
  return {
    p05: all.p05, p50: all.p50, p95: all.p95, spread: all.p95 - all.p05,
    mean: all.mean, rgb: all.rgb.map((v) => Math.round(v)),
    subj: subj.mean, bg, sbd: Math.abs(subj.mean - bg),
  };
}

const f1 = (v) => v.toFixed(1).padStart(6);
const VIEWS = [
  { name: 'yanluo',    player: 'yanluo',  p: [0, -242, 124], t: [0, -244, 60],  label: '阎罗殿前' },
  { name: 'naihe',     player: 'naihe',   p: [0, -244, -16], t: [0, -250, -70], label: '奈何桥' },
  { name: 'shibayu',   player: 'shibayu', p: [0, -236, 190], t: [0, -244, 120], label: '十八狱入口' },
  { name: 'wangchuan', player: 'sansheng', p: [46, -247, -18], t: [-60, -250, -72], label: '忘川' },
  { name: 'u_hero',    player: 'yanluo',  p: [0, -195, 130], t: [0, -232, 0],   label: 'u_hero（玩家在地府）' },
  { name: 'u_hero_fly', player: null,     p: [0, -195, 130], t: [0, -232, 0],   label: 'u_hero（自由相机，玩家在人间）' },
];

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: [`--window-size=${W},${H}`, '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const v of VIEWS) {
  if (v.player) {
    await page.evaluate((k) => window.__qingming.world.teleport(k), v.player);
    await new Promise((r) => setTimeout(r, 1200));
  }
  await page.evaluate(([pp, tt]) => {
    const e = window.__qingming.engine;
    e.stopCinema('fly');
    e.camera.position.set(pp[0], pp[1], pp[2]);
    const dx = tt[0] - pp[0], dy = tt[1] - pp[1], dz = tt[2] - pp[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
  }, [v.p, v.t]);
  await new Promise((r) => setTimeout(r, 1200));
  const buf = Buffer.from(await page.screenshot({ path: `${OUT}/${v.name}.png` }));
  const st = analyse(buf);
  rows.push({ ...v, ...st });
  // 每张图都记一次场景状态，便于归因（雾/曝光变了就能一眼看出）
  const sc = await page.evaluate(() => {
    const { engine, world } = window.__qingming;
    const f = engine.scene.fog;
    return {
      camY: +engine.camera.position.y.toFixed(1),
      playerY: world.player?.actor?.pos.y.toFixed(1),
      fog: '#' + f.color.getHexString(), dens: +f.density.toFixed(5),
      exp: +engine.renderer.toneMappingExposure.toFixed(2),
    };
  });
  rows[rows.length - 1].scene = sc;
}
await browser.close();

console.log('\nC1 地府可读性 · 亮度直方图（HUD 已裁掉）');
console.log('机位              描述                      p05    p50    p95   p95-p05  主体   背景  |差|   meanRGB      fog      dens   exp');
for (const r of rows) {
  console.log(
    r.name.padEnd(12),
    r.label.padEnd(26),
    f1(r.p05), f1(r.p50), f1(r.p95), f1(r.spread), f1(r.subj), f1(r.bg), f1(r.sbd),
    String(r.rgb.join('/')).padStart(11),
    String(r.scene.fog).padStart(9),
    r.scene.dens.toFixed(5),
    r.scene.exp.toFixed(2),
  );
}

const hero = rows.find((r) => r.name === 'u_hero');
const fail = [];
if (!(hero.spread >= 60)) fail.push(`u_hero p95-p05=${hero.spread.toFixed(1)} < 60`);
if (!(hero.sbd >= 18)) fail.push(`u_hero 主体/背景差=${hero.sbd.toFixed(1)} < 18`);
// 其余三处只做"不是一片糊"的下限，避免把全黑画面当通过
for (const n of ['yanluo', 'naihe', 'shibayu', 'wangchuan']) {
  const r = rows.find((x) => x.name === n);
  if (r.spread < 30) fail.push(`${n} p95-p05=${r.spread.toFixed(1)} < 30（画面无层次）`);
}
if (hero.spread < 60 || hero.sbd < 18) {
  const fly = rows.find((r) => r.name === 'u_hero_fly');
  if (fly.spread > hero.spread + 20) fail.push(`提示：u_hero_fly 反而更宽（${fly.spread.toFixed(1)}），检查玩家/相机状态`);
}

if (fail.length) {
  console.log('\nBLOCK');
  for (const f of fail) console.log('  - ' + f);
  process.exit(1);
}
console.log('\nPASS');
process.exit(0);
