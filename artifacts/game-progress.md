# game-progress · 赛博上河（续跑用的断点文档）

> 交接纪律：换会话先读这份 + `artifacts/SPEC-总账.md`（+ 最新的 `SPEC-R19-R25-云海与水体.md`），不要重做已 ✅ 的项。
> 最后一次验证（**未打包**）：源码树 `tsc --noEmit` 0 错 / `vitest 72/72` / 载入 19.4s / 静态面 11.44M / 峰值堆 1543MB；最近一次打包基线是 `release-v76`（`PACKAGED_BOOT=PASS` / `calls 450–570` / `frameP95 17ms`）。

## 当前意图与约束

- 目标：按 `SPEC-总账.md` 逐项清零（🔴/🟡），每项先写断言再实现，红了先修，绿了才更新状态。
- 硬约束：不谎报；未测就标未测；改完必须 `tsc` + `vitest` + 打包 + `verify-packaged`。
- 环境：`<WORKSPACE>/赛博上河-CyberQingming-全量导出-20261024/cyber-qingming`；预览 `npx vite preview --port 4173`；浏览器 `<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe`。

## 本轮周期已完成的决策（避免重犯）

| 结论 | 证据 |
|---|---|
| 载入卡死 = JS 堆 3.3GB 触发 GC 悬崖，不是死循环 | `probe-load` 堆曲线；`FBuf` + 每步 `flush` 后 1.05GB |
| 屋顶「白色方块」= `commonerRoof` 把坡度写进 `rx`，`Euler('XYZ')` 下翻转 | `bisect-mesh`：隐藏 `city_roof_9` 亮度 178→62 |
| 天宫灰底 = **穹顶**，不是雾/云海材质/霾环 | `shot-hide nodome`（仅藏 r>40000 两网格）→ 天空变黑、岩锥全露 |
| 地平霾环是地面 y=2.5 的环，升空后加灰但非主因 | 已按高度淡出（120m→210m） |
| `city_fabric` 包围球 218 万 = NaN 顶点导致**永不剔除** | 越界守卫拒收后回到 2.2 万 |
| 硬件 p50 17ms = 锁 60fps；p95 25–33ms 是浏览器合成/GC | `frameJsMs 9.1 + frameRenderMs 3.8 = 12.9ms` |
| 步耗时含让帧，不能当阻塞指标 | 已改 p95 口径 |

## 未完成项（按优先级）

1. **桥东裸带**（3.2）：`three-view/bridge-top.png` 显示约 200×200m 纯土空地。下一步：先探明归属（`wardReserved` / `reserved()` 的 `|x|<950` 中央带），再补铺装 + 摊位，禁止盲铺。
2. **天宫大白球/白色发光单位**：`pantao-front.png` 可见；`infill.ts` 的菜畦也已打 `ground.infill`（实测 44 处），但**它不是那片黑地坪**（色值为 0x6d7a3c 等绿系）。真正的近黑街面带仍未打标签，位置在 `infill.ts` 约 2105 行的 `plate(b,'ground',…AVE_DECK…)` 与 `2054` 之外的其它 ground 盒。用 `shot-hide` + `bisect-mesh` 定位（工具已验证可用）。
3. **凌霄宝殿体量/重檐**（4.3）：已有基线截图，需先量「殿身包围盒 / 岛半径」。
4. **威胁接线**（6.5.8）：望乡台系数注入已验（0.55/1），但化身位移未测——传送后是飞行模式，需先切步行态。
5. 花/果材质（6.2 剩余）、天宫体积云（4.6）、地府十八狱细节（5.2 已验数量）。

## 最新进展（本轮追加）

- **桥区裸地归属已定**：`shot-hide city_ground` 后整片消失、露出沙色 terrain ⇒ 那片「空地」是 `city_ground` 的深色地坪本身。
- **按颜色检索给出坐标**（`probe-groundcolor.mjs`）：最大簇 `rgb(40,32,40)`、65,769 顶点、y=0.22、x 34–806、z ±302；次簇 `rgb(32,24,32)`、58,647 顶点、y=−1.05。下一步按 `0x282028 / 0x202020` 反查 `pavement.ts`/`props.ts` 常量并提亮。
- **已排除**：`C.road = 0x8a7f6a`（不是近黑），所以那片黑地坪**不是街面**；候选收敛到 `pavement.ts` 的石板/坊区色斑（`SEAM_C 0x6f6555`、`MOTIF_C 0x585550`、`KERB_C 0x655d4f` 皆偏亮，需再用顶点色反查一次确认真源）。
  已逐个排除：`SLAB_COLORS`（0x70–0x8b 全为中间调）、`PAVE_BASE 0x7f7562`、`props.ts` 的 ground 盒均无 0x2x/0x3x 深色。**结论：这一片深色地坪目前无法按常量反查定位**——下一步改为「给每个 `b.box('ground', …)` 补一个 `b.kit('ground.slab.<模块>', 1, y)` 标签」，让 `assetAudit.detail` 直接按模块归因，这类问题以后一次就能答（比继续 grep 常量可靠）。
