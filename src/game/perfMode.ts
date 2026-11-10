/**
 * PERF-001 R6 / QA-008 R1–R3：硬件自检 + 低内存模式单一真相源。
 *
 * 设计约束：
 *  1. 阈值只在这里写一次。`docs/HW-REQUIREMENTS.md` 的表格由占位符渲染，
 *     `scripts/qa/check-hw-thresholds.mjs` 反向解析本文件的常量与文档比对，杜绝两处漂移。
 *  2. 纯函数可测：浏览器环境从 `readHwProfile(env)` 注入，单测不需要 DOM/WebGL。
 *  3. **禁止静默降级**（INV-04）：任何进入 low 的原因都必须出现在 `degraded[]` 里，
 *     并由 main.ts 弹出一次性提示卡 + 手动切换链接；`window.__qingming.hwProfile` 可机读。
 *  4. 软渲染标记只影响「推荐档」判定，**不自动进 low**。理由：无头验收环境普遍是
 *     SwiftShader，若据此自动降档，标准基线与 A/B 对比会在不知不觉中换了口径。
 *     该结论写进 hwProfile.warnings 并随提示卡披露，用户仍可用 ?low=1 手动切换。
 */
export const HW_THRESHOLDS = Object.freeze({
  /** 最低档：物理内存（GB） */
  minRamGB: 8,
  /** 推荐档：物理内存（GB） */
  recommendedRamGB: 16,
  /** 最低档：逻辑核数 */
  minCores: 4,
  /** 低于或等于此值直接进低内存模式 */
  lowRamGB: 4,
  /** 标准人群实例数（spec PERF-001 背景口径） */
  normalCrowd: 4510,
  /** 低配人群实例数 */
  lowCrowd: 1500,
  /** 低配像素比（PERF-002 R4） */
  lowPixelRatio: 0.75,
  /** 低配阴影开关 */
  lowShadows: false,
});

/**
 * 运行期生效档位（模块级单例）。world.ts 的任务闭包在 init() 里读它，
 * 避免把决策对象穿过整个构造链，也保证 Baker / Crowd / Engine 三处口径同源。
 */
let activePerfMode: PerfMode = 'normal';
export function setActivePerfMode(m: PerfMode): void { activePerfMode = m; }
export function getActivePerfMode(): PerfMode { return activePerfMode; }
export function crowdDensityFactor(): number {
  return activePerfMode === 'low'
    ? HW_THRESHOLDS.lowCrowd / HW_THRESHOLDS.normalCrowd
    : 1;
}

export type PerfMode = 'normal' | 'low';
export type PerfReason =
  | 'default' | 'forced-normal' | 'query-low' | 'query-lowmem' | 'query-perf-low'
  | 'low-device-memory' | 'low-core-count' | 'no-webgl2' | 'software-renderer-warning';

export interface HwProfile {
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
  webgl2: boolean;
  renderer: string | null;
  softwareRenderer: boolean;
  /** 是否达到「最低」档（RAM / 核数 / WebGL2） */
  minMet: boolean;
  /** 是否达到「推荐」档（含软渲染判定） */
  recommendedMet: boolean;
  /** 未达最低档的具体原因，逐条写清，不允许静默 */
  failures: string[];
  /** 提示但不阻断的观测项 */
  warnings: string[];
}

export interface PerfDecision {
  mode: PerfMode;
  reason: PerfReason;
  /** 已实际生效的降级项（由 main.ts / world.ts 落地），用于 HUD 与探针分账披露 */
  degraded: string[];
  /** 是否应弹一次性提示卡 */
  prompt: boolean;
  /** 是否由 URL 显式强制（用于披露「这是人为覆盖，不是机器判定」） */
  forced: boolean;
}

/** WebGL 渲染器字符串里的软渲染特征（大小写不敏感）。 */
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

export function isSoftwareRenderer(name: string | null | undefined): boolean {
  return typeof name === 'string' && SOFTWARE_RE.test(name);
}

/**
 * 纯函数：从注入的环境量构造硬件档案。不在浏览器里调用 `getContext` 的代码也走这里，
 * 保证单测与真机同一套判定逻辑。
 */
