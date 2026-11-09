/**
 * R23 五项用户反馈的画面级验收（只认实拍，不认汇报）：
 *   ① 午门五凤楼殿内是否真的有陈设（御座 / 屏风 / 仪仗 / 宫灯 / 起居）
 *   ② 草地近景是否是真草叶 / 花 / 枝叶，而不是一层纯色绿膜
 *   ③ 大街是否是石板路，而不是盖了绿膜
 *   ④ 皇宫内花草树木是否够密
 *   ⑤ 山是否有一面可攀登的缓坡、且满山有树 / 草 / 花
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4173/ node scripts/r23_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
const W = 1600, H = 900;
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__mtnLife,
  { timeout: 180000 },
);
await new Promise((r) => setTimeout(r, 2600));

const setCam = (c) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(c[3], c[4], c[5]);
  const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
};

// cam = [px,py,pz, tx,ty,tz]
const CAMS = [
  { id: '01-wumen-inside', label: '午门五凤楼殿内 · 御座/屏风/仪仗/宫灯', cam: [0, 17.2, -2938, 0, 16.6, -2958] },
  { id: '02-wumen-wing', label: '午门殿内 · 两翼起居与兵器架', cam: [-24, 18.4, -2939, 22, 15.6, -2956] },
  { id: '03-grass-close', label: '坊间草地近景 · 草叶/花/枝叶', cam: [330, 2.2, 195, 345, 1.4, 225] },
  { id: '04-grass-eye', label: '草地人眼平视（另一坊）', cam: [640, 1.8, 240, 660, 1.3, 272] },
  { id: '05-street', label: '环城大路俯瞰 · 街面应为石板', cam: [900, 80, 400, 900, 0, 180] },
  { id: '06-yujie', label: '御街 · 街面', cam: [0, 55, 760, 0, 0, 300] },
  { id: '07-palace-flora', label: '皇宫俯瞰 · 宫苑草地与花木', cam: [0, 250, -2660, 0, 0, -3440] },
  { id: '08-palace-flora-close', label: '宫城内近景 · 花木草叶', cam: [220, 30, -3010, 220, 0, -3160] },
  { id: '09-mtn-south', label: '恒山南坡 · 可攀登缓坡 + 满山树草花', cam: [-3500, 950, -11000, -3500, 420, -16200] },
  { id: '10-mtn-slope', label: '山腰近景 · 草木分带', cam: [-3500, 760, -13600, -3500, 520, -15800] },
];

const report = { url: URL, at: new Date().toISOString(), shots: [], pageErrors: errs };
for (const c of CAMS) {
  await page.evaluate(setCam, c.cam);
  await new Promise((r) => setTimeout(r, 1500));
  const file = path.join(OUT, 'r23-' + c.id + '.png');
  await page.screenshot({ path: file });
  report.shots.push({ id: c.id, label: c.label, cam: c.cam, file });
  console.log('shot', c.id, '->', file);
}

// 11 号：动态找到一块真正的宫苑绿毯（顶面 y≈0.312 的 leaf 网格），把相机放进草坪内部人眼平视，
// 避免固定机位恰好落在中轴御道石板上而误判「宫城内没草」。
const greenSpot = await page.evaluate(() => {
  const q = window.__qingming, THREE = q.THREE;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (let z = -3085; z >= -3925; z -= 30) {
    for (const x of [225, 315, 405, 495, 585, 675, 765, 855, 945]) {
      ray.set(new THREE.Vector3(x, 20, z), down);
      const h = ray.intersectObjects(q.scene.children, true)
        .filter((o) => o.object.isMesh && o.object.visible)[0];
      if (h && h.point.y > 0.29 && h.point.y < 0.34 && /leaf/.test(h.object.name || ''))
        return [x, z];
    }
  }
  return null;
});
if (greenSpot) {
  const [gx, gz] = greenSpot;
  const cam = [gx - 10, 2.3, gz + 12, gx, 1.2, gz];
  await page.evaluate(setCam, cam);
  await new Promise((r) => setTimeout(r, 1500));
  const file = path.join(OUT, 'r23-11-palace-green-eye.png');
  await page.screenshot({ path: file });
  report.shots.push({ id: '11-palace-green-eye', label: '宫苑绿毯内部 · 人眼平视草叶与花', cam, file });
  console.log('shot 11-palace-green-eye @', greenSpot, '->', file);
}
report.greenSpot = greenSpot;

report.runtime = await page.evaluate(() => {
  const q = window.__qingming;
  const detail = q.world.assetAudit?.detail ?? {};
  const sum = (re) => Object.entries(detail)
    .filter(([k]) => re.test(k)).reduce((a, [, v]) => a + (typeof v === 'number' ? v : 0), 0);
  const life = window.__mtnLife || {};
  const total = (o) => Object.values(o || {}).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0);
  return {
    bundle: [...document.querySelectorAll('script[type="module"]')].map((s) => s.src.split('/').pop()),
    errors: window.__errs || [],
    kits: {
      r23Tuft: sum(/^park\.r23\.tuft$/),
      r23Stone: sum(/^park\.r23\.stone$/),
      r23GrassRect: sum(/^park\.r23\.grassRect$/),
      palaceFloraClusters: sum(/^palace\.groundFlora$/),
      palaceFloraPlants: sum(/^palace\.groundFlora\.plant$/),
      palaceFloraTufts: sum(/^palace\.groundFlora\.tuft$/),
      palaceFloraLawns: sum(/^palace\.groundFlora\.lawn$/),
      palaceGreenCells: sum(/^palace\.greenCarpet\.cell$/),
      palaceGreenTufts: sum(/^palace\.greenCarpet\.tuft$/),
      palaceGreenFlowers: sum(/^palace\.greenCarpet\.flower$/),
      palaceGreenCanopies: sum(/^palace\.greenCarpet\.canopy$/),
      wumenInterior: sum(/^palace\.gate\.wumen\.interior$/),
      wumenFurnish: sum(/^palace\.gate\.wumen\.furnish$/),
      wumenLiving: sum(/^palace\.gate\.wumen\.living$/),
      wumenHall: sum(/^palace\.gate\.wumen\.hall$/),
      slopeGrove: sum(/^mtn\.slopeCover\.grove$/),
      slopeMeadow: sum(/^mtn\.slopeCover\.meadow$/),
      slopeFlowerField: sum(/^mtn\.slopeCover\.flowerField$/),
      ecoPlaced: sum(/^eco\./),
    },
    mountainLife: {
      trees: total(life.trees), shrubs: total(life.shrubs),
      flowers: total(life.flowers), grass: total(life.grass),
      slopeCover: total(life.slopeCover),
      byMountain: { trees: life.trees, grass: life.grass, slopeCover: life.slopeCover },
    },
    render: q.engine.renderer ? {
      calls: q.engine.renderer.info.render.calls,
      triangles: q.engine.renderer.info.render.triangles,
    } : null,
  };
});

// 恒山南坡高程断面：证明「有一面连续、坡度可走的普通山坡」，而不是四面直上直下
report.southSlope = await page.evaluate(() => {
  const h = window.__mtnHeight;
  if (typeof h !== 'function') return null;
  const x = -3500, z0 = -16200, r = 3500;
  const line = [];
  for (let t = 0; t <= 12; t++) {
    const z = z0 + r * 1.25 * (t / 12);
    line.push([Math.round(z), Math.round(h(x, z))]);
  }
  const steps = [];
  for (let i = 1; i < line.length; i++) {
    const dz = line[i][0] - line[i - 1][0];
    const dy = line[i][1] - line[i - 1][1];
    steps.push(+(Math.atan2(Math.abs(dy), dz) * 180 / Math.PI).toFixed(1));
  }
  return { line, slopeDegPerSegment: steps, maxSlopeDeg: Math.max(...steps) };
});

fs.writeFileSync(path.join(OUT, 'r23-runtime.json'), JSON.stringify(report, null, 2));
console.log('\n=== R23 runtime ===');
console.log(JSON.stringify({ kits: report.runtime.kits, mountainLife: report.runtime.mountainLife,
  errors: report.runtime.errors.length, pageErrors: errs.length, southSlope: report.southSlope }, null, 2));
await browser.close();
