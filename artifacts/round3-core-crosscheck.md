# 第 3 轮 · 批次 B 修复清单只读交叉复核（`round3-core-crosscheck.md`）

> 角色：core-expert，被审方 / 只读交叉复核。
> 输入：`artifacts/round1-core-ab.md` §三「给 team-lead 的三点提醒」+ team-lead 本次派发的 8 项逐条清单 + 1 个风险点。
> 纪律：**未修改任何 `src` 源码、未写 `artifacts/` 之外的文件、未跑构建 / `tsc` / `npm test`**。全部结论来自当前工作树源码静态阅读 + `git diff` 对照，**未运行任何测试**（`save.test.ts` 的断言只做静态推演）。
> 复核时间：`2026-11-07`；`git diff --stat` 显示 17 个 `src` 文件有改动（`world.ts +181`、`interact.ts +110`、`save.ts +15` 等），以下 `file:line` 一律为**当前工作树**行号。
> 四类口径：**已修 / 部分修 / 未修 / 修法与建议不同**。

---

## 〇、结论总览

| # | 项目 | 结论 | 当前关键 `file:line` |
|---|---|---|---|
| 1 | C01 karma 写读双侧 | **已修** | `world.ts:348`、`interact.ts:126` |
| 2 | C01 entities 写读 + 重演触发 + 空转 task 删除 | **已修** | `interact.ts:123`、`world.ts:354-363`、`main.ts:70,74`、`world.ts:669-672` |
| 3 | 读档刷 Boss 奖励（一次性闸门 + `bossDefeated` 入档 + 读档恢复） | **已修** | `world.ts:828-829,849-854`、`save.ts:54-55`、`interact.ts:127` |
| 4 | C14 吸态（写档时序 + `fainted` 预置） | **已修** | `world.ts:915,919`、`survival.ts:105` |
| 5 | C02 两处 `.catch` | **已修** | `interact.ts:128`、`world.ts:814` |
| 6 | C07 `migrate()` v2 字段校验（合法档原样返回） | **已修** | `save.ts:69-80`、`tests/save.test.ts:48` |
| 7 | C11 `SaveManager.close()` + `__qingming` 提前注入 | **已修** | `world.ts:371`、`main.ts:41` |
| 8 | B-06 `save()` 同步写 `cq_yinde` / `cq_peach` | **已修** | `interact.ts:98-100` |
| 风险 | `allocate` ↔ `rebuildAll` ↔ `provenance` 链路 | **【部分修】**（主链闭合、无 id 冲突 / 无空 provenance；残留 3 处静态隐患） | `world.ts:358-362`、`creation.ts:154-173`、`main.ts:70` |

**8 项逐条清单：全部【已修】，无【未修】、无【修法与建议不同】。** 风险点主链也对得上，但另发现 3 处当前不会触发、结构上有隐患的点，逐条给行号与建议，见 §二。

---

## 一、逐条差异清单（8 项）

### 1. C01 karma ——【已修】

- **读档侧**：`world.ts:348` `if (typeof saved.karma === 'number') this.karma.deserialize({ karma: saved.karma });` —— 正是我 §三.3 与红队 `§五:253` 要求的 `world.ts:328-330 补 karma.deserialize(saved.karma)`。读档块 `world.ts:337-372` 内，`saved` 来自 `loadOrMigrateLegacy()`。
- **写入侧**：`interact.ts:126` `karma: sv.karma ? sv.karma.current().karma : 0,` —— 一直有写（原 C01 缺陷本就是「写了不读」），保持。`interact.ts:110` 的桥类型 `karma?: { current(): { karma: number } }` 与 `karma.ts:54-56` `current(): {karma:number; tier:string}` 匹配。
- **反序列化**：`karma.ts:59-61` `deserialize(s: {karma?: number})` 存在且现在有唯一调用点；`save.ts:53` `karma?: number` 与 `world.ts:348` 的 `typeof === 'number'` 守卫、`save.ts:77` 的 `Number.isFinite` 校验一致。
- 结论：写读闭环成立，**已修**。

### 2. C01 entities ——【已修】

四个子项逐一：

