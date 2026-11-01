/** 硬件 p95 归因：关/开 Bloom 与 SSAO 各量 3 秒，看谁在吃帧时间（打包版，真 GPU） */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const exe = process.argv[2];
const PORT = 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(500); } }
if (!ver) { console.log('NO_CDP'); proc.kill(); process.exit(1); }
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null, protocolTimeout: 240000 });
const pages = await browser.pages();
const page = pages.find((p) => !p.url().startsWith('devtools://')) ?? pages[0];
const poll = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await page.evaluate(fn)) return true; } catch {} await sleep(600); } return false; };
await poll(() => typeof window.__qingming === 'object', 120000);
await poll(() => !document.getElementById('loading'), 150000);
await sleep(2500);
const measure = async (label) => {
  await page.evaluate(() => { const e = window.__qingming.engine; e.frameMs.length = 0; e.maxFrameMs = 0; });
  await sleep(3000);
  const r = await page.evaluate(() => { const e = window.__qingming.engine; const a = e.frameMs.slice().sort((x, y) => y - x); return { n: a.length, p50: Math.round(a[Math.floor(a.length*0.5)] ?? 0), p95: Math.round(a[Math.floor(a.length*0.05)] ?? 0) }; });
  console.log(label, JSON.stringify(r));
};
await measure('baseline');
await page.evaluate(() => { window.__qingming.engine.bloomPass.enabled = false; });
await measure('no-bloom');
await page.evaluate(() => { const e = window.__qingming.engine; e.bloomPass.enabled = true; if (e.ssaoPass) e.ssaoPass.enabled = false; });
await measure('no-ssao');
await page.evaluate(() => { const e = window.__qingming.engine; if (e.ssaoPass) e.ssaoPass.enabled = true; e.quality.pixelRatio; });
await browser.disconnect();
proc.kill();
