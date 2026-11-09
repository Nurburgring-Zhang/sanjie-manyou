# 第 1 轮全量代码审核 · UI / HUD / 输入映射 / 性能预算

> 领域：界面层、输入层、运行时性能预算。**不审**几何生成算法、玩法数值设计、事件总线内部实现、存档序列化（分别由 geom-expert / play-expert / core-expert / motion-expert 负责）。
> 基线：git HEAD `be0226e`；运行时实测 348 draw calls / 25,868,719 triangles / 450 InstancedMesh / 621 命名对象（台账 `VISUAL-AUDIT-20261107.md:18`，dev server `http://127.0.0.1:4182/`）。
> 打包态 CSP：vite 构建注入，`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:`（`vite.config.ts:14-16`，仅 `apply:'build'` L21 注入，**dev server 无 CSP**）。
> 纪律：**全程只读审核**；本文件为 team-lead 明确授权的审核产物（允许写），**未修改任何 `src/` 源码**、未运行构建/测试、未落盘脚本。
> 结论分类：【确认缺陷】= 代码可静态复核的事实；【疑似需运行时验证】= 影响/归因需浏览器实测；【设计取舍非缺陷】= 已合规或已知取舍。共 14 条：10 确认 / 3 疑似 / 1 正面。
> 本文档供第 2 轮对抗审查逐条证伪；所有结论给出 `file:line` 与条件表达式。

---

## 一、V-10 台账归因复核（结论先行）

台账 `VISUAL-AUDIT-20261107.md:50` 原文：「顶部常驻一条红色细横条（Boss 血条），右下竖排告示文字挤压重叠」「血条不在 `#ui` 层；右下告示为 3D 招牌」「⚠️ 未修：需定位 DOM 层」。

**复核结论：台账两句判断均成立，不应推翻；但「常驻」的根因比台账更具体，且 DOM 已精确定位。**

### 1.1 红色细横条：是谁创建的 DOM

| 项 | 证据 |
|---|---|
| 创建 | `src/game/boss.ts:221` `const wrap = document.createElement('div');` |
| 命名 | `src/game/boss.ts:222` `wrap.id = 'bossbar';` |
| 内联样式 | `src/game/boss.ts:223-224` `wrap.style.cssText = 'position:fixed;left:50%;top:66px;transform:translateX(-50%);width:min(520px,52vw);pointer-events:none;opacity:0;transition:opacity .3s;z-index:30;…'` |
| 红色细条构成 | `src/game/boss.ts:229` track `height:7px;background:rgba(10,12,18,.72)`；`src/game/boss.ts:231` fill `height:100%;width:100%;background:linear-gradient(90deg,#8a1f16,#ff6a3c)` |
| **挂载父节点** | **`src/game/boss.ts:235` `document.body.appendChild(wrap);` —— 是 `document.body`，不是 `#ui`** |
| 创建时机 | `src/game/boss.ts:73-74` 构造函数内 `this.mountHud(); this.syncHud();`；Boss 实例由 `src/world.ts:778-801` 在载入链「云起天宫」步构造，单次加载只构造一次 |
| 去重 | `src/game/boss.ts:220` `if (typeof document === 'undefined' || document.getElementById('bossbar')) return;` |
| CSS 侧 | **`src/style.css` 全文 160 行无 `#bossbar` 选择器**；样式 100% 靠上述 inline `cssText` |

**故「血条不在 `#ui` 层」成立。** 两个直接后果：
1. `src/ui/ui.ts:200` 拍照模式 `const root = document.getElementById('ui'); if (root) root.style.display = photoMode ? 'none' : '';` —— **只隐藏 `#ui`，不含 body 下的 `#bossbar`**，故 H 键隐藏全部 UI 后红条仍在（这就是「常驻」的层级根因）。
2. `#bossbar` 的 `z-index:30`（`boss.ts:224`）与 `#ui` 的 `z-index:10`（`style.css:13`）属**不同堆叠上下文**，`30 > 10` 使红条盖住顶栏、`#toast`、dock 等全部 `#ui` 元素；`#loading` z=100（`style.css:17`）仍在其上。

### 1.2 显隐条件表达式（原样，供第 2 轮核对）

`src/game/boss.ts:244-245`：
```ts
const active = !this.defeated && this.state !== 'idle';
this.bar.style.opacity = active || this.defeated ? '1' : '0';
```
化简：`opacity = (state !== 'idle' || defeated) ? '1' : '0'`。

- 构造期 `state = 'idle'`（`boss.ts:35`）、`defeated = false`（`boss.ts:36`），且 wrap 初始即 `opacity:0`（`boss.ts:224`）→ **默认隐藏；不是默认 visible；没有条件取反**；`syncHud()` 调用点仅 `boss.ts:74 / 136 / 149 / 167 / 174`。
- **但「非战斗未隐藏」成立**：见 §1.3 与 UI-02。
- 与合同偏差：`docs/重建-v2/spec/P1-8-UI布局矩阵.md:38` 规定 bossbar「top-center 下方 **420×28（仅 boss 战）**」；当前 `width:min(520px,52vw)`（`boss.ts:223`）比合同 420 宽，`top:66px` 与 `#toast`（`style.css:122` `top:88px`、水平居中）垂直仅差 22px；P1-8 §3 H2「HUD 互不重叠」白名单只豁免「bossbar vs 品牌条」。

### 1.3 「常驻」的两条代码根因（UI-01 + UI-02）

