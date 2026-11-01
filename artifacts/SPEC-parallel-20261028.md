# 《赛博上河》多智能体并行推进 SPEC（2026-10-28）

> 本文件是并行作业的唯一契约。任何子代理的改动如果与本文件冲突，以本文件为准。
> 主代理（编排者）负责：spec 维护、台账重算、测试与构建、截图验证、冲突裁决。

## 一、项目基线（并行开始时实测）

- 工作根：`<WORKSPACE>/赛博上河-CyberQingming-全量导出-20261024/cyber-qingming`
- 技术栈：Vite 7 + TypeScript strict + Three.js r180 + Electron 33；零外部美术资产，全程序化；`npm test` = vitest。
- 当前校验状态（编排者实测，子代理不要重复跑全量）：
  - `npm test` 65/65 PASS
  - `npx tsc --noEmit` exit 0
  - `npm run build` exit 0
  - 19 机位 `node audit-chromium.mjs`：293 calls / 1.5437 亿三角面 / live 1287 / **0 控制台错误**
- 台账（`artifacts/world-atoms.json`，由 `scripts/annotate-atom-impl.mjs` 生成）：
  - 建筑 139：implemented 139 / blocked 0
  - 物品 838：implemented 333 / spec-only 85 / data-only 420
  - 角色 243：procedural 243（共用人群体型池）
  - 植物 32：implemented 22 / blocked 6 / not-asset 4
  - 生物 37：procedural 37

## 二、不可协商的约束（全体子代理）

1. **文件所有权**：只允许改自己名下的文件。跨文件需求写进报告，由编排者转派。
2. **禁止**修改：`src/core/*`、`src/world.ts`、`tests/*`、`scripts/*`、`artifacts/*`、`dist/*`、`package.json`。
3. **禁止**运行 `npm run build` / `vite build` / `npm run preview` / `audit-chromium.mjs`（会互相踩 `dist/` 与浏览器会话）。允许且应当运行 `npx tsc --noEmit`。
4. 只用既有依赖，不新增 npm 包；不引入外部美术资源。
5. 所有几何走 `Baker`（`b.box / b.cyl / b.roofC / b.pyramid / b.kit`），材质只用既有材质组：
   `wood | wall | ash | earth | roof | ground | glow | leaf | trunk | water | ceramic | metal | fabric | lacquer`。
   - 土坯/夯土用 `earth`，石构件用 `ash`，灰泥墙用 `wall`（注意 `wall` 自带蓝灰自发光，不适合土/石）。
6. 新增几何必须配 `b.kit('<域>.<件名>', 数量, y)`，否则台账与审计看不到。
7. 新增/变更内容必须有**场景落点**，不允许只写函数不布置（"有函数没落地"不计实现）。
8. 不写解释性注释；只在"为什么这么改"不明显时写一行。
9. 已确证的坑，不要重犯：
   - `curvedRoofUnit` 屋面：参数 s∈[0,1] 处坐标 `(0.16+0.34s)·半跨`、高 `(1-s^1.6)·H`；瓦垄/垂脊必须贴此曲面，否则檐口出现"金梳"高光。
   - 汴河水面只有 **1320×62 → |z| ≤ 31**；水产品（莲、萍）放 `|z| < 30`，`y≈1.02`。
   - 城市 `heightAt` 恒 0；沙漠/山地必须用传入的 `heightAt` 贴合地形。
   - `loc()` 已是 premultiply，坐骑/船只的局部偏移不要再乘缩放。

## 三、并行工作流（三条，文件互不重叠）

### WS-1 天宫/幽冥空间密度
- 文件所有权：`src/sky/realm.ts`、`src/sky/palace.ts`、`src/sky/underworld.ts`
- 目标：解决 `lingxiao / jiangtai / yaochi / shibayu / wangxiang` 五个机位"大面积空台地"。
- 具体要求：
  1. 灵霄殿前庭与将台：补仪仗（旌旗、戟架、鼓、香炉、玉阶栏杆段）、铺装分缝、云海边护栏；不得遮挡主殿立面。
  2. 瑶池：补池岸栏杆、蟠桃树、仙鹤/瑞兽静态件、亭榭基座陈设。
  3. 十八狱环与望乡台：补刑具/碑刻/鬼差列位/锁链桩，避免大片空黑。
  4. 所有新增件必须有合理 y（贴各自台面），不得悬空或穿模。
