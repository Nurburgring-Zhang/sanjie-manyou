// ============================================================================
// Esc → 存档面板 · src/ui/savePanel.ts（SAV-001 R2 / R4 / R5 / SAV-003 R3）
//
// 自带样式（注入 <style>，不依赖外部 CSS）。主代理只在 ui.ts 的 Escape 分支挂入口，
// 本模块不改 ui.ts。所有数据/操作通过 opts 鸭子类型注入，缺省时自动接
// savePolicy / saveRecovery / rt/save 的顶层函数（零配置即可用）。
//
// · 3 手动槽 save:m1/m2/m3 + 1 自动状态条（自动槽 a0/a1/a2 只读，自动层永不覆盖手动槽）
// · 每槽缩略图 384×216（canvas.toDataURL('image/jpeg',0.6)，≤18KB）、游戏内日 / 尺度 /
//   业力 / 官身 / 游玩时长 / schemaVersion / 校验结果
// · 操作：存 / 读 / 删 / 复制 / 导出；读档二次确认；删除长按 0.8s
// · 坏档常驻显示「槽 N 损坏（已保留，可导出诊断）」；恢复向导默认聚焦最近可用
// ============================================================================

import { MANUAL_SLOTS, getSaveBackend } from '../rt/save';
import {
  listSlots as spListSlots,
  loadSlot as spLoadSlot,
  requestSave as spRequestSave,
  getActiveSaveSystem,
  type SaveSlotMeta, type SaveReason,
} from '../game/savePolicy';
import {
  getRecoveryWizard,
  type RecoveryWizard,
} from '../game/saveRecovery';

// ---- 可测常量与纯函数 ----

export const THUMB_W = 384;
export const THUMB_H = 216;
export const THUMB_MAX_BYTES = 18 * 1024;
export const DELETE_HOLD_MS = 800;
export const THUMB_QUALITY = 0.6;

/** 纯函数：dataURL 的 base64 解码字节数是否 ≤18KB。 */
export function thumbWithinBudget(dataUrl: string): boolean {
  if (!dataUrl.startsWith('data:image/jpeg;base64,')) return false;
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const pad = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
  const bytes = Math.floor(b64.length * 3 / 4) - pad;
  return bytes > 0 && bytes <= THUMB_MAX_BYTES;
}

/** 纯函数（DOM）：把游戏 canvas 缩放到 384×216，jpeg 0.6 起逐步降质到 ≤18KB。 */
export function makeThumb(source: HTMLCanvasElement | null | undefined, quality = THUMB_QUALITY): string | undefined {
  if (!source || typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = THUMB_W;
    c.height = THUMB_H;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
    let q = quality;
    let url = c.toDataURL('image/jpeg', q);
    while (!thumbWithinBudget(url) && q > 0.2) {
      q = Math.max(0.2, q - 0.1);
      url = c.toDataURL('image/jpeg', q);
    }
    return thumbWithinBudget(url) ? url : undefined;
  } catch { return undefined; }
}

/** 纯函数：游玩时长 ms → HH:MM:SS。 */
export function formatPlayMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// ---- opts ----

export interface SavePanelOptions {
  listSlots?: () => Promise<SaveSlotMeta[]>;
  loadSlot?: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  requestSave?: (reason: SaveReason, slot?: string) => Promise<{ slot: string; bytes: number; ms: number; ok: boolean }>;
  deleteSlot?: (key: string) => Promise<void>;
  copySlot?: (key: string, toKey: string) => Promise<boolean>;
  exportSlot?: (key: string) => Promise<void>;
  captureThumb?: () => string | undefined;
  autoStatus?: () => { lastAutoMs: number; pending: boolean; saving: boolean } | undefined;
  getWizard?: () => Promise<RecoveryWizard> | RecoveryWizard;
  startNewGame?: (slot: string) => void;
  now?: () => number;
  manualSlots?: readonly string[];
}

export interface PanelHandle {
  el: HTMLElement;
  refresh(): Promise<void>;
  open(): void;
  close(): void;
  toggle(): void;
}

// ---- 样式（自带，不依赖外部 CSS）----

