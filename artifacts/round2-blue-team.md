# 第 2 轮 · 蓝队「跨系统盲区补审」结论（blue-team）

> 角色：与第 1 轮 5 位领域专家、红队**完全不重复**。红队证伪已有结论；本队只找**两个及以上系统之间的接线 / 时序 / 状态同步 / 数据口径**缺陷，不报单个模块内部问题。
> 基线：`git HEAD = be0226e`；dev server `http://127.0.0.1:4182/`（未写入、未落盘脚本）；`npx tsc --noEmit` 0 错 / 137 tests 全绿（沿用基线，本队不重跑）。
> 必读输入已全部读完：`round1-geom.md` / `round1-play.md` / `round1-ui-perf.md` / `round1-runtime-evidence.md` / `round1-motion.md` / `round1-core.md` / `VISUAL-AUDIT-20261107.md`；源码逐行复核 `main.ts` / `world.ts` / `core/rng.ts`(Bus) / `rt/save.ts` / `game/*` / `ui/ui.ts` / `core/engine.ts` / `sky/heavenFrame.ts` / `sky/havoc.ts` / `audio/scape.ts` / `data/levelPlan.ts` / `game/poiGuide.ts` / `game/conditions.ts` / `sky/underworld.ts`。
> 纪律：**全程只读**，未修改任何 `src/` 源码，未运行构建 / 测试，未写脚本落盘。本文件是唯一写入项。
> 口径：每条给 `file:line` + 触发条件 + 可观察后果 + 最小修法 + 验收断言；严格区分【确认缺陷】/【疑似需运行时验证】/【设计取舍】/【对 XX 条的补充，不重复计入】。
> 数量：**9 条正式缺陷**（8 确认 + 1 疑似），按「玩家可见错误 / 经济损失 / 卡死」排序；补充小节 7 项均明确「不重复计入」。

---

## 〇、总体判定（最重要）

**第 1 轮按领域切分，必然漏掉「跨文件接线时序」这一层。本轮最关键的产出是 B-01：`main.ts` 把造物重演回调注入到 `await world.init()` 之后，而调用该回调的载入任务在 `world.init()` 内部——回调永远为 `null`，造物读档重演从未执行过一次。** 这不是存档字段缺失（core C01 已报），而是「即使补齐字段也不会自愈」的独立时序缺陷；修复 C01 时必须同时改这里，否则白修。

第二层是**同一个根因（`main.ts:82` 的 `__qingming` 调试句柄注入晚于 `initUI()` 与 `world.init()` 内部所有代码）**派生出两条后果：B-02（HUD 三币首刷落空）与「启动期 `interact.save()` 必然跳过 IndexedDB」（对 core C11 的补充）。UI 装配 / 存档接线 / 主启动三处各自都「自洽」，只有把三者放同一时间轴上才暴露。

第三层是**同一份「玩家位置」被两个系统取了不同源**：`poiGuide` 用相机、`objectiveReached` 用化身（B-03），导致灵魂模式目标链全程不推进；以及**同一份「地府地面」被四处写出三个数值**（B-09）。

---

## 一、缺陷清单（9 条，按严重度降序）

### B-01 【确认缺陷 · 最高】造物重演回调注入晚于调用：`world.init()` 内「造物重演」步永远空转 → 花 100 文造的龙刷新即消失
**盲区类别**：① 装配时序 / ② 注入回调空值 / ⑧ 存档与运行时期望的闭环（三者叠加）

- **代码根因（精确到行）**：
  - `src/world.ts:631-634` 载入任务 `['造物重演', () => { if (this.onRebuildCreations) this.onRebuildCreations(); }]`；
  - `src/world.ts:956-963` 主循环 `for (let i=0;i<tasks.length;i++){ ... await tasks[i][1](); ... }` —— **所有 task 都在 `World.init()` 返回之前串行执行完**；
  - `src/main.ts:38-41` `await world.init((p,label)=>{...});` —— 阻塞直到上述 33 步全部跑完；
  - `src/main.ts:52` `const creation = new CreationSystem(...)`、`src/main.ts:64` `world.onRebuildCreations = () => { world.creationCount = creation.rebuildAll(); };` —— **均在 `await` 之后**；
  - `src/world.ts:259` `onRebuildCreations: (() => void) | null = null`（初值），全仓 grep 仅 `main.ts:64` 一处赋值、`world.ts:633` 一处调用。
  - 即：调用发生时 `onRebuildCreations === null`（`if` 短路），注入发生在调用之后且**再无第二次调用**。
- **触发条件**：任何一次页面加载（100% 触发，不依赖存档内容）。
- **可观察后果**：
  1. 玩家按 Y 花 100 文造物 → `creation.ts:123-132` `allocate('creation',{persist:true, provenance})` 登记实体 → `interact.save()` 把铜钱入 IDB；刷新页面后新 `World` 的实体表为空，`rebuildAll()` 从未被调用 → `creation.count === 0`，**龙消失且 100 文不退**（经济损失 + 内容丢失）；
  2. 与 core C01 叠加放大：`interact.ts:90` 写 `entities: []`、`rt/save.ts:85` `collectPersistedEntities()` 全仓零调用、`world.ts:327-332` 读档不恢复 `entities` —— 即使将来补齐 entities 读写，**重演仍不会发生**，因为回调时序没修；
  3. `world.creationCount`（`world.ts:307`）读档恒 0 → `ui.ts:180-181` `topCondition({hasCreation: cre>0})`、`conditions.ts:46/50` 的 c-boss / c-creation 都以 `!hasCreation` 为前提 → HUD「⚡」行在玩家已造过物后仍反复提示「按 Y 许愿，造一条龙」（对 core C01 的补充，见 §二）。
- **最小修法**：二选一 —— (a) 把 `main.ts:64` 的注入移到 `main.ts:38` 的 `await world.init()` **之前**（需先把 `creation` 构造也提前，或改成注入一个闭包延迟读 `creation`）；(b) 删除 `world.ts:631-634` 这个 task，改由 `main.ts` 在 `await world.init()` 之后显式 `world.creationCount = creation.rebuildAll()`。**同时**按 C01 补 `collectPersistedEntities()` 写档 + 读档恢复 entities，否则重演拿到空表。
- **验收断言**：在 `await world.init()` 之后 spy `world.onRebuildCreations` 的调用次数 ≥1（当前 0）；端到端：造物 1 件 → `save()` → 重载 → 断言 `creation.count === 1` 且 `world.creationCount === 1`（当前 0/0）。
- **不重复声明**：core C01 报的是「存档字段写了不读」，**未涉及回调注入时序**；本条独立成立，但若主线程只修 C01 不修本条，造物重演依旧不触发。

