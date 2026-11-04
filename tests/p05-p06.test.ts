import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FixedStepLoop } from '../src/rt/loop';
import { LodManager, LOD_TIERS } from '../src/core/engine';

// P0-5/P0-6 单测：removeUpdate 对称（经 FixedStepLoop 同口径语义）/ 固定步确定性 /
// LodManager unregister + setBounds（H7 裁定的单事务刷新）。

describe('P0-5 · FixedStepLoop', () => {
  let loop: FixedStepLoop;
  beforeEach(() => { loop = new FixedStepLoop(); });

  it('add/remove 对称：remove 后不再被调用；返回值 true/false 幂等', () => {
    const a = { fixedUpdate: vi.fn() };
    const b = { fixedUpdate: vi.fn() };
    loop.add(a); loop.add(b);
    expect(loop.remove(a)).toBe(true);
    expect(loop.remove(a)).toBe(false);
    loop.frame(FixedStepLoop.FIXED_DT);
    expect(a.fixedUpdate).not.toHaveBeenCalled();
    expect(b.fixedUpdate).toHaveBeenCalledTimes(1);
  });

  it('固定步：dt 累积按 1/120 步进；每步内执行顺序 = 注册顺序（稳定交错）', () => {
    const order: string[] = [];
    const mk = (n: string) => ({ fixedUpdate: () => order.push(n) });
    loop.add(mk('first')); loop.add(mk('second'));
    loop.frame(FixedStepLoop.FIXED_DT * 3);          // 3 步
    expect(loop.lastFrameSteps).toBe(3);
    // 精确序列：每一步内先 first 后 second，交错 3 轮（顺序稳定性的可判定形式）
    expect(order).toEqual(['first', 'second', 'first', 'second', 'first', 'second']);
  });

  it('确定性：同 dt 序列两次跑，逐步调用计数逐值一致', () => {
    const seq = [1 / 60, 0.05, 0.005, 1 / 30, 0.1, 0.1];   // 含 MAX_SUBSTEPS 截断场景
    const count = () => {
      const l = new FixedStepLoop();
      const u = { fixedUpdate: vi.fn() };
      l.add(u);
      for (const dt of seq) l.frame(dt);
      return { calls: u.fixedUpdate.mock.calls.length, last: l.lastFrameSteps };
    };
    expect(count()).toEqual(count());
    expect(count().calls).toBeGreaterThan(0);
  });

  it('截断：超大 dt 最多 MAX_SUBSTEPS 步，余量钳到一步以内（下一帧消化）', () => {
    const u = { fixedUpdate: vi.fn() };
    loop.add(u);
    loop.frame(10);                                   // 10s >> 16 步
    expect(loop.lastFrameSteps).toBe(FixedStepLoop.MAX_SUBSTEPS);
    const afterClampCalls = u.fixedUpdate.mock.calls.length;
    loop.frame(0);                                    // dt=0：只消化被钳住的 ≤1 步余量（照 physics 原口径，不丢步）
    expect(loop.lastFrameSteps).toBeLessThanOrEqual(1);
    expect(u.fixedUpdate.mock.calls.length - afterClampCalls).toBeLessThanOrEqual(1);
    loop.frame(0);                                    // 余量清空后不再有步
    expect(loop.lastFrameSteps).toBe(0);
  });
});

describe('P0-6 · LodManager unregister / setBounds', () => {
  const mkSpec = (scene: THREE.Scene, id: string, cx = 0, cz = 0) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 4);
    mesh.count = 4;
    // 三档都给真实网格：管理器有「当前档可见 0 → 兜底回最近就绪档」（宁可糊不能空），
    // 空 far 档会把判远的组拉回 near，导致 setBounds 断言失真（测试数据必须贴真实注册形态）
    const mkObj = () => { const o = new THREE.Object3D(); scene.add(o); return o; };
    return {
      id, cx, cy: 0, cz,
      hx: 6, hy: 6, hz: 6,
      tiers: { near: [mesh], mid: [mkObj()], far: [mkObj()], impostor: [] as THREE.Object3D[] },
      card: null,
    };
  };

  it('unregister：摘除后 update 不再判该组；幂等 false', () => {
    const scene = new THREE.Scene();
    const lm = new LodManager(scene);
    lm.register(mkSpec(scene, 'g1'));
    expect(lm.unregister('g1')).toBe(true);
    expect(lm.unregister('g1')).toBe(false);
    lm.update(new THREE.Vector3(0, 0, 0));
    expect(lm.view.groups.find((g) => g.id === 'g1')).toBeUndefined();
  });

  it('setBounds：移动包围盒后，同机位判档随新位置变化（H7 缺口关闭的语义层）', () => {
    const scene = new THREE.Scene();
    const lm = new LodManager(scene);
    lm.register(mkSpec(scene, 'fly', 0, 0));
    const cam = new THREE.Vector3(0, 0, 50);
    lm.update(cam);
    // 立即快照：view.groups 存 snap 对象引用，第二次 update 会原地改写——before 必须取值拷贝
    const beforeTier = LOD_TIERS.indexOf(lm.view.groups.find((g) => g.id === 'fly')!.tier);
    expect(beforeTier).toBe(0);                        // 在原点：盒子边界 44m → near
    // 造物飞走 1km：setBounds 单事务刷新后，同机位应判远
    expect(lm.setBounds('fly', 1000, 0, 0, 6, 6, 6)).toBe(true);
    lm.update(cam);
    const afterTier = LOD_TIERS.indexOf(lm.view.groups.find((g) => g.id === 'fly')!.tier);
    expect(lm.view.groups.find((g) => g.id === 'fly')!.dist).toBeGreaterThan(900);
    expect(afterTier).toBeGreaterThan(beforeTier);     // 档位变远（按 LOD_TIERS 表序比）
    expect(lm.setBounds('nope', 0, 0, 0, 1, 1, 1)).toBe(false);
  });

  it('setBounds 刷新成员剔除体（InstancedMesh.computeBoundingSphere 被调用——H7 实测的剔除陈旧修复点）', () => {
    const scene = new THREE.Scene();
    const lm = new LodManager(scene);
    const spec = mkSpec(scene, 'cull');
    const mesh = spec.tiers.near[0] as THREE.InstancedMesh;
    const spy = vi.spyOn(mesh, 'computeBoundingSphere');
    lm.register(spec);
    lm.setBounds('cull', 10, 0, 10, 6, 6, 6);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
