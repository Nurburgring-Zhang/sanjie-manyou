# 第 1 轮 · 运动侧运行时 A/B 实证 + 红队裁决答辩（motion-expert）

> 角色：**被审方答辩人 + 运行时实证官**（team-lead 改派；#7 蓝队由全新专家 blue-team 承担，本文件不认领、不介入）。
> 输入：`artifacts/round1-motion.md`（我方 14 条）、`artifacts/round1-runtime-evidence.md`（主线程 E-01…E-06）、`artifacts/round2-red-team.md`（红队 §2.4 逐条裁决）。
> 产物：本文件唯一授权写入的审核产物；临时探针与原始数据在 `.gitignore` 排除路径内（见 §六）。
> **v2 修订（core-expert 交叉证据到位后）**：新增 §2.2，把 M-14 影响面由「接受疑似」订正为「交叉引证、支持升级」，并同步 §2.1 第 1/6 条、§三 第 6 条、§四 M-14 行。§一 四条 A/B 结论与数值**不变**；新增内容严格标注为 core-expert 独立采集、归其 C06、不重复计数。

---

## 〇、基线口径与纪律声明（请主线程裁决时先读）

1. **全程只读 `src/`**：未修改任何源码、未运行 `npm test` / `tsc` / `vite` / 构建。仅通过 `window.__qingming`（`engine / world / scene / THREE`）读状态、注入按键与相机参数，用 Puppeteer 逐帧 `requestAnimationFrame` 采样。
2. **运行时环境**：dev server `http://127.0.0.1:4182/`（返回 200）、headless Chromium/Edge 1280×720、`--enable-unsafe-swiftshader`、禁用后台节流；每个用例**全新 page**，排除状态污染；四组 `pageerror` / console error 均为 `[]`。
3. **⚠️ 基线口径（不夸大，须明示，v3 已按时点订正）**：
   - **取证时点**：跑 A/B 时 `git status` 显示 **13 个 `src/` 文件已修改未提交**（`river.ts / engine.ts / boss.ts / buildMode.ts / creation.ts / interact.ts / survival.ts / main.ts / save.ts / underworld.ts / ui.ts / world.ts / terrain.ts`），4182 服务的是**当前工作区**而非纯 `be0226e`。当时 `git status --short src/game/player.ts` 为空，故 v1 写「`player.ts` 未被修改、四条核心分支仍是 `be0226e` 原码」——**该表述只对取证时点成立**。
   - **复核时点（v3 订正）**：批次 A 后续落地使 `src/game/player.ts` 已改（`git diff --stat` = **16 insertions / 3 deletions**），工作区 M 文件增至 **16 个**（red-team §6.5）。我方复核 `git diff -- src/game/player.ts` 的实际内容为 **M-02 `portalPending` 防重入 + `:428` PORTALS 循环加 `if(!busy)` + `:451` usePortal 双保险 + B-07 删 `cam:mode='avatar'` emit**（均不触碰四条核心分支）。⚠️ 与 red-team §6.5 描述的「`:404-406` clamp ±20000、`:415-418` 新增人间平地跳跃积分」**锚点描述有偏差**——按我方 `sed -n '390,422p'` 核对，clamp 与跳跃积分是**既有代码**（v1 引用的 `player.ts:410-414` 已含 `if (p.y > target + 0.05 || this.vy > 0)` 积分），仅随上方 `portalPending` 等插入而**行号漂移**，非本轮新增。此为「两个时点/两种读法」的差异，**不影响下述结论**，已如实留痕并同步 red-team。
   - **对我方数据的有效性（关键）**：四条核心分支——M-06 `followCam`、M-11 `realmY` 硬钳（`p.y=realmY; vy=0`）+ 起跳、M-12 swim→foot `p.z=bank*29` + `p.y=target`、M-13 `teleport` 不清 `state/mounted/boat/vy/realmY`——**语义逐行未变、均未被批次 A 修复**（red-team §6.5/§6.1 逐行核对，与我方复核一致），故 §一 四组运行时数据**对当前代码仍然有效**，仅 `file:line` 漂移。行号映射以 red-team §6.5 为准：`390-393→394-397`、`406-408→410-412`、`417→421`、`world.ts:1711-1736→1802-1826`；本文件正文仍沿用审核基线 `be0226e` 编号（与 `round1-motion.md` / red-team 裁决一致），主线程落地前须按当前 `git diff` 重新定位。
   - 若主线程要求严格对齐纯 `be0226e`，**应在纯 HEAD 干净副本上复跑 §五 四条断言**。⚠️ **不可拿旧 JSON 直接对当前 dev server 做「改码前后对照」**：#17 已改 `engine.ts` / `units.ts`（fix-motion 06:xx 落地），旧基线取自 #17 之前，直接比对会混入 #17 差分；须在干净副本重放基线再比现值（此提醒采纳自 fix-motion，见 §2.4）。本文件不对任何在途改动作评价。
