/**
 * 水上有没有人 / 路上有没有房 —— 这类"构件落错地方"的机检。
 *
 * 起因（用户原话）：
 *   「为啥河边商业街的路上还有房子？？」「为什么有人走在水面上？这是桥吗？？
 *     桥不应该高于河面的拱形吗？」
 *
 * 本项目此前的探针只查「河有没有水 / 桥有没有接上 / 房子有没有屋顶」，
 * **从来没有查过「东西是不是放在对的地方」**——这是判据体系的盲区。
 *
 * 判据（2026-11-02 收紧，只加严不放宽）：
 *   A. 没有可站立面的人 = 0：落在水线内、y 在水面 −1.3m…+0.6m 之间的人，
 *      必须能证明脚下有甲板（units.boats[].crew 船员表 + 船体包络 + 甲板高度），
 *      或落在桥带内（桥面几何由 C 单独核）。**y=0 泡在水里的行人也算违规**
 *      ——旧版下限 WY−0.6 会把这类人漏掉。
 *   B. 落在河道足迹内的建筑实例 = 0（允许码头/驳岸/桥体，按 kit 名白名单排除）。
 *   C. 桥面贴合：虹桥带内（|x|≤6、|z|≤BRIDGE_HALF）行人的 y 必须贴合
 *      layout.bridgeDeckY(z)（±0.9m）；同时打印桥心高出水面的米数。
 *
 * 用法：PROBE_URL=http://localhost:4253/ node scripts/probe-water-clash.mjs
 * 退出码 0 = A/B/C 全部为 0。
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || process.env.PREVIEW_URL || 'http://localhost:4173/';
/** 浏览器路径不写死 <HOME> 占位符：按本机实际安装解析，可用 CHROME_PATH 覆盖 */
const CHROME = process.env.CHROME_PATH
  || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const MARGIN = 5; // 「近岸悬空」报告用：河道足迹外扩（米）

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
// 就绪判据：加载页移除 **且** 自动化句柄已挂。Vite 首次预打包依赖时会整页刷新一次，
// 所以进场后要再确认一遍；不确认就 evaluate 会撞上 "Execution context was destroyed"。
const ready = () => page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming,
  { timeout: 240000 },
);
await ready();
await new Promise((r) => setTimeout(r, 2500));
try { await ready(); } catch { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }

