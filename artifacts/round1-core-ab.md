# 第 1 轮 · core-expert 运行时 A/B 实证 + 红队答辩（`round1-core-ab.md`）

> 角色：被审方答辩人 + 运行时实证官（core-expert）。
> 授权产物：本文件；临时探针 `scripts/_core_ab_*.mjs`（命中 `.gitignore:30 scripts/_*.mjs`，不进仓库）。
> 纪律：**未修改任何 `src` 源码、未跑 `npm test` / `tsc`、未跑构建**；探针只连已运行的 dev server、只读页面对象、只做同步调用。
> 实证窗口：`2026-11-07 06:18–06:20 +0800`，针对审核基线 `be0226e`。复核时间 `06:20:46`。
> 红队输入：`artifacts/round2-red-team.md`（落盘 `06:13`）`§2.5 core-expert（14 条）`。
> 答辩分类口径：**维持 / 接受下调 / 补充证据**（team-lead 指定）。实证标注：**【已证实】【已证伪】【无法验证】**。

---

## 〇、方法、纪律与两个必须先读的前提

### 0.1 探针与复跑
- 主探针：`scripts/_core_ab_v2.mjs`（`puppeteer-core` + `scripts/chromePath.mjs`），连 `http://127.0.0.1:4182/`（vite dev server，实测 `HTTP 200`，页面含 `/@vite/client`）。
- 前置：`window.__qingming`（`main.ts` 暴露 `world / engine / THREE / scene`）就绪、`#loading` 消失。
- 复跑命令：`cd <项目根> && node scripts/_core_ab_v2.mjs`（需 4182 在线、`CHROME` 可解析）。
- 保留备查：`scripts/_core_ab_probe.mjs`（v1）、`scripts/_core_ab_diag.mjs`（极简诊断，证明页面可稳定 evaluate）。

### 0.2 v1 失败与 v2 修正（避免第 2 轮把「探针异常」误读成「结论异常」）
- v1 在**单个 async `page.evaluate`** 里 `await import('/src/game/survival.ts')`，该 `await` 让出事件循环、后台 rAF / Vite HMR 介入，报 `Execution context was destroyed, most likely because of a navigation.`
- v2 修正四条：① 不动态 import，直接用 `window.__qingming.world.survival.constructor` 取类；② 每个实验拆成**独立的同步 evaluate**（无 `await`，浏览器 rAF 无法插入）；③ `performance.now` 的 stub 与恢复严格包在**同一个同步 evaluate 的 `try/finally`** 内；④ Node 侧逐实验 `try/catch`，单个失败不丢其余结果。
- 最终运行：`errs: []`、`navLog` 仅一次初始导航、`nowRestored: true`，四个实验全部返回结果。

### 0.3 【重要】并发修复与行号漂移（本文件所有 `file:line` 的读法）
主线程任务 #9「批次 A：交互死锁 / 经济闭环 / 输入层修复」在实证期间并发改了 `src`（复核时 `git status --short -- src` 有 10 个 M）。两条前提必须钉死：

1. **实证所依赖的代码行均未被并发修复触及**（已逐条 `git diff` 核实）：
   - `src/game/survival.ts` 在 `06:20:04` 被改动（C14 修复），**晚于我最后一次探针运行**；故本文件 C14 数据反映的是审核基线，且该修复注释明确写「全量审核 2026-11-07（C14）」——**修复本身反证 C14 成立**。
   - `src/actors/crowd.ts`、`src/game/physics.ts`、`src/actors/behaviors.ts` **未被改动**；`src/world.ts` 的 `attach` 组（`442-451` / `485-498`）、`onFaint` 链、`new Crowd/ImpactSystem` 未注入参数均未改动（`git diff -- src/world.ts` 对 `attach|performance.now|onFaint|revive|I.save|out.pos` 零命中）。
   - `src/game/interact.ts` 的 `save()` 写 `survival.serialize()` 一行未改动（并发改动只在 `survivalSink` 与 `burnpaper/冥途牒` 分支）。
   - 结论：**C06/C08/C14 的运行时证据仍对审核基线有效**；若现在复跑探针，C14 会得到「已修复」结果，这不是证伪。
