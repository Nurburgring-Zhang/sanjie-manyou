/**
 * probe-grain.mjs —— 「散落歪扭」判据机检（SPEC 总账 2.1）。
 *
 * 判据（2026-11-01 已定，本脚本是它的实现）：
 *   ① 最近邻间距的变异系数 CV ≥ 0.35（格网住宅约 0.1–0.2）
 *   ② 朝向直方图（24 桶）最大两峰之和占比 ≤ 55%
 *   ③ 面阔/进深比的四分位差 ≥ 0.18
 * 三项全部满足才算「有机聚落」，否则判「偏格网」。
 *
 * 用法：
 *   node scripts/probe-grain.mjs --self-test          # 纯 Node，用合成数据自证度量实现正确
 *   PREVIEW_URL=http://127.0.0.1:4180/ node scripts/probe-grain.mjs
 *
 * 退出码：0 = PASS，1 = BLOCK，2 = USAGE/SETUP 错误。
 */
import { CHROME } from './chromePath.mjs';

const CV_MIN = 0.35;
const TOP2_MAX = 0.55;
const IQR_MIN = 0.18;
const SAMPLE_CAP = 6000;
const GRID = 8; // 最近邻搜索的格宽（米），按一个坊 20–40m 取

/** 从一个点集算三项指标。pts: {x, z, yaw, w, d}[] */
export function metrics(pts) {
  const n = pts.length;
  if (n < 30) return { n, cv: NaN, top2: NaN, iqr: NaN, note: '样本不足 30' };

  // ① 最近邻间距 CV（格网哈希，避免 O(n^2)）
  const cells = new Map();
  const key = (ix, iz) => ix * 73856093 ^ iz * 19349663;
  for (let i = 0; i < n; i++) {
    const ix = Math.floor(pts[i].x / GRID), iz = Math.floor(pts[i].z / GRID);
    const k = key(ix, iz);
    let a = cells.get(k);
    if (!a) cells.set(k, (a = []));
    a.push(i);
  }
  const nn = [];
  for (let i = 0; i < n; i++) {
    const px = pts[i].x, pz = pts[i].z;
    const cx = Math.floor(px / GRID), cz = Math.floor(pz / GRID);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const a = cells.get(key(cx + dx, cz + dz));
        if (!a) continue;
        for (const j of a) {
          if (j === i) continue;
          const d2 = (pts[j].x - px) ** 2 + (pts[j].z - pz) ** 2;
          if (d2 < best) best = d2;
        }
      }
    }
    if (Number.isFinite(best) && best > 0) nn.push(Math.sqrt(best));
  }
  const mean = nn.reduce((s, v) => s + v, 0) / nn.length;
  const varr = nn.reduce((s, v) => s + (v - mean) ** 2, 0) / nn.length;
  const cv = mean > 0 ? Math.sqrt(varr) / mean : 0;

  // ② 朝向直方图：24 桶，取最大两峰之和占比
  const BINS = 24;
  const hist = new Array(BINS).fill(0);
  for (const p of pts) {
    let a = ((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    hist[Math.min(BINS - 1, Math.floor((a / (Math.PI * 2)) * BINS))]++;
  }
  const sorted = [...hist].sort((a, b) => b - a);
  const top2 = (sorted[0] + sorted[1]) / n;

  // ③ 面阔/进深比的四分位差
  const ratios = pts.map((p) => (p.d ? p.w / p.d : 1)).sort((a, b) => a - b);
  const q = (t) => ratios[Math.min(ratios.length - 1, Math.floor(t * (ratios.length - 1)))];
  const iqr = q(0.75) - q(0.25);

  return { n, cv, top2, iqr };
}

export function judge(m) {
  const fails = [];
  if (!(m.cv >= CV_MIN)) fails.push(`①最近邻CV ${m.cv.toFixed(3)} < ${CV_MIN}`);
  if (!(m.top2 <= TOP2_MAX)) fails.push(`②朝向两峰 ${(m.top2 * 100).toFixed(1)}% > ${TOP2_MAX * 100}%`);
  if (!(m.iqr >= IQR_MIN)) fails.push(`③面阔/进深IQR ${m.iqr.toFixed(3)} < ${IQR_MIN}`);
  return { pass: fails.length === 0, fails };
}

// ---------------- self-test：用合成数据集验证度量实现正确 ----------------
function selfTest() {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // A：严格格网（应判 BLOCK）
  const grid = [];
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) {
      grid.push({ x: i * 10, z: j * 10, yaw: 0, w: 6, d: 8 });
    }
  }
  // B：有机聚落（间距抖动 + 朝向散开 + 面阔抖动，应判 PASS）
  const organic = [];
  for (let i = 0; i < 1600; i++) {
    organic.push({
      x: rnd() * 400,
      z: rnd() * 400,
      yaw: rnd() * Math.PI * 2,
      w: 4 + rnd() * 6,
      d: 5 + rnd() * 7,
    });
  }

  const mg = metrics(grid), mo = metrics(organic);
  const jg = judge(mg), jo = judge(mo);
  let ok = true;
  const line = (name, m, j, want) => {
    const got = j.pass ? 'PASS' : 'BLOCK';
    const hit = got === want;
    if (!hit) ok = false;
    console.log(`${hit ? 'OK  ' : 'FAIL'} ${name}: cv=${m.cv.toFixed(3)} top2=${(m.top2 * 100).toFixed(1)}% iqr=${m.iqr.toFixed(3)} -> ${got} (want ${want})`);
  };
  line('严格格网', mg, jg, 'BLOCK');
  line('有机聚落', mo, jo, 'PASS');

  // 边界：样本不足必须报 note 而不是崩
  const few = metrics([{ x: 0, z: 0, yaw: 0, w: 1, d: 1 }]);
  const fewOk = Number.isNaN(few.cv) && few.note;
  if (!fewOk) ok = false;
  console.log(`${fewOk ? 'OK  ' : 'FAIL'} 样本不足: n=${few.n} note=${few.note ?? '(none)'}`);

  console.log(ok ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL');
  return ok ? 0 : 1;
}

