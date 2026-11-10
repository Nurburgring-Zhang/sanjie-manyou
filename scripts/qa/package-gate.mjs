/**
 * QA-001：干净屋打包门。任一阶段 FAIL 即终止并打印 FAIL:<阶段>。
 *
 *   node scripts/qa/package-gate.mjs --candidate <候选交付包.zip|目录> [--milestone M1]
 *                                    [--skip-npm-ci] [--self-test] [--verify-pack]
 *
 * 13 个主阶段严格按 spec QA-001 R1；另有 4 项 additionalChecks（QA-002/005/007 的机检）。
 * M1 阶段：属 M3 的门（FIX-005 / QA-003 / QA-006）以 --report-only 运行并标 DEFERRED，
 *          **不通过豁免把红变绿**，DEFERRED 与 PASS 分账，绝不混算。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const getArg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CANDIDATE = getArg('--candidate');
const MILESTONE = getArg('--milestone', 'M1');
const SKIP_NPM_CI = argv.includes('--skip-npm-ci');
const SELF_TEST = argv.includes('--self-test');
const VERIFY_PACK = argv.includes('--verify-pack');
const OFFLINE = argv.includes('--offline');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (p) => sha(fs.readFileSync(p));
const posix = (p) => p.replace(/\\/g, '/');

// 候选为 ZIP 时记录实际使用的解压器与中文名完整性校验结果（QA-001 如实披露）。
// 目录候选不解压，保持 'directory-copy'。
let EXTRACTOR = 'directory-copy';
let ZH_NAMES_OK = null;

// 跳过所有 release* 构建目录（release / release-v63 / release-r28-csp …）。
// 这些目录里的 win-unpacked/resources/app.asar 有数百 MB，误复制进干净屋会直接
// 把系统临时盘打满（ENOSPC，实测），且与候选交付包内容无关。
const DEFAULT_SKIP = (n) => n === 'node_modules' || n === '.git' || n === '.gate-dist'
  || /^release(?:[-_.]|$)/.test(n);

function listFiles(dir, skip = DEFAULT_SKIP) {
  const out = [];
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip(e.name)) continue;
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** 候选目录树 sha：路径 + 内容摘要拼接，用于防「gate 过了又改文件」 */
export function treeSha(dir) {
  const h = crypto.createHash('sha256');
  for (const f of listFiles(dir)) { h.update(f + '\0'); h.update(fileSha(path.join(dir, f)) + '\0'); }
  return h.digest('hex');
}

function resolveExe(name, cwd) {
  // 干净屋里没有可执行的 node.cmd（Windows 实测：'node.cmd' 不是内部或外部命令）。
  // 直接用当前进程的 Node 解释器绝对路径，避免依赖 PATH / .cmd shim。
  if (name === 'node') return { exe: process.execPath, pre: [], shell: false };
  const local = {
    tsc: 'node_modules/typescript/bin/tsc',
    vitest: 'node_modules/vitest/vitest.mjs',
    vite: 'node_modules/vite/bin/vite.js',
  }[name];
  if (local && fs.existsSync(path.join(cwd, local))) return { exe: process.execPath, pre: [path.join(cwd, local)], shell: false };
  return { exe: process.platform === 'win32' ? `${name}.cmd` : name, pre: [], shell: process.platform === 'win32' };
}

function run(name, args, cwd, timeout = 600000) {
  const r = resolveExe(name, cwd);
  const out = spawnSync(r.exe, [...r.pre, ...args], {
    cwd, encoding: 'utf8', timeout, shell: r.shell,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(OFFLINE ? { npm_config_offline: 'true' } : {}) },
  });
  return { rc: out.status ?? 1, stdout: out.stdout || '', stderr: out.stderr || '', error: out.error?.message || '' };
}

function node(script, args, cwd, timeout = 180000) {
  return run('node', [path.join(cwd, script), ...args], cwd, timeout);
}

/** 阶段 5：逐文件 sha 比对 */
function compareDirs(a, b) {
  const fa = listFiles(a), fb = listFiles(b);
  const sa = new Set(fa), sb = new Set(fb);
  const missing = fb.filter((f) => !sa.has(f));
  const extra = fa.filter((f) => !sb.has(f));
  const changed = fa.filter((f) => sb.has(f) && fileSha(path.join(a, f)) !== fileSha(path.join(b, f)));
  return { ok: !missing.length && !extra.length && !changed.length, files: fa.length, missing, extra, changed };
}

