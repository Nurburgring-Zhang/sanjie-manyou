import * as THREE from 'three';
import { Baker } from '../src/city/bake';
import { buildHeavenGallery, heavenGalleryStats } from '../src/sky/heavenGallery';
import { buildHeavenWater, createHeavenWaterFlow, updateHeavenWaterFlow, heavenWaterStats, HEAVEN_WATER } from '../src/sky/heavenWater';
import { buildHeavenBells, heavenBellsStats, HEAVEN_BELLS } from '../src/sky/heavenBells';

/**
 * C 组独立探针：只建 heavenGallery（±90°）+ heavenWater + heavenBells 三个模块，
 * 不接 expansion.ts / world.ts。四个机位由 window.__c.setView(name) 切换。
 */

const D = Math.PI / 180;
const MODE = new URLSearchParams(location.search).get('m') ?? 'all';

const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.35, 12000);

// 天穹（同 world.ts 的暮色渐变）
{
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x1a2b52) }, uBot: { value: new THREE.Color(0xc07a48) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP;
      void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(uBot, uTop, pow(h, 0.85)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), domeMat);
  dome.frustumCulled = false;
  scene.add(dome);
}

// 光：天宫档低角度暖阳 + 冷天光
const sun = new THREE.DirectionalLight(0xffe2b8, 2.0);
sun.position.set(420, 320, 520);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -320; sun.shadow.camera.right = 320;
sun.shadow.camera.top = 320; sun.shadow.camera.bottom = -320;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 2400;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0x6f86bb, 0x3b2f2a, 1.0);
scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(amb);
const fill = new THREE.DirectionalLight(0x9fb4d8, 0.75);
fill.position.set(-520, 260, -420);
scene.add(fill);
scene.add(fill.target);

// 云海（接住水帘落点；探针里是一张软边平面，正式场景由 realm.ts 的云板承担）
{
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(256, 256, 20, 256, 256, 256);
  rg.addColorStop(0, 'rgba(206,220,238,0.92)');
  rg.addColorStop(0.5, 'rgba(168,186,214,0.8)');
  rg.addColorStop(1, 'rgba(120,138,168,0.0)');
  g.fillStyle = rg; g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(4200, 4200),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 194.2;
  sea.name = 'probeCloudSea';
  scene.add(sea);
}

const b = new Baker();
const t0 = performance.now();
if (MODE !== 'bells' && MODE !== 'water') {
  buildHeavenGallery(b, {
    cx: 0, cz: 0, y: 202, r: 660,
    a0: Math.PI / 2 - 23 * D, a1: Math.PI / 2 + 23 * D,
    width: 12, eaveH: 14,
    // ?m=old：按改造前的 ±23° + 旧预算 398k 原样建（浏览器里的同口径基线，用来算净增面数）
    ...(MODE === 'old' ? { minHalfSpanDeg: 0, maxTris: 398_000 } : {}),
  });
}
if (MODE !== 'gallery' && MODE !== 'bells' && MODE !== 'old') buildHeavenWater(b);
if (MODE !== 'gallery' && MODE !== 'water' && MODE !== 'old') buildHeavenBells(b);
const buildMs = Math.round(performance.now() - t0);

let flow: THREE.Group | null = null;
if (MODE !== 'bells' && MODE !== 'gallery') {
  flow = createHeavenWaterFlow();
  scene.add(flow);
  updateHeavenWaterFlow(7.5);
}

const pos = (t: number, o: number, yy: number): THREE.Vector3 =>
  new THREE.Vector3(Math.cos(t) * (660 + o), 202 + yy, Math.sin(t) * (660 + o));

// 水帘/龙首的机位（pre-scale 坐标）
const fallA = HEAVEN_WATER.fallAngles[0] * D;
const bastA = HEAVEN_WATER.bastionAngles[1] * D;
const P = (t: number, r: number, yy: number): THREE.Vector3 =>
  new THREE.Vector3(Math.cos(t) * r, yy, Math.sin(t) * r);

type View = { p: THREE.Vector3; l: THREE.Vector3; fov: number; up?: THREE.Vector3; exp?: number };

