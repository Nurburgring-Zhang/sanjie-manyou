# 第 1 轮审核产物 · 角色 / 动作 / 运动 / 物理（motion-expert）

> 基线：`be0226e`（git 干净）。项目根：`D:/kimi/赛博上河-CyberQingming-全量导出-20261024/cyber-qingming/`，下文行号均为相对该根的 `src/...`。
> 范围：角色系统、动画状态机、移动与运动、碰撞与附着、相机跟随、帧率无关性、运动相关确定性。**不**覆盖几何生成、UI 视觉、经济数值、存档（由 geom / ui-perf / play / core 专家负责）。
> 对应台账 `artifacts/VISUAL-AUDIT-20261107.md` §六 的已知边界「动作 / 运动 / 战斗 / 收集 / 升级等动态项只做了按键触发单帧，未做逐帧动作序列审核」——本文件补这一块。
> 纪律：审核期间**只读**，未修改任何文件、未跑构建 / 测试、未落盘脚本。本文件是 team-lead 明确授权的审核产物，**未改动任何 `src` 源码**。
> 用途：交第 2 轮对抗审查逐条证伪。每条给出 `file:line`、函数名、条件表达式、可断言的验收口径；严格区分【确认缺陷】/【疑似需运行时验证】/【设计取舍非缺陷】。

---

## 〇、已核通过（非缺陷，证明审全，供对抗审查反向抽查）

| 项 | 证据 | 判定 |
|---|---|---|
| 动作与位移解耦正确 | `ACTIONS`(`src/actors/actions.ts:39-652`) 全为 `(v,t,p)=>void` 纯函数，只写 `Pose`、不写 `pos`；位移只在 `player.ts` / `physics.ts` / `behaviors.ts` 积分 | 非缺陷 |
| 动作时间线能复位 | `Crowd.update` `src/actors/crowd.ts:2043-2044`：`if (a.action !== a.lastAction) { a.lastAction=a.action; a.actionT=0; } a.actionT += dt` | 非缺陷 |
| 击飞弹道帧率无关 | `ImpactSystem.update` `src/game/physics.ts:250-261`：`FIXED_DT=1/120`(:61) + `MAX_SUBSTEPS=16`(:63) 固定步累加器，余量留到下一帧 | 非缺陷 |
| 引擎帧长有界、防负 dt | `Engine.start` `src/core/engine.ts:888`：`const dt = Math.min(0.1, Math.max(0, (now - this.last)/1000))` | 非缺陷（就 dt 而言） |
| 俯仰角双处 clamp | `PITCH_LIMIT=85°`(`src/core/engine.ts:21`)；`Engine.dragLook`(:872) 与 `PlayerController.avatarLookDrag`(`src/game/player.ts:211`) 均 `THREE.MathUtils.clamp(..., -PITCH_LIMIT, PITCH_LIMIT)` | 非缺陷 |
| 一次单击只触发一个消费点 | `PointerInputRouter` `src/core/engine.ts:469-523`（优先级 + 消费标记） | 非缺陷 |
| 行为层默认随机源已确定性化 | `LEGACY_RNG` 全仓**两份独立定义**（`src/actors/behaviors.ts:34-43` 与 `src/actors/crowd.ts:40-49`，同种子 `0x5e7a1`、各模块各一份闭包互不相干）：均由 `Math.random` 引用改为固定种子 mulberry32。风险不在「全仓共用一个流」，而在「单个 `Crowd` 实例把它那份 rng 经 `ctx.rng` 喂给该实例全部 actor」的实例内共享 / 调用顺序耦合 / 跨会话不重置 | 非缺陷（但见 M-14 对生产注入的修订） |
| Boss 状态机用 dt、无 Math.random | `ArenaBoss.update` `src/game/boss.ts:153-216` 全用 `timer -= dt` / `cd -= dt`；`DEFAULT_RNG` `new RNG(0x5e7a1)`(:26-29) | 非缺陷 |
| 状态互斥主干成立 | `PlayerController.update`：`state==='boat'`(:297) 与 `state==='mount'`(:317) 分支各自 `return`；`swim/foot` 由 `swimming`(:375) 二选一；`dismount()`(:462-479) 回 `'foot'`。常规路径未见两个互斥态同时成立 | 非缺陷 |

---

## 一、结论（14 条，按严重度降序）

> 三类标记：**【确认缺陷】** = 代码事实可静态复核；**【疑似需运行时验证】** = 逻辑确定但现象 / 是否属预期需浏览器或逐帧数据；**【设计取舍非缺陷】** = 有意为之、不计缺陷。
> 本版在交叉核对后对 M-14 作了一次定性修订（见 M-14 条目与 §二），编号不变，仍为 14 条：**确认缺陷 11 条 + 疑似需运行时验证 3 条 + 设计取舍非缺陷 0 条编号**（「设计取舍 / 非缺陷」的正确实例集中列在 §〇，三类仍严格区分）。另 M-06 的「是否穿进具体建筑」子项与 §三 附录 PLATFORMS 线索也标【疑似需运行时验证】，但**不占 14 条编号**。

---

### M-01 【确认缺陷】玩家水平移动完全未接入碰撞系统（穿墙 / 穿建筑）

