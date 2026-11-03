# D5 · 游戏内 Agent：许愿 → 代码 → 沙箱 → 四门 → 热替换

> **卷首复述 D0 的 ADR（不得改口）**
> - **ADR-1** 坐标与单位只有一个真相源：`src/sky/heavenFrame.ts` 的 `heavenY()` / `heavenPoint()`；天宫坐标必须过它。
> - **ADR-2** 几何管线分层：烘焙是基底，运行时只能「追加」；新增几何必须以世界坐标构建、自带包围球、显式注册 LOD、禁止落在 `city_*` 命名空间。
> - **ADR-3** 确定性：生成物必须记录 `seed + promptHash + modelVersion`，可离线重放。
> - **ADR-4** 热更新：打包态没有 HMR，只有「资产热替换」；禁止在渲染进程内 `eval` / `new Function` / 动态 `import()` 未签名模块。
> - **ADR-5（2026-11-03 修订）** Agent **可以写代码**，但代码**必须在游戏进程外执行**，跨界只传 `CreationBundle` 数据。
> - **ADR-6** 双 AI 议会是设计期机制；运行期保留轻量评审，必须设时延与成本上限。
> - **ADR-7** 性能预算前置：任何新增系统先算 `ΔT_static / Δ常驻MB / ΔengineMs`。
> - **ADR-8** 构建标准与交互契约：构建 API 白名单、四道预算门、交互四声明、`CreationBundle` schema、hash 与回滚协议。
>
> **结论先行**：用户那句「我要一条龙」，现在由三段完成——**Agent 写一段只调白名单 API 的 `build.ts`，它在一个没有 fs/net/dom、有 180s 硬超时与记账式内存上限的子进程里跑出几何，游戏进程只接收一份过了四道门的纯数据**。表达力从「九型骨架 + 96 件部件」放开到「任意几何」；风险面从「任意代码」收敛到「一个可杀死的子进程」。
>
> **诚实边界**：本仓库**没有任何模型接入代码**（`grep -rn "openai\|anthropic\|llm" src electron` 为空），所以代码生成档是设计而非实测，所有「模型时延」标 **待验证**。沙箱、内存、哈希、序列化的数字来自本轮本机实测（附录 A），标注口径；ADR-8 白名单里的 `lathe/extrude/tube/isosurface` **在本仓库源码中尚不存在**（`grep -rn "lathe\|extrude\|isosurface" src` 零命中），是待建件，不是既成事实。

---

## 0. 范式改正：上一版错在哪，这一版改了什么

### 0.1 旧范式的死结不是「部件不够」，是「位置错了」

上一版 D5 的地基是旧 ADR-5：「Agent 的输出是数据，不是代码」，于是「我要一条龙」被解释为**从九型骨架里解出一条龙**——`bodyPlan` 选 `long`、8 个槽位填空数组、`girth/legLen` 取 1.0，最后得到的就是 `beastGeo('long')` 那条 952 面的青龙。它快（p50 0.30ms）、省（102,816 B）、可复现，但它回答不了「一条盘在柱子上、身上有鳞、周围有云的龙」——因为九型是**一体成型的固定骨架**，槽位是空的。

用户对此的否决是成立的：**部件库缺失不是理由**。真实约束从来不是「能不能写代码」，而是「写出来的代码在哪里跑、跑完谁验收」。旧版把安全问题和表达力问题绑在一起，用一个换另一个；新版把它们拆开——**表达力交给代码，安全性交给进程边界与四道门**。

### 0.2 三件套：意图、过程、产物

新范式把一次许愿拆成三个**可分别校验**的物件，这是本卷与上一版最大的结构差别：

| 物件 | 是什么 | 谁产出 | 谁消费 | 可否执行 |
|---|---|---|---|---|
| `CreationSpec` | **意图与索引**：`creation.spec.v1`，D4 §3.1 逐字不改 | Agent / 议会 / 编辑器 | 存档、议会、D4 的属性派生 | 否，纯数据 |
| `build.ts` | **过程**：一段只调白名单 API 的模块 | Agent（模型或模板） | 沙箱 | 是，但只在沙箱里 |
| `CreationBundle` | **产物**：几何缓冲 + 四声明 + 预算 + hash | 沙箱 | 游戏进程 | 否，纯数据 |

三者的关系是**单向**的：`spec` 定「要什么」，`build.ts` 定「怎么造」，`bundle` 是「造出来的东西」。`bundle` 里**必带** `spec`，因为存档与议会只认 spec；`spec` 里**不带** `build.ts`，因为代码不进存档——进了存档，下次载入就要执行一遍陌生代码，等于把 ADR-4 的禁令从后门放回来。

这条拆分的直接收益：**同一份 spec 可以由不同 build.ts 实现**。模型写坏了，模板可以顶上；模板表达不了的，模型可以写。二者产出同一个 `bundle` schema，下游一行不用改。

### 0.3 现在能做到的四件事

| # | 能力 | 判据 | 与上一版对比 |
|---|---|---|---|
| 1 | 新拓扑（六条腿的龙、双头鸟、盘龙柱） | `build.ts` 直接产几何，不受九型骨架约束 | 上一版明列「做不到」 |
| 2 | 盘绕 / 鳞片 / 云雾这类连续与无定形形态 | `tube` / `extrude` / `isosurface` 可表达，面数 ≤20,000（§3.6 账单 3,508～9,652） | 上一版无此能力 |
| 3 | 同一句话两次执行，逐字节相同 | 同 seed 双跑比对，四门之四 | 保留 |
| 4 | 失败可解释、可回滚、可撤销 | 六类错误码 + 原子回滚 + 旧对象冻结 | 保留并加严 |

### 0.4 仍然做不到的四件事（新边界，比旧版窄得多但更硬）

| # | 做不到 | 原因 | 归属 |
|---|---|---|---|
| 1 | 新**材质组** | 材质是 14 组合批（`src/city/bake.ts:4` 的 `BGroup`），新增一组就多一个 program、多一次 draw，破合批 | 永久边界，ADR-8 §8.1 |
| 2 | 新**机制** | `behavior` 只有 `static/patrol/follow/fly/swim` 五值；「会自己写诗」不是几何问题 | 永久边界，ADR-8 §8.3 |
| 3 | **联网**取资产或调服务 | 沙箱无 net，ADR-4 亦禁止从网络加载可执行内容 | 永久边界 |
| 4 | 超预算体量（>20,000 面 / >200m / >8MB） | 四道门硬拒；不是「优化一下」，是「换方案」 | ADR-8 §8.2 |

**这张表比上一版短，因为边界从「表达力」挪到了「预算与机制」。** 上一版的「做不到」是能力缺失；这一版四条全是**有意的取舍**，每条都能用一句预算或一条合批理由解释。

### 0.5 四个承诺，一句话各表

「随意输入」= 受控词表 + 一次澄清（表外词走最近邻，不让人重打一遍）；「立即」= 300ms / 3s / 30s～3min 三档，**3–5 分钟只属于代码生成档**（§6）；「资产与设定」= 资产是 `bundle`，设定是 `lore` 字符串表，**设定不改机制**；「直接加载」= `unmount → validate → mount → registerLod → updateCollider`，失败原子回滚（§5）。

---

## 1. 五段管线

### 1.1 总表

