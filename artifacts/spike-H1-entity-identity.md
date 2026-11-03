# spike H1 · 实体身份：三套结构能否共用一套 id —— 结论报告

> H1（-1 风险验证第 4 项，`docs/重建-v2/全量工作清单.md` §-1）。日期：2026-11-04。
> 产物：`_spike/h1-entity-registry.mjs`（原型）、`_spike/h1-integration-map.md`（接入映射）。

## 判定

**GO —— 三套结构（crowd Actor / world 静态烘焙件 / physics 碰撞引用）可以共用一套 id：全部现状身份都可归一到「注册表独家发放的单调 id」，无结构性阻断；P0-1 按已批准设计（spec P0-1-实体表.md）实施，不需换模型。**

前提裁决（映射文档 §0）：**发号权必须收归注册表**。crowd 现在的 `idSeq` 挂在每个 Crowd 实例上，读档重建即从 1 重发号，已实际踩过跨批次串号 bug（crowd.ts:1168-170 的 BEAST_IDS 清理补丁即证据）——这恰是 P0-1「id 永不复用」要根治的 bug 类，原型 B3 断言演示了注册表续号如何消除它。

## 证据：原型运行输出（`node _spike/h1-entity-registry.mjs`，exit 0）

```
== 断言组 A：EntityRegistry 语义（P0-1 §2/§3 契约） ==
  PASS  ①a 10000 个 id 严格递增且唯一、首 id=1（0 恒无效）
  PASS  ①b 注销全部后再分配：新 id 全部高于历史水位且与旧 id 无一重复
  PASS  ②a 分配后 alive===10000
  PASS  ②b 全部注销后 alive===0 且 disposed===10000
  PASS  ③a 三个回调按 3→2→1 逆序执行
  PASS  ③b onDispose 内重入 dispose 同一 id：回调只跑一次且重入返回 false
  PASS  ④a 两次调用逐值一致（含 byKind 全字段）
  PASS  ④b 数值自洽：alive+disposed===allocated 且 alive===byKind 合计
  PASS  ④c forEach(kind) 计数 === byKind[kind]
  PASS  ⑤a 三连 dispose 返回 true,false,false，不抛错
  PASS  ⑤b 幂等不重跑回调（回调计数仍为 1）且 get===undefined、alive===false
  PASS  ⑤c get(0) 与 get(未分配) 返回 undefined
== 断言组 B：三套结构共用一套 id（集成模拟） ==
  PASS  B1 三套结构同表共存：alive===8，byKind 分账正确
  PASS  B2 dispose 后：注册表 get===undefined、碰撞索引同步摘除、其余 7 个不受影响
  PASS  B3 读档重建 crowd 后：注册表发号越过旧水位，不复用任何旧 id
  PASS  B4 物理端从表内遍历 collider：数量 === 3 block + 5 活 npc = 8（含 B3 读档新 npc）
== 汇总 ==  PASS 16 / FAIL 0   H1 prototype: ALL GREEN
```

任务指定的 5 条断言全部覆盖：①=①a/①b（id 单调不复用，含注销后再分配不越过水位即红）、②=②a/②b（10000 分配→全注销→alive===0）、③=③a/③b（onDispose 逆序 3→2→1，另加 onDispose 内重入不死循环）、④=④a/④b/④c（entityStats 纯函数逐值一致 + 自洽）、⑤=⑤a/⑤b/⑤c（重复 dispose 幂等 no-op 不抛错）。断言组 B 是 H1 核心问题的等比缩小集成模拟（npc + 纯逻辑 block + collider 槽 + onDispose 摘物理索引同表共存）。

原型无 randomness / 无时钟（ADR-3 友好），文件零 import（不与 src/ 的 TS 产生编译耦合）。

## P0-1 八条断言（A1–A8）：纯 Node 原型可验 vs 必须等 renderer

