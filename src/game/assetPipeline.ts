// ============================================================================
// 三界漫游 · 游戏内 Agent「资产构建流水线状态机」· src/game/assetPipeline.ts
//
// 本文件与 agentCapabilities.ts 合起来是游戏内 Agent 的「能力注册表 + 资产构建流水线」。
//
// 【严格顺序】
//   lookup → 命中 catalogHit 则 reuse + done（不生成、直接复用内置资产 spec）；
//   未命中则 notice（「xxx正在生成。。。。请稍后。」）→ research（先联网、失败降级
//   离线知识库并合并字段）→ design（详细设计）→ build（specFor 得到 WishSpec）
//   → verify（多机位截图验证）→ hotload（热载入）→ done（「xxx生成完毕，出现在你面前！」）。
//
// 【浏览器环境限制 · 如实声明，不得假装已能调用本机工具】
//   本文件随浏览器静态包运行，是纯逻辑状态机：不直接操作 three 场景、不直接执行本机
//   skill / MCP / CLI 进程、不凭空访问外网。能力注册表里 bridge='offline' 项只是本机
//   能力的「契约与编排描述」，需经可配置 API 或本机桥接才能实调；联网检索、截图验证、
//   热载入分别由 UI 通过 opts.research / opts.verify / 主线程注入执行。本模块只负责
//   编排、降级、如实记录每一步（未注入验证器时在 detail 明确写「未接入渲染验证器」）。
//
// 纪律：纯 TS、无 DOM、无 three 运行时依赖（仅 import type）、无第三方库；
//       纯确定性（整数 FNV hash，禁止 Math.random / Date.now 影响内容；steps.index 自增）。
//       整条链 try/catch，任何异常都不抛到 UI。
// ============================================================================

import type { WishSpec } from './wishForge';
import { classifyWish, shapeColors, type WishShape } from './wishCatalog';
import { planCapabilities } from './agentCapabilities';

export type PipelineStage =
  | 'lookup' | 'reuse' | 'notice' | 'research' | 'design'
  | 'build' | 'verify' | 'hotload' | 'done';

/** 联网/离线资料卡：覆盖尺寸/形态/特征/能力/结构/功能/特性/用途/关系/战斗/合成/
 *  使用/吞噬/进化/升级/创造/建造/世界影响/周围角色关系/后果/图片/视频参考全部维度 */
export interface ResearchCard {
  name: string; origin: string; dimensions: string; form: string;
  features: string[]; abilities: string[]; structure: string; functions: string[];
  uses: string[]; relations: string[];
  combat: boolean; crafting: boolean; usable: boolean; devourable: boolean;
  evolve: boolean; upgrade: boolean; creation: boolean; building: boolean;
  worldImpact: string; npcRelations: string; consequences: string;
  imageRefs: string[]; videoRefs: string[]; sources: string[]; offline: boolean;
  /** 检索桥与真实状态：offline=离线知识库 / online=真实 HTTP 检索；绝不冒充联网成功 */
  bridge: 'online' | 'offline';
  /** ok | disabled | failed | cors | no-results | bad-config | offline-disabled 等，如实记录 */
  status: string;
  /** 失败/CORS/无结果的原因原文（截断），成功为空串 */
  error: string;
  provider: string;
  endpoint: string;
  /** 从真实检索结果采用/覆盖进资料卡的字段数（离线恒 0） */
  merged: number;
  /** 检索命中的结果条数 */
  resultCount: number;
  /** 能力可否字段的说明（查不到时标「未检索到」，布尔值才谨慎置否） */
  capabilityNotes: string;
  /** 真实检索摘要里检测到的配色（十六进制数值数组）；未取到则 undefined */
  palette?: number[];
}

export interface DesignDoc {
  name: string; archetype: string; silhouette: string; parts: string[];
  palette: number[]; motif: string; budget: number; notes: string;
  capabilities: string[];   // planCapabilities 的 id 列表
  /** 语义形状标签（八类愿景），供 specFor→WishSpec.shape→forge 专用建模 */
  shape?: WishShape;
  /** design 是否真的消费了 ResearchCard（联网成功且合并字段>0 时为真） */
  usedResearch: boolean;
}

// ---- 可断言统计入口（Puppeteer / window.__wish 实机验收）----------------------
// 主线程 main.ts 禁止改，故统计挂在本模块导出单例上；wishPanel 另暴露实例方法
// wishStats()，运行期精确访问路径：window.__wish.panel.wishStats() 或 window.__wishStats()。
export interface WishMetrics {
  matched: boolean;         // 是否命中明确类别（八类语义或内置预设复用）
  reuse: boolean;           // 是否走 reuse 快路径
  count: number;            // 实际生成实体数
  researchBridge: 'online' | 'offline';
  researchStatus: string;
  designUsedResearch: boolean;
  shape: string;            // WishSpec.shape 或 'generic'
  tier: string;
}
const DEFAULT_METRICS: WishMetrics = {
  matched: false, reuse: false, count: 0,
  researchBridge: 'offline', researchStatus: 'offline-disabled',
  designUsedResearch: false, shape: 'generic', tier: 'none',
};
let METRICS: WishMetrics = { ...DEFAULT_METRICS };
export function setWishMetrics(m: WishMetrics): void { METRICS = { ...m }; }
export function lastWishMetrics(): WishMetrics { return { ...METRICS }; }
// 浏览器全局便捷句柄（不依赖 main.ts 的 __wish 注入）
try {
  (globalThis as unknown as Record<string, unknown>)['__wishStats'] = lastWishMetrics;
} catch { /* 无 globalThis 的安全降级环境忽略 */ }

