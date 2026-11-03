# E1 npcSweep 性能切片结论（2026-11-04 · ZCode inline）

**判定：已修，但严重度降级——基线实测推翻了审计 P1-3 的"帧尖峰"预估；收益定性为 GC 分配削减（微优化），非帧预算修复。**

## 实测数字（同探针前后对比，probe-npc-sweep-cost.mjs）

| 指标 | 修复前（BASELINE） | 修复后（AFTER） |
|---|---|---|
| 单次 npcSweep p50/p95/max | 0 / 0.03 / 0.1 ms | 0 / 0 / 0.1 ms |
| mean | 0.003 ms | 0.002 ms |
| 负载 | walkers 2013 × vehicles 16（clone 代理 32,208/次） | 同左 |
| 采样 | 12s / 39 次调用 | 12s / 40 次调用 |

**关键事实**：审计 P1-3 假设 walker≈4400、clone 全量——实测 filter 后 walker 仅 2013，且绝对耗时 **p95≈0.1ms**，对 16.7ms 帧预算占比 0.6%。**"O(车×人) 帧尖峰"不成立**；真正的影响是 clone 分配 ≈10.6 万次/秒的 GC 压力（H5 噪声分支的嫌疑源之一）。

## 改动（两处，严格限定授权范围）

1. `src/world.ts:1330`：filter 新数组 → 复用 `_npcWalkers` 原地压实（省 ≈13 个 2000 元素数组/秒）；npcSweep 内部仍复查 `hidden`，缓存不过期安全。
2. `src/game/physics.ts npcSweep`：平方距离粗判（零分配）先滤，粗判过才 clone 精判（判据域严格等价：d2>4.84 ⇔ d>2.2，d2<0.0001 ⇔ d<0.01）；`clock()` 从每 walker 调用提升为每次 sweep 一次（同步循环内时钟无推进，语义等价）。

## 验证链

```
npx tsc --noEmit → 0 错
npx vitest run → 6 files / 81 tests 全绿
node scripts/probe-determinism.mjs → A 类 7 文件 0 命中 RESULT=PASS
probe-npc-sweep-cost：BASELINE/AFTER 双份 JSON 落盘（artifacts/）
```

## 对账本的连带修订

- 审计 §2 P1-3 的严重度（P1→P2）与 E1 的定位应按本结论修正：**遗留价值 = GC 压力削减，已做**；P2-10 的其余分配点（player/units/havoc/tween 每帧 new Vector3）预期同样低危，维持"成组验证后再做"。
- E1 关闭。
