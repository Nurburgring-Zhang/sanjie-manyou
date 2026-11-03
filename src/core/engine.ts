import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TimeOfDay } from './palette';
import { Tweener, easeInOut } from './tween';
import { bus } from './rng';
import { LAYER_NO_REFLECT } from './layers';
import { setLodSink, type LodGroupSpec, type LodTierName } from '../city/infill';

export interface Updatable { update(t: number, dt: number): void }

export type CamMode = 'cinema' | 'fly' | 'walk' | 'focus';
export type QualityName = 'high' | 'med' | 'low';

/** 俯仰上限 ±85°：留 5° 余量避免万向节翻转（旧值 -71.6°…77.3°，抬头受限且两种模式不一致） */
export const PITCH_LIMIT = (85 * Math.PI) / 180;

export interface QualityTier {
  name: QualityName; crowd: number; bloom: boolean; shadows: boolean; shadowSize: number; pixelRatio: number;
}
export const QUALITY: Record<QualityName, QualityTier> = {
  high: { name: 'high', crowd: 1.0, bloom: true, shadows: true, shadowSize: 2048, pixelRatio: 2 },
  med: { name: 'med', crowd: 0.62, bloom: true, shadows: true, shadowSize: 1024, pixelRatio: 1.5 },
  low: { name: 'low', crowd: 0.34, bloom: false, shadows: false, shadowSize: 512, pixelRatio: 1 },
};

// ============ 运行时 LOD：分距离四档 + 滞回 + 兜底 ============
// 近 <120m 高精度 / 中 120–400m 中精度 / 远 400–1200m 低精度 / 极远 >1200m 贴图剪影。
// 同一条边界上「进档」与「出档」用两个阈值（120→150 / 400→470 / 1200→1350，各 +25%）：
// 相机停在 120–150m 之间时档位一动不动 —— 不抖靠的是这条滞回带，不是冷却计时或去抖延迟。
export const LOD_TIERS: LodTierName[] = ['near', 'mid', 'far', 'impostor'];
/** 进入阈值（m）：距离 < enter[i] 时由 i+1 档升到 i 档 */
export const LOD_ENTER = [120, 400, 1200];
/** 退出阈值（m）：距离 > exit[i] 时由 i 档降到 i+1 档。= 进入阈值 × 1.25 */
export const LOD_EXIT = [150, 470, 1350];

/**
 * 只由「当前档 + 距离」推目标档：跨进入阈值才升档，跨退出阈值才降档，滞回带内原样返回。
 * 单调推拉 60→2000→60 时每条边界只穿一次，单组最多 3+3 次切换。
 */
export function resolveLodTier(current: number, dist: number): number {
  let t = current < 0 ? 0 : current > 3 ? 3 : current;
  while (t > 0 && dist < LOD_ENTER[t - 1]) t--;
  while (t < 3 && dist > LOD_EXIT[t]) t++;
  return t;
}

export interface LodGroupSnapshot {
  id: string;
  /** 当前实际显示档（未就绪被拦下时不等 want） */
  tier: LodTierName;
  /** 距离算出的目标档 */
  want: LodTierName;
  /** 到组外沿的 3D 距离（m，取整） */
  dist: number;
  ready: Record<LodTierName, boolean>;
  /** 各档挂的网格数（0 = 本组没有这一档） */
  meshes: Record<LodTierName, number>;
  visible: number;
  switches: number;
  /** 目标档未就绪、保留上一档的帧数 */
  blocked: number;
}

export interface LodView {
  groups: LodGroupSnapshot[];
  /** 防抖指标：全组里切换最多那一组的累计切换次数（60m→2000m→60m 全程应 ≤6） */
  switches: number;
  /** 全组累计切换事件数 */
  switchEvents: number;
  /** 帧末：距离在近档环内、却一个网格都没显示的组数（近处空白）。兜底保证恒为 0 */
  lastFrameMissingNear: number;
  nearVisibleMeshes: number;
  /** 每帧只要有组处于该档就 +1，用来断言「四档各命中一次」 */
  tierHits: Record<LodTierName, number>;
  frame: number;
  blocked: number;
  lastSwitch: { id: string; from: LodTierName; to: LodTierName; dist: number } | null;
  thresholds: { enter: number[]; exit: number[] };
  reset: () => void;
  setReady: (id: string, tier: LodTierName, ready: boolean) => boolean;
}

interface LodGroup {
  id: string;
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  near: Set<THREE.Object3D>;
  mid: Set<THREE.Object3D>;
  far: Set<THREE.Object3D>;
  meshes: THREE.Object3D[];
  card: { w: number; h: number } | null;
  ready: Record<LodTierName, boolean>;
  /** -1 = 还没落档（首帧按机位直接落，不记切换） */
  tier: number;
  want: number;
  dist: number;
  switches: number;
  blocked: number;
  recovered: number;
  snap: LodGroupSnapshot;
}

const LOD_HIT_TMP = new Set<number>();
const LOD_EMPTY: Set<THREE.Object3D> = new Set();

