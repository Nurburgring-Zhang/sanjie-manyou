# R28 严苛复审与补全清单

> 复核口径：**只认文件与运行期证据，不认汇报**。所有结论都能指到具体源码行、台账键、
> Puppeteer 实机 JSON 或截图。生成时间见 `artifacts/r28-runtime.json` 的 `at` 字段。

## 一、为什么这轮必须重审

用户原话：「回顾历史信息并进行严苛的审核，还有那些命令没有完全达到、或者偷懒了、
偷工减料了？必须全部补全！！全部高质量的实现！！！」

此前多轮确实出现过「台账写满、画面没达标」「交付文档承诺的 ZIP / 清单不存在」
「`dist/index.html` 用 `file://` 打开白屏」等被用户当场戳穿的情况。因此本轮把
「宣称完成」与「可点开的交付物」严格绑定，并写入用户级底层门禁。

## 二、历史命令逐条复核（按轮次）

| 轮次 | 用户命令要点 | 复核结论 | 证据 / 本轮补全 |
|---|---|---|---|
| 起 | 读取 ZCode 会话 `sess_d3e9f8c3...` 全量历史 | 已完成 | `D:\workbuddy\zcode_session_d3e9f8c3_full.md`（约 18.4 MB）+ `_reader.html`（约 20.2 MB） |
| R19 | 房顶侧面空、临街无门窗、城内空地、相机自由向镜头方向移动 | 已完成但曾「台账满、画面未达标」，R20 追加真改 | `src/city/interiors.ts`、`src/game/player.ts`；R20 实拍复核 |
| R20 | 「上面这些个历史命令，你完整的按要求、严格执行了么？偷懒了么？？」 | **曾如实自认**：台账做满、画面没达标；随后改为只认文件不认汇报 | 隐藏 A/B 曾污染 305 张图 / 169 MB，已改按 uuid 精确还原；`pageErrors===0` 成为硬门禁 |
| R22 | 三界动植物、所有空地、房间起居资产、衙门规模、天宫金碧辉煌 | 已完成主体，但山上建筑内部与部分商业场所当时仍有缺口 → **本轮 R28 补齐** | 见本文第四节 |
| R23 | 午门内空、草地绿膜、皇宫植被少、大街绿膜、山形直上直下 | 已改真草叶 / 石板 / 缓坡 / 加密植被 | `src/sky/flora.ts`、`src/city/parks.ts`、`src/world/terrain.ts` |
| R24 | 午门结构、三界漫游×我的世界×孢子融合、巨型屋顶、方块布局、任意不规则草斑、山体天宫放大 | 午门假门洞已修；草斑改为任意自由轮廓；山体 ×2 完成；**但「山上建筑随山一起放大」成为 R28 新缺陷** | `src/city/freeBlob.ts`；`terrain.ts` 的 `MTN_R24_SCALE=2`；本轮改 `LM_METERS` 常量表 |
| R25 | 「融合玩法完整实现了么？？」 | **曾如实自认没有完整实现**：714 条是手写名号分组、战斗=加 45 XP 文本、骑乘=一次性挪位、建造/放置不存在、五个玩法标签只是按钮 | 重写 / 新建 `wishPlay.ts`、`wishBuild.ts`、`wishBlueprint.ts`、`wishPanel.ts` 等，目录扩到 2320 条 |
| R26 | WorkBuddy 全能力集成、生成提示文案、联网检索资料、多角度截图验证后热载入 | 8 步流水线与 8 机位验证真实存在；**但「联网检索」名不副实** → 本轮 R28 补齐 | `assetValidator.ts`；本轮新增 `wishResearch.ts` + 修 CSP |
| R27 | 士兵嵌墙 / 角色陷地 / 穿墙进室内；要有碰撞面；建筑植物角色要有破坏效果和破坏物理 | 本轮收口：全城静态实体台账 + 三层破坏 + 碎块物理 | 见本文第三节 |
| R28-① | 猫 / 皇宫 / 山 / 军队 / 天兵天将 / 特斯拉 / 飞船 / 外星人；内置资产复用；未命中联网检索设计生成 | 审计时 8/8 不命中、8/8 只生成 count=1 个通用原型、8/8 不联网 → **本轮全部真改** | 见本文第四节 + `r28-runtime.json` |
| R28-② | 山上建筑太大要缩小、主庙 5m 要放大变精致豪华、山上建筑内部陈设、全部店铺行业经营用品 | 审计时塔 713~1584m、主庙 5m 空壳、≥271 间铺面无行业用品 → **本轮全部真改** | 见本文第四节 |
| R28-③ | 深度分析并「全部应用」降负载技术，禁止中近景画质损失（举 DVS / VRS 为例） | VRS / DVS 在本项目技术栈**不能原样实现**，只能等效替代并如实标注；本轮落地可落地项 | 见本文第四、六节 |
| — | 「任务、项目完成后必须有明确的交付」 | 已写入用户级 / 项目级 MEMORY.md，本轮按 R28 完整包交付 | `README-DELIVERY.md` + `DELIVERY-R28-SHA256.txt` + ZIP / EXE |