4. **S2 不混淆**：`round1-runtime-evidence.md:29` 的 S2 证明 **fly 模式 Space 是「上升键」**（`engine.ts:985`，`state` 恒 `foot`、`vy` 恒 0、`cam.y 17.5→52.6` 停在高处）。M-11 测的是 **avatar 模式下异界跳跃**，两者是不同路径；本文件所有 M-11 用例先 `stopCinema()` + `toggleMode()` 进入 avatar，再按 `Space`。
5. **标记口径**：§一 用【已证实】【已证伪】【无法验证】；§二 用 team-lead 指定的「维持 / 接受下调 / 补充证据」；红队五类标记（维持确认 / 下调为疑似 / 剔除：误判 / 剔除：设计取舍 / 修法需修正）原样引用，不改写。

---

## 一、运行时 A/B 实证（team-lead 优先指定的 4 条）

> 探针：`scripts/_motion_ab_00_probe.mjs`（环境探测）、`_motion_ab_01_cases.mjs`（M-06/M-11/M-12 首测/M-13）、`_motion_ab_02_m12.mjs`（M-12 补测）。原始数据：`artifacts/_motion_ab_raw.json`、`artifacts/_motion_ab_m12_raw.json`。

### M-06【已证实】附身 `camPitch=+80°` 时 `camera.y < 地面`

- **断言**（`round1-motion.md:99`）：`engine.camera.position.y >= player.groundHeight(camera.x, camera.z, camera.y)`，当前 `< 0`。
- **A/B 设计**：同一 avatar 页内三点取样，基线 `camPitch=-0.18` → 热态 `+80°(1.3963rad)` → 冷态 `-80°`（负俯仰对照组，用于排除「任何 pitch 变化都会压低相机」的伪证）。地面用**相机自身 x/z** 采样（`ghAtCam`），避免误用 `groundHeight(0,0,0)=9.1` 的街面偏移。
- **实测**（`_motion_ab_raw.json` M-06）：

  | 条件 | `camPitch` | `camY` | `ghAtCam` | 结论 |
  |---|---|---|---|---|
  | 基线 | `-0.18` | `3.543` | `0` | 相机在地面之上 |
  | **热态 +80°** | `1.3963` | **`-5.186`** | `0` | **`-5.186 < 0`，钻地** |
  | 冷态 −80° | `-1.3963` | `9.585` | `0` | 对照组抬高到 `+9.585`，非单向伪证 |

- **公式吻合**：`offY = -sin(80°)*7.5 = -7.386`，`expectedCamY = focusY(0) + offY + 2.2 = -5.186`，与实测 `camY=-5.186` **逐位吻合**；`deltaFromBase = -8.729`。即 `followCam`（`src/game/player.ts:435-443`）把相机直接 `lerp` 到 `focus + off + (0,2.2,0)`、`avatarLookDrag`（`:208-212`）只 clamp `±PITCH_LIMIT`（`engine.ts:21` = 85°）不约束高度，数学子项由静态推断升级为**运行时硬证据**。
- **【无法验证】子项保留**：「是否穿进具体建筑 / 坡面」需沿 `+85°` 做地形剖面分层连拍（隐藏 `terrain` / `city_*`），本轮未做，不升级、不夸大；`ghAtCam=0` 只证明在该机位 x/z 处地表为 0。
- **确定性与页面错误**：`errs=[]`；不影响 determinism。

### M-11【已证实】异界按 `Space` 逐帧 `p.y` 峰值被钉在 `realmY+0.05`

- **断言**（`round1-motion.md:155`）：地府附身按 Space 逐帧采样 `p.y`，断言峰值 `> realmY + 0.3`；当前恒 `= realmY`。
- **A/B 设计**：**人间对照组 `landAt(0,0,100)`（`realmY=null`）** 证明 Space 键与焦点确实生效（E-06 §2「对照组必须同样可达」）；异界组 `landAt(0,-260,-130)`（`realmY=-260`）。两组各按 `Space` 700ms，rAF 逐帧采 `y / vy / state / realmY`。
- **实测**（`_motion_ab_raw.json` M-11）：

  | 组 | frames | `baseY` | `realmY` | `peakY` | `maxRise` | `maxVy` | `distinctY` |
  |---|---|---|---|---|---|---|---|
  | 人间对照 | 104 | `0` | `null` | **`1.284`** | **`1.284`** | `7.5` | `0, 0.05, 0.413, 0.4636, 0.5116, …`（连续上升） |
  | 异界 | 121 | `-260` | `-260` | **`-259.95`** | **`0.05`** | `7.5` | **仅 `[-260, -259.95]`** |

- **判读**：两组 `maxVy` 都到 `7.5`，证明 `:417` `this.vy = 7.5; p.y += 0.05` 起跳分支**确实进入**；异界组逐帧 `y` 只有两个值、`state` 恒 `foot`，证明 `foot` 分支 `src/game/player.ts:406-408` `if (this.realmY !== null) { p.y = this.realmY; this.vy = 0; }` 在下一帧把位置钉回平面、`vy` 清零。`riseRatio = 0.05 / 1.284 = 0.039`；`jumpSwallowedInYijie = true`（`maxRise 0.05 ≤ 0.3`）。与我方原文「只有一帧 0.05m 抖动」**逐字吻合**。
- **定性边界（不越权）**：红队 §2.4 维持疑似的理由是「异界是否本就不该跳属产品取舍」——**这一点我方不反驳**。本条【已证实】只针对**现象**（跳跃被吞、峰值 `realmY+0.05`）；「是否算缺陷 / 是否该修」仍由主线程按产品取舍裁决。见 §三。

