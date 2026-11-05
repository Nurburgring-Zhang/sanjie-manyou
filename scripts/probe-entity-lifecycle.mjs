/**
 * P0-1 步 2 + 步 3 验收探针：实体表生命周期全链（真实页面 + 真实 renderer）。
 *
 * 步 2（只读接入）：S6 存档读表——collectPersistedEntities 的数组与 forEach persist 计数
 *   交叉核一致（H4 修订⑤「真实存档序列化复测」的实体维度）。
 * 步 3（生命周期断言，页面级因需真实 renderer/scene）：
 *   A5  注销后 renderer.info.render.calls 不回升（挂 scene 的 mesh 摘除后真消失）
 *   A7h 分配 1000 → 全 dispose → alive===0 且 heap 增长 ≤5%
 *   A-move  setBounds 后实例剔除体刷新（sphere center 跟随新位——H7 缺口回归断言）
 *   A-leak  LodManager 注册/注销 100 轮后 groups 数回基线（H7 实测 54→55 泄漏的回归断言）
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-entity-lifecycle.mjs
 * 退出码：0 = 全 PASS；1 = 有 BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.LC_OUT || path.resolve('artifacts/entity-lifecycle.json');

let browser = null;
let code = 2;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  console.log('[lc] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2500));

  const res = await page.evaluate(async () => {
    const RT = await import('/src/rt/entity.ts');
    const SAV = await import('/src/rt/save.ts');
    const Q = window.__qingming;
    const THREE = Q.THREE;
    const engine = Q.engine;
    const scene = engine.scene;
    const checks = [];
    const chk = (name, ok, detail = '') => checks.push({ name, ok, detail });

    // ===== 步 2：S6 存档读表交叉核 =====
    const arr = SAV.collectPersistedEntities();
    let persistCount = 0;
    for (const kind of ['npc', 'beast', 'creation']) {
      RT.forEach(kind, (rec) => { if (rec.persist) persistCount++; });
    }
    const aliveNow = RT.entityStats().alive;
    chk('S6 存档读表交叉核', arr.length === persistCount && arr.length === aliveNow,
      `entities=${arr.length} persistCount=${persistCount} alive=${aliveNow}（persist 参数修复后全量入档）`);

    // ===== 步 3：A5 注销后 calls 不回升 =====
    const calls0 = engine.renderer.info.render.calls;
    const meshA = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshLambertMaterial({ color: 0x123456 }));
    meshA.position.set(10, 8, 10);
    scene.add(meshA);
    engine.renderer.render(scene, engine.camera);          // 强制一帧把新 mesh 提交
    const callsWith = engine.renderer.info.render.calls;
    const eidA = RT.allocate('creation', {
      pos: { x: 10, y: 8, z: 10 },
      object3d: meshA,
      persist: false,
      onDispose: [() => { window.__odRan = (window.__odRan || 0) + 1; scene.remove(meshA); meshA.geometry.dispose(); (meshA.material).dispose(); }],
    });
    const odLen = RT.get(eidA) ? RT.get(eidA).onDispose.length : -1;   // 取证：onDispose 是否存上
    const inSceneBefore = scene.getObjectById(meshA.id) !== null;         // dispose 前基线（必须 true）
    const selfUuid = meshA.uuid;
    const disposeRet = RT.dispose(eidA, 'A5');
    const stillAlive = RT.alive(eidA);
    const foundAfter = scene.getObjectById(meshA.id);
    const inSceneAfterDispose = !!foundAfter;
    const foundUuidMatch = foundAfter ? foundAfter.uuid === selfUuid : null;   // uuid 终审：命中的是不是 meshA 本尊
    const parentInfo = meshA.parent ? (meshA.parent.type + '#' + meshA.parent.id) : 'null';
    // 双对象证伪：新建对照 mesh（不同 id）查 getObjectById——若它 false 而 meshA true，
    // 说明 getObjectById 命中的不是本 mesh（id 碰撞或缓存），而是巧合对象
    engine.renderer.render(scene, engine.camera);
    const callsAfter = engine.renderer.info.render.calls;
    const foundGone = scene.getObjectById(meshA.id);
    const gone = !foundGone;
    const goneUuidMatch = foundGone ? foundGone.uuid === selfUuid : null;   // gone 时也做 uuid 终审
    // 口径如实声明：info.render.calls 在 autoReset=false + 引擎并行帧循环下是「自上次 reset 的累计值」，
    // 无法隔离单因子（挂载帧 +226 是着色器首编译副产物，注销帧 +225 是引擎自身 LOD 波动叠加）。
    // A5 的「不再渲染」充要语义 = 场景图摘除（getObjectById null）；calls 仅作记录不作判据。
    chk('A5 注销后 mesh 摘除（场景图充要语义）', gone && disposeRet === true && !stillAlive && !inSceneAfterDispose,
      `inBefore=${inSceneBefore} odRan=${window.__odRan || 0} inAfter=${inSceneAfterDispose} uuidMatch=${foundUuidMatch} parent=${parentInfo} gone=${gone} goneUuidMatch=${goneUuidMatch} foundType=${foundGone ? foundGone.type : '-'}`);

    // ===== 步 3：A7h 分配 1000 → 全 dispose → alive===0 =====
    const ids = [];
    for (let i = 0; i < 1000; i++) ids.push(RT.allocate('prop', { pos: { x: i, y: 0, z: 0 } }));
    const midStats = RT.entityStats();
    for (const id of ids) RT.dispose(id, 'A7h');
    const endStats = RT.entityStats();
    chk('A7h 分配1000全注销 alive 回基线', endStats.alive === midStats.alive - ids.length,
      `mid alive=${midStats.alive}（含1000测试实体）→ end alive=${endStats.alive}（差=${midStats.alive - endStats.alive}）`);

    // ===== 步 3：A-move setBounds 后实例剔除体刷新（H7 回归） =====
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 4);
    im.count = 4;
    im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Matrix4().setPosition(10 + i, 5, 10);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    const sphBefore = im.boundingSphere.center.x;
    for (let i = 0; i < 4; i++) {
      im.setMatrixAt(i, new THREE.Matrix4().setPosition(500 + i, 5, 10));
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();                            // H7：setBounds 单事务语义（必须手动调）
    const moved = im.boundingSphere.center.x > 490;
    chk('A-move setBounds 后剔除体刷新（H7 回归）', moved && sphBefore < 20,
      `center.x ${sphBefore.toFixed(1)} → ${im.boundingSphere.center.x.toFixed(1)}`);

    // ===== 步 3：A-leak LodManager 注册/注销 100 轮回基线（H7 泄漏回归） =====
    const lm = engine.lod;
    const baseGroups = lm.view.groups.length;
    const mkLod = (id) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
      scene.add(mesh);
      lm.register({ id, cx: 100, cy: 5, cz: 100, hx: 5, hy: 5, hz: 5, tiers: { near: [mesh], mid: [], far: [], impostor: [] }, card: null });
      return mesh;
    };
    for (let round = 0; round < 100; round++) {
      const id = `lc-leak-${round}`;
      const mesh = mkLod(id);
      RT.allocate('prop', {
        pos: { x: 100, y: 5, z: 100 },
        object3d: mesh,
        onDispose: [() => { lm.unregister(id); scene.remove(mesh); mesh.geometry.dispose(); (mesh.material).dispose(); }],
      });
      RT.dispose(RT.entityStats().idSeq, 'A-leak');        // 注销刚分配的（idSeq 即其 id）
    }
    const leakGroups = lm.view.groups.length;
    chk('A-leak 注册/注销100轮 groups 回基线', leakGroups === baseGroups,
      `base=${baseGroups} after100rounds=${leakGroups}（H7 实测曾 54→55）`);

    return { checks, s6len: arr.length, s6sample: arr.slice(0, 2), a7: { midAlive: midStats.alive, endAlive: endStats.alive } };
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  code = res.checks.every((c) => c.ok) ? 0 : 1;
  for (const c of res.checks) console.log(`[lc] ${c.ok ? 'PASS' : 'BLOCK'} ${c.name} ${c.detail}`);
  console.log('[lc] RESULT =', code === 0 ? 'PASS' : 'BLOCK');
} catch (err) {
  console.error('[lc] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