2. **行号漂移**：本文件 `file:line` 以【审核基线 `be0226e` / `round1-core.md` / red-team 裁决所用编号】为准；当前工作树因并发修复已漂移，对照如下（探针读的是当前工作树，但依赖行未变）：

   | 位置 | 审核基线 | 当前工作树 |
   |---|---|---|
   | `new Crowd(scene, buildNav())` | `world.ts:345` | `:383` |
   | `new ArenaBoss(...)` | `world.ts:778` | `:816` |
   | `codexLog.some(...)` if（onDefeat） | `world.ts:786` | `:824` |
   | `addPeach(2)/earn(300)/playerWeapon=4.0` | `world.ts:792-798` | `:830-833` |
   | `new ImpactSystem(this.crowd, this.vfx)` | `world.ts:858`（red 记 858 / 我稿记 860） | `:898` |
   | `onFaint` 内 `I.save()` / `revive()` | `world.ts:846 / :851` | `:848 / :853` |
   | `survival: sv.survival.serialize()` | `interact.ts:87-94` | `:102 / :107` |
   | attach 桥面 / 城墙组 | `world.ts:442-451 / :485-498` | **未漂移** |

### 0.4 验收断言口径（与另两份产物自洽）
- `round1-play.md` 文件头：其每条「验收断言」是**修复目标 / 修复后期望**，在当前基线上均会失败。
- `round1-core.md` 的 I1/I1b/I6 是**暴露式断言**（如「期望 `onFaint` 1 次 / 实际 0 次」），用于证明缺陷存在。
- 本文件实证断言是**缺陷存在性证明**（暴露式），不是「当前已通过」。三者互补，不冲突。

---

## 一、运行时 A/B 实证结果

### 实验 A · C14 读档 `hp=0` → `fainted` 吸态 ——【已证实】

方法：用 `world.survival.constructor` 直接 `new` 两个独立 `Survival` 实例（零 import）。A 组走真实读档路径 `deserialize({hp:0,hunger:0,faints:5,bossesDown:2})`；B 组唯一变量 = 把预置的 `fainted` 清回 `false`。两组的 `onFaint` 都挂计数器。

| 观测点 | A 组（真实读档） | B 组（对照：清 `fainted`） |
|---|---|---|
| `deserialize` 后 `fainted` | `true` | `true` → 手动置 `false` |
| `tick(0.1)` 后 `onFaint` 次数 | **0** | **1** |
| `tick(0.1)` 后 `faints` | `5`（不变） | `6`（`+1`） |
| `tick(0.1)` 后 `hp` / `fainted` | `0` / `true` | `0` / `true` |
| 再 `tick(1.0)` 后 `onFaint` 累计 | **仍 0**（`hp=0`、`fainted=true`、`faints=5` 冻结） | — |

补充观测：
- `snapAtFaint`（`hp=0,hunger=0,fainted=false` 的 `serialize()`）= `{hp:0,hunger:0,faints:0,bossesDown:0}` → **闭合写档链**：这正是 `world.ts:848` 在 `onFaint` 内、`revive()` 之前调 `I.save()` → `interact.ts:107` 写 `survival.serialize()` 落盘的快照。
- `deserialize` 源码回读确认 `fainted` **不从 state 读**，而是末行重算 `this.fainted = this.hp <= 0`（`survival.ts:101`）——`SaveDataV2.survival` 根本不含 `fainted`（`save.ts:42-54`）。
- 边界对照：`deserialize({hp:60,...})` → `fainted = false`，正常档不误伤。
- 后果精确化：`fainted` 为 `private`，全仓只在 `survival.ts:34/46/47/56/64/65/101` 被读 → **不是「游戏卡死不能动」**，而是「晕倒沿 `hp<=0 && !fainted` 永久失效 → 罚金 / 孟婆庄传送 / `faints++` / hp 复位链永久失效」的**状态机吸态**（与 play-expert 精确化一致）。

结论：四步链（`world.ts:848 I.save()` 早于 `:853 revive()` → 档里 `hp=0` → `survival.ts:101` 预置 `fainted=true` → `:46/:64` 沿恒 false → `revive()` 只由 `:853` 调形成闭环）在运行时**逐步复现**，【已证实】。

---

### 实验 B1 · 生产实例 `clock` / `rng` 是否注入 ——【已证实】

