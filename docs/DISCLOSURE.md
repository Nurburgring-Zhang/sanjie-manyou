# DISCLOSURE · 联网/真机声称四态披露规约（QA-004 R3）

> 状态：M1 生效。目的是杜绝「把 mock 说成 real」「把跳过算成通过」。
> 机检：`node scripts/qa/check-disclosure.mjs`；负例自检：同脚本 `--self-test`（必须 rc=1）。

## 1. 四态定义（唯一取值集合 `{ real, mocked, offline, degraded }`）

| mode | 含义 | 允许的最强声称 | 必备字段 |
| --- | --- | --- | --- |
| `real` | 真的向**外部**服务发起请求并取得真实应答；或真机/真实浏览器实跑 | 「真实联网」「真机通过」 | `evidence` 指向包内真实文件（log / json），路径必须在包内可查 |
| `mocked` | 管线真实（fetch 真发、CSP 放行、解析真通），但外部应答由本地拦截/桩伪造 | 「检索管线验证（拦截 mock）」 | `note` 说明伪造点；**不得**声称外网可达 |
| `offline` | 功能默认关闭 / 未发起任何网络请求 / 无浏览器可跑 | 「离线降级，未联网」 | `note` 说明降级原因，如实标注 |
| `degraded` | 有凭证但网络失败、超时、CORS 被拦、环境缺依赖 | 「DEGRADED-无凭证/无外网」 | `gate` 取 `SKIPPED`，**不计入** `PASS.all` |

**铁律**：`SKIPPED` / `DEGRADED` 与 `PASS` 分账，绝不把跳过算成绿（FIX-003 R2 / QA-004）。
`mode` 与 `gate` 是两个维度：`SKIPPED` 是 gate，`degraded` 是 mode，二者可同时出现。

## 2. 机检规则（QA-004 R1 / R2）

- 凡字段名含 `real` / `online` / `live` / `真实` / `联网` / `真机` 的**声称字段**，
  必须在其**同级对象**存在 `mode` 且取值属上述四态；缺失即 rc=1。
- 判定按「词」而非「子串」：`realm` / `alive` / `midAlive` 这类词不算声称字段，
  避免把历史证据里的领域词、计数器误判成联网声明。中文 `真实|联网|真机` 按子串判定。
- `mode:real` 的项必须带 `evidence`，且该路径在包内真实存在；否则 rc=1。
- 扫描范围是 artifacts 目录下 JSON 台账的**合理子集**与交付向文档；QA-004 制度生效前的
  历史 R 系列真机证据、以及本规约自身（它定义术语、收录反面判例，不构成运行期声称）
  不参与声称字段扫描，理由在 `check-disclosure.mjs` 顶部常量逐条登记。

## 3. R28「真实联网检索」= 反面判例（存档，不得复现）

R28 验收脚本曾把某门命名为「真实联网检索」（旧声称键，本规约不再复写其字面量），
README 表格写「真实联网检索 bridge=online」。审计实测该门的事实是：

- 脚本开启了 `page.setRequestInterception(true)`；
- 对 `api.search.brave.com` 的请求用 `req.respond` **本地伪造**了 Brave 风格应答；
- 配置里的 `apiKey` 为测试占位值 `r28-acceptance-test`，并非真实凭证。

它**证明**了：fetch 真的发出、CSP 真的放行、结果解析真的通、字段真的进设计。
它**不证明**：外网可达、真实搜索服务返回过数据、真机联网成功。
把 mock 应答包装成「真实联网检索」= 声称与事实不符（FIX-003）。

**整改（FIX-003 / 本规约落地）**：

- 门更名为「检索管线验证（拦截 mock）」；输出键改为 `researchPipeline`，
  值带 `mode: mocked` 与如实 `note`，全仓清除旧字面量。
- 新增 `--real` 真实外网通道：禁用拦截、要求 `RESEARCH_PROVIDER` + `RESEARCH_API_KEY`；
  无凭证/网络失败输出 `mode: real` + `gate: SKIPPED` + `DEGRADED-无凭证/无外网`，
  rc 仍为 0，但不计入 `PASS.all`。
- 运行期检索桥（`src/game/wishResearch.ts`）每次返回结果对象带 `mode` 字段；
  默认关闭如实为 `offline`，真实请求成功/失败为 `real`，`mocked` 仅允许测试注入时出现。

反面判例的原始字段（注意**没有** `mode`，正是被机检拦下的形态；此处用中文代称，
不重写旧声称键字面量，以遵守 FIX-003 ① 全仓零残留）：

```
旧真实联网声称键: true        ← 缺失同级 mode，QA-004 负例必须判 rc=1
```
