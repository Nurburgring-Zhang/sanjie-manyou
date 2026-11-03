#!/usr/bin/env node
/**
 * 天宫窗户尺寸机检探针（硬指标：宽/高两个方向世界口径都 ≤ 2.0m，容差 0.05）。
 *
 *   node scripts/probe-heaven-windows.mjs --self-test
 *   PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-heaven-windows.mjs
 *
 * 判据来源
 *   天宫几何先由 `expansion.scaleHeavenGeometry` 绕 (0,196) 等比放大 2.2×；
 *   凌霄殿（|x|≤60 / |z−209|≤62 / y≥2165 的已放大坐标）再由 `enlargeLingxiao`
 *   放大 2.7273× ⇒ 选区内的构件总放大 2.2 × 2.7273 = 6.0×，区外只 ×2.2。
 *
 * 检测口径
 *   ① 只扫 `city_wood*`：天宫的窗洞/窗框都烘在 wood 组（wall/glow/lacquer 组不是本探针的口径）。
 *   ② 颜色：目标为窗洞暗色 0x2a1a10 / 0x2a2118。Baker 落盘的是**线性**顶点色，且逐顶点乘了
 *      0.82–1.00 的接地 AO，所以判色不是「十六进制等值」，而是：把顶点色看作 target × a
 *      （a∈[0.80,1.02]），再对剩下两个通道按 8 位量化（线性容差 0.006 ≈ 8 位 1–2 级）比对。
 *   ③ 聚类：「连续同色三角形段」= 同色且**共享顶点位置**的三角形连通分量。不能按缓冲下标连续聚：
 *      凌霄上层 106 樘窗同色且在中缓冲里紧邻，按下标会并成一个 34m 的大簇（假阳性）。
 *      每个窗洞是一个独立盒体（12 三角面），按顶点焊接后正好一樘一簇。
 *   ④ 包围盒：世界坐标（乘 mesh.matrixWorld）。宽取 max(dx, dz)（窗可能开在 x 向墙或 z 向墙），
 *      高取 dy；深只记录不参与判据。
 *   ⑤ 断言 max(宽, 高) ≤ 2.0 + 0.05。退出码 0=PASS / 1=BLOCK。
 *
 * --self-test 用合成顶点数据自证聚类与包围盒：1.0m 盒应 PASS、3.0m 盒应 BLOCK、
 * 两个相隔 5m 的 1.0m 盒应聚成 2 簇、AO 变暗的同色仍应命中、非窗色应被忽略。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const LIMIT = 2.0;
const TOL = 0.05;
const DARK_HEXES = [0x2a1a10, 0x2a2118];
const PREVIEW_URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const TOL_LIN = 0.006;      // 线性色空间容差（≈ 8 位 1–2 级，覆盖 Baker 的 8 位量化误差）
const AO_MIN = 0.80;        // Baker kAO 下界 0.82，取 0.80 留 2% 余量
const AO_MAX = 1.02;

// ============ 纯函数核心（自检与浏览器内共用同一份源码） ============
/**
 * @param {{name:string,pos:ArrayLike<number>,col:ArrayLike<number>,index:ArrayLike<number>|null,matrix?:ArrayLike<number>}[]} meshes
 * @param {number[]} targetHexes sRGB
 * @returns {{clusters:{mesh:string,tri:number,min:number[],max:number[],w:number,h:number,d:number,cx:number,cy:number,cz:number}[],meshCount:number,triCount:number,matched:number}}
 */
