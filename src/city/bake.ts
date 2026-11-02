import * as THREE from 'three';

// ============ 几何烘焙器：整座静态城市合并为 7 个 draw call ============
export type BGroup = 'wood' | 'wall' | 'ash' | 'earth' | 'roof' | 'ground' | 'glow' | 'leaf' | 'trunk' | 'water' | 'ceramic' | 'metal' | 'fabric' | 'lacquer';

// ---- 程序化纹理（筒瓦/斑驳墙/夯土）----
function canvasTex(draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCityTextures(): { wallTex: THREE.CanvasTexture; roofTex: THREE.CanvasTexture; groundTex: THREE.CanvasTexture; roofNormal: THREE.CanvasTexture; wallNormal: THREE.CanvasTexture; roofAuxGen: THREE.CanvasTexture; groundNormalGen: THREE.CanvasTexture; woodTex: THREE.CanvasTexture; woodNormal: THREE.CanvasTexture } {
  // 墙面贴图必须「可平铺」：这张图按 0.24/m 的 UV 密度铺，一堵 10m 高的墙会重复 2.4 次，
  // 任何只在某一高度出现的横带（墙裙、横梁线、根部砖碱）都会在每个重复位置重印一遍，
  // 整面墙读成"横板条"。墙裙改由 buildBuilding 用几何体做，贴图只留均匀的粉刷肌理。
  const wallTex = canvasTex((ctx, s) => {
    ctx.fillStyle = '#f2ecdc'; ctx.fillRect(0, 0, s, s);
    // 粉刷云斑（大块明度变化，影视级墙面层次）
    for (let i = 0; i < 14; i++) {
      const g = ctx.createRadialGradient(Math.random() * s, Math.random() * s, 8, Math.random() * s, Math.random() * s, 60 + Math.random() * 90);
      g.addColorStop(0, `rgba(${210 + Math.random() * 30 | 0},${200 + Math.random() * 30 | 0},${175 + Math.random() * 30 | 0},0.16)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }
    // 雨渍竖纹（檐下挂黑）
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s, w2 = 1 + Math.random() * 2.5, len = s * (0.2 + Math.random() * 0.5);
      const g2 = ctx.createLinearGradient(0, 0, 0, len);
      g2.addColorStop(0, 'rgba(70,64,52,0.22)'); g2.addColorStop(1, 'rgba(70,64,52,0)');
      ctx.fillStyle = g2; ctx.fillRect(x, 0, w2, len);
    }
    // 斑驳污渍
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${100 + Math.random() * 60 | 0},${90 + Math.random() * 50 | 0},${60 + Math.random() * 40 | 0},${0.04 + Math.random() * 0.09})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 4 + Math.random() * 26, 3 + Math.random() * 18, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    // 竖向板缝（只有竖缝可平铺；横向木梁线会随平铺重复成"横板条"，已移除）
    for (let x = 0; x < s; x += 42) {
      ctx.fillStyle = 'rgba(80,70,50,0.22)';
      ctx.fillRect(x, 0, 1.5, s);
    }
  });
  // 瓦面贴图只做「明暗调制」，不再自带底色：底色由顶点色（C.tile 等）承担。
  // 旧版底 #5a6472（线性 0.10）× 瓦灰 #3b4045（线性 0.043）= 0.004 反射率，屋顶在黄昏下是纯黑板，
  // 瓦垄/瓦当/剪边全被吃掉。改为近白底，平均线性亮度 ≈0.78，最终色 = 顶点色 × 0.78。
  const roofTex = canvasTex((ctx, s) => {
    ctx.fillStyle = '#e8ebf0'; ctx.fillRect(0, 0, s, s);
    // 筒瓦垄行：深缝 + 瓦面中调 + 高光窄条
    const rows = 8, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      ctx.fillStyle = 'rgba(72,80,94,0.72)';
      ctx.fillRect(0, y, s, 3.4);
      for (let x = 0; x < s; x += 16) {
        const k = 0.94 + Math.random() * 0.06;
        ctx.fillStyle = `rgba(${(232 * k) | 0},${(236 * k) | 0},${(242 * k) | 0},0.95)`;
        ctx.beginPath();
        ctx.ellipse(x + 8, y + rh / 2 + 2, 6, rh / 2 - 2.5, 0, 0, 7);
        ctx.fill();
        // 釉面高光：只在瓦脊一侧提亮，绕屋一圈才有"反光带"而不是整片发白
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(x + 5, y + 4, 2.2, rh - 8);
        ctx.fillStyle = 'rgba(150,158,172,0.28)';
        ctx.fillRect(x + 11, y + 4, 1.6, rh - 8);
        // 瓦面 AO（每片瓦下缘压暗）
        ctx.fillStyle = 'rgba(88,96,110,0.45)';
        ctx.fillRect(x + 2, y + rh - 3, 12, 2);
      }
      // 苔痕（随机绿灰斑，集中在行缝）——只做极淡的色偏，避免屋顶发脏
      if (Math.random() < 0.6) {
        ctx.fillStyle = `rgba(${150 + Math.random() * 30 | 0},${168 + Math.random() * 30 | 0},${142 + Math.random() * 26 | 0},${0.06 + Math.random() * 0.08})`;
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, y + rh * (0.3 + Math.random() * 0.6), 5 + Math.random() * 16, 2 + Math.random() * 4, 0, 0, 7);
        ctx.fill();
      }
    }
    // 滴水瓦当行（底部一排圆形瓦当）
    for (let x = 8; x < s; x += 16) {
      ctx.fillStyle = 'rgba(236,240,246,0.95)';
      ctx.beginPath(); ctx.arc(x, s - 5, 5.2, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(96,104,118,0.75)';
      ctx.beginPath(); ctx.arc(x, s - 5, 2.6, 0, 7); ctx.fill();
    }
  });
  const groundTex = canvasTex((ctx, s) => {
    // 暖赭夯土基底（对抗暮色灰化）：中心亮四角暗的大尺度明度场
    const gg = ctx.createRadialGradient(s * 0.5, s * 0.5, s * 0.1, s * 0.5, s * 0.5, s * 0.75);
    gg.addColorStop(0, '#d4b088'); gg.addColorStop(0.6, '#c4a075'); gg.addColorStop(1, '#a98a62');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${90 + Math.random() * 70 | 0},${80 + Math.random() * 60 | 0},${50 + Math.random() * 40 | 0},${0.08 + Math.random() * 0.14})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 9, 2 + Math.random() * 6);
    }
    // 夯土层线
    for (let y = 0; y < s; y += 22) {
      ctx.fillStyle = 'rgba(60,50,36,0.18)';
      ctx.fillRect(0, y, s, 1.5);
    }
    // 车辙双道（磨亮）
    for (const ry of [s * 0.3, s * 0.62]) {
      ctx.fillStyle = 'rgba(120,104,78,0.3)';
      ctx.fillRect(0, ry, s, 5);
      ctx.fillStyle = 'rgba(60,50,36,0.25)';
      ctx.fillRect(0, ry + 5, s, 2);
    }
    // 碎石
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${140 + Math.random() * 60 | 0},${128 + Math.random() * 50 | 0},${104 + Math.random() * 40 | 0},0.5)`;
      ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, 0.8 + Math.random() * 1.6, 0, 7); ctx.fill();
    }
    // 石板网格（大板缝，破坏大片同色）
    const slab = s / 4;
    for (let gy2 = 0; gy2 <= 4; gy2++) {
      ctx.fillStyle = 'rgba(70,56,40,0.42)';
      ctx.fillRect(0, gy2 * slab - 1, s, 2.4);
      ctx.fillRect(gy2 * slab - 1, 0, 2.4, s);
    }
    // 深色污渍团（酒渍/泥点，打破均匀）
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(${60 + Math.random() * 30 | 0},${48 + Math.random() * 24 | 0},${32 + Math.random() * 18 | 0},${0.12 + Math.random() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 6 + Math.random() * 20, 4 + Math.random() * 14, Math.random() * 3, 0, 7);
      ctx.fill();
    }
  });
  // 法线贴图（从高度图计算，让表面有凹凸立体感）
  const makeNormal = (heightFn: (x: number, y: number) => number, size: number): THREE.CanvasTexture => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const H = (x: number, y: number) => heightFn((x + size) % size, (y + size) % size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const nx = (H(x - 1, y) - H(x + 1, y)) * 2.0;
      const ny = (H(x, y - 1) - H(x, y + 1)) * 2.0;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * size + x) * 4;
      img.data[idx] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };


  // —— 派生 PBR：从 albedo 亮度导出 AO，按材质语义生成粗糙度图（沙箱无外网二进制下载时的真实数据派生） ——
  const deriveAux = (src: THREE.CanvasTexture, roughLo: number, roughHi: number, aoStrength: number): { aoRough: THREE.CanvasTexture } => {
    const size = src.image.width;
    const sc = src.image.getContext('2d')!;
    const data = sc.getImageData(0, 0, size, size).data;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    // 亮度 → 32px 盒式模糊近似环境光遮蔽
    const lum = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -8; dy <= 8; dy += 4) for (let dx = -8; dx <= 8; dx += 4) {
        const xx = (x + dx + size) % size, yy = (y + dy + size) % size;
        sum += lum[yy * size + xx]; cnt++;
      }
      const avg = sum / cnt;
      const ao = 1 - aoStrength * (avg - lum[y * size + x] + 0.5) * 0.9;
      const rough = roughLo + (roughHi - roughLo) * (1 - lum[y * size + x]);
      const i4 = (y * size + x) * 4;
      img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = Math.max(0, Math.min(255, ao * 255));
      img.data[i4 + 3] = 255;
      // 借第二画布存粗糙度
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return { aoRough: t };
  };
  // 木纹纹理（顺纹条纹+节疤+年轮端面暗纹）
  const woodTex = canvasTex((ctx, s) => {
    ctx.fillStyle = '#8a6a44'; ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = `rgba(${100 + Math.random() * 50 | 0},${74 + Math.random() * 40 | 0},${44 + Math.random() * 26 | 0},${0.25 + Math.random() * 0.3})`;
      ctx.fillRect(x, 0, 1.6, s);
    }
    for (let i = 0; i < 10; i++) { // 节疤
      const kx = Math.random() * s, ky = Math.random() * s;
      for (let r = 7; r > 0; r -= 2) {
        ctx.fillStyle = `rgba(${70 + r * 6 | 0},${52 + r * 4 | 0},${30 + r * 3 | 0},0.5)`;
        ctx.beginPath(); ctx.ellipse(kx, ky, r, r * 0.6, 0, 0, 7); ctx.fill();
      }
    }
    for (let i = 0; i < 20; i++) { // 裂纹
      ctx.fillStyle = 'rgba(40,28,16,0.3)';
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 6 + Math.random() * 30);
    }
  });
  const woodNormal = makeNormal((x, y) => (Math.sin(x * 0.35) * 0.5 + 0.5) * 0.75 + (Math.sin(y * 0.04) * 0.5 + 0.5) * 0.25, 128);

  // 屋顶瓦垄法线：横向凹槽（瓦垄下陷、瓦面隆起）
  const roofNormal = makeNormal((x, y) => {
    const row = Math.sin(y * 0.196) * 0.5 + 0.5; // 每 16px 一行瓦垄
    const col = Math.sin(x * 0.393) * 0.3 + 0.5; // 竖向瓦缝
    return row * 0.7 + col * 0.3;
  }, 128);

  // 墙面法线：横向木梁凹凸 + 竖向板缝
  const wallNormal = makeNormal((x, y) => {
    const beam = Math.sin(y * 0.088) * 0.4 + 0.5; // 每 36px 一根梁
    const plank = Math.sin(x * 0.157) * 0.15 + 0.5; // 板缝
    return beam * 0.6 + plank * 0.4;
  }, 128);

    const roofAux = deriveAux(roofTex, 0.72, 0.95, 0.5);   // 瓦：高粗糙
  const groundAux = deriveAux(groundTex, 0.8, 1.0, 0.6); // 夯土：最高粗糙
  woodTex.anisotropy = 8; woodNormal.anisotropy = 8;
  wallTex.anisotropy = roofTex.anisotropy = groundTex.anisotropy = 8;
  wallNormal.anisotropy = roofNormal.anisotropy = 8;
  return { wallTex, roofTex, groundTex, roofNormal, wallNormal, woodTex, woodNormal, roofAuxGen: roofAux.aoRough, groundNormalGen: makeNormal((x, y) => (Math.sin(y * 0.11) * 0.5 + 0.5) * 0.7 + (Math.sin(x * 0.23) * 0.3 + 0.5) * 0.3, 128) };
}

