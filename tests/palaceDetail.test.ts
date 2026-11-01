import { describe, it, expect } from 'vitest';
import { Baker } from '../src/city/bake';
import { buildPalaceHall, buildPalaceBalustrade, buildPalaceGarden } from '../src/city/palaceDetail';

// 与 imperial.ts 的 palaceHall 同口径：y = 台基顶 3×1.55，eaveH = 檐口世界标高（PALACE.eave.taihe = 26）
const TAIHE = { x: 0, z: 0, y: 4.65, w: 200, d: 84, eaveH: 26, tiers: 3, doubleEave: true };

describe('R16 皇宫精细构造（palaceDetail）', () => {
  it('200m 重檐大殿达到 SPEC-R16 的构件数量口径', () => {
    const b = new Baker();
    buildPalaceHall(b, TAIHE);
    const d = b.stats().detail;

    // SPEC 判定表：斗栱 ≥60 / 隔扇+槛窗 ≥40 / 走兽 ≥12 / 瓦垄 ≥500 / 望柱 ≥80
    expect(d['palace.bracket'], '斗栱攒数').toBeGreaterThanOrEqual(60);
    expect(d['palace.door'], '六抹隔扇').toBeGreaterThanOrEqual(6);
    expect(d['palace.window'], '槛窗').toBeGreaterThanOrEqual(6);
    expect(d['palace.beast'], '垂脊走兽').toBeGreaterThanOrEqual(12);
    expect(d['palace.rib'], '瓦垄列数').toBeGreaterThanOrEqual(500);
    expect(d['palace.balustrade'], '望柱').toBeGreaterThanOrEqual(80);

    // 隔扇棂心：明间 6 扇 × 12 格
    expect(d['palace.doorLattice']).toBeGreaterThanOrEqual(72);
    // 瓦垄列数 = 面阔/0.34（受 roofRibCols 上限约束）：200m 壳 → ≥588 垄
    expect(d['palace.rib'], '200m 殿瓦垄应覆盖面阔').toBeGreaterThanOrEqual(588);
    // 檐口三件套：连檐 + 飞椽头（roofC 的瓦当/滴水另记 roof.tileCap / roof.dripTile）
    expect(d['palace.eaveFascia']).toBeGreaterThanOrEqual(64);
    expect(d['palace.flyingRafter']).toBeGreaterThan(800);
    expect(d['roof.tileCap'], '瓦当（由 bake.eaveTrim 落）').toBeGreaterThan(800);
    expect(d['roof.dripTile'], '滴水（由 bake.eaveTrim 落）').toBeGreaterThan(800);
    // 正脊 / 鸱吻 / 垂脊
    expect(d['palace.mainRidge']).toBe(1);
    expect(d['palace.chwen']).toBe(2);
    expect(d['palace.hipRidge']).toBeGreaterThanOrEqual(16);
    // 台基：3 层须弥座 + 束腰线脚
    expect(d['palace.baseTier']).toBe(3);
    expect(d['palace.baseMolding']).toBeGreaterThan(200);
    // 柱列：35 开间 → 前后檐 72 根 + 两山 28 根 + 上层殿身 8 根 = 108
    expect(d['palace.column']).toBeGreaterThanOrEqual(90);
    expect(d['palace.columnBase']).toBe(d['palace.column']);
    expect(d['palace.corbel']).toBeGreaterThanOrEqual(180);
    expect(d['palace.paintedBeam']).toBeGreaterThan(100);
    expect(b.rejected, '越界构件').toBe(0);
  });

  it('屋面落在檐口之上，不落到地面（eaveH 按世界标高解释）', () => {
    const b = new Baker();
    buildPalaceHall(b, TAIHE);
    const roof = b.positionsOf('roof');
    let minY = Infinity;
    for (let i = 1; i < roof.length; i += 3) minY = Math.min(minY, roof[i]);
    // 下檐檐口 = 4.65 + 21.35×0.52 ≈ 16.0；屋面最低点仍应在 12m 以上
    expect(minY).toBeGreaterThan(12);
    let maxY = -Infinity;
    for (let i = 1; i < roof.length; i += 3) maxY = Math.max(maxY, roof[i]);
    // 上檐脊高 ≈ 26 + 0.84×rise，重檐总高应显著高于上檐口
    expect(maxY).toBeGreaterThan(26 + 6);
  });

  it('台基底皮落到 y − tiers×1.55，殿身从地坪起算', () => {
    const b = new Baker();
    buildPalaceHall(b, { ...TAIHE, doubleEave: false });
    const ash = b.positionsOf('ash');
    let minY = Infinity;
    for (let i = 1; i < ash.length; i += 3) minY = Math.min(minY, ash[i]);
    expect(minY).toBeLessThan(0.1);
    expect(minY).toBeGreaterThan(-0.2);
    const d = b.stats().detail;
    expect(d['palace.baseTier']).toBe(3);
    // 单檐也要有完整正脊 + 走兽
    expect(d['palace.mainRidge']).toBe(1);
    expect(d['palace.beast']).toBe(12);
  });

  it('栏板：望柱每 2.4m，寻杖/地栿成对，转角螭首', () => {
    const b = new Baker();
    buildPalaceBalustrade(b, { x: 0, z: 0, y: 4.65, w: 212, d: 96 });
    const d = b.stats().detail;
    const perim = 2 * (212 + 96) - 16;      // 南面留 16m 御路口
    expect(d['palace.balustrade']).toBeGreaterThanOrEqual(Math.floor(perim / 2.4));
    expect(d['palace.rail']).toBeGreaterThanOrEqual(d['palace.balustrade'] - 8);
    expect(d['palace.sillRail']).toBe(d['palace.rail']);
    expect(d['palace.chishou']).toBe(6);    // 四转角 + 御路口两端
  });

  it('御花园：亭 4 / 楼 2 / 台 1，各带瓦垄与斗栱/坐凳', () => {
    const b = new Baker();
    buildPalaceGarden(b, { x: 0, z: 0, y: 4.65, count: { pavilion: 4, tower: 2, terrace: 1 } });
    const d = b.stats().detail;
    expect(d['palace.pavilion']).toBe(4);
    expect(d['palace.tower']).toBe(2);
    expect(d['palace.terrace']).toBe(1);
    expect(d['palace.pyramidRib'], '亭的攒尖瓦垄').toBeGreaterThan(200);
    expect(d['palace.pavilionBench']).toBe(16);
    expect(d['palace.towerDeck']).toBe(2);
    expect(d['palace.terraceStair']).toBe(8);
    // 亭/楼的檐口接的是 detailKit 的既有檐口子系统（椽/飞椽/檩/滴水/风铎）
    expect(d['eave.rafter'], '檐椽').toBeGreaterThan(300);
    expect(d['eave.flyingRafter'], '飞椽').toBeGreaterThan(200);
    expect(d['eave.windBell'], '风铎').toBeGreaterThan(12);
    expect(d['palace.bracket'], '园亭/楼斗栱').toBeGreaterThan(30);
    expect(b.rejected).toBe(0);
  });
});

