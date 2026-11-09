# 第 1 轮全量代码审核 · 交互/玩法/战斗/收集/升级/经济（play-expert）

> 审核产物，非源码。基线 `git HEAD = be0226e9550608d638c93c437449da72ea615b83`（「P1-5 六道阶位收口」）。
> 范围：交互点触发链、数值一致性、战斗与死亡复活、收集与升级、目标链/任务、三界动词接线。
> 不审：几何生成/贴图/渲染、UI 样式、底层事件总线实现、存档序列化实现（分别由 geom-expert / ui-perf-expert / core-expert 负责）。
> 纪律：src 源码全程只读，未改任何源码、未运行构建/测试、未写脚本落盘；仅本文件为授权落盘的审核产物。
> 口径：每条结论给出 file:line 与函数名；涉及数值写出常量与计算式；严格区分【确认缺陷】【疑似需运行时验证】【设计取舍非缺陷】。
> **验收断言口径（与 core-expert 对齐）**：本报告每条「验收断言」都是**修复目标**——相应缺陷被确认并修复后应满足的期望，**不是「当前已通过」的断言**；在当前 `be0226e` 实现上这些断言均会失败（【疑似】条目需先运行时验证再谈修复）。§4.2 与 §三 C14 额外标注的「当前会失败」只是强调，口径一致。core-expert `round1-core.md` 的 I1/I1b 采用**暴露式断言**（如期望 `onFaint` 恰好 1 次、实际 0 次，用来证明缺陷存在），与本报告「修复目标」是同一批缺陷的两种互补表述，**不冲突，请勿把「修复后期望」误读成「当前已不刷」**。

---

## 〇、数值一致性核对（重点2）

### 一致（无缺陷）
- **业力/阶位**：阈值表唯一源 `src/game/karma.ts:17-24` `REALM_TIERS = [{人道,0},{修罗道,300},{畜生道,800},{饿鬼道,1600},{天道,3200},{佛道,6400}]`；`tierOf(karma)` `src/game/karma.ts:26-30` 与 HUD `src/ui/ui.ts:421-425`（`const km = world.karma.current()` → `✦ ${km.tier} · 业力 ${km.karma}`）同源；无硬编码重复常量；`tests/karma.test.ts:8-17` 覆盖 0/299/300/799/800/1600/3200/9999 阈值。`gain()` `karma.ts:38-47` 与 `penalty()` `karma.ts:50-52` 均 `Math.max(0, …)`，业力不会为负。**数据表 / 结算代码 / HUD 三处一致**。
- **赌局输赢**：`InteractSystem.openDice()` `src/game/interact.ts:189-198` `roll()` → `pay(bet)` 扣注，赢时 `earn(bet*2)`（interact.ts:196），净 `+bet`；与文案「赢了 +{bet} 文」(interact.ts:195) 一致。三骰和 3–18，`isBig = sum>=11`（interact.ts:193），和 `s` 与 `21-s` 对称（10↔11），`P(大)=P(小)=0.5`，无套利。押注档 `[10,20,50,100]`（interact.ts:173）。
- **升级/入场消耗**：钢刀 30 文（`src/world.ts:1628-1631` `tryPay(30)`）、造物 `CREATION_COST=100`（`src/game/creation.ts:13`，与 `src/game/conditions.ts:50` c-creation「铜钱 ≥100」一致）、建造放置 10 文（`src/game/buildMode.ts:142` `spend(10)`）、五子棋入场 50 文（`interact.ts:211` `pay(50)`，与 `conditions.ts:37-38` 一致）、冥途牒 10 阴德 + 10 文（`src/data/interactPoints.ts:53` `g('冥途牒',10,'yindepeach',…)`，与 `conditions.ts:42-43` 一致）。
- **蟠桃上限**：`addPeach()` `interact.ts:68-76` `Math.min(9, this.peach+n)` 上限 9，与 `conditions.ts:54` c-peach `peach>=9`、HUD 三币两位显示一致。
- **三币循环**：烧纸 10 文 → 阴德 +1（interact.ts:136）；冥途牒 10 阴德 + 10 文 → 蟠桃 +1（interact.ts:141）；蟠桃赏赐 1 桃 → 100 文（interact.ts:146）。循环 100 文 →10 阴德 →(10 文)→1 桃 →100 文，净 −10 文，注释「持平不套利」(interact.ts:138-139) 成立（唯独蟠桃赏赐的实结有 1 文偏差，见 P-06）。

### 不一致（指向下方条目）
- 蟠桃赏赐实结 **+99 文** vs 文案/条件节点 **100 文** → **P-06**。
- Boss 掉落蟠桃数三处口径不一致：`src/world.ts:776` 注释「蟠桃 +1」、`src/game/survival.ts:81-84` `bossReward()` 注释「利品蟠桃数」返回 `1`（该返回值从未被使用）、`src/world.ts:792` 实际 `addPeach(2)` 发 2 个。属注释/死返回值噪声，不影响实际结算，**不单列缺陷**。
- `show`/`song` 门票价格从描述文本解析：`src/world.ts:1538` `parseInt(p.desc.match(/(\d+)/)?.[1] ?? '5',10)`、`world.ts:1541` 同款兜底 `'2'`。是「文案兼价目」的第二套硬编码口径，与数据表分离 → 记为设计取舍（§二）。

---

## 一、结论（14 条，按严重度排序）