1. **层级**（UI-01）：挂 `document.body`、z=30，不受 `#ui` 显隐/面板开合/Esc 管控。
2. **状态机**（UI-02）：`boss.ts:169-216` 状态流转 `idle → engage → telegraph → active → engage …`，**全篇无任何 `this.state = 'idle'` 回赋值**；`boss.ts:155` `if (this.defeated) return;` 使击败后 `update` 不再调用 `syncHud`，`opacity` 锁死在最后一次 `active || defeated = 1`。
3. 台账探针是**单浏览器会话连拍 128 张**（`VISUAL-AUDIT-20261107.md:18` §一、`§六:133` 玩法状态含 `boss(J)` 与 HUD 总览）。只要其中任一机位（天宫 `jiangtai` / `lingxiao` 等）触发过 `engage`（`boss.ts:170-174`，玩家进 34m）或打过 Boss，红条即在**后续所有截图里常驻**——与「顶部常驻红色细横条」完全吻合，也解释了台账为何在多张图都看到。

### 1.4 右下竖排告示：DOM 还是 3D 招牌

- **「右下告示为 3D 招牌」在 DOM 侧成立**：`src/` 内无「右下竖排告示」DOM 节点；竖排文字来自 `src/city/bake.ts:1502`（`vertical?: boolean`）、`bake.ts:1546/1558` `SignAtlas.text()` 竖排逻辑（`if (st.vertical || (chars.length > 2 && W < H))`）+ `bake.ts:1570` `SignMesher.quad()` 合批四边形（调用例：`src/city/buildings.ts:1389/2035`、`src/city/architecture.ts:1171`）。属几何/贴图层，归 geom-expert（V-11 招牌镜像同一 kit）。
- **但右下角并非没有 DOM**：`#skip`（`style.css:127` `right:20px;bottom:90px`）、`#jumpbtn`（`style.css:147` `right:30px;bottom:130px`）、`#poiguide`（`src/game/poiGuide.ts:31` `z-index:60`、`:36-37` `white-space:pre-line` 多行 label、`:77-81` 屏缘 clamp 可落右下）都挂在 `#ui`（`z-index:10`）内、渲染于 `#app` 画布之上。若 3D 招牌投影同落右下角，会与这些 DOM **屏幕空间叠加**（DOM 在上）——这是「两者都有的重叠机制」，见 UI-13，标【疑似需运行时验证】。

### 1.5 UI-02 定性：锁定【确认缺陷】，不下调（与 play-expert P-05 会签）

我曾在 UI-02 留开放口「若玩法侧判定『不回 idle』为有意设计则下调为设计取舍」。**play-expert 已明确回复：不是有意设计，是确认缺陷**，其 P-05 与 UI-01/02 根因判断一致、不打架。故 **UI-02 定性锁定【确认缺陷】**。补强内证（play-expert 提供，均静态可复核）：

1. `boss.ts:164` `if (!this.defeated && d > this.spec.engageRange) this.outT += dt; else this.outT = 0;` + `boss.ts:165-168` 脱战 2.5s 后 `hp += maxHp * 0.04 * dt` 回血 → **数值层已把「离开 34m」当脱战处理并给回血代价，状态层却不认**，数值语义与状态语义自相矛盾，属遗漏而非取舍。
2. `boss.ts:188` `vfx.ring(...)`、`:189` `bus.emit('sfx:drum')`、`:204` `vfx.burst(...)` 在脱战后仍随 engage→telegraph→active 环空转，只因 `boss.ts:205` `if (d <= cfg.range) this.knockback(...)` 不触发击退 → 玩家回人间后天宫 Boss 仍按 `interval 3.2s/2.4s` 放空招、发音效。
3. `boss.ts:155` defeated 后 `update` 直接 return，`syncHud` 不再被调，`opacity` 锁死 1、label 停「已伏誅 0/320」→ 战果条常驻，与台账单会话连拍 128 张吻合。

**修法口径（玩法侧归 play-expert，UI 侧引用）**：
- 主推：`update` 脱战分支 `!defeated && d > spec.engageRange && outT > 2.5` 时补 `this.state = 'idle'; this.syncHud();`（一次性复位、幂等），同时停掉招式空转；`defeated` 后另给一次隐藏或延迟 3s 淡出。
- **次选不推荐**：只把 `syncHud` 的 `active` 改成 `!defeated && d <= spec.engageRange`——只治血条、不治状态与招式空转。
- UI-01 的最小修法（挂 `#ui` 内、z 收进 P1-8 的 20–29 带、宽对齐 420）与此并行、不冲突。

**第 2 轮合并建议（已与 play-expert 达成一致）**：把 play-expert **P-05（状态机）** + 本域 **UI-01（挂载层/层级）** + **UI-02（显隐表达式）** 合并为一条「Boss 血条常驻」联合结论，各自保留 `file:line`，避免对抗审查把同一现象拆成互相矛盾的两条分别证伪。

---

## 二、结论清单（14 条，按严重度排序）

### UI-01 【确认缺陷】V-10 血条脱离 `#ui` 管控、层级越顶
- **现象**：顶部红色细横条不受 H 键隐藏 UI、Esc、面板开合影响；拍照模式仍常驻；z=30 盖住顶栏 / `#toast`。
- **代码根因**：`boss.ts:221-235`（`createElement` → `id='bossbar'` → `document.body.appendChild(wrap)`）；`boss.ts:224`（`z-index:30`）；`ui.ts:200`（只 `getElementById('ui').style.display='none'`）；`style.css:13`（`#ui z-index:10`）；`style.css` 全文无 `#bossbar` 规则。
- **触发条件**：Boss 进入非 idle 态（见 UI-02）后的任意时刻；或按 H 进入拍照模式。
- **最小修法**：改挂 `document.getElementById('ui')`，或让显隐统一走 `#ui` 容器；z 收进 P1-8 的 20–29 上下文带；`width` 对齐合同 420。
- **性能影响**：Δdraw = 0、ΔT_static = 0（纯 DOM 层级）；仅一次挂载变更，主线程可忽略。
- **验收方式**：浏览器 DevTools → Elements 搜 `#bossbar`，看其父节点是 `body` 还是 `#ui`；按 H 后观察红条是否随顶栏一起消失；临时把 `#ui` 的 z 调到 40，看红条是否被压到顶栏之下。

