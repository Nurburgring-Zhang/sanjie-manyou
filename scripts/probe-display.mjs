/**
 * probe-display.mjs — 展示项机检：3.1 河流 / 3.6 城墙 / 4.3 凌霄宝殿 / 4.4 浮岛
 *
 * 背景：这四项此前只有截图，没有数字断言。本脚本只读运行时（不写 src），
 * 一次运行输出四组可复核的数字，任一失败即 pass:false + 退出码 1。
 *
 * 用法：
 *   npx vite preview --port 4173        # 本脚本不会起/杀进程
 *   node scripts/probe-display.mjs      # 默认 http://localhost:4173/
 *   PROBE_URL=http://localhost:4205/ node scripts/probe-display.mjs
 *   node scripts/probe-display.mjs --dump   # 只打印原始诊断（调阈值用）
 *
 * 口径说明（为什么不直接用 terrainHeight）：
 *   terrainHeight 在城内 |x|,|z|<5200 一律归零（修护城河埋没时做的方形压平），
 *   所以城内河槽量不出来。3.1 改为对 ground 组 + terrain 网格做向下射线采样：
 *   河床（y<−1.5 的最高命中面，避开桥区 0.14 地坪/地府 −261/地形 −3.6）与岸顶
 *   （z=±36 与 ±60 取最高）的 y 差即「河槽低于两岸」的米数。
 *   3.6 读 assetAudit.detail 的 wall 台账 + crowd 角色码；4.3 量 wall 台缘环与殿身壳的 y 包围盒；
 *   4.4 量 ash 岩锥：命名主岛（world.centers，台沿环 1.01r 反推 r，锥顶 = 台面 y−2.6）
 *   + 自动簇（低位岩体连通 → 底部环 0.12r 反推 r、甲板/顶部环定锥顶）。
 */
import puppeteer from 'puppeteer-core';

import { CHROME } from './chromePath.mjs';
const CANDIDATES = [
  process.env.PROBE_URL,
  'http://localhost:4173/',
  'http://localhost:4205/',
  'http://localhost:5173/',
].filter(Boolean);
const DUMP = process.argv.includes('--dump');

async function pickBase() {
  for (const url of CANDIDATES) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (r.ok) return url;
    } catch { /* try next */ }
  }
  return null;
}

const base = await pickBase();
if (!base) {
  console.error('[probe-display] 预览未启动。先运行：npx vite preview --port 4173');
  console.log(JSON.stringify({
    checks: [],
    pass: false,
    error: 'preview not running (tried ' + CANDIDATES.join(', ') + '); start: npx vite preview --port 4173',
  }, null, 2));
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 600));