### P-01 【确认缺陷·高】付费食物不回饥饿/血，生存循环「吃」链路断裂
- **现象**：花 1~80 文买 61 表中 E/B 类商品（點茶 2 / 羊羔酒 15 / 羊肉麵 7 / 席面 80 …，`src/data/interactPoints.ts:15-32,52-67`）、小吃摊 12/8/6 文（`world.ts:1552-1556`）、正店 20/40/30 文（`world.ts:1578-1582`），`survival.hunger` / `survival.hp` **毫无变化**；`src/game/conditions.ts:35` c-hunger「去小吃摊买点吃的（回 30 饥饿）」在这些商品上无法兑现。
- **代码根因**：`InteractSystem.openShop()` `src/game/interact.ts:123-155`，购买按钮 `b.onclick` 成功分支（interact.ts:133-150）只做三币特判 `burnpaper/yindepeach/peachgrant` + `this.act(g.act…, 3.5, g.say)`（interact.ts:148），**从不调用 `Survival.eat()`**。全项目 `survival.eat()` 唯一调用点是 `src/world.ts:1551`（小吃摊，且是「打开面板时」，见 P-02）。即：付款 → 只播放动作 → 无生存收益。
- **触发条件/复现**：附身（V）→ 任一 E 点/孙羊正店 → 按 E → 买「煎鱼整套」12 文 → `coins −12`，`🍚/❤️` 不变。
- **最小修法**：`openShop` 购买成功且 `g.act==='eat'||'drink'` 时调用 `survival.eat(hungerGain,hpGain)`；恢复量写进 `GoodRow`（`src/data/interactPoints.ts:4`）或由 goods 携带。
- **是否影响既有单测**：不影响。6 个玩法测试均不触及 `openShop` 购买分支（`tests/karma.test.ts` 测 Karma 类、`tests/conditions.test.ts` 测纯函数、`tests/shopInterior.test.ts` 测室内几何、`tests/voxel.test.ts` 测 VoxelStore、`tests/p05-p06.test.ts` 测 loop/LOD、`tests/entityRegistry.test.ts` 测实体表）。
- **验收断言**：模拟点击「煎鱼整套」→ `expect(coins).toBe(before-12)` 且 `expect(survival.hunger).toBeGreaterThan(beforeHunger)`。

### P-02 【确认缺陷·高】小吃摊打开面板即免费回 30 饥饿 + 10 血，可无限刷
- **现象**：不花一分钱、反复按 E 即可把 `hunger`/`hp` 刷满；`Survival.tick()` 的饿空扣血→晕倒（`src/game/survival.ts:38-51`，`STARVE_DMG_PER_SEC=2`）生存压力被完全绕过；与 P-01 叠加后「付费反而不如免费」。
- **代码根因**：`src/world.ts:1550-1557` `I.add(new THREE.Vector3(s.x,0.1,s.z), 3.6, '在小吃摊买点吃的', () => { this.survival.eat(30, 10); I.openShop('小吃摊', [...]); })` —— `survival.eat(30,10)`（`src/game/survival.ts:74-78`，`hunger=min(100,h+30)`、`hp=min(100,hp+10)`）在**打开面板时无条件执行**，与是否付款/是否下单无关；该 exec **不设 `busyUntil`**。`InteractSystem.interactHook` `interact.ts:45-48` 直接 `n.exec()` 无节流；`PlayerController.tryInteract()` `src/game/player.ts:218-223` 只查 `clock() < busyUntil`，此处 `busyUntil=0`，故关面板再按 E 可无限重复。
- **触发条件/复现**：附身站在任一 `stallsCache.filter(s=>s.kind==='food')` 点（`world.ts:1548`）→ 连续按 E 开/关商店 → `🍚→100`、`❤️→100`、`coins` 不变。
- **最小修法**：删除打开面板时的 `survival.eat`，把恢复移入具体食物购买成功分支（与 P-01 同一处修）。
- **是否影响既有单测**：不影响。
- **验收断言**：「打开小吃摊面板但不下单」→ `expect(survival.hunger).toBe(before)` 且 `expect(coins).toBe(before)`；连续开关 10 次后二者仍不变。

### P-03 【确认缺陷·高】冥途牒蟠桃满仓时扣 10 文 + 10 阴德但蟠桃不增，且不回滚
- **现象/计算式**：`peach=9, yinde=10, coins=500` 时买冥途牒 → `coins 490`、`yinde 0`、`peach 9`（无变化）；钱与阴德都不退。
- **代码根因**：`src/game/interact.ts:134` 通用 `if (this.pay(g.price))` 先扣 10 文（冥途牒 `price=10`，`src/data/interactPoints.ts:53`）；line 137-141 的 `yindepeach` 分支**只对「阴德不足」一种失败做了 `this.refund(g.price)`**（interact.ts:140，此处有回滚，如实说明），成功分支 `this.yinde -= 10; this.addPeach(1); this.save();`（interact.ts:141）**未检查蟠桃上限**；而 `addPeach()` `interact.ts:68-76` 用 `this.peach = Math.min(9, this.peach + n)`，满仓时 `gained = 9-9 = 0`，丢弃并 toast「蟠桃宴赐福——但蟠桃点已满（上限 9）」（interact.ts:75），但 10 阴德与 10 文已扣、无 refund。
- **加剧**：`conditions.ts:42-43` c-yinde(pri 2) 优先级高于 `conditions.ts:54-55` c-peach(pri 5)，`peach` 满仓且 `yinde>=10` 时 HUD `topCondition()`(conditions.ts:62-65) 反而提示「阴德 ≥10——去王家纸马焚冥途牒」，主动把玩家引向该坑。
- **触发条件/复现**：把 `peach` 刷到 9、`yinde>=10`（烧纸 10 次）→ 去 B2 王家纸马（`interactPoints.ts:53`）买「冥途牒」。
- **最小修法**：成功分支先判 `this.peach >= 9` → `refund(g.price)` 且不扣 yinde；或让 `addPeach` 返回实际增益 `gained`，按 `gained` 扣 yinde/退款。
- **是否影响既有单测**：不影响（`tests/karma.test.ts` 只测 `Karma` 类，不测 `InteractSystem` 商店）。
- **验收断言**：`peach=9,yinde=10,coins=500` 买冥途牒 → `expect([coins,yinde,peach]).toEqual([500,10,9])`；`peach=8` 时才断言 `[coins-10, yinde-10, peach+1]`。

### P-04 【确认缺陷·高】建造模式「放置→拆除」可无限刷钱
- **现象/计算式**：`src/game/buildMode.ts:141-142` `place()` 优先扣 `materialStock`（免费）、库存空才 `this.spend(10)`；`breakBlock()` `buildMode.ts:153-154` 拆除**同时** `this.materialStock++` 与 `this.earn(2)`。`materialStock`（buildMode.ts:23）是单一全局计数、**不区分方块类型、无上限**（注释称「当前方块类型(1-8)」，实现只有一个变量）。
  设初始 `C` 文、库存 0：
  ①放置 `−10`（库存空走 spend）②拆除 `+2` 且库存 `1` → `C−8`、库存 1；
  此后每轮「放置（耗库存，0 文）→ 拆除（`+2` 文、`+1` 库存）」库存恒为 1、`coins` 每轮 **+2** → 无限正收益。