| 子项 | 当前位置 | 状态 |
|---|---|---|
| `interact.ts save()` 改调 `collectPersistedEntities()` | `interact.ts:5` import、`interact.ts:123` `entities: collectPersistedEntities(),` | 已改；`save.ts:98-107` 遍历 `forEach` 输出 `eid/kind/x/y/z/provenance` |
| `world.ts` 读档把 persist 实体恢复进实体表 | `world.ts:354-363`（`pendingEntities` → 循环 `allocate('creation', {pos, persist:true, provenance})`） | 已恢复；`:357` 有 `Number.isFinite(x/y/z)` 守卫，`:356` 只放行 `kind==='creation'` |
| `main.ts` 装配完成后显式触发 `onRebuildCreations()` | `main.ts:70` 赋值、`main.ts:74` 调用（在 `await world.init()` 之后） | 已触发；全仓 `onRebuildCreations` 只此一处调用点 |
| `world.ts` 内空转「造物重演」task 已删 | `world.ts:669-672` 只剩删除说明注释；任务表 `:664 ['营造司·体素台']` 直接接 `:673 ['幽冥·奈何桥']`，中间无重演 task | 已删 |

- 类型链：`world.ts:32` 导入 `type SaveData`、`world.ts:33` 导入 `allocate`；`world.ts:263` `private pendingEntities: SaveData['entities'] = []` 与 `save.ts:47` 的 `entities` 形态一致。
- 结论：**已修**。与 play §4.2「造物刷新即消失」的根治口径一致。

### 3. C01 / play §4.2 读档刷 Boss 奖励 ——【已修】

- **一次性闸门包住整段奖励**：`world.ts:828-829` `if (this.bossRewardPaid) return; this.bossRewardPaid = true;` 位于 `onDefeat` 回调最顶部，其后 `:830-843` 全段（`codexLog.push` → `bus.emit('codex:unlock')` → `addPeach(2)` → `earn(300)` → `playerWeapon=4.0` → `survival.bossReward()`）都在闸门内。字段声明 `world.ts:267 private bossRewardPaid = false;`。这正是红队 `§五:253` 要求的「`world.ts:786` if 作用域扩大到 `:792-798` 奖励段」，且比扩大 if 更稳（独立布尔闸门，不依赖 codexLog 是否入档）。
- **`SaveDataV2` 新增 `bossDefeated?: boolean`**：`save.ts:54-55`，可选字段、旧档缺省 false，向后兼容。
- **写入侧**：`interact.ts:127` `bossDefeated: !!sv.boss?.defeated,`。
- **读档侧恢复**：`world.ts:364` `this.pendingBossDefeated = saved.bossDefeated === true;`；`world.ts:365-367` 顺手补齐 `codexLog` 图鉴条目；`world.ts:849-854` 在 `new ArenaBoss`（`:818`）**之后**置 `this.boss.defeated = true; this.boss.hp = 0; this.bossRewardPaid = true; this.pendingBossDefeated = false;` —— 战绩与闸门同时占住。
- **守卫有效性**：`boss.ts:110` `playerAttack()` 开头 `if (this.defeated || this.state === 'dead' || this.state === 'respawning') return false;`、`boss.ts:159` `update()` 开头 `if (this.defeated) { ... return; }` —— 仅 `defeated=true` 即足以挡住再攻击，无需额外改 `state`。
- **时序无回写覆盖**：`this.interact` 在 `world.ts:878` 才创建（晚于 `:818` 的 Boss 与 `:849-854` 的战绩恢复），故 `:902` 启动期 `this.interact.save()` 写出的 `bossDefeated` 为 `true`，不会把读到的战绩冲掉。`InteractSystem` 构造函数（`interact.ts:53-65`）不调 `save()`。
- 结论：**已修**。

### 4. C14 吸态 ——【已修】（我 §三 提醒 1 已闭环）

- **写档时序**：`world.ts:906-920` `onFaint` 回调内，`:910` `if (penalty > 0) I.coins -= penalty;`（只扣钱、**不**落档）→ `:914` `respawnPlayerAt('mengpo')` → `:915` `this.survival.revive();` → `:919` `I.save();`。即 `I.save()` 已移到 `revive()` **之后**，档里写的是 `hp = HP_MAX*0.6 = 60`（`survival.ts:57`），不再是 `hp:0`。根因（写档时序）已除。
- **`deserialize` 不再预置 `fainted`**：`survival.ts:96-105`，末行 `:105` `this.fainted = false;`（旧版是 `this.fainted = this.hp <= 0`）。
- 两条并列修法（红队 C14「修法需修正」要求）**都已落地**。`survival.ts:104` 注释「写档时序这一根因已在 world.ts 修复」现在与代码相符（我在 `round1-core-ab.md §三` 提醒 1 曾指出该注释当时与代码不符，现已闭环）。
- 结论：**已修**。

