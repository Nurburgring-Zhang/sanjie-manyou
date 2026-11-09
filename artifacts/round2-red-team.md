# 第 2 轮 · 红队对抗证伪裁决表（red-team）

> 角色：对抗证伪裁判，与第 1 轮 5 位领域专家（geom/motion/play/core/ui-perf）完全不重复。不生产新缺陷，只逐条证伪、剔除误判、驳回会破坏既有验收的修法、裁决互相矛盾的结论。默认立场「怀疑一切结论，直到代码或运行时证据无法反驳」。
> 基线：`git HEAD = be0226e`；工作区 4 个已修未提交源文件（terrain.ts / river.ts / underworld.ts / world.ts，V-01/02/03）；`npx tsc --noEmit` 0 错、`npm test` 15 files / 137 tests 全绿（主线程口径，本轮未复跑）。
> 证据优先级：**运行时硬证据 `round1-runtime-evidence.md` E-01…E-06（主线程浏览器实测）> `src/` 源码 > 静态推断 / 单帧截图**。E-06 的 5 条方法学陷阱为本轮主要武器。
> 纪律：**全程只读**——未修改任何 `src/` 源码、未运行 npm / vite / tsc / 测试 / 构建、未落盘脚本；仅本文件为授权写入的唯一审核产物。所有行号相对项目根 `src/...` / `docs/...` / `tests/...`。
> 标记五类：**【维持确认】/【下调为疑似】/【剔除：误判】/【剔除：设计取舍】/【修法需修正】**（修法需修正 = 缺陷定性成立但最小修法错/不全/会破坏验收；驳回或排期并入此类并注明）。

---

## 一、六大冲突 / 高风险点裁决（详裁）

### 冲突 1 · 右下竖排告示归属 → **裁决：订正（剔除「3D 招牌」，坐实「两个 DOM 相交」）；不保留、不并存**

台账 `VISUAL-AUDIT-20261107.md:50` V-10「右下告示为 3D 招牌」、geom 附录 §4、ui-perf §1.4/UI-13 均判为 3D 招牌。**全部剔除：误判。** 证据链：

1. **运行时双证（最高优先级）**：E-01 `elementsFromPoint(1520,800)` 命中 `#poiguide`；`getBoundingClientRect` = `[1480,754,80,129]`，文本「➤上河长卷（横向观画） 42m / 沿上河长卷横移，看完十二段市井」；`#skip` = `[1467,779,113,31]`、`class="show"`，两矩形实测相交（x 1480–1580 ∩ 1467–1580，y 779–810 ∩ 754–883）。3D 招牌是 canvas 内合批几何，不可能被 `elementsFromPoint` 返回、也不可能有 `getBoundingClientRect`。
2. **源码精确对号**：`src/game/poiGuide.ts:29-38` 创建 `#poiguide`（`uiRoot.appendChild` 挂 `#ui`）、`:31` `z-index:60;pointer-events:none;transform:translate(-50%,-50%)`、`:33` 箭头 `'➤'`、`:36-37` `white-space:pre-line` 多行 label + 半透明气泡、`:61-62`/`:85-86` 文本模板 `${best.name} ${dist}m\n${lv0.objective}`；`:77-81` 屏缘 clamp 可落右下。E-01 抓到的「名称 + 42m + 换行目标文案」与该模板逐字对应，且含**动态距离**（3D 招牌是静态店名，如 geom 附录自查的「酒」「肅靜迴避」）。`#skip` 对应 `src/style.css:127-130`（`right:20px;bottom:90px`，1600×900 下右边界 1580、底 810，与实测 rect 完全吻合）。
3. **截图复核** `screenshots/_va_probe.png`：右下是「黄色箭头 + 深灰圆角气泡 + 多行文字」的屏幕空间 HUD 标签，无木框/透视/立体感；文字挤成多行的观感来自 `white-space:pre-line` + `max-width:240px`（poiGuide.ts:37），叠加 `#skip` 按钮 → 即 V-10「挤压重叠」的**真实根因：两个 DOM 叠压**。
4. **传送后右下 DOM 全消失**（E-01、E-04 B2 只剩 `CANVAS/app/BODY/HTML`）：证明 `#poiguide` 是随相机移动的世界 POI 投影标记（poiGuide.ts:64 `best.pos.clone().project(camera)`），位置不固定；「右下常驻 3D 招牌」不成立。

**为何不「两者并存」**：`elementsFromPoint` 只返回 DOM 层，无法证明 canvas 内有无 3D 招牌（E-06 §3 明确警告）；但 V-10 那个「竖排告示文字」已被 `#poiguide` 的文本模板 100% 解释，且 geom 附录自查两处竖排调用（buildings.ts:1389/2035）后自己也承认「cell 与 quad 宽高比匹配、单 cell 内部不挤压」。把「3D 招牌也确认在右下」并列 = 把未证实的猜想当结论，须剔除。**V-11 招牌背面镜像是独立现象**（`world__crowdnear__front.png` 别的机位），归 G-06，不得并入 V-10。
**V-10 其余半句**：「血条不在 `#ui` 层」成立（E-01 `#bossbar` 是 `document.body` 直接子元素、`src/style.css` 全文 160 行无 `#bossbar` 规则、`src/ui/ui.ts:200` 拍照模式只隐藏 `#ui`）；但「顶部常驻红色细横条」中的「默认常驻可见」被 E-01（`opacity='0'`）与 `_va_probe.png`（开场机位顶部无红条）**证伪** —— 初始隐藏，「常驻」只在状态机被激活后发生，见冲突 2。

### 冲突 2 · Boss 血条「常驻」能否复现 → **裁决：复现步骤证伪；「状态机无 idle 回退」结构性缺陷仍成立；修法放 boss.ts:update() 脱战分支**

**复现步骤 `teleport('jiangtai')` 判定【剔除：误判】**，并给出代码级解释（不用 E-04 B1 的猜测「boss.update 未挂 updatables」）：

- Boss 确实每帧被驱动：`src/world.ts:1457` `this.boss.update(dt)` 在 `World.update()` 里直接调用（不是 engine.updatables 数组），E-02 S0 能读到 `boss idle` 即证明 boss 对象存在且 update 在跑 → **「未挂进 updatables」不是原因，剔除**。
- 真正原因在 `pos()` + `dist()`：`src/game/boss.ts:78-80` `pos()` 返回 `this.actor ? this.actor.pos : this.home`；构造传入的 actor = `src/world.ts:780` `this.deities.map.get(JULING.name)`，巨灵神 `home:'arenaE'`（`src/data/deities.ts:32`），落位在 arenaE 环（`src/sky/deities.ts:686` `r=38, a0=-0.12…0.52`，经 `src/world.ts:1329-1342` 的 `heavenPoint` ×2.2 换算，世界 XZ ≈ (73~84, −10~42)）；而 `POIS['jiangtai']`（`src/world.ts:358`）= `heavenPoint(0, 206.12, 9.09)`，世界 XZ ≈ (0, 20)。
- `src/world.ts:1718-1720` `teleport()` **只改 `player.actor.pos`，从不移动 Boss 的 actor**；`src/game/boss.ts:88-91` `dist()` = `hypot(b.x−p.x, b.z−p.z)` 只算 XZ（所以「天宫 y≈2168 vs 人间 y≈0」不是原因，dist 忽略 Y）。
- 于是 Boss(arenaE 环) 与 玩家(将台 POI) 的 XZ 距离约 **78–84m > `engageRange=34`**（`src/data/boss.ts:46`）→ `src/game/boss.ts:169-176` `if (d <= engageRange)` 恒 false → `state` 恒 `'idle'` → `syncHud` `src/game/boss.ts:244-245` `active = !defeated && state!=='idle'` → `opacity='0'`。与 E-04 B1「两次均 idle / opacity=0 / hp=320」完全一致。
- **可复核反推**：若 `deities.map.get('巨灵神')` 为 undefined，则 `pos()` 回退 `home`（`src/world.ts:781` = `heavenPoint(centers.arena=(0,0,0))` → XZ≈(0,0)），与将台 (0,20) 的 dist=20m < 34 → **本应 engage**。B1 未 engage 恰恰反证巨灵神化身存在且不在 home，而在 arenaE 环。E-04 B1 猜测的「dist 只算 XZ + Boss 的 actor.pos/home 在别处」中，后半句成立、前半句（暗指 Y 错配）是红鲱鱼。

**结构性缺陷【维持确认】**（代码级 grep 可复核，与能否用 teleport 触发无关）：
- `src/game/boss.ts:153-216` 全文**无任何 `this.state='idle'` 回赋值**（仅有 L158 respawning→engage、L171 idle→engage、L185 engage→telegraph、L203 telegraph→active、L212 active→engage、L129 dead）；`src/game/boss.ts:155` `if (this.defeated) return;` 使击败后 `update` 不再调 `syncHud`，`opacity` 锁死最后一次 `active||defeated=1`（L245）。
- 数值层自相矛盾坐实「遗漏非取舍」：L164-168 脱战 2.5s 后 4%/s 回血已把「离开 34m」当脱战，状态层却不回 idle；L188-189/204 脱战后 `vfx.ring`/`sfx:drum`/`vfx.burst` 仍按 `interval=[3.2,2.4]` 空转（play P-05 三条内证、ui-perf §1.5 会签一致）。
- **台账/ui-perf §1.3 第 3 点「单会话连拍 128 张、任一机位触发过 engage 即后续全部常驻」= 把单帧截图当状态序列**（E-06 §1 明令禁止），且依赖已被证伪的 teleport 路径 →【剔除：误判】。V-10「默认常驻可见」同样剔除（E-01）。台账确实拍到过红条，只能说明**另有触发路径**（探针按 J 击杀 → `defeated=true`；或把玩家移到 Boss 实际 `pos()` 34m 内；或 `respawnPlayerAt('jiangtai')` `src/world.ts:1806-1811`），不能反推复现步骤有效。

**正确修法位置【修法需修正】**：
- 主修放 `src/game/boss.ts` 的 `update()` 脱战分支：`!defeated && d > spec.engageRange && outT > 2.5` → `this.state='idle'; this.syncHud();` 并停掉招式空转；`defeated` 后补一次隐藏 / 3s 淡出。（ui-perf UI-02、play P-05 口径一致）
- **驳回**「只把 `syncHud.active` 改成 `d<=engageRange`」或「把 `state='idle'` 写进 syncHud」：治标不治本，招式仍空转（ui-perf §1.5 自己已标次选不推荐）。
- **驳回**把修法放 `world.ts` / `teleport`：teleport 不是根因；补 `teleport` 逻辑只会掩盖状态机缺口。
- **不冲突**：UI-01（`#bossbar` 改挂 `#ui`、z 收进 20–29、宽对齐 420，`src/game/boss.ts:221-235`）与上条并行、可同批做；二者是「挂载层」与「状态机」两个独立面。
- 验收改用**可达**触发路径：把玩家移到 `boss.pos()` 34m 内 → 断言 engage→离开 34m 等 5s → `opacity='0'` 且 `state='idle'`；或 J 击杀后断言延迟淡出（不可再用 `teleport('jiangtai')`）。

