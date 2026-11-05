import * as THREE from 'three';
import type { Crowd } from '../actors/crowd';
import type { Actor } from '../actors/types';
import { PITCH_LIMIT, type Engine } from '../core/engine';
import { bridgeDeckY, bridgeDeckYAt, BRIDGE_HALF } from '../city/layout';
import { voxelColumnTop } from '../rt/voxelGround';
import { terrainHeight, waterAt } from '../world/terrain';
import { bus } from '../core/rng';
import { legacyClock, type Clock } from '../actors/behaviors';
import { HEAVEN_LIFT, HEAVEN_SCALE, heavenPoint } from '../sky/heavenFrame';

// ============ 玩家化身：GTA 式第三人称控制（附身模式） ============
export type PlayerMode = 'soul' | 'avatar';       // 灵魂相机 / 附身
export type PlayerState = 'foot' | 'swim' | 'mount' | 'boat';

export interface Rideable {
  kind: 'horse' | 'crane' | 'dragon' | 'qilin';
  pos: THREE.Vector3; yaw: number; phase: number; speed: number;
  flying: boolean; vy: number;
  riderAnchor: number;          // 骑手离背高度
  name: string;
  alive: boolean;
  segTrail?: THREE.Vector3[];   // 龙
  home: THREE.Vector3;
}

export interface DriveBoat {
  x: number; z: number; yaw: number; throttle: number; rudder: number;
  phase: number; driven: boolean;
}

const _up = new THREE.Vector3(0, 1, 0);

/** 步行 / 奔跑基准速度（m/s）。威胁只改系数、不改基准，探针才能断言线性关系。 */
const WALK_SPEED = 3.6;
const RUN_SPEED = 8.2;
/** 失向（孟婆茶）单独能把移动系数压到的最低值：再晕也留 0.6 的腿脚 */
const DISORIENT_MIN_SCALE = 0.6;
/** 失向满强度时的减速比例：1 - 0.4 = 0.6 */
const DISORIENT_SLOW = 0.4;
/** 失向满强度时相机偏航的抖动幅度（弧度），由调用方读取后自己叠加 */
const DISORIENT_JITTER = 0.12;

export class PlayerController {
  mode: PlayerMode = 'soul';
  state: PlayerState = 'foot';
  actor: Actor;                                  // 玩家化身（青衫游侠）
  camYaw = 0; camPitch = -0.18; camDist = 7.5;
  /** 天宫/地府等异界平面高度：非空时化身钉在该高度，不被城内地表拉回去 */
  realmY: number | null = null;
  /** 外部施加的移动系数（关卡威胁：望乡台的乡愁拖慢等） */
  speedScale = 1;
  /** 孟婆茶失向强度 0–1：0 清醒、1 刚饮下（内部状态，供调用方/探针读取） */
  disorient = 0;
  /** 失向的视野提示强度 0–1：调用方据此做灰化/噪点；本类不碰 DOM、不加材质 */
  fadeHint = 0;
  /** 脚步节流计时 */
  private stepT = 0;
  vy = 0;
  mounted: Rideable | null = null;
  boat: DriveBoat | null = null;
  interact: { pos: THREE.Vector3; r: number; label: string; exec: () => void } | null = null;
  busyUntil = 0;                                  // 交互动作锁定
  /**
   * 注入时钟（毫秒）：busy/交互锁定的时间基准。默认 legacyClock（宿主 performance.now），
   * 单机行为不变；无头测试 / 回放必须显式传入固定时钟——照 behaviors.ts / crowd.ts 的注入规矩。
   */
  clock: Clock = legacyClock;
  /** 移动端跳跃键置位、下一帧 update 消费；与键盘 Space 走同一条地面判定 */
  private jumpQueued = false;
  private fadeEl: HTMLElement | null = null;
  /**
   * 上一次 update 看到的化身位置。
   * `world.teleport` / `respawnPlayerAt` / 交互点 / Boss 击退都会直接改 `actor.pos`，
   * 不经过本类；靠跨帧位移识别「外部瞬移」，就地重算 realmY。
   */
  private lastX = 0; private lastY = 0; private lastZ = 0;

