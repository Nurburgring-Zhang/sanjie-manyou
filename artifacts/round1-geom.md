# 第 1 轮审核结论 · 建模 / 贴图 / 渲染层（geom-expert）

> 交付供第 2 轮对抗审查逐条证伪。所有结论均给 `file:line` 证据，可用截图复核。
> 范围：仅几何生成 / 材质贴图 / 光照渲染；**不审**玩法逻辑、角色/动作、UI/HUD、存档、事件总线。
> 基线：`git HEAD = be0226e`；dev server `http://127.0.0.1:4182/`（未启动/未使用）。
> 纪律：**全程只读审查**——未修改任何 `src/` 源码、未运行 npm / vite / 构建、未写脚本落盘。仅本审核产物文件为新增。
> 已修项不重复报告：工作区 4 个已修改源文件 `src/world/terrain.ts`、`src/city/river.ts`、`src/sky/underworld.ts`、`src/world.ts` 对应 V-01（远山雾）、V-02（水面条纹）、V-03（地府洞顶），其 `git diff` 已逐行读过，本文不把它们当缺陷。

---

## 0. 总体判定（最重要）

**台账 `VISUAL-AUDIT-20261107.md` 的 V-06 / V-11 / V-12 三条 Prior 根因与当前代码已漂移，其中 V-06 的「疑似另有平顶壳体或材质分组覆盖」被证伪。** 这是本轮最关键的产出：

| 台账项 | Prior 根因 | 代码实况 | 判定 |
|---|---|---|---|
| V-06 | 「脊顶盖已写 `capC(k)` 条纹；疑似另有平顶壳体或材质分组覆盖，需 Raycaster 拾取归属」 | 平板就是 `buildCurvedUnit` 自身的脊顶盖 cap（同一几何、同一材质组、同一 draw call），**不存在第二块壳体、也不存在材质分组覆盖** | Prior 猜测证伪，见 G-01 |
| V-11 | 「`SignMesher` 单面 quad，背面缺木背板」 | `SignMesher.quad()` 早已生成正反两个 quad 且背面 UV 水平镜像 | Prior 与代码不符，真机制见 G-06 |
| V-12 | 「树冠光滑低模半球」 | 郊野池树是三层圆锥，近景树是 7×4 低分段**扁球**；且 `leaf` 组无 UV 导致 `leafTex` 全项目失效（台账未记） | 描述不准 + 新增机制，见 G-02 |

另发现：V-09 紫褐有明确材质组根因（`wall` 组冷灰 emissive，W48 只修了凌霄殿未修南天门），且门洞高宽比 0.74:1 与 style-bible §6.1 T5「≈2:1」量化倒挂；V-07 是田块细垄 aliasing 而非树；V-04 是城内轴线填充生成器被整体清空。

---

## 1. 缺陷清单（10 条，按严重度排序）

### G-01【确认缺陷 · 最高优先级】V-06 屋顶中央平板：归属就是 `buildCurvedUnit` 的脊顶盖 cap，不是另一块壳体、也不是材质分组覆盖

- **现象**：若干大屋顶中央顶面是一大块浅粉褐 / 浅灰纯色平板，与四周深灰瓦垄反差明显。
- **代码根因（精确到行）**：`src/city/bake.ts:273 buildCurvedUnit` 的**脊顶盖 cap**（L356–371）是 x,z ∈ ±`RIDGE_HALF`(0.16, L246)、**y=1 恒定**的水平平台；`ring()`(L304–318) 在 t=0 时 `hx=hz=RIDGE=0.16`、t=1 时 =0.5，故 cap 占屋顶面阔 / 进深各 **32%**（40m 屋顶即 12.8m × 12.8m 平板）。`src/city/buildings.ts:272` 注释「正脊平顶 = ±0.16×SW」、L277 `RIDGE_F=0.16`、L310 `ridgeHalf=RIDGE_F*SW` 三处交叉印证。
- **归属判定（逐项排除，不靠猜）**：
  1. **无第二块平顶壳体**——`roofOn`(buildings.ts:269) 只调一次 `b.roofC`(L284)；其余 `eaveRingOn`(L288)、`hipRibbonOn`(L302)、正脊 `b.box('roof', ridgeHalf*2, 0.2, 0.42, …)`(L311) 只是 0.42m 深的脊条。`roofC`(bake.ts:1168–1187) 只 `push` 一次。
  2. **无材质分组覆盖**——cap 与前后两片坡面是**同一个 `THREE.BufferGeometry`、同一次 `push('roof')`(L1185)、同一个 `roof` 材质组、同一个 draw call**；不存在第二材质 / 第二分组。台账 Prior 的两种猜测均不成立。
