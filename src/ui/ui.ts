import * as THREE from 'three';
import { Engine, QUALITY, type QualityName } from '../core/engine';
import type { World } from '../world';
import { topCondition } from '../game/conditions';
import { bus } from '../core/rng';
import { POIS } from '../city/layout';
import { JOBS } from '../data/jobs';
import { WishPanel } from '../game/wishPanel';
// FIX-007 R2：身份常量由 vite define 注入（scripts/lib/identity.mjs → constantsForVite()）
declare const __APP_IDENTITY__: { productName: string; title: string; release: string; version: string } | undefined;
// SAV-001 R2 / SAV-003 R5：存档面板与 IDB 降级常驻告知
import { mountSavePanel, toggleSavePanel } from './savePanel';
import { downgradeNotice, mountDegradedNotice } from '../game/saveRecovery';
import { isIdbAvailable } from '../rt/save';

// 全量审核 2026-11-07（UI-10）：小地图逻辑尺寸常量（CSS 像素），与 DPR backing store 解耦
const MM_W = 216, MM_H = 150;

// ============ UI 总装：HUD / 图鉴 / 传送 / 设置 / 小地图 / 触控 ============
export function initUI(engine: Engine, world: World): (dt: number) => void {
  const ui = document.getElementById('ui')!;
  // FIX-007：身份取自构建期注入；define 未生效时降级到规范串，绝不白屏
  const idObj = typeof __APP_IDENTITY__ !== 'undefined' ? __APP_IDENTITY__ : undefined;
  const brandName = idObj && typeof idObj === 'object' && idObj.productName
    ? idObj.productName : '赛博上河 CyberQingming';

  // SAV-001 R2：存档面板自带样式，默认隐藏；Esc 打开
  mountSavePanel(document.body);
  // SAV-003 R5：IDB 不可用必须常驻可见提示，禁止只 console.warn
  void isIdbAvailable().then((ok) => {
    if (!ok) mountDegradedNotice(document.body, downgradeNotice(false));
  }).catch(() => { mountDegradedNotice(document.body, downgradeNotice(false)); });

  ui.innerHTML = `
  <div id="topbar">
    <div class="brand">${brandName}<small>CyberQingming-R29-1.2.0</small></div>
    <div id="ticker"><span>长卷徐展，汴京入市……</span></div>
    <div id="stats"></div>
  </div>
  <div id="goalchain" style="position:absolute;top:52px;left:16px;z-index:62;pointer-events:none;text-shadow:0 0 10px rgba(0,0,0,.9);">
    <div id="goalMain" style="display:inline-block;font-size:13px;letter-spacing:.1em;color:#ffe9c8;background:rgba(10,8,6,.5);border:1px solid rgba(255,210,94,.28);border-radius:8px;padding:3px 10px;white-space:nowrap;">
    <div id="condNode" style="font-size:12px;color:#ffd9a8;margin-top:3px;"></div></div>
    <div id="goalFlash" style="margin-top:4px;font-size:16px;font-weight:700;letter-spacing:.12em;color:#ffd25e;opacity:0;transition:opacity .25s;white-space:nowrap;"></div>
  </div>
  <div id="dock">
    <button class="dock-btn" id="bAvatar"><span class="ico">🚶</span>附身</button>
    <button class="dock-btn" id="bCam"><span class="ico">🎬</span>视角</button>
    <button class="dock-btn" id="bCodex"><span class="ico">📜</span>图鉴</button>
    <button class="dock-btn" id="bGo"><span class="ico">🧭</span>传送</button>
    <button class="dock-btn" id="bTime"><span class="ico">🌅</span>昼夜</button>
    <button class="dock-btn" id="bSet"><span class="ico">⚙️</span>设置</button>
    <button class="dock-btn" id="bSnd"><span class="ico">🎵</span>音效</button>
    <button class="dock-btn" id="bHelp"><span class="ico">❓</span>帮助</button>
  </div>
  <div class="panel" id="codex">
    <div class="panel-head"><h3>汴京图鉴</h3><span class="panel-close" data-close="codex">✕</span></div>
    <div class="tabs"><div class="tab on" data-tab="shuihu">水浒108</div><div class="tab" data-tab="deity">西游神佛</div><div class="tab" data-tab="job">市井百业</div></div>
    <div class="panel-body" id="codexBody"></div>
  </div>
  <div class="panel" id="gotele">
    <div class="panel-head"><h3>云路传送</h3><span class="panel-close" data-close="gotele">✕</span></div>
    <div class="panel-body" id="teleBody"></div>
  </div>
  <div class="panel right" id="settings">
    <div class="panel-head"><h3>设置</h3><span class="panel-close" data-close="settings">✕</span></div>
    <div class="panel-body" id="setBody"></div>
  </div>
  <div class="panel right" id="help">
    <div class="panel-head"><h3>漫游指南</h3><span class="panel-close" data-close="help">✕</span></div>
    <div class="panel-body">
      <div><kbd>W A S D</kbd>移动　<kbd>Shift</kbd>疾行（×3.2）</div>
      <div><kbd>Space</kbd>/<kbd>E</kbd>上升　<kbd>C</kbd>/<kbd>Q</kbd>/<kbd>Ctrl</kbd>下降（飞行模式）</div>
      <div><kbd>拖拽</kbd>转视角　<kbd>滚轮</kbd>推拉　<kbd>点击角色</kbd>查看并聚焦</div>
      <div><kbd>E</kbd>交互（附身）　<kbd>H</kbd>拍照（隐藏全部 UI）　<kbd>M</kbd>海图</div>
      <!-- 全量审核 2026-11-07（B-08）：engine.ts 实际只认 Space / Esc / Enter 三键跳过开场运镜 -->
      <div><kbd>F1</kbd>本指南　<kbd>T</kbd>传送　<kbd>B</kbd>图鉴　<kbd>Esc</kbd>关闭面板　<kbd>Space / Esc / Enter</kbd>跳过开场运镜</div>
      <div class="hint">· 漫游范围：全城 10km 见方（城墙 ±5000）、宫城、天宫（y 200–240）、地府（y −260）均可自由飞行，高度上限 4000m。</div>
      <div class="hint">· 天空即战场：大闹天宫十幕循环上演，底部战报为说书人评话。<br>
      · 水浒一百单八将尽数在城：鲁智深在菜园倒拔垂杨柳，时迁在屋顶飞檐走壁，张顺在汴河浪里白条，凌振在河滩放轰天雷焰火。<br>
      · 图鉴可直达任何一位好汉与神佛。<br>
      · 桌面建议 Chrome/Edge；移动端自动触控与画质分档。</div>
    </div>
  </div>
  <div id="infocard"></div>
  <!-- 全量审核 2026-11-07（UI-10）：CSS 尺寸锁定 216×150，backing store 按 DPR 放大见小地图段 -->
  <div id="minimap"><canvas width="216" height="150" style="width:216px;height:150px"></canvas></div>
  <div id="toast"></div>
  <div id="skip">跳过开场 »</div>
  <div id="stick"><i></i></div>
  <div id="lookzone"></div>
  <button id="jumpbtn" type="button" aria-label="跳跃">跳跃</button>`;

  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  const q = <T extends HTMLElement>(s: string): T => ui.querySelector(s) as T;

  // ---- 面板开合 ----
  const togglePanel = (id: string): void => {
    $(id).classList.toggle('show');
    bus.emit(id === 'codex' ? 'sfx:codex' : 'sfx:ui');
  };
  ui.querySelectorAll('.panel-close').forEach((el) => el.addEventListener('click', () => $(el.getAttribute('data-close')!).classList.remove('show')));
  $('bCodex').onclick = () => { togglePanel('codex'); renderCodex('shuihu'); };
  $('bGo').onclick = () => { togglePanel('gotele'); renderTele(); };
  $('bSet').onclick = () => { togglePanel('settings'); };
  $('bHelp').onclick = () => togglePanel('help');
  // 全量审核 2026-11-07（UI-04）：photoMode 声明上移到两个快捷键 handler 之前（同闭包，避免 TDZ）
  let photoMode = false;
  // 全量审核 2026-11-07（B-08 补漏）：拍照模式必须挡住**所有**玩法键。
  // 下方两个 handler 里的 `if (!modalPass && photoMode) return` 只管得住 ui.ts 自己；
  // player.ts 的 V/E/F、buildMode.ts 的 G、creation.ts 的 Y 都注册在 window 冒泡阶段，
  // 仍会照常执行 —— 「隐藏 UI」并不等于「禁用玩法输入」。这里在捕获阶段、事件抵达
  // 其它监听器之前统一拦掉纯玩法键；Escape / H / Enter / Space 与全部相机移动键放行，
  // 保证拍照态仍能取景、能退出、能关面板、能跳过开场运镜。
  const PHOTO_PLAY_KEYS = new Set(['KeyJ', 'KeyV', 'KeyE', 'KeyF', 'KeyG', 'KeyY', 'KeyB', 'KeyT', 'KeyM', 'F1']);
  window.addEventListener('keydown', (ev) => {
    if (!photoMode) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!PHOTO_PLAY_KEYS.has(ev.code)) return;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
  // ---- Boss 出手键：J（真实 keydown 到达页面才算数，probe-boss 走同一条路径）----
  window.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    // 全量审核 2026-11-07（UI-04）：模态门控。Escape 始终放行（关面板）；拍照态除 KeyH/Escape
    // 外一律吞；.panel.show 时 KeyJ 与 F1/M/T/B 一律吞（#wishbar 不带 .panel，不受影响）。
    const modalPass = ev.code === 'Escape' || ev.code === 'KeyH';
    if (!modalPass && photoMode) return;
    if (!modalPass && document.querySelector('.panel.show') && ['KeyJ', 'F1', 'KeyM', 'KeyT', 'KeyB'].includes(ev.code)) return;
    // 全量审核 2026-11-07（P-12）：按住 J 会以系统重复率连调 playerAttack，
    // 仅靠 hitCooldown 限流成自动连击，绕过「防止连点刷伤害」的设计意图。
    if (ev.code === 'KeyJ' && !ev.repeat) { ev.preventDefault(); world.boss?.playerAttack(); }
  });
  // ---- 全局快捷键（此前只有按钮、没有键位：M/F1/Esc 按下去没反应）----
  window.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    // 全量审核 2026-11-07（UI-04）：模态门控（同上，Escape 始终放行关面板）
    const modalPass = ev.code === 'Escape' || ev.code === 'KeyH';
    if (!modalPass && photoMode) return;
    if (!modalPass && document.querySelector('.panel.show') && ['KeyJ', 'F1', 'KeyM', 'KeyT', 'KeyB'].includes(ev.code)) return;
    if (ev.code === 'F1') {
      ev.preventDefault();
      togglePanel('help');
    } else if (ev.code === 'KeyM') {
      const mmEl = document.getElementById('minimap');
      if (mmEl) mmEl.style.display = mmEl.style.display === 'none' ? '' : 'none';
    } else if (ev.code === 'Escape') {
      // SAV-001 R2：Esc → 存档面板（与关面板同键，不新增键位冲突）
      toggleSavePanel();
      document.querySelectorAll('.panel.show').forEach((el) => el.classList.remove('show'));
    } else if (ev.code === 'KeyT') {
      togglePanel('gotele'); renderTele();
    } else if (ev.code === 'KeyB') {
      togglePanel('codex'); renderCodex('shuihu');
    }
  });

  // ---- 附身（GTA 模式） ----
  $('bAvatar').onclick = () => world.player?.toggleMode();
  bus.on('player:mode', (m) => {
    $('bAvatar').classList.toggle('on', m === 'avatar');
    $('bAvatar').innerHTML = `<span class="ico">🚶</span>${m === 'avatar' ? '灵魂' : '附身'}`;
  });
  // 铜钱
  const coinsEl = document.createElement('div');
  coinsEl.id = 'coins';
  coinsEl.textContent = '💰 -- 文';
  $('topbar').appendChild(coinsEl);
  // 全量审核 2026-11-07（B-02）：删掉独立的 coins:change 订阅，双源（铜钱/三币）统一到 renderTri
  // B10 精修：三币常驻 HUD（铜钱/阴德/蟠桃点——总线同步，InteractSystem save 即刷）
  const triEl = document.createElement('span');
  triEl.style.cssText = 'margin-left:10px;color:#b8ffd8;';
  $('topbar').appendChild(triEl);
  const renderTri = (): void => {
    // 全量审核 2026-11-07（B-02）：改读 initUI 闭包形参 world.interact；
    // 构造期 __qingming 全局句柄尚未注入，旧写法顶栏恒显「-- 文」且三币空白。
    const it = world.interact;
    if (it) { triEl.textContent = `💠 ${it.yinde}  🍑 ${it.peach}`; coinsEl.textContent = `💰 ${it.coins} 文`; } // 含铜钱首刷（构造期无 coins:change）
  };
  bus.on('coins:change', renderTri);
  renderTri();

  // ---- 视角 ----
  const camNames: Record<string, string> = { cinema: '运镜', fly: '飞行', walk: '漫游', focus: '聚焦' };
  $('bCam').onclick = () => {
    if (engine.camMode === 'cinema' || engine.camMode === 'focus') engine.stopCinema('fly');
    else if (engine.camMode === 'fly') engine.setCamMode('walk');
    else engine.startCinema();
  };
  bus.on('cam:mode', (m) => {
    $('bCam').innerHTML = `<span class="ico">🎬</span>视角·${camNames[m as string] ?? ''}`;
    $('skip').classList.toggle('show', m === 'cinema');
  });
  $('skip').onclick = () => engine.stopCinema();

  // ---- 昼夜 ----
  const timeCycle = ['dusk', 'night', 'deep', 'dawn', 'cycle'] as const;
  let timeI = 0;
  const timeNames: Record<string, string> = { dusk: '黄昏', night: '夜晚', deep: '深夜', dawn: '黎明', cycle: '循环' };
  $('bTime').onclick = () => {
    timeI = (timeI + 1) % timeCycle.length;
    const m = timeCycle[timeI];
    if (m === 'cycle') { engine.time.paused = false; }
    else { engine.time.paused = true; engine.time.jump(m); }
    $('bTime').innerHTML = `<span class="ico">🌅</span>${timeNames[m]}`;
  };

  // ---- 精修7：顶栏时辰徽标（time.label() 映射，开世界时段感知） ----
  const timeBadge = document.createElement('span');
  timeBadge.style.cssText = 'margin-left:10px;color:#ffd9a0;';
  $('topbar').appendChild(timeBadge);
  const tickTime = (): void => { timeBadge.textContent = '🕘 ' + engine.time.label(); };
  bus.on('time:phase', tickTime);
  tickTime();

  // ---- 目标链 HUD（工作流 G）：常驻「目标 N/17 · 下一个：XXX」，达成时顶部闪进度计数 ----
  // 目标行必须由目标链驱动：poiGuide 的目标行只描述「脚下最近的点」，
  // 玩家完成一个节点后仍不知道该去哪——这里补的就是「下一个」。
  const goalMain = $('goalMain');
  const goalFlash = $('goalFlash');
  let goalFlashT = 0;
  let goalT = 0;
  const renderGoal = (): void => {
    const p = world.objectiveProgress();
    goalMain.textContent = p.next
      ? `🎯 目标 ${p.done}/${p.total} · 下一个：${p.next}`
      : `🎯 目标 ${p.done}/${p.total} · 全部达成`;
    // P1-4 条件节点：资源轴驱动的「该去做什么」（H6 三修订的 HUD 兑付）
    // P1-4 条件节点：interact/survival 在载入链「众生入场」步才创建——构造期 renderGoal 首刷时跳过
    const it = world.interact;
    const sv = world.survival;
    if (!it || !sv) return;
    const cre = world.creationCount;
    const top = topCondition({ coins: it.coins, yinde: it.yinde, peach: it.peach, hunger: sv.hunger, bossesDown: sv.bossesDown, hasCreation: cre > 0 });
    const condEl = document.getElementById('condNode');
    if (condEl) condEl.textContent = top ? `⚡ ${top.text}` : '';
  };
  bus.on('objective:done', (raw) => {
    const e = raw as { done?: number; total?: number } | undefined;
    const p = world.objectiveProgress();
    goalFlash.textContent = `目标 ${e?.done ?? p.done}/${e?.total ?? p.total} 达成`;
    goalFlash.style.opacity = '1';
    goalFlashT = 3.2;
    renderGoal();
  });
  renderGoal();

  // ---- 拍照模式（对标落地：Ubisoft/ESO/Larian F10 惯例——H 键隐藏全部 UI 取净景） ----
  // 全量审核 2026-11-07（UI-04）：photoMode 已上移到快捷键 handler 之前，此处不再重复声明。
  window.addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyH') return;
    photoMode = !photoMode;
    const root = document.getElementById('ui');
    if (root) root.style.display = photoMode ? 'none' : '';
    // 全量审核 2026-11-07（B-08）：连关所有面板并 blur 焦点，保证拍照态互斥且恢复后快捷键不残留
    document.querySelectorAll('.panel.show').forEach((el) => el.classList.remove('show'));
    (document.activeElement as HTMLElement | null)?.blur();
  });

  // ---- 音效 ----
  let sndOn = true;
  $('bSnd').onclick = () => {
    sndOn = !sndOn;
    world.audio.setEnabled(sndOn);
    $('bSnd').classList.toggle('on', sndOn);
    $('bSnd').innerHTML = `<span class="ico">🎵</span>音效${sndOn ? '开' : '关'}`;
  };

  // ---- 传送 ----
  function renderTele(): void {
    const body = $('teleBody');
    body.innerHTML = '';
    // 精修6（对标 cobomakesgames fast-travel-design：目的地按区分组）
    const groups: [string, (k: string) => boolean][] = [
      ['🏮 人间汴京', (k) => { const p = POIS[k]; return !p.sky && p.pos.y > -50 && !/mt_|greatlake|desert|grassland/.test(k); }],
      ['🏮 城外山河', (k) => /mt_|greatlake|desert|grassland/.test(k)],
      ['💀 幽冥地府', (k) => POIS[k].pos.y <= -50 && !POIS[k].sky],
      ['☁️ 云上天宫', (k) => !!POIS[k].sky],
    ];
    for (const [title, match] of groups) {
      const keys = Object.keys(POIS).filter(match);
      if (!keys.length) continue;
      const h = document.createElement('div');
      h.className = 'hint';
      h.style.cssText = 'margin:8px 0 4px;color:#8fd8ff;letter-spacing:2px;';
      h.textContent = `── ${title} ──`;
      body.appendChild(h);
      for (const key of keys) {
        const poi = POIS[key];
        const b = document.createElement('button');
        b.className = 'dock-btn';
        b.style.cssText = 'width:100%;text-align:left;margin-bottom:6px;';
        b.textContent = (poi.sky ? '☁️ ' : '🏮 ') + poi.name;
        b.onclick = () => { world.teleport(key); };
        body.appendChild(b);
      }
    }
  }

  // ---- 图鉴 ----
  let codexTab = 'shuihu';
  function renderCodex(tab: string): void {
    codexTab = tab;
    ui.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', (t as HTMLElement).dataset.tab === tab));
    const body = $('codexBody');
    body.innerHTML = '';
    // 已了结的际遇：接在标题下方（Boss 胜利的奖励写回这里，不是只弹一个 toast）
    if (world.codexLog.length) {
      const done = document.createElement('div');
      done.className = 'hero-grid';
      done.style.marginBottom = '10px';
      for (const e of world.codexLog) {
        const it = document.createElement('div');
        it.className = 'hero-item god';
        it.innerHTML = `<div class="nm">${e.name}<span class="nk">已了结</span></div><div class="doing">${e.note}</div>`;
        done.appendChild(it);
      }
      body.appendChild(done);
    }
    if (tab === 'job') {
      const grid = document.createElement('div');
      grid.className = 'hero-grid';
      for (const j of JOBS) {
        const it = document.createElement('div');
        it.className = 'hero-item';
        it.innerHTML = `<div class="nm">${j.label}<span class="nk">×${Math.round(j.count)}</span></div><div class="doing">${j.behaviors[0]?.doing ?? ''}</div>`;
        grid.appendChild(it);
      }
      body.appendChild(grid);
      return;
    }
    const entries = world.heroEntries().filter((h) => h.group === tab);
    const grid = document.createElement('div');
    grid.className = 'hero-grid';
    for (const h of entries) {
      const it = document.createElement('div');
      it.className = 'hero-item' + (tab === 'deity' ? ' god' : '');
      it.innerHTML = `<div class="nm">${h.name}<span class="nk">${h.nick}</span></div><div class="doing">${h.desc}</div>`;
      it.onclick = () => world.focusHero(h.code);
      grid.appendChild(it);
    }
    body.appendChild(grid);
  }
  ui.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => renderCodex((t as HTMLElement).dataset.tab!)));

  // ---- 设置 ----
  const setBody = $('setBody');
  const seg = (label: string, opts: string[], start: number, onPick: (i: number) => void): void => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const box = document.createElement('div'); box.className = 'seg';
    opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.textContent = o;
      if (i === start) b.classList.add('on');
      b.onclick = () => { box.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick(i); };
      box.appendChild(b);
    });
    row.appendChild(lab); row.appendChild(box);
    setBody.appendChild(row);
  };
  const qNames: QualityName[] = ['high', 'med', 'low'];
  seg('画质', ['自动', '高', '中', '低'], 0, (i) => {
    if (i === 0) { engine.qualityAuto = true; }
    else { engine.qualityAuto = false; engine.applyQuality(QUALITY[qNames[i - 1]]); }
  });

  // PERF-001 R6 / QA-008 R3：性能档与全部降级项在设置面板逐条披露（INV-04 禁止静默降级）。
  // 面板里没有「关于页」，这是设置面板的等价披露位；数值一律从 __qingming.perfDecision 读，
  // 不手抄、不硬编码，避免文档/代码/UI 三处漂移。
  {
    const q = (window as unknown as { __qingming?: Record<string, unknown> }).__qingming;
    const decision = q?.perfDecision as { mode?: string; reason?: string; degraded?: string[] } | undefined;
    const profile = q?.hwProfile as { deviceMemoryGB?: number | null; hardwareConcurrency?: number | null; renderer?: string | null; minMet?: boolean; recommendedMet?: boolean } | undefined;
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label');
    lab.textContent = '性能档';
    const val = document.createElement('div');
    val.style.cssText = 'flex:1;font-size:12px;line-height:1.55;opacity:.9';
    const mode = decision?.mode ?? 'normal';
    const mem = profile?.deviceMemoryGB === null || profile?.deviceMemoryGB === undefined ? '未知' : `${profile.deviceMemoryGB}GB`;
    const cores = profile?.hardwareConcurrency ?? '未知';
    val.innerHTML = `<b>${mode === 'low' ? '低配' : '标准'}</b> · 内存 ${mem} / 逻辑核 ${cores}`
      + ` · 判定 ${decision?.reason ?? 'default'}`
      + `<br>最低档 ${profile?.minMet ? '达标' : '未达标'} / 推荐档 ${profile?.recommendedMet ? '达标' : '未达标'}`;
    if (decision?.degraded?.length) {
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:4px 0 0 16px;padding:0';
      for (const d of decision.degraded) {
        const li = document.createElement('li'); li.textContent = d; ul.appendChild(li);
      }
      val.appendChild(ul);
    }
    row.appendChild(lab); row.appendChild(val);
    setBody.appendChild(row);
  }
  seg('人流', ['繁盛', '适中', '疏朗'], 0, (i) => world.setDensity([1, 0.62, 0.34][i]));
  const tglRow = (label: string, start: boolean, on: (v: boolean) => void): void => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const t = document.createElement('div'); t.className = 'tgl' + (start ? ' on' : '');
    t.innerHTML = '<i></i>';
    t.onclick = () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); on(v); };
    row.appendChild(lab); row.appendChild(t);
    setBody.appendChild(row);
  };
  tglRow('霓虹泛光', engine.quality.bloom, (v) => { engine.bloomPass.enabled = v; });
  tglRow('实时阴影', engine.quality.shadows, (v) => {
    const sun = engine.scene.getObjectByName('sun') as THREE.Light | null;
    if (sun) sun.castShadow = v;
  });
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '低配设备会自动降档；关闭泛光与阴影可显著提速。';
  setBody.appendChild(hint);

  // ---- 战报 ticker ----
  const tickerSpan = ui.querySelector('#ticker span') as HTMLElement;
  const queue: string[] = [];
  let tickTimer = 0;
  bus.on('battle:report', (s) => { if (queue.length < 32) queue.push(String(s)); }); // P2-4：封顶，防高频战报把队列推到无界
  const welcome = ['长卷徐展，汴京入市。虹桥两岸，正店脚店，酒旗招展。', '天上人间同此夜：且看齐天大圣，反出南天门！'];
  queue.push(...welcome);

  // ---- 信息卡 / toast ----
  const card = $('infocard');
  let cardTimer = 0;
  bus.on('hero:focus', (p) => {
    const d = p as { name: string; nick: string; group: string; weapon: string; desc: string; doing: string };
    card.innerHTML = `<h4>${d.nick}·${d.name}</h4><span class="tag">${d.group === 'shuihu' ? '水浒好汉' : '西游神佛'}</span><span class="tag">${d.weapon}</span><p>${d.desc}<br>此刻：${d.doing}</p>`;
    card.classList.add('show');
    cardTimer = 9;
  });
  const toast = $('toast');
  let toastTimer = 0;
  bus.on('ui:toast', (s) => { toast.textContent = String(s); toast.classList.add('show'); toastTimer = 2.6; });

  // FIX-010 R4：受击 HUD 红晕；payload = { hp, amount, source }（survival.damage 统一 emit）
  bus.on('player:damaged', (raw) => {
    const p = (raw ?? {}) as { hp?: number; amount?: number; source?: string };
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:rgba(220,40,40,.18);opacity:0;transition:opacity .12s;z-index:89;';
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '1'; });
    window.setTimeout(() => {
      flash.style.opacity = '0';
      window.setTimeout(() => flash.remove(), 180);
    }, 120);
    void p;
  });

  // ---- 小地图 ----
  const mm = q<HTMLCanvasElement>('#minimap canvas');
  const mctx = mm.getContext('2d')!;
  // 全量审核 2026-11-07（UI-10）：backing store 按 DPR（封顶 2）放大，CSS 尺寸保持 216×150；
  // 所有绘图坐标统一改用逻辑常量 MM_W/MM_H，避免 DPR 放大后坐标翻倍、画到边界外。
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  mm.width = Math.round(MM_W * dpr);
  mm.height = Math.round(MM_H * dpr);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mx = (x: number): number => ((x + 5600) / 11200) * MM_W;
  const mz = (z: number): number => ((z + 5600) / 11200) * MM_H;

  function drawMinimap(): void {
    mctx.clearRect(0, 0, MM_W, MM_H);
    mctx.fillStyle = 'rgba(8,12,22,0.6)';
    mctx.fillRect(0, 0, MM_W, MM_H);
    // 十公里城墙
    mctx.strokeStyle = 'rgba(200,190,160,0.8)';
    mctx.lineWidth = 2;
    mctx.strokeRect(mx(-5000), mz(-5000), mx(5000) - mx(-5000), mz(5000) - mz(-5000));
    // 汴河
    mctx.fillStyle = 'rgba(0,120,190,0.55)';
    mctx.fillRect(0, mz(-30), MM_W, mz(30) - mz(-30));
    // 宫城/两市
    mctx.strokeStyle = 'rgba(255,210,94,0.7)';
    mctx.strokeRect(mx(-1100), mz(-4450), mx(1100) - mx(-1100), mz(-2950) - mz(-4450));
    mctx.strokeRect(mx(1900), mz(0), mx(3700) - mx(1900), mz(1800) - mz(0));
    mctx.strokeRect(mx(-3700), mz(0), mx(-1900) - mx(-3700), mz(1800) - mz(0));
    // 街道
    mctx.strokeStyle = 'rgba(0,229,255,0.35)';
    mctx.lineWidth = 1;
    mctx.beginPath(); mctx.moveTo(mx(0), mz(-5000)); mctx.lineTo(mx(0), mz(5000)); mctx.stroke();
    // POI（近郊内）
    mctx.font = '10px sans-serif';
    for (const k in POIS) {
      const p = POIS[k];
      if (Math.abs(p.pos.x) > 5600 || Math.abs(p.pos.z) > 5600) continue;
      mctx.fillStyle = p.sky ? 'rgba(0,229,255,0.9)' : 'rgba(255,179,0,0.9)';
      mctx.fillRect(mx(p.pos.x) - 2, mz(p.pos.z) - 2, 4, 4);
    }
    // 英雄点
    for (const h of world.heroEntries()) {
      if (Math.abs(h.x) > 5600 || Math.abs(h.z) > 5600) continue;
      mctx.fillStyle = h.group === 'shuihu' ? 'rgba(255,200,80,0.95)' : 'rgba(120,230,255,0.95)';
      mctx.fillRect(mx(h.x) - 1.5, mz(h.z) - 1.5, 3, 3);
    }
    // 玩家
    const c = engine.camera.position;
    mctx.save();
    mctx.translate(mx(c.x), mz(c.z));
    mctx.rotate(-engine.yaw + Math.PI);
    mctx.fillStyle = '#ff2d95';
    mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4.5, 5); mctx.lineTo(-4.5, 5); mctx.closePath(); mctx.fill();
    mctx.restore();
    mctx.fillStyle = 'rgba(255,233,184,0.85)';
    mctx.fillText('天宫战况：' + world.phaseName, 6, 12);
  }

  // ---- 主循环 UI 刷新 ----
  let statT = 0, mmT = 0;
  const statsEl = $('stats');
  let uiT = 0;
  const uiTick = (dt: number): void => {
    uiT += dt;
    tickTimer -= dt;
    if (tickTimer <= 0 && queue.length > 0) {
      tickerSpan.textContent = queue.shift()!;
      tickTimer = 7.5;
    }
    statT -= dt;
    if (statT <= 0) {
      statT = 0.5;
      const sv = (window as unknown as { __qingming?: { world?: { survival?: { hp: number; hunger: number } } } }).__qingming?.world?.survival;
      const km = world.karma.current();
      const vital = sv ? `<br>❤️ ${Math.round(sv.hp)} · 🍚 ${Math.round(sv.hunger)}` : '';
      const tierLine = `<br>✦ ${km.tier} · 业力 ${km.karma}`;
      const weapon = world.playerWeapon ? `<br>⚔️ ${world.playerWeapon.label}` : '';
      statsEl.innerHTML = `<b>${engine.fps.toFixed(0)}</b> fps · ${engine.drawCalls} calls<br>在场 ${world.liveCount()} 人${vital}${tierLine}${weapon}`;
    }
    mmT -= dt;
    if (mmT <= 0) { mmT = 0.25; drawMinimap(); }
    if (cardTimer > 0) { cardTimer -= dt; if (cardTimer <= 0) card.classList.remove('show'); }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toast.classList.remove('show'); }
    // 目标链：常驻行每 0.4s 对账（objectiveDone 也可能被探针/外部直接改写），闪字 3.2s 后淡出
    goalT -= dt;
    if (goalT <= 0) { goalT = 0.4; renderGoal(); }
    if (goalFlashT > 0) { goalFlashT -= dt; if (goalFlashT <= 0) goalFlash.style.opacity = '0'; }
  };

  // ---- 点击聚焦最近英雄（屏幕空间投影） ----
  // 注册到 engine 的单击路由：优先级 20 > 出拳 10 > 指针锁定兜底。
  // 只有真的命中英雄才返回 true 消费；否则让给出拳/指针锁定，一次单击仍只做一件事。
  const ray = new THREE.Vector3();
  engine.input.register('heroFocus', (e) => {
    if (e.pointerType === 'touch') return false;
    if (document.pointerLockElement) return false; // 锁定态屏幕坐标不可靠
    let best: { code: string; d: number } | null = null;
    for (const h of world.crowd.heroes) {
      if (h.hidden || !h.data) continue;
      ray.set(h.pos.x, h.pos.y + h.yOff + 1.5 * h.scale, h.pos.z).project(engine.camera);
      if (ray.z > 1) continue;
      const sx = (ray.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-ray.y * 0.5 + 0.5) * window.innerHeight;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < 34 && (!best || d < best.d)) best = { code: h.data.code!, d };
    }
    if (!best) return false;
    world.focusHero(best.code);
    return true;
  }, 20);

  // ---- 触控 ----
  if (engine.isTouch) document.body.classList.add('touch');
  // 移动端跳跃键：#jumpbtn 默认 display:none，body.touch 才显示（见 style.css）
  $('jumpbtn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    world.player?.jump();
  });
  const stick = $('stick'), knob = q<HTMLElement>('#stick i'), lookzone = $('lookzone');
  let stickId = -1, lookId = -1, lx = 0, ly = 0;
  stick.addEventListener('touchstart', (e) => { stickId = (e as TouchEvent).changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of Array.from(e.touches)) {
      if (t.identifier === stickId) {
        const r = stick.getBoundingClientRect();
        const dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const len = Math.min(44, Math.hypot(dx, dy));
        const ang = Math.atan2(dy, dx);
        engine.touchMove.x = (Math.cos(ang) * len) / 44;
        engine.touchMove.y = (Math.sin(ang) * len) / 44;
        knob.style.transform = `translate(${Math.cos(ang) * len}px,${Math.sin(ang) * len}px)`;
      } else if (t.identifier === lookId) {
        engine.dragLook((t.clientX - lx) * 2.2, (t.clientY - ly) * 2.2);
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) { stickId = -1; engine.touchMove.x = engine.touchMove.y = 0; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = -1;
    }
  });
  lookzone.addEventListener('touchstart', (e) => {
    const t = (e as TouchEvent).changedTouches[0];
    lookId = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: true });

  // ---- 首次交互启动音频 ----
  const kick = (): void => { world.audio.start(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);

  // ---- 三界造物 · 许愿台：真实可见的输入框 / 状态 / 设置 / 实体列表 / 五玩法入口 ----
  // 面板自带 DOM 挂载到 #ui（z-index 高于既有 .panel），逻辑见 src/game/wishPanel.ts。
  const wishPanel = new WishPanel({
    uiRoot: ui,
    scene: engine.scene,
    camera: engine.camera,
    // R26：多机位离屏截图验证要借用主 renderer（validateAsset 用完即还原 target 并 dispose）
    renderer: engine.renderer,
    dropPoint: (f, s) => world.wishDropPoint(f, s),
    // R25：造物世界循环需要 player / interact / boss（鸭子类型消费，载入期未装配时降级）
    world,
  });
  (window as unknown as Record<string, unknown>)['__wishPanel'] = wishPanel;

  return uiTick;
}