### UI-02 【确认缺陷】Boss 状态机无回 idle 路径 → 血条激活后永久显示（台账「常驻」直接根因）
- **现象**：一旦靠近过擂台或击杀过 Boss，离开战斗、传送到人间、切换模式后红条仍在，整会话不去。
- **代码根因**：`boss.ts:244-245` 显隐只由 `state`/`defeated` 决定（表达式见 §1.2）；`boss.ts:169-216` 无任何 `state='idle'` 回赋值；`boss.ts:155` defeated 后 `update` 直接 return 不再调 `syncHud`；`syncHud` 仅 `boss.ts:74/136/149/167/174` 调用。补强：`boss.ts:164-168`（数值层脱战回血 vs 状态层不脱战）、`boss.ts:188-189/204-205`（脱战后招式空转）——见 §1.5。
- **触发条件**：相机/化身进 `engageRange`（34m，`boss.ts:170-174`）一次，或 J 击杀（`boss.ts:128-136`）一次；之后整个会话。
- **最小修法**：`update` 脱战分支 `!defeated && d > spec.engageRange && outT > 2.5` 补 `state='idle'` + `syncHud()`；defeated 后补一次隐藏/3s 淡出。**次选「只改 `syncHud.active`」不推荐**（治标不治本，招式仍空转）。
- **性能影响**：0（不新增渲染）；修复后减少一个常驻半透明层，并停掉脱战后的 `vfx.ring`/`vfx.burst`/`sfx:drum` 空转（这些是 CPU/VFX 侧，非 draw 预算）。
- **验收方式**：Console 读 `window.__qingming.world.boss.state` 与 `#bossbar` 的 computed `opacity`；从擂台执行 `world.teleport('sunyang')` 后等 5s，观察 `opacity` 是否回到 0、`boss.state` 是否回 `idle`；再按 J 击杀后观察红条是否延迟淡出。

### UI-03 【确认缺陷】失焦不清空按键集合 → 卡键
- **现象**：按住 W 切标签 / Alt+Tab 再回来，未松手相机仍持续前进。
- **代码根因**：`engine.ts:782` `window.addEventListener('keyup', (e) => this.keys.delete(e.code))` 只在 keyup 清理；`engine.ts:808-811` `window.addEventListener('blur', endDrag)` 中 `endDrag`（`engine.ts:808`）**只置 `dragOn=false`，没有 `this.keys.clear()`**；无 `visibilitychange` 处理。`D10 §1.3 T16` 与 `D10 §3.2` 明确要求「掉帧 >200ms 或失焦 → 清空输入缓冲」。
- **触发条件**：任意按键按住时窗口失焦（blur 后浏览器不向原窗口派发 keyup）。
- **最小修法**：`blur` / `visibilitychange(hidden)` 里 `this.keys.clear()` 并 `engine.touchMove.x = engine.touchMove.y = 0`。
- **性能影响**：0；属输入正确性。
- **验收方式**：按住 W 移动 → DevTools 切到别的面板再切回 → 不松 W，Console 读 `engine.keys` 是否仍含 `KeyW`、读 `engine.camera.position` 是否继续位移。

### UI-04 【确认缺陷】面板打开时按键穿透（menu 未吞移动键）
- **现象**：图鉴 / 设置 / 传送 / 商店面板开着时，WASD 仍驱动相机，J 仍出手，M/T/B 仍切面板。
- **代码根因**：`ui.ts:89-105` 全局快捷键、`ui.ts:83-87` KeyJ、`engine.ts:775` `this.keys.add(e.code)` 三层都在 `window` 上，**无一处检查 `.panel.show`**；`interact.ts:114` 商店面板 `p.className = 'panel show'` 同样不拦截。`D10 §1.3` 硬规则「overlay 必须显式声明是否吞移动键（menu 全吞）」未落地（T13「游戏继续跑」指世界更新，不等于玩家能推相机）。
- **触发条件**：按 B / T / F1 或点击 dock 打开任意 `.panel.show` 后按 WASD / J。
- **最小修法**：在统一 window keydown 入口加 `if (document.querySelector('.panel.show')) return`（相机键与快捷键），或把键位收进单一 router 的 context 栈。
- **性能影响**：0；但面板开着仍跑相机积分（`engine.ts:978 updateCamera`），白耗一帧逻辑。
- **验收方式**：按 T 开传送面板 → 按住 W，Console 读 `engine.camera.position` 是否变化；面板内按 J 观察 Boss `hp` 是否下降。

### UI-05 【确认缺陷】Escape 关不掉造物命令条（输入框 `stopPropagation` 反噬）
- **现象**：Y 打开许愿条、焦点在输入框时按 Esc 不关闭，只能提交或刷新。
- **代码根因**：`creation.ts:66-69` `input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') void this.submit(); })` 在**目标阶段**阻断冒泡，使注册在 `window` **冒泡阶段**的所有 keydown 都收不到——**包括 `creation.ts:61-64` 自身的 `Escape → this.close()`**；`ui.ts:98-99` 的 Esc 只 `document.querySelectorAll('.panel.show').forEach(el => el.classList.remove('show'))`，而 `#wishbar`（`creation.ts:45`）不带 `panel` class。
- **触发条件**：按 Y（`creation.ts:62` `!this.isOpen()` 时 `open()`）→ `creation.ts:75` `this.input?.focus()` → 焦点在 `#wish-input` → 按 Esc。
- **最小修法**：在 input 的 handler 内直接处理 `Escape`（`if (e.code==='Escape') this.close()`）；或把 window handler 改捕获阶段 / 用显式关闭替代 `stopPropagation` 兜底。
- **性能影响**：0。
- **验收方式**：浏览器按 Y → 输入任意文字 → 按 Esc，观察 `#wishbar` 的 `display` 是否变回 `none`；对照点击「造」提交（`creation.ts:136` `close()`）后能否关闭。

