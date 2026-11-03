/**
 * probe-sim-determinism.mjs —— 仿真确定性门（纯 Node，不开浏览器、不起 dev server）。
 *
 * 为什么需要它：probe-determinism.mjs 只做**静态文本普查**（A 类文件里不许出现
 * `Math.random(` / `performance.now(` 的调用文本）。文本干净不等于跑起来确定——
 * 只要有一个随机源没接线、或者时钟没注入，静态门照样绿。本门补的是**行为级证据**。
 *
 * 三条硬判据（任一失败即 exit 1）：
 *   1. 同种子复跑：同一颗种子 + 同一段输入跑两次，600 步的位置哈希必须逐值相同；
 *   2. 换种子分叉：换一颗种子再跑，哈希序列必须不同——否则说明种子根本没接线，是假绿；
 *   3. 负对照：不注入 rng（走旧路径默认源）跑两次必须不同——证明本门不是恒绿摆设，
 *      也如实暴露「默认值仍是旧的非确定路径」这一兼容边界。
 *
 * 另附两条物理侧证据（只用注入时钟，不读墙钟）：
 *   · `ImpactSystem` 的僵直到期时刻必须落在注入时钟的刻度上；
 *   · `update(dt)` 的固定步累加器：1/60×60 与 1/120×120 两条喂法应落到同一条弹道
 *     （容差 = 一个固定子步的位移，浮点累加余量导致的最坏偏差）。
 *
 * 实现口径：用 node_modules 里现成的 esbuild（vite 的传递依赖）把 `src/**.ts` 打成
 * 单文件 ESM 临时包再 `import()`。这样不需要 tsc 产物、不需要 vite dev server，
 * 也不需要浏览器——本门是纯 Node 的。
 *
 * 用法：
 *   node scripts/probe-sim-determinism.mjs           # 门禁：退出码 0=PASS 1=FAIL 2=USAGE_ERROR
 *   node scripts/probe-sim-determinism.mjs --dist    # 行为分布报告（改前/改后对比用；恒 exit 0）
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = 600;
const DT = 0.1;              // 与引擎 1/60 不同没关系：dt 是输入，不是墙钟
const ACTORS = 120;
const DIST_MODE = process.argv.includes('--dist');

/** 打包入口：行为层 + 路网 + 热点表 + 种子 RNG + 物理系统 */
const ENTRY = `
export * from './src/actors/behaviors.ts';
export { buildNav } from './src/city/layout.ts';
export { SpotRegistry } from './src/data/jobs.ts';
export { RNG } from './src/core/rng.ts';
export { ImpactSystem } from './src/game/physics.ts';
export { Vector3 } from 'three';
`;

let MOD = null;
async function loadSim() {
  if (MOD) return MOD;
  const out = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: ROOT,
      sourcefile: 'probe-sim-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'error',
  });
  const file = path.join(os.tmpdir(), `cqq-sim-determinism-${process.pid}.mjs`);
  writeFileSync(file, out.outputFiles[0].text);
  process.on('exit', () => {
    try { rmSync(file, { force: true }); } catch { /* 临时文件清不掉不影响判定 */ }
  });
  MOD = await import(pathToFileURL(file).href);
  return MOD;
}

/** 取一颗种子 RNG 的取值函数。注意 RNG.next 是类方法，直接传引用会丢 this。 */
function seeded(m, seed) {
  const r = new m.RNG(seed);
  return () => r.next();
}

const OCCS = [
  'customer', 'peddler', 'vendor', 'porter', 'scholar', 'monk', 'merchant', 'soldier',
  'official', 'lady', 'kid', 'beggar', 'farmer', 'fisher', 'watchman', 'gambler',
];

