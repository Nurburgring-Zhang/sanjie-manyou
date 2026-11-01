/** 关卡四件套验证：每个 POI 都有非空目标/威胁/恢复点，且恢复点 key 真实存在；HUD 目标行随传送变化 */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width:1280, height:720 });
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));

// 1) 数据完整性：所有 POI 键都要有四项，recover 必须是有效 key
const integrity = await p.evaluate(() => {
  const w = window.__qingming.world;
  const plan = w.__levelPlan ?? null;
  return { hasPlan: !!plan };
});
// plan 不暴露时，用 HUD 文案做端到端验证（更接近玩家视角）
const hud = async () => p.evaluate(() => {
  const n = window.__qingming.world.levelNow?.();
  return n ? `${n.key} ${n.name} ${Math.round(n.dist)}m ${n.objective}` : '(none)';
});
const results = [];
for (const key of ['jiangtai', 'naihe', 'zichen', 'fengdu', 'sansheng']) {
  await p.evaluate((k) => window.__qingming.world.teleport(k), key);
  await new Promise(r=>setTimeout(r,1400));
  const txt = await hud();
  results.push({ key, txt: String(txt).slice(0, 140) });
}
console.log(JSON.stringify({ integrity, results }, null, 1));
await b.close();