- **现象**：`PlayerController.update` 的 `foot` 位移只做 `clamp(p.x, -20000, 20000)` / `clamp(p.z, -20000, 20000)`，不查询任何 collider。NPC 侧 `behaviors.walkSurfaceY`(`src/actors/behaviors.ts:1003-1023`) 有墙带阻挡，玩家没有。`ColliderRegistry.blocked()`(`src/rt/collider.ts:186`)、`GroundLayers.groundAt()`(`src/rt/ground.ts:62`)、`FixedStepLoop`(`src/rt/loop.ts:15`) 在 `src` 全仓**只有定义与单测，无任何运行时实例化 / 调用**；`src/rt/ground.ts:12`、`src/rt/loop.ts:7` 注释自认「本文件不接线 player/behaviors，接线是行为变化，须 P0-2 / P0-5b 独立切片」；`tests/ground.test.ts:5` 标题即「零接线切片」，而 `tests/collider.test.ts:117` 却名为「生成物挡住玩家·端到端」——测试验的是各自 `new` 出来的实例，产品路径不成立（假绿风险）。
- **几何侧交叉确认（geom-expert 提供）**：`src/city/bake.ts` 的 `Baker.push`(L771) / `Buf`(L506) / `flush` / `SignMesher`(L1570) / `buildCurvedUnit`(L273) 均无 `ColliderRegistry` / OBB / 物理体注册，文件头 L3 自述「整座静态城市合并为 7 个 draw call」；`roofPieces`(L899)/`groundTrace`(L851)/`glowTrace`(L913) 是审计台账而非碰撞体，且 `Baker` 不产出 `userData` 物理标记。→ **几何 + 玩法两侧都未接线，闭环成立**。
- **代码根因 / 函数名**：`PlayerController.update` `src/game/player.ts:395-404`；`PlayerController.groundHeight` `src/game/player.ts:235-267`（只解析高度、不做 XZ 阻挡）；`ColliderRegistry.blocked` `src/rt/collider.ts:186-197`；`GroundLayers.groundAt` `src/rt/ground.ts:62-81`；`FixedStepLoop.frame` `src/rt/loop.ts:44-55`；`src/rt/ground.ts:12`；`src/rt/loop.ts:7`。
- **触发条件（表达式）**：`mode==='avatar' && state==='foot' && !busy && (k.has('KeyW')||k.has('KeyS')||k.has('KeyA')||k.has('KeyD')||touchMove!==0)`，且目标 `(p.x,p.z)` 与任一建筑 / 铺面几何相交。
- **最小修法**：`foot` 位移后调用 `blocked(p.x, p.z, r)` 做回退 / 单轴滑动，或把 `walkSurfaceY` 复用到玩家；并把 `attachEntity` / `attachGroundBox` 接进主循环（否则 registry 恒空）。
- **是否影响 determinism**：否。
- **验收断言**：注册一个 `{kind:'box',params:{hx:3,hz:3}}` collider 后朝它走，断言单帧 `|Δpos|` 被阻挡（不穿过）；或 grep 断言 `src/game` 下存在 `blocked(` 调用点（当前 0）。

---

### M-02 【确认缺陷】`usePortal` 无防重入，淡入 460ms 内每帧重复触发传送

- **现象**：`PlayerController.update` 末尾的 `PORTALS` 循环**每帧执行且不判 `busy`**；`usePortal` 每帧注册一个 `window.setTimeout(..., 460)`、刷 `busyUntil = clock()+1000`、写 fade opacity。`busy` 使 `ix=iz=0`（:286-294）→ 位置不动 → 触发条件持续成立，60fps 下 0.46s 内叠加约 27 个定时器，重复 `bus.emit('ui:toast')`、反复改 opacity，且 `busyUntil` 被不断推后。
- **代码根因 / 函数名**：`PlayerController.update` `src/game/player.ts:426-429`（PORTALS 循环在 `foot` 分支末尾，不受 :284 `busy` 约束）；`PlayerController.usePortal` `src/game/player.ts:445-459`（无 `portalPending` 标志、不保存 / `clearTimeout` 句柄）；`PlayerController.landAt` `:133-138`；`PORTALS` 表 `:499-502`。
- **触发条件（表达式）**：`Math.hypot(p.x-pt.x, p.z-pt.z) < 2.6 && Math.abs(p.y-pt.y) < 4`，`pt = {x:470,y:0,z:24}` 或 `{x:0,y:-260,z:-124}`；且 `this.fadeEl !== null`（走 setTimeout 分支）、460ms 内 `landAt` 尚未执行。
- **最小修法**：加 `private portalPending=false`，进入即置位、`landAt` 后清除；PORTALS 检查加 `&& !this.portalPending && !busy`；保存 timeout 句柄并在打断时 `clearTimeout`。
- **是否影响 determinism**：**是**（setTimeout / 墙钟，回放与时间缩放下触发次数与时机都不同）。
- **验收断言**：单次过界断言 `ui:toast` 计数 `=== 1`、setTimeout 注册数 `=== 1`、`busyUntil` 只被写 1 次；当前 ≈27 次。

---

### M-03 【确认缺陷】坐骑运行时运动状态用未播种 `Math.random`，破坏确定性

- **现象**：9 匹坐骑的 `yaw`（朝向）与 `phase`（步态 / 振翅相位）由 `Math.random()` 生成，是**每帧可见的运行时运动状态**（非贴图烘焙）；同 seed 两次加载结果不同。
- **代码根因 / 函数名**：`MountSystem.mk` `src/city/mounts.ts:40-41`：`{ ..., yaw: Math.random()*6.28, phase: Math.random()*9, ... }`；`MountSystem.spawnAll` `:47-63` 调用 9 次；构造点 `World` 装配 `src/world.ts:811`。
- **补充事实**：全仓其余 `Math.random` 均在贴图 / 音效 / VFX / 几何烘焙（`src/city/bake.ts`、`src/audio/scape.ts`、`src/fx/vfx.ts`、`src/city/pavement.ts`、`src/world/terrain.ts` 的 canvas 段、`src/actors/heroes.ts:181-182` 烟花），**本条是唯一落在运动状态机里的**。
- **触发条件（表达式）**：每次 `new MountSystem(...)` 构造期（`spawnAll()` 内 9 次 `mk()` 调用）。
- **最小修法**：构造注入 `Random`（同 behaviors / crowd / boss 规矩），默认 `new RNG(0x5e7a1)`；`mk()` 改用注入 rng。
- **是否影响 determinism**：**是**（直接命中「运动相关的确定性」核查点）。
- **验收断言**：两次刷新断言 `mounts.rideables.map(m => [m.yaw, m.phase])` 完全一致；当前不一致。或 grep 断言 `src/city/mounts.ts` 无 `Math.random(`。