- **代码根因**：`buildMode.ts:141` `if (this.materialStock > 0) { this.materialStock--; } else if (this.spend && !this.spend(10)) return;` 与 `buildMode.ts:153-154` `this.materialStock++; if (this.earn) this.earn(2);`。`spend/earn` 由 `src/main.ts:47-48` 注入 `world.interact.tryPay/earn`。
- **触发条件/复现**：按 G 进建造模式 → 在体素区（`inArea`，buildMode.ts:138）对同一格反复左键放置 / 右键拆除。
- **最小修法**：拆除不再返钱（或返钱 = 放置费 10 使闭环零和）；或库存按方块类型分账且拆除只回库存不回钱。
- **是否影响既有单测**：不影响（`tests/voxel.test.ts` 只测 `VoxelStore` 数据层/序列化，不测 `BuildMode` 经济）。
- **验收断言**：模拟 N=100 轮「放→拆」同一格 → `expect(coins_after).toBeLessThanOrEqual(coins_before)` 且 `materialStock` 不无界增长。

### P-05 【确认缺陷·中高】Boss 血条进入战斗后永久常驻（含击败后），台账 V-10 实拍印证
- **现象**：只要玩家进过 Boss 34m 一次，之后传送离开天宫/回人间、脱战回血、甚至击败 Boss，`#bossbar` 红色细横条一直显示。`artifacts/VISUAL-AUDIT-20261107.md:50` V-10 记录「顶部常驻一条红色细横条（Boss 血条）… ⚠️ 未修」，line 120 归为「需定位 DOM 层」（实际 `ArenaBoss.mountHud()` `src/game/boss.ts:219-239` 挂 `document.body`、id `bossbar`、`z-index:30`，不在 `#ui` 层）。
- **代码根因**：`ArenaBoss.syncHud()` `src/game/boss.ts:242-246`：`const active = !this.defeated && this.state !== 'idle';` → `this.bar.style.opacity = active || this.defeated ? '1' : '0';`。而 `ArenaBoss.update()` `boss.ts:153-216` 状态机**没有任何 `this.state = 'idle'` 回退赋值**（idle→engage `L171`，engage→telegraph `L185`，telegraph→active `L203`，active→engage `L212`，knockback→respawning→engage `L158`；dead 终止）；`defeated` 后 `update` 直接 `if (this.defeated) return;`（boss.ts:155）不再调 `syncHud`。故 state 一旦非 idle 或 `defeated=true`，opacity 恒 `'1'`。构造时 `syncHud()`（boss.ts:74）是唯一 opacity=0 的时刻。
- **判定「非设计取舍」的三条内证**（供第 2 轮证伪）：
  ① `boss.ts:164` `if (!this.defeated && d > this.spec.engageRange) this.outT += dt; else this.outT = 0;` + `boss.ts:165-168` 脱战 2.5s 后 `hp = Math.min(maxHp, hp + maxHp*0.04*dt)` —— **数值层已按「离开 34m = 脱战」处理并回血，状态层却不回 idle**，语义自相矛盾；
  ② 脱战后 engage→telegraph→active 环不中断，每次起手仍 `vfx.ring(...)`(boss.ts:188)、`bus.emit('sfx:drum')`(boss.ts:189)、`vfx.burst(...)`(boss.ts:204)，仅因 `d > cfg.range`(boss.ts:205) 不触发 knockback —— 玩家回人间后天宫 Boss 仍按 `interval=[3.2,2.4]`(`src/data/boss.ts:45`) 空转放招发音效；
  ③ `defeated` 后 label 停在「${name} · 已伏誅」+「0 / 320」(boss.ts:248,256)，血条锁死显示。
- **触发条件/复现**：`world.teleport('jiangtai')`（`src/world.ts:1711`）靠近触发 engage → `world.teleport('bridge')` 离开 → 读 `document.getElementById('bossbar').style.opacity` 仍 `'1'`；或击败 Boss 后观察。
- **最小修法（玩法侧，归本域）**：在 `update` 脱战分支补状态收口 —— `!defeated && d > spec.engageRange && outT > 2.5` 时 `this.state = 'idle'` 并补一次 `this.syncHud()`（同时停掉招式空转）；`defeated` 后另给一次隐藏/延迟淡出。次选「只把 `syncHud` 的 `active` 改成 `!defeated && d <= engageRange`」只治血条不治空转，**不推荐**。
- **是否影响既有单测**：不影响（无 Boss HUD 测试）。
- **验收断言**：置 `boss.state='engage'` → 玩家移到 `>34m` → `update` 数秒 → `expect(document.getElementById('bossbar').style.opacity).toBe('0')`；`defeated=true` 同样断言隐藏。
- **协作**：ui-perf-expert 的 UI-01（DOM 挂载层/层级）+ UI-02（显隐条件）与本条根因一致，第 2 轮合并为一条「Boss 血条常驻」联合结论，各自保留 file:line。

### P-06 【确认缺陷·中】蟠桃赏赐 price 语义错配：净 +99 文，且身无分文时无法兑换
- **现象/计算式**：`src/data/interactPoints.ts:85` `PEACH_GRANT = { …, goods: [{ name:'蟠桃賞賜', price:1, act:'peachgrant', say:'蟠桃点一枚，换铜钱百文' }] }`；`interact.ts:134` 通用 `pay(g.price)` 把 `price=1` 当**铜钱**扣（`coins −1`），`interact.ts:143-146` 再 `this.peach -= 1; this.earn(100)`（`coins +100`）。净 `coins = −1 + 100 = +99`、`peach −1`；而 `say`(interactPoints.ts:85)、`src/game/conditions.ts:55` c-peach「每枚 100 文」、`src/world.ts:1521` 注释均写 **100 文**。另 `coins=0` 时 `pay(1)` 返回 false（`interact.ts:56`），`if (this.peach < 1)` 的 refund 分支（interact.ts:145）不会走到，即便 `peach>=1` 也兑换失败 —— 蟠桃无法用来救急。
- **触发条件/复现**：`coins=500,peach=1` → 瑶池蟠桃赏赐（`world.ts:1526-1528` 注册，半径 11）兑换 → `coins=599`（非 600）；`coins=0,peach=3` → 兑换 → toast「铜钱不够」交易失败。
- **最小修法**：`peachgrant` 分支不走通用 `pay(g.price)`（或 price 设 0 / 语义改为「1 蟠桃点」单独校验），把蟠桃点作为独立消耗；文案与实结统一为 100。
- **是否影响既有单测**：不影响。
- **验收断言**：`coins=500,peach=1` → `expect([coins,peach]).toEqual([600,0])`；`coins=0,peach=1` → 兑换仍成功。