// ---------------- 浏览器模式 ----------------
async function live() {
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:4180/', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1200));

  const raw = await page.evaluate((cap) => {
    const scene = window.__qingming.engine.scene;
    const out = {};
    const m = new (window.__THREE_M ?? Object)();
    scene.traverse((o) => {
      if (!o.isInstancedMesh || !/^infill_body_/.test(o.name)) return;
      const n = Math.min(o.count, cap);
      const step = Math.max(1, Math.floor(o.count / n));
      const arr = [];
      const mat = o.instanceMatrix;
      for (let i = 0; i < o.count; i += step) {
        const e = mat.array;
        const o16 = i * 16;
        // 列主序：位置在 12,13,14；缩放 = 三列长度
        const x = e[o16 + 12], z = e[o16 + 14];
        const sx = Math.hypot(e[o16 + 0], e[o16 + 1], e[o16 + 2]);
        const sz = Math.hypot(e[o16 + 8], e[o16 + 9], e[o16 + 10]);
        const yaw = Math.atan2(e[o16 + 8], e[o16 + 0]);
        arr.push({ x, z, yaw, w: sx, d: sz });
      }
      const k = o.name;
      (out[k] ||= []).push(...arr);
    });
    return out;
  }, SAMPLE_CAP);

  await browser.close();

  const names = Object.keys(raw);
  if (names.length === 0) {
    console.log('BLOCK 没有找到任何 infill_body_* InstancedMesh（选择器或构建变了）');
    return 1;
  }
  let bad = 0;
  const all = [];
  const cvList = [];
  for (const k of names) {
    const m = metrics(raw[k]);
    const j = judge(m);
    all.push(...raw[k]);
    cvList.push(m.cv);
    if (!j.pass) bad++;
    console.log(`${j.pass ? 'PASS ' : 'BLOCK'} ${k} n=${m.n} cv=${m.cv.toFixed(3)} top2=${(m.top2 * 100).toFixed(1)}% iqr=${m.iqr.toFixed(3)}  ${j.fails.join(' | ')}`);
  }
  // 汇总口径修正（2026-11-03）：
  // 跨分块合并算 CV 是错的——分块之间相距上千米，会把「块间距离」算进最近邻，
  // 使 CV 被抬到 2.0 以上，掩盖「每块内部都是 0.19–0.20 的规则格网」这个真缺陷。
  // 改为：逐块判定 + 中位数兜底，块通过率 ≥80% 才算整城达标。
  const perChunk = cvList.slice().sort((a, b) => a - b);
  const medianCv = perChunk.length ? perChunk[Math.floor(perChunk.length / 2)] : NaN;
  const passRate = cvList.length ? 1 - bad / cvList.length : 0;
  const overall = passRate >= 0.8 && medianCv >= CV_MIN;
  console.log(`\n分块 CV 中位数=${medianCv.toFixed(3)}（阈值 ≥${CV_MIN}）  块通过率=${(passRate * 100).toFixed(1)}%（阈值 ≥80%）`);
  console.log(`PROBE_2_1=${overall ? 'PASS' : 'BLOCK'} (分块 ${names.length}，红 ${bad})`);
  console.log('备注：跨块合并 CV 不作为判据（会被块间距抬高）；判据只看逐块与中位数。');
  return overall ? 0 : 1;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('probe-grain.mjs');
if (isMain) {
  const code = process.argv.includes('--self-test') ? selfTest() : await live();
  process.exit(code);
}
