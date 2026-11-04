/**
 * P0-4 验收探针：真实 IndexedDB 全链（页面内动态 import /src/rt/save.ts）。
 *
 * 断言（清单 v3 P0-4 验收 + H4 五修订）：
 *   S1 原子写：save(v2) → load 回读逐值一致
 *   S2 坏档回退：lastGood 槽写坏（JSON 截断）→ load 自动回退上一完好槽 → 逐值一致（H4 恢复演练语义）
 *   S3 显式 abort：tx.abort() 后两 store 均回滚 + DB 未被毒坏（可继续写）
 *   S4 legacy 迁移：清 IDB + 写 localStorage 三键 → loadOrMigrateLegacy → v2 且 economy 映射且已落 IDB
 *   S5 persist/estimate 实录（persist 结果不影响判定，如实记录）
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-save-atomic.mjs
 * 退出码：0 = 全 PASS；1 = 有 BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.SAVE_OUT || path.resolve('artifacts/save-atomic.json');

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
  console.log('[save] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming, { timeout: 240000 });

  const res = await page.evaluate(async () => {
    const S = await import('/src/rt/save.ts');
    const checks = [];
    const chk = (name, ok, detail = '') => checks.push({ name, ok, detail });

    // 清场：删旧库 + 清 localStorage（迁移断言需要干净起点）
    await new Promise((res2) => {
      const rq = indexedDB.deleteDatabase('sanjie-save');
      rq.onsuccess = rq.onerror = rq.onblocked = () => res2();
    });
    localStorage.removeItem('cq_coins'); localStorage.removeItem('cq_yinde'); localStorage.removeItem('cq_peach');

    const mgr = new S.SaveManager();
    await mgr.open();

    // S1 原子写 + 回读一致（legacy 三键迁移到 v2 作为数据来源，一石二鸟）
    const data = S.migrate({ schemaVersion: 1, coins: 777, yinde: 9, peach: 5 });
    const w = await mgr.save(data);
    const back = await mgr.load();
    chk('S1 原子写+回读一致', !!back && back.economy.coins === 777 && back.economy.peach === 5,
      `slot=${w.slot} bytes=${w.bytes}`);

    // S2 坏档回退：往 lastGood 槽直写截断 JSON（模拟断电半写）→ load 必须回退到上一完好槽
    const lastGood = await new Promise((res2) => {
      const tx = mgr['db'].transaction('index', 'readonly');
      const rq = tx.objectStore('index').get('lastGood');
      rq.onsuccess = () => res2((rq.result).lastGood);
    });
    // 先确保存在一个上一完好槽：再写一份不同数据（v_next），然后弄坏 lastGood
    const dataNext = S.migrate({ schemaVersion: 1, coins: 888, yinde: 1, peach: 1 });
    await mgr.save(dataNext);
    await new Promise((res2) => {
      const tx = mgr['db'].transaction('slots', 'readwrite');
      tx.objectStore('slots').put(JSON.stringify(data).slice(0, 200), lastGood);   // 截断半写
      tx.oncomplete = () => res2();
    });
    const recovered = await mgr.load();
    chk('S2 坏档回退', !!recovered && recovered.economy.coins === 888,
      `lastGood=${lastGood} 截断 → 回退到完好槽 coins=888`);

    // S3 显式 abort 回滚（H4 修订②的实现语义验证）：往两 store 各 put 后显式 abort → 全回滚
    const db = mgr['db'];
    await new Promise((res2) => {
      const tx = db.transaction(['slots', 'index'], 'readwrite');
      tx.objectStore('slots').put('{"abort":true}', 'save:abort-test');
      tx.objectStore('index').put({ lastGood: 'save:abort-test' }, 'lastGood');
      tx.abort();
      tx.onabort = () => res2();
      tx.onerror = () => res2();
    });
    const afterAbort = await mgr.load();
    const abortRolled = afterAbort && afterAbort.economy.coins === 888;   // lastGood 未被污染
    const abortSlotGone = await new Promise((res2) => {
      const tx = db.transaction('slots', 'readonly');
      const rq = tx.objectStore('slots').get('save:abort-test');
      rq.onsuccess = () => res2(rq.result === undefined);
    });
    chk('S3 显式 abort 回滚', !!abortRolled && abortSlotGone, 'abort 后两 store 均回滚、lastGood 未污染');
    // DB 未被毒坏：继续正常写
    await mgr.save(S.migrate({ schemaVersion: 1, coins: 777, yinde: 9, peach: 5 }));
    const postFail = await mgr.load();
    chk('S3b 失败后 DB 可继续写', !!postFail && postFail.economy.coins === 777);

    // S4 legacy 迁移：清 IDB + localStorage 三键 → loadOrMigrateLegacy → v2 且已落 IDB
    mgr.close();
    await new Promise((res2) => {
      const rq = indexedDB.deleteDatabase('sanjie-save');
      rq.onsuccess = rq.onerror = rq.onblocked = () => res2();
    });
    localStorage.setItem('cq_coins', '250'); localStorage.setItem('cq_yinde', '3'); localStorage.setItem('cq_peach', '1');
    const mgr2 = new S.SaveManager();
    await mgr2.open();
    const migrated = await S.loadOrMigrateLegacy(mgr2, localStorage);
    const migratedPersisted = !!migrated && (await mgr2.load())?.economy.coins === 250;
    chk('S4 legacy 迁移', !!migrated && migrated.schemaVersion === 2 && migrated.economy.coins === 250 && migratedPersisted,
      `三键 250/3/1 → v2 且二次读回确认落档`);

    // S5 persist / estimate 实录（persist 结果不影响判定）
    const persisted = await mgr2.requestPersist();
    const est = await mgr2.estimate();
    chk('S5 persist/estimate 实录', true, `persist=${persisted} usage=${(est.usage / 1048576).toFixed(1)}MB quota=${(est.quota / 1048576).toFixed(0)}MB`);
    mgr2.close();

    return { checks };
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  code = res.checks.every((c) => c.ok) ? 0 : 1;
  for (const c of res.checks) console.log(`[save] ${c.ok ? 'PASS' : 'BLOCK'} ${c.name} ${c.detail}`);
  console.log('[save] RESULT =', code === 0 ? 'PASS' : 'BLOCK');
} catch (err) {
  console.error('[save] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