### 5. C02 两处 `.catch` ——【已修】

- `interact.ts:120-128`：`void W.__saveSave({...}).catch((err: unknown) => { console.warn('[存档] 写档失败', err); });`（`:128`）。`__saveSave` 桥类型在 `interact.ts:106` 标为 `(d: unknown) => Promise<unknown>`，`.catch` 合法，Promise rejection 不再变成 unhandled rejection。
- `world.ts:812-814`：`void saveMgr.open().then(() => { ... }).catch((err: unknown) => { console.warn('[存档] IndexedDB 打开失败，本次会话仅写 localStorage', err); });`（`:814`）。open 失败不再导致 `__saveSave` 永不注入且全静默。
- 结论：**已修**（两处 `.catch` 均补）。
- **残留观察（非本项要求，登记不降级）**：两处 `.catch` 都只 `console.warn`，我原 C02 最小修法里的 `bus.emit('ui:toast', '存档失败')` / 加载页降级提示未落地，玩家视角仍是「无可见提示」。如需彻底闭环可补 toast，但不影响本项「补 .catch」判定。

### 6. C07 `migrate()` v2 字段校验 ——【已修】

`save.ts:69-80`：

```ts
if (d.schemaVersion === 2) {
  const e = d.economy;
  if (!e || !Number.isFinite(e.coins) || !Number.isFinite(e.yinde) || !Number.isFinite(e.peach)) return null;  // :75
  if (d.survival && !Number.isFinite(d.survival.hp)) return null;                                             // :76
  if (typeof d.karma === 'number' && !Number.isFinite(d.karma)) return null;                                  // :77
  if (d.voxel && !Array.isArray(d.voxel)) return null;                                                        // :78
  return Array.isArray(d.entities) ? d : { ...d, entities: [] };                                             // :79
}
```

- 非法档返回 `null` → `save.ts:182-186` `load()` 中 `if (migrated) return migrated;` 不成立，循环 `continue` 回退下一槽，正是我 C07 最小修法「失败返回 `null` 让 `load()` 回退下一槽」。
- **合法档原样返回**：`:79` 在 `entities` 为数组时直接 `return d`（不做任何字段增删），故 `tests/save.test.ts:48` `expect(migrate(v2())).toEqual(v2())` 静态推演成立 —— `v2()` 夹具（`save.test.ts:10-16`）为 `{schemaVersion:2, savedAt:1730700000000, economy:{coins:120,yinde:4,peach:2}, entities:[]}`：`:75` 三币全 finite、`:76-78` `survival/karma/voxel` 均 undefined 跳过、`:79` `entities` 是数组 → 返回同一对象引用，`toEqual` 通过。`save.test.ts:49` `migrate({schemaVersion:99}) → null` 也由 `save.ts:81` 保证。
- `world.ts:368` 仍直接读 `saved.economy.coins`，但已被 `:75` 前置校验保护。
- 结论：**已修**（且未破坏既有 137 断言中的这条）。**未运行测试，仅静态推演。**

### 7. C11 `SaveManager.close()` + `__qingming` 提前注入 ——【已修】

- `world.ts:371` `mgr.close();`（注释 `// C11：读档用的 SaveManager 原先只 void mgr 从不 close`），`save.ts:204` `close(): void { this.db?.close(); this.db = null; }` 存在。读档用实例与 `world.ts:809` 写档用实例分离，关闭读档实例不影响写档实例。
- `main.ts:41` `(window...)['__qingming'] = { engine, world, THREE, scene: engine.scene };` 在 `main.ts:42` `initUI()` **之前**、也在 `main.ts:44` `await world.init()` 之前。`world.survival`（`world.ts:317`）与 `world.voxelStore`（`world.ts:323`）都是类字段初始化器，构造即存在 → `interact.ts:115` 的 `if (W.__saveSave && sv?.survival && sv.voxelStore)` 中 `sv` 不再 undefined，启动期那次 IDB 写的「100% 确定跳过」已消除（`main.ts:36-40` 注释说明的正是这个时序）。
- 结论：**已修**（两项均落地）。
- **残留观察（与红队 C11「维持疑似」一致，不升级、不新增缺陷）**：`world.ts:812` 的 `void saveMgr.open().then(...)` 仍是 fire-and-forget，`__saveSave` 的注入没有屏障；`world.ts:902` 启动期 `this.interact.save()` 与 `world.ts:1025-1032` 的任务循环（每 task 前 `await raf()`）给了 open() 至少一帧时间，但无显式 `await`，理论上 open() 慢于该帧时启动期这一次写仍会被 `:115` 的 `W.__saveSave` 守卫跳过。这是红队 `§2.5 C11` 保留的「首次写档竞态」，本轮未测、维持疑似。另 `mgr.close()` 在 `try` 内而非 `finally`（`world.ts:337-372`），若 `loadOrMigrateLegacy` 抛错则不执行 close —— 轻微，登记不降级。

