// ============================================================================
// 六道阶位 + 业力轴（P1-5 · D4 六道阶位体系最小可玩版）
//
// 业力（karma）：三界各配 1 个可重复动词，动词产出业力；业力累积推阶位。
// 六阶（D4 §2）：人道 0 → 修罗 300 → 畜生 800 → 饿鬼 1600 → 天道 3200 → 佛道 6400。
// 换阶只换动词集与 NPC 态度文案，不改数值口径（D4 §2.2：阶位不放大面数/数值）。
//
// 三界动词（每界 1 个可重复动词 + 1 个产出，交互点接 interact.act）：
//   人间·码头扛包：20 文 + 业力 2（既有经济动词加业力产出）
//   天宫·蟠桃宴幕：蟠桃 +1 + 业力 8（havoc pi=9 联动）
//   地府·十八狱巡环：业力 5（绕环一周判定——shibayu POI 交互点）
// 晕倒（生存循环）扣业力 100——失败有代价（D4 业缘语义）。
// ============================================================================
import { bus } from '../core/rng';

/** 六阶阈值（D4 §2.3 V13 沿用：480 反推口径弃用，按内容量重定） */
export const REALM_TIERS = [
  { name: '人道', at: 0 },
  { name: '修罗道', at: 300 },
  { name: '畜生道', at: 800 },
  { name: '饿鬼道', at: 1600 },
  { name: '天道', at: 3200 },
  { name: '佛道', at: 6400 },
] as const;

export function tierOf(karma: number): { name: string; index: number } {
  let idx = 0;
  for (let i = 0; i < REALM_TIERS.length; i++) if (karma >= REALM_TIERS[i].at) idx = i;
  return { name: REALM_TIERS[idx].name, index: idx };
}

export class Karma {
  karma = 0;
  /** 动词产出账（诊断/HUD）：每界累计 */
  byRealm = { human: 0, heaven: 0, underworld: 0 };

  /** 动词产出：业力 +n（负值=晕倒代价）。换阶沿总线广播 */
  gain(n: number, realm: keyof typeof this.byRealm): void {
    const before = tierOf(this.karma).name;
    this.karma = Math.max(0, this.karma + n);
    this.byRealm[realm] += n;
    const after = tierOf(this.karma);
    if (after.index > (REALM_TIERS.findIndex((t) => t.name === before))) {
      bus.emit('ui:toast', `✦ 阶位跃升：${before} → ${after.name}（业力 ${this.karma}）`);
      bus.emit('karma:ascend', { tier: after.name, karma: this.karma });
    }
  }

  /** 晕倒代价：业力 -100（不低于 0） */
  penalty(): void {
    this.karma = Math.max(0, this.karma - 100);
  }

  current(): { karma: number; tier: string } {
    return { karma: this.karma, tier: tierOf(this.karma).name };
  }

  serialize(): { karma: number } { return { karma: this.karma }; }
  deserialize(s: { karma?: number }): void {
    if (typeof s.karma === 'number') this.karma = Math.max(0, s.karma);
  }
}
