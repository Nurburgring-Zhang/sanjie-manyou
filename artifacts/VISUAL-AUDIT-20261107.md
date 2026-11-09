# 全量视觉审核台账 · 2026-11-07（三视图 + 斜 45°）

> 范围：建模 / 贴图 / 渲染 / 角色 / 建筑 / 植物 / 环境 / 动作 / 互动 / 交互 / 运动 / 战斗 / 收集 / 升级。
> 口径：按**视觉原型 + 关键场景**逐个出四视角（正视 front / 侧视 side / 俯视 top / 斜 45° iso），
> 而不是对 4500+ 实例逐件重复拍摄（同一原型由同一段生成器产出，逐件拍不增加信息）。
>
> 基线：`be0226e`（审核开始时 git 干净）；dev server `http://127.0.0.1:4182/`（vite，源码实时）。
> 审核素材：`screenshots/va-20261107/`（32 目标 × 4 = 128 张 + 32 拼版）、
> `screenshots/va-20261107-r2/`（25 目标 / 82 张，含修正机位与玩法状态）。
> 复拍素材：`screenshots/va-after-20261107*` / `screenshots/va-final-20261107*`（同机位前后对比）。
> 归因 A/B：`screenshots/va-ab/`；脚本 `scripts/_va_*.mjs`（均被 `.gitignore` 排除，可复现）。
> 质量基线（修复后）：`npx tsc --noEmit` 0 错；`npm test` 15 files / **137 tests 全绿**；复拍页面错误 0。

---

## 一、审核方法

1. 运行时探针读取 `window.__qingming`（engine / world / scene）：621 个命名对象、450 个 InstancedMesh、348 draw calls / 25.87M triangles。
2. 每个目标：`world.teleport(key)` 取 `engine.lookTarget` 为中心，或直接用给定 center；
   四机位按半径 r 计算，写入 `camera.position` + `yaw/pitch` 后截图。
3. 地下 / 浮岛场景加 `lift`（抬升上限）：初版 top 机位 `center.y + 1.2r` 会钻出地府顶板或穿进云台，
   导致 4 张里 3 张纯黑；第二轮限制 lift 后全部可见（**机位方法问题，不是产品缺陷**）。
4. 拼版仅用于快速筛选；**所有结论都用原尺寸单图复核**。
5. 新增：**运行时 A/B 归因**。对每个"看着不对"的现象，不改源码、在浏览器里直接
   关网格 / 换着色器 / 改参数连拍，先证明根因再动手。本轮 5 组 A/B 推翻了 3 条初判根因（见 §三）。

### 误判剔除（留档，防止再犯）

- **阎罗殿牌匾被柱子遮挡**：拼版缩略图里牌匾中央有深色竖条，一度判定为 11-06 用户报障复发。
  放大 `hell2__hell_yanluo__iso.png` 后确认「閻羅殿」四字完整清晰、无遮挡；
  `front.png` 拍到的是**殿背面**（该视角本就没有牌匾）。历史提交 `21dd087`（匾外移至 Z1+2.35 柱前悬挑）**有效**。
- **地府四视角纯黑（初版机位）**：属机位问题，已用 `lift` 修正。
  ⚠️ 但**修正机位后仍存在的上半幅纯黑**不是机位问题，是真实缺陷 V-03，见 §三。

---

## 二、缺陷总表（V-01 … V-12）