| 观测 | 运行时值 | 判读 |
|---|---|---|
| `w.crowd.clock` 源码 | `() => HOST_PERF.now()` | 默认 `hostClock`（`crowd.ts:1159`、`behaviors.ts` 定义），**墙钟**，未注入 |
| `w.impacts.clock` 源码 | `() => HOST_PERF.now()` | 同上（`physics.ts:29`），**未注入** |
| `crowdEqualsWall` / `impactEqualsWall` | `true` / `true`（差 <5ms） | 与 `performance.now()` 同刻度 |
| `wallMid_ms` | ≈ `30157.3` | — |
| `engineT_ms` | ≈ `323.1` | 引擎累计 `t` 仅 ~0.3s |
| `crowdDeltaFromSimT_ms` | ≈ `29834.2` | 墙钟比仿真 `t` 快 ~30s → **双时钟 / 未注入**（C10） |
| `w.crowd.rng` 源码 | `() => { s = s + 1831565813 >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t \| 1); ... }` | 固定种子 mulberry32 **模块级单例流** = `LEGACY_RNG`（C08） |

假绿对照（代码级复核）：
- `scripts/probe-sim-determinism.mjs:263-279` 三个 `ImpactSystem` 分别注入 `()=>1000` / `()=>5000` / `()=>0` —— 门验的是**注入路径**。
- `scripts/probe-determinism.mjs:29-37` `SIM_FILES` 只含 `physics/behaviors/crowd/player/boss/havoc/interact`，**不含 `world.ts` / `units.ts` / `bake.ts`**；且 `:12-13` 自认「静态文本匹配，未命中不代表确定」。
- 生产 `world.ts:345` / `:858` 从不注入 → 门与生产路径实质分叉（与 motion-expert M-14 同源）。

定性分离保持：`LEGACY_RNG` **不是墙钟、不是 `Math.random`**，是固定种子确定性流；其风险是「模块级单例状态 + 单实例内多 actor 共享 / 调用顺序耦合 + 跨会话不重置」（C08）；墙钟归 C06/C10。

---

### 实验 B2 · attach 位置是 `performance.now()` 的纯函数 ——【已证实】

方法：对全部 `attach` 演员直接调 `a.attach(out)`（`out.pos` 用真实 `THREE.Vector3` 以兼容 `units.ts:297` 的 `out.pos.copy(sd.pos)` 与 `world.ts:448` 的 `out.pos.set(...)` 两种变体），在墙钟 `100000ms` / `105000ms` / 再次 `100000ms` 三次取位置串。

| 观测 | 值 | 判读 |
|---|---|---|
| `attachCount` | `216` | 全量 |
| `movedCount`（+5s 墙钟位置改变） | **`158`** | 位置由 `performance.now()` 驱动的组 |
| `unmovedCount` | `58` | `src/city/units.ts` 轿/坐骑组：`out.pos.copy(sd.pos)`，已 grep 确认 `units.ts` **无 `performance.now`**，非 C06 对象 |
| `repeatIdenticalAtSameWallClock` | **`true`** | 回到 `100000ms` 输出逐字节一致 → attach 是墙钟的**纯函数**，非状态累积 |
| `nowRestored` | `true` | stub 已在 `finally` 恢复，未污染页面 |

**定量核对（可直接复算）**：桥面组 `world.ts:444` `tt = performance.now()/1000*2.0 + phase` → 墙钟 `+5s` 使 `tt +10` → `m`（`:445`）+10 → `z`（`:447-448` 的 `z = -36+m`）+10。样本完全吻合：

```
i=0  at100000: z=20.000   at105000: z=30.000   Δz=+10
i=1  at100000: z=30.100   at105000: z=20.100   （dir 翻转，符合 :446 `Math.floor(tt/span)%2`）
i=2  at100000: z= 8.200   at105000: z=-1.800   Δz=-10（dir=-1 分支 `z=36-m`）
```

结论：`crowd.ts:2053` 把 `a.pos` 位置引用交给回调、`world.ts:442-451 / :485-498` 回调直调 `performance.now()` 并 `out.pos.set(...)` 写回 —— **NPC 位置（运动状态）本体由墙钟算出**，且**绕过 Crowd 的 clock 注入接口**（注入只进 `crowd.ts:2040` 的 `now` / `:2052` 的 `impactUntil` 判定）。【已证实】

**【已证伪】一处潜在夸大**：「全部 216 个 attach 演员位置都随墙钟变化」不成立 —— 仅 158 个；`units.ts` 的 58 个轿/坐骑组由各自系统定位。此收窄用于界定 C06 影响面边界，避免把非墙钟组算进来。

---

### 实验 B3 · 同 dt 序列 `renderOnce` 位置哈希（I6 要的「回放分叉」）——【已证实】

