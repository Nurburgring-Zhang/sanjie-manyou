import type { Baker } from './bake';
import { shade } from './bake';

const WOOD = 0x6b4a2b;
const DARK = 0x4a3220;
const STONE = 0x87847a;
const LACQUER = 0xa63a2b;
const CERAMIC = 0xf4ecd8;
const METAL = 0xb87333;
const SILK = 0x9d2933;
const PAPER = 0xf4ecd8;
const HALL = 0xffc66e;

export type DetailTier = 'near' | 'mid' | 'far';

export interface EaveSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  ry: number;
  roofC: number;
  tier: DetailTier;
}

export interface FacadeSpec {
  x: number;
  z: number;
  ry: number;
  w: number;
  d: number;
  floors: number;
  tier: DetailTier;
  lit: boolean;
  /** 正面窗由调用方（buildBuilding 的立面分型）自理时置 false，避免两套窗叠在一起 */
  windows?: boolean;
  /** 门第型自带双开板门时置 false，避免两套门叠在同一平面 */
  door?: boolean;
}

const worldAt = (x: number, z: number, ry: number, lx: number, lz: number): [number, number] => [
  x + lx * Math.cos(ry) + lz * Math.sin(ry),
  z - lx * Math.sin(ry) + lz * Math.cos(ry),
];

export function buildDetailedEave(b: Baker, o: EaveSpec): void {
  if (o.tier === 'far') return;
  const near = o.tier === 'near';
  const hw = o.w * 0.46;
  const hd = o.d * 0.46;
  const eaveY = o.y - 0.2;
  const rafterStep = near ? 0.72 : 1.45;
  const dripStep = near ? 0.48 : 0.95;

  for (let lx = -hw; lx <= hw + 0.01; lx += rafterStep) {
    for (const side of [-1, 1]) {
      const [wx, wz] = worldAt(o.x, o.z, o.ry, lx, side * hd);
      b.box('wood', 0.14, 0.16, near ? 0.9 : 0.72, wx, eaveY, wz, shade(DARK, 0.95), o.ry, side * 0.23, 0);
      b.kit('eave.rafter');
      if (near) {
        const [fx, fz] = worldAt(o.x, o.z, o.ry, lx, side * (hd + 0.4));
        b.box('wood', 0.1, 0.11, 0.46, fx, eaveY - 0.04, fz, shade(WOOD, 0.9), o.ry, side * 0.32, 0);
        b.kit('eave.flyingRafter');
      }
    }
  }

  for (let lz = -hd; lz <= hd + 0.01; lz += rafterStep) {
    for (const side of [-1, 1]) {
      const [wx, wz] = worldAt(o.x, o.z, o.ry, side * hw, lz);
      b.box('wood', near ? 0.9 : 0.72, 0.16, 0.14, wx, eaveY, wz, shade(DARK, 0.95), o.ry, 0, -side * 0.23);
      b.kit('eave.rafter');
      if (near) {
        const [fx, fz] = worldAt(o.x, o.z, o.ry, side * (hw + 0.4), lz);
        b.box('wood', 0.46, 0.11, 0.1, fx, eaveY - 0.04, fz, shade(WOOD, 0.9), o.ry, 0, -side * 0.32);
        b.kit('eave.flyingRafter');
      }
    }
  }

  for (const side of [-1, 1]) {
    const [fx, fz] = worldAt(o.x, o.z, o.ry, 0, side * hd);
    b.box('wood', o.w * 0.94, 0.2, 0.18, fx, eaveY + 0.17, fz, WOOD, o.ry);
    b.box('wood', o.w * 0.95, 0.12, 0.12, fx, eaveY + 0.02, fz, DARK, o.ry);
    b.kit('eave.purlin', 2);
    const [sx, sz] = worldAt(o.x, o.z, o.ry, side * hw, 0);
    b.box('wood', 0.18, 0.2, o.d * 0.94, sx, eaveY + 0.17, sz, WOOD, o.ry);
    b.box('wood', 0.12, 0.12, o.d * 0.95, sx, eaveY + 0.02, sz, DARK, o.ry);
    b.kit('eave.purlin', 2);
  }

  for (let lx = -hw; lx <= hw + 0.01; lx += dripStep) {
    for (const side of [-1, 1]) {
      const [wx, wz] = worldAt(o.x, o.z, o.ry, lx, side * (hd + 0.55));
      b.box('roof', 0.1, 0.22, 0.12, wx, o.y - 0.02, wz, shade(o.roofC, side > 0 ? 1.08 : 0.96), o.ry);
      b.kit('eave.tileDrip');
    }
  }
  for (let lz = -hd; lz <= hd + 0.01; lz += dripStep) {
    for (const side of [-1, 1]) {
      const [wx, wz] = worldAt(o.x, o.z, o.ry, side * (hw + 0.55), lz);
      b.box('roof', 0.12, 0.22, 0.1, wx, o.y - 0.02, wz, shade(o.roofC, side > 0 ? 1.08 : 0.96), o.ry);
      b.kit('eave.tileDrip');
    }
  }

  for (const [lx, lz] of [[-hw, -hd], [-hw, hd], [hw, -hd], [hw, hd]] as const) {
    const [wx, wz] = worldAt(o.x, o.z, o.ry, lx, lz);
    b.box('wood', 0.08, 0.36, 0.08, wx, eaveY - 0.35, wz, DARK, o.ry);
    b.cyl('metal', 0.11, 0.15, 0.24, 8, wx, eaveY - 0.62, wz, METAL);
    b.kit('eave.windBell');
  }
}

