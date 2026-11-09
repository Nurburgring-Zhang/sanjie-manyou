# 第 1 轮全量代码审核 · 底层逻辑 / 架构 / 确定性 / 存档 / 状态机（core-expert）

> 审核产物，非源码。基线 `git HEAD = be0226e`（`npx tsc --noEmit` 0 错、`npm test` 15 files / 137 tests 全绿、determinism PASS）。
> 范围：`src/core/` 全部、`src/rt/` 全部、`src/main.ts`、`src/world.ts` 构造与 update 主循环 / dispose 清理路径、`tests/core.test.ts` / `save.test.ts` / `runtimeAssets.test.ts` / `atomicCatalog.test.ts` / `bakeQuant.test.ts`、`docs/重建-v2/D7-性能与预算.md`、`artifacts/defect-ledger.md`、确定性探针脚本。
> 不审：美术几何、玩法数值设计、UI 样式（分别由 geom-expert / play-expert / ui-perf-expert 负责）。
> 纪律：src 源码全程只读，未改任何源码、未运行构建/测试、未写脚本落盘；**仅本文件为授权落盘的审核产物**。
> 口径：每条结论给出 file:line 与函数名；确定性结论指明具体非确定源；严格区分【确认缺陷】【疑似需运行时验证】【设计取舍非缺陷】。
> 编号说明：沿用第 1 轮交付消息中的 ID（C14 为补充核查新增、C13 为设计取舍汇总），下表**按严重度排序**，故 ID 非连续。

---

## 〇、口径与核查范围（第 2 轮对抗互审请先读）

### 0.1 基线「determinism PASS」是窄口径
- `scripts/probe-determinism.mjs:29-37`：A 类门只查 7 个 `SIM_FILES`（`physics.ts` / `behaviors.ts` / `crowd.ts` / `player.ts` / `boss.ts` / `havoc.ts` / `interact.ts`）里 `Math.random(` / `performance.now(` / `Date.now(` 的**文本调用为零**；B 类只 REPORT。该脚本 `:12-13` 自认「未命中也不代表确定——`RNG` 的种子用法、遍历顺序、`Set`/`Map` 迭代顺序都不在本门覆盖范围内」。
- `scripts/probe-sim-determinism.mjs`：只验 `behaviors.ts + physics.ts` 在**显式注入 rng/clock** 下的 600 步位置哈希（`:1-24`、`:336-368`）；`:348-352` 负对照靠「未注入时走 LEGACY_RNG 全局流且流不重置」产生分叉。
- 即：**世界生成、贴图、存档、事件总线、主循环、生命周期全都不在该门覆盖内**。本文确定性类结论均指「口径外的确定性缺口」，不是「现有门挂了」。

### 0.2 已修复 / 非缺陷的既往问题（避免误报）
- `src/actors/behaviors.ts:34-43` 已把历史 `LEGACY_RNG = Math.random`（取引用导致静态门假绿）改成固定种子 mulberry32 确定性流；`src/actors/crowd.ts:37-49` 同款。**此项不是缺陷**。
- 所有 `bus.emit` 均在函数/方法内，无模块顶层 emit，**未发现「订阅者构造完成前 emit」**；全仓 emit/on 字符串逐一比对**无拼写不一致**。
- 生成顺序稳定：`world.ts:956-990` tasks 数组串行 `await raf()`；`Map`/`Set` 遍历均为插入序；`compactStatic` 的 `.sort`（`world.ts:915-917`）在 ES2019+ 为稳定排序。无并发异步生成。
- `engine.ts:888` dt 钳 `[0, 0.1]` 正确；`engine.ts:736` `Math.max(1, distance)`、`:929` `1/Math.max(dt,1e-4)`、`tween.ts:16` `r=k.t/k.dur` 均有防除零/防逆。
- `src/rt/entity.ts:92-106` `dispose()` 幂等 + `onDispose` 逆序 + 回调内重入安全；`src/rt/collider.ts:124-149` `reconcile()` 幽灵格双向对账；`src/rt/save.ts:22-34` `SaveSlots` 轮转/回退决策纯逻辑可测；`src/rt/voxelStore.ts:79-84` 反序列化有 `inBounds` 守卫。以上设计良好。

---

## 一、结论（14 条，按严重度排序）