| ID | 类别 | 现象 | 证据（原图） | 最终根因 | 状态 |
|---|---|---|---|---|---|
| V-01 | 渲染·远景 | 地平线上 3–4 座**浅灰米色、光滑无纹理、无植被**的梯形/双峰山体，像未上贴图的低模纸板 | `city__bridge__side.png`、`world__skypan__front.png` | 七岳在 15–30km 外，低机位全局 `FogExp2` 密度≈0.0002，按平方衰减 15km 处雾因子≈1，**整个山体只剩雾色**；`biomeColor` 的林带/岩带/雪线与「黛青」顶点色根本到不了屏幕。A/B：`terrain.material.fog=false` 后绿色林带/裸岩/冷灰雪顶立刻全部显形 | ✅ 已修 |
| V-02 | 渲染·水体 | 汴河水面是**规则密集竖条纹**（条纹布 / 百叶窗），缺自然波纹 | `city__bridge__side.png`、`detail__det_water__iso.png` | 三个叠加原因：① 主层 `makeWaterNormal` 的 4/9/12 纯正弦在 `repeat(13,2)` 下给出宽条带；② 高频层 `makeWaterRipple` 的 11/19/29 纯正弦在 `repeat(96,16)` 下给出细条纹；③ 旧 `96:16` 与主层 `13:2` 在 v 向成整数比 8，tile 边界同步。分层隔离 `_va_water_ab.mjs` 逐层证实 | ✅ 已修 |
| V-03 | 环境·地府 | 地府上半幅**纯黑无层次**，读成"没有洞顶" | `hell2__hell_fengdu__front.png`、`hell2__hell_fengdu__SHEET.png` | **不是天幕色**。A/B：把穹顶片元着色器强制刷成纯绿，上半幅仍全黑（只有一条岩缝透绿）；隐藏穹顶后仍全黑。黑色来自 `buildUnderCavern()` 四块近黑岩顶板：板底法线朝下只吃 `hemi.groundColor`，太阳强度被压掉 92%，再叠近黑雾 | ✅ 已修 |
| V-04 | 建模·建筑 | **大片裸露黄褐/米色空地**：虹桥两岸后方、城门内外、紫宸殿广场、御街两侧 | `city__gate__SIDE.png`、`city__zichen__SHEET.png`、`va-final-20261107/world__skypan__front.png` | 历史 `SPEC-R2 / R14 / R15 / R18` 均判定「不正常」，需大规模填充生成 | ⚠️ 未修：见 §五 |
| V-05 | 建模·建筑 | 部分主体立面是**无门窗/柱列的纯色平板**：孙羊正店方形塔楼、阎罗殿背面暗红墙 | `city__sunyang__side.png`、`hell2__hell_yanluo__front.png` | `SPEC-R16`（雕梁画柱级）、`style-bible.md` §4 | ⚠️ 未修：需接入 `buildDetailedFacade` |
| V-06 | 贴图·屋顶 | 若干大屋顶**中央顶面是粉褐/浅灰纯色平板**，与四周深灰瓦垄反差明显 | `city__sunyang__side.png`、`detail__det_actor__iso.png` | **Prior「疑似另有平顶壳体/材质分组覆盖」已剔除**。E-05 从该机位打 25 条射线全部命中同一 `city_roof_5` 合批 mesh，法线连续变化（`[0.98,0.18,0]`/`[0.32,0.95,0]`/…）、顶点色 0.015–0.084 且三顶点近似相等 → 平板就是 cap 顶面本身。真根因：`bake.ts:365-370` cap 的 v 钉死在 `sv*0.94`/`sv*0.86` 一条窄带，无纵向瓦垄 | ✅ 已修：只改 6 个 UV 的 v 实参为随 k 线性展开（front∈[0.50,1.00]·sv、back∈[0.10,0.70]·sv），**0 面 / 0 draw / 0 顶点增量**（红队冲突 6） |
| V-07 | 环境·郊野 | 城外矩形地块俯视密布**规则黑点**（村落/田块缩成噪点） | `va-final-20261107/world__skypan__top.png` / `iso.png`（复拍仍在） | 根因代码级成立：`infill.ts:3486-3499` 1.7m 细垄 aliasing + `terrain.ts:2001 d<6200 continue`，**不是树**（G-04）；「是否走样成黑点」需 200m/900m 两档 A/B，现象面维持疑似 | ⚠️ 排期：改 `fieldPlot` 会动 `country.ridge` kit 计数，须同步资产清单 |
| V-08 | 角色·人口 | 天宫浮岛圆盘**空旷无神仙/陈设**，殿前广场人流稀疏 | `heaven__lingxiao__top.png`、`sky2__sky_nantianmen__iso.png` | 用户 11-06 报障；`SPEC-R12-D`（天宫 ≥300 人） | ⚠️ 排期：新增 crowd 实例违反 D7 §3.1「实例不变 live 4,495」，红队驳回本轮修法 |
| V-09 | 建筑·形制 | 南天门读成**巨大紫褐方盒 + 空圆台**，比例怪异 | `sky2__sky_nantianmen__SHEET.png` | 紫褐 = `realm.ts:182-184` wall 组 `emissive 0x3a3d48` 染褐土（W48 只修凌霄殿未修门楼）；比例 0.74:1 倒挂（`expansion.ts:101-103`）。材质组修法零增量，但**必须整包同步 `expansion.ts:222 'city_wall'→'city_wood'`**，否则 44×8×18 实心盒重新堵死门洞 | ⚠️ 排期：先做 G-08 共享常量 + `__gateCut` 门中断言，再动材质组；调 R/h 增面已驳回 |
| V-10 | UI | 顶部一条**红色细横条**（Boss 血条），右下竖排告示文字挤压重叠 | `play__voxel__SHEET.png`、`_va_probe.png` | **Prior「右下告示为 3D 招牌」已剔除**：E-01 `elementsFromPoint(1520,800)` 命中 `#poiguide`（rect `[1480,754,80,129]`，文本含动态距离「42m」）与 `#skip`（`[1467,779,113,31]`）两 DOM 矩形实测相交；3D 招牌不可能被 `elementsFromPoint` 返回。**「默认常驻红条」亦证伪**（E-01 `opacity='0'`），真因是 Boss 状态机无 `idle` 回退 + `#bossbar` 挂 `document.body` | 🟡 部分修：血条改挂 `#ui`/z=24/宽 420、脱战回 idle、击败后 3s 淡出已落地；**两个 DOM 相交属 UI 布局，交第 3 轮验收复核后排期** |
| V-11 | 贴图·招牌 | 个别招牌从背面看**文字镜像** | `world__crowdnear__front.png` | **Prior「单面 quad 缺木背板」与代码不符**：真机制是两 quad 共面 + `DoubleSide` + `bake.ts:1613` 未设 `depthWrite:false`（G-06）。**V-10 右下告示是独立现象，不得并入本条** | ⚠️ 排期：原「单 quad + `gl_FrontFacing`」修法会减半招牌面数 + 改 shader program，红队驳回；零增量的 `depthWrite:false` 需先跑运行时 A/B |
| V-12 | 环境·植物 | 近景树冠是**光滑深绿低模半球** | `detail__det_actor__front.png` | **「半球」订正**为三层圆锥 / 7×4 扁球（`pools.ts:512-516`，G-02）；「leaf 无 uv / leafTex 失效」是 `bake.ts:1480-1482` 注释自认「会重刷全城植被，本轮不动」的**有意取舍**，补 UV 改顶点属性 + 重刷全城 + 违反像素验收 | ❌ 剔除为设计取舍，不修 |