function doorStuds(b: Baker, cx: number, cy: number, cz: number, w: number, ry: number): void {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const lx = -w / 2 + 0.22 + (w - 0.44) * (col / 5);
      const [wx, wz] = worldAt(cx, cz, ry, lx, 0.025);
      b.box('metal', 0.055, 0.055, 0.045, wx, cy - 0.5 + row * 0.48, wz, METAL, ry);
      b.kit('facade.doorStud');
    }
  }
}

export function buildDetailedFacade(b: Baker, o: FacadeSpec): void {
  if (o.tier === 'far') return;
  const near = o.tier === 'near';
  const hw = o.w / 2;
  const hd = o.d / 2;
  const bodyH = o.floors * 3.2;
  const columns = near ? 6 : 4;
  const at = (lx: number, lz: number): [number, number] => worldAt(o.x, o.z, o.ry, lx, lz);

  for (let i = 0; i < columns; i++) {
    const lx = -hw + 0.55 + (o.w - 1.1) * (i / (columns - 1));
    const [wx, wz] = at(lx, hd + 0.2);
    b.cyl('wall', 0.33, 0.4, 0.28, 8, wx, 0.72, wz, STONE, o.ry);
    b.cyl('lacquer', 0.22, 0.26, bodyH - 0.45, 8, wx, 0.86 + (bodyH - 0.45) / 2, wz, shade(LACQUER, 0.92 + (i % 2) * 0.08), o.ry);
    b.kit('facade.columnBase');
  }

  const doorW = Math.min(2.8, o.w * 0.34);
  if (o.door !== false) {
    for (const side of [-1, 1]) {
      const [wx, wz] = at(side * doorW / 4, hd + 0.25);
      b.box('lacquer', doorW / 2 - 0.03, 2.45, 0.12, wx, 1.9, wz, shade(LACQUER, 0.9), o.ry);
    }
    const [dcx, dcz] = at(0, hd + 0.31);
    doorStuds(b, dcx, 2.65, dcz, doorW, o.ry);
  }
  const [t0x, t0z] = at(0, hd + 0.4);
  b.box('wall', doorW + 0.7, 0.18, 0.65, t0x, 0.36, t0z, STONE, o.ry);
  const [t1x, t1z] = at(0, hd + 0.58);
  b.box('wall', doorW + 1.0, 0.14, 0.9, t1x, 0.18, t1z, shade(STONE, 0.92), o.ry);
  b.kit('facade.thresholdStep', 2);
  const [l0x, l0z] = at(0, hd + 0.32);
  b.box('wood', doorW + 0.5, 0.2, 0.18, l0x, 3.22, l0z, DARK, o.ry);

  if (o.windows !== false) {
    const windowW = 1.25;
    for (const side of [-1, 1]) {
      const [wx, wz] = at(side * (hw - 1.8), hd + 0.18);
      b.box('wood', windowW + 0.2, 1.55, 0.12, wx, 2.25, wz, shade(DARK, 0.9), o.ry);
      if (o.lit) {
        const [gx, gz] = at(side * (hw - 1.8), hd + 0.26);
        b.box('glow', windowW, 1.3, 0.06, gx, 2.25, gz, HALL, o.ry);
      }
      const slats = near ? 8 : 5;
      for (let i = 0; i < slats; i++) {
        const lx = -windowW / 2 + 0.1 + (windowW - 0.2) * (i / (slats - 1));
        const [sx, sz] = at(side * (hw - 1.8) + lx, hd + 0.26);
        b.box('wood', 0.045, 1.28, 0.055, sx, 2.25, sz, DARK, o.ry);
        b.kit('facade.latticeSlat');
      }
    }
  }

  for (const side of [-1, 1]) {
    const [wx, wz] = at(side * (hw + 0.16), 0.8);
    b.box('wood', 0.1, 1.2, 1.5, wx, 2.2, wz, DARK, o.ry);
    if (o.lit) b.box('glow', 0.06, 1.0, 1.25, wx + side * 0.04, 2.2, wz, HALL, o.ry);
    b.kit('facade.sideWindow');
  }

  // 檐下窗楣 + 窗台石 + 抱框线脚：把整面墙压出横向层次，近景不再是一块平板
  const [bx, bz] = at(0, hd + 0.3);
  b.box('wood', o.w * 0.96, 0.16, 0.34, bx, 0.6 + bodyH - 0.45, bz, shade(WOOD, 0.94), o.ry);
  b.kit('facade.windowLintel', 1, 0.6 + bodyH - 0.45);
  b.box('ash', o.w * 0.96, 0.1, 0.34, bx, 1.42, bz, shade(STONE, 0.96), o.ry);
  b.kit('facade.windowSill', 1, 1.42);
  for (const side of [-1, 1]) {
    const [jx, jz] = at(side * (o.w * 0.48 - 0.09), hd + 0.3);
    b.box('wood', 0.18, 2.7, 0.32, jx, 1.95, jz, shade(WOOD, 1.02), o.ry);
  }
  b.kit('facade.doorFrameTrim', 2, 1.95);

  const [skx, skz] = at(0, hd + 0.27);
  b.box('wall', o.w * 0.95, 0.34, 0.12, skx, 0.78, skz, shade(STONE, 0.92), o.ry);
  b.kit('facade.stoneSkirt');
}