// 给几何 UV 按世界尺寸缩放（让纹理密度一致）

// ============ 曲面屋顶单元：反宇曲线（脊→檐 y=1-t^1.6 + 檐口上挑 0.16t^3 + 角部起翘） ============
// 瓦垄是屋顶在 150m 外唯一还站得住的细节，但它撑不住贴图：push() 的 UV 按几何尺寸缩放，
// 224m 大殿的 1024px 瓦纹要重复两百多遍，一片瓦不到 1.5cm，早被 mip 抹成一块灰。
// 故把「垄顶 / 瓦沟」烘进顶点色：只改明暗、法线原样，远景不会因法线抖动起摩尔纹。
/** 一垄筒瓦的世界间距（m）。宋式垄距 0.28–0.35，取 0.34：224m 紫宸殿在 150m 外仍有 ≈2.4px 垄纹 */
export const ROOF_RIB_PITCH = 0.34;
// 垄顶/瓦沟的明暗差：0.78/1.24 在 25–60m 的街面距离上被贴图与雾吃掉，实测读成一整片灰。
// 拉到 0.66/1.38（±35%）后，0.34m 垄距在 40m 处仍有可辨的竖纹，且不改变法线、不产生摩尔纹。
const RIB_HI = 1.38, RIB_LO = 0.66;   // 垄顶 / 瓦沟相对瓦面的明暗乘子
const RIB_MID = (RIB_HI + RIB_LO) / 2;
const RIB_AMP = (RIB_HI - RIB_LO) / 2;
const RING_N = 6;          // 脊→檐环数（表达反宇曲线；纹理由列数承担，环数不动）
const RIDGE_HALF = 0.16;   // 正脊半宽（单元尺度）
const UNIT_KICK = 0.16;    // 檐口上挑系数 0.16t³（与 RIDGE_HALF 数值巧合相同，语义不同）
const UNIT_DZ_DT = 0.544;  // t=1 处 dz/dt = 0.34×1.6
const UNIT_DY_DT = 1.12;   // t=1 处 |dy/dt| = 1.6-0.48
const CORNER_RISE = 0.15;  // 角部起翘 0.15t²u²

/** 面阔 → 瓦垄列数。两个约束：
 *  ① 一个垄周期至少两列，否则列距正好等于垄距、每个顶点都落在波峰上，整片屋顶退回纯色；
 *  ② 列数取偶数，保证 u=0 恰好落在一列上（相位 0=垄顶），左右对称、不会因半列偏移整体衰减。 */
export function roofRibCols(worldW: number): number {
  const half = Math.max(5, Math.min(768, Math.round(worldW / ROOF_RIB_PITCH)));
  return half * 2;
}

/**
 * 屋顶纵向剖面（脊→檐）。旧式 y = 1 − t^1.6 是**凹**的：靠脊一大片几乎水平、到檐口才猛降，
 * 于是所有屋顶都读成"平顶 + 斜边"（用户反复说"房顶不对"就是这个）。
 * 宋式反宇是**上陡下缓**：脊附近最陡，临近檐口才转平。改用 (1−t)^1.35。
 * 全工程只有这一处定义真源：bake / buildings / palace 三处几何都必须调它，脊与瓦面才不脱开。
 */
export const roofProfile = (t: number): number => Math.pow(1 - t, 1.35);

let _curvedUnit: THREE.BufferGeometry | null = null;

/** 造一片曲面屋顶单元。K=瓦垄列数（沿面阔），worldW/worldD=世界面阔/进深（m，0 表示不烘条纹，
 *  UV 退回 0..3）。UV 必须按世界尺寸展开：push() 的 scaleGeoUV 是给 6 面 box 写的（按 i/4 分组选面），
 *  套到几千个三角面的曲面单元上会按顶点序号乱乘尺寸，瓦纹被压成一格 1m 以内的噪点，整片屋顶糊成塑料板。 */