---

## 三、运行时 A/B 归因（本轮最重要的方法产出）

> 所有 A/B 都在同一机位连拍，脚本在 `scripts/_va_dome_ab.mjs` / `_va_fog_ab.mjs` /
> `_va_haze_ab.mjs` / `_va_water_ab.mjs` / `_va_rip_ab.mjs` / `_va_rip_combo.mjs`。
> 这些脚本与截图均被 `.gitignore` 排除，不进仓库。

| 实验 | 操作 | 结论 |
|---|---|---|
| 地府天幕 | ① 直接改 `uTop/uMid/uBot` ② 把穹顶片元着色器替换成固定纯绿 ③ 隐藏 `skyDome` | ① 被 `applyLighting` 每帧重设、完全无效；②③ 上半幅仍黑，只有一条岩缝透绿 → **黑源是岩顶板几何，不是天幕**。台账 V-03 根因据此改写 |
| 远山雾 | ① `terrain.material.fog=false` ② 改雾色 ③ 降雾密度 | 关雾后七岳立刻显出完整绿色林带/岩带/雪线 → **V-01 是雾吃掉了顶点色**，只改 `biomeColor` 常量无效 |
| 远距雾化调参 | 给 terrain 单独换雾化曲线，试 3 组参数（密度 0.00006/0.000045/0.000075、上限 0.86/0.80/0.90） | 采用 C：密度 0.000075 / 上限 0.90 / 雾色 `0x6a7788`，山体冷黛青且保留层次，近城不受影响 |
| 水面分层 | ① 只留主层 ② 只留高频层 ③ 恢复两层并打乱主层 UV | 主层给宽条带、高频层给细条纹 → **两层都要改**；第一版修复后重跑，发现新加的 `wave` 正弦又把细条纹请了回来 |
| 高频层重复数 | `94×15 → 38×7 → 18×4 → 9×2`，再试各向异性 16 | 高密度 repeat 在长河掠射角把值噪声规则格点压成摩尔条纹；`11×3 + aniso 8 + opacity 0.26` 最干净 |

