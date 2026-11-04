# S08 · 生物与 NPC（融合终版）

> 素材：V8《生物与NPC》× 代码实测（`crowd.ts` 活体 4,496 / 英雄 165 / 行为树与对象池）。

## ① 代码现状（实测锚）

**规模与池**：打包门实测 `live 4496 / heroes 165`（`artifacts/game-progress.md:213`）。`MAX_HUMANS = 4800`（`src/actors/pools.ts:133`），池溢出走 `throw`（`pools.ts:36` 槽位不足、`:98` 池容量断言）——超限不是少一个人，是 loading 卡死。角色 id 单调发号：`idSeq = 1`（`src/actors/crowd.ts:1144`）、`spawnActor`（`crowd.ts:1261`）内 `id: this.idSeq++`（`:1286`）。兽体部件池 `BeastPool` 槽位（V8 实读 `src/sky/creatures.ts:150-168`：body/head 各 168、leg 560、tail 120、horn 320、wing 96…），90 只生物已占 body 78 槽 ⇒ 繁殖硬顶约 90 槽。物种表 `SPECIES`（`creatures.ts:72`，42 行定义、实体 37 种）；九型兽体 `BEAST_FORM`（`creatures.ts:507`）、`beastGeo()`（`creatures.ts:676`，三角汤 VGeo，顶点数=面数×3）。行为行走面 `ensureWalkSurface`（`src/actors/behaviors.ts:146`，4m 空间哈希一次性构建）、`WS_STEP_UP/DOWN = 0.95/1.05`（`:89-90`）、`walkSurfaceY`（`:179`）。**天宫/地府 NPC 不落地**：`crowd.ts` 与 `behaviors.ts` 双重排除这两界（清单 v3 P0-7 判据）。随机源已注入化：`crowd.ts:27-30`、`behaviors.ts:11-28` 注释表明 `Math.random` 引用逃逸问题已修，确定性门 A 类 7 文件零命中（今日探针 RESULT=PASS）。E1 实测：npcSweep p95 0.1ms（占帧预算 0.6%，`artifacts/npc-sweep-BASELINE.json`）——静态审计的「帧尖峰」推断不成立。

## ② V 系设计要点（V8 卷）

