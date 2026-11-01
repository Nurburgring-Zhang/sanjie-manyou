import { describe, it, expect } from 'vitest';
import { Baker } from '../src/city/bake';
import { RNG } from '../src/core/rng';
import {
  buildDetailedEave,
  buildDetailedFacade,
  buildSunyangInteriorAtoms,
  buildShiqianInteriorAtoms,
  buildYamenInteriorAtoms,
} from '../src/city/detailKit';
import { buildDesertOutpost } from '../src/world/desertOutpost';
import { buildGhostShopDetail } from '../src/sky/fengduDetail';
import { willow, conifer } from '../src/city/props';
import { buildSansheng, buildEighteenHells } from '../src/sky/hells';
import { buildBuilding } from '../src/city/buildings';
import { buildBridge } from '../src/city/bridge';
import { buildInteractProps } from '../src/city/props';
import { ITEM_BUILDERS, cabinet, vase, stool, umbrella } from '../src/city/itemKit';
import { buildLandmarkInteriors } from '../src/city/interiors';
import { buildGhostFlora } from '../src/sky/flora';

describe('宋代建筑高细节原子组件', () => {
  it('索引几何经合并后保留真实面数，不产生三角面错连', () => {
    const b = new Baker();
    // 悬空盒（底边在地面以上）：12 面全留。底面剔除的完整比对见 tests/bakeQuant.test.ts
    b.box('wood', 1, 1, 1, 0, 10, 0, 0xffffff);
    expect(b.stats().groups.wood.triangles).toBe(12);
    b.cyl('ceramic', 0.5, 0.5, 1, 8, 0, 0, 0, 0xffffff);
    expect(b.stats().groups.ceramic.triangles).toBeGreaterThan(12);
  });

  it('新材质角色可独立烘焙并进入统计', () => {
    const b = new Baker();
    b.box('ceramic', 0.2, 0.2, 0.2, 0, 0, 0, 0xffffff);
    b.box('metal', 0.2, 0.2, 0.2, 0, 0, 0, 0xffffff);
    b.box('fabric', 0.2, 0.2, 0.2, 0, 0, 0, 0xffffff);
    b.box('lacquer', 0.2, 0.2, 0.2, 0, 0, 0, 0xffffff);
    const stats = b.stats();
    for (const group of ['ceramic', 'metal', 'fabric', 'lacquer'] as const) {
      expect(stats.groups[group].triangles).toBeGreaterThan(0);
    }
  });

  it('檐口原子包含椽、飞椽、檩、瓦口、滴水与风铎', () => {
    const b = new Baker();
    buildDetailedEave(b, {
      x: 226, y: 10.2, z: 66, w: 20, d: 13, ry: 0,
      roofC: 0x3b4045, tier: 'near',
    });
    const detail = b.stats().detail;
    expect(detail['eave.rafter']).toBeGreaterThanOrEqual(24);
    expect(detail['eave.flyingRafter']).toBeGreaterThanOrEqual(16);
    expect(detail['eave.purlin']).toBeGreaterThanOrEqual(4);
    expect(detail['eave.tileDrip']).toBeGreaterThanOrEqual(24);
    expect(detail['eave.windBell']).toBeGreaterThanOrEqual(4);
  });

  it('立面原子包含柱础、门槛踏步、门钉、格扇棂条与侧窗', () => {
    const b = new Baker();
    buildDetailedFacade(b, {
      x: 226, z: 66, ry: 0, w: 20, d: 13, floors: 3, tier: 'near', lit: true,
    });
    const detail = b.stats().detail;
    expect(detail['facade.columnBase']).toBeGreaterThanOrEqual(4);
    expect(detail['facade.doorStud']).toBeGreaterThanOrEqual(18);
    expect(detail['facade.latticeSlat']).toBeGreaterThanOrEqual(12);
    expect(detail['facade.thresholdStep']).toBeGreaterThanOrEqual(2);
    expect(detail['facade.sideWindow']).toBeGreaterThanOrEqual(2);
  });

  it('孙羊正店室内原子包含梁架、天花、桌凳、餐具、酒器与厨房器物', () => {
    const b = new Baker();
    buildSunyangInteriorAtoms(b);
    const detail = b.stats().detail;
    expect(detail['interior.ceilingBeam']).toBeGreaterThanOrEqual(12);
    expect(detail['interior.ceilingBoard']).toBeGreaterThanOrEqual(10);
    expect(detail['interior.stool']).toBeGreaterThanOrEqual(40);
    expect(detail['interior.tableSetting']).toBeGreaterThanOrEqual(10);
    expect(detail['ceramic.bowl']).toBeGreaterThanOrEqual(20);
    expect(detail['ceramic.wineCup']).toBeGreaterThanOrEqual(20);
    expect(detail['metal.winePot']).toBeGreaterThanOrEqual(4);
    expect(detail['kitchen.utensil']).toBeGreaterThanOrEqual(8);
    expect(detail['interior.hangingPainting']).toBeGreaterThanOrEqual(6);
    expect(detail['interior.fabricCurtain']).toBeGreaterThanOrEqual(4);
    const bounds = b.stats().detailBounds;
    expect(bounds['interior.stool'].minY).toBeGreaterThan(0.7);
    expect(bounds['interior.fabricCushion'].minY).toBeGreaterThan(0.7);
    expect(bounds['interior.ceilingBeam'].minY).toBeGreaterThan(3.5);
  });

  it('十千脚店室内原子包含桌凳、酒器、客舍与马棚器物', () => {
    const b = new Baker();
    buildShiqianInteriorAtoms(b);
    const detail = b.stats().detail;
    expect(detail['interior.ceilingBeam']).toBeGreaterThanOrEqual(12);
    expect(detail['interior.stool']).toBeGreaterThanOrEqual(24);
    expect(detail['ceramic.wineCup']).toBeGreaterThanOrEqual(12);
    expect(detail['metal.teapot']).toBeGreaterThanOrEqual(2);
    expect(detail['interior.guestBed']).toBeGreaterThanOrEqual(6);
    expect(detail['interior.stableTrough']).toBeGreaterThanOrEqual(2);
  });

  it('府衙室内原子包含公案文房、六房案牍、官灯与牢栅', () => {
    const b = new Baker();
    buildYamenInteriorAtoms(b);
    const detail = b.stats().detail;
    expect(detail['interior.ceilingBeam']).toBeGreaterThanOrEqual(12);
    expect(detail['interior.officeDesk']).toBeGreaterThanOrEqual(6);
    expect(detail['interior.officeChair']).toBeGreaterThanOrEqual(6);
    expect(detail['ceramic.inkstone']).toBeGreaterThanOrEqual(2);
    expect(detail['metal.sealBox']).toBeGreaterThanOrEqual(1);
    expect(detail['interior.documentBox']).toBeGreaterThanOrEqual(6);
    expect(detail['metal.candleStand']).toBeGreaterThanOrEqual(4);
    expect(detail['yamen.jailBar']).toBeGreaterThanOrEqual(8);
  });

  it('西陲大漠拥有绿洲商站、帐篷、棕榈、岩石与路标原子', () => {
    const b = new Baker();
    buildDesertOutpost(b, -16000, -14500, () => 12, new RNG(20260905));
    const detail = b.stats().detail;
    expect(detail['desert.well']).toBeGreaterThanOrEqual(1);
    expect(detail['desert.tent']).toBeGreaterThanOrEqual(2);
    expect(detail['desert.palm']).toBeGreaterThanOrEqual(5);
    expect(detail['desert.rock']).toBeGreaterThanOrEqual(16);
    expect(detail['desert.waystone']).toBeGreaterThanOrEqual(4);
    expect(detail['desert.crate']).toBeGreaterThanOrEqual(6);
    expect(detail['desert.fire']).toBeGreaterThanOrEqual(1);
    expect(b.stats().groups.fabric.triangles).toBeGreaterThan(0);
  });

  it('丰都鬼铺具有基座、门、窗、雨棚、灯笼和摊位原子', () => {
    const b = new Baker();
    buildGhostShopDetail(b, {
      x: 0, z: 0, y: -260, w: 10, d: 8, h: 5, kind: 0, sink: 0, tilt: 0,
    });
    const detail = b.stats().detail;
    expect(detail['fengdu.base']).toBeGreaterThanOrEqual(1);
    expect(detail['fengdu.door']).toBeGreaterThanOrEqual(2);
    expect(detail['fengdu.window']).toBeGreaterThanOrEqual(2);
    expect(detail['fengdu.awning']).toBeGreaterThanOrEqual(1);
    expect(detail['fengdu.lantern']).toBeGreaterThanOrEqual(2);
    expect(detail['fengdu.stall']).toBeGreaterThanOrEqual(1);
    expect(b.stats().groups.fabric.triangles).toBeGreaterThan(0);
  });

  it('整组 180° 转向同时作用于 Baker 几何与招牌', () => {
    const b = new Baker();
    b.yawAbout(0, 0);
    b.box('wood', 1, 1, 1, 0, 0, 10, 0xffffff);
    b.yawAbout();
    b.box('wood', 1, 1, 1, 0, 0, 10, 0xffffff);
    const p = b.positionsOf('wood');
    let neg = 0;
    let positive = 0;
    for (let i = 2; i < p.length; i += 3) {
      if (p[i] < -5) neg++;
      if (p[i] > 5) positive++;
    }
    expect(neg).toBeGreaterThan(0);
    expect(positive).toBeGreaterThan(0);
    expect(neg).toBe(positive);
  });

  it('三生石祭场包含石台、栏杆、踏道、香案、幡旗与枯树', () => {
    const b = new Baker();
    const atlas = { text: () => [0, 0, 1, 1] } as never;
    const sg = { quad: () => undefined } as never;
    buildSansheng(b, sg, atlas);
    const d = b.stats().detail;
    expect(d['sansheng.platform']).toBeGreaterThanOrEqual(2);
    expect(d['sansheng.rail']).toBeGreaterThanOrEqual(16);
    expect(d['sansheng.steps']).toBe(3);
    expect(d['sansheng.altar']).toBe(1);
    expect(d['sansheng.banner']).toBe(4);
    expect(d['sansheng.deadTree']).toBe(2);
    expect(d['sansheng.cap']).toBe(1);
  });

  it('十八狱由狱道环、界桩与路灯相连', () => {
    const b = new Baker();
    buildEighteenHells(b, { quad: () => undefined } as never, { text: () => [0, 0, 1, 1] } as never);
    const d = b.stats().detail;
    expect(d['hell.road']).toBe(18);
    expect(d['hell.post']).toBe(36);
    expect(d['hell.step']).toBe(36);
    expect(d['hell.lamp']).toBe(9);
  });

  it('夜哭竹分节、有节环与梢部竹叶', () => {
    const b = new Baker();
    buildGhostFlora(b, new RNG(20260905));
    const d = b.stats().detail;
    expect(d['flora.nightBamboo']).toBe(36);
    expect(d['flora.bambooNode']).toBe(36 * 3);
    expect(d['flora.bambooLeaf']).toBe(36 * 5);
    expect(b.stats().groups.leaf.triangles).toBeGreaterThan(0);
  });

  it('琴台侧灯有灯杆与灯座，不是悬空发光块', () => {
    const b = new Baker();
    buildInteractProps(b, { quad: () => undefined } as never, { text: () => [0, 0, 1, 1] } as never);
    expect(b.stats().detail['prop.qinLamp']).toBe(1);
    const p = b.positionsOf('wood');
    let hasPole = false;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i] - 307.3) < 0.2 && Math.abs(p[i + 2] - 92) < 0.2 && p[i + 1] > 0.5 && p[i + 1] < 1.2) hasPole = true;
    }
    expect(hasPole, '琴台侧灯缺灯杆').toBe(true);
  });

  it('府衙内有后堂榻屏与门前仪仗戟', () => {
    const b = new Baker();
    const atlas = { text: () => [0, 0, 1, 1] } as never;
    const sg = { quad: () => undefined, yawAbout: () => undefined } as never;
    buildLandmarkInteriors(b, sg, atlas);
    const d = b.stats().detail;
    expect(d['yamen.restRoom']).toBe(1);
    expect(d['yamen.halberd']).toBe(4);
    expect(d['item.bed']).toBeGreaterThanOrEqual(1);
    expect(d['item.screen']).toBeGreaterThanOrEqual(1);
  });

  it('器物工厂二十五类构件均可生成并登记', () => {
    for (const [key, fn] of Object.entries(ITEM_BUILDERS)) {
      const b = new Baker();
      fn(b, 0, 0, 0, 1);
      expect(b.stats().detail[`item.${key}`], `item.${key} 未登记`).toBe(1);
      expect(b.stats().groups.ceramic.triangles + b.stats().groups.metal.triangles + b.stats().groups.wood.triangles +
        b.stats().groups.lacquer.triangles + b.stats().groups.fabric.triangles + b.stats().groups.wall.triangles, `item.${key} 无网格`).toBeGreaterThan(0);
    }
  });

  it('落地器件贴地不悬空（柜/花觚/凳/伞）', () => {
    for (const [name, fn] of [['cabinet', cabinet], ['vase', vase], ['stool', stool], ['umbrella', umbrella]] as const) {
      const b = new Baker();
      fn(b, 0, 0.1, 0, 1);
      let minY = Infinity;
      for (const g of ['wood', 'ceramic', 'metal', 'fabric', 'leaf', 'lacquer'] as const) {
        const p = b.positionsOf(g as never);
        for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
      }
      expect(minY, `${name} 最低点 ${minY.toFixed(3)} 未贴地`).toBeGreaterThan(0.09);
      expect(minY, `${name} 最低点 ${minY.toFixed(3)} 离地过高`).toBeLessThan(0.2);
    }
  });

  it('虹桥桥面有四座食棚（两端各两座）', () => {
    const b = new Baker();
    buildBridge(b, { quad: () => undefined } as never, { text: () => [0, 0, 1, 1] } as never);
    expect(b.stats().detail['bridge.stall']).toBe(4);
  });

  it('建筑按形制分型：店铺柜台、民居门楼、酒肆酒旗各自落地', () => {
    const atlas = { text: () => [0, 0, 1, 1] } as never;
    const sg = { quad: () => undefined } as never;
    const a = new Baker();
    buildBuilding(a, sg, atlas, { x: 0, z: 0, ry: 0, w: 10, d: 8, floors: 1, kind: 'shop' }, 1);
    expect(a.stats().detail['building.shopCounter']).toBe(1);
    const b2 = new Baker();
    buildBuilding(b2, sg, atlas, { x: 0, z: 0, ry: 0, w: 10, d: 8, floors: 1, kind: 'house' }, 2);
    expect(b2.stats().detail['building.courtyardGate']).toBe(1);
    const c = new Baker();
    buildBuilding(c, sg, atlas, { x: 0, z: 0, ry: 0, w: 10, d: 8, floors: 1, kind: 'tavern' }, 3);
    expect(c.stats().detail['building.wineFlag']).toBe(1);
  });

  it('松柏为五层塔冠加顶梢，不是三段圆锥', () => {
    const b = new Baker();
    conifer(b, 12, 34, 1.1);
    const d = b.stats().detail;
    expect(d['flora.conifer']).toBe(1);
    expect(d['flora.coniferTier']).toBe(5);
    expect(b.stats().groups.leaf.triangles).toBeGreaterThanOrEqual(90);
  });

  it('垂柳由斜干、团簇冠与下垂柳丝构成', () => {
    const b = new Baker();
    willow(b, 10, 20, 1.2, false);
    const d = b.stats().detail;
    expect(d['flora.willow']).toBe(1);
    expect(d['flora.willowClump']).toBeGreaterThanOrEqual(6);
    expect(d['flora.willowFrond']).toBeGreaterThanOrEqual(9);
    expect(b.stats().groups.leaf.triangles).toBeGreaterThanOrEqual(120);
    expect(b.stats().groups.trunk.triangles).toBeGreaterThanOrEqual(60);
  });

  it('丰都十二类铺面各有独占外摆构件', () => {
    const perKind: Set<string>[] = [];
    for (let kind = 0; kind < 12; kind++) {
      const b = new Baker();
      buildGhostShopDetail(b, {
        x: kind * 40, z: 0, y: -260, w: 12, d: 9, h: 5.5, kind, sink: 0, tilt: 0,
      });
      const d = b.stats().detail;
      const own = new Set(Object.keys(d).filter((k) => k.startsWith('fengdu.stall.')));
      expect(own.size, `kind ${kind} 无专属外摆`).toBeGreaterThanOrEqual(1);
      perKind.push(own);
    }
    perKind.forEach((own, kind) => {
      const unique = [...own].filter((k) => !perKind.some((s, i) => i !== kind && s.has(k)));
      expect(unique.length, `kind ${kind} 无独占构件`).toBeGreaterThanOrEqual(1);
    });
  });
});
