# SPIKE H7 · 移动造物：setBounds 后 LOD 是否跟得住（-1 风险验证）

> 裁定：**GO** — P0-6 按「`unregister(id)` + `setBounds`」立项成立；范围**不扩**到几何级重烘焙，
> 但 `setBounds` 的语义必须同时覆盖**组包围盒**与**实例剔除体**两处（见 §3、§5）。
> 数据：`_spike/h7-move-lod.json`（30 帧/阶段真实采样，2026-11-05，RTX 4090 / three r180 / dev :4182 / shadowMap on）。
> 探针：`_spike/h7-move-lod.mjs`（未触碰 src/，测试件用页面内 THREE 克隆几何 `pool_hem`，40 tris × 64 实例）。

## 1. 三路径实测表

基线口径：开场运镜已停（`stopCinema('fly')`，相机静止）；基线 30 帧 calls 在 240↔378 间振荡但
**均值极稳（309±0.5）**，故各阶段以「均值增量」判读，分辨率 ±0.5 call。帧耗时各阶段全部 p50 8.4 / p95 16.7ms，无一劣化。

| 路径 | 移动后 LOD 档位 | draw calls 增量 | frustum 剔除 | 阴影 | 帧耗时 |
|---|---|---|---|---|---|
| **a. 实例化**（InstancedMesh 64 实例 + `lod.register`） | **不跟**：单实例 instanceMatrix 移 50m 后，组 `tier/want/dist` 移动前后逐值一致（near / 16m / 16m）——`register()` 拷贝的静态包围盒是唯一判档依据 | 恒 **+1**（±0.5 阴影抖动），与实例移到哪无关 | **剔除体陈旧**：64 实例全部移到相机背后后仍 +1 call（陈旧包围球心仍在原位 [-486,17,68] r=15.2）；手动 `computeBoundingSphere()` 后回落到 +0.5（整批剔除生效） | 跟随（阴影相机 ±120m 内 +0.5 call） | 不变（p95 16.7ms） |
| **b. 独立 Mesh**（scene.add，未注册） | 无距离 LOD：移到 2000m 外只要在视锥内仍 **+1**（`visible` 恒 true，无人管它） | 视锥内 **+1** / 移出视锥 **0**（回落到基线） | **正确跟随**：剔除按 `geometry.boundingSphere × matrixWorld` 逐帧算，移动免费 | 跟随（castShadow 后 +0.5） | 不变 |
| **c. 烘焙 city_*** | 不适用 | 单件**不存在**：37 个批次 / 56,696,487 顶点，最小批也是整类身份（`city_signs` 14,652 顶点），最大批 `city_roof_9` 547 万顶点 | 不适用 | 不适用 | 不适用 |

**注销路径（P0-1 A5 同族验证）**：`scene.remove` + dispose 后 calls 均值回到基线 309（A5「注销后不回升」在注册制对象上成立）；
**但 LodManager 组数 54 → 55 不回落**——`unregister` 缺口的直接实证（D1 §1.6 结论复现）。

**烘焙路径反证（读代码 + 页面枚举）**：`bake.ts` push 时即 `applyMatrix4` 把平移/旋转/缩放烘进顶点（bake.ts:810），
`flush` 出的每个 `city_<group>_<batch>` 是一整块 BufferGeometry（flush 段 :1314-1326，`matrixAutoUpdate=false`），
`compactStatic` 再把 273 → 36（页面控制台原文取证）。合并后场景里没有「某一栋楼」这个对象——
可移动的最小单位是整批材质批次，**移动整批的验证调用对 calls 无可测影响（单帧采样落在 240↔378 振荡带内，如实记录为不可分辨）**，
结构性证据（无逐对象索引、无逐对象变换）为定论依据。

## 2. 回答 H7 原问题

1. **LOD 判定跟不住 instanceMatrix**——组档位只由注册时拷贝的 `cx/cy/cz/hx/hy/hz` 对相机距离决定（engine.ts:308-314），
   移动实例后 dist/tier/want 逐值不变。造物飞 1km 后仍按出生点判档——工作清单 P0-6 行的担忧**实测坐实**。