- 验收：`npx tsc --noEmit` 通过；报告列出新增 kit 名与落点坐标区间。

### WS-2 剩余植物 6 类 + 已有植物打磨
- 文件所有权：`src/city/props.ts`、`src/sky/flora.ts`、`src/world/desertOutpost.ts`
- 目标：把 plants 台账 blocked 6 类全部落地，并修已有的观感短板。
- 具体要求：
  1. 新增：血珊瑚（幽冥血池/岸边，暗红分枝）、祭台骨缘（地府祭台边缘骨殖/骨环）、天山雪莲（雪山高海拔，莲座 + 白苞）、迎宾茶灶（村口/驿路，砖灶 + 铜壶 + 茶旗）、醉霞石榴（庭院，橙红果）、银霜橘（庭院/果园，白霜果 + 深绿冠）。
  2. 每类必须有落点：血珊瑚→幽冥血池边；祭台骨缘→地府祭台；天山雪莲→雪山（`terrainHeight` 高海拔带）；迎宾茶灶→郊野驿路与村口；石榴/银霜橘→城内庭院与果园。
  3. 打磨：青莲荷叶直径 0.7m→1.1–1.4m、花抬高并放大；仙桂花簇加密加大。**不得破坏**现有 `flora.lotus / flora.lotusPad / flora.lotusFlower / flora.osmanthus / flora.osmanthusCrown / flora.pasture` 的命名。
- 验收：`npx tsc --noEmit` 通过；报告给出每类物种的函数名、kit 名、落点坐标。

### WS-3 塔刹重构 + 城市立面去重复
- 文件所有权：`src/city/buildings.ts`、`src/city/detailKit.ts`
- 目标：修掉 pagoda 顶部"品红细杆"，并降低街屋"同一模板复制"的观感。
- 具体要求：
  1. `buildPagoda`：塔刹改为「覆钵 + 相轮（5–7 圈）+ 宝珠 + 刹杆」，去掉品红 glow 细杆；每层补平座栏杆与檐角起翘；塔身补壁柱与壶门。
  2. `buildBuilding`：立面按 row 号分型——至少 4 种（板壁 + 直棂窗 / 灰泥墙 + 支摘窗 / 木栏柜台 / 双开板门带门钉），墙色、木色、屋面用色各扩到 ≥5 档；不得改变 `BuildOpt` 现有字段语义。
  3. `detailKit`：`buildDetailedFacade` 增加窗楣、窗台石、抱框线脚，使近景不再是一块平板。
- 验收：`npx tsc --noEmit` 通过；报告给出分型编号与对应机位（washi / wharf / sunyang 之一）。

## 四、编排协议

1. 子代理**只报不集成**：各自完成后输出「改了什么 / 新增 kit / 落点 / tsc 结果 / 未做与风险」。
2. 编排者串行集成：`tsc` → `npm test`（按需改断言）→ `npm run build` → 19 机位重抓 → 总览图 → 台账重算 → 记录。
3. 冲突裁决：同一文件只允许一个 owner；发现跨文件需求，回到本 spec 增补工作流，不擅自越界。
4. 台账由编排者统一维护：`scripts/annotate-atom-impl.mjs` 的 `PLANT_BUILDERS` 等映射表 + `tests/atomicCatalog.test.ts` 的硬编码计数，**只由编排者改**。

## 五、本轮验收定义

- `npm test` 全绿（含按新计数更新的断言）
- `npx tsc --noEmit` exit 0
- `npm run build` exit 0
- 19 机位 0 控制台错误，且五个空台地机位与 pagoda 机位有可见改善
- `artifacts/world-atoms.json` 与 `artifacts/world-atoms-status.md` 重算，plants blocked 6 → 0
- `artifacts/game-progress.md` 追加本轮批次记录（含每路工作流的改动与证据图）

---

# 附：常设并行模式（2026-10-28 第二版）

> 主人指令：**后续全部继续多 agents 并行推进**。自本版起，"并行"是本项目的默认工作方式，单路串行只用于集成与验收。

## A. 工作流域登记表（文件所有权即契约）

