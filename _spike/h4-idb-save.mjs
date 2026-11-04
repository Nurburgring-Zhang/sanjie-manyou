#!/usr/bin/env node
// ============================================================================
// H4 spike · 28.7MB 存档能否在 IndexedDB 里原子写（puppeteer-core + 空白页）
//
// 问题（全量工作清单.md -1 阶段 H4 行）：存档 28.7MB 能否在 IndexedDB 里原子写——
//   决定 P0-4 是否降级为「只存 spec」。
//
// 既定 A/B 方案（W4 联网检索）：多 store 同一 readwrite 事务保原子性；
//   Chrome 存储层已自动 Snappy 压缩，手工压缩收益要实测；
//   原生 CompressionStream('deflate-raw') + Blob 是大 payload 主流做法；
//   navigator.storage.estimate()/persist() 处理配额；版本化槽位 + 最后好档恢复。
//
// 方案 A：JSON.stringify → 单 readwrite 事务 put 两个 objectStore（slots + index）
// 方案 B：JSON.stringify → CompressionStream('deflate-raw') → Blob → 同款单事务 put
//
// 测什么：
//   1. 双 store 同事务原子性：第二个 store 请求级错误 → 事务自动 abort → 第一 store 回滚；
//      外加显式 tx.abort() 回滚、失败后 DB 可继续写（未被毒坏）。
//      附带实测：put 同步抛错（DataError）不会自动 abort 事务——P0-4 必须知悉的坑。
//   2. A/B 各 5 轮：stringify / 压缩 / put / 读回 耗时分布（p50/p95/max）、压缩率、
//      读回 SHA-256 一致性、longtask（主线程阻塞代理）、estimate() 落盘占用增量。
//   3. navigator.storage.estimate() + persist() 实录。
//   4. 「最后好档」恢复演练：v3 写坏（尾部截断 512KB）→ parse 失败 → 自动回退 v2 → hash 校验通过。
//
// 关于空白页：任务书要求 about:blank 或 data: URL——但这二者是 opaque origin，
//   Chrome 对其 indexedDB.open 直接拒（SecurityError，本脚本启动时实测并记录）。
//   故改为：临时 http 服务只绑 127.0.0.1 随机端口，返回零脚本的空 HTML
//   （不加载游戏页面，无任何资源请求，避免污染）——符合「空白页」意图。
//
// 确定性：mulberry32 固定 seed，全程无裸 Math.random；payload 只构建一次、逐轮复用；
//   每轮写前 indexedDB.deleteDatabase 清库重建，保证可复现。
// 退出码：0 = 测试完成（A/B 数字与断言结果如实记录，不影响退出码）；1 = 环境失败。
// 输出：_spike/h4-idb-save.json + 控制台摘要。
// ============================================================================
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from '../scripts/chromePath.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'h4-idb-save.json');

// ---- 可调常量 ----
const SEED = 20261104;
const TARGET_BYTES = Math.round(28.7 * 1024 * 1024); // 28.7MB 按 MiB 口径（30,098,436 字节，取更不利的大值）
const ROUNDS = 5;                                     // 任务书：各测 5 轮取分布
const SHARES = { entities: 0.82, voxels: 0.12, world: 0.055, hud: 0.005 };
const CUT_UNITS = 512 * 1024;                         // 恢复演练：尾部截断（UTF-16 单位）
const DB_A = 'h4-test-a', DB_B = 'h4-test-b', DB_ATOMIC = 'h4-test-atomic', DB_REC = 'h4-test-recovery';

const mb = (b) => +(b / 1048576).toFixed(2);
const ms1 = (x) => +x.toFixed(1);

