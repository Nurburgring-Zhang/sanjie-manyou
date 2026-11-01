import * as THREE from 'three';
import { Crowd } from '../actors/crowd';
import { DeityStage } from './deities';
import { SkyCenters } from './realm';
import { Vfx } from '../fx/vfx';
import { bus } from '../core/rng';

// ============ 大闹天宫战斗导演：十幕循环 ============
interface Phase { name: string; dur: number; report: string; enter?(): void; exit?(): void; tick(k: number, dt: number): void }

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export class Havoc {
  private phases: Phase[] = [];
  private pi = 0; private pt = 0;
  private soldiers: import('../actors/types').Actor[] = [];
  private clones: import('../actors/types').Actor[] = [];
  private once = new Set<string>();
  private wukongHome: THREE.Vector3;
  private boltT = 0;
  readonly reports: string[] = [];

  constructor(private crowd: Crowd, private stage: DeityStage, private centers: SkyCenters, private vfx: Vfx) {
    this.wukongHome = V(centers.arena.x, centers.arena.y + 3, centers.arena.z);
    // 天兵军团
    for (let i = 0; i < 22; i++) {
      const s = this.crowd.spawnActor({
        occ: 'soldier', prop: 'spear', pos: V(0, -500, 0), sky: true, freeze: true,
        cloth: 0x4a5a7a, pants: 0x2e3a4e, hat: 1, action: 'impMarch', scale: 0.96,
        doing: '天兵天将·列阵讨伐',
      });
      s.hidden = true;
      this.soldiers.push(s);
    }
    // 悟空分身
    for (let i = 0; i < 5; i++) {
      const c = this.crowd.spawnActor({
        occ: 'customer', prop: 'staff', pos: V(0, -500, 0), sky: true, freeze: true,
        cloth: 0xc8502a, pants: 0x8a3218, hat: 3, action: 'cloneCast',
        doing: '大圣毫毛分身', data: { name: '悟空分身', nick: '毫毛所化', group: 'deity', weapon: '金箍棒', desc: '拔一把毫毛，变作千百个孙行者', code: 'clone' + i },
      });
      c.hidden = true;
      this.clones.push(c);
    }
    this.buildPhases();
    // 首幕 enter + 首条战报（否则第一循环缺开场事件）
    const first = this.phases[0];
    first.enter?.();
    bus.emit('battle:report', first.report);
  }

  private a(name: string): import('../actors/types').Actor | undefined { return this.stage.map.get(name); }

  private glide(a: import('../actors/types').Actor | undefined, target: THREE.Vector3, dt: number, speed = 14): void {
    if (!a) return;
    const d = target.clone().sub(a.pos);
    const dist = d.length();
    if (dist < 0.2) { a.pos.copy(target); return; }
    d.normalize().multiplyScalar(Math.min(speed * dt, dist));
    a.pos.add(d);
    a.yaw = Math.atan2(d.x, d.z);
  }

  private mark(key: string, fn: () => void): void {
    if (this.once.has(key)) return;
    this.once.add(key);
    fn();
  }

  private buildPhases(): void {
    const { arena, gate, palace, arenaW, arenaE, arenaN, arenaS, high } = this.centers;
    const wu = () => this.a('孙悟空');
    const center = () => V(arena.x, arena.y + 3, arena.z);
    this.phases = [
      {
        name: 'break_gate', dur: 8, report: '【大闹天宫】那泼猴反出南天门，金光已至斗法台——',
        enter: () => { this.vfx.column(gate.clone().setY(gate.y + 4), 0x00e5ff, 2.2, 46); },
        tick: (k, dt) => {
          const w = wu();
          if (k < 0.34) { this.glide(w, gate.clone().setY(gate.y + 10), dt, 40); if (w) w.action = 'flyDash'; }
          this.mark('burst', () => {
            if (w) { this.vfx.burst(w.pos, 120, 0xffd25e, 16, 1.1, 1.8); this.vfx.ring(w.pos, 0xffd25e, 26, 0.9); this.vfx.bolt(gate.clone().setY(gate.y + 18), w.pos.clone()); }
          });
          if (k >= 0.34) { this.glide(w, center(), dt, 22); if (w && k > 0.45) w.action = 'staffCombo'; }
        },
      },
      {
        name: 'soldiers', dur: 14, report: '【天兵讨伐】十万天兵结阵压顶，枪戟如林——',
        enter: () => {
          this.soldiers.forEach((s, i) => {
            s.hidden = false;
            const row = Math.floor(i / 6), col = i % 6;
            s.pos.set(gate.x + (col - 2.5) * 4 + row * 0.5, gate.y + 8 + row * 2.2, gate.z + 14 + row * 6 + ((i * 7) % 3));
          });
        },
        tick: (k, dt) => {
          const w = wu();
          if (w) w.action = 'staffCombo';
          this.soldiers.forEach((s, i) => {
            if (k < 0.55) {
              const row = Math.floor(i / 6), col = i % 6;
              const tgt = V(gate.x + (col - 2.5) * 4 + row * 0.5, gate.y + 8 + row * 2.2, gate.z + 14 + row * 6 + ((i * 7) % 3));
              this.glide(s, tgt, dt, 18);
              s.action = 'impMarch';
            } else {
              this.mark('scatter' + (i % 5), () => {
                this.vfx.burst(center().clone().add(V((i - 11) * 1.6, 2, (i % 5) * 2)), 26, 0x8fb2ff, 10, 0.8, 1.2);
              });
              const ang = (i / 22) * Math.PI * 2 + k * 2;
              this.glide(s, center().clone().add(V(Math.cos(ang) * (30 + (i % 4) * 3), 4 + (i % 5) * 2, Math.sin(ang) * (30 + (i % 3) * 4))), dt, 14);
              s.action = i % 3 === 0 ? 'spearThrust' : 'impMarch';
            }
          });
        },
      },
      {
        name: 'nezha', dur: 12, report: '【哪吒出战】三太子脚踏风火轮，火尖枪直取泼猴——',
        tick: (k, dt) => {
          const w = wu(), n = this.a('哪吒三太子');
          if (w) { w.action = 'staffCombo'; w.pos.lerp(center(), Math.min(1, dt * 4)); }
          if (n) {
            const ang = k * Math.PI * 5;
            n.pos.set(center().x + Math.cos(ang) * 8, center().y + 1 + Math.sin(k * 9) * 2, center().z + Math.sin(ang) * 8);
            n.yaw = Math.atan2(center().x - n.pos.x, center().z - n.pos.z);
            n.action = 'staffCombo';
          }
          this.mark('clash' + Math.floor(k * 10), () => {
            if (n) this.vfx.burst(n.pos.clone().lerp(center(), 0.5), 20, 0xff7a2d, 9, 0.6, 1.3);
          });
        },
      },
      {
        name: 'giant', dur: 10, report: '【巨灵先锋】巨灵神提宣花大斧，一斧劈开北斗——',
        tick: (k, dt) => {
          const w = wu(), g = this.a('巨灵神');
          if (k < 0.3) { this.glide(g, V(arena.x + 6, arena.y + 12, arena.z + 2), dt, 30); if (g) g.action = 'flyDash'; }
          this.mark('slam', () => {
            if (g) { this.vfx.ring(g.pos.clone().setY(arena.y + 0.5), 0xffb300, 30, 0.9); this.vfx.burst(g.pos, 70, 0xc8b060, 12, 1, 1.6); bus.emit('sfx:drum'); bus.emit('impact:giant', g.pos.clone()); }
          });
          if (k >= 0.3 && g) { g.pos.y = arena.y + Math.max(0, 6 - (k - 0.3) * 20); g.action = 'axeChop'; }
          if (w) { w.action = 'cloudSomersault'; const ang = k * Math.PI * 3; w.pos.set(arena.x + Math.cos(ang) * 7, arena.y + 4 + Math.sin(k * 9) * 2.5, arena.z + Math.sin(ang) * 7); }
        },
      },
      {
        name: 'erlang', dur: 16, report: '【真君擒猴】二郎神天眼如电，与泼猴绕树缠斗三百合——',
        tick: (k, dt) => {
          const w = wu(), e = this.a('二郎神杨戬');
          const ang = k * Math.PI * 3.2;
          if (w) {
            w.pos.set(arena.x + Math.cos(ang) * 20, arena.y + 5 + Math.sin(k * 11) * 3, arena.z + Math.sin(ang) * 20);
            w.action = k > 0.4 && k < 0.55 ? 'cloneCast' : 'staffCombo';
          }
          if (e) {
            e.pos.set(arena.x + Math.cos(ang + Math.PI) * 20, arena.y + 5 + Math.cos(k * 9) * 3, arena.z + Math.sin(ang + Math.PI) * 20);
            e.action = k > 0.4 && k < 0.55 ? 'thirdEyeBeam' : 'swordForm';
            e.yaw = Math.atan2(arena.x - e.pos.x, arena.z - e.pos.z);
          }
          this.mark('beam', () => {
            if (e && w) this.vfx.bolt(e.pos.clone(), w.pos.clone());
          });
          const dog = this.a('哮天犬');
          if (dog) dog.action = 'dogPounce';
        },
      },
      {
        name: 'tower', dur: 12, report: '【宝塔镇压】李天王祭起玲珑宝塔——泼猴拔毫毛！变小圣！',
        tick: (k, dt) => {
          const l = this.a('托塔李天王');
          this.glide(l, V(arena.x, arena.y + 20, arena.z), dt, 20);
          if (l) { l.action = k > 0.14 && k < 0.82 ? 'towerPress' : 'flyIdle'; l.yaw = Math.PI; }
          this.mark('tower', () => { this.vfx.towerAt(V(arena.x, arena.y + 2, arena.z)); });
          const w = wu();
          if (w) { w.pos.lerp(center(), Math.min(1, dt * 3)); w.action = k > 0.32 ? 'cloneCast' : 'cloudSomersault'; }
          if (k > 0.32 && k < 0.85) {
            this.clones.forEach((c, i) => {
              if (c.hidden) { c.hidden = false; }
              const ang = (i / 5) * Math.PI * 2 + k;
              c.pos.set(center().x + Math.cos(ang) * 10, center().y + 0.5, center().z + Math.sin(ang) * 10);
              c.yaw = ang + Math.PI;
            });
          } else {
            this.clones.forEach((c) => { c.hidden = true; });
          }
        },
      },
      {
        name: 'thunder', dur: 12, report: '【雷部轰击】雷公擂鼓，电母扬镜，天雷滚滚落斗台——',
        tick: (k, dt) => {
          const l = this.a('雷公'), m = this.a('电母');
          this.glide(l, V(arena.x - 5, arena.y + 18, arena.z), dt, 16);
          this.glide(m, V(arena.x + 5, arena.y + 18, arena.z), dt, 16);
          if (l) l.action = 'thunderDrum';
          if (m) m.action = 'mirrorFlash';
          this.boltT -= dt;
          if (this.boltT <= 0) {
            this.boltT = 0.5;
            const p = center().clone().add(V((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
            this.vfx.bolt(p.clone().setY(p.y + 30), p);
            this.vfx.burst(p, 24, 0xbfe8ff, 9, 0.7, 1.3);
          }
          const w = wu();
          if (w) { w.action = 'staffCombo'; w.pos.lerp(center(), Math.min(1, dt * 3)); }
        },
      },
      {
        name: 'assault', dur: 14, report: '【直捣凌霄】泼猴打到凌霄殿前！王灵官挺鞭死战——',
        tick: (k, dt) => {
          const w = wu(), guard = this.a('王灵官');
          const front = V(palace.x, palace.y + 3, palace.z - 17);
          this.glide(w, front.clone().add(V(-1.6, 0, -1.4)), dt, 20);
          if (w) w.action = 'staffCombo';
          this.glide(guard, front.clone().add(V(1.6, 0, 0)), dt, 20);
          if (guard) guard.action = 'spearThrust';
          this.mark('clash2' + Math.floor(k * 8), () => {
            this.vfx.burst(front.clone().add(V(0, 1, -1)), 22, 0xff5a3c, 10, 0.6, 1.3);
          });
          for (const nm of ['持国天王', '增长天王', '广目天王', '多闻天王']) {
            const king = this.a(nm);
            const base = nm.includes('持国') || nm.includes('增长') ? arenaN : arenaS;
            this.glide(king, base.clone().add(V(0, 2, 0)), dt, 10);
            if (king) king.action = nm === '增长天王' ? 'swordForm' : nm === '广目天王' ? 'spearThrust' : 'present';
          }
        },
      },
      {
        name: 'buddha', dur: 14, report: '【佛掌降世】如来佛祖金掌翻覆——齐天大圣，可跳得出这五指山？',
        enter: () => { this.vfx.palmAt(V(arena.x, arena.y + 1, arena.z)); },
        tick: (k, dt) => {
          const w = wu();
          if (w) { this.glide(w, V(arena.x, arena.y + 0.5, arena.z + 2), dt, 20); w.action = k < 0.2 ? 'cloudSomersault' : 'stand'; }
          this.mark('gold', () => {
            this.vfx.column(center(), 0xffd25e, 5, 70);
            this.vfx.ring(center().clone().setY(arena.y + 0.5), 0xffd25e, 40, 1.4);
            bus.emit('sfx:buddha');
          });
          for (const nm of ['托塔李天王', '巨灵神', '二郎神杨戬', '哪吒三太子', '王灵官']) {
            const g = this.a(nm);
            const ang = ['托塔李天王', '巨灵神', '二郎神杨戬', '哪吒三太子', '王灵官'].indexOf(nm) * 1.26;
            this.glide(g, center().clone().add(V(Math.cos(ang) * 24, 1, Math.sin(ang) * 24)), dt, 12);
            if (g) g.action = 'courtBow';
          }
          this.soldiers.forEach((s, i) => {
            const ang = (i / 22) * Math.PI * 2;
            this.glide(s, center().clone().add(V(Math.cos(ang) * 34, 2, Math.sin(ang) * 34)), dt, 10);
            s.action = 'courtBow';
          });
        },
      },
      {
        name: 'daily', dur: 22, report: '【幕间】蟠桃重开宴，霓裳舞未央——且听下回分解！',
        enter: () => { this.vfx.setPetals(0.5); bus.emit('sfx:gong'); },
        tick: (k, dt) => {
          const w = wu();
          if (w) { this.glide(w, this.wukongHome, dt, 12); w.action = 'staffCombo'; }
          const homes: Record<string, THREE.Vector3> = {
            '托塔李天王': arenaN.clone(), '哪吒三太子': arenaN.clone().add(V(3, 0, 2)),
            '二郎神杨戬': arenaS.clone(), '巨灵神': arenaE.clone(), '王灵官': this.centers.palace.clone().add(V(2, 3, -16)),
            '雷公': high.clone().add(V(-5, 0, 0)), '电母': high.clone().add(V(5, 0, 0)),
            '持国天王': arenaN.clone().add(V(-4, 0, 2)), '增长天王': arenaN.clone().add(V(4, 0, 2)),
            '广目天王': arenaS.clone().add(V(-4, 0, 2)), '多闻天王': arenaS.clone().add(V(4, 0, 2)),
          };
          for (const nm in homes) {
            const g = this.a(nm);
            this.glide(g, homes[nm], dt, 9);
            if (g) g.action = this.stage.map.get(nm) ? 'flyIdle' : 'flyIdle';
          }
          if (k > 0.5) this.vfx.setPetals(0.15);
        },
        exit: () => { this.vfx.setPetals(0.12); },
      },
    ];
    void arenaW; void arenaE;
  }

  private phaseExit(): void {
    const p = this.phases[this.pi];
    if (p?.exit) p.exit();
  }

  update(_t: number, dt: number): void {
    const p = this.phases[this.pi];
    if (!p) return;
    this.pt += dt;
    const k = this.pt / p.dur;
    if (k >= 1) {
      this.phaseExit();
      this.once.clear();
      this.pi = (this.pi + 1) % this.phases.length;
      this.pt = 0;
      const np = this.phases[this.pi];
      np.enter?.();
      bus.emit('battle:report', np.report);
      this.reports.push(np.report);
      return;
    }
    p.tick(Math.min(1, k), dt);
  }

  /** 图鉴/小地图用：当前幕名 */
  currentPhase(): string {
    const names = ['南天门被破', '天兵讨伐', '哪吒出战', '巨灵先锋', '真君擒猴', '宝塔镇压', '雷部轰击', '直捣凌霄', '佛掌降世', '幕间·蟠桃宴'];
    return names[this.pi] ?? '';
  }
}
