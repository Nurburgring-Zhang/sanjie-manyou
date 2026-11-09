// ============================================================================
// 三界造物 · 许愿台 UI 与实体编排（R25 融合玩法完整接线）· src/game/wishPanel.ts
//
// 全链：自然语言 → Agent 开发设定与资产 → 登记资产 → forge 几何 → 热更新挂载玩家附近
//       → 每帧真实世界循环（探索/战斗/骑乘/发现/奖励）→ 互动 / 建造 / 合并 / 进化 / 升级
//       → 存档持久化（刷新后造物与建筑都还在）。
//
// R24 的五个玩法标签原本只是按钮（战斗=加 45 XP 文本、骑乘=一次性挪位）；R25 全部
// 改为每帧运行的世界行为，见 wishPlay.ts / wishBuild.ts / wishBlueprint.ts。
// 纪律：不改共享 RNG；世界对象鸭子类型访问，载入期未装配完成一律安全降级。
// ============================================================================
import * as THREE from 'three';
import { WISH_CATALOG, ARCHETYPES, getById, matchCatalog, classifyWish } from './wishCatalog';
import { forge, forgeMany, type ForgeResult, type WishSpec } from './wishForge';
import {
  resolveWish, loadAgentConfig, saveAgentConfig,
  type AgentConfig, type ResolveResult,
} from './wishAgent';
import {
  createEvolvable, gainXp as gainXpFn, evolve as evolveFn,
  upgrade as upgradeFn, merge as mergeFn, devour as devourFn,
  lineageOf, lineageDesc, STAGES, type Evolvable, type DevourResult,
} from './wishEvolution';
import {
  WishPlay, createPlayActor, type PlayActor, type PlayEvent,
  type Behavior, type WishWorldLike,
} from './wishPlay';
import { WishBuild, type BuildPart } from './wishBuild';
import { validateAsset, type ValidationReport } from './assetValidator';
import {
  runAssetPipeline, noticeText, doneText, offlineResearch,
  setWishMetrics, lastWishMetrics,
  type PipelineResult, type PipelineStep, type ResearchCard,
  type DesignDoc, type VerifyResult, type WishMetrics,
} from './assetPipeline';
import {
  performResearch, saveResearchConfig, loadResearchConfig,
  type ResearchConfig,
} from './wishResearch';
import { AGENT_CAPABILITIES, capabilityStats, planCapabilities } from './agentCapabilities';
import {
  developAsset, mergeLlmLore, loreCardHtml, registerBlueprint,
  listBlueprints, blueprintCount, exportBlueprints, importBlueprints,
  type AssetBlueprint,
} from './wishBlueprint';

const STATE_KEY = 'cyber-qingming.wish.state.v1';

export interface WishPanelDeps {
  uiRoot: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** R26：8 机位离屏截图验证借用主 renderer；未提供时如实标注不可用，不伪造通过 */
  renderer?: THREE.WebGLRenderer;
  dropPoint: (forward: number, side: number) => { x: number; y: number; z: number };
  /** R25：世界对象（player / interact / boss），鸭子类型消费，未装配完成时降级 */
  world?: unknown;
}

interface WishEntity {
  id: string;
  name: string;
  spec: WishSpec;
  group: THREE.Group;
  label: HTMLDivElement;
  ev: Evolvable;
  baseY: number;
  phase: number;
  speed: number;
  tier: string;
  catalogId?: string;
  pos: { x: number; y: number; z: number };
  play?: PlayActor;
  blueprintId?: string;
  buildPartId?: string;
  hostile?: boolean;
  registered?: boolean;
  halo?: THREE.Group;
}

interface SavedEntity {
  spec: WishSpec;
  name: string;
  tier: string;
  catalogId?: string;
  ev: Evolvable;
  pos: { x: number; y: number; z: number };
  behavior: Behavior;
  blueprintId?: string;
  buildPartId?: string;
  hostile?: boolean;
}

export interface SubmitResult {
  ok: boolean;
  tier: string;
  count: number;
  spawned: string[];
  reason?: string;
  degraded?: boolean;
  spec?: WishSpec;
  blueprintId?: string;
  /** R26：是否命中内置资产直接复用、流水线步骤、8 机位验证结果 */
  reused?: boolean;
  pipelineSteps?: string[];
  validation?: { ok: boolean; passed: number; total: number } | null;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function safeGet(key: string): string {
  try { return (globalThis as unknown as { localStorage?: Storage }).localStorage?.getItem(key) ?? ''; }
  catch { return ''; }
}
function safeSet(key: string, raw: string): void {
  try { (globalThis as unknown as { localStorage?: Storage }).localStorage?.setItem(key, raw); } catch { /* 内存降级 */ }
}

export class WishPanel {
  private entityMap = new Map<string, WishEntity>();
  private selected: string | null = null;
  private seq = 0;
  private t = 0;
  private root!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private listEl!: HTMLDivElement;
  private labelsEl!: HTMLDivElement;
  private settingsEl!: HTMLDivElement;
  private loreEl!: HTMLDivElement;
  private buildBarEl!: HTMLDivElement;
  private verifyEl!: HTMLDivElement;
  private pipelineEl!: HTMLDivElement;
  private capsEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private proj = new THREE.Vector3();
  private play: WishPlay;
  readonly build = new WishBuild();
  private lastBlueprint: AssetBlueprint | null = null;
  /** R26：最近一次 8 机位截图验证报告与吞噬详情（验收句柄直接读） */
  private lastValidation: ValidationReport | null = null;
  private lastDevour: DevourResult | null = null;
  /** R26：WorkBuddy 能力编排流水线的真实执行记录 */
  private lastPipeline: PipelineResult | null = null;
  private events: PlayEvent[] = [];
  private preview: THREE.Mesh | null = null;
  private lastEventAt = 0;
  /** 读档过程中禁止回写，否则每恢复一件就覆盖掉尚未恢复的存档 */
  private restoring = false;

  constructor(private d: WishPanelDeps) {
    this.play = new WishPlay(this.world, (ev) => {
      this.events.push(ev);
      if (this.events.length > 60) this.events.shift();
    });
    this.buildDOM();
    this.bindBuildKeys();
    this.restoreState();
  }

  private get world(): WishWorldLike | null {
    return (this.d.world ?? null) as WishWorldLike | null;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, css?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) e.style.cssText = css;
    return e;
  }
  private btn(label: string, cls: string, fn: (ev: MouseEvent) => void): HTMLButtonElement {
    const b = this.el('button', cls);
    b.type = 'button';
    b.textContent = label;
    b.onclick = fn;
    return b;
  }
  private hash(s: string): number {
    let x = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
    return x >>> 0;
  }