function analyzeTriangles(meshes, targetHexes, cfg) {
  // 作用域注意：本函数会被 toString() 送进浏览器执行，模块级常量在那边不存在，
  // 所以 AO 带/容差必须由参数带入（缺省值与模块级常量一致）。
  const AO_MIN = (cfg && typeof cfg.aoMin === 'number') ? cfg.aoMin : 0.80;
  const AO_MAX = (cfg && typeof cfg.aoMax === 'number') ? cfg.aoMax : 1.02;
  const TOL_LIN = (cfg && typeof cfg.tolLin === 'number') ? cfg.tolLin : 0.006;
  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const targets = targetHexes.map((hex) => [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ]);
  // 顶点色 c ≈ target × a，a ∈ AO 带；其余通道按线性容差比对
  const match = (r, g, b) => {
    for (const t of targets) {
      const a = r / t[0];
      if (!(a >= AO_MIN && a <= AO_MAX)) continue;
      if (Math.abs(g - a * t[1]) > TOL_LIN) continue;
      if (Math.abs(b - a * t[2]) > TOL_LIN) continue;
      return true;
    }
    return false;
  };

  const clusters = [];
  let meshCount = 0;
  let triCount = 0;
  let matched = 0;

  for (const m of meshes) {
    if (!m || !m.pos || !m.col) continue;
    meshCount++;
    const pos = m.pos, col = m.col, idx = m.index;
    // 顶点色可能是 0–1 浮点，也可能是 0–65535 的 uint16（本项目实际是后者）。
    // 归一化因子由采集端给出；缺失或非法时按 1 处理（自检用的就是 0–1）。
    const CS = (typeof m.scale === 'number' && m.scale > 0) ? m.scale : 1;
    let meshMatched = 0;
    const matrix = m.matrix && m.matrix.length === 16 ? m.matrix : null;
    const vcount = pos.length / 3;
    const tcount = idx ? idx.length / 3 : vcount / 3;
    triCount += tcount;

    const tx = (i) => {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (!matrix) return [x, y, z];
      return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
      ];
    };

    // 逐三角形判色（取三顶点均值，抵消盒体上下的 AO 梯度）
    const cls = new Uint8Array(tcount);
    for (let t = 0; t < tcount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const r = (col[i0 * 3] + col[i1 * 3] + col[i2 * 3]) / 3 / CS;
      const g = (col[i0 * 3 + 1] + col[i1 * 3 + 1] + col[i2 * 3 + 1]) / 3 / CS;
      const b = (col[i0 * 3 + 2] + col[i1 * 3 + 2] + col[i2 * 3 + 2]) / 3 / CS;
      if (match(r, g, b)) { cls[t] = 1; matched++; meshMatched++; }
    }
    if (!meshMatched) continue;

    // 并查集：同色 + 共享焊接顶点 → 同一簇
    const parent = new Int32Array(tcount);
    for (let t = 0; t < tcount; t++) parent[t] = t;
    const find = (x) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    const seen = new Map();
    for (let t = 0; t < tcount; t++) {
      if (!cls[t]) continue;
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx[t * 3 + k] : t * 3 + k;
        const p = tx(i);
        const key = `${Math.round(p[0] * 1e4)}|${Math.round(p[1] * 1e4)}|${Math.round(p[2] * 1e4)}`;
        const prev = seen.get(key);
        if (prev === undefined) seen.set(key, t);
        else union(prev, t);
      }
    }
    const groups = new Map();
    for (let t = 0; t < tcount; t++) {
      if (!cls[t]) continue;
      const r = find(t);
      let g = groups.get(r);
      if (!g) { g = { tri: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; groups.set(r, g); }
      g.tri++;
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx[t * 3 + k] : t * 3 + k;
        const p = tx(i);
        for (let c = 0; c < 3; c++) {
          if (p[c] < g.min[c]) g.min[c] = p[c];
          if (p[c] > g.max[c]) g.max[c] = p[c];
        }
      }
    }
    for (const g of groups.values()) {
      const dx = g.max[0] - g.min[0], dy = g.max[1] - g.min[1], dz = g.max[2] - g.min[2];
      clusters.push({
        mesh: m.name ?? '',
        tri: g.tri,
        min: g.min.map((v) => +v.toFixed(3)),
        max: g.max.map((v) => +v.toFixed(3)),
        w: +Math.max(dx, dz).toFixed(3),
        h: +dy.toFixed(3),
        d: +Math.min(dx, dz).toFixed(3),
        cx: +((g.min[0] + g.max[0]) / 2).toFixed(1),
        cy: +((g.min[1] + g.max[1]) / 2).toFixed(1),
        cz: +((g.min[2] + g.max[2]) / 2).toFixed(1),
      });
    }
  }
  return { clusters, meshCount, triCount, matched };
}

// ============ 自检 ============
function boxMesh(name, cx, cy, cz, w, h, d, hex, ao = 1) {
  // 12 个三角形的盒体（与 Baker 的 BoxGeometry 同拓扑：每面 2 三角，独立顶点位置）
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const P = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], // -z
    [x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], // +z
    [x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], // -x
    [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], // +x
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], // +y
    [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], // -y
  ];
  const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [16, 17, 18, 19], [20, 21, 22, 23]];
  const pos = [], col = [];
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const base = [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
  for (const q of quads) {
    for (const [a, b, c] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
      for (const i of [a, b, c]) {
        pos.push(P[i][0], P[i][1], P[i][2]);
        col.push(base[0] * ao, base[1] * ao, base[2] * ao);
      }
    }
  }
  return { name, pos, col, index: null };
}