describe('R16 构造自证（法线 / 朝向）', () => {
  /** 逐三角面的几何法线（Baker 输出是非索引三角形，每 3 个顶点一片） */
  function faceNy(positions: number[]): { sum: number; n: number } {
    let sum = 0, n = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const ux = positions[i + 3] - positions[i];
      const uy = positions[i + 4] - positions[i + 1];
      const uz = positions[i + 5] - positions[i + 2];
      const vx = positions[i + 6] - positions[i];
      const vy = positions[i + 7] - positions[i + 1];
      const vz = positions[i + 8] - positions[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      sum += ny / len;
      n++;
    }
    return { sum, n };
  }

  it('四角攒尖顶法线朝外（绕序反了整片亭顶会背光）', () => {
    const b = new Baker();
    buildPalaceGarden(b, { x: 0, z: 0, y: 4.65, count: { pavilion: 1, tower: 0, terrace: 0 } });
    const p = b.positionsOf('roof');
    // 单亭落在 (34cos45°, 34sin45°)，攒尖坡面取檐口以上、宝顶以下的一段
    let sum = 0, n = 0;
    for (let i = 0; i < p.length; i += 9) {
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3;
      const cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3;
      const cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
      if (cy < 10.6 || Math.abs(cx - 24.04) > 4.2 || Math.abs(cz - 24.04) > 4.2) continue;
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      sum += ny / len;
      n++;
    }
    expect(n, '攒尖坡面三角面太少').toBeGreaterThan(200);
    expect(sum / n, '坡面法线应朝上（>0），反了会是大负数').toBeGreaterThan(0.35);
  });

  it('ry 旋转整殿：落位与朝向跟着转（lead 可直接放到任意宫院）', () => {
    const b = new Baker();
    buildPalaceHall(b, { x: 500, z: -300, y: 4.65, w: 120, d: 60, eaveH: 22, tiers: 2, doubleEave: false, ry: Math.PI / 2 });
    // 屋面沿中轴对称，用它的包围盒验落位（台基/踏道只在正面出挑，包围盒中心会偏）
    const roof = b.positionsOf('roof');
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < roof.length; i += 3) {
      minX = Math.min(minX, roof[i]); maxX = Math.max(maxX, roof[i]);
      minZ = Math.min(minZ, roof[i + 2]); maxZ = Math.max(maxZ, roof[i + 2]);
    }
    expect((minX + maxX) / 2).toBeCloseTo(500, 0);
    expect((minZ + maxZ) / 2).toBeCloseTo(-300, 0);
    // 面阔 120 转到 z 方向：z 跨应明显大于 x 跨
    expect(maxZ - minZ).toBeGreaterThan(maxX - minX + 30);
    expect(b.stats().detail['palace.baseTier']).toBe(2);
    expect(b.rejected).toBe(0);
  });
});