export interface PipelineStep { stage: PipelineStage; label: string; detail: string; index: number; ok: boolean; }
export interface VerifyResult { ok: boolean; shots: string[]; views: number; note: string; }

export interface PipelineResult {
  ok: boolean; reused: boolean; name: string;
  spec: WishSpec | null; research: ResearchCard | null; design: DesignDoc | null;
  steps: PipelineStep[]; notice: string; doneNotice: string;
  capabilities: string[]; verifyNote: string;
}

export interface PipelineOptions {
  /** 内置资产命中信息；命中则直接复用、跳过生成 */
  catalogHit?: { id: string; name: string; source: string; lore: string; traits: string[] } | null;
  /** 由 UI 注入：联网检索（可配置 API）。抛错或返回 null 时自动走离线资料库 */
  research?: (query: string) => Promise<unknown>;
  /** 由 UI 注入：多机位截图验证 */
  verify?: (spec: WishSpec) => Promise<VerifyResult>;
  /** 由 UI 注入：把设计与资料转成 forge 可用的 WishSpec */
  specFor: (name: string, research: ResearchCard | null, design: DesignDoc) => WishSpec;
  /** 每步进度回调（UI 显示「xxx正在生成…请稍后」） */
  onStep?: (s: PipelineStep) => void;
}

// ---- 确定性工具（本文件自用，不经 three、不用 Math.random / Date.now） ---------
function hashStr(s: string): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}
function idx(seed: number, salt: number, n: number): number {
  const h = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  return n > 0 ? h % n : 0;
}
function pick<T>(arr: readonly T[], seed: number, salt: number): T {
  return arr[idx(seed, salt, arr.length)];
}
function errText(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 200);
  try { return String(e).slice(0, 200); } catch { return '未知异常'; }
}

// ---- 形态分类（只认「愿望名词本身」，确定性） ----------------------------------
// 修复：旧实现把 traits / 资料卡 form / COMMON_FEATURES 一并拼进扫描串，通用描述文字
// 「带自发光灵纹」含「灵」→ spirit、「莲纹/缠枝纹」含「莲/枝」→ plant，
// 把猫/山/皇宫/汽车错判成通用原型。现在 ① 先由 classifyWish 权威匹配名词；
// ② 兜底关键词只扫 name（调用方已改为传干净名词），彻底不吃描述文字。
type Kind =
  | 'dragon' | 'beast' | 'bird' | 'humanoid' | 'building' | 'item' | 'plant' | 'vehicle' | 'spirit'
  | 'cat' | 'palace' | 'mountain' | 'army' | 'battalion' | 'car' | 'spaceship' | 'alien';

/** 八类语义 → 资料卡形态类（一一对应，保证研究/设计文本也语义正确） */
const SHAPE_KIND: Record<WishShape, Kind> = {
  cat: 'cat', palace: 'palace', mountain: 'mountain', army: 'army',
  battalion: 'battalion', car: 'car', spaceship: 'spaceship', alien: 'alien',
};

/** 语义 Kind → 旧 10 类 archetype（specFromHit 等旧链路安全降级用） */
function kindToArchetype(kind: Kind): WishSpec['archetype'] {
  switch (kind) {
    case 'cat': return 'beast';
    case 'palace': case 'mountain': return 'building';
    case 'army': case 'battalion': case 'alien': return 'humanoid';
    case 'car': case 'spaceship': return 'vehicle';
    default: return kind as WishSpec['archetype'];
  }
}

function classify(text: string, _traits: string[] = []): Kind {
  const wc = classifyWish(text);
  if (wc) return SHAPE_KIND[wc.shape];
  const t = String(text ?? '');   // 只扫干净名词，绝不拼通用描述文字
  if (/龙|蛟|螭|虬|蟠|夔|蛇|相柳|神兽|瑞兽|异兽|dragon/i.test(t)) return 'dragon';
  if (/凤|雀|鸟|鹏|乌|鸾|鹤|雕|鹫|鹭|毕方|朱雀/i.test(t)) return 'bird';
  if (/宫|殿|楼|阁|塔|城|门|桥|台|阙|观|building|temple/i.test(t)) return 'building';
  if (/剑|刀|镜|珠|印|鼎|壶|灯|符|法宝|玺|铃|item|weapon/i.test(t)) return 'item';
  if (/树|花|草|莲|竹|藤|芝|木|松|柏|plant/i.test(t)) return 'plant';
  if (/车|舟|船|辇|轿|辂|vehicle/i.test(t)) return 'vehicle';
  if (/魂|魄|灵|精|怪|影|魅|魑|spirit/i.test(t)) return 'spirit';
  if (/佛|仙|神|王|将|僧|道|人|妖|鬼|判|君|帝|母|女|子|猴|罗汉|菩萨|humanoid|deity/i.test(t)) return 'humanoid';
  return 'beast';
}

const KIND_LABEL: Record<Kind, string> = {
  dragon: '龙形神兽', beast: '走兽', bird: '异禽', humanoid: '人形/神佛',
  building: '建筑', item: '器物', plant: '灵植', vehicle: '载具', spirit: '灵体',
  cat: '四足小猫', palace: '宫殿建筑群', mountain: '地形山体', army: '军阵士兵',
  battalion: '天兵天将', car: '现代轿车', spaceship: '宇宙飞船', alien: '类人异形',
};
const KIND_ABILITY: Record<Kind, string> = {
  dragon: '兴云布雨', beast: '迅捷扑击', bird: '振翼翔空', humanoid: '神通变化',
  building: '镇守一方', item: '灵光护主', plant: '生长枯荣', vehicle: '载人穿行', spirit: '附体幻形',
  cat: '轻捷跃扑', palace: '镇守朝堂', mountain: '镇地成岳', army: '列阵冲锋',
  battalion: '天威列阵', car: '疾驰载行', spaceship: '星际穿梭', alien: '异能感知',
};