function runSelfTest() {
  const fails = [];
  const assert = (cond, msg) => { if (!cond) fails.push(msg); };

  const one = analyzeTriangles([boxMesh('t1', 0, 0, 0, 1.0, 1.0, 0.2, 0x2a1a10)], DARK_HEXES);
  assert(one.clusters.length === 1, `1.0m 盒应聚成 1 簇，实得 ${one.clusters.length}`);
  if (one.clusters.length === 1) {
    const c = one.clusters[0];
    assert(Math.abs(c.w - 1.0) < 1e-6 && Math.abs(c.h - 1.0) < 1e-6, `1.0m 盒包围盒应为 1.0×1.0，实得 ${c.w}×${c.h}`);
    assert(Math.max(c.w, c.h) <= LIMIT + TOL, '1.0m 盒应 PASS');
  }

  const three = analyzeTriangles([boxMesh('t3', 0, 0, 0, 3.0, 3.0, 0.2, 0x2a1a10)], DARK_HEXES);
  assert(three.clusters.length === 1, `3.0m 盒应聚成 1 簇，实得 ${three.clusters.length}`);
  if (three.clusters.length === 1) {
    const c = three.clusters[0];
    assert(Math.abs(c.w - 3.0) < 1e-6 && Math.abs(c.h - 3.0) < 1e-6, `3.0m 盒包围盒应为 3.0×3.0，实得 ${c.w}×${c.h}`);
    assert(Math.max(c.w, c.h) > LIMIT + TOL, '3.0m 盒应 BLOCK');
  }

  const two = analyzeTriangles([
    boxMesh('a', 0, 0, 0, 1.0, 1.0, 0.2, 0x2a2118),
    boxMesh('b', 5, 0, 0, 1.0, 1.0, 0.2, 0x2a2118),
  ], DARK_HEXES);
  assert(two.clusters.length === 2, `相隔 5m 的两个 1.0m 盒应聚成 2 簇，实得 ${two.clusters.length}`);

  const ao = analyzeTriangles([boxMesh('ao', 0, 0, 0, 1.2, 1.2, 0.2, 0x2a1a10, 0.82)], DARK_HEXES);
  assert(ao.clusters.length === 1, `AO 0.82 的窗色应命中，实得 ${ao.clusters.length} 簇`);

  const other = analyzeTriangles([boxMesh('wood', 0, 0, 0, 1.0, 1.0, 0.2, 0x3a2414)], DARK_HEXES);
  assert(other.clusters.length === 0, `非窗色 0x3a2414 不应命中，实得 ${other.clusters.length} 簇`);

  const list = [
    ['1.0m 簇', 'PASS', Math.max(one.clusters[0]?.w ?? 0, one.clusters[0]?.h ?? 0)],
    ['3.0m 簇', 'BLOCK', Math.max(three.clusters[0]?.w ?? 0, three.clusters[0]?.h ?? 0)],
  ];
  for (const [name, want, size] of list) {
    const got = size <= LIMIT + TOL ? 'PASS' : 'BLOCK';
    assert(got === want, `${name}: 期望 ${want}，实得 ${got}（${size}m）`);
  }

  console.log('SELF_TEST=' + (fails.length ? 'FAIL' : 'PASS'));
  for (const [name, want, size] of list) console.log(`  ${name}: ${size.toFixed(3)}m -> ${size <= LIMIT + TOL ? 'PASS' : 'BLOCK'} (expect ${want})`);
  console.log(`  2-cluster separation: ${two.clusters.length} clusters (expect 2)`);
  console.log(`  AO 0.82 match: ${ao.clusters.length} cluster (expect 1)`);
  console.log(`  non-window colour: ${other.clusters.length} cluster (expect 0)`);
  if (fails.length) {
    for (const f of fails) console.log('  FAIL: ' + f);
    process.exit(1);
  }
  process.exit(0);
}

