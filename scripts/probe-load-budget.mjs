/** 载入预算门：任一加载步 >1200ms 即 FAIL（给 SPEC §11 一个机检出口，防止「慢」被当「没问题」） */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
const b = await puppeteer.launch({ executablePath: CHROME, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded', timeout:120000 });
await p.waitForFunction(()=>!document.getElementById('loading'), { timeout:180000 });
await new Promise(r=>setTimeout(r,600));
const t = await p.evaluate(() => window.__loadTimings || []);
const over = t.filter(([, ms]) => ms > 1200);
const total = t.reduce((a, [, ms]) => a + ms, 0);
console.log(JSON.stringify({ steps: t.length, totalMs: Math.round(total), over: over.map(([n, ms]) => `${n}:${Math.round(ms)}`), pass: over.length === 0 }, null, 1));
await b.close();
