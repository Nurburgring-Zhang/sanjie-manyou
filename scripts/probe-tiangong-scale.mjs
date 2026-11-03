/**
 * 天宫巨大化验收探针：尺度标尺（人/柱/门/台阶/栏杆/灯/香炉）+ 加密计数（柱/斗栱/台基/瓦垄）。
 *
 *   node scripts/probe-tiangong-scale.mjs [shots]
 *
 * 输出（全部实测，不估算）：
 *   LOAD_MS / TOTAL_TRIS / DRAW_CALLS
 *   凌霄殿世界包围盒（city_* 顶点扫描）
 *   柱列/斗栱/台基/瓦垄统计（由 palace.ts 在 window.__tiangong 上挂的台账直读）
 *   人物台账：天宫层 actor 数、1.7m 人物数、人物高/柱高比
 * 截图：front / colonnade / interior / overhead（4 张，见 shots 参数）
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';

const URL = process.env.TG_URL || 'http://127.0.0.1:4297/';
const OUT = process.env.TG_OUT || 'screenshots';
const WANT_SHOTS = process.argv.includes('shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR', m.text()); });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
const loadMs = Date.now() - t0;
await new Promise((r) => setTimeout(r, 2500));

const out = await page.evaluate(() => {
  const { scene, world, engine } = window.__qingming;
  const tg = window.__tiangong ?? null;

  // ---- 凌霄殿世界包围盒：z 区段 + 高度区段全扫 ----
  const inBox = (x, y, z) => y > 230 && z > 100 && z < 340 && Math.abs(x) < 340;
  const box = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9, n: 0 };
  let total = 0;
  const groups = {};
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.name.startsWith('city_')) return;
    const g = o.geometry;
    const tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
    total += tri;
    const key = o.name.replace(/^city_/, '').replace(/_\d+$/, '');
    groups[key] = (groups[key] || 0) + tri;
    if (!o.name.startsWith('city_')) return;
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!inBox(x, y, z)) continue;
      box.n++;
      if (x < box.minX) box.minX = x; if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y; if (y > box.maxY) box.maxY = y;
      if (z < box.minZ) box.minZ = z; if (z > box.maxZ) box.maxZ = z;
    }
  });

  // ---- 天宫层人物（y>200）----
  const ppl = { total: 0, visible: 0, atDeck: 0, heights: [], scale: [] };
  const deck = tg ? tg.deckY : 235.86;
  for (const a of world.crowd.actors) {
    if (a.pos.y < 200) continue;
    ppl.total++;
    if (a.hidden) continue;
    ppl.visible++;
    if (Math.abs(a.pos.y - deck) < 6) ppl.atDeck++;
    ppl.heights.push(+(1.7 * (a.scale ?? 1)).toFixed(2));
    ppl.scale.push(+(a.scale ?? 1).toFixed(2));
  }

  const info = engine.renderer.info.render;
  return {
    loadMs: null,
    tris: Math.round(total),
    calls: info.calls,
    box: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])),
    groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, Math.round(v)])),
    centers: world.centers ? Object.fromEntries(Object.entries(world.centers).map(([k, v]) => [k, [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)]])) : null,
    tg,
    ppl,
    poi: window.__qingming.world.constructor ? null : null,
  };
});
out.loadMs = loadMs;

console.log('LOAD_MS=' + loadMs);
console.log('TOTAL_TRIS=' + out.tris);
console.log('DRAW_CALLS=' + out.calls);
console.log('LX_BOX=' + JSON.stringify(out.box));
console.log('GROUPS=' + JSON.stringify(out.groups));
console.log('CENTERS=' + JSON.stringify(out.centers));
console.log('TIANGONG=' + JSON.stringify(out.tg));
console.log('PEOPLE=' + JSON.stringify({ total: out.ppl.total, visible: out.ppl.visible, atDeck: out.ppl.atDeck }));
if (out.ppl.heights.length) {
  const hs = out.ppl.heights.slice().sort((a, b) => a - b);
  console.log('PEOPLE_H=' + JSON.stringify({ min: hs[0], median: hs[(hs.length / 2) | 0], max: hs[hs.length - 1] }));
}

// ---- 截图 ----
async function shot(name, pos, look, fov = 50) {
  await page.evaluate(({ pos, look, fov }) => {
    const { engine } = window.__qingming;
    engine.stopCinema();
    engine.setCamMode('fly');
    engine.camera.position.set(pos[0], pos[1], pos[2]);
    engine.camera.fov = fov;
    engine.camera.updateProjectionMatrix();
    engine.lookTarget.set(look[0], look[1], look[2]);
    const dx = look[0] - pos[0], dy = look[1] - pos[1], dz = look[2] - pos[2];
    const d = Math.hypot(dx, dy, dz);
    engine.yaw = Math.atan2(-dx, -dz);
    engine.pitch = Math.asin(dy / d);
    const ui = document.getElementById('ui');
    if (ui) ui.style.display = 'none';
  }, { pos, look, fov });
  await new Promise((r) => setTimeout(r, 1400));
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log('SHOT ' + name);
}

if (WANT_SHOTS) {
  await shot('final-front-facade.png', [260, 340, -80], [0, 300, 210], 55);
  await shot('final-front-people.png', [300, 240, 210], [100, 275, 210], 70);
  await shot('final-colonnade.png', [210, 237.5, 285], [262, 240, 212], 60);
  await shot('final-interior.png', [0, 278, 158], [0, 284, 234], 66);
  await shot('final-overhead.png', [-380, 470, 20], [0, 250, 230], 55);
  await shot('final-props.png', [250, 264, 178], [232, 236, 258], 75);
  await shot('final-props2.png', [300, 250, 300], [225, 236, 225], 75);
}

await browser.close();
