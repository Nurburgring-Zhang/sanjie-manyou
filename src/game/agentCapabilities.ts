// ============================================================================
// 三界漫游 · 游戏内 Agent「能力注册表」· src/game/agentCapabilities.ts
//
// 本文件与 assetPipeline.ts 合起来是游戏内 Agent 的「能力注册表 + 资产构建流水线」。
//
// 【真实来源，未编造】
//   1) 用户级 skills：C:\Users\Administrator\.workbuddy\skills（ls 全部目录名）
//   2) ACS 资产库索引：
//      D:\workbuddy\.workbuddy\imported\agent-core-suite-v3.1.0\_WORKBUDDY_INDEX.md
//   3) 游戏内模块：src/game 下真实存在的 wishCatalog.ts / wishForge.ts /
//      wishBlueprint.ts / wishAgent.ts / wishBuild.ts / wishEvolution.ts /
//      voxelMesh.ts / buildMode.ts 等。
//
// 【浏览器环境限制 · 如实声明，不得假装已能调用本机工具】
//   本文件随浏览器静态包运行。浏览器静态包不能直接执行本机 skill / MCP / CLI 进程，
//   也不能凭空访问外网或读取本机资产库。bridge 字段如实标注每条能力的真实调用方式：
//     'in-browser' = 浏览器内可直接跑（程序化建模 / 原生截图 / 几何校验 / 内置查表）；
//     'api'        = 需可配置外部 API（联网检索 / 模型生成 / LLM 设计），由 UI 注入后实调；
//     'offline'    = 本机 skill/MCP/CLI 的「能力描述与编排契约」：只登记它做什么、如何
//                    编排进构建链，浏览器静态包并不能直接启动本机进程；要实调必须经
//                    可配置 API 或本机桥接（例如 Electron 主进程 / 本机 Agent 运行时）。
//   因此 offline 项代表的是「能力契约与编排描述」，不是「已在游戏里调通」。
//
// 纪律：纯 TS、无 DOM、无 three 运行时依赖（仅 import type）、无第三方库；
//       纯确定性（禁止 Math.random / Date.now 影响选择结果）。
// ============================================================================

export type CapDomain =
  | 'game-design' | 'film-asset' | 'character-design' | 'game-dev'
  | '3d-dev' | '3d-tools' | 'model-search' | 'tool-call'
  | 'software-eng' | 'web-research' | 'mcp' | 'cli' | 'harness' | 'screenshot-verify';

export type Bridge = 'in-browser' | 'api' | 'offline';

export interface AgentCapability {
  id: string;
  name: string;
  domain: CapDomain;
  bridge: Bridge;
  desc: string;
  /** 真实来源：'workbuddy-skill' | 'acs-index' | 'in-game' */
  origin: 'workbuddy-skill' | 'acs-index' | 'in-game';
}

type Row = [
  id: string, name: string, domain: CapDomain, bridge: Bridge,
  origin: AgentCapability['origin'], desc: string,
];

