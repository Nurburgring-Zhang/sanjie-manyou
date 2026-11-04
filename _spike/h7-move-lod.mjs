/**
 * H7 spike：移动造物——setBounds 后 LOD 是否跟得住（-1 风险验证最后一项）。
 *
 * 回答的问题（docs/重建-v2/全量工作清单.md H7 行）：
 *   造物被移动（position / instanceMatrix / setBoundingBox）后，
 *   LOD 判定、阴影、合批/实例化路径是否正确跟随；若烘焙路径跟不住，
 *   P0-6（unregister/register 摘挂）的范围要不要扩大。
 *
 * 三组实验，各采 30 帧真实数据（dev 服务器 http://127.0.0.1:4182/）：
 *   a. 实例化路径：InstancedMesh 注册进 engine.lod → 改 instanceMatrix 移动 50m
 *      → 记录 LOD 距离档是否跟住 / draw calls 增量 / 帧耗时 / 剔除体是否陈旧
 *   b. 独立 mesh 路径：scene.add 独立 mesh → setPosition 移动
 *      → 同上记录 + frustum culling 是否正确（移出视锥后 calls 回落）
 *   c. 烘焙路径反证：bake 后顶点已合并（bake.ts:810 push 时 applyMatrix4 烘死变换）
 *      → 页面内枚举 city_* 批次 + 移动整批验证「只有整批粒度、没有单件身份」
 *
 * 纪律：只读 src（本文件不 import 任何 src 模块）；页面内用 window.__qingming
 * 暴露的 THREE/runtime 构造测试件；不动 src/、不 git、不构建。
 * CHROME 解析照抄 scripts/probe-frame-pacing.mjs（../scripts/chromePath.mjs）。
 *
 * 用法：node _spike/h7-move-lod.mjs
 * 输出：_spike/h7-move-lod.json；退出码 0=采样完成 / 1=环境或页面失败（FAILED 如实落盘）。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from '../scripts/chromePath.mjs';

const URL = process.env.H7_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.H7_OUT || path.resolve('_spike/h7-move-lod.json');
const FRAMES = 30; // 任务要求的每实验采样帧数

const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageErrors = [];
let browser = null;
let code = 1;
const result = {
  generatedAt: new Date().toISOString(),
  url: URL,
  chrome: CHROME,
  status: 'RUNNING',
  meta: null,
  baseline: null,
  expA_instanced: null,
  expB_independent: null,
  expC_baked: null,
  pageErrors,
};

function summarize(frames) {
  const calls = frames.map((f) => f.calls);
  const ms = frames.map((f) => f.ms).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))] : 0);
  return {
    n: frames.length,
    callsMin: Math.min(...calls),
    callsMax: Math.max(...calls),
    callsMean: +(calls.reduce((a, b) => a + b, 0) / calls.length).toFixed(1),
    frameMsP50: +q(ms, 0.5).toFixed(1),
    frameMsP95: +q(ms, 0.95).toFixed(1),
    frameMsMax: +(ms.length ? ms[ms.length - 1] : 0).toFixed(1),
  };
}

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
    protocolTimeout: 420000,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') pageErrors.push('console.error: ' + t.slice(0, 300));
    if (t.includes('静态合批')) pageErrors.push('console.log(合批): ' + t.slice(0, 200)); // compactStatic 的实测行，顺路取证
  });
  await page.setViewport(VIEWPORT);
  page.setDefaultTimeout(300000);

  console.log('[h7] goto', URL);
  const tGoto = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 300000 });
  console.log(`[h7] loaded in ${((Date.now() - tGoto) / 1000).toFixed(1)}s`);
  await sleep(3000); // LOD 首落档 / crowd 铺开 / 着色器首编译
  // 停掉开场运镜：cinema 相机每帧移动会让全城视锥剔除随之抖动（首跑实测基线 calls 240↔378，
  // 单个测试件的 ±1 call 信号完全被淹没）。切 fly 模式且无输入 ⇒ 相机静止，基线才可比。
  await page.evaluate(() => {
    const e = window.__qingming.engine;
    if (e.camMode === 'cinema' || e.cinemaActive) e.stopCinema('fly');
  });
  await sleep(2500); // 相机跳变后的 LOD 重落档 / crowd 重排过渡

  // ---------- 0. 元信息 ----------
  result.meta = await page.evaluate(() => {
    const Q = window.__qingming;
    const e = Q.engine;
    const gl = e.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const cam = e.camera;
    const dir = cam.getWorldDirection(new Q.THREE.Vector3());
    return {
      backend: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      quality: { name: e.quality.name, pixelRatio: e.renderer.getPixelRatio() },
      shadowMapEnabled: e.renderer.shadowMap.enabled,
      cameraPos: cam.position.toArray().map((v) => +v.toFixed(2)),
      cameraDir: dir.toArray().map((v) => +v.toFixed(3)),
      lodGroups: e.lod.view.groups.length,
      threeRevision: Q.THREE.REVISION,
    };
  });
  console.log('[h7] backend:', result.meta.backend, '| shadowMap:', result.meta.shadowMapEnabled, '| lodGroups:', result.meta.lodGroups);

  // ---------- 1. 基线 30 帧 ----------
  const sample = (n) => page.evaluate((frames) => new Promise((resolve) => {
    const out = [];
    const tick = () => {
      const e = window.__qingming.engine;
      const fm = e.frameMs;
      out.push({ calls: e.renderer.info.render.calls, ms: fm.length ? +fm[fm.length - 1].toFixed(2) : null });
      if (out.length >= frames) return resolve(out);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), n);
  result.baseline = { frames: await sample(FRAMES) };
  result.baseline.summary = summarize(result.baseline.frames);
  result.baseline.stable = result.baseline.summary.callsMax - result.baseline.summary.callsMin <= 1;
  const baseCalls = result.baseline.summary.callsMean;
  const baseCallsMax = result.baseline.summary.callsMax;
  console.log('[h7] baseline calls≈', result.baseline.summary.callsMin, '-', result.baseline.summary.callsMax);

  // ---------- 实验工具：页面内公共状态 ----------
  await page.evaluate(() => {
    const Q = window.__qingming;
    window.__h7 = { Q, stubs: [] };
    // 造物测试几何：优先克隆场景内已有小几何（不 import src），否则退回 THREE 原始几何。
    // 必须带包围球半径上限：首跑克隆到一个 46km 半径的远景剪影几何，剔除实验全被它的巨型包围球淹没。
    let geo = null;
    let srcName = 'THREE.BoxGeometry(fallback)';
    const stack = [Q.scene];
    while (stack.length) {
      const o = stack.pop();
      if (!o || !o.children) continue;
      for (const c of o.children) {
        if (c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.position) {
          const n = c.geometry.attributes.position.count;
          if (n >= 24 && n <= 5000) {
            const cand = c.geometry.clone();
            if (cand.boundingSphere === null) cand.computeBoundingSphere();
            if (cand.boundingSphere.radius <= 60) { geo = cand; srcName = c.name || c.type; break; }
          }
        }
        if (c.children) stack.push(c);
      }
      if (geo) break;
    }
    if (!geo) geo = new Q.THREE.BoxGeometry(2, 3, 2);
    window.__h7.geo = geo;
    window.__h7.geoSrc = srcName;
    window.__h7.tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  });
  console.log('[h7] test geometry cloned from:', (await page.evaluate(() => window.__h7.geoSrc)), 'tris≈', await page.evaluate(() => Math.round(window.__h7.tris)));

  // ---------- 实验 a：实例化路径 ----------
  {
    const a1snap = await page.evaluate((reg) => {
      const { Q, geo } = window.__h7;
      const T = Q.THREE;
      const e = Q.engine;
      const cam = e.camera;
      const dir = cam.getWorldDirection(new T.Vector3());
      const center = cam.position.clone().add(dir.clone().multiplyScalar(30)); // 相机前 30m
      const right = new T.Vector3().crossVectors(dir, new T.Vector3(0, 1, 0)).normalize();
      const mat = new T.MeshLambertMaterial({ color: 0xff9944 });
      const inst = new T.InstancedMesh(geo, mat, reg.n);
      inst.castShadow = true;
      inst.frustumCulled = true; // 默认；剔除体是否跟 instanceMatrix 是本实验要点
      const m = new T.Matrix4();
      for (let i = 0; i < reg.n; i++) {
        const p = center.clone().add(right.clone().multiplyScalar((i % 8) * 2.2)).add(new T.Vector3(0, Math.floor(i / 8) * 2.2, 0));
        m.makeTranslation(p.x, p.y, p.z);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      Q.scene.add(inst);
      e.lod.register({
        id: 'h7_inst_a', cx: center.x, cy: center.y, cz: center.z, hx: 12, hy: 12, hz: 12,
        tiers: { near: [inst], mid: [], far: [], impostor: [] }, card: null,
      });
      window.__h7.inst = inst;
      window.__h7.center = center.toArray();
      window.__h7.right = right.toArray();
      return { center: center.toArray() };
    }, { n: 64 });
    await sleep(400);
    const a1 = { frames: await sample(FRAMES) };
    a1.summary = summarize(a1.frames);
    // 组快照在 LOD update 跑稳之后取（tier=-1 是首帧前的暂态）
    a1.groupAfterRegister = await page.evaluate(() => {
      const g = window.__qingming.engine.lod.view.groups.find((x) => x.id === 'h7_inst_a');
      return { tier: g.tier, want: g.want, dist: g.dist, visible: g.visible };
    });
    a1.callsDeltaVsBaseline = +(a1.summary.callsMean - baseCalls).toFixed(1);
    console.log('[h7] A1 add+register: callsΔ≈', a1.callsDeltaVsBaseline, 'group:', JSON.stringify(a1.groupAfterRegister));

    // A2：单个实例沿相机右向移动 50m（不重算包围球、不更新任何注册数据）
    const a2movedTo = await page.evaluate(() => {
      const { Q, inst, center, right } = window.__h7;
      const T = Q.THREE;
      const dst = new T.Vector3(center[0], center[1], center[2]).add(new T.Vector3(right[0], right[1], right[2]).multiplyScalar(50));
      const m = new T.Matrix4().makeTranslation(dst.x, dst.y, dst.z);
      inst.setMatrixAt(0, m);
      inst.instanceMatrix.needsUpdate = true;
      return dst.toArray();
    });
    const a2 = { frames: await sample(FRAMES) };
    a2.summary = summarize(a2.frames);
    a2.movedInstance = { by: 'instanceMatrix +50m along camera-right', to: a2movedTo };
    a2.groupAfterMove = await page.evaluate(() => {
      const g = window.__qingming.engine.lod.view.groups.find((x) => x.id === 'h7_inst_a');
      return { tier: g.tier, want: g.want, dist: g.dist, visible: g.visible };
    });
    a2.callsDeltaVsBaseline = +(a2.summary.callsMean - baseCalls).toFixed(1);
    // 关键判读：快照逐值一致 = LOD 距离档完全没有跟 instanceMatrix 移动（组的 bounds 是注册时拷贝的静态值）
    a2.lodTierUnchangedAfterMove = JSON.stringify(a2.groupAfterMove) === JSON.stringify(a1.groupAfterRegister);
    a2.interpretation = a2.lodTierUnchangedAfterMove
      ? 'LOD 组的 tier/want/dist 与移动前逐值一致 → 注册时拷贝的静态包围盒不跟 instanceMatrix（P0-6 setBounds 缺口的直接证据）'
      : '组档位随移动发生了变化';
    console.log('[h7] A2 move 1 instance 50m: callsΔ≈', a2.callsDeltaVsBaseline, 'group:', JSON.stringify(a2.groupAfterMove), 'tierUnchanged:', a2.lodTierUnchangedAfterMove);

    // A3：全部 64 实例移到相机背后（出视锥）——剔除体（boundingSphere）是否陈旧
    const a3snap = await page.evaluate(() => {
      const { Q, inst, right } = window.__h7;
      const T = Q.THREE;
      const e = Q.engine;
      const cam = e.camera;
      const back = cam.position.clone().sub(cam.getWorldDirection(new T.Vector3()).multiplyScalar(40));
      const m = new T.Matrix4();
      for (let i = 0; i < inst.count; i++) {
        const p = back.clone().add(new T.Vector3(right[0], right[1], right[2]).multiplyScalar((i % 8) * 2.2));
        m.makeTranslation(p.x, p.y, p.z);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      const bs0 = inst.boundingSphere ? { c: inst.boundingSphere.center.toArray(), r: +inst.boundingSphere.radius.toFixed(1) } : null;
      return { sphereBeforeRecompute: bs0 };
    });
    const a3 = { frames: await sample(FRAMES) };
    a3.summary = summarize(a3.frames);
    a3.sphereBeforeRecompute = a3snap.sphereBeforeRecompute;
    a3.callsDeltaVsBaseline = +(a3.summary.callsMean - baseCalls).toFixed(1);
    a3.culledAfterMoveAllOut = a3.summary.callsMin < a1.summary.callsMin; // 期望 false：陈旧剔除体不回落
    console.log('[h7] A3 all instances behind camera: callsΔ≈', a3.callsDeltaVsBaseline, 'culled?', a3.culledAfterMoveAllOut, 'staleSphere:', JSON.stringify(a3snap.sphereBeforeRecompute));

    // A3b：手动 computeBoundingSphere()（= P0-6 setBounds 要补的动作）后 calls 是否回落 + 计价
    const a3b = await page.evaluate(async (frames) => {
      const { Q, inst } = window.__h7;
      const t0 = performance.now();
      inst.computeBoundingSphere();
      const sphereMs = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(r));
      const out = [];
      const tick = () => {
        const e = Q.engine;
        out.push({ calls: e.renderer.info.render.calls, ms: e.frameMs.length ? e.frameMs[e.frameMs.length - 1] : null });
        if (out.length >= frames) return resolve2(out);
        requestAnimationFrame(tick);
      };
      let resolve2;
      return await new Promise((res) => { resolve2 = res; requestAnimationFrame(tick); }).then((frames2) => ({
        sphereMs: +sphereMs.toFixed(3),
        sphereRadius: +inst.boundingSphere.radius.toFixed(1),
        frames: frames2,
      }));
    }, 10);
    a3.afterComputeBoundingSphere = {
      sphereMs: a3b.sphereMs,
      sphereRadius: a3b.sphereRadius,
      summary: summarize(a3b.frames),
      callsDeltaVsBaseline: +(summarize(a3b.frames).callsMean - baseCalls).toFixed(1),
    };
    console.log('[h7] A3b computeBoundingSphere:', a3b.sphereMs, 'ms → callsΔ≈', a3.afterComputeBoundingSphere.callsDeltaVsBaseline);

    // A3c：crowd 规模（4096 实例）的 computeBoundingSphere 计价（P0-6 预算输入）
    a3.boundingSphereCost4096 = await page.evaluate(() => {
      const { Q, geo } = window.__h7;
      const T = Q.THREE;
      const inst = new T.InstancedMesh(geo, new T.MeshBasicMaterial(), 4096);
      const m = new T.Matrix4();
      for (let i = 0; i < 4096; i++) { m.makeTranslation(i * 0.5, 0, 0); inst.setMatrixAt(i, m); }
      inst.computeBoundingSphere(); // 预热 JIT
      const t0 = performance.now();
      for (let i = 0; i < 4096; i++) { m.makeTranslation(i * 0.5 + 1, 0, 0); inst.setMatrixAt(i, m); }
      const writeMs = performance.now() - t0;
      const t1 = performance.now();
      inst.computeBoundingSphere();
      const sphMs = performance.now() - t1;
      inst.dispose();
      return { matrixWrite4096Ms: +writeMs.toFixed(2), computeBoundingSphere4096Ms: +sphMs.toFixed(2) };
    });
    console.log('[h7] A3c 4096-instance costs:', JSON.stringify(a3.boundingSphereCost4096));

    // 清理 a：验证注销后 calls 回落（P0-1 A5 的同族证据）+ lod 组是否泄漏（无 unregister）
    const cleanupA = await page.evaluate(() => {
      const { Q, inst } = window.__h7;
      Q.scene.remove(inst);
      inst.dispose();
      return { groupsAfterRemove: Q.engine.lod.view.groups.length };
    });
    await sleep(600);
    const recovA = summarize(await sample(10));
    const cleanupARec = { groupsAfterRemove: cleanupA.groupsAfterRemove, recoveryCallsMean: recovA.callsMean, baselineCallsMax: baseCallsMax, callsBackToBaseline: recovA.callsMean <= baseCallsMax + 0.5 };
    const groupLeakConfirmed = cleanupA.groupsAfterRemove === result.meta.lodGroups + 1; // 无 unregister → 组泄漏
    console.log('[h7] cleanup A: recovery calls≈', recovA.callsMean, 'groups:', cleanupA.groupsAfterRemove, '(leak:', groupLeakConfirmed, ')');

    result.expA_instanced = {
      instanceCount: 64,
      geometrySrc: await page.evaluate(() => window.__h7.geoSrc),
      register: a1, moveInstance50m: a2, moveAllBehindCamera: a3,
      cleanup: cleanupARec, groupLeakConfirmed,
    };
  }

  // ---------- 实验 b：独立 mesh 路径 ----------
  {
    const b1snap = await page.evaluate(() => {
      const { Q, geo } = window.__h7;
      const T = Q.THREE;
      const cam = Q.engine.camera;
      const dir = cam.getWorldDirection(new T.Vector3());
      const p = cam.position.clone().add(dir.clone().multiplyScalar(30));
      const mesh = new T.Mesh(geo.clone(), new T.MeshLambertMaterial({ color: 0x44aaff }));
      mesh.name = 'h7_indep_b';
      mesh.castShadow = false;
      mesh.position.copy(p);
      Q.scene.add(mesh);
      window.__h7.meshB = mesh;
      window.__h7.posB = p.clone();
      return { at: p.toArray() };
    });
    await sleep(400);
    const b1 = { frames: await sample(FRAMES) };
    b1.summary = summarize(b1.frames);
    b1.callsDeltaVsBaseline = +(b1.summary.callsMean - baseCalls).toFixed(1);
    b1.addedAt = b1snap.at;
    console.log('[h7] B1 independent mesh in view: callsΔ≈', b1.callsDeltaVsBaseline);

    // B2：setPosition +50m（相机右向；30m 深度处半视宽 ~28m → 出视锥）
    await page.evaluate(() => {
      const { Q, meshB, posB } = window.__h7;
      const T = Q.THREE;
      const cam = Q.engine.camera;
      const dir = cam.getWorldDirection(new T.Vector3());
      const right = new T.Vector3().crossVectors(dir, new T.Vector3(0, 1, 0)).normalize();
      meshB.position.copy(posB.clone().add(right.multiplyScalar(50)));
    });
    const b2 = { frames: await sample(FRAMES) };
    b2.summary = summarize(b2.frames);
    b2.callsDeltaVsBaseline = +(b2.summary.callsMean - baseCalls).toFixed(1);
    b2.frustumCullingFollowed = b2.summary.callsMax <= baseCallsMax + 0.5; // 期望 true：calls 回落到基线
    console.log('[h7] B2 move 50m out of frustum: callsΔ≈', b2.callsDeltaVsBaseline, 'cullingFollowed:', b2.frustumCullingFollowed);

    // B3：回到视锥内 + castShadow=true（阴影跟随验证）
    await page.evaluate(() => {
      const { Q, meshB, posB } = window.__h7;
      meshB.position.copy(posB);
      meshB.castShadow = true;
    });
    const b3 = { frames: await sample(FRAMES) };
    b3.summary = summarize(b3.frames);
    b3.callsDeltaVsBaseline = +(b3.summary.callsMean - baseCalls).toFixed(1);
    b3.shadowCallsDelta = +(b3.summary.callsMean - b1.summary.callsMean).toFixed(1);
    console.log('[h7] B3 back in view + castShadow: callsΔ≈', b3.callsDeltaVsBaseline, '(shadowΔ≈', b3.shadowCallsDelta, ')');

    // B4：移到 2000m 外仍在视锥方向（无注册 → 无距离 LOD，visible 恒 true）
    await page.evaluate(() => {
      const { Q, meshB, posB } = window.__h7;
      const T = Q.THREE;
      const cam = Q.engine.camera;
      const dir = cam.getWorldDirection(new T.Vector3());
      meshB.position.copy(cam.position.clone().add(dir.multiplyScalar(2000)));
      meshB.castShadow = false;
    });
    const b4 = { frames: await sample(FRAMES) };
    b4.summary = summarize(b4.frames);
    b4.callsDeltaVsBaseline = +(b4.summary.callsMean - baseCalls).toFixed(1);
    b4.note = '2000m 仍在视锥内 → 无 LOD 注册的独立 mesh 不会被距离降档，只要在视锥就照样提交';
    console.log('[h7] B4 2000m away in frustum: callsΔ≈', b4.callsDeltaVsBaseline);

    // 清理 b
    await page.evaluate(() => {
      const { Q, meshB } = window.__h7;
      Q.scene.remove(meshB);
      meshB.geometry.dispose();
      meshB.material.dispose();
    });
    await sleep(600);
    const recovB = summarize(await sample(10));
    result.expB_independent = {
      addInView: b1, move50mOutOfFrustum: b2, backInViewWithShadow: b3, far2000mNoLod: b4,
      cleanup: { recoveryCallsMean: recovB.callsMean, baselineCallsMax: baseCallsMax, callsBackToBaseline: recovB.callsMean <= baseCallsMax + 0.5 },
    };
    console.log('[h7] cleanup B: recovery calls≈', recovB.callsMean);
  }

  // ---------- 实验 c：烘焙路径反证（读代码结论 + 页面内一次验证） ----------
  {
    result.expC_baked = await page.evaluate(async () => {
      const Q = window.__qingming;
      const T = Q.THREE;
      const cityMeshes = [];
      Q.scene.traverse((o) => { if (o.isMesh && typeof o.name === 'string' && o.name.startsWith('city_')) cityMeshes.push(o); });
      const perMesh = cityMeshes.map((m) => ({ name: m.name, verts: m.geometry.attributes.position.count, matrixAutoUpdate: m.matrixAutoUpdate }));
      perMesh.sort((x, y) => x.verts - y.verts);
      const smallest = perMesh[0];
      const totalVerts = perMesh.reduce((a, b) => a + b.verts, 0);
      // 验证性移动：把最小批次整体挪 50m——证明「可移动的最小单位是整批材质批次」
      const m = cityMeshes.find((x) => x.name === smallest.name);
      const old = m.position.clone();
      const e = Q.engine;
      const before = [];
      const tick = () => before.push(e.renderer.info.render.calls);
      requestAnimationFrame(tick);
      await new Promise((r) => requestAnimationFrame(r));
      m.position.set(old.x + 50, old.y, old.z);
      m.updateMatrix();
      m.matrixWorldNeedsUpdate = true;
      const e2 = Q.engine;
      const bb = m.geometry.boundingBox ? {
        span: m.geometry.boundingBox.max.clone().sub(m.geometry.boundingBox.min).toArray().map((v) => +v.toFixed(0)),
      } : null;
      const after = [];
      const tick2 = () => after.push(e2.renderer.info.render.calls);
      requestAnimationFrame(tick2);
      await new Promise((r) => requestAnimationFrame(r));
      // 还原
      m.position.copy(old);
      m.updateMatrix();
      m.matrixWorldNeedsUpdate = true;
      return {
        cityMeshCount: cityMeshes.length,
        totalVerts,
        smallestBatch: { ...smallest, boundingBoxSpan: bb ? bb.span : null },
        largestBatch: perMesh[perMesh.length - 1],
        perMeshTop5Smallest: perMesh.slice(0, 5),
        wholeBatchMove: { callsBefore: before, callsAfterMoving50m: after, granularity: '整批（单件无身份，bake.ts push 时 applyMatrix4 已把变换烘进顶点）' },
      };
    });
    console.log('[h7] C baked: city_* meshes =', result.expC_baked.cityMeshCount, 'totalVerts =', result.expC_baked.totalVerts,
      'smallest batch =', result.expC_baked.smallestBatch.name, result.expC_baked.smallestBatch.verts, 'verts');
  }

  result.status = 'OK';
  result.verdict = {
    instancedPath: {
      lodTierFollowsInstanceMatrix: result.expA_instanced.moveInstance50m.lodTierUnchangedAfterMove === false,
      drawCallsConstantPerBatch: true,
      frustumCulledAfterMoveAllOut: result.expA_instanced.moveAllBehindCamera.culledAfterMoveAllOut,
      needsManualComputeBoundingSphere: !result.expA_instanced.moveAllBehindCamera.culledAfterMoveAllOut,
      groupLeakNoUnregister: result.expA_instanced.groupLeakConfirmed,
    },
    independentPath: {
      frustumCullingFollowed: result.expB_independent.move50mOutOfFrustum.frustumCullingFollowed,
      shadowFollows: result.expB_independent.backInViewWithShadow.shadowCallsDelta > 0.4,
      distanceLodWithoutRegistration: false,
    },
    bakedPath: {
      movableGranularity: 'whole material batch only',
      singleCreationMovable: false,
    },
  };
  code = 0;
  console.log('[h7] DONE →', OUT);
} catch (err) {
  result.status = 'FAILED';
  result.error = String(err && err.stack ? err.stack : err).slice(0, 1200);
  console.error('[h7] FAILED:', String(err).slice(0, 400));
  code = 1;
} finally {
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
    console.log('[h7] 写出 →', OUT, '| status =', result.status);
  } catch (e2) {
    console.error('[h7] 写出失败:', e2);
    code = 1;
  }
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