// ============ 浏览器实测 ============
async function runLive() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR', m.text()); });

  try {
    const t0 = Date.now();
    await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
    await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 300000 });
    await new Promise((r) => setTimeout(r, 1500));
    const loadMs = Date.now() - t0;

    const result = await page.evaluate((analyzeSrc, targets, url, cfg) => {
      // 同一份算法源码：自检与实测不允许各写一份（否则测的不是同一个判据）
      const analyze = (0, eval)('(' + analyzeSrc + ')');
      const { scene } = window.__qingming;
      const meshes = [];
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.name || !o.name.startsWith('city_wood')) return;
        const g = o.geometry;
        const p = g.getAttribute('position');
        const c = g.getAttribute('color');
        if (!p || !c) return;
        o.updateWorldMatrix(true, false);
        meshes.push({
          name: o.name,
          pos: p.array,
          col: c.array,
          // 归一化因子：本项目顶点色是 0–65535 uint16；抽样跨整个数组，避免只采到暗段误判
          scale: (() => {
            const a = c.array;
            let mx = 0;
            const step = Math.max(1, Math.floor(a.length / 4096));
            for (let i = 0; i < a.length; i += step) if (a[i] > mx) mx = a[i];
            return mx > 1.5 ? 65535 : 1;
          })(),
          index: g.index ? g.index.array : null,
          matrix: o.matrixWorld.elements.slice(),
        });
      });
      const r = analyze(meshes, targets, cfg);
      return { url, ...r, meshNames: meshes.map((m) => m.name) };
    }, analyzeTriangles.toString(), DARK_HEXES, PREVIEW_URL, { aoMin: AO_MIN, aoMax: AO_MAX, tolLin: TOL_LIN });

    // 只判天宫层（抬升后世界 y ≥ 2000）且形态像「窗」的簇：
    //   - 两个边长都 ≥ 0.4m（排除门缝/暗线这类零厚薄片）
    //   - 长短边比 ≤ 6（排除 142m 长的檐下暗带、走马板条）
    // 地府（y≈−257）与人间不在本条指标范围内。
    const HEAVEN_Y = 2000;
    const isWindowish = (c) => {
      const a = Math.max(c.w, c.h), b = Math.min(c.w, c.h);
      return c.cy >= HEAVEN_Y && b >= 0.4 && a / Math.max(0.001, b) <= 6;
    };
    const cand = result.clusters.filter(isWindowish);
    const over = cand
      .map((c) => ({ ...c, span: Math.max(c.w, c.h) }))
      .filter((c) => c.span > LIMIT + TOL)
      .sort((a, b) => b.span - a.span);
    const maxOk = result.clusters.reduce((m, c) => Math.max(m, Math.min(c.w, c.h)), 0);
    const worst = result.clusters.reduce((m, c) => Math.max(m, Math.max(c.w, c.h)), 0);

    console.log('PREVIEW_URL=' + PREVIEW_URL);
    console.log('LOAD_MS=' + loadMs);
    console.log(`CITY_WOOD_MESHES=${result.meshCount} (${result.meshNames.length} named)`);
    console.log('CITY_WOOD_TRIS=' + result.triCount);
    console.log('WINDOW_DARK_TRIS=' + result.matched);
    console.log('WINDOW_CLUSTERS=' + result.clusters.length);
    console.log(`WORST_SPAN=${worst.toFixed(3)}m  LIMIT=${LIMIT.toFixed(2)}m  TOL=${TOL}`);
    console.log('OVER_LIMIT=' + over.length);
    for (const c of over.slice(0, 10)) {
      console.log(
        `  OVER w=${c.w.toFixed(2)} h=${c.h.toFixed(2)} d=${c.d.toFixed(2)} ` +
        `at (${c.cx}, ${c.cy}, ${c.cz}) tri=${c.tri} mesh=${c.mesh}`,
      );
    }
    const ok = over.length === 0;
    console.log('RESULT=' + (ok ? 'PASS' : 'BLOCK'));
    // 便于复核：把簇按尺寸分档（不含坐标，只统计），确认不是「零簇假绿」
    const buckets = { '<=1m': 0, '1-2m': 0, '2-4m': 0, '>4m': 0 };
    for (const c of result.clusters) {
      const s = Math.max(c.w, c.h);
      if (s <= 1) buckets['<=1m']++;
      else if (s <= 2) buckets['1-2m']++;
      else if (s <= 4) buckets['2-4m']++;
      else buckets['>4m']++;
    }
    console.log('SIZE_BUCKETS=' + JSON.stringify(buckets));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}

if (process.argv.includes('--self-test')) runSelfTest();
else await runLive();
