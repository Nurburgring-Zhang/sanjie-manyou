import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { Baker, BGroup, COL_Q, NORM_Q, setCullBottom } from '../src/city/bake';

/**
 * 两条「产出没变」的逐构件证据：
 *  ① 量化（法线 Int16 / 顶点色 Uint16）只改属性字节宽度，不改几何：
 *     位置必须与 three 自己的 BoxGeometry → toNonIndexed → applyMatrix4 逐位相等；
 *     法线/顶点色只允许出现 ≤1 个量化步长的差。
 *  ② 底面剔除只删 ny 那一面：保留的 5 面在缓冲里逐字节不变，删掉的正是一段连续的 18 个 float
 *     （6 顶点 × 3 分量，即面序第 3 面 ny）。
 */

interface BoxCase { g: BGroup; w: number; h: number; d: number; x: number; y: number; z: number; hex: number; ry: number; rx: number; rz: number }

const CASES: BoxCase[] = [
  { g: 'wood', w: 4, h: 3, d: 2, x: 12, y: 1.5, z: -8, hex: 0x8a6a44, ry: 0, rx: 0, rz: 0 },
  { g: 'wall', w: 6.5, h: 2.2, d: 0.9, x: -30, y: 1.1, z: 44, hex: 0xe8e0cc, ry: 0.7, rx: 0, rz: 0 },
  { g: 'roof', w: 3.7, h: 0.6, d: 4.06, x: 5.5, y: 5.42, z: 12.25, hex: 0x3b4045, ry: 1.2, rx: 0, rz: -0.2 },
  { g: 'ash', w: 0.36, h: 0.18, d: 0.36, x: -110, y: 1.03, z: 70, hex: 0x8b857a, ry: -2.1, rx: 0, rz: 0 },
  { g: 'earth', w: 12, h: 0.4, d: 7.5, x: 220, y: -0.9, z: -33, hex: 0xc0a274, ry: 0.31, rx: 0, rz: 0 },
  { g: 'glow', w: 0.34, h: 0.42, d: 0.34, x: 3, y: 3.95, z: -12, hex: 0xffc069, ry: 0, rx: 0, rz: 0 },
  { g: 'metal', w: 2.0, h: 1.2, d: 2.0, x: -4, y: 2.4, z: 9, hex: 0xb9a06a, ry: 0.45, rx: 0.12, rz: 0.05 },
];

interface Emit { pos: Float32Array; nrm: Int16Array; col: Uint16Array; uv: Float32Array | null }

type BufView = {
  p: { take(): Float32Array };
  n: { take(): Int16Array };
  c: { take(): Uint16Array };
  uv?: { take(): Float32Array };
};

function emit(c: BoxCase, cull: boolean): Emit {
  setCullBottom(cull);
  const b = new Baker();
  b.box(c.g, c.w, c.h, c.d, c.x, c.y, c.z, c.hex, c.ry, c.rx, c.rz);
  const slot = (b as unknown as { buf: Record<string, BufView> }).buf[c.g];
  return { pos: slot.p.take(), nrm: slot.n.take(), col: slot.c.take(), uv: slot.uv ? slot.uv.take() : null };
}

/** three 原生路径：BoxGeometry → toNonIndexed（与 push 的去索引一致）→ applyMatrix4 → 逐顶点 float */
function reference(c: BoxCase): { pos: Float32Array; nrm: Float32Array; col: Float32Array } {
  const box = new THREE.BoxGeometry(c.w, c.h, c.d);
  box.computeBoundingBox();
  const localH = Math.max(0.001, box.boundingBox!.max.y - box.boundingBox!.min.y);
  const geo = box.index ? box.toNonIndexed() : box;
  if (geo !== box) box.dispose();
  geo.computeBoundingBox();   // toNonIndexed 不给包围盒，push() 里显式算过一次
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(c.x, c.y, c.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(c.rx, c.ry, c.rz)),
    new THREE.Vector3(1, 1, 1),
  );
  geo.applyMatrix4(m);                       // 就地更新 position / normal / boundingBox
  const worldMinY = geo.boundingBox!.min.y;  // push() 的 bbAO 是活引用，变换后即世界系最小值
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const base = new THREE.Color(c.hex);
  const out = {
    pos: new Float32Array(pos.count * 3),
    nrm: new Float32Array(pos.count * 3),
    col: new Float32Array(pos.count * 3),
  };
  for (let i = 0; i < pos.count; i++) {
    out.pos[i * 3] = pos.getX(i); out.pos[i * 3 + 1] = pos.getY(i); out.pos[i * 3 + 2] = pos.getZ(i);
    out.nrm[i * 3] = nrm.getX(i); out.nrm[i * 3 + 1] = nrm.getY(i); out.nrm[i * 3 + 2] = nrm.getZ(i);
    const kAO = 0.82 + 0.18 * ((pos.getY(i) - worldMinY) / localH);
    out.col[i * 3] = base.r * kAO; out.col[i * 3 + 1] = base.g * kAO; out.col[i * 3 + 2] = base.b * kAO;
  }
  geo.dispose();
  return out;
}