### C01 【确认缺陷·高】存档写/读字段严重不对称，读档后状态无法重建
- **现象**：写档写入 `schemaVersion / economy / entities / voxel / survival / karma`（`InteractSystem.save()` `src/game/interact.ts:79-98`），读档只应用 `economy / voxel / survival`（`World.init()` `src/world.ts:327-332`）。`karma`、`entities` **写了不读**；`codexLog`（`world.ts:239`）、`objectiveDone`（`:241`）、`playerWeapon`（`:299`）、`creationCount`（`:307`）、玩家/相机位置、造物根本没进存档。`collectPersistedEntities()` `src/rt/save.ts:85-94` **全仓零调用点**，写档时 `entities` 恒为 `[]`（`interact.ts:90`），ADR-3 的 persist 实体 / `provenance` 重放链断裂。`SCHEMA_VERSION = 2`（`save.ts:39`）但 `SaveDataV2.entities` 是死字段。
- **触发条件**：任何「存档 → 刷新页面 → 读档」。业力/六道阶位、图鉴、目标进度、武器、造物全部回初始。
- **最小修法**：读档处补 `karma.deserialize(saved.karma)`、按 `saved.entities` 重建（`entity.ts:48` `idSeq` 单调不复用，需提供保留 eid 的 allocate 变体）、补 `codexLog` / `objectiveDone` / `playerWeapon` / 造物 / 玩家位置；写档改调 `collectPersistedEntities()`。
- **是否影响 determinism / 存档兼容**：determinism 否；**存档兼容：是**（v2 档语义不完整）。
- **验收断言**：构造含全字段档，`save → load` 后逐字段 `toEqual`（见 I1）；`entities` 非空样本必测。
- **放大链（与 play-expert 联合登记：根因归本条，玩法经济后果归其 P-08 / P-09 / P-13）**：
  1. `interact.ts:93` 写 `karma: sv.karma.current().karma`；`Karma.serialize()/deserialize()` `src/game/karma.ts:58-61` 齐备，但**全仓零调用** `karma.deserialize`（`world.ts:329-330` 只 deserialize `voxel`/`survival`）→ 读档后 `karma=0`、阶位回「人道」，HUD `ui.ts:421-425` 与 `karma:ascend` 广播均基于内存值。
  2. `ArenaBoss` 构造 `defeated = false`（`boss.ts:36`）、`hp = spec.maxHp`（`:71`），每次 `new ArenaBoss(...)`（`world.ts:778`）都重置；**单会话防重靠 `boss.defeated`**（`boss.ts:108` `playerAttack` 开头守卫、`:155` `update` 守卫，`:128-135` 击杀时置 true 并调一次 `onDefeat`）。`world.ts:786` 的 `codexLog.some()` 的 `if` **只包住 `push`**，奖励 `addPeach(2) / earn(300) / playerWeapon=4.0 / bossReward()`（`:792-798`）在 `if` 之外；`codexLog` 未入档 → 读档后 Boss 复活 + 跨会话防重失效，可再击杀再领一轮；`earn(300)`（`interact.ts:62`）触发 `interact.save()` 把 +300 落盘，`bossReward()`（`survival.ts:81-84`）让 `bossesDown++` 且 survival 入档 → 持续累加。
  3. **精确表述（防证伪）**：单会话内**不会**重复领奖（`defeated` 守卫有效）；重复仅发生在「读档重建 Boss 之后」。勿写成「防重只靠内存 codexLog」。

### C02 【确认缺陷·高】存档失败被静默吞掉，异步异常无捕获
- **现象**：`interact.ts:87` `void W.__saveSave({...})` 是 fire-and-forget，`try/catch`（`:82-96`）只挡同步抛错，**挡不住 Promise rejection** → IDB `tx.onabort` / `tx.onerror` 的 `reject()`（`src/rt/save.ts:142-143`）变成 unhandled rejection；`:81` 注释自认「异常静默」。`world.ts:772` `void saveMgr.open().then(...)` 同样无 `.catch`，open 失败则 `__saveSave` **永不注入**。`save.ts:167-173` 坏档 `catch { continue; }` 无日志；`world.ts:334` 读档失败仅 `console.warn('[存档] 读档失败，走新档', err)`，玩家侧无任何提示（加载页照常 `classList.add('done')` 消失）。
- **触发条件**：IndexedDB 被禁用 / 配额满 / 隐私模式；或任一槽 JSON 损坏。玩家在「以为已存档」下继续玩，进度静默丢失。
- **最小修法**：`.catch(err => { console.error(...); bus.emit('ui:toast', '存档失败') })`；坏档回退加 `console.warn(slot, err)`；读档降级时给玩家可见提示。
- **是否影响 determinism / 存档兼容**：determinism 否；**存档兼容：是**。
- **验收断言**：stub 一个 `reject` 的 `__saveSave`，断言无 `unhandledRejection` 且 UI 收到 `ui:toast`。

