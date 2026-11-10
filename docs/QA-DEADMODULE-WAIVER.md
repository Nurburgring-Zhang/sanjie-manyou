# 死代码豁免清单（QA-006 R2 / FIX-005 R7）

格式（严格，行首无缩进）：

```
- src/rt/foo.ts (until R30)
```

- `until` 是**到期版本**；当前 release ≥ 到期版本即视为过期，门 rc=1。
- 每一条豁免必须有理由与责任里程碑，写在紧随其后的 `  - 理由：…` 行。
- **M1 阶段本清单为空**：FIX-005（影子运行时处置）属 M3，当前所有零入度模块
  由 `scripts/qa/check-deadmodules.mjs --report-only` 如实列出，打包门标 `DEFERRED`，
  **不通过豁免把红变绿**。到 M3 完成接线/删除后，清单应保持为空且门 rc=0。