### M-12【已证实】游泳上岸单帧 `Δp.z ≈ 2~3m`、`Δp.y = 1.8m`

- **断言**（`round1-motion.md:166`）：从河心游到 `z=27` 逐帧采样，断言单帧 `|Δp.z| < 1 && |Δp.y| < 0.2`；当前 `p.z → 29`、`p.y` 跳 1.8。
- **首测【无法验证】及方法学留档（不隐瞒）**：`_motion_ab_01_cases.mjs` 首测设 `camYaw=0` 按 `KeyW`，163 帧全程 `state='swim'`、`z: 26 → 22.9668`、`transitions=[]`、`maxSingleFrameDY=0`、`maxSingleFrameDZ=0.044`。原因经复核 `src/game/player.ts:287` `if (k.has('KeyW')) iz -= 1;`、`:382` `mz = -Math.cos(camYaw)*(-iz) - Math.sin(camYaw)*ix`，`camYaw=0` 时 `mz = iz = -1` → **W 朝 −z**，与预期「游向 `|z|>27` 的 +z 岸」相反，未越过 `:372` `inCityRiver = Math.abs(p.z) < 27 && …` 阈值，故 `swimming` 未翻转、上岸分支未触发。这是**探针方向设置错误，不是缺陷被证伪**；按 E-06 §5 补测而非据此下结论。
- **补测设计**（`_motion_ab_02_m12.mjs`，三个子用例全部 `errs=[]`）：
  - **A**：`camYaw=π`（`mz=cos(π)*iz=+1`，W 朝 +z），`z=26` 真游出 +z 岸（`bank=+1`）；
  - **B**：`camYaw=0`、`z=-26` 真游出 −z 岸（`bank=-1`），覆盖 `p.z = bank*29` 的负号分支；
  - **C**：不按键，直接把 `p.z` 置到 `27.4` 越过 `|z|<27` 阈值，**纯观察上岸分支硬设**、排除按键位移混入。
- **实测**（`_motion_ab_m12_raw.json`）：

  | 用例 | 转换帧 `i` | `prev (x,y,z,gh)` | `cur (x,y,z,gh)` | `Δy` | `Δz` | 断言 `\|Δz\|<1` | 断言 `\|Δy\|<0.2` |
  |---|---|---|---|---|---|---|---|
  | A `bank=+1` | 38 | `(100,-1.8, 27.0182, 0)` | `(100, 0, 29.0299, 0)` | **`+1.8`** | **`+2.012`** | **false** | **false** |
  | B `bank=-1` | 38 | `(100,-1.8,-27.0184, 0)` | `(100, 0,-29.0299, 0)` | **`+1.8`** | **`−2.012`** | **false** | **false** |
  | C 阈值对照 | 1 | `(100,-1.8, 26, 0)` | `(100, 0, 29, 0)` | **`+1.8`** | **`+3.0`** | **false** | **false** |

- **判读**：三例均在**单帧**内 `state: swim→foot`，`p.z` 被 `src/game/player.ts:390-393` `p.z = bank*29` 硬设（C 例无按键，`26 → 29` 恰为 3.0m；A/B 例 `27.0182 → 29.0299`，其中 `29` 来自硬设、`0.0299` 来自同帧 W 位移），`p.y` 由 `:387` `p.y = surface - 0.75 = -1.8` 经 `:410-414` `p.y = target = gh = 0` 一步抬升 1.8m。`maxSingleFrameDY=1.8`、`maxSingleFrameDZ=2.012/3.0`，**验收断言三例全部失败**。正/负两岸与阈值对照三组互证，排除「单一机位巧合」。

### M-13【已证实】`avatar+mount` 态 `teleport('fengdu')` 后 `state` 保持 `mount`，且传送落点被坐骑分支覆盖

- **断言**（`round1-motion.md:177`）：`avatar + mount` 态 `teleport('fengdu')`，断言 1 帧后 `player.state === 'foot'` 且相机不被拉回坐骑；当前 `state` 保持 `mount`。
- **A/B 设计**：进 avatar → `state='mount'`、`mounted = w.mounts.rideables[0]`（实测「骏马」，`mountPos=(-230,0,46)`）、`boat=null` → `teleport('fengdu')` → 立即快照 + 59 帧 rAF 采 `x/y/z/state/camY`。
- **实测**（`_motion_ab_raw.json` M-13）：

  | 项 | 值 |
  |---|---|
  | `teleportReturned` | `true` |
  | `before` | `state=mount`、`mode=avatar`、`mountedName=骏马`、`mountPos=(-230,0,46)`、`actorPos=(-521.27,0,71.61)` |
  | `justAfter.state` | **`mount`**（未重置） |
  | `justAfter.realmY` | **`-257.5`**（地府界域） |
  | `justAfter.camMode` | `fly`（`setCamMode('fly')` 已调用） |
  | `justAfter.actorPos` | **`(-230, 1.5, 46)`** = 坐骑位置，**不是** fengdu 落点 |
  | `justAfter.camY` | `-231.16` |
  | 59 帧 `distinctStates` | **`['mount']`**（全程不变） |
  | 59 帧 `actorPosEnd` | `(-230, 1.5, 46)`（全程不动） |
  | `camY` 轨迹 | `-231.16 → -157.36 → -143.92 → -131.59 → -120.01 → … → 4.40 → 4.42 → 4.45 → 4.46` |