// ---- 页面内主流程（必须自包含；经 puppeteer 序列化注入） ----
async function pageMain(cfg) {
  const sleep = (m) => new Promise((r) => setTimeout(r, m));
  const enc = new TextEncoder();
  const ms1 = (x) => +x.toFixed(1);
  const mb = (b) => +(b / 1048576).toFixed(2);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const fr = (x) => Math.fround(x); // Float32 精度（模拟 three.js 状态）

  // ---------- 1. 确定性 payload（实体表 + 体素 + 世界状态 + HUD） ----------
  const KINDS = ['pedestrian', 'vendor', 'guard', 'builder', 'scholar', 'creation', 'beast', 'blockEntity'];
  const NAME_A = ['汴', '京', '大', '相', '国', '寺', '州', '桥', '虹', '楼', '樊', '孙', '正', '瓦', '子', '勾', '栏', '御', '街', '金', '梁', '门', '隍', '漕', '运', '码'];
  const NAME_B = ['铺', '坊', '行', '会', '斋', '园', '居', '堂', '记', '庄'];
  const TAGS = ['剧情', '商栈', '手作', '守夜', '巡游', '租借', '修复', '祭祀', '漕运', '灯会'];

  // 校准流（只用于估算样本字节数；与主构建流分离，保证主 payload 逐位可复现）
  const rndCal = mulberry32(cfg.seed);
  function calEntity() {
    return makeEntityShape(rndCal);
  }
  function makeEntityShape(r) {
    const rint = (n) => Math.floor(r() * n);
    const rfl = (lo, hi) => lo + r() * (hi - lo);
    const pk2 = NAME_A[rint(NAME_A.length)], pk1 = NAME_A[rint(NAME_A.length)], pk3 = NAME_B[rint(NAME_B.length)];
    const inv = new Array(8);
    for (let k = 0; k < 8; k++) inv[k] = fr(rfl(0, 999.99));
    const pk = [0, 1, 2].map(() => TAGS[rint(TAGS.length)]);
    return {
      id: 0,
      kind: KINDS[rint(KINDS.length)],
      nm: pk2 + pk1 + pk3 + '-' + (1000 + rint(9000)),
      x: fr(rfl(-1800, 1800)), y: fr(rfl(0, 260)), z: fr(rfl(-1800, 1800)),
      ry: fr(rfl(0, 6.2832)),
      hp: fr(rfl(10, 100)), st: rint(6), lv: rint(30), xp: fr(rfl(0, 99999)),
      ag: fr(r()),
      inv, tg: pk,
    };
  }
  function makeQuestShape(r) {
    const rint = (n) => Math.floor(r() * n);
    const rfl = (lo, hi) => lo + r() * (hi - lo);
    return { q: 'quest-' + (100 + rint(900)), s: rint(4), p: fr(r()), npcs: [100000 + rint(99999), 100000 + rint(99999), 100000 + rint(99999)], nm: NAME_A[rint(NAME_A.length)] + NAME_B[rint(NAME_B.length)] };
  }
  function makeItemShape(r) {
    const rint = (n) => Math.floor(r() * n);
    return { it: TAGS[rint(TAGS.length)] + NAME_B[rint(NAME_B.length)] + '-' + rint(999), n: rint(99), d: Math.fround(r()) };
  }

  const SAMPLE = 500;
  const sample = []; for (let i = 0; i < SAMPLE; i++) sample.push(calEntity());
  const perEntity = (enc.encode(JSON.stringify(sample)).length + SAMPLE - 1) / SAMPLE;
  const N_ENT = Math.max(1, Math.round((cfg.targetBytes * cfg.shares.entities) / perEntity));

  const sampleQ = []; for (let i = 0; i < 100; i++) sampleQ.push(makeQuestShape(rndCal));
  const perQuest = (enc.encode(JSON.stringify(sampleQ)).length + 99) / 100;
  const N_QUEST = Math.max(1, Math.round((cfg.targetBytes * cfg.shares.world * 0.985) / perQuest));
  const SIM_N = 2048;

  const sampleH = []; for (let i = 0; i < 100; i++) sampleH.push(makeItemShape(rndCal));
  const perItem = (enc.encode(JSON.stringify(sampleH)).length + 99) / 100;
  const N_ITEM = Math.max(1, Math.round((cfg.targetBytes * cfg.shares.hud) / perItem));

  // 主构建流（seed+1，与校准流分离）
  const rndMain = mulberry32(cfg.seed + 1);
  const entities = new Array(N_ENT);
  for (let i = 0; i < N_ENT; i++) { const e = makeEntityShape(rndMain); e.id = 100000 + i; entities[i] = e; }

  const HEX = '0123456789abcdef';
  const VOX_CHARS = Math.floor(cfg.targetBytes * cfg.shares.voxels);
  const voxArr = new Array(VOX_CHARS);
  for (let i = 0; i < VOX_CHARS; i++) voxArr[i] = HEX[Math.floor(rndMain() * 16)];
  const voxels = voxArr.join('');
  voxArr.length = 0; // 释放中间数组

  const quests = new Array(N_QUEST);
  for (let i = 0; i < N_QUEST; i++) quests[i] = makeQuestShape(rndMain);
  const sim = new Float32Array(SIM_N);
  for (let i = 0; i < SIM_N; i++) sim[i] = fr(rndMain() * 1000);
  const items = new Array(N_ITEM);
  for (let i = 0; i < N_ITEM; i++) items[i] = makeItemShape(rndMain);

  const payload = {
    meta: { schemaVersion: 3, seed: cfg.seed, note: 'H4 spike synthetic save' },
    entities,
    voxels,
    world: { day: 12, time: 0.63, weather: 'rain', quests, sim: Array.from(sim) },
    hud: { coins: 1234, yinde: 567, peach: 89, inventory: items, settings: { quality: 'high', volume: 0.8, lang: 'zh-CN' } },
  };

  const json0 = JSON.stringify(payload);
  const rawBytes = enc.encode(json0).length;
  const HASH = await sha256Hex(json0);

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- 2. IDB 工具 ----------
  function openDB(name) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore('slots', { keyPath: 'slot' }); // {slot:'save:v3', ver, data}
        db.createObjectStore('index', { keyPath: 'key' });  // {key:'lastGood', slot:'save:v3'}
      };
      rq.onsuccess = () => { const db = rq.result; db.onversionchange = () => db.close(); res(db); };
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('open blocked'));
    });
  }
  function delDB(name) {
    return new Promise((res) => {
      const rq = indexedDB.deleteDatabase(name);
      rq.onsuccess = rq.onerror = rq.onblocked = () => res();
    });
  }
  function txEnd(tx) {
    return new Promise((res) => {
      tx.oncomplete = () => res({ ended: 'complete' });
      tx.onabort = () => res({ ended: 'abort', errorName: (tx.error && tx.error.name) || null, errorMsg: (tx.error && String(tx.error.message || '')) || null });
      tx.onerror = () => {};
    });
  }
  function getReq(store, key) {
    return new Promise((res, rej) => { const rq = store.get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  }
  function allKeys(store) {
    return new Promise((res, rej) => { const rq = store.getAllKeys(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  }
  async function snap(db) {
    const tx = db.transaction(['slots', 'index'], 'readonly');
    const s = tx.objectStore('slots'); const ix = tx.objectStore('index');
    const keys = await allKeys(s);
    const lg = await getReq(ix, 'lastGood');
    return { slotKeys: keys, lastGood: lg ? lg.slot : null };
  }

  // 单 readwrite 事务双 store 原子写（A 用字符串、B 用 Blob，同一骨架）
  async function atomicSave(db, version, data, opts = {}) {
    const t0 = performance.now();
    const tx = db.transaction(['slots', 'index'], 'readwrite');
    const s = tx.objectStore('slots');
    const ix = tx.objectStore('index');
    let syncErr = null;
    try {
      s.put({ slot: 'save:v' + version, ver: version, data });
      if (opts.badPointer) ix.put({ key: { nested: true }, slot: 'x' }); // 无效 inline key → 请求级 DataError
      else ix.put({ key: 'lastGood', slot: 'save:v' + version });
      if (opts.manualAbort) tx.abort();
    } catch (e) {
      syncErr = e; try { tx.abort(); } catch (_) {}
    }
    const end = await txEnd(tx);
    return {
      putMs: performance.now() - t0,
      ended: syncErr ? 'sync-throw' : end.ended,
      errorName: end.errorName || (syncErr && syncErr.name) || null,
      syncThrowName: syncErr ? syncErr.name : null,
    };
  }
  async function loadSlot(db, version) {
    const t0 = performance.now();
    const tx = db.transaction(['slots'], 'readonly');
    const rec = await getReq(tx.objectStore('slots'), 'save:v' + version);
    return { rec, gotMs: performance.now() - t0 };
  }
  async function verifyData(dataStr, expectHash) {
    const t0 = performance.now();
    let parseOk = false, parseErr = null;
    try { const p = JSON.parse(dataStr); parseOk = !!(p && p.meta && p.meta.schemaVersion === cfg.schemaVersion); }
    catch (e) { parseErr = String(e && e.message || e).slice(0, 100); }
    let hash = null, hashOk = false;
    if (parseOk) { hash = await sha256Hex(dataStr); hashOk = hash === expectHash; }
    return { parseOk, parseErr, hashOk, verifyMs: performance.now() - t0 };
  }
  async function storageUsage() { try { const e = await navigator.storage.estimate(); return e.usage; } catch { return null; } }
  function watchLongTasks() {
    const list = []; let po = null;
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) list.push(+e.duration.toFixed(1)); }); po.observe({ type: 'longtask' }); } catch (_) {}
    return { list, stop: async () => { await sleep(120); try { po && po.disconnect(); } catch (_) {} } };
  }

  // ---------- 3. 压缩路径（B） ----------
  const csSupport = typeof CompressionStream;
  let formatOk = false;
  try { new CompressionStream('deflate-raw'); formatOk = true; } catch (_) {}
  async function deflateRawBlob(str) {
    const cs = new CompressionStream('deflate-raw');
    return await new Response(new Blob([str]).stream().pipeThrough(cs)).blob();
  }
  async function inflateRawText(blob) {
    const ds = new DecompressionStream('deflate-raw');
    return await new Response(blob.stream().pipeThrough(ds)).text();
  }

  // ---------- 4. A/B 各 5 轮（每轮清库重建） ----------
  async function runRounds(kind, dbName) {
    const rounds = [];
    for (let r = 1; r <= cfg.rounds; r++) {
      await delDB(dbName);
      const db = await openDB(dbName);
      const usageBefore = await storageUsage();
      const lt = watchLongTasks();
      const t0 = performance.now();
      const t1 = performance.now();
      const dataStr = JSON.stringify(payload);
      const stringifyMs = performance.now() - t1;

      let round = null;
      if (kind === 'A') {
        const w = await atomicSave(db, 1, dataStr);
        const writeTotalMs = performance.now() - t0;
        await lt.stop();
        const usageAfter = await storageUsage();
        const rd = await loadSlot(db, 1);
        const v = await verifyData(rd.rec ? rd.rec.data : null, HASH);
        round = { round: r, stringifyMs: ms1(stringifyMs), compressMs: 0, blobBytes: null, putMs: ms1(w.putMs), writeTotalMs: ms1(writeTotalMs), readGetMs: ms1(rd.gotMs), verifyMs: ms1(v.verifyMs), ...v, usageBeforeBytes: usageBefore, usageAfterBytes: usageAfter, longTasks: lt.list.length, longTaskMaxMs: lt.list.length ? Math.max(...lt.list) : 0 };
      } else {
        const t2 = performance.now();
        const blob = await deflateRawBlob(dataStr);
        const compressMs = performance.now() - t2;
        const w = await atomicSave(db, 1, blob);
        const writeTotalMs = performance.now() - t0;
        await lt.stop();
        const usageAfter = await storageUsage();
        const t4 = performance.now();
        const rd = await loadSlot(db, 1);
        let inflated = null;
        try { if (rd.rec) inflated = await inflateRawText(rd.rec.data); } catch (e) { inflated = null; }
        const v = await verifyData(inflated, HASH);
        const readMs = performance.now() - t4;
        round = { round: r, stringifyMs: ms1(stringifyMs), compressMs: ms1(compressMs), blobBytes: blob.size, putMs: ms1(w.putMs), writeTotalMs: ms1(writeTotalMs), readGetMs: ms1(rd.gotMs), verifyMs: ms1(v.verifyMs), readMs: ms1(readMs), ...v, usageBeforeBytes: usageBefore, usageAfterBytes: usageAfter, longTasks: lt.list.length, longTaskMaxMs: lt.list.length ? Math.max(...lt.list) : 0 };
      }
      db.close();
      rounds.push(round);
    }
    return rounds;
  }

  // ---------- 5. 原子性专项（双 store 同事务） ----------
  async function atomicityTest() {
    await delDB(cfg.dbAtomic);
    const db = await openDB(cfg.dbAtomic);
    const out = {};
    // 5.1 对照组：双 store 同事务成功 → 两个都可见
    const c = await atomicSave(db, 1, 'DATA-V1');
    out.control = { ended: c.ended, ...(await snap(db)) };
    // 5.2 注入：第二个 store 请求级错误（无效 inline key）→ 应自动 abort 且第一 store 回滚
    const tx = db.transaction(['slots', 'index'], 'readwrite');
    tx.objectStore('slots').put({ slot: 'save:v2', ver: 2, data: 'CORRUPT-MARKER' });
    let reqErrSync = false, reqErrName = null;
    try { tx.objectStore('index').put({ key: { nested: true }, slot: 'save:v2' }); }
    catch (e) { reqErrSync = true; reqErrName = e.name; try { tx.abort(); } catch (_) {} }
    const end1 = await txEnd(tx);
    out.injection = { reqErrSync, reqErrName, ended: end1.ended, errorName: end1.errorName, ...(await snap(db)) };
    // 5.3 失败后 DB 可继续正常写（未被毒坏）
    const rec = await atomicSave(db, 2, 'DATA-V2');
    out.postFailWrite = { ended: rec.ended, ...(await snap(db)) };
    // 5.4 显式 tx.abort() → 双 store 都回滚
    const tx2 = db.transaction(['slots', 'index'], 'readwrite');
    tx2.objectStore('slots').put({ slot: 'save:v3', ver: 3, data: 'SHOULD-NOT-PERSIST' });
    tx2.objectStore('index').put({ key: 'lastGood', slot: 'save:v3' });
    tx2.abort();
    const end2 = await txEnd(tx2);
    out.manualAbort = { ended: end2.ended, ...(await snap(db)) };
    // 5.5 同步抛错路径：put 本身同步抛（不会自动 abort）——P0-4 必须自己 catch+abort
    const tx3 = db.transaction(['slots', 'index'], 'readwrite');
    tx3.objectStore('slots').put({ slot: 'save:v4', ver: 4, data: 'PART-A' });
    let syncThrow = null;
    try { tx3.objectStore('index').put(Object.assign({ key: 'lastGood' }, { get slot() { throw new TypeError('SIMULATED-APP-BUG'); } })); }
    catch (e) { syncThrow = e.name; }
    const end3 = await txEnd(tx3); // 若不显式 abort，PART-A 会单独提交（半写）
    out.syncThrowCase = { syncThrow, ended: end3.ended, ...(await snap(db)) };
    db.close();
    return out;
  }

  // ---------- 6. 「最后好档」恢复演练 ----------
  async function recoveryDrill() {
    await delDB(cfg.dbRec);
    const db = await openDB(cfg.dbRec);
    const good = json0;
    await atomicSave(db, 1, good);
    await atomicSave(db, 2, good);
    const cut = good.slice(0, good.length - cfg.cutUnits); // v3 尾部截断 = 写坏版本
    const bw = await atomicSave(db, 3, cut);               // 事务本身成功（内容级坏档），指针→v3
    const steps = [];
    let ver = null;
    {
      const tx = db.transaction(['index'], 'readonly');
      const lg = await getReq(tx.objectStore('index'), 'lastGood');
      ver = lg ? Number(String(lg.slot).replace('save:v', '')) : null;
    }
    let result = { ok: false, recoveredVer: null, steps, dataOk: false };
    while (ver !== null && ver >= 1) {
      const { rec } = await loadSlot(db, ver);
      const step = { tried: ver, present: !!rec };
      steps.push(step);
      if (rec) {
        let parseOk = false;
        try { JSON.parse(rec.data); parseOk = true; } catch (_) {}
        if (parseOk) {
          const v = await verifyData(rec.data, HASH);
          result = { ok: true, recoveredVer: ver, steps, dataOk: v.hashOk, parseOk };
          break;
        }
        step.corrupt = true;
      }
      ver -= 1; // 自动回退上一版本号
    }
    db.close();
    return { badWrite: { ended: bw.ended, cutUnits: cfg.cutUnits, fullUnits: good.length }, recovered: result };
  }

  // ---------- 7. 配额与持久化 ----------
  async function storageInfo() {
    const est0 = await navigator.storage.estimate().catch(() => null);
    let persisted = null, persistErr = null;
    try { persisted = await navigator.storage.persist(); } catch (e) { persistErr = String(e).slice(0, 120); }
    const est1 = await navigator.storage.estimate().catch(() => null);
    return {
      persisted, persistErr,
      quotaBytes: est0 ? est0.quota : null,
      usageBytesBefore: est0 ? est0.usage : null,
      usageBytesAfterPersist: est1 ? est1.usage : null,
      quotaAfterBytes: est1 ? est1.quota : null,
    };
  }

  // ---------- 执行 ----------
  const storage = await storageInfo();
  const roundsA = await runRounds('A', cfg.dbA);
  const roundsB = await runRounds('B', cfg.dbB);
  const atomic = await atomicityTest();
  const recovery = await recoveryDrill();

  return {
    env: {
      origin: location.origin,
      scripts: document.scripts.length,
      resources: performance.getEntriesByType('resource').length,
      ua: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      compressionStream: csSupport,
      deflateRawFormat: formatOk,
    },
    payload: {
      targetBytes: cfg.targetBytes, actualBytes: rawBytes, rawMB: mb(rawBytes),
      sha256: HASH, nEntities: N_ENT, nQuests: N_QUEST, nItems: N_ITEM, voxChars: VOX_CHARS,
      perEntityBytes: +perEntity.toFixed(1),
      schemaVersion: cfg.schemaVersion,
    },
    storage,
    atomic, recovery,
    A: roundsA, B: roundsB,
  };
}

