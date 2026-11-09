import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSolid, buildSolidIndex, solidBlocked, solidFloorY, solidPushOut,
  solidDamage, solidBreachAt, solidsStats, resetSolids,
} from '../src/rt/solids';

// R27 全城实体台账单测：纯 Node 可跑（不依赖 WebGL / DOM）。
// 覆盖 registerSolid → solidBlocked 命中/未命中、solidFloorY 取最高顶面、
// solidPushOut 推出、solidDamage 扣血摘除、solidsStats 分类计数、resetSolids 清零。
// 坐标均取人间 y∈[-60,120]，不触发三界换算（另设一条用例验证换算隔离）。
// 全程零随机：登记/查询/扣血都不得消耗共享 RNG，断言在 beforeEach(resetSolids) 下可重复。

beforeEach(() => resetSolids());

describe('R27 · solids 全城实体台账', () => {
  it('solidBlocked：墙内命中 / 远处与墙顶上方不命中', () => {
    registerSolid('wall', 10, 12, 0, 3, 10, 12);        // 高 3m、跨度 2m → wall（阻挡）
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(true);   // 圆心落进墙内
    expect(solidBlocked(5, 5, 0.34, 0, 1.7)).toBe(false);    // 远处无阻挡
    expect(solidBlocked(11, 11, 0.34, 5, 1.7)).toBe(false);  // 胶囊在墙顶之上（Y 不重叠）
  });

  it('solidFloorY：取每 cell 最高且够得着的顶面，过高返回 null', () => {
    registerSolid('ground', 0, 4, 0, 0.30, 0, 4);
    registerSolid('ground', 0, 4, 0, 0.60, 0, 4);      // 同 cell 更高 → 紧凑 Map 只留 0.60
    expect(solidFloorY(2, 2, 0)).toBe(0.60);            // ≤ fromY+0.95 的最高顶面
    registerSolid('ground', 20, 24, 0, 5.0, 20, 24);   // 另一 cell，顶面 5.0 高过 0.95
    expect(solidFloorY(22, 22, 0)).toBeNull();          // 够不着 → 无
  });

  it('solidPushOut：把嵌墙点推到墙外且只改 x/z', () => {
    registerSolid('wall', 10, 12, 0, 3, 10, 12);
    const pos = { x: 11, y: 0, z: 11 };                // 墙心
    expect(solidBlocked(pos.x, pos.z, 0.34, pos.y, 1.7)).toBe(true);
    const moved = solidPushOut(pos, 0.34, pos.y);
    expect(moved).toBe(true);
    expect(solidBlocked(pos.x, pos.z, 0.34, pos.y, 1.7)).toBe(false); // 推出后不再命中
    expect(pos.y).toBe(0);                              // 契约：不改 y
  });

  it('solidDamage：扣血打碎并从碰撞索引摘除，且只返回一次', () => {
    registerSolid('wall', 10, 12, 0, 3, 10, 12);
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(true);
    const broken = solidDamage(11, 11, 2, 1.5, 1e9);
    expect(broken.length).toBe(1);
    expect(broken[0].kind).toBe('wall');
    expect(broken[0].broken).toBe(true);
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(false); // broken → 查询跳过 = 摘除
    expect(solidDamage(11, 11, 2, 1.5, 1e9).length).toBe(0); // 已碎不重复返回
    expect(solidsStats().broken).toBe(1);
  });

  it('solidsStats：分类计数、total 口径与内存预算', () => {
    registerSolid('wall', 10, 12, 0, 3, 10, 12);        // wall
    registerSolid('ground', 0, 4, 0, 0.3, 0, 4);        // floor
    registerSolid('leaf', 0, 0.5, 1, 2, 0, 0.5);        // plant（不阻挡、可破坏）
    registerSolid('roof', 30, 34, 6, 6.2, 30, 34);      // roof（不阻挡、可破坏）
    registerSolid('glow', 40, 41, 2, 3, 40, 41);        // decor → 丢弃不登记
    buildSolidIndex();
    const s = solidsStats();
    expect(s.walls).toBe(1);
    expect(s.floors).toBe(1);
    expect(s.plants).toBe(1);
    expect(s.total).toBe(4);                           // wall+floor+plant+roof，decor 不计
    expect(s.broken).toBe(0);
    expect(s.cells).toBeGreaterThan(0);
    expect(s.buildMs).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(400000);       // 内存硬预算
  });

  it('resetSolids：全部状态清零、空台账不阻挡', () => {
    registerSolid('wall', 10, 12, 0, 3, 10, 12);
    registerSolid('ground', 0, 4, 0, 0.3, 0, 4);
    buildSolidIndex();
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(true);
    resetSolids();
    const s = solidsStats();
    expect(s.total).toBe(0);
    expect(s.walls).toBe(0);
    expect(s.floors).toBe(0);
    expect(s.broken).toBe(0);
    expect(s.cells).toBe(0);
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(false);
  });

  it('薄墙判据：982m 长宫墙有碰撞面，殿宇主体/午门门墩/长条压顶不误判', () => {
    // 用户截图那堵宫墙：imperial.ts:948 buildPalaceWalls 南墙 W(L≈982,4.4,3.0,z=-2950)。
    // 旧版 `span > 600 → decor` 会把它整堵漏掉；修正后必须登记为 wall 并真挡人。
    registerSolid('wall', 118, 1100, 1.6, 6.0, -2951.5, -2948.5);
    expect(solidBlocked(400, -2950, 0.34, 0, 1.7)).toBe(true);
    expect(solidsStats().walls).toBe(1);

    // 殿宇实心主体 imperial.ts:1142 b.box('wall',mainW=40,7.2,mainD=26) → thin=26 → decor。
    // 若误判成 wall，殿内人群会被 solidPushOut 全部推到殿外。
    registerSolid('wall', -20, 20, 1.18, 8.38, -3280, -3254);
    expect(solidBlocked(0, -3267, 0.34, 0, 1.7)).toBe(false);
    // 午门门墩 imperial.ts:1224 b.box('earth',w,11.2,36) → thin=36 → decor。
    registerSolid('earth', 30, 40, 1.4, 12.6, -2968, -2932);
    expect(solidBlocked(35, -2950, 0.34, 0, 1.7)).toBe(false);
    expect(solidsStats().walls).toBe(1);

    // 长条墙顶压顶 W(L+1.2, 0.62, 3.1)：wide/thin≈316，绝不能登记为 floor，
    // 否则 solidFloorY 会把附近 NPC 抬到 9.6m 高的墙顶上。
    const floorsBefore = solidsStats().floors;
    registerSolid('wall', 118, 1100, 9.0, 9.62, -2951.55, -2948.45);
    expect(solidsStats().floors).toBe(floorsBefore);
  });

  it('破口放行：墙被 solidDamage 打碎后 solidBreachAt 为真、碰撞查询放行', () => {
    registerSolid('wall', 10, 12, 0, 3, 10, 12);
    expect(solidBreachAt(11, 11)).toBe(false);
    solidDamage(11, 11, 2, 1.5, 1e9);
    expect(solidBreachAt(11, 11)).toBe(true);     // 旧 WS_GRID 墙带据此放行
    expect(solidBreachAt(50, 50)).toBe(false);    // 远处不受影响
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(false);
    resetSolids();
    expect(solidBreachAt(11, 11)).toBe(false);    // resetSolids 清空破口表
  });

  it('三界换算：天宫构件(y1>120)经 heavenPoint 后不污染人间碰撞', () => {
    registerSolid('wall', 10, 12, 196, 215, 10, 12);   // 8 角换算到 y≈4066+ 的天宫层
    expect(solidBlocked(11, 11, 0.34, 0, 1.7)).toBe(false); // 人间胶囊碰不到
  });

  it('规模与性能：5 万构件 buildSolidIndex < 500ms、total 口径稳定、查询仍正确', () => {
    // 纯 Node 压测（不依赖 WebGL/DOM）：把格子铺开，模拟满城 wall 台账的构建期规模。
    for (let i = 0; i < 50000; i++) {
      const x = (i % 250) * 4, z = Math.floor(i / 250) * 4;
      registerSolid('wall', x, x + 1, 0, 3, z, z + 1);
    }
    const t0 = performance.now();
    buildSolidIndex();
    const wallMs = performance.now() - t0;
    const s = solidsStats();
    expect(s.total).toBe(50000);
    expect(s.walls).toBe(50000);
    expect(s.total).toBeLessThanOrEqual(400000);       // 内存硬预算
    expect(wallMs).toBeLessThan(500);                  // 构建期索引耗时硬预算
    expect(s.buildMs).toBeLessThan(500);
    expect(solidBlocked(0.5, 0.5, 0.34, 0, 1.7)).toBe(true); // 大规模下查询仍命中
  });
});
