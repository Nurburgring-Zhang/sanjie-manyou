/**
 * 机检：天宫「圆形仙门」是不是一枚**真环**（洞口通透），而不是实心圆盘。
 *
 * 判据四条，全部只认执行证据：
 *   ① 射线：从机位穿环心（及环心周围 4 点）发射线，第一命中距离必须**远大于**环平面距离
 *      —— 旧版月盘正插在环心，射线在环平面处就被挡住。
 *   ② 像素：环心 ROI 与环身 ROI 的均值色差 ΔRGB 必须显著（环心不该是石头色）。
 *   ③ 视差：机位横向平移 0.18×内径，按「洞口相对坐标」重采样环心——
 *      洞口若通着远景，背景相对环会滑动（MAD 大）；若是贴在环平面上的实心盘，几乎不动。
 *   ④ 取样自检：环身 ROI 必须真有足够像素（否则是在量空气）。
 *
 * 机位与环参数与 src/sky/expansion.ts（hRoundGate）+ src/sky/heavenFrame.ts 同源：
 *   环心（缩放前）由 W_STAIR.dir=129° / len=150 / 内环第 5 岛推导，world = 缩放 2.2×、抬升 1935m。
 * 退出码 0=通过 / 1=不通过。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const OUT = process.env.OUT_DIR || 'artifacts/_ring';
const W = 1600, H = 900;

// —— 世界坐标（与源码同源）——
const S = 2.2, BASE_Y = 196, LIFT = 1935;
const heavenY = (y) => BASE_Y + LIFT + (y - BASE_Y) * S;
const GATE = { x: -270.09, z: 378.92, y: 239.65, theta: 2.46091 };
const RI = 37.7 * S;      // 洞口半径（旧新版一致）
const RO = 47.1 * S;      // 外径（外/内 = 1.25）
const C = [GATE.x * S, heavenY(GATE.y), GATE.z * S];
const NRM = [Math.sin(GATE.theta), 0, Math.cos(GATE.theta)];   // 环法线（指向来路）
const UX = [Math.cos(GATE.theta), 0, -Math.sin(GATE.theta)];   // 环平面内水平轴
const D = 380;                                                  // 机位到环心距离
const CAM_A = [C[0] - NRM[0] * D, C[1] + 4, C[2] - NRM[2] * D];
const SHIFT = 0.18 * RI;
const CAM_B = [CAM_A[0] + UX[0] * SHIFT, CAM_A[1], CAM_A[2] + UX[2] * SHIFT];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2500));

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 摆机位 + 出图 + 记录该机位下环的屏幕投影 */
async function shoot(cam, name) {
  await page.evaluate(([P, T]) => {
    const e = window.__qingming.engine;
    if (e.camMode !== 'fly') e.setCamMode('fly');
    e.stopCinema();
    e.camera.position.set(P[0], P[1], P[2]);
    const dx = T[0] - P[0], dy = T[1] - P[1], dz = T[2] - P[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
  }, [cam, C]);
  await sleep(1100);
  const b64 = await page.screenshot({ encoding: 'base64', path: `${OUT}/${name}.png` });
  const roi = await page.evaluate(([C, UX, NRM, RI, RO, W, H]) => {
    const T3 = window.__qingming.THREE;
    const cam = window.__qingming.engine.camera;
    cam.updateMatrixWorld(true);
    const proj = (p) => {
      const v = new T3.Vector3(p[0], p[1], p[2]).project(cam);
      return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H];
    };
    const ringPt = (al, r) => [C[0] + UX[0] * Math.cos(al) * r, C[1] + Math.sin(al) * r, C[2] + UX[2] * Math.cos(al) * r];
    const [sx, sy] = proj(C);
    const K = 96, ri = [], ro = [];
    for (let k = 0; k < K; k++) {
      const al = (k / K) * Math.PI * 2;
      const a = proj(ringPt(al, RI)), b = proj(ringPt(al, RO));
      ri.push(Math.hypot(a[0] - sx, a[1] - sy));
      ro.push(Math.hypot(b[0] - sx, b[1] - sy));
    }
    return { sx, sy, ri, ro, K };
  }, [C, UX, NRM, RI, RO, W, H]);
  return { b64, roi };
}