// ============================================================================
// Node 侧：起临时空白页 → 注入主流程 → 汇总 → 写 JSON
// ============================================================================
let browser = null, server = null, code = 1;
const pageErrors = [];
const notes = [];

function stats(nums) {
  const s = [...nums].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return { n: 0, p50: null, p95: null, max: null };
  const q = (p) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
}

try {
  // 临时空白页服务：只绑回环、随机端口、零脚本零资源
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log('[h4] 空白页服务 http://127.0.0.1:' + port + '/（零脚本，不加载游戏页面）');

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 200)); });
  page.setDefaultTimeout(240000);

  // 附带实测：opaque origin（about:blank）上 indexedDB 是否真被拒——给报告留证据
  const p2 = await browser.newPage();
  await p2.goto('about:blank');
  const opaqueProbe = await p2.evaluate(async () => {
    try { const d = await new Promise((res, rej) => { const rq = indexedDB.open('h4-opaque-probe'); rq.onsuccess = () => { rq.result.close(); res('opened'); }; rq.onerror = () => rej(rq.error); rq.onblocked = () => rej(new Error('blocked')); }); return { ok: true, r: d }; }
    catch (e) { return { ok: false, name: e && e.name, msg: String(e && e.message || e).slice(0, 120) }; }
  }).catch((e) => ({ evalError: String(e).slice(0, 120) }));
  await p2.close();
  console.log('[h4] about:blank（opaque origin）indexedDB 实测:', JSON.stringify(opaqueProbe));

  console.log('[h4] goto 空白页 …');
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });

  const cfg = {
    seed: SEED, targetBytes: TARGET_BYTES, shares: SHARES, rounds: ROUNDS,
    cutUnits: CUT_UNITS, schemaVersion: 3,
    dbA: DB_A, dbB: DB_B, dbAtomic: DB_ATOMIC, dbRec: DB_REC,
  };
  console.log('[h4] 页面内执行：payload 构建 + A/B 各 ' + ROUNDS + ' 轮 + 原子性 + 恢复演练 …');
  const t0 = Date.now();
  const result = await page.evaluate(pageMain, cfg);
  console.log('[h4] 页面内完成，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  // ---- 汇总与判定 ----
  const { payload, env, storage, atomic, recovery, A, B } = result;
  const aggA = {
    stringify: stats(A.map((r) => r.stringifyMs)), put: stats(A.map((r) => r.putMs)),
    writeTotal: stats(A.map((r) => r.writeTotalMs)), readGet: stats(A.map((r) => r.readGetMs)),
    verify: stats(A.map((r) => r.verifyMs)),
    hashAllOk: A.every((r) => r.hashOk), usageAfter: stats(A.map((r) => r.usageAfterBytes)),
    longTasks: stats(A.map((r) => r.longTasks)), longTaskMax: Math.max(0, ...A.map((r) => r.longTaskMaxMs)),
  };
  const aggB = {
    stringify: stats(B.map((r) => r.stringifyMs)), compress: stats(B.map((r) => r.compressMs)),
    put: stats(B.map((r) => r.putMs)), writeTotal: stats(B.map((r) => r.writeTotalMs)),
    readGet: stats(B.map((r) => r.readGetMs)), verify: stats(B.map((r) => r.verifyMs)),
    blob: stats(B.map((r) => r.blobBytes)),
    ratio: +(stats(B.map((r) => r.blobBytes)).p50 / payload.actualBytes).toFixed(4),
    hashAllOk: B.every((r) => r.hashOk), usageAfter: stats(B.map((r) => r.usageAfterBytes)),
    longTasks: stats(B.map((r) => r.longTasks)), longTaskMax: Math.max(0, ...B.map((r) => r.longTaskMaxMs)),
  };
  const sizeOk = Math.abs(payload.actualBytes - TARGET_BYTES) / TARGET_BYTES <= 0.05;
  if (!sizeOk) notes.push('payload 实际字节偏离目标 >5%（实测 ' + payload.actualBytes + ' vs 目标 ' + TARGET_BYTES + '）');
  if (env.scripts !== 0 || env.resources !== 0) notes.push('空白页存在脚本/资源（污染告警）');

  const atomicPass =
    atomic.control.ended === 'complete' && atomic.control.slotKeys.length === 1 && atomic.control.lastGood === 'save:v1' &&
    atomic.injection.ended === 'abort' && !atomic.injection.slotKeys.includes('save:v2') && atomic.injection.lastGood === 'save:v1' &&
    atomic.postFailWrite.ended === 'complete' && atomic.postFailWrite.slotKeys.includes('save:v2') &&
    atomic.manualAbort.ended === 'abort' && !atomic.manualAbort.slotKeys.includes('save:v3');
  const integrityPass = aggA.hashAllOk && aggB.hashAllOk && payload.sha256.length === 64;
  const quotaPass = storage.quotaBytes !== null && storage.quotaBytes > 10 * payload.actualBytes;
  const perfPass = aggA.writeTotal.p50 < 3000 && aggB.writeTotal.p50 < 3000; // 用户触发式存档，3s 内可接受
  const recoveryPass = recovery.recovered.ok && recovery.recovered.recoveredVer === 2 && recovery.recovered.dataOk;
  const go = atomicPass && integrityPass && quotaPass && perfPass && recoveryPass;

  const out = {
    generatedAt: new Date().toISOString(),
    chrome: CHROME,
    task: 'H4 存档 28.7MB IndexedDB 原子写（全量工作清单 -1 阶段 H4 行）',
    blankPagePolicy: 'about:blank/data: 为 opaque origin，indexedDB 被拒（见 opaqueOriginProbe）；改用仅回环临时端口的零脚本空 HTML，不加载游戏页面',
    opaqueOriginProbe: opaqueProbe,
    env, payload, storage, atomic, recovery,
    A: { rounds: A, agg: aggA },
    B: { rounds: B, agg: aggB },
    verdict: {
      go,
      criteria: { atomicPass, integrityPass, quotaPass, perfPass, recoveryPass, sizeOk },
      thresholds: { writeTotalP50Ms: 3000, quotaMinFactor: 10, sizeTolerance: 0.05 },
    },
    notes, pageErrors,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

  // ---- 控制台摘要 ----
  const row = (k, v) => console.log('  ' + k.padEnd(34) + v);
  console.log('\n[h4] ===== 环境与 payload =====');
  row('origin / scripts / resources', env.origin + ' / ' + env.scripts + ' / ' + env.resources);
  row('CompressionStream deflate-raw', String(env.compressionStream) + ' / ' + env.deflateRawFormat);
  row('payload 实际大小', payload.rawMB + ' MB（目标 ' + mb(TARGET_BYTES) + ' MB, 偏差 ' + ((100 * (payload.actualBytes - TARGET_BYTES) / TARGET_BYTES).toFixed(1)) + '%）');
  row('实体 / 任务 / 物品 / 体素字符', payload.nEntities + ' / ' + payload.nQuests + ' / ' + payload.nItems + ' / ' + payload.voxChars);
  row('payload SHA-256', payload.sha256.slice(0, 16) + '…');
  console.log('\n[h4] ===== A/B 写入（各 ' + ROUNDS + ' 轮, ms） =====');
  const fmt = (s) => s.n ? ('p50 ' + ms1(s.p50) + ' / p95 ' + ms1(s.p95) + ' / max ' + ms1(s.max)) : '-';
  row('A stringify', fmt(aggA.stringify));
  row('A put（含事务提交）', fmt(aggA.put));
  row('A 写入合计', fmt(aggA.writeTotal));
  row('A 读回(get)+校验', fmt(aggA.readGet) + ' + ' + fmt(aggA.verify));
  row('A hash 一致 / longtask', String(aggA.hashAllOk) + ' / n=' + aggA.longTasks.p50 + ' max ' + ms1(aggA.longTaskMax) + 'ms');
  row('B stringify', fmt(aggB.stringify));
  row('B compress(deflate-raw)', fmt(aggB.compress));
  row('B put（含事务提交）', fmt(aggB.put));
  row('B 写入合计', fmt(aggB.writeTotal));
  row('B 读回(get+inflate)+校验', fmt(aggB.readGet) + ' + ' + fmt(aggB.verify));
  row('B 压缩率 / hash / longtask', (aggB.ratio * 100).toFixed(1) + '% / ' + String(aggB.hashAllOk) + ' / n=' + aggB.longTasks.p50 + ' max ' + ms1(aggB.longTaskMax) + 'ms');
  row('A estimate 落盘占用', fmt(aggA.usageAfter) + ' bytes → ' + mb(aggA.usageAfter.p50) + ' MB');
  row('B estimate 落盘占用', fmt(aggB.usageAfter) + ' bytes → ' + mb(aggB.usageAfter.p50) + ' MB');
  console.log('\n[h4] ===== 原子性（双 store 同 readwrite 事务） =====');
  row('对照：双写成功', atomic.control.ended + ', keys=' + JSON.stringify(atomic.control.slotKeys) + ', lastGood=' + atomic.control.lastGood);
  row('注入：第二 store 请求错误', 'syncThrow=' + atomic.injection.reqErrSync + ', ended=' + atomic.injection.ended + ' (' + atomic.injection.errorName + '), v2 残留=' + atomic.injection.slotKeys.includes('save:v2') + ', lastGood=' + atomic.injection.lastGood);
  row('失败后继续写', atomic.postFailWrite.ended + ', keys=' + JSON.stringify(atomic.postFailWrite.slotKeys));
  row('显式 abort', atomic.manualAbort.ended + ', v3 残留=' + atomic.manualAbort.slotKeys.includes('save:v3'));
  row('同步抛错路径（坑）', 'throw=' + atomic.syncThrowCase.syncThrow + ', ended=' + atomic.syncThrowCase.ended + ', v4 残留=' + atomic.syncThrowCase.slotKeys.includes('save:v4') + '（不显式 abort 会半写提交）');
  console.log('\n[h4] ===== 配额 / 持久化 / 恢复 =====');
  row('persist()', String(storage.persisted) + (storage.persistErr ? ' err=' + storage.persistErr : ''));
  row('quota / usage', mb(storage.quotaBytes) + ' MB / ' + mb(storage.usageBytesBefore) + ' MB');
  row('恢复演练', 'v3 截断写→parse 失败→回退 v' + recovery.recovered.recoveredVer + ', hashOk=' + recovery.recovered.dataOk + ', steps=' + JSON.stringify(recovery.recovered.steps));
  console.log('\n[h4] ===== 判定 =====');
  console.log('  atomicPass=' + atomicPass + ' integrityPass=' + integrityPass + ' quotaPass=' + quotaPass + ' perfPass=' + perfPass + ' recoveryPass=' + recoveryPass);
  console.log('  VERDICT: ' + (go ? 'GO' : 'NO-GO（见 criteria 明细）'));
  if (notes.length) console.log('  notes: ' + notes.join(' | '));
  if (pageErrors.length) console.log('  pageErrors: ' + pageErrors.slice(0, 5).join(' | '));
  console.log('[h4] 写出 → ' + OUT);
  code = 0;
} catch (err) {
  console.error('[h4] FAILED:', String(err).slice(0, 500));
  code = 1;
} finally {
  if (server) server.close();
  if (browser) await browser.close().catch(() => {});
}
process.exit(code);