---

### B-02 【确认缺陷 · 中高】`__qingming` 注入晚于 `initUI()` 首刷 → 顶栏三币 / 铜钱在首次经济操作前恒显 `💰 -- 文` 与空白
**盲区类别**：① 装配时序 / ④ 跨系统数值双源

- **代码根因**：
  - `src/main.ts:35-36` `const world = new World(engine); const uiTick = initUI(engine, world);` —— `initUI` **同步执行完毕**；
  - `src/main.ts:82` `(window as ...)['__qingming'] = { engine, world, THREE, scene }` —— 位于 `main.ts:38-41` 的 `await world.init()` **之后**（也晚于 `main.ts:74` `engine.start()`）；
  - `src/ui/ui.ts:123-128` `renderTri()` 的数据源是 `(window as ...).__qingming?.world?.interact`，并在 `initUI` 内**立即首刷**（`:128 renderTri();`）；`ui.ts:125` 注释自认「含铜钱首刷（构造期无 coins:change）」——作者以为此时能读到 world，实际 `__qingming` 尚未赋值；
  - `src/ui/ui.ts:114-118` `coinsEl` 初值 `'💰 -- 文'`，只由 `bus.on('coins:change', (n)=>...)` 更新；`ui.ts:127` 又注册 `bus.on('coins:change', renderTri)`；
  - `src/game/interact.ts:97` `bus.emit('coins:change', this.coins)` **只在 `save()` 里发**；`interact.ts:37-49` 构造不调 `save()`；`world.ts:834-839` 仅当 `interactPending`（读档成功）才调 `this.interact.save()`，且该调用发生在 `world.init()` 内 —— 此时 `__qingming` 仍是 `undefined`。
- **时序推演（确定，非竞态）**：
  - `initUI` 首刷：`__qingming === undefined` → `it === undefined` → `triEl`（💠/🍑）与 `coinsEl` 都不写；
  - 读档路径 `I.save()` 发 `coins:change`：`ui.ts:118` 用**事件载荷 n** 把 `coinsEl` 修正为读档后的钱，但 `renderTri` 仍读不到 `__qingming.world` → **`triEl` 恒空**；
  - 新档路径：`world.init()` 期间根本不发 `coins:change` → `coinsEl` 恒 `'💰 -- 文'`、`triEl` 恒空；
  - `engine.start()` 之后直到玩家第一次 `pay/earn/refund/addPeach/save()`（买东西、扛包、晕倒罚金……）才再次发 `coins:change` 且 `__qingming` 已注入 → HUD 才自愈。
- **触发条件**：每次冷启动，从加载完成 / 开场运镜（`main.ts:80` `startCinema()`，`buildCinema` 84s）到玩家第一次经济操作之间。新档最严重（铜钱行也是错的）。
- **可观察后果**：玩家一进游戏就看到顶栏「💰 -- 文」+ 空白的「💠  🍑」，而内存里 `interact.coins=500 / yinde=0 / peach=3` 是正确的。属**玩家可见的 HUD 数值错误**（非经济数据损坏）。
- **最小修法**：`renderTri()` 直接读 `initUI` 已拿到的 `world` 形参（`world.interact`），不要绕 `window.__qingming`；或把 `main.ts:82` 的 `__qingming` 注入提前到 `main.ts:36` `initUI()` 之前。顺带 `coinsEl` 的首刷也改为从 `world.interact` 取值，消除「两个订阅者一个用载荷、一个用全局句柄」的双源。
- **验收断言**：页面加载完成且**不触发任何经济操作** → 断言 `#coins.textContent === '💰 500 文'`、顶栏 `span` 含 `💠 0  🍑 3`（当前 `'💰 -- 文'` / 空）。
- **不重复声明**：ui-perf 报告核的是「HUD 每 0.5s 节流刷新」（UI-14 正面确认），**未核首刷的数据来源与赋值时机**；play 报告核的是三币结算数值，**未核 HUD 首刷**。

---

### B-03 【确认缺陷 · 中高】目标链「玩家位置」双源：`poiGuide` 用相机、`objectiveReached` 用化身 → 灵魂模式 / 自由飞行时目标链全程不推进
**盲区类别**：④ 状态同步 / ⑤ 坐标口径 / ① 装配接线（对 play P-13 的补充，不重复计入其「jiangtai 判定」）

- **代码根因**：
  - `src/world.ts:1479` `this.poiGuide?.update(this.engine.camera, this.engine.camera.position, POIS as ...)` —— 第三个实参 `playerPos` 传的是**相机位置**；
  - `src/game/poiGuide.ts:52` `const d = p.pos.distanceToSquared(playerPos);` 按相机取「最近核心 POI」，`:58` `this.last = {key: bestKey, ...}`，`:43` 每 8 帧刷新一次；
  - `src/world.ts:1786` `const n = this.poiGuide?.current();`、`src/world.ts:1788` `if (!this.objectiveReached(n.key)) return;`；
  - `src/world.ts:1775-1779` `objectiveReached` 明确取 `const a = this.player?.actor?.pos`（**化身**），注释自认「必须按化身距离判定：相机是第三人称偏移 45m，用相机距离会出现『人没走到就判达成』」；
  - `src/game/player.ts:270-275` 灵魂模式 `update()` 早退，**只改 `actor.action`、不动 `actor.pos`**；而 `engine.updateCamera`（`engine.ts:970-1001`）用 `keys` 驱动的是 `camera.position`；
  - `src/world.ts:1718-1720` 只有 `teleport()` / `respawnPlayerAt()` 才会把化身一起搬到 POI。
