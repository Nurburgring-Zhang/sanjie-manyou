# 原子资产实现状态（由 scripts/annotate-atom-impl.mjs 生成）

- 生成依据（确定性摘要，非墙钟时间，INV-05）：deterministic:e4a0f716d7d5c64bbdd
- 建筑 139：implemented 139，blocked 0
- 物品 838：implemented 838，spec-only 0，data-only 0
- 角色 243：procedural 243
- 植物 32：implemented 28，blocked 0，not-asset 4
- 生物 37：procedural 37

## 待办（按量级排序）
1. 物品网格：0 件仅数据，需按资产卷补逐件模型与材质。
2. 角色独立网格：243 张卡目前共用人群体型池。
3. 植物专属模型：0 类无专属构建函数。
4. 建筑逐座材质：28 座缺材质字段。