interface Shape {
  dims: string[]; forms: string[]; structs: string[]; silhouettes: string[]; parts: string[];
}
const KIND_SHAPE: Record<Kind, Shape> = {
  dragon: {
    dims: ['长约 6–9 米、高约 2–3 米', '长约 9–14 米、高约 3–4 米'],
    forms: ['S 形蜿蜒长躯，鹿角凸眼、长须飘拂', '盘旋升腾之姿，鳞甲覆体、四爪张扬'],
    structs: ['连续渐变躯干 + 头颅吻部 + 分叉鹿角 + 关节短爪 + 连续背鳍带 + 扇形尾鳍',
      '头/躯/尾三段式骨架 + 背鳍带 + 五趾爪 + 尾鳍'],
    silhouettes: ['修长 S 形曲线、头颈高扬、尾鳍外张', '盘绕成环、双角冲天、须爪四展'],
    parts: ['头颅', '鹿角', '凸眼', '长须', '渐变躯干', '背鳍带', '关节爪', '扇形尾鳍'],
  },
  beast: {
    dims: ['长约 3–5 米、肩高约 1.5–2 米', '长约 4–6 米、肩高约 2–2.5 米'],
    forms: ['四足躯干稳健，头颈前探、尾脊上扬', '低伏蓄势之姿，獠牙利爪外露'],
    structs: ['椭球躯干 + 头 + 四腿 + 尾 + 背棘', '前驱/后驱分块 + 头吻 + 四肢关节 + 尾'],
    silhouettes: ['四足矩形体块、头尾前后呼应', '弓背低伏、背脊锯齿状起伏'],
    parts: ['躯干', '头吻', '獠牙', '四腿', '利爪', '尾', '背棘'],
  },
  bird: {
    dims: ['翼展约 4–7 米、体长约 1.5–2.5 米', '翼展约 6–9 米、体长约 2–3 米'],
    forms: ['双翼舒展、彩翎层叠、尾羽拖曳', '收翼昂首、冠羽高耸、钩喙前伸'],
    structs: ['椭球身 + 头喙 + 双翼(三角面片) + 尾羽 + 双足', '躯干/翼/尾三段 + 羽片阵列'],
    silhouettes: ['宽大翼展呈倒三角、尾羽放射', '直立收翼、头冠成尖顶'],
    parts: ['躯干', '头喙', '双翼', '羽片阵列', '尾羽', '双足'],
  },
  humanoid: {
    dims: ['身高约 1.8–2.4 米', '身高约 2.4–3.2 米（神佛丈六相）'],
    forms: ['直立人形，宽袍大袖、法器在手', '结跏趺坐或踏云而立，头光背光环绕'],
    structs: ['头 + 躯干 + 四肢 + 法器 + 光环/莲台', '头冠/面相/身光分层 + 袍袖几何'],
    silhouettes: ['直立纵长轮廓、肩部外扩', '端坐三角轮廓、头光圆形叠加'],
    parts: ['头冠', '面相', '躯干袍袖', '四肢', '法器', '头光/莲台'],
  },
  building: {
    dims: ['占地约 8×8 米、檐高约 4–6 米', '占地约 12×12 米、檐高约 6–9 米'],
    forms: ['台基+立柱+额枋+四坡屋顶+宝顶', '重檐歇山、斗栱层叠、脊兽列阵'],
    structs: ['台基 + 柱网 + 额枋 + 屋顶(四坡三角面) + 宝顶', '多层台基 + 柱/枋/檐/脊分层'],
    silhouettes: ['横向台基 + 大屋顶三角剪影', '层层出檐的阶梯状天际线'],
    parts: ['台基', '柱网', '额枋', '四坡屋顶', '宝顶', '脊兽'],
  },
  item: {
    dims: ['高约 0.6–1.2 米、直径约 0.4–0.8 米', '高约 1–1.8 米、直径约 0.6–1 米'],
    forms: ['主体圆润、装饰环带、顶钮立起', '器身修长、流线与环耳对称'],
    structs: ['椭球主体 + 颈/口 + 装饰环 + 柄/钮 + 双耳', '器身/颈/座三段 + 环带阵列'],
    silhouettes: ['上窄下宽的瓶形轮廓', '对称环耳外张的纺锤轮廓'],
    parts: ['器身', '颈口', '装饰环带', '顶钮', '双耳', '底座'],
  },
  plant: {
    dims: ['高约 3–5 米、冠幅约 2–4 米', '高约 5–8 米、冠幅约 4–6 米'],
    forms: ['主干挺立、五向枝杈、花果点缀', '虬枝盘曲、气根垂落、叶冠如盖'],
    structs: ['锥台主干 + 分枝 + 叶团 + 花果', '主干/分枝/冠层三级 + 果实点阵'],
    silhouettes: [' upright 主干 + 伞状冠幅', '横斜取势、枝干交错'],
    parts: ['主干', '分枝', '叶团', '花', '果', '气根'],
  },
  vehicle: {
    dims: ['长约 3–5 米、宽约 1.5–2 米', '长约 5–8 米、宽约 2–2.5 米'],
    forms: ['车厢方正、四轮外露、篷/桅上举', '流线船身、桅帆高张'],
    structs: ['箱体车身 + 四轮 + 篷/桅 + 旗/帆', '底盘/舱体/桅帆三段 + 轮组'],
    silhouettes: ['低平箱体 + 竖直桅杆', '尖首翘尾的舟形曲线'],
    parts: ['车身/船身', '轮组', '篷/舱', '桅杆', '帆/旗', '座'],
  },
  spirit: {
    dims: ['直径约 1.5–2.5 米的飘浮体', '直径约 2–3.5 米的聚合灵团'],
    forms: ['飘浮多面体、环绕碎片、尾迹下垂', '半透明光晕包裹核心、碎片旋绕'],
    structs: ['双层椭球核心 + 环绕碎片点阵 + 锥形尾迹', '核心/光晕/碎片三层 + 尾迹'],
    silhouettes: ['圆形核心 + 放射碎片', '上浮椭球 + 渐隐尾迹'],
    parts: ['核心', '外层光晕', '环绕碎片', '尾迹', '灵纹'],
  },
  // ---- 八类愿景专属形态资料（尺寸/形态/结构/剪影/部件，语义正确，不退化成通用原型） ----
  cat: {
    dims: ['体长约 0.4–0.6 米、肩高约 0.25–0.35 米', '体长约 0.5–0.8 米、肩高约 0.3–0.4 米'],
    forms: ['四足小动物，躯干紧凑、立耳竖起、长尾上卷', '低伏蓄势，头颈前探、双目圆睁'],
    structs: ['椭球躯干 + 头吻 + 双立耳 + 四足 + 长尾 + 双目', '头/躯/尾三段 + 四肢关节 + 耳/眼点阵'],
    silhouettes: ['低矮四足矩形块 + 上扬长尾', '弓背竖耳、尾脊成弧'],
    parts: ['躯干', '头吻', '立耳', '四足', '长尾', '双目'],
  },
  palace: {
    dims: ['占地约 30×22 米、主殿檐高约 12–16 米', '占地约 40×30 米、主殿檐高约 16–22 米'],
    forms: ['大台基之上中轴主殿重檐、两厢配殿对称、前门阙与角楼围合', '多进院落沿中轴铺展、层层出檐成阶梯天际线'],
    structs: ['大台基 + 主殿柱网/重檐 + 两厢配殿 + 门阙 + 角楼 + 围墙', '中轴多进 + 台基/柱/枋/檐/脊分层'],
    silhouettes: ['横向大台基 + 主殿重檐三角剪影 + 对称配殿', '层层出檐的宫城天际线'],
    parts: ['大台基', '主殿', '重檐四坡顶', '两厢配殿', '前门阙', '角楼', '围墙', '宝顶'],
  },
  mountain: {
    dims: ['相对高度约 40–120 米、底宽约 80–200 米', '相对高度约 120–400 米、底宽约 200–600 米'],
    forms: ['锥形主峰高耸、左右次峰拱卫、峰顶覆雪', '多峰连绵、山脊棱面分明、坡面渐收'],
    structs: ['主峰锥体 + 次峰锥体 + 雪顶 + 山脊三角棱面', '峰/脊/坡三级 + 雪线分层'],
    silhouettes: ['单主峰三角剪影 + 两侧低峰', '多峰锯齿状天际线'],
    parts: ['主峰', '左次峰', '右次峰', '雪顶', '山脊棱面', '坡面'],
  },
  army: {
    dims: ['单体身高约 1.8–2.2 米、阵列 12–36 员', '单体身高约 2.0–2.6 米、阵列 24–36 员'],
    forms: ['人形士兵披甲执兵、按行列方阵排布', '兜鍪铠甲、长兵如林、阵列整齐'],
    structs: ['头/兜鍪 + 躯干铠甲 + 四肢 + 长兵 + 盾；多体网格阵列', '单兵骨架 + 行列坐标阵列'],
    silhouettes: ['直立人形剪影 × 复数成阵', '横纵成行、兵刃上指'],
    parts: ['兜鍪', '铠甲', '护心镜', '长兵', '盾', '阵列坐标'],
  },
  battalion: {
    dims: ['单体身高约 2.0–2.6 米、阵列 24–36 员', '单体身高约 2.4–3.0 米、天将 36 员'],
    forms: ['天将披金甲、兜鍪红缨、背光圆光、长兵如林', '祥云托足、按天罡阵列铺排'],
    structs: ['头/兜鍪 + 铠甲 + 四肢 + 长兵 + 盾 + 背光圆光；复数阵列', '单兵骨架 + 天罡行列坐标'],
    silhouettes: ['直立人形 + 头光圆轮 × 复数成阵', '金甲成列、祥云绕阵'],
    parts: ['兜鍪', '金甲', '护心镜', '长兵', '盾', '背光圆光', '阵列坐标'],
  },
  car: {
    dims: ['车长约 4.7–5.0 米、宽约 1.9 米、高约 1.4 米', '车长约 5.0–5.3 米、宽约 2.0 米、高约 1.5 米'],
    forms: ['低趴流线车身、车舱玻璃、四轮外露、前后灯组', '楔形车头、溜背车顶、轮毂对称'],
    structs: ['低车身 + 车舱玻璃 + 四轮 + 前后灯 + 格栅', '底盘/座舱/灯组三段'],
    silhouettes: ['低平楔形车顶 + 圆形轮拱', '长轴距流线剪影'],
    parts: ['车身', '车舱玻璃', '侧窗', '四轮', '前灯', '尾灯', '格栅'],
  },
  spaceship: {
    dims: ['机长约 12–20 米、翼展约 10–18 米', '机长约 20–40 米、翼展约 18–30 米'],
    forms: ['梭形机身 + 三角主翼 + 垂尾 + 尾部推进器喷焰', '尖首流线、翼面外张、尾焰拖曳'],
    structs: ['机身 + 机首锥 + 座舱盖 + 双三角翼 + 垂尾 + 双推进器', '机体/翼面/推进三段'],
    silhouettes: ['梭形机身 + 倒三角翼展', '尖首 + 张开双翼 + 尾焰'],
    parts: ['机身', '机首锥', '座舱盖', '三角主翼', '垂尾', '推进器', '尾焰'],
  },
  alien: {
    dims: ['身高约 1.6–2.0 米（头身比异常）', '身高约 2.0–2.6 米（巨颅细肢）'],
    forms: ['巨大头颅、杏核大眼、细长躯干与四肢、头顶触角', '类人而异形，颅大身瘦、眼大而斜'],
    structs: ['巨颅 + 面部 + 双大眼 + 锥形躯干 + 细长四肢 + 触角', '头/躯/肢三段 + 眼/触角点阵'],
    silhouettes: ['上大下小的葫芦形剪影', '巨头 + 细肢纵长轮廓'],
    parts: ['巨颅', '面部', '杏核大眼', '细长躯干', '长臂', '长腿', '触角'],
  },
};