- **归因机制已落地**：`props.buildGround` 的三块地坪（`slabN`/`slabS`/`riverBed`）已打 `b.kit('ground.*')`，（后追加 `pavement.ts` 的 `ground.pavement`）。`probe-world` 实测 `ground.pavement=1 / ground.slabN=1 / ground.slabS=1 / ground.riverBed=1` 可见；`infill.ts` 的菜畦也已打 `ground.infill`（实测 44 处），但**它不是那片黑地坪**（色值为 0x6d7a3c 等绿系）。真正的近黑街面带仍未打标签，位置在 `infill.ts` 约 2105 行的 `plate(b,'ground',…AVE_DECK…)` 与 `2054` 之外的其它 ground 盒 ⇒ 以后「这块地是谁铺的」可直接按模块查，不必再 grep 常量。
- **另试无效**：给 `ground` 材质加 `emissive 0x121014` 抬暗端——出图无可见；`infill.ts` 的菜畦也已打 `ground.infill`（实测 44 处），但**它不是那片黑地坪**（色值为 0x6d7a3c 等绿系）。真正的近黑街面带仍未打标签，位置在 `infill.ts` 约 2105 行的 `plate(b,'ground',…AVE_DECK…)` 与 `2054` 之外的其它 ground 盒差异，已回滚。说明那片黑是**几何层缺失光照**（背光/法线朝下）而非纯色深，下一轮应先查法线与日照方向，而不是继续调色。
- **踩过的两个无效方向（勿重试）**：① 扩大铺装范围（无效，问题在高度）；② 改 1320×396 地坪主板色（无效，不是那两块）。
- **已修**：铺装 y=0.06 → 0.22（否则被地坪压在下面看不见）；机位已固化进 `probe-plaza.mjs`（cam [-22.7,110.7,-32.8] → poi [0,12,0]）。

## 多 agent 并行（2026-10-31）

- 第 1 轮 A/B/C 已完成并集成：`release-v69` `PACKAGED_BOOT=PASS`。详见 `artifacts/SPEC-多agent工作流.md`。
- 第 2 轮 D/E/F 进行中：护城河/御沟水面、天宫体积云与浮岛对比、花果材质。
- 新增/更新的机制：`player.effectiveSpeed/applyDisorient`（威胁可测）、`__groundTrace`（地面归因）、`ground.bankSlope/towpath`。

## 阻塞与失败台账（2026-10-31 审核）

| 现象 | 根因 | 处置 | 状态 |
|---|---|---|---|
| 总账 `SPEC-总账.md` 读不出，21,501 字节全 `0x00` | 未知进程/写入中断写坏，file-history 无对应版本 | 按会话内实测证据**重建** | ✅ 已恢复 |
| `python - <<'PY'` 改文档多次静默失败（exit 49），文件没变却打印 ok | 该 shell 下 heredoc + 中文写入不可靠 | 改用 **Edit 工具**，不再用脚本改 md | ✅ 已规避 |
| 「桥东空地」连查十几轮未果 | 用截图猜功能，没先查归属 | 建 `__groundTrace` 台账 → 一次定位为**河床** | ✅ 已根治 |
| 「leaf 已接叶面贴图」是错判 | `city_leaf` 无 uv 属性，贴图每顶点采样同一像素 | 改由 `ceramic`（有 UV）承载花/果材质 | ✅ 已纠正 |
| 护城河/御沟看不见 | 水面低于地形/石岸 | 抬水面 + 方形压平地形（`terrainHeight`） | ✅ 已修 |
| 天宫画面灰白 | 穹顶渐变（不是雾/云海/霾环） | `applySkyDomeTint` + 云改多层片 | ✅ 已修 |

## 验证矩阵（哪些有真断言，哪些只有截图）

| 证据类型 | 覆盖项 |
|---|---|
| **机检探针** | 载入（`probe-load`）、阻塞（`probe-blocking`）、draw call/shadow（`verify-packaged`/`probe-shadow`）、Boss（`probe-boss`）、关卡（`probe-level`/`probe-objective`）、地府（`probe-hell`）、音效（`probe-audio`/`probe-steps`）、材质（`probe-material`）、世界规模（`probe-world`）、地坪归因（`probe-groundtrace`）、威胁（`probe-threat2`）、目标链（`probe-goalchain`） |
| **仅截图** | 3.1 河流、3.6 城墙、4.3 凌霄宝殿、4.4 浮岛、6.1 蟠桃园、7.1/7.5 画面复查 |

> 纪律：仅截图的项若用户要求"逐座/逐项"，必须补机检或补多机位，不能只写"看着没问题"。

## 可复用工具

`probe-load` / `probe-load-budget` / `probe-blocking` / `probe-boss` / `probe-level` / `probe-objective` / `probe-hell` / `probe-audio` / `probe-steps` / `probe-material` / `probe-world` / `probe-coverage` / `bisect-mesh` / `shot` / `shot-hide`（支持 `poi:KEY|前缀`、`nodome`/`nohaze`/`nosky`/`nofog`/`nobloom`/`nopbr`）/ `probe-console`。

## 踩坑记录

- `Euler('XYZ')` 下 `rx≠0 & ry=π` 会把构件上下翻 → 坡度必须烘进几何或用 `rz`。
- 界域覆盖（雾/自发光）必须写在 `applyLighting` **之后**，否则被无条件覆盖。
- 城市俯视要走 POI 机位（`three-view bridge`）；y>300 的相机在云海之上只会看到天宫。
- 传送只动机位不动机位化身 → `teleport()` 已同步 `player.actor.pos`。
- `Baker.push` 越界守卫会拒收 `span=Infinity` 或 |x|,|z|>30000 的构件（计数见 `baker.rejected`）。

