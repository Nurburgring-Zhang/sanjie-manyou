import * as THREE from 'three';

// ============ 角色数据模型（供 behaviors / crowd / sky 共用） ============
export interface AttachFn { (out: { pos: THREE.Vector3; yaw: number; y: number }): void }

export interface ActorData {
  name: string; nick: string; group: 'shuihu' | 'deity' | 'buddha' | 'job' | 'guest';
  weapon?: string; desc?: string; code?: string;
}

export interface Actor {
  id: number;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  action: string;
  actT: number;
  timer: number;
  occ: string;
  seed: number;
  scale: number;
  hat: number;                    // 0无 1幞头 2斗笠 3发髻
  cloth: THREE.Color; pants: THREE.Color; skin: THREE.Color;
  propPool: string | null;
  slots: Record<string, number>;  // 各池起始槽位
  hatPool: string;
  halo: boolean;
  sky: boolean;
  hidden: boolean;
  freeze: boolean;                // 由编导/载具直接控制
  attach: AttachFn | null;
  data: ActorData | null;
  doing: string;
  // FSM
  path: THREE.Vector3[];
  pathI: number;
  pendingAct: string;             // 到站后执行的动作
  pendingSpot: boolean;
  curDoing: string;
  lastTick: number;               // LOD 行为更新节流
  lastWrite: number;              // LOD 矩阵写入节流
  acc: number;                    // 远距节流期间累积的 dt
  actionT: number;                // 当前动作已持续时间（受击时间线用）
  lastAction: string;             // 动作变更检测
  impactUntil: number;            // 受击硬直（ms 时间戳）
  yOff: number;                   // 站台/桥面/房顶等附加高度
  yawVel: number;
}