// 每条均为上面三处真实清单里的条目；同一能力在两处清单都出现时只登记一次。
const ROWS: Row[] = [
  // ---- web-research 联网检索 ----
  ['research-engineering', '研究工程方法论', 'web-research', 'offline', 'workbuddy-skill',
    '本机 skill：把开放问题转成可核验的检索计划与证据链；浏览器静态包只登记契约，实调需可配置 API 或本机桥接'],
  ['deep-research-report', '深度外网调研报告', 'web-research', 'api', 'acs-index',
    '多步外网搜索 + 信息验证 + 结构化报告；游戏内需由 UI 注入可配置检索 API（opts.research）'],
  ['high-confidence-research', '高置信度分级调研', 'web-research', 'api', 'acs-index',
    '每条事实分级并可回溯到已核验来源；需外部检索 API'],
  ['comparative-deep-research', '比较式深度检索', 'web-research', 'api', 'acs-index',
    '多对象横向对比检索与证据对照；需外部检索 API'],
  ['hv-analysis', '横纵证据组织', 'web-research', 'offline', 'workbuddy-skill',
    '按时间与来源组织显式证据，再做横向/纵向/竞品分析；离线方法论契约'],
  ['agent-reach', '多平台只读检索 CLI', 'web-research', 'offline', 'acs-index',
    'B站/V2EX/GitHub/YouTube/网页搜索与读取的本机 CLI 封装契约；浏览器静态包不能直接执行本机进程'],

  // ---- model-search 3D 模型 / 素材检索 ----
  ['material-search', '素材与模型检索', 'model-search', 'offline', 'acs-index',
    '本机素材/模型检索 skill 契约；浏览器静态包不能直接执行本机检索进程'],
  ['paper-search-read-download', '资料检索/阅读/下载', 'model-search', 'offline', 'acs-index',
    '检索 + 阅读 + 下载范式（arXiv 脚本 / ACM 浏览器）；本机 CLI 契约'],
  ['wishCatalog', '内置资产目录检索', 'model-search', 'in-browser', 'in-game',
    'wishCatalog.ts：按名号命中内置预设资产即直接复用（L1），纯查表、零网络、确定性'],
  ['product-image-generator', '参考图/素材合成', 'model-search', 'api', 'acs-index',
    '依据实物图与场景/模特参考图合成参考图；需外部图像 API'],

  // ---- character-design 游戏角色设计 ----
  ['game-content-production', '角色四视图与拆件', 'character-design', 'offline', 'acs-index',
    '先锁风格、参考图与角色四视图、拆零件（异形件交生成式 3D、规整结构交 3D 软件）；本机工程契约'],
  ['persona-image-batch', '人设七维批量素材', 'character-design', 'api', 'acs-index',
    '人种外貌/地理/感情/职业/经济/生活方式/成长经历 7 维人设批量出图；需外部图像 API'],
  ['done-comic', '角色设定与分镜脚本', 'character-design', 'offline', 'acs-index',
    '输出角色设定、分镜脚本与生图提示词（仅 Markdown，不生成位图）；本机 skill 契约'],
  ['figma-restore', '角色设计稿规格提取', 'character-design', 'api', 'acs-index',
    '从设计稿提取颜色/字体/坐标/图层与图片素材规格；需外部设计平台 API'],
  ['threejs-image-generator', '概念图/贴图生成', 'character-design', 'api', 'acs-index',
    '游戏概念图、贴图与 UI 图像资产（外部 Gemini 图像生成可选）；需配置外部 API'],
  ['wishBlueprint', '游戏内资产设定卡', 'character-design', 'in-browser', 'in-game',
    'wishBlueprint.ts：离线产出可读 AssetLore 设定卡与 AssetBlueprint 蓝图（整数 FNV 确定性、无网络）'],

  // ---- film-asset 影视资产设计 ----
  ['3d-visual-rerender', '国漫电影级重渲染', 'film-asset', 'api', 'acs-index',
    '高动态姿势重构 / 道具 PBR 质感增强 / 场景英雄镜头，国漫风格 + 电影级光影；需外部视觉模型 API'],
  ['ai-short-film-craft', 'AI 短片镜头工艺', 'film-asset', 'offline', 'acs-index',
    '三格定妆锁脸建角色档案、七模块镜头提示词、关键帧过关才跑视频；本机工艺契约'],
  ['media-scout', '影视资料检索', 'film-asset', 'api', 'acs-index',
    '找片 / 聊剧 / 查台词 / 查剧情 / 角色资料；需外部影视数据 API'],
  ['short-drama-cover', '电影级封面策略', 'film-asset', 'api', 'acs-index',
    '依剧名、人物设定与重点剧情生成电影级封面策略；需外部图像 API'],
  ['video-ad-analyzer', '视频素材截帧分析', 'film-asset', 'offline', 'acs-index',
    'ffmpeg 截帧 + 视觉模型结构化分析画面风格/卖点；本机 CLI 契约'],

  // ---- game-design 游戏设计 ----
  ['game-architecture-patterns', '游戏架构模式', 'game-design', 'offline', 'workbuddy-skill',
    '固定步长、事件总线、可伸缩引擎架构；本机 skill 编排契约'],
  ['game-dev-loop', '游戏开发闭环门禁', 'game-design', 'offline', 'workbuddy-skill',
    'setup → 设计三件套 → 可玩切片 → 手感调参 → 运行时证据 → 发布验收，含 7 阶段门禁；本机契约'],
  ['agentic-game-dev-workflow', '端到端 AI 游戏生产', 'game-design', 'offline', 'workbuddy-skill',
    'brief-first 双轨全流程游戏生产编排；本机 skill 契约'],
  ['game-sim-architecture', '模拟层架构纪律', 'game-design', 'offline', 'acs-index',
    '确定性锁步 / 模拟与渲染分离 / 存档兼容回归 / 种子随机；本机契约'],
  ['game-ai-npc-pcg', '敌人 AI 与程序化内容', 'game-design', 'offline', 'workbuddy-skill',
    '行为树 / 效用 AI / 程序化内容生成，确定性；本机 skill 契约'],
  ['threejs-gameplay-systems', '可玩玩法系统', 'game-design', 'in-browser', 'acs-index',
    'Three.js 可玩循环 / 遭遇 / 交互实现；浏览器内可直接跑'],
  ['wishAgent', '游戏内 Agent 意图解析', 'game-design', 'in-browser', 'in-game',
    'wishAgent.ts：中文意图解析 + L1 命中复用 / L2 参数化 / L3 配置 API 降级；浏览器内可直接跑'],
  ['wishEvolution', '五阶进化/合成/吞噬体系', 'game-design', 'in-browser', 'in-game',
    'wishEvolution.ts：卵→幼体→成体→灵体→神体 5 阶，dna 7 维 / xp / abilities / form，确定性纯逻辑'],

  // ---- 3d-dev 3D 开发 ----
  ['threejs-3d-scene', '三维场景构建与数值验证', '3d-dev', 'in-browser', 'acs-index',
    '意图与视觉方向 → 剪影/构造/表面 → 参数化脚本 → 数值验收 → 验证报告；浏览器内可跑'],
  ['3dviz-pro-max', '表达性 3D 可视化', '3d-dev', 'in-browser', 'workbuddy-skill',
    '科学与交互式 3D 场景落地；浏览器内可直接跑'],
  ['wishForge', '程序化几何锻造', '3d-dev', 'in-browser', 'in-game',
    'wishForge.ts：archetype + traits 生成 THREE.BufferGeometry，确定性、单件 ≤ 20000 tri'],
  ['voxelMesh', '体素网格', '3d-dev', 'in-browser', 'in-game',
    'voxelMesh.ts：游戏内体素几何构建能力，浏览器内可直接跑'],
  ['threejs-qa-release', '发布验证与风险报告', '3d-dev', 'in-browser', 'acs-index',
    'playtest / 响应式 / 发布风险报告；浏览器内可直接跑'],

  // ---- 3d-tools 3D 工具调用 ----
  ['threejs-3d-generator', '文/图生 3D 资产', '3d-tools', 'api', 'acs-index',
    'Text/image-to-3D 游戏资产与格式转换（Tripo 可选）；需外部 3D 生成 API'],
  ['threejs-debug-profiler', '3D 调试与性能剖析', '3d-tools', 'in-browser', 'acs-index',
    '真实渲染剖析与运行时诊断；浏览器内可直接跑'],
  ['asset-production-engineering', '资产生产工程', '3d-tools', 'offline', 'workbuddy-skill',
    'Blender headless 无头渲染 / 生成式 3D 与贴图 / 可复现证据链；本机工程契约'],
  ['game-3d-asset-pipeline', '3D 资产生产与引擎集成', '3d-tools', 'offline', 'workbuddy-skill',
    'headless 生成 → 校验 → 引擎集成的验证链；本机 skill 契约'],
  ['performance-optimization', '性能优化', '3d-tools', 'offline', 'workbuddy-skill',
    '渲染 / 加载性能优化方法论；本机 skill 契约'],
  ['threejs-aaa-graphics-builder', '电影级图形升级', '3d-tools', 'in-browser', 'acs-index',
    '艺术指导批判 + 程序化材质/光照把原型升级到高级浏览器图形；浏览器内可跑'],

  // ---- game-dev 游戏开发 ----
  ['threejs-game-director', 'Three.js 游戏总入口', 'game-dev', 'in-browser', 'acs-index',
    '单入口跨 gameplay / graphics / UI / audio 路由；浏览器内可直接跑'],
  ['threejs-game-ui-designer', '游戏 HUD/菜单设计', 'game-dev', 'in-browser', 'acs-index',
    '响应式 HUD / 菜单 / 布局校验；浏览器内可直接跑'],
  ['threejs-audio-generator', '游戏音频生成集成', 'game-dev', 'api', 'acs-index',
    '游戏音频生成、清理与集成（ElevenLabs 可选）；需外部音频 API'],
  ['game-playtest-loop', '浏览器自动试玩取证', 'game-dev', 'in-browser', 'acs-index',
    'CDP 直连零依赖，真实输入 / 帧推进 / 空白画面检测；浏览器内可跑'],
  ['game-modding', '引擎侦察与 mod 工作流', 'game-dev', 'offline', 'acs-index',
    'Unity/Unreal/Godot 指纹侦察、最小可跑切片、真游戏验证；本机 CLI 契约'],
  ['wishBuild', '游戏内建造放置', 'game-dev', 'in-browser', 'in-game',
    'wishBuild.ts：网格落点 / 90° 旋转 / 层叠 / 缩放 / 撤销 / 组合 / 存档；浏览器内可跑'],

  // ---- screenshot-verify 截图验证 ----
  ['html-screenshot-image-gen', '原生截图出图', 'screenshot-verify', 'in-browser', 'workbuddy-skill',
    '免 API 的 HTML→图像信息卡，用原生浏览器截图；浏览器内可直接跑'],
  ['browser-testing-with-devtools', '真实浏览器取证（MCP）', 'screenshot-verify', 'offline', 'workbuddy-skill',
    'Chrome DevTools MCP 的浏览器测试与截图取证；需本机 MCP，浏览器静态包不能直接连；游戏内截图由主线程验证器在浏览器内完成'],
  ['dogfood', '探索式 Web QA 取证', 'screenshot-verify', 'in-browser', 'workbuddy-skill',
    '原生浏览器可复现证据的探索式 QA；浏览器内可直接跑'],
  ['image-delivery-qa', '图像资产交付质检', 'screenshot-verify', 'offline', 'acs-index',
    '生成 / 编辑 / 改编图像资产交付前的质检清单；本机 skill 契约'],

  // ---- tool-call 工具调用 ----
  ['acs-capability-router', '能力路由', 'tool-call', 'offline', 'workbuddy-skill',
    '按任务把能力路由到对应 skill / MCP / CLI 的本机编排契约'],
  ['platform-endpoint-discovery', '平台端点发现', 'tool-call', 'offline', 'workbuddy-skill',
    '端点与接口发现方法论；本机 skill 契约'],
  ['mcp-manager', 'MCP 工具调用管理', 'tool-call', 'offline', 'acs-index',
    '通过 mcporter CLI 列出 / 配置 / 鉴权 / 调用 MCP 服务器与工具；本机 CLI 契约'],
  ['studio-orchestration', '多角色工作室编排', 'tool-call', 'offline', 'acs-index',
    '设计→生产→质检→发布的多 agent 长程协作组织纪律；本机契约'],

  // ---- mcp ----
  ['mcporter', 'MCP 发现与调用', 'mcp', 'offline', 'workbuddy-skill',
    'npx/mcporter 可移植 MCP 发现 / 鉴权 / 调用；本机 CLI 契约'],
  ['npm-mcp-server-setup', 'MCP 服务安装恢复', 'mcp', 'offline', 'workbuddy-skill',
    'npm MCP 安装失败 / 静默失败后的恢复流程；本机 CLI 契约'],
  ['aone-mcp-tool-skill', '接口注册为 MCP 工具', 'mcp', 'offline', 'acs-index',
    '把服务接口解析成 JSON Schema 并注册为 MCP 工具；本机 CLI 契约'],
  ['dingtalk-doc-mcp', '文档知识库 MCP', 'mcp', 'offline', 'acs-index',
    '经 MCP 读写 / 搜索文档知识库（资料归档环节）；本机 MCP 契约'],

  // ---- cli ----
  ['node-inspect-debugger', 'Node/Chrome 调试 CLI', 'cli', 'offline', 'workbuddy-skill',
    'Node.js inspector 与 Chrome DevTools Protocol 本机调试契约'],
  ['ossutil-skill', '对象存储上传下载 CLI', 'cli', 'offline', 'acs-index',
    '对象列举 / 上传 / 下载（生成产物的落盘与取回环节）；本机 CLI 契约'],
  ['legao', '乐高 CLI 编排', 'cli', 'offline', 'acs-index',
    '经本地 legao CLI 完成创建 / 调整 / 发布 / 部署 / 排障 / 转源码；本机 CLI 契约'],

  // ---- software-eng 软件工程 ----
  ['source-driven-development', '源码驱动开发', 'software-eng', 'offline', 'workbuddy-skill',
    '以真实源码为证据推进开发；本机 skill 契约'],
  ['spec-driven-development', '规格驱动开发', 'software-eng', 'offline', 'workbuddy-skill',
    '先写规格再实现的开发纪律；本机 skill 契约'],
  ['design-md', '设计文档', 'software-eng', 'offline', 'workbuddy-skill',
    '把设计决策落成可评审文档；本机 skill 契约'],
  ['code-review-l1-l5', '五级代码评审', 'software-eng', 'offline', 'workbuddy-skill',
    'L1–L5 分层代码评审清单；本机 skill 契约'],
  ['deep-code-audit', '深度代码审计', 'software-eng', 'offline', 'workbuddy-skill',
    '深度源码审计与风险定位；本机 skill 契约'],
  ['frontend-ui-engineering', '前端 UI 工程', 'software-eng', 'in-browser', 'workbuddy-skill',
    '浏览器内前端工程实践（面板 / HUD 落地），可直接跑'],
  ['architecture-diagram', '架构图', 'software-eng', 'offline', 'workbuddy-skill',
    '架构与关系可视化产出；本机 skill 契约'],

  // ---- harness ----
  ['code-harness-soul', '工程约束框架', 'harness', 'offline', 'workbuddy-skill',
    '真实性 / 可验证性 / 工程约束框架（去私有化、可复现）；本机契约'],
  ['harness-audit', 'Harness 性能审计', 'harness', 'offline', 'workbuddy-skill',
    '基于十二大模块方法论的 Harness 完整性与性能审计评分；本机契约'],
  ['gate-failure-detection', '门禁失败检测', 'harness', 'offline', 'workbuddy-skill',
    '流水线门禁失败的识别与定位；本机契约'],
  ['deterministic-execution', '确定性执行', 'harness', 'offline', 'workbuddy-skill',
    '生成式管线 seed/version 复现、跨批次可比、回归验证；本机契约'],
  ['racing-game-qa', 'QA 验收', 'harness', 'offline', 'workbuddy-skill',
    '游戏 QA 验收与回归纪律；本机 skill 契约'],
  ['harnesspro', 'Harness 工程纪律', 'harness', 'offline', 'acs-index',
    '契约台账 / 最小判别探针 / 批量独立检查 / 禁止静默降级；本机契约'],
];

