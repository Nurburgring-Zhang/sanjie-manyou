/**
 * 像素拾取：给屏幕坐标 → 场景里命中的对象名 / InstanceId / 世界坐标。
 * 用来把"这块不该出现的东西"精确定位到代码，而不是靠猜。
 * 用法：node scripts/pick.mjs <camX> <camY> <camZ> <tgtX> <tgtY> <tgtZ> <px> <py> [px py ...]
 */
import puppeteer from 'puppeteer-core';

const [, , cx, cy, cz, tx, ty, tz, ...pts] = process.argv;
const cam = [cx, cy, cz].map(Number);
const tgt = [tx, ty, tz].map(Number);
const pixels = [];
for (let i = 0; i < pts.length; i += 2) pixels.push([Number(pts[i]), Number(pts[i + 1])]);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1800));

const out = await page.evaluate(([c, t, px]) => {
  const Q = window.__qingming;
  const e = Q.engine;
  e.stopCinema();
  e.camera.position.set(c[0], c[1], c[2]);
  e.lookTarget.set(t[0], t[1], t[2]);
  const dx = t[0] - c[0], dy = t[1] - c[1], dz = t[2] - c[2];
  const d = Math.max(1, Math.hypot(dx, dy, dz));
  e.yaw = Math.atan2(-dx, -dz);
  e.pitch = Math.asin(dy / d);
  e.setCamMode('fly');
  e.camera.updateMatrixWorld(true);
  e.camera.lookAt(t[0], t[1], t[2]);
  e.camera.updateMatrixWorld(true);
  const THREE = Q.THREE ?? window.THREE;
  const rc = new THREE.Raycaster();
  return px.map(([x, y]) => {
    const ndc = new THREE.Vector2((x / 1280) * 2 - 1, -(y / 720) * 2 + 1);
    rc.setFromCamera(ndc, e.camera);
    const hits = rc.intersectObjects(e.scene.children, true).slice(0, 4);
    return {
      px: [x, y],
      hits: hits.map((h) => ({
        name: h.object.name || '(anon)',
        type: h.object.type,
        inst: h.instanceId ?? null,
        dist: +h.distance.toFixed(1),
        p: [h.point.x, h.point.y, h.point.z].map((v) => +v.toFixed(1)),
        mat: h.object.material?.type ?? '',
      })),
    };
  });
}, [cam, tgt, pixels]);

for (const r of out) console.log(JSON.stringify(r));
await browser.close();