---

### M-04 【确认缺陷】孟婆茶「失向」机制整体未接线（死代码），数据层却声明了威胁

- **现象**：`applyDisorient`、`disorient`、`fadeHint`、`disorientJitter` 全 `src` **无任何调用 / 消费点**（仅定义与 getter）。`src/data/levelPlan.ts:57` 声明 `threatSpec:{kind:'disorient',radius:12,speedScale:0.6,strength:1,duration:6}`，而该文件 `:8` 自写「机读威胁类型：必须对应世界里真实存在的机制，没接线的节点不要写 threatSpec」。世界层只接了望乡台 `slow` 一条（`src/world.ts:1460-1467`）。**另**：即便接线也会失效——`src/world.ts:1466` 每帧**无条件** `this.player.speedScale = near ? 0.55 : 1;` 会在下一帧覆盖掉 `applyDisorient` 写的 `0.6`（`src/game/player.ts:113` 注释只做了单向规避，未消解冲突）。
- **交叉确认**：与 play-expert 的 P-09 为同一事实，定性一致【确认缺陷】，以本条为准，不重复计数。
- **代码根因 / 函数名**：`PlayerController.applyDisorient` `src/game/player.ts:115-121`；`PlayerController.disorientJitter`(getter) `:105-106`；字段 `:53-56`；`PlayerController.effectiveSpeed` `:100-102`；`World.update` `src/world.ts:1462-1467`；`src/data/levelPlan.ts:8,57`。
- **触发条件（表达式）**：进入 `POIS['mengpo']` 半径 12m 或调用 `applyDisorient(k>0)`；实际 `grep -n 'applyDisorient(' src/` 仅命中定义行。
- **最小修法**：威胁 tick 里调 `applyDisorient(strength)` 并按 `duration=6` 做衰减；`disorientJitter` 叠加到 `camYaw`、`fadeHint` 交 UI 灰化；**`speedScale` 改叠加式 `slowScale * disorientScale`**，不要每帧无条件覆写。
- **是否影响 determinism**：否（但若按墙钟做 duration 衰减会引入，见 M-14）。
- **验收断言**：grep 断言存在 `applyDisorient(` 调用点（当前 0）；浏览器断言饮茶后 `player.disorient>0` 且 `player.effectiveSpeed(false) < 3.6`；并断言一帧后 `speedScale` 不被 `World.update` 覆写回 1。

---

### M-05 【确认缺陷】交互动作 `act()` 用不可取消的 `window.setTimeout`，动作打断 / 重复触发有残留回调

- **现象**：`InteractSystem.act` 每次都 `new` 一个 setTimeout 恢复 `'stand'`，不保存句柄、不取消上一个。面板按钮是 DOM `onclick`（`src/game/interact.ts:133,148,196,197,286`），**不走** `PlayerController.tryInteract` 的 busy 检查（`src/game/player.ts:218-223`），可连点叠加。若两次 `act` 同名动作（如连续两次 `'dice'`），第一个定时器到期时 `this.player.actor.action === action` 成立，会把第二次动作**提前**清成 `stand`；`busyUntil` 被延长但定时器未延长，二者失配。setTimeout 用真实墙钟且无法注入，与 `engine.t`（仿真时间）不同源。
- **代码根因 / 函数名**：`InteractSystem.act` `src/game/interact.ts:101-107`；`PlayerController.tryInteract` `src/game/player.ts:218-223`；`busyUntil`/`clock` `src/game/player.ts:63,68`。
- **触发条件（表达式）**：`act(action, seconds, say)` 被调用 ≥2 次且动作名相同，或新动作打断旧动作；到期时条件 `this.player.actor.action === action`（:105 的守卫）成立。
- **最小修法**：保存 `private actTimer`，每次 `act` 先 `clearTimeout`；动作恢复改由逐帧检查 `clock() >= busyUntil` 驱动，不挂定时器。
- **是否影响 determinism**：**是**（暂停 / 切后台 / 时间缩放 / 回放下动作时长漂移，且触发次数不确定）。
- **验收断言**：连续两次 `act('dice', 2, ...)`，在注入时钟 t=2.0s 断言 `player.actor.action !== 'stand'`（第二次 `busyUntil` 到 4.0s）；当前被第一个定时器提前清成 `stand`。

---

### M-06 【确认缺陷】第三人称相机无遮挡检测；俯仰角接近上限时相机钻入地面

- **现象**：`PlayerController.followCam` 直接把 `camera.position.lerp` 到 `focus + off + (0,2.2,0)`，全工程相机路径无 `Raycaster` / 地面下限。当 `camPitch → +PITCH_LIMIT(85°)`，`off.y = -sin(pitch)*camDist ≈ -7.47`（`camDist=7.5`）→ 相机 `y ≈ focus.y − 5.27`；`focus` 是玩家**脚底**（人间 y≈0）→ 相机 y≈−5.27，穿到地面以下。`avatarLookDrag` 只 clamp pitch 到 ±85°，不约束相机高度。
- **代码根因 / 函数名**：`PlayerController.followCam` `src/game/player.ts:435-443`；`PlayerController.avatarLookDrag` `:208-212`（:211 的 `clamp`）；`PITCH_LIMIT` `src/core/engine.ts:21`；`Engine.dragLook` `:864-873`（:872 clamp）；`Engine.updateCamera` `:950-1004`。
- **触发条件（表达式）**：`camPitch > Math.asin(2.2 / camDist) ≈ 17°`（人间即会低于地面，camDist 默认 7.5；wheel 可调 2.5–16，:203）；或相机↔焦点连线与建筑 / 坡面几何相交（任意 camDist）。
- **最小修法**：对 `target.y` 做 `Math.max(groundHeight(cam.x,cam.z)+0.5, ...)`；加相机→焦点遮挡 raycast 收缩 `camDist`。落地时应复用 `src/core/engine.ts:446-449` 的 CAM_TMP 模块级临时量，避免与 ui-perf-expert 登记的 GC 削减项对冲。
- **是否影响 determinism**：否。
- **验收断言**：附身态把 pitch 拖到 +80°，断言 `engine.camera.position.y >= player.groundHeight(camera.x, camera.z, camera.y)`；当前 < 0。**「是否穿进具体建筑 / 坡面」需运行时机位截图**（见 §四），几何侧（geom-expert）亦标【需运行时验证】。