---

## 2026-11-01 · 本轮（5 agent 并行中，lead 只做零冲突工作）

### 已定的根因（全部有可复跑证据，见 `SPEC-R19-R25-云海与水体.md`）

| 症状 | 根因 | 状态 |
|---|---|---|
| 「河上有路」 | `river.ts` `riverRibbon` 索引绕序 `(a,b,b+1)` → 法线 −Y → `FrontSide` 下整条汴河被背面剔除。看到的"水"是河床 | ✅ 已修（绕序翻转 / 纤道 640 段 / 吃水 0.72m） |
| 「地上深绿深蓝是河是湖」 | ① 云海盘半径覆盖全城、高 190m，相机 90–1200m 时整座城被它盖住；② `terrain.ts:812` 11 个 `#1a5a70` 死平涂圆盘（半径 1313–3577m、仅 26 段） | ① ✅ 已接线淡出；② 🟡 agent-273 在改 |
| 「这些是什么 / 这些又是什么」（巨型碎块） | `WardInfill` 的 tier-3 块群绕过 `reserved()`，414 个 68–126m 方块+14–23m 斜屋面铺进宫城北侧保护带，最近距紫宸殿 220m | ✅ 已修（`blockReserved()` 9 点采样） |
| 「天上的巨大黑洞」/地平线黑带 | 云海淡出机制 `buildCloudSeaView`/`setViewerY` 代码存在但**全仓从未被调用** | ✅ 已接线（`world.ts`） |
| 「皇宫三大殿太粗糙」 | 旧实现是三块盒子台基 + 两片平板重檐 | ✅ 换 `palaceDetail.buildPalaceHall`（斗栱 350 攒 / 瓦垄 1136 垄 / 单殿 197,888 面） |

### 静态审计结论（本轮新增，避免重复排查）

- **绕序类缺陷只有 `river.ts` 一处**。`city/water.ts` 的 `ribbonGeo`/`fanGeo`、`city/parks.ts` 的 `pondWater` 叉积实测均为 **+Y**，正确。
- `toneMapped:false` 的 20 处里，除 `terrain.ts` 河湖水面外全部是发光体/星点/VFX，属正当用法。

### 探针体系修正（之前一直在骗人）

1. `probe-ward.mjs` 的「roof+gable ≥ 0.9×body」判据**必须按桶算**：简院档本来就是 body 3 : 顶 1，跨桶求和必然假红。已改按桶。
2. 四个探针的就绪判据改成 `!loading && !!window.__qingming`。多 agent 并发改文件时 vite 会整页重载，旧判据会在重载中途就绪读到空全局量。
3. 新增 `scripts/probe-acceptance.mjs`：河面法线 +Y、6 处垂直射线命中、河道两端收口、云海随高度淡出。
4. 新增 `scripts/probe-bare-ground.mjs`：**正上方拍两张（正常 / `scene.remove` 掉全部 `city_*`·`infill_*`·`court_*`）逐像素比对**，求「无建筑裸地」最大轴对齐矩形边长，判据 < 90m。隐藏必须用 `scene.remove()`，`visible=false` 会被 LodManager 每帧还原。

### 并行 agent 与文件归属（防止下一轮撞车）

| agent | 任务 | 独占文件 |
|---|---|---|
| agent-273 | 地形水体材质/岸线/分段 | `world/terrain.ts` |
| agent-274 | 云海局部化 + 云雾质感 + 天宫体量 | `sky/expansion.ts`、`sky/palace.ts` |
| agent-275 | 民居屋顶形制 | `city/bake.ts`、`city/infill.ts` |
| agent-276 | 宫城庭院填实 | `city/imperial.ts`、`city/palaceGrounds.ts` |
| agent-281 | 府衙/货栈移出河道 | `city/buildings.ts`、`city/layout.ts` |

lead 保留：`world.ts`、`scripts/**`、`artifacts/**`。

### 未验证 / 待办

- R14b 碎块修复只过了 tsc，**没有出图复验**（并发编辑期间探针不可靠）。
- 载入 **19.4s / 11.44M 面 / 峰值堆 1543MB**，全超原目标（12s / 8M / 1.5GB），未做优化。
- 未打包。下一个稳定点应打 `release-v77` 并跑 `verify-packaged`。

---

## 2026-11-01 04:2x · 事故与打包收口

### 事故：`src/sky/flora.ts` 被写成 40,674 字节全零

- **成因**：agent-283 用 `python - <<'PY'`（heredoc 重定向写源码）改文件，应用退出时写入被截断/清零。同一失败模式此前也毁过 `artifacts/SPEC-总账.md`。
- **项目无 git、`dist` 无 sourcemap**，不能版本回滚。
- **复原路径（可复用）**：agent 的会话日志 `agents/<id>/wire.jsonl` 逐条记录了 Read 结果与每次 Edit/Write 的完整参数。
  1. 取那条 `Read` 的 `tool.result.output`（带 `行号\t` 前缀）→ 去掉前缀得到**原始全文**；
  2. 取其 `Write`（append 模式）参数里的 `content` → 追加；
  3. 按其后的 `Edit` 依序重放 `old_string → new_string`（每次都校验命中）；
  4. 复原后 `tsc` + `vitest` 双重确认。