/** 极远档剪影贴图：一张固定的宋代天际线（透明底），全城所有组共用一次绘制 */
function makeLodSilhouette(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = '#2b3543';
  g.fillRect(0, 100, 512, 28);
  for (let x = -6; x < 520; x += 7 + rnd() * 13) {
    const w = 9 + rnd() * 26, h = 10 + rnd() * 30;
    g.fillRect(x, 100 - h, w, h);
    // 反宇屋面：檐口两端起翘，远看才是一条宋式天际线而不是方齿
    g.beginPath();
    g.moveTo(x - 4, 100 - h);
    g.quadraticCurveTo(x + w / 2, 100 - h - 8 - rnd() * 7, x + w + 4, 100 - h);
    g.lineTo(x + w + 2, 100 - h + 2);
    g.lineTo(x - 2, 100 - h + 2);
    g.closePath();
    g.fill();
  }
  for (const tx of [96, 268, 404]) {
    g.fillRect(tx - 3, 40, 6, 58);
    g.beginPath();
    g.moveTo(tx - 9, 46); g.lineTo(tx, 12); g.lineTo(tx + 9, 46);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export class LodManager {
  readonly view: LodView;
  private groups: LodGroup[] = [];
  private cards: THREE.InstancedMesh | null = null;
  private cardMat: THREE.MeshBasicMaterial;
  private cardGeo = new THREE.PlaneGeometry(1, 1);
  private readonly scene: THREE.Scene;
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpF = new THREE.Vector3();
  private readonly tmpU = new THREE.Vector3();
  private readonly tmpR = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.cardMat = new THREE.MeshBasicMaterial({
      map: makeLodSilhouette(), transparent: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: true,
    });
    const tierHits: Record<LodTierName, number> = { near: 0, mid: 0, far: 0, impostor: 0 };
    this.view = {
      groups: [],
      switches: 0,
      switchEvents: 0,
      lastFrameMissingNear: 0,
      nearVisibleMeshes: 0,
      tierHits,
      frame: 0,
      blocked: 0,
      lastSwitch: null,
      thresholds: { enter: LOD_ENTER, exit: LOD_EXIT },
      reset: () => this.reset(),
      setReady: (id, tier, ready) => this.setReady(id, tier, ready),
    };
  }

  /** 接线接口：infill 按中心距离注册一组 InstancedMesh（四档是同一批网格的可见子集） */
  register(spec: LodGroupSpec): void {
    const near = new Set(spec.tiers.near);
    const mid = new Set(spec.tiers.mid);
    const far = new Set(spec.tiers.far);
    const all = new Set<THREE.Object3D>([...spec.tiers.near, ...spec.tiers.mid, ...spec.tiers.far, ...spec.tiers.impostor]);
    if (all.size === 0 && !spec.card) return;
    const snap: LodGroupSnapshot = {
      id: spec.id,
      tier: 'near',
      want: 'near',
      dist: 0,
      ready: { near: true, mid: true, far: true, impostor: !!spec.card },
      meshes: { near: near.size, mid: mid.size, far: far.size, impostor: spec.card ? 1 : 0 },
      visible: all.size,
      switches: 0,
      blocked: 0,
    };
    const g: LodGroup = {
      id: spec.id,
      cx: spec.cx, cy: spec.cy, cz: spec.cz,
      hx: spec.hx, hy: spec.hy, hz: spec.hz,
      near, mid, far,
      meshes: Array.from(all),
      card: spec.card,
      ready: { near: true, mid: true, far: true, impostor: !!spec.card },
      tier: -1,
      want: 0,
      dist: 0,
      switches: 0,
      blocked: 0,
      recovered: 0,
      snap,
    };
    this.groups.push(g);
    this.view.groups.push(snap);
    this.ensureCards(this.groups.length);
  }

  /** 资源就绪位：把某组某档标为未就绪后，管理器会保留上一档而不是隐藏该组 */
  setReady(id: string, tier: LodTierName, ready: boolean): boolean {
    const g = this.groups.find((x) => x.id === id);
    if (!g) return false;
    g.ready[tier] = ready;
    g.snap.ready[tier] = ready;
    return true;
  }

  reset(): void {
    this.view.switches = 0;
    this.view.switchEvents = 0;
    this.view.lastFrameMissingNear = 0;
    this.view.nearVisibleMeshes = 0;
    this.view.frame = 0;
    this.view.blocked = 0;
    this.view.lastSwitch = null;
    for (const t of LOD_TIERS) this.view.tierHits[t] = 0;
    for (const g of this.groups) { g.switches = 0; g.blocked = 0; g.recovered = 0; }
  }

  /** 每帧一次：按相机位置给每组定档，只改 visible；近档永不空 */
  update(cam: THREE.Vector3): void {
    const view = this.view;
    view.frame++;
    let nearVisible = 0, missingNear = 0, maxSwitches = 0, cardIdx = 0, blockedTotal = 0;
    const hits = LOD_HIT_TMP;
    hits.clear();

    for (const g of this.groups) {
      const d = this.distance(g, cam);
      g.dist = d;

      if (g.tier < 0) {
        // 首帧：按当前机位直接落档，不记一次切换（否则开局全城凭空多一跳）
        const t = this.firstReady(g, resolveLodTier(0, d));
        if (t >= 0) { g.tier = t; g.want = t; this.applyVisibility(g); }
      } else {
        const want = resolveLodTier(g.tier, d);
        g.want = want;
        if (want !== g.tier) {
          if (this.isReady(g, want)) this.tierSwitch(g, want);
          else g.blocked++;                       // 目标档未就绪 → 保留上一档（禁止隐藏）
        }
        // 近档兜底：当前档满盘可见网格为 0 或已失效时，退到最近的就绪档（宁可糊，不能空）
        if (!this.isReady(g, g.tier) || this.visibleCount(g) === 0) {
          const fb = this.firstReady(g, g.tier);
          if (fb >= 0 && fb !== g.tier) { this.tierSwitch(g, fb); g.recovered++; }
        }
      }

      const vis = this.visibleCount(g);
      if (g.tier >= 0) {
        if (g.tier === 0) { nearVisible += vis; if (vis === 0) missingNear++; hits.add(0); }
        else if (g.tier === 1) hits.add(1);
        else if (g.tier === 2) hits.add(2);
        else { hits.add(3); this.writeCard(g, cardIdx++, cam); }
      }

      blockedTotal += g.blocked;
      const s = g.snap;
      s.tier = LOD_TIERS[g.tier < 0 ? 0 : g.tier];
      s.want = LOD_TIERS[g.want < 0 ? 0 : g.want];
      s.dist = Math.round(d);
      s.visible = vis;
      s.switches = g.switches;
      s.blocked = g.blocked;
      if (g.switches > maxSwitches) maxSwitches = g.switches;
    }

    for (const t of hits) view.tierHits[LOD_TIERS[t]]++;
    view.nearVisibleMeshes = nearVisible;
    view.lastFrameMissingNear = missingNear;
    view.switches = maxSwitches;
    view.blocked = blockedTotal;
    if (this.cards) {
      this.cards.count = cardIdx;
      if (cardIdx > 0) this.cards.instanceMatrix.needsUpdate = true;
    }
  }

  private distance(g: LodGroup, cam: THREE.Vector3): number {
    // 到「组外沿包围盒」的距离：相机站在坊里时距离为 0，否则按盒子边界算
    const dx = Math.max(0, Math.abs(cam.x - g.cx) - g.hx);
    const dy = Math.max(0, Math.abs(cam.y - g.cy) - g.hy);
    const dz = Math.max(0, Math.abs(cam.z - g.cz) - g.hz);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private isReady(g: LodGroup, t: number): boolean {
    if (t === 0) return g.ready.near && g.near.size > 0;
    if (t === 1) return g.ready.mid && g.mid.size > 0;
    if (t === 2) return g.ready.far && g.far.size > 0;
    return g.ready.impostor && !!g.card && !!this.cards;
  }

  /** 从目标档往外找第一个就绪档；再往回找。全部未就绪返回 -1 */
  private firstReady(g: LodGroup, from: number): number {
    const f = Math.max(0, Math.min(3, from));
    for (let t = f; t <= 3; t++) if (this.isReady(g, t)) return t;
    for (let t = f - 1; t >= 0; t--) if (this.isReady(g, t)) return t;
    return -1;
  }

  private tierSwitch(g: LodGroup, t: number): void {
    const from = g.tier;
    g.tier = t;
    g.want = t;
    this.applyVisibility(g);
    if (from < 0) return;
    g.switches++;
    this.view.switchEvents++;
    this.view.lastSwitch = { id: g.id, from: LOD_TIERS[from], to: LOD_TIERS[t], dist: Math.round(g.dist) };
  }

  private applyVisibility(g: LodGroup): void {
    const set = g.tier === 0 ? g.near : g.tier === 1 ? g.mid : g.tier === 2 ? g.far : LOD_EMPTY;
    for (const m of g.meshes) m.visible = set.has(m);
  }

  private visibleCount(g: LodGroup): number {
    let n = 0;
    for (const m of g.meshes) if (m.visible) n++;
    return n;
  }

  /** 极远档：一组一张贴图剪影卡，全部组共用 1 个 InstancedMesh（1 个 draw call 覆盖全城） */
  private writeCard(g: LodGroup, i: number, cam: THREE.Vector3): void {
    if (!this.cards || !g.card) return;
    const w = g.card.w, h = g.card.h;
    const px = g.cx, py = g.cy + h * 0.5 - 2, pz = g.cz;
    const f = this.tmpF.set(cam.x - px, cam.y - py, cam.z - pz);
    if (f.lengthSq() < 1e-6) f.set(0, 1, 0); else f.normalize();
    // 俯视时把卡片放平（法线朝上），否则它侧对相机、整片城区从画面里消失
    const up = Math.abs(f.y) > 0.98 ? this.tmpU.set(0, 0, 1) : this.worldUp;
    const right = this.tmpR.crossVectors(up, f).normalize();
    const up2 = this.tmpN.crossVectors(f, right).normalize();
    this.tmpM.makeBasis(right, up2, f);
    this.tmpM.scale(this.tmpS.set(w, h, 1));
    this.tmpM.setPosition(px, py, pz);
    this.cards.setMatrixAt(i, this.tmpM);
  }

  private ensureCards(n: number): void {
    if (this.cards && this.cards.instanceMatrix.count >= n) return;
    let cap = 16;
    while (cap < n) cap *= 2;
    if (this.cards) { this.scene.remove(this.cards); this.cards.dispose(); }
    const im = new THREE.InstancedMesh(this.cardGeo, this.cardMat, cap);
    im.name = 'lod_impostor';
    im.count = 0;
    im.castShadow = false;
    im.receiveShadow = false;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cards = im;
    this.scene.add(im);
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTint: { value: new THREE.Color(0xbfe8ff) },
    uTintAmt: { value: 0.10 },
    uVig: { value: 0.32 },
    uScan: { value: 0.0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uTintAmt, uVig, uScan, uTime;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = mix(c.rgb, c.rgb * uTint * 1.9, uTintAmt);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - uVig * smoothstep(0.32, 0.85, d);
      float scan = sin((vUv.y + uTime * 0.02) * 1200.0) * 0.5 + 0.5;
      c.rgb *= 1.0 - uScan * scan * 0.35;
      gl_FragColor = c;
    }`,
};

const CAM_TMP1 = new THREE.Vector3();
const CAM_TMP2 = new THREE.Vector3();
const CAM_TMP3 = new THREE.Vector3();
const CAM_TMP4 = new THREE.Vector3();

interface ClickConsumer {
  name: string;
  priority: number;
  handle: (ev: PointerEvent) => boolean;
}

/**
 * 鼠标单击统一路由。
 *
 * 背景：同一个 canvas 上曾各自挂了三套 pointerup —— 指针锁定（engine）、附身出拳（player）、
 * 点英雄聚焦（ui）。三套都用 6px 阈值判定「单击」，于是点一下英雄会同时出拳 + 锁指针 + 聚焦。
 *
 * 现在 canvas 上只保留这一对 pointerdown/pointerup：按下记起点，抬起判单击（位移 ≤6px），
 * 然后按优先级依次询问消费点。谁先返回 true 谁吃掉这次单击；`consumed` 一旦置位，
 * 后到的处理器直接跳过。三处功能都保留，只是同一次单击只发生其中一件。
 * 优先级：英雄聚焦(20) > 附身出拳(10) > 指针锁定（fallback，最后兜底）。
 * 鼠标锁定时屏幕坐标不可靠，英雄聚焦自行放弃；出拳仍然有效。
 */
export class PointerInputRouter {
  static readonly CLICK_SLOP = 6;
  private consumers: ClickConsumer[] = [];
  private fallback: ((ev: PointerEvent) => boolean) | null = null;
  private downX = 0; private downY = 0;
  /** 每个消费点真正执行过的次数（探针据此断言一次单击只触发一件事） */
  readonly hits: Record<string, number> = {};
  /** 最近一次单击被哪个消费点吃掉；未消费为 null */
  lastRoute: string | null = null;

  constructor(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      this.downX = e.clientX; this.downY = e.clientY;
      this.lastRoute = null;
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > PointerInputRouter.CLICK_SLOP) {
        this.lastRoute = null;
        return;
      }
      this.dispatch(e);
    });
  }

  register(name: string, handle: (ev: PointerEvent) => boolean, priority = 0): void {
    this.consumers.push({ name, priority, handle });
    this.consumers.sort((a, b) => b.priority - a.priority);
  }

  /** 兜底消费点：所有注册消费点都没吃掉这次单击时才执行 */
  setFallback(handle: (ev: PointerEvent) => boolean): void { this.fallback = handle; }

  resetStats(): void {
    for (const k of Object.keys(this.hits)) delete this.hits[k];
    this.lastRoute = null;
  }

  private dispatch(ev: PointerEvent): void {
    let consumed = false;
    this.lastRoute = null;
    for (const c of this.consumers) {
      if (consumed) break;                       // 已消费：后到的处理器看到标记直接跳过
      consumed = c.handle(ev) === true;
      if (consumed) {
        this.hits[c.name] = (this.hits[c.name] ?? 0) + 1;
        this.lastRoute = c.name;
      }
    }
    if (!consumed && this.fallback && this.fallback(ev)) {
      this.hits.pointerLock = (this.hits.pointerLock ?? 0) + 1;
      this.lastRoute = 'pointerLock';
    }
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  bloomPass!: UnrealBloomPass;
  bloomScale = 1;
  /** 最近 600 帧的帧间隔（ms），供打包版阻塞诊断读取 */
  readonly frameMs: number[] = [];
  /** 每帧的 JS 段（step 全量）与渲染段（composer.render）耗时，用于给丢帧归因 */
  readonly frameJsMs: number[] = [];
  readonly frameRenderMs: number[] = [];
  maxFrameMs = 0;
  /** 隔帧阴影的帧计数 */
  private static shadowTick = 0;
  /** 当前界域的可行走平面高度（人间 1.7 / 天宫 ~214 / 地府 ~-257）。由 world 每帧按玩家所在界域写入。
   *  旧版把 walk 模式的相机 y 写死 1.7、fly 模式下限也写死 1.7，导致在**地府**里一按方向键，
   *  相机被夹到 y=1.7 —— 玩家看到的就是「地府一动就跑回城里」（化身仍在 −257）。 */
  realmFloor = 1.7;
  ssaoPass: SSAOPass | null = null;
  gradePass!: ShaderPass;
  time = new TimeOfDay();
  tweener = new Tweener();
  quality: QualityTier;
  qualityAuto = true;

  camMode: CamMode = 'cinema';
  readonly lookTarget = new THREE.Vector3(0, 4, 0);
  yaw = Math.PI; pitch = -0.12;
  readonly spawnPoint = new THREE.Vector3(0, 30, 130);

  keys = new Set<string>();
  touchMove = { x: 0, y: 0 };        // 虚拟摇杆
  private dragOn = false; private px = 0; private py = 0;
  /** 指针锁定生效后的第一个 mousemove 丢弃（防浏览器回中产生的假位移） */
  private lockFresh = false;
  private pinchD = 0;
  private cinemaCurve: THREE.CatmullRomCurve3 | null = null;
  private cinemaLook: THREE.CatmullRomCurve3 | null = null;
  private cinemaT = 0; private cinemaDur = 46; private cinemaActive = false;
  private focusUntil = 0; private focusPos = new THREE.Vector3();
  private updatables: Updatable[] = [];
  private t = 0; private last = 0;
  private frameTimes: number[] = [];
  private goodStreak = 0;
  private prevQuality: QualityName = 'high';
  private canvas: HTMLCanvasElement;
  fps = 60; drawCalls = 0; tris = 0;
  isTouch = false;
  /** 分距离 LOD 四档管理器；`window.__lod` 暴露它的 view 给探针 */
  readonly lod: LodManager;
  /** 同一 canvas 的单击唯一入口：出拳 / 英雄聚焦 / 指针锁定都注册到这里 */
  readonly input: PointerInputRouter;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.info.autoReset = false;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // PBR 环境光照（让 Standard 材质有反射和高光层次）
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    pmrem.dispose();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.input = new PointerInputRouter(this.canvas);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 52000);
    this.camera.position.copy(this.spawnPoint);
    // 第 1 层 = 「只给主相机，不进水面反射」的小件（见 core/layers.ts）。主相机两层都开。
    this.camera.layers.enable(LAYER_NO_REFLECT);

    this.scene.fog = new THREE.FogExp2(0x3a3050, 0.0018);

    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const startTier: QualityName = this.isTouch ? (Math.min(window.innerWidth, window.innerHeight) < 760 ? 'low' : 'med') : 'high';
    this.quality = QUALITY[startTier];
    this.prevQuality = startTier;

    this.initComposer();
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());

    // 分距离 LOD：管理器先建，再把 sink 挂给 infill —— 之后 WardInfill 建好的每个空间单元都会自动注册进来
    this.lod = new LodManager(this.scene);
    setLodSink(this.lod);
    (window as unknown as Record<string, unknown>)['__lod'] = this.lod.view;
  }

  private initComposer(): void {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // SSAO 与 logarithmicDepthBuffer 深度不兼容：大世界远景会整片灰雾伪影（斜直边界灰幕）。
    // 接触阴影已由逐顶点底部 AO（bake.push）替代，此处不再挂 SSAO。
    this.ssaoPass = null;
    // 阈值 0.86 / 强度 0.62：只让灯彩霓虹起晕，普通受光地面不再糊成白幕
    // 阈值 0.92 → 0.80：地府/街灯的 glow 色（0x3dff9c/0xffb300 系）线性亮度约 0.75–0.9，原阈值把它们全挡在泛光之外，
// 灯只剩"实色亮面"；降低阈值让灯芯起晕，同时把强度从 0.42 收到 0.36 避免整片发灰。
    // 阈值 0.8 → 1.05：0.8 时任何白色衣料/玉白建筑的受光面都过线起晕，
    // 屏幕上就是一团团"白色闪光方块"。提到 1.05 只让真正的灯与霓虹起晕。
    this.bloomPass = new UnrealBloomPass(size, 0.36, 0.45, 1.05);
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
    this.applyQuality(this.quality, true);
  }

  applyQuality(q: QualityTier, silent = false): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.bloomPass.enabled = q.bloom;
    if (this.ssaoPass) this.ssaoPass.enabled = q.bloom;
    this.renderer.shadowMap.enabled = q.shadows;
    const sun = this.scene.getObjectByName('sun') as THREE.DirectionalLight | null;
    if (sun) {
      sun.castShadow = q.shadows;
      // three 的阴影 pass 判图层用的是**渲染相机**（主相机已开第 1 层，所以角色影子照旧）；
      // 这里给 shadow.camera 也开上，只是防上游改成拿阴影相机判图层时角色掉影子。
      sun.shadow.camera.layers.enable(LAYER_NO_REFLECT);
      if (q.shadows) {
        sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        sun.shadow.map?.dispose(); sun.shadow.map = null;
      }
    }
    this.onResize();
    if (!silent) bus.emit('quality:change', q.name);
  }

  /** 自适应降/升档（仅在 auto 模式） */
  /** 自适应画质的可观测状态（探针与 HUD 用；没有它就只能靠「看起来降了」判断） */
  frameSamples = 0;
  private slowProbe = typeof window !== 'undefined' && /[?&]slow=1/.test(window.location.search);
  lastAvgMs = 0;
  qualityChanges = 0;

  private autoQuality(dt: number): void {
    if (!this.qualityAuto) return;
    // 诊断开关：?slow=1 把观测帧时间放大 3 倍，用来验证「降档路径」本身可达
    // （无头软件渲染实测只有 19ms，真实阈值 30ms 永远触发不了，不能靠它验降档）
    const k = this.slowProbe ? 3 : 1;
    this.frameTimes.push(dt * k);
    this.frameSamples = this.frameTimes.length;
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.lastAvgMs = +(avg * 1000).toFixed(1);
    this.frameTimes.length = 0;
    this.frameSamples = 0;
    const order: QualityName[] = ['low', 'med', 'high'];
    const idx = order.indexOf(this.quality.name);
    if (avg > 0.030 && idx > 0) {
      this.qualityAuto = true;
      this.applyQuality(QUALITY[order[idx - 1]]);
      this.prevQuality = order[idx - 1];
      this.qualityChanges++;
      bus.emit('ui:toast', '检测到帧率压力，已自动切换画质：' + ({ high: '高', med: '中', low: '低' } as Record<string, string>)[this.quality.name]);
    } else if (avg < 0.015) {
      this.goodStreak++;
      if (this.goodStreak >= 4 && idx < order.indexOf(this.prevQuality)) {
        this.goodStreak = 0;
        this.applyQuality(QUALITY[order[idx + 1]]);
        this.prevQuality = order[idx + 1];
        this.qualityChanges++;
      }
    } else this.goodStreak = 0;
  }

  setCinemaPath(pos: THREE.CatmullRomCurve3, look: THREE.CatmullRomCurve3, dur = 46): void {
    this.cinemaCurve = pos; this.cinemaLook = look; this.cinemaDur = dur;
  }
  startCinema(): void {
    this.camMode = 'cinema'; this.cinemaActive = true; this.cinemaT = 0;
    bus.emit('cam:mode', 'cinema');
  }
  stopCinema(to: CamMode = 'fly'): void {
    this.cinemaActive = false;
    this.setCamMode(to);
  }

  setCamMode(m: CamMode): void {
    if (m === this.camMode) return;
    if (m === 'walk') {
      const p = this.camera.position;
      p.y = 1.7;
      this.spawnPoint.copy(p);
    }
    if (m === 'fly') {
      this.yaw = Math.atan2(-(this.lookTarget.x - this.camera.position.x), -(this.lookTarget.z - this.camera.position.z));
      this.pitch = Math.asin(THREE.MathUtils.clamp((this.lookTarget.y - this.camera.position.y) / Math.max(1, this.camera.position.distanceTo(this.lookTarget)), -1, 1));
    }
    this.camMode = m;
    bus.emit('cam:mode', m);
  }

  focusOn(pos: THREE.Vector3, radius = 14, hold = 7): void {
    this.camMode = 'focus'; bus.emit('cam:mode', 'focus');
    // 聚焦档必须在补间开始前就占住 focusUntil：旧值要等补间结束才写，
    // 而 updateCamera 每帧判 t > focusUntil，于是下一帧就退回 fly——「聚焦」实际从未生效。
    this.focusUntil = this.t + 1.4 + hold;
    const dir = new THREE.Vector3().subVectors(this.camera.position, pos).normalize();
    if (dir.lengthSq() < 0.01) dir.set(0, 0.3, 1).normalize();
    dir.y = Math.max(dir.y, 0.25); dir.normalize();
    const to = pos.clone().addScaledVector(dir, radius);
    to.y = pos.y + radius * 0.45;
    const fromP = this.camera.position.clone();
    const fromL = this.lookTarget.clone();
    this.tweener.to([fromP.x, fromP.y, fromP.z, fromL.x, fromL.y, fromL.z],
      [to.x, to.y, to.z, pos.x, pos.y, pos.z], 1.4, (v) => {
        this.camera.position.set(v[0], v[1], v[2]);
        this.lookTarget.set(v[3], v[4], v[5]);
      }, () => { this.focusUntil = this.t + hold; this.focusPos.copy(pos); }, easeInOut);
  }

  addUpdate(u: Updatable): void { this.updatables.push(u); }

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (this.camMode === 'cinema' && (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter')) this.stopCinema();
      // L：切换指针锁定（连续鼠标视角，不用按住左键）。Esc 由浏览器解除，pointerlockchange 里同步状态。
      if (e.code === 'KeyL' && !e.repeat
        && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) this.togglePointerLock();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // 左键 / 右键拖拽：**所有模式**都从这里进入（cinema/focus 一拖即接管，fly/walk 直接转，avatar 交玩家控制器）。
    // 指针锁定放在「单击」（按下后几乎没移动）而不是 pointerdown：拖动本身就不该锁指针，
    // 否则锁定生效瞬间会把相对位移算成一次大跳（旧探针实测单步 0.3168rad ≈ 18°）。
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0 && e.button !== 2) return;
      if (document.pointerLockElement === this.canvas) return;
      this.dragOn = true; this.px = e.clientX; this.py = e.clientY;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 老浏览器没有 pointer capture */ }
    });
    // 单击画面 = 进入鼠标锁定。单击判定与「谁先消费」统一交给 PointerInputRouter：
    // 出拳 / 英雄聚焦注册在 router 上，指针锁定只作最后兜底，避免一次单击触发三件事。
    this.input.setFallback(() => {
      if (document.pointerLockElement === this.canvas) return false;
      this.togglePointerLock();
      return true;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || !this.dragOn) return;
      // 指针锁定后由 mousemove(movementX/Y) 单一通道驱动，避免同一次移动被算两遍（灵敏度翻倍）
      if (document.pointerLockElement === this.canvas) return;
      this.dragLook(e.clientX - this.px, e.clientY - this.py);
      this.px = e.clientX; this.py = e.clientY;
    });
    const endDrag = (): void => { this.dragOn = false; };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);
    // 指针锁定下的连续视角：movementX/Y 是相对位移，直接进同一条 dragLook 通道。
    // 锁定生效后的第一个事件丢弃：浏览器可能在锁定时把光标回中，首个 movement 是一次假位移。
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (this.lockFresh) { this.lockFresh = false; return; }
      this.dragLook(e.movementX || 0, e.movementY || 0);
    });
    document.addEventListener('pointerlockchange', () => {
      const on = document.pointerLockElement === this.canvas;
      this.lockFresh = on;
      bus.emit('ui:toast', on ? '鼠标已锁定：移动鼠标转视角（L / Esc 解除）' : '鼠标已解锁');
    });
    this.canvas.addEventListener('wheel', (e) => {
      if (this.camMode !== 'fly' && this.camMode !== 'walk') return;
      const d = Math.sign(e.deltaY) * 2;
      const dir = new THREE.Vector3().subVectors(this.lookTarget, this.camera.position).normalize();
      this.camera.position.addScaledVector(dir, d);
      this.lookTarget.addScaledVector(dir, d);
    }, { passive: true });
    // 触控双指缩放（fov）
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d = Math.hypot(dx, dy);
        if (this.pinchD > 0) {
          this.camera.fov = THREE.MathUtils.clamp(this.camera.fov - (d - this.pinchD) * 0.08, 32, 75);
          this.camera.updateProjectionMatrix();
        }
        this.pinchD = d;
      }
    }, { passive: true });
    this.canvas.addEventListener('touchend', () => { this.pinchD = 0; });
  }

  /** L 键：进入/退出指针锁定（连续鼠标视角）。浏览器只允许用户手势触发，所以放在 keydown 里。 */
  togglePointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
      return;
    }
    const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => bus.emit('ui:toast', '浏览器拒绝了鼠标锁定（需要用户手势）'));
  }

  /**
   * 统一视角入口：任何相机模式都必须走这里。
   *  - 附身（avatarCtl 非空）：yaw/pitch 交给 PlayerController.camYaw/camPitch；
   *  - 运镜/聚焦：自动机位一被拖动就交还控制权（旧版在这里直接 return，所以这两种模式鼠标完全不动）；
   *  - 飞行/漫游：直接改引擎 yaw/pitch。
   * 俯仰统一钳在 ±85°，不再出现「附身 -69°…52°、飞行 -72°…77°」两套上限。
   */
  dragLook(dx: number, dy: number): void {
    if (this.avatarCtl && this.onAvatarDrag) { this.onAvatarDrag(dx, dy); return; }
    if (this.camMode === 'cinema' || this.camMode === 'focus') {
      this.focusUntil = 0;
      this.tweener.clear();          // 聚焦补间还在跑：不清掉会继续覆盖相机位姿
      this.stopCinema('fly');
    }
    this.yaw -= dx * 0.0032;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0028, -PITCH_LIMIT, PITCH_LIMIT);
  }

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      // 首帧 rAF 时间戳是 vsync 时刻，可能早于 start() 里的 performance.now()：
      // dt 钳非负，否则负 dt 沿 cinemaT 传播成负 u（CatmullRom 负索引崩溃）
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      // 帧间隔环形缓冲（诊断）：打包版无法注入 evaluateOnNewDocument，只能由应用自证
      this.frameMs.push(dt * 1000);
      if (this.frameMs.length > 600) this.frameMs.shift();
      if (this.frameMs.length > 600) this.frameMs.shift();
      if (dt * 1000 > this.maxFrameMs) this.maxFrameMs = dt * 1000;
      this.last = now; this.t += dt;
      const _js0 = performance.now();
      this.step(dt);
      this.frameJsMs.push(performance.now() - _js0);
      if (this.frameJsMs.length > 600) this.frameJsMs.shift();
    };
    requestAnimationFrame(loop);
  }

  /** 单帧推进（后台标签页自动化测试用） */
  renderOnce(dt = 1 / 30): void {
    this.t += dt;
    this.step(dt);
  }

  private step(dt: number): void {
    this.time.update(dt);
    this.tweener.update(dt);
    this.updateCamera(dt);
    for (const u of this.updatables) u.update(this.t, dt);
    // 相机在本帧已定型（updateCamera + 附身控制器 + 世界更新都跑完）才判档：
    // 用上一帧的机位判档会在快速推拉时慢一帧，近处那一档就赶不上加载
    this.lod.update(this.camera.position);
    this.gradePass.uniforms.uTime.value = this.t;
    this.bloomPass.strength = this.time.bloom * this.bloomScale * (this.quality.bloom ? 1 : 0);
    this.renderer.info.reset();
    // 阴影预算：46M 静态三角面每帧重绘一遍 shadow map 是 p95 的第一大项。
    // 世界是静态的（太阳随相机走但方向固定），因此把阴影更新降到隔帧，
    // 高光/阴影的可见差异在 60fps 下读不出来，成本直接减半。
    this.renderer.shadowMap.autoUpdate = false;
    if ((Engine.shadowTick++ & 1) === 0) this.renderer.shadowMap.needsUpdate = true;
    const _t0 = performance.now();
    this.composer.render();
    this.frameRenderMs.push(performance.now() - _t0);
    if (this.frameRenderMs.length > 600) this.frameRenderMs.shift();
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    this.drawCalls = this.renderer.info.render.calls;
    this.tris = this.renderer.info.render.triangles;
    this.autoQuality(dt);
  }

  /** 附身模式下相机由 PlayerController 全权接管 */
  avatarCtl: ((dt: number) => void) | null = null;
  onAvatarDrag: ((dx: number, dy: number) => void) | null = null;

  /** 自动机位（运镜/聚焦）每帧把 yaw/pitch 同步到实际视线方向。
   *  否则自动模式下这两个字段停在旧值，鼠标一接管会先按旧值起跳——
   *  实测聚焦切入后的第一拖 yaw 跳 0.41rad（视觉上不跳，但连续拖动序列断成两段）。 */
  private syncAnglesFromView(): void {
    const dx = this.lookTarget.x - this.camera.position.x;
    const dy = this.lookTarget.y - this.camera.position.y;
    const dz = this.lookTarget.z - this.camera.position.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  private updateCamera(dt: number): void {
    if (this.avatarCtl) { this.avatarCtl(dt); return; }
    const k = this.keys;
    const mv = CAM_TMP1;
    const fwd = CAM_TMP2;
    const right = CAM_TMP3;
    const dir = CAM_TMP4;
    if (this.camMode === 'cinema' && this.cinemaActive && this.cinemaCurve && this.cinemaLook) {
      this.cinemaT += dt / this.cinemaDur;
      // % 1 保留负号：cinemaT 极小负值时 u 必须钳 0（防 getPoint 负索引）
      const u = Math.max(0, this.cinemaT % 1);
      this.camera.position.copy(this.cinemaCurve.getPoint(u));
      this.lookTarget.copy(this.cinemaLook.getPoint((u + 0.015) % 1));
      this.syncAnglesFromView();
    } else if (this.camMode === 'focus') {
      if (this.t > this.focusUntil) this.setCamMode('fly');
      else {
        this.lookTarget.lerp(this.focusPos, Math.min(1, dt * 3));
        this.syncAnglesFromView();
      }
    } else {
      mv.set(0, 0, 0);
      fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      // 右向量 = fwd × up：fwd=(-sin,0,-cos) 时右应为 (cos,0,-sin)。
      // 旧写法 (fwd.z,0,-fwd.x) = (-cos,0,sin) 正好是左 —— A/D 全程反向。
      right.set(-fwd.z, 0, fwd.x);
      let sp = this.camMode === 'walk' ? 5.2 : 34;
      if (k.has('ShiftLeft') || k.has('ShiftRight')) sp *= 3.2;
      if (k.has('KeyW') || this.touchMove.y < -0.1) mv.addScaledVector(fwd, (k.has('KeyW') ? 1 : -this.touchMove.y));
      if (k.has('KeyS') || this.touchMove.y > 0.1) mv.addScaledVector(fwd, -(k.has('KeyS') ? 1 : this.touchMove.y));
      if (k.has('KeyA') || this.touchMove.x < -0.1) mv.addScaledVector(right, -(k.has('KeyA') ? 1 : -this.touchMove.x));
      if (k.has('KeyD') || this.touchMove.x > 0.1) mv.addScaledVector(right, (k.has('KeyD') ? 1 : this.touchMove.x));
      if (this.camMode === 'fly') {
        // 升：Space / E；降：C / Ctrl / Q。E 在附身模式下是交互键，但那条路径由 avatarCtl 接管，
        // 走不到这里；飞行时 E 空闲，和「漫游指南」里写的 Q/E 对上。
        if (k.has('Space') || k.has('KeyE')) mv.y += 1;
        if (k.has('ControlLeft') || k.has('KeyC') || k.has('KeyQ')) mv.y -= 1;
      }
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(sp * dt);
        this.camera.position.add(mv);
        if (this.camMode === 'walk') this.camera.position.y = this.realmFloor;
        // 旧版把漫游锁在 ±700 × ±420、高度 ≤520：世界是 10km 见方（城墙 ±5000、宫城 z=−4040、
        // 天宫外环 r≈900），结果只能在河岸那一小块里转。改成整个世界 + 天宫以上的高度。
        const WB = 20000;
        this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -WB, WB);
        this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -WB, WB);
        if (this.camMode === 'fly') this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, Math.min(this.realmFloor, -320), 4000);
      }
      const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
      dir.set(-Math.sin(this.yaw) * cy, sy, -Math.cos(this.yaw) * cy);
      this.lookTarget.copy(this.camera.position).addScaledVector(dir, 30);
    }
    this.camera.lookAt(this.lookTarget);
  }
}