- **为什么读成「浅色纯色」——四重叠加**：
  1. cap 是水平面、法线 +Y（L362–363 注释「全城 1367 顶曲面屋顶的正脊盖都是背面，靠 DoubleSide 才没露馅；改序后法线转正」），吃满主光 / 半球光，远亮于斜面；
  2. cap 的 UV（L360–361、L365–370）：`u` 沿面阔 0..su，但 `v` 被**钉死在 `sv*0.86~0.94` 一条窄带**（`roofTex` 顶行瓦当，L85–91），而坡面 v 覆盖 0..sv 的完整瓦垄（L327）→ 贴图内容不同、cap 无纵向瓦垄 → 纯色；
  3. `capC(k)`(L359) 确有条纹，但取自 `ribRow(f0.sx)`(L298–301)，是沿**面阔 x** 的余弦明暗，且仅 `ribOn = worldW>0`(L286) 时几何才有 `color` 属性（L288/L375）；`roofC` 在 `cols<=9` 走 `curvedRoofUnit().clone()`(L1178，即 `buildCurvedUnit(9,0)`) 时**完全没有 color 属性**，cap 就是纯色；
  4. `push()` 的 kAO `0.82 + 0.18*(p.getY(i)-wMinY)/wH`(L841) 按世界 Y 把最高处 cap 提到 1.0，比檐口亮 22%——L807–809 注释自认这正是历史「屋顶是一整块灰平板」的着色根因之一。
- **证据**：`screenshots/va-20261107-r2/detail__det_roof__iso.png`（前景大屋顶中央大块浅粉褐平板、四周深灰瓦垄，现象极清晰）、`screenshots/va-20261107/city__sunyang__side.png`；`docs/重建-v2/style-bible.md` §4.1（`RIDGE_F`）、§3.7（反宇曲线「全工程唯一定义」）。
- **最小修法**：把 cap 的 `v` 从固定窄带改为随 z 正常展开（覆盖瓦垄行），必要时把 `RIDGE_HALF` 由 0.16 收窄至 0.08–0.10，或给 cap 一个微小脊拱。仅改 UV → **零三角面、零 draw call 增量**（`nVerts=(2N+1)*K*6` L283 结构固定）；改 `RIDGE_HALF` 改顶点位置不改顶点数。
- **几何 / 性能增量**：0 三角面、0 draw call（纯 UV / 常量改动）。
- **风险等级**：中高。改 `RIDGE_HALF` 必须**同步**改 `buildings.ts:277 RIDGE_F`、L310 `ridgeHalf`、`hipRibbonOn`、`eaveTrim`(bake.ts:1219 里的 `RIDGE_HALF`)，否则脊 / 垂脊 / 檐口脱开（style-bible §3.7 明令「全工程只有这一处定义真源」）。
- **验收方式**：用 `THREE.Raycaster` 从 `city__sunyang__side` 机位打屋顶中心，首命中须报**同一个合批 mesh**（不是第二个 mesh / 材质），dump 命中三角的 UV 范围与法线（确认 v 落在窄带、法线 +Y）；同机位复拍量平板面积占比。

### G-02【确认缺陷】V-12 树冠 + 台账外新机制：`leaf` 组无 UV，`leafTex` 全项目完全失效

- **现象**：近景树冠是光滑深绿低模扁球。台账写「半球」与代码不符：`src/actors/pools.ts:512–516 treeCanopy` 是**三层圆锥**（`ConeGeometry(1.7,3.2,7)` + `(1.25,2.6,7)` + `(0.7,1.7,6)`，L505 注释「第七轮：双锥层叠树冠」），那是郊野 instanced 树（`terrain.ts:1993 scatterVegetation` 用 `treeCanopy` 池）；近景树走 Baker。
- **代码根因**：近景树冠是 `b.sphere('leaf', r, seg, …, sy≈0.84–0.88)`——`src/city/buildings.ts:2959`、`src/city/centralbelt.ts:669–670, 782–784`、`src/city/imperial.ts:1748–1750`；`bake.ts:1155 sphere()` → `new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg*0.6)))`，seg=7 即 **7×4 低分段扁球**。叠加材质层致命项：`UV_GROUPS`(bake.ts:591) **不含 leaf**、`buf.leaf`(L685) **无 uv FBuf**、`push` 仅 `needsUv` 时写 uv（L846）→ `leaf` 材质 `map: leafTex`(L1483) 每个顶点都采 (0,0) 同一像素，退化为常数乘子，斑驳叶面 / 叶脉**根本不显示**。L1480–1482 代码注释自认：「leaf 网格 uv=false —— 每个顶点都采贴图 (0,0) 的同一个像素，最终只是一个约 0.85 的常数乘子……要让叶面纹理真生效需给 leaf 加 uv 缓冲，会重刷全城植被，本轮不动」。Lambert 平滑法线 → 光滑纯色。style-bible §7 A7 `leaf.map > 0` 名义满足、实质无效。
- **证据**：台账 `screenshots/va-20261107-r2/detail__det_actor__front.png`；注意 `screenshots/va-20261107-r2/detail__det_tree__front.png` 机位**实际拍到的是屋顶**（瓦垄清晰、无浅色平板），仅远景可见团状树冠——取证机位瑕疵，见「误判风险」第 2 条。
- **最小修法**：`UV_GROUPS`(L591) 加 `'leaf'`、`buf.leaf`(L685) 补 `uv: new FBuf()`；`sphere` 已传 `uvDims=[r*2,r*2,r*2]`(L1155)，`push` L773 `scaleGeoUV` 自动生效。备选：仅提高 seg（7→12）并加顶点扰动（会增三角面）。
- **几何 / 性能增量**：0 三角面、0 draw call；但 leaf 合批多一套 uv 顶点属性（+2 float / 顶点），且会重刷全城植被（注释已警告）。
- **风险等级**：中。改 `UV_GROUPS` 影响所有 leaf 构件（`desertOutpost.ts` 的 box/cyl 叶、`sky/flora.ts` 的球），需逐类确认几何自带 uv；`scaleGeoUV` 的 0.24/m 密度对 0.2m 花瓣可能过稀。
- **验收方式**：补一条「leaf 合批存在 uv attribute」机检断言；复拍近景树（`det_actor__front` / 对准树的 `det_tree`）检查叶面斑驳是否出现、是否仍有光滑感。

