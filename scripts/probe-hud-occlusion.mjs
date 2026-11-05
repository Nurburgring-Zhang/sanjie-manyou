/**
 * probe-hud-occlusion（P1-8 验收）：三套 UI 布局矩阵的实测断言。
 *
 * 断言（spec P1-8-UI布局矩阵.md §3）：
 *   H1 中央 640×360 零侵入（2 模式 × 2 分辨率实测；build/wish DOM 未实装，实装后扩）
 *   H2 同模式 HUD 互不重叠（白名单：topbar 行内兄弟排版正常态）
 *   H4 键位源码断言：KeyY 未被占用（wish 未实装，出现即违规）；KeyG 未与许愿绑定
 *   H3/H5 PENDING（hotbar/编辑器 DOM 属 P1-2/P1-5 实装，DOM 存在后启用）
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-hud-occlusion.mjs
 * 退出码：0 = 全 PASS；1 = BLOCK；2 = 环境失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.OCCL_OUT || path.resolve('artifacts/hud-occlusion.json');

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
  console.log('[occl] goto', URL);

  // H4 键位源码断言（Node 侧 grep src/）
  const srcDir = path.resolve('src');
  const keyGHits = [], keyYHits = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, f.name);
      if (f.isDirectory()) walk(fp);
      else if (f.name.endsWith('.ts')) {
        const t = fs.readFileSync(fp, 'utf-8');
        if (t.includes('KeyG')) keyGHits.push(path.relative(srcDir, fp));
        if (t.includes('KeyY')) keyYHits.push(path.relative(srcDir, fp));
      }
    }
  };
  walk(srcDir);
  const h4KeyG = keyGHits.every((f) => /engine|player|ui/.test(f));
  const h4KeyY = keyYHits.length === 0;
  const h4Pass = h4KeyG && h4KeyY;

  // 每组合 fresh load（视口在 goto 前设定——resize 过渡竞态的根治）
  const res = { h1: [], h2: [] };
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    for (const mode of ['soul', 'avatar']) {
      await page.setViewport({ width: w, height: h });
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
      await new Promise((r) => setTimeout(r, 1500));
      const one = await page.evaluate(async ([mode, w, h]) => {
        const Q = window.__qingming;
        const pl = Q.world.player;
        if (pl.mode !== mode && typeof pl.toggleMode === 'function') pl.toggleMode();
        await new Promise((r) => setTimeout(r, 300));

        const hudEls = () => Array.from(document.querySelectorAll('#ui *')).filter((el) => {
          // poiGuide 子树剔除（先于一切）：世界空间 POI 投影标记——非 HUD
          let anc0 = el.parentElement;
          while (anc0 && anc0.id !== 'ui') {
            if (anc0.id === 'poiguide') return false;
            anc0 = anc0.parentElement;
          }
          // 叶子可见元素口径：容器（有子元素）不计——占用矩形以真实可见单元为准
          if (el.children.length > 0) return false;
          // 有效不可见沿祖先链查：任何一层 opacity<0.1 / visibility hidden / display none，
          // 其后代全部不可见
          let anc = el;
          while (anc && anc !== document.body) {
            const s = getComputedStyle(anc);
            if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.1) return false;
            anc = anc.parentElement;
          }
          const r = el.getBoundingClientRect();
          return !(r.width < 8 || r.height < 8);
        });
        const pathOf = (el) => {
          const parts = [];
          let cur = el;
          while (cur && cur.id !== 'ui') {
            parts.unshift(cur.tagName + (cur.id ? '#' + cur.id : '') + (cur.className ? '.' + String(cur.className).split(' ')[0] : ''));
            cur = cur.parentElement;
          }
          return parts.join('>');
        };
        const rects = hudEls().map((el) => {
          const r = el.getBoundingClientRect();
          return { id: pathOf(el), x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
        }).filter((r) => r.x1 > 0 && r.y1 > 0);

        // H1：中央 640×360 零侵入
        const cx0 = w / 2 - 320, cx1 = w / 2 + 320, cy0 = h / 2 - 180, cy1 = h / 2 + 180;
        const intruders = rects.filter((r) => r.x1 > cx0 && r.x0 < cx1 && r.y1 > cy0 && r.y0 < cy1);

        // H2：两两重叠（白名单：topbar 行内兄弟排版正常态）
        const WL = (a, b) => {
          const bare = (s) => (s.match(/#[a-z-]+/g) || []).join('');
          const bp = bare(a), bq = bare(b);
          if ((bp.includes('#ticker') && bq.includes('#stats')) || (bp.includes('#stats') && bq.includes('#ticker'))) return true;
          return false;
        };
        const overlaps = [];
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1 && !WL(a.id, b.id)) {
              overlaps.push(`${a.id} × ${b.id}`);
            }
          }
        }

        return [{
          w, h, mode,
          vp: [window.innerWidth, window.innerHeight],
          uiH: document.getElementById('ui').getBoundingClientRect().height,
          intruders: intruders.map((r) => r.id),
          overlaps,
          h1pass: intruders.length === 0,
          h2pass: overlaps.length === 0,
        }];
      }, [mode, w, h]);
      for (const r of one) {
        res.h1.push(r);
        res.h2.push(r);
      }
    }
  }

  const h1Pass = res.h1.every((r) => r.h1pass);
  const h2Pass = res.h2.every((r) => r.h2pass);

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(), url: URL,
    h1: res.h1, h2: res.h2,
    h4: { keyGHits, keyYHits, pass: h4Pass },
    h3h5h6: 'PENDING——hotbar/编辑器 DOM 属 P1-2/P1-5 实装（spec §5 诚实标注）',
  }, null, 1));

  for (const r of res.h1) {
    console.log(`[occl] H1 ${r.w}×${r.h} ${r.mode}: ${r.h1pass ? 'PASS' : 'BLOCK ' + r.intruders.join(',')}`);
    if (!r.h2pass) console.log(`[occl] H2 ${r.w}×${r.h} ${r.mode}: BLOCK ${r.overlaps.join(' | ')}`);
    else console.log(`[occl] H2 ${r.w}×${r.h} ${r.mode}: PASS`);
  }
  console.log(`[occl] H4 键位: KeyG@${keyGHits.join(',') || '-'} KeyY@${keyYHits.join(',') || '-'} → ${h4Pass ? 'PASS' : 'BLOCK'}`);
  console.log('[occl] H3/H5/H6 = PENDING（DOM 实装后启用）');
  console.log('[occl] RESULT =', h1Pass && h2Pass && h4Pass ? 'PASS（已实装范围）' : 'BLOCK');
  code = h1Pass && h2Pass && h4Pass ? 0 : 1;
} catch (err) {
  console.error('[occl] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
