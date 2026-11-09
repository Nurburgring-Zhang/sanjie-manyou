// ============================================================================
// 三界造物 · 游戏内 Agent（融合终版垂直切片）· src/game/wishAgent.ts
//
// parseIntent：中文意图解析（量词 > 场景 > 会话偏好 消歧；黑名单早拒绝）
// resolveWish 三级：L1 命中预设目录直接复用 / L2 参数化按 archetype+traits 生成 spec
//   / L3 配置 API 时 fetch 兼容 OpenAI /chat/completions 取 JSON spec（8s 超时降级 L2）
// 离线纪律：无 key / 无网络纯离线可用；apiKey 只留配置存储，绝不进存档、绝不进日志。
// ============================================================================
import { matchCatalog, getById, classifyWish, shapeColors, type CatalogEntry, type Archetype } from './wishCatalog';
import type { WishSpec } from './wishForge';

// ---- Agent 配置（localStorage；Node 无 localStorage 时走内存态）----
export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}
const STORAGE_KEY = 'cyber-qingming.agent.v1';
const DEFAULT_CONFIG: AgentConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  enabled: false,
};
let memoryConfig: AgentConfig | null = null;

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
export function loadAgentConfig(): AgentConfig {
  const s = storage();
  if (!s) return memoryConfig ? { ...memoryConfig } : { ...DEFAULT_CONFIG };
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AgentConfig>) };
  } catch { return { ...DEFAULT_CONFIG }; }
}
/** 保存配置。注意：apiKey 绝不 console.log、绝不写进 rt/save.ts 存档 */
export function saveAgentConfig(patch: Partial<AgentConfig>): AgentConfig {
  const next = { ...loadAgentConfig(), ...patch };
  const s = storage();
  if (s) { try { s.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { memoryConfig = next; } }
  else memoryConfig = next;
  return next;
}

// ---- 确定性整数 hash（无 Math.random / Date.now）----
export function hashText(s: string): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}
function h01(seed: number, i: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- 黑名单：越界词直接 refuse（三段式话术 + 可达替代）----
const BLACKLIST = [
  '色情', '裸体', '性交', '强奸', '毒品', '冰毒', '海洛因', '制毒', '贩毒',
  '炸药', '炸弹', '枪支', '手枪', '杀人', '谋杀', '自杀', '恐怖袭击',
  '洗钱', '诈骗', '盗号', '黑客攻击', '翻墙', '国家领导人', '国家主席',
  '总统', '共产党', '台独', '港独', '分裂国家',
];
export function isRefused(text: string): boolean {
  return BLACKLIST.some((w) => text.includes(w));
}
const REFUSE_REASON =
  '这个愿望越界了（涉及现实伤害 / 违法 / 敏感内容），三界造物不予受理。' +
  '换个方向试试：「我要一条神龙」「来两只凤凰」「造一座亭子」。';

// ---- 量词 / 场景 / 名词 / 会话偏好 ----
const NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const QUANT_RE = /([一二两三四五六七八九十\d]+)\s*(条|只|头|匹|尾|座|栋|间|所|株|棵|丛|朵|把|柄|件|枚|颗|面|盏|顶|辆|艘|驾|乘|位|名|尊|团|缕|道|个)/;

export function parseCount(text: string): number {
  const m = text.match(QUANT_RE);
  if (!m) return 1;
  const raw = m[1];
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : (NUM[raw] ?? 1);
  return Math.max(1, Math.min(8, n || 1));
}
function quantArchetype(text: string): Archetype | null {
  const m = text.match(QUANT_RE);
  if (!m) return null;
  const q = m[2];
  if ('条'.includes(q)) return 'dragon';
  if ('座栋间所'.includes(q)) return 'building';
  if ('株棵丛朵'.includes(q)) return 'plant';
  if ('把柄件枚颗面盏顶'.includes(q)) return 'item';
  if ('辆艘驾乘'.includes(q)) return 'vehicle';
  if ('位名尊'.includes(q)) return 'deity';
  if ('团缕道'.includes(q)) return 'spirit';
  if ('只头匹尾'.includes(q)) return /凤|凰|鹤|鸟|雀|鹏|鸾|雕|鸦|鹰/.test(text) ? 'bird' : 'beast';
  return null;
}

const NOUN_RULES: { re: RegExp; a: Archetype }[] = [
  { re: /龙|蛟|螭|虬|蟠|蛇/, a: 'dragon' },
  { re: /凤|凰|鹤|鸟|雀|鹏|鸾|雕|鸦|鹰|鹂|羽/, a: 'bird' },
  { re: /虎|豹|狮|麟|兽|狐|狼|鹿|牛|马|貔|龟|貅|犬|象|熊|罴|豕|彘/, a: 'beast' },
  { re: /树|花|草|竹|莲|松|柳|藤|芝|木|叶|果|梅|兰|菊|荷/, a: 'plant' },
  { re: /亭|塔|楼|阁|桥|宫|殿|寺|观|院|坊|台|榭|廊|城|门/, a: 'building' },
  { re: /剑|刀|枪|棒|扇|镜|印|鼎|葫芦|珠|灯|伞|杖|锏|鞭|斧|戟|耙|铲/, a: 'item' },
  { re: /车|船|舟|轿|辇|筏|风筝/, a: 'vehicle' },
  { re: /鬼|魂|精|妖|魔|灵|魅|魍|魉|夜叉|罗刹/, a: 'spirit' },
  { re: /神|佛|仙|帝|王|菩萨|罗汉|将|师|僧|尊|真人|天尊|星君/, a: 'deity' },
  { re: /人|童|翁|女|士|侠|民|国/, a: 'humanoid' },
];
function nounArchetype(text: string): Archetype | null {
  for (const r of NOUN_RULES) if (r.re.test(text)) return r.a;
  return null;
}
const SCENE_RULES: { re: RegExp; a: Archetype }[] = [
  { re: /天宫|天庭|云端|九霄|凌霄/, a: 'deity' },
  { re: /地府|幽冥|冥界|阴曹|黄泉|丰都/, a: 'spirit' },
  { re: /山林|深山|荒野|洞府/, a: 'beast' },
  { re: /水里|河中|海底|江上|湖心/, a: 'dragon' },
];
function sceneArchetype(text: string): Archetype | null {
  for (const r of SCENE_RULES) if (r.re.test(text)) return r.a;
  return null;
}
let lastArchetype: Archetype = 'beast';

// ---- traits / colors / scale / name ----
const TRAIT_WORDS = [
  '赤红', '金色', '青碧', '玄黑', '银白', '紫气', '透明', '发光', '火焰', '寒冰',
  '雷霆', '流水', '祥云', '鳞甲', '灵光', '鎏金', '琉璃', '玉石', '玄铁', '幽冥', '长青', '锋刃', '飞檐',
];
const DEF_TRAITS: Record<Archetype, string[]> = {
  dragon: ['鳞甲', '腾云'], beast: ['利爪', '迅捷'], bird: ['羽翼', '彩翎'],
  humanoid: ['人形', '法器'], deity: ['祥光', '威仪'], plant: ['枝叶', '灵根'],
  building: ['飞檐', '台基'], item: ['纹饰', '灵光'], vehicle: ['轮辕', '雕饰'], spirit: ['幽冥', '幻化'],
};
function extractTraits(text: string, a: Archetype): string[] {
  const found = TRAIT_WORDS.filter((w) => text.includes(w));
  return Array.from(new Set([...found, ...DEF_TRAITS[a]]));
}
const COLOR_MAP: [string, number][] = [
  ['赤红', 0xa8503c], ['红', 0xa8503c], ['金', 0xd4af37], ['青', 0x4fa8a0], ['碧', 0x7ec8a0],
  ['玄', 0x2a2a35], ['黑', 0x2a2a35], ['白', 0xf0ead8], ['银', 0xcfd8e3], ['紫', 0x7a5cff],
  ['蓝', 0x3a8ab8], ['水', 0x3a8ab8], ['火', 0xc25a42], ['绿', 0x7ec8a0], ['彩', 0xffd25e],
];
const DEF_COLORS: Record<Archetype, number[]> = {
  dragon: [0xd4af37, 0x4fa8a0, 0xa8503c], beast: [0xd07a30, 0x8a6a42, 0x222222],
  bird: [0xc25a42, 0xf0ead8, 0xd4af37], humanoid: [0xcfd8e3, 0xa8503c, 0xd4af37],
  deity: [0xffd25e, 0xf0e6c8, 0x8fd8ff], plant: [0x4fa8a0, 0x7ec8a0, 0xffd25e],
  building: [0xa8503c, 0x2a4a5a, 0xd4af37], item: [0xd4af37, 0x8fd8ff, 0x7ec8a0],
  vehicle: [0x8a6a42, 0xa8503c, 0xd4af37], spirit: [0x7a5cff, 0x2a2a35, 0x66ffcc],
};
function colorsFrom(text: string, hit: CatalogEntry | null, a: Archetype): number[] {
  const out: number[] = [];
  for (const [w, c] of COLOR_MAP) if (text.includes(w) && !out.includes(c)) out.push(c);
  if (hit) for (const c of hit.colors) if (!out.includes(c)) out.push(c);
  if (!out.length) return [...DEF_COLORS[a]];
  return out.slice(0, 4);
}
const SCALE_BASE: Record<Archetype, number> = {
  dragon: 1.5, beast: 1.1, bird: 1.0, humanoid: 1.0, deity: 1.25,
  plant: 1.0, building: 1.5, item: 0.65, vehicle: 1.2, spirit: 0.95,
};
function scaleFor(a: Archetype, seed: number): number {
  return Math.round(SCALE_BASE[a] * (0.85 + h01(seed, 99) * 0.35) * 100) / 100;
}
function cleanName(text: string): string {
  let s = text;
  for (const p of ['我要', '给我', '来', '造', '做', '变', '召唤', '请', '帮我']) {
    if (s.startsWith(p)) { s = s.slice(p.length); break; }
  }
  s = s.replace(/^[一二两三四五六七八九十\d]+\s*[条只头匹尾座栋间所株棵丛朵把柄件枚颗面盏顶辆艘驾乘位名尊团缕道个]?/, '').trim();
  s = s.replace(/[，。！？、\s]/g, '').slice(0, 10);
  return s || '无名造物';
}

// ---- 意图解析 ----
export interface Intent {
  kind: 'preset' | 'param' | 'code';
  catalogId?: string;
  archetype: Archetype;
  count: number;
  confidence: number;
  spec: WishSpec;
  refused?: boolean;
  reason?: string;
  matchedName?: string;
}

export function parseIntent(text: string, opts?: { allowCode?: boolean }): Intent {
  const t = (text ?? '').trim();
  const seed = hashText(t);
  const hit = matchCatalog(t);
  // 八类愿景权威分类：只认愿望名词本身；命中且未命中内置预设时强制语义生成
  // （内置预设命中仍走 reuse 快路径，优先级最高，保留原有复用语义）。
  const wc = classifyWish(t);
  const semantic = !!wc && !hit;
  // 复数愿望：军队/天兵天将由语义类给出 12~36 的确定性数量，绕过 parseCount 的 8 上限
  const count = semantic ? wc!.count : parseCount(t);
  const noun = nounArchetype(t);
  const scene = sceneArchetype(t);
  const quant = quantArchetype(t);
  // 消歧顺序：量词 > 场景 > 名词/会话偏好；命中预设以目录为最强证据；语义类为最终裁决
  let archetype: Archetype = noun ?? lastArchetype;
  if (scene) archetype = scene;
  if (quant) archetype = quant;
  if (hit) archetype = hit.archetype;
  if (semantic) archetype = wc!.archetype;
  lastArchetype = archetype;

  const spec: WishSpec = {
    name: semantic ? wc!.name : (hit?.name ?? cleanName(t)),
    archetype,
    traits: extractTraits(t, archetype),
    colors: semantic ? shapeColors(wc!.shape) : colorsFrom(t, hit, archetype),
    scale: hit ? hit.scale : scaleFor(archetype, seed),
    seed,
    source: hit ? 'preset' : 'param',
    // 语义形状标签：forge 据此走专用建模；旧预设/L2 不带此字段，接口完全兼容
    ...(semantic ? { shape: wc!.shape } : {}),
  };

  if (isRefused(t)) {
    return { kind: 'param', archetype, count: 0, confidence: 0, spec, refused: true, reason: REFUSE_REASON };
  }
  const complex = /设计|自定义|原创|融合|组合|混合|像.*一样/.test(t);
  const kind: Intent['kind'] = semantic ? 'param'
    : hit ? 'preset' : (opts?.allowCode && complex ? 'code' : 'param');
  const confidence = semantic ? 0.95 : hit ? 0.95 : quant ? 0.82 : scene ? 0.7 : noun ? 0.68 : 0.5;
  return {
    kind,
    catalogId: semantic ? undefined : hit?.id,   // 语义生成不复用、不改写预设
    archetype, count, confidence, spec,
    matchedName: semantic ? wc!.name : hit?.name,
  };
}

// ---- L1 预设 spec ----
function specFromEntry(entry: CatalogEntry, text: string): WishSpec {
  return {
    name: entry.name,
    archetype: entry.archetype,
    traits: [...entry.traits],
    colors: [...entry.colors],
    scale: entry.scale,
    seed: hashText(text + '|' + entry.id),
    source: 'preset',
  };
}

// ---- L3：OpenAI 兼容 /chat/completions ----
function extractJson(s: string): string {
  const f = s.indexOf('{'), l = s.lastIndexOf('}');
  if (f >= 0 && l > f) return s.slice(f, l + 1);
  return s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim() || '{}';
}
const VALID_A: Archetype[] = [
  'dragon', 'beast', 'bird', 'humanoid', 'deity', 'plant', 'building', 'item', 'vehicle', 'spirit',
];
function coerceColors(v: unknown, def: number[]): number[] {
  if (!Array.isArray(v)) return [...def];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'number' && Number.isFinite(x)) out.push((x >>> 0) & 0xffffff);
    else if (typeof x === 'string') {
      const n = parseInt(x.replace('#', '').replace(/^0x/i, ''), 16);
      if (Number.isFinite(n)) out.push(n & 0xffffff);
    }
    if (out.length >= 4) break;
  }
  return out.length ? out : [...def];
}
function normalizeSpec(raw: Record<string, unknown>, text: string, fallback: WishSpec): WishSpec {
  const a = typeof raw.archetype === 'string' && VALID_A.includes(raw.archetype as Archetype)
    ? raw.archetype as Archetype : fallback.archetype;
  const traits = Array.isArray(raw.traits)
    ? raw.traits.filter((x): x is string => typeof x === 'string').slice(0, 8)
    : fallback.traits;
  let scale = typeof raw.scale === 'number' && Number.isFinite(raw.scale) ? raw.scale : fallback.scale;
  scale = Math.max(0.3, Math.min(3, scale));
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 16) : fallback.name;
  return {
    name,
    archetype: a,
    traits,
    colors: coerceColors(raw.colors, fallback.colors),
    scale,
    seed: hashText(text + '|' + name + '|' + a),
    source: 'code',
  };
}
async function fetchSpec(cfg: AgentConfig, text: string, intent: Intent): Promise<{ spec: WishSpec; raw: unknown }> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  const ctrl = new AbortController();
  const t1 = setTimeout(() => ctrl.abort(), 8000);
  let t2: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t2 = setTimeout(() => rej(new Error('8s 超时')), 8000); });
  const body = {
    model: cfg.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '你是三界造物 Agent，负责「开发设定与游戏资产」。只输出一个 JSON 对象，字段：name(中文名), archetype(dragon|beast|bird|humanoid|deity|plant|building|item|vehicle|spirit), traits(中文字符串数组), colors(十六进制数值数组), scale(0.3~3 数字), lore{epithet(称号), origin(出典), appearance(外形描述), powers(神通数组), temperament(性情), habitat(栖息), backstory(背景), element(五行)}。设定须具体可读，不要空话。不要输出解释文字或代码块。',
      },
      { role: 'user', content: text },
    ],
  };
  try {
    const res = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }),
      timeout,
    ]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const content = data?.choices?.[0]?.message?.content ?? '';
    const raw = JSON.parse(extractJson(content)) as Record<string, unknown>;
    // R25：raw 里的 lore 会交给 wishBlueprint.mergeLlmLore 写进设定卡，
    // 这样 L3 不是「只换一组参数」，而是真的产出可读的设定资产。
    return { spec: normalizeSpec(raw, text, intent.spec), raw };
  } finally {
    clearTimeout(t1);
    if (t2) clearTimeout(t2);
  }
}