### 冲突 3 · 输入按键穿透 → **裁决：UI-04 成立（针对 `.panel.show`）；A3 既不能证明也不能否定 UI-04**

两类面板必须分开（E-03 §结论已明令「任何把 A3 当按键穿透证据的提案都应被剔除」）：

- **`#wishbar` / `#wish-input`（creation.ts）**：`src/game/creation.ts:45-46` 是不带 `panel` class 的 `<div>` + `<input>`；`:67` `input.addEventListener('keydown', e => { e.stopPropagation(); ... })` 在**目标阶段**掐断冒泡，连注册在 `window` 冒泡阶段的 `src/core/engine.ts:775-776` `this.keys.add(e.code)` 一起挡住 → E-03 A3「输入框聚焦按 W 相机不动、`keys` 空」成立，**且这条路径本来就是通的**。
- **`.panel.show`（ui.ts / interact.ts）**：`src/style.css:57-60` `.panel` 默认 `display:none`、`.panel.show` 才 `flex`；`src/ui/ui.ts:89-105` `togglePanel`、`:98-99` Esc 只移除 `.panel.show`、`src/game/interact.ts:114` `p.className='panel show'`。这些面板**不含聚焦的 `<input>`、也没有 stopPropagation** → `src/core/engine.ts:775-776` 的 `keys.add` 无条件执行、`src/ui/ui.ts:83-87`(KeyJ)/`:89-105`(M/Esc/T/B) 不检查面板 → WASD 仍驱动相机、J 仍出手、M/T/B 仍切面板。**UI-04【维持确认】**，证据 `engine.ts:775-776` + `ui.ts:83-105` + `style.css:57-60`。
- **A3【剔除：不能作反证】**：A3 测的是 `#wishbar` 输入框，机制是 `stopPropagation`；UI-04 测的是 `.panel.show`，机制是无面板门禁。二者不可混为一谈；用 A3 说「所以所有面板都不穿透 / UI-04 误判」= 误判。E-03 A4（提交后 `activeEl→BODY`）进一步说明「点击造按钮」会顺带失焦，与 `.panel` 无关。
- **UI-04 最小修法【修法需修正】**：项目**没有**「统一 window keydown 入口」（UI-07 确认 `engine.ts:775`、`ui.ts:83/89/197`、`buildMode.ts:35`、`creation.ts:61`、`player.ts:182` 等 ≥8 处并存），所以 `if (document.querySelector('.panel.show')) return` 不能「加在统一入口」，须分别加到 `engine.ts:775`（相机键）与 `ui.ts:83/89`（快捷键）；且 `.panel.show` 选择器**不会误伤 `#wishbar`**（它不带 panel class），正好与 A3 互不影响。修后须回归 E-02 全序列 + A3/A4。

### 冲突 4 · Escape 死锁 → **裁决：缺陷确认（双源印证）；「最小修法」必须补 `close()` 里的 `blur()`，否则有更隐蔽的焦点残留副作用**

**事件流核对（`src/game/creation.ts:61-69`）**：
- `:61-64` **window 冒泡阶段** handler：`KeyY && !isOpen()` → `open()`；`Escape && isOpen()` → `this.close()`。
- `:66-69` **input 目标阶段** handler：`e.stopPropagation()` + `Enter → submit()`（不处理 Escape）。
- 焦点在 `#wish-input`（`:75 open() → input.focus()`）时按 Esc：事件先到 input（目标阶段）→ `:67` `stopPropagation()` 阻断冒泡 → window 上的 `:63` `Escape→close()` **永远收不到** → `wishbar` 恒 `flex`。E-03 A1（`wishbar` 恒 flex、`activeEl` 恒 `wish-input`、boss 恒 idle）与 ui-perf UI-05 双源印证，【维持确认】。E-02 S4/S5 的「之后 G/J/传送全部不生效」是同一 `stopPropagation` 掐断整个 window 冒泡链的连锁，不是独立的「ui.ts INPUT 过滤」问题（后者是次级）。

**「最小修法」裁定【修法需修正】**：
- 「在 input handler 内直接处理 Escape（`if(e.code==='Escape') this.close()`）」方向可行（目标阶段先于冒泡，能收到 Esc）；但 **ui-perf UI-05 漏了 `blur()`，不完整**。
- `src/game/creation.ts:76` `close()` 只做 `this.bar.style.display='none'` + `this.input.value=''`，**不清焦点**。若浏览器未把 `document.activeElement` 从隐藏的 `<input>` 移走，则焦点名义仍在 `#wish-input`：`src/ui/ui.ts:85`/`:91` 的 `if (t.tagName==='INPUT'||'TEXTAREA') return` 会继续吞掉 J / M / Esc / T / B 等全部快捷键，且 `creation.ts:66` 的 input handler 仍会在目标阶段 `stopPropagation` → 出现「wishbar 关了但快捷键全废」的二次死锁，正是 team-lead 提示的隐蔽副作用。
- **反证**：E-03 A4「点击造按钮提交后 `activeEl→BODY`」—— 提交路径靠点击按钮**顺带失焦**才没有残留；Escape 路径没有点击，必须显式 `this.input?.blur()`。故正确最小修法 = `close()` 内 `this.input?.blur()`（或 Escape 分支显式 blur）+ input handler 处理 Escape；二者缺一不可。
- 替代方案（等价、更稳）：把 `:61` window handler 改**捕获阶段** `addEventListener('keydown', h, true)`，在 `stopPropagation` 之前就处理 Escape；但同样要在 `close()` 里 blur。不要采纳「全局 `keys.add` 加输入框过滤」——E-03 A3 证明那条路本来就被 `stopPropagation` 挡住、是通的（E-03 §结论已明令剔除）。
- 验收：修后按 Y→Esc，断言 `#wishbar.display==='none'` **且** `document.activeElement` 不是 `#wish-input`，再按 G/J/M/传送全部生效（E-02 S4/S5 解套）。

### 冲突 5 · 几何类修法的性能预算 → **裁决：先钉死 D7 §3.1 口径，再逐项分「零增量可做 / 驳回排期」**

**口径澄清（避免误读）**：`docs/重建-v2/D7-性能与预算.md:391-404` 的「面数不变 / 实例不变 / 构件不变 容差 0」是**性能优化的验收判据**（`:393` 引「六项保真度一项都不许减」；`:404` 明写「允许改的只有六类…这六类之外的一切改动都不属于性能优化，属于**内容变更，必须另开裁定**」）。draw 天花板 600 / P0 372（`:227-233`）、`T_static=18,959,342`（`:51`）、`live 4,495 / 1,011,881 instances`（`:398`）。视觉缺陷修复属「内容变更」，不受六类限制，但按 `:404` 与台账 §五 必须「另开裁定」= 新性能预算 + 逐批复拍 + 跑基线 + 补断言。
**成功先例**：台账 §四（`:76-79`）V-01/02/03 全是「材质 / 颜色 / UV / 片元着色级改动，不新增几何、不改生成架构、不动 build 流程」，因此「不触碰 137 条单测与 determinism 的几何口径，也不增加三角面预算」，137/137 全绿。**红队据此定义**：零增量可做 = 不新增/删除几何、不改顶点数/构件计数/实例数/program 数、不改随机源；其余一律驳回或排期。

| 项 | 修法 | 增量 | 裁决 | 理由（证据） |
|---|---|---|---|---|
| V-04 空地填充（G-05） | 补地面铺装 / 加建筑 | 新增三角面（即使「少量」）、改 `assetAudit` 构件计数 | **驳回 / 排期** | 违反 D7 §3.1 容差 0（`:397-399`）；`src/city/infill.ts:3403` `CORRIDOR_Z=[]` + `:3505-3508` `if(!near)continue` + `terrain.ts:2001` `d<6200 continue` 是根因（代码级成立），但批量加建筑会抬 25.87M tris / 348 calls 基数（台账 §五 `:112-116`），已定 P1-6/P4 逐批加、每批复拍+跑基线 |
| V-05 平板立面（G-07） | 对地标补 `buildDetailedFacade(...,windows:true,tier:'near')` | **+616 面/座** | **驳回 / 排期** | 增面违反容差 0；且 `src/city/detailKit.ts:128` `tier==='far' return` 是**有意取舍**（buildings.ts:1396-1399 注释自认腾预算）、阎罗殿背面是 W48 有意朱墙（台账 §一已剔除同类误判）、孙羊正店塔楼尚未定位（G-07 自标疑似） |
| V-08 天宫人口 | 新增 crowd 实例 / 陈设 | 新增实例 | **驳回 / 排期** | 违反 D7 §3.1「实例不变 `live 4,495`」（`:398`）；台账 §五已列 P1-6 排队项 |
| V-09 南天门比例（G-03） | 调 `R`/`h` 改券肩比例 | 改 `rebuildSkyGatePassage` 24 层券肩盒子数 → 小幅增面 | **驳回 / 排期** | 增面；`src/sky/expansion.ts:101-120`。「门洞 0.74:1 vs style-bible §6.1 T5 ≈2:1」量化成立（`expansion.ts:101-103`），但属内容变更需新裁定 |
| V-09 紫褐（G-03 材质组） | 城台/门楼墙 `wall`→`wood` | **0 面 / 0 draw / 0 实例**（仍是 14 组之一，`:399` 组名集合不变） | **零增量可做，但必须整包改 + 本轮排期** | `src/sky/realm.ts:182-184` 注释自认 wall 组 `emissive 0x3a3d48`（`bake.ts:1469`）把褐土染紫、W48 只修凌霄殿（`realm.ts:184 WG='wood'`）未修南天门。⚠️ **强耦合（team-lead 点名）**：`src/sky/expansion.ts:222` 硬编码 `stripBoxTriangles(scene, 'city_wall', {...})`，靠 mesh 名 `city_wall` 精确摘 12 个三角；若只改 `realm.ts` 材质组而不把 `:222` 同步改为 `'city_wood'`，城台几何被合批进 `city_wood`，摘除找不到目标 → `realm.ts:89` 那块 `44×8×18` 实心盒（`expansion.ts:218` 注释自认 100% 堵门洞）重新堵死。还须满足 `:220`「必须在 `compactStatic` 合批之前」、`:227` `__gateCut>0` 断言、复拍 iso/front 门洞贯通。因 G-08（8 角点精确匹配 + 合批顺序依赖）仍标疑似，**本轮先排期**，先做 G-08 的共享常量 + 门中断言再动材质组 |
| V-06 / G-01 屋顶 cap UV | 改 `bake.ts:365-370` cap 的 v 窄带 | **0** | **零增量可做** | 见冲突 6 |
| V-11 / G-06 招牌 | 加 `depthWrite:false` / 顶点色（不减面） | 0 | 可做（但需运行时 A/B） | `bake.ts:1613` 未设 `depthWrite`；改材质标志不减面。**驳回** G-06 原修法「单 quad + `gl_FrontFacing`」：会减少一半招牌三角面 + 改 shader program，动 `T_static` 面数与 program 数 |
| G-10 roof aoMap | 移除无效 `aoMap` | 0（反省一次纹理采样） | 可做 | `bake.ts:1474` `aoMap: tex.roofAuxGen ?? undefined`；是否无效需确认 Three.js 版本/`USE_AOMAP`（G-10 自标疑似）。「补 uv1」增顶点属性 → 排期 |
| UI/输入/存档/Boss 状态机/生存链（本轮 14+14+11 条） | 纯 JS / DOM 改动 | Δdraw=0、ΔT_static=0 | **可做** | ui-perf §3.2（`:228`）明确「路由与 UI Δdraw=0、ΔT_static=0」；play §三确认 8 条确认缺陷均不改 `Karma`/`conditions`/`VoxelStore`/`entity`/loop 被测纯函数，对 137 断言无影响 |

