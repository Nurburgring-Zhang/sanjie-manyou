// SAV-001 策略层单测：安全点五项判定 / ≤120s 间隔 / 槽隔离 / 待写队列 / 失败重试
// 全部通过 initSaveSystem 的可注入鸭子类型（now/scheduler/backend/host/notify/bus）驱动，
// 不依赖真 window / IndexedDB / DOM，不引入新 npm 依赖。
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  initSaveSystem, isSafePoint, defaultSafetyState,
  AUTO_INTERVAL_MS, SAFE_COMBAT_GAP_MS, toSlotMeta, labelForSlot,
  type SaveSystem, type BusLike, type Scheduler, type SaveSlotMeta,
} from '../src/game/savePolicy';
import { createMemoryBackend } from '../src/game/saveRecovery';
import { AUTO_SLOTS, MANUAL_SLOTS, type SaveSlotRecord } from '../src/rt/save';

const SNAP = {
  schemaVersion: 2, savedAt: 1000,
  economy: { coins: 120, yinde: 4, peach: 2 }, entities: [],
  day: 3, scale: '人间', karma: 12, rank: 2, playMs: 3_600_000,
};

function fakeScheduler(): Scheduler & { tick(): void } {
  let cb: (() => void) | null = null;
  return {
    setInterval: (fn) => { cb = fn; return 'timer'; },
    clearInterval: () => { cb = null; },
    tick: () => cb?.(),
  };
}

function fakeBus(): BusLike & { emit: (e: string, p?: unknown) => void } {
  const map = new Map<string, Array<(p?: unknown) => void>>();
  return {
    on: (e, fn) => {
      const arr = map.get(e) ?? [];
      arr.push(fn);
      map.set(e, arr);
      return () => { const a = map.get(e); if (a) map.set(e, a.filter((f) => f !== fn)); };
    },
    emit: (e, p) => { for (const fn of map.get(e) ?? []) fn(p); },
  };
}

const settle = async (): Promise<void> => {
  // doWrite 内有 await getBackend() / await backend.write()，多刷几轮 microtask 再落一个 macrotask
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
};

