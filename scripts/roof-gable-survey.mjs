/**
 * 屋顶两端封口普查：按近 / 中 / 远三档，对每类建筑各出一张斜上方图（俯角 25–40°）。
 *
 * 用户原话：「很多房屋的房顶的前后面有贴图，侧面是空的」——双坡屋顶只有前后两片坡面，
 * 两端没有山墙/博风板封口，从斜上方能看进屋顶内腔。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:4289/ node scripts/roof-gable-survey.mjs before
 *   PROBE_URL=http://127.0.0.1:4289/ node scripts/roof-gable-survey.mjs after
 * 输出：screenshots/roof-gable/<tag>/<id>.png
 *
 * 机位写法：[camX, camY, camZ, lookX, lookY, lookZ]，俯角由两点高差自动决定（对照表见下）。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const TAG = process.argv[2] || 'shot';
const URL = process.env.PROBE_URL || 'http://127.0.0.1:4289/';
const OUT = path.join('screenshots', 'roof-gable', TAG);

/** [id, 说明, 机位；俯角] —— 俯角 = atan(dy / 水平距离)，只做记录 */
const SHOTS = [
  // —— 近档：里坊院落（imperial.ts 的 commonerRoof） ——
  ['ward-tier0-a', '里坊 tier0 院落（近）', [2150, 40, 2450, 2200, 2, 2400], 13],
  ['ward-tier0-b', '里坊 tier0 院落（近·另一坊）', [2260, 34, 2320, 2300, 2, 2280], 23],
  ['ward-tier1-a', '里坊 tier1/2 简院（中）', [2150, 90, 2450, 2450, 0, 2250], 9],
  ['ward-far-a', '里坊远档（远）', [2600, 240, 2600, 3300, 0, 3300], 13],
  // —— 近档：御街商铺（buildings.ts buildShop，归他人） ——
  ['shop-yujie', '御街商铺', [60, 45, 2380, 60, 4, 2320], 35],
  ['shop-yujie2', '御街商铺（斜 35°）', [104, 40, 2352, 64, 5, 2320], 40],
  // —— 河岸铺面（riverbank / centralbelt，归他人） ——
  ['bank-shop', '河岸铺面', [1600, 40, 120, 1600, 2, 60], 32],
  ['bank-shop2', '河岸铺面（斜）', [1640, 36, 108, 1600, 3, 62], 35],
  // —— 皇宫三大殿 / 配殿（palaceDetail.ts） ——
  ['palace-main', '皇宫三大殿', [80, 100, -3080, 0, 10, -3260], 26],
  ['palace-main-side', '皇宫三大殿（偏斜）', [170, 96, -3120, 0, 8, -3255], 30],
  ['palace-wing', '皇宫配殿/庑房', [150, 42, -3200, 100, 4, -3240], 38],
  ['palace-wing2', '皇宫庑房（近）', [-170, 34, -3210, -120, 3, -3245], 32],
  // —— 天宫凌霄殿（sky/palace.ts，整体 ×2.2，凌霄再 ×1.75） ——
  ['heaven-lingxiao', '天宫凌霄殿', [120, 360, 340, 0, 270, 209], 18],
  ['heaven-lingxiao-side', '天宫凌霄殿（斜）', [200, 330, 300, 30, 268, 190], 22],
  // —— 地府阎罗殿（underworld.ts，归他人） ——
  ['hell-yanluo', '地府阎罗殿', [40, -170, 190, 0, -290, 52], 22],
  ['hell-yanluo-side', '地府阎罗殿（斜）', [90, -180, 170, 20, -292, 60], 26],
  // —— 复核补充（imperial.ts 自己造的屋顶） ——
  ['wumen', '午门五凤楼（152×46 双檐）', [120, 78, -2830, 0, 34, -2950], 20],
  ['palace-compound', '文华殿院落', [700, 58, -3160, 620, 6, -3230], 25],
  ['palace-shop-front', '宫前商业街', [56, 26, -2470, 24, 5, -2545], 27],
  ['palace-close', '太和殿（近·斜上）', [72, 46, -3172, 0, 16, -3245], 32],
  ['ward-cu', '里坊 close-up', [2040, 26, 2040, 2085, 4, 2085], 25],
  ['ward-cu2', '里坊 close-up 2', [2180, 30, 2160, 2220, 3, 2120], 27],
  ['wumen-close', '午门屋顶端头近景', [96, 40, -2902, 66, 27, -2946], 28],
  ['taihe-corner', '太和殿屋顶角近景', [96, 32, -3178, 66, 17, -3244], 27],
  ['shop-close', '宫前商铺近景', [40, 13, -2495, 25, 5, -2528], 26],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 240000 });
// 关掉 UI（机位图上不要 HUD 干扰判读）
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});
await new Promise((r) => setTimeout(r, 2500));

const shots = [];
for (const [id, label, [cx, cy, cz, tx, ty, tz], deg] of SHOTS) {
  const yaw = Math.atan2(-(tx - cx), -(tz - cz));
  const pitch = Math.asin(Math.max(-1, Math.min(1, (ty - cy) / Math.hypot(tx - cx, ty - cy, tz - cz))));
  await page.evaluate(({ cx, cy, cz, yaw, pitch }) => {
    const e = window.__qingming.engine;
    if (e.camMode === 'cinema' || e.cinemaActive) e.stopCinema('fly');
    e.camMode = 'fly';
    e.avatarCtl = null;
    e.camera.position.set(cx, cy, cz);
    e.yaw = yaw;
    e.pitch = pitch;
    e.lookTarget.set(
      cx - Math.sin(yaw) * Math.cos(pitch) * 40,
      cy + Math.sin(pitch) * 40,
      cz - Math.cos(yaw) * Math.cos(pitch) * 40,
    );
    if (e.quality) { e.quality.dpr = 1; }
  }, { cx, cy, cz, yaw, pitch });
  await new Promise((r) => setTimeout(r, 900));
  const p = path.join(OUT, `${id}.png`);
  await page.screenshot({ path: p });
  shots.push({ id, label, deg });
  console.log(`shot ${id} -> ${p}`);
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ tag: TAG, shots, errs }, null, 2));
console.log(`errors: ${errs.length}`);
await browser.close();