### UI-06 【确认缺陷】`preventDefault` 漏 + Tab 焦点不可见 + Space 双触发
- **现象**：焦点在 dock 按钮时按 Space 会同时触发按钮 click 与跳跃 / 飞行上升；F1 之外的快捷键无默认行为抑制；Tab 把焦点移到不可见按钮。
- **代码根因**：`engine.ts:775` keydown 对 WASD / Space / E / C / Q / Ctrl / Shift **无 `preventDefault`**（Space 是 `engine.ts:985` 飞行上升键、`player.ts` 跳跃键）；`ui.ts:95-104` 的 M / Esc / T / B、`ui.ts:197` 的 H 也无（**仅** `ui.ts:93` F1、`ui.ts:86` KeyJ 有）；`buildMode.ts:35-40` G / 1–8 无；Tab 无绑定也无 `preventDefault`；`style.css` 全文无 `:focus` / `:focus-visible` 规则，而 `style.css:14` `#ui * { pointer-events: auto; }` 让 dock 8 个 `.dock-btn` 可聚焦。`D10 §1.5 K13` 已登记此链。
- **触发条件**：Tab 或点击使 `document.activeElement` 落在 `.dock-btn` → 按 Space；或飞行模式按 Space（`body overflow:hidden` `style.css:10` 免滚动，但按钮 click 仍触发）。
- **最小修法**：按 `D10 §1.6` 在 router 单点集中 `preventDefault`；补 `:focus-visible { outline }`；Space / Tab 显式拦截。
- **性能影响**：0；属输入正确性。
- **验收方式**：Console 读 `document.activeElement` 观察 Tab 后焦点落在哪个按钮；聚焦后按 Space，看是否既弹面板又跳/上升；F1 是否被 `ui.ts:93` 拦住（作对照，应不弹浏览器帮助）。

### UI-07 【确认缺陷】keydown 多套并存、无单一归口
- **现象**：同一按键被多处 `window` 监听，冲突不可枚举（`D10 §6 A1` 判 BLOCK，要求运行时监听数 = 1）。
- **代码根因**：**至少 8 处** `window.addEventListener('keydown', ...)`：`engine.ts:775`、`ui.ts:83`(J) / `:89`(F1/M/Esc/T/B) / `:197`(H) / `:500`(音频 kick)、`buildMode.ts:35`、`creation.ts:61`、`player.ts:182`(V/E/F)。`D10 §6 A1` 判 BLOCK。各套口径也不一：`engine.ts:776` `keys.add(e.code)` 不检查焦点，而 `engine.ts:779-780` 仅 `KeyL` 分支做 `!e.repeat` 与 `!INPUT/TEXTAREA` 检查；`ui.ts:85/91` 对整段快捷键做 INPUT 检查。**已修复、不属本条**：`player.ts:185` `if (ev.repeat) return;` 已保护 V/E/F（`player.ts:186-188`，注释 L183-184「只认物理按下的第一次」），按住不翻转（初版曾误报「V 无 repeat 保护」，见 §四.1 误判剔除）；`engine.ts:469-523` `PointerInputRouter` 已收敛 pointer 单击（优先级 20/10/0）。本条只针对「键盘 keydown 监听归口分散」本身。
- **触发条件**：任意组合键（多套监听各自派发）。
- **最小修法**：按 `D10 §1.6 / §7.4` 建 `src/input/router.ts` 单一入口 + context 栈；收拢时**保留** `player.ts:185` 已有的 `ev.repeat` 过滤，并让其成为逐 binding 的统一声明。
- **性能影响**：Δdraw = 0、ΔT_static = 0；派发 3–8 次表查找 < 1µs（`D10 §1.6`）。
- **验收方式**：Console 打桩 `window.addEventListener` 统计 keydown 监听数（当前应 ≥ 8，远 > 1）；按住 V 作**对照**——观察 `#bAvatar` 文案 / 模式（`ui.ts:109-112`）**应不翻转**（`player.ts:185` 生效），若翻转才是缺陷。

### UI-08 【确认缺陷】`#infocard` 与 `#interact-prompt` 水平居中撞车
- **现象**：附身靠近交互点又点了英雄，两张卡叠在一起。
- **代码根因**：`style.css:100-104` `#infocard { left:50%; bottom:92px; transform:translateX(-50%); min-width:260px; … }`；`style.css:133-137` `#interact-prompt { left:50%; bottom:88px; transform:translateX(-50%); … }`；同锚、垂直仅差 4px。`D10 §4.1` 已登记「8 与 11 撞车」、`D10 §4.3 A8` 判 BLOCK（info × prompt 当前不允许）。
- **触发条件**：`ui.ts:344-349` `bus.on('hero:focus')` 弹卡（9s）与 `interact.ts:302-318` 最近交互点提示同时 `show`。
- **最小修法**：错开 `bottom`（如 prompt 上移 40px），或二者互斥显隐。
- **性能影响**：0。
- **验收方式**：附身走到商铺提示出现时点一名英雄，截屏看底部居中是否两张卡重叠；Console 读两元素 `getBoundingClientRect()` 求交面积。

### UI-09 【确认缺陷】`#goalchain` z=62 盖住交互面板正文
- **现象**：目标链浮在商店 / 赌坊面板之上，遮字。
- **代码根因**：`ui.ts:18` inline `z-index:62`；`interact.ts:115` 面板 `z-index:30`；两者同在 `#ui` 堆叠上下文内，`62 > 30`。`D10 §4.2` 分层表规定「导引与瞬时 50–69 不得覆盖面板正文 30–49」，`D10 §4.1` 已登记「5 的 z 62 高于任何面板」。
- **触发条件**：打开任意 `interact.makePanel`（`interact.ts:111-121`）面板时目标链常驻（`ui.ts:170-184` 每 0.4s `renderGoal()`）。
- **最小修法**：goalchain 收进 50–59 且面板用 `isolation` / 重排抬到其下，或面板打开时隐藏目标链。
- **性能影响**：0。
- **验收方式**：打开赌坊面板（`interact.ts:160`），读 `#goalchain` 与 `.panel.show` 的 computed `z-index`，观察面板文字是否被盖。

