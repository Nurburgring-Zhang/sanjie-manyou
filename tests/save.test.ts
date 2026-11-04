import { describe, it, expect, beforeEach } from 'vitest';
import {
  SaveSlots, migrate, legacyFromLocalStorage,
  SCHEMA_VERSION, type SaveDataV1, type SaveDataV2,
} from '../src/rt/save';

// P0-4 纯逻辑单测（轮转/回退决策/迁移链）——IndexedDB IO 全链走页面探针
// scripts/probe-save-atomic.mjs（H4 脚本同口径：写读/坏档回退/迁移/原子性）。

const v2 = (over: Partial<SaveDataV2> = {}): SaveDataV2 => ({
  schemaVersion: 2,
  savedAt: 1730700000000,
  economy: { coins: 120, yinde: 4, peach: 2 },
  entities: [],
  ...over,
});

describe('P0-4 · SaveSlots 轮转决策', () => {
  let slots: SaveSlots;
  beforeEach(() => { slots = new SaveSlots(); });

  it('轮转：pickSlot 顺序 v0→v1→v2→v0', () => {
    expect(slots.pickSlot()).toBe('save:v0');
    expect(slots.pickSlot()).toBe('save:v1');
    expect(slots.pickSlot()).toBe('save:v2');
    expect(slots.pickSlot()).toBe('save:v0');
  });

  it('readOrder：lastGood 优先，其余新→旧', () => {
    slots.pickSlot(); slots.pickSlot();                 // 写到 v1
    expect(slots.readOrder('save:v1')).toEqual(['save:v1', 'save:v2', 'save:v0']);
    expect(slots.readOrder(null)).toEqual(['save:v2', 'save:v1', 'save:v0']);
    expect(slots.readOrder('save:v9')).toEqual(['save:v2', 'save:v1', 'save:v0']);  // 非法指针忽略
  });
});

describe('P0-4 · 迁移链', () => {
  it('v1（legacy 三键）→ v2：字段映射完整', () => {
    const v1: SaveDataV1 = { schemaVersion: 1, coins: 120, yinde: 4, peach: 2 };
    const out = migrate(v1);
    expect(out).not.toBeNull();
    expect(out!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out!.economy).toEqual({ coins: 120, yinde: 4, peach: 2 });
    expect(out!.entities).toEqual([]);
  });

  it('v2 原样通过；未知未来版本拒载（返回 null）', () => {
    expect(migrate(v2())).toEqual(v2());
    expect(migrate({ schemaVersion: 99 } as never)).toBeNull();
  });

  it('legacyFromLocalStorage：NaN 才回缺省，0 是合法值（与 interact.loadInt 同口径）', () => {
    const store = {
      getItem: (k: string) => ({ cq_coins: '0', cq_yinde: '7' } as Record<string, string>)[k] ?? null,
    } as Storage;
    const d = legacyFromLocalStorage(store);
    expect(d.coins).toBe(0);                            // P2-1 修复口径：0 不被吞
    expect(d.yinde).toBe(7);
    expect(d.peach).toBe(3);                            // 缺省
  });
});
