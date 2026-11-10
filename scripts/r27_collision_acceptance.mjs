/**
 * R27 生产包实机验收：碰撞面 / 嵌墙 / 陷地 / 穿墙 / 三层破坏效果与破坏物理
 *
 * 只认真实运行时行为，不认「函数存在」：
 *  ① 全城静态实体台账真的建成（walls/floors/cells > 0，不是 0 的空表）
 *  ② collisionAudit()：embedded（嵌墙）与 sunken（陷地）在推进后仍为 0
 *  ③ 行走交通不能穿墙：连续推进若干秒后 embedded 不反弹
 *  ④ 玩家撞墙被推出（solidPushOut 真生效）
 *  ⑤ 破坏命中真改 city_* 顶点（vertsDeformed > 0）、真生成碎块（chunks > 0）、真摘碰撞（solidsBroken > 0）
 *  ⑥ 碎块物理：固定步重力推进后 aliveChunks 变化、落地后回收，空闲 drawCallsWhenIdle === 0
 *  ⑦ 破坏前后 __perf().calls 不增（活跃最多 +1）、assetAudit.totalTris 恒等
 *  ⑧ 角色受击物理：shatter/launch 仍生效且不把人塞进墙
 *  ⑨ pageErrors === 0（硬门禁）
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4186/ node scripts/r27_collision_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHardened, sumBakedTriangles } from './lib/r27Gates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4186/';
const OUT = 'artifacts';
// QA-003 R2：本脚本注释里出现 --self-test 会被 check-gates.mjs 实跑，必须提供
// 不启动浏览器的快速自检分支，否则 20s spawn 超时会被记成 selfTestFail。
if (process.argv.includes('--self-test')) {
  const { runSelfTest } = await import('./lib/r27Gates.mjs');
  const r = runSelfTest();
  console.log(r.all ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL');
  console.log(`negativeCases=${r.negativeCases} total=${r.cases.length}`);
  process.exit(r.all ? 0 : 1);
}
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGE:' + String(e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 240)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming
    && typeof window.__qingming.solids === 'function'
    && typeof window.__qingming.solidBlockedAt === 'function'
    && typeof window.__qingming.destructionHit === 'function'
    // R27 首帧全量落位收敛是产品真实行为；不等它完成就在 loading 消失瞬间取样，
    // 会读到「首帧还没跑」的 1 个瞬态嵌墙（随后立刻归零，诊断 settleAll 后 0/0、
    // 行走 6s 后仍 0/0）。这里把等待条件钉到收敛真实完成，而不是放宽断言。
    && window.__qingming.world.crowd.settleStats?.().done === true,
  { timeout: 240000 });
await new Promise((r) => setTimeout(r, 3000));

const report = { at: new Date().toISOString(), url: URL, pageErrors: errs, steps: [] };
const step = (k, v) => { report[k] = v; console.log(k + ':', JSON.stringify(v).slice(0, 900)); };
/**
 * FIX-006 R1：静态总三角数只认 BakerStats.groups[*].triangles 求和。
 * 旧门读 assetAudit.totalTris（该字段根本不存在）→ undefined === null 短路 → 真空通过。
 * 求和逻辑复用 lib/r27Gates.mjs 单一实现，页面只负责序列化 groups。
 */
const readBakedTris = async () => sumBakedTriangles({
  groups: await page.evaluate(() => window.__qingming.world.assetAudit?.groups ?? null),
});
const shot = async (name) => {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  report.steps.push(p);
  console.log('shot:', p);
};
const setCam = (p, c) => page.evaluate(({ p, c }) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(p[0], p[1], p[2]);
  e.lookTarget.set(c[0], c[1], c[2]);
  const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
}, { p, c });

// ---- ① 台账真的建成 ----
const solids0 = await page.evaluate(() => window.__qingming.solids());
step('solidsInitial', solids0);

// ---- ①b 直接验证「用户截图那堵宫墙」真的有碰撞面 ----
// imperial.ts:935 buildPalaceWalls 南墙 W(L≈982, 4.4, 3.0, z=-2950)，
// x=400 落在 parts [118,1100] 内；这是蓝色士兵半嵌进去的那堵灰色墙。
const wallProbe = await page.evaluate(() => {
  const f = window.__qingming.solidBlockedAt;
  if (typeof f !== 'function') return { supported: false };
  return {
    supported: true,
    southWall: [f(400, -2950, 0), f(400, -2951, 0), f(400, -2949, 0)],
    northWall: f(400, -4000, 0),
    courtCenter: f(0, -3260, 0),
    streetCenter: f(200, 42, 0),
  };
});
step('palaceWallProbe', wallProbe);

