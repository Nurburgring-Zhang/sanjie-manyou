import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng';
import { buildNav, POIS, bridgeDeckY, BRIDGE_HALF } from '../src/city/layout';
import { SHUIHU_ALL, TIAN_GANG, DI_SHA, STATION } from '../src/data/shuihu';
import { HERO_CARDS } from '../src/data/shuihuCards';
import { POINTS, POINTS_BY_KIND } from '../src/data/interactPoints';
import { CreatureSystem } from '../src/sky/creatures';
import { heavenPoint, heavenY } from '../src/sky/heavenFrame';
import { buildGhostFlora, buildCelestialFlora } from '../src/sky/flora';
import { PEACH_GRANT } from '../src/data/interactPoints';
import { DEITIES } from '../src/data/deities';
import { ACTIONS } from '../src/actors/actions';
import { JOBS, JOB_MAP, SpotRegistry } from '../src/data/jobs';
import { tickActor, BehCtx } from '../src/actors/behaviors';
import { profileOf, tierOf } from '../src/game/physics';
import type { Actor } from '../src/actors/types';
import * as THREE from 'three';

describe('确定性随机数', () => {
  it('同种子序列完全一致', () => {
    const a = new RNG(42), b = new RNG(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('range/pick/int 输出在界内', () => {
    const r = new RNG(7);
    for (let i = 0; i < 200; i++) {
      const v = r.range(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
      expect(r.int(0, 5)).toBeLessThanOrEqual(5);
      expect([1, 2, 3]).toContain(r.pick([1, 2, 3]));
    }
  });
});

describe('汴京路网与布局', () => {
  const nav = buildNav();
  it('路网节点规模合理', () => {
    expect(nav.nodes.length).toBeGreaterThan(150);
    expect(nav.nodes.length).toBeLessThan(800);
  });
  it('路网全连通（BFS 可达所有节点）', () => {
    expect(nav.connectivityOk()).toBe(true);
  });
  it('桥面剖面：中心最高、两端贴地', () => {
    expect(bridgeDeckY(0)).toBeGreaterThan(bridgeDeckY(BRIDGE_HALF * 0.7));
    expect(bridgeDeckY(BRIDGE_HALF)).toBeLessThan(1.1);
    expect(bridgeDeckY(-BRIDGE_HALF)).toBeLessThan(1.1);
  });
  it('POI 注册完整且位置在或高于世界范围', () => {
    const keys = Object.keys(POIS);
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) {
      const p = POIS[k].pos;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(p.y).toBeGreaterThan(-5);
    }
  });
  it('瑶池水榭存在可传送 POI', () => {
    expect(POIS.yaochi).toBeDefined();
    // 天宫 POI 存世界口径（x/z ×HEAVEN_SCALE、y 走 heavenY）：期望值由 heavenPoint 现算，
    // 不再抄一份常数——否则改了换算基准这里会静默漂移
    expect(POIS.yaochi.pos.toArray()).toEqual(heavenPoint(150, 208.26, 20));
    expect(POIS.yaochi.sky).toBe(true);
  });
});

describe('水浒一百单八将数据', () => {
  it('恰好 108 将，天罡 36 地煞 72', () => {
    expect(SHUIHU_ALL.length).toBe(108);
    expect(TIAN_GANG.length).toBe(36);
    expect(DI_SHA.length).toBe(72);
  });
  it('姓名唯一、数据完整、动作与图鉴动作注册表一致', () => {
    const names = new Set(SHUIHU_ALL.map((h) => h[0]));
    expect(names.size).toBe(108);
    for (const h of SHUIHU_ALL) {
      expect(h.length).toBe(8);
      expect(h[0].length).toBeGreaterThan(0);
      expect(h[1].length).toBeGreaterThan(0);
      expect(ACTIONS[h[5]]).toBeTypeOf('function');
      expect(h[6].length).toBeGreaterThan(0);
      expect(h[7].length).toBeGreaterThan(0);
    }
  });
});

describe('西游神佛名册', () => {
  it('规模 ≥35、名号唯一、战斗动作合法', () => {
    expect(DEITIES.length).toBeGreaterThanOrEqual(35);
    const names = new Set(DEITIES.map((d) => d.name));
    expect(names.size).toBe(DEITIES.length);
    for (const d of DEITIES) {
      expect(d.battle.length).toBeGreaterThan(0);
      for (const a of d.battle) expect(ACTIONS[a]).toBeTypeOf('function');
      expect(['wukong', 'heaven', 'daily']).toContain(d.side);
      expect(d.daily.length).toBeGreaterThan(0);
      expect(ACTIONS[d.daily]).toBeTypeOf('function');
    }
  });
  it('齐天一方与天庭都有阵容', () => {
    expect(DEITIES.filter((d) => d.side === 'wukong').length).toBeGreaterThanOrEqual(7);
    expect(DEITIES.filter((d) => d.side === 'heaven').length).toBeGreaterThanOrEqual(15);
  });
});

describe('动作原语库', () => {
  it('动作数量 ≥45', () => {
    expect(Object.keys(ACTIONS).length).toBeGreaterThanOrEqual(45);
  });
  it('随机驱动 200 次不产生 NaN 姿态', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const key of Object.keys(ACTIONS)) {
      for (let i = 0; i < 3; i++) {
        const pose = {
          bob: 0, crouch: 0, rootPitch: 0, rootRoll: 0, bodyPitch: 0, bodyRoll: 0,
          shPL: 0, shPR: 0, spL: 0.09, spR: 0.09, elL: 0, elR: 0,
          legPL: 0, legPR: 0, kneeL: 0, kneeR: 0, headYaw: 0, headPitch: 0,
          propHand: 0, propEX: 0, propEY: 0, propEZ: 0, propLen: 0, halo: 0, aura: 0,
        };
        ACTIONS[key]({ speed: rand() * 2, seed: rand() * 10, scale: 1, t: rand() * 100, actionT: rand() * 5 }, rand() * 50, pose);
        for (const v of Object.values(pose)) {
          expect(Number.isFinite(v as number)).toBe(true);
        }
      }
    }
  });
});

describe('市井职业与行为状态机', () => {
  it('职业表完整且行为动作全部注册', () => {
    expect(JOBS.length).toBeGreaterThanOrEqual(24);
    for (const j of JOBS) {
      expect(JOB_MAP.get(j.key)).toBe(j);
      for (const b of j.behaviors) expect(ACTIONS[b.act]).toBeTypeOf('function');
    }
  });

  function mkActor(): Actor {
    return {
      id: 1, pos: new THREE.Vector3(0, 0, 52), yaw: 0, speed: 1,
      action: 'stand', actT: 0, timer: 0, occ: 'customer', seed: 3,
      scale: 1, hat: 1, cloth: new THREE.Color(1, 1, 1), pants: new THREE.Color(0, 0, 0), skin: new THREE.Color(1, 1, 1),
      propPool: null, slots: {}, hatPool: 'hatFlat', halo: false, sky: false, hidden: false,
      freeze: false, attach: null, data: null, doing: '',
      path: [], pathI: 0, pendingAct: '', pendingSpot: false, curDoing: '',
      lastTick: 0, lastWrite: -1, acc: 0, actionT: 0, lastAction: '', impactUntil: 0, yOff: 0, yawVel: 0,
    };
  }

  it('顾客 400 次思考后仍活着、位置有限、动作有效', () => {
    const ctx: BehCtx = { nav: buildNav(), spots: new SpotRegistry(), isNight: false, camPos: new THREE.Vector3(0, 0, 0) };
    ctx.spots.add(30, 60, 'stall');
    ctx.spots.add(-20, 58, 'tea');
    const a = mkActor();
    for (let i = 0; i < 400; i++) {
      tickActor(a, 0.25, ctx);
      expect(Number.isFinite(a.pos.x)).toBe(true);
      expect(Number.isFinite(a.pos.z)).toBe(true);
      expect(Math.abs(a.pos.x)).toBeLessThan(1500);
      expect(Math.abs(a.pos.z)).toBeLessThan(1500);
      expect(ACTIONS[a.action]).toBeTypeOf('function');
    }
  });

  it('更夫在白日转为蛰伏行走', () => {
    const ctx: BehCtx = { nav: buildNav(), spots: new SpotRegistry(), isNight: false, camPos: new THREE.Vector3(0, 0, 0) };
    const a = mkActor();
    a.occ = 'watchman';
    tickActor(a, 0.1, ctx);
    expect(a.doing).toBe('白日蛰伏');
  });
});

describe('物理碰撞反馈分级（力量 vs 韧性）', () => {
  const mortal = profileOf({ ...({ data: { group: 'job' }, occ: 'customer', scale: 1 } as unknown as Actor) });
  it('普通人出拳只能让普通人趔趄', () => {
    expect(tierOf(9, mortal)).toBe('stagger');   // 力 9 vs 韧 9 → 趔趄
    expect(tierOf(9, mortal)).not.toBe('knockdown');
  });
  it('疾驰车辆（质量×速度）能撞倒/撞飞行人', () => {
    expect(tierOf(16, mortal)).toBe('knockdown'); // 慢车：击倒
    expect(tierOf(35, mortal)).toBe('launch');    // 快车：击飞
  });
  it('炮击（狙击级动能）对凡人为碎裂级', () => {
    expect(tierOf(200, mortal)).toBe('shatter');
  });
  it('神佛法体坚韧：凡人无效、炮击仅能轰倒、巨灵神可击飞凡人', () => {
    const god = { mass: 1.6, power: 90, toughness: 70, fragile: false, label: '神' };
    expect(tierOf(9, god)).toBe('none');          // 凡人拳脚无效
    expect(tierOf(200, god)).toBe('knockdown');   // 炮击也只能轰倒
    // 巨灵神 power120 打凡人：原始判定为碎裂级，系统层对生者封顶为击飞+昏迷（apply/shatter 内处理）
    expect(tierOf(120, mortal)).toBe('shatter');
    expect(tierOf(45, mortal)).toBe('launch');    // 击飞带：28.8 ≤ 45 < 54
  });
  it('亡魂脆弱：轻力即碎裂消散', () => {
    const ghost = { mass: 0.6, power: 6, toughness: 3, fragile: true, label: '亡魂' };
    expect(tierOf(9, ghost)).toBe('knockdown');
    expect(tierOf(12, ghost)).toBe('launch');
    expect(tierOf(25, ghost)).toBe('shatter');
  });
  it('动作库包含三级受击反馈', () => {
    for (const k of ['staggerHit', 'knockedDown', 'launched']) {
      expect(ACTIONS[k]).toBeTypeOf('function');
    }
  });
});

// ============ B4：108 将深度转生（20 卷 5.4 坐标 + 42 卷角色卡） ============
describe('B4 108 将深度转生', () => {
  it('STATION 覆盖 108/108 将且坐标为有限数', () => {
    for (const h of SHUIHU_ALL) {
      const st = STATION[h[0]];
      expect(st, `${h[0]} 缺驻城坐标`).toBeDefined();
      expect(Number.isFinite(st[0])).toBe(true);
      expect(Number.isFinite(st[1])).toBe(true);
    }
    expect(Object.keys(STATION).length).toBe(108);
  });
  it('42 卷角色卡覆盖 108/108 将且身长归一在 1.5-2.2m', () => {
    expect(HERO_CARDS.length).toBe(108);
    const names = new Set(HERO_CARDS.map((c) => c.name));
    for (const h of SHUIHU_ALL) expect(names.has(h[0]), `${h[0]} 缺角色卡`).toBe(true);
    for (const c of HERO_CARDS) {
      expect(c.st).toBeGreaterThan(1.5);
      expect(c.st).toBeLessThan(2.2);
      expect(c.quote.length).toBeGreaterThan(4);
      expect(/^#[0-9A-F]{6}$/i.test(c.skin)).toBe(true);
    }
  });
  it('专属动作全部是动作库合法键（动作签名档位校验）', () => {
    for (const h of SHUIHU_ALL) {
      expect(ACTIONS[h[5]], `${h[0]} 动作 ${h[5]} 不存在`).toBeTypeOf('function');
    }
    // 42 卷动作签名档：武松豪饮/杨志卖刀/鲁智深倒拔/燕青相扑/林冲刺枪
    expect(ACTIONS['drink']).toBeTypeOf('function');
    expect(ACTIONS['swordForm']).toBeTypeOf('function');
    expect(ACTIONS['pullTree']).toBeTypeOf('function');
    expect(ACTIONS['sumo']).toBeTypeOf('function');
    expect(ACTIONS['spearThrust']).toBeTypeOf('function');
  });
  it('关键将驻城与 20 卷 5.4 表逐点一致', () => {
    expect(STATION['武松']).toEqual([226, 66]);       // 孙羊正店豪饮
    expect(STATION['杨志']).toEqual([0, 20]);         // 州桥卖刀
    expect(STATION['鲁智深']).toEqual([-450, 78]);    // 柳林倒拔
    expect(STATION['林冲']).toEqual([600, -150]);     // 教场授枪
    expect(STATION['李逵']).toEqual([-2820, 940]);    // 唐家酒店闹酒
    expect(STATION['燕青']).toEqual([306, 82]);       // 勾栏相扑
    expect(STATION['宋江']).toEqual([560, -20]);      // 府衙批牍
    expect(STATION['解珍']).toEqual([-21500, -15200]);// 天山行猎
  });
  it('B1 内饰模块可无头构建且地标几何规模合理', async () => {
    const { Baker } = await import('../src/city/bake');
    const { buildLandmarkInteriors, bakeHeroStageProps } = await import('../src/city/interiors');
    const b = new Baker();
    const atlas = { text: () => [0, 0, 1, 1] } as never;       // 牌匾图集 DOM 依赖以桩替（几何量断言不受影响）
    const sg = { quad: () => undefined, yawAbout: () => undefined } as never;
    buildLandmarkInteriors(b, sg, atlas);
    bakeHeroStageProps(b);
    // 私有 buf 经 build 前顶点量反映规模：以 (b as any) 探针断言四主组顶点非零
    const buf = (b as unknown as { buf: Record<string, { p: number[] }> }).buf;
    for (const g of ['wall', 'wood', 'glow', 'roof']) {
      expect(buf[g].p.length, `内饰 ${g} 组顶点为空`).toBeGreaterThan(300);
    }
  });
});


describe('B8 物品经济：61 交互点全表（20 卷 §5.2）', () => {
  it('61 点全量且类别计数与书一致', () => {
    expect(POINTS.length).toBe(61);
    expect(POINTS_BY_KIND).toEqual({ eat: 18, gamble: 6, show: 5, song: 4, buy: 16, ride: 8, boat: 4 });
  });
  it('ID 唯一、坐标有限、吃喝/买类必有价目', () => {
    const ids = new Set(POINTS.map((p) => p.id));
    expect(ids.size).toBe(61);
    for (const p of POINTS) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
      if (p.kind === 'eat' || p.kind === 'buy') {
        expect(p.goods?.length ?? 0, p.id + ' 缺价目').toBeGreaterThan(0);
        for (const gd of p.goods ?? []) expect(gd.price).toBeGreaterThan(0);
      }
    }
  });
  it('抽查书价：E4 浊酒 5 / B10 话本 20 / E15 羊白肠 10 / B16 米 3', () => {
    const byId = (id: string) => POINTS.find((p) => p.id === id)!;
    expect(byId('E4').goods!.find((x) => x.name === '濁酒')!.price).toBe(5);
    expect(byId('B10').goods!.find((x) => x.name === '話本')!.price).toBe(20);
    expect(byId('E15').goods!.find((x) => x.name === '羊白腸')!.price).toBe(10);
    expect(byId('B16').goods!.find((x) => x.name === '米·升')!.price).toBe(3);
  });
  it('骑/船 12 点全挂既有系统标记', () => {
    const sys = POINTS.filter((p) => p.system);
    expect(sys.length).toBe(12);
    expect(sys.filter((p) => p.system === 'mount').length).toBe(8);
    expect(sys.filter((p) => p.system === 'boat').length).toBe(4);
  });
});


describe('B9 生物行为与三币（43/10 卷）', () => {
  it('CreatureSystem 无头可建：13 巡游者，牛头 6 点环线，灵猴 y=202 天宫层，5 秒位移>3m', () => {
    const actors: { id: number; pos: THREE.Vector3; yaw: number }[] = [];
    const fakeCrowd = {
      spawnActor: (o: Record<string, unknown>) => {
        const id = actors.length + 1;
        actors.push({ id, pos: (o as { pos: THREE.Vector3 }).pos.clone(), yaw: 0 });
        return actors[actors.length - 1];
      },
      actors,
    };
    const cs = new CreatureSystem(fakeCrowd as never);
    expect(cs.runners.length).toBe(13);
    expect(cs.runners[0].pts.length).toBe(6);                 // 牛头殿前→引道→桥头
    expect(cs.runners[12].pts.every((p) => p.y === heavenY(202))).toBe(true); // 灵猴天宫层（抬升后须走 heavenY，不能写 202+HEAVEN_LIFT）
    const p0 = actors[0].pos.clone();
    for (let i = 0; i < 150; i++) cs.update(1 / 30);          // 5 秒
    expect(actors[0].pos.distanceTo(p0)).toBeGreaterThan(3);
  });
  it('三币单向律：烧纸 铜钱10→阴德+1（B2 王家纸马档）；蟠桃消耗未开（留痕 B10）', () => {
    const burn = POINTS.find((p) => p.id === 'B2')!.goods!.find((x) => x.act === 'burnpaper')!;
    expect(burn.price).toBe(10);
    expect(POINTS.filter((p) => p.goods?.some((x) => x.act === 'peachgrant')).length).toBe(0);
  });
});


describe('B10 植物精化+蟠桃宴（10/30 卷 PLT + 总纲三币律）', () => {
  it('鬼植/仙植可无头烘焙且几何非空', async () => {
    const { Baker } = await import('../src/city/bake');
    const { RNG } = await import('../src/core/rng');
    const b = new Baker();
    buildGhostFlora(b, new RNG(42));
    buildCelestialFlora(b, new RNG(7));
    const buf = (b as unknown as { buf: Record<string, { p: number[] }> }).buf;
    expect(buf.wood.p.length + buf.leaf.p.length + buf.glow.p.length).toBeGreaterThan(4000);
  });
  it('蟠桃赏赐档：瑶池点位+单向律（1 点→100 文，点不足退款不倒扣）', () => {
    expect(PEACH_GRANT.x).toBe(150);
    expect(PEACH_GRANT.z).toBe(20);
    const g0 = PEACH_GRANT.goods[0];
    expect(g0.act).toBe('peachgrant');
    // 单向律：只有 peach→coins 方向；61 表内无任何 peach 反向兑蟠桃
    expect(POINTS.some((p) => p.goods?.some((x) => x.act === 'peachgrant'))).toBe(false);
  });
});