### C03 【确认缺陷·高】事件总线无退订能力，全局单例订阅永久驻留
- **现象**：`Bus` `src/core/rng.ts:24-35` 只有 `on` / `emit`，**无 `off` / `once` / `clear`**；`:36` `export const bus = new Bus()` 为进程级单例。订阅点全部落在构造 / `init()` 里且无配对退订：`world.ts:820`（`player:mode`）、`world.ts:1036-1037`、`src/audio/scape.ts:41-51`（11 个）、`src/fx/vfx.ts:99`、`src/game/physics.ts:79`、`src/ui/ui.ts:109-352`（约 10 个）。`:1036-1037` 与 `:820` 均在 `World.init()` 内。
- **触发条件**：`init()` 或 `initUI()` 被调用两次即叠加。`docs/重建-v2/D7-性能与预算.md` §5 行 626 明确「vite dev 下 HMR 会重建场景」；或测试中两次 `new World().init()`。旧 World 的闭包（`applyDensity` / `applyCamCtl`）被 bus 持有，仍响应事件并操作已废弃的 engine/world → 泄漏 + 幽灵回调。**当前 `main.ts` 单次 boot 不触发**，属清理能力缺失。
- **最小修法**：`Bus` 增 `off(evt, fn)`；订阅者保存 handler 引用，在 `World.dispose()` / `initUI` 返回的 teardown 中成对退订。
- **是否影响 determinism / 存档兼容**：存档否；**determinism 间接是**（重复 init 叠加旧回调会改变逐帧状态）。
- **验收断言**：统计 bus 内 handler 总数，连跑两次初始化流程后总数不变（见 I3）。

### C04 【确认缺陷·高】Engine 无 dispose、rAF 无取消句柄、监听器零移除
- **现象**：`Engine.start()` `src/core/engine.ts:882-901` 内 `requestAnimationFrame(loop)` 递归自持，**未保存 id、无 `stop()` / `dispose()`**（Engine 类全文无 dispose）。监听器全无 `removeEventListener`：`:596-611`（webglcontextlost / restored）、`:612`（`PointerInputRouter` 内 pointerdown / up）、`:628`（resize）、`:774-845`（`bindInput` 的 keydown / keyup / pointermove / mousemove / blur / pointerup / pointercancel / pointerlockchange + canvas 的 contextmenu / pointerdown / wheel / touchmove / touchend）。全局态泄漏：`:632` `setLodSink(this.lod)` 是全局单例 sink；`:539` / `:924` `Engine.shadowTick` 是 `private static`，跨实例共享。
- **触发条件**：任何第二个 Engine 实例（HMR 重建 / 场景重载 / 测试双实例）→ 旧 rAF 循环继续持有旧 renderer / scene / composer 全速渲染 + 双份监听器 + 隔帧阴影 parity 错乱 + 旧 `LodManager` 被新 sink 覆盖。**当前单实例运行不泄漏**，属清理路径完全缺失。
- **最小修法**：保存 rAF id 并 `cancelAnimationFrame`；所有 `addEventListener` 用命名函数配对 `removeEventListener`；`Engine.dispose()` 释放 composer / renderTarget / PMREM 产物并清 `setLodSink(null)`；`shadowTick` 改实例字段。
- **是否影响 determinism / 存档兼容**：存档否；determinism 否（但多实例会污染任何逐帧断言）。
- **验收断言**：spy `addEventListener` / `removeEventListener` / `rAF` / `cancelAnimationFrame`，构造 → `dispose()` 后断言配对且 rAF 无新调度（见 I7）。

### C05 【确认缺陷·中】生成期程序化贴图用 `Math.random`，逐像素不可复现
- **现象**：载入期（世界生成）绘制的画布贴图直接取全局随机：`src/city/bake.ts:26-205`（6 张材质贴图，`materialSet()` 在 `baker.flush` 内，D7 §3.2 S4）、`src/world/terrain.ts:1826-1833`（1024² 地表贴图 3300 次 `Math.random`，位于 `buildTerrain` 含 `await yieldFrame()` 的生成步）、`src/sky/expansion.ts:1184-1188`（云贴图 blob）。`terrain.ts:145` 与 `:777` 的注释承诺「不碰 Math.random…重建逐像素一致」只对高度场 vnoise/fbm 成立，对同文件贴图**不成立**。
- **非确定源**：`Math.random()` —— 未播种、进程全局、跨运行不同。
- **触发条件**：同 seed 跑两次 `world.init()` → 几何 / 实体表哈希一致，但贴图 canvas 像素不同 → 截图逐像素不等（D7 §5 A12「像素零变化」断言无法成立）。
- **最小修法**：把 `new RNG(fixedSeed)` 的取值函数注入这三处贴图绘制，替换 `Math.random`。
- **是否影响 determinism / 存档兼容**：**determinism：是（口径外）**；存档否。不影响几何 / 实体位置哈希。
- **验收断言**：同 seed 两次生成，对 6 张材质 + 地表 + 云贴图的 `canvas.toDataURL()` 取 sha256 比对相等。

