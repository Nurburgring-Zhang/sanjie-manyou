import { describe, it, expect, beforeEach } from 'vitest';
import {
  allocate, get, alive, dispose, forEach, entityStats,
  __resetForTest, NONE_ENTITY,
} from '../src/rt/entity';

// P0-1 步 1 单测：spec §5 断言中可纯 Node 验证的部分（A2/A3/A4/A6/A7-node/A8）+ H1 原型 5 断言移植。
// A1（alive 交叉核）/ A5（renderer calls）/ A7-heap 在页面探针 scripts/probe-entity-registry.mjs。

beforeEach(() => __resetForTest());

describe('P0-1 实体表（步 1）', () => {
  it('A2: id 严格递增无重复（1e4 个去重）', () => {
    const ids = new Set<number>();
    let prev = NONE_ENTITY;
    for (let i = 0; i < 10_000; i++) {
      const id = allocate('npc', { pos: { x: 0, y: 0, z: 0 } });
      expect(id).toBeGreaterThan(prev);       // 严格递增
      expect(id).not.toBe(NONE_ENTITY);       // 永不返回保留值
      ids.add(id);
      prev = id;
    }
    expect(ids.size).toBe(10_000);            // 无重复
    expect(entityStats().allocated).toBe(10_000);
  });

  it('A3: dispose 后 get undefined / alive false / forEach 不再返回', () => {
    const id = allocate('npc', { pos: { x: 1, y: 2, z: 3 } });
    expect(alive(id)).toBe(true);
    expect(dispose(id)).toBe(true);
    expect(get(id)).toBeUndefined();
    expect(alive(id)).toBe(false);
    let seen = 0;
    forEach('npc', () => seen++);
    expect(seen).toBe(0);
  });

  it('A4: dispose 幂等——连调 3 次返回 true,false,false', () => {
    const id = allocate('prop', {});
    expect(dispose(id)).toBe(true);
    expect(dispose(id)).toBe(false);
    expect(dispose(id)).toBe(false);
  });

  it('A6: onDispose 逆序执行（3→2→1），重入安全', () => {
    const order: number[] = [];
    let selfId = NONE_ENTITY;
    const id = allocate('creation', {
      onDispose: [
        () => order.push(1),
        () => { order.push(2); dispose(selfId); },   // 重入：alive 已 false，幂等返回
        () => order.push(3),
      ],
    });
    selfId = id;
    dispose(id);
    expect(order).toEqual([3, 2, 1]);
  });

  it('A7(node): 分配 1000 → 全部 dispose → alive === 0', () => {
    const ids: number[] = [];
    for (let i = 0; i < 1000; i++) ids.push(allocate('npc', {}));
    expect(entityStats().alive).toBe(1000);
    for (const id of ids) dispose(id);
    const st = entityStats();
    expect(st.alive).toBe(0);
    expect(st.disposed).toBe(1000);
    expect(st.allocated).toBe(1000);              // allocated 只增（id 永不复用的账面）
  });

  it('A8: 同操作序列两次跑 entityStats 逐值一致（确定性）', () => {
    const run = () => {
      __resetForTest();
      const ids = [
        allocate('npc', { pos: { x: 1, y: 1, z: 1 }, persist: true }),
        allocate('beast', { pos: { x: 2, y: 2, z: 2 } }),
        allocate('creation', { pos: { x: 3, y: 3, z: 3 }, persist: true }),
      ];
      dispose(ids[1], 'test');
      return entityStats();
    };
    const a = run(), b = run();
    expect(a).toEqual(b);
    expect(a.byKind).toEqual({ npc: 1, creation: 1 });
  });

  it('forEach 按 kind 过滤且不含已注销；get(0)/dispose(0) 安全', () => {
    allocate('npc', {});
    allocate('beast', {});
    const npcId = allocate('npc', {});
    dispose(npcId);
    let npc = 0, beast = 0;
    forEach('npc', () => npc++);
    forEach('beast', () => beast++);
    forEach('block', () => { throw new Error('空 kind 不应回调'); });
    expect(npc).toBe(1);   // 2 造 1 销
    expect(beast).toBe(1);
    expect(get(NONE_ENTITY)).toBeUndefined();
    expect(dispose(NONE_ENTITY)).toBe(false);
    expect(allocate('not-a-kind' as never)).toBe(NONE_ENTITY);  // 运行时兜底
  });

  it('persist 标记与组件槽按需挂载（P0-3/P0-4 接口预留）', () => {
    const id = allocate('creation', {
      pos: { x: 0, y: 0, z: 0 },
      persist: true,
      collider: { kind: 'capsule', params: { r: 1.2, h: 6 } },
      provenance: { seed: 20261104, moduleHash: 'sha256:deadbeef', apiVersion: 'creation.spec.v1' },
    });
    const rec = get(id)!;
    expect(rec.persist).toBe(true);
    expect(rec.collider?.kind).toBe('capsule');
    expect(rec.provenance?.seed).toBe(20261104);
    const npc = get(allocate('npc', { pos: { x: 0, y: 0, z: 0 } }))!;   // 缺省 false
    expect(npc.persist).toBe(false);
    expect(npc.collider).toBeUndefined();
  });
});
