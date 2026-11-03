# V8 生物与 NPC

> **诚实边界**：本轮 `WebSearch` 配额耗尽（见 `00-共享约束.md`），**未做任何联网核实**。神话出处只写母题名（如"《山海经》系统的九尾狐"），具体篇目、卷次一律标「待检索核实」，不写伪引文。现实物种按常识归类比附，同样标「待核实」。
> 所有实例数、池上限、角色数来自仓库实读；所有耗时、面数为算式推算并标「估算，待实测」。

---

## 0. 起手：四条把设计框死的数字

| # | 事实 | 来源（实读） | 直接推论 |
|---|---|---|---|
| F1 | `MAX_HUMANS = 4800`，`spawnActor` 在超限时**抛错**而非返回 null | `src/actors/pools.ts:133`、`src/actors/crowd.ts:1211` | 一次误用不是"少一个人"，是**整个 loading 卡死**。注释原文：「池满会让 loading 卡死而不是报错」 |
| F2 | 当前在册角色 **4496**，余量 **304** | 本任务给定 | 生物若走 `crowd`，最多只能加 304 个；而 `ensureVenues` 还要占（天宫 305 + 地府 505 已排入计划） |
| F3 | `BeastPool` 槽位：`body`/`head` 各 168、`leg` 560、`tail` 120、`horn` 320、`wing` 96、`mane`/`spine` 各 72、`eye` 160 | `src/sky/creatures.ts:150-168` | 现有 90 只生物已占 `body` 78 槽 → **只剩 90 槽**。这是繁殖的硬顶，比 CPU 紧得多 |
| F4 | `SPECIES` 现有 42 行，其中 5 行无独立躯体（四行"总目/全录/索引" + `孟婆位`），实体 **37 种** | `src/sky/creatures.ts:56-104` | 要凑到 40 种以上，至少新增 3 种；本卷给 8 种 + 1 尊借自 `DEITIES`，实到 **46** |

F2 与 F3 合起来给出本卷最重要的一句判断：

> **生物的瓶颈不在 CPU、不在面数、在槽位。** 加 90 只生物对帧时间的影响不到 0.4ms，但第 91 只会让 `body` 池静默跳过（`addBeast` 里 `if (body < 0) return;`），玩家看到的是"繁殖了但没生出来"。

---

## 1. 生物分类表（46 条）

### 1.1 表头约定

- **体型**写作 `长×高`（米），算法是 `GROUPS[group].l/h × shape.l/shape.h × spawn.scale`（`creatures.ts:30`、`:1202-1205`）。`小/中/大/神话` 四组基准分别是 `0.46×0.34`、`1.20×0.95`、`2.30×1.80`、`4.80×3.60`。
- **行为**列直接对应 `CreatureSystem.update` 里已有的三种积分：`环游`（`b.ang += dt·speed/r`，`:1184`）、`浮沉`（`b.y += sin(t·0.55+seed)·1.6`，`:1190`）、`驻守`（`stationary:true`、`speed:0`），以及 `runner`（`runners[]` 折线巡逻，`:1158`）。
- **生成**列照抄 `SpawnCfg`（`x, z, y, n, r, speed, host`）。`host` 决定 y 的换算：`sky` 走 `heavenY()`，`under` 用 `UNDER.y=-260`，`city` 原值。
- **掉落**列的价格**全部待与 V4 的矿石/器物表对表**（见 §8 弱项 3）。
- 新增 8 条用 `X-CRT-xx` 编号，避开 43/10 卷的续号段。

### 1.2 被动（Passive，12 种）—— 不主动攻击，可猎可驯

| id | 名 | 依据 | 体型 | 行为 | 生成条件 | 掉落 |
|---|---|---|---|---|---|---|
| `C-CRT-05` | 鱼群 | 现实：汴河鲤鲫（待核实鱼种） | 0.46×0.27 | 环游 r7，水面浮沉 0.18 | city `(0,1.02,16)` n6 r7 v1.1 | 鱼 ×1（8 文） |
| `C-CRT-04` | 雁阵 | 现实：鸿雁南迁 | 1.52×0.82 | 环游 r120，飞行浮动 ±1.6 | city `(300,72,-500)` n6 v4.2 | 雁羽 ×2（3 文） |
| `C-CRT-08` | 鹿 | 现实：梅花鹿 | 1.20×0.95 | 环游 r18 v1.2 | city `(-1800,0,-900)` n2 | 鹿茸 ×1（60）/ 鹿肉 ×2（6） |
| `T-CRT-002` | 玉兔 | 神话：月宫玉兔 | 0.75×0.65 | 环游 r5 v0.6 | sky `(40,209.1,-55)` n1，scale 0.6 | 无（神兽，不可击杀） |
| `T-CRT-007` | 金鲤 | 神话：鲤跃龙门 | 1.20×0.62 | 环游 r9 + 跃起 `+2.4·max(0,sin)` | city `(120,1.02,14)` n3 v1.4 | 金鳞 ×1（50） |
| `T-CRT-015` | 仙鹤 | 现实+神话：丹顶鹤 | 0.76×0.66 | 环游 r120 v3.4，飞行 | city `(40,42,60)` n3 scale 0.7 | 鹤羽 ×2（20） |
| `C-CRT-02` | 丝路驼队 | 现实：双峰驼 | 2.53×1.80 | 环游 r34 v0.9 | city `(-1500,0,600)` n3 | 驼毛 ×3（12） |
| `C-CRT-03` | 草原马群 | 现实：蒙古马 | 2.65×1.89 | 环游 r42 v2.6 | city `(1800,0,900)` n3 | 马鬃 ×2（10） |
| `T-CRT-008` | 灵猴 | 现实：猕猴 | 0.84×0.86 | runner 六点环（`creatures.ts:1041`） | sky 蟠桃园 n6 v1.2 | 桃核 ×1（5） |
| `X-CRT-01` | 黄犬 | 现实：宋代市井家犬（**待核实**：宋代犬市记载） | 1.10×0.76 | 跟随主人 + 游荡 r8 | city 各坊 n8 v1.0 | 无（家畜，不可杀） |
| `X-CRT-02` | 山羊 | 现实：北方山羊 | 1.02×0.80 | 群游 r14 v0.7 | country 七岳山脚 n6 | 羊皮 ×1（15）/ 羊奶 ×1（4） |
| `X-CRT-04` | 水獭 | 现实：欧亚水獭 | 0.62×0.36 | 沿岸环游 r6，入水浮沉 | city 汴河岸 n4 v0.9 | 獭皮 ×1（25） |

被动类的共同约束：`aggro = 0`（永不主动），`flee = 0.6`（血量低于 60% 逃跑）。**黄犬不可杀**是刻意的——市井里有一条能叫的狗，比多一种可猎动物更能撑住"活着的城"。

### 1.3 中立（Neutral，11 种）—— 不惹不打，越界反击

| id | 名 | 依据 | 体型 | 行为 | 生成条件 | 掉落 |
|---|---|---|---|---|---|---|
| `C-CRT-06` | 狼群 | 现实：灰狼 | 1.20×0.95 | 环游 r26，`aggro 18` 群起 | city `(-2400,0,-1500)` n3 v1.6 | 狼皮 ×1（30）/ 狼牙 ×1（8） |
| `C-CRT-07` | 鹰 | 现实：苍鹰 | 1.20×0.95 | 盘旋 r60 v5.2，俯冲 | city `(-200,96,300)` n2 | 鹰羽 ×1（8） |
| `T-CRT-009` | 石狮 | 习俗：守门石狮 | 1.96×1.80 | 驻守 r4，`aggro 6` | city `(536,0,212)` n2 | 无（石像） |
| `T-CRT-010` | 貔貅门墩 | 神话：貔貅 | 1.96×1.80 | 驻守 r4，`aggro 6` | city `(520,0,216)` n2 | 无（石像） |
| `T-CRT-012` | 哮天犬 | 神话：二郎神细犬 | 1.61×1.08 | runner r10 v1.8 跟随 | sky `(20,206.12,20)` n1 | 无（神兽） |
| `D-CRT-016` | 骨犬 | 神话：阴间循迹犬 | 1.02×0.67 | runner 四点环 v0.8 | under 枉死城 n3 | 骨 ×2（2） |
| `T-CRT-011` | 青牛 | 神话：老子青牛 | 4.80×2.88 | 环游 r12 v0.7 | sky `(-120,208.05,-26)` n1 | 无 |
| `T-CRT-006` | 仙鹿 | 神话：仙鹿 | 2.30×1.62 | 环游 r12 v1.0 | sky `(-166,201.1,60)` n2 | 无 |
| `D-CRT-002` | 守关籍案 | 项目内设定（地府关卡） | 1.84×1.53 | 驻守 r5，`speed 0` | under `(0,-260,-126)` n2 | 无 |
| `D-CRT-008` | 判官案 | 项目内设定 | 1.84×1.53 | 驻守 r4，`speed 0` | under `(0,-260,46)` n1 | 无 |
| `X-CRT-03` | 野猪 | 现实：野猪 | 2.00×1.30 | 环游 r20，`aggro 12` 冲撞 | country 林缘 n5 v1.8 | 獠牙 ×1（40）/ 猪肉 ×3（10） |

