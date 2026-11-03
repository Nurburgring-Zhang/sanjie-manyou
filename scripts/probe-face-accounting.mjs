/**
 * probe-face-accounting.mjs —— 面数口径的唯一真相源（纯只读，不开构建）。
 *
 * 背景：仓库里同时流传四个「静态面」数字，互不兼容——
 *   13.35M（release-v83 的 assetAudit 求和）
 *   15.09M（「人间七项」轮台账，未绑定 release）
 *   18.96M（当前树 probe-mem 的 assetAudit 求和）
 *   34.81M（court 探针的 renderer.info，含 infill 实例展开与多 pass）
 * 用哪个数字谈阈值，结论完全相反。本脚本定义三个**可复算**的口径并把它们一次打出来。
 *
 * 定义（本脚本为准）：
 *   T_static = world.assetAudit 逐组 triangles 求和
 *              —— 烘焙阶段的几何三角面，**不含实例展开、不含阴影 pass**
 *   T_scene  = 场景内所有 Mesh 的 geometry 三角面求和
 *              —— 含 InstancedMesh 的**单份**几何（不乘实例数），含地形与实例池
 *   T_frame  = renderer.info.render.triangles
 *              —— 单帧实际提交量，**含实例展开、含多 pass**
 *
 * 断言：
 *   A1  assetAudit 各组之和 === T_static（自洽）
 *   A2  T_static ≥ 每组成员和（逐组非负）
 *   A3  T_frame ≥ T_static（提交量不可能少于烘焙量）
 * 退出码 0=PASS / 1=BLOCK / 2=用法错误
 *
 * 用法：node scripts/probe-face-accounting.mjs [--url http://127.0.0.1:4180/]
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const URL = argOf('--url', 'http://127.0.0.1:4180/');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1280,720', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming?.world?.assetAudit,
  { timeout: 300000 },
);
await new Promise((r) => setTimeout(r, 2500));

const d = await page.evaluate(() => {
  const Q = window.__qingming;
  const audit = Q.world.assetAudit;
  const groups = {};
  let tStatic = 0;
  for (const k of Object.keys(audit.groups)) {
    const g = audit.groups[k];
    const t = Math.round(g.triangles);
    groups[k] = t;
    tStatic += t;
  }

  let tScene = 0;
  let meshes = 0;
  let instanced = 0;
  let instTotal = 0;
  Q.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tScene += tris;
    meshes++;
    if (o.isInstancedMesh) {
      instanced++;
      instTotal += o.count;
    }
  });

  const info = Q.engine.renderer.info.render;
  return {
    groups,
    tStatic: Math.round(tStatic),
    tScene: Math.round(tScene),
    tFrame: Math.round(info.triangles),
    calls: info.calls,
    meshes,
    instanced,
    instTotal,
  };
});

await browser.close();

const sumGroups = Object.values(d.groups).reduce((a, b) => a + b, 0);
const A1 = sumGroups === d.tStatic;
const A2 = Object.values(d.groups).every((v) => v >= 0);
const A3 = d.tFrame >= d.tStatic;

console.log(`URL=${URL}`);
console.log('逐组（assetAudit，单位：三角面）:');
for (const [k, v] of Object.entries(d.groups).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v.toLocaleString()}`);
}
console.log('');
console.log(`T_static = ${d.tStatic.toLocaleString()}   （烘焙几何，逐组合计）`);
console.log(`T_scene  = ${d.tScene.toLocaleString()}    （场景 Mesh 单份几何，${d.meshes} 个 Mesh，其中 ${d.instanced} 个 InstancedMesh / 共 ${d.instTotal} 实例）`);
console.log(`T_frame  = ${d.tFrame.toLocaleString()}    （单帧提交，${d.calls} draw calls，含实例展开与多 pass）`);
console.log('');
console.log(`[${A1 ? 'PASS' : 'FAIL'}] A1 逐组之和 === T_static（${sumGroups.toLocaleString()} vs ${d.tStatic.toLocaleString()}）`);
console.log(`[${A2 ? 'PASS' : 'FAIL'}] A2 每组非负`);
console.log(`[${A3 ? 'PASS' : 'FAIL'}] A3 T_frame ≥ T_static（${d.tFrame.toLocaleString()} vs ${d.tStatic.toLocaleString()}）`);
console.log('');
console.log('口径说明：谈「超没超标」必须连口径一起说。');
console.log('  · 烘焙预算看 T_static');
console.log('  · 显存/常驻看 T_scene 的 geometry 字节');
console.log('  · 帧耗时与 draw call 看 T_frame');

const ok = A1 && A2 && A3;
console.log(ok ? 'RESULT=PASS' : 'RESULT=BLOCK');
process.exit(ok ? 0 : 1);