**会破坏 137 单测 / determinism 的修法（一律驳回或排期）**：新增/删除几何会动 `architectureAtoms.test.ts:27 .toBe(12)`、`:172-196` 逐构件精确计数、`palaceDetail.test.ts:46-57` roof y 范围、`atomicCatalog.test.ts:9-25` 计数；改随机源（C05 贴图注入 RNG、M-03 坐骑注入 RNG）会重刷贴图/运动状态内容，须重跑 `I5`/`I6` 与全部复拍（假绿门）；改 shader program（G-06）须重跑像素验收。**零增量修法不触碰这些**：`bakeQuant.test.ts:35-40` 只测 `b.box()` 的 BoxGeometry 路径（不测 `buildCurvedUnit`），`palaceDetail.test.ts` 对 roof 只断言 y 区间，UV 数值改动不影响。

### 冲突 6 · G-01 屋顶平板 → **裁决：「改 cap UV 窄带」零增量安全可做；「改 RIDGE_HALF」驳回 / 排期**

**归属【维持确认，双源印证】**：E-05 从 `city__sunyang__side` 打 25 条射线，命中同一 `city_roof_5` 合批 mesh，法线连续变化 `[0.98,0.18,0]/[0.32,0.95,0]/[0.98,-0.18,0]/[-1,0,0]`、顶点色 0.015–0.084 深灰且三顶点近似相等、材质 `MeshStandardMaterial{vertexColors:true,side:DoubleSide,map:有}` → 平板是**同一网格内 cap 顶面**（法线≈+Y、顶点色单一）被读成纯色，不是第二块几何、不是材质分组丢失。台账 V-06 Prior「疑似另有平顶壳体或材质分组覆盖」【剔除：误判】（geom G-01 静态逐项排除 + E-05 运行时印证）；`city_roof_5` 789,336 tris / `city_roof_9` 1,824,314 tris、包围盒横跨 ±27km（合批）——**任何「给屋顶加瓦垄条纹」的修法都必须落在 `buildCurvedUnit` 的 cap 顶点色 / UV，否则会动到全城 1367 顶**（E-05 结论）。

**「改 cap UV 窄带」【维持确认：零增量、安全、对症】**：
- `src/city/bake.ts:365-370` cap 的 `v` 钉死在 `sv*0.94`/`sv*0.86` 一条窄带（`:356` 注释「借用贴图的瓦当面行」），`u` 沿面阔 `f0.us[k]`/`b0.us[k]` 展开 → 无纵向瓦垄 → 纯色；坡面 `:327` v 覆盖 0..sv 完整瓦垄。把 cap 的 v 改为随 z 正常展开 **只改 UV 数值**。
- 零增量证明：`:283` `nVerts=(2N+1)*K*6` 结构定值，改 UV 不动顶点数 / 索引 / 位置 / 法线 / 材质组 / 几何结构 → 0 三角面、0 draw call、0 顶点、0 构件、0 实例增量，符合台账 §四 先例。
- 不破坏 137 单测：`bakeQuant.test.ts:35-40` 只测 `b.box()`；`palaceDetail.test.ts:46-57` 只断言 roof y 区间；`architectureAtoms.test.ts` 测构件计数（UV 不影响）。
- 唯一附带动作（验收，非驳回理由）：确认 `roofTex` 的 v 向瓦垄语义与坡面 `:327` 一致，同机位复拍量平板面积占比（G-01 验收方式）。

**「改 RIDGE_HALF」【驳回 / 排期】**：
- `src/city/bake.ts:246` `RIDGE_HALF=0.16` 被 `:274` `RIDGE`、`:306-307` `ring()` 的 `hx/hz` 初值、`:357` cap 的 `f0/b0` 共用；`:382` `curvedRoofUnit()` = `buildCurvedUnit(9,0)` 也共享；`:363` 注释自认「全城 1367 顶曲面屋顶的正脊盖」→ 改 0.16→0.08~0.10 会**改所有屋顶的顶点位置**（脊宽 32%→16%），重刷全城像素。
- 强耦合 4+ 处必须同步：`src/city/buildings.ts:277` `RIDGE_F=0.16`（注释「= bake.ts RIDGE_HALF（未导出，同值）」）、`:310` `ridgeHalf=RIDGE_F*SW`、`:311` 正脊盒 `b.box('roof', ridgeHalf*2,0.2,0.42,…)`、`hipRibbonOn`/`eaveRingOn`、`bake.ts:1219` `eaveTrim` 的 `RIDGE_HALF`；否则脊/垂脊/檐口脱开（style-bible §3.7「全工程唯一定义真源」）。G-01 自标风险「中高」。
- **不治根因**：E-05 已证明纯色来自 cap UV 窄带 + 水平面吃满光，收窄脊只减小平板面积，不消除 UV 钉带；且违反 D7 §3.1「像素不变」（`:402`），需全城复拍。
- 故 G-01 把「改 UV」与「改 RIDGE_HALF」并列为最小修法【修法需修正】：**本轮只采纳前者**。

---

## 二、逐条裁决表（5 份结论，共 66 条 + 附录）

> 每条一句理由 + `file:line` / 运行时数据。原定性取自各专家标题【】。「修法需修正」含驳回/排期，已在理由中注明。

### 2.1 geom-expert（10 条）

| ID | 原定性 | 红队裁决 | 一句理由 + 证据 |
|---|---|---|---|
| G-01 | 确认·最高 | **修法需修正** | 归属（cap 自身、非第二壳体/材质组）【维持确认】E-05 射线双源印证；「改 cap UV 窄带」零增量安全可做；「改 RIDGE_HALF」会动全城 1367 顶顶点位置 + 4 处强耦合 + 不治 UV 根因 → 驳回/排期（见冲突 6）。`bake.ts:246,283,356-370` / `buildings.ts:277,310-311` |
| G-02 | 确认 | **修法需修正 / 部分剔除** | 台账 V-12「半球」→三层圆锥/7×4 扁球订正【维持确认】`pools.ts:512-516`；但「leaf 无 uv / leafTex 失效」是 `bake.ts:1480-1482` 注释**自认「会重刷全城植被，本轮不动」的有意取舍** →【剔除：设计取舍】；「UV_GROUPS 加 leaf」修法改顶点属性 + 重刷全城 + 违反像素验收 → 驳回/排期。`bake.ts:591,685,846,1483` |
| G-03 | 确认 | **修法需修正** | 紫褐=wall 组 emissive（`realm.ts:182-184` 注释自认 + `bake.ts:1469`）、比例 0.74:1 倒挂（`expansion.ts:101-103`）【维持确认】；材质组修法零增量但**必须整包同步 `expansion.ts:222 'city_wall'`→`'city_wood'`**（否则 44×8×18 实心盒重新堵死门洞，`expansion.ts:218`），且因 G-08 疑似本轮排期；调 R/h 增面 → 驳回（见冲突 5） |
| G-04 | 确认 | **维持确认（根因）/ 影响面疑似** | 田块 1.7m 细垄 aliasing 非树：`infill.ts:3486-3499`、`terrain.ts:2001 d<6200 continue` 代码级成立；「是否走样成黑点」需 200m/900m 两档 + 隐藏 `city_ground`/`city_earth` A/B（geom §3.5 自标）→ 现象维持疑似；修法改 `fieldPlot` 会动 `country.ridge` kit 计数（`infill.ts:3481`）需同步资产清单 →【修法需修正：补验收】 |
| G-05 | 确认·规划 | **维持确认（缺陷）/ 修法驳回** | `infill.ts:3403 CORRIDOR_Z=[]` + `layBand` near 门槛 + `terrain.ts:2001` 代码级成立；但「补地面铺装/加建筑」增面违反 D7 §3.1 容差 0 → 驳回/排期（台账 §五 `:112-116`）。`buildings.ts:2921-2924` 注释自认桥东西 200×200m 纯土空地 |
| G-06 | 确认·台账 Prior 错 | **修法需修正 / 延伸剔除** | 「SignMesher 单面 quad 缺木背板」Prior 与代码不符、真机制两 quad 共面 + DoubleSide + 无 `depthWrite:false`【维持确认】`bake.ts:1586-1588,1596,1602,1613`；但修法「单 quad + `gl_FrontFacing`」减一半招牌面 + 改 shader program → 驳回/排期；**geom 附录「右下告示挤压并入 G-06 延伸」【剔除：误判】**（E-01 坐实是 DOM，见冲突 1） |
| G-07 | 疑似需运行时 | **维持疑似 / 修法驳回** | `detailKit.ts:128 tier==='far' return` 是有意取舍（`buildings.ts:1396-1399` 注释腾预算）、阎罗殿背面 W48 有意朱墙且 front 拍背面（台账 §一）→ 均【剔除：设计取舍】；孙羊正店塔楼需运行时定位生成函数 → 维持疑似；「+616 面/座」增面 → 驳回 |
| G-08 | 疑似需运行时 | **维持疑似 / 修法零增量可做** | `expansion.ts:222` 硬编码 mesh 名 + `:220` compactStatic 顺序 + 8 角点 `applyMatrix4` 精确匹配（`bake.ts:810`）脆弱，代码级成立但「一变即静默回归」需运行时验证 → 维持疑似；「抽 SKY_GATE 共享常量 + `__gateCut` 门中断言」零增量可做，且应**先于** G-03 材质组改动落地 |
| G-09 | 疑似需运行时 | **维持疑似** | `bake.ts:386-397 scaleGeoUV` 用 `floor(i/4)` 对非 24 顶点圆柱错位、`:1163 cyl()` uvDims 不等，机制静态可读；但「是否出现接缝/密度跳变」需 dump uv 范围（geom §3.7 自标最易误判、请第 2 轮收口）→ 本轮无运行时证据，维持疑似，不凭感觉剔除 |
| G-10 | 疑似需运行时 | **维持疑似** | `bake.ts:1474 aoMap` 缺 `uv1`、`Buf`/`flush` 只一套 uv（`:506,681`）、`deriveAux:182` 未生成 roughnessMap、`groundAux:225` 计算后未使用 → 死代码事实成立；但「aoMap 是否静默失效」需确认 Three.js 版本与 `USE_AOMAP` 宏 → 维持疑似；「移除 aoMap」零增量可做，「补 uv1」排期 |