| 段 | 名称 | 输入 | 输出 | 预算 / 硬超时 | 主要失败模式 | 降级 |
|---|---|---|---|---|---|---|
| P1 | 意图解析 | 原话 ≤200 字 + 场景上下文 | `IntentFrame` | 200ms / 200ms | 低置信、多义、越界 | 三选一澄清 |
| P2 | `build.ts` 生成 | `IntentFrame` + `CreationSpec` 草稿 | `{ code, spec, moduleHash }` | 150ms（模板）/ 120s（模型） | 语法错、越白名单、导出形状错 | 模板兜底 |
| P3 | 进程外沙箱执行 | `code` + `seed` + `spec` | 未盖章 `CreationBundle` | 60s / **180s** | 超时、崩溃、超内存、输出非 JSON | 杀进程 + 拒收 |
| P4 | 四道预算门 | 未盖章 bundle | 盖章 bundle 或 `E_GATE_*` | 50ms / 50ms | 面数、包围盒、内存、不确定性 | 减面重试一次 → 拒 |
| P5 | 热替换 | 盖章 bundle + 落点 | 场上 `rt_*` 对象 | 300ms / 300ms | hash、落点、帧超 1.1× | 原子回滚 |

**为什么 P3 有两个时间**：60s 是**体验预算**（超过就当作失败并降级，玩家看到的是「这次没成」），180s 是 ADR-5 的**硬超时**（到点 `kill`，防的是失控而不是慢）。两个数不是重复，前者管体验，后者管安全。这条区分在 D6 §3.4 的成本上限里还会再出现一次，因为议会档用的是预算而不是硬超时。

### 1.2 P1 意图解析

**输入**：`{ text, plane, playerPos, focusKind }`。`focusKind` 是「当前看着什么」——看着河说「再来一条」，指的是船不是龙；没有它，指代解析必然错。

**输出**：

```ts
interface IntentFrame {
  verb: 'create' | 'modify' | 'remove' | 'summon';
  entity: string;                        // 词表 id
  topology: 'known' | 'novel';           // known=九型/既有池可覆盖；novel=需要新拓扑
  quantity: number;                      // 1..8
  qualifiers: string[];                  // ['gold','coiled','scaled','clouded']
  relation: { kind: 'near'|'around'|'facing'|'on'; target?: string } | null;
  tier: 'reuse' | 'param' | 'code';      // 直接决定走哪条时延档
  confidence: number;                    // 0..1
  unresolved: string[];                  // 未归一词，原样带回
}
```

与上一版相比只加了一个字段 `tier`，但它决定了后面四段走哪条路：`reuse` 走缓存（P2/P3 全跳），`param` 走模板，`code` 走模型。**档位选择放在 P1 而不是 P3**，因为它决定了要不要付那 64ms 沙箱启动费。

**失败模式与处置**：

- **低置信**（`confidence < 0.55`）：不猜，进澄清。只给三个候选，每个带 96×96 预览与一行代价（「盘龙柱 · 约 3.5k 面 · 20 秒」）。开放问答在这里是灾难：用户会写更长的话，解析更难。
- **多义**：「龙」可以是天龙、龙舟、龙灯、龙纹。消歧顺序**量词 > 场景 > 会话偏好**，不可反——量词是刚打的字，意图最明确；会话偏好只该补空，不该覆盖。
- **越界**：命中三类黑名单词直接 `refuse`，不进后续段。早拒绝省一次 64ms 启动加一次 3,000 面构建。

**降级**：超时（>200ms）时用最近一次成功的 `IntentFrame` 填默认值，把 `confidence` 压到 0.5 以下强制澄清。宁可多问一句，不可猜错一次——猜错的代价是一次 60s 沙箱执行加一次回滚。

### 1.3 P2 `build.ts` 生成：两种实现，一个出口

**输入**：`IntentFrame` + P1 给出的 `CreationSpec` 草稿。**输出**：`{ code, spec, moduleHash }`。

两种实现，产物形状完全一致：

| 实现 | 谁写 | 预算 | 适用 | 特点 |
|---|---|---|---|---|
| 模板实例化 | 确定性代码 | 150ms | `tier='param'` | 从 `src/creation/templates/*.ts` 取骨架，把 `spec` 的数值填进参数表；不调用任何模型 |
| 模型生成 | 云端模型（未接入） | 120s | `tier='code'` | 只给白名单 API 文档 + 一个可运行的示例模块，不给整个仓库 |

**`build.ts` 的强制形状**（沙箱只认这一种）：

```ts
// 只允许一个导出，签名固定；不得 import / require
export function build(api: BuildApi, spec: CreationSpec, rng: () => number): void {
  // 只能调 api.box / api.cyl / api.sphere / api.roofC
  //        api.lathe / api.extrude / api.tube / api.isosurface
  //        api.material(id) / api.at(x,y,z,ry)
  // 最后必须调一次 api.emit()
}
```

**执行前的静态检查（不跑代码，先毙一半）**：

1. **可解析**：`esbuild.transformSync(code, { loader: 'ts' })`，实测 1.6KB 模块 p50 **0.47ms** / p95 0.78ms（n=100；首跑 31.9ms 是冷启）。语法错在这里出局，不进沙箱。
2. **零 `import` / `require`**：正则 `\b(import|require)\s*[\(\{'"]` 命中即拒。不是「沙箱里也没有」，是**根本不该出现在源码里**——出现了说明模型在试探边界。
3. **禁用符号**：`fetch` / `XMLHttpRequest` / `document` / `window` / `globalThis` / `process` / `Date.now` / `Math.random` / `eval` / `new Function` / `constructor`。按标识符边界匹配，不做子串——`Date.now` 与 `Date` 要分开，否则 `new Date(x)` 会被误杀。
4. **API 白名单**：抽取 `api.<name>(` 的全部 `<name>`，必须落在 §3.1 的 10 个方法内；`api.material('xxx')` 的实参必须是 14 组之一。
5. **形状**：恰好一个 `export function build`，参数 3 个，且 `emit` 至少出现一次。

五条全是 O(源码长度)，总耗时 <2ms。**先过这五条再开子进程**：模型最常见的错是「写了个 `import * as THREE`」，这种错在 0.47ms 就该死，不该花 64ms 去死。

**失败模式**：`E_SYNTAX`（不可解析）、`E_FORBIDDEN`（禁用符号/import）、`E_API`（越白名单/未知材质）、`E_SHAPE`（导出形状错）、`E_TOO_LONG`（源码 >32KB，约 400 行；超了说明它在写引擎而不是写模型）。

**降级**：回落到模板实现，并在 UI 标 `degraded: true`。**不许静默**——玩家要知道「这次给你的是标准版，不是按你描述长的那版」。

### 1.4 P3 进程外沙箱执行

**输入**：`{ code, seed, spec, budget }`。**输出**：未盖章的 `CreationBundle`（几何 Buffer + 四声明 + 预算实测值）。

执行协议固定为九步，顺序不可换：

```
1. 父进程写出临时目录 <tmp>/gen_<id>/{runner.mjs, build.mjs, payload.json}
2. spawn(electron.exe, ['--experimental-permission',
                        '--allow-fs-read=<tmp>/gen_<id>',
                        '--max-old-space-size=256',
                        'runner.mjs'], { env: ELECTRON_RUN_AS_NODE=1 })
3. 子进程读 runner.mjs + build.mjs + payload.json（只有这个目录可读）
4. 注入 api 门面：每次 emit 记账 bytes，超 8MB 立即 throw E_MEM
5. 跑两次 build()（同 seed、两个独立模块实例），逐字节比对
6. stdout 只写一行 JSON：{geometry, gates, timings}
7. 父进程 60s 未收齐 ⇒ 视为失败；180s ⇒ SIGKILL
8. 父进程校验 JSON 可解析、字段齐全
9. 删除临时目录（无论成败）
```