受控设计（关键）：
1. 先做双钟探测，挑出「位置 = f(`performance.now`)」的 **158 个** actor 子集（与 B2 的 `movedCount` 一致，互为交叉校验）。
2. 只哈希该子集的 **live `a.pos`** —— attach actor 的位置每帧被 `a.attach({pos:a.pos})` 从墙钟覆写，且 `crowd.ts:2056 keepOnBridgeDeck` / `:2058 keepOffRiver` / `:2061 walkSurface` 均对 `a.attach` 早退，**免疫 dt 积分累积**。
3. 同步 evaluate，无 `await`，后台 rAF 无法插入；每次序列重置 `e.t = tSaved`，跑 `3 × renderOnce(1/60)`。

| 序列 | 墙钟 | 结果 |
|---|---|---|
| `h1` | `100000ms` | `sha1 = d254388316047b5f` |
| `h2` | `105000ms` | `sha2 = 1fc9ac3c4b2f2b7e` |
| `equal` | — | **`false`**（异墙钟 → 位置哈希不同） |
| `h1b` | 回到 `100000ms` 复跑 | `sameClockEqual = true`（同墙钟 → 逐字节一致） |
| `err` | — | `null` |

`h1Head = "-1.700,7.642,20.000|0.000,5.797,30.100|..."`、`h2Head = "-1.700,5.819,30.000|0.000,7.627,20.100|..."`，与 B2 的 `at100000/at105000` 头部完全一致，`Δz=+10` 再次吻合 `*2.0` 系数。

**`sameClockEqual = true` 是本实验的控制组**：它排除了「连续 `renderOnce` 序列本身的状态累积」这一混淆项，证明 `h1≠h2` **只由墙钟差异引起**。这正是 `round1-core.md` I6「相同 dt 序列两次跑位置哈希分叉」的运行时坐实。

**负结果记录（防止第 2 轮误读）**：初版对**全 216 个** actor 直接哈希得到 `sameClockEqual = false`。定位为 `units.ts` 轿/坐骑的 `sd.pos` 每帧 `dt` 积分累积（连续序列起点状态不同）所致，**不是**墙钟证据的反例；改为「只哈希墙钟驱动子集」后控制组通过。此修正过程如实登记。

---

### 实验 C · C02 / C07 / C11 / C12 的运行时影响面 ——【无法验证（本轮）】

- 本轮 A/B 探针只覆盖 C14 与 C06/C08，**未构造** IndexedDB `tx.onabort/onerror` rejection、`__saveSave` 永不注入、坏档 `{"schemaVersion":2}` 回退、IDB `open()` 与首次写档竞态、NaN/Infinity 落档等场景。
- 因此对这四条**不升级、不反驳**：C02「玩家静默丢档」、C07 影响面、C11 竞态、C12 污染路径一律**维持红队「维持疑似 / 影响面疑似」**。
- 相关代码级根因已在 `round1-core.md` C02/C07/C11/C12 给出，红队 `§2.5` 亦全部维持根因，无分歧。

---

## 二、对 `artifacts/round2-red-team.md §2.5` 逐条答辩（C01–C14）

> 红队五类裁决：`【维持确认】/【下调为疑似】/【剔除：误判】/【剔除：设计取舍】/【修法需修正】`。我的答辩按 team-lead 三类：**维持 / 接受下调 / 补充证据**。

