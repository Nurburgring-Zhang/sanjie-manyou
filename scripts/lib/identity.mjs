// FIX-007 / INV-09：产品名与版本身份的「单一真相源」。
// ESM，零第三方依赖。只读 package.json；release 缺失即 fail-closed（rc=1），不写降级 WARN。
// [SPEC 裁决] 产品名 = 「赛博上河 CyberQingming」；「三界漫游」仅作 zip 名 / 副标题别名。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..'); // scripts/lib -> 工程根
const PKG_PATH = resolve(ROOT, 'package.json');

const PRODUCT_NAME = '赛博上河 CyberQingming';
const PRODUCT_NAME_EN = 'CyberQingming';
const ALIAS = '三界漫游';

function fail(msg) {
  console.error(`[identity] FATAL: ${msg}`);
  process.exit(1);
}

/**
 * 读 package.json 生成身份对象。
 * @param {object} overrides 仅用于「内存注入」（如 --self-test 的 { release: 'R99' }），
 *                           绝不写盘上 package.json —— 主代理已写入 release:R29。
 */
export function loadIdentity(overrides = {}) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  } catch (e) {
    fail(`无法读取 package.json: ${e.message}`);
  }
  const merged = { ...pkg, ...overrides };

  // fail-closed：缺 release / version 直接报错，不做任何降级（主代理已加 "release":"R29"）。
  if (!merged.release || typeof merged.release !== 'string') {
    fail('package.json 缺少 "release"（例如 "R29"）；按 fail-closed 拒绝降级');
  }
  if (!merged.version || typeof merged.version !== 'string') {
    fail('package.json 缺少 "version"');
  }

  const { release, version } = merged;
  // 规范串：release 字段本身已含 "R"（"R29"），故直接拼接，不再额外加前缀 R。
  // 对应 FIX-007 R1 的 `${productNameEn}-${release}-${version}-x64.exe` 形式。
  const stem = `${PRODUCT_NAME_EN}-${release}-${version}`; // CyberQingming-R29-1.2.0
  const exeName = `${stem}-x64.exe`; // CyberQingming-R29-1.2.0-x64.exe
  const zipName = `${ALIAS}-${PRODUCT_NAME_EN}-${release}-${version}.zip`;
  const title = `赛博上河 · ${stem}`;
  const banner = `赛博上河 · ${stem} - FULL DELIVERY`;

  return {
    productName: PRODUCT_NAME,
    productNameEn: PRODUCT_NAME_EN,
    alias: ALIAS,
    version,
    release,
    exeName,
    zipName,
    title,
    banner,
  };
}

const _id = loadIdentity();

export const productName = _id.productName;
export const productNameEn = _id.productNameEn;
export const alias = _id.alias;
export const version = _id.version;
export const release = _id.release;
export const exeName = _id.exeName;
export const zipName = _id.zipName;
export const title = _id.title;
export const banner = _id.banner;

/**
 * vite `define` 用：返回纯 JSON 对象，键 __APP_IDENTITY__，值为 JSON.stringify 后的字符串。
 * esbuild/vite 会把该字符串当作合法 JSON 静态替换 __APP_IDENTITY__（对象字面量）。
 */
export function constantsForVite() {
  return {
    __APP_IDENTITY__: JSON.stringify({
      productName: _id.productName,
      productNameEn: _id.productNameEn,
      alias: _id.alias,
      version: _id.version,
      release: _id.release,
      exeName: _id.exeName,
      zipName: _id.zipName,
      title: _id.title,
      banner: _id.banner,
    }),
  };
}

// 直接运行 `node scripts/lib/identity.mjs` 时打印完整身份对象，便于验收观察。
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  console.log(JSON.stringify(_id, null, 2));
}
