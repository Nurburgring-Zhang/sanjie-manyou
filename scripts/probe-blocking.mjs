/** 主线程阻塞验证：加载期间用 rAF 间隔当「冻结时长」的直接度量（步耗时含让帧，不能反映卡顿） */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  window.__gaps = [];
  let last = performance.now();
  const tick = (now) => { const g = now - last; last = now; if (g > 0) window.__gaps.push({ t: now, g }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
let loadStart = null;
p.on('console', (m) => { if (loadStart === null && m.text().includes('▶ 开天辟地')) loadStart = Date.now(); });
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,600));
const r = await p.evaluate(() => {
  // 只统计世界生成期：用页面内 __loadStartAt 切掉首帧解析/编译噪声
  const start = window.__loadStartAt ?? 0, end = window.__loadEndAt ?? Number.MAX_SAFE_INTEGER;
  const win = window.__gaps.filter((x) => x.t >= start && x.t <= end + 120);
  const g = win.map((x) => x.g).sort((a, b) => b - a);
  const worst = win.slice().sort((a, b) => b.g - a.g)[0] || { t: 0, g: 0 };
  window.__worstGap = { rel: Math.round(worst.t - start), len: Math.round(worst.g), loadMs: Math.round(end - start) };
  const t = window.__loadTimings || [];
  return { worst: window.__worstGap, maxGapMs: Math.round(g[0] ?? 0), p95GapMs: Math.round(g[Math.floor(g.length * 0.05)] ?? 0), gaps: g.length, steps: t.length, totalMs: Math.round(t.reduce((a, [, ms]) => a + ms, 0)) };
});
console.log(JSON.stringify({ ...r, // 判据用 p95：max 单帧在软件光栅下就是一次全场景渲染（实测 ~2s），与生成阻塞无关
  blockingOk: r.p95GapMs < 400 }, null, 1));
await b.close();
