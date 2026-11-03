/**
 * probe-input-health.mjs —— D10 输入健康度机检（键重复 / 单击路由 / DOM 写入 / 移动端跳跃键）
 *
 * 四个判据（全部只认实测值，不看代码「看起来对」）：
 *   A1 按住 V：首次 keydown 之后连发 20 次 repeat:true，toggleMode 只允许被调用 1 次
 *   A2 一次单击：puppeteer 派发 1 组 pointerdown/pointerup（落在屏幕内英雄身上），
 *      玩家出拳 / 指针锁定 / 英雄聚焦三个消费点的触发计数之和必须 = 1
 *   A3 静置 60 帧：#interact-prompt 的 textContent / innerHTML 写入次数必须 ≤ 8
 *   A4 触摸模拟下 #jumpbtn 必须存在、可见，且按下后玩家真的离地
 *
 * 用法：PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-input-health.mjs
 * 退出码：0=PASS / 1=BLOCK / 2=USAGE_ERROR
 *
 * 诚实边界：
 *   - A2 为了可确定命中，会把一位英雄临时摆到相机正前方 12m（同一同步任务内还原），
 *     避免依赖「城市里恰好有英雄落在屏幕内」；测的是输入路由，不是英雄分布。
 *   - A3 只统计 #interact-prompt 自身的 textContent / innerHTML 赋值；classList 不计。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const D = { pass: 0, fail: 0, rows: [] };
function record(name, ok, detail) {
  D.rows.push({ name, ok, detail });
  if (ok) D.pass++; else D.fail++;
  console.log(`${ok ? 'PASS' : 'BLOCK'}  ${name}  ${detail}`);
}

async function boot(browser, { touch = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(touch
    ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { width: 1000, height: 700, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming,
    { timeout: 300000 },
  );
  await sleep(800);
  return page;
}

/** A1：按住 V 只翻一次 */
async function a1(page) {
  const r = await page.evaluate(() => {
    const p = window.__qingming.world.player;
    let calls = 0;
    const orig = p.toggleMode.bind(p);
    p.toggleMode = () => { calls++; return orig(); };
    // 归零到灵魂态，避免页面加载期间已有状态影响计数
    if (p.mode !== 'soul') orig();
    calls = 0;
    const fire = (repeat) => window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyV', key: 'v', repeat, bubbles: true, cancelable: true,
    }));
    fire(false);                       // 物理按下（不重复）
    const firstPress = calls;
    const modeAfterPress = p.mode;
    for (let i = 0; i < 20; i++) fire(true);   // 按住产生的 20 次自动重复
    return {
      firstPress,
      total: calls,
      modeAfterPress,
      modeAfterBurst: p.mode,
      state: p.state,
    };
  });
  const ok = r.firstPress === 1 && r.total === 1 && r.modeAfterBurst === 'avatar';
  record('A1 键重复', ok,
    `首按调用=${r.firstPress} · 20 次 repeat 后总调用=${r.total}（期望 1）· 首按后 mode=${r.modeAfterPress} · burst 后 mode=${r.modeAfterBurst}`);
  return r;
}

/** A2：一次 pointerup 只允许一个消费点生效 */
async function a2(page) {
  const r = await page.evaluate(() => {
    const { world, engine } = window.__qingming;
    const p = world.player;
    p.mode = 'avatar'; // 直接置附身：本探针只测输入路由，不测相机过渡
    engine.camera.updateMatrixWorld();
    const hero = world.crowd.heroes.find((h) => h.data && !h.hidden);
    if (!hero) return { error: 'crowd.heroes 中没有可用（data 且未隐藏）的英雄' };

    const oldPos = hero.pos.clone();
    const dir = new window.__qingming.THREE.Vector3();
    engine.camera.getWorldDirection(dir);
    hero.pos.copy(engine.camera.position).addScaledVector(dir, 12); // 保证落在屏幕内
    engine.camera.updateMatrixWorld();

    const v = hero.pos.clone();
    v.y += hero.yOff + 1.5 * hero.scale;
    v.project(engine.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;

    let attack = 0, lock = 0, focus = 0;
    const savedAttack = p.tryAttack;
    const savedLock = engine.togglePointerLock;
    const savedFocus = world.focusHero;
    p.tryAttack = function (...args) { attack++; return savedAttack.apply(this, args); };
    engine.togglePointerLock = function (...args) { lock++; return savedLock.apply(this, args); };
    world.focusHero = function (...args) { focus++; return savedFocus.apply(this, args); };

    const canvas = engine.renderer.domElement;
    const fire = (type) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerdown' ? 1 : 0,
      clientX: sx, clientY: sy,
    }));
    fire('pointerdown');
    fire('pointerup');

    hero.pos.copy(oldPos);
    p.tryAttack = savedAttack;
    engine.togglePointerLock = savedLock;
    world.focusHero = savedFocus;

    const locked = !!document.pointerLockElement;
    if (locked) document.exitPointerLock?.();
    const router = engine.input;
    return {
      sx: +sx.toFixed(0), sy: +sy.toFixed(0),
      attack, lock, focus, sum: attack + lock + focus,
      route: router?.lastRoute ?? null,
      hits: router?.hits ?? null,
    };
  });
  if (r.error) {
    record('A2 单击单触发', false, r.error);
    return r;
  }
  const ok = r.sum === 1;
  record('A2 单击单触发', ok,
    `攻击=${r.attack} 指针锁定=${r.lock} 英雄聚焦=${r.focus} ⇒ 合计=${r.sum}（期望 1）· 点击=(${r.sx},${r.sy})· 路由=${r.route ?? 'n/a'}`);
  return r;
}

