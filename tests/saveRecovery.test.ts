// SAV-003 单测：digest 不符拒读 / 隔离不删 / 向导数据 / 串行化 / IDB 不可用降级告知
// 用自写内存 backend（createMemoryBackend）+ 纯函数，不引入新 npm 依赖、不依赖真 IDB。
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  packSlot, verifySlot, computeDigest, parseSlotRaw, HEAD_SIZE,
  createSerialLock, type LockLike, type SaveHealth,
} from '../src/rt/save';
import {
  classifyRaw, buildRecoveryWizard, downgradeNotice, truncateErrorRecord,
  createMemoryBackend, getRecoveryWizard,
  recordLastSaveError, readLastSaveError, LAST_SAVE_ERROR_KEY,
  DEGRADED_TEXT, EXIT_EXPORT_HINT,
} from '../src/game/saveRecovery';

const SNAP = {
  schemaVersion: 2, savedAt: 1000,
  economy: { coins: 120, yinde: 4, peach: 2 }, entities: [],
};
const raw = (): string => packSlot(JSON.stringify(SNAP), { schemaVersion: 2, at: 1000, reason: 'manual' });

afterEach(() => { vi.unstubAllGlobals(); });

describe('SAV-003 R1 · digest 写前算 / 写后回读校验 / 不符拒读', () => {
  it('computeDigest 确定性、内容变则摘要变', () => {
    expect(computeDigest('abc')).toBe(computeDigest('abc'));
    expect(computeDigest('abc')).not.toBe(computeDigest('abd'));
    expect(computeDigest('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('packSlot 是 4KB 定长头 + body，合法档 verifySlot 通过', () => {
    const r = raw();
    expect(r.length).toBeGreaterThan(HEAD_SIZE);
    expect(r.slice(0, HEAD_SIZE)).toContain('"magic":"CQSAVE2"');
    const v = verifySlot(r);
    expect(v.ok).toBe(true);
    expect(v.payload).toBe(JSON.stringify(SNAP));
    expect(v.header?.len).toBe(JSON.stringify(SNAP).length);
    expect(v.header?.digest).toBe(computeDigest(JSON.stringify(SNAP)));
  });

  it('篡改 body 但长度不变 → digest 不符拒读（classifyRaw / parseSlotRaw / backend.read）', async () => {
    const r = raw();
    const body = r.slice(HEAD_SIZE);
    const bad = r.slice(0, HEAD_SIZE) + (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    expect(verifySlot(bad).reason).toBe('digest');
    expect(classifyRaw(bad).ok).toBe(false);
    expect(classifyRaw(bad).reason).toBe('digest');
    expect(parseSlotRaw(bad).data).toBeNull();
    expect(parseSlotRaw(bad).reason).toBe('digest');

    const b = createMemoryBackend();
    b._slots.set('save:m1', bad);
    const read = await b.read('save:m1');
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('digest');
  });

  it('截断 body → 长度不符拒读；空槽 → absent', () => {
    const r = raw();
    const short = r.slice(0, HEAD_SIZE) + r.slice(HEAD_SIZE, r.length - 5);
    expect(verifySlot(short).reason).toBe('length');
    expect(classifyRaw(short).ok).toBe(false);
    expect(verifySlot(null).reason).toBe('absent');
    expect(classifyRaw(null).reason).toBe('absent');
  });

  it('写后回读校验：篡改落盘内容后 health 标 bad 并跳过', async () => {
    const b = createMemoryBackend();
    await b.write('save:m1', SNAP, 'manual');
    const before = b._slots.get('save:m1')!;
    const body = before.slice(HEAD_SIZE);
    b._slots.set('save:m1', before.slice(0, HEAD_SIZE) + (body[0] === 'A' ? 'B' : 'A') + body.slice(1));
    const h = (await b.health()).find((x) => x.slot === 'save:m1')!;
    expect(h.ok).toBe(false);
    expect(h.reason).toBe('digest');
  });
});

describe('SAV-003 R2 · 坏档隔离（移入 quarantine，不删除）', () => {
  it('quarantine 后活动槽移出、隔离区保留原始字节、拒读、标记 bad', async () => {
    const b = createMemoryBackend();
    await b.write('save:m1', SNAP, 'manual');
    const original = b._slots.get('save:m1')!;
    expect(await b.quarantine('save:m1')).toBe(true);
    expect(b._slots.has('save:m1')).toBe(false);            // 从活动槽移出（释放槽位）
    expect(b._quarantine.has('save:m1')).toBe(true);        // 数据仍在，未删除
    expect(b._quarantine.get('save:m1')!.raw).toBe(original); // 原始字节完整保留
    expect((await b.read('save:m1')).ok).toBe(false);       // 拒读
    expect((await b.health()).find((x) => x.slot === 'save:m1')!.reason).toBe('digest');
  });

  it('玩家删除活动槽也不销毁隔离数据（数据永远留给玩家一次机会）', async () => {
    const b = createMemoryBackend();
    await b.write('save:m2', SNAP, 'manual');
    await b.quarantine('save:m2');
    await b.remove('save:m2');
    expect(b._quarantine.has('save:m2')).toBe(true);
  });

  it('隔离后可用同一槽重新写入（槽位可复用）', async () => {
    const b = createMemoryBackend();
    await b.write('save:m3', SNAP, 'manual');
    await b.quarantine('save:m3');
    const w = await b.write('save:m3', { ...SNAP, savedAt: 2000 }, 'manual');
    expect(w.ok).toBe(true);
    expect((await b.read('save:m3')).ok).toBe(true);
    expect(b._quarantine.has('save:m3')).toBe(true);        // 旧诊断仍在
  });
});

describe('SAV-003 R3 · 恢复向导数据源（3 槽 + 校验 + 时间 + 最近可用高亮 + 新档）', () => {
  const hs: SaveHealth[] = [
    { slot: 'save:m1', ok: false, reason: 'digest', bytes: 100, at: 1000 },
    { slot: 'save:m2', ok: true, bytes: 200, at: 2000 },
    { slot: 'save:m3', ok: true, bytes: 300, at: 3000 },
  ];

  it('默认聚焦「最近可用」（at 最大），不默认新档；文案说明后果', () => {
    const w = buildRecoveryWizard(hs, { now: 5000, idbAvailable: true });
    expect(w.slots.length).toBe(3);
    expect(w.focusKey).toBe('save:m3');
    expect(w.slots.find((s) => s.key === 'save:m3')!.recommended).toBe(true);
    expect(w.slots.find((s) => s.key === 'save:m1')!.ok).toBe(false);
    expect(w.hasAnyUsable).toBe(true);
    expect(w.showWizard).toBe(true);                       // 主槽坏 → 弹向导
    expect(w.consequence).toContain('此槽不可用');
    expect(w.consequence).toContain('继续');
    expect(w.newGameSlot).toMatch(/^save:m/);
  });

  it('全坏 → focusKey=null（防误清），仍给「以新档开始」槽', () => {
    const w = buildRecoveryWizard([
      { slot: 'save:m1', ok: false, reason: 'digest', bytes: 10, at: 1000 },
      { slot: 'save:m2', ok: false, reason: 'absent' },
      { slot: 'save:m3', ok: false, reason: 'absent' },
    ], { now: 5000 });
    expect(w.focusKey).toBeNull();
    expect(w.hasAnyUsable).toBe(false);
    expect(w.consequence).toContain('全部存档不可用');
    expect(w.newGameSlot).toMatch(/^save:m/);
  });

  it('空档（全新游戏）不弹向导；恒定 3 行', () => {
    const w = buildRecoveryWizard([], { now: 0 });
    expect(w.slots.length).toBe(3);
    expect(w.showWizard).toBe(false);
  });

  it('集成：node 无 IDB 时 getRecoveryWizard 走降级且 degraded=true', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } as Storage);
    const w = await getRecoveryWizard();
    expect(w.slots.length).toBe(3);
    expect(w.degraded).toBe(true);                         // 无真实 indexedDB
  });
});

