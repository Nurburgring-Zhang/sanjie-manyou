/**
 * 关卡四件套（目标 / 威胁 / 恢复点）——每个 POI 的可执行字段。
 * 依据 `SPEC-游戏工程规范.md` §9：任一 POI 都要能回答「这里要干什么」「被什么阻止」「失败从哪继续」。
 * 规则：`recover` 必须是真实存在的 POI key（`world.respawnPlayerAt` 会校验）；
 *       `objective` 一句话、动词开头、可在世界里验证；`threat` 必须对应当前世界里的真实机制。
 */

/** 机读威胁类型：必须对应世界里真实存在的机制，没接线的节点不要写 threatSpec */
export type ThreatKind = 'slow' | 'disorient' | 'push' | 'hazard';

/** 机读威胁参数：`threat` 是文案，这里才是探针能断言的数值 */
export interface ThreatSpec {
  kind: ThreatKind;
  /** 触发半径（m） */
  radius: number;
  /** 速度系数（slow/disorient 用，乘法，0–1） */
  speedScale?: number;
  /** 状态强度 0–1（disorient 用，1 = 满强度） */
  strength?: number;
  /** 效果持续（s）；缺省 = 离开半径即恢复 */
  duration?: number;
}

export interface LevelNode {
  /** 到这里要做什么（动词开头，一句话） */
  objective: string;
  /** 被什么阻止（对应世界里真实存在的机制） */
  threat: string;
  /** 机读威胁参数（可选）：缺省表示该节点只有文案、尚未接线，探针不应断言 */
  threatSpec?: ThreatSpec;
  /** 失败后复活的 POI key（必须是有效 POI） */
  recover: string;
}

export const LEVEL_PLAN: Record<string, LevelNode> = {
  // ---- 人间 ----
  yinyanggate: { objective: '穿过阴阳界，进入地府', threat: '界门两侧的阴风会推偏走向', recover: 'bridge' },
  zichen: { objective: '登上紫宸殿丹陛，看清皇城中轴', threat: '禁军戍卫盘查，越界会被驱离', recover: 'bridge' },
  scroll: { objective: '沿上河长卷横移，看完十二段市井', threat: '长卷会自动横移，错过段落要重看', recover: 'bridge' },
  desert: { objective: '在西陲大漠找到孤城残址', threat: '风沙遮蔽视线，方向易失', recover: 'scroll' },
  grassland: { objective: '在北国草原寻到牧马聚落', threat: '草原无地标，走偏会绕圈', recover: 'scroll' },
  greatlake: { objective: '在东洋巨泽岸边看潮', threat: '潮线会没到膝，走太深会被冲回岸', recover: 'scroll' },
  // ---- 天宫 ----
  lingxiao: { objective: '登上凌霄宝殿，瞻仰重檐金顶', threat: '云海无底，坠落会返回将台', recover: 'jiangtai' },
  yaochi: { objective: '在瑶池水榭取一枚蟠桃', threat: '守池仙官会驱赶无帖之人', recover: 'jiangtai' },
  jiangtai: { objective: '在将台击败巨灵神，收录图鉴', threat: '巨灵神横扫与擒拿（按 J 出手，看预警环撤退）', recover: 'jiangtai' },
  star9: { objective: '走访星宿九府，核对星图', threat: '浮岛之间云桥窄，需沿栏而行', recover: 'jiangtai' },
  // ---- 地府 ----
  yanluo: { objective: '入阎罗殿，听判一桩旧案', threat: '殿内判官索要阳寿，答错会被扣一魂', recover: 'naihe' },
  naihe: { objective: '过奈何桥，别回头看', threat: '回头即坠桥，重回桥头', recover: 'naihe' },
  fengdu: { objective: '在丰都鬼市集齐三件纸扎', threat: '鬼市摊主会换货，认错要重来', recover: 'naihe' },
  shibayu: { objective: '绕十八狱环一周，记下刑名', threat: '狱火灼伤，靠太近会被弹开', recover: 'naihe' },
  mengpo: {
    objective: '在孟婆庄饮一碗忘川茶',
    threat: '饮后短暂失向（视野变灰）',
    // 第二条可执行威胁：12m 内失向满强度，速度系数最低 0.6，最多持续 6s
    threatSpec: { kind: 'disorient', radius: 12, speedScale: 0.6, strength: 1, duration: 6 },
    recover: 'naihe',
  },
  sansheng: { objective: '在三生石上读自己的前世', threat: '石面映像会误导，需对照图鉴', recover: 'naihe' },
  wangxiang: {
    objective: '登望乡台，回望人间一次',
    threat: '停留过久会被乡愁拖住（移动变慢）',
    // 与 world.ts 现有接线一致：30m 内 speedScale 0.55
    threatSpec: { kind: 'slow', radius: 30, speedScale: 0.55 },
    recover: 'naihe',
  },
};

/** GUIDE_KEYS 里存在但世界不一定建了 POI 的键，取统一兜底，避免 HUD 空档 */
export const LEVEL_FALLBACK: LevelNode = { objective: '此处可游历、可观景', threat: '—', recover: 'bridge' };

export function levelOf(key: string): LevelNode {
  return LEVEL_PLAN[key] ?? LEVEL_FALLBACK;
}

/**
 * 目标链顺序：人间 → 天宫 → 地府。
 * 显式列出，不依赖 `LEVEL_PLAN` 的对象键序——键序只是书写顺序，重构时会被无意打乱，
 * 而 HUD 的「下一个」与 `objectiveProgress().done/total` 需要一个稳定口径。
 */
export const LEVEL_ORDER: string[] = [
  // 人间
  'yinyanggate', 'zichen', 'scroll', 'desert', 'grassland', 'greatlake',
  // 天宫
  'lingxiao', 'yaochi', 'jiangtai', 'star9',
  // 地府
  'yanluo', 'naihe', 'fengdu', 'shibayu', 'mengpo', 'sansheng', 'wangxiang',
];

/** 目标链总节点数（HUD 分母与探针 total 的唯一来源） */
export const LEVEL_TOTAL = LEVEL_ORDER.length;

/** 目标链里第一个未完成节点的下标；全完成返回 -1 */
export function firstOpenIndex(done: Record<string, boolean | undefined>): number {
  for (let i = 0; i < LEVEL_ORDER.length; i++) if (!done[LEVEL_ORDER[i]]) return i;
  return -1;
}

/** 已完成的目标链节点数：只统计 LEVEL_ORDER 内的键（桥/府衙等导引点不算关卡进度） */
export function countLevelDone(done: Record<string, boolean | undefined>): number {
  let n = 0;
  for (const k of LEVEL_ORDER) if (done[k]) n++;
  return n;
}
