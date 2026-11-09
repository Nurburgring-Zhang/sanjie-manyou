/**
 * R20 山体运行时只读诊断探针（阶段 1：只读，不改任何对象状态）。
 * 连 4173 生产包，用 window.__qingming.scene 读 terrain 网格的材质 / 顶点色实测直方图 /
 * 山体 ROI 颜色分布，并出机位 13 基线截图。诊断数据写 artifacts/r20-mtn-diag.json。
 *
 * 用法：node scripts/r20-mtn-probe.mjs
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

// 验收 13 号机位（team-lead 给定），先 teleport('countryside') 再覆盖相机
const CAM = [14000, 850, -6000];
const LOOK = [10500, 700, -3900];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE:' + String(e).slice(0, 220)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CON:' + m.text().slice(0, 220)); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2200));

await page.evaluate(() => { try { window.__qingming.world.teleport('countryside'); } catch (e) { /* ignore */ } });
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(([c, l]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.setCamMode('fly');
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(l[0], l[1], l[2]);
  const dx = l[0] - c[0], dy = l[1] - c[1], dz = l[2] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
}, [CAM, LOOK]);
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: `${OUT}/r20-mtn-diag-00-baseline.png` });

const info = await page.evaluate(() => {
  const q = window.__qingming;
  const scene = q.scene, e = q.engine;
  const out = { url: location.href, ts: new Date().toISOString() };

  let terrain = scene.getObjectByName('terrain');
  let fallback = null;
  if (!terrain) {
    scene.traverse((o) => {
      if (!fallback && o.isMesh && o.geometry?.attributes?.color && o.geometry.attributes.position.count > 300000) fallback = o;
    });
  }
  terrain = terrain || fallback;
  out.terrainFound = !!terrain;
  if (!terrain) { out.bigMeshes = []; return out; }

  const mat = terrain.material, geo = terrain.geometry;
  out.mesh = {
    uuid: terrain.uuid, name: terrain.name, visible: terrain.visible,
    posCount: geo.attributes.position.count, hasColor: !!geo.attributes.color,
    colorCount: geo.attributes.color?.count, colorItemSize: geo.attributes.color?.itemSize,
    colorNormalized: geo.attributes.color?.normalized, colorArrayType: geo.attributes.color?.array?.constructor?.name,
    indexCount: geo.index?.count,
  };
  out.material = {
    type: mat.type, uuid: mat.uuid, vertexColors: mat.vertexColors, fog: mat.fog,
    transparent: mat.transparent, opacity: mat.opacity,
    roughness: mat.roughness, metalness: mat.metalness, envMapIntensity: mat.envMapIntensity,
    hasMap: !!mat.map, mapColorSpace: mat.map?.colorSpace, mapRepeat: mat.map?.repeat?.toArray?.(),
    hasOnBeforeCompile: typeof mat.onBeforeCompile === 'function',
    onBeforeCompileHasHaze: typeof mat.onBeforeCompile === 'function' && /uFarHaze/.test(mat.onBeforeCompile.toString()),
    cacheKey: typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey() : null,
  };
  out.render = {
    fog: scene.fog ? {
      ctor: scene.fog.constructor?.name, density: scene.fog.density,
      near: scene.fog.near, far: scene.fog.far, color: scene.fog.color?.getHexString?.(),
    } : null,
    toneMapping: e.renderer.toneMapping, toneMappingExposure: e.renderer.toneMappingExposure,
    outputColorSpace: e.renderer.outputColorSpace, hasEnvironment: !!scene.environment,
    camera: { pos: e.camera.position.toArray(), fov: e.camera.fov, near: e.camera.near, far: e.camera.far },
    lights: (() => { let n = 0, dir = 0, amb = 0; scene.traverse((o) => { if (o.isLight) { n++; if (o.isDirectionalLight) dir++; if (o.isAmbientLight) amb++; } }); return { n, dir, amb }; })(),
  };

  // 列出可能遮挡山体的大网格（只读 visible，不改）
  const big = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry; if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r = g.boundingSphere?.radius || 0;
    if (r > 3000) big.push({ name: o.name, uuid: o.uuid, r: +r.toFixed(0), visible: o.visible, mat: o.material?.type, vcol: o.material?.vertexColors, fog: o.material?.fog });
  });
  out.bigMeshes = big.sort((a, b) => b.r - a.r).slice(0, 30);

  // ---- 顶点色实测直方图 ----
  const col = geo.attributes.color, pos = geo.attributes.position;
  const arr = col.array, n = col.count;
  const mk = () => ({ n: 0, sr: 0, sg: 0, sb: 0, min: [9, 9, 9], max: [-9, -9, -9], hist: new Array(16).fill(0), green: 0, grey: 0, dark: 0, rock: 0 });
  const ALL = mk(), ROI = mk();
  const bands = Array.from({ length: 8 }, () => mk()); // ROI 按相对高度分 8 段，检验水平岩层带
  const roiCx = 14000, roiCz = -6000, roiR = 3600, roiH = 1550;
  const put = (a, r, g, b) => {
    a.n++; a.sr += r; a.sg += g; a.sb += b;
    a.min[0] = Math.min(a.min[0], r); a.min[1] = Math.min(a.min[1], g); a.min[2] = Math.min(a.min[2], b);
    a.max[0] = Math.max(a.max[0], r); a.max[1] = Math.max(a.max[1], g); a.max[2] = Math.max(a.max[2], b);
    const L = (r + g + b) / 3;
    a.hist[Math.max(0, Math.min(15, Math.floor(L * 16)))]++;
    if (g > r * 1.15 && g > b * 1.15) a.green++;
    if (Math.abs(r - g) < 0.07 && Math.abs(g - b) < 0.10) a.grey++;
    if (L < 0.18) a.dark++;
    if (r >= g * 0.92 && b <= g * 0.95 && L > 0.18) a.rock++; // 灰褐/赭褐岩相
  };
  for (let i = 0; i < n; i++) {
    const r = arr[i * 3], g = arr[i * 3 + 1], b = arr[i * 3 + 2];
    put(ALL, r, g, b);
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    if (y > 45 && Math.hypot(x - roiCx, z - roiCz) < roiR) {
      put(ROI, r, g, b);
      const bi = Math.max(0, Math.min(7, Math.floor((y / roiH) * 8)));
      put(bands[bi], r, g, b);
    }
  }
  const fin = (a) => ({
    n: a.n, mean: [+(a.sr / a.n).toFixed(4), +(a.sg / a.n).toFixed(4), +(a.sb / a.n).toFixed(4)],
    min: a.min.map((v) => +v.toFixed(4)), max: a.max.map((v) => +v.toFixed(4)),
    histL16: a.hist,
    greenPct: +(100 * a.green / a.n).toFixed(2), greyPct: +(100 * a.grey / a.n).toFixed(2),
    darkPct: +(100 * a.dark / a.n).toFixed(2), rockPct: +(100 * a.rock / a.n).toFixed(2),
  });
  out.colorAll = fin(ALL);
  out.colorRoi = fin(ROI);
  out.colorRoiByHeight = bands.map((b, i) => ({ band: i, hRange: [+(i * roiH / 8).toFixed(0), +((i + 1) * roiH / 8).toFixed(0)], ...fin(b) }));
  return out;
});

const result = { cam: CAM, look: LOOK, errors, ...info };
fs.writeFileSync(`${OUT}/r20-mtn-diag.json`, JSON.stringify(result, null, 2));
console.log('TERRAIN:', JSON.stringify(result.mesh));
console.log('MATERIAL:', JSON.stringify(result.material));
console.log('RENDER:', JSON.stringify(result.render));
console.log('COLOR_ALL:', JSON.stringify(result.colorAll));
console.log('COLOR_ROI:', JSON.stringify(result.colorRoi));
console.log('BIG_MESHES:', JSON.stringify(result.bigMeshes?.slice(0, 12)));
console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'NONE');
console.log('WROTE:', `${OUT}/r20-mtn-diag.json`, `${OUT}/r20-mtn-diag-00-baseline.png`);
await browser.close();
