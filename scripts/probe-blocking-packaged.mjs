/** 打包版阻塞复测（真 GPU）：读应用自带的 frameMs 环形缓冲，按生成窗口统计 p95/max */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const exe = process.argv[2];
const PORT = 9333;
const proc = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver = null;
for (let i = 0; i < 40; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(500); } }
if (!ver) { console.log('NO_CDP'); proc.kill(); process.exit(1); }
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null, protocolTimeout: 240000 });
const pages = await browser.pages();
const p = pages.find((x) => x.url().startsWith('file://')) || pages[0];
await p.waitForFunction(() => window.__qingming?.world?.boss, { timeout: 240000 });
await sleep(2500);
const r = await p.evaluate(() => {
  const e = window.__qingming.engine;
  const a = e.frameMs.slice().sort((x, y) => y - x);
  return { frames: a.length, maxMs: Math.round(e.maxFrameMs), p95Ms: Math.round(a[Math.floor(a.length * 0.05)] ?? 0), calls: e.renderer.info.render.calls };
});
console.log(JSON.stringify({ ...r, hardwareBlockingOk: r.p95Ms < 400 }));
await browser.disconnect();
proc.kill();