/** 造一批固定身份的角色：id / occ / seed / 出生点全部由序号决定，不含任何随机 */
function makeActors(m, nav) {
  const ground = nav.nodes.filter((n) => n.y <= 100);
  const list = [];
  for (let i = 0; i < ACTORS; i++) {
    const node = ground[(i * 7 + 3) % ground.length];
    const a = {
      id: i + 1,
      pos: node.clone(),
      yaw: (i * 0.618) % (Math.PI * 2),
      speed: 1 + (i % 5) * 0.06,
      action: 'stand',
      actT: 0,
      timer: 0,
      occ: OCCS[i % OCCS.length],
      seed: i + 1,
      scale: 1,
      hat: 1,
      cloth: null, pants: null, skin: null,
      propPool: null,
      slots: {},
      hatPool: 'hatFlat',
      halo: false,
      sky: false,
      hidden: false,
      freeze: false,
      attach: null,
      data: null,
      doing: '',
      path: [],
      pathI: 0,
      pendingAct: '',
      pendingSpot: false,
      curDoing: '',
      lastTick: 0,
      lastWrite: -1,
      acc: 0,
      actionT: 0,
      lastAction: '',
      impactUntil: 0,
      yOff: 0,
      yawVel: 0,
    };
    list.push(a);
  }
  return list;
}

/** 位置哈希：x / y / z / yaw 四个 float64 原样进 SHA-256（不做四舍五入，位级比对） */
function hashStep(actors) {
  const buf = new Float64Array(actors.length * 4);
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    buf[i * 4] = a.pos.x;
    buf[i * 4 + 1] = a.pos.y;
    buf[i * 4 + 2] = a.pos.z;
    buf[i * 4 + 3] = a.yaw;
  }
  return createHash('sha256').update(Buffer.from(buf.buffer)).digest('hex').slice(0, 16);
}

/**
 * 跑一段仿真。
 * @param rng      注入的种子随机源；null = 不注入（走旧路径默认源）
 * @param opts     collect=true 时统计行为分布（--dist 用）
 */
function runOnce(m, nav, seed, rng, opts = {}) {
  const spots = new m.SpotRegistry();
  spots.add(30, 60, 'stall');
  spots.add(-20, 58, 'tea');
  spots.add(120, 44, 'food');
  spots.add(200, -50, 'wine');
  spots.add(-60, 62, 'story');
  spots.add(66, 40, 'stage');
  spots.add(-238, 40, 'dock');
  spots.add(140, 30, 'shrine');

  const actors = makeActors(m, nav);
  // 行为层初始化：与 crowd.ts 的出生路径一致（先定行为类，再定初相位）
  for (const a of actors) m.initBehavior(a, undefined, rng ?? undefined);
  // 覆盖面：一部分人横穿、一部分人钉在驻场岗位（寺院/瓦舍/宫城走的是另一条分支）
  for (let i = 0; i < actors.length; i++) {
    if (i % 7 === 0) m.markCrossing(actors[i]);
    if (i % 11 === 0) {
      m.setPost(actors[i], {
        x: actors[i].pos.x, y: actors[i].pos.y, z: actors[i].pos.z,
        r: 12, kinds: ['worship', 'serve', 'watch_play'], venue: 'probe',
      });
    }
  }

  const camPos = new m.Vector3(0, 0, 52);
  const ctx = { nav, spots, isNight: false, camPos, t: 0 };
  if (rng) ctx.rng = rng;

  const hashes = [];
  const tally = opts.collect ? { kind: new Map(), doing: new Map(), action: new Map() } : null;
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (let s = 0; s < STEPS; s++) {
    ctx.t = (s + 1) * DT;
    ctx.isNight = s >= STEPS / 2;          // 昼夜切换：把夜间权重分支也压一遍
    if ((s & 3) === 0) m.rebuildAvoidGrid(actors);
    for (const a of actors) m.tickActor(a, DT, ctx);
    hashes.push(hashStep(actors));
    if (tally) {
      for (const a of actors) {
        bump(tally.kind, m.actionKindOf(a) ?? '∅');
        bump(tally.doing, a.doing || '∅');
        bump(tally.action, a.action || '∅');
      }
    }
  }
  return { hashes, tally, actors, seed };
}

function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function share(map, total) {
  const out = [];
  for (const [k, v] of map) out.push([k, (v / total) * 100]);
  out.sort((x, y) => y[1] - x[1]);
  return out;
}

// ============ 随机源本身的分布检验 ============
/**
 * 45 个取值点全是 `a + rng()*(b-a)` / `rng() < p` / `arr[floor(rng()*n)]` 这类
 * 对单个 [0,1) 均匀数的一次线性变换。只要 rng 在 [0,1) 上均匀，输出分布就与
 * Math.random 完全一致——所以「换种子不换分布」可以在源上直接验，不必靠整城统计。
 * 判据：均值偏差 <0.002（2e6 样本的 3σ 量级）+ 100 桶卡方 <160（99 自由度 p≈0.001）。
 */