**为什么是 `electron.exe` 而不是 `node`**：打包后的机器上不保证有 Node。实测本机 `node -v` 是 25.2.1，但游戏运行时是 Electron 33.4.11 内置的 Node **20.18.3**（`ELECTRON_RUN_AS_NODE=1 electron.exe -e "process.versions"` 实测）。两者的权限旗标名不同：Node 20 是 `--experimental-permission`，Node 22+ 才有 `--permission`。**用 `node` 写死在代码里，在玩家机器上就找不到可执行文件**；用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 才是随包走的那一个。`runner.mjs` 也必须拷进同一个临时目录——权限模型连入口脚本自身都要 `allow-fs-read`，不拷进去它读不到自己。

**失败模式与错误码**：

| 码 | 触发 | 处置 |
|---|---|---|
| `E_TIMEOUT` | 60s 预算到 | 杀进程，提示「这次太久了」，不重试 |
| `E_HARDKILL` | 180s 硬超时 | 杀进程，记审计日志（说明模型写出了不收敛的循环） |
| `E_CRASH` | 子进程非零退出 | 杀进程，读 stderr 前 200 字入日志 |
| `E_MEM` | 门面记账超 8MB | 杀进程，提示「这个做法太占内存」 |
| `E_OUTPUT` | stdout 非 JSON / 字段缺 | 拒收 |
| `E_NONDET` | 两次 build 字节不等 | 拒收（说明用了禁用的随机源） |

**降级**：只降不补。沙箱失败**不产生任何部分产物**——不返回半个几何，不挂半成品。玩家看到的是「这次没成，原来的还在」，而不是一个缺了头的龙。

### 1.5 P4 四道预算门

**输入**：未盖章 bundle。**输出**：盖章 bundle，或一个 `E_GATE_*`。

四道门就是 ADR-8 §8.2 那四道，本卷只补**成本**与**顺序**：

| # | 门 | 阈值 | 检查方式 | 实测成本 |
|---|---|---|---|---|
| G1 | 面数 | 单件 ≤20,000 | `indices.length / 3`，O(1) | <0.01ms |
| G2 | 包围盒 | 最大边 ≤200m；无 NaN/Infinity | 扫一遍 positions，O(n) | 60k float ≈ 0.1ms |
| G3 | 内存 | 顶点+索引 ≤8MB | 四个 Buffer 的 `byteLength` 求和，O(1) | <0.01ms |
| G4 | 确定性 | 同 seed 两次逐字节一致 | 沙箱内已跑两次，此处只比对 sha256 | 0.040ms / 102,816 B |

**顺序不能换，理由是错误码的可读性**：先报「20,000 面超了」比先报「包围盒 300m」有用，因为前者是玩家能理解的「太复杂」，后者是「太大了」——而绝大多数超包围盒的模型同时也超面数，先报面数就少一次来回。G4 放最后，因为它是**审计**而不是**输入校验**：前三道都过了，比对才有意义（与 D4 §3.4 把 `E_HASH_MISMATCH` 放最后是同一条纪律）。

G4 的成本值得单独说：`sha256` 对 102,816 B 实测 p50 **0.040ms** / p95 0.045ms（n=200），比一次 `JSON.parse` 还便宜。**确定性检查几乎是免费的，所以没有理由不做**。

**降级**：G1 不过时，允许**一次**自动减面重试——把 `res`/`seg` 降一档（如 `seg 12→8`），重跑沙箱。这一步要重新花 64ms 启动费，但比让玩家重说一遍便宜。仍不过则拒收，错误码带回实测值（「你要的这条龙 28,400 面，上限 20,000」），**给数字，不给形容词**。

### 1.6 P5 热替换

**输入**：盖章 bundle + 落点。**输出**：场上对象 + 一条 `rt_swap_log`。协议见 §5。

**失败模式**：hash 不符、落点三条规则不过、帧时间 > 基线 1.1×、LOD 注册参数非法、碰撞重建失败。五类全走**原子回滚**：旧对象只是被「冻结」（摘除交互与可见性），**从未 dispose**，所以回滚是恢复而不是重建。

**降级**：保留旧对象 + 一条 toast「这次没换成功，原来的还在」。**不许出现「旧的没了、新的没来」的中间态**——那是玩家最不能原谅的一种失败。

### 1.7 跨段不变式

四条，任何一段都不得违反：

1. **同输入同输出**：`bundleHash` 相同则几何逐字节相同。颜色量化到 8 位、坐标 `toFixed(4)`（与 D4 规则 3 同口径）。
2. **不写静态账**：运行期几何永不进 `assetAudit`，永不叫 `city_*`。`compactStatic` 只合并 `city_*`（`src/world.ts:710` 定义，判据在 `:716` 的 `startsWith('city_')`），`scaleHeavenGeometry` 只变换 `city_*` 与 `sky_cloudSheets`（`src/sky/expansion.ts:300`）——**`rt_` 前缀是绕开这两条载入期管线的唯一办法**，不是命名偏好。
3. **不吞错**：每一段失败都必须有一个错误码，落到日志与 UI。
4. **可回放**：`provenance` 必填 `seed` / `promptHash` / `modelVersion`；模板档记 `modelVersion: "template/1"`，与 D4 §3.1 的 `source: 'editor'` 对齐。

---

## 2. 沙箱的三种实现：隔离强度、启动成本、可观测性

### 2.1 三个候选

ADR-5 给了两个首选形态，本卷补第三个并把它否掉。三个都实测了启动成本，**数字都是本机的，不是行业基准**：

| 方案 | 隔离强度 | 启动成本（实测） | 可观测性 | 内存上限 | 结论 |
|---|---|---|---|---|---|
| **A** Node 子进程 + 权限模型 | 进程边界 + fs 拒 + worker 拒；**net 不拦** | **p50 63.9ms / p95 64.6 / max 71.0**（`electron.exe` + `ELECTRON_RUN_AS_NODE`，n=12） | 好：exit code、stderr、stdout、可 SIGKILL | 记账式（见 §2.5） | **正选** |
| **B** Electron 隔离 BrowserWindow | 渲染进程沙箱 + CSP 可断网；进程崩了难回收 | **未实测**（需完整 Electron 运行态；结构上含 Chromium 渲染进程冷启，必然高于 A，属推断） | 差：无 exit code，只有 `render-process-gone` | 不可精确 | 备选：**只有必须断网时** |
| **C** worker_threads + 受限 façade | **无安全边界**：同进程、同内存、可读目录外文件（实测） | **p50 13.63ms / p95 14.53 / max 16.45**（n=12） | 中：可 terminate，但错误与主线程混在一起 | 无 | 只做**性能隔离**，不做安全隔离 |

### 2.2 A 方案：实测到的三件事

**第一，权限模型真的拦 fs。** 在 `--experimental-permission --allow-fs-read=./.d5probe` 下跑一个读 `./package.json` 的脚本，返回 `BLOCKED:ERR_ACCESS_DENIED`；不给 `--allow-fs-read` 时连入口脚本自身都读不到（报错里带 `\?\D:\...\evil.mjs` 的资源路径）。这不是「设计上应该拦」，是当场可复现。

**第二，权限模型不拦网络。** 同一组旗标下，`import http from 'node:http'`、`import net from 'node:net'` 与全局 `fetch` **全部可用**（实测 `typeof` 三者皆为 `function`）。也就是说，A 方案挡得住「读你的硬盘」，挡不住「往外发一个请求」。