| ID | 红队裁决（摘要） | 我的答辩 | 分类 |
|---|---|---|---|
| **C01** | **修法需修正**：`karma`/`entities` 写了不读【维持：真缺陷】；`codexLog/objectiveDone/playerWeapon/creationCount/玩家位置` 未定义于 `SaveDataV2:42-54` →【剔除：设计取舍】；「补 codexLog 入档」堵不住刷奖励（`world.ts:786` if 只包 `push`、奖励 `:792-798` 在 if 外）→ 修法须改 | **接受下调**：把未定义字段从「缺陷」降为设计取舍/play 侧设计缺口，不作独立缺陷计数；我原 C01 现象把它们作为「不对称」例证列出，核心仍是 `karma.deserialize` 零调用 + `collectPersistedEntities()` 零调用（红队 `§3.1` 亦维持）。**接受修法订正**：有效点是 `world.ts:786` if 作用域扩大到 `:792-798` 奖励段（或 `boss.defeated` 入档），补 codexLog 入档无效 —— play-expert 已在 `round1-play.md §4.2` 同步此精确化（「单会话靠 `ArenaBoss.defeated`、跨会话防重失效」）。当前工作树该段漂移至 `:824 / :830-833`，结构未变。 | 接受下调 + 补充证据 |
| **C02** | 维持确认（根因）/ 影响面疑似 | 维持根因（`void __saveSave` 无 `.catch`、`try/catch` 挡不住 Promise rejection、`world.ts:772/334` 无捕获）。本轮未构造 IDB rejection 运行时，**不争影响面升级**，接受「玩家静默丢档」维持疑似（见实验 C）。 | 维持（部分接受） |
| **C03** | 维持确认（能力缺失）/ 修法排期；当前不可观察 | **接受下调**：`Bus` 无 `off/once/clear` 是「清理能力缺失、当前单实例不可观察」，与我 `round1-core.md C03` 自述「`main.ts` 单次 boot 不触发」完全一致；接受跨 world/audio/vfx/physics/ui 全订阅点大改 → 排期。 | 接受下调 |
| **C04** | 维持确认（能力缺失）/ 修法排期 | **接受下调**：同上，rAF 无 id / 无 `dispose()` / 监听器零移除属清理路径缺失、非可观察故障；接受排期。 | 接受下调 |
| **C05** | 维持确认 / 修法排期（注入 RNG 会改全部贴图 → 须重跑 `I5` + 全部复拍） | 维持；**接受修法排期**与 `I5`（贴图 canvas sha256）+ 复拍前置，反对静默改贴图。`Math.random` 非确定源代码级成立，无异议。 | 维持 + 接受排期 |
| **C06** | 维持确认 / **影响面疑似**（「回放分叉/切后台瞬移」需 `I6` 坐实） | 维持定性；**补充运行时硬证据**：实验 B2（158 个 attach actor 位置 = `performance.now` 纯函数、`repeatIdenticalAtSameWallClock=true`、`Δz=+10` 吻合 `*2.0`）＋ 实验 B3（受控 `renderOnce` 同 dt 序列异墙钟 → `sha1≠sha2`、**`sameClockEqual=true`** 排除状态累积混淆）＝ `I6` 要的「回放分叉」已坐实。**请求把「影响面疑似」升级为「运行时已坐实」**。完整 `I6` 验收仍按我原断言落地：`performance.now` 递增 stub + 冻结 `Date.now`、`renderOnce(1/60)×120` 两次、显式含 attach 组。门假绿由 B1 证实。 | **维持 + 补充证据** |
| **C07** | 维持确认 | 维持。`migrate()` `schemaVersion===2 return d` 原样放行、`world.ts:331` 未保护访问 → 坏档抛 `TypeError` 被 `:334` 吞成新档；触发面窄（半写/损坏/跨版本档）已在原稿注明低概率。 | 维持 |
| **C08** | 维持确认（架构层）；「LEGACY_RNG 定性分离」被红队明确肯定「做得对」 | 维持；**补充证据**：B1 运行时读回 `w.crowd.rng` = 固定种子 mulberry32 模块级流（`s = s + 1831565813 >>> 0`，非墙钟非 `Math.random`），`crowd.clock`/`impacts.clock` = `() => HOST_PERF.now()`（生产未注入，与 `probe-sim-determinism.mjs:263-279` 注入路径形成「门 vs 生产」实证对照）。接受「单一 `WorldRng`」大改排期。 | 维持 + 补充证据 |
| **C14** | 维持确认：真缺陷 / **修法需修正**；影响面须收窄（非卡死）；「只改 deserialize 的 `fainted=false`」不根治，须改 `world.ts:846` 写档时序或 `fainted` 入档 | 维持真缺陷；**补充证据**：实验 A 运行时 A/B 坐实吸态（A 组 `onFaint` 0 次 / B 组 1 次、`faints 5→6`、二次 `tick` 仍冻结），`snapAtFaint hp=0` 闭合写档链。**接受影响面收窄**（我原稿已自述「非卡死不能动」）。**接受修法修正**：根治须改 `world.ts:848 I.save()` → `:853 revive()` 之后，或把 `fainted` 显式入档；我原「最小修法」虽把时序列为并列选项，但排序应以后者为主，deserialize-only 仅防御补丁。另见下方提醒 1：主线程 `06:20:04` 落地的**正是**本裁决标注「不根治」的 deserialize-only 补丁。 | 维持 + 接受修法修正 + 补充证据 |
| **C09** | 维持确认 | 维持，无异议（`focusPos` 原点初值 → 补间全程视线拉偏，可逐步复算）。 | 维持 |
| **C10** | 维持确认 / 修法合并排期（与 C06 同源，统一注入 `()=>engine.t*1000`） | 维持；接受合并排期。**补充**：motion-expert 已把「attach 组连注入 clock 也救不了」（`crowd.ts:2053` 交位置引用 + `world.ts:444/486` 直调墙钟）并入其 M-14；我 `round1-core.md C06` 已改为「注入时钟 + 单独改 attach 用仿真 `t`」两条并列修法、`I6` 显式含 attach 组。B1 的 `crowdDeltaFromSimT ≈ 30s` 是双时钟的运行时读数。 | 维持 + 补充证据 |
| **C11** | 维持疑似 | 接受维持疑似；E-04 B3 未测 IDB open 竞态，本轮亦未测（实验 C），不升级。三币落 localStorage 可能被 legacy 自愈，保持原「疑似」定性。 | 维持（接受） |
| **C12** | 维持疑似 | 接受维持疑似；无确凿 NaN/Infinity 污染路径，不升级。 | 维持（接受） |
| **C13** | 剔除：设计取舍 | **接受下调**：我原定性即【设计取舍非缺陷 / 已登记项】（`FixedStepLoop` 零调用、`frameMs.shift()` 重复两行、预留事件、LOD LCG、`boot().catch()`），与裁决一致，不争。 | 接受下调 |

