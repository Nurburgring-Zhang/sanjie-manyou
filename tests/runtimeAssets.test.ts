import { describe, it, expect } from 'vitest';
import { RuntimeAssets } from '../src/rt/runtimeAssets';

// P0-9 单测：建筑足迹索引 + 「此处可放」判定（P2-6 落点规则 v1 数据源）。

describe('P0-9 · RuntimeAssets', () => {
  const ra = new RuntimeAssets();
  // 合成全城足迹：一栋建筑（含墙带）占 (10..30, 10..30)，一块台面地板 (40..60, 40..60, y=2)
  ra.ingest(10, 30, 10, 30, 0.6, true, 'ws');
  ra.ingest(40, 60, 40, 60, 2.0, false, 'ws');

  it('ingest 规模与查询：建筑内/外判定正确（跨 cell 矩形）', () => {
    expect(ra.size).toBe(2);
    let n = 0;
    ra.nearby(20, 20, () => n++);                       // 建筑中心：大矩形跨多 cell，去重后应为 1 条
    expect(n).toBe(2);   // 邻域覆盖建筑+台面两条足迹（去重后各一次）
  });

  it('canPlace：不压建筑足迹（圆与矩形相交即 false，含墙带）', () => {
    expect(ra.canPlace(20, 20, { r: 2 }).ok).toBe(false);      // 建筑正中
    expect(ra.canPlace(8, 20, { r: 2 }).ok).toBe(false);       // 贴墙外沿（10-2=8 相切）
    expect(ra.canPlace(5, 20, { r: 2 }).ok).toBe(true);        // 墙外 3m：圆距矩形 3 > 2
    expect(ra.canPlace(50, 50, { r: 2 }).ok).toBe(false);      // 台面地板也算已占用
    expect(ra.canPlace(70, 50, { r: 2 }).ok).toBe(true);       // 空地
  });

  it('canPlace：水面判定（回调注入）——河心 false、岸上 true', () => {
    const inRiver = (x: number, z: number, pad: number) => Math.abs(z) < 30 + pad;
    const verdictRiver = ra.canPlace(0, 0, { r: 2, inRiver });          // (0,0) 空地但河心
    expect(verdictRiver.ok).toBe(false);
    expect(verdictRiver.reason).toBe('in-river');
    const verdictBank = ra.canPlace(5, 45, { r: 2, inRiver });          // 岸上空地
    expect(verdictBank.ok).toBe(true);
  });

  it('canPlace：地面可站立（GroundLayers 回调注入）——墙带内 null → false', () => {
    const groundAt = (x: number, z: number) => {
      if (x > 100 && x < 110 && z > 100 && z < 110) return null;        // 墙带内无面
      return 0;
    };
    expect(ra.canPlace(105, 105, { r: 2, groundAt }).ok).toBe(false);
    expect(ra.canPlace(105, 105, { r: 2, groundAt }).reason).toBe('no-walkable-surface');
    expect(ra.canPlace(5, 5, { r: 2, groundAt }).ok).toBe(true);
  });

  it('裁决顺序：footprint 优先于水面/地面（reason 给第一条失败）', () => {
    const inRiver = () => true;                          // 河也命中
    const groundAt = () => null;                          // 地面也 null
    const v = ra.canPlace(20, 20, { r: 2, inRiver, groundAt });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('overlaps-building-footprint'); // 第一条失败原因优先
  });
});