/** 阶段 13：SHA 台账对账 */
function checkShaLedger(root) {
  const dir = path.join(root, 'artifacts');
  const led = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^DELIVERY-R\d+-SHA256\.txt$/.test(f)) : [];
  if (!led.length) return { ok: null, reason: '无 DELIVERY-R*-SHA256.txt，SKIPPED（如实披露）' };
  const p = path.join(dir, led[0]);
  const entries = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    // 台账格式（沿用 R23–R28）：`<sha256>  <相对路径>  <字节数>`，两空格分隔。
    // 兼容两列（无 size）形态；首行是注释，自然被 hash 校验排除。
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length >= 2 && /^[a-f0-9]{64}$/.test(parts[0])) {
      entries.set(parts[1].replace(/\\/g, '/'), parts[0]);
    }
  }
  const actual = new Map(listFiles(root).map((f) => [f, fileSha(path.join(root, f))]));
  const missing = [...entries.keys()].filter((f) => !actual.has(f));
  const mismatch = [...entries.keys()].filter((f) => actual.has(f) && actual.get(f) !== entries.get(f));
  // 台账自身不给自己算哈希；artifacts/spec/ 是 gate 运行期证据目录，允许后写
  const extra = [...actual.keys()].filter((f) =>
    !entries.has(f) && f !== `artifacts/${led[0]}` && !f.startsWith('artifacts/spec/'));
  return { ok: !missing.length && !mismatch.length && !extra.length, ledger: led[0], total: entries.size, missing, mismatch, extra: extra.slice(0, 20) };
}

function prepare() {
  if (!CANDIDATE) { console.error('FAIL: 需要 --candidate <zip|目录>'); process.exit(2); }
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-gate-'));
  const abs = path.resolve(CANDIDATE);
  if (fs.statSync(abs).isDirectory()) {
    // 目录候选：复制到干净屋（不含 node_modules / release*），保证 gate 不直接改工作副本
    fs.mkdirSync(clean, { recursive: true });
    try {
      for (const f of listFiles(abs)) {
        const dst = path.join(clean, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(abs, f), dst);
      }
    } catch (e) {
      try { fs.rmSync(clean, { recursive: true, force: true }); } catch {}
      throw e;
    }
  } else {
    // 【QA-001 实测缺陷整改】ZIP 解压必须 UTF-8 感知。
    // Windows Git Bash 自带的 Info-ZIP `unzip 6.00` 不识别 ZIP general-purpose bit 11
    // （UTF-8 文件名标志），会把中文名按本地代码页解码成乱码：
    //   docs/assets/45-人间建筑材质逐座全表.md → 45-õ¦¦Úù¦Õ+¦þ¡æµØÉ...md
    // 实测后果：S06 atoms:rebuild 里 docs.get('45-人间建筑材质逐座全表.md') 返回
    // undefined，.split() 抛错，干净屋直接 FAIL；而 S03/S04/S05 因不读中文名文档
    // 反而全绿 —— 属于「工具链乱码被静默放过」的典型 fail-open。
    // 交付包本身是标准 UTF-8 ZIP（Python zipfile / 7-Zip / WinRAR / Windows 资源管理器
    // 均能正确还原），故优先使用 UTF-8 感知的 Python zipfile，并强制校验中文名。
    const pyExtract = [
      'import sys,zipfile',
      'z=zipfile.ZipFile(sys.argv[1])',
      'z.extractall(sys.argv[2])',
      'print("entries=%d" % len(z.infolist()))',
    ].join('\n');
    let r = spawnSync('python', ['-c', pyExtract, posix(abs), posix(clean)],
      { encoding: 'utf8', timeout: 300000 });
    EXTRACTOR = 'python-zipfile(UTF-8 aware)';
    if (r.status !== 0) {
      // Python 不可用 → 回退 Info-ZIP unzip，但中文名完整性校验不豁免（fail-closed）
      r = spawnSync('unzip', ['-q', posix(abs), '-d', posix(clean)],
        { encoding: 'utf8', timeout: 300000 });
      EXTRACTOR = 'infozip-unzip(fallback; UTF-8 names NOT guaranteed)';
    }
    if (r.status !== 0) {
      console.error('FAIL:prepare extract: ' + (r.stderr || r.error?.message || 'unknown'));
      process.exit(1);
    }
    // 中文名完整性硬校验：解压后必须能在预期位置找到真实中文名文件。
    // 乱码目录即使存在也过不了这一关，绝不把工具链缺陷混算为绿。
    const probeRoot = (() => {
      const top = fs.readdirSync(clean, { withFileTypes: true });
      const ds = top.filter((e) => e.isDirectory() && e.name !== '__MACOSX');
      return !top.some((e) => e.name === 'package.json') && ds.length === 1
        ? path.join(clean, ds[0].name) : clean;
    })();
    const zhProbe = path.join(probeRoot, 'docs', 'assets', '45-人间建筑材质逐座全表.md');
    if (!fs.existsSync(zhProbe)) {
      console.error('FAIL:prepare 中文文件名完整性校验不通过（解压器非 UTF-8 感知）：' + zhProbe);
      console.error('  extractor=' + EXTRACTOR);
      process.exit(1);
    }
    ZH_NAMES_OK = true;
  }
  let root = clean;
  const top = fs.readdirSync(clean, { withFileTypes: true });
  const dirs = top.filter((e) => e.isDirectory() && e.name !== '__MACOSX');
  if (!top.some((e) => e.name === 'package.json') && dirs.length === 1) root = path.join(clean, dirs[0].name);
  if (SKIP_NPM_CI) {
    const target = path.join(root, 'node_modules');
    if (!fs.existsSync(target) && fs.existsSync(path.join(DEV_ROOT, 'node_modules'))) {
      try { fs.symlinkSync(path.join(DEV_ROOT, 'node_modules'), target, 'junction'); }
      catch (e) { console.error('FAIL:prepare symlink node_modules: ' + e.message); process.exit(1); }
    }
  }
  return { clean, root };
}

