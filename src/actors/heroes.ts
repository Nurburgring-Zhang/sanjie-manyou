import * as THREE from 'three';
import { Crowd } from './crowd';
import { Baker, shade } from '../city/bake';
import { RNG } from '../core/rng';
import { SHUIHU_ALL, STATION } from '../data/shuihu';
import { HERO_CARDS } from '../data/shuihuCards';
import { bridgeDeckY } from '../city/layout';
import { StallInfo } from '../city/props';
import { bus } from '../core/rng';

// ============ 108 将驻场编排（20 卷 5.4 逐将坐标 + 42 卷角色卡） ============
const A = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const ANCHORS: Record<string, THREE.Vector3> = {
  bridge: A(3.4, bridgeDeckY(18), 18), bridge2: A(-3.4, bridgeDeckY(-16), -16), bridge3: A(2.6, bridgeDeckY(-2), -2),
  market: A(246, 0, 78), market2: A(210, 0, 70), market3: A(300, 0, 66), market4: A(160, 0, 80),
  wharf: A(-238, 0.95, 34), wharf2: A(-252, 0.95, 34), wharf3: A(-222, 0.95, 35),
  sunyang: A(226, 0, 56), shiqian: A(122, 0, 57), teahouse: A(-36, 0, 56), taoist: A(540, 0, 110),
  goulan: A(298, 1.85, 78), gate: A(470, 0, 58), gate2: A(452, 0, 46), gate3: A(476, 0, 47),
  southbank: A(-40, 0, -66), river: A(-160, -1.05, 12), roof: A(150, 7.0, 59),
  letter: A(330, 0, 60), clinic: A(168, 0, 63), firework: A(-238, 0, 34), duel: A(30, 0, 44),
  // 柳林 C-GZ-043：2026-11-01 巡检把「倒拔垂杨柳」的柳树从 (−450,78) 南移到 (−450,80.5)。
  // 原坐标正好落在村口宅院的院墙线上（实测 city_wall 面在 z=78.63、高 2.6m）：树长在墙里，
  // 从郊野机位（−450,7,96）看只剩一团悬在墙头的树冠、看不到树干。南移 2.5m 后树干完全露出，
  // 茶亭已同步西移到 (−462,78)（architecture.ts），两者相距 12m 互不穿插。
  smithy: A(380, 0, 62), tree: A(-450, 0, 80.5), veg: A(90, 0, 62), kitchen1: A(0, 0, 0), kitchen2: A(0, 0, 0), kitchen3: A(0, 0, 0),
};

/** 汴河泳将（v1 偏差：石碣村/巨泽水域贴水属 B9 生物批，暂留汴河泳道） */
const SWIM_RIVER = new Set(['阮小五', '童威', '童猛']);
/** 州桥卖刀：桥面高程（州桥与虹桥同址 x=0 跨汴河，代码现实） */
const BRIDGE_HEROES = new Set(['杨志']);
/** 20 卷坐标=建筑中心的 6 员：落门前街面（实心地标无内饰，B1 只改三座） */
const DOOR_FRONT: Record<string, [number, number]> = {
  吴用: [-36, 56.5], 公孙胜: [540, 110], 蒋敬: [258, 58.5],
  安道全: [168, 58.5], 鲍旭: [352, 58.8], 宋江: [561, -11.5],
};

interface Runner { aId: number; pts: THREE.Vector3[]; i: number; speed: number }

export class HeroStage {
  runners: Runner[] = [];
  tree!: THREE.Group;
  private fireworkT = 6;
  private luZhiShen: Actor3 | null = null;