/** 全量能力注册表（只读数据，按「检索 → 设计 → 建模 → 验证 → 载入」链路分组排列） */
export const AGENT_CAPABILITIES: AgentCapability[] = ROWS.map(
  ([id, name, domain, bridge, origin, desc]) => ({ id, name, domain, bridge, origin, desc }),
);

const BY_ID: Map<string, AgentCapability> = new Map(
  AGENT_CAPABILITIES.map((c) => [c.id, c]),
);

const ALL_DOMAINS: CapDomain[] = [
  'game-design', 'film-asset', 'character-design', 'game-dev',
  '3d-dev', '3d-tools', 'model-search', 'tool-call',
  'software-eng', 'web-research', 'mcp', 'cli', 'harness', 'screenshot-verify',
];
const ALL_BRIDGES: Bridge[] = ['in-browser', 'api', 'offline'];

/** 按域筛选（返回新数组，确定性） */
export function capabilitiesByDomain(d: CapDomain): AgentCapability[] {
  return AGENT_CAPABILITIES.filter((c) => c.domain === d);
}

/** 统计：所有 domain / bridge 键必定存在且计数 >= 0 */
export function capabilityStats(): {
  total: number;
  byDomain: Record<string, number>;
  byBridge: Record<string, number>;
} {
  const byDomain: Record<string, number> = {};
  for (const d of ALL_DOMAINS) byDomain[d] = 0;
  const byBridge: Record<string, number> = {};
  for (const b of ALL_BRIDGES) byBridge[b] = 0;
  for (const c of AGENT_CAPABILITIES) {
    byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    byBridge[c.bridge] = (byBridge[c.bridge] ?? 0) + 1;
  }
  return { total: AGENT_CAPABILITIES.length, byDomain, byBridge };
}

