// ============================================================================
// 建造模式（P1-2 · D3 最小可玩闭环）· src/game/buildMode.ts
//
// 交互（D10 §1.4 MC 侧口径）：
//   G        进/出建造模式（裁决 spec P1-8 §1：G=建造；hotbar 显示 + 中央准星）
//   1–8      选方块（营造土/青石/松木/城砖/琉璃/鎏金/碧玉/玄墨）
//   左键     放置（射线命中面外邻格）
//   右键     拆除（命中格置空；基座保护：y=0 不可拆防塌陷穿模）
//   距离限 12m；仅体素区内可操作
// 存档：serialize 全量进 SaveDataV2.voxel（读档 deserialize 恢复）。
// ============================================================================
import * as THREE from 'three';
import { BLOCK_COUNT, BLOCK_NAMES, VOX, inArea, voxelStore } from '../rt/voxelStore';
import { rebuildVoxelMesh } from './voxelMesh';

export class BuildMode {
  active = false;
  selected = 1;
  /** P1-2 资源化：放置扣 10 文 / 拆除返 2 文（main 注入 interact.tryPay/earn——资源轴闭环） */
  spend: ((coins: number) => boolean) | null = null;
  earn: ((coins: number) => void) | null = null;                                  // 当前方块类型（1-8）
  private mesh: THREE.Mesh | null = null;
  private hotbar: HTMLElement | null = null;
  private crosshair: HTMLElement | null = null;
  private raycaster = new THREE.Raycaster();
  private maxDist = 12;

  constructor(
    private scene: () => THREE.Scene,
    private camera: () => THREE.Camera,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG') this.toggle();
      if (!this.active) return;
      const n = Number(e.key);
      if (n >= 1 && n <= BLOCK_COUNT) this.select(n);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) this.place();
      else if (e.button === 2) this.breakBlock();
    });
    window.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
  }

  /** 挂世界网格 + hotbar DOM（world 就绪后调一次） */
  init(mesh: THREE.Mesh, uiRoot: HTMLElement): void {
    this.mesh = mesh;
    this.hotbar = document.createElement('div');
    this.hotbar.id = 'hotbar';
    this.hotbar.style.cssText = 'position:absolute;bottom:96px;left:50%;transform:translateX(-50%);display:none;gap:6px;pointer-events:auto;';
    for (let i = 1; i <= BLOCK_COUNT; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      slot.dataset.slot = String(i);
      slot.style.cssText = 'width:52px;height:52px;border:2px solid rgba(0,229,255,.35);border-radius:8px;background:rgba(10,14,24,.8);display:flex;align-items:center;justify-content:center;flex-direction:column;';
      const sw = document.createElement('div');
      const c = new THREE.Color(([[0x8a6a42],[0x8d8d95],[0x7a5230],[0xa8503c],[0x4fa8a0],[0xd4af37],[0x7ec8a0],[0x2a2a35]][i - 1])[0]);
      sw.style.cssText = `width:26px;height:26px;border-radius:4px;background:#${c.getHexString()};`;
      const label = document.createElement('span');
      label.style.cssText = 'font-size:10px;color:#cfe6f2;';
      label.textContent = String(i);
      slot.appendChild(sw); slot.appendChild(label);
      slot.onclick = () => this.select(i);
      this.hotbar.appendChild(slot);
    }
    uiRoot.appendChild(this.hotbar);
    this.crosshair = document.createElement('div');
    this.crosshair.id = 'crosshair';
    this.crosshair.style.cssText = 'position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;display:none;pointer-events:none;';
    this.crosshair.innerHTML = '<svg width="14" height="14"><path d="M7 0V14M0 7H14" stroke="#e8f4ff" stroke-width="1.5" opacity="0.9"/></svg>';
    uiRoot.appendChild(this.crosshair);
    this.paint();
  }

  toggle(): void {
    this.active = !this.active;
    if (this.hotbar) this.hotbar.style.display = this.active ? 'flex' : 'none';
    if (this.crosshair) this.crosshair.style.display = this.active ? 'block' : 'none';
    window.dispatchEvent(new CustomEvent('buildmode', { detail: { active: this.active } }));
  }

  select(n: number): void {
    this.selected = n;
    this.paint();
  }

  private paint(): void {
    if (!this.hotbar) return;
    Array.from(this.hotbar.children).forEach((slot, i) => {
      const el = slot as HTMLElement;
      el.style.borderColor = i + 1 === this.selected ? '#ffd25e' : 'rgba(0,229,255,.35)';
      el.style.boxShadow = i + 1 === this.selected ? '0 0 12px rgba(255,210,94,.6)' : 'none';
    });
  }

  private aim(): { hit: THREE.Intersection; faceNormal: THREE.Vector3; gx: number; gy: number; gz: number } | null {
    if (!this.mesh) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera());
    this.raycaster.far = this.maxDist;
    const hits = this.raycaster.intersectObject(this.mesh, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const face = hit.face;
    if (!face) return null;
    // 命中点回退半格 = 命中格本身；前进半格 = 放置格
    const p = hit.point;
    const n = face.normal;
    const faceNormal = n.clone();
    const gx = Math.floor(p.x - n.x * 0.5 - VOX.ox);
    const gy = Math.floor(p.y - n.y * 0.5 - VOX.oy);
    const gz = Math.floor(p.z - n.z * 0.5 - VOX.oz);
    return { hit, faceNormal, gx, gy, gz };
  }

  /** 左键：命中面外邻格放置当前方块（体素区内、不与玩家脚柱冲突由玩家自查——简化 v0） */
  place(): void {
    const aim = this.aim();
    if (!aim) return;
    const n = aim.faceNormal;
    const px = aim.gx + Math.round(n.x), py = aim.gy + Math.round(n.y), pz = aim.gz + Math.round(n.z);
    if (!inArea(VOX.ox + px, VOX.oz + pz) || py < 1 || py >= VOX.ny) return;   // 基座层 y=0 之上才可放
    if (voxelStore.get(px, py, pz) !== 0) return;
    if (this.spend && !this.spend(10)) return;   // P1-2 资源化：10 文/块（买不起不落）
    voxelStore.set(px, py, pz, this.selected);
    if (this.mesh) rebuildVoxelMesh(this.mesh);
  }

  /** 右键：拆除命中格（y=0 基座保护：拆了会漏出虚空穿模） */
  breakBlock(): void {
    const aim = this.aim();
    if (!aim) return;
    if (aim.gy <= 0) return;
    if (voxelStore.get(aim.gx, aim.gy, aim.gz) === 0) return;
    if (this.earn) this.earn(2);                 // P1-2 资源化：拆除返 2 文（回收）
    voxelStore.set(aim.gx, aim.gy, aim.gz, 0);
    if (this.mesh) rebuildVoxelMesh(this.mesh);
  }
}