### P-07 【确认缺陷·中】扛包/狱环用 setTimeout 延迟结算，传送/晕倒/离线后仍发钱发业力，且无业务冷却
- **现象**：按 E 扛包后立即传送走/切灵魂模式/晕倒，8.2s 后仍 `+20 文 +2 业力`；狱环同理 `+5 业力`。业力可在「人不在场」时增长；晕倒 `karma.penalty()` −100（`src/world.ts:844`）后延迟的 `+2/+5` 又把它加回。仅靠 `player.busyUntil` 通用动作锁防连按：`act('carryPole',8,…)` → `busyUntil = clock()+8000`（`interact.ts:104`），而 `setTimeout(…,8200)` 有 **200ms 重入窗口**（8.0–8.2s）可叠加第二个 timer；狱环 `act('pray',6,…)`=6000ms vs `setTimeout(…,6200)` 同样 200ms 窗口。
- **代码根因**：`src/world.ts:1618-1625` 扛包 `I.act('carryPole', 8, …)` + `window.setTimeout(() => { I.earn(20); this.karma.gain(2,'human'); bus.emit('ui:toast',…); }, 8200)`；`src/world.ts:828-831` 狱环 `this.interact.act('pray', 6, …)` + `window.setTimeout(() => { this.karma.gain(5,'underworld'); bus.emit('ui:toast','狱环巡行毕——业力 +5'); }, 6200)`。回调不校验玩家是否仍在场/动作是否完成/是否已被其它动作覆盖；`setTimeout` 是 wall-clock，与游戏暂停/帧无关。
- **触发条件/复现**：附身 → 码头扛包点（`[-238,38]/[-252,36]/[-222,36]`，半径 3.2，world.ts:1617）按 E → 立即 `world.teleport('bridge')` → 等 8.2s → `coins+20`、`karma.karma+2`。
- **最小修法**：结算挂进动作完成回调并带 token 校验（玩家仍在原交互点 / 未传送 / 未晕倒），或改用 `world.update` 的 sim-time 计时并在离开/死亡时取消；统一业务冷却。
- **是否影响既有单测**：不影响（`tests/karma.test.ts` 直接 `new Karma().gain()`，不覆盖 world 的 `setTimeout` 接线）。
- **验收断言**：触发扛包后立刻把玩家移出 3.2m 且结束 busy → 推进 8.2s → `expect(coins).toBe(before)` 且 `expect(karma.current().karma).toBe(before)`。

### P-08 【确认缺陷·中｜接线不对称】天宫动词（蟠桃宴 +8 业力）挂 havoc 自动循环回调，无需交互/位置/模式，可挂机刷满六道
- **现象**：玩家在人间/地府挂机（甚至灵魂模式），「大闹天宫」每轮约 10 分钟自动到 `pi=9`（幕间·蟠桃宴），自动 `+1 蟠桃 +8 业力`；蟠桃满 9 后 `addPeach()` 丢弃（`gained=0`）但 `karma.gain(8,'heaven')` **照常执行**，业力可无限累积至佛道 6400（`REALM_TIERS`，karma.ts:23）而玩家零操作。与 `src/game/karma.ts:8` 注释「三界各配 1 个可重复动词，动词产出业力…交互点接 interact.act」、人间扛包(+2)/地府狱环(+5) 都需交互的口径不对称。
- **代码根因**：`src/world.ts:765-768` `this.havoc.onPeachBanquet = (n) => { this.interact.addPeach(n); this.karma.gain(8, 'heaven'); };`；`src/sky/havoc.ts:362` `this.pi = (this.pi + 1) % this.phases.length;`（循环）、`src/sky/havoc.ts:370` `if (this.pi === 9 && this.onPeachBanquet) this.onPeachBanquet(1);`；`src/world.ts:1476` `this.havoc.update(t, dt);` 每帧无条件调用，不看玩家所在界/模式。
- **遗漏分支**：其余三条「获得蟠桃」路径 —— Boss 击败 `addPeach(2)`(world.ts:792)、冥途牒 `addPeach(1)`(interact.ts:141)、瑶池蟠桃赏赐（消费非产出）—— **都不**触发 `karma.gain(8,'heaven')`。若「天宫动词 = 得蟠桃」为设计口径，则属遗漏分支。
- **备注**：「自动名场面给蟠桃」是既有设计（`sky/havoc.ts:368-369` spike-H6 劳动锚定「每轮大闹天宫全幕 ~10 分钟 → 1 桃 ≈ 100 文等效」）；本条聚焦的是**把业力 +8 也挂到该自动回调**导致业力轴可挂机刷满、三界动词接线口径不一致。是否定性为缺陷请第 2 轮证伪。
- **最小修法**：`+8` 改挂玩家主动交互点并加「在天宫且附身」门槛，或统一三界动词为同口径。
- **是否影响既有单测**：不影响（`karma.test.ts` 不测 havoc 接线）。
- **验收断言**：玩家置于人间、灵魂模式，推进 havoc 越过 `pi=9` → `expect(karma.current().karma).toBe(before)`（或增量 0）。

