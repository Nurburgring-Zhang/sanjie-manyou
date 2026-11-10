// ============================================================================
// 三界造物 · 真实联网检索桥 · src/game/wishResearch.ts
//
// 与旧 wishAgent.fetchSpec / wishPanel.onlineResearch 的本质区别：
//   旧实现只是拼一个 /chat/completions 请求让模型「编」一份 JSON，没有任何搜索 API、
//   没有网页抓取、没有 URL 校验，默认 enabled=false / apiKey='' →「联网检索」名不副实。
//
// 本模块是「真检索」：
//   1) 可配置项 research.enabled / research.endpoint / research.apiKey / research.provider
//      （localStorage 单键 + 组合键，外加运行期 override，便于 Puppeteer 实机配置）。
//   2) 用真实 fetch 请求 URL，并做 http/https 协议 + URL 合法性校验（禁 javascript: 等）。
//   3) 支持常见搜索 JSON：Brave(web.results) / Serper(organic,images) /
//      Bing(webPages.value) / custom(results|value|data|items|顶层数组)；
//      以及 webpage 直抓公开参考页（title / meta description / og:image / img / video / a[href]）。
//   4) 解析出标题、摘要、URL、图片 / 视频参考链接，如实填入 ResearchCard 白名单字段；
//      缺失字段一律标注「未检索到」，绝不编造链接或数据。
//   5) 默认关闭 → bridge='offline'、status='disabled'（不发起任何请求、不冒充联网）；
//      请求失败 / CORS 被拦 → bridge='online'、status='failed'|'cors' 且 error 记录原文。
//
// 纪律：8s 超时（AbortController）；整链 try/catch 不外抛；apiKey 只用于请求头，
//       绝不进日志 / 存档 / 资料卡；无 Math.random / 无共享 RNG。
// ============================================================================

export type ResearchProvider = 'brave' | 'serper' | 'bing' | 'custom' | 'webpage';
export type ResearchStatus = 'disabled' | 'ok' | 'no-results' | 'failed' | 'cors' | 'bad-config';

/**
 * FIX-003 R4 / QA-004 四态披露：每次检索调用的结果对象都带 mode。
 *   real    —— 真的向外部端点发过请求（成功或失败/CORS 均属真实尝试，由 status 细分）
 *   offline —— 功能默认关闭 / 未发起任何网络请求（如实降级，不冒充联网）
 *   mocked  —— 仅测试注入时出现（例如 Puppeteer 请求拦截伪造应答的验收场景），
 *              运行期默认路径绝不会自行返回 mocked。
 */
export type ResearchMode = 'real' | 'offline' | 'mocked';

export interface ResearchConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  provider: ResearchProvider;
}

/** 单条检索命中（title/snippet/url 为真实解析结果；image/video 为可选真实链接） */
export interface ResearchFinding {
  title: string;
  snippet: string;
  url: string;
  image?: string;
  video?: string;
}

/**
 * 检索结论：顶层同时携带「meta（bridge/status/…）」与「ResearchCard 白名单字段」。
 * runAssetPipeline 的 mergeResearch 只认白名单字段；meta 由流水线单独读取，
 * 因此一个扁平对象即可同时满足「合并资料卡」与「如实记录桥状态」。
 */
export interface ResearchOutcome {
  mode: ResearchMode;        // FIX-003 R4：四态披露，见 ResearchMode 注释
  bridge: 'online' | 'offline';
  status: ResearchStatus;
  provider: string;
  endpoint: string;
  error: string;
  query: string;
  merged: number;        // 从真实结果采用/覆盖的资料卡字段数
  resultCount: number;   // 命中结果条数
  findings: ResearchFinding[];
  // ---- ResearchCard 白名单字段（按可获得信息如实填充，缺失标「未检索到」）----
  name: string; origin: string; dimensions: string; form: string; structure: string;
  features: string[]; abilities: string[]; functions: string[]; uses: string[];
  relations: string[]; imageRefs: string[]; videoRefs: string[]; sources: string[];
  worldImpact: string; npcRelations: string; consequences: string;
  capabilityNotes: string;
  palette: number[];
  combat: boolean; crafting: boolean; usable: boolean; devourable: boolean;
  evolve: boolean; upgrade: boolean; creation: boolean; building: boolean;
}

