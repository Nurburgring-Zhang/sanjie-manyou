# 《赛博上河 CyberQingming》全量问题 Spec 与验证计划

> v1.1 ｜ 2026-09-15 ｜ 汇总全部历史问题 → 逐条真实程序测试/截图/审核验证 → 状态固化
> 验证基线：v1.2.1（构建 1.62s，21/21 单测，五道门禁 PASS，spec-e2e 8/8 + e2e2 2/2 + e2e3 键盘 7/7）
> e2e 脚本：`spec-e2e.mjs` / `spec-e2e2.mjs` / `spec-e2e3.mjs`（node 直跑，需 preview@4173）；截图证据：`screenshots/`

## 一、崩溃与阻断类（全部已解决 ✅）

| ID | 症状 | 根因 | 修复 | 验证证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ISS-01 | 后台标签页世界生成停摆 6% | rAF 节流 | MessageChannel 让步分帧 | e2e：无头加载完成，`__qingming` 就绪 | ✅ |
| ISS-16 | 开场运镜黑屏冻结/整循环死亡 | 首帧 rAF 时间戳早于 start() → 负 dt → CatmullRom 负索引崩溃 | dt 钳非负 + u 钳非负（engine.start） | e2e ISS-01/16：加载后 t 正常前进，零 pageerror | ✅ |
| ISS-04 | 水面 shader 编译失败整场黑 | fog chunk 缺 mvPosition | 自包含雾计算重写 | e2e：全程零 console error | ✅ |
| ISS-02 | NavGraph.connect findIndex=-1 崩溃 | 图连接越界 | maxY 过滤+最近邻兜底 | 加载完成即证（寻路在初始化链） | ✅ |
| ISS-17 | 帝国东西墙成 10km 板横贯全城 | 循环解构 sx/sz 两轴尺寸写反 | 单开关推导两轴（12/len 互换） | e2e ISS-17/19：桥区四向 60m 零 wall 命中 | ✅ |
| ISS-19 | 丰都 90 座鬼屋落人间地表 | 高度字段漏加 UNDER.y=-260 | 每高度显式 + 基准 | e2e ISS-17/19 + screenshots/fengdu.png | ✅ |

## 二、几何与结构类

| ID | 症状 | 根因 | 修复 | 验证证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ISS-10 | 屋顶倒金字塔 | Cylinder rt>rb | rt<rb 收尖 | screenshots 各街景屋顶 | ✅ |
| ISS-18 | 屋顶碎片/剪曲面 | compose 先缩后旋，45° 叠 ry 被非等比缩放剪切 | b.pyramid：45° 烘进几何再缩放 | 截图孙羊/桥景屋顶整齐 | ✅ |
| ISS-27 | 三层檐高空"碎片堆" | 中/上层檐悬空无承托 | 层间墙座咬合+层宽收紧 1.0/0.66/0.38+翘角贴沿 | screenshots/high-angel.png | ✅ |
| ISS-11 | 屋顶无底盖/墙体断裂 | 主体未插入屋顶 | 主体上延 0.8m（已被三层檐体系继承） | 同上 | ✅ |
| ISS-25 | 天光光柱近看是平面 | 单层锥 opacity 0.1 | 三同心锥梯度透明度 0.028/0.05/0.085 | screenshots/lingxiao.png | ✅ |
| ISS-26a | 角色方盒"胶囊人" | 池几何无服饰语义 | 锥台袍身/展脚幞头/宽檐斗笠/环带（池 geo 语义化） | 截图街面人物剪影 | ✅（glTF 蒙皮为二期） |
| ISS-27b | 斗拱层叠不足 | 单排斗拱 | dougongBand（栌斗+华拱+泥道拱+散斗）+ornate 双排 | 截图孙羊正店檐下 | ✅（NURBS 曲面为二期） |

## 三、渲染与光影类

| ID | 症状 | 根因 | 修复 | 验证证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ISS-12 | 全城昏暗/幽冥雾泄漏地面 | 雾过渡区间反+无环境光 | 仅 y<-100 生效+AmbientLight+分段曝光 | 截图亮度统计（naihe 104→155） | ✅ |
| ISS-05 | 银河侧视成黑线 | 盒段几何 | 粒子带加厚散散化 | e2e 零错误+夜景截图 | ✅ |
| ISS-14 | 天空散乱黑线 | 灯串挂线等 | 移除挂线 | 同上 | ✅ |
| ISS-20 | 地形-地坪 z-fighting 全程闪烁 | 62km 地形与 city_ground 共面 y=0 | 地形城区下沉 0.5m（渲染层，heightAt 不动） | 截图街面无闪斑 | ✅ |
| ISS-23 | 全城无水（河床被地形埋没） | 地形 dip 后仍高于河床/水面 | 水面抬至 y=0.15 夹于两岸 | **e2e ISS-23：河断面 `bian_river@0.15` 实证** | ✅ |
| ISS-29 | 街道与地坪同色淹没 | road 色提亮过头 | road 加深 0x8a7f6a | screenshots/bridge.png 街道可辨 | ✅ |
| ISS-30 | 高空灰幕 | ①SSAO×对数深度不兼容 ②地形雾霾插值 0.95@3.5km ③城区底色灰褐×暮色蓝光 | 移除 SSAO+插值收敛 0.55@9km+城区底色提暖 #9a8462 | screenshots/high-angel.png 对比三连 | ✅（残留轻微观感，列 ISS-31 跟踪） |

