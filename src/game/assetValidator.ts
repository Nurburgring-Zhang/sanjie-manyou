// ============================================================================
// 三界造物 · 资产多机位截图验证器 · src/game/assetValidator.ts
//
// R26：用户要求「构建完成后多角度、多维度、多距离、多高低进行截图验证，没问题了
// 才开始热载入」。本模块在浏览器内用真实 WebGL 离屏渲染 8 个机位，逐张读回像素：
//   · 前 / 后 / 左 / 右 / 斜 45°  → 多角度
//   · 俯视 +55° / 仰视 −30°       → 多高低
//   · 近距 / 远距（2.2×）          → 多距离
//   · 每机位检查非背景像素覆盖率与量化色彩数，杜绝「空画面 / 纯色贴脸 / 相机进模型」
// 通过后返回 8 张 PNG dataURL 缩略图，UI 直接可见，不是一句「验证通过」的假日志。
//
// 纪律：不修改主场景、不新增常驻 Mesh；渲染完立刻 setRenderTarget(null) 并 dispose；
//      Node / vitest 无 WebGL 时安全降级返回 ok:false，绝不抛错。
// ============================================================================
import * as THREE from 'three';

const W = 160, H = 160;
const BG: [number, number, number] = [11, 16, 24];

export interface ViewResult {
  id: string;
  label: string;
  azimuth: number;
  elevation: number;
  distance: number;
  coverage: number;
  colorBuckets: number;
  brightness: number;
  pass: boolean;
  note: string;
  shot: string;
}

export interface ValidationReport {
  ok: boolean;
  views: number;
  passed: number;
  total: number;
  shots: string[];
  details: ViewResult[];
  note: string;
  bounds: { x: number; y: number; z: number };
}

interface ViewSpec { id: string; label: string; az: number; el: number; dist: number }

/** 8 机位：角度 / 高低 / 距离三维覆盖 */
export const VALIDATION_VIEWS: ViewSpec[] = [
  { id: 'front', label: '正面 · 中距', az: 0, el: 12, dist: 1 },
  { id: 'back', label: '背面 · 中距', az: 180, el: 12, dist: 1 },
  { id: 'left', label: '左侧 · 中距', az: 90, el: 12, dist: 1 },
  { id: 'right', label: '右侧 · 中距', az: 270, el: 12, dist: 1 },
  { id: 'oblique', label: '斜 45° · 中距', az: 45, el: 22, dist: 1 },
  { id: 'top', label: '俯视 +55°', az: 20, el: 55, dist: 1 },
  { id: 'low', label: '仰视 −30°', az: 200, el: -30, dist: 1 },
  { id: 'far', label: '远景 · 2.2×', az: 135, el: 18, dist: 2.2 },
];

function pixelsToDataUrl(buf: Uint8Array): string {
  try {
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(W, H);
    // readRenderTargetPixels 是 bottom-up，这里翻回正常朝向
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = ((H - 1 - y) * W + x) * 4;
        const t = (y * W + x) * 4;
        img.data[t] = buf[s]; img.data[t + 1] = buf[s + 1];
        img.data[t + 2] = buf[s + 2]; img.data[t + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cvs.toDataURL('image/png');
  } catch { return ''; }
}

function analyze(buf: Uint8Array): { coverage: number; buckets: number; brightness: number } {
  let nonBg = 0, sum = 0;
  const colors = new Set<number>();
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]) > 28) nonBg++;
    sum += (r + g + b) / 3;
    colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
  }
  const n = W * H;
  return { coverage: nonBg / n, buckets: colors.size, brightness: sum / n };
}

/**
 * 对一件已锻造的资产做多机位离屏截图验证。
 * @param group forge() 返回的 group（只读，内部 clone）
 * @param renderer 游戏主 renderer（借用，不改状态）
 */
export function validateAsset(group: THREE.Object3D, renderer: THREE.WebGLRenderer): ValidationReport {
  const fallback = (note: string, size = { x: 0, y: 0, z: 0 }): ValidationReport => ({
    ok: false, views: 0, passed: 0, total: VALIDATION_VIEWS.length,
    shots: [], details: [], note, bounds: size,
  });
  if (!group || !renderer) return fallback('缺少资产或渲染器');

  let rt: THREE.WebGLRenderTarget | null = null;
  const prevTarget = renderer.getRenderTarget();
  try {
    const clone = group.clone(true);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG[0] / 255, BG[1] / 255, BG[2] / 255);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xfff2d0, 1.5);
    key.position.set(4, 7, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.6);
    fill.position.set(-5, 2, -4); scene.add(fill);
    scene.add(clone);

    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const bounds = { x: Math.round(size.x * 100) / 100, y: Math.round(size.y * 100) / 100, z: Math.round(size.z * 100) / 100 };
    if (!Number.isFinite(radius)) return fallback('包围盒无效', bounds);

    rt = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
    });
    const cam = new THREE.PerspectiveCamera(42, 1, 0.01, radius * 60);
    const buf = new Uint8Array(W * H * 4);
    const details: ViewResult[] = [];
    const shots: string[] = [];

    renderer.setRenderTarget(rt);
    for (const v of VALIDATION_VIEWS) {
      const az = v.az * Math.PI / 180, el = v.el * Math.PI / 180;
      const dist = radius * 3.1 * v.dist;
      cam.position.set(
        center.x + Math.sin(az) * Math.cos(el) * dist,
        center.y + Math.sin(el) * dist,
        center.z + Math.cos(az) * Math.cos(el) * dist,
      );
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      const a = analyze(buf);
      const pass = a.coverage > 0.015 && a.buckets >= 3;
      const shot = pixelsToDataUrl(buf);
      if (shot) shots.push(shot);
      details.push({
        id: v.id, label: v.label, azimuth: v.az, elevation: v.el, distance: v.dist,
        coverage: Math.round(a.coverage * 10000) / 10000,
        colorBuckets: a.buckets, brightness: Math.round(a.brightness),
        pass, note: pass ? '画面有内容且非纯色' : (a.coverage <= 0.015 ? '疑似空画面' : '疑似纯色/贴脸'),
        shot,
      });
    }
    renderer.setRenderTarget(prevTarget);
    rt.dispose(); rt = null;
    const passed = details.filter((d) => d.pass).length;
    return {
      ok: passed >= 6 && shots.length >= 6,
      views: details.length, passed, total: VALIDATION_VIEWS.length,
      shots, details,
      note: passed >= 6 ? `8 机位截图验证通过 ${passed}/8` : `8 机位仅 ${passed}/8 通过，需检查几何`,
      bounds,
    };
  } catch (err) {
    if (rt) { try { rt.dispose(); } catch { /* ignore */ } }
    try { renderer.setRenderTarget(prevTarget); } catch { /* ignore */ }
    return fallback('离屏渲染不可用：' + (err instanceof Error ? err.message : String(err)));
  }
}
