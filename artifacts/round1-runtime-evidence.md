# 第 1 轮 · 主线程运行时硬证据（与 5 位专家结论并行，供第 2 轮对抗裁决）

> 全部由浏览器实测取得，**不改源码、不依赖静态推断**。dev server `http://127.0.0.1:4182/`，
> headless Chromium/Edge 1600×900，`window.__qingming` 调试接口。页面错误 0。
> 脚本：`scripts/_va_forensic.mjs` / `_va_state_probe.mjs` / `_va_dynamic.mjs` /
> `_va_input_ab.mjs` / `_va_boss_ab.mjs` / `_va_roof_ab.mjs`（均被 `.gitignore` 排除）。

---

## E-01 DOM 层实测（`_va_forensic.mjs` / `_va_state_probe.mjs`）

| 元素 | 实测 | 台账 / 专家结论的偏差 |
|---|---|---|
| `#bossbar` | `document.body` 直接子元素（**不在 `#ui`**）；rect `[540,66,520,27]`；`style.opacity = '0'`、`computedOpacity = '0'`；文本「巨灵神 · 力撼山岳320 / 320」 | 「不在 `#ui`」✅ 成立；**「默认常驻可见」不成立** —— 初始隐藏 |
| `#poiguide` | **DOM**：`position:fixed; z-index:60; pointer-events:none; transform:translate(-50%,-50%)`；rect `[1480,754,80,129]`；文本「➤上河长卷（横向观画） 42m / 沿上河长卷横移，看完十二段市井」 | 台账 V-10「右下告示为 **3D 招牌**」❌ **错误**：这是 `src/game/poiGuide.ts:29-38` 创建的世界空间 POI 投影 DOM 标记 |
| `#skip` | rect `[1467,779,113,31]`、`class="show"` | 与 `#poiguide` **实测相交**（x 1480–1580 ∩ 1467–1580，y 779–810 ∩ 754–883）→ V-10「右下文字挤压重叠」为真，根因是**两个 DOM 叠压**，不是 3D 招牌 |
| `elementsFromPoint(1520,800)` | 开场机位命中 `#poiguide`；传送到 `bridge` 后右下**所有 DOM 消失**，只剩 `CANVAS/app/BODY/HTML` | 证明 `#poiguide` 是随相机移动的世界投影标记（位置不固定）；ui-perf-expert UI-13 把「右下常驻 DOM」与「3D 招牌」并列的说法需按此订正 |

**性能快照**（俯视机位）：363 draw calls / 44,776,979 triangles / 322 geometries / 48 textures / 67 programs /
192 Mesh + 452 InstancedMesh / 50 transparent / pixelRatio 1。
（与台账 348 / 25.87M 是**不同机位与 parity**，不可互相换算，符合 `D7 §0.3`。）

## E-02 动态逐帧序列（`_va_dynamic.mjs`，134 采样点 / 100ms，页面错误 0）

| 场景 | 实测 | 判读 |
|---|---|---|
| S0 静止 | cam `[9,17.5,13]`、mode soul、state foot、boss idle | 基线 |
| S1 按 W 1.2s → 松开 | cam 位移约 46m；松键后立即停住，keys 清空 | 移动正常，无惯性残留 |
| S2 按 Space 0.9s → 松开 | cam.y `17.5 → 52.6`，松键后**停在高处不回落**；`player.state` 恒 `foot`、`vy` 恒 0 | **fly 模式下 Space 是「上升键」**（`engine.ts:985`），不是跳跃；属设计取舍，**不是动作缺陷**。跳跃只在 avatar 模式生效 |
| S3 V 附身 → W → V 切回 | mode soul→avatar→soul；附身时 cam.y 降到 3.5（第三人称贴地） | 模式切换正常，无互斥态并存 |
| S4 Y 打开造物 → 输入框打字 → Esc | `wishbar` 从 `none→flex` 后**始终 `flex`**；`activeEl` 恒 `wish-input`；之后 G / J / 传送全部**不生效**；boss 恒 idle | **确认交互死锁**（详见 E-03） |
| S5 G 建造开/关 | 因焦点仍锁在 `wish-input`，两次 G 均无效果 | S4 派生的连锁失效 |
| S6 J 出手 ×2 | boss 恒 idle、hp 恒 320、bossbar opacity 恒 0 | S4 派生；另因虹桥距将台 > `meleeRange`，J 本就不该命中（见 E-03 A2） |
| S7 传送三界 | `yinyanggate [478,7,34]` / `lingxiao [295.5,2198.36,325.5]` / `fengdu [240,-252.5,85]`；均无 NaN、无跳变 | 地面吸附与负 Y 深度正常 |

**全序列 134 点无 NaN / Infinity / 非有限值**，`t` 单调递增，无页面错误。

## E-03 输入层 A/B（`_va_input_ab.mjs`，每个用例全新页面，排除状态污染）

