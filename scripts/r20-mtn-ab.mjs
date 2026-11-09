/**
 * R20 山体运行时 A/B 归因（阶段 2）。
 * 机位严格照抄 scripts/_r20_acceptance.mjs 第 13 格：p=相机位置，c=lookTarget。
 * 可见性还原纪律：全程不改任何 3D 对象的 visible；每个分支记录被改对象的 uuid + 原始状态，
 * 出图后立即精确还原（材质/雾/map/顶点色缓冲），绝不把隐藏 LOD 设成 true。
 *
 * 用法：node scripts/r20-mtn-ab.mjs
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
const P = [10500, 700, -3900]; // 相机位置（验收脚本 p）
const C = [14000, 850, -6000]; // lookTarget（验收脚本 c）
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
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
await new Promise((r) => setTimeout(r, 1500));

// 在页面内维护可逆状态：saved 保存原值，restore 精确还原
await page.evaluate(() => {
  const q = window.__qingming, THREE = q.THREE;
  const T = q.scene.getObjectByName('terrain');
  const mat = T.material;
  const attr = T.geometry.attributes.color;
  const pos = T.geometry.attributes.position;
  let saved = null;
  window.__diagLog = [];
  window.__diagRestore = () => {
    if (!saved) return;
    const s = saved;
    T.material = s.material;
    q.scene.fog = s.sceneFog;
    s.material.fog = s.matFog;
    s.material.map = s.map;
    s.material.onBeforeCompile = s.obc;
    s.material.customProgramCacheKey = s.ck;
    s.material.needsUpdate = true;
    attr.array.set(s.colorCopy);
    attr.needsUpdate = true;
    saved = null;
  };
  window.__diagApply = (mode) => {
    window.__diagRestore();
    saved = {
      sceneFog: q.scene.fog, matFog: mat.fog, map: mat.map,
      material: T.material, colorCopy: new Float32Array(attr.array),
      obc: mat.onBeforeCompile, ck: mat.customProgramCacheKey,
    };
    const log = [];
    const rec = (uuid, prop, from, to) => log.push({ uuid, prop, from, to });
    if (mode === 'nofog') {
      mat.fog = false; q.scene.fog = null; mat.needsUpdate = true;
      rec(mat.uuid, 'fog', true, false);
      rec('scene', 'fog', 'FogExp2', null);
    } else if (mode === 'flatrock') {
      const a = attr.array;
      for (let i = 0; i < a.length; i += 3) { a[i] = 0.159; a[i + 1] = 0.144; a[i + 2] = 0.113; }
      attr.needsUpdate = true;
      rec(T.uuid, 'geometry.color', 'orig', 'flat linear(0x6f6a5e)');
    } else if (mode === 'basic') {
      const bm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
      T.material = bm;
      rec(T.uuid, 'material', mat.uuid, bm.uuid);
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
      mat.map = null; mat.needsUpdate = true;
      rec(mat.uuid, 'map', 'groundTex', null);
    }
    window.__diagLog.push({
      mode, changes: log,
      visibilityTouched: false, hiddenObjectsRestored: [],
      note: '未改任何 3D 对象 visible；仅 DOM #ui 隐藏（验收脚本同款）',
    });
    return log;
  };
});

const CASES = [
  ['00-baseline', null],
  ['01-nofog', 'nofog'],
  ['02-flatrock', 'flatrock'],
  ['03-basic', 'basic'],
  ['04-binary', 'binary'],
  ['05-nomap', 'nomap'],
];
const files = [];
for (const [name, mode] of CASES) {
  await page.evaluate(() => window.__diagRestore());
  await setView();
  if (mode) await page.evaluate((m) => window.__diagApply(m), mode);
  await new Promise((r) => setTimeout(r, 1500));
  const f = `${OUT}/r20-mtn-diag-${name}.png`;
  await page.screenshot({ path: f });
  files.push({ name, mode, file: f });
  process.stdout.write(name + ' ');
  await page.evaluate(() => window.__diagRestore());
  await new Promise((r) => setTimeout(r, 350));
}
console.log('');

// 还原后复核：material / fog / 顶点色是否回到基线
const restored = await page.evaluate(() => {
  const q = window.__qingming, T = q.scene.getObjectByName('terrain');
  const a = T.geometry.attributes.color.array;
  let sum = 0; for (let i = 0; i < a.length; i += 997) sum += a[i];
  return {
    materialType: T.material.type, materialUuid: T.material.uuid,
    vertexColors: T.material.vertexColors, fog: T.material.fog,
    hasMap: !!T.material.map, sceneFog: q.scene.fog?.constructor?.name ?? null,
    cacheKey: typeof T.material.customProgramCacheKey === 'function' ? T.material.customProgramCacheKey() : null,
    visibleObjectsUnchanged: 'no visible flag written by this probe',
    colorChecksumSample: +sum.toFixed(3),
  };
});

const jf = `${OUT}/r20-mtn-diag.json`;
const prev = JSON.parse(fs.readFileSync(jf, 'utf-8'));
prev.ab = {
  cameraPos: P, lookTarget: C, uiHidden: true, errors: errs,
  cases: files, restoreCheck: restored,
  discipline: '每个分支记录 uuid+原始状态并精确还原；未触碰任何 3D 对象 visible；未把隐藏 LOD 设为 true',
};
prev.diagLog = await page.evaluate(() => window.__diagLog);
fs.writeFileSync(jf, JSON.stringify(prev, null, 2));
console.log('RESTORED:', JSON.stringify(restored));
console.log('ERRORS:', errs.length ? errs.slice(0, 6).join(' | ') : 'NONE');
console.log('WROTE:', files.map((x) => x.file).join(', '));
await browser.close();