## 三、R27 碰撞与破坏：本轮真修的根因链

1. **全城只有 3 类街屋有墙带**：`src/rt/collider.ts` / `ground.ts` / `runtimeAssets.ts`
   三套正式基础设施全工程零接线，`walkSurfaceY()` 只登记 `beltRoomSpecs` /
   `riverRoomSpecs` / `STREET_HOUSE_SLOTS`。→ 新建 `src/rt/solids.ts`，在
   `Baker.boxFast()`（约 69.6 万盒体的主路径）与 `push()` 两个入口登记**世界坐标 AABB**，
   天然免疫 `compactStatic()` 的顶点重排。
2. **薄墙判据**：把「殿宇主体」误判为墙会把殿内人群全推出。最终判据
   `h∈[1,24] && thin∈[0.18,3.6]`，长条压顶再要求 `wide<=thin*8` 排除。
3. **出生兜底 `pushOutOfBuildings` 后没有重查行走面**：新位置有 0.6~9.9m 台基却仍停在
   y=0，加载时 121 人陷地。→ 新增 `settleWalkPos()`（与 `collisionAudit()` 完全同口径），
   并在首帧 `settleAll()` 一次性收敛（实机 checked=4510、fixed=163、failed=0）。
4. **桥面两套剖面不一致**：`keepOnBridgeDeck()` 用 `bridgeDeckY(z)`（z=4.07 → 9.04m），
   而 `walkSurfaceY()` / 审计用 `bridgeDeckYAt(x,z)` + `solidFloorY` 叠加（同点 9.87m），
   逐帧把桥上行人贴到旧曲线，15~17 人恒被判陷地 0.83m。→ 直接取与审计同源的
   `walkSurfaceY()` 作为目标面。
5. **桥端外 10m 带误杀**：旧逻辑把 `y∈(0.4,9)` 一律归零，把站在街屋台基/楼板上的
   人打回街面，与兜底形成永久拉锯。→ 只有脚下确无更高可行走面才归零。
6. **奇偶轮转残留**：`(frame+id)%2` 没轮到的那一帧，`id=1490` 会瞬时嵌墙
   （frame=3 实测 `blockedOwn=true / wsOwn=null`）。→ 落位兜底改每帧。
7. **破坏物理证据被浏览器定时器节流**：外部采样 30 帧全读到落地静止值 8.762。
   → 在固定步 `step()` 内部逐 y 记录同一块碎块 `physicsTrace`（实机 600 步、75 个不同 y，
   1.219 → 0.697 落地静止），由物理引擎自证，不依赖墙钟采样。
8. **A+B 双破坏全做**：`damage/solid 摘除 + Vfx 碎屑`（A）与
   `真几何变形 + 256 容量 InstancedMesh 碎块重力落地堆叠 + 植物倒伏 + 角色受击物理`（B）
   同时落地，空闲 `visible=false && count=0` → 零常驻 draw call。

## 四、R28 三组命令的本轮真改

### ① 造物能力（`src/game/`）