这条必须写在明面上，因为它推翻了「加个旗标就安全了」的直觉。真正的防线要换一个问法：**这个子进程里有什么值得偷？** 答案是「没有」：`payload.json` 只有 `spec` 与 `seed`，不含存档、凭据与用户数据。它能发出去的，只有它自己刚写的那段代码。**隔离强度的上限不由旗标决定，而由进程里有什么决定**；数据最小化比旗标更可靠。要堵死「发信标」，得上 Job Object + 出站规则，未实现（§9）。

**第三，`require` 在 ESM 里根本不存在。** 子进程以 `.mjs` 运行，`require` 未定义（实测 `ReferenceError: require is not defined in ES module scope`）——「模型偷偷 `require('fs')`」在语法层就失败。但它提醒：静态扫描挡的是「顺手写错」，不是「蓄意绕过」。

### 2.3 B 方案：为什么强在断网，弱在回收

BrowserWindow 的 `nodeIntegration:false` + `contextIsolation:true`（`electron/main.cjs:13` 已是这个配置）+ CSP `connect-src 'none'` 能**在渲染层断网**，这是 A 做不到的。代价有三：**杀不干净**（`win.destroy()` 后由 Chromium 回收，父进程拿不到 exit code，分不清「它崩了」还是「我们杀了它」）；**算不准内存**（`performance.memory` 跨进程是估算，还不含 GPU 侧，8MB 的账仍得自己在 façade 里记）；**共享 GPU 进程**（沙箱窗口打爆显存会连累主画面，而 A 里最坏只是子进程被杀）。

所以 B 不是「更安全」，是「用可观测性换断网能力」。只有在「必须联网又不能读盘」这种反向需求下才选它——本项目的需求正好相反。

### 2.4 C 方案：快，但不是边界

worker_threads 启动只有 13.63ms，是 A 的四分之一。但实测两件事把它排除在安全方案之外：

- `--experimental-permission` 单独开启时，`new Worker(...)` 直接 `ERR_ACCESS_DENIED`（要开 worker 必须 `--allow-worker`）；
- 一旦 `--permission --allow-worker --allow-fs-read=./.d5probe`，worker 里读**目录外**的 `package.json` 返回 `READ_OK`。

**worker 不继承权限模型的 fs 限制。** 也就是说，开 worker 就等于把 fs 权限原样交出去。同进程还意味着它能把主线程的内存打爆——OOM 杀的是整个游戏。结论：C 只能当「把 3,000 面构建挪出主线程、避免掉帧」的性能工具，**不能当沙箱**。

### 2.5 内存上限的坑：`--max-old-space-size` 管不住 typed array

实测：`--max-old-space-size=32` 下，一个循环分配 40 块 `Float64Array(1<<20)`（每块 8MB，合计 **320MB**）的脚本 **12ms 就跑完了，没有 OOM**。原因是 typed array 的底层存储在 V8 的**外部内存**里，不占老生代。

这条直接改变设计：**8MB 的内存门不能靠 V8 旗标，必须在 API façade 里记账**。做法是 `emit` 每写一个顶点就 `bytes += 36`（3 属性 × 3 float × 4 B），超 8MB 立刻 `throw new Error('E_MEM')`。记账是确定性的、与运行时无关、可在单测里复现——比任何旗标都可靠。

`--max-old-space-size=256` 仍然要加，但它防的是另一件事：模型写出 `while(true) arr.push({})` 这种**对象**爆炸。两道防线各管一半，缺一不可。

### 2.6 选型结论

**A 为正选，B 为断网备选，C 只做性能隔离。** 三条理由按权重排：

1. A 的启动成本（64ms）在 3s 档里占 2.1%，在 30s～3min 档里可忽略——**它不构成体验瓶颈**；
2. A 的失败语义最干净：有 exit code、能 SIGKILL、能读 stderr，回滚与日志都好写；
3. A 的弱点（不拦网）可以用数据最小化补掉，B 的弱点（回收与可观测性）补不掉。

---

## 3. 构建 API 的可用性论证：龙身盘绕 + 鳞片 + 云雾

### 3.1 白名单的现状：四个已有，四个待建

ADR-8 §8.1 列了 10 个方法。逐个对照源码：

| API | 源码状态 | 证据 |
|---|---|---|
| `box` / `cyl` / `sphere` / `roofC` | **已有** | `src/city/bake.ts:910` / `:1158` / `:1154` / `:1168`，签名与 ADR-8 一致 |
| `material(id)` | **已有**（间接） | 材质组是 `BGroup` 联合类型，14 组，`src/city/bake.ts:4` |
| `at(x,y,z,ry)` | **待建** | 现无作用域栈；`Baker` 只有 `yawAbout` 整体转向（`:751`） |
| `lathe` / `extrude` / `tube` / `isosurface` | **待建** | 全仓 `grep -rn "lathe\|extrude\|isosurface" src` **零命中** |

**这四个待建件是本卷最大的诚实负债**：下面的面数账是「按公式可复算」，不是「跑出来的」。公式本身可验（纸笔能核），实现没有。D8 排期时它们应排在 D5 之前，否则本卷所有面数断言只能空转。

### 3.2 面数公式（可复算，不含实现）

| API | 面数公式 | 推导 |
|---|---|---|
| `box` | 12 | 6 面 × 2（D3 §2.6 已用） |
| `cyl(seg)` | 4·seg − 4 | 侧面 2·seg + 上下盖各 (seg−2) |
| `sphere(seg)` | seg² | 经纬球：seg × seg/2 四边形 × 2 |
| `lathe(P, seg)` | 2·seg·(P−1) | P 个剖面点连成 P−1 圈，每圈 seg 个四边形 |
| `extrude(P)` | 4·P − 4 | 侧面 2P + 两端盖各 (P−2) |
| `tube(M, seg)` | 2·seg·(M−1) | M 个中心点连成 M−1 段管，无端盖 |
| `isosurface(res)` | ≤ 5·res³（理论上界）；**实用 ≈ 2·res²** | Marching Cubes 每格最多 5 三角；表面格约占 res² |

`isosurface` 是**唯一一个「参数不能决定面数」的 API**——同样的 `res`，一个实心球和一个薄壳的面数差一个量级。所以它必须带 `res ≤ 32` 的硬上限，并且面数只能**跑完再数**。这条限制不是缺陷，是提醒：白名单里有一个方法不能用静态分析预算，四道门的 G1 必须在运行时兜底。

### 3.3 龙身盘绕：`tube` 的分段与锥度

`tube(pts, r, seg)` 的 `r` 是定值，而龙的核心辨识特征是**头粗尾细**。ADR-8 不改的前提下，用**八段**逼近锥度：

```ts
// 盘龙柱：沿螺旋线取 64 个中心点，分 8 段，每段一个半径
const spine: [number, number, number][] = [];
for (let i = 0; i < 64; i++) {
  const t = i / 63, a = t * Math.PI * 3.2;          // 3.2 圈
  spine.push([Math.cos(a) * (2.2 - t * 1.1),        // 半径随高度收
              t * 9.0,
              Math.sin(a) * (2.2 - t * 1.1)]);
}
for (let s = 0; s < 8; s++) {
  const seg = spine.slice(s * 8, s * 8 + 9);        // 相邻段重叠 1 点，保证接缝连续
  api.tube(seg, 0.62 - s * 0.055, 10);              // 半径 0.62 → 0.235
}
```