### 2.2 play-expert（14 条）

| ID | 原定性 | 红队裁决 | 一句理由 + 证据 |
|---|---|---|---|
| P-01 | 确认·高 | **维持确认** | `interact.ts:133-150` `openShop` 购买成功分支只调 `act()`、从不 `survival.eat()`（全项目 `eat()` 唯一调用点 `world.ts:1551`）；修法不改被测纯函数（play §三已核）→ 可做 |
| P-02 | 确认·高 | **维持确认** | `world.ts:1550-1557` 打开小吃摊面板即无条件 `survival.eat(30,10)`、该 exec 不设 `busyUntil`、`interact.ts:45-48` 无节流 → 可无限刷；代码级成立 |
| P-03 | 确认·高 | **维持确认** | `interact.ts:134` 先 `pay(10)`、`:141` 成功分支不检查 `peach>=9`、`addPeach` `Math.min(9,…)` 丢弃、仅「阴德不足」分支 `:140` 有 refund → 满仓扣钱不回滚；计算式可复核 |
| P-04 | 确认·高 | **维持确认** | `buildMode.ts:141` 放置优先耗 `materialStock`、`:153-154` 拆除同时 `materialStock++` 且 `earn(2)` → 库存恒 1、每轮净 +2 无限正收益；计算式可复核 |
| P-05 | 确认·中高 | **修法需修正** | 状态机无 idle 回退【维持确认】（`boss.ts:153-216,244-245,155`，见冲突 2）；但复现步骤 `teleport('jiangtai')` 被 E-04 B1 证伪 →【剔除：误判】；修法放 `boss.ts:update()` 脱战分支，不放 `syncHud`/`world.ts`。与 UI-01/UI-02 合并为一条联合结论 |
| P-06 | 确认·中 | **维持确认** | `interactPoints.ts:85 price:1` + `interact.ts:134 pay(1)`（当铜钱扣）+ `:143-146 earn(100)` → 净 +99 文、`coins=0` 时 `pay(1)` 返回 false 无法兑换；计算式可复核 |
| P-07 | 确认·中 | **维持确认（根因）/ 影响面疑似** | `world.ts:1618-1625`/`:828-831` 的 `setTimeout` 回调不校验玩家在场/动作完成/是否被覆盖 → 离场仍 `earn(20)+karma.gain(2)`；代码级成立；「8.0–8.2s 200ms 重入窗口叠加两个 timer」需运行时 → 影响面疑似 |
| P-08 | 确认·中 | **下调为疑似** | `world.ts:765-768` `onPeachBanquet` 自动 `karma.gain(8,'heaven')` + `havoc.ts:362/370` 每轮自动到 pi=9、`world.ts:1476` 每帧无条件 `havoc.update` → 代码事实成立；但「挂机刷满佛道 6400」被 C01（`karma` 写档不读、读档清零）收窄为**仅单会话有效**，且「自动名场面给蟠桃」是 spike-H6 既有设计（play §二自认），「是否该要求交互」属产品取舍 → 定性需产品确认，下调疑似 |
| P-09 | 确认·中低 | **剔除：设计取舍** | play 自认「Boss 击退不算晕倒、代价轻属设计取舍」；`survival.damage()` 无调用（`survival.ts:62-71`）是**有意的两套失败语义**（击退走 `knockback` 回恢复点，不走晕倒罚金链）。把死代码当缺陷、且修法「接 damage()」会改变 Boss 战语义（罚半铜钱 + 业力 −100）→ 剔除并驳回修法 |
| P-10 | 疑似需运行时 | **剔除：误判（不可达分支）** | play 自认「8 个模板静态合规、`gateFail` 当前不可达」（`creationTemplates.ts:330-338`）→ `creation.ts:103-112` 退款失败恒不触发；「异常路径无 try/finally 复位 busy」属防御性编码建议，不是确认缺陷。team-lead 点名的「把不可达分支当确认缺陷」典型 |
| P-11 | 疑似需运行时 | **维持疑似** | `interact.ts:273-275` 满盘 `cand[0]` undefined 解构抛 `TypeError` 理论可达、`:211` 入场 50 文无退款；「入场即付」可能是设计取舍（play 自标）→ 本轮无运行时证据，维持疑似 |
| P-12 | 疑似需运行时 | **维持疑似** | A `ui.ts:83-87` 无 `ev.repeat` 过滤、B `boss.ts:107-138` 不查 `player.mode` + `world.ts:1718-1720` 灵魂模式 teleport 也设 pos → 代码事实成立；但 E-03 A2 实测「不打开面板直接 J，boss 仍 idle」是**距离超 `meleeRange` 早退**（`boss.ts:110-113`），A2 明确警示不可作反证、也不能作正证 → 需「玩家在 12m 内且 soul 模式」专门机位，维持疑似 |
| P-13 | 疑似需运行时 | **维持疑似** | `world.ts:1782-1803` 用 `poiGuide.current()`（按距离取最近，每 8 帧刷新）vs `nextObjective()` 用 `firstOpenIndex`（严格 LEVEL_ORDER）、`jiangtai` 只认 `boss.defeated` → 代码级不一致成立；「乱序完成进度跳变」需构造状态验证 → 维持疑似 |
| P-14 | 疑似·低 | **修法需修正 / 部分剔除** | A `player.ts:426-429` PORTALS 每帧检测不判 busy + `:445-459` 无 `portalPending` →【维持确认】（与 M-02 同一事实）；B「步入即传送」符合 `levelPlan.ts:37` yinyanggate objective →【剔除：设计取舍】；修法「加 portalPending/clearTimeout」可做 |
| §二 设计取舍清单 | 设计取舍 | **剔除：设计取舍** | `Karma.gain` 单向跃升、`knockback` 不复位 hp、`addPeach` 上限 9、门票 `parseInt(desc)`、`matchTemplate` 在 `spend` 之前、`seed` 未参与几何（低，属配方功能缺失）→ 均非缺陷，维持登记 |
| §4.1 / §4.2 存档叠加 | 联合登记 | **修法需修正** | 见 §三.1：karma/entities 读写不对称是真缺陷；codexLog/objectiveDone/playerWeapon 未入 v2 schema 属「未要求持久化」；**Boss 刷 300 文 +2 蟠桃的经济漏洞必须修，但「补 codexLog 入档」不足以治**（`world.ts:786` 的 if 只包 `push`，奖励 `:792-798` 在 if 之外，play §4.2 自认） |

### 2.3 ui-perf-expert（14 条）

| ID | 原定性 | 红队裁决 | 一句理由 + 证据 |
|---|---|---|---|
| UI-01 | 确认 | **维持确认** | E-01 确认 `#bossbar` 是 `document.body` 直接子元素；`boss.ts:221-235` `appendChild(wrap)`、`:224 z-index:30`、`style.css` 全文无 `#bossbar`、`ui.ts:200` 拍照模式只隐藏 `#ui` → 层级越顶成立；纯 DOM 修法零增量可做 |
| UI-02 | 确认 | **修法需修正** | 状态机无回 idle【维持确认】；但 §1.3 第 3 点「单会话连拍 128 张、触发过 engage 即后续全部常驻」= 单帧当状态序列 + 依赖已证伪的 teleport 路径 →【剔除：误判】；「默认常驻可见」被 E-01 `opacity=0` 剔除。修法放 `boss.ts:update()`，次选（只改 `syncHud.active`）已自标不推荐 → 维持驳回 |
| UI-03 | 确认 | **维持确认** | `engine.ts:782` 只在 keyup `keys.delete`、`:808-811` `blur` 仅 `endDrag`（`dragOn=false`）**无 `keys.clear()`**、无 `visibilitychange`；`D10 §1.3 T16` 要求失焦清缓冲 → 代码级成立，修法可做 |
| UI-04 | 确认 | **维持确认 / 修法措辞修正** | 针对 `.panel.show` 成立（`engine.ts:775-776` 无条件 `keys.add`、`ui.ts:83-105`/`interact.ts:114` 无面板门禁、`style.css:57-60`）；A3 不能否定（见冲突 3）→【剔除：以 A3 作反证】；项目无统一 keydown 入口（UI-07），修法须分别加到 `engine.ts:775` 与 `ui.ts:83/89` |
| UI-05 | 确认 | **修法需修正** | 缺陷【维持确认】（E-03 A1 双源，`creation.ts:61-69` 事件流）；但最小修法**漏 `close()` 里的 `blur()`**（`creation.ts:76` 不清焦点）→ 会留「wishbar 关了但 `ui.ts:85/91` INPUT 过滤继续吞掉全部快捷键」的二次死锁（见冲突 4） |
| UI-06 | 确认 | **维持确认** | `engine.ts:775` keydown 对 WASD/Space/E/C/Q/Ctrl/Shift 无 `preventDefault`、`ui.ts:95-104` 多数快捷键无、`style.css` 全文无 `:focus/:focus-visible` 且 `#ui *{pointer-events:auto}`（`:14`）→ 焦点落 `.dock-btn` 按 Space 双触发成立（影响面中低）；E-02 S2 已确认 fly 下 Space 是上升键（`engine.ts:985` 区段），非动作缺陷 |
| UI-07 | 确认 | **修法需修正：驳回 / 排期** | ≥8 处 `window.addEventListener('keydown')`（`engine.ts:775`、`ui.ts:83/89/197`、`buildMode.ts:35`、`creation.ts:61`、`player.ts:182` 等）代码级成立、`D10 §6 A1` 判 BLOCK；但「建 `src/input/router.ts` 单一入口 + context 栈」是**改全部输入处理的大重构**，会冲击 UI-05 死锁修复、`creation.ts:67 stopPropagation`、E-02 全序列 → 本轮不做，列为架构目标排队。`player.ts:185 ev.repeat` 已保护 V/E/F（初版误报已自更正）→ 该子项【剔除：误判】已由 ui-perf 自行处理 |
| UI-08 | 确认 | **维持确认** | `style.css:100-104 #infocard{bottom:92px;left:50%}` vs `:133-137 #interact-prompt{bottom:88px;left:50%}` 同锚仅差 4px → 撞车成立；「prompt 上移 40px」零增量可做 |
| UI-09 | 确认 | **维持确认** | `ui.ts:18 #goalchain z-index:62` vs `interact.ts:115` 面板 `z-index:30`，同在 `#ui` 堆叠上下文 → 盖字成立；`D10 §4.2` 分层表 50–69 不得覆盖 30–49；修法可做 |
| UI-10 | 确认 | **维持确认** | `ui.ts:62` 硬编码 `<canvas width=216 height=150>`、`style.css:111-113` 不缩放、全链路无 `devicePixelRatio`/`ctx.scale` → 高 DPI 发糊成立；`D10 §2.6` 补 DPR 不占预算 → 可做 |
| UI-11 | 疑似需运行时 | **维持疑似** | 分配事实确凿（`player.ts:437-442` 每帧 6 对象、`ui.ts:389/425` 4Hz/2Hz 全量 `filter().map()`、`poiGuide.ts:64` clone），但 `D10 §2.5` 自认 H1 未证实、削减项收益可能 ≈0；本轮 E-02 134 采样点未测堆/GC → 维持疑似，修法须先跑 `probe-frame-attrib` |
| UI-12 | 疑似需运行时 | **维持疑似** | `ui.ts:259/270/282/346/425`、`interact.ts:116/128/195` 的 `innerHTML` 拼接点当前数据源均为内部常量（ui-perf 已逐条核）、`vite.config.ts:15` `unsafe-inline` 为残余风险记账；需先存在外部/存档字符串回流才可利用 → 本轮无证据升级，维持疑似 |
| UI-13 | 疑似需运行时 | **修法需修正** | ①「几何层 3D 招牌挤压」并入 G-06 延伸 →【剔除：误判】（冲突 1）；②「屏幕空间 DOM 叠加」被 E-01 **实测坐实**（`#poiguide`×`#skip` 两 DOM 相交）→【升级为确认，但归因订正为两个 DOM 相交，不是 3D 招牌×DOM】；③ `#jumpbtn`（`style.css:147-150`）仅 `body.touch` 才 `display:block`，桌面态不显示、E-01 未抓到 → 列为「右下常驻 DOM」不准，订正；④ 窄视口 720px 顶栏溢出本轮未测 → 维持疑似 |
| UI-14 | 设计取舍/正面 | **剔除：设计取舍** | HUD 已节流（`ui.ts:410-435` statT/mmT/goalT）、小地图 4Hz 非每帧、`renderer.info` 已规范重置（`engine.ts:581/919`）、光照临时对象模块级复用、InstancedMesh 静态、loading 时机合理 → 均「不修」的正面确认，无缺陷可修，维持登记 |