### UI-10 【确认缺陷】小地图 canvas 固定 216×150、无 DPR 处理
- **现象**：高 DPI（`devicePixelRatio ≥ 2`）屏上小地图、POI 点、10px 文字发糊。
- **代码根因**：`ui.ts:62` 硬编码 `<canvas width="216" height="150"></canvas>`；`ui.ts:357-358` 全部坐标按 `mm.width / mm.height` 算；`style.css:111-113` 仅 `display:block`，不缩放；全链路无 `devicePixelRatio`、无 `ctx.scale`。`D10 §2.6` 已否掉「减小画布像素是成本」，即补 DPR 不占预算。
- **触发条件**：DPR ≥ 2 显示器，或 `high` 档 `pixelRatio = 2`（`engine.ts:27`）。
- **最小修法**：`canvas.width = 216 * dpr; canvas.height = 150 * dpr;` 同时 `style.width/height` 保持 216/150px，并 `ctx.scale(dpr, dpr)`；`mx/mz` 与 `fillText` 坐标改用 CSS 像素。
- **性能影响**：画布像素 ×4（32,400 → 129,600），光栅成本仍远小于一次 DOM 布局（`D10 §2.6`）；Δdraw = 0。
- **验收方式**：DevTools 改 DPR 仿真，对比 `#minimap canvas` 的 `width` 属性与 CSS 显示宽；看 `ui.ts:403` `fillText('天宫战况：' + world.phaseName, 6, 12)` 的 10px 字是否清晰。

### UI-11 【疑似需运行时验证】主循环高频临时对象分配 → 是否致 GC 卡顿
- **现象**：稳态堆 1,950MB 下可能出现 major GC 尾帧（`D10 §2.5 H1`，文档自认未跑 `probe-frame-attrib`）。
- **代码根因（分配事实确凿；卡顿归因待验证）**：`player.ts:437-442` followCam 每帧 `new THREE.Vector3` ×4 + `clone()` ×2（约 6 对象/帧，附身模式每帧）；`ui.ts:389` `drawMinimap()` 每 0.25s 调 `world.heroEntries()`（`world.ts:1813-1819` `filter().map()` 新建约 165 对象）；`ui.ts:425` 每 0.5s 调 `world.liveCount()`（`world.ts:1821-1823` 全量 `filter` 约 4,495 元素）；`poiGuide.ts:64` 每 8 帧 `best.pos.clone().project(camera)`。`D10 §2.6 S-B/S-C/S-D`、`D10 §2.5` 明言「H1 未证实，削减项可能一条都不解决问题」。
- **触发条件**：长时间游玩、附身模式、堆接近稳态上限。
- **最小修法**：followCam 复用模块级 tmp（`engine.ts:446-449` CAM_TMP1-4 已有范式）；小地图静态底图离屏化、英雄点增量更新；`#stats` 拆 span + 值不变不写。
- **性能影响**：`D10 §2.8` 给 UI 段 ≤1ms、JS 段 ≤6.3ms；若 H1 成立则可削尾帧，若不成立收益 ≈ 0。**不夸大，不定性为性能缺陷**。
- **验收方式**：`?slow=1` 或 Electron `--enable-precise-memory-info`，采集 `performance.memory.usedJSHeapSize` 与 `engine.frameMs`，看「堆降 >20MB」的帧是否 ≥50ms；`MutationObserver` 挂 `#interact-prompt` / `#stats`，静止 60s 看 childList 变更数（`D10 A4` 阈值 ≤10）。

### UI-12 【疑似需运行时验证】`innerHTML` 拼接 + `unsafe-inline` 的 XSS 注入面
- **现象**：打包态 `script-src 'self' 'unsafe-inline'`（`vite.config.ts:15`）下，若动态字符串被污染，`innerHTML` 注入的内联事件处理器可执行；`connect-src 'none'` 只阻数据外传、不阻本地执行。
- **代码根因**：拼接点 `ui.ts:259`（`codexLog` 的 `e.name/e.note`）、`ui.ts:270`(JOBS)、`ui.ts:282`(heroEntries)、`ui.ts:346`(infocard)、`ui.ts:425`(stats / `playerWeapon.label`)、`interact.ts:116/128/195`。**经查当前数据源均为内部常量**：`codexLog.note` 来自 `world.ts:787` / `world.ts:1791` 常量拼接，`playerWeapon.label = '伏魔锏'`（`world.ts:795`），三币是 `parseInt` 数值（`interact.ts:32-34`），toast / ticker 用 `textContent`（`ui.ts:352` / `ui.ts:414`，安全）。`vite.config.ts:11-12` 自认 `unsafe-inline` 为「残余风险记账：需先存在 HTML 注入点才可利用」。另：CSP meta 只在 `apply:'build'`（`vite.config.ts:21`）注入，**dev server 4182 无 CSP**，台账运行时实测不覆盖打包态。
- **触发条件**：需先存在外部 / 存档字符串回流到上述字段（当前未发现）。
- **最小修法**：动态字段一律 `textContent`；构建期移除内联段改 hash；`codexLog` 若将来反序列化存档，先转义。存档反序列化路径归 core-expert，此处仅登记注入面。
- **性能影响**：0；安全纵深。
- **验收方式**：对 `release-*` 的 `file://` 页面（非 dev）查 `<meta http-equiv="Content-Security-Policy">` 是否存在；本地篡改 `localStorage` 三币为字符串后重载，看图鉴 `renderCodex`（`ui.ts:246-287`）是否把内容当 HTML 解析（应为纯文本）。

