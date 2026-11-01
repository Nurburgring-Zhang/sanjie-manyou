/**
 * 水上行人·渲染态长采样（比 probe-water-clash 更严，不放宽任何既有判据）。
 *
 * probe-water-clash 是快照判据：加载后 2.5s 取一次。用户说「还有人在水面上走」，
 * 快照可能正好错过。这里在**真实运行循环**里每 1.5s 扫一次、连续 30s，并分开记：
 *   A. 正式判据口径（actorsOnWater，桥带 ±26 豁免）——用于对照官方探针；
 *   B. 严格口径：只豁免真实桥面 |x|≤8，且把「水面以上 0.6–8m 悬空」也算进来
 *      （旧判据上限 WY+0.6，站在船篷/浮台上的人会被漏掉）；
 *   C. 城外河湖（terrain.waterAt）：y 在水面以上 0.6m 内的人；
 *   D. 每个违规点的来源字段：occ/action/freeze/attach/sky/data/post/path 目标。
 *
 * 用法：PROBE_URL=http://localhost:4275/ node scripts/probe-water-actors.mjs
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH
  || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const SECONDS = Number(process.env.WATER_SECONDS || 30);

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
await new Promise((r) => setTimeout(r, 2500));
try { await ready(); } catch { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }

const out = await page.evaluate(async (seconds) => {
  const { world } = window.__qingming;
  const river = await import('/src/city/river.ts');
  const riverGeom = await import('/src/city/riverGeom.ts');
  const terrain = await import('/src/world/terrain.ts');
  const beh = await import('/src/actors/behaviors.ts');
  const layout = await import('/src/city/layout.ts');
  const cZ = river.riverCenterZ, hW = river.riverHalfWidth, WY = river.RIVER_WATER_Y;
  const inRiver = (x, z, pad = 0) => {
    const hw = hW(x);
    if (!Number.isFinite(hw) || hw <= 0) return false;
    return Math.abs(z - cZ(x)) < hw + pad;
  };
  const onRealBridge = (x, z) => Math.abs(x) <= 8 && Math.abs(z) <= layout.BRIDGE_HALF;

  const boats = (world.units && world.units.boats) || [];
  const boatOf = new Map();
  for (const b of boats) for (const id of b.crew) boatOf.set(id, b);
  const onBoatDeck = (a) => {
    const b = boatOf.get(a.id);
    if (!b) return false;
    const len = (b.set && b.set.parts && b.set.parts.len) || 18;
    const beam = (b.set && b.set.parts && b.set.parts.beam) || 4.6;
    if (Math.abs(a.pos.x - b.x) > len * 0.55 + 0.5) return false;
    if (Math.abs(a.pos.z - b.z) > beam * 0.55 + 0.5) return false;
    return a.pos.y > WY + 0.05 && a.pos.y < WY + 1.6;
  };

  const seen = new Map();
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    await new Promise((r) => requestAnimationFrame(() => r(0)));
    const actors = world.crowd.actors;
    let official = 0, strict = 0, floating = 0, terrainWater = 0, terrainWaterStatic = 0;
    for (const a of actors) {
      const p = a.pos;
      const inR = inRiver(p.x, p.z, 0);
      const boat = onBoatDeck(a);
      const bridge26 = Math.abs(p.x - 0) < 26;
      // A. 官方口径（虹桥豁免 ±26）
      if (!a.sky && inR && p.y > WY - 1.3 && p.y < WY + 0.6 && !bridge26 && !boat) official++;
      // B. 严格口径：真实桥面豁免；水面以上 0.6–8m 的「悬空/站船篷」也算
      if (!a.sky && inR && !onRealBridge(p.x, p.z) && !boat && p.y > WY - 1.3 && p.y < WY + 8) {
        strict++;
        if (p.y >= WY + 0.6) floating++;
        const key = a.id;
        if (!seen.has(key)) {
          const post = beh.postOf(a);
          seen.set(key, {
            id: a.id, occ: a.occ, action: a.action, doing: a.doing,
            x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
            yaw: +a.yaw.toFixed(2), freeze: !!a.freeze, attach: !!a.attach, sky: !!a.sky,
            data: a.data ? (a.data.code || a.data.name) : null,
            post: post ? post.venue : null,
            pathTarget: a.path.length ? a.path[a.path.length - 1].toArray().map((v) => +v.toFixed(1)) : null,
            pathLen: a.path.length,
          });
        }
      }
      // C. 城外河湖（地形水面）：区分「行走的水上人」与「定桩展示」（湖上水浒英雄）
      if (!a.sky) {
        const wy = terrain.waterAt(p.x, p.z);
        if (wy !== null && p.y > wy - 0.6 && p.y < wy + 3) {
          if (a.freeze) terrainWaterStatic++;
          else {
            terrainWater++;
            if (!seen.has('T' + a.id)) {
              seen.set('T' + a.id, {
                id: a.id, occ: a.occ, action: a.action,
                x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1),
                waterY: wy, freeze: !!a.freeze, attach: !!a.attach,
              });
            }
          }
        }
      }
    }
    samples.push({ official, strict, floating, terrainWater, terrainWaterStatic });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const max = (k) => Math.max(...samples.map((s) => s[k]));
  const sum = (k) => samples.reduce((s, v) => s + v[k], 0);
  // 城外 9km 外的 actor（湖上船工）：打印来源字段，确认是不是真的「无船站在水面」
  const far = world.crowd.actors
    .filter((a) => Math.abs(a.pos.x) > 9000 && Math.abs(a.pos.z) > 3000)
    .slice(0, 20)
    .map((a) => ({
      id: a.id, occ: a.occ, action: a.action, doing: a.doing,
      x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(1),
      freeze: !!a.freeze, attach: !!a.attach, sky: !!a.sky,
      data: a.data ? (a.data.code || a.data.name) : null, pathLen: a.path.length,
      scale: +a.scale.toFixed(2),
    }));
  return {
    seconds, samples: samples.length,
    official: { max: max('official'), sum: sum('official') },
    strict: { max: max('strict'), sum: sum('strict') },
    floating: { max: max('floating'), sum: sum('floating') },
    terrainWater: { max: max('terrainWater'), sum: sum('terrainWater') },
    terrainWaterStatic: { max: max('terrainWaterStatic'), sum: sum('terrainWaterStatic') },
    uniqueViolations: seen.size,
    violations: [...seen.values()].slice(0, 40),
    farActors: far,
    perSample: samples,
  };
}, SECONDS);

console.log(JSON.stringify(out, null, 1));
const pass = out.strict.max === 0 && out.terrainWater.max === 0;
console.log(pass ? 'PASS' : 'FAIL');await browser.close();
process.exit(pass ? 0 : 1);