- **触发条件**：`player.mode === 'soul'`（默认）且玩家用 WASD / 拖拽自由飞行（非传送面板）靠近任一 `LEVEL_ORDER` 节点；或附身态下相机与化身相距 `camDist=7.5m`（`player.ts:48`）时靠近半径被压到 `Math.max(6, radius*0.2)` 的节点。
- **可观察后果**：
  1. 灵魂模式飞遍地府 / 天宫，`poiGuide.current()` 随相机正确变化（导引箭头指向正确），但 `objectiveReached` 用停在出生点 `(-20,0,58)` 或最后传送点的化身算距离 → 除该点附近外**恒不成立** → `objectiveDone` 不增长、HUD「🎯 目标 0/17」常驻、`codexLog` 不追加。玩家用「云路传送」面板反而能点亮（因为 `teleport` 同步搬了化身）——**同一目标，「传送」有效、「飞过去」无效**，口径不自洽；
  2. 附身态相机偏移 7.5m + 每 8 帧刷新滞后，会在两 POI 交界处出现「箭头指 A、`current()` 返回 A、但化身其实已站进 B 的 6m 判定圈」→ B 永不点亮（与 P-13 的「乱序完成进度跳变」是同一状态机的反向表现）。
- **最小修法**：`world.ts:1479` 把 `playerPos` 改为 `this.player?.actor?.pos ?? this.engine.camera.position`，让导引与目标判定同用化身；若产品意图是「灵魂模式也要按相机导引」，则 `objectiveReached` 需按 `mode` 分流（soul 用相机、avatar 用化身）并同步写进注释，二选一，杜绝两套源。
- **验收断言**：`mode='soul'`、`actor.pos` 固定在 `(-20,0,58)`，把 `camera.position` 移到 `POIS['yanluo']` 中心 → 推进 1s → 断言 `world.objectiveDone['yanluo'] === true` 且 `objectiveProgress().done === 1`（当前 `false` / `0`）。
- **不重复声明**：play P-13 报的是「`jiangtai` 只认 `boss.defeated` + 乱序完成 HUD 跳变」，**未涉及相机 / 化身双位置源**；motion M-09 报的是 `realmFloor` 取 `player.realmY` 而非相机 y，属相机夹取值，与本条的「目标判定取值」不同。本条明确标为 **对 P-13 的补充，不重复计入**。

---

### B-04 【确认缺陷 · 中】后台 / 切页：wall-clock 延迟结算照常到账、sim-time 的 havoc 冻结 → 三界动词业力 / 金钱流向不对称
**盲区类别**：⑥ 暂停 / 切后台 / 长时间挂机状态一致性（对 core C10 / play P-07 的补充，不重复计入其根因）

- **代码根因**：
  - wall-clock 结算：`src/world.ts:1620-1624` 扛包 `window.setTimeout(..., 8200)` → `I.earn(20); this.karma.gain(2,'human')`；`src/world.ts:828-831` 狱环 `setTimeout(..., 6200)` → `this.karma.gain(5,'underworld')`；`src/game/player.ts:449` portal `setTimeout(..., 460)`；`src/game/interact.ts:105` 动作复位 `setTimeout`；`interact.ts:288` 五子棋 `setTimeout(...,260)`；`src/game/creation.ts:95` `setTimeout(...,60)`；
  - sim-time 循环：`src/world.ts:1476` `this.havoc.update(t, dt)`；`src/sky/havoc.ts:357` `this.pt += dt`，`:359-371` `k>=1` 才 `pi=(pi+1)%len` 且**每次 update 最多推进一幕并 `return`**；`src/core/engine.ts:888` `dt = Math.min(0.1, Math.max(0, ...))` 钳到 ≤0.1s；`engine.ts:884-900` 主循环由 `requestAnimationFrame` 驱动（后台标签页 rAF 被浏览器暂停 / 节流）；
  - 全仓 grep **无 `visibilitychange` / `document.hidden` 处理**（`engine.ts:811` 只有 `blur → endDrag`，ui-perf UI-03 已报 blur 不清 `keys`）。
- **触发条件**：触发扛包 / 狱环后立刻切到别的标签页 ≥9s（或最小化、锁屏）；期间不回前台。
- **可观察后果**：
  1. `setTimeout` 是 wall-clock，后台标签 Chrome 只**节流**不取消，8.2s / 6.2s 的长延时仍会触发 → 玩家「人不在场」时照常 `+20 文 +2 业力` / `+5 业力`（P-07 已报离场仍结算，此处被后台放大）；若切后台前已晕倒，`world.ts:844` 的 `karma.penalty()` −100 会被延迟回调的 `+2/+5` 加回；
  2. 同一段后台时间，havoc 因 rAF 停 → `pt` 不推进 → `pi===9`（幕间·蟠桃宴）不触发 → `world.ts:765-768` 的 `+1 蟠桃 +8 业力` **不发生**；回前台首帧 `dt` 被钳 0.1s 且 havoc 每帧最多 +1 幕，也不会补跳；
  3. 净效果：**「前台挂机」天宫产业力、人间/地府也产；「后台挂机」只有人间/地府产、天宫不产** —— 三界动词（karma.ts:8-11 的设计口径）的业力流向随标签可见性翻转。
- **最小修法**：把扛包 / 狱环 / portal / 动作复位的结算挂进 `world.update` 的 sim-time 累加器（带 token：玩家仍在原交互点、未传送、未晕倒、`mode` 未变），离开 / 死亡 / `visibilitychange(hidden)` 时取消；或统一用 `visibilitychange` 冻结全部 wall-clock timer 并在 `visible` 时按 `engine.t` 补算。与 core C10「统一到单一仿真时钟」同源。
- **验收断言**：触发扛包 → 派发 `visibilitychange`（hidden）→ 推进 9s 墙钟但只喂 0 帧 → 断言 `coins` / `karma.current().karma` 不变；对照组回前台推进 9s 仿真时间断言到账。
- **不重复声明**：core C10 报「双时钟不一致」架构结论、play P-07 报「离场 / 晕倒后 setTimeout 仍结算」，均**未点出后台标签下 `setTimeout` 存活而 havoc 冻结所导致的三界业力流向方向性不对称**。本条为 **对 C10 / P-07 的跨系统后果补充，不重复计入其根因**。

---

