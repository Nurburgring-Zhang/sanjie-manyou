import { describe, it, expect, afterEach } from 'vitest';
import {
  HW_THRESHOLDS, readHwProfile, resolvePerfMode, isSoftwareRenderer,
  setActivePerfMode, getActivePerfMode, crowdDensityFactor,
} from '../src/game/perfMode';

// PERF-001 R6 / QA-008 R1：硬件自检与低配裁决的纯函数门。
// 全程纯 Node，不依赖 DOM / WebGL；浏览器侧只是把环境量注入 readHwProfile。
afterEach(() => setActivePerfMode('normal'));

const healthy = () => readHwProfile({ deviceMemory: 16, hardwareConcurrency: 8, webgl2: true, renderer: 'NVIDIA RTX' });

describe('QA-008 R1 · 硬件档案', () => {
  it('16GB / 8 核 / WebGL2 / 独显 → 最低与推荐档都达标', () => {
    const p = healthy();
    expect(p.minMet).toBe(true);
    expect(p.recommendedMet).toBe(true);
    expect(p.failures).toEqual([]);
  });

  it('8GB 只达最低档、不达推荐档（两档口径不混算）', () => {
    const p = readHwProfile({ deviceMemory: 8, hardwareConcurrency: 8, webgl2: true, renderer: 'NVIDIA RTX' });
    expect(p.minMet).toBe(true);
    expect(p.recommendedMet).toBe(false);
    expect(p.failures).toEqual([]);
  });

  it('deviceMemory=2（--lowmem-sim 注入值）→ 未达最低档且失败原因写明', () => {
    const p = readHwProfile({ deviceMemory: 2, hardwareConcurrency: 8, webgl2: true, renderer: 'SwiftShader' });
    expect(p.minMet).toBe(false);
    expect(p.failures.some((s) => s.includes('内存 2GB'))).toBe(true);
    expect(p.softwareRenderer).toBe(true);
    expect(p.warnings.some((s) => s.includes('软渲染'))).toBe(true);
  });

  it('缺字段按未知处理并写 warning，不伪造达标', () => {
    const p = readHwProfile({ webgl2: true });
    expect(p.deviceMemoryGB).toBe(null);
    expect(p.hardwareConcurrency).toBe(null);
    expect(p.warnings.length).toBeGreaterThanOrEqual(2);
    expect(p.recommendedMet).toBe(false);
  });

  it('WebGL2 不可用 → 明确列为失败项', () => {
    const p = readHwProfile({ deviceMemory: 16, hardwareConcurrency: 16, webgl2: false });
    expect(p.minMet).toBe(false);
    expect(p.failures).toContain('WebGL2 不可用');
  });

  it('软渲染特征串识别（含大小写与 ANGLE 包装）', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3 (SwiftShader Device))')).toBe(true);
    expect(isSoftwareRenderer('Mesa llvmpipe')).toBe(true);
    expect(isSoftwareRenderer('NVIDIA GeForce RTX 4070')).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
});

describe('PERF-001 R6 · 低配裁决（禁止静默降级）', () => {
  it('健康机器默认标准档、不弹卡、无降级项', () => {
    const d = resolvePerfMode(healthy(), '');
    expect(d.mode).toBe('normal');
    expect(d.reason).toBe('default');
    expect(d.prompt).toBe(false);
    expect(d.degraded).toEqual([]);
  });

  it('deviceMemory=2 → 自动 low + 弹卡 + 逐条披露降级项', () => {
    const p = readHwProfile({ deviceMemory: 2, hardwareConcurrency: 8, webgl2: true });
    const d = resolvePerfMode(p, '');
    expect(d.mode).toBe('low');
    expect(d.reason).toBe('low-device-memory');
    expect(d.prompt).toBe(true);
    expect(d.forced).toBe(false);
    expect(d.degraded.length).toBe(5);
    expect(d.degraded[0]).toContain(String(HW_THRESHOLDS.lowCrowd));
    // PERF-003 未实施必须如实写明，不许在披露里冒充已降级
    expect(d.degraded.some((s) => s.includes('PERF-003 DEFERRED'))).toBe(true);
  });

  it('?low=1 / ?lowmem / ?perf=low 三种显式入口都进 low 且标记 forced', () => {
    for (const [q, reason] of [['?low=1', 'query-low'], ['?lowmem', 'query-lowmem'], ['?perf=low', 'query-perf-low']] as const) {
      const d = resolvePerfMode(healthy(), q);
      expect(d.mode).toBe('low');
      expect(d.reason).toBe(reason);
      expect(d.forced).toBe(true);
      expect(d.prompt).toBe(true);
    }
  });

  it('?perf=normal 显式覆盖低内存判定，但仍披露硬件不足（弹卡）', () => {
    const p = readHwProfile({ deviceMemory: 2, hardwareConcurrency: 8, webgl2: true });
    const d = resolvePerfMode(p, '?perf=normal');
    expect(d.mode).toBe('normal');
    expect(d.reason).toBe('forced-normal');
    expect(d.forced).toBe(true);
    expect(d.prompt).toBe(true);   // 硬件仍不足，不能因为强制标准档就静默
  });

  it('软渲染只给 warning，不自动 low（避免无头基线被静默换口径）', () => {
    const p = readHwProfile({ deviceMemory: 8, hardwareConcurrency: 8, webgl2: true, renderer: 'SwiftShader' });
    const d = resolvePerfMode(p, '');
    expect(p.minMet).toBe(true);
    expect(p.recommendedMet).toBe(false);
    expect(d.mode).toBe('normal');
    expect(d.prompt).toBe(false);
  });
});

describe('PERF-001 R6 · 运行期档位单一真相源', () => {
  it('低配人群系数 = lowCrowd / normalCrowd，标准档恒为 1', () => {
    expect(getActivePerfMode()).toBe('normal');
    expect(crowdDensityFactor()).toBe(1);
    setActivePerfMode('low');
    expect(crowdDensityFactor()).toBe(HW_THRESHOLDS.lowCrowd / HW_THRESHOLDS.normalCrowd);
    expect(crowdDensityFactor()).toBeLessThan(1);
  });

  it('阈值对象冻结，避免运行期被意外改写', () => {
    expect(Object.isFrozen(HW_THRESHOLDS)).toBe(true);
    expect(HW_THRESHOLDS.minRamGB).toBe(8);
    expect(HW_THRESHOLDS.recommendedRamGB).toBe(16);
    expect(HW_THRESHOLDS.lowRamGB).toBe(4);
  });
});