### 8. B-06 `save()` 同步写三键 ——【已修】

`interact.ts:95-100`：`:98` `cq_coins`、`:99` `cq_yinde`、`:100` `cq_peach` 三键同步 `localStorage.setItem`。与 `interact.ts:58-60` 构造函数读取、`save.ts:85-90` `legacyFromLocalStorage()` 读取、`save.ts:213-215` `hasAny` 判定三键完全对齐。结论：**已修**。

---

## 二、风险点专项：`world.ts` 读档 `allocate` ↔ `creation.rebuildAll()` ↔ `provenance` 链路

> team-lead 特别要求确认：实体表 `allocate` 的 id 单调递增语义与 `creation.ts` 的 `meshes.set(eid, mesh)` / `provenance` 反序列化链路能否对上，有无「重演拿到空 provenance」或「id 冲突」的静态隐患。

**总结论：主链闭合、对得上；无「id 冲突」、无「重演拿到空 provenance」。但发现 3 处当前不会触发、结构上有隐患的点（A/B/C），逐条给行号与建议，未动手改。**

### 2.1 主链逐段核对（写 → 迁移 → 读档 → 重演）

| 段 | 当前 `file:line` | 核对结果 |
|---|---|---|
| ① 写入 | `save.ts:98-107 collectPersistedEntities()` → `:103` `out.push({ eid: rec.id, kind: rec.kind, x,y,z, provenance: rec.provenance })` | **provenance 确实入档**（`save.ts:47` `entities[].provenance?: unknown` 有类型槽）。`interact.ts:123` 调用它 |
| ② 迁移不剥离 | `save.ts:79` `return Array.isArray(d.entities) ? d : {...d, entities: []}` | 合法档**原样返回 `d`**，不删/不改 `provenance`；`entities` 非数组时才补空数组 |
| ③ 读档守卫 + 恢复 | `world.ts:354` `pendingEntities = saved.entities`；`:355-357` `if (e.kind !== 'creation') continue;` + `Number.isFinite(x/y/z)`；`:358-362` `allocate('creation', { pos, persist:true, provenance: e.provenance as {...} })` | provenance 经 `entity.ts:65` `provenance: init.provenance` 写入新记录；`world.ts:33` 已导入 `allocate` |
| ④ 重演 | `main.ts:70,74` → `creation.ts:154-173 rebuildAll()`：`:157` `forEach('creation', rec)` → `:159` `const prov = rec.provenance as {seed,moduleHash}|undefined` → `:160` `if (!prov) return` → `:161` `CREATION_TEMPLATES.find(t => t.id === prov.moduleHash)` → `:163` `buildTemplateGeo(tpl, prov.seed)` → `:168` `scene.add(mesh)` → `:169` `this.meshes.set(rec.id, mesh)` | 模板 id 与 `creation.ts:139` 新造物写入的 `moduleHash: tpl.id`、`:166` `mesh.name = \`creation-${tpl.id}-${seed}\`` 同口径，能查到模板 |

结论：**不存在「重演拿到空 provenance」** —— 只要档是 `interact.save()` 写出的合法档，provenance 四段齐全。

### 2.2 id 单调语义 —— 无「id 冲突」

