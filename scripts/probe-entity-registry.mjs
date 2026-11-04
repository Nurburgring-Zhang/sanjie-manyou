/**
 * P0-1 步 1 验收探针：实体表页面内交叉核（A1）+ 运行时快照。
 *
 * A1（spec §5）：entityStats().alive === 场景内实体实测数（crowd.actors.length + beasts 数——
 * creations 当前 0，buildings 是烘焙静态无运行时实体，步 1 范围 = npc+beast 两类，与 spec A1 的
 * 全类目标差建筑/造物两项，此处按实际登记范围交叉核，步 2/3 扩类后同步扩断言）。
 *
 * 附带记录：byKind 分布 / idSeq / eid 抽样与 Actor.id 的独立性。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-entity-registry.mjs
 * 退出码：0 = A1 PASS；1 = BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.ER_OUT || path.resolve('artifacts/entity-registry-step1.json');

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
  console.log('[reg] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2500)); // crowd 铺开 + 灵兽进场

  const res = await page.evaluate(async () => {
    const RT = await import('/src/rt/entity.ts');
    const Q = window.__qingming;
    const st = RT.entityStats();
    const crowdN = Q.world.crowd.actors.length;
    const beastN = Q.world.creatures?.beasts?.length ?? null;
    // eid 抽样：前 5 个 actor 的 eid 与 Actor.id 独立性
    const sample = Q.world.crowd.actors.slice(0, 5).map((a) => ({ id: a.id, eid: a.eid ?? null }));
    return {
      stats: st,
      crowdN,
      beastN,
      expectedAlive: beastN === null ? null : crowdN + beastN,
      sample,
      eidDistinct: sample.every((s) => s.eid !== null && s.eid > 0),  // eid 为实体表独立序列（与 Actor.id 起点同值恰相等是预期，非依赖）
    };
  });

  if (res.expectedAlive === null) {
    console.error('[reg] FATAL: world.creatures 不可达');
  } else {
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, ...res }, null, 1));
    console.log(`[reg] entityStats: alive=${res.stats.alive} allocated=${res.stats.allocated} byKind=${JSON.stringify(res.stats.byKind)} idSeq=${res.stats.idSeq}`);
    console.log(`[reg] 实测：crowd=${res.crowdN} beasts=${res.beastN} → 期望 alive=${res.expectedAlive}`);
    console.log(`[reg] eid 抽样（前5 actor，eid 与池内 id 独立）: ${JSON.stringify(res.sample)} distinct=${res.eidDistinct}`);
    const pass = res.stats.alive === res.expectedAlive && res.stats.byKind.npc === res.crowdN && res.stats.byKind.beast === res.beastN && res.eidDistinct;
    code = pass ? 0 : 1;
    console.log(code === 0 ? '[reg] RESULT=PASS（A1 交叉核成立）' : '[reg] RESULT=BLOCK（alive ≠ 实测实体数）');
  }
} catch (err) {
  console.error('[reg] FAILED:', String(err).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