- **判读（比原文预测更严重，但只报可观察事实）**：
  1. `POIS['fengdu']`（`src/world.ts:360`）= `new THREE.Vector3(540, UNDER.y + 2, 85)`，`UNDER.y=-260`（`src/sky/underworld.ts:10`）→ `(540,-258,85)`；`teleport`（`:1722-1724`）写 `actor.pos.set(p.x, p.y+0.5, p.z) = (540,-257.5,85)`。**实测 1 帧后 `actorPos=(-230,1.5,46)`**，即落点被 `PlayerController.update` 的 `mount` 分支用 `mounted.pos` 覆盖，玩家根本没到地府。
  2. `realmY=-257.5`（地府，`syncExternalMove` `src/game/player.ts:146-153` 依落点重算）与 `actor.pos.y=1.5`（人间坐骑处）**界域与位置自相矛盾**。
  3. `camMode='fly'` 但 `camY` 从 `-231.16` 被 `followCam`（`:435-443`）逐帧 `lerp` 回 `+4.46`（人间坐骑机位）——即 `setCamMode('fly')` 与第三人称 `followCam` **打架**，与原文预测一致。
  4. 三条 `verdict` 全为 `true`：`stateStayedMount`、`actorPulledBackToMount`、`teleportPosOverwritten`；`errs=[]`。
- **与 E-02 S7 不冲突**：`round1-runtime-evidence.md:34` S7 测的是**默认 soul/foot 态**下三次 `world.teleport` 落点「无 NaN、无跳变」，红队 §2.4 M-13 据此写「未测 mount/boat 态冲突」——本条正是补上该空白，不是反驳 S7。

### 1.5 汇总与对红队「未覆盖项」的补位

| 条目 | 结论 | 红队 §3.2 原归类 | 本轮补位 |
|---|---|---|---|
| M-06 数学子项 | **【已证实】** | 红队「数学子项确定成立」 | 静态推断 → 运行时数值硬证据（公式逐位吻合） |
| M-06 穿建筑子项 | **【无法验证】** | 一律维持疑似 | 未做分层连拍，**维持疑似** |
| M-11 | **【已证实】（现象面）** | §2.4 一律维持疑似 → **§六 6.1 升级为确认缺陷** | 补上逐帧采样 + 人间对照；红队据「两组 maxVy 同为 7.5」升级为状态机不一致 |
| M-12 | **【已证实】** | §2.4 一律维持疑似 → **§六 6.1 升级为确认缺陷** | 补上三子用例逐帧采样；红队采信对照互证 |
| M-13 | **【已证实】** | §2.4 一律维持疑似 → **§六 6.1 升级为确认缺陷** | 补上 avatar+mount 态传送；红队追认状态矛盾 + 相机打架 |

> 红队 `round2-red-team.md:227` 明确列出本轮运行时证据「**未覆盖**：……异界跳跃/上岸/传送状态冲突、相机穿墙……」；`:231`「**本轮没有足够证据把任何一条『疑似』的现象面升级为确认，维持疑似是纪律要求**」。本文件 §一 的四条 A/B 正是补上红队自己点名的证据缺口，**证据优先级按红队 `:5`「运行时硬证据 > 源码 > 静态推断」**。
> **v3 闭环**：红队随后落盘 `§六 运行时 A/B 补证后的复核订正`（依据本文件，`round2-red-team.md:292-326`），按 §3.2「据新证据复核订正」把 **M-11 / M-12 / M-13 由【维持疑似】升级为【确认缺陷】**，M-06 数学子项升为运行时硬证据、M-07 描述订正为三套传送、M-01/M-14/附录 PLATFORMS/§〇/M-08/09/10 不翻案。我方**接受全部裁定**（逐条见 §二表格与 §2.3）。这是「红队证伪 ↔ 原作者答辩 ↔ 主线程裁决」对抗闭环中，被审方实证被裁判采纳的部分。

---

## 二、红队裁决逐条答辩（M-01…M-14 + 附录 + §〇）

> 依据 `artifacts/round2-red-team.md` §2.4（`:166-185`）。回应口径：维持 / 接受下调 / 补充证据。