function buildCurvedUnit(K: number, worldW: number, worldD = 0): THREE.BufferGeometry {
  const N = RING_N, RIDGE = RIDGE_HALF;
  const ease = (t: number): number => Math.pow(t, 1.6);
  // 一张瓦纹贴图铺多少米：贴图内 8 行 × 16 列 → 0.4m 一行、0.2m 一列（宋式筒瓦板瓦量级）
  const UV_TILE = 3.2;
  const su = worldW > 0 ? worldW / UV_TILE : 3;
  const sv = worldD > 0 ? worldD / UV_TILE : 3;
  // 顶点数在结构上是定值：两侧各 N 圈 × K 列 × 6 顶点，加脊顶盖 K × 6。
  // 旧实现用 number[] 的 spread push，且每个四边面要先造 4 个角数组 + 8 个 UV 数组；
  // 一片 16m 瓦顶就是 1128 个四边面 ≈ 1.3 万次小数组分配，全城 1368 片瓦顶合计上千万次。
  const nVerts = (2 * N + 1) * K * 6;
  const pos = new Float32Array(nVerts * 3);
  const uv = new Float32Array(nVerts * 2);
  const ribOn = worldW > 0;
  const k2pi = (2 * Math.PI) / ROOF_RIB_PITCH;
  const col = ribOn ? new Float32Array(nVerts * 3) : null;
  let pi = 0, ui = 0;
  /** 落一个顶点。瓦垄明暗用写入前的 double x 计算（与原实现读 number[] 的精度一致）。 */
  const vert = (px: number, py: number, pz: number, u: number, v: number, c: number): void => {
    pos[pi] = px; pos[pi + 1] = py; pos[pi + 2] = pz;
    if (col) { col[pi] = c; col[pi + 1] = c; col[pi + 2] = c; }
    pi += 3;
    uv[ui++] = u; uv[ui++] = v;
  };
  /** 一个环的瓦垄明暗行：只取决于该环各列的 x，与左右两侧无关，故每环算 K+1 次而不是每顶点一次 */
  const ribRow = (sx: number[]): Float32Array => {
    const r = new Float32Array(K + 1);
    for (let k = 0; k <= K; k++) r[k] = RIB_MID + RIB_AMP * Math.cos(sx[k] * worldW * k2pi);
    return r;
  };
  const ONE = 1;
  const ring = (t: number, side: 1 | -1): { hx: number; hz: number; ys: number[]; sx: number[]; us: number[] } => {
    const e = ease(t);
    const hx = RIDGE + (0.5 - RIDGE) * e;
    const hz = RIDGE + (0.5 - RIDGE) * e;
    const yBase = roofProfile(t);
    const kick = UNIT_KICK * Math.pow(t, 3);
    const ys: number[] = [], sx: number[] = [], us: number[] = [];
    for (let k = 0; k <= K; k++) {
      const u = -1 + (2 * k) / K;
      const corner = CORNER_RISE * t * t * u * u;
      ys.push(Math.max(0.02, yBase + kick + corner));
      sx.push(u * hx);
      us.push((k / K) * su);
    }
    return { hx, hz: hz * side, ys, sx, us };
  };
  const sides: (1 | -1)[] = [1, -1];
  for (const side of sides) {
    let prev = ring(0, side);
    let prevRow = ribOn ? ribRow(prev.sx) : null;
    for (let j = 1; j <= N; j++) {
      const cur = ring(j / N, side);
      const curRow = ribOn ? ribRow(cur.sx) : null;
      const vPrev = (1 - (j - 1) / N) * sv, vCur = (1 - j / N) * sv;
      for (let k = 0; k < K; k++) {
        const uA = (k / K) * su, uB = ((k + 1) / K) * su;
        const ca = prevRow ? prevRow[k] : ONE, cb = curRow ? curRow[k] : ONE;
        const cc = curRow ? curRow[k + 1] : ONE, cd = prevRow ? prevRow[k + 1] : ONE;
        const ax = prev.sx[k], ay = prev.ys[k], az = prev.hz;
        const bx = cur.sx[k], by = cur.ys[k], bz = cur.hz;
        const cx = cur.sx[k + 1], cy2 = cur.ys[k + 1];
        const dx = prev.sx[k + 1], dy = prev.ys[k + 1];
        if (side === 1) {
          vert(ax, ay, az, uA, vPrev, ca);   // a  + cur2uv(k, j-1)
          vert(bx, by, bz, uA, vCur, cb);    // b2 + cur2uv(k, j)
          vert(cx, cy2, bz, uB, vCur, cc);   // c2 + cur2uv(k+1, j)
          vert(ax, ay, az, uA, vPrev, ca);
          vert(cx, cy2, bz, uB, vCur, cc);
          vert(dx, dy, az, uB, vPrev, cd);   // d2 + cur2uv(k+1, j-1)
        } else {
          vert(dx, dy, az, uB, vPrev, cd);   // d2 + cur2uv(k+1, j-1)
          vert(cx, cy2, bz, uB, vCur, cc);
          vert(bx, by, bz, uA, vCur, cb);
          vert(dx, dy, az, uB, vPrev, cd);
          vert(bx, by, bz, uA, vCur, cb);
          vert(ax, ay, az, uA, vPrev, ca);
        }
      }
      prev = cur;
      prevRow = curRow;
    }
  }
  // 脊顶盖（前后 ring0 之间的平条）：借用贴图的瓦当面行，v 落在最后一格
  const f0 = ring(0, 1), b0 = ring(0, -1);
  const capRow = ribOn ? ribRow(f0.sx) : null;
  const capC = (k: number): number => (capRow ? capRow[k] : ONE);
  const capU = (k: number): number => f0.us[k];
  const capV = (k: number): number => b0.us[k];
  // 绕序：cap 的水平法线必须朝上（+Y）。旧序 (f0,b0,b0') 算出来是 (0,−1,0)——
  // 全城 1367 顶曲面屋顶的正脊盖都是背面，靠 DoubleSide 才没露馅；改序后法线转正。
  for (let k = 0; k < K; k++) {
    vert(f0.sx[k], 1, f0.hz, capU(k), sv * 0.94, capC(k));
    vert(b0.sx[k + 1], 1, b0.hz, capV(k + 1), sv * 0.86, capC(k + 1));
    vert(b0.sx[k], 1, b0.hz, capV(k), sv * 0.86, capC(k));
    vert(f0.sx[k], 1, f0.hz, capU(k), sv * 0.94, capC(k));
    vert(f0.sx[k + 1], 1, f0.hz, capU(k + 1), sv * 0.94, capC(k + 1));
    vert(b0.sx[k + 1], 1, b0.hz, capV(k + 1), sv * 0.86, capC(k + 1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 无条纹的共享单元（小棚屋/非 roof 组用），调用方 clone 后交给 push */
export function curvedRoofUnit(): THREE.BufferGeometry {
  if (!_curvedUnit) _curvedUnit = buildCurvedUnit(9, 0);
  return _curvedUnit;
}

function scaleGeoUV(geo: THREE.BufferGeometry, uvScale: number, dims?: [number, number, number]): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  if (!uv) return;
  const faceDims: [number, number][] = dims
    ? [[dims[2], dims[1]], [dims[2], dims[1]], [dims[0], dims[2]], [dims[0], dims[2]], [dims[0], dims[1]], [dims[0], dims[1]]]
    : [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]];
  for (let i = 0; i < uv.count; i++) {
    const f = Math.floor(i / 4);
    const fd = faceDims[Math.min(f, 5)];
    uv.setXY(i, uv.getX(i) * fd[0] * uvScale, uv.getY(i) * fd[1] * uvScale);
  }
}

/**
 * 顶点缓冲：可增长的 Float32Array。
 * 旧实现用 `number[]`，一个三角面要占 ~320B（3 顶点 ×(pos3+normal3+color3+uv2) 个 JS number，
 * 加上动态数组 1.5 倍预留）。全城 10.4M 面 = 3.3GB 堆，V8 进 GC 悬崖后主线程直接停摆，
 * 外部表现就是「加载卡住、loading 永不消失」。Float32Array 把同样内容压到 ~132B/面，
 * 且不产生可回收的临时对象，push 循环里也没有数组扩容抖动。
 */
class FBuf {
  a = new Float32Array(4096);
  n = 0;
  /** 与旧 `number[]` 接口兼容：只读长度（测试与调试代码按 .length 断言顶点数） */
  get length(): number {
    return this.n;
  }
  push1(x: number): void {
    if (this.n + 1 > this.a.length) this.grow(1);
    this.a[this.n++] = x;
  }
  push2(x: number, y: number): void {
    if (this.n + 2 > this.a.length) this.grow(2);
    this.a[this.n++] = x; this.a[this.n++] = y;
  }
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) this.grow(3);
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  /** 预留 n 个槽位。批量写入前调一次，之后的直写循环就不必逐次判界（扩容会换掉 a） */
  reserve(need: number): void {
    if (this.n + need > this.a.length) this.grow(need);
  }
  private grow(need: number): void {
    let cap = this.a.length * 2;
    while (cap < this.n + need) cap *= 2;
    const b = new Float32Array(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  /** 交付给几何用的定长副本（slice 而不是 subarray：subarray 会把扩容后的整块后备内存钉住） */
  take(): Float32Array {
    return this.a.slice(0, this.n);
  }
  reset(): void {
    this.a = new Float32Array(4096);
    this.n = 0;
  }
}

/**
 * 量化顶点缓冲：法线 Int16、顶点色 Uint16（都以 normalized 上传，GPU 端照旧读作 float）。
 *
 * 为什么只动这两条：位置是 ±16km 的世界坐标、UV 最大到 300+ 张平铺（224m 屋面 / 3.2m 一瓦），
 * 这两个降精度是真的改几何、改贴图采样；而法线与顶点色只进着色，量化步长 1/32767 与 1/65535
 * 比 8bit 输出量化（1/255）细两个数量级，画面读不出差别。
 *
 * 账（全城 40.06M 顶点，`?attrAudit=1` 实测误差见 probe 输出）：
 *   旧：pos 12 + normal 12 + color 12 (+ uv 8) = 44B/顶点
 *   新：pos 12 + normal  6 + color  6 (+ uv 8) = 28B/顶点   →  40.06M × 16B ≈ 640MB
 * 去掉 UV 组的 10 个组，实际省 ~480MB 常驻堆。
 */
export const NORM_Q = 32767;
export const COL_Q = 65535;

class QBuf {
  a: Int16Array | Uint16Array;
  n = 0;
  private readonly q: number;
  private readonly signed: boolean;
  constructor(signed: boolean) {
    this.signed = signed;
    this.q = signed ? NORM_Q : COL_Q;
    this.a = signed ? new Int16Array(4096) : new Uint16Array(4096);
  }
  reserve(need: number): void {
    if (this.n + need > this.a.length) this.grow(need);
  }
  private grow(need: number): void {
    let cap = this.a.length * 2;
    while (cap < this.n + need) cap *= 2;
    const b = this.signed ? new Int16Array(cap) : new Uint16Array(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  /** 量化写三个分量。signed 时钳到 ±NORM_Q（normalized SHORT 的 1.0 就是 32767） */
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) this.grow(3);
    const q = this.q;
    if (this.signed) {
      const a = this.a as Int16Array;
      a[this.n++] = x >= 1 ? NORM_Q : x <= -1 ? -NORM_Q : (x * q + (x < 0 ? -0.5 : 0.5)) | 0;
      a[this.n++] = y >= 1 ? NORM_Q : y <= -1 ? -NORM_Q : (y * q + (y < 0 ? -0.5 : 0.5)) | 0;
      a[this.n++] = z >= 1 ? NORM_Q : z <= -1 ? -NORM_Q : (z * q + (z < 0 ? -0.5 : 0.5)) | 0;
    } else {
      const a = this.a as Uint16Array;
      a[this.n++] = x <= 0 ? 0 : x >= 1 ? COL_Q : (x * q + 0.5) | 0;
      a[this.n++] = y <= 0 ? 0 : y >= 1 ? COL_Q : (y * q + 0.5) | 0;
      a[this.n++] = z <= 0 ? 0 : z >= 1 ? COL_Q : (z * q + 0.5) | 0;
    }
  }
  take(): Int16Array | Uint16Array {
    return this.signed ? (this.a as Int16Array).slice(0, this.n) : (this.a as Uint16Array).slice(0, this.n);
  }
  reset(): void {
    this.a = this.signed ? new Int16Array(4096) : new Uint16Array(4096);
    this.n = 0;
  }
}

interface Buf { p: FBuf; n: QBuf; c: QBuf; uv?: FBuf }

const _m4 = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();
const _qYaw = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
/** 盒体 8 个角：下标 = sx | sy<<1 | sz<<2（+ 侧为 1）。6 个面各 4 角，顺序与 three
 *  BoxGeometry.buildPlane 的 (ix,iy) 网格逐面对齐（px,nx,py,ny,pz,nz）。 */
const BOX_FACE_CORNERS = [7, 3, 5, 1, 2, 6, 0, 4, 2, 3, 6, 7, 4, 5, 0, 1, 6, 7, 4, 5, 3, 2, 1, 0];
/** 单段平面的三角索引顺序：(a,b,d),(b,c,d) → 角序 0,2,1,2,3,1（与 indices.push 一致） */
const BOX_TRI_ORDER = [0, 2, 1, 2, 3, 1];
/** 盒体快路径的角坐标缓存（世界系）：8 角 × 3 */
const _bxCorner = new Float64Array(24);
/** 盒体快路径的逐角最终色（底色 × AO），量化到 Uint16：8 角 × 3 分量 */
const _bxCq = new Uint16Array(24);
/** 顶点色量化：0..1 → 0..65535（normalized UNSIGNED_SHORT） */
const colQ = (t: number): number => (t <= 0 ? 0 : t >= 1 ? COL_Q : (t * COL_Q + 0.5) | 0);
/** 法线量化：−1..1 → −32767..32767（normalized SHORT；1.0 在 normalized SHORT 里就是 32767） */
const normQ = (t: number): number => (t >= 1 ? NORM_Q : t <= -1 ? -NORM_Q : (t * NORM_Q + (t < 0 ? -0.5 : 0.5)) | 0);

/** 盒体去重键：把 10 个参数按 float32 位模式混成 52 位整数（位模式完全相同才算重合） */
const _kf = new Float32Array(10);
const _ku = new Uint32Array(_kf.buffer);
function boxKey(g: BGroup, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry: number, rx: number, rz: number): number {
  _kf[0] = w; _kf[1] = h; _kf[2] = d; _kf[3] = x; _kf[4] = y;
  _kf[5] = z; _kf[6] = hex; _kf[7] = ry; _kf[8] = rx; _kf[9] = rz;
  let h1 = (0x811c9dc5 ^ (g.length * 131 + g.charCodeAt(0))) >>> 0;
  let h2 = (0x9e3779b9 ^ g.charCodeAt(0)) >>> 0;
  for (let i = 0; i < 10; i++) {
    const v = _ku[i];
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = Math.imul(h2 ^ v, 2246822519);
    h2 = (h2 << 13) | (h2 >>> 19);
  }
  return (h1 >>> 0) * 0x100000 + ((h2 >>> 0) & 0xfffff);
}

/** 底面剔除总闸（?nocull=1 关掉，用于 A/B 与回退；默认开） */
let cullBottomOn = typeof window === 'undefined' || !/[?&]nocull=1/.test(window.location.search);
/** 测试/诊断用开关：让同一个进程里能跑「6 面 / 5 面」两条路径做逐字节比对。正式构建不调用 */
export function setCullBottom(v: boolean): void {
  cullBottomOn = v;
}
/** 盒体诊断（?boxAudit=1）：底面可剔率与重复率台账，正式构建零开销 */
const BOX_AUDIT = typeof window !== 'undefined' && /[?&]boxAudit=1/.test(window.location.search);
/** 诊断开关（?noRib=1）：不落「粗垄」类薄板（roof 组、0.055 厚、带 rx 的盒子），用于确认薄片归属 */
const NO_RIB = typeof window !== 'undefined' && /[?&]noRib=1/.test(window.location.search);
/** 诊断开关（?noTrim=1）：不落檐口三件套（剪边/瓦当/滴水），用于确认薄片归属 */
const NO_TRIM = typeof window !== 'undefined' && /[?&]noTrim=1/.test(window.location.search);
/** 对照开关（?roofOld=1）：关掉"直条下压"，复现修复前的屋面（前后对照图用） */
const ROOF_OLD = typeof window !== 'undefined' && /[?&]roofOld=1/.test(window.location.search);
/** 审计用的三个模块级临时对象（sinkRib 专用，避免每次分配） */
const _e2 = new THREE.Euler();
const _q2 = new THREE.Quaternion();
const _v2 = new THREE.Vector3();
const _s2 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _m4b = new THREE.Matrix4();
const _m4c = new THREE.Matrix4();
export function shade(hex: number, k: number): number {
  _col.setHex(hex);
  _col.r = THREE.MathUtils.clamp(_col.r * k, 0, 1);
  _col.g = THREE.MathUtils.clamp(_col.g * k, 0, 1);
  _col.b = THREE.MathUtils.clamp(_col.b * k, 0, 1);
  return _col.getHex();
}

export interface BakerStats {
  groups: Record<BGroup, { vertices: number; triangles: number }>;
  detail: Record<string, number>;
  detailBounds: Record<string, { minY: number; maxY: number }>;
}

// 调试开关：?traceGlow=1 时记录每个 glow 盒体的世界坐标与调用栈，
// 用于把"某处发光伪影"定位到具体绘制语句（正式构建无额外开销）
const TRACE_GLOW = typeof window !== 'undefined' && /traceGlow=1/.test(window.location.search);
export interface GlowTrace { x: number; y: number; z: number; w: number; h: number; d: number; stack: string }
const glowTrace: GlowTrace[] = [];
if (TRACE_GLOW) (window as unknown as { __glowTrace: GlowTrace[] }).__glowTrace = glowTrace;

const UV_GROUPS = new Set<BGroup>(['wood', 'wall', 'ash', 'earth', 'roof', 'ground', 'ceramic', 'metal', 'fabric', 'lacquer']);

// ============ 屋面审计（?roofAudit=1）============
/**
 * 逐构件屋面台账。每条 = 一次落进 `roof` 组的 push/box 产生的世界 AABB，
 * 外加三个判据的原始计数：
 *   · `down` 面法线朝下的三角形数（ny < −0.25）——瓦面/脊/檐口都该朝上，朝下即翻面；
 *   · `out`  顶点超出「标称屋面包络」的最大世界距离（m）——曲面单元标称 x/z ∈ ±半跨、
 *            y ∈ [−0.3·举高, 1.3·举高]；超过 1.5m 说明某个生成式把构件甩出了屋顶；
 *   · `thin` AABB 最小边 < 0.32m 且最长边 > 0.8m —— 「薄片」形态，用来抓斜插出屋面的碎板。
 * 只在 URL 带 `?roofAudit=1` 时登记（正式构建不分配、不进分支）。
 */
export interface RoofPiece {
  kind: string;
  min: [number, number, number];
  max: [number, number, number];
  tri: number;
  down: number;
  out: number;
  thin: boolean;
  stack?: string;
  /** kind='roofC' 时带上这榀屋面的落位参数，供"薄板浮空"判据反算瓦面高度 */
  roof?: { x: number; y: number; z: number; ry: number; rx: number; rz: number; sx: number; sy: number; sz: number };
}
const ROOF_AUDIT = typeof window !== 'undefined' && /[?&]roofAudit=1/.test(window.location.search);
const roofPieces: RoofPiece[] = [];
if (ROOF_AUDIT) (window as unknown as { __roofPieces?: RoofPiece[] }).__roofPieces = roofPieces;

/** 薄片构件的调用点：只留 file:line，紧凑且足够定位 */
function roofCallSite(): string {
  const s = (new Error().stack ?? '').split(String.fromCharCode(10));
  const out: string[] = [];
  for (const line of s) {
    const m = /([\w./-]+\.tsx?)(?:\?[^:\s]*)?:(\d+):(\d+)/.exec(line);
    if (m) out.push(`${m[1].split('/').pop()}:${m[2]}`);
    if (out.length >= 6) break;
  }
  return out.join(' < ');
}

export interface RoofAuditSummary {
  pieces: number;
  /** 面法线朝下的三角形总数 */
  downTris: number;
  /** 含朝下三角形的构件数 */
  downPieces: number;
  /** 超出标称包络 > 1.5m 的构件数 */
  outPieces: number;
  /** 最远越界距离（m） */
  outMax: number;
  /** 薄片构件数（最小边 < 0.32m 且最长边 > 0.8m） */
  thinPieces: number;
  /** 薄片且雨棚上表面（y 高于其所在屋面脊线）——「斜插出屋面」的候选 */
  byKind: Record<string, { pieces: number; down: number; out: number; thin: number }>;
}

/** 汇总当前累积的屋面台账（探针/验收用） */export function roofAuditSummary(): RoofAuditSummary {
  const s: RoofAuditSummary = { pieces: 0, downTris: 0, downPieces: 0, outPieces: 0, outMax: 0, thinPieces: 0, byKind: {} };
  for (const p of roofPieces) {
    s.pieces++;
    s.downTris += p.down;
    if (p.down > 0) s.downPieces++;
    if (p.out > 1.5) s.outPieces++;
    if (p.out > s.outMax) s.outMax = p.out;
    if (p.thin) s.thinPieces++;
    const row = s.byKind[p.kind] ?? (s.byKind[p.kind] = { pieces: 0, down: 0, out: 0, thin: 0 });
    row.pieces++;
    row.down += p.down;
    if (p.out > 1.5) row.out++;
    if (p.thin) row.thin++;
  }
  return s;
}

/** 按世界点反查构件台账（探针归因用；命中半径 0.35m） */
export function roofPiecesAt(x: number, y: number, z: number, r = 0.35): RoofPiece[] {
  const out: RoofPiece[] = [];
  for (const p of roofPieces) {
    if (x < p.min[0] - r || x > p.max[0] + r) continue;
    if (y < p.min[1] - r || y > p.max[1] + r) continue;
    if (z < p.min[2] - r || z > p.max[2] + r) continue;
    out.push(p);
  }
  return out;
}

export class Baker {
  private buf: Record<BGroup, Buf> = {
    wood: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    wall: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    roof: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    ash: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    earth: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    ground: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    glow: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false) }, leaf: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false) },
    trunk: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false) }, water: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false) },
    ceramic: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() }, metal: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
    fabric: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() }, lacquer: { p: new FBuf(), n: new QBuf(true), c: new QBuf(false), uv: new FBuf() },
  };
  /** 已落盘（或已交付几何）的顶点总数：缓冲会被 flush 清空，累计量必须单独记，否则台账失真 */
  private emitted: Record<BGroup, number> = {} as Record<BGroup, number>;
  private mats: Record<BGroup, THREE.Material> | null = null;
  private batch = 0;
  /** 被越界守卫拒收的构件数（诊断用：正常构建应为 0） */
  rejected = 0;
  /** 诊断：ground 组暗顶点色的计数（最多打 6 条日志） */
  private darkGroundN = 0;
  /** 诊断：ground 构件台账（最终色/坐标/跨度），供探针按屏幕位置筛选 */
  readonly groundTrace: { hex: string; x: number; y: number; z: number; span: number; c: number[] }[] = [];
  readonly color = new THREE.Color();
  private detailCounts = new Map<string, number>();
  private detailBounds = new Map<string, { minY: number; maxY: number }>();
  /** 整组 180° 旋转枢轴：地标建筑按其落位朝向整体转向，避免逐行改坐标 */
  private yawPivot: { x: number; z: number } | null = null;
  /** 盒体诊断台账（?boxAudit=1 时填；正式构建 total 恒 0，无额外分配） */
  readonly boxAudit = {
    total: 0, cullable: 0, dup: 0, dupTris: 0,
    byGroup: {} as Record<string, { total: number; cullable: number; dup: number }>,
  };
  private dupSeen: Map<number, number> | null = null;

  /** 屋面审计的当前构件标签 / 是否按单位包络算越界（?roofAudit=1 时才有意义） */
  private roofKind = 'push';
  private roofAuditEnv = true;
  /** 最近若干榀曲面屋面的落位参数（粗垄/瓦垄那类"直条"薄板按它压回瓦面以下）。
   *  用环形缓冲而不是单个 lastRoof：铺面/院落常常先造完屋面再补饰件，中间可能又落了别的 roofC。 */
  private lastRoofs: { x: number; y: number; z: number; ry: number; rx: number; rz: number; sx: number; sy: number; sz: number }[] = [];

  /** 盒体逐调用台账：总数 / 底面可剔数 / 完全重合重复数（按组分开） */
  private auditBox(g: BGroup, cullable: boolean, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry: number, rx: number, rz: number): void {
    const A = this.boxAudit;
    A.total++;
    let row = A.byGroup[g];
    if (!row) row = A.byGroup[g] = { total: 0, cullable: 0, dup: 0 };
    row.total++;
    if (cullable) { A.cullable++; row.cullable++; }
    if (!this.dupSeen) {
      this.dupSeen = new Map();
      if (typeof window !== 'undefined') (window as unknown as { __boxAudit?: unknown }).__boxAudit = A;
    }
    const key = boxKey(g, w, h, d, x, y, z, hex, ry, rx, rz);
    const n = this.dupSeen.get(key);
    if (n === undefined) this.dupSeen.set(key, 1);
    else {
      this.dupSeen.set(key, n + 1);
      A.dup++; row.dup++;
      A.dupTris += cullable ? 10 : 12;
    }
  }

  yawAbout(x?: number, z?: number): void {
    this.yawPivot = typeof x === 'number' && typeof z === 'number' ? { x, z } : null;
  }

  kit(id: string, count = 1, y?: number): void {
    this.detailCounts.set(id, (this.detailCounts.get(id) ?? 0) + count);
    if (typeof y === 'number') {
      const b = this.detailBounds.get(id);
      this.detailBounds.set(id, b ? { minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) } : { minY: y, maxY: y });
    }
  }

  /** 取某材质组当前顶点坐标副本（调试/断言用，不影响烘焙） */
  positionsOf(g: BGroup): number[] {
    return Array.from(this.buf[g].p.a.subarray(0, this.buf[g].p.n));
  }

  stats(): BakerStats {
    const groups = {} as BakerStats['groups'];
    for (const key of Object.keys(this.buf) as BGroup[]) {
      const vertices = (this.emitted[key] ?? 0) / 3 + this.buf[key].p.n / 3;
      groups[key] = { vertices, triangles: vertices / 3 };
    }
    return {
      groups,
      detail: Object.fromEntries([...this.detailCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      detailBounds: Object.fromEntries([...this.detailBounds.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  private push(g: BGroup, geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, ry: number, rx: number, rz: number, sx = 1, sy = 1, sz = 1, uvDims?: [number, number, number]): void {
    const needsUv = UV_GROUPS.has(g);
    if (uvDims && needsUv) scaleGeoUV(geo, 0.24, uvDims);
    const src = geo.index ? geo.toNonIndexed() : geo;
    if (src !== geo) geo.dispose();
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    if (this.yawPivot) {
      _qYaw.setFromAxisAngle(_yAxis, Math.PI);
      _q.premultiply(_qYaw);
      x = 2 * this.yawPivot.x - x;
      z = 2 * this.yawPivot.z - z;
    }
    _v.set(x, y, z);
    _s.set(sx, sy, sz);
    _m4.compose(_v, _q, _s);
    // 局部 y 底部接触 AO（0.82→1.0）：在填充循环内按顶点施加，让每块构件落地有根
    src.computeBoundingBox();
    const bbAO = src.boundingBox!;
    // 越界守卫：单个构件的包围盒若超过 30km，基本可断定是某个尺寸参数写错（如 NaN 或漏乘 0.01），
    // 这样一个巨型面片会盖住整个画面且极难定位（fabric 组曾出现半径 218 万的异常包围球）。
    const _span = Math.max(
      Math.abs(bbAO.max.x), Math.abs(bbAO.min.x),
      Math.abs(bbAO.max.y), Math.abs(bbAO.min.y),
      Math.abs(bbAO.max.z), Math.abs(bbAO.min.z),
    );
    if (!Number.isFinite(_span) || _span > 30000 || Math.abs(x) > 30000 || Math.abs(z) > 30000 || Math.abs(y) > 8000) {
      // 拒收而不是只告警：一个 span=Infinity 的构件会形成覆盖全屏的巨型面片，
      // 且因为顶点是 NaN/无穷，它在任何材质下都是异常色（实测天宫画面那片灰白就是它）。
      this.rejected++;
      if (this.rejected <= 5) {
        console.warn(`[Baker] 拒收越界构件 ${g} span=${_span} at (${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)})`, new Error().stack?.split(String.fromCharCode(10)).slice(2, 5).join(' | '));
      }
      src.dispose();
      return;
    }
    // 世界包围盒（applyMatrix4 之后重算）：AO 的分子分母必须同一坐标系。
    // 旧实现分子是世界 y、分母是局部高度，曲面屋顶（y 7–9.6 / 局部高 1）kAO≈2.4，
    // 于是深灰瓦被抬成亮灰、瓦垄的 ±23% 明暗被压平——「屋顶是一整块灰平板」的着色根因。
    src.applyMatrix4(_m4);
    const p = src.getAttribute('position'), n = src.getAttribute('normal');
    let wMinY = Infinity, wMaxY = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i);
      if (yy < wMinY) wMinY = yy;
      if (yy > wMaxY) wMaxY = yy;
    }
    const wH = Math.max(0.001, wMaxY - wMinY);
    const uv = needsUv ? src.getAttribute('uv') : null;
    // 几何自带的顶点色（瓦垄明暗）作为乘子叠在材质色上；没有则按 1 处理
    const vc = src.getAttribute('color') as THREE.BufferAttribute | null;
    this.color.setHex(hex);
    // 诊断：ground 组若带暗顶点色（vc<0.5），最终色会被乘暗成近黑，肉眼像一块空洞。
    // 本项目查「颜色不对」必须按 base → AO → vc → 材质 四层排（只查 base 会连续误判）。
    if (g === 'ground' && vc && vc.getX(0) < 0.5 && this.darkGroundN < 6) {
      this.darkGroundN++;
      console.warn(`[Baker] ground 暗顶点色 vc=${vc.getX(0).toFixed(2)} base=#${hex.toString(16)} at (${Math.round(x)},${Math.round(z)})`);
    }
    // 归因追踪：ground 构件记录「最终顶点色 + 坐标 + 跨度」，用于定位「某块地为什么这么暗」。
    // 前 8 次排查（base/AO/vc/阴影/水/双面/UV/roof）都靠猜，缺的就是这份逐构件台账。
    const _traceOn = g === 'ground' && this.groundTrace.length < 2000 && Math.abs(x) < 900 && Math.abs(z) < 600;
    const _traceIdx = _traceOn ? this.buf[g].c.n / 3 : -1;
    const b = this.buf[g];
    // 逐顶点直写定长缓冲：旧版每个顶点 11 次 number[] push（含数组扩容与装箱），
    // 10M 面量级下这一层就是秒级开销的主要来源。
    const bp = b.p, bn = b.n, bc = b.c, buv = b.uv;
    const cr = this.color.r, cg = this.color.g, cb = this.color.b;
    for (let i = 0; i < p.count; i++) {
      bp.push3(p.getX(i), p.getY(i), p.getZ(i));
      bn.push3(n.getX(i), n.getY(i), n.getZ(i));
      const kAO = 0.82 + 0.18 * Math.min(1, Math.max(0, (p.getY(i) - wMinY) / wH));
      const kC = vc ? vc.getX(i) : 1;
      const kR = vc ? vc.getY(i) : 1;
      const kB = vc ? vc.getZ(i) : 1;
      bc.push3(cr * kAO * kC, cg * kAO * kR, cb * kAO * kB);
      if (buv) buv.push2(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (ROOF_AUDIT && g === 'roof') this.auditRoofPiece(p, n, x, y, z, ry, sx, sy, sz);
    if (_traceIdx >= 0) {
      const ca = this.buf[g].c.a;
      this.groundTrace.push({
        hex: '0x' + hex.toString(16).padStart(6, '0'),
        x: Math.round(x), y: Math.round(y), z: Math.round(z),
        span: Math.round(_span),
        c: [Math.round(ca[_traceIdx * 3] / COL_Q * 255), Math.round(ca[_traceIdx * 3 + 1] / COL_Q * 255), Math.round(ca[_traceIdx * 3 + 2] / COL_Q * 255)],
      });
      if (typeof window !== 'undefined') (window as unknown as { __groundTrace?: unknown }).__groundTrace = this.groundTrace;
    }
    src.dispose();
  }

  /**
   * 屋面台账：一次 `roof` 组几何落盘 → 一条世界 AABB 记录（仅 `?roofAudit=1`）。
   * `out` 只在「曲面单元」上算（标称包络 = push 的 sx/sy/sz 对应单位空间的 ±0.5 / 0..1.16）；
   * `eaveTrim` 的几何顶点已是世界尺度、scale=1，没有单位包络，故把 `roofAuditEnv` 关掉。
   */
  private auditRoofPiece(p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, n: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number): void {
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const env = this.roofAuditEnv;
    let out = 0;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      if (px < minx) minx = px; if (px > maxx) maxx = px;
      if (py < miny) miny = py; if (py > maxy) maxy = py;
      if (pz < minz) minz = pz; if (pz > maxz) maxz = pz;
      if (env) {
        const dx = px - x, dz = pz - z;
        const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        const ly = py - y;
        const e = Math.max(Math.abs(lx) - sx * 0.5, Math.abs(lz) - sz * 0.5, ly - sy * 1.30, -ly - sy * 0.30);
        if (e > out) out = e;
      }
    }
    let down = 0;
    for (let i = 0; i + 2 < n.count; i += 3) {
      if (n.getY(i) < -0.25 && n.getY(i + 1) < -0.25 && n.getY(i + 2) < -0.25) down++;
    }
    const dims = [maxx - minx, maxy - miny, maxz - minz].sort((a, b) => a - b);
    const thin = dims[0] < 0.32 && dims[2] > 0.8;
    const rec: RoofPiece = {
      kind: this.roofKind, min: [minx, miny, minz], max: [maxx, maxy, maxz],
      tri: Math.floor(n.count / 3), down, out, thin,
    };
    if (this.roofKind === 'roofC' && this.lastRoofs.length) rec.roof = { ...this.lastRoofs[this.lastRoofs.length - 1] };
    // 曲面屋顶也记调用点：屋顶投诉的归因链是「世界点 → roofC 参数 → 调用函数」，
    // 缺了 stack 就只能靠尺寸反推，实测会反推到错的生成式（河岸 vs 街屋）。
    if (thin || this.roofKind === 'roofC') rec.stack = roofCallSite();
    roofPieces.push(rec);
  }

  /**
   * 自定义几何入口：给「box/cyl/sphere 表达不了」的构件用（瓦垄定向法线的坡面、S 形檐口线等）。
   * 几何自带 position/normal/color/uv，就地按位姿落进材质组；调用方负责 UV 已按世界尺寸展开。
   */
  addGeo(g: BGroup, geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.push(g, geo, x, y, z, hex, ry, rx, rz, sx, sy, sz);
  }

  box(g: BGroup, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0): void {
    if (ROOF_AUDIT && g === 'roof') this.roofKind = 'box';
    if (TRACE_GLOW && g === 'glow') {
      glowTrace.push({ x, y, z, w, h, d, stack: (new Error().stack ?? '').split(/\n/).slice(2, 5).join(' | ') });
    }
    this.boxFast(g, w, h, d, x, y, z, hex, ry, rx, rz);
  }

  /**
   * 把「瓦条/粗垄」这类**直条薄板**压到最近一榀曲面屋面的瓦面以下。
   *
   * 两个生成处都是同一个错误条件——直条按「固定高度 + 固定俯仰角」落位，而屋面是曲面：
   *   · `buildings.ts` roofOn：每根垄是跨 t=0.18→0.97 的直箱（0.055 厚），弦在**上凸**的
   *     roofProfile=(1−t)^1.35 上方，中段浮空 ≈0.1H（21m 屋面约 0.7m）；
   *   · `sky/fengduDetail.ts` 鬼市铺面：前后坡各九道瓦垄（0.17×0.11），统一放在
   *     roofBaseLy+0.34·roofH、lz=±0.42d —— 该处瓦面只到 ≈0.16·roofH，整批条子浮空 0.18·roofH。
   * 两者都不是"某处摆错"，而是**任何按常数高度铺直条的写法在曲面上都会浮空**。
   *
   * 这里按最近一榀 roofC 的曲面（含它自己的 rx/rz 倾斜）把条心压到瓦面下 3cm：
   * 条子整体没入瓦面，瓦垄仍由 buildCurvedUnit 的顶点色条纹承担，一实例不删。
   */
  private sinkRib(y: number, x: number, z: number, bw: number, bd: number, bh: number): number {
    if (!this.lastRoofs.length) return y;
    // 在最近若干榀屋面里挑**足迹真正包含这条直条**的那一榀（近的优先）
    let r = null;
    for (let i = this.lastRoofs.length - 1; i >= 0; i--) {
      const c = this.lastRoofs[i];
      const dx = x - c.x, dz = z - c.z;
      const co = Math.cos(c.ry), si = Math.sin(c.ry);
      const lx = dx * co - dz * si, lz = dx * si + dz * co;
      if (Math.abs(lx) <= c.sx * 0.52 && Math.abs(lz) <= c.sz * 0.52) { r = c; break; }
    }
    if (!r) return y;
    _e2.set(r.rx, r.ry, r.rz);
    _q2.setFromEuler(_e2);
    _m4b.compose(_v2.set(r.x, r.y, r.z), _q2, _s2.set(1, 1, 1));
    // 世界点 → 屋面局部（未缩放，y 从屋面基点算）
    _p2.set(x, y, z).applyMatrix4(_m4c.copy(_m4b).invert());
    const hx = r.sx * 0.5, hz = r.sz * 0.5;
    if (Math.abs(_p2.x) > hx * 1.02 || Math.abs(_p2.z) > hz * 1.02) return y;
    /** 屋面局部 (lx,lz) 处的瓦面高度（与 buildCurvedUnit 同一套参数关系） */
    const surfaceY = (lx: number, lz: number): number | null => {
      const ax = Math.abs(lx), az = Math.abs(lz);
      if (ax > hx || az > hz) return null;
      const frac = Math.max(2 * RIDGE_HALF, az / hz);
      const f = (frac - 2 * RIDGE_HALF) / (1 - 2 * RIDGE_HALF);
      const t = Math.pow(Math.max(0, Math.min(1, f)), 1 / 1.6);
      const u = Math.max(-1, Math.min(1, lx / (Math.max(frac, 1e-3) * hx)));
      return (roofProfile(t) + UNIT_KICK * t * t * t + CORNER_RISE * t * t * u * u) * r.sy;
    };
    // 直条是**一条直线**跨在曲面上：只压条心不够，两端仍会翘出瓦面。
    // 因此取条子覆盖范围内（条心 + 两端 + 两侧）的最低瓦面高度，把整条压到它下面。
    let minSurf = Infinity;
    const cs: [number, number][] = [[0, 0], [bw * 0.5, 0], [-bw * 0.5, 0], [0, bd * 0.5], [0, -bd * 0.5]];
    for (const [dx, dz] of cs) {
      const s = surfaceY(_p2.x + dx, _p2.z + dz);
      if (s !== null && s < minSurf) minSurf = s;
    }
    if (!Number.isFinite(minSurf)) return y;
    const target = minSurf - 0.05 - bh * 0.5;
    if (_p2.y <= target) return y;
    // 局部下压量换回世界 y（局部 +Y 的世界 y 分量 = 旋转矩阵第二列第 2 项）
    return y + (target - _p2.y) * _m4b.elements[5];
  }

  /**
   * 盒体快路径：产出与 `new BoxGeometry(w,h,d)` → `push()` 逐位等价，但不建任何 THREE 对象。
   *
   * 原路径每个盒体要：new BoxGeometry（4 条 JS number 数组）→ toNonIndexed（再分配 4 条
   * Float32 缓冲并逐索引拷贝）→ scaleGeoUV（24 次访问器读 + 24 次访问器写）→ computeBoundingBox
   * → applyMatrix4（36 次 Vector3 变换）→ push 的拷贝循环（36 次 × 11 个访问器）。同一批顶点
   * 被遍历四遍、分配两套缓冲；全城 69.6 万个盒体，光这层开销实测 2.1s（分配）+ 4.8s（遍历）。
   *
   * 这里只做三件事：① 8 个角的局部坐标（先 fround，与 Float32BufferAttribute 的落盘一致）
   * 用与 three 完全相同的浮点表达式一次变换到世界系；② 6 个面的法线各乘法线矩阵并归一化一次；
   * ③ 按 BoxGeometry 的顶点顺序直写目标缓冲。UV 只剩 0 与 dim×0.24 两个取值，无需逐点计算。
   *
   * 位序依据（three r180 源码）：
   *   Vector3.applyMatrix4 = ((e0x + e4y) + e8z) + e12，再乘 w = 1/(0+0+0+1) = 1（乘 1 精确）
   *   Vector3.applyNormalMatrix = applyMatrix3 后 normalize = multiplyScalar(1/length)
   *   BoxGeometry 的 (a,b,d)(b,c,d) 索引 → 每面 4 角按 [0,2,1,2,3,1] 展开
   */
  private boxFast(g: BGroup, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, ry: number, rx: number, rz: number): void {
    if (NO_RIB && g === 'roof' && rx !== 0 && Math.abs(h - 0.055) < 1e-6) return;
    // 「粗垄」下压：roofOn 每根垄是一跨 t=0.18→0.97 的**直箱**（0.055 厚、带俯仰角），
    // 而屋面剖面 roofProfile=(1−t)^1.35 是上凸的：弦恒在曲面之上，中段实测浮空约 0.1H（21m 屋面约 0.7m）。
    // 于是整城每顶屋顶都会甩出十几片斜插屋面的薄板（用户看到的"白色薄片"）。旧注释按 1−t^1.6（下凹）写的
    // "中段被瓦面埋住"在换剖面之后已不成立。这里按最近一榀 roofC 的曲面把垄心压到瓦面下 3cm：
    // 弦中点入土、两端更深，薄板整体被瓦面吃掉，剩下的瓦垄仍由 buildCurvedUnit 的顶点色条纹承担。
    if (g === 'roof' && (rx !== 0 || rz !== 0) && h <= 0.115 && !ROOF_OLD) y = this.sinkRib(y, x, z, w, d, h);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    if (this.yawPivot) {
      _qYaw.setFromAxisAngle(_yAxis, Math.PI);
      _q.premultiply(_qYaw);
      x = 2 * this.yawPivot.x - x;
      z = 2 * this.yawPivot.z - z;
    }
    _v.set(x, y, z);
    _s.set(1, 1, 1);
    _m4.compose(_v, _q, _s);
    // 局部半尺寸：BoxGeometry 先算 width/2（double）再落 Float32 顶点缓冲，故先 fround 才对得上
    const hx = Math.fround(w / 2), hy = Math.fround(h / 2), hz = Math.fround(d / 2);
    // 越界守卫：与原路径同一份包围盒口径（computeBoundingBox 取的是变换前的局部盒）
    const _span = Math.max(Math.abs(hx), Math.abs(hy), Math.abs(hz));
    if (!Number.isFinite(_span) || _span > 30000 || Math.abs(x) > 30000 || Math.abs(z) > 30000 || Math.abs(y) > 8000) {
      this.rejected++;
      if (this.rejected <= 5) {
        console.warn(`[Baker] 拒收越界构件 ${g} span=${_span} at (${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)})`, new Error().stack?.split(String.fromCharCode(10)).slice(2, 5).join(' | '));
      }
      return;
    }
    const me = _m4.elements;
    // 8 个角 → 世界系（表达式与求值顺序同 Vector3.applyMatrix4）
    for (let k = 0; k < 8; k++) {
      const lx = (k & 1) ? hx : -hx;
      const ly = (k & 2) ? hy : -hy;
      const lz = (k & 4) ? hz : -hz;
      _bxCorner[k * 3] = (me[0] * lx + me[4] * ly + me[8] * lz) + me[12];
      _bxCorner[k * 3 + 1] = (me[1] * lx + me[5] * ly + me[9] * lz) + me[13];
      _bxCorner[k * 3 + 2] = (me[2] * lx + me[6] * ly + me[10] * lz) + me[14];
    }
    // 包围盒高度取**世界** max−min。旧版这里是 |hy|×2（局部厚度）——分子是世界 y、
    // 分母是局部高度，两个坐标系混用：倾斜屋面（rx≠0 的双坡板顶）世界高度是局部厚度的
    // 十几倍，kAO 被放大到 2–10 倍，本该压暗 18% 的接触阴影反而把整片瓦面提亮成一块灰板。
    let wMinY = _bxCorner[1], wMaxY = _bxCorner[1];
    for (let k = 1; k < 8; k++) {
      const cy = _bxCorner[k * 3 + 1];
      if (cy < wMinY) wMinY = cy;
      if (cy > wMaxY) wMaxY = cy;
    }
    const yrAO = Math.max(0.001, wMaxY - wMinY);
    // 屋面台账（?roofAudit=1）：先取 8 角的 AABB，面循环里再数朝下面
    let aMinX = 0, aMinY = 0, aMinZ = 0, aMaxX = 0, aMaxY = 0, aMaxZ = 0, aDown = 0;
    if (ROOF_AUDIT && g === 'roof') {
      aMinX = aMaxX = _bxCorner[0]; aMinY = aMaxY = _bxCorner[1]; aMinZ = aMaxZ = _bxCorner[2];
      for (let k = 1; k < 8; k++) {
        const cx = _bxCorner[k * 3], cy = _bxCorner[k * 3 + 1], cz = _bxCorner[k * 3 + 2];
        if (cx < aMinX) aMinX = cx; if (cx > aMaxX) aMaxX = cx;
        if (cy < aMinY) aMinY = cy; if (cy > aMaxY) aMaxY = cy;
        if (cz < aMinZ) aMinZ = cz; if (cz > aMaxZ) aMaxZ = cz;
      }
    }
    // AO 的上下界都按世界包围盒算（wMinY 已在上面的角变换里取好）；比例夹到 0..1，
    // 退化构件（平板、零高）统一取 1.0，不再出现 >1 的提亮。
    const bbMinY = wMinY;
    const b = this.buf[g];
    const buv = b.uv;
    // 先预留再取裸数组：reserve 可能换掉后备缓冲
    b.p.reserve(108); b.n.reserve(108); b.c.reserve(108);
    if (buv) buv.reserve(72);
    const pa = b.p.a; let pi = b.p.n;
    const na = b.n.a as Int16Array; let ni = b.n.n;
    const ca = b.c.a as Uint16Array; let ci = b.c.n;
    const ua = buv ? buv.a : null; let ui = buv ? buv.n : 0;
    this.color.setHex(hex);
    const cr = this.color.r, cg = this.color.g, cb = this.color.b;
    // 逐角 AO 与逐角最终色：只依赖该角的世界 y，6 个面共用同一批角。
    // 量化在这里做一次（8 次），而不是像旧实现那样每个面重乘一遍（36 次）。
    for (let k = 0; k < 8; k++) {
      const yf = Math.fround(_bxCorner[k * 3 + 1]);
      const kAO = 0.82 + 0.18 * Math.min(1, Math.max(0, (yf - bbMinY) / yrAO));
      _bxCq[k * 3] = colQ(cr * kAO);
      _bxCq[k * 3 + 1] = colQ(cg * kAO);
      _bxCq[k * 3 + 2] = colQ(cb * kAO);
    }
    /**
     * 底面剔除资格（ny 面 = 第 3 面，2 个三角面）。
     * 四条同时成立才算「这个盒子的底面在它整个生命周期里都看不到」：
     *   ① rx=rz=0：只有绕 y 旋转时底面才是水平面，其余朝向的底面会朝天或侧翻；
     *   ② 底边 ≤ −0.05m：地坪板顶面在 y=0、河床板顶面在 y=−2.25，底边埋进地坪以下 5cm 才保证被地面盖住
     *      （正好贴地 y=0 的不剔除——那圈面本来与地坪顶面共面在打架，留着不动，不借「修 z-fight」当借口）；
     *   ③ 底边 ≥ −6m：再往下就是河床以下/幽冥层，那里没有可遮挡的实体；
     *   ④ |x|,|z| < 5200：城内方域，terrainHeight 恒 0，地是实的（城外地形会下切到 −6）。
     */
    const cullBottom = cullBottomOn && rx === 0 && rz === 0
      && bbMinY <= -0.05 && bbMinY >= -6
      && Math.abs(x) < 5200 && Math.abs(z) < 5200;
    if (BOX_AUDIT) this.auditBox(g, cullBottom, w, h, d, x, y, z, hex, ry, rx, rz);
    // 诊断台账：ground 组记录首顶点最终色（必须在写入前取下标，与 push 一致）
    const _traceOn = g === 'ground' && this.groundTrace.length < 2000 && Math.abs(x) < 900 && Math.abs(z) < 600;
    const _traceIdx = _traceOn ? ci / 3 : -1;
    _m3.getNormalMatrix(_m4);
    const nme = _m3.elements;
    // 面序 px,nx,py,ny,pz,nz：轴向 = f>>1（x,y,z），符号由对应尺寸的正负决定
    for (let f = 0; f < 6; f++) {
      if (cullBottom && f === 3) continue;   // 底面：资格成立时整面不写
      const axis = f >> 1;
      const dim = axis === 0 ? w : axis === 1 ? h : d;
      // 法线符号取 buildPlane 第 7 个实参的正负：px=+w, nx=−w, py=+h, ny=−h, pz=+d, nz=−d
      // （原文是 `depth > 0 ? 1 : -1`，尺寸为 0 时判 −1，故不能简写成 sign(dim)）
      const sg = ((f & 1) ? -dim : dim) > 0 ? 1 : -1;
      const sx = axis === 0 ? sg : 0, sy = axis === 1 ? sg : 0, sz = axis === 2 ? sg : 0;
      // Vector3.applyNormalMatrix：先矩阵乘，再乘 1/length
      let nx = nme[0] * sx + nme[3] * sy + nme[6] * sz;
      let ny = nme[1] * sx + nme[4] * sy + nme[7] * sz;
      let nz = nme[2] * sx + nme[5] * sy + nme[8] * sz;
      const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= inv; ny *= inv; nz *= inv;
      if (ROOF_AUDIT && g === 'roof' && ny < -0.25) aDown += 2;
      const nxi = normQ(nx), nyi = normQ(ny), nzi = normQ(nz);
      // scaleGeoUV：u/v 只有 0 与 1 两种，故每面只有两个 UV 值。零值也要按原式 (0×dim×0.24)
      // 求一遍——尺寸为负时它是 −0，与 +0 在 Float32Array 里不是同一个位模式。
      const fd0 = f < 2 ? d : w;
      const fd1 = f < 2 ? h : f < 4 ? d : h;
      const u0 = 0 * fd0 * 0.24, u1 = Math.fround(fd0 * 0.24);
      const v0 = 0 * fd1 * 0.24, v1 = Math.fround(fd1 * 0.24);
      for (let t = 0; t < 6; t++) {
        const j = BOX_TRI_ORDER[t];
        const k = BOX_FACE_CORNERS[f * 4 + j];
        pa[pi++] = _bxCorner[k * 3];
        pa[pi++] = _bxCorner[k * 3 + 1];
        pa[pi++] = _bxCorner[k * 3 + 2];
        na[ni++] = nxi; na[ni++] = nyi; na[ni++] = nzi;
        ca[ci++] = _bxCq[k * 3]; ca[ci++] = _bxCq[k * 3 + 1]; ca[ci++] = _bxCq[k * 3 + 2];
        if (ua) { ua[ui++] = (j & 1) ? u1 : u0; ua[ui++] = (j & 2) ? v0 : v1; }
      }
    }
    b.p.n = pi; b.n.n = ni; b.c.n = ci;
    if (buv) buv.n = ui;
    if (ROOF_AUDIT && g === 'roof') {
      const dims = [aMaxX - aMinX, aMaxY - aMinY, aMaxZ - aMinZ].sort((p, q) => p - q);
      const thin = dims[0] < 0.32 && dims[2] > 0.8;
      const rec: RoofPiece = {
        kind: this.roofKind, min: [aMinX, aMinY, aMinZ], max: [aMaxX, aMaxY, aMaxZ],
        tri: cullBottom ? 10 : 12, down: aDown, out: 0, thin,
      };
      if (thin) rec.stack = roofCallSite();
      roofPieces.push(rec);
    }
    if (_traceIdx >= 0) {
      this.groundTrace.push({
        hex: '0x' + hex.toString(16).padStart(6, '0'),
        x: Math.round(x), y: Math.round(y), z: Math.round(z),
        span: Math.round(_span),
        c: [Math.round(ca[_traceIdx * 3] / COL_Q * 255), Math.round(ca[_traceIdx * 3 + 1] / COL_Q * 255), Math.round(ca[_traceIdx * 3 + 2] / COL_Q * 255)],
      });
      if (typeof window !== 'undefined') (window as unknown as { __groundTrace?: unknown }).__groundTrace = this.groundTrace;
    }
  }

  /** 球（树叶团簇 / 果实 / 花簇）。Baker 原先没有球，所有植物只能用圆锥近似 ——
   *  蟠桃树"三个粉圆锥"就是这么来的。球是植物造型的基本体，必须有。 */
  sphere(g: BGroup, r: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.push(g, new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6))), x, y, z, hex, ry, rx, rz, sx, sy, sz, [r * 2, r * 2, r * 2]);
  }

  cyl(g: BGroup, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, hex: number, ry = 0, rx = 0, rz = 0, open = false, sx = 1, sy = 1, sz = 1): void {
    if (ROOF_AUDIT && g === 'roof') this.roofKind = 'cyl';
    if (TRACE_GLOW && g === 'glow') {
      glowTrace.push({ x, y, z, w: rt * 2 * sx, h: h * sy, d: rb * 2 * sz, stack: 'CYL ' + (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 5).join(' | ') });
    }
    this.push(g, new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), x, y, z, hex, ry, rx, rz, sx, sy, sz, [(sx + sz), h, (sx + sz)]);
  }

  /** 曲面反宇屋顶：单元几何克隆后按世界轴缩放旋转（单位：底 1×1、脊高 1、该单元檐口环 y=0.16）。
   *  rib=true（roofOn 的正式瓦屋顶）时按世界尺度烘瓦垄条纹；直接调用的巨型壳体也自动开。 */
  roofC(g: BGroup, x: number, y: number, z: number, hex: number, ry: number, sx: number, sy: number, sz: number, rx = 0, rz = 0, rib = false): void {
    if (TRACE_GLOW && g === 'glow') {
      glowTrace.push({ x, y, z, w: sx, h: sy, d: sz, stack: 'ROOFC ' + (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 5).join(' | ') });
    }
    // 瓦垄开在两种屋顶上：① roofOn 造的正式屋面（街道 6–16m → 地标 224m）；② 任何 ≥30m 的巨壳。
    // 里坊民居（imperial 直调 roofC，16–25m，全城约 1700 顶）走贴图：0.34m 在 3–5km 处只有 0.1px，纯烧面数
    const plain = rx !== 0 || rz !== 0;
    const big = Math.max(sx, sz);
    const wantRib = g === 'roof' && !plain && (rib || big >= 30);
    const cols = wantRib ? roofRibCols(sx) : 9;
    const unit = cols > 9 ? buildCurvedUnit(cols, sx, sz) : curvedRoofUnit().clone();
    // 不传 uvDims：曲面单元的 UV 已在 buildCurvedUnit 里按世界尺寸展开，再套 box 版的 scaleGeoUV 会打乱
    if (g === 'roof') {
      this.lastRoofs.push({ x, y, z, ry, rx, rz, sx, sy, sz });
      if (this.lastRoofs.length > 24) this.lastRoofs.shift();
    }
    if (ROOF_AUDIT) { this.roofKind = 'roofC'; this.roofAuditEnv = true; }
    this.push(g, unit, x, y, z, hex, ry, rx, rz, sx, sy, sz);
    if (g === 'roof' && !plain && big >= 5) this.eaveTrim(x, y, z, hex, ry, sx, sy, sz);
  }

  /**
   * 檐口三件套（剪边 / 瓦当 / 滴水）：按曲面自身的檐口环（t=1）建几何，四边各推一次。
   * 每 0.6m 一枚瓦当 + 一枚滴水，共 3 面 → 10m 檐口 50 面，低于「120 面/10m」的上限。
   * 顶点全部建在屋顶局部系里，由 push 统一落位转向（不能在这里先转一次，否则会双重变换）。
   * 这里只加不减：roofOn 的 eaveFascia / detailKit 的 eave.tileDrip 语义与计数原样保留。
   */
  private eaveTrim(x: number, y: number, z: number, hex: number, ry: number, sx: number, sy: number, sz: number): void {
    if (NO_TRIM) return;
    const bandP: number[] = [], bandU: number[] = [];
    const capP: number[] = [], capU: number[] = [];
    const dripP: number[] = [], dripU: number[] = [];
    const tri = (arr: number[], uvArr: number[], a: number[], b: number[], c: number[]): void => {
      for (const v of [a, b, c]) {
        arr.push(v[0], v[1], v[2]);
        uvArr.push(v[0] / 2.56, v[2] / 2.4); // 局部坐标直接当 UV：只借瓦面纹理的色，不做世界对齐
      }
    };
    const KICK = 0.02; // 压在瓦面上方，避免与曲面共面闪烁
    const AXES: ('z' | 'x')[] = ['z', 'x'];
    let caps = 0, drips = 0;
    for (const axis of AXES) {
      for (const s of [1, -1]) {
        // T=横向（决定坡度/进深方向），A=沿边（决定 u 的展开尺度与瓦当枚数）——两者不能混用
        const T = axis === 'z' ? sz : sx;
        const A = axis === 'z' ? sx : sz;
        const L = Math.hypot(UNIT_DZ_DT * T, UNIT_DY_DT * sy);
        // 曲面上 (u,t) 的点：与 buildCurvedUnit 的 ring() 同一套公式，天生贴面，
        // 角部起翘与垂脊斜缝都自动成立（世界空间垂直偏移会在角部浮起/穿模，实测 +0.46m / -0.02m）
        const sp = (u: number, t: number, lift: number): number[] => {
          const e = Math.pow(t, 1.6);
          const h = RIDGE_HALF + (0.5 - RIDGE_HALF) * e;
          const y = (roofProfile(t) + UNIT_KICK * Math.pow(t, 3) + CORNER_RISE * t * t * u * u) * sy + lift;
          const lat = u * h * A;
          return axis === 'z' ? [lat, y, s * h * sz] : [s * h * sx, y, lat];
        };
        const tAt = (off: number): number => Math.max(0.2, 1 - off / L);
        // ① 剪边：檐口 0.6m 一圈。沿边细分（一根直条会在檐口中点浮起 0.15·sy）
        const M = Math.max(2, Math.min(16, Math.ceil(A / 8)));
        const t1 = tAt(0.6);
        for (let i = 0; i < M; i++) {
          const u0 = -1 + (2 * i) / M, u1 = -1 + (2 * (i + 1)) / M;
          tri(bandP, bandU, sp(u0, 1, KICK), sp(u1, 1, KICK), sp(u1, t1, KICK));
          tri(bandP, bandU, sp(u0, 1, KICK), sp(u1, t1, KICK), sp(u0, t1, KICK));
        }
        // ② 瓦当 / ③ 滴水：沿边 0.6m 一枚，正对檐口外缘
        const n = Math.max(1, Math.round((0.93 * A) / 0.6));
        const du = Math.min(0.06, 0.13 / (0.5 * A));
        const out: number[] = axis === 'z' ? [0, 0, s] : [s, 0, 0];
        for (let i = 0; i < n; i++) {
          const u = -0.93 + (1.86 * (i + 0.5)) / n;
          // 瓦当：贴在檐口上、略抬 0.03m 的薄片（俯视读成一排亮点）
          const c0 = sp(u - du, tAt(0.16), KICK + 0.03), c1 = sp(u + du, tAt(0.16), KICK + 0.03);
          const c2 = sp(u + du, tAt(0.46), KICK + 0.03), c3 = sp(u - du, tAt(0.46), KICK + 0.03);
          tri(capP, capU, c0, c1, c2);
          tri(capP, capU, c0, c2, c3);
          caps++;
          // 滴水：低于檐口 0.05m、外挑 0.06m 的三角垂片（宋式滴水瓦就是下尖的舌片；1 面即可）
          const lift = (px: number[], dy2: number, dOut: number): number[] =>
            [px[0] + out[0] * dOut, px[1] + dy2, px[2] + out[2] * dOut];
          const d0 = sp(u - du, 1, 0), d1 = sp(u + du, 1, 0), dm = sp(u, 1, 0);
          tri(dripP, dripU, lift(d0, -0.03, 0.04), lift(d1, -0.03, 0.04), lift(dm, -0.21, 0.08));
          drips++;
        }
      }
    }
    const trimHex = shade(hex, 1.14);
    if (ROOF_AUDIT) { this.roofKind = 'trim-band'; this.roofAuditEnv = false; }
    this.push('roof', this.rawGeo(bandP, bandU), x, y, z, trimHex, ry, 0, 0, 1, 1, 1);
    if (ROOF_AUDIT) this.roofKind = 'trim-cap';
    this.push('roof', this.rawGeo(capP, capU), x, y, z, shade(hex, 1.2), ry, 0, 0, 1, 1, 1);
    if (ROOF_AUDIT) this.roofKind = 'trim-drip';
    this.push('roof', this.rawGeo(dripP, dripU), x, y, z, shade(hex, 0.6), ry, 0, 0, 1, 1, 1);
    this.kit('roof.eaveTrim', 4, y);
    this.kit('roof.tileCap', caps, y);
    this.kit('roof.dripTile', drips, y);
  }

  /** 由三角形数组现拼几何（位置 + UV，法线现算）；顶点已在世界局部系内 */
  private rawGeo(p: number[], uv: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  /** 四棱台屋顶：45° 转角烘进几何再按世界轴缩放。compose 是先缩后旋，ry 叠 π/4 会被非等比缩放剪切成碎片 */
  pyramid(g: BGroup, rt: number, rb: number, x: number, y: number, z: number, hex: number, ry: number, sx: number, sy: number, sz: number): void {
    if (TRACE_GLOW && g === 'glow') {
      glowTrace.push({ x, y, z, w: rb * 2 * sx, h: sy, d: rb * 2 * sz, stack: 'PYR ' + (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 5).join(' | ') });
    }
    const geo = new THREE.CylinderGeometry(rt, rb, 1, 4, 1, false);
    geo.rotateY(Math.PI / 4);
    this.push(g, geo, x, y, z, hex, ry, 0, 0, sx, sy, sz, [(sx + sz), sy, (sx + sz)]);
  }

  async build(scene: THREE.Scene): Promise<Record<BGroup, THREE.Material>> {
    this.materialSet();
    await this.flush(scene);
    return this.mats as Record<BGroup, THREE.Material>;
  }

  /**
   * 分批落盘：把当前缓冲烘成 mesh 挂到场景上，然后清空缓冲。
   * 这是「加载不再卡死」的关键结构——几何量按步累积时全城要 10M 面 / 3GB 堆，
   * V8 在 3GB 附近进 GC 悬崖，主线程整段停摆。改为每步落盘后，
   * 峰值堆 = 单步几何量，而不是全城几何量；材质与贴图只建一次（materialSet 有缓存）。
   */
  async flush(scene: THREE.Scene): Promise<Record<BGroup, THREE.Material>> {
    this.materialSet();
    const mats = this.mats as Record<BGroup, THREE.Material>;
    const cast = new Set<BGroup>(['wood', 'wall', 'ash', 'earth', 'roof', 'trunk', 'ceramic', 'metal', 'lacquer']);
    const batch = this.batch++;
    // 按材质组逐组装配。**让帧改为按预算**：旧实现每装一组就让一帧，实测 271 次让帧共等掉 4.6s，
    // 而真正装配只有 0.63s —— 每组 2.3ms 的活却要等 16.7ms 的帧，让帧反而成了 flush 的主成本。
    // 改为「累计装配量超 8ms 才让一帧」：单次阻塞上限不变（≈8ms + 最重一组），让帧次数按需下降。
    let pending = 0;
    for (const g of Object.keys(this.buf) as BGroup[]) {
      const b = this.buf[g];
      if (b.p.n === 0) continue;
      if (pending >= 8) {
        await new Promise<void>((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r()); else setTimeout(r, 0); });
        pending = 0;
      }
      const _w0 = performance.now();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p.take(), 3));
      // 法线/顶点色是量化属性：normalized SHORT / UNSIGNED_SHORT，GPU 端解码回 float 后
      // 与原 float32 的差小于 1/32767、1/65535（见文件头 QBuf 的账）。
      geo.setAttribute('normal', new THREE.Int16BufferAttribute(b.n.take(), 3, true));
      geo.setAttribute('color', new THREE.Uint16BufferAttribute(b.c.take(), 3, true));
      if (b.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv.take(), 2));
      const mesh = new THREE.Mesh(geo, mats[g]);
      mesh.name = batch === 0 ? 'city_' + g : 'city_' + g + '_' + batch;
      mesh.castShadow = cast.has(g);
      mesh.receiveShadow = g !== 'glow';
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      this.emitted[g] = (this.emitted[g] ?? 0) + b.p.n;
      b.p.reset(); b.n.reset(); b.c.reset();
      if (b.uv) b.uv.reset();
      pending += performance.now() - _w0;
    }
    return mats;
  }

  private materialSet(): Record<BGroup, THREE.Material> {
    if (this.mats) return this.mats;
    const _t0 = performance.now();
    const tex = createCityTextures();
    // 贴图绘制（6 张画布、上万次描边）是首帧 flush 里唯一的整段同步开销，单独计时
    if (typeof window !== 'undefined') (window as unknown as { __texMs?: number }).__texMs = Math.round(performance.now() - _t0);
    let detailSeed = 20260905;
    const dr = (): number => {
      detailSeed = (Math.imul(detailSeed, 1664525) + 1013904223) >>> 0;
      return detailSeed / 4294967296;
    };
    const neutral = (paint: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture => canvasTex((ctx, s) => {
      ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, s, s);
      paint(ctx, s);
    }, 256);
    // 釉面/花瓣/果皮共用一张中性微纹理。底仍是 #d8d8d8，灰阶斑与釉流原样保留 ⇒ 器物亮度与旧
    // ceramicTex 一致；粉只以 ≤0.11 透明度叠在柔边斑点上，实测贴图均值 (215.9,215.2,215.5)，
    // 对 #d8d8d8 的色偏 <1/255（共用贴图一旦带明显色相，全城陶器会一起偏粉）。
    // 花瓣的粉色由顶点色承担，贴图只负责瓣面深浅与径向瓣脉。
    const blossomTex = neutral((ctx, s) => {
      for (let i = 0; i < 500; i++) ctx.fillStyle = `rgba(160,176,190,${0.03 + dr() * 0.09})`, ctx.fillRect(dr() * s, dr() * s, 1 + dr() * 2, 1 + dr() * 2);
      for (let i = 0; i < 16; i++) {
        ctx.strokeStyle = `rgba(90,104,118,${0.05 + dr() * 0.08})`;
        ctx.beginPath();
        let x = dr() * s, y = dr() * s;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (dr() - 0.5) * 28; y += 4 + dr() * 12; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      // 花瓣：柔边淡粉斑。器物上读作暖调微瑕，花瓣上读作瓣面深浅。
      // 透明度 0.05–0.11：0.03–0.07 在 1m 级桃实上经 ACES 与清漆高光后被冲掉，近景只剩纯色球。
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = `rgba(${222 + dr() * 16 | 0},${176 + dr() * 16 | 0},${192 + dr() * 16 | 0},${0.05 + dr() * 0.06})`;
        ctx.beginPath();
        ctx.ellipse(dr() * s, dr() * s, 2 + dr() * 7, 1.5 + dr() * 4, dr() * Math.PI, 0, 7);
        ctx.fill();
      }
      // 径向瓣脉：花/果在 realm.ts 里按对象空间 2.4× 平铺采样（一颗 1m 级果子读 2–3 张图），
      // 脉心放 (0.18s,0.18s) 中景就能读出来；器物按 0.24/m 世界展开，0.75m 以下的小件只落在
      // 左下角、蹭不到这组脉，大件才读成几缕釉流。
      const cx = s * 0.18, cy = s * 0.18;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.35;
        ctx.strokeStyle = `rgba(${236 + dr() * 12 | 0},${208 + dr() * 12 | 0},${214 + dr() * 12 | 0},${0.04 + dr() * 0.04})`;
        ctx.lineWidth = 0.7 + dr() * 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3);
        const bend = 0.1 + dr() * 0.08;
        ctx.quadraticCurveTo(
          cx + Math.cos(a + bend) * 0.085 * s, cy + Math.sin(a + bend) * 0.085 * s,
          cx + Math.cos(a - bend * 0.4) * (0.11 + dr() * 0.05) * s, cy + Math.sin(a - bend * 0.4) * (0.11 + dr() * 0.05) * s,
        );
        ctx.stroke();
      }
    });
    // 第二张只走光泽通道：MeshPhysicalMaterial.clearcoatRoughnessMap 取 G 通道、不参与漫反射，
    // 果皮油光/花瓣柔光靠它破面，器物颜色一点不变。均值拉到 ≈0.9，配 clearcoatRoughness 0.22
    // ≈ 原来的 0.2，清漆观感等效。
    const petalSheenTex = neutral((ctx, s) => {
      ctx.fillStyle = 'rgba(255,250,250,0.55)'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(${104 + dr() * 30 | 0},${96 + dr() * 28 | 0},${100 + dr() * 28 | 0},${0.04 + dr() * 0.08})`;
        ctx.beginPath();
        ctx.ellipse(dr() * s, dr() * s, 3 + dr() * 12, 2 + dr() * 8, dr() * Math.PI, 0, 7);
        ctx.fill();
      }
    });
    petalSheenTex.colorSpace = THREE.NoColorSpace;
    const metalTex = neutral((ctx, s) => {
      for (let y = 0; y < s; y += 2) {
        ctx.fillStyle = `rgba(${120 + dr() * 50 | 0},${124 + dr() * 50 | 0},${132 + dr() * 50 | 0},${0.12 + dr() * 0.18})`;
        ctx.fillRect(0, y, s, 1);
      }
      for (let i = 0; i < 80; i++) ctx.fillStyle = `rgba(70,74,82,${0.06 + dr() * 0.12})`, ctx.fillRect(dr() * s, dr() * s, 2 + dr() * 18, 1);
    });
    const fabricTex = neutral((ctx, s) => {
      ctx.lineWidth = 1;
      for (let x = 0; x < s; x += 4) { ctx.strokeStyle = `rgba(105,110,118,${0.12 + dr() * 0.08})`; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
      for (let y = 0; y < s; y += 4) { ctx.strokeStyle = `rgba(150,154,160,${0.1 + dr() * 0.08})`; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    });
    const ashTex = neutral((ctx, s) => {
      for (let i = 0; i < 420; i++) ctx.fillStyle = `rgba(${70 + dr() * 40 | 0},${64 + dr() * 34 | 0},${62 + dr() * 30 | 0},${0.05 + dr() * 0.12})`, ctx.fillRect(dr() * s, dr() * s, 2 + dr() * 9, 1 + dr() * 3);
      for (let i = 0; i < 22; i++) {
        ctx.strokeStyle = `rgba(24,18,18,${0.08 + dr() * 0.14})`;
        ctx.lineWidth = 0.6 + dr() * 1.1;
        ctx.beginPath(); ctx.moveTo(dr() * s, 0); ctx.lineTo(dr() * s + (dr() - 0.5) * 40, s); ctx.stroke();
      }
    });
    // 夯土/土坯：横向抹泥压痕 + 草筋颗粒 + 竖向雨蚀裂缝（无自发光，避免蓝灰染色）
    const earthTex = neutral((ctx, s) => {
      for (let i = 0; i < 190; i++) {
        ctx.strokeStyle = `rgba(${150 + dr() * 60 | 0},${120 + dr() * 46 | 0},${84 + dr() * 38 | 0},${0.05 + dr() * 0.1})`;
        ctx.lineWidth = 1 + dr() * 3.2;
        const y = dr() * s, x = dr() * s, w = 18 + dr() * 70;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + (dr() - 0.5) * 5); ctx.stroke();
      }
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(${96 + dr() * 40 | 0},${78 + dr() * 32 | 0},${54 + dr() * 26 | 0},${0.06 + dr() * 0.14})`;
        ctx.fillRect(dr() * s, dr() * s, 1 + dr() * 3, 1 + dr() * 2);
      }
      // 雨蚀裂缝：原来 5 段、每段 8–24px，在 0.24/m 的平铺下是 3m 长的折线，
      // 贴在 10km 城墙上读成"划痕/线框"。压成 3 段短裂 + 低透明度。
      for (let i = 0; i < 16; i++) {
        ctx.strokeStyle = `rgba(58,44,30,${0.04 + dr() * 0.05})`;
        ctx.lineWidth = 0.4 + dr() * 0.8;
        let y = dr() * s, x = dr() * s;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) { y += 5 + dr() * 9; x += (dr() - 0.5) * 6; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    });
    const leafTex = neutral((ctx, s) => {
      for (let i = 0; i < 420; i++) {
        ctx.fillStyle = `rgba(${180 + dr() * 60 | 0},${210 + dr() * 40 | 0},${160 + dr() * 60 | 0},${0.05 + dr() * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(dr() * s, dr() * s, 2 + dr() * 9, 1.5 + dr() * 5, dr() * 3, 0, 7);
        ctx.fill();
      }
      for (let i = 0; i < 70; i++) {
        ctx.strokeStyle = `rgba(40,60,40,${0.06 + dr() * 0.1})`;
        ctx.lineWidth = 0.6 + dr();
        const x = dr() * s, y = dr() * s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (dr() - 0.5) * 26, y + 8 + dr() * 22); ctx.stroke();
      }
    });
    const lacquerTex = neutral((ctx, s) => {
      for (let i = 0; i < 55; i++) {
        ctx.strokeStyle = `rgba(58,54,52,${0.05 + dr() * 0.13})`;
        ctx.lineWidth = 0.7 + dr() * 0.8;
        ctx.beginPath(); ctx.moveTo(dr() * s, 0); ctx.lineTo(dr() * s + (dr() - 0.5) * 20, s); ctx.stroke();
      }
    });
    const mats: Record<BGroup, THREE.Material> = {
      wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.03, map: tex.woodTex, normalMap: tex.woodNormal, normalScale: new THREE.Vector2(0.9, 0.9) }),
      wall: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a3d48, map: tex.wallTex, normalMap: tex.wallNormal, normalScale: new THREE.Vector2(1.0, 1.0) }),
      ash: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, map: ashTex, normalScale: new THREE.Vector2(0.8, 0.8) }),
      earth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0, map: earthTex }),
      // 瓦：全漫反射 + 极弱环境反射。任何清漆/金属度在有 scene.environment 时于掠射角都会整片上翻成白色，
      // 屋顶就变成"水泥板"。釉面只靠贴图里的高光窄条表达，不再交给 PBR 镜面。
      roof: new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.93, metalness: 0.0, emissive: 0x171b22, emissiveIntensity: 0.55, map: tex.roofTex, normalMap: tex.roofNormal, normalScale: new THREE.Vector2(1.1, 1.1), aoMap: tex.roofAuxGen ?? undefined, envMapIntensity: 0.10 }),
      ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0, map: tex.groundTex, normalMap: tex.groundNormalGen ?? undefined }),
      // 自发光组改为走 ACES 色调映射：toneMapped:false 时颜色是"原样直出"，
      // 任何 0xffffff 级的面都会直接烧成纯白 + 泛光（用户反复看到的"白色方块/闪光"）。
      // 走 toneMapped 后高光会被 ACES 滚降，霓虹仍然亮，但不再是一片死白。
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }),
      // 叶片贴图：本意是斑驳叶面（明暗斑 + 叶脉细线）。但 leaf 组不在 UV_GROUPS、Buf 里也没有 uv，
      // 实测 leaf 网格 uv=false —— 每个顶点都采贴图 (0,0) 的同一个像素，最终只是一个约 0.85 的
      // 常数乘子，斑驳根本没显示。要让叶面纹理真生效需给 leaf 加 uv 缓冲，会重刷全城植被，本轮不动。
      leaf: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x16211a, map: leafTex }),
      trunk: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x0a0806 }),
      water: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, toneMapped: false }),
      // 釉面/金属在掠射角整片上翻成纯白是「白色方块」的第二来源（第一来源见 roof 的 Euler 陷阱）。
      // 压清漆与环境反射强度：仍有釉光，但不再爆白。
      ceramic: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: blossomTex, roughness: 0.42, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.22, clearcoatRoughnessMap: petalSheenTex, envMapIntensity: 0.35 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, map: metalTex, roughness: 0.52, metalness: 0.35, envMapIntensity: 0.4 }),
      // sheen 0.65 会在天宫强光下把云托/帐幔打成纯白（与云托色叠加是爆白的第二因素），压到 0.25
      fabric: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: fabricTex, roughness: 0.92, metalness: 0.0, sheen: 0.25, sheenRoughness: 0.55, envMapIntensity: 0.3 }),
      lacquer: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: lacquerTex, roughness: 0.36, metalness: 0.0, clearcoat: 0.85, clearcoatRoughness: 0.14, envMapIntensity: 0.65 }),
    };
    this.mats = mats;
    return mats;
  }
}

// ============ 汉字招牌纹理图集 + 招牌四边形合批 ============
export interface SignStyle {
  color?: string; glow?: string; bg?: string; border?: string;
  vertical?: boolean; fontPx?: number; font?: string;
}

export class SignAtlas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  private cells = new Map<string, [number, number, number, number]>();
  private cx = 1; private cy = 1; private rowH = 0;
  overflowCount = 0;
  // 5120 实测 overflowCount=1（图集刚好满一格，覆写早期 cell → 匾额错字/白板）。
  // 6144 比 5120 多 44% 面积、只多 39MB 显存，比直接上 8192（+163MB）稳。
  private readonly SIZE = 6144;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
  }

  /** 在图集上绘制一块招牌，返回 uv；重复 key 幂等 */
  draw(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): [number, number, number, number] {
    const found = this.cells.get(key);
    if (found) return found;
    if (this.cx + w > this.SIZE) { this.cx = 1; this.cy += this.rowH + 2; this.rowH = 0; }
    if (this.cy + h > this.SIZE) { // 图集满：覆盖复用（若发生说明图集仍不够，需扩容 SIZE）
      this.cx = 1; this.cy = 1; this.rowH = 0;
      this.overflowCount++;
      console.warn('[SignAtlas] 图集溢出覆写——应扩容');
    }
    this.ctx.save();
    this.ctx.translate(this.cx, this.cy);
    this.ctx.beginPath(); this.ctx.rect(0, 0, w, h); this.ctx.clip();
    paint(this.ctx, w, h);
    this.ctx.restore();
    const uv: [number, number, number, number] = [this.cx / this.SIZE, 1 - (this.cy + h) / this.SIZE, (this.cx + w) / this.SIZE, 1 - this.cy / this.SIZE];
    this.cells.set(key, uv);
    this.cx += w + 4; this.rowH = Math.max(this.rowH, h);
    this.tex.needsUpdate = true;
    return uv;
  }

  /** 文字招牌（横/竖排），发光描边 */
  text(key: string, text: string, w: number, h: number, st: SignStyle = {}): [number, number, number, number] {
    return this.draw(key, w, h, (ctx, W, H) => {
      const font = st.font ?? "'KaiTi','STKaiti','SimSun',serif";
      if (st.bg) { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, W, H); }
      if (st.border) { ctx.strokeStyle = st.border; ctx.lineWidth = 6; ctx.strokeRect(5, 5, W - 10, H - 10); }
      const px = st.fontPx ?? Math.floor(H * 0.62);
      ctx.font = `${px}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = px * 0.45; }
      ctx.fillStyle = st.color ?? '#ffffff';
      const chars = [...text];
      if (st.vertical || (chars.length > 2 && W < H)) {
        const step = Math.min(px * 1.18, (H - 12) / chars.length);
        chars.forEach((c, i) => ctx.fillText(c, W / 2, H / 2 - ((chars.length - 1) * step) / 2 + i * step));
      } else {
        let fs = px;
        while (ctx.measureText(text).width > W - 14 && fs > 9) { fs *= 0.92; ctx.font = `${fs}px ${font}`; }
        ctx.fillText(text, W / 2, H / 2 + px * 0.06);
      }
    });
  }
}

