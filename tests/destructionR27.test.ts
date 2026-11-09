import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DestructionSystem, debrisHash, collapseProfile, classifyHit,
  accumulateTotals, boundedDisplacement, clampDeform, MAX_DEFORM,
  type DestructionReport, type DestructionTotals,
} from '../src/game/destruction';

// R27 破坏系统纯函数单测：不创建 WebGL / DOM，全部为确定性整数 hash / 坍缩剖面 /
// 命中组分类 / 报告统计累加 / 位移上限幂等。系统类（需 THREE.Scene）不在此处实例化。

const report = (o: Partial<DestructionReport> = {}): DestructionReport => ({
  ok: true, vertsDeformed: 0, chunks: 0, solidsBroken: 0,
  plantsFelled: 0, actorsHit: 0, meshesTouched: 0, note: '', ...o,
});
const zero = (): DestructionTotals => ({
  events: 0, chunks: 0, vertsDeformed: 0, solidsBroken: 0,
  plantsFelled: 0, actorsHit: 0, meshEdits: 0,
});

describe('R27 · debrisHash 确定性整数 hash', () => {
  it('同 (seed, i) 恒等（多次调用结果完全一致）', () => {
    expect(debrisHash(20260905, 3)).toBe(debrisHash(20260905, 3));
    expect(debrisHash(-17, 99)).toBe(debrisHash(-17, 99));
    expect(debrisHash(0, 0)).toBe(debrisHash(0, 0));
  });

  it('不同 i 充分分散（前 200 个 i 的不同值数量 > 150）', () => {
    const s = new Set<number>();
    for (let i = 0; i < 200; i++) s.add(debrisHash(123456, i));
    expect(s.size).toBeGreaterThan(150);
  });

  it('值域恒为 [0, 1)，负 seed / 大 i 亦成立', () => {
    for (let i = 0; i < 500; i++) {
      const v = debrisHash(i % 2 ? -987654321 : 555, i * 7 + 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('R27 · collapseProfile 坍缩剖面', () => {
  it('(0)===1、(1)===0', () => {
    expect(collapseProfile(0)).toBe(1);
    expect(collapseProfile(1)).toBe(0);
  });

  it('在 [0,1] 上单调不增', () => {
    let prev = collapseProfile(0);
    for (let k = 1; k <= 100; k++) {
      const cur = collapseProfile(k / 100);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it('越界钳位且幂等（t>1 / t<0 / NaN 收敛到边界）', () => {
    expect(collapseProfile(2)).toBe(0);
    expect(collapseProfile(-3)).toBe(1);
    expect(collapseProfile(NaN)).toBe(0);
    expect(collapseProfile(0.25)).toBe(collapseProfile(0.25));
  });
});

describe('R27 · classifyHit 命中组分类', () => {
  it('建筑 8 组 → building（含 _数字 批次号剥离）', () => {
    for (const g of ['city_wall', 'city_ash', 'city_earth', 'city_wood',
      'city_lacquer', 'city_metal', 'city_ceramic', 'city_roof', 'city_roof_2']) {
      expect(classifyHit(g, 0)).toBe('building');
    }
  });

  it('植物组 → plant', () => {
    expect(classifyHit('city_leaf', 0)).toBe('plant');
    expect(classifyHit('city_trunk_3', 0)).toBe('plant');
    expect(classifyHit('city_bush_12', 0)).toBe('plant');
  });

  it('其余小件按高度：低处 decor、高处 building', () => {
    expect(classifyHit('city_lantern', 1)).toBe('decor');
    expect(classifyHit('city_lantern', 5)).toBe('building');
  });
});

describe('R27 · 报告统计累加 accumulateTotals', () => {
  it('两次命中报告逐字段累加，events 按报告数 +1，meshesTouched 映射到 meshEdits', () => {
    let t = zero();
    t = accumulateTotals(t, report({ chunks: 20, vertsDeformed: 300, solidsBroken: 2, plantsFelled: 5, actorsHit: 1, meshesTouched: 3 }));
    expect(t).toEqual({ events: 1, chunks: 20, vertsDeformed: 300, solidsBroken: 2, plantsFelled: 5, actorsHit: 1, meshEdits: 3 });
    t = accumulateTotals(t, report({ chunks: 12, vertsDeformed: 100, solidsBroken: 1, meshesTouched: 1 }));
    expect(t).toEqual({ events: 2, chunks: 32, vertsDeformed: 400, solidsBroken: 3, plantsFelled: 5, actorsHit: 1, meshEdits: 4 });
  });

  it('累加纯函数不修改入参（无副作用）', () => {
    const t = zero();
    const r = report({ chunks: 9 });
    const out = accumulateTotals(t, r);
    expect(t.events).toBe(0);
    expect(r.chunks).toBe(9);
    expect(out.events).toBe(1);
  });
});

describe('R27 · 幂等 / 位移上限（防连续命中把几何无限压扁）', () => {
  it('clampDeform 把任意增量钳到 ±MAX_DEFORM', () => {
    expect(clampDeform(1e9)).toBe(MAX_DEFORM);
    expect(clampDeform(-1e9)).toBe(-MAX_DEFORM);
    expect(clampDeform(2.5)).toBe(2.5);
    expect(clampDeform(NaN)).toBe(0);
    expect(clampDeform(3, 2)).toBe(2);
  });

  it('boundedDisplacement 连续叠加收敛到上限后不再增长（幂等）', () => {
    let d = 0;
    for (let k = 0; k < 200; k++) d = boundedDisplacement(d, 3.7);
    expect(d).toBe(MAX_DEFORM);
    expect(boundedDisplacement(d, 3.7)).toBe(MAX_DEFORM); // 再叠加仍不变
    let n = 0;
    for (let k = 0; k < 200; k++) n = boundedDisplacement(n, -3.7);
    expect(n).toBe(-MAX_DEFORM);
  });

  it('MAX_DEFORM 为正有限常量', () => {
    expect(MAX_DEFORM).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_DEFORM)).toBe(true);
  });
});

// 系统级 smoke：仅构造纯 JS 的 THREE 对象（Scene / BufferGeometry / InstancedMesh），
// 不创建 WebGL 上下文、不碰 DOM，用来验证「真几何变形 + 碎块物理 + 空闲零 draw call + 上限」。
describe('R27 · DestructionSystem 运行时路径 smoke', () => {
  it('命中改顶点 + 产碎块 + 空闲零 draw call + 连续命中位移封顶', () => {
    const scene = new THREE.Scene();
    const arr = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); // 世界坐标三角形，贴近命中点
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const city = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    city.name = 'city_wall';
    scene.add(city);
    const before = Array.from(arr);

    const ds = new DestructionSystem(scene, { ring: () => {} } as never);
    // 空闲时必须 visible=false 且 count=0 → 常驻 0 draw call
    expect(ds.chunkMesh.visible).toBe(false);
    expect(ds.chunkMesh.count).toBe(0);
    expect(ds.stats().drawCallsWhenIdle).toBe(0);

    const hit = { point: new THREE.Vector3(0, 0, 0), power: 200, radius: 5, source: 'test' as const };
    const r = ds.hit(hit);
    expect(r.ok).toBe(true);
    expect(r.chunks).toBeGreaterThan(0);          // 不是「只有粒子」：真碎块
    expect(r.vertsDeformed).toBeGreaterThan(0);   // 真几何变形
    expect(r.meshesTouched).toBeGreaterThanOrEqual(1);
    expect(r.note).toContain('damageSolids 未注入'); // 未注入时如实记 0 并写明
    expect(r.solidsBroken).toBe(0);
    expect(Array.from(arr)).not.toEqual(before);  // city_ 顶点确实被改动

    ds.update(1 / 60);
    expect(ds.chunkMesh.visible).toBe(true);      // 有活碎块才显示（最多 +1 draw call）
    expect(ds.chunkMesh.count).toBeGreaterThan(0);
    expect(ds.stats().aliveChunks).toBeGreaterThan(0);

    // 连续命中基于原始坐标副本叠加且有上限：顶点相对初始值的偏移不超过 MAX_DEFORM
    for (let k = 0; k < 10; k++) ds.hit(hit);
    for (let k = 0; k < arr.length; k++) {
      expect(Math.abs(arr[k] - before[k])).toBeLessThanOrEqual(MAX_DEFORM + 1e-4);
    }
    ds.dispose();
  });
});