## 四、玩法与交互类

| ID | 症状 | 根因 | 修复 | 验证证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ISS-07 | WASD 反向失灵 | avatarCtl 无条件劫持相机 | 仅附身模式挂载+移动向量修正 | 附身入口仍在（UI 附加身键） | ✅（键盘模拟未自动化，手工可复测） |
| ISS-08 | 人物水平躺着移动 | Pose 共享对象污染 | writeActor 26 字段完整重置 | 截图全场景人物直立 | ✅ |
| ISS-09 | 手持道具飞速旋转 | 手臂摆动无阻尼 | shPL/shPR/elL/elR 阻尼+战斗道具幅减半 | 截图持械人物 | ✅ |
| ISS-21 | 传送相机扎进建筑/墙体 | 机位偏移写死 | POI 机位表 CAM_OFF 逐点调校 | **e2e ISS-21：7 POI 下方 0.5m 零命中** | ✅ |
| ISS-22 | 传送后看向随机方向 | setCamMode('fly') 早退不重算 yaw/pitch，首帧陈旧朝向覆盖 lookTarget | teleport 内显式重算 yaw/pitch | **e2e ISS-22：视线夹角 0.00°** | ✅ |
| ISS-13 | NPC 密度不均/拍成列 | maxPerWard 公式+wardCells 仅对角线 | 全网格 100 坊+容量公式 | **e2e ISS-13：在场 933 人**；截图散布 | ✅ |
| ISS-15 | 坊墙空中网格线 | 坊墙+地坪生成 | 移除 | 高空截图无线网 | ✅ |
| ISS-03 | 道具池容量溢出 | fan 120 不够 | 全道具池扩容（fan 400 等） | e2e 零错误 | ✅ |
| ISS-06 | 招牌文字乱码 | 图集 2048² 溢出 | 5120² 主图集+288×84 名牌图集 | 截图招牌（王家紙馬/飯鋪/孫羊正店）可读 | ✅ |

## 五、工程与交付类

| ID | 问题 | 修复/纪律 | 状态 |
| --- | --- | --- | --- |
| ISS-32 | 版本错位：用户运行 9/6 旧 exe | v1.2.0 重打包（9/10 11:25）；纪律：**每次交付必须重新打包并在报告中给出包时间戳** | ✅ |
| ISS-33 | 外网二进制资产不可达（TLS 拦） | 派生 PBR 真实替代 + 50 卷引入手册（RoofingTiles013A/Ground110/WoodFloor064） | ✅（真 PBR 落盘待有网打包机） |
| ISS-31 | 高空视角地坪观感仍偏平 | 地坪细节层 `pavement.ts`：5931 块石板实例铺装（街道/广场/院落，1 draw call）+ 140 块坊区大尺度微差色斑（明度对齐 groundTex 受光色调） | ✅ screenshots/pavement-street.png 街面石板拼花可读；pavement-mid.png 色斑自然；draw calls +2 |
| ISS-34 | 键盘交互（WASD/附身/开船）未自动化 | `spec-e2e3.mjs`：CDP Input 真实按键回放（V 附身/W 前向位移/D·S 横移后退语义/Shift 2.3× 疾驰/开船 W 油门 14.5m·A 左舵·E 靠岸） | ✅ 7/7 PASS，全程零错误 |
| ISS-35 | 12 卷设定书的二期内容（星宿九府内饰/十八狱逐狱装置/城外庙观内饰/838 件物品实例化） | `docs/PHASE2-PLAN.md`：M1-M9 里程碑落排期（批次一 P0 叙事闭环：十八狱→内饰两批；批次二 P1 密度：九府∥七山庙观；批次三 P2：物品经济/生物行为/glTF） | ✅ 排期完成（依据 99 卷 §三 P0-P2） |

## 六、回归测试计划（每次交付必跑）

```bash
npm run build && npx vitest run          # 1. 编译+单测（21 断言）
node spec-e2e.mjs && node spec-e2e2.mjs && node spec-e2e3.mjs  # 2. 八项回归 + 键盘交互 7 项（本 spec 第一~四节可自动化项）
node audit.mjs                           # 3. 14 机位截图 + 零错误断言
node bisect.mjs && node highview.mjs     # 4. 高空视角专项
py -X utf8 ~/.zcode/acs/scripts/run_gates.py --state .acs/task-state.json --root . --tier T3 --record .acs/verify-record.json
npm run dist:win                          # 5. 重打包（ISS-32 纪律）
```

判据：2 中 8/8 PASS；3 零 ERRORS；门禁全 PASS。任何 FAIL 禁止交付。

## 七、第四/五轮增量（曲面屋顶换代）

