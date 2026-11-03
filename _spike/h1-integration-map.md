# H1 接入映射 · 三套既有结构 → EntityRegistry（P0-1）

> H1 spike 产物之二。配套原型：`_spike/h1-entity-registry.mjs`（16/16 GREEN）。
> 依据：`docs/重建-v2/spec/P0-1-实体表.md` §1/§4；实际代码核对日 2026-11-04。
> 结论先行：**GO** —— 三套结构的身份字段都可归一到「注册表独家发放的单调 id」，无结构性阻断。

## 0. 总判：谁应该拥有发号权

现状三套身份互不相通：crowd 的数值 `id`、烘焙件的**无身份**（只有资产名台账）、physics 的**对象引用**。
原型（断言组 B）演示了三者挂同一张表：`npc`（crowd 出生）、`block`（烘焙静态、`object3d=null`）、
collider 组件 + `onDispose` 摘物理索引，同表共存、注销互不干扰。
关键裁决：**发号权必须收归注册表**（`idSeq` 退役）。理由见 §1 风险 R1——crowd 现在的 id 在读档重建时会从 1 重发，
已经实际踩过串号 bug（crowd.ts:1168-1170 的 BEAST_IDS 清理注释就是补丁痕迹）。

## 1. crowd Actor（`src/actors/crowd.ts`）

| 项 | 现状 | 接入 EntityRegistry |
|---|---|---|
| 现有身份字段 | `Actor.id: number`，来自**每个 Crowd 实例私有**的 `idSeq=1`（crowd.ts:1144），`spawnActor` 里 `id: this.idSeq++`（crowd.ts:1286） | 注册表 `allocate('npc'\|'beast', {pos, persist, provenance})` 发号，**Actor 采纳注册表 id**；`idSeq` 字段退役 |
| 生命周期 | `actors: Actor[]` **只增不删**（无 splice/pop 路径）；"消失"是软隐藏 `hidden=true`（碎裂→`physics.ts:138-139` + respawn 队列复活）；`liveCount()` = `!a.hidden` 计数（world.ts:1639） | 真 `dispose` 只用于**真移除**（未来读档清场/造物销毁）；碎裂复活这类软隐藏**不走 dispose**，仍是 `hidden` 标志 —— 两条语义必须分开 |
| 注册时机 | `spawnActor()`（crowd.ts:1261）是全部角色的唯一出生口（坊民/摊档/名将/神佛/鬼差/玩家都走它），在 `this.actors.push(a)`（crowd.ts:1359）之后补 `allocate` —— 正是 P0-1 步 1 的形态 | 步 1 谁都不读表，回滚 = 删一行 |
| headKit='beast' 分支 | `BEAST_IDS.add(a.id)`（crowd.ts:1357，模块级 Set） | kind 直接用 `'beast'`，`BEAST_IDS` 可被 `forEach('beast')` 替代 |
| 外观槽位 | `a.slots: Record<string, number>`（池起始槽位号，crowd.ts:1355） | 保持不动（P0-1 非目标：不动 pools 内部实现），组件槽只挂 `collider/behavior` |
| **风险 R1** | **id 生命周期 ≠ Crowd 实例生命周期**：读档/重建 Crowd 时 `idSeq` 从 1 重发号，而模块级 `BEAST_IDS` 按 `a.id` 记兽形，已因此实际串过号（crowd.ts:1168-1170 注释记录了清表补丁）。接入后注册表跨 Crowd 实例续号即可根治，但**既有按 id 索引的模块级表（BEAST_IDS、AVOID 相关）必须同步迁移或清空**，否则旧 id 残留照样串号 | |

## 2. world 静态烘焙件（`src/city/bake.ts` 的 b.kit 台账）

