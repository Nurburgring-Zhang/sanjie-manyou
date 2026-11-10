/**
 * Boss 数值表（唯一真相源）。
 * 纪律：状态机的所有可调量都在这里，第二个 Boss 复用同一状态机、只换这张表。
 * 依据 `artifacts/游戏设计三件套.md` §三（首个遭遇计划）。
 */
export interface BossSpec {
  code: string;
  name: string;
  /** 总血量 */
  maxHp: number;
  /** 玩家一次命中对 Boss 的伤害（阶段 1/阶段 2）。
   *  旧字段语义反转（位于玩家攻击方法内，实为玩家→Boss），FIX-010 R1 更名钉死。 */
  playerDamageToBoss: [number, number];
  /** Boss→玩家伤害（阶段 1 / 阶段 2）——FIX-010 R1 新增，闭合单向输出 */
  bossDamageToPlayer: [number, number];
  /** Boss 攻击判定距离（米）——FIX-010 R1 新增 */
  attackReach: number;
  /** Boss 两次攻击间隔（毫秒）——FIX-010 R1 新增 */
  attackCooldown: number;
  /** 阶段 2 触发阈值（血量比例） */
  phase2At: number;
  /** 玩家近身判定距离（m） */
  meleeRange: number;
  /** 玩家出手后的冷却（s），防止连点刷伤害 */
  hitCooldown: number;
  /** 横扫：前摇 / 判定 / 射程 / 扇形角度 / 击退 */
  sweep: { telegraph: number; active: number; range: number; arc: number };
  /** 抓取（仅阶段 2）：前摇 / 判定 / 射程 */
  grab: { telegraph: number; active: number; range: number };
  /** 两次攻击之间的间隔（阶段 1 / 阶段 2） */
  interval: [number, number];
  /** 与玩家进入战斗的距离 */
  engageRange: number;
  /** 失败后复位到的 POI */
  recoverPoi: string;
  /** 复位等待（s） */
  respawnDelay: number;
  /** HUD 上写的阶段名 */
  phaseName: [string, string];
}

export const JULING: BossSpec = {
  code: 'juling',
  name: '巨灵神',  // 与 DEITIES 表同名，才能拿到已有化身（省一个角色池名额）
  maxHp: 320,
  playerDamageToBoss: [12, 12],
  bossDamageToPlayer: [12, 20],
  attackReach: 3.2,
  attackCooldown: 1800,
  phase2At: 0.5,
  meleeRange: 12,
  hitCooldown: 0.28,
  sweep: { telegraph: 0.9, active: 0.35, range: 26, arc: 140 },
  grab: { telegraph: 1.2, active: 0.4, range: 13 },
  interval: [3.2, 2.4],
  engageRange: 34,
  recoverPoi: 'jiangtai',   // 天宫·将台（POIS 里真实存在；南天门只是机位偏移 key）
  respawnDelay: 3,
  phaseName: ['力撼山岳', '怒极·擒拿'],
};