describe('Baker 量化属性（法线 Int16 / 顶点色 Uint16）', () => {
  it('位置与 three 原生 BoxGeometry+applyMatrix4 逐位相等', () => {
    for (const c of CASES) {
      const got = emit(c, false);
      const ref = reference(c);
      expect(got.pos.length).toBe(ref.pos.length);
      for (let i = 0; i < ref.pos.length; i++) {
        if (!Object.is(got.pos[i], ref.pos[i])) {
          throw new Error(`位置不一致 case=${c.g} i=${i} got=${got.pos[i]} ref=${ref.pos[i]}`);
        }
      }
    }
  });

  it('法线误差 ≤ 1 个量化步长（1/32767）', () => {
    let worst = 0;
    for (const c of CASES) {
      const got = emit(c, false);
      const ref = reference(c);
      expect(got.nrm.length).toBe(ref.nrm.length);
      for (let i = 0; i < ref.nrm.length; i++) {
        const d = Math.abs(got.nrm[i] / NORM_Q - ref.nrm[i]);
        if (d > worst) worst = d;
      }
    }
    expect(worst).toBeLessThanOrEqual(1 / NORM_Q + 1e-9);
  });

  it('顶点色误差 ≤ 1 个量化步长（1/65535），且 UV 仍是 float32', () => {
    let worst = 0;
    for (const c of CASES) {
      const got = emit(c, false);
      const ref = reference(c);
      expect(got.col.length).toBe(ref.col.length);
      for (let i = 0; i < ref.col.length; i++) {
        const d = Math.abs(got.col[i] / COL_Q - ref.col[i]);
        if (d > worst) worst = d;
      }
      if (got.uv) expect(got.uv).toBeInstanceOf(Float32Array);
    }
    expect(worst).toBeLessThanOrEqual(1 / COL_Q + 1e-9);
  });
});

describe('盒体底面剔除（只删 ny 面）', () => {
  /** 埋进地坪以下的盒子：底边 y−h/2 ≤ −0.05 且 rx=rz=0，四条判据全中 */
  const BURIED: BoxCase = { g: 'ash', w: 2, h: 3, d: 2, x: 40, y: 0.4, z: -50, hex: 0x7d766a, ry: 0.3, rx: 0, rz: 0 };
  const NOT_BURIED: BoxCase = { g: 'ash', w: 2, h: 3, d: 2, x: 40, y: 4, z: -50, hex: 0x7d766a, ry: 0.3, rx: 0, rz: 0 };
  const TILTED: BoxCase = { g: 'ash', w: 2, h: 3, d: 2, x: 40, y: 0.4, z: -50, hex: 0x7d766a, ry: 0.3, rx: 0.1, rz: 0 };

  it('埋地盒：保留的 5 面逐字节不变，只少了 ny 面的 54..72 号 float', () => {
    const full = emit(BURIED, false);
    const cut = emit(BURIED, true);
    expect(full.pos.length).toBe(36 * 3);
    expect(cut.pos.length).toBe(30 * 3);
    for (let i = 0; i < 18 * 3; i++) expect(Object.is(cut.pos[i], full.pos[i])).toBe(true);
    for (let i = 18 * 3; i < 30 * 3; i++) expect(Object.is(cut.pos[i], full.pos[i + 18])).toBe(true);
    for (let i = 0; i < 18 * 3; i++) expect(cut.nrm[i]).toBe(full.nrm[i]);
    for (let i = 18 * 3; i < 30 * 3; i++) expect(cut.nrm[i]).toBe(full.nrm[i + 18]);
    for (let i = 0; i < 18 * 3; i++) expect(cut.col[i]).toBe(full.col[i]);
    for (let i = 18 * 3; i < 30 * 3; i++) expect(cut.col[i]).toBe(full.col[i + 18]);
  });

  it('底边在地面以上的盒子不受影响（12 面全留）', () => {
    const full = emit(NOT_BURIED, false);
    const cut = emit(NOT_BURIED, true);
    expect(cut.pos.length).toBe(full.pos.length);
    for (let i = 0; i < full.pos.length; i++) expect(Object.is(cut.pos[i], full.pos[i])).toBe(true);
  });

  it('带 rx/rz 倾角的盒子不受影响（底面不是水平面）', () => {
    const full = emit(TILTED, false);
    const cut = emit(TILTED, true);
    expect(cut.pos.length).toBe(full.pos.length);
    for (let i = 0; i < full.pos.length; i++) expect(Object.is(cut.pos[i], full.pos[i])).toBe(true);
  });

  afterAll(() => setCullBottom(true));
});