function addCeilingFrame(b: Baker, cx: number, cz: number, w: number, d: number, y: number): void {
  b.box('wall', w, 0.16, d, cx, y + 0.08, cz, shade(PAPER, 0.86));
  for (let i = 0; i < 6; i++) {
    const x = cx - w / 2 + 1.2 + (w - 2.4) * (i / 5);
    b.box('wood', 0.18, 0.18, d - 0.2, x, y, cz, shade(DARK, 0.9));
    b.kit('interior.ceilingBeam', 1, y);
  }
  for (let i = 0; i < 6; i++) {
    const z = cz - d / 2 + 1.1 + (d - 2.2) * (i / 5);
    b.box('wood', w - 0.2, 0.16, 0.16, cx, y - 0.04, z, shade(DARK, 0.94));
    b.kit('interior.ceilingBeam', 1, y - 0.04);
  }
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    b.box('wall', w / 4 - 0.16, 0.05, d / 2 - 0.16, cx - w / 2 + w / 8 + col * (w / 4), y + 0.02, cz - d / 4 + row * (d / 2), shade(PAPER, 0.92));
    b.kit('interior.ceilingBoard', 1, y + 0.02);
  }
}

export function buildSunyangInteriorAtoms(b: Baker): void {
  const cx = 226;
  const cz = 66;
  const backZ = 59.95;
  const floorY = 0.72;
  const tables = [
    [218.5, 64.5], [222.5, 64.5], [226.5, 64.5], [230.5, 64.5], [234, 64.5],
    [218.5, 68.5], [222.5, 68.5], [226.5, 68.5], [230.5, 68.5], [234, 68.5],
  ] as const;

  b.box('wall', 19.4, 0.16, 12.4, cx, 4.2, cz, shade(PAPER, 0.86));
  b.box('wall', 19.4, 0.16, 12.4, cx, 7.18, cz, shade(PAPER, 0.82));
  for (let i = 0; i < 6; i++) {
    const x = cx - 7.5 + i * 3;
    b.box('wood', 0.18, 0.18, 12.2, x, 4.0, cz, shade(DARK, 0.9));
    b.box('wood', 0.14, 0.12, 12.2, x, 4.1, cz, shade(WOOD, 0.82));
    b.kit('interior.ceilingBeam', 2, 4.0);
  }
  for (let i = 0; i < 6; i++) {
    const z = cz - 5.5 + i * 2.2;
    b.box('wood', 19.2, 0.16, 0.16, cx, 3.96, z, shade(DARK, 0.94));
    b.kit('interior.ceilingBeam', 1, 3.96);
  }
  for (let i = 0; i < 10; i++) {
    const x = cx - 8.5 + (i % 5) * 4.1;
    const z = cz - 2.6 + Math.floor(i / 5) * 5.2;
    b.box('wall', 3.8, 0.05, 4.8, x, 4.08, z, shade(PAPER, 0.92));
    b.kit('interior.ceilingBoard', 1, 4.08);
  }

  for (const [x, z] of tables) {
    b.box('ceramic', 0.2, 0.1, 0.2, x - 0.26, 1.55, z - 0.12, CERAMIC);
    b.box('ceramic', 0.2, 0.1, 0.2, x + 0.26, 1.55, z + 0.12, CERAMIC);
    b.kit('ceramic.bowl', 2, 1.55);
    b.cyl('ceramic', 0.045, 0.055, 0.1, 8, x - 0.2, 1.58, z + 0.3, shade(CERAMIC, 0.96));
    b.cyl('ceramic', 0.045, 0.055, 0.1, 8, x + 0.2, 1.58, z - 0.3, shade(CERAMIC, 0.96));
    b.kit('ceramic.wineCup', 2, 1.58);
    b.box('wood', 0.26, 0.018, 0.018, x, 1.54, z + 0.22, DARK, 0.35);
    b.box('wood', 0.26, 0.018, 0.018, x, 1.54, z - 0.22, DARK, -0.25);
    b.kit('interior.tableSetting', 1, 1.54);

    for (const [dx, dz] of [[-0.72, 0], [0.72, 0], [0, -0.72], [0, 0.72]] as const) {
      const sx = x + dx;
      const sz = z + dz;
      b.box('wood', 0.42, 0.08, 0.42, sx, floorY + 0.44, sz, shade(WOOD, 1.04));
      b.box('wood', 0.07, 0.42, 0.07, sx - 0.13, floorY + 0.21, sz - 0.13, DARK);
      b.box('wood', 0.07, 0.42, 0.07, sx + 0.13, floorY + 0.21, sz + 0.13, DARK);
      b.kit('interior.stool', 1, floorY);
    }
  }

  for (let i = 0; i < 6; i++) {
    b.box('lacquer', 1.6, 1.1, 0.05, cx - 6.5 + i * 2.6, 2.75, backZ, shade(i % 2 ? 0x2e4e7e : PAPER, 0.92));
    b.box('wood', 1.75, 0.06, 0.08, cx - 6.5 + i * 2.6, 3.34, backZ, DARK);
    b.box('wood', 1.75, 0.06, 0.08, cx - 6.5 + i * 2.6, 2.16, backZ, DARK);
    b.kit('interior.hangingPainting', 1, 2.75);
  }

  for (const x of [220.5, 224, 228, 231.5]) {
    b.box('fabric', 0.04, 2.1, 1.25, x, 8.45, cz + 5.6, SILK, 0);
    b.box('fabric', 0.04, 0.08, 1.3, x, 9.5, cz + 5.6, shade(SILK, 1.15));
    b.kit('interior.fabricCurtain', 1, 8.45);
  }

  for (let i = 0; i < 4; i++) {
    const x = 220.4 + i * 0.65;
    b.cyl('metal', 0.13, 0.17, 0.34, 10, x, 2.05, 60.92, METAL);
    b.cyl('metal', 0.08, 0.1, 0.12, 10, x, 2.28, 60.92, shade(METAL, 0.9));
    b.box('metal', 0.03, 0.22, 0.03, x + 0.16, 2.08, 60.92, METAL, 0, 0, -0.5);
    b.kit('metal.winePot', 1, 2.05);
  }

  for (let i = 0; i < 8; i++) {
    const x = 217 + (i % 4) * 0.75;
    const z = 55.1 + Math.floor(i / 4) * 0.55;
    if (i % 3 === 0) b.cyl('metal', 0.16, 0.22, 0.22, 10, x, 1.0, z, shade(METAL, 0.88));
    else if (i % 3 === 1) b.box('wood', 0.08, 0.38, 0.32, x, 1.15, z, shade(DARK, 0.92), 0.2);
    else b.cyl('ceramic', 0.12, 0.16, 0.24, 10, x, 1.0, z, shade(CERAMIC, 0.9));
    b.kit('kitchen.utensil', 1, 1.0);
  }

  for (const [x, z] of [[218.2, 69.5], [233.5, 69.2], [221.5, 60.9], [231, 60.9]] as const) {
    b.cyl('ceramic', 0.14, 0.2, 0.42, 10, x, 1.9, z, shade(CERAMIC, 0.95));
    b.box('leaf', 0.45, 0.55, 0.04, x + 0.2, 2.25, z, 0x4a8b6f, 0.4);
    b.kit('ceramic.vase', 1, 1.9);
  }

  for (let i = 0; i < 8; i++) {
    const x = 218.5 + (i % 4) * 4.3;
    const z = 68.5 - Math.floor(i / 4) * 4;
    b.box('fabric', 0.48, 0.08, 0.42, x, floorY + 0.48, z, i % 2 ? 0x2e4e7e : SILK);
    b.kit('interior.fabricCushion', 1, floorY + 0.44);
  }
}

