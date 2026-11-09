// ============================================================================
// 造物链（S10/S11 · 核心愿景「我要一条龙」最小可玩版）· src/game/creation.ts
//
// 玩家流程：Y 键 → 命令条输入 → 关键词匹配模板 + seed=hash(全文) → 程序化几何
//   （同愿同物）→ 四门校验 → 扣 100 文 → 落场 → 实体表登记 persist → 存档重演。
// H3 结论：手写一条龙 1,141 tri 实证可行——本文件将其变为游戏内实时功能。
// ============================================================================
import * as THREE from 'three';
import { allocate, get, forEach, dispose, type EntityId } from '../rt/entity';
import { buildTemplateGeo, matchTemplate, CREATION_TEMPLATES, type CreationTemplate } from './creationTemplates';
import { bus } from '../core/rng';

const CREATION_COST = 100;
const MAX_TRIS = 20000;
const MAX_EDGE_M = 200;
export const WISH_KEY = 'KeyY';

function hashText(text: string): number {
  let s = 0;
  for (let i = 0; i < text.length; i++) s = (Math.imul(s, 31) + text.charCodeAt(i)) >>> 0;
  return s >>> 0;
}

export interface WishResult {
  ok: boolean;
  reason: string;
  templateId?: string;
  tris?: number;
  eid?: EntityId;
}

export class CreationSystem {
  private bar: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private busy = false;
  private scene: THREE.Scene | null = null;
  private meshes = new Map<EntityId, THREE.Mesh>();
  /** 落点回调（world 注入：玩家前方 30m 地面） */
  placement: ((forward: number, side: number) => { x: number; y: number; z: number }) | null = null;
  /** 消耗回调（main 注入：interact.tryPay） */
  spend: ((coins: number) => boolean) | null = null;