export class SignMesher {
  private p: number[] = []; private uv: number[] = [];
  private yawPivot: { x: number; z: number } | null = null;

  /** 与 Baker.yawAbout 同步：招牌跟着整组转 180°，否则地标翻向后匾额会朝里 */
  yawAbout(x?: number, z?: number): void {
    this.yawPivot = typeof x === 'number' && typeof z === 'number' ? { x, z } : null;
  }
  private readonly _c = new THREE.Vector3();

  quad(uvp: readonly number[], w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    if (this.yawPivot) {
      x = 2 * this.yawPivot.x - x;
      z = 2 * this.yawPivot.z - z;
      ry += Math.PI;
    }
    // 双面可读：正面 + 背面（背面水平镜像 UV，背面文字同样正读）
    this.quadSide(uvp, w, h, x, y, z, ry, rx, rz, false);
    this.quadSide([uvp[2], uvp[1], uvp[0], uvp[3]], w, h, x, y, z, ry + Math.PI, rx, rz, true);
  }

  private quadSide(uvp: readonly number[], w: number, h: number, x: number, y: number, z: number, ry: number, rx: number, rz: number, back: boolean): void {
    _e.set(rx, ry + (back ? Math.PI : 0), rz); _q.setFromEuler(_e);
    _s.set(1, 1, 1);
    _m4.compose(this._c.set(0, 0, 0), _q, _s);
    const hw = w / 2, hh = h / 2;
    const corners = [[-hw, hh, 0], [hw, hh, 0], [hw, -hh, 0], [-hw, -hh, 0]];
    const idx = [0, 1, 2, 0, 2, 3];
    const uvs = back
      ? [[uvp[2], uvp[3]], [uvp[0], uvp[3]], [uvp[0], uvp[1]], [uvp[2], uvp[1]]]
      : [[uvp[0], uvp[3]], [uvp[2], uvp[3]], [uvp[2], uvp[1]], [uvp[0], uvp[1]]];
    for (const i of idx) {
      _v.set(corners[i][0], corners[i][1], corners[i][2]).applyMatrix4(_m4);
      this.p.push(x + _v.x, y + _v.y, z + _v.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
  }

  build(scene: THREE.Scene, atlas: SignAtlas, name = 'signs'): void {
    if (this.p.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const mat = new THREE.MeshBasicMaterial({ map: atlas.tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    this.p.length = 0; this.uv.length = 0;
  }
}
