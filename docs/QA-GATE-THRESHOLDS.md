# 验收门槛宣称值登记表（QA-003 R1）

本表是**门槛常量的唯一宣称口径**。`scripts/qa/check-gates.mjs` 会扫描
`scripts/**/*acceptance*.mjs`、`*probe*.mjs`、`r*.mjs` 中的同名 `const NAME = <数值>`，
与本表不一致即 rc=1。改门槛必须先改本表，再改代码，禁止反过来。

格式：`- NAME = 数值`（行首，无缩进）。

- GATE_MAX_ERRORS = 0
- GATE_MIN_PASS = 1
- DEBRIS_MIN_STEPS = 600
- DEBRIS_MIN_DISTINCT_SAMPLES = 75
- DEBRIS_TAIL_N = 10
- DEBRIS_TAIL_MAX_DELTA = 0.01
- SETTLE_FAILED_MUST_BE = 0

## 说明

- R29 M2 新增：`DEBRIS_*` / `SETTLE_FAILED_MUST_BE` 的唯一代码定义在
  `scripts/lib/r27Gates.mjs`，FIX-006 R2 把 `debrisFell` 从「≥3 样本 / ≥2 个 y 值」
  收紧到 600 固定步 / 75 个不同 y 样本 / 末 10 样本相邻 |Δy| < 0.01。
  跑不满 600 步时输出 `DEGRADED-性能` 并 skip，**不计入 PASS.all**，不得降低门槛。
- `trisUnchanged` 的基线不是逐帧 `__perf().tris`（随相机/剔除变化），而是
  `BakerStats.groups[*].triangles` 求和，随包基线在 `artifacts/r27-tris-baseline.json`，
  由 `node scripts/r27_acceptance.mjs --init-baseline` 真机重采。基线缺失或漂移
  一律 `FAIL(no-tris-baseline)`（FIX-006 R1，杜绝旧门 `totalTris === null → 真空通过`）。
- `capNotHit` 的豁免额度必须与真机实测精确相等，且豁免单须字段完整、未过期；
  见 `artifacts/solids-budget.json`，PERF-003 清零后删除（FIX-004 R4）。
- `--self-test` 退出码统一：`SELF_TEST=PASS` + rc∈{0,2} 均为门有效；
  rc=1 / TIMEOUT / 无 PASS 字样一律记为 selfTestFail（QA-003 R2 / FIX-006 R4 / QA-005）。

- 未在本表登记的常量不受本门约束。
- 门槛值有变更时，必须在 `SPEC-三界漫游-R29-MASTER.md` 的变更记录里登记（0.6 变更控制）。
- `SKIPPED` 与 `PASS` 分账：任何门取不到观测值一律 `SKIPPED`，**不许计入 PASS.all**（FIX-003 R2 / QA-004）。