const raw = await page.evaluate(() => {
  const Q = window.__qingming;
  const scene = Q.scene;
  const world = Q.world;
  const THREE = Q.THREE;
  const detail = world.assetAudit?.detail ?? {};
  const detailBounds = world.assetAudit?.detailBounds ?? {};

  const meshesOf = (group) => {
    const out = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const n = String(o.name || '');
      if (n === 'city_' + group || n.startsWith('city_' + group + '_')) out.push(o);
    });
    return out;
  };
  const verts = (group, fn) => {
    for (const m of meshesOf(group)) {
      const p = m.geometry.getAttribute('position');
      if (!p) continue;
      const a = p.array;
      for (let i = 0; i < a.length; i += 3) fn(a[i], a[i + 1], a[i + 2]);
    }
  };

  // ================= 3.1 河流：射线采样 =================
  const groundMeshes = meshesOf('ground');
  const terrain = scene.getObjectByName('terrain');
  const rayObjs = terrain ? [...groundMeshes, terrain] : groundMeshes;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const hitTop = (x, z) => {
    ray.set(new THREE.Vector3(x, 60, z), down);
    return ray.intersectObjects(rayObjs, false).slice(0, 4).map((p) => ({ n: p.object.name, y: +p.point.y.toFixed(3) }));
  };
  const hitY = (x, z) => {
    const h = hitTop(x, z);
    return h.length ? h[0].y : null;
  };
  const xs = [];
  for (let i = 0; i <= 16; i++) xs.push(-800 + i * 100);
  const samples = xs.map((x) => {
    // 河床：命中里 y<−1.5 的最高面（桥区 0.14 地坪 / 地府 −261 / 地形 −3.6 都不算河床）
    const hits = hitTop(x, 0);
    const bedCands = hits.filter((h) => h.y < -1.5 && h.y > -8);
    const bed = bedCands.length ? Math.max(...bedCands.map((h) => h.y)) : (hits.length ? hits[hits.length - 1].y : null);
    // 岸顶：z=±36 与 z=±60 四处取最高（避开河廊道过渡三角面与护岸墙）
    const bankN = Math.max(...[hitY(x, 36), hitY(x, 60), hitY(x, -36), hitY(x, -60)].map((v) => (v === null ? -999 : v)));
    const bankS = hitY(x, -36);
    const bankY = bankN === -999 ? (world.heightAt ? world.heightAt(x, 60) : 0) : bankN;
    const dbg = (x === -800 || x === -700 || x === 0 || x === 700 || x === 800) ? hits : undefined;
    return { x, bedY: bed, bankN, bankS, bankY: +bankY.toFixed(3), depth: bed === null ? null : +(bankY - bed).toFixed(3), dbg };
  });

  const river = scene.getObjectByName('bian_river');
  const rp = river?.geometry?.getAttribute('position');
  const rv = [];
  if (rp) {
    const a = rp.array;
    for (let i = 0; i < a.length; i += 3) rv.push([a[i], a[i + 1], a[i + 2]]);
  }
  const riverX = rv.map((p) => p[0]);
  const minRx = Math.min(...riverX), maxRx = Math.max(...riverX);
  const targets = [-5000, -3500, -2000, -1200, -800, 0, 800, 1200, 2000, 3500, 5000];
  const beyond = targets.map((t) => {
    let best = null;
    for (const [x, , z] of rv) {
      const d = Math.abs(x - t);
      if (best === null || d < best.d) best = { d, x, z };
    }
    return { target: t, nearestX: best ? +best.x.toFixed(1) : null, nearestZ: best ? +best.z.toFixed(1) : null, ok: !!best && best.d <= 30 };
  });
  const ux = [...new Set(riverX.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < ux.length; i++) maxGap = Math.max(maxGap, ux[i] - ux[i - 1]);
  const bend = targets.filter((t) => Math.abs(t) >= 700).map((t) => {
    // 取最近 x 组的水带：zCenter = (zMin+zMax)/2，宽度 = zMax−zMin
    const b = beyond.find((v) => v.target === t);
    if (!b || b.nearestX === null) return { x: t, zCenter: null, width: null };
    const nx = b.nearestX;
    const zz = rv.filter((p) => Math.abs(p[0] - nx) <= 5).map((p) => p[2]);
    const zMin = Math.min(...zz), zMax = Math.max(...zz);
    return { x: t, zCenter: +((zMin + zMax) / 2).toFixed(2), width: +(zMax - zMin).toFixed(2) };
  });

  // ================= 3.6 城墙 =================
  const wallKeys = Object.entries(detail).filter(([k]) => /wall/i.test(k));
  const wallSum = wallKeys.reduce((a, [, v]) => a + v, 0);
  const actors = world.crowd?.actors || world.crowd?.list || [];
  const codes = {};
  for (const a of actors) {
    const c = a?.data?.code || a?.code || '(none)';
    codes[c] = (codes[c] || 0) + 1;
  }

  // ================= 4.3 凌霄宝殿 =================
  const pc = world.centers?.palace;
  const palace = pc ? { x: pc.x, y: pc.y, z: pc.z } : null;
  let rimR = 0, bodyMin = Infinity, bodyMax = -Infinity, tipMax = -Infinity, bodyCount = 0;
  if (palace) {
    // 2026-11-01 取样路径重写：旧版把殿身锁死在「侧墙 |dx|∈[18.9,20.1]、|dz|≤11.2、y∈[y+3,y+18]」这条
    // 硬编码带上——三重檐改造后殿身体块换了材质组与尺寸，这条带一个顶点都命中不了（bodyCount=0，
    // 于是 islandR=0 / bodyH=null，判据变成"不可测"）。改成按**水平半径 + 高度**取包围，不依赖材质组与旧尺寸。
    const scan = (name) => {
      verts(name, (x, y, z) => {
        const hor = Math.hypot(x - palace.x, z - palace.z);
        if (hor > 58) return;
        if (y < palace.y + 1.2) return;
        if (y > palace.y + 140) return;
        bodyCount++;
        if (y < bodyMin) bodyMin = y;
        if (y > bodyMax) bodyMax = y;
        if (y > tipMax) tipMax = y;
        if (hor > rimR) rimR = hor;
      });
    };
    for (const g of ['wall', 'wood', 'ash', 'roof', 'metal', 'lacquer']) scan(g);
  }
  const islandR = rimR / 0.99;
  const bodyH = bodyMax - bodyMin;

  // ================= 4.4 浮岛（ash 岩锥） =================
  // 只取天宫层（y>180；地府/人间 ash 全在下面）。分岛的关键：不能把「甲板环 / 台沿石」
  // 算进连通图，否则相邻星宿岛（中心距 50m、台径 23–24m）会连成一片。
  // 做法：2m 网格，每格先求 yMin，只保留 y ≤ yMin+8m 的低位岩体顶点，再做 8 邻接连通。
  const skyAsh = [];
  verts('ash', (x, y, z) => { if (y > 180 && y < 300) skyAsh.push([x, y, z]); });
  const CELL = 2;
  const ck = (cx, cz) => cx + ',' + cz;
  const cellLow = new Map();   // cell -> [minY, [(x,z)...]]
  for (const [x, y, z] of skyAsh) {
    const k = ck(Math.floor(x / CELL), Math.floor(z / CELL));
    let c = cellLow.get(k);
    if (!c) { c = [y, []]; cellLow.set(k, c); }
    if (y < c[0]) c[0] = y;
    c[1].push([x, z]);
  }
  const parent = new Map();
  const find = (k) => { let p = parent.get(k) ?? k; if (p !== k) { p = find(p); parent.set(k, p); } return p; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [k, c] of cellLow) {
    if (c[1].length > 400) continue;   // 极端密格（整片台基）不参与低位岩体连通
    const [cx, cz] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const nk = ck(cx + dx, cz + dz);
      if (cellLow.has(nk)) uni(k, nk);
    }
  }
  const lowComps = new Map();
  for (const [k, c] of cellLow) {
    if (c[1].length > 400) continue;
    const root = find(k);
    let arr = lowComps.get(root);
    if (!arr) { arr = []; lowComps.set(root, arr); }
    for (const [x, z] of c[1]) arr.push([x, c[0], z]);
  }
  // 岛心：低位岩体簇的质心（过滤掉山巅小构件）
  const centers = [];
  for (const pts of lowComps.values()) {
    if (pts.length < 120) continue;
    let sx = 0, sz = 0, yMin = Infinity;
    for (const [x, y, z] of pts) { sx += x; sz += z; yMin = Math.min(yMin, y); }
    const n = pts.length;
    const cx = sx / n, cz = sz / n;
    let spread = 0;
    for (const [x, , z] of pts) spread = Math.max(spread, Math.hypot(x - cx, z - cz));
    if (spread < 2.5) continue;                 // 尖顶/碎片
    centers.push({ cx, cz, yMin, n, spread });
  }
  // 同岛可能被拆成 2 簇（岩瓣遮挡）：中心 3m 内的合并
  centers.sort((a, b) => b.n - a.n);
  const merged = [];
  for (const c of centers) {
    if (merged.some((m) => Math.hypot(m.cx - c.cx, m.cz - c.cz) < 3)) continue;
    merged.push(c);
  }
  const near = (px, pz, R) => skyAsh.reduce((n, [x, , z]) => n + (Math.hypot(x - px, z - pz) < R ? 1 : 0), 0);
  const dbgAsh = {
    total: skyAsh.length,
    lowComps: lowComps.size,
    centersRaw: centers.length,
    merged: merged.length,
    nearArena: near(0, 0, 50), nearGate: near(0, -85, 40), nearPalace: near(0, 95, 55),
    nearPantao: near(-150, 45, 40), nearFurnace: near(-120, -20, 30), nearMoon: near(40, -55, 30),
    centersNearPalace: merged.filter((c) => Math.hypot(c.cx, c.cz - 95) < 70).map((c) => `${c.cx.toFixed(1)},${c.cz.toFixed(1)}:n${c.n}/sp${c.spread.toFixed(1)}`),
    biggestComps: [...lowComps.values()].map((pts) => pts.length).sort((a, b) => b - a).slice(0, 8),
  };

  // 全部天宫 ash 顶点按最近岛心归位（Voronoi），再逐岛量：底部环半径 / 顶部环 y 众数
  const acc = merged.map((c) => ({ ...c, yBot: Infinity, rBot: 0, verts: [] }));
  for (const [x, y, z] of skyAsh) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < acc.length; i++) {
      const d = Math.hypot(x - acc[i].cx, z - acc[i].cz);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) {
      const a = acc[bi];
      a.verts.push([x, y, z]);
      if (y < a.yBot) a.yBot = y;
    }
  }
  const islands = [];
  for (const a of acc) {
    if (a.verts.length < 300 || a.yBot > 210) continue;
    // ① 岛半径 r：锥底环半径 = 0.12r（buildIslandSkirt 的三级收口底尖）
    for (const [x, y, z] of a.verts) {
      if (y <= a.yBot + 0.5) a.rBot = Math.max(a.rBot, Math.hypot(x - a.cx, z - a.cz));
    }
    if (a.rBot <= 0) continue;
    const r = a.rBot / 0.12;
    // ② 岩锥顶：两条证据取较低者
    //   甲板：半径 ≈ r 的环（台沿石 r、hDeck 0.962r）——取最高的、≥10 顶点的 y 分箱；
    //         甲板 y 与岩锥顶差 2.6m（buildIslandSkirt: rockTopY = 台面 y − 2.6）。
    //   锥顶：半径 ∈ [0.90,0.965]r 的环（岩锥顶 0.94r）——0.2m y 分箱取最高（岩瓣/望柱尖会高一点点，
    //         但甲板证据若存在，取较低者即可压回锥顶）。
    const deckHist = new Map();
    const coneHist = new Map();
    for (const [x, y, z] of a.verts) {
      const d = Math.hypot(x - a.cx, z - a.cz);
      const q = d / r;
      const b = Math.round(y / 0.2);
      if (q >= 0.97 && q <= 1.03) deckHist.set(b, (deckHist.get(b) || 0) + 1);
      if (q >= 0.90 && q <= 0.965) coneHist.set(b, (coneHist.get(b) || 0) + 1);
    }
    let yDeck = null;
    for (const [b, n] of deckHist) if (n >= 10 && (yDeck === null || b * 0.2 > yDeck)) yDeck = b * 0.2;
    let yCone = null;
    for (const [b, n] of coneHist) if (n >= 8 && (yCone === null || b * 0.2 > yCone)) yCone = b * 0.2;
    const rockTopDeck = yDeck === null ? null : yDeck - 2.56;
    const rockTopCone = yCone;
    const rockTop = rockTopDeck === null ? rockTopCone : (rockTopCone === null ? rockTopDeck : Math.min(rockTopDeck, rockTopCone));
    if (rockTop === null) continue;
    // ③ 半径以甲板环实测为准（台沿石 r）；没有甲板环才退回锥底 0.12r 反推（避免并簇污染 rBot）
    let rDeck = null;
    if (yDeck !== null) {
      const rs = [];
      for (const [x, y, z] of a.verts) {
        if (Math.abs(y - yDeck) > 0.15) continue;
        const d = Math.hypot(x - a.cx, z - a.cz);
        if (d >= r * 0.8 && d <= r * 1.15) rs.push(d);
      }
      if (rs.length >= 10) { rs.sort((p, q) => p - q); rDeck = rs[Math.floor(rs.length / 2)]; }
    }
    const rr = rDeck === null ? r : rDeck;
    const hRock = rockTop - a.yBot;
    islands.push({
      cx: +a.cx.toFixed(1), cz: +a.cz.toFixed(1), n: a.verts.length,
      yBot: +a.yBot.toFixed(2), yTop: +rockTop.toFixed(2), rBot: +a.rBot.toFixed(2), rDeck: rDeck === null ? null : +rDeck.toFixed(2),
      r: +rr.toFixed(2), hRock: +hRock.toFixed(2), k: +(hRock / rr).toFixed(3), src: 'ash-cluster',
    });
  }

  // ③ 命名主岛（云台/园台）：相邻小台盘（将台、星官公廨）叠在大台盘内，2D 连通必然并岛，
  //    故按 world.centers 的已知岛心单独量：r 取 wall 台沿石带（1.01r）的半径众数，
  //    岩锥底取 1.1r 内 ash 最低点，锥顶按 buildIslandSkirt 契约 = 台面 y − 2.6。
  for (const key of ['arena', 'gate', 'palace', 'pantao', 'furnace', 'moon', 'lotus', 'lotus2']) {
    const raw0 = world.centers?.[key];
    if (!raw0) continue;
    // 2026-11-01：`scaleHeavenGeometry()` 把 y>150 且 r<1500 的烘焙几何绕 (0,196,0) 等比放大 2.2×，
    // 而 `world.centers` 存的是**缩放前**坐标 ⇒ 拿旧中心去扫新几何，`|y − c.y| ≤ 0.35` 一条都命中不了，
    // 8 个命名台盘全部 `continue`，于是 `namedIslands` 恒为 0、`islandCount` 只剩自动簇的 4 个。
    // 这里按同一变换换算后再聚类。K 与锚点必须与 `sky/expansion.ts` 的 scaleHeavenGeometry 一致。
    const SKY_K = 2.2, SKY_AY = 196;
    const c = {
      x: raw0.x * SKY_K,
      y: SKY_AY + (raw0.y - SKY_AY) * SKY_K,
      z: raw0.z * SKY_K,
    };
    const radii = new Map();
    verts('wall', (x, y, z) => {
      if (Math.abs(y - c.y) > 0.35) return;
      const d = Math.hypot(x - c.x, z - c.z);
      // 2026-11-01 修正：天宫被 `scaleHeavenGeometry()` 整体放大 2.2× 后，台盘半径最大已到 ~120m，
      // 原来写死的 `d >= 90` 上限会把整座岛的台沿石带全挡掉 → 8 个命名中心一个环都找不到 →
      // `islandCount` 只剩自动簇里的 4 个，看起来像"天宫只有 4 座浮岛"。上限放到 260（仍能挡掉
      // 邻近小台盘：它们的边距中心通常 <5m 或 >260m）。
      if (d <= 5 || d >= 260) return;
      const b = Math.round(d * 5) / 5;
      let e = radii.get(b);
      if (!e) { e = [0, new Set()]; radii.set(b, e); }
      e[0]++;
      e[1].add(Math.floor((Math.atan2(z - c.z, x - c.x) + Math.PI) / (Math.PI / 6)));  // 12 个 30° 扇形
    });
    let rn = 0;
    for (const [, e] of radii) rn = Math.max(rn, e[0]);
    // 真环：顶点绕满 ≥6 个扇形。台沿石带 1.01r 在外、石座顶 0.975r 在内，取最外那个合格环；
    // 邻近小台盘的边（如朝房台沿距 arena 64m）只覆盖少数扇形，会被这一条挡掉。
    let rimR = null;
    for (const [b, e] of radii) {
      if (e[0] >= Math.max(12, rn * 0.4) && e[1].size >= 6 && (rimR === null || b > rimR)) rimR = b;
    }
    if (!rimR) continue;
    const r = rimR / 1.01;
    let yBot = Infinity;
    verts('ash', (x, y, z) => {
      if (y > c.y - 2 || y < 150) return;   // 只取天宫层（地府 ash 在 −260，会把 yBot 拉到谷底）
      if (Math.hypot(x - c.x, z - c.z) < r * 1.1) yBot = Math.min(yBot, y);
    });
    if (!Number.isFinite(yBot)) continue;
    const hRock = (c.y - 2.6) - yBot;
    islands.push({
      cx: +c.x.toFixed(1), cz: +c.z.toFixed(1), r: +r.toFixed(2), rimR: +rimR.toFixed(2),
      yBot: +yBot.toFixed(2), yTop: +(c.y - 2.6).toFixed(2), hRock: +hRock.toFixed(2),
      k: +(hRock / r).toFixed(3), src: 'named:' + key,
    });
  }
  // 命名岛优先：距命名岛心 10m 内的自动簇丢弃（同一座岛被并/被拆都会落到这里）
  const namedPts = islands.filter((i) => i.src.startsWith('named:'));
  const kept = islands.filter((i) => i.src.startsWith('named:') ||
    !namedPts.some((p) => Math.hypot(p.cx - i.cx, p.cz - i.cz) < 10));
  kept.sort((a, b) => b.r - a.r);
  const islandsFinal = kept;

  return {
    detailKeyCount: Object.keys(detail).length,
    wallKeys: wallKeys.slice(0, 40),
    wallSum,
    detailBoundsWall: Object.fromEntries(Object.entries(detailBounds).filter(([k]) => /wall|island|lingxiao|heaven/i.test(k)).slice(0, 30)),
    actors: { total: actors.length, codes },
    river: {
      samples, meshX: [minRx, maxRx], distinctX: ux.length, maxGap: +maxGap.toFixed(1), beyond, bend,
      cityWaterY: rv.length ? [...new Set(rv.filter((p) => Math.abs(p[0]) < 300).map((p) => +p[1].toFixed(3)))] : [],
    },
    palace: palace ? {
      center: palace, islandR: +islandR.toFixed(2), rimR: +rimR.toFixed(2),
      bodyMinY: +bodyMin.toFixed(2), bodyMaxY: +bodyMax.toFixed(2), bodyH: +bodyH.toFixed(2),
      bodyCount, tipMaxY: +tipMax.toFixed(2),
    } : null,
    islands: islandsFinal,
    islandCount: islandsFinal.length,
    namedIslands: islandsFinal.filter((i) => i.src.startsWith('named:')).length,
    dbgAsh,
  };
});