### B-05 【确认缺陷 · 中】`codexLog` 被 POI 导引点污染：非关卡节点被写成「已达成」图鉴条目，且写在 `inChain` 判定之前
**盲区类别**：④ 数据口径双源 / ⑧ 存档与运行时期望（对 play P-13 的补充，不重复计入）

- **代码根因**：
  - `src/game/poiGuide.ts:8` `GUIDE_KEYS = ['sunyang','bridge','goulan','yamen','yanluo','naihe','lingxiao','yaochi','jiangtai','sansheng']`（含大量非 `LEVEL_ORDER` 键）；`:47` 候选集 `LEVEL_PLAN ∪ GUIDE_KEYS`；
  - `src/world.ts:1786` `const n = this.poiGuide?.current();`（最近 POI，可能是 `bridge` / `sunyang` / `yamen`）；`:1789` `this.objectiveDone[n.key] = true;`；`:1790-1792` `if (!this.codexLog.some(...)) this.codexLog.push({ code:'node:'+n.key, name:n.name, note:'已达成 · '+n.objective });`；
  - `src/world.ts:1795` `const inChain = LEVEL_ORDER.includes(n.key);` —— **在 push 之后才算**，且只用于 `:1797`/`:1801` 的 toast 与 `objective:done` 事件，**没有回过头约束 1789/1790**；
  - `src/data/levelPlan.ts:71` `LEVEL_FALLBACK = { objective:'此处可游历、可观景', ... }`、`:73-75` `levelOf(key)` 对非关卡键返回兜底；`:82-89` `LEVEL_ORDER` 仅 17 键（人间 6 个不含 `bridge`/`sunyang`/`yamen`）；
  - `src/ui/ui.ts:252-262` `renderCodex()` 把 `world.codexLog` **全量**渲染在图鉴每个 tab 的「已了结的际遇」区。
- **触发条件**：`tickObjectives`（`world.ts:1782-1785`，每 0.4s）时 `poiGuide.current()` 为导引点且化身进入 `objectiveReached` 的 `d <= Math.max(6, radius*0.2)`（`world.ts:1779`）——传送到 `bridge` 并停留 1s 即命中。
- **可观察后果**：图鉴「已了结的际遇」凭空多出「上河虹桥 已达成 · 此处可游历、可观景」之类**兜底文案条目**，且 `objectiveDone` 里塞进非关卡键（未入档，见 C01）。玩家打开图鉴 / 切 tab 都会看到这批噪声；`codexLog` 未入档又使其读档后清空，出现「玩着玩着多一堆、刷新又全没了」的抖动。
- **最小修法**：把 `const inChain = LEVEL_ORDER.includes(n.key)` 提到 `:1789` 之前，`objectiveDone` / `codexLog.push` 整体包进 `if (inChain)`；导引点仍可更新 `poiGuide` 的箭头与 ✓ 标记，但不写进度账与图鉴账。
- **验收断言**：`world.teleport('bridge')` → 推进 1s → 断言 `world.codexLog` 不含任何 `code==='node:bridge'`、`world.objectiveDone['bridge'] === undefined`、`objectiveProgress().done === 0`（当前会 push 一条并置 true）。
- **不重复声明**：play P-13 报「jiangtai 判定 + HUD 进度跳变」，**未涉及 codexLog 写入口径**；core C01 报「codexLog 未入档」，**未涉及写入污染**。本条为 **对 P-13 的补充，不重复计入**。

---

### B-06 【确认缺陷 · 中低】IDB 主档与 localStorage legacy 影子档数值双源：`save()` 只写 `cq_coins`，降级回退时阴德 / 蟠桃取旧值
**盲区类别**：④ 跨系统数值双源 / ⑧ 存档闭环（对 core C01 / C07 的补充，不重复计入其字段不对称根因）

- **代码根因**：
  - `src/game/interact.ts:80` `save()` **只** `localStorage.setItem('cq_coins', String(this.coins))` —— 不写 `cq_yinde` / `cq_peach`；
  - `src/game/interact.ts:42-44` 构造却用 `loadInt('cq_coins'|'cq_yinde'|'cq_peach', 500|0|3)` 读**三键**；
  - `src/rt/save.ts:72-77` `legacyFromLocalStorage()` 同样读三键；`save.ts:195-207` `loadOrMigrateLegacy()` 在 IDB 全空 / 全坏时 `const legacy = legacyFromLocalStorage(storage)` 组装 v1 并 `await mgr.save(migrated)` 落档；
  - `src/world.ts:327-332` 读档以 IDB 的 `saved.economy`（三币全量）为准覆盖 `interactPending`，正常路径自洽 —— **问题只在降级回退路径**。
- **触发条件**：IDB 三槽全不可读（隐私模式 / 配额 / 坏档，见 core C07 的 `load()` 回退）且 localStorage 残留旧三键。此时 `yinde` / `peach` 取到的是「上次 legacy 迁移时的旧值」或默认 `0/3`，而 IDB 主档里玩家真实攒的阴德 / 蟠桃被丢弃。
- **可观察后果**：玩家阴德 / 蟠桃**回档**（例如 10 阴德 → 0、9 蟠桃 → 3），且 `peach` 回档会连带影响 `conditions.ts:54` c-peach 与瑶池蟠桃赏赐兑换。属经济损失，但触发面窄。
- **最小修法**：`save()` 同步写三键 `cq_yinde` / `cq_peach`（与 `cq_coins` 同口径）；或明确以 IDB 为唯一真源，`loadOrMigrateLegacy` 迁移成功后清除 localStorage 三键，杜绝两处长期并存。
- **验收断言**：置 `interact.yinde=7, peach=2` → 调 `save()` → 断言 `localStorage.getItem('cq_yinde')==='7'`、`cq_peach==='2'`（当前不变）；再模拟 IDB 全坏 → 重载 → 断言读回 `[yinde,peach] === [7,2]`。
- **不重复声明**：core C01 / C07 报「IDB 字段不对称 / 坏档降级」，**未涉及 localStorage 三键只写其一造成的两处介质数值分叉**。本条为补充。

---

### B-07 【确认缺陷 · 中低】`cam:mode` 发出 `'avatar'` 载荷，UI 枚举与 `engine.camMode` 都不认 → 附身后「视角」按钮文案空、状态脱节
**盲区类别**：③ 事件名与载荷不一致