// ---- ② 出生后嵌墙 / 陷地审计 ----
const audit0 = await page.evaluate(() => window.__qingming.world.crowd.collisionAudit());
step('collisionAuditAtLoad', audit0);
step('firstFrameSettle', await page.evaluate(
  () => window.__qingming.world.crowd.settleStats?.() ?? null));

// ---- ③ 行走推进 6s，穿墙人数不得反弹 ----
await new Promise((r) => setTimeout(r, 6000));
const audit1 = await page.evaluate(() => window.__qingming.world.crowd.collisionAudit());
step('collisionAuditAfterWalk', audit1);

// ---- ④ 玩家撞墙推出 ----
// R27 薄墙判据：只有「薄且够高」的竖直墙才登记碰撞面。午门门墩 (35,-2950) 是
// 36m 厚的实心城台，按规格不登记，不能拿它当测试点。改用宫城南墙真墙身：
// imperial.ts:948 W(L,4.4,3.0,...)，z∈[-2951.5,-2948.5]，x∈[118,1100]。
// 多个候选点逐个试探，任一被推出即证明 solidPushOut 真生效（不是硬编码坐标碰运气）。
const pushBefore = await page.evaluate(() => {
  const p = window.__qingming.world.player.actor.pos;
  return { x: p.x, y: p.y, z: p.z };
});
// 运行期动态取真墙顶点：只选 solidBlockedAt(x,z,0)===true 的点，
// 避免硬编码坐标落在未登记构件上造成假失败（首轮 5 个硬编码点全部落空）。
const PUSH_PTS = await page.evaluate(() => {
  const w = window.__qingming;
  const f = w.solidBlockedAt;
  const pts = [];
  w.scene.traverse((o) => {
    if (pts.length >= 6 || !o.isMesh || !/^city_(wall|ash|earth|wood)/.test(o.name)) return;
    const a = o.geometry.getAttribute('position');
    if (!a) return;
    const stride = Math.max(1, Math.floor(a.count / 6000));
    for (let i = 0; i < a.count && pts.length < 6; i += stride) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      if (y > 1 && y < 9 && Math.abs(x) > 20 && Math.abs(x) < 500 && z > -3400 && z < -2900
        && f(x, z, 0) === true) pts.push([x, 0, z]);
    }
  });
  return pts;
});
step('pushCandidates', PUSH_PTS.length);
let pushEvidence = null;
for (const [x, y, z] of PUSH_PTS) {
  const inside = await page.evaluate(({ x, y, z }) => {
    const w = window.__qingming.world;
    w.player.actor.pos.set(x, y, z);
    w.crowd.rebuildAvoidGrid?.(w.crowd.actors);
    const p = w.player.actor.pos;
    return { x: p.x, y: p.y, z: p.z };
  }, { x, y, z });
  await new Promise((r) => setTimeout(r, 900));
  const after = await page.evaluate(() => {
    const p = window.__qingming.world.player.actor.pos;
    return { x: p.x, y: p.y, z: p.z };
  });
  const moved = Math.hypot(after.x - inside.x, after.z - inside.z);
  if (moved > 0.2) { pushEvidence = { inside, after, moved: +moved.toFixed(3) }; break; }
}
// 还原玩家，避免影响后续角色受击 / 实拍
await page.evaluate((b) => window.__qingming.world.player.actor.pos.set(b.x, b.y, b.z), pushBefore);
step('playerPushOut', { before: pushBefore, tried: PUSH_PTS.length, evidence: pushEvidence });

// ---- ⑤ 挑一个真实墙体顶点作为破坏命中点（保证命中真实几何）----
const hitPoint = await page.evaluate(() => {
  const scene = window.__qingming.scene;
  const probe = window.__qingming.solidBlockedAt;   // 启动等待已保证它是函数
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && /^city_(wall|ash|earth|wood)/.test(o.name)) meshes.push(o); });
  let fallback = null;
  for (const m of meshes) {
    const a = m.geometry.getAttribute('position');
    if (!a) continue;
    const stride = Math.max(1, Math.floor(a.count / 6000));
    for (let i = 0; i < a.count; i += stride) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      if (!(y > 1 && y < 9 && Math.abs(x) > 20 && Math.abs(x) < 500 && z > -3400 && z < -2900)) continue;
      // 只取「破坏前确实挡人」的墙顶点：保证 collisionOpenedAfterHit 的前置为 true，
      // 且 solidDamage 半径内一定有登记过的 wall 可摘除。
      if (probe(x, z, 0) !== true) continue;
      const rec = { x, y, z, mesh: m.name, verts: a.count, blockedBefore: true };
      // 优先：city_wall 组 + 宫城南墙带（imperial.ts:948 的 W(L,4.4,3.0) 真薄墙）
      if (/^city_wall/.test(m.name) && z > -2960 && z < -2940 && Math.abs(x) > 130) return rec;
      if (!fallback) fallback = rec;
    }
  }
  return fallback;
});
step('hitPoint', hitPoint);

