# 硬件要求与启动实测矩阵（PERF-001 R7 / QA-008 R3）

本表是硬件门槛与启动实测的**唯一宣称口径**。所有运行期数字由 `{{json:...}}` 占位符从
`artifacts/` 台账渲染（`scripts/gen-docs.mjs`），`scripts/qa/check-numbers.mjs` 自动纳管本文件，
禁止手抄。硬件阈值唯一真源是 `src/game/perfMode.ts` 的 `HW_THRESHOLDS`，
`scripts/qa/check-hw-thresholds.mjs`（由 check-numbers 复用）逐项比对
「源码常量 ↔ 本文件可见值 ↔ `artifacts/boot-hw.json` 运行期台账」，任一漂移 rc=1。

## 两档阈值表

| 档位 | 系统内存 | 图形 | 备注 |
| --- | --- | --- | --- |
| 最低 | 8<!-- {{json:boot-hw.json#thresholds.minRamGB}} -->GB RAM | WebGL2；独显或 Apple Silicon | 纯软渲染（SwiftShader）可运行，但帧率显著下降，不推荐作为主玩环境 |
| 推荐 | 16<!-- {{json:boot-hw.json#thresholds.recommendedRamGB}} -->GB RAM | 独显 | 三界全量烘焙 + 高画质 |

## 低配模式参数（PERF-001 R6 / PERF-002 R4）

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 自动触发内存 | ≤ 4<!-- {{json:boot-hw.json#thresholds.lowRamGB}} -->GB | `navigator.deviceMemory` 低于该值即自动进低配 |
| 最低逻辑核 | 4<!-- {{json:boot-hw.json#thresholds.minCores}} --> | 低于该值且内存未知时自动进低配 |
| 人群实例（标准 → 低配） | 4510<!-- {{json:boot-hw.json#thresholds.normalCrowd}} --> → 1500<!-- {{json:boot-hw.json#thresholds.lowCrowd}} --> | 在 `spawnCrowd()` 之前收窄计划人口，不是事后隐藏 |
| 像素比 | 0.75<!-- {{json:boot-hw.json#thresholds.lowPixelRatio}} --> | 由 `Engine.applyQuality()` 单一入口覆盖，自适应画质不会把它改回标准档 |
| 阴影 / 泛光 | 关闭 | 低配档 `lowShadows=false`、`bloom=false` |
| 装饰几何 | 保留 1/3 | `leaf / trunk / glow` 按量化坐标确定性哈希抽稀；结构件一个顶点不少 |

低配判定还有三个显式 URL 入口：`?low=1`、`?lowmem`、`?perf=low`；`?perf=normal` 可强制标准档
（硬件不足时仍会弹卡披露，不构成静默覆盖）。启动自检在 `new Engine()` 之前采集
`navigator.deviceMemory` / `hardwareConcurrency` / WebGL2 / `WEBGL_debug_renderer_info`，
结果写入 `window.__qingming.hwProfile` 与 `artifacts/boot-hw.json`。

**软渲染标记只影响「推荐档」判定，不自动进低配**：无头验收环境普遍是 SwiftShader，若据此
自动降档，标准基线与 A/B 对比会在不知不觉中换了口径。该观测项写进 `hwProfile.warnings`
并在提示卡里披露，用户仍可用 `?low=1` 手动切换。降级项在设置面板逐条列明（INV-04）。

当前 `solids 按坊预算` 尚未实施（PERF-003 `DEFERRED`），降级清单里如实标注，不冒充已降级。

## 启动实测矩阵（PERF-001 R1 首次真机采样）

| 指标 | 目标 | 本次实测 | 判定 |
| --- | --- | --- | --- |
| 启动堆峰值 (MB) | 1536<!-- {{json:memory-budget.json#limits.heapPeakMB}} --> | 6718.1<!-- {{json:memory-budget.json#overallMeasured.heapPeakMB}} --> | 超预算 |
| 强制 GC 后常驻 (MB) | 600<!-- {{json:memory-budget.json#limits.settledMB}} --> | 5793.7<!-- {{json:memory-budget.json#overallMeasured.settledMB}} --> | 超预算 |
| 完整启动耗时 (s) | 120<!-- {{json:memory-budget.json#limits.bootSeconds}} --> | 61.51<!-- {{json:boot-memory-profile.json#medianBootSeconds}} --> | 达标 |
| 进度最长停滞 (s) | 4<!-- {{json:boot-memory-profile.json#limits.maxProgressStallSeconds}} --> | 20.82<!-- {{json:boot-memory-profile.json#maxStallSeconds}} --> | 超预算 |
| 页面错误数 | 0（硬门） | 0<!-- {{json:spec/PERF-001.json#baseline.pageErrors}} --> | 达标 |

采样环境：本机 headless Chromium + SwiftShader 软渲染，**未加堆上限 / cgroup 限制**。
spec 审计参考机为 4C / 8GB cgroup，该口径曾在加载中途 OOM；本次 `booted=true` 不可外推为
8GB 参考机可用。参考机完整实测矩阵待 QA-008 / PERF-001 收口后补齐，此处不预填。

## 未达标归因与整改顺序

`artifacts/spec/PERF-001-boot-timeline.json` 记录按 `window.__phase` 的阶段增量归因：最大户是
`山河·地形` 及 `flush@山河·地形`，其次是 `flush@皇城·街巷铺装`。
新增的 `artifacts/spec/PERF-001-stage-attribution.json` 由 `Baker.stageStats()` 给出
**逐任务、逐界域的精确顶点/三角/属性字节**，不再是堆采样的近似分桶；
`artifacts/r27-tris-baseline.json` 显示 `leaf` 组独占 114316389<!-- {{json:r27-tris-baseline.json#groups.leaf.vertices}} --> 顶点，
是静态几何的第一大户。

**据此推翻旧判断**：人间独占几何量的绝大多数，单个任务 `皇城·街巷铺装` 就占过半；
天宫 + 地府合计只占一成不到，故「两界懒烘焙（R3）是主收益路径」不成立，已在
`artifacts/spec/PERF-001.json` 的 `specBackgroundErratum` 登记勘误并下调 R3 优先级。
整改顺序改为：低配装饰降档（本轮已落地，属已披露降级）→ 人间装饰几何的结构化治理
（indexed / instanced，须先证明画面等价）→ R2 时间切片削峰 → R4/R5 SoA 化。
标准档几何属性合计约 5.36GiB，与 600MB 常驻目标相差近一个数量级，
`feasibilityGap` 已量化该缺口并列出候选路径，等待 spec 裁决，不预选、不假达标。

`artifacts/spec/PERF-003.json` 据此把 solids 扩容决策记为 `DEFERRED`（不是达标）：
在堆峰值降到目标之前提升 `MAX_TOTAL` 会加剧内存危机，且路径 A 的前置 SoA 化尚未完成。

## 诚实边界

- 本文件的实测列**是当前未达标状态**，不是产品承诺；门槛达标前不得对外宣称「已满足硬件要求」。
- 低配模式是**已披露的降级**，不是性能达标证明；标准档启动内存门仍为 `FAIL`。
- `PASS(waived)`（FIX-004 cap 豁免）与 `PASS(capNotHit)` 分账：当前是前者，豁免单
  `artifacts/solids-budget.json` 带到期日与技术债条款，PERF-003 清零后删除。