  constructor(private engine: Engine, crowd: Crowd, spawn: THREE.Vector3) {
    this.actor = crowd.spawnActor({
      occ: 'scholar', pos: spawn.clone(), cloth: 0x2a7a8a, pants: 0x1e4a52,
      hat: 1, action: 'stand', doing: '游侠（你）',
      data: { name: '游侠', nick: '你', group: 'guest', weapon: '双足', desc: '汴京城中的过客，全城任行', code: 'player' },
    });
    this.actor.freeze = true;
    this.lastX = spawn.x; this.lastY = spawn.y; this.lastZ = spawn.z;
    crowd.heroes.push(this.actor);
    this.bindInput();
    // 灵魂模式提示
    bus.emit('ui:toast', '按 V 键附身游侠，化身城中行人（GTA 模式）');
  }

  setFadeEl(el: HTMLElement | null): void { this.fadeEl = el; }

  /**
   * 移动速度的纯函数入口：走/跑基准 × 外部速度系数。
   * 只读状态、不写状态 —— 探针可直接断言「速度随 speedScale 线性变化」，
   * 不必依赖相机/化身位移（传送后是飞行模式，W 驱动相机而非化身）。
   */
  effectiveSpeed(run: boolean): number {
    return (run ? RUN_SPEED : WALK_SPEED) * this.speedScale;
  }

  /** 失向时相机偏航的抖动幅度（弧度）：调用方按自己的相位加在 camYaw 上 */
  get disorientJitter(): number {
    return DISORIENT_JITTER * this.disorient;
  }

  /**
   * 孟婆茶失向：k = 强度 0–1（1 = 刚饮下那一口）。
   * 只做状态与速度衰减：登记 disorient/fadeHint，并把 speedScale 压到最低 0.6。
   * 不引入 DOM、不新增材质；屏幕灰化由调用方读 fadeHint 自己画。
   * k=0 且此前没有失向时不写 speedScale —— 否则会抹掉 world.ts 每帧写入的乡愁 0.55。
   */
  applyDisorient(k: number): void {
    const s = Number.isFinite(k) ? THREE.MathUtils.clamp(k, 0, 1) : 0;
    if (s > 0) this.speedScale = Math.max(DISORIENT_MIN_SCALE, 1 - DISORIENT_SLOW * s);
    else if (this.disorient > 0) this.speedScale = 1; // 失向结束：恢复常速
    this.disorient = s;
    this.fadeHint = s;
  }

  /**
   * 落点 → 界域平面（`actor.pos.y` 是脚底）。
   * 异界（天宫/地府）直接以落点为钉面：这样「每帧钉住」是幂等操作，传送落点不被二次改写；
   * -1.7 只属于「相机眼高 → 脚底」的换算，见 toggleMode（落点本身已经在地面高度上）。
   */
  private realmAt(landingY: number): number | null {
    return landingY > 120 || landingY < -120 ? landingY : null;
  }

  /** 落位唯一入口：写位置并由落点反推 realmY（portal / 下坐骑 / 切模式共用） */
  private landAt(x: number, y: number, z: number): void {
    this.actor.pos.set(x, y, z);
    this.realmY = this.realmAt(y);
    this.vy = 0;
    this.lastX = x; this.lastY = y; this.lastZ = z;
  }