function rngUniformity(m) {
  const N = 2_000_000;
  const B = 100;
  const r = new m.RNG(12345);
  const buckets = new Array(B).fill(0);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const v = r.next();
    sum += v;
    buckets[Math.min(B - 1, Math.floor(v * B))]++;
  }
  const exp = N / B;
  let chi2 = 0;
  let maxDev = 0;
  for (const c of buckets) {
    chi2 += ((c - exp) ** 2) / exp;
    const dev = Math.abs(c - exp) / exp;
    if (dev > maxDev) maxDev = dev;
  }
  const mean = sum / N;
  const threshold = 160;
  return {
    n: N, mean, chi2, maxDev,
    ts: (chi2 / threshold) * 100,          // 占卡方拒绝阈值的百分比
    ok: Math.abs(mean - 0.5) < 0.002 && chi2 < threshold && maxDev < 0.02,
  };
}

// ============ 物理侧：注入时钟 + 固定步累加器 ============
function probePhysics(m) {
  const rows = [];
  const fakeVfx = { burst() {}, ring() {} };

  const mkTarget = () => ({
    id: 9001, pos: new m.Vector3(0, 0, 0), yOff: 0, action: 'stand', impactUntil: 0,
    hidden: false, occ: 'customer', data: null,
  });

  // 1) 僵直到期时刻必须落在注入时钟上（旧实现读墙钟，这里会随真实时间漂）
  const t1 = mkTarget();
  const clockA = () => 1000;
  new m.ImpactSystem({ actors: [t1] }, fakeVfx, clockA).apply('stagger', t1, new m.Vector3(1, 0, 0), 9);
  const t2 = mkTarget();
  const clockB = () => 5000;
  new m.ImpactSystem({ actors: [t2] }, fakeVfx, clockB).apply('stagger', t2, new m.Vector3(1, 0, 0), 9);
  rows.push({
    name: '僵直到期 = 注入时钟 + 1200ms',
    got: `clock=1000 → ${t1.impactUntil}；clock=5000 → ${t2.impactUntil}`,
    ok: t1.impactUntil === 2200 && t2.impactUntil === 6200,
  });

  // 2) 固定步累加器：同样的总时长、不同的帧长，弹道必须一致（容差 = 一个子步位移）
  //    只跑 0.5s：击飞约 0.78s 落地，跑满 1s 会让两边都先落地再看不出差异（退化判定）。
  const mkFly = () => {
    const a = mkTarget();
    const sys = new m.ImpactSystem({ actors: [a] }, fakeVfx, () => 0);
    sys.apply('launch', a, new m.Vector3(1, 0, 0), 10);
    return { a, sys };
  };
  const f60 = mkFly();
  for (let i = 0; i < 30; i++) f60.sys.update(1 / 60);
  const f120 = mkFly();
  for (let i = 0; i < 60; i++) f120.sys.update(1 / 120);
  const d = Math.hypot(f60.a.pos.x - f120.a.pos.x, f60.a.pos.z - f120.a.pos.z, f60.a.yOff - f120.a.yOff);
  const slack = 10 * (1 / 120) * 1.5;   // 水平速度 10 m/s，一个固定子步 = 0.083m
  rows.push({
    name: '固定步累加器（1/60×60 vs 1/120×120）',
    got: `Δ=${d.toFixed(6)}m，容差 ${slack.toFixed(6)}m；x60=${f60.a.pos.x.toFixed(4)} x120=${f120.a.pos.x.toFixed(4)}`,
    ok: Number.isFinite(d) && d <= slack,
  });
  return rows;
}