const VIEWS: Record<string, View> = {
  // ① 水帘正面（崖嘴 t=75°，外唇 728；机位在崖外 174m、抬到 246，把 60m 落差与两根龙柱一起收进来）
  fall: { p: P(fallA, 902, 247), l: P(fallA, 726, 205), fov: 48 },
  // ①b 水帘全景（斜看，能看到崖体与云线）
  fallWide: { p: P(fallA + 6.5 * D, 900, 250), l: P(fallA - 2 * D, 720, 202), fov: 55 },
  // ② 龙首吐水特写（t=65°，整颗头在台顶之上，仰视逆光）
  dragon: { p: P(bastA - 1.2 * D, 752, 223.5), l: P(bastA, 727, 228.0), fov: 40 },
  dragonWide: { p: P(bastA - 5 * D, 800, 232), l: P(bastA, 726, 212), fov: 52 },
  dFront: { p: P(bastA, 775, 219.5), l: P(bastA, 722, 219.0), fov: 34 },
  dTop: { p: P(bastA, 714, 320), l: P(bastA, 714, 205), fov: 46, up: new THREE.Vector3(-Math.sin(bastA), 0, Math.cos(bastA)) },
  // ③ 编钟阵列仰视：站在钟弧外侧 102m、抬到 208.6，仰看整排 14 口
  bells: { p: new THREE.Vector3(HEAVEN_BELLS.x + 102, 208.6, HEAVEN_BELLS.z), l: new THREE.Vector3(HEAVEN_BELLS.x + 24, 218.6, HEAVEN_BELLS.z), fov: 50 },
  bellsLow: { p: new THREE.Vector3(HEAVEN_BELLS.x + 84, 206.6, HEAVEN_BELLS.z + 26), l: new THREE.Vector3(HEAVEN_BELLS.x + 20, 217.6, HEAVEN_BELLS.z), fov: 56 },
  // 站在池心小台上仰看（下方水面与同心涟漪一起入画）
  bellsPool: { p: new THREE.Vector3(HEAVEN_BELLS.x, 209.2, HEAVEN_BELLS.z), l: new THREE.Vector3(HEAVEN_BELLS.x + 40, 219.6, HEAVEN_BELLS.z + 6), fov: 70 },
  // 3–4 口钟的特写（看龙纹与飘带）
  bellClose: { p: new THREE.Vector3(HEAVEN_BELLS.x + 30, 206.8, HEAVEN_BELLS.z + 40), l: new THREE.Vector3(HEAVEN_BELLS.x + 20, 219.5, HEAVEN_BELLS.z + 22), fov: 52 },
  bTop: { p: new THREE.Vector3(HEAVEN_BELLS.x, 320, HEAVEN_BELLS.z), l: new THREE.Vector3(HEAVEN_BELLS.x, 206, HEAVEN_BELLS.z), fov: 50, up: new THREE.Vector3(0, 0, -1) },
  // ④ 回廊 ±90°：高空 3/4，整条弧 + 柱列
  gallery: { p: new THREE.Vector3(0, 540, 1120), l: new THREE.Vector3(0, 205, 560), fov: 55 },
  galleryAir: { p: new THREE.Vector3(-420, 430, 980), l: new THREE.Vector3(0, 204, 520), fov: 58 },
  // 廊内平视（柱列不断沿弧延伸）
  corridor: { p: pos(150 * D, 3.0, 2.0), l: pos(96 * D, 0.4, 9.0), fov: 68 },
};

let lastMats: THREE.Material[] = [];

function setView(name: string): void {
  const v = VIEWS[name] ?? VIEWS.fall;
  camera.fov = v.fov;
  camera.position.copy(v.p);
  camera.up.copy(v.up ?? new THREE.Vector3(0, 1, 0));
  camera.lookAt(v.l);
  camera.updateProjectionMatrix();
  renderer.toneMappingExposure = v.exp ?? 1.08;
  // 阴影相机跟随视线中心
  sun.target.position.copy(v.l);
  const back = new THREE.Vector3().subVectors(v.p, v.l).normalize();
  sun.position.copy(v.l).addScaledVector(back, 380);
  sun.position.y += 320;
  sun.shadow.camera.updateProjectionMatrix();
  fill.target.position.copy(v.l);
  fill.position.copy(v.l).addScaledVector(back, 320);
  fill.position.y += 160;
  // 编钟机位在结构内部，天光调亮一点
  const inside = name.startsWith('bells') || name === 'corridor';
  hemi.intensity = inside ? 1.5 : 1.0;
  amb.intensity = inside ? 0.8 : 0.45;
  updateHeavenWaterFlow(7.5);
  renderer.render(scene, camera);
}

async function boot(): Promise<void> {
  const built = await b.build(scene);
  lastMats = Object.values(built);
  sfx();
  renderer.render(scene, camera);
  setView(MODE === 'bells' ? 'bells' : MODE === 'water' ? 'fall' : MODE === 'gallery' ? 'gallery' : 'fall');
  const info = renderer.info.render;
  let total = 0;
  const bs = b.stats();
  for (const g of Object.values(bs.groups)) total += g.triangles;
  hud.textContent =
    `bays=${heavenGalleryStats.bays} cols=${heavenGalleryStats.columns} span=${heavenGalleryStats.spanDeg.toFixed(0)}° ` +
    `arc=${heavenGalleryStats.arcLength.toFixed(0)}m tier=${heavenGalleryStats.tier} galleryTri=${Math.round(heavenGalleryStats.tris)}\n` +
    `falls=${heavenWaterStats.falls} fallW=${heavenWaterStats.fallWidth} drop=${heavenWaterStats.fallDrop.toFixed(1)} waterTri=${Math.round(heavenWaterStats.tris)} ` +
    `dragons=${heavenWaterStats.dragons}\n` +
    `bells=${heavenBellsStats.bells} mouth=${heavenBellsStats.mouthDia} bellsTri=${Math.round(heavenBellsStats.tris)} ` +
    `totalTri=${Math.round(total)} buildMs=${buildMs}`;
  (window as unknown as Record<string, unknown>).__c = {
    setView,
    views: Object.keys(VIEWS),
    stats: {
      gallery: { ...heavenGalleryStats },
      water: { ...heavenWaterStats },
      bells: { ...heavenBellsStats },
      totalTris: Math.round(total),
      buildMs,
    },
    draw: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    scene, camera, renderer, THREE,
  };
  (window as unknown as Record<string, unknown>).__cReady = true;
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  });
}

/** 探针专用：给水面/钟体补几盏暖光，避免无全局光照时全黑 */
function sfx(): void {
  const lights: [number, number, number, number][] = [
    [HEAVEN_BELLS.x, HEAVEN_BELLS.deckY + 16, HEAVEN_BELLS.z, 900],
    [HEAVEN_BELLS.x + 40, HEAVEN_BELLS.deckY + 12, HEAVEN_BELLS.z, 500],
    [0, 210, 660, 2600],
  ];
  for (const [x, y, z, i] of lights) {
    const pl = new THREE.PointLight(0xffd6a0, i, 260, 1.6);
    pl.position.set(x, y, z);
    scene.add(pl);
  }
}

boot().catch((e) => {
  hud.textContent = 'ERR ' + String((e as Error)?.stack ?? e);
  (window as unknown as Record<string, unknown>).__cError = String((e as Error)?.stack ?? e);
});