### C06 【确认缺陷·中】墙钟进入 NPC 位置本体，且确定性门验的是「注入路径」而非生产路径
- **现象（含 motion-expert 交叉补强）**：
  1. `world.ts:444` `const tt = performance.now()/1000*2.0 + phase`（桥面行人 `a.attach`）、`world.ts:486` `const tt = performance.now()/1000*1.15 + phase`（城墙守卒 `a.attach`）；`src/actors/crowd.ts:2053` `if (a.attach) a.attach({ pos: a.pos, yaw: a.yaw, y: a.yOff })` 把 actor 的**位置引用**直接交给回调，回调内 `out.pos.set(...)`（`world.ts:448`、`:491-495`）**写回位置**。即这两组 NPC 的**位置（运动状态）本身由墙钟算出**，不只是「到期判定」。同类还有 `world/terrain.ts:1573` `uni.uTime.value = performance.now()*0.001`、`sky/expansion.ts:1131`。
  2. 生产路径 `world.ts:345` `new Crowd(scene, buildNav())` 与 `world.ts:858` `new ImpactSystem(this.crowd, this.vfx)` **均未注入 clock / rng**，走 `src/actors/crowd.ts:57` / `src/game/physics.ts:29` 的 `hostClock = () => performance.now()` 与 LEGACY_RNG 全局流；`src/game/player.ts:68` `clock = legacyClock` 同为墙钟。而 `probe-sim-determinism.mjs:263-278` 测的是注入 `()=>1000` / `()=>5000` / `()=>0` 的路径（motion-expert M-14 据此改判为确认缺陷：「门只覆盖注入路径、生产默认构造从未注入＝假绿」）。
  3. **关键**：attach 闭包**完全绕过 Crowd 的 clock 注入**。`crowd.ts:1159` 构造注入的 `clock` 只进 `ctx.clock`（`crowd.ts:1604-1605` `ctx()`，注释明说「clock 只在 ctx.t 缺失时才会被 behaviors 取用」）与 `:2040` 的 `now`（供 `:2052` `now >= a.impactUntil` 判定）；attach 是 `world.ts` 里定义的独立闭包，直连全局 `performance.now()`。**即使按建议注入 clock 也救不了这两组 NPC**。
- **非确定源**：`performance.now()`（墙钟）。
- **触发条件**：`engine.ts:904` `renderOnce(dt)`（注释「后台标签页自动化测试用」）或任何固定步回放 → 相同 dt 序列两次跑，attach 位置与 `impactUntil` / `bumpCd` / `busyUntil` 不同，回放分叉；切后台回来 `tt` 跳变 → `m` / `dir`（`world.ts:445-448`、`:487-495`）跳变 → 这两组 NPC **瞬移**。行为层内部因 `behaviors.ts:906` 优先用 `ctx.t * 1000` 而部分确定，物理 / 玩家锁与 attach 不。
- **最小修法（两条并列，缺一不可）**：① 注入时钟（`() => this.engine.t*1000`）覆盖 `ImpactSystem` / `PlayerController` / impactUntil 判定；② **必须单独**把两处 attach 改为接收仿真时间参数或读 `engine.t`，替换 `performance.now()`。
- **是否影响 determinism / 存档兼容**：**determinism：是（口径外，且是门与生产路径的实质缺口）**；存档否。
- **验收断言**：stub `performance.now` 递增 + 冻结 `Date.now`，`renderOnce(1/60)` × 120 两次，对实体位置哈希比对；**I6 必须显式包含 attach 组（桥面 6 人 + 城墙巡逻组）**，否则漏测。

### C07 【确认缺陷·中】读档无 schema 校验，合法 JSON 但缺字段的档抛错降级为新档
- **现象**：`migrate()` `src/rt/save.ts:58-69` 只判断 `d.schemaVersion`，不校验字段存在性 / 类型 / 有限性；`:67` `if (d.schemaVersion === 2) return d` 原样放行；`load()` `save.ts:149-176` 直接返回。随后 `world.ts:331` `console.log(\`[存档] 已恢复：coins=${saved.economy.coins} ...\`)` **未保护访问** → 档为 `{"schemaVersion":2}` 时抛 `TypeError`，被 `world.ts:334` catch 吞成「走新档」，旧档静默作废。
- **触发条件**：半写档、跨版本字段缺失、手工 / 损坏档、旧版 v2 早期档。
- **最小修法**：`migrate()` 加必填字段与 `Number.isFinite` 校验，失败返回 `null` 让 `load()` 回退下一槽；`world.ts` 恢复前加 `saved.economy && Number.isFinite(saved.economy.coins)` 守卫。
- **是否影响 determinism / 存档兼容**：determinism 否；**存档兼容：是**。
- **验收断言**：喂 `{"schemaVersion":2}`、`{"schemaVersion":2,"economy":{}}`、含 `NaN` 字段的档，断言不抛错且回退到可用槽或返回 `null`。

