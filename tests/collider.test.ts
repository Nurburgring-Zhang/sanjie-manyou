import { describe, it, expect, beforeEach } from 'vitest';
import { allocate, dispose, get, __resetForTest } from '../src/rt/entity';
import { ColliderRegistry, ColliderGrid } from '../src/rt/collider';

// P0-3 单测：网格候选一致性（vs 朴素扫）/ 换格幽灵对账 / remove 即消失 /
// 「生成物 collider 挡住玩家」语义（清单 v3 P0-3 验收原文）。确定性 mulberry32。

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => __resetForTest());

describe('P0-3 · ColliderGrid', () => {
  it('候选一致性：网格 pointQuery vs 朴素扫逐 id 一致（500 实体 × 50 查询点）', () => {
    const rng = mulberry32(20261105);
    const grid = new ColliderGrid();
    const px: number[] = [], pz: number[] = [];
    for (let i = 0; i < 500; i++) {
      const x = (rng() - 0.5) * 400, z = (rng() - 0.5) * 400;
      px.push(x); pz.push(z);
      grid.insert(i + 1, { x, y: 0, z });
    }
    let mismatches = 0;
    for (let q = 0; q < 50; q++) {
      const qx = (rng() - 0.5) * 420, qz = (rng() - 0.5) * 420, r = 4 + rng() * 20;
      const viaGrid = new Set<number>();
      grid.pointQuery(qx, qz, r, (id) => viaGrid.add(id));
      const viaNaive = new Set<number>();
      for (let i = 0; i < 500; i++) {
        const dx = px[i] - qx, dz = pz[i] - qz, rr = r + 0.001;
        if (dx * dx + dz * dz <= rr * rr * 4) viaNaive.add(i + 1);   // 桶级粗筛上界（半径+cell 对角）
      }
      // 网格结果必须 ⊆ 朴素上界，且朴素上界里的「真近邻」必须都在网格结果里
      for (const id of viaGrid) {
        const i = id - 1;
        const dx = px[i] - qx, dz = pz[i] - qz;
        if (dx * dx + dz * dz > (r + 16) * (r + 16)) mismatches++;   // 超出合理邻域 = 幽灵候选（cell 对角 √2×8≈11.3，r+16 安全余量）
      }
      for (const id of viaNaive) {
        const i = id - 1;
        const dx = px[i] - qx, dz = pz[i] - qz;
        if (dx * dx + dz * dz <= r * r && !viaGrid.has(id)) mismatches++;  // 半径内漏报 = 真负
      }
    }
    expect(mismatches).toBe(0);
  });

  it('换格幽灵对账：移动 100 帧（含跨多格快移）后 reconcile 幽灵 === 0', () => {
    const rng = mulberry32(20261105);
    const grid = new ColliderGrid();
    const ids: number[] = [];
    const posList: { x: number; y: number; z: number }[] = [];   // 引用语义（真实用法：Vector3 引用改值后 update 换格）
    const vx: number[] = [], vz: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = (rng() - 0.5) * 200, z = (rng() - 0.5) * 200;
      const pos = { x, y: 0, z };
      posList.push(pos);
      vx.push((rng() - 0.5) * 8); vz.push((rng() - 0.5) * 8);     // 最快 8m/帧 → 跨格
      ids.push(i + 101);
      grid.insert(i + 101, pos);
    }
    let totalGhosts = 0;
    for (let f = 0; f < 100; f++) {
      for (let i = 0; i < ids.length; i++) {
        posList[i].x += vx[i]; posList[i].z += vz[i];             // 改引用值（不换对象）
        grid.update(ids[i]);                                      // 每帧换格驱动
      }
      if ((f + 1) % 100 === 0) totalGhosts += grid.reconcile().length;
    }
    expect(totalGhosts).toBe(0);
    // 尾验：所有 id 仍可查询到自己（无丢桶、无幽灵）
    let selfSeen = 0;
    for (let i = 0; i < ids.length; i++) {
      grid.pointQuery(posList[i].x, posList[i].z, 0.5, (id) => { if (id === ids[i]) selfSeen++; });
    }
    expect(selfSeen).toBe(ids.length);
  });

  it('remove 后候选即消失、桶空即回收', () => {
    const grid = new ColliderGrid();
    grid.insert(1, { x: 10, y: 0, z: 10 });
    grid.insert(2, { x: 12, y: 0, z: 10 });
    grid.remove(1);
    let seen1 = false, seen2 = false;
    grid.pointQuery(10, 10, 4, (id) => { if (id === 1) seen1 = true; if (id === 2) seen2 = true; });
    expect(seen1).toBe(false);
    expect(seen2).toBe(true);
    expect(grid.size).toBe(1);
    grid.remove(2);
    expect(grid.size).toBe(0);
  });
});

describe('P0-3 · ColliderRegistry（实体表挂接 + 挡住玩家）', () => {
  it('attachEntity 闭环：挂上→挡住；dispose→onDispose 摘除→不再挡', () => {
    const reg = new ColliderRegistry();
    const eid = allocate('creation', { pos: { x: 30, y: 0, z: 30 }, persist: true });
    expect(reg.attachEntity(eid, { kind: 'box', params: { hx: 3, hz: 3 } }, get(eid)!.pos)).toBe(true);
    // 玩家圆在盒边 3m 处：r=1 撞上（盒半尺 3 + 玩家 1 = 4 > 3 距离）✓ 挡住
    expect(reg.blocked(30, 27.5, 1)).toBe(true);
    // 玩家在 6m 外：不挡
    expect(reg.blocked(30, 38, 1)).toBe(false);
    // dispose 实体 → onDispose 自动摘除 collider
    dispose(eid, 'test');
    expect(reg.blocked(30, 27.5, 1)).toBe(false);
    expect(reg.count).toBe(0);
  });

  it('「生成物挡住玩家」端到端：造物带 box 声明，玩家走进即 blocked、绕开即通行', () => {
    const reg = new ColliderRegistry();
    const eid = allocate('creation', { pos: { x: 0, y: 0, z: 0 }, persist: true });
    reg.attachEntity(eid, { kind: 'sphere', params: { r: 2 } }, get(eid)!.pos);
    // 玩家沿 z 轴从 10 向 -10 走，步长 0.5，半径 1：在 |z| < 3 处必须被挡
    let blockedAt = Infinity;
    for (let z = 10; z >= -10; z -= 0.5) {
      if (reg.blocked(0, z, 1)) { blockedAt = Math.abs(z); break; }
    }
    expect(blockedAt).toBeLessThanOrEqual(3.01);      // 球 r2 + 玩家 r1 = 3
    expect(blockedAt).toBeGreaterThanOrEqual(2.5);
  });

  it('updateAll：位置引用移动后网格跟随（Vector3 引用同步语义）', () => {
    const reg = new ColliderRegistry();
    const pos = { x: 0, y: 0, z: 0 };                 // 模拟 Vector3 引用
    const eid = allocate('npc', { pos, persist: true });
    reg.attachEntity(eid, { kind: 'sphere', params: { r: 1 } }, pos);
    pos.x = 100; pos.z = 100;                         // 引用移动（原对象改值）
    reg.updateAll();
    expect(reg.blocked(100, 100, 1.5)).toBe(true);    // 新位置可查到
    expect(reg.blocked(0, 0, 1)).toBe(false);         // 旧位置已无候选
  });
});