### G-03【确认缺陷】V-09 南天门：紫褐来自 `wall` 组冷灰 emissive，比例与 style-bible T5 量化倒挂

- **现象**：巨大紫褐实心方盒 + 偏小的白色半圆券洞 + 空旷圆台，比例怪异。
- **代码根因**：
  1. **紫褐** = `src/sky/realm.ts:89, 91, 107` 城台 / 面砖 / 门楼墙，与 `src/sky/expansion.ts:108, 119` 两墩 / 券肩**全用 `wall` 组**（`MeshLambertMaterial + emissive 0x3a3d48` 冷灰，bake.ts:1469），把 `0x6a5a3e` / `0x6e4a24` 褐土色染成紫褐。`realm.ts:182–184` 注释**已识别此机制**：「wall 组是 MeshLambertMaterial + emissive 0x3a3d48（冷灰自发光），天宫主殿朝南的立面常年背光，冷灰 emissive 把朱红拉成紫褐；wood 组无 emissive，红能站住」——但 W48 只把**凌霄殿**墙改成 `wood`（L184 `const WG = 'wood'`），南天门未同步。
  2. **方盒** = `realm.ts:89` 是 `b.box('wall', 44, 8, 18, …)` **一整块实心盒**；`expansion.ts:218` 注释自认「realm.ts 的城台是一整块 44×8×18 实心盒（门洞位置被它 100% 堵死，射线打上去是 #6a5a3e 大板）」；W47 用 `stripBoxTriangles(scene, 'city_wall', {...})`(L222) 摘 12 个三角后由 `rebuildSkyGatePassage`(L97) 补回，但两墩仍是实心块、`realm.ts:107` 门楼墙仍是 `b.box('wall', 36, 10, 2.4, …)` 一整块平板，无柱列 / 开间。
  3. **比例倒挂（可量化）**：`rebuildSkyGatePassage` 中 `R=5.4`(L101，券洞半宽)、`h=8`、`YS=gy+2.6`(L102 起券线)、`TOP=gy+h`(L103) → 门洞净高 8 / 净宽 `2R=10.8` ≈ **0.74 : 1**，与 `docs/重建-v2/style-bible.md` §6.1 T5「门洞高宽比 ≈2:1、净高/净宽 ∈ [1.8,2.2]」、§4.6 门、§6.1 G1「巨构须以人为尺」倒挂。
  4. **空圆台** = `realm.ts:87 platform(gate.x, gate.y, gate.z, 30)` + V-08 人口稀疏（`src/actors/crowd.ts:1687` 南天门仅 40）。
- **证据**：`screenshots/va-20261107-r2/sky2__sky_nantianmen__iso.png`（紫褐方盒 + 白色半圆券 + 空圆台清晰可见）、`sky2__sky_nantianmen__SHEET.png`。
- **最小修法**：把城台 / 门楼墙 `wall` → `wood`（对齐 W48）。**但必须同步把 `expansion.ts:222` 硬编码的 `'city_wall'` 改为 `'city_wood'`**，否则 `stripBoxTriangles` 找不到网格、门洞被实心盒重新堵死——强耦合点，不能只改一处。比例需调 `R` / `h` 或门楼开间，属几何改动。
- **几何 / 性能增量**：仅改材质组归属 → 0 三角面、0 draw call（仍是 14 组之一，按组名分流）。调 `R`/`h` 会改 `rebuildSkyGatePassage` 24 层券肩盒子数（L111–120），小幅增面。
- **风险等级**：高。硬编码 mesh 名 + `compactStatic` 合批顺序依赖（L220 注释自认「必须在 compactStatic 合批之前做，合批后同材质的城台与其它构件会并进同一块几何，无法再定位」）；顶点已被 `push` 的 `applyMatrix4`(bake.ts:810) 落到世界系，8 角点精确匹配脆弱。
- **验收方式**：先跑 `__gateCut`(expansion.ts:227) 断言 >0；复拍 iso / front 检查门洞贯通、朱红是否站住；量门洞净高 / 净宽比是否回到 ≈2:1。紫褐可 A/B：运行时临时把该段按 `wood` 组无 emissive 重算顶点色连拍。

