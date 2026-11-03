/**
 * 街面立面对称性机检（SPEC：左半 / 右半 门洞·窗格·灯点 三项计数比 0.5–2.0）。
 *
 * 机位：(-46, 4.2, -50) → (40, 3.4, -54)，phase 0.3（夜晚，窗心与灯笼自发光最能读数）。
 *
 * 为什么不是纯像素统计、也不是纯台账统计：
 *   ① 纯台账会被"发了件但被挡住"骗过（民居立面就在院墙后面）；
 *   ② 纯像素分割在夜景里分不开暗门洞与暗檐影。
 * 所以取两者交集：台账给出**每一件构件的世界坐标与尺寸**（buildings.ts 的 __w2Facade，灯笼走 __w2Street），
 * 投影到屏幕后**回采该处的真实像素**，只有颜色符合该类构件（门=暗、窗=暖亮、灯=红亮）才算"可见"。
 * 被墙挡住的构件在像素上过不了，发了但看不见的一律不计。
 *
 * 退出码：0 = PASS（三项都在 0.5–2.0 之间），1 = BLOCK。用法：
 *   PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-street-facade.mjs
 *   PROBE_TRACE=1 ... 打印逐件像素统计（调阈值用）
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const CAM = [-46, 4.2, -50];
const TGT = [40, 3.4, -54];
const PHASE = 0.3;
const W = 1600, H = 900;
const OUT = 'artifacts/_facade';
const RATIO_MIN = 0.5;
const RATIO_MAX = 2.0;
const TRACE = process.env.PROBE_TRACE === '1';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 300000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const ready = async () => {
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
};
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 300000 });
await ready();
await new Promise((r) => setTimeout(r, 1500));

// 机位 + 冻结相位（paused 后 update() 直接 return；apply 仍在原型上，直接调用绕开早退）。
// 并行 agent 的源码改动会触发 Vite HMR 整页重载：重载后 __qingming 还在，但场景回到加载态，
// 截到的就是黑屏/加载图。用「活体令牌」在截图前后校验，掉线就重新装填机位再来一次。
const arm = async () => {
  await ready();
  await page.evaluate((p, t, phase) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(p[0], p[1], p[2]);
    const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.time.paused = true;
    e.time.phase = phase;
    e.time.apply(phase);
    window.__probeTok = String(Math.random());
  }, CAM, TGT, PHASE);
  return page.evaluate(() => window.__probeTok);
};
const alive = async (tok) => page.evaluate(
  (t) => window.__probeTok === t && !!window.__qingming && !document.getElementById('loading'),
  tok,
).catch(() => false);

let shot = null;
for (let attempt = 1; attempt <= 4 && !shot; attempt++) {
  await ready();
  await new Promise((r) => setTimeout(r, 1200));
  const tok = await arm();
  await new Promise((r) => setTimeout(r, 1800));
  if (!(await alive(tok))) { console.log(`[probe] 第 ${attempt} 次：页面被重载，重试`); continue; }
  shot = await page.screenshot({ encoding: 'base64' });
  if (!(await alive(tok))) { console.log(`[probe] 第 ${attempt} 次：截图后页面被重载，重试`); shot = null; }
}
if (!shot) { console.log('BLOCK：页面在 4 次尝试内都没有稳定下来（HMR 重载）'); await browser.close(); process.exit(1); }

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/probe_street_phase0.3.png`, Buffer.from(shot, 'base64'));

const result = await page.evaluate(async (b64, w, h) => {
  const load = () => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = 'data:image/png;base64,' + b64;
  });
  const img = await load();
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const Q = window.__qingming;
  const THREE = Q.THREE;
  const cam = Q.engine.camera;
  cam.updateMatrixWorld(true);

  const at = (x, y) => {
    const i = ((y | 0) * w + (x | 0)) * 4;
    return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
  };
  // 灯身是 C.lantern 0xff5a3c；窗心是 C.winGlow 0xffc66e；门是 lacquer/woodDark 的暗红褐。
  // 三类判据不重叠：灯红、窗暖黄、门暗（且红>蓝，与月灰墙区分）。
  const isLight = (r, g, b) => r > 0.42 && r > g * 1.32 && g < 0.72 && b < 0.36;
  const isWindow = (r, g, b) => r > 0.34 && g > b * 1.12 && r > b * 1.28 && !isLight(r, g, b);
  const score = (cx, cy, hw, hh, test) => {
    let hit = 0, n = 0;
    for (let y = cy - hh; y <= cy + hh; y++) {
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const [r, g, b] = at(x, y);
        n++;
        if (test(r, g, b)) hit++;
      }
    }
    return n ? hit / n : 0;
  };
  const lumaAt = (cx, cy, hw, hh) => {
    let s = 0, n = 0;
    for (let y = cy - hh; y <= cy + hh; y++) {
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const [r, g, b] = at(x, y);
        s += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
      }
    }
    return n ? s / n : 1;
  };

  /**
   * 门洞判据：门心比**左右两侧的墙**暗一大截（不只"暗"）。
   * 夜景里整条街都暗，只按绝对亮度会把檐影、背光墙全数成门；比对两侧墙皮才是"洞口"的特征。
   */
  const meanRGB = (cx, cy, hw, hh) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy - hh; y <= cy + hh; y++) {
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const c = at(x, y);
        r += c[0]; g += c[1]; b += c[2]; n++;
      }
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  const doorVisible = (cx, cy, hw, hh) => {
    const [ir, ig, ib] = meanRGB(cx, cy, hw, hh);
    const inner = 0.2126 * ir + 0.7152 * ig + 0.0722 * ib;
    const outL = lumaAt(cx - hw * 3, cy, Math.max(2, hw * 0.8), hh);
    const outR = lumaAt(cx + hw * 3, cy, Math.max(2, hw * 0.8), hh);
    const outer = (outL + outR) / 2;
    // 门是朱漆/桐油深木色：红通道显著高于蓝通道；灰泥院墙在月光下是蓝灰（b ≥ r）。
    const woodish = ir > ib * 1.18 && ir > ig * 1.05;
    const ok = inner < 0.52 && (woodish || inner < outer * 0.8) ? 1 : 0;
    return { ok, dbg: [+ir.toFixed(2), +ig.toFixed(2), +ib.toFixed(2), +outer.toFixed(2)] };
  };

  /** 把一件构件投影到屏幕：返回像素中心 + 估计的屏幕尺寸，并给出到相机的距离 */
  const proj = (x, y, z, fw, fh) => {
    const dist = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
    const v = new THREE.Vector3(x, y, z).project(cam);
    if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) return null;
    const sx = Math.round((v.x * 0.5 + 0.5) * w);
    const sy = Math.round((-v.y * 0.5 + 0.5) * h);
    const a = new THREE.Vector3(x - fw / 2, y - fh / 2, z).project(cam);
    const b2 = new THREE.Vector3(x + fw / 2, y + fh / 2, z).project(cam);
    const pw = Math.abs((b2.x - a.x) * 0.5 * w);
    const ph = Math.abs((b2.y - a.y) * 0.5 * h);
    return { sx, sy, pw: Math.min(pw, ph), ph: Math.max(pw, ph), dist };
  };

  const fac = (window.__w2Facade || []);
  const lamps = (window.__w2Street || []).filter((f) => f.kind === 'lantern');
  const half = w / 2;
  const out = { door: [0, 0], window: [0, 0], light: [0, 0] };
  const seen = { door: [0, 0], window: [0, 0], light: [0, 0] };
  const trace = [];
  const push = (cls, sx, sy, ok, frac) => {
    seen[cls][sx < half ? 0 : 1]++;
    out[cls][sx < half ? 0 : 1] += ok ? 1 : 0;
    trace.push([cls, sx, sy, +frac.toFixed(2), ok ? 1 : 0]);
  };

  const MAXD = 160;
  const stage = { door: [0, 0, 0, 0], window: [0, 0, 0, 0], light: [0, 0, 0, 0] };
  for (const f of fac) {
    const p = proj(f.x, f.y, f.z, Math.max(0.6, f.w), Math.max(0.6, f.h));
    const st = stage[f.cls];
    if (!p) { st[0]++; continue; }
    if (p.dist > MAXD) { st[1]++; continue; }
    if (f.cls === 'door') {
      if (p.ph < 12) { st[2]++; continue; }
      st[3]++;
      const hw = Math.max(2, Math.min(9, Math.round(p.pw * 0.3)));
      const hh = Math.max(3, Math.min(12, Math.round(p.ph * 0.3)));
      const ok = doorVisible(p.sx, p.sy, hw, hh);
      push('door', p.sx, p.sy, ok.ok === 1, ok.ok);
      if (trace.length <= 200) trace.push(['doorDbg', p.sx, p.sy, ok.dbg[0], ok.dbg[1]]);
    } else {
      if (p.pw < 2) { st[2]++; continue; }
      st[3]++;
      const hw = Math.max(1, Math.min(8, Math.round(p.pw * 0.3)));
      const hh = Math.max(1, Math.min(8, Math.round(p.ph * 0.26)));
      const warm = score(p.sx, p.sy, hw, hh, isWindow);
      // 窗的两种可判读形态：夜里点亮的窗心（暖光）/ 未点亮的窗（比墙皮暗一截的格心）。
      // 被院墙挡住的立面窗两种都不成立（采到的是墙皮），因此不会计入。
      const inner = lumaAt(p.sx, p.sy, hw, hh);
      const outer = (lumaAt(p.sx - hw * 3, p.sy, Math.max(2, hw * 0.8), hh)
        + lumaAt(p.sx + hw * 3, p.sy, Math.max(2, hw * 0.8), hh)) / 2;
      const dark = inner < 0.34 && outer > 0.02 && inner < outer * 0.82;
      push('window', p.sx, p.sy, warm > 0.12 || dark, Math.max(warm, dark ? 0.2 : 0));
      if (trace.length <= 300) trace.push(['winDbg', p.sx, p.sy, +warm.toFixed(2), +inner.toFixed(2), +outer.toFixed(2), f.src, f.lit ? 1 : 0]);
    }
  }
  for (const l of lamps) {
    const p = proj(l.x, l.y, l.z, Math.max(0.3, l.s * 0.8), Math.max(0.4, l.s));
    const st = stage.light;
    if (!p) { st[0]++; continue; }
    if (p.dist > MAXD) { st[1]++; continue; }
    if (Math.max(p.pw, p.ph) < 4) { st[2]++; continue; }
    st[3]++;
    const hw = Math.max(2, Math.min(9, Math.round(p.pw * 0.5)));
    const hh = Math.max(2, Math.min(9, Math.round(p.ph * 0.5)));
    const frac = score(p.sx, p.sy, hw, hh, isLight);
    push('light', p.sx, p.sy, frac > 0.3, frac);
  }
  return { counts: out, seen, stage, trace: trace.slice(0, 400) };
}, shot, W, H);

