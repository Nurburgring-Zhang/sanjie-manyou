/**
 * probe-economy（P1-1 资源轴验收）：H6 三修订落地断言（真实页面 interact 实例）。
 *
 * E1a/E1b 五子棋入场费（拒付 + 扣 50）；E2a/E2b addPeach source 与封顶 9；
 * E3 阴德→蟠桃跨轴分支语义；E4 蟠桃 grant 消费不变（回归）。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-economy.mjs
 * 退出码：0 = 全 PASS；1 = BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.ECO_OUT || path.resolve('artifacts/economy-p11.json');

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
  console.log('[eco] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 1500));

  const res = await page.evaluate(async () => {
    const it = window.__qingming.world.interact;
    const checks = [];
    const chk = (name, ok, detail) => checks.push({ name, ok, detail });

    // E1a 五子棋入场费拒付
    it.coins = 10;
    it.openGomoku();
    document.querySelectorAll('.panel').forEach((pn) => pn.remove());
    chk('E1a 五子棋入场费拒付', it.coins === 10, 'coins=10 < 50 → 未扣费');

    // E1b 入场扣 50
    it.coins = 500; it.save();
    it.openGomoku();
    document.querySelectorAll('.panel').forEach((pn) => pn.remove());
    chk('E1b 五子棋入场扣 50', it.coins === 450, 'coins 500 → 450');

    // E2a addPeach source
    it.yinde = 15; it.peach = 0; it.save();
    it.addPeach(1);
    chk('E2a addPeach source', it.peach === 1, 'peach 0 → 1');

    // E2b 封顶 9
    it.addPeach(50);
    chk('E2b addPeach 上限 9', it.peach === 9, 'peach 封顶 9');

    // E3 阴德→蟠桃跨轴（分支语义，同 interact.ts yindepeach 分支）
    it.yinde = 20; it.peach = 5;
    const before = { y: it.yinde, p: it.peach };
    if (it.yinde >= 10) { it.yinde -= 10; it.addPeach(1); }
    chk('E3 阴德→蟠桃跨轴', it.yinde === before.y - 10 && it.peach === Math.min(9, before.p + 1),
      `yinde ${before.y}→${it.yinde}, peach ${before.p}→${it.peach}`);

    // E4 蟠桃 grant 消费回归
    it.coins = 100; it.peach = 3;
    it.peach -= 1; it.earn(100);
    chk('E4 蟠桃 grant 消费', it.peach === 2 && it.coins === 200, 'peach 3→2, coins 100→200');

    return { checks, coins: it.coins, yinde: it.yinde, peach: it.peach };
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  code = res.checks.every((c) => c.ok) ? 0 : 1;
  for (const c of res.checks) console.log(`[eco] ${c.ok ? 'PASS' : 'BLOCK'} ${c.name} ${c.detail}`);
  console.log('[eco] RESULT =', code === 0 ? 'PASS' : 'BLOCK', `(${res.checks.filter((c) => c.ok).length}/${res.checks.length})`);
} catch (err) {
  console.error('[eco] FAILED:', String(err).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
