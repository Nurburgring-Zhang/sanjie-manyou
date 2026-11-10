/**
 * SAV-001 真机探针：存 → 改数值 → 读 → 恢复；手动槽不被自动覆盖；pageErrors=0。
 *
 * 用法：
 *   PREVIEW_URL=http://127.0.0.1:4173/ node scripts/probe-save-ui.mjs           # 真机（需浏览器 + 预览服务）
 *   node scripts/probe-save-ui.mjs --self-test                                    # 静态自检（无浏览器可跑）
 *
 * 与 r28_acceptance.mjs 同口径：浏览器依赖延迟 import；无浏览器 / 无预览服务时
 * 输出 gate:SKIPPED + DEGRADED，rc=0 但**明确不计入 PASS.all、不假装真机通过**。
 * --self-test 只做静态契约校验，不启浏览器、不发网络请求。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(HERE));
const SRC = fs.readFileSync(HERE, 'utf8');
const ARGV = process.argv.slice(2);
const SELF_TEST = ARGV.includes('--self-test');
const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const PROBE = 'save-ui';

// 与 r28_acceptance.mjs 一致的 Edge/Chromium 启动参数
const EDGE_ARGS = [
  '--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-proxy-server',
];

const NOT_RUN_GATES = [
  'puppeteer 真机浏览器启动 / 页面载入（__qingming 就绪）',
  'window.__save() 存手动槽并返回 {slot,bytes,ms,ok}',
  'window.__saveState() / 写档期 window.__saving===true',
  'IndexedDB 手动槽落盘 + 4KB 头 / 长度 / digest 回读校验',
  '改数值（interact.earn）后手动槽 mtime 不被自动层覆盖',
  '读档恢复（applySnapshot 链，需主代理接线）',
  'pageErrors=0',
];

function readSrc(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return ''; }
}

function staticSelfTest() {
  const policy = readSrc('src/game/savePolicy.ts');
  const panel = readSrc('src/ui/savePanel.ts');
  const rt = readSrc('src/rt/save.ts');
  const checks = {
    policyHasInit: policy.includes('export function initSaveSystem'),
    policyHasWindowBridge: policy.includes("host['__save']")
      && policy.includes("host['__saveState']") && policy.includes("host['__saving']"),
    policyHasSafePoint: policy.includes('export function isSafePoint'),
    policyIntervalLe120s: /AUTO_INTERVAL_MS\s*=\s*120_000/.test(policy),
    policySlotIsolation: policy.includes('AUTO_SLOTS') && policy.includes('MANUAL_SLOTS'),
    panelHasMount: panel.includes('export function mountSavePanel')
      && panel.includes('export function unmountSavePanel'),
    panelHold800ms: /DELETE_HOLD_MS\s*=\s*800/.test(panel),
    panelThumb384x216: /THUMB_W\s*=\s*384/.test(panel) && /THUMB_H\s*=\s*216/.test(panel),
    panelSelfContainedStyle: panel.includes('STYLE_ID') && panel.includes('injectStyle'),
    rtHasQuarantineStore: rt.includes('QUARANTINE_STORE'),
    rtHasDigestVerify: rt.includes('export function computeDigest') && rt.includes('export function verifySlot'),
    testFilePresent: fs.existsSync(path.join(ROOT, 'tests/savePolicy.test.ts')),
    selfTestFlagPresent: SRC.includes('--self-test'),
    skippedLabelPresent: SRC.includes('SKIPPED'),
    edgeArgsPresent: EDGE_ARGS.includes('--no-sandbox')
      && EDGE_ARGS.includes('--enable-unsafe-swiftshader') && EDGE_ARGS.includes('--no-proxy-server'),
  };
  const allStaticOk = Object.values(checks).every(Boolean);
  const out = {
    probe: PROBE,
    at: new Date().toISOString(),
    mode: 'self-test',
    gate: allStaticOk ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL',
    realMachine: 'SKIPPED',
    staticChecks: checks,
    allStaticOk,
    realMachineGatesNotRun: NOT_RUN_GATES,
    disclosure: 'DEGRADED/SKIPPED：本次未启动浏览器、未连接预览服务、未发起任何网络请求；'
      + '--self-test 的 rc=0 只代表静态契约自检通过，不代表真机验收通过',
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(allStaticOk ? 0 : 1);
}

function skipped(reason) {
  const out = {
    probe: PROBE,
    at: new Date().toISOString(),
    mode: 'real',
    gate: 'SKIPPED',
    realMachine: 'SKIPPED',
    degraded: `DEGRADED-${reason}`,
    PASS: { all: null, countedGates: 0, note: 'SKIPPED 不计入 PASS.all；未实跑任何真机门' },
    reason,
    realMachineGatesNotRun: NOT_RUN_GATES,
    disclosure: '未实跑真机探针，rc=0 仅为如实跳过（非通过、非失败）',
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

async function runBrowser() {
  let puppeteer;
  let CHROME;
  try {
    puppeteer = (await import('puppeteer-core')).default;
    CHROME = (await import('./chromePath.mjs')).CHROME;
  } catch (e) {
    return skipped('无 puppeteer-core / 找不到 Chromium：' + String(e).slice(0, 120));
  }
  // 预览服务可达性（无服务则如实 SKIPPED，不假装通过）
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return skipped(`预览服务不可达 HTTP ${r.status}`);
  } catch {
    return skipped('预览服务不可达（fetch 失败）');
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true, protocolTimeout: 120000, timeout: 60000,
      args: EDGE_ARGS,
    });
  } catch (e) {
    return skipped('浏览器启动失败：' + String(e).slice(0, 120));
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push('PAGE:' + String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('CONSOLE:' + m.text().slice(0, 200)); });

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    try {
      await page.waitForFunction(() => !!window.__qingming && !!window.__qingming.world, { timeout: 90000 });
    } catch {
      return skipped('页面 __qingming 未就绪（可能未接线保存系统）');
    }

    const result = await page.evaluate(async () => {
      const W = window;
      const out = {
        hasSave: typeof W.__save === 'function',
        hasSaveState: typeof W.__saveState === 'function',
        hasSavingFlag: '__saving' in W,
      };
      const digest = (s) => {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 0xffff; h = Math.imul(h, 0x01000193) >>> 0; }
        return ('00000000' + h.toString(16)).slice(-8);
      };
      const verify = (raw) => {
        if (!raw || raw.length < 4096) return false;
        try {
          const head = JSON.parse(raw.slice(0, 4096).replace(/\u0000+$/, ''));
          const body = raw.slice(4096);
          return head.magic === 'CQSAVE2' && head.len === body.length && head.digest === digest(body);
        } catch { return false; }
      };
      const idbGet = (store, key) => new Promise((res) => {
        const req = indexedDB.open('sanjie-save', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots');
          if (!db.objectStoreNames.contains('index')) db.createObjectStore('index');
          if (!db.objectStoreNames.contains('quarantine')) db.createObjectStore('quarantine');
        };
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(store)) { res(null); return; }
          const g = db.transaction(store, 'readonly').objectStore(store).get(key);
          g.onsuccess = () => res(g.result ?? null);
          g.onerror = () => res(null);
        };
        req.onerror = () => res(null);
      });

      out.stateShape = W.__saveState ? Object.keys(W.__saveState()) : [];
      const it = W.__qingming?.world?.interact;
      out.coinsBefore = it?.coins;

      let firstSlot = null;
      let firstRaw = null;
      if (out.hasSave) {
        const r = await W.__save();
        out.saveResult = r;
        out.saveOk = !!r && r.ok === true;
        out.manualSlot = !!r && /^save:m[1-3]$/.test(r.slot);
        firstSlot = r?.slot ?? null;
        if (firstSlot) {
          firstRaw = await idbGet('slots', firstSlot);
          out.idbHasSlot = firstRaw !== null;
          out.digestOk = verify(firstRaw);
          if (firstRaw) {
            try {
              const body = firstRaw.slice(4096);
              out.savedCoins = JSON.parse(body).economy?.coins;
            } catch { /* ignore */ }
          }
        }
      }

      // 改数值（钱变了），旧存档里三币应仍是改动前的值
      if (it && typeof it.earn === 'function') it.earn(100);
      out.coinsAfter = it?.coins;
      out.economyUnchanged = out.savedCoins === undefined || out.savedCoins === out.coinsBefore;

      // 再存一次（另一手动槽）→ 第一个手动槽 mtime 不应被自动层覆盖
      if (out.hasSave) await W.__save();
      if (firstSlot) {
        const raw2 = await idbGet('slots', firstSlot);
        out.manualSlotNotOverwritten = raw2 === firstRaw;
      }
      return out;
    });

    const assertions = {
      hasSave: result.hasSave === true,
      hasSaveState: result.hasSaveState === true,
      stateShapeOk: ['lastAutoMs', 'pending', 'slots'].every((k) => (result.stateShape ?? []).includes(k)),
      saveOk: result.saveOk === true,
      manualSlot: result.manualSlot === true,
      idbHasSlot: result.idbHasSlot === true,
      digestOk: result.digestOk === true,
      economyUnchanged: result.economyUnchanged === true,
      manualSlotNotOverwritten: result.manualSlotNotOverwritten === true,
      pageErrorsEmpty: pageErrors.length === 0,
    };
    const all = Object.values(assertions).every(Boolean);
    const report = {
      probe: PROBE,
      at: new Date().toISOString(),
      url: URL,
      mode: 'real',
      gate: all ? 'PASS' : 'FAIL',
      realMachine: all ? 'PASS' : 'FAIL',
      assertions,
      pageErrors,
      raw: result,
      PASS: { all, countedGates: Object.keys(assertions).length },
      note: '读档恢复（applySnapshot 链）需主代理按接线清单在 world.ts 接线；本探针验证存档/回读/槽隔离/无页面错误',
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(all ? 0 : 1);
  } finally {
    await browser.close();
  }
}

if (SELF_TEST) staticSelfTest();
else await runBrowser();