const NOT_FOUND = '未检索到';
const TIMEOUT_MS = 8000;
const PROVIDERS: ResearchProvider[] = ['brave', 'serper', 'bing', 'custom', 'webpage'];

const DEFAULT_ENDPOINTS: Record<ResearchProvider, string> = {
  brave: 'https://api.search.brave.com/res/v1/web/search',
  serper: 'https://google.serper.dev/search',
  bing: 'https://api.bing.microsoft.com/v7.0/search',
  custom: '',
  webpage: '',
};

const STORAGE_OBJECT_KEY = 'cyber-qingming.research.v1';
const KEY = {
  enabled: 'research.enabled',
  endpoint: 'research.endpoint',
  apiKey: 'research.apiKey',
  provider: 'research.provider',
};

let runtimeOverride: Partial<ResearchConfig> | null = null;

/**
 * 测试注入用的 mode 覆盖（默认 null）。仅供验收/测试显式调用，运行期不会自行置位；
 * 置 'mocked' 后 performResearch 返回的 mode 才会是 mocked（例如请求拦截伪造应答的场景）。
 */
let injectedMode: ResearchMode | null = null;
export function setResearchModeForTest(mode: 'mocked' | null): void {
  injectedMode = mode;
}

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function isProvider(v: unknown): v is ResearchProvider {
  return typeof v === 'string' && (PROVIDERS as string[]).includes(v);
}
function asRec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 300) : '';
}
function firstArray(...vals: unknown[]): unknown[] {
  for (const v of vals) if (Array.isArray(v)) return v;
  return [];
}
function errText(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 200);
  try { return String(e).slice(0, 200); } catch { return '未知异常'; }
}

/** URL 校验：只放行 http/https，杜绝 javascript: / data: 注入；返回规范化 URL 或 null */
function validateUrl(u: string): string | null {
  if (!u || typeof u !== 'string') return null;
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return p.toString();
  } catch { return null; }
}
function endpointValid(ep: string): boolean {
  return validateUrl(ep.includes('{q}') ? ep.replace('{q}', 'test') : ep) !== null;
}

// ---- 配置读写（组合键 + research.* 单键 + 运行期 override）--------------------
function readStored(): ResearchConfig {
  const base: ResearchConfig = { enabled: false, endpoint: '', apiKey: '', provider: 'brave' };
  const s = storage();
  if (!s) return base;
  try {
    const raw = s.getItem(STORAGE_OBJECT_KEY);
    if (raw) {
      const o = asRec(JSON.parse(raw) as unknown);
      if (o) {
        if (typeof o['enabled'] === 'boolean') base.enabled = o['enabled'] as boolean;
        if (typeof o['endpoint'] === 'string') base.endpoint = o['endpoint'] as string;
        if (typeof o['apiKey'] === 'string') base.apiKey = o['apiKey'] as string;
        if (isProvider(o['provider'])) base.provider = o['provider'];
      }
    }
  } catch { /* 损坏配置忽略 */ }
  try {
    const en = s.getItem(KEY.enabled);
    if (en !== null) base.enabled = en === 'true';
    const ep = s.getItem(KEY.endpoint); if (ep) base.endpoint = ep;
    const ak = s.getItem(KEY.apiKey); if (ak) base.apiKey = ak;
    const pr = s.getItem(KEY.provider); if (isProvider(pr)) base.provider = pr;
  } catch { /* 单项键不可读忽略 */ }
  return base;
}

/** 读取当前生效配置（运行期 override 优先于 localStorage） */
export function loadResearchConfig(): ResearchConfig {
  const base = readStored();
  return runtimeOverride ? { ...base, ...runtimeOverride } : base;
}