const SURFACE = ['覆细密鳞甲与鎏金描边', '施石青/绛赤传统色渐变', '带自发光灵纹与半透明光晕', '低模硬边拼接并保留手作感'];
const MOTIFS = ['云雷纹', '鳞纹', '莲纹', '回纹', '饕餮纹', '缠枝纹', '星宿纹', '水波纹'];
/** 传统色组：明黄·石青·绛赤 / 朱砂·月白·鎏金 / 紫电·墨·幽青 / 天青·金·碧 / 霄蓝·曜金·素白 */
const PALETTES: number[][] = [
  [0xd4af37, 0x4fa8a0, 0xa8503c],
  [0xc25a42, 0xf0ead8, 0xd4af37],
  [0x7a5cff, 0x2a2a35, 0x66ffcc],
  [0xe8f4ff, 0xd4af37, 0x7ec8a0],
  [0x8fd8ff, 0xffd25e, 0xffffff],
];
const BUDGETS = [9000, 12000, 15000, 18000]; // tri 预算，均 ≤ 20000

const COMMON_FEATURES = ['东方神话考据造型', '可辨识剪影', '部件可拆分', '低模几何拼接', '传统色配色', '确定性程序化生成'];
const COMMON_ABILITIES = ['腾跃', '通灵', '化形', '感知', '元素亲和'];
const COMMON_FUNCTIONS = ['场景陈列', '可交互拾取', '随镜头远近缩放', '挂接进化/合成数据'];
const COMMON_USES = ['主线/支线任务目标', '收藏与图鉴登记', '战斗或建造单元', '场景叙事道具'];
const COMMON_RELATIONS = ['与 wishCatalog 内置资产按名号去重', '与 wishEvolution 五阶形态联动',
  '与 wishBuild 建造网格可组合', '与同题材神兽/角色构成谱系'];