### C08 【确认缺陷·中】随机源不统一，默认流是「不可重置的模块级有状态单例」
- **现象**：世界几何用多个硬编码种子 `new RNG(20260905)`（`world.ts:335`）、`0x5e7a1`（`world.ts:413`）、`0x2f6b1d`（`world/terrain.ts:1961`）、`boss.ts:27` `new RNG(0x5e7a1)`；行为层 / 人群层各有**一份独立定义**的 `LEGACY_RNG`（`behaviors.ts:34-43` 与 `crowd.ts:40-49`，同为 `s = 0x5e7a1` 固定种子 mulberry32 模块级单例流，各模块各一份闭包、互不相干）；`Crowd` 构造默认 `rng = LEGACY_RNG`（`crowd.ts:1159`），经 `ctx.rng`（`:1605`）下传 behaviors；`engine.ts:119-120` LOD 剪影又用独立 `seed = 7` LCG（固定故确定，但非统一源）；贴图 / 特效 / 音效 / 玩法仍用 `Math.random`（`fx/vfx.ts`、`audio/scape.ts`、`world.ts:1642` 火炮目标、`actors/heroes.ts:182`）。`behaviors.ts:11` 注释自认「全仓 189 处 Math.random」。
- **非确定源 / 风险点**：`Math.random`（贴图 / 特效）；LEGACY_RNG 的模块级状态使「两次从头开始的模拟」跨调用不可复现（`probe-sim-determinism.mjs:348-352` 的负对照正是靠「流被前一次跑消耗」才分叉，不是真随机）。
- **定性分离（防证伪）**：LEGACY_RNG **不是墙钟、不是 Math.random**，是固定种子确定性流；其风险是「模块级单例状态 + 单个消费者实例内多 actor 共享 / 调用顺序耦合 + 跨会话不重置」。应与 `hostClock`（`crowd.ts:57`、`physics.ts:29`）的「墙钟」**分开归类**：C06 只讲墙钟，C08 只讲随机流，不混为一类。「共享」发生在单个 `Crowd` 实例把它那份 rng 经 `ctx.rng` 喂给该实例全部 actor，而非全仓共用一个流。
- **触发条件**：联机 / 回放若不显式注入 rng，默认流承接上次会话残留状态；`World` 构造两次（HMR）时默认流不重置。
- **最小修法**：单一 `WorldRng` 按模块派生子种子；删除 LEGACY_RNG 模块级状态改为每次会话显式注入；生成期贴图 `Math.random` 清零。
- **是否影响 determinism / 存档兼容**：**determinism：是（口径外 / 架构层）**；存档否（但 `provenance` 依赖此源，见 C01）。
- **验收断言**：两次独立「加载模块 → 注入同 seed → 跑 600 步」哈希相等；换 seed 必须分叉。
- **顺带防误报**：`crowd.ts:1227-1241` 的 `hostClock` 用于「真实耗时测量」，注释明示「不走注入时钟」，属**设计取舍**，不计缺陷。

### C14 【确认缺陷·中】读档 `hp=0` 使生存状态机进入不可恢复吸态（`fainted` 预置）
- **现象 / 根因链（四步可复算）**：
  1. `world.ts:842-851` 的 `survival.onFaint` 回调里，`I.save()`（`:846`）排在 `this.survival.revive()`（`:851`）**之前**；
  2. 该时刻 `survival.hp === 0`，`serialize()` → `state()`（`src/game/survival.ts:89-94`，`hp: Math.round(this.hp)`）把 `hp: 0` 写进 `SaveDataV2.survival`；
  3. 读档 `world.ts:330` → `Survival.deserialize()`（`survival.ts:96-102`）末行 `:101` `this.fainted = this.hp <= 0` → 预置 `fainted = true`；
  4. `tick()`（`:46`）与 `damage()`（`:64`）的晕倒沿条件均为 `this.hp <= 0 && !this.fainted` → 恒 false → `onFaint?.()` 永不触发；而清 `fainted` 的唯一路径 `revive()`（`:55-59`）只由 `world.ts:851` 调用，形成闭环死锁。