/** 保存配置：写组合键 + research.* 单键，并同步运行期 override（不写日志、不进存档） */
export function saveResearchConfig(patch: Partial<ResearchConfig>): ResearchConfig {
  const next: ResearchConfig = { ...loadResearchConfig(), ...patch };
  if (!isProvider(next.provider)) next.provider = 'brave';
  const s = storage();
  if (s) {
    try {
      s.setItem(STORAGE_OBJECT_KEY, JSON.stringify(next));
      s.setItem(KEY.enabled, String(next.enabled));
      s.setItem(KEY.endpoint, next.endpoint);
      s.setItem(KEY.apiKey, next.apiKey);
      s.setItem(KEY.provider, next.provider);
    } catch { /* 配额 / 隐私模式忽略 */ }
  }
  runtimeOverride = { ...next };
  return next;
}

/** 纯运行期配置（不落盘），传 null 清除 override */
export function setResearchConfigRuntime(patch: Partial<ResearchConfig> | null): void {
  runtimeOverride = patch ? { ...readStored(), ...patch } : null;
}

export function researchEndpoints(): Record<ResearchProvider, string> {
  return { ...DEFAULT_ENDPOINTS };
}

// ---- 真实 HTTP：8s 超时、URL 校验、AbortController ----------------------------
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const v = validateUrl(url);
  if (!v) throw new Error('检索 URL 非法（仅允许 http/https）：' + url.slice(0, 120));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(v, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  } finally { clearTimeout(timer); }
}
async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetchWithTimeout(url, init);
  return await res.json() as unknown;
}
async function getText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {});
  return await res.text();
}

function withQuery(endpoint: string, q: string): string {
  if (endpoint.includes('{q}')) return endpoint.replace('{q}', encodeURIComponent(q));
  const sep = endpoint.includes('?') ? '&' : '?';
  return endpoint + sep + 'q=' + encodeURIComponent(q);
}

/** 从常见搜索 JSON 形状里抽出结果数组（Brave/Serper/Bing/custom/顶层数组） */
function extractFindings(data: unknown): ResearchFinding[] {
  const root = asRec(data);
  const arr = root ? firstArray(
    asRec(root['web'])?.['results'],
    asRec(root['webPages'])?.['value'],
    root['organic'], root['results'], root['value'], root['data'], root['items'],
  ) : [];
  const list: unknown[] = arr.length ? arr : (Array.isArray(data) ? data : []);
  const out: ResearchFinding[] = [];
  for (const item of list.slice(0, 12)) {
    const r = asRec(item);
    if (!r) continue;
    const title = str(r['title'] ?? r['name'] ?? r['headline']);
    const snippet = str(r['description'] ?? r['snippet'] ?? r['content'] ?? r['abstract'] ?? r['summary']);
    const url = validateUrl(str(r['url'] ?? r['link'] ?? r['href'] ?? r['source'])) ?? '';
    const thumb = r['thumbnail'];
    const image = validateUrl(str(asRec(thumb)?.['src'] ?? thumb ?? r['image'] ?? r['imageUrl'])) ?? undefined;
    const video = validateUrl(str(r['video'] ?? r['videoUrl'])) ?? undefined;
    if (title || snippet || url) out.push({ title, snippet, url, image, video });
  }
  return out;
}

/** 直抓公开参考页：解析 title / meta description / og:image / img / video / a[href] */
function parseWebpage(url: string, html: string): ResearchFinding[] {
  let title = '', desc = '';
  const images: string[] = [], videos: string[] = [];
  try {
    const DP = (globalThis as unknown as { DOMParser?: unknown })['DOMParser'];
    if (typeof DP === 'function') {
      const Parser = DP as new (s: string, t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const doc: any = new Parser(html, 'text/html');          // eslint-disable-line @typescript-eslint/no-explicit-any
      title = String(doc.querySelector('title')?.textContent ?? '').trim();
      const meta = (sel: string): string =>
        String(doc.querySelector(sel)?.getAttribute('content') ?? '').trim();
      desc = meta('meta[property="og:description"]') || meta('meta[name="description"]');
      const ogi = meta('meta[property="og:image"]'); if (ogi) images.push(ogi);
      doc.querySelectorAll('img[src]').forEach((im: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const s = String(im.getAttribute('src') ?? ''); if (s) images.push(s);
      });
      doc.querySelectorAll('video[src],source[src]').forEach((v: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const s = String(v.getAttribute('src') ?? ''); if (s) videos.push(s);
      });
      doc.querySelectorAll('a[href]').forEach((a: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const h = String(a.getAttribute('href') ?? '');
        if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(h)) videos.push(h);
      });
    }
  } catch { /* DOMParser 不可用则退回正则兜底 */ }
  if (!title) { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (m) title = m[1].trim(); }
  if (!desc) {
    const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (m) desc = m[1];
  }
  const resolve = (list: string[]): string[] => {
    const out: string[] = [];
    for (const u of list) {
      try {
        const v = validateUrl(new URL(u, url).toString());
        if (v) out.push(v);
      } catch { /* 相对 / 畸形 URL 忽略 */ }
    }
    return out;
  };
  const imgUrls = resolve(images);
  const vidUrls = resolve(videos);
  const finding: ResearchFinding = {
    title: title || '公开参考页',
    snippet: desc || '（页面未提供 meta description）',
    url,
    image: imgUrls[0],
    video: vidUrls[0],
  };
  const extra: ResearchFinding[] = [];
  for (const u of imgUrls.slice(1, 6)) extra.push({ title: '图片参考', snippet: '', url: '', image: u });
  for (const u of vidUrls.slice(0, 4)) extra.push({ title: '视频参考', snippet: '', url: '', video: u });
  return [finding, ...extra];
}