- **损失（如实记）**：它最后用 python 做的 3 次重构（莲花三层花瓣 / 枯木递归分叉 / `WindBatch.seg` 两点定段）没有进文件——那 3 次正是写坏文件的操作。当前是「原文 + 追加 + 4 次 Edit」这个当时能编译能跑的版本，待后续补做。
- **新纪律（对后续所有 agent 生效）**：**禁止用 `python - <<PY` / `cat >` / `sed -i` 写源码**，一律用 Edit / Write 工具。

### 打包：`release-v77`

```
npx vite build
npx electron-builder --win portable --publish never --config.directories.output=release-v77
node scripts/verify-packaged.mjs "release-v77/win-unpacked/CyberQingming.exe"
```

结果：**`PACKAGED_BOOT=PASS`**｜`live 4493`｜`heroes 165`｜`calls 526`（≤600）｜`frameP95 25ms`｜`errors: NONE`
前置门：`tsc --noEmit` 0 错、`vitest 72/72`。

**已知的打包链问题**：electron-builder 在 portable 目标最后一步报 `app-builder.exe` Go panic
（`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`），但 `win-unpacked/CyberQingming.exe`（188MB）与
`赛博上河-CyberQingming-1.2.0-x64.exe`（83MB）都产出完整，验证也通过。记为独立问题，不影响运行产物。

### 本轮之后仍在跑的 agent

| agent | 任务 | 独占文件 |
|---|---|---|
| agent-286 | 河道被 206.7m 地形网格埋掉 | `world/terrain.ts` |
| agent-285 | 民居门窗/勒脚/墙帽/砖缝/车辙 | `city/infill.ts` |
| agent-282 | 地府十八狱精细化 | `sky/underworld.ts`、`sky/hells.ts`、`sky/fengduGround.ts` |
| agent-288 | 凌霄宝殿三重檐 + 天宫殿宇结构核对 | `sky/palace.ts` |

未续跑：agent-281（府衙/货栈出河，要动 `layout.ts` 的 `LANDMARK_KEEPOUT`，风险较高，等前面清完再排）、
agent-283（天宫器物/仙灵，`flora.ts` 刚复原，需要它先确认现状再改）。

---

## 2026-11-01 05:1x · 又清掉三项（R6 / R27 / R28）

| 项 | 结论 | 关键证据 |
|---|---|---|
| **R28 天上"巨大黑洞"** | ✅ 根因不是物体，是**天穹被远裁剪面切掉** | 天穹 `SphereGeometry(46000)`、球心固定在**世界原点**、`camera.far=52000`。相机在 `(13900,180,5500)` 时前方球壁 `46000+13900≈59900m > far` ⇒ 视锥中心那块被裁，`scene.background` 为 `null` ⇒ 露出 WebGLRenderer 默认**黑色清屏**；黑影边缘的折线就是 32×16 球网格被裁后的多边形边。对照：现状近黑像素 49933 → 仅把 far 改 120000 → **0**；仅让穹顶跟随相机 → **0**。修法（`world.ts` 3 行）：每帧 `skyDome.position.copy(cam.position)`。复拍同机位黑丘完全消失 |
| **R27 河道被地形埋掉** | ✅ 沿河每 200m 垂直射线，最高点是水面 **240/240 = 100%**（改前 43.75%，最差一点地形比水面高 21.49m） | 地形三角形「3 顶点+3 边中点」六点取样，落进水面带外缘+60m 就剔除（60m 可证：六点覆盖半径 `L·√2/6=48.7m`，保留三角形内部任一点离水缘仍 ≥11m）；另建 19–21 列河床带。接缝 0.221/0.216m（阈值 0.25）；+4 万顶点、自计时 +47ms |
| **R6 凌霄宝殿三重檐** | ✅ 三层檐 272.80 / 282.70 / 298.54m，檐口宽 105.6 / 81.2 / 75.2m，斗栱 108/92/64 攒，总高 84.7m（旧 65.5m） | `skyStackedRoof` 新增 `grand` 分支；层间露出朱红殿身 3.6m/5.5m 带窗光，没被埋。顺带核出并修掉 **9 处结构问题**（陈设埋进实心盒且悬空 1.08m、御膳房三灶穿墙 0.7m、将台无台基无栏杆、瑶池十根孤柱无坐凳栏杆…）。+71,584 面、**draw call +0** |
| **R26 民居门窗墙体** | ✅ 棂窗 194,419 樘 / 板门 77,980 樘 / 踏跺石 109,936 块；删旧浮白光窗 −486,000 面 ⇒ infill 净增仅 +278,670 面 | 三套零几何着色 hook：`plasterHook`（勒脚 0.46 / 墙帽 0.16 / 夯土横纹 ±3.4%）、`roadHook`（路心+11% / 车辙−20% / 边沟−17% / 石板缝）、`furnHook`（片元画棂窗/板门/踏跺石） |

### 新增回归探针

- `scripts/probe-skydome.mjs` —— **R28 的永久回归门**：在 4 个「远离原点」的机位（13900/18000/27000/0），
  取画面上半部统计近黑像素占比，判据 **< 3%**。改前在第一个机位实测 77.5%。