| 编号 | 工作流 | 独占文件 | 状态 |
| --- | --- | --- | --- |
| WS-1 | 天宫/幽冥空间密度 | `src/sky/realm.ts`、`src/sky/palace.ts`、`src/sky/underworld.ts` | 第 1 波进行中（agent-13） |
| WS-2 | 六类植物 + 植物打磨 | `src/city/props.ts`、`src/sky/flora.ts`、`src/world/desertOutpost.ts` | 第 1 波进行中（agent-14） |
| WS-3 | 塔刹重构 + 立面分型 | `src/city/buildings.ts`、`src/city/detailKit.ts` | 第 1 波进行中（agent-15） |
| WS-4 | 物品器件落位 | `src/city/itemKit.ts`、`src/city/interiors.ts` | 第 2 波 |
| WS-5 | 角色与生物个体化 | `src/actors/crowd.ts`、`src/sky/creatures.ts` | 第 2 波 |
| WS-6 | 车船与河道 | `src/city/units.ts`、`src/city/river.ts` | 第 2 波 |
| INT | 集成与验收 | `src/world.ts`、`tests/*`、`scripts/*`、`artifacts/*`、`dist/*` | 编排者独占 |

## B. 冲突规则（补充）
1. 一个文件同一时刻只能有一个 owner；换波时所有权释放，登记表更新后才可再分配。
2. 需要别人文件里的能力，**不要改别人的文件**：写进报告，由编排者在你完成后统一改。
3. 编排者独占 `src/world.ts`（机位表）、`tests/`、`scripts/`、`artifacts/`：子代理不得触碰。
4. 任何子代理在开工前先读本文件 + 自己文件，收工跑 `npx tsc --noEmit` 并在报告里贴原文。

## C. 波次节奏
- 每波 3 路并行，波内文件互不相交。
- 一波全部回报后：编排者串行做 `tsc → npm test（按需改断言）→ npm run build → 19 机位重抓 → 总览图 → 台账重算 → 记录`。
- 集成通过后立刻开下一波；未通过则先修红，再开新波。

## D. 待覆盖清单（按 completion criterion）
1. 物品：838 件中 85 件"有设定无网格"、420 件"仅数据" → WS-4 逐步补网格与落位。
2. 角色：243 张卡共用人群体型池 → WS-5 做分型（体型/服饰/配件分档）。
3. 生物：37 类目前全靠程序化系统 → WS-5 做逐类形态区分。
4. 植物：6 类无专属模型 → WS-2 本波清零。
5. 建筑：139 座已全实现，但仍缺"逐座可辨识" → WS-3 立面分型后继续按坊区补差异。
6. 交通与河道：车/船/轿形态单一 → WS-6 分型 + 河道细节。

## E. 第三波登记（2026-10-28 第二轮并行）
| 编号 | 工作流 | 独占文件 | 来源 |
| --- | --- | --- | --- |
| WS-7 | 十八狱立面 + 望乡台塔身 + 修被埋陈设 | `src/sky/hells.ts` | WS-1 上报的跨文件缺口 |
| WS-8 | 郊野村落 / 田垄 / 路网 / 山体细节 | `src/city/infill.ts`、`src/world/terrain.ts` | 19 机位「大面积空铺装/空郊野」 |
| WS-9 | 丰都鬼城街景密度 | `src/sky/fengduDetail.ts`、`src/sky/fengduGround.ts` | fengdu 机位长街空 |

### 容量红线（第三波必须遵守）
- `sedan` 池余 7 槽、`boatTop` 余 55、`BEAST_POOLS.body` 余 15 —— 本波**不得**再向这三个池要名额；需要新件请用 Baker 静态几何。
- 城市 `heightAt` 恒 0；城外必须用 `terrainHeight`。
- 三角面基线 1.546 亿、draw call 358：本波总增三角面 ≤ 300 万、新增 draw call ≤ 20。