const A = await shoot(CAM_A, 'probe_A');
const B = await shoot(CAM_B, 'probe_B');

// —— 射线：环心 5 条 ——
const rays = await page.evaluate(([C, UX, RI, D]) => {
  const Q = window.__qingming;
  const cam = Q.engine.camera;
  cam.updateMatrixWorld(true);
  const rc = new Q.THREE.Raycaster();
  const out = [];
  for (const [a, b] of [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) {
    const p = [C[0] + UX[0] * a * RI, C[1] + b * RI, C[2] + UX[2] * a * RI];
    const v = new Q.THREE.Vector3(p[0], p[1], p[2]).project(cam);
    rc.setFromCamera(new Q.THREE.Vector2(v.x, v.y), cam);
    let dist = null, pt = null, name = '';
    for (const h of rc.intersectObjects(Q.engine.scene.children, true)) {
      const o = h.object;
      if (!o.isMesh || o.visible === false) continue;
      dist = h.distance; pt = [h.point.x, h.point.y, h.point.z]; name = o.name || '';
      break;
    }
    out.push({ off: [a, b], dist: dist === null ? null : +dist.toFixed(1), pt: pt && pt.map((v2) => +v2.toFixed(1)), name });
  }
  return { ringDist: D, hits: out };
}, [C, UX, RI, D]);

// —— 像素：环心 / 环身 / 视差 ——
const px = await page.evaluate(([A, B, W, H]) => {
  const decode = (b64) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      res(g.getImageData(0, 0, W, H));
    };
    img.onerror = rej;
    img.src = 'data:image/png;base64,' + b64;
  });
  const idx = (phi, K) => Math.round((phi / (Math.PI * 2)) * K) % K;
  const ringIdx = (dx, dy, K) => {
    const a = Math.atan2(dy, dx);
    return idx(a < 0 ? a + Math.PI * 2 : a, K);
  };

  const collect = (img, roi) => {
    let n = 0, r = 0, g = 0, b = 0;
    const lum = [];
    return { n, r, g, b, lum };
  };
  const walk = (img, roi, inRegion, acc) => {
    const x0 = Math.max(0, Math.floor(roi.sx - roi.ro[0])), x1 = Math.min(W - 1, Math.ceil(roi.sx + roi.ro[0]));
    const y0 = Math.max(0, Math.floor(roi.sy - roi.ro[0])), y1 = Math.min(H - 1, Math.ceil(roi.sy + roi.ro[0]));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - roi.sx, dy = y - roi.sy;
        const d = Math.hypot(dx, dy);
        const k = ringIdx(dx, dy, roi.K);
        if (!inRegion(d, k, roi)) continue;
        const o = (y * W + x) * 4;
        acc.r += img.data[o]; acc.g += img.data[o + 1]; acc.b += img.data[o + 2];
        acc.lum.push(0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]);
        acc.n++;
      }
    }
    return acc;
  };
  const core = (img, roi) => {
    const a = walk(img, roi, (d, k) => d <= 0.30 * roi.ri[k], collect(img, roi));
    return { n: a.n, r: a.n ? a.r / a.n : 0, g: a.n ? a.g / a.n : 0, b: a.n ? a.b / a.n : 0, lum: a.lum };
  };
  const body = (img, roi) => {
    const a = walk(img, roi, (d, k) => d >= 1.08 * roi.ri[k] && d <= 0.92 * roi.ro[k], collect(img, roi));
    return { n: a.n, r: a.n ? a.r / a.n : 0, g: a.n ? a.g / a.n : 0, b: a.n ? a.b / a.n : 0, lum: a.lum };
  };
  const sampleHole = (img, roi) => {
    const out = [];
    for (let ai = 0; ai < 24; ai++) {
      for (let ti = 0; ti <= 4; ti++) {
        const phi = (ai / 24) * Math.PI * 2;
        const t = (ti / 4) * 0.30;
        const k = idx(phi, roi.K);
        const x = Math.round(roi.sx + Math.cos(phi) * t * roi.ri[k]);
        const y = Math.round(roi.sy + Math.sin(phi) * t * roi.ri[k]);
        const o = (y * W + x) * 4;
        out.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
      }
    }
    return out;
  };
  const std = (v) => {
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  };

  return (async () => {
    const ia = await decode(A.b64), ib = await decode(B.b64);
    const c = core(ia, A.roi), bd = body(ia, A.roi);
    const ha = sampleHole(ia, A.roi), hb = sampleHole(ib, B.roi);
    let mad = 0;
    for (let i = 0; i < ha.length; i++) mad += Math.abs(ha[i][0] - hb[i][0]) + Math.abs(ha[i][1] - hb[i][1]) + Math.abs(ha[i][2] - hb[i][2]);
    mad /= ha.length * 3;
    return {
      corePx: c.n, bodyPx: bd.n,
      coreMean: [c.r, c.g, c.b].map((v) => +v.toFixed(1)),
      bodyMean: [bd.r, bd.g, bd.b].map((v) => +v.toFixed(1)),
      coreLumStd: +std(c.lum).toFixed(2),
      bodyLumStd: +std(bd.lum).toFixed(2),
      parallaxMAD: +mad.toFixed(2),
      roi: { sx: +A.roi.sx.toFixed(1), sy: +A.roi.sy.toFixed(1), ri: +A.roi.ri[0].toFixed(1), ro: +A.roi.ro[0].toFixed(1) },
    };
  })();
}, [A, B, W, H]);

