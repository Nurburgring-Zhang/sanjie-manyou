import * as THREE from 'three';
import type { Random } from '../actors/behaviors';
import type { PlayerController } from './player';
import { bus, RNG } from '../core/rng';
import { collectPersistedEntities } from '../rt/save';
import type { Calendar } from './calendar';

// ============ 交互系统：提示 / 铜钱经济 / 商铺 / 骰子赌局 / 五子棋 ============
export interface Interactable {
  pos: THREE.Vector3;
  r: number;
  label: string;
  exec: () => void;
  enabled?: () => boolean;
}

interface Good { name: string; price: number; act: string; say: string }

/** FIX-012 R3：忘川渡票持有上限（票券类道具，不入货币轴、不可兑铜钱） */
const FERRY_TICKET_CAP = 3;
/** FIX-012 R3：冥途牒阴德成本（karma.ts 不动，仍为 -10） */
const YINDE_COST = 10;

export class InteractSystem {
  coins = 0;
  yinde = 0;    // 阴德（地府币；只可烧纸单向获得）
  peach = 3;    // 蟠桃点（天宫币；赏赐单向兑铜钱）
  /** FIX-012 R3：忘川渡票（票券类道具，冥途牒唯一产物） */
  ferryTicket = 0;
  /** FIX-012 R2：今日已赏赐次数（cap 1/游戏日） */
  peachGrantedToday = 0;
  /** FIX-012 R2：上次赏赐所在游戏日（跨会话兜底，与 calendar.dayIndex() 比较） */
  private peachGrantDay = -1;
  /** FIX-012 R2：注入的全仓唯一游戏日来源（world.ts 接线）；未注入时按 peachGrantedToday 独立计数 */
  private calendar: Calendar | null = null;
  list: Interactable[] = [];
  private prompt: HTMLElement;
  private root: HTMLElement;
  private panel: HTMLElement | null = null;
  private nearest: Interactable | null = null;
  /** 上一次写进 #interact-prompt 的文本：相同就一个 DOM 写都不发 */
  private promptText: string | null = null;
  /** 注入随机源：骰子赌局用（输赢改铜钱=影响 sim，必须可复现；behaviors/crowd/boss/havoc 同款规矩） */
  rng: Random = (() => { const r = new RNG(0x5e7a1); return () => r.next(); })();
  /**
   * 全量审核 2026-11-07（P-01）：付费饮食的生存收益注入点，由 world 接 `survival.eat()`。
   * 旧实现 `openShop` 购买成功只播放动作、从不回饥饿/血，
   * 导致 `conditions.ts:35` c-hunger「回 30 饥饿」在这些商品上无法兑现。
   * 用回调注入而不是 import Survival，保持 InteractSystem 可单测、不引入 Three 场景依赖。
   */
  survivalSink: ((hungerGain: number, hpGain: number) => string) | null = null;

  /** 饮食恢复量按价目分档：越贵越顶饱，避免 1 文盐豆 = 80 文席面 */
  private static foodRestore(price: number): [number, number] {
    if (price >= 40) return [50, 14];
    if (price >= 12) return [32, 9];
    if (price >= 6) return [22, 6];
    return [12, 3];
  }

  /** P2-1：NaN 才回缺省——`parseInt(...) || 缺省` 会把合法的 0 也吞掉（0 文钱重载变 500） */
  private static loadInt(key: string, dflt: number): number {
    const v = parseInt(localStorage.getItem(key) ?? '', 10);
    return Number.isNaN(v) ? dflt : v;
  }

  constructor(uiRoot: HTMLElement, private player: PlayerController) {
    this.root = uiRoot;
    this.prompt = document.createElement('div');
    this.prompt.id = 'interact-prompt';
    uiRoot.appendChild(this.prompt);
    this.load();
    this.player.interactHook = () => {
      const n = this.nearest;
      if (n) { n.exec(); }
    };
  }

