import * as THREE from 'three';
import { Baker } from '../src/city/bake';
import { buildHeavenGallery, heavenGalleryStats } from '../src/sky/heavenGallery';

/**
 * 独立探针：只建 heavenGallery 一个模块 + 天地光，不加载全城。
 * 三个机位由 window.__gallery.setView() 切换，供 puppeteer 截图。
 */

const D = Math.PI / 180;
const CX = 0, CZ = 0, BASE_Y = 0, R = 120;
const A0 = 0, A1 = 200 * D;
const MID = (A0 + A1) / 2;

const app = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 9000);

// 天穹（与 world.ts 同一套渐变，颜色略提亮，便于看清檐下）
const domeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color(0x182a4e) }, uBot: { value: new THREE.Color(0xa8643c) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP;
    void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
      vec3 c = mix(uBot, uTop, pow(h, 0.9)); gl_FragColor = vec4(c, 1.0); }`,
});
const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), domeMat);
dome.frustumCulled = false;
scene.add(dome);

// 光：与 world.ts 同色温
const sun = new THREE.DirectionalLight(0xffe0b0, 1.5);
sun.position.set(80, 120, 160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 520;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0x5a6fa8, 0x3a2c28, 0.8);
scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(amb);
const fill = new THREE.DirectionalLight(0x8aa0c8, 0.9);
fill.position.set(-120, 70, -140);
scene.add(fill);
scene.add(fill.target);

// 云海（一张径向渐变贴图铺大平面，接住廊底）
{
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(256, 256, 20, 256, 256, 256);
  rg.addColorStop(0, 'rgba(190,205,226,0.55)');
  rg.addColorStop(0.55, 'rgba(140,160,190,0.38)');
  rg.addColorStop(1, 'rgba(80,98,130,0.0)');
  g.fillStyle = rg; g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(2200, 2200),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -14;
  scene.add(sea);
}

const b = new Baker();
buildHeavenGallery(b, { cx: CX, cz: CZ, y: BASE_Y, r: R, a0: A0, a1: A1, width: 12, eaveH: 14 });

// 宫灯的实体照明（探针专用：模块只烘几何，灯是宿主的事）。
// 沿弧 10 盏暖光，模拟 90 盏宫灯在廊内的漫射，否则无全局光照的廊心会是纯黑。
for (let i = 0; i < 11; i++) {
  const t = MID - 22 * D + (60 * D * i) / 10;
  const pl = new THREE.PointLight(0xffc06a, 55, 34, 2.0);
  pl.position.set(CX + Math.cos(t) * R, BASE_Y + 10.2, CZ + Math.sin(t) * R);
  scene.add(pl);
}

const pos = (t: number, o: number, yy: number): THREE.Vector3 =>
  new THREE.Vector3(CX + Math.cos(t) * (R + o), BASE_Y + yy, CZ + Math.sin(t) * (R + o));

type View = { p: THREE.Vector3; l: THREE.Vector3; fov: number; up?: THREE.Vector3 };

const VIEWS: Record<string, View> = {
  // 廊内平视（略仰，看得到斗栱/额枋/挂落）
  inside: { p: pos(MID - 5 * D, 2.2, 1.68), l: pos(MID + 12 * D, 0.2, 8.6), fov: 72 },
  // 廊外斜视（弧线 + 瓦垄 + 出檐 + 栏杆）
  outside: { p: pos(A1 + 12 * D, 44, 21), l: pos(MID + 26 * D, 0, 7.6), fov: 48 },
  // 俯视（沿 y=12.2m 剖切，屋面以上切掉，看廊宽与柱距）
  top: { p: pos(MID, 0.2, 44), l: pos(MID, 0.2, 0), fov: 46, up: new THREE.Vector3(0, 0, -1) },
};

let mats: THREE.Material[] = [];

function setView(name: string): void {
  const v = VIEWS[name] ?? VIEWS.inside;
  camera.fov = v.fov;
  camera.position.copy(v.p);
  camera.up.copy(v.up ?? new THREE.Vector3(0, 1, 0));
  camera.lookAt(v.l);
  camera.updateProjectionMatrix();
  const cut = name === 'top';
  const inside = name === 'inside';
  hemi.intensity = inside ? 1.3 : cut ? 0.55 : 1.05;
  amb.intensity = inside ? 1.15 : cut ? 0.3 : 0.85;
  renderer.toneMappingExposure = inside ? 1.05 : cut ? 1.0 : 1.3;
  // 阴影相机只覆盖机位附近 ±90m；外景整条弧长 419m，弧端落在阴影图外会被采成"全阴影"。
  // 外景/俯视直接关阴影（这两张图看的是形制与瓦垄，不靠投影）。
  renderer.shadowMap.enabled = inside;
  sun.castShadow = inside;
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 12.2);
  for (const m of mats) {
    const mm = m as THREE.Material & { clippingPlanes?: THREE.Plane[] | null };
    mm.clippingPlanes = cut ? [plane] : null;
    mm.needsUpdate = true;
  }
  sun.target.position.copy(v.l);
  // 补光放在机位一侧，避免整排立面变成剪影
  const back = new THREE.Vector3().subVectors(v.p, v.l).normalize();
  sun.position.copy(v.l).addScaledVector(back, 150);
  sun.position.y += 140;
  if (name === 'outside') {
    // 外景：让太阳正对近段立面的法线（否则竖向柱列永远只有天光，读成剪影）
    const near = pos(A1 - 10 * D, 0, 4);
    const nx = Math.cos(A1 - 10 * D);
    const nz = Math.sin(A1 - 10 * D);
    sun.position.set(near.x + nx * 230, 155, near.z + nz * 230);
    sun.target.position.copy(near);
  }
  sun.shadow.camera.updateProjectionMatrix();
  fill.position.copy(v.l).addScaledVector(back, 120);
  fill.position.y += 60;
  fill.target.position.copy(v.l);
  fill.intensity = inside ? 0.9 : cut ? 0.6 : 2.4;
  renderer.render(scene, camera);
}

async function boot(): Promise<void> {
  const built = await b.build(scene);
  mats = Object.values(built);
  // 阴影相机跟着机位走（一次构建，三机位各渲染一次）
  renderer.render(scene, camera);
  setView('inside');
  const info = renderer.info.render;
  app.textContent =
    `tier=${heavenGalleryStats.tier} bays=${heavenGalleryStats.bays} cols=${heavenGalleryStats.columns} ` +
    `dg=${heavenGalleryStats.dougong} ribs=${heavenGalleryStats.tileRibs} lamps=${heavenGalleryStats.lanterns} ` +
    `posts=${heavenGalleryStats.railPosts} bricks=${heavenGalleryStats.goldBricks} tri=${Math.round(heavenGalleryStats.tris)}`;
  (window as unknown as Record<string, unknown>).__gallery = {
    setView,
    stats: heavenGalleryStats,
    draw: () => ({ calls: info.calls, tris: info.triangles }),
    three: THREE,
    scene,
    camera,
    renderer,
  };
  (window as unknown as Record<string, unknown>).__galleryReady = true;
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  });
}

boot().catch((e) => {
  app.textContent = 'ERR ' + String((e as Error)?.stack ?? e);
  (window as unknown as Record<string, unknown>).__galleryError = String((e as Error)?.stack ?? e);
});