const systems: SaveSystem[] = [];
afterEach(() => {
  for (const s of systems) s.dispose();
  systems.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Ctx {
  sys: SaveSystem;
  backend: ReturnType<typeof createMemoryBackend>;
  sched: ReturnType<typeof fakeScheduler>;
  bus: ReturnType<typeof fakeBus>;
  host: Record<string, unknown>;
  notify: ReturnType<typeof vi.fn>;
  setT: (n: number) => void;
}

function makeCtx(over: Partial<Parameters<typeof initSaveSystem>[0]> = {}): Ctx {
  let t = 0;
  // over.backend 必须就是返回的 backend，便于测试断言同一个内存存储
  const backend = (over.backend as ReturnType<typeof createMemoryBackend> | undefined) ?? createMemoryBackend();
  const sched = fakeScheduler();
  const bus = fakeBus();
  const host: Record<string, unknown> = {};
  const notify = vi.fn();
  const sys = initSaveSystem({
    getSnapshot: () => ({ ...SNAP }),
    applySnapshot: () => {},
    now: () => t,
    scheduler: sched,
    backend,
    host,
    notify,
    bus,
    attachUnload: false,
    ...over,
  });
  systems.push(sys);
  return { sys, backend, sched, bus, host, notify, setT: (n) => { t = n; } };
}

describe('SAV-001 R1 · 安全点五项判定（纯函数 isSafePoint）', () => {
  const t = 100_000;
  const base = defaultSafetyState();

  it('五项全满足 → 安全', () => {
    expect(isSafePoint(base, t)).toBe(true);
  });

  it('wanted >= 3 → 不安全', () => {
    expect(isSafePoint({ ...base, wanted: 3 }, t)).toBe(false);
    expect(isSafePoint({ ...base, wanted: 2 }, t)).toBe(true);
  });

  it('3s 内有 combat:hit → 不安全；恰好 3s → 安全', () => {
    expect(SAFE_COMBAT_GAP_MS).toBe(3000);
    expect(isSafePoint({ ...base, lastCombatHitMs: t - 2999 }, t)).toBe(false);
    expect(isSafePoint({ ...base, lastCombatHitMs: t - 3000 }, t)).toBe(true);
    expect(isSafePoint({ ...base, lastCombatHitMs: t - 1 }, t)).toBe(false);
  });

  it('dialog.state !== idle → 不安全', () => {
    expect(isSafePoint({ ...base, dialogState: 'talking' }, t)).toBe(false);
    expect(isSafePoint({ ...base, dialogState: 'idle' }, t)).toBe(true);
  });

  it('buildMode.preview !== null → 不安全', () => {
    expect(isSafePoint({ ...base, buildPreview: { x: 1 } }, t)).toBe(false);
    expect(isSafePoint({ ...base, buildPreview: null }, t)).toBe(true);
  });

  it('场景切换中 → 不安全', () => {
    expect(isSafePoint({ ...base, switching: true }, t)).toBe(false);
    expect(isSafePoint({ ...base, switching: false }, t)).toBe(true);
  });
});

describe('SAV-001 R1 · 自动保存间隔 ≤120s', () => {
  it('常量口径 ≤120000ms', () => {
    expect(AUTO_INTERVAL_MS).toBeLessThanOrEqual(120_000);
  });

  it('119999ms 不写；120000ms 触发一次自动写', async () => {
    const c = makeCtx();
    c.setT(119_999);
    c.sched.tick();
    await settle();
    expect(c.backend._slots.size).toBe(0);
    c.setT(120_000);
    c.sched.tick();
    await settle();
    expect(c.backend._slots.size).toBe(1);
    expect([...c.backend._slots.keys()][0]).toMatch(/^save:a[0-2]$/);
  });

  it('兼容 vitest 假时钟（默认 setInterval scheduler + Date.now）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const backend = createMemoryBackend();
    const host: Record<string, unknown> = {};
    const sys = initSaveSystem({
      getSnapshot: () => ({ ...SNAP }), applySnapshot: () => {},
      now: () => Date.now(), backend, host, notify: vi.fn(), attachUnload: false,
    });
    systems.push(sys);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(backend._slots.size).toBe(1);
  });
});

describe('SAV-001 R5 · 槽隔离（自动槽轮转，永不覆盖手动槽）', () => {
  it('自动写只落 a0/a1/a2，手动槽 mtime 不随自动写变化', async () => {
    const c = makeCtx();
    for (let i = 1; i <= 5; i++) { c.setT(i * 120_000); c.sched.tick(); await settle(); }
    const keys = [...c.backend._slots.keys()];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => (AUTO_SLOTS as readonly string[]).includes(k))).toBe(true);
    expect(keys.some((k) => (MANUAL_SLOTS as readonly string[]).includes(k))).toBe(false);

    await c.sys.requestSave('manual', 'save:m1');
    expect(c.backend._slots.has('save:m1')).toBe(true);
    const m1 = c.backend._slots.get('save:m1');
    c.setT(6 * 120_000); c.sched.tick(); await settle();
    c.setT(7 * 120_000); c.sched.tick(); await settle();
    // 手动槽内容（mtime）只随玩家操作变化，自动层绝不覆盖
    expect(c.backend._slots.get('save:m1')).toBe(m1);
  });

  it('三轮自动写按 a0→a1→a2 轮转', async () => {
    const c = makeCtx();
    for (let i = 1; i <= 3; i++) { c.setT(i * 120_000); c.sched.tick(); await settle(); }
    const keys = [...c.backend._slots.keys()].sort();
    expect(keys).toEqual([...AUTO_SLOTS].sort());
  });
});

