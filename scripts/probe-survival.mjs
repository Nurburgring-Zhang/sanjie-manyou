/**
 * probe-survival（P1-2 玩法实体验收）：生存循环状态机 + Boss 利品 + 进食 + 持久化（真实页面）。
 * W1 饥饿消耗 / W2 饿空扣血 / W3 饱腹回血 / W4 重伤晕倒+迁移回调 / W5 Boss 利品蟠桃 /
 * W6 进食恢复 / W7 serialize roundtrip。
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-survival.mjs
 * 退出码：0 = 全 PASS；1 = BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.SUR_OUT || path.resolve('artifacts/survival.json');

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
  await page.setViewport({ width: 1280, height: 720 });
  console.log('[sur] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 1500));

  const res = await page.evaluate(async () => {
    const Q = window.__qingming;
    const sv = Q.world.survival;
    const it = Q.world.interact;
    const checks = [];
    const chk = (name, ok, detail) => checks.push({ name, ok, detail });

    sv.deserialize({ hp: 100, hunger: 50 });
    const h0 = sv.hunger;
    sv.tick(60);
    chk('W1 饥饿消耗', sv.hunger < h0, `hunger ${h0} → ${sv.hunger.toFixed(1)}（60s）`);

    sv.deserialize({ hp: 100, hunger: 0 });
    sv.tick(10);
    chk('W2 饿空扣血', sv.hp < 100, `hp 100 → ${sv.hp.toFixed(1)}（饿 10s）`);

    sv.deserialize({ hp: 50, hunger: 100 });
    sv.tick(10);
    chk('W3 饱腹回血', sv.hp > 50, `hp 50 → ${sv.hp.toFixed(1)}（饱 10s）`);

    const coins0 = it.coins;
    sv.deserialize({ hp: 100, hunger: 80 });
    let migrated = false;
    sv.onFaint = () => { migrated = true; sv.revive(); };
    const fainted = sv.damage(150);
    chk('W4 重伤晕倒+迁移回调', fainted && migrated && sv.hp === 60, 'hp→0 晕倒，revive 后 60');
    sv.deserialize({ hp: 100, hunger: 80 });
    it.coins = coins0 + 100; it.save();                 // 回填，避免影响后续断言

    sv.deserialize({ hp: 100, hunger: 80 });
    it.peach = 1;
    const peach0 = it.peach;
    const r = sv.bossReward();
    it.addPeach(r);
    chk('W5 Boss 利品蟠桃', r === 1 && it.peach === peach0 + 1 && sv.bossesDown >= 1,
      `reward=${r} peach ${peach0}→${it.peach} bossesDown=${sv.bossesDown}`);

    sv.deserialize({ hp: 60, hunger: 30 });
    sv.eat(30, 10);
    chk('W6 进食恢复', sv.hunger === 60 && sv.hp === 70, 'hunger 30→60, hp 60→70');

    sv.deserialize({ hp: 42, hunger: 77, faints: 3, bossesDown: 2 });
    const snap = sv.serialize();
    chk('W7 serialize/deserialize', snap.hp === 42 && snap.hunger === 77 && snap.faints === 3 && snap.bossesDown === 2,
      JSON.stringify(snap));
    sv.deserialize({ hp: 100, hunger: 100 });

    return { checks };
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  code = res.checks.every((c) => c.ok) ? 0 : 1;
  for (const c of res.checks) console.log(`[sur] ${c.ok ? 'PASS' : 'BLOCK'} ${c.name} ${c.detail}`);
  console.log('[sur] RESULT =', code === 0 ? 'PASS' : 'BLOCK', `(${res.checks.filter((c) => c.ok).length}/${res.checks.length})`);
} catch (err) {
  console.error('[sur] FAILED:', String(err).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
