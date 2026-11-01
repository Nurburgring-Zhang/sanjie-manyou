/** 音效行为验证：给 AudioContext 打桩计数，再真实触发「传送」「开图鉴」「跨界」，看节点是否真的新建 */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  window.__audioNodes = 0;
  const AC = window.AudioContext;
  if (!AC) return;
  const wrap = (k) => {
    const orig = AC.prototype[k];
    AC.prototype[k] = function (...a) { window.__audioNodes++; return orig.apply(this, a); };
  };
  ['createGain', 'createOscillator', 'createBufferSource', 'createBiquadFilter'].forEach(wrap);
});
await p.goto('http://localhost:4173/', { waitUntil:'networkidle2', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:120000 });
await new Promise(r=>setTimeout(r,1200));
// 音频在首次指针/键盘事件后才起 AudioContext（浏览器自动播放策略），先点一下
await p.mouse.click(800, 450);
await new Promise(r=>setTimeout(r,1500));
const read = () => p.evaluate(() => window.__audioNodes | 0);
const base = await read();
// 传送（人间 → 地府，跨界）
await p.evaluate(() => window.__qingming.world.teleport('naihe'));
await new Promise(r=>setTimeout(r,900));
const afterTp = await read();
// 开图鉴
await p.evaluate(() => document.getElementById('bCodex').click());
await new Promise(r=>setTimeout(r,500));
const afterCodex = await read();
// 回到人间（再跨界）
await p.evaluate(() => window.__qingming.world.teleport('bridge'));
await new Promise(r=>setTimeout(r,900));
const afterBack = await read();
console.log(JSON.stringify({ base, afterTp, afterCodex, afterBack,
  dTeleport: afterTp - base, dCodex: afterCodex - afterTp, dRealmBack: afterBack - afterCodex }));
await b.close();
