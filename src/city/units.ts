import * as THREE from 'three';
import { PoolSet, GLOW_MAT } from '../actors/pools';
import type { Crowd } from '../actors/crowd';
import { RNG } from '../core/rng';
import { WAKE_SLOTS } from './river';
import {
  InstSet, VEH_MAT, VEH_CLOTH, boatParts, cartParts, sedanParts, animalParts,
  oarGeo, lanternGeo, wheelGeo, legQuadGeo, legBirdGeo, type BoatParts, type CartParts, type SedanParts, type AnimalParts, type Species,
} from './vehicles';

// ============ 动态单元：牲畜 / 车轿 / 船只 ============
// W5：几何全部改走 vehicles.ts 的程序化工厂（船壳放样 / 列板 / 舱棚 / 桅帆橹舵 / 车轮 / 牲畜骨架），
// 本文件只负责摆放、动画与实例槽位。旧版是 pools.ts 的方盒几何，船车兽都读成"盒子 + 棚"。
/** 水面 y=1.0（river.ts），船体几何以设计水线为 y=0，故根节点直接落在水面 */
const WATER_Y = 1.0;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sv = new THREE.Vector3();
const _c = new THREE.Color();
/** 每帧复用的草稿矩阵：InstSet.set 会把矩阵拷进实例数组，可以安全复用 */
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), ROOT = new THREE.Matrix4();

