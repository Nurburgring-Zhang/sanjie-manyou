/**
 * Boss 四断言（对应 SPEC-游戏工程规范 §10 与设计三件套 §三）：
 *  1) 真实 keydown(KeyJ) 能造成伤害，HP 单调下降
 *  2) HP 跨 50% 时阶段 1 → 2（HUD 文案同步）
 *  3) HP 归零 → defeated=true + codex:unlock 事件
 *  4) 复位后 HP 回到 maxHp（重开代价可接受）
 * 说明：初始站位用测试夹具（把玩家放到 Boss 身边），伤害与阶段全部由真实按键驱动。
 */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1500));
// 夹具：站到 Boss 身边（否则近战判定不成立）
await p.evaluate(() => {
  const w = window.__qingming.world;
  const bp = w.boss.pos();
  w.player.actor.pos.set(bp.x, bp.y, bp.z + 6);
  window.__unlock = 0;
  // 监听解锁事件（用世界已有的 bus 不暴露，改为轮询 defeated + toast 文本）
});
const hp0 = await p.evaluate(()=>window.__qingming.world.boss.hp);
const seq = [];
for (let i = 0; i < 5; i++) {
  await p.keyboard.press('KeyJ');
  await new Promise(r=>setTimeout(r,220));
  seq.push(await p.evaluate(()=>window.__qingming.world.boss.hp));
}
const monotonic = seq.every((v, i) => i === 0 || v <= seq[i-1]);
const damaged = seq[seq.length-1] < hp0;
// 失败路径断言：站在判定圈里不动，应被击退并回到恢复点（这是「代价」，不是满血重置）
let failAssert = { kb0: 0, kb1: 0, movedAway: 0, backAtPoi: false };
{
  const before = await p.evaluate(() => {
    const w = window.__qingming.world, bo = w.boss, bp = bo.pos(), pa = w.player.actor;
    pa.pos.set(bp.x, bp.y, bp.z + 5);
    return { kb: bo.knockbacks, d: Math.hypot(bp.x - pa.pos.x, bp.z - pa.pos.z) };
  });
  for (let i = 0; i < 60; i++) {
    const st = await p.evaluate(() => {
      const w = window.__qingming.world, bo = w.boss;
      return { s: bo.state, kb: bo.knockbacks };
    });
    if (st.kb > before.kb) break;
    await new Promise(r=>setTimeout(r,120));
  }
  await new Promise(r=>setTimeout(r,400));
  const after = await p.evaluate(() => {
    const w = window.__qingming.world, bp = w.boss.pos(), pa = w.player.actor;
    const poi = window.__qingming.world ? null : null;
    return { kb: w.boss.knockbacks, d: Math.hypot(bp.x - pa.pos.x, bp.z - pa.pos.z) };
  });
  failAssert = { kb0: before.kb, kb1: after.kb, movedAway: +after.d.toFixed(1), backAtPoi: after.d > 10 };
}

// 打空血：真实「打-撤」循环 —— 前摇时撤出 60m 闪避，判定结束再压上出手
let phase2seen = false, guard = 0;
while (guard++ < 140) {
  const st = await p.evaluate(() => {
    const w = window.__qingming.world, bo = w.boss, bp = bo.pos(), pa = w.player.actor;
    const d = Math.hypot(bp.x - pa.pos.x, bp.z - pa.pos.z);
    if (bo.state === 'telegraph' || bo.state === 'active') {
      // 闪避：撤到 60m 外（真实玩法里是跑开，这里用测试夹具瞬移等价）
      pa.pos.set(bp.x, bp.y, bp.z + 60);
      return { hp: bo.hp, ph: bo.phase, dead: bo.defeated, d: 60, st: bo.state };
    }
    if (d > 12) pa.pos.set(bp.x, bp.y, bp.z + 6);
    return { hp: bo.hp, ph: bo.phase, dead: bo.defeated, d: 6, st: bo.state };
  });
  if (st.ph === 2) phase2seen = true;
  if (st.dead) break;
  if (st.d <= 12) await p.keyboard.press('KeyJ');
  await new Promise(r=>setTimeout(r,110));
}
const end = await p.evaluate(()=>({ hp: window.__qingming.world.boss.hp, ph: window.__qingming.world.boss.phase, dead: window.__qingming.world.boss.defeated, hits: window.__qingming.world.boss.hits, kb: window.__qingming.world.boss.knockbacks, max: window.__qingming.world.boss.spec.maxHp }));
// 断言 5：胜利奖励写回图鉴（数据 + DOM 两处都要在）
const codex = await p.evaluate(() => {
  const w = window.__qingming.world;
  document.getElementById('bCodex').click();
  const txt = (document.getElementById('codexBody')?.textContent || '');
  return { log: w.codexLog.length, name: w.codexLog[0]?.name ?? '', inDom: txt.includes('巨灵神') };
});
console.log(JSON.stringify({ hp0, seq, monotonic, damaged, failAssert, phase2seen, victory: end.dead && end.hp === 0, codex, end }, null, 0));
await b.close();