### P-09 【确认缺陷·中低】Boss 击退不接生存循环：死亡/复活/晕倒代价链在战斗中完全断开
- **现象**：被 Boss 横扫/擒拿命中（`boss.ts:205` `if (d <= cfg.range) this.knockback(...)`）的「失败」只把玩家传回恢复点 `jiangtai`（`src/world.ts:800` `() => { this.respawnPlayerAt(JULING.recoverPoi); }`，`src/data/boss.ts:47` `recoverPoi:'jiangtai'`），**不扣 `survival.hp`、不触发 `onFaint`**（罚半铜钱 `Math.floor(coins*0.5)` + 业力 −100 + 孟婆庄重生的死亡复活链，`src/world.ts:842-852`）。而 `Survival.damage(n)` `src/game/survival.ts:62-71` 全项目**无任何调用**（Grep 确认是死代码），Boss 战/任何战斗都无法致死；晕倒仅由饥饿 `tick()`（survival.ts:40-51）触发。
- **代码根因**：`ArenaBoss.knockback()` `src/game/boss.ts:141-151` 只 `this.knockbacks++`、发 toast、`state='respawning'`、`respawnT=respawnDelay(3)`、`this.onKnockback()`；`survival.damage()` 无调用点。
- **旁证（与 motion-expert M-04 为同一事实，定性一致【确认缺陷】，以 M-04 为准不重复计数）**：`PlayerController.applyDisorient()` `src/game/player.ts:115-121` 全 src 无调用，而 `src/data/levelPlan.ts:57` mengpo 已声明 `threatSpec:{kind:'disorient',radius:12,speedScale:0.6,strength:1,duration:6}`，wangxiang 的 slow 却在 `src/world.ts:1462-1467` 接了 `speedScale=0.55`。**运动侧精确修法（motion-expert 提供）**：即便把 `applyDisorient` 接上也会失效 —— `src/world.ts:1466` 每帧**无条件** `this.player.speedScale = near ? 0.55 : 1;` 会在下一帧覆盖 `applyDisorient` 写入的 0.6（`player.ts:113` 注释只做单向规避，未消解冲突）；正解改为叠加式 `speedScale = slowScale * disorientScale` 并按 `duration=6` 衰减，且 `disorientJitter`（`player.ts:105-106`）与 `fadeHint` 全 src 无消费点，需一并接（前者叠到 camYaw、后者交 UI 灰化）。实现细节归 motion-expert。
- **类别说明**：按 survival 语义「晕倒 = hp≤0」，Boss 击退不算晕倒，代价轻属**设计取舍**；本条确认的是 `damage()` 死代码 + 战斗与死亡复活链脱节。
- **最小修法**：若 Boss 命中应计死亡，则 `onKnockback` 注入 `survival.damage(...)`；否则删除死代码并统一注释。
- **是否影响既有单测**：不影响（无 survival 接线测试）。
- **验收断言**：Boss `active` 命中玩家 → `expect(survival.hp).toBeLessThan(HP_MAX_before)`，或明确断言「不扣血」为既定语义（二选一，杜绝死代码悬空）。

### P-10 【疑似需运行时验证】造物四门校验失败/异常时已扣 100 文不退款
- **代码根因**：`CreationSystem.submit()` `src/game/creation.ts:79-139`：line 89 `if (this.spend && !this.spend(CREATION_COST))` 先扣 100 文（`spend` 由 `src/main.ts:54` 注入 `world.interact.tryPay`），line 97-112 才做四门校验 `gateFail = tris>MAX_TRIS(20000) | maxEdge>MAX_EDGE_M(200) | bytes>8*1024*1024`（creation.ts:14-15,103-106）；`gateFail` 分支（creation.ts:107-112）只 `busy=false` + toast + return，**无 refund**；且 `buildTemplateGeo`/`new THREE.Mesh`/`allocate`（creation.ts:98,115,123）若抛异常，无 `try/finally` 复位 `busy`（line 93 置 true）、不退款。
- **现状/为何标疑似**：8 个模板 tris/edge/bytes 静态合规（`src/game/creationTemplates.ts:330-338` `measure()`，H3 实证龙 1141 tri），当前 `gateFail` **不可达** → 需构造超预算模板或 mock 触发，不按【确认缺陷】报。
- **最小修法**：把 `spend` 移到四门 + 落场全部成功之后；或失败分支 `refund(100)`；异常路径加 `try/finally` 复位 busy + 退款。
- **是否影响既有单测**：不影响（`tests/entityRegistry.test.ts` 只测底层 `allocate/dispose`）。
- **验收断言**：mock `buildTemplateGeo` 返回 `tris>20000` 的 geo → `submit('龙')` 后 `expect(coins).toBe(before)` 且再次 `submit` 可成功（证明 `busy` 已复位）。

### P-11 【疑似需运行时验证】五子棋满盘时 aiMove 空 cand 解构崩溃 + 入场费 50 无退款/可重复
- **代码根因 A**：`InteractSystem.openGomoku()` `src/game/interact.ts:273-275` `cand.sort((a,b)=>b[2]-a[2]); const [bi,bj] = cand[0];` —— 9 路 81 格（`N=9`, interact.ts:213）填满且未五连时 `cand` 为空数组，`cand[0]` 为 `undefined`，解构抛 `TypeError`。极罕见但理论可达（最后一次落子后的 `setTimeout(() => { if (!over) aiMove(); }, 260)` interact.ts:288 触发）。
- **代码根因 B**：`interact.ts:211` `if (!this.pay(50)) return;` 入场即扣 50 文，之后 `makePanel(...)`；关面板（`closePanel()` interact.ts:110，✕ 按钮 interact.ts:117）/ 走开不退款；再按 E 再扣 50（「入场即付」可能是设计取舍，标疑似）。赢棋 `earn(100)`（interact.ts:286）净 `+50`，输则 `−50`。
- **最小修法**：`if (!cand.length) { over = true; info.textContent = '和棋'; return; }`；入场费改为「首落子时扣」或和棋/退出退款。
- **是否影响既有单测**：不影响。
- **验收断言**：构造满盘无五连 → 推进 260ms → `expect(() => aiMove()).not.toThrow()`；买入场后不开局关面板 → `expect(coins).toBe(before)`（若采纳退款口径）。

### P-12 【疑似需运行时验证】KeyJ 无 `ev.repeat` 过滤 + Boss 可在非附身模式被攻击
- **代码根因 A**：`src/ui/ui.ts:83-87` Boss 出手键监听 `window.addEventListener('keydown', ev => { … if (ev.code === 'KeyJ') { ev.preventDefault(); world.boss?.playerAttack(); } })` **没有 `if (ev.repeat) return`**（对比 `PlayerController.bindInput()` `src/game/player.ts:181-189` 的 line 185 有 `if (ev.repeat) return;`）。按住 J 以键重复速率（~30 次/秒）连调 `boss.playerAttack()`，仅被 `hitCooldown=0.28`（`src/data/boss.ts:42`，`boss.ts:114` `this.cd = this.spec.hitCooldown`）限流成自动连击，削弱 `boss.ts:17` 注释「防止连点刷伤害」的意图。
- **代码根因 B**：`ArenaBoss.playerAttack()` `src/game/boss.ts:107-138` 只查 `defeated/state/cd/dist`，**不检查 `player.mode`**；`dist()` `boss.ts:82-91` 取 `getPlayer()?.actor.pos`（`playerPos()`），而 `World.teleport()` `src/world.ts:1718-1720` 在灵魂/飞行模式下也 `this.player.actor.pos.set(p.x, p.y+0.5, p.z)`。故传送到 `jiangtai` 后灵魂模式按 J 也能打 Boss（对比 `player.ts:194` `engine.input.register('attack', …)` 与 `player.ts:225` `tryAttack()` 均要求 `mode==='avatar'`）。
- **最小修法**：KeyJ 加 `ev.repeat` 过滤；`playerAttack` 增加 `getPlayer()?.mode === 'avatar'` 门槛。
- **是否影响既有单测**：不影响。
- **验收断言**：派发 `repeat:true` 的 KeyJ keydown → `expect(boss.hits).toBe(0)`；`player.mode='soul'` 调 `playerAttack()` → `toBe(false)`。
- **协作**：本条属玩法/输入层，由本域出条、motion-expert 不重复；其作为 M-07 同类旁证引用 —— `PlayerController.tryAttack()`（`src/game/player.ts:224-226`）要求 `mode==='avatar' && state==='foot'`，而 Boss 攻击经 `boss.playerAttack()`（`boss.ts:107-138`）完全绕过 PlayerController，即「同一动作多套入口、状态门不一致」。

