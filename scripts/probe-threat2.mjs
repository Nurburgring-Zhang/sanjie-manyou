/**
 * 威胁闭环验证（lead 版，对应工作流 C 的 API）：
 *  ① effectiveSpeed 随 speedScale 线性缩放（不依赖相机/化身位移）
 *  ② 孟婆茶失向：fadeHint=1、speedScale 下限 0.6、抖动 >0、结束后还原
 *  ③ Boss 阶段闸门：canGrab === (phase===2)，且 lastMove 不得在阶段 1 出现 grab
 * 用法：node scripts/probe-threat2.mjs   （需 npx vite preview --port 4173）
 */
import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !document.getElementById('loading'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));

const r = await p.evaluate(() => {
  const P = window.__qingming.world.player;
  const B = window.__qingming.world.boss;
  const near = (a, c) => Math.abs(a - c) < 1e-9;

  // ① 线性缩放
  P.speedScale = 0.55;
  const walkSlow = P.effectiveSpeed(false);
  const runSlow = P.effectiveSpeed(true);
  P.speedScale = 1;
  const walkFast = P.effectiveSpeed(false);
  const runFast = P.effectiveSpeed(true);
  const linear = near(walkSlow / walkFast, 0.55) && near(runSlow / runFast, 0.55) && near(runFast / walkFast, 8.2 / 3.6);

  // ② 失向
  P.speedScale = 1;
  P.applyDisorient(1);
  const dis = {
    fade: P.fadeHint,
    scale: P.speedScale,
    jitter: P.disorientJitter,
    speed: P.effectiveSpeed(false),
  };
  P.applyDisorient(0);
  const restored = { fade: P.fadeHint, scale: P.speedScale };

  // ③ Boss 闸门
  const gate = {
    phase: B.phase,
    canGrab: B.canGrab,
    lastMove: B.lastMove,
    gateOk: B.canGrab === (B.phase === 2) && (B.lastMove !== 'grab' || B.phase === 2),
  };

  return {
    speed: { walkSlow, runSlow, walkFast, runFast, linear },
    dis: { ...dis, jitterOk: dis.jitter > 0, speedOk: near(dis.speed, 2.16) },
    restored,
    restoreOk: restored.fade === 0 && restored.scale === 1,
    gate,
  };
});

const pass = r.speed.linear && r.dis.fade === 1 && Math.abs(r.dis.scale - 0.6) < 1e-9 && r.dis.jitterOk && r.dis.speedOk && r.restoreOk && r.gate.gateOk;
console.log(JSON.stringify({ ...r, pass }, null, 1));
await b.close();
process.exit(pass ? 0 : 1);