### G-04【确认缺陷】V-07 郊野俯视规则黑点 = 田块细垄的 aliasing / 无 LOD，不是树

- **现象**：城外矩形地块 900m 俯视密布规则黑点（村落 / 田块缩成噪点）。
- **代码根因**：`src/city/infill.ts:3486 layBand` 按规则网格铺田（L3493 `v += wid + rng.range(2.4,3.0)`、L3498 `u += len + rng.range(10,24)`），田块 `len 80–200m × wid 15–26m`(L3494 / L3499)，每块再铺 `nR = max(3, round((wid-1)/1.7))` 条 0.82m 宽、**1.7m 间距**的平行垄（`fieldPlot` L3468–3472）；全部走 `b.box` 合批进 `ground` / `earth` 组，**无 LOD、无距离剔除、无尺寸分档**。900m 俯视下 1.7m 间距远小于 1 像素 → 高对比细垄走样成规则黑点 / 摩尔纹。台账猜测「`scatterVegetation` 排除城内树」不成立：`terrain.ts:2001 if (d<6200) continue` 排的是半径 6.2km 圆内、L2002 排田块，俯视黑点不是树。
- **证据**：`screenshots/va-final-20261107/world__skypan__top.png` / `iso.png`（台账记「复拍仍在」）。
- **最小修法**：给 `fieldPlot` 的 ridge（L3469–3472）按投影尺寸 / 相机距离分档——远景只留 `b.box('ground', …)` 底板(L3467) + `bund`(L3474–3479)，不铺细垄；或压低细垄明暗对比。属几何生成器改动。
- **几何 / 性能增量**：**减少**远景三角面（nR 条 / 块不再生成），0 draw call 增量。
- **风险等级**：中。改 `fieldPlot` 会改 kit 计数 `country.ridge`(L3481)，需同步资产清单 / 探针。
- **验收方式**：同机位俯视复拍做黑点连通域 / 高通能量统计；并在 200m / 900m 两档机位分别拍（近景有垄、远景无垄），分层隐藏 `city_ground` / `city_earth` 做 A/B。

### G-05【确认缺陷 · 规划项】V-04 大片裸露空地：城内轴线填充生成器被整体清空

- **现象**：虹桥两岸后方、城门内外、紫宸殿广场、御街两侧大片黄褐 / 米色裸地。
- **代码根因**：
  1. `src/city/infill.ts:3403 const CORRIDOR_Z: [number, number][] = []` —— 城内御街轴线四条田带整体清空（L3401–3402 注释「原四段走廊带落在 |x| 44–876、|z| 470–2880，是皇城御街轴线（城内地块），铺条田等于在宫前种稻；已清空，只保留外郭墙外的田带」），城内轴线不再有任何地面填充生成；`buildCountryside`(L4082) 里 `CORRIDOR_Z.forEach` 因此是空循环。
  2. `layBand` L3505–3508 `if (!near) continue` 只在距村落 <560m 或距道路 <300m 内生成田块；`buildCountryside` 的 `bands`(L4090–4095) 只剩 ±5600 外郭 4 带。
  3. `scatterVegetation`(terrain.ts:2001 `d<6200 continue`) 城内 + 近郊 6.2km 圆内不种树。
  4. `buildBridgePlaza`(buildings.ts:2921–2924) 注释自认「中央带 |x|<950 被 wardReserved 保留（不许建坊），而 streetPlots 只铺街两侧的排屋，于是桥东 / 桥西各留出一块 200×200m 的纯土空地」——该函数只补了一小块。
- **证据**：`screenshots/va-20261107/city__gate__SIDE.png`、`city__zichen__SHEET.png`、`screenshots/va-final-20261107/world__skypan__front.png`；`detail__det_tree__front.png` 远景可见大片黄褐平地。
- **最小修法**：不新增建筑，先在 `CORRIDOR_Z` 空出的城内轴线补地面铺装 / 坊格（复用 `cityGroundDetail` terrain.ts:799），成本低；若要建筑填充需新增生成器（`infill.ts` / `buildings.ts`），按台账 §五排期 + 性能预算，逐批加、每批复拍 + 跑基线。
- **几何 / 性能增量**：仅地面铺装 → 少量三角面、0 新增 draw call（复用 `ground` 组）；批量加建筑会显著抬 25.87M 三角面 / 348 draw calls 基数，违反 `docs/重建-v2/D7-性能与预算.md`。
- **风险等级**：高（性能预算 + 137 测试 determinism 口径）。
- **验收方式**：`probe-house-overlap` / `probe-road-clash` 保持 0；逐批复拍 + 跑基线。