---

### M-07 【确认缺陷】跨界传送存在两套并存实现，语义不一致且触发点重叠

- **现象**：① `PlayerController.update` 每帧按 `PORTALS` 表自动触发 `usePortal`（带渐隐 460ms、`busyUntil+1000`、`landAt` 重算 `realmY/vy/lastX/Y/Z`）；② `World.registerInteractions` 的 E 键交互点直接 `actor.pos.set(...)`，无渐隐、无 busy、无 `realmY`/`vy` 重置。两者人间触发点同为 `(470,0,24)`、落点同为 `(0,-260,-130)`（`UNDER.y=-260`，`src/sky/underworld.ts:10`，与 `src/game/player.ts:499-502` 一致），但半径 2.6 vs 5。玩家进入 2.6m 内自动传送先发生，E 键路径同时可触发，状态迁移来源不唯一。
- **代码根因 / 函数名**：`PlayerController.update` `src/game/player.ts:426-429`；`PlayerController.usePortal` `:445-459`；`PlayerController.landAt` `:133-138`；`PORTALS` `:499-502`；`World.registerInteractions` `src/world.ts:1663-1670`。
- **触发条件（表达式）**：`mode==='avatar' && (state==='foot'||state==='swim') && Math.hypot(p.x-470, p.z-24) < 5`（E 键路径，`InteractSystem.update` `src/game/interact.ts:302-318`）；自动路径 `< 2.6`。
- **最小修法**：删除 E 键那套，统一走 `usePortal`（或删自动检测只留交互点），并让所有跨界写位置都经 `landAt`。
- **是否影响 determinism**：否（但 M-02 的重复触发会放大）。
- **验收断言**：grep 断言跨界写 `actor.pos` 的路径只有 1 条（当前 2 条）；浏览器断言单次过界只发生一次 `realmY` 重算。
- **同类旁证（不单列）**：play-expert P-12 指出 `boss.playerAttack()`(`src/game/boss.ts:107-138`) 不检查 `player.mode`，而 `PlayerController.tryAttack`(`src/game/player.ts:224-226`) 要求 `mode==='avatar' && state==='foot'` → 同为「同一动作多套入口、状态门不一致」。

---

### M-08 【确认缺陷】玩家船相位用「按帧固定步长」推进，且与 dt 推进叠加，帧率相关

- **现象**：`UnitSystems.updatePlayerBoat` 里 `b.phase += 2*0.016` 固定每帧 0.032rad，**不读 dt**；而 `player.boat` 与 `units.playerBoat` 是**同一对象**（`src/world.ts:1656` `this.player.boat = this.units.playerBoat`），`PlayerController.update` 的 `boat` 分支又按 dt 推进 `b.phase += dt*(2 + b.throttle*6)`（`src/game/player.ts:308`）。于是相位速度 = `dt*(2+throttle*6) + 0.032/帧`，60fps 与 30fps 的桨频 / 起伏明显不同；且 `updatePlayerBoat` 不判断 `driven`，无人船上桨也照划。
- **代码根因 / 函数名**：`UnitSystems.updatePlayerBoat` `src/city/units.ts:558-584`（:567 `b.phase += 2*0.016`）；`PlayerController.update` `src/game/player.ts:297-315`（:308）；`World.update` `src/world.ts:1455`；`World.registerInteractions` `:1655-1661`（:1656 同引用赋值）。
- **触发条件（表达式）**：`units.updatePlayerBoat()` 每帧无条件调用；任意帧率变化（30/60fps A/B）或 `playerBoat.driven === false`。
- **最小修法**：`updatePlayerBoat(dt)` 改 `b.phase += dt*2`，或删 units 侧推进只保留 player 侧；`driven===false` 时跳过相位推进。
- **是否影响 determinism**：**是**（同墙钟时长、不同帧数 → 相位不同）。
- **验收断言**：同 1s 时长分别以 `dt=1/60 × 60` 与 `dt=1/30 × 30` 推进，断言末帧 `phase` 差 `< ε`；当前差 `0.032×30 = 0.96 rad`。

---

### M-09 【确认缺陷】`walk` 相机模式把 y 硬钳 1.7，且 `realmFloor` 取自「玩家化身界域」而非「相机界域」

- **现象**：HUD「视角」按钮 fly→walk（`src/ui/ui.ts:134`）触发 `Engine.setCamMode('walk')`，`src/core/engine.ts:731` 无条件 `p.y = 1.7`，相机从地府 / 天宫瞬移回人间。`Engine.realmFloor` 由 `World.update` `src/world.ts:1459` 用 `player.realmY`（**化身脚底**界域）写入；soul 模式化身不动、`realmY` 常为 null → `realmFloor` 恒 1.7，于是灵魂飞到地府后切 walk、一按方向键（`Engine.updateCamera` `src/core/engine.ts:991` `this.camera.position.y = this.realmFloor`）相机被钉在 1.7。`src/core/engine.ts:540-543` 注释声称已修「地府里一按方向键相机被夹到 y=1.7」，但只改了 `updateCamera`，`setCamMode` 与 `realmFloor` 取值来源未同步。
- **代码根因 / 函数名**：`Engine.setCamMode` `src/core/engine.ts:727-740`（:729-733 `if (m==='walk'){ ... p.y=1.7; }`）；`Engine.updateCamera` `:950-1004`（:991 walk、:997 fly 的 `Math.min(this.realmFloor,-320)` clamp）；`World.update` `src/world.ts:1459`；`Ui` 视角按钮 `src/ui/ui.ts:132-136`。
- **触发条件（表达式）**：`engine.camMode==='fly' && Math.abs(camera.position.y - 1.7) > 100` 时点击「视角」；或 `camMode==='walk' && mv.lengthSq()>0 && engine.realmFloor===1.7` 且相机本应在异界。
- **最小修法**：`setCamMode('walk')` 改用 `realmFloor`；`realmFloor` 改按**相机 y** 判界域（`cy < -100 ? -260 : cy > 120+HEAVEN_LIFT ? 天宫台面 : 1.7`，与 `src/world.ts:1471` 同源）。
- **是否影响 determinism**：否。
- **验收断言**：相机置于 `y=-250` → 点击「视角」切 walk → 断言 `camera.position.y < -100`；当前 `= 1.7`。