### P-13 【疑似需运行时验证】目标链：jiangtai 判定与 HUD 口径不一致，乱序完成会进度跳变/短时卡住
- **代码根因**：`World.tickObjectives()` `src/world.ts:1782-1803` 用 `this.poiGuide?.current()` 判定并写 `this.objectiveDone[n.key] = true`（world.ts:1789）；而 `PoiGuide.update()` `src/game/poiGuide.ts:42-58` 是**按距离取最近核心 POI**（候选 `Object.keys(LEVEL_PLAN) ∪ GUIDE_KEYS`，poiGuide.ts:8,47；每 8 帧刷新 poiGuide.ts:43），并非关卡顺序。`World.nextObjective()` `src/world.ts:1751-1755` 却用 `firstOpenIndex(this.objectiveDone)`（`src/data/levelPlan.ts:95-98`，严格按 `LEVEL_ORDER` 顺序遍历，levelPlan.ts:82-89）。`jiangtai`（`LEVEL_ORDER[8]`）的 `objectiveReached()` `src/world.ts:1770-1771` 只认 `!!this.boss?.defeated`。
- **现象**：击败 Boss 瞬间若 `poiGuide.current()` 不是 jiangtai（玩家已离开 / 8 帧刷新滞后），进度不立即 +1，需回到 jiangtai 附近才补标；玩家先走完地府节点时 `countLevelDone()`(levelPlan.ts:101-105) 已增长但 HUD「下一个」(`src/ui/ui.ts:170-174` `renderGoal`) 仍停在 jiangtai，出现「进度 N/17 但下一个是第 9 个」的不一致。回 jiangtai 打 Boss 即可解开，**非永久卡死**。
- **最小修法**：`onDefeat` 里直接置 `objectiveDone['jiangtai']=true` 并发 `objective:done`；或 `tickObjectives` 改为遍历 `LEVEL_ORDER` 全部未完成节点判定。
- **是否影响既有单测**：不影响（`tests/conditions.test.ts` 只测 `evalConditions/topCondition` 纯函数；无目标链单测）。
- **验收断言**：`boss.defeated=true` 且玩家不在 jiangtai → 推进一帧 → `expect(world.objectiveProgress().nextKey).not.toBe('jiangtai')`。

### P-14 【疑似·低】阴阳界淡出期 PORTALS 每帧重入 + 两套传送机制重叠
- **代码根因 A（确凿）**：`PlayerController.usePortal()` `src/game/player.ts:445-459` 在 fade 的 460ms `setTimeout`（player.ts:449-454）期间玩家仍在 portal 点，而 `player.update()` line 426-429 的 `for (const pt of PORTALS) { if (hypot(...)<2.6 && |dy|<4) { this.usePortal(pt); break; } }` **不受 busy 限制**（busy 只挡移动 ix/iz，player.ts:284-286），每帧重复调 `usePortal`，累积多个 `setTimeout` / toast / fade；`busyUntil = clock()+1000`（player.ts:455）只挡移动不挡该检测。
- **代码根因 B（重叠，设计取舍）**：`src/world.ts:1663-1670` 手动交互点（半径 5）直接 `this.player.actor.pos.set(0, UNDER.y, -130)`（＝`(0,-260,-130)`）；`src/game/player.ts:499-502` `PORTALS` 在 `(470,0,24)→[0,-260,-130]`、`(0,-260,-124)→[472,0,28]` 半径 2.6 每帧自动 `usePortal`。两者落点一致（`UNDER.y = -260`，`src/sky/underworld.ts:10`），走进 2.6m 会被自动传送、抢在按 E 之前 —— 「步入即传送」符合 `src/data/levelPlan.ts:37` yinyanggate objective「穿过阴阳界，进入地府」，属设计取舍。
- **最小修法**：`usePortal` 加 `portalLock` 标志或 `busyUntil` 期间跳过 player.ts:426-429 检测。
- **是否影响既有单测**：不影响。
- **验收断言**：触发 portal 后 460ms 内推进 30 帧 → `expect(toast 次数).toBe(1)` 且 `expect(传送落点).toEqual(单次目标)`。

---