2. **实例化路径的剔除体也不跟**——three r180 的 `InstancedMesh.boundingSphere` 只在首次 frustum 测试时计算，
   之后改 instanceMatrix 不自动重算：全批移出视锥照样提交 draw。`setBounds` 必须补 `computeBoundingSphere()`（计价：4096 实例 **0.4ms**，矩阵写 2.7ms，预算内）。
3. **独立 Mesh 的 frustum culling 与阴影自动跟随**（matrixWorld 逐帧进剔除），唯一缺口是没有距离 LOD——
   不注册就 2000m 照画；注册了则退回问题 1。
4. **烘焙路径跟不住，也无需跟**——顶点级合并后无对象身份，运行时移动在几何上不可表达。
5. **注销侧**：calls 回落成立，LOD 组泄漏成立 → P0-6 的 `unregister` 是硬前置。

## 3. 对 P0-6 范围的裁定建议

- **造物可移动的合法路径只有两条**：
  1. **批量同类造物 → InstancedMesh + 注册 LOD + setBounds**（推荐默认）：draw 恒 +1/批，移动 O(1)，
     setBounds 一并刷新组 bounds + `computeBoundingSphere()`（≤1ms @4096 实例）。
  2. **少量独特造物（走 D1 §4.2 判据的独立 Mesh）→ scene.add + 注册 LOD + setBounds**：
     frustum/阴影免费跟随；远场必须给非空 far 档或剪影卡（空档 = 永不隐藏，D1 §4.4）。
- **烘焙路径造物：必须禁止运行时移动**。需要改动的造物不得烘焙进 `city_*`；改动的正规入口是
  **离线重烘焙**（改 S10 生成链 → 重跑 flush，进 `engineMs` 账，不走运行时预算）。
- **范围不扩**：不需要为移动引入运行时重烘焙、BatchedMesh 重建或 walkSurface 全量重建（那是 D1-8 的局部失效议题）。
  P0-6 保持 `unregister(id)` + `setBounds(id, bounds)` 两个 API，但 setBounds 落点必须是
  LodManager（组六元组）+ 实例剔除体两处的**同一事务**。

## 4. 风险（一条）

**批内空间发散**：InstancedMesh 的 LOD 档与剔除只有**整批**粒度——造物各自被移动后，同批实例在空间上越散，
包围球越大，整批越接近「永不剔除」，且远处实例仍按批次当前档（近档）画满。若 S10 允许高频随意移动，
应按「落点聚类」分批（如 8m 网格哈希，H2 已给出同族结构）而不是全体挤一个 InstancedMesh。

## 5. 对 P0-6 spec 的一条修订建议

把 `setBounds` 从「只更新 LOD 包围盒」修订为**一个事务入口 `setBounds(id, aabb)`**，语义 = ①写组六元组
（cx/cy/cz/hx/hy/hz）②对 InstancedMesh 调 `computeBoundingSphere()` ③置 `instanceMatrix.needsUpdate`；
并加两条可机检验收断言（接 P0-1 A5 探针）：
- **A-move**：注册造物移动 50m（跨一档 LOD_ENTER 边界）并 `setBounds` 后，该组 `dist/want/tier` 一帧内反映新位置；
  对照组（只移不 setBounds）逐值不变——本 spike 已采到该对照基线（A2 组快照移动前后逐值一致）。
- **A-leak**：`register → setBounds → unregister` 循环 N 轮后 `groups.length` 与 `renderer.info.memory.geometries` 回初值
  （本 spike 实测现状泄漏：54 → 55）。
- 附带一句实体表规则：`object3d.name.startsWith('city_')` 的对象在 P0-1 表内**不得开放移动/注销 API**（kind='building' 只读）。

## 6. 数据真实性声明

所有数字来自 `_spike/h7-move-lod.json`（页面内逐 rAF 采样，未编造）。已知口径限制，如实登记：
① 基线 calls 240↔378 振荡为页面既有行为（与运镜无关，均值 309 极稳），故 ±1 call 信号以均值增量判读；
② 实验 c 的「移动整批」单帧采样落在振荡带内，calls 不可分辨——烘焙路径不可移动的定论依据是结构证据
（单块 BufferGeometry、`applyMatrix4` 预烘变换、无逐对象索引）而非该次采样；
③ `city_signs.boundingBox` 当时为 null（未预计算），跨度字段缺失不影响结论。