await browser.close();

// —— 判定 ——
const dRGB = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ringDist = rays.ringDist;
const minHit = Math.min(...rays.hits.map((h) => (h.dist === null ? Infinity : h.dist)));
const checks = [
  { id: '① 洞口射线不被环平面挡住', ok: minHit > ringDist * 1.15, got: `minHit=${minHit.toFixed(1)}m, ring=${ringDist.toFixed(1)}m, 阈值>${(ringDist * 1.15).toFixed(1)}` },
  { id: '② 环心与环身色差', ok: dRGB(px.coreMean, px.bodyMean) >= 18, got: `ΔRGB=${dRGB(px.coreMean, px.bodyMean).toFixed(1)}（阈值≥18）` },
  { id: '③ 洞口视差（背景相对环滑动）', ok: px.parallaxMAD >= 12, got: `MAD=${px.parallaxMAD}（阈值≥12）` },
  { id: '④ 环身取样确实落在环上', ok: px.bodyPx >= 4000, got: `bodyPx=${px.bodyPx}` },
];
const ok = checks.every((c) => c.ok);

const report = {
  camera: { A: CAM_A.map((v) => +v.toFixed(1)), B: CAM_B.map((v) => +v.toFixed(1)), target: C.map((v) => +v.toFixed(1)), dist: D, shift: +SHIFT.toFixed(1) },
  phase: { note: 'cinema 已停；天宫层固定机位，两帧间隔约 1.1s，日相由 world 时间驱动（未锁定）' },
  ring: { RI: +RI.toFixed(1), RO: +RO.toFixed(1), ratio: +(RO / RI).toFixed(3) },
  roi: px.roi,
  pixels: { coreMean: px.coreMean, bodyMean: px.bodyMean, coreLumStd: px.coreLumStd, bodyLumStd: px.bodyLumStd, parallaxMAD: px.parallaxMAD },
  rays,
  checks,
  verdict: ok ? 'PASS' : 'FAIL',
};
writeFileSync(`${OUT}/probe-round-gate.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(ok ? 'PASS 圆形仙门是真环（洞口通透）' : 'FAIL 环心被挡住 / 不像环');
process.exit(ok ? 0 : 1);