const STAGES = [
  { id: 'S01-prepare', label: '干净屋解压候选包' },
  { id: 'S02-npm-ci', label: 'npm ci --no-audit --no-fund' },
  { id: 'S03-tsc', label: 'npx tsc --noEmit' },
  { id: 'S04-vitest', label: 'npx vitest run' },
  { id: 'S05-build-compare', label: 'vite build → 与包内 dist 逐文件 sha 比对' },
  { id: 'S06-atoms-rebuild', label: 'npm run atoms:rebuild → 台账字节比对' },
  { id: 'S07-doc-refs', label: 'node scripts/check-doc-refs.mjs' },
  { id: 'S08-deadmodules', label: 'node scripts/check-deadmodules.mjs', deferredTill: 'M3' },
  { id: 'S09-check-tests', label: 'node scripts/check-tests.mjs', deferredTill: 'M3' },
  { id: 'S10-check-gates', label: 'node scripts/check-gates.mjs', deferredTill: 'M3' },
  { id: 'S11-gen-docs', label: 'node scripts/gen-docs.mjs --check' },
  { id: 'S12-disclosure', label: 'node scripts/qa/check-disclosure.mjs' },
  { id: 'S13-sha-ledger', label: 'SHA 台账重算双向对账' },
];

const EXTRA = [
  { id: 'X01-naming', label: 'node scripts/check-naming.mjs', files: ['scripts/check-naming.mjs'] },
  { id: 'X02-manifest', label: 'node scripts/qa/check-manifest.mjs', files: ['scripts/qa/check-manifest.mjs'] },
  { id: 'X03-numbers', label: 'node scripts/qa/check-numbers.mjs', files: ['scripts/qa/check-numbers.mjs'] },
  { id: 'X04-disclosure-selftest', label: 'node scripts/qa/check-disclosure.mjs --self-test（负例必 rc!=0）', files: ['scripts/qa/check-disclosure.mjs'], expectFail: true },
];

/** 找脚本实际路径（spec 内部对 scripts/ 与 scripts/qa/ 的引用不一致，两处都探测） */
function findScript(root, logical) {
  const cands = [logical, logical.replace('scripts/', 'scripts/qa/')];
  for (const c of cands) if (fs.existsSync(path.join(root, c))) return c;
  return null;
}