**面数**：8 段 × `2 × 10 × 8` = **1,280**。若用单根定半径 `tube(64, 0.5, 10)`，是 `2 × 10 × 63` = **1,260**——**锥度只贵 20 面（+1.6%）**。这就是为什么「分段」是可接受的 workaround，而不是妥协：代价小到不值得为它改 ADR。

接缝处重叠 1 点是对的：`tube` 每段自成闭管，重叠保证两段的最后一圈与第一圈重合，视觉上没有缝；代价是接缝处有 2 圈重复顶点（约 20 面），已经在 1,280 里算进去了。

### 3.4 鳞片：`extrude` 的密度控制

鳞片不是几何必需品——远看靠顶点色，近看才铺。所以它按 **LOD 分档铺**，这是控制面数最有效的一招：

```ts
// 沿脊线每 1/96 段贴一片：四边鳞 + 0.06m 抬升
for (let i = 0; i < 96; i++) {
  const p = spineAt(i / 96);                        // 中心点 + 切向
  api.at(p.x, p.y, p.z, p.yaw).extrude(
    [[-0.09, 0], [0.09, 0], [0.06, 0.13], [-0.06, 0.13]],  // 闭合四边形
    0.06,                                                   // 挤出厚度
    'metal'
  );
}
```

**面数**：`extrude(4 边)` = `4×4−4` = **12**；96 片 = **1,152**。LOD1 直接不铺（远于 120m 时鳞片小于一个像素），这 1,152 面在远景档归零。

四边而不是六边是刻意的：六边鳞每片多 8 面（`4×6−4=20`），96 片多 768 面，换来的只是「近看更圆」。**预算该先保轮廓，再保表面**——这笔钱花在龙身的段数上更值。

### 3.5 云雾：`isosurface` 是唯一能表达「无定形」的方法

云没有边界，`box`/`lathe` 都表达不了。用标量场 + Marching Cubes：

```ts
// 三个高斯团，中心与半径来自 spec；res=28 时单团约 1,568 面
const puffs = spec.qualifiers.includes('clouded')
  ? [[0.8, 6.2, 0.4, 3.2], [-1.1, 7.4, 0.9, 2.6], [0.2, 8.8, -0.6, 2.1]]
  : [];
for (const [cx, cy, cz, r] of puffs) {
  api.isosurface(
    (x, y, z) => r - Math.hypot(x - cx, y - cy, z - cz)
                 + 0.42 * Math.sin(x * 2.1) * Math.cos(z * 1.7),   // 扰动，避免完美球
    { min: [cx - r - 1, cy - r - 1, cz - r - 1],
      max: [cx + r + 1, cy + r + 1, cz + r + 1] },
    28
  );
}
```

**面数**：`2 × 28²` ≈ 1,568 / 团 × 3 = **4,704**（估算，因为实现未落地）。`res=32` 时单团约 2,048，三团 6,144——**仍在上限内**。

`0.42 * sin * cos` 的扰动不是装饰：完美球体在 MC 下会产生大量共面格，三角形退化成细长条、法线难看；低频扰动让格点分布均匀。

### 3.6 面数账单：一条盘龙 8,212 面，占预算 41%

| 分项 | 调用 | 面数 |
|---|---|---|
| 龙身（8 段带锥度） | `tube` × 8，seg=10 | 1,280 |
| 鳞片（96 片） | `extrude(4)` × 96 | 1,152 |
| 头 | `lathe(8 点, seg=12)` | 168 |
| 颌 | `extrude(4)` | 12 |
| 双眼 | `sphere(8)` × 2 | 128 |
| 双角 | `lathe(6 点, seg=8)` × 2 | 160 |
| 四足 | `tube(6 点, seg=8)` × 4 | 320 |
| 爪（十二只） | `box` × 12 | 144 |
| 鬃（十一缕） | `extrude(4)` × 11 | 132 |
| 尾扇 | `extrude(4)` | 12 |
| **小计（不含云）** | | **3,508** |
| 云雾（三团，res=28） | `isosurface` × 3 | 4,704 |
| **合计** | | **8,212** |

**8,212 / 20,000 = 41.1%**，余量 2.44 倍。余量是留给「再加一对翼」的，不是留给浪费的：一旦某次生成超过 20,000，说明细节铺到了看不见的地方（比如给鳞片加倒角），该砍细节，不该抬上限。

横向对比：它是 `beastGeo('long')`（952 面）的 **8.6 倍**，但预算单位是「件」不是「场」——24 件全打满 = 480,000 面 = T_static 18,959,342 的 **2.53%**，这正是 ADR-8 选 20,000 的理由，本卷复核后仍成立。

### 3.7 三个表达力缺口

1. **`tube` 定半径**：分段解决，代价 +1.6% 面（§3.3）。允许 `r: number | number[]` 可省 20 面，但省不掉接缝逻辑——**收益不足以改 ADR**，列为提案。
2. **`isosurface` 面数不可静态预测**：靠 `res ≤ 32` + 运行时 G1 兜底；它必须最后调用，让超预算尽早暴露。
3. **材质仍只有 14 组**：`metal` + `glow` 能表达「青铜鳞 + 内发光」，表达不了「流动的水银」。这是合批的代价——新增一组 = 全场景多一次 draw，74ms 余量扛不住。

三个缺口的共同点：**都能用现有方法绕过去，代价可算**。绕不过去的（新机制、新材质组、联网）已在 §0.4 划进永久边界。

---

## 4. `CreationBundle` 的生成与校验

### 4.1 schema：ADR-8 逐字，加四个信封字段

ADR-8 §8.4 的 schema 是契约，本卷一字不改；只在其后追加四个字段，并标明「需 ADR-8 追认」：

```jsonc
{
  "schema": "creation/1",
  "id": "gen_20261103_0007",
  "prompt": "我要一条盘在柱子上的龙",
  "seed": 20261103,
  "modelVersion": "…",
  "geometry": { "positions": "<base64|bin>", "normals": "…", "colors": "…", "indices": "…" },
  "materials": ["metal", "glow"],
  "collider": { "kind": "capsule", "params": { "r": 1.2, "h": 6 } },
  "interact": { "verb": "骑", "range": 3 },
  "behavior": { "kind": "fly", "params": { "speed": 6, "altitude": 12 } },
  "lifecycle": { "persist": true },
  "budget": { "tris": 8212, "bytes": 886896 },
  "hash": "sha256:…",

  // ↓ D5 增补四字段（提案，未经 ADR-8 追认前视为可选）
  "spec": { "schema": "creation.spec.v1", "…": "…" },
  "moduleHash": "sha256:…",
  "gates": { "tris": 8212, "bbox": 12.4, "bytes": 886896, "deterministic": true },
  "thumbnail": "<base64 webp 192×192>"
}
```

**为什么必须带 `spec`**：存档只存 `spec`，不存代码也不存几何。下次载入若 `bundleHash` 命中缓存则直接复用；未命中则重跑一次 `build.ts`——所以 `spec` 是「重造的依据」，没有它就没有可重放性。

**为什么必须带 `moduleHash`**：`bundleHash` 证明「这份几何没被改过」，`moduleHash` 证明「生成它的那段代码是哪一版」。二者缺一，回滚时就分不清「是代码坏了还是数据坏了」。

**`thumbnail` 不是奢侈品**：澄清三选一要用 96×96 预览（§1.2），存档列表也要缩略图。沙箱里没有 canvas，所以缩略图必须**在父进程**用离屏渲染生成——这也解释了为什么它不在 `geometry` 里。

