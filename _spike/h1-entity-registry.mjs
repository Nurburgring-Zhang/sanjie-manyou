// ============================================================================
// H1 spike · 实体身份原型（纯 Node，不 import src/ 的 TS —— 避免编译耦合）
//
// 回答的问题（docs/重建-v2/全量工作清单.md H1 行）：
//   「实体身份：三套结构能否共用一套 id」—— P0-1 实体表实施前的可行性验证。
// 设计依据：docs/重建-v2/spec/P0-1-实体表.md（id 单调永不复用 / pos 权威位置 /
//   onDispose 逆序 / dispose 幂等返回 false / entityStats 诊断）。
//
// 运行：node _spike/h1-entity-registry.mjs   （全绿 exit 0，任一红 exit 1）
// 确定性：无 Math.random / 无 Date.now / 无宿主时钟 —— 同输入恒同输出（ADR-3）。
// ============================================================================

// ---- 与 P0-1 §2 对齐的常量与类型（JS 版） ---------------------------------

const NONE_ENTITY = 0; // 0 恒为无效 id（P0-1 §2）

const ENTITY_KINDS = ['npc', 'beast', 'creation', 'block', 'building', 'prop', 'fx'];

// ---- EntityRegistry（P0-1 §3 API 契约的 JS 原型） --------------------------
//
// 语义要点（全部按 spec）：
//  * id 由**注册表独家**发放：从 1 起，单调递增，永不回收、永不复用。
//    （crowd.ts 现状是每个 Crowd 实例 idSeq 从 1 重发号，读档即串号 —— 见集成映射。
//     本原型把发号权收归注册表，正是对那一 bug 类的修复演示。）
//  * dispose 只做逻辑注销：先置 alive=false 并移出索引，**再**按逆序跑 onDispose
//    —— 保证「可从 onDispose 内重入」而不死循环/不双跑。
//  * 全部运行时错误走返回值，不抛异常（抛异常会中断帧）。
class EntityRegistry {
  #nextId = 1;                     // 发号器：只增不减
  #byId = new Map();               // id -> EntityRecord（只含存活实体）
  allocated = 0;                   // 历史发放总数（只增）
  disposed = 0;                    // 历史注销总数（只增）
  lastDisposeReason = null;        // 最近一次注销原因（诊断）

  /** 发放 id 并建记录。kind 非法是编程错误（TS 里由联合类型编译期拦，这里运行期拦）。 */
  allocate(kind, init = {}) {
    if (!ENTITY_KINDS.includes(kind)) {
      throw new TypeError(`allocate: 非法 kind "${kind}"（合法：${ENTITY_KINDS.join('|')}）`);
    }
    const id = this.#nextId++;
    this.allocated++;
    const rec = {
      id,
      kind,
      object3d: init.object3d ?? null,          // null = 纯逻辑实体（碰撞体/烘焙静态件）
      pos: { x: init.pos?.x ?? 0, y: init.pos?.y ?? 0, z: init.pos?.z ?? 0 }, // 权威位置
      collider: init.collider,                  // 组件槽：P0-3 挂，未挂即 undefined
      behavior: init.behavior,                  // 组件槽：按需挂
      persist: init.persist ?? false,
      provenance: init.provenance ?? null,
      onDispose: [],                            // 注销回调，**按注册逆序调用**
      alive: true,
    };
    this.#byId.set(id, rec);
    return id;
  }

  /** 存活记录；get(0) / get(未分配) / get(已注销) 一律 undefined。 */
  get(id) {
    if (id === NONE_ENTITY) return undefined;
    return this.#byId.get(id);
  }

  alive(id) {
    const r = this.#byId.get(id);
    return r !== undefined && r.alive;
  }

  /**
   * 逻辑注销：置 alive=false → 移出索引 → 逆序跑 onDispose。
   * 幂等：已注销再 dispose 返回 false，不报错、不重跑回调。可从 onDispose 内重入。
   */
  dispose(id, reason = 'unspecified') {
    const rec = this.#byId.get(id);
    if (!rec || !rec.alive) return false;           // 幂等出口
    rec.alive = false;                              // 先判死，重入时上面一行就拦住
    this.#byId.delete(id);                          // 移出索引：get/alive/forEach 立刻不可见
    this.disposed++;
    this.lastDisposeReason = reason;
    for (let i = rec.onDispose.length - 1; i >= 0; i--) rec.onDispose[i](); // 逆序
    return true;
  }