  /** FIX-012 R2/R3：从 localStorage 影子键恢复三币 + 渡票 + 每日赏赐计数（向后兼容：缺键用缺省） */
  load(): void {
    this.coins = InteractSystem.loadInt('cq_coins', 500);
    this.yinde = InteractSystem.loadInt('cq_yinde', 0);
    this.peach = InteractSystem.loadInt('cq_peach', 3);
    this.ferryTicket = InteractSystem.loadInt('cq_ferry_ticket', 0);
    this.peachGrantedToday = InteractSystem.loadInt('cq_peach_granted_today', 0);
    this.peachGrantDay = InteractSystem.loadInt('cq_peach_grant_day', -1);
  }

  /** FIX-012 R2：注入全仓唯一游戏日来源；onNewDay 清零每日赏赐计数 */
  setCalendar(cal: Calendar): void {
    this.calendar = cal;
    cal.onNewDay(() => { this.peachGrantedToday = 0; });
    cal.dayIndex();   // 初始化当前游戏日（首次进入不触发回调，防启动误清）
  }

  add(pos: THREE.Vector3, r: number, label: string, exec: () => void, enabled?: () => boolean): void {
    this.list.push({ pos, r, label, exec, enabled });
  }

  private pay(n: number): boolean {
    if (this.coins < n) { bus.emit('ui:toast', `铜钱不够（还差 ${n - this.coins} 文），去码头扛包挣点工钱吧`); return false; }
    this.coins -= n;
    this.save();
    return true;
  }
  tryPay(n: number): boolean { return this.pay(n); }
  earn(n: number): void { this.coins += n; this.save(); }

  /**
   * P1-1 资源轴：蟠桃 source 官方入口（蟠桃宴幕回调/未来 R5 线共用）。
   * 上限 9（三币律 UI 两位显示口径）；超出的部分如实丢弃并提示。
   */
  addPeach(n: number): void {
    const before = this.peach;
    this.peach = Math.min(9, this.peach + n);
    this.save();
    const gained = this.peach - before;
    bus.emit('ui:toast', gained > 0
      ? `蟠桃宴赐福：蟠桃点 +${gained}（现 ${this.peach}）`
      : '蟠桃宴赐福——但蟠桃点已满（上限 9），福缘散入云端');
  }

  /**
   * FIX-012 R2：蟠桃赏赐（蟠桃点 -1 → 铜钱 +100），cap 1/游戏日。
   * 抽成无 DOM 方法：openShop 只负责表演与提示；跨会话靠 peachGrantDay 兜底。
   */
  grantPeach(): { ok: boolean; msg: string } {
    const day = this.calendar ? this.calendar.dayIndex() : this.peachGrantDay;
    if (this.peach < 1) return { ok: false, msg: '蟠桃点不足——赴蟠桃宴方可获赐（R5 瑶池青鸾任务线）' };
    if (day !== this.peachGrantDay) this.peachGrantedToday = 0;   // 跨日自动清零（不依赖 onNewDay 回调）
    if (this.peachGrantedToday >= 1) return { ok: false, msg: '今日已蒙赏赐' };
    this.peachGrantDay = day;
    this.peach -= 1;
    this.peachGrantedToday += 1;
    this.earn(100);   // 内部已 save()（写入渡票 / 每日计数等全部字段）
    return { ok: true, msg: '蟠桃赏赐：蟠桃点 -1，铜钱 +100（单向，不可回兑）' };
  }

  /**
   * FIX-012 R3：冥途牒 —— 阴德 -10 → 忘川渡票 +1（上限 3）。
   * 不再产蟠桃（拆除 V16 §4.3 兑换表禁边），蟠桃数量必须不变；阴德 sink 保留。
   */
  redeemFerryTicket(): { ok: boolean; msg: string } {
    if (this.yinde < YINDE_COST) {
      return { ok: false, msg: `阴德不足（需 ${YINDE_COST}，现 ${this.yinde}）——多烧些纸钱积攒功德` };
    }
    if (this.ferryTicket >= FERRY_TICKET_CAP) {
      return { ok: false, msg: `忘川渡票已满（上限 ${FERRY_TICKET_CAP}）——冥途牒暂不生效` };
    }
    this.yinde -= YINDE_COST;
    this.ferryTicket += 1;
    this.save();
    return { ok: true, msg: `冥途牒生效：阴德 -${YINDE_COST}，忘川渡票 +1（现 🎫${this.ferryTicket}）` };
  }

