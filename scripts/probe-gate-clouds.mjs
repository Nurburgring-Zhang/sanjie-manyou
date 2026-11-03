/**
 * 环形仙门「8 团云托」机检（缺陷：cloud-pad cyl 参数整体错位，被 Baker 越界守卫整批拒收）。
 *
 * 背景
 *   `hRoundGate` 的 8 个云托原先按 9 个实参调用 `b.cyl`，缺了第 5 位 `seg`：
 *     seg ← 世界坐标 cx+cos(a)*34、x ← footY、y ← z、z ← 颜色(≈1.4e7)
 *   → Baker 的 `|z| > 30000` 守卫把这一批全部 `rejected++`，它们从未进入几何。
 *
 * 判据（全部从渲染场景实测，不读源码常量）
 *   A. Baker 拒收：本次 `hRoundGate` / `hCloudGate` 调用期间新增拒收数必须为 0
 *      （钩子 `window.__skyGateBuild`，与 `__skyIslands` 同一套诊断口径）。
 *   B. 存在性：以环台基世界锚点为心，把 `city_fabric` 网格在「半径 30–130、y ∈ 锚点+5…+20」
 *      带内的顶点按 **8 个 45° 扇区** 归堆（扇区中线与 `a = i/8·2π + 0.4` 对齐）。
 *      每个扇区都必须有 ≥120 个顶点（一根 16 段双端盖圆柱 = 192 个未索引顶点）。
 *      任一团缺失 → 该扇区为 0，直接 BLOCK。
 *   C. 位置：每个扇区的顶点半径都必须落在 [40, 120]（环台基外缘 68m 之外的一圈），
 *      扇区质心半径 ∈ [60, 95]；高度必须整体高于云海切分带上沿（世界 y > 锚点 + 6），
 *      否则说明它们又被 `buildCloudSeaView` 切进不缩放的 `cloudSea`、脱离了放大后的台基。
 *   D. 取景：8 个扇区质心投影到本机位必须在画面内（NDC |x|,|y| ≤ 0.95）。
 *
 * 退出码：0 = PASS，1 = BLOCK。用法：
 *   node scripts/probe-gate-clouds.mjs
 *   PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-gate-clouds.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const SECTORS = 8;
const SECTOR_MIN_VERTS = 120;   // 一根 16 段圆柱 = 192 未索引顶点；取 120 留出扇区边界切分的余量
const R_MIN = 40, R_MAX = 120;   // 顶点半径带（世界米）：台基外缘 68m 之外
const C_MEAN_MIN = 60, C_MEAN_MAX = 95;
const Y_ABOVE_MIN = 6;           // 必须高于锚点 6m —— 云海切分带上沿以下会被切走且不缩放

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 240000,
  args: ['--window-size=1400,800', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 800 });

// Vite HMR 会在任意源码改动时整页重载（并行 agent 也在改别的文件）：只等到一次
// `__qingming` 不够，evaluate 时可能已经回到加载态。每次取样前重新等，失败整轮重试。
const ready = () => page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__skyGateBuild,
  { timeout: 240000 },
);

let data = null;
for (let attempt = 1; attempt <= 3 && !data; attempt++) {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 240000 }).catch(() => {});
  await ready();
  await new Promise((r) => setTimeout(r, 1800));
  await ready();
  data = await page.evaluate((cfg) => {
    const { sectors, rMin, rMax, yAboveMin } = cfg;
    const g = window.__skyGateBuild;
    const scene = window.__qingming.engine.scene;
    const cx = g.round.wx, cz = g.round.wz, wy = g.round.wy;

    // ---- 只统计 city_fabric（云托所在材质组）。合批后可能拆成 city_fabric / city_fabric_1… ----
    const meshes = [];
    scene.traverse((o) => {
      if (o.isMesh && /^city_fabric(_\d+)?$/.test(o.name)) meshes.push(o);
    });

    const bins = Array.from({ length: sectors }, () => ({
      n: 0, x: 0, y: 0, z: 0, rSum: 0, rMin: Infinity, rMax: 0, yMin: Infinity, yMax: -Infinity,
    }));
    const step = (Math.PI * 2) / sectors;
    let scanned = 0, picked = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      if (!p) continue;
      scanned += p.count;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y < wy + yAboveMin || y > wy + 22) continue;
        const dx = x - cx, dz = z - cz;
        const r = Math.hypot(dx, dz);
        if (r < rMin || r > rMax) continue;
        // 扇区按 a = i/8·2π + 0.4 归堆：先减相位再按 2π/8 分箱
        const ang = Math.atan2(dz, dx) - 0.4;
        let k = Math.floor(((ang % (Math.PI * 2)) + Math.PI * 2) / step) % sectors;
        const b = bins[k];
        b.n++; b.x += x; b.y += y; b.z += z; b.rSum += r;
        if (r < b.rMin) b.rMin = r;
        if (r > b.rMax) b.rMax = r;
        if (y < b.yMin) b.yMin = y;
        if (y > b.yMax) b.yMax = y;
        picked++;
      }
    }

    // ---- 机位：环台基侧方 210m、抬 40m 俯看，8 团应全部在画面内 ----
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(cx + 210, wy + 40, cz);
    e.lookTarget.set(cx, wy + 11, cz);
    const vx = cx - e.camera.position.x, vy = wy + 11 - e.camera.position.y, vz = cz - e.camera.position.z;
    const vd = Math.max(1, Math.hypot(vx, vy, vz));
    e.yaw = Math.atan2(-vx, -vz);
    e.pitch = Math.asin(vy / vd);
    e.camera.updateMatrixWorld();
    const V3 = e.camera.position.constructor;

    const rows = bins.map((b, i) => {
      const n = Math.max(1, b.n);
      const cxg = b.x / n, cyg = b.y / n, czg = b.z / n;
      const v = new V3(cxg, cyg, czg).project(e.camera);
      return {
        sector: i,
        deg: +(i * (360 / sectors) + (0.4 * 180) / Math.PI).toFixed(1),
        n: b.n,
        rMean: +(b.rSum / n).toFixed(1),
        rSpan: b.n ? [+b.rMin.toFixed(1), +b.rMax.toFixed(1)] : null,
        ySpan: b.n ? [+b.yMin.toFixed(1), +b.yMax.toFixed(1)] : null,
        ndc: [+v.x.toFixed(2), +v.y.toFixed(2)],
      };
    });

    // ---- 次检：云海天门那 10 团云脚（同型错位，同一轮修复）。10 个 36° 扇区 ----
    const cfBins = Array.from({ length: 10 }, () => 0);
    let cfPicked = 0;
    const ccx = g.cloud.wx, ccz = g.cloud.wz;
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      if (!p) continue;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y < wy + yAboveMin || y > wy + 22) continue;
        const dx = x - ccx, dz = z - ccz;
        const r = Math.hypot(dx, dz);
        if (r < 25 || r > 210) continue;      // 云脚环 38–54（×2.2 = 84–119），z 向压到 0.55 成扁椭圆
        const ang = Math.atan2(dz, dx) - 0.3;
        const k = Math.floor(((ang % (Math.PI * 2)) + Math.PI * 2) / ((Math.PI * 2) / 10)) % 10;
        cfBins[k]++;
        cfPicked++;
      }
    }

    return {
      gate: g,
      fabricMeshes: meshes.map((m) => m.name),
      scannedVerts: scanned,
      pickedVerts: picked,
      bins: rows,
      cloudFeet: { bins: cfBins, picked: cfPicked },
      camera: { pos: [cx + 210, wy + 40, cz], target: [cx, wy + 11, cz] },
    };
  }, { sectors: SECTORS, rMin: R_MIN, rMax: R_MAX, yAboveMin: Y_ABOVE_MIN });
}

await browser.close();

if (!data) {
  console.log(JSON.stringify({ PASS: false, error: '页面 3 次取样均未就绪（HMR 重载？）' }, null, 1));
  process.exit(1);
}

const wy = data.gate.round.wy;
const aOk = data.gate.round.rejected === 0;
const cOk = data.gate.cloud.rejected === 0;
const perBin = data.bins.map((b) => {
  const exists = b.n >= SECTOR_MIN_VERTS;
  const radiusOk = exists && b.rSpan[0] >= R_MIN && b.rSpan[1] <= R_MAX && b.rMean >= C_MEAN_MIN && b.rMean <= C_MEAN_MAX;
  const heightOk = exists && b.ySpan[0] > wy + Y_ABOVE_MIN;
  const framed = Math.abs(b.ndc[0]) <= 0.95 && Math.abs(b.ndc[1]) <= 0.95;
  return { ...b, exists, radiusOk, heightOk, framed, ok: exists && radiusOk && heightOk && framed };
});
const withPads = perBin.filter((b) => b.exists).length;
const allOk = perBin.every((b) => b.ok);
const feet = data.cloudFeet;
const feetMin = 80;   // 一根 16 段圆柱 192 顶点，36° 扇区切分后留足余量
const feetBinsOk = feet.bins.filter((n) => n >= feetMin).length;
const feetOk = feetBinsOk === 10;
const pass = aOk && cOk && withPads === SECTORS && allOk && feetOk;

console.log(JSON.stringify({
  camera: data.camera,
  fabricMeshes: data.fabricMeshes,
  pickedVerts: data.pickedVerts,
  rejects: { roundGate: data.gate.round.rejected, cloudGate: data.gate.cloud.rejected },
  pads: perBin,
  cloudGateFeet: { bins: feet.bins, sectorsWithPads: feetBinsOk, picked: feet.picked },
  asserts: {
    [`rejects.roundGate === 0`]: aOk,
    [`rejects.cloudGate === 0`]: cOk,
    [`${SECTORS} 个扇区都有 >= ${SECTOR_MIN_VERTS} 顶点`]: withPads === SECTORS,
    [`半径全落 [${R_MIN}, ${R_MAX}]、质心 [${C_MEAN_MIN}, ${C_MEAN_MAX}]`]: perBin.every((b) => b.radiusOk),
    [`顶点高于锚点 ${Y_ABOVE_MIN}m（未被云海切分带吞掉）`]: perBin.every((b) => b.heightOk),
    ['8 团全在机位画面内']: perBin.every((b) => b.framed),
    [`云海天门 10 团云脚每扇区 >= ${feetMin} 顶点`]: feetOk,
  },
  PASS: pass,
}, null, 1));
console.log(pass
  ? `PASS：环台基周围 ${withPads}/8 团云托真实存在，圆心半径 ${perBin.map((b) => b.rMean.toFixed(0)).join('/')}；云海天门 ${feetBinsOk}/10 团云脚`
  : 'BLOCK：云托缺失或位置不对，见上表');
process.exit(pass ? 0 : 1);