### 4.2 三层 hash，各管一件事

```
specHash   = hash(spec)                        // D4 §3.4，128 bit，id = 'crt_' + 前 12 位
moduleHash = sha256(build.ts 源码 UTF-8)        // 全 256 bit
bundleHash = sha256(canonical(meta) ‖ positions ‖ normals ‖ colors ‖ indices)
id         = 'gen_' + bundleHash.slice(0, 12)
```

**`canonical(meta)` 沿用 D4 §3.4 的五条**（键按 UTF-16 码点升序、数字 `toFixed(4)` 去尾零、字符串 NFC、无空白、`hash` 字段不参与）。**不另写一份**——两套 canonical 就是两个 hash，两个 hash 就是两套缓存，最后一定会出现「同一个 spec 在议会里 hash 一样、在存档里不一样」这种查一天的问题。

几何不进 `canonical`，是因为它是二进制：四个 Buffer 按固定顺序**直接拼接**再哈希，顺序写死在 `BUNDLE_FIELDS = ['positions','normals','colors','indices']` 里。顺序一旦可配置，hash 就会随实现漂移。

### 4.3 回滚：把不可逆的那一步放到最后

回滚不是 `try/catch` 一把梭，是**按步骤逆序补偿**；而更省事的做法是**让最后一步不可能失败**：

| 失败点 | 已发生 | 补偿 |
|---|---|---|
| hash / schema | 无 | 无 |
| 落点三规则 | 无 | 无 |
| `mount` 抛错 | 可能已分配 GPU 缓冲 | `remove` + `dispose` |
| `registerLod` | 已推入 groups | **当前无 `unregister`**（见 §8 弱点二）→ 参数预校验，使这一步只剩「push 数组」 |
| `updateCollider` | 哈希格已置脏 | 用旧包围盒重建一次 |
| `commit`（dispose 旧） | 旧对象已释放 | 不可自动回滚；靠 `bundleHash` 重建（几何在缓存里） |

关键在第四行：`LodManager.register()`（`src/core/engine.ts:189`）在第一行就把 `tiers` 塞进 `Set` 并 push 进 `groups`，**没有反向操作**。既然后悔药不存在，就别让自己需要它——把所有可能抛错的东西（`id` 是否 `rt_` 开头、`hx/hy/hz` 是否为正、tiers 是否至少有一个 mesh）在调用**之前**全查一遍，`register` 就退化成一次数组 push。这不是优雅，是承认约束之后的工程选择。

### 4.4 失败话术：六条，统一三段式

三段式是上一版定下的，仍然有效：**承认 → 一句边界 → 一个能点的替代**。六类错误各一条：

| 码 | 话术 | 替代 |
|---|---|---|
| `E_GATE_TRIS` | 「这个做法要 28,400 面，上限是 20,000。」 | 「给你减到 18,900 面的版本，细节会少一档」 |
| `E_GATE_BBOX` | 「它有一边 340 米，场上放不下。」 | 「缩到 1/2 再放，或者换成局部细节」 |
| `E_GATE_MEM` | 「这个做法占内存太多，跑到一半就停了。」 | 「换成面数更省的写法，形状会粗一档」 |
| `E_NONDET` | 「这次生成的结果不稳定，两次跑出来不一样。」 | 「用固定版本重来一次（会丢掉随机变化）」 |
| `E_TIMEOUT` | 「这次算了太久，超过三分钟。」 | 「先给你标准版，回头再试复杂的」 |
| `E_API` | 「它用了一个这个世界没有的造法。」 | 「用现有的八种造法重写一版」 |

六条共同结构：**先给数字，再给边界，最后给一个能点按钮的替代**。没有一句「抱歉」，没有一句「正在努力」。

---

## 5. 热替换时序

### 5.1 五个动作，各自的精确含义

上一版的顺序是「先挂新、再卸旧」。这一版反过来——**旧对象一旦卸掉就没有退路**；为了不出现空窗期，`unmount` 必须定义成「冻结」而不是「销毁」：

| 动作 | 做什么 | 不做什么 |
|---|---|---|
| `unmount(old)` | 从 `InteractSystem.list` 摘除；LOD 组置不可见；`walkSurface` 贡献面标记失效 | **不 `dispose`**，不 `scene.remove`（保留到 commit） |
| `validate(bundle, site)` | 四门复算 + hash 比对 + 落点三规则 | 不修改任何场景状态 |
| `mount(new)` | 离场建好 Mesh 再 `scene.add`；设 `castShadow`、`frustumCulled=false` | 不注册 LOD（此时还不可见） |
| `registerLod(new)` | `lod.register()`；参数已在 validate 阶段查过 | 不改 `mesh.visible`（由管理器独占） |
| `updateCollider(new)` | 建筑：局部重建 `walkSurface`；生物：跳过 | 不给九型兽体建可站立面（它们是巡游单位） |

`commit` 不在五步里，它是五步全过之后的收尾：`scene.remove(old)`、`oldGeo.dispose()`、`releaseGeometry(oldGeo)`（`src/world.ts:86`）、写 `rt_swap_log`。

**`InteractSystem` 只有 `add()`，没有 `remove()`**（`src/game/interact.ts:40`；`list` 是 public 数组）。所以 `unmount` 必须按引用 `splice`，不能按 `label` 找——两个「河灯」的 label 是一样的。这是实现细节，但它决定了 `unmount` 必须持有**添加时返回的引用**，而不能事后重建。

### 5.2 时序与唯一的危险窗口

```
t0  unmount(old)         旧对象冻结：不响应交互、不进 LOD 判定
t1  validate(bundle)     四门 + hash + 落点；失败 → remount(old)，结束
t2  mount(new)           离场建好再 add；此时新对象可见但不可交互
t3  registerLod(new)     推入 groups；groups.length +1
t4  updateCollider(new)  仅建筑；失败 → dispose(new) + remount(old)
t5  commit               remove(old) + dispose + 写日志
```

**危险窗口是 t0–t5**：旧对象已不可交互、新对象还没注册完。窗口必须同步、不能跨帧——跨帧就会出现「一帧里两个龙叠着」或「一帧里一条龙都没有」。上限是 P5 的 300ms 预算，但**它不该接近这个数**：t1 是纯计算（<2ms），t2/t3 是两次对象操作，t4 是唯一可能慢的一步（见 §8 弱点一）。**若 t4 退化成全量重建，窗口会从几毫秒涨到几十毫秒**——所以建筑换装必须排在生物之后，不要混批。

### 5.3 落点：100 米内的三条硬规则

用户说的是「就在这儿」，但「这儿」经常不能站。搜索以指向点为中心，**半径 100m**，三条规则逐条过：

| # | 规则 | 判据 | 不过的后果 |
|---|---|---|---|
| 1 | **不压建筑** | 新对象 AABB 与既有 building/POI 的 AABB 不相交；不覆盖 `walkSurface` 主街格 | 穿模、NPC 堵死 |
| 2 | **不悬空** | `walkSurfaceY(x, z, y)` 返回值落在 `[y−0.95, y+0.95]`（`WS_STEP_UP = 0.95`，`src/actors/behaviors.ts:70`）；返回 `null` 即悬空 | 龙浮在半空、房子没有地基 |
| 3 | **不落水面中央** | 距 `water` 组边界 ≥2m；河道中心 30% 宽度带禁落 | 房子浮在汴河上 |