- `entity.ts:48` `let idSeq: EntityId = NONE_ENTITY;`（0 保留），`:56` `const id = ++idSeq;` 单调递增；`:8-10` 铁律明确「id 单调递增、永不复用——复用会让旧存档引用指到新对象（存档毒药）」。
- `world.ts:358` **没有**把 `e.eid` 传给 `allocate`（`entity.ts:53` 的 `init` 是 `Partial<Omit<EntityRecord,'id'|'kind'|'alive'>>`，本就不接受 id）。所以恢复实体拿到的是**本会话新 id**，不是存档里的 `eid`。
- `creation.ts:158` `if (this.meshes.has(rec.id)) return;` 与 `:169` `this.meshes.set(rec.id, mesh)` **用的是同一个新 `rec.id`**；`creation.ts:179` `destroy()` 的 `this.meshes.get(eid)` 传入的是调用方持有的 id（新造物 `:145` 用 `allocate` 返回值，恢复造物由外部按 `rec.id` 取得）。因此**旧 `eid` 与 mesh 之间不存在错配**：`e.eid` 在读侧（`world.ts:355-363`）完全未被引用，只是被原样留在 `pendingEntities` 里用于 `:369` 日志计数。
- 恢复实体在 `world.init()` 读档阶段（`:336-372`）分配，早于所有世界生成任务（`:381` 起）的 `allocate`，新会话 `idSeq` 从 0 起、无残留引用 → **不会与任何后续分配冲突**。
- 结论：修法选择「不保留旧 eid」恰好规避了 `entity.ts` 铁律警告的存档毒药，**无 id 冲突**。代价是 `SaveDataV2.entities[].eid` 在读侧成为死字段（信息性，非缺陷）。

### 2.3 发现的静态隐患（当前不触发，供排期）

#### 隐患 A —— 恢复实体缺 `object3d` 与 `onDispose`，重演 mesh 可能在非 `destroy()` 路径成为孤儿

- `world.ts:358-362` 的 `allocate('creation', {...})` 只传 `pos/persist/provenance`，**未传 `object3d`、未传 `onDispose`**；`entity.ts:60` `object3d: init.object3d ?? null`、`:66` `onDispose: init.onDispose ?? []` → 恢复实体的 `object3d` 恒 `null`、`onDispose` 恒空。
- 对比新造物 `creation.ts:135-144`：`object3d: mesh`（`:138`）且注册 `onDispose: [() => { this.scene?.remove(mesh); mesh.geometry.dispose(); }]`（`:140-143`）。
- `creation.ts:154-173 rebuildAll()` 只做 `this.meshes.set(rec.id, mesh)`（`:169`），**既不回写 `rec.object3d = mesh`，也不把清理回调 push 进 `rec.onDispose`**。
- 后果：若将来从 `CreationSystem.destroy()` 以外的路径调 `dispose(eid)`（实体表统一清理、场景重载、HMR 清理等），`entity.ts:92-105` 会跑一个空 `onDispose`，而 `rebuildAll()` 生成并已 `scene.add` 的 mesh 不会被 `scene.remove`、geometry 不会 dispose → **孤儿 mesh + GPU 资源滞留**。
- 当前状态：全仓 `dispose` 对 creation 的唯一调用点是 `creation.ts:181`（`destroy()`），而 `destroy()` 在 `:180` 自己先 `scene.remove(mesh) / geometry.dispose() / meshes.delete(eid)`，所以**当前不会触发**。属静态隐患。
- 建议（不改）：`rebuildAll()` 在 `:169` 附近补 `rec.object3d = mesh`（`EntityRecord.object3d` 是 `{id:number}|null`，`THREE.Mesh` 结构兼容），并 `rec.onDispose.push(() => { this.scene?.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(rec.id); });`，使恢复实体与新造物生命周期对称。

#### 隐患 B —— `rebuildAll()` 幂等返回值会让二次触发把 `creationCount` 清零

- `main.ts:70` `world.onRebuildCreations = () => { world.creationCount = creation.rebuildAll(); };`
- `creation.ts:158` `if (this.meshes.has(rec.id)) return;` 是幂等守卫 → **第二次调用 `rebuildAll()` 返回 0**（`:172 return rebuilt`），把 `world.creationCount`（`world.ts:321`）重置为 0，而 meshes 仍在场景中。
- 当前状态：全仓 `onRebuildCreations()` 只在 `main.ts:74` 调用一次，**当前不触发**；但 HMR / 场景重载 / 未来任何二次触发都会把计数清零。
- 建议（不改）：`rebuildAll()` 返回 `this.meshes.size`（当前有效造物数）而非本次重建计数；或 `onRebuildCreations` 只在 `creationCount === 0` 时赋值。

#### 隐患 C（弱，信息性）—— `provenance` 无运行时形状校验，坏档可能产生「永久无 mesh 的幽灵 persist 实体」