async function runFetch(q: string, cfg: ResearchConfig, endpoint: string): Promise<ResearchFinding[]> {
  if (cfg.provider === 'webpage') return parseWebpage(endpoint, await getText(endpoint));
  const url = cfg.provider === 'serper' ? endpoint : withQuery(endpoint, q);
  let data: unknown;
  if (cfg.provider === 'serper') {
    data = await getJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': cfg.apiKey },
      body: JSON.stringify({ q }),
    });
  } else if (cfg.provider === 'bing') {
    data = await getJson(url, { headers: { 'Ocp-Apim-Subscription-Key': cfg.apiKey } });
  } else if (cfg.provider === 'brave') {
    data = await getJson(url, { headers: { 'Accept': 'application/json', 'X-Subscription-Token': cfg.apiKey } });
  } else {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    data = await getJson(url, { headers });
  }
  const findings = extractFindings(data);
  // Serper 的图片数组单独补成图片参考条目
  const root = asRec(data);
  const images = root ? firstArray(root['images'], asRec(root['image'])?.['results']) : [];
  for (const im of images.slice(0, 6)) {
    const r = asRec(im);
    const u = validateUrl(str(r?.['imageUrl'] ?? r?.['url'] ?? r?.['src']));
    if (u) findings.push({ title: str(r?.['title']) || '图片参考', snippet: '', url: '', image: u });
  }
  return findings;
}

// ---- 从真实结果如实构造资料卡字段（缺失标「未检索到」，绝不编造）---------------
const COLOR_HINTS: [RegExp, number][] = [
  [/红|赤|朱|red/i, 0xc23127], [/金|黄|鎏|gold/i, 0xd4af37],
  [/蓝|靛|blue/i, 0x3a8ab8], [/绿|翠|碧|green/i, 0x7ec8a0],
  [/白|银|素|white|silver/i, 0xf0ead8], [/黑|玄|墨|black/i, 0x2a2a35],
  [/紫|purple/i, 0x7a5cff], [/灰|gray|grey/i, 0xc0c4cc],
];
function detectColors(text: string): number[] {
  const out: number[] = [];
  for (const [re, c] of COLOR_HINTS) if (re.test(text) && !out.includes(c)) out.push(c);
  return out.slice(0, 4);
}