采样：5 圈（r = 0 / 2 / 4 / 8 / 16m）× 8 方位 = **41 个候选点**，按距离升序逐点试，第一个三条全过的即落点；全不过则扩到 100m 再试一轮，仍无解就拒绝并给话术（「这块地站不住，往前挪几步？」）。

代价：41 × 3 = 123 次查询，`walkSurfaceY` 是一次哈希查表（`behaviors.ts:160`），AABB 相交是整数比较。**量级与一次碰撞查询相同；未单独实测，标推断**。这就是它必须前置的理由：便宜的事不前置，贵的争论就会先发生。

### 5.4 天宫陷阱：268 不是世界坐标

`placement.plane` 定界域（`renjian`/`tiangong`/`difu`），`realm` 定阶位（六道）——**两个字段不联动**，一条天道的龙可以站在人间。`frame: 'skyLocal'` 时，`y = 268` 是**天宫原始口径**，必须过一次换算：

```
heavenY(268) = HEAVEN_BASE_LIFTED + (268 − 196) × 2.2
             = 2131 + 158.4
             = 2289.4
```

（`HEAVEN_SCALE = 2.2` `:11`、`HEAVEN_BASE_Y = 196` `:13`、`HEAVEN_LIFT = 1935` `:17`、`HEAVEN_BASE_LIFTED` `:19`、`heavenY()` `:22`，`src/sky/heavenFrame.ts`）

若跳过这一步直接写 268，对象会落在云海顶面（2131）以下 **1,863 米**处——上一版记的是 1,880m，按常量复算是 1,863m，差 17m 属上一版的口算漂移，本卷以常量为准。这不是第一次：ADR-1 记着神像低 21.8m、演员低 21.8m、POI 水平偏 96–180m、凌霄阈值差 3m，全是同一类错。

所以 P5 的 `validate` 必须有一条界域带断言：`tiangong` 要求 `y > 2150`，`difu` 要求 `y < -200`，`renjian` 要求 `-50 < y < 400`。越带即 `E_REALM_Y`。这条拦的是**配置错误**，不是玩家错误——但它必须存在，因为代码生成的 spec 最常犯的就是这一类。

### 5.5 `rt_` 前缀：绕开两条载入期管线的唯一办法

- `compactStatic` 只合并 `m.name.startsWith('city_')` 的 Mesh（`src/world.ts:710` 定义，判据 `:716`）；
- `scaleHeavenGeometry` 只变换 `city_*` 与 `sky_cloudSheets`（`src/sky/expansion.ts:300`）。

两条都是**载入期跑一次**的管线。运行期新增的几何若叫 `city_*`，下一次重建就会被合并掉（几何消失）或被再缩一次（尺寸错 2.2 倍）。叫 `rt_` 不是命名偏好，是**唯一能同时躲开两者的命名**。

同理，`registerLod` 的 `id` 必须以 `rt_` 开头——`LodManager` 的前置过滤会跳过非 `rt_` 名字，跳过之后 `groups.length` 不变，表现为「龙在场上但永远近景」，这种 bug 肉眼很难发现。

### 5.6 一次换装的日志

```
[rt] swap begin   id=gen_20261103_0007 kind=beast tris=8212 module=sha256:1c9e…
[rt] unmount      old=rt_beast_long_0 interact=-1 lod=hidden
[rt] validate     gates=4/4 spec=7f3a1b2c9d40 site=(12.5,3.2,-4.0) ok
[rt] mount        new=rt_gen_0007 objects=+1 geometries=+1
[rt] lod register id=rt_gen_0007 hx=4.8 hy=2.2 hz=2.6 groups=54→55
[rt] collider     beast: skip (not walkable)
[rt] commit       old disposed=1 bytes freed=102816 ratio=1.006
```

七行对应五个动作加收尾；任何一行缺失，就说明那一步没执行。失败时最后一行变成 `[rt] rollback at=t4 reason=E_WALK_UNREACHABLE`——有 `at=tN`，回滚到哪一步不用猜。

---

## 6. 时延分层：300ms / 3s / 30s～3min

### 6.1 三档，各有各的算法

| 档 | 触发 | 走哪几段 | 预算 | 主要成本 |
|---|---|---|---|---|
| **L1 复用** | 缓存命中（同 `bundleHash`） | P1 → 查表 → P5 | **≤300ms** | P1 解析 200ms 是上限，实际是词表匹配 |
| **L2 参数化** | `tier='param'` | P1 → P2 模板 → P3 沙箱 → P4 → P5 | **≤3s** | 沙箱启动 64ms + 构建（3,508 面量级） |
| **L3 代码生成** | `tier='code'` | 五段全走 | **30s～3min**，最坏 5min | 模型生成（≤120s）+ 沙箱（≤180s） |

L2 的 3s 里，64ms 启动只占 **2.1%**，几何构建按 `beastGeo` 的 p95（0.63ms）推算也在毫秒级——**剩下的 2.9 秒全是给人留的**：输入法候选、IPC 往返、一次澄清、UI 动画。真正需要担心的是 P1 的词表匹配与 P5 的碰撞重建，不是 P3。

### 6.2 「3–5 分钟」只属于代码生成档

这两个数不是拍脑袋，是加出来的：

- **正常窗 30s～3min** = 生成 30s（典型，未实测）到 120s（预算上限）+ 沙箱 60s（体验预算）；
- **最坏 5min** = 生成用满 **120s** + 沙箱撞 **180s** 硬超时，`120 + 180 = 300s`。

所以「3–5 分钟」是**代码生成档的最坏情况**，不是所有许愿的通用时延。UI 必须三档三说：L1「马上」、L2「几秒」、L3「这次要几分钟，要等吗」——用错一种，玩家就会以为系统卡了。

### 6.3 为什么 L1 值得单独设一档

L1 收益最大也最容易被忽略：场上已有 `beast_long` 池（`new BeastPool(..., 6, 'beast_' + sp.form)`，`src/sky/creatures.ts:1138`，`max = 6`），再来一条同色龙 = 往已分配的实例数组写一个矩阵，**内存增量 0 字节、draw call 增量 0**。它还顺带让「反复微调」变便宜：`scale` 走实例矩阵，不走 P2/P3，十次微调省下 640ms 启动与 1MB 几何。所以 P1 必须把限定词分成**影响几何的**（`coiled`、`scaled`、段数）与**不影响几何的**（`scale`、`ry`、位置、乘性染色），后者一律走矩阵。

---

## 7. 验收断言

每条都能落到一个具体探针；未建的标 **[待建]**，由 D8 排期。