- `wishCatalog.ts`：`WISH_RULES` 8 条 + `classifyWish()`；多字词优先、单字「山」放最后。
- `wishAgent.ts` / `assetPipeline.ts`：`classify()` 不再被预设条目通用描述污染；命中内置
  资产走 `reuse` 快路径（实机 `steps=["lookup:ok","reuse:ok","done:ok"]`、`reused=true`）。
- `wishForge.ts`：`buildCat / buildPalace / buildMountain / buildSoldier / buildCar /
  buildSpaceship / buildAlien` 八个专用建模 + `forgeMany()` 复数实体；军队 24、天兵天将 36。
- `wishResearch.ts`（新建）：真实 `fetch` + 8s 超时 + URL 只放行 http/https，解析
  Brave `web.results` / Serper `organic` / Bing `value` / 公开参考页，按白名单填
  `ResearchCard`；缺失字段标「未检索到」，绝不编造；默认关闭时如实 `bridge=offline`。
- **CSP 真修**：`vite.config.ts` 的打包态 CSP 原为 `connect-src 'none'`，实机控制台
  明确报 `Refused to connect because it violates ... connect-src 'none'`，联网检索在浏览器层
  被硬阻断。改为放行 `http: https: ws: wss:` **scheme**，但不含 `'self'` 也不含 `file:`，
  因此 P0-8 要防的 `fetch('file:///C:/Windows/win.ini')` 依旧被拦，安全目标不变。
- `designFromResearch()` 把检索到的配色 / 尺寸 / 结构 / 能力真写进 `DesignDoc`，再由
  `specFromPipeline` 写进 `WishSpec`，不是「存起来不用」。

### ② 比例、陈设、全城商铺（`src/world/` + `src/city/`）

- `terrain.ts`：`LM_METERS` / `LM_KIND_METERS` 把 8 类地标钉到固定米数，与山体 `m.r/m.h`
  彻底脱钩。泰山塔 ≈713m → ≈30m，昆仑塔 ≈1584m → ≈30m；主题标志建筑 → 9~27m。
- 山顶主庙：`16×5×10m` 空壳 → `32×14×20m`，补须弥台基、月台丹陛、重檐庑殿金瓦、
  朱柱格扇、匾额、敞开明间；内部 22 件高档陈设。
- `mountainInteriors.ts`（新建）：高/中/低三档器物库，坐标 hash 选件，零共享 RNG。
  实机台账 `mt.interior.building=170`、`mt.interior.items=1211`、`mtn.landmark.count=112`。
- 商铺：既有 2894 间 `TRADE_KIT` 覆盖保留；本轮接入宫前 74、宫后 117、自动地块 151。
  实机 `shopint.shopAll=3242 === shopint.shopStocked=3242`，
  `shopint.stockItems=91743`，三个来源 `.all === .stocked` 逐项相等 → **100% 覆盖**。
  宫前/宫后铺面由实心墙改 hollow 壳 + 板门推开，经营用品从街面可见。

### ③ 渲染 / 互动性能（`src/core/` + `src/actors/pools.ts` + `src/city/bake.ts`）

- 真实落地：空间分块索引 + `ChunkGate` 远景分区视锥剔除（`PERF_NEAR_GUARD=400`：
  ≤400m 连 `visible` 都不碰）、静态阴影缓存（`shadowMap.autoUpdate=false` + 位移/旋转/
  脏标记/帧预算门控）、帧预算三档调度（只调远景/阴影/反射**更新频率**）、对象池
  矩阵/颜色分开标脏、WebGL2 遮挡查询能力检测 + CPU 侧 PVS。
- 中近景保护：`pixelRatio / composer 分辨率 / shadow.mapSize / shadow.camera /
  LOD 距离 / 几何贴图 / logarithmicDepthBuffer` 全部不动（实机 `protection` 全 true）。
- `window.__perfBudget()` 暴露全量统计，可断言 `chunkGate.culledFarObjects`、
  `shadow.skippedFrames`、`pools.colorUploads <= matrixUploads`。

## 五、注释 / 台账问题三分类（不能一律叫「造假」）

**① 注释与代码不符 / 名不副实**
- R26 `onlineResearch()` / `fetchSpec()` 名为「联网检索」，实际只拼 `/chat/completions`，
  无真实搜索 API、无网页抓取、无 URL 校验 → 本轮由 `wishResearch.ts` 真 `fetch` 取代。