**答辩统计**：维持 6（C02/C05/C07/C09/C10 及 C06/C08/C14 的定性）、接受下调 5（C01/C03/C04/C13 + 各排期/影响面收窄）、补充证据 4（C01/C06/C08/C10/C14，其中 C06/C14 为运行时硬证据）。**无一条被红队剔除为误判或下调为疑似**（除我主动接受的「当前不可观察 / 影响面收窄」）。

---

## 三、给 team-lead 的三点提醒（超出逐条答辩，但影响修复闭环）

1. **C14 已落地修复是「不根治」的那一版**。`06:20:04` 的 `src/game/survival.ts` 改动只把 `deserialize()` 末行改为 `this.fainted = false`；我复核当前 `src/world.ts:844-854`，`I.save()`（`:848`）**仍在** `revive()`（`:853`）之前，写档时序根因未除。`survival.ts` 新注释写「写档时序这一根因已在 world.ts 修复」与代码不符。后果：档里仍会瞬时写入 `hp=0`；读档虽不再永久锁死（`fainted=false` → `tick` 触发 `onFaint` → 再罚一次半铜钱 → `revive()`），但每次载入该档都会**重复一次罚金/孟婆庄传送**，且 fire-and-forget 的 `hp=0` 档与 `hp=60` 档存在落地竞态。建议按红队 `§五:253` 补 `world.ts:846` 时序（把 `I.save()` 移到 `revive()` 之后）或把 `fainted` 显式入档。
2. **C06/C08 影响面已有运行时硬证据**，建议把红队 `§2.5` 的「影响面疑似」升级为「运行时已坐实（回放分叉）」；`I6` 完整验收按我原断言带「120 帧×递增 stub + 显式含 attach 组」落地，避免只测 `behaviors/physics` 注入路径再次假绿。此证据同时支撑 motion-expert 的 M-14。
3. **C01 修法按红队订正落地**：堵「读档刷 300 文 + 2 蟠桃」的唯一有效点是 `world.ts:786` if 作用域扩大到 `:792-798` 奖励段（或 `boss.defeated` 入档），补 `codexLog` 入档无效；`world.ts:328-330` 补 `karma.deserialize(saved.karma)`、`interact.ts` 改调 `collectPersistedEntities()` 仍是「写了不读」的最直接修复。

---

## 四、产物与复核入口

| 文件 | 用途 |
|---|---|
| `artifacts/round1-core-ab.md` | 本文件（实证 + 答辩） |
| `scripts/_core_ab_v2.mjs` | 最终探针（4 个同步实验，`node scripts/_core_ab_v2.mjs`） |
| `scripts/_core_ab_probe.mjs` | v1（因 async import 报 context destroyed，保留备查） |
| `scripts/_core_ab_diag.mjs` | 极简诊断（证明页面可稳定 evaluate） |
| `artifacts/round1-core.md` | 第 1 轮 14 条原始结论 + 不变量清单 |
| `artifacts/round2-red-team.md` | 红队 `§2.5` 裁决输入 |
| `artifacts/round1-play.md` / `round1-motion.md` | 玩法经济后果 / M-14 attach 加重证据（已对齐） |

纪律复核：`git status --short -- src` 的 10 个 M 均为主线程任务 #9 并发修复；本角色**未改任何 `src`**，仅新增 `.gitignore` 排除的临时探针与本授权产物。`src/game/survival.ts` 的 C14 修复（`06:20:04`）晚于本角色最后一次探针运行，已在 §0.3 说明。