  /**
   * 外部瞬移识别：`world.teleport` / `respawnPlayerAt` / 交互点 / Boss 击退直接改 `actor.pos`
   * 时不经过本类，跨帧位移超过一帧最大行程即视为瞬移，就地按落点重算 realmY。
   * 阈值留两倍余量：水平 12m（飞行坐骑 60m/s × dt 上限 0.1s = 6m）；
   * 垂直 8m（跳跃最高 7.5² / (2·22) ≈ 1.3m）。
   */
  private syncExternalMove(): void {
    const p = this.actor.pos;
    if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) > 12 || Math.abs(p.y - this.lastY) > 8) {
      this.realmY = this.realmAt(p.y);
      this.vy = 0;
    }
    this.lastX = p.x; this.lastY = p.y; this.lastZ = p.z;
  }

  toggleMode(): void {
    if (this.state !== 'foot') { bus.emit('ui:toast', '请先下坐骑/下船（E 键）再切换'); return; }
    this.mode = this.mode === 'soul' ? 'avatar' : 'soul';
    if (this.mode === 'avatar') {
      // 化身搬到相机脚下：否则在灵界（天宫/地府）按 V，相机会跳回城里的化身位置。
      // 异界沿用「相机眼高 − 1.7m = 脚底」的既有口径；人间落到相机脚下的地面，
      // 否则从天上附身时化身会停在旧界的空中一路下坠（天宫→人间按 V 的实测症状）。
      const c = this.engine.camera.position;
      if (c.y > 120 || c.y < -120) {
        this.landAt(c.x, c.y - 1.7, c.z);
      } else {
        const gh = this.groundHeight(c.x, c.z, c.y);
        this.landAt(c.x, Number.isFinite(gh) ? gh : 0, c.z);
      }
      // 相机就位到化身身后：camYaw 必须等于化身朝向。
      // 旧值 `actor.yaw + Math.PI` 让相机与朝向差 180°，而移动方向是由 camYaw 推出来的，
      // 于是「附身态按 W 会倒退」——正是用户报的「附身/灵魂时按键是反的」。
      this.camYaw = this.actor.yaw;
      bus.emit('cam:mode', 'avatar');
    } else {
      bus.emit('cam:mode', 'fly');
      this.engine.setCamMode('fly');
    }
    bus.emit('player:mode', this.mode);
  }

  private bindInput(): void {
    window.addEventListener('keydown', (ev) => {
      // 按住不放时浏览器会以按键重复速率连发 keydown（约 30 次/秒）：
      // V 会疯狂翻转附身、E/F 会连发交互与攻击，这里只认物理按下的第一次。
      if (ev.repeat) return;
      if (ev.code === 'KeyV') this.toggleMode();
      if (ev.code === 'KeyE' && this.mode === 'avatar') this.tryInteract();
      if (ev.code === 'KeyF') this.tryAttack();
    });
    const el = this.engine.renderer.domElement;
    // 单击（非拖拽）出拳。路由保证同一次单击只触发一个消费点：
    // 英雄聚焦优先级更高（点角色不会同时挥拳），指针锁定只作兜底。
    this.engine.input.register('attack', () => {
      if (this.mode !== 'avatar' || this.state !== 'foot') return false;
      this.tryAttack();
      return true;
    }, 10);
    // 视角拖拽不再在 Player 里挂第二套 pointermove：
    // engine.dragLook → onAvatarDrag → avatarLookDrag 是唯一通道。
    // 旧版引擎与 Player 各挂一套，附身态一次拖动会双倍转视角（灵敏度忽高忽低）。
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'avatar') return;
      this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(e.deltaY) * 0.8, 2.5, 16);
    }, { passive: true });
  }

  /** 附身模式相机：由 engine.dragLook 统一转发（拖拽 / 指针锁定都走这里） */
  avatarLookDrag(dx: number, dy: number): void {
    if (this.mode !== 'avatar') return;
    this.camYaw -= dx * 0.0042;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy * 0.003, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** 交互入口由 interact 模块注入 */
  interactHook: (() => void) | null = null;
  /** 攻击入口由物理系统注入 */
  attackHook: (() => void) | null = null;
  tryInteract(): void {
    if (this.clock() < this.busyUntil) return;
    if (this.state === 'mount' && this.mounted) { this.dismount(); return; }
    if (this.state === 'boat' && this.boat) { this.dismount(); return; }
    this.interactHook?.();
  }
  tryAttack(): void {
    if (this.mode === 'avatar' && this.state === 'foot') this.attackHook?.();
  }

  /** 移动端跳跃键入口：只置一次请求，真正起跳仍由 update 的地面判定决定 */
  jump(): void {
    if (this.mode !== 'avatar' || this.state !== 'foot') return;
    this.jumpQueued = true;
  }

  // ---- 高度场：地面/桥面/码头/天空平台/地府/大地山河 ----
  groundHeight(x: number, z: number, refY: number): number {
    if (refY < -100) { // 地府层
      return -260;
    }
    // 天宫层（旧 150 是「天宫在 200m」时代的分界）：抬升后只有真正到了天宫高度才套平台表。
    // 若仍用 150，任何在 150–2085m 中空飞行的人都会被「平台高于自己」顶到 2153m。
    if (refY > 150 + HEAVEN_LIFT) { // 天宫：平台 + 大地山川（远山可被顶开）
      let best = -Infinity;
      for (const p of PLATFORMS) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz < p.r * p.r) best = Math.max(best, p.y);
      }
      const th = terrainHeight(x, z);
      if (th > 3) best = Math.max(best, th);
      return best;
    }
    // 城区
    if (Math.hypot(x, z) < 5150) {
      if (Math.abs(x) < 6.5 && Math.abs(z) < BRIDGE_HALF - 1) return bridgeDeckY(z);
      // 主河段其余 7 座桥（石拱/叠梁拱/廊桥/浮桥/木梁）：桥面高程与建桥共用 layout 的同一份真源
      const onBridge = bridgeDeckYAt(x, z);
      if (onBridge !== null) return onBridge;
      for (const d of DOCKS) {
        if (Math.abs(x - d[0]) < d[2] / 2 && Math.abs(z - d[1]) < d[3] / 2) return 0.95;
      }
      // P1-2 体素站立：营造司（及未来全部 block/creation）柱顶纳入地面（一格跳跃可达语义）
      const vt = voxelColumnTop(x, z, refY);
      if (vt !== null) return vt;
      return 0;
    }
    // 城外大地
    return terrainHeight(x, z);
  }

  update(t: number, dt: number): void {
    if (this.mode !== 'avatar') {
      // 灵魂模式：化身站立呼吸，相机不受控
      this.jumpQueued = false;
      this.actor.action = this.clock() < this.busyUntil ? this.actor.action : 'stand';
      return;
    }
    // 跳跃请求每帧最多消费一次：忙时也清掉，避免动作结束后补跳
    const wantJump = this.jumpQueued;
    this.jumpQueued = false;
    // 世界层直接改 actor.pos 的传送（teleport / 死亡重生 / 阴阳界交互点）在这里被识别
    this.syncExternalMove();
    const k = this.engine.keys;
    const joy = this.engine.touchMove;
    const now = this.clock();
    const busy = now < this.busyUntil || now < this.actor.impactUntil;
    let ix = 0, iz = 0;
    if (!busy) {
      if (k.has('KeyW')) iz -= 1;
      if (k.has('KeyS')) iz += 1;
      if (k.has('KeyA')) ix -= 1;
      if (k.has('KeyD')) ix += 1;
      ix += this.engine.touchMove.x; iz += this.engine.touchMove.y;
      const il = Math.hypot(ix, iz);
      if (il > 1) { ix /= il; iz /= il; }
    }
    const run = k.has('ShiftLeft') || k.has('ShiftRight');

    if (this.state === 'boat' && this.boat) {
      const b = this.boat;
      b.throttle = THREE.MathUtils.clamp(b.throttle + (k.has('KeyW') ? dt * 0.8 : 0) - (k.has('KeyS') ? dt * 0.8 : 0), 0, 1);
      b.rudder = THREE.MathUtils.clamp(b.rudder + (k.has('KeyA') ? dt * 1.6 : 0) - (k.has('KeyD') ? dt * 1.6 : 0), -1, 1);
      if (!busy) {
        b.yaw += b.rudder * b.throttle * dt * 1.4;
        const spd = 2 + b.throttle * 5;
        b.x += Math.sin(b.yaw) * spd * dt;
        b.z += Math.cos(b.yaw) * spd * dt;
        b.x = THREE.MathUtils.clamp(b.x, -620, 620);
        if (Math.abs(b.z) > 26) { b.z = Math.sign(b.z) * 26; b.throttle = 0; }
        b.phase += dt * (2 + b.throttle * 6);
        this.actor.pos.set(b.x - Math.sin(b.yaw) * 1.6, -0.5 + Math.sin(b.phase) * 0.07, b.z - Math.cos(b.yaw) * 1.6);
        this.actor.yaw = b.yaw;
        this.actor.action = b.throttle > 0.05 ? 'row' : 'sitTea';
      }
      this.followCam(dt);
      return;
    }

    if (this.state === 'mount' && this.mounted) {
      const m = this.mounted;
      const cy = Math.cos(this.camPitch);
      const fwd = _up.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)).normalize();
      const px0 = m.pos.x, pz0 = m.pos.z, py0 = m.pos.y;
      if (m.flying) {
        // 飞行坐骑：沿视线飞 + 升降
        const dir = new THREE.Vector3(-Math.sin(this.camYaw) * cy, Math.sin(this.camPitch) + (k.has('Space') ? 0.55 : 0) - (k.has('ControlLeft') || k.has('KeyC') ? 0.55 : 0), -Math.cos(this.camYaw) * cy);
        if (dir.lengthSq() > 0 && !busy) {
          dir.normalize();
          const sp = run ? 60 : 34;
          m.pos.addScaledVector(dir, sp * dt);
        }
        // 上限 900 是「天宫在 200m」时代的天花板；整层抬到 2150 后必须放开到 900+HEAVEN_LIFT，
        // 否则骑飞行坐骑永远飞不到天宫（到 900 就被夹住）。
        m.pos.y = THREE.MathUtils.clamp(m.pos.y, -60, 900 + HEAVEN_LIFT);
        m.yaw = this.camYaw + Math.PI;
        m.phase += dt * (6 + (run ? 5 : 0));
        m.speed = Math.hypot(m.pos.x - px0, m.pos.z - pz0) / Math.max(dt, 1e-4);
        this.actor.pos.set(m.pos.x, m.pos.y + m.riderAnchor, m.pos.z);
        this.actor.yaw = m.yaw;
        this.actor.action = 'rideAnimal';
        // 地表/水面防穿
        const gh = this.groundHeight(m.pos.x, m.pos.z, m.pos.y);
        if (Number.isFinite(gh) && m.pos.y < gh + 0.6) { m.pos.y = gh + 0.6; }
      } else {
        // 地面坐骑（马）
        const sp = run ? 9.5 : 5.5;
        let mx = 0, mz = 0;
        if (!busy) { mx = -Math.sin(this.camYaw) * -iz + Math.cos(this.camYaw) * ix; mz = -Math.cos(this.camYaw) * -iz - Math.sin(this.camYaw) * ix; }
        if (mx !== 0 || mz !== 0) {
          const ty = Math.atan2(mx, mz);
          let dy = ty - m.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          m.yaw += dy * Math.min(1, dt * 6);
          m.pos.x += Math.sin(m.yaw) * sp * dt;
          m.pos.z += Math.cos(m.yaw) * sp * dt;
          m.pos.x = THREE.MathUtils.clamp(m.pos.x, -640, 640);
          m.pos.z = THREE.MathUtils.clamp(m.pos.z, -160, 420);
          m.phase += dt * (run ? 9 : 5.5);
        } else m.phase += dt * 1.2;
        const gh = this.groundHeight(m.pos.x, m.pos.z, 5);
        m.pos.y = Number.isFinite(gh) ? gh : 0;
        this.actor.pos.set(m.pos.x, m.pos.y + m.riderAnchor, m.pos.z);
        this.actor.yaw = m.yaw;
        this.actor.action = 'rideAnimal';
      }
      this.followCam(dt);
      return;
    }

    // ---- 步行 / 游泳 ----
    const p = this.actor.pos;
    const gh = this.groundHeight(p.x, p.z, p.y);
    const inCityRiver = Math.abs(p.z) < 27 && p.y > -100 && p.y < 150 && !(Math.abs(p.x) < 7 && Math.abs(p.z) < BRIDGE_HALF);
    const terrainWater = waterAt(p.x, p.z);
    const ghTerrain = Math.abs(p.x) > 5150 || Math.abs(p.z) > 5150 ? terrainHeight(p.x, p.z) : gh;
    const swimming = (inCityRiver && gh === 0 && p.y < 0.5) || (terrainWater !== null && ghTerrain < terrainWater - 1.1);
    if (swimming) {
      this.state = 'swim';
      const sp = 2.6;
      const surface = terrainWater !== null && !(inCityRiver) ? terrainWater : -1.05;
      if (ix !== 0 || iz !== 0) {
        const mx = -Math.sin(this.camYaw) * -iz + Math.cos(this.camYaw) * ix;
        const mz = -Math.cos(this.camYaw) * -iz - Math.sin(this.camYaw) * ix;
        p.x += mx * sp * dt; p.z += mz * sp * dt;
        this.actor.yaw = Math.atan2(mx, mz);
      }
      p.x = THREE.MathUtils.clamp(p.x, -620, 620);
      p.y = surface - 0.75;
      this.actor.action = 'swim';
    } else {
      if (this.state === 'swim') { // 上岸
        const bank = p.z >= 0 ? 1 : -1;
        p.z = bank * 29; this.state = 'foot';
      } else this.state = 'foot';
      const sp = this.effectiveSpeed(run);
      if (ix !== 0 || iz !== 0) {
        const mx = -Math.sin(this.camYaw) * -iz + Math.cos(this.camYaw) * ix;
        const mz = -Math.cos(this.camYaw) * -iz - Math.sin(this.camYaw) * ix;
        p.x += mx * sp * dt;
        p.z += mz * sp * dt;
        // 旧版把步行锁在 ±660 / z[-200,430]：一旦在宫城或灵界行走就被拽回河岸。
        p.x = THREE.MathUtils.clamp(p.x, -20000, 20000);
        p.z = THREE.MathUtils.clamp(p.z, -20000, 20000);
        this.actor.yaw = Math.atan2(mx, mz);
      }
      // 重力/台阶；异界（天宫/地府）不落地，钉在实化的平面上走
      if (this.realmY !== null) {
        p.y = this.realmY;
        this.vy = 0;
      } else {
        const target = Number.isFinite(gh) ? gh : 0;
        // 起跳当帧 vy>0 但 p.y 只比地面高 0.05：若只看位置会走 else 把 vy 清零，
        // 跳跃在平地上等于没发生（移动端跳跃键实测 dy=0）。有向上速度就继续积分。
        if (p.y > target + 0.05 || this.vy > 0) { this.vy -= 22 * dt; p.y = Math.max(target, p.y + this.vy * dt); this.actor.action = 'stand'; }
        else { p.y = target; this.vy = 0; }
      }
      const groundY = this.realmY !== null ? this.realmY : (Number.isFinite(gh) ? gh : 0);
      if ((k.has('Space') || wantJump) && p.y <= groundY + 0.05 && !busy) { this.vy = 7.5; p.y += 0.05; }
      if (!busy) this.actor.action = (ix !== 0 || iz !== 0) ? (run ? 'run' : 'walk') : 'stand';
      // 脚步：按实际位移节流发事件（跑动 2.4 步/秒、步行 1.6 步/秒），静止不发
      const moving = (ix !== 0 || iz !== 0) && this.state === 'foot';
      this.stepT = (this.stepT ?? 0) - dt;
      if (moving && this.stepT <= 0) {
        this.stepT = run ? 0.42 : 0.62;
        bus.emit('sfx:step', run);
      }
      // 阴阳界传送
      for (const pt of PORTALS) {
        if (Math.hypot(p.x - pt.x, p.z - pt.z) < 2.6 && Math.abs(p.y - pt.y) < 4) { this.usePortal(pt); break; }
      }
    }
    if (busy && now >= this.busyUntil) { /* 动作由 interact 恢复 */ }
    this.followCam(dt);
  }

  private followCam(dt: number): void {
    const focus = this.state === 'mount' && this.mounted ? this.mounted.pos : this.state === 'boat' && this.boat
      ? new THREE.Vector3(this.boat.x, 0.5, this.boat.z) : this.actor.pos;
    const cy = Math.cos(this.camPitch);
    const off = new THREE.Vector3(Math.sin(this.camYaw) * cy, -Math.sin(this.camPitch), Math.cos(this.camYaw) * cy).multiplyScalar(this.camDist + (this.state === 'mount' ? 6 : 0));
    const target = focus.clone().add(off).add(new THREE.Vector3(0, 2.2, 0));
    this.engine.camera.position.lerp(target, Math.min(1, dt * 10));
    this.engine.lookTarget.lerp(focus.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.min(1, dt * 12));
  }

  private usePortal(pt: { x: number; y: number; z: number; to: [number, number, number]; label: string }): void {
    if (this.fadeEl) {
      this.fadeEl.style.transition = 'opacity .45s';
      this.fadeEl.style.opacity = '1';
      window.setTimeout(() => {
        // 跨界必须同步 realmY：旧实现只搬位置，地府→人间后化身仍被钉在 −260
        this.landAt(pt.to[0], pt.to[1], pt.to[2]);
        bus.emit('ui:toast', pt.label);
        this.fadeEl!.style.opacity = '0';
      }, 460);
      this.busyUntil = this.clock() + 1000;
    } else {
      this.landAt(pt.to[0], pt.to[1], pt.to[2]);
      bus.emit('ui:toast', pt.label);
    }
  }

  private dismount(): void {
    if (this.mounted) {
      const m = this.mounted;
      const gy = this.groundHeight(m.pos.x + 2, m.pos.z, m.pos.y);
      this.landAt(m.pos.x + 2, Number.isFinite(gy) ? gy : 0, m.pos.z);
      this.actor.action = 'stand';
      this.mounted = null; this.state = 'foot';
      bus.emit('ui:toast', '已下' + (m.name));
    }
    if (this.boat) {
      const b = this.boat;
      const bank = Math.abs(b.z) > 12 ? Math.sign(b.z) : 1;
      this.landAt(b.x, 0, bank * 30);
      this.actor.action = 'stand';
      b.driven = false; this.boat = null; this.state = 'foot';
      bus.emit('ui:toast', '已靠岸下船');
    }
  }
}