describe('SAV-001 R1/R6 · 待写队列（不满足只排队，禁止强写；满足即刻写）', () => {
  it('非安全点 requestSave(auto) → pending=true 且不写；tick 到安全点即刻落盘', async () => {
    let safety = { ...defaultSafetyState(), dialogState: 'talking' };
    const c = makeCtx({ getSafety: () => safety });
    const r = await c.sys.requestSave('auto');
    expect(r.ok).toBe(false);
    expect(c.sys.state().pending).toBe(true);
    expect(c.backend._slots.size).toBe(0);           // 禁止强写
    safety = defaultSafetyState();
    c.sys.tick();
    await settle();
    expect(c.backend._slots.size).toBe(1);
    expect(c.sys.state().pending).toBe(false);
  });

  it('bus 信号由不安全转安全 → maybeFlushPending 即刻写（不等下一次 tick）', async () => {
    const c = makeCtx();
    c.bus.emit('dialog:state', 'talking');
    await c.sys.requestSave('auto');
    expect(c.sys.state().pending).toBe(true);
    expect(c.backend._slots.size).toBe(0);
    c.bus.emit('dialog:state', 'idle');   // 条件满足即刻写
    await settle();
    expect(c.backend._slots.size).toBe(1);
    expect(c.sys.state().pending).toBe(false);
  });

  it('间隔到但非安全点 → 只排队不写', async () => {
    const c = makeCtx({ getSafety: () => ({ ...defaultSafetyState(), switching: true }) });
    c.setT(120_000);
    c.sched.tick();
    await settle();
    expect(c.sys.state().pending).toBe(true);
    expect(c.backend._slots.size).toBe(0);
  });

  it('window 桥：__save / __saveState / 写档期间 __saving', async () => {
    const c = makeCtx();
    expect(typeof c.host['__save']).toBe('function');
    const st = (c.host['__saveState'] as () => { lastAutoMs: number; pending: boolean; slots: string[] })();
    expect(st).toHaveProperty('lastAutoMs');
    expect(st).toHaveProperty('pending');
    expect(Array.isArray(st.slots)).toBe(true);
    expect(st.slots.length).toBe(6);                 // 3 自动 + 3 手动

    let release: (() => void) | null = null;
    const slow = createMemoryBackend();
    slow.write = (slot) => new Promise((res) => {
      release = () => res({ slot, bytes: 1, ms: 1, ok: true });
    });
    const host2: Record<string, unknown> = {};
    const sys2 = initSaveSystem({
      getSnapshot: () => ({ ...SNAP }), applySnapshot: () => {},
      now: () => 0, scheduler: fakeScheduler(), backend: slow, host: host2,
      notify: vi.fn(), attachUnload: false,
    });
    systems.push(sys2);
    const p = sys2.requestSave('manual', 'save:m1');
    expect(host2['__saving']).toBe(true);
    await settle();                    // 让 doWrite 进入 slow.write，赋值 release
    expect(host2['__saving']).toBe(true);
    release!();
    await p;
    expect(host2['__saving']).toBe(false);
  });
});

describe('SAV-001 R4 · 失败重试（常驻红标 + 原因 + 重试，禁止静默）', () => {
  it('写失败 → notify(fail) 带原因与 retry，pending 保留；重试成功后清账', async () => {
    const backend = createMemoryBackend();
    const orig = backend.write.bind(backend);
    let fail = true;
    backend.write = (s, d, r) => (fail
      ? Promise.resolve({ slot: s, bytes: 0, ms: 1, ok: false, reason: 'digest' as const })
      : orig(s, d, r));
    const c = makeCtx({ backend });
    const r1 = await c.sys.requestSave('auto');
    expect(r1.ok).toBe(false);
    expect(c.sys.state().failCount).toBe(1);
    expect(c.sys.state().pending).toBe(true);       // 自动失败保留待写
    const failCall = c.notify.mock.calls.find((call) => call[0]?.kind === 'fail');
    expect(failCall).toBeTruthy();
    expect(failCall![0].reason).toBe('digest');
    expect(typeof failCall![0].retry).toBe('function');

    fail = false;
    failCall![0].retry();                           // 模拟点击 HUD「重试」
    await settle();
    expect(c.sys.state().failCount).toBe(0);
    expect(c.sys.state().pending).toBe(false);
    expect(c.backend._slots.size).toBe(1);
  });

  it('成功 → notify(ok)；墨点淡出由默认 notifier 处理（此测试注入 spy 只验调用）', async () => {
    const c = makeCtx();
    const r = await c.sys.requestSave('manual', 'save:m2');
    expect(r.ok).toBe(true);
    expect(c.notify.mock.calls.some((call) => call[0]?.kind === 'ok')).toBe(true);
  });
});

describe('SAV-001 附加 · 纯函数 toSlotMeta / labelForSlot', () => {
  it('record → SaveSlotMeta 字段齐全且缺省确定性', () => {
    const rec: SaveSlotRecord = {
      key: 'save:m1', bytes: 256, at: 1000, ok: true,
      data: { schemaVersion: 2, savedAt: 1000, day: 4, scale: '天宫', karma: 8, rank: 3, playMs: 7200000 },
    };
    const m: SaveSlotMeta = toSlotMeta(rec);
    expect(m.key).toBe('save:m1');
    expect(m.label).toBe('手动档 1');
    expect(m.day).toBe(4);
    expect(m.scale).toBe('天宫');
    expect(m.karma).toBe(8);
    expect(m.rank).toBe(3);
    expect(m.playMs).toBe(7200000);
    expect(m.schemaVersion).toBe(2);
    expect(m.ok).toBe(true);
    expect(labelForSlot('save:a0')).toBe('自动档 1');
    expect(labelForSlot('save:v2')).toBe('旧档 v2');
  });
});