function execStage(st, root, results) {
  const t0 = Date.now();
  const base = { id: st.id, label: st.label, rc: null, ms: 0, status: 'SKIPPED', output: '' };
  const deferred = st.deferredTill && MILESTONE !== st.deferredTill && Number(MILESTONE.slice(1)) < Number(st.deferredTill.slice(1));
  const extraArgs = deferred ? ['--report-only'] : [];
  let r;
  try {
    switch (st.id) {
      case 'S01-prepare': r = { rc: 0, stdout: `cleanhouse=${root}`, stderr: '' }; break;
      case 'S02-npm-ci':
        if (SKIP_NPM_CI) { base.status = 'DEGRADED'; base.output = 'SKIPPED: --skip-npm-ci，复用开发树 node_modules（非完全干净，如实披露）'; results.push({ ...base, ms: Date.now() - t0 }); return; }
        r = run('npm', ['ci', '--no-audit', '--no-fund'], root); break;
      case 'S03-tsc': r = run('tsc', ['--noEmit'], root); break;
      case 'S04-vitest': r = run('vitest', ['run'], root); break;
      case 'S05-build-compare': {
        r = run('vite', ['build', '--outDir', '.gate-dist', '--emptyOutDir'], root);
        if (r.rc === 0) {
          const c = compareDirs(path.join(root, '.gate-dist'), path.join(root, 'dist'));
          base.output = JSON.stringify(c).slice(0, 600);
          if (!c.ok) r = { ...r, rc: 1, stderr: 'dist 逐文件 sha 不一致' };
        }
        break;
      }
      case 'S06-atoms-rebuild': {
        const files = ['artifacts/world-atoms.json', 'artifacts/scene-item-attribution.json', 'artifacts/world-atoms.annotated.json']
          .filter((f) => fs.existsSync(path.join(root, f)));
        const before = Object.fromEntries(files.map((f) => [f, fileSha(path.join(root, f))]));
        r = run('npm', ['run', 'atoms:rebuild'], root);
        if (r.rc === 0) {
          const diff = files.filter((f) => !fs.existsSync(path.join(root, f)) || fileSha(path.join(root, f)) !== before[f]);
          base.output = `shipped=${files.length} regenerated-diff=${diff.length} ${diff.join(',')}`;
          if (diff.length) r = { ...r, rc: 1, stderr: '再生产物与 shipped 副本 sha 不一致' };
        }
        break;
      }
      case 'S07-doc-refs': r = nodeScript(root, 'scripts/check-doc-refs.mjs', extraArgs); break;
      case 'S08-deadmodules': r = nodeScript(root, 'scripts/check-deadmodules.mjs', extraArgs); break;
      case 'S09-check-tests': r = nodeScript(root, 'scripts/check-tests.mjs', extraArgs); break;
      case 'S10-check-gates': r = nodeScript(root, 'scripts/qa/check-gates.mjs', extraArgs); break;
      case 'S11-gen-docs': r = nodeScript(root, 'scripts/gen-docs.mjs', ['--check', ...extraArgs]); break;
      case 'S12-disclosure': r = nodeScript(root, 'scripts/qa/check-disclosure.mjs', extraArgs); break;
      case 'S13-sha-ledger': {
        const c = checkShaLedger(root);
        base.output = JSON.stringify(c).slice(0, 600);
        r = { rc: c.ok === null ? 0 : (c.ok ? 0 : 1), stdout: base.output, stderr: c.ok === null ? 'SKIPPED' : '' };
        if (c.ok === null) { base.status = 'SKIPPED'; results.push({ ...base, ms: Date.now() - t0 }); return; }
        break;
      }
      default: r = { rc: 2, stdout: '', stderr: 'unknown stage' };
    }
  } catch (e) { r = { rc: 2, stdout: '', stderr: String(e) }; }

  base.rc = r.rc;
  base.output = (base.output ? base.output + ' | ' : '') + ((r.stdout || '').slice(-700) + (r.stderr || '').slice(-400)).replace(/\s+/g, ' ').slice(0, 1000);
  base.status = r.rc === 0 ? (deferred ? 'DEFERRED' : 'PASS') : 'FAIL';
  base.ms = Date.now() - t0;
  results.push(base);
}

