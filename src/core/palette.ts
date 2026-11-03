import * as THREE from 'three';
import { bus } from './rng';

// 暮色霓虹 + 昼夜循环：所有颜色/灯强随相位插值
// phase: 0=黄昏(默认开局) → 0.30=夜 → 0.55=深夜 → 0.80=黎明 → 1=黄昏（循环）
export interface PhaseKey { dusk: number; night: number; deep: number; dawn: number; }

interface Stop {
  at: number;
  skyTop: number; skyMid: number; skyBot: number; fog: number; fogDensity: number;
  sun: number; sunColor: number; sunI: number; fillI: number;
  hemiSky: number; hemiGround: number; hemiI: number;
  neon: number;       // 霓虹/发光体亮度系数
  bloom: number;      // bloom strength
  ambient: number;    // 环境加亮
}

// skyMid 是「地平线暖光 → 天顶冷蓝」之间那一档：旧版只给两色，mix() 在线性空间
// 直接对插，橙(196,118,74) 与蓝(46,64,102) 在中点几乎互补 ⇒ 低仰角稳定落进中性灰紫
// (实测 c_air 天空 ROI 均值 85,62,80 / H=315)，就是「浑浊紫褐」的来源。
// 改成三段：地平暖橙 → 亮蓝灰霾带 → 天顶蓝，暖冷之间永远经过一个高亮度色，
// 不再停在低亮度中性紫。
const STOPS: Stop[] = [
  { at: 0.00, skyTop: 0x2f5f9e, skyMid: 0xa9c6e0, skyBot: 0xe8924e, fog: 0xa8927e, fogDensity: 0.00009, sun: 0xff8a3c, sunColor: 0xff9a4a, sunI: 1.35, hemiSky: 0x6a80c0, hemiGround: 0x4a3a32, hemiI: 0.68, fillI: 0.2, neon: 0.85, bloom: 0.78, ambient: 0.24 },
  { at: 0.30, skyTop: 0x121a33, skyMid: 0x1c2946, skyBot: 0x243154, fog: 0x1a2438, fogDensity: 0.00012, sun: 0x8fb2ff, sunColor: 0x9db8ff, sunI: 0.5, hemiSky: 0x28336e, hemiGround: 0x141220, hemiI: 0.5, fillI: 0.12, neon: 1.12, bloom: 0.85, ambient: 0.25 },
  { at: 0.55, skyTop: 0x0e1426, skyMid: 0x18213a, skyBot: 0x1f2942, fog: 0x141c30, fogDensity: 0.00013, sun: 0x7c96e8, sunColor: 0x8aa4f0, sunI: 0.3, hemiSky: 0x1c244c, hemiGround: 0x0e0e1a, hemiI: 0.45, fillI: 0.1, neon: 1.22, bloom: 0.9, ambient: 0.22 },
  { at: 0.80, skyTop: 0x33538c, skyMid: 0xaec9e2, skyBot: 0xec9a5e, fog: 0xae9884, fogDensity: 0.00009, sun: 0xffc98a, sunColor: 0xffbe7a, sunI: 1.28, hemiSky: 0x7a8ac2, hemiGround: 0x54433c, hemiI: 0.66, fillI: 0.18, neon: 0.7, bloom: 0.74, ambient: 0.24 },
  { at: 1.00, skyTop: 0x2f5f9e, skyMid: 0xa9c6e0, skyBot: 0xe8924e, fog: 0xa8927e, fogDensity: 0.00009, sun: 0xff8a3c, sunColor: 0xff9a4a, sunI: 1.35, hemiSky: 0x6a80c0, hemiGround: 0x4a3a32, hemiI: 0.68, fillI: 0.2, neon: 0.85, bloom: 0.78, ambient: 0.24 },
];

const _cA = new THREE.Color(), _cB = new THREE.Color();

export class TimeOfDay {
  phase = 0;                 // 0..1
  speed = 1 / 420;           // 一整昼夜 7 分钟；可暂停
  paused = true;             // 默认停在黄昏，玩家可开启循环
  neon = 1; bloom = 1; ambient = 0.3;
  readonly skyTop = new THREE.Color();
  readonly skyMid = new THREE.Color();
  readonly skyBot = new THREE.Color();
  readonly fogColor = new THREE.Color();
  fogDensity = 0.002;
  sunColor = new THREE.Color();
  sunI = 1; hemiI = 0.5; fillI = 0.18;
  private cur = STOPS[0]; private nxt = STOPS[1];

  constructor() { this.apply(0); }

  private apply(p: number): void {
    let i = 0;
    while (i < STOPS.length - 2 && p > STOPS[i + 1].at) i++;
    const a = STOPS[i], b = STOPS[i + 1];
    const k = THREE.MathUtils.clamp((p - a.at) / (b.at - a.at), 0, 1);
    const e = k * k * (3 - 2 * k);
    this.cur = a; this.nxt = b;
    this.skyTop.copy(_cA.setHex(a.skyTop).lerp(_cB.setHex(b.skyTop), e));
    this.skyMid.copy(_cA.setHex(a.skyMid).lerp(_cB.setHex(b.skyMid), e));
    this.skyBot.copy(_cA.setHex(a.skyBot).lerp(_cB.setHex(b.skyBot), e));
    this.fogColor.copy(_cA.setHex(a.fog).lerp(_cB.setHex(b.fog), e));
    this.fogDensity = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, e);
    this.sunColor.copy(_cA.setHex(a.sunColor).lerp(_cB.setHex(b.sunColor), e));
    this.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, e);
    this.fillI = THREE.MathUtils.lerp(a.fillI, b.fillI, e);
    this.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, e);
    this.neon = THREE.MathUtils.lerp(a.neon, b.neon, e);
    this.bloom = THREE.MathUtils.lerp(a.bloom, b.bloom, e);
    this.ambient = THREE.MathUtils.lerp(a.ambient, b.ambient, e);
  }

  /** label: 'dusk'|'night'|'deep'|'dawn' 直接跳转 */
  jump(label: 'dusk' | 'night' | 'deep' | 'dawn'): void {
    this.phase = { dusk: 0, night: 0.3, deep: 0.55, dawn: 0.8 }[label];
    this.apply(this.phase);
    bus.emit('time:phase', label);
  }

  update(dt: number): void {
    if (this.paused) return;
    this.phase = (this.phase + dt * this.speed) % 1;
    this.apply(this.phase);
  }

  /** 当前档位名（UI 显示用） */
  label(): string {
    if (this.paused) {
      if (this.phase < 0.15 || this.phase > 0.92) return '黄昏';
      if (this.phase < 0.42) return '夜晚';
      if (this.phase < 0.68) return '深夜';
      return '黎明';
    }
    return '昼夜循环中';
  }
}
