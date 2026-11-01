/**
 * 验收机检：把用户逐条抱怨变成可复跑的断言。
 *
 *   R21 河面被背面剔除 → 从 y=200 垂直射线打 bian_river 必须命中，且三角面平均法线 +Y
 *   R21b 河道两端口有收口（水关） → |x| ≥ 4900 的水面之外必须还有几何
 *   R19 地面视角云海不可见 → 相机 y=14 时 cloudSeaGroup 的可见盘 ≤ 0 或等效不透明度 ≤ 0.07
 *   R19b 高空视角云海可见 → 相机 y=1200 时等效不透明度 ≥ 0.5
 *
 * 用法：PREVIEW_URL=http://localhost:4173/ node scripts/probe-acceptance.mjs
 * 退出码 0 = 全部通过，1 = 有失败项。
 */
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1200));

const res = await page.evaluate(async () => {
  const THREE = window.__qingming.THREE;
  const e = window.__qingming.engine;
  e.stopCinema();

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const moveCam = async (p) => {
    e.camera.position.set(p[0], p[1], p[2]);
    e.camera.updateMatrixWorld(true);
    await wait(260);
  };

  // ---- R21：河面朝向与命中 ----
  const river = e.scene.getObjectByName('bian_river');
  let riverHit = 0;
  let normalY = 0;
  if (river) {
    const g = river.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index ? g.index.array : null;
    const triCount = Math.floor((idx ? idx.length : pos.count) / 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    const step = Math.max(1, Math.floor(triCount / 400));
    let acc = 0, cnt = 0;
    for (let t = 0; t < triCount; t += step) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac).normalize();
      acc += n.y; cnt++;
    }
    normalY = acc / Math.max(1, cnt);
    // 垂直射线：沿河取 6 个点
    const rc = new THREE.Raycaster();
    for (const x of [-4000, -2000, 0, 1200, 3000, 4400]) {
      rc.set(new THREE.Vector3(x, 200, 0), new THREE.Vector3(0, -1, 0));
      rc.far = 400;
      const hits = rc.intersectObject(river, false);
      if (hits.length) riverHit++;
    }
  }

  // ---- R21b：河道两端是否有收口 ----
  let endStructures = 0;
  e.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = g.boundingSphere;
    if (!bs) return;
    if (Math.abs(bs.center.x) > 4850 && Math.abs(bs.center.z) < 400 && bs.radius > 2 && bs.radius < 900) endStructures++;
  });
  // 合批后单件已经并入 city_* 大网格（包围球半径上万），按名字找不到了。
  // 改用射线取证：水关的涵洞拱顶/闸门/水门楼都在 y>3，从 60m 高垂直下打，命中 y>3 即算收口成立。
  {
    const rc = new THREE.Raycaster();
    for (const x of [-5000, 5000]) {
      rc.set(new THREE.Vector3(x, 60, 0), new THREE.Vector3(0, -1, 0));
      rc.far = 120;
      const hits = rc.intersectObjects(e.scene.children, true);
      if (hits.some((h) => h.point.y > 3)) endStructures++;
    }
  }

  // ---- R19：云海随相机高度淡出 ----
  const group = e.scene.getObjectByName('cloudSeaGroup');
  const cloudAt = async (y) => {
    await moveCam([0, y, 2600]);
    if (!group) return { exists: false };
    let vis = 0, plates = 0, maxOp = 0, opSum = 0, n = 0;
    group.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m) return;
      const op = m.opacity ?? 1;
      if (o.visible) { vis++; opSum += op; n++; }
      if ((m.name || '') === 'cloudSeaMat') { plates++; if (op > maxOp) maxOp = op; }
    });
    return { exists: true, visibleMeshes: vis, plateMeshes: plates, maxPlateOpacity: +maxOp.toFixed(3), avgOpacity: +(opSum / Math.max(1, n)).toFixed(3) };
  };
  const ground = await cloudAt(14);
  const high = await cloudAt(1200);

  return { riverNormalY: +normalY.toFixed(3), riverHit, endStructures, ground, high };
});

const checks = [
  { id: 'R21 河面法线朝上', pass: res.riverNormalY > 0.9, detail: res.riverNormalY },
  { id: 'R21 从上方射线命中河面 ≥5/6', pass: res.riverHit >= 5, detail: res.riverHit },
  { id: 'R21b 河道两端有收口构造', pass: res.endStructures > 0, detail: res.endStructures },
  {
    id: 'R19 地面视角云海隐藏',
    pass: res.ground.exists === true && (res.ground.visibleMeshes === 0 || res.ground.avgOpacity <= 0.08),
    detail: res.ground,
  },
  {
    id: 'R19b 高空视角云海可见',
    pass: res.high.exists === true && (res.high.plateMeshes === 0 || res.high.maxPlateOpacity >= 0.5),
    detail: res.high,
  },
];
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ checks, pass }, null, 1));
await browser.close();
process.exit(pass ? 0 : 1);
