/**
 * R20 终局 · 起居资产「几何级」验证（临时探针）
 *
 * 与 tests/roomLiving.test.ts 的区别：那份用 stub Baker 把所有几何调用吞掉，
 * 只验落位台账；本探针用 recording Baker 捕获 buildRoomLiving 真正发出的
 * box / cyl 调用参数（尺寸 / 世界坐标 / 颜色），用来回答：
 *   「房间里到底有没有成件立体器物？尺寸多大？有没有落在楼板之上 / 地板之下？」
 * 不依赖浏览器，不依赖截图。
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import type { Baker } from '../src/city/bake';
import { buildRoomLiving } from '../src/city/roomLiving';

type Call = { op: string; args: unknown[] };

// Baker 的 box/cyl 签名：(group, w, h, d, x, y, z, hex, ...) / (group, rTop, rBot, h, seg, x, y, z, hex, ...)
function recording(): { b: Baker; calls: Call[] } {
  const calls: Call[] = [];
  const noop = (): void => {};
  const b = new Proxy({}, {
    get: (_t, k: string) => {
      if (k === 'box' || k === 'cyl') return (...args: unknown[]) => { calls.push({ op: k, args }); };
      return noop;
    },
  }) as unknown as Baker;
  return { b, calls };
}

describe('R20 起居资产几何取证', () => {
  it('导出真实几何调用参数', () => {
    const rooms = [
      { name: '趙太丞家', cx: 168, cz: 64, w: 9, d: 8, y0: 0.6, h: 3.4, variant: 0, tier: 'high' as const },
      { name: '解庫', cx: 258, cz: 64, w: 10, d: 8, y0: 0.6, h: 3.4, variant: 1, tier: 'mid' as const },
      { name: '王家紙馬', cx: 352, cz: 66, w: 12, d: 9, y0: 0.6, h: 3.4, variant: 2, tier: 'low' as const },
    ];
    const report = rooms.map(r => {
      const { b, calls } = recording();
      const res = buildRoomLiving(b, {
        cx: r.cx, cz: r.cz, w: r.w, d: r.d, y0: r.y0, h: r.h,
        ux: 1, uz: 0, vx: 0, vz: 1, variant: r.variant, tier: r.tier,
      });
      const boxes = calls.filter(c => c.op === 'box');
      const cyls = calls.filter(c => c.op === 'cyl');
      // 立体器物：高度 > 0.25m 且底面宽/深 > 0.2m
      const solids = boxes.filter(c => {
        const h = Number(c.args[2]), w = Number(c.args[1]), d = Number(c.args[3]);
        return h > 0.25 && Math.min(w, d) > 0.2;
      });
      const ys = boxes.map(c => Number(c.args[5]));
      return {
        room: r.name,
        count: res.count, pieces: res.pieces,
        calls: calls.length, boxes: boxes.length, cyls: cyls.length, solids: solids.length,
        yRange: [Math.min(...ys).toFixed(2), Math.max(...ys).toFixed(2)],
        sampleSolids: solids.slice(0, 10).map(c => ({
          g: c.args[0], w: +Number(c.args[1]).toFixed(2), h: +Number(c.args[2]).toFixed(2),
          d: +Number(c.args[3]).toFixed(2), x: +Number(c.args[4]).toFixed(2),
          y: +Number(c.args[5]).toFixed(2), z: +Number(c.args[6]).toFixed(2),
          hex: c.args[7],
        })),
      };
    });
    fs.writeFileSync('artifacts/r20-geomprobe.json', JSON.stringify(report, null, 2));
    console.log('[几何探针]', JSON.stringify(report.map(r => ({
      room: r.room, count: r.count, calls: r.calls, solids: r.solids, yRange: r.yRange,
    })), null, 2));
  });
});
