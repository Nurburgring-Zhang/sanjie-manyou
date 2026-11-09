/**
 * R24 五项用户反馈的画面级验收：
 *  ① 午门殿内「上下两片灰板 + 一条缝」→ 真门道隧道 + 殿内木构
 *  ② 「为什么还有一片巨型屋顶」→ 高空俯瞰屋顶面 / 城市布局
 *  ③ 「整个城市全是方块、绿地也全是方块」→ R24b 任意不规则自由轮廓草斑
 *     （用户追问「不规则圆草斑？？？就他妈不能是随机的任意不规则的形状吗？？？」：
 *      圆盘/矩形都不能要，改成非等分角度 + 多频半径 + 连续深凹 + 尖尾枝杈的自由轮廓）
 *  ④ 「天宫只有凌霄宝殿周边有植被」→ 三环 76 座岛全部补花木
 *  ⑤ 「三山五岳太小 / 天宫高度升高一倍」→ h/r ×2、HEAVEN_LIFT ×2
 *
 * 用法：node scripts/r24_acceptance.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000, timeout: 180000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 3000));

const setCam = (c) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(c[3], c[4], c[5]);
  const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
};

const heavenY = await page.evaluate(() => {
  const a = window.__skyIslands;
  return a && a.length ? a[0].worldY : 4088;
});

const CAMS = [
  { id: '01-wumen-tunnel', label: '午门城台内部（原「两片灰板」机位）', cam: [0, 5.2, -2952, 0, 5.0, -3100] },
  { id: '02-wumen-south', label: '午门南侧 · 三门洞与敞开朱扉', cam: [0, 5.2, -2890, 0, 5.0, -2950] },
  { id: '03-hall-frame', label: '五凤楼殿内 · 金柱列 / 梁架 / 藻井', cam: [0, 17.4, -2938, 0, 17.0, -2962] },
  { id: '04-city-topdown', label: '全城正俯瞰 · 绿地是否还是方格', cam: [0, 2600, 200, 0, 0, 0] },
  { id: '05-city-oblique', label: '全城斜俯瞰 · 巨型屋顶面与街坊', cam: [0, 1500, 4200, 0, 0, -3200] },
  { id: '06-green-close', label: '坊间近景 · 有机草斑与真草叶', cam: [330, 2.2, 195, 345, 1.4, 225] },
  { id: '07-heaven-overview', label: '天宫全岛俯瞰 · 三环殿阁周边花木', cam: [0, heavenY + 1350, 2400, 0, heavenY, 0] },
  { id: '08-heaven-ring', label: '天宫外环近景 · 岛面仙花仙草', cam: [heavenY * 0.16, heavenY + 260, 900, 0, heavenY, 0] },
  // 旧机位 (14000,1800,-6000) 正好落在放大后的泰山中心，拍到的是贴脸岩柱，证据无效；
  // 拉到山南 15km、高 4800 看全山，再补一张南坡植被特写。
  { id: '09-mountain-scale', label: '放大后的泰山全景 · 长宽高 ×2', cam: [14000, 4800, 9000, 14000, 1500, -6000] },
  // R24b 专项：中距俯瞰，用来裁决草斑「是不是还是圆/方」
  { id: '10-green-shape', label: '坊间草斑轮廓 · 中距俯瞰（自由形状 vs 圆盘/方格）', cam: [345, 120, 225, 345, 0, 225] },
  { id: '11-palace-green-shape', label: '宫苑绿毯轮廓 · 中距俯瞰（不再是一格格圆盘）', cam: [0, 320, -3500, 0, 0, -3500] },
  { id: '12-mountain-slope', label: '山体南坡 · 树 / 草 / 花 / 风景建筑', cam: [14000, 2600, 2600, 14000, 1400, -5200] },
];

const report = {
  at: new Date().toISOString(), url: URL, heavenY,
  shots: [], pageErrors: errs,
};
for (const c of CAMS) {
  await page.evaluate(setCam, c.cam);
  await new Promise((r) => setTimeout(r, 1600));
  const file = path.join(OUT, 'r24-' + c.id + '.png');
  await page.screenshot({ path: file });
  report.shots.push({ id: c.id, label: c.label, cam: c.cam, file });
  console.log('shot', c.id, '->', file);
}

report.runtime = await page.evaluate(() => {
  const q = window.__qingming;
  const detail = q.world.assetAudit?.detail ?? {};
  const sum = (re) => Object.entries(detail)
    .filter(([k]) => re.test(k)).reduce((a, [, v]) => a + (typeof v === 'number' ? v : 0), 0);
  const isles = window.__skyIslands || [];
  return {
    bundle: [...document.querySelectorAll('script[type="module"]')].map((s) => s.src.split('/').pop()),
    errors: window.__errs || [],
    kits: {
      wumenPassage: sum(/^palace\.gate\.wumen\.passage$/),
      wumenFrame: sum(/^palace\.gate\.wumen\.frame$/),
      freeBlob: sum(/^park\.r24\.freeBlob$/),
      spotBlob: sum(/^park\.r24\.spotBlob$/),
      palaceFreeBlob: sum(/^palace\.greenCarpet\.freeBlob$/),
      organicDisc: sum(/^park\.r24\.organicDisc$/), // 旧「圆盘」实现，R24b 后应恒为 0
      islandGarden: sum(/^sky\.islandGarden$/),
      palaceGreenCells: sum(/^palace\.greenCarpet\.cell$/),
      ecoPlaced: sum(/^eco\./),
      mountainTrees: sum(/^mtn\./),
    },
    heavenIslands: isles.length,
    heavenWorldY: isles.length ? { min: Math.min(...isles.map((i) => i.worldY)), max: Math.max(...isles.map((i) => i.worldY)) } : null,
    render: q.engine.renderer ? {
      calls: q.engine.renderer.info.render.calls,
      triangles: q.engine.renderer.info.render.triangles,
    } : null,
  };
});

// 城台内部射线复查：向上/向下不应再撞 y=7.75 / 4.45 的横贯石带
report.tunnelRays = await page.evaluate(() => {
  const q = window.__qingming, THREE = q.THREE;
  const at = new THREE.Vector3(0, 5.2, -2952);
  const out = {};
  for (const [k, d] of Object.entries({ up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1] })) {
    const ray = new THREE.Raycaster(at, new THREE.Vector3(...d).normalize(), 0, 400);
    out[k] = ray.intersectObjects(q.scene.children, true)
      .filter((h) => h.object.isMesh && h.object.visible).slice(0, 3)
      .map((h) => ({ name: h.object.name || '(unnamed)', y: +h.point.y.toFixed(2), dist: +h.distance.toFixed(2) }));
  }
  return out;
});

fs.writeFileSync(path.join(OUT, 'r24-runtime.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.runtime, null, 1));
console.log('tunnel rays', JSON.stringify(report.tunnelRays));
await browser.close();