  constructor(uiRoot: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.id = 'wishbar';
    wrap.style.cssText = 'position:absolute;left:50%;bottom:170px;transform:translateX(-50%);display:none;gap:8px;pointer-events:auto;';
    const input = document.createElement('input');
    input.id = 'wish-input';
    input.placeholder = '许愿：一条赤红色的龙 / 凤凰 / 玄龟 / 仙鹤 ……（消耗 100 文）';
    input.style.cssText = 'width:520px;padding:10px 14px;border:1px solid rgba(212,175,55,.55);border-radius:24px;background:rgba(8,12,20,.92);color:#ffe9b8;font-size:14px;outline:none;';
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.className = 'dock-btn';
    btn.textContent = '造';
    btn.style.cssText = 'min-width:56px;border-color:rgba(212,175,55,.55);';
    wrap.appendChild(btn);
    uiRoot.appendChild(wrap);
    this.bar = wrap;
    this.input = input;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyY' && !this.isOpen()) { this.open(); e.stopPropagation(); }
      else if (e.code === 'Escape' && this.isOpen()) { this.close(); e.stopPropagation(); }
    });
    btn.onclick = () => void this.submit();
    input.addEventListener('keydown', (e) => {
      // 全量审核 2026-11-07（UI-05 / 主线程运行时 A1 实证）：
      // 这里的 stopPropagation 在**目标阶段**阻断冒泡，会连 window 上本类自己的
      // `Escape → close()`（第 63 行）一起吞掉；实测按 Y 后 Esc 关不掉、焦点永久锁在
      // #wish-input，之后 G/J/B/T/F1/WASD 全部被 ui.ts 的 INPUT 过滤静默丢弃（交互死锁）。
      // 因此 Escape 必须在此就地处理，并显式 blur 交还焦点（close 只改 display 不够）。
      // 全量审核 2026-11-07（B-08）：KeyH 不吞，让 H 冒泡到 ui.ts 拍照模式 handler（修愿望条焦点吞 H）
      if (e.code === 'KeyH') return;
      e.stopPropagation();
      if (e.code === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.code === 'Enter') void this.submit();
    });
  }

  attachScene(scene: THREE.Scene): void { this.scene = scene; }

  isOpen(): boolean { return this.bar !== null && this.bar.style.display !== 'none'; }
  open(): void { if (this.bar) { this.bar.style.display = 'flex'; this.input?.focus(); } }
  /** 关闭时必须 blur：否则隐藏的 input 仍是 activeElement，全局快捷键会一直被吃掉 */
  close(): void {
    if (this.bar) this.bar.style.display = 'none';
    if (this.input) { this.input.value = ''; this.input.blur(); }
  }

  /** 提交愿望全链（public：探针直接调用验证） */
  async submit(text?: string): Promise<WishResult> {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (!this.input) return { ok: false, reason: 'no-ui' };
    const wish = (text ?? this.input.value).trim();
    if (!wish) return { ok: false, reason: 'empty' };
    const tpl = matchTemplate(wish);
    if (!tpl) {
      bus.emit('ui:toast', '这个愿望太缥缈……试试：龙 / 凤凰 / 玄龟 / 仙鹤 / 锦鲤 / 白虎 / 麒麟 / 浮屠');
      return { ok: false, reason: 'no-template' };
    }
    if (this.spend && !this.spend(CREATION_COST)) {
      bus.emit('ui:toast', `造物需 ${CREATION_COST} 文工本——铜钱不足（码头扛包赚些）`);
      return { ok: false, reason: 'poor' };
    }
    this.busy = true;
    if (this.input) this.input.disabled = true;
    await new Promise((r) => setTimeout(r, 60));   // L0 档让帧

    const seed = hashText(wish);
    const { geo, tris } = buildTemplateGeo(tpl, seed);
    const bytes = (geo.getAttribute('position').count + (geo.getIndex()?.count ?? 0)) * 4;
    // 内联四门（H3：面数/包围盒/字节/seed）
    const bs = geo.boundingSphere ?? geo.computeBoundingSphere(), _ = bs;
    const maxEdge = geo.boundingSphere ? geo.boundingSphere.radius * 2 : 0;
    const gateFail =
      tris > MAX_TRIS ? `tri=${tris}>${MAX_TRIS}` :
      maxEdge > MAX_EDGE_M ? `edge=${Math.round(maxEdge)}>200` :
      bytes > 8 * 1024 * 1024 ? `bytes=${bytes}>8MB` : null;
    if (gateFail) {
      this.busy = false;
      if (this.input) this.input.disabled = false;
      bus.emit('ui:toast', `造物超预算（${gateFail}）——模板需裁剪`);
      return { ok: false, reason: gateFail };
    }

    const id = `creation-${tpl.id}-${seed}`;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.name = id;
    if (this.scene) this.scene.add(mesh);
    // 落点：玩家前方 tpl.scale×30m 地面
    const drop = this.placement
      ? this.placement(30 * tpl.scale, 0)
      : { x: 30, y: 1, z: 30 };
    mesh.position.set(drop.x, drop.y, drop.z);
    const eid = allocate('creation', {
      pos: { x: drop.x, y: drop.y, z: drop.z },
      persist: true,
      object3d: mesh,
      provenance: { seed, moduleHash: tpl.id, apiVersion: 'creation.spec.v1' },
      onDispose: [() => {
        this.scene?.remove(mesh);
        mesh.geometry.dispose();
      }],
    });
    this.meshes.set(eid, mesh);
    this.busy = false;
    if (this.input) this.input.disabled = false;
    this.close();
    bus.emit('ui:toast', `${tpl.name} 降世！${tpl.lore}（tri=${tris}，id=${eid}）`);
    return { ok: true, reason: 'created', templateId: tpl.id, tris, eid };
  }

  /** 读档重演：persist 造物由 provenance 重建 mesh（world 载入链末步调用；幂等） */
  rebuildAll(): number {
    if (!this.scene) return 0;
    forEach('creation', (rec) => {
      if (this.meshes.has(rec.id)) return;
      const prov = rec.provenance as { seed: number; moduleHash: string } | undefined;
      if (!prov) return;
      const tpl = CREATION_TEMPLATES.find((t: CreationTemplate) => t.id === prov.moduleHash);
      if (!tpl) return;
      const seed = prov.seed;
      const { geo } = buildTemplateGeo(tpl, seed);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.name = `creation-${tpl.id}-${seed}`;
      mesh.position.set(rec.pos.x, rec.pos.y, rec.pos.z);
      this.scene!.add(mesh);
      this.meshes.set(rec.id, mesh);
      // 全量审核 2026-11-07（core 交叉复核隐患 A）：读档恢复的实体记录没有 object3d / onDispose，
      // 重演出来的 mesh 会变成孤儿 —— destroy(eid) 走 dispose() 时无人把它从场景摘除。
      // 这里把 submit() 同款的两项接回去，保证「重演造物」与「当场造物」生命周期一致。
      rec.object3d = mesh;
      rec.onDispose.push(() => {
        this.scene?.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(rec.id);
      });
    });
    // 全量审核 2026-11-07（core 交叉复核隐患 B）：main.ts 用本返回值赋 world.creationCount，
    // 而 HUD 条件节点 / conditions.ts 都读它。旧实现返回「本次新建数」，二次调用（HMR、
    // 重复触发）会返回 0 把计数清零。改为返回重演后的总数，使调用幂等。
    return this.meshes.size;
  }

  /** 销毁造物（测试/管理） */
  destroy(eid: EntityId): boolean {
    const rec = get(eid);
    if (!rec) return false;
    const mesh = this.meshes.get(eid);
    if (mesh) { this.scene?.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(eid); }
    return dispose(eid, 'creation-destroyed');
  }

  get count(): number { return this.meshes.size; }
}