### 本轮踩到的两个方法论教训（值得记住）

1. **「排除法」在渲染 bug 上会系统性失效**：我把 11 个对象逐个隐藏/染色都排不掉，因为被裁掉的那块**根本没被画出来**——材质颜色、可见性、射线命中全都不参与。正确做法是**改全局渲染参数做对照**（`camera.far`）与**看清屏色**（`scene.background`）。
2. **整段隐藏 children 后的"消失"是假象**：那一刀同时藏掉了穹顶与灯光，全屏都黑，无法分辨。必须配合「整屏近黑像素统计」而不是肉眼看。

### 仍在跑

| agent | 任务 | 独占文件 |
|---|---|---|
| agent-292 | 河头河尾接通 + 3.2m 水位差（跌水/船闸） | `world/terrain.ts`、`city/river.ts`、`city/riverends.ts`、新建 `city/waterLink.ts` |

### 未验证

- R6 / R26 / R28 三项**尚未进包**。最近一次可用的打包基线仍是 `release-v77`（`PACKAGED_BOOT=PASS` / `calls 526` / `errors NONE`）。
  agent-292 收工后应打 `release-v78` 并跑 `verify-packaged`。
- **R32 水面摩尔纹**（解析波法线在掠射角高频混叠）已实拍确认，300m 俯视很明显，尚未修。

---

## 2026-11-01 06:1x · `release-v79`（本轮收口）

```
npx tsc --noEmit            → 0 错
npx vitest run              → 72/72
npx vite build              → 2.40s
npx electron-builder --config.directories.output=release-v79
node scripts/verify-packaged.mjs "release-v79/win-unpacked/CyberQingming.exe"
```

**`PACKAGED_BOOT=PASS`**｜`live 4496`｜`heroes 165`｜**`calls 556`**｜`frameP95 25ms`｜`errors: NONE`

### 本轮清掉的项

| 项 | 一句话 |
|---|---|
| R31 河头河尾断在田野 | ✅ 二级澳闸（城内 +1.0 → 跌水① 1.35 → 护城河 −0.35 → 跌水② 1.85 → 河头 −2.2）；断头 8/10 → **0/10**，水面 49.6km 全部 alpha ≥0.96 |
| R32 水面摩尔纹 | ✅ `fwidth` 屏幕导数 + 仰角双重滤波；相邻像素亮度差标准差 **0.798 → 0.313（−60.8%）**，平均亮度仅 +0.32% |
| R33 draw call 660 超预算 | ✅ 桶 98→32 + 五类小件全城一桶；**660 → 556**，45s 运镜峰值 561、>600 的帧 0 |
| 7.1 白色闪光 | ✅ 月盘（55m 暖白圆盘，亮度 1.1 越 bloom 阈值）→ 冷银 `0x7b849f` 减薄 |
| 7.5 天空黑洞 | ✅ 天穹被远裁剪面切掉，改穹顶跟随相机；回归门 `probe-skydome` 四机位 darkFrac 全 0 |
| R14 皇宫广场空旷 | ✅ 由 R24 验收，裸地 2m 栅格 = 0 |

### 本轮新增/更新的探针

- `scripts/probe-skydome.mjs`（新）：4 个远距机位天空带近黑像素 < 3%
- `scripts/probe-ward.mjs`（改）：17-② 改成**按桶的恒等式**（`roof+thatch == gwall`、`blockroof == block`）；17-④ 改成 `glow || furn`
- `scripts/probe-bare-ground.mjs`（新）：正上方两图逐像素比对求「无建筑裸地」最大矩形
- `scripts/probe-display.mjs`：**认 `PROBE_URL` 不是 `PREVIEW_URL`**，别搞错

### 方法论教训（值得沉淀）

1. **排除法在渲染 bug 上会系统性失效**：被裁掉的那块根本没被画出来，材质颜色/可见性/射线命中全不参与。要改**全局渲染参数**做对照，并查**清屏色**。
2. **"整段隐藏 children 后消失"是假象**：同时藏掉了穹顶与灯光，全屏都黑。必须配合整屏像素统计。
3. **代理的归因不能直接采信**（包括我自己的）：draw call 那次我先判是 `infill_furn_` 桶太多，实测 `infill_*` 在开机机位**一次都没画过**。**先测量再动手**这条得写进每个 agent 的指令里。
4. **禁止 `python - <<PY` / `cat >` / `sed -i` 写源码**——flora.ts 被写成 40KB 全零就是这条引起的，只能靠会话日志逐字复原。

### 剩余 🟡（5 条）

- **4.4 浮岛薄饼**（agent-297 在做）：`buildIslandSkirt` 把岩锥底端钳在 y=187.5，`hRock = islandY − 2.6 − 187.5`，r=58 的岛只剩 23.22 → k=0.4；判据中位数 ≥0.60，当前 0.5515
- 1.1 启动四段式 / 1.2 分区流式 / 2.1 散落歪扭 / 4.1 三环群岛规模：**存量项，"已实现未到验收线"，不是缺功能**

### 下一步

1. 4.4 收工后打 `release-v80`；
2. 2.1「俯视仍偏格网」需要先做一个**可量化判据**（例如坊内建筑朝向分布 + 最近邻间距的变异系数），否则永远说不清什么叫"不偏格网"；
3. 1.2 分区流式是架构级改动，要单独立项，不要在收尾期硬塞。

