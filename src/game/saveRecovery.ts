// ============================================================================
// 崩溃恢复与坏档隔离 · src/game/saveRecovery.ts（SAV-003）
//
// 职责：坏档识别（digest/长度/schema/缺失）、调用隔离（移入 quarantine 不删除）、
//       恢复向导数据源（3 槽 + 校验结果 + 时间 + 最近可用高亮 + 以新档开始，
//       默认聚焦最近可用、不默认新档）、IDB 不可用常驻降级告知、≤2KB 错误留存。
//
// 设计：尽量把逻辑做成**纯函数**（classifyRaw / buildRecoveryWizard / downgradeNotice /
//       truncateErrorRecord / createMemoryBackend），故 vitest 无需真 IndexedDB 即可验收
//       SAV-003 五项；异步函数只是这些纯函数 + rt/save 后端的一层薄封装。
// ============================================================================

import {
  health as rtHealth,
  quarantine as rtQuarantine,
  newGameSlot as rtNewGameSlot,
  isIdbAvailable as rtIsIdbAvailable,
  SCHEMA_VERSION, ALL_SLOTS, MANUAL_SLOTS, HEAD_SIZE,
  packSlot, verifySlot, chooseNewGameSlot,
  type SaveHealth, type BadReason, type SaveBackend, type SaveSlotRecord,
  type LastSaveError, type SaveReason,
} from '../rt/save';
import { labelForSlot } from './savePolicy';

export { recordLastSaveError, readLastSaveError, LAST_SAVE_ERROR_KEY } from '../rt/save';
export type { LastSaveError, BadReason, SaveHealth };

// ---- 降级告知（SAV-003 R5）----

export const DEGRADED_TEXT = '本次进度仅保存在本机浏览器存储，容量有限';
export const EXIT_EXPORT_HINT = '退出前请导出存档，避免清理浏览器数据后丢失';

export interface DowngradeInfo {
  degraded: boolean;
  text: string;          // 常驻 UI 文案
  exitHint: string;      // 退出时导出提示（SAV-005 衔接）
}

/** 纯函数：IDB 可用 → 无提示；不可用 → 常驻告知 + 退出导出提示（禁止只 console.warn）。 */
export function downgradeNotice(idbAvailable: boolean): DowngradeInfo {
  if (idbAvailable) return { degraded: false, text: '', exitHint: '' };
  return { degraded: true, text: DEGRADED_TEXT, exitHint: EXIT_EXPORT_HINT };
}

/** 常驻 UI 提示挂载：返回节点但不自动移除（常驻），主代理可挂在 #ui 或 body。 */
export function mountDegradedNotice(root: HTMLElement, info: DowngradeInfo): HTMLElement | null {
  if (!info.degraded || typeof document === 'undefined') return null;
  const el = root.ownerDocument.createElement('div');
  el.setAttribute('data-save-degraded', '1');
  el.textContent = `${info.text}；${info.exitHint}`;
  el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9998;max-width:340px;'
    + 'padding:8px 12px;border-radius:8px;background:rgba(72,52,8,.94);color:#ffe9b0;'
    + 'border:1px solid #b8860b;font:12px/1.5 system-ui,sans-serif;pointer-events:none;';
  root.appendChild(el);
  return el;
}

// ---- 错误留存（SAV-003 R6）：≤2KB，code/ts/slot/bytes，无网络上报 ----

/** 纯函数：把错误记录裁剪到 ≤2048 字节，便于测试断言上限。 */
export function truncateErrorRecord(rec: LastSaveError): string {
  let text = JSON.stringify(rec);
  if (text.length > 2048) {
    text = JSON.stringify({
      code: rec.code, ts: rec.ts, slot: rec.slot, bytes: rec.bytes,
      detail: String(rec.detail ?? '').slice(0, 128),
    }).slice(0, 2048);
  }
  return text;
}

// ---- 坏档识别（SAV-003 R1）----

/**
 * 纯函数：对一条原始槽内容做校验 → SaveHealth。
 * digest 不符 / 长度或头损坏 / schema 拒载 / 槽缺失 一律 ok:false（拒读）。
 */
export function classifyRaw(raw: string | null | undefined, currentSchema: number = SCHEMA_VERSION): SaveHealth {
  if (raw === null || raw === undefined) return { slot: '', ok: false, reason: 'absent' };
  const v = verifySlot(raw);
  if (!v.ok) return { slot: '', ok: false, reason: v.reason, bytes: raw.length, at: v.header?.at };
  let at: number | undefined;
  try { at = v.header?.at; } catch { at = undefined; }
  try {
    const p = JSON.parse(v.payload ?? '') as { schemaVersion?: unknown };
    const ok = !!p && typeof p === 'object'
      && Number.isFinite(p.schemaVersion) && (p.schemaVersion as number) <= currentSchema;
    return { slot: '', ok, reason: ok ? undefined : 'schema', bytes: raw.length, at };
  } catch {
    return { slot: '', ok: false, reason: 'schema', bytes: raw.length, at };
  }
}