### 2.4 motion-expert（14 条 + 附录）

| ID | 原定性 | 红队裁决 | 一句理由 + 证据 |
|---|---|---|---|
| M-01 | 确认 | **修法需修正** | 「几何+玩法两侧零接线」【维持确认】（`player.ts:395-404` 只 clamp、`collider.ts:186`/`ground.ts:62`/`loop.ts:15` 全仓无运行时实例化、`bake.ts` 无 collider 注册，geom 附录交叉确认）；但「玩家是否真穿墙」motion §四.1 自标必须运行时 →【下调为疑似】；修法「接 `blocked()` + `attachEntity/attachGroundBox` 进主循环」是 `rt/ground.ts:12`/`loop.ts:7` 自认的 P0-2/P0-5b **独立切片**，且会动 `collider.test.ts:117`「端到端」假绿断言 → 驳回/排期 |
| M-02 | 确认 | **维持确认** | `player.ts:426-429` PORTALS 循环每帧执行不判 busy、`:445-459` 无 `portalPending`/句柄、busy 使 `ix=iz=0` 位置不动 → 460ms 内叠加约 27 个 `setTimeout`；代码级成立，修法可做（与 P-14 A 同一事实，不重复计数） |
| M-03 | 确认 | **维持确认** | `src/city/mounts.ts:40-41` `yaw/phase` 由 `Math.random()` 生成（全仓唯一落在运动状态机里的）、`spawnAll()` 9 次 → 破坏确定性；修法注入 `RNG` 安全，但需重跑 `I6`/复拍（假绿门）→ 修法补验收 |
| M-04 | 确认 | **维持确认 / 修法补回归** | `applyDisorient`/`disorient`/`fadeHint`/`disorientJitter` 全 src 无调用点、`levelPlan.ts:57` 却声明 `threatSpec`、`world.ts:1466` 每帧无条件 `speedScale=near?0.55:1` 会覆写 → 代码级成立（与 P-09 旁证同一事实，以 M-04 为准）；修法「叠加式 speedScale」会改望乡台 slow 语义，须回归 `probe-threat`（M-04 自提） |
| M-05 | 确认 | **维持确认** | `interact.ts:101-107 act()` 每次 `new setTimeout` 不存句柄/不取消、面板 `onclick` 绕过 `tryInteract` busy（`player.ts:218-223`）→ 同名动作第一个 timer 提前清 `stand`；代码级成立，修法可做 |
| M-06 | 确认 | **维持确认 / 子项疑似** | `followCam`（`player.ts:435-443`）把 camera 直接 `lerp` 到 `focus+off+(0,2.2,0)`，pitch→85° 时 `off.y≈−7.47`、相机 y≈−5.27 穿地 → 数学子项确定成立；「是否穿进具体建筑/坡面」需几何机位连拍 → 子项维持疑似；修法复用 `engine.ts:446-449 CAM_TMP` 避免与 GC 削减项对冲（与 ui-perf 会签） |
| M-07 | 确认 | **维持确认（代码事实）/ 不夸大现象** | 两套跨界传送并存（`player.ts:426-429` 自动 2.6m + `world.ts:1663-1670` E 键 5m 直写 `actor.pos`）、落点同为 `(0,-260,-130)` → 代码级成立；但 E-02 S7 实测 yinyanggate/lingxiao/fengdu 传送「无 NaN、无跳变」→ 当前无可观察冲突，不按「已致跳变」夸大 |
| M-08 | 确认 | **维持确认** | `src/city/units.ts:567 b.phase += 2*0.016` 固定每帧 0.032rad 不读 dt，而 `player.boat` 与 `units.playerBoat` 同引用（`world.ts:1656`）、`player.ts:308` 又按 dt 推进 → 帧率相关；代码级成立，修法「改 `dt*2` 或删 units 侧」局部可做（注意同引用） |
| M-09 | 确认 | **维持确认** | `engine.ts:727-740 setCamMode('walk')` 无条件 `p.y=1.7`、`world.ts:1459 realmFloor=player.realmY??1.7`（取化身界域非相机界域）→ 异界切 walk 被钉回 1.7；代码级成立；E-02 S7 测的是 teleport 不是「fly→walk 切视角」，不覆盖本条 |
| M-10 | 确认 | **维持确认** | `world.ts:1500 if(this._frame%3===0)` 按帧数节流 `npcSweep`、60fps=20 次/秒 vs 10fps≈3.3 次/秒 → 帧率相关；代码级成立，修法「`sweepAcc+=dt`」可做 |
| M-11 | 疑似需运行时 | **维持疑似** | 异界 `foot` 分支 `player.ts:406-408 if(realmY!==null){p.y=realmY;vy=0}` 下一帧吞掉 `:417` 起跳 → 代码逻辑确定，但「异界是否本就不该跳」属产品取舍；E-02 未逐帧采样异界 `p.y` → 维持疑似 |
| M-12 | 疑似需运行时 | **维持疑似** | `player.ts:390-393` 上岸硬设 `p.z=±29`、`:410-414` 单帧 `Δy≈1.8m` → 代码逻辑确定，但需从河心逐帧采样坐实单帧跳变；本轮无证据 → 维持疑似 |
| M-13 | 疑似需运行时 | **维持疑似** | `world.ts:1711-1736 teleport` 只改 `actor.pos`+`setCamMode('fly')`，不清 `state/mounted/boat/vy/realmY` → 代码逻辑确定；E-02 S7 只测传送落点无 NaN、未测 mount/boat 态冲突 → 维持疑似 |
| M-14 | 确认（改判） | **维持确认** | `probe-sim-determinism.mjs:263-278` 每个 `new ImpactSystem` 显式注入 clock，而生产 `world.ts:858`/`:345` 不注入、落 `physics.ts:29 hostClock=performance.now()`；且 `world.ts:444/486` attach 回调**直调 `performance.now()` 算位置**、绕过注入接口 → 门验的是生产不存在的配置（假绿）；与 core C06 交叉确认；影响面（回放下分叉/切后台瞬移）需 `I6` 断言坐实 → 根因确认、影响面疑似 |
| 附录 PLATFORMS | 疑似需运行时 | **维持疑似** | `heavenFrame.ts:27-29` 只 ×2.2 不含 `LINGXIAO_SCALE=2.7273`、`player.ts:491-494` 只 `r*=2.2`、`expansion.ts:343-368` 逐顶点盒选区二次放大 → 两套缩放口径分叉是静态事实，但「是否致 `groundHeight` 返回 `-Infinity`/站位圈失配」需运行时 AABB diff + 120–260m 环带采样 → 维持疑似，不占编号 |
| §〇 已核通过表 | 非缺陷 | **剔除：设计取舍** | 动作与位移解耦、动作时间线复位、`FIXED_DT=1/120` 弹道、dt 钳 `[0,0.1]`、俯仰双 clamp、PointerInputRouter 单击收敛、LEGACY_RNG 确定性化、Boss 用 dt 无 Math.random、状态互斥主干 → 均非缺陷，维持登记 |

### 2.5 core-expert（14 条）

