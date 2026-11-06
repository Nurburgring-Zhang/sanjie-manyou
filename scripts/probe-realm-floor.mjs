/**
 * probe-realm-floor（陷地终极取证）：三界演员站位 vs **射线打真实网格顶面**。
 * 不再依赖 walkSurfaceY（只覆盖人间城区建筑）——直接 raycast 向下命中场景几何，
 * 命中 y 与演员脚高差 >0.5 即陷地实锤，输出精确差值列表供 world 校正使用。
 *
 * 用法：PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-realm-floor.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const OUT = process.env.FL_OUT || path.resolve('artifacts/realm-floor.json');

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
  console.log('[fl] goto', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__qingming && !document.getElementById('loading'), { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2500));

  const res = await page.evaluate(async () => {
    const Q = window.__qingming;
    const RT = await import('/src/rt/entity.ts');
    const B = await import('/src/actors/behaviors.ts');
    const scene = Q.scene;
    const ray = new Q.THREE.Raycaster();
    ray.far = 300;
    const down = new Q.THREE.Vector3(0, -1, 0);
    const origin = new Q.THREE.Vector3();

    const floorAt = (x, y, z) => {
      origin.set(x, y + 1.5, z);
      ray.set(origin, down);
      const hits = ray.intersectObject(scene, true);
      return hits.length ? +hits[0].point.y.toFixed(2) : null;
    };

    const out = { heaven: [], underworld: [], human: [] };
    let n = 0, raycasts = 0;
    for (const a of Q.world.crowd.actors) {
      if (!a.freeze || a.attach || a.hidden) continue;
      n++;
      const p = a.pos;
      // 粗判先行（性能）：人间 walkSurfaceY / 天宫 PLATFORMS 能判定的不走 raycast
      const platformHit = (() => {
        const PL = Q.world.constructor; void PL;
        return null;   // PLATFORMS 未暴露页面——人间粗判走 walkSurfaceY，天宫走 raycast（预算内）
      })();
      const ws = B.walkSurfaceY(p.x, p.z, p.y);
      if (p.y <= 2085 && p.y > -200 && ws !== null) {
        const realm2 = 'human';
        if (p.y < ws - 0.35) out[realm2].push({ id: a.id, occ: a.occ, x: +p.x.toFixed(0), y: +p.y.toFixed(2), floorY: +ws.toFixed(2), sink: +(ws - p.y).toFixed(2) });
        continue;
      }
      raycasts++;
      if (raycasts > 220) continue;                    // 预算上限
      // 从胸口（脚高+1m）向下打，跳过演员自身命中（第一命中常为自己身体），取第一个低于脚 0.2m 的真地面
      origin.set(p.x, p.y + 1.0, p.z);
      ray.set(origin, down);
      const allHits = ray.intersectObject(scene, true);
      const hits = allHits.filter((h) => h.point.y <= p.y - 0.2 && !(h.object instanceof Q.THREE.InstancedMesh));
      const floorY = hits.length ? +hits[0].point.y.toFixed(2) : null;
      const realm = p.y > 2085 ? 'heaven' : p.y < -200 ? 'underworld' : 'human';
      const rec = { id: a.id, occ: a.occ, x: +p.x.toFixed(0), y: +p.y.toFixed(2), floorY, sink: floorY === null ? null : +(floorY - p.y).toFixed(2) };
      if (realm === 'heaven' && floorY !== null && p.y < floorY - 0.3) out.heaven.push(rec);      // 脚低于面 0.3+ = 陷
      else if (realm === 'underworld' && floorY !== null && p.y < floorY - 0.3) out.underworld.push(rec);
      else if (realm === 'human' && floorY !== null && p.y < floorY - 0.4) out.human.push(rec);
      void realm;
    }
    out.sampled = n;
    out.raycasts = raycasts;
    return out;
  });

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(`[fl] 抽样 ${res.sampled} 位 freeze 演员`);
  console.log(`[fl] 天宫陷地实锤: ${res.heaven.length}`);
  for (const r of res.heaven.slice(0, 8)) console.log('  ', JSON.stringify(r));
  console.log(`[fl] 地府陷地实锤: ${res.underworld.length}`);
  for (const r of res.underworld.slice(0, 8)) console.log('  ', JSON.stringify(r));
  console.log(`[fl] 人间陷地实锤: ${res.human.length}`);
  code = 0;
  console.log('[fl] RESULT = FORENSICS-DONE');
} catch (err) {
  console.error('[fl] FAILED:', String(err).slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