describe('SAV-003 R4 · 串行化（Web Locks 优先，不支持则内存锁）', () => {
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('内存锁：两个并发写严格串行，不交错', async () => {
    const lock = createSerialLock(() => null);
    const order: string[] = [];
    const p1 = lock(async () => { order.push('A-start'); await delay(15); order.push('A-end'); });
    const p2 = lock(async () => { order.push('B-start'); await delay(1); order.push('B-end'); });
    await Promise.all([p1, p2]);
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('Web Locks 路径：request(\'sanjie-save\', {mode:\'exclusive\'}) 被调用且返回回调值', async () => {
    const request = vi.fn((name: string, opts: { mode?: string }, cb: () => Promise<unknown>) => {
      expect(name).toBe('sanjie-save');
      expect(opts.mode).toBe('exclusive');
      return cb();
    });
    const fake = { request } as unknown as LockLike;
    const lock = createSerialLock(() => fake);
    const v = await lock(async () => 42);
    expect(v).toBe(42);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('前一个写抛错不阻塞后续写', async () => {
    const lock = createSerialLock(() => null);
    await expect(lock(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(lock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('SAV-003 R5/R6 · 降级告知 + ≤2KB 错误留存（无网络上报）', () => {
  it('IDB 可用 → 无提示；不可用 → 常驻文案 + 退出导出提示', () => {
    const ok = downgradeNotice(true);
    expect(ok.degraded).toBe(false);
    expect(ok.text).toBe('');
    const bad = downgradeNotice(false);
    expect(bad.degraded).toBe(true);
    expect(bad.text).toBe(DEGRADED_TEXT);
    expect(bad.text).toBe('本次进度仅保存在本机浏览器存储，容量有限');
    expect(bad.exitHint).toBe(EXIT_EXPORT_HINT);
    expect(bad.exitHint).toContain('导出');
  });

  it('truncateErrorRecord 恒 ≤2KB 且保留 code/ts/slot/bytes', () => {
    const rec = { code: 'write-failed', ts: 1, slot: 'save:m1', bytes: 12345, detail: 'x'.repeat(5000) };
    const text = truncateErrorRecord(rec);
    expect(text.length).toBeLessThanOrEqual(2048);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.code).toBe('write-failed');
    expect(parsed.ts).toBe(1);
    expect(parsed.slot).toBe('save:m1');
    expect(parsed.bytes).toBe(12345);
  });

  it('recordLastSaveError 落 localStorage，≤2KB，可读回', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } as Storage);
    recordLastSaveError({ code: 'verify-failed', slot: 'save:a1', bytes: 999, detail: 'digest' });
    const persisted = store.get(LAST_SAVE_ERROR_KEY)!;
    expect(persisted.length).toBeLessThanOrEqual(2048);
    const read = readLastSaveError()!;
    expect(read.code).toBe('verify-failed');
    expect(read.slot).toBe('save:a1');
    expect(read.bytes).toBe(999);
    expect(typeof read.ts).toBe('number');
  });
});