  constructor(private crowd: Crowd, rng: RNG, stalls: StallInfo[], heightAt?: ((x: number, z: number) => number) | null, waterAt?: (x: number, z: number) => number | null) {
    const foods = stalls.filter((s) => s.kind === 'food');
    const goods = stalls.filter((s) => s.kind === 'stall');
    ANCHORS['kitchen1'] = A(foods[0]?.x ?? 150, 0.1, foods[0]?.z ?? 72);
    ANCHORS['kitchen2'] = A(foods[1]?.x ?? -60, 0.1, foods[1]?.z ?? -66);
    ANCHORS['kitchen3'] = A(foods[2]?.x ?? 200, 0.1, foods[2]?.z ?? 84);
    ANCHORS['veg'] = A(goods[0]?.x ?? 90, 0.1, goods[0]?.z ?? 66);

    SHUIHU_ALL.forEach((h, i) => {
      const [name, nick, weapon, cloth, pants, action, anchor] = h;
      const st0 = STATION[name];
      const st = DOOR_FRONT[name] ?? st0;
      const base = SWIM_RIVER.has(name) ? (ANCHORS[anchor] ?? ANCHORS.market)
        : st ? A(st[0], 0, st[1]) : (ANCHORS[anchor] ?? ANCHORS.market);
      const card = HERO_CARDS.find((k) => k.name === name);
      // 42 卷身长归一：st(米)/1.72 标准 = 池 scale；无卡者回落绰号通则
      const scale = card ? card.st / 1.72
        : (nick.includes('金刚') || nick.includes('险道神') ? 1.16
          : nick.includes('矮脚') || nick.includes('矮星') ? 0.86
          : nick.includes('虎') ? 1.08 : undefined);
      // 出生贴地：城内 heightAt≈0，天山/草原等远点落在山体地表；巨泽等水域钳到水面（渔家涉水/船板）
      if (!SWIM_RIVER.has(name) && !BRIDGE_HEROES.has(name) && heightAt) {
        base.y = heightAt(base.x, base.z);
        const wl = waterAt ? waterAt(base.x, base.z) : null;
        if (wl != null) base.y = Math.max(base.y, wl + 0.15);
      }
      const ring = 1.4 + (i % 7) * 0.55;
      const ang = i * 2.39996;
      const pos = base.clone().add(new THREE.Vector3(Math.cos(ang) * ring * 0.6, 0, Math.sin(ang) * ring));
      // 环形偏移后重采样贴地（陡坡上偏移前采样会离地/入地）
      if (!SWIM_RIVER.has(name) && !BRIDGE_HEROES.has(name) && name !== '武松' && name !== '时迁' && heightAt) {
        pos.y = heightAt(pos.x, pos.z);
        const wl = waterAt ? waterAt(pos.x, pos.z) : null;
        if (wl != null) pos.y = Math.max(pos.y, wl + 0.15);
      }
      const a = this.crowd.spawnActor({
        occ: 'customer', pos, yaw: rng.range(0, Math.PI * 2),
        hat: nick.includes('行者') ? 0 : (nick.includes('和尚') ? 3 : (i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : 3)),
        prop: weapon === '无' ? null : weapon,
        cloth, pants, action,
        scale,
        freeze: true, // 名将驻场定桩：动作签名照演、位置不被市井行为拉走（42 卷「驻城位与日常」）
        doing: `${nick}·${name}：${card ? card.quote : h[7]}`,
        data: { name, nick, group: 'shuihu', weapon, desc: card ? `${card.trait}｜${card.prop}` : h[7], code: `sh_${i}` },
      });
      if (SWIM_RIVER.has(name)) a.pos.y = -1.05;
      if (BRIDGE_HEROES.has(name)) a.pos.y = bridgeDeckY(a.pos.z); // 用偏移后 z 取桥面高程
      if (name === '时迁') a.pos.set(306, 8.0, 86.5); // 瓦子棚顶中段（大顶 z∈[64.5,91.5] 内，20 卷 5.4-#105 潜行线）
      if (name === '武松') a.pos.set(223.6, 0.72, 62.2); // 孙羊正店 R03 酒垆柜台前（47 卷 R03）
      this.crowd.heroes.push(a);
      if (name === '戴宗') {
        // 神行太保御街送信：递铺(0,1500)↔州桥一线（20 卷 5.4-#20 跑腿任务线）
        this.runners.push({ aId: a.id, pts: [A(0, 0, 1500), A(0, 0, 900), A(0, 0, 300), A(0, 0, 900), A(0, 0, 1500)], i: 0, speed: 6.4 });
      }
      if (name === '宋江') {
        for (let g = 0; g < 2; g++) {
          const guard = this.crowd.spawnActor({ occ: 'soldier', prop: 'spear', pos: pos.clone().add(new THREE.Vector3(g ? 1.1 : -1.1, 0, -1.4)) });
          const leader = a;
          guard.freeze = true; guard.action = 'walk';
          guard.attach = (out) => {
            out.pos.set(leader.pos.x + (g ? 1.1 : -1.1), leader.pos.y, leader.pos.z);
            out.yaw = leader.yaw; out.y = leader.pos.y;
          };
        }
      }
    });

    // 说书场景 ×2：说书人 + 听客半圆
    for (const [sx, sz, sy] of [[-30, 42, 0], [306, 70, 0]] as const) {
      this.crowd.spawnStation('storyteller', sx, sz, sy, 'chat', '拍案说书', Math.PI, { name: '说书人', nick: '评话', group: 'job', desc: '醒木一拍话古今', code: 'story' + sx });
      for (let k = 0; k < 6; k++) {
        const ang = Math.PI + (k - 2.5) * 0.42;
        this.crowd.spawnStation('sitter', sx + Math.sin(ang + Math.PI) * 2.6, sz + Math.cos(ang + Math.PI) * 2.6, sy, k % 3 === 2 ? 'sitNap' : 'sitTea', '听说书', ang);
      }
    }
    // 医铺病人
    this.crowd.spawnStation('sitter', 166.4, 62.4, 0.2, 'lieSleep', '候诊卧榻', 1.2);
    // 倒拔垂杨柳的树（柳林 C-GZ-043 (-450,78)，鲁智深卡 42 卷 #13）
    this.buildTree(ANCHORS.tree);
    // 牛二事件支线：泼皮纠缠杨志（42 卷 N25 滚刀肉 + CH-C-017 卖刀线）
    const yz = STATION['杨志'];
    this.crowd.spawnStation('brawler', yz[0] + 2.2, yz[1] + 1.6, bridgeDeckY(yz[1]), 'argue', '牛二缠刀：这刀凭甚卖三百贯？', 2.4,
      { name: '牛二', nick: '没毛大虫', group: 'job', desc: '京师泼皮，专在州桥耍赖', code: 'niuer' });
  }