中立类的判定式：`attack ⟺ dist(target) < aggro ∧ target 触发了 hurt/skill`。**不是"进入半径就打"**——那会让玩家穿过草原时被狼群无条件围攻。

### 1.4 敌对（Hostile，10 种）—— 主动仇恨

| id | 名 | 依据 | 体型 | 行为 | 生成条件 | 掉落 |
|---|---|---|---|---|---|---|
| `D-CRT-010` | 鬼城游魂 | 民间信仰：游魂 | 0.46×0.34 | 环游 r30 v0.5，`aggro 14` | under `(0,-260,0)` n6 | 阴德碎片 ×1（阴德 2） |
| `D-CRT-013` | 怨鬼 | 民间信仰：怨魂 | 0.46×0.34 | 环游 r22 v0.7，`aggro 16` | under `(0,-260,20)` n4 | 怨气 ×1（阴德 3） |
| `D-CRT-014` | 鬼火精灵 | 民间信仰：鬼火（磷火） | 0.46×0.34 | 环游 r20 v0.9，发光 | under `(-40,-258.9,-132)` n8 | 磷粉 ×1（阴德 1） |
| `D-CRT-011` | 水鬼 | 民间信仰：落水鬼 | 0.96×0.67 | 环游 r14 v0.6，`aggro 10` | under `(0,-259.85,-70)` n3 | 水鬼发 ×1（阴德 4） |
| `D-CRT-012` | 吊死鬼 | 民间信仰：缢死鬼 | 0.84×0.95 | 环游 r5 v0.35，`aggro 8` | under `(60,-260,-40)` n2 | 麻绳 ×1（阴德 2） |
| `D-CRT-015` | 纸人阵列 | 民间信仰：纸扎厌胜 | 0.72×0.86 | 环游 r26 v0.4，`aggro 20` 群体 | under `(540,-260,85)` n6 | 纸灰 ×1（阴德 1） |
| `D-CRT-018` | 夜叉 | 佛教/民间：药叉 | 4.80×3.78 | 环游 r17 v0.45，`aggro 22` | under `(0,-260,6)` n2 | 夜叉叉 ×1（阴德 12） |
| `D-CRT-019` | 罗刹 | 佛教/民间：罗刹 | 4.80×3.96 | 环游 r23 v0.55，`aggro 28` | under `(0,-260,6)` n2 | 罗刹爪 ×1（阴德 15） |
| `X-CRT-05` | 山魈 | 神话：《太平广记》山魈母题（**篇目待核实**） | 1.60×1.30 | 环游 r24，`aggro 26` 夜行 | country 深山 `elev>400` n3 夜间 | 山魈骨 ×1（80）/ 朱砂 ×1（40） |
| `X-CRT-07` | 蛟 | 神话：斩蛟母题（《吕氏春秋》/地方志系统，**待核实**） | 6.40×2.60 | 水下环游 r30 v1.2，`aggro 30` | country 巨泽深水 n1 | 蛟鳞 ×2（120）/ 蛟筋 ×1（180） |

敌对类必须挂 `hp/atk`，且 `atk` 要能被 `physics.ts:23` 的 `tierOf(force, target)` 消费。现有 `profileOf` 只认 `deity/shuihu/ghost/soldier/kid/平民` 六类，**新增生物一律走"未匹配 → 平民档"是不行的**（mass 1 / toughness 9 会让夜叉被一拳打飞）。必须在 `profileOf` 里加一条 `if (a.data?.group === 'beast') return { mass: …, power: …, toughness: …, fragile: cls==='hostile' }`。

### 1.5 Boss（7 种）—— 有名字、有阶段、有不刷新语义

| id | 名 | 依据 | 体型 | 行为 | 生成条件 | 掉落 |
|---|---|---|---|---|---|---|
| `D-CRT-003` | 牛头 | 民间信仰：地狱狱卒 | 人形 4.0（`scale 2.3`） | runner 六点环 90s / 1.45m/s | under 殿前广场 n1 | 三股叉（唯一，`codexLog`） |
| `D-CRT-004` | 马面 | 民间信仰 | 人形 4.0（`scale 2.3`） | runner 五点环 150s / 1.05m/s | under 十八狱内圈 r75 n1 | 九环丧门锤（唯一） |
| `D-CRT-005` | 黑无常 | 民间信仰：范无救 | 人形 2.3（`scale 1.32`） | runner 黄泉路往返，`staggerWalk` | under `(180,-260,24)` n1 | 锁链（唯一） |
| `D-CRT-006` | 白无常 | 民间信仰：谢必安 | 人形 2.3 | runner 错半程，`walk` | under `(130,-260,21)` n1 | 招魂幡（唯一） |
| `D-CRT-009` | 阎罗王 | 佛教/民间：阎摩 | 人形 2.6（`scale 1.5`） | 驻守，`DeityStage` 对话 | under 阎罗殿 n1 | 无（不可击杀） |
| `T-CRT-013` | 鲲鹏 | 神话：《庄子·逍遥游》鲲鹏（**原文可引，版本待核实**） | 9.00×4.50 | 环游 r64 v3.2，飞行 | sky `(300,262,-420)` n1 scale 1.25 | 鲲羽 ×1（唯一） |
| `—` | 巨灵神 | 神话：劈山巨灵 | 人形 5.0 | `boss.ts` 的 `JULING` 状态机 | sky 将台 n1 | 图鉴条目（`world.ts:638` 已接线） |

**Boss 与普通生物的关键差异**：Boss 不参与**本卷的**效用 AI。`JULING` 已经有独立状态机（`boss.ts:36` 的 `sweep/grab/interval/phase2At`），照它的形状复制第二个 Boss 只需换一张表——这是项目已经证明过的扩展路径（`boss.ts` 文件头原文："第二个 Boss 复用同一状态机、只换这张表"）。

### 1.6 灵兽（Spirit，6 种）—— 不参战、不繁殖、有唯一性

| id | 名 | 依据 | 体型 | 行为 | 生成条件 | 掉落 |
|---|---|---|---|---|---|---|
| `T-CRT-003` | 麒麟 | 神话：仁兽麒麟 | 5.04×3.60 | 环游 r16 v1.4 | sky 云台 n1 | 无 |
| `T-CRT-004` | 天龙 | 神话：龙 | 6.48×2.52 | 环游 r90 v5.5，飞行 | sky `(0,268,0)` n1 | 无 |
| `T-CRT-005` | 凤凰 | 神话：凤凰 | 4.80×2.88 | 环游 r70 v5.0，飞行 | sky `(120,258,110)` n1 | 无 |
| `T-CRT-014` | 白泽 | 神话：白泽知万物（《白泽图》系统，**待核实**） | 4.80×3.60 | 环游 r6 v0.6 | sky `(-24,206.12,-22)` n1 | 无 |
| `X-CRT-06` | 九尾狐 | 神话：《山海经》青丘九尾狐（**篇目待核实**） | 2.40×1.50 | 环游 r18，`tame` 专属 | country 深山 `elev>600` n1 | 无（可驯为坐骑） |
| `X-CRT-08` | 纸马 | 项目内设定：王家纸马（`interactPoints.ts` B2） | 1.80×1.40 | 跟随主人，`fly=false` | city `(352,0,66)` n2 | 无（纸扎，烧给地府） |

灵兽的判定：`hp = Infinity` 或 `damageable = false`。理由是**灵兽是"图鉴内容"不是"战斗内容"**——打死麒麟拿不到任何东西，只会让玩家觉得系统没做完。

### 1.7 生态位分布：一个必须承认的失衡

把 46 条按 `spawn.host` 数一遍：

| host | 种数 | 占比 |
|---|---|---|
| 人间城郭 `city` | 14 | 30% |
| 地府 `under` | 16 | 35% |
| 天宫 `sky` | 11 | 24% |
| 野外 `country` | 5 | 11% |