| # | 断言 | 探针 | 判据 |
|---|---|---|---|
| 1 | 三个样例 bundle 过 schema，`bundleHash` 稳定 | `probe-bundle-schema.mjs` **[待建]** | 打乱 `meta` 键序 hash 不变；改一位 `seed` 必变 |
| 2 | 盘龙样例 `tris === 3508`（无云）/ `8212`（含云），容差 0 | `probe-creation-dragon2.mjs` **[待建]** | 逐项相等，与 §3.6 账单逐行对账 |
| 3 | 沙箱内 `require` / `fetch` 不可用或调用即失败 | `probe-sandbox-isolation.mjs` **[待建]** | 三个负样本各自非零退出；纯几何正样本通过 |
| 4 | 权限模型拦 fs：读沙箱目录外文件返回 `ERR_ACCESS_DENIED` | `probe-sandbox-fs.mjs` **[待建]** | 目录内成功、目录外失败，两次都断言 |
| 5 | 不收敛的 `build.ts` 在 180s 被杀，且无任何产物 | `probe-sandbox-timeout.mjs` **[待建]** | 注入 `while(true)`；断言退出码、耗时上界、输出目录为空 |
| 6 | 8MB 内存门在记账层拦下，不依赖 V8 旗标 | `probe-sandbox-mem.mjs` **[待建]** | 注入 9MB 输出；断言 `E_MEM` 且进程未 OOM |
| 7 | 同 seed 两次生成逐字节一致；改 seed 必不同 | `probe-creation-determinism.mjs` **[待建]** | 两组 sha256 比对；`Math.random` 注入版必须失败 |
| 8 | 换装前后对象数一致、几何数不增、60 帧 p95 ≤ 基线 1.1× | `probe-hotswap2.mjs` **[待建]** | 对象数差 0；`memory.geometries` 不增；比值 ≤1.1 |
| 9 | 落点三规则：压建筑/悬空/水面三种负样本全拒 | `probe-placement.mjs` **[待建]** | 三个负样本各返回对应码；正样本 41 点内必命中 |
| 10 | 运行期对象名全以 `rt_` 开头，`city_*` 与 `sky_cloudSheets` 计数为 0 | `probe-runtime-assets.mjs` **[待建]** | 名字前缀计数；`groups.length` 增量 ≤1 |

第 3、4 条必须分开：**「访问不到」与「访问被拒」是两回事**——前者是 API 不存在，后者是策略拦截；只测前者会漏掉「策略没开」。

---

## 8. 三处弱点（自报）

**弱点一：`walkSurface` 没有局部重建入口。** `ensureWalkSurface()` 一次性建 4m 空间哈希（`src/actors/behaviors.ts:127`），`walkSurfaceY` 只读（`:160`）；建筑换装要改碰撞，只能整表重建。**上一版在这里写过「~80ms 估算」，本卷删掉这个数**——无实测来源，属编造。正确写法：成本未知，需 `probe-walk-rebuild.mjs` 实测后再写；在此之前，策略是「同批只换一栋、换完立刻测帧」，用行为兜底而不是用数字兜底。

**弱点二：`LodManager` 只能加不能减。** `register()`（`src/core/engine.ts:189`）没有对应的 `unregister`。本卷的修法不是等 API，而是**把不可逆步骤推到最后一个并使其不可能失败**（§4.3）：参数在调用前全部校验，函数体退化成 `Set` 构造加数组 push，唯一可能的失败是 OOM——那时整个进程都已不安全。残留风险：若 `registerLod` 之后 `updateCollider` 失败，`groups` 里会留一个孤儿组；处置是标 `orphan`、下次 `lod.view.reset()` 清掉，**不假装能撤销**。

**弱点三：六道可召上限是推断。** 拆三层说：

- **「有上限」不是推断**：`docs/MC融合方案/V13-六道阶位体系.md:253` 明写「饿鬼 1 / 人 4 / 修罗 8 / 天 3」，畜生与地狱为 0（畜生是「自身即造物」）。
- **「上限按 `interact` 遍历成本定」是推断**：V13 只给数字没给理由，本卷的归因（每帧遍历交互点、每只召唤物至少挂 1 个）**是推断**，不是原文。
- **「运行时已生效」是假的**：`grep -rn "召唤\|summon" src` 只命中 `src/sky/underworld.ts:2028` 一个着色用的 `PATHS` 数组，**代码里没有实现**。

所以议会 C3 不能假定上限已生效，必须当**待建校验**，缺省时按 V13 表兜底。这条最弱，因为它在「文档有」与「代码有」之间划了一道很多人会忽略的缝。

---

## 9. 依赖项与阻塞

| 依赖 | 需要谁 | 阻塞什么 | 没有它时 |
|---|---|---|---|
| `lathe/extrude/tube/isosurface` | D1 / `bake.ts` | §3 全部面数与全部样例 | 只剩 `box/cyl/sphere/roofC`，龙退化成一串圆柱 |
| `at()` 作用域栈 | D1 | 递归组合与局部坐标系 | 坐标要手算世界值，模型必错 |
| 模型接入 | 未排期 | L3 代码生成档 | 只有模板档，`tier='code'` 直接拒 |
| `walkSurface` 局部重建 | D1 / `behaviors.ts` | 建筑换装的碰撞精度 | 全量重建，帧抖动未知（不写数字） |
| `LodManager.unregister` | D1 / `engine.ts` | 步骤 6 失败无法真正撤销 | 标 `orphan`，下次 `reset` 清理 |
| Windows Job Object / 出站规则 | 未排期 | 沙箱的「硬内存 + 断网」 | 只有记账式内存门与静态符号扫描 |
| `provenance.source` 第三值 | D4 | 代码生成档记 `editor` 语义不等价 | 记 `editor` + `modelVersion: "codegen/1"` |

**跨卷纪律**：以上全是别人改的文件，本卷只登记，不承诺。

---

## 附录 A · 本轮实测记录

全部本机跑。Node **v25.2.1**；运行时相关项用 Electron **33.4.11** 内置的 Node **20.18.3**（`ELECTRON_RUN_AS_NODE=1 electron.exe -e "process.versions"`）。

| 项 | 读数 | 口径 |
|---|---|---|
| `beastGeo('long').geo()` | **p50 0.30 / p95 0.63 / max 3.25 ms** | 200 次，vite-node，桩掉 `document.createElement` |
| 一具龙几何 | **102,816 B** / 952 面 / 2,856 顶点 | 三属性非索引，`VGeo.p/n/c` |
| draw call | **372 → 373**（+1，castShadow Mesh） | `renderOnce()` × 60 帧，取中位 |
| `CreationSpec` / `WishSpec` | **354 B / 799 B** | `Buffer.byteLength(JSON.stringify(...))` |
| 子进程启动（Node 25 + `--permission`） | p50 **27.9** / p95 29.9 / max 31.5 ms | n=12，空模块 |
| 子进程启动（Electron 33 + `--experimental-permission`） | p50 **63.9** / p95 64.6 / max 71.0 ms | n=12；**游戏里实际付的是这笔** |
| `worker_threads` 启动 | p50 **13.63** / p95 14.53 / max 16.45 ms | n=12 |
| `sha256` 102,816 B | p50 **0.040** / p95 0.045 / max 0.298 ms | n=200，`node:crypto` |
| `base64` 102,816 B | p50 **0.035** / p95 0.127 ms；长度 **137,088**（+33.3%） | n=200 |
| esbuild `transformSync` 1.6KB TS | p50 **0.47** / p95 0.78 ms（首跑 31.9ms 冷启） | n=100 |
| `--max-old-space-size=32` 下的 typed array | 40 × 8MB = **320MB 分配成功** | 外部内存不受老生代限制 |
| 权限模型下的 fs | 目录外读 **`ERR_ACCESS_DENIED`** | `--experimental-permission --allow-fs-read=<dir>` |
| 权限模型下的 net | `http.request` / `net.connect` / `fetch` **全部可用** | 同组旗标，`typeof` 皆 `function` |
| worker + 权限模型 | `--allow-worker` 后读目录外文件 **`READ_OK`** | worker 不继承 fs 限制 |

九型面数沿用上一版实测，未重测：龙 952/720、麒麟 904/660、凤凰 730/598、鲲 252/152、夜叉 536/440、罗刹 708/588、白泽 820/580、仙鹤 670/578、虎 752/536（LOD0/LOD1）。