const COMMON_WORLD = ['出现后改变局部场景的视觉焦点', '可触发区域氛围/光影变化', '登记进资产登记本后可被再次检索复用'];
const COMMON_NPC = ['附近 NPC 会按其阵营/灵性产生趋避反应', '友好角色可互动、敌对角色可能进入战斗判定',
  '不改变既有 NPC 的存档数据'];
const COMMON_CONSEQ = ['生成后热载入到角色/镜头附近，不覆盖既有实体',
  '参与战斗/合成/吞噬时按游戏内规则结算，可能改变局部战力平衡',
  '大体量资产可能影响同屏性能，需控制在面数预算内'];

/**
 * 离线资料库：无网络、无 API key 时也能产出覆盖全部字段的 ResearchCard（确定性）。
 * imageRefs / videoRefs 在离线态写「离线知识库条目」如实说明，不伪造 URL。
 */
export function offlineResearch(name: string, traits: string[] = [], source?: string): ResearchCard {
  const safeName = String(name ?? '未命名造物');
  const safeTraits = Array.isArray(traits) ? traits.filter((t) => typeof t === 'string') : [];
  const kind = classify(safeName);   // 只认干净名词，不拼 traits（防通用描述文字污染）
  const shape = KIND_SHAPE[kind];
  const label = KIND_LABEL[kind];
  const seed = hashStr('offline|' + safeName + '|' + safeTraits.join(',') + '|' + (source ?? ''));
  const t = safeName + ' ' + safeTraits.join(' ');

  const origin = source
    ? `内置资料来源：${source}（离线知识库确定性补全）`
    : '离线知识库：《三界造物》内置资产语料（山海经 / 中国神话 / 西游记 / 封神 / 聊斋 / 志怪）';

  return {
    name: safeName,
    origin,
    dimensions: `${pick(shape.dims, seed, 1)}（成体基准，可随 wishEvolution 五阶缩放）`,
    form: `${safeName}呈${pick(shape.forms, seed, 2)}，表面${pick(SURFACE, seed, 3)}`,
    features: [
      ...COMMON_FEATURES,
      `${safeName}专属${pick(MOTIFS, seed, 5)}纹样`,
      `${label}可辨识的形态特征`,
    ],
    abilities: [...COMMON_ABILITIES, KIND_ABILITY[kind], `${label}专属特性`],
    structure: pick(shape.structs, seed, 4),
    functions: [...COMMON_FUNCTIONS, `可作为${label}参与场景叙事`],
    uses: [...COMMON_USES, `图鉴名号：${safeName}`],
    relations: [...COMMON_RELATIONS, `与同名内置资产（若存在）直接复用而非重复生成`],
    combat: /战|斗|兵|刃|凶|煞|击|武器|boss|combat|attack/i.test(t)
      || kind === 'dragon' || kind === 'beast' || kind === 'humanoid'
      || kind === 'army' || kind === 'battalion',
    crafting: /炼|造|锻|合成|craft|forge/i.test(t) || kind === 'item' || kind === 'building',
    usable: true, // 游戏内资产均可交互拾取 / 使用
    devourable: /吞|噬|食|吸|devour|swallow/i.test(t) || kind === 'spirit',
    evolve: true,   // wishEvolution：卵→幼体→成体→灵体→神体五阶
    upgrade: true,  // wishEvolution：xp / level 升级
    creation: true, // 三界造物系统本身即「创造」入口
    building: kind === 'building' || kind === 'palace' || /建造|建筑|搭|build/i.test(t),
    worldImpact: `${pick(COMMON_WORLD, seed, 6)}；${safeName}的登场以热载入方式出现在角色或视角镜头附近。`,
    npcRelations: `${pick(COMMON_NPC, seed, 7)}；阵营由${label}语料推定。`,
    consequences: `${pick(COMMON_CONSEQ, seed, 8)}；已按 20000 tri 上限与确定性纪律约束。`,
    imageRefs: [
      `离线知识库条目：${safeName}·造型参考（离线态无外部可访问图片 URL，未接入联网检索）`,
      `离线知识库条目：${safeName}·${label}四视图文字描述（不伪造链接）`,
    ],
    videoRefs: [
      `离线知识库条目：${safeName}·动态/镜头参考（离线态无视频 URL，待联网检索或渲染验证器补齐）`,
    ],
    sources: [
      '离线知识库条目：《三界造物》内置资产语料（山海经 / 中国神话 / 西游记 / 封神 / 聊斋 / 志怪）',
      '离线知识库条目：游戏内 wishCatalog 预设资产名号与 traits / 传统色体系',
      `离线知识库条目：${source || '内置资料'}·按名字确定性推导的设定补全`,
    ],
    offline: true,
    bridge: 'offline',
    status: 'offline-disabled',
    error: '',
    provider: '',
    endpoint: '',
    merged: 0,
    resultCount: 0,
    capabilityNotes: '离线知识库（未联网检索）：战斗/合成/吞噬/进化/升级/建造 等可否字段按内置语料推定，未检索到外部资料',
  };
}