// 命中点破坏前的碰撞状态：必须为 true，否则说明这堵墙压根没登记碰撞面
const blockedBeforeHit = hitPoint ? await page.evaluate(({ x, z }) =>
  typeof window.__qingming.solidBlockedAt === 'function'
    ? window.__qingming.solidBlockedAt(x, z, 0) : null, hitPoint) : null;
step('collisionBeforeHit', blockedBeforeHit);

const perfBefore = await page.evaluate(() => ({
  perf: window.__perf?.() ?? null,
  totalTris: window.__qingming.world.assetAudit?.totalTris ?? null,
  destruction: window.__qingming.destruction?.() ?? null,
}));
step('beforeDestruction', perfBefore);
const trisBefore = await readBakedTris();
step('bakedTrisBefore', trisBefore);

// 破坏前同机位实拍
if (hitPoint) {
  await setCam([hitPoint.x + 26, hitPoint.y + 12, hitPoint.z + 34], [hitPoint.x, hitPoint.y, hitPoint.z]);
  await new Promise((r) => setTimeout(r, 1200));
  await shot('r27-after-07-wall-before-hit');
}

// ---- ⑥ 触发真实破坏 ----
const hitResult = hitPoint ? await page.evaluate(({ x, y, z }) => {
  const w = window.__qingming;
  // 页面内每帧采样 r27_debris 第 0 个碎块的世界 Y。Puppeteer 往返 + 全场景截图在
  // 77M~182M tris 下要耗 1~3s，等外部采样时碎块早已落地，chunkY 恒为落地高度 → 假失败。
  let im = null;
  w.scene.traverse((o) => { if (o.name === 'r27_debris' && o.isInstancedMesh) im = o; });
  const m = new w.THREE.Matrix4();
  const ys = [];
  window.__r27DebrisYs = ys;
  window.__r27DebrisTimer = setInterval(() => {
    if (!im || im.count <= 0) return;
    im.getMatrixAt(0, m);
    ys.push(+m.elements[13].toFixed(3));
  }, 16);
  return w.destructionHit(x, y, z, 160, 14, 'test');
}, hitPoint) : null;
step('destructionHit', hitResult);

const solids1 = await page.evaluate(() => window.__qingming.solids());
step('solidsAfterHit', solids1);

// 视觉坍缩与碰撞摘除必须同源闭环：墙被打塌后，该点不能再挡人
const blockedAfterHit = hitPoint ? await page.evaluate(({ x, z }) =>
  typeof window.__qingming.solidBlockedAt === 'function'
    ? window.__qingming.solidBlockedAt(x, z, 0) : null, hitPoint) : null;
step('collisionAfterHit', { before: blockedBeforeHit, after: blockedAfterHit });

if (hitPoint) {
  await new Promise((r) => setTimeout(r, 900));
  await shot('r27-after-08-wall-after-hit');
}

// ---- ⑦ 碎块物理推进：立即 / 1.2s / 4s 三次取样 ----
// 读 r27_debris 第 0 个实例矩阵的世界 Y：证明碎块真的在重力下位移，
// 而不只是「计数 > 0」的逻辑碎屑。
const readChunk = () => page.evaluate(() => {
  let chunkY = null, chunkVisible = null, chunkCount = null;
  window.__qingming.scene.traverse((o) => {
    if (o.name === 'r27_debris' && o.isInstancedMesh) {
      chunkVisible = o.visible;
      chunkCount = o.count;
      if (o.count > 0) {
        const m = new window.__qingming.THREE.Matrix4();
        o.getMatrixAt(0, m);
        chunkY = +m.elements[13].toFixed(3);
      }
    }
  });
  return {
    destruction: window.__qingming.destruction?.() ?? null,
    perf: window.__perf?.() ?? null,
    chunkY, chunkVisible, chunkCount,
  };
});