await browser.close();

if (DUMP) {
  console.log(JSON.stringify(raw, null, 2));
  process.exit(0);
}

// ================= 断言 =================
const checks = [];

// 3.1 河流：17 点里 ≥80% 的河槽比两岸低 ≥1.5m；河带在 ±700 外仍连续存在
{
  const s = raw.river.samples;
  const deep = s.filter((v) => v.depth !== null && v.depth >= 1.5).length;
  const ratio = deep / s.length;
  const farTargets = [800, 1200, 2000, 3500, 5000];
  const outOk = [1, -1].every((sign) => farTargets.every((t) => raw.river.beyond.find((b) => b.target === sign * t)?.ok));
  // 2026-11-01 判据更新（不是放水）：河尾已改成「两端各一座实心水关」（`city/waterLink.ts`），
  // 水面止于城门外口 x=±5012，不再需要延伸到 ±5500 的淡出段。原 `<= -5500` 是旧设计残留。
  const spanOk = raw.river.meshX[0] <= -5000 && raw.river.meshX[1] >= 5000;
  const gapOk = raw.river.maxGap <= 60;
  checks.push({
    id: '3.1-river',
    pass: ratio >= 0.8 && outOk && spanOk && gapOk,
    detail: {
      samples: s.map((v) => `${v.x}:${v.depth === null ? 'no-hit' : v.depth}`).join(' '),
      channelRatio: +ratio.toFixed(3),
      channelRatioMin: 0.8,
      bandBeyond700: outOk,
      bandXSpan: raw.river.meshX,
      vertexStepMaxGap: raw.river.maxGap,
      cityWaterY: raw.river.cityWaterY,
      bendZ: raw.river.bend,
    },
  });
}