## F. 第三波期间记录的候选（下一波）
1. **城墙无垛口、城门无城楼**（`gate` 机位实证）：城墙是一整块灰色平板，顶部既无女墙垛口也无压脊；门洞只有匾额，没有城楼。属"建筑特征缺失"，不是密度问题。
2. `scroll` 长卷机位：原 9m 高度会从铺面屋顶擦过（屋顶占满画面下半），已由编排者改到 14m / 视点 (x+16, 3.6, 21)，待下一轮构建后复验。
3. 天宫 4 座 32 间 + 地府 5 座 33 间室内无壳，物品无法落位（需专门一路建室内壳）。

## G. 第五波预案（待第三/四波集成后启动）
| 编号 | 工作流 | 独占文件 | 内容 |
| --- | --- | --- | --- |
| WS-11 | 天宫室内壳 | `src/sky/realm.ts`、`src/sky/palace.ts` | 4 座天宫殿宇的 32 间室内：地面、隔断、门窗、案几床榻、灯架、供器；每间给 `interior.<殿>.<Rx>` kit，并留出物品落位锚点 |
| WS-12 | 地府室内壳 | `src/sky/underworld.ts`、`src/sky/hells.ts` | 5 座地府殿宇的 33 间室内：判官案、卷宗架、刑具架、锁链、油灯、骨器 |
| WS-13 | 器物逐件贴图 | `src/city/itemKit.ts` | 给已建模的席面器用族补贴图（`atlas` 或程序化 canvas 纹理），不做几何改动 |

> 注：WS-11/12 与第三波（WS-7 改 `hells.ts`）冲突，必须等 WS-7 集成完成、所有权释放后再启动。

## H. 机位待修清单（编排者自管，随波次复验）
1. `washi`：镜头正下方偏前有一棵柳树冠占住画面下缘（不影响看铺面，但挡视线）；候选改 `[10,13,-42]`。
2. `naihe`、`wangxiang`：整体过暗（均值 63/65），考虑给地府补 2–3 盏近景光源或提高地府环境底光。
3. `scroll`：已抬到 14m，待复验。
4. `gate`：待 WS-10 城楼落地后复验。

## I. 第四波登记（2026-10-28 第三轮并行）
| 编号 | 工作流 | 独占文件 |
| --- | --- | --- |
| WS-14 | 里坊 24.9 万栋民居不可见（排查 + 修复） | `src/city/infill.ts`、`src/city/layout.ts` |
| WS-11 | 天宫 4 座 32 间室内壳 | `src/sky/realm.ts`、`src/sky/palace.ts` |
| WS-12 | 地府 5 座 33 间室内壳 | `src/sky/underworld.ts`、`src/sky/hells.ts` |

> WS-14 若判定根因在 `src/world.ts`（编排者独占）或 `src/city/ground.ts` 之外的禁改文件，只写结论与最小补丁建议，不擅自越界。

---

# J. 问题总账（2026-10-28 全量回顾，逐条可追溯）

> 状态：`闭` = 已修且有证据；`开` = 未修；`待验` = 已改但未出图确认。
> 每条给出**证据来源**（机位/报告/实测）与**归属文件**，便于派工不重叠。