| ID | 原定性 | 红队裁决 | 一句理由 + 证据 |
|---|---|---|---|
| C01 | 确认·高 | **修法需修正** | karma/entities「写了不读」【维持确认：真缺陷】（见 §三.1）；但把 codexLog/objectiveDone/playerWeapon/creationCount/玩家位置一并算「缺陷」【剔除：设计取舍】（`SaveDataV2` `save.ts:42-54` 根本没定义这些字段）；且「补 codexLog 入档」**不足以**堵住 Boss 刷奖励（`world.ts:786` if 只包 push，`:792-798` 奖励在 if 之外）→ 修法须改 |
| C02 | 确认·高 | **维持确认（根因）/ 影响面疑似** | `interact.ts:87 void W.__saveSave(...)` fire-and-forget、`try/catch`（`:82-96`）只挡同步抛错挡不住 Promise rejection、`world.ts:772` 无 `.catch`、`:334` 读档失败仅 `console.warn` → 代码级成立；「玩家静默丢档」需运行时 → 影响面疑似 |
| C03 | 确认·高 | **维持确认（能力缺失）/ 修法排期** | `src/core/rng.ts:24-35` `Bus` 只有 `on/emit` 无 `off/once/clear`、`:36` 进程级单例；但 core 自认「`main.ts` 单次 boot 不触发」，触发条件是第二次 `init()`/HMR（`D7 §5:626`）→ 当前**不可观察**，属清理能力缺失；修法跨 world/audio/vfx/physics/ui 全部订阅点 → 排期 |
| C04 | 确认·高 | **维持确认（能力缺失）/ 修法排期** | `engine.ts:882-901` rAF 递归自持无 id/无 `stop()/dispose()`、监听器全无 `removeEventListener`、`:632 setLodSink` 全局单例、`:539/:924 shadowTick` private static 跨实例共享 → 代码级成立；core 自认「当前单实例运行不泄漏」→ 属清理路径缺失，非可观察故障；修法大改 → 排期 |
| C05 | 确认·中 | **维持确认 / 修法排期** | `bake.ts:26-205`、`terrain.ts:1826-1833`（1024² 地表 3300 次 `Math.random`）、`expansion.ts:1184-1188` 生成期贴图直接取全局随机 → 非确定源代码级成立；但修法「注入 RNG」会**改变全部贴图内容/视觉**，须重跑 `I5` + 全部复拍（含 V-01/02/03 对照图）→ 排期，不得静默改 |
| C06 | 确认·中 | **维持确认 / 影响面疑似** | `world.ts:444/486` attach 直调 `performance.now()` 写回 `actor.pos`、`crowd.ts:2053` 把位置引用交给回调 → 墙钟进入位置本体；生产 `world.ts:345/858` 不注入 clock、门验注入路径（与 M-14 同源）→ 代码级成立；「回放分叉/切后台瞬移」需 `I6` 坐实 → 影响面疑似 |
| C07 | 确认·中 | **维持确认** | `save.ts:58-69 migrate()` v2 `if(schemaVersion===2) return d` 原样放行、不校验字段；`world.ts:331` 未保护访问 `saved.economy.coins` → `{"schemaVersion":2}` 抛 TypeError 被 `:334` catch 吞成「走新档」；代码级成立（触发面窄：半写/损坏/跨版本档，注明低概率） |
| C08 | 确认·中 | **维持确认（架构层）** | 多硬编码种子（`world.ts:335/413`、`terrain.ts:1961`、`boss.ts:27`）+ behaviors/crowd 各一份模块级 `LEGACY_RNG` 单例流 + 多处 `Math.random` → 代码级成立；core 已做「LEGACY_RNG 是固定种子确定性流、非墙钟非 Math.random」的定性分离（防误报，做得对）→ 维持；修法「单一 WorldRng」大改 → 排期 |
| C14 | 确认·中 | **维持确认：真缺陷 / 修法需修正** | 见 §三.1：四步链可复算（`world.ts:846 I.save()` 在 `:851 revive()` 之前 → 档里 `hp=0`；`survival.ts:101 this.fainted=this.hp<=0` → 吸态；`:46/:64 hp<=0&&!fainted` 恒 false；清标志的 `revive()` 只由 `world.ts:851` 调）→ 真缺陷；但**影响面须收窄**（`fainted` private 全仓只在 survival.ts 读，玩家输入不锁、游戏不卡死；`eat()` 可把 hp 拉回 >0 但 `fainted` 仍不清）；修法「只改 deserialize 的 `fainted=false`」不根治（根因是写档时序），须改 `world.ts:846` 时序或把 `fainted` 显式入档 |
| C09 | 确认·中 | **维持确认** | `engine.ts:565 focusPos=new Vector3()` 原点初值、`:742-759 focusOn()` 只在 `:758 onEnd` `.copy(pos)`，而 `step()`（`:911-912`）先 `tweener.update()` 再 `updateCamera()`、focus 分支 `:964-969` 每帧 `lookTarget.lerp(focusPos, dt*3)` → 补间全程把视线拉向原点；调用点 `world.ts:1692` 真实存在 → 可逐步复算成立，修法单点可做 |
| C10 | 确认·中低 | **维持确认 / 修法合并排期** | `focusUntil`（`engine.ts:746/965`）、`cinemaT`、`tween.ts:15` 用引擎 t；`busyUntil`（`interact.ts:104`,`player.ts:219/455`）、`impactUntil`（`physics.ts:104-202`）、`crowd.ts:2040` 用墙钟 → 双时钟代码级成立；修法与 C06 同源（统一注入 `()=>engine.t*1000`）→ 合并排期 |
| C11 | 疑似需运行时 | **维持疑似** | 两个 `SaveManager`（`world.ts:324` 读档不 `close()`、`:771` 另建写档）、`:772` 异步注入 `__saveSave` 无 `.catch`、`:834-840` 首次 `interact.save()` 只 `await raf()` 不等 IDB open → 竞态代码可读；但 E-04 B3 只探测「world 原型无 save/serialize 方法、payload null」、**未测 IDB open 竞态**；core 自认「三币仍落 localStorage，可能被 legacy 迁移自愈」→ 本轮无证据升级，维持疑似 |
| C12 | 疑似需运行时 | **维持疑似** | `interact.ts:87-94` 写档无 `Number.isFinite`、`save.ts:127 JSON.stringify`（NaN/Infinity→null）→ 防护缺失代码级；但 core 自认「未见确凿污染路径」→ 维持疑似，不升级 |
| C13 | 设计取舍 | **剔除：设计取舍** | `loop.ts:15-55 FixedStepLoop` 零调用（`loop.ts:5-7` 注释自认 P0-5b 独立切片）、`engine.ts:891-892 frameMs.shift()` 重复两行（D7 §0.3:107 已登记）、3 个有 emit 无 on 的预留事件、`engine.ts:119-120` LOD LCG/特效 `Math.random`、`main.ts:88-94 boot().catch()` 已有提示 → 均「不修」项，维持登记 |

---

## 三、专题核查

### 3.1 core 存档读写不对称（C01/C02/C11/C12/C14）：真缺陷 vs「设计上没要求持久化」

**判据**：`src/rt/save.ts:42-54 SaveDataV2` 正式 schema 只有 `schemaVersion/savedAt/economy/entities/voxel?/survival?/karma?`。**写档侧** `src/game/interact.ts:79-98` 写 `{schemaVersion:2, economy, entities:[], voxel, survival, karma}`；**读档侧** `src/world.ts:327-332` 只应用 `economy`(`interactPending`)、`voxel`、`survival`。

| 项 | 裁决 | 依据 |
|---|---|---|
| **写 `karma` 但读档不恢复** | **真缺陷【维持确认】** | `karma` 是 `SaveDataV2` 正式字段（`save.ts:53` 注释「P1-5 业力快照」）、`interact.ts:93` 明确写 `karma.current().karma`、`Karma.serialize()/deserialize()` 齐备（`karma.ts:58-61`），但 `world.ts:328-330` 从未调 `karma.deserialize`（全仓零调用）→ 读档后业力=0 / 阶位回「人道」，而 HUD 阶位行（`ui.ts:421-425`）、六道阈值（`karma.ts:17-24`）、`karma:ascend` 是 HEAD「P1-5 六道阶位收口」的核心玩法轴。**schema 定义了、写档写了、恢复能力存在却没接 = 铁证级读写不对称**，绝非「没要求持久化」 |
| **写 `entities` 恒 `[]`** | **真缺陷【维持确认】** | `save.ts:47` 正式字段、`save.ts:85-94 collectPersistedEntities()` 齐备却**全仓零调用**、`interact.ts:90` 恒写 `[]`；而 `creation.ts:123` `allocate('creation',{persist:true,provenance})` + `rebuildAll()`（`:141-161` 注释「world 载入链末步调用」）证明**设计意图要求造物跨会话重演**。属「意图明确但未落实」，非未要求 |
| **Boss 读档复活 → 刷 300 文 + 2 蟠桃** | **经济漏洞是真缺陷；但「Boss 复活」本身可算设计；修法必须修正** | 单会话防重靠 `boss.defeated`（`boss.ts:36/108/128-135/155` 有效）；跨会话每次 `new ArenaBoss`（`world.ts:778`）重置 `defeated=false`/`hp=320`，`codexLog` 未入档使 `world.ts:786` 的「已伏誅」意图防重失效 → 可再击杀再领 `addPeach(2)+earn(300)+playerWeapon+bossReward()`（`world.ts:792-798`），`earn(300)`（`interact.ts:62`）把 +300 落盘。**关键**：`world.ts:786` 的 `if (!codexLog.some(...))` **只包住 `codexLog.push`，奖励全在 if 之外**（play §4.2 自认）→ 即便按 core C01 建议「补 codexLog 入档」，奖励仍无条件发放，**刷钱漏洞不治**。正解：把 `:792-798` 奖励段也纳入「已伏誅」守卫，或给 `boss.defeated` 入档并在载入时恢复。core C01 最小修法【修法需修正】 |
| **`survival.deserialize` `fainted=hp<=0` 吸态（C14）** | **真缺陷【维持确认】**，但影响面收窄、修法修正 | 四步链：`world.ts:842-852 onFaint` 中 `:846 I.save()` 排在 `:851 revive()` 之前，该刻 `hp=0`（`survival.ts:46-50` 刚置 `fainted=true`）→ `serialize()`（`:89-94`）把 `hp:0` 写进档 → 读档 `world.ts:330` → `survival.ts:101 this.fainted=this.hp<=0` 预置 true → `:46`/`:64` 晕倒沿 `hp<=0&&!fainted` 恒 false → 罚金/孟婆庄传送/`faints++`/hp 复位链永久失效。触发条件精确：`penalty=Math.floor(coins*0.5)>0` 才 save（`world.ts:845-846`）+ 随后刷新读档。**不是「游戏卡死」**：`fainted` private、全仓只在 `survival.ts:34/46/47/56/64/65/101` 读，玩家输入不锁；`eat()`（`:75-76`）可把 hp 拉回 >0 但 `fainted` 仍不清。**修法**：根因是写档时序，须把 `world.ts:846` 的 `I.save()` 移到 `:851 revive()` 之后，或把 `fainted` 显式纳入存档；只改 `deserialize` 的 `fainted=false` 是治标（档里仍 `hp=0`，下次读档再吸态） |
| **codexLog / objectiveDone / playerWeapon / creationCount / 玩家·相机位置「根本没进存档」** | **【剔除：设计取舍】** | 这些字段**根本不在 `SaveDataV2` schema**（`save.ts:42-54`），写档代码里也没有、`Karma` 之外无对应 deserialize → 属「v2 未定义的持久化范围 / 未来可加功能」，不是「写了不读」的 bug。core C01 把它们与 karma/entities 混为一条「读档后状态无法重建」定性过宽，须拆分。**但**由此派生的 Boss 刷奖励经济漏洞仍须单独修（见上），不靠补这些字段 |
| C02 存档失败静默 | 真缺陷（根因确认） | `interact.ts:87 void` 无 `.catch`、`world.ts:772/334` 无捕获；影响面「玩家丢档」维持疑似 |
| C11 两 SaveManager + 首次写档竞态 | **维持疑似** | E-04 B3 未测 IDB open 竞态；core 自标疑似（三币仍落 localStorage 可能被 legacy 自愈） |
| C12 写档无 NaN 防护 | **维持疑似** | 无确凿污染路径（core 自认）；本轮无运行时证据升级 |