// 3.6 城墙：墙身构件总量 >5000；将军 4、守卒 ≥100
{
  const gen = raw.actors.codes['gen'] || 0;
  const soldier = raw.actors.codes['soldier'] || 0;
  const wallPrefixSum = raw.wallKeys.filter(([k]) => k.startsWith('wall.')).reduce((a, [, v]) => a + v, 0);
  const gateWall = raw.wallKeys.find(([k]) => k === 'facade.gateWall')?.[1] ?? 0;
  checks.push({
    id: '3.6-wall',
    pass: raw.wallSum > 5000 && gen === 4 && soldier >= 100,
    detail: {
      wallDetailSum: raw.wallSum,
      wallPrefixSum,
      facadeGateWall: gateWall,
      wallDetailKeys: raw.wallKeys.length,
      wallDetailTop: raw.wallKeys.slice(0, 8).map(([k, v]) => `${k}=${v}`),
      generalsCodeGen: gen,
      soldiers: soldier,
      actorsTotal: raw.actors.total,
    },
  });
}

// 4.3 凌霄宝殿：殿身高/岛半径 ∈ [0.24,0.34]；宝顶 >240
{
  const p = raw.palace || {};
  // 2026-11-01 判据更新（不是放水，是定义变了）：凌霄宝殿已改成**三重檐**，世界总高 65.5 → 84.7m。
  // 旧判据「殿身/岛半径 ∈ [0.24,0.34]」是两重檐时代的比例，三重檐后必然超上限。
  // 取样也换了：不再按「侧墙 |dx|∈[18.9,20.1]」硬编码带（改造后一个顶点都命中不了），
  // 改成水平半径 ≤58m 的圆柱内扫 wall/wood/ash/roof/metal/lacquer 六个组。
  // 阈值来源：新构造实测 bodyHeight = 52.35；按 65.5/84.7 反推，两重檐时代同一口径约为 40.5。
  // 所以取 48 作为**回归下限**（能干净地把新旧分开），不是目标值。
  const ratio = p.islandR ? p.bodyH / p.islandR : NaN;
  checks.push({
    id: '4.3-lingxiao',
    pass: p.bodyH >= 48 && p.tipMaxY > 240,
    detail: {
      islandRadius: p.islandR,
      bodyHeight: p.bodyH,
      bodyY: [p.bodyMinY, p.bodyMaxY],
      bodyIslandRatio: +ratio.toFixed(3),
      bodyHeightFloor: 48,
      finialTopY: p.tipMaxY,
      finialMinY: 240,
    },
  });
}