- **代码根因**：
  - `src/game/player.ts:173` `toggleMode()` 的 avatar 分支 `bus.emit('cam:mode', 'avatar');`，且**不调用** `engine.setCamMode(...)`；
  - `src/core/engine.ts:17` `export type CamMode = 'cinema'|'fly'|'walk'|'focus'` —— **无 `'avatar'`**；`engine.ts:551` `camMode: CamMode = 'cinema'` 因此保持原值（通常 `'fly'`）；
  - `src/ui/ui.ts:131` `const camNames = { cinema:'运镜', fly:'飞行', walk:'漫游', focus:'聚焦' }`；`:137-140` `bus.on('cam:mode', (m)=>{ $('bCam').innerHTML = '🎬 视角·' + (camNames[m as string] ?? ''); $('skip').classList.toggle('show', m==='cinema'); })` —— `'avatar'` 落到 `?? ''`；
  - `src/ui/ui.ts:132-136`「视角」按钮的 `onclick` 读的是 `engine.camMode`（真值），与上面 bus 显示的文案是**两个源**。
- **触发条件**：按 V 附身（`player.ts:186`）一次。
- **可观察后果**：按钮变成「🎬 视角·」（无模式名）、`#skip` 被 `toggle('show', false)` 隐藏，而 `engine.camMode` 仍是 `'fly'`；玩家再点「视角」按钮 → `camMode==='fly'` → `setCamMode('walk')`（`engine.ts:729-731` 把 `p.y=1.7`，此钳位已由 motion M-09 报，不重复），与「附身」语义冲突。属玩家可见的 HUD 文案 + 状态脱节。
- **最小修法**：附身态用已有的 `player:mode` 事件（`player.ts:178`，`ui.ts:109` / `world.ts:820` 已订阅）表达，删除 `player.ts:173` 这条 `cam:mode` emit；若保留，则给 `camNames` 补 `'avatar':'附身'` 并让 `engine.camMode` 同步（需扩 `CamMode` 类型）。
- **验收断言**：派发 KeyV → 断言 `#bCam` 文本含有效模式名（非空后缀）、`document.getElementById('skip').classList.contains('show')` 与 `engine.camMode` 一致。
- **不重复声明**：motion M-09 报 `setCamMode('walk')` 的 y=1.7 钳位与 `realmFloor` 来源；ui-perf UI-07 报 keydown 监听归口分散。**均未涉及 `cam:mode` 载荷枚举与 `engine.camMode` 字段三处不一致**。

---

### B-08 【确认缺陷 · 中低】拍照模式 H 键只隐藏 `#ui`，与面板 / 玩法输入 / cinema 三态不互斥且不可恢复
**盲区类别**：⑦ 拍照模式 / 面板 / 隐藏 UI 全局一致性（对 UI-05 的补充，不重复计入其 Escape 死锁）

- **代码根因**：
  - `src/ui/ui.ts:197-202` H 键 handler **只** `document.getElementById('ui').style.display = photoMode ? 'none' : ''`，不设全局 context gate；
  - 同一 `window` 上的玩法键均不检查 `photoMode`：`ui.ts:83-87`（KeyJ → `world.boss?.playerAttack()`）、`ui.ts:89-105`（F1/M/Esc/T/B → `togglePanel`）、`src/game/player.ts:182-189`（V/E/F）、`src/game/buildMode.ts:35`（G）、`src/game/creation.ts:61-64`（Y/Escape）；
  - 所有面板都挂在 `#ui` 内：`ui.ts:12-67` 模板、`interact.ts:118` `this.root.appendChild(p)`、`creation.ts:57` `uiRoot.appendChild(wrap)`、`buildMode.ts:70/84` `uiRoot.appendChild`、`world.ts:823` fade、`poiGuide.ts:39` —— 隐藏 `#ui` 后这些面板**不可见但状态仍在**；
  - `src/ui/ui.ts:141` `$('skip').onclick = () => engine.stopCinema();`，`#skip` 在 `#ui` 内；`src/core/engine.ts:777` cinema 期间只有 `Space/Escape/Enter` 会 `stopCinema()`，而 `ui.ts:53` 帮助文案写「任意键跳过开场运镜」；
  - 挂 `document.body` 的漏网 DOM 仅 `#bossbar`（`boss.ts:235`，**已由 UI-01 报，不重复**）与 `engine.ts:603` 的 WebGL2 不支持提示（启动期）。
- **触发条件**：按 H 进入拍照模式后按 B/T/F1/J/V/G/Y；或开场运镜期间按 H。
- **可观察后果**：
  1. 隐藏期间按 B 打开图鉴 → `.panel.show` 留在隐藏的 `#ui` 里；再按 H 恢复 → 带着一个「隐形打开过」的面板出现（面板状态与可见性脱节）；
  2. 隐藏期间按 J 仍打 Boss、按 V 仍附身、按 G 仍进建造、按 Y 仍开愿望条 —— **「隐藏 UI」不等于「禁用玩法输入」**；
  3. 更强的连锁（**对 UI-05 的补充**）：若 H 之前愿望条已开且焦点在 `#wish-input`，`creation.ts:66-69` 的 `e.stopPropagation()` 在目标阶段阻断冒泡，把 `ui.ts:197` 的 H handler 一起吞掉 → **玩家无法按 H 退出拍照模式**，只能点「造」提交或刷新；`ui.ts:53` 的「任意键跳过」也与 `engine.ts:777` 的 3 键不符，H 隐藏 `#skip` 后只能靠猜。
- **最小修法**：`photoMode` 置位时统一在 keydown 入口加 context gate（吞掉玩法键，只放行 H / Escape），并在切换时 `document.querySelectorAll('.panel.show').forEach(el=>el.classList.remove('show'))` + `document.activeElement.blur()`；`#skip` 改挂 `document.body` 或 H 时单独保留；帮助文案改为「Space / Esc / Enter 跳过」。
- **验收断言**：按 H → 按 B → 按 H → 断言 `document.querySelectorAll('.panel.show').length === 0`；按 H 后派发 KeyJ → 断言 `world.boss.hits` 不变；愿望条聚焦时派发 KeyH → 断言 `photoMode` 翻转（当前被吞）。
- **不重复声明**：UI-01/02（bossbar 层级与常驻）、UI-05（Escape 关不掉 wishbar）、UI-07（keydown 归口）、UI-04（面板按键穿透）均已报。本条只取「H 隐藏 UI ↔ 面板开合 ↔ 玩法输入 ↔ cinema 跳过」这四态的**互斥与可恢复**交叉面；其中「wishbar 焦点吞掉 H」明确为 **对 UI-05 的补充，不重复计入**。

