/**
 * 天宫「尺度标尺」机检：人到底在不在能读出比例的位置。
 *
 * 用户原话：「天宫中的角色就是参照物就是对比」「项目的天宫中也有很多角色！！也可以做参照物！！」
 * ⇒ 不缺人，缺的是「人是否站在能读出比例的地方」以及「人高/柱高到底是多少」。
 *
 * 本探针回答三件事：
 *   ① 天宫层（y > 150）有多少角色，身高分布如何；
 *   ② 他们到凌霄殿中心的距离分布 —— 全挤在角落还是散布在殿前/柱廊；
 *   ③ 与殿身尺度对比的名义比值（人高 1.7m / 殿身高）。
 *
 * 用法：PROBE_URL=http://localhost:4173/ node scripts/probe-heaven-scale.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';
const HEAVEN_Y = 150;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate((heavenY) => {
  const world = window.__qingming.world;
  const crowd = world.crowd;
  const list = (crowd && (crowd.actors || crowd.all || [])) || [];
  const heaven = [];
  for (const a of list) {
    const p = a && (a.pos || a.position);
    if (!p || p.y < heavenY) continue;
    heaven.push({
      x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
      h: typeof a.h === 'number' ? +a.h.toFixed(2) : null,
      code: (a.data && a.data.code) || a.code || '',
    });
  }
  // 凌霄殿中心（预缩放 centers 经两层放大后的实测值，来自上一轮方位核对）
  const HALL = { x: 0, z: 209 };
  const dists = heaven.map((a) => Math.hypot(a.x - HALL.x, a.z - HALL.z)).sort((p, q) => p - q);
  const q = (arr, t) => (arr.length ? +arr[Math.min(arr.length - 1, Math.floor(arr.length * t))].toFixed(1) : null);
  const within = (r) => heaven.filter((a) => Math.hypot(a.x - HALL.x, a.z - HALL.z) <= r).length;

  const heights = heaven.map((a) => a.h).filter((v) => typeof v === 'number').sort((p, q2) => p - q2);

  return {
    heavenActors: heaven.length,
    yRange: heaven.length ? [Math.min(...heaven.map((a) => a.y)), Math.max(...heaven.map((a) => a.y))] : null,
    heightMedian: heights.length ? heights[Math.floor(heights.length / 2)] : null,
    heightSamples: heights.slice(0, 5),
    distToHall: { p10: q(dists, 0.1), p50: q(dists, 0.5), p90: q(dists, 0.9), max: q(dists, 0.999) },
    // 能"读出比例"的取景半径：殿前广场 + 柱廊，取 200m（凌霄殿面阔约 154–240m）
    within200m: within(200),
    within500m: within(500),
    sample: heaven.slice(0, 6),
  };
}, HEAVEN_Y);

console.log(JSON.stringify(out, null, 1));
const ok = out.heavenActors > 0 && out.within200m >= 8;
console.log(ok
  ? `PASS：天宫 ${out.heavenActors} 人，其中 ${out.within200m} 人在凌霄殿 200m 内（可做尺度标尺）`
  : `FAIL：天宫 ${out.heavenActors} 人，但只有 ${out.within200m} 人在 200m 内 —— 人都在角落，读不出尺度`);
await browser.close();
process.exit(ok ? 0 : 1);
