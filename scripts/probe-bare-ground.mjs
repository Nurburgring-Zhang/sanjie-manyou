/**
 * R24 机检：宫城内「无建筑裸地」的最大轴对齐矩形边长。
 *
 * 判据（用户原话「皇宫如此空旷正常吗」「为什么皇宫内还是那么空旷！！！」）：
 *   从宫城正上方 y=1200 垂直下拍两张图 —— A 正常，B 隐藏全部 city_* / infill_* / court_* 静态几何；
 *   A 与 B 逐像素相同 = 该像素下方没有建筑（只有地形与地坪）；不同的像素 = 有建筑覆盖。
 *   在「相同」掩膜上求最大全空矩形，按相机视场换算成米。目标 < 90m。
 *
 * 为什么要两张图：单纯按颜色分「裸土/铺装」不可靠（方砖与夯土在黄昏光下会撞色）；
 * 隐藏前后逐像素比对是几何级证据，不依赖调色板。
 *
 * 用法：PREVIEW_URL=http://localhost:4173/ node scripts/probe-bare-ground.mjs [cx] [cz] [y]
 *   默认 cx=0, cz=-3475（宫城中心）, y=1200
 * 退出码 0 = 最大裸地 < 90m，1 = 超标或探针失败。
 */
import puppeteer from 'puppeteer-core';
import zlib from 'node:zlib';

const CX = Number(process.argv[2] ?? 0);
const CZ = Number(process.argv[3] ?? -3475);
const CAMY = Number(process.argv[4] ?? 1200);
const FOV = 55;
const W = 900, H = 900; // 正方形视口：像素→米 只需要一个比例
const GRID = 90;        // 掩膜降采样格数（每格 = 视场边长 / GRID）
const LIMIT_M = 90;

/** 极简 PNG 解码：只支持 bitDepth 8 / colorType 2(RGB) 或 6(RGBA) / 无隔行 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png ${bitDepth}/${colorType}`);
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
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

const browser = await puppeteer.launch({
  executablePath: '<HOME>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true,
  args: ['--window-size=1400,1000', '--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: W + 200, height: H + 100 });
await page.goto(process.env.PREVIEW_URL || 'http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading') && !!window.__qingming, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));

// 机位：正上方垂直下看，视场正好框住宫城
const setup = await page.evaluate(([cx, cz, y, fov]) => {
  const e = window.__qingming.engine;
  e.stopCinema();
  e.camera.fov = fov;
  e.camera.updateProjectionMatrix();
  e.camera.position.set(cx, y, cz);
  e.camera.up.set(0, 0, -1); // 让画面「上」= −z（北），矩形边长与米制换算无关，只为稳定
  e.camera.lookAt(cx, 0, cz);
  e.camera.updateMatrixWorld(true);
  e.lookTarget.set(cx, 0, cz);
  e.yaw = 0;
  e.pitch = -Math.PI / 2;
  return { fov, y };
}, [CX, CZ, CAMY, FOV]);
await new Promise((r) => setTimeout(r, 1200));

const clip = { x: 100, y: 50, width: W, height: H };
const shotA = await page.screenshot({ clip });
// 隐藏所有静态建筑几何（保留 terrain / 天空 / 水面），再拍一张
const hidden = await page.evaluate(() => {
  const e = window.__qingming.engine;
  // 必须 scene.remove()，不能只置 visible=false：LodManager 每帧重写 infill_/court_ 的 visible，
  // 置 false 会被下一帧还原（另一路 agent 实测踩过这个坑）。
  const victims = [];
  e.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const nm = o.name || '';
    if (nm.startsWith('city_') || nm.startsWith('infill_') || nm.startsWith('court_') || nm.startsWith('pave_')) victims.push(o);
  });
  for (const v of victims) v.parent && v.parent.remove(v);
  return victims.length;
});
await new Promise((r) => setTimeout(r, 1200));
const shotB = await page.screenshot({ clip });
await browser.close();

const A = decodePng(Buffer.from(shotA));
const B = decodePng(Buffer.from(shotB));
const { width, height, bpp } = A;

// 掩膜：A 与 B 逐像素相同 → 该格无建筑
const cell = Math.floor(width / GRID);
const mask = Array.from({ length: GRID }, () => new Uint8Array(GRID)); // 1 = 有建筑
let built = 0;
for (let gy = 0; gy < GRID; gy++) {
  for (let gx = 0; gx < GRID; gx++) {
    let diff = 0, tot = 0;
    for (let y = gy * cell; y < (gy + 1) * cell; y += 2) {
      for (let x = gx * cell; x < (gx + 1) * cell; x += 2) {
        const i = (y * width + x) * bpp;
        const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
        tot++;
        if (d > 24) diff++;
      }
    }
    if (tot && diff / tot > 0.08) { mask[gy][gx] = 1; built++; }
  }
}

// 最大全空轴对齐矩形（直方图法）
let best = 0, bestAt = null;
const heights = new Uint16Array(GRID);
for (let y = 0; y < GRID; y++) {
  for (let x = 0; x < GRID; x++) heights[x] = mask[y][x] ? 0 : heights[x] + 1;
  const stack = [];
  for (let x = 0; x <= GRID; x++) {
    const h = x === GRID ? 0 : heights[x];
    while (stack.length && heights[stack[stack.length - 1]] >= h) {
      const top = stack.pop();
      const left = stack.length ? stack[stack.length - 1] + 1 : 0;
      const area = heights[top] * (x - left);
      if (area > best) { best = area; bestAt = { x: left, y: y - heights[top] + 1, w: x - left, h: heights[top] }; }
    }
    stack.push(x);
  }
}

// 像素 → 米：垂直下视时可视高度 = 2 * y * tan(fov/2)
const metersPerPx = (2 * CAMY * Math.tan((FOV * Math.PI) / 360)) / height;
const cellM = metersPerPx * cell;
const longSide = Math.max(bestAt?.w ?? 0, bestAt?.h ?? 0) * cellM;
const shortSide = Math.min(bestAt?.w ?? 0, bestAt?.h ?? 0) * cellM;

const out = {
  camera: { x: CX, y: CAMY, z: CZ, fov: FOV },
  hiddenMeshes: hidden,
  grid: GRID,
  cellMeters: +cellM.toFixed(1),
  builtCellRatio: +(built / (GRID * GRID)).toFixed(3),
  largestEmptyRect: { cells: bestAt, meters: { long: +longSide.toFixed(0), short: +shortSide.toFixed(0) } },
  limitM: LIMIT_M,
  pass: longSide < LIMIT_M,
};
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