// ---- 恢复向导数据源（SAV-003 R3）----

export interface RecoverySlot {
  key: string;
  label: string;
  ok: boolean;
  reason?: BadReason;
  at: number;
  bytes?: number;
  recommended: boolean;     // 「最近可用」高亮
}

export interface RecoveryWizard {
  slots: RecoverySlot[];       // 固定 3 槽
  focusKey: string | null;     // 默认聚焦最近可用；全坏则 null（不默认新档，防误清）
  hasAnyUsable: boolean;
  newGameSlot: string;         // 「以新档开始」目标槽
  consequence: string;         // 向导必须说明后果：「此槽不可用，将以槽 1 继续」
  showWizard: boolean;         // 主槽坏 / 全坏时才弹
  degraded: boolean;
  notice: string;              // 降级常驻文案
}

export interface BuildWizardOptions {
  now?: number;
  idbAvailable?: boolean;
  newGameSlot?: string;
  primaryKey?: string;         // 主槽（默认第一个）
}

/**
 * 纯函数：3 槽 + 各槽校验结果 + 时间 + 最近可用高亮 + 以新档开始。
 * 默认聚焦「最近可用」（ok 且 at 最大），绝不默认「新档」。
 */
export function buildRecoveryWizard(healths: SaveHealth[], opts: BuildWizardOptions = {}): RecoveryWizard {
  const list: RecoverySlot[] = healths.slice(0, 3).map((h) => ({
    key: h.slot,
    label: labelForSlot(h.slot),
    ok: h.ok,
    reason: h.reason,
    at: h.at ?? 0,
    bytes: h.bytes,
    recommended: false,
  }));
  // 补齐到 3 槽（空档占位），保证 UI 恒定 3 行
  while (list.length < 3) {
    const key = ALL_SLOTS[list.length] ?? `save:m${list.length + 1}`;
    list.push({ key, label: labelForSlot(key), ok: false, reason: 'absent', at: 0, recommended: false });
  }

  const usable = list.filter((s) => s.ok).sort((a, b) => b.at - a.at);   // 新→旧
  const focusKey = usable.length ? usable[0].key : null;
  for (const s of list) if (s.key === focusKey) s.recommended = true;
  const hasAnyUsable = usable.length > 0;

  const primary = opts.primaryKey ?? list[0]?.key ?? '';
  const primaryBad = list.find((s) => s.key === primary)?.ok === false;
  const anyWritten = list.some((s) => s.at > 0 || (s.bytes ?? 0) > 0);
  const showWizard = anyWritten && (primaryBad || !hasAnyUsable);

  const consequence = primaryBad
    ? (focusKey
      ? `此槽不可用，将以「${labelForSlot(focusKey)}」继续`
      : '全部存档不可用，可「以新档开始」（旧档已保留，可导出诊断）')
    : '';

  const occupied = list.filter((s) => s.at > 0).map((s) => s.key);
  const newGameSlot = opts.newGameSlot ?? chooseNewGameSlot(occupied, opts.now ?? 0);
  const dinfo = downgradeNotice(opts.idbAvailable !== false);

  return {
    slots: list,
    focusKey,
    hasAnyUsable,
    newGameSlot,
    consequence,
    showWizard,
    degraded: dinfo.degraded,
    notice: dinfo.text,
  };
}

// ---- 异步薄封装：调 rt/save 后端 ----

/** 启动时取向导数据：3 手动槽校验结果 + IDB 可用性 + 新档槽。 */
export async function getRecoveryWizard(): Promise<RecoveryWizard> {
  const [hs, available, ng] = await Promise.all([
    rtHealth(), rtIsIdbAvailable(), rtNewGameSlot(),
  ]);
  const manual = hs.filter((h) => (MANUAL_SLOTS as readonly string[]).includes(h.slot));
  const pool = manual.length === 3 ? manual : hs.slice(0, 3);
  return buildRecoveryWizard(pool.length ? pool : hs.slice(0, 3), {
    idbAvailable: available,
    newGameSlot: ng,
    now: Date.now(),
  });
}

/** 隔离坏档（不删除，SAV-003 R2）。 */
export async function quarantineSlot(key: string): Promise<boolean> { return rtQuarantine(key); }

/** 「以新档开始」目标槽。 */
export async function newGameSlot(): Promise<string> { return rtNewGameSlot(); }

// ============================================================================
// 内存 backend（纯函数/测试用；不引入任何 npm 依赖）
// 让「隔离不删」「digest 不符拒读」「向导数据」可在 Node 环境直接断言。
// ============================================================================