function nodeScript(root, logical, args = []) {
  const p = findScript(root, logical);
  if (!p) return { rc: 2, stdout: '', stderr: `脚本不存在：${logical}（该门尚未实现，如实判 FAIL）` };
  return run('node', [p, ...args], root);
}

function main() {
  if (VERIFY_PACK) {
    // 防「gate 过了又改包」。候选形态决定比对对象：
    //   - ZIP / 文件候选：比对**候选文件自身**的 sha256（gate JSON 里 candidateFileSha256）。
    //     旧实现拿开发树 treeSha(DEV_ROOT) 去比 ZIP 解压树 sha，两者天然不等 → 永远误报
    //     「gate 后目录树已变化」，属假的 fail-closed。已按候选形态修正。
    //   - 目录候选：仍按 treeSha 比对，保持向后兼容。
    const dir = path.join(DEV_ROOT, 'artifacts/spec');
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => /^PACKAGE-GATE-.*\.json$/.test(f)).sort() : [];
    const g = files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8')) : null;
    if (!g) {
      console.log(JSON.stringify({ ok: false, gateFile: null, reason: 'gate JSON 不存在' }, null, 2));
      process.exit(1);
    }
    const cand = g.candidate ? path.resolve(g.candidate) : null;
    const isFile = !!(cand && fs.existsSync(cand) && fs.statSync(cand).isFile());
    const compared = isFile ? 'candidateFileSha256' : 'devTreeSha256';
    const gateSha = isFile ? (g.candidateFileSha256 ?? null) : g.candidateSha256;
    const now = isFile ? fileSha(cand) : treeSha(DEV_ROOT);
    let reason = '';
    if (!g.allGreen) reason = 'gate 非 allGreen';
    else if (gateSha === null || gateSha === undefined) reason = `gate JSON 未记录 ${compared}`;
    else if (gateSha !== now) reason = isFile ? 'gate 之后候选包文件被修改' : 'gate 后目录树已变化';
    const ok = g.allGreen === true && !!gateSha && gateSha === now;
    console.log(JSON.stringify({ ok, gateFile: files.at(-1), compared, candidate: g.candidate,
      reason: reason || 'OK：候选包与 gate 记录一致', gate: gateSha, now }, null, 2));
    process.exit(ok ? 0 : 1);
  }

  if (SELF_TEST) {
    // 快速负例：只跑受影响阶段，验证四个门确实会 FAIL（不跑完整 13 阶段）
    const cases = [
      { name: 'a) 删 artifacts/world-atoms.json', stage: 'S04-vitest',
        inject: (r) => fs.rmSync(path.join(r, 'artifacts/world-atoms.json'), { force: true }) },
      { name: 'b) 文档改一个数字', stage: 'S11-gen-docs',
        // 篡改已纳管的渲染值：gen-docs --check 与 check-numbers 双门都应拦下
        inject: (r) => { const p = path.join(r, 'docs/QA-NUMBERS.md'); if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('26,999', '27,431')); } },
      { name: 'c) src 加一个孤儿模块', stage: 'S08-deadmodules',
        inject: (r) => fs.writeFileSync(path.join(r, 'src/__injected_orphan__.ts'), 'export const x=1;\n') },
      { name: 'd) dist 换一个字节', stage: 'S05-build-compare',
        inject: (r) => { const p = path.join(r, 'dist/index.html'); if (fs.existsSync(p)) fs.appendFileSync(p, '\n<!-- injected -->'); } },
    ];
    let good = 0;
    for (const c of cases) {
      // 每个负例独立干净屋，避免互相污染
      const { clean, root } = prepare();
      c.inject(root);
      const res = [];
      execStage({ ...STAGES.find((s) => s.id === c.stage), deferredTill: undefined }, root, res);
      const detected = res[0].rc !== 0;
      if (detected) good++;
      console.log(`  ${detected ? 'DETECTED' : 'MISSED  '} ${c.name} → ${c.stage} rc=${res[0].rc}`);
      try { fs.rmSync(clean, { recursive: true, force: true }); } catch {}
    }
    console.log(`self-test: ${good}/4 负例被拦截（快速版：只跑受影响阶段）`);
    process.exit(good === 4 ? 0 : 1);
  }

  if (!CANDIDATE) { console.error('FAIL: 需要 --candidate <zip|目录>'); process.exit(2); }
  const { clean, root } = prepare();
  const candidateSha256 = treeSha(root);
  const results = [];
  console.log(`QA-001 干净屋打包门 | milestone=${MILESTONE} | candidate=${CANDIDATE}`);
  console.log(`  cleanhouse=${root}`);
  console.log(`  candidateSha256=${candidateSha256}`);
  let aborted = false;
  for (const st of STAGES) {
    execStage(st, root, results);
    const last = results[results.length - 1];
    console.log(`  [${last.status.padEnd(8)}] ${st.id.padEnd(20)} rc=${String(last.rc).padEnd(3)} ${last.ms}ms  ${last.output.slice(0, 150)}`);
    if (last.status === 'FAIL' && !aborted) { console.error(`FAIL:${st.id}`); aborted = true; break; }
  }
  const extras = [];
  if (!aborted) {
    for (const x of EXTRA) {
      if (!x.files.every((f) => fs.existsSync(path.join(root, f)))) {
        extras.push({ id: x.id, status: 'SKIPPED', rc: null, output: `${x.files.join(',')} 不存在（如实披露）` });
        continue;
      }
      const p = findScript(root, x.files[0]);
      const args = x.id === 'X04-disclosure-selftest' ? ['--self-test'] : [];
      const r = run('node', [p, ...args], root);
      const wantFail = !!x.expectFail;
      const ok = wantFail ? r.rc !== 0 : r.rc === 0;
      extras.push({ id: x.id, status: ok ? 'PASS' : 'FAIL', rc: r.rc, output: (r.stdout + r.stderr).replace(/\s+/g, ' ').slice(0, 240) });
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${x.id} rc=${r.rc} ${extras[extras.length - 1].output.slice(0, 120)}`);
    }
  }

  const fails = results.filter((r) => r.status === 'FAIL').length + extras.filter((r) => r.status === 'FAIL').length;
  const deferred = results.filter((r) => r.status === 'DEFERRED');
  const degraded = results.filter((r) => r.status === 'DEGRADED' || r.status === 'SKIPPED');
  const allGreen = !aborted && fails === 0;
  const gate = {
    release: (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).release; } catch { return 'unknown'; } })(),
    milestone: MILESTONE,
    generatedAt: new Date().toISOString(),
    candidate: path.resolve(CANDIDATE),
    candidateSha256,
    // 文件候选（ZIP）自身 sha256：供 --verify-pack 检测「gate 过了又改包」。
    candidateFileSha256: (() => {
      const a = path.resolve(CANDIDATE);
      return fs.existsSync(a) && fs.statSync(a).isFile() ? fileSha(a) : null;
    })(),
    extractor: EXTRACTOR,
    utf8NamesVerified: ZH_NAMES_OK,
    allGreen,
    counts: { stages: results.length, pass: results.filter((r) => r.status === 'PASS').length, fail: fails, deferred: deferred.length, degradedOrSkipped: degraded.length, extras: extras.length },
    disclosure: {
      note: 'DEFERRED / SKIPPED / DEGRADED 均与 PASS 分账，绝不混算为绿（FIX-003 R2 / QA-004）',
      deferred: deferred.map((r) => `${r.id}（属 ${STAGES.find((s) => s.id === r.id)?.deferredTill}，当前 ${MILESTONE} 未到期，以 --report-only 如实列出）`),
      degraded: degraded.map((r) => `${r.id}: ${r.output.slice(0, 160)}`),
    },
    stages: results, additionalChecks: extras,
  };
  const outDir = path.join(DEV_ROOT, 'artifacts/spec');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `PACKAGE-GATE-${gate.release}-${MILESTONE}.json`);
  fs.writeFileSync(outPath, JSON.stringify(gate, null, 2) + '\n');
  console.log(`\ngate JSON: ${outPath}`);
  console.log(`allGreen=${allGreen}  PASS=${gate.counts.pass} FAIL=${fails} DEFERRED=${deferred.length} DEGRADED/SKIPPED=${degraded.length}`);
  try { fs.rmSync(clean, { recursive: true, force: true }); } catch {}
  process.exit(allGreen ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
