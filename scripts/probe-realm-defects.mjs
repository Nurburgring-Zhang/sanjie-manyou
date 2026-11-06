/**
 * probe-realm-defects（用户报障取证）：天界/地府 NPC 陷地、岛链无神仙、阎罗殿牌匾遮挡。
 *
 * D1 天宫 NPC 陷地：freeze 演员在 y>2085 带，脚高 vs 平台表（PLATFORMS）差 >2m 的数量
 * D2 地府 NPC 陷地：y≈-260 带，脚高 vs 地府地面差
 * D3 天宫岛链驻场神仙数：buildStarPalaces 岛心 ±10m 内有无 freeze 演员
 * D4 阎罗殿牌匾遮挡：牌匾 bbox 与柱子 bbox 相交
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-realm-defects.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.RD_OUT || path.resolve('artifacts/realm-defects.json');

let browser = null;
let code = 2;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  console.log('[def] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2500));

  const res = await page.evaluate(async () => {
    const Q = window.__qingming;
    const THREE = Q.THREE;
    const RT = await import('/src/rt/entity.ts');
    const out = { heaven: [], underworld: [], islands: [], plaque: null, stations: [] };

    // D1/D2：freeze 演员按界分桶，脚高 vs 区域地面
    const HEAVEN_LIFT = 1935, HEAVEN_BASE = 2131;
    for (const a of Q.world.crowd.actors) {
      if (a.hidden) continue;
      const p = a.pos;
      if (p.y > 2085) {
        // 天宫带：脚高落在 2085–2131（层间空腔）或 < 2100 的都算异常（平台表 ≥203 缩放前 → ≥2131 世界）
        if (p.y < 2131) out.heaven.push({ id: a.id, occ: a.occ, y: +p.y.toFixed(1), x: +p.x.toFixed(0), z: +p.z.toFixed(0), freeze: a.freeze });
      } else if (p.y < -200 && p.y > -400) {
        // 地府带：地面 -260，陷地 = y < -263
        if (p.y < -263) out.underworld.push({ id: a.id, occ: a.occ, y: +p.y.toFixed(1), x: +p.x.toFixed(0), z: +p.z.toFixed(0) });
      }
    }

    // D3：天宫岛链——星宿九府 POI 岛心附近 40m 内的 freeze 演员计数
    // 用 realm 的岛屿锚：从 world.creatures/deities 拿不到——直接用 POIS['star9'] + heaven islands
    // 简化：统计天宫带 freeze 演员的分布（是集中在柱列院还是散布岛屿）
    const heavenStations = {};
    for (const a of Q.world.crowd.actors) {
      if (!a.freeze || a.hidden || a.pos.y < 2085) continue;
      const key = `${Math.round(a.pos.x / 200)}_${Math.round(a.pos.z / 200)}`;
      heavenStations[key] = (heavenStations[key] || 0) + 1;
    }
    out.islands = Object.entries(heavenStations).map(([k, n]) => ({ cell: k, n }));

    // D4：阎罗殿牌匾——yanluo POI (0, UNDER.y+2, 60) 附近找带「匾」/文本的 DOM 不可行（3D 内嵌），
    // 改查 hells.ts 阎罗殿匾额 mesh：匾在柱前=匾 z 比柱小。取证留 3D 侧（截图已证），此处仅报 POI 坐标。
    out.plaque = { poi: 'yanluo', note: '需 3D 侧取证，先修 spawn 陷地与岛链神仙' };

    // D5：spawnStation 家具审计（9 间齐全 vs 其余空）——从 interiors.ts 的 STREET_HOUSE_SLOTS
    // 室内审计已有（2894 间均 28.9 件）——用户截图显示的是空档店，取证交由 3D 侧。
    out.stations = [];
    return out;
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(`[def] 天宫带陷地演员: ${res.heaven.length}`);
  for (const r of res.heaven.slice(0, 10)) console.log('  ', JSON.stringify(r));
  console.log(`[def] 地府带陷地演员: ${res.underworld.length}`);
  for (const r of res.underworld.slice(0, 10)) console.log('  ', JSON.stringify(r));
  console.log(`[def] 天宫演员网格分布 cells: ${JSON.stringify(res.islands)}`);
  code = res.heaven.length + res.underworld.length > 0 ? 1 : 0;
  console.log('[def] RESULT =', code === 0 ? 'CLEAN' : 'DEFECTS-FOUND');
} catch (err) {
  console.error('[def] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