### G-06【确认缺陷 · 台账 Prior 根因错误】V-11 招牌背面镜像：`SignMesher` 早已双面，真机制是两 quad 共面 + DoubleSide 的深度冲突

- **现象**：个别招牌从背面看文字镜像。
- **判定（Prior 与代码漂移）**：台账 Prior「`bake.ts` `SignMesher` 单面 quad，背面缺木背板」**与当前代码不符**。`src/city/bake.ts:1580–1589 quad()` 已生成**正反两个 quad**：L1587 正面 + L1588 背面（UV 水平镜像 `[uvp[2],uvp[1],uvp[0],uvp[3]]`），`quadSide`(L1591–1606) 对 `back` 也镜像 UV（L1598–1600），L1586 注释明写「双面可读：正面 + 背面（背面水平镜像 UV，背面文字同样正读）」，材质 `side: THREE.DoubleSide`(L1613)。
- **真实机制**：两 quad 的 corners 都在局部 z=0 平面、绕 Y 仅差 π（L1592 `ry + (back?π:0)`、L1596 corners），经 `applyMatrix4`(L1594 / L1602) 后**完全共面重合**；材质 `transparent:true + alphaTest:0.05` 但**未设 `depthWrite:false`**(L1613)，`MeshBasicMaterial` 默认 `depthWrite=true` → 相同深度下深度测试 LESS 相等不通过，**先绘制的正面 quad**（L1587 先 push）胜出；从背面看到的是正面 quad 的 DoubleSide 背面（UV 未翻转）→ **镜像文字**。`DoubleSide` 又让背面 quad 从正面也可见，两者叠加 → 随绘制 / 深度顺序出现「个别」招牌镜像，恰合台账「个别」而非「全部」。另一可能：部分招牌不走 `SignMesher`（`sg.quad` 之外的 `addGeo` / plane），需运行时枚举确认。
- **证据**：台账 `screenshots/va-20261107/world__crowdnear__front.png`；`bake.ts:1586–1613`。
- **最小修法**：改为**单 quad + `side:DoubleSide`**，片元用 `gl_FrontFacing` 翻转 `uv.x`（采样前 `if(!gl_FrontFacing) uv.x = 1.0 - uv.x`）；或给背面 quad 沿法线偏移 0.01m 并设 `depthWrite:false`。若确需木背板再加 `b.box('wood', …)`（+12 面 / 招牌）。
- **几何 / 性能增量**：**减少**一半招牌三角面 / 顶点，0 draw call 增量（改 shader 需 `onBeforeCompile` + `customProgramCacheKey`）。
- **风险等级**：中。需确认 `alphaTest` 与双面剔除交互；招牌是 `MeshBasicMaterial` + `toneMapped:false`。
- **验收方式**：枚举 `signs` mesh 的 quad 数与世界坐标；`screenshots/va-20261107-r2/detail__det_sign__front.png` / `iso.png` 正反两机位连拍，检查背面文字正读、无 z-fighting 闪烁；做「隐藏背面 quad / 关闭 DoubleSide」A/B 分离成因。

### G-07【疑似需运行时验证】V-05 平板立面：通用街屋是设计取舍，两处特殊建筑需定位

- `buildDetailedFacade`(`src/city/detailKit.ts:127`) 存在，但 `buildBuilding`(buildings.ts:1400–1404) 调用时传 `windows: false`(L1401)，窗由 `facadeType` 分支（L1088–1135）自己生成；`tier:'far'`（house / manor，L1403）在 **detailKit.ts:128 `if (o.tier === 'far') return;` 直接返回**，整幅精细立面（柱列 L136–142 / 门 L145–152 / 窗 L161–178 / 窗楣石裙 L188–201）全不生成——buildings.ts:1396–1399 注释自认「院墙民居的整幅立面落在 2.5m 院墙后面，街面看不见……所以这里对 house/manor 直接跳过（616 面/座），腾出的预算正好付临街店面构件」。这是**有意设计取舍，非缺陷**。
- V-05 点名的两处是**特殊建筑**，不走 `buildBuilding` 通用路径：孙羊正店方形塔楼、阎罗殿背面暗红墙。**阎罗殿 `front.png` 拍的是殿背面**（台账 §一「误判剔除」已确认「front.png 拍到的是殿背面，该视角本就没有牌匾」），且 `realm.ts:178` W48 注释「背面（+z）改为整面朱墙」是有意形制 → **设计取舍非缺陷**。孙羊正店塔楼需运行时定位其生成函数（疑在 `buildings.ts:2959` 高层楼阁周边或 `src/city/architecture.ts`）并枚举立面构件，才能定性；**当前不夸大**。
- **最小修法**（若确认塔楼缺门窗）：仅对该地标补 `buildDetailedFacade(..., windows:true, tier:'near')`，约 +616 面 / 座、0 新增 draw call（复用既有材质组）。
- **几何 / 性能增量**：+616 面 / 座（仅地标），0 draw call。
- **风险等级**：低。
- **验收方式**：定位塔楼 mesh 名 → 枚举其立面构件数；正 / 侧 / 背三机位复拍。