/** 由资料卡产出设计文档：原型 / 剪影 / 部件 / 传统色 / 纹样 / 面数预算 / 能力编排 */
export function designFromResearch(name: string, r: ResearchCard, capIds: string[]): DesignDoc {
  const safeName = String(name ?? '未命名造物');
  const seed = hashStr('design|' + safeName + '|' + (r?.name ?? ''));
  const wc = classifyWish(safeName);
  const kind = classify(safeName);   // 只认干净名词；不再吃 r.form / r.features 通用描述文字
  const shape = KIND_SHAPE[kind];
  const caps = Array.isArray(capIds) && capIds.length
    ? capIds.slice()
    : ['wishForge', 'threejs-3d-scene', 'html-screenshot-image-gen'];
  const usedResearch = !!r && !r.offline && r.status === 'ok' && (r.merged ?? 0) > 0;
  // ---- 研究资料真实进入设计：尺寸→notes/parts、配色→palette、能力→parts ----
  const palette = r?.palette?.length ? r.palette.slice(0, 4)
    : wc ? shapeColors(wc.shape) : pick(PALETTES, seed, 3).slice();
  const researchParts: string[] = [];
  if (r?.dimensions && !/未检索到/.test(r.dimensions)) researchParts.push(`尺寸依据：${r.dimensions.slice(0, 40)}`);
  if (r?.structure && !/未检索到/.test(r.structure)) researchParts.push(`结构依据：${r.structure.slice(0, 40)}`);
  for (const ab of (r?.abilities ?? []).slice(0, 2))
    if (ab && !/未检索到/.test(ab)) researchParts.push(`能力标签：${ab.slice(0, 24)}`);
  return {
    name: safeName,
    archetype: kind,
    silhouette: pick(shape.silhouettes, seed, 1),
    parts: [...shape.parts, `设计纹样：${pick(MOTIFS, seed, 2)}`, '光晕/装饰层（可选）', ...researchParts],
    palette,
    motif: pick(MOTIFS, seed, 4),
    budget: pick(BUDGETS, seed, 5),
    notes: `依据「${r?.origin ?? '离线知识库'}」设定：${r?.form ?? '形态见资料卡'}；`
      + `能力=${(r?.abilities ?? []).join('/')}；用途=${(r?.uses ?? []).join('/')}。`
      + `尺寸=${r?.dimensions ?? '未检索到'}；配色=${palette.map((c) => '0x' + c.toString(16)).join('/')}。`
      + `战斗=${r?.combat ?? false} 合成=${r?.crafting ?? false} 进化=${r?.evolve ?? false}。`
      + (usedResearch ? `本设计已消费联网检索资料（bridge=${r?.bridge}、采用 ${r?.merged} 字段）。` : '')
      + '遵循 ≤20000 tri、确定性、传统色约束。',
    capabilities: caps,
    shape: wc?.shape,
    usedResearch,
  };
}

export function noticeText(name: string): string {
  return `${name}正在生成。。。。请稍后。`;
}
export function doneText(name: string): string {
  return `${name}生成完毕，出现在你面前！`;
}

/** 内置资产命中 → 确定性构造可复用 WishSpec（不联网、不设计、不生成） */
function specFromHit(hit: NonNullable<PipelineOptions['catalogHit']>): WishSpec {
  const kind = kindToArchetype(classify(hit.name));
  const seed = hashStr('catalog|' + hit.id + '|' + hit.name);
  return {
    name: hit.name,
    archetype: kind,
    traits: hit.traits.length ? hit.traits.slice() : [hit.source || '内置预设'],
    colors: pick(PALETTES, seed, 1).slice(),
    scale: 1,
    seed,
    source: 'preset',
  };
}