  refund(n: number): void { this.coins += n; this.save(); bus.emit('coins:change', this.coins); } // 蟠桃不足回退已扣款
  /** 存盘（P1-2 生存循环等系统共用；语义=持久化三币快照） */
  save(): void {
    // 全量审核 2026-11-07（B-06）：legacy 影子档原先只写 cq_coins，而构造函数与
    // legacyFromLocalStorage 都读三键；IDB 降级回退时阴德 / 蟠桃会退回旧值。
    localStorage.setItem('cq_coins', String(this.coins));
    localStorage.setItem('cq_yinde', String(this.yinde));
    localStorage.setItem('cq_peach', String(this.peach));
    // FIX-012 R2/R3：渡票 + 每日赏赐计数入影子档（向后兼容：旧档缺键由 load() 用缺省）
    localStorage.setItem('cq_ferry_ticket', String(this.ferryTicket));
    localStorage.setItem('cq_peach_granted_today', String(this.peachGrantedToday));
    localStorage.setItem('cq_peach_grant_day', String(this.peachGrantDay));
    // P0-4/P1-2 全量写档：三币 + survival + voxel + karma + entities + bossDefeated → IndexedDB
    try {
      // __saveSave 在 window 上（world.ts 注入）；world 句柄已提前到 initUI 之前注入（B-02），
      // 启动期这一次 IDB 写不再被整段跳过（蓝队 §二.1 的 100% 确定时序）。
      const W = (window as unknown as {
        __saveSave?: (d: unknown) => Promise<unknown>;
        __qingming?: { world?: {
          survival?: { serialize(): unknown };
          voxelStore?: { serialize(): number[] };
          karma?: { current(): { karma: number } };
          boss?: { defeated: boolean };
        } };
      });
      const sv = W.__qingming?.world;
      if (W.__saveSave && sv?.survival && sv.voxelStore) {
        // 全量审核 2026-11-07（C01）：entities 恒 []、collectPersistedEntities 全仓零调用，
        // 使造物（creation.ts 的 allocate persist:true）永远无法跨会话重演。
        // 全量审核 2026-11-07（C02）：try/catch 只挡同步抛错，挡不住 Promise rejection，
        // 必须显式 .catch 才能让写档失败可观测。
        void W.__saveSave({
          schemaVersion: 2,
          economy: {
            coins: this.coins, yinde: this.yinde, peach: this.peach,
            ferryTicket: this.ferryTicket,
            peachGrantedToday: this.peachGrantedToday,
            peachGrantDay: this.peachGrantDay,
          },
          // 全量审核 2026-11-07（C01 口径收窄）：只收集 creation。
          // crowd.ts:1366 给每个 NPC 都登记 persist:true（全城 4500+ 实例且 pos 是实时引用），
          // 全量收集会把它们每帧变化的坐标全写进档、体积暴涨；读档侧也只重演造物。
          entities: collectPersistedEntities(['creation']),
          voxel: sv.voxelStore.serialize(),
          survival: sv.survival.serialize(),
          karma: sv.karma ? sv.karma.current().karma : 0,
          bossDefeated: !!sv.boss?.defeated,
        }).catch((err: unknown) => { console.warn('[存档] 写档失败', err); });
      }
    } catch { /* 存档失败不阻断游戏 */ }
    bus.emit('coins:change', this.coins);
  }

  /** 同名动作复位定时器（全量审核 2026-11-07 / M-05：旧版每次 act 都新建 timer 不取消，
   * 同名动作的第一个 timer 会提前把「第二次表演」清回 stand） */
  private actionTimer: number | null = null;

  /** 交互动作：玩家表演某动作若干秒 */
  act(action: string, seconds: number, say: string): void {
    const a = this.player.actor;
    a.action = action;
    this.player.busyUntil = this.player.clock() + seconds * 1000;
    if (this.actionTimer !== null) window.clearTimeout(this.actionTimer);
    this.actionTimer = window.setTimeout(() => {
      this.actionTimer = null;
      if (this.player.actor.action === action) this.player.actor.action = 'stand';
    }, seconds * 1000);
    bus.emit('ui:toast', say);
  }