### G-08【疑似需运行时验证 · 台账外】`stripBoxTriangles` 运行时删三角形的脆弱耦合

- **现象 / 机制**：`src/sky/expansion.ts:222` 硬编码 `stripBoxTriangles(scene, 'city_wall', {…})`，依赖三件事：① mesh 名恰为 `city_wall`；② 在 `compactStatic` 合批**之前**执行（L220 注释自认「必须在 compactStatic 合批之前做：合批后同材质的城台与其它构件会并进同一块几何，无法再定位」）；③ 8 角点与 `realm.ts:89 b.box('wall', 44, 8, 18, gate.x, gate.y+4, gate.z)` 精确相等——但 `push` 会 `applyMatrix4`(bake.ts:810) 把顶点落到世界系并叠 AO / uvDims，浮点误差可能让精确匹配失败 → 门洞被实心盒静默堵死。截图券洞可见说明当前大致成功，但顺序 / 命名一变即回归。
- **证据**：`screenshots/va-20261107-r2/sky2__sky_nantianmen__iso.png`（白色半圆券洞可见）；`expansion.ts:217–227`。
- **最小修法**：把 `SKY_GATE` 的 footprint 抽成 `realm.ts` / `expansion.ts` 共享常量；给 `__gateCut`(L227，现仅记录值) 加门禁断言。
- **几何 / 性能增量**：0。
- **风险等级**：中（合批顺序 / 命名一变即静默回归）。
- **验收方式**：`__gateCut === 预期三角数`（应 >0）；调整 `compactStatic` 顺序后回归门洞贯通。

### G-09【疑似需运行时验证 · 台账外】`scaleGeoUV` 的分面假设只对 `BoxGeometry` 成立

- **机制**：`bake.ts:386–397 scaleGeoUV` 用 `Math.floor(i/4)` + `faceDims[Math.min(f,5)]`，隐含「6 面 × 4 顶点 = 24 顶点的 `BoxGeometry` 索引布局」。`push` L773 在 `toNonIndexed()`(L774) **之前**调用，对 `BoxGeometry`（24 顶点）正确；`sphere()`(L1155) 传 `uvDims=[r*2,r*2,r*2]` 三分量相等 → `faceDims` 6 项全等，**恰好无害**。但 `cyl()`(L1163) 传 `[(sx+sz), h, (sx+sz)]`，dims 不等，而 `CylinderGeometry` 顶点数（seg=8 时约 38）≠24 → `floor(i/4)` 分组错位、第 24 顶点后 clamp 到 `faceDims[5]`，圆柱贴图 UV 缩放不一致 → 可能出现接缝 / 密度跳变（影响 `wood` / `metal` / `lacquer` 等 `UV_GROUPS` 内的柱、灯、鼓）。
- **证据**：`bake.ts:386–397, 591, 773, 1155, 1163`。
- **最小修法**：`scaleGeoUV` 增加几何分支，非 box 几何改为按 UV 最大值统一缩放；或 `cyl()` 不传 uvDims。
- **几何 / 性能增量**：0。
- **风险等级**：中（改动影响所有 box 类构件 UV 密度，需逐组复拍）。
- **验收方式**：dump 一根 `metal` / `wood` 圆柱的 uv 范围检查连续性；复拍柱身。需注意此条最易被误判（见「误判风险」第 7 条）。

### G-10【疑似需运行时验证 · 台账外】`roof` 组 aoMap 缺第二套 UV + `groundAux` 死代码

- **机制**：`bake.ts:1474 roof` 材质带 `aoMap: tex.roofAuxGen ?? undefined`；Three.js r152+ 的 `aoMap` 需 `uv1`（第二套 UV），而 `Buf`(L506) / `flush` 只提供一套 `uv`(L681)。若运行时回退到 `uv` 则 AO 与 albedo 共用 UV、语义失真；若不回退则 aoMap 静默失效。需确认项目 Three.js 版本与实际 UV 通道。
- **附带（非视觉缺陷）**：`deriveAux`(L159–188) 注释 L182「借第二画布存粗糙度」但**未真正生成 roughnessMap**；`groundAux`(L225) 计算后完全未被使用（L229 返回的是 `groundNormalGen: makeNormal(...)`），是死代码 + 一次 1024² 盒式模糊的无谓 CPU / 内存开销。
- **证据**：`bake.ts:224–229, 506, 681, 1474`。
- **最小修法**：若 aoMap 无效则直接移除（0 成本，反**省**一次纹理采样）；或补 `uv1`。删除 `groundAux`。
- **几何 / 性能增量**：0（或 −1 次纹理采样 / 片元）。
- **风险等级**：低。
- **验收方式**：检查 renderer program 的 `USE_AOMAP` 宏与 `uv1` attribute 是否存在。

