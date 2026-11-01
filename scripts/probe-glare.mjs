/**
 * 过曝机检（GLARE）：找「线性亮度 > bloom 阈值 1.05」的顶点色。
 *
 * 背景：这个项目反复出现同一种爆白——浅色件（云托 0xd6dee8、瑶池 0xd8c8a0、玉柱 0xfff3d8、鼓面 0xd8c8a0）
 * 在强光下线性亮度越过 UnrealBloomPass 的阈值（engine.ts 里 threshold=1.05），整片晕成白光团。
 * 判据：linear = 0.2126R + 0.7152G + 0.0722B（顶点色本身已是线性空间），led > 1.05 即越线。
 *
 * 用法：node scripts/probe-glare.mjs [url]
 * 输出：按「越线顶点数」排序的材质组清单 + 每组的代表世界坐标；pass=false 表示仍有越线面片。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));

const res = await p.evaluate(() => {
  const e = window.__qingming.engine;
  const LIMIT = 1.05;
  const byGroup = new Map();
  e.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    const col = g && g.getAttribute && g.getAttribute('color');
    if (!col) return;
    const pos = g.getAttribute('position');
    const name = (o.name || o.material?.type || 'unnamed').replace(/_\d+$/, '');
    let hit = 0, sample = null, maxL = 0;
    const stride = Math.max(1, Math.floor(col.count / 400)); // 采样，避免百万顶点卡死
    for (let i = 0; i < col.count; i += stride) {
      const r = col.getX(i), gg = col.getY(i), bb = col.getZ(i);
      const L = 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
      if (L > maxL) maxL = L;
      if (L > LIMIT) {
        hit++;
        if (!sample && pos) {
          const v = new (e.camera.position.constructor)().fromBufferAttribute(pos, i);
          sample = [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
        }
      }
    }
    if (hit > 0) {
      const cur = byGroup.get(name) || { group: name, verts: 0, sample: null, maxL: 0 };
      cur.verts += hit;
      cur.maxL = Math.max(cur.maxL, +maxL.toFixed(3));
      if (!cur.sample) cur.sample = sample;
      byGroup.set(name, cur);
    }
  });
  const list = [...byGroup.values()].sort((a, b) => b.verts - a.verts).slice(0, 12);
  const total = [...byGroup.values()].reduce((a, v) => a + v.verts, 0);
  return { limit: LIMIT, total, list };
});

// 灰名单：已知且已修的项；仍越线但属于「设计上要发光」的组（glow）单独标注
const DESIGN_GLOW = /glow/i;
const offenders = res.list.filter((x) => !DESIGN_GLOW.test(x.group));
const pass = offenders.length === 0;

console.log(JSON.stringify({ ...res, offenders: offenders.length, pass }, null, 1));
await b.close();
process.exit(pass ? 0 : 1);
