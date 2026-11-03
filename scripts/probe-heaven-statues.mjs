/**
 * 天宫神像/石像落位机检（W5）。
 *
 * 判据（三条全过才算 PASS）：
 *   ① |y − heavenY(ring.y)| ≤ 1        —— 石像必须站在 heavenFrame 换算后的台面上
 *   ② |horizDist − ring.r × 2.2| ≤ 5%  —— 水平半径必须按 HEAVEN_SCALE 放大
 *   ③ 向下射线落脚高差 ≤ 1m             —— 不许悬空，也不许埋进台基
 *
 * 读点：`sky_pantheon.userData.statues`（deities.ts 在合并石像时写出的落位账）。
 * 退出码：0 = PASS（35 尊全过），1 = BLOCK。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

// 与 src/sky/heavenFrame.ts 同源（探针单独跑在 Node，不引 TS）：2.2×、基准面 196、抬升 1935
const HEAVEN_SCALE = 2.2;
const HEAVEN_BASE_Y = 196;
const HEAVEN_LIFT = 1935;
const HEAVEN_BASE_LIFTED = HEAVEN_BASE_Y + HEAVEN_LIFT;
const heavenY = (y) => HEAVEN_BASE_LIFTED + (y - HEAVEN_BASE_Y) * HEAVEN_SCALE;

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const EXPECTED = 35;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready() {
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming,
    { timeout: 180000 },
  );
  await sleep(800);
}

/** HMR 可能在别的 agent 改文件时刷新页面 → evaluate 重试 */
async function readStatues(tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await ready();
      return await page.evaluate(() => {
        const { THREE, scene } = window.__qingming;
        const mesh = scene.getObjectByName('sky_pantheon');
        if (!mesh) return { error: 'scene 里找不到 sky_pantheon' };
        const spots = mesh.userData?.statues;
        if (!Array.isArray(spots) || spots.length === 0) return { error: 'sky_pantheon.userData.statues 为空' };
        const rc = new THREE.Raycaster();
        rc.far = 6;
        const city = [];
        scene.traverse((o) => {
          if (o.isMesh && o.name.startsWith('city_')) city.push(o);
        });
        const rows = [];
        for (const s of spots) {
          // ③ 向下射线：从像脚上方 0.8m 打到地面组（city_*），命中即落脚面
          rc.set(new THREE.Vector3(s.x, s.y + 0.8, s.z), new THREE.Vector3(0, -1, 0));
          const hits = rc.intersectObjects(city, false).filter((h) => h.object.visible);
          const ground = hits.length ? hits[0].point.y : null;
          rows.push({
            name: s.name, ring: s.ring, home: s.home,
            x: s.x, y: s.y, z: s.z,
            cx: s.cx, cz: s.cz, r: s.r, ringY: s.ringY,
            ground, groundObj: hits.length ? hits[0].object.name : null,
          });
        }
        return { rows };
      });
    } catch (e) {
      console.log(`  (页面重载/读取失败，重试 ${i + 1}/${tries}: ${String(e).split('\n')[0].slice(0, 90)})`);
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    }
  }
  return { error: '重试耗尽：页面始终读不到石像落位账' };
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
const data = await readStatues();
await browser.close();

if (data.error) {
  console.error(`[BLOCK] ${data.error}`);
  process.exit(1);
}

const rows = data.rows;
console.log('=== 天宫神像/石像落位机检 ===');
console.log(
  ['#', '名称', '环', 'x', 'y', 'z', 'y(期望)', 'Δy', 'r(水平)', 'r(期望)', 'Δr%', '地面y', 'Δ地', '判定']
    .join('\t'),
);
let pass = 0;
let failY = 0;
let failR = 0;
let failGround = 0;
const failures = [];
for (let i = 0; i < rows.length; i++) {
  const s = rows[i];
  const wantY = heavenY(s.ringY);
  const dy = Math.abs(s.y - wantY);
  const dist = Math.hypot(s.x - s.cx * HEAVEN_SCALE, s.z - s.cz * HEAVEN_SCALE);
  const wantR = s.r * HEAVEN_SCALE;
  const drPct = wantR > 1e-6 ? (Math.abs(dist - wantR) / wantR) * 100 : 0;
  const dg = s.ground === null ? Infinity : Math.abs(s.ground - s.y);
  const okY = dy <= 1;
  const okR = wantR > 1e-6 && drPct <= 5;
  const okG = dg <= 1;
  const ok = okY && okR && okG;
  if (ok) pass++;
  if (!okY) failY++;
  if (!okR) failR++;
  if (!okG) failGround++;
  if (!ok) {
    failures.push(
      `${s.name}[${s.ring}] y=${s.y.toFixed(2)} want=${wantY.toFixed(2)} Δy=${dy.toFixed(2)}` +
        ` | horiz=${dist.toFixed(2)} want=${wantR.toFixed(2)} Δr=${drPct.toFixed(1)}%` +
        ` | ground=${s.ground === null ? 'none' : s.ground.toFixed(2)} Δ地=${Number.isFinite(dg) ? dg.toFixed(2) : 'inf'}`,
    );
  }
  console.log(
    [
      i + 1,
      s.name,
      s.ring,
      s.x.toFixed(2),
      s.y.toFixed(2),
      s.z.toFixed(2),
      wantY.toFixed(2),
      dy.toFixed(2),
      dist.toFixed(2),
      wantR.toFixed(2),
      drPct.toFixed(1) + '%',
      s.ground === null ? 'none' : s.ground.toFixed(2),
      Number.isFinite(dg) ? dg.toFixed(2) : 'inf',
      ok ? 'PASS' : 'FAIL',
    ].join('\t'),
  );
}

console.log('---');
console.log(`总数=${rows.length}（期望 ${EXPECTED}） 通过=${pass} y越界=${failY} 半径越界=${failR} 落脚越界=${failGround}`);
if (failures.length) {
  console.log('失败明细：');
  for (const f of failures) console.log(`  · ${f}`);
}
const countOk = rows.length === EXPECTED;
const allOk = countOk && pass === rows.length;
console.log(allOk ? `PASS ${pass}/${EXPECTED} 尊全部落在 heavenY 台面、半径 ×2.2、脚下高差 ≤1m` : `BLOCK ${pass}/${EXPECTED}`);
process.exit(allOk ? 0 : 1);