  // ---- DOM 总装（保留 R24 全部 id：wish-panel / wish-panel-input / wish-tabs / wish-settings / wish-labels）----
  private buildDOM(): void {
    const root = this.el('div', '', '');
    root.id = 'wish-panel';
    this.root = root;

    const head = this.el('div', 'wish-head');
    const title = this.el('b');
    title.textContent = '三界造物 · 许愿台';
    head.appendChild(title);
    head.appendChild(this.btn('设定卡', 'wish-btn', () => this.showLastLore()));
    head.appendChild(this.btn('能力库', 'wish-btn', () => this.showCapabilities()));
    head.appendChild(this.btn('Agent 设置', 'wish-btn', () => this.openSettings()));
    head.appendChild(this.btn('−', 'wish-btn', () => root.classList.toggle('collapsed')));
    head.onclick = (ev) => { if (ev.target === head) root.classList.toggle('collapsed'); };
    root.appendChild(head);

    const body = this.el('div', 'wish-body');
    this.statusEl = this.el('div', '', '');
    this.statusEl.id = 'wish-status';
    this.statusEl.textContent = '就绪。试试「我要一条神龙」。';
    body.appendChild(this.statusEl);

    const row = this.el('div', 'wish-input-row');
    this.inputEl = this.el('input', '', '') as HTMLInputElement;
    // #wish-input 已被 creation.ts 的 Y 键愿望条占用，保持改名避免样式串味。
    this.inputEl.id = 'wish-panel-input';
    this.inputEl.type = 'text';
    this.inputEl.placeholder = '试试：我要一条神龙';
    this.inputEl.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.code === 'Enter') { ev.preventDefault(); void this.submit(); }
      else if (ev.code === 'Escape') { ev.preventDefault(); this.inputEl.blur(); this.settingsEl.classList.remove('show'); }
    });
    row.appendChild(this.inputEl);
    row.appendChild(this.btn('许愿', 'wish-btn wish-send', () => void this.submit()));
    body.appendChild(row);

    const tabs = this.el('div', '');
    tabs.id = 'wish-tabs';
    for (const name of ['探索', '战斗', '创造', '进化', '升级']) {
      tabs.appendChild(this.btn(name, 'wish-tab', () => this.onTab(name)));
    }
    body.appendChild(tabs);

    // R25 建造工具条：放置 / 旋转 / 层叠 / 撤销 / 组合 / 清空
    this.buildBarEl = this.el('div', '');
    this.buildBarEl.id = 'wish-buildbar';
    this.buildBarEl.appendChild(this.btn('建造模式', 'wish-btn', () => this.toggleBuild()));
    this.buildBarEl.appendChild(this.btn('放置', 'wish-btn', () => this.placeSelected()));
    this.buildBarEl.appendChild(this.btn('旋转 ⟳', 'wish-btn', () => { this.build.rotate(); this.status(`建造：朝向 ${Math.round(this.build.ry * 180 / Math.PI)}°`, 'ok'); }));
    this.buildBarEl.appendChild(this.btn('叠层 ↑', 'wish-btn', () => { this.build.setStack(this.build.stack + 1); this.status(`建造：第 ${this.build.stack + 1} 层`, 'ok'); }));
    this.buildBarEl.appendChild(this.btn('撤销', 'wish-btn', () => this.undoBuild()));
    this.buildBarEl.appendChild(this.btn('组合', 'wish-btn', () => this.combineBuild()));
    this.buildBarEl.appendChild(this.btn('清空', 'wish-btn', () => this.clearBuild()));
    body.appendChild(this.buildBarEl);

    // R25 设定卡：Agent 开发的设定与资产流水真实可见
    this.loreEl = this.el('div', '');
    this.loreEl.id = 'wish-lore';
    body.appendChild(this.loreEl);

    // R26 Agent 能力流水线：查重 / 复用 / 检索 / 设计 / 构建 / 验证 / 热载入逐步可见
    this.pipelineEl = this.el('div', '');
    this.pipelineEl.id = 'wish-pipeline';
    body.appendChild(this.pipelineEl);

    // R26 多机位截图验证：8 张真实离屏渲染缩略图 + 通过率，验证后才热载入
    this.verifyEl = this.el('div', '');
    this.verifyEl.id = 'wish-verify';
    body.appendChild(this.verifyEl);

    // R26 WorkBuddy 能力库：14 域 / 40+ 能力 / bridge 如实标注
    this.capsEl = this.el('div', '');
    this.capsEl.id = 'wish-caps';
    body.appendChild(this.capsEl);

    this.listEl = this.el('div', '');
    this.listEl.id = 'wish-list';
    body.appendChild(this.listEl);

    this.hintEl = this.el('div', 'wish-hint');
    body.appendChild(this.hintEl);
    this.refreshHint();
    root.appendChild(body);

    this.settingsEl = this.el('div', '');
    this.settingsEl.id = 'wish-settings';

    this.labelsEl = this.el('div', '');
    this.labelsEl.id = 'wish-labels';

    this.d.uiRoot.appendChild(root);
    this.d.uiRoot.appendChild(this.settingsEl);
    this.d.uiRoot.appendChild(this.labelsEl);
    this.renderList();
  }

  private refreshHint(): void {
    this.hintEl.textContent = `预设 ${WISH_CATALOG.length} 件 · 已开发资产 ${blueprintCount()} 件 · 回车许愿 · 8 机位截图验证 · 吞噬 / 合并 / 进化 · R 旋转 / Enter 放置 / Z 撤销 · 自动存档`;
  }

  // ---- 建造键盘：只在建造模式且焦点不在输入框时生效 ----
  private bindBuildKeys(): void {
    window.addEventListener('keydown', (ev) => {
      if (!this.build.enabled) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (ev.code === 'KeyR') { ev.preventDefault(); this.build.rotate(); this.status(`建造：朝向 ${Math.round(this.build.ry * 180 / Math.PI)}°`, 'ok'); }
      else if (ev.code === 'KeyZ') { ev.preventDefault(); this.undoBuild(); }
      else if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); this.placeSelected(); }
      else if (ev.code === 'Escape') { this.toggleBuild(); }
    });
  }

  // ---- 五大玩法标签：全部改为真实世界行为 ----
  private onTab(name: string): void {
    const tabs = this.root.querySelector('#wish-tabs');
    if (tabs) {
      const btns = Array.from(tabs.querySelectorAll<HTMLElement>('.wish-tab'));
      const idx = ['探索', '战斗', '创造', '进化', '升级'].indexOf(name);
      btns.forEach((b, i) => b.classList.toggle('on', i === idx));
    }
    switch (name) {
      case '探索': {
        this.play.setAllBehavior('follow');
        const n = this.entityMap.size;
        this.status(n
          ? `探索：${n} 件造物开始随行巡游，跨越新地格会自动发现并产出灵力 / 铜钱`
          : '探索：先许愿生成一件造物吧', 'ok');
        break;
      }
      case '战斗': {
        const id = this.spawnHostile();
        this.play.setAllBehavior('guard');
        this.status(id
          ? '战斗：试炼妖兽已落场，造物按 DNA 攻防实时结算；靠近世界 Boss 也会助战'
          : '战斗：造物已达上限', 'ok');
        break;
      }
      case '创造': {
        this.build.enter();
        this.inputEl.focus();
        this.status('创造 / 建造：选中预设或输入名号 → 放置构件，R 旋转、叠层、组合；写愿望回车则直接开发资产', 'ok');
        break;
      }
      case '进化':
        if (this.selected) this.evolve(this.selected);
        else this.status('进化：请先选中造物', 'warn');
        break;
      case '升级':
        if (this.selected) this.upgrade(this.selected);
        else this.status('升级：请先选中造物', 'warn');
        break;
    }
    this.renderList();
  }

  private status(text: string, kind: 'ok' | 'warn' | 'err' | 'busy' = 'ok'): void {
    this.statusEl.textContent = text;
    this.statusEl.className = kind;
  }

  // ---- 配置面板 ----
  private openSettings(): void {
    const s = this.settingsEl;
    s.innerHTML = '';
    const cfg = loadAgentConfig();
    const h = this.el('h4');
    h.textContent = 'Agent 设置（设定 / 资产开发）';
    s.appendChild(h);
    const mk = (label: string, type: string, val: string, key: keyof AgentConfig): void => {
      const r = this.el('div', 'wish-set-row');
      const lab = this.el('label'); lab.textContent = label;
      const inp = this.el('input') as HTMLInputElement;
      inp.type = type; inp.value = val; inp.dataset.k = key;
      r.appendChild(lab); r.appendChild(inp); s.appendChild(r);
    };
    mk('Base URL', 'text', cfg.baseUrl, 'baseUrl');
    mk('API Key', 'password', cfg.apiKey, 'apiKey');
    mk('Model', 'text', cfg.model, 'model');
    const r = this.el('div', 'wish-set-row');
    const lab = this.el('label'); lab.textContent = '启用 L3 代码档';
    const chk = this.el('input') as HTMLInputElement;
    chk.type = 'checkbox'; chk.checked = cfg.enabled;
    r.appendChild(lab); r.appendChild(chk); s.appendChild(r);
    const btns = this.el('div', 'wish-set-btns');
    btns.appendChild(this.btn('保存', 'wish-btn', () => {
      const patch: Record<string, unknown> = {};
      s.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => { patch[i.dataset.k!] = i.value; });
      patch.enabled = chk.checked;
      saveAgentConfig(patch as unknown as Partial<AgentConfig>);
      this.status('Agent 配置已保存（密钥仅存本机，不进存档/日志）', 'ok');
      s.classList.remove('show');
    }));
    btns.appendChild(this.btn('开发资产', 'wish-btn', () => { s.classList.remove('show'); void this.submit(this.inputEl.value || '我要一条神龙'); }));
    btns.appendChild(this.btn('导出资产库', 'wish-btn', () => { this.downloadAssets(); }));
    btns.appendChild(this.btn('关闭', 'wish-btn', () => s.classList.remove('show')));
    s.appendChild(btns);
    const hint = this.el('div', 'wish-hint');
    hint.textContent = '离线可用：未配置 API 时 Agent 在本机完成「意图解析 → 设定撰写 → 几何锻造 → 资产登记 → 热更新载入」全流程；配置后 L3 由模型撰写设定。';
    s.appendChild(hint);
    s.classList.add('show');
  }

  private downloadAssets(): void {
    const raw = exportBlueprints();
    try {
      const blob = new Blob([raw], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cyber-qingming-assets.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.status(`资产库已导出（${blueprintCount()} 件开发资产）`, 'ok');
    } catch { this.status('导出失败（浏览器不支持下载）', 'warn'); }
  }

  // ---- 许愿主链：Agent 开发设定与资产 → 登记 → 热更新落场 ----
  async submit(text?: string): Promise<SubmitResult> {
    const wish = (text ?? this.inputEl.value).trim();
    if (!wish) { this.status('请先写下愿望，例如「我要一条神龙」', 'warn'); return { ok: false, tier: 'none', count: 0, spawned: [] }; }
    this.inputEl.disabled = true;
    this.status('Agent 正在开发设定与资产…', 'busy');
    try {
      const r: ResolveResult = await resolveWish(wish);
      if (!r.ok) {
        this.status('失败：' + (r.reason ?? '愿望越界'), 'err');
        setWishMetrics({
          matched: classifyWish(wish) !== null, reuse: false, count: 0,
          researchBridge: 'offline', researchStatus: 'offline-disabled',
          designUsedResearch: false, shape: 'generic', tier: r.tier,
        });
        return { ok: false, tier: r.tier, count: 0, spawned: [], reason: r.reason };
      }
      // ① R26 能力流水线：先查内置资产 → 命中直接复用；未命中先显示「xxx正在生成。。。。请稍后。」
      //    再按编排调用检索 / 设计 / 建模 / 截图验证 / 热载入所需能力，全过程步骤真实可见。
      const targetName = r.spec.name;
      const entry = r.catalogId ? getById(r.catalogId) ?? undefined : undefined;
      const hit = entry
        ? { id: entry.id, name: entry.name, source: entry.source, lore: entry.lore, traits: entry.traits }
        : null;
      if (!hit) this.status(noticeText(targetName), 'busy');
      const pipeline = await runAssetPipeline(targetName, {
        catalogHit: hit,
        research: (q) => this.onlineResearch(q),
        verify: (sp) => this.verifySpec(sp),
        specFor: (nm, card, design) => this.specFromPipeline(nm, r.spec, card, design),
        onStep: (s) => this.onPipelineStep(s),
      });
      this.lastPipeline = pipeline;
      // 命中内置资产时「直接使用内置资产」：沿用 Agent 已解析的完整预设规格（原型/配色/比例不重推断）；
      // 未命中时才消费流水线 specFor 依据检索与设计文档新产出的规格。
      const finalSpec: WishSpec = pipeline.reused ? r.spec : (pipeline.spec ?? r.spec);
      this.showPipeline(pipeline);

      // ② 开发设定与资产（离线也完整产出设定卡；L3 时并入模型撰写的 lore）
      let bp = developAsset(wish, finalSpec, r.tier === 'refuse' ? 'L2' : r.tier, entry);
      if (r.raw) bp = mergeLlmLore(bp, r.raw);
      if (pipeline.research) bp = this.mergeResearchIntoBlueprint(bp, pipeline.research);
      registerBlueprint(bp);
      this.lastBlueprint = bp;
      this.showLore(bp);

      // ③ 热更新载入到玩家附近：复数愿望用 forgeMany 产出「实体列表」，
      //    在玩家前方按确定性方阵排布（不消耗共享 RNG），真的出现 count>1 个实体。
      const squad: ForgeResult[] = r.count > 1 ? forgeMany(finalSpec, r.count, { stage: '卵' }) : [];
      const spawned: string[] = [];
      for (let i = 0; i < r.count; i++) {
        const nm = r.count > 1 ? `${finalSpec.name}·${i + 1}` : finalSpec.name;
        spawned.push(this.spawnFromSpec(finalSpec, nm, r.tier, r.catalogId, bp.id, {
          preForged: squad[i],
          slot: { index: i, count: r.count },
          reuseValidation: i > 0,
        }));
      }
      const tail = r.degraded ? `（${r.reason}）` : '';
      const vr = this.lastValidation;
      const vmsg = vr && vr.views ? ` · 截图验证 ${vr.passed}/${vr.total}` : ' · 截图验证不可用（已如实标注）';
      this.status(`${doneText(finalSpec.name)} · ${bp.steps[bp.steps.length - 1]} · ${finalSpec.name} ×${r.count} · ${r.tier}${vmsg}${tail}`, 'ok');
      this.inputEl.value = '';
      this.refreshHint();
      this.saveState();

      // ⑧ 可断言统计入口：报告最近一次愿望（window.__wish.panel.wishStats() / window.__wishStats()）
      const card = pipeline.research;
      setWishMetrics({
        matched: pipeline.reused || classifyWish(wish) !== null,
        reuse: pipeline.reused,
        count: r.count,
        researchBridge: card?.bridge ?? 'offline',
        researchStatus: card?.status ?? 'offline-disabled',
        designUsedResearch: !!card && !card.offline && card.status === 'ok' && (card.merged ?? 0) > 0,
        shape: finalSpec.shape ?? 'generic',
        tier: r.tier,
      });
      return {
        ok: true, tier: r.tier, count: r.count, spawned, spec: finalSpec,
        degraded: r.degraded, reason: r.reason, blueprintId: bp.id,
        reused: pipeline.reused,
        pipelineSteps: pipeline.steps.map((s) => `${s.stage}:${s.ok ? 'ok' : 'skip'}`),
        validation: vr && vr.views ? { ok: vr.ok, passed: vr.passed, total: vr.total } : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status('失败：' + msg, 'err');
      setWishMetrics({
        matched: classifyWish(wish) !== null, reuse: false, count: 0,
        researchBridge: 'offline', researchStatus: 'failed',
        designUsedResearch: false, shape: 'generic', tier: 'L2',
      });
      return { ok: false, tier: 'L2', count: 0, spawned: [], reason: msg };
    } finally {
      this.inputEl.disabled = false;
    }
  }
  /** window.__wish.spawn 入口 */
  spawn(text: string): Promise<SubmitResult> { return this.submit(text); }

  /** 只开发设定与资产、不落场（验收 / 资产库复用） */
  async develop(text: string): Promise<AssetBlueprint | null> {
    const r = await resolveWish(text);
    if (!r.ok) return null;
    const entry = r.catalogId ? getById(r.catalogId) ?? undefined : undefined;
    let bp = developAsset(text, r.spec, r.tier === 'refuse' ? 'L2' : r.tier, entry);
    if (r.raw) bp = mergeLlmLore(bp, r.raw);
    registerBlueprint(bp);
    this.lastBlueprint = bp;
    this.showLore(bp);
    this.refreshHint();
    return bp;
  }

  /** 复用预设目录（按 id 直接生成），一句话载入 */
  spawnById(id: string): string | null {
    const e = getById(id);
    if (!e) return null;
    const spec: WishSpec = {
      name: e.name, archetype: e.archetype, traits: [...e.traits], colors: [...e.colors],
      scale: e.scale, seed: this.hash(e.id), source: 'preset',
    };
    const bp = developAsset(e.name, spec, 'L1', e);
    registerBlueprint(bp);
    this.lastBlueprint = bp;
    this.showLore(bp);
    return this.spawnFromSpec(spec, e.name, 'L1', e.id, bp.id);
  }

  /** 一句话载入任意预设名号（不必知道 id） */
  spawnByName(name: string): string | null {
    const e = matchCatalog(name) ?? searchByName(name);
    return e ? this.spawnById(e.id) : null;
  }

  private spawnFromSpec(
    spec: WishSpec, name: string, tier: string, catalogId?: string, blueprintId?: string,
    opts: { preForged?: ForgeResult; slot?: { index: number; count: number }; reuseValidation?: boolean } = {},
  ): string {
    // 新造物从「卵」孵化，五阶各有独立几何（不是只缩放）；复数方阵用 forgeMany 预造的实体
    const forged = opts.preForged ?? forge(spec, { stage: '卵' });
    // R26：构建完成后先做多角度 / 多高低 / 多距离离屏截图验证，再热载入到玩家附近。
    // 复数方阵只验证首件（其余复用同一报告），8 机位验证机制不回退、且避免 N×8 次离屏渲染。
    const report = opts.reuseValidation
      ? this.lastValidation
      : (this.d.renderer ? validateAsset(forged.group, this.d.renderer) : null);
    if (!opts.reuseValidation) this.lastValidation = report;
    this.showValidation(report, name);
    const idx = this.seq;
    // 落点：单件沿用旧逻辑；复数愿望按整数行列铺成确定性方阵（无随机数、不碰共享 RNG），
    // 多个实体真的分散出现在玩家附近，而不是重叠在同一坐标。
    let drop: { x: number; y: number; z: number };
    if (opts.slot && opts.slot.count > 1) {
      const cols = Math.ceil(Math.sqrt(opts.slot.count));
      const col = opts.slot.index % cols;
      const row = Math.floor(opts.slot.index / cols);
      drop = this.d.dropPoint(6 + row * 2.2, (col - (cols - 1) / 2) * 2.2);
    } else {
      drop = this.d.dropPoint(6 + (idx % 3) * 2, (idx % 2 ? 1 : -1) * 2.2);
    }
    return this.addEntity(spec, name, tier, catalogId, forged, null, { x: drop.x, y: drop.y + 1.6, z: drop.z }, { blueprintId });
  }

  /** 把 8 机位真实截图铺进面板（不是一句「验证通过」的假日志） */
  private showValidation(report: ValidationReport | null, name: string): void {
    this.verifyEl.innerHTML = '';
    if (!report || !report.views) {
      const p = this.el('div', 'verify-note');
      p.textContent = report
        ? `「${name}」多机位验证不可用：${report.note}（如实标注，未伪造通过）`
        : `「${name}」多机位验证：当前环境无 WebGL renderer，如实标注不可用`;
      this.verifyEl.appendChild(p);
      return;
    }
    const head = this.el('div', 'verify-head');
    head.textContent = `「${name}」8 机位截图验证 ${report.passed}/${report.total} 通过 · 包围盒 ${report.bounds.x}×${report.bounds.y}×${report.bounds.z} · ${report.ok ? '准予热载入' : '部分机位待复查'}`;
    this.verifyEl.appendChild(head);
    const grid = this.el('div', 'verify-grid');
    for (const v of report.details) {
      const cell = this.el('div', 'verify-cell' + (v.pass ? ' ok' : ' bad'));
      if (v.shot) {
        const img = this.el('img');
        img.src = v.shot;
        img.alt = v.label;
        img.title = `${v.label} · 覆盖 ${(v.coverage * 100).toFixed(1)}% · ${v.colorBuckets} 色`;
        cell.appendChild(img);
      }
      const cap = this.el('small');
      cap.textContent = `${v.label} ${v.pass ? '✓' : '✗'} ${(v.coverage * 100).toFixed(1)}%`;
      cell.appendChild(cap);
      grid.appendChild(cell);
    }
    this.verifyEl.appendChild(grid);
  }

  /** 验收句柄：最近一次 8 机位验证报告（含 8 张 PNG dataURL） */
  validation(): ValidationReport | null { return this.lastValidation; }
  devourCount(): number {
    return Array.from(this.entityMap.values()).reduce((n, e) => n + (e.ev.devoured ?? 0), 0);
  }
  blueprintSummary(): AssetBlueprint | null { return this.lastBlueprint; }
  lastDevourResult(): DevourResult | null { return this.lastDevour; }
  pipeline(): PipelineResult | null { return this.lastPipeline; }

  /** 可断言统计入口：window.__wish.panel.wishStats()（等价 window.__wishStats()） */
  wishStats(): WishMetrics { return lastWishMetrics(); }
  /** 运行期配置真联网检索：window.__wish.panel.configureResearch({enabled,endpoint,apiKey,provider}) */
  configureResearch(patch: Partial<ResearchConfig>): ResearchConfig { return saveResearchConfig(patch); }
  /** 读取检索配置（密钥脱敏，不回显） */
  researchConfig(): ResearchConfig {
    const c = loadResearchConfig();
    return { ...c, apiKey: c.apiKey ? '****' : '' };
  }

  /** 流水线每一步都实时回显到状态栏与面板，不是一句「正在生成」的空话 */
  private onPipelineStep(s: PipelineStep): void {
    this.status(`${s.label} · ${s.detail}`, s.ok ? 'ok' : 'busy');
    const line = this.el('div', 'pipe-step ' + (s.ok ? 'done' : 'skipped'));
    line.textContent = `[${s.stage}${s.ok ? ' ✓' : ' ！'}] ${s.label} — ${s.detail}`;
    this.pipelineEl.appendChild(line);
    if (this.pipelineEl.childElementCount > 24) this.pipelineEl.firstElementChild?.remove();
  }

  /** 把检索到的 20+ 维资料 / 详细设计 / 截图验证结论铺成可见卡片 */
  private showPipeline(p: PipelineResult): void {
    this.pipelineEl.innerHTML = '';
    const head = this.el('div', 'pipe-head');
    head.textContent = p.reused
      ? `内置资产命中：${p.name} 直接复用（跳过重新检索与建模）`
      : `Agent 资产流水线：${p.name} · ${p.steps.length} 步 · ${p.capabilities.length} 项能力编排 · ${p.ok ? '准予热载入' : '部分步骤降级'}`;
    this.pipelineEl.appendChild(head);
    if (p.notice) {
      const n = this.el('div', 'pipe-step running');
      n.textContent = p.notice;
      this.pipelineEl.appendChild(n);
    }
    for (const s of p.steps) {
      const line = this.el('div', 'pipe-step ' + (s.ok ? 'done' : 'skipped'));
      line.textContent = `[${s.stage}${s.ok ? ' ✓' : ' ！'}] ${s.label} — ${s.detail}`;
      this.pipelineEl.appendChild(line);
    }
    // 命中内置资产时「直接使用」，不展示重新检索/设计的资料卡，避免语义混淆
    if (!p.reused) {
    const card = p.research ?? offlineResearch(p.name);
    const groups: [string, string[]][] = [
      ['出典 / 来源', [card.origin]],
      ['尺寸 / 形态 / 结构', [card.dimensions, card.form, card.structure]],
      ['特征 / 能力 / 特性', [...card.features, ...card.abilities]],
      ['功能 / 用途', [...card.functions, ...card.uses]],
      ['与其他资产的关系 / 关联', card.relations],
      ['战斗 / 合成 / 使用 / 吞噬 / 进化 / 升级 / 创造 / 建造', [
        `战斗 ${card.combat ? '可' : '否'}`, `合成 ${card.crafting ? '可' : '否'}`,
        `使用 ${card.usable ? '可' : '否'}`, `吞噬 ${card.devourable ? '可' : '否'}`,
        `进化 ${card.evolve ? '可' : '否'}`, `升级 ${card.upgrade ? '可' : '否'}`,
        `创造 ${card.creation ? '可' : '否'}`, `建造 ${card.building ? '可' : '否'}`,
      ]],
      ['对世界的影响 / 与周围角色关系 / 后果', [card.worldImpact, card.npcRelations, card.consequences]],
      ['图片 / 视频 / 典籍参考', [...card.imageRefs, ...card.videoRefs, ...card.sources]],
    ];
    const box = this.el('div', 'pipe-research');
    const h = this.el('div', 'pipe-head');
    h.textContent = `检索与设计：${card.name} · bridge=${card.bridge} · status=${card.status}`
      + `${card.error ? ' · 原因：' + card.error.slice(0, 80) : ''}`
      + `${card.offline ? '（离线知识库，未冒充联网）' : `（真实 HTTP 检索 · provider=${card.provider} · 命中 ${card.resultCount} 条 · 采用 ${card.merged} 字段）`}`
      + ` · 资料 ${groups.reduce((n, g) => n + g[1].filter(Boolean).length, 0)} 条`;
    box.appendChild(h);
    if (p.design) {
      const d = this.el('div', 'pipe-row');
      const b = this.el('b'); b.textContent = '详细设计：';
      const span = this.el('span');
      span.textContent = escapeHtml(`${p.design.archetype} / ${p.design.silhouette} / 部件 ${p.design.parts.length} 项 / ${p.design.palette.length} 色 / ${p.design.motif} / 预算 ${p.design.budget} tri`);
      d.appendChild(b); d.appendChild(span); box.appendChild(d);
    }
    for (const [title, items] of groups) {
      const clean = items.filter((x) => x && String(x).trim());
      if (!clean.length) continue;
      const row = this.el('div', 'pipe-row');
      const b = this.el('b'); b.textContent = title + '：';
      const span = this.el('span'); span.textContent = escapeHtml(clean.join(' / '));
      row.appendChild(b); row.appendChild(span);
      box.appendChild(row);
    }
    this.pipelineEl.appendChild(box);
    } else {
      const reuse = this.el('div', 'pipe-row');
      const rb = this.el('b'); rb.textContent = '复用内置资产：';
      const rs = this.el('span');
      rs.textContent = '已存在同名预设，直接沿用其原型 / 配色 / 比例与设定，不重新联网检索、不重新设计、不重新建模。';
      reuse.appendChild(rb); reuse.appendChild(rs);
      this.pipelineEl.appendChild(reuse);
    }
    const vr = this.el('div', 'pipe-step ' + (this.lastValidation?.ok ? 'done' : 'skipped'));
    vr.textContent = `截图验证：${p.verifyNote || '（复用内置资产，未触发重新验证）'}`;
    this.pipelineEl.appendChild(vr);
    if (p.capabilities.length) {
      const cap = this.el('div', 'pipe-caps');
      cap.textContent = '编排能力：' + escapeHtml(p.capabilities.join(' · '));
      this.pipelineEl.appendChild(cap);
    }
    const done = this.el('div', 'pipe-head');
    done.textContent = p.doneNotice;
    this.pipelineEl.appendChild(done);
  }

  /** R26：把检索资料并入设定卡（steps 仍保持 5 步，不破坏 R25 验收契约） */
  private mergeResearchIntoBlueprint(bp: AssetBlueprint, card: NonNullable<PipelineResult['research']>): AssetBlueprint {
    const lore = { ...bp.lore };
    lore.appearance = `${lore.appearance} ${card.form}`.trim();
    lore.powers = Array.from(new Set([...lore.powers, ...card.abilities.slice(0, 2)])).slice(0, 6);
    lore.backstory = `${lore.backstory} ${card.consequences}`.trim();
    if (!lore.habitat) lore.habitat = card.worldImpact;
    if (!lore.origin) lore.origin = card.origin;
    const traits = Array.from(new Set([...bp.spec.traits, ...card.features.slice(0, 3)])).slice(0, 8);
    return { ...bp, lore, spec: { ...bp.spec, traits } };
  }

  /**
   * 注入流水线的「真联网检索」：wishResearch.performResearch 用真实 fetch 请求搜索 API /
   * 公开参考页，解析标题/摘要/URL/图片视频并按白名单填 ResearchCard。
   * 默认关闭 → bridge=offline、status=disabled；失败/CORS → status=failed/cors + error。
   * 不再是旧版「拼 /chat/completions 让模型编 JSON」的假联网。
   */
  private async onlineResearch(query: string): Promise<unknown> {
    return performResearch(query);
  }

  /** 注入流水线 verify 步骤：真实 8 机位离屏渲染 + 读回像素，临时几何用完即 dispose */
  private async verifySpec(spec: WishSpec): Promise<VerifyResult> {
    if (!this.d.renderer) {
      this.lastValidation = null;
      return { ok: true, shots: [], views: 0, note: '当前环境无 WebGL renderer，如实标注未做截图验证（未伪造通过）' };
    }
    const forged = forge(spec, { stage: '卵' });
    const report = validateAsset(forged.group, this.d.renderer);
    this.lastValidation = report;
    forged.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    return {
      // 渲染不可用时如实标注且不阻断；渲染成功则必须 ≥6/8 机位通过
      ok: report.views === 0 ? true : report.ok,
      shots: report.shots, views: report.views,
      note: `${report.note}；包围盒 ${report.bounds.x}×${report.bounds.y}×${report.bounds.z}`,
    };
  }

  /**
   * 注入流水线 specFor：design→build 链路真的读 ResearchCard，并让资料影响生成参数：
   *   · 尺寸 card.dimensions（联网成功时）→ scale
   *   · 配色 card.palette / design.palette → colors
   *   · 能力标签 card.abilities / card.features → traits
   *   · 形态 design.shape → WishSpec.shape → forge 专用建模
   * 缺失字段（'未检索到'）一律过滤，不写进生成参数，绝不编造。
   */
  private specFromPipeline(name: string, base: WishSpec, card: ResearchCard | null, design: DesignDoc): WishSpec {
    const wc = classifyWish(name);
    const arch = (ARCHETYPES as readonly string[]).includes(design.archetype) ? design.archetype : base.archetype;
    let scale = base.scale;
    if (card && !card.offline && card.status === 'ok') {
      const m = card.dimensions.match(/(\d+(?:\.\d+)?)\s*(?:米|m(?!\w)|cm|厘米)/i);
      if (m) {
        const meters = parseFloat(m[1]);
        if (Number.isFinite(meters) && meters > 0) {
          scale = Math.max(0.3, Math.min(3, Math.round(meters / 4 * 100) / 100));
        }
      }
    }
    const clean = (xs: string[] | undefined): string[] =>
      (xs ?? []).filter((x) => x && x !== '未检索到');
    const abilityTags = clean(card?.abilities).slice(0, 2);
    return {
      ...base,
      name,
      archetype: arch as WishSpec['archetype'],
      shape: design.shape ?? wc?.shape ?? base.shape,
      traits: Array.from(new Set([
        ...base.traits, ...clean(card?.features).slice(0, 3), ...abilityTags,
      ])).slice(0, 8),
      colors: card?.palette?.length ? card.palette.slice(0, 4)
        : (design.palette.length ? design.palette.slice(0, 4) : base.colors),
      scale,
      seed: this.hash(name + (card?.origin ?? '')),
      source: 'param',
    };
  }

  /** WorkBuddy 全部相关能力：14 域分组、bridge 如实标注、可查可核 */
  private showCapabilities(): void {
    if (this.capsEl.classList.toggle('show')) {
      const st = capabilityStats();
      this.capsEl.innerHTML = '';
      const head = this.el('div', 'caps-head');
      head.textContent = `WorkBuddy 能力库 · 共 ${st.total} 项 · 游戏内 ${st.byBridge['in-browser'] ?? 0} / 外部 API ${st.byBridge['api'] ?? 0} / 本机契约 ${st.byBridge['offline'] ?? 0}`;
      this.capsEl.appendChild(head);
      const note = this.el('div', 'caps-note');
      note.textContent = 'bridge 如实标注：in-browser 为游戏内可实调用；api 需 Agent 设置里配置外部接口；offline 为本机 skill / harness / MCP / CLI 的能力描述与编排契约——浏览器静态包不能直接执行本机进程，绝不冒充已调通。';
      this.capsEl.appendChild(note);
      for (const [domain, n] of Object.entries(st.byDomain)) {
        const det = this.el('details');
        const sum = this.el('summary');
        sum.textContent = `${escapeHtml(domain)} · ${n} 项`;
        det.appendChild(sum);
        for (const c of AGENT_CAPABILITIES.filter((x) => x.domain === domain)) {
          const row = this.el('div', 'cap-row ' + c.bridge);
          const tag = this.el('span', 'cap-bridge');
          tag.textContent = c.bridge;
          const name = this.el('b'); name.textContent = c.name;
          const desc = this.el('small'); desc.textContent = c.desc;
          row.appendChild(tag); row.appendChild(name); row.appendChild(desc);
          det.appendChild(row);
        }
        this.capsEl.appendChild(det);
      }
      const plan = planCapabilities('构建一件新的中国神话游戏资产');
      const p = this.el('div', 'caps-plan');
      p.textContent = `本次构建默认编排 ${plan.length} 项能力：${plan.map((c) => c.id).join(' → ')}`;
      this.capsEl.appendChild(p);
    }
  }

  private addEntity(
    spec: WishSpec, name: string, tier: string, catalogId: string | undefined,
    forged: ForgeResult, ev: Evolvable | null, pos: { x: number; y: number; z: number },
    opts: { blueprintId?: string; behavior?: Behavior; hostile?: boolean; buildPartId?: string; evOverride?: Evolvable } = {},
  ): string {
    const idx = this.seq++;
    const id = `wish-${idx}-${this.hash(name + idx)}`;
    const entityEv = opts.evOverride ?? ev ?? createEvolvable(id, name, spec.seed);
    forged.group.position.set(pos.x, pos.y, pos.z);
    forged.group.rotation.y = (idx * 0.7) % (Math.PI * 2);
    forged.group.scale.setScalar(entityEv.form.scale);
    this.d.scene.add(forged.group);

    const label = this.el('div', 'wish-label');
    label.textContent = `${name} · ${entityEv.stage}`;
    label.onclick = () => { this.select(id); this.interact(id, '互动'); };
    this.labelsEl.appendChild(label);

    // R25 落场标记：地面金环 + 柔光柱。开场是高空俯瞰运镜，卵体本身很小，
    // 没有这个标记就读不出「有东西热更新出现在玩家附近」。halo 独立于 forge group，
    // applyForm 换整件几何时不会被丢掉。
    const halo = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.15, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 7, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    beam.position.y = 3.5;
    halo.add(ring, beam);
    halo.position.set(pos.x, pos.y - 1.3, pos.z);
    this.d.scene.add(halo);

    const behavior: Behavior = opts.behavior ?? (opts.buildPartId ? 'guard' : 'follow');
    const actor = createPlayActor(id, name, forged.group, entityEv, pos, behavior, !!opts.hostile);
    this.play.add(actor);

    const e: WishEntity = {
      id, name, spec, group: forged.group, label, ev: entityEv,
      baseY: pos.y, phase: idx * 1.3, speed: 0.6 + (idx % 5) * 0.12,
      tier, catalogId, pos: { x: pos.x, y: pos.y, z: pos.z },
      play: actor, blueprintId: opts.blueprintId, buildPartId: opts.buildPartId, hostile: !!opts.hostile, halo,
    };
    this.entityMap.set(id, e);
    if (!this.selected) this.selected = id;
    this.renderList();
    this.saveState();
    return id;
  }

  private removeEntity(id: string): void {
    const e = this.entityMap.get(id);
    if (!e) return;
    this.d.scene.remove(e.group);
    e.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    e.label.remove();
    if (e.halo) {
      this.d.scene.remove(e.halo);
      e.halo.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
    }
    this.play.remove(id);
    this.entityMap.delete(id);
    if (this.selected === id) {
      const k = this.entityMap.keys().next();
      this.selected = k.done ? null : k.value;
    }
    this.saveState();
  }

  // ---- 每帧 tick：真实世界循环 + 浮标投影 ----
  tick(dt: number): void {
    const d = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    this.t += d;

    // ① 探索 / 战斗 / 骑乘（wishPlay），奖励经 onXp 回灌 DNA 并可能自动进化
    const dead = this.play.tick(d, (id, n) => this.gainXp(id, n));
    for (const id of dead) this.removeEntity(id);

    // ② 把最近一条世界事件显示到状态区（节流，避免每帧刷 DOM）
    if (this.events.length && this.t - this.lastEventAt > 0.45) {
      const ev = this.events[this.events.length - 1];
      if (ev) this.status(ev.text, ev.kind === 'kill' ? 'ok' : 'busy');
      this.lastEventAt = this.t;
    }

    // ③ 造物移动后，把 E 键交互点登记到既有 InteractSystem（pos 用 Vector3 引用，随造物移动）
    const I = (this.world as unknown as { interact?: { add?: (p: THREE.Vector3, r: number, label: string, fn: () => void) => void } } | null)?.interact;
    if (I && typeof I.add === 'function') {
      for (const e of this.entityMap.values()) {
        if (e.registered) continue;
        I.add(e.group.position, 3.4, `与 ${e.name} 互动`, () => { this.select(e.id); this.interact(e.id, '互动'); });
        e.registered = true;
      }
    }

    // ④ 同步实体位姿与浮标
    const cam = this.d.camera;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    for (const e of this.entityMap.values()) {
      if (e.play) {
        e.pos.x = e.play.pos.x; e.pos.z = e.play.pos.z; e.pos.y = e.group.position.y;
        e.group.rotation.z = (e.spec.archetype === 'bird' || e.spec.archetype === 'dragon')
          ? Math.sin(this.t * 1.4 + e.phase) * 0.08 : 0;
      }
      if (e.halo) e.halo.position.set(e.group.position.x, e.group.position.y - 1.3, e.group.position.z);
      this.proj.set(e.group.position.x, e.group.position.y + 2.2 + e.group.scale.x * 2, e.group.position.z);
      this.proj.project(cam);
      if (this.proj.z < -1 || this.proj.z > 1 || Math.abs(this.proj.x) > 1.1 || Math.abs(this.proj.y) > 1.1) {
        e.label.style.display = 'none';
      } else {
        e.label.style.display = 'block';
        e.label.style.left = ((this.proj.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        e.label.style.top = ((-this.proj.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      }
    }

    // ⑤ 建造模式：光标预览（吸附网格）
    if (this.build.enabled) this.updatePreview();
    else if (this.preview) { this.d.scene.remove(this.preview); this.preview.geometry.dispose(); this.preview = null; }
  }

  private updatePreview(): void {
    const p = this.d.dropPoint(9, 0);
    const q = this.build.previewPoint(p.x, p.y + 0.1, p.z);
    if (!this.preview) {
      const geo = new THREE.BoxGeometry(4, 0.3, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd25e, wireframe: true, transparent: true, opacity: 0.75, depthWrite: false });
      this.preview = new THREE.Mesh(geo, mat);
      this.d.scene.add(this.preview);
    }
    this.preview.position.set(q.x, q.y, q.z);
    this.preview.rotation.y = this.build.ry;
  }

  // ---- 设定卡 ----
  private showLore(bp: AssetBlueprint): void {
    this.loreEl.innerHTML = loreCardHtml(bp);
    this.loreEl.classList.add('show');
  }
  private showLastLore(): void {
    if (this.lastBlueprint) this.showLore(this.lastBlueprint);
    else this.status('尚无设定卡，先许愿让 Agent 开发一件资产', 'warn');
  }
  /** window.__wish.card(name) 用 */
  cardHtml(name?: string): string {
    const bp = name ? findBlueprintByName(name) : this.lastBlueprint;
    return bp ? loreCardHtml(bp) : '';
  }

  // ---- 建造 ----
  toggleBuild(): boolean {
    const on = this.build.toggle();
    this.buildBarEl.classList.toggle('on', on);
    this.status(on ? '建造模式：Enter/空格放置、R 旋转、Z 撤销、叠层可搭高、组合可合体' : '已退出建造模式', 'ok');
    return on;
  }

  /** 放置当前选中的预设 / 输入名号 / 选中造物对应的资产 */
  placeSelected(): string | null {
    let spec: WishSpec | null = null;
    let catalogId: string | undefined;
    const typed = this.inputEl.value.trim();
    const cat = typed ? matchCatalog(typed) ?? searchByName(typed) : null;
    if (cat) {
      catalogId = cat.id;
      spec = { name: cat.name, archetype: cat.archetype, traits: [...cat.traits], colors: [...cat.colors], scale: cat.scale, seed: this.hash(cat.id), source: 'preset' };
    } else if (this.selected) {
      const e = this.entityMap.get(this.selected);
      if (e) spec = { ...e.spec };
    }
    if (!spec) { this.status('建造：先输入一个预设名号，或选中一件造物', 'warn'); return null; }
    const p = this.d.dropPoint(9, 0);
    const part = this.build.place(spec, p.x, p.y + 0.2, p.z, catalogId);
    if (!part) { this.status('建造：构件已达上限 400', 'warn'); return null; }
    const forged = forge(spec, { stage: '成体' });
    const pos = { x: part.x, y: part.y + 1.2, z: part.z };
    const id = this.addEntity(spec, `${spec.name}·构件`, '建造', catalogId, forged, null, pos, { behavior: 'guard', buildPartId: part.id });
    const e = this.entityMap.get(id);
    if (e) { e.group.rotation.y = part.ry; e.group.scale.setScalar(part.scale); }
    this.status(`建造：${spec.name} 落在 (${part.x}, ${part.z}) 第 ${part.stack + 1} 层 · 共 ${this.build.parts.length} 件构件`, 'ok');
    this.refreshHint();
    return id;
  }

  undoBuild(): void {
    const parts = this.build.undo();
    const keep = new Set(parts.map((p) => p.id));
    for (const e of Array.from(this.entityMap.values())) {
      if (e.buildPartId && !keep.has(e.buildPartId)) this.removeEntity(e.id);
    }
    this.status(`建造：已撤销，剩余 ${parts.length} 件构件`, 'ok');
  }

  clearBuild(): void {
    this.build.clear();
    for (const e of Array.from(this.entityMap.values())) if (e.buildPartId) this.removeEntity(e.id);
    this.status('建造：构件已清空（造物保留）', 'ok');
  }

  /** 组合：把 >=2 件构件合成一件新资产（我的世界式合并） */
  combineBuild(): string | null {
    const ids = this.build.parts.slice(-8).map((p) => p.id);
    const spec = this.build.combine(ids);
    if (!spec) { this.status('组合：至少需要 2 件构件', 'warn'); return null; }
    this.build.removeParts(ids);
    for (const e of Array.from(this.entityMap.values())) if (e.buildPartId && ids.includes(e.buildPartId)) this.removeEntity(e.id);
    const forged = forge(spec, { stage: '成体' });
    const p = this.d.dropPoint(11, 0);
    const id = this.addEntity(spec, spec.name, '组合', undefined, forged, null, { x: p.x, y: p.y + 1.6, z: p.z }, { behavior: 'follow' });
    this.status(`组合成功：${ids.length} 件构件 → 「${spec.name}」`, 'ok');
    return id;
  }

  // ---- 列表渲染 ----
  private renderList(): void {
    this.listEl.innerHTML = '';
    if (!this.entityMap.size) {
      const empty = this.el('div', 'wish-empty');
      empty.textContent = '尚无造物。试试「我要一条神龙」。';
      this.listEl.appendChild(empty);
      return;
    }
    const verbs: [string, string][] = [
      ['召唤', '召唤'], ['骑乘', '骑乘'], ['喂食', '喂食'], ['战斗', '战斗'],
      ['孵化', '孵化'], ['进化', '进化'], ['升级', '升级'], ['合并', '合并'], ['吞噬', '吞噬'], ['互动', '互动'],
    ];
    for (const e of this.entityMap.values()) {
      const row = this.el('div', 'wish-row' + (e.id === this.selected ? ' on' : ''));
      const info = this.el('div', 'wish-info');
      const b = this.el('b'); b.textContent = e.name;
      const small = this.el('small');
      const hp = e.play ? ` · HP ${Math.max(0, Math.round(e.play.hp))}/${e.play.maxHp}` : '';
      small.textContent = `${e.tier} · ${e.ev.stage} · Lv${e.ev.level} · XP ${e.ev.xp} · ${lineageOf(e.ev)} · 吞噬 ${e.ev.devoured ?? 0}${hp} · ${e.play?.behavior ?? 'follow'}`;
      info.appendChild(b); info.appendChild(small);
      info.onclick = () => this.select(e.id);
      row.appendChild(info);
      const ops = this.el('div', 'wish-ops');
      for (const [lab, v] of verbs) {
        ops.appendChild(this.btn(lab, 'wish-btn', (ev) => { ev.stopPropagation(); this.interact(e.id, v); }));
      }
      row.appendChild(ops);
      this.listEl.appendChild(row);
    }
  }

  select(id: string): void { if (this.entityMap.has(id)) { this.selected = id; this.renderList(); } }

  /** 阶位 / 演变分支变化要换整件几何，并把 play actor 的 group 引用同步过去 */
  private applyForm(e: WishEntity): void {
    const old = e.group;
    const pos = old.position.clone();
    const rot = old.rotation.clone();
    this.d.scene.remove(old);
    old.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    const forged: ForgeResult = forge(e.spec, { stage: e.ev.stage, form: e.ev.form });
    forged.group.position.copy(pos);
    forged.group.rotation.copy(rot);
    forged.group.scale.setScalar(e.ev.form.scale);
    this.d.scene.add(forged.group);
    e.group = forged.group;
    if (e.play) e.play.group = forged.group;   // R25：世界循环继续驱动新几何
  }
  private updateLabel(e: WishEntity): void { e.label.textContent = `${e.name} · ${e.ev.stage} · Lv${e.ev.level}`; }
  private moveToPlayer(e: WishEntity, forward: number): void {
    const d = this.d.dropPoint(forward, 0);
    e.group.position.set(d.x, d.y + 1.6, d.z);
    e.baseY = d.y + 1.6;
    e.pos = { x: d.x, y: e.baseY, z: d.z };
    if (e.play) {
      e.play.pos = { x: d.x, y: e.baseY, z: d.z };
      e.play.baseY = e.baseY;
      e.play.home = { x: d.x, z: d.z };
      e.play.cells.clear();
      e.play.lastCell = `${Math.floor(d.x / 46)}:${Math.floor(d.z / 46)}`;
    }
  }

  /** 生成敌对试炼妖兽（战斗玩法真实开打） */
  spawnHostile(): string | null {
    if (this.entityMap.size > 60) return null;
    const spec = WishPlay.hostileSpec(`试炼妖兽·${this.seq % 97}`);
    const forged = forge(spec, { stage: '成体' });
    const p = this.d.dropPoint(16, 4);
    return this.addEntity(spec, spec.name, '试炼', undefined, forged, null,
      { x: p.x, y: p.y + 1.6, z: p.z }, { behavior: 'guard', hostile: true });
  }

  // ---- 互动 / 五大玩法接线 ----
  interact(id: string, verb: string): void {
    const e = this.entityMap.get(id);
    if (!e) { this.status('造物不存在', 'warn'); return; }
    switch (verb) {
      case '喂食': this.gainXp(id, 15); this.status(`喂食 ${e.name}：灵力 +15`, 'ok'); break;
      case '战斗': {
        const h = this.spawnHostile();
        this.status(h ? `战斗：${e.name} 迎战试炼妖兽，攻防实时结算` : '战斗：造物已达上限', 'ok');
        break;
      }
      case '骑乘': {
        this.play.setBehavior(id, 'ride');
        this.status(`骑乘中：${e.name} 每帧贴随玩家，WASD 移动时它真的跟着走`, 'ok');
        break;
      }
      case '召唤': {
        this.play.setBehavior(id, 'follow');
        this.moveToPlayer(e, 6);
        this.status(`已召唤 ${e.name} 随行`, 'ok');
        break;
      }
      case '孵化': {
        // 孢子式起点是「卵」；一键孵化到成体，让「我要一条神龙」立刻看得见一条龙。
        const before = e.ev.stage;
        this.gainXp(id, 320);
        this.status(before === '卵'
          ? `孵化：${e.name} 破卵而出，已由「卵」演变为「${e.ev.stage}」`
          : `${e.name} 已是「${e.ev.stage}」，无需再孵化`, 'ok');
        break;
      }
      case '进化': this.evolve(id); break;
      case '升级': this.upgrade(id); break;
      case '合并': this.mergeWithSelected(id); break;
      case '吞噬': this.devourWithSelected(id); break;
      case '互动':
      default: {
        const bp = findBlueprintByName(e.name) ?? (e.blueprintId ? listBlueprints().find((b) => b.id === e.blueprintId) : null);
        if (bp) this.showLore(bp);
        this.status(`${e.name}：${e.ev.stage} · ${lineageOf(e.ev)}「${lineageDesc(e.ev)}」 · 能力「${e.ev.abilities.join('、')}」 · HP ${e.play ? Math.round(e.play.hp) : '-'}`, 'ok');
        break;
      }
    }
    this.renderList();
  }

  gainXp(id: string, amount: number): void {
    const e = this.entityMap.get(id);
    if (!e) return;
    gainXpFn(e.ev, amount);
    const r = evolveFn(e.ev);
    if (r.changed) { this.applyForm(e); this.status(`${e.name} 演变：${r.from} → ${r.to} · ${lineageOf(e.ev)}`, 'ok'); }
    this.updateLabel(e);
    this.saveState();
  }
  evolve(id: string): void {
    const e = this.entityMap.get(id);
    if (!e) return;
    const r = evolveFn(e.ev);
    if (r.changed) {
      this.applyForm(e); this.updateLabel(e);
      this.status(`${e.name} 进阶：${r.from} → ${r.to} · 分支「${lineageOf(e.ev)}」：${lineageDesc(e.ev)}（第 ${STAGES.indexOf(r.to) + 1} 阶）`, 'ok');
    } else {
      this.status(`${e.name} 灵力不足，尚未到下一阶（当前 ${e.ev.stage}，XP ${e.ev.xp}）`, 'warn');
    }
    this.renderList();
    this.saveState();
  }
  upgrade(id: string): void {
    const e = this.entityMap.get(id);
    if (!e) return;
    const r = upgradeFn(e.ev);
    this.status(r.ok ? `${e.name} 升级成功：最弱维度 +8（消耗 60 灵力）` : `升级失败：${r.reason}`, r.ok ? 'ok' : 'warn');
    this.renderList();
    this.saveState();
  }

  private mergeWithSelected(id: string): void {
    const other = (this.selected && this.selected !== id)
      ? this.selected
      : (Array.from(this.entityMap.keys()).find((k) => k !== id) ?? null);
    if (!other) { this.status('合并需要至少两件不同的造物', 'warn'); return; }
    const nid = this.merge(other, id);
    if (nid) this.status(`融合成功：新造物「${this.entityMap.get(nid)?.name ?? ''}」降世`, 'ok');
  }

  /** 两实体 DNA 混合产出新造物：移除旧两件 + 在中点生成新几何 */
  merge(aId: string, bId: string): string | null {
    const a = this.entityMap.get(aId), b = this.entityMap.get(bId);
    if (!a || !b || aId === bId) { this.status('合并需要两个不同的造物', 'warn'); return null; }
    const child = mergeFn(a.ev, b.ev);
    const spec: WishSpec = {
      name: child.name,
      archetype: a.spec.archetype,
      traits: Array.from(new Set([...a.spec.traits, ...b.spec.traits])).slice(0, 8),
      colors: Array.from(new Set([...a.spec.colors, ...b.spec.colors])).slice(0, 4),
      scale: Math.round((a.spec.scale + b.spec.scale) / 2 * 100) / 100,
      seed: (a.spec.seed ^ b.spec.seed) >>> 0,
      source: 'param',
    };
    const forged = forge(spec, { stage: child.stage, form: child.form });
    const pos = {
      x: (a.pos.x + b.pos.x) / 2,
      y: (a.group.position.y + b.group.position.y) / 2,
      z: (a.pos.z + b.pos.z) / 2,
    };
    this.removeEntity(aId);
    this.removeEntity(bId);
    const nid = this.addEntity(spec, child.name, '融合', undefined, forged, child, pos);
    this.selected = nid;
    this.renderList();
    return nid;
  }

  /** 吞噬：点击行为捕食者，当前选中的另一件（或任意另一件）为猎物 */
  private devourWithSelected(id: string): void {
    const prey = (this.selected && this.selected !== id)
      ? this.selected
      : (Array.from(this.entityMap.keys()).find((k) => k !== id) ?? null);
    if (!prey) { this.status('吞噬需要至少两件不同的造物（先选中猎物）', 'warn'); return; }
    const r = this.devour(id, prey);
    if (!r?.ok) this.status(`吞噬失败：${r?.reason ?? '未知原因'}`, 'warn');
  }

  /**
   * R26 真正的吞噬：改写 DNA / 五行 / 能力 / 外形 → 重锻捕食者几何并同步世界循环
   * actor，然后把猎物（含 halo / play actor / 浮标）从场景里彻底移除。
   * 这与 merge 的对等融合不同，是单向的孢子式弱肉强食。
   */
  devour(predatorId: string, preyId: string): DevourResult | null {
    const pred = this.entityMap.get(predatorId), prey = this.entityMap.get(preyId);
    if (!pred || !prey || predatorId === preyId) {
      return { ev: pred?.ev ?? ({} as Evolvable), ok: false, reason: '吞噬需要两个不同的造物' };
    }
    const r = devourFn(pred.ev, prey.ev);
    if (!r.ok) { this.renderList(); return r; }
    this.lastDevour = r;
    const a = r.absorbed!;
    // 五行 / extraLimbs / scale 都变了，forge 会产出真的不同形态
    this.applyForm(pred);
    this.updateLabel(pred);
    this.removeEntity(preyId);
    const gain = Object.entries(a.dna).map(([k, v]) => `${k}+${v}`).join(' ');
    const elem = a.elementFrom !== a.elementTo ? ` · 夺本源 ${a.elementFrom}→${a.elementTo}` : '';
    this.status(
      `吞噬成功：${pred.name} 吞下 ${prey.name} · 灵力 +${a.xp} · ${gain}${elem} · 支系「${a.lineage}」 · 累计吞噬 ${pred.ev.devoured} 次`,
      'ok',
    );
    this.selected = predatorId;
    this.renderList();
    this.saveState();
    return r;
  }

  // ---- 存档：造物 + 演变状态 + 建造构件，刷新后仍在 ----
  saveState(): void {
    if (this.restoring) return;
    const list: SavedEntity[] = [];
    for (const e of this.entityMap.values()) {
      if (!e.play) continue;
      list.push({
        spec: { ...e.spec }, name: e.name, tier: e.tier, catalogId: e.catalogId,
        ev: JSON.parse(JSON.stringify(e.ev)) as Evolvable,
        pos: { ...e.play.pos }, behavior: e.play.behavior,
        blueprintId: e.blueprintId, buildPartId: e.buildPartId, hostile: e.hostile,
      });
    }
    try { safeSet(STATE_KEY, JSON.stringify({ version: 1, entities: list.slice(-60) })); } catch { /* ignore */ }
  }

  restoreState(): number {
    let n = 0;
    this.restoring = true;
    try {
      const raw = safeGet(STATE_KEY);
      if (!raw) return 0;
      const o = JSON.parse(raw) as { version: number; entities: SavedEntity[] };
      if (!o || o.version !== 1 || !Array.isArray(o.entities)) return 0;
      for (const s of o.entities) {
        if (!s?.spec || !s.pos || !Number.isFinite(s.pos.x)) continue;
        const forged = forge(s.spec, { stage: s.ev?.stage ?? '成体', form: s.ev?.form });
        this.addEntity(s.spec, s.name, s.tier, s.catalogId, forged, null, s.pos, {
          evOverride: s.ev, behavior: s.behavior, hostile: s.hostile,
          blueprintId: s.blueprintId, buildPartId: s.buildPartId,
        });
        n++;
      }
    } catch { /* 损坏存档：忽略，不影响启动 */ }
    finally { this.restoring = false; }
    return n;
  }

  // ---- 验收 / window.__wish 句柄 ----
  entities(): Array<{
    id: string; name: string; stage: string; level: number; xp: number;
    tier: string; archetype: string; catalogId?: string; pos: { x: number; y: number; z: number };
    hp?: number; behavior?: string; lineage?: string; hostile?: boolean; buildPartId?: string; devoured?: number;
  }> {
    return Array.from(this.entityMap.values()).map((e) => ({
      id: e.id, name: e.name, stage: e.ev.stage, level: e.ev.level, xp: e.ev.xp,
      tier: e.tier, archetype: e.spec.archetype, catalogId: e.catalogId, pos: { ...e.pos },
      hp: e.play ? Math.round(e.play.hp) : undefined, behavior: e.play?.behavior,
      lineage: lineageOf(e.ev), hostile: e.hostile, buildPartId: e.buildPartId,
      devoured: e.ev.devoured ?? 0,
    }));
  }
  config(): AgentConfig {
    const c = loadAgentConfig();
    return { ...c, apiKey: c.apiKey ? '****' : '' };
  }
  blueprints(): Array<{ id: string; name: string; wish: string; tier: string; epithet: string; powers: string[]; steps: string[] }> {
    return listBlueprints().map((b) => ({ id: b.id, name: b.name, wish: b.wish, tier: b.tier, epithet: b.lore.epithet, powers: b.lore.powers, steps: b.steps }));
  }
  assetCount(): number { return blueprintCount(); }
  importAssets(json: string): number { const n = importBlueprints(json); this.refreshHint(); return n; }
  buildStats(): ReturnType<WishBuild['stats']> { return this.build.stats(); }
  buildParts(): BuildPart[] { return this.build.parts.map((p) => ({ ...p })); }
  playReport(): WishPlay['report'] { return { ...this.play.report }; }
  setBehavior(id: string, b: Behavior): boolean { return this.play.setBehavior(id, b); }
  worldEvents(): PlayEvent[] { return this.events.slice(-30); }
  clearState(): void {
    for (const e of Array.from(this.entityMap.values())) this.removeEntity(e.id);
    this.build.clear();
    safeSet(STATE_KEY, '{"version":1,"entities":[]}');
  }
}

/** 目录按名字模糊检索（建造输入框用） */
function searchByName(name: string): ReturnType<typeof getById> {
  const s = name.trim();
  if (!s) return undefined;
  return WISH_CATALOG.find((e) => e.name.includes(s) || s.includes(e.name));
}

function findBlueprintByName(name: string): AssetBlueprint | null {
  return listBlueprints().find((b) => b.name === name || b.wish.includes(name)) ?? null;
}