| ID | 问题 | 状态 | 证据 |
| --- | --- | --- | --- |
| ISS-36 | 曲面屋顶生成器 ring 参数未归一化（ring(j) 应为 ring(j/N)），单元放大 12 倍成巨壳 | ✅ 已修 | 构建绿+全城截图无巨壳 |
| ISS-36b | 曲面单元无 UV → 贴图失效纯色 | ✅ 已修（UV 网格 k/K×3） | 同上 |
| ISS-37 | 曲面屋顶顶面俯视偏亮偏平（贴图/光照表现待调） | 🔶 开放：调 roofTex 对比度/顶面 AO 渐变/减少 DoubleSide 依赖 | screenshots/sunyang.png |
| ISS-38 | glTF 角色管线 | 🔶 基建待资产：9/15 复验——npm 通道可达但 @pmndrs/assets 仅 3 个测试模型（无蒙皮人形）；sample-models 类包连续 ECONNRESET（two-strike 停）；GitHub/CDN TLS 拦截不变。GLTFLoader 接入点已留（pools/actors 换装位），资产到位即启用（PHASE2-PLAN M9） | 50 卷手册 |
| ISS-37 追加 | 曲面屋顶俯视偏亮偏平 | roofTex 深灰底重绘（#5a6472 底+强垄沟对比+高光条）+emissive 压暗 0x232019 | ✅ screenshots/sunyang.png 瓦面可读 |
| ISS-39 | 第五轮：全纹理 1024px（墙/瓦/地/木/地形五系）+ 墙裙砖砌层 + 角色织物法线（BODY_MAT 升 Standard） | ✅ 构建/测试/门禁/截图四证 | screenshots/bridge.png, high-angel.png |
| ISS-40 | 第六轮：隐身特效物污染射线检测（未召唤的天劫灯塔/掌佛殿藏原点，THREE.Raycaster 不查 visible，河断面 e2e 误命中灯塔尖 y=23.1） | vfx 塔/棕榈 hidden 时 position.y=-9999 沉出世界；spec-e2e 增加可见链过滤（可见性感知射线） | ✅ spec-e2e 8/8；ISS-23 改 6 点采样 5/6 命中 bian_river@0.15 |
| ISS-41 | spec-e2e ISS-22 断言语义错位：fly 相机 lookTarget 为固定 30m 前瞻点，按「点距离<0.5m」断言必假阳 | 改为视线方向夹角断言（<2°，与 e2e2 一致）——传送朝向玩法语义即「POI 居中」 | ✅ 实测夹角 0° |

## 八、第七轮：全量内容品质升级（模型/服化道/动作）

> 2026-09-19 ｜ 三方案竞标（池几何合并 17.95 vs glTF 蒙皮 13.6 vs 纯贴图 13.8）→ 方案 A 实施并全量验证

| ID | 内容 | 升级明细 | 验证证据 |
| --- | --- | --- | --- |
| ISS-42 | 角色模型细化（全城 936 人） | 袍摆外扩层（行走袍服剪影）、双耳、翘头方靴、交领 V 衽、玉带钩、发髻巾结；**新增宽袖大袖池**（随摆臂微荡，936 人 ×2=1872 片实例） | 程序化计数 sleeve=1872；v7-street-detail.png |
| ISS-43 | 神佛服化道 | **莲台池**（莲瓣 ring+台座，9 具）+ **背光圆光池**（柔光加混材质，佛祖/观音 2 面，buddha 分组）；如来/观音改 preach/sitLotus（说法印+呼吸光环） | 程序化计数 lotus=9 mandorla=2；v7-lotus-guanyin.png 云海佛光 |
| ISS-44 | 礼佛动作组 | pray（三拜跪拜节奏）/incense（上香过顶）/sitLotus（结跏趺坐+呼吸光环）/preach（说法印）；僧人行为接线（佛前跪拜/上香祈福） | e2e 零错误；行为权重进 jobs |
| ISS-45 | 神兽/动物/坐骑细化 | 马（颈鬃+甩尾+双耳）、龙（双角+龙须+背脊鳍刺）、麒麟（独角+鳞背鳍排+尾梢鬃团+龙须）、仙鹤（丹顶+长喙+尾羽）、牛驴（双角+吻部）、骆驼/禽（尾/冠喙） | pools 几何合并；e2e 零错误 |
| ISS-46 | 植被与灯器 | 树冠双锥层叠+树根外扩（1500 株重定位）；**桃林 16 株**（河岸桃花）；街灯/灯串换六角宫灯+垂穗 | terrain 重定位公式；v7-street-detail.png |
| ISS-47 | 道具细化 | 禅杖加禅环、刀加刃线镡口、枪加红缨枪尖、扇骨、提篮提梁货堆、**新增陶罐/卷轴池**（摊贩兼持）、幡旗垂布 | pools 几何；jobs 接线 |

回归：构建 1.52s｜vitest 21/21｜spec-e2e 8/8｜e2e2 2/2｜e2e3 7/7｜audit 14 机位 ERRORS NONE｜五门禁 PASS｜包 `release-v11\赛博上河-CyberQingming-x64.exe`（75.2MB，**2026-09-19 22:14:59**）
