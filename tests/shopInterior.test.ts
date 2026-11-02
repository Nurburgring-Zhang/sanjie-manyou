import { describe, it, expect } from 'vitest';
import type { Baker } from '../src/city/bake';
import {
  beginTradeInteriorAudit, endTradeInteriorAudit, buildTradeInterior, shopInteriorAudit,
  type TradeRoomAudit, type TradeRoomSpec,
} from '../src/city/interiors';
import { beltRoomSpecs } from '../src/city/centralbelt';
import { riverRoomSpecs } from '../src/city/riverbank';

// 判断「室内是不是空的」不能靠肉眼截图，靠这张表：
//   ① 每间可辨识器物件数（≥12）
//   ② 同业态不同形态的器物集合差异（≥20%）
//   ③ 最大空白地面矩形的小边 / 房间短边（<45%）
// 三个量都从 buildTradeInterior 的落位记录里算，与现场建模走同一份参数（frontRoomSpec /
// backRoomSpec / riverRoomSpec），因此测试报的数字就是场景里真实落的件数。

/** 只收几何调用的空壳烘焙器：buildTradeInterior 只用到 box / cyl / kit */
const stub = { box: () => {}, cyl: () => {}, kit: () => {} } as unknown as Baker;

/** 把世界坐标投影回房间局部系（u 沿面阔、v 沿进深；轴向由 spec 给出） */
function proj(s: TradeRoomSpec, x: number, z: number, axis: 'u' | 'v'): number {
  const dx = x - s.cx, dz = z - s.cz;
  return axis === 'u' ? dx * s.ux + dz * s.uz : dx * s.vx + dz * s.vz;
}

function extent(s: TradeRoomSpec, hx: number, hz: number, axis: 'u' | 'v'): number {
  return axis === 'u'
    ? Math.abs(hx * s.ux) + Math.abs(hz * s.uz)
    : Math.abs(hx * s.vx) + Math.abs(hz * s.vz);
}

/**
 * 最大空白地面矩形（轴对齐）：把地面栅格化，器物脚印外扩 `clearance` 后占格，
 * 墙内 0.25m 也算占格，再用直方图法求最大全空矩形。返回米制 [沿 u, 沿 v]。
 */
function largestEmptyRect(r: TradeRoomAudit, s: TradeRoomSpec, cell = 0.25, clearance = 0.3): { u: number; v: number } {
  const W = Math.max(1, Math.round(r.w / cell));
  const D = Math.max(1, Math.round(r.d / cell));
  const blocked = new Uint8Array(W * D);
  for (let i = 0; i < W; i++) {
    const u = -r.w / 2 + (i + 0.5) * cell;
    if (Math.abs(u) > r.w / 2 - 0.25) for (let j = 0; j < D; j++) blocked[i * D + j] = 1;
  }
  for (let j = 0; j < D; j++) {
    const v = -r.d / 2 + (j + 0.5) * cell;
    if (Math.abs(v) > r.d / 2 - 0.25) for (let i = 0; i < W; i++) blocked[i * D + j] = 1;
  }
  for (const it of r.items) {
    if (it.wall) continue; // 挂件在头顶，不占地
    const cu = proj(s, it.x, it.z, 'u');
    const cv = proj(s, it.x, it.z, 'v');
    const hu = extent(s, it.hx, it.hz, 'u') + clearance;
    const hv = extent(s, it.hx, it.hz, 'v') + clearance;
    const i0 = Math.max(0, Math.floor((cu - hu + r.w / 2) / cell));
    const i1 = Math.min(W - 1, Math.floor((cu + hu + r.w / 2) / cell));
    const j0 = Math.max(0, Math.floor((cv - hv + r.d / 2) / cell));
    const j1 = Math.min(D - 1, Math.floor((cv + hv + r.d / 2) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) blocked[i * D + j] = 1;
  }
  // 直方图法：逐列向上累计连续空格，再用单调栈求每行的最大矩形
  const h = new Int32Array(W);
  let best = { u: 0, v: 0 };
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) h[i] = blocked[i * D + j] ? 0 : h[i] + 1;
    const stack: number[] = [];
    for (let i = 0; i <= W; i++) {
      const cur = i === W ? 0 : h[i];
      while (stack.length && h[stack[stack.length - 1]] >= cur) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const ru = (i - left) * cell, rv = h[top] * cell;
        if (ru * rv > best.u * best.v) best = { u: ru, v: rv };
      }
      stack.push(i);
    }
  }
  return best;
}