/** 坐标 hash：确定性扰动，不消耗共享 RNG（下游系统依赖那条序列） */
function h01(x: number, z: number, salt: number): number {
  let h = Math.imul((x | 0) * 73856093 ^ (z | 0) * 19349663 ^ salt * 83492791, 0x27d4eb2d);
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

interface Mount {
  kind: Species;
  pos: THREE.Vector3; yaw: number; phase: number; speed: number; scale: number;
  tint: number; route: THREE.Vector3[]; ri: number;
  body: InstSet; bodySlot: number;
  legs: number[];
  moving: boolean;
}

interface Sedan { pos: THREE.Vector3; yaw: number; phase: number; kind: number; slot: number; parts: SedanParts; route: THREE.Vector3[]; ri: number; speed: number }
interface Cart {
  pos: THREE.Vector3; yaw: number; phase: number; speed: number; mass: number;
  route: THREE.Vector3[]; ri: number; kind: number;
  parts: CartParts; slot: number; wheels: number[]; ox: Mount | null;
}

interface Boat {
  x: number; z: number; dir: 1 | -1; speed: number; phase: number;
  slot: number; set: BoatSet; oarBase: number; lampBase: number;
  mastTilt: number; mastTarget: number; drama: number; dwell: number;
  /** 0 渡船 / 1 漕船 / 2 客船 / 3 画舫 / 4 渔船 / 5 小舟 */
  kind: number;
  wake: number;
  crew: number[];
}

/** 一种 (船型 × 细节档) 的实例组 */
interface BoatSet {
  hard: InstSet;
  cloth: InstSet | null;
  rig: InstSet | null;
  sail: InstSet | null;
  parts: BoatParts;
  used: number;
}

const BOAT_CAP = 3;

/** 船型清单（W5 六型）：crew 为体坐标（米），y 为甲板以上高度 */
const BOAT_KINDS = ['boat.ferry', 'boat.grain', 'boat.passenger', 'boat.pleasure', 'boat.fisher', 'boat.skiff'];
/** 9 条船的型别池：漕 2 · 客 2 · 渡 2 · 画舫 1 · 渔 1 · 小舟 1 */
const BOAT_PLAN = [1, 2, 0, 1, 3, 4, 2, 0, 5];
/** 虹桥降桅戏剧船：两艘漕船（唯二的高桅船）；索引保持旧实现的 {0,3}，使 RNG 取值位置逐位不变 */
const DRAMA_IDX = [0, 3];
const DRAMA_DETAIL = [0, 3, 4, 8];

export class UnitSystems {
  private mounts: Mount[] = [];
  private sedans: Sedan[] = [];
  private carts: Cart[] = [];
  private boats: Boat[] = [];
  private scene: THREE.Scene;

  private boatSets = new Map<string, BoatSet>();
  private cartSets = new Map<number, { hard: InstSet; cloth: InstSet | null; parts: CartParts; used: number }>();
  private sedanSets = new Map<number, { hard: InstSet; cloth: InstSet | null; parts: SedanParts; used: number }>();
  private bodySets = new Map<Species, InstSet>();
  private partCache = new Map<string, AnimalParts>();

  private oarSet: InstSet;
  private lampSet: InstSet;
  private wheelSet: InstSet;
  private legQuad: InstSet;
  private legBird: InstSet;

  constructor(
    ps: PoolSet,
    private crowd: Crowd,
    rng: RNG,
    /** 地表高度：城市内恒 0，沙漠/山地商队需要贴合地形 */
    private heightAt: (x: number, z: number) => number = () => 0,
  ) {
    this.scene = ps.scene;
    this.oarSet = new InstSet(this.scene, oarGeo(), VEH_MAT, 48, 'veh_oar');
    this.lampSet = new InstSet(this.scene, lanternGeo(), GLOW_MAT, 24, 'veh_lamp', false);
    this.wheelSet = new InstSet(this.scene, wheelGeo(), VEH_MAT, 24, 'veh_wheel');
    this.legQuad = new InstSet(this.scene, legQuadGeo(), VEH_MAT, 180, 'veh_leg');
    this.legBird = new InstSet(this.scene, legBirdGeo(), VEH_MAT, 24, 'veh_legBird');
    this.spawnMounts(rng);
    this.spawnSedans(rng);
    this.spawnCarts(rng);
    this.spawnBoats(rng);
  }

  private animal(kind: Species): AnimalParts {
    let p = this.partCache.get(kind);
    if (!p) { p = animalParts(kind); this.partCache.set(kind, p); }
    return p;
  }

  private bodySet(kind: Species): InstSet {
    let s = this.bodySets.get(kind);
    if (!s) {
      s = new InstSet(this.scene, this.animal(kind).body, VEH_MAT, 14, 'veh_' + kind);
      this.bodySets.set(kind, s);
    }
    return s;
  }

  // ---- 牲畜 ----
  private makeMount(kind: Species, x: number, z: number, route: THREE.Vector3[], rng: RNG, quiet = false): Mount {
    // 与旧实现同序同量地取随机数：骆驼/牛 2 次，马/驴 3 次。
    // quiet=true（W5 新增的猪/犬/鹅）完全走坐标 hash，绝不插进共享 RNG 链。
    const yaw = quiet ? h01(x, z, 31) * Math.PI * 2 : rng.range(0, Math.PI * 2);
    const phase = quiet ? h01(x, z, 37) * 9 : rng.range(0, 9);
    let tint = 1;
    if (kind === 'camel' || kind === 'ox') {
      tint = 1;
    } else if (kind === 'horse' || kind === 'donkey') {
      tint = [0.82, 0.7, 0.96, 1.22][rng.pick([0, 1, 2, 3]) as 0 | 1 | 2 | 3];
    }
    const parts = this.animal(kind);
    const legs: number[] = [];
    const legPool = parts.legType === 0 ? this.legQuad : this.legBird;
    for (let i = 0; i < parts.legs.length; i++) legs.push(-1);
    const body = this.bodySet(kind);
    const m: Mount = {
      kind, pos: new THREE.Vector3(x, 0, z), yaw, phase,
      speed: kind === 'camel' ? 1.5 : kind === 'goose' ? 0.35 : 1.3,
      scale: kind === 'pig' ? 1 : kind === 'dog' ? 1 : 1,
      tint, route, ri: 0,
      body, bodySlot: body.alloc(), legs, moving: route.length > 0,
    };
    // 腿槽位按需分配（每只动物 2–4 条）
    for (let i = 0; i < parts.legs.length; i++) m.legs[i] = legPool.alloc();
    this.mounts.push(m);
    return m;
  }

  private spawnMounts(rng: RNG): void {
    // 骆驼商队：穿城门往返
    const camelRoute: THREE.Vector3[] = [];
    for (let x = 600; x >= 430; x -= 24) camelRoute.push(new THREE.Vector3(x, 0, 52));
    for (let x = 430; x <= 600; x += 24) camelRoute.push(new THREE.Vector3(x, 0, 52));
    for (let i = 0; i < 3; i++) {
      const m = this.makeMount('camel', 600 - i * 7, 52 + (i % 2 ? 1.2 : -1.2), camelRoute, rng);
      this.attachDriver(m, 1.9, i % 2 ? 1.6 : -1.6, 'camelDriver', rng);
    }
    // 沙漠商站驼队：沿绿洲南缘的驼道往返（沙站原本只有帐篷箱子，没有活物）
    const DX = -16000, DZ = -14500;
    const duneRoute: THREE.Vector3[] = [];
    for (let x = DX - 16; x <= DX + 84; x += 13) duneRoute.push(new THREE.Vector3(x, 0, DZ + 30.5));
    for (let x = DX + 84; x >= DX - 16; x -= 13) duneRoute.push(new THREE.Vector3(x, 0, DZ + 34.5));
    for (let i = 0; i < 4; i++) {
      const p = duneRoute[i * 3 % duneRoute.length];
      const m = this.makeMount('camel', p.x, p.z, duneRoute, rng);
      m.ri = (i * 3 + 1) % duneRoute.length;
      m.pos.y = this.heightAt(m.pos.x, m.pos.z);
      if (i === 0) this.attachDriver(m, 1.9, 1.4, 'camelDriver', rng);
      else if (i === 2) this.attachDriver(m, -1.9, -1.4, 'camelDriver', rng);
    }
    // 骑乘：马/驴 沿街游走
    const rideRouteA: THREE.Vector3[] = [];
    for (let x = -400; x < 420; x += 30) rideRouteA.push(new THREE.Vector3(x, 0, 52));
    const rideRouteB: THREE.Vector3[] = [];
    for (let x = 380; x > -500; x -= 30) rideRouteB.push(new THREE.Vector3(x, 0, -52));
    for (let i = 0; i < 4; i++) {
      const route = i % 2 ? rideRouteA : rideRouteB;
      const m = this.makeMount(i < 2 ? 'horse' : 'donkey', route[0].x, route[0].z + (i % 2 ? 1.4 : -1.4), route, rng);
      this.attachRider(m, i < 2 ? 'official' : 'farmer', rng);
    }
    // 静态拴畜（驴牛各半）
    for (let i = 0; i < 5; i++) {
      const m = this.makeMount(rng.pick(['donkey', 'ox']) as Species, rng.range(-260, -180), rng.range(50, 58), [], rng);
      m.moving = false;
    }
    // 家禽 → 鹅：4 只在岸上、4 只在河面（坐标 hash 摆位，不动 rng 序列）
    for (let i = 0; i < 8; i++) {
      const px = rng.range(-300, 300);
      const pz = rng.pick([56, 60, -58]) + rng.range(-2, 2);
      const yw = rng.range(0, 6.28);
      void rng.pick([0xc8a04a, 0x8a5a2a, 0xd8d0c8]);
      const onWater = i >= 4;
      const g = this.makeMount('goose', px, onWater ? -9.5 + h01(px, pz, 7) * 6 : pz, [], rng, true);
      g.yaw = yw;
      g.pos.y = onWater ? WATER_Y - 0.14 : 0.02;
      g.scale = 0.9 + h01(px, pz, 3) * 0.25;
      g.phase = h01(px, pz, 11) * 6.28;
    }
    // 猪圈散养（市集后巷）+ 犬（桥头、坊门）：坐标 hash，零 rng
    for (let i = 0; i < 3; i++) {
      const px = -150 + i * 7.5 + h01(i, 1, 5) * 2;
      const pz = 52 + h01(i, 2, 9) * 4;
      const p = this.makeMount('pig', px, pz, [], rng, true);
      p.yaw = h01(i, 3, 13) * 6.28;
      p.scale = 0.9 + h01(i, 4, 17) * 0.2;
      p.pos.y = 0.02;
    }
    for (let i = 0; i < 2; i++) {
      const px = 68 + i * 9 + h01(i, 5, 19) * 3;
      const pz = 56 + h01(i, 6, 23) * 3;
      const d = this.makeMount('dog', px, pz, [], rng, true);
      d.yaw = h01(i, 7, 29) * 6.28;
      d.pos.y = 0.02;
    }
  }

  private attachDriver(m: Mount, dz: number, dx: number, occ: string, rng: RNG): void {
    const a = this.crowd.spawnActor({ occ, pos: m.pos.clone() });
    a.freeze = true;
    a.action = 'walk';
    a.attach = (out) => {
      const s = Math.sin(m.yaw), c = Math.cos(m.yaw);
      out.pos.set(m.pos.x + c * dx + s * dz, m.pos.y, m.pos.z - s * dx + c * dz);
      out.yaw = m.yaw; out.y = m.pos.y;
    };
    void rng;
  }

  private attachRider(m: Mount, occ: string, rng: RNG): void {
    const parts = this.animal(m.kind);
    const a = this.crowd.spawnActor({ occ, pos: m.pos.clone(), scale: 0.95 });
    a.freeze = true;
    a.action = 'rideAnimal';
    a.attach = (out) => {
      const s = Math.sin(m.yaw), c = Math.cos(m.yaw);
      out.pos.set(m.pos.x + s * parts.saddle * m.scale, m.pos.y, m.pos.z + c * parts.saddle * m.scale);
      // 骑手根节点 = 背高 − 0.62（折叠腿后骨盆正好落在背上，与旧实现骆驼的 1.05 一致）
      out.yaw = m.yaw; out.y = m.pos.y + (parts.back - 0.62) * m.scale;
    };
    void rng;
  }

  // ---- 轿子（官轿四抬 / 小轿二抬）----
  private sedanSet(kind: number): { hard: InstSet; cloth: InstSet | null; parts: SedanParts; used: number } {
    let s = this.sedanSets.get(kind);
    if (!s) {
      const parts = sedanParts(kind, 1);
      s = {
        parts, used: 0,
        hard: new InstSet(this.scene, parts.hard, VEH_MAT, 4, 'veh_sedan' + kind),
        cloth: parts.cloth ? new InstSet(this.scene, parts.cloth, VEH_CLOTH, 4, 'veh_sedanCloth' + kind) : null,
      };
      this.sedanSets.set(kind, s);
    }
    return s;
  }

  private spawnSedans(rng: RNG): void {
    const routes: THREE.Vector3[][] = [
      [-380, 58, 420, 58], [420, 46, -380, 46], [-200, -58, 380, -58], [480, 58, 590, 58],
    ].map(([x0, z0, x1, z1]) => [new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1)]);
    // 0 官轿（四人）· 1 小轿（二人）：两两各一
    const kinds = [0, 1, 0, 1];
    for (let i = 0; i < 4; i++) {
      const route = routes[i];
      const kind = kinds[i];
      const set = this.sedanSet(kind);
      const slot = set.used++;
      const sd: Sedan = {
        pos: route[0].clone(), yaw: 0, phase: rng.range(0, 9), kind, slot, parts: set.parts, route, ri: 0,
        speed: kind === 0 ? 1.15 : 1.35,
      };
      for (const bp of set.parts.bearers) {
        const dx = bp.x, dz = bp.z;
        const a = this.crowd.spawnActor({ occ: 'porter', pos: sd.pos.clone() });
        a.freeze = true; a.action = 'carryPalanquin';
        a.attach = (out) => {
          const s = Math.sin(sd.yaw), c = Math.cos(sd.yaw);
          out.pos.set(sd.pos.x + c * dx + s * dz, 0, sd.pos.z - s * dx + c * dz);
          out.yaw = sd.yaw; out.y = 0;
        };
      }
      if (kind === 0) {
        const p = this.crowd.spawnActor({ occ: 'lady', pos: sd.pos.clone(), scale: 0.92 });
        p.freeze = true; p.action = 'sitSedan';
        p.attach = (out) => { out.pos.copy(sd.pos); out.yaw = sd.yaw; out.y = 1.42; };
      }
      this.sedans.push(sd);
    }
  }

  // ---- 车：太平车 / 独轮车 / 牛车 / 驴车 ----
  private cartSet(kind: number): { hard: InstSet; cloth: InstSet | null; parts: CartParts; used: number } {
    let s = this.cartSets.get(kind);
    if (!s) {
      const parts = cartParts(kind, 1);
      s = {
        parts, used: 0,
        hard: new InstSet(this.scene, parts.hard, VEH_MAT, 3, 'veh_cart' + kind),
        cloth: parts.cloth ? new InstSet(this.scene, parts.cloth, VEH_CLOTH, 3, 'veh_cartCloth' + kind) : null,
      };
      this.cartSets.set(kind, s);
    }
    return s;
  }

  private spawnCarts(rng: RNG): void {
    const routes: THREE.Vector3[][] = [
      [-300, -46, 300, -46], [100, 58, -500, 58], [-238, 80, -80, 80], [-560, 52, -120, 52],
    ].map(([x0, z0, x1, z1]) => [new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1)]);
    const SPEC: { ox: Species | null; speed: number; mass: number }[] = [
      { ox: 'ox', speed: 0.85, mass: 9 },      // 太平车：牛拉四轮大车
      { ox: null, speed: 1.15, mass: 2 },      // 独轮车
      { ox: 'ox', speed: 0.78, mass: 7 },      // 牛车
      { ox: 'donkey', speed: 1.05, mass: 4 },  // 驴车
    ];
    for (let i = 0; i < SPEC.length; i++) {
      const spec = SPEC[i];
      const route = routes[i];
      const set = this.cartSet(i);
      const slot = set.used++;
      const wheels: number[] = [];
      for (let k = 0; k < set.parts.wheels.length; k++) wheels.push(this.wheelSet.alloc());
      const cart: Cart = {
        pos: route[0].clone(), yaw: 0, phase: rng.range(0, 9), speed: spec.speed, mass: spec.mass,
        route, ri: 0, kind: i, parts: set.parts, slot, wheels, ox: null,
      };
      if (spec.ox) {
        cart.ox = this.makeMount(spec.ox, cart.pos.x + set.parts.hitch, cart.pos.z, [], rng);
        cart.ox.moving = true;
        // 挽具：牲口与车辕之间的横轭
      }
      // 车夫/推车人：独轮车在后推，其余在车旁随行
      const back = i === 1;
      const d = this.crowd.spawnActor({ occ: 'porter', pos: cart.pos.clone() });
      d.freeze = true; d.action = back ? 'pullRope' : 'walk';
      d.attach = (out) => {
        const s = Math.sin(cart.yaw), c = Math.cos(cart.yaw);
        // 模型局部 +x = 航向；后推位在 -x，随行位在 -z 左侧
        const lx = back ? -1.45 : -0.2, lz = back ? 0 : 1.0;
        out.pos.set(cart.pos.x + lx * s - lz * c, 0, cart.pos.z + lx * c + lz * s);
        out.yaw = cart.yaw; out.y = 0;
      };
      this.carts.push(cart);
    }
  }

  // ---- 船只 ----
  private boatSet(kind: number, detail: 1 | 0): BoatSet {
    let key = kind + ':' + detail;
    let set = this.boatSets.get(key);
    if (!set || set.used >= BOAT_CAP) {
      if (set) key = key + '#' + this.boatSets.size;
      const parts = boatParts(kind, detail);
      set = {
        hard: new InstSet(this.scene, parts.hard, VEH_MAT, BOAT_CAP, 'veh_boat' + key),
        cloth: parts.cloth ? new InstSet(this.scene, parts.cloth, VEH_CLOTH, BOAT_CAP, 'veh_boatCloth' + key) : null,
        rig: parts.rig ? new InstSet(this.scene, parts.rig, VEH_MAT, BOAT_CAP, 'veh_boatRig' + key) : null,
        sail: parts.sail ? new InstSet(this.scene, parts.sail, VEH_CLOTH, BOAT_CAP, 'veh_boatSail' + key) : null,
        parts, used: 0,
      };
      this.boatSets.set(key, set);
    }
    return set;
  }

  private spawnBoats(rng: RNG): void {
    // 航道：正 z 半幅顺流（+x），负 z 半幅逆流（−x）；漕船双船走中线靠桥（虹桥降桅）。
    // 相邻航道间距 5m 起（最宽 4.6m 船体 → 半宽 2.3，实需 4.75m），玩家小舟独占 z=19.5
    const LANES = [2.5, -2.5, 12.5, -12.5, 7.5, -7.5];
    for (let i = 0; i < 9; i++) {
      const kind = BOAT_PLAN[i];
      const drama = DRAMA_IDX.indexOf(i) >= 0;
      const lane = drama ? (i === DRAMA_IDX[0] ? LANES[0] : LANES[1]) : LANES[2 + (i % 4)];
      const detail: 1 | 0 = DRAMA_DETAIL.indexOf(i) >= 0 ? 1 : 0;
      const x = -560 + i * 140 + rng.range(-24, 24);
      const speed = drama ? 2.2 : rng.range(1.6, 2.6);
      const phase = rng.range(0, 9);
      const set = this.boatSet(kind, detail);
      const slot = set.used++;
      const meta = set.parts;
      const oarBase = meta.oars.length > 0 ? this.oarSet.alloc(meta.oars.length) : -1;
      const lampBase = meta.lanterns.length > 0 ? this.lampSet.alloc(meta.lanterns.length) : -1;
      const b: Boat = {
        x, z: lane, dir: lane > 0 ? 1 : -1, speed, phase,
        slot, set, oarBase, lampBase,
        mastTilt: 0, mastTarget: 0, drama: drama ? 1 : -1, dwell: 0, crew: [],
        kind, wake: i < WAKE_SLOTS.length ? i : -1,
      };
      for (const c of meta.crew) {
        const a = this.crowd.spawnActor({ occ: c.occ, pos: new THREE.Vector3(b.x, WATER_Y, b.z) });
        a.freeze = true; a.action = c.act;
        a.attach = (out) => {
          const bob = Math.sin(b.phase) * 0.07;
          const lx = c.x * b.dir, lz = c.z * b.dir;
          out.pos.set(b.x + lx, WATER_Y + bob + c.y, b.z + lz);
          out.yaw = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          out.y = WATER_Y + bob + c.y;
        };
        b.crew.push(a.id);
      }
      this.boats.push(b);
    }
  }

  // ============ 每帧更新 ============
  update(t: number, dt: number): void {
    this.updateMounts(t, dt);
    this.updateSedans(dt);
    this.updateCarts(dt);
    this.updateBoats(t, dt);
    // 自建实例池的批量上屏：world 只调 update()，不经过 PoolSet.flushAll()
    this.flush();
  }

  private advance(pos: THREE.Vector3, route: THREE.Vector3[], ri: { i: number }, speed: number, dt: number): number {
    const tgt = route[ri.i];
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) { ri.i = (ri.i + 1) % route.length; return Math.atan2(dx, dz); }
    pos.x += (dx / dist) * speed * dt;
    pos.z += (dz / dist) * speed * dt;
    return Math.atan2(dx, dz);
  }

  private writeMount(m: Mount, t: number): void {
    const parts = this.animal(m.kind);
    _e.set(0, m.yaw, 0); _q.setFromEuler(_e);
    _v.set(m.pos.x, m.pos.y, m.pos.z); _sv.setScalar(m.scale);
    const root = ROOT.compose(_v, _q, _sv);
    const k = Math.min(1.4, Math.max(0.6, m.tint));
    this.bodySet(m.kind).set(m.bodySlot, root, _c.setRGB(k, k, k));
    // 腿：髋位（= 腿长，腿几何自髋向下 1 单位）→ 摆腿 → 按腿长/腿粗缩放
    const legSet = parts.legType === 0 ? this.legQuad : this.legBird;
    const moving = m.moving || parts.legType === 1;
    const swing = moving ? Math.sin(m.phase) * 0.5 : 0;
    for (let i = 0; i < parts.legs.length; i++) {
      const lp = parts.legs[i];
      const dir = (i === 0 || i === 3) ? 1 : -1;
      _e.set(swing * dir * (parts.legType === 0 ? 1 : 0), 0, 0);
      _q2.setFromEuler(_e);
      M.compose(_v.set(lp.x, parts.legLen, lp.z), _q2, _sv.set(parts.legW, parts.legLen, parts.legW));
      M.premultiply(root);
      legSet.set(m.legs[i], M, _c.setRGB(k, k, k));
    }
    void t;
  }

  private updateMounts(t: number, dt: number): void {
    for (const m of this.mounts) {
      if (m.moving && m.route.length > 1) {
        const ri = { i: m.ri };
        const yaw = this.advance(m.pos, m.route, ri, m.speed, dt);
        m.ri = ri.i;
        let dy = yaw - m.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        m.yaw += dy * Math.min(1, dt * 3);
        m.phase += dt * 4.2;
        m.pos.y = this.heightAt(m.pos.x, m.pos.z);
      }
      this.writeMount(m, t);
    }
  }

  private updateSedans(dt: number): void {
    for (const sd of this.sedans) {
      const ri = { i: sd.ri };
      const yaw = this.advance(sd.pos, sd.route, ri, sd.speed, dt);
      sd.ri = ri.i;
      let dy = yaw - sd.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      sd.yaw += dy * Math.min(1, dt * 3);
      sd.phase += dt * 4.4;
      const bobY = Math.abs(Math.sin(sd.phase)) * 0.06;
      _e.set(0, sd.yaw, 0); _q.setFromEuler(_e);
      _v.set(sd.pos.x, 1.42 + bobY, sd.pos.z); _sv.setScalar(1);
      const root = ROOT.compose(_v, _q, _sv);
      const set = this.sedanSets.get(sd.kind)!;
      set.hard.set(sd.slot, root);
      if (set.cloth) set.cloth.set(sd.slot, root);
    }
  }

  /** 车体根矩阵：+x 为行进方向（与航向 yaw 差 π/2，车板长轴顺路） */
  private cartRoot(ct: Cart, y: number): THREE.Matrix4 {
    _e.set(0, ct.yaw - Math.PI / 2, 0); _q.setFromEuler(_e);
    _v.set(ct.pos.x, y, ct.pos.z); _sv.setScalar(1);
    return ROOT.compose(_v, _q, _sv);
  }

  private updateCarts(dt: number): void {
    for (const ct of this.carts) {
      const ri = { i: ct.ri };
      const yaw = this.advance(ct.pos, ct.route, ri, ct.speed, dt);
      ct.ri = ri.i;
      let dy = yaw - ct.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      ct.yaw += dy * Math.min(1, dt * 3);
      ct.phase += dt * 3.6;
      const s = Math.sin(ct.yaw), c = Math.cos(ct.yaw);
      if (ct.ox) {
        // 牲口在辕前拉车（局部 +x 方向）
        ct.ox.pos.set(ct.pos.x + s * ct.parts.hitch, this.heightAt(ct.pos.x + s * ct.parts.hitch, ct.pos.z + c * ct.parts.hitch), ct.pos.z + c * ct.parts.hitch);
        ct.ox.yaw = ct.yaw;
        ct.ox.phase = ct.phase;
        ct.ox.moving = true;
        this.writeMount(ct.ox, 0);
      }
      const bump = Math.abs(Math.sin(ct.phase)) * 0.035;
      const root = this.cartRoot(ct, bump);
      const set = this.cartSets.get(ct.kind)!;
      set.hard.set(ct.slot, root);
      if (set.cloth) set.cloth.set(ct.slot, root);
      // 车轮：绕本地 z 自转，贴地不随车板上浮
      const spin = ct.phase * 1.5;
      for (let i = 0; i < ct.parts.wheels.length; i++) {
        const w = ct.parts.wheels[i];
        M2.makeRotationZ(spin).scale(_sv.set(w.r, w.r, w.r));
        M.makeTranslation(w.x, w.r, w.z).multiply(M2);
        M.premultiply(root);
        this.wheelSet.set(ct.wheels[i], M, _c.setHex(0x4a3520));
      }
    }
  }

  /** 交通工具清单（供物理冲撞判定）：位置/朝向/当前速度/质量 */
  traffic(): { pos: THREE.Vector3; yaw: number; speed: number; mass: number }[] {
    const out: { pos: THREE.Vector3; yaw: number; speed: number; mass: number }[] = [];
    for (const c of this.carts) out.push({ pos: c.pos, yaw: c.yaw, speed: c.speed, mass: c.mass });
    for (const s of this.sedans) out.push({ pos: s.pos, yaw: s.yaw, speed: s.speed, mass: s.parts.mass });
    for (const m of this.mounts) if (m.kind === 'camel' && m.moving) out.push({ pos: m.pos, yaw: m.yaw, speed: m.speed, mass: 4.5 });
    const pb = this.playerBoat;
    out.push({ pos: new THREE.Vector3(pb.x, 0, pb.z), yaw: pb.yaw, speed: pb.driven ? 2 + pb.throttle * 5 : 0, mass: 10 });
    return out;
  }

  // ---- 玩家可驾小船（小舟 3.6m）----
  readonly playerBoat = { x: -244, z: 19.5, yaw: 0.5, throttle: 0, rudder: 0, phase: 0, driven: false };
  private pbSet: BoatSet | null = null;
  private pbSlot = 0;
  private pbOar = -1;
  private pbMeta: BoatParts | null = null;

  updatePlayerBoat(): void {
    if (!this.pbSet) {
      this.pbSet = this.boatSet(5, 1);
      this.pbMeta = this.pbSet.parts;
      this.pbSlot = this.pbSet.used++;
      this.pbOar = this.oarSet.alloc(2);
    }
    const b = this.playerBoat;
    const meta = this.pbMeta!;
    b.phase += 2 * 0.016;
    const bobY = Math.sin(b.phase) * 0.05;
    _e.set(Math.sin(b.phase * 0.7) * 0.03, b.yaw - Math.PI / 2, 0); _q.setFromEuler(_e);
    _v.set(b.x, WATER_Y + bobY, b.z); _sv.setScalar(1);
    const root = ROOT.compose(_v, _q, _sv);
    this.pbSet.hard.set(this.pbSlot, root);
    // 双桨：随油门加快
    const sweep = Math.sin(b.phase * (2 + b.throttle * 3)) * 0.55;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      _e.set(0, Math.PI + s * 0.36 + sweep * 0.22 * s, -0.3 + sweep * 0.12 * s); _q.setFromEuler(_e);
      _sv.set(1, 1, 1);
      M.compose(_v.set(i === 0 ? 0.35 : -0.9, meta.deck + 0.2, s * 0.5), _q, _sv);
      M.premultiply(root);
      this.oarSet.set(this.pbOar + i, M);
    }
    this.flush();
  }

  private updateBoats(t: number, dt: number): void {
    for (const b of this.boats) {
      // 虹桥降桅戏剧（仅戏剧船）：双向都触发——上行船在 x<-62 起倒，下行船在 x>62 起倒
      if (b.drama === 1 && Math.abs(b.x) < 90) {
        const app = b.dir > 0 ? b.x < -62 : b.x > 62;
        const past = b.dir > 0 ? b.x > 26 : b.x < -26;
        if (app && b.mastTilt < 0.02 && b.dwell <= 0) { b.mastTarget = 1.5; b.dwell = 2.2; }
        if (past && b.mastTilt > 0) { b.mastTarget = 0; }
      }
      if (b.dwell > 0 && Math.abs(b.x) < 70) {
        b.speed = Math.max(0.15, b.speed - dt * 0.9);
      } else {
        b.speed = Math.min(b === this.boats[0] ? 2.2 : b.speed + dt * 0.4, 2.6);
      }
      b.dwell -= dt;
      b.mastTilt += (b.mastTarget - b.mastTilt) * Math.min(1, dt * 0.9);
      b.x += b.dir * b.speed * dt;
      b.phase += dt * 2.2;
      if (b.x > 650) { b.x = -650; }
      if (b.x < -650) { b.x = 650; }
      this.writeBoat(b);
      this.writeWake(b);
    }
    void t;
  }

  private static readonly _root = new THREE.Matrix4();

  private writeBoat(b: Boat): void {
    const meta = b.set.parts;
    const bobY = Math.sin(b.phase) * 0.07, roll = Math.sin(b.phase * 0.8) * 0.022;
    // 船体长轴 +x 对齐航向：dir>0 船头朝 +x（yaw 0），dir<0 掉头（yaw π）
    _e.set(roll, b.dir > 0 ? 0 : Math.PI, 0); _q.setFromEuler(_e);
    _v.set(b.x, WATER_Y + bobY, b.z); _sv.setScalar(1);
    const root = UnitSystems._root.compose(_v, _q, _sv);
    b.set.hard.set(b.slot, root);
    if (b.set.cloth) b.set.cloth.set(b.slot, root);
    // 桅：绕局部 z 前后倒，桅脚为枢轴；帆与桅同框
    if (b.set.rig || b.set.sail) {
      const pv = meta.pivot;
      _e.set(0, 0, b.mastTilt); _q2.setFromEuler(_e);
      M.compose(_v.set(pv.x, pv.y, pv.z), _q2, _sv.set(1, 1, 1));
      M.premultiply(root);
      if (b.set.rig) b.set.rig.set(b.slot, M);
      if (b.set.sail) b.set.sail.set(b.slot, M);
    }
    // 灯笼（画舫/客船）：glow，小面积
    if (meta.lanterns.length > 0 && b.lampBase >= 0) {
      for (let i = 0; i < meta.lanterns.length; i++) {
        const l = meta.lanterns[i];
        M.makeTranslation(l.x, l.y, l.z);
        M.premultiply(root);
        this.lampSet.set(b.lampBase + i, M, _c.setHex(0xffc478));
      }
    }
    // 橹：船尾两侧，橹杆外撇 + 上下摆
    if (b.oarBase >= 0) {
      const sweep = Math.sin(b.phase * 2.4) * 0.5;
      const n = meta.oars.length;
      for (let i = 0; i < n; i++) {
        const o = meta.oars[i];
        const s = o.side;
        // 橹外撇 0.55rad：桨叶甩到舷外水面，不再插进艉楼/舱棚
        _e.set(0, Math.PI + s * 0.55 + sweep * 0.20 * s, -0.20 + sweep * 0.16 * s); _q2.setFromEuler(_e);
        M.compose(_v.set(o.x, o.y, o.z), _q2, _sv.set(1, 1, 1));
        M.premultiply(root);
        this.oarSet.set(b.oarBase + i, M);
      }
    }
  }

  /** 尾迹：只在 |z| < 30 的水面内投放 */
  private writeWake(b: Boat): void {
    if (b.wake < 0) return;
    const w = WAKE_SLOTS[b.wake];
    if (Math.abs(b.z) >= 30) { w.len = 0; return; }
    const meta = b.set.parts;
    w.x = b.x - b.dir * meta.len * 0.42;
    w.z = b.z;
    w.yaw = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    w.len = 4.2 + b.speed * 1.9;
    w.wide = meta.beam * 0.42;
    w.strength = 0.16 + b.speed * 0.07;
  }

  /** 实例几何统一刷新（world 在主循环末尾调用 poolSet().flushAll()，这里补自己的池） */
  flush(): void {
    this.oarSet.flush(); this.lampSet.flush(); this.wheelSet.flush();
    this.legQuad.flush(); this.legBird.flush();
    this.boatSets.forEach((s) => { s.hard.flush(); s.cloth?.flush(); s.rig?.flush(); s.sail?.flush(); });
    this.cartSets.forEach((s) => { s.hard.flush(); s.cloth?.flush(); });
    this.sedanSets.forEach((s) => { s.hard.flush(); s.cloth?.flush(); });
    this.bodySets.forEach((s) => s.flush());
  }
}