- **后果**：晕倒罚金、孟婆庄传送、`faints++`、hp 复位全部缺失；`fainted` 永久 true，此后再次饿到 hp=0 也不会再迁移；`hp` 恒 0（除非 `eat()` 回血，但 `fainted` 仍不清）。同时 `survival.bossesDown` 因 survival 入档而持续累加（与 C01 放大链 ② 叠加）。
- **触发条件**：玩家晕倒且 `I.coins > 0`（`world.ts:845-846` 仅 `penalty > 0` 才 `I.save()`），随后刷新读档。**确切路径，非假设**。
- **精确化（防证伪）**：`fainted` 是 `private`，全仓 grep 只在 `survival.ts:34/46/47/56/64/65/101` 被读，`world` / `player` 均不读 → **玩家输入不会被锁、游戏不「卡死不能动」**。这是「生存状态机吸态 + 晕倒奖励 / 罚金链永久失效」，请勿按「卡死」字面证伪。
- **最小修法**：`deserialize` 改为 `this.fainted = false`（交由 tick 沿重新判定），或把 `world.ts:846` 的 `I.save()` 移到 `:851` `revive()` 之后；并把 `fainted` 显式纳入存档。
- **是否影响 determinism / 存档兼容**：determinism 否；**存档兼容：是**。
- **验收断言**：`survival.deserialize({hp:0,hunger:0,faints:1,bossesDown:0})` 后 `tick(0.1)`，断言 `onFaint` 被调用恰好一次、`revive()` 后 `hp > 0`（当前实现会挂：0 次）。见 I1b。

### C09 【确认缺陷·中】聚焦状态机：补间期间 `focusPos` 未赋值，视线被拉偏
- **现象**：`engine.ts:565` `focusPos = new THREE.Vector3()`（原点初值）；`focusOn()`（`:742-759`）在 `:746` 先置 `focusUntil`，补间 `onU` 每帧写 `camera.position` / `lookTarget`，但 `focusPos` **只在 `:758` 的 `onEnd` 里 `.copy(pos)`**。`step()`（`:911-912`）先 `tweener.update()` 再 `updateCamera()`；focus 分支（`:964-969`）每帧 `this.lookTarget.lerp(this.focusPos, Math.min(1, dt*3))` → 补间全程把 `onU` 刚写好的 `lookTarget` 又朝 `focusPos`（首次为世界原点）拉 `dt*3`，随后 `syncAnglesFromView()` 把 yaw / pitch 同步到被拉偏的视线。调用点真实存在：`world.ts:1692` 点击英雄聚焦。
- **触发条件**：每次 `focusOn()` 的 1.4s 补间期；首次聚焦偏向量最大（拉向 `(0,0,0)`）。
- **最小修法**：`focusOn()` 开头即 `this.focusPos.copy(pos)`，或 focus 分支在补间未结束时跳过 lerp。
- **是否影响 determinism / 存档兼容**：均否（属相机状态正确性）。
- **验收断言**：调 `focusOn(pos)` 后单步 `step(dt)`，断言 `lookTarget` 等于补间插值（不被原点拉偏）。

### C10 【确认缺陷·中低】双时钟不一致：引擎 `t` 与墙钟混用
- **现象**：`focusUntil`（`engine.ts:746` / `:965`）、`cinemaT`（`:958`）、`Tweener.t`（`src/core/tween.ts:15`）用引擎累计 `t`；而 `busyUntil`（`interact.ts:104`、`player.ts:219` / `:455`）、`impactUntil` / `bumpCd` / 重生时刻（`physics.ts:104-202`）、`crowd.ts:2040` 用墙钟 `clock()`。后台标签页 rAF 停时 `t` 不推进、墙钟继续；dt 被钳到 0.1s 后恢复，`t` 落后墙钟，focus 仍「未超时」而 busy / impact 已过期。引擎无 `pause()` / `resume()`（`TimeOfDay.paused` 只管昼夜）。
- **触发条件**：切后台标签页、暂停、慢帧后恢复；固定步回放。
- **最小修法**：统一到单一仿真时钟（注入 `() => engine.t*1000`，与 C06 修法 ① 同源），或明确分层并补暂停时的时钟对齐。
- **是否影响 determinism / 存档兼容**：**determinism 间接是**（回放分叉）；存档否。
- **验收断言**：注入假时钟，断言 `focusUntil` 与 `busyUntil` 在同一时基上可比较；模拟后台 5s 后恢复，状态不跳变。

### C11 【疑似需运行时验证】两个 SaveManager 实例 + 首次写档竞态
- **现象**：`world.ts:324` 读档实例（`void mgr;` `:333` 从不 `close()`，IDB 连接泄漏），`world.ts:771` 另建写档实例，`:772` `void saveMgr.open().then(() => { window.__saveSave = ... })` 是**异步注入**且无 `.catch`。但 `world.ts:834-840` 的「化身与交互」步在读档恢复后立即 `this.interact.save()`，该步只 `await raf()`（`world.ts:958` / `:989`），**不等待 IDB open**。若 open 晚于该步，`:838` 的 `save()` 因 `__saveSave` 未注入而只写 localStorage、跳过 IDB。玩法侧表现（play-expert 对齐）：「扛包 / 赌局 / 买货刚结算就刷新页面可能丢档」。
- **触发条件**：IndexedDB open 慢 / 冷启动；读档有 economy 数据时。
- **最小修法**：`await saveMgr.open()` 后再进入依赖步；复用单一 SaveManager；读档实例 `close()`。
- **是否影响 determinism / 存档兼容**：determinism 否；**存档兼容：疑似**（三币仍落 localStorage，可能被 legacy 迁移路径自愈，需运行时确认）。
- **验收断言**：节流 IDB open，断言首次 `interact.save()` 时 `window.__saveSave` 已存在且 slot 被写入。

