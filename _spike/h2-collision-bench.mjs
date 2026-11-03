#!/usr/bin/env node
// ============================================================================
// H2 spike · 碰撞预算基准（纯 Node，零依赖，只读 src/，不写 src/，无 git 操作）
//
// 问题（全量工作清单.md -1 阶段 H2 行）：动态碰撞查询对每帧的开销——
//   决定 P0-2 用 broadphase 还是网格哈希。
//
// 负载模型（按 P0-1 实体表口径 + 现场规模）：
//   · 4,400 个实体：3,600 街面行人（动态）+ 400 广场（摊位/行人）+ 400 外围（建筑/造物）
//   · 每帧 12 辆车 × 邻域查询（半径 2.2m，= src/game/physics.ts:211 npcSweep 命中半径）
//   · 每帧 100 次 pointQuery（P0-2 groundHeight 式：取覆盖点的最高 top）
//
// 参测结构：
//   a1 naive-alloc   朴素线性扫，复刻 npcSweep 式每次比对 pos.clone()（现网反面教材，审计 P1-3/E1）
//   a2 naive-noalloc 朴素线性扫，纯算术（「最规矩的朴素实现」——分离结构成本与分配成本）
//   b0 grid-rebuild-clear  网格哈希 cell=8m，每帧 map.clear() + 全量重插 + 全新数组（第一版直写法）
//   b1 grid-rebuild-pooled 网格哈希 cell=8m，每帧全量重插但池化复用 cell 数组
//   b2 grid-incremental    网格哈希 cell=8m，静态插一次，动态只搬运换格者（swap-remove）
//   b2@4m / b2@16m         增量网格的 cell 尺寸对照（为「cell 取多少」提供实测依据）
//   c  sap                 按 AABB min-x 排序扫掠（近序插入排序 + 二分窗口）
//   [补充] P0-7 量级外推：b2@8m 与 a2 在 4,400 pointQuery/帧（全员贴地）下的实测
//
// 确定性：mulberry32 固定 seed，全程无 Math.random；同 seed ⇒ 同世界、同帧序列、同校验和。
// 纪律：热身 50 帧后才采样 300 帧；结论只基于实测数字。
// ============================================================================

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---- 强制 --expose-gc（内存读数需要；子进程 stdio 原样透传，输出不变） ----
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'h2-bench.json');

// ---- 可调常量（负载口径） ----
const SEED = 20261104;
const WARMUP = 50;          // 热身帧（纪律要求）
const SAMPLE = 300;         // 采样帧（≥200）
const PASSES = 2;           // 跑两轮看稳定性，取更差值
const DT = 1 / 60;          // 固定步（与 ImpactSystem.FIXED_DT=1/120 不同：这里 1 帧模拟 1 个 60fps 渲染步）
const N_VEHICLES = 12;
const N_POINTQ = 100;
const VEHICLE_R = 2.2;      // npcSweep 命中半径
const AREA = 3600;          // 实体分布半宽（m），覆盖汴京城区尺度
const BUDGET_DEV_P95 = 33.3;      // dev frame p95 红线（全量工作清单 H5 节口径）
const BUDGET_PACKAGED_P95 = 58;   // 打包态 verify-packaged frameP95
const BUDGET_VSYNC = 16.7;        // 60fps 单帧

// ---- mulberry32（确定性 PRNG，禁止裸 Math.random） ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 分配计数器（GC 压力代理；只在帧内热路径计） ----
let ALLOCS = 0;
function allocArr() { ALLOCS++; return []; }
class V { // three.js Vector3 最小子集，构造即计数（clone/sub/length 语义同 three）
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; ALLOCS++; }
  clone() { return new V(this.x, this.y, this.z); }
  sub(o) { this.x -= o.x; this.y -= o.y; this.z -= o.z; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
}

