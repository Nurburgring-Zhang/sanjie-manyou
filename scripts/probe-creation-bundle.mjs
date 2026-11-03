/**
 * probe-creation-bundle.mjs —— ADR-8「四道预算门 + 交互四声明」的校验器（纯 Node）。
 *
 * 这是「许愿造物」链路里第一段真实可运行的代码：不管 build.ts 由谁写、在哪个沙箱跑，
 * 产物都必须过这里，否则不进游戏。
 *
 * 用法：
 *   node scripts/probe-creation-bundle.mjs --self-test            # 用合成样本自证判据会红会绿
 *   node scripts/probe-creation-bundle.mjs --file path/to.json    # 校验真实产物
 *
 * 退出码：0 = 全部通过；1 = 有拒收项；2 = 用法错误
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const MAX_TRIS = 20000;
const MAX_EDGE_M = 200;
const MAX_BYTES = 8 * 1024 * 1024;
const MATERIALS = new Set(['wood', 'wall', 'roof', 'ash', 'earth', 'ground', 'glow', 'leaf', 'trunk', 'water', 'ceramic', 'metal', 'fabric', 'lacquer']);
const VERBS = new Set(['骑', '采集', '对话', '攻击', '无']);
const BEHAVIORS = new Set(['static', 'patrol', 'follow', 'fly', 'swim']);
const COLLIDERS = new Set(['capsule', 'box', 'sphere', 'mesh']);

const b64len = (s) => (typeof s === 'string' ? Math.floor((s.length * 3) / 4) : 0);

/** 从 base64 的 Float32 positions 求包围盒（不解全部，只取首尾抽样 + 全量若不大） */
function bboxOf(positionsB64) {
  if (typeof positionsB64 !== 'string' || positionsB64.length === 0) return null;
  const buf = Buffer.from(positionsB64, 'base64');
  const n = Math.floor(buf.length / 4);
  if (n < 3) return null;
  const f = new Float32Array(buf.buffer, buf.byteOffset, n);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < f.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = f[i + k];
      if (!Number.isFinite(v)) return { bad: true };
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return { mn, mx, maxEdge: Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) };
}

export function validate(b) {
  const fail = [];
  if (!b || typeof b !== 'object') return ['不是对象'];
  if (b.schema !== 'creation/1') fail.push(`schema 必须是 creation/1，实际 ${b.schema}`);
  if (!b.id || typeof b.id !== 'string') fail.push('缺 id');
  if (typeof b.seed !== 'number') fail.push('缺 seed（确定性必需）');
  if (typeof b.modelVersion !== 'string' || !b.modelVersion) fail.push('缺 modelVersion（可重放必需）');
  if (typeof b.hash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(b.hash)) fail.push('hash 必须是 sha256:<64 hex>');

  // 材质白名单
  const mats = Array.isArray(b.materials) ? b.materials : [];
  if (mats.length === 0) fail.push('materials 不能为空');
  for (const m of mats) if (!MATERIALS.has(m)) fail.push(`材质组不在 14 组内: ${m}`);

  // 门 1：面数
  const idx = b.geometry?.indices;
  const tris = typeof b.budget?.tris === 'number' ? b.budget.tris : idx ? Math.floor(b64len(idx) / 3) : NaN;
  if (!Number.isFinite(tris)) fail.push('拿不到三角面数（budget.tris 与 indices 都缺）');
  else if (tris > MAX_TRIS) fail.push(`面数 ${tris} > ${MAX_TRIS}`);

  // 门 2：包围盒
  const bb = bboxOf(b.geometry?.positions);
  if (bb?.bad) fail.push('positions 含 NaN/Infinity');
  else if (bb && bb.maxEdge > MAX_EDGE_M) fail.push(`包围盒最大边 ${bb.maxEdge.toFixed(1)}m > ${MAX_EDGE_M}m`);

  // 门 3：内存
  const bytes =
    typeof b.budget?.bytes === 'number'
      ? b.budget.bytes
      : ['positions', 'normals', 'colors', 'indices'].reduce((s, k) => s + b64len(b.geometry?.[k]), 0);
  if (bytes > MAX_BYTES) fail.push(`几何字节 ${(bytes / 1048576).toFixed(2)}MB > 8MB`);

  // 门 4：确定性（本校验器只能查「有没有声明」，真正逐字节一致要靠生成端复跑）
  if (!Number.isFinite(b.seed)) fail.push('确定性门：缺 seed，无法复跑');

  // 交互四声明
  const c = b.collider;
  if (!c) fail.push('缺 collider 声明');
  else if (!COLLIDERS.has(c.kind)) fail.push(`collider.kind 非法: ${c.kind}`);
  const it = b.interact;
  if (!it) fail.push('缺 interact 声明');
  else {
    if (!VERBS.has(it.verb)) fail.push(`interact.verb 非法: ${it.verb}`);
    if (!(typeof it.range === 'number' && it.range >= 0)) fail.push('interact.range 非法');
  }
  const bh = b.behavior;
  if (!bh) fail.push('缺 behavior 声明');
  else if (!BEHAVIORS.has(bh.kind)) fail.push(`behavior.kind 非法: ${bh.kind}`);
  const lc = b.lifecycle;
  if (!lc) fail.push('缺 lifecycle 声明');
  else if (typeof lc.persist !== 'boolean') fail.push('lifecycle.persist 必须是布尔');

  return fail;
}