const evaluate = async (fn, arg) => {
  for (let i = 0; i < 3; i++) {
    try { return await page.evaluate(fn, arg); } catch (e) {
      if (!/context was destroyed/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      await ready();
    }
  }
  throw new Error('evaluate failed after navigation retries');
};

const out = await evaluate(async (margin) => {
  const THREE = window.__qingming.THREE;
  const world = window.__qingming.world;
  const scene = window.__qingming.scene;
  // 河道口径必须取真源，不能复制常数
  const river = await import('/src/city/river.ts');
  const cZ = river.riverCenterZ, hW = river.riverHalfWidth, WY = river.RIVER_WATER_Y;

  const inRiver = (x, z, pad = 0) => {
    const hw = hW(x);
    if (!Number.isFinite(hw) || hw <= 0) return false;
    return Math.abs(z - cZ(x)) < hw + pad;
  };

  // ---------- A. 行人 ----------
  // actors 必须带 id：判「站在船上」要靠 units.boats[].crew 的船员表做证据，
  // 不能只看 y —— 旧版把船员（甲板高 1.26–1.5）判成"站在水上"，
  // 同时因为下限只到 WY−0.6，把真正泡在水里的行人（y=0）漏掉了。
  const actors = [];
  const pool = world.crowd;
  const list = (pool && (pool.actors || pool.all || [])) || [];
  for (const a of list) {
    const p = a && (a.pos || a.position);
    if (!p) continue;
    actors.push({ id: a.id, x: p.x, y: p.y, z: p.z, sky: !!a.sky });
  }
  // 桥的豁免带：桥面横向半宽 + 桥中心线
  const BRIDGES = [
    { name: '虹桥', x: 0, w: 26 },
    { name: '永寧橋', x: -1680, w: 20 },
    { name: '通濟橋', x: 1620, w: 20 },
    { name: '浮梁', x: -2480, w: 20 },
  ];
  const onBridge = (a) => BRIDGES.some((b) => Math.abs(a.x - b.x) < b.w);

  // 船甲板证据：units.ts 的 9 条船（船员 id + 船体包络 + 甲板高度三条件同时成立才算）
  const boats = (world.units && world.units.boats) || [];
  const boatOf = new Map();
  for (const b of boats) for (const id of b.crew) boatOf.set(id, b);
  const onBoatDeck = (a) => {
    const b = boatOf.get(a.id);
    if (!b) return false;
    const len = (b.set && b.set.parts && b.set.parts.len) || 18;
    const beam = (b.set && b.set.parts && b.set.parts.beam) || 4.6;
    if (Math.abs(a.x - b.x) > len * 0.55 + 0.5) return false;
    if (Math.abs(a.z - b.z) > beam * 0.55 + 0.5) return false;
    return a.y > WY + 0.05 && a.y < WY + 1.3;
  };

  // 水面/水下：y 从水面以下 1.3m 到水面上 0.6m 都算"没有可站立面"。
  // 河道口径用 pad=0（水线本身）：岸上的人在 1.35m 高的纤道外侧，不能算"站在水上"；
  // 旧版 actor 判据外扩 5m，把岸上行人误报成水上人，同时下限只到 WY−0.6 漏掉 y=0 的泡水者。
  // 船上的人由 onBoatDeck 证明甲板存在；桥带内的人由 onBridge 豁免（桥面几何另检）。
  const actorsOnWater = actors.filter(
    (a) => !a.sky && inRiver(a.x, a.z, 0) && a.y > WY - 1.3 && a.y < WY + 0.6 && !onBridge(a) && !onBoatDeck(a),
  );
  const actorsNearWaterNotBridge = actors.filter(
    (a) => !a.sky && inRiver(a.x, a.z, margin) && !onBridge(a) && !onBoatDeck(a) && a.y >= WY + 0.6 && a.y < WY + 6,
  );

  // ---------- C. 桥面贴合：虹桥带内的人必须落在 bridgeDeckY 上 ----------
  // E3 终审（2026-11-04，两轮对抗）：第一轮判「假红」（岸段合法+船客合法）被对抗审核 B
  // 半推翻——船客证据链成立，但岸段摊主经截图取证（artifacts/_e3_vendor_south.png）
  // 嵌在虹桥端实心踏步体里（z 43.2–49.1 台面 1.483），是真穿模缺陷。
  // 根修在 src/city/props.ts buildStalls 的 add() 守卫（桥面足迹内的摊点推到桥端外），
  // 本判据恢复严格口径：只豁免船上人（甲板三证据 onBoatDeck），岸段不再豁免。
  const layout = await import('/src/city/layout.ts');
  const deckY = layout.bridgeDeckY;
  const bridgeRange = layout.BRIDGE_HALF;
  const deckActors = actors.filter((a) => !a.sky && a.y > -5 && a.y < 40 && Math.abs(a.x) <= 6 && Math.abs(a.z) <= bridgeRange && !onBoatDeck(a));
  const offDeck = deckActors.filter((a) => Math.abs(a.y - deckY(a.z)) > 0.9);
  const bridgeCrown = deckY(0);

  // ---------- B. 建筑实例 ----------
  const SUFFIX_OK = /(riverbank|dock|quay|bridge|wharf|towpath|riverends|waterLink|bian_|river)/i;
  const bad = [];
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const nm = o.name || '';
    if (SUFFIX_OK.test(nm)) return;              // 码头/驳岸/桥/水关白名单
    if (!/^(infill|court|ward_all|riverbank|court_)/.test(nm) && !nm.startsWith('city_')) return;
    const arr = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      m.fromArray(arr, i * 16);
      m.decompose(pos, q, sc);
      if (!inRiver(pos.x, pos.z, 0)) continue;
      // 只看"立在水面上"的：底高高于水面 -0.5
      const bottom = pos.y;
      if (bottom < WY - 0.5) continue;
      if (bad.length < 24) bad.push({ mesh: nm, x: +pos.x.toFixed(1), y: +pos.y.toFixed(2), z: +pos.z.toFixed(1) });
      else bad.length;
    }
  });

  return {
    waterY: WY,
    actorTotal: actors.length,
    actorsOnWater: actorsOnWater.length,
    actorOnWaterSample: actorsOnWater.slice(0, 8).map((a) => [Math.round(a.x), +a.y.toFixed(2), Math.round(a.z)]),
    actorsHovering: actorsNearWaterNotBridge.length,
    actorsHoveringSample: actorsNearWaterNotBridge.slice(0, 6).map((a) => [Math.round(a.x), +a.y.toFixed(2), Math.round(a.z)]),
    boatCrewProven: actors.filter((a) => onBoatDeck(a)).length,
    boats: boats.length,
    bridgeCrownAboveWater: +(bridgeCrown - WY).toFixed(2),
    bridgeDeckActors: deckActors.length,
    bridgeDeckOff: offDeck.length,
    bridgeDeckOffSample: offDeck.slice(0, 6).map((a) => [+a.x.toFixed(1), +a.y.toFixed(2), +a.z.toFixed(1)]),
    buildingsInRiver: bad.length,
    buildingSample: bad,
    bridges: BRIDGES,
  };
}, MARGIN);

console.log(JSON.stringify(out, null, 1));
const pass = out.actorsOnWater === 0 && out.buildingsInRiver === 0 && out.bridgeDeckOff === 0;
console.log(`bridge: crown ${out.bridgeCrownAboveWater}m above water, ${out.bridgeDeckActors} pedestrians on deck, ${out.bridgeDeckOff} off-deck`);
console.log(pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