---

## 2026-11-01 · 用户硬指令（**不可再被推翻**）

> 「下面这些都要建造！！皇宫别空旷 / 民居屋顶要对 / 民居要有门窗 / 天宫要瑰丽 / 河要有头有尾 / 地府十八狱要能数出刑具」

**这条指令把「减内容换载入速度」这条路永久关闭。** 以后任何一轮、任何 agent，都不得提议：

- 删实例 / 降 LOD 档 / 减窗减瓦 / 简化宫城院群 / 把天宫地府改成低配；
- 也不得靠**偷偷改 §0 的目标值**（把 ≤12s 改成 ≤16s）来"达标"。

### 载入优化只能在「同产出」下做

打包态实测（`release-v82`，`verify-packaged`）：

| 段 | 实测 | 占比 |
|---|---|---|
| 导航 → 引擎开始 | 309ms | 1.9% |
| **GPU 缓冲上传**（33 次 flush 累计） | 2,372ms | 14.9% |
| **纯 CPU 几何构建** | 13,604ms | 85.2% |
| 合计 | ≈16.3s | 目标 ≤12s，缺口 4.3s |

**已排除**：代码分割（预引擎仅 0.3s）、合批/延迟上传（flush 总共 2.4s）。
**唯一可行方向**：在同一份顶点/实例上降低 CPU 开销 —— 临时 `THREE.BoxGeometry`/`Matrix4` 复用、typed array 预分配、热循环去对象与字符串分配、`Math.hypot`→`sqrt`、纯函数缓存、让帧改为 `累计 >8ms 才 raf`。

### 验收方式（防止"变快但变丑"）

每项优化必须同时给：`world.assetAudit` 计数**逐项相等**、静态三角面相等、`__loadTimings` 前后对照、两张同机位图（里坊近景 + 高空俯视）无差异。只报耗时不算完成。

### 若最终到不了 12s

必须写清「实际能到多少」与「剩下的是哪一类不可压缩成本」，**不许谎报达成**。

---

## 2026-11-02 · 交接快照（跨会话续跑先读这段）

### 当前可用产物

`release-v88`：`PACKAGED_BOOT=PASS`｜`live 4492`｜`calls 375`（单点）｜`frameP95 17ms`｜`errors NONE`
载入 `303 + 8381 = 8.7s`｜`tsc` 0 错｜`vitest 78/78`（5 个测试文件）

### 判据体系（**必须用这些，不要用单点读数**）

| 探针 | 判据 | 现状 |
|---|---|---|
| `probe-calls-sweep.mjs` | 6 机位 `calls` **峰值** ≤600 | **527** ✅ |
| `probe-skydome.mjs` | 4 个远距机位天空带近黑像素 <3% | 全 0 ✅ |
| `probe-display.mjs` | 3.1 河 / 3.6 墙 / 4.1 群岛 / 4.3 凌霄 / 4.4 浮岛 | 五项全绿 ✅ |
| `probe-ward.mjs` | 按桶恒等式 `roof+thatch == gwall`、`blockroof == block` | 通过 ✅ |
| `probe-bare-ground.mjs` | 宫城无建筑裸地最大矩形 <90m | 实测 0 ✅ |
| `probe-acceptance.mjs` | 河面法线 +Y / 6 处射线命中 / 河道收口 / 云海随高度淡出 | 通过 ✅ |
| `probe-load.mjs` | 载入 ≤12s / 静态面 ≤13.5M / 堆 | 8.7s ✅ / 13.33M ✅ / 见下 |

**⚠️ 已四次证明单点采样不可靠**：`toPlayableMs`（页面墙钟≠载入）、`w.__loadStartAt`（取错对象恒 0）、
`usedJSHeapSize` 单点（2923MB 是 GC 噪声，三次复测 1.83GB）、`verify-packaged` 的 `calls`
（同一构建三次 608/460/597）。**凡是波动量，必须多次采样或受控扫掠。**

### 唯一未解的两条

1. **`compactStatic` 瞬时峰值 2261MB**（常驻 1411MB 已达标）
   - 实测：`pre 1541 → post 2261 → GC 后 1411`
   - 根因：按材质整组 `mergeGeometries`，**合并结果必须先全部存在，源才能释放**；`dispose()` 只放 GPU 侧，
     JS 侧 `Float32Array` 要等 GC，而 33 步连跑期间 GC 赶不上
   - 修法：自写按材质**增量合并**（预分配目标 → 逐源 copy → copy 完立刻置 null 断开引用 → 源按字节从大到小排序），
     峰值可从「目标 + 全部源」降到「目标 + 单个最大源」
2. **1.2 分区流式**——架构级演进项，不是缺陷，需单独立项

### 纪律（每次开新一轮先自查）

- 改源码**只用 Edit / Write**，**禁止 `python - <<'PY'` / `cat >` / `sed -i`**（`src/sky/flora.ts` 被写成 40KB 全零就是这条）
- **一个实例、一扇窗、一片瓦都不许删**（用户硬指令，2026-11-01）
- 优化必须同时证明「产出不变」：`assetAudit` 计数逐项相等 / 静态面可解释 / 两张同机位图无差异
- `b.kit` 台账是**永久机制**，修完不许删——`avenue.zhuquePost` 就是这样把河心悬空红柱一次定位到的
- 探针里凡是硬编码的几何假设（尺寸带、中心坐标），**必须配一条「命中数 > 0」自检**；
  天宫的 ×2.2 缩放已经坑过两次（4.3 侧墙带、4.1 centers 未换算）

