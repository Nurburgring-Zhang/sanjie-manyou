import * as THREE from 'three';
import { bus } from '../core/rng';

// ============ 战斗/氛围特效：粒子池 + 冲击环 + 闪电 + 金掌 + 宝塔 + 焰火 ============
const MAX_P = 3600;

export class Vfx {
  private pts: THREE.Points;
  private pPos: Float32Array; private pCol: Float32Array; private pSize: Float32Array; private pAlpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private age: Float32Array; private grav: Float32Array;
  private pCursor = 0;
  private rings: THREE.InstancedMesh; private ringData: { p: THREE.Vector3; maxR: number; age: number; dur: number; hex: number }[] = [];
  private bolts: THREE.LineSegments; private boltT = 0;
  private flash: THREE.PointLight;
  private palm: THREE.Group; private palmT = 0; private palmDur = 5;
  private tower: THREE.Group; private towerT = 0; private towerDur = 6;
  private columns: { m: THREE.Mesh; t: number; dur: number }[] = [];
  private petals = 0; private embersAt: THREE.Vector3[] = []; private fallsAt: THREE.Vector3[] = [];
  private tmpM = new THREE.Matrix4(); private tmpC = new THREE.Color();
  private tmpQ = new THREE.Quaternion(); private tmpS = new THREE.Vector3(); private tmpV = new THREE.Vector3();
  private tmpE = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    // 粒子
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pSize = new Float32Array(MAX_P);
    this.pAlpha = new Float32Array(MAX_P);
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);
    this.age = new Float32Array(MAX_P);
    this.grav = new Float32Array(MAX_P);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA;
        void main(){
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 320.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.08, d) * vA;
          gl_FragColor = vec4(vC, a);
        }`,
    });
    this.pts = new THREE.Points(g, m);
    this.pts.frustumCulled = false;
    scene.add(this.pts);

    // 冲击环
    this.rings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.045, 6, 48),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      24,
    );
    this.rings.frustumCulled = false;
    scene.add(this.rings);

    // 闪电
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3));
    this.bolts = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 1, toneMapped: false }));
    this.bolts.visible = false;
    this.bolts.frustumCulled = false;
    scene.add(this.bolts);
    this.flash = new THREE.PointLight(0xcfe8ff, 0, 600, 1.6);
    scene.add(this.flash);

    this.palm = this.buildPalm();
    scene.add(this.palm);
    this.palm.visible = false;
    this.palm.position.set(0, -9999, 0); // 同 tower：隐身时沉出世界，防 Raycaster 命中
    this.tower = this.buildTower();
    scene.add(this.tower);
    this.tower.visible = false;
    this.tower.position.set(0, -9999, 0); // 隐身时沉出世界：Raycaster 不查 visible，会命中藏在原点的未召唤天劫灯塔

    for (let i = 0; i < 4; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 3.2, 1, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      );
      col.visible = false;
      scene.add(col);
      this.columns.push({ m: col, t: 0, dur: 0 });
    }

    bus.on('fx:firework', (p) => {
      const q = p as { x: number; y: number; z: number };
      this.firework(q.x, q.y, q.z);
    });
  }

  private buildPalm(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: 0.92, toneMapped: false });
    const palmBox = new THREE.Mesh(new THREE.BoxGeometry(26, 5, 30), mat);
    g.add(palmBox);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.4, 9), mat);
      f.position.set(-10 + i * 5, 3.6, 17);
      f.rotation.x = -0.25;
      g.add(f);
    }
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 26, 12), mat);
    wrist.position.y = -15;
    g.add(wrist);
    return g;
  }

  private buildTower(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.95, toneMapped: false });
    const dark = new THREE.MeshBasicMaterial({ color: 0x8a5a1a, transparent: true, opacity: 0.95, toneMapped: false });
    let w = 7;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.82, w, 4.2, 8), dark);
      seg.position.y = i * 5;
      g.add(seg);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(w + 1.6, w + 2.6, 1.2, 8), mat);
      roof.position.y = i * 5 + 2.6;
      g.add(roof);
      w *= 0.86;
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), mat);
    tip.position.y = 22;
    g.add(tip);
    return g;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, hex: number, size: number, life: number, grav = 0): void {
    const i = this.pCursor = (this.pCursor + 1) % MAX_P;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.tmpC.setHex(hex);
    this.pCol[i * 3] = this.tmpC.r; this.pCol[i * 3 + 1] = this.tmpC.g; this.pCol[i * 3 + 2] = this.tmpC.b;
    this.pSize[i] = size; this.pAlpha[i] = 1;
    this.life[i] = this.age[i] = life;
    this.grav[i] = grav;
  }

  burst(p: THREE.Vector3, count: number, hex: number, speed = 8, life = 0.9, size = 1.4, grav = 4): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + speed * 0.3, Math.sin(a) * Math.cos(b) * s, hex, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), grav);
    }
  }

  ring(p: THREE.Vector3, hex: number, maxR = 14, dur = 0.8): void {
    if (this.ringData.length >= 24) this.ringData.shift();
    this.ringData.push({ p: p.clone(), maxR, age: 0, dur, hex });
  }

  bolt(a: THREE.Vector3, b: THREE.Vector3): void {
    const pos = this.bolts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const jx = () => (Math.random() - 0.5) * 3.4;
      pos.setXYZ(i * 2, a.x + (b.x - a.x) * t0 + jx(), a.y + (b.y - a.y) * t0 + jx(), a.z + (b.z - a.z) * t0 + jx());
      pos.setXYZ(i * 2 + 1, a.x + (b.x - a.x) * t1 + jx(), a.y + (b.y - a.y) * t1 + jx(), a.z + (b.z - a.z) * t1 + jx());
    }
    pos.needsUpdate = true;
    this.bolts.visible = true;
    this.boltT = 0.22;
    this.flash.position.copy(b);
    this.flash.intensity = 900;
    bus.emit('sfx:thunder');
  }

  palmAt(p: THREE.Vector3): void {
    this.palm.position.set(p.x, p.y + 90, p.z);
    this.palm.visible = true;
    this.palmT = 0;
    bus.emit('sfx:gong');
  }

  towerAt(p: THREE.Vector3): void {
    this.tower.position.set(p.x, p.y + 70, p.z);
    this.tower.visible = true;
    this.towerT = 0;
    bus.emit('sfx:gong');
  }

  column(p: THREE.Vector3, hex: number, dur = 2.4, h = 60): void {
    const c = this.columns.find((x) => !x.m.visible) ?? this.columns[0];
    (c.m.material as THREE.MeshBasicMaterial).color.setHex(hex);
    c.m.scale.set(1, h, 1);
    c.m.position.set(p.x, p.y + h / 2, p.z);
    c.m.visible = true;
    c.t = 0; c.dur = dur;
  }

  firework(x: number, y: number, z: number): void {
    const hexes = [0xff5a3c, 0x00e5ff, 0xff2d95, 0xffb300, 0x7dff9c];
    const h = hexes[Math.floor(Math.random() * hexes.length)];
    const p = new THREE.Vector3(x, y, z);
    this.burst(p, 90, h, 13, 1.7, 1.5, 5);
    this.burst(p, 40, 0xfff2c8, 7, 1.2, 1.1, 4);
    this.ring(p, h, 16, 0.7);
    bus.emit('sfx:boom');
  }

  addEmberSource(p: THREE.Vector3): void { this.embersAt.push(p.clone()); }
  setPetals(rate: number): void { this.petals = rate; }
  addWaterfall(p: THREE.Vector3): void { this.fallsAt.push(p.clone()); }

  update(dt: number): void {
    // 粒子积分
    const posA = this.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) { if (this.pAlpha[i] !== 0) { this.pAlpha[i] = 0; } continue; }
      this.age[i] -= dt;
      if (this.age[i] <= 0) { this.life[i] = 0; this.pAlpha[i] = 0; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= 1 - dt * 0.6; this.vel[i * 3 + 2] *= 1 - dt * 0.6;
      this.pPos[i * 3] += this.vel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.pAlpha[i] = Math.min(1, this.age[i] / this.life[i] * 1.6);
    }
    posA.needsUpdate = true;
    (this.pts.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;

    // 冲击环
    const zero = this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < 24; i++) this.rings.setMatrixAt(i, zero);
    this.ringData.forEach((r, i) => {
      r.age += dt;
      const k = r.age / r.dur;
      if (k >= 1) return;
      const rad = 0.5 + k * r.maxR;
      this.tmpM.compose(this.tmpV.set(r.p.x, r.p.y, r.p.z), this.tmpQ.setFromEuler(this.tmpE.set(-Math.PI / 2, 0, 0)), this.tmpS.set(rad, rad, 1 + k * 0.6));
      this.rings.setMatrixAt(i, this.tmpM);
      const fade = 1 - k;
      this.tmpC.setHex(r.hex).multiplyScalar(fade * 1.2);
      this.rings.setColorAt(i, this.tmpC);
    });
    this.ringData = this.ringData.filter((r) => r.age < r.dur);
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    // 闪电
    if (this.boltT > 0) {
      this.boltT -= dt;
      (this.bolts.material as THREE.LineBasicMaterial).opacity = Math.max(0, this.boltT / 0.22);
      this.flash.intensity *= 1 - dt * 6;
      if (this.boltT <= 0) { this.bolts.visible = false; this.flash.intensity = 0; }
    }

    // 金掌 / 宝塔
    if (this.palm.visible) {
      this.palmT += dt;
      const k = this.palmT / this.palmDur;
      this.palm.position.y -= dt * (k < 0.4 ? 16 : 3);
      this.palm.rotation.y += dt * 0.15;
      (this.palm.children[0] as THREE.Mesh).material;
      const mat = ((this.palm.children[0] as THREE.Mesh).material) as THREE.MeshBasicMaterial;
      mat.opacity = k > 0.8 ? (1 - k) * 5 : 0.92;
      if (k >= 1) { this.palm.visible = false; this.palm.position.set(0, -9999, 0); }
    }
    if (this.tower.visible) {
      this.towerT += dt;
      const k = this.towerT / this.towerDur;
      this.tower.position.y -= dt * (k < 0.5 ? 13 : 2);
      this.tower.rotation.y += dt * 0.3;
      if (k >= 1) { this.tower.visible = false; this.tower.position.set(0, -9999, 0); }
    }

    // 光柱
    for (const c of this.columns) {
      if (!c.m.visible) continue;
      c.t += dt;
      const mat = c.m.material as THREE.MeshBasicMaterial;
      const k = c.t / c.dur;
      mat.opacity = k < 0.2 ? k * 3 : Math.max(0, (1 - k) * 1.4);
      if (k >= 1) c.m.visible = false;
    }

    // 花瓣 / 炉火余烬
    if (this.petals > 0 && Math.random() < this.petals) {
      this.spawn(-150 + Math.random() * 90, 206 + Math.random() * 8, 10 + Math.random() * 70, (Math.random() - 0.5) * 1.5, -0.8 - Math.random(), (Math.random() - 0.5) * 1.5, 0xff9ac8, 0.9, 7, 0.06);
    }
    for (const e of this.embersAt) {
      if (Math.random() < 0.35) this.spawn(e.x + (Math.random() - 0.5) * 1.6, e.y, e.z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.6, 1.6 + Math.random() * 1.6, (Math.random() - 0.5) * 0.6, Math.random() < 0.5 ? 0xff7a2d : 0xffc94a, 0.7, 1.6, -0.4);
    }
    for (const f of this.fallsAt) {
      for (let k = 0; k < 3; k++) this.spawn(f.x + (Math.random() - 0.5) * 2.2, f.y, f.z + (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 0.4, -13 - Math.random() * 4, (Math.random() - 0.5) * 0.4, Math.random() < 0.7 ? 0xbfe8ff : 0xe8f8ff, 1.1, 1.5, 0);
    }
  }
}
