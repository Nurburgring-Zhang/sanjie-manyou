// ============ 西游神佛名册 ============
export type Side = 'wukong' | 'heaven' | 'daily';
export interface DeityDef {
  name: string; title: string; side: Side;
  scale: number; cloth: number; pants: number; skin?: number;
  hat: number; prop: string | null; halo?: boolean;
  buddha?: boolean;
  home: string; daily: string; battle: string[];
  weapon: string; desc: string;
}

export const DEITIES: DeityDef[] = [
  // ---- 齐天一方 ----
  // 悟空：原著'不满四尺'≈1.25m，scale 0.74（41 卷 CH-T-014）
  { name: '孙悟空', title: '齐天大圣', side: 'wukong', scale: 0.74, cloth: 0xc8502a, pants: 0x8a3218, hat: 3, prop: 'staff', home: 'arena', daily: 'staffCombo', battle: ['cloudSomersault', 'staffCombo', 'cloneCast'], weapon: '如意金箍棒', desc: '皇帝轮流做，明年到我家' },
  { name: '牛魔王', title: '平天大圣', side: 'wukong', scale: 1.32, cloth: 0x4a2e22, pants: 0x2e1c14, hat: 2, prop: 'axe', home: 'arenaW', daily: 'axeChop', battle: ['axeChop'], weapon: '混铁棍', desc: '七大圣之首，来赴蟠桃之约' },
  { name: '蛟魔王', title: '覆海大圣', side: 'wukong', scale: 1.15, cloth: 0x2a4a5e, pants: 0x1a3040, hat: 0, prop: 'spear', home: 'arenaW', daily: 'spearThrust', battle: ['spearThrust'], weapon: '蛟枪', desc: '覆海翻江，来助盟兄一臂' },
  { name: '鹏魔王', title: '混天大圣', side: 'wukong', scale: 1.12, cloth: 0x3e4a2e, pants: 0x28321e, hat: 0, prop: 'blade', home: 'arenaE', daily: 'flyDash', battle: ['flyDash'], weapon: '金翎刀', desc: '云程万里，扶摇九万' },
  { name: '狮驼王', title: '移山大圣', side: 'wukong', scale: 1.25, cloth: 0x5e4a2e, pants: 0x3e301c, hat: 2, prop: 'axe', home: 'arenaE', daily: 'axeChop', battle: ['axeChop'], weapon: '开山斧', desc: '一声吼，山岳移' },
  { name: '猕猴王', title: '通风大圣', side: 'wukong', scale: 0.95, cloth: 0x6a4e2e, pants: 0x46321c, hat: 3, prop: 'staff', home: 'arenaW', daily: 'monkeyScratch', battle: ['staffCombo'], weapon: '铁棒', desc: '耳听八方，来去如风' },
  { name: '禺狨王', title: '驱神大圣', side: 'wukong', scale: 1.05, cloth: 0x5e3e2a, pants: 0x3e2818, hat: 3, prop: 'staff', home: 'arenaE', daily: 'monkeyScratch', battle: ['staffCombo'], weapon: '赤棍', desc: '驱神役鬼，啸聚花果' },
  // ---- 天庭 ----
  { name: '玉皇大帝', title: '昊天金阙至尊', side: 'heaven', scale: 1.1, cloth: 0xd8b028, pants: 0xa8801a, hat: 1, prop: null, halo: true, home: 'palace', daily: 'holdCourt', battle: ['holdCourt'], weapon: '无', desc: '高坐凌霄，先招安后降妖' },
  { name: '王母娘娘', title: '瑶池金母', side: 'heaven', scale: 1.02, cloth: 0xc86a9a, pants: 0x9a4a70, hat: 3, prop: 'fan', halo: true, home: 'palace', daily: 'sleeveWave', battle: ['sleeveWave'], weapon: '蟠桃盘', desc: '蟠桃会未开，蟠桃先遭殃' },
  { name: '太上老君', title: '太清道德天尊', side: 'heaven', scale: 1.05, cloth: 0xd8d0c0, pants: 0xb0a890, hat: 1, prop: 'fan', halo: true, home: 'furnace', daily: 'forgeImmortal', battle: ['forgeImmortal'], weapon: '金刚琢', desc: '金刚琢一出，管教泼猴吃个暗亏' },
  { name: '太白金星', title: '长庚启明星官', side: 'heaven', scale: 0.98, cloth: 0xe8e0c8, pants: 0xc0b898, hat: 1, prop: 'fan', home: 'palace', daily: 'fanSway', battle: ['fanSway'], weapon: '拂尘', desc: '招安抚慰，老成谋国' },
  { name: '托塔李天王', title: '降魔大元帅', side: 'heaven', scale: 1.12, cloth: 0x3e4e6a, pants: 0x2a364a, hat: 1, prop: 'goldRing', halo: true, home: 'arenaN', daily: 'towerPress', battle: ['towerPress', 'flyIdle'], weapon: '玲珑宝塔', desc: '宝塔镇河妖，也镇不了猴' },
  { name: '哪吒三太子', title: '三坛海会大神', side: 'heaven', scale: 0.9, cloth: 0xc83a5e, pants: 0x8a2440, hat: 3, prop: 'spear', home: 'arenaN', daily: 'staffCombo', battle: ['staffCombo', 'flyDash'], weapon: '火尖枪', desc: '风火轮起，六臂齐张' },
  // 二郎神：淡鹅黄袍（原著第六回出场诗，41 卷 CH-T 修正）
  { name: '二郎神杨戬', title: '清源妙道真君', side: 'heaven', scale: 1.1, cloth: 0xd8c88a, pants: 0xb09a5e, hat: 1, prop: 'spear', halo: true, home: 'arenaS', daily: 'swordForm', battle: ['thirdEyeBeam', 'swordForm', 'flyDash'], weapon: '三尖两刃刀', desc: '天眼一开，妖无处遁形' },
  { name: '哮天犬', title: '细犬', side: 'heaven', scale: 0.78, cloth: 0x2e2a28, pants: 0x1e1c1a, hat: 0, prop: null, home: 'arenaS', daily: 'dogPounce', battle: ['dogPounce'], weapon: '利齿', desc: '照腿便咬，从不含糊' },
  { name: '巨灵神', title: '天门守将', side: 'heaven', scale: 2.35, cloth: 0x5e4a2e, pants: 0x3e301c, hat: 1, prop: 'axe', home: 'arenaE', daily: 'axeChop', battle: ['axeChop', 'flyDash'], weapon: '宣花大斧', desc: '巨斧开山，可惜斧拙' },
  { name: '持国天王', title: '东方持国', side: 'heaven', scale: 1.18, cloth: 0xc8a028, pants: 0x8a7018, hat: 1, prop: 'plank', home: 'arenaN', daily: 'pluck', battle: ['pluck'], weapon: '琵琶', desc: '琵琶弦动，风调雨顺' },
  { name: '增长天王', title: '南方增长', side: 'heaven', scale: 1.18, cloth: 0x3e6a5e, pants: 0x28463e, hat: 1, prop: 'blade', home: 'arenaN', daily: 'swordForm', battle: ['swordForm'], weapon: '慧剑', desc: '剑指南方，烦恼斩断' },
  { name: '广目天王', title: '西方广目', side: 'heaven', scale: 1.18, cloth: 0x8a3e3e, pants: 0x5e2828, hat: 1, prop: 'spear', home: 'arenaS', daily: 'spearThrust', battle: ['spearThrust'], weapon: '紫金龙', desc: '广目巡天，纤毫毕现' },
  { name: '多闻天王', title: '北方多闻', side: 'heaven', scale: 1.18, cloth: 0x4a4a6a, pants: 0x2e2e46, hat: 1, prop: 'fan', home: 'arenaS', daily: 'present', battle: ['present'], weapon: '宝伞', desc: '宝伞一展，风雷不侵' },
  { name: '王灵官', title: '隆恩真君', side: 'heaven', scale: 1.08, cloth: 0x8a2e2e, pants: 0x5e1c1c, hat: 1, prop: 'spear', home: 'palace', daily: 'spearThrust', battle: ['spearThrust'], weapon: '金鞭', desc: '凌霄殿前，最后一道门闩' },
  { name: '雷公', title: '雷声普化天尊麾下', side: 'heaven', scale: 0.95, cloth: 0x4a3e6a, pants: 0x2e2646, hat: 2, prop: 'hammer', home: 'high', daily: 'thunderDrum', battle: ['thunderDrum'], weapon: '雷钻', desc: '连擂雷钻，天鼓齐鸣' },
  { name: '电母', title: '电光圣母', side: 'heaven', scale: 0.95, cloth: 0x6a5a8a, pants: 0x463a60, hat: 3, prop: 'fan', home: 'high', daily: 'mirrorFlash', battle: ['mirrorFlash'], weapon: '电镜', desc: '银镜一闪，天地皆白' },
  { name: '风伯', title: '风师爷', side: 'heaven', scale: 0.98, cloth: 0x3e5e5e, pants: 0x283e3e, hat: 0, prop: 'staff', home: 'high', daily: 'flyIdle', battle: ['flyIdle'], weapon: '风囊', desc: '囊开千浪，云走八方' },
  { name: '雨师', title: '雨师爷', side: 'heaven', scale: 0.98, cloth: 0x2e4e6a, pants: 0x1e3446, hat: 0, prop: 'bucket', home: 'high', daily: 'flyIdle', battle: ['flyIdle'], weapon: '雨瓶', desc: '瓶倾天河，泼向花果' },
  { name: '赤脚大仙', title: '赤脚大仙', side: 'heaven', scale: 1.15, cloth: 0xd8c8a8, pants: 0xb0a080, hat: 0, prop: null, halo: true, home: 'palace', daily: 'walk', battle: ['courtBow'], weapon: '无', desc: '光脚赴会，反被泼猴赚了' },
  // ---- 神佛日常 ----
  { name: '如来佛祖', title: '释迦牟尼', side: 'daily', buddha: true, scale: 1.5, cloth: 0xd8a830, pants: 0xb08820, hat: 3, prop: null, halo: true, home: 'lotus', daily: 'preach', battle: ['preach', 'sitLotus'], weapon: '五指山', desc: '手掌翻覆，悟空不出' },
  { name: '观音菩萨', title: '大慈大悲', side: 'daily', buddha: true, scale: 1.2, cloth: 0xe8e8f0, pants: 0xc0c0d0, hat: 3, prop: 'bucket', halo: true, home: 'lotus2', daily: 'preach', battle: ['preach', 'sitLotus'], weapon: '净瓶杨柳', desc: '净瓶甘露，先度众生' },
  { name: '嫦娥仙子', title: '广寒宫主', side: 'daily', scale: 1.0, cloth: 0xe8e0f0, pants: 0xc0b8d8, hat: 3, prop: 'fan', halo: true, home: 'moon', daily: 'sleeveWave', battle: ['sleeveWave'], weapon: '玉兔', desc: '广寒袖舞，桂影婆娑' },
  { name: '七仙女·红衣', title: '蟠桃采撷', side: 'daily', scale: 0.95, cloth: 0xd84a5a, pants: 0xa83040, hat: 3, prop: 'basket', home: 'pantao', daily: 'pickPeach', battle: ['pickPeach'], weapon: '花篮', desc: '蟠桃园中采撷仙桃' },
  { name: '七仙女·青衣', title: '蟠桃采撷', side: 'daily', scale: 0.95, cloth: 0x3a9a8a, pants: 0x28706a, hat: 3, prop: 'basket', home: 'pantao', daily: 'pickPeach', battle: ['pickPeach'], weapon: '花篮', desc: '桃熟三千岁一熟' },
  { name: '七仙女·素衣', title: '霓裳羽衣', side: 'daily', scale: 0.95, cloth: 0xe8e4d8, pants: 0xc0bcac, hat: 3, prop: 'fan', home: 'pantao', daily: 'spinDance', battle: ['spinDance'], weapon: '羽扇', desc: '为蟠桃盛会起舞' },
  { name: '仙官·甲', title: '凌霄殿班列', side: 'daily', scale: 0.95, cloth: 0x8a7a3a, pants: 0x5e5226, hat: 1, prop: 'plank', home: 'court', daily: 'courtBow', battle: ['courtBow'], weapon: '笏板', desc: '早朝班列，山呼万岁' },
  { name: '仙官·乙', title: '凌霄殿班列', side: 'daily', scale: 0.95, cloth: 0x6a5a8a, pants: 0x463a60, hat: 1, prop: 'plank', home: 'court', daily: 'courtBow', battle: ['courtBow'], weapon: '笏板', desc: '太白金星：且慢动兵' },
  { name: '仙官·丙', title: '凌霄殿班列', side: 'daily', scale: 0.95, cloth: 0x3a6a5e, pants: 0x26463e, hat: 1, prop: 'plank', home: 'court', daily: 'courtBow', battle: ['courtBow'], weapon: '笏板', desc: '启奏陛下，东胜神洲捷报' },
];

export const DEITY_NAMES = DEITIES.map((d) => d.name);
