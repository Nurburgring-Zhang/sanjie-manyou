import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_REALM, realmOfTask, summarizeByRealm } from '../src/game/bakePlan';
import { Baker, setBakeLowMode, isBakeLowMode, lowDecorStats } from '../src/city/bake';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => setBakeLowMode(false));

describe('PERF-001 R1 · 逐任务界域归属表与真实 tasks 双向一致', () => {
  it('world.ts 的每一行 tasks 条目都在 TASK_REALM 里有归属', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'world.ts'), 'utf8');
    // 与 world.ts 里 `const tasks: [string, () => ...][]` 的缩进 / 字面量写法严格对齐
    const names = [...src.matchAll(/^      \['([^']+)',/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(30);
    const missing = names.filter((n) => !TASK_REALM[n]);
    expect(missing).toEqual([]);
  });

  it('TASK_REALM 无陈旧条目：每个 key 都能在 world.ts 的 tasks 里找到', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'world.ts'), 'utf8');
    const stale = Object.keys(TASK_REALM).filter((k) => !src.includes(`['${k}',`));
    expect(stale).toEqual([]);
  });

  it('未知任务降级为 shared（宁可少算可省量，不虚报）', () => {
    expect(realmOfTask('某个尚未登记的新任务')).toBe('shared');
    expect(realmOfTask('山河·地形')).toBe('human');
    expect(realmOfTask('幽冥开辟')).toBe('underworld');
    expect(realmOfTask('云起天宫')).toBe('heaven');
  });

  it('summarizeByRealm 四域求和恒等于输入总和', () => {
    const rows = [
      { stage: 'a', realm: 'human' as const, vertices: 100, triangles: 30, bytes: 1000 },
      { stage: 'b', realm: 'heaven' as const, vertices: 20, triangles: 6, bytes: 200 },
      { stage: 'c', realm: 'underworld' as const, vertices: 5, triangles: 1, bytes: 50 },
      { stage: 'd', realm: 'shared' as const, vertices: 1, triangles: 0, bytes: 10 },
    ];
    const s = summarizeByRealm(rows);
    expect(s.human.tasks).toBe(1);
    expect(s.heaven.vertices).toBe(20);
    expect(Object.values(s).reduce((a, c) => a + c.vertices, 0)).toBe(126);
    expect(Object.values(s).reduce((a, c) => a + c.bytes, 0)).toBe(1260);
  });
});

describe('PERF-001 R6 · Baker 装饰降档确定性（不碰结构件）', () => {
  const COORDS = Array.from({ length: 24 }, (_, i) => [i * 1.37, 2.4 + (i % 3) * 0.3, -8 + i * 0.61] as const);
  const leafPositions = (b: Baker): number[] => {
    setBakeLowMode(false);
    const out: number[] = [];
    for (const [x, y, z] of COORDS) b.box('leaf', 0.4, 0.5, 0.4, x, y, z, 0x3f6a3c);
    out.push(...b.positionsOf('leaf'));
    return out;
  };

  it('标准档 24 个 leaf 盒全量落盘（每盒 36 顶点 × 3 分量）', () => {
    expect(isBakeLowMode()).toBe(false);
    const b = new Baker();
    const p = leafPositions(b);
    expect(p.length).toBe(24 * 36 * 3);
    expect(lowDecorStats().dropped).toBe(0);
  });

  it('低配档按确定性哈希保留一部分，两次构建逐位相同', () => {
    const run = (): number[] => {
      setBakeLowMode(true);
      const b = new Baker();
      const out: number[] = [];
      for (const [x, y, z] of COORDS) b.box('leaf', 0.4, 0.5, 0.4, x, y, z, 0x3f6a3c);
      out.push(...b.positionsOf('leaf'));
      return out;
    };
    const a = run();
    const droppedA = lowDecorStats().dropped;
    const c = run();
    expect(a.length).toBeLessThan(24 * 36 * 3);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(c);                      // INV-01：确定性
    expect(droppedA).toBe(lowDecorStats().dropped);
  });

  it('结构件 wall / roof / ground 在低配档一个顶点不少', () => {
    const normal = new Baker();
    const low = new Baker();
    const emit = (b: Baker): void => {
      for (const [x, y, z] of COORDS) {
        b.box('wall', 1, 3, 1, x, y, z, 0xe8e0cc);
        b.box('roof', 2, 0.4, 2, x, y + 3, z, 0x3b4045);
        b.box('ground', 3, 0.2, 3, x, 0, z, 0xc0a274);
      }
    };
    emit(normal);
    setBakeLowMode(true);
    emit(low);
    for (const g of ['wall', 'roof', 'ground'] as const) {
      expect(low.positionsOf(g)).toEqual(normal.positionsOf(g));
    }
  });
});
