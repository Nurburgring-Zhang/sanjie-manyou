import { describe, it, expect, beforeEach } from 'vitest';
import { allocate, dispose, __resetForTest } from '../src/rt/entity';
import { GroundLayers } from '../src/rt/ground';

// P0-2+P0-7 统一地面查询层单测（零接线切片）：block/creation 顶面层走网格 pointQuery
// （H2 禁 forEach 落地）+ provider 组合 + onDispose 摘除闭环 + 引用移动跟随。

beforeEach(() => __resetForTest());

describe('P0-2+P0-7 · GroundLayers 统一地面', () => {
  const mk = (gl: GroundLayers, x: number, z: number, topY: number, hx = 2, hz = 2): number => {
    const pos = { x, y: 0, z };
    const id = allocate('block', { pos, persist: true });
    expect(gl.attachGroundBox(id, pos, hx, hz, topY)).toBe(true);
    return id;
  };

  it('顶面层：站在方块覆盖点返回 topY；盒外走 provider', () => {
    const gl = new GroundLayers();
    gl.registerProvider(() => 0);                       // 街面 0 恒在（语义烟测）
    mk(gl, 0, 0, 5);                                    // (0,0) 一块顶面 5m 的方块
    expect(gl.groundAt(0, 0, 4.5)).toBe(5);             // refY=4.5 站在覆盖点（4.5+0.95≥5）→ 顶面
    expect(gl.groundAt(5, 0, 4.5)).toBe(0);             // 盒外（|x|=5 > hx2）→ 街面
    expect(gl.groundAt(1.9, 1.9, 4.5)).toBe(5);         // 覆盖边界内 → 顶面
    expect(gl.groundAt(0, 0, 0)).toBe(0);               // refY=0 站在地面：5m 顶面够不着 → 街面
  });

  it('stepUp 口径：够不着的顶面不参与（照 walkSurfaceY 语义）', () => {
    const gl = new GroundLayers();
    gl.registerProvider(() => 0);
    mk(gl, 0, 0, 20);                                   // 20m 高的顶面
    expect(gl.groundAt(0, 0, 0)).toBe(0);               // refY=0 + 0.95 < 20 → 够不着 → 街面
    expect(gl.groundAt(0, 0, 19.5)).toBe(20);           // refY 够 → 顶面
  });

  it('provider 组合：天宫语义烟测（refY 高带返回平台高，与顶面取 max）', () => {
    const gl = new GroundLayers();
    gl.registerProvider((x, z, refY) => (refY > 2085 ? 2148.6 : 0));   // 简化天宫平台
    mk(gl, 0, 0, 2160);                                 // 天宫里一块台面
    expect(gl.groundAt(0, 0, 2159.5)).toBe(2160);       // 顶面更高（2159.5+0.95≥2160）→ 顶面
    expect(gl.groundAt(10, 10, 2150)).toBe(2148.6);     // 台外 → 天宫平台
    expect(gl.groundAt(0, 0, 10)).toBe(0);              // 人间带：顶面够不着 → provider 0
  });

  it('dispose 摘除闭环：实体注销后顶面消失（onDispose 自动）', () => {
    const gl = new GroundLayers();
    gl.registerProvider(() => 0);
    const id = mk(gl, 0, 0, 5);
    expect(gl.groundAt(0, 0, 4.5)).toBe(5);
    // 模拟注销（走 entity.dispose → onDispose → ground 摘除）
    expect(dispose(id)).toBe(true);
    expect(gl.groundAt(0, 0, 0)).toBe(0);
  });

  it('引用移动：moveAll 后顶面跟随（Vector3 引用语义）', () => {
    const gl = new GroundLayers();
    gl.registerProvider(() => 0);
    const pos = { x: 0, y: 0, z: 0 };
    const id = allocate('creation', { pos, persist: true });
    expect(gl.attachGroundBox(id, pos, 2, 2, 6)).toBe(true);
    pos.x = 100; pos.z = 100;                           // 引用移动（原对象改值）
    gl.moveAll();
    expect(gl.groundAt(100, 100, 5.5)).toBe(6);         // 新位置可站（5.5+0.95≥6）
    expect(gl.groundAt(0, 0, 0)).toBe(0);               // 旧位置已无
  });

  it('多块取最高：两个覆盖点重叠的顶面取 max', () => {
    const gl = new GroundLayers();
    gl.registerProvider(() => 0);
    mk(gl, 0, 0, 3);
    mk(gl, 1, 1, 5, 2, 2);
    expect(gl.groundAt(1, 1, 4.5)).toBe(5);             // 两块都覆盖 → 取高者（4.5+0.95≥5）
    expect(gl.groundAt(-1, -1, 2.5)).toBe(3);           // 只有低块覆盖（2.5+0.95≥3）
  });
});