### C12 【疑似需运行时验证】存档写入无 `NaN` / `Infinity` / `undefined` 防护
- **现象**：`interact.ts:87-94` 直接把 `this.coins` / `yinde` / `peach`、`survival.serialize()`、`karma.current().karma` 塞进对象，`save.ts:127` 直接 `JSON.stringify(full)`（`NaN` / `Infinity → null`、undefined 字段被删除），**写前无 `Number.isFinite` 校验**。`world.ts:835-837` 读回时 `this.interact.coins = this.interactPending.coins`，若为 `null` 则 `Math.floor(I.coins * this.survival.coinPenaltyRatio)`（`world.ts:845`）等运算传播 NaN。`legacyFromLocalStorage()`（`save.ts:71-77`）的 `parseInt` NaN 防护只覆盖 legacy 路径。
- **触发条件**：任一数值被污染（如 `earn(NaN)`、生存值异常）。**未见确凿污染路径**，故列疑似，不按确认缺陷报。
- **最小修法**：`save()` 入口对全部 number 做 `Number.isFinite` 断言 / 清洗；`load()` 后校验。
- **是否影响 determinism / 存档兼容**：determinism 否；**存档兼容：疑似**。
- **验收断言**：注入 `NaN` / `Infinity` / `undefined` 到各字段，断言 stringify 前被拒或读回后无 `null` / `NaN`（见 I2）。

### C13 【设计取舍非缺陷 / 已登记项】（逐条证伪时请勿当新缺陷）
1. `src/rt/loop.ts:15-55` `FixedStepLoop` **全仓零调用点**，主循环 `engine.ts:909-933` 仍是变步长 `dt` 直接驱动 updatables；`physics.ts:254-260` 自带另一套固定步累加器（`FIXED_DT = 1/120` / `MAX_SUBSTEPS = 16`）。`loop.ts:5-7` 注释明说「只交付基础设施，接入本身是行为变化，属 P0-5b」——**设计取舍**，但若要逐帧确定性必须接入（见 I8）。
2. `engine.ts:891-892` `if (this.frameMs.length > 600) this.frameMs.shift();` 重复两行（窗口实为 599 帧）—— D7 §0.3 行 107 **已登记为探针自身缺陷**「修它是 D1 的事，本卷只登记」，非新发现。
3. 3 个「有 emit 无 on」事件：`codex:unlock`（`world.ts:789`）、`karma:ascend`（`karma.ts:45`）、`crowd:density`（`world.ts:1686`）全仓无订阅者——疑似预留给探针；`world.ts:1037` 的 `battle:report` 空处理器是占位。**不构成静默丢事件缺陷**（无消费者即无语义），登记备查。
4. `engine.ts:119-120` LOD 剪影 LCG `seed=7`、`fx/vfx.ts` / `audio/scape.ts` / `world.ts:1642` 的 `Math.random` 属运行时特效 / 音效 / 玩法表现，按 `behaviors.ts:11-12` 与 ADR-3 口径**属设计取舍非缺陷**（不进 sim、不进存档）。
5. `main.ts:88-94` `boot().catch()` 已有日志与可见提示；`engine.ts` `step()` 无 `try/catch` 故单帧异常会冒泡到控制台而非被静默吞掉（rAF 在 `step` 前重新注册，循环不停）——此处**不是**「异常被吞」，如实说明。

---

## 二、不变量清单（项目必须成立、当前缺断言保护的 8 条 + I1b）

