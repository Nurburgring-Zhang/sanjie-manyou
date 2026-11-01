/**
 * 相机鼠标视角判据：任意模式（运镜/飞行/漫游/聚焦/附身）下，左键拖拽都能连续改 yaw/pitch。
 *
 * 判据：
 *   A. 每个模式拖动 12 步，yaw/pitch 每一步都在变，且单步增量有界（无跳变）；
 *   B. 运镜模式一拖就退出自动机位（camMode 变 fly），不是「某些模式鼠标完全不动」；
 *   C. 俯仰钳位 = ±85°（±1.4835 rad），向上/向下都到得了、都不过界。
 *
 * 用法：PROBE_URL=http://localhost:4275/ node scripts/probe-camera-look.mjs
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH
  || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const LIMIT = (85 * Math.PI) / 180;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
const ready = () => page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming,
  { timeout: 240000 },
);
await ready();
await new Promise((r) => setTimeout(r, 2000));
try { await ready(); } catch { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }

const state = () => page.evaluate(() => {
  const { engine, world } = window.__qingming;
  const avatar = world.player && world.player.mode === 'avatar';
  return {
    camMode: engine.camMode,
    cinemaActive: engine.cinemaActive,
    avatar,
    yaw: +(avatar ? world.player.camYaw : engine.yaw).toFixed(4),
    pitch: +(avatar ? world.player.camPitch : engine.pitch).toFixed(4),
  };
});

async function dragSeq(n = 12, dx = 9, dy = 3) {
  const s0 = await state();
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'left' });
  const steps = [];
  for (let i = 0; i < n; i++) {
    await page.mouse.move(640 + (i + 1) * dx, 360 + (i + 1) * dy);
    steps.push(await state());
  }
  await page.mouse.up({ button: 'left' });
  const s1 = await state();
  const dYaw = [], dPitch = [];
  let prev = s0;
  for (const s of steps) { dYaw.push(+(s.yaw - prev.yaw).toFixed(4)); dPitch.push(+(s.pitch - prev.pitch).toFixed(4)); prev = s; }
  return {
    before: s0, steps, after: s1,
    maxStepYaw: Math.max(...dYaw.map(Math.abs)),
    maxStepPitch: Math.max(...dPitch.map(Math.abs)),
    totalYaw: +(s1.yaw - s0.yaw).toFixed(4),
    totalPitch: +(s1.pitch - s0.pitch).toFixed(4),
    dYaw, dPitch,
  };
}

const out = { modes: {}, clamp: {} };

// ---- 1. 运镜（cinema）：拖拽应立刻退出自动机位 ----
await page.evaluate(() => {
  const { engine } = window.__qingming;
  engine.setCamMode('fly');
  engine.startCinema();
});
out.modes.cinema = await dragSeq();

// ---- 2. 飞行（fly）----
await page.evaluate(() => window.__qingming.engine.setCamMode('fly'));
out.modes.fly = await dragSeq();

// ---- 3. 漫游（walk）----
await page.evaluate(() => window.__qingming.engine.setCamMode('walk'));
out.modes.walk = await dragSeq();

// ---- 4. 聚焦（focus）----
await page.evaluate(() => {
  const { engine, THREE } = window.__qingming;
  engine.setCamMode('fly');
  engine.focusOn(new THREE.Vector3(0, 4, 0), 14, 30);
});
// 等聚焦补间与 lookTarget 收敛：自动机位还在动的时候拖，第一步会混入机位位移，不是拖拽不平滑
await new Promise((r) => setTimeout(r, 1800));
out.modes.focus = await dragSeq();

// ---- 5. 附身（avatar）：真实按 V，再拖拽 ----
await page.evaluate(() => window.__qingming.engine.setCamMode('fly'));
await page.keyboard.press('KeyV');
await new Promise((r) => setTimeout(r, 400));
out.modes.avatar = await dragSeq();
// 附身俯仰钳位：直接走 engine 转发的同一条 avatarLookDrag
out.avatarClamp = await page.evaluate((L) => {
  const p = window.__qingming.world.player;
  p.camPitch = 0;
  p.avatarLookDrag(0, -2000);
  const top = p.camPitch;
  p.avatarLookDrag(0, 4000);
  const bottom = p.camPitch;
  return {
    limitRad: +L.toFixed(4),
    top: +top.toFixed(4), topDeg: +(top * 180 / Math.PI).toFixed(2),
    bottom: +bottom.toFixed(4), bottomDeg: +(bottom * 180 / Math.PI).toFixed(2),
    within: Math.abs(top) <= L + 1e-6 && Math.abs(bottom) <= L + 1e-6,
  };
}, LIMIT);
// 回到灵魂模式，避免影响后续（若化身落在水里会进入 swim，toggleMode 会拒绝切换，先置回 foot）
await page.evaluate(() => {
  const p = window.__qingming.world.player;
  if (p.mode === 'avatar') { p.state = 'foot'; p.toggleMode(); }
});
await new Promise((r) => setTimeout(r, 200));

// ---- 6. 俯仰钳位：同一条 dragLook 通道，向上/向下各推 2 rad 的量 ----
out.clamp = await page.evaluate((L) => {
  const { engine, world } = window.__qingming;
  // 确保回到灵魂/飞行相机：附身态的 yaw/pitch 在 PlayerController 上，不在这里量
  const p = world.player;
  if (p && p.mode === 'avatar') { p.state = 'foot'; p.toggleMode(); }
  engine.setCamMode('fly');
  engine.pitch = 0;
  const up = [];
  for (let i = 0; i < 20; i++) { engine.dragLook(0, -60); up.push(+engine.pitch.toFixed(4)); }
  const top = engine.pitch;
  const down = [];
  for (let i = 0; i < 40; i++) { engine.dragLook(0, 60); down.push(+engine.pitch.toFixed(4)); }
  const bottom = engine.pitch;
  return {
    limitRad: +L.toFixed(4), expectDeg: 85,
    top: +top.toFixed(4), topDeg: +(top * 180 / Math.PI).toFixed(2),
    bottom: +bottom.toFixed(4), bottomDeg: +(bottom * 180 / Math.PI).toFixed(2),
    topSequence: up.slice(-4), bottomSequence: down.slice(-4),
    within: Math.abs(top) <= L + 1e-6 && Math.abs(bottom) <= L + 1e-6,
  };
}, LIMIT);

const modes = out.modes;
const smooth = Object.entries(modes).every(([, m]) =>
  Math.abs(m.totalYaw) > 0.1 && Math.abs(m.totalPitch) > 0.05
  && m.maxStepYaw < 0.08 && m.maxStepPitch < 0.05);
const cinemaReleased = modes.cinema.after.camMode === 'fly' && modes.cinema.after.cinemaActive === false;
const pass = smooth && cinemaReleased && out.clamp.within && out.avatarClamp.within
  && Math.abs(out.clamp.top - LIMIT) < 0.02 && Math.abs(out.clamp.bottom + LIMIT) < 0.02
  && Math.abs(out.avatarClamp.top - LIMIT) < 0.02 && Math.abs(out.avatarClamp.bottom + LIMIT) < 0.02;

console.log(JSON.stringify({
  ...out,
  checks: { smooth, cinemaReleased, clamp: out.clamp.within, avatarClamp: out.avatarClamp.within },
  pass,
}, null, 1));
await browser.close();
process.exit(pass ? 0 : 1);