## 二、【设计取舍非缺陷】（明确列出，供第 2 轮证伪时区分）
- `Karma.gain()` 降阶不广播 `karma:ascend`（`karma.ts:43` 只判 `after.index > beforeIndex`）—— 单向跃升语义；`penalty()` 不减 `byRealm` 诊断账（karma.ts:50-52）。
- `ArenaBoss.knockback()` 不复位 hp、脱战 2.5s 后 4%/s 回血（`boss.ts:162-168` 注释「不再一击满血」）—— 刻意难度设计；hp 用 `Math.max(0, hp-dmg)`(boss.ts:116) 与 `Math.min(maxHp, …)` 回血，Boss 血量**不会为负**。
- `Survival` hp/hunger 均 `Math.max(0,…)/Math.min(MAX,…)`（survival.ts:38-44, 63, 75-76），玩家血量**不会为负**；`onFaint` 同步 `revive()`（world.ts:851）使死亡无持续窗口，**不存在「死亡后仍可交互」**。
- `addPeach` 上限 9、超出丢弃并 toast（interact.ts:68-76）—— 三币律两位显示口径；P-03 是利用该上限却未回滚，才是缺陷。
- `show`/`song` 门票从 desc 文本 `parseInt`（world.ts:1538/1541）——「文案兼价目」的既有口径；S1~S5/M1~M4 的 desc 均含数字，兜底 `'5'`/`'2'` 不触发。
- `matchTemplate()` `src/game/creationTemplates.ts:341-346` 用 `text.includes(n)` 遍历 `names`，未匹配返回 `null` 且**在 `spend` 之前**（creation.ts:84-89），不会静默扣费；8 个模板 `scale` 为 0.6~1.2 正数（creationTemplates.ts:331-338），`placement` 有 `Number.isFinite(gy)` 兜底（`src/main.ts:60-61`），`hashText` 用 `Math.imul`（creation.ts:18-22），无除零/NaN/未定义 key 静默失败。
- **实现与设计不符（低，不单列缺陷）**：`buildTemplateGeo(t, seed)` `src/game/creationTemplates.ts:349-358` 的 `seed` 参数完全未参与几何生成（`t.build(g)` 决定几何，seed 未传入），几何只由模板决定 → `src/game/creation.ts:4-5` 注释「seed=hash(全文) → 程序化几何（同愿同物）」未兑现；`seed` 仅用于 `mesh.name`（creation.ts:114-116）与 `provenance.seed`（creation.ts:127）。属造物配方功能缺失，非崩溃型缺陷。
- **越界备注（交 core-expert，已由其核实为【确认缺陷】C14，本域不重复计数）**：`Survival.deserialize()` `src/game/survival.ts:96-102` 的 `this.fainted = this.hp <= 0;` 构成**生存状态机吸态**。确切触发路径（core-expert 核实）：`World.survival.onFaint` `src/world.ts:842-852` 中 `I.save()`（world.ts:846）排在 `this.survival.revive()`（world.ts:851）**之前**，晕倒瞬间 `hp=0` 经 `state()`/`serialize()`（`survival.ts:89-94`）写进档；读档 `deserialize` 预置 `fainted=true`，使 `tick()`（`survival.ts:46`）与 `damage()`（`survival.ts:64`）的 `hp<=0 && !fainted` 沿永久不触发，而清标志的 `revive()`（`survival.ts:55-59`）只由 world.ts:851 调用 → 闭环吸态。触发条件为「晕倒且 `penalty = Math.floor(coins*0.5) > 0`」（`world.ts:845-846` 仅 penalty>0 才 save），非假设。**准确表述是「生存状态机吸态 + 罚金 / 孟婆庄传送 / faints++ / hp 复位链永久失效」，不是「游戏卡死不能动」** —— `fainted` 为 private 且全仓只在 survival.ts 内被读，玩家输入不会被锁。core-expert 已新增 C14 并给验收单测。

---

## 三、单测覆盖缺口

现有 6 个玩法相关测试的实际覆盖：`tests/karma.test.ts` = `Karma` 类阈值/penalty/byRealm/序列化（6 条）；`tests/conditions.test.ts` = `evalConditions/topCondition` 纯函数（7 条）；`tests/shopInterior.test.ts` = 室内几何陈设；`tests/voxel.test.ts` = `VoxelStore` 数据层/序列化/存档 entities；`tests/p05-p06.test.ts` = `FixedStepLoop`/`LodManager`；`tests/entityRegistry.test.ts` = 底层实体表。**以下系统零单测覆盖**：

| 缺口系统 | 未覆盖的确认缺陷 | 建议补的断言 |
|---|---|---|
| `InteractSystem.openShop/openDice/openGomoku/addPeach/pay/refund` | P-01 / P-02 / P-03 / P-06 / P-11 | ①付费 `eat` 商品后 `hunger` 上升；②打开小吃摊面板不下单 `hunger/coins` 不变；③`peach=9,yinde=10` 买冥途牒全额回滚 `[coins,yinde,peach]`；④`coins=500,peach=1` 蟠桃赏赐后 `[600,0]` 且 `coins=0` 时仍可兑；⑤满盘 `aiMove` 不抛 |
| `BuildMode.place/breakBlock/materialStock` | P-04 | 100 轮「放→拆」后 `coins_after <= coins_before`、`materialStock` 不无界增长 |
| `ArenaBoss.playerAttack/knockback/syncHud` | P-05 / P-09 / P-12 | ①脱战/击败后 `#bossbar.style.opacity === '0'`；②`hp` 恒 `>= 0`；③`repeat:true` 的 KeyJ 不增 `hits`；④`mode='soul'` 时 `playerAttack()` 返回 `false` |
| `world` 三界动词接线（扛包 / 狱环 / havoc / onFaint） | P-07 / P-08 / P-09 | ①扛包后离场 8.2s `coins/karma` 不变；②人间灵魂模式推进 havoc 过 `pi=9` `karma` 不增；③Boss 命中后 `survival.hp` 按既定语义变化（或显式断言不扣血以固定语义，杜绝死代码悬空） |
| `world.tickObjectives/objectiveReached/nextObjective` | P-13 | `boss.defeated=true` 且玩家不在 jiangtai → `nextKey !== 'jiangtai'`；乱序完成 5 个地府节点后 `done/next` 不矛盾 |
| `CreationSystem.submit`（扣费/四门/退款/重演） | P-10 | mock 超预算 geo → `coins` 不变、`busy` 复位、可再次 submit |
| `PlayerController.usePortal` | P-14 | 460ms 淡出期推进 30 帧 → toast 仅 1 次、落点一致 |
| `Survival.tick/damage/eat/onFaint/revive` | P-01 / P-02 / P-09 + core-expert C14 | `damage()` 触发晕倒时 `faints++` 且 `onFaint` 恰好 1 次；`revive()` 后 `fainted === false`；**C14 吸态**：`deserialize({hp:0,hunger:50,faints:0,bossesDown:0})` → `tick(dt)` → 断言 `onFaint` 恰好触发 1 次（当前因 `fainted=true` 预置而永久不触发，会失败） |

**总评**：137 条既有单测集中在纯数据 / 几何 / 底层容器，玩法「按键 → 距离判定 → 条件判定 → 消耗/结算 → 反馈」链路、数值三处一致性、战斗死亡复活链、目标链状态机几乎全无覆盖；本次 **8 条【确认缺陷】均无测试兜底**。建议优先补 `InteractSystem` 与 `BuildMode` 两组（经济/生存闭环，回归风险最高）。所有修法均不改动 `Karma`/`conditions`/`VoxelStore`/`entity`/loop 的被测纯函数，**对既有 137 条断言无影响**。

---

## 四、跨领域叠加后果（与 core-expert / ui-perf-expert 交叉核对，不单列第 15 条）

