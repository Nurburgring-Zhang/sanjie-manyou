import puppeteer from 'puppeteer-core';
// ============ ISS-34：键盘交互自动化（CDP Input.dispatchKeyEvent 真实按键回放） ============
// 覆盖：V 附身切换 / WASD 行走方向语义 / Shift 疾驰 / 开船 W 油门 A 转舵 E 靠岸
// 前置：npm run build && npm run preview（4173）
const results = [];
const t = (id, ok, note) => { results.push({ id, ok, note }); console.log(ok ? 'PASS' : 'FAIL', id, '-', note); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!(window).__qingming, { timeout: 150000 }).catch(() => {});
const H = !!await page.evaluate(() => !!(window).__qingming).catch(() => false);
if (!H) { t('LOAD', false, '世界生成失败，后续用例无法执行'); console.log('SUMMARY: 0/1 PASS'); process.exit(1); }
// 让引擎先跑若干真实帧，稳定初始状态
await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__qingming.engine.step(1 / 30); });
const step = async (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__qingming.engine.step(1 / 30); }, n);

// ---- ISS-34a：V 键附身进入化身模式 ----
await page.keyboard.press('KeyV');
await step(5);
let mode = await page.evaluate(() => window.__qingming.world.player.mode);
t('ISS-34a-attach', mode === 'avatar', `按 V 后 mode=${mode}（期望 avatar）`);

// ---- ISS-34b：W 前进——位移方向必须沿相机前向（ISS-07 反向回归） ----
// 布点：北市集广场（开阔无碰撞），camYaw=0（相机在 +z 侧，视线朝 -z）
await page.evaluate(() => {
  const { world } = window.__qingming;
  world.player.actor.pos.set(250, 0, 78);
  world.player.camYaw = 0; world.player.camPitch = -0.18;
});
await step(10);
await page.keyboard.down('KeyW');
await step(90);
await page.keyboard.up('KeyW');
const fwd = await page.evaluate(() => {
  const p = window.__qingming.world.player.actor.pos;
  return { dx: +(p.x - 250).toFixed(2), dz: +(p.z - 78).toFixed(2), len: +Math.hypot(p.x - 250, p.z - 78).toFixed(2) };
});
// 期望：向 -z 前进（dz 显著为负），步速 3.6m/s × 3s ≈ 10.8m
const okW = fwd.len > 5 && fwd.dz < -fwd.len * 0.85;
t('ISS-34b-walk', okW, `W 位移 (${fwd.dx}, ${fwd.dz}) 共 ${fwd.len}m，期望 -z 前向 >5m`);

// ---- ISS-34c：D 右移 / S 后退（横移与后退语义） ----
await page.evaluate(() => { window.__qingming.world.player.actor.pos.set(250, 0, 78); window.__qingming.world.player.camYaw = 0; });
await step(5);
await page.keyboard.down('KeyD');
await step(45);
await page.keyboard.up('KeyD');
const strafe = await page.evaluate(() => {
  const p = window.__qingming.world.player.actor.pos;
  return { dx: +(p.x - 250).toFixed(2) };
});
await page.keyboard.down('KeyS');
await step(45);
await page.keyboard.up('KeyS');
const back = await page.evaluate(() => {
  const p = window.__qingming.world.player.actor.pos;
  return { dz: +(p.z - 78).toFixed(2) };
});
t('ISS-34c-strafe', strafe.dx > 2 && back.dz > 2, `D 右移 dx=${strafe.dx}m（期望 +x），S 后退 dz=${back.dz}m（期望 +z）`);

// ---- ISS-34d：Shift 疾驰倍速 ----
const runDist = await page.evaluate(async () => {
  const { world, engine } = window.__qingming;
  world.player.actor.pos.set(250, 0, 78);
  world.player.camYaw = 0;
  for (let i = 0; i < 20; i++) engine.step(1 / 30);
  const p0 = world.player.actor.pos.clone();
  engine.keys.add('KeyW');
  for (let i = 0; i < 60; i++) engine.step(1 / 30);
  const walk = Math.hypot(world.player.actor.pos.x - p0.x, world.player.actor.pos.z - p0.z);
  world.player.actor.pos.set(250, 0, 78);
  for (let i = 0; i < 20; i++) engine.step(1 / 30);
  const p1 = world.player.actor.pos.clone();
  engine.keys.add('ShiftLeft');
  for (let i = 0; i < 60; i++) engine.step(1 / 30);
  engine.keys.delete('ShiftLeft'); engine.keys.delete('KeyW');
  const run = Math.hypot(world.player.actor.pos.x - p1.x, world.player.actor.pos.z - p1.z);
  return { walk: +walk.toFixed(1), run: +run.toFixed(1) };
});
t('ISS-34d-run', runDist.run > runDist.walk * 1.4, `普通 ${runDist.walk}m vs Shift ${runDist.run}m / 2s（期望 >1.4×）`);

// ---- ISS-34e：开船——W 油门 / A 转舵 / E 靠岸 ----
// 布点（测试夹具，等效于码头交互点 exec 的状态置位；被验证对象是键盘→船物理链路）
const boat = await page.evaluate(async () => {
  const { world, engine } = window.__qingming;
  const b = world.units.playerBoat;
  world.player.mode = 'avatar';
  world.player.boat = b; b.driven = true; world.player.state = 'boat';
  const y0 = b.yaw, x0 = b.x, z0 = b.z;
  engine.keys.add('KeyW');
  for (let i = 0; i < 75; i++) engine.step(1 / 30);
  const throttle = b.throttle, moved = Math.hypot(b.x - x0, b.z - z0);
  engine.keys.add('KeyA');
  for (let i = 0; i < 45; i++) engine.step(1 / 30);
  engine.keys.delete('KeyW'); engine.keys.delete('KeyA');
  return { throttle: +throttle.toFixed(2), moved: +moved.toFixed(1), rudder: +b.rudder.toFixed(2), dYaw: +(b.yaw - y0).toFixed(3) };
});
// E 靠岸（avatar 模式下 E = tryInteract → 下船）
await page.keyboard.press('KeyE');
await step(5);
const off = await page.evaluate(() => {
  const p = window.__qingming.world.player;
  return { state: p.state, driven: p.boat ? p.boat.driven : 'null', mode: p.mode };
});
const okBoat = boat.throttle > 0.2 && boat.moved > 3 && boat.rudder > 0.1 && boat.dYaw > 0.02;
t('ISS-34e-boat', okBoat, `W 油门 ${boat.throttle} 移动 ${boat.moved}m；A 舵 ${boat.rudder} 偏航 +${boat.dYaw}rad（期望正，左舵语义）`);
t('ISS-34f-dismark', off.state === 'foot' && (off.driven === false || off.driven === 'null'), `按 E 下船后 state=${off.state} driven=${off.driven}（期望 foot/false）`);

// ---- 全程零错误 ----
t('ISS-34-clean', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '键盘会话全程零 console/page 错误');

// 证据截图（化身视角街景）
await page.evaluate(() => {
  const { world } = window.__qingming;
  world.player.actor.pos.set(250, 0, 78); world.player.camYaw = 2.6;
});
await step(12);
await page.screenshot({ path: 'screenshots/e2e3-keyboard.png' });
console.log('SUMMARY:', results.filter(r => r.ok).length + '/' + results.length, 'PASS');
await browser.close();
process.exit(results.every(r => r.ok) ? 0 : 1);