export function buildShiqianInteriorAtoms(b: Baker): void {
  const cx = 122;
  const cz = 64;
  const floorY = 0.72;
  addCeilingFrame(b, cx, cz, 15, 11, 4.2);
  addCeilingFrame(b, cx, cz, 15, 11, 7.05);

  const tables = [
    [cx - 4.5, cz + 1.6], [cx - 0.5, cz + 1.6], [cx + 3.5, cz + 1.6],
    [cx - 4.5, cz + 4], [cx - 0.5, cz + 4], [cx + 3.5, cz + 4],
  ] as const;
  for (const [x, z] of tables) {
    b.box('ceramic', 0.18, 0.09, 0.18, x - 0.22, 1.15, z - 0.1, CERAMIC);
    b.box('ceramic', 0.18, 0.09, 0.18, x + 0.22, 1.15, z + 0.1, CERAMIC);
    b.kit('ceramic.bowl', 2, 1.15);
    b.cyl('ceramic', 0.04, 0.05, 0.09, 8, x - 0.18, 1.18, z + 0.24, CERAMIC);
    b.cyl('ceramic', 0.04, 0.05, 0.09, 8, x + 0.18, 1.18, z - 0.24, CERAMIC);
    b.kit('ceramic.wineCup', 2, 1.18);
    for (const [dx, dz] of [[-0.66, 0], [0.66, 0], [0, -0.66], [0, 0.66]] as const) {
      const sx = x + dx;
      const sz = z + dz;
      b.box('wood', 0.38, 0.08, 0.38, sx, floorY + 0.42, sz, shade(WOOD, 1.02));
      b.box('wood', 0.065, 0.38, 0.065, sx - 0.12, floorY + 0.2, sz - 0.12, DARK);
      b.box('wood', 0.065, 0.38, 0.065, sx + 0.12, floorY + 0.2, sz + 0.12, DARK);
      b.kit('interior.stool', 1, floorY);
    }
  }

  for (let i = 0; i < 2; i++) {
    const x = cx - 2.8 + i * 1.0;
    b.cyl('metal', 0.12, 0.16, 0.3, 10, x, 1.14, cz + 3.0, METAL);
    b.box('metal', 0.04, 0.2, 0.04, x + 0.14, 1.2, cz + 3.0, METAL, 0, 0, -0.55);
    b.kit('metal.teapot', 1, 1.14);
  }

  for (let i = 0; i < 6; i++) {
    const x = cx - 5 + (i % 3) * 2.6;
    const z = 54.5 - Math.floor(i / 3) * 1.6;
    b.box('fabric', 1.7, 0.12, 0.72, x, 0.72, z, i % 2 ? 0x2e4e7e : SILK);
    b.box('wood', 0.38, 0.1, 0.28, x - 0.5, 0.82, z, CERAMIC);
    b.box('wood', 0.9, 0.38, 0.55, x + 0.4, 0.21, z + 0.6, DARK);
    b.kit('interior.guestBed', 1, 0.72);
  }

  for (const mx of [cx - 1, cx + 1.6]) {
    b.box('wall', 1.4, 0.5, 0.55, mx, 0.45, 55.2, STONE);
    b.box('leaf', 0.28, 0.12, 0.32, mx - 0.25, 0.64, 55.2, 0xb89b46);
    b.box('wood', 0.34, 0.28, 0.34, mx + 1.4, 0.3, 55.2, DARK);
    b.kit('interior.stableTrough', 1, 0.2);
  }

  for (const x of [cx - 3, cx + 2.5]) {
    b.box('fabric', 0.56, 0.05, 0.42, x, 0.75, cz + 0.2, 0x2e4e7e);
    b.kit('interior.cushionBench', 1, 0.72);
  }
}

