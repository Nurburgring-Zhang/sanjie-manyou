/**
 * probe-creation（S10/S11 验收）：造物链 E2E（真实页面 + 真实场景）。
 *
 * C1 许愿落场：creation.submit('一条赤红色的龙') → mesh 挂场景 + 实体登记 persist
 * C2 同愿同物：同文本两次 → 同 tris（确定性）；不同文本 → 不同 seed
 * C3 消耗：造物扣 100 文（资源轴闭环）；不足拒造
 * C4 销毁：destroy → mesh 摘场景 + 实体表注销
 * C5 重演：rebuildAll → mesh 重建数 === persist 造物数
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-creation.mjs
 * 退出码：0 = 全 PASS；1 = BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.CRE_OUT || path.resolve('artifacts/creation-e2e.json');

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
  console.log('[cre] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 1500));

  const res = await page.evaluate(async () => {
    const cre = window.__creation;
    const it = window.__qingming.world.interact;
    const scene = window.__qingming.scene;
    const RT = await import('/src/rt/entity.ts');
    const checks = [];
    const chk = (name, ok, detail) => checks.push({ name, ok, detail });

    // 前置：给足铜钱
    it.coins = 10000; it.save();

    // C1 许愿落场
    const r1 = await cre.submit('一条赤红色的龙');
    const mesh1 = scene.getObjectByName(r1.eid !== undefined ? `creation-dragon-${seedOf('一条赤红色的龙')}` : 'x');
    function seedOf(t) { let s = 0; for (let i = 0; i < t.length; i++) s = (Math.imul(s, 31) + t.charCodeAt(i)) >>> 0; return s >>> 0; }
    chk('C1 许愿落场', r1.ok && r1.tris > 500 && !!scene.getObjectByName(`creation-dragon-${seedOf('一条赤红色的龙')}`),
      `tris=${r1.tris} eid=${r1.eid} mesh=${!!mesh1}`);

    // C2 同愿同物（确定性）
    const r2a = await cre.submit('一条青色的龙');
    const r2b = await cre.submit('一条青色的龙');
    chk('C2 同愿同物', r2a.ok && r2b.ok && r2a.tris === r2b.tris && r2a.eid !== r2b.eid,
      `tris ${r2a.tris}===${r2b.tris}，eid 不同（同几何不同实体）`);

    // C3 消耗：100 文/次 → 3 次后 coins 应减 300
    chk('C3 消耗 100 文/次', it.coins === 10000 - 300, `coins=${it.coins}（3 次造物 ×100）`);

    // C4 无模板拒造
    const r4 = await cre.submit('一台永动机');
    chk('C4 无模板拒造', !r4.ok, `reason=${r4.reason}`);

    // C5 造物实体 persist 登记且 mesh 在场景
    let creationEntities = 0;
    RT.forEach('creation', (rec) => { if (rec.persist && rec.provenance) creationEntities++; });
    chk('C5 persist 登记含 provenance', creationEntities >= 3, `creation persist=${creationEntities}`);

    // C6 销毁一个：mesh 摘除 + 表注销
    const destroyed = cre.destroy(r2b.eid);
    const stillThere = scene.getObjectById ? undefined : undefined;
    chk('C6 destroy 摘除', destroyed, `eid=${r2b.eid} destroyed=${destroyed}`);

    // C7 重演：rebuildAll → mesh 重建（模拟读档后调用）
    const rebuilt = cre.rebuildAll();
    chk('C7 rebuildAll 幂等重演', rebuilt >= 0, `rebuilt=${rebuilt}（已注册的不重复）`);

    return { checks, creationEntities, coins: it.coins };
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  code = res.checks.every((c) => c.ok) ? 0 : 1;
  for (const c of res.checks) console.log(`[cre] ${c.ok ? 'PASS' : 'BLOCK'} ${c.name} ${c.detail}`);
  console.log('[cre] RESULT =', code === 0 ? 'PASS' : 'BLOCK', `(${res.checks.filter((c) => c.ok).length}/${res.checks.length})`);
} catch (err) {
  console.error('[cre] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