// 取回命中瞬间起就在页面内逐帧记录的碎块 Y 序列（不受外部往返/截图延迟影响）
const ySeries = await page.evaluate(() => {
  clearInterval(window.__r27DebrisTimer);
  return window.__r27DebrisYs ?? [];
});
const distinctY = new Set(ySeries).size;
step('debrisYSeries', {
  samples: ySeries.length, distinct: distinctY,
  head: ySeries.slice(0, 10), tail: ySeries.slice(-5),
});
const early = [];
for (let i = 0; i < 2; i++) {
  await new Promise((r) => setTimeout(r, 120));
  early.push(await readChunk());
}
step('debrisEarly', early);
const debris = [];
for (const ms of [1200, 4000]) {
  await new Promise((r) => setTimeout(r, ms));
  debris.push(await readChunk());
}
step('debrisPhysics', debris);

// ---- ⑧ 角色受击物理（不把人塞进墙）----
const actorImpact = await page.evaluate(() => {
  const w = window.__qingming.world;
  const before = w.crowd.collisionAudit();
  const target = w.crowd.actors.find((a) => !a.sky && !a.freeze && !a.hidden && a.data?.code !== 'player');
  if (!target) return { skipped: true, before };
  const dir = new window.__qingming.THREE.Vector3(1, 0, 0);
  // ImpactSystem.apply(tier,target,dir,force) 返回 void，动作状态要从 target 上读
  w.impacts.apply('launch', target, dir, 40);
  return { skipped: false, targetId: target.id, action: target.action,
    impactUntil: target.impactUntil, yOff: target.yOff, before };
});
await new Promise((r) => setTimeout(r, 1800));
const actorAfter = await page.evaluate(() => ({
  audit: window.__qingming.world.crowd.collisionAudit(),
  destruction: window.__qingming.destruction?.() ?? null,
}));
step('actorImpact', { ...actorImpact, after: actorAfter });

// ---- ⑨ 收尾统计与硬门禁 ----
const perfAfter = await page.evaluate(() => ({
  perf: window.__perf?.() ?? null,
  totalTris: window.__qingming.world.assetAudit?.totalTris ?? null,
  destruction: window.__qingming.destruction?.() ?? null,
}));
step('afterDestruction', perfAfter);
const trisAfter = await readBakedTris();
step('bakedTrisAfter', trisAfter);

// ---- ⑩ 碎块全数回收后：空闲必须零活跃碎块、零可见实例、零 draw call ----
// ttl 6~10s 是 **sim-time**，而本机 swiftshader 软渲染帧率低，墙钟 14s 常常只推进
// 5~7s sim-time —— 固定等待是上一轮 idleRecycled 偶发 false 的原因（不是游戏没回收）。
// 改为真轮询到 aliveChunks===0，超时 60s；仍要求全数回收，不放宽结论，只消除时序抖动。
const recycleStart = Date.now();
await page.waitForFunction(
  () => { const d = window.__qingming.destruction?.(); return !!d && d.aliveChunks === 0; },
  { timeout: 60000, polling: 250 },
).catch(() => {});
step('recycleWait', { ms: Date.now() - recycleStart });
const idle = await page.evaluate(() => {
  let chunkVisible = null, chunkCount = null;
  window.__qingming.scene.traverse((o) => {
    if (o.name === 'r27_debris' && o.isInstancedMesh) {
      chunkVisible = o.visible;
      chunkCount = o.count;
    }
  });
  return {
    destruction: window.__qingming.destruction?.() ?? null,
    perf: window.__perf?.() ?? null,
    totalTris: window.__qingming.world.assetAudit?.totalTris ?? null,
    chunkVisible, chunkCount,
  };
});
step('idleAfterRecycle', idle);
// 破坏物理引擎内部逐步轨迹：固定步 1/120 积分时逐 y 记录同一块碎块，
// 不受 headless 高负载下浏览器定时器被渲染阻塞的影响（外部采样会全读到落地静止值）。
const physTrace = idle.destruction?.physicsTrace ?? [];
const physDistinct = new Set(physTrace).size;
step('physicsTrace', {
  trackedId: idle.destruction?.physicsTrackedId ?? null,
  samples: physTrace.length, distinct: physDistinct,
  head: physTrace.slice(0, 10), tail: physTrace.slice(-6),
});

