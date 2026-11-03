/**
 * probe-crowd-determinism.mjs —— 人群生成的确定性门（纯 Node，不开浏览器、不起 dev server）。
 *
 * 为什么需要它：`probe-determinism.mjs` 只做**静态文本普查**（A 类文件里不许出现
 * `Math.random(` / `performance.now(` 的调用文本）。文本干净不等于人群可复现——
 * 只要有一个抽签没接线、或者 `initBehavior` 还在用全局随机，静态门照样绿。
 * 本门补的是 `Crowd` 这一层的**行为级证据**。
 *
 * 四条硬判据（任一失败即 exit 1）：
 *   1. 同种子复跑：同一颗种子跑两次，出生快照 + 30 帧位置快照必须逐值相同；
 *   2. 换种子分叉：换一颗种子，快照必须不同——否则说明种子根本没接线，是假绿；
 *   3. 负对照：不注入 rng（走旧路径默认源）跑两次必须不同——证明本门不是恒绿摆设，
 *      也如实暴露「默认值仍是旧的非确定路径」这一兼容边界；
 *   4. 非空样本：两次都要真的生出人来（否则「都为空」也能算相同，是退化判定）。
 *
 * 快照口径：每个 actor 的 id / 职业 / 冠 / 持物 / 行为类 / pos.xyz / yaw / speed / scale /
 * seed / 衣裤肤三色的浮点分量，按 `String(v)` 原样拼接（JS 的 Number→String 对 double
 * 是往返精确的），再取 SHA-256 前 16 位做摘要。逐值相同 = 摘要相同 + 字符串相同。
 *
 * 另附一段信息性对照（不参与判定）：不同种子与旧路径的 `spawnReport`、冠帽比例、
 * 步速区间、落点范围。用来核对「换随机源，不换分布」。
 *
 * 实现口径：用 node_modules 里现成的 esbuild（vite 的传递依赖）把 `src/**.ts` 打成
 * 单文件 ESM 临时包再 `import()`。不需要 tsc 产物、不需要 vite dev server、不需要浏览器。
 *
 * 用法：node scripts/probe-crowd-determinism.mjs
 * 退出码：0 = PASS；1 = FAIL；2 = USAGE_ERROR
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 人群密度：0.2 × TARGET_WALKERS(1800) ≈ 360 人，够撑开分布又不至于让探针跑几分钟 */
const DENSITY = Number(process.env.CROWD_DENSITY ?? 0.2);
/** 出生之后再推进的帧数：证明「生成确定」之后「走起来也确定」 */
const TICKS = Number(process.env.CROWD_TICKS ?? 30);
const DT = 1 / 30;
const SEED_A = 20261103;
const SEED_B = 777;

const ENTRY = `
export { Crowd } from './src/actors/crowd.ts';
export { actionKindOf } from './src/actors/behaviors.ts';
export { buildNav } from './src/city/layout.ts';
export { RNG } from './src/core/rng.ts';
export { Scene, Vector3 } from 'three';
`;

let MOD = null;

/**
 * Node 侧最小 canvas 垫片。
 *
 * `src/actors/pools.ts` 在**模块顶层**用 canvas 烘一张 64×64 织物法线图
 * （`THREE.CanvasTexture`），这是渲染层依赖，不属于 sim 逻辑；而 pools.ts 不在本次
 * 可改文件清单内。所以探针在 import 之前装一个只满足 `createImageData` / `putImageData`
 * 的假 canvas，让模块能加载。
 * ⚠ 垫片只服务「加载」，不参与任何判定：判定看的是角色快照，与贴图无关。
 */
function installCanvasShim() {
  if (typeof globalThis.document !== 'undefined') return;
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    }),
  });
  globalThis.document = { createElement: () => makeCanvas(), createElementNS: () => makeCanvas() };
}

async function loadCrowd() {
  if (MOD) return MOD;
  installCanvasShim();
  const out = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: ROOT,
      sourcefile: 'probe-crowd-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'error',
  });
  const file = path.join(os.tmpdir(), `cqq-crowd-determinism-${process.pid}.mjs`);
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