| 用例 | 结果 | 裁决 |
|---|---|---|
| A1 Y 打开 → Esc → J | `wishbar` 恒 `flex`、`activeEl` 恒 `wish-input`、boss 恒 idle | **【确认缺陷】Escape 死锁**。根因 `creation.ts:66-69` input 的 `stopPropagation()` 在目标阶段阻断冒泡，把 `creation.ts:63` 自身的 `Escape → close()` 一起吞掉；ui-perf UI-05 判断正确，双源印证 |
| A2 不打开面板直接 J | boss 仍 idle（虹桥距将台超 `meleeRange`，`boss.ts:111` 早退） | **不能**用「A1 的 J 无效」证明按键被吞；对照组本身也不激活。红队须注意此陷阱 |
| A3 输入框聚焦时按住 W 1s | cam 不动、`keys` 空 | **「输入框打字触发世界移动」不成立** —— `creation.ts:67` 的 `stopPropagation` 已挡住 `engine.ts:776` 的 `keys.add`。UI-04 说的是 `.panel.show`（另一类面板），两者不可混为一谈 |
| A4 点击「造」按钮提交后 | `wishbar` → `none`、`activeEl` → `BODY` | 成功路径会 `close()`；死锁只发生在「打开但不提交」路径 |

**结论**：正确的修法是「Escape 能关闭 + 关闭时释放焦点」，**不是**全局 `keys.add` 加输入框过滤（A3 证明那条路本来就是通的）。任何把 A3 当「按键穿透」证据的提案都应被红队剔除。

## E-04 Boss / 存档 A/B（`_va_boss_ab.mjs`）—— **与专家结论冲突，须裁决**

| 用例 | 实测 | 冲突点 |
|---|---|---|
| B1 `teleport('jiangtai')` 等 1.8s → `teleport('bridge')` 等 4.5s | **两次均 `state='idle'`、`hp=320`、`bossbar.opacity='0'`**；从未进入 engage | play-expert P-05 / ui-perf UI-02 写的复现步骤「`teleport('jiangtai')` 靠近触发 engage」**在本机未复现**。原因待测：`boss.dist()` 只算 XZ 平面距离，而 `teleport` 把 `player.actor.pos` 设在 POI 处、Boss 的 `actor.pos`/`home` 可能在别处；或 `boss.update` 未挂进 updatables。**但代码级事实仍成立**：`boss.ts:153-216` 全文无 `state='idle'` 回赋值（grep 确认），所以缺陷是「状态机缺回退分支」这一**结构性事实**，只是「常驻」能否被玩家触发需要另找触发路径（例如按 J 击杀后 `defeated=true` → `syncHud` 锁 1） |
| B2 右下元素归属 | 传送后右下 DOM 全空（见 E-01） | 与 ui-perf §1.4「右下竖排告示为 3D 招牌」冲突；主线程证据指向 `#poiguide` DOM |
| B3 `world.serialize/save` 探测 | `world` 原型上**无** save/serialize 方法，payload 为 null | 存档走 `SaveManager` + `InteractSystem.save()`（`interact.ts:79-98`）与 `world.ts:324-336` 的 `loadOrMigrateLegacy`；core-expert C01/C02 的读写不对称按该链路复核，不能按 world 方法名去证伪 |

## E-05 屋顶 V-06 射线归因（`_va_roof_ab.mjs`）

从 `city__sunyang__side` 机位 `[296,17.1,66]` 打 25 条射线，命中 `city_roof_5` 的面：
- 法线 `[0.98,0.18,0]` / `[0.32,0.95,0]` / `[0.98,-0.18,0]` / `[-1,0,0]` → **曲面屋顶连续变化，不是独立平顶壳体**；
- 每面顶点色均在 `0.015–0.084` 的深灰区间且三顶点近似相等 → 深色瓦色；
- 材质 `MeshStandardMaterial { color:#ededed, vertexColors:true, side:2(DoubleSide), map:有 }` → 有贴图、有顶点色、双面。

**裁决**：V-06「中央纯色平板」不是另一块几何覆盖，也不是材质分组丢失；是**同一 `city_roof_5` 网格内脊顶盖 cap 的顶面**（法线接近 +Y、顶点色单一），与四周瓦垄的明暗反差被读成平板。`city_roof_5` 单网格 789,336 tris、`city_roof_9` 1,824,314 tris，包围盒横跨 ±27km（合批）。
任何「给屋顶加瓦垄条纹」的修法都必须先说明是改 `buildCurvedUnit` 的 cap 顶点色 / UV，否则会动到全城 1367 顶。

## E-06 主线程自查的方法学陷阱（请红队重点使用）

1. **单帧截图 ≠ 状态序列**：台账 §六 承认动态项只拍按键后单帧；本轮 134 点采样才暴露 S4 死锁。
2. **对照组必须同样可达**：A2 证明「J 无效」有两个可能原因（焦点被吞 / 距离不够），不设对照就会误归因。
3. **DOM 归属要 `elementsFromPoint` + `getBoundingClientRect` 双证**：右下文字既可能是 3D 招牌投影也可能是 `#poiguide`，用「看起来竖排」判 3D 会出错。
4. **机位/parity 影响面数**：同一场景俯视 44.7M tris、侧视 27.1M tris，不可当性能改善或回归。
5. **运行时 A/B 优先于静态推断**：上一轮（V-01/02/03）3 条初判根因全被 A/B 推翻，本轮同样要求每条修复前先证明根因。