| 项 | 现状 | 接入 EntityRegistry |
|---|---|---|
| 现有身份字段 | **没有逐实例身份**。`kit(id: string, count, y)`（bake.ts:745）只是**资产级台账**：`detailCounts`/`detailBounds` 两个 Map 按 `'roof.eaveTrim'` 这类资产名累计数量；几何全部合并进大 buffer（`buf[g].p.a`），`baker.build(scene)` 一次性成网。`liveCount()`/`heroEntries()`（world.ts:1639/1631）是**派生计数**，不是键 | 注册 `kind:'block'\|'building'` 的**纯逻辑实体**：`object3d=null`、`pos` 来自构建调用点、按需挂 `collider`（P0-2 的 `groundHeight()` 遍历源）。b.kit 台账保持原职（资产级统计），两者互不替代 |
| 注册时机 | world.ts 构建管线（world.ts:344-552，buildBridge/buildXiangguo/buildImperialCity 等）。步 1 不必全覆盖：先登记**可碰撞/可交互**的地标（桥、府衙、宫殿、里坊围廓），装饰性 kit 件不入表 | 步 1 验收按 P0-1 §4：`entityStats().alive` 与实测对象数交叉核对 |
| **风险 R2** | **合并 buffer 里没有"单个建筑"可拆**：dispose 一个已烘焙的建筑只能做**逻辑注销**（退出碰撞/不入存档），它的三角形仍在大 buffer 里渲染。视觉级移除需要逐实例 batch（属 P2-4 热替换的地盘），P0-1 不得承诺。硬约束：接入不得改几何产出，`T_static` 必须保持 18,959,342（P0-1 §8 退出判据 5） | |

## 3. physics 碰撞体 / ImpactSystem（`src/game/physics.ts`）

| 项 | 现状 | 接入 EntityRegistry |
|---|---|---|
| 现有身份字段 | `launches: Map<Actor, LaunchState>`、`respawn: {a: Actor}[]` —— 全部以**对象引用**为键（physics.ts:67-68、122、139）；physics.ts:258-260 注释明确押注「actors 无删除路径 ⇒ 引用无悬挂风险」。交通工具 `traffic()`（units.ts:541）返回**匿名临时对象** `{pos,yaw,speed,mass}`，每次调用重建，完全无身份 | 击飞/碎裂目标改以 `EntityId` 为键（或保引用 + 出生时在实体上挂 `onDispose` 清 `launches`/`respawn` 条目）；车辆/轿子/坐骑在 UnitSystems 造物时 `allocate('creation')`，`traffic()` 改为从表内读 `pos` |
| 注册时机 | `launch()`（physics.ts:121）、`shatter()` 的 respawn 入队（physics.ts:139）；车辆在 `src/city/units.ts` 各自的创建函数 | 摘除钩子挂进 `onDispose`：注销时逆序先拆物理索引，再拆 LOD/渲染（依赖晚者先拆，P0-1 §2） |
| 判定数据 | `profileOf(a)` 读 `a.data?.group / a.occ`（physics.ts:33-46） | 实体记录 init 里带上 actor/occ 引用（组件槽），profileOf 不改签名 |
| **风险 R3** | **"真删除"会引爆全部既有引用持有者**：现状安全是靠"永不删"换来的（physics.ts:258 注释自证）。P0-1 步 3 引入真 dispose 后，`launches`、`respawn`、`world.impacts` 的 sweep 数组（world.ts:1331 每帧 `filter` 的新数组尚安全）、`player.actor` 都可能拿到死引用。**凡持有 Actor/实体引用的系统都必须在 onDispose 链上登记摘除钩子**，漏一个就是隔帧崩溃。这是步 3 必须排在 P0-5（补 `removeUpdate`）之后的原因 | |

## 4. 附带发现：第四套身份命名空间（D1 运行时追加件）

D1（`docs/重建-v2/D1-引擎与几何管线.md` §323-361）已为运行时追加造物定义了**字符串 id**（`rt_*` 命名空间、
`unmountRuntime(id): boolean`），且其依赖的 `LodManager.unregister` **尚未实现（待补）**——换装即泄漏一个 LOD 组。
建议：实体表以数值 id 为唯一主键，运行时组的 string id 作为实体记录的一个别名/组件槽挂入，
`unmountRuntime` 的释放钩子挂 `onDispose`，两套 API 不互仿。P0-1 实施时顺路核对 D1 的 `unregister` 缺口，避免两份"待补"各自漂移。

## 5. 映射到 P0-1 三步迁移

| 步 | 动作 | 本映射对应 |
|---|---|---|
| 步 1（建表不接线） | spawnActor/bake 地标/车辆出生点补 `allocate`，谁都不读 | §1/§2/§3 的"注册时机"行；回滚 = 删登记行 |
| 步 2（只读接入） | P0-2 碰撞与 P0-4 存档改从表读：`forEach('block'|'creation')` 取 collider | §2 风险 R2 的逻辑实体、§3 的 traffic 从表读 |
| 步 3（写路径接管） | 删除一律走 `dispose`；`idSeq` 退役、引用持有者全部挂 onDispose | §1 风险 R1、§3 风险 R3；排在 P0-5 之后 |