// ============================================================================
// 1. 确定性世界生成（街道走廊集群 + 广场 + 外围，人群沿街行走 = crowd.ts 的 axis 模式）
// ============================================================================
const rnd = mulberry32(SEED);
const streets = [];
for (let i = 0; i < 12; i++) {
  streets.push({
    cx: (rnd() - 0.5) * 2400, cz: (rnd() - 0.5) * 2400,
    len: 240, halfW: 6, axis: rnd() < 0.5,
  });
}

const ENT = []; // { id, kind, pos:V, hw, top, dyn, vx, vz, minX,maxX,minZ,maxZ, cell, slot }
function addE(kind, x, z, hw, top, dyn, vx, vz, box) {
  ENT.push({
    id: ENT.length, kind, pos: new V(x, 0, z), hw, top, dyn,
    vx: vx || 0, vz: vz || 0,
    minX: box[0], maxX: box[1], minZ: box[2], maxZ: box[3],
    cell: -1, slot: -1,
  });
}

// 3,600 街面行人（每街 300，动态，沿街轴向慢速）
for (let s = 0; s < 12; s++) {
  const st = streets[s];
  for (let k = 0; k < 300; k++) {
    const along = (rnd() - 0.5) * st.len;
    const lat = (rnd() - 0.5) * st.halfW * 2;
    const spd = 0.8 + rnd() * 0.8;
    const dir = rnd() < 0.5 ? 1 : -1;
    const x = st.axis ? st.cx + along : st.cx + lat;
    const z = st.axis ? st.cz + lat : st.cz + along;
    const vx = st.axis ? dir * spd : 0, vz = st.axis ? 0 : dir * spd;
    addE('npc', x, z, 0.35, 1.7, true, vx, vz,
      [st.cx - st.len / 2, st.cx + st.len / 2, st.cz - st.halfW, st.cz + st.halfW]);
  }
}
// 400 广场（2 个，σ=30m 高斯；70% 行人 + 30% 摊位/造物静态）
const gauss = () => {
  const u1 = 1 - rnd(), u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
for (let p = 0; p < 2; p++) {
  const pcx = (rnd() - 0.5) * 2000, pcz = (rnd() - 0.5) * 2000;
  for (let k = 0; k < 200; k++) {
    const x = pcx + gauss() * 30, z = pcz + gauss() * 30;
    if (rnd() < 0.7) {
      const a = rnd() * Math.PI * 2, spd = 0.6 + rnd() * 0.8;
      addE('npc', x, z, 0.35, 1.7, true, Math.cos(a) * spd, Math.sin(a) * spd,
        [pcx - 60, pcx + 60, pcz - 60, pcz + 60]);
    } else {
      addE('creation', x, z, 1 + rnd() * 1.5, 1.5 + rnd() * 2, false, 0, 0,
        [pcx - 60, pcx + 60, pcz - 60, pcz + 60]);
    }
  }
}
// 400 外围（85% 建筑/造物静态 hw≤5 + 15% 行人）
for (let k = 0; k < 400; k++) {
  const x = (rnd() - 0.5) * AREA, z = (rnd() - 0.5) * AREA;
  if (rnd() < 0.85) {
    addE('building', x, z, 2 + rnd() * 3, 4 + rnd() * 8, false, 0, 0, [-AREA / 2, AREA / 2, -AREA / 2, AREA / 2]);
  } else {
    const a = rnd() * Math.PI * 2, spd = 0.5 + rnd();
    addE('npc', x, z, 0.35, 1.7, true, Math.cos(a) * spd, Math.sin(a) * spd,
      [-AREA / 2, AREA / 2, -AREA / 2, AREA / 2]);
  }
}
const N = ENT.length;
let MAX_HW = 0;
for (const e of ENT) if (e.hw > MAX_HW) MAX_HW = e.hw;

// 12 辆车（查询源，不入 4,400 目标集；每街 1 辆巡逻）
const VEH = [];
for (let s = 0; s < 12; s++) {
  const st = streets[s];
  const along = (rnd() - 0.5) * st.len * 0.8;
  VEH.push({
    pos: new V(st.axis ? st.cx + along : st.cx + (rnd() - 0.5) * 8, 0, st.axis ? st.cz + (rnd() - 0.5) * 8 : st.cz + along),
    speed: 8 + rnd() * 6, dir: rnd() < 0.5 ? 1 : -1, axis: st.axis,
    minX: st.cx - st.len / 2, maxX: st.cx + st.len / 2,
    minZ: st.cz - st.len / 2, maxZ: st.cz + st.len / 2,
    homeX: st.cx, homeZ: st.cz, hw: 1.6,
  });
}

// 初始状态快照（每轮 reset 用，保证两轮逐位一致）
const SNAP = ENT.map((e) => ({ x: e.pos.x, z: e.pos.z, vx: e.vx, vz: e.vz }));
const VSNAP = VEH.map((v) => ({ x: v.pos.x, z: v.pos.z, dir: v.dir }));

function resetSim() {
  for (let i = 0; i < N; i++) { const e = ENT[i], s = SNAP[i]; e.pos.x = s.x; e.pos.z = s.z; e.vx = s.vx; e.vz = s.vz; }
  for (let i = 0; i < VEH.length; i++) { const v = VEH[i], s = VSNAP[i]; v.pos.x = s.x; v.pos.z = s.z; v.dir = s.dir; }
}
function integrate() { // 推进 + 边界反弹（时序区外，公共成本，不计入结构）
  for (let i = 0; i < N; i++) {
    const e = ENT[i]; if (!e.dyn) continue;
    let x = e.pos.x + e.vx * DT, z = e.pos.z + e.vz * DT;
    if (x > e.maxX) { x = e.maxX; e.vx = -Math.abs(e.vx); } else if (x < e.minX) { x = e.minX; e.vx = Math.abs(e.vx); }
    if (z > e.maxZ) { z = e.maxZ; e.vz = -Math.abs(e.vz); } else if (z < e.minZ) { z = e.minZ; e.vz = Math.abs(e.vz); }
    e.pos.x = x; e.pos.z = z;
  }
  for (const v of VEH) {
    if (v.axis) { let x = v.pos.x + v.dir * v.speed * DT; if (x > v.maxX || x < v.minX) { v.dir = -v.dir; x = Math.min(v.maxX, Math.max(v.minX, x)); } v.pos.x = x; }
    else { let z = v.pos.z + v.dir * v.speed * DT; if (z > v.maxZ || z < v.minZ) { v.dir = -v.dir; z = Math.min(v.maxZ, Math.max(v.minZ, z)); } v.pos.z = z; }
  }
}

// 每帧 pointQuery 位置（确定性序列；缓冲复用，时序区外生成）。
// nPq 可变：主负载 100（任务口径）+ 补充负载 4400（P0-7 统一地面模型「全员每帧贴地」的量级）
const PQ_MAX = 4400;
const pqx = new Float64Array(PQ_MAX), pqz = new Float64Array(PQ_MAX);
let qr = null;
function pointQueriesForFrame(f, nPq) {
  const half = nPq >> 1;
  for (let q = 0; q < half; q++) {
    const st = streets[(f * 7 + q) % 12];
    const along = (qr() - 0.5) * st.len, lat = (qr() - 0.5) * st.halfW * 2;
    pqx[q] = st.axis ? st.cx + along : st.cx + lat;
    pqz[q] = st.axis ? st.cz + lat : st.cz + along;
  }
  for (let q = half; q < nPq; q++) { pqx[q] = (qr() - 0.5) * AREA; pqz[q] = (qr() - 0.5) * AREA; }
}

// ============================================================================
// 2. 参测结构（谓词全结构统一：邻域=中心距²≤r²；pointQuery=AABB 含点取最高 top）
// ============================================================================
const outBuf = []; // 复用候选缓冲（所有结构共用，禁止在查询内新建）

// --- a1/a2 朴素线性扫 ---
// 谓词与网格/SAP 逐位同一（dx²+dz²≤r²，省略 npcSweep 的 d<0.01 退化排除），
// 保证校验和跨结构可比；a1 与 a2 的唯一差别 = 每次 比对一次 pos.clone()。
class Naive {
  constructor(allocStyle) { this.allocStyle = allocStyle; this.name = allocStyle ? 'a1-naive-alloc(npcSweep式)' : 'a2-naive-noalloc'; }
  reset() {}
  beginFrame() {}
  neighborhood(vx, vz, r, out) {
    const r2 = r * r;
    if (this.allocStyle) {
      const vp = new V(vx, 0, vz); // 复刻 npcSweep 每车一次 fwd/new（physics.ts:205）
      for (let i = 0; i < N; i++) {
        const e = ENT[i];
        const to = e.pos.clone().sub(vp); to.y = 0; // physics.ts:208 同款 per-walker clone
        const dx = to.x, dz = to.z;
        if (dx * dx + dz * dz <= r2) out.push(i);
      }
    } else {
      for (let i = 0; i < N; i++) {
        const e = ENT[i];
        const dx = e.pos.x - vx, dz = e.pos.z - vz;
        if (dx * dx + dz * dz <= r2) out.push(i);
      }
    }
  }
  pointQuery(px, pz) {
    let best = 0;
    for (let i = 0; i < N; i++) {
      const e = ENT[i];
      if (Math.abs(px - e.pos.x) <= e.hw && Math.abs(pz - e.pos.z) <= e.hw && e.top > best) best = e.top;
    }
    return best;
  }
}

// --- b0/b1/b2 均匀网格哈希（中心格插入，查询窗口扩 MAX_HW） ---
class GridHash {
  constructor(cell, mode) {
    this.cell = cell; this.mode = mode; // 'rebuild-clear' | 'rebuild-pooled' | 'incremental'
    this.map = new Map(); this.active = [];
    this.cells = 0; this.lastInserts = 0; this.lastMoves = 0;
    this.name = mode === 'incremental' ? `b2-grid-incremental@${cell}m`
      : mode === 'rebuild-pooled' ? 'b1-grid-rebuild-pooled@8m' : 'b0-grid-rebuild-clear@8m';
    for (let i = 0; i < N; i++) this.insertNew(i); // 全量首插
  }
  reset() { this.map = new Map(); this.active = []; this.cells = 0; for (let i = 0; i < N; i++) this.insertNew(i); }
  pack(ci, cj) { return ((ci + 8192) << 14) | (cj + 8192); }
  insertNew(i) {
    const e = ENT[i];
    const key = this.pack(Math.floor(e.pos.x / this.cell), Math.floor(e.pos.z / this.cell));
    let arr = this.map.get(key);
    if (arr === undefined) { arr = allocArr(); this.map.set(key, arr); this.cells++; }
    if (this.mode !== 'incremental' || arr.length === 0) this.active.push(key); // incremental 只为 reset 统计，无害
    e.slot = arr.length; e.cell = key; arr.push(i);
  }
  beginFrame() {
    if (this.mode === 'incremental') {
      let moves = 0;
      for (let i = 0; i < N; i++) {
        const e = ENT[i]; if (!e.dyn) continue;
        const key = this.pack(Math.floor(e.pos.x / this.cell), Math.floor(e.pos.z / this.cell));
        if (key === e.cell) continue;
        // swap-remove 旧格
        const old = this.map.get(e.cell);
        const last = old[old.length - 1];
        old[e.slot] = last; ENT[last].slot = e.slot; old.pop();
        // 插新格
        let arr = this.map.get(key);
        if (arr === undefined) { arr = allocArr(); this.map.set(key, arr); this.cells++; }
        e.slot = arr.length; e.cell = key; arr.push(i);
        moves++;
      }
      this.lastMoves = moves; this.lastInserts = 0;
    } else {
      // 重建：清空后全量重插
      if (this.mode === 'rebuild-clear') { this.map.clear(); this.cells = 0; }
      else { for (let k = 0; k < this.active.length; k++) this.map.get(this.active[k]).length = 0; this.active.length = 0; }
      let inserts = 0;
      for (let i = 0; i < N; i++) {
        const e = ENT[i];
        const key = this.pack(Math.floor(e.pos.x / this.cell), Math.floor(e.pos.z / this.cell));
        let arr = this.map.get(key);
        if (arr === undefined) { arr = allocArr(); this.map.set(key, arr); this.cells++; this.active.push(key); }
        else if (arr.length === 0) this.active.push(key);
        e.slot = arr.length; e.cell = key; arr.push(i); inserts++;
      }
      this.lastInserts = inserts; this.lastMoves = 0;
    }
  }
  neighborhood(vx, vz, r, out) {
    const c = this.cell, R = r + MAX_HW;
    const i0 = Math.floor((vx - R) / c), i1 = Math.floor((vx + R) / c);
    const j0 = Math.floor((vz - R) / c), j1 = Math.floor((vz + R) / c);
    const r2 = r * r;
    for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
      const arr = this.map.get(this.pack(ci, cj));
      if (arr === undefined) continue;
      for (let k = 0; k < arr.length; k++) {
        const e = ENT[arr[k]];
        const dx = e.pos.x - vx, dz = e.pos.z - vz;
        if (dx * dx + dz * dz <= r2) out.push(arr[k]);
      }
    }
  }
  pointQuery(px, pz) {
    const c = this.cell, R = MAX_HW;
    let best = 0;
    const i0 = Math.floor((px - R) / c), i1 = Math.floor((px + R) / c);
    const j0 = Math.floor((pz - R) / c), j1 = Math.floor((pz + R) / c);
    for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
      const arr = this.map.get(this.pack(ci, cj));
      if (arr === undefined) continue;
      for (let k = 0; k < arr.length; k++) {
        const e = ENT[arr[k]];
        if (Math.abs(px - e.pos.x) <= e.hw && Math.abs(pz - e.pos.z) <= e.hw && e.top > best) best = e.top;
      }
    }
    return best;
  }
  footprint() {
    let slots = 0;
    for (const arr of this.map.values()) slots += arr.length;
    const bytes = this.map.size * 48 + slots * 8 + this.map.size * 64;
    return { cells: this.map.size, slots, estKB: +(bytes / 1024).toFixed(1) };
  }
}

