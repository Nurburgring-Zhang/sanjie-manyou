import { describe, it, expect, beforeEach } from 'vitest';
import { allocate, __resetForTest } from '../src/rt/entity';
import { collectPersistedEntities } from '../src/rt/save';
import { VoxelStore, inArea, VOX, voxelStore } from '../src/rt/voxelStore';


// P1-2 体素数据层单测：柱顶站立语义 / 序列化 roundtrip / 边界 / 营造司基座。

const fresh = (): VoxelStore => {
  const s = new VoxelStore();
  s.fillLayer(0, 2);                                  // 基座：y=0 青石
  return s;
};

describe('P1-2 · VoxelStore', () => {
  beforeEach(() => { voxelStore.deserialize([]); });

  it('基座：y=0 全青石，柱顶 1.0；一格跳跃可达语义（refY=0 → 1.0，refY 无关远处）', () => {
    const s = fresh();
    expect(s.columnTop(VOX.ox + 24, VOX.oz + 24, 0)).toBe(VOX.oy + 1);       // refY=0 站地面 → 顶 1
    expect(s.columnTop(VOX.ox + 24, VOX.oz + 24, 0.9)).toBe(VOX.oy + 1);     // 跳到 0.9 → 仍 1
  });

  it('柱顶：叠两层后 refY=1 可见 2.0；refY=0 不可见 2.0（1.2 步高限制）', () => {
    const s = fresh();
    s.set(24, 1, 24, 3);                                // (24,1,24) 一块城砖
    expect(s.columnTop(VOX.ox + 24, VOX.oz + 24, 1)).toBe(VOX.oy + 2);   // 站在基座上 → 砖顶 2
    expect(s.columnTop(VOX.ox + 24, VOX.oz + 24, 0)).toBe(VOX.oy + 1);   // 地面视角：够不着砖顶 → 基座 1
  });

  it('区外 null；inArea 边界', () => {
    const s = fresh();
    expect(s.columnTop(VOX.ox - 1, VOX.oz, 0)).toBeNull();
    expect(inArea(VOX.ox + VOX.nx, VOX.oz)).toBe(false);
    expect(inArea(VOX.ox + VOX.nx - 0.01, VOX.oz)).toBe(true);
  });

  it('序列化 roundtrip：全量重建逐格一致（含挖洞/堆高）', () => {
    const s = fresh();
    s.set(10, 3, 10, 6); s.set(11, 3, 10, 7);
    s.set(12, 0, 12, 0);                                // 挖掉一块基座（t=0 也进序列化账）
    const flat = s.serialize();
    const s2 = new VoxelStore();
    s2.deserialize(flat);
    for (let y = 0; y < VOX.ny; y++)
      for (let z = 0; z < VOX.nz; z++)
        for (let x = 0; x < VOX.nx; x++)
          expect(s2.get(x, y, z)).toBe(s.get(x, y, z));
    expect(s2.nonEmpty).toBe(s.nonEmpty);
  });

  it('全局单例与局部实例隔离（单测不污染 player 查询）', () => {
    voxelStore.deserialize([]);
    expect(voxelStore.nonEmpty).toBe(0);                // 测试清过全局
    const local = fresh();
    expect(local.nonEmpty).toBe(VOX.nx * VOX.nz);
    expect(voxelStore.nonEmpty).toBe(0);
  });
});

describe('P0-4 × P1-2 · 存档 entities 读表', () => {
  beforeEach(() => __resetForTest());
  it('collectPersistedEntities：persist 实体入档（allocate 顺序=A8 口径）', () => {
    const a = allocate('npc', { pos: { x: 1, y: 0, z: 1 }, persist: true });
    const b = allocate('beast', { pos: { x: 2, y: 0, z: 2 }, persist: true });
    const c = allocate('prop', { pos: { x: 3, y: 0, z: 3 } });           // persist 缺省 false → 不入档
    const arr = collectPersistedEntities();
    expect(arr.map((e) => e.eid)).toEqual([a, b]);
    expect(arr[0]).toMatchObject({ eid: a, kind: 'npc', x: 1, z: 1 });
    void c;
  });
});

import { allocate } from '../src/rt/entity';

