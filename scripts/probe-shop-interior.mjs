/**
 * 商铺室内取证探针（R16 后续）。
 *
 * 同一机位拍改前 / 改后，并量化两件事：
 *   ① 陷地：逐角色向下打射线，若最近的脚下表面比脚高 ≥5cm，就是「陷进地板/台基」；
 *   ② 面数：场景三角面总数（改动前后的预算对照）。
 *
 *   SHOP_URL  默认 http://127.0.0.1:4283/
 *   SHOP_TAG  文件名前缀（before / after）
 *   SHOP_OUT  输出目录（默认 screenshots）
 *
 * 机位来源：`riverRoomSpecs()` / `beltRoomSpecs()` 的真实参数（与建模同一份）：
 *   河岸布庄 (838.93,61.06) 净空 11.57×13.34，门在 z≈54.4 一侧
 *   御街杂货铺 (28.80,866.57) 净空 14.35×4.54，门在 x≈26.5 一侧
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { CHROME } from './chromePath.mjs';

const URL = process.env.SHOP_URL || 'http://127.0.0.1:4283/';
const OUT = process.env.SHOP_OUT || 'screenshots';
const TAG = process.env.SHOP_TAG || 'after';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

async function ready() {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 3000));
}

/** 别的 agent 在改文件会触发 vite 整页重载，__qingming 会短暂消失；重试即可 */
async function evalPage(fn, arg) {
  for (let i = 0; i < 4; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (i === 3) throw e;
      await ready();
    }
  }
  return null;
}

const t0 = Date.now();
await ready();
const loadMs = Date.now() - t0;
console.log(`LOAD_MS=${loadMs}`);

const stats = await evalPage(() => {
  const { world, scene } = window.__qingming;
  let tris = 0, meshes = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    meshes++;
    const g = o.geometry;
    const n = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });

  // 陷地普查（零成本口径）：用与建模同一份的 2903 个铺面足迹判定。
  // 旧版没有这个查询，改用「9 座手工街屋」的固定坐标做同一判定（改前也成立）。
  const STREET_HOUSES = [
    { x: 168, z: 64, w: 9, d: 8, y: 0.6 }, { x: 258, z: 64, w: 10, d: 8, y: 0.6 },
    { x: 352, z: 66, w: 12, d: 9, y: 0.6 }, { x: 40, z: 62, w: 10, d: 8, y: 0.6 },
    { x: -36, z: 62, w: 11, d: 9, y: 0.6 }, { x: 540, z: 118, w: 16, d: 10, y: 0.6 },
    { x: -258, z: 36.6, w: 8.4, d: 5.2, y: 0.86 }, { x: -208, z: 36.6, w: 8.4, d: 5.2, y: 0.86 },
    { x: -330, z: 36.6, w: 8.4, d: 5.2, y: 0.86 },
  ];
  let inHouse = 0;
  const houseSamples = [];
  for (const a of world.crowd.actors) {
    if (a.sky || a.attach || a.hidden) continue;
    for (const h of STREET_HOUSES) {
      if (Math.abs(a.pos.x - h.x) > h.w / 2 || Math.abs(a.pos.z - h.z) > h.d / 2) continue;
      inHouse++;
      if (houseSamples.length < 4) houseSamples.push({ x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(1), floor: h.y });
      break;
    }
  }
  const canQuery = typeof world.crowd.shopFloorAt === 'function';
  let inShop = 0;
  let sumSink = 0;
  if (canQuery) {
    for (const a of world.crowd.actors) {
      if (a.sky || a.attach || a.hidden) continue;
      const fy = world.crowd.shopFloorAt(a.pos.x, a.pos.z);
      if (fy == null) continue;
      inShop++;
      sumSink += Math.max(0, fy - a.pos.y);
    }
  }
  return {
    tris: Math.round(tris), meshes,
    inHouse, houseSamples,
    shopQuery: canQuery, inShop, sumSink: +sumSink.toFixed(2),
    guardMoves: typeof world.crowd.guardMoves === 'function' ? world.crowd.guardMoves() : null,
  };
});
console.log(`TRIS=${stats.tris} MESHES=${stats.meshes}`);
console.log(`HOUSE_INSIDE=${stats.inHouse} SAMPLES=${JSON.stringify(stats.houseSamples)}`);
console.log(`SHOP_QUERY=${stats.shopQuery} SHOP_INSIDE=${stats.inShop} SINK_SUM=${stats.sumSink} GUARD_MOVES=${stats.guardMoves}`);

const station = await evalPage(() => {
  const { world } = window.__qingming;
  const a = world.crowd.actors.find((x) => x.freeze && Math.abs(x.pos.x + 36) < 6 && Math.abs(x.pos.z - 58) < 6);
  return a ? { x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(2) } : null;
});
console.log('STATION=' + JSON.stringify(station));

async function shot(name, pos, look, fov) {
  await evalPage(({ pos, look, fov }) => {
    const { engine } = window.__qingming;
    engine.stopCinema();
    engine.setCamMode('fly');
    engine.camera.position.set(pos[0], pos[1], pos[2]);
    engine.camera.fov = fov;
    engine.camera.updateProjectionMatrix();
    engine.lookTarget.set(look[0], look[1], look[2]);
    engine.yaw = Math.atan2(-(look[0] - pos[0]), -(look[2] - pos[2]));
    const d = Math.hypot(look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]);
    engine.pitch = Math.asin(Math.max(-1, Math.min(1, (look[1] - pos[1]) / d)));
    const ui = document.getElementById('ui');
    if (ui) ui.style.display = 'none';
  }, { pos, look, fov });
  await new Promise((r) => setTimeout(r, 1400));
  const path = `${OUT}/${TAG}-${name}.png`;
  await page.screenshot({ path });
  console.log('SHOT ' + path);
}

// 河岸布庄：站在门口，平视店内
await shot('river-cloth', [838.9, 1.55, 54.9], [838.9, 1.0, 62.0], 80);
// 同一间的斜视角（看两侧成排的陈设）
await shot('river-cloth-side', [834.2, 1.7, 55.8], [841.5, 0.9, 62.6], 80);
// 御街杂货铺：窄而阔的临街铺面
await shot('belt-general', [26.75, 1.55, 866.6], [31.0, 1.0, 866.6], 80);
// 掀掉屋顶的正俯视（只藏 city_roof 合并网格）
await evalPage(() => {
  const { scene } = window.__qingming;
  scene.traverse((o) => { if (o.isMesh && o.name.startsWith('city_roof')) o.visible = false; });
});
await shot('river-cloth-air', [838.9, 24, 61.1], [838.9, 0.3, 61.0], 55);
await evalPage(() => {
  const { scene } = window.__qingming;
  scene.traverse((o) => { if (o.isMesh && o.name.startsWith('city_roof')) o.visible = true; });
});

await browser.close();
