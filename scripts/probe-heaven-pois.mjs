/**
 * 天宫 POI 传送点落位机检。
 *
 * 判据（每条 POI 三项全过才算 PASS）：
 *   ① 世界坐标 = heavenPoint(缩放前 x,y,z)：|y − heavenY(preY)| ≤ 1，|x − preX×2.2| ≤ 1，|z − preZ×2.2| ≤ 1
 *   ② 向下射线落脚高差 ≤ 1m            —— 不许悬空（凌霄殿旧账：悬空 130m），也不许埋进台基
 *   ③ POI 到该 host 落脚面的距离 ≤ 3m   —— 射线命中点与 POI 的 3D 距离
 *   ④ 传送机位不得二次抬升              —— world.teleport 后 |相机y − POI y| ≤ 60（二次抬升会是 +1935）
 *
 * 读点：`/src/city/layout.ts` 的 POIS 模块单例（Vite dev 直接服务 TS，动态 import 拿到的是
 * 应用同一个实例，world.ts / palace.ts 的运行时覆写都可见），换算基准取 `/src/sky/heavenFrame.ts`。
 *
 * 用法：
 *   node scripts/probe-heaven-pois.mjs            # 判定，退出码 0 = PASS / 1 = BLOCK
 *   node scripts/probe-heaven-pois.mjs --dump     # 只打印每个 POI 的原始射线命中，不判定
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
const DUMP = process.argv.includes('--dump');

/**
 * 缩放前（烘焙）口径的天宫 POI 台账 —— 探针侧独立抄一份，防止「改了 layout 又改探针」自证。
 * owner 指出该点最终由谁写回：layout = 本文件；world = world.ts（不属本文件权限）。
 * groundTol：落脚高差上限（默认 1m）。凌霄殿是唯一例外，见 note。
 */