---

### M-10 【确认缺陷】`npcSweep` 按帧数节流，碰撞检测频率随帧率变化

- **现象**：`World.update` 里 `if (this._frame % 3 === 0)`（`src/world.ts:1500`）每 3 帧跑一次车撞 NPC 检测；60fps = 20 次/秒，10fps ≈ 3.3 次/秒，低帧率下高速车辆更易漏检。属「依赖帧数的累加」而非按仿真时间。
- **代码根因 / 函数名**：`World.update` `src/world.ts:1496-1510`（:1500）；`ImpactSystem.npcSweep` `src/game/physics.ts:201-227`。
- **触发条件（表达式）**：`this._frame % 3 === 0`；帧率 `f<60` 时每秒调用次数 `= f/3`。
- **最小修法**：`sweepAcc += dt; if (sweepAcc >= 0.05) { npcSweep(...); sweepAcc -= 0.05; }`。
- **是否影响 determinism**：**是**（同 dt 序列、不同帧数 → 检测次数不同）。
- **验收断言**：同 1s 仿真时间，60 帧与 10 帧两种步进断言 `npcSweep` 调用次数一致；当前 20 vs 3。

---

### M-11 【疑似需运行时验证】异界 `realmY` 硬钳把跳跃立即吞掉；`PlayerState` 无 jump/fall/fly 独立态

- **现象**：`PlayerState = 'foot'|'swim'|'mount'|'boat'`（`src/game/player.ts:14`），walk/run/jump/fall 靠 `actor.action` 字符串 + `vy` 表达，fly 靠 `state==='mount' && mounted.flying`。异界 `foot` 分支 `if (this.realmY !== null) { p.y = this.realmY; this.vy = 0; }`（:407-408）在起跳（:417 `this.vy = 7.5; p.y += 0.05`）的**下一帧**立即把 `p.y` 钉回平面、`vy` 清零 → 天宫 / 地府按 Space 只有一帧 0.05m 抖动，跳不起来。代码逻辑确定，但「异界是否本就不该跳」属产品取舍，故列为疑似。
- **代码根因 / 函数名**：`PlayerController.update` `src/game/player.ts:14, 128-130, 406-417`；`PlayerController.realmAt` `:128-130`；`PlayerController.jump` `:229-232`。
- **触发条件（表达式）**：`realmY !== null`（`landingY > 120 || landingY < -120`）且 `(k.has('Space') || wantJump) && p.y <= groundY + 0.05 && !busy`（:417）。
- **最小修法**：异界用相对偏移 `p.y = realmY + jumpOff` 积分 `vy`；或明确禁用跳跃并清 `jumpQueued`。
- **是否影响 determinism**：否。
- **验收断言**：地府附身按 Space 逐帧采样 `p.y`，断言峰值 `> realmY + 0.3`；当前恒 `= realmY`。

---

### M-12 【疑似需运行时验证】游泳上岸把 p.z 硬设 ±29、p.y 从水面瞬移到地面

- **现象**：`if (this.state === 'swim') { const bank = p.z >= 0 ? 1 : -1; p.z = bank * 29; this.state = 'foot'; }`（:390-393）无视玩家 x；随后 `foot` 分支（:410-414）把 swim 时钉的 `p.y = surface - 0.75`（:387，城内河 `surface=-1.05` → `p.y=-1.8`）通过 `p.y = target`（0）瞬间拉到 0，单帧 `Δy≈1.8m`、`Δz` 可跳变。
- **代码根因 / 函数名**：`PlayerController.update` `src/game/player.ts:372-375`（`swimming` 判定）、`:387`、`:390-393`、`:410-414`。
- **触发条件（表达式）**：`swimming === false && this.state === 'swim'`；`swimming` 由 `inCityRiver && gh===0 && p.y<0.5`（或 `terrainWater!==null && ghTerrain < terrainWater-1.1`）为真转假，即游出 `|p.z| < 27` 或离开水域。
- **最小修法**：上岸只把 `p.z` clamp 到最近岸线并按 x 找干地；`p.y` 用台阶 / 插值抬升而非硬赋。
- **是否影响 determinism**：否。
- **验收断言**：从河心游到 `z=27` 逐帧采样，断言单帧 `|Δp.z| < 1 && |Δp.y| < 0.2`；当前 `p.z → 29`、`p.y` 跳 1.8。

---

### M-13 【疑似需运行时验证】`teleport` 不重置玩家运动状态，avatar 非 foot 态与坐骑 / 船分支冲突