// --- c SAP：按 min-x 排序扫掠（近序插入排序维持 + 二分取窗） ---
class Sap {
  constructor() {
    this.minx = new Float64Array(N);
    this.ord = new Int32Array(N);
    this.name = 'c-sap(sorted-sweep)';
    for (let i = 0; i < N; i++) { this.ord[i] = i; this.minx[i] = ENT[i].pos.x - ENT[i].hw; }
    // 首次全排（Int32Array.sort 带比较器，确定性）
    this.ord.sort((a, b) => this.minx[a] - this.minx[b]);
  }
  reset() { // 复位重排
    for (let i = 0; i < N; i++) { this.ord[i] = i; this.minx[i] = ENT[i].pos.x - ENT[i].hw; }
    this.ord.sort((a, b) => this.minx[a] - this.minx[b]);
  }
  beginFrame() {
    const mx = this.minx, ord = this.ord;
    for (let i = 0; i < N; i++) { const e = ENT[i]; if (e.dyn) mx[i] = e.pos.x - e.hw; }
    // 近序插入排序：本负载每帧位移 ≤0.25m，逆序数极小，摊还 O(n)
    for (let i = 1; i < N; i++) {
      const ei = ord[i], ki = mx[ei];
      let j = i - 1;
      while (j >= 0 && mx[ord[j]] > ki) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = ei;
    }
  }
  lowerBound(t) { // 首个 minx ≥ t 的序位
    const mx = this.minx, ord = this.ord;
    let lo = 0, hi = N;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (mx[ord[mid]] < t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  neighborhood(vx, vz, r, out) {
    const r2 = r * r;
    let i = this.lowerBound(vx - r - 2 * MAX_HW);
    const mx = this.minx, ord = this.ord;
    for (; i < N && mx[ord[i]] <= vx + r; i++) {
      const e = ENT[ord[i]];
      if (e.pos.x + e.hw < vx - r) continue;
      const dx = e.pos.x - vx, dz = e.pos.z - vz;
      if (dx * dx + dz * dz <= r2) out.push(ord[i]);
    }
  }
  pointQuery(px, pz) {
    let best = 0;
    let i = this.lowerBound(px - 2 * MAX_HW);
    const mx = this.minx, ord = this.ord;
    for (; i < N && mx[ord[i]] <= px; i++) {
      const e = ENT[ord[i]];
      if (Math.abs(px - e.pos.x) <= e.hw && Math.abs(pz - e.pos.z) <= e.hw && e.top > best) best = e.top;
    }
    return best;
  }
  footprint() { return { cells: N, slots: N, estKB: +((N * 8 + N * 4) / 1024).toFixed(1) }; }
}

// ============================================================================
// 3. 测量（热身 50 帧后采样；两轮取更差；校验和跨结构逐位比对）
// ============================================================================
function pctl(sorted, p) { const i = Math.max(0, Math.ceil(p * sorted.length) - 1); return sorted[i]; }

function runPass(struct, nPq, nSample) {
  resetSim();
  struct.reset();
  qr = mulberry32(SEED ^ 0x9e3779b9);
  const times = new Float64Array(nSample);
  let allocMark = ALLOCS, allocsSampled = 0;
  let candSum = 0, idSum = 0, topSum = 0, insertsSum = 0, movesSum = 0;
  for (let f = 0; f < WARMUP + nSample; f++) {
    integrate();
    pointQueriesForFrame(f, nPq);
    const t0 = performance.now();
    struct.beginFrame();
    for (let v = 0; v < VEH.length; v++) {
      outBuf.length = 0;
      struct.neighborhood(VEH[v].pos.x, VEH[v].pos.z, VEHICLE_R, outBuf);
      if (f >= WARMUP) { candSum += outBuf.length; for (let k = 0; k < outBuf.length; k++) idSum += outBuf[k]; }
    }
    for (let q = 0; q < nPq; q++) { const t = struct.pointQuery(pqx[q], pqz[q]); if (f >= WARMUP) topSum += t; }
    const t1 = performance.now();
    if (f >= WARMUP) {
      times[f - WARMUP] = t1 - t0;
      allocsSampled += ALLOCS - allocMark;
      if (struct.lastInserts) insertsSum += struct.lastInserts;
      if (struct.lastMoves !== undefined) movesSum += struct.lastMoves;
    }
    allocMark = ALLOCS; // 每帧收尾都推进基线：首个采样帧不得带入热身期的分配
  }
  const sorted = Float64Array.from(times).sort();
  let sum = 0; for (let i = 0; i < nSample; i++) sum += times[i];
  return {
    avgMs: sum / nSample, p50Ms: pctl(sorted, 0.5), p95Ms: pctl(sorted, 0.95), maxMs: sorted[nSample - 1],
    allocsPerFrame: allocsSampled / nSample, checksum: { candSum, idSum, topSum },
    insertsPerFrame: struct.lastInserts ? insertsSum / nSample : undefined,
    movesPerFrame: struct.lastMoves !== undefined && !struct.lastInserts ? movesSum / nSample : undefined,
  };
}

function measure(struct, opts = {}) {
  const nPq = opts.nPq ?? N_POINTQ, nSample = opts.sample ?? SAMPLE, nPass = opts.passes ?? PASSES;
  ALLOCS = 0;
  const pass1 = runPass(struct, nPq, nSample);
  const pass2 = nPass >= 2 ? runPass(struct, nPq, nSample) : null; // 同 seed 第二轮：稳定性 + 确定性双重验证
  globalThis.gc();
  const heapMB = +(process.memoryUsage().heapUsed / 1048576).toFixed(1);
  const fp = struct.footprint ? struct.footprint() : { cells: 0, slots: 0, estKB: 0 };
  // 取两轮更差值（保守口径）；单轮补充测量直接取该轮
  const worst = (k) => (pass2 ? Math.max(pass1[k], pass2[k]) : pass1[k]);
  const c1 = pass1.checksum, c2 = pass2 ? pass2.checksum : null;
  const deterministic = c2 ? (c1.candSum === c2.candSum && c1.idSum === c2.idSum && c1.topSum === c2.topSum) : null;
  return {
    name: (opts.label ?? struct.name), mode: struct.mode ?? (struct.allocStyle ? 'naive' : 'sap'), cell: struct.cell ?? null,
    supplementary: opts.supplementary === true, pointQueriesPerFrame: nPq, sampledFrames: nSample,
    deterministic,
    avgMs: +worst('avgMs').toFixed(4), p50Ms: +worst('p50Ms').toFixed(4),
    p95Ms: +worst('p95Ms').toFixed(4), maxMs: +worst('maxMs').toFixed(4),
    allocsPerFrame: Math.round(worst('allocsPerFrame')),
    heapMB, footprint: fp,
    insertsPerFrame: (pass2 ?? pass1).insertsPerFrame, movesPerFrame: (pass2 ?? pass1).movesPerFrame,
    pctDevP95_avg: +(worst('avgMs') / BUDGET_DEV_P95 * 100).toFixed(2),
    pctDevP95_p95: +(worst('p95Ms') / BUDGET_DEV_P95 * 100).toFixed(2),
    pctVsync_avg: +(worst('avgMs') / BUDGET_VSYNC * 100).toFixed(2),
    checksum: (pass2 ?? pass1).checksum,
    pass1: { avgMs: +pass1.avgMs.toFixed(4), p95Ms: +pass1.p95Ms.toFixed(4) },
  };
}

// ---- 跑：主负载（12 车邻域 + 100 pointQuery，任务口径） ----
const structs = [
  new Naive(true),
  new Naive(false),
  new GridHash(8, 'rebuild-clear'),
  new GridHash(8, 'rebuild-pooled'),
  new GridHash(8, 'incremental'),
  new GridHash(4, 'incremental'),
  new GridHash(16, 'incremental'),
  new Sap(),
];
const results = [];
for (const s of structs) {
  const r = measure(s);
  results.push(r);
  // 进度行（逐结构即时输出，便于长时间运行观察）
  console.error(`  [done] ${r.name.padEnd(34)} avg=${r.avgMs}ms p95=${r.p95Ms}ms max=${r.maxMs}ms allocs/帧=${r.allocsPerFrame}`);
}

// ---- 确定性校验：主负载 8 结构校验和逐位一致（否则基准作废） ----
const ref = results[1].checksum; // a2 为参照
const okStructs = results.every((r) => r.checksum.candSum === ref.candSum && r.checksum.idSum === ref.idSum && r.checksum.topSum === ref.topSum);
const okPasses = results.every((r) => r.deterministic === true);
if (!okStructs || !okPasses) { console.error(`FATAL: 校验和不一致（跨结构=${okStructs} 跨轮=${okPasses}）——各结构查询结果不同，基准作废`); process.exit(1); }

// ---- 补充负载：P0-7 统一地面模型若做「全员每帧贴地」⇒ 4,400 pointQuery/帧（实测，非推算） ----
// 只测两个代表结构（增量网格@8m 与 朴素无分配线性扫），200 采样帧 × 1 轮，label 显式标注 [补充]。
const supplement = [];
{
  const sB2 = new GridHash(8, 'incremental');
  const rB2 = measure(sB2, { nPq: 4400, sample: 200, passes: 1, supplementary: true, label: '[补充]b2-incremental@8m×4400pq' });
  console.error(`  [done] ${rB2.name.padEnd(34)} avg=${rB2.avgMs}ms p95=${rB2.p95Ms}ms max=${rB2.maxMs}ms`);
  supplement.push(rB2);
  const sA2 = new Naive(false);
  const rA2 = measure(sA2, { nPq: 4400, sample: 200, passes: 1, supplementary: true, label: '[补充]a2-naive-noalloc×4400pq' });
  console.error(`  [done] ${rA2.name.padEnd(34)} avg=${rA2.avgMs}ms p95=${rA2.p95Ms}ms max=${rA2.maxMs}ms`);
  supplement.push(rA2);
}

// ---- 输出 JSON ----
const json = {
  meta: {
    spike: 'H2 碰撞预算', date: new Date().toISOString().slice(0, 10),
    node: process.version, platform: process.platform,
    seed: SEED, rng: 'mulberry32(无裸 Math.random)',
    warmupFrames: WARMUP, sampledFrames: SAMPLE, passes: PASSES, dtFrame: DT,
    load: {
      entities: N, byKind: ENT.reduce((m, e) => (m[e.kind] = (m[e.kind] || 0) + 1, m), {}),
      dynEntities: ENT.filter((e) => e.dyn).length, vehicles: N_VEHICLES,
      vehicleNeighborhoodR: VEHICLE_R, pointQueriesPerFrame: N_POINTQ, maxHw: MAX_HW,
      streets: streets.length, hitStats: { candidatesPerFrame: +(ref.candSum / SAMPLE).toFixed(1), pointHitRate: +(ref.topSum / SAMPLE / N_POINTQ).toFixed(3) },
    },
    budgetRef: { devFrameP95Ms: BUDGET_DEV_P95, packagedFrameP95Ms: BUDGET_PACKAGED_P95, vsync60Ms: BUDGET_VSYNC },
    predicate: '邻域=中心距²≤r²（npcSweep 语义，窄相过滤为公共成本不计）；pointQuery=AABB 含点取最高 top；车辆窄相/点积判向不计',
  },
  determinism: { identicalAcrossStructures: okStructs, identicalAcrossPasses: okPasses, note: '主负载 cand/id/top 三校验和跨 8 结构 × 2 轮逐位一致' },
  results,
  supplement,
};
writeFileSync(OUT, JSON.stringify(json, null, 2));

// ---- 控制台表 ----
const row = (cols, w) => cols.map((c, i) => String(c).padEnd(w[i])).join('  ');
const W = [34, 9, 9, 9, 10, 11, 9, 12, 10];
console.log('\n=== H2 碰撞预算基准（' + N + ' 实体 / ' + N_VEHICLES + ' 车×邻域 / ' + N_POINTQ + ' pointQuery 每帧，' + SAMPLE + ' 采样帧 × ' + PASSES + ' 轮取差值，seed=' + SEED + '）===');
console.log(row(['结构', 'avg ms', 'p50 ms', 'p95 ms', 'max ms', 'alloc/帧', 'cells', '占33.3ms%(p95)', '占16.7ms%'], W));
console.log('-'.repeat(136));
for (const r of results) {
  console.log(row([r.name, r.avgMs, r.p50Ms, r.p95Ms, r.maxMs, r.allocsPerFrame, r.footprint.cells, r.pctDevP95_p95, r.pctVsync_avg], W));
}
console.log('-'.repeat(136));
for (const r of supplement) {
  console.log(row([r.name + `(p95=${r.p95Ms}ms, ${r.pctDevP95_p95}% of 33.3)`, '', '', '', '', r.allocsPerFrame, r.footprint.cells, '', ''], W));
}
console.log('-'.repeat(136));
console.log(`确定性：校验和跨结构/跨轮逐位一致 = ${okStructs && okPasses} | JSON → ${OUT}`);
