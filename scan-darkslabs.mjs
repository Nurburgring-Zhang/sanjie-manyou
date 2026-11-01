import fs from 'node:fs';

const FILES = [
  'src/city/imperial.ts',
  'src/city/palaceDetail.ts',
  'src/city/palaceGrounds.ts',
  'src/sky/palace.ts',
  'src/sky/expansion.ts',
];

// 把某个 0xRRGGBB 折算成亮度（粗略，只看是不是深色）
function lum(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const out = [];
for (const f of FILES) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;
    // 匹配 b.box('group', w, h, d, x, y, z, hex ...)
    const m = line.match(/b\.box\(\s*'(\w+)'\s*,\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+)(?:,\s*([^,)]+))?/);
    if (!m) return;
    const [, g, ws, hs, ds, xs, ys, zs, cs] = m;
    const nums = [ws, hs, ds].map((s) => Number(s.trim()));
    if (nums.some((n) => !Number.isFinite(n))) return;
    const [w, h, d] = nums;
    const area = w * h;
    const thin = Math.min(w, h, d);
    const isPanel = d <= 1.0 && area >= 14;   // 立面贴片
    const isSlab = Math.min(w, d) >= 3 && h >= 6 && area >= 40;
    if (!isPanel && !isSlab) return;
    const hexm = (cs || '').match(/0x([0-9a-fA-F]{6})/);
    const hex = hexm ? parseInt(hexm[1], 16) : null;
    const dark = hex === null ? null : lum(hex) < 90;
    if (g !== 'glow' && !dark) return;         // 只看深色板 或 发光板
    out.push({ f, ln, g, w, h, d, area: +area.toFixed(0), hex: hex === null ? null : '0x' + hex.toString(16).padStart(6, '0'), dark, text: line.trim() });
  });
}
for (const r of out) {
  console.log(`${r.f}:${r.ln}  ${r.g.padEnd(8)} ${r.w}×${r.h}×${r.d}  A=${r.area}  ${r.hex ?? ''}${r.dark ? ' DARK' : ''}`);
  console.log(`    ${r.text.slice(0, 180)}`);
}
console.log('TOTAL=' + out.length);
