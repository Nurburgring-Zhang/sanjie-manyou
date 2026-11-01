/**
 * 人群「自由乱走」判据：朝向直方图 + 位移方向方差 + 离街心的横向偏移。
 *
 * 用户原话：「为什么所有人排成线？？？要能自由的乱走！！！！」
 * 只看 yaw 圆标准差不够——一条街上双向流本来就有两个峰；「排成线」是**物理上挤在
 * 同一条折线**上，所以同时量三个量：
 *   A. 朝向直方图（12 个 30° 桶）：峰数（≥1.5×均匀期望才算峰）与香农熵。
 *      成列 ≈ 1–2 个峰、熵低；自由行走 ≥4 个峰、熵高。
 *   B. 30s 位移方向：对位移 >2m 的人做圆统计，报圆方差 1−R（0=全部同向，1=完全乱）。
 *   C. 横向偏移：到最近街道中心线的 |offset| 中位数，以及 |offset|<0.9m 的占比
 *      —— 这是「排成一条线」的物理判据（不是朝向）。
 *
 * 采样机位固定在北岸正街（z=52）地面，取半径 45m 内的路人；所有人一起推进仿真，
 * 不是只推采样点（否则孤立小世界本身就会更自由）。
 *
 * 用法：PROBE_URL=http://localhost:4275/ node scripts/probe-crowd-freewalk.mjs
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH
  || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const SIM_SECONDS = Number(process.env.SIM_SECONDS || 30);

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

const out = await page.evaluate(async (simSeconds) => {
  const { world } = window.__qingming;
  const crowd = world.crowd;
  const actors = crowd.actors;
  const beh = await import('/src/actors/behaviors.ts');
  const layout = await import('/src/city/layout.ts');

  // 机位：北岸正街地面（z=52）虹桥西侧
  const CAM = { x: -120, y: 1.7, z: 52 };
  const R = 45;
  const camPos = new window.__qingming.THREE.Vector3(CAM.x, CAM.y, CAM.z);

  const isWalker = (a) => !a.freeze && !a.attach && !a.data && !a.sky && !a.hidden
    && a.pos.y > -5 && a.pos.y < 40
    && Math.hypot(a.pos.x - CAM.x, a.pos.z - CAM.z) <= R;

  const sel = actors.filter(isWalker);
  // 远端节流按 ctx.t 判时间戳：先把历史时间戳清零，否则 t 回退会让所有人被判定为「刚 tick 过」
  for (const a of actors) a.lastTick = 0;

  const binsOf = (ys) => {
    const b = new Array(12).fill(0);
    for (const y of ys) {
      let k = Math.floor(((y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 6));
      if (k >= 12) k = 11;
      b[k]++;
    }
    return b;
  };
  const entropy = (bins) => {
    const n = bins.reduce((s, v) => s + v, 0) || 1;
    let H = 0;
    for (const v of bins) if (v > 0) { const p = v / n; H -= p * Math.log2(p); }
    return H;
  };
  const peaks = (bins) => {
    const n = bins.reduce((s, v) => s + v, 0) || 1;
    const floor = Math.max(2, n / 12 * 1.5);
    let c = 0;
    for (let i = 0; i < bins.length; i++) {
      const prev = bins[(i + 11) % 12], next = bins[(i + 1) % 12];
      if (bins[i] >= floor && bins[i] >= prev && bins[i] >= next) c++;
    }
    return c;
  };
  /** 局部极大值（不设幅度门槛）：朝向直方图「峰」的标准定义；平台只算一次 */
  const peaksLocal = (bins) => {
    let c = 0;
    for (let i = 0; i < bins.length; i++) {
      const prev = bins[(i + 11) % 12], next = bins[(i + 1) % 12];
      if (bins[i] > 0 && bins[i] >= prev && bins[i] >= next && (bins[i] > prev || bins[i] > next)) c++;
    }
    return c;
  };
  // 离最近街道中心线的横向距离（东西街看 |z-line|，南北街看 |x-line|）
  const lateral = (x, z) => {
    let best = Infinity;
    for (const s of layout.H_STREETS) if (x >= s.x0 - 6 && x <= s.x1 + 6) best = Math.min(best, Math.abs(z - s.z));
    for (const s of layout.V_STREETS) if (z >= s.z0 - 6 && z <= s.z1 + 6) best = Math.min(best, Math.abs(x - s.x));
    return best;
  };
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };

  const yaw0 = sel.map((a) => a.yaw);
  const p0 = sel.map((a) => ({ x: a.pos.x, z: a.pos.z }));
  const bins0 = binsOf(yaw0);
  const lat0 = sel.map((a) => lateral(a.pos.x, a.pos.z)).filter(Number.isFinite);

  // 推进 30s：dt=1/30，所有人一起走（与 Crowd.update 同一条 tickActor 路径，只是不写实例矩阵）
  const dt = 1 / 30;
  const steps = Math.round(simSeconds / dt);
  let t = 1;
  const ctx = crowd.ctx(camPos, t);
  const yawTrace = [];
  for (let i = 0; i < steps; i++) {
    t += dt;
    ctx.t = t;
    for (const a of actors) {
      if (a.freeze || a.attach || a.hidden) continue;
      beh.tickActor(a, dt, ctx);
    }
    // 30s 内每秒采一次朝向：单帧快照只有 50 来人，直方图噪声大；
    // 「30 秒内行人的朝向直方图」按时间累积统计更稳，也更贴近「这段时间里怎么走」。
    if (i % 30 === 0) for (const a of sel) yawTrace.push(a.yaw);
  }
  const traceBins = binsOf(yawTrace);

  const yaw1 = sel.map((a) => a.yaw);
  const bins1 = binsOf(yaw1);
  const moved = [];
  for (let i = 0; i < sel.length; i++) {
    const dx = sel[i].pos.x - p0[i].x, dz = sel[i].pos.z - p0[i].z;
    const d = Math.hypot(dx, dz);
    if (d > 2) moved.push({ dx, dz, d, yaw: sel[i].yaw, occ: sel[i].occ, action: sel[i].action });
  }
  const dirs = moved.map((m) => Math.atan2(m.dx, m.dz));
  let mc = 0, ms = 0;
  for (const d of dirs) { mc += Math.cos(d); ms += Math.sin(d); }
  const Rbar = moved.length ? Math.hypot(mc / moved.length, ms / moved.length) : 0;
  const dispBins = binsOf(dirs);
  // 横向偏移直接量「人相对街心的位置」，不是位移后的位置
  const latNow = sel.map((a) => lateral(a.pos.x, a.pos.z)).filter(Number.isFinite);
  const speeds = sel.map((a) => a.speed);
  const speedMean = speeds.reduce((s, v) => s + v, 0) / Math.max(1, speeds.length);
  const speedStd = Math.sqrt(speeds.reduce((s, v) => s + (v - speedMean) ** 2, 0) / Math.max(1, speeds.length));
  const paused = sel.filter((a) => a.path.length === 0 && (a.action === 'stand' || a.action === 'sitTea' || a.action === 'squatRel' || a.action === 'sitNap')).length;

  return {
    cam: CAM, radius: R, simSeconds,
    sample: sel.length,
    actorsTotal: actors.length,
    before: {
      yawBins: bins0, yawEntropy: +entropy(bins0).toFixed(3), peaks: peaks(bins0), peaksLocal: peaksLocal(bins0),
      lateralMedian: median(lat0), laneShare: +(lat0.filter((v) => v < 0.9).length / Math.max(1, lat0.length)).toFixed(3),
    },
    after: {
      yawBins: bins1, yawEntropy: +entropy(bins1).toFixed(3), peaks: peaks(bins1), peaksLocal: peaksLocal(bins1),
      lateralMedian: median(latNow), laneShare: +(latNow.filter((v) => v < 0.9).length / Math.max(1, latNow.length)).toFixed(3),
    },
    trace: {
      samples: yawTrace.length,
      yawBins: traceBins,
      yawEntropy: +entropy(traceBins).toFixed(3),
      peaks: peaks(traceBins),
      peaksLocal: peaksLocal(traceBins),
    },
    displacement: {
      movers: moved.length,
      movedShare: +(moved.length / Math.max(1, sel.length)).toFixed(3),
      directionBins: dispBins,
      directionEntropy: +entropy(dispBins).toFixed(3),
      directionPeaks: peaks(dispBins),
      circularVariance: +(1 - Rbar).toFixed(3),
      meanSpeed: +speedMean.toFixed(2),
      speedStd: +speedStd.toFixed(2),
      stationaryShare: +(paused / Math.max(1, sel.length)).toFixed(3),
      sampleMoved: moved.slice(0, 6).map((m) => ({ occ: m.occ, d: +m.d.toFixed(1), yaw: +m.yaw.toFixed(2) })),
    },
    crowdStats: window.__crowd ? {
      yawStdMin: window.__crowd.yawStdMin,
      yawStdMean: window.__crowd.yawStdMean,
      yawMovingMin: window.__crowd.yawMovingMin,
      yawMovingMean: window.__crowd.yawMovingMean,
      gridEntropy: window.__crowd.gridEntropy,
    } : null,
  };
}, SIM_SECONDS);

console.log(JSON.stringify(out, null, 1));
await browser.close();