**踩过的坑（工程留档）**：Three.js 在 `onBeforeCompile` 阶段雾代码仍是 `#include <fog_fragment>`、
尚未展开，按展开后的字符串做 `replace` 是静默空操作。必须替换 **include 指令本身**，
并在探针里断言 `parsFound / fragFound` 都为 true。

---

## 四、本轮已落地的修复（V-01 / V-02 / V-03）

全部是**材质 / 颜色 / UV / 片元着色**级改动：不新增几何、不改生成架构、不动 build 流程、不加点光，
因此不触碰 137 条单测与 determinism 的几何口径，也不增加三角面预算。

| 文件 | 改动 | 理由 |
|---|---|---|
| `src/world/terrain.ts` `biomeColor` L887-894 | 大气透视目标色由暖米灰 `0xc8bfa8` 改为**山体黛青冷灰 `0x77828e` / 平地暖色 `0xb8ac94`**，按 `h>20` 区分权重 | 兑现注释「远山如黛」的原意（配合下面的远距雾化才真正可见） |
| `src/world/terrain.ts` `buildTerrain` 材质 | 给 `terrain` 网格 `onBeforeCompile` 注入**远距雾化**：<3km 沿用全局暖雾、`3–9km` 平滑过渡、`>9km` 用密度 `0.000075` / 上限 `0.90` / 雾色 `0x6a7788`；`customProgramCacheKey = 'terrain-far-haze-v1'` | 让 15–30km 的七岳顶点色真正到屏幕，既保留大气透视又留住林带/岩带层次；**只作用于地形网格**，全城建筑雾照旧 |
| `src/city/river.ts` `tileHash` / `tileNoise` | 新增模块级**可平铺值噪声**（格点按 nx/ny 取模，u/v=0 与 1 精确接边，无 tile 缝，不用 RNG） | 两层水面贴图共用，替掉所有纯正弦 |
| `src/city/river.ts` `makeWaterNormal` | 主层从 3 条正弦改为两级值噪声 `tileNoise(4,8) + tileNoise(12,16)` | 消除 `cos(v*12+u*3)` 在河宽方向的 24 条等距宽带 |
| `src/city/river.ts` `makeWaterRipple` | 高频层改为**完全无正弦**的三级值噪声 `(5,10)+(14,22)+(32,32)`；`anisotropy 4→8` | 消除 11/19/29 谐波条纹；nx<ny 的拉长格点表达顺流方向 |
| `src/city/river.ts` 构造 / 材质 | `ripTex.repeat 96×16 → 11×3`（与主层 13×2 全非整数比）；`rippleMat.opacity 0.34 → 0.26` | 消除高密度重复在掠射角下的摩尔条纹，并降低叠加层把噪声格点推成可见条纹的强度 |
| `src/sky/underworld.ts` `buildUnderCavern` 岩顶 | 四块 slab 从同色近黑（`0x241c17×0.92` / `0x322c26×0.7`）改为**外圈→内圈逐级提亮的冷灰岩** `0x4a4048 → 0x706872`，ash 薄板（实际可见的板底）取主色、earth 实体压暗成板缝阴影 | 板底是朝下的面、只吃 `hemi.groundColor`；提亮后 120–210m 仰视能读出四级穹顶层次 |
| `src/world.ts` 地府配色 L192-203 | `_underFog 0x1a0508→0x201c2c`、`_underGnd 0x101820→0x36404e`、`_underTop/Mid/Bot` 由近黑改分级冷紫青 | 雾给远处岩层一层幽暗冷光、groundColor 照亮所有朝下的面；天幕只做岩缝/穹外暗底 |

### 客观前后对比（`scripts/_va_compare.mjs`，浏览器 canvas 逐像素统计）

