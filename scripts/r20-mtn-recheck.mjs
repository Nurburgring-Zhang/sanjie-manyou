/**
 * R20 山体诊断复核 —— 连「当前新包」(4173 → index-BOJo8Z96.js，pool_spear 已修、世界完整初始化)。
 *
 * 资源纪律（team-lead 2026-11-08 指令）：
 *   · 全程只有 1 次 puppeteer.launch、1 次 newPage；所有取证/A/B 复用这一个 page；
 *   · 不循环 launch/close 多个浏览器；finally 里显式 await browser.close()；
 *   · 打印 LAUNCH_COUNT / PAGE_COUNT / BROWSER_CLOSED 作证。
 *
 * 可见性还原纪律：不改任何 3D 对象的 visible；每个 A/B 分支记录被改对象 uuid + 原始状态，
 *   出图后立即精确还原（材质/fog/map/顶点色缓冲/onBeforeCompile/cacheKey）；不把隐藏 LOD 设 true。
 *   仅隐藏 DOM #ui（与验收脚本一致）。
 *
 * 机位：验收脚本 13 号 —— p=[10500,700,-3900] 相机位置，c=[14000,850,-6000] lookTarget。
 * 用法：node scripts/r20-mtn-recheck.mjs   （默认连 http://127.0.0.1:4173/ 当前新包）
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
const P = [10500, 700, -3900]; // 相机位置（验收脚本 p）
const C = [14000, 850, -6000]; // lookTarget（验收脚本 c）
fs.mkdirSync(OUT, { recursive: true });

let LAUNCH_COUNT = 0;
let PAGE_COUNT = 0;
let browser = null;

try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  });
  LAUNCH_COUNT++;
  const page = await browser.newPage(); // 唯一一个 page，后续全部复用
  PAGE_COUNT++;
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 220)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CON:' + m.text().slice(0, 220)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2600));
  await page.evaluate(() => { try { window.__qingming.world.teleport('countryside'); } catch (e) { /* ignore */ } });
  await new Promise((r) => setTimeout(r, 500));

  const setView = () => page.evaluate(([p, c]) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none'; // DOM HUD，非 3D 对象
    e.camera.position.set(p[0], p[1], p[2]);
    const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
    e.lookTarget.set(c[0], c[1], c[2]);
  }, [P, C]);
  await setView();
  await new Promise((r) => setTimeout(r, 1600));

  // ---------- 只读探针：世界完整初始化状态 + material 链 + 顶点色实测直方图 ----------
  const probe = await page.evaluate(() => {
    const q = window.__qingming, e = q.engine;
    const out = { url: location.href, ts: new Date().toISOString(),
      bundle: [...document.querySelectorAll('script[type="module"]')].map((s) => s.src.split('/').pop()) };

    // 世界初始化完整性：对象计数 + 景点/亭塔类命名对象（半初始化会被 pool_spear 中断后段）
    let meshCount = 0, groupCount = 0, lightCount = 0, namedCount = 0;
    const scenicNames = new Set();
    const re = /pavilion|tower|ting|ta_|ge_|plank|bridge|gate|arch|栈|亭|塔|阁|廊|榭|牌|楼|观|台/i;
    q.scene.traverse((o) => {
      if (o.isMesh) meshCount++;
      if (o.isGroup) groupCount++;
      if (o.isLight) lightCount++;
      if (o.name) { namedCount++; if (re.test(o.name)) scenicNames.add(o.name); }
    });
    out.worldInit = {
      meshCount, groupCount, lightCount, namedCount,
      scenicNamedCount: scenicNames.size,
      scenicSample: [...scenicNames].slice(0, 20),
      worldKeys: Object.keys(q.world).slice(0, 40),
      loadingGone: !document.getElementById('loading'),
    };

    const T = q.scene.getObjectByName('terrain');
    out.terrainFound = !!T;
    if (!T) return out;
    const mat = T.material, geo = T.geometry, attr = geo.attributes.color, pos = geo.attributes.position;
    out.mesh = {
      uuid: T.uuid, name: T.name, visible: T.visible,
      posCount: pos.count, hasColor: !!attr, colorCount: attr?.count,
      colorItemSize: attr?.itemSize, colorArrayType: attr?.array?.constructor?.name,
      indexCount: geo.index?.count,
    };
    out.material = {
      type: mat.type, uuid: mat.uuid, vertexColors: mat.vertexColors, fog: mat.fog,
      transparent: mat.transparent, opacity: mat.opacity,
      hasMap: !!mat.map, mapColorSpace: mat.map?.colorSpace,
      hasOnBeforeCompile: typeof mat.onBeforeCompile === 'function',
      onBeforeCompileHasHaze: typeof mat.onBeforeCompile === 'function' && /uFarHaze/.test(mat.onBeforeCompile.toString()),
      cacheKey: typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey() : null,
    };
    out.render = {
      sceneFog: q.scene.fog ? { ctor: q.scene.fog.constructor?.name, density: q.scene.fog.density } : null,
      toneMapping: e.renderer.toneMapping, toneMappingExposure: e.renderer.toneMappingExposure,
      outputColorSpace: e.renderer.outputColorSpace,
    };

    // 顶点色实测直方图（与 r20-mtn-probe.mjs 完全同算法，保证与旧包 diag.json 可比）
    const arr = attr.array, n = attr.count;
    const mk = () => ({ n: 0, sr: 0, sg: 0, sb: 0, min: [9, 9, 9], max: [-9, -9, -9], hist: new Array(16).fill(0), green: 0, grey: 0, dark: 0, rock: 0 });
    const ALL = mk(), ROI = mk();
    const roiCx = 14000, roiCz = -6000, roiR = 3600;
    const put = (a, r, g, b) => {
      a.n++; a.sr += r; a.sg += g; a.sb += b;
      a.min[0] = Math.min(a.min[0], r); a.min[1] = Math.min(a.min[1], g); a.min[2] = Math.min(a.min[2], b);
      a.max[0] = Math.max(a.max[0], r); a.max[1] = Math.max(a.max[1], g); a.max[2] = Math.max(a.max[2], b);
      const L = (r + g + b) / 3;
      a.hist[Math.max(0, Math.min(15, Math.floor(L * 16)))]++;
      if (g > r * 1.15 && g > b * 1.15) a.green++;
      if (Math.abs(r - g) < 0.07 && Math.abs(g - b) < 0.10) a.grey++;
      if (L < 0.18) a.dark++;
      if (r >= g * 0.92 && b <= g * 0.95 && L > 0.18) a.rock++;
    };
    for (let i = 0; i < n; i++) {
      const r = arr[i * 3], g = arr[i * 3 + 1], b = arr[i * 3 + 2];
      put(ALL, r, g, b);
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      if (y > 45 && Math.hypot(x - roiCx, z - roiCz) < roiR) put(ROI, r, g, b);
    }
    const fin = (a) => ({
      n: a.n, mean: [+(a.sr / a.n).toFixed(4), +(a.sg / a.n).toFixed(4), +(a.sb / a.n).toFixed(4)],
      min: a.min.map((v) => +v.toFixed(4)), max: a.max.map((v) => +v.toFixed(4)), histL16: a.hist,
      greenPct: +(100 * a.green / a.n).toFixed(2), greyPct: +(100 * a.grey / a.n).toFixed(2),
      darkPct: +(100 * a.dark / a.n).toFixed(2), rockPct: +(100 * a.rock / a.n).toFixed(2),
    });
    out.colorAll = fin(ALL);
    out.colorRoi = fin(ROI);
    return out;
  });

  // 当前新包同机位基线（完整初始化）
  const baseline = `${OUT}/r20-mtn-diag-rc-00-baseline.png`;
  await page.screenshot({ path: baseline });

  // ---------- 可逆 A/B 闭包（复用同一 page，不新开 browser） ----------
  await page.evaluate(() => {
    const q = window.__qingming, THREE = q.THREE;
    const T = q.scene.getObjectByName('terrain');
    const mat0 = T.material;
    const attr = T.geometry.attributes.color;
    const pos = T.geometry.attributes.position;
    let saved = null;
    window.__diagLog = [];
    window.__diagRestore = () => {
      if (!saved) return;
      const s = saved;
      T.material = s.material;
      s.material.fog = s.matFog;
      s.material.map = s.map;
      s.material.onBeforeCompile = s.obc;
      s.material.customProgramCacheKey = s.ck;
      s.material.needsUpdate = true;
      q.scene.fog = s.sceneFog; // 原值还原（本脚本不动它，仅兜底）
      attr.array.set(s.colorCopy);
      attr.needsUpdate = true;
      saved = null;
    };
    window.__diagApply = (mode) => {
      window.__diagRestore();
      saved = {
        sceneFog: q.scene.fog, matFog: mat0.fog, map: mat0.map,
        material: T.material, colorCopy: new Float32Array(attr.array),
        obc: mat0.onBeforeCompile, ck: mat0.customProgramCacheKey,
      };
      const log = [];
      const rec = (uuid, prop, from, to) => log.push({ uuid, prop, from, to });
      if (mode === 'flatrock') {
        const a = attr.array;
        for (let i = 0; i < a.length; i += 3) { a[i] = 0.159; a[i + 1] = 0.144; a[i + 2] = 0.113; }
        attr.needsUpdate = true;
        rec(T.uuid, 'geometry.color', 'orig', 'flat linear(0x6f6a5e)');
      } else if (mode === 'basic') {
        const bm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
        T.material = bm;
        rec(T.uuid, 'material', mat0.uuid, bm.uuid);
      } else if (mode === 'binary') {
        const a = attr.array;
        for (let i = 0; i < attr.count; i++) {
          const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
          if (y > 45 && Math.hypot(x - 14000, z + 6000) < 3600) {
            const t = Math.floor((y / 1550) * 6);
            const rock = (t % 2) === 1;
            a[i * 3] = rock ? 0.45 : 0.05;
            a[i * 3 + 1] = rock ? 0.28 : 0.45;
            a[i * 3 + 2] = rock ? 0.14 : 0.05;
          }
        }
        attr.needsUpdate = true;
        rec(T.uuid, 'geometry.color(ROI only)', 'orig', '6-band ochre/green');
      } else if (mode === 'nomap') {
        mat0.map = null; mat0.needsUpdate = true;
        rec(mat0.uuid, 'map', 'groundTex', null);
      }
      window.__diagLog.push({ mode, changes: log, visibilityTouched: false, hiddenObjectsRestored: [] });
      return log;
    };
  });

  // 注意：不含 nofog —— 旧包 01-nofog 已证 fog 非主因，且 scene.fog=null 会触发运行时
  // "Cannot read properties of null (reading 'color')"。本脚本改以只读确认 fog/cacheKey 链完好。
  const CASES = [
    ['rc-01-flatrock', 'flatrock'],
    ['rc-02-basic', 'basic'],
    ['rc-03-binary', 'binary'],
    ['rc-04-nomap', 'nomap'],
  ];
  const abFiles = [];
  for (const [name, mode] of CASES) {
    await page.evaluate(() => window.__diagRestore());
    await setView();
    await page.evaluate((m) => window.__diagApply(m), mode);
    await new Promise((r) => setTimeout(r, 1400));
    const f = `${OUT}/r20-mtn-diag-${name}.png`;
    await page.screenshot({ path: f });
    abFiles.push({ name, mode, file: f });
    await page.evaluate(() => window.__diagRestore());
    await new Promise((r) => setTimeout(r, 350));
  }

  // 还原后复核
  const restored = await page.evaluate(() => {
    const q = window.__qingming, T = q.scene.getObjectByName('terrain');
    const a = T.geometry.attributes.color.array;
    let sum = 0; for (let i = 0; i < a.length; i += 997) sum += a[i];
    return {
      materialType: T.material.type, materialUuid: T.material.uuid,
      vertexColors: T.material.vertexColors, fog: T.material.fog,
      hasMap: !!T.material.map,
      cacheKey: typeof T.material.customProgramCacheKey === 'function' ? T.material.customProgramCacheKey() : null,
      sceneFog: q.scene.fog?.constructor?.name ?? null,
      visibleObjectsUnchanged: 'no visible flag written by this probe',
      colorChecksumSample: +sum.toFixed(3),
    };
  });

  const jf = `${OUT}/r20-mtn-diag.json`;
  const j = JSON.parse(fs.readFileSync(jf, 'utf-8'));
  j.recheck = {
    url: URL, note: '连当前新包 index-BOJo8Z96.js（pool_spear 已修、世界完整初始化）；单实例/单 page 复核，不覆盖旧包/半初始化证据',
    cameraPos: P, lookTarget: C,
    launchCount: LAUNCH_COUNT, pageCount: PAGE_COUNT,
    errors: errs,
    errorsContainPoolSpear: errs.some((s) => /pool_spear|槽位不足|need 421/i.test(s)),
    baseline,
    worldInit: probe.worldInit, mesh: probe.mesh, material: probe.material, render: probe.render,
    colorAll: probe.colorAll, colorRoi: probe.colorRoi,
    abFiles, restoreCheck: restored,
    diagLog: await page.evaluate(() => window.__diagLog),
    discipline: '仅 DOM #ui 隐藏；未触碰任何 3D 对象 visible；每分支记录 uuid+原状态并精确还原；未把隐藏 LOD 设 true',
  };
  fs.writeFileSync(jf, JSON.stringify(j, null, 2));

  console.log('BUNDLE:', JSON.stringify(probe.bundle));
  console.log('WORLD_INIT:', JSON.stringify(probe.worldInit));
  console.log('MATERIAL:', JSON.stringify(probe.material));
  console.log('COLOR_ALL:', JSON.stringify(probe.colorAll));
  console.log('COLOR_ROI_NEWPKG:', JSON.stringify(probe.colorRoi));
  console.log('COLOR_ROI_OLDPKG:', JSON.stringify(j.colorRoi));
  console.log('ERRORS:', errs.length ? errs.slice(0, 6).join(' | ') : 'NONE', '| poolSpear:', j.recheck.errorsContainPoolSpear);
  console.log('RESTORED:', JSON.stringify(restored));
  console.log('LAUNCH_COUNT:', LAUNCH_COUNT, 'PAGE_COUNT:', PAGE_COUNT);
  console.log('WROTE:', baseline, abFiles.map((x) => x.file).join(', '));
} finally {
  if (browser) await browser.close(); // 显式关闭，唯一实例
  console.log('BROWSER_CLOSED: YES');
}