---

### B-09 【疑似需运行时验证】地府「地面」被四处写出三个数值：POI `-258` / `groundHeight` `-260` / `teleport` `-257.5`
**盲区类别**：⑤ 三界坐标 / 缩放换算 / ④ 数值双源（静态事实确凿，「是否可见悬空」需运行时）

- **静态事实（可逐行复核）**：
  - `src/sky/underworld.ts:10` `export const UNDER = { y: -260, ... }`；
  - `src/world.ts:347-366` 地府 POI 全部写 `UNDER.y + 2 = -258`（`naihe`/`yanluo`/`fengdu`/`shibayu`/`mengpo`/`sansheng`），`wangxiang` 甚至 `UNDER.y + 18`；
  - `src/game/player.ts:235-237` `groundHeight(x,z,refY)` 地府分支 `if (refY < -100) return -260;`；`src/game/player.ts:499-502` `PORTALS` 落点 `[0,-260,-130]`；`src/world.ts:1664` 阴阳界交互点 `(0, UNDER.y, -130) = -260`；
  - `src/world.ts:1719` `teleport()` `this.player.actor.pos.set(p.x, p.y + 0.5, p.z)`、`world.ts:1809` `respawnPlayerAt()` 同样 `+0.5` → 传送到 `fengdu`（POI y=-258）后化身脚底 **-257.5**；
  - `src/game/player.ts:128-130` `realmAt(landingY)` 返回 `landingY` 本身（异界钉面），`:146-153` `syncExternalMove()` 在跨帧位移 >8m 时把 `realmY` 重算为落点 y；`:406-408` 附身 `foot` 分支 `p.y = this.realmY`。
  - 即同一「地府可站地面」在 POI 表 / 高度场 / 传送写位置 / PORTALS 表四处分别为 **-258 / -260 / -257.5 / -260**。
- **疑似后果（需运行时）**：附身传送到地府 POI 后，化身被 `realmY` 钉在 -257.5，而烘焙地面与 `groundHeight` 是 -260 → 可能悬空约 2.5m；`world.ts:1459` `engine.realmFloor = this.player?.realmY ?? 1.7` 又把 -257.5 交给相机夹取（`engine.ts:991/997`），与 `applyHellDepth` / `hellPoiShield` 按 `cam.position.y` 的口径（`world.ts:1213/1270`）再叠一层。`world.ts:592-625` 的贴地 raycast 校正只处理 `crowd.actors` 里的 freeze 演员，**玩家化身不校正**。是否肉眼可见、是否影响 `objectiveReached` 的 XZ-only 判定（`world.ts:1777` 只用 x/z，不受 y 影响），需运行时量测。
- **触发条件**：`world.teleport('fengdu'|'naihe'|'yanluo'|...)` 后按 V 附身；或晕倒 `respawnPlayerAt('mengpo')`。
- **最小修法**：地府 POI 的 y 统一取 `UNDER.y`（-260）或明确「POI y = 脚底 +2」并让 `teleport` 对异界不再叠 `+0.5`；`realmAt` / `groundHeight` 统一返回同一常量（建议抽 `UNDER.y` 为唯一真源，禁止 `+2` / `+0.5` 散落）。
- **验收断言**：附身 `teleport('fengdu')` → 读 `player.actor.pos.y` 与向下 `Raycaster` 首个非 InstancedMesh 命中面，断言二者差 `< 0.35m`，且 `player.realmY === -260`（当前 -257.5）。
- **不重复声明**：motion M-09（realmFloor 取 `player.realmY` 而非相机 y）、M-11（异界 realmY 吞跳跃）、M-13（teleport 不重置运动状态）、M-07（两套跨界传送实现）均已报，**均未涉及 POI / groundHeight / PORTALS / teleport 四处对同一地面给出不同数值**。geom / motion 附录的 `HEAVEN_SCALE` × `LINGXIAO_SCALE` 双缩放线索已由 motion 附录登记，**本条不复述**。

---

## 二、对第 1 轮已有结论的「更深后果」补充（**不重复计入 9 条**）

> 纪律要求：发现已有结论在跨系统层面有更深后果时，明确写出但不另立缺陷编号。以下 7 项供主线程修 C01 / C11 / C13 / P-13 / UI-05 时一并收口。