| 指标（裁剪区） | 修复前 | 修复后 | 判读 |
|---|---|---|---|
| 远山平均 RGB（`city__bridge__side` 左峰） | `(177.6, 158.6, 139.5)` 暖米灰、R≫B | `(118.1, 132.6, 137.7)` 冷黛青、B>R | 色相翻转，兑现「远山如黛」 |
| 远山明度标准差 | `8.2`（几乎纯色） | `22.9`（2.8×） | 林带 / 岩带 / 雪线层次回来了 |
| 水面条纹能量（前景河面列均值高通残差） | `0.38` | `0.23`（−39%） | 规则条纹大幅削弱；`det_water__iso` 同指标 `0.68→0.57` |
| 地府洞顶平均 RGB（`hell_fengdu__front` 上 2–30%） | `(10.8, 0, 1.1)` | `(19.3, 15.9, 34.7)` | 从纯黑变成深紫青洞顶 |
| 地府洞顶平均亮度 / 标准差 | `3.4 / 1.7` | `19.1 / 3.6` | 亮度 5.6×，出现可见岩层分层 |

**复核图**：`screenshots/va-final-20261107/city__bridge__side.png`（远山 + 水面）、
`va-final-20261107/world__skypan__front.png`（远景无雾接缝）、
`va-final-20261107-r2/detail__det_water__iso.png`（水面无规则条纹）、
`va-final-20261107-r2/hell2__hell_fengdu__front.png`（洞顶层次）。
页面错误 0；`npx tsc --noEmit` 0 错；`npm test` 137/137 全绿。

---

## 五、未修项的处置原则（为什么不擅自改）

- **V-04 空地 / V-05 平板立面 / V-08 人口 / V-09 形制**：都要新增几何或改生成器
  （`infill.ts` / `buildings.ts` / `palace.ts` / `crowd.ts`）。当前已是 25.87M 三角面 / 348 draw calls，
  且 `git == origin/main`、137 测试全绿。在没有新的性能预算与验收断言前批量加建筑，
  会直接违反 `docs/重建-v2/D7-性能与预算.md` 与「机检红不得标完成」的纪律。
  建议排入 P1-6 / P4 美术段，逐批加、每批复拍 + 跑基线。
- **V-06 屋顶平板**：`buildCurvedUnit` 的脊顶盖本身有条纹，需先用 `THREE.Raycaster`
  从 `city__sunyang__side` 机位打中心射线，取首个命中的 mesh 名 / instanceId / 材质，
  确认是「另一块平顶壳体」还是「材质分组覆盖」再动手；盲目改 `bake.ts` 会影响全城 1367 顶曲面屋顶。
- **V-10 UI / V-11 招牌 / V-12 树冠**：单点、低风险，但需先定位 DOM 层与对应 kit，适合下一批。
- **V-07 黑点**：复拍 `world__skypan__top/iso` 仍在，需 LOD / 尺寸分档，属几何生成器改动，同 V-04 一并排期。

---

## 六、审核覆盖清单

- **初审**：57 个目标 / 210 张图（32 目标 × 4 = 128 + R2 25 目标 / 82）。
  - 人间建筑 12：bridge / sunyang / shiqian / washi / gate / pagoda / yamen / wharf / southbank / zichen / countryside / jiangtai
  - 天宫 5：nantianmen / lingxiao / yaochi / pantao / star9
  - 地府 8：yinyanggate / naihe / yanluo / fengdu / shibayu / mengpo / sansheng / wangxiang
  - 环境 5：desert / riverfront / skypan / wardinfill / crowdnear；玩法/HUD 2：hud / voxel
  - 修正机位 13（地府 8 + 天宫 5）、细节近景 6（actor / roof / sign / water / tree / palace）、
    玩法状态 6（avatar(V) / build(G) / creation(Y) / shop(V+E) / boss(J) / HUD 总览）
- **归因 A/B**：25 张（地府天幕 4、远山雾 4、远距雾化 4、水面分层 4、重复数 5、组合 4）。
- **同机位复拍**：`va-after-*` 28 张 + `va-final-*` 两轮 56 张，共 84 张（7 目标 × 4 视角 × 3 轮）。

> 动作 / 运动 / 战斗 / 收集 / 升级等动态项通过 `pre` 按键序列触发后取引擎当前机位单帧
> （`keepCam`），因为强行摆四视角会破坏附身第三人称与交互状态；这部分以 HUD/状态可读性为主，
> **未做逐帧动作序列审核，属本轮已知边界**。