const c = result.counts;
const ratio = (a, b) => (Math.min(a, b) === 0 ? (Math.max(a, b) === 0 ? 1 : Infinity) : Math.max(a, b) / Math.min(a, b));

console.log(`相机 ${CAM.join(',')} → ${TGT.join(',')}  phase ${PHASE}`);
console.log(`视野内台账：门 ${result.seen.door[0]}/${result.seen.door[1]}（左/右） 亮窗 ${result.seen.window[0]}/${result.seen.window[1]}  灯 ${result.seen.light[0]}/${result.seen.light[1]}`);
console.log(`漏斗 door ${result.stage.door} | window ${result.stage.window} | light ${result.stage.light}（出屏/超距/尺寸或未亮/计数）`);
const rows = [];
let pass = true;
for (const cls of ['door', 'window', 'light']) {
  const [l, r] = c[cls];
  const rr = ratio(l, r);
  const ok = rr >= RATIO_MIN && rr <= RATIO_MAX;
  pass = pass && ok;
  rows.push(`  ${cls.padEnd(6)} 左 ${String(l).padStart(3)} | 右 ${String(r).padStart(3)} | 比 ${rr === Infinity ? '∞' : rr.toFixed(2)} | ${ok ? 'PASS' : 'BLOCK'}`);
}
console.log(rows.join('\n'));
console.log(`判定：${pass ? 'PASS' : 'BLOCK'}（三项都要落在 ${RATIO_MIN}–${RATIO_MAX}）`);
if (TRACE) {
  const t = result.trace;
  for (const row of t.slice(0, 120)) console.log('TRACE', JSON.stringify(row));
}

// 标注图：把"判为可见"的构件圈出来，供人工复核（不影响上面的判定）
await page.evaluate((traces) => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
  const COL = { door: '#00ff66', window: '#ffd400', light: '#ff3b3b' };
  for (const [cls, sx, sy, frac, ok] of traces) {
    if (!ok) continue;
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${sx - 7}px;top:${sy - 7}px;width:14px;height:14px;border:2px solid ${COL[cls]};border-radius:50%;opacity:.9`;
    box.appendChild(d);
  }
  document.body.appendChild(box);
}, result.trace);
await new Promise((r) => setTimeout(r, 300));
writeFileSync(`${OUT}/probe_street_marked.png`, await page.screenshot({ encoding: 'base64' }), 'base64');

await browser.close();
process.exit(pass ? 0 : 1);
