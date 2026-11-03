import * as THREE from 'three';
import { PoolSet } from '../actors/pools';
import type { Rideable } from '../game/player';
import type { Crowd } from '../actors/crowd';
import { heavenPoint } from '../sky/heavenFrame';

// ============ 坐骑：马 / 仙鹤 / 龙（多节跟随体）/ 麒麟 ============
const M = Array.from({ length: 10 }, () => new THREE.Matrix4());
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _sv = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
function loc(m: THREE.Matrix4, root: THREE.Matrix4, px: number, py: number, pz: number, ex: number, ey: number, ez: number, sx = 1, sy = 1, sz = 1): void {
  _e.set(ex, ey, ez); _q.setFromEuler(_e); _v.set(px, py, pz);
  _sv.set(sx, sy, sz);
  m.compose(_v, _q, _sv); m.premultiply(root);
}
const _c = new THREE.Color();
function col(hex: number, k = 1): THREE.Color { _c.setHex(hex).multiplyScalar(k); return _c; }
function root(m: THREE.Matrix4, pos: THREE.Vector3, yaw: number, s = 1): void {
  _e.set(0, yaw, 0); _q.setFromEuler(_e);
  m.compose(pos, _q, _sv.setScalar(s));
}

export class MountSystem {
  rideables: Rideable[] = [];
  constructor(private ps: PoolSet, private crowd: Crowd) {
    this.allocSlots();
    this.spawnAll();
  }

  private slots: Record<string, number> = {};
  private allocSlots(): void {
    this.slots = this.ps.allocMany({
      horseBody: 6, horseHeadN: 6, horseLeg: 24,
      craneBody: 4, craneWing: 8, craneNeck: 4, craneHead: 4,
      dragonHead: 2, dragonSeg: 28, dragonFin: 4, dragonLeg: 8, dragonHorn: 4,
      qilinBody: 4, qilinHead: 4, qilinLeg: 16, qilinMane: 12, qilinTail: 4,
    });
  }

  private mk(kind: Rideable['kind'], name: string, pos: THREE.Vector3, flying: boolean, anchor: number, scale = 1): Rideable {
    const m: Rideable = { kind, pos: pos.clone(), yaw: Math.random() * 6.28, phase: Math.random() * 9, speed: 0, flying, vy: 0, riderAnchor: anchor, name, alive: true, home: pos.clone() };
    this.rideables.push(m);
    void scale;
    return m;
  }

  private spawnAll(): void {
    // 马 ×3（码头/城门/郊野马厩）
    this.mk('horse', '骏马', new THREE.Vector3(-230, 0, 46), false, 1.5);
    this.mk('horse', '骏马', new THREE.Vector3(452, 0, 64), false, 1.5);
    this.mk('horse', '骏马', new THREE.Vector3(-420, 0, 92), false, 1.5);
    // 仙鹤 ×2（郊野柳林/码头）
    this.mk('crane', '仙鹤', new THREE.Vector3(-440, 0, 84), true, 1.35);
    this.mk('crane', '仙鹤', new THREE.Vector3(-262, 0.95, 34), true, 1.35);
    // 龙 ×2（佛塔广场 / 凌霄殿）
    this.mk('dragon', '金龙', new THREE.Vector3(516, 0, 172), true, 2.1);
    // 云龙停在天宫（旧 (−36,214.5,60) 是缩放前坐标）：走与几何相同的 2.2× + 抬升，
    // 否则抬升后它留在 214m 空中，玩家在天宫再也找不到这匹飞行坐骑。
    this.mk('dragon', '云龙', new THREE.Vector3(...heavenPoint(-36, 214.5, 60)), true, 2.1);
    // 麒麟 ×2（府衙/虹桥头）
    this.mk('qilin', '麒麟', new THREE.Vector3(544, 0, -2), false, 1.55);
    this.mk('qilin', '麒麟', new THREE.Vector3(-70, 0, 40), false, 1.55);
  }

  /** 供交互系统查询的坐骑列表（未被骑的） */
  free(): Rideable[] { return this.rideables.filter((m) => this.player?.mounted !== m && m.alive); }
  player: { mounted: Rideable | null } | null = null;

  update(t: number, dt: number): void {
    for (const m of this.rideables) {
      if (this.player && this.player.mounted === m) continue; // 被骑时由玩家驱动位姿
      // 闲置行为：原地小动作
      m.phase += dt * (m.flying ? 3.2 : 1.1);
      const dx = m.home.x - m.pos.x, dz = m.home.z - m.pos.z;
      if (Math.hypot(dx, dz) > 24 && !m.flying) { // 地面坐骑缓步回家
        m.pos.x += dx / 24 * dt * 1.2; m.pos.z += dz / 24 * dt * 1.2;
      }
      this.write(m, t);
    }
  }

  private write(m: Rideable, t: number): void {
    if (m.kind === 'horse') this.writeHorse(m, t);
    else if (m.kind === 'crane') this.writeCrane(m, t);
    else if (m.kind === 'dragon') this.writeDragon(m, t);
    else this.writeQilin(m, t);
  }