问题是明显的：**野外是最大的空间（40km × 40km），生物种类却最少（5 种）。** 玩家出城往北走 15km 到草原，一路上能遇到的只有野猪、山羊、山魈、蛟、九尾狐。

这不是设计取向，是历史原因——现有 42 行 `SPECIES` 是按"43 卷鬼魔 / 10 卷仙兽"两本册子登记的，册子里本来就只写了城、天、地三处。野外生物从来没有被登记过。

本卷的判断：**这个失衡不修，但要写明。** 理由：

1. 补野外生物不是加表行，是加 5–8 具几何 + 5–8 套行为，工作量等于本卷其余部分的总和
2. 野外已经有 `flora.ts` 的 `FaunaAnchor`（`flora.ts:813`）：`kind: 'crane' | 'deer' | 'qingluan' | 'qilin' | 'tiger'`，五型锚点，挂在七岳的山林里。它们是**静态装饰**（`buildMountainFauna` 出的是实例化几何，不是 `Beast`），不参与 AI
3. V7 的 14 类遗迹里有 9 类在野外。正确的补法不是"加生物"，是**让遗迹带生物**——`taoistRuin` 带妖祟、`beacon` 带狼群、`mortuary` 带野狗。这样"野外有东西"这件事由遗迹承担，而不是由一张更长的生物表承担

所以本卷给出的 5 种野外生物是**种子**，不是全集。V7 落地后，每类野外遗迹按 `danger` 挂 1–3 种，实际野外遭遇会从 5 种涨到 12 种左右，且每一种都有"为什么在这里"的理由（守墓的、守烽的、吃尸的），比平铺一张 20 行的野外生物表更省。

---

## 2. 与现有代码的整合

### 2.1 直接复用（一行不改）

| 资产 | 位置 | 复用方式 | 为什么不能重写 |
|---|---|---|---|
| `GROUPS` 四体型表 | `creatures.ts:30` | 新生物的 `group` 直接落四档 | 它的 `gait`/`orbit` 与 `Beast.phase` 的步频耦合，另起一份会让腿摆与位移不同步 |
| `BeastPool` | `creatures.ts:108` | 所有生物实例都进它 | `InstancedMesh` + `setColorAt` + `flush()` 的延迟上传是三处性能优化的交点 |
| `VGeo` 全套图元 | `creatures.ts:185-458` | `tube/box/frus/cyl/cone/beam/feather/fan` | 顶点色 + 逐面法线 + 法线朝外的 `triO`，重写等于重做一遍几何内核 |
| `beastGeo(form, opt)` | `creatures.ts:660` | 8 型放样，`lod`/`thin` 两档 | 每型的签名细节（龙的鳞环、麒麟的甲片、凤凰的冠羽）是逐条调过的 |
| `FORM_EYES` | `creatures.ts:965` | 眼位与半径 | 与 `slot.eye` 的 `+i` 增量绑定 |
| `runners[]` 折线巡逻 | `creatures.ts:1158-1173` | 牛头/马面/无常/骨犬/灵猴的既有路线 | 它已经处理了 yaw 的最短弧插值（`while (dyw > π)` 那段） |
| `update` 的三套积分 | `creatures.ts:1175-1195` | 环游/浮沉/水浮 | 是 `Beast.ang` 的唯一驱动 |
| `W12_MAT` | `creatures.ts:11` | 顶点色材质，与 `VEH_MAT` 同 shader | 新开一份材质会多一个 program |

### 2.2 必须扩的（改结构，不改语义）

**扩 1：`SpeciesDef` 不加字段，另开 `bestiary.ts`。**

理由：`SPECIES` 是 42 行台账，每行已有 12 个字段。再加 `hp/atk/aggro/tame/breed/loot` 六个，等于让 42 行全部重写一遍，而且"几何分型"与"行为数值"本来就是两件事——前者是美术，后者是策划。

```ts
// src/data/bestiary.ts（新增）
export type Cls = 'passive' | 'neutral' | 'hostile' | 'boss' | 'spirit';

export interface BestiaryRow {
  key: string;                  // 外键 → SpeciesDef.key
  cls: Cls;
  basis: string;                // 依据（现实/神话）
  hp: number;
  atk: number;
  aggro: number;                // 仇恨半径（m），0 = 永不主动
  flee: number;                 // 逃跑阈值（hp 比例），0 = 不逃
  damageable: boolean;
  tame?: { item: string; p: number; level: number };
  breed?: { item: string; cd: number; cap: number };
  loot: { item: string; p: number; n: [number, number] }[];
}

export const BESTIARY: BestiaryRow[] = [ /* 46 行 */ ];
export const BESTIARY_MAP = new Map(BESTIARY.map((r) => [r.key, r]));
```

代价：多一个文件 + 一次 46 行的 Map 构建（<0.1ms）。收益：`creatures.ts` **零改动**，只在 `CreatureSystem` 里加一个私有 `get best()` 读取口。

**扩 2：`Beast` 接口加 4 个字段。**

现有 `Beast`（`creatures.ts:969-979`）只有运动学字段：`x/y/z/yaw/baseY/ang/phase/seed/cx/cz/r/speed`。它**没有生命、没有敌对、没有目标**。V9（战斗）与 §3（繁殖）都无从接管。

```ts
interface Beast {
  // …既有 17 个字段不动…
  hp: number;          // 当前血量
  state: Act;          // 效用 AI 选出的动作（§4）
  target: number;      // 目标 aId / Beast 索引，-1 = 无
  cool: number;        // 动作冷却（s），递减
}
```

四个字段 × 90 只 = 360 个数，内存 < 3KB。**不加会怎样**：所有战斗/驯服只能靠外部 `WeakMap` 旁挂，那是第二套状态，必然与 `update` 脱同步。

**扩 3：`CreatureSystem` 加 3 个方法。**

```ts
query(x: number, z: number, r: number): Beast[]   // 供战斗/驯服/掉落查询（当前 beasts 是 private）
spawnAt(key: string, x: number, y: number, z: number, host: Host): number
despawn(index: number): void
```

三个方法都**不进 `update` 的热路径**。`query` 是 O(n) 线性扫描（90–180 只，<2µs），不做空间索引——为 180 个对象建网格是过度设计。

### 2.3 `deities.ts`：35 尊的复用边界

**直接复用**：`DEITIES` 表（35 行，`data/deities.ts:12`）、`RING` 弧位（`deities.ts:706`）、`DeityStage.map`（name → `Actor`，public）。

**不能复用**：把神佛当成生物。`DeityStage` 的构造函数会对 35 尊**逐个** `crowd.spawnActor`（`deities.ts:733`）并 `crowd.heroes.push(a)`——这 35 个名额是从 `MAX_HUMANS` 里扣的，且它们 `freeze: true`、`sky: true`、`action: d.daily`。

**一处真实风险，必须写进注释**：

```ts
const ring = d.home === 'court' ? 0 : 2.2 + (i % 5) * 0.8;   // deities.ts:737
```

`i` 是 `DEITIES.forEach((d, i) => …)` 的**全局序号**。在数组中间插入一尊，后面所有 `i` 都会移一位，`2.2 + (i%5)*0.8` 的落位整体抖动 0.8m——石像与神佛演员会错位半米，肉眼可见。

> **铁律：新增神佛只能追加到 `DEITIES` 数组末尾。**

**安全扩展点**：给某尊神加"赐福/对话/任务"，只需 `DeityStage.map.get(name)`，读 `Actor.pos` 与 `Actor.data`，不动几何、不新增角色。

### 2.4 `crowd.ts`：人群的边界与已有的"偷用"

**直接复用**：`spawnActor`、`walkSurfaceY`、`AVOID_CELL` 避让网格（4m 格、每 4 帧重建，`behaviors.ts:180`）、`ensureVenues` 的场所人群。

**铁律：新生物一律不进 `crowd`。**

现状里已经有一处"偷用"：`CreatureSystem` 构造时给骨犬 3 只、灵猴 6 只各调了一次 `crowd.spawnActor`（`creatures.ts:1036`、`:1046`），共 **9 个角色名额**，然后把 `aId` 存进 `this.bound`、在 `update` 里把 `Actor.pos` 同步给 `Beast`。目的是复用 `runners` 巡逻的 yaw 插值。

这个代价是**可接受的 9/4800 = 0.19%**，但它不可复制。理由：

- `spawnActor` 超限是**抛错**不是返回 null（`crowd.ts:1211-1212`），一次误捕会让 `new World()` 整个中断
- `crowd.update` 每帧遍历 `actors` 做避让、行为、`walkSurfaceY`，加进去的生物会额外吃这一整条链（约 0.9µs/角色 × 60fps）
- 生物不需要避让行人、不需要行为库、不需要 `walkSurfaceY`

