/**
 * 天宫坐骑/宠物**落脚**机检（W5-3）。
 *
 * 与 probe-deity-actors.mjs 的分工：
 *   ① 那份守「落位」——演员是否站在 heavenFrame 换算后的台面、水平半径是否 ×2.2；
 *      它对哮天犬走 `runtimeMoved` 分支，只认落位账，**量不到运行期编排**。
 *   ② 本探针守「运行期落脚」——把主循环冻住，按固定 t 步长逐帧推进 DeityStage.update，
 *      每帧对哮天犬的脚底打一条向下射线，量「脚底 − 地面」的高差。
 *
 * 旧 bug：deities.ts 的 update() 写 `dog.pos.y = erlang.pos.y - 1.2`。
 *   · Actor 模型原点在脚底（crowd.writeActor 把实例根矩阵直接放在 a.pos，躯干/头在局部
 *     y=1.14/1.64），所以 -1.2 不是原点补偿，是纯世界米下沉；
 *   · 二郎神在战斗幕里会被抬到空中，跟他的 y 还会让犬一起悬空。
 *   判据因此写成「脚底与向下射线首个命中面的高差 ≤ 0.3m」，正负都拦。
 *
 * 冻结方式（不依赖墙钟，结果可复现）：
 *   · `world.havoc.hold = true` 停大闹天宫，二郎神不再被编排带走；
 *   · 演员复位到 `world.deitySpots` 落位账（抹掉此前战斗幕的位移）；
 *   · `world.deityHold = true` 停主循环对 DeityStage 的驱动，再由探针逐帧调用
 *     `world.deities.update(t, dt)`，覆盖一个完整绕行周期（2π/1.4）。
 *
 * 判据（全过才 PASS）：
 *   ① 每帧射线都命中地面；
 *   ② 每帧 |脚底 − 地面| ≤ 0.3m（并单独报有符号的 min/max，埋进去和飘起来分开看）；
 *   ③ 采样窗口内哮天犬水平位移 > 2m —— 防止「编排没跑」被误判成 PASS。
 *
 * 退出码：0 = PASS，1 = BLOCK。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4180/';
/** 采样帧数：覆盖一个完整绕行周期（t 步长 period/N，不靠墙钟） */
const FRAMES = Number(process.env.FRAMES || 32);
const DT = 0.02;
const TOL = 0.3;

/** 天宫里会被逐帧写 pos 的坐骑/宠物；新增坐骑必须登记在这里，否则「全过」不算数 */
const PETS = ['哮天犬'];

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
  await sleep(600);
}

async function sample(tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await ready();
      return await page.evaluate(({ FRAMES, DT, PETS }) => {
        const { THREE, scene, world } = window.__qingming;
        const stage = world.deities;
        if (!stage?.map) return { error: 'world.deities.map 不可读' };

        const city = [];
        scene.traverse((o) => { if (o.isMesh && o.name.startsWith('city_')) city.push(o); });
        if (!city.length) return { error: '场景里找不到 city_* 网格，射线无处可打' };

        const rc = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        /**
         * 脚底向下射线：**从脚上方 0.25m 起射**，far=10。
         * 不从更高处起射：御道上空 1.6m 有廊顶/装饰面（实测 city_ash_3 @2155.2），从 +2m 起射
         * 会把头顶的板当成「地面」。从脚上方起射只会够到脚下的地面：
         *   · 脚正确落在台面 → 首个命中面就在脚底附近，高差 ≈ 0；
         *   · 脚被埋进台面（旧 bug 1.2m）→ 射线起点也在地面之下，命中不到 → BLOCK；
         *   · 脚悬空 → 命中面在下方，高差 = 悬空高度 → 超 0.3m 即 BLOCK。
         */
        const probe = (name) => {
          const a = stage.map.get(name);
          if (!a) return null;
          const { x, y, z } = a.pos;
          rc.set(new THREE.Vector3(x, y + 0.25, z), down);
          rc.far = 10;
          const hits = rc.intersectObjects(city, false).filter((h) => h.object.visible);
          const ground = hits.length ? hits[0].point.y : null;
          return {
            x, y, z, ground, obj: hits.length ? hits[0].object.name : null,
            delta: ground === null ? null : y - ground,
          };
        };

        // ① 采样前：主循环刚跑过的实时姿态（诊断用，可能正处于战斗幕、二郎神在空中）
        const live = {};
        for (const n of PETS) live[n] = probe(n);

        // ② 冻结：停战斗 → 复位到落位账 → 停主循环对 DeityStage 的驱动
        if (world.havoc) world.havoc.hold = true;
        const spots = Array.isArray(world.deitySpots) ? world.deitySpots : [];
        for (const s of spots) {
          const a = stage.map.get(s.name);
          if (a) a.pos.set(s.x, s.y, s.z);
        }
        world.deityHold = true;

        // ③ 逐帧推进一个绕行周期
        const rows = [];
        const period = (Math.PI * 2) / 1.4;   // update() 里哮天犬的角速度
        for (let i = 0; i < FRAMES; i++) {
          const t = (period * i) / FRAMES;
          stage.update(t, DT);                // 与 world.update 内同一入口
          for (const n of PETS) {
            const p = probe(n);
            if (!p) return { error: `演员 ${n} 不在 DeityStage.map` };
            rows.push({ frame: i, t, name: n, ...p });
          }
        }
        const er = stage.map.get('二郎神杨戬');
        return {
          rows, live, frames: FRAMES,
          erlang: er ? { x: er.pos.x, y: er.pos.y, z: er.pos.z } : null,
          ledger: spots.length,
        };
      }, { FRAMES, DT, PETS });
    } catch (e) {
      console.log(`  (页面重载/读取失败，重试 ${i + 1}/${tries}: ${String(e).split('\n')[0].slice(0, 90)})`);
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    }
  }
  return { error: '重试耗尽：页面始终读不到天宫坐骑坐标' };
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
const data = await sample();
await browser.close();