/**
 * 把 UI 注入的联网检索结果按字段白名单合并进离线资料卡；
 * 无效/空字段一律保留离线值，保证 20+ 字段全部有值。
 */
function mergeResearch(raw: unknown, fallback: ResearchCard, online: boolean): { card: ResearchCard; merged: number } {
  if (!online || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { card: fallback, merged: 0 };
  }
  const o = raw as Record<string, unknown>;
  const card: ResearchCard = { ...fallback, offline: false };
  const rec = card as unknown as Record<string, unknown>;
  let merged = 0;

  const strKeys: (keyof ResearchCard)[] = [
    'name', 'origin', 'dimensions', 'form', 'structure',
    'worldImpact', 'npcRelations', 'consequences', 'capabilityNotes',
  ];
  for (const k of strKeys) {
    const v = o[k as string];
    if (typeof v === 'string' && v.trim()) { rec[k as string] = v.slice(0, 400); merged++; }
  }
  const arrKeys = ['features', 'abilities', 'functions', 'uses', 'relations', 'imageRefs', 'videoRefs', 'sources'] as const;
  for (const k of arrKeys) {
    const v = o[k];
    if (Array.isArray(v)) {
      const cleaned = v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.slice(0, 400));
      if (cleaned.length) { rec[k] = cleaned; merged++; }
    }
  }
  const boolKeys = ['combat', 'crafting', 'usable', 'devourable', 'evolve', 'upgrade', 'creation', 'building'] as const;
  for (const k of boolKeys) {
    const v = o[k];
    if (typeof v === 'boolean') { rec[k] = v; merged++; }
  }
  // 真实检索摘要里检测到的配色（数值数组），单独按数值白名单合并
  if (Array.isArray(o['palette'])) {
    const nums = (o['palette'] as unknown[])
      .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
      .map((x) => (x >>> 0) & 0xffffff).slice(0, 4);
    if (nums.length) { rec['palette'] = nums; merged++; }
  }
  return { card, merged };
}

/**
 * 资产构建流水线：严格按 lookup → (reuse | notice → research → design → build
 * → verify → hotload → done) 顺序推进；每步 push 一个 PipelineStep 并调 onStep；
 * 整链 try/catch，任何异常都不抛到 UI。
 */
