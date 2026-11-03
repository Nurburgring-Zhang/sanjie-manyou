import * as THREE from 'three';
import type { PlayerController } from './player';
import { bus } from '../core/rng';

// ============ 交互系统：提示 / 铜钱经济 / 商铺 / 骰子赌局 / 五子棋 ============
export interface Interactable {
  pos: THREE.Vector3;
  r: number;
  label: string;
  exec: () => void;
  enabled?: () => boolean;
}

interface Good { name: string; price: number; act: string; say: string }

export class InteractSystem {
  coins = 0;
  yinde = 0;    // 阴德（地府币；只可烧纸单向获得）
  peach = 3;    // 蟠桃点（天宫币；赏赐单向兑铜钱）
  list: Interactable[] = [];
  private prompt: HTMLElement;
  private root: HTMLElement;
  private panel: HTMLElement | null = null;
  private nearest: Interactable | null = null;
  /** 上一次写进 #interact-prompt 的文本：相同就一个 DOM 写都不发 */
  private promptText: string | null = null;

  constructor(uiRoot: HTMLElement, private player: PlayerController) {
    this.root = uiRoot;
    this.prompt = document.createElement('div');
    this.prompt.id = 'interact-prompt';
    uiRoot.appendChild(this.prompt);
    this.coins = parseInt(localStorage.getItem('cq_coins') ?? '500', 10) || 500;
    this.yinde = parseInt(localStorage.getItem('cq_yinde') ?? '0', 10) || 0;
    this.peach = parseInt(localStorage.getItem('cq_peach') ?? '3', 10) || 3;
    this.player.interactHook = () => {
      const n = this.nearest;
      if (n) { n.exec(); }
    };
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
  refund(n: number): void { this.coins += n; this.save(); bus.emit('coins:change', this.coins); } // 蟠桃不足回退已扣款
  private save(): void {
    localStorage.setItem('cq_coins', String(this.coins));
    bus.emit('coins:change', this.coins);
  }

  /** 交互动作：玩家表演某动作若干秒 */
  act(action: string, seconds: number, say: string): void {
    const a = this.player.actor;
    a.action = action;
    this.player.busyUntil = performance.now() + seconds * 1000;
    window.setTimeout(() => { if (this.player.actor.action === action) this.player.actor.action = 'stand'; }, seconds * 1000);
    bus.emit('ui:toast', say);
  }

  // ---- 面板 ----
  private closePanel(): void { this.panel?.remove(); this.panel = null; }
  private makePanel(title: string): HTMLElement {
    this.closePanel();
    const p = document.createElement('div');
    p.className = 'panel show';
    p.style.cssText = 'left:50%;bottom:110px;transform:translateX(-50%);max-height:min(70vh,520px);z-index:30;';
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
        if (this.pay(g.price)) {
          // B9 三币特判：烧纸（铜钱→阴德单向）/ 蟠桃赏赐（蟠桃点→铜钱单向）
          if (g.act === 'burnpaper') { this.yinde += 1; this.save(); bus.emit('ui:toast', `纸灰化作阴德 💠 ${this.yinde}（三界单向：不可兑回铜钱）`); }
          else if (g.act === 'peachgrant') {
            // B10 蟠桃宴事件（总纲 §四.5：蟠桃点→铜钱单向）：耗 1 点兑 100 文
            if (this.peach < 1) { this.refund(g.price); bus.emit('ui:toast', '蟠桃点不足——赴蟠桃宴方可获赐（R5 瑶池青鸾任务线）'); }
            else { this.peach -= 1; this.earn(100); this.save(); bus.emit('ui:toast', `蟠桃赏赐：蟠桃点 -1，铜钱 +100（单向，不可回兑）`); }
          }
          this.act(g.act === 'burnpaper' || g.act === 'peachgrant' ? 'pray' : g.act, 3.5, g.say);
          this.coinsEl && (this.coinsEl.textContent = `💰 ${this.coins} 文`);
        }
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
      const dice = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
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