### 3.2 「疑似需运行时验证」条目：本轮是否有足够证据升级 / 维持

**本轮运行时证据覆盖边界**：E-01（DOM 归属/性能快照）、E-02（134 点动态序列，含按键/传送/造物/模式切换）、E-03（输入 A/B 4 例）、E-04（Boss/存档 3 例）、E-05（屋顶 Raycaster）、E-06（方法学）。**未覆盖**：GC 卡顿、XSS、招牌 z-fighting、scaleGeoUV、aoMap、平板立面定位、stripBoxTriangles 脆弱、异界跳跃/上岸/传送状态冲突、相机穿墙、存档 IDB 竞态/NaN 污染、造物 gateFail、五子棋满盘、KeyJ repeat、目标链乱序、PLATFORMS 选区。

- **升级为确认（有运行时硬证据）**：`UI-13` 的「屏幕空间 DOM 叠加」子项（E-01 两 DOM 相交坐实，但归因订正为 `#poiguide`×`#skip`）、`UI-05` Escape 死锁（E-03 A1 双源）、`E-04 B3` 存档链路定位（存档走 SaveManager + InteractSystem.save + `loadOrMigrateLegacy`，**不能按 world 方法名证伪** core C01/C02）。
- **下调 / 剔除（被运行时证据反证）**：`P-05`/`UI-02` 的 teleport 复现步骤（E-04 B1）、`UI-02 §1.3(3)` 单帧当序列（E-06 §1）、`V-10` 默认常驻可见（E-01 `opacity=0` + `_va_probe.png`）、`geom 附录`/`UI-13` 右下 3D 招牌（E-01）、`UI-04` 以 A3 作反证（E-03 A3/A4）。
- **一律维持疑似**：G-07、G-08、G-09、G-10、P-11、P-12、P-13、P-14(B 已剔除)、UI-11、UI-12、UI-13(窄屏子项)、M-01(穿墙现象)、M-06(穿建筑子项)、M-11、M-12、M-13、M-14(影响面)、附录 PLATFORMS、C11、C12、C02/C06/C07(影响面)、P-07(200ms 窗口)。**本轮没有足够证据把任何一条「疑似」的现象面升级为确认**（除 UI-13 DOM 子项），维持疑似是纪律要求。

### 3.3 会破坏 137 单测 / determinism / 既有验收的修法（驳回清单）

1. **新增 / 删除几何**：V-04 填充、V-05 补立面（+616 面/座）、V-08 人口实例、V-09 券肩盒子、G-06 招牌减面（单 quad 方案）→ 改 `T_static` 逐组 triangles 与 `assetAudit` 构件计数，违反 `D7 §3.1:397-399` 容差 0，并可能触发 `architectureAtoms.test.ts:27/172-196`、`palaceDetail.test.ts:46-57`、`atomicCatalog.test.ts:9-25` 的精确计数断言。
2. **改随机源**：C05 贴图注入 RNG、M-03 坐骑注入 RNG → 重刷贴图/运动状态内容，须重跑 `I5`（贴图 canvas sha256）、`I6`（位置哈希）与全部复拍；否则 `probe-sim-determinism.mjs` 的「假绿」不被修复反而被掩盖。
3. **改 shader program**：G-06 `gl_FrontFacing` + `onBeforeCompile` + `customProgramCacheKey` → 改 program 数与像素输出，须复拍 + 像素验收。
4. **大重构**：UI-07 `src/input/router.ts` 单一入口（改全部 keydown，冲击 UI-05/creation stopPropagation/E-02 全序列）、C03/C04 Bus `off`/Engine `dispose`（跨 world/audio/vfx/physics/ui 全部订阅点）、M-01 接 collider 进主循环（`rt/ground.ts:12`/`loop.ts:7` 自认独立切片 + `collider.test.ts:117` 假绿）、C08 单一 WorldRng → 均排期，本轮不动。
5. **改顶点位置常量**：G-01 `RIDGE_HALF`（全城 1367 顶顶点位置 + 4 处强耦合 + 像素不变验收）→ 驳回/排期，见冲突 6。
6. **修法会改变既有玩法语义**：P-09 接 `survival.damage()`（Boss 击退变晕倒 + 罚半铜钱 + 业力 −100）、P-14 B「步入即传送」改 E 键路径 → 剔除/驳回。

**可本轮做（零增量 / 纯 JS，不触碰 137 单测与 determinism）**：台账 §四 同款（材质/颜色/UV/顶点色/参数）→ G-01 cap UV；UI-01/03/04/05/06/08/09/10（纯 DOM/输入，含 `close()` 补 blur）；Boss 状态机收口（`boss.ts:update`）；存档链路修（karma.deserialize、entities 收集、`world.ts:786` 奖励守卫、`world.ts:846` save 时序、C02 `.catch`、C07 schema 校验）；玩法经济/生存链 P-01/02/03/04/06/07（play §三已核不改被测纯函数）；M-02/04/05/08/09/10（局部运动修正，需回归 `probe-threat`）；G-03 材质组**整包**（须先 G-08 断言 + 排期）。

---

## 四、给主线程的最终改码结论（可直接执行 / 排期 / 驳回）

**A. 可直接改（零增量、不破坏验收）**
1. `src/game/boss.ts:update()` 脱战分支补 `state='idle'`+`syncHud()`+停空转；`defeated` 后补淡出。**不要**改 `syncHud.active` 表达式、**不要**改 `world.ts`/`teleport`。验收改用「把玩家移到 `boss.pos()` 34m 内」而非 `teleport('jiangtai')`。
2. `src/game/boss.ts:221-235` `#bossbar` 改挂 `#ui`、z 收进 20–29、宽对齐 420（与 1 并行）。
3. `src/game/creation.ts:66-69` input handler 处理 Escape；**`:76 close()` 必须补 `this.input?.blur()`**。验收断言 `activeElement` 不再是 `#wish-input`（E-03 A1 回归）。
4. `src/core/engine.ts:775` 与 `src/ui/ui.ts:83/89` 分别加 `.panel.show` 门禁（勿误伤 `#wishbar`）；`engine.ts:808-811` blur/visibilitychange 补 `keys.clear()`。
5. 存档链路：`world.ts:328-330` 补 `karma.deserialize(saved.karma)`；`interact.ts:90` 改调 `collectPersistedEntities()`；**`world.ts:786` 的 if 作用域扩大到 `:792-798` 奖励段**（或给 `boss.defeated` 入档）—— 这是堵「读档刷 300 文 +2 蟠桃」的**唯一有效点**，补 codexLog 入档无效；`world.ts:846` `I.save()` 移到 `:851 revive()` 之后（C14 根治）；`interact.ts:87`/`world.ts:772` 补 `.catch`；`save.ts:58-69` 补字段校验。
6. `src/city/bake.ts:365-370` cap 的 v 从 `sv*0.94/0.86` 改为随 z 展开（**只改 UV 数值**）；同机位复拍量平板占比。
7. UI 其余零增量项（UI-08/09/10/06）、玩法经济/生存链 P-01/02/03/04/06/07、M-02/04/05/08/09/10、C07/C09 —— 按各专家最小修法，须带对应验收断言（`probe-threat` 等）。

**B. 排期（需新性能预算 / 逐批复拍 / 新单测 / 独立切片）**
- V-04/V-05/V-08/V-09 几何补面、G-06 招牌 shader/减面、G-02 leaf 补 uv、G-03 材质组**整包**（先做 G-08 共享常量 + `__gateCut` 断言）、G-01 `RIDGE_HALF`、C05/M-03 注入 RNG、UI-07 router、C03/C04 dispose、C08 单一 WorldRng、M-01 接 collider。

**C. 明确驳回 / 剔除（不得改）**
- 「右下告示为 3D 招牌」（V-10 / geom 附录 / UI-13 几何层）：订正为 `#poiguide`×`#skip` 两 DOM 相交。
- 「`teleport('jiangtai')` 触发 engage」「Boss 血条默认常驻」「单会话连拍 128 张即常驻」：剔除。
- 用 E-03 A3 否定 UI-04、或给全局 `keys.add` 加输入框过滤：剔除（A3 证明那条路本来是通的）。
- P-09 接 `survival.damage()`、P-10 把不可达 `gateFail` 当缺陷、`syncHud.active` 治标修法、只改 `deserialize.fainted` 不改写档时序、只改 realm.ts 材质组不同步 `expansion.ts:222`：全部驳回。

---

## 五、基线漂移声明与已落地修法复核（收尾时新增，重要）

**审核期间工作区发生了并行改动，非本红队所为。** 我全程只读，未对任何 `src/` 文件执行写操作（仅 `Read`/`Grep`/`Glob`/`ViewImage` 与只读 `git status`/`git diff`/`sed -n`/`wc -l`）。对比两次 `git status`：

- 审核开始时工作区仅 4 个已修未提交源文件：`src/city/river.ts`、`src/sky/underworld.ts`、`src/world.ts`、`src/world/terrain.ts`（V-01/02/03）。
- 收尾时变为 **10 个**：新增 `src/core/engine.ts`、`src/game/boss.ts`、`src/game/buildMode.ts`、`src/game/creation.ts`、`src/game/interact.ts`、`src/ui/ui.ts`（`git diff --stat src/` = 10 files / +256 / −62）。这 6 个是**主线程 / 蓝队在我审核期间按第 1 轮结论并行落的码**。

**因此本文所有 `file:line` 基于「读取时刻的源码」（HEAD `be0226e` + 初始 V-01/02/03 四文件），当前工作区行号已漂移。** 例：`boss.ts` 的 idle 回退现位于 `:181-187`（原 `:169-216` 段内无此分支），`creation.ts` 的 `close()` 现位于 `:83-86`（原 `:76`）。**主线程落裁前须按当前 `git diff` 逐条复核行号与是否已修。**

**抽查已落地修法（2 个最关键冲突点）——均合规，本文对应【修法需修正】项在当前工作区已被修正，无需再改**：
1. `src/game/boss.ts:181-187`：`if (!defeated && outT>2.5 && state!=='idle') { state='idle'; timer=0; outT=0; syncHud(); return; }` —— 放在 `update()` **脱战分支**、复用 `outT` 闸门、幂等、`return` 顺带停掉招式空转；`:162-165` `defeated` 后 3s 淡出用 **sim-time dt 而非墙钟定时器**。与冲突 2 裁决「修法放 boss.ts:update() 脱战分支、不放 syncHud/world.ts、defeated 后补淡出」完全一致。
   - 附带提示（新引入、非缺陷）：`:184 outT=0` 与 `:188` 脱战回血共用同一 `outT`，会把回血相位一并重置，回血较原实现延后约 2.5s；若要求「脱战即回血」需拆成独立累加器 —— 属微调，不阻塞。
