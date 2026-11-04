# H4 存档 IndexedDB spike 结论（2026-11-04 · agent 脚本 + ZCode 代跑收口）

**判定：GO——28.7MB 存档可在 IndexedDB 原子写，P0-4 不降级为「只存 spec」。**

> 执行说明：H4 agent 中途死亡（通知丢失，output mtime 03:45 vs 现在 23:23），但其交付的
> `_spike/h4-idb-save.mjs` 完整且超预期（自发发现 about:blank 是 opaque origin 拒 IndexedDB，
> 改为临时 127.0.0.1 零脚本空页服务）。ZCode 代跑收口，全量数字在 `_spike/h4-idb-save.json`。

## 一、A/B 实测（各 5 轮，payload 28.95MB 确定性构造，实体 60,825/体素字符 361 万）

| 指标 | A 原始 JSON | B deflate-raw 压缩 |
|---|---:|---:|
| stringify | p50 43.6 | 43.9 |
| 压缩 | — | **+601.5** |
| put（含事务提交） | 209.5 | 40.5 |
| **写入合计** | **p95 260** | **p95 691.7** |
| 读回+校验 | 94 + 126 | 3.6 + 166 |
| SHA-256 一致 | ✅ | ✅ |
| longtask 主线程阻塞 | 1 次 max 81ms | 1 次 **max 110ms** |
| estimate 落盘占用 | **17.2 MB** | **38.22 MB** |

**反直觉定案：手工压缩是负收益，方案 A 胜出**——put 只省 169ms，压缩吃掉 601ms；且落盘占用 B 反而大 21MB，**证实检索预期：Chrome 存储层对原始字符串已自动压缩（Snappy），再手工压是双重浪费**。B 的唯一优势（读回 inflate 前 3.6ms）无场景价值。

## 二、原子性（双 store 同 readwrite 事务，4 子例全过）

| 子例 | 结果 |
|---|---|
| 对照：双写成功 | complete，keys=[save:v1]，lastGood=save:v1 |
| 注入：第二 store 请求错误 | **事务自动 abort，v2 回滚，lastGood 保持 v1** |
| 失败后继续写 | DB 未被毒坏，complete |
| 显式 tx.abort() | v3 回滚 |
| ⚠️ **坑：put 同步抛 TypeError** | **事务照常 complete，v4 半写提交** |

## 三、配额/持久化/恢复

- quota **10 GB** / 用量 0——28.7MB 量级无压力；**persist() = false**（P0-4 实施时必须申请持久化授权，否则Eviction 可能回收）。
- 恢复演练：v3 写坏（尾部截断 512KB）→ parse 失败 → **自动回退 v2 → hash 校验通过**（版本化槽位 + 最后好档机制成立）。

## 四、对 P0-4 spec 的修订（强制）

1. **存档 = 方案 A**：原始 JSON 字符串 + 单 readwrite 事务双 store（slots + index）；**禁止手工 deflate-raw**（负收益双重压缩）。
2. **同步抛错坑必须绕开**：所有 put 的 value 必须先 stringify 成功再进事务；put 调用包 try/catch，catch 里显式 `tx.abort()`——否则半写提交（实测实锤）。
3. **版本化槽位 + lastGood 指针 + 截断回退**：按实测演练的 v2/v3 机制实现，`probe-save-atomic`（P0-4 验收探针）必须包含「写坏→回退→校验」三步断言。
4. **persist() 授权**：进 Electron 主流程启动时申请；denied 时 UI 提示。
5. 载入性能已知：29MB 读回+解析 ≈ 220ms（A 口径）——存档动作用户触发，可接受；载入期不在关键路径。

## 五、诚实备注

- payload 为确定性合成（mulberry32，实体/任务/物品/体素四段混合）——与真实存档结构同量纲同量级（28.95 vs 目标 28.7MB），但字段分布非逐字节真实；**P0-4 探针须在真实存档序列化上复测一次**。
- 空白页含 1 个资源请求（临时服务自身），污染告警已记录，不影响计时结论。
- 与 V10 卷（多人存档确定性）的关系：V10 的多人部分仍属 P2 远期，本 spike 只裁单人存档形态。