- **现象**：`World.teleport`（`src/world.ts:1711-1736`）直接改 `player.actor.pos`（:1718-1720）并 `engine.setCamMode('fly')`（:1725），但不改 `state` / `mounted` / `boat` / `vy` / `busyUntil` / `realmY`；soul 模式 `PlayerController.update` 早退（:270-275）不跑 `syncExternalMove`（:146-153），`realmY` 保持旧值。若在 `state==='mount'|'boat'` 时 teleport，`PlayerController.update` 仍走对应分支（:297 / :317）用坐骑 / 船覆盖 `actor.pos`、`followCam` 覆盖相机，与 `setCamMode('fly')` 打架。
- **代码根因 / 函数名**：`World.teleport` `src/world.ts:1711-1736`；`World.respawnPlayerAt` `:1806-1811`；`PlayerController.update` `src/game/player.ts:270-275`；`PlayerController.syncExternalMove` `:146-153`；`PlayerController.followCam` `:435-443`。
- **触发条件（表达式）**：`teleport(key)` 且 `player.state !== 'foot'`（探针 / HUD 传送）；或 `mode==='soul'` 时 teleport 到异界后 `toggleMode()` 切 avatar。
- **最小修法**：teleport 改走 `player.landAt(...)` 或加 `resetMotionState()` 清 `state/mounted/boat/vy`，并统一 camMode。
- **是否影响 determinism**：否。
- **验收断言**：`avatar + mount` 态 `teleport('fengdu')`，断言 1 帧后 `player.state === 'foot'` 且相机不被拉回坐骑；当前 `state` 保持 `mount`。

---

### M-14 【确认缺陷】（原判【设计取舍非缺陷】，交叉核对后修订）确定性验证门与生产路径不一致（假绿）

- **修订说明**：我原先把「注入式时钟」整体判为设计取舍，这个判断对**机制本身**仍成立（`src/game/physics.ts:74-77`、`src/actors/crowd.ts:51-54`、`src/game/player.ts:65-68` 都明确声明「默认只服务单机旧路径，联机 / 回放 / 无头测试必须注入与仿真步同步的时钟」）。但 core-expert 提供了一个**独立的、可复核**的缺陷角度，我逐行核对后成立，故改判。
- **现象**：`scripts/probe-sim-determinism.mjs:263-278` 验证 `impactUntil` 与固定步弹道时，**每个 `new ImpactSystem` 都显式注入时钟** `() => 1000`(:264) / `() => 5000`(:267) / `() => 0`(:278)；而生产路径 `src/world.ts:858` 是 `new ImpactSystem(this.crowd, this.vfx)`，**不注入 clock** → 落到 `src/game/physics.ts:29` `hostClock = () => performance.now()`。`src/world.ts:345` `new Crowd(scene, buildNav())` 同样不注入 rng/clock → `src/actors/crowd.ts:56-57` `hostClock`（墙钟）+ `:40-49` `LEGACY_RNG`（固定种子 mulberry32 的确定性流，非墙钟、非 Math.random）；**精确口径（core-expert 校正）**：全仓是 `behaviors.ts:34-43` 与 `crowd.ts:40-49` **两份独立定义**（同种子、各模块各一份闭包互不相干），风险在「**单个 `Crowd` 实例**把它那份 rng 经 `ctx.rng`(`crowd.ts:1604-1605`) 喂给该实例全部 actor」的实例内共享 / 调用顺序耦合 / 跨会话不重置，而非全仓共用一个流；`src/game/player.ts:68` `clock = legacyClock` 同为墙钟。即：**门在验证一个生产里根本不存在的配置，生产默认路径的确定性从未被门覆盖**。
- **加重证据（连注入 clock 都救不了，已并入 core-expert 的 C06，不另立编号）**：`src/world.ts:444` 与 `src/world.ts:486` 的 `a.attach` 回调**直接**写 `const tt = performance.now()/1000*2.0 + phase`（桥面行人）/ `*1.15 + phase`（城墙守卒），并据此算 `out.pos.set(...)`（`src/world.ts:448` / `:491-495`）。链路可复核：`Crowd` 构造 `src/actors/crowd.ts:1159` 的注入 `clock` 只进 `ctx.clock`(`:1604-1605`，注释明说「clock 只在 ctx.t 缺失时才会被 behaviors 取用」) 与 `:2040` 的 `now = this.clock()` → `:2052` 的 `impactUntil` 判定；而 `:2053` `if (a.attach) a.attach({ pos: a.pos, yaw: a.yaw, y: a.yOff })` **把 actor 位置引用直接交给闭包**，闭包内直连全局 `performance.now()` → **注入 clock 确实救不了这两组 NPC**。这是「位置（运动状态）本身由墙钟算出」，不是「到期判定」，且绕过 dt：`Engine.renderOnce(dt)`(`src/core/engine.ts:904`) 固定步回放完全不可复现；切后台回来 `tt` 跳变会让它们瞬移。core-expert 已据此把 C06 最小修法改成两条并列（注入时钟覆盖 physics/player 一半 + **单独把 attach 改用仿真 t**）。
- **代码根因 / 函数名**：`World` 装配 `src/world.ts:345, 444, 486, 858`；`ImpactSystem`（构造 / `apply` / `launch` / `step`）`src/game/physics.ts:29, 74-77, 101-128, 250-292`；`Crowd` `src/actors/crowd.ts:40-49, 56-57`；`PlayerController` `src/game/player.ts:63, 68`；`Engine.renderOnce` `src/core/engine.ts:904-907`；门 `scripts/probe-sim-determinism.mjs:263-278`。
- **触发条件（表达式）**：跑确定性门 / 无头回放 / 暂停切后台回来；且生产构造 `new ImpactSystem(crowd, vfx)` 未传第 3 参 `clock`。
- **最小修法**：二选一 —— (a) 生产构造统一注入与 `engine.t` 同步的 clock，并冻结暂停期间的推进；把 `a.attach` 改为读仿真 `t` 而非 `performance.now()`；(b) 门里补一条「用**不注入**的默认构造跑两次同 dt 序列、断言 `impactUntil`/`pos`/`action` 逐值一致」的断言（当前必失败）。
- **是否影响 determinism**：**是**（且是假绿，比普通不确定性更严重）。
- **验收断言**：`probe-sim-determinism.mjs` 增加 (b) 断言；或 grep 断言 `new ImpactSystem(` / `new Crowd(` 在生产路径均带 clock 实参（当前 0/2）；并断言 `src/world.ts` 内无 `performance.now()` 出现在 `attach` 回调中（当前 2 处）。
- **可观察后果（需 A/B 确认是否可见，不单独计缺陷）**：`busyUntil`(:63)、`impactUntil`/`launch.until`/`bumpCd`/`respawn.at`（physics.ts:104,124,127,139）都是 `performance.now` 绝对毫秒，而 `engine.t` 是 dt 累加且 dt clamp 0.1s（engine.ts:888）。切后台 5s 回来，墙钟已过而 dt 只推进 0.1s → 击飞弹道 / 硬直 / 动作锁瞬时过期。
- **【设计取舍非缺陷】明确排除项（避免第 2 轮误伤）**：`Crowd.surfaceBench` `src/actors/crowd.ts:1225-1243` 用 `hostClock()` 计时，但 `:1227-1228` 注释明示「量的是**真实耗时**……注入时钟是仿真刻度（回放时会停在 0 或大步跳），拿它计时只会得到 0ms 或负值。本项不参与 sim 状态」→ 不纳入 M-14，属有意的测量用途取舍。