/** A2b：功能保留回归 —— 路由接管后，出拳/指针锁定/拖拽过滤仍然各自可达 */
async function a2b(page) {
  const r = await page.evaluate(async () => {
    const { world, engine } = window.__qingming;
    const p = world.player;
    const canvas = engine.renderer.domElement;
    const counts = { attack: 0, lock: 0, focus: 0 };
    const savedAttack = p.tryAttack, savedLock = engine.togglePointerLock, savedFocus = world.focusHero;
    p.tryAttack = function (...a) { counts.attack++; return savedAttack.apply(this, a); };
    engine.togglePointerLock = function (...a) { counts.lock++; return savedLock.apply(this, a); };
    world.focusHero = function (...a) { counts.focus++; return savedFocus.apply(this, a); };
    const reset = () => { counts.attack = 0; counts.lock = 0; counts.focus = 0; };
    const snap = () => ({ ...counts, sum: counts.attack + counts.lock + counts.focus, route: engine.input?.lastRoute ?? null });

    // 屏幕上所有可见英雄的投影点：挑一个「点不到英雄」的空白点
    const v = new window.__qingming.THREE.Vector3();
    engine.camera.updateMatrixWorld();
    const pts = [];
    for (const h of world.crowd.heroes) {
      if (h.hidden || !h.data) continue;
      v.set(h.pos.x, h.pos.y + h.yOff + 1.5 * h.scale, h.pos.z).project(engine.camera);
      if (v.z > 1) continue;
      pts.push([(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight]);
    }
    const W = window.innerWidth, H = window.innerHeight;
    const cand = [
      [0.12 * W, 0.12 * H], [0.88 * W, 0.12 * H], [0.12 * W, 0.88 * H], [0.88 * W, 0.88 * H],
      [0.5 * W, 0.12 * H], [0.12 * W, 0.5 * H], [0.88 * W, 0.5 * H],
    ];
    let spot = cand[0], bestClear = -1;
    for (const c of cand) {
      let dmin = Infinity;
      for (const q of pts) dmin = Math.min(dmin, Math.hypot(c[0] - q[0], c[1] - q[1]));
      if (dmin > bestClear) { bestClear = dmin; spot = c; }
    }
    const fire = (x, y, upY = y) => {
      const base = {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0,
        clientX: x, clientY: y,
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
      if (upY !== null) canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, clientY: upY }));
    };

    reset(); p.mode = 'avatar';
    fire(spot[0], spot[1]);
    const avatarClick = snap();

    reset(); p.mode = 'soul';
    fire(spot[0], spot[1]);
    const soulClick = snap();

    reset();
    fire(spot[0], spot[1], spot[1] - 20); // 按下与抬起相差 20px → 拖拽，不消费
    const drag = snap();

    p.tryAttack = savedAttack; engine.togglePointerLock = savedLock; world.focusHero = savedFocus;
    p.mode = 'soul';
    await new Promise((r) => setTimeout(r, 60));
    if (document.pointerLockElement) document.exitPointerLock?.();
    return {
      spot: spot.map((n) => +n.toFixed(0)), clearance: +bestClear.toFixed(0),
      heroesOnScreen: pts.length, avatarClick, soulClick, drag,
    };
  });
  const ok = r.avatarClick.sum === 1 && r.avatarClick.attack === 1
    && r.soulClick.sum === 1 && r.soulClick.lock === 1
    && r.drag.sum === 0;
  record('A2b 功能保留', ok,
    `空白点=(${r.spot}) 距最近英雄=${r.clearance}px 屏内英雄=${r.heroesOnScreen}`
    + ` · 附身空白单击{攻击=${r.avatarClick.attack} 锁定=${r.avatarClick.lock} 聚焦=${r.avatarClick.focus} 路由=${r.avatarClick.route}}`
    + ` · 灵魂空白单击{锁定=${r.soulClick.lock} 路由=${r.soulClick.route}}`
    + ` · 拖拽消费=${r.drag.sum}`);
  return r;
}

