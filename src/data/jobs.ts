import * as THREE from 'three';

// ============ 市井职业定义：服饰 / 道具 / 行为权重 ============
export interface BehaviorEntry { act: string; move?: boolean; spot?: string; dur: [number, number]; weight: number; doing: string }
export interface JobDef {
  key: string; label: string;
  cloth: number[]; pants: number[];
  hats: [number, number, number, number];  // 无/幞头/斗笠/发髻 权重
  props: string[];
  speed: [number, number];
  scale?: [number, number];
  behaviors: BehaviorEntry[];
  nightOnly?: boolean;
  count: number;                            // 基础数量（×密度系数）
}

const B = (act: string, weight: number, doing: string, move = false, spot?: string, dur: [number, number] = [5, 12]): BehaviorEntry =>
  ({ act, weight, doing, move, spot, dur });

export const JOBS: JobDef[] = [
  {
    key: 'peddler', label: '货郎', cloth: [0x7a6a4a, 0x5a6e6a, 0x6a5a7a], pants: [0x4a4038, 0x3a4248],
    hats: [1, 4, 2, 1], props: ['carryPole'], speed: [0.9, 1.3], count: 26,
    behaviors: [
      B('walk', 30, '挑担赶路', true), B('carryPole', 26, '挑担叫卖', true),
      B('hawk', 18, '吆喝叫卖', false, 'stall', [6, 14]), B('browse', 10, '看货议价', false, 'stall', [5, 10]),
      B('drink', 6, '喝茶歇脚', false, 'tea', [6, 12]), B('stand', 10, '歇担张望'),
    ],
  },
  {
    key: 'vendor', label: '摊贩', cloth: [0x8a6a3a, 0x6a5a4a, 0x4a6a5a], pants: [0x4a4038],
    hats: [2, 3, 1, 2], props: ['fan', 'jar', 'scroll'], speed: [0.8, 1.1], count: 40,
    behaviors: [
      B('hawk', 45, '摆摊吆喝', false, 'stall', [10, 24]), B('cook', 16, '烹制吃食', false, 'stall', [8, 18]),
      B('chat', 18, '与街坊闲话', false, 'stall', [6, 14]), B('bowTrade', 14, '招揽生意', false, 'stall', [5, 10]),
      B('walk', 7, '补货去', true),
    ],
  },
  {
    key: 'customer', label: '市民', cloth: [0x5a7a8a, 0x7a5a5a, 0x5a6a4a, 0x6a6a7a, 0x8a7a5a], pants: [0x3e4650, 0x4a4038],
    hats: [2, 4, 2, 3], props: ['fan', 'basket'], speed: [0.85, 1.25], count: 150,
    behaviors: [
      B('walk', 34, '逛街而行', true), B('browse', 20, '驻足看货', false, 'stall', [5, 12]),
      B('bowTrade', 14, '讨价还价', false, 'stall', [5, 10]), B('drink', 9, '茶坊吃茶', false, 'tea', [8, 16]),
      B('eat', 8, '小吃点心', false, 'food', [6, 12]), B('chat', 9, '街谈巷议', false, 'social', [6, 14]),
      B('lookAround', 6, '东张西望'),
    ],
  },
  {
    key: 'porter', label: '脚夫', cloth: [0x6a5238, 0x55483a], pants: [0x3a352c],
    hats: [1, 3, 4, 1], props: ['carryPole'], speed: [0.9, 1.4], count: 34,
    behaviors: [
      B('carryPole', 36, '挑运货物', true), B('walk', 22, '寻活计', true),
      B('squatRel', 8, '卸担歇力', false, undefined, [5, 9]), B('drink', 8, '讨碗茶喝', false, 'tea', [5, 10]),
      B('browse', 8, '看码头行情', false, 'dock', [4, 9]), B('stand', 18, '揽活等活'),
    ],
  },
  {
    key: 'tracker', label: '纤夫', cloth: [0x6b5540, 0x584838], pants: [0x35302a],
    hats: [2, 4, 2, 0], props: [], speed: [0.7, 1.0], count: 16,
    behaviors: [
      B('pullRope', 55, '弯腰拉纤', false, 'tow', [12, 26]), B('walk', 20, '溯岸寻船', true),
      B('squatRel', 12, '拉纤间隙歇脚', false, undefined, [5, 9]), B('drink', 13, '灌口浊酒', false, 'tow', [4, 8]),
    ],
  },
  {
    key: 'scholar', label: '书生', cloth: [0x4a5a7a, 0x5a5a7a, 0x3e5a5e], pants: [0x3a4250],
    hats: [2, 6, 0, 3], props: ['fan', 'plank'], speed: [0.8, 1.05], count: 16,
    behaviors: [
      B('walk', 30, '负笈游街', true), B('write', 16, '代人写信', false, 'letter', [10, 20]),
      B('browse', 16, '逛书摊', false, 'stall', [6, 12]), B('chat', 14, '谈诗论画', false, 'social', [7, 15]),
      B('fanSway', 12, '摇扇踱步'), B('drink', 12, '茶肆听评话', false, 'story', [10, 22]),
    ],
  },
  {
    key: 'monk', label: '僧人', cloth: [0x8a7a3a, 0x6a5a2e, 0x9a8a4a], pants: [0x8a7a3a],
    hats: [6, 0, 0, 5], props: ['staff'], speed: [0.6, 0.9], count: 10,
    behaviors: [
      B('walk', 30, '托钵化缘', true), B('monkBow', 22, '稽首问讯', false, 'shrine', [6, 12]),
      B('pray', 14, '佛前跪拜', false, 'shrine', [8, 14]), B('incense', 8, '上香祈福', false, 'shrine', [6, 10]),
      B('stand', 16, '立于山门'), B('chat', 12, '与施主寒暄', false, 'shrine', [6, 12]),
      B('lookAround', 12, '观市井百态'),
    ],
  },
  {
    key: 'taoist', label: '道士', cloth: [0x3e5e5e, 0x2e4e5e], pants: [0x2e3e42],
    hats: [0, 2, 0, 6], props: ['fan', 'staff'], speed: [0.7, 1.0], count: 8,
    behaviors: [
      B('walk', 30, '云游赶路', true), B('taoSleeve', 24, '拂尘掸袖', false, 'shrine', [7, 14]),
      B('write', 14, '测字画符', false, 'fortune', [9, 18]), B('chat', 16, '与人看相', false, 'fortune', [7, 14]),
      B('stand', 16, '凝望汴河'),
    ],
  },
  {
    key: 'merchant', label: '商贾', cloth: [0x7a5a2e, 0x8a6a3a, 0x5e4a2e], pants: [0x4a3e2e],
    hats: [2, 6, 0, 2], props: ['fan', 'basket'], speed: [0.85, 1.1], count: 20,
    behaviors: [
      B('walk', 28, '巡铺看市', true), B('bowTrade', 22, '谈生意', false, 'stall', [7, 15]),
      B('chat', 18, '同业叙话', false, 'social', [6, 14]), B('drink', 16, '酒楼应酬', false, 'wine', [9, 18]),
      B('dice', 8, '赌坊小试手气', false, 'dice', [8, 16]), B('browse', 8, '看货', false, 'stall', [4, 9]),
    ],
  },
  {
    key: 'soldier', label: '守卒', cloth: [0x4a4a5a, 0x3e4a5a], pants: [0x353a44],
    hats: [2, 6, 0, 0], props: ['spear'], speed: [0.7, 0.95], count: 18,
    behaviors: [
      B('walk', 26, '巡城列岗', true), B('stand', 30, '执戟守门'),
      B('lookAround', 18, '盘查行人'), B('spearThrust', 12, '操练枪法', false, undefined, [6, 12]),
      B('chat', 14, '与同伍闲谈', false, 'social', [5, 11]),
    ],
  },
  {
    key: 'official', label: '官员', cloth: [0x3a3e5e, 0x4a3e5e], pants: [0x2e3244],
    hats: [2, 8, 0, 0], props: [], speed: [0.7, 0.9], count: 8,
    behaviors: [
      B('walk', 30, '鸣锣出行', true), B('stand', 22, '驻轿视事'),
      B('bowTrade', 12, '接见属吏', false, 'social', [5, 10]), B('chat', 18, '与同僚议事', false, 'social', [6, 12]),
      B('lookAround', 18, '巡视街面'),
    ],
  },
  {
    key: 'lady', label: '内眷', cloth: [0x9a5a6a, 0x8a6a8a, 0xa87a5a, 0x7a6a9a], pants: [0x6a4a5a],
    hats: [0, 1, 0, 8], props: ['fan'], speed: [0.6, 0.85], count: 24,
    behaviors: [
      B('walk', 30, '乘轿游街', true), B('browse', 20, '挑拣绸缎', false, 'stall', [6, 14]),
      B('fanSway', 16, '罗扇半遮面'), B('drink', 12, '茶社听曲', false, 'tea', [9, 18]),
      B('chat', 14, '女眷闲话', false, 'social', [7, 14]), B('lookAround', 8, '看杂耍', false, 'story', [5, 10]),
    ],
  },
  {
    key: 'kid', label: '小儿', cloth: [0xa85a3a, 0x5a8a5a, 0x6a7aa8], pants: [0x5a4a3a],
    hats: [4, 1, 0, 4], props: [], speed: [1.2, 1.7], scale: [0.68, 0.78], count: 22,
    behaviors: [
      B('kiteRun', 26, '放纸鸢', true), B('run', 28, '追逐嬉闹', true),
      B('lookAround', 16, '围观百戏', false, 'story', [6, 14]), B('chat', 12, '叽叽喳喳', false, 'social', [5, 10]),
      B('walk', 18, '街头乱跑', true),
    ],
  },
  {
    key: 'beggar', label: '乞者', cloth: [0x5a4e3e, 0x4a4438], pants: [0x3a352c],
    hats: [2, 2, 3, 3], props: ['basket'], speed: [0.5, 0.8], count: 8,
    behaviors: [
      B('kneel', 34, '跪地行乞', false, 'shrine', [10, 22]), B('walk', 26, '沿街乞讨', true),
      B('squatRel', 18, '墙根晒暖', false, undefined, [8, 16]), B('stand', 22, '倚墙呆望'),
    ],
  },
  {
    key: 'gambler', label: '赌客', cloth: [0x6a4a4a, 0x4a5a4a, 0x5a4a6a], pants: [0x3e3a34],
    hats: [2, 4, 1, 3], props: [], speed: [0.9, 1.3], count: 16,
    behaviors: [
      B('dice', 40, '呼幺喝六', false, 'dice', [10, 22]), B('walk', 20, '寻赌坊', true),
      B('argue', 16, '输急口角', false, 'dice', [5, 10]), B('drink', 14, '借酒翻本', false, 'wine', [7, 14]),
      B('lookAround', 10, '寻下家'),
    ],
  },
  {
    key: 'brawler', label: '泼皮', cloth: [0x5a3a3a, 0x3e4a3e], pants: [0x35302c],
    hats: [2, 3, 1, 4], props: ['staff', 'blade'], speed: [1.0, 1.4], count: 12,
    behaviors: [
      B('brawl', 34, '挥拳斗殴', false, 'fight', [6, 13]), B('sumo', 20, '摔跤相扑', false, 'fight', [7, 14]),
      B('walk', 22, '横行过市', true), B('argue', 14, '寻衅叫骂', false, 'fight', [4, 9]),
      B('drink', 10, '醉卧街头', false, 'wine', [7, 12]),
    ],
  },
  {
    key: 'watchman', label: '更夫', cloth: [0x4a4438, 0x3e3a34], pants: [0x35302c],
    hats: [2, 6, 0, 1], props: ['hammer'], speed: [0.7, 0.9], count: 6, nightOnly: true,
    behaviors: [
      B('walk', 44, '提灯打更', true), B('bellTower', 22, '敲更报时', false, undefined, [4, 8]),
      B('lookAround', 18, '查夜巡更'), B('stand', 16, '檐下避风'),
    ],
  },
  {
    key: 'farmer', label: '农人', cloth: [0x5e6a3e, 0x6a5e3e], pants: [0x3e3a2c],
    hats: [1, 1, 7, 1], props: ['carryPole', 'basket'], speed: [0.8, 1.1], count: 18,
    behaviors: [
      B('walk', 30, '挑菜进城', true), B('carryPole', 24, '担柴负米', true),
      B('squatRel', 14, '田头歇晌', false, undefined, [6, 12]), B('browse', 12, '卖菜讲价', false, 'stall', [5, 11]),
      B('drink', 10, '吃碗冷酒', false, 'tea', [5, 10]), B('stand', 10, '看虹桥热闹'),
    ],
  },
  {
    key: 'fisher', label: '渔翁', cloth: [0x4a5a4a, 0x3e4e44], pants: [0x3a4038],
    hats: [1, 0, 8, 1], props: [], speed: [0.6, 0.9], count: 10,
    behaviors: [
      B('fishSit', 40, '垂钓汴河', false, 'tow', [14, 30]), B('castNet', 26, '撒网捕鱼', false, 'tow', [7, 14]),
      B('row', 18, '摇橹打鱼', false, undefined, [8, 16]), B('squatRel', 16, '补网晒笠', false, undefined, [6, 12]),
    ],
  },
  {
    key: 'drinker', label: '酒客', cloth: [0x7a5e3e, 0x5e6a4e, 0x6a4e5e], pants: [0x3e3a34],
    hats: [2, 5, 1, 3], props: ['fan'], speed: [0.7, 1.1], count: 22,
    behaviors: [
      B('drink', 30, '推杯换盏', false, 'wine', [10, 22]), B('chat', 22, '高谈阔论', false, 'wine', [7, 15]),
      B('dice', 14, '酒令骰戏', false, 'wine', [7, 14]), B('staggerWalk', 16, '醉步踉跄', true),
      B('eat', 10, '大块朵颐', false, 'food', [6, 12]), B('walk', 8, '再寻一馆', true),
    ],
  },
  {
    key: 'storyteller', label: '说书人', cloth: [0x5e4a6a, 0x4a5a6a], pants: [0x3a3e4a],
    hats: [2, 7, 0, 2], props: ['fan'], speed: [0, 0], count: 0,
    behaviors: [B('chat', 60, '拍案说书', false, undefined, [20, 40]), B('fanSway', 40, '醒木惊堂', false, undefined, [10, 20])],
  },
  {
    key: 'musician', label: '乐伎', cloth: [0x9a5a7a, 0x7a5a8a, 0xa86a5a], pants: [0x6a4a5e],
    hats: [0, 0, 0, 8], props: ['plank'], speed: [0, 0], count: 0,
    behaviors: [B('pluck', 60, '弹拨唱曲', false, undefined, [16, 32]), B('flute', 40, '吹笛和鸣', false, undefined, [12, 24])],
  },
  {
    key: 'acrobat', label: '艺人', cloth: [0xa84e3e, 0x3e7a6a, 0x8a6a2e], pants: [0x4a3e34],
    hats: [2, 3, 1, 4], props: ['carryPole'], speed: [0.9, 1.3], count: 12,
    behaviors: [
      B('balancePole', 30, '顶竿走索', false, 'stage', [9, 18]), B('spinDance', 24, '胡旋如风', false, 'stage', [7, 14]),
      B('puppeteer', 24, '悬丝傀儡', false, 'stage', [9, 18]), B('drum', 12, '锣鼓开场', false, 'stage', [6, 12]),
      B('walk', 10, '赶场', true),
    ],
  },
  {
    key: 'sailor', label: '船工', cloth: [0x4e5a52, 0x5a4e44], pants: [0x35382f],
    hats: [2, 4, 3, 1], props: [], speed: [0.8, 1.2], count: 0,
    behaviors: [B('walk', 50, '船上劳作', true), B('squatRel', 30, '船头歇息'), B('crank', 20, '绞盘收缆', false, 'dock', [6, 12])],
  },
  {
    key: 'camelDriver', label: '驼队客商', cloth: [0x8a6a3e, 0x6a5a3e], pants: [0x4a3e2c],
    hats: [1, 2, 5, 2], props: ['staff'], speed: [0.8, 1.1], count: 0,
    behaviors: [B('walk', 60, '牵引驼队', true), B('lookAround', 20, '照看驼货'), B('stand', 20, '休整驼队')],
  },
  {
    key: 'sitter', label: '听客', cloth: [0x5a6a5a, 0x6a5a4a, 0x4a5a6a], pants: [0x3a3e38],
    hats: [2, 4, 2, 3], props: ['fan'], speed: [0, 0], count: 0,
    behaviors: [B('sitTea', 60, '听说书', false, undefined, [24, 48]), B('sitNap', 20, '听得入梦', false, undefined, [16, 32]), B('chat', 20, '与邻座嘀咕', false, undefined, [10, 20])],
  },
];

export const JOB_MAP = new Map(JOBS.map((j) => [j.key, j]));

// ---- 社会热点（与 props/stalls 系统对接） ----
export interface Spot { pos: THREE.Vector3; kind: string }
export class SpotRegistry {
  list: Spot[] = [];
  add(x: number, z: number, kind: string, y = 0): void { this.list.push({ pos: new THREE.Vector3(x, y, z), kind }); }
  nearest(p: THREE.Vector3, kind: string, maxD = 34): Spot | null {
    let best: Spot | null = null, bd = maxD * maxD;
    for (const s of this.list) {
      if (s.kind !== kind) continue;
      const d = s.pos.distanceToSquared(p);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  byKind(kind: string): Spot[] { return this.list.filter((s) => s.kind === kind); }
}