  /** 按 kind 遍历（不含已 dispose 的）。for..of 直接走 Map 迭代器，不建临时数组。 */
  forEach(kind, fn) {
    for (const rec of this.#byId.values()) {
      if (rec.kind === kind && rec.alive) fn(rec);
    }
  }

  /** 诊断快照：纯函数 —— 不改任何内部状态，同输入两次调用逐值一致。 */
  entityStats() {
    const byKind = {};
    for (const rec of this.#byId.values()) byKind[rec.kind] = (byKind[rec.kind] ?? 0) + 1;
    return { alive: this.#byId.size, allocated: this.allocated, disposed: this.disposed, byKind };
  }

  /** 当前发号器水位（读档/迁移时校验「不复用」用；只读）。 */
  get watermark() { return this.#nextId - 1; }
}

// ---- 微型断言工具 -----------------------------------------------------------

let passCount = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  PASS  ${name}`); }
  else { failCount++; console.log(`  FAIL  ${name}${detail ? ' —— ' + detail : ''}`); }
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ============================================================================
// 五条断言自证（任务指定的 ①–⑤）
// ============================================================================

console.log('== 断言组 A：EntityRegistry 语义（P0-1 §2/§3 契约） ==');

// --- ① id 单调递增、永不复用 -------------------------------------------------
{
  const reg = new EntityRegistry();
  const ids = [];
  for (let i = 0; i < 10000; i++) ids.push(reg.allocate('npc'));
  const strictlyIncreasing = ids.every((v, i) => i === 0 || v === ids[i - 1] + 1);
  const noZero = ids[0] === 1; // NONE_ENTITY=0 永不发放
  const uniqueLen = new Set(ids).size === 10000;
  // 全部注销后再发放：新 id 必须全部越过历史最高水位（旧存档引用绝不指向新对象）
  const maxOld = ids[ids.length - 1];
  for (const id of ids) reg.dispose(id, 'test');
  const fresh = [];
  for (let i = 0; i < 50; i++) fresh.push(reg.allocate('npc'));
  const aboveWatermark = fresh.every((v) => v > maxOld);
  const stillUnique = new Set([...ids, ...fresh]).size === 10050;
  check('①a 10000 个 id 严格递增且唯一、首 id=1（0 恒无效）',
    strictlyIncreasing && noZero && uniqueLen);
  check('①b 注销全部后再分配：新 id 全部高于历史水位且与旧 id 无一重复',
    aboveWatermark && stillUnique);
}

// --- ② 分配 10000 → 全部注销 → alive===0 --------------------------------------
{
  const reg = new EntityRegistry();
  const kinds = ['npc', 'beast', 'creation', 'block', 'building', 'prop', 'fx'];
  const ids = [];
  for (let i = 0; i < 10000; i++) ids.push(reg.allocate(kinds[i % kinds.length]));
  const before = reg.entityStats();
  check('②a 分配后 alive===10000', before.alive === 10000, `got ${before.alive}`);
  for (const id of ids) reg.dispose(id, 'bulk');
  const after = reg.entityStats();
  check('②b 全部注销后 alive===0 且 disposed===10000',
    after.alive === 0 && after.disposed === 10000,
    `alive=${after.alive} disposed=${after.disposed}`);
}

// --- ③ onDispose 逆序执行（P0-1 A6 的纯逻辑部分） -----------------------------
{
  const reg = new EntityRegistry();
  const order = [];
  const id = reg.allocate('creation');
  reg.get(id).onDispose.push(() => order.push(1));
  reg.get(id).onDispose.push(() => order.push(2));
  reg.get(id).onDispose.push(() => order.push(3));
  // 模拟真实依赖链：晚注册的（如 LOD/物理摘除）先拆，早注册的（mesh 创建）后拆
  reg.dispose(id, 'order-test');
  check('③a 三个回调按 3→2→1 逆序执行', deepEqual(order, [3, 2, 1]), `got ${order}`);
  // 重入：onDispose 内再 dispose 同一 id 必须被幂等拦住，不双跑、不递归
  const reentrant = new EntityRegistry();
  let runs = 0;
  const id2 = reentrant.allocate('npc');
  reentrant.get(id2).onDispose.push(function () {
    runs++;
    if (runs < 5) reentrant.dispose(id2, 'reentry'); // 故意重入
  });
  const first = reentrant.dispose(id2, 'outer');
  check('③b onDispose 内重入 dispose 同一 id：回调只跑一次且重入返回 false',
    first === true && runs === 1 && reentrant.dispose(id2) === false, `runs=${runs}`);
}

// --- ④ entityStats() 纯函数：同输入两次逐值一致 -------------------------------
{
  const reg = new EntityRegistry();
  // 混合人群：多 kind、部分注销 —— 构成一个非平凡的稳定状态
  const keep = [];
  for (let i = 0; i < 400; i++) keep.push(reg.allocate(['npc', 'block', 'creation'][i % 3]));
  for (let i = 0; i < 120; i++) reg.dispose(reg.allocate('fx'), 'churn'); // 发了又拆
  const s1 = reg.entityStats();
  const s2 = reg.entityStats();
  check('④a 两次调用逐值一致（含 byKind 全字段）', deepEqual(s1, s2),
    `${JSON.stringify(s1)} vs ${JSON.stringify(s2)}`);
  // 且数值自洽：alive + disposed === allocated，alive === byKind 求和
  const byKindSum = Object.values(s1.byKind).reduce((a, b) => a + b, 0);
  check('④b 数值自洽：alive+disposed===allocated 且 alive===byKind 合计',
    s1.alive + s1.disposed === s1.allocated && byKindSum === s1.alive,
    `stats=${JSON.stringify(s1)} byKindSum=${byKindSum}`);
  // forEach 计数与 byKind 一致（消费端读到的和诊断端一致）
  let nCreation = 0;
  reg.forEach('creation', () => nCreation++);
  check('④c forEach(kind) 计数 === byKind[kind]', nCreation === s1.byKind.creation);
}

// --- ⑤ 注销后再次 dispose 同一 id：幂等 no-op，不抛错 -------------------------
{
  const reg = new EntityRegistry();
  let runs = 0;
  const id = reg.allocate('npc');
  reg.get(id).onDispose.push(() => runs++);
  const r1 = reg.dispose(id, 'once');
  let threw = false;
  let r2 = false, r3 = false;
  try { r2 = reg.dispose(id, 'again'); r3 = reg.dispose(id, 'third'); }
  catch { threw = true; }
  check('⑤a 三连 dispose 返回 true,false,false，不抛错',
    r1 === true && r2 === false && r3 === false && !threw,
    `r=${r1},${r2},${r3} threw=${threw}`);
  check('⑤b 幂等不重跑回调（回调计数仍为 1）且 get===undefined、alive===false',
    runs === 1 && reg.get(id) === undefined && reg.alive(id) === false);
  // get(0) / get(未分配) 边界（P0-1 §3 错误码表）
  check('⑤c get(0) 与 get(未分配) 返回 undefined',
    reg.get(0) === undefined && reg.get(999999) === undefined);
}

// ============================================================================
// 集成模拟（H1 的核心问题：三套结构共用一套 id）
// 按 _spike/h1-integration-map.md 的接入方式做等比缩小的行为演示：
//   crowd Actor → kind 'npc'，注册表发号，crowd 采纳该 id；
//   静态烘焙件(b.kit 台账) → kind 'block'，object3d=null 的纯逻辑实体 + collider 槽；
//   physics 引用持有（launches/respawn/碰撞索引）→ 挂 onDispose 在注销时摘除。
// ============================================================================

console.log('== 断言组 B：三套结构共用一套 id（集成模拟） ==');
{
  const reg = new EntityRegistry();

  // 模拟 physics.ts 的 ImpactSystem：Map 以**对象引用**为键（现状），另有一个碰撞索引
  const launches = new Map();        // actorRef -> state（现状写法）
  const colliderIndex = new Map();   // entityId -> collider（P0-3 目标写法）

  // 模拟 crowd.spawnActor：对象出生 → allocate('npc') → crowd 采纳注册表 id
  function spawnNpc(x, z) {
    const entityId = reg.allocate('npc', { pos: { x, y: 0, z }, persist: true });
    const actor = { id: entityId, pos: { x, y: 0, z }, hidden: false }; // Actor 采纳外部 id
    // 模拟 P0-3：出生即挂 collider，onDispose 负责从物理索引摘除
    reg.get(entityId).collider = { kind: 'capsule', params: { r: 0.35, h: 1.7 } };
    colliderIndex.set(entityId, reg.get(entityId).collider);
    reg.get(entityId).onDispose.push(() => colliderIndex.delete(entityId));
    return actor;
  }

  // 模拟烘焙静态件（b.kit 台账里的 'roof.eaveTrim' 一类）：无独立 object3d，纯逻辑实体
  function addBakedBlock(name, x, y, z) {
    const id = reg.allocate('block', {
      object3d: null, pos: { x, y, z },
      collider: { kind: 'box', params: { hx: 2, hy: 1, hz: 2 } },
    });
    colliderIndex.set(id, reg.get(id).collider);
    return id;
  }

  // 造 5 个 npc + 3 个烘焙静态件；玩家击飞其中一个 npc（launches 以引用为键）
  const npcs = [];
  for (let i = 0; i < 5; i++) npcs.push(spawnNpc(i * 2, i * 3));
  const blocks = [];
  for (let i = 0; i < 3; i++) blocks.push(addBakedBlock('roof.eaveTrim', i, 6, i));
  launches.set(npcs[2], { vx: 1, until: 99 });
  check('B1 三套结构同表共存：alive===8，byKind 分账正确',
    reg.entityStats().alive === 8 && reg.entityStats().byKind.npc === 5 && reg.entityStats().byKind.block === 3,
    JSON.stringify(reg.entityStats()));

  // 注销被击碎的 npc：逻辑注销 + 逆序回调同步摘除物理索引（launches 由宿主另清，见映射风险）
  reg.dispose(npcs[2].id, 'shatter');
  check('B2 dispose 后：注册表 get===undefined、碰撞索引同步摘除、其余 7 个不受影响',
    reg.get(npcs[2].id) === undefined && !colliderIndex.has(npcs[2].id) && reg.entityStats().alive === 7);

  // 模拟读档：旧 crowd 实例整个丢弃、新建实例 —— crowd 自身 idSeq 会从 1 重发号，
  // 而注册表水位继续走，新批次 id 绝不与旧批次撞（BEAST_IDS 串号 bug 类的修复演示）
  const watermarkBefore = reg.watermark;
  const reloadedNpc = spawnNpc(100, 100); // 新 crowd 实例仍走同一个注册表
  check('B3 读档重建 crowd 后：注册表发号越过旧水位，不复用任何旧 id',
    reloadedNpc.id > watermarkBefore && reg.alive(reloadedNpc.id));

  // 物理查询端（P0-2 的 groundHeight/碰撞遍历形态）：只从表里读，不维护自己的数组
  let colliderCount = 0;
  reg.forEach('block', () => colliderCount++);
  reg.forEach('npc', (e) => { if (e.collider) colliderCount++; });
  check('B4 物理端从表内遍历 collider：数量 === 3 block + 5 活 npc = 8（含 B3 读档新 npc）',
    colliderCount === 8 && colliderIndex.size === 8, `count=${colliderCount} idx=${colliderIndex.size}`);
}

// ============================================================================
// 汇总
// ============================================================================

console.log('== 汇总 ==');
console.log(`  PASS ${passCount} / FAIL ${failCount}`);
const stats = { prototype: 'h1-entity-registry', pass: passCount, fail: failCount };
console.log(`  ${JSON.stringify(stats)}`);
if (failCount > 0) process.exit(1);
console.log('H1 prototype: ALL GREEN');