- `vite.config.ts` 注释写「本游戏零联网」——R28 起已不成立，本轮同步改写。

**② 注释如实，但记录的是降配 / 范围不足**
- 离线降级如实标 `bridge='offline'`、不冒充联网：注释诚实，但「联网检索」本身当时没实现。
- `assetValidator.ts` 无 WebGL 时 `ok:true, views:0`：如实标注未做截图验证，属降配而非造假。
- `buildTradeInterior` 注释没声称覆盖全城，实际只覆盖 centralbelt + riverbank 2894 间，
  范围不足 → 本轮补齐到 3242 间。

**③ 历史自认 / 已修复留证**
- R25 自认「战斗=加 45 XP 文本 / 建造放置不存在 / 五个玩法标签只是按钮」→ 已重写。
- `pool_spear` 槽位不足导致 async 世界初始化中断、实拍半残 → 已扩容，`pageErrors=0` 成为硬门禁。
- 隐藏 A/B 第一版把原本隐藏的 LOD / 异界网格设为可见，污染 305 张图 / 169 MB → 已改 uuid 精确还原。
- `RuntimeAssets.nearby()` 曾被误读为现成索引，实际零 `new` / 零 `ingest` → 改自建 `solids.ts`。

## 六、如实标注：没有「全部原样实现」的部分

1. **VRS 可变速率着色**：WebGL2 无公开扩展、WebGPU 核心也无 shading-rate 特性，
   应用层无法原样调用。等效替代是帧预算调度（只调远景/阴影/反射更新频率）。
   `window.__perfBudget().vrs.implemented === false`。
2. **DVS 延迟顶点着色**：Arm Mali 硬件术语，应用层不可调用。等效替代是分区视锥剔除 +
   空间分块索引。`dvs.implemented === false`。
3. **WebGL2 occlusion query**：扩展真实检测过，但 proxy draw call 会污染
   EffectComposer / logarithmicDepthBuffer 的 GL 状态，故 `queryWired=false`，
   降级为 CPU 侧 PVS 粗判，如实记 `mode='pvs'`。
4. **Worker 剔除**：`culling.worker.ts` 纯函数已实现，但接线需改 `main.ts` 构建配置，
   本轮 `wired=false`，走同步 `ChunkGate`。
5. **远景半分辨率 / 动态分辨率**：会波及中近景，违反硬约束，未采用。
6. **CPU 压紧 InstancedMesh.count**：动态实例按固定槽位 id 写矩阵，压紧会重排导致
   槽位/颜色错位（画质损失），改用渲染前一瞬 `visible=false` + render 后 restore。
7. **复数愿望实体**：24/36 个实体各自是合批 Mesh（经既有对象池落场），未改
   InstancedMesh —— 因为每个实体要独立承载五阶进化/吞噬/合成状态。已用「首件 8 机位
   验证、其余复用报告」把离屏开销从 N×8 降到 1×8。
8. **商铺台账口径**：`shopAll` 统计的是经 `buildTradeInterior` 管线生成的铺面；
   9 座 `hasInterior` 手工室内壳是既有完整室内，不进该管线（本身已完整陈设）。
9. **山顶地标「修前」米数**取只读审计实测值 713/1584m；按现 case 系数折算是
   772/1716m，二者同量级，不冒充精确测量。

## 七、实机硬门禁与交付

- `npx tsc --noEmit` 0 错；`npm test` 23 files / 230 tests 全绿。
- `npm run build` 产物：`dist/assets/index-Co4KIqUG.js` + `index-zJ-JsaHs.css`
  （最终以 `dist/index.html` 实际引用为准）。
- 验收脚本：`scripts/r27_collision_acceptance.mjs`、`scripts/r28_acceptance.mjs`、
  `scripts/r27_visual_compare.mjs`；原始 JSON：`artifacts/r27-collision-runtime.json`、
  `artifacts/r28-runtime.json`。
- 交付目录 / ZIP / EXE / 全量 SHA-256：见 `README-DELIVERY.md`。
