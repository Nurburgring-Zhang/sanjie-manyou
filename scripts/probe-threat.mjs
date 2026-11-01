/** 威胁接线验证：望乡台 30m 内移动应被拖慢（同按键时长位移显著变小） */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,1200));
const walk = async (poi) => {
  await p.evaluate((k) => { const w = window.__qingming.world; w.teleport(k); w.player.mode = 'avatar'; }, poi);
  await new Promise(r=>setTimeout(r,1400));
  const a = await p.evaluate(() => { const q = window.__qingming.world.player.actor.pos; return [q.x, q.z, window.__qingming.world.player.speedScale]; });
  await p.keyboard.down('KeyW');
  await new Promise(r=>setTimeout(r,1200));
  await p.keyboard.up('KeyW');
  await new Promise(r=>setTimeout(r,200));
  const b2 = await p.evaluate(() => { const q = window.__qingming.world.player.actor.pos; return [q.x, q.z]; });
  return { d: +Math.hypot(b2[0]-a[0], b2[1]-a[1]).toFixed(2), scale: a[2] };
};
const wx = await walk('wangxiang');
const zc = await walk('zichen');
// 说明：传送后处于飞行模式，W 驱动的是相机而不是化身，化身位移对比测不出；
// 这里断言 world 每帧写入的威胁系数（移动代码里 sp *= speedScale），以及进入/离开半径的切换。
console.log(JSON.stringify({ wangxiang: wx, zichen: zc, scaleOk: wx.scale === 0.55 && zc.scale === 1, slowed: wx.d > 0.3 && zc.d > 0.3 && wx.d < zc.d * 0.8 }));
await b.close();