**量化**：若把 90 只繁殖生物也走 `spawnActor`，`actors` 从 4496 → 4586，`ensureVenues` 的断言 `4496 + planned > 4800` 会先炸（天宫 305 + 地府 505 的计划已经写死）。**所以这条路在数字上就是关死的。**

### 2.5 复用率：9 型放样能吃下几种新生物

`beastGeo` 的 `BEAST_FORM` 表只有 9 项：`long / qilin / feng / kun / yaksha / luocha / baize / crane / tiger`（最后一项只给神像虎座）。新增的 8 种生物必须先回答"用哪条路径"，否则每一种都要新写一具几何。

| 新生物 | 路径 | 具体做法 | 面数变化 |
|---|---|---|---|
| 蛟 `X-CRT-07` | **复用 `long`** | `beastGeo('long', { hex: 0x2e4a52, accent: 0x7ec8b0, thin: 0.8 })` —— 龙与蛟同源，只换鳞色与鬃量 | 0（同一具几何，只是另一个实例） |
| 山魈 `X-CRT-05` | **复用 `yaksha`** | `beastGeo('yaksha', { hex: 0x4a3a2e, accent: 0xd8b45a })` —— 夜叉本来就是"短躯干+长臂+獠牙+角"，山魈的体态描述几乎重合 | 0 |
| 纸马 `X-CRT-08` | **复用 `qilin`** | `beastGeo('qilin', { hex: 0xd8d4c8, accent: 0xb84a3a, thin: 0.3 })` —— 纸扎的麒麟，鬃毛压到 1/3，正好是"纸做的"该有的稀疏 | 0 |
| 九尾狐 `X-CRT-06` | **新增 1 条 `BEAST_FORM` 表项** | 骨架代码一行不改，只加 `fox` 一项：`spine` 抄 `baize`（狮身）、`head.kind='deer'`（尖吻）、`tail: { kind:'strand', len: 1.6, r: 0.06, n: 9 }` —— `strand` 尾的 `n` 就是尾数，9 直接出九尾 | +1 具几何（约 1,200 tris，估算；`beastTris('fox')` 可实测） |
| 黄犬 / 山羊 / 水獭 / 野猪 | **走 `body/head/leg/tail/horn` 池拼** | `SpeciesDef` 只填 `group` + `feat`，不写 `form`。黄犬 `['ear','tail']`、山羊 `['horn','tail']`、水獭 `['tail','fin']`、野猪 `['horn','mane']` | 每只 ~150–200 tris（body 12 + head 12 + 4×leg 20 + tail 10 + horn 24） |

**复用率 4/8 走 form、4/8 走池拼、只新增 1 条表项。** 这个比例是刻意的：`beastGeo` 的价值在于"参数化到能改"，而不是"能无限扩型"。每一种新 form 都要把 `spine` 的 6–9 个截面、腿长、颈位、角型全部手调一遍，一天只能调一具。

**一条必须遵守的纪律**：新 form 的 `eyes` 数组长度决定 `FORM_EYES[form].at.length`，而 `addBeast` 里是按 `slot.eye = take('eye', FORM_EYES[form].at.length)` 分配槽位的（`creatures.ts:1107`）。九尾狐给 2 只眼 → 吃 2 个 `eye` 槽；若给 3 只（"第三只眼"），会多吃 1 槽，而 `eye` 池上限 160、已用约 90，**加 12 只九尾狐就是 36 槽**，余量会被吃光。这条要写进 `BEAST_FORM` 的表头注释。

### 2.6 `runners` 的扩展边界与"不占角色"的巡逻

现有 `Runner`（`creatures.ts:16`）长这样：

```ts
interface Runner { aId: number; pts: THREE.Vector3[]; i: number; speed: number }
```

**`aId` 是硬耦合**：`update` 里第一句就是 `const a = this.crowd.actors.find(x => x.id === r.aId)`（`:1159`）。没有 `Actor` 就没有 Runner——所以任何要巡逻的生物，都必须先 `crowd.spawnActor` 拿一个角色名额。

这就是 §2.4 说的 9 个名额的来源，也是新生物**不能**照抄的原因。

**解法：给 `Beast` 加自带路径，让 `update` 自己走。**

```ts
interface Beast {
  // …既有…
  path?: { pts: [number, number][]; i: number; y: number };  // 只存 x/z 与固定 y
}
```

在 `update` 的分支里加一条（在 `if (b.aId >= 0)` 之前）：

```ts
if (b.aId < 0 && b.path) {
  const tgt = b.path.pts[b.path.i];
  const dx = tgt[0] - b.x, dz = tgt[1] - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.8) { b.path.i = (b.path.i + 1) % b.path.pts.length; }
  else { b.x += dx / d * b.speed * dt; b.z += dz / d * b.speed * dt; b.yaw = Math.atan2(dx, dz); }
  b.y = b.path.y;
}
```

成本：+3 个字段（`pts/i/y`）、+1 个分支、每次判定 1 次 `hypot`。收益：

1. 新生物要巡逻不需要角色名额
2. **现有 9 只（骨犬 3 + 灵猴 6）可以迁出 `crowd`，回收 9 个 `MAX_HUMANS` 名额**
3. `this.bound` 这张 `Map<number, {pos,yaw}>` 可以整个删掉——它存在的唯一理由就是给 `aId` 生物同步位置

第 2 条是**本卷唯一一处"净减少"**：4496 → 4487。虽然只有 9 个，但方向是对的——生物系统应该从 `crowd` 里退出来，而不是挤进去。

代价与风险：迁移后灵猴的 y 不再由 `crowd` 的 `skyGround` 决定，必须显式写 `b.path.y = heavenY(202)`。现有代码在 `:1049-1055` 有一段专门的注释解释"必须走 `heavenY()`，不能写 `202 + HEAVEN_LIFT`，否则灵猴会陷进地里 7.2m"——迁移时这段知识必须原样搬到 `path.y` 的赋值处，否则重演。

### 2.7 材质：一个已经写进注释的坑，扩生物时最容易再踩

`creatures.ts` 的文件头有一段警告（`:6-10`），逐字摘：

> 本文件**不得** import `../actors/pools`（模块级用 `document.createElement`，无头用例会崩），也不得 import `../city/vehicles`。神像与八兽的几何都带顶点色，而池里的 `BODY_MAT` 未开 `vertexColors`（用了会渲成一尊纯白像），故 W12 自持一份顶点色材质。

这段话里藏着一个**对新增生物直接生效的规则**，但现有文档没把它写成判据：

| 几何来源 | 是否带 `color` 属性 | 必须用的材质 |
|---|---|---|
| `beastGeo(form)` → `VGeo.geo()` | ✅ 有（`setAttribute('color', …)`，`creatures.ts:454`） | `W12_MAT`（`vertexColors: true`） |
| `BEAST_POOLS` 的 `body/head/leg/…` | ❌ 无（`BoxGeometry` / `CylinderGeometry` 原始几何） | `BODY_MAT`（无顶点色，靠 `setColorAt` 逐实例染色） |
| `eye` 池 | ❌ 无 | `GLOW_MAT`（`toneMapped:false`） |

所以新增生物时，**先问它走哪条池子**：

- 走 form（蛟/山魈/纸马/九尾狐）→ `forms[form]` 池，材质固定 `W12_MAT`，实例色必须置白（`_bc.setRGB(1,1,1)`，见 `:1222`），否则顶点色 × 实例色会变成脏色
- 走池拼（黄犬/山羊/水獭/野猪）→ `pools['body']` 等，材质 `BODY_MAT`，实例色取 `b.color`（`:1239`）

**混用会怎样**：把一具有顶点色的 `beastGeo` 几何塞进 `BODY_MAT` 的池，几何的 `color` 属性会被材质忽略，整只渲染成纯白——这不是"颜色不对"，是"看起来像没做完"。反过来把无色的 `BoxGeometry` 塞进 `W12_MAT`，`color` 属性缺失会让 shader 拿到未定义 attribute，在 WebGL2 下通常是全黑。

这条判据应该进 `probe-bestiary.mjs` 的 B 组：**遍历所有 `InstancedMesh`，若 `geometry.attributes.color` 存在则 `material.vertexColors` 必须为 true，反之必须为 false**。这比靠人记注释可靠。

---

## 3. 繁殖与驯服

### 3.1 三条上限，取最小