/** A3：静置 60 帧，交互提示的 DOM 写入次数 */
async function a3(page) {
  const instrumented = await page.evaluate(() => {
    const el = document.getElementById('interact-prompt');
    if (!el) return false;
    window.__promptWrites = 0;
    const textDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    const htmlDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(el, 'textContent', {
      configurable: true,
      get() { return textDesc.get.call(this); },
      set(v) { window.__promptWrites++; textDesc.set.call(this, v); },
    });
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() { return htmlDesc.get.call(this); },
      set(v) { window.__promptWrites++; htmlDesc.set.call(this, v); },
    });
    return true;
  });
  if (!instrumented) {
    record('A3 DOM 写入频率', false, '未找到 #interact-prompt');
    return null;
  }
  const r = await page.evaluate(async () => {
    const start = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const tick = () => {
        frames++;
        if (frames >= 60 || performance.now() - start > 20000) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const el = document.getElementById('interact-prompt');
    return {
      frames,
      writes: window.__promptWrites,
      text: el.textContent,
      shown: el.classList.contains('show'),
    };
  });
  const ok = r.writes <= 8;
  record('A3 DOM 写入频率', ok,
    `${r.frames} 帧内写入=${r.writes}（期望 ≤8）· 当前文本=${JSON.stringify(r.text)} · show=${r.shown}`);
  return r;
}

/** A4：移动端（触摸模拟）跳跃键存在、可见、按下真的起跳 */
async function a4(browser) {
  const page = await boot(browser, { touch: true });
  const state = await page.evaluate(() => {
    const engine = window.__qingming.engine;
    const el = document.getElementById('jumpbtn');
    if (!el) {
      return {
        exists: false, visible: false, isTouch: engine.isTouch,
        bodyTouch: document.body.classList.contains('touch'),
      };
    }
    const cs = getComputedStyle(el);
    return {
      exists: true,
      display: cs.display,
      w: el.offsetWidth,
      h: el.offsetHeight,
      visible: cs.display !== 'none' && el.offsetWidth > 0 && el.offsetHeight > 0,
      isTouch: engine.isTouch,
      bodyTouch: document.body.classList.contains('touch'),
    };
  });
  let jump = null;
  if (state.exists && state.visible) {
    jump = await page.evaluate(async () => {
      const { world } = window.__qingming;
      const p = world.player;
      if (p.mode !== 'avatar') p.toggleMode();
      await new Promise((r) => setTimeout(r, 350));
      const y0 = p.actor.pos.y;
      const el = document.getElementById('jumpbtn');
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 7, pointerType: 'touch', isPrimary: true,
        clientX: window.innerWidth - 60, clientY: window.innerHeight - 160,
      }));
      await new Promise((r) => setTimeout(r, 300));
      return {
        y0: +y0.toFixed(3), y1: +p.actor.pos.y.toFixed(3),
        dy: +(p.actor.pos.y - y0).toFixed(3),
        vy: +p.vy.toFixed(3), mode: p.mode, state: p.state,
      };
    });
  }
  await page.close();
  const ok = !!state.exists && !!state.visible && !!jump && jump.dy > 0.05;
  record('A4 移动端跳跃键', ok,
    `存在=${state.exists} 可见=${state.visible} display=${state.display ?? 'n/a'} isTouch=${state.isTouch} body.touch=${state.bodyTouch}`
    + (jump ? ` · 按下后 dy=${jump.dy}m vy=${jump.vy} state=${jump.state}` : ' · 未执行起跳'));
  return { ...state, jump };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--window-size=1000,700', '--no-sandbox', '--enable-unsafe-swiftshader'],
});

try {
  console.log(`目标：${URL}`);
  const page = await boot(browser, { touch: false });
  await a1(page);
  await a2(page);
  await a2b(page);
  await a3(page);
  await page.close();
  await a4(browser);
} catch (e) {
  console.error('USAGE_ERROR:', e && e.stack ? e.stack : e);
  await browser.close();
  process.exit(2);
}

await browser.close();
console.log('');
for (const row of D.rows) console.log(`${row.ok ? 'PASS ' : 'BLOCK'} ${row.name}`);
console.log(`\n汇总：${D.pass} PASS / ${D.fail} BLOCK`);
console.log(D.fail === 0 ? 'RESULT=PASS' : 'RESULT=BLOCK');
process.exit(D.fail === 0 ? 0 : 1);
