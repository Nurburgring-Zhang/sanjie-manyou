/**
 * 天宫活体神佛演员落位机检（W5-2）。
 *
 * 静像（sky_pantheon）由 probe-heaven-statues.mjs 守住；本探针守**活体演员**
 * （DeityStage 的 35 尊，会走位/战斗的那些）。旧 bug：DeityStage 直接吃 SkyCenters 的
 * 混合口径（x/z 缩放前、y 已 +HEAVEN_LIFT），演员比台面低 12–22m、水平半径只有 1/2.2。
 *
 * 判据（三条全过才算 PASS）：
 *   ① |y − heavenY(preY)| ≤ 1        —— 站在 heavenFrame 换算后的落脚面
 *   ② |horizDist − r × 2.2| ≤ 5%     —— 水平半径按 HEAVEN_SCALE 放大（r = 缩放前环半径）
 *   ③ 向下射线落脚高差 ≤ 1m           —— 不许悬空、不许埋进台基
 *
 * 读点：`world.deitySpots`（world.ts standDeityActors 写出的落位账：pre + 世界落点 + 环心/半径）
 *       `world.deities.map`（实时 Actor，pos 即脚底）
 * 量之前先置 `world.havoc.hold` / `world.deityHold` 停摆，再把演员复位到账面落点——
 * 量的是**落位**，不是「这一刻恰好飞到哪」。
 *
 * 退出码：0 = PASS（35/35），1 = BLOCK。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

// 与 src/sky/heavenFrame.ts 同源（探针单独跑在 Node，不引 TS）
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
  await sleep(600);
}

/** HMR 可能在别的 agent 改文件时刷新页面 → evaluate 重试 */
async function readActors(tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await ready();
      return await page.evaluate((LIFT) => {
        const { THREE, scene, world } = window.__qingming;
        if (!world?.deities?.map) return { error: 'world.deities.map 不可读' };
        // 停掉战斗编排与每日编排，量的是「落位」不是「这一帧恰好飞到哪」
        if (world.havoc) world.havoc.hold = true;
        world.deityHold = true;
        const spots = Array.isArray(world.deitySpots) ? world.deitySpots : [];
        const byName = new Map(spots.map((s) => [s.name, s]));
        const city = [];
        scene.traverse((o) => {
          if (o.isMesh && o.name.startsWith('city_')) city.push(o);
        });
        const rc = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        // 首帧后会被编排移动的演员：孙悟空（Havoc 第一幕）、嫦娥（绕月）、哮天犬（绕二郎神）
        const MOVED_AT_RUNTIME = new Set(['孙悟空', '嫦娥仙子', '哮天犬']);
        const rows = [];
        for (const [name, a] of world.deities.map) {
          const s = byName.get(name);
          // 无落位账 → 旧混合口径反推（红态基线）；有账 → 用账面缩放前口径
          const preX = s ? s.preX : a.pos.x;
          const preY = s ? s.preY : a.pos.y - LIFT;
          const preZ = s ? s.preZ : a.pos.z;
          const cx = s ? s.cx : null;
          const cz = s ? s.cz : null;
          const r = s ? s.r : null;
          // 该演员按 heavenFrame 应站的世界 y（探针自带一份常量，不读页面里的换算结果）
          const wantYp = 196 + LIFT + (preY - 196) * 2.2;
          const live = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
          const ledger = s ? { x: s.x, y: s.y, z: s.z } : live;
          const liveLedger = Math.hypot(live.x - ledger.x, live.y - ledger.y, live.z - ledger.z);
          const runtimeMoved = MOVED_AT_RUNTIME.has(name);
          // 复位到账面世界落点再打射线（复位只抹掉首帧后的编排位移，不改落位）
          a.pos.set(ledger.x, ledger.y, ledger.z);
          rc.set(new THREE.Vector3(ledger.x, ledger.y + 0.8, ledger.z), down);
          rc.far = 6;
          const near = rc.intersectObjects(city, false).filter((h) => h.object.visible);
          // 诊断：从期望点上方 80m 往下 200m，看「真正的地面」在哪
          rc.set(new THREE.Vector3(ledger.x, wantYp + 80, ledger.z), down);
          rc.far = 200;
          const deep = rc.intersectObjects(city, false).filter((h) => h.object.visible);
          rows.push({
            name,
            home: s?.home ?? '?',
            live,
            ledger,
            liveLedger,
            runtimeMoved,
            pre: { x: preX, y: preY, z: preZ },
            center: cx === null ? null : { cx, cz, r },
            ground: near.length ? near[0].point.y : null,
            groundObj: near.length ? near[0].object.name : null,
            surface: deep.length ? deep[0].point.y : null,
          });
        }
        return { rows, hasLedger: spots.length > 0 };
      }, HEAVEN_LIFT);
    } catch (e) {
      console.log(`  (页面重载/读取失败，重试 ${i + 1}/${tries}: ${String(e).split('\n')[0].slice(0, 90)})`);
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    }
  }
  return { error: '重试耗尽：页面始终读不到天宫演员坐标' };
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
const data = await readActors();
await browser.close();

