import * as THREE from 'three';
import { levelOf, LEVEL_PLAN } from '../data/levelPlan';

// ============ 精修3（对标落地）：POI 方位导引箭头 ============
// 技法：Vector3.project(camera) → NDC；出屏 clamp 屏缘旋转箭头（Vouzamo HUD / SO-27409074）
// 每 8 帧刷新一次（廉价），只导引最近核心 POI

const GUIDE_KEYS = ['sunyang', 'bridge', 'goulan', 'yamen', 'yanluo', 'naihe', 'lingxiao', 'yaochi', 'jiangtai', 'sansheng'];

interface PoiLite { name: string; pos: THREE.Vector3 }

export class PoiGuide {
  private el: HTMLDivElement;
  private arrow: HTMLDivElement;
  private label: HTMLDivElement;
  private frame = 0;
  /** 当前导引节点（即使被隐藏也要更新，否则探针/DOM 读到的是上一个节点的目标 — 实测踩过） */
  private last: { key: string; name: string; objective: string; dist: number } | null = null;

  current(): { key: string; name: string; objective: string; dist: number } | null {
    return this.last;
  }

  /** 目标达成查询（由 world 注入，避免 poiGuide 反向依赖 world） */
  private isDone: (key: string) => boolean = () => false;
  setDoneQuery(fn: (key: string) => boolean): void { this.isDone = fn; }

  constructor(uiRoot: HTMLElement, private pois: () => { name: string; pos: THREE.Vector3 }[]) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;z-index:60;pointer-events:none;transform:translate(-50%,-50%);text-align:center;transition:left .18s,top .18s;';
    this.arrow = document.createElement('div');
    this.arrow.textContent = '➤';
    this.arrow.style.cssText = 'font-size:26px;color:#ffd25e;text-shadow:0 0 8px rgba(255,180,40,.9);line-height:1;';
    this.label = document.createElement('div');
    this.label.style.cssText = 'font-size:12px;color:#ffe9c8;background:rgba(10,8,6,.55);padding:2px 7px;border-radius:8px;margin-top:2px;'
      + 'white-space:pre-line;line-height:1.35;max-width:240px;text-align:center;';
    this.el.appendChild(this.arrow); this.el.appendChild(this.label);
    uiRoot.appendChild(this.el);
  }

  update(camera: THREE.Camera, playerPos: THREE.Vector3, allPois: Record<string, PoiLite>): void {
    if ((this.frame++ & 7) !== 0) return;
    // 最近核心 POI
    // 候选集 = 全部「有关卡计划」的 POI ∪ 既有导引键。
    // 旧版只在 10 个导引键里取最近，站在紫宸殿会显示 3.7km 外三生石的目标 —— 目标行必须跟当前所在节点走。
    const cand = new Set<string>([...Object.keys(LEVEL_PLAN), ...GUIDE_KEYS]);
    let best: PoiLite | null = null, bd = Infinity, bestKey = '';
    for (const k of cand) {
      const p = allPois[k];
      if (!p) continue;
      const d = p.pos.distanceToSquared(playerPos);
      if (d < bd) { bd = d; best = p; bestKey = k; }
    }
    if (!best) { this.el.style.display = 'none'; return; }
    const dist = Math.sqrt(bd);
    const lv0 = levelOf(bestKey);
    this.last = { key: bestKey, name: best.name, objective: lv0.objective, dist };
    const done = this.isDone(bestKey);
    // 文本先写：抵达后箭头隐藏，但目标行必须已是当前节点（否则读到的还是上一个 POI）
    this.label.textContent = `${best.name} ${Math.round(dist)}m ${done ? '✓' : ''}
${lv0.objective}`;
    if (dist < 26) { this.el.style.display = 'none'; return; } // 已抵达隐藏
    const ndc = best.pos.clone().project(camera);
    const onScreen = ndc.z > 0 && ndc.z < 1 && Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.88;
    const W = window.innerWidth, H = window.innerHeight;
    let sx: number, sy: number;
    if (onScreen) {
      sx = (ndc.x * 0.5 + 0.5) * W; sy = (-ndc.y * 0.5 + 0.5) * H;
      this.el.style.display = 'none';
      return;
    }
    // 屏缘 clamp：方向取 NDC 平面角
    const ang = Math.atan2(ndc.x, ndc.y); // 屏幕上方向为 0
    const rx = Math.min(0.9, Math.abs(Math.sin(ang)) * 1.2) * Math.sign(Math.sin(ang) || 1);
    const ry = Math.min(0.82, Math.abs(Math.cos(ang)) * 1.2) * Math.sign(Math.cos(ang) || 1);
    sx = (Math.abs(Math.sin(ang)) > Math.abs(Math.cos(ang)) ? rx : (ndc.x > 0 ? 0.9 : -0.9)) * 0.5 * W + W / 2;
    sy = (Math.abs(Math.sin(ang)) > Math.abs(Math.cos(ang)) ? (ndc.y > 0 ? 0.82 : -0.82) : ry) * 0.5 * H + H / 2;
    this.el.style.display = 'block';
    this.el.style.left = sx + 'px';
    this.el.style.top = sy + 'px';
    this.arrow.style.transform = `rotate(${(ang * 180 / Math.PI + 90).toFixed(0)}deg)`;
    // 关卡四件套：目标随最近 POI 显示（威胁与恢复点在图鉴/帮助里查，HUD 只放最需要的一行）
    const lv = levelOf(bestKey);
    this.label.textContent = `${best.name} ${Math.round(dist)}m
${lv.objective}`;
    void this.pois;
  }
}