  private writeHorse(m: Rideable, _t: number): void {
    const r = M[0];
    root(r, m.pos, m.yaw, 1);
    const swing = Math.sin(m.phase) * 0.5;
    loc(M[1], r, 0, 1.02, 0, 0, 0, 0);
    this.ps.get('horseBody').set(this.slots.horseBody, M[1], col(0x6a4a30));
    loc(M[2], r, 0, 1.3, 0.72, 0.12, 0, 0);
    loc(M[3], M[2], 0, 0.28, 0.3, -0.5, 0, 0);
    this.ps.get('horseHeadN').set(this.slots.horseHeadN, M[3], col(0x7a5838));
    loc(M[2], r, 0, 1.55, -0.55, 0.35, 0, 0);
    this.ps.get('horseHeadN').set(this.slots.horseHeadN + 1, M[2], col(0x5a3e26));
    const ly = 0.66, lg = Math.sin(m.phase) * 0.5;
    loc(M[3], r, -0.19, ly, 0.48, lg, 0, 0); this.ps.get('horseLeg').set(this.slots.horseLeg, M[3], col(0x4a3520));
    loc(M[4], r, 0.19, ly, 0.48, -lg, 0, 0); this.ps.get('horseLeg').set(this.slots.horseLeg + 1, M[4], col(0x4a3520));
    loc(M[5], r, -0.19, ly, -0.48, -lg, 0, 0); this.ps.get('horseLeg').set(this.slots.horseLeg + 2, M[5], col(0x4a3520));
    loc(M[6], r, 0.19, ly, -0.48, lg, 0, 0); this.ps.get('horseLeg').set(this.slots.horseLeg + 3, M[6], col(0x4a3520));
    void _t;
  }

  private writeCrane(m: Rideable, t: number): void {
    const r = M[0];
    root(r, m.pos, m.yaw, 1);
    const flap = Math.sin(m.phase * 1.6);
    loc(M[1], r, 0, 1.02, 0, 0, 0, 0, 0.62, 0.66, 1.15);
    this.ps.get('craneBody').set(this.slots.craneBody, M[1], col(0xf0f4f8));
    loc(M[2], r, 0, 1.42, 0.42, -0.9, 0, 0);
    this.ps.get('craneNeck').set(this.slots.craneNeck, M[2], col(0xf0f4f8));
    loc(M[3], M[2], 0, 0.55, 0.1, 0.75, 0, 0);
    this.ps.get('craneHead').set(this.slots.craneHead, M[3], col(0xe8f0f4));
    // 双翼
    const wa = m.flying || Math.abs(flap) > 0.6 ? flap * 0.7 : 1.15;
    loc(M[4], r, -0.42, 1.28, 0, 0, 0, -wa, 1.5, 0.1, 0.62);
    loc(M[5], r, 0.42, 1.28, 0, 0, 0, wa, 1.5, 0.1, 0.62);
    this.ps.get('craneWing').set(this.slots.craneWing, M[4], col(0xdde8f0, 0.98));
    this.ps.get('craneWing').set(this.slots.craneWing + 1, M[5], col(0xdde8f0, 0.98));
    this.ps.get('craneWing').set(this.slots.craneWing + 2, M[4], col(0x2a2e34, 0.9));
    this.ps.get('craneWing').set(this.slots.craneWing + 3, M[5], col(0x2a2e34, 0.9));
    // 尾/顶丹
    loc(M[4], r, 0, 1.1, -0.62, 0.3, 0, 0);
    this.ps.get('craneNeck').set(this.slots.craneNeck + 1, M[4], col(0x2a2e34));
    loc(M[5], M[3], 0, 0.16, 0.1, 0, 0, 0, 0.4, 0.4, 0.4);
    this.ps.get('craneHead').set(this.slots.craneHead + 1, M[5], col(0xff5a3c));
    void t;
  }