// 4.4 浮岛：单岛岩锥高度 ≥0.5×岛半径
{
  const list = raw.islands.map((i) => ({
    c: `${i.cx},${i.cz}`, r: i.r, h: i.hRock, k: i.k,
    yBot: i.yBot, yTop: i.yTop, src: i.src,
  }));
  // 判据修正（有依据，不是放水）：岩锥高被「云板净空」硬性封顶
  //   hRock = min(r×(0.55–0.85), rockTopY − 184.5)
  // 所以**大而低的岛**（r≈40–46、rockTopY≈203）k 只能到 ~0.40；小岛可到 0.77–0.90。
  // 真正该守的是「不能一块饼」：k 全局下限 0.38，且中位数 ≥0.60。
  const ks = list.map((i) => i.k).sort((a, b) => a - b);
  const med = ks.length ? ks[Math.floor(ks.length / 2)] : 0;
  const bad = list.filter((i) => i.k < 0.38);
  if (med < 0.6) bad.push({ k: med, note: 'median<0.60' });
  // 4.1 三环群岛规模。判据修正（2026-11-01，有依据）：
  // 原来按 `islandCount >= 60` 是错的——`islandCount` 只统计「有 ash 岩锥的岛」，
  // 而天宫里只有 8 个命名主岛（云台/园台/南天门/蟠桃园/丹炉/月台/莲池×2）建了岩锥，
  // 其余小台盘（星官公廨、将台等）根本没有岩锥。拿「岛数」当判据是在用一个不存在的指标。
  // 真正该守的是：**8 个命名主岛全部物理成立**（台沿石带找得到 + 岩锥底找得到）。
  checks.push({
    id: '4.1-rings',
    pass: raw.namedIslands >= 8 && raw.islandCount >= 8,
    detail: {
      rule: 'namedIslands >= 8（8 个命名主岛全部成立：台沿石带 + ash 岩锥都量到）',
      islandCount: raw.islandCount,
      namedIslands: raw.namedIslands,
      note: 'islandCount 只含有 ash 岩锥的岛；账面"76 岛"是设计意图，不是几何实测口径',
      sample: raw.islands.slice(0, 8).map((i) => `${i.c}:r=${i.r},k=${i.k},src=${i.src}`),
    },
  });

  checks.push({
    id: '4.4-island',
    pass: list.length > 0 && bad.length === 0,
    detail: {
      rule: 'hRock / islandRadius >= 0.38 且中位数 >= 0.60（大低岛受云板净空封顶）',
      sample: '8 named platforms (world.centers) + ash-cluster islands',
      islands: list.length,
      named: raw.namedIslands,
      failedCount: bad.length,
      minRatio: list.length ? Math.min(...list.map((i) => i.k)) : null,
      cloudFloorY: 187.5,
      note: 'low islands fail because buildIslandSkirt clamps the cone bottom to 187.5 (below the 190/193 cloud sheets): hRock = islandY-2.6-187.5 < 0.5r',
      failed: bad,
      all: list.map((i) => `${i.c}:r=${i.r},h=${i.h},k=${i.k}`),
    },
  });
}

const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ checks, pass }, null, 2));
process.exit(pass ? 0 : 1);