  // ---- 面板 ----
  private closePanel(): void { this.panel?.remove(); this.panel = null; }
  private makePanel(title: string): HTMLElement {
    this.closePanel();
    const p = document.createElement('div');
    p.className = 'panel show';
    // 全量审核 2026-11-07（UI-09）：内联 z-index 优先级高于 style.css 的 .panel 规则，
    // 原先 30 低于 #goalchain 的 62，面板文字被目标链盖住；与 CSS 侧统一为 70。
    p.style.cssText = 'left:50%;bottom:110px;transform:translateX(-50%);max-height:min(70vh,520px);z-index:70;';
    p.innerHTML = `<div class="panel-head"><h3>${title}</h3><span class="panel-close">✕</span></div><div class="panel-body"></div>`;
    p.querySelector('.panel-close')!.addEventListener('click', () => this.closePanel());
    this.root.appendChild(p);
    this.panel = p;
    return p.querySelector('.panel-body')!;
  }

  openShop(shopName: string, goods: Good[]): void {
    const body = this.makePanel(shopName + `（💰 ${this.coins} 文）`);
    for (const g of goods) {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<label>${g.name}<span style="color:#ffb300"> · ${g.price} 文</span></label>`;
      const b = document.createElement('button');
      b.className = 'dock-btn';
      b.style.cssText = 'min-width:64px;';
      b.textContent = '买';
      b.onclick = () => {
        let say = g.say;
        // 全量审核 2026-11-07（P-03 / P-06 / P-01）：
        // 旧实现所有商品先走通用 pay(g.price) 扣铜钱，三币商品再在后面特判，
        // 于是 ① 蟠桃赏赐 price=1 被当成「1 文铜钱」扣掉，实结净 +99 而非文案的 100，
        //      且 coins=0 时 pay(1) 直接失败、有蟠桃也兑不了（P-06）；
        //    ② 冥途牒满仓时 addPeach 静默丢弃，但 10 阴德 + 10 文已扣且不回滚（P-03）；
        //    ③ 付费饮食只播动作、从不回饥饿/血，生存循环断裂（P-01）。
        // 现在把「资源轴商品」提到通用扣款之前独立结算，普通商品才走 pay。
        if (g.act === 'peachgrant') {
          // 蟠桃点是独立资源，不占铜钱；price 字段语义为「1 枚蟠桃点」，不再是铜钱价
          const r = this.grantPeach();
          bus.emit('ui:toast', r.msg);
          if (r.ok) {
            this.act('pray', 3.5, say);
            this.coinsEl && (this.coinsEl.textContent = `💰 ${this.coins} 文`);
          }
          return;
        }
        if (!this.pay(g.price)) return;
        if (g.act === 'burnpaper') { this.yinde += 1; this.save(); bus.emit('ui:toast', `纸灰化作阴德 💠 ${this.yinde}（三界单向：不可兑回铜钱）`); }
        else if (g.act === 'yindepeach') {
          // FIX-012 R3：冥途牒改产忘川渡票（阴德 -10 → 渡票 +1，上限 3），不再产蟠桃。
          // 失败时全额退还已扣铜钱（旧版只回滚「阴德不足」一种失败，满仓静默吞掉的缺陷同步修掉）。
          const r = this.redeemFerryTicket();
          if (!r.ok) this.refund(g.price);
          bus.emit('ui:toast', r.ok ? r.msg : `${r.msg}，铜钱已退还`);
        }
        else if (g.act === 'eat' || g.act === 'drink') {
          const [hg, hp] = InteractSystem.foodRestore(g.price);
          const msg = this.survivalSink ? this.survivalSink(hg, hp) : '';
          // 合并进动作文案：act() 自己会发一次 toast，分两条发后者会立刻覆盖前者
          if (msg) say = `${g.say}（${msg}）`;
        }
        this.act(g.act === 'burnpaper' ? 'pray' : g.act, 3.5, say);
        this.coinsEl && (this.coinsEl.textContent = `💰 ${this.coins} 文`);
      };
      row.appendChild(b);
      body.appendChild(row);
    }
  }

  private coinsEl: HTMLElement | null = null;

  // ---- 骰子赌局（押大小） ----
  openDice(): void {
    const body = this.makePanel(`赌坊·骰宝（💰 ${this.coins} 文）`);
    this.coinsEl = null;
    const info = document.createElement('div');
    info.className = 'hint';
    info.textContent = '三枚骰子，点数总和 11 及以上为大，10 及以下为小。押中翻倍。';
    body.appendChild(info);
    const betRow = document.createElement('div');
    betRow.className = 'set-row';
    betRow.innerHTML = '<label>押注</label>';
    const seg = document.createElement('div');
    seg.className = 'seg';
    let bet = 20;
    for (const n of [10, 20, 50, 100]) {
      const b = document.createElement('button');
      b.textContent = String(n);
      if (n === bet) b.classList.add('on');
      b.onclick = () => { bet = n; seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
      seg.appendChild(b);
    }
    betRow.appendChild(seg);
    body.appendChild(betRow);
    const rollRow = document.createElement('div');
    rollRow.className = 'set-row';
    rollRow.innerHTML = '<label>买定离手</label>';
    const big = document.createElement('button'); big.className = 'dock-btn'; big.textContent = '押大';
    const small = document.createElement('button'); small.className = 'dock-btn'; small.textContent = '押小';
    const diceBox = document.createElement('div');
    diceBox.style.cssText = 'display:flex;gap:6px;justify-content:center;padding:10px 0;';
    const roll = (pickBig: boolean): void => {
      if (!this.pay(bet)) return;
      const dice = [0, 0, 0].map(() => 1 + Math.floor(this.rng() * 6));
      const sum = dice[0] + dice[1] + dice[2];
      const isBig = sum >= 11;
      const win = pickBig === isBig;
      diceBox.innerHTML = dice.map((d) => `<span style="display:inline-flex;width:34px;height:34px;border:1px solid #00e5ff55;border-radius:6px;align-items:center;justify-content:center;color:#fff;background:#101828">${d}</span>`).join('') + `<span style="align-self:center;margin-left:8px;color:#ffb300">共 ${sum} 点 · ${win ? '赢了 +' + bet : '输了 -' + bet} 文</span>`;
      if (win) { this.earn(bet * 2); this.act('dice', 2, '手气不错！庄家赔了钱，脸色发青'); }
      else this.act('dice', 2, '又输了吗……再来一把回本');
      info.textContent = `三枚骰子，总和 11 及以上为大，10 及以下为小。押中翻倍。（💰 ${this.coins} 文）`;
    };
    big.onclick = () => roll(true);
    small.onclick = () => roll(false);
    rollRow.appendChild(small); rollRow.appendChild(big);
    body.appendChild(rollRow);
    body.appendChild(diceBox);
  }

  // ---- 五子棋（9 路，先手黑 vs 简易 AI） ----
  openGomoku(): void {
    // P1-1 资源轴（H6 修订③）：五子棋原为零成本入水口（免费 +100/局可无限刷）。
    // 收费 50 文入场——赢 +100 净 +50，低于扛包速率，保留娱乐价值但关套利。
    if (!this.pay(50)) return;
    const body = this.makePanel('手谈一局·五子棋（赢棋 +100 文）');
    const N = 9, CELL = 30;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N * CELL + CELL;
    cv.style.cssText = 'display:block;margin:0 auto;touch-action:none;';
    body.appendChild(cv);
    const info = document.createElement('div');
    info.className = 'hint';
    info.textContent = '你执黑先行，五连即胜。';
    body.appendChild(info);
    const bd: number[][] = Array.from({ length: N }, () => Array(N).fill(0)); // 0空 1黑 2白
    let over = false;
    const ctx = cv.getContext('2d')!;
    const draw = (): void => {
      ctx.fillStyle = '#d8b878';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#5a4020';
      for (let i = 0; i <= N; i++) {
        ctx.beginPath(); ctx.moveTo(CELL / 2 + i * CELL, CELL / 2); ctx.lineTo(CELL / 2 + i * CELL, CELL / 2 + N * CELL); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(CELL / 2, CELL / 2 + i * CELL); ctx.lineTo(CELL / 2 + N * CELL, CELL / 2 + i * CELL); ctx.stroke();
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        if (!bd[i][j]) continue;
        ctx.beginPath();
        ctx.arc(CELL / 2 + i * CELL, CELL / 2 + j * CELL, CELL * 0.42, 0, 7);
        ctx.fillStyle = bd[i][j] === 1 ? '#101418' : '#f0f4f8';
        ctx.fill();
        ctx.strokeStyle = '#00000033'; ctx.stroke();
      }
    };
    const winAt = (x: number, y: number, p: number): boolean => {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let n = 1;
        for (const s of [1, -1]) {
          let i = x + dx * s, j = y + dy * s;
          while (i >= 0 && i < N && j >= 0 && j < N && bd[i][j] === p) { n++; i += dx * s; j += dy * s; }
        }
        if (n >= 5) return true;
      }
      return false;
    };
    const aiMove = (): void => {
      // 简易 AI：先找自己成五/堵对方五，再评分落子
      const cand: [number, number, number][] = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        if (bd[i][j]) continue;
        let score = 7 - Math.abs(i - 4) - Math.abs(j - 4);
        for (const p of [2, 1]) {
          for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            let c = 0;
            for (const s of [1, -1]) {
              let ii = i + dx * s, jj = j + dy * s;
              while (ii >= 0 && ii < N && jj >= 0 && jj < N && bd[ii][jj] === p) { c++; ii += dx * s; jj += dy * s; }
            }
            if (c >= 4) score += p === 2 ? 1000 : 900;
            else if (c === 3) score += p === 2 ? 60 : 50;
            else score += c * c * 4;
          }
        }
        cand.push([i, j, score]);
      }
      cand.sort((a, b) => b[2] - a[2]);
      // 全量审核 2026-11-07（P-11）：9 路 81 格填满且未五连时 cand 为空，
      // 旧版直接解构 cand[0] 抛 TypeError（由落子后的 260ms setTimeout 触发）。
      if (!cand.length) { over = true; info.textContent = '满盘和棋——棋逢对手，入场费已记'; draw(); return; }
      const [bi, bj] = cand[0];
      bd[bi][bj] = 2;
      if (winAt(bi, bj, 2)) { over = true; info.textContent = '白棋胜了——胜负乃兵家常事。'; return; }
      draw();
    };
    cv.addEventListener('pointerdown', (e) => {
      if (over) return;
      const rect = cv.getBoundingClientRect();
      const i = Math.round((e.clientX - rect.left - CELL / 2) / CELL);
      const j = Math.round((e.clientY - rect.top - CELL / 2) / CELL);
      if (i < 0 || i >= N || j < 0 || j >= N || bd[i][j]) return;
      bd[i][j] = 1;
      if (winAt(i, j, 1)) { over = true; draw(); info.textContent = '你赢了！赢得彩钱 100 文。'; this.earn(100); this.act('sitTea', 2, '一局 手谈 胜负已分'); return; }
      draw();
      window.setTimeout(() => { if (!over) aiMove(); }, 260);
    });
    draw();
  }

  /** 只有文本真的变化才写 DOM：提示每帧都在算，但绝大多数帧内容不变 */
  private setPrompt(text: string): void {
    if (text === this.promptText) return;
    this.promptText = text;
    this.prompt.textContent = text;
    this.prompt.classList.toggle('show', !!text);
  }

  /** 每帧：更新提示与最近交互 */
  update(): void {
    const p = this.player;
    if (p.mode !== 'avatar' || (p.state !== 'foot' && p.state !== 'swim')) {
      if (p.state === 'mount' && p.mounted) this.setPrompt('E · 下' + p.mounted.name);
      else if (p.state === 'boat' && p.boat) this.setPrompt('E · 下船（W前进 A/D转舵）');
      else this.setPrompt('');
      return;
    }
    let best: Interactable | null = null, bd = Infinity;
    for (const it of this.list) {
      if (it.enabled && !it.enabled()) continue;
      const d = it.pos.distanceToSquared(p.actor.pos);
      if (d < it.r * it.r && d < bd) { bd = d; best = it; }
    }
    this.nearest = best;
    this.setPrompt(best ? 'E · ' + best.label : '');
  }
}