| 约束 | 当前占用 | 上限 | 余量 |
|---|---|---|---|
| `MAX_HUMANS`（`pools.ts:133`） | 4496 | 4800 | **304**（且 `ensureVenues` 还要占，实际可用 ≈ 0） |
| `BeastPool.body`（`creatures.ts:151`） | 78 | 168 | **90** |
| `BeastPool.head` | 78 | 168 | 90 |
| `BeastPool.leg` | ≈ 4×78 − 双足 | 560 | ≈ 240 |
| `BeastPool.tail` / `mane` / `spine` | 部分 | 120 / 72 / 72 | 视物种 |
| 八型 `form` 池（每型 6，`creatures.ts:1079`） | qilin1/long1/feng1/kun1/yaksha2/luocha2/baize1/crane3 = 12 | 8×6 = 48 | **36**（且每型单独限 6） |

**结论：繁殖的硬顶是 `body` 池的 90 槽，不是 4800。**

这条结论反直觉但有据：`MAX_HUMANS` 管的是"人形角色"，生物走的是 `BeastPool` 的 `InstancedMesh`——两套池子互不影响。所以"4496 名角色"这个数字对生物繁殖**不构成约束**，构成约束的是 `body: 168` 这个写死的槽位数。

### 3.2 繁殖规则

```ts
breed?: { item: string; cd: number; cap: number }
```

- **触发**：同一 `key` 的两只成体（`age > 0.3`）距离 < 4m，且双方 `state === 'idle'|'graze'`
- **代价**：消耗 `item` ×1（例如 `羊皮`/`鹿茸`/`马鬃`），`cd` 秒内该对不再触发
- **产出**：1 只幼体，`scale = 0.5`，`hp = 0.4 × 成体`，`age = 0`
- **上限三重**：① 该 `key` 全局 `cap`；② `body` 池余量 > 0；③ `beasts.length < 180`（人为设的软顶，见 3.4）
- **不可逆**：`despawn` 后 `body` 槽**不回收**（`BeastPool` 的 `cursor` 只增不减，`creatures.ts:127`）。这是**设计缺陷但已知**——回收槽位需要 compaction，会把所有 `slot` 索引重排，风险远大于 90 个槽的收益

**为什么不做"幼体长大"的完整生命周期**：`Beast` 的 `scale` 在 `writeBeast` 里直接乘进矩阵（`creatures.ts:1221`），改 scale 是零成本的；但"长大"需要 age 累积、需要换 group（小→中→大是三个不同的 `GROUPS` 基准）、需要重新分配 `leg` 槽。三个改动加起来 ≈ 120 行，收益是"看着它长大"——本卷判断不值，幼体直接在 300s 后 `despawn` 并 `spawnAt` 一只成体。

### 3.3 驯服规则

复用 `MountSystem`（`city/mounts.ts:22`），它已经有 `Rideable[]`、`alive`、`home`、`riderAnchor`。

```ts
tame?: { item: string; p: number; level: number }
```

- **流程**：靠近（<3m）→ 按 E → 消耗 `item` → `p` 概率成功 → 成功则 `rideables.push`（新 `Rideable`，`kind` 取该生物对应型）
- **失败**：`aggro` 立即置为 12、`state='chase'`，并给 30s 的 `tameCd`
- **等级门槛**：`level` 是玩家侧的（village/城市/仙阶），不满足时提示"此兽不认你"
- **上限**：`MountSystem` 的池是 `allocMany` 一次性开的固定量（`mounts.ts:36-42`：`horseBody 6 / craneBody 4 / dragonHead 2 / qilinBody 4`）。**驯服一匹马不会扩池**——第 7 匹马会拿不到 `horseBody` 槽。所以驯服上限 = 池的余量：马 6（已用 3，余 3）、鹤 4（已用 2，余 2）、龙 2（已用 2，余 0）、麒麟 4（已用 2，余 2）

**这是本卷最容易被忽略的一条**：`MountSystem` 的池在构造函数里一次性开死，驯服系统如果不改 `mounts.ts:36` 的 `allocMany` 参数，就只能驯 3 匹马、2 只鹤、2 只麒麟。要放开，必须同时改 `PoolSet.allocMany` 的参数与 `spawnAll` 的初始数量——一处漏改就是"驯服了但看不见"。

### 3.4 性能代价：加 90 只到底花多少

| 项 | 现有（90 只） | 加 90（180 只） | 说明 |
|---|---|---|---|
| 运动积分 | ≈0.09 ms | ≈0.18 ms | `b.ang += dt*speed/r` 与 `sin/cos`，每只 ~1µs |
| 效用决策（§4 分帧 1/4） | 0 | ≈0.06 ms | 180/4 × 8 action × 0.3µs |
| `writeBeast` 矩阵 | ≈0.18 ms | ≈0.36 ms | 每只 8–14 次 `compose/premultiply` |
| `pool.flush()` | ≈0.02 ms | ≈0.02 ms | 每池一次 `needsUpdate`，与实例数无关 |
| **合计** | **≈0.29 ms** | **≈0.62 ms** | 占总帧预算 16.7ms 的 3.7% |
| 面数增量 | — | ≈18,000 tris | 180 只平均 200 tris/只 − 90×200 |
| 内存增量 | — | < 40 KB | `Beast` 对象 180 × ~220B |

（全部为算式估算，**待用 `performance.now()` 包住 `CreatureSystem.update` 实测**。）

结论：**性能完全不是瓶颈。** 90 只的增量只占 3.7% 帧预算、0.13% 面数。真正的限制是 3.1 的槽位表。

这也解释了为什么 §3.2 要设 `beasts.length < 180` 的软顶：**不是因为跑不动，是因为 `body` 池到 168 就静默失败**。把软顶设在 180（略高于 168，留出 12 个 form 生物的余量）是为了让 `addBeast` 在越界前先被业务层拦住，而不是走到 `if (body < 0) return;` 那条静默分支。

### 3.5 繁殖的存档语义：uid 是唯一能撑住重载的东西

繁殖带来一个现有系统不需要面对的问题：**生物列表从"载入期确定"变成"运行期增长"**。

现状是安全的：`initBeasts` 按 `SPECIES` 的数组顺序逐个 `addBeast`，`BeastPool.alloc` 的 `cursor` 从 0 单调递增（`creatures.ts:127`）。只要 `SPECIES` 顺序不变，槽位就永远一样——这是 V10 确定性存档的隐含前提。

加了繁殖之后，这个前提破了。第 91 只生物分到哪个槽，取决于玩家什么时候繁殖的。重载存档时如果只存"当前有多少只"，槽位会重新从 78 开始分配，而存档里的坐标是按旧槽位记的——**错位**。

解法：给 `Beast` 加一个稳定 uid，且**繁殖必须走确定性 RNG**。

```ts
interface Beast {
  uid: string;          // `${key}#${serial}`，serial 由该 key 的繁殖计数递增
}
```

存档只存差异量：

```ts
interface BeastSave {
  uid: string; key: string;
  x: number; y: number; z: number;
  hp: number; tame: boolean;
}
// 只存"运行期新增"的，初始 90 只是 SPECIES 生成的，不需要存
```

重载流程：先跑 `initBeasts`（复现初始 90 只、槽位一致），再按 `BeastSave` 的**数组顺序**逐条 `spawnAt` → `alloc` 出的槽位必然与存档时一致。

**三条硬约束**：

1. **繁殖顺序必须确定**。繁殖触发用的是 `core/rng.ts` 的 `RNG`（项目已有），不是 `Math.random()`。`Math.random()` 会让两次同 seed 的存档走岔，`uid` 的 `serial` 就对不上。
2. **`despawn` 后 uid 不重用**。`serial` 只增不减。否则"杀了第 3 只、又生了 1 只"会撞号。
3. **`BeastPool.cursor` 不回收带来的槽位泄漏是存档的一部分**。若玩家繁殖 90 只又全部杀掉，`cursor` 仍是 168，存档里 `beasts` 为空——重载后照样从 78 开始分配，结果一致。**泄漏在存档上是一致的，所以不是 bug**；但同一进程内反复"繁殖→杀→繁殖"会在同一个 session 里把池耗光。这条要写进 `spawnAt` 的注释。

---

## 4. AI 行为：三选一，选效用 AI

### 4.1 为什么不是状态机、不是行为树

| 方案 | 46 种 × 8 状态的结构量 | 单只每帧成本 | 表达"同时想干两件事" | 判定 |
|---|---|---|---|---|
| 状态机 | 转移表最坏 46×8×8 = 2,944 条 | O(1) `switch` | ❌ 不能 | 转移表会膨胀到不可维护 |
| 行为树 | 每型一棵树，≈15–30 节点 | O(节点数) ≈ 20 次判断 | ⚠️ 需黑板 | 节点对象带来 GC 压力；46 棵树等于 46 份手写 |
| **效用 AI** | **1 张 8 行打分表 + 46 行权重** | **O(8)** | ✅ 天然（分数可比） | ✅ **选它** |

效用 AI 与本项目现有的 `CreatureSystem` 结构是**同构的**：现在就是"一个 `beasts[]` 数组 + 一个 `for` 循环 + 每只按 `sp.stationary/speed/fly/water` 分支"。效用 AI 只是把这个 `if/else` 链换成"打分 → 取 argmax"，循环结构不变。

### 4.2 数据结构

```ts
export type Act = 'idle' | 'graze' | 'wander' | 'flee' | 'chase' | 'attack' | 'follow' | 'sleep';