---

## 2026-11-02 · 用户新指令（覆盖性，必须记住）

### 指令 1：干涉的房屋检测——保留高精度临街店铺，去掉低精度普通民房

> 「有些房子有相干涉的，干涉的房屋检测，保留高精度的临街店铺，去掉低精度的普通民房」

**这条明确授权"删掉相互干涉的低精度普通民房"**，覆盖此前「一个实例都不许删」的通用约束——
但**只覆盖这一种情况**：必须同时满足「确实互相穿插」**且**「被删的是低精度民房」。
- 高精度临街店铺（`emitShop`）**永不删**；
- tier0 完整院落优先保留；
- 删的优先是 `block`（tier3 体块）→ `simple`（tier1/2 简院）→ `wall/gate`。

### 指令 2：判据体系必须补「位置合理性」这一类

> 「你他妈截图测试审核的时候，没发现不合理吗？！」

此前 18 项判据全是"某个构件自己对不对"，**没有一项检查"构件之间/构件与地形是否放对了地方"**。
这是方法论层面的盲区，已开始补：

| 探针 | 查什么 | 现状 |
|---|---|---|
| `probe-water-clash.mjs` | 水上有人 / 河里建房 | **FAIL**：`actorsOnWater=11`、`buildingsInRiver=24`（agent-324 修） |
| `probe-house-overlap.mjs` | 房屋 OBB 相互穿插 | 待建（agent-325 建） |
| 待补 | 构件与地面高度关系（悬空/埋水）、树穿屋、船穿桥、人卡墙 | 未做 |

**根因记录（给以后）**：`imperial.ts` 的 `wardReserved()` 只在 `|z|<210 && |x|<960` 这个方块里保留河道，
`|x|>960` 之后没有任何河道保留判定 ⇒ 里坊把房子一路盖到河面上（最远到 ±5km）。

### 纪律补充

**新增一条**：任何"某类构件数量很多、随机放置"的系统（里坊院落、散布树木、摊位、船只），
都必须配一条**相互干涉普查**判据。只查"单个对不对"是不够的。

---

## 2026-11-04 00:2x–01:0x · 会话中断续跑（ZCode 接手，收口三件事）

> 背景：前会话（Kimi 三界漫游）在 H5 spike 途中中断（agent-432 状态 lost，600 帧复核因页面被导航毁掉未跑成）。
> 本轮由 ZCode 接续，先读全量历史（475 轮 / 221 子代理）再动手。

### ① H5 p95 归因 spike 收口（-1 风险验证第一个 spike）

- 复用中断前留下的 4182 dev 实例，重跑 `probe-p95-attrib.mjs` 600 帧×2 轮 → `artifacts/p95-attrib-600.json`。
- **结论推翻 200 帧初判**：dpr05 效应从 −8.25ms 缩到 −0.15ms（噪声带内），阴影/几何/HUD 全部无效应。三分支定性 = **呈现侧偶发错过 vsync（噪声）**，非 GPU 填充、非 CPU 提交持续压力。
- 口径警示已写进清单：dev 环境（p95≈25ms）≠ 打包态（58ms）；打包态复测列为 P3-1b 第一项；P3-5 像素比档位降级为「复测通过后才排期」。
- 完整表格与影响已落 `docs/重建-v2/全量工作清单.md` 的「H5 结论」节。

### ② P0-0 determinism 两个遗留缺口全部关闭

- **缺口①（中断时明说"尚未验证"）**：`npx vitest run` 补验 → **6 files / 81 tests 全绿**，`tsc --noEmit` 0 错。LEGACY_RNG 改 mulberry32 确认未破坏单测。
- **缺口②（"无人认领红灯"的收尾）**：`player.ts` 的 4 处 `performance.now()` 全部改为注入 `clock`（默认 `legacyClock`，行为不变，照 behaviors/crowd 的注入规矩）；`player.ts` 加入 `probe-determinism.mjs` 的 `SIM_FILES` → **A 类 4 文件全部 0 命中，RESULT=PASS**（该门第一次覆盖 player 且真绿）。
- B 类残留不变（`hells.ts:1462` / `flora.ts:778` 的 uTime uniform、`havoc.ts` Math.random×2、`boss.ts` ×1），仍待人工裁决，不影响 A 类。

### ③ 存量配置修复

- `package.json` 的 `build.directories.output` 从过期的 `release-v11` 改为中性的 `release`；版本化打包仍走显式 `-c.directories.output=release-vNN` 覆盖，工作流不变。

### 待办（按 v3 顺序，本轮未动大项）

- **-1 阶段其余 6 个 spike**：H3 龙 → H1 实体身份 → H2 碰撞预算 → H6 经济 → H4 存档 → H7 移动造物。
- **post 臂反常**（关后处理 +8.2ms，两轮一致）：机理未明，需单独实验。
- **SPEC-总账 1.2 分区流式**（唯一还红的账）、B8 换算副本、贴脸屋面、远景雾、云海时序。
- 白玉台「格栅笼」根系统：**仍需用户裁**（槛墙 vs 檐口屋顶）。
- 遗留 31 文件工作树本轮已锁 commit（见 git log）。