| # | 不变量 | 建议单测写法 |
|---|---|---|
| I1 | **存档往返等价**：`SaveDataV2` 每个字段 serialize → migrate → 恢复后逐值相等（C01 / C14 破） | vitest 构造含 `economy / entities / voxel / survival / karma` 全字段档，`JSON.parse(JSON.stringify(d))` → `migrate()` → 模拟 `world` 恢复，逐字段 `toEqual`；**扩展断言补** `karma`、`codexLog`、`objectiveDone`、`playerWeapon`、`boss.defeated`、`survival.fainted`（或其可观测效果）；`entities` 非空样本必测 |
| I1b | **晕倒沿读档后仍可触发**（专防 C14） | 构造 `survival.hp=0` 的档 → `deserialize` → `tick(0.1)`，断言 `onFaint` 恰好一次且 `revive()` 后 `hp>0`；当前实现必挂 |
| I2 | **存档数值有限**：写入存档的每个 number 必须 `Number.isFinite`，产出 JSON 不含 `null` / `NaN` | 参数化注入 `{coins:NaN, karma:Infinity, voxel:[undefined]}` 等，断言 `save()` 前被 sanitize 或抛错；`JSON.stringify` 结果不含 `:null`（除显式可空字段） |
| I3 | **订阅守恒**：每个 `bus.on` 有配对 `off`；重复初始化后 handler 总数不增长 | 暴露 `Bus` 的 handler 计数 getter；连跑两次 `new World(engine).init()` + `initUI()`，断言总 handler 数恒定；断言旧 world 的回调不再被触发 |
| I4 | **单订阅者异常隔离**：某 handler 抛错不得阻断其余 handler、不得冒泡 | `bus.on('x', ()=>{throw})` + `bus.on('x', spy2)`，断言 `expect(()=>bus.emit('x')).not.toThrow()` 且 spy2 被调用（当前 `rng.ts:31-34` 无 try/catch，会挂） |
| I5 | **生成确定性哈希**：同 seed 两次完整生成，几何顶点 + 实体表快照 + 贴图 canvas 像素三类哈希逐位相等 | 打包态探针跑两次 `world.init()`，对 `Baker` 缓冲、`entityStats()` 快照、6 材质 / 地表 / 云 `toDataURL()` 分别 sha256 比对；C05 当前会挂 |
| I6 | **无墙钟进入仿真状态**：`renderOnce(dt)` 相同 dt 序列两次跑，实体位置 / 状态哈希相等 | stub `performance.now` 为递增值 + 冻结 `Date.now`，`renderOnce(1/60)` × 120 两次，对 `Crowd` 位置 + `impactUntil` / `busyUntil` 取哈希比对；**必须显式包含 attach 组（桥面 6 人 + 城墙巡逻组）**；C06 / C10 当前会挂 |
| I7 | **生命周期对称**：`dispose()` 后 rAF 停止、listener 全移除、`renderer.info.memory.geometries` 归零、`setLodSink(null)` | spy `addEventListener` / `removeEventListener` / `requestAnimationFrame` / `cancelAnimationFrame`，构造 → `dispose()` 断言配对计数相等且 rAF 无新调度 |
| I8 | **主循环不变量**：`dt ∈ [0,0.1]`、固定步累加器不同帧长同弹道、updatables 保序 | 喂 `dt = -1/0/0.5/NaN` 断言 clamp 到 `[0,0.1]`；`1/60×60` vs `1/120×120` 驱动 `FixedStepLoop` 断言状态一致（容差一个子步）；`removeUpdate` 后数组顺序与注册序一致（`engine.ts:767-772` 已保序，补断言防回归） |

---

## 三、给第 2 轮对抗审查的复核提示

1. **C03 / C04** 的泄漏触发条件是「第二次构造 / 重建」，当前 `main.ts` 单 boot 不触发，请勿据此判「无缺陷」——核对 D7 §5 行 626 的 HMR 重建前提。
2. **C05 / C06 / C08** 的确定性结论限定在「基线门覆盖范围之外」，核对 `probe-determinism.mjs:29-37` 的 SIM_FILES 清单；C06 的「注入 clock 救不了 attach」请按 `crowd.ts:2053` + `world.ts:444/486` 直接调用链复算。
3. **C09** 请按 `step()` 的 `tweener.update()` → `updateCamera()` 顺序逐步复算。
4. **C01** 放大链请按「单会话靠 `boss.defeated`、跨会话意图靠 `codexLog` 但未入档」理解；**C14** 请按「状态机吸态」而非「游戏卡死不能动」理解。
5. **C11 / C12** 标为【疑似需运行时验证】，请勿按确认缺陷证伪或升级；结论中已注明未找到确凿污染 / 竞态触发路径。
6. **C13** 整节为设计取舍 / 已登记项，不计入缺陷数。

## 四、与其他专家的分工与交叉对齐

- **play-expert**：玩法经济后果（业力读档清零、目标链重跑、反复存读档刷 300 文 + 2 蟠桃、扛包结算刷新丢档、`survival.deserialize` 卡死边界）归其 P-08 / P-09 / P-13 与越界备注；**序列化根因归本文 C01 / C02 / C11 / C12 / C14**。已双向对齐，不重复报。
- **motion-expert**：其 M-14 据同一证据从【设计取舍】改判为【确认缺陷】（确定性门只覆盖注入路径、生产默认构造从未注入＝假绿）；其补充的「attach 位置本体由墙钟算出、注入 clock 也救不了」已并入本文 C06 并修正最小修法；`crowd.ts:40-49` 第二份 LEGACY_RNG 已并入 C08。
- **geom-expert / ui-perf-expert**：无重叠，未交叉。

> 全文结论均提供 file:line，可逐条复算。src 源码未做任何修改；本文件为唯一授权落盘的审核产物。
