/**
 * creations/dragon/build.mjs —— H3 spike：手写「一条龙」的 CreationBundle 生成器。
 *
 * 这是 ADR-8 许愿造物链路的第一段真实交付：不依赖任何模型文件，纯程序化几何，
 * 产出符合 creation/1 schema 的 bundle，必须通过 scripts/probe-creation-bundle.mjs 四门：
 *   门1 面数 ≤ 20000   门2 包围盒最大边 ≤ 200m   门3 内存 ≤ 8MB   门4 确定性（seed + 双跑同 hash）
 *
 * 确定性纪律：几何只由本文件的常量驱动，不用 Math.random / Date.now——
 * 同版本脚本双跑必须逐字节一致（验收里有 diff 复核）。
 *
 * 用法：node creations/dragon/build.mjs   → 写出 creations/dragon/dragon.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ============ 形体参数（调这里就是调龙） ============
const SEED = 20261104;
const L = 40;            // 体长（m，沿 +x）
const R_HEAD = 1.9;      // 颈后最粗半径
const R_TAIL = 0.16;     // 尾尖半径
const AMP = 3.2;         // 蛇形摆幅（y 向）
const WAVES = 1.75;      // 全长波数
const RINGS = 44;        // 放样环数
const SEG = 10;          // 每环边数

const pos = [];
const idx = [];
const ring = (xc, yc, zc, r, squash = 1) => {
  const base = pos.length / 3;
  for (let j = 0; j < SEG; j++) {
    const a = (j / SEG) * Math.PI * 2;
    pos.push(xc, yc + r * Math.cos(a), zc + r * Math.sin(a) * squash);
  }
  return base;
};
// 相邻环连四边形（绕向：外表面）
const stitch = (b0, b1) => {
  for (let j = 0; j < SEG; j++) {
    const j2 = (j + 1) % SEG;
    idx.push(b0 + j, b0 + j2, b1 + j, b0 + j2, b1 + j2, b1 + j);
  }
};
const radiusAt = (t) => R_TAIL + (R_HEAD - R_TAIL) * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5) ** 0.8;
const spineY = (t) => AMP * Math.sin(t * Math.PI * 2 * WAVES) * (0.35 + 0.65 * t);

// ---- 身体放样 ----
let prev = -1;
for (let i = 0; i <= RINGS; i++) {
  const t = i / RINGS;
  const r = radiusAt(t) * (i === 0 || i === RINGS ? 0.55 : 1); // 首尾收口
  prev = ring(t * L, spineY(t), 0, r, 0.92);
  if (i > 0) stitch(prev - SEG, prev);
}
// 尾尖锥
{
  const base = pos.length / 3;
  const tEnd = spineY(1);
  pos.push(L + 2.6, tEnd + 0.35, 0);
  const tip = base;
  const last = RINGS * SEG; // 末环起点（i=RINGS 时 ring 返回的 base）
  for (let j = 0; j < SEG; j++) idx.push(last + j, last + (j + 1) % SEG, tip);
}
// ---- 头部（吻锥 + 下颌 + 双角 + 双眼） ----
{
  const yHead = spineY(1);
  const xHead = L + 0.4;
  // 上吻：四棱锥（8 tri 的八面体拉长）
  const skull = (cx, cy, cz, sx, sy, sz) => {
    const b = pos.length / 3;
    const v = [
      [cx - sx, cy, cz], [cx + sx * 1.6, cy + sy * 0.25, cz],
      [cx, cy + sy, cz - sz * 0.6], [cx, cy + sy, cz + sz * 0.6],
      [cx, cy - sy * 0.9, cz - sz], [cx, cy - sy * 0.9, cz + sz],
    ];
    for (const p of v) pos.push(p[0], p[1], p[2]);
    const F = [[0,2,4],[0,4,5],[0,5,3],[0,3,2],[1,3,5],[1,4,3],[1,5,2],[1,2,4]];
    for (const f of F) idx.push(b + f[0], b + f[1], b + f[2]);
  };
  skull(xHead + 2.2, yHead + 0.5, 0, 2.4, 1.1, 1.15);            // 吻部
  skull(xHead + 1.2, yHead - 0.9, 0, 1.5, 0.55, 0.8);            // 下颌
  // 双角：后掠双锥
  for (const s of [-1, 1]) {
    const b = pos.length / 3;
    const bx = xHead - 0.6, by = yHead + 1.2, bz = s * 0.75;
    const tipx = bx - 3.1, tipy = by + 2.3, tipz = bz + s * 1.35;
    const r0 = 0.34;
    const c = [];
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2;
      c.push([bx + r0 * Math.cos(a), by, bz + r0 * Math.sin(a)]);
    }
    for (const p of c) pos.push(p[0], p[1], p[2]);
    pos.push(tipx, tipy, tipz);
    for (let j = 0; j < 6; j++) idx.push(b + j, b + (j + 1) % 6, b + 6);
  }
  // 双眼：小八面体（glow 材质在材质组声明，几何共用 body 的单一组——creation/1 是单几何组）
  for (const s of [-1, 1]) {
    const b = pos.length / 3;
    const cx = xHead + 0.6, cy = yHead + 0.8, cz = s * 0.95, r = 0.3;
    pos.push(cx + r, cy, cz, cx - r, cy, cz, cx, cy + r, cz, cx, cy - r, cz, cx, cy, cz - r, cx, cy, cz + r);
    const F = [[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,3,4],[1,5,3],[1,2,5],[1,4,2]];
    for (const f of F) idx.push(b + f[0], b + f[1], b + f[2]);
  }
}
// ---- 背鳍（锯齿薄条）与尾鳍 ----
{
  const NFIN = 16;
  for (let i = 1; i <= NFIN; i++) {
    const t = 0.12 + (i / (NFIN + 1)) * 0.8;
    const x = t * L, y = spineY(t) + radiusAt(t) * 0.92, h = 0.55 + 0.5 * Math.sin(t * Math.PI);
    const b = pos.length / 3;
    pos.push(x - 0.5, y, 0, x + 0.5, y, 0, x, y + h, 0);
    idx.push(b, b + 1, b + 2, b + 1, b, b + 2);
  }
  // 尾鳍三片
  for (const [dy, dz, rot] of [[0.3, 0, 0.55], [-0.2, 0.45, 0.3], [-0.2, -0.45, 0.3]]) {
    const b = pos.length / 3;
    const x0 = L + 0.8, y0 = spineY(1) + dy;
    pos.push(x0, y0, dz, x0 + 2.4, y0 + 1.5 * rot + dy, dz * 1.4, x0 + 2.4, y0 - 1.2 * rot + dy, dz * 1.4);
    idx.push(b, b + 1, b + 2);
  }
}
// ---- 四腿（两段圆柱 + 三趾锥，走放样环口径） ----
const legAt = (t, s) => {
  const x = t * L;
  const y0 = spineY(t) - radiusAt(t) * 0.55;
  const seg = (xa, ya, xb, yb, r0, r1) => {
    const a = ring(xa, ya, s * 0.6, r0);
    const b2 = ring(xb, yb, s * 0.95, r1);
    stitch(a, b2);
  };
  seg(x, y0, x - 0.7, y0 - 1.5, 0.42, 0.34);
  seg(x - 0.7, y0 - 1.5, x - 0.2, -0.2, 0.34, 0.26);
  // 三趾
  for (const dz of [-0.22, 0, 0.22]) {
    const b = pos.length / 3;
    const bx = x - 0.2, by = -0.2, bz = s * 0.95 + dz;
    pos.push(bx - 0.16, by, bz, bx + 0.16, by, bz, bx - 0.05, by - 0.55, bz + dz * 0.6);
    idx.push(b, b + 1, b + 2);
  }
};
legAt(0.24, -1); legAt(0.36, 1); legAt(0.62, -1); legAt(0.74, 1);

// ---- 组包 ----
const positions = Buffer.from(new Float32Array(pos).buffer).toString('base64');
const indices = Buffer.from(new Uint32Array(idx).buffer).toString('base64');
const b64len = (s) => Math.floor((s.length * 3) / 4);
const tris = idx.length / 3;
const body = {
  schema: 'creation/1',
  id: 'dragon_h3_spike',
  prompt: '一条龙',
  seed: SEED,
  modelVersion: 'hand-dragon/1',
  geometry: { positions, indices },
  materials: ['metal', 'glow'],
  collider: { kind: 'capsule', params: { r: 2.2, h: L * 0.8 } },
  interact: { verb: '骑', range: 4 },
  behavior: { kind: 'fly', params: { speed: 7 } },
  lifecycle: { persist: true },
  budget: { tris, bytes: b64len(positions) + b64len(indices) },
};
const hash = 'sha256:' + createHash('sha256').update(JSON.stringify(body)).digest('hex');
const out = { ...body, hash };

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
const file = join(here, 'dragon.json');
writeFileSync(file, JSON.stringify(out));
console.log(`[dragon] tris=${tris} verts=${pos.length / 3} bytes=${out.budget.bytes} hash=${hash.slice(0, 18)}…`);
console.log(`[dragon] 写出 → ${file}`);
