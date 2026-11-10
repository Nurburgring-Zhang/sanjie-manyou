# QA-NUMBERS · 数字单一真相源规约（QA-002 R1）

> 状态：M1 生效。违反本规约 = **P0 缺陷**，打包门（QA-001 S11 / X03）必须阻断。

## 1. 规约（硬性）

README、交付报告、启动横幅、验收结论中出现的**一切运行时数字**——顶点数、构件数、
人群数、帧数、耗时、测试文件数与测试条数、碰撞计数、draw call、内存读数——
**必须**由占位符从 `artifacts/` 台账渲染而来。

- **人肉在文档里写这类数字 = P0 缺陷**；改了台账却忘了重跑生成器同样是 P0。
- 数字段只能由 `node scripts/gen-docs.mjs` 写回；人只维护非数字的叙述文字。
- 生成器 `--check` 把文档重渲染到内存、与盘上逐行 diff；不一致即 rc=1（QA-001 S11）。
- 机检 `node scripts/qa/check-numbers.mjs`（QA-001 X03）扫描裸数字，白名单外
  一律要求能回溯到某个 `artifacts` JSON 字段；不可回溯即 rc=1。

## 2. 占位符语法（示意；此处刻意加空格，避免被当成真实占位符）

```
{{ json : 台账文件名 # 点分路径 }}
{{ json : 台账文件名 # 点分路径 | , }}
```

- 第一段是 `artifacts/` 下的台账文件名；井号后是点分 JSON pointer，支持数组下标。
- 竖线后可选的 `,` 后缀 = 千分位渲染（由 gen-docs 实现，见其文件头说明）。
- 渲染后的规范形态是「可见值 + 注释内占位符」成对出现：占位符**不抹除**，
  这样 `--check` 才有真相源可 diff，也能检出「台账改了文档没跟着改」。

## 3. 自检锚点（可渲染实例，禁止手改数字）

下面一行是 gen-docs 与 check-numbers 的实跑锚点，数字来自包内 R27 碰撞台账：

R27 破坏命中 26,999<!-- {{json:r27-collision-runtime.json#destructionHit.vertsDeformed|,}} --> 顶点变形、89<!-- {{json:r27-collision-runtime.json#solidsAfterHit.broken}} --> 面墙摘除。

## 4. 负例（防门腐烂）

- 把上面锚点的可见数字手改成任意别的值，`node scripts/gen-docs.mjs --check` 必须 rc=1。
- 在纳管文档里插入一个无法回溯的三位数裸数字，
  `node scripts/qa/check-numbers.mjs` 必须 rc=1。

## 5. 测试条数专项（QA-002 R3）

vitest `--reporter=json` 的输出应落盘为测试台账 JSON，README 的「N 文件 / M 条」
由它渲染，禁止手写口径。该台账由主代理随包交付后，对应占位符方可解析；
在此之前 gen-docs 遇到该占位符会按「目标文件缺失」rc=1 并逐条列明，绝不静默。