interface Ctx {
  t: number;          // 世界时间（s）
  night: boolean;     // 来自 TimeOfDay
  px: number; pz: number; py: number;   // 玩家位置
  hpRatio: number;
}

interface Consideration {
  act: Act;
  /** 基础权重（来自 bestiary 的 cls 与 key） */
  w: number;
  /** 归一化响应曲线：0..1 */
  score: (b: Beast, c: Ctx) => number;
}
```

打分公式（乘法模型，任一项为 0 则整体为 0）：

```
S(act) = w_act × Π_i response_i
response(v, min, max) = clamp((v − min) / (max − min), 0, 1)
```

八条打分（这是全部，不写第 9 条）：

| act | 打分式 | 说明 |
|---|---|---|
| `idle` | `w × (1 − urgency)` | `urgency = max(其余七项)`，保证"没事干就站着" |
| `graze` | `w × (1 − hpRatio) × dayMask × (1 − threat)` | 白天、无威胁、血不满才吃 |
| `wander` | `w × 0.5 × (1 − threat)` | 兜底的低强度活动 |
| `flee` | `w × (1 − hpRatio/flee) × threatMask × (hpRatio < flee)` | 血量低于 `flee` 才可能触发 |
| `chase` | `w × (dist < aggro) × (dist > atkRange) × hostileMask` | 在仇恨圈内但够不着 |
| `attack` | `w × (dist ≤ atkRange) × (cool ≤ 0) × hostileMask` | 够得着且冷却好 |
| `follow` | `w × (dist(pet, owner) > 6)` | 已驯服个体专属 |
| `sleep` | `w × nightMask × (1 − threat)` | 夜行性物种的 `nightMask` 取反 |

`threat`/`hostileMask`/`dayMask` 都是 0/1 或 0..1 的标量，由 `Ctx` 与 `dist` 现算——**不查表、不开对象**。

### 4.3 更新预算

关键决定：**决策 15Hz，运动 60Hz。**

```ts
// CreatureSystem.update(dt)
private decTick = 0;
update(dt: number): void {
  this.t += dt;
  // …既有 runners 与积分不动…
  this.decTick = (this.decTick + 1) & 3;
  for (let i = this.decTick; i < this.beasts.length; i += 4) this.decide(this.beasts[i], dt * 4);
  // …既有 writeBeast 仍每帧跑…
}
```

`for (let i = this.decTick; i < n; i += 4)` 是**分帧轮转**：每帧只处理 1/4 的生物，四帧覆盖全部。这是 `behaviors.ts` 的 `AVOID_CELL` 已经在用的模式（"每 4 帧重建一次"，`behaviors.ts:180`），项目内部有先例。

| 阶段 | 每帧成本（180 只） | 算式 |
|---|---|---|
| 决策（1/4） | **0.054 ms** | 45 只 × 8 action × 0.15µs（纯算术，无分配） |
| 运动积分 | 0.18 ms | 180 × 1µs |
| `writeBeast` | 0.36 ms | 180 × 2µs |
| **合计** | **0.60 ms** | 帧预算 16.7ms 的 3.6% |

**硬预算：`CreatureSystem.update` 单帧 ≤ 1.2ms**（含未来加到的 180 只）。超过就说明出现了 O(n²) 或对象分配，必须回退。

三条防退化的纪律：

1. **打分函数里不许 `new`**。所有中间量用局部 `let`，不建对象、不建数组、不用 `map/filter`。
2. **不许在 `update` 里 `find`**。`this.crowd.actors.find(x => x.id === r.aId)`（`creatures.ts:1159`）是 O(4496) 的线性查找，**每个 runner 每帧一次**——现有 13 个 runner 就是 13 × 4496 = 58,448 次比较/帧。这是**已经存在的性能债**，加生物不该再加，应该顺手改成 `Map<number, Actor>`。估算可省 0.5–1.0ms/帧。
3. **`flee`/`chase` 的目标搜索用 `query(x,z,r)` 的线性扫描，不用空间索引**。180 个对象建网格的构建成本（每帧重建 4m 格）大于收益。

### 4.4 群体行为：群心 + 个体偏移，不做 boids

狼群 3 只、雁阵 6 只、纸人阵列 6 只、鱼群 6 只——四种都是"群体"，而效用 AI 是**个体**决策。如果每只独立打分，6 只雁会朝 6 个方向飞。

三个可选方案：

| 方案 | 成本 | 效果 | 判定 |
|---|---|---|---|
| Boids（分离/对齐/聚合） | 每只每帧查邻居，O(n²) 或空间索引 | 真实鸟群 | ❌ 180 只 × 每帧邻居搜索，直接破 1.2ms 预算 |
| 领头者 + 刚性队形 | O(1)/只 | 队形不散，但转向生硬 | ⚠️ 可用，但雁阵要"人字"，刚性圆形不像 |
| **群心 + 个体偏移** | O(1)/只 | 队形稳定、转向平滑 | ✅ **选它** |

做法：每群一个群心 `(gx, gz)`，个体按角度均分挂在群心周围。

**这套机制其实已经存在了**——`addBeast` 里：

```ts
const ang = (i / Math.max(1, cfg.n)) * Math.PI * 2 + (sp.id.charCodeAt(2) % 7) * 0.4;
this.beasts.push({ … x: cfg.x + Math.cos(ang) * cfg.r, z: cfg.z + Math.sin(ang) * cfg.r … });
```

（`creatures.ts:1145-1148`）以及 `update` 里：

```ts
b.ang += (dt * b.speed) / Math.max(3, b.r);
b.x = b.cx + Math.cos(b.ang) * b.r;
b.z = b.cz + Math.sin(b.ang) * b.r;
```

（`:1184-1187`）——**每个个体都在绕自己的 `(cx,cz)` 转同一个半径 `r`，角度各自独立累加**。结果就是"看起来是群，其实是 6 个独立环"。

改成真群体只需一步：**让同群个体共享 `ang`，只用角度偏移区分**。

```ts
interface Beast {
  group?: { id: number; offset: number; radius: number };  // offset ∈ [0, 2π)
}
// update 里：
const g = b.group;
if (g) {
  const gs = GROUP_STATE.get(g.id)!;      // 每群一条共享状态
  gs.ang += (dt * gs.speed) / Math.max(3, gs.radius);
  b.x = gs.cx + Math.cos(gs.ang + g.offset) * (gs.radius + g.radius * 0.15);
  b.z = gs.cz + Math.sin(gs.ang + g.offset) * (gs.radius + g.radius * 0.15);
  b.yaw = Math.atan2(-Math.sin(gs.ang + g.offset), Math.cos(gs.ang + g.offset));
}
```

成本：每群一条 `GROUP_STATE`（4 个数），个体只多 2 个数与 2 次 `cos/sin`。**比现在的"每只算一次 `b.ang +=`"还便宜一点**（共享群心省掉了每只的累加）。

`offset` 的分布决定队形：

- 均匀 `i/n × 2π` → 圆环（鱼群、纸人）
- `i × 0.45` 递增 → 螺旋（雁阵的人字，靠 `radius` 逐只递减）
- 单一 `offset` + 小 `radius` → 紧簇（狼群）

**效用 AI 与群体行为的接线点**：效用 AI 决定**群心**去哪（`gs.state`），个体只负责摆位。也就是说 8 条打分只跑一次/群，不跑一次/个体——狼群 3 只只花 1 份决策成本，比个体决策还省 2/3。这是效用 AI 与群体结构天然契合的地方，也是选它而非行为树的又一个理由。

---

## 5. NPC 日程：与 `walkSurfaceY`、`jobs.ts` 的衔接

### 5.1 生物与 `walkSurfaceY` 的关系：**不衔接，是替代**

`walkSurfaceY(x, z, fromY)`（`behaviors.ts:137`）返回的是**建筑地坪 / 台基 / 桥面**的高度，语义来自 `WS_RECTS`：室内地面、0.42m 墙带、台基外沿、门槛。它对野外一无所知——在城外任何一点都会返回 `0`。

生物不能调它，三个理由：

1. 城外的生物会被判成"站在 y=0"，而 `terrainSurfaceY` 在七岳是 1550–3800
2. `walkSurfaceY` 返回 `null` 意味着"墙带内不可站立"，生物没有"墙"的概念
3. 它是 4m 空间哈希，为城内 3000+ 栋房子建的；生物在野外用它等于空转

正确做法是新增一个 **host 分发的 `beastGroundY`**：

```ts
// src/sky/creatures.ts
function beastGroundY(b: Beast, x: number, z: number): number {
  switch (b.sp.spawn?.host ?? 'city') {
    case 'sky':   return heavenY(b.baseY);            // 天宫：唯一换算入口
    case 'under': return UNDER.y;                     // 地府：实化平面
    case 'cave':  return caveGroundY(x, z) ?? UNDER.y; // V7 的洞穴解析函数
    default:      return Math.max(walkSurfaceY(x, z, b.y) ?? 0, terrainSurfaceY(x, z));
  }
}
```

注意 `default` 分支用的是 `Math.max`：城内生物站在建筑地坪上（`walkSurfaceY` 返回 0.3–0.86），城外生物站在地形上（`terrainSurfaceY` 返回真实高度），取大者即可，不需要分支判断"是否在城内"。

### 5.2 NPC 日程：不改 `jobs.ts`，加 `schedule.ts`

现状：`jobs.ts` 有 26 个 `JobDef`，每个带 `behaviors: BehaviorEntry[]`（`act/weight/dur/spot`）。时间维度只有一个 `nightOnly?: boolean`（只有 `watchman` 用了）。

缺的是**一天内的分段**。宋代汴京有夜市（`interactPoints.ts` E15 州桥夜市），但 `jobs.ts` 里没有任何"白天卖饼、夜里收摊"的表达。

**不能改 `jobs.ts` 的理由**：26 个 `JobDef` × 每个 4–6 条 `behaviors` ≈ 130 行权重。加时间维度要逐行加 `from/to`，等于重排整张表，且 `JOB_MAP` 是 `Map`，键序无所谓但值全变。

**做法：新增一张班次表，以 `jobKey` 为外键。**

```ts
// src/data/schedule.ts（新增）
export interface Shift { job: string; from: number; to: number; mul: number }
/** 时辰用 0–24 小数；mul 是行为权重乘子，不是人口乘子 */
export const SHIFTS: Shift[] = [
  { job: 'vendor',   from: 6,  to: 19, mul: 1.0 },  // 白天摆摊
  { job: 'vendor',   from: 19, to: 23, mul: 0.6 },  // 夜市半开
  { job: 'vendor',   from: 23, to: 6,  mul: 0.0 },  // 收摊
  { job: 'watchman', from: 22, to: 5,  mul: 1.0 },  // 更夫只在夜里
  { job: 'drinker',  from: 11, to: 24, mul: 1.0 },
  { job: 'farmer',   from: 5,  to: 18, mul: 1.0 },
  // …26 个 job，缺省视为全天 mul=1
];