| # | 断言 | 纯 Node 可验？ | 说明 |
|---|---|---|---|
| A1 | alive === 场景实体总数交叉核 | ❌ 需接入 | 要和真实 `crowd.actors + beasts + creations` 对账，只能上浏览器探针（步 1 的验收本体） |
| A2 | id 严格递增无重复（1e4 去重） | ✅ 已验（①a/①b） | 纯逻辑，原型全绿 |
| A3 | dispose 后 get/alive/forEach 三处不可见 | ✅ 已验（⑤b、B2） | 纯逻辑 |
| A4 | dispose 幂等 true,false,false | ✅ 已验（⑤a） | 纯逻辑 |
| A5 | 注销后场景里 getObjectByName 找不到 + **render.calls 不回升** | ❌ 需 renderer | draw calls 只有接上 three/renderer 才有意义；这也是**唯一一条纯 Node 原理上就无法验的** |
| A6 | onDispose 逆序执行 | ✅ 已验（③a/③b） | 纯逻辑 |
| A7 | 无泄漏：全注销 alive===0；heap 不高于基线 5% | ✅ 前半已验（②b）/ ❌ 后半需浏览器 | `performance.memory.usedJSHeapSize` 是浏览器 API；Node 侧可用 `--expose-gc` 的 heapUsed 做近似但 spec 指定前者 |
| A8 | 同种子两次跑 stats 逐值一致 | ✅ 已验（④a） | 原型完全确定性；全量仿真的确定性复跑仍归 `probe-sim-determinism`（P0-1 §8 退出判据 4） |

小结：A2/A3/A4/A6 四条 + A7 前半 + A8 的 stats 部分已由纯 Node 原型证明；A1、A5、A7 的 heap 部分、A8 的全仿真部分必须等接入 renderer/场景探针（P0-1 §5 本就规定它们跑在浏览器内 `scripts/probe-entity-registry.mjs`）。

## 接入映射要点（详见 `_spike/h1-integration-map.md`）

- **crowd Actor**：现身份 `Actor.id`（实例私有 `idSeq`，crowd.ts:1144/1286）；接入 = spawnActor 尾部（crowd.ts:1359）补 allocate 并采纳注册表 id；**真 dispose 与软隐藏（`hidden`+respawn 复活，physics.ts:138-139）是两条语义，碎裂复活不走 dispose**。
- **静态烘焙件**：现无逐实例身份，`b.kit`（bake.ts:745）只是资产名台账；接入 = `object3d=null` 的纯逻辑实体（kind `block`/`building`），**b.kit 保持原职不替代**。
- **physics**：现以对象引用为键（launches/respawn，physics.ts:67-68），其无悬挂安全性自证于「actors 永不删」（physics.ts:258 注释）；接入 = EntityId 键 + onDispose 摘除钩子。
- **附带发现**：D1 运行时追加件还有第四套命名空间（字符串 `rt_*` + `unmountRuntime`），其依赖的 `LodManager.unregister` 未实现（待补）；建议数值 id 为唯一主键、string id 挂组件槽，实施时顺路核对缺口。

## 最大风险（一条）

**「真删除」语义与现状「永不删」安全假设的冲突（映射 §3 R3）**：physics 的 launches/respawn、模块级 BEAST_IDS/AVOID、`player.actor` 等全部押注引用永不变死；P0-1 步 3 一旦引入真 dispose，**凡持有实体引用的系统都必须在 onDispose 链上登记摘除钩子，漏一个就是隔帧崩溃**——这要求步 3 排在 P0-5（补 `removeUpdate`）之后，且每接入一个持有者就跑一次 A1/A3 探针。

## 对 P0-1 设计的修改建议

无（不需要换模型）。两点实施提醒写进映射：① 发号权收归注册表、`idSeq` 退役（步 3）；② dispose 只用于真移除，`hidden` 软隐藏语义保持独立。

## 验证记录（仓库未被本 spike 触碰 src/）

| 检查 | 结果 |
|---|---|
| `node _spike/h1-entity-registry.mjs` | 16 PASS / 0 FAIL，exit 0 |
| `npx tsc --noEmit` | 0 错（exit 0；tsconfig include 仅 src/tests，`_spike/`、`artifacts/` 不在编译范围） |
| `npx vitest run` | **6 files / 81 tests 全绿**（与基线一致，exit 0） |
| 新增文件 | `_spike/h1-entity-registry.mjs`、`_spike/h1-integration-map.md`、`artifacts/spike-H1-entity-identity.md`（本文件）；未改任何 src/ 文件，无 git 写操作 |