export interface MemoryBackend extends SaveBackend {
  _slots: Map<string, string>;
  _quarantine: Map<string, { slot: string; raw: string; reason: BadReason; at: number }>;
  _bad: Set<string>;
}

export function createMemoryBackend(): MemoryBackend {
  const slots = new Map<string, string>();
  const quarantine = new Map<string, { slot: string; raw: string; reason: BadReason; at: number }>();
  const bad = new Set<string>();
  const readRaw = (k: string): string | null => slots.get(k) ?? null;
  const headerAt = (raw: string): number => {
    try { return (JSON.parse(raw.slice(0, HEAD_SIZE).replace(/\u0000+$/, '')) as { at?: number }).at ?? 0; }
    catch { return 0; }
  };

  const api: MemoryBackend = {
    _slots: slots,
    _quarantine: quarantine,
    _bad: bad,

    available: () => true,

    async write(slot, data, reason) {
      const t0 = Date.now();
      let raw: string;
      try {
        const sv = typeof (data as { schemaVersion?: unknown } | null)?.schemaVersion === 'number'
          ? (data as { schemaVersion: number }).schemaVersion : SCHEMA_VERSION;
        raw = packSlot(JSON.stringify(data), { schemaVersion: sv, at: Date.now(), reason });
      } catch {
        return { slot, bytes: 0, ms: Date.now() - t0, ok: false, reason: 'length' };
      }
      slots.set(slot, raw);
      const v = verifySlot(readRaw(slot));           // 写后回读校验
      if (!v.ok) {
        quarantine.set(slot, { slot, raw, reason: v.reason ?? 'length', at: Date.now() });
        slots.delete(slot);
        bad.add(slot);
        return { slot, bytes: raw.length, ms: Date.now() - t0, ok: false, reason: v.reason };
      }
      bad.delete(slot);
      return { slot, bytes: raw.length, ms: Date.now() - t0, ok: true };
    },

    async read(key) {
      const raw = readRaw(key);
      if (raw === null) {
        if (quarantine.has(key)) return { ok: false, reason: 'digest' };  // 已隔离：可导出诊断，不可直接读
        return { ok: false, reason: 'absent' };
      }
      const v = verifySlot(raw);
      if (!v.ok && v.reason === 'digest') return { ok: false, reason: 'digest' };
      const body = v.ok && v.payload !== undefined ? v.payload : raw;
      try { return { ok: true, data: JSON.parse(body) as unknown }; }
      catch { return { ok: false, reason: 'length' }; }
    },

    async list() {
      return ALL_SLOTS.map((key): SaveSlotRecord => {
        const raw = readRaw(key);
        if (raw === null) return { key, bytes: 0, at: 0, ok: false, reason: 'absent' };
        const v = verifySlot(raw);
        const body = v.ok && v.payload !== undefined ? v.payload : raw;
        let data: unknown;
        try { data = JSON.parse(body) as unknown; } catch { data = undefined; }
        const isBad = bad.has(key);
        const ok = v.ok && data !== undefined && !isBad;
        return {
          key, bytes: raw.length, at: headerAt(raw), ok,
          reason: ok ? undefined : (v.reason ?? (isBad ? 'digest' : 'schema')),
          data: ok ? data : undefined,
        };
      });
    },

    async remove(key) {
      slots.delete(key);
      bad.delete(key);
      // 不触碰 quarantine：隔离数据永远保留（SAV-003 R2「隔离而非删除」）
    },

    async copy(key, toKey) {
      const raw = readRaw(key);
      if (raw === null) return false;
      slots.set(toKey, raw);
      bad.delete(toKey);
      return true;
    },

    async quarantine(key) {
      const raw = readRaw(key);
      if (raw === null) return false;
      quarantine.set(key, { slot: key, raw, reason: 'digest', at: Date.now() });  // 原始字节保留
      slots.delete(key);                                                            // 从活动槽移出（非销毁）
      bad.add(key);
      return true;
    },

    async health() {
      return ALL_SLOTS.map((slot): SaveHealth => {
        const raw = readRaw(slot);
        if (raw === null) return bad.has(slot)
          ? { slot, ok: false, reason: 'digest' }
          : { slot, ok: false, reason: 'absent' };
        const c = classifyRaw(raw);
        const isBad = bad.has(slot);
        return {
          slot, ok: c.ok && !isBad,
          reason: !c.ok ? c.reason : (isBad ? 'digest' : undefined),
          bytes: c.bytes, at: c.at,
        };
      });
    },

    async newGameSlot() {
      const occupied = [...MANUAL_SLOTS].filter((k) => slots.has(k));
      return chooseNewGameSlot(occupied, Date.now());
    },
  };
  return api;
}

// SaveReason 仅作再导出，便于测试/上层引用同一枚举
export type { SaveReason };