| ID | 红队裁决 | 我方回应 | 依据与补充证据 |
|---|---|---|---|
| M-01 | **修法需修正**：零接线【维持确认】；「玩家是否真穿墙」【下调为疑似】；修法驳回/排期 | **接受下调 + 接受排期** | 我方 `round1-motion.md:233` §四.1 本就把「M-01 玩家是否真穿墙」列为「必须运行时」，红队把「现象面」与「零接线代码事实」分离是对的。静态可机检断言不变：`grep -r "blocked(" src/game` 当前 0 命中（`round1-motion.md:42`）；几何侧 geom-expert 已交叉确认 `bake.ts` 无 collider 注册，「几何+玩法两侧都未接线」闭环成立。修法排期接受：`rt/ground.ts:12`/`loop.ts:7` 自认独立切片、`collider.test.ts:117` 假绿断言，与红队 §3.3.4 一致。**无争议**。 |
| M-02 | **维持确认** | **维持** | 无争议；与 P-14 A 同一事实不重复计数，我方 §二 已记。 |
| M-03 | **维持确认 / 修法补验收** | **接受修法补验收** | 注入 `RNG` 会改 `spawnAll()` 9 个坐骑的 `yaw/phase` 初值（`src/city/mounts.ts:40-41`），须重跑 `I6`（位置哈希）与全部复拍，否则 `probe-sim-determinism.mjs` 的假绿不被修复反被掩盖；与红队 `:87`、§3.3.2 一致。 |
| M-04 | **维持确认 / 修法补回归** | **接受** | 我方原文已自提「须回归 `probe-threat`」；叠加式 `speedScale` 会改望乡台 slow 语义，回归必要。 |
| M-05 | **维持确认** | **维持** | 无争议；`player.ts:185` 的 `if(ev.repeat) return` 与本条面板 `onclick` 绕过 busy 不冲突（ui-perf 会签确认）。 |
| M-06 | **维持确认 / 子项疑似** | **维持 + 补充证据** | 数学子项已由 §一 A/B 坐实（`camY=-5.186 < gh=0`，与 `offY` 公式逐位吻合）；「是否穿进具体建筑/坡面」**维持疑似**且本轮标【无法验证】。修法复用 `engine.ts:446-449 CAM_TMP` 已与 ui-perf-expert 会签，不与 GC 削减项对冲。 |
| M-07 | **维持确认（代码事实）/ 不夸大现象** | **接受不夸大 + 补口径** | 接受 E-02 S7「无 NaN、无跳变」，不按「已致跳变」夸大。**补口径（不新增编号、不升级定性）**：S7 走的 `world.teleport` 用 `POIS` 表（`world.ts:1716-1724`，fengdu 落点 `(540,-258,85)`），而我方 M-07 讲的是 `usePortal` 自动 `PORTALS` 表（`player.ts:426-429/499-502`，人间触发点 `(470,0,24)`、落点 `(0,-260,-130)`）与 `registerInteractions` E 键点（`world.ts:1663-1670`）**两套**；即引擎内写 `actor.pos` 的传送路径实为三套，红队「两套并存」的结论方向不变、只更精确。M-13 实证恰说明 `world.teleport` 这一套与 `mount` 分支冲突，二者相关但不重复计数。 |
| M-08 | **维持确认** | **维持** | 无争议；修法「`dt*2` 或删 units 侧」注意 `player.boat` 与 `units.playerBoat` 同引用（`world.ts:1656`）。 |
| M-09 | **维持确认** | **维持** | 红队指出 E-02 S7 测的是 teleport、不覆盖「fly→walk 切视角」，与我方验收断言（`round1-motion.md:133`）一致，确认。 |
| M-10 | **维持确认** | **维持** | 无争议。 |
| M-11 | **§2.4 维持疑似 → §六 6.1 升级为确认缺陷（状态机不一致）** | **接受升级裁定** | 见 §一：异界 `peakY=-259.95 = realmY+0.05`、`maxRise=0.05 ≤ 0.3`、人间对照 `1.284m`、`riseRatio=0.039`、**两组 `maxVy` 同为 `7.5`**。红队 §6.1 采纳我方数据并给出更精确论证：`vy=7.5` 确实被置位却又被下一帧钉回 `realmY` 且清零、留下「一帧 0.05m 抖动」的半吊子态 → 是「允许」与「干净禁用」之间的**状态机不一致**，非纯产品取舍，故升级。我方**接受该裁定**（比我方原「仅请求裁决现象面」更充分）。「异界是否允许跳」的产品选择仍交主线程；修法二选一、禁止留中间态：(a) 允许跳 → 改运动积分 `p.y=realmY+jumpOff`（排期）；(b) 干净禁跳 → `realmY!==null` 时不进起跳分支 / 清 `jumpQueued`（几行、零风险，可进批次 A）。 |
| M-12 | **§2.4 维持疑似 → §六 6.1 升级为确认缺陷** | **接受升级裁定** | 见 §一：三子用例单帧 `Δy=1.8`、`Δz=±2.012 / 3.0`，验收断言 `\|Δz\|<1 && \|Δy\|<0.2` 三例全部失败；并如实留档首测方向错误（`camYaw=0` W 朝 −z）与补测修正，符合 E-06 §2/§5。红队 §6.1 认定「正/负两岸 + 纯阈值对照互证、排除单机位巧合、对照组可达」→ 证据可采信，且单帧 1.8m 垂直跳变 + 无视 x 硬设 `p.z=±29` **无产品取舍争议**。我方接受升级。修法「上岸 clamp 到最近岸线并按 x 找干地 + `p.y` 台阶/插值抬升」纯 JS 局部，须复测本文件三例。 |
| M-13 | **§2.4 维持疑似 → §六 6.1 升级为确认缺陷（比原结论更严重）** | **接受升级裁定** | 见 §一：`state` 59 帧恒 `mount`、落点 `(540,-257.5,85)` 被覆盖为 `(-230,1.5,46)`、`realmY=-257.5` 与 `actor.y=1.5` 矛盾、`camY` 被 `followCam` 从 `-231.16` 拉回 `+4.46` 与 `setCamMode('fly')` 打架。红队 §6.1 追认「新增状态矛盾 + 相机打架」，并钉死修法边界：**追加**清 `state/mounted/boat/vy/realmY`，**绝不能删** `world.ts:1809-1810` 搬化身（蓝队 B-03 证明对目标链有效），并回归 E-02 S7（默认 foot 态传送行为不应改变）。我方接受，且该边界与我方 §三 第 4 条「一并核 `syncExternalMove` 的 `realmAt` 重算时机」互补、不冲突。 |
| M-14 | **维持确认（根因确认、影响面疑似）** | **维持 + 补充证据（交叉引证，影响面已坐实）** | 根因「门验注入路径、生产默认墙钟」的假绿（`probe-sim-determinism.mjs:263-278` vs `world.ts:858/:345` 不注入）与我方原文一致，**维持确认**。**影响面口径订正**：红队 `:183`「回放下分叉 / 切后台瞬移需 `I6` 坐实」已由 core-expert `artifacts/round1-core-ab.md` 实验 B1/B2/B3 运行时坐实（逐值见 §2.2），我方原「接受影响面疑似」据此更新为**支持升级**。`Crowd.surfaceBench`（`crowd.ts:1225-1243`）仍明确排除。**归属纪律**：该证据由 core-expert 独立采集、归其 C06 升级请求（其 §2.5 C06 行已向 team-lead 提出），我方仅作**同源交叉印证**——加重证据（attach 直调 `performance.now()`）本就已并入 C06（`round1-motion.md:185`），**不冒充 #11 的 4 条 A/B、不另立编号、不重复计数**。 |
| 附录 PLATFORMS | **维持疑似，不占编号** | **维持 + 【无法验证】** | 本轮 A/B 只覆盖 team-lead 指定的 4 条，未做 AABB diff 与 120–260m 环带 `groundHeight` 采样。诚实标注【无法验证】，维持疑似、不占 14 条编号；建议后续切片或交 red/blue-team 跑 geom-expert 已收录的两条断言。 |
| §〇 已核通过表 | **剔除：设计取舍** | **接受** | 本就是「非缺陷、供反向抽查」的登记，无缺陷可修。 |