const colorKey = (c) => `${c.r},${c.g},${c.b}`;

/** 角色快照：id / 外观 / 行为类 / 位姿 / 运动参数 / 颜色，全部原值字符串化 */
function snapshot(m, crowd) {
  const out = [];
  for (const a of crowd.actors) {
    out.push([
      a.id, a.occ, a.hat, a.propPool ?? '-', m.actionKindOf(a) ?? '-',
      String(a.pos.x), String(a.pos.y), String(a.pos.z), String(a.yaw),
      String(a.speed), String(a.scale), String(a.seed),
      colorKey(a.cloth), colorKey(a.pants), colorKey(a.skin),
    ].join('\u0001'));
  }
  return out.join('\u0002');
}

function digest(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * 跑一次「建 Crowd → 撒人 → 推进 TICKS 帧」。
 * @param rng 注入的种子随机源；null = 不注入（走旧路径默认源 Math.random + 宿主墙钟）
 */
function runOnce(m, rng) {
  const scene = new m.Scene();
  let clockMs = 0;
  const clock = () => clockMs;
  // 不注入时连时钟也不给：走的正是 world.ts / 既有调用点的默认路径
  const crowd = rng
    ? new m.Crowd(scene, m.buildNav(), rng, clock)
    : new m.Crowd(scene, m.buildNav());
  crowd.density = DENSITY;
  crowd.spawnCrowd();

  const spawnText = snapshot(m, crowd);
  const spawnHash = digest(spawnText);
  const frames = [];
  const cam = new m.Vector3(0, 6, 52);
  for (let i = 0; i < TICKS; i++) {
    clockMs += DT * 1000;
    crowd.update((i + 1) * DT, DT, cam);
    frames.push(digest(snapshot(m, crowd)));
  }
  return {
    spawnText, spawnHash, frames,
    count: crowd.actors.length,
    report: { ...crowd.spawnReport },
    sample: crowd.actors,
  };
}

function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** 信息性分布：冠帽比例 / 步速区间 / 落点范围（判定不看它，只用于核对「分布未变」） */
function profile(run) {
  const hats = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let vMin = Infinity, vMax = -Infinity, vSum = 0;
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const a of run.sample) {
    hats[a.hat] = (hats[a.hat] ?? 0) + 1;
    if (a.speed < vMin) vMin = a.speed;
    if (a.speed > vMax) vMax = a.speed;
    vSum += a.speed;
    if (a.pos.x < xMin) xMin = a.pos.x;
    if (a.pos.x > xMax) xMax = a.pos.x;
    if (a.pos.z < zMin) zMin = a.pos.z;
    if (a.pos.z > zMax) zMax = a.pos.z;
  }
  const n = run.count || 1;
  return {
    hats: hats.map((c) => `${((c / n) * 100).toFixed(1)}%`).join('/'),
    speed: `${vMin.toFixed(2)}–${vMax.toFixed(2)} 均值 ${(vSum / n).toFixed(2)}`,
    extent: `x ${xMin.toFixed(0)}…${xMax.toFixed(0)}  z ${zMin.toFixed(0)}…${zMax.toFixed(0)}`,
  };
}

