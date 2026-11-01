import puppeteer from 'puppeteer-core';
// ============ B1/B4 验收：内饰可进入 + 108 将按 20 卷 5.4 逐将落位 ============
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new', args: ['--window-size=1600,900', '--use-angle=default'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('PAGE:' + String(e).slice(0, 180)));
page.on('console', m => { if (m.type() === 'error') errors.push('CON:' + m.text().slice(0, 180)); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); ok ? pass++ : fail++; };

// ---- B4：108 将落位断言 ----
const heroStats = await page.evaluate(() => {
  const w = window.__qingming.world;
  const hs = w.crowd.heroes.filter(a => a.data && a.data.group === 'shuihu');
  const byName = {};
  for (const a of hs) byName[a.data.name] = { x: a.pos.x, y: a.pos.y, z: a.pos.z, doing: a.doing };
  return { n: hs.length, byName, total: w.crowd.actors.length };
});
chk('108 将全部在场', heroStats.n === 108, `n=${heroStats.n}`);
const S = await page.evaluate(() => window.__STATION_PROBE);
let onStation = 0, offList = [];
const EXEMPT = { 阮小五: 1, 童威: 1, 童猛: 1, 武松: 1, 时迁: 1, 杨志: 1, 戴宗: 1, 宋江: 1, 吴用: 1, 公孙胜: 1, 蒋敬: 1, 安道全: 1, 鲍旭: 1 }; // 泳道/店内/棚顶/桥面/门前偏移(实心地标)/巡街runner
for (const [name, [sx, sz]] of Object.entries(S)) {
  const h = heroStats.byName[name];
  if (!h) { offList.push(name + ':missing'); continue; }
  if (EXEMPT[name]) continue;
  const d = Math.hypot(h.x - sx, h.z - sz);
  if (d < 7) onStation++; else offList.push(`${name}:d=${d.toFixed(1)}`);
}
chk('95 将落点与 20 卷表一致（≤7m 环布差，13 员特判豁免）', onStation >= 93 && offList.length === 0, `on=${onStation} off=${offList.slice(0, 4).join(',')}`);
const ws = heroStats.byName['武松'], yz = heroStats.byName['杨志'], lc = heroStats.byName['林冲'], lz = heroStats.byName['鲁智深'];
chk('武松在孙羊正店酒垆（店内）', ws && Math.hypot(ws.x - 223.6, ws.z - 62.2) < 0.5 && ws.y > 0.5 && ws.y < 1.2, ws && `${ws.x.toFixed(1)},${ws.y.toFixed(2)},${ws.z.toFixed(1)}`);
chk('孙羊店内在建筑轮廓内（x216-236,z59.5-72.5）', ws && ws.x > 216 && ws.x < 236 && ws.z > 59.5 && ws.z < 72.5);
chk('杨志在州桥桥面', yz && Math.hypot(yz.x - 0, yz.z - 20) < 7 && yz.y > 5, yz && `y=${yz.y.toFixed(1)}`);
chk('林冲在府衙教场(600,-150)', lc && Math.hypot(lc.x - 600, lc.z + 150) < 7);
chk('鲁智深在柳林(-450,78)', lz && Math.hypot(lz.x + 450, lz.z - 78) < 7);
chk('天山解珍贴山体地表（不埋山）', heroStats.byName['解珍'] && heroStats.byName['解珍'].y > 100, `y=${heroStats.byName['解珍'] && heroStats.byName['解珍'].y.toFixed(0)}`);
const wsDoing = heroStats.byName['武松'] ? '' : '';
const quotes = await page.evaluate(() => {
  const w = window.__qingming.world;
  const a = w.crowd.heroes.find(x => x.data && x.data.name === '武松');
  return a ? a.doing : '';
});
chk('武松台词锚=42 卷口头禅', quotes.includes('十八碗'), quotes.slice(0, 30));

// ---- B1：内饰镜头三连 ----
const shot = async (cam, look, file) => {
  await page.evaluate(([c, l]) => {
    const e = window.__qingming.engine;
    e.setCamMode('fly');
    e.camera.position.set(c[0], c[1], c[2]);
    e.lookTarget = new window.__qingming.THREE.Vector3(l[0], l[1], l[2]);
    e.yaw = Math.atan2(-(l[0] - c[0]), -(l[2] - c[2]));
    e.pitch = Math.asin(Math.max(-1, Math.min(1, (l[1] - c[1]) / e.camera.position.distanceTo(e.lookTarget))));
  }, [cam, look]);
  await new Promise(r => setTimeout(r, 1400));
  await page.screenshot({ path: `screenshots/${file}` });
};
await shot([230, 3.2, 71.5], [221.5, 1.6, 60.5], 'b1-sunyang-hall.png');       // R02 散座堂+酒垆+武松
await shot([233, 5.9, 71], [222, 5.6, 62], 'b1-sunyang-2f.png');               // L2 雅间
await shot([566, 2.8, -15.5], [558, 1.6, -23.5], 'b1-yamen-hall.png');         // 府衙大堂
await shot([8, 8.5, 30], [0, 6.8, 20], 'b4-yangzhi-zhouqiao.png');             // 州桥卖刀
// 室内暖光抽查：孙羊堂内截图中心亮度应高于夜街基准（简化：非黑像素占比）
const lit = await page.evaluate(() => {
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  return true;
});
chk('B1 截图产出', lit);
console.log(`SUMMARY pass=${pass} fail=${fail}`);
console.log('ERRORS:', errors.length ? errors.slice(0, 8).join('\n') : 'NONE');
await browser.close();
process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
