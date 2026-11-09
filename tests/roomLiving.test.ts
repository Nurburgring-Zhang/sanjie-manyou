import { describe, it, expect } from 'vitest';
import type { Baker } from '../src/city/bake';
import {
  beginLivingAudit, endLivingAudit, buildRoomLiving, roomTierFor,
  livingAssetCatalog, pickLivingAssets, TIER_ASSETS, ROOM_TIERS, LIVING_CATEGORIES,
  FRAME_MIN, type RoomTier,
} from '../src/city/roomLiving';
import { beginTradeInteriorAudit, endTradeInteriorAudit, buildTradeInterior, buildStreetInteriors, STREET_HOUSE_SLOTS } from '../src/city/interiors';
import { beltRoomSpecs } from '../src/city/centralbelt';
import { riverRoomSpecs } from '../src/city/riverbank';

/**
 * R17 判据（用户原话）：「构建一批资产，分高中低档，各档物品随机组合，
 * 放置到对应档次的房间中。所有房间中都要有资产。」
 * R18 追加：密度扩容——资产库 90→180 件，每档每间 高16 / 中13 / 低10 件。
 * R19 追加：立体骨架件结构性修复——资产库 198 件（每档 66 / 六类各 11），
 *   每间高 8 / 中 6 / 低 5 件「看得见」的成件器物，用 recording Baker 数真实盒调用验证。
 *
 * 台账（stub）判件数，recording Baker 判「立体成件数」：两层都验，不再只信台账。
 */
const noop = (): void => {};
/** 几何调用全吞：任何 Baker 方法都返回空操作，测试只关心落位台账 */
const stub = new Proxy({}, { get: () => noop }) as unknown as Baker;

type GeomCall = { op: string; args: unknown[] };
/** R19 recording Baker：捕获 buildRoomLiving 真正发出的 box / cyl 调用参数（尺寸 / 坐标 / 颜色） */
function recordingBaker(): { b: Baker; calls: GeomCall[] } {
  const calls: GeomCall[] = [];
  const b = new Proxy({}, {
    get: (_t, k: string) => (k === 'box' || k === 'cyl')
      ? (...args: unknown[]) => { calls.push({ op: k, args }); }
      : noop,
  }) as unknown as Baker;
  return { b, calls };
}
/** 立体成件判据（与 artifacts/r20-geomprobe.json 探针一致）：h>0.25m 且 min(w,d)>0.2m */
function solidCount(calls: GeomCall[]): number {
  return calls.filter((c) => c.op === 'box'
    && Number(c.args[2]) > 0.25
    && Math.min(Number(c.args[1]), Number(c.args[3])) > 0.2).length;
}

const allSpecs = (): ReturnType<typeof beltRoomSpecs> => [...beltRoomSpecs(), ...riverRoomSpecs()];