interface Row { spec: TradeRoomSpec; items: number; rect: { u: number; v: number }; ratio: number }

/** 一次测一批：件数 + 最大空白矩形 / 房间短边 */
function profile(specs: TradeRoomSpec[]): Row[] {
  beginTradeInteriorAudit();
  for (const s of specs) buildTradeInterior(stub, s);
  const recs = endTradeInteriorAudit();
  return recs.map((r, i) => {
    const rect = largestEmptyRect(r, specs[i]);
    return { spec: specs[i], items: r.items.length, rect, ratio: Math.min(rect.u, rect.v) / Math.min(r.w, r.d) };
  });
}

/** 20 间定点抽样：跨两条带等距取，坐标固定，改前改后是同一批店 */
function sampleOf(all: TradeRoomSpec[], n = 20): TradeRoomSpec[] {
  const step = Math.max(1, Math.floor(all.length / n));
  return Array.from({ length: n }, (_, i) => all[i * step]);
}

function fmt(rows: Row[]): string {
  const table = rows.map((x, i) => {
    const s = x.spec;
    return `${String(i + 1).padStart(2)} ${s.trade.padEnd(8)} v${s.variant} ${s.w.toFixed(1)}×${s.d.toFixed(1)}m @(${s.cx.toFixed(0)},${s.cz.toFixed(0)}) 件=${String(x.items).padStart(2)} 空白=${(x.ratio * 100).toFixed(0)}%`;
  });
  const counts = rows.map((x) => x.items);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const worst = Math.max(...rows.map((x) => x.ratio));
  return `${table.join('\n')}\n件数 min=${Math.min(...counts)} 均值=${mean.toFixed(1)} 最大空白比=${(worst * 100).toFixed(0)}%`;
}describe('R16 商铺室内陈设（件数 / 差异 / 空白矩形）', () => {
  it('纯数据：每业态每形态 ≥12 件，同业态形态两两差异 ≥20%', () => {
    const rows = shopInteriorAudit();
    for (const row of rows) {
      expect(Math.min(...row.perVariant), `${row.label} 每形态件数`).toBeGreaterThanOrEqual(12);
      expect(row.minPairwise, `${row.label} 形态差异`).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('20 间抽样：每间 ≥12 件，最大空白矩形小边 < 房间短边 45%', () => {
    const all = [...beltRoomSpecs(), ...riverRoomSpecs()];
    const rows = profile(sampleOf(all, 20));
    // eslint-disable-next-line no-console
    console.log(`\n[室内审计] 共 ${all.length} 间，抽样 20：\n${fmt(rows)}`);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].items, `第 ${i + 1} 间件数`).toBeGreaterThanOrEqual(12);
      expect(rows[i].ratio, `第 ${i + 1} 间空白矩形`).toBeLessThan(0.45);
    }
  });

  it('全量：2894 间的件数与片数总量（面数预算）', () => {
    const all = [...beltRoomSpecs(), ...riverRoomSpecs()];
    beginTradeInteriorAudit();
    for (const s of all) buildTradeInterior(stub, s);
    const recs = endTradeInteriorAudit();
    const items = recs.reduce((a, r) => a + r.items.length, 0);
    const pieces = recs.reduce((a, r) => a + r.pieces, 0);
    const low = recs.filter((r) => r.items.length < 12);
    // eslint-disable-next-line no-console
    console.log(`[室内审计] 全量 ${recs.length} 间：件数 ${items}（均 ${(items / recs.length).toFixed(1)}）片数 ${pieces}（均 ${(pieces / recs.length).toFixed(1)}，≈${Math.round(pieces * 6 / 1000)}k 面）低于 12 件的 ${low.length} 间`);
    if (low.length) {
      // eslint-disable-next-line no-console
      console.log('[室内审计] 低件数样本：' + low.slice(0, 8).map((r) => `${r.trade} ${r.w.toFixed(1)}×${r.d.toFixed(1)} 件=${r.items.length}`).join(' | '));
    }
    expect(low.length).toBe(0);
  });
});