/** 合成样本：一具 12 面（8 顶点立方体）的"龙" */
function makeBundle(over = {}) {
  const verts = 8;
  const pos = new Float32Array(verts * 3);
  const e = 0.5;
  let i = 0;
  for (const x of [-e, e]) for (const y of [-e, e]) for (const z of [-e, e]) { pos[i++] = x; pos[i++] = y; pos[i++] = z; }
  const idx = new Uint32Array([0,1,2,1,3,2, 4,6,5,5,6,7, 0,2,4,2,6,4, 1,5,3,3,5,7, 0,4,1,1,4,5, 2,3,6,3,7,6]);
  const positions = Buffer.from(pos.buffer).toString('base64');
  const indices = Buffer.from(idx.buffer).toString('base64');
  const body = {
    schema: 'creation/1',
    id: 'gen_test_0001',
    prompt: '一条小龙',
    seed: 20261103,
    modelVersion: 'stub/0',
    geometry: { positions, indices },
    materials: ['metal', 'glow'],
    collider: { kind: 'capsule', params: { r: 1.2, h: 6 } },
    interact: { verb: '骑', range: 3 },
    behavior: { kind: 'fly', params: { speed: 6 } },
    lifecycle: { persist: true },
    budget: { tris: 12, bytes: b64len(positions) + b64len(indices) },
  };
  const hash = 'sha256:' + createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, hash, ...over };
}

function selfTest() {
  let ok = true;
  const t = (name, bundle, wantPass) => {
    const f = validate(bundle);
    const got = f.length === 0;
    const hit = got === wantPass;
    if (!hit) ok = false;
    console.log(`${hit ? 'OK  ' : 'FAIL'} ${name}: ${got ? 'PASS' : 'BLOCK'}${got ? '' : ' ← ' + f.slice(0, 3).join('; ')}`);
  };
  t('正常立方体龙', makeBundle(), true);
  t('面数超限', makeBundle({ budget: { tris: 20001, bytes: 100 } }), false);
  t('材质越界', makeBundle({ materials: ['rainbow'] }), false);
  t('没 interact', makeBundle({ interact: undefined }), false);
  t('verb 非法', makeBundle({ interact: { verb: '唱歌', range: 3 } }), false);
  t('没 seed', makeBundle({ seed: undefined }), false);
  t('hash 格式错', makeBundle({ hash: 'md5:abc' }), false);
  t('persist 非布尔', makeBundle({ lifecycle: { persist: 'yes' } }), false);

  // NaN 检测
  const nan = new Float32Array([NaN, 0, 0, 0, 0, 0, 0, 0, 0]);
  t('positions 含 NaN', makeBundle({ geometry: { positions: Buffer.from(nan.buffer).toString('base64'), indices: makeBundle().geometry.indices } }), false);

  console.log(ok ? 'SELF_TEST=PASS' : 'SELF_TEST=FAIL');
  return ok ? 0 : 1;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('probe-creation-bundle.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const i = process.argv.indexOf('--file');
  if (i < 0) {
    console.error('USAGE: --self-test | --file <bundle.json>');
    process.exit(2);
  }
  const p = process.argv[i + 1];
  if (!existsSync(p)) {
    console.error('找不到 ' + p);
    process.exit(2);
  }
  const fails = validate(JSON.parse(readFileSync(p, 'utf8')));
  if (fails.length) {
    for (const f of fails) console.log('BLOCK ' + f);
    console.log('RESULT=BLOCK');
    process.exit(1);
  }
  console.log('RESULT=PASS');
}