### 2.1 争议点归纳（供主线程直接裁决）

1. **无争议（接受红队裁决）**：M-01（下调+排期）、M-02、M-03（补验收）、M-04（补回归）、M-05、M-08、M-09、M-10、§〇、附录 PLATFORMS —— 共 10 项，**不改定性、不翻案**。（M-14 原列此项，因 core-expert 交叉证据到位改列第 6 条；M-11/12/13 原列「请求裁决」，因红队 §六 升级改列第 7 条。）
2. **M-07 接受「不夸大现象」**，补一处口径；红队 §6.3 已正式订正为**三套**写 `actor.pos` 的传送路径，定性不变。
3. **M-06 维持 + 补证据**：数学子项由红队 §6.2 升为运行时硬证据；穿建筑子项仍疑似 / 无法验证。
4. **M-11 / M-12 / M-13**：见第 7 条（已升级，不再停留「请求裁决」）。
5. **M-11 的「产品取舍」边界**：我方原主动保留、未强行判缺陷；红队 §6.1 以「两组 `maxVy=7.5` + 一帧 0.05m 抖动 = 允许与干净禁用之间的状态机不一致」为由升级，论证比我方更充分，**我方接受**，但「异界是否允许跳」的产品选择仍交主线程、修法须二选一。
6. **M-14 影响面**：由 core-expert 运行时证据交叉坐实（§2.2），我方支持其 C06 升级请求，**但不重复计数、不冒充我方 A/B**。注意红队 §6.4 仍写「本轮未做 I6 位置哈希、接受维持」，与 core-expert `round1-core-ab.md` B3 已落盘的受控 `renderOnce` 位置哈希（`sha1≠sha2`、`sameClockEqual=true`）存在**时点差**：§六 依据的是本文件 v1（193 行），未纳入随后落盘的 core-expert 证据。已同步 red-team 复核，请主线程与 C06 合并裁决、勿双计。
7. **M-11 / M-12 / M-13 红队 §六 已升级为【确认缺陷】**：我方**接受升级裁定**（§二表格逐条）。三条均**未被批次 A 修复**、仍需主线程动手；修法边界见 §六 6.1/6.6 与本文件 §三。

### 2.2 M-14 影响面 · 与 core-expert 运行时证据的交叉引证（**非我方 A/B、不重复计数**）

> 来源：`artifacts/round1-core-ab.md`（core-expert，探针 `scripts/_core_ab_v2.mjs`），实验 B1/B2/B3。红队 `:183`/`:231` 把 M-14 影响面列为「需 `I6` 坐实 → 维持疑似」；以下三条把该缺口补上。**升级请求由 core-expert 在其 §2.5 C06 答辩向 team-lead 提出，我方只作同源印证**。

