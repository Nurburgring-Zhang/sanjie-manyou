# SPEC · 多 Agent 工作流（第 2 轮 · 2026-10-31 20:0x）

> **防冲突铁律**（不变）：同一目录多人同时 `vite build` / `electron-builder` 会互相破坏 `dist` 与 `release-*`。
> **agent 只做「改代码 + `npx tsc --noEmit` + `npx vitest run`」**；构建、探针、打包、`verify-packaged` 由 **lead 串行**执行。
> agent 禁止改 `src/world.ts`、`artifacts/**`、`scripts/**`；禁止 `release-*`；需要看画面只许 `npx vite dev --port 4199`（4173 归 lead）。

## 第 1 轮（已完成，2046-10-31）

| 流 | 交付 | 结论 |
|---|---|---|
| A · 天宫体量 | `sky/realm.ts`、`sky/palace.ts` | 4.3 ✅ 上檐出檐 0.76→**1.44m**、两檐高差 3.72→**4.50m**、殿身 10.40→**12.00m**（殿高/岛半径 0.226→**0.261**）；4.4 岩层带 3 段（−11.8%/+12.4%） |
| B · 城体水色 | `city/props.ts` | 3.2 ✅ 修瑶池水面 y 0.6→**0.755**、共井改开口筒 + 水面 0.3→0.36；确认城内唯一水体是河床 `0x24455c` |
| C · 威胁闭环 | `game/player.ts`、`game/boss.ts`、`data/levelPlan.ts` | 6.5.8 ✅ `effectiveSpeed/applyDisorient/fadeHint/jitter` + boss `canGrab/lastMove`；`probe-threat2` 全绿 |

lead 集成：`tsc` 0 错、`vitest` 65/65、**`release-v69` `PACKAGED_BOOT=PASS`**（`calls 474`、`frameP95 25`）。

## 第 2 轮（进行中）

| 流 | 问题（人话） | 独占文件 | agent |
|---|---|---|---|
| **D** 水看不见 | 护城河水面 y=−1.1 被地形(−0.5)埋掉；御沟水面 0.115 低于帮岸 0.5 | `city/imperial.ts`、`city/props.ts` | `agent-232` |
| **E** 天宫云/岛 | 云是白球；岩层差仅 12%，远处仍成一块灰 | `sky/expansion.ts`、`sky/palace.ts`、`sky/beautify.ts` | `agent-233` |
| **F** 花与果 | 花簇/桃实是纯色球 | `city/bake.ts`、`sky/realm.ts` | `agent-234` |

## 第 3 轮候选（等第 2 轮收口后排）

| 编号 | 项 | 归属文件 | 备注 |
|---|---|---|---|
| 3.1 | 河流有头有尾（俯瞰验收） | — | 只需出图，不改码 |
| 3.4 | 居民区 17 类商铺覆盖 | `city/infill.ts` | 需先统计覆盖率 |
| 3.6 | 城墙 64 碉堡 / 角楼 / 门楼逐座验收 | `city/armory`/`architecture.ts` | 出三视角 |
| 6.5.4 | 目标链（关卡推进） | `world.ts` + `ui` | lead 独占 world.ts |
| 4.6 | 体积云（E 若未闭环） | `sky/**` | 依赖 E |

## 给 agent 的已知结论（避免重犯）

- **天宫发灰的真因是穹顶**（`world.applySkyDomeTint`），不是雾、不是 `CS_*` 云海材质、不是地平霾环——这三条都已用隐藏对照证伪
- **浮岛三级岩锥已存在**（0.94r→0.58r→0.12r），不要再加厚度
- 查「颜色不对」按 `base → AO → 顶点色 vc → 材质 emissive/map → 光照/阴影 → 贴图 UV` 顺序排；「桥东空地」最终是**河床**
- `Euler('XYZ')` 下 `rx≠0 & ry=π` 会把构件上下翻 → 坡度烘进几何或用 `rz`
- 界域覆盖（雾/自发光/穹顶）必须写在 `applyLighting` **之后**
- `Baker.push` 有越界守卫（span 非有限或 |x|,|z|>30000 拒收）
- 每个地面构件都要打 `b.kit('ground.*')`，否则无法归因（现有：`slabN/slabS/riverBed/pavement/infill/bankSlope/towpath`）

## 基线（每轮收口必须复验）

`tsc` 0 错｜`vitest` 65/65｜`probe-load` 33 步、峰值堆 1.05GB｜`probe-blocking` p95 ≤400ms｜`verify-packaged` `PACKAGED_BOOT=PASS`、`calls ≤600`、`frameP95 ≤30`。
