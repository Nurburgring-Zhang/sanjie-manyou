import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerSolid, solidsStats, resetSolids, configureSolidsCap,
  setSolidsStage, solidsCapHistogram,
} from '../src/rt/solids';

// FIX-004 R1 / 验收标准：cap 触顶静默丢弃 → 精确计数 + 首次触顶归因 + 一次性告警。
// 全程纯 Node（不依赖 WebGL / DOM）；用 configureSolidsCap 注入小 MAX 灌满，
// 断言 capDropped 精确等于溢出数，capFirstDropAt 非空且等于触顶时的 registered。
// 零随机：坐标固定，beforeEach(resetSolids) 保证用例间零残留。

/** 一条人间合法墙：w=1 h=3 d=1 → classify 判 wall，不触发三界跳过。 */
function wall(i: number): void {
  registerSolid('wall', i * 4, i * 4 + 1, 0, 3, 0, 1);
}
/** 一条人间合法铺面：h=0.3 → classify 判 floor。 */
function floor(i: number): void {
  registerSolid('ground', i * 4, i * 4 + 2, 0, 0.3, 0, 2);
}

beforeEach(() => resetSolids());

describe('FIX-004 · solids cap 触顶遥测', () => {
  it('未触顶时 capDropped=0、capFirstDropAt=null、告警零次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureSolidsCap(20, 16);
    for (let i = 0; i < 5; i++) wall(i);
    const s = solidsStats();
    expect(s.total).toBe(5);
    expect(s.capDropped).toBe(0);
    expect(s.capFirstDropAt).toBeNull();
    expect(s.capFirstDropStage).toBeNull();
    expect(s.maxTotal).toBe(20);
    expect(s.wallReserve).toBe(16);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('灌满小 MAX：capDropped 精确 == 溢出数，capFirstDropAt == maxTotal，阶段名非空', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const MAX = 7, OVER = 5;
    configureSolidsCap(MAX, 6);
    for (let i = 0; i < MAX + OVER; i++) wall(i);
    const s = solidsStats();
    expect(s.total).toBe(MAX);
    expect(s.capDropped).toBe(OVER);           // 精确等于溢出数，不是 ≥
    expect(s.capFirstDropAt).toBe(MAX);        // 首次触顶发生在 registered==MAX
    expect(s.capFirstDropStage).toBe('wall');  // bake 阶段归因非空
    expect(s.wallReserveUsed).toBe(MAX - 6);   // 预留通道实际占用 1
    expect(warn).toHaveBeenCalledTimes(1);     // R2：39 万次也不刷屏
    expect(String(warn.mock.calls[0][0])).toContain('MAX_TOTAL 触顶');
    warn.mockRestore();
  });

  it('WALL_RESERVE 让路单独计数，且主 cap 不受影响', () => {
    configureSolidsCap(20, 3);
    // 先 3 条 wall 吃到预留线，再 4 条 floor 应被让路丢弃
    for (let i = 0; i < 3; i++) wall(i);
    for (let i = 0; i < 4; i++) floor(i + 10);
    const s = solidsStats();
    expect(s.total).toBe(3);
    expect(s.wallReserveDropped).toBe(4);
    expect(s.capDropped).toBe(0);              // 让路不是主 cap 触顶
    expect(s.capFirstDropAt).toBeNull();
    // 预留线之后仍允许 wall 登记，且计入 wallReserveUsed
    for (let i = 3; i < 6; i++) wall(i);
    const s2 = solidsStats();
    expect(s2.total).toBe(6);
    expect(s2.wallReserveUsed).toBe(3);
  });

  it('告警只发一次，但不影响 capDropped 持续精确累计', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureSolidsCap(2, 1);
    for (let i = 0; i < 100; i++) wall(i);
    expect(solidsStats().capDropped).toBe(98);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('configureSolidsCap 非法参数 / 登记后调用一律抛错（fail-closed，不静默）', () => {
    expect(() => configureSolidsCap(0, 0)).toThrow(/非法 MAX_TOTAL/);
    expect(() => configureSolidsCap(5, 5)).toThrow(/非法 WALL_RESERVE/);
    expect(() => configureSolidsCap(5, -1)).toThrow(/非法 WALL_RESERVE/);
    expect(() => configureSolidsCap(1.5, 1)).toThrow(/非法 MAX_TOTAL/);
    wall(0);
    expect(() => configureSolidsCap(10, 8)).toThrow(/必须在登记前调用/);
  });

  it('resetSolids 恢复默认 cap 且清空全部遥测（用例间零残留）', () => {
    configureSolidsCap(3, 2);
    for (let i = 0; i < 6; i++) wall(i);
    expect(solidsStats().capDropped).toBe(3);
    resetSolids();
    const s = solidsStats();
    expect(s.capDropped).toBe(0);
    expect(s.capFirstDropAt).toBeNull();
    expect(s.wallReserveDropped).toBe(0);
    expect(s.maxTotal).toBe(399000);
    expect(s.wallReserve).toBe(320000);
    expect(s.total).toBe(0);
  });

  it('solidsStats 透出全部 FIX-004 R1 字段（window.__qingming.solids 的读取口）', () => {
    const s = solidsStats();
    for (const k of ['capDropped', 'capFirstDropAt', 'capFirstDropStage',
      'wallReserveDropped', 'wallReserveUsed', 'maxTotal', 'wallReserve'] as const) {
      expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(true);
    }
  });

  it('PERF-003 R1：真实阶段名驱动「阶段 × 构件类型」直方图，且字节可复现', () => {
    configureSolidsCap(4, 3);
    setSolidsStage('山河·地形');
    for (let i = 0; i < 3; i++) wall(i);      // registered → 3（未到预留线 3）
    setSolidsStage('城郭·街市');
    for (let i = 3; i < 8; i++) wall(i);      // i=3 登记 → 4，i=4..7 四条触顶
    const h = solidsCapHistogram();
    expect(h.capDropped).toBe(4);
    expect(h.capFirstDropAt).toBe(4);
    expect(h.capFirstDropStage).toBe('城郭·街市');
    expect(h.capFirstDropGroup).toBe('wall');
    expect(h.capFirstDropKind).toBe('wall');
    expect(h.currentStage).toBe('城郭·街市');
    expect(h.byStage).toEqual([{ stage: '城郭·街市', count: 4 }]);
    expect(h.byKind).toEqual([{ kind: 'wall', count: 4 }]);
    expect(h.byStageKind).toEqual([{ stage: '城郭·街市', kind: 'wall', count: 4 }]);
    // 排序 + 无时间戳 → 同样的丢弃序列永远产出同样的 JSON 字节（QA-001 S06 口径）
    expect(JSON.stringify(h)).toBe(JSON.stringify(solidsCapHistogram()));
  });

  it('直方图区分触顶与 WALL_RESERVE 让路；reset 后零残留', () => {
    configureSolidsCap(10, 2);
    setSolidsStage('阶段A');
    wall(0); wall(1);                          // registered → 2，达到预留线
    floor(10); floor(11);                      // 非 wall 让路 2 条
    setSolidsStage('阶段B');
    for (let i = 0; i < 12; i++) wall(i + 20); // 8 条登记到 10，之后 4 条触顶
    const h = solidsCapHistogram();
    expect(h.wallReserveDropped).toBe(2);
    expect(h.wallReserveByStage).toEqual([{ stage: '阶段A', count: 2 }]);
    expect(h.capDropped).toBe(4);
    expect(h.byStage).toEqual([{ stage: '阶段B', count: 4 }]);
    expect(h.byStageKind).toEqual([{ stage: '阶段B', kind: 'wall', count: 4 }]);
    resetSolids();
    const z = solidsCapHistogram();
    expect(z.currentStage).toBe('(unset)');
    expect(z.byStage).toEqual([]);
    expect(z.byKind).toEqual([]);
    expect(z.byStageKind).toEqual([]);
    expect(z.wallReserveByStage).toEqual([]);
    expect(z.capDropped).toBe(0);
    expect(z.wallReserveDropped).toBe(0);
  });

  it('未接线时 currentStage 显式 (unset)，降级归因用 BGroup 而非伪造阶段名', () => {
    configureSolidsCap(2, 1);
    for (let i = 0; i < 5; i++) wall(i);      // 2 条登记，3 条触顶
    const h = solidsCapHistogram();
    expect(h.currentStage).toBe('(unset)');
    expect(h.byStage).toEqual([{ stage: 'wall', count: 3 }]);
    expect(h.byKind).toEqual([{ kind: 'wall', count: 3 }]);
    expect(h.capFirstDropGroup).toBe('wall');
    expect(() => setSolidsStage('')).toThrow(/非空阶段名/);
  });
});
