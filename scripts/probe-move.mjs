import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:180000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,1200));
const run = async (mode) => {
  await p.evaluate((m) => { const w = window.__qingming.world; if (w.player.mode !== m) w.player.toggleMode(); }, mode);
  await new Promise(r=>setTimeout(r,600));
  const before = await p.evaluate(() => { const pl = window.__qingming.world.player; const e = pl.engine; return { x: pl.actor.pos.x, z: pl.actor.pos.z, yaw: pl.camYaw, cx: e.camera.position.x, cz: e.camera.position.z }; });
  await p.keyboard.down('KeyW'); await new Promise(r=>setTimeout(r,1200)); await p.keyboard.up('KeyW');
  const after = await p.evaluate(() => { const pl = window.__qingming.world.player; return { x: pl.actor.pos.x, z: pl.actor.pos.z }; });
  const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz);
  const fx = -Math.sin(before.yaw), fz = -Math.cos(before.yaw);
  const dot = len > 0.001 ? (dx / len) * fx + (dz / len) * fz : 0;
  return { mode, moved: +len.toFixed(2), dot: +dot.toFixed(3), ok: len > 0.3 && dot > 0.8 };
};
console.log(JSON.stringify({ avatar: await run('avatar'), soul: await run('soul') }));
await b.close();