const STYLE_ID = 'cq-save-panel-style';
const PANEL_CSS = `
.cqsp-panel{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;
  background:rgba(4,8,16,.72);backdrop-filter:blur(3px);font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#e8f0ff;}
.cqsp-panel.cqsp-open{display:flex;}
.cqsp-box{width:min(920px,94vw);max-height:88vh;overflow:auto;background:linear-gradient(160deg,#0e1626,#0a1120);
  border:1px solid #2b4a6b;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.6);padding:18px 20px;}
.cqsp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.cqsp-head h2{margin:0;font-size:18px;letter-spacing:.08em;color:#ffe6a8;}
.cqsp-close{cursor:pointer;background:transparent;border:1px solid #456;color:#cbd8ea;border-radius:6px;padding:3px 10px;}
.cqsp-auto{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;
  background:rgba(30,60,90,.28);border:1px solid #24405f;border-radius:8px;font-size:12px;color:#a8d4ff;}
.cqsp-auto b{color:#ffe6a8;font-weight:600;}
.cqsp-wizard{padding:10px 12px;margin-bottom:12px;background:rgba(90,30,16,.3);border:1px solid #a4472e;
  border-radius:8px;font-size:12px;color:#ffd9c2;}
.cqsp-wizard .cqsp-rec{background:#1d4a2a;border:1px solid #3c8f52;color:#c8ffd8;padding:1px 8px;border-radius:10px;margin:0 4px;}
.cqsp-newgame{cursor:pointer;background:#8a2f1a;border:0;color:#fff;border-radius:5px;padding:4px 12px;margin-top:6px;}
.cqsp-slot{display:grid;grid-template-columns:150px 1fr auto;gap:12px;padding:10px;margin-bottom:10px;
  background:rgba(255,255,255,.025);border:1px solid #24354b;border-radius:10px;align-items:center;}
.cqsp-slot.cqsp-bad{border-color:#a4472e;background:rgba(120,30,16,.14);}
.cqsp-thumb{width:150px;height:84px;border-radius:6px;overflow:hidden;background:#060c16;border:1px solid #22344a;
  display:flex;align-items:center;justify-content:center;color:#4a607a;font-size:11px;}
.cqsp-thumb img{width:100%;height:100%;object-fit:cover;}
.cqsp-title{font-size:14px;color:#ffe6a8;margin-bottom:4px;}
.cqsp-ok{color:#7fe0a0;font-size:11px;margin-left:6px;}
.cqsp-bad .cqsp-ok,.cqsp-ok.cqsp-nok{color:#ff8b72;}
.cqsp-fields{font-size:11px;color:#aebfd4;line-height:1.8;}
.cqsp-fields span{display:inline-block;margin-right:10px;white-space:nowrap;}
.cqsp-time{font-size:10px;color:#6f8199;margin-top:3px;}
.cqsp-ops{display:flex;flex-direction:column;gap:5px;min-width:78px;}
.cqsp-ops button{cursor:pointer;background:#16283e;border:1px solid #34506e;color:#d6e6f8;border-radius:5px;padding:4px 8px;font-size:12px;}
.cqsp-ops button:hover{background:#21405f;}
.cqsp-ops button[data-act="delete"]{position:relative;overflow:hidden;border-color:#7a3a2a;color:#ffb9a3;}
.cqsp-ops button.cqsp-holding::after{content:"";position:absolute;left:0;bottom:0;height:3px;background:#e0553a;
  animation:cqsp-hold .8s linear forwards;}
@keyframes cqsp-hold{from{width:0}to{width:100%}}
.cqsp-confirm{grid-column:1/-1;display:flex;gap:8px;align-items:center;padding:8px 10px;margin-top:6px;
  background:rgba(120,80,10,.22);border:1px solid #8a6a20;border-radius:6px;font-size:12px;color:#ffe6a8;}
.cqsp-confirm button{cursor:pointer;border-radius:5px;padding:3px 12px;border:1px solid #8a6a20;background:#2a2410;color:#ffe6a8;}
.cqsp-copy{grid-column:1/-1;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:#aebfd4;padding:6px 4px;}
.cqsp-copy button{cursor:pointer;background:#16283e;border:1px solid #34506e;color:#d6e6f8;border-radius:5px;padding:3px 10px;}
.cqsp-err{color:#ff8b72;font-size:11px;margin-top:6px;min-height:14px;}
`;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const st = doc.createElement('style');
  st.id = STYLE_ID;
  st.textContent = PANEL_CSS;
  doc.head.appendChild(st);
}