const EXPECT = {
  nantianmen: { pre: [0, 203.12, -80], host: 'gate', owner: 'layout' },
  lingxiao: {
    pre: [117.05, 214.8, 115.23], host: 'palaceE', owner: 'layout', groundTol: 2,
    note: 'palace.ts:2683 定锚 TG_DECK+1.5 —— 与 crowd.skyGround 的 p.y−1.5 配套（人群落台面），非 layout 可控',
  },
  pantao: { pre: [-150, 201.12, 40], host: 'pantao', owner: 'layout' },
  yaochi: { pre: [150, 208.26, 20], host: 'yaochi', owner: 'layout' },
  // 以下两个 POI 由 world.ts 建立（layout 无权改写），先纳入同一张表如实暴露
  jiangtai: { pre: [0, 206.12, 9.09], host: 'arena', owner: 'world' },
  star9: { pre: [0, 206.12, 13.64], host: 'arena', owner: 'world' },
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready() {
  await page.waitForFunction(
    () => !document.getElementById('loading') && !!window.__qingming,
    { timeout: 180000 },
  );
  await sleep(800);
}

/** HMR 可能在别的 agent 改文件时刷新页面 → evaluate 重试 */
async function readPois(tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await ready();
      return await page.evaluate(async () => {
        const { THREE, scene } = window.__qingming;
        const frame = await import('/src/sky/heavenFrame.ts');
        // ⚠ HMR 之后应用引用的是 `/src/city/layout.ts?t=<ts>`，裸 import 会拿到**另一份**模块实例
        // （POIS 是模块级单例，冷拷贝里没有 world.ts 运行时新增的 key）——那样读出来的是源码，
        // 不是运行时，探针会假绿。所以先按 resource timing 找回应用真正加载过的那个 URL，
        // 再用「world.ts 运行时才写入的 key」验明正身；找不到就报错，不退回冷拷贝。
        const cand = new Set(
          performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((n) => n.includes('/src/city/layout.ts')),
        );
        cand.add('/src/city/layout.ts');
        let layout = null;
        let used = null;
        for (const u of cand) {
          try {
            const m = await import(u);
            if (m.POIS && (m.POIS['yinyanggate'] || m.POIS['naihe'])) { layout = m; used = u; break; }
            if (m.POIS && !layout) layout = m;   // 冷拷贝兜底记录，但只有拿到运行实例才采用
          } catch { /* 换下一个候选 */ }
        }
        if (!layout) return { error: '动态 import 读不到 /src/city/layout.ts' };
        const POIS = layout.POIS;
        if (!POIS['yinyanggate'] && !POIS['naihe']) {
          return {
            error: '只读到 POIS 的模块冷拷贝（缺 world.ts 运行时新增的 yinyanggate/naihe）——探针拒绝拿源码冒充运行时',
            liveUrl: used,
            keys: Object.keys(POIS),
          };
        }
        const city = [];
        scene.traverse((o) => {
          if (o.isMesh && o.visible && (o.name.startsWith('city_') || o.name.startsWith('sky_'))) city.push(o);
        });
        const rc = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        const rows = [];
        const { world, engine } = window.__qingming;
        for (const key in POIS) {
          const p = POIS[key];
          if (!p.sky) continue;
          // 近射线：从头顶 0.6m 打 8m，抓「脚下这块面」（桌面/台面/水面）
          rc.set(new THREE.Vector3(p.pos.x, p.pos.y + 0.6, p.pos.z), down);
          rc.far = 8;
          const near = rc.intersectObjects(city, false);
          // 远射线：从 60m 高处打 300m，抓「悬空 130m」这类远高于落脚面的情况
          rc.set(new THREE.Vector3(p.pos.x, p.pos.y + 60, p.pos.z), down);
          rc.far = 300;
          const far = rc.intersectObjects(city, false);
          // 射线起点在实体内部时，近射线会从背面穿出；远射线命中点才是「POI 正下方最近的面」
          const nearHit = near.length ? near[0] : null;
          const farHit = far.length ? far[0] : null;
          rows.push({
            key,
            name: p.name,
            x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), z: +p.pos.z.toFixed(3),
            radius: p.radius,
            near: nearHit
              ? { y: +nearHit.point.y.toFixed(3), obj: nearHit.object.name, dist: +nearHit.distance.toFixed(3) }
              : null,
            far: farHit
              ? { y: +farHit.point.y.toFixed(3), obj: farHit.object.name, dist: +farHit.distance.toFixed(3) }
              : null,
            frame: { HEAVEN_SCALE: frame.HEAVEN_SCALE, HEAVEN_BASE_LIFTED: frame.HEAVEN_BASE_LIFTED },
          });
        }
        // ④ 传送机位：world.teleport 直接读 poi.pos，机位 = POI + CAM_OFF（世界米）。
        //    若再被抬一次 +HEAVEN_LIFT，相机相对 POI 的高差会变成 ~1935 —— 一眼可判。
        for (const r of rows) {
          const ok = world.teleport(r.key);
          const c = engine.camera.position;
          r.teleport = ok
            ? { ok, dx: +(c.x - r.x).toFixed(2), dy: +(c.y - r.y).toFixed(2), dz: +(c.z - r.z).toFixed(2) }
            : { ok: false };
        }
        return { rows, liveUrl: used, skyKeys: rows.map((r) => r.key) };
      });
    } catch (e) {
      console.log(`  (页面重载/读取失败，重试 ${i + 1}/${tries}: ${String(e).split('\n')[0].slice(0, 90)})`);
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    }
  }
  return { error: '重试耗尽：页面始终读不到 POIS' };
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
const data = await readPois();
await browser.close();

if (data.error) {
  console.error(`[BLOCK] ${data.error}`);
  if (data.keys) console.error(`  冷拷贝 keys=${data.keys.join(',')}`);
  process.exit(1);
}

console.log(`POI 运行实例：${data.liveUrl}`);
console.log(`天宫 POI key：${data.skyKeys.join(', ')}`);

const rows = data.rows;
const S = rows[0]?.frame.HEAVEN_SCALE ?? 2.2;
const BASE_LIFTED = rows[0]?.frame.HEAVEN_BASE_LIFTED ?? 2131;
const BASE_Y = 196;
const heavenY = (y) => BASE_LIFTED + (y - BASE_Y) * S;

if (DUMP) {
  console.log('=== 天宫 POI 原始读点（缩放前口径 → 世界口径）===');
  for (const r of rows) {
    const e = EXPECT[r.key];
    console.log(
      [
        r.key,
        r.name,
        `world=(${r.x}, ${r.y}, ${r.z})`,
        e ? `want=(${(e.pre[0] * S).toFixed(2)}, ${heavenY(e.pre[1]).toFixed(2)}, ${(e.pre[2] * S).toFixed(2)})` : 'want=?',
        `near=${r.near ? `${r.near.y}@${r.near.obj}` : 'none'}`,
        `far=${r.far ? `${r.far.y}@${r.far.obj} d=${r.far.dist}` : 'none'}`,
      ].join('\t'),
    );
  }
  process.exit(0);
}

console.log('=== 天宫 POI 传送点落位机检 ===');
console.log(
  ['#', 'POI', '归属', 'x', 'y', 'z', '期望x', '期望y', '期望z', 'Δx', 'Δy', 'Δz', '落脚y', 'Δ地/容差', 'Δ面', '机位Δy', '判定', '备注']
    .join('\t'),
);