async function main() {
  if (!existsSync(path.join(ROOT, 'src', 'actors', 'behaviors.ts'))) {
    console.error('USAGE_ERROR: 找不到 src/actors/behaviors.ts');
    return 2;
  }
  const m = await loadSim();
  const nav = m.buildNav();

  if (DIST_MODE) {
    // 种子集可用 DIST_SEEDS 覆盖（逗号分隔；写 legacy 表示不注入、走 Math.random）。
    // 用途：把「换随机源改了分布」与「系统本身的种子间涨落」分开看。
    const specs = (process.env.DIST_SEEDS || '1,2,3').split(',').map((s) => s.trim()).filter(Boolean);
    const acc = { kind: new Map(), doing: new Map(), action: new Map() };
    for (const spec of specs) {
      const rng = spec === 'legacy' ? null : seeded(m, Number(spec));
      const r = runOnce(m, nav, spec, rng, { collect: true });
      for (const key of Object.keys(acc)) {
        for (const [k, v] of r.tally[key]) acc[key].set(k, (acc[key].get(k) ?? 0) + v);
      }
    }
    const total = STEPS * ACTORS * specs.length;

    // 随机源本身的均匀性：每个取值点都是 a + rng()*(b-a) 这类一次线性变换，
    // 只要 rng 在 [0,1) 上均匀，输出分布就与 Math.random 完全一致。
    const uni = rngUniformity(m);

    console.log(`DIST_MODE runs=${specs.join(',')} steps=${STEPS} actors=${ACTORS} samples=${total}`);
    console.log(`RNG_UNIFORMITY n=${uni.n} mean=${uni.mean.toFixed(6)} chi2(99df)=${uni.chi2.toFixed(2)} maxBucketDev=${(uni.maxDev * 100).toFixed(3)}% ts=${uni.ts.toFixed(2)}pct  ${uni.ok ? 'OK' : 'FAIL'}`);
    console.log('\n行为类（actionKindOf）占比：');
    for (const [k, v] of share(acc.kind, total)) console.log(`  ${v.toFixed(2).padStart(6)}%  ${k}`);
    console.log('\n动作（a.action）占比 top 15：');
    for (const [k, v] of share(acc.action, total).slice(0, 15)) console.log(`  ${v.toFixed(2).padStart(6)}%  ${k}`);
    console.log('\n当前 doing 前 15：');
    for (const [k, v] of share(acc.doing, total).slice(0, 15)) console.log(`  ${v.toFixed(2).padStart(6)}%  ${k}`);
    return 0;
  }

  console.log('=== probe-sim-determinism ===');
  console.log(`steps=${STEPS}  dt=${DT}  actors=${ACTORS}  simSeconds=${(STEPS * DT).toFixed(1)}`);

  // 1) 同种子复跑
  const a1 = runOnce(m, nav, 20261103, seeded(m, 20261103));
  const a2 = runOnce(m, nav, 20261103, seeded(m, 20261103));
  const same = diffCount(a1.hashes, a2.hashes);
  console.log(`\n[1] 同种子复跑     seed=20261103  differing_steps=${same}/${STEPS}`);
  console.log(`    first=${a1.hashes[0]}  last=${a1.hashes[STEPS - 1]}`);

  // 2) 换种子必须分叉
  const b1 = runOnce(m, nav, 777, seeded(m, 777));
  const cross = diffCount(a1.hashes, b1.hashes);
  console.log(`[2] 换种子分叉     seed=777       differing_steps=${cross}/${STEPS}`);

  // 3) 负对照：不注入 rng（旧路径默认源）必须分叉
  const l1 = runOnce(m, nav, 0, null);
  const l2 = runOnce(m, nav, 0, null);
  const legacy = diffCount(l1.hashes, l2.hashes);
  console.log(`[3] 负对照(未注入)  两次不同步数=${legacy}/${STEPS}`);

  // 4) 物理侧
  const rows = probePhysics(m);
  console.log('\n[4] 物理侧（注入时钟 / 固定步）：');
  for (const r of rows) console.log(`    ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}  ${r.got}`);

  const checks = [
    { name: '同种子复跑逐值相同', ok: same === 0, detail: `${same} 步不同` },
    { name: '换种子必须分叉', ok: cross > 0, detail: `${cross} 步不同` },
    { name: '负对照（未注入）必须分叉', ok: legacy > 0, detail: `${legacy} 步不同` },
    ...rows.map((r) => ({ name: r.name, ok: r.ok, detail: r.got })),
  ];
  const failed = checks.filter((c) => !c.ok);
  console.log('');
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(failed.length ? `RESULT=FAIL (${failed.length}/${checks.length})` : `RESULT=PASS (${checks.length}/${checks.length})`);
  return failed.length ? 1 : 0;
}

process.exit(await main());