async function main() {
  if (!existsSync(path.join(ROOT, 'src', 'actors', 'crowd.ts'))) {
    console.error('USAGE_ERROR: 找不到 src/actors/crowd.ts');
    return 2;
  }
  const m = await loadCrowd();

  console.log('=== probe-crowd-determinism ===');
  console.log(`density=${DENSITY}  ticks=${TICKS}  dt=${DT.toFixed(4)}  simSeconds=${(TICKS * DT).toFixed(2)}`);

  // 1) 同种子复跑
  const a1 = runOnce(m, seeded(m, SEED_A));
  const a2 = runOnce(m, seeded(m, SEED_A));
  const sameSpawn = a1.spawnHash === a2.spawnHash;
  const sameFrames = diffCount(a1.frames, a2.frames);
  console.log(`\n[1] 同种子复跑     seed=${SEED_A}  actors=${a1.count}`);
  console.log(`    出生快照 ${a1.spawnHash} vs ${a2.spawnHash}  ${sameSpawn ? '相同' : '不同'}`);
  console.log(`    推进快照 differing_frames=${sameFrames}/${TICKS}`);
  console.log(`    spawnReport planned=${a1.report.planned} spawned=${a1.report.spawned} rejected=${a1.report.rejected} skipped=${a1.report.skipped}`);

  // 2) 换种子必须分叉
  const b1 = runOnce(m, seeded(m, SEED_B));
  const crossSpawn = a1.spawnHash !== b1.spawnHash ? 1 : 0;
  const crossFrames = diffCount(a1.frames, b1.frames);
  console.log(`\n[2] 换种子分叉     seed=${SEED_B}  actors=${b1.count}`);
  console.log(`    出生快照 ${a1.spawnHash} vs ${b1.spawnHash}  ${crossSpawn ? '不同' : '相同（假绿）'}`);
  console.log(`    推进快照 differing_frames=${crossFrames}/${TICKS}`);

  // 3) 负对照：不注入 rng（旧路径默认源）必须分叉
  const l1 = runOnce(m, null);
  const l2 = runOnce(m, null);
  const legacySpawn = l1.spawnHash !== l2.spawnHash ? 1 : 0;
  const legacyFrames = diffCount(l1.frames, l2.frames);
  console.log(`\n[3] 负对照(未注入)  Math.random 旧路径  actors=${l1.count}/${l2.count}`);
  console.log(`    出生快照 ${l1.spawnHash} vs ${l2.spawnHash}  ${legacySpawn ? '不同' : '相同（本门恒绿，无效）'}`);
  console.log(`    推进快照 differing_frames=${legacyFrames}/${TICKS}`);

  // 4) 非空样本：防空跑退化成「都相同」
  console.log(`\n[4] 样本非空       actors=${a1.count}  (density=${DENSITY}，0 人时本门的「相同」没有意义)`);

  // ---- 信息性：换随机源不换分布 ----
  console.log('\n[分布对照]（信息性，不参与判定）');
  const rows = [
    ['legacy(Math.random)', l1],
    [`seed=${SEED_A}`, a1],
    [`seed=${SEED_B}`, b1],
  ];
  for (const [label, run] of rows) {
    const p = profile(run);
    console.log(`  ${label.padEnd(20)} spawned=${String(run.report.spawned).padStart(4)} skipped=${String(run.report.skipped).padStart(3)} 冠0-8=${p.hats}  步速=${p.speed}  落点=${p.extent}`);
  }

  const checks = [
    { name: '同种子出生快照逐值相同', ok: sameSpawn, detail: `${a1.spawnHash} / ${a2.spawnHash}` },
    { name: `同种子推进 ${TICKS} 帧逐值相同`, ok: a1.frames.length === TICKS && sameFrames === 0, detail: `${sameFrames}/${TICKS} 帧不同` },
    { name: '换种子必须分叉（出生快照）', ok: crossSpawn === 1, detail: `${a1.spawnHash} / ${b1.spawnHash}` },
    { name: `换种子必须分叉（推进帧）`, ok: crossFrames > 0, detail: `${crossFrames}/${TICKS} 帧不同` },
    { name: '负对照（未注入 rng）必须分叉', ok: legacySpawn === 1 && legacyFrames > 0, detail: `出生 ${legacySpawn ? '不同' : '相同'}；推进 ${legacyFrames}/${TICKS} 帧不同` },
    { name: '样本非空', ok: a1.count > 0 && b1.count > 0 && l1.count > 0, detail: `${a1.count}/${b1.count}/${l1.count}` },
  ];
  const failed = checks.filter((c) => !c.ok);
  console.log('');
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
  console.log(failed.length ? `RESULT=FAIL (${failed.length}/${checks.length})` : `RESULT=PASS (${checks.length}/${checks.length})`);
  return failed.length ? 1 : 0;
}

process.exit(await main());