### UI-13 【疑似需运行时验证】右下角 3D 招牌 × DOM 叠加、窄视口顶栏溢出
- **现象**：右下竖排文字「挤压重叠」可能既有 3D 招牌又有 DOM 覆盖；窄屏顶栏元素可能挤出。
- **机制分离（与 geom-expert G-06 会签；下列 `bake.ts` 行号由 geom-expert 逐行核过并对可复核性负责，本域未独立复核）**：右下「挤压重叠」有**两种互不等价**的机制（① 几何层、② 屏幕空间层）；另有**一个不同因、须单列**的邻近现象 ③ 图集覆写。三者各自独立判定，**任一条被证伪不连带处置其余**；第 2 轮若证伪 G-06，只处置几何层 ①，不判掉本条 ② 的屏幕空间观察点：① **几何层**（归 geom-expert G-06，已确认）：`bake.ts:1580-1589` `SignMesher.quad()` 对每块招牌生成正反两个**共面** quad（L1587 正面 + L1588 背面，经 L1594/1602 `applyMatrix4` 后重合），`bake.ts:1591-1606` `quadSide()` 背面 UV 镜像（V-11 同源），材质 `side:DoubleSide` + `transparent:true` 却未设 `depthWrite:false`（`bake.ts:1613`）→ 半透明同深度 z-fighting，文字读成重影 / 发虚。geom-expert 另抽查 `buildings.ts:1389/2035` 两处竖排调用，cell 与 quad 宽高比匹配、`step=min(px*1.18,(H-12)/chars.length)`（`bake.ts:1559`）均小于上限，**单块 cell 内部不挤压**，故「挤压」不是 atlas 排版参数错。② **屏幕空间层**（本条，【疑似需运行时验证】）：右下 DOM 与 3D 招牌投影叠加。③ **图集覆写（不同因，单列）**：`bake.ts:1512` 注释（SIZE=5120 时 `overflowCount=1`）+ `bake.ts:1529-1533` 静默覆写复用 cell → 表现为「匾额错字 / 白板」，**不是「挤压重叠」**，归 geom-expert，本条只记录为独立观察点、不判缺陷。
- **代码根因**：右下常驻/条件 DOM 为 `#skip`（`style.css:127`）、`#jumpbtn`（`style.css:147`）、`#poiguide`（`poiGuide.ts:31/77-81` 屏缘 clamp，z=60、多行 `white-space:pre-line`），均在 `#ui`(z=10) 内、渲染于 `#app` 画布之上；3D 竖排招牌是 `SignMesher.quad` 合批几何（在画布内），二者投影同落右下即屏幕空间叠加。**顶栏**：`ui.ts:114-122` / `ui.ts:156-161` 把 `coinsEl` / `triEl` / `timeBadge` 三个元素 append 进 `#topbar`（`style.css:32-34` `padding: 10px 260px 10px 16px` 右留 260px 给 minimap），`@media (max-width:720px)`（`style.css:154-159`）只 `display:none` 了 `#ticker`（L158），未处理这三个常驻元素。
- **触发条件**：`#poiguide` clamp 到右下 + 3D 招牌同屏；或视口 ≤720px 且三币 / 时辰徽标文本变长。
- **最小修法**：poiguide clamp 右下时避让 / 隐藏；720 档给 topbar 追加元素设 `overflow` / 换行；`getBoundingClientRect` 两两求交（`D10 §4.3`）。几何层 z-fighting 的修法归 geom-expert G-06，不在本条。
- **性能影响**：0（布局层）。几何层若加 `depthWrite:false` 亦不增 draw / tri。
- **验收方式**：按 geom-expert 建议的**分离序列**，各步独立判定、不合并证伪：① 隐藏 `signs` mesh 连拍 → 重叠消失则属几何层 G-06（z-fighting）；② 逐面枚举 `signs` mesh 的 quad 数 / 世界坐标（对应 ① 的 quad 密度）；②b **单列**：读运行时 `atlas.overflowCount`，应 = 0；若 > 0 则是「匾额错字 / 白板」（`bake.ts:1512` 注释、`bake.ts:1529-1533` 静默覆写），**与「挤压重叠」不同因**，单独记录、不与 ① 的 z-fighting 混成一条被一起证伪；③ 单独隐藏 `#ui` 连拍 → 右下仍清晰则坐实 3D 招牌，变干净则是 HUD 叠加（本条 ②）。再叠加本条：窗口缩到 1280×720 与 720 宽，截右下角看竖排文字与 `#poiguide` / `#skip` 是否叠字；DevTools 读 `#topbar` 各子元素 rect 是否超出右边界（`W-230` 安全区，`D10 §4.2`）。③、②b 及图集覆写均**不写成确认缺陷**，避免被证伪。

