import { bus } from '../core/rng';

// ============ WebAudio 全合成音景（零音频文件） ============
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private clapperT = 8;
  private murmurT = 0; private pluckT = 3;
  enabled = true;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.enabled ? 0.55 : 0;
      master.connect(ctx.destination);
      this.master = master;
      // 噪声缓冲
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // 风
      this.loopNoise(320, 0.05);
      // 水声
      this.loopNoise(720, 0.028);
      // 霓虹电流微鸣
      const hum = ctx.createOscillator();
      hum.frequency.value = 50; hum.type = 'sine';
      const humG = ctx.createGain(); humG.gain.value = 0.012;
      hum.connect(humG); humG.connect(master); hum.start();

      // 交互层事件音：此前只有 5 类剧本音（雷/鼓/爆/钟/梵唱），
      // 玩家每一次传送、开面板、取物都没有任何听觉反馈——「音效」这一域等于半套。
      bus.on('sfx:ui', () => this.click());
      bus.on('sfx:teleport', () => this.whoosh());
      bus.on('sfx:pick', () => this.pickup());
      bus.on('sfx:step', (run?: unknown) => this.step(run === true));
      bus.on('sfx:codex', () => this.paper());
      bus.on('realm:change', (r: unknown) => this.setRealm(String(r)));
      bus.on('sfx:thunder', () => this.burst(120, 1.1, 0.5, 240));
      bus.on('sfx:drum', () => this.kick());
      bus.on('sfx:boom', () => this.burst(700, 0.6, 0.3, 300));
      bus.on('sfx:gong', () => this.gong());
      bus.on('sfx:buddha', () => this.choir());
    } catch { this.started = false; }
  }

  private loopNoise(freq: number, gain: number): void {
    const ctx = this.ctx!, master = this.master!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = gain * 0.5;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); lfo.start();
  }

  private burst(freq: number, dur: number, gain: number, sweep = 0): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq - sweep), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + dur + 0.05);
  }

  private kick(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + 0.36);
  }

  private gong(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    for (const f0 of [196, 199, 311]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f0;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f0 * 2; bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.2);
      o.connect(bp); bp.connect(g); g.connect(this.master);
      o.start(); o.stop(ctx.currentTime + 2.3);
    }
  }

  private choir(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    for (const f0 of [130.8, 164.8, 196, 261.6]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 1.2);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 5);
      o.connect(g); g.connect(this.master);
      o.start(); o.stop(ctx.currentTime + 5.2);
    }
  }

  private pluck(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
    const f0 = scale[Math.floor(Math.random() * scale.length)];
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f0;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f0 * 2.005;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + 1.6);
    o2.start(); o2.stop(ctx.currentTime + 1.6);
  }

  private murmur(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.4 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 700; bp.Q.value = 2.4;
    const g = ctx.createGain();
    const dur = 0.25 + Math.random() * 0.5;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.035, ctx.currentTime + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + dur + 0.05);
  }

  update(dt: number, neon = 1): void {
    if (!this.ctx || !this.enabled) return;
    // 精修8：声景时段化——夜市喧闹（人声密/琴稀）、白日收敛、深夜梆子（更点）
    const night = neon > 0.8, deep = neon > 1.15;
    if (this.master) this.master.gain.value = night ? 0.55 : 0.4;
    this.murmurT -= dt;
    if (this.murmurT <= 0) { this.murmurT = (night ? 0.4 : 1.2) + Math.random() * (night ? 1.6 : 2.0); this.murmur(); }
    this.pluckT -= dt;
    if (this.pluckT <= 0) { this.pluckT = (night ? 7 : 5) + Math.random() * 9; this.pluck(); }
    this.clapperT -= dt;
    if (deep && this.clapperT <= 0) { this.clapperT = 12 + Math.random() * 6; this.burst(96, 0.5, 0.22, 30); this.burst(92, 0.5, 0.18, 30); } // 梆·梆 两点
  }

  // ---- 三界音轨：人间（风+水+人声）/ 天宫（高空风+钟磬泛音）/ 地府（低频嗡鸣+水滴） ----
  private realm = 'renjian';
  private realmLayers: { drone?: OscillatorNode; droneG?: GainNode } = {};

  setRealm(realm: string): void {
    if (realm === this.realm) return;
    this.realm = realm;
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    // 旧层淡出
    if (this.realmLayers.droneG && this.realmLayers.drone) {
      const g = this.realmLayers.droneG, o = this.realmLayers.drone;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.6);
      try { o.stop(ctx.currentTime + 1.8); } catch { /* 已经停过 */ }
      this.realmLayers = {};
    }
    const base = realm === 'difu' ? 41.2 : realm === 'tiangong' ? 98 : 0;
    if (base > 0) {
      const o = ctx.createOscillator();
      o.type = realm === 'difu' ? 'sawtooth' : 'sine';
      o.frequency.value = base;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = realm === 'difu' ? 180 : 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(realm === 'difu' ? 0.06 : 0.03, ctx.currentTime + 1.8);
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start();
      this.realmLayers = { drone: o, droneG: g };
      // 天宫：钟磬泛音（五度叠置，稀疏）
      if (realm === 'tiangong') {
        for (const f of [392, 588, 784]) {
          const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f;
          const bg = ctx.createGain();
          bg.gain.setValueAtTime(0.0001, ctx.currentTime + 0.4);
          bg.gain.linearRampToValueAtTime(0.012, ctx.currentTime + 2.4);
          bg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 7);
          b.connect(bg); bg.connect(master); b.start(); b.stop(ctx.currentTime + 7.2);
        }
      }
    }
  }

  /** 面板开合：短促木质轻响 */
  private click(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.1);
  }

  /** 传送：由低到高的气声 + 一道泛音，给「腾空换界」一个听得出的位移 */
  private whoosh(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + 0.8);
    this.pluck();
  }

  /** 脚步：低频短促落地声（跑动更沉更短），按调用方节流 */
  private step(run: boolean): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = run ? 1.5 : 1.1;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = run ? 420 : 300;
    const g = ctx.createGain();
    const dur = run ? 0.09 : 0.12;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(run ? 0.075 : 0.05, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + dur + 0.02);
  }

  /** 取物：两声上行小铃 */
  private pickup(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.07;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + 0.4);
    });
  }

  /** 翻图鉴：纸页摩擦 */
  private paper(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + 0.25);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }
}