// ---- 缩略图本机存储（≤18KB/槽，随面板存/复制/删同步）----

const thumbKey = (k: string): string => 'cq_thumb:' + k;
function readThumb(k: string): string | undefined {
  try { return (typeof localStorage !== 'undefined' ? localStorage.getItem(thumbKey(k)) : null) ?? undefined; }
  catch { return undefined; }
}
function writeThumb(k: string, data?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (data) localStorage.setItem(thumbKey(k), data);
    else localStorage.removeItem(thumbKey(k));
  } catch { /* 容量有限，失败不阻断 */ }
}

function defaultCaptureThumb(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return makeThumb(document.querySelector('canvas') as HTMLCanvasElement | null, THUMB_QUALITY);
}

async function defaultExport(key: string): Promise<void> {
  const b = await getSaveBackend();
  const r = await b.read(key);
  const text = JSON.stringify({ key, ok: r.ok, reason: r.reason ?? null, data: r.data ?? null }, null, 2);
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${key}${r.ok ? '' : '-诊断'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- 挂载 ----

let current: PanelHandle | null = null;

export function mountSavePanel(root: HTMLElement, opts: SavePanelOptions = {}): PanelHandle {
  unmountSavePanel();
  const doc = root.ownerDocument;
  injectStyle(doc);

  const now = opts.now ?? (() => Date.now());
  const manualSlots = opts.manualSlots ?? MANUAL_SLOTS;
  const listSlots = opts.listSlots ?? spListSlots;
  const loadSlot = opts.loadSlot ?? spLoadSlot;
  const requestSave = opts.requestSave ?? ((reason: SaveReason, slot?: string) => {
    const sys = getActiveSaveSystem();
    return sys ? sys.requestSave(reason, slot) : spRequestSave(reason);
  });
  const deleteSlot = opts.deleteSlot ?? (async (key: string) => { (await getSaveBackend()).remove(key); });
  const copySlot = opts.copySlot ?? (async (key: string, to: string) => (await getSaveBackend()).copy(key, to));
  const exportSlot = opts.exportSlot ?? defaultExport;
  const captureThumb = opts.captureThumb ?? defaultCaptureThumb;
  const getWizard = opts.getWizard ?? getRecoveryWizard;

  const el = doc.createElement('div');
  el.className = 'cqsp-panel';
  el.id = 'cq-save-panel';
  el.setAttribute('data-save-panel', '1');
  el.innerHTML = `
    <div class="cqsp-box">
      <div class="cqsp-head"><h2>存档 · 赛博上河</h2><button class="cqsp-close" data-act="close">关闭 (Esc)</button></div>
      <div class="cqsp-wizard" data-role="wizard" style="display:none"></div>
      <div class="cqsp-auto" data-role="auto"></div>
      <div data-role="slots"></div>
      <div class="cqsp-err" data-role="err"></div>
    </div>`;
  root.appendChild(el);

  let confirmKey: string | null = null;
  let copyKey: string | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdKey: string | null = null;
  let wizard: RecoveryWizard | null = null;
  let metas: SaveSlotMeta[] = [];

  const q = (role: string): HTMLElement => el.querySelector(`[data-role="${role}"]`) as HTMLElement;
  const err = (msg: string): void => { q('err').textContent = msg; };

  const cancelHold = (): void => {
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdKey) {
      const b = el.querySelector(`[data-act="delete"][data-key="${holdKey}"]`);
      b?.classList.remove('cqsp-holding');
    }
    holdKey = null;
  };

  const renderAuto = (): void => {
    const s = opts.autoStatus?.() ?? (() => {
      const st = getActiveSaveSystem()?.state();
      return st ? { lastAutoMs: st.lastAutoMs, pending: st.pending, saving: st.saving } : undefined;
    })();
    const ago = s ? `${Math.max(0, Math.round((now() - s.lastAutoMs) / 1000))} 秒前` : '未知';
    const autos = metas.filter((m) => /^save:a/.test(m.key));
    const autoText = autos.map((a) => `${a.label}:${a.ok ? '✓' : '—'}`).join(' / ') || '自动槽 a0/a1/a2 轮转';
    q('auto').innerHTML = `<span>上次自动保存 <b>${ago}</b></span>`
      + `<span>待写 <b>${s?.pending ? '是' : '否'}</b></span>`
      + `<span>状态 <b>${s?.saving ? '写入中' : '空闲'}</b></span>`
      + `<span>自动槽 <b>${autoText}</b>（自动保存永不覆盖手动档）</span>`;
  };

  const renderWizard = (): void => {
    const box = q('wizard');
    if (!wizard || !wizard.showWizard) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    const rows = wizard.slots.map((s) =>
      `<span class="${s.recommended ? 'cqsp-rec' : ''}">${s.label} ${s.ok ? '✓' : `损坏(${s.reason ?? '未知'})`}</span>`).join('');
    box.innerHTML = `<div>检测到存档异常 · ${wizard.consequence || '请选择要恢复的存档'}</div>`
      + `<div style="margin-top:6px">${rows}</div>`
      + `<div style="margin-top:6px;color:#ffb9a3">${wizard.notice || '坏档已保留，可导出诊断'}</div>`
      + `<button class="cqsp-newgame" data-act="newgame">以新档开始（${wizard.newGameSlot}）</button>`;
  };

  const slotHtml = (m: SaveSlotMeta): string => {
    const thumb = m.thumb ?? readThumb(m.key);
    const thumbHtml = thumb ? `<img src="${thumb}" alt="缩略图"/>` : '无缩略图';
    const okText = m.ok ? '<span class="cqsp-ok">校验通过</span>'
      : `<span class="cqsp-ok cqsp-nok">损坏（已保留，可导出诊断）</span>`;
    const time = m.at ? new Date(m.at).toLocaleString() : '—';
    const confirmHtml = confirmKey === m.key
      ? `<div class="cqsp-confirm">确定读取「${m.label}」？当前进度将被覆盖。`
        + `<button data-act="load-yes" data-key="${m.key}">确定读档</button>`
        + `<button data-act="load-no">取消</button></div>` : '';
    const copyHtml = copyKey === m.key
      ? `<div class="cqsp-copy">复制到：${manualSlots.filter((k) => k !== m.key)
        .map((k) => `<button data-act="copy-to" data-from="${m.key}" data-to="${k}">${k}</button>`).join('')}`
        + `<button data-act="copy-no">取消</button></div>` : '';
    return `<div class="cqsp-slot ${m.ok ? '' : 'cqsp-bad'}" data-slot="${m.key}">
      <div class="cqsp-thumb">${thumbHtml}</div>
      <div class="cqsp-info">
        <div class="cqsp-title">${m.label}${okText}</div>
        <div class="cqsp-fields">
          <span>游戏内日 ${m.day}</span><span>尺度 ${m.scale}</span><span>业力 ${m.karma}</span>
          <span>官身 ${m.rank}</span><span>游玩 ${formatPlayMs(m.playMs)}</span><span>schema ${m.schemaVersion}</span>
        </div>
        <div class="cqsp-time">保存于 ${time} · 槽 ${m.key}</div>
      </div>
      <div class="cqsp-ops">
        <button data-act="save" data-key="${m.key}">存</button>
        <button data-act="load" data-key="${m.key}">读</button>
        <button data-act="delete" data-key="${m.key}" title="长按 0.8s 删除">删·长按</button>
        <button data-act="copy" data-key="${m.key}">复制</button>
        <button data-act="export" data-key="${m.key}">导出</button>
      </div>
      ${confirmHtml}${copyHtml}
    </div>`;
  };

  const refresh = async (): Promise<void> => {
    try {
      metas = await listSlots();
      try { wizard = await Promise.resolve(getWizard()); } catch { wizard = null; }
      const manual = manualSlots.map((k) => metas.find((m) => m.key === k) ?? {
        key: k, label: `手动档 ${manualSlots.indexOf(k) + 1}`, day: 1, at: 0, scale: '人间',
        karma: 0, rank: 0, playMs: 0, schemaVersion: 2, ok: false,
      } as SaveSlotMeta);
      q('slots').innerHTML = manual.map(slotHtml).join('');
      renderAuto();
      renderWizard();
    } catch (e) {
      err(`读取存档列表失败：${String(e)}`);
    }
  };

  // 事件委托：click
  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest('button') as HTMLElement | null;
    if (!btn) return;
    const act = btn.dataset.act;
    const key = btn.dataset.key;
    if (act === 'close') { close(); return; }
    if (act === 'newgame') {
      const slot = wizard?.newGameSlot ?? 'save:m1';
      if (opts.startNewGame) opts.startNewGame(slot);
      else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cq:new-game', { detail: { slot } }));
      close();
      return;
    }
    if (act === 'load') { confirmKey = key ?? null; copyKey = null; void refresh(); return; }
    if (act === 'load-no') { confirmKey = null; void refresh(); return; }
    if (act === 'load-yes' && key) {
      confirmKey = null;
      void loadSlot(key).then((r) => { if (r.ok) { err(''); close(); } else err(`读档失败：${r.reason ?? '未知原因'}`); });
      return;
    }
    if (act === 'copy') { copyKey = key ?? null; confirmKey = null; void refresh(); return; }
    if (act === 'copy-no') { copyKey = null; void refresh(); return; }
    if (act === 'copy-to') {
      const from = btn.dataset.from ?? '';
      const to = btn.dataset.to ?? '';
      copyKey = null;
      void copySlot(from, to).then((ok) => {
        if (ok) { const th = readThumb(from); if (th) writeThumb(to, th); err(''); }
        else err('复制失败：源槽不可用');
        void refresh();
      });
      return;
    }
    if (act === 'save' && key) {
      void requestSave('manual', key).then((r) => {
        if (r.ok) {
          const th = captureThumb();
          if (th) writeThumb(r.slot, th);
          err('');
        } else err('保存失败，请查看 HUD 红标并重试');
        void refresh();
      });
      return;
    }
    if (act === 'export' && key) {
      void exportSlot(key).catch((e) => err(`导出失败：${String(e)}`));
      return;
    }
  });

  // 删除长按 0.8s（pointerdown 起表，提前松手取消）
  el.addEventListener('pointerdown', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button[data-act="delete"]') as HTMLElement | null;
    if (!btn) return;
    const key = btn.dataset.key;
    if (!key) return;
    cancelHold();
    holdKey = key;
    btn.classList.add('cqsp-holding');
    holdTimer = setTimeout(() => {
      holdTimer = null;
      btn.classList.remove('cqsp-holding');
      holdKey = null;
      void deleteSlot(key).then(() => { writeThumb(key, undefined); err(''); void refresh(); });
    }, DELETE_HOLD_MS);
  });
  for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.addEventListener(evt, cancelHold);
  }

  const open = (): void => { el.classList.add('cqsp-open'); void refresh(); };
  const close = (): void => { el.classList.remove('cqsp-open'); cancelHold(); confirmKey = null; copyKey = null; };
  const toggle = (): void => { el.classList.contains('cqsp-open') ? close() : open(); };

  const handle: PanelHandle = { el, refresh, open, close, toggle };
  current = handle;
  return handle;
}

export function unmountSavePanel(): void {
  if (!current) return;
  current.el.remove();
  current = null;
  // 样式保留（幂等注入）；如需彻底清理可由主代理移除 #cq-save-panel-style
}

export function toggleSavePanel(): void { current?.toggle(); }
export function openSavePanel(): void { current?.open(); }
export function closeSavePanel(): void { current?.close(); }
export function isSavePanelOpen(): boolean { return !!current?.el.classList.contains('cqsp-open'); }
