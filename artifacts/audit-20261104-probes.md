# 机检探针取证报告 —— 2026-11-04

- 执行者：运行时取证 agent（ZCode 子代理）
- dev 服务器：http://127.0.0.1:4182/（探针前后 curl 均 HTTP 200）
- 范围：按协调者缩单指令，只跑 5 个核心探针（原 10 探针清单中 P6–P10 取消，未运行）
- 边界：只做探针；未修改 src/、未跑 vitest/build/packaging、无 git 写操作、未改动任何账本文件
- 运行目录：项目根；浏览器由 `scripts/chromePath.mjs` 自动解析（ms-playwright chromium-1243）

## 结果总表

| # | 探针 | 命令（项目根下执行） | 退出码 | 关键数值 | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | probe-water-clash.mjs | `PROBE_URL=http://127.0.0.1:4182/ node scripts/probe-water-clash.mjs` | 1 | actorsOnWater=**0**（上次 11，已修）；buildingsInRiver=**0**（上次 24，已修）；boatCrewProven=29/9 船；桥心高出水面 8.1m，桥面行人 77 人；**bridgeDeckOff=5** | **FAIL** | A 判据（水上有人）=0 过；B 判据（河里建房）=0 过；C 判据（桥面贴合 ±0.9m）5 人偏离：样本 [(-1.1,0,46.2),(-3.9,0,44.4),(3.3,0,46),(-4.6,1.88,12.9),(-3.8,1.88,11.9)]，其中 3 人 y=0（水面高度）位于虹桥带 z≈44–46，2 人 y=1.88 位于 z≈12 |
| 2 | probe-house-overlap.mjs | `URL=http://127.0.0.1:4182/ node scripts/probe-house-overlap.mjs` | 0 | 消解后 OBB 相交对=0（仅 shop-shop 豁免，0）；干涉消解耗时 liveMs=413.2ms / probeMs=199.7ms（阈值 <500ms）；台账 __infillDrop 通过；三张截图非空白（01-top mean=95.7 / 02-street mean=138.2 / 03-tier1 mean=113.5，whitePct 全 0） | **PASS** | headless 全量载入 46.2s 仅记录不判（与用户 8.7s 基线不可比，探针自身标注 required=false） |
| 3 | probe-input-health.mjs | `PREVIEW_URL=http://127.0.0.1:4182/ node scripts/probe-input-health.mjs` | 0 | A1 键重复：20 次 repeat 后 toggleMode 调用=1（期望 1）；A2 单击单触发：合计=1 路由=heroFocus；A2b 附身路由 attack、灵魂路由 pointerLock；A3 60 帧 DOM 写入=0（≤8）；A4 跳跃键按下 dy=1.123m 真离地 | **PASS** | 5 PASS / 0 BLOCK。耗时超 120s（约 3.5min，含 headless 全量载入）但正常完成，按实际结果记录而非 TIMEOUT |
| 4 | probe-grain.mjs | `PREVIEW_URL=http://127.0.0.1:4182/ node scripts/probe-grain.mjs` | 0 | 分块 26 块全 PASS、红块 0；CV 中位数=**0.455**（阈值 ≥0.35）；逐块 CV 0.439–0.845；top2 峰占比 11.9%–17.0%（≤55%）；面阔/进深 IQR 0.484–1.550（≥0.18）；块通过率 100%（≥80%） | **PASS** | PROBE_2_1=PASS。三判据（CV/朝向直方图/宽深比）全部满足，里坊肌理为「有机聚落」非格网 |
| 5 | probe-face-accounting.mjs | `node scripts/probe-face-accounting.mjs --url http://127.0.0.1:4182/` | 0 | **T_static=18,959,342**（assetAudit 14 组逐组合计，最大 wood 5.74M / roof 4.84M）；T_scene=19,873,969（536 Mesh，452 InstancedMesh，1,011,869 实例）；T_frame=45,908,941（379 draw calls） | **PASS** | A1 逐组和===T_static 自洽；A2 逐组非负；A3 T_frame≥T_static。谈预算须带口径（烘焙看 T_static） |

## 汇总

- **PASS 4 / FAIL 1 / 取消 5**。
- 唯一 FAIL：probe-water-clash 判据 C —— 虹桥带内 5 名行人未贴合桥面（3 人 y=0 贴水面、2 人 y=1.88m），A/B 两项历史问题（水上有人 11→0、河里建房 24→0）已确认修复。
- P6 roof-from-air、P7 street-facade、P8 cloudsea、P9 hell-read、P10 ledger-coverage 按缩单指令取消，本次未取证。

## 诚实边界

- 本报告只记录探针实测输出与退出码；探针结论的语义正确性（判据是否合理）不在本次复核范围。
- probe-input-health 超 120s 软限但正常完成，未跳过；其余 4 个探针均在时限内完成。
- P2 的载入绝对值判据探针自标 required=false（headless SwiftShader 与真机不可比），未计入 PASS/FAIL。