export function shiftMul(job: string, hour: number): number {
  for (const s of SHIFTS) {
    if (s.job !== job) continue;
    const inRange = s.from < s.to ? (hour >= s.from && hour < s.to) : (hour >= s.from || hour < s.to);
    if (inRange) return s.mul;
  }
  return 1;
}
```

**接线点只有一个**：`behaviors.ts` 的 `BEHAVIOR_LIB`（`:222`）在选行为时，把 `BEHAVIOR_LIB[kind].weight` 乘上 `shiftMul(a.occ, hour)`。

**绝不能做的事：按时段重新 `spawnActor`。** 理由已在 §2.4 说明——`spawnActor` 不可逆，池 slot 只增不减，一天切 4 次，4 天就把 4800 用完。

代价与后果（必须写清）：

- **人口密度不随时段变化**。夜里街上还是 1800 人，只是他们不再吆喝、改为蹲坐/打盹。这是本方案的**已知缺陷**，真正的"夜间人流下降"需要 V6 的昼夜系统给一个 `density` 乘子并在**载入期**就定死人口（不能运行时改）。
- **`nightOnly` 与 `shiftMul` 会重叠**。`watchman` 已有 `nightOnly:true`（`jobs.ts:167`），若它同时命中 `SHIFTS` 的 `mul=1.0`，会被乘两次 → 夜里更多更夫。处理：`nightOnly` 的 job 在 `SHIFTS` 里必须写 `mul: 1`，且**`shiftMul` 只乘一次**，不允许链式相乘。
- **`spot` 的语义不变**。`BehaviorEntry.spot`（`stall/tea/dice/shrine/tow/dock/wine/story/food/letter/fight/stage/social`）由 `SpotRegistry` 解析（`jobs.ts:239`）。改权重不动 spot，所以 `nearest()` 的查询逻辑一行不改。

### 5.3 与 `AVOID_CELL` 的关系

`AVOID_CELL = 4`（`behaviors.ts:185`），每 4 帧重建一次，只统计相机 150m 内的人（`:901-908`）。

生物**不进这张网格**。理由：生物已在 `BeastPool` 里，若同时进 `AVOID` 网格，`crowd.update` 的重建成本会从 O(150m 内人数) 变成 O(人数 + 生物数)，而收益只是"人不撞鹿"。**本卷判断：不值。** 生物与人的碰撞交给 V9 的 `ImpactSystem`（`physics.ts:52`），它已经是按需触发的，不是每帧。

### 5.4 玩家交互层：四个动作，接在 `interact.ts`

生物与玩家的所有交互只有四个动作，全部挂在现有 `InteractSystem`（`src/game/interact.ts`）上，不新开系统。

| 动作 | 触发 | 条件 | 效果 | 接线点 |
|---|---|---|---|---|
| 狩猎 | 按 J（已有战斗键） | `damageable === true` | 走 `physics.ts` 的 `tierOf(force, profileOf(actor))` | `ImpactSystem` 已有，只加 `group==='beast'` 分支 |
| 喂食 | 按 E（已有交互键） | 手持 `loot` 里的任一物品 | `tame.p` 概率驯服；失败则 `aggro` 置 12 | `I.add(pos, r, label, cb)`，与 `POINT` 注册同款 |
| 驱赶 | 按 E | 未驯服的 `neutral` | `state='flee'`，持续 8s | 同上，走 `Consideration` 的 `threat` 输入 |
| 抚摸 | 按 E | 已驯服的 `Rideable` | 恢复 `hp`、重置 `flee` | 同上 |

**关键约束：不要给生物做独立的交互系统。** 项目已有 `InteractSystem.add(Vector3, radius, label, cb)` 的通用注册（`world.ts:1320` 就是用它挂的蟠桃赏赐）。生物只要在 `spawnAt` 时注册一个交互点、在 `despawn` 时注销即可。

代价：每个生物一个交互点 → 180 个点。`InteractSystem` 的判定是"玩家半径内的最近点"，若线性遍历 180 个点，每帧 180 次距离比较 ≈ 3µs。**可接受，但要在 `InteractSystem` 里加一个 32m 的粗筛**（先按 `|x−px| < 32` 过滤），否则未来加到 500 个生物会变成 8µs。

**为什么不做"生物主动交互"**（比如狗跑过来蹭你）：那要求生物每帧反查玩家距离，等于把 180 只都加进 §4 的打分。现在的设计是"玩家发起、生物响应"，成本全在玩家侧，O(1)。

---

## 6. 验收断言（12 条，全部可跑）

统一入口 `node scripts/probe-bestiary.mjs`，与项目既有 probe 同格式：**PASS/BLOCK + 退出码**。

| # | 断言 | 判据 | 期望 |
|---|---|---|---|
| **B1** | 分类表完整 | `BESTIARY.length ≥ 40`，且 `cls` 五类各 ≥ 5 | PASS（46 条） |
| **B2** | 外键全命中 | 每行 `key` 都能在 `SPECIES` 里找到（`巨灵神` 走 `DEITIES` 白名单） | PASS（46/46） |
| **B3** | 无重复 key | `BESTIARY_MAP.size === BESTIARY.length` | PASS |
| **B4** | 池余量正确 | `body.used + 计划新增 ≤ body.max`；超了必须**报错**而不是静默 return | PASS |
| **B5** | 繁殖不越软顶 | 连繁殖 30 次，`beasts.length` 单调增且 ≤ 180；第 181 次返回失败码而非抛错 | PASS |
| **B6** | 驯服不越坐骑池 | 连续驯服 `horse` 5 次，第 4 次起失败并 toast；`MountSystem.rideables.length ≤ 9 + 池余量` | PASS |
| **B7** | `spawnActor` 零新增 | 生物系统运行时前后 `crowd.actors.length` 不变（基线 4496） | PASS |
| **B8** | `update` 预算 | `performance.now()` 包住 `CreatureSystem.update`，180 只时 P95 ≤ 1.2ms | PASS |
| **B9** | 决策 15Hz | 1 秒内 `decide()` 调用总次数 ≈ 180 × 15 ±5% | PASS |
| **B10** | 效用可复现 | 同一 `seed` + 同一 `Ctx` 跑两次，选出的 `Act` 序列逐项相等 | PASS |
| **B11** | 神佛不位移 | `DEITIES` 数组追加前后，既有 35 尊的 `Actor.pos` 逐字节不变 | PASS |
| **B12** | 日程不增人口 | 把 `SHIFTS` 全置为 0 再置为 1，`crowd.actors.length` 不变 | PASS |

负向断言（项目纪律：**故意破坏即报错**）：

| # | 断言 | 做法 | 期望 |
|---|---|---|---|
| **NB1** | 哺乳动物走 `walkSurfaceY` 会被抓 | 强行把 `beastGroundY` 的 `default` 改成只调 `walkSurfaceY`，跑 B 组 | **BLOCK**（城外生物 y 全为 0） |
| **NB2** | 神佛插队会被抓 | 在 `DEITIES` 的 index 10 插入一尊，跑 B11 | **BLOCK**（后续 25 尊位移 0.8m） |
| **NB3** | 生物误入 `crowd` 会被抓 | 把 1 只生物改成 `spawnActor`，跑 B7 | **BLOCK**（4497 ≠ 4496） |

---

## 7. 冲突与代价汇总

| 冲突点 | 现状 | 本卷做法 | 面数 | 内存 | 载入 | 角色数 |
|---|---|---|---|---|---|---|
| 生物不该占人口 | `spawnActor` 抛错，`MAX_HUMANS 4800` | 全部走 `BeastPool` | +18,000 tris（90 只） | <40 KB | 0 | **+0** |
| `Beast` 无生命/目标 | 只有 17 个运动学字段 | 加 4 个字段 | 0 | 3 KB | 0 | 0 |
| `SPECIES` 已有 12 字段 | 42 行台账 | 不改，另开 `bestiary.ts` | 0 | 0 | +0.1ms（46 行 Map） | 0 |
| 神佛 RING 依赖序号 | `2.2 + (i%5)*0.8` | 只许追加到数组末尾 | 0 | 0 | 0 | 0 |
| 坐骑池一次性开死 | `allocMany` 固定 6/4/2/4 | 驯服上限 = 池余量（马3/鹤2/龙0/麒麟2） | 0 | 0 | 0 | 0 |
| `jobs.ts` 无时间维度 | 26 个 `JobDef`，只有 `nightOnly` | 加 `schedule.ts`，只乘权重不增人口 | 0 | 0 | 0 | **+0** |
| `update` 里的 `find` 是 O(4496) | 13 个 runner × 每帧 | 本卷不修，但**记录为性能债**（估 0.5–1.0ms/帧） | 0 | 0 | 0 | 0 |
| `BeastPool` 槽不回收 | `cursor` 只增不减 | 不修（compaction 会重排索引） | 0 | 0 | 0 | 0 |

### 7.1 一条已存在、本卷不修但必须记账的性能债

`CreatureSystem.update` 的最后一行是：

```ts
for (const k in this.pools) this.pools[k].flush();
```

`flush()`（`creatures.ts:142`）里有 `if (!this.dirty) return;` 的短路——看起来是安全的。但 `writeBeast` 每帧对**每一只**都调 `pool.set()`，而 `set()` 无条件 `this.dirty = true`（`:140`）。所以 `dirty` 永远为真，`instanceMatrix.needsUpdate = true` 每帧都设，**整块 buffer 每帧重传一次**。

按池上限算：

| 池 | 实例上限 | 每实例 16×f32 = 64 B | 每帧上传 |
|---|---|---|---|
| `body` / `head` | 168 | 64 B | 10.75 KB × 2 |
| `leg` | 560 | 64 B | 35.8 KB |
| `eye` | 160 | 64 B | 10.2 KB |
| 其余 5 池 | 72–320 | 64 B | ≈ 40 KB |
| 八型 `form` 池 | 6 | 64 B | 0.4 KB × 8 |
| **合计** | | | **≈ 118 KB/帧** |

60fps 下 ≈ **7.1 MB/s** 的纯上传带宽。这不是致命问题（PCIe 带宽以 GB/s 计），但它解释了一件事：**加 90 只生物不会增加这个数字**，因为 `InstancedMesh` 的 buffer 大小在构造时就按 `max` 分配死了。所以 §3.4 的"性能不是瓶颈"结论是成立的，同时也意味着**优化这 118 KB 的收益与生物数量无关**——它是一个固定开销。

正确修法是 Three.js 的 `instanceMatrix.updateRanges`（只上传变化的区间）或按 `count` 而不是 `max` 分配。两者都超出本卷范围，**记录为债，留给 V11（性能与工程）**。

---

**红线核对**：

- 面数：13.35M + 0.018M = **13.37M**，未破 15.09M
- 载入：8.3–9.7s + 0.1ms（bestiary Map）+ 0（生物预建已含在现有 90 只里）≈ **不变**
- 角色数：**4496 → 4496**，一个不加
- 帧预算：`CreatureSystem.update` 0.29ms → 0.60ms，占 16.7ms 的 3.6%

---

## 8. 可派给单个 agent 的原子任务

| 任务 | 产出 | 依赖 | 验收 |
|---|---|---|---|
| T8-1 | `src/data/bestiary.ts`：46 行 + `BESTIARY_MAP` | 无 | B1/B2/B3 |
| T8-2 | `Beast` 加 4 字段；`CreatureSystem` 加 `query/spawnAt/despawn` | T8-1 | 编译通过 + B5 |
| T8-3 | 效用 AI：`Act`/`Ctx`/`Consideration` + 8 条打分 | T8-2 | B9/B10 |
| T8-4 | 分帧轮转接入 `update`（`i += 4`） | T8-3 | B8/B9 |
| T8-5 | `beastGroundY` host 分发（含 `caveGroundY`） | T8-2 + V7 的 `caves.ts` | NB1 |
| T8-6 | 繁殖：三重上限 + 软顶 180 + 失败码 | T8-2 | B4/B5 |
| T8-7 | 驯服：接 `MountSystem`，扩 `allocMany` 参数 | T8-2 | B6 |
| T8-8 | `src/data/schedule.ts` + `BEHAVIOR_LIB` 接线 | 无 | B12 |
| T8-9 | `physics.ts` 的 `profileOf` 加 `group==='beast'` 分支 | T8-1 | V9 前置 |
| T8-10 | `probe-bestiary.mjs`：12 条 + 3 条负向 | 全部 | 全 PASS + NB1–3 BLOCK |

---

## 9. 本卷自认最弱的三处

1. **§3.4 的耗时全是算式，一次没跑。** `0.62ms/180 只` 是按"每只 1µs 积分 + 2µs 写矩阵"推的，但 `writeBeast` 里有 8–14 次 `Matrix4.compose/premultiply`，真实值可能到 3–5µs/只，总量会翻倍到 1.2ms——**正好压在预算线上**。B8 的 P95 ≤1.2ms 很可能第一次跑就红。这条必须实测后重估，不能信我的推算。

2. **§1 的 46 行里，掉落的 12 个价格、以及"山魈/蛟/九尾狐"的神话依据都未经核实。** 《太平广记》的山魈条目、《山海经》的青丘九尾，我按类型学归了类，但**没有能力在本轮确认篇目与原文**。写进 `basis` 字段时全部标了「待核实」，这是一个诚实的欠账，不是完成状态。

3. **§5.2 的 `schedule.ts` 只解决了"行为权重"，没解决"人口密度"。** 夜里汴京街头仍站着 1800 人，只是他们蹲着不动。这与《东京梦华录》里"夜市直至三更尽，才五更又复开张"的真实节奏差得远。真正的解法是在 `crowd.spawnCrowd` 的 `scale` 计算（`crowd.ts:1360`）里乘一个时段系数，但那要求人口在**载入期**就按当前时辰定死——玩家在游戏里过一夜，人口不会变。这个矛盾本卷没有解决，留给 V6（生存循环，昼夜系统）。