1. **对 core C11（首次写档竞态，标「疑似」）的升级为「确定时序」**：`src/game/interact.ts:86` 的写档条件是 `if (W.__saveSave && sv?.survival && sv.voxelStore)`，其中 `sv = W.__qingming?.world`。C11 只看到「`__saveSave` 由 `open().then()` 异步注入、首次 `save()` 可能不等它」；但 `src/world.ts:838` 读档后的 `I.save()` 发生在 `world.init()` 内，而 `__qingming` 在 `src/main.ts:82`（`await world.init()` 之后）才注入 → **`sv` 必然 `undefined`，启动期这一次 IDB 写 100% 被跳过**，与 `__saveSave` 是否就绪无关。修 C11 时若只 `await saveMgr.open()` 而不提前注入 `__qingming`（或让 `save()` 直接持有 world 引用），启动期写档仍然丢。**建议把 C11 从【疑似】按本时序升级为【确认·时序】。**
2. **对 core C01 的补充（creationCount → HUD 条件节点）**：`ui.ts:180-181` `topCondition({ hasCreation: world.creationCount > 0 })` 与 `conditions.ts:46/50`（c-boss / c-creation 均 `!s.hasCreation`）构成第三条后果链。读档后 `creationCount=0`，与 B-01 的造物丢失叠加 → 「龙没了、100 文没了、HUD 还催再造一条」。C01 只列字段未入档，未点出 HUD 条件节点的复现提示。
3. **对 core C13(3) 的补充（3 个孤立事件已登记，不计缺陷）**：`codex:unlock`（`world.ts:789`）、`karma:ascend`（`karma.ts:45`）、`crowd:density`（`world.ts:1686`）全仓无 `bus.on` —— C13 已判「预留给探针、不构成静默丢事件缺陷」，本队**认同且不复报**。更深一层的可观察后果：`codex:unlock` 无订阅，而 `boss.ts:131` 的 toast 明写「图鉴已收录」、`ui.ts:246-287` 的 `renderCodex()` 只在**打开图鉴 / 切 tab**时读 `world.codexLog` → 玩家击败 Boss 后若不开图鉴，看不到「已了结」条目，文案承诺「即时收录」与 UI 刷新时机不一致（低，属时机问题而非数据丢失）。另 `karma.gain()` 升阶分支（`karma.ts:43-46`）不触发 `interact.save()`，与 C01「karma 未入档」叠加。
4. **对 play §4.2 / core C01 的补充（读档刷 Boss 奖励）**：「读档 → Boss 复活 → 再领 300 文 + 2 蟠桃」的机制已由 play §4.2 与 core C01 放大链 ② 完整复算（单会话靠 `boss.defeated`、跨会话意图靠未入档的 `codexLog`），**本队不重复**。仅补一句跨系统点：`world.ts:786` 的 `codexLog.some` 只包住 `push`，`addPeach(2)/earn(300)/playerWeapon`（`:792-798`）在 `if` 之外，本就依赖 `onDefeat` 单次触发；而 `onDefeat` 的重置来自 `world.ts:778` 每次载入 `new ArenaBoss` —— **装配链**（载入任务）与**存档链**（codexLog 未入档）共同造成，非单纯存档问题。
5. **对 UI-01 的补充（H 隐藏 UI 的漏网 DOM）**：`boss.ts:235` `document.body.appendChild(wrap)` 是唯一在 `#ui` 之外、H 隐藏后仍常驻的玩法 DOM（其余 `fade` / `wishbar` / `hotbar` / `panel` / `poiguide` 全挂 `#ui`，H 能一并隐藏）。UI-01 已报层级与常驻，**不重复**；此处只确认「拍照模式漏网清单」已审全。
6. **对 M-09 的补充（realmFloor 与界域氛围口径）**：`world.ts:1459` `engine.realmFloor = player.realmY ?? 1.7` 用化身界域、而 `world.ts:1471` 的音轨界域与 `world.ts:1213` 的地府雾都用 `camera.position.y` —— 同一帧内「相机夹取」「音轨」「雾色」三套界域判定可指向不同界。M-09 已报前者的 y=1.7 钳位，本队只登记三套口径并存，不另立。
7. **【设计取舍，不计缺陷】`Soundscape` 订阅注册时机**：`src/audio/scape.ts:41-51` 的 11 个 `bus.on` 全在 `start()` 内，而 `start()` 由 `ui.ts:498-500` 的 `kick()` 在**首次 pointerdown / keydown** 才调用；`world.ts:1474` 的 `realm:change` 第一帧就 emit、havoc 的 `sfx:drum/gong/buddha` 在开场运镜期间持续 emit → 静态上确实存在「订阅晚于 emit」。但 WebAudio `AudioContext` 本就需用户手势、未 `start()` 时无声可播，且 `Soundscape.realm`（`scape.ts:163`）默认 `'renjian'` 与首帧 emit 的 `'renjian'` 恰好自洽 → **实际无损失，判为自动播放策略下的设计取舍，不作为缺陷上报**（留档供红队证伪时参考）。

---

## 三、8 类交叉盲区逐类核查表（证明审全，供红队反向抽查）

| # | 盲区类别 | 结论 | 命中条目 / 说明 |
|---|---|---|---|
| 1 | 装配时序：emit 早于订阅 / A 读 B 未赋值 | **命中** | B-01（重演回调）、B-02（`__qingming`）、§二.1（启动期 save）、§二.7（音频订阅，判设计取舍）。另核：`bus.on('player:mode')`（`world.ts:820`）与 `bus.on('quality:change')`（`world.ts:1036`）均在 `world.init()` 末注册，而对应 emit 全在运行期，启动期无「订阅前 emit」；`initUI` 的 10 个 `bus.on` 在 `main.ts:36` 早于所有运行期 emit —— **除音频外无其它装配时序缺陷**，如实说明 |
| 2 | 注入回调空值 / 竞态 | **命中** | B-01、`__saveSave`（§二.1）。另核 `placement`（`main.ts:55`）、`spend/earn`（`main.ts:47-48,54`）、`setDoneQuery`（`world.ts:855`）、`onPeachBanquet`（`world.ts:765`）、`onKnockback`/`onDefeat`（`world.ts:784-800`）、`onFaint`（`world.ts:842`）、`attackHook`（`world.ts:859`）—— 均在「调用方构造之后、首次调用之前」同步注入，且 `havoc.update` / `boss.update` 只在 `engine.start()` 后的主循环触发（晚于 `world.init()`），**无未注入即调用窗口**（`onPeachBanquet` 引用 `this.interact`，但回调体在 `pi===9` 时才执行，届时 interact 已建，安全） |
| 3 | 事件名 / 载荷成对 | **命中** | B-07（`cam:mode` 载荷 `'avatar'`）。全量比对 emit/on：`ui:toast` / `coins:change` / `objective:done`（载荷 `{key,name,...prog}` ↔ `ui.ts:185` 取 `done/total`，成对）/ `realm:change`（`'difu'|'tiangong'|'renjian'` ↔ `scape.ts:180/183` 同串，**成对正确**）/ `sfx:step`（布尔 ↔ `scape.ts:44`）/ `impact:giant` / `fx:firework` / `battle:report` / `hero:focus` / `time:phase` / `cam:mode` / `player:mode` / `quality:change` —— **除 `'avatar'` 外无拼写或参数个数错位**；3 个孤立 emit 见 §二.3（C13 已登记） |
| 4 | 跨系统数值双源 | **命中** | B-02、B-03、B-05、B-06、B-09。另核三币（`interact` 内存 ↔ `coins:change` 载荷 ↔ `renderTri` 全局句柄 ↔ localStorage ↔ IDB）、业力（`karma.current()` ↔ HUD 0.5s 轮询 ↔ `karma:ascend` 无订阅 ↔ 存档写而不读）、`objectiveDone`（内存 ↔ `countLevelDone` 只数 17 键 ↔ 未入档）、`codexLog`（内存 ↔ `renderCodex` ↔ 未入档）—— 根因归 C01/P-13，本队只取交叉面 |
| 5 | 三界坐标 / 缩放换算 | **命中（疑似）** | B-09。`HEAVEN_SCALE=2.2` / `LINGXIAO_SCALE=2.7273` 双缩放与 `heavenPoint()` 只应用 2.2×、PLATFORMS 与 `realm.ts platform()` 半径是否对得上，**已由 geom §四附录 + motion §三附录登记为【疑似需运行时验证】**，本队不重复；只补「地府地面四处三值」这一未覆盖角度。`teleport()` 写 `actor.pos`（`world.ts:1719`）与相机（`world.ts:1723`）**同用 POI 世界坐标 + CAM_OFF 偏移**，二者同套坐标，无分叉（如实说明，不误报） |
| 6 | 暂停 / 切后台 / 长时间挂机 | **命中** | B-04。另核 `dt` 钳 `[0,0.1]`（`engine.ts:888`）、无 `visibilitychange`（全仓 0 处）、`blur` 只 `endDrag`（`engine.ts:808-811`，UI-03 已报）、havoc 每帧最多 +1 幕（`havoc.ts:359-371`）不会补跳 —— 结论「后台 timer 存活 / havoc 冻结」据此成立 |
| 7 | 拍照模式 / 面板 / 隐藏 UI 全局一致性 | **命中** | B-08。DOM 挂载点全量枚举（见 B-08 证据）：仅 `#bossbar`（`boss.ts:235`）与 `engine.ts:603` 启动提示挂 body，其余全在 `#ui`；H / Esc / 面板 / cinema 互斥与可恢复性逐项核过 |
| 8 | 存档与运行时期望闭环 | **命中** | B-01、B-05、B-06 + §二.1/2/3/4。写档字段（`interact.ts:87-94`）：`schemaVersion/economy/entities/voxel/survival/karma`；读档（`world.ts:327-332`）：`economy/voxel/survival`；`karma`/`entities` 写而不读，`codexLog`/`objectiveDone`/`playerWeapon`/`creationCount`/玩家位置/相机位置/**`boss.defeated`**/`survival.fainted` 全未入档（C01/C14 已详列，不重复）。本队新增的是「**写档路径依赖 `__qingming`，而 `__qingming` 注入晚于启动期写档**」（§二.1）与「**重演回调时序使修复 C01 也不自愈**」（B-01） |

