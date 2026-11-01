import * as THREE from 'three';
import { Baker, shade } from '../city/bake';
import { roofOn } from '../city/buildings';
import { RNG } from '../core/rng';

// ============ 仙界装点：「如果有仙界」风——浮岛瀑布/彩虹/光柱/仙鹤群/瑶池 ============
export function beautifyHeaven(b: Baker, scene: THREE.Scene, rng: RNG): THREE.Vector3[] {
  const falls: THREE.Vector3[] = [];
  // ---- 三座浮岛（云瀑垂落） ----
  const islands: [number, number, number, number][] = [
    [-268, 216, -30, 15], [268, 220, 50, 17], [70, 224, -130, 13],
  ];
  for (const [x, y, z, r] of islands) {
    b.cyl('wall', r, r * 0.55, 5, 14, x, y - 2.5, z, 0x9a8a68);
    b.cyl('wall', r * 0.55, r * 0.2, 5, 10, x, y - 7.5, z, 0x7a6a50);
    // 岛缘金圈（最大 r=17 → 34m 环）：全量复查已排除——藏掉整组 glow 该机位白像素 1007→1007，
    // 0xffd25e 线性亮度 0.69、深夜 ×1.18 = 0.81 未过 1.05 阈值，实测不起晕。保持原值。
    b.cyl('glow', r, r, 0.14, 14, x, y + 0.06, z, 0xffd25e, 0, 0, 0, true);
    // 岛上发光神树
    b.cyl('trunk', 0.24, 0.5, 4.6, 5, x + r * 0.2, y + 2.3, z, 0x5a4028);
    b.cyl('leaf', 1.3, 2.6, 3.0, 7, x + r * 0.2, y + 5.4, z, shade(0xffd25e, 0.95));
    // 0xfff2c8 线性亮度 0.886，deep 档 ×1.18 = 1.046，压在阈值 1.05 之下（实测未起晕），保持原值。
    b.box('glow', 0.3, 0.3, 0.3, x + r * 0.2, y + 4.2, z, 0xfff2c8, 0, 0, Math.PI / 4);
    // 小亭
    b.box('wood', 3.4, 0.3, 3.4, x - r * 0.25, y + 2.1, z + 2, 0x8a6a3e);
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as const) {
      b.box('wood', 0.2, 2.4, 0.2, x - r * 0.25 + ox, y + 3.3, z + 2 + oz, 0x6a4a2a);
    }
    roofOn(b, 5, 5, y + 4.4, x - r * 0.25, z + 2, 0, shade(0x9a7a32, 1.05), 0xffd25e);
    // 云瀑（粒子源在岛缘，由 world 在 vfx 建立后注入）
    falls.push(new THREE.Vector3(x, y - 1, z + r * 0.55));
    falls.push(new THREE.Vector3(x - r * 0.5, y - 1, z - r * 0.3));
  }
  // ---- 彩虹拱桥 / 天光光柱：整段删除 ----
  // 这两样都是 toneMapped:false 的加性发光体，直接叠在凌霄殿上空：
  // 光柱四束从 y=150 起、高 110–140，锥体正好穿过后殿屋面，近景就是一排白亮条；
  // 彩虹是 27 段加性 glow 盒，横贯殿顶。用户连续两次报"过曝的反光"都是它们，
  // 而 10 卷设定里 凌霄殿只有"脊中宝顶接天光"，没有满地光柱。整段移除。
  // ---- 仙鹤群（远景区静态翔姿） ----
  for (let i = 0; i < 7; i++) {
    const x = rng.range(-220, 240), y = rng.range(212, 236), z = rng.range(-120, 150);
    const yaw = rng.range(0, 6.28);
    // 0xe8f0f4 线性亮度 0.856、深夜 ×1.18 = 1.01，未过阈值（实测藏 glow 该机位白像素不变），保持原值。
    const white = 0xe8f0f4;
    b.box('glow', 0.5, 0.4, 1.1, x, y, z, white, yaw);
    b.box('glow', 0.14, 0.14, 0.5, x + Math.sin(yaw) * 0.5, y + 0.28, z + Math.cos(yaw) * 0.5, white, yaw);
    b.box('glow', 1.4, 0.08, 0.4, x - Math.cos(yaw) * 0.2, y + 0.18, z - Math.sin(yaw) * 0.2, shade(0xdde8f0, 1), yaw, 0, 0.3);
    b.box('glow', 1.4, 0.08, 0.4, x + Math.cos(yaw) * 0.2, y + 0.18, z + Math.sin(yaw) * 0.2, shade(0xdde8f0, 1), yaw, 0, -0.3);
  }
  // ---- 瑶池（月台旁莲池） ----
  const px = 40, pz = -30, py = 209;
  // 池沿白玉在 2.1 的天宫主光下线性亮度 ~1.3（>1 即裁白），俯视整圈读成一块白盘；
  // 压到 0xc4b083（线性 0.47 → 受光 ~0.99）保住石纹明暗。
  b.cyl('wall', 7, 7.4, 0.7, 16, px, py + 0.35, pz, shade(0xc4b083, 1));
  // 青绿光面：r 6.2 → 4.4（面积 −50%），色 0x7dffd8 → 0x63d4bd（线性亮度 0.727→0.56），
  // 与池沿之间留出 1.0–1.8m 的暗环，避免「白圈 + 亮盘」叠成一整块爆白。
  b.cyl('glow', 4.4, 4.4, 0.1, 16, px, py + 0.66, pz, 0x63d4bd, 0, 0, 0, true);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box('wall', 0.7, 0.5, 1.2, px + Math.cos(a) * 4.6, py + 1.0, pz + Math.sin(a) * 4.6, i % 2 ? shade(0xffb8d8, 1) : shade(0xd8a8c8, 1), -a + Math.PI / 2, 0, 0.2);
  }
  b.box('glow', 0.5, 0.5, 0.5, px, py + 2.4, pz, 0xe0b45a, 0, 0, Math.PI / 4);
  return falls;
}