export function buildYamenInteriorAtoms(b: Baker): void {
  const cx = 560;
  const cz = -74;
  const floorY = 0.98;
  addCeilingFrame(b, cx, cz, 22, 12, 4.24);

  b.box('lacquer', 2.6, 0.16, 1.15, cx, floorY + 0.9, cz - 3.2, shade(LACQUER, 0.82));
  for (const dx of [-1.05, 1.05]) for (const dz of [-0.4, 0.4]) {
    b.box('wood', 0.12, 0.85, 0.12, cx + dx, floorY + 0.43, cz - 3.2 + dz, DARK);
  }
  b.box('wood', 1.1, 1.35, 0.9, cx, floorY + 0.68, cz - 4.1, shade(DARK, 1.1));
  b.cyl('ceramic', 0.18, 0.22, 0.12, 10, cx - 0.65, floorY + 1.06, cz - 3.25, CERAMIC);
  b.box('ceramic', 0.2, 0.05, 0.3, cx - 0.1, floorY + 1.04, cz - 3.2, shade(CERAMIC, 0.92));
  b.box('metal', 0.34, 0.22, 0.28, cx + 0.7, floorY + 1.06, cz - 3.2, METAL);
  b.box('wood', 0.12, 0.1, 0.4, cx + 0.22, floorY + 1.06, cz - 3.2, DARK);
  b.kit('ceramic.inkstone', 1, floorY + 1.04);
  b.kit('metal.sealBox', 1, floorY + 1.06);

  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const row = i % 3;
    const x = cx + side * 8.4;
    const z = cz - 4 + row * 4;
    b.box('wood', 1.8, 0.12, 0.8, x, floorY + 0.78, z, shade(WOOD, 0.98));
    b.box('wood', 0.1, 0.74, 0.1, x - 0.7, floorY + 0.37, z - 0.28, DARK);
    b.box('wood', 0.1, 0.74, 0.1, x + 0.7, floorY + 0.37, z + 0.28, DARK);
    b.box('wood', 0.46, 0.08, 0.46, x, floorY + 0.46, z + 1.0, shade(WOOD, 1.02));
    b.box('wood', 0.42, 0.42, 0.08, x, floorY + 0.7, z + 1.22, DARK);
    b.box('ceramic', 0.18, 0.05, 0.28, x - 0.3, floorY + 0.86, z, shade(CERAMIC, 0.9));
    b.kit('ceramic.inkstone', 1, floorY + 0.86);
    b.box('wood', 0.35, 0.22, 0.45, x + 0.45, floorY + 0.86, z + 0.12, 0x8a5a2b);
    b.kit('interior.officeDesk', 1, floorY + 0.78);
    b.kit('interior.officeChair', 1, floorY + 0.46);
    b.kit('interior.documentBox', 1, floorY + 0.86);
  }

  for (const [x, z] of [[cx - 7, cz - 4.8], [cx + 7, cz - 4.8], [cx - 7, cz + 4.8], [cx + 7, cz + 4.8]] as const) {
    b.box('wood', 0.05, 0.6, 0.05, x, floorY + 1.6, z, DARK);
    b.cyl('metal', 0.16, 0.2, 0.18, 10, x, floorY + 1.25, z, METAL);
    b.box('glow', 0.11, 0.2, 0.11, x, floorY + 1.43, z, HALL);
    b.kit('metal.candleStand', 1, floorY + 1.25);
  }

  for (const z of [-78.5, -76.5, -74.5, -72.5, -70.5, -68.5, -66.5, -64.5]) {
    const x = cx + 9.8;
    b.box('metal', 0.07, 2.25, 0.07, x, floorY + 1.13, z, 0x4a4e54);
    b.box('wood', 0.1, 0.1, 7.2, x, floorY + 2.25, -71.5, DARK);
    b.kit('yamen.jailBar', 1, floorY + 0.01);
  }
  b.box('wood', 0.65, 0.35, 2.8, cx + 9.2, floorY + 0.2, cz - 2.8, shade(WOOD, 0.9));
  b.box('wall', 0.3, 0.5, 0.3, cx + 9.0, floorY + 0.3, cz - 4.2, STONE);
  b.kit('interior.jailBench', 1, floorY + 0.02);
}