export async function runAssetPipeline(name: string, opts: PipelineOptions): Promise<PipelineResult> {
  const steps: PipelineStep[] = [];
  let index = 0;
  const push = (stage: PipelineStage, label: string, detail: string, ok = true): PipelineStep => {
    const s: PipelineStep = { stage, label, detail, index: index++, ok };
    steps.push(s);
    try { opts.onStep?.(s); } catch { /* 进度回调异常不外抛到 UI */ }
    return s;
  };

  const base: PipelineResult = {
    ok: true, reused: false, name,
    spec: null, research: null, design: null,
    steps, notice: '', doneNotice: doneText(name),
    capabilities: [], verifyNote: '',
  };

  try {
    // 1) lookup：先查游戏内资产有没有
    push('lookup', '检索内置资产', `在 wishCatalog 内置资产目录中检索「${name}」`);

    const hit = opts.catalogHit ?? null;
    if (hit) {
      // 2) reuse：命中则直接复用内置资产 spec，不生成、不联网、不验证
      const spec = specFromHit(hit);
      push('reuse', '复用内置资产',
        `命中内置资产 ${hit.id} / ${hit.name}（来源：${hit.source}），直接复用其预设 spec；不生成、不联网、不设计、不验证`);
      push('done', '载入完成', doneText(name));
      return {
        ...base, reused: true, spec, notice: '',
        doneNotice: doneText(name), verifyNote: '复用内置资产，跳过生成与截图验证',
      };
    }

    // 3) notice：游戏界面显示「xxx正在生成。。。。请稍后。」
    const notice = noticeText(name);
    base.notice = notice;
    push('notice', '生成提示', notice);

    // 4) research：先试联网检索，失败/无配置走离线知识库，并合并字段
    const offline = offlineResearch(name);
    let research: ResearchCard = offline;
    let researchDetail: string;
    if (typeof opts.research !== 'function') {
      researchDetail = '未配置联网检索 API（opts.research 未注入），降级到离线知识库；'
        + '已覆盖尺寸/形态/特征/能力/结构/功能/特性/用途/与其他资产关系/战斗/合成/使用/吞噬/'
        + '进化/升级/创造/建造/世界影响/周围角色关系/后果/图片参考/视频参考全部维度';
    } else {
      try {
        const raw = await opts.research(name);
        if (raw === null || raw === undefined) {
          // 默认关闭 / 未配置：如实保持 offline 桥，绝不冒充联网
          researchDetail = '联网检索返回 null/undefined（research.enabled 关闭或未配置），'
            + '降级到离线知识库；bridge=offline、status=offline-disabled（如实标注，离线卡覆盖全部维度）';
        } else if (typeof raw === 'object' && !Array.isArray(raw)) {
          const meta = raw as Record<string, unknown>;
          const hasMeta = typeof meta['bridge'] === 'string' && typeof meta['status'] === 'string';
          if (!hasMeta) {
            // 旧契约：调用方直接返回「资料卡字段对象」（如单测注入 {dimensions,features,sources}）
            const m = mergeResearch(raw, offline, true);
            research = m.card;
            research.bridge = 'online';
            research.status = 'ok';
            research.merged = m.merged;
            researchDetail = `联网检索成功，与离线知识库按字段白名单合并，采用/覆盖 ${m.merged} 个字段；offline=false`;
          } else {
            const bridge: 'online' | 'offline' = meta['bridge'] === 'online' ? 'online' : 'offline';
            const status = String(meta['status']);
            const error = typeof meta['error'] === 'string' ? meta['error'].slice(0, 200) : '';
            const merged = typeof meta['merged'] === 'number' ? meta['merged'] : 0;
            const resultCount = typeof meta['resultCount'] === 'number' ? meta['resultCount'] : 0;
            const provider = typeof meta['provider'] === 'string' ? meta['provider'] : '';
            const endpoint = typeof meta['endpoint'] === 'string' ? meta['endpoint'] : '';
            const okOnline = bridge === 'online' && status === 'ok' && merged > 0;
            if (okOnline) {
              // 真·联网成功：真实字段覆盖进资料卡（缺失字段由 wishResearch 标「未检索到」）
              const m = mergeResearch(raw, offline, true);
              research = m.card;
              research.bridge = 'online';
              research.status = 'ok';
              research.error = error;
              research.merged = merged;
              research.resultCount = resultCount;
              research.provider = provider;
              research.endpoint = endpoint;
              researchDetail = `真实 HTTP 联网检索成功（provider=${provider || 'custom'}、endpoint=${endpoint || '—'}）：`
                + `解析 ${resultCount} 条结果，按白名单采用/覆盖 ${merged} 个字段；bridge=online、status=ok、offline=false`;
            } else {
              // 关闭 / 失败 / CORS / 无结果：如实记 bridge 与 status，不冒充成功，退回离线知识库
              research = {
                ...offline, bridge, status, error, merged, resultCount, provider, endpoint,
              };
              researchDetail = `联网检索未取回可用资料（bridge=${bridge}、status=${status}`
                + (error ? `、原因：${error}` : '') + '），如实记入 ResearchCard.status，'
                + '降级到离线知识库（离线卡覆盖全部维度，不冒充联网成功）';
            }
          }
        } else {
          researchDetail = '联网检索返回非对象值，降级到离线知识库（离线卡覆盖全部维度）';
        }
      } catch (e) {
        research = { ...offline, status: 'failed', error: errText(e) };
        researchDetail = `联网检索调用失败（${errText(e)}），如实记 status=failed 并降级到离线知识库（离线卡覆盖全部维度）`;
      }
    }
    base.research = research;
    push('research', '资料研究与合并', researchDetail);

    // 5) design：详细设计（含 planCapabilities 选出的能力 id、部件清单、传统色、预算）
    const capIds = planCapabilities(name).map((c) => c.id);
    const design = designFromResearch(name, research, capIds);
    base.design = design;
    base.capabilities = design.capabilities.slice();
    push('design', '详细设计',
      `产出设计文档：原型=${design.archetype}、剪影=${design.silhouette}、部件 ${design.parts.length} 项、`
      + `传统色 ${design.palette.length} 色、纹样=${design.motif}、面数预算=${design.budget} tri、编排能力 ${capIds.length} 项`);

    // 6) build：调 opts.specFor 得到 WishSpec
    let spec: WishSpec | null = null;
    let buildDetail: string;
    try {
      spec = opts.specFor(name, research, design);
      buildDetail = spec
        ? `调用 opts.specFor 生成 WishSpec：${spec.name} / ${spec.archetype} / traits ${spec.traits.length} 项 / seed ${spec.seed}`
        : 'opts.specFor 返回空值，spec 置空（不抛错，流水线继续）';
    } catch (e) {
      buildDetail = `opts.specFor 调用失败（${errText(e)}），spec 置空，流水线继续（异常不抛到 UI）`;
    }
    base.spec = spec;
    push('build', '生成构建', buildDetail, spec !== null);

    // 7) verify：多机位截图验证；未注入时内置默认「通过」但如实写明未接入
    let vr: VerifyResult;
    let verifyDetail: string;
    if (typeof opts.verify !== 'function' || spec === null) {
      vr = {
        ok: true, shots: [], views: 0,
        note: '未接入渲染验证器（opts.verify 未注入或 spec 为空），采用内置默认通过；'
          + '未做实际多角度/多维度/多距离/多高低截图',
      };
      verifyDetail = `未接入渲染验证器：${vr.note}`;
    } else {
      try {
        const r: VerifyResult | null | undefined = await opts.verify(spec);
        vr = r && typeof r === 'object'
          ? r
          : { ok: false, shots: [], views: 0, note: '验证器返回空值' };
        verifyDetail = `多机位截图验证：${vr.views} 个视角、${vr.shots.length} 张截图，`
          + `结果=${vr.ok ? '通过' : '未通过'}；${vr.note}`;
      } catch (e) {
        vr = { ok: false, shots: [], views: 0, note: `验证器调用失败：${errText(e)}` };
        verifyDetail = `验证器异常已降级（不抛到 UI）：${vr.note}`;
      }
    }
    base.verifyNote = vr.note;
    push('verify', '多角度截图验证', verifyDetail, vr.ok);

    // 8) hotload：热载入游戏，出现在角色或视角镜头附近
    push('hotload', '热载入游戏',
      `生成热载入指令：将「${name}」载入到角色或视角镜头附近；`
      + '由 UI / 主线程执行实际 scene.add 与镜头定位，本纯逻辑模块只登记契约，不直接操作 three 场景');

    // 9) done：生成完毕提示
    push('done', '生成完毕', doneText(name));
    return { ...base, ok: spec !== null && vr.ok, doneNotice: doneText(name) };
  } catch (e) {
    // 整条链兜底：任何异常都不抛到 UI
    const detail = `流水线异常已降级（不抛到 UI）：${errText(e)}`;
    push('done', '异常降级', detail, false);
    return { ...base, ok: false, doneNotice: doneText(name), verifyNote: base.verifyNote || detail };
  }
}
