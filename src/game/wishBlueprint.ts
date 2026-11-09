// ============================================================================
// 三界造物 · 游戏内 Agent 设定开发 / 资产登记 · src/game/wishBlueprint.ts
//
// 解决的问题：现状 L1/L2/L3 只产出一个 WishSpec（一堆参数），没有「设定开发产出物」、
//   没有可读的资产设定卡、没有资产登记本、也没有可复用的开发资产。本模块补上这一层：
//   把一次愿望的解析结果，离线「开发」为一张完整设定卡（AssetLore）与一份可登记的资产
//   蓝图（AssetBlueprint），并记录可见的 Agent 开发流水（意图解析 → 设定撰写 → 几何锻造
//   → 资产登记 → 热更新载入），供主线程塞进面板、写入登记本并接入热更新链路。
//
// 纪律：
//   1) 纯确定性：所有句式都由 wish / spec.name / traits / colors / archetype / source /
//      catalog.lore 经整数 FNV-1a 哈希选择模板；禁止 Math.random、禁止 Date.now 影响设定
//      内容；相同输入必产出逐字节一致的 AssetBlueprint（可单测）。
//   2) 完全离线：无需任何 apiKey / 网络即可产出完整设定，developAsset 不读配置、不发请求。
//      mergeLlmLore 仅作「可选增强」：把 LLM 返回的不定型 JSON 按字段白名单 + 长度限制 +
//      净化后合并，失败或无效时原样返回。
//   3) 不存密钥：登记本只序列化 AssetBlueprint 的契约字段；落盘前按白名单重建对象，任何
//      额外字段（含 apiKey / token / secret）都不会写入。HTML 片段统一做实体转义防 XSS。
//   4) 无新依赖：仅 import type 两个既有类型，编译后不产生任何运行时 import。
// ============================================================================
import type { WishSpec } from './wishForge';
import type { CatalogEntry, WishShape } from './wishCatalog';

// ---- 对外契约（主线程按此集成，签名不可变）------------------------------------
export interface AssetLore {
  epithet: string;       // 称号，如「东海沧溟 · 兴云布雨之君」
  origin: string;        // 出典 / 来源
  appearance: string;    // 外形描述（可读中文，2~3 句）
  powers: string[];      // 神通 / 能力列表（3~6 条）
  temperament: string;   // 性情
  habitat: string;       // 栖息 / 出没
  backstory: string;     // 背景设定（2~3 句）
  element: string;       // 五行属性
  tierNote: string;      // 阶位 / 稀有度说明
}

export interface AssetBlueprint {
  id: string;                 // 稳定 id，由 wish + spec.name 哈希生成，确定性
  wish: string;               // 用户原话
  name: string;
  spec: WishSpec;
  lore: AssetLore;
  tier: 'L1' | 'L2' | 'L3' | 'preset';
  catalog?: CatalogEntry;     // L1 命中预设时带上
  version: number;            // 固定 1
  steps: string[];            // Agent 开发流水，五步，每步一句中文说明
}

type Tier = AssetBlueprint['tier'];

const VERSION = 1;
const STORAGE_KEY = 'cyber-qingming.blueprints.v1';
const MAX_ENTRIES = 200;

// ---- 确定性整数工具（无 Math.random / 无 Date.now）----------------------------
function hashText(s: string): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}

/** 用整数哈希从模板数组里取一项；相同 key 必得相同结果 */
function pick<T>(arr: readonly T[], key: string): T {
  return arr[hashText(key) % arr.length];
}