### UI-14 【设计取舍非缺陷 / 正面确认】被问到但**不成立**的几项（无缺陷可修）
- **现象**：核查任务点名怀疑的 6 项，经读码确认均不成立或属已合规设计。
- **代码根因**：
  - 「HUD 每帧重设 `innerHTML`/`textContent` 造成布局抖动」→ **不成立**：`ui.ts:410-435` 已节流 —— `statT = 0.5s`（L418 → `statsEl.innerHTML` L425）、`mmT = 0.25s`（L428 → `drawMinimap()`）、`goalT = 0.4s`（L433 → `renderGoal()`）；ticker 7.5s/条（`ui.ts:414` `textContent`）、toast / hero 卡用 `textContent` + timer（`ui.ts:352`、`ui.ts:344-349`）。非每帧。
  - 「小地图每帧全量重绘」→ **不成立**：4Hz 全量 `clearRect` + 重绘（`ui.ts:361`、`ui.ts:428`），非每帧；但确有 4Hz 遍历 POIS + `heroEntries()`（已登记 UI-11）。
  - 「`renderer.info` 是否被重置」→ **已规范重置**：`engine.ts:581` `renderer.info.autoReset = false` + `engine.ts:919` 每帧 `this.renderer.info.reset()`（在 `engine.ts:926` `composer.render()` 之前），`drawCalls` / `tris` 取 `engine.ts:930-931`，不累积；`D10 §2.6` 明确「读取不是成本，删它换不来一帧」。台账 348 / 25.87M 即此口径（含后处理多 pass）。
  - 「每帧遍历全场景 / 高频 `new Color|Vector3|Box3`」→ **已做复用**：`world.ts:5-204` 光照临时对象是模块级常量，`applyLighting`（`world.ts:1122-1177`，L1130-1173）用 `copy/set/lerp` 复用 `_sunDir` / `_white`，无每帧 new；`engine.ts:446-449` CAM_TMP1-4、`engine.ts:158-163` LodManager 临时向量均模块级复用；`infill.ts` 逐实例写色复用 `Color`（`D7 §1.5` 已核，不报）。每帧遍历仅限 `lod.update`（`engine.ts:916` → `engine.ts:289` 遍历 LOD 组）与 `interact.update`（`interact.ts:311` 遍历交互点），**不是 621 对象全场景遍历**。
  - 「InstancedMesh 每帧更新」→ 450 个（台账）绝大多数静态烘焙、一次写 matrix；仅 `lod_impostor`（`engine.ts:408-416`，`instanceMatrix.needsUpdate` 条件性 `engine.ts:337`）与云池（`world.ts:1371-1372`）按帧/按档更新，属设计。
  - 「loading 遮罩关闭时机」→ 合理：`main.ts:74` `engine.start()` 后 `main.ts:77` 350ms 加 `.done`（`style.css:19-20` 1.2s 淡出）、`main.ts:78` 1800ms `remove()`；`#loading` z=100（`style.css:17`）覆盖 bossbar(z30)。失败路径 `main.ts:89-94` 只改 tip、不移除遮罩，属容错取舍（core 领域）。
  - 「隔帧阴影导致 draw 抖动」→ 非缺陷：`engine.ts:923-924` 隔帧 `needsUpdate`，奇偶帧差 222（`D7 §0.3`）；`D7 §0.3` 纪律：**任何 <222 的 Δdraw 断言不锁 parity 不可判**。`engine.ts:890-892` `frameMs.shift()` 写两遍是死代码（第二次 `600 > 600` 为假），窗口仍 600 帧 —— `D10 §2.4③` 已订正 `D7 §0.3` 的「599 帧」说法，两者均不影响结论。
- **触发条件**：无（这些是「不修」的确认项）。
- **最小修法**：无需修改。若第 2 轮要动，只允许「不新增每帧分配」的前提下改，且须先跑 `D10 §2.5` 的 `probe-frame-attrib` 证明收益。
- **性能影响**：0；上述路径均已在预算内（UI 段 ≤1ms / JS 段 ≤6.3ms，`D10 §2.8`）。
- **验收方式**：Console 每帧采样 `engine.drawCalls` 与 `__perf()`（`main.ts:85`），确认数值不累积、奇偶帧交替差 ≈222；`Performance` 面板录制 10s，确认无每帧 `innerHTML` 写入（DOM breakpoint 不打点）。

---

## 三、性能预算表（供后续修复决策）

**口径纪律（`D7 §0.2 / §0.3`）**：`T_static`（烘焙总量）/ `T_scene`（单份几何）/ `T_frame`（含实例展开 + 多 pass）三口径**不可互相换算、不可相减作阈值**；谈面数必须带「机位 + parity」。P0 机位 = `verify-packaged.mjs` 出生点、high、加载后 3s、只采阴影帧（`shadowTick & 1 === 0`）3 次中位。

### 3.1 基线

| 基线项 | 值 | 来源 |
|---|---:|---|
| P0 calls（阴影帧） | **372** | `D7 §1.4` |
| P0 tris / T_frame | **45,923,185** | `D7 §0.3 / §4` |
| T_static（烘焙，14 组合批） | 18,959,342 | `D7 §0.2` |
| T_scene（单份几何） | 19,873,969 | `D7 §0.2` |
| draw 预算天花板 | **600** | `D7 §1.4` |
| 可用增量 | **228** | 600 − 372 |
| 阴影奇偶帧差 | 222 | `D7 §0.3`（Δ < 222 不可判） |
| 常驻 / 稳态 / 峰值堆 | 1,742.7 / 1,950 / 2,615 MB | `D7 §0.4` |

> **⚠️ 台账实测 348 calls / 25,868,719 tris 与 P0 372 / 45.92M 是不同机位、不同 parity、不同 LOD 落档**，差 24 calls / 20M tris 主要来自机位与阴影帧奇偶，**不是「性能改善」，不可当修复成果记**（`D7 §0.3`）。且台账用 dev server，`D7 §5` 要求 draw/面数断言必须在打包态 `file://` 跑（dev 有 HMR 会重建场景）。

### 3.2 按系统分解（估算与允许增量上限）