interface CardFields {
  name: string; origin: string; dimensions: string; form: string; structure: string;
  features: string[]; abilities: string[]; functions: string[]; uses: string[];
  relations: string[]; imageRefs: string[]; videoRefs: string[]; sources: string[];
  worldImpact: string; npcRelations: string; consequences: string;
  capabilityNotes: string; palette: number[];
  combat: boolean; crafting: boolean; usable: boolean; devourable: boolean;
  evolve: boolean; upgrade: boolean; creation: boolean; building: boolean;
}
function emptyFields(q: string): CardFields {
  return {
    name: q, origin: NOT_FOUND, dimensions: NOT_FOUND, form: NOT_FOUND, structure: NOT_FOUND,
    features: [NOT_FOUND], abilities: [NOT_FOUND], functions: [NOT_FOUND], uses: [NOT_FOUND],
    relations: [NOT_FOUND], imageRefs: [NOT_FOUND], videoRefs: [NOT_FOUND], sources: [NOT_FOUND],
    worldImpact: NOT_FOUND, npcRelations: NOT_FOUND, consequences: NOT_FOUND,
    capabilityNotes: `战斗/合成/吞噬/进化/升级/建造 ${NOT_FOUND}明确资料，布尔字段保守置否`,
    palette: [],
    combat: false, crafting: false, usable: false, devourable: false,
    evolve: false, upgrade: false, creation: false, building: false,
  };
}
function successFields(q: string, cfg: ResearchConfig, findings: ResearchFinding[]): { f: CardFields; merged: number } {
  const f = emptyFields(q);
  const snippets = findings.map((x) => x.snippet).filter((s) => s && s !== NOT_FOUND);
  const titles = findings.map((x) => x.title).filter(Boolean);
  const joined = [...snippets, ...titles].join(' ');
  f.origin = `联网检索（provider=${cfg.provider}、endpoint=${cfg.endpoint || DEFAULT_ENDPOINTS[cfg.provider]}）：`
    + `关键词「${q}」· 命中 ${findings.length} 条结果（真实结果，非模型编造）`;
  f.sources = findings.filter((x) => x.url).map((x) => `${x.title || '结果'} — ${x.url}`);
  if (!f.sources.length) f.sources = [NOT_FOUND];
  f.imageRefs = findings.map((x) => x.image).filter((u): u is string => !!u);
  if (!f.imageRefs.length) f.imageRefs = [NOT_FOUND];
  f.videoRefs = findings.map((x) => x.video).filter((u): u is string => !!u);
  if (!f.videoRefs.length) f.videoRefs = [NOT_FOUND];
  f.features = snippets.length
    ? snippets.slice(0, 6).map((s) => `检索摘要：${s.slice(0, 200)}`)
    : (titles.length ? titles.slice(0, 6).map((t) => `检索标题：${t}`) : [NOT_FOUND]);
  const sizeHits = snippets.filter((s) => /米|cm|厘米|尺寸|长约|高约|宽\s*\d|重|吨|千米|km|英尺/i.test(s));
  if (sizeHits.length) f.dimensions = sizeHits.slice(0, 2).join(' / ');
  const formHits = snippets.filter((s) => /外形|造型|外观|形状|呈|轮廓|机身|车身|山峰|宫殿/i.test(s));
  if (formHits.length) f.form = formHits.slice(0, 2).join(' / ');
  const structHits = snippets.filter((s) => /结构|组成|构成|部件|分为|包括/i.test(s));
  if (structHits.length) f.structure = structHits.slice(0, 2).join(' / ');
  const abilityHits = snippets.filter((s) => /能力|可|能|飞行|战斗|攻击|速度|推进|变形|进化|技能/i.test(s));
  f.abilities = abilityHits.length ? abilityHits.slice(0, 4).map((s) => s.slice(0, 120)) : [NOT_FOUND];
  const funcHits = snippets.filter((s) => /功能|用途|用于|作用|适用/i.test(s));
  f.functions = funcHits.length ? funcHits.slice(0, 3) : [NOT_FOUND];
  f.uses = funcHits.length ? funcHits.slice(0, 3) : [NOT_FOUND];
  const impactHits = snippets.filter((s) => /影响|生态|环境|世界|后果/i.test(s));
  f.worldImpact = impactHits.length ? impactHits.slice(0, 2).join(' / ') : NOT_FOUND;
  f.palette = detectColors(joined);
  // 能力可否：仅当真实摘要明确出现对应词才置真，否则保守 false
  f.combat = /战斗|作战|武器|攻击|军用|军|士兵|兵器|attack|combat|weapon/i.test(joined);
  f.crafting = /合成|锻造|制作|制造|craft|forge/i.test(joined);
  f.usable = /可驾驶|可骑|可使用|可交互|载人|搭载/i.test(joined);
  f.devourable = /吞噬|吸收|吞食/i.test(joined);
  f.evolve = /进化|变形|形态变化/i.test(joined);
  f.upgrade = /升级|强化/i.test(joined);
  f.creation = true; // 三界造物系统本身即「创造」入口（如实登记，非编造）
  f.building = /建造|建筑|宫殿|楼|台|搭建/i.test(joined);
  f.capabilityNotes = `能力可否依检索摘要中明确出现的关键词判定；其余 ${NOT_FOUND} 项保守置否，来源见 sources`;
  // 统计「从真实结果采用」的字段数
  let merged = 0;
  const strKeys: (keyof CardFields)[] = ['origin', 'dimensions', 'form', 'structure', 'worldImpact', 'npcRelations', 'consequences', 'capabilityNotes'];
  for (const k of strKeys) if (typeof f[k] === 'string' && (f[k] as string) !== NOT_FOUND) merged++;
  const arrKeys: (keyof CardFields)[] = ['features', 'abilities', 'functions', 'uses', 'relations', 'imageRefs', 'videoRefs', 'sources'];
  for (const k of arrKeys) {
    const v = f[k] as unknown;
    if (Array.isArray(v) && !(v as string[]).includes(NOT_FOUND)) merged++;
  }
  if (f.palette.length) merged++;
  return { f, merged };
}

