/**
 * R12 验收：人口规模 / 分布去单线 / 行为多样性 / 场所覆盖 / 三界人口。
 * 依赖 crowd 暴露的 window.__crowd：
 *   { live, lods:[near,mid,far,impostor], actions:{kind:count}, gridEntropy,
 *     places:{ wards, temples, palace, washe }, axisShare }
 * 缺字段时按「未实现」判红，不猜。
 */
import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2000));

const r = await p.evaluate(() => {
  const c = window.__crowd;
  const w = window.__qingming.world;
  if (!c) return { err: 'no window.__crowd' };
  // 三界人数按 y 统计（天宫 y>120 / 地府 y<-100）
  const actors = (w.crowd.actors || w.crowd.list || []);
  let sky = 0, hell = 0;
  for (const a of actors) {
    const y = a.pos?.y ?? 0;
    if (y > 120) sky++;
    else if (y < -100) hell++;
  }
  return {
    live: c.live ?? actors.length,
    lods: c.lods ?? null,
    actionKinds: c.actions ? Object.keys(c.actions).length : 0,
    actions: c.actions ?? null,
    gridEntropy: c.gridEntropy ?? null,
    axisShare: c.axisShare ?? null,
    places: c.places ?? null,
    sky, hell,
    poolMax: w.crowd.poolSize ?? null,
  };
});

const checks = [];
const add = (id, pass, detail) => checks.push({ id, pass, detail });

add('12-A 人口规模 ≥4000', (r.live || 0) >= 4000, { live: r.live });
add('12-A 分布熵 ≥3.2', (r.gridEntropy || 0) >= 3.2, { entropy: r.gridEntropy });
add('12-A 中轴占比 ≤35%', r.axisShare !== null && r.axisShare <= 0.35, { axisShare: r.axisShare });
add('12-B 行为种类 ≥12', r.actionKinds >= 12, { kinds: r.actionKinds });
add('12-C 场所覆盖', !!r.places && r.places.wards > 0 && r.places.temples > 0 && r.places.palace > 0, r.places);
add('12-D 天宫 ≥300', (r.sky || 0) >= 300, { sky: r.sky });
add('12-D 地府 ≥400', (r.hell || 0) >= 400, { hell: r.hell });
const pass = !r.err && checks.every((c) => c.pass);
console.log(JSON.stringify({ ...r, checks, pass }, null, 1));
await b.close();
process.exit(pass ? 0 : 1);
