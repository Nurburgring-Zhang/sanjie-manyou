// ============================================================================
// 条件节点（P1-4 · H6/G1 口径）· src/game/conditions.ts
//
// 资源轴驱动的 6 个条件触发器：读 interact/survival 状态，返回当前最高优先的
// 「该去做什么」提示（进目标链 HUD 的「条件节点」行）。
// 纯逻辑（evaluate 走快照入参，可 Node 单测）；HUD 显示由 ui.ts 轮询驱动。
// ============================================================================

export interface EconState {
  coins: number;
  yinde: number;
  peach: number;
  hunger: number;
  bossesDown: number;
  hasCreation: boolean;
}

export interface ConditionNode {
  key: string;
  text: string;
  /** 目标 POI key（poiGuide 导引联动） */
  target: string;
  /** 优先级：小者先显示 */
  pri: number;
}

/**
 * 评估 6 个条件节点（H6 修订/G1 验收口径），返回按优先级排序的触发列表。
 * 阈值依据 spike-H6 劳动锚定：扛包 20 文/8.2s；五子棋入场 50；冥途牒需阴德 10；造物 100 文。
 */
export function evalConditions(s: EconState): ConditionNode[] {
  const out: ConditionNode[] = [];
  // ① 饥饿告急：低于 30 → 小吃摊（生存优先级最高）
  if (s.hunger < 30) {
    out.push({ key: 'c-hunger', text: '饥饿告急——去小吃摊买点吃的（回 30 饥饿）', target: 'bridge', pri: 0 });
  }
  // ② 铜钱告急：低于 50（连五子棋入场都付不起）→ 码头扛包
  if (s.coins < 50) {
    out.push({ key: 'c-coins', text: '囊中羞涩——去码头扛包赚 20 文', target: 'dock', pri: 1 });
  }
  // ③ 阴德攒够：≥10 → 王家纸马烧冥途牒（阴德轴 sink）
  if (s.yinde >= 10) {
    out.push({ key: 'c-yinde', text: '阴德 ≥10——去王家纸马焚冥途牒，换蟠桃 +1', target: 'bridge', pri: 2 });
  }
  // ④ Boss 伏誅：≥1 → 伏魔锏已在身（成长提示，一次性）
  if (s.bossesDown >= 1 && !s.hasCreation) {
    out.push({ key: 'c-boss', text: '巨灵神已伏誅——试试用伏魔锏挑战更深的狱层', target: 'shibayu', pri: 3 });
  }
  // ⑤ 铜钱充裕：≥100 → Y 造物（造物用途兑付）
  if (s.coins >= 100 && !s.hasCreation) {
    out.push({ key: 'c-creation', text: '铜钱 ≥100——按 Y 许愿，造一条龙落在身边', target: 'bridge', pri: 4 });
  }
  // ⑥ 蟠桃满仓：≥9 → 蟠桃赏赐兑铜钱（防溢出丢失）
  if (s.peach >= 9) {
    out.push({ key: 'c-peach', text: '蟠桃点已满——去瑶池蟠桃赏赐兑铜钱（每枚 100 文）', target: 'jiangtai', pri: 5 });
  }
  out.sort((a, b) => a.pri - b.pri);
  return out;
}

/** 取最高优先的一条（HUD 用）；无触发返回 null */
export function topCondition(s: EconState): ConditionNode | null {
  const all = evalConditions(s);
  return all.length ? all[0] : null;
}