let pass = 0;
const failures = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const e = EXPECT[r.key];
  if (!e) {
    console.log([i + 1, r.key, '?', r.x, r.y, r.z, '-', '-', '-', '-', '-', '-', '-', '-', '-', 'SKIP'].join('\t'));
    continue;
  }
  const wantX = e.pre[0] * S;
  const wantY = heavenY(e.pre[1]);
  const wantZ = e.pre[2] * S;
  const dx = Math.abs(r.x - wantX);
  const dy = Math.abs(r.y - wantY);
  const dz = Math.abs(r.z - wantZ);
  // 落脚面：近射线优先（桌面/台面），够不着再退远射线（悬空/埋入时暴露真实高差）
  const hit = r.near ?? r.far;
  const ground = hit ? hit.y : null;
  const dGround = ground === null ? Infinity : Math.abs(ground - r.y);
  const dFace = hit ? Math.hypot(r.x - r.x, ground === null ? 0 : ground - r.y, r.z - r.z) : Infinity;
  const okX = dx <= 1;
  const okY = dy <= 1;
  const okZ = dz <= 1;
  const tol = e.groundTol ?? 1;
  const okG = dGround <= tol;
  const okF = dFace <= 3;
  // ④ 传送机位不得二次抬升：相机相对 POI 的高差应在 CAM_OFF 的量级（≤60m），不是 +1935
  const okT = !!r.teleport?.ok && Math.abs(r.teleport.dy) <= 60;
  const ok = okX && okY && okZ && okG && okF && okT;
  if (ok) pass++;
  if (!ok) {
    failures.push(
      `${r.key}[${e.owner}] world=(${r.x},${r.y},${r.z}) want=(${wantX.toFixed(2)},${wantY.toFixed(2)},${wantZ.toFixed(2)})` +
      ` Δ=(${dx.toFixed(2)},${dy.toFixed(2)},${dz.toFixed(2)}) ground=${ground === null ? 'none' : ground.toFixed(2)} Δ地=${Number.isFinite(dGround) ? dGround.toFixed(2) : 'inf'}` +
      ` 机位Δy=${r.teleport?.ok ? r.teleport.dy : 'teleport失败'}`,
    );
  }
  console.log(
    [
      i + 1, r.key, e.owner,
      r.x.toFixed(2), r.y.toFixed(2), r.z.toFixed(2),
      wantX.toFixed(2), wantY.toFixed(2), wantZ.toFixed(2),
      dx.toFixed(2), dy.toFixed(2), dz.toFixed(2),
      ground === null ? 'none' : ground.toFixed(2),
      Number.isFinite(dGround) ? dGround.toFixed(2) + '/' + tol : 'inf',
      Number.isFinite(dFace) ? dFace.toFixed(2) : 'inf',
      r.teleport?.ok ? r.teleport.dy.toFixed(2) : 'n/a',
      ok ? 'PASS' : 'FAIL',
      e.note ?? '',
    ].join('\t'),
  );
}

const total = rows.filter((r) => EXPECT[r.key]).length;
const owned = rows.filter((r) => EXPECT[r.key] && EXPECT[r.key].owner === 'layout');
const ownedPass = owned.filter((r) => {
  const e = EXPECT[r.key];
  const hit = r.near ?? r.far;
  const dy = Math.abs(r.y - heavenY(e.pre[1]));
  const dx = Math.abs(r.x - e.pre[0] * S);
  const dz = Math.abs(r.z - e.pre[2] * S);
  const dg = hit ? Math.abs(hit.y - r.y) : Infinity;
  return dx <= 1 && dy <= 1 && dz <= 1 && dg <= (e.groundTol ?? 1) && !!r.teleport?.ok && Math.abs(r.teleport.dy) <= 60;
}).length;
console.log('---');
console.log(`总数=${total} 通过=${pass} | layout 所属 ${ownedPass}/${owned.length} · 外部（world.ts）${pass - ownedPass}/${total - owned.length}`);
if (failures.length) {
  console.log('失败明细：');
  for (const f of failures) console.log(`  · ${f}`);
}
const allOk = total > 0 && pass === total;
console.log(
  allOk
    ? `PASS ${pass}/${total} 个天宫 POI 全部落在 heavenPoint 换算后的台面（脚下高差见「Δ地/容差」列）`
    : `BLOCK ${pass}/${total} —— layout 所属 ${ownedPass}/${owned.length} 通过；world.ts 的 jiangtai/star9 仍是混合口径（本文件无权改写）`,
);
process.exit(allOk ? 0 : 1);