生物分类表 46 条（被动 12/中立 11/敌对 10/Boss 7/灵兽 6），体型算式 `GROUPS×shape×scale`；行为对应 `CreatureSystem.update` 既有四种积分（环游/浮沉/驻守/runner 折线巡逻）。核心判断：**生物的瓶颈不在 CPU、不在面数、在槽位**——第 91 只会让 `addBeast` 静默跳过（`if (body < 0) return`），玩家看到「繁殖了但没生出来」。与现有代码整合三层：直接复用（一行不改）/必须扩的（改结构不改语义）/`deities.ts` 35 尊复用边界；`crowd.ts` 人群的边界与既有「偷用」（人群借兽形）；复用率——9 型放样能吃下多数新生物。繁殖与驯服：三条上限取最小（CPU/面数/**槽位**）、繁殖规则、驯服规则、加 90 只对帧 <0.4ms、**存档语义 uid 是唯一能撑住重载的东西**。AI 三选一**选效用 AI**（否决状态机与行为树：理由=数据结构可存档、更新预算可控、与现有 crowd 决策风格一致），效用 AI 数据结构 + 更新预算 + 群体行为（群心+个体偏移，不做 boids）。NPC 日程：生物与 `walkSurfaceY` 的关系是**替代不是衔接**；日程不改 `jobs.ts` 另加 `schedule.ts`；与 `AVOID_CELL` 的关系。玩家交互四动作接 `interact.ts`。材质注释坑：扩生物最易再踩。性能债记账一条（已存在不修）。

## ③ D 系设计要点（D 系无生物卷，关联约束）

D4 §0.4 划「既有三套角色系统」边界（人形池/creatures 兽体/造物），造物不能成为第四套打架体系——生物系统的扩展必须认这个边界：新生物走 creatures 放样，**造物**走 S10 的 CreationBundle，两者不得混池。D7 预算侧：新增实体的成本按 Δ 面/Δ draw/Δ 内存三账报（ADR-7）；4,400 实体量级的查询必须走 H2 定案的网格哈希（P0-2/P0-7 强制修订）。D5 侧：造物行为 `behavior` 五值（static/patrol/follow/fly/swim）与生物行为积分同构，扩展生物 AI 时不得给造物偷偷加机制（ADR-8 边界）。

**V8 细节补充**：分类表其余三档要点——敌对 10 种按仇恨半径主动出击（如鬼城游魂 `aggro 14`、怨鬼 `aggro 16`，掉落以阴德计价）；Boss 7 种「有名字、有阶段、有不刷新语义」；灵兽 6 种「不参战、不繁殖、有唯一性」；§1.7 自认生态位分布失衡并直面它。§2 整合三层：直接复用（`CreatureSystem` 四种积分与 `SpawnCfg` 一行不改）、必须扩的（改结构不改语义）、`deities.ts` 35 尊的复用边界（Boss 只复用角色池与锚点，不改演出）；`crowd.ts` 人群的边界与已有「偷用」（人群借兽形的先例）；复用率——9 型放样能吃下多数新增生物；`runners` 的扩展边界与「不占角色」的巡逻；§2.7 材质坑（一个已写进注释的坑，扩生物时最容易再踩——新增生物材质参数必须对照基准表复刻）。§3 繁殖驯服：三条上限取最小（CPU/面数/**槽位**）、繁殖与驯服规则、加 90 只对帧 <0.4ms（估算，E1 方法论要求实跑基线）、**uid 是唯一能撑住重载的东西**（本层裁并入 P0-1 实体表 id）。§4 效用 AI：否决状态机与行为树的完整论证、数据结构、更新预算（分帧）、群体行为=群心+个体偏移不做 boids。§5：生物与 `walkSurfaceY` 是替代不是衔接；`schedule.ts` 与 `AVOID_CELL` 的关系；玩家交互四动作（喂食/骑乘/拾取/对话）接在 `interact.ts`。§7.1 一条已存在、本卷不修但必须记账的性能债。

**V8 §1.1-1.2 补充**：表头约定即实现契约——体型列写作「长×高」且算式为 `GROUPS[group].l/h × shape.l/h × spawn.scale`（四组基准 `小 0.46×0.34 / 中 1.20×0.95 / 大 2.30×1.80 / 神话 4.80×3.60`）；行为列直接对应 `CreatureSystem.update` 既有积分参数（环游 `b.ang += dt·speed/r`、浮沉 `b.y += sin(t·0.55+seed)·1.6`、驻守 `stationary:true`、runner 折线巡逻）；生成列照抄 `SpawnCfg`（x,z,y,n,r,speed,host），`host` 决定 y 换算（`sky` 走 `heavenY()`、`under` 用 `UNDER.y=-260`、`city` 原值）——这意味着 V8 的每条生成记录本身就是 S02 坐标纪律的消费者，任何 `sky` 行漏走 `heavenPoint` 会立刻复现 21.8m 级旧事故。掉落列价格全部标注「待与 V4 对表」（V8 自认最弱三处之一），本层把它挂进 S04 资源轴的 B5 断言清单。

## ④ 冲突裁决

1. **V8 效用 AI vs V8 自己引用的既有行为积分（环游/浮沉/驻守/runner）。** 无实质冲突，落点切分：既有四种积分管**运动**（creatures.ts 现状），效用 AI 管**决策**（新增）；判决=运动层一行不改，决策层新增 `src/actors/creatureAI.ts`，两层数据分离进存档。
2. **V8 繁殖 uid 存档 vs P0-1 统一实体表。** 判给 **P0-1 吸收**：H1 已证三套结构可共用单调 id（16/16 断言），繁殖 uid 即 entity id，不再自建第二套 uid 体系；`crowd.ts:1144 idSeq` 与实体表对接时保持单调不回绕。
3. **V8 「NPC 日程加 schedule.ts」vs 现状 jobs.ts。** 判给 **V8**（不改 jobs.ts 另加文件）：`jobs.ts` 与烘焙期职业分配耦合，动它会扰动 35 步烘焙序列与 RNG 消耗顺序（D1 §1.1 失败模式 3）；`schedule.ts` 只读 jobs 结果做时间维偏移。
4. **V8 加 90 只生物 vs 槽位硬顶。** 判给**槽位优先**：任何繁殖/新增生物先查 `BeastPool` 余量并给「槽位不足」显式 UI 反馈（不许静默 return）；扩槽位是 P1-6 的前置小任务（改 `creatures.ts:150-168` 常量 + 内存复核），不是无限池。
5. **V8 天宫/地府 NPC 落地 vs 双重排除现状。** 判给 **P0-7 解钉路径**（realmY 解钉 + 每界行走面，三处同改），V8 不单开任务。
6. **E1 方法论（勘误层第 6 条）凌驾 V8 性能推断。** V8 「加 90 只 <0.4ms」属估算；生效判据=先跑 npcSweep 基线探针，以实测绝对值定严重度。此条为方法论纪律，全系统适用。

## ⑤ 任务清单与验收（并入清单 v3 段位）

| 任务 | 段位 | 验收断言 |
|---|---|---|
| P0-1 实体表（`src/rt/entity.ts`）与 crowd idSeq 对接 | **P0-1** | 场上任一可见对象按 id 可查；注销后 0 残留；`idSeq` 单调不回绕 |
| 槽位余量查询 + 不足显式反馈 | **P1-6** | 第 91 只被拒时有 toast/图鉴记录；`addBeast` 不再静默 return |
| 效用 AI 决策层（`creatureAI.ts`，运动层不动） | **P1-6** | 同 seed 双跑决策序列逐值一致；npcSweep p95 增量 ≤0.2ms（先跑基线） |
| `schedule.ts` 日程（只读 jobs 结果） | **P1-5 同批** | 昼夜相位驱动的在岗/离岗切换；烘焙几何与 RNG 序列零扰动 |
| 驯服/繁殖规则 + 存档（entity id 引用） | **P1-6** | 存读档后驯服关系与繁殖冷却逐值一致（S12 schema 段） |
| 生物交互四动作接 `interact.ts` | **P1-6** | 喂食/骑乘/拾取/对话各有一条探针断言 |
| 新生物材质参数复刻（避注释坑） | **P1-6** | 新增生物材质 diff 探针与基准表一致 |
| 造物/生物池边界机检 | **P1-6** | 造物不进 `BeastPool`、生物不进 CreationBundle（双向断言） |

交叉引用：boss 战→S09；造物坐骑宠物→S10；实体身份 H1→S12/P0-1；行走面→S05/P0-7。