---

## 二、交叉核对记录（三位队友提示的处理，避免第 2 轮重复计数）

| 来源 | 内容 | 处理 |
|---|---|---|
| core-expert | 生产路径未注入 clock/rng；门测注入路径，与生产不一致 | 采纳，M-14 改判为【确认缺陷】；加重证据 `world.ts:444/486` attach 直调 `performance.now()` 已由其并入 **C06**（编号不变）；并按其校正把 `LEGACY_RNG` 定性精确为「两份独立定义 + 单 Crowd 实例内共享」，另把 `surfaceBench`(crowd.ts:1225-1243) 明确排除为设计取舍 |
| play-expert P-09 | `applyDisorient` 无调用、`slow` 已接线 | 与 **M-04 完全重合**，定性一致，以 M-04 为准，不重复计数 |
| play-expert P-12 | KeyJ 无 repeat 保护、`boss.playerAttack` 不检查 `player.mode` | 属玩法 / 输入层，不重复出条；作为 **M-07** 的同类旁证引用 |
| ui-perf-expert | `followCam` 每帧 4×`new THREE.Vector3` + 2×`clone()`（≈6 临时对象/帧，仅附身模式，boat 分支再多 1 个） | 核对 `src/game/player.ts:437-442` 属实，不重复出条，认同【疑似需运行时验证】；运动侧衔接：M-06 若加 raycast 应复用 `engine.ts:446-449` CAM_TMP，避免与 GC 削减项对冲 |
| ui-perf-expert | `src/game/player.ts:182-189`（:185 `if (ev.repeat) return` 保护 V/E/F） | 已核；ui-perf-expert 已**主动删除**其初版 UI-07「V 键无 repeat 保护」误报（照抄旧版 `D10 §1.1`，`be0226e` 已修），UI-07 核心「8 处 keydown 无单一归口」不受影响。M-05 只涉及 DOM `onclick` 绕过 `tryInteract` 的 busy 检查，与 repeat 过滤不冲突、不重复 |
| geom-expert | 几何层无 collider 注册，支持 M-01「零接线」 | 采纳，已写入 M-01 的「几何侧交叉确认」，闭环成立 |

---

## 三、附录：几何侧交叉线索（**不计入 14 条编号**，标【疑似需运行时验证】）

> 由 geom-expert 提供线索，我按运动 / 坐标口径核对。**静态可确认的是「两套缩放口径分叉」，但「是否造成站位判定圈与实体台基不匹配」需运行时量测，故不拍成确认缺陷，也不占 14 条编号。**

- **确定的事实**：
  1. `heavenPoint(x,y,z)` `src/sky/heavenFrame.ts:27-29` 只做 `x*HEAVEN_SCALE(2.2)` / `z*2.2` / `heavenY(y)`，**不含** `LINGXIAO_SCALE = 2.7273`(:38)。
  2. `PLATFORMS` 换算 `src/game/player.ts:491-494` 只对 `p.r *= HEAVEN_SCALE`(:493) → 第 3 个平台 `{x:0,y:214,z:95,r:46}` 换算后为 `(0, 2170.6, 209, r=101.2)`。
  3. `enlargeLingxiao` `src/sky/expansion.ts:343-368` 对 `city_*` 网格**逐顶点**：`y >= LINGXIAO_Y_MIN(=230+1935=2165)`(:340,:356) 且 `|x - a.x| <= LINGXIAO_HALF_X(60)` 且 `|z - a.z| <= LINGXIAO_HALF_Z(62)`(:358) 时，绕锚点 `a = (0, 233+1935=2168, 209)`(:335-339) 再乘 `k=2.7273`(:359)。
  4. 该平台换算后中心 `(0, 2170.6, 209)` 的 x/z **恰好等于** `LINGXIAO_ANCHOR_PRESCALE.z = 209`(`src/sky/heavenFrame.ts:40`) 与 `a.x=0`，即落在凌霄殿二次放大选区的 x/z 中心；8 个平台中只有此平台满足 `|x|<=60 && |z-209|<=62`（其余换算后 x 为 ±264~±334 或 z 为 −187/0）。
  5. `platform()` `src/sky/realm.ts:36-48` 用**缩放前坐标**直写（`b.cyl(..., x, y-1.5, z, ...)`），先经 `scaleHeavenGeometry`(`src/sky/expansion.ts:294-321`) ×2.2，再被上述**逐顶点盒选区**二次放大。