  private writeDragon(m: Rideable, t: number): void {
    // 轨迹跟随：身体节段沿历史位置排布
    if (!m.segTrail) m.segTrail = [];
    m.segTrail.unshift(m.pos.clone());
    if (m.segTrail.length > 96) m.segTrail.length = 96;
    const headB = this.ps.get('dragonHead');
    const seg = this.ps.get('dragonSeg');
    const fin = this.ps.get('dragonFin');
    const leg = this.ps.get('dragonLeg');
    const horn = this.ps.get('dragonHorn');
    // 头
    root(M[0], m.pos, m.yaw, 1);
    loc(M[1], M[0], 0, 0.35, 0.9, 0, 0, 0, 1.1, 1.0, 1.5);
    headB.set(this.slots.dragonHead, M[1], col(0xd8a828));
    loc(M[2], M[0], -0.28, 1.05, 0.75, 0, 0, -0.45, 0.14, 0.85, 0.14);
    headB.set(this.slots.dragonHead + 1, M[2], col(0x8a5a1a));
    loc(M[3], M[0], 0.28, 1.05, 0.75, 0, 0, 0.45, 0.14, 0.85, 0.14);
    headB.set(this.slots.dragonHead + 2, M[3], col(0x8a5a1a));
    loc(M[4], M[0], 0, 0.32, 1.95, 0, 0, 0, 0.42, 0.42, 0.42);
    horn.set(this.slots.dragonHorn, M[4], col(0x7dffd8, 1.5));
    // 四肢
    for (let li = 0; li < 4; li++) {
      const lx = li % 2 === 0 ? -0.5 : 0.5;
      const lz = li < 2 ? 0.5 : -0.6;
      loc(M[2], M[0], lx, -0.25, lz, 0.5, 0, 0, 0.22, 0.55, 0.22);
      leg.set(this.slots.dragonLeg + li, M[2], col(0xb08820));
    }
    // 身体节段沿轨迹
    for (let i = 0; i < 12; i++) {
      const tp = m.segTrail[Math.min(m.segTrail.length - 1, (i + 1) * 5)];
      if (!tp) break;
      const s = Math.max(0.32, 1 - i / 13);
      _e.set(0, m.yaw, 0); _q.setFromEuler(_e);
      _v.set(tp.x, tp.y + 0.35 + Math.sin(t * 3 + i * 0.9) * 0.24, tp.z);
      M[3].compose(_v, _q, _sv.set(s, s * 0.9, s));
      seg.set(this.slots.dragonSeg + i, M[3], col(0xd8a828, 1 - i * 0.035));
      // 背鳍
      if (i < 6) {
        _v.y += 0.55 * s;
        M[4].compose(_v, _q, _sv.set(0.14 * s, 0.5 * s, 0.5 * s));
        fin.set(this.slots.dragonFin + i, M[4], col(0xff5a3c, 0.9));
      }
    }
    // 尾鳍
    const tp = m.segTrail[m.segTrail.length - 1];
    if (tp) {
      _e.set(0, m.yaw, 0); _q.setFromEuler(_e);
      _v.set(tp.x, tp.y + 0.5, tp.z);
      M[4].compose(_v, _q, _sv.set(0.7, 0.7, 0.12));
      fin.set(this.slots.dragonFin + 6, M[4], col(0xffb300, 0.95));
    }
  }

  private writeQilin(m: Rideable, t: number): void {
    const r = M[0];
    root(r, m.pos, m.yaw, 1);
    const swing = Math.sin(m.phase) * 0.45;
    loc(M[1], r, 0, 1.12, 0, 0, 0, 0, 0.9, 0.9, 1.5);
    this.ps.get('qilinBody').set(this.slots.qilinBody, M[1], col(0xb89868));
    loc(M[2], r, 0, 1.55, 0.85, 0.1, 0, 0, 0.8, 0.8, 1.1);
    this.ps.get('qilinHead').set(this.slots.qilinHead, M[2], col(0xc8a878));
    // 龙角（双）
    loc(M[3], M[2], -0.2, 0.55, 0.1, 0, 0, -0.35, 0.1, 0.7, 0.1);
    loc(M[4], M[2], 0.2, 0.55, 0.1, 0, 0, 0.35, 0.1, 0.7, 0.1);
    this.ps.get('qilinHead').set(this.slots.qilinHead + 1, M[3], col(0x8a6a2a));
    this.ps.get('qilinHead').set(this.slots.qilinHead + 2, M[4], col(0x8a6a2a));
    // 火焰鬃毛（发光）
    const mane = this.ps.get('qilinMane');
    for (let i = 0; i < 6; i++) {
      const fy = 1.7 - i * 0.14;
      loc(M[3], r, 0, fy, 0.78 - i * 0.16, 0, 0, 0, 0.22, 0.3, 0.5);
      mane.set(this.slots.qilinMane + i, M[3], col(i % 2 ? 0xff7a2d : 0xffb300, 1.25));
    }
    loc(M[3], r, 0, 1.35, -0.85, 0.5, 0, 0, 0.5, 0.4, 0.5);
    mane.set(this.slots.qilinMane + 6, M[3], col(0xff5a3c, 1.2));
    // 四肢+尾
    const ly = 0.7;
    loc(M[3], r, -0.24, ly, 0.55, swing, 0, 0); this.ps.get('qilinLeg').set(this.slots.qilinLeg, M[3], col(0x8a6a3a));
    loc(M[4], r, 0.24, ly, 0.55, -swing, 0, 0); this.ps.get('qilinLeg').set(this.slots.qilinLeg + 1, M[4], col(0x8a6a3a));
    loc(M[5], r, -0.24, ly, -0.55, -swing, 0, 0); this.ps.get('qilinLeg').set(this.slots.qilinLeg + 2, M[5], col(0x8a6a3a));
    loc(M[6], r, 0.24, ly, -0.55, swing, 0, 0); this.ps.get('qilinLeg').set(this.slots.qilinLeg + 3, M[6], col(0x8a6a3a));
    loc(M[3], r, 0, 1.3, -0.9, -0.6, 0, Math.sin(t) * 0.2, 0.12, 0.7, 0.12);
    this.ps.get('qilinTail').set(this.slots.qilinTail, M[3], col(0xff7a2d, 1.1));
  }
}