---

## 2. 已核查但未发现确认缺陷（任务点名项，供第 2 轮复核）

- **颜色空间**：`canvasTex`(bake.ts:14) / `SignAtlas`(L1521) 设 `THREE.SRGBColorSpace` 对 albedo **正确**；`makeNormal`(L135–155)、`deriveAux`(L184) 不设 `colorSpace` → Three.js 默认 `NoColorSpace` 对法线 / 数据贴图**正确**（看似「漏设」实则无误）；`petalSheenTex` L1402 `NoColorSpace`、`src/city/river.ts` 两张水面贴图 `NoColorSpace` 均正确。
- **UV 接缝**：V-02 已修的 `tileHash` / `tileNoise`（river.ts）按 nx/ny 取模、u/v=0 与 1 精确接边；`buildCurvedUnit` 坡面 UV 连续（cap 的「钉窄带」已归 G-01，不是接缝）。
- **InstancedMesh 实例矩阵**：`scatterVegetation`(terrain.ts:1996–2016) 用 `m.compose(v,q,s)` + `pool.set` → `setMatrixAt`(`src/actors/pools.ts:13, 25, 47`)；未放置实例 `m.makeScale(0,0,0)` 隐藏是常见做法（零面积不可见），无确认错误。
- **法线 / 背面剔除**：`roof` 组 `side: THREE.DoubleSide`(L1474)；cap 绕序已修为 +Y（L362–363）；`push` L810 `applyMatrix4` 自动用 normalMatrix 处理非等比缩放（sx,sy,sz），L840 写入变换后法线——正确。
- **阴影 / 雾 / 光照**：`pools.ts:20–21` 分池 `castShadow` / `receiveShadow`；V-01 / V-02 / V-03 已修部分不重复报告。

---

## 3. 误判风险（最易被误判成缺陷 / 需要什么实验才能证实）

1. **V-06「另有平顶壳体 / 材质分组覆盖」** → 实为 cap 自身；必须 Raycaster 打中心取首命中 mesh 名 + dump UV / 法线，才能证伪「第二块壳体」。只看截图会把同一几何内的两种受光误读为两个材质。台账 Prior 正是这个误判。
2. **V-12「半球」** → 池树是三层圆锥(pools.ts:512)，Baker 近景树是 7×4 低分段**扁球**；且 `detail__det_tree__front.png` 机位实际拍到屋顶、不是树。需重拍对准近景树的正 / 侧 / 俯三视图，并做「关闭 leafTex / 提高 seg」两组 A/B，才能分离「几何低模」与「贴图失效」两个成因。
3. **V-11「单面 quad 缺木背板」** → 代码已双面；需逐面枚举招牌生成路径（哪些走 `sg.quad`、哪些走别的），并做「隐藏背面 quad / 关闭 DoubleSide」连拍，才能证实是共面深度冲突而非缺几何。`quad()` 的双面方案本身（L1586 注释）很容易让人误以为「已经修好了」。
4. **V-05「阎罗殿背面暗红墙无门窗」** → W48 有意做整面朱墙，且 front 机位本就拍背面；属设计取舍，需换到殿正面机位复核，否则误报。台账 §一已剔除过一次「牌匾被柱子遮挡」的同类误判。
5. **V-07「树走样」** → 实为田块 1.7m 细垄 aliasing；需分层隐藏 `city_ground` / `city_earth` 做 A/B，并在 200m / 900m 两档机位分别拍（近景有垄、远景无垄）才能确认是 LOD 问题而非几何错误。
6. **V-09「比例怪异」主观部分** → 必须用 style-bible §6.1 T5 的 2:1 量化 + 人尺参照实验；「紫褐」可 A/B（运行时临时把 `city_wall` 该段按 `wood` 组无 emissive 重算顶点色连拍）证实是材质组而非配色。
7. **`makeNormal` 不设 colorSpace / `scaleGeoUV` 用 `floor(i/4)`** → 看似「漏设 / 错位」，实则是 Three.js 默认 `NoColorSpace` 正确、且对 sphere 因 uvDims 三分量相等无害；**只有 cylinder 才是真候选（G-09）**，不能把「看着像 bug」直接写成缺陷。第 2 轮若证伪 G-09，请据此收口。
8. **已修 4 文件**（terrain.ts / river.ts / underworld.ts / world.ts，V-01/02/03）→ 其 `git diff` 内旧参数已被替换；任何「远山发米色 / 水面竖条纹 / 地府全黑」的复核若用旧截图都会误判，须用 `screenshots/va-final-20261107*` 复拍图。

---

## 4. 附录：跨专家协作同步（**非本域结论，不计入上述 10 条**）

> 供汇总时避免与 ui-perf-expert / motion-expert 结论冲突，第 2 轮不必逐条证伪。