| 红队缺口 | core-expert 实验 | 运行时值 | 与我方 M-14 的对应 |
|---|---|---|---|
| 门 vs 生产注入差异（根因，我方已确认） | B1 `:77-88` | `w.crowd.clock` / `w.impacts.clock` 源码均为 `() => HOST_PERF.now()`（生产未注入）；`w.crowd.rng` 为固定种子 mulberry32 模块级单例流；`crowdDeltaFromSimT_ms ≈ 29834.2`（墙钟比仿真 `t` 快 ~30s，双时钟） | `round1-motion.md:184`「门验的是生产里根本不存在的配置」由静态推断升级为运行时读数；`LEGACY_RNG` 定性（两份独立定义、实例内共享）不变 |
| 「切后台瞬移」影响面 | B2 `:98-120` | 216 个 attach 中 **158** 个位置是 `performance.now()` 的纯函数：墙钟 `+5s` → 桥面组 `Δz=+10`，与 `world.ts:444` `tt=performance.now()/1000*2.0` 逐位吻合（`i=0: z 20.000→30.000`）；`repeatIdenticalAtSameWallClock=true`（纯函数、非状态累积）；**另 58 个**为 `units.ts` 轿/坐骑 `out.pos.copy(sd.pos)`，grep 确认 `units.ts` 无 `performance.now`，**不属墙钟组** | 我方 `round1-motion.md:185` 加重证据「attach 直调墙钟算位置、注入 clock 救不了」由代码链路升级为实测；并**收窄影响面**：不是全部 attach，是 158/216（core-expert 自标「全部 216 都随墙钟变」为【已证伪】夸大） |
| 「回放下分叉」影响面（`I6`） | B3 `:124-143` | 受控 `renderOnce`：同 dt 序列 `3×(1/60)`、墙钟 `100000ms` vs `105000ms` → `sha1=d254388316047b5f` ≠ `sha2=1fc9ac3c4b2f2b7e`（`equal=false`）；回到 `100000ms` 复跑 `sameClockEqual=true`（**控制组排除 dt 状态累积混淆**）；`err=null` | 我方 `round1-motion.md:191`「`Engine.renderOnce` 固定步回放完全不可复现」由推断升级为位置哈希分叉；与 `I6` 验收口径一致 |

**归属与边界（防止第 2 轮误伤 / 两份文件打架）**：
- 这三条是 **core-expert 独立采集**，不在 team-lead 指派给我 #11 的 M-06/M-11/M-12/M-13 四条 A/B 之内；本文件 §一、§五「本轮已跑」仅指我方四条，M-14 影响面记为**交叉引证**。
- 与 core-expert `round1-core-ab.md` §2.5 C06/C10 是**同一事实**：加重证据早已并入 C06（`round1-motion.md:185`），core-expert 亦在 C10 注明「motion-expert 已把 attach 组连注入 clock 也救不了并入其 M-14」。**双方均不另立新编号、不重复计数**。
- core-expert §0.3 记录并发改码导致行号漂移（`world.ts:345→:383`、`:858→:898`），但 attach 组 `:442-451 / :485-498` 未漂移、依赖行未变；本文件行号沿用审核基线 `be0226e`，与 §〇.3 口径一致。
- core-expert B3 初版「全 216 个 actor 哈希」控制组失败（`sameClockEqual=false`），已定位为 `units.ts` 轿/坐骑 `sd.pos` 每帧 dt 积分累积所致，改为只哈希 158 个墙钟驱动子集后控制组通过 —— 负结果已如实登记，**不是墙钟证据的反例**。
- 我方 `round1-motion.md:192` 明确排除的 `Crowd.surfaceBench`（`crowd.ts:1225-1243`，真实耗时测量、不参与 sim 状态）不受本次交叉引证影响，仍属设计取舍。

---

## 三、给主线程裁决的建议（不自行改判）

1. **可据本文件 §一 把「现象面」由疑似记为已证实的 3 条**：M-11（异界跳跃被吞）、M-12（上岸单帧跳变）、M-13（teleport 状态冲突 + 落点覆盖 + 相机打架）。证据均为逐帧 rAF 采样、带对照组、页面错误 0，符合红队 `:5` 证据优先级。若主线程坚持「维持疑似是纪律要求」，我方接受，但请在裁决记录里注明「已收到 motion-expert 运行时补证」。
2. **M-06**：数学子项建议按「运行时已证实」记；穿建筑子项继续维持疑似。
3. **M-11 定性**：现象已证实，但「是否修」按产品取舍（异界是否允许跳）——建议主线程明确一句产品口径，再决定是「确认缺陷」还是「设计取舍（须清 `jumpQueued` 或明确禁用跳跃）」。
4. **M-13 影响面比原文更大**：除 `state` 未重置外，还实测到「传送落点被 mount 分支覆盖」与「`realmY` 与 `actor.pos.y` 矛盾」，建议修法在 `resetMotionState()` 之外一并核 `syncExternalMove`（`player.ts:146-153`）的 `realmAt` 重算时机，避免只清 `state` 仍留界域错配。**这是修法口径补充，不新增编号**。
5. **M-01 / M-03 排期与验收**：接受红队 §3.3.4 / §3.3.2，不要求本轮改。
6. **M-14 影响面**：core-expert 的 B1/B2/B3 已把红队 `:183` 要求的「`I6` 回放分叉 / 切后台瞬移」坐实（§2.2），建议主线程在裁决 core-expert **C06** 升级请求时一并采纳；我方 M-14 只作同源交叉印证，**不另立编号、不重复计数**。若主线程认为 M-14 影响面应维持「疑似」，我方亦接受，但请在记录里注明已收到 core-expert 的运行时位置哈希证据。