export interface Platform { x: number; y: number; z: number; r: number }
export const PLATFORMS: Platform[] = [
  { x: 0, y: 206, z: 0, r: 44 }, { x: 0, y: 203, z: -85, r: 30 }, { x: 0, y: 214, z: 95, r: 46 },
  { x: -150, y: 201, z: 45, r: 27 }, { x: 150, y: 204, z: 25, r: 19 }, { x: 120, y: 206, z: 120, r: 15 },
  { x: 152, y: 205, z: 142, r: 12 }, { x: 40, y: 209, z: -55, r: 17 },
];
// 平台表是**烘焙前**的天宫坐标（x/z 与 y 都是），而几何在 expansion 里被 2.2× + 抬升：
// 必须走与顶点相同的变换，否则附身落在天宫时 groundHeight 会返回旧值 206，化身直接坠到人间上空。
// （x/z 也要换算：只看 y 会让「站得住」的判定落在离实体平台 1.2 倍远的位置。）
for (const p of PLATFORMS) {
  const [x, y, z] = heavenPoint(p.x, p.y, p.z);
  p.x = x; p.y = y; p.z = z; p.r *= HEAVEN_SCALE;
}
export const DOCKS: [number, number, number, number][] = [
  [-238, 24, 42, 14], [-206, 20, 18, 10], [-268, 22, 20, 10],
];
export interface PortalDef { x: number; y: number; z: number; to: [number, number, number]; label: string }
export const PORTALS: PortalDef[] = [
  { x: 470, y: 0, z: 24, to: [0, -260, -130], label: '你穿过了「阴阳界」……冷风扑面，黄泉在望' },
  { x: 0, y: -260, z: -124, to: [472, 0, 28], label: '你回到了阳间——汴京的人间烟火' },
];