describe('R17 / R18 / R19 三档起居资产库', () => {
  it('三档 × 六类：R19 后每类 ≥11 件、每档 ≥66 件，档间器物不重名', () => {
    const cat = livingAssetCatalog();
    expect(cat.length).toBe(3);
    const allKeys = new Set<string>();
    for (const row of cat) {
      expect(row.total, `${row.label} 资产总数`).toBeGreaterThanOrEqual(66);
      for (const c of LIVING_CATEGORIES) {
        expect(row.byCategory[c].length, `${row.label}/${c}`).toBeGreaterThanOrEqual(11);
        expect(new Set(row.byCategory[c]).size, `${row.label}/${c} 名称不重复`).toBe(row.byCategory[c].length);
      }
      for (const c of LIVING_CATEGORIES) {
        for (const a of TIER_ASSETS[row.tier][c]) {
          expect(allKeys.has(a.key), `跨档重复 key: ${a.key}`).toBe(false);
          allKeys.add(a.key);
        }
      }
    }
    expect(allKeys.size, '全库资产件数').toBeGreaterThanOrEqual(198);
  });

  it('R18 六类资产均非空：家具 / 物品 / 生活 / 洗漱 / 起居 / 装饰，三档无缺类', () => {
    const cat = livingAssetCatalog();
    for (const row of cat) {
      for (const c of LIVING_CATEGORIES) {
        expect(TIER_ASSETS[row.tier][c].length, `${row.label}/${c} 非空`).toBeGreaterThan(0);
        expect(row.byCategory[c].length, `${row.label}/${c} 目录非空`).toBeGreaterThan(0);
      }
    }
  });

  it('档次推导：三档都有房间，且与面阔/业态确有关联', () => {
    const specs = allSpecs();
    const tiers = specs.map((s) => roomTierFor(s));
    const counts: Record<RoomTier, number> = { high: 0, mid: 0, low: 0 };
    for (const t of tiers) counts[t]++;
    for (const t of ROOM_TIERS) expect(counts[t], `${t} 档房间数`).toBeGreaterThan(specs.length * 0.05);
    // 同一坐标 + 同一参数 → 同一档次（确定性，不依赖调用顺序）
    const s = specs[0];
    expect(roomTierFor(s)).toBe(roomTierFor(s));
    // 大面阔 + 钱铺 vs 窄面阔 + 面馆：分值必须拉开
    const rich = roomTierFor({ cx: s.cx, cz: s.cz, w: 16, d: 14, variant: 0, trade: 'bank' });
    const poor = roomTierFor({ cx: s.cx, cz: s.cz, w: 7, d: 5, variant: 0, trade: 'noodle', compact: true });
    expect(rich).not.toBe(poor);
  });

  it('组合随机但确定：每档六类齐全，高档件数 > 低档，不同房间组合不重样', () => {
    for (const tier of ROOM_TIERS) {
      const set = pickLivingAssets(tier, 123.5, -67.25, 1);
      const cats = new Set(set.map((a) => a.cat));
      expect(cats.size, `${tier} 六类覆盖`).toBe(LIVING_CATEGORIES.length);
      expect(new Set(set.map((a) => a.key)).size, `${tier} 不落重复器物`).toBe(set.length);
      const again = pickLivingAssets(tier, 123.5, -67.25, 1);
      expect(again.map((a) => a.key).join('|')).toBe(set.map((a) => a.key).join('|'));
    }
    expect(pickLivingAssets('high', 10, 10, 0).length).toBeGreaterThan(pickLivingAssets('low', 10, 10, 0).length);
    const combos = new Set<string>();
    for (let i = 0; i < 40; i++) combos.add(pickLivingAssets('mid', i * 37.1, -i * 19.3, i % 3).map((a) => a.key).join('|'));
    expect(combos.size, '中档不同房间组合数').toBeGreaterThan(10);
  });

  it('全量 2894 间铺面 + 9 座街屋：每间都有起居资产，且六类全覆盖', () => {
    const specs = allSpecs();
    beginLivingAudit();
    beginTradeInteriorAudit();
    for (const s of specs) buildTradeInterior(stub, s);
    // 9 座手工街屋走同一套资产表；这里只跑起居层，避开 SignMesher 的贴图依赖
    for (let i = 0; i < STREET_HOUSE_SLOTS.length; i++) {
      const h = STREET_HOUSE_SLOTS[i];
      if (!(h.w >= 7.4 && h.d >= 4.6)) continue;
      buildRoomLiving(stub, {
        cx: h.x, cz: h.z, w: h.w - 0.6, d: h.d - 0.6,
        y0: h.y0 ?? 0.6, h: h.h ?? 3.2,
        ux: 1, uz: 0, vx: 0, vz: 1,
        variant: i, trade: h.trade, compact: false,
      });
    }
    const tradeRecs = endTradeInteriorAudit();
    const recs = endLivingAudit();

    expect(recs.length).toBe(tradeRecs.length + STREET_HOUSE_SLOTS.length);
    const empty = recs.filter((r) => r.count === 0);
    const missingCat = recs.filter((r) => r.categories.length !== LIVING_CATEGORIES.length);
    const underTen = recs.filter((r) => r.count < 10);
    const byTier: Record<RoomTier, number> = { high: 0, mid: 0, low: 0 };
    let items = 0, pieces = 0;
    for (const r of recs) { byTier[r.tier]++; items += r.count; pieces += r.pieces; }
    // eslint-disable-next-line no-console
    console.log(`[起居审计] ${recs.length} 间：${items} 件 / ${pieces} 片（≈${Math.round(pieces * 6 / 1000)}k 面），档分布 高${byTier.high}/中${byTier.mid}/低${byTier.low}`);
    expect(empty.length, '空房数').toBe(0);
    expect(missingCat.length, '六类未覆盖的房间数').toBe(0);
    expect(underTen.length, '少于 10 件的房间数').toBe(0);
    for (const t of ROOM_TIERS) expect(byTier[t], `${t} 档房间数`).toBeGreaterThan(0);
    // 铺面里 R16 的营生器物一件没少，起居件是叠加而不是替换
    expect(tradeRecs.every((r) => r.items.length >= 12)).toBe(true);
  });

  it('R18 三档平均件数：低 ≥10 / 中 ≥13 / 高 ≥16（防台账虚高）', () => {
    const specs = allSpecs();
    beginLivingAudit();
    beginTradeInteriorAudit();
    for (const s of specs) buildTradeInterior(stub, s);
    for (let i = 0; i < STREET_HOUSE_SLOTS.length; i++) {
      const h = STREET_HOUSE_SLOTS[i];
      if (!(h.w >= 7.4 && h.d >= 4.6)) continue;
      buildRoomLiving(stub, {
        cx: h.x, cz: h.z, w: h.w - 0.6, d: h.d - 0.6,
        y0: h.y0 ?? 0.6, h: h.h ?? 3.2,
        ux: 1, uz: 0, vx: 0, vz: 1,
        variant: i, trade: h.trade, compact: false,
      });
    }
    endTradeInteriorAudit();
    const recs = endLivingAudit();
    const byTier: Record<RoomTier, number[]> = { high: [], mid: [], low: [] };
    for (const r of recs) byTier[r.tier].push(r.count);
    const avg = (t: RoomTier): number => byTier[t].reduce((a, b) => a + b, 0) / byTier[t].length;
    for (const t of ROOM_TIERS) expect(byTier[t].length, `${t} 档样本数`).toBeGreaterThan(0);
    expect(avg('low'), '低档平均件数').toBeGreaterThanOrEqual(10);
    expect(avg('mid'), '中档平均件数').toBeGreaterThanOrEqual(13);
    expect(avg('high'), '高档平均件数').toBeGreaterThanOrEqual(16);
  });

  /**
   * R19 一等判据：不用 stub 台账，改用 recording Baker 数真实的立体成件数（solids）。
   * 每档 9 间（含 artifacts/r20-geomprobe.json 的 3 间揭顶剖视证据房）：
   * 每间 solids ≥ FRAME_MIN（高8/中6/低5）、六类全覆盖、组合不重样。
   */
  it('R19 recording Baker 立体骨架件：每间 solids ≥ 高8/中6/低5，六类全覆盖，组合多样（非 stub 台账）', () => {
    type R = { cx: number; cz: number; w: number; d: number; variant: number };
    const rooms: Record<RoomTier, R[]> = { high: [], mid: [], low: [] };
    // 对齐 team-lead 揭顶剖视的 3 间证据房（artifacts/r20-geomprobe.json）
    rooms.high.push({ cx: 168, cz: 64, w: 9, d: 8, variant: 0 });
    rooms.mid.push({ cx: 258, cz: 64, w: 10, d: 8, variant: 1 });
    rooms.low.push({ cx: 352, cz: 66, w: 12, d: 9, variant: 2 });
    for (let i = 0; i < 8; i++) {
      rooms.high.push({ cx: 100 + i * 41.3, cz: 60 - i * 17.7, w: 9, d: 8, variant: i });
      rooms.mid.push({ cx: 260 + i * 37.1, cz: -20 + i * 23.9, w: 10, d: 8, variant: i });
      rooms.low.push({ cx: -140 - i * 29.7, cz: 90 + i * 31.3, w: 12, d: 9, variant: i });
    }
    const combos: Record<RoomTier, Set<string>> = { high: new Set(), mid: new Set(), low: new Set() };
    const solidsByTier: Record<RoomTier, number[]> = { high: [], mid: [], low: [] };
    for (const tier of ROOM_TIERS) {
      for (const r of rooms[tier]) {
        beginLivingAudit();
        const { b, calls } = recordingBaker();
        const res = buildRoomLiving(b, {
          cx: r.cx, cz: r.cz, w: r.w, d: r.d, y0: 0.6, h: 3.4,
          ux: 1, uz: 0, vx: 0, vz: 1, variant: r.variant, tier,
        });
        const audit = endLivingAudit();
        const solids = solidCount(calls);
        solidsByTier[tier].push(solids);
        expect(solids, `${tier} (${r.cx.toFixed(1)},${r.cz.toFixed(1)}) 立体成件 solids`).toBeGreaterThanOrEqual(FRAME_MIN[tier]);
        expect(audit[0].categories.length, '六类全覆盖').toBe(LIVING_CATEGORIES.length);
        expect(res.count, '总件数不低于 10').toBeGreaterThanOrEqual(10);
        combos[tier].add(audit[0].items.map((x) => x.key).join('|'));
      }
      expect(combos[tier].size, `${tier} 9 间组合多样性`).toBeGreaterThan(3);
    }
    const avg = (t: RoomTier): number => solidsByTier[t].reduce((a, b) => a + b, 0) / solidsByTier[t].length;
    const min = (t: RoomTier): number => Math.min(...solidsByTier[t]);
    // eslint-disable-next-line no-console
    console.log(`[R19 骨架 solids] 高 avg=${avg('high').toFixed(1)} min=${min('high')} / 中 avg=${avg('mid').toFixed(1)} min=${min('mid')} / 低 avg=${avg('low').toFixed(1)} min=${min('low')}`);
    // eslint-disable-next-line no-console
    console.log(`[R19 证据房 solids] 趙太丞家(high)=${solidsByTier.high[0]}（基线 3）/ 解庫(mid)=${solidsByTier.mid[0]}（基线 2）/ 王家紙馬(low)=${solidsByTier.low[0]}（基线 0）`);
    // 高档骨架件下限明显高于低档（画面档次差异）
    expect(FRAME_MIN.high).toBeGreaterThan(FRAME_MIN.mid);
    expect(FRAME_MIN.mid).toBeGreaterThan(FRAME_MIN.low);
    expect(avg('high'), '高档平均立体成件数 > 低档').toBeGreaterThan(avg('low'));
  });

  it('buildStreetInteriors 真实调用链也能落起居资产', () => {
    beginLivingAudit();
    const built = buildStreetInteriors(stub, stub as never, stub as never);
    const recs = endLivingAudit();
    expect(built).toBeGreaterThan(0);
    expect(recs.length).toBe(built);
    expect(recs.every((r) => r.count >= 10 && r.categories.length === 6)).toBe(true);
  });
});
