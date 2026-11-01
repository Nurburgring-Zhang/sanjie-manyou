/**
 * R8 验收：分距离 LOD 四档 + 滞回 + 近档兜底。
 * 判据（来自 artifacts/SPEC-R1-R8.md）：
 *   ① 相机 60m→2000m 推拉，四档各命中一次；
 *   ② 切换次数 ≤6（滞回生效，不抖）；
 *   ③ 任一帧「近档环内但无网格显示」的组数 = 0（不空白）；
 *   ④ 手动把 near 档标未就绪，仍不得出现空帧（保留上一档）。
 */
import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));

const res = await p.evaluate(async () => {
  const e = window.__qingming.engine;
  const lod = window.__lod;
  if (!lod) return { err: 'no window.__lod' };
  e.stopCinema();
  lod.reset();
  // 沿中轴向远处推拉：从里坊内 60m 到 2000m
  const frames = [];
  for (const d of [60, 90, 140, 260, 520, 900, 1400, 2000]) {
    e.camera.position.set(0, 30 + d * 0.06, d);
    e.camera.lookAt(0, 10, 0);
    e.camera.updateMatrixWorld(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    frames.push({ d, hits: { ...lod.tierHits }, missing: lod.lastFrameMissingNear, nearMeshes: lod.nearVisibleMeshes });
  }
  const tiersHit = Object.entries(lod.tierHits).filter(([, v]) => v > 0).map(([k]) => k);
  const switchesMax = lod.switches;
  const missingAny = frames.some((f) => f.missing > 0);
  // 兜底：把 near 标未就绪，继续靠近，仍不得空帧
  const ids = (lod.groups || []).slice(0, 5).map((g) => g.id);
  ids.forEach((id) => lod.setReady(id, 'near', false));
  e.camera.position.set(0, 20, 60);
  e.camera.lookAt(0, 10, 0);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const fallbackMissing = lod.lastFrameMissingNear;
  const fallbackNear = lod.nearVisibleMeshes;
  ids.forEach((id) => lod.setReady(id, 'near', true));
  return {
    groups: (lod.groups || []).length,
    tiersHit,
    switchesMax,
    missingAny,
    fallbackMissing,
    fallbackNear,
    thresholds: lod.thresholds,
    frames,
  };
});

const pass =
  !res.err &&
  ['near', 'mid', 'far', 'impostor'].every((t) => (res.tiersHit || []).includes(t)) &&
  res.switchesMax <= 6 &&
  !res.missingAny &&
  res.fallbackMissing === 0;

console.log(JSON.stringify({ ...res, pass }, null, 1));
await b.close();
process.exit(pass ? 0 : 1);