function outcome(
  bridge: 'online' | 'offline', status: ResearchStatus, cfg: ResearchConfig, q: string,
  error: string, findings: ResearchFinding[], fields: CardFields, merged: number,
): ResearchOutcome {
  // offline 降级如实披露；其余真实请求（成功/失败/CORS）均为 real；mocked 只在测试注入出现
  const mode: ResearchMode = injectedMode ?? (bridge === 'offline' ? 'offline' : 'real');
  return {
    mode, bridge, status, provider: cfg.provider, endpoint: cfg.endpoint || DEFAULT_ENDPOINTS[cfg.provider],
    error, query: q, merged, resultCount: findings.length, findings,
    ...fields,
  };
}
function disabledOutcome(q: string, cfg: ResearchConfig, why: string): ResearchOutcome {
  return outcome('offline', 'disabled', cfg, q, why, [], emptyFields(q), 0);
}
function failureOutcome(q: string, cfg: ResearchConfig, status: ResearchStatus, error: string): ResearchOutcome {
  return outcome('online', status, cfg, q, error, [], emptyFields(q), 0);
}

/**
 * 真实联网检索入口：默认关闭 → 不发请求、bridge=offline；成功后解析真实结果；
 * 失败 / CORS 如实记 status + error。绝不编造资料、绝不假装成功。
 */
export async function performResearch(query: string, override?: Partial<ResearchConfig>): Promise<ResearchOutcome> {
  const cfg: ResearchConfig = override ? { ...loadResearchConfig(), ...override } : loadResearchConfig();
  const q = String(query ?? '').trim();
  if (!cfg.enabled) {
    return disabledOutcome(q, cfg, 'research.enabled=false（默认关闭，未发起任何网络请求）');
  }
  if (typeof fetch !== 'function') {
    return failureOutcome(q, cfg, 'failed', '当前环境无 fetch，无法联网检索');
  }
  const endpoint = (cfg.endpoint || DEFAULT_ENDPOINTS[cfg.provider] || '').trim();
  if (!endpoint) return failureOutcome(q, cfg, 'bad-config', '缺少 research.endpoint（custom/webpage 必须提供）');
  if (!endpointValid(endpoint)) {
    return failureOutcome(q, cfg, 'bad-config', 'research.endpoint 非法 URL（仅允许 http/https）');
  }
  try {
    const findings = await runFetch(q, cfg, endpoint);
    if (!findings.length) return failureOutcome(q, cfg, 'no-results', '检索返回 0 条可用结果');
    const { f, merged } = successFields(q, cfg, findings);
    return outcome('online', 'ok', cfg, q, '', findings, f, Math.max(1, merged));
  } catch (e) {
    const msg = errText(e);
    const isCors = /Failed to fetch|NetworkError|Load failed|CORS|Network request failed|abort/i.test(msg);
    return failureOutcome(q, cfg, isCors ? 'cors' : 'failed', msg);
  }
}