- `world.ts:361` `e.provenance as {seed,moduleHash,apiVersion} | undefined` 是纯 TS 断言；`save.ts:47` 类型为 `provenance?: unknown`；`migrate()`（`save.ts:69-80`）**不校验 `entities[]` 逐项 provenance**。
- `creation.ts:159-162` 若 `prov` 为 `null` / 字符串 / 缺 `moduleHash`，会静默 `return`（`:160 if (!prov) return` 或 `:162 if (!tpl) return`），既不重建也不报错；但该实体 `alive=true, persist=true` 仍在表内 → 下次 `collectPersistedEntities()`（`save.ts:101-104`）又把它写回档，形成**每会话都恢复、却永远没有 mesh 的幽灵实体**。
- 触发面：旧档 / 手工损坏档 / 跨版本档，正常档不触发。
- 建议（不改）：`migrate()` 对 `entities` 逐项校验 `provenance` 形状并过滤无效项（注意 `tests/save.test.ts:10-16` 的 `v2()` 夹具 `entities: []`，逐项校验空数组不改变结果，`:48` 断言仍成立）；或 `rebuildAll()` 对无有效 provenance 的 rec 调 `dispose(rec.id)` 使其不再回写档。

### 2.4 风险点小结

| 检查项 | 结论 |
|---|---|
| `allocate` id 单调语义 ↔ `meshes.set(eid, mesh)` 能否对上 | **对得上**：读侧不引用旧 `eid`，`meshes` 全程用新 `rec.id`，无错配 |
| 有无「id 冲突」静态隐患 | **无**（新会话 idSeq 从 0 起、恢复先于生成分配、不复用旧 id） |
| 有无「重演拿到空 provenance」静态隐患 | **主链无**（写→迁移→读→重演四段齐全）；但坏档路径下存在隐患 C 的幽灵实体 |
| 其他静态隐患 | 隐患 A（`object3d`/`onDispose` 缺失）、隐患 B（`rebuildAll` 二次调用清零 `creationCount`）—— 当前均不触发 |

---

## 三、残留观察汇总（不构成「未修」，登记备查）

1. **C02 玩家可见提示**：两处 `.catch` 均只 `console.warn`，我原最小修法的 `bus.emit('ui:toast','存档失败')` / 加载页降级提示未落地。玩家视角仍无可见提示；开发者视角已可观测、unhandled rejection 已消除。
2. **C11 首次写档竞态**：`world.ts:812` `__saveSave` 仍 fire-and-forget 注入、`world.ts:902` 启动期写档无屏障。与红队 `§2.5 C11`「维持疑似」一致，本轮未做运行时验证，不升级。`world.ts:371` 的 `mgr.close()` 在 `try` 而非 `finally`，抛错路径不 close（轻微）。
3. **`round1-core-ab.md §三` 提醒 1 已闭环**：我在第 3 轮答辩时指出「主线程只改了 `deserialize`、`world.ts:848 I.save()` 仍早于 `:853 revive()`、`survival.ts` 注释与代码不符」。当前 `world.ts:919 I.save()` 已在 `:915 revive()` 之后，`survival.ts:104` 注释现在准确。该提醒可关闭。
4. **§三 提醒 2（C06 影响面升级）与提醒 3（C01 修法订正）**：提醒 3 已由本次第 3 项落地（`bossRewardPaid` 闸门 + `bossDefeated` 入档，比扩大 if 更稳）；提醒 2 属运行时证据裁决口径，不在本次只读交叉复核范围，仍待 team-lead 裁决。

---

## 四、纪律复核

- 本次仅新增 `artifacts/round3-core-crosscheck.md` 一个文件；**未修改任何 `src`**，未写 `artifacts/` 之外文件，未运行 `tsc` / `npm test` / 构建 / 浏览器探针。
- `tests/save.test.ts:48` 的结论为**静态推演**（读 `v2()` 夹具 + 逐条走 `migrate()` 分支），未执行测试；若主线程跑全量测试，建议顺带确认这一条。
- 所有 `file:line` 均为当前工作树行号（`git diff --stat`：17 个 `src` 文件改动，`world.ts +181`）；`round1-core.md` / `round1-core-ab.md` 使用的是审核基线 `be0226e` 行号，两者不可混用（`round1-core-ab.md §0.3` 已给漂移对照表）。
- 对隐患 A/B/C 只给行号与建议，**未动手改任何代码**。