/** 确定性洗牌：以「元素内容 + 位置」的哈希为排序键，不依赖运行时随机源 */
function shuffled(arr: readonly string[], key: string): string[] {
  return arr
    .map((v, i) => ({ v, k: hashText(`${key}#${i}#${v}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

function dedupe(arr: readonly string[]): string[] {
  return Array.from(new Set(arr));
}

/** 模板占位符 {name} / {main} / {alt} / {trait} 等替换 */
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? vars[k] : m));
}

/** HTML 实体转义：所有进入 innerHTML 的动态文本都走这里 */
function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

/** 颜色数值 → 可读中文色名（兜底也走哈希，保持确定性） */
function colorName(hex: number): string {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 60) return '墨玄';
  if (min > 200) return '素白';
  if (r > 190 && g > 150 && b < 120) return '鎏金';
  if (r > 150 && g < 110 && b < 110) return '丹赤';
  if (r > 130 && b > 130 && g < 120) return '绛紫';
  if (b > r + 20 && b > g + 10) return '靛蓝';
  if (g > r + 10 && g > b + 10) return '青碧';
  if (r > g + 30 && r > b + 30) return '朱红';
  if (b > 150 && g > 150) return '霜青';
  return pick(['玄苍', '琉璃', '烟霞', '苍黛', '赭黄'], 'color#' + String(hex >>> 0));
}

// ---- 八类愿景专属设定（带 WishSpec.shape 时覆盖通用原型文案，保证设定卡也语义正确）----
const SHAPE_APPEARANCE: Record<WishShape, string> = {
  cat: '{name}为四足小动物，躯干紧凑柔软，{main}皮毛间生{alt}斑纹；双耳竖立、双目圆亮，长尾轻卷，四足踏地无声，举止轻捷而亲人。',
  palace: '{name}起于宏阔台基之上，中轴主殿重檐高举，{main}柱{alt}瓦、宝顶鎏金；两厢配殿对称铺展，前门阙与四角阙楼围合，围墙绵延，气象庄严。',
  mountain: '{name}拔地而起，主峰高耸、次峰拱卫，{main}岩体嶙峋，峰顶覆{alt}雪冠，山脊棱面分明，坡面渐收，自成一方地形。',
  army: '{name}为披甲执兵的人形军阵，兜鍪{alt}、铠甲{main}，长兵如林、盾列成行，按行列方阵排布，阵列整肃。',
  battalion: '{name}为天庭将校，金甲{main}、兜鍪红缨，背光圆光环绕，长兵如林，按天罡阵列自九霄铺展，祥云托足。',
  car: '{name}为现代轿车，低趴流线车身以{main}为漆、{alt}为饰，车舱玻璃通透，四轮外露，前后灯组呼应，楔形车头蓄势欲驰。',
  spaceship: '{name}为带翼飞行器，梭形{main}机身接机首锥，座舱盖透亮，三角主翼外张、垂尾高竖，尾部推进器喷出{alt}尾焰，作星际穿梭之姿。',
  alien: '{name}为类人异形，巨大头颅{main}、杏核大眼幽深，{alt}细长躯干与四肢比例异于常人，头顶触角微颤，静立而含异星之感。',
};
const SHAPE_HABITAT: Record<WishShape, string> = {
  cat: '街市人家与庭院阶前，喜暖处与人身侧',
  palace: '都城形胜之地，御道与宫城之中',
  mountain: '天地山川之间，云海与群峰之畔',
  army: '校场与关隘，战阵前列',
  battalion: '九霄云端与天庭宫阙之前',
  car: '通衢大道与车马川流之处',
  spaceship: '星汉与云表之间，航天港与轨道',
  alien: '异星来处与星舟降落地',
};
const SHAPE_POWER: Record<WishShape, string> = {
  cat: '轻捷跃扑，来去无声', palace: '镇守朝堂，纳福迎祥',
  mountain: '镇地成岳，聚气藏风', army: '列阵冲锋，进退成法',
  battalion: '天威列阵，敕令风云', car: '疾驰载行，朝发夕至',
  spaceship: '星际穿梭，越虚凌空', alien: '异能感知，念动化物',
};

// ---- 设定素材库 --------------------------------------------------------------
const ARCH_CN: Record<string, string> = {
  dragon: '龙', beast: '走兽', bird: '禽鸟', humanoid: '人形', deity: '神佛',
  plant: '草木', building: '楼台', item: '器物', vehicle: '载具', spirit: '灵体',
};

/** 外形模板：按 archetype 写具体部件（角/鳞/爪/须/背鳍/扇尾、羽/喙/翼/尾、
 *  台基/斗拱/瓦顶/槅扇、形制/纹饰/材质……），并嵌 traits 与颜色 */
const APPEARANCE: Record<string, string[]> = {
  dragon: [
    '{name}身长数丈，通体密覆{main}鳞甲，脊背一道{alt}背鳍自颈贯至尾端，鳞隙隐现{trait}之光。头生分叉鹿角，凸目如炬，两缕长须随云气飘拂；四足各张钩爪，尾展扇形鳍，盘旋时躯干蜿蜒如虹。',
    '但见{name}蟠身而起，{main}色鳞片层叠成纹，颈鬣与{alt}背鳍连作一带。鹿角崚嶒、鲤须垂拂，爪若霜钩，扇尾扫处风雷并起；遍体{trait}缠绕，鳞光随呼吸明灭。',
  ],
  bird: [
    '{name}振翼可蔽日，{main}羽覆身，{alt}彩翎叠作长尾，喙弯如钩而目含{trait}。双翼展开可见层叠飞羽，尾羽分披修长，立则昂首睥睨，翔则带起一路云气。',
    '此禽通体{main}，颈项环一圈{alt}细羽，喙尖爪利。翼羽翛然、尾翎如带，{trait}凝于眸中，每振翅便有流光自羽隙洒落。',
  ],
  beast: [
    '{name}躯干雄健，{main}皮毛间生{alt}异纹，四足踏地如磐石。獠牙森列、利爪钩地，长尾舒卷带起{trait}，双目炯然，静立亦自有威。',
    '其形似兽而角鬣特异，{main}为体、{alt}为斑，脊骨隆起如丘。爪牙之外，周身{trait}浮动，行处草木为之披靡。',
  ],
  building: [
    '{name}起于{main}台基之上，立柱承{alt}斗拱，层层出跳。上覆瓦顶四坡，槅扇门窗镂作{trait}纹，檐角悬铃，阶前可容宴坐凭眺。',
    '但见{name}台基方正，{main}柱础稳立，{alt}斗拱交叠承托飞檐。瓦脊列兽、槅扇透光，梁枋彩画皆取{trait}之意，风过檐铃泠然。',
  ],
  item: [
    '{name}形制古雅，以{main}为质、{alt}为饰，通体錾刻{trait}纹。器口一道灵光内敛，握之温润，锋钮环处尤见煅造之工，久置亦不蒙尘。',
    '此器{main}为骨、{alt}镶边，轮廓圆劲，周身满布{trait}回纹。光自纹隙渗出，触手微温，似有呼吸与之相应。',
  ],
  humanoid: [
    '{name}作人形，着{main}衣袍、束{alt}带，身量修伟而眉目清朗。手执{trait}法器，举止有度，行止之间衣袂不带尘。',
    '其人{main}冠{alt}裳，立姿端凝，掌中{trait}器物隐隐生辉。眉目如绘而神色淡然，望之知非俗世凡客。',
  ],
  deity: [
    '{name}金身丈六，{main}祥光绕体、{alt}莲台承足。宝冠璎珞层垂，手结法印，{trait}化作背后圆光，眉间白毫普照十方。',
    '但见{name}端坐{alt}莲座，{main}毫光自顶门贯出。天衣宝带、手印庄严，{trait}凝为轮光环身，俯视众生而含慈悲。',
  ],
  plant: [
    '{name}灵根深扎，{main}主干扶疏，{alt}枝叶层生如盖。花开{trait}色，果实垂枝，四时常青不凋，树下自成一脉灵荫。',
    '此木{main}为干、{alt}为叶，枝干虬曲有致。{trait}凝作花实，落英不腐，根须所及泉脉皆清。',
  ],
  vehicle: [
    '{name}以{main}为骨、{alt}为饰，轮辕桨帆毕具。篷厢雕作{trait}纹，行则轻稳不颠，水陆皆可驰骋。',
    '但见{name}轮毂{alt}、厢体{main}，篷顶张如飞翼。{trait}纹绕辕而行，启行时铃铎轻响，转瞬已过数里。',
  ],
  spirit: [
    '{name}无定形，{main}幽光聚为朦胧之体，{alt}碎片环身浮沉。所过之处{trait}弥漫，忽明忽暗，倏忽已至人身侧。',
    '其质若烟，{main}光缕缠作人形轮廓，{alt}星点明灭其中。{trait}随形聚散，触之微凉，不可执亦不可驱。',
  ],
};

/** trait → 神通短语；未收录的 trait 由模板现场推导 */
const TRAIT_POWER: Record<string, string> = {
  '鳞甲': '鳞甲御兵，刀矢难伤', '腾云': '腾云驾雾，瞬息千里', '兴雨': '兴云布雨，润泽一方',
  '利爪': '利爪裂石，摧锋破阵', '迅捷': '踏风逐电，来去无踪', '羽翼': '振翼凌霄，扶摇九万',
  '彩翎': '彩翎幻光，迷乱敌目', '人形': '通晓人言，善解人意', '法器': '祭炼法器，镇邪伏妖',
  '祥光': '祥光普照，百秽不侵', '威仪': '威仪慑众，万灵宾服', '枝叶': '枝蔓缠缚，生生不息',
  '灵根': '灵根汲地，久视长生', '飞檐': '飞檐承露，聚气藏风', '台基': '镇地安基，稳如磐石',
  '纹饰': '纹饰成阵，禁锢邪祟', '灵光': '灵光护体，逢凶化吉', '轮辕': '轮辕驰陆，日行千里',
  '雕饰': '雕饰通灵，自鸣自应', '幽冥': '幽冥引渡，通彻阴阳', '幻化': '千形幻化，隐显由心',
  '赤红': '赤炎焚野，烈焰护身', '金色': '金芒曜目，破暗驱邪', '青碧': '青木回春，疗伤续命',
  '玄黑': '玄冥敛息，匿影藏形', '银白': '银辉凝霜，冻滞百川', '紫气': '紫气东来，福运加身',
  '透明': '澄澈无质，穿墙透壁', '发光': '体生明光，照彻长夜', '火焰': '吞吐烈焰，熔金烁石',
  '寒冰': '吐纳寒冰，凝霜封渊', '雷霆': '引落雷霆，震慑群邪', '流水': '随波化形，无孔不入',
  '祥云': '足踏祥云，凌虚而行', '鎏金': '鎏金铸骨，坚不可摧', '琉璃': '琉璃净体，诸垢不染',
  '玉石': '玉魄养神，宁心定魄', '玄铁': '玄铁为筋，力扛山岳', '长青': '四时长青，枯荣自主',
  '锋刃': '锋刃所指，无坚不摧', '獠牙': '獠牙啮铁，破甲断兵', '异纹': '异纹成契，感应同类',
  '金光': '金光护顶，邪祟退避', '威严': '一喝慑魄，群小屏息', '天象': '仰观天象，预知休咎',
  '佛光': '佛光灌顶，消业解厄', '慈悲': '慈悲普渡，化戾为祥', '莲台': '莲台托足，凌波不溺',
  '星辉': '星辉注体，夜行如昼', '宿曜': '宿曜加身，命数自持', '取经': '持经行脚，破除迷障',
  '神通': '七十二变，应变无穷', '法宝': '法宝随心，收发由念', '妖气': '妖气弥野，慑伏行人',
  '幻形': '幻形易貌，真伪难辨', '精气': '精气长养，不假外求', '草木': '草木皆兵，借势成阵',
  '符文': '符文镌骨，敕令如律', '木作': '木作通灵，自成机关', '榫卯': '榫卯相契，坚逾金石',
  '陈设': '陈设布阵，安宅镇室', '雅致': '雅韵养性，澄怀涤虑', '驯服': '驯良护主，不违其令',
  '护主': '以身蔽主，虽危不辞', '灵性': '灵性天成，未卜先知', '瑞气': '瑞气氤氲，所至呈祥',
};

function powerForTrait(trait: string, seedKey: string): string {
  if (TRAIT_POWER[trait]) return TRAIT_POWER[trait];
  return pick([
    `引「${trait}」之气，凝为护体灵光`,
    `以「${trait}」化形，随念生灭`,
    `「${trait}」加持，行止皆带异象`,
    `摄取「${trait}」精魄，久蓄不竭`,
  ], seedKey + '#power#' + trait);
}

const ARCH_POWER: Record<string, string> = {
  dragon: '潜渊蹈海，吞吐风云', beast: '啸聚山林，威震百兽', bird: '振翼凌霄，俯瞰八荒',
  humanoid: '执器行道，通达四方', deity: '敕令天象，护佑一方', plant: '根植灵脉，化育群芳',
  building: '聚气藏风，镇守地脉', item: '祭炼成形，通灵自鸣', vehicle: '驰越水陆，朝发夕至',
  spirit: '出入幽冥，倏忽千里',
};

const EXTRA_POWERS = [
  '感应诚心，有求必应', '聚散如意，不滞于形', '吞吐灵气，滋养万物',
  '隐显由心，避祸趋吉', '铭刻愿力，与主从游',
];

const EPITHET_PLACE = [
  '东海沧溟', '九霄云表', '昆仑玄圃', '幽冥黄泉', '太虚星汉',
  '南冥天池', '岱宗云壑', '汴河灯影', '瑶池阆苑', '大荒之野',
];
const EPITHET_ROLE: Record<string, string[]> = {
  dragon: ['兴云布雨', '潜渊驭水', '衔烛照幽'], beast: ['镇山啸林', '护主驱邪', '踏雪寻踪'],
  bird: ['司晨报晓', '抟风凌霄', '衔瑞呈祥'], humanoid: ['执器行道', '通译三界', '守诺不渝'],
  deity: ['敕令天象', '普度群生', '监察善恶'], plant: ['化育群芳', '荫庇一方', '四时不凋'],
  building: ['聚气藏风', '镇守地脉', '纳福迎祥'], item: ['通灵自鸣', '镇邪伏妖', '承愿显化'],
  vehicle: ['朝发夕至', '越水穿云', '载福而行'], spirit: ['出入幽冥', '引渡迷津', '隐显由心'],
};
const EPITHET_TITLE = ['之君', '之尊', '之使', '之灵', '之主', '之神', '之王', '之客'];

const TEMPERAMENT = [
  '温驯而通人性，喜与人亲，偶作娇憨之态',
  '威严自持，不怒而慑，然于诚心者宽和',
  '疏懒好静，常蛰不出，逢缘方一现身',
  '灵动跳脱，最喜嬉游，逐光逐影终日不倦',
  '忠谨护主，恩怨分明，一诺便守百年',
  '孤高绝俗，难为世用，唯与清风明月相和',
  '外冷内热，默然随行，危时必挺身而前',
];

const HABITAT: Record<string, string[]> = {
  dragon: ['东海沧溟深处的龙宫', '九霄云气之间', '大江回漩之底', '深渊水府与雷雨之夕'],
  beast: ['深山洞府与古木之林', '荒野丘壑之间', '岩穴与月下的山脊', '人迹罕至的幽谷'],
  bird: ['丹穴之山的梧桐高枝', '云表悬崖之上', '瑶池琼林之间', '朝阳初照的峰巅'],
  humanoid: ['通衢市井与书斋之间', '古刹廊下', '山门之前的石阶', '灯影里的长街'],
  deity: ['九重天阙与香火鼎盛之祠', '莲台祥光之中', '星汉之上的宫阙', '庙堂金身之内'],
  plant: ['灵脉充盈的山阿水湄', '古观庭院一隅', '仙山云雾之间', '清泉之侧的沃土'],
  building: ['临水高台与通衢之侧', '御苑深处', '山门之前', '城隅形胜之地'],
  item: ['有德者的掌中袖底', '古刹藏经之匣', '高士案头', '世代相传的锦囊'],
  vehicle: ['水陆要冲的驿道', '津渡与长堤', '云路之上', '车马辐辏的城门'],
  spirit: ['幽冥黄泉之畔', '荒坟古宅与夜雾', '阴阳交界之处', '灯火阑珊的巷尾'],
};

const BACKSTORY_TPL = [
  '据{originTag}，{name}本无定形。今愿主一呼「{wish}」，{trait}之气聚而赋形，遂自虚空中显此真身。此后长居{habitat}，与许愿之人共历晨昏。',
  '{originTag}尝记其类而未著其名。及至「{wish}」出口，三界造物录其声，取{main}与{alt}之精、赋{trait}之性，造{name}降世。自兹{habitat}间，便多了一桩可寻的灵迹。',
];

const ELEMENT_DESC: Record<string, string> = {
  '金': '金 · 从革主肃，利锐而坚',
  '木': '木 · 曲直主生，荣发而仁',
  '水': '水 · 润下主智，潜流而变',
  '火': '火 · 炎上主礼，明照而烈',
  '土': '土 · 稼穑主信，厚载而安',
};

const RARITY_CN: Record<string, string> = {
  common: '凡品', rare: '珍品', epic: '逸品', legendary: '仙品', mythic: '神品',
};

const SOURCE_ORIGIN: Record<string, string> = {
  preset: '承三界造物预设目录旧典',
  param: '由许愿者口述，经参数化推演而成，未入旧典',
  code: '由 L3 代码档 Agent 现场撰作，属原创孤本',
};

// ---- 设定开发主入口 ----------------------------------------------------------
/**
 * 离线确定性开发：无需任何 API key / 网络也能产出完整设定卡与资产蓝图。
 * 相同 (wish, spec, tier, catalog) 必产出完全相同的 AssetBlueprint。
 */
export function developAsset(
  wish: string,
  spec: WishSpec,
  tier: Tier,
  catalog?: CatalogEntry,
): AssetBlueprint {
  // 浅拷贝：避免调用方后续改动 spec 影响已登记资产，也让产出完全自洽
  const safeSpec: WishSpec = { ...spec, traits: [...spec.traits], colors: [...spec.colors] };
  const colors = safeSpec.colors.length ? safeSpec.colors : [0xd4af37, 0x4fa8a0, 0xa8503c];
  const main = colorName(colors[0]);
  const alt = colorName(colors[1 % colors.length]);
  const traits = safeSpec.traits.length ? safeSpec.traits : ['灵光', '祥瑞'];
  const traitsText = traits.slice(0, 4).join('、');
  const colorHex = colors
    .map((c) => '0x' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0'))
    .join(',');

  const seedKey = [
    wish, safeSpec.name, safeSpec.archetype, safeSpec.source, String(safeSpec.seed),
    safeSpec.traits.join(','), colorHex,
    catalog ? `${catalog.id}:${catalog.source}:${catalog.rarity}:${catalog.lore}` : '',
  ].join('|');
  const trait = pick(traits, seedKey + '#trait');
  const id = 'bp-' + hashText(wish + '|' + safeSpec.name).toString(16).padStart(8, '0');

  // L1 / preset 优先复用目录里的 lore / source / rarity；L2 / L3 用 spec.source 与 traits
  const useCatalog = !!catalog && (tier === 'L1' || tier === 'preset');
  const origin = useCatalog && catalog
    ? `${catalog.source} · ${catalog.category}｜${catalog.lore}`
    : `${SOURCE_ORIGIN[safeSpec.source] ?? '来历不详'}；特质取自「${traitsText}」一念。`;
  const originTag = useCatalog && catalog
    ? `${catalog.source}所载`
    : (safeSpec.source === 'code' ? 'L3 代码档原创' : safeSpec.source === 'preset' ? '预设目录旧典' : '愿主口述');

  const epithet = [
    pick(EPITHET_PLACE, seedKey + '#place'),
    ' · ',
    pick(EPITHET_ROLE[safeSpec.archetype] ?? ['承愿显化'], seedKey + '#role'),
    pick(EPITHET_TITLE, seedKey + '#title'),
  ].join('');

  const shape: WishShape | undefined = safeSpec.shape;
  const habitat = shape
    ? SHAPE_HABITAT[shape]
    : pick(HABITAT[safeSpec.archetype] ?? ['天地之间，随缘而止'], seedKey + '#habitat');

  const ts = traits.join('') + main + safeSpec.archetype;
  let element: string;
  if (/火|炎|赤|红|烈|丹|朱/.test(ts)) element = ELEMENT_DESC['火'];
  else if (/水|海|寒|冰|玄|雨|云|润|龙|鳞|泉|波/.test(ts)) element = ELEMENT_DESC['水'];
  else if (/木|青|碧|翠|绿|枝|叶|花|草|长青|松|竹/.test(ts)) element = ELEMENT_DESC['木'];
  else if (/金|银|白|锋|刃|刀|剑|鎏|铁|刚/.test(ts)) element = ELEMENT_DESC['金'];
  else if (/土|黄|岩|石|山|台|基|玉|壁|城/.test(ts)) element = ELEMENT_DESC['土'];
  else element = pick(Object.values(ELEMENT_DESC), seedKey + '#element');

  const vars: Record<string, string> = {
    name: safeSpec.name, main, alt, trait, traits: traitsText, wish,
    origin, originTag, habitat, epithet, element,
    archetype: ARCH_CN[safeSpec.archetype] ?? safeSpec.archetype,
  };

  const appearance = shape
    ? fill(SHAPE_APPEARANCE[shape], vars)
    : fill(pick(APPEARANCE[safeSpec.archetype] ?? APPEARANCE['beast'], seedKey + '#appearance'), vars);

  // 神通：shape/archetype 基础 + traits 派生，确定性洗牌后取 3~6 条，不足用通用池补足
  const candidates = dedupe([
    shape ? SHAPE_POWER[shape] : (ARCH_POWER[safeSpec.archetype] ?? '聚灵成形，随心应念'),
    ...traits.map((t) => powerForTrait(t, seedKey)),
  ]);
  let pool = shuffled(candidates, seedKey + '#powers');
  for (const e of EXTRA_POWERS) {
    if (pool.length >= 6) break;
    if (!pool.includes(e)) pool.push(e);
  }
  while (pool.length < 3) pool.push(`愿力凝形，第${pool.length + 1}重灵应`);
  const powerCount = 3 + (hashText(seedKey + '#pn') % 4);
  const powers = pool.slice(0, Math.min(powerCount, pool.length));

  const temperament = pick(TEMPERAMENT, seedKey + '#temperament');
  const backstory = fill(pick(BACKSTORY_TPL, seedKey + '#backstory'), vars);

  const tierNote = ((): string => {
    if (useCatalog && catalog) {
      const rc = RARITY_CN[catalog.rarity] ?? catalog.rarity;
      return `${tier} 档 · ${rc}（${catalog.rarity}）· 出自预设目录「${catalog.name}」，一脉相承`;
    }
    const map: Record<string, string> = {
      L1: 'L1 档 · 预设直取，未命中目录时按参数化兜底',
      preset: 'preset 档 · 预设资产复用',
      L2: 'L2 档 · 参数化新造，由愿望现场推演，未入旧典，属原创凡品',
      L3: 'L3 档 · 代码档原创，Agent 现场撰作之孤本',
    };
    return map[tier] ?? '阶位未定 · 由愿望现场推演';
  })();

  const lore: AssetLore = {
    epithet, origin, appearance, powers, temperament,
    habitat, backstory, element, tierNote,
  };

  // 可见的 Agent 开发流水：五步，每步带实际信息，不是套话
  const steps: string[] = [
    `意图解析：愿望「${wish}」→ 名称=${safeSpec.name}，archetype=${safeSpec.archetype}，档位=${tier}；据 traits=[${traitsText}] 与 colors=[${colorHex}] 消歧。`,
    `设定撰写：成称号「${epithet}」，立五行${element}，列神通 ${powers.length} 条（${powers[0] ?? '—'}…）；出典取「${origin.slice(0, 24)}…」。`,
    `几何锻造：archetype=${safeSpec.archetype}，seed=${safeSpec.seed}，scale=${safeSpec.scale}，colors=[${colorHex}]；按「${ARCH_CN[safeSpec.archetype] ?? safeSpec.archetype}」部件谱生成可见网格，无随机数。`,
    `资产登记：以 id=${id} 写入登记本 ${STORAGE_KEY}，version=${VERSION}；同 id 覆盖、上限 ${MAX_ENTRIES} 条，绝不写入任何密钥。`,
    `热更新载入：把 ${safeSpec.name}（${tier}）就地挂载到玩家附近 dropPoint，无需刷新场景即可见于街市，可互动、可进化。`,
  ];

  const bp: AssetBlueprint = {
    id, wish, name: safeSpec.name, spec: safeSpec, lore,
    tier, version: VERSION, steps,
  };
  if (useCatalog && catalog) bp.catalog = catalog;
  return bp;
}

// ---- LLM 设定合并（可选增强）-------------------------------------------------
/** 把 unknown 收窄成普通对象；数组 / null / 基本类型一律拒绝 */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** 各字段长度上限（powers 另按条数限制） */
const LORE_LIMITS = {
  epithet: 60, origin: 200, appearance: 400, temperament: 80,
  habitat: 80, backstory: 400, element: 60, tierNote: 160,
} as const;

/**
 * 输入净化：剥离 HTML 标签 / 控制字符 / 归一换行，再做长度截断。
 * 存储层保留可读原文（不实体化），HTML 实体转义统一由 loreCardHtml 在输出时完成，
 * 避免同一段文本被二次转义。
 */
function sanitizeText(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const c = sanitizeText(v, max);
  return c || null;
}

/**
 * 把 LLM 返回的不定型 JSON 合并进已有设定：字段白名单、长度限制、净化转义。
 * 支持扁平 lore 对象或 { lore: {...} } 包装；失败 / 无有效字段时原样返回 bp。
 */
export function mergeLlmLore(bp: AssetBlueprint, raw: unknown): AssetBlueprint {
  try {
    const root = asRecord(raw);
    if (!root) return bp;
    const src = asRecord(root.lore) ?? root;

    const patch: Partial<AssetLore> = {};
    const e = cleanStr(src.epithet, LORE_LIMITS.epithet); if (e) patch.epithet = e;
    const o = cleanStr(src.origin, LORE_LIMITS.origin); if (o) patch.origin = o;
    const ap = cleanStr(src.appearance, LORE_LIMITS.appearance); if (ap) patch.appearance = ap;
    const te = cleanStr(src.temperament, LORE_LIMITS.temperament); if (te) patch.temperament = te;
    const ha = cleanStr(src.habitat, LORE_LIMITS.habitat); if (ha) patch.habitat = ha;
    const ba = cleanStr(src.backstory, LORE_LIMITS.backstory); if (ba) patch.backstory = ba;
    const el = cleanStr(src.element, LORE_LIMITS.element); if (el) patch.element = el;
    const tn = cleanStr(src.tierNote, LORE_LIMITS.tierNote); if (tn) patch.tierNote = tn;

    if (Array.isArray(src.powers)) {
      const list: string[] = [];
      for (const x of src.powers) {
        const c = cleanStr(x, 40);
        if (c) list.push(c);
        if (list.length >= 6) break;
      }
      if (list.length) patch.powers = list;
    }

    if (Object.keys(patch).length === 0) return bp;
    return { ...bp, lore: { ...bp.lore, ...patch } };
  } catch {
    return bp;
  }
}

// ---- 设定卡 HTML -------------------------------------------------------------
/**
 * 可直接 innerHTML 的设定卡片段；简单 class：.bp-card / .bp-title / .bp-row /
 * .bp-tag / .bp-steps；不含 <style> / <script>；所有动态文本经 escapeHtml 转义。
 */
export function loreCardHtml(bp: AssetBlueprint): string {
  const L = bp.lore;
  const row = (label: string, value: string): string =>
    `<div class="bp-row"><b>${label}</b><span>${escapeHtml(value)}</span></div>`;
  const tags = L.powers
    .map((p) => `<span class="bp-tag">${escapeHtml(p)}</span>`)
    .join('');
  const steps = bp.steps
    .map((s, i) => `<div class="bp-row"><b>${i + 1}</b><span>${escapeHtml(s)}</span></div>`)
    .join('');
  return [
    '<div class="bp-card">',
    `<div class="bp-title">${escapeHtml(bp.name)}` +
      `<span class="bp-tag">${escapeHtml(bp.tier)}</span>` +
      `<span class="bp-tag">v${bp.version}</span></div>`,
    row('称号', L.epithet),
    row('出典', L.origin),
    row('外形', L.appearance),
    `<div class="bp-row"><b>神通</b><span>${tags}</span></div>`,
    row('五行', L.element),
    row('性情', L.temperament),
    row('栖息', L.habitat),
    row('阶位', L.tierNote),
    row('背景', L.backstory),
    row('原话', bp.wish),
    row('编号', bp.id),
    `<div class="bp-steps">${steps}</div>`,
    '</div>',
  ].join('');
}

// ---- 开发资产登记本（localStorage / Node 内存降级，永不抛错）-------------------
let memoryStore: AssetBlueprint[] = [];
let memoryMode = false;

/** Node / vitest 无 localStorage 时返回 null，自动走内存存储；带 try/catch */
function storage(): Storage | null {
  if (memoryMode) return null;
  try {
    if (typeof localStorage === 'undefined') { memoryMode = true; return null; }
    return localStorage;
  } catch {
    memoryMode = true;
    return null;
  }
}

function isBlueprintLike(v: unknown): v is AssetBlueprint {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && o.id.length > 0
    && typeof o.name === 'string'
    && o.spec !== null && typeof o.spec === 'object'
    && o.lore !== null && typeof o.lore === 'object';
}

function readAll(): AssetBlueprint[] {
  try {
    const s = storage();
    if (!s) return memoryStore.slice();
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isBlueprintLike) as AssetBlueprint[]) : [];
  } catch {
    return memoryStore.slice();
  }
}

/**
 * 落盘前按白名单重建对象：只保留 AssetBlueprint 契约字段，任何额外字段
 * （尤其 apiKey / token / secret / authorization）都不会写入登记本。
 */
function sanitizeForStorage(bp: AssetBlueprint): AssetBlueprint {
  return {
    id: bp.id, wish: bp.wish, name: bp.name, spec: bp.spec, lore: bp.lore,
    tier: bp.tier, version: bp.version, steps: bp.steps,
    ...(bp.catalog ? { catalog: bp.catalog } : {}),
  };
}

function writeAll(list: AssetBlueprint[]): void {
  const s = storage();
  memoryStore = list.slice(); // 内存镜像：一旦降级可无缝衔接
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    memoryMode = true; // 写入失败（配额 / 隐私模式）→ 永久切内存态
  }
}

/**
 * 批量按 id 去重覆盖：先移除同 id 旧条目，再把新条目追加为「最新」；
 * 超出上限时保留最后 MAX_ENTRIES 条（丢最旧）。返回实际处理的条目数。
 */
function upsertMany(bps: AssetBlueprint[]): number {
  const seen = new Set<string>();
  const unique: AssetBlueprint[] = [];
  for (const bp of bps) {
    if (!bp || !bp.id || seen.has(bp.id)) continue;
    seen.add(bp.id);
    unique.push(bp);
  }
  if (!unique.length) return 0;
  const list = readAll().filter((b) => !seen.has(b.id));
  for (const bp of unique) list.push(sanitizeForStorage(bp));
  const next = list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list;
  writeAll(next);
  return unique.length;
}

/** 按 id 去重覆盖，最多存 200 条；全程 try/catch，永不抛错 */
export function registerBlueprint(bp: AssetBlueprint): void {
  try { upsertMany([bp]); } catch { /* 永不抛错 */ }
}

/** 列出全部已登记资产（返回副本） */
export function listBlueprints(): AssetBlueprint[] {
  try { return readAll(); } catch { return []; }
}

/** 按 id 或 name 精确查找，找不到返回 null */
export function findBlueprint(nameOrId: string): AssetBlueprint | null {
  try {
    const q = (nameOrId ?? '').trim();
    if (!q) return null;
    const list = readAll();
    return list.find((b) => b.id === q) ?? list.find((b) => b.name === q) ?? null;
  } catch {
    return null;
  }
}

/** 已登记资产条数 */
export function blueprintCount(): number {
  try { return readAll().length; } catch { return 0; }
}

/** 导出为 JSON 字符串 */
export function exportBlueprints(): string {
  try { return JSON.stringify(readAll()); } catch { return '[]'; }
}

/** 导入 JSON 数组，返回经校验并写入的条目数；非法输入返回 0 */
export function importBlueprints(json: string): number {
  try {
    if (typeof json !== 'string' || !json.trim()) return 0;
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return 0;
    const valid = parsed.filter(isBlueprintLike) as AssetBlueprint[];
    if (!valid.length) return 0;
    return upsertMany(valid);
  } catch {
    return 0;
  }
}

/** 清空登记本 */
export function clearBlueprints(): void {
  try { writeAll([]); } catch { /* 永不抛错 */ }
}