---

## 四、误判风险 / 给红队的证伪提示

1. **B-01 最易被误判成「C01 已报」**：C01 只讲「entities 字段写了不读」。即使把 `collectPersistedEntities()` 接上、把 `entities` 读回来，`world.ts:633` 的 `onRebuildCreations` 仍是 `null`（`main.ts:64` 在 `await` 之后）—— 请按 `world.ts:956-963` 的串行循环 + `main.ts:38` / `:64` 的先后复算，二者是**独立**缺陷。
2. **B-02 别用「刷新一下就好了」证伪**：HUD 自愈靠的是玩家第一次经济操作发 `coins:change`，不是靠时间；开场运镜 84s 内玩家不操作就一直是错的。也别用「读档路径 `I.save()` 会发 coins:change」证伪 —— 那次 `renderTri` 因 `__qingming` 未注入仍落空（只有 `ui.ts:118` 用载荷修正了 `coinsEl`，`triEl` 仍空）。
3. **B-03 别用「传送能点亮目标」证伪**：`teleport()` 同步搬了化身（`world.ts:1718-1720`），所以传送有效；缺陷是**自由飞行 / 灵魂模式**时相机与化身分离。对照组必须区分「传送面板」与「WASD 飞过去」。
4. **B-04 别用「dt 钳 0.1s 会补帧」证伪**：`havoc.ts:359-371` 每次 `update` 最多推进一幕并 `return`，回前台首帧只补 0.1s 的 `pt`；`setTimeout` 在后台是「节流不取消」，8.2s 长延时仍触发。两者方向相反才是本条要点。
5. **B-09 是【疑似】**：静态「四处三值」确凿，但「是否肉眼可见悬空」必须运行时量 `player.actor.pos.y` vs 向下 raycast，且 `objectiveReached`（`world.ts:1777`）只用 XZ 距离、不受 y 影响 —— 请勿把本条升级成「目标链卡死」。
6. **§二.7（音频订阅）请勿当缺陷上报**：WebAudio 手势策略 + `Soundscape.realm` 默认 `'renjian'` 恰好自洽，实际无损失，已判设计取舍。
7. 本队**未复跑** tsc / 137 tests / 浏览器探针（纪律：只读、不跑构建）；所有【确认】均为代码可静态复核的时序 / 数据口径事实，【疑似】已给运行时验收断言。

---

## 五、给主线程的修复优先级（按本队结论）

1. **B-01 + C01 一起修**：先补 `collectPersistedEntities()` 写档 + 读档恢复 entities，再把「造物重演」从 `world.init()` 内 task 移到 `main.ts` 的 `await` 之后显式调用（或提前注入回调）。只修一半无效。
2. **B-02 + §二.1 一起修**：把 `__qingming` 注入提前，或让 `initUI` / `interact.save()` 直接持有 `world` 引用，一次性消除「UI 首刷」与「启动期写档」两处同源故障。
3. **B-03**：`world.ts:1479` 的 `playerPos` 改化身位置（或按 mode 分流并写明口径）。
4. **B-04 + C10 + P-07**：延迟结算统一到 sim-time + token 校验 + `visibilitychange` 冻结。
5. **B-05**：`inChain` 判定提前到 `objectiveDone`/`codexLog` 写入之前。
6. **B-06 / B-07 / B-08**：单点低风险，可同批修（均不消耗 draw / tri 预算）。
7. **B-09**：先跑运行时量测再决定是否改坐标常量（涉及 POI 表 / PORTALS / groundHeight 多处，改动面大）。

> 全文 9 条正式缺陷 + 7 项「不重复计入」补充，均给 `file:line`。src 源码未做任何修改；本文件为唯一授权落盘产物。
