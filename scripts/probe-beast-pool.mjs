/**
 * 兽池台账探针：slot 不够时兽体必须「可观测地跳过」，不能静默丢弃。
 *
 * 读取 window.__beastPool（CreatureSystem.beastReport() 的只读视图）：
 *   requested / accepted / dropped / droppedIds / droppedBySpecies / droppedByPool / pools
 *
 * 断言：
 *   - requested === accepted + dropped（一只不多、一只不少）
 *   - dropped === droppedIds.length，且 droppedBySpecies 的计数总和 === dropped
 *   - accepted === 场上真实兽体数（this.beasts.length）
 *   - body 池 used ≤ max，且台账里的 pools.body 与实例池一致
 *   - 强制把 body 池占满后，再要求一只：dropped +1、droppedIds 出现该 id（验证「跳过 + 记账」路径真的通）
 *
 * 退出码：0 = 全绿，1 = 任一断言失败。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4180/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=800,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
  () => !document.getElementById('loading') && !!window.__qingming && !!window.__qingming.world.creatures,
  { timeout: 180000 },
);
await new Promise((r) => setTimeout(r, 800));

const out = await page.evaluate(() => {
  const world = window.__qingming.world;
  const cs = world.creatures;
  const checks = [];
  const check = (name, ok, detail = {}) => checks.push({ name, ok: !!ok, ...detail });
  const raw = window.__beastPool;

  if (!raw) {
    return { checks: [{ name: 'window.__beastPool 存在', ok: false, got: typeof raw }], report: null };
  }

  const report = typeof raw.report === 'function' ? raw.report() : raw;
  const read = (k) => (typeof raw[k] === 'function' ? raw[k]() : raw[k]);
  const before = {
    requested: read('requested'),
    accepted: read('accepted'),
    dropped: read('dropped'),
    droppedIds: read('droppedIds'),
    droppedBySpecies: read('droppedBySpecies'),
    droppedByPool: read('droppedByPool'),
    pools: read('pools'),
  };

  check('window.__beastPool 存在且可读', true, { keys: Object.keys(raw) });
  check('requested 是整数且 >0', Number.isInteger(before.requested) && before.requested > 0, before);
  check('accepted 是整数且 >0', Number.isInteger(before.accepted) && before.accepted > 0, { accepted: before.accepted });
  check('dropped 是整数且 ≥0', Number.isInteger(before.dropped) && before.dropped >= 0, { dropped: before.dropped });
  check('requested === accepted + dropped', before.requested === before.accepted + before.dropped, before);
  check('dropped === droppedIds.length', before.dropped === before.droppedIds.length,
    { dropped: before.dropped, ids: before.droppedIds.length });
  const bySpeciesSum = Object.values(before.droppedBySpecies || {}).reduce((a, b) => a + b, 0);
  check('droppedBySpecies 计数总和 === dropped', bySpeciesSum === before.dropped,
    { bySpeciesSum, dropped: before.dropped, droppedBySpecies: before.droppedBySpecies });
  const byPoolSum = Object.values(before.droppedByPool || {}).reduce((a, b) => a + b, 0);
  check('droppedByPool 计数总和 === dropped', byPoolSum === before.dropped,
    { byPoolSum, dropped: before.dropped, droppedByPool: before.droppedByPool });

  const actualBeasts = cs && cs.beasts ? cs.beasts.length : -1;
  check('accepted === 场上真实兽体数', before.accepted === actualBeasts,
    { accepted: before.accepted, actualBeasts });

  const body = before.pools && before.pools.body;
  check('pools.body 账本存在且 used ≤ max', !!body && body.used <= body.max, { body });
  if (body) {
    check('pools.body.used 与实例池 count 一致', body.used === cs.pools.body.count,
      { reportUsed: body.used, poolCount: cs.pools.body.count });
  }

  // ---- 验证「槽位不足 → 跳过 + 记账」路径 ----
  let dropExercise = null;
  try {
    const b = cs.pools.body;
    const savedCount = b.mesh.count;
    const savedCursor = b.cursor;
    // 把 body 池装到满（矩阵全是零缩放，画面不可见；只在同步块内维持，不跨帧）
    b.mesh.count = b.max;
    const reqBefore = read('requested');
    const dropBefore = read('dropped');
    cs.addBeast(
      { id: 'PROBE-DROP', key: 'probe', name: '探针占位', group: 'small', feat: [], color: 0xffffff, accent: 0xffffff },
      { x: 0, z: 0, y: 0, n: 1, r: 0, speed: 0, host: 'city' },
      0,
    );
    const reqAfter = read('requested');
    const dropAfter = read('dropped');
    const idsAfter = read('droppedIds');
    dropExercise = {
      reqBefore, reqAfter, dropBefore, dropAfter,
      incremented: reqAfter === reqBefore + 1 && dropAfter === dropBefore + 1,
      recorded: idsAfter.includes('PROBE-DROP'),
      bySpecies: read('droppedBySpecies'),
    };
    // 恢复池的高水位（不删任何已入场的兽；本次同步块内没有渲染帧）
    b.mesh.count = savedCount;
    b.cursor = savedCursor;
  } catch (err) {
    dropExercise = { error: String(err && err.stack ? err.stack : err) };
  }
  check('占满 body 池后再要一只：跳过但记账（requested+1 / dropped+1）',
    !!dropExercise && dropExercise.incremented === true, dropExercise || {});
  check('丢弃明细含 species id（PROBE-DROP）',
    !!dropExercise && dropExercise.recorded === true, dropExercise || {});

  const after = {
    requested: read('requested'),
    accepted: read('accepted'),
    dropped: read('dropped'),
    droppedIds: read('droppedIds'),
    droppedBySpecies: read('droppedBySpecies'),
  };
  check('记账后 requested === accepted + dropped 仍成立',
    after.requested === after.accepted + after.dropped, after);

  // 运行时 console.warn 只在初始化时发；探针态把明细补一条，便于人工核对
  if (after.dropped > before.dropped) {
    console.warn(`[probe] 兽池跳过明细：${after.droppedIds.join(', ')}`);
  }

  return {
    checks,
    before,
    after,
    dropExercise,
    report,
    beasts: actualBeasts,
    poolSet: !!cs,
  };
});

await browser.close();

const failed = out.checks.filter((c) => !c.ok).length;
for (const c of out.checks) {
  const mark = c.ok ? 'PASS' : 'FAIL';
  const detail = Object.entries(c)
    .filter(([k]) => k !== 'name' && k !== 'ok')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  console.log(`[${mark}] ${c.name}${detail ? ' | ' + detail : ''}`);
}
console.log(JSON.stringify({
  total: out.checks.length,
  failed,
  before: out.before,
  after: out.after,
  dropExercise: out.dropExercise,
  beasts: out.beasts,
  pageErrors,
}, null, 2));
if (failed > 0) process.exitCode = 1;