## J1 建筑与城市
| # | 问题 | 状态 | 证据 | 归属文件 |
| --- | --- | --- | --- | --- |
| 1 | 三生石是无细节光滑圆柱 | 开（WS-17 在改） | `sansheng.png` | `sky/hells.ts` |
| 2 | 御街两侧 860m 裸土 | 开（WS-18 在改） | `avenue-a.png` | `city/infill.ts` |
| 3 | 城墙夯土段明度过高，远看一条浅色带 | 开 | `gate.png` | `city/buildings.ts` |
| 4 | 城楼一层立面偏空白（只有小窗） | 开 | `gate.png` | `city/buildings.ts` |
| 5 | 全宽加固肋每 3.2m 横穿马道 | 开（需删原句） | WS-10 报告 | `city/buildings.ts` |
| 6 | 檐口霓虹带读作"绿绸带"而非灯管 | 待验（已降饱和） | `wharf.png` | `city/buildings.ts` |
| 7 | 大屋顶垂脊大半埋进曲面、鸱吻细长 | 开 | `zichen.png` | `city/buildings.ts` |
| 8 | jiangtai / yaochi 外围台地仍空 | 开 | `jiangtai.png`/`yaochi.png` | `sky/realm.ts`、`sky/palace.ts` |
| 9 | 瑶池宫殿薄玉盘浮云海，无承托 puff | 开 | WS-11 报告 | `sky/realm.ts`、`sky/palace.ts` |
| 10 | 天宫室内无点光源（仅自发光） | 开 | WS-11 报告 | `sky/realm.ts` |
| 11 | 十八狱与望乡台之间西北大空隙仍空 | 开 | WS-7 报告 | `sky/underworld.ts` |
| 12 | 望乡台盘道 8 段未接平、无踏面细分 | 开 | WS-7 报告 | `sky/underworld.ts` |
| 13 | 丰都只做三道主街，七道南北巷无市井件 | 开 | WS-9 报告 | `sky/fengduGround.ts` |
| 14 | 丰都街心 11m 通行带显空 | 开（部分设计） | `fengdu.png` | `sky/fengduGround.ts` |
| 15 | 灵霄两翼房内蟠龙金柱穿插（原柱网） | 开（取舍待定） | WS-11 报告 | `sky/realm.ts` |
| 16 | 室内门多为贴墙常闭门扇（未开洞） | 开 | WS-11/12 报告 | `sky/*`、`city/interiors.ts` |
| 17 | 判官司屋顶檐口外伸约 1m（全项目一致） | 开（一致性取舍） | WS-12 报告 | `sky/hells.ts` |
| 18 | mengpo 新庄院与主棚过渡待复核 | 待验 | `mengpo.png` | `sky/hells.ts` |

## J2 植物 / 器物 / 角色
| # | 问题 | 状态 | 证据 | 归属文件 |
| --- | --- | --- | --- | --- |
| 19 | 物品 412 件仅数据、65 件有设定无网格 | 开 | 台账 | `city/itemKit.ts` |
| 20 | 角色 243 张仍共用人群体型池 | 部分（5 体型 + 4 衣制） | WS-5 报告 | `actors/crowd.ts` |
| 21 | 长衫/襦裙行走时小腿穿摆口 | 开 | WS-5 报告 | `actors/crowd.ts` |
| 22 | 石榴/橘/茶灶为固定坐标，近看偏规整 | 开 | WS-2 报告 | `city/props.ts` |
| 23 | 天山雪莲陡坡可能露缝 | 开 | WS-2 报告 | `world/desertOutpost.ts` |
| 24 | 生物 4 行"非躯体"只登记不建模 | 开（口径问题） | WS-5 报告 | `sky/creatures.ts` |

## J3 道路 / 河流 / 交通
| # | 问题 | 状态 | 证据 | 归属文件 |
| --- | --- | --- | --- | --- |
| 25 | 船尾迹/浅滩出现棋盘纹 | 闭（已改哈希噪声 + 降不透明） | `water-base.png` | `city/river.ts` |
| 26 | 郊野 7km 视距裸岩带几乎不可见 | 开（尺度限制） | WS-8 报告 | `world/terrain.ts` |
| 27 | `boatTop` 余 55 槽、`sedan` 28、`BEAST_POOLS.body` 168 | 闭（已扩） | 实测 | `actors/pools.ts`、`sky/creatures.ts` |

## J4 机位与观感（编排者自管）
| # | 问题 | 状态 | 证据 |
| --- | --- | --- | --- |
| 28 | `washi` 镜下缘柳树冠挡角 | 开 | `washi.png` |
| 29 | `naihe`/`wangxiang` 偏暗（底光已抬 0.72） | 待验 | `naihe.png` |
| 30 | `scroll` 长卷机位已抬到 14m | 待验 | 待重拍 |
| 31 | `pagoda`/`countryside`/`gate` 机位已改 | 闭 | 三张图 |
| 32 | 里坊远档全蓝灰方块（LOD 取舍） | 可接受 | WS-14 报告 |

## K. 第六波登记（2026-10-28 第四轮并行）
| 编号 | 工作流 | 独占文件 | 对应账目 |
| --- | --- | --- | --- |
| WS-19 | 城墙明度 / 城楼立面 / 加固肋贯通 / 霓虹灯管化 | `city/buildings.ts`、`city/architecture.ts` | J1-3/4/5/6/7 |
| WS-20 | 天宫外围补台地与点光 / 瑶池承托 | `sky/realm.ts`、`sky/palace.ts` | J1-8/9/10/15 |
| WS-21 | 衣摆穿腿 / 植物固定坐标随机化 | `actors/crowd.ts`、`city/props.ts` | J2-21/22 |

