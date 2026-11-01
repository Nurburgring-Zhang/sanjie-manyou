/**
 * R28 回归机检：天穹不能被远裁剪面切掉。
 *
 * 背景（2026-11-01 定位到的真 bug）：
 *   天穹是 `SphereGeometry(46000)`，球心固定在**世界原点**；`camera.far = 52000`。
 *   相机飞到离原点 14km 时，前方球壁距离 `46000 + |cam|` 已经超过 far ⇒ 视锥中心那整块球壁被裁掉，
 *   而 `scene.background` 是 null ⇒ 露出来的是 WebGLRenderer 的**默认黑色清屏**。
 *   玩家看到的就是「远处一个巨大的黑洞」。
 *   修法：`world.ts` 每帧让天穹 `position.copy(camera.position)`（天空盒标准做法）。
 *
 * 判据：在若干「远离原点」的机位，画面**上半部**的近黑像素占比必须 < 3%。
 *   改前在 (13900,180,5500) 实测 77.5%；改后应为 0。
 *
 * 用法：PREVIEW_URL=http://localhost:4173/ node scripts/probe-skydome.mjs
 * 退出码 0 = 全部通过，1 = 有天穹被裁剪。
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chromePath.mjs';
import zlib from 'node:zlib';

/** 极简 PNG 解码：只支持 bitDepth 8 / colorType 2(RGB) 或 6(RGBA) / 无隔行 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png ${data[8]}/${colorType}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

/** 近黑像素占比（阈值 12） */
function darkFrac(png) {
  const d = decodePng(png);
  let n = 0, t = 0;
  for (let i = 0; i < d.data.length; i += d.bpp * 3) {
    if (d.data[i] < 12 && d.data[i + 1] < 12 && d.data[i + 2] < 12) n++;
    t++;
  }
  return n / t;
}

const VIEWS = [
  { name: '东洋巨泽东岸回望（原始复现机位）', p: [13900, 180, 5500], t: [11500, -3, 5500] },
  { name: '城东 18km 高空俯瞰', p: [18000, 300, 18000], t: [0, 0, 0] },
  { name: '昆仑方向 27km 外', p: [27000, 200, -4000], t: [0, 0, 0] },
  { name: '城中心 1200m 高空', p: [0, 1200, 1215], t: [0, 0, 0] },
];
const LIMIT = 0.03;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=1600,900', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const v of VIEWS) {
  // 每次换机位前重新确认页面还活着（并发改文件时 vite 会整页重载）
  await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
  const info = await page.evaluate((vv) => {
    const e = window.__qingming.engine;
    e.stopCinema();
    e.camera.position.set(vv.p[0], vv.p[1], vv.p[2]);
    const dx = vv.t[0] - vv.p[0], dy = vv.t[1] - vv.p[1], dz = vv.t[2] - vv.p[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    e.yaw = Math.atan2(-dx, -dz);
    e.pitch = Math.asin(dy / d);
    e.camera.updateMatrixWorld(true);
    return { far: e.camera.far, distFromOrigin: Math.round(Math.hypot(vv.p[0], vv.p[1], vv.p[2])) };
  }, v);
  await new Promise((r) => setTimeout(r, 1200));
  // 只取画面上半部（天空带）
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1600, height: 420 } });
  const f = darkFrac(Buffer.from(shot));
  rows.push({ name: v.name, camera: v.p, ...info, darkFrac: +f.toFixed(4), pass: f < LIMIT });
  console.log(`${f < LIMIT ? 'PASS' : 'FAIL'}  ${v.name}  darkFrac=${f.toFixed(4)}  far=${info.far}  |cam|=${info.distFromOrigin}`);
}

const pass = rows.every((r) => r.pass);
console.log(JSON.stringify({ limit: LIMIT, rows, pass }, null, 1));
await browser.close();
process.exit(pass ? 0 : 1);