if (data.error) {
  console.error(`[BLOCK] ${data.error}`);
  process.exit(1);
}

const rows = data.rows;
console.log(`=== 天宫活体神佛演员落位机检（落位账：${data.hasLedger ? 'world.deitySpots' : '缺失→旧口径反推'}）===`);
console.log(
  ['#', '名称', 'home', 'x', 'y', 'z', 'y(期望)', 'Δy', 'r(水平)', 'r(期望)', 'Δr%', '地面y', 'Δ地', 'live↔账', '判定']
    .join('\t'),
);
let pass = 0;
let failY = 0;
let failR = 0;
let failGround = 0;
let failLive = 0;
const failures = [];
for (let i = 0; i < rows.length; i++) {
  const s = rows[i];
  const wantY = heavenY(s.pre.y);
  // 有三名演员首帧后就被编排带走，y 以落位账为准；其余量实时坐标
  const yRef = s.runtimeMoved ? s.ledger.y : s.live.y;
  const dy = Math.abs(yRef - wantY);
  const wantR = s.center ? s.center.r * HEAVEN_SCALE : null;
  const dist = s.center
    ? Math.hypot((s.runtimeMoved ? s.ledger.x : s.live.x) - s.center.cx * HEAVEN_SCALE,
      (s.runtimeMoved ? s.ledger.z : s.live.z) - s.center.cz * HEAVEN_SCALE)
    : 0;
  const drPct = wantR === null ? 0 : (Math.abs(dist - wantR) / Math.max(1e-6, wantR)) * 100;
  const dg = s.ground === null ? Infinity : Math.abs(s.ground - s.ledger.y);
  const liveOk = s.runtimeMoved || s.liveLedger <= 1;
  const okY = dy <= 1;
  const okR = wantR !== null && drPct <= 5;
  const okG = dg <= 1;
  const ok = okY && okR && okG && liveOk;
  if (ok) pass++;
  if (!okY) failY++;
  if (!okR) failR++;
  if (!okG) failGround++;
  if (!liveOk) failLive++;
  if (!ok) {
    failures.push(
      `${s.name}[${s.home}] y=${yRef.toFixed(2)} want=${wantY.toFixed(2)} Δy=${dy.toFixed(2)}` +
        ` | horiz=${dist.toFixed(2)} want=${wantR === null ? '?' : wantR.toFixed(2)} Δr=${drPct.toFixed(1)}%` +
        ` | ground=${s.ground === null ? 'none' : s.ground.toFixed(2)} Δ地=${Number.isFinite(dg) ? dg.toFixed(2) : 'inf'}` +
        ` | 上方80m射线=${s.surface === null ? 'none' : s.surface.toFixed(2)}` +
        ` | live↔账=${s.liveLedger.toFixed(2)}`,
    );
  }
  console.log(
    [
      i + 1,
      s.name,
      s.home,
      s.ledger.x.toFixed(2),
      yRef.toFixed(2),
      s.ledger.z.toFixed(2),
      wantY.toFixed(2),
      dy.toFixed(2),
      dist.toFixed(2),
      wantR === null ? '?' : wantR.toFixed(2),
      drPct.toFixed(1) + '%',
      s.ground === null ? 'none' : s.ground.toFixed(2),
      Number.isFinite(dg) ? dg.toFixed(2) : 'inf',
      s.runtimeMoved ? '编排' : s.liveLedger.toFixed(2),
      ok ? 'PASS' : 'FAIL',
    ].join('\t'),
  );
}

console.log('---');
console.log(`总数=${rows.length}（期望 ${EXPECTED}） 通过=${pass} y越界=${failY} 半径越界=${failR} 落脚越界=${failGround} live偏移=${failLive}`);
if (failures.length) {
  console.log('失败明细：');
  for (const f of failures) console.log(`  · ${f}`);
}
const countOk = rows.length === EXPECTED;
const allOk = countOk && pass === rows.length;
console.log(allOk ? `PASS ${pass}/${EXPECTED} 名演员 y=heavenY(preY)、水平半径 ×2.2、脚下高差 ≤1m` : `BLOCK ${pass}/${EXPECTED}`);
process.exit(allOk ? 0 : 1);