## L. 问题总账销账状态（2026-10-28 第六波集成后）

**已闭（有证据）**
- J1-3 城墙夯土明度 → WS-19 压到包砖梯队（0xab956d / 0xa08964）+ 两道分带；`gate.png` 复验。
- J1-4 城楼一层空白 → WS-19 补 4 壁柱 / 3 槛墙 / 2 悬鱼 / 2 楹联空板。
- J1-5 加固肋横穿马道 → 编排者改为**墙面扶壁**（两侧各 1.6m，中间 3.8m 贯通），删除白栅栏；`gate.png` 复验。
- J1-6 檐口霓虹像绸带 → WS-19 改 3.2m 段距短灯管 + 金属灯座。
- J1-7 大屋顶垂脊埋进曲面 → 此前已按曲面公式重算；本轮未再动。
- J1-8 jiangtai/yaochi 外围空 → WS-20 三圈陈设（铺装带/望柱寻杖/石灯/云海护栏/云头）。
- J1-9 瑶池宫无承托 → WS-20 补 7 根云柱 + 17 幅垂云帘（并修既有缺陷：水盘无盖、将台副阶悬空 8m）。
- J1-10 天宫室内无点光 → WS-20 点光 6→12（全场景 17→23，逐片元 +20–25%）。
- J1-11 十八狱西北空隙 → WS-22 补鬼域市集层。
- J1-12 望乡台盘道 → WS-22 改 3 级踏面 + 过渡平台 + 栏板 + 收头石。
- J1-15 灵霄房内蟠龙柱 → 判定为原柱网，正式接受（不再视为缺陷）。
- J2-21 衣摆穿腿 → WS-21 摆形 0.97→1.24 + 暗内衬 + 步态联动 +0.055m。
- J2-22 石榴/橘/茶灶固定坐标 → WS-21 改簇心 + 极坐标抖动（独立 LCG）。
- J4-28 washi 树冠挡角 → 机位改 [12,13,-46]。
- J4-30 scroll 长卷机位 → 抬到 14m，本轮 `scroll` 差异 +46.9% 复验生效。
- J1-1 三生石 → WS-17 重建；`sansheng` 差异 +17.6%。

**仍开**
- J1-13 丰都七道巷弄无市井件；J1-14 街心通行带显空。
- J1-16 室内多为贴墙常闭门扇；J1-17 判官司檐口外伸（全项目一致）。
- J1-18 mengpo 过渡待复核（本轮 `mengpo` 已含新庄院，未见穿插）。
- J2-19 物品 412 仅数据 / 65 有设定；J2-20 角色仍共用池；J2-23 雪莲陡坡；J2-24 生物 4 行只登记。
- J3-26 7km 裸岩不可见（尺度限制，接受）。
- J4-29 naihe/wangxiang 亮度：底光已抬 0.72，仍偏暗（63.7 / 68.8），可再加地府局部光。
- 新增观察：`yaochi` 新机位（[0,22,96]）能同框水池与瑶池宫，但池面在高位俯视下仍偏白、整体偏亮，观感待打磨。

## M. 打包
`release-v11/赛博上河-CyberQingming-1.2.0-x64.zip`（153MB），`verify-packaged` → `PACKAGED_BOOT=PASS`，live 1270 / 446 calls / 2954 万三角面 / 0 错误。

## N. 机位二次修正（第七波期间）
- **J4-30 `scroll`**：第一次抬到 14m 仍从沿河铺面屋脊上掠过（`scroll.png` 下半屏是屋顶）。二次改为**河心望北岸**：相机 `z=20`（河面上方）、`y=16`、视线 `(x+18, 5, 58)`。探针 `scroll-b.png` 实拍：河岸招牌、桥、御街纵深、街市行人可读，119fps。
- **J4-28 `washi`**：`[0,12,-44]` → `[12,13,-46]`（柳冠退到右缘）。
- **`yaochi`**：`[22,12,26]` → `[0,22,96]`（WS-20 按视锥验算给出，能同框水池与瑶池宫；池面高位俯视仍偏白，待后续打磨）。