### 4.1 存档写读不对称（根因归 core-expert C01/C02/C11/C12，本节只记玩法影响面）
核对结果：`InteractSystem.save()` `src/game/interact.ts:79-98` 写 `{ schemaVersion:2, economy:{coins,yinde,peach}, entities:[], voxel, survival, karma }`（interact.ts:87-94，其中 `karma: sv.karma ? sv.karma.current().karma : 0` 在 line 93，`entities` 恒 `[]` 在 line 90）；`World.init()` `src/world.ts:327-332` 读档只恢复 `interactPending = saved.economy`、`voxelStore.deserialize(saved.voxel)`、`this.survival.deserialize(saved.survival)` —— **`karma` 与 `entities` 写了不读**。`Karma.deserialize()` `src/game/karma.ts:59-61` 存在但 world 从未调用；`SaveDataV2` `src/rt/save.ts:50-51` 只有 `survival` 字段。`objectiveDone`(world.ts:241)、`codexLog`、`playerWeapon`(world.ts:299)、`creationCount`(world.ts:307) 均未入档。另 `interact.ts:87` `void W.__saveSave(...)` 无 `.catch`（异步 rejection 静默），`world.ts:772` 的 `__saveSave` 由异步 `open().then()` 注入而 `world.ts:838` 首次 `save()` 不等待它，存在竞态。

**对玩法结论的叠加影响（均不改动 14 条定性）**：
- **业力/六道阶位读档清零**：读档后 `Karma.karma = 0`、阶位回「人道」，而 HUD 阶位行（`ui.ts:421-425`）与 `karma:ascend` 广播都基于内存值。**P-08（havoc 自动 +8 业力挂机刷阶位）仅单会话有效、读档即归零** —— 这不是对 P-08 的证伪，反而说明业力轴的验收必须连存档一起测（建议补跨存档断言 `deserialize(serialize(k))` 后 `tier` 保持）。
- **目标进度 `objectiveDone` 未入档**：读档后目标链回 `0/17`（`LEVEL_TOTAL=17`，levelPlan.ts:92），与 P-13（jiangtai 判定只认内存 `boss.defeated`）叠加会让目标链整体重跑。
- **升级/图鉴状态未入档**：`playerWeapon`（钢刀 `mult:2.5` / 伏魔锏 `mult:4.0`，world.ts:1631 / 795）、`codexLog`、`creationCount` 读档后回初始（双拳 1.0 / 空 / 0）。

### 4.2 读档后 Boss 复活 + 跨会话防重失效 → 存读档刷 300 文 / 2 蟠桃（玩法经济后果，根因归存档）
**防重机制的精确表述（core-expert 修正，避免被「单会话内怎么没重复领」证伪）**：
- **单会话内防重有效**，靠 `ArenaBoss.defeated`（`src/game/boss.ts:36` 初始化 `false`；`boss.ts:108` `if (this.defeated || state==='dead' || 'respawning') return false;`；`boss.ts:128-130` `if (this.hp===0) { state='dead'; this.defeated=true; … this.onDefeat(); }`；`boss.ts:155` `if (this.defeated) return;`）。`onDefeat` 每次会话最多触发一次。
- `src/world.ts:786` 的 `if (!this.codexLog.some(e => e.code === JULING.code))` **只包住 `codexLog.push`**（`world.ts:787`），`addPeach(2)/earn(300)/playerWeapon/bossReward()`（`world.ts:792-798`）**在 if 之外**，本就无条件执行 —— 它们依赖的是「`onDefeat` 只被调一次」，而非 codexLog。
- 因此**跨会话的「已伏誅」意图防重靠 `codexLog`，但 codexLog 未入档故失效**；`ArenaBoss` 在载入链「神佛就位」步每次 `new`（`src/world.ts:778-801`）→ `defeated=false`（boss.ts:36）、`hp=spec.maxHp`（boss.ts:71，JULING `maxHp=320`，`src/data/boss.ts:38`）。

**后果**：读档后 Boss 复活、`defeated` 守卫重置、codexLog 防重失效 → 可再次击杀再领一次 `addPeach(2)` + `earn(300)` + `playerWeapon={mult:4.0}` + `bossReward()`（`src/world.ts:792-798`）。`earn(300)` 会 `this.save()`（`interact.ts:62`）把 +300 落盘。净效果 = **反复存读档可刷 `+300 文 + 2 蟠桃`/轮**，且 `survival.bossesDown` 因 `survival` 入档而持续累加（`survival.ts:82`）。结论（读档可反复刷）不变。
登记：core-expert 已按联合口径登记（根因归 C01、经济后果归 P-09 联合），**本域不单列第 15 条、不重复报存档根因**。
验收断言：`击杀 → 存档 → 重开 → 再击杀` 后断言第二次 `coins` 不再 `+300`（当前会失败）；读档后 `codexLog` 为空（当前为 0 条而非 1 条），亦可断言「读档后图鉴无 `juling` 记录」以暴露 codexLog 未入档。

### 4.3 与 ui-perf-expert 的联合结论（Boss 血条常驻）
P-05（状态机，`boss.ts:244-245` + `boss.ts:169-216` 无 `state='idle'` 回赋值 + `boss.ts:155` defeated 后 return）与 UI-01（`mountHud()` `boss.ts:219-239` 挂 `document.body`/`z-index:30`，不在 `#ui` 层）、UI-02（显隐条件）根因一致，第 2 轮合并为一条「Boss 血条常驻」联合结论，各自保留 file:line。已明确回复：**「不回 idle」不是有意设计，是确认缺陷**，UI-02 保持【确认缺陷】不下调（三条内证见 P-05）。玩法侧修法口径：脱战 `!defeated && d > engageRange(34) && outT > 2.5` 时 `state='idle'` + `syncHud()`，同时停掉招式空转。

### 4.4 与 motion-expert 的边界
- `applyDisorient()`（`player.ts:115-121`）无调用 = P-09 旁证 = **M-04 同一事实**，定性一致【确认缺陷】，**以 M-04 为准不重复计数**；运动侧精确修法见 P-09 旁证段（叠加式 `speedScale = slowScale * disorientScale` + `duration=6` 衰减 + `disorientJitter`/`fadeHint` 接线，因 `world.ts:1466` 每帧无条件覆盖 `speedScale`）。
- P-12（`KeyJ` 无 `ev.repeat` 过滤 `ui.ts:83-87`、`boss.playerAttack()` 无 `mode` 检查 `boss.ts:107`）属玩法/输入层，本域出条、motion-expert 不重复；其作为 **M-07 旁证**（同一动作多套入口、状态门不一致）。
- 本域只报「未接线 / 状态门不一致」事实，运动效果实现归 motion-expert 定性。