  private buildTree(p: THREE.Vector3): void {
    const g = new THREE.Group();
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e6a3a });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 4.6, 6), woodMat);
    trunk.position.y = 2.3; trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 2.8, 6, 1, true), leafMat);
      f.position.set(Math.cos(a) * 1.0, 4.2 + (i % 2) * 0.5, Math.sin(a) * 1.0);
      g.add(f);
    }
    g.position.copy(p);
    g.name = 'willow_uprooted';
    this.tree = g;
    this.crowd.poolSet().scene.add(g);
  }

  byId(id: number): Actor3 | undefined { return this.crowd.actors.find((a) => a.id === id) as Actor3 | undefined; }

  update(t: number, dt: number): void {
    for (const r of this.runners) {
      const a = this.byId(r.aId);
      if (!a) continue;
      const tgt = r.pts[r.i];
      const dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) { r.i = (r.i + 1) % r.pts.length; continue; }
      a.pos.x += (dx / d) * r.speed * dt;
      a.pos.z += (dz / d) * r.speed * dt;
      a.pos.y = tgt.y;
      const ty = Math.atan2(dx, dz);
      let dyw = ty - a.yaw;
      while (dyw > Math.PI) dyw -= Math.PI * 2;
      while (dyw < -Math.PI) dyw += Math.PI * 2;
      a.yaw += dyw * Math.min(1, dt * 5);
    }
    // 树随鲁智深发力摇摆
    if (!this.luZhiShen) this.luZhiShen = this.crowd.actors.find((x) => x.data?.name === '鲁智深') ?? null;
    const lu = this.luZhiShen;
    if (lu && this.tree) {
      const eff = Math.abs(Math.sin(lu.actT * 0.8 * Math.PI));
      this.tree.rotation.z = eff * 0.16;
      this.tree.position.y = ANCHORS.tree.y + eff * 0.42;
      this.tree.rotation.x = Math.sin(lu.actT * 1.7) * 0.05 * eff;
    }
    // 凌振焰火（码头炮位 20 卷 5.4-#52）
    this.fireworkT -= dt;
    if (this.fireworkT <= 0) {
      this.fireworkT = 9 + Math.random() * 6;
      bus.emit('fx:firework', { x: -238 + (Math.random() - 0.5) * 24, y: 26 + Math.random() * 14, z: 34 });
    }
    void t;
  }
}
type Actor3 = Crowd['actors'][number];

// 武松十八碗：烘焙在孙羊正店酒垆柜台上（42 卷 CH-C-014 动作签名「掷碗立而不倒」）
export function bakeWuSongBowls(b: Baker, rng: RNG): void {
  const base = new THREE.Vector3(219.0, 1.9, 61.0); // 柜台面 1.84 上、避开银酒海 (220.6,60.6)
  let n = 0;
  for (let row = 0; row < 3 && n < 18; row++) {
    for (let col = 0; col < 6 && n < 18; col++, n++) {
      b.cyl('wood', 0.16, 0.11, 0.13, 7, base.x + col * 0.38, base.y + row * 0.14, base.z + row * 0.22, shade(0xd8d0c0, n < 2 ? 1 : 0.9), 0, 0, 0);
    }
  }
  void rng;
}