- **V-10 右下竖排告示归属（与 ui-perf-expert 对齐）**：确认是 3D 招牌，`src/city/bake.ts:1502/1546/1558` `SignAtlas.text({vertical:true})` + `bake.ts:1570` `SignMesher.quad()`（调用点 `buildings.ts:1389/2035`、`architecture.ts:1171`），DOM 侧无对应节点，台账「右下告示为 3D 招牌」成立，归几何 / 贴图层。「文字挤压重叠」的几何层机制并入 G-06 的延伸：每块招牌是**两个完全共面的 quad**(bake.ts:1587–1588) + `DoubleSide` + 无 `depthWrite:false`(L1613) → 半透明同深度叠加 / z-fighting，文字发虚发重。抽查 `buildings.ts:1389`（'酒' 2 字，cell 64×224 / quad 1.15×4.1，比 0.286 vs 0.280）与 `buildings.ts:2035`（'肅靜迴避' 4 字，cell 64×260 / quad 1.1×4.4，比 0.246 vs 0.250）：cell 与 quad 宽高比匹配、竖排步长 `step=min(px*1.18,(H-12)/chars.length)`(L1559) 不压缩 → **单 cell 内部不挤压**，`atlas` 排版参数不是根因。`SignAtlas` 图集溢出覆写（L1512 注释「5120 时 overflowCount=1 → 匾额错字/白板」，现 SIZE=6144）、多块招牌投影叠加、与右下 HUD DOM（`#skip` / `#jumpbtn` / `#poiguide`，ui-perf-expert 域）屏幕空间叠加，均标【疑似需运行时验证】。
- **几何层无 collider（回复 motion-expert）**：通读 `src/city/bake.ts` 未见任何 `ColliderRegistry` / OBB / 物理体注册；`roofPieces`(L899)、`groundTrace`(L851)、`glowTrace`(L913/1161/1170) 是审计 / 归因台账（供 `?roofAudit=1` 与探针 A/B 用），不是碰撞体；文件头 L3 自述「整座静态城市合并为 7 个 draw call」= 纯渲染合批网格。支持 motion-expert「玩法零接线」结论，不冲突。
- **`PLATFORMS` 与天宫缩放的潜在不一致（线索，属运动 / 坐标域，交由 motion-expert 核对）**：`src/sky/heavenFrame.ts` 有 `HEAVEN_SCALE=2.2`(L11) 与 `LINGXIAO_SCALE=2.7273`(L38，凌霄殿二次放大) 两套缩放，而 `heavenPoint()`(L27–29) **只应用 2.2× + HEAVEN_LIFT**。`src/game/player.ts:483–487 PLATFORMS` 里 `{x:0,y:214,z:95,r:46}` 经 L492 `heavenPoint` 换算后 z = `95×2.2 = 209`，**恰等于** `LINGXIAO_ANCHOR_PRESCALE.z = 209`(heavenFrame.ts:40)；L493 只做 `p.r *= HEAVEN_SCALE`（→ 101.2）。与 `artifacts/SPEC-位置合理性判据族.md` §三.3「天宫 ×2.2 缩放已坑过两次」、`heavenFrame.ts:35–36`「palace 用 233、expansion 用 230，差 3m ⇒ 最多错位 2.7273×3≈8m」同源。

> **修订（经 motion-expert 复核收窄，2026-11-07）**：我初稿写的「实际半径应 ≈ `46×2.2×2.7273 ≈ 276`，差 2.7273×」是**过度简化的定值，已作废**。`enlargeLingxiao`(`src/sky/expansion.ts:343–368`) 对 `y>=2165 && |x|<=60 && |z-209|<=62` 的**顶点**绕锚点 `(0,2168,209)` 再 ×2.7273，是**逐顶点盒选区而非整块等比**，`|x'|>60` 的台基顶点不被放大 → 台基实际外沿非均匀，静态推不出唯一半径，正确口径是「需运行时量测」。8 个平台里仅第 3 个换算后 `(0,2170.6,209,r=101.2)` 落入该选区；且异界 `foot` 态被 `realmY` 钉住(`game/player.ts:406–408`)、不走 `groundHeight`，影响面只到飞行坐骑防穿(:341) / `toggleMode`(:166–168) / `dismount`(:465)。motion-expert 已标【疑似需运行时验证】写入 `artifacts/round1-motion.md` §三附录、不占其 14 条编号。其给出的证伪断言：① 把 PLATFORMS 换算后的 `(x,y,z,r)` 与运行时 `scaleHeavenGeometry` + `enlargeLingxiao` 后的台基 AABB 逐项 diff；② 在距中心 120–260m 环带采样 `groundHeight(x,z,refY>2150)`，断言返回有限值且等于台面高（若返回 `-Infinity` / 0 即命中，玩家会从 ~2170m 坠到人间 0）。**本轮我未越界下结论，以 motion-expert 修订版为准。**