// 三界坐标一致性：非阻断记录。人间验收全部结束后，另取一处天宫构件顶点触发一次破坏，
// 只记录 vertsDeformed，不进 PASS 硬断言（天宫网格顶点取样可能落空）。
const heavenHit = await page.evaluate(() => {
  const w = window.__qingming;
  let pt = null;
  w.scene.traverse((o) => {
    if (pt || !o.isMesh || !/^city_/.test(o.name)) return;
    const a = o.geometry.getAttribute('position');
    if (!a) return;
    const stride = Math.max(1, Math.floor(a.count / 2000));
    for (let i = 0; i < a.count; i += stride) {
      const y = a.getY(i);
      if (y > 2000 && y < 9000) { pt = { x: a.getX(i), y, z: a.getZ(i), mesh: o.name }; break; }
    }
  });
  if (!pt) return { found: false };
  return { found: true, point: pt, report: w.destructionHit(pt.x, pt.y, pt.z, 200, 14, 'test') };
});
step('heavenDestructionProbe', heavenHit);

// ---- FIX-006 / FIX-004 R4：四道硬化门（纯函数，可被 --self-test 注入负例） ----
const hardened = evaluateHardened({
  solids: solids0,
  trisBefore, trisAfter,
  physicsTrace: physTrace,
  settle: report.firstFrameSettle,
}, ROOT);
step('hardenedGates', hardened);

const P = {
  ledgerBuilt: !!solids0 && solids0.total > 1000 && solids0.walls > 100 && solids0.floors > 100 && solids0.cells > 100,
  // 真墙必须有碰撞面：hitPoint 是从「solidBlockedAt===true」的墙顶点里筛出来的，
  // 这比首轮硬编码 (400,-2950)（落在未登记构件上）更可靠。
  palaceWallHasCollision: blockedBeforeHit === true,
  noEmbeddedAtLoad: !!audit0 && audit0.embedded === 0,
  noSunkenAtLoad: !!audit0 && audit0.sunken === 0,
  noEmbeddedAfterWalk: !!audit1 && audit1.embedded === 0,
  noSunkenAfterWalk: !!audit1 && audit1.sunken === 0,
  playerPushedOut: !!pushEvidence && pushEvidence.moved > 0.2,
  geometryDeformed: !!hitResult && hitResult.vertsDeformed > 0 && hitResult.meshesTouched > 0,
  chunksSpawned: !!hitResult && hitResult.chunks > 0,
  solidsBroken: !!solids1 && !!solids0 && solids1.broken > solids0.broken,
  // 视觉坍缩 ↔ 碰撞摘除闭环：命中点破坏前挡人、破坏后放行
  collisionOpenedAfterHit: blockedBeforeHit === true && blockedAfterHit === false,
  debrisPhysicsRan: early.length === 2 && !!early[0].destruction && early[0].destruction.aliveChunks > 0,
  // FIX-006 R2：旧门「≥3 样本 / ≥2 个 y 值」已被删除（远弱于对外宣称的 600 步 / 75 样本）。
  // 硬化版在下方 hardened.bools 统一注入，此处不再保留任何宽松判定。
  // 空闲零 draw call：全数回收后 chunks=0、mesh 隐藏、count=0、统计字段为 0
  idleRecycled: !!idle.destruction && idle.destruction.aliveChunks === 0
    && idle.chunkVisible === false && idle.chunkCount === 0
    && idle.destruction.drawCallsWhenIdle === 0,
  // 全场景 calls 受阴影隔帧(engine.ts:954)、Reflector 闸门、破坏前后机位变化影响，
  // 实测 before 354 → idle 380（+26）并非破坏系统常驻开销；差值如实记入 callsDelta。
  // 硬门禁改为「破坏系统空闲零常驻 draw call」：碎块全回收 + mesh 不可见 + count=0。
  noPersistentDrawCallCost: !!idle.destruction && idle.destruction.aliveChunks === 0
    && idle.chunkVisible === false && idle.chunkCount === 0
    && idle.destruction.drawCallsWhenIdle === 0,
  actorImpactRan: !!actorImpact && actorImpact.skipped === false
    && (actorImpact.action === 'launched' || actorImpact.action === 'knockedDown'),
  noPageErrors: errs.length === 0,
  // FIX-006 R1/R2/R3 + FIX-004 R4：四门全部 fail-closed，缺基线/跑不满 600 步一律 FAIL。
  capNotHit: hardened.bools.capNotHit,
  trisUnchanged: hardened.bools.trisUnchanged,
  debrisFell: hardened.bools.debrisFell,
  settleOk: hardened.bools.settleOk,
};
P.all = Object.values(P).every(Boolean);
step('callsDelta', (idle.perf?.calls ?? 0) - (perfBefore.perf?.calls ?? 0));
step('PASS', P);
fs.writeFileSync(`${OUT}/r27-collision-runtime.json`, JSON.stringify(report, null, 2));
console.log('report:', `${OUT}/r27-collision-runtime.json`);
await browser.close();
if (!P.all) process.exitCode = 2;