- **不确定的部分（故标疑似）**：二次放大是「逐顶点盒选区」而非整块等比缩放（超出 `|x'|>60` 的台基顶点**不会**被放大），实际台基外沿是**非均匀**的，无法从静态代码推出唯一半径；且 `PlayerController.groundHeight`(`src/game/player.ts:241-249`) 只在 `refY > 150+HEAVEN_LIFT` 用 PLATFORMS，异界 `foot` 态被 `realmY` 钉住（:406-408）不走 `gh`，故影响面限于**飞行坐骑防穿**（:340-341）、**toggleMode 落位**（:166-168）、**dismount**（:465）。
- **触发条件（表达式）**：`refY > 150 + HEAVEN_LIFT && refY < ...` 时 `groundHeight(x,z,refY)` 遍历 `PLATFORMS`，若 `dx²+dz² < r²` 全部不成立且 `terrainHeight(x,z) <= 3`，`best` 保持 `-Infinity` → 返回 `-Infinity` → `PlayerController.update` `:410` `Number.isFinite(gh)?gh:0` 把目标高度取 0（从 ~2170m 坠到人间 0）。
- **验收断言**：把 `PLATFORMS` 换算后的 `(x,y,z,r)` 与运行时 `scaleHeavenGeometry` + `enlargeLingxiao` 之后凌霄殿台基的 AABB 逐项 diff；在距平台中心 120m–260m 处采样 `player.groundHeight(x, z, refY>2150)`，断言返回**有限值**且等于实际台面高度；若返回 `-Infinity` / 0 则命中。
- **最小修法（若命中）**：`PLATFORMS` 换算对落在凌霄殿选区内的平台改用 `HEAVEN_SCALE * LINGXIAO_SCALE` 做 x/z/r 缩放，或运行时按几何 AABB 生成平台表而非烘焙常量表。

---

## 四、运行时验证建议

### 4.1 哪些结论必须浏览器 A/B 或逐帧截图 / 数据

| 类别 | 条目 | 说明 |
|---|---|---|
| **纯静态可证伪，无需运行时** | M-02（无重入标志）、M-03（`Math.random` 文本）、M-04（grep 无调用点）、M-05（setTimeout 逻辑）、M-07（两套代码并存）、M-08（固定步长文本）、M-10（`%3` 文本）、M-14（门 vs 生产注入差异）、M-01 的「零接线」（grep） | 第 2 轮对抗审查直接看代码即可逐条证伪 |
| **必须运行时 / 逐帧证实** | M-01 玩家是否真穿墙、M-06 相机是否真穿墙 / 穿地、M-02 重复触发次数、M-05 定时器提前清理、M-08 船桨帧率差、M-09 walk 界域瞬移、M-10 检测次数、M-11 异界跳跃、M-12 上岸瞬移、M-13 teleport 状态冲突、M-14 暂停跳变、附录 PLATFORMS 线索 | 需固定 dt 序列逐帧计数 / 状态机 A/B / 真实几何机位截图 |

> M-06 的「pitch→+85° 时相机 y < 地面」可先用探针纯数值断言（无需截图）；「是否穿进具体建筑 / 坡面」需几何机位（geom-expert 亦标【需运行时验证】，建议沿 +85° 做一张地形剖面 A/B：隐藏 `terrain` / `city_*` 分层连拍）。

### 4.2 最小验证方案（不改源码、不落盘脚本）

1. 复用台账已有的 `window.__qingming`（engine / world / scene）探针 + `Engine.renderOnce(dt)`(`src/core/engine.ts:904-907`) 做后台逐帧；给 `PlayerController.clock` / `ImpactSystem` 注入固定 `() => t*1000` 时钟（代码已支持注入，见 `src/game/player.ts:68`、`src/game/physics.ts:78`）。
2. 逐帧记录：`player.actor.pos`、`player.state`、`player.realmY`、`player.busyUntil`、`engine.camera.position`、`camera.pitch`、`units.playerBoat.phase`、`actor.action`、`ui:toast` 计数，导出为内存数组 / CSV 对比。
3. **A/B 组 ①（帧率一致性）**：同一段 1s 时长分别以 `dt=1/60 × 60` 与 `dt=1/30 × 30`（或 `dt=0.1 × 10`）推进，验证 M-08 船桨相位、M-10 检测次数、M-09 相机落位、`followCam` 的 `lerp(dt*k)` 阻尼一致性。
4. **A/B 组 ②（状态机 / 计数）**：触发前 / 后状态快照，验证 M-02 toast 与 setTimeout 计数、M-05 同动作重复时的 action 时序、M-11 逐帧 `p.y` 峰值、M-12 单帧 `|Δp|`、M-13 teleport 后 `state`、M-14 切后台回归后的硬直到期。
5. **相机专项**：`camDist` 扫描（2.5 → 16）+ 贴墙 / 贴坡机位连拍，`camPitch` 从 0 拖到 ±85° 取 5 个采样点前视截图，断言 `camera.position.y >= player.groundHeight(camera.x, camera.z, camera.y)`。
6. **附录 PLATFORMS 专项**：运行时读 `scaleHeavenGeometry` + `enlargeLingxiao` 之后的凌霄殿台基 AABB，与 `PLATFORMS` 换算圆逐项 diff；在 120–260m 环带采样 `groundHeight`。

---

## 五、交付口径

- 14 条结论按严重度降序，**以每条标题的【】标记为准**：
  - 【确认缺陷】**11 条**：M-01、M-02、M-03、M-04、M-05、M-06、M-07、M-08、M-09、M-10、M-14（修订后）。其中 M-06 的「相机 y 穿地」是确定的数学结果，「是否穿进具体建筑 / 坡面」为条目内的【需运行时验证】子项。
  - 【疑似需运行时验证】**3 条**：M-11、M-12、M-13。
  - 【设计取舍非缺陷】**0 条编号**：其正确实例集中列于 §〇「已核通过」段；M-14 原判的「注入式机制属取舍」部分保留在 M-14 条目的修订说明中，但条目整体已改判为【确认缺陷】。
  - 另 §三 附录 PLATFORMS 线索标【疑似需运行时验证】，**不计入 14 条编号**。
- 每条均给出 `file:line`、函数名、条件表达式、最小修法、determinism 影响与可断言的验收口径；未凭猜测报缺陷。
- M-14 是唯一改判条目，依据为 core-expert 提供、我已逐行核对的「验证门只覆盖注入路径、生产从未注入」新证据；不是对原「注入式机制属取舍」判断的推翻。
