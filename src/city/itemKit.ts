import { Baker, shade } from './bake';

/**
 * 器物件工厂：把资产卷里"只有材质设定、没有网格"的条目落成可复用的程序化器件。
 * 每个构件都登记 `item.*` kit id，便于逐件统计与断言；尺寸以米为单位，y 为底面基准。
 */
export type ItemBuilder = (b: Baker, x: number, y: number, z: number, s?: number) => void;

const BRONZE = 0x6a5a3a;
const BRONZE_D = 0x4a4030;
const CERAMIC = 0x7a6a52;
const CERAMIC_L = 0x9a8a6a;
const LACQUER = 0x5a1f18;
const WOOD = 0x6b4a2b;
const WOOD_D = 0x3a2c22;
const GOLD = 0xb08a34;
const SILK = 0x9d2933;

/** 香炉：三足鼎身 + 双耳 + 盖钮 */
export const censer: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.26 * s, 0.2 * s, 0.34 * s, 10, x, y + 0.36 * s, z, BRONZE);
  b.cyl('metal', 0.22 * s, 0.26 * s, 0.12 * s, 10, x, y + 0.58 * s, z, shade(BRONZE, 1.12));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.cyl('metal', 0.045 * s, 0.06 * s, 0.2 * s, 6, x + Math.cos(a) * 0.16 * s, y + 0.1 * s, z + Math.sin(a) * 0.16 * s, shade(BRONZE_D, 0.8));
  }
  for (const sx of [-1, 1]) b.box('metal', 0.06 * s, 0.12 * s, 0.16 * s, x + sx * 0.28 * s, y + 0.5 * s, z, BRONZE_D);
  b.cyl('metal', 0.06 * s, 0.08 * s, 0.1 * s, 6, x, y + 0.68 * s, z, GOLD);
  b.box('glow', 0.1 * s, 0.03 * s, 0.1 * s, x, y + 0.66 * s, z, 0xffcf90);
  // 錾花环带 ×2：明度 ±13%，贴器身外 0.004m
  b.cyl('metal', 0.223 * s, 0.223 * s, 0.03 * s, 10, x, y + 0.3 * s, z, shade(BRONZE, 1.13), 0, 0, 0, true);
  b.cyl('metal', 0.248 * s, 0.248 * s, 0.03 * s, 10, x, y + 0.44 * s, z, shade(BRONZE, 0.87), 0, 0, 0, true);
  b.kit('item.censer', 1, y);
};

/** 宫灯：灯身 + 上下座 + 灯芯 + 垂穗 */
export const lantern: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('glow', 0.2 * s, 0.24 * s, 0.44 * s, 8, x, y + 0.5 * s, z, 0xffbf72);
  b.cyl('wood', 0.24 * s, 0.18 * s, 0.06 * s, 8, x, y + 0.74 * s, z, WOOD_D);
  b.cyl('wood', 0.18 * s, 0.24 * s, 0.06 * s, 8, x, y + 0.28 * s, z, WOOD_D);
  b.box('wood', 0.03 * s, 0.3 * s, 0.03 * s, x, y + 0.92 * s, z, WOOD_D);
  b.box('fabric', 0.05 * s, 0.22 * s, 0.05 * s, x, y + 0.16 * s, z, SILK);
  b.kit('item.lantern', 1, y + 0.5);
};

/** 坛/瓮：鼓腹 + 短颈 + 盖 */
export const jar: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.16 * s, 0.2 * s, 0.14 * s, 10, x, y + 0.07 * s, z, CERAMIC);
  b.cyl('ceramic', 0.24 * s, 0.2 * s, 0.34 * s, 10, x, y + 0.31 * s, z, shade(CERAMIC, 1.04));
  b.cyl('ceramic', 0.14 * s, 0.22 * s, 0.14 * s, 10, x, y + 0.55 * s, z, CERAMIC_L);
  b.cyl('ceramic', 0.16 * s, 0.16 * s, 0.05 * s, 10, x, y + 0.64 * s, z, shade(CERAMIC_L, 0.9));
  // 盖沿亮釉线 + 腹壁开片 ×2（0.9/1.1）
  b.cyl('ceramic', 0.1635 * s, 0.1635 * s, 0.014 * s, 10, x, y + 0.645 * s, z, shade(CERAMIC_L, 1.3), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 4.084 : 0.9425, rr = (i ? 0.2208 : 0.2074) * s;
    b.box('ceramic', 0.05 * s, 0.009 * s, 0.005 * s, x + Math.cos(a) * rr, y + (i ? 0.4 : 0.28) * s, z + Math.sin(a) * rr, shade(CERAMIC, i ? 0.9 : 1.1), Math.PI / 2 - a, 0, i ? 0.5 : -0.5);
  }
  b.kit('item.jar', 1, y + 0.3);
};

/** 执壶/净瓶：长颈 + 流 + 柄 */
export const bottle: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.1 * s, 0.16 * s, 0.3 * s, 10, x, y + 0.19 * s, z, CERAMIC_L);
  b.cyl('ceramic', 0.05 * s, 0.1 * s, 0.26 * s, 8, x, y + 0.46 * s, z, CERAMIC_L);
  b.cyl('ceramic', 0.07 * s, 0.05 * s, 0.06 * s, 8, x, y + 0.62 * s, z, CERAMIC);
  // 流
  b.cyl('ceramic', 0.03 * s, 0.04 * s, 0.18 * s, 6, x + 0.1 * s, y + 0.46 * s, z, CERAMIC_L, 0, 0, -0.7);
  // 口沿亮釉线 + 腹部开片 ×2
  b.cyl('ceramic', 0.0712 * s, 0.0712 * s, 0.012 * s, 8, x, y + 0.643 * s, z, shade(CERAMIC_L, 1.32), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 4.712 : 1.571, rr = (i ? 0.1157 : 0.1348) * s;
    b.box('ceramic', 0.044 * s, 0.008 * s, 0.005 * s, x + Math.cos(a) * rr, y + (i ? 0.24 : 0.14) * s, z + Math.sin(a) * rr, shade(CERAMIC_L, i ? 0.9 : 1.1), Math.PI / 2 - a, 0, i ? 0.35 : -0.35);
  }
  b.kit('item.bottle', 1, y + 0.4);
};

/** 花觚/供瓶：高挑喇叭口 */
export const vase: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.09 * s, 0.16 * s, 0.34 * s, 10, x, y + 0.2 * s, z, CERAMIC_L);
  b.cyl('ceramic', 0.22 * s, 0.09 * s, 0.24 * s, 10, x, y + 0.49 * s, z, shade(CERAMIC_L, 1.06));
  b.cyl('leaf', 0.12 * s, 0.03 * s, 0.3 * s, 6, x, y + 0.72 * s, z, 0x3e6e48);
  // 喇叭口亮釉线 + 下腹开片 ×2
  b.cyl('ceramic', 0.2225 * s, 0.2225 * s, 0.016 * s, 10, x, y + 0.603 * s, z, shade(CERAMIC_L, 1.3), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 4.712 : 1.571, rr = (i ? 0.1105 : 0.1341) * s;
    b.box('ceramic', 0.05 * s, 0.009 * s, 0.005 * s, x + Math.cos(a) * rr, y + (i ? 0.25 : 0.13) * s, z + Math.sin(a) * rr, shade(CERAMIC_L, i ? 1.1 : 0.9), Math.PI / 2 - a, 0, i ? -0.4 : 0.4);
  }
  b.kit('item.vase', 1, y + 0.4);
};

/** 供盘：托盘 + 三枚供果 */
export const tray: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('lacquer', 0.26 * s, 0.22 * s, 0.05 * s, 12, x, y + 0.03 * s, z, LACQUER);
  b.cyl('lacquer', 0.28 * s, 0.28 * s, 0.03 * s, 12, x, y + 0.07 * s, z, shade(LACQUER, 1.2));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.cyl('ceramic', 0.08 * s, 0.09 * s, 0.1 * s, 8, x + Math.cos(a) * 0.11 * s, y + 0.13 * s, z + Math.sin(a) * 0.11 * s, 0xb8734a);
  }
  // 盘面推光条 ×2（1.25×，沿长边）+ 边角磨损 ×2（0.85×）
  b.box('lacquer', 0.42 * s, 0.004 * s, 0.015 * s, x, y + 0.0862 * s, z + 0.12 * s, shade(LACQUER, 1.25));
  b.box('lacquer', 0.4 * s, 0.004 * s, 0.015 * s, x - 0.04 * s, y + 0.0862 * s, z - 0.13 * s, shade(LACQUER, 1.25));
  b.box('lacquer', 0.03 * s, 0.006 * s, 0.024 * s, x + 0.255 * s, y + 0.0845 * s, z - 0.11 * s, shade(LACQUER, 0.85), 0.5);
  b.box('lacquer', 0.028 * s, 0.006 * s, 0.022 * s, x - 0.2 * s, y + 0.0845 * s, z + 0.19 * s, shade(LACQUER, 0.85), -0.4);
  b.kit('item.tray', 1, y);
};

/** 碗/盏 */
export const bowl: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.13 * s, 0.09 * s, 0.09 * s, 10, x, y + 0.05 * s, z, CERAMIC_L);
  b.cyl('ceramic', 0.1 * s, 0.1 * s, 0.02 * s, 10, x, y + 0.01 * s, z, shade(CERAMIC_L, 0.62));
  // 口沿亮釉线 + 腹壁开片 ×2
  b.cyl('ceramic', 0.1327 * s, 0.1327 * s, 0.014 * s, 10, x, y + 0.0935 * s, z, shade(CERAMIC_L, 1.34), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 4.712 : 1.571, rr = (i ? 0.1156 : 0.1074) * s;
    b.box('ceramic', 0.046 * s, 0.009 * s, 0.005 * s, x + Math.cos(a) * rr, y + (i ? 0.072 : 0.052) * s, z + Math.sin(a) * rr, shade(CERAMIC_L, i ? 1.1 : 0.9), Math.PI / 2 - a, 0, i ? 0.3 : -0.3);
  }
  b.kit('item.bowl', 1, y);
};

/** 铜镜：镜面 + 背钮 + 镜架 */
export const mirror: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.26 * s, 0.26 * s, 0.03 * s, 16, x, y + 0.62 * s, z, 0x8a9aa2, 0, Math.PI / 2);
  b.cyl('metal', 0.3 * s, 0.3 * s, 0.04 * s, 16, x, y + 0.62 * s, z, BRONZE, 0, Math.PI / 2);
  b.box('wood', 0.1 * s, 0.5 * s, 0.1 * s, x, y + 0.25 * s, z - 0.08 * s, WOOD_D);
  b.box('wood', 0.5 * s, 0.08 * s, 0.3 * s, x, y + 0.04 * s, z - 0.08 * s, WOOD);
  // 镜背錾花双环（±13%）
  b.cyl('metal', 0.272 * s, 0.272 * s, 0.012 * s, 12, x, y + 0.62 * s, z - 0.026 * s, shade(BRONZE, 1.14), 0, Math.PI / 2, 0, true);
  b.cyl('metal', 0.2 * s, 0.2 * s, 0.01 * s, 8, x, y + 0.62 * s, z - 0.0255 * s, shade(BRONZE, 0.88), 0, Math.PI / 2, 0, true);
  b.kit('item.mirror', 1, y + 0.6);
};

/** 屏风：三扇连屏 */
export const screen: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = -1; i <= 1; i++) {
    const ang = i * 0.28;
    b.box('wood', 0.9 * s, 1.9 * s, 0.07 * s, x + i * 0.86 * s, y + 1.0 * s, z - Math.abs(i) * 0.12 * s, WOOD_D, ang);
    b.box('fabric', 0.78 * s, 1.66 * s, 0.04 * s, x + i * 0.86 * s, y + 1.0 * s, z - Math.abs(i) * 0.12 * s + 0.05 * s, i === 0 ? 0xf4ecd8 : shade(0xf4ecd8, 0.94), ang);
    // 绢面下缘包边 + 中扇经线 ×2（±6%）
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const bx = x + i * 0.86 * s, bz = z - Math.abs(i) * 0.12 * s;
    b.box('fabric', 0.78 * s, 0.05 * s, 0.006 * s, bx + 0.0725 * s * sa, y + 0.235 * s, bz + 0.0725 * s * ca, shade(0xf4ecd8, 0.8), ang);
    if (i === 0) for (let k = -1; k <= 1; k += 2) {
      const ox = k * 0.2 * s;
      b.box('fabric', 0.008 * s, 1.5 * s, 0.006 * s, bx + ox * ca + 0.0725 * s * sa, y + 1.0 * s, bz - ox * sa + 0.0725 * s * ca, shade(0xf4ecd8, k > 0 ? 1.06 : 0.94), ang);
    }
  }
  b.kit('item.screen', 1, y + 1);
};

/** 蒲团/坐垫 */
export const cushion: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('fabric', 0.38 * s, 0.42 * s, 0.16 * s, 12, x, y + 0.08 * s, z, 0x8a6a3a);
  b.cyl('fabric', 0.36 * s, 0.36 * s, 0.04 * s, 12, x, y + 0.18 * s, z, 0x9a7a4a);
  // 顶面经线 ×3（±8%）+ 底缘包边（0.8×）
  for (let i = 0; i < 3; i++) {
    b.box('fabric', 0.008 * s, 0.005 * s, 0.64 * s, x, y + 0.2025 * s, z, shade(0x9a7a4a, i === 1 ? 1.08 : 0.92), (i / 3) * Math.PI);
  }
  b.cyl('fabric', 0.4165 * s, 0.4165 * s, 0.02 * s, 12, x, y + 0.03 * s, z, shade(0x8a6a3a, 0.8), 0, 0, 0, true);
  b.kit('item.cushion', 1, y);
};

/** 琴：琴身 + 七弦 + 琴案 */
export const qin: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 1.9 * s, 0.12 * s, 0.36 * s, x, y + 0.76 * s, z, 0x2e1a16);
  for (let i = 0; i < 7; i++) b.box('metal', 1.84 * s, 0.012 * s, 0.012 * s, x, y + 0.83 * s, z - 0.14 * s + i * 0.047 * s, 0xd8cbaa);
  for (const sx of [-1, 1]) b.box('wood', 0.12 * s, 0.72 * s, 0.9 * s, x + sx * 0.8 * s, y + 0.36 * s, z, WOOD);
  // 琴面推光条 ×2 + 边角磨白 ×2
  for (const sz of [-1, 1]) b.box('lacquer', 1.7 * s, 0.004 * s, 0.015 * s, x, y + 0.8225 * s, z + sz * 0.16 * s, shade(0x2e1a16, 1.25));
  for (const sx of [-1, 1]) b.box('lacquer', 0.04 * s, 0.006 * s, 0.03 * s, x + sx * 0.92 * s, y + 0.8225 * s, z + 0.16 * s, shade(0x2e1a16, 0.85), 0.3);
  b.kit('item.qin', 1, y + 0.8);
};

/** 杵臼：臼 + 杵 */
export const pestle: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wall', 0.3 * s, 0.24 * s, 0.34 * s, 12, x, y + 0.17 * s, z, 0x8a8478);
  b.cyl('wall', 0.24 * s, 0.3 * s, 0.06 * s, 12, x, y + 0.36 * s, z, 0x9a9488);
  b.cyl('wood', 0.06 * s, 0.09 * s, 0.8 * s, 8, x + 0.16 * s, y + 0.5 * s, z, WOOD, 0, 0, 0.35);
  b.kit('item.pestle', 1, y);
};

/** 药柜/箱柜：多屉 */
export const cabinet: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.2 * s, 1.6 * s, 0.5 * s, x, y + 0.8 * s, z, WOOD);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    b.box('wood', 0.3 * s, 0.28 * s, 0.04 * s, x - 0.36 * s + c * 0.36 * s, y + 1.32 * s - r * 0.34 * s, z + 0.27 * s, shade(WOOD, 1.1));
    b.box('metal', 0.06 * s, 0.06 * s, 0.03 * s, x - 0.36 * s + c * 0.36 * s, y + 1.32 * s - r * 0.34 * s, z + 0.3 * s, GOLD);
  }
  // 柜面推光条 ×2（1.3×）+ 柜脚磨暗 ×2（0.8×）
  for (const sz of [-1, 1]) b.box('lacquer', 1.1 * s, 0.004 * s, 0.015 * s, x, y + 1.6025 * s, z + sz * 0.16 * s, shade(WOOD, 1.3));
  for (const sx of [-1, 1]) b.box('lacquer', 0.05 * s, 0.06 * s, 0.006 * s, x + sx * 0.55 * s, y + 0.06 * s, z + 0.253 * s, shade(WOOD, 0.8));
  b.kit('item.cabinet', 1, y + 0.8);
};

/** 简架/书案架：两立柱 + 横档 + 卷轴 */
export const scrollRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 1.5 * s, 0.08 * s, x + sx * 0.45 * s, y + 0.75 * s, z, WOOD_D);
  for (const yy of [0.4, 0.9, 1.35]) {
    b.box('wood', 0.96 * s, 0.05 * s, 0.05 * s, x, y + yy * s, z, WOOD);
    b.box('fabric', 0.12 * s, 0.16 * s, 0.1 * s, x - 0.2 * s, y + (yy + 0.1) * s, z, 0xd8cba8);
    b.box('fabric', 0.12 * s, 0.16 * s, 0.1 * s, x + 0.2 * s, y + (yy + 0.1) * s, z, 0xc8bb98);
    // 卷轴两端轴头：一根贯轴，两头各出头 0.03m
    for (const sx of [-1, 1]) b.box('metal', 0.18 * s, 0.018 * s, 0.018 * s, x + sx * 0.2 * s, y + (yy + 0.1) * s, z, shade(GOLD, 0.92));
  }
  b.kit('item.scrollRack', 1, y + 0.8);
};

/** 仪仗：斧钺（木柄 + 金属刃） */
export const axe: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.05 * s, 0.06 * s, 1.9 * s, 8, x, y + 0.95 * s, z, WOOD_D);
  b.box('metal', 0.4 * s, 0.34 * s, 0.05 * s, x + 0.2 * s, y + 1.72 * s, z, 0x9aa4ac);
  b.box('metal', 0.12 * s, 0.5 * s, 0.06 * s, x + 0.04 * s, y + 1.72 * s, z, 0x8a949c);
  b.kit('item.axe', 1, y + 1);
};

/** 旗幡：旗杆 + 布面 + 杆顶 */
export const flag: ItemBuilder = (b, x, y, z, s = 1, color = SILK) => {
  b.cyl('wood', 0.06 * s, 0.08 * s, 3.6 * s, 6, x, y + 1.8 * s, z, WOOD_D);
  b.box('fabric', 0.9 * s, 1.8 * s, 0.04 * s, x + 0.48 * s, y + 2.8 * s, z, color);
  b.box('glow', 0.14 * s, 1.8 * s, 0.01 * s, x + 0.48 * s, y + 2.8 * s, z + 0.03 * s, shade(color, 1.5));
  b.cyl('metal', 0.06 * s, 0.04 * s, 0.18 * s, 6, x, y + 3.66 * s, z, GOLD);
  // 旗面经线 ×3（±8%）+ 下缘包边（0.8×）
  for (let i = 0; i < 3; i++) b.box('fabric', 0.008 * s, 1.7 * s, 0.005 * s, x + (0.18 + i * 0.16) * s, y + 2.8 * s, z + 0.0225 * s, shade(color, i === 1 ? 0.92 : 1.08));
  b.box('fabric', 0.9 * s, 0.05 * s, 0.05 * s, x + 0.48 * s, y + 1.925 * s, z, shade(color, 0.8));
  b.kit('item.flag', 1, y + 2);
};

/** 玉玺：方印 + 钮 */
export const seal: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 0.24 * s, 0.2 * s, 0.24 * s, x, y + 0.1 * s, z, 0xc8d0c8);
  b.box('wall', 0.18 * s, 0.08 * s, 0.18 * s, x, y + 0.24 * s, z, 0xd8dcd8);
  b.cyl('metal', 0.08 * s, 0.1 * s, 0.12 * s, 8, x, y + 0.34 * s, z, GOLD);
  b.kit('item.seal', 1, y);
};

/** 编钟/钟：截面钟身 + 悬挂横梁 */
export const bell: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.16 * s, 0.26 * s, 0.46 * s, 10, x, y + 1.24 * s, z, BRONZE);
  b.cyl('metal', 0.1 * s, 0.16 * s, 0.1 * s, 8, x, y + 1.52 * s, z, BRONZE_D);
  b.box('wood', 0.07 * s, 0.3 * s, 0.07 * s, x, y + 1.66 * s, z, WOOD_D);
  // 钟身錾花环带 ×2（±13%）
  b.cyl('metal', 0.2334 * s, 0.2334 * s, 0.03 * s, 10, x, y + 1.15 * s, z, shade(BRONZE, 1.13), 0, 0, 0, true);
  b.cyl('metal', 0.1899 * s, 0.1899 * s, 0.03 * s, 10, x, y + 1.35 * s, z, shade(BRONZE, 0.87), 0, 0, 0, true);
  b.kit('item.bell', 1, y + 1.3);
};


/** 桌案：桌面 + 四腿 + 牙板 */
export const table: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 1.5 * s, 0.1 * s, 0.8 * s, x, y + 0.74 * s, z, 0x4a2a20);
  b.box('wood', 1.4 * s, 0.08 * s, 0.7 * s, x, y + 0.66 * s, z, WOOD_D);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('wood', 0.09 * s, 0.68 * s, 0.09 * s, x + sx * 0.64 * s, y + 0.34 * s, z + sz * 0.3 * s, WOOD_D);
  }
  b.box('wood', 1.3 * s, 0.09 * s, 0.05 * s, x, y + 0.58 * s, z, WOOD);
  // 案面推光条 ×2（1.25×）+ 边角磨损 ×2（0.85×）
  for (const sz of [-1, 1]) b.box('lacquer', 1.3 * s, 0.004 * s, 0.015 * s, x, y + 0.7925 * s, z + sz * 0.3 * s, shade(0x4a2a20, 1.25));
  for (const sx of [-1, 1]) b.box('lacquer', 0.05 * s, 0.006 * s, 0.03 * s, x + sx * 0.7 * s, y + 0.7925 * s, z - 0.36 * s, shade(0x4a2a20, 0.85), 0.4);
  b.kit('item.table', 1, y + 0.7);
};

/** 凳椅：座面 + 四腿 + 靠背（有背者为椅） */
export const stool: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.44 * s, 0.07 * s, 0.44 * s, x, y + 0.46 * s, z, WOOD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('wood', 0.06 * s, 0.44 * s, 0.06 * s, x + sx * 0.17 * s, y + 0.22 * s, z + sz * 0.17 * s, WOOD_D);
  }
  b.box('wood', 0.44 * s, 0.5 * s, 0.06 * s, x, y + 0.74 * s, z - 0.18 * s, WOOD_D);
  b.kit('item.stool', 1, y + 0.46);
};

/** 床榻：框 + 席面 + 枕 */
export const bed: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 2.0 * s, 0.14 * s, 1.0 * s, x, y + 0.36 * s, z, WOOD_D);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('wood', 0.1 * s, 0.34 * s, 0.1 * s, x + sx * 0.9 * s, y + 0.17 * s, z + sz * 0.42 * s, WOOD);
  }
  b.box('fabric', 1.86 * s, 0.1 * s, 0.9 * s, x, y + 0.46 * s, z, 0xd8d2c4);
  b.box('fabric', 0.5 * s, 0.12 * s, 0.32 * s, x - 0.7 * s, y + 0.55 * s, z, 0xcfc8b8);
  // 席面经线 ×3（±8%）+ 侧缘包边（0.8×）
  for (let i = 0; i < 3; i++) b.box('fabric', 1.8 * s, 0.005 * s, 0.008 * s, x, y + 0.5125 * s, z + (i - 1) * 0.24 * s, shade(0xd8d2c4, i === 1 ? 1.06 : 0.94));
  b.box('fabric', 1.86 * s, 0.05 * s, 0.02 * s, x, y + 0.47 * s, z + 0.45 * s, shade(0xd8d2c4, 0.8));
  b.kit('item.bed', 1, y + 0.4);
};

/** 伞盖：伞杆 + 伞面 + 八骨 */
export const umbrella: ItemBuilder = (b, x, y, z, s = 1, color = 0x9d2933) => {
  b.cyl('wood', 0.05 * s, 0.06 * s, 2.4 * s, 6, x, y + 1.2 * s, z, WOOD_D);
  b.cyl('fabric', 0.9 * s, 0.12 * s, 0.42 * s, 12, x, y + 2.5 * s, z, color);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('wood', 0.03 * s, 0.03 * s, 0.9 * s, x + Math.cos(a) * 0.45 * s, y + 2.42 * s, z + Math.sin(a) * 0.45 * s, WOOD_D, -a);
  }
  // 伞面缘包边 ×2（上缘 0.8×、杆端 0.9×）
  b.cyl('fabric', 0.9035 * s, 0.883 * s, 0.014 * s, 12, x, y + 2.706 * s, z, shade(color, 0.8), 0, 0, 0, true);
  b.cyl('fabric', 0.1458 * s, 0.1161 * s, 0.016 * s, 12, x, y + 2.294 * s, z, shade(color, 0.9), 0, 0, 0, true);
  b.kit('item.umbrella', 1, y + 2.4);
};

/** 团扇：扇柄 + 扇面 */
export const fan: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.025 * s, 0.03 * s, 0.4 * s, 6, x, y + 0.2 * s, z, WOOD_D);
  b.cyl('fabric', 0.3 * s, 0.3 * s, 0.02 * s, 12, x, y + 0.5 * s, z, 0xf0e6d2, 0, Math.PI / 2);
  b.cyl('lacquer', 0.31 * s, 0.31 * s, 0.015 * s, 12, x, y + 0.5 * s, z - 0.01 * s, 0x7a2c22, 0, Math.PI / 2);
  // 扇缘包边（0.8×）+ 扇面经线 ×2（±6%）
  b.cyl('fabric', 0.306 * s, 0.306 * s, 0.026 * s, 12, x, y + 0.5 * s, z, shade(0xf0e6d2, 0.8), 0, Math.PI / 2, 0, true);
  for (const sx of [-1, 1]) b.box('fabric', 0.006 * s, 0.2 * s, 0.004 * s, x + sx * 0.09 * s, y + 0.58 * s, z + 0.0115 * s, shade(0xf0e6d2, sx > 0 ? 1.06 : 0.94));
  b.kit('item.fan', 1, y + 0.5);
};

/** 兵器：木柄 + 刃（按 kind 区分枪/刀/戟） */
export const weapon = (b: Baker, x: number, y: number, z: number, s = 1, kind = 0): void => {
  b.cyl('wood', 0.04 * s, 0.05 * s, 2.1 * s, 6, x, y + 1.05 * s, z, 0x3a2c22);
  if (kind === 0) {
    b.box('metal', 0.1 * s, 0.5 * s, 0.03 * s, x, y + 2.32 * s, z, 0x9aa4ac);
  } else if (kind === 1) {
    b.box('metal', 0.22 * s, 0.7 * s, 0.04 * s, x + 0.08 * s, y + 2.2 * s, z, 0x9aa4ac);
    b.box('wood', 0.28 * s, 0.08 * s, 0.09 * s, x, y + 1.86 * s, z, 0x5a3a24);
  } else {
    b.box('metal', 0.16 * s, 0.44 * s, 0.04 * s, x + 0.1 * s, y + 2.3 * s, z, 0xaab4bc);
    b.box('metal', 0.3 * s, 0.1 * s, 0.04 * s, x - 0.08 * s, y + 2.1 * s, z, 0xaab4bc);
  }
  b.kit('item.weapon', 1, y + 1);
};

/** 书卷：三卷堆叠 + 函套 */
export const book: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) {
    b.cyl('fabric', 0.07 * s, 0.07 * s, 0.5 * s, 8, x, y + 0.07 * s + i * 0.09 * s, z, 0xd8cba8, Math.PI / 2);
    b.box('wood', 0.52 * s, 0.02 * s, 0.16 * s, x, y + 0.02 * s + i * 0.09 * s, z, 0x6a4a2e);
  }
  b.box('lacquer', 0.3 * s, 0.22 * s, 0.4 * s, x + 0.5 * s, y + 0.11 * s, z, 0x2e1a16);
  // 卷端金属轴头 + 纸纤维 ×3（±6%）
  b.cyl('metal', 0.046 * s, 0.06 * s, 0.026 * s, 6, x, y + 0.512 * s, z, GOLD);
  for (let i = 0; i < 3; i++) {
    const a = 0.3927 + i * 0.7854, rr = 0.0662 * s;
    b.box('fabric', 0.006 * s, 0.34 * s, 0.005 * s, x + Math.cos(a) * rr, y + 0.3 * s, z + Math.sin(a) * rr, shade(0xd8cba8, i % 2 ? 1.06 : 0.94), Math.PI / 2 - a);
  }
  b.kit('item.book', 1, y + 0.15);
};

// ---------- 宴饮席面族（20 件）：酒茶器、炊器、席面陈设 ----------
const SILVER = 0xdcdce8;
const PORCELAIN = 0xf4ecd8;
const CELADON = 0x9fc4b0;
const COPPER = 0xb87333;
const MOKU = 0x26282c;
const BAMBOO = 0x8a5a2b;
const BAMBOO_L = 0xb89b5a;
const OILWOOD = 0x4a3220;
const IRON = 0x4a4e54;
const PAPER = 0xf4ecd8;
const INK = 0x2b2b2b;
const SEALRED = 0x9d2933;
const GRAYCERAMIC = 0x6a5f52;
const BLUESTONE = 0x7a7d72;
const BONE = 0xe8e3d5;

/** 银酒海：锤揲大碗 + 圈足 + 内壁酒面（C-ITM-0081 径 280mm 银 #DCDCE8） */
export const wineSea: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.155 * s, 0.1 * s, 0.09 * s, 14, x, y + 0.075 * s, z, SILVER);
  b.cyl('metal', 0.148 * s, 0.148 * s, 0.02 * s, 12, x, y + 0.12 * s, z, shade(SILVER, 1.08));
  b.cyl('metal', 0.135 * s, 0.135 * s, 0.006 * s, 10, x, y + 0.122 * s, z, shade(SILVER, 0.5));
  b.cyl('metal', 0.075 * s, 0.085 * s, 0.03 * s, 8, x, y + 0.015 * s, z, shade(SILVER, 0.78));
  // 锤揲錾花带（1.12×）+ 圈足包浆（0.6×）
  b.cyl('metal', 0.1341 * s, 0.1218 * s, 0.02 * s, 14, x, y + 0.07 * s, z, shade(SILVER, 1.12), 0, 0, 0, true);
  b.cyl('metal', 0.0845 * s, 0.0845 * s, 0.014 * s, 8, x, y + 0.015 * s, z, shade(SILVER, 0.6), 0, 0, 0, true);
  b.kit('item.serve.wineSea', 1, y);
};

/** 果菜碟：白瓷小碟 + 刻花填影青（C-ITM-0083 径 120mm） */
export const fruitDish: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.11 * s, 0.08 * s, 0.026 * s, 12, x, y + 0.02 * s, z, PORCELAIN);
  b.cyl('ceramic', 0.05 * s, 0.055 * s, 0.012 * s, 8, x, y + 0.006 * s, z, shade(PORCELAIN, 0.9));
  b.box('ceramic', 0.09 * s, 0.004 * s, 0.012 * s, x, y + 0.033 * s, z, CELADON, 0.5);
  b.box('ceramic', 0.012 * s, 0.004 * s, 0.09 * s, x, y + 0.033 * s, z, CELADON, 0.5);
  // 口沿亮釉圈 + 碟壁开片 ×2
  b.cyl('ceramic', 0.1125 * s, 0.1125 * s, 0.008 * s, 12, x, y + 0.03 * s, z, shade(PORCELAIN, 1.02), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 2.618 : 0.7854, rr = (i ? 0.0877 : 0.0944) * s;
    b.box('ceramic', 0.036 * s, 0.006 * s, 0.004 * s, x + Math.cos(a) * rr, y + (i ? 0.016 : 0.022) * s, z + Math.sin(a) * rr, shade(PORCELAIN, i ? 0.9 : 1.08), Math.PI / 2 - a, 0, i ? 0.3 : -0.3);
  }
  b.kit('item.serve.fruitDish', 1, y);
};

/** 注子：白瓷执壶 + 曲柄 + 外撇流（C-ITM-0105 高 180mm） */
export const ewer: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.055 * s, 0.075 * s, 0.11 * s, 10, x, y + 0.075 * s, z, PORCELAIN);
  b.cyl('ceramic', 0.032 * s, 0.05 * s, 0.05 * s, 8, x, y + 0.155 * s, z, PORCELAIN);
  b.cyl('ceramic', 0.036 * s, 0.036 * s, 0.014 * s, 8, x, y + 0.187 * s, z, shade(PORCELAIN, 0.94));
  b.box('ceramic', 0.014 * s, 0.09 * s, 0.02 * s, x - 0.062 * s, y + 0.13 * s, z, PORCELAIN);
  b.cyl('ceramic', 0.012 * s, 0.022 * s, 0.075 * s, 6, x + 0.062 * s, y + 0.14 * s, z, PORCELAIN, 0, 0, -0.9);
  b.cyl('ceramic', 0.042 * s, 0.048 * s, 0.012 * s, 8, x, y + 0.006 * s, z, shade(PORCELAIN, 0.86));
  // 口沿亮釉圈 + 腹壁开片 ×2
  b.cyl('ceramic', 0.0395 * s, 0.0395 * s, 0.008 * s, 8, x, y + 0.1905 * s, z, shade(PORCELAIN, 1.0), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 4.712 : 1.571, rr = (i ? 0.059 : 0.0659) * s;
    b.box('ceramic', 0.03 * s, 0.006 * s, 0.004 * s, x + Math.cos(a) * rr, y + (i ? 0.1 : 0.06) * s, z + Math.sin(a) * rr, shade(PORCELAIN, i ? 0.9 : 1.08), Math.PI / 2 - a, 0, i ? 0.3 : -0.3);
  }
  b.kit('item.serve.ewer', 1, y);
};

/** 食盒：竹篾三层提盒 + 藤缠提梁（C-ITM-0106 篾宽 2mm） */
export const foodBox: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) b.box('wood', 0.22 * s, 0.085 * s, 0.22 * s, x, y + (0.045 + i * 0.09) * s, z, i % 2 ? BAMBOO_L : BAMBOO);
  b.box('wood', 0.24 * s, 0.028 * s, 0.24 * s, x, y + 0.31 * s, z, shade(BAMBOO, 0.86));
  for (const sx of [-1, 1]) b.box('wood', 0.018 * s, 0.16 * s, 0.018 * s, x + sx * 0.1 * s, y + 0.4 * s, z, OILWOOD);
  b.box('wood', 0.22 * s, 0.018 * s, 0.018 * s, x, y + 0.48 * s, z, OILWOOD);
  b.box('fabric', 0.06 * s, 0.05 * s, 0.03 * s, x, y + 0.47 * s, z, 0x8a6a3a);
  b.kit('item.serve.foodBox', 1, y);
};

/** 茶汤炉：铜皮炭炉 + 三足 + 炉口炭光（C-ITM-0107 铜 #B87333） */
export const teaStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.19 * s, 0.21 * s, 0.26 * s, 12, x, y + 0.21 * s, z, COPPER);
  b.cyl('metal', 0.22 * s, 0.22 * s, 0.04 * s, 12, x, y + 0.36 * s, z, shade(COPPER, 1.08));
  b.cyl('glow', 0.13 * s, 0.13 * s, 0.03 * s, 10, x, y + 0.385 * s, z, 0xff7f50);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    b.box('metal', 0.04 * s, 0.09 * s, 0.04 * s, x + Math.cos(a) * 0.17 * s, y + 0.045 * s, z + Math.sin(a) * 0.17 * s, shade(COPPER, 0.72));
  }
  b.box('metal', 0.3 * s, 0.012 * s, 0.02 * s, x, y + 0.375 * s, z, IRON, 0.6);
  // 炉身錾花带（1.12×）+ 口沿暗线（0.82×）
  b.cyl('metal', 0.203 * s, 0.203 * s, 0.03 * s, 12, x, y + 0.21 * s, z, shade(COPPER, 1.12), 0, 0, 0, true);
  b.cyl('metal', 0.1948 * s, 0.1948 * s, 0.014 * s, 12, x, y + 0.33 * s, z, shade(COPPER, 0.82), 0, 0, 0, true);
  b.kit('item.serve.teaStove', 1, y);
};

/** 名酒单水牌：400×600 木牌 + 竖列酒名朱点（C-ITM-0096） */
export const wineBoard: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.42 * s, 0.6 * s, 0.03 * s, x, y + 0.93 * s, z, PAPER);
  b.box('wood', 0.46 * s, 0.04 * s, 0.05 * s, x, y + 1.25 * s, z, OILWOOD);
  b.box('wood', 0.46 * s, 0.04 * s, 0.05 * s, x, y + 0.61 * s, z, OILWOOD);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.05 * s, 0.62 * s, 0.05 * s, x + sx * 0.15 * s, y + 0.31 * s, z, OILWOOD);
    b.box('wood', 0.1 * s, 0.04 * s, 0.22 * s, x + sx * 0.15 * s, y + 0.02 * s, z, OILWOOD);
  }
  for (let i = 0; i < 4; i++) b.box('wood', 0.24 * s, 0.026 * s, 0.004 * s, x, y + (0.72 + i * 0.12) * s, z + 0.018 * s, INK);
  b.box('wood', 0.03 * s, 0.026 * s, 0.004 * s, x + 0.15 * s, y + 0.72 * s, z + 0.019 * s, SEALRED);
  // 纸纤维 ×4（±6%），填在竖列之间
  for (let i = 0; i < 4; i++) b.box('wood', 0.34 * s, 0.004 * s, 0.005 * s, x, y + (0.78 + i * 0.12) * s, z + 0.0165 * s, shade(PAPER, i % 2 ? 1.06 : 0.94));
  b.kit('item.serve.wineBoard', 1, y);
};

/** 账台：三面围合高 1.1m + 算盘账簿（C-ITM-0093） */
export const accountDesk: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 1.4 * s, 0.07 * s, 0.72 * s, x, y + 1.065 * s, z, OILWOOD);
  b.box('wood', 1.4 * s, 1.0 * s, 0.06 * s, x, y + 0.52 * s, z - 0.32 * s, shade(OILWOOD, 1.15));
  for (const sx of [-1, 1]) b.box('wood', 0.06 * s, 1.0 * s, 0.68 * s, x + sx * 0.67 * s, y + 0.52 * s, z - 0.02 * s, shade(OILWOOD, 1.05));
  b.box('wood', 1.2 * s, 0.05 * s, 0.5 * s, x, y + 0.52 * s, z - 0.05 * s, shade(OILWOOD, 0.9));
  b.box('wood', 0.36 * s, 0.02 * s, 0.2 * s, x - 0.3 * s, y + 1.11 * s, z + 0.06 * s, BAMBOO);
  for (let i = 0; i < 6; i++) b.box('wood', 0.03 * s, 0.03 * s, 0.02 * s, x - 0.42 * s + i * 0.048 * s, y + 1.135 * s, z + 0.06 * s, shade(BAMBOO, 0.8));
  b.box('fabric', 0.26 * s, 0.02 * s, 0.34 * s, x + 0.3 * s, y + 1.11 * s, z + 0.05 * s, PAPER);
  // 台面推光条 ×2（1.3×）+ 前缘磨损 ×2（0.85×）
  for (const sz of [-1, 1]) b.box('lacquer', 1.3 * s, 0.004 * s, 0.015 * s, x, y + 1.1025 * s, z + sz * 0.3 * s, shade(OILWOOD, 1.3));
  for (const sx of [-1, 1]) b.box('lacquer', 0.05 * s, 0.006 * s, 0.03 * s, x + sx * 0.64 * s, y + 1.1025 * s, z + 0.33 * s, shade(OILWOOD, 0.85), 0.5);
  b.kit('item.serve.accountDesk', 1, y);
};

/** 小账台：800×500 台面 + 账簿笔架算盘（C-ITM-0108） */
export const accountDeskSmall: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.8 * s, 0.05 * s, 0.5 * s, x, y + 0.83 * s, z, OILWOOD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.05 * s, 0.81 * s, 0.05 * s, x + sx * 0.35 * s, y + 0.405 * s, z + sz * 0.2 * s, shade(OILWOOD, 1.1));
  b.box('fabric', 0.24 * s, 0.025 * s, 0.3 * s, x - 0.16 * s, y + 0.868 * s, z, PAPER);
  b.cyl('wood', 0.035 * s, 0.04 * s, 0.1 * s, 8, x + 0.26 * s, y + 0.905 * s, z - 0.1 * s, BAMBOO);
  b.cyl('wood', 0.008 * s, 0.012 * s, 0.2 * s, 6, x + 0.26 * s, y + 1.02 * s, z - 0.1 * s, OILWOOD, 0, 0, 0.15);
  b.box('wood', 0.26 * s, 0.018 * s, 0.16 * s, x + 0.2 * s, y + 0.865 * s, z + 0.16 * s, BAMBOO);
  // 台面推光条（1.3×）+ 边角磨损 ×2（0.85×）
  b.box('lacquer', 0.7 * s, 0.004 * s, 0.015 * s, x, y + 0.8575 * s, z + 0.18 * s, shade(OILWOOD, 1.3));
  for (const sx of [-1, 1]) b.box('lacquer', 0.04 * s, 0.006 * s, 0.026 * s, x + sx * 0.36 * s, y + 0.8575 * s, z - 0.2 * s, shade(OILWOOD, 0.85), 0.45);
  b.kit('item.serve.accountDeskSmall', 1, y);
};

/** 天井水缸：灰陶厚壁太平缸 + 水面（C-ITM-0111 高 1.1m） */
export const waterVat: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.55 * s, 0.42 * s, 1.0 * s, 14, x, y + 0.5 * s, z, GRAYCERAMIC);
  b.cyl('ceramic', 0.58 * s, 0.56 * s, 0.08 * s, 14, x, y + 1.04 * s, z, shade(GRAYCERAMIC, 1.12));
  b.cyl('water', 0.5 * s, 0.5 * s, 0.012 * s, 12, x, y + 0.95 * s, z, 0x24343a);
  b.cyl('ceramic', 0.36 * s, 0.4 * s, 0.06 * s, 10, x, y + 0.03 * s, z, shade(GRAYCERAMIC, 0.86));
  // 缸沿亮釉圈 + 缸壁开片 ×2
  b.cyl('ceramic', 0.5751 * s, 0.5751 * s, 0.02 * s, 14, x, y + 1.045 * s, z, shade(GRAYCERAMIC, 1.3), 0, 0, 0, true);
  for (let i = 0; i < 2; i++) {
    const a = i ? 2.918 : 0.673, rr = (i ? 0.4553 : 0.4807) * s;
    b.box('ceramic', 0.07 * s, 0.012 * s, 0.005 * s, x + Math.cos(a) * rr, y + (i ? 0.35 : 0.55) * s, z + Math.sin(a) * rr, shade(GRAYCERAMIC, i ? 0.9 : 1.1), Math.PI / 2 - a, 0, i ? 0.5 : -0.5);
  }
  b.kit('item.serve.waterVat', 1, y);
};

/** 马槽：青石整凿槽体 + 木草料架（C-ITM-0109 槽长 1.5m） */
export const manger: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.5 * s, 0.3 * s, 0.12 * s, x, y + 0.2 * s, z - 0.22 * s, BLUESTONE);
  b.box('ash', 1.5 * s, 0.3 * s, 0.12 * s, x, y + 0.2 * s, z + 0.22 * s, BLUESTONE);
  for (const sx of [-1, 1]) b.box('ash', 0.12 * s, 0.3 * s, 0.56 * s, x + sx * 0.69 * s, y + 0.2 * s, z, shade(BLUESTONE, 0.92));
  b.box('ash', 1.36 * s, 0.06 * s, 0.44 * s, x, y + 0.06 * s, z, shade(BLUESTONE, 0.84));
  for (const sx of [-1, 1]) b.box('wood', 0.07 * s, 0.42 * s, 0.07 * s, x + sx * 0.6 * s, y + 0.5 * s, z - 0.24 * s, OILWOOD);
  b.box('wood', 1.3 * s, 0.06 * s, 0.06 * s, x, y + 0.7 * s, z - 0.24 * s, OILWOOD);
  b.box('leaf', 0.6 * s, 0.1 * s, 0.3 * s, x - 0.2 * s, y + 0.36 * s, z, 0xb89b46);
  b.kit('item.serve.manger', 1, y);
};

/** 香插石钵：石钵 + 香脚如林 + 微光香头（D-ITM-0049 钵径 0.5m） */
export const incenseBowl: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ash', 0.25 * s, 0.17 * s, 0.16 * s, 12, x, y + 0.08 * s, z, 0x5b5f58);
  b.cyl('ash', 0.26 * s, 0.26 * s, 0.03 * s, 12, x, y + 0.17 * s, z, shade(0x5b5f58, 1.15));
  b.cyl('ash', 0.21 * s, 0.21 * s, 0.012 * s, 12, x, y + 0.18 * s, z, 0x8a8a80);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    b.box('wood', 0.008 * s, 0.22 * s, 0.008 * s, x + Math.cos(a) * 0.09 * s, y + 0.28 * s, z + Math.sin(a) * 0.09 * s, 0x6a4a2e, 0, 0, Math.cos(a) * 0.12);
    b.box('glow', 0.012 * s, 0.012 * s, 0.012 * s, x + Math.cos(a) * 0.1 * s, y + 0.39 * s, z + Math.sin(a) * 0.1 * s, 0xffc66e);
  }
  b.kit('item.serve.incenseBowl', 1, y);
};

/** 汤锅：墨铜大锅 + 三石支锅 + 汤面（D-ITM-0030 径 2.4m，s 缩至灶间尺度） */
export const soupCauldron: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 1.2 * s, 0.95 * s, 0.85 * s, 14, x, y + 0.55 * s, z, MOKU);
  b.cyl('metal', 1.26 * s, 1.24 * s, 0.08 * s, 12, x, y + 0.98 * s, z, shade(MOKU, 1.3));
  b.cyl('water', 1.14 * s, 1.14 * s, 0.012 * s, 12, x, y + 0.94 * s, z, 0x3a1f1f);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.cyl('ash', 0.08 * s, 0.13 * s, 0.22 * s, 6, x + Math.cos(a) * 0.86 * s, y + 0.11 * s, z + Math.sin(a) * 0.86 * s, 0x5b5f58);
  }
  // 锅身錾花环带 ×2（铜色，贴外壁 0.006m）
  b.cyl('metal', 1.052 * s, 1.052 * s, 0.03 * s, 14, x, y + 0.45 * s, z, shade(BRONZE, 1.1), 0, 0, 0, true);
  b.cyl('metal', 1.149 * s, 1.149 * s, 0.03 * s, 14, x, y + 0.78 * s, z, shade(BRONZE, 0.9), 0, 0, 0, true);
  b.kit('item.serve.soupCauldron', 1, y);
};

/** 汤勺：整木挖勺 + 斜柄（D-ITM-0036 柄长 1.2m） */
export const soupLadle: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.11 * s, 0.085 * s, 0.09 * s, 10, x, y + 0.045 * s, z, 0x4a3c33);
  b.cyl('wood', 0.115 * s, 0.115 * s, 0.014 * s, 10, x, y + 0.095 * s, z, shade(0x4a3c33, 1.2), 0, 0, 0, true);
  b.cyl('wood', 0.016 * s, 0.022 * s, 1.0 * s, 6, x + 0.38 * s, y + 0.5 * s, z, 0x4a3c33, 0, 0, 1.1);
  b.kit('item.serve.soupLadle', 1, y);
};

/** 柴垛：骨柴与纸柴混垛 + 捆绳（D-ITM-0037） */
export const firewoodStack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      const bone = (i + row) % 3 === 0;
      b.box(bone ? 'ash' : 'wood', 0.5 * s, 0.11 * s, 0.11 * s, x - 0.27 * s + (row % 2) * 0.12 * s + i * 0.02 * s, y + (0.06 + row * 0.115) * s, z - 0.24 * s + i * 0.16 * s, bone ? BONE : 0xc9b380, (i % 2 ? 1 : -1) * 0.08);
    }
  }
  b.box('fabric', 0.03 * s, 0.36 * s, 0.72 * s, x + 0.1 * s, y + 0.2 * s, z, 0x4a3c33);
  b.kit('item.serve.firewoodStack', 1, y);
};

/** 引水竹枧：九米打通竹节 + 三栈架（D-ITM-0038） */
export const bambooFlume: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) b.cyl('wood', 0.07 * s, 0.07 * s, 3.0 * s, 8, x - 3.0 * s + i * 3.0 * s, y + 0.62 * s, z, BAMBOO, 0, Math.PI / 2);
  for (let i = 0; i < 2; i++) b.cyl('wood', 0.085 * s, 0.085 * s, 0.12 * s, 8, x - 1.5 * s + i * 3.0 * s, y + 0.62 * s, z, shade(BAMBOO, 0.85), 0, Math.PI / 2);
  for (const sx of [-1, 0, 1]) {
    b.box('wood', 0.07 * s, 0.56 * s, 0.07 * s, x + sx * 3.0 * s, y + 0.28 * s, z, OILWOOD);
    b.box('wood', 0.1 * s, 0.06 * s, 0.42 * s, x + sx * 3.0 * s, y + 0.56 * s, z, OILWOOD);
  }
  b.kit('item.serve.bambooFlume', 1, y);
};

/** 灶膛双眼：砖砌灶体 + 双眼灶口 + 烟道（D-ITM-0039） */
export const stoveEyes: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 1.5 * s, 0.66 * s, 0.8 * s, x, y + 0.33 * s, z, 0x5a6472);
  b.box('ash', 1.6 * s, 0.09 * s, 0.9 * s, x, y + 0.72 * s, z, BLUESTONE);
  for (const sx of [-1, 1]) b.box('glow', 0.34 * s, 0.2 * s, 0.04 * s, x + sx * 0.34 * s, y + 0.26 * s, z + 0.41 * s, 0xff7f50);
  b.box('wall', 0.26 * s, 0.9 * s, 0.26 * s, x - 0.52 * s, y + 1.15 * s, z - 0.2 * s, shade(0x5a6472, 0.9));
  b.box('metal', 0.26 * s, 0.02 * s, 0.26 * s, x - 0.52 * s, y + 1.62 * s, z - 0.2 * s, IRON);
  b.box('ash', 0.4 * s, 0.05 * s, 0.34 * s, x, y + 0.79 * s, z + 0.2 * s, shade(BLUESTONE, 0.9));
  b.kit('item.serve.stoveEyes', 1, y);
};

/** 取汤竹筹：竹筒 + 铜箍 + 三十六筹（D-ITM-0042） */
export const soupTokens: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.1 * s, 0.105 * s, 0.3 * s, 8, x, y + 0.15 * s, z, BAMBOO, 0, 0, 0, true);
  b.cyl('wood', 0.1 * s, 0.1 * s, 0.02 * s, 8, x, y + 0.015 * s, z, shade(BAMBOO, 0.8));
  b.cyl('metal', 0.108 * s, 0.108 * s, 0.03 * s, 8, x, y + 0.27 * s, z, COPPER);
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4;
    b.box('wood', 0.012 * s, 0.22 * s, 0.012 * s, x + Math.cos(a) * 0.06 * s, y + 0.34 * s, z + Math.sin(a) * 0.06 * s, shade(BAMBOO, 1 - (i % 3) * 0.08));
    if (i % 2 === 0) b.box('lacquer', 0.016 * s, 0.03 * s, 0.016 * s, x + Math.cos(a) * 0.06 * s, y + 0.45 * s, z + Math.sin(a) * 0.06 * s, i % 4 === 0 ? 0xb03a2e : 0x6e1f1f);
  }
  b.kit('item.serve.soupTokens', 1, y);
};

/** 忘川茶账：纸页账簿 + 墨栏 + 指印（D-ITM-0033 册 0.3×0.4m） */
export const teaLedger: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('fabric', 0.3 * s, 0.05 * s, 0.4 * s, x, y + 0.025 * s, z, 0xc9b380);
  b.box('lacquer', 0.31 * s, 0.012 * s, 0.41 * s, x, y + 0.056 * s, z, OILWOOD);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.22 * s, 0.002 * s, 0.012 * s, x, y + 0.063 * s, z - 0.08 * s + i * 0.08 * s, INK);
  b.box('lacquer', 0.03 * s, 0.003 * s, 0.03 * s, x + 0.1 * s, y + 0.064 * s, z + 0.12 * s, 0x6e1f1f);
  // 封面推光条 ×2（1.3×）+ 边角磨损 ×2（0.85×）
  for (const sz of [-1, 1]) b.box('lacquer', 0.26 * s, 0.004 * s, 0.014 * s, x, y + 0.0645 * s, z + sz * 0.13 * s, shade(OILWOOD, 1.3));
  for (const sx of [-1, 1]) b.box('lacquer', 0.03 * s, 0.006 * s, 0.02 * s, x + sx * 0.14 * s, y + 0.0645 * s, z - sx * 0.19 * s, shade(OILWOOD, 0.85), 0.4);
  b.kit('item.serve.teaLedger', 1, y);
};

/** 孟婆位：草编蒲团位 + 织面无纹（D-ITM-0032） */
export const soupMat: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('fabric', 0.34 * s, 0.38 * s, 0.1 * s, 14, x, y + 0.05 * s, z, 0x4a3c33);
  b.cyl('fabric', 0.32 * s, 0.32 * s, 0.03 * s, 14, x, y + 0.115 * s, z, shade(0x4a3c33, 1.25));
  b.cyl('fabric', 0.3 * s, 0.3 * s, 0.014 * s, 12, x, y + 0.137 * s, z, shade(0x4a3c33, 0.8), 0, 0, 0, true);
  // 顶面经线 ×3（±8%）+ 底缘包边（0.8×）
  for (let i = 0; i < 3; i++) b.box('fabric', 0.008 * s, 0.005 * s, 0.6 * s, x, y + 0.1325 * s, z, shade(0x4a3c33, i === 1 ? 1.08 : 0.92), (i / 3) * Math.PI);
  b.cyl('fabric', 0.3715 * s, 0.3795 * s, 0.02 * s, 14, x, y + 0.02 * s, z, shade(0x4a3c33, 0.8), 0, 0, 0, true);
  b.kit('item.serve.soupMat', 1, y);
};

/** 小阁子：木雕格扇围合（直棂 + 一朵牡丹，C-ITM-0103 比正店降三档） */
export const latticeBooth: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.8 * s, 0.08 * s, 0.1 * s, x, y + 2.16 * s, z, OILWOOD);
  b.box('wood', 1.8 * s, 0.08 * s, 0.1 * s, x, y + 0.04 * s, z, OILWOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 2.2 * s, 0.1 * s, x + sx * 0.86 * s, y + 1.1 * s, z, OILWOOD);
  for (let i = 0; i < 5; i++) b.box('wood', 0.04 * s, 2.0 * s, 0.05 * s, x - 0.6 * s + i * 0.3 * s, y + 1.1 * s, z, shade(0x6b4a2b, 1.05));
  b.box('wood', 0.16 * s, 0.16 * s, 0.04 * s, x, y + 1.5 * s, z + 0.04 * s, SEALRED);
  b.box('wood', 0.1 * s, 0.1 * s, 0.05 * s, x, y + 1.5 * s, z + 0.04 * s, 0xffb7c5);
  b.box('wood', 0.4 * s, 0.5 * s, 0.06 * s, x, y + 0.34 * s, z, shade(OILWOOD, 1.05));
  b.kit('item.serve.latticeBooth', 1, y);
};

// ---------- 二批器物（23 件）：天宫宝器 7 / 人间建筑附属 8 / 地府石作 8 ----------
// 仅取资产卷里配色不含磷绿/霓虹自发光的条目，故可直落人间室内（三界光色纪律：
// 人间室内光 2700K 暖黄，DF-01 磷绿只属地府）。尺寸按卷内米制标称值，s 为落位缩放。
const IRONBLK = 0x26282c;  // 玄铁（T-ITM-0036 / D-ITM-0025 / D-ITM-0060）
const GILTCU = 0xd4a017;   // 铜鎏金垫件 #D4A017
const GILT = 0xffd700;     // 贴金 #FFD700
const JADEWH = 0xf2efe9;   // 白玉 #F2EFE9
const CYANJADE = 0x7fffd4; // 外环青玉 #7FFFD4
const PURPJADE = 0x4b0082; // 内环紫玉 #4B0082
const ZIJIN = 0xb87333;    // 紫金砂铜 #B87333
const SANDAL = 0x4a3220;   // 檀木/桐油深褐 #4A3220
const BLOODCY = 0x7e2a20;  // 血柏朱 #7E2A20
const RUST = 0x6e1f1f;   // 锈层 #6E1F1F
const BONEWH = 0xe8e3d5;   // 骨白 #E8E3D5
const MINGSTONE = 0x33393f; // 冥石/碑身 #33393F
const BAMBOO2 = 0x8a5a2b;  // 竹 #8A5A2B

/** 长柄火钳：2m 锻打玄铁柄 + 云纹钳头 + 柄尾铜箍（T-ITM-0036） */
export const fireTongs: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.032 * s, 0.044 * s, 2.0 * s, 6, x, y + 1.02 * s, z, IRONBLK, 0, 0, 0.05);
  b.cyl('metal', 0.05 * s, 0.05 * s, 0.075 * s, 6, x - 0.05 * s, y + 0.04 * s, z, GILTCU);
  b.box('metal', 0.11 * s, 0.06 * s, 0.07 * s, x + 0.05 * s, y + 2.02 * s, z, shade(IRONBLK, 0.82));
  for (const sx of [-1, 1]) {
    b.box('metal', 0.028 * s, 0.4 * s, 0.05 * s, x + 0.05 * s + sx * 0.06 * s, y + 2.22 * s, z, shade(IRONBLK, 1.14), 0, 0, sx * 0.12);
    b.box('metal', 0.012 * s, 0.3 * s, 0.056 * s, x + 0.05 * s + sx * 0.085 * s, y + 2.24 * s, z, shade(IRONBLK, 1.3), 0, 0, sx * 0.12);
  }
  b.kit('item.tiangong.fireTongs', 1, y);
};

/** 捣药玉钵：青玉钵 径 220 壁厚 8 + 歌诀银泥环带 ×2 + 木托座 + 玉杵（T-ITM-0057） */
export const jadeMortar: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.28 * s, 0.05 * s, 0.28 * s, x, y + 0.025 * s, z, SANDAL);
  b.cyl('ceramic', 0.11 * s, 0.088 * s, 0.17 * s, 12, x, y + 0.135 * s, z, 0x9fc4b0);
  b.cyl('ceramic', 0.116 * s, 0.116 * s, 0.014 * s, 12, x, y + 0.227 * s, z, shade(0x9fc4b0, 1.12), 0, 0, 0, true);
  b.cyl('ceramic', 0.09 * s, 0.09 * s, 0.014 * s, 12, x, y + 0.214 * s, z, shade(0x9fc4b0, 0.68));
  b.cyl('ceramic', 0.1095 * s, 0.1005 * s, 0.02 * s, 12, x, y + 0.163 * s, z, 0xdcdce8, 0, 0, 0, true);
  b.cyl('ceramic', 0.1045 * s, 0.0935 * s, 0.018 * s, 12, x, y + 0.115 * s, z, shade(0xdcdce8, 0.86), 0, 0, 0, true);
  b.cyl('ceramic', 0.016 * s, 0.026 * s, 0.32 * s, 6, x + 0.03 * s, y + 0.3 * s, z, shade(0x9fc4b0, 1.06), 0, 0, 1.2);
  b.kit('item.tiangong.jadeMortar', 1, y);
};

/** 白玉妆台：台高 900 白玉独面 + 立镜 400 镶玉框 + 铜托（T-ITM-0062） */
export const jadeVanity: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 1.0 * s, 0.07 * s, 0.46 * s, x, y + 0.865 * s, z, JADEWH);
  b.box('wood', 0.94 * s, 0.1 * s, 0.42 * s, x, y + 0.785 * s, z, SANDAL);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('wood', 0.065 * s, 0.74 * s, 0.065 * s, x + sx * 0.42 * s, y + 0.37 * s, z + sz * 0.16 * s, SANDAL);
  }
  b.box('lacquer', 0.5 * s, 0.1 * s, 0.05 * s, x, y + 0.68 * s, z + 0.2 * s, 0x2e1a16);
  b.box('metal', 0.12 * s, 0.03 * s, 0.03 * s, x, y + 0.68 * s, z + 0.235 * s, 0xffe08a);
  b.cyl('wall', 0.2 * s, 0.2 * s, 0.035 * s, 14, x, y + 1.26 * s, z - 0.14 * s, JADEWH, 0, Math.PI / 2);
  b.cyl('metal', 0.172 * s, 0.172 * s, 0.045 * s, 14, x, y + 1.26 * s, z - 0.125 * s, 0xb9c6cc, 0, Math.PI / 2);
  for (const sx of [-1, 1]) b.box('metal', 0.045 * s, 0.2 * s, 0.045 * s, x + sx * 0.16 * s, y + 1.0 * s, z - 0.16 * s, 0xffe08a);
  b.kit('item.tiangong.jadeVanity', 1, y);
};

/** 童子拂尘：檀柄缠金丝螺距 5mm + 柄尾铜帽 + 白马尾丝缕 + 立座（T-ITM-0037） */
export const whisk: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.14 * s, 0.03 * s, 0.14 * s, x, y + 0.015 * s, z, SANDAL);
  b.cyl('wood', 0.045 * s, 0.05 * s, 0.08 * s, 6, x, y + 0.06 * s, z, SANDAL);
  b.cyl('wood', 0.016 * s, 0.02 * s, 0.34 * s, 6, x, y + 0.28 * s, z, SANDAL);
  for (let i = 0; i < 2; i++) b.cyl('metal', 0.023 * s, 0.023 * s, 0.016 * s, 6, x, y + (0.2 + i * 0.13) * s, z, GILT);
  b.box('metal', 0.05 * s, 0.03 * s, 0.05 * s, x, y + 0.46 * s, z, GILTCU);
  b.cyl('fabric', 0.055 * s, 0.016 * s, 0.1 * s, 8, x, y + 0.52 * s, z, 0xf4ecd8);
  b.cyl('fabric', 0.012 * s, 0.062 * s, 0.3 * s, 8, x, y + 0.69 * s, z, 0xfaf6ea);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    b.box('fabric', 0.008 * s, 0.22 * s, 0.008 * s, x + Math.cos(a) * 0.04 * s, y + 0.6 * s, z + Math.sin(a) * 0.04 * s, shade(0xf4ecd8, i === 1 ? 1.06 : 0.94));
  }
  b.kit('item.tiangong.whisk', 1, y);
};

/** 璇玑玉衡天象仪：三层玉环 Ø600/450/300 + 铜枢轴 + 周天刻度（T-ITM-0013） */
export const armillary: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.14 * s, 0.18 * s, 0.07 * s, 10, x, y + 0.035 * s, z, GILTCU);
  b.box('metal', 0.1 * s, 0.1 * s, 0.1 * s, x, y + 0.12 * s, z, GILTCU);
  b.cyl('metal', 0.016 * s, 0.016 * s, 0.66 * s, 6, x, y + 0.44 * s, z, GILT);
  b.cyl('ceramic', 0.3 * s, 0.3 * s, 0.032 * s, 14, x, y + 0.44 * s, z, CYANJADE, 0, Math.PI / 2, 0, true);
  b.cyl('ceramic', 0.288 * s, 0.288 * s, 0.01 * s, 14, x, y + 0.44 * s, z, shade(CYANJADE, 1.25), 0, Math.PI / 2, 0, true);
  b.cyl('ceramic', 0.225 * s, 0.225 * s, 0.028 * s, 12, x, y + 0.44 * s, z, JADEWH, 0, 0, Math.PI / 2, true);
  b.cyl('ceramic', 0.15 * s, 0.15 * s, 0.026 * s, 12, x, y + 0.44 * s, z, PURPJADE, Math.PI / 3, Math.PI / 2, 0, true);
  for (const dy of [-0.16, 0.16]) b.cyl('metal', 0.03 * s, 0.03 * s, 0.026 * s, 6, x, y + (0.44 + dy) * s, z, GILTCU);
  b.box('metal', 0.05 * s, 0.03 * s, 0.1 * s, x + 0.3 * s, y + 0.44 * s, z, GILT);
  b.kit('item.tiangong.armillary', 1, y);
};

/** 紫金药葫芦：两球合范 + 腰束錾云箍 + 铜塞系带，大者高 0.8m（T-ITM-0029） */
export const gourd: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.15 * s, 0.105 * s, 0.34 * s, 10, x, y + 0.17 * s, z, ZIJIN);
  b.cyl('metal', 0.095 * s, 0.115 * s, 0.22 * s, 10, x, y + 0.45 * s, z, shade(ZIJIN, 1.06));
  b.cyl('metal', 0.106 * s, 0.106 * s, 0.05 * s, 10, x, y + 0.33 * s, z, shade(ZIJIN, 0.88));
  b.cyl('metal', 0.108 * s, 0.108 * s, 0.028 * s, 10, x, y + 0.33 * s, z, GILT, 0, 0, 0, true);
  b.cyl('metal', 0.034 * s, 0.044 * s, 0.055 * s, 6, x, y + 0.585 * s, z, GILTCU);
  b.box('metal', 0.05 * s, 0.03 * s, 0.012 * s, x + 0.03 * s, y + 0.5 * s, z, GILT);
  b.kit('item.tiangong.gourd', 1, y);
};

/** 金刚琢：环径 300 断面圆浑 + 内缘磨线 + 木托 + 锦匣铜扣（T-ITM-0030） */
export const vajraRing: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.155 * s, 0.155 * s, 0.055 * s, 16, x, y + 0.3 * s, z, 0xf8f2d8, 0, Math.PI / 2, 0, true);
  b.cyl('ceramic', 0.12 * s, 0.12 * s, 0.06 * s, 12, x, y + 0.3 * s, z, 0xffe08a, 0, Math.PI / 2, 0, true);
  b.box('wood', 0.3 * s, 0.03 * s, 0.18 * s, x, y + 0.02 * s, z, SANDAL);
  for (const sx of [-1, 1]) b.box('wood', 0.03 * s, 0.14 * s, 0.05 * s, x + sx * 0.11 * s, y + 0.1 * s, z, SANDAL);
  b.box('lacquer', 0.22 * s, 0.09 * s, 0.16 * s, x + 0.24 * s, y + 0.045 * s, z, 0x2e1a16);
  b.box('fabric', 0.18 * s, 0.03 * s, 0.12 * s, x + 0.24 * s, y + 0.085 * s, z, 0x9d2933);
  b.box('metal', 0.04 * s, 0.02 * s, 0.02 * s, x + 0.3 * s, y + 0.1 * s, z, GILTCU);
  b.kit('item.tiangong.vajraRing', 1, y);
};

/** 匾额通用件：黑漆匾板 + 阳线一道 + 挂环铜钩 + 挂梁；y 为匾下缘，dir=±1 定挂梁朝 +z/-z 一侧 */
function plaque(b: Baker, x: number, y: number, z: number, w: number, h: number, s: number, edge: number, dir: number, strap: number): void {
  const cy = y + h * 0.5 * s;
  b.box('lacquer', w * s, h * s, 0.1 * s, x, cy, z, 0x2b2b2b);
  b.box('lacquer', w * s + 0.1 * s, 0.09 * s, 0.12 * s, x, cy + h * 0.5 * s, z + dir * 0.005 * s, edge);
  b.box('lacquer', w * s + 0.1 * s, 0.09 * s, 0.12 * s, x, cy - h * 0.5 * s, z + dir * 0.005 * s, edge);
  for (const sx of [-1, 1]) b.box('lacquer', 0.09 * s, h * s, 0.12 * s, x + sx * w * 0.5 * s, cy, z + dir * 0.005 * s, edge);
  for (const sx of [-1, 1]) b.box('metal', 0.05 * s, 0.12 * s, 0.14 * s, x + sx * w * 0.34 * s, cy + h * 0.42 * s, z + dir * 0.09 * s, 0x4a4e54);
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 0.06 * s, strap * s, x + sx * w * 0.34 * s, cy + h * 0.42 * s, z + dir * (0.05 + strap * 0.5) * s, 0x3a2c22);
}

/** 匾额「孫羊正店」：黑漆 8 道 + 贴金字面 + 起阳线 + 铜挂环（C-ITM-0079） */
export const plaqueSunyang: ItemBuilder = (b, x, y, z, s = 1) => {
  plaque(b, x, y, z, 5.9, 1.55, s, 0x8a6a3a, -1, 0.14);
  b.kit('item.renjian.plaqueSunyang', 1, y);
};

/** 匾「明鏡高懸」：黑漆底 + 回纹阳线 + 铜挂环 + 门楣挂梁（C-ITM-0185） */
export const plaqueYamen: ItemBuilder = (b, x, y, z, s = 1) => {
  plaque(b, x, y, z, 4.7, 1.3, s, 0x7a2c22, 1, 0.4);
  b.kit('item.renjian.plaqueYamen', 1, y);
};

/** 栏杆隔断：低栏 700 + 寻杖 + 万字纹棒料 + 抱柱脚（C-ITM-0086） */
export const railingScreen: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 3.4 * s, 0.08 * s, 0.1 * s, x, y + 0.66 * s, z, 0x8b5e3c);
  b.box('wood', 3.36 * s, 0.06 * s, 0.08 * s, x, y + 0.1 * s, z, SANDAL);
  for (let i = 0; i <= 8; i++) b.box('wood', 0.03 * s, 0.5 * s, 0.03 * s, x - 1.6 * s + i * 0.4 * s, y + 0.38 * s, z, shade(0x6b4a2b, i % 2 ? 1.06 : 0.94));
  for (let i = 0; i < 4; i++) b.box('wood', 0.3 * s, 0.03 * s, 0.026 * s, x - 1.4 * s + i * 0.8 * s, y + 0.5 * s, z, 0x6b4a2b);
  for (const sx of [-1, 1]) b.box('wood', 0.09 * s, 0.74 * s, 0.12 * s, x + sx * 1.68 * s, y + 0.37 * s, z, SANDAL);
  b.kit('item.renjian.railingScreen', 1, y);
};

/** 水火棍：四根半红半黑棍身 + 麻束棍头 + 木靠架（C-ITM-0187，原制八根取四） */
export const waterFireSticks: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 4; i++) {
    const ox = -0.18 + i * 0.12;
    b.cyl('lacquer', 0.026 * s, 0.03 * s, 0.52 * s, 5, x + ox * s, y + 0.28 * s, z, 0xa63a2b, 0, 0, 0.06);
    b.cyl('lacquer', 0.028 * s, 0.024 * s, 0.5 * s, 5, x + (ox - 0.03) * s, y + 0.79 * s, z, 0x2b2b2b, 0, 0, 0.06);
    b.box('fabric', 0.06 * s, 0.1 * s, 0.06 * s, x + (ox - 0.06) * s, y + 1.06 * s, z, 0xbfae86);
  }
  b.box('wood', 0.42 * s, 0.05 * s, 0.08 * s, x, y + 0.02 * s, z, SANDAL);
  b.box('wood', 0.42 * s, 0.05 * s, 0.06 * s, x, y + 0.6 * s, z - 0.12 * s, SANDAL);
  b.kit('item.renjian.waterFireSticks', 1, y);
};

/** 登闻鼓：木桶板鼓身 + 牛皮双面 + 铁钉箍 + 木叉架（C-ITM-0188） */
export const petitionDrum: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.42 * s, 0.42 * s, 0.46 * s, 12, x, y + 0.86 * s, z, 0x6b4a2b);
  for (const sy of [-1, 1]) b.cyl('fabric', 0.445 * s, 0.445 * s, 0.035 * s, 12, x, y + (0.86 + sy * 0.235) * s, z, 0xd8cbb0);
  b.cyl('metal', 0.447 * s, 0.447 * s, 0.05 * s, 12, x, y + 0.86 * s, z, 0x4a4e54, 0, 0, 0, true);
  for (const sx of [-1, 1]) b.box('wood', 0.09 * s, 1.12 * s, 0.09 * s, x + sx * 0.46 * s, y + 0.56 * s, z, SANDAL);
  b.box('wood', 0.6 * s, 0.09 * s, 0.1 * s, x, y + 0.2 * s, z, SANDAL);
  for (const sx of [-1, 1]) b.box('wood', 0.24 * s, 0.07 * s, 0.4 * s, x + sx * 0.46 * s, y + 0.035 * s, z, SANDAL);
  b.kit('item.renjian.petitionDrum', 1, y);
};

/** 开道锣：铜锤揲锣体 + 翻卷锣边 + 锣心平底 + 木架与槌（C-ITM-0193） */
export const gong: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.34 * s, 0.34 * s, 0.035 * s, 12, x, y + 1.18 * s, z, ZIJIN, 0, Math.PI / 2);
  b.cyl('metal', 0.345 * s, 0.345 * s, 0.09 * s, 12, x, y + 1.18 * s, z, shade(ZIJIN, 0.86), 0, Math.PI / 2, 0, true);
  b.cyl('metal', 0.09 * s, 0.09 * s, 0.04 * s, 8, x, y + 1.18 * s, z + 0.03 * s, shade(ZIJIN, 1.25));
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 1.5 * s, 0.08 * s, x + sx * 0.42 * s, y + 0.75 * s, z - 0.06 * s, SANDAL);
  b.box('wood', 0.92 * s, 0.08 * s, 0.1 * s, x, y + 1.52 * s, z - 0.04 * s, SANDAL);
  for (const sx of [-1, 1]) b.box('wood', 0.16 * s, 0.06 * s, 0.5 * s, x + sx * 0.42 * s, y + 0.03 * s, z - 0.06 * s, SANDAL);
  b.cyl('wood', 0.014 * s, 0.016 * s, 0.32 * s, 5, x + 0.3 * s, y + 0.9 * s, z + 0.14 * s, SANDAL, 0, 0, 0.5);
  b.cyl('fabric', 0.05 * s, 0.05 * s, 0.1 * s, 6, x + 0.38 * s, y + 1.05 * s, z + 0.14 * s, 0x9d2933, 0, 0, 0.5);
  b.kit('item.renjian.gong', 1, y);
};

/** 马厩：青石整凿槽体八格 + 木栏分格 + 草料（C-ITM-0192） */
export const stable: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 8; i++) b.box('ash', 0.42 * s, 0.2 * s, 0.52 * s, x - 1.82 * s + i * 0.52 * s, y + 0.12 * s, z, 0x4e545e);
  for (let i = 0; i < 8; i++) b.box('wood', 0.05 * s, 1.0 * s, 0.05 * s, x - 2.08 * s + i * 0.52 * s, y + 0.5 * s, z, SANDAL);
  b.box('wood', 4.2 * s, 0.08 * s, 0.08 * s, x, y + 1.0 * s, z, SANDAL);
  b.box('wood', 4.2 * s, 0.06 * s, 0.06 * s, x, y + 0.5 * s, z, SANDAL);
  b.box('leaf', 0.7 * s, 0.09 * s, 0.3 * s, x - 0.8 * s, y + 0.26 * s, z + 0.02 * s, 0xb89b46);
  b.kit('item.renjian.stable', 1, y);
};

/** 三楼天阁凭栏：通长美人靠，曲木三段热弯弧面 + 坐面 + 端柱（C-ITM-0089） */
export const beautyRail: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 4.2 * s, 0.09 * s, 0.34 * s, x, y + 0.42 * s, z, 0x8b5e3c);
  b.box('wood', 4.2 * s, 0.1 * s, 0.1 * s, x, y + 0.5 * s, z + 0.2 * s, shade(0x8b5e3c, 0.9));
  for (let i = -1; i <= 1; i++) b.box('wood', 1.5 * s, 0.09 * s, 0.1 * s, x + i * 1.4 * s, y + 0.86 * s, z - 0.12 * s, shade(0x8b5e3c, 1.05), i * 0.12);
  for (let i = 0; i <= 5; i++) b.box('wood', 0.06 * s, 0.42 * s, 0.06 * s, x - 2.0 * s + i * 0.8 * s, y + 0.21 * s, z, SANDAL);
  b.box('wood', 4.2 * s, 0.07 * s, 0.07 * s, x, y + 0.12 * s, z + 0.15 * s, SANDAL);
  for (const sx of [-1, 1]) b.box('wood', 0.1 * s, 0.9 * s, 0.12 * s, x + sx * 2.1 * s, y + 0.45 * s, z, SANDAL);
  b.kit('item.renjian.beautyRail', 1, y);
};

/** 惊堂木：血柏木块 0.12×0.08 + 拍面磨平 + 中心凹陷 3mm + 木托（D-ITM-0006） */
export const gavel: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.16 * s, 0.025 * s, 0.12 * s, x, y + 0.0125 * s, z, SANDAL);
  b.box('lacquer', 0.12 * s, 0.07 * s, 0.085 * s, x, y + 0.06 * s, z, BLOODCY);
  b.box('lacquer', 0.125 * s, 0.012 * s, 0.09 * s, x, y + 0.1 * s, z, shade(BLOODCY, 1.2));
  b.box('lacquer', 0.05 * s, 0.008 * s, 0.05 * s, x, y + 0.093 * s, z, shade(BLOODCY, 0.78));
  for (const sx of [-1, 1]) b.box('lacquer', 0.016 * s, 0.03 * s, 0.06 * s, x + sx * 0.06 * s, y + 0.062 * s, z, shade(BLOODCY, 0.86));
  b.kit('item.difu.gavel', 1, y);
};

/** 判官朱笔：笔长 0.5m 血柏杆缠红绳 + 笔帽铜箍 + 笔锋 + 笔架（D-ITM-0007） */
export const vermilionBrush: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.3 * s, 0.03 * s, 0.14 * s, x, y + 0.015 * s, z, SANDAL);
  for (const sx of [-1, 1]) b.box('wood', 0.03 * s, 0.08 * s, 0.05 * s, x + sx * 0.09 * s, y + 0.06 * s, z, SANDAL);
  b.cyl('lacquer', 0.012 * s, 0.016 * s, 0.4 * s, 6, x, y + 0.11 * s, z, BLOODCY, 0, 0, Math.PI / 2);
  b.cyl('fabric', 0.018 * s, 0.018 * s, 0.2 * s, 6, x, y + 0.11 * s, z, RUST, 0, 0, Math.PI / 2, true);
  b.cyl('metal', 0.019 * s, 0.019 * s, 0.035 * s, 6, x + 0.19 * s, y + 0.11 * s, z, IRONBLK, 0, 0, Math.PI / 2);
  b.cyl('lacquer', 0.004 * s, 0.03 * s, 0.12 * s, 8, x - 0.26 * s, y + 0.11 * s, z, RUST, 0, 0, -Math.PI / 2);
  b.cyl('fabric', 0.02 * s, 0.02 * s, 0.03 * s, 6, x - 0.06 * s, y + 0.11 * s, z, 0x9d2933, 0, 0, Math.PI / 2);
  b.kit('item.difu.vermilionBrush', 1, y);
};

/** 善恶签筒：竹筒高 0.4 + 口沿铜箍 + 三色漆点竹签（D-ITM-0008，原制 36 支取 8） */
export const fateTube: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.076 * s, 0.076 * s, 0.4 * s, 8, x, y + 0.2 * s, z, BAMBOO2, 0, 0, 0, true);
  b.cyl('wood', 0.076 * s, 0.076 * s, 0.02 * s, 8, x, y + 0.01 * s, z, shade(BAMBOO2, 0.8));
  b.cyl('metal', 0.08 * s, 0.08 * s, 0.03 * s, 8, x, y + 0.385 * s, z, IRONBLK, 0, 0, 0, true);
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4 + 0.3, rr = i < 3 ? 0.03 : i < 6 ? 0.046 : 0.062;
    const tip = i < 3 ? BONEWH : i < 6 ? BLOODCY : 0x223a5e;
    b.box('wood', 0.012 * s, 0.26 * s, 0.012 * s, x + Math.cos(a) * rr * s, y + 0.5 * s, z + Math.sin(a) * rr * s, shade(BAMBOO2, 1 - (i % 3) * 0.06));
    b.box('lacquer', 0.014 * s, 0.035 * s, 0.014 * s, x + Math.cos(a) * rr * s, y + 0.64 * s, z + Math.sin(a) * rr * s, tip);
  }
  b.kit('item.difu.fateTube', 1, y);
};

/** 止步界桩：方柱三枚高 0.8 + 桩头刻字面（D-ITM-0052） */
export const boundaryPost: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) {
    const px = x - 0.6 * s + i * 0.6 * s;
    b.box('ash', 0.16 * s, 0.8 * s, 0.16 * s, px, y + 0.4 * s, z, MINGSTONE);
    b.box('ash', 0.19 * s, 0.07 * s, 0.19 * s, px, y + 0.835 * s, z, shade(MINGSTONE, 1.14));
    b.box('ash', 0.12 * s, 0.3 * s, 0.012 * s, px, y + 0.62 * s, z + 0.085 * s, BONEWH);
  }
  b.kit('item.difu.boundaryPost', 1, y);
};

/** 焚香鼎：双耳三足鼎高 0.9 + 香灰 + 香头暖点（D-ITM-0060） */
export const incenseDing: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.26 * s, 0.2 * s, 0.42 * s, 12, x, y + 0.47 * s, z, IRONBLK);
  b.cyl('metal', 0.285 * s, 0.285 * s, 0.07 * s, 12, x, y + 0.69 * s, z, shade(IRONBLK, 1.4), 0, 0, 0, true);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    b.cyl('metal', 0.05 * s, 0.07 * s, 0.26 * s, 6, x + Math.cos(a) * 0.17 * s, y + 0.13 * s, z + Math.sin(a) * 0.17 * s, shade(IRONBLK, 0.9));
  }
  for (const sx of [-1, 1]) b.box('metal', 0.05 * s, 0.16 * s, 0.1 * s, x + sx * 0.27 * s, y + 0.72 * s, z, IRONBLK);
  b.cyl('ash', 0.235 * s, 0.235 * s, 0.02 * s, 12, x, y + 0.7 * s, z, 0x6a6a62);
  b.cyl('glow', 0.03 * s, 0.03 * s, 0.015 * s, 6, x, y + 0.715 * s, z, 0xff9e00);
  b.kit('item.difu.incenseDing', 1, y);
};

/** 白玉栏杆：望柱 5 根柱头云纹 + 栏板 4 跨高 1.1（D-ITM-0057，原制 20 根取 5） */
export const jadeRailing: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i <= 4; i++) {
    const px = x - 2.0 * s + i * 1.0 * s;
    b.box('ash', 0.12 * s, 1.06 * s, 0.12 * s, px, y + 0.53 * s, z, BONEWH);
    b.box('ash', 0.17 * s, 0.09 * s, 0.17 * s, px, y + 1.1 * s, z, shade(BONEWH, 1.06));
  }
  for (let i = 0; i < 4; i++) {
    const px = x - 1.5 * s + i * 1.0 * s;
    b.box('ash', 0.86 * s, 0.1 * s, 0.09 * s, px, y + 0.94 * s, z, shade(BONEWH, 0.94));
    b.box('ash', 0.86 * s, 0.42 * s, 0.06 * s, px, y + 0.55 * s, z, BONEWH);
  }
  b.kit('item.difu.jadeRailing', 1, y);
};

/** 锁魂链：九股锻铁链八环垂挂 + 挂鼻 + 锈环座（D-ITM-0025，环径 120） */
export const soulChain: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('metal', 0.06 * s, 0.08 * s, 0.06 * s, x, y + 1.54 * s, z, IRONBLK);
  for (let i = 0; i < 8; i++) {
    b.cyl('metal', 0.055 * s, 0.055 * s, 0.045 * s, 8, x, y + (1.4 - i * 0.17) * s, z, i % 3 ? IRONBLK : RUST, i % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0, true);
  }
  b.box('metal', 0.09 * s, 0.05 * s, 0.09 * s, x, y + 0.02 * s, z, RUST);
  b.kit('item.difu.soulChain', 1, y);
};

/** 界碑：方首碑高 2m + 碑座 + 字口填骨白 + 碑座苔线（D-ITM-0062） */
export const stele: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 0.7 * s, 1.66 * s, 0.2 * s, x, y + 0.95 * s, z, MINGSTONE);
  b.box('ash', 0.8 * s, 0.16 * s, 0.26 * s, x, y + 1.86 * s, z, shade(MINGSTONE, 1.12));
  b.box('ash', 0.92 * s, 0.22 * s, 0.38 * s, x, y + 0.11 * s, z, shade(MINGSTONE, 0.88));
  for (let i = 0; i < 3; i++) b.box('ash', 0.26 * s, 0.26 * s, 0.012 * s, x, y + (1.28 - i * 0.34) * s, z + 0.102 * s, BONEWH);
  b.box('leaf', 0.62 * s, 0.02 * s, 0.02 * s, x, y + 0.02 * s, z + 0.2 * s, 0x4a8b6f);
  b.kit('item.difu.stele', 1, y);
};

// ---------- 三批器物（22 件）：人间 8 / 地府 10 / 天宫 4 ----------
const BRICK2 = 0x5a6472;   // 青砖灶体（M-03）
const ZHU2 = 0x8a3a2a;     // 朱柱（官式）/ 灶膛口

/** 双眼大灶：青砖灶体 + 双灶眼铁锅 + 灶口火光 + 烟道（C-ITM-0090） */
export const doubleStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 1.3 * s, 0.7 * s, 0.7 * s, x, y + 0.35 * s, z, BRICK2);
  b.box('ash', 1.4 * s, 0.08 * s, 0.8 * s, x, y + 0.74 * s, z, BLUESTONE);
  for (const sx of [-1, 1]) {
    b.cyl('metal', 0.24 * s, 0.2 * s, 0.16 * s, 10, x + sx * 0.34 * s, y + 0.86 * s, z, IRONBLK, 0, 0, 0, true);
    b.cyl('metal', 0.26 * s, 0.26 * s, 0.02 * s, 10, x + sx * 0.34 * s, y + 0.95 * s, z, shade(IRONBLK, 1.3), 0, 0, 0, true);
    b.box('glow', 0.22 * s, 0.1 * s, 0.04 * s, x + sx * 0.34 * s, y + 0.3 * s, z + 0.36 * s, 0xff7f50);
  }
  b.box('wall', 0.24 * s, 0.9 * s, 0.24 * s, x - 0.5 * s, y + 1.2 * s, z - 0.18 * s, shade(BRICK2, 0.9));
  b.box('metal', 0.28 * s, 0.02 * s, 0.28 * s, x - 0.5 * s, y + 1.66 * s, z - 0.18 * s, IRONBLK);
  b.kit('item.renjian.doubleStove', 1, y);
};

/** 木楼梯：八级踏面 + 双斜梁 + 单侧扶手 + 端柱（C-ITM-0087，可移置梯） */
export const woodStair: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 8; i++) b.box('wood', 1.0 * s, 0.08 * s, 0.42 * s, x, y + (0.14 + i * 0.18) * s, z + (0.86 - i * 0.25) * s, 0x8b5e3c);
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 0.12 * s, 2.0 * s, x + sx * 0.46 * s, y + 0.62 * s, z, WOOD_D, 0, -0.62, 0);
  for (const sz of [1, -1]) b.box('wood', 0.08 * s, 0.9 * s, 0.08 * s, x + 0.46 * s, y + 1.6 * s, z + sz * 0.86 * s, WOOD_D);
  b.box('wood', 0.06 * s, 0.06 * s, 2.0 * s, x + 0.46 * s, y + 1.95 * s, z, WOOD, 0, -0.62, 0);
  b.kit('item.renjian.woodStair', 1, y);
};

/** 仪门：朱柱两楹 + 双额枋 + 黑漆匾 + 门枕石 + 门槛（C-ITM-0183） */
export const ceremonialGate: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.26 * s, 2.4 * s, 0.26 * s, x + sx * 1.95 * s, y + 1.2 * s, z, ZHU2);
    b.box('ash', 0.5 * s, 0.12 * s, 0.5 * s, x + sx * 1.95 * s, y + 0.06 * s, z, BLUESTONE);
  }
  b.box('wood', 4.4 * s, 0.2 * s, 0.32 * s, x, y + 2.5 * s, z, ZHU2);
  b.box('wood', 4.0 * s, 0.12 * s, 0.24 * s, x, y + 2.24 * s, z, shade(ZHU2, 0.9));
  b.box('lacquer', 2.0 * s, 0.4 * s, 0.08 * s, x, y + 2.72 * s, z + 0.15 * s, 0x2b2b2b);
  b.box('metal', 2.1 * s, 0.04 * s, 0.1 * s, x, y + 2.94 * s, z + 0.15 * s, GOLD);
  b.box('wood', 4.4 * s, 0.06 * s, 0.44 * s, x, y + 0.03 * s, z, WOOD_D);
  for (let i = 0; i < 3; i++) b.box('wood', 0.2 * s, 0.18 * s, 0.46 * s, x - 1.4 * s + i * 1.4 * s, y + 2.34 * s, z, shade(ZHU2, 1.1));
  b.kit('item.renjian.ceremonialGate', 1, y);
};

/** 獬豸照壁：石座 + 壁身 + 瓦顶 + 獬豸浮雕（独角 + 目带）（C-ITM-0182） */
export const xiezhiScreen: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 2.2 * s, 0.16 * s, 0.46 * s, x, y + 0.08 * s, z, shade(BLUESTONE, 0.9));
  b.box('wall', 2.0 * s, 1.9 * s, 0.3 * s, x, y + 1.11 * s, z, 0x3a4048);
  b.box('roof', 2.3 * s, 0.16 * s, 0.44 * s, x, y + 2.14 * s, z, shade(BLUESTONE, 1.1));
  b.box('ash', 1.4 * s, 1.0 * s, 0.04 * s, x, y + 1.2 * s, z + 0.16 * s, 0x4a5058);
  for (const sx of [-1, 1]) b.box('ash', 0.1 * s, 1.2 * s, 0.06 * s, x + sx * 0.72 * s, y + 1.2 * s, z + 0.17 * s, shade(0x4a5058, 1.15));
  for (const sx of [-1, 1]) b.box('ash', 0.16 * s, 0.44 * s, 0.05 * s, x + sx * 0.22 * s, y + 1.72 * s, z + 0.19 * s, BONEWH, 0, 0, sx * 0.22);
  b.box('ash', 0.6 * s, 0.16 * s, 0.05 * s, x, y + 1.05 * s, z + 0.19 * s, BONEWH);
  b.kit('item.renjian.xiezhiScreen', 1, y);
};

/** 戒石亭：四柱方亭 + 四坡顶 + 宝珠 + 亭内戒石碑（C-ITM-0184） */
export const stonePavilion: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.5 * s, 0.14 * s, 1.5 * s, x, y + 0.07 * s, z, shade(BLUESTONE, 0.92));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.11 * s, 2.0 * s, 0.11 * s, x + sx * 0.62 * s, y + 1.1 * s, z + sz * 0.62 * s, ZHU2);
  for (const sz of [-1, 1]) b.box('wood', 1.5 * s, 0.13 * s, 0.13 * s, x, y + 2.16 * s, z + sz * 0.62 * s, ZHU2);
  for (const sx of [-1, 1]) b.box('wood', 0.13 * s, 0.13 * s, 1.5 * s, x + sx * 0.62 * s, y + 2.16 * s, z, ZHU2);
  b.pyramid('roof', 0.1 * s, 1.05 * s, x, y + 2.4 * s, z, shade(BLUESTONE, 1.05), 0, 1, 0.6 * s, 1);
  b.cyl('metal', 0.05 * s, 0.07 * s, 0.18 * s, 6, x, y + 2.79 * s, z, GOLD);
  b.box('ash', 0.72 * s, 1.1 * s, 0.16 * s, x, y + 0.75 * s, z, MINGSTONE);
  b.box('ash', 0.84 * s, 0.12 * s, 0.26 * s, x, y + 1.33 * s, z, shade(MINGSTONE, 1.12));
  for (let i = 0; i < 3; i++) b.box('ash', 0.3 * s, 0.16 * s, 0.02 * s, x, y + (1.16 - i * 0.22) * s, z + 0.09 * s, BONEWH);
  b.kit('item.renjian.stonePavilion', 1, y);
};

/** 牢栅：木框八根铁栅 + 锈锁与铜钥板（C-ITM-0189，原制十二根取八） */
export const jailBars: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 2.2 * s, 0.12 * s, 0.16 * s, x, y + 2.3 * s, z, WOOD_D);
  b.box('wood', 2.2 * s, 0.12 * s, 0.16 * s, x, y + 0.06 * s, z, WOOD_D);
  for (const sx of [-1, 1]) b.box('wood', 0.14 * s, 2.36 * s, 0.18 * s, x + sx * 1.06 * s, y + 1.18 * s, z, WOOD_D);
  for (let i = 0; i < 8; i++) b.cyl('metal', 0.035 * s, 0.035 * s, 2.14 * s, 5, x - 0.84 * s + i * 0.24 * s, y + 1.19 * s, z, IRONBLK);
  b.box('metal', 0.16 * s, 0.2 * s, 0.06 * s, x + 0.52 * s, y + 1.1 * s, z + 0.1 * s, RUST);
  b.box('metal', 0.1 * s, 0.12 * s, 0.05 * s, x + 0.52 * s, y + 1.1 * s, z + 0.14 * s, GILTCU);
  b.kit('item.renjian.jailBars', 1, y);
};

/** 更鼓：木桶板鼓身 + 双面牛皮 + 铁箍 + 木架与鼓槌（C-ITM-0197） */
export const nightDrum: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.44 * s, 0.44 * s, 0.5 * s, 10, x, y + 0.96 * s, z, 0x7a3a24);
  for (const sy of [-1, 1]) b.cyl('fabric', 0.465 * s, 0.465 * s, 0.04 * s, 10, x, y + (0.96 + sy * 0.26) * s, z, 0xd8cbb0);
  b.cyl('metal', 0.468 * s, 0.468 * s, 0.05 * s, 10, x, y + 0.96 * s, z, IRONBLK, 0, 0, 0, true);
  for (const sx of [-1, 1]) b.box('wood', 0.1 * s, 1.0 * s, 0.1 * s, x + sx * 0.56 * s, y + 0.5 * s, z, WOOD_D);
  b.box('wood', 1.3 * s, 0.09 * s, 0.12 * s, x, y + 0.98 * s, z - 0.3 * s, WOOD_D);
  for (const sx of [-1, 1]) b.box('wood', 0.24 * s, 0.07 * s, 0.5 * s, x + sx * 0.56 * s, y + 0.035 * s, z, WOOD_D);
  b.cyl('wood', 0.02 * s, 0.026 * s, 0.42 * s, 5, x + 0.72 * s, y + 1.05 * s, z + 0.1 * s, WOOD, 0, 0, 0.6);
  b.kit('item.renjian.nightDrum', 1, y);
};

/** 主棚茶棚：四柱棚架 + 布顶与挡帘 + 茶案 + 铜壶 + 条凳（D-ITM-0029） */
export const teaShed: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.1 * s, 2.2 * s, 0.1 * s, x + sx * 1.1 * s, y + 1.1 * s, z + sz * 0.9 * s, SANDAL);
  for (const sz of [-1, 1]) b.box('wood', 2.4 * s, 0.1 * s, 0.1 * s, x, y + 2.2 * s, z + sz * 0.9 * s, SANDAL);
  b.box('fabric', 2.7 * s, 0.06 * s, 2.2 * s, x, y + 2.34 * s, z, 0xd8cbb0);
  b.box('fabric', 2.7 * s, 0.3 * s, 0.04 * s, x, y + 2.16 * s, z + 1.1 * s, 0xc8bb98);
  b.box('wood', 1.8 * s, 0.08 * s, 0.6 * s, x, y + 0.82 * s, z + 0.2 * s, WOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.09 * s, 0.8 * s, 0.09 * s, x + sx * 0.8 * s, y + 0.42 * s, z + 0.2 * s, WOOD_D);
  b.cyl('metal', 0.16 * s, 0.12 * s, 0.2 * s, 8, x + 0.5 * s, y + 0.96 * s, z + 0.2 * s, COPPER);
  b.cyl('metal', 0.16 * s, 0.16 * s, 0.03 * s, 8, x + 0.5 * s, y + 1.07 * s, z + 0.2 * s, shade(COPPER, 1.2));
  b.box('wood', 0.7 * s, 0.06 * s, 0.34 * s, x - 0.5 * s, y + 0.42 * s, z - 0.5 * s, WOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.06 * s, 0.42 * s, 0.3 * s, x - 0.5 * s + sx * 0.3 * s, y + 0.21 * s, z - 0.5 * s, WOOD_D);
  b.kit('item.renjian.teaShed', 1, y);
};

/** 白烛阵：漆托 + 六支白烛 + 铁烛台 + 四点火头（D-ITM-0009，原制二十一取六） */
export const candleArray: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.9 * s, 0.06 * s, 0.42 * s, x, y + 0.03 * s, z, 0x2e1a16);
  b.box('lacquer', 0.9 * s, 0.34 * s, 0.05 * s, x, y + 0.2 * s, z - 0.2 * s, shade(0x2e1a16, 0.85));
  for (const sx of [-1, 1]) b.box('lacquer', 0.05 * s, 0.34 * s, 0.42 * s, x + sx * 0.44 * s, y + 0.2 * s, z, shade(0x2e1a16, 1.1));
  b.cyl('metal', 0.09 * s, 0.09 * s, 0.03 * s, 8, x, y + 0.06 * s, z, IRONBLK);
  const cx6 = [-0.34, -0.11, 0.12, 0.35, -0.22, 0.22];
  const cz6 = [0.06, 0.08, 0.05, 0.06, -0.1, -0.1];
  for (let i = 0; i < 6; i++) {
    b.cyl('fabric', 0.028 * s, 0.03 * s, 0.26 * s, 5, x + cx6[i] * s, y + 0.22 * s, z + cz6[i] * s, BONEWH);
    if (i < 4) b.box('glow', 0.022 * s, 0.06 * s, 0.022 * s, x + cx6[i] * s, y + 0.38 * s, z + cz6[i] * s, 0xffd9a0);
  }
  b.kit('item.difu.candleArray', 1, y);
};

/** 地藏龛：石龛身 + 石檐 + 须弥座 + 龛内坐像与背光 + 供碗 + 双烛（D-ITM-0012） */
export const dizangNiche: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.0 * s, 0.16 * s, 0.4 * s, x, y + 0.08 * s, z, shade(MINGSTONE, 1.1));
  b.box('ash', 0.9 * s, 1.5 * s, 0.12 * s, x, y + 0.9 * s, z - 0.14 * s, MINGSTONE);
  for (const sx of [-1, 1]) b.box('ash', 0.12 * s, 1.5 * s, 0.3 * s, x + sx * 0.39 * s, y + 0.9 * s, z, shade(MINGSTONE, 0.92));
  b.box('ash', 0.9 * s, 0.14 * s, 0.3 * s, x, y + 1.72 * s, z, shade(MINGSTONE, 1.16));
  b.box('ash', 0.7 * s, 0.12 * s, 0.26 * s, x, y + 0.2 * s, z + 0.02 * s, shade(MINGSTONE, 1.06));
  b.box('ash', 0.34 * s, 0.5 * s, 0.2 * s, x, y + 0.52 * s, z, BONE);
  b.cyl('ash', 0.11 * s, 0.13 * s, 0.18 * s, 6, x, y + 0.83 * s, z, BONE);
  b.cyl('ash', 0.2 * s, 0.2 * s, 0.03 * s, 12, x, y + 0.88 * s, z - 0.09 * s, shade(GOLD, 1.1), 0, Math.PI / 2, 0, true);
  b.cyl('ash', 0.1 * s, 0.07 * s, 0.1 * s, 8, x - 0.26 * s, y + 0.26 * s, z + 0.08 * s, GRAYCERAMIC);
  for (const sx of [-1, 1]) b.cyl('lacquer', 0.02 * s, 0.024 * s, 0.2 * s, 5, x + sx * 0.28 * s, y + 0.3 * s, z + 0.1 * s, SEALRED);
  b.kit('item.difu.dizangNiche', 1, y);
};

function couplet(b: Baker, x: number, y: number, z: number, s: number, side: number): void {
  b.box('lacquer', 0.32 * s, 1.8 * s, 0.05 * s, x, y + 0.9 * s, z, 0x2b2b2b);
  for (const sx of [-1, 1]) b.box('lacquer', 0.05 * s, 1.9 * s, 0.07 * s, x + sx * 0.16 * s, y + 0.9 * s, z, 0x5a1f18);
  for (const sy of [1.82, -0.02]) b.box('lacquer', 0.32 * s, 0.06 * s, 0.07 * s, x, y + sy * s, z, shade(0x5a1f18, 1.2));
  for (let i = 0; i < 3; i++) b.box('fabric', 0.2 * s, 0.3 * s, 0.008 * s, x + side * 0.01 * s, y + (1.42 - i * 0.44) * s, z + 0.03 * s, 0xc8b98a);
  b.box('fabric', 0.03 * s, 0.22 * s, 0.03 * s, x, y - 0.12 * s, z, SEALRED);
  b.kit(side > 0 ? 'item.difu.coupletEast' : 'item.difu.coupletWest', 1, y);
}

/** 楹联·东：黑漆板 + 朱框 + 三道字格 + 朱穗（D-ITM-0014） */
export const coupletEast: ItemBuilder = (b, x, y, z, s = 1) => { couplet(b, x, y, z, s, 1); };

/** 楹联·西：与东联同制，字格错半格（D-ITM-0015） */
export const coupletWest: ItemBuilder = (b, x, y, z, s = 1) => { couplet(b, x, y, z, s, -1); };

/** 望柱栏板：两望柱 + 云头 + 寻杖 + 栏板 + 抱鼓（D-ITM-0018，原制四跨取一） */
export const stoneBaluster: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 2.0 * s, 0.12 * s, 0.3 * s, x, y + 0.06 * s, z, shade(BLUESTONE, 0.9));
  for (const sx of [-1, 1]) {
    b.box('ash', 0.16 * s, 0.92 * s, 0.2 * s, x + sx * 0.92 * s, y + 0.58 * s, z, BLUESTONE);
    b.box('ash', 0.22 * s, 0.1 * s, 0.26 * s, x + sx * 0.92 * s, y + 1.09 * s, z, shade(BLUESTONE, 1.14));
  }
  b.box('ash', 1.7 * s, 0.1 * s, 0.14 * s, x, y + 0.96 * s, z, shade(BLUESTONE, 1.05));
  b.box('ash', 1.7 * s, 0.42 * s, 0.08 * s, x, y + 0.5 * s, z, shade(BLUESTONE, 0.96));
  b.box('ash', 0.5 * s, 0.2 * s, 0.06 * s, x, y + 0.62 * s, z + 0.05 * s, shade(BLUESTONE, 1.08));
  b.kit('item.difu.stoneBaluster', 1, y);
};

/** 祈愿红绳：木架两道横枋 + 七股红绳 + 七枚愿牌（D-ITM-0050，原制百绳取七） */
export const wishCords: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.08 * s, 1.7 * s, 0.08 * s, x + sx * 0.66 * s, y + 0.85 * s, z, ZHU2);
    b.box('wood', 0.3 * s, 0.06 * s, 0.34 * s, x + sx * 0.66 * s, y + 0.03 * s, z, ZHU2);
  }
  b.box('wood', 1.44 * s, 0.07 * s, 0.07 * s, x, y + 1.72 * s, z, ZHU2);
  b.box('wood', 1.44 * s, 0.05 * s, 0.05 * s, x, y + 1.3 * s, z, ZHU2);
  for (let i = 0; i < 7; i++) {
    const px = x - 0.6 * s + i * 0.2 * s;
    b.box('fabric', 0.012 * s, 0.36 * s, 0.012 * s, px, y + 1.54 * s, z + 0.01 * s, i % 3 ? 0x9d2933 : 0xc0392b);
    b.box('fabric', 0.07 * s, 0.1 * s, 0.008 * s, px, y + 1.34 * s, z + 0.03 * s, 0xe8d9a8);
  }
  b.kit('item.difu.wishCords', 1, y);
};

/** 残碑影壁：断头碑身 + 碑座 + 字口 + 散落石角 + 苔线（D-ITM-0053） */
export const brokenSteleScreen: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.9 * s, 0.14 * s, 0.44 * s, x, y + 0.07 * s, z, shade(MINGSTONE, 0.9));
  b.box('ash', 1.7 * s, 1.24 * s, 0.26 * s, x, y + 0.76 * s, z, MINGSTONE);
  b.box('ash', 0.8 * s, 0.5 * s, 0.24 * s, x - 0.42 * s, y + 1.55 * s, z, shade(MINGSTONE, 1.08));
  b.box('ash', 0.5 * s, 0.26 * s, 0.2 * s, x + 0.6 * s, y + 1.42 * s, z, shade(MINGSTONE, 0.94));
  b.box('ash', 0.34 * s, 0.16 * s, 0.3 * s, x + 0.86 * s, y + 0.08 * s, z + 0.34 * s, shade(MINGSTONE, 1.12));
  for (let i = 0; i < 3; i++) b.box('ash', 0.26 * s, 0.18 * s, 0.02 * s, x - 0.36 * s, y + (1.1 - i * 0.3) * s, z + 0.14 * s, BONEWH);
  b.box('leaf', 0.5 * s, 0.02 * s, 0.02 * s, x + 0.2 * s, y + 0.15 * s, z + 0.23 * s, 0x4a8b6f);
  b.kit('item.difu.brokenSteleScreen', 1, y);
};

/** 泪痕石：三方叠石 + 石面泪痕三道 + 底部苔块 ×2（D-ITM-0061） */
export const tearStone: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 0.62 * s, 0.2 * s, 0.5 * s, x, y + 0.1 * s, z, shade(MINGSTONE, 0.92));
  b.box('ash', 0.54 * s, 0.46 * s, 0.44 * s, x, y + 0.42 * s, z, MINGSTONE);
  b.box('ash', 0.42 * s, 0.14 * s, 0.34 * s, x + 0.03 * s, y + 0.71 * s, z, shade(MINGSTONE, 1.12));
  for (let i = 0; i < 3; i++) b.box('ash', 0.05 * s, 0.34 * s, 0.02 * s, x - 0.14 * s + i * 0.14 * s, y + 0.42 * s, z + 0.23 * s, shade(BONEWH, 0.86));
  for (let i = 0; i < 2; i++) b.box('leaf', 0.22 * s, 0.02 * s, 0.02 * s, x + (i ? 0.12 : -0.1) * s, y + 0.06 * s, z + 0.26 * s, 0x3e6e48);
  b.kit('item.difu.tearStone', 1, y);
};

/** 骨阶扶索：七根骨柱 + 骨节柱头 + 骨白寻杖与木底杖（D-ITM-0066，沿梯段 4.5m） */
export const boneHandrail: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 7; i++) {
    b.cyl('ash', 0.045 * s, 0.055 * s, 0.9 * s, 5, x, y + (0.45 + i * 0.27) * s, z - i * 0.75 * s, BONEWH);
    b.box('ash', 0.12 * s, 0.06 * s, 0.12 * s, x, y + (0.92 + i * 0.27) * s, z - i * 0.75 * s, shade(BONEWH, 0.9));
  }
  b.box('ash', 0.07 * s, 0.07 * s, 4.7 * s, x, y + 1.5 * s, z - 2.25 * s, shade(BONEWH, 1.05), 0, -0.29, 0);
  b.box('wood', 0.1 * s, 0.08 * s, 4.7 * s, x, y + 1.42 * s, z - 2.25 * s, WOOD_D, 0, -0.29, 0);
  b.kit('item.difu.boneHandrail', 1, y);
};

/** 望乡雾幕：双柱挂架 + 三幅素绢幕 + 系带 + 底轴（D-ITM-0059） */
export const mistCurtain: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.09 * s, 2.1 * s, 0.09 * s, x + sx * 1.12 * s, y + 1.05 * s, z, WOOD_D);
    b.box('wood', 0.26 * s, 0.06 * s, 0.3 * s, x + sx * 1.12 * s, y + 0.03 * s, z, WOOD_D);
  }
  b.box('wood', 2.34 * s, 0.08 * s, 0.1 * s, x, y + 2.06 * s, z, WOOD_D);
  b.box('fabric', 2.1 * s, 1.76 * s, 0.02 * s, x, y + 1.1 * s, z, 0xd8dcd4);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.03 * s, 1.7 * s, 0.03 * s, x - 0.65 * s + i * 0.65 * s, y + 1.1 * s, z + 0.02 * s, shade(0xd8dcd4, i === 1 ? 1.04 : 0.9));
  for (const sx of [-1, 1]) b.box('fabric', 0.16 * s, 0.1 * s, 0.05 * s, x + sx * 0.85 * s, y + 1.5 * s, z + 0.03 * s, 0x8a9a92);
  b.box('wood', 2.1 * s, 0.07 * s, 0.07 * s, x, y + 0.24 * s, z, WOOD_D);
  b.kit('item.difu.mistCurtain', 1, y);
};

/** 八卦紫金丹炉：石座 + 紫金炉身 + 炉口火光 + 敛口盖 + 宝珠钮 + 八卦金片 ×8（T-ITM-0028） */
export const baguaFurnace: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.0 * s, 0.16 * s, 1.0 * s, x, y + 0.08 * s, z, shade(BLUESTONE, 0.9));
  b.cyl('metal', 0.34 * s, 0.42 * s, 0.86 * s, 10, x, y + 0.59 * s, z, ZIJIN);
  b.cyl('metal', 0.46 * s, 0.46 * s, 0.1 * s, 8, x, y + 1.07 * s, z, shade(ZIJIN, 1.12));
  b.cyl('metal', 0.4 * s, 0.3 * s, 0.24 * s, 8, x, y + 1.24 * s, z, shade(ZIJIN, 0.9));
  b.cyl('metal', 0.07 * s, 0.1 * s, 0.16 * s, 6, x, y + 1.44 * s, z, GILT);
  b.box('glow', 0.16 * s, 0.02 * s, 0.16 * s, x, y + 1.12 * s, z, 0xffb060);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('metal', 0.14 * s, 0.3 * s, 0.03 * s, x + Math.cos(a) * 0.44 * s, y + 0.72 * s, z + Math.sin(a) * 0.44 * s, GILT, -a, 0, 0);
  }
  b.kit('item.tiangong.baguaFurnace', 1, y);
};

/** 九转金丹：漆盘 + 锦盒 + 三枚金丹 + 封条（T-ITM-0038，原制九转取三） */
export const goldenElixir: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('lacquer', 0.16 * s, 0.16 * s, 0.03 * s, 12, x, y + 0.015 * s, z, 0x2e1a16);
  b.box('lacquer', 0.22 * s, 0.1 * s, 0.22 * s, x, y + 0.08 * s, z, shade(0x2e1a16, 1.15));
  b.box('lacquer', 0.24 * s, 0.04 * s, 0.24 * s, x, y + 0.15 * s, z, shade(0x2e1a16, 0.9));
  for (let i = 0; i < 3; i++) b.cyl('metal', 0.05 * s, 0.05 * s, 0.05 * s, 6, x - 0.06 * s + i * 0.06 * s, y + 0.195 * s, z, GILT);
  for (const sx of [-1, 1]) b.box('fabric', 0.02 * s, 0.004 * s, 0.2 * s, x + sx * 0.09 * s, y + 0.172 * s, z, SEALRED);
  b.kit('item.tiangong.goldenElixir', 1, y);
};

/** 霓裳羽衣：衣架 + 三重羽层 + 领缘金织 + 四缕垂羽（T-ITM-0061） */
export const featherRobe: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.16 * s, 0.2 * s, 0.08 * s, 8, x, y + 0.04 * s, z, WOOD_D);
  b.cyl('wood', 0.035 * s, 0.045 * s, 1.5 * s, 6, x, y + 0.83 * s, z, WOOD_D);
  b.box('wood', 0.9 * s, 0.05 * s, 0.05 * s, x, y + 1.5 * s, z, WOOD_D);
  b.box('fabric', 0.5 * s, 0.34 * s, 0.2 * s, x, y + 1.32 * s, z, 0xe8dcc0);
  b.box('fabric', 0.42 * s, 0.7 * s, 0.24 * s, x, y + 0.82 * s, z, 0xf0e6d2);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.46 * s, 0.12 * s, 0.28 * s, x, y + (1.04 - i * 0.2) * s, z, i % 2 ? 0x9fc4b0 : 0xd8b0a0);
  b.box('fabric', 0.62 * s, 0.06 * s, 0.3 * s, x, y + 1.48 * s, z, shade(0xd4b76a, 1.05));
  for (const sx of [-2, -1, 1, 2]) b.box('fabric', 0.05 * s, 0.5 * s, 0.03 * s, x + sx * 0.14 * s, y + 0.44 * s, z + 0.12 * s, 0xf4ecd8, 0, 0, sx * 0.04);
  b.kit('item.tiangong.featherRobe', 1, y);
};

/** 王母凤辇：双轮 + 车厢 + 四柱华盖 + 朱帷 + 金凤顶 + 双辕（T-ITM-0049） */
export const phoenixCarriage: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.cyl('lacquer', 0.4 * s, 0.4 * s, 0.1 * s, 8, x + sx * 0.85 * s, y + 0.42 * s, z, 0x5a1f18, 0, Math.PI / 2);
    b.box('metal', 0.14 * s, 0.14 * s, 0.14 * s, x + sx * 0.85 * s, y + 0.42 * s, z, GOLD);
    b.box('wood', 0.08 * s, 1.1 * s, 0.08 * s, x + sx * 0.62 * s, y + 1.35 * s, z + 0.5 * s, WOOD_D);
    b.box('wood', 0.08 * s, 1.1 * s, 0.08 * s, x + sx * 0.62 * s, y + 1.35 * s, z - 0.5 * s, WOOD_D);
  }
  b.box('wood', 0.1 * s, 0.1 * s, 1.6 * s, x + 0.3 * s, y + 0.55 * s, z + 1.1 * s, WOOD_D, 0.14);
  b.cyl('wood', 0.06 * s, 0.06 * s, 1.8 * s, 6, x, y + 0.42 * s, z, WOOD_D, 0, 0, Math.PI / 2);
  b.box('lacquer', 1.3 * s, 0.5 * s, 1.1 * s, x, y + 0.85 * s, z, 0x5a1f18);
  b.box('fabric', 1.5 * s, 0.08 * s, 1.3 * s, x, y + 1.94 * s, z, 0x9d2933);
  b.cyl('metal', 0.12 * s, 0.16 * s, 0.3 * s, 6, x, y + 2.12 * s, z, GOLD);
  for (const sx of [-1, 1]) b.box('metal', 0.4 * s, 0.1 * s, 0.06 * s, x + sx * 0.22 * s, y + 2.1 * s, z, GILT, 0, 0, sx * 0.3);
  b.kit('item.tiangong.phoenixCarriage', 1, y);
};

// ---------- 四批真物件（34 件）：容器器皿 13 / 食货药材 10 / 文书文具 6 / 陈设 3 / 工具 2 ----------
// 尺寸按资产卷标称米制值，配色取卷内材质行；逐件三角面上限 260，全部并入既有 14 个材质组，draw call 0 增。
// 分族：vessel（容器/器皿）、med（食货/药材）、doc（文书/文具）、furn（陈设/家具）、tool（工具/兵器）。

/** 库房木箱：800×600×600 松木对开盖 + 四角铁包 + 铜锁（C-ITM-0126） */
export const crate: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.8 * s, 0.48 * s, 0.6 * s, x, y + 0.24 * s, z, WOOD);
  b.box('wood', 0.84 * s, 0.08 * s, 0.62 * s, x, y + 0.52 * s, z, shade(WOOD, 1.08));
  for (const sz of [-1, 1]) b.box('wood', 0.84 * s, 0.04 * s, 0.05 * s, x, y + 0.6 * s, z + sz * 0.2 * s, shade(WOOD_D, 1.1));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', 0.06 * s, 0.56 * s, 0.06 * s, x + sx * 0.38 * s, y + 0.28 * s, z + sz * 0.28 * s, IRONBLK);
  b.box('metal', 0.12 * s, 0.14 * s, 0.03 * s, x + 0.12 * s, y + 0.42 * s, z + 0.3 * s, GILTCU);
  b.box('metal', 0.04 * s, 0.06 * s, 0.04 * s, x + 0.12 * s, y + 0.36 * s, z + 0.31 * s, GILT);
  b.kit('item.vessel.crate', 1, y);
};

/** 库房钱箱：620×440 木箱铁扣 + 钱串绸缎 + 投钱槽 + 铜锁 + 垫木（C-ITM-0409） */
export const cashChest: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 0.06 * s, 0.36 * s, x + sx * 0.26 * s, y + 0.03 * s, z, WOOD_D);
  b.box('wood', 0.62 * s, 0.4 * s, 0.44 * s, x, y + 0.2 * s, z, OILWOOD);
  b.box('wood', 0.66 * s, 0.08 * s, 0.48 * s, x, y + 0.44 * s, z, shade(OILWOOD, 1.2));
  for (const sy of [0.12, 0.3]) b.box('metal', 0.64 * s, 0.04 * s, 0.46 * s, x, y + sy * s, z, IRONBLK);
  b.box('metal', 0.2 * s, 0.02 * s, 0.05 * s, x - 0.1 * s, y + 0.485 * s, z, GILTCU);
  b.box('metal', 0.1 * s, 0.12 * s, 0.04 * s, x + 0.2 * s, y + 0.4 * s, z + 0.22 * s, GILTCU);
  for (const sx of [-1, 1]) b.box('metal', 0.05 * s, 0.07 * s, 0.14 * s, x + sx * 0.32 * s, y + 0.26 * s, z, shade(IRONBLK, 1.25));
  b.kit('item.vessel.cashChest', 1, y);
};

/** 货箱：900×560 双拼盖 + 两道麻绳 + 双垫木 + 纸签（C-ITM-0438） */
export const goodsCrate: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.1 * s, 0.09 * s, 0.56 * s, x + sx * 0.32 * s, y + 0.045 * s, z, WOOD_D);
  b.box('wood', 0.9 * s, 0.5 * s, 0.56 * s, x, y + 0.34 * s, z, shade(WOOD, 0.94));
  b.box('wood', 0.94 * s, 0.07 * s, 0.6 * s, x, y + 0.62 * s, z, shade(WOOD, 1.1));
  for (const sz of [-1, 1]) b.box('wood', 0.92 * s, 0.05 * s, 0.06 * s, x, y + 0.66 * s, z + sz * 0.2 * s, WOOD_D);
  for (const sx of [-1, 1]) b.box('fabric', 0.04 * s, 0.72 * s, 0.6 * s, x + sx * 0.24 * s, y + 0.36 * s, z, 0x8a6a3a);
  b.box('fabric', 0.2 * s, 0.02 * s, 0.14 * s, x, y + 0.7 * s, z, 0xd8cba8);
  b.kit('item.vessel.goodsCrate', 1, y);
};

/** 破木箱：700×500 箱身倾斜 + 散落板条 + 断铁角 + 撬痕（C-ITM-0460） */
export const brokenCrate: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.7 * s, 0.36 * s, 0.5 * s, x, y + 0.205 * s, z, shade(WOOD, 0.86), 0.12, 0, 0.06);
  b.box('wood', 0.72 * s, 0.05 * s, 0.52 * s, x - 0.04 * s, y + 0.4 * s, z, shade(WOOD, 0.78), 0.12);
  b.box('wood', 0.5 * s, 0.04 * s, 0.16 * s, x + 0.34 * s, y + 0.035 * s, z + 0.1 * s, WOOD_D, 0.5, 0, 0.04);
  b.box('wood', 0.44 * s, 0.04 * s, 0.14 * s, x + 0.42 * s, y + 0.05 * s, z - 0.24 * s, WOOD_D, -0.35);
  b.box('wood', 0.6 * s, 0.05 * s, 0.05 * s, x - 0.12 * s, y + 0.44 * s, z + 0.2 * s, shade(WOOD_D, 1.1), 0.9);
  b.box('wood', 0.06 * s, 0.3 * s, 0.05 * s, x + 0.3 * s, y + 0.15 * s, z - 0.3 * s, WOOD_D, 0.4);
  b.box('metal', 0.05 * s, 0.16 * s, 0.05 * s, x - 0.32 * s, y + 0.18 * s, z + 0.22 * s, shade(IRONBLK, 1.2), 0.3);
  b.kit('item.vessel.brokenCrate', 1, y);
};

/** 门钱栅箱：700×540 木栅竹箱 + 顶面竹栅五根 + 投钱口 + 铜锁（C-ITM-0167） */
export const moneyGateBox: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.7 * s, 0.06 * s, 0.54 * s, x, y + 0.03 * s, z, WOOD_D);
  b.box('wood', 0.66 * s, 0.44 * s, 0.5 * s, x, y + 0.28 * s, z, shade(WOOD, 0.86));
  for (const sz of [-1, 1]) b.box('wood', 0.7 * s, 0.05 * s, 0.06 * s, x, y + 0.52 * s, z + sz * 0.24 * s, shade(WOOD_D, 1.2));
  for (const sx of [-1, 1]) b.box('wood', 0.06 * s, 0.05 * s, 0.54 * s, x + sx * 0.32 * s, y + 0.52 * s, z, shade(WOOD_D, 1.2));
  for (let i = -2; i <= 2; i++) b.box('wood', 0.035 * s, 0.04 * s, 0.48 * s, x + i * 0.13 * s, y + 0.55 * s, z, BAMBOO2);
  b.box('metal', 0.18 * s, 0.02 * s, 0.07 * s, x, y + 0.49 * s, z - 0.1 * s, GILT);
  b.box('metal', 0.09 * s, 0.12 * s, 0.03 * s, x, y + 0.34 * s, z + 0.26 * s, GILTCU);
  b.kit('item.vessel.moneyGateBox', 1, y);
};

/** 功德箱：540×660 髹红木箱 + 顶投币口 + 铜锁 + 双朱线（C-ITM-0180） */
export const meritBox: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.6 * s, 0.08 * s, 0.44 * s, x, y + 0.04 * s, z, WOOD_D);
  b.box('wood', 0.54 * s, 0.66 * s, 0.4 * s, x, y + 0.41 * s, z, LACQUER);
  b.box('wood', 0.6 * s, 0.07 * s, 0.46 * s, x, y + 0.775 * s, z, shade(LACQUER, 1.15));
  b.box('metal', 0.2 * s, 0.03 * s, 0.05 * s, x, y + 0.79 * s, z, GILT);
  b.box('metal', 0.08 * s, 0.11 * s, 0.04 * s, x, y + 0.62 * s, z + 0.21 * s, GILTCU);
  for (const sz of [-1, 1]) b.box('wood', 0.04 * s, 0.6 * s, 0.03 * s, x + 0.18 * s, y + 0.4 * s, z + sz * 0.205 * s, shade(LACQUER, 1.3));
  b.kit('item.vessel.meritBox', 1, y);
};

/** 锦盒：400×300 宋锦面 + 漆底 + 双金扣 + 朱穗（C-ITM-0142） */
export const brocadeBox: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.4 * s, 0.1 * s, 0.3 * s, x, y + 0.05 * s, z, 0x2e1a16);
  b.box('fabric', 0.38 * s, 0.1 * s, 0.28 * s, x, y + 0.14 * s, z, SILK);
  b.box('fabric', 0.42 * s, 0.05 * s, 0.32 * s, x, y + 0.215 * s, z, shade(SILK, 1.12));
  for (const sx of [-1, 1]) b.box('metal', 0.04 * s, 0.08 * s, 0.03 * s, x + sx * 0.16 * s, y + 0.14 * s, z + 0.155 * s, GILTCU);
  b.box('fabric', 0.05 * s, 0.12 * s, 0.05 * s, x, y + 0.3 * s, z + 0.12 * s, shade(SILK, 0.8));
  b.kit('item.vessel.brocadeBox', 1, y);
};

/** 浆糊桶：径 320 木桶 + 双铁箍 + 浆面 + 排刷（C-ITM-0134） */
export const pasteBucket: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.16 * s, 0.13 * s, 0.34 * s, 8, x, y + 0.17 * s, z, shade(WOOD, 1.05));
  for (const yy of [0.1, 0.28]) b.cyl('metal', 0.152 * s, 0.145 * s, 0.03 * s, 8, x, y + yy * s, z, IRONBLK, 0, 0, 0, true);
  b.cyl('ceramic', 0.14 * s, 0.14 * s, 0.02 * s, 8, x, y + 0.32 * s, z, shade(PAPER, 0.86));
  b.box('wood', 0.02 * s, 0.34 * s, 0.02 * s, x + 0.06 * s, y + 0.48 * s, z, WOOD_D, 0, 0, 0.24);
  b.box('wood', 0.05 * s, 0.12 * s, 0.05 * s, x + 0.1 * s, y + 0.62 * s, z, BAMBOO_L, 0, 0, 0.24);
  b.kit('item.vessel.pasteBucket', 1, y);
};

/** 水桶：径 320 挑水桶 + 双铁箍 + 水面 + 提梁（C-ITM-0462） */
export const waterPail: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.16 * s, 0.14 * s, 0.36 * s, 8, x, y + 0.18 * s, z, shade(WOOD, 0.98));
  for (const yy of [0.08, 0.3]) b.cyl('metal', 0.163 * s, 0.152 * s, 0.025 * s, 8, x, y + yy * s, z, shade(IRONBLK, 1.3), 0, 0, 0, true);
  b.cyl('water', 0.145 * s, 0.145 * s, 0.015 * s, 8, x, y + 0.34 * s, z, 0x2b3a40);
  for (const sx of [-1, 1]) b.box('wood', 0.025 * s, 0.2 * s, 0.025 * s, x + sx * 0.14 * s, y + 0.44 * s, z, WOOD_D, 0, 0, sx * 0.24);
  b.box('wood', 0.24 * s, 0.02 * s, 0.02 * s, x, y + 0.54 * s, z, WOOD_D);
  b.kit('item.vessel.waterPail', 1, y);
};

/** 泔水桶：径 400 厚壁桶 + 斜搭木盖 + 浮渣 + 横提手（C-ITM-0272） */
export const slopPail: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.2 * s, 0.17 * s, 0.42 * s, 10, x, y + 0.21 * s, z, shade(WOOD, 0.9));
  for (const yy of [0.1, 0.34]) b.cyl('metal', 0.197 * s, 0.183 * s, 0.025 * s, 10, x, y + yy * s, z, shade(IRONBLK, 0.95), 0, 0, 0, true);
  b.box('wood', 0.34 * s, 0.04 * s, 0.34 * s, x + 0.14 * s, y + 0.44 * s, z, WOOD_D, 0.4, 0, 0.18);
  b.cyl('ceramic', 0.19 * s, 0.19 * s, 0.01 * s, 8, x, y + 0.4 * s, z, 0x4a3c2e);
  b.box('leaf', 0.08 * s, 0.03 * s, 0.06 * s, x - 0.06 * s, y + 0.42 * s, z + 0.05 * s, 0x6a7a4a);
  b.box('wood', 0.05 * s, 0.05 * s, 0.24 * s, x, y + 0.45 * s, z, WOOD_D);
  b.kit('item.vessel.slopPail', 1, y);
};

/** 果桶：径 600 敞口果桶 + 双铁箍 + 糖水浸果（C-ITM-0263） */
export const fruitBarrel: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.3 * s, 0.26 * s, 0.5 * s, 10, x, y + 0.25 * s, z, shade(WOOD, 1.02));
  for (const yy of [0.12, 0.4]) b.cyl('metal', 0.3 * s, 0.285 * s, 0.03 * s, 10, x, y + yy * s, z, shade(IRONBLK, 1.35), 0, 0, 0, true);
  b.cyl('water', 0.27 * s, 0.27 * s, 0.012 * s, 8, x, y + 0.44 * s, z, 0x6a4a1e);
  for (const [ox, oz, col] of [[-0.08, 0.03, 0xb8734a], [0.09, -0.05, 0xc08a3a], [0, 0.1, 0xa8652e]] as const) {
    b.cyl('ceramic', 0.09 * s, 0.09 * s, 0.09 * s, 6, x + ox * s, y + 0.5 * s, z + oz * s, col);
  }
  b.kit('item.vessel.fruitBarrel', 1, y);
};

/** 汤房浴桶：径 900 高 560 箍木浴桶 + 铜箍 + 汤面 + 铜炉 + 木踏（C-ITM-0284） */
export const bathTub: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.44 * s, 0.36 * s, 0.56 * s, 12, x, y + 0.28 * s, z, shade(WOOD, 0.92));
  b.cyl('wood', 0.47 * s, 0.46 * s, 0.06 * s, 12, x, y + 0.58 * s, z, shade(WOOD_D, 1.15));
  b.cyl('water', 0.42 * s, 0.42 * s, 0.012 * s, 12, x, y + 0.56 * s, z, 0x2b3a40);
  for (const yy of [0.14, 0.34]) b.cyl('metal', 0.428 * s, 0.408 * s, 0.03 * s, 12, x, y + yy * s, z, shade(COPPER, 1.1), 0, 0, 0, true);
  b.box('wood', 0.24 * s, 0.06 * s, 0.24 * s, x + 0.52 * s, y + 0.5 * s, z, WOOD_D);
  b.cyl('metal', 0.1 * s, 0.09 * s, 0.2 * s, 8, x - 0.56 * s, y + 0.1 * s, z, shade(COPPER, 0.9));
  b.kit('item.vessel.bathTub', 1, y);
};

/** 温酒器：汤酒温碗（瓷）+ 铜内胆 + 三足 + 提柄 + 盖 + 炭口暖光（C-ITM-0277） */
export const wineWarmer: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.17 * s, 0.13 * s, 0.16 * s, 10, x, y + 0.14 * s, z, PORCELAIN);
  b.cyl('metal', 0.1 * s, 0.09 * s, 0.16 * s, 10, x, y + 0.26 * s, z, shade(COPPER, 1.15));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.4;
    b.box('metal', 0.04 * s, 0.08 * s, 0.04 * s, x + Math.cos(a) * 0.12 * s, y + 0.04 * s, z + Math.sin(a) * 0.12 * s, shade(COPPER, 0.8));
  }
  b.box('metal', 0.03 * s, 0.14 * s, 0.03 * s, x + 0.19 * s, y + 0.2 * s, z, shade(COPPER, 1.2));
  b.cyl('ceramic', 0.105 * s, 0.105 * s, 0.015 * s, 8, x, y + 0.35 * s, z, shade(PORCELAIN, 0.9));
  b.box('glow', 0.06 * s, 0.02 * s, 0.06 * s, x, y + 0.07 * s, z, 0xff7f50);
  b.kit('item.vessel.wineWarmer', 1, y);
};

/** 百眼药橱：1400×1900×420 多屉药橱 + 六屉铜扣 + 纸签三层（C-ITM-0116） */
export const hundredEyeCabinet: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.4 * s, 1.9 * s, 0.42 * s, x, y + 0.95 * s, z, shade(WOOD, 1.04));
  b.box('wood', 1.48 * s, 0.1 * s, 0.46 * s, x, y + 1.95 * s, z, shade(WOOD_D, 1.2));
  b.box('wood', 1.44 * s, 0.12 * s, 0.44 * s, x, y + 0.06 * s, z, shade(WOOD_D, 0.9));
  for (const sy of [0.55, 0.94, 1.33]) b.box('wood', 1.36 * s, 0.03 * s, 0.03 * s, x, y + sy * s, z + 0.215 * s, shade(WOOD, 0.86));
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    b.box('wood', 0.4 * s, 0.3 * s, 0.03 * s, x - 0.45 * s + c * 0.45 * s, y + (1.52 - r * 0.39) * s, z + 0.23 * s, shade(WOOD, 1.14));
    b.box('metal', 0.05 * s, 0.05 * s, 0.02 * s, x - 0.45 * s + c * 0.45 * s, y + (1.52 - r * 0.39) * s, z + 0.25 * s, GILTCU);
  }
  for (let c = 0; c < 2; c++) b.box('fabric', 0.42 * s, 0.14 * s, 0.01 * s, x - 0.22 * s + c * 0.45 * s, y + 0.85 * s, z + 0.215 * s, PAPER);
  b.kit('item.med.hundredEyeCabinet', 1, y);
};

/** 药戥：360 长戥杆 + 双立柱 + 铜盘 + 铁砣 + 刻度纸（C-ITM-0117） */
export const medicineScale: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.36 * s, 0.05 * s, 0.22 * s, x, y + 0.025 * s, z, OILWOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.03 * s, 0.26 * s, 0.03 * s, x + sx * 0.14 * s, y + 0.16 * s, z, shade(OILWOOD, 1.15));
  b.box('metal', 0.34 * s, 0.015 * s, 0.015 * s, x, y + 0.29 * s, z, GILTCU);
  b.cyl('metal', 0.07 * s, 0.05 * s, 0.02 * s, 6, x - 0.13 * s, y + 0.2 * s, z, shade(GILTCU, 1.2));
  b.box('metal', 0.03 * s, 0.03 * s, 0.03 * s, x + 0.1 * s, y + 0.26 * s, z, IRONBLK);
  b.box('fabric', 0.1 * s, 0.006 * s, 0.06 * s, x - 0.13 * s, y + 0.22 * s, z, 0xc9b380);
  b.kit('item.med.medicineScale', 1, y);
};

/** 铜药碾：700 长碾槽 + 双挡沿 + 碾轮 + 轴 + 木柄（C-ITM-0118） */
export const copperMill: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('metal', 0.7 * s, 0.06 * s, 0.3 * s, x, y + 0.03 * s, z, shade(COPPER, 0.86));
  for (const sz of [-1, 1]) b.box('metal', 0.7 * s, 0.1 * s, 0.04 * s, x, y + 0.1 * s, z + sz * 0.13 * s, shade(COPPER, 1.1));
  b.cyl('metal', 0.09 * s, 0.09 * s, 0.12 * s, 8, x, y + 0.16 * s, z, shade(COPPER, 1.2), 0, 0, Math.PI / 2);
  b.box('metal', 0.06 * s, 0.04 * s, 0.34 * s, x + 0.26 * s, y + 0.2 * s, z, IRONBLK);
  b.box('wood', 0.06 * s, 0.16 * s, 0.06 * s, x + 0.26 * s, y + 0.3 * s, z, WOOD_D);
  b.kit('item.med.copperMill', 1, y);
};

/** 香戥：300 长骨柄小戥 + 铜杆铜盘 + 铜砣 + 香脚（C-ITM-0140 铜骨） */
export const incenseScale: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 0.3 * s, 0.04 * s, 0.2 * s, x, y + 0.02 * s, z, BONEWH);
  b.box('ash', 0.025 * s, 0.34 * s, 0.025 * s, x, y + 0.2 * s, z - 0.08 * s, shade(BONEWH, 0.92));
  b.box('metal', 0.34 * s, 0.012 * s, 0.012 * s, x, y + 0.36 * s, z - 0.02 * s, GILTCU);
  for (const sx of [-1, 1]) b.cyl('metal', 0.055 * s, 0.04 * s, 0.012 * s, 6, x + sx * 0.14 * s, y + 0.3 * s, z - 0.02 * s, shade(GILTCU, 1.15));
  b.box('metal', 0.022 * s, 0.05 * s, 0.022 * s, x + 0.12 * s, y + 0.34 * s, z - 0.02 * s, shade(GILTCU, 0.86));
  b.box('wood', 0.006 * s, 0.006 * s, 0.14 * s, x - 0.14 * s, y + 0.31 * s, z - 0.02 * s, BAMBOO2);
  b.kit('item.med.incenseScale', 1, y);
};

/** 香篆模：径 520 木模盘 + 立沿 + 三道篆纹 + 提钮（C-ITM-0141） */
export const incenseSealMold: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.26 * s, 0.24 * s, 0.04 * s, 12, x, y + 0.02 * s, z, shade(WOOD, 1.1));
  b.cyl('wood', 0.255 * s, 0.255 * s, 0.04 * s, 12, x, y + 0.06 * s, z, shade(WOOD, 0.88), 0, 0, 0, true);
  b.box('ash', 0.3 * s, 0.006 * s, 0.03 * s, x, y + 0.045 * s, z - 0.08 * s, 0x8a8478, 0.3);
  b.box('ash', 0.03 * s, 0.006 * s, 0.26 * s, x - 0.1 * s, y + 0.045 * s, z + 0.02 * s, 0x8a8478, 0.3);
  b.box('ash', 0.16 * s, 0.006 * s, 0.03 * s, x + 0.08 * s, y + 0.045 * s, z + 0.1 * s, 0x8a8478, -0.4);
  b.box('wood', 0.06 * s, 0.03 * s, 0.06 * s, x + 0.24 * s, y + 0.06 * s, z, shade(WOOD_D, 1.25));
  b.kit('item.med.incenseSealMold', 1, y);
};

/** 茶碾：660 长木碾槽 + 铜槽底 + 铜碾轮 + 木轴柄（C-ITM-0147 铜木） */
export const teaMill: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.66 * s, 0.14 * s, 0.3 * s, x, y + 0.07 * s, z, shade(WOOD, 0.95));
  b.box('metal', 0.6 * s, 0.02 * s, 0.22 * s, x, y + 0.145 * s, z, shade(COPPER, 0.92));
  for (const sz of [-1, 1]) b.box('wood', 0.66 * s, 0.06 * s, 0.03 * s, x, y + 0.18 * s, z + sz * 0.13 * s, WOOD_D);
  b.cyl('metal', 0.1 * s, 0.1 * s, 0.1 * s, 10, x, y + 0.23 * s, z, shade(COPPER, 1.15), 0, 0, Math.PI / 2);
  b.box('wood', 0.05 * s, 0.05 * s, 0.32 * s, x + 0.24 * s, y + 0.28 * s, z, WOOD_D);
  b.kit('item.med.teaMill', 1, y);
};

/** 茶罗：径 400 罗框 + 绢罗面 + 双木把 + 底盘（C-ITM-0148） */
export const teaSieve: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.19 * s, 0.19 * s, 0.06 * s, 10, x, y + 0.03 * s, z, shade(WOOD, 1.1));
  b.cyl('fabric', 0.17 * s, 0.17 * s, 0.012 * s, 10, x, y + 0.066 * s, z, shade(PAPER, 0.92));
  b.cyl('wood', 0.2 * s, 0.2 * s, 0.05 * s, 10, x, y + 0.11 * s, z, shade(WOOD, 0.9), 0, 0, 0, true);
  for (const sx of [-1, 1]) b.box('wood', 0.1 * s, 0.03 * s, 0.04 * s, x + sx * 0.22 * s, y + 0.11 * s, z, WOOD_D);
  b.kit('item.med.teaSieve', 1, y);
};

/** 果秤：600 长双柱木秤架 + 铜盘 + 铜砣 + 木横梁（C-ITM-0264 木铜） */
export const fruitScale: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.04 * s, 0.6 * s, 0.04 * s, x + sx * 0.2 * s, y + 0.3 * s, z, WOOD_D);
  b.box('wood', 0.6 * s, 0.05 * s, 0.18 * s, x, y + 0.62 * s, z, shade(WOOD, 1.05));
  b.box('metal', 0.5 * s, 0.012 * s, 0.012 * s, x, y + 0.5 * s, z, IRONBLK);
  b.cyl('metal', 0.11 * s, 0.08 * s, 0.02 * s, 8, x - 0.2 * s, y + 0.42 * s, z, BRONZE);
  b.box('metal', 0.06 * s, 0.08 * s, 0.06 * s, x + 0.2 * s, y + 0.46 * s, z, shade(COPPER, 1.1));
  b.box('wood', 0.04 * s, 0.02 * s, 0.04 * s, x, y + 0.63 * s, z, GILTCU);
  b.kit('item.med.fruitScale', 1, y);
};

/** 下酒碟：径 260 粗陶碟 + 口沿暗釉 + 盐豆笋干三色（C-ITM-0278） */
export const wineDish: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.13 * s, 0.09 * s, 0.06 * s, 10, x, y + 0.03 * s, z, GRAYCERAMIC);
  b.cyl('ceramic', 0.132 * s, 0.132 * s, 0.012 * s, 10, x, y + 0.064 * s, z, shade(GRAYCERAMIC, 0.88), 0, 0, 0, true);
  for (const [ox, oz, col] of [[-0.04, 0.03, 0xe8e3d5], [0.05, -0.02, 0xb89b46], [0, 0.06, 0x6a7a4a]] as const) {
    b.box('ceramic', 0.07 * s, 0.03 * s, 0.05 * s, x + ox * s, y + 0.07 * s, z + oz * s, col);
  }
  b.kit('item.med.wineDish', 1, y);
};

/** 饼炉：径 600 灰陶饼炉 + 炉口 + 炭光 + 三铁足 + 两枚胡饼（C-ITM-0310） */
export const cakeStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.3 * s, 0.26 * s, 0.44 * s, 12, x, y + 0.24 * s, z, GRAYCERAMIC);
  b.cyl('ceramic', 0.32 * s, 0.32 * s, 0.06 * s, 12, x, y + 0.48 * s, z, shade(GRAYCERAMIC, 1.15));
  b.box('glow', 0.16 * s, 0.02 * s, 0.16 * s, x, y + 0.5 * s, z, 0xff7f50);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    b.box('metal', 0.05 * s, 0.06 * s, 0.05 * s, x + Math.cos(a) * 0.22 * s, y + 0.03 * s, z + Math.sin(a) * 0.22 * s, shade(IRONBLK, 0.9));
  }
  for (const sx of [-1, 1]) b.cyl('ceramic', 0.09 * s, 0.09 * s, 0.02 * s, 8, x + sx * 0.12 * s, y + 0.5 * s, z + 0.04 * s, 0xb89b46);
  b.kit('item.med.cakeStove', 1, y);
};

/** 端砚：260×180 端石砚 + 砚池 + 漆匣 + 墨锭 + 笔搁（C-ITM-0028） */
export const inkstone: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.26 * s, 0.03 * s, 0.18 * s, x, y + 0.015 * s, z, 0x2e1a16);
  b.box('ash', 0.22 * s, 0.05 * s, 0.15 * s, x, y + 0.055 * s, z, MINGSTONE);
  b.box('ash', 0.14 * s, 0.012 * s, 0.09 * s, x - 0.02 * s, y + 0.076 * s, z + 0.01 * s, shade(MINGSTONE, 0.7));
  b.box('lacquer', 0.05 * s, 0.03 * s, 0.05 * s, x + 0.1 * s, y + 0.06 * s, z - 0.06 * s, 0x2b2b2b);
  b.box('wood', 0.08 * s, 0.02 * s, 0.03 * s, x + 0.06 * s, y + 0.06 * s, z + 0.07 * s, BAMBOO2);
  b.kit('item.doc.inkstone', 1, y);
};

/** 当票簿：300×400 三册当票 + 漆封板 + 双朱绳 + 票签（C-ITM-0125） */
export const pawnLedger: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) b.box('fabric', 0.3 * s, 0.035 * s, 0.4 * s, x, y + (0.018 + i * 0.04) * s, z, i % 2 ? shade(PAPER, 0.9) : PAPER);
  b.box('lacquer', 0.32 * s, 0.02 * s, 0.42 * s, x, y + 0.135 * s, z, OILWOOD);
  for (const sz of [-1, 1]) b.box('fabric', 0.34 * s, 0.018 * s, 0.03 * s, x, y + 0.07 * s, z + sz * 0.12 * s, SEALRED);
  b.box('fabric', 0.05 * s, 0.12 * s, 0.03 * s, x + 0.15 * s, y + 0.06 * s, z, 0xc9b380);
  b.kit('item.doc.pawnLedger', 1, y);
};

/** 纸包：240×180 桑皮纸包 + 双道朱绳 + 一叠散包（C-ITM-0262） */
export const paperWrap: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('fabric', 0.24 * s, 0.14 * s, 0.18 * s, x, y + 0.07 * s, z, 0xc9b380);
  b.box('fabric', 0.02 * s, 0.142 * s, 0.182 * s, x, y + 0.07 * s, z, SEALRED);
  b.box('fabric', 0.242 * s, 0.02 * s, 0.184 * s, x, y + 0.07 * s, z, SEALRED);
  b.box('fabric', 0.18 * s, 0.1 * s, 0.14 * s, x + 0.14 * s, y + 0.05 * s, z + 0.16 * s, 0xd8cba8, 0.4);
  b.box('fabric', 0.16 * s, 0.09 * s, 0.12 * s, x - 0.02 * s, y + 0.045 * s, z + 0.26 * s, 0xc9b380, -0.25);
  b.kit('item.doc.paperWrap', 1, y);
};

/** 登记簿：340×260 摊开簿册 + 双页 + 墨笔 + 墨锭（C-ITM-0281） */
export const registerBook: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.34 * s, 0.02 * s, 0.26 * s, x, y + 0.01 * s, z, OILWOOD);
  for (const sz of [-1, 1]) b.box('fabric', 0.32 * s, 0.014 * s, 0.12 * s, x, y + 0.027 * s, z + sz * 0.06 * s, PAPER);
  b.box('wood', 0.24 * s, 0.008 * s, 0.008 * s, x + 0.02 * s, y + 0.04 * s, z, BAMBOO2, 0, 0, 0.3);
  b.box('lacquer', 0.04 * s, 0.02 * s, 0.03 * s, x - 0.14 * s, y + 0.03 * s, z + 0.08 * s, 0x2b2b2b);
  b.kit('item.doc.registerBook', 1, y);
};

/** 账簿：260×360 三册竖排账簿 + 双木夹板 + 朱签（C-ITM-0437） */
export const ledgerBook: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) b.box('fabric', 0.26 * s, 0.03 * s, 0.36 * s, x + (i % 2 ? 0.01 : 0) * s, y + (0.015 + i * 0.032) * s, z, i === 1 ? shade(PAPER, 0.88) : PAPER);
  for (const sx of [-1, 1]) b.box('wood', 0.3 * s, 0.09 * s, 0.04 * s, x + sx * 0.11 * s, y + 0.06 * s, z - 0.17 * s, WOOD_D);
  b.box('metal', 0.03 * s, 0.1 * s, 0.03 * s, x + 0.12 * s, y + 0.06 * s, z + 0.16 * s, 0x9d2933);
  b.kit('item.doc.ledger', 1, y);
};

/** 客籍簿：300×240 摊开客簿 + 木牌 + 笔（D-ITM-0156 客栈登记簿） */
export const guestLedger: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.3 * s, 0.018 * s, 0.24 * s, x, y + 0.009 * s, z, OILWOOD);
  for (const sx of [-1, 1]) b.box('fabric', 0.14 * s, 0.012 * s, 0.22 * s, x + sx * 0.075 * s, y + 0.024 * s, z + 0.01 * s, shade(PAPER, sx > 0 ? 1 : 0.94));
  b.box('wood', 0.1 * s, 0.02 * s, 0.06 * s, x + 0.2 * s, y + 0.01 * s, z - 0.06 * s, BAMBOO2);
  b.box('wood', 0.02 * s, 0.02 * s, 0.2 * s, x - 0.02 * s, y + 0.03 * s, z, BAMBOO2, 0.4);
  b.kit('item.doc.guestLedger', 1, y);
};

/** 金狻猊炉：400×460 漆托 + 鎏金狻猊蹲坐 + 四爪 + 鬃尾 + 炉口香光（C-ITM-0043） */
export const goldenLionCenser: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.4 * s, 0.06 * s, 0.46 * s, x, y + 0.03 * s, z, 0x2e1a16);
  b.cyl('metal', 0.16 * s, 0.2 * s, 0.26 * s, 8, x, y + 0.22 * s, z, GILT);
  b.box('metal', 0.2 * s, 0.16 * s, 0.26 * s, x, y + 0.42 * s, z - 0.02 * s, shade(GILT, 1.1));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('metal', 0.06 * s, 0.16 * s, 0.06 * s, x + sx * 0.13 * s, y + 0.1 * s, z + sz * 0.14 * s, shade(GILTCU, 0.9));
  }
  b.box('metal', 0.06 * s, 0.16 * s, 0.06 * s, x, y + 0.46 * s, z + 0.16 * s, GILTCU, 0, -0.4);
  b.cyl('metal', 0.08 * s, 0.08 * s, 0.05 * s, 6, x, y + 0.52 * s, z - 0.04 * s, shade(GILT, 0.9));
  b.box('glow', 0.06 * s, 0.05 * s, 0.06 * s, x, y + 0.56 * s, z - 0.04 * s, 0xffcf90);
  b.kit('item.furn.goldenLionCenser', 1, y);
};

/** 大铜鼎：径 940 三足双耳铜鼎 + 口沿 + 内壁暗面（C-ITM-0170，s 缩至室内尺度） */
export const bronzeDing: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.44 * s, 0.34 * s, 0.62 * s, 12, x, y + 0.57 * s, z, BRONZE);
  b.cyl('metal', 0.47 * s, 0.47 * s, 0.08 * s, 12, x, y + 0.92 * s, z, shade(BRONZE, 1.16));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.35;
    b.cyl('metal', 0.07 * s, 0.09 * s, 0.3 * s, 6, x + Math.cos(a) * 0.3 * s, y + 0.15 * s, z + Math.sin(a) * 0.3 * s, shade(BRONZE_D, 1.05));
  }
  for (const sx of [-1, 1]) b.box('metal', 0.08 * s, 0.2 * s, 0.12 * s, x + sx * 0.4 * s, y + 1.02 * s, z, BRONZE_D);
  b.cyl('metal', 0.4 * s, 0.4 * s, 0.02 * s, 12, x, y + 0.95 * s, z, shade(BRONZE, 0.8), 0, 0, 0, true);
  b.kit('item.furn.bronzeDing', 1, y);
};

/** 大铁鼎：径 820 玄铁三足双耳鼎 + 铁口沿 + 香灰（C-ITM-0325，s 缩至后院尺度） */
export const ironDing: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.38 * s, 0.3 * s, 0.5 * s, 10, x, y + 0.5 * s, z, IRONBLK);
  b.cyl('metal', 0.41 * s, 0.41 * s, 0.07 * s, 10, x, y + 0.79 * s, z, shade(IRONBLK, 1.5));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.35;
    b.cyl('metal', 0.06 * s, 0.08 * s, 0.26 * s, 6, x + Math.cos(a) * 0.26 * s, y + 0.13 * s, z + Math.sin(a) * 0.26 * s, shade(IRONBLK, 1.25));
  }
  for (const sx of [-1, 1]) b.box('metal', 0.07 * s, 0.16 * s, 0.1 * s, x + sx * 0.35 * s, y + 0.86 * s, z, shade(IRONBLK, 1.2));
  b.cyl('ash', 0.35 * s, 0.35 * s, 0.015 * s, 10, x, y + 0.82 * s, z, 0x6a6a62);
  b.kit('item.furn.ironDing', 1, y);
};

/** 旋梯：中柱 2300 + 八级旋踏 + 四栏柱 + 四段扶手（C-ITM-0203） */
export const spiralStair: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.09 * s, 0.11 * s, 2.3 * s, 6, x, y + 1.15 * s, z, WOOD_D);
  for (let i = 0; i < 8; i++) {
    const a = i * 0.62, r = 0.42 * s;
    b.box('wood', 0.62 * s, 0.05 * s, 0.24 * s, x + Math.cos(a) * r, y + (0.28 + i * 0.24) * s, z + Math.sin(a) * r, shade(WOOD, i % 2 ? 1.06 : 0.96), -a);
    if (i % 2 === 0) {
      b.box('wood', 0.04 * s, 0.5 * s, 0.04 * s, x + Math.cos(a) * 0.72 * s, y + (0.53 + i * 0.24) * s, z + Math.sin(a) * 0.72 * s, WOOD_D);
      b.box('wood', 0.05 * s, 0.04 * s, 0.3 * s, x + Math.cos(a) * 0.66 * s, y + (0.8 + i * 0.24) * s, z + Math.sin(a) * 0.66 * s, WOOD_D, -a);
    }
  }
  b.kit('item.tool.spiralStair', 1, y);
};

/** 木梯：2400 高双梁七档 + 顶双铁钩 + 底防滑（C-ITM-0456） */
export const woodLadder: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.07 * s, 2.4 * s, 0.09 * s, x + sx * 0.24 * s, y + 1.2 * s, z, WOOD_D, 0, 0.04);
  for (let i = 0; i < 7; i++) b.box('wood', 0.44 * s, 0.05 * s, 0.05 * s, x, y + (0.28 + i * 0.32) * s, z + 0.02 * s, shade(BAMBOO2, 1.06));
  for (const sx of [-1, 1]) b.box('metal', 0.06 * s, 0.1 * s, 0.16 * s, x + sx * 0.24 * s, y + 2.42 * s, z - 0.06 * s, IRONBLK);
  b.kit('item.tool.woodLadder', 1, y);
};

export const BATCH2_BUILDERS: Record<string, ItemBuilder> = {
  fireTongs, jadeMortar, jadeVanity, whisk, armillary, gourd, vajraRing,
  plaqueSunyang, plaqueYamen, railingScreen, waterFireSticks, petitionDrum, gong, stable, beautyRail,
  gavel, vermilionBrush, fateTube, boundaryPost, incenseDing, jadeRailing, soulChain, stele,
};

const BATCH2_TABLE: [RegExp, string][] = [
  [/长柄火钳/, 'fireTongs'],
  [/捣药玉钵/, 'jadeMortar'],
  [/白玉妆台/, 'jadeVanity'],
  [/童子拂尘/, 'whisk'],
  [/璇玑玉衡|天象仪/, 'armillary'],
  [/紫金药葫芦/, 'gourd'],
  [/金刚琢/, 'vajraRing'],
  [/孫羊正店|孙羊正店/, 'plaqueSunyang'],
  [/明鏡高懸|明镜高悬/, 'plaqueYamen'],
  [/栏杆隔断/, 'railingScreen'],
  [/水火棍/, 'waterFireSticks'],
  [/登闻鼓|登聞鼓/, 'petitionDrum'],
  [/开道锣|開道鑼/, 'gong'],
  [/马厩|馬廄/, 'stable'],
  [/凭栏|憑欄|美人靠/, 'beautyRail'],
  [/惊堂木|驚堂木/, 'gavel'],
  [/判官朱笔|判官朱筆/, 'vermilionBrush'],
  [/善恶签筒|善惡籤筒/, 'fateTube'],
  [/止步界桩|止步界樁/, 'boundaryPost'],
  [/焚香鼎/, 'incenseDing'],
  [/白玉栏杆|白玉欄杆/, 'jadeRailing'],
  [/锁魂链|鎖魂鏈/, 'soulChain'],
  [/界碑/, 'stele'],
];

const BATCH3_TABLE: [RegExp, string][] = [
  [/双眼大灶|雙眼大灶/, 'doubleStove'],
  [/木楼梯|木樓梯/, 'woodStair'],
  [/仪门|儀門/, 'ceremonialGate'],
  [/獬豸照壁/, 'xiezhiScreen'],
  [/戒石亭/, 'stonePavilion'],
  [/牢栅|牢柵/, 'jailBars'],
  [/更鼓/, 'nightDrum'],
  [/主棚茶棚|茶棚/, 'teaShed'],
  [/白烛阵|白燭陣/, 'candleArray'],
  [/地藏龛|地藏龕/, 'dizangNiche'],
  [/楹联·东|楹聯·東|楹联东/, 'coupletEast'],
  [/楹联·西|楹聯·西|楹联西/, 'coupletWest'],
  [/望柱栏板|望柱欄板/, 'stoneBaluster'],
  [/祈愿红绳|祈願紅繩/, 'wishCords'],
  [/残碑影壁|殘碑影壁/, 'brokenSteleScreen'],
  [/泪痕石|淚痕石/, 'tearStone'],
  [/骨阶扶索|骨階扶索/, 'boneHandrail'],
  [/望乡雾幕|望鄉霧幕/, 'mistCurtain'],
  [/八卦紫金丹炉|八卦紫金丹爐/, 'baguaFurnace'],
  [/九转金丹|九轉金丹/, 'goldenElixir'],
  [/霓裳羽衣/, 'featherRobe'],
  [/王母凤辇|王母鳳輦/, 'phoenixCarriage'],
];

const BATCH4_TABLE: [RegExp, string][] = [
  [/库房木箱/, 'crate'],
  [/库房钱箱/, 'cashChest'],
  [/货箱/, 'goodsCrate'],
  [/破木箱/, 'brokenCrate'],
  [/门钱栅箱|門錢柵箱/, 'moneyGateBox'],
  [/功德箱/, 'meritBox'],
  [/锦盒|錦盒/, 'brocadeBox'],
  [/浆糊桶|漿糊桶/, 'pasteBucket'],
  [/泔水桶/, 'slopPail'],
  [/水桶/, 'waterPail'],
  [/果桶/, 'fruitBarrel'],
  [/汤房浴桶|湯房浴桶|浴桶/, 'bathTub'],
  [/温酒器|溫酒器/, 'wineWarmer'],
  [/百眼药橱|百眼藥櫥/, 'hundredEyeCabinet'],
  [/药戥|藥戥/, 'medicineScale'],
  [/铜药碾|銅藥碾|药碾/, 'copperMill'],
  [/香戥/, 'incenseScale'],
  [/香篆模/, 'incenseSealMold'],
  [/茶碾/, 'teaMill'],
  [/茶罗|茶羅/, 'teaSieve'],
  [/果秤/, 'fruitScale'],
  [/下酒碟/, 'wineDish'],
  [/饼炉|餅爐/, 'cakeStove'],
  [/端砚|端硯/, 'inkstone'],
  [/当票簿|當票簿/, 'pawnLedger'],
  [/纸包|紙包/, 'paperWrap'],
  [/登记簿|登記簿/, 'registerBook'],
  [/账簿|帳簿/, 'ledgerBook'],
  [/客籍簿/, 'guestLedger'],
  [/金狻猊炉|金狻猊爐/, 'goldenLionCenser'],
  [/大铜鼎|大銅鼎/, 'bronzeDing'],
  [/大铁鼎|大鐵鼎/, 'ironDing'],
  [/旋梯/, 'spiralStair'],
  [/木梯/, 'woodLadder'],
];

export const BATCH3_BUILDERS: Record<string, ItemBuilder> = {
  doubleStove, woodStair, ceremonialGate, xiezhiScreen, stonePavilion, jailBars, nightDrum, teaShed,
  candleArray, dizangNiche, coupletEast, coupletWest, stoneBaluster, wishCords, brokenSteleScreen,
  tearStone, boneHandrail, mistCurtain, baguaFurnace, goldenElixir, featherRobe, phoenixCarriage,
};

export const BATCH4_BUILDERS: Record<string, ItemBuilder> = {
  crate, cashChest, goodsCrate, brokenCrate, moneyGateBox, meritBox, brocadeBox,
  pasteBucket, waterPail, slopPail, fruitBarrel, bathTub, wineWarmer,
  hundredEyeCabinet, medicineScale, copperMill, incenseScale, incenseSealMold, teaMill, teaSieve,
  fruitScale, wineDish, cakeStove,
  inkstone, pawnLedger, paperWrap, registerBook, ledgerBook, guestLedger,
  goldenLionCenser, bronzeDing, ironDing, spiralStair, woodLadder,
};

// ---------- 五批商货物件（41 件）：酒店酒垆 4 / 纸马冥器 2 / 香药诊案秤锁 5 / 靴店裁缝 4 / 瓦子演艺 7 / 码头仓储 6 / 院场陈设 11 / 天阁圣物 1 / 游动酒担 1 ----------
// 逐件按 20 卷「材质 / 形制 / 位置」建几何：材质组沿用 14 组（纸品与织物入 fabric、绸缎入 fabric、
// 瓷入 ceramic、铜铁入 metal、漆入 lacquer、石作入 ash、砖砌入 wall、沙土入 earth）。单件 ≤260 面，draw call 0 增。
const HEMP = 0xb89b6a;   // 麻布/麻绳
const SANDC = 0xa8926a;  // 沙土
const AZURE = 0x2a5c42;  // 青布（台幔 / 影戏帐）
const TEAKD = 0x955539;  // 粗陶酒瓮（与 indoors jar9 同源）

/** 酒垆：砖砌台身 1.4×0.95 + 榆木台面 + 三只封泥酒瓮 + 铜提子（砖木，沽酒台，台高 1.1m） */
// 酒垆：C-ITM-0274
export const wineCounter: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 1.4 * s, 0.95 * s, 0.8 * s, x, y + 0.475 * s, z, BRICK2);
  b.box('wood', 1.52 * s, 0.1 * s, 0.9 * s, x, y + 1.0 * s, z, OILWOOD);
  b.box('wood', 1.44 * s, 0.5 * s, 0.05 * s, x, y + 0.5 * s, z + 0.415 * s, shade(OILWOOD, 1.22));
  for (const [ox, sh] of [[-0.5, 0.94], [-0.16, 1.06], [0.42, 0.98]] as const) {
    b.cyl('ceramic', 0.13 * s, 0.16 * s, 0.28 * s * sh, 6, x + ox * s, y + (1.05 + 0.14 * sh) * s, z, shade(TEAKD, sh));
    b.cyl('ceramic', 0.09 * s, 0.13 * s, 0.05 * s, 6, x + ox * s, y + (1.05 + 0.3 * sh) * s, z, SEALRED);
  }
  b.cyl('metal', 0.09 * s, 0.07 * s, 0.13 * s, 6, x + 0.14 * s, y + 1.115 * s, z - 0.14 * s, shade(COPPER, 1.1));
  b.box('metal', 0.028 * s, 0.16 * s, 0.028 * s, x + 0.21 * s, y + 1.2 * s, z - 0.14 * s, shade(COPPER, 1.1), 0, 0, 0.55);
  b.cyl('wood', 0.07 * s, 0.025 * s, 0.11 * s, 6, x + 0.16 * s, y + 1.105 * s, z + 0.22 * s, WOOD);
  b.kit('item.shop.wineCounter', 1, y);
};

/** 蒸笼塔：五层竹圈叠蒸 + 竹盖与盖钮 + 灶口铁圈 + 三缕白汽（竹，蒸汽腾腾） */
// 蒸笼塔：C-ITM-0268
export const steamerStack: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('metal', 0.3 * s, 0.3 * s, 0.06 * s, 8, x, y + 0.03 * s, z, IRONBLK);
  for (let i = 0; i < 5; i++) {
    b.cyl('wood', 0.28 * s, 0.28 * s, 0.11 * s, 6, x, y + (0.115 + i * 0.115) * s, z, shade(BAMBOO, i % 2 ? 1.14 : 0.92), 0, 0, 0, true);
    b.cyl('wood', 0.285 * s, 0.285 * s, 0.018 * s, 6, x, y + (0.175 + i * 0.115) * s, z, shade(BAMBOO_L, 0.9), 0, 0, 0, true);
  }
  b.cyl('wood', 0.3 * s, 0.16 * s, 0.09 * s, 6, x, y + 0.66 * s, z, shade(BAMBOO_L, 1.05));
  b.cyl('wood', 0.05 * s, 0.06 * s, 0.05 * s, 6, x, y + 0.725 * s, z, OILWOOD);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.4;
    b.box('fabric', 0.1 * s, 0.26 * s, 0.1 * s, x + Math.cos(a) * 0.12 * s, y + 0.86 * s, z + Math.sin(a) * 0.12 * s, 0xdfe4e2, 0, 0, Math.cos(a) * 0.2);
  }
  b.kit('item.shop.steamerStack', 1, y);
};

/** 茶酒担：竹扁担 + 三脚歇架 + 一头铜茶炉与瓷壶 + 一头竹食盒与碗（竹木，游动货担） */
// 茶酒担：C-ITM-0164
export const teaWineCarry: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.5 * s, 0.06 * s, 0.06 * s, x, y + 1.02 * s, z, BAMBOO, 0, 0, 0.02);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.08 * s, 0.9 * s, 0.08 * s, x + sx * 0.68 * s, y + 0.45 * s, z, shade(BAMBOO, 0.88), 0, 0, sx * 0.06);
    b.box('fabric', 0.02 * s, 0.3 * s, 0.02 * s, x + sx * 0.42 * s, y + 0.84 * s, z, HEMP);
  }
  b.cyl('metal', 0.15 * s, 0.13 * s, 0.22 * s, 6, x - 0.42 * s, y + 0.62 * s, z, shade(COPPER, 0.95));
  b.box('glow', 0.1 * s, 0.03 * s, 0.1 * s, x - 0.42 * s, y + 0.52 * s, z + 0.1 * s, 0xff7f50);
  b.cyl('metal', 0.09 * s, 0.07 * s, 0.12 * s, 6, x - 0.42 * s, y + 0.79 * s, z, shade(COPPER, 1.15));
  b.cyl('ceramic', 0.1 * s, 0.08 * s, 0.1 * s, 6, x - 0.42 * s, y + 0.71 * s, z, 0xe8e0cc);
  b.box('wood', 0.32 * s, 0.18 * s, 0.3 * s, x + 0.42 * s, y + 0.58 * s, z, BAMBOO_L);
  b.box('wood', 0.34 * s, 0.03 * s, 0.32 * s, x + 0.42 * s, y + 0.68 * s, z, shade(BAMBOO, 0.9));
  b.cyl('ceramic', 0.07 * s, 0.05 * s, 0.06 * s, 6, x + 0.42 * s, y + 0.73 * s, z, 0xf4ecd8);
  b.kit('item.shop.teaWineCarry', 1, y);
};

/** 檐前果篮：铁挂钩 + 麻绳 + 双层编篮 + 三色时果（竹，吊篮陈列） */
// 檐前果篮：C-ITM-0265
export const eaveFruitBasket: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('metal', 0.03 * s, 0.3 * s, 0.03 * s, x, y + 0.72 * s, z, IRONBLK);
  b.box('metal', 0.16 * s, 0.03 * s, 0.03 * s, x - 0.07 * s, y + 0.86 * s, z, IRONBLK);
  b.box('fabric', 0.018 * s, 0.2 * s, 0.018 * s, x, y + 0.55 * s, z, HEMP);
  b.cyl('wood', 0.24 * s, 0.24 * s, 0.16 * s, 8, x, y + 0.4 * s, z, BAMBOO, 0, 0, 0, true);
  b.cyl('wood', 0.24 * s, 0.24 * s, 0.02 * s, 8, x, y + 0.33 * s, z, shade(BAMBOO, 0.86));
  b.cyl('wood', 0.25 * s, 0.25 * s, 0.025 * s, 8, x, y + 0.48 * s, z, shade(BAMBOO_L, 0.95), 0, 0, 0, true);
  b.cyl('wood', 0.17 * s, 0.17 * s, 0.13 * s, 8, x + 0.1 * s, y + 0.19 * s, z, shade(BAMBOO, 1.08), 0, 0, 0, true);
  b.cyl('wood', 0.17 * s, 0.17 * s, 0.018 * s, 8, x + 0.1 * s, y + 0.13 * s, z, shade(BAMBOO, 0.86));
  for (const [ox, oz, col] of [[-0.06, 0.05, 0xb8734a], [0.05, -0.04, 0xc08a3a], [0.07, 0.08, 0x8a9a4a]] as const) {
    b.box('ceramic', 0.08 * s, 0.07 * s, 0.08 * s, x + ox * s, y + 0.51 * s, z + oz * s, col);
  }
  b.kit('item.shop.eaveFruitBasket', 1, y);
};

/** 纸扎楼库：竹骨纸糊二层楼 + 朱柱 + 纸瓦顶 + 门洞彩带（竹纸，彩扎楼库） */
// 纸扎楼库：C-ITM-0131
export const paperVilla: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.035 * s, 1.1 * s, 0.035 * s, x + sx * 0.32 * s, y + 0.55 * s, z + sz * 0.21 * s, BAMBOO);
  b.box('fabric', 0.74 * s, 0.06 * s, 0.5 * s, x, y + 0.05 * s, z, 0xe8ddc6);
  b.box('fabric', 0.66 * s, 0.4 * s, 0.42 * s, x, y + 0.28 * s, z, 0xf4ecd8);
  b.box('fabric', 0.4 * s, 0.26 * s, 0.02 * s, x, y + 0.2 * s, z + 0.22 * s, 0x7a2c22);
  b.box('fabric', 0.68 * s, 0.05 * s, 0.44 * s, x, y + 0.5 * s, z, 0xd8ccae);
  b.box('fabric', 0.54 * s, 0.34 * s, 0.34 * s, x, y + 0.7 * s, z, 0xf4ecd8);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.08 * s, 0.3 * s, 0.02 * s, x - 0.18 * s + i * 0.18 * s, y + 0.7 * s, z + 0.18 * s, i === 1 ? 0x7a2c22 : 0xc8b98a);
  for (const sz of [-1, 1]) b.box('fabric', 0.8 * s, 0.06 * s, 0.32 * s, x, y + 0.9 * s, z + sz * 0.13 * s, 0x8a9a92, 0, sz * 0.42, 0);
  b.box('fabric', 0.82 * s, 0.04 * s, 0.05 * s, x, y + 0.98 * s, z, 0x7a2c22);
  for (const sx of [-1, 1]) b.box('fabric', 0.06 * s, 0.3 * s, 0.06 * s, x + sx * 0.3 * s, y + 1.0 * s, z, 0x9d2933);
  b.kit('item.shop.paperVilla', 1, y);
};

/** 冥钱串：竹挑杆 + 三串白纸钱 + 麻绳 + 朱签（纸绳，檐下白钱串） */
// 冥钱串：C-ITM-0132
export const spiritCoinString: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.06 * s, 1.5 * s, 0.06 * s, x, y + 0.75 * s, z, BAMBOO);
  b.box('wood', 0.5 * s, 0.05 * s, 0.05 * s, x + 0.24 * s, y + 1.5 * s, z, BAMBOO);
  b.box('wood', 0.34 * s, 0.05 * s, 0.34 * s, x, y + 0.03 * s, z, OILWOOD);
  for (let i = 0; i < 3; i++) {
    const px = x + (0.1 + i * 0.14) * s;
    b.box('fabric', 0.012 * s, 0.3 * s, 0.012 * s, px, y + 1.32 * s, z, HEMP);
    for (let k = 0; k < 4; k++) b.box('fabric', 0.1 * s, 0.1 * s, 0.006 * s, px, y + (1.14 - k * 0.11) * s, z + 0.02 * s, k % 2 ? 0xf4ecd8 : 0xe4dcc4);
  }
  b.box('fabric', 0.1 * s, 0.1 * s, 0.006 * s, x + 0.1 * s, y + 1.46 * s, z, SEALRED);
  b.kit('item.shop.spiritCoinString', 1, y);
};

/** 脉枕：绢面小枕 0.22×0.07 + 双端圆头 + 两道缠绳 + 底垫（绢囊，诊案） */
// 脉枕：C-ITM-0115
export const pulsePillow: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 0.26 * s, 0.014 * s, 0.14 * s, x, y + 0.007 * s, z, OILWOOD);
  b.box('fabric', 0.22 * s, 0.07 * s, 0.1 * s, x, y + 0.049 * s, z, 0xd8cbb0);
  for (const sx of [-1, 1]) b.cyl('fabric', 0.05 * s, 0.05 * s, 0.1 * s, 6, x + sx * 0.11 * s, y + 0.049 * s, z, 0xd8cbb0, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    b.box('fabric', 0.014 * s, 0.074 * s, 0.104 * s, x + sx * 0.07 * s, y + 0.049 * s, z, SEALRED);
    b.box('fabric', 0.06 * s, 0.006 * s, 0.02 * s, x + sx * 0.03 * s, y + 0.086 * s, z + 0.02 * s, 0xc8b98a);
  }
  b.box('fabric', 0.18 * s, 0.006 * s, 0.008 * s, x, y + 0.086 * s, z, 0xe8dcc0);
  b.kit('item.med.pulsePillow', 1, y);
};

/** 天平：木座 + 铜立柱 + 铜横梁 + 双铜盘 + 铜砣与刻度纸（铜木，称金银） */
// 天平：C-ITM-0124
export const balanceScale: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.34 * s, 0.05 * s, 0.22 * s, x, y + 0.025 * s, z, OILWOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.05 * s, 0.04 * s, 0.06 * s, x + sx * 0.13 * s, y + 0.02 * s, z + 0.08 * s, shade(OILWOOD, 1.2));
  b.cyl('metal', 0.022 * s, 0.03 * s, 0.34 * s, 6, x, y + 0.22 * s, z, shade(GILTCU, 0.95));
  b.box('metal', 0.44 * s, 0.018 * s, 0.018 * s, x, y + 0.4 * s, z, GILTCU);
  b.box('metal', 0.012 * s, 0.14 * s, 0.012 * s, x, y + 0.33 * s, z - 0.03 * s, GILTCU, 0, 0, 0.1);
  for (const sx of [-1, 1]) {
    b.box('fabric', 0.006 * s, 0.16 * s, 0.006 * s, x + sx * 0.2 * s, y + 0.31 * s, z, HEMP);
    b.cyl('metal', 0.075 * s, 0.06 * s, 0.02 * s, 8, x + sx * 0.2 * s, y + 0.22 * s, z, shade(GILTCU, 1.15));
  }
  b.box('metal', 0.05 * s, 0.07 * s, 0.05 * s, x + 0.05 * s, y + 0.36 * s, z, IRONBLK);
  b.box('fabric', 0.1 * s, 0.004 * s, 0.06 * s, x - 0.1 * s, y + 0.052 * s, z, PAPER);
  b.kit('item.shop.balanceScale', 1, y);
};

/** 铜锁：兽头锁体 + 双目双耳 + U 形锁梁 + 锁扣座 + 钥孔（铜，库门箱扣） */
// 铜锁：C-ITM-0127
export const beastLock: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('metal', 0.15 * s, 0.14 * s, 0.055 * s, x, y + 0.07 * s, z, shade(COPPER, 0.8));
  b.box('metal', 0.11 * s, 0.05 * s, 0.02 * s, x, y + 0.1 * s, z + 0.035 * s, shade(ZIJIN, 0.9));
  for (const sx of [-1, 1]) {
    b.box('metal', 0.03 * s, 0.03 * s, 0.02 * s, x + sx * 0.035 * s, y + 0.105 * s, z + 0.045 * s, GILTCU);
    b.box('metal', 0.02 * s, 0.05 * s, 0.03 * s, x + sx * 0.075 * s, y + 0.14 * s, z, shade(COPPER, 1.1), 0, 0, sx * 0.3);
  }
  for (const sx of [-1, 1]) b.box('metal', 0.02 * s, 0.09 * s, 0.02 * s, x + sx * 0.05 * s, y + 0.19 * s, z, shade(IRONBLK, 1.2));
  b.box('metal', 0.12 * s, 0.02 * s, 0.02 * s, x, y + 0.235 * s, z, shade(IRONBLK, 1.2));
  b.box('metal', 0.05 * s, 0.03 * s, 0.02 * s, x, y + 0.045 * s, z + 0.035 * s, IRONBLK);
  b.box('metal', 0.016 * s, 0.03 * s, 0.01 * s, x, y + 0.045 * s, z + 0.045 * s, GILTCU);
  b.kit('item.shop.beastLock', 1, y);
};

/** 铁栅：八根铁条 + 上下横档 + 双立框 + 四枚锈钉（铁，护窗栅） */
// 铁栅：C-ITM-0123
export const windowGrille: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 8; i++) b.box('metal', 0.035 * s, 1.5 * s, 0.035 * s, x, y + 0.78 * s, z - 0.5 * s + i * 0.143 * s, IRONBLK);
  for (const sy of [0.12, 1.44]) b.box('metal', 0.05 * s, 0.05 * s, 1.06 * s, x, y + sy * s, z, shade(IRONBLK, 1.25));
  for (const sz of [-1, 1]) b.box('metal', 0.06 * s, 1.56 * s, 0.06 * s, x, y + 0.78 * s, z + sz * 0.53 * s, shade(IRONBLK, 1.4));
  for (let i = 0; i < 4; i++) b.box('metal', 0.012 * s, 0.05 * s, 0.05 * s, x + 0.04 * s, y + 0.9 * s, z - 0.45 * s + i * 0.3 * s, RUST);
  b.kit('item.shop.windowGrille', 1, y);
};

/** 官秤：木秤架 + 木秤杆 1.5 + 铜秤钩秤砣 + 铜秤盘 + 木提纽（木铜，大杆秤） */
// 官秤：C-ITM-0218
export const beamScale: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.06 * s, 0.5 * s, 0.5 * s, x + sx * 0.5 * s, y + 0.25 * s, z, OILWOOD);
  b.box('wood', 1.2 * s, 0.06 * s, 0.14 * s, x, y + 0.53 * s, z, shade(OILWOOD, 1.15));
  b.cyl('wood', 0.035 * s, 0.045 * s, 1.5 * s, 6, x, y + 0.62 * s, z, shade(WOOD, 1.05), 0, 0, Math.PI / 2);
  b.cyl('metal', 0.05 * s, 0.05 * s, 0.06 * s, 6, x - 0.62 * s, y + 0.62 * s, z, GILTCU, 0, 0, Math.PI / 2);
  b.box('metal', 0.02 * s, 0.16 * s, 0.02 * s, x - 0.7 * s, y + 0.54 * s, z, GILTCU);
  b.cyl('metal', 0.16 * s, 0.13 * s, 0.03 * s, 8, x - 0.7 * s, y + 0.44 * s, z, shade(GILTCU, 1.2));
  b.box('metal', 0.08 * s, 0.1 * s, 0.08 * s, x + 0.55 * s, y + 0.53 * s, z, shade(IRONBLK, 1.15));
  b.box('fabric', 0.006 * s, 0.16 * s, 0.006 * s, x + 0.3 * s, y + 0.7 * s, z, HEMP);
  b.box('metal', 0.04 * s, 0.12 * s, 0.04 * s, x + 0.3 * s, y + 0.8 * s, z, GILTCU);
  b.kit('item.shop.beamScale', 1, y);
};

/** 楦头：木托盘 + 三副定型木楦（前掌/后跟/踝柱）+ 半成品鞋面（木，定制楦型） */
// 楦头：C-ITM-0289
export const shoeLast: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.5 * s, 0.05 * s, 0.34 * s, x, y + 0.025 * s, z, shade(WOOD, 1.1));
  for (let i = 0; i < 3; i++) {
    const px = x - 0.15 * s + i * 0.15 * s;
    b.box('wood', 0.13 * s, 0.09 * s, 0.06 * s, px, y + 0.095 * s, z - 0.03 * s, shade(WOOD, 1.05), 0, 0.06);
    b.box('wood', 0.12 * s, 0.07 * s, 0.1 * s, px, y + 0.09 * s, z + 0.03 * s, shade(WOOD, 0.92));
    b.box('wood', 0.07 * s, 0.14 * s, 0.06 * s, px, y + 0.15 * s, z - 0.06 * s, shade(WOOD, 1.14));
  }
  b.box('wood', 0.1 * s, 0.03 * s, 0.03 * s, x + 0.2 * s, y + 0.065 * s, z + 0.14 * s, WOOD_D, 0.4);
  b.box('fabric', 0.14 * s, 0.02 * s, 0.1 * s, x - 0.16 * s, y + 0.06 * s, z + 0.13 * s, 0x8a5a2b, -0.2);
  b.kit('item.shop.shoeLast', 1, y);
};

/** 锥线筐：竹编浅筐 + 双线团 + 两支铁锥 + 蜂蜡块（竹铁，纳鞋工具） */
// 锥线筐：C-ITM-0291
export const awlBasket: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.2 * s, 0.15 * s, 0.14 * s, 8, x, y + 0.07 * s, z, BAMBOO, 0, 0, 0, true);
  b.cyl('wood', 0.15 * s, 0.15 * s, 0.02 * s, 8, x, y + 0.01 * s, z, shade(BAMBOO, 0.84));
  b.cyl('wood', 0.2 * s, 0.2 * s, 0.02 * s, 8, x, y + 0.14 * s, z, shade(BAMBOO_L, 0.95), 0, 0, 0, true);
  for (const sx of [-1, 1]) b.cyl('fabric', 0.05 * s, 0.05 * s, 0.08 * s, 6, x + sx * 0.06 * s, y + 0.19 * s, z - 0.04 * s, sx > 0 ? 0xd8cbb0 : 0x8a3a2a);
  b.box('wood', 0.02 * s, 0.02 * s, 0.2 * s, x - 0.04 * s, y + 0.22 * s, z + 0.04 * s, WOOD_D, 0.3, 0, 0.2);
  b.box('metal', 0.014 * s, 0.014 * s, 0.1 * s, x - 0.1 * s, y + 0.24 * s, z + 0.13 * s, IRON, 0.3);
  b.box('wood', 0.02 * s, 0.02 * s, 0.2 * s, x + 0.06 * s, y + 0.22 * s, z - 0.02 * s, WOOD_D, -0.2, 0, -0.15);
  b.box('metal', 0.014 * s, 0.014 * s, 0.1 * s, x + 0.12 * s, y + 0.24 * s, z + 0.06 * s, IRON, -0.2);
  b.box('wood', 0.06 * s, 0.04 * s, 0.06 * s, x + 0.1 * s, y + 0.17 * s, z + 0.1 * s, 0xc8b98a);
  b.kit('item.shop.awlBasket', 1, y);
};

/** 裁尺：木尺托 + 三支竹尺（刻度四道）+ 布卷 + 压尺（竹木，量体） */
// 裁尺：C-ITM-0254
export const tailorRule: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.56 * s, 0.03 * s, 0.22 * s, x, y + 0.015 * s, z, shade(WOOD, 1.08));
  for (let i = 0; i < 3; i++) {
    b.box('wood', 0.5 * s, 0.012 * s, 0.03 * s, x, y + (0.036 + i * 0.013) * s, z - 0.07 * s + i * 0.07 * s, i === 1 ? BAMBOO_L : BAMBOO, 0, 0, i * 0.02);
  }
  for (let i = 0; i < 4; i++) b.box('lacquer', 0.008 * s, 0.004 * s, 0.026 * s, x - 0.18 * s + i * 0.12 * s, y + 0.045 * s, z - 0.07 * s, INK);
  b.cyl('fabric', 0.07 * s, 0.07 * s, 0.26 * s, 8, x + 0.18 * s, y + 0.08 * s, z + 0.12 * s, shade(0x9d2933, 0.95), 0, 0, Math.PI / 2);
  b.box('wood', 0.06 * s, 0.04 * s, 0.18 * s, x - 0.22 * s, y + 0.05 * s, z + 0.1 * s, WOOD_D, 0.2);
  b.kit('item.shop.tailorRule', 1, y);
};

/** 裁剪：双铁刃 + 铜枢轴 + 双铜环柄 + 布片 + 木托（铁，裁衣剪） */
// 裁剪：C-ITM-0255
export const tailorShears: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.34 * s, 0.02 * s, 0.2 * s, x, y + 0.01 * s, z, WOOD_D);
  for (const sz of [-1, 1]) b.box('metal', 0.26 * s, 0.008 * s, 0.03 * s, x + 0.06 * s, y + 0.03 * s, z + sz * 0.02 * s, 0xb8c0c8, 0, 0, sz * 0.06);
  b.cyl('metal', 0.028 * s, 0.028 * s, 0.012 * s, 6, x - 0.05 * s, y + 0.036 * s, z, shade(GILTCU, 0.9));
  for (const sz of [-1, 1]) {
    b.cyl('metal', 0.045 * s, 0.045 * s, 0.014 * s, 8, x - 0.15 * s, y + 0.04 * s, z + sz * 0.05 * s, GILTCU, 0, Math.PI / 2, 0, true);
    b.box('metal', 0.1 * s, 0.01 * s, 0.012 * s, x - 0.1 * s, y + 0.036 * s, z + sz * 0.04 * s, 0xb8c0c8, 0, 0, sz * 0.2);
  }
  b.box('fabric', 0.16 * s, 0.012 * s, 0.14 * s, x + 0.1 * s, y + 0.026 * s, z + 0.14 * s, 0x9d2933, 0.3);
  b.box('fabric', 0.1 * s, 0.01 * s, 0.1 * s, x + 0.16 * s, y + 0.036 * s, z + 0.22 * s, 0xd8cbb0, -0.2);
  b.kit('item.shop.tailorShears', 1, y);
};

/** 雅间阁子：木格扇隔断 2.2×2.4 + 五竖棂三横档 + 裙板 + 转角扇铜活（木格扇，私语间） */
// 雅间阁子：C-ITM-0150
export const privateBooth: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sy of [0.05, 2.36]) b.box('wood', 2.2 * s, 0.1 * s, 0.1 * s, x, y + sy * s, z, OILWOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.1 * s, 2.4 * s, 0.1 * s, x + sx * 1.05 * s, y + 1.2 * s, z, OILWOOD);
  for (let i = 0; i < 5; i++) b.box('wood', 0.045 * s, 1.28 * s, 0.05 * s, x - 0.72 * s + i * 0.36 * s, y + 1.66 * s, z, shade(WOOD, 1.05));
  for (let i = 0; i < 2; i++) b.box('wood', 2.02 * s, 0.05 * s, 0.05 * s, x, y + (1.18 + i * 0.7) * s, z, shade(WOOD, 1.05));
  b.box('wood', 2.02 * s, 0.6 * s, 0.06 * s, x, y + 0.66 * s, z, shade(OILWOOD, 1.1));
  b.box('wood', 0.5 * s, 1.0 * s, 0.06 * s, x + 1.3 * s, y + 0.6 * s, z - 0.4 * s, OILWOOD, 0.6);
  for (const sx of [-1, 1]) b.box('metal', 0.05 * s, 0.16 * s, 0.03 * s, x + sx * 0.5 * s, y + 1.16 * s, z + 0.05 * s, GILTCU);
  b.kit('item.hall.privateBooth', 1, y);
};

/** 台幔：双木柱石础 + 木横杆 + 三幅青布幔 + 幔头 + 縧带 + 下摆（青布，装台幕幔） */
// 台幔：C-ITM-0155
export const stageCurtain: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.1 * s, 2.5 * s, 0.1 * s, x + sx * 1.28 * s, y + 1.25 * s, z, OILWOOD);
    b.box('ash', 0.24 * s, 0.1 * s, 0.24 * s, x + sx * 1.28 * s, y + 0.05 * s, z, BLUESTONE);
  }
  b.cyl('wood', 0.045 * s, 0.045 * s, 2.7 * s, 6, x, y + 2.46 * s, z, WOOD_D, 0, 0, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const px = x - 0.86 * s + i * 0.86 * s;
    b.box('fabric', 0.8 * s, 1.9 * s, 0.03 * s, px, y + 1.45 * s, z, i === 1 ? shade(AZURE, 1.12) : AZURE);
    b.box('fabric', 0.8 * s, 0.12 * s, 0.05 * s, px, y + 2.38 * s, z, shade(AZURE, 0.78));
    b.box('fabric', 0.05 * s, 0.3 * s, 0.045 * s, px + (i === 1 ? 0.22 : -0.24) * s, y + 1.9 * s, z + 0.02 * s, 0xd4b76a);
  }
  b.box('fabric', 2.6 * s, 0.1 * s, 0.06 * s, x, y + 0.52 * s, z, shade(AZURE, 0.86));
  b.kit('item.hall.stageCurtain', 1, y);
};

/** 马廊栏杆：四跨木栏 + 双横杆 + 立柱 + 双端柱与石座（木，隔离看台） */
// 马廊栏杆：C-ITM-0158
export const arenaRail: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 4; i++) {
    const px = x - 1.2 * s + i * 0.8 * s;
    b.box('wood', 0.86 * s, 0.07 * s, 0.07 * s, px, y + 1.02 * s, z - i * 0.05 * s, shade(WOOD, 1.08), i * 0.06);
    b.box('wood', 0.86 * s, 0.06 * s, 0.06 * s, px, y + 0.56 * s, z - i * 0.05 * s, WOOD_D, i * 0.06);
    b.box('wood', 0.08 * s, 1.06 * s, 0.08 * s, px - 0.42 * s, y + 0.53 * s, z - i * 0.05 * s, OILWOOD);
  }
  for (const sx of [-1, 1]) {
    b.box('wood', 0.12 * s, 1.24 * s, 0.12 * s, x + sx * 1.68 * s, y + 0.62 * s, z - 0.12 * s, OILWOOD);
    b.box('ash', 0.28 * s, 0.08 * s, 0.28 * s, x + sx * 1.68 * s, y + 0.04 * s, z - 0.12 * s, BLUESTONE);
  }
  b.kit('item.hall.arenaRail', 1, y);
};

/** 傀儡棚：木台面 1.8×1.2 + 四柱 + 席顶 + 前檐 + 背幕 + 双傀儡提线（木席，傀儡戏台） */
// 傀儡棚：C-ITM-0160
export const puppetStage: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.8 * s, 0.1 * s, 1.2 * s, x, y + 0.9 * s, z, shade(WOOD, 1.05));
  b.box('fabric', 1.8 * s, 0.62 * s, 0.04 * s, x, y + 0.55 * s, z + 0.58 * s, 0x9d2933);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.08 * s, 2.2 * s, 0.08 * s, x + sx * 0.84 * s, y + 1.1 * s, z + sz * 0.52 * s, OILWOOD);
  b.box('fabric', 1.9 * s, 0.05 * s, 1.3 * s, x, y + 2.24 * s, z, 0xd8cbb0);
  b.box('wood', 1.9 * s, 0.08 * s, 0.08 * s, x, y + 2.18 * s, z + 0.6 * s, WOOD_D);
  b.box('fabric', 1.6 * s, 1.0 * s, 0.03 * s, x, y + 1.5 * s, z - 0.5 * s, 0x2a5c42);
  for (const sx of [-1, 1]) {
    b.box('fabric', 0.14 * s, 0.3 * s, 0.1 * s, x + sx * 0.36 * s, y + 1.2 * s, z + 0.1 * s, sx > 0 ? 0xd8b0a0 : 0x8fa8b8);
    b.box('fabric', 0.1 * s, 0.1 * s, 0.09 * s, x + sx * 0.36 * s, y + 1.4 * s, z + 0.1 * s, 0xe8dcc0);
    b.box('fabric', 0.008 * s, 0.5 * s, 0.008 * s, x + sx * 0.36 * s, y + 1.75 * s, z + 0.1 * s, HEMP);
  }
  b.kit('item.hall.puppetStage', 1, y);
};

/** 影戏亮子：木框白幕 1.56×0.96 + 双斜撑底脚 + 铜油灯 + 幕上皮影（白幕油灯，皮影戏） */
// 影戏亮子：C-ITM-0161
export const shadowScreen: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sy of [0.72, 1.76]) b.box('wood', 1.7 * s, 0.08 * s, 0.08 * s, x, y + sy * s, z, OILWOOD);
  for (const sz of [-1, 1]) b.box('wood', 0.08 * s, 1.12 * s, 0.08 * s, x, y + 1.24 * s, z + sz * 0.86 * s, OILWOOD);
  b.box('fabric', 1.56 * s, 0.96 * s, 0.02 * s, x, y + 1.24 * s, z, 0xf4ecd8);
  for (const sz of [-1, 1]) {
    b.box('wood', 0.07 * s, 1.0 * s, 0.07 * s, x - 0.24 * s, y + 0.52 * s, z + sz * 0.4 * s, WOOD_D, 0, 0, 0.24);
    b.box('wood', 0.34 * s, 0.06 * s, 0.1 * s, x + 0.06 * s, y + 0.04 * s, z + sz * 0.4 * s, WOOD_D);
  }
  b.cyl('metal', 0.09 * s, 0.08 * s, 0.12 * s, 6, x + 0.5 * s, y + 0.86 * s, z, shade(COPPER, 0.9));
  b.box('glow', 0.07 * s, 0.09 * s, 0.07 * s, x + 0.5 * s, y + 0.96 * s, z, 0xffc66e);
  b.box('fabric', 0.2 * s, 0.34 * s, 0.012 * s, x - 0.18 * s, y + 1.26 * s, z + 0.02 * s, 0x5a3a24, 0, 0, 0.1);
  b.box('fabric', 0.13 * s, 0.26 * s, 0.012 * s, x + 0.2 * s, y + 1.2 * s, z + 0.02 * s, 0x7a2c22, 0, 0, -0.08);
  b.kit('item.hall.shadowScreen', 1, y);
};

/** 相扑沙圈：夯沙圆台 + 十枚圈桩 + 两道白线（沙土，露天沙圈） */
// 相扑沙圈：C-ITM-0162
export const sandRing: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('earth', 1.3 * s, 1.34 * s, 0.08 * s, 16, x, y + 0.04 * s, z, SANDC);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box('wood', 0.09 * s, 0.3 * s, 0.09 * s, x + Math.cos(a) * 1.3 * s, y + 0.15 * s, z + Math.sin(a) * 1.3 * s, shade(OILWOOD, 0.9 + (i % 2) * 0.16));
  }
  for (const sz of [-1, 1]) b.box('fabric', 1.0 * s, 0.008 * s, 0.06 * s, x, y + 0.086 * s, z + sz * 0.4 * s, 0xe8e3d5);
  b.kit('item.hall.sandRing', 1, y);
};

/** 铜锣：锤揲锣体 + 翻卷锣边 + 锣心 + 木架双柱横梁 + 锣槌（铜，开场锣） */
// 铜锣：C-ITM-0166
export const brassGong: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.07 * s, 1.36 * s, 0.07 * s, x + sx * 0.42 * s, y + 0.68 * s, z - 0.04 * s, OILWOOD);
    b.box('wood', 0.2 * s, 0.06 * s, 0.4 * s, x + sx * 0.42 * s, y + 0.03 * s, z - 0.04 * s, OILWOOD);
  }
  b.box('wood', 0.94 * s, 0.07 * s, 0.08 * s, x, y + 1.38 * s, z - 0.04 * s, OILWOOD);
  b.cyl('metal', 0.32 * s, 0.32 * s, 0.03 * s, 12, x, y + 1.0 * s, z, shade(ZIJIN, 1.05), 0, Math.PI / 2);
  b.cyl('metal', 0.325 * s, 0.325 * s, 0.07 * s, 12, x, y + 1.0 * s, z, shade(ZIJIN, 0.84), 0, Math.PI / 2, 0, true);
  b.cyl('metal', 0.08 * s, 0.08 * s, 0.035 * s, 6, x, y + 1.0 * s, z + 0.03 * s, shade(ZIJIN, 1.22));
  b.box('fabric', 0.02 * s, 0.34 * s, 0.02 * s, x, y + 1.28 * s, z, HEMP);
  b.cyl('wood', 0.016 * s, 0.02 * s, 0.34 * s, 6, x + 0.36 * s, y + 0.78 * s, z + 0.1 * s, WOOD, 0, 0, 0.5);
  b.cyl('fabric', 0.05 * s, 0.05 * s, 0.09 * s, 6, x + 0.42 * s, y + 0.94 * s, z + 0.1 * s, SEALRED);
  b.kit('item.hall.brassGong', 1, y);
};

/** 系船桩：双木桩 + 三道铁箍 + 三圈缠缆 + 石座（木铁，缆痕深深） */
// 系船桩：C-ITM-0213
export const mooringPost: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.cyl('wood', 0.11 * s, 0.13 * s, 1.1 * s, 8, x + sx * 0.42 * s, y + 0.55 * s, z, shade(WOOD, 0.94));
    b.box('wood', 0.24 * s, 0.06 * s, 0.24 * s, x + sx * 0.42 * s, y + 1.13 * s, z, shade(WOOD_D, 1.2));
    b.box('ash', 0.34 * s, 0.12 * s, 0.34 * s, x + sx * 0.42 * s, y + 0.06 * s, z, BLUESTONE);
  }
  for (let i = 0; i < 3; i++) b.cyl('metal', 0.135 * s, 0.135 * s, 0.045 * s, 8, x - 0.42 * s, y + (0.24 + i * 0.3) * s, z, shade(IRONBLK, 1.1), 0, 0, 0, true);
  for (let i = 0; i < 3; i++) b.cyl('fabric', 0.16 * s, 0.16 * s, 0.05 * s, 8, x + 0.42 * s, y + (0.44 + i * 0.16) * s, z, shade(HEMP, 0.88 + i * 0.08), 0, 0, 0, true);
  b.box('fabric', 0.6 * s, 0.02 * s, 0.02 * s, x, y + 0.36 * s, z + 0.1 * s, HEMP, 0, 0, 0.06);
  b.kit('item.wharf.mooringPost', 1, y);
};

/** 麻袋垛：六只麻袋三层码齐 + 木垫板 + 缝线 + 捆绳（麻布，粮垛） */
// 麻袋垛：C-ITM-0217
export const sackStack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.12 * s, 0.08 * s, 0.9 * s, x + sx * 0.5 * s, y + 0.04 * s, z, WOOD_D);
  const rows: [number, number, number, number][] = [
    [-0.32, 0.14, 0.62, 0.72], [0.34, 0.14, 0.58, 0.68], [0.02, 0.33, 0.6, 0.7],
    [-0.34, 0.34, 0.56, 0.66], [0.36, 0.34, 0.54, 0.64], [0.0, 0.52, 0.56, 0.62],
  ];
  for (const [ox, oy, w, d] of rows) {
    b.box('fabric', w * s, 0.18 * s, d * s, x + ox * s, y + (0.08 + oy) * s, z, shade(HEMP, 0.92 + oy * 0.28), ox * 0.2, 0, ox * 0.3);
    b.box('fabric', w * s, 0.012 * s, 0.02 * s, x + ox * s, y + (0.08 + oy) * s, z + d * 0.4 * s, shade(HEMP, 0.78));
  }
  b.box('fabric', 0.7 * s, 0.02 * s, 0.02 * s, x, y + 0.62 * s, z, shade(HEMP, 0.7), 0.3);
  b.kit('item.wharf.sackStack', 1, y);
};

/** 波斯毯：平铺织物毯 2.2×1.6 + 双层边饰 + 四菱纹 + 圆心纹 + 四流苏（织物，胡商珍货） */
// 波斯毯：C-ITM-0244
export const persianRug: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('fabric', 2.2 * s, 0.022 * s, 1.6 * s, x, y + 0.011 * s, z, 0x7a2c3a);
  for (const [w, d, col] of [[2.0, 1.4, 0xd4b76a], [1.7, 1.1, 0x2a3c5c]] as const) {
    b.box('fabric', w * s, 0.006 * s, 0.08 * s, x, y + 0.026 * s, z + d * 0.5 * s, col);
    b.box('fabric', w * s, 0.006 * s, 0.08 * s, x, y + 0.026 * s, z - d * 0.5 * s, col);
    b.box('fabric', 0.08 * s, 0.006 * s, d * s, x + w * 0.5 * s, y + 0.026 * s, z, col);
    b.box('fabric', 0.08 * s, 0.006 * s, d * s, x - w * 0.5 * s, y + 0.026 * s, z, col);
  }
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    b.box('fabric', 0.24 * s, 0.006 * s, 0.24 * s, x + Math.cos(a) * 0.46 * s, y + 0.028 * s, z + Math.sin(a) * 0.32 * s, 0xd4b76a, Math.PI / 4);
  }
  b.cyl('fabric', 0.2 * s, 0.2 * s, 0.006 * s, 8, x, y + 0.029 * s, z, 0xd4b76a);
  for (const sx of [-1, 1]) for (const oz of [-0.4, 0.4]) b.box('fabric', 0.06 * s, 0.008 * s, 0.05 * s, x + sx * 1.12 * s, y + 0.012 * s, z + oz * s, 0xe8dcc0);
  b.kit('item.wharf.persianRug', 1, y);
};

/** 牙帖公示榜：木榜板 + 上下边框 + 六行帖纸 + 双朱印 + 双挂环（木，行帖名单） */
// 牙帖公示榜：C-ITM-0245
export const guildBoard: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.4 * s, 1.4 * s, 0.06 * s, x, y + 0.7 * s, z, shade(WOOD, 0.96));
  for (const sy of [0.02, 1.36]) b.box('wood', 1.5 * s, 0.08 * s, 0.1 * s, x, y + sy * s, z, OILWOOD);
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 1.42 * s, 0.1 * s, x + sx * 0.71 * s, y + 0.7 * s, z, OILWOOD);
  for (let i = 0; i < 6; i++) b.box('fabric', 0.9 * s, 0.14 * s, 0.012 * s, x, y + (1.16 - i * 0.19) * s, z + 0.035 * s, i === 0 ? 0xf4ecd8 : shade(PAPER, 1 - i * 0.03));
  b.box('fabric', 0.1 * s, 0.1 * s, 0.01 * s, x + 0.52 * s, y + 1.16 * s, z + 0.042 * s, SEALRED);
  b.box('fabric', 0.1 * s, 0.1 * s, 0.01 * s, x - 0.5 * s, y + 0.78 * s, z + 0.042 * s, SEALRED);
  for (const sx of [-1, 1]) b.box('metal', 0.05 * s, 0.1 * s, 0.05 * s, x + sx * 0.6 * s, y + 1.44 * s, z, GILTCU);
  b.kit('item.wharf.guildBoard', 1, y);
};

/** 水井辘轳：石井圈井沿 + 水面 + 木架双柱横梁 + 辘轳筒摇柄 + 井绳木桶（石木，市井公井） */
// 水井辘轳：C-ITM-0246
export const wellWindlass: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ash', 0.52 * s, 0.56 * s, 0.4 * s, 12, x, y + 0.2 * s, z, 0x6a6f66, 0, 0, 0, true);
  b.cyl('ash', 0.6 * s, 0.6 * s, 0.08 * s, 10, x, y + 0.44 * s, z, shade(BLUESTONE, 1.05));
  b.cyl('water', 0.46 * s, 0.46 * s, 0.02 * s, 8, x, y + 0.3 * s, z, 0x1e2c33);
  for (const sx of [-1, 1]) b.box('wood', 0.1 * s, 1.1 * s, 0.1 * s, x + sx * 0.62 * s, y + 0.55 * s, z, OILWOOD);
  b.box('wood', 1.36 * s, 0.1 * s, 0.1 * s, x, y + 1.14 * s, z, OILWOOD);
  b.cyl('wood', 0.13 * s, 0.13 * s, 0.7 * s, 8, x, y + 0.98 * s, z, shade(WOOD, 1.06), 0, 0, Math.PI / 2);
  b.box('metal', 0.05 * s, 0.05 * s, 0.34 * s, x + 0.42 * s, y + 0.98 * s, z + 0.12 * s, IRONBLK, 0.5);
  b.box('wood', 0.05 * s, 0.05 * s, 0.16 * s, x + 0.46 * s, y + 0.98 * s, z + 0.28 * s, WOOD_D, 0.5);
  b.box('fabric', 0.015 * s, 0.42 * s, 0.015 * s, x, y + 0.75 * s, z + 0.14 * s, HEMP);
  b.cyl('wood', 0.14 * s, 0.12 * s, 0.2 * s, 8, x, y + 0.42 * s, z + 0.14 * s, shade(WOOD, 0.9), 0, 0, 0, true);
  b.cyl('wood', 0.12 * s, 0.12 * s, 0.02 * s, 8, x, y + 0.33 * s, z + 0.14 * s, shade(WOOD, 0.84));
  b.kit('item.wharf.wellWindlass', 1, y);
};

/** 渡资牌：木牌 + 双斜撑 + 顶盖 + 三行墨书 + 朱印（木书，「渡资五文」） */
// 渡资牌：C-ITM-0388
export const ferrySign: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.62 * s, 0.78 * s, 0.05 * s, x, y + 0.86 * s, z, shade(WOOD, 1.02));
  b.box('wood', 0.7 * s, 0.06 * s, 0.12 * s, x, y + 1.28 * s, z, OILWOOD);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.06 * s, 1.1 * s, 0.06 * s, x + sx * 0.22 * s, y + 0.55 * s, z - 0.1 * s, OILWOOD, 0, 0.18);
    b.box('wood', 0.2 * s, 0.05 * s, 0.3 * s, x + sx * 0.22 * s, y + 0.025 * s, z - 0.1 * s, OILWOOD);
  }
  for (let i = 0; i < 3; i++) b.box('lacquer', 0.34 * s, 0.06 * s, 0.01 * s, x, y + (1.1 - i * 0.2) * s, z + 0.028 * s, INK);
  b.box('lacquer', 0.07 * s, 0.07 * s, 0.01 * s, x + 0.2 * s, y + 1.1 * s, z + 0.03 * s, SEALRED);
  b.kit('item.wharf.ferrySign', 1, y);
};

/** 拴马桩：石桩 + 桩头刻纹 + 石座 + 铁环 + 桩身磨痕（石，骑乘寄拴） */
// 拴马桩：C-ITM-0232
export const horsePost: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 0.32 * s, 0.12 * s, 0.32 * s, x, y + 0.06 * s, z, shade(BLUESTONE, 0.92));
  b.cyl('ash', 0.11 * s, 0.14 * s, 1.0 * s, 8, x, y + 0.62 * s, z, BLUESTONE);
  b.box('ash', 0.2 * s, 0.16 * s, 0.2 * s, x, y + 1.2 * s, z, shade(BLUESTONE, 1.12));
  b.box('ash', 0.24 * s, 0.05 * s, 0.24 * s, x, y + 1.3 * s, z, shade(BLUESTONE, 1.18));
  b.cyl('metal', 0.07 * s, 0.07 * s, 0.03 * s, 8, x + 0.14 * s, y + 0.94 * s, z, shade(IRONBLK, 1.2), 0, Math.PI / 2, 0, true);
  b.box('metal', 0.06 * s, 0.06 * s, 0.1 * s, x + 0.1 * s, y + 0.94 * s, z, IRONBLK);
  for (let i = 0; i < 3; i++) b.box('ash', 0.02 * s, 0.06 * s, 0.01 * s, x, y + (0.86 - i * 0.2) * s, z + 0.13 * s, BONEWH);
  b.kit('item.wharf.horsePost', 1, y);
};

/** 古籍函套：十二只纸函三层码放 + 四枚函签 + 双木夹板（纸函，经史子集） */
// 古籍函套：C-ITM-0426
export const bookCase: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.06 * s, 0.9 * s, 0.5 * s, x + sx * 0.31 * s, y + 0.45 * s, z, OILWOOD);
  b.box('wood', 0.68 * s, 0.05 * s, 0.52 * s, x, y + 0.025 * s, z, OILWOOD);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
    b.box('fabric', 0.14 * s, 0.24 * s, 0.34 * s, x - 0.21 * s + i * 0.14 * s, y + (0.17 + row * 0.26) * s, z, row % 2 ? 0xc8b98a : 0xd8cbb0, 0, 0, (i - 1.5) * 0.02);
  }
  for (let i = 0; i < 4; i++) b.box('fabric', 0.05 * s, 0.08 * s, 0.01 * s, x - 0.21 * s + i * 0.14 * s, y + 0.29 * s, z + 0.175 * s, SEALRED);
  b.kit('item.doc.bookCase', 1, y);
};

/** 竹石花台：砖砌花台 + 台沿石 + 三块湖石 + 三竿修竹 + 竹叶（砖竹，院隅观景） */
// 竹石花台：C-ITM-0430
export const bambooPlanter: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 0.86 * s, 0.5 * s, 0.66 * s, x, y + 0.25 * s, z, BRICK2);
  b.box('ash', 0.94 * s, 0.08 * s, 0.74 * s, x, y + 0.54 * s, z, shade(BLUESTONE, 1.04));
  b.box('earth', 0.74 * s, 0.04 * s, 0.56 * s, x, y + 0.58 * s, z, 0x4a3a2a);
  for (const [ox, oy, w, h] of [[-0.2, 0.06, 0.3, 0.34], [0.02, 0.1, 0.24, 0.26], [0.22, 0.14, 0.2, 0.2]] as const) {
    b.box('ash', w * s, h * s, w * s, x + ox * s, y + (0.58 + oy + h * 0.5) * s, z + 0.06 * s, shade(BLUESTONE, 1.16), ox * 0.6, ox * 0.4);
  }
  for (let i = 0; i < 3; i++) {
    const px = x - 0.24 * s + i * 0.18 * s;
    b.cyl('wood', 0.028 * s, 0.034 * s, 0.9 * s, 6, px, y + 1.02 * s, z - 0.1 * s, shade(0x8a9a4a, 0.92 + i * 0.06), 0, 0, (i - 1) * 0.06);
    for (const sy of [1.24, 1.42]) b.box('leaf', 0.2 * s, 0.03 * s, 0.09 * s, px + 0.1 * s, y + sy * s, z - 0.1 * s, 0x3e6e48, (i - 1) * 0.5, 0, 0.3);
  }
  b.box('leaf', 0.16 * s, 0.02 * s, 0.06 * s, x, y + 1.52 * s, z - 0.1 * s, 0x4a8b6f, 0.6);
  b.kit('item.court.bambooPlanter', 1, y);
};

/** 护院哨棒：两支白蜡杆斜立 + 缠绳握把 + 铁箍 + 木托座（木，门后立棒） */
// 护院哨棒：C-ITM-0440
export const guardClub: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.4 * s, 0.08 * s, 0.24 * s, x, y + 0.04 * s, z, OILWOOD);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.14 * s, 0.06 * s, 0.24 * s, x + sx * 0.16 * s, y + 0.11 * s, z, shade(OILWOOD, 1.15));
    b.cyl('wood', 0.035 * s, 0.045 * s, 1.5 * s, 6, x + sx * 0.16 * s, y + 0.82 * s, z + 0.02 * s, shade(0xb89b5a, 1.05), 0, 0, sx * 0.06);
    b.cyl('fabric', 0.048 * s, 0.048 * s, 0.24 * s, 6, x + sx * 0.16 * s, y + 0.42 * s, z + 0.01 * s, HEMP);
    b.cyl('metal', 0.052 * s, 0.052 * s, 0.03 * s, 6, x + sx * 0.16 * s, y + 1.5 * s, z + 0.04 * s, IRONBLK);
  }
  b.kit('item.court.guardClub', 1, y);
};

/** 衣箱：木箱 0.66×0.34 + 箱盖 + 四箱脚 + 双铜扣提环 + 锁面（木，床尾存取） */
// 木箱：C-ITM-0448
export const clothesChest: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.07 * s, 0.1 * s, 0.07 * s, x + sx * 0.29 * s, y + 0.05 * s, z + sz * 0.15 * s, WOOD_D);
  b.box('wood', 0.66 * s, 0.34 * s, 0.4 * s, x, y + 0.27 * s, z, OILWOOD);
  b.box('wood', 0.7 * s, 0.06 * s, 0.44 * s, x, y + 0.47 * s, z, shade(OILWOOD, 1.18));
  b.box('wood', 0.66 * s, 0.05 * s, 0.4 * s, x, y + 0.39 * s, z, shade(OILWOOD, 0.86));
  for (const sx of [-1, 1]) {
    b.box('metal', 0.05 * s, 0.12 * s, 0.02 * s, x + sx * 0.22 * s, y + 0.44 * s, z + 0.21 * s, GILTCU);
    b.cyl('metal', 0.04 * s, 0.04 * s, 0.02 * s, 6, x + sx * 0.2 * s, y + 0.48 * s, z + 0.22 * s, shade(GILTCU, 0.9), 0, Math.PI / 2, 0, true);
  }
  b.box('metal', 0.1 * s, 0.1 * s, 0.02 * s, x, y + 0.44 * s, z + 0.21 * s, shade(IRONBLK, 1.2));
  b.box('lacquer', 0.02 * s, 0.16 * s, 0.02 * s, x, y + 0.3 * s, z + 0.21 * s, 0x2b2b2b);
  b.kit('item.court.clothesChest', 1, y);
};

/** 杂棚农具：木架双柱双档 + 两锄 + 两帚 + 簸箕（竹铁，院隅农具） */
// 杂棚农具：C-ITM-0449
export const toolRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 1.5 * s, 0.08 * s, x + sx * 0.5 * s, y + 0.75 * s, z, OILWOOD);
  for (const sy of [0.5, 1.34]) b.box('wood', 1.08 * s, 0.06 * s, 0.06 * s, x, y + sy * s, z, OILWOOD);
  for (const sx of [-1, 1]) {
    b.cyl('wood', 0.025 * s, 0.03 * s, 1.2 * s, 6, x + sx * 0.34 * s, y + 0.62 * s, z + 0.06 * s, shade(WOOD, 1.02), 0, 0, sx * 0.04);
    b.box('metal', 0.16 * s, 0.22 * s, 0.02 * s, x + sx * 0.34 * s, y + 0.14 * s, z + 0.1 * s, shade(IRONBLK, 1.2), 0, 0, sx * 0.2);
    b.cyl('wood', 0.022 * s, 0.026 * s, 1.0 * s, 6, x + sx * 0.12 * s, y + 0.62 * s, z - 0.08 * s, BAMBOO2, 0, 0, sx * 0.05);
    b.box('fabric', 0.16 * s, 0.28 * s, 0.06 * s, x + sx * 0.12 * s, y + 0.16 * s, z - 0.08 * s, 0xb89b46, 0, 0, sx * 0.1);
  }
  b.box('wood', 0.24 * s, 0.06 * s, 0.2 * s, x + 0.56 * s, y + 0.58 * s, z, BAMBOO_L);
  b.box('fabric', 0.3 * s, 0.02 * s, 0.3 * s, x - 0.56 * s, y + 0.06 * s, z, 0xb89b46, 0.3);
  b.kit('item.court.toolRack', 1, y);
};

/** 草席：卷席 + 展开席面 + 三道编织线 + 麻绳 + 双席边（草，铺盖） */
// 草席：C-ITM-0463
export const strawMat: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('fabric', 0.72 * s, 0.012 * s, 0.52 * s, x, y + 0.006 * s, z, 0xc8b98a);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.72 * s, 0.004 * s, 0.014 * s, x, y + 0.014 * s, z - 0.18 * s + i * 0.18 * s, 0xa89a6a);
  for (const sz of [-1, 1]) b.box('fabric', 0.72 * s, 0.02 * s, 0.03 * s, x, y + 0.01 * s, z + sz * 0.25 * s, shade(0xc8b98a, 0.82));
  b.cyl('fabric', 0.09 * s, 0.09 * s, 0.64 * s, 8, x, y + 0.11 * s, z + 0.3 * s, shade(0xc8b98a, 1.06), 0, 0, Math.PI / 2);
  b.cyl('fabric', 0.092 * s, 0.092 * s, 0.03 * s, 8, x, y + 0.11 * s, z + 0.3 * s, HEMP, 0, 0, Math.PI / 2, true);
  b.box('fabric', 0.02 * s, 0.01 * s, 0.3 * s, x - 0.3 * s, y + 0.02 * s, z - 0.1 * s, HEMP);
  b.kit('item.court.strawMat', 1, y);
};

/** 晾衣杆：双竹立柱 + 横杆 + 两道绑绳 + 三件晾布（竹，院中晾晒） */
// 晾衣杆：C-ITM-0468
export const clothesPole: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.cyl('wood', 0.04 * s, 0.055 * s, 1.9 * s, 6, x + sx * 0.45 * s, y + 0.95 * s, z, BAMBOO, 0, 0, sx * 0.03);
    b.cyl('wood', 0.08 * s, 0.08 * s, 0.12 * s, 6, x + sx * 0.45 * s, y + 0.06 * s, z, shade(BAMBOO, 0.84));
    b.box('fabric', 0.02 * s, 0.14 * s, 0.02 * s, x + sx * 0.45 * s, y + 1.86 * s, z, HEMP);
  }
  b.cyl('wood', 0.035 * s, 0.035 * s, 1.0 * s, 6, x, y + 1.9 * s, z, shade(BAMBOO_L, 1.02), 0, 0, Math.PI / 2);
  for (const [ox, w, h, col] of [[-0.28, 0.3, 0.6, 0xd8cbb0], [0.02, 0.26, 0.46, 0x8fa8b8], [0.3, 0.24, 0.52, 0xc8b98a]] as const) {
    b.box('fabric', w * s, h * s, 0.02 * s, x + ox * s, y + (1.88 - h * 0.5) * s, z, col);
  }
  b.kit('item.court.clothesPole', 1, y);
};

/** 鸡笼：竹笼底架 + 四柱 + 五根竹条三横条 + 笼顶 + 笼门 + 两只家鸡（竹，院隅） */
// 鸡笼：C-ITM-0470
export const chickenCoop: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.9 * s, 0.06 * s, 0.56 * s, x, y + 0.03 * s, z, shade(WOOD, 0.92));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.06 * s, 0.62 * s, 0.06 * s, x + sx * 0.4 * s, y + 0.37 * s, z + sz * 0.24 * s, OILWOOD);
  for (let i = 0; i < 5; i++) b.box('wood', 0.03 * s, 0.56 * s, 0.03 * s, x - 0.32 * s + i * 0.16 * s, y + 0.36 * s, z + 0.26 * s, BAMBOO);
  for (let i = 0; i < 3; i++) b.box('wood', 0.82 * s, 0.03 * s, 0.03 * s, x, y + (0.6 + i * 0.06) * s, z - 0.18 * s + i * 0.18 * s, BAMBOO_L);
  b.box('wood', 0.3 * s, 0.3 * s, 0.04 * s, x + 0.16 * s, y + 0.2 * s, z + 0.28 * s, shade(BAMBOO, 0.86), 0.2);
  for (const [ox, col] of [[-0.2, 0xe8e3d5], [0.16, 0xb8734a]] as const) {
    b.box('fabric', 0.16 * s, 0.14 * s, 0.12 * s, x + ox * s, y + 0.13 * s, z, col);
    b.box('fabric', 0.08 * s, 0.1 * s, 0.08 * s, x + ox * s + 0.1 * s, y + 0.2 * s, z, col);
    b.box('fabric', 0.02 * s, 0.04 * s, 0.03 * s, x + ox * s + 0.13 * s, y + 0.26 * s, z, 0xc0392b);
  }
  b.kit('item.court.chickenCoop', 1, y);
};

/** 陶坐墩：两只鼓形陶墩 + 双道鼓钉圈 + 顶面（陶，纳凉就座） */
// 坐墩：C-ITM-0471
export const ceramicStool: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const ox of [-0.5, 0.5]) {
    const px = x + ox * s;
    b.cyl('ceramic', 0.19 * s, 0.17 * s, 0.42 * s, 10, px, y + 0.21 * s, z, GRAYCERAMIC);
    b.cyl('ceramic', 0.2 * s, 0.2 * s, 0.04 * s, 10, px, y + 0.44 * s, z, shade(GRAYCERAMIC, 1.14));
    for (const sy of [0.12, 0.3]) b.cyl('ceramic', 0.193 * s, 0.185 * s, 0.02 * s, 10, px, y + sy * s, z, shade(GRAYCERAMIC, 0.86), 0, 0, 0, true);
  }
  b.kit('item.court.ceramicStool', 2, y);
};

/** 石狮：石座 + 蹲踞狮身 + 头与鬃 + 双目前爪 + 尾，双狮分列 5.24m（石，门口蹲踞） */
// 石狮：C-ITM-0403
export const stoneLion: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const ox of [-2.62, 2.62]) {
    const px = x + ox * s;
    b.box('ash', 0.52 * s, 0.16 * s, 0.46 * s, px, y + 0.08 * s, z, shade(BLUESTONE, 0.88));
    b.box('ash', 0.34 * s, 0.4 * s, 0.34 * s, px, y + 0.36 * s, z - 0.02 * s, BLUESTONE);
    b.box('ash', 0.3 * s, 0.24 * s, 0.28 * s, px, y + 0.62 * s, z - 0.06 * s, shade(BLUESTONE, 1.1));
    b.box('ash', 0.28 * s, 0.24 * s, 0.26 * s, px, y + 0.8 * s, z - 0.04 * s, shade(BLUESTONE, 1.16));
    b.box('ash', 0.06 * s, 0.1 * s, 0.16 * s, px, y + 0.92 * s, z - 0.08 * s, shade(BLUESTONE, 1.02));
    for (const sx2 of [-1, 1]) {
      b.box('ash', 0.09 * s, 0.26 * s, 0.1 * s, px + sx2 * 0.12 * s, y + 0.24 * s, z + 0.14 * s, shade(BLUESTONE, 1.04));
      b.box('ash', 0.04 * s, 0.05 * s, 0.03 * s, px + sx2 * 0.08 * s, y + 0.79 * s, z + 0.09 * s, BONEWH);
    }
    b.box('ash', 0.1 * s, 0.3 * s, 0.1 * s, px, y + 0.34 * s, z - 0.22 * s, shade(BLUESTONE, 0.94), 0.2);
  }
  b.kit('item.court.stoneLion', 2, y);
};

/** 舍利函：石函 + 石盖 + 双层金缠枝带 + 铜锁扣 + 黄绸内衬 + 须弥座（金石石函，塔顶密藏） */
// 舍利函：C-ITM-0207
export const relicCasket: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 0.54 * s, 0.12 * s, 0.42 * s, x, y + 0.06 * s, z, shade(MINGSTONE, 1.06));
  b.box('ash', 0.46 * s, 0.34 * s, 0.34 * s, x, y + 0.29 * s, z, MINGSTONE);
  b.box('ash', 0.5 * s, 0.08 * s, 0.38 * s, x, y + 0.5 * s, z, shade(MINGSTONE, 1.16));
  b.box('ash', 0.36 * s, 0.08 * s, 0.28 * s, x, y + 0.56 * s, z, shade(MINGSTONE, 1.22));
  b.box('fabric', 0.34 * s, 0.03 * s, 0.24 * s, x, y + 0.47 * s, z, 0xd4b76a);
  for (const sy of [0.2, 0.38]) b.box('metal', 0.48 * s, 0.03 * s, 0.36 * s, x, y + sy * s, z, GILTCU);
  for (const sz of [-1, 1]) b.box('metal', 0.06 * s, 0.12 * s, 0.05 * s, x, y + 0.42 * s, z + sz * 0.17 * s, GILT);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', 0.05 * s, 0.36 * s, 0.05 * s, x + sx * 0.2 * s, y + 0.22 * s, z + sz * 0.15 * s, shade(GILTCU, 0.92));
  b.kit('item.relic.casket', 1, y);
};

/** 白胜酒担：竹扁担 + 双绳 + 两粗陶酒瓮封泥红布 + 木托圈（竹木，挑酒担子 五文） */
// 白胜酒担：C-ITM-0309
export const wineCarryPole: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.035 * s, 0.04 * s, 1.4 * s, 6, x, y + 1.04 * s, z, BAMBOO, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    b.box('fabric', 0.02 * s, 0.3 * s, 0.02 * s, x + sx * 0.46 * s, y + 0.88 * s, z, HEMP);
    b.cyl('ceramic', 0.15 * s, 0.19 * s, 0.34 * s, 6, x + sx * 0.46 * s, y + 0.54 * s, z, shade(TEAKD, 0.96 + (sx > 0 ? 0.08 : 0)));
    b.cyl('wood', 0.17 * s, 0.15 * s, 0.05 * s, 6, x + sx * 0.46 * s, y + 0.72 * s, z, shade(OILWOOD, 1.1));
    b.cyl('ceramic', 0.2 * s, 0.2 * s, 0.05 * s, 6, x + sx * 0.46 * s, y + 0.77 * s, z, SEALRED);
    b.cyl('ceramic', 0.11 * s, 0.17 * s, 0.06 * s, 6, x + sx * 0.46 * s, y + 0.81 * s, z, shade(SEALRED, 1.15));
  }
  b.kit('item.shop.wineCarryPole', 1, y);
};

export const BATCH5_BUILDERS: Record<string, ItemBuilder> = {
  wineCounter, steamerStack, teaWineCarry, eaveFruitBasket,
  paperVilla, spiritCoinString,
  pulsePillow, balanceScale, beastLock, windowGrille, beamScale,
  shoeLast, awlBasket, tailorRule, tailorShears,
  privateBooth, stageCurtain, arenaRail, puppetStage, shadowScreen, sandRing, brassGong,
  mooringPost, sackStack, persianRug, guildBoard, wellWindlass, ferrySign,
  horsePost, bookCase, bambooPlanter, guardClub, clothesChest, toolRack, strawMat, clothesPole,
  chickenCoop, ceramicStool, stoneLion, relicCasket, wineCarryPole,
};

const BATCH5_TABLE: [RegExp, string][] = [
  [/酒垆/, 'wineCounter'],
  [/蒸笼塔/, 'steamerStack'],
  [/茶酒担/, 'teaWineCarry'],
  [/檐前果篮/, 'eaveFruitBasket'],
  [/纸扎楼库/, 'paperVilla'],
  [/冥钱串/, 'spiritCoinString'],
  [/脉枕/, 'pulsePillow'],
  [/天平/, 'balanceScale'],
  [/铜锁/, 'beastLock'],
  [/铁栅/, 'windowGrille'],
  [/官秤/, 'beamScale'],
  [/楦头/, 'shoeLast'],
  [/锥线筐/, 'awlBasket'],
  [/裁尺/, 'tailorRule'],
  [/裁剪/, 'tailorShears'],
  [/雅间阁子/, 'privateBooth'],
  [/台幔/, 'stageCurtain'],
  [/马廊栏杆/, 'arenaRail'],
  [/傀儡棚/, 'puppetStage'],
  [/影戏亮子/, 'shadowScreen'],
  [/相扑沙圈/, 'sandRing'],
  [/铜锣/, 'brassGong'],
  [/系船桩/, 'mooringPost'],
  [/麻袋垛/, 'sackStack'],
  [/波斯毯/, 'persianRug'],
  [/牙帖公示榜/, 'guildBoard'],
  [/水井辘轳/, 'wellWindlass'],
  [/渡资牌/, 'ferrySign'],
  [/拴马桩/, 'horsePost'],
  [/古籍函套/, 'bookCase'],
  [/竹石花台/, 'bambooPlanter'],
  [/护院哨棒/, 'guardClub'],
  [/衣箱|木箱/, 'clothesChest'],
  [/杂棚农具/, 'toolRack'],
  [/草席/, 'strawMat'],
  [/晾衣杆/, 'clothesPole'],
  [/鸡笼/, 'chickenCoop'],
  [/坐墩/, 'ceramicStool'],
  [/石狮/, 'stoneLion'],
  [/舍利函/, 'relicCasket'],
  [/白胜酒担|酒担/, 'wineCarryPole'],
];

// ---------- 六批商货物件（40 式 / 42 台账条目）----------
// 逐件按 20 卷「材质 / 形制 / 位置」起形，尺寸按卷内「高 / 长」标称值换算：
// 灶台 0.6–1.1m、货架 1.6–1.9m、棚架 1.9–2.2m、吊臂 3.0m、牌楼 3.9m；碑碣 1.5–1.7m。
// 材质组沿用 14 组：砖砌入 wall、石作入 ash、夯土草料入 earth / leaf、纸席织物入 fabric、
// 陶瓷入 ceramic、铜铁入 metal、漆入 lacquer。单件 ≤260 面，draw call 0 增，kit 逐件可统计。
const B6CLAY = 0xa8653c;    // 粗陶（陶灶 / 陶太平缸）
const B6HAY = 0xc2a45c;     // 干草 / 粮面
const B6ICE = 0xd6e2e4;     // 碎冰（鱼摊保鲜）
const B6CANVAS = 0xd8cbb0;  // 席布 / 棚顶

/** 小土灶：单眼砖土灶身 0.7×0.5 + 石灶面 + 铁锅陶罐 + 灶口火光（砖土，简灶） */
// 小土灶：C-ITM-0429
export const smallClayStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 0.7 * s, 0.5 * s, 0.6 * s, x, y + 0.25 * s, z, BRICK2);
  b.box('ash', 0.76 * s, 0.06 * s, 0.66 * s, x, y + 0.53 * s, z, shade(BLUESTONE, 0.96));
  b.cyl('metal', 0.18 * s, 0.16 * s, 0.14 * s, 8, x - 0.16 * s, y + 0.62 * s, z, IRONBLK, 0, 0, 0, true);
  b.cyl('ceramic', 0.17 * s, 0.13 * s, 0.12 * s, 8, x + 0.18 * s, y + 0.61 * s, z, B6CLAY);
  b.box('glow', 0.24 * s, 0.16 * s, 0.04 * s, x, y + 0.24 * s, z + 0.3 * s, 0xff7f50);
  b.cyl('wall', 0.08 * s, 0.1 * s, 0.5 * s, 6, x - 0.28 * s, y + 0.78 * s, z - 0.2 * s, shade(BRICK2, 0.9));
  b.box('wood', 0.3 * s, 0.06 * s, 0.24 * s, x + 0.34 * s, y + 0.6 * s, z + 0.16 * s, shade(WOOD, 0.96));
  b.kit('item.court.smallClayStove', 1, y);
};

/** 厨房土灶：1.4m 砖砌灶台 + 石台面 + 双陶锅 + 双灶口火光 + 砖砌烟道与铁烟帽（砖土，后厨灶具） */
// 厨房土灶：C-ITM-0420
export const kitchenClayStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 1.4 * s, 0.8 * s, 0.8 * s, x, y + 0.4 * s, z, shade(BRICK2, 0.96));
  b.box('ash', 1.5 * s, 0.08 * s, 0.9 * s, x, y + 0.84 * s, z, shade(BLUESTONE, 1.0));
  for (const sx of [-1, 1]) {
    b.cyl('ceramic', 0.24 * s, 0.2 * s, 0.16 * s, 8, x + sx * 0.34 * s, y + 0.96 * s, z, B6CLAY);
    b.box('glow', 0.22 * s, 0.14 * s, 0.04 * s, x + sx * 0.34 * s, y + 0.36 * s, z + 0.42 * s, 0xff7f50);
  }
  b.box('wall', 0.28 * s, 1.1 * s, 0.28 * s, x - 0.58 * s, y + 1.35 * s, z - 0.24 * s, shade(BRICK2, 0.86));
  b.cyl('metal', 0.16 * s, 0.16 * s, 0.1 * s, 8, x - 0.58 * s, y + 1.92 * s, z - 0.24 * s, IRONBLK, 0, 0, 0, true);
  b.box('wood', 0.3 * s, 0.04 * s, 0.24 * s, x + 0.62 * s, y + 0.9 * s, z - 0.3 * s, shade(WOOD, 1.02));
  b.kit('item.court.kitchenClayStove', 1, y);
};

/** 土灶：双眼砖灶 1.2×0.72 + 双铁锅 + 汤罐 + 灶沿木托板（砖土，双眼灶） */
// 土灶：C-ITM-0445
export const twinClayStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 1.2 * s, 0.66 * s, 0.72 * s, x, y + 0.33 * s, z, shade(BRICK2, 1.04));
  b.box('ash', 1.26 * s, 0.06 * s, 0.78 * s, x, y + 0.69 * s, z, shade(BRICK2, 0.9));
  for (const sx of [-1, 1]) {
    b.cyl('metal', 0.22 * s, 0.2 * s, 0.12 * s, 10, x + sx * 0.3 * s, y + 0.78 * s, z, IRONBLK, 0, 0, 0, true);
    b.box('glow', 0.18 * s, 0.12 * s, 0.03 * s, x + sx * 0.3 * s, y + 0.28 * s, z + 0.37 * s, 0xff7f50);
  }
  b.cyl('ceramic', 0.1 * s, 0.1 * s, 0.22 * s, 6, x, y + 0.8 * s, z - 0.28 * s, shade(B6CLAY, 0.94));
  b.box('wood', 0.7 * s, 0.06 * s, 0.28 * s, x, y + 0.72 * s, z + 0.5 * s, shade(WOOD, 1.0));
  b.kit('item.court.twinClayStove', 1, y);
};

/** 共灶棚：竹柱四立 + 三坡席顶 + 砖砌大灶 + 铁锅 + 灶口火光 + 三捆柴（竹砖，轮用大灶） */
// 共灶棚：C-ITM-0467
export const sharedStoveShed: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.09 * s, 2.1 * s, 0.09 * s, x + sx * 0.95 * s, y + 1.05 * s, z + sz * 0.7 * s, BAMBOO);
  b.box('wood', 2.0 * s, 0.08 * s, 0.08 * s, x, y + 2.1 * s, z - 0.7 * s, BAMBOO_L);
  for (let i = 0; i < 3; i++) b.box('fabric', 2.05 * s, 0.04 * s, 0.55 * s, x, y + (2.16 - i * 0.07) * s, z + (-0.45 + i * 0.45) * s, shade(B6CANVAS, 0.9 + i * 0.06), 0, 0.1);
  b.box('wall', 1.1 * s, 0.7 * s, 0.7 * s, x - 0.24 * s, y + 0.35 * s, z + 0.1 * s, BRICK2);
  b.cyl('metal', 0.24 * s, 0.22 * s, 0.14 * s, 8, x - 0.24 * s, y + 0.76 * s, z + 0.1 * s, IRONBLK, 0, 0, 0, true);
  b.box('glow', 0.2 * s, 0.12 * s, 0.03 * s, x - 0.24 * s, y + 0.3 * s, z + 0.46 * s, 0xff7f50);
  for (let i = 0; i < 3; i++) b.cyl('wood', 0.06 * s, 0.06 * s, 0.7 * s, 6, x + 0.72 * s, y + (0.09 + i * 0.11) * s, z - 0.3 * s, shade(WOOD, 0.92), 0, 0, Math.PI / 2);
  b.kit('item.court.sharedStoveShed', 1, y);
};

/** 陶灶：粗陶鼓腹灶 0.34-0.4 径 + 陶口沿 + 铁锅 + 陶烟囱 + 灶前灰堆（粗陶，门口小灶） */
// 陶灶：C-ITM-0461
export const eaveClayStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.34 * s, 0.4 * s, 0.52 * s, 8, x, y + 0.26 * s, z, B6CLAY);
  b.cyl('ceramic', 0.36 * s, 0.34 * s, 0.06 * s, 8, x, y + 0.55 * s, z, shade(B6CLAY, 1.12));
  b.cyl('metal', 0.2 * s, 0.2 * s, 0.04 * s, 8, x, y + 0.58 * s, z, IRONBLK, 0, 0, 0, true);
  b.cyl('metal', 0.18 * s, 0.15 * s, 0.14 * s, 8, x, y + 0.66 * s, z, shade(IRONBLK, 1.2), 0, 0, 0, true);
  b.box('glow', 0.22 * s, 0.14 * s, 0.05 * s, x, y + 0.24 * s, z + 0.36 * s, 0xff7f50);
  b.cyl('ceramic', 0.09 * s, 0.07 * s, 0.5 * s, 6, x - 0.24 * s, y + 0.75 * s, z - 0.16 * s, shade(B6CLAY, 0.88));
  b.box('ceramic', 0.1 * s, 0.05 * s, 0.1 * s, x - 0.24 * s, y + 1.0 * s, z - 0.16 * s, shade(B6CLAY, 0.8));
  b.box('ash', 0.24 * s, 0.04 * s, 0.24 * s, x + 0.3 * s, y + 0.03 * s, z + 0.26 * s, SANDC);
  b.kit('item.shop.eaveClayStove', 1, y);
};

/** 雪地火塘：石圈 1.2m + 灰膛 + 五根铁架条 + 四块炭火 + 铁吊杆吊壶（石铁，廊下暖炉） */
// 雪地火塘：C-ITM-0356
export const snowFirePit: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ash', 0.6 * s, 0.66 * s, 0.22 * s, 10, x, y + 0.11 * s, z, shade(BLUESTONE, 0.88), 0, 0, 0, true);
  b.cyl('earth', 0.5 * s, 0.5 * s, 0.06 * s, 8, x, y + 0.1 * s, z, 0x2b2622);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box('metal', 0.4 * s, 0.03 * s, 0.03 * s, x + Math.cos(a) * 0.24 * s, y + 0.16 * s, z + Math.sin(a) * 0.24 * s, IRONBLK, -a);
  }
  for (let i = 0; i < 4; i++) b.box('glow', 0.16 * s, 0.06 * s, 0.14 * s, x + (i % 2 ? 0.14 : -0.14) * s, y + 0.14 * s, z + (i < 2 ? -0.12 : 0.14) * s, 0xff6a3a);
  b.box('metal', 0.03 * s, 0.55 * s, 0.03 * s, x, y + 0.5 * s, z - 0.3 * s, IRONBLK, 0, 0, -0.15);
  b.cyl('metal', 0.15 * s, 0.13 * s, 0.2 * s, 8, x, y + 0.72 * s, z - 0.38 * s, shade(IRONBLK, 1.2));
  b.cyl('metal', 0.1 * s, 0.1 * s, 0.02 * s, 8, x, y + 0.83 * s, z - 0.38 * s, shade(IRONBLK, 1.35));
  b.kit('item.court.snowFirePit', 1, y);
};

/** 官斛官尺：木斛 0.62×0.4 + 铜包角四枚 + 铜箍 + 铜官尺 0.9m 刻度七道 + 朱印告示牌（木铜，量制标准） */
// 官斛官尺：C-ITM-0226
export const officialMeasure: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.62 * s, 0.4 * s, 0.5 * s, x, y + 0.2 * s, z, shade(WOOD, 0.98));
  b.box('wood', 0.66 * s, 0.05 * s, 0.54 * s, x, y + 0.44 * s, z, shade(WOOD, 1.14));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', 0.05 * s, 0.4 * s, 0.05 * s, x + sx * 0.3 * s, y + 0.2 * s, z + sz * 0.24 * s, GILTCU);
  b.box('metal', 0.66 * s, 0.02 * s, 0.05 * s, x, y + 0.3 * s, z + 0.245 * s, shade(GILTCU, 0.9));
  b.box('wood', 0.9 * s, 0.035 * s, 0.07 * s, x, y + 0.49 * s, z - 0.02 * s, shade(WOOD, 1.1));
  for (let i = 0; i < 7; i++) b.box('lacquer', 0.02 * s, 0.01 * s, 0.05 * s, x - 0.4 * s + i * 0.13 * s, y + 0.51 * s, z - 0.02 * s, INK);
  b.box('lacquer', 0.1 * s, 0.12 * s, 0.02 * s, x, y + 0.3 * s, z + 0.26 * s, 0x2b2b2b);
  b.kit('item.market.officialMeasure', 1, y);
};

/** 官斛：方口木斛 0.8×0.5 + 铁包角四枚 + 双铁耳 + 粮面 + 铜箍 + 刮尺（木铁包角，标准量器） */
// 官斛：C-ITM-0391
export const officialHu: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.8 * s, 0.5 * s, 0.8 * s, x, y + 0.25 * s, z, shade(WOOD, 0.96));
  b.box('wood', 0.86 * s, 0.06 * s, 0.86 * s, x, y + 0.53 * s, z, shade(WOOD, 1.12));
  b.box('metal', 0.7 * s, 0.02 * s, 0.7 * s, x, y + 0.5 * s, z, 0x8a7a5a);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', 0.08 * s, 0.52 * s, 0.08 * s, x + sx * 0.4 * s, y + 0.25 * s, z + sz * 0.4 * s, IRONBLK);
  for (const sx of [-1, 1]) b.box('metal', 0.1 * s, 0.05 * s, 0.12 * s, x + sx * 0.46 * s, y + 0.42 * s, z, shade(IRONBLK, 1.2));
  b.box('wood', 0.3 * s, 0.03 * s, 0.08 * s, x, y + 0.58 * s, z + 0.3 * s, shade(WOOD, 1.06));
  b.kit('item.market.officialHu', 1, y);
};

/** 斗斛：木斗 0.54×0.36 + 铁包角四枚 + 口沿铜条 + 米面 + 提手 + 刮板（木铁包角，量器） */
// 斗斛：C-ITM-0397
export const grainDou: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.54 * s, 0.36 * s, 0.44 * s, x, y + 0.2 * s, z, shade(WOOD, 0.96));
  b.box('wood', 0.58 * s, 0.05 * s, 0.48 * s, x, y + 0.4 * s, z, shade(WOOD, 1.12));
  b.box('wood', 0.48 * s, 0.02 * s, 0.38 * s, x, y + 0.34 * s, z, shade(B6HAY, 0.94));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', 0.06 * s, 0.34 * s, 0.06 * s, x + sx * 0.26 * s, y + 0.19 * s, z + sz * 0.21 * s, shade(IRONBLK, 1.1));
  b.box('metal', 0.04 * s, 0.03 * s, 0.44 * s, x - 0.28 * s, y + 0.39 * s, z, GILTCU);
  b.box('wood', 0.1 * s, 0.05 * s, 0.06 * s, x + 0.3 * s, y + 0.27 * s, z, WOOD_D);
  b.box('wood', 0.4 * s, 0.03 * s, 0.05 * s, x + 0.06 * s, y + 0.05 * s, z + 0.28 * s, shade(WOOD, 1.06));
  b.kit('item.market.grainDou', 1, y);
};

/** 碑碣：三通历代祭碑，碑座 + 碑身 + 碑帽 + 亮面碑心，高 1.5-1.72m（石，历代祭碑） */
// 碑碣：C-ITM-0342
export const stoneStelae: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) {
    const px = x - 0.6 * s + i * 0.6 * s, h = (1.5 + (i % 2) * 0.22) * s;
    b.box('ash', 0.46 * s, 0.14 * s, 0.3 * s, px, y + 0.07 * s, z, shade(BLUESTONE, 0.86));
    b.box('ash', 0.34 * s, h, 0.14 * s, px, y + 0.14 * s + h / 2, z, BLUESTONE);
    b.box('ash', 0.4 * s, 0.08 * s, 0.2 * s, px, y + 0.18 * s + h, z, shade(BLUESTONE, 0.78));
    b.box('ash', 0.22 * s, 0.5 * s, 0.015 * s, px, y + 0.14 * s + h * 0.62, z + 0.075 * s, shade(BLUESTONE, 1.12));
  }
  b.kit('item.court.stoneStelae', 3, y);
};

/** 功德碑林：四通香客碑并立 + 通长石台 + 碑帽 + 纸拓片，高 1.04m（石，历代香客碑） */
// 功德碑林：C-ITM-0322
export const meritSteleRow: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.9 * s, 0.06 * s, 0.4 * s, x, y + 0.03 * s, z, shade(BLUESTONE, 0.82));
  for (let i = 0; i < 4; i++) {
    const px = x - 0.6 * s + i * 0.4 * s;
    b.box('ash', 0.34 * s, 0.12 * s, 0.26 * s, px, y + 0.12 * s, z, shade(BLUESTONE, 0.9));
    b.box('ash', 0.26 * s, 0.9 * s, 0.1 * s, px, y + 0.63 * s, z, shade(BLUESTONE, 0.96 + i * 0.03));
    b.box('ash', 0.3 * s, 0.06 * s, 0.14 * s, px, y + 1.1 * s, z, shade(BLUESTONE, 0.8));
    b.box('fabric', 0.16 * s, 0.3 * s, 0.012 * s, px, y + 0.68 * s, z + 0.056 * s, 0xd8cbb0);
  }
  b.kit('item.court.meritSteleRow', 4, y);
};

/** 茶水铺：方桌 0.9 + 双长凳 + 铜茶炉与火光 + 瓷壶托碟 + 茶单水牌（木，歇脚茶座） */
// 茶水铺：C-ITM-0231
// 茶水铺：C-ITM-0247
export const teaStallSeat: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.9 * s, 0.07 * s, 0.9 * s, x, y + 0.7 * s, z, shade(WOOD, 1.04));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.08 * s, 0.7 * s, 0.08 * s, x + sx * 0.36 * s, y + 0.35 * s, z + sz * 0.36 * s, OILWOOD);
  for (const sz of [-1, 1]) {
    b.box('wood', 1.0 * s, 0.06 * s, 0.3 * s, x, y + 0.42 * s, z + sz * 0.78 * s, shade(WOOD, 0.96));
    for (const sx of [-1, 1]) b.box('wood', 0.07 * s, 0.42 * s, 0.26 * s, x + sx * 0.4 * s, y + 0.21 * s, z + sz * 0.78 * s, OILWOOD);
  }
  b.cyl('metal', 0.16 * s, 0.14 * s, 0.22 * s, 8, x + 0.28 * s, y + 0.85 * s, z - 0.24 * s, shade(COPPER, 0.95));
  b.box('glow', 0.1 * s, 0.03 * s, 0.1 * s, x + 0.28 * s, y + 0.76 * s, z - 0.24 * s, 0xff7f50);
  b.cyl('ceramic', 0.1 * s, 0.08 * s, 0.12 * s, 8, x - 0.22 * s, y + 0.8 * s, z + 0.2 * s, PORCELAIN);
  b.box('ceramic', 0.16 * s, 0.05 * s, 0.16 * s, x - 0.02 * s, y + 0.76 * s, z - 0.06 * s, shade(PORCELAIN, 0.96));
  b.box('wood', 0.34 * s, 0.5 * s, 0.05 * s, x - 0.66 * s, y + 0.62 * s, z, shade(B6CANVAS, 0.94));
  b.box('wood', 0.06 * s, 0.36 * s, 0.06 * s, x - 0.66 * s, y + 0.18 * s, z - 0.1 * s, OILWOOD);
  b.kit('item.market.teaStallSeat', 1, y);
};

/** 果品行栈：双柱货架 1.7 + 三层板 + 背板 + 五只果筐与时果 + 三包干果（木，行栈门面） */
// 果品行栈：C-ITM-0233
export const fruitShopRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sz of [-1, 1]) b.box('wood', 0.44 * s, 1.7 * s, 0.08 * s, x, y + 0.85 * s, z + sz * 0.5 * s, OILWOOD);
  for (const sy of [0.42, 0.86, 1.3]) b.box('wood', 0.44 * s, 0.06 * s, 1.1 * s, x, y + sy * s, z, shade(WOOD, 1.06));
  b.box('wood', 0.06 * s, 0.5 * s, 1.1 * s, x - 0.2 * s, y + 1.5 * s, z, shade(WOOD, 0.92));
  for (const [oz, sy] of [[-0.34, 0.5], [0.06, 0.5], [0.36, 0.5], [-0.2, 0.94]] as const) {
    b.cyl('wood', 0.15 * s, 0.12 * s, 0.16 * s, 8, x, y + sy * s, z + oz * s, shade(BAMBOO_L, 0.94), 0, 0, 0, true);
    b.box('ceramic', 0.12 * s, 0.1 * s, 0.12 * s, x, y + (sy + 0.09) * s, z + oz * s, oz > 0 ? 0xc08a3a : 0xb8734a);
  }
  for (let i = 0; i < 3; i++) b.box('fabric', 0.2 * s, 0.16 * s, 0.16 * s, x, y + 1.38 * s, z - 0.3 * s + i * 0.28 * s, 0xd8cbb0);
  b.kit('item.shop.fruitShopRack', 1, y);
};

/** 瓷器行栈：双柱双板货架 + 三束草绳捆瓷（叠碗四层）+ 束顶草垫（木，瓷货成捆） */
// 瓷器行栈：C-ITM-0251
export const porcelainShopRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sz of [-1, 1]) b.box('wood', 0.44 * s, 0.9 * s, 0.08 * s, x, y + 0.45 * s, z + sz * 0.56 * s, OILWOOD);
  for (let i = 0; i < 2; i++) b.box('wood', 0.5 * s, 0.05 * s, 1.2 * s, x, y + (0.06 + i * 0.42) * s, z, shade(WOOD, 1.02));
  for (let i = 0; i < 3; i++) {
    const pz = z - 0.36 * s + i * 0.36 * s;
    b.cyl('ceramic', 0.15 * s, 0.13 * s, 0.34 * s, 6, x, y + 0.26 * s, pz, shade(PORCELAIN, 0.96 + i * 0.04));
    for (const sy of [0.18, 0.34]) b.cyl('fabric', 0.155 * s, 0.155 * s, 0.02 * s, 6, x, y + sy * s, pz, HEMP, 0, 0, 0, true);
    b.cyl('ceramic', 0.17 * s, 0.17 * s, 0.03 * s, 6, x, y + 0.44 * s, pz, shade(PORCELAIN, 1.1), 0, 0, 0, true);
  }
  b.kit('item.shop.porcelainShopRack', 1, y);
};

/** 巾帽行栈：双柱架 1.6 + 上层挂架 + 中层板 + 三顶巾帽 + 两叠巾帕 + 三幅挂巾（木，行栈门面） */
// 巾帽行栈：C-ITM-0235
export const capShopRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sz of [-1, 1]) b.box('wood', 0.4 * s, 1.6 * s, 0.07 * s, x, y + 0.8 * s, z + sz * 0.5 * s, OILWOOD);
  b.box('wood', 0.06 * s, 0.06 * s, 1.04 * s, x, y + 1.56 * s, z, WOOD_D);
  b.box('wood', 0.4 * s, 0.06 * s, 1.04 * s, x, y + 0.86 * s, z, shade(WOOD, 1.04));
  for (let i = 0; i < 3; i++) {
    const pz = z - 0.34 * s + i * 0.34 * s;
    b.cyl('fabric', 0.1 * s, 0.11 * s, 0.12 * s, 6, x, y + 1.0 * s, pz, i % 2 ? 0x2b2b2b : 0x3a4a5a);
    b.box('fabric', 0.22 * s, 0.03 * s, 0.2 * s, x, y + 0.94 * s, pz, 0x1e1e1e);
  }
  for (let i = 0; i < 2; i++) b.box('fabric', 0.3 * s, 0.1 * s, 0.26 * s, x, y + 0.94 * s, z - 0.3 * s + i * 0.6 * s, shade(B6CANVAS, 0.92 + i * 0.06));
  for (let i = 0; i < 3; i++) b.box('fabric', 0.03 * s, 0.24 * s, 0.26 * s, x - 0.2 * s, y + 1.24 * s, z - 0.3 * s + i * 0.3 * s, [0x8fa8b8, 0xd8cbb0, 0x9d2933][i]);
  b.kit('item.shop.capShopRack', 1, y);
};

/** 香药行栈：双柱四层药架 1.9 + 四只贴签药匣 + 铜拉手 + 四束香（木，药材香料架） */
// 香药行栈：C-ITM-0234
export const incenseShopRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sz of [-1, 1]) b.box('wood', 0.5 * s, 1.9 * s, 0.06 * s, x, y + 0.95 * s, z + sz * 0.52 * s, OILWOOD);
  for (const sy of [0.3, 0.8, 1.3, 1.78]) b.box('wood', 0.34 * s, 0.05 * s, 1.14 * s, x, y + sy * s, z, shade(WOOD, 1.04));
  for (let i = 0; i < 4; i++) {
    const pz = z - 0.36 * s + (i % 2) * 0.72 * s, sy = 0.42 + Math.floor(i / 2) * 0.5;
    b.box('wood', 0.2 * s, 0.18 * s, 0.16 * s, x, y + sy * s, pz, shade(WOOD, i % 2 ? 1.14 : 0.9));
    b.box('metal', 0.02 * s, 0.02 * s, 0.1 * s, x + 0.11 * s, y + (sy + 0.1) * s, pz, GILTCU);
  }
  for (let i = 0; i < 4; i++) b.cyl('fabric', 0.05 * s, 0.05 * s, 0.28 * s, 6, x, y + 1.48 * s, z - 0.36 * s + i * 0.24 * s, 0x8a6a3a, 0, 0, 0, true);
  b.kit('item.shop.incenseShopRack', 1, y);
};

/** 斋匾「守拙斋」：漆地匾板 1.5×0.46 + 木框 + 三字题签 + 双铁挂钩（木墨，自题匾） */
// 斋匾「守拙斋」：C-ITM-0423
export const studyPlaque: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 1.5 * s, 0.46 * s, 0.07 * s, x, y, z, 0x2b2b2b);
  b.box('wood', 1.62 * s, 0.56 * s, 0.05 * s, x, y, z - 0.02 * s, shade(OILWOOD, 1.1));
  for (let i = 0; i < 3; i++) b.box('fabric', 0.24 * s, 0.26 * s, 0.02 * s, x - 0.42 * s + i * 0.42 * s, y, z + 0.05 * s, 0xf4ecd8);
  for (const sx of [-1, 1]) {
    b.box('metal', 0.03 * s, 0.16 * s, 0.03 * s, x + sx * 0.5 * s, y + 0.3 * s, z - 0.04 * s, IRONBLK);
    b.box('metal', 0.12 * s, 0.03 * s, 0.03 * s, x + sx * 0.5 * s, y + 0.38 * s, z - 0.04 * s, IRONBLK);
  }
  b.kit('item.shop.studyPlaque', 1, y);
};

/** 蟠桃供：木供案 0.9 + 漆盘 + 三枚仙桃（桃身/桃尖/叶）+ 案下横枨（仙桃，三千年实） */
// 蟠桃供：C-ITM-0361
export const peachOffering: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.9 * s, 0.06 * s, 0.5 * s, x, y + 0.78 * s, z, shade(WOOD, 0.94));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.07 * s, 0.78 * s, 0.07 * s, x + sx * 0.38 * s, y + 0.39 * s, z + sz * 0.18 * s, OILWOOD);
  b.box('wood', 0.86 * s, 0.05 * s, 0.06 * s, x, y + 0.3 * s, z, OILWOOD);
  b.cyl('lacquer', 0.24 * s, 0.2 * s, 0.05 * s, 10, x, y + 0.84 * s, z, LACQUER);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const px = x + Math.cos(a) * 0.1 * s, pz = z + Math.sin(a) * 0.1 * s;
    b.cyl('fabric', 0.085 * s, 0.06 * s, 0.1 * s, 6, px, y + 0.92 * s, pz, 0xd88a7a);
    b.box('leaf', 0.07 * s, 0.01 * s, 0.05 * s, px + 0.06 * s, y + 0.97 * s, pz, 0x4a7a4a, 0.4);
  }
  b.kit('item.shop.peachOffering', 1, y);
};

/** 塔吊：底座方架 1.3 + 立柱 3.0 + 出挑吊臂 3.0 + 尾配重 + 斜撑 + 绞盘与缠绳 + 吊绳吊钩吊货箱（木绳，卸货） */
// 塔吊：C-ITM-0214
export const cargoCrane: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.3 * s, 0.16 * s, 1.3 * s, x, y + 0.08 * s, z, shade(WOOD, 1.06));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.12 * s, 0.9 * s, 0.12 * s, x + sx * 0.5 * s, y + 0.5 * s, z + sz * 0.5 * s, OILWOOD, 0, 0, sx * 0.1);
  b.box('wood', 0.22 * s, 3.0 * s, 0.22 * s, x, y + 1.6 * s, z, shade(WOOD, 0.94));
  b.box('wood', 3.0 * s, 0.18 * s, 0.18 * s, x - 1.2 * s, y + 2.96 * s, z, shade(WOOD, 1.02), 0, 0, 0.06);
  b.box('wood', 0.6 * s, 0.12 * s, 0.12 * s, x + 0.42 * s, y + 2.96 * s, z, WOOD_D);
  b.box('wood', 0.1 * s, 1.3 * s, 0.1 * s, x - 2.1 * s, y + 2.3 * s, z, WOOD_D);
  b.box('wood', 0.72 * s, 0.08 * s, 0.08 * s, x, y + 2.7 * s, z - 0.3 * s, WOOD_D);
  b.cyl('wood', 0.16 * s, 0.16 * s, 0.5 * s, 8, x - 0.3 * s, y + 1.0 * s, z + 0.4 * s, shade(WOOD, 1.1), 0, 0, Math.PI / 2);
  b.cyl('fabric', 0.17 * s, 0.17 * s, 0.12 * s, 8, x - 0.3 * s, y + 1.0 * s, z + 0.4 * s, HEMP, 0, 0, Math.PI / 2, true);
  b.box('wood', 0.05 * s, 0.05 * s, 0.4 * s, x - 0.3 * s, y + 1.0 * s, z + 0.62 * s, WOOD_D);
  b.box('fabric', 0.03 * s, 2.6 * s, 0.03 * s, x - 2.1 * s, y + 1.6 * s, z, HEMP);
  b.box('metal', 0.14 * s, 0.12 * s, 0.06 * s, x - 2.1 * s, y + 0.94 * s, z, IRONBLK);
  b.box('wood', 0.5 * s, 0.32 * s, 0.5 * s, x - 2.1 * s, y + 0.62 * s, z, shade(WOOD, 1.02));
  b.kit('item.wharf.cargoCrane', 1, y);
};

/** 货栈雨棚：前柱 2.2 / 后柱 1.7 单坡 + 五椽 + 三幅席顶 + 席围 + 麻包货堆（席木，临时仓） */
// 货栈雨棚：C-ITM-0216
export const godownAwning: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.14 * s, 2.2 * s, 0.14 * s, x + sx * 1.35 * s, y + 1.1 * s, z - 0.8 * s, OILWOOD);
    b.box('wood', 0.12 * s, 1.7 * s, 0.12 * s, x + sx * 1.35 * s, y + 0.85 * s, z + 0.85 * s, OILWOOD);
  }
  b.box('wood', 2.9 * s, 0.14 * s, 0.16 * s, x, y + 2.16 * s, z - 0.8 * s, shade(WOOD, 0.94));
  for (let i = 0; i < 5; i++) b.box('wood', 0.1 * s, 0.1 * s, 2.1 * s, x - 1.2 * s + i * 0.6 * s, y + 2.06 * s, z, shade(WOOD, 1.08), 0, 0.12);
  for (let i = 0; i < 3; i++) b.box('fabric', 2.7 * s, 0.04 * s, 0.62 * s, x, y + (2.24 - i * 0.12) * s, z + (-0.5 + i * 0.55) * s, shade(B6CANVAS, 0.9 + i * 0.07), 0, 0.1);
  b.box('fabric', 1.2 * s, 1.4 * s, 0.03 * s, x - 0.7 * s, y + 1.15 * s, z + 0.92 * s, shade(B6CANVAS, 0.86));
  b.box('wood', 0.9 * s, 0.6 * s, 0.7 * s, x + 0.5 * s, y + 0.3 * s, z + 0.1 * s, shade(WOOD, 0.96));
  b.box('fabric', 0.8 * s, 0.4 * s, 0.6 * s, x + 0.45 * s, y + 0.8 * s, z + 0.1 * s, HEMP, 0.1);
  b.kit('item.shop.godownAwning', 1, y);
};

/** 晒粮场：夯土晒坪 2.2×1.6 + 粮层 + 四界桩 + 木耙与耙齿 + 三堆粮（夯土，摊晒场） */
// 晒粮场：C-ITM-0396
export const grainDryingYard: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('earth', 2.2 * s, 0.03 * s, 1.6 * s, x, y + 0.015 * s, z, 0xb89a6a);
  b.box('earth', 1.9 * s, 0.02 * s, 1.3 * s, x, y + 0.045 * s, z, shade(B6HAY, 1.02));
  for (const [ox, oz] of [[-1.0, -0.7], [1.0, -0.7], [-1.0, 0.7], [1.0, 0.7]] as const) b.box('wood', 0.09 * s, 0.34 * s, 0.09 * s, x + ox * s, y + 0.17 * s, z + oz * s, OILWOOD);
  b.box('wood', 0.06 * s, 0.06 * s, 1.5 * s, x + 0.3 * s, y + 0.06 * s, z, shade(WOOD, 1.1));
  for (let i = 0; i < 4; i++) b.box('wood', 0.05 * s, 0.12 * s, 0.05 * s, x + 0.3 * s, y + 0.06 * s, z - 0.6 * s + i * 0.4 * s, WOOD_D);
  for (let i = 0; i < 3; i++) b.cyl('earth', 0.16 * s, 0.2 * s, 0.1 * s, 6, x - 0.6 * s + i * 0.5 * s, y + 0.1 * s, z - 0.3 * s, shade(B6HAY, 0.94 + i * 0.05));
  b.kit('item.wharf.grainDryingYard', 1, y);
};

/** 粮车：车板 1.6 + 双辕 + 双辐轮 0.84 径与铁毂 + 两只麻袋（木轮，运粮车） */
// 粮车：C-ITM-0399
export const grainCart: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.6 * s, 0.14 * s, 0.9 * s, x, y + 0.62 * s, z, shade(WOOD, 1.02));
  for (const sz of [-1, 1]) b.box('wood', 1.6 * s, 0.34 * s, 0.06 * s, x, y + 0.86 * s, z + sz * 0.42 * s, shade(WOOD, 1.1));
  for (const sz of [-1, 1]) {
    b.cyl('wood', 0.42 * s, 0.42 * s, 0.1 * s, 8, x, y + 0.44 * s, z + sz * 0.52 * s, shade(WOOD, 0.9), 0, Math.PI / 2, 0, true);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.box('wood', 0.05 * s, 0.7 * s, 0.05 * s, x + Math.cos(a) * 0.3 * s, y + 0.44 * s + Math.sin(a) * 0.3 * s, z + sz * 0.52 * s, WOOD_D, 0, 0, a);
    }
    b.cyl('metal', 0.12 * s, 0.12 * s, 0.16 * s, 6, x, y + 0.44 * s, z + sz * 0.52 * s, IRONBLK, 0, Math.PI / 2);
  }
  for (const sz of [-1, 1]) b.box('wood', 1.1 * s, 0.1 * s, 0.1 * s, x + 1.2 * s, y + 0.5 * s, z + sz * 0.3 * s, WOOD_D, 0, 0, -0.08);
  b.box('fabric', 0.5 * s, 0.32 * s, 0.4 * s, x - 0.4 * s, y + 0.9 * s, z, HEMP);
  b.kit('item.wharf.grainCart', 1, y);
};

/** 太平缸（石）：石座 + 直壁石缸 1.24 径 + 石口沿 + 水面 + 三道石缝 + 木托盖（石，镇火大缸） */
// 太平缸：C-ITM-0411
export const stoneWaterVat: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ash', 0.62 * s, 0.7 * s, 0.12 * s, 10, x, y + 0.06 * s, z, shade(BLUESTONE, 0.9));
  b.cyl('ash', 0.62 * s, 0.5 * s, 0.72 * s, 10, x, y + 0.48 * s, z, BLUESTONE, 0, 0, 0, true);
  b.cyl('ash', 0.66 * s, 0.66 * s, 0.09 * s, 10, x, y + 0.88 * s, z, shade(BLUESTONE, 1.12), 0, 0, 0, true);
  b.cyl('water', 0.6 * s, 0.6 * s, 0.02 * s, 10, x, y + 0.82 * s, z, 0x22323a);
  for (let i = 0; i < 3; i++) b.box('ash', 0.1 * s, 0.5 * s, 0.02 * s, x + Math.cos(i * 2.1) * 0.63 * s, y + 0.5 * s, z + Math.sin(i * 2.1) * 0.63 * s, shade(BLUESTONE, 0.78), -i * 2.1);
  b.box('wood', 0.36 * s, 0.05 * s, 0.3 * s, x + 0.34 * s, y + 0.94 * s, z, shade(WOOD, 1.04));
  b.kit('item.court.stoneWaterVat', 1, y);
};

/** 太平缸（陶）：粗陶鼓腹缸 0.92 径 + 陶口沿 + 水面 + 木盖与盖钮 + 木水瓢（陶，水缸） */
// 太平缸：C-ITM-0422
// 太平缸：C-ITM-0441
export const clayWaterVat: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('ceramic', 0.4 * s, 0.3 * s, 0.7 * s, 10, x, y + 0.35 * s, z, B6CLAY, 0, 0, 0, true);
  b.cyl('ceramic', 0.46 * s, 0.4 * s, 0.12 * s, 10, x, y + 0.72 * s, z, shade(B6CLAY, 1.12), 0, 0, 0, true);
  b.cyl('water', 0.4 * s, 0.4 * s, 0.02 * s, 10, x, y + 0.68 * s, z, 0x22323a);
  b.cyl('wood', 0.44 * s, 0.44 * s, 0.05 * s, 10, x, y + 0.8 * s, z, shade(WOOD, 1.06));
  b.cyl('wood', 0.08 * s, 0.08 * s, 0.06 * s, 6, x, y + 0.85 * s, z, WOOD_D);
  b.cyl('wood', 0.12 * s, 0.1 * s, 0.18 * s, 6, x + 0.5 * s, y + 0.14 * s, z, shade(WOOD, 0.94));
  b.box('wood', 0.04 * s, 0.06 * s, 0.2 * s, x + 0.5 * s, y + 0.24 * s, z, WOOD_D, 0, 0, 0.4);
  b.kit('item.court.clayWaterVat', 1, y);
};

/** 院井：砖砌井台 1.56 径 + 井口石沿 + 水面 + 双柱横梁 + 辘轳与摇柄 + 麻绳吊桶（砖石，辘轳井） */
// 院井：C-ITM-0421
export const yardWell: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wall', 0.78 * s, 0.84 * s, 0.32 * s, 10, x, y + 0.16 * s, z, BRICK2);
  b.cyl('wall', 0.86 * s, 0.86 * s, 0.08 * s, 10, x, y + 0.36 * s, z, shade(BRICK2, 1.12));
  b.cyl('water', 0.56 * s, 0.56 * s, 0.02 * s, 8, x, y + 0.3 * s, z, 0x1e2c33);
  for (const sx of [-1, 1]) b.box('wood', 0.11 * s, 1.3 * s, 0.11 * s, x + sx * 0.74 * s, y + 1.0 * s, z, OILWOOD);
  b.box('wood', 1.6 * s, 0.12 * s, 0.12 * s, x, y + 1.62 * s, z, OILWOOD);
  b.cyl('wood', 0.12 * s, 0.12 * s, 0.72 * s, 8, x, y + 1.44 * s, z, shade(WOOD, 1.06), 0, 0, Math.PI / 2);
  b.box('metal', 0.05 * s, 0.05 * s, 0.3 * s, x + 0.42 * s, y + 1.44 * s, z + 0.1 * s, IRONBLK, 0.4);
  b.box('fabric', 0.02 * s, 0.5 * s, 0.02 * s, x, y + 1.16 * s, z + 0.12 * s, HEMP);
  b.cyl('wood', 0.14 * s, 0.12 * s, 0.2 * s, 8, x, y + 0.9 * s, z + 0.12 * s, shade(WOOD, 0.9), 0, 0, 0, true);
  b.cyl('wood', 0.12 * s, 0.12 * s, 0.02 * s, 8, x, y + 0.79 * s, z + 0.12 * s, shade(WOOD, 0.84));
  b.kit('item.court.yardWell', 1, y);
};

/** 老柳断干：断干 1.8m + 断口 + 劈裂木茬 + 双残枝挂柳叶 + 伏地柳条 + 拔根土坑（活体柳，拔柳遗址） */
// 老柳断干：C-ITM-0316
export const brokenWillow: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('trunk', 0.24 * s, 0.34 * s, 1.8 * s, 7, x, y + 0.9 * s, z, 0x4a3a28, 0, 0.06, 0.04);
  b.cyl('trunk', 0.3 * s, 0.26 * s, 0.16 * s, 7, x, y + 1.82 * s, z, 0x6a5238);
  b.box('trunk', 0.2 * s, 0.5 * s, 0.16 * s, x + 0.1 * s, y + 1.7 * s, z - 0.06 * s, 0x3e3226, 0, 0, 0.5);
  for (const [ax, az, rz] of [[-0.5, 0.2, 0.9], [0.42, -0.34, -0.8]] as const) {
    b.cyl('trunk', 0.07 * s, 0.11 * s, 1.1 * s, 6, x + ax * s, y + 2.2 * s, z + az * s, 0x4a3a28, 0, 0, rz);
    b.box('leaf', 0.7 * s, 0.3 * s, 0.5 * s, x + ax * 1.4 * s, y + 2.6 * s, z + az * 1.4 * s, 0x4a7a3a, 0.4, 0, 0.2);
  }
  b.box('leaf', 0.8 * s, 0.24 * s, 0.6 * s, x - 0.2 * s, y + 1.2 * s, z + 0.3 * s, 0x3e6e34, 0.7);
  b.box('earth', 0.9 * s, 0.1 * s, 0.9 * s, x, y + 0.05 * s, z, 0x6a5038);
  b.kit('item.court.brokenWillow', 1, y);
};

/** 穿墙老槐：主干 2.6m + 三枝挑冠 + 三层槐叶团（活体古树，树冠出墙） */
// 穿墙老槐：C-ITM-0304
export const wallLocust: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('trunk', 0.3 * s, 0.42 * s, 2.6 * s, 7, x, y + 1.3 * s, z, 0x4a3a28, 0, 0.05, 0.03);
  for (const [ax, az, rz] of [[-0.55, 0.15, 0.8], [0.5, 0.3, -0.7], [0.1, -0.5, 0.2]] as const) {
    b.cyl('trunk', 0.09 * s, 0.14 * s, 1.5 * s, 6, x + ax * s, y + 2.7 * s, z + az * s, 0x50402c, 0, 0, rz);
    b.box('leaf', 1.1 * s, 0.5 * s, 0.9 * s, x + ax * 1.6 * s, y + 3.3 * s, z + az * 1.6 * s, 0x3e6e3a, 0.3, 0, 0.15);
    b.box('leaf', 0.7 * s, 0.36 * s, 0.6 * s, x + ax * 1.9 * s, y + 3.62 * s, z + az * 1.9 * s, 0x4a7a42, 0.5);
  }
  b.kit('item.court.wallLocust', 1, y);
};

/** 驼队货栈：四柱席棚 2.1×1.4 + 三幅席顶 + 木货台 + 三只驼货包 + 驼鞍与红鞍带（席木，驼货仓栈） */
// 驼队货栈：C-ITM-0243
export const camelGodown: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.1 * s, 1.9 * s, 0.1 * s, x + sx * 0.95 * s, y + 0.95 * s, z + sz * 0.6 * s, OILWOOD);
  b.box('wood', 2.1 * s, 0.1 * s, 0.1 * s, x, y + 1.9 * s, z - 0.6 * s, OILWOOD);
  for (let i = 0; i < 3; i++) b.box('fabric', 2.0 * s, 0.05 * s, 0.55 * s, x, y + (1.98 - i * 0.08) * s, z + (-0.3 + i * 0.42) * s, shade(B6CANVAS, 0.9 + i * 0.06), 0, 0.12);
  b.box('wood', 1.5 * s, 0.5 * s, 0.9 * s, x, y + 0.25 * s, z + 0.1 * s, shade(WOOD, 0.98));
  for (let i = 0; i < 3; i++) {
    b.box('fabric', 0.5 * s, 0.34 * s, 0.44 * s, x - 0.5 * s + i * 0.5 * s, y + 0.68 * s, z + 0.1 * s, shade(HEMP, 0.92 + i * 0.05));
    b.box('fabric', 0.02 * s, 0.1 * s, 0.02 * s, x - 0.5 * s + i * 0.5 * s, y + 0.86 * s, z + 0.1 * s, 0x8a6a3a);
  }
  b.box('lacquer', 0.34 * s, 0.16 * s, 0.2 * s, x + 0.62 * s, y + 0.58 * s, z - 0.44 * s, 0x7a4a2a, 0.3);
  b.box('fabric', 0.3 * s, 0.05 * s, 0.06 * s, x + 0.62 * s, y + 0.52 * s, z - 0.44 * s, SEALRED);
  b.kit('item.wharf.camelGodown', 1, y);
};

/** 坎儿井口：砖砌方口 0.9 + 石压顶 + 水面 + 木盖 + 铁环提手 + 引水小沟（砖木，地下水道口） */
// 坎儿井口：C-ITM-0367
export const culvertMouth: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 0.9 * s, 0.5 * s, 0.9 * s, x, y + 0.25 * s, z, BRICK2);
  b.box('wall', 0.96 * s, 0.08 * s, 0.96 * s, x, y + 0.52 * s, z, shade(BRICK2, 1.12));
  b.box('water', 0.6 * s, 0.02 * s, 0.6 * s, x, y + 0.42 * s, z, 0x1e2c33);
  b.box('wood', 0.66 * s, 0.07 * s, 0.66 * s, x, y + 0.56 * s, z, shade(WOOD, 1.02));
  b.box('metal', 0.1 * s, 0.05 * s, 0.1 * s, x, y + 0.62 * s, z, IRONBLK, 0.4);
  b.cyl('metal', 0.06 * s, 0.06 * s, 0.04 * s, 8, x, y + 0.66 * s, z, IRONBLK, 0, Math.PI / 2, 0, true);
  b.box('earth', 0.3 * s, 0.06 * s, 0.9 * s, x + 0.5 * s, y + 0.03 * s, z, SANDC, 0, 0, -0.06);
  b.kit('item.court.culvertMouth', 1, y);
};

/** 木牌楼：四柱冲天 3.6m + 双额枋 + 匾与三字题签 + 瓦顶两级（木，四柱冲天带匾） */
// 木牌楼：C-ITM-0306
export const woodArchway: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.16 * s, 3.6 * s, 0.16 * s, x + sx * 1.32 * s, y + 1.8 * s, z + sz * 0.26 * s, shade(OILWOOD, 0.98));
  for (const sy of [2.0, 3.1]) {
    b.box('wood', 3.0 * s, 0.16 * s, 0.16 * s, x, y + sy * s, z, shade(WOOD, 1.04));
    b.box('wood', 2.8 * s, 0.1 * s, 0.3 * s, x, y + (sy + 0.12) * s, z, shade(WOOD, 1.1));
  }
  b.box('lacquer', 1.7 * s, 0.58 * s, 0.08 * s, x, y + 3.42 * s, z + 0.18 * s, 0x2b2b2b);
  b.box('wood', 1.82 * s, 0.68 * s, 0.06 * s, x, y + 3.42 * s, z + 0.14 * s, OILWOOD);
  for (let i = 0; i < 3; i++) b.box('fabric', 0.22 * s, 0.3 * s, 0.02 * s, x - 0.46 * s + i * 0.46 * s, y + 3.42 * s, z + 0.23 * s, 0xf4ecd8);
  b.box('roof', 3.4 * s, 0.12 * s, 0.7 * s, x, y + 3.86 * s, z, shade(BRICK2, 1.05));
  b.box('roof', 2.4 * s, 0.1 * s, 0.55 * s, x, y + 3.98 * s, z, shade(BRICK2, 1.12));
  b.kit('item.market.woodArchway', 1, y);
};

/** 香客棚：四柱席棚 1.9×1.4 + 席顶 + 四幅席围 + 摊案 + 三只供碗 + 香束（席木，庙会摊棚） */
// 香客棚：C-ITM-0209
export const pilgrimShed: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.1 * s, 1.9 * s, 0.1 * s, x + sx * 0.85 * s, y + 0.95 * s, z + sz * 0.55 * s, OILWOOD);
  b.box('wood', 1.85 * s, 0.09 * s, 0.09 * s, x, y + 1.9 * s, z - 0.55 * s, WOOD_D);
  b.box('fabric', 1.9 * s, 0.05 * s, 1.3 * s, x, y + 2.0 * s, z, B6CANVAS, 0, 0.1);
  for (let i = 0; i < 4; i++) b.box('fabric', 0.5 * s, 0.5 * s, 0.02 * s, x - 0.7 * s + i * 0.47 * s, y + 1.5 * s, z - 0.62 * s, shade(0xc8bb98, 0.92 + (i % 2) * 0.1));
  b.box('wood', 1.4 * s, 0.08 * s, 0.5 * s, x, y + 0.72 * s, z + 0.1 * s, shade(WOOD, 1.02));
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 0.72 * s, 0.08 * s, x + sx * 0.6 * s, y + 0.36 * s, z + 0.1 * s, OILWOOD);
  for (let i = 0; i < 3; i++) b.box('ceramic', 0.12 * s, 0.14 * s, 0.12 * s, x - 0.4 * s + i * 0.4 * s, y + 0.83 * s, z + 0.1 * s, i % 2 ? B6CLAY : GRAYCERAMIC);
  b.box('fabric', 0.3 * s, 0.06 * s, 0.24 * s, x + 0.42 * s, y + 0.79 * s, z + 0.1 * s, 0xd8cbb0);
  b.kit('item.market.pilgrimShed', 1, y);
};

/** 鱼摊：木案 1.6×0.8 + 下层板 + 碎冰层 + 三尾鲜鱼 + 木盆 + 鱼刀（木冰，鲜鱼列摊） */
// 鱼摊：C-ITM-0311
export const fishStall: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.6 * s, 0.08 * s, 0.8 * s, x, y + 0.74 * s, z, shade(WOOD, 1.04));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.08 * s, 0.74 * s, 0.08 * s, x + sx * 0.72 * s, y + 0.37 * s, z + sz * 0.32 * s, OILWOOD);
  b.box('wood', 1.56 * s, 0.06 * s, 0.7 * s, x, y + 0.3 * s, z, shade(WOOD, 0.9));
  b.box('ceramic', 1.3 * s, 0.1 * s, 0.6 * s, x, y + 0.83 * s, z, B6ICE);
  for (let i = 0; i < 3; i++) {
    const px = x - 0.48 * s + i * 0.42 * s;
    b.cyl('fabric', 0.1 * s, 0.05 * s, 0.4 * s, 6, px, y + 0.92 * s, z, 0x9aa8b0, 0, 0, Math.PI / 2);
    b.box('fabric', 0.12 * s, 0.02 * s, 0.14 * s, px + 0.22 * s, y + 0.92 * s, z, 0x7a8894, 0, 0, 0.4);
  }
  b.cyl('wood', 0.16 * s, 0.14 * s, 0.24 * s, 8, x + 0.62 * s, y + 0.12 * s, z + 0.42 * s, shade(WOOD, 0.94), 0, 0, 0, true);
  b.box('wood', 0.2 * s, 0.01 * s, 0.03 * s, x - 0.66 * s, y + 0.83 * s, z + 0.34 * s, 0x9aa4ac, 0, 0, 0.3);
  b.kit('item.market.fishStall', 1, y);
};

/** 摊位列棚：四柱竹架 2.3 + 双横杆 + 四幅棚席 + 双摊案与货罐（席竹，行列棚架） */
// 摊位列棚：C-ITM-0228
export const stallRow: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.08 * s, 2.0 * s, 0.08 * s, x + sx * 1.1 * s, y + 1.0 * s, z + sz * 0.6 * s, BAMBOO);
  for (const sx of [-1, 1]) b.box('wood', 2.3 * s, 0.07 * s, 0.07 * s, x, y + 2.0 * s, z + sx * 0.6 * s, BAMBOO_L);
  for (let i = 0; i < 4; i++) b.box('fabric', 0.55 * s, 0.04 * s, 1.3 * s, x - 0.85 * s + i * 0.56 * s, y + 2.06 * s, z, shade(B6CANVAS, 0.88 + (i % 2) * 0.12), 0, 0.08);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.9 * s, 0.07 * s, 0.6 * s, x + sx * 0.56 * s, y + 0.7 * s, z, shade(WOOD, 1.02));
    for (const dz of [-1, 1]) b.box('wood', 0.07 * s, 0.7 * s, 0.07 * s, x + sx * 0.56 * s, y + 0.35 * s, z + dz * 0.24 * s, OILWOOD);
    b.box('ceramic', 0.16 * s, 0.12 * s, 0.16 * s, x + sx * 0.56 * s, y + 0.8 * s, z, sx > 0 ? 0xb8734a : GRAYCERAMIC);
  }
  b.kit('item.market.stallRow', 1, y);
};

/** 摊棚：双前柱 1.9 / 双后柱 1.5 单坡 + 席顶 + 摊案 + 三只竹筐 + 布包（席竹，露天摊架） */
// 摊棚：C-ITM-0307
export const stallAwning: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) {
    b.box('wood', 0.09 * s, 1.9 * s, 0.09 * s, x + sx * 0.95 * s, y + 0.95 * s, z - 0.3 * s, BAMBOO);
    b.box('wood', 0.09 * s, 1.5 * s, 0.09 * s, x + sx * 0.95 * s, y + 0.75 * s, z + 0.45 * s, BAMBOO);
  }
  b.box('wood', 2.0 * s, 0.07 * s, 0.07 * s, x, y + 1.9 * s, z - 0.3 * s, BAMBOO_L);
  b.box('fabric', 2.1 * s, 0.04 * s, 1.0 * s, x, y + 1.86 * s, z + 0.05 * s, B6CANVAS, 0, 0.16);
  b.box('wood', 1.7 * s, 0.07 * s, 0.55 * s, x, y + 0.66 * s, z + 0.2 * s, shade(WOOD, 1.04));
  for (const sx of [-1, 1]) b.box('wood', 0.07 * s, 0.66 * s, 0.07 * s, x + sx * 0.76 * s, y + 0.33 * s, z + 0.2 * s, OILWOOD);
  for (let i = 0; i < 3; i++) b.box('wood', 0.3 * s, 0.16 * s, 0.3 * s, x - 0.5 * s + i * 0.5 * s, y + 0.78 * s, z + 0.2 * s, shade(BAMBOO_L, 0.94 + i * 0.05));
  b.box('fabric', 0.24 * s, 0.1 * s, 0.24 * s, x + 0.5 * s, y + 0.86 * s, z + 0.2 * s, 0xd8cbb0);
  b.kit('item.market.stallAwning', 1, y);
};

/** 弓矢摊：双柱弓架 1.42 + 三张竹弓与弓弦 + 箭筒与三矢 + 朱布箭囊盖（竹木，租弓箭） */
// 弓矢摊：C-ITM-0318
export const bowRack: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) b.box('wood', 0.09 * s, 1.7 * s, 0.09 * s, x + sx * 0.66 * s, y + 0.85 * s, z, BAMBOO2);
  b.box('wood', 1.42 * s, 0.07 * s, 0.07 * s, x, y + 1.62 * s, z, shade(BAMBOO2, 1.1));
  b.box('wood', 1.42 * s, 0.07 * s, 0.07 * s, x, y + 0.6 * s, z, shade(BAMBOO2, 1.04));
  for (let i = 0; i < 3; i++) {
    const px = x - 0.42 * s + i * 0.42 * s;
    b.cyl('wood', 0.035 * s, 0.03 * s, 1.1 * s, 6, px, y + 1.12 * s, z + 0.06 * s, 0x6a4a2a, 0, 0, 0.12);
    b.box('fabric', 0.012 * s, 0.9 * s, 0.012 * s, px - 0.06 * s, y + 1.12 * s, z + 0.06 * s, HEMP);
  }
  b.cyl('wood', 0.11 * s, 0.11 * s, 0.5 * s, 8, x + 0.86 * s, y + 0.42 * s, z, shade(BAMBOO2, 0.94), 0, 0, 0, true);
  for (let i = 0; i < 3; i++) b.cyl('wood', 0.012 * s, 0.012 * s, 0.66 * s, 4, x + 0.86 * s + (i - 1) * 0.035 * s, y + 0.62 * s, z + (i % 2 ? 0.04 : -0.04) * s, 0x8a6a3a, 0, 0, (i - 1) * 0.06);
  b.box('fabric', 0.18 * s, 0.02 * s, 0.18 * s, x + 0.86 * s, y + 0.7 * s, z, 0x9d2933);
  b.kit('item.market.bowRack', 1, y);
};

/** 草料槽：石槽身 1.5×0.62 + 双石端板 + 双槽沿 + 干草 + 双木架杆 + 料袋（石木，客马喂饲） */
// 草料槽：C-ITM-0286
export const fodderTrough: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('ash', 1.5 * s, 0.16 * s, 0.62 * s, x, y + 0.08 * s, z, shade(BLUESTONE, 0.9));
  for (const sx of [-1, 1]) b.box('ash', 0.14 * s, 0.4 * s, 0.62 * s, x + sx * 0.68 * s, y + 0.24 * s, z, BLUESTONE);
  for (const sz of [-1, 1]) b.box('ash', 1.4 * s, 0.06 * s, 0.12 * s, x, y + 0.42 * s, z + sz * 0.26 * s, shade(BLUESTONE, 1.06));
  b.box('leaf', 1.3 * s, 0.16 * s, 0.4 * s, x, y + 0.34 * s, z, B6HAY);
  for (const sx of [-1, 1]) b.box('wood', 0.08 * s, 0.5 * s, 0.08 * s, x + sx * 0.72 * s, y + 0.55 * s, z - 0.3 * s, OILWOOD);
  b.box('fabric', 0.3 * s, 0.22 * s, 0.1 * s, x + 0.3 * s, y + 0.6 * s, z - 0.3 * s, HEMP);
  b.kit('item.wharf.fodderTrough', 1, y);
};

/** 草料垛：三层递减草垛 1.3×1.1 + 夯土垫层 + 双草叉 + 捆绳（干草，驼马草料） */
// 草料垛：C-ITM-0368
export const fodderStack: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('earth', 1.3 * s, 0.06 * s, 1.1 * s, x, y + 0.03 * s, z, SANDC);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) {
    b.box('leaf', (0.9 - row * 0.16) * s, 0.26 * s, (0.8 - row * 0.1) * s, x + (i - (2 - row) / 2) * 0.42 * s, y + (0.19 + row * 0.24) * s, z, shade(B6HAY, 0.9 + row * 0.08), 0, 0, (i % 2 ? 0.04 : -0.04));
  }
  for (const sx of [-1, 1]) b.cyl('wood', 0.03 * s, 0.03 * s, 1.0 * s, 4, x + sx * 0.3 * s, y + 0.7 * s, z + 0.4 * s, shade(WOOD, 1.06), 0, 0.1, sx * 0.2);
  b.box('fabric', 0.06 * s, 0.02 * s, 0.4 * s, x, y + 0.62 * s, z + 0.42 * s, HEMP);
  b.kit('item.wharf.fodderStack', 1, y);
};

/** 驼棚：夯土三面矮墙 + 双木柱与横梁 + 三层草顶 + 石槽与草 + 驼鞍架（夯土木，驼位草槽） */
// 驼棚：C-ITM-0366
export const camelShed: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('earth', 2.3 * s, 1.1 * s, 0.3 * s, x, y + 0.55 * s, z - 0.7 * s, shade(0x9a8a6a, 1.0));
  for (const sx of [-1, 1]) b.box('earth', 0.3 * s, 1.1 * s, 1.1 * s, x + sx * 1.0 * s, y + 0.55 * s, z, shade(0x9a8a6a, 0.94));
  for (const sx of [-1, 1]) b.box('wood', 0.12 * s, 1.3 * s, 0.12 * s, x + sx * 1.0 * s, y + 1.7 * s, z + 0.5 * s, OILWOOD);
  b.box('wood', 2.3 * s, 0.12 * s, 0.12 * s, x, y + 2.3 * s, z + 0.5 * s, OILWOOD);
  for (let i = 0; i < 3; i++) b.box('leaf', 2.4 * s, 0.05 * s, 0.5 * s, x, y + (2.36 - i * 0.08) * s, z + (0.28 - i * 0.28) * s, shade(B6HAY, 0.88 + i * 0.08), 0, 0.14);
  b.box('ash', 1.2 * s, 0.26 * s, 0.36 * s, x, y + 0.13 * s, z + 0.2 * s, shade(BLUESTONE, 0.92));
  b.box('leaf', 1.0 * s, 0.1 * s, 0.3 * s, x, y + 0.28 * s, z + 0.2 * s, B6HAY);
  b.box('wood', 0.5 * s, 0.5 * s, 0.3 * s, x + 0.6 * s, y + 0.7 * s, z - 0.1 * s, shade(WOOD, 0.96));
  b.box('lacquer', 0.34 * s, 0.14 * s, 0.2 * s, x + 0.6 * s, y + 0.98 * s, z - 0.1 * s, 0x7a4a2a);
  b.kit('item.wharf.camelShed', 1, y);
};

/** 杂货担：竹扁担 1.5 + 双绳 + 双编筐 + 针头线脑布包与朱签盒（竹，针头线脑） */
// 杂货担：C-ITM-0312
export const notionCarry: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.035 * s, 0.04 * s, 1.5 * s, 6, x, y + 1.06 * s, z, BAMBOO, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    b.box('fabric', 0.02 * s, 0.28 * s, 0.02 * s, x + sx * 0.52 * s, y + 0.9 * s, z, HEMP);
    b.cyl('wood', 0.24 * s, 0.2 * s, 0.28 * s, 8, x + sx * 0.52 * s, y + 0.6 * s, z, BAMBOO_L, 0, 0, 0, true);
    b.cyl('wood', 0.22 * s, 0.22 * s, 0.03 * s, 8, x + sx * 0.52 * s, y + 0.45 * s, z, shade(BAMBOO, 0.86));
    b.box('fabric', 0.3 * s, 0.1 * s, 0.24 * s, x + sx * 0.52 * s, y + 0.78 * s, z, sx > 0 ? 0xd8cbb0 : 0x8fa8b8);
    b.box('wood', 0.08 * s, 0.16 * s, 0.08 * s, x + sx * 0.52 * s, y + 0.86 * s, z + 0.1 * s, SEALRED);
  }
  b.kit('item.shop.notionCarry', 1, y);
};

/** 市鼓：鼓架四柱 0.66 + 双横枨 + 鼓身 0.8 径 0.6 长 + 双铁圈与皮面 + 双鼓槌（皮木，开市闭市鼓） */
// 市鼓：C-ITM-0221
export const marketDrum: ItemBuilder = (b, x, y, z, s = 1) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.1 * s, 0.66 * s, 0.1 * s, x + sx * 0.46 * s, y + 0.33 * s, z + sz * 0.26 * s, OILWOOD);
  for (const sx of [-1, 1]) b.box('wood', 1.02 * s, 0.08 * s, 0.08 * s, x, y + 0.66 * s, z + sx * 0.26 * s, OILWOOD);
  b.box('wood', 0.08 * s, 0.5 * s, 0.08 * s, x - 0.5 * s, y + 0.33 * s, z, OILWOOD);
  b.cyl('fabric', 0.4 * s, 0.4 * s, 0.6 * s, 12, x, y + 1.02 * s, z, 0xc8a06a, 0, Math.PI / 2);
  for (const sz of [-1, 1]) {
    b.cyl('metal', 0.42 * s, 0.42 * s, 0.04 * s, 8, x, y + 1.02 * s, z + sz * 0.31 * s, shade(IRONBLK, 1.15), 0, Math.PI / 2, 0, true);
    b.cyl('fabric', 0.41 * s, 0.41 * s, 0.02 * s, 8, x, y + 1.02 * s, z + sz * 0.33 * s, 0xf0e2c0, 0, Math.PI / 2);
  }
  for (const sx of [-1, 1]) b.box('wood', 0.05 * s, 0.05 * s, 0.5 * s, x + sx * 0.16 * s, y + 0.48 * s, z + 0.42 * s, WOOD_D, 0, sx * 0.4);
  b.kit('item.market.marketDrum', 1, y);
};

export const BATCH6_BUILDERS: Record<string, ItemBuilder> = {
  smallClayStove, kitchenClayStove, twinClayStove, sharedStoveShed, eaveClayStove, snowFirePit,
  officialMeasure, officialHu, grainDou, stoneStelae, meritSteleRow, teaStallSeat,
  fruitShopRack, porcelainShopRack, capShopRack, incenseShopRack, studyPlaque, peachOffering,
  cargoCrane, godownAwning, grainDryingYard, grainCart,
  stoneWaterVat, clayWaterVat, yardWell, brokenWillow, wallLocust, camelGodown, culvertMouth, woodArchway,
  pilgrimShed, fishStall, stallRow, stallAwning, bowRack,
  fodderTrough, fodderStack, camelShed, notionCarry, marketDrum,
};

const BATCH6_TABLE: [RegExp, string][] = [
  [/小土灶/, 'smallClayStove'],
  [/厨房土灶/, 'kitchenClayStove'],
  [/土灶/, 'twinClayStove'],
  [/共灶棚/, 'sharedStoveShed'],
  [/陶灶/, 'eaveClayStove'],
  [/火塘|暖炉/, 'snowFirePit'],
  [/官斛官尺/, 'officialMeasure'],
  [/官斛/, 'officialHu'],
  [/斗斛/, 'grainDou'],
  [/碑碣/, 'stoneStelae'],
  [/功德碑林/, 'meritSteleRow'],
  [/茶水铺|茶座/, 'teaStallSeat'],
  [/果品行栈/, 'fruitShopRack'],
  [/瓷器行栈/, 'porcelainShopRack'],
  [/巾帽行栈/, 'capShopRack'],
  [/香药行栈/, 'incenseShopRack'],
  [/斋匾/, 'studyPlaque'],
  [/蟠桃供/, 'peachOffering'],
  [/塔吊/, 'cargoCrane'],
  [/货栈雨棚/, 'godownAwning'],
  [/晒粮场/, 'grainDryingYard'],
  [/粮车/, 'grainCart'],
  [/太平缸/, 'stoneWaterVat'],
  [/院井/, 'yardWell'],
  [/老柳断干/, 'brokenWillow'],
  [/穿墙老槐/, 'wallLocust'],
  [/驼队货栈/, 'camelGodown'],
  [/坎儿井口/, 'culvertMouth'],
  [/木牌楼/, 'woodArchway'],
  [/香客棚/, 'pilgrimShed'],
  [/鱼摊/, 'fishStall'],
  [/摊位列棚/, 'stallRow'],
  [/摊棚/, 'stallAwning'],
  [/弓矢摊/, 'bowRack'],
  [/草料槽/, 'fodderTrough'],
  [/草料垛/, 'fodderStack'],
  [/驼棚/, 'camelShed'],
  [/杂货担/, 'notionCarry'],
  [/市鼓/, 'marketDrum'],
];

export const SERVICE_BUILDERS: Record<string, ItemBuilder> = {
  wineSea, fruitDish, ewer, foodBox, teaStove, wineBoard, accountDesk, accountDeskSmall, waterVat, manger,
  incenseBowl, soupCauldron, soupLadle, firewoodStack, bambooFlume, stoveEyes, soupTokens, teaLedger, soupMat, latticeBooth,
};

export const ITEM_BUILDERS: Record<string, ItemBuilder> = {
  censer, lantern, jar, bottle, vase, tray, bowl, mirror, screen, cushion, qin, pestle, cabinet, scrollRack, axe, flag, seal, bell,
  table, stool, bed, umbrella, fan, weapon, book,
};

/** 按名称关键词推断器件类型；返回 null 表示暂无对应构件 */
export function builderForName(name: string): { key: string; fn: ItemBuilder } | null {
  const table: [RegExp, string][] = [
    [/香炉|博山炉|熏炉/, 'censer'],
    [/灯|烛台|长明灯/, 'lantern'],
    [/坛|瓮|罐|酿坛/, 'jar'],
    [/瓶|净瓶|壶/, 'bottle'],
    [/觚|花觚|玉瓶/, 'vase'],
    [/盘|供盘|托盘/, 'tray'],
    [/碗|盏|杯|盂/, 'bowl'],
    [/镜/, 'mirror'],
    [/屏风|屏/, 'screen'],
    [/蒲团|坐垫|席垫/, 'cushion'],
    [/琴/, 'qin'],
    [/杵臼|玉杵|药杵/, 'pestle'],
    [/柜|药柜|匣/, 'cabinet'],
    [/简架|书案|架/, 'scrollRack'],
    [/斧|钺|仪仗|镫|鞭/, 'axe'],
    [/旗|幡|帏|帷|帐/, 'flag'],
    [/玺|印/, 'seal'],
    [/钟|磬/, 'bell'],
    [/桌|案/, 'table'], [/凳|椅|座/, 'stool'],
    [/伞|蓋|盖/, 'umbrella'], [/扇/, 'fan'], [/書|书|卷|冊|册/, 'book'],
  ];
  for (const [re, key] of table) {
    if (re.test(name)) return { key, fn: ITEM_BUILDERS[key] };
  }
  const service: [RegExp, string][] = [
    [/银酒海/, 'wineSea'],
    [/果菜碟/, 'fruitDish'],
    [/注子/, 'ewer'],
    [/食盒/, 'foodBox'],
    [/茶汤炉/, 'teaStove'],
    [/名酒单水牌|水牌/, 'wineBoard'],
    [/账台/, 'accountDesk'],
    [/天井水缸|水缸/, 'waterVat'],
    [/马槽/, 'manger'],
    [/香插石钵/, 'incenseBowl'],
    [/孟婆汤锅/, 'soupCauldron'],
    [/汤勺/, 'soupLadle'],
    [/柴垛/, 'firewoodStack'],
    [/引水竹枧|竹枧/, 'bambooFlume'],
    [/灶膛双眼/, 'stoveEyes'],
    [/取汤竹筹|竹筹/, 'soupTokens'],
    [/忘川茶账/, 'teaLedger'],
    [/孟婆位/, 'soupMat'],
    [/小阁子/, 'latticeBooth'],
  ];
  for (const [re, key] of service) {
    if (re.test(name)) return { key, fn: SERVICE_BUILDERS[key] };
  }
  // 二批器物表最后查：旧两表顺序与命中优先级原样保留
  for (const [re, key] of BATCH2_TABLE) {
    if (re.test(name)) return { key, fn: BATCH2_BUILDERS[key] };
  }
  // 三批器物表最后兜底：前三表命中优先级不变
  for (const [re, key] of BATCH3_TABLE) {
    if (re.test(name)) return { key, fn: BATCH3_BUILDERS[key] };
  }
  // 四批真物件表：前三表顺序与命中优先级原样保留，本表只兜底
  for (const [re, key] of BATCH4_TABLE) {
    if (re.test(name)) return { key, fn: BATCH4_BUILDERS[key] };
  }
  // 五批商货物件表（第六张表）：前五表顺序与命中优先级原样保留，本表最后兜底
  for (const [re, key] of BATCH5_TABLE) {
    if (re.test(name)) return { key, fn: BATCH5_BUILDERS[key] };
  }
  // 六批商货物件表（第七张表）：前六表顺序与命中优先级原样保留，本表最后兜底
  for (const [re, key] of BATCH6_TABLE) {
    if (re.test(name)) return { key, fn: BATCH6_BUILDERS[key] };
  }
  return null;
}

// ---------- 八批器物（WS-41 室内 8 型 / 9 件）：庙观 · 市楼 · 食肆 · 宅院 ----------

/** 感应签筒：C-ITM-0171（竹 · 2 具 · 上清观签案）——竹筒百支签、口沿铜箍、三色签头（上上/中/下） */
export const signTube: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.086 * s, 0.086 * s, 0.42 * s, 8, x, y + 0.21 * s, z, BAMBOO2, 0, 0, 0, true);
  b.cyl('wood', 0.092 * s, 0.092 * s, 0.03 * s, 8, x, y + 0.015 * s, z, shade(BAMBOO2, 0.8));
  b.cyl('metal', 0.09 * s, 0.09 * s, 0.035 * s, 8, x, y + 0.4 * s, z, GILTCU, 0, 0, 0, true);
  // 百支签压成 12 支可见签（LOD），签头三色漆：朱=上上 / 青=中 / 墨=下
  for (let i = 0; i < 12; i++) {
    const a = i * 0.5236 + 0.2, rr = 0.026 + (i % 3) * 0.016;
    b.box('wood', 0.011 * s, 0.24 * s, 0.011 * s, x + Math.cos(a) * rr * s, y + 0.53 * s, z + Math.sin(a) * rr * s, shade(BAMBOO2, 1 - (i % 3) * 0.05));
    b.box('lacquer', 0.013 * s, 0.032 * s, 0.013 * s, x + Math.cos(a) * rr * s, y + 0.66 * s, z + Math.sin(a) * rr * s, i % 3 === 0 ? 0x9d2933 : i % 3 === 1 ? 0x2e4e7e : 0x2b2b2b);
  }
  b.kit('item.renjian.signTube', 1, y);
};

/** 脱险签筒：C-ITM-0330（竹 · 1 具 · 镇江王庙廊下）——短筒八支签，签头一律朱漆，筒身缠麻绳一道 */
export const signTubeEscape: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('wood', 0.078 * s, 0.078 * s, 0.34 * s, 8, x, y + 0.17 * s, z, shade(BAMBOO2, 0.94), 0, 0, 0, true);
  b.cyl('wood', 0.084 * s, 0.084 * s, 0.028 * s, 8, x, y + 0.014 * s, z, shade(BAMBOO2, 0.76));
  b.cyl('fabric', 0.082 * s, 0.082 * s, 0.05 * s, 8, x, y + 0.26 * s, z, HEMP, 0, 0, 0, true);
  for (let i = 0; i < 8; i++) {
    const a = i * 0.7854 + 0.3, rr = 0.024 + (i % 2) * 0.02;
    b.box('wood', 0.011 * s, 0.22 * s, 0.011 * s, x + Math.cos(a) * rr * s, y + 0.44 * s, z + Math.sin(a) * rr * s, shade(BAMBOO2, 1.02 - (i % 3) * 0.05));
    b.box('lacquer', 0.014 * s, 0.03 * s, 0.014 * s, x + Math.cos(a) * rr * s, y + 0.56 * s, z + Math.sin(a) * rr * s, 0x9d2933);
  }
  b.kit('item.renjian.signTubeEscape', 1, y);
};

/** 暮鼓：C-ITM-0176（皮木 · 1 面 · 上清观鼓楼）——朱漆大鼓双面牛皮、铁箍三道、四柱鼓架、双槌 */
export const greatDrum: ItemBuilder = (b, x, y, z, s = 1) => {
  b.cyl('lacquer', 0.62 * s, 0.62 * s, 0.86 * s, 12, x, y + 1.16 * s, z, 0x8a2a1e);
  for (const sy of [-1, 1]) b.cyl('fabric', 0.648 * s, 0.648 * s, 0.05 * s, 12, x, y + (1.16 + sy * 0.45) * s, z, 0xd8cbb0);
  for (const oy of [-0.34, 0.34]) b.cyl('metal', 0.652 * s, 0.652 * s, 0.045 * s, 12, x, y + (1.16 + oy) * s, z, IRONBLK, 0, 0, 0, true);
  // 鼓钉一圈（皮面压边）
  for (let i = 0; i < 6; i++) {
    const a = i * 1.0472 + 0.2;
    b.box('metal', 0.05 * s, 0.05 * s, 0.04 * s, x + Math.cos(a) * 0.53 * s, y + 1.57 * s, z + Math.sin(a) * 0.53 * s, shade(IRONBLK, 1.2), a);
  }
  // 鼓架：四柱 + 前后上枋
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('wood', 0.12 * s, 1.5 * s, 0.12 * s, x + sx * 0.72 * s, y + 0.75 * s, z + sz * 0.36 * s, SANDAL);
  }
  for (const sz of [-1, 1]) b.box('wood', 1.66 * s, 0.12 * s, 0.12 * s, x, y + 1.5 * s, z + sz * 0.36 * s, SANDAL);
  // 鼓槌（靠在鼓架右侧）
  b.cyl('wood', 0.022 * s, 0.026 * s, 0.62 * s, 5, x + 0.9 * s, y + 0.62 * s, z, SANDAL, 0, 0, 0.22);
  b.cyl('fabric', 0.062 * s, 0.062 * s, 0.12 * s, 6, x + 0.9 * s, y + 0.98 * s, z, 0xd8cbb0, 0, 0, 0.22);
  b.kit('item.renjian.greatDrum', 1, y);
};

/** 三足丹炉：C-ITM-0178（铁铜 · 1 座 · 上清观丹房）——三足鼎式炉身、八卦炉盖、双耳、炉口火光与紫烟 */
export const elixirFurnace: ItemBuilder = (b, x, y, z, s = 1) => {
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    b.cyl('metal', 0.06 * s, 0.085 * s, 0.38 * s, 6, x + Math.cos(a) * 0.24 * s, y + 0.19 * s, z + Math.sin(a) * 0.24 * s, BRONZE_D);
  }
  b.cyl('metal', 0.36 * s, 0.3 * s, 0.5 * s, 10, x, y + 0.62 * s, z, BRONZE);
  b.cyl('metal', 0.4 * s, 0.36 * s, 0.08 * s, 10, x, y + 0.9 * s, z, shade(BRONZE, 1.14), 0, 0, 0, true);
  // 炉盖：三级收分 + 八卦环带 + 顶钮
  b.cyl('metal', 0.2 * s, 0.34 * s, 0.16 * s, 8, x, y + 1.02 * s, z, shade(BRONZE, 1.06));
  b.cyl('metal', 0.08 * s, 0.18 * s, 0.12 * s, 8, x, y + 1.15 * s, z, shade(BRONZE, 1.18));
  b.cyl('metal', 0.03 * s, 0.05 * s, 0.1 * s, 6, x, y + 1.26 * s, z, GOLD);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + 0.2;
    b.box('lacquer', 0.05 * s, 0.11 * s, 0.03 * s, x + Math.cos(a) * 0.3 * s, y + 0.97 * s, z + Math.sin(a) * 0.3 * s, i % 2 ? 0x2b2b2b : 0xcfc6a8, a);
  }
  for (const sx of [-1, 1]) b.box('metal', 0.07 * s, 0.2 * s, 0.13 * s, x + sx * 0.38 * s, y + 0.82 * s, z, BRONZE_D);
  // 炉门火光（前置）+ 炉顶紫烟
  b.box('trunk', 0.3 * s, 0.26 * s, 0.06 * s, x, y + 0.4 * s, z + 0.3 * s, 0x1c1410);
  b.box('glow', 0.24 * s, 0.12 * s, 0.05 * s, x, y + 0.39 * s, z + 0.33 * s, 0xff7f50);
  b.cyl('glow', 0.05 * s, 0.13 * s, 0.28 * s, 6, x, y + 1.4 * s, z, 0xc8a8ff);
  b.kit('item.renjian.elixirFurnace', 1, y);
};

/** 公平秤（天平）：C-ITM-0227（铜木 · 1 架 · 市楼前亭）——等臂横梁、双铜盘三索、立柱刻度、砝码盒 */
export const fairScale: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 0.5 * s, 0.07 * s, 0.4 * s, x, y + 0.035 * s, z, SANDAL);
  b.box('wood', 0.12 * s, 0.92 * s, 0.12 * s, x, y + 0.5 * s, z, SANDAL);
  b.box('wood', 0.18 * s, 0.09 * s, 0.18 * s, x, y + 0.075 * s, z, SANDAL);
  // 横梁 + 中心刀口 + 指针（对准立柱刻度）
  b.box('metal', 1.02 * s, 0.035 * s, 0.035 * s, x, y + 0.95 * s, z, GILTCU);
  b.cyl('metal', 0.05 * s, 0.05 * s, 0.07 * s, 8, x, y + 0.95 * s, z, BRONZE_D, 0, 0, Math.PI / 2);
  b.box('metal', 0.02 * s, 0.24 * s, 0.02 * s, x, y + 0.82 * s, z + 0.045 * s, GILTCU);
  for (let i = 0; i < 3; i++) b.box('lacquer', 0.05 * s, 0.014 * s, 0.02 * s, x, y + 0.74 * s + i * 0.09 * s, z + 0.065 * s, SEALRED);
  // 双盘 + 三索 + 吊环
  for (const sx of [-1, 1]) {
    b.cyl('metal', 0.17 * s, 0.15 * s, 0.03 * s, 8, x + sx * 0.48 * s, y + 0.63 * s, z, GILTCU);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.4;
      b.cyl('fabric', 0.006 * s, 0.006 * s, 0.29 * s, 3, x + sx * 0.48 * s + Math.cos(a) * 0.1 * s, y + 0.79 * s, z + Math.sin(a) * 0.1 * s, 0x8a7a5a);
    }
    b.cyl('metal', 0.035 * s, 0.035 * s, 0.03 * s, 5, x + sx * 0.48 * s, y + 0.94 * s, z, GILTCU, 0, 0, Math.PI / 2);
  }
  // 砝码盒：三枚铜权
  b.box('wood', 0.42 * s, 0.1 * s, 0.24 * s, x + 0.74 * s, y + 0.05 * s, z - 0.02 * s, OILWOOD);
  for (let i = 0; i < 3; i++) {
    b.cyl('metal', 0.05 * s, 0.055 * s, 0.09 * s + i * 0.03 * s, 6, x + 0.6 * s + i * 0.13 * s, y + 0.12 * s + i * 0.015 * s, z - 0.02 * s, shade(BRONZE, 1.04 + i * 0.04));
  }
  b.kit('item.renjian.fairScale', 1, y);
};

/** 双眼猛火灶：C-ITM-0267（砖铁 · 1 座 · 飯鋪灶间）——砖砌灶身、双铁锅、双灶门火光、砖烟道出院 */
export const greatStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wall', 2.2 * s, 0.9 * s, 1.2 * s, x, y + 0.45 * s, z, BRICK2);
  for (let k = 0; k < 3; k++) b.box('earth', 2.24 * s, 0.16 * s, 1.24 * s, x, y + (0.16 + k * 0.3) * s, z, shade(0x8a5a44, 0.9 + k * 0.08));
  b.box('ash', 2.28 * s, 0.1 * s, 1.26 * s, x, y + 0.95 * s, z, 0x8c857a);
  for (const sx of [-1, 1]) {
    b.cyl('metal', 0.4 * s, 0.34 * s, 0.22 * s, 12, x + sx * 0.52 * s, y + 1.05 * s, z, 0x2a2622, 0, 0, 0, true);
    b.cyl('metal', 0.42 * s, 0.42 * s, 0.04 * s, 12, x + sx * 0.52 * s, y + 1.17 * s, z, IRONBLK, 0, 0, 0, true);
    b.box('trunk', 0.42 * s, 0.28 * s, 0.06 * s, x + sx * 0.52 * s, y + 0.4 * s, z + 0.63 * s, 0x1c1410);
    b.box('glow', 0.34 * s, 0.18 * s, 0.05 * s, x + sx * 0.52 * s, y + 0.4 * s, z + 0.66 * s, 0xff7a2a);
  }
  // 烟道：砖身直上 + 瓦帽
  b.box('wall', 0.4 * s, 2.0 * s, 0.4 * s, x - 0.86 * s, y + 1.95 * s, z - 0.4 * s, shade(BRICK2, 0.9));
  b.box('roof', 0.52 * s, 0.12 * s, 0.52 * s, x - 0.86 * s, y + 2.98 * s, z - 0.4 * s, 0x3b4045);
  // 灶面铁锅盖 + 灶边铁钳
  for (const sx of [-1, 1]) b.box('metal', 0.06 * s, 0.03 * s, 0.24 * s, x + sx * 0.52 * s, y + 1.03 * s, z - 0.24 * s, IRONBLK);
  b.box('metal', 0.4 * s, 0.03 * s, 0.03 * s, x + 0.2 * s, y + 1.02 * s, z + 0.42 * s, IRONBLK, 0, 0, 0.3);
  b.kit('item.renjian.greatStove', 1, y);
};

/** 茶担：C-ITM-0314（竹铜 · 1 副 · 柳林茶亭）——竹扁担三脚歇架，一头铜茶炉温茶桶、一头青瓷凉茶桶与碗摞 */
export const teaCarryLoad: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('wood', 1.9 * s, 0.07 * s, 0.07 * s, x, y + 1.36 * s, z, BAMBOO, 0, 0, 0.03);
  for (const sx of [-1, 1]) b.box('fabric', 0.02 * s, 0.36 * s, 0.02 * s, x + sx * 0.56 * s, y + 1.14 * s, z, HEMP);
  // 三脚歇架
  for (const [ox, oz] of [[-0.62, 0], [0.62, 0], [0, 0.44]] as const) {
    b.box('wood', 0.07 * s, 1.0 * s, 0.07 * s, x + ox * s, y + 0.5 * s, z + oz * s, shade(BAMBOO, 0.9), 0, 0, ox * 0.08);
  }
  b.box('wood', 1.44 * s, 0.06 * s, 0.06 * s, x, y + 0.72 * s, z, shade(BAMBOO, 0.94));
  // 一头：铜茶炉（热）+ 温茶桶
  b.cyl('metal', 0.17 * s, 0.14 * s, 0.26 * s, 6, x - 0.44 * s, y + 0.9 * s, z, shade(COPPER, 0.95));
  b.cyl('metal', 0.18 * s, 0.18 * s, 0.04 * s, 6, x - 0.44 * s, y + 1.04 * s, z, shade(COPPER, 1.16));
  b.box('glow', 0.12 * s, 0.04 * s, 0.12 * s, x - 0.44 * s, y + 0.78 * s, z + 0.12 * s, 0xff7f50);
  b.cyl('wood', 0.22 * s, 0.2 * s, 0.3 * s, 8, x - 0.44 * s, y + 1.22 * s, z, shade(BAMBOO_L, 0.94), 0, 0, 0, true);
  b.cyl('wood', 0.23 * s, 0.23 * s, 0.04 * s, 8, x - 0.44 * s, y + 1.38 * s, z, shade(BAMBOO, 0.86));
  b.cyl('metal', 0.035 * s, 0.045 * s, 0.3 * s, 5, x - 0.2 * s, y + 1.18 * s, z + 0.06 * s, shade(COPPER, 1.05), 0, Math.PI / 2, 0);
  // 一头：青瓷凉茶桶 + 碗摞 + 竹勺
  b.cyl('ceramic', 0.24 * s, 0.21 * s, 0.44 * s, 8, x + 0.46 * s, y + 1.0 * s, z, 0x6a7a6a);
  b.cyl('ceramic', 0.25 * s, 0.25 * s, 0.05 * s, 8, x + 0.46 * s, y + 1.24 * s, z, 0x8a9a8a);
  for (let i = 0; i < 3; i++) b.cyl('ceramic', 0.1 * s, 0.085 * s, 0.06 * s, 6, x + 0.46 * s, y + 1.3 * s + i * 0.055 * s, z - 0.3 * s, shade(0xd8d8d0, 0.94 + i * 0.03));
  b.cyl('wood', 0.02 * s, 0.025 * s, 0.36 * s, 5, x + 0.72 * s, y + 1.18 * s, z, shade(BAMBOO_L, 1.02), 0, 0, 0.4);
  // 担头两只茶幌小牌
  for (const sx of [-1, 1]) b.box('fabric', 0.16 * s, 0.22 * s, 0.02 * s, x + sx * 0.94 * s, y + 1.16 * s, z, sx < 0 ? 0xd8c8a0 : 0xb8c8b8);
  b.kit('item.renjian.teaCarryLoad', 1, y);
};

/** 后灶：C-ITM-0455（砖土 · 1 座 · 小店后灶间）——土坯单眼灶、灰陶锅、灶门余烬、灶边柴堆与火钳 */
export const backStove: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('earth', 1.35 * s, 0.72 * s, 0.95 * s, x, y + 0.36 * s, z, shade(0x9a8264, 1.0));
  b.box('earth', 1.42 * s, 0.1 * s, 1.0 * s, x, y + 0.77 * s, z, shade(0x8a7254, 1.08));
  b.cyl('ceramic', 0.3 * s, 0.24 * s, 0.26 * s, 10, x, y + 0.92 * s, z, GRAYCERAMIC);
  b.cyl('ceramic', 0.32 * s, 0.32 * s, 0.03 * s, 10, x, y + 1.06 * s, z, shade(GRAYCERAMIC, 1.12));
  b.box('trunk', 0.34 * s, 0.2 * s, 0.06 * s, x, y + 0.22 * s, z + 0.49 * s, 0x1c1410);
  b.box('glow', 0.26 * s, 0.1 * s, 0.05 * s, x, y + 0.21 * s, z + 0.51 * s, 0xff7a2a);
  for (let i = 0; i < 4; i++) {
    b.box('wood', 0.54 * s, 0.09 * s, 0.15 * s, x + 0.94 * s, y + 0.06 * s + (i % 2) * 0.09 * s, z + (i - 1.5) * 0.17 * s, shade(0x6b4a2b, 0.9 + (i % 3) * 0.08), i * 0.18);
  }
  b.box('metal', 0.42 * s, 0.03 * s, 0.03 * s, x - 0.3 * s, y + 0.78 * s, z + 0.4 * s, IRONBLK, 0, 0, 0.34);
  b.kit('item.renjian.backStove', 1, y);
};

/** 宅匾「積善堂」：C-ITM-0401（木金漆 · 1 面 · 宅院正房）——黑漆匾板、金地三字、双匝金边、铜挂环 */
export const hallPlaque: ItemBuilder = (b, x, y, z, s = 1) => {
  b.box('lacquer', 3.3 * s, 0.96 * s, 0.1 * s, x, y, z, 0x1c1c22);
  b.box('wood', 3.5 * s, 1.12 * s, 0.06 * s, x, y, z - 0.05 * s, OILWOOD);
  b.box('metal', 3.3 * s, 0.07 * s, 0.14 * s, x, y + 0.5 * s, z + 0.01 * s, GILTCU);
  b.box('metal', 3.3 * s, 0.07 * s, 0.14 * s, x, y - 0.5 * s, z + 0.01 * s, GILTCU);
  for (const sx of [-1, 1]) b.box('metal', 0.07 * s, 1.12 * s, 0.14 * s, x + sx * 1.65 * s, y, z + 0.01 * s, GILTCU);
  // 三字金地（「積」「善」「堂」字牌位；匾文由 interiors.ts 的 SignMesher 逐字落版）
  for (let i = 0; i < 3; i++) {
    b.box('metal', 0.78 * s, 0.62 * s, 0.03 * s, x - 0.96 * s + i * 0.96 * s, y, z + 0.075 * s, shade(GOLD, 0.96 + i * 0.04));
    b.box('metal', 0.62 * s, 0.05 * s, 0.035 * s, x - 0.96 * s + i * 0.96 * s, y + 0.2 * s, z + 0.095 * s, shade(GOLD, 0.72));
  }
  for (const sx of [-1, 1]) b.box('metal', 0.07 * s, 0.07 * s, 0.07 * s, x + sx * 1.2 * s, y + 0.46 * s, z - 0.09 * s, GILTCU);
  b.kit('item.renjian.hallPlaque', 1, y);
};