---

## 四、本次仍未覆盖的运行时验证项（诚实留白，供后续切片）

| 条目 | 缺什么证据 | 最小方案（沿用 `round1-motion.md` §四.2） |
|---|---|---|
| M-01 玩家是否真穿墙 | 真实建筑机位 | 注册 box collider 后朝它走的机位连拍（当前 `blocked` 生产零接线，需先排期接线） |
| M-06 是否穿进建筑/坡面 | 分层地形剖面 | 沿 `+85°` 隐藏 `terrain`/`city_*` 分层连拍 |
| M-02 重复触发次数 | `ui:toast` / `setTimeout` 计数 | 单次过界逐帧计数（断言 `===1`，当前 ≈27） |
| M-05 定时器提前清理 | 同动作重复时 `actor.action` 时序 | 面板 `onclick` 连点逐帧采 `action` |
| M-08 船桨帧率差 | 30/60fps 对照 | `dt=1/60×60` vs `dt=1/30×30` 末帧 `phase` 差 |
| M-09 walk 界域瞬移 | fly→walk 切视角（非 teleport） | 相机置 `y=-250` → 点「视角」→ 断言 `camY<-100` |
| M-10 检测次数 | 60 帧 vs 10 帧 | 同 1s 仿真时间断言 `npcSweep` 次数一致 |
| ~~M-14 影响面~~ | **已由 core-expert 交叉覆盖（§2.2），非我方 A/B** | B2 `Δz=+10` 坐实切后台瞬移、B3 `sha1≠sha2` + `sameClockEqual=true` 坐实 `I6` 回放分叉；我方未独立复跑，仅作交叉引证。完整 `I6` 验收（冻结 `Date.now` + `renderOnce(1/60)×120` 含 attach 组）仍按 core-expert C06 口径落地 |
| 附录 PLATFORMS | AABB diff + 环带采样 | `scaleHeavenGeometry`+`enlargeLingxiao` 后凌霄殿台基 AABB 与 `PLATFORMS` 换算圆逐项 diff；120–260m 环带 `groundHeight(x,z,refY>2150)` 返回有限值且等于台面高 |

---

## 五、可机检验收断言汇总（本轮已跑 / 待跑）

| 断言 | 当前实测 | 期望（修复后） |
|---|---|---|
| `camY >= groundHeight(camX,camZ,camY)` @ `camPitch=+80°` | `-5.186 < 0` **失败** | `>= 0` |
| 异界按 Space `max(p.y) > realmY + 0.3` | `-259.95 = -260+0.05` **失败** | `> -259.7` |
| 人间对照 `max(p.y) - baseY > 0.3`（对照组须通过） | `1.284` **通过** | 保持 |
| 上岸单帧 `\|Δp.z\| < 1 && \|Δp.y\| < 0.2` | `2.012/3.0` 与 `1.8` **失败（3/3 例）** | 均通过 |
| `avatar+mount` 态 `teleport('fengdu')` 1 帧后 `state==='foot'` 且 `actorPos` 接近 fengdu POI | `state='mount'`、`actorPos=(-230,1.5,46)`（非 POI）**失败** | `state='foot'`、落点接近 `(540,-257.5,85)` |

> 复跑命令（**只读、不改 src、不跑测试**）：`node scripts/_motion_ab_01_cases.mjs`、`node scripts/_motion_ab_02_m12.mjs`；原始数据落 `artifacts/_motion_ab_raw.json` / `artifacts/_motion_ab_m12_raw.json`（均被 `_*.json` 忽略）。

---

## 六、纪律与产物清单

- **未修改任何 `src/` 源码**；未运行 `npm test` / `tsc` / `vite` / 构建；未认领 #7 蓝队。
- **写入**：本文件 `artifacts/round1-motion-ab.md`（唯一授权审核产物）。
- **临时探针**（`scripts/_*.mjs`，被 `.gitignore` 排除）：`_motion_ab_00_probe.mjs`（环境探测）、`_motion_ab_01_cases.mjs`（4 例）、`_motion_ab_02_m12.mjs`（M-12 补测 3 例）。
- **原始数据**（`artifacts/_*.json`，被 `.gitignore` 排除）：`_motion_ab_raw.json`、`_motion_ab_m12_raw.json`。
- 已清理本轮产生的未忽略临时日志 `artifacts/_motion_ab_err.log` / `artifacts/_motion_ab_m12_err.log`，`git status` 中无 `_motion_ab` 残留。
- 所有行号相对项目根 `src/...`，基线 `be0226e`；口径差异见 §〇.3。