if (data.error) {
  console.error(`[BLOCK] ${data.error}`);
  process.exit(1);
}

const rows = data.rows;
console.log(`=== 天宫坐骑/宠物运行期落脚机检（${data.frames} 帧 / 落位账 ${data.ledger} 条）===`);
console.log('--- 采样前实时姿态（主循环驱动，诊断用）---');
for (const [name, p] of Object.entries(data.live)) {
  if (!p) { console.log(`  ${name}: 读不到`); continue; }
  console.log(
    `  ${name}: pos=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})` +
    ` 地面=${p.ground === null ? 'none' : p.ground.toFixed(2)}` +
    ` 高差=${p.delta === null ? 'inf' : p.delta.toFixed(2)}m` +
    ` 面=${p.obj ?? '?'}`,
  );
}

console.log('--- 冻结后逐帧（脚底 − 向下射线首个命中面）---');
console.log(['帧', '名称', 'x', 'y', 'z', '地面y', '高差', '命中面'].join('\t'));
let hitAll = true;
let maxAbs = 0;
let minDelta = Infinity;
let maxDelta = -Infinity;
for (const r of rows) {
  const abs = r.delta === null ? Infinity : Math.abs(r.delta);
  if (r.ground === null) hitAll = false;
  if (Number.isFinite(abs)) {
    maxAbs = Math.max(maxAbs, abs);
    minDelta = Math.min(minDelta, r.delta);
    maxDelta = Math.max(maxDelta, r.delta);
  }
  console.log([
    r.frame, r.name,
    r.x.toFixed(2), r.y.toFixed(2), r.z.toFixed(2),
    r.ground === null ? 'none' : r.ground.toFixed(2),
    r.delta === null ? 'inf' : r.delta.toFixed(2),
    r.obj ?? '?',
  ].join('\t'));
}

// 编排活性：水平位移必须真的发生，否则「没跑」会被误判成「站得稳」
let span = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    if (rows[i].name !== rows[j].name) continue;
    span = Math.max(span, Math.hypot(rows[i].x - rows[j].x, rows[i].z - rows[j].z));
  }
}

console.log('---');
console.log(`帧数=${rows.length}（每帧 ${PETS.length} 个目标） 射线全命中=${hitAll}`);
console.log(`高差：min=${Number.isFinite(minDelta) ? minDelta.toFixed(3) : 'inf'}m max=${Number.isFinite(maxDelta) ? maxDelta.toFixed(3) : 'inf'}m |最大|=${Number.isFinite(maxAbs) ? maxAbs.toFixed(3) : 'inf'}m（阈值 ${TOL}m）`);
console.log(`水平位移=${span.toFixed(2)}m（活性阈值 2m）`);
if (data.erlang) console.log(`二郎神脚底=(${data.erlang.x.toFixed(2)}, ${data.erlang.y.toFixed(2)}, ${data.erlang.z.toFixed(2)})`);

const ok = hitAll && Number.isFinite(maxAbs) && maxAbs <= TOL && span > 2 && rows.length === data.frames * PETS.length;
console.log(ok
  ? `PASS ${rows.length} 帧全部 |脚底−地面| ≤ ${TOL}m，编排活性 ${span.toFixed(2)}m`
  : `BLOCK 落脚超差/射线未命中/编排未动：|max|=${Number.isFinite(maxAbs) ? maxAbs.toFixed(2) : 'inf'}m span=${span.toFixed(2)}m`);
process.exit(ok ? 0 : 1);