2. `src/game/creation.ts:73` `if (e.code==='Escape') { e.preventDefault(); this.close(); return; }`（在 input 目标阶段就地处理，绕开 `:72 stopPropagation` 对 window 的吞掉）+ `:83-86` `close()` 显式 `this.input.blur()`（`:82` 注释「关闭时必须 blur：否则隐藏的 input 仍是 activeElement，全局快捷键会一直被吃掉」）。与冲突 4 裁决「必须补 `close()` 的 `blur()`，否则 `ui.ts:85/91` INPUT 过滤续吞快捷键」完全一致。

**仍需主线程按本文 §四 核对是否落到位的高风险点（抽查未覆盖，不能默认已修）**：
- `src/world.ts:786` 的 `if` 作用域是否扩大到 `:792-798` 奖励段 —— 这是堵「读档刷 300 文 + 2 蟠桃」的**唯一有效点**，仅补 `codexLog` 入档无效（§三.1）。
- `src/world.ts:846` 的 `I.save()` 是否移到 `:851 revive()` 之后（C14 吸态根治；只改 `deserialize` 不治本）。
- `src/world.ts:328-330` 是否补 `karma.deserialize(saved.karma)`；`src/game/interact.ts` 的 `entities` 是否改调 `collectPersistedEntities()`。
- `src/core/engine.ts:775` / `src/ui/ui.ts:83/89` 是否分别加 `.panel.show` 门禁（UI-04）；`engine.ts` blur 是否补 `keys.clear()`（UI-03）。
- `src/sky/expansion.ts:222` 若 G-03 材质组已改 `'city_wall'→'city_wood'` 是否同步（否则门洞堵死）。
- 本文 §四 B/C 的排期项与驳回项：确认没有被提前落地（尤其 `RIDGE_HALF`、V-04/05/08/09 增面、G-06 减面/shader、`router.ts` 大重构）。

---

## 六、运行时 A/B 补证后的复核订正（依据 `round1-motion-ab.md`）

> 来源：motion-expert #11 完成、`artifacts/round1-motion-ab.md`（193 行）落盘；原始数据 `artifacts/_motion_ab_raw.json` / `_motion_ab_m12_raw.json`；探针 `scripts/_motion_ab_01_cases.mjs` / `_02_m12.mjs`。四例均全新 page + rAF 逐帧 + `errs=[]`。按本文 §3.2「据新证据复核订正」执行。
> **§2.4 表格中 M-11/M-12/M-13 的【维持疑似】原判保留作审核轨迹，本节订正为准**；M-06/M-07 为对齐确认与描述订正；其余条目 motion-expert 明确不翻案。

### 6.1 三条【维持疑似 → 升级为确认缺陷】（现象面由运行时硬证据坐实，E-06 §5 优先于静态推断）

| ID | 订正 | 运行时证据 | 红队论证 / 修法 |
|---|---|---|---|
| M-11 | **升级为确认缺陷（状态机不一致）**，严重度低；「异界是否允许跳」的产品选择仍交主线程，但修法必须二选一、禁止留中间态 | 人间对照 `landAt(0,0,100) realmY=null`：104 帧 peakY=1.284 / maxRise=1.284 / maxVy=7.5 / distinctY 连续上升 0→0.05→0.413→…；异界 `landAt(0,-260,-130) realmY=-260`：121 帧 peakY=-259.95、maxRise=0.05、**maxVy=7.5**、distinctY 仅 `[-260,-259.95]`、state 恒 foot；断言「峰值 > realmY+0.3」失败（−259.95 ≤ −259.7） | **关键**：两组 `maxVy` 同为 7.5 → `player.ts:421` 起跳分支（`vy=7.5; p.y+=0.05`）**确实进入**，却被 `:410-412` 下一帧钉回 realmY 且 vy 清零。有意「禁跳」不会留下「vy 被设 7.5 又立刻归零 + 一帧 0.05m 可见抖动」的半吊子态 —— 这是**「允许」与「干净禁用」之间的不一致实现**，不是纯产品取舍，故升级。修法二选一：(a) 允许 → 异界用相对偏移 `p.y=realmY+jumpOff` 积分 vy（改运动积分、需逐帧回归，**排期**）；(b) 禁止 → `realmY!==null` 时直接不进 `:421` / 清 jumpQueued（几行、零风险，**可进批次 A**）。当前 `player.ts:410-412,421` 仍未修（已逐行核对） |
| M-12 | **升级为确认缺陷** | 首测 camYaw=0 按 W 163 帧全程 swim、z 26→22.9668、transitions=[] → motion-expert 如实留档为**探针方向错误**（`player.ts:287 iz-=1` → W 朝 −z，未越 `:379` 阈值），按 E-06 §2/§5 补测三例均单帧 swim→foot：A(camYaw=π,+z 岸) `(100,-1.8,27.0182)`→`(100,0,29.0299)` dY=1.8/dZ=2.012；B(z=-26,bank=-1) dY=1.8/dZ=−2.012；C(不按键直置 z=27.4 纯阈值) dY=1.8/dZ=3.0；断言 `|Δz|<1 && |Δy|<0.2` 三例全 false | 正/负两岸 + 纯阈值对照互证，排除单机位巧合，符合「对照组必须同样可达」纪律 → 证据可采信。无产品取舍争议（单帧 1.8m 垂直跳变 + 无视 x 硬设 `p.z=±29` 是玩家可感知实现问题）。当前 `player.ts:394-397 p.z=bank*29` 与 `:418 p.y=target` **仍未修**（先前 sed 截断 388-394 曾误判为已修，读完整段 378-427 后纠正）。修法「上岸 clamp 到最近岸线并按 x 找干地 + `p.y` 台阶/插值抬升」纯 JS 局部，可进可改清单，须复测三例 |
| M-13 | **升级为确认缺陷**，且比原结论更严重（新增状态矛盾 + 相机打架） | before state=mount / mounted=骏马 / mountPos=(-230,0,46) / actorPos=(-521.27,0,71.61)；`teleport('fengdu')` returned=true；justAfter **state 仍 mount**、realmY=-257.5（地府）但 actorPos=(-230,1.5,46)（人间坐骑位）、camMode=fly、camY=-231.16；59 帧 distinctStates=['mount']、actorPosEnd 恒 (-230,1.5,46)、camY −231.16→…→4.46；断言「1 帧后 state==='foot'」失败。POIS.fengdu=(540,-258,85)（`world.ts:360`，UNDER.y=-260），teleport 写入 (540,-257.5,85) 后 1 帧被 mount 分支覆盖 | 与 E-02 S7 不冲突（S7 是默认 soul/foot 态），正是我原裁决点名「未测 mount/boat 态冲突」的补位。当前 `world.ts:1802-1826 teleport()` **无 `resetMotionState`、仍未修**（grep + 逐行核对确认，行号已从 1711 漂移到 1802）。修法须**追加**清 `state/mounted/boat/vy/realmY`，**绝不能删 `:1809-1810` 搬化身**（蓝队 B-03 证明它对目标链有效），并回归 E-02 S7（默认 foot 态传送无 NaN/跳变，追加清理不应改 foot 态行为）。按当前 git diff 定位行号 |

### 6.2 M-06 对齐确认（无需订正）
+80°(1.3963rad) → camY=-5.186 < ghAtCam=0；−80° 对照 camY=9.585（排除单向伪证）；offY=−sin80°×7.5=−7.386，expectedCamY=focusY(0)+offY+2.2=−5.186 与实测**逐位吻合**；deltaFromBase=−8.729。数学子项由静态推断升为**运行时硬证据**，与本文【维持确认】一致。「是否穿进具体建筑/坡面」未分层连拍 → **维持疑似 / 无法验证**，不升级。

### 6.3 M-07 描述订正（定性不变）
本文 §2.4 写「两套跨界传送并存」→ 订正为**三套写 `actor.pos` 的传送路径**：`usePortal` PORTALS（`player.ts:426-429`）/ `registerInteractions` E 点（`world.ts:1663-1670`）/ `world.teleport` POIS（`:1802-1826`）。定性仍【维持确认（代码事实）】，E-02 S7 不夸大现象，方向不变。

### 6.4 明确不翻案（motion-expert 已对齐，确认无冲突）
M-01（下调疑似 + 修法排期）、M-14（根因确认 + 影响面疑似，本轮未做 I6 位置哈希，接受维持）、附录 PLATFORMS（未做 AABB/环带采样，维持疑似）、§〇 已核通过表（接受剔除）、M-08/09/10（维持确认）。

### 6.5 基线漂移更新（重要，影响行号有效性）
- §五 记录的 10 个 M 文件是**收尾时快照**；本次复核时 `git status --short src/` 已增至 **16 个**：新增 `src/city/units.ts`、`src/game/player.ts`、`src/game/survival.ts`、`src/main.ts`、`src/rt/save.ts`、`src/style.css`。
- motion-expert 声明「player.ts 未改、四条核心分支仍 be0226e 原码」在它跑 A/B 时成立，但**当前已改**：`git diff --stat src/game/player.ts` = 16 insertions / 3 deletions（改动为 `:404-406` clamp 范围 ±20000、`:415-418` 新增人间平地跳跃积分 —— 修的是另一个「移动端跳跃 dy=0」缺陷、以及别处）。**M-11/M-12/M-13 的核心分支语义未变**（已逐行核对 `player.ts:394-397` / `:410-412` / `:421`、`world.ts:1802-1826`），故 A/B 数据对当前代码**仍然有效**，仅行号漂移：`390-393→394-397`、`406-408→410-412`、`417→421`、`1711-1736→1802-1826`。
- **结论：M-11/M-12/M-13 三条均未被批次 A 修复，仍需主线程动手**。本文其余 `file:line`（尤其 §四 可改清单里的 `world.ts:786/846/328`、`engine.ts:775`、`ui.ts:83/89`）在 16 个在途改动下须按当前 `git diff` 重新定位后使用。

### 6.6 对主线程改码清单的增量（据 §四）
- **可进批次 A（零几何增量、纯 JS）**：M-11 修法 (b)「干净禁跳」、M-12「上岸 clamp + 插值」、M-13「teleport 追加 `resetMotionState` 但保留搬化身」。M-12/M-13 改 `player.ts`/`world.ts`，须按当前 diff 定位 + 复测 motion-expert 三例 + 回归 E-02 S7。
- **排期**：M-11 修法 (a)「允许异界跳跃」改运动积分、M-06 穿建筑分层连拍、M-14 I6 位置哈希、附录 PLATFORMS AABB 采样。
- **不变**：V-04/05/08/09 几何增补、`RIDGE_HALF`、G-02 leaf 补 uv 等驳回项全部维持。

---

> 全文每条裁决均给 `file:line` 或 E-01…E-06 / `round1-motion-ab.md` 运行时数据支撑。**本轮未修改任何 `src/` 源码、未运行构建/测试**；唯一写入项为 `artifacts/round2-red-team.md`。§五 的并行改动为他人所为，§六 已更新漂移快照与复核清单。