/**
 * 每次资产构建都必走的「检索 → 设计 → 建模 → 验证 → 载入」全链能力（固定顺序）。
 * 顺序即流水线语义顺序，保证 planCapabilities 输出天然按链路排列。
 */
const BASE_CHAIN: string[] = [
  // 检索
  'wishCatalog', 'research-engineering', 'deep-research-report', 'material-search',
  // 设计
  'game-content-production', 'wishBlueprint', 'design-md', 'game-architecture-patterns',
  // 建模
  'threejs-3d-scene', 'wishForge', 'threejs-3d-generator', 'asset-production-engineering',
  // 验证
  'html-screenshot-image-gen', 'browser-testing-with-devtools', 'threejs-qa-release',
  // 载入 / 工程纪律
  'wishBuild', 'threejs-game-director', 'deterministic-execution',
];

interface KeywordRule { re: RegExp; ids: string[] }

/** 中文 / 英文关键词 → 追加能力；纯正则匹配，无随机、无时间依赖 */
const KEYWORD_RULES: KeywordRule[] = [
  { re: /龙|蛟|螭|虬|蟠|夔|蛇|相柳|神兽|瑞兽|异兽|dragon/i,
    ids: ['wishEvolution', 'game-ai-npc-pcg', '3d-visual-rerender', 'game-3d-asset-pipeline', 'persona-image-batch'] },
  { re: /角色|人物|形象|立绘|设定|拟人|神|佛|仙|妖|鬼|character|humanoid/i,
    ids: ['figma-restore', 'done-comic', 'threejs-image-generator', 'persona-image-batch'] },
  { re: /战斗|技能|法术|兵器|凶|煞|boss|combat|attack|battle/i,
    ids: ['game-ai-npc-pcg', 'threejs-gameplay-systems', 'game-sim-architecture'] },
  { re: /影视|国漫|电影|光影|镜头|海报|cinema|film|cover/i,
    ids: ['3d-visual-rerender', 'ai-short-film-craft', 'media-scout', 'short-drama-cover', 'threejs-aaa-graphics-builder'] },
  { re: /建筑|场景|宫|殿|楼|阁|塔|城|地图|building|scene/i,
    ids: ['game-architecture-patterns', 'threejs-aaa-graphics-builder'] },
  { re: /音效|音频|配乐|audio|sound|music/i, ids: ['threejs-audio-generator'] },
  { re: /检索|考证|资料|历史|典故|出处|research|search|reference/i,
    ids: ['high-confidence-research', 'hv-analysis', 'paper-search-read-download', 'agent-reach'] },
  { re: /3d|三维|模型|建模|几何|mesh|model|geometry|gltf/i,
    ids: ['game-3d-asset-pipeline', 'voxelMesh', 'threejs-debug-profiler'] },
  { re: /验证|截图|质检|测试|verify|screenshot|qa|test/i,
    ids: ['dogfood', 'image-delivery-qa', 'game-playtest-loop'] },
  { re: /优化|性能|帧率|perf|optimi/i, ids: ['performance-optimization', 'threejs-debug-profiler'] },
  { re: /mcp|cli|工具|命令行|桥接|tool|bridge/i,
    ids: ['mcporter', 'mcp-manager', 'npm-mcp-server-setup', 'node-inspect-debugger', 'ossutil-skill'] },
  { re: /进化|升级|合成|吞噬|创造|建造|evolve|craft|devour/i,
    ids: ['wishEvolution', 'game-sim-architecture'] },
];

/**
 * 确定性能力规划：基础全链 + 关键词追加，去重后按「基础链顺序 → 注册表顺序」输出。
 * 不使用 Math.random / Date.now，同一 task 恒返回同一结果。
 */
export function planCapabilities(task: string): AgentCapability[] {
  const wanted = new Set<string>(BASE_CHAIN);
  const text = String(task ?? '');
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(text)) for (const id of rule.ids) wanted.add(id);
  }
  const inBase = new Set(BASE_CHAIN);
  const out: AgentCapability[] = [];
  for (const id of BASE_CHAIN) {
    const c = BY_ID.get(id);
    if (c) out.push(c);
  }
  for (const c of AGENT_CAPABILITIES) {
    if (wanted.has(c.id) && !inBase.has(c.id)) out.push(c);
  }
  return out;
}
