/**
 * 探针共用的 Chromium 解析器。
 *
 * 为什么需要它：
 *   1. 仓库里不能写死本机绝对路径（发布前要把 `C:/Users/<某人>/...` 全部清掉）；
 *   2. Playwright 的浏览器目录会变——本项目实测 `chromium-1243` 曾整个从磁盘消失，
 *      只剩 `chromium-1155`。写死版本的探针会直接 `Browser was not found`。
 *
 * 解析顺序：
 *   ① 环境变量 `CHROME_PATH`（给 CI 或特殊机器用）
 *   ② `%LOCALAPPDATA%/ms-playwright/chromium-*` 里版本号最大的那个
 *   ③ Playwright 常见目录（`~/.cache/ms-playwright`、`/Applications`）
 *   ④ 系统自带 Chrome/Edge
 * 都找不到就抛错，并把搜过的目录列出来——**不允许静默失败**。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tried = [];

function exists(p) {
  try {
    return p && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 从 ms-playwright 目录里挑版本号最大的 chromium */
function pickFromPlaywrightRoot(root) {
  tried.push(root);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && /^chromium-\d+$/.test(e.name))
    .map((e) => ({ name: e.name, n: Number(e.name.split('-')[1]) }))
    .sort((a, b) => b.n - a.n);
  for (const d of dirs) {
    for (const rel of [
      path.join(d.name, 'chrome-win64', 'chrome.exe'),
      path.join(d.name, 'chrome-win', 'chrome.exe'),
      path.join(d.name, 'chrome-linux', 'chrome'),
      path.join(d.name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) {
      const p = path.join(root, rel);
      if (exists(p)) return p;
    }
  }
  return null;
}

function resolveChrome() {
  const env = process.env.CHROME_PATH;
  if (env && exists(env)) return env;
  if (env) tried.push(`${env} (CHROME_PATH 指向的文件不存在)`);

  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  ].filter(Boolean);
  for (const r of roots) {
    const p = pickFromPlaywrightRoot(r);
    if (p) return p;
  }

  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]) {
    if (exists(p)) return p;
  }

  throw new Error(
    `找不到可用的 Chromium。已搜索:\n  ${tried.join('\n  ')}\n` +
      `可设置环境变量 CHROME_PATH 指向 chrome 可执行文件。`,
  );
}

export const CHROME = resolveChrome();

export default CHROME;