---

## 2026-11-04 02:xx · 全面审计轮（4 路集群 + 对抗审核 + F1 修复包）

> 主文档：`artifacts/SPEC-全面审计-20261104.md`。四路 agent 集群（联网检索/静态审核/探针实证/账本抽检）+ 对抗审核 A。

### 审计发现（新）

- **联网检索首次成功**（前会话持续 429）：6/6 任务有结果。最高价值：①打包态 58ms 头号嫌疑=软渲染回退/冷缓存（先跑 GPU 状态探针再谈归因）②LoAF 长帧归因 API ③onBeforeCompile 缓存键陷阱（已静态排查：全仓 8 处均静态注入，未触发）。
- **静态审核 P1×4**：蟠桃赏赐交互点坐标绕过 heavenPoint（玩法整体不可达）/ 无 webglcontextlost 处理（GPU 崩溃=永久黑屏）/ npcSweep O(车×4400人) 每 3 帧全量分配 / 击飞按 id 线性 find。P2×15 详见主文档。
- **探针实证**：水上行人 11→0、河里建房 24→0（历史项确认已修）；**新 FAIL：bridgeDeckOff=5**（虹桥带 3 人贴水面）→E3；**probe-grain 首次实测 26 坊全过**（CV 0.455）——账本 2.1「散落歪扭」欠账清掉；T_static 18,959,342 自洽。
- **账本抽检 8 条静态核验：0 假绿**（2 weak 为行号漂移）。
- **E4**：修复前构建 30s 窗 52×toFixed 运行时错误；修复后复测 0——不宣称已修，记「已消失+probe-error-stack 常驻把守」。

### 本轮修复（F1，全部实测）

- P1-1 蟠桃坐标走 heavenPoint（审核 A 纠 y=204 平台表口径）→ **probe-interact-reach 实测 dy=0**（113 点整类机检，骑龙浮空点 WARN 待设计裁决）
- P1-2 webglcontextlost/restored 提示 + boot().catch
- P1-4 launches 改 Map<Actor,LaunchState>（审核 A 核实无悬挂风险）
- P2-1 loadInt（0 值不再被吞）P2-2 interact 时钟+骰子 rng **纳管确定性门（A 类 6→7 文件全 0 PASS）** P2-3 boss HUD 缓存写 P2-4 战报队列封顶 P2-5 水Link 越界守卫
- 验证链：tsc 0 错 / vitest 81/81 / probe-determinism PASS / interact-reach PASS / error-stack 0

### 对抗审核

- 审核 A：APPROVE_WITH_FIXES，四条硬伤全部采纳修订（y 值/骰子 rng/F5 诚实化/LoAF 口径收窄）。
- **审核 B：本轮缺席**（子代理并发限制中断且会话失效）——如实登记待补跑，不假装审过。

### 下一步（按优先级）

1. **E3 桥面行人 y 对齐**（唯一探针红项）
2. **F4 打包态 GPU 状态探针**（58ms 归因前置，检索最高嫌疑）
3. E1 npcSweep 性能切片（探针护航）
4. 补跑对抗审核 B
5. -1 阶段剩余 spike：H3 龙 → H1 → H2 → H6 → H4 → H7

## 2026-11-04 03:xx · E3 关闭（判据假红）+ H3 一条龙 spike 收口

### E3：probe-water-clash 判据 C 的 5 个 off-deck 全部取证为合法状态

页内逐 actor 取证（x/y/z + freeze/attach + attach 回调源码特征）：
- z≈44–46 ×3：`vendor hawk` 叫卖摊主，freeze 定桩无 attach，站在**出河带引桥岸段**（虹桥半跨 48 > 河半宽 ~30.6，y=0 是岸面）——合法。
- z≈12 ×2：`musician/lady`，attach 回调含 `b.x`/`bob = sin(b.phase)`——**桥下过洞的船上乘客**（y=1.76=船甲板），合法。
- 桥带内 y=0 桥下穿行是 R27 明确设计。**曾加「推出到岸」分支后撤销**（会把合法行为改坏）；引擎零改动，探针判据 C 修正（排除船上人 onBoatDeck + 出河带岸段）→ **PASS（50 on deck / 0 off-deck）**。tsc 0 错。

### H3 一条龙 spike（-1 阶段第 3 个，前两个 H5/P0-0 已收）——✅ 一次全绿

- `creations/dragon/build.mjs`：手写程序化一条龙（蛇形放样 44 环×10 边 + 吻/角/眼/背鳍/尾鳍/四腿三趾），纯常量驱动零随机。
- 实测：**1,141 tri / 742 verts / 22,596 bytes**；`probe-creation-bundle --file` **RESULT=PASS**；**双跑逐字节 IDENTICAL**。
- 结论：**P2「agent 代码构建造物」路线成立，不降级部件拼装**（1,400 硬门禁预算合理；单造物手写 ≈180 行）。
- 详见 `docs/重建-v2/全量工作清单.md` 「H3 结论」节。

### -1 风险验证进度：3/7（H5 ✅ H3 ✅ P0-0 ✅）→ 下一个 H1 实体身份