// ---- 三级 resolve ----
export interface ResolveResult {
  ok: boolean;
  tier: 'L1' | 'L2' | 'L3' | 'refuse';
  catalogId?: string;
  spec: WishSpec;
  count: number;
  confidence: number;
  degraded?: boolean;
  reason?: string;
  /** R25：L3 由 LLM 开发的原始设定对象（含 lore），供设定卡与资产登记消费 */
  raw?: unknown;
}

export async function resolveWish(text: string): Promise<ResolveResult> {
  const cfg = loadAgentConfig();
  const allowCode = !!(cfg.enabled && cfg.apiKey && cfg.baseUrl && typeof fetch === 'function');
  const intent = parseIntent(text, { allowCode });
  if (intent.refused) {
    return { ok: false, tier: 'refuse', spec: intent.spec, count: 0, confidence: 0, reason: intent.reason };
  }
  // L1：命中预设目录直接返回 catalog id
  if (intent.catalogId) {
    const entry = getById(intent.catalogId);
    if (entry) {
      return {
        ok: true, tier: 'L1', catalogId: entry.id, spec: specFromEntry(entry, text),
        count: intent.count, confidence: Math.max(0.9, intent.confidence),
      };
    }
  }
  // L3：配置 API 时取 JSON spec；8s 超时 / 失败一律降级 L2，绝不让游戏卡死
  if (intent.kind === 'code' && allowCode) {
    try {
      const { spec, raw } = await fetchSpec(cfg, text, intent);
      return { ok: true, tier: 'L3', spec, raw, count: intent.count, confidence: 0.75 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: true, tier: 'L2', spec: intent.spec, count: intent.count, confidence: 0.6,
        degraded: true, reason: `L3 代码档不可用（${msg}），已自动降级为 L2 参数化。`,
      };
    }
  }
  // L2：离线参数化
  return { ok: true, tier: 'L2', spec: intent.spec, count: intent.count, confidence: intent.confidence };
}
