/**
 * 界域落位探针：realmY 必须在每次落位后与落点一致。
 *
 * 覆盖入口（world.teleport / portal / 死亡重生 / toggleMode）：
 *   1. teleport 人间 wharf（avatar 模式，外部直接改 actor.pos）
 *   2. teleport 天宫 jiangtai（外部直接改 actor.pos，跨帧瞬移识别）
 *   3. toggleMode 人间 → 天宫（相机眼高 -1.7 → 脚底）
 *   4. toggleMode 天宫 → 人间（必须清空 realmY 并落到地面）
 *   5. PORTALS[0] 人间 → 地府（落点必须与旧值逐值一致：0,-260,-130）
 *   6. PORTALS[1] 地府 → 人间（落点必须与旧值逐值一致：472,0,28）
 *   7. teleport 地府 mengpo（POI 落点 y+0.5）
 *   8. respawnPlayerAt('jiangtai')（死亡重生 / Boss 击退共用入口）
 *   9. teleport 回人间：realmY 必须回到 null
 *
 * 每处都断言：界域带正确、realmY 与落点一致、60 帧后 y 不漂移。
 * 退出码：0 = 全绿，1 = 任一断言失败。
 *
 * 健壮性：dev server 上其他 agent 的 HMR 会整页 reload（销毁 evaluate 上下文），
 * 故整轮最多重试 3 次；60 帧用 engine.renderOnce 手动推进，不等 vsync。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4180/';
const MAX_ATTEMPTS = 3;

async function runOnce() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=960,600', '--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 600 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(
      () => !document.getElementById('loading') && !!window.__qingming && !!window.__qingming.world.player,
      { timeout: 180000 },
    );
    await new Promise((r) => setTimeout(r, 1200));

    const out = await page.evaluate(async () => {
      const q = window.__qingming;
      const world = q.world;
      const engine = q.engine;
      const player = world.player;

      const results = [];
      const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
      const frames = async (n) => { for (let i = 0; i < n; i++) await frame(); };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const round = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);
      const snap = () => ({
        x: round(player.actor.pos.x),
        y: round(player.actor.pos.y),
        z: round(player.actor.pos.z),
        realmY: player.realmY === null ? null : round(player.realmY),
        mode: player.mode,
        state: player.state,
      });
      const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...detail });

      /** 界域带：人间 |y|<50；天宫 y>2100；地府 y<-200 */
      const bandOk = (band, y) =>
        band === 'city' ? Math.abs(y) < 50 : band === 'heaven' ? y > 2100 : y < -200;

      const assertLanding = (name, band, landingY, opts = {}) => {
        const s = snap();
        const realmOk = band === 'city'
          ? s.realmY === null
          : s.realmY !== null && Math.abs(s.realmY - landingY) < 0.01;
        const landed = Math.abs(s.y - landingY) <= (opts.settle ?? 0.01);
        const ok = bandOk(band, s.y) && realmOk && landed;
        check(name, ok, { band, landingY: round(landingY), ...s, realmOk, landed });
        return s;
      };

      /** 连续 60 帧：手动 step，避免 SwiftShader 低帧率把探针拖成分钟级 */
      const step60 = () => { for (let i = 0; i < 60; i++) engine.renderOnce(1 / 60); };

      const assertStill = (name, band, y0) => {
        step60();
        const s = snap();
        const ok = Math.abs(s.y - y0) < 0.05 && bandOk(band, s.y) &&
          (band === 'city' ? s.realmY === null : s.realmY !== null);
        check(name, ok, { band, y0: round(y0), ...s, drift: round(Math.abs(s.y - y0)) });
        return s;
      };

      try {
        engine.stopCinema('fly');

        // ---- 1. 人间：外部 teleport ----
        world.teleport('wharf');
        await frames(3);
        player.toggleMode();                    // soul → avatar
        await frames(3);
        let s = snap();
        check('1 人间 teleport+附身：|y|<50 且 realmY=null', Math.abs(s.y) < 50 && s.realmY === null, s);
        await sleep(1200);                       // 人间从 y=2.5 落到地面，等它停稳
        let y0 = snap().y;
        assertStill('1b 人间 60 帧不漂移', 'city', y0);

        // ---- 2. 天宫：外部 teleport（avatar 模式，跨帧瞬移识别） ----
        world.teleport('jiangtai');
        const landingSky = player.actor.pos.y;   // world.teleport 同步写入 y+0.5
        await frames(3);
        assertLanding('2 天宫 teleport：y>2100 且 realmY=落点', 'heaven', landingSky);
        assertStill('2b 天宫 teleport 60 帧不漂移', 'heaven', snap().y);

        // ---- 3. toggleMode 人间 → 天宫（相机眼高 1.7 → 脚底） ----
        player.toggleMode();                     // avatar → soul
        await frames(2);
        engine.camera.position.y = 2154.0;       // 把相机放到天宫台面上方 1m（眼高）
        player.toggleMode();                     // soul → avatar
        const landingToggleSky = player.actor.pos.y;
        await frames(3);
        assertLanding('3 toggleMode 天宫：y>2100 且 realmY=落点', 'heaven', landingToggleSky);
        assertStill('3b toggleMode 天宫 60 帧不漂移', 'heaven', snap().y);

        // ---- 4. toggleMode 天宫 → 人间：清空 realmY 并落到地面 ----
        player.toggleMode();                     // avatar → soul
        await frames(2);
        world.teleport('wharf');
        await frames(2);
        player.toggleMode();                     // soul → avatar（人间分支按地面落位）
        const landingToggleCity = player.actor.pos.y;
        await frames(3);
        assertLanding('4 toggleMode 人间：|y|<50 且 realmY=null', 'city', landingToggleCity, { settle: 2.5 });
        await sleep(1200);
        y0 = snap().y;
        assertStill('4b toggleMode 人间 60 帧不漂移', 'city', y0);

        // ---- 5. PORTALS[0] 人间 → 地府 ----
        // 传送门位于 |z|<27 的河段判定里；y=1.0 让这一帧不判成 swim（swim 分支不检查传送门，
        // 这是现有实现的既有分支顺序，本探针不改玩法，只从陆上高度踏入）
        player.actor.pos.set(470, 1.0, 24);      // 站到阴阳界传送门
        await frames(4);
        await sleep(900);                        // 黑场 460ms + 余量
        await frames(3);
        s = snap();
        check('5 PORTALS[0] 地府：落点 (0,-260,-130) 逐值一致',
          Math.abs(s.x) < 0.01 && Math.abs(s.y - -260) < 0.01 && Math.abs(s.z - -130) < 0.01,
          s);
        check('5b PORTALS[0] realmY 与落点一致（-260）',
          s.realmY !== null && Math.abs(s.realmY - -260) < 0.01, s);
        assertStill('5c 地府 60 帧不漂移', 'under', s.y);

        // ---- 6. PORTALS[1] 地府 → 人间 ----
        player.actor.pos.set(0, -260, -124);     // 站到返阳门
        await frames(4);
        await sleep(900);
        await frames(3);
        s = snap();
        check('6 PORTALS[1] 人间：落点 (472,0,28) 逐值一致',
          Math.abs(s.x - 472) < 0.01 && Math.abs(s.y) < 0.01 && Math.abs(s.z - 28) < 0.01,
          s);
        check('6b PORTALS[1] realmY=null', s.realmY === null, s);
        assertStill('6c 人间 60 帧不漂移', 'city', s.y);

        // ---- 7. 地府 POI：外部 teleport（落点 y = POI.y + 0.5） ----
        world.teleport('mengpo');
        const landingUnder = player.actor.pos.y;
        await frames(3);
        assertLanding('7 地府 teleport：y<-200 且 realmY=落点', 'under', landingUnder);
        assertStill('7b 地府 teleport 60 帧不漂移', 'under', snap().y);

        // ---- 8. 死亡重生 / Boss 击退：respawnPlayerAt ----
        world.respawnPlayerAt('jiangtai');
        const landingRespawn = player.actor.pos.y;
        await frames(3);
        assertLanding('8 死亡重生 天宫：y>2100 且 realmY=落点', 'heaven', landingRespawn);
        assertStill('8b 死亡重生 60 帧不漂移', 'heaven', snap().y);

        // ---- 9. 传送回人间：realmY 必须回到 null ----
        world.teleport('wharf');
        await frames(3);
        s = snap();
        check('9 天宫→人间 teleport：|y|<50 且 realmY=null', Math.abs(s.y) < 50 && s.realmY === null, s);
        await sleep(1200);
        y0 = snap().y;
        assertStill('9b 人间 60 帧不漂移', 'city', y0);
      } catch (err) {
        results.push({ name: '探针异常中断', ok: false, error: String(err && err.stack ? err.stack : err) });
      }

      return {
        results,
        pageErrs: window.__errs || [],
      };
    });

    return { ...out, pageErrors };
  } finally {
    await browser.close();
  }
}

let out = null;
let lastErr = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    out = await runOnce();
    break;
  } catch (err) {
    lastErr = err;
    console.error(`[attempt ${attempt}/${MAX_ATTEMPTS}] ${String(err && err.message ? err.message : err)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (!out) {
  console.error('探针未能完成（dev server 反复重载或页面不可用）：', lastErr);
  process.exit(1);
}

const failed = out.results.filter((r) => !r.ok).length;
for (const r of out.results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  const detail = Object.entries(r)
    .filter(([k]) => k !== 'name' && k !== 'ok')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  console.log(`[${mark}] ${r.name}${detail ? ' | ' + detail : ''}`);
}
console.log(JSON.stringify({
  total: out.results.length,
  failed,
  pageErrors: (out.pageErrors || []).concat(out.pageErrs || []),
}, null, 2));
if (failed > 0) process.exitCode = 1;