| 系统 | draw calls 估算 | triangles 估算 | 允许增量上限 | 依据 / 备注 |
|---|---:|---:|---|---|
| 烘焙静态几何（Baker 14 组合批） | ~300–340（348 主体） | T_static 18.96M | **+0** | `D7 §3.1`「面数不变 / 构件不变 / 实例不变」硬约束（容差 0）；V-04/05/08/09 加建筑属内容变更，须另裁定 |
| 实例展开 infill（1,011,881 instances） | 不增 draw（1 call/批） | T_frame 主要放大来源 | **+0** | `D10 §0.2`；逐实例写色已复用 `Color`（`D7 §1.5`） |
| 阴影 pass（隔帧） | 奇偶帧 ±222 | 阴影帧 ×2 | **+0** | `D7 §3.5` 明确否掉「关阴影 / 降 shadowSize」 |
| 后处理 4 pass（Render / Bloom / Grade / Output） | 计入 composer 总 calls | — | **+0** | `engine.ts:636-653`；Δ 需锁 parity |
| LOD impostor（1 个 InstancedMesh 覆盖全城） | 1 | 剪影卡可忽略 | **+0** | `engine.ts:386-417` |
| **HUD / 输入 / DOM 层（本次全部 14 条）** | **0** | **0** | **0** | `D10 §0.1 / §7.4`：路由与 UI Δdraw = 0、ΔT_static = 0；修复只影响主线程 JS 段（`D10 §2.8` UI ≤1ms / JS ≤6.3ms） |
| 运行时造物 CreationSystem | +1/件（阴影帧 +2） | ≤20,000/件（MAX_TRIS `creation.ts:14`） | **+24**（24 只上限） | `D7 §2.1 / §4.2`；单件 ΔT_frame ≤0.05% |
| 玩家建筑 | +1/座 | 1,608/座 | **≤162**（建议 `E_BUILD_LIMIT 160`） | `D7 §4.4` 联合上界 |
| 体素沙盒 | +14/块（满配 +42） | 22,582 quad/块 | **≤3 块可见** | `D7 §4.1 / §4.2` |
| **联合上界** | `372 + 24 + N + 14·S ≤ 600` → `N ≤ 204 − 14S` | 表 B 最坏 +1,823,976（+3.97%） | 600 顶格 | `D7 §4.4`；S=3 时 N ≤ 162 |

**给修复决策的一句话**：本次 UI / 输入层 14 条结论**不消耗任何 draw / tri 预算**（Δdraw = 0、ΔT_static = 0），可优先修；唯一需要进预算账的是若采纳 `D10 §2.2` 的 pending 预览层（+5 draw，占 228 的 2.2%，U2 未决）。真正吃预算的是 V-04 / V-05 / V-08 / V-09 的建模补面（几何层，归 geom-expert），须走 `D7 §3.1`「先算 Δ 再谈」与「六项保真度零容差」。

---

## 四、自查边界（防止第 2 轮误判）

1. `D9 / D10 / P1-8 / D7` 均为**历史基线文档**（行号基线 `806fa79` v93 + v96 未提交改动），其中「移动端无跳跃键」「单击触发三件事」「HUD 每帧写 DOM」等结论**已被当前 `be0226e` 代码修复**：`ui.ts:67` 已创建 `<button id="jumpbtn">`、`ui.ts:462-466` 已绑定 `pointerdown → world.player?.jump()`；`engine.ts:469-523` `PointerInputRouter` 已收敛单击（优先级 20 > 出拳 10 > 指针锁定兜底）；`interact.ts:294-299` `setPrompt` 已做「文本相同不写 DOM」缓存。**本报告一律以当前代码为准，未照抄文档历史结论。**

   **⚠️ 本轮误判剔除（留档，防再犯）**：初版 UI-07 曾写「`player.ts` V 键无 `e.repeat` 保护、按住会以系统重复率反复 `toggleMode()`」，系照抄 `D10 §1.1` 的历史基线（`806fa79` v93）。经 motion-expert 指证 + 复读 `player.ts:182-189` 确认：`player.ts:185` `if (ev.repeat) return;` 已保护 V/E/F（L183-184 注释「只认物理按下的第一次」），**当前 `be0226e` 已修**。该子论断已删除，UI-07 仅保留「多套 keydown 无单一归口」这一仍成立的核心缺陷，监听计数由 7 更正为 8（补 `player.ts:182`），并按已修复事实改写触发条件 / 修法 / 验收方式。此处正是 §四.1 自我警告「勿照抄文档历史结论」所防的坑，本轮自查踩中并已主动更正，不待第 2 轮证伪。
2. 所有 14 条均给出 `file:line`；【确认缺陷】均为代码可静态复核的事实；「是否致 GC 卡顿 / 是否致 XSS / 是否屏幕叠加」三类**影响**明确标【疑似需运行时验证】并给出浏览器观察点，**不凭猜测报缺陷**。
3. UI-02 定性经 play-expert P-05 会签锁定【确认缺陷】，不下调；第 2 轮建议与 P-05 / UI-01 合并为一条「Boss 血条常驻」联合结论（见 §1.5）。
4. 与领域边界：几何/贴图层（含 3D 招牌 quad、V-11 镜像）→ geom-expert；角色/运动/物理（含 `player.ts` followCam 算法）→ motion-expert；玩法数值（含 Boss 状态机收口口径）→ play-expert；存档序列化 / 事件总线内部 / 状态机底层（含 `codexLog` 反序列化注入面）→ core-expert。本报告仅登记跨界处，不越界定性。
5. 全程未修改任何 `src/` 源码、未运行构建或测试、未落盘脚本；本文件是唯一写入项（team-lead 授权的审核产物）。
6. **跨文件互参边界（与 geom-expert 会签，供 red-team / blue-team）**：`artifacts/round1-geom.md` 的 **G-06 只对应 UI-13 机制 ①**（几何层 `bake.ts:1580-1589` 双 quad 共面 + `bake.ts:1613` z-fighting，与 V-11 同 kit）；**② 屏幕空间 DOM 叠加、③ `SignAtlas` 图集覆写均不在 geom-expert 的 10 条编号内**，其未对二者判缺陷、也未写入误判风险。因此第 2 轮对 G-06 的证伪结论**只应回写机制 ①**，不构成对 UI-13 ②③ 的处置依据（与本文件「三者各自独立判定、任一条被证伪不连带处置其余」一致）。geom-expert 的 `round1-geom.md` 已定稿、后续不再改动以避免版本漂移；互参口径以本条为准。**本文件为最终版**（14 条 / 10 确认 · 3 疑似 · 1 正面），后续不再改动。