export function readHwProfile(env: {
  deviceMemory?: number | null;
  hardwareConcurrency?: number | null;
  webgl2?: boolean;
  renderer?: string | null;
}): HwProfile {
  const deviceMemoryGB = Number.isFinite(env.deviceMemory) ? Number(env.deviceMemory) : null;
  const hardwareConcurrency = Number.isFinite(env.hardwareConcurrency) ? Number(env.hardwareConcurrency) : null;
  const webgl2 = env.webgl2 === true;
  const renderer = typeof env.renderer === 'string' && env.renderer ? env.renderer : null;
  const softwareRenderer = isSoftwareRenderer(renderer);
  const failures: string[] = [];
  const warnings: string[] = [];
  if (deviceMemoryGB === null) warnings.push('浏览器未提供 navigator.deviceMemory，内存档位按未知处理');
  else if (deviceMemoryGB < HW_THRESHOLDS.minRamGB) failures.push(`内存 ${deviceMemoryGB}GB < 最低 ${HW_THRESHOLDS.minRamGB}GB`);
  if (hardwareConcurrency === null) warnings.push('浏览器未提供 hardwareConcurrency，核数按未知处理');
  else if (hardwareConcurrency < HW_THRESHOLDS.minCores) failures.push(`逻辑核 ${hardwareConcurrency} < 最低 ${HW_THRESHOLDS.minCores}`);
  if (!webgl2) failures.push('WebGL2 不可用');
  if (softwareRenderer) warnings.push(`检测到软渲染（${renderer}）：未自动降档，可用 ?low=1 手动切换`);
  const minMet = failures.length === 0;
  const recommendedMet = minMet && !softwareRenderer
    && deviceMemoryGB !== null && deviceMemoryGB >= HW_THRESHOLDS.recommendedRamGB;
  return { deviceMemoryGB, hardwareConcurrency, webgl2, renderer, softwareRenderer,
    minMet, recommendedMet, failures, warnings };
}

/**
 * 纯函数：按硬件档案 + URL 参数裁决性能档。
 * 优先级：显式 perf=normal > 显式 low=1 / lowmem / perf=low > 硬件不足 > 默认。
 */
export function resolvePerfMode(profile: HwProfile, search: URLSearchParams | string): PerfDecision {
  const q = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : search;
  const degraded: string[] = [];
  let mode: PerfMode = 'normal';
  let reason: PerfReason = 'default';
  let forced = false;

  if (q.get('perf') === 'normal') {
    reason = 'forced-normal'; forced = true;
  } else if (q.get('low') === '1') {
    mode = 'low'; reason = 'query-low'; forced = true;
  } else if (q.has('lowmem')) {
    mode = 'low'; reason = 'query-lowmem'; forced = true;
  } else if (q.get('perf') === 'low') {
    mode = 'low'; reason = 'query-perf-low'; forced = true;
  } else if (profile.deviceMemoryGB !== null && profile.deviceMemoryGB <= HW_THRESHOLDS.lowRamGB) {
    mode = 'low'; reason = 'low-device-memory';
  } else if (!profile.webgl2) {
    mode = 'low'; reason = 'no-webgl2';
  } else if (profile.hardwareConcurrency !== null && profile.hardwareConcurrency < HW_THRESHOLDS.minCores) {
    mode = 'low'; reason = 'low-core-count';
  }

  if (mode === 'low') {
    degraded.push(`人群 ${HW_THRESHOLDS.normalCrowd} → ${HW_THRESHOLDS.lowCrowd}`);
    degraded.push('装饰几何降档（leaf / trunk / glow 按确定性哈希保留 1/3）');
    degraded.push('阴影关闭');
    degraded.push(`像素比降至 ${HW_THRESHOLDS.lowPixelRatio}`);
    // PERF-003 仍 DEFERRED：分坊预算没实现就必须写明，不许在披露里冒充已降级。
    degraded.push('solids 分坊预算：未实施（PERF-003 DEFERRED，cap 触顶仍按豁免单披露）');
  }
  // 不足最低档或已降档都必须弹卡；软渲染只是 warning，不单独弹卡（避免每次验收都弹）。
  const prompt = mode === 'low' || !profile.minMet;
  return { mode, reason, degraded, prompt, forced };
}

/** 浏览器侧采集：在 new Engine() 之前调用，故自建一个临时 canvas 探测 WebGL2。 */
export function detectHwProfile(): HwProfile {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return readHwProfile({});
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  let webgl2 = false;
  let renderer: string | null = null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl) {
      webgl2 = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* 探测失败按不可用处理，绝不因此中断启动 */ }
  return readHwProfile({
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    webgl2, renderer,
  });
}
