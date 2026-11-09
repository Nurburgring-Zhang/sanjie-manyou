import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Baker } from '../src/city/bake';
import {
  realmEcoPlan, realmEcoTotals, realmEcoSummary, humanPlantOk,
  buildRealmFlora, buildCritterPlan, buildRealmFauna,
  REALMS, type Realm, type FaunaMotion,
} from '../src/sky/ecoExpansion';
import { HEAVEN_BASE_Y, HEAVEN_LIFT, HEAVEN_SCALE, heavenPoint } from '../src/sky/heavenFrame';
import { UNDER } from '../src/sky/underworld';

/**
 * R18 判据（用户原话）：「三界要又很多花花草草，绿树成荫，流水潺潺，鸟飞鱼游，
 * 还有各种动物到处跑」——这里把「多」和「活」都变成可机检的数：
 *   ① 三界各有植物/动物，物种数与株数有下限；
 *   ② 人间陆生点位必须避开街面 / 地标 / 河道；
 *   ③ 天宫静态植物保持缩放前口径、动态动物保持世界口径（两者不能混）；
 *   ④ 动态实例逐帧真的在动（update 前后矩阵不同）。
 * R21 扩容（用户复核「完整严格执行了么？偷懒了么？」）：下界整体上调到新规模
 *   （flora≥14600 / fauna≥900 / species≥44 / drawCalls===4 不变），
 *   并新增「ECO_PLAN 每个 species count>0（无空物种）、总株数/总只数/物种下限、
 *   四类 motion 每界非零、新增 fruit/divineTree form 都有专属几何」断言；
 *   原有 placed≈requested / 避让 / 确定性 / 高度带不串层断言一条不削弱。
 */
const noop = (): void => {};
const stub = new Proxy({}, { get: () => noop }) as unknown as Baker;

describe('R18 三界动植物生态', () => {
  it('计划：三界都有草木禽鱼，物种数与数量下限达标', () => {
    const plans = realmEcoPlan();
    expect(plans.length).toBe(REALMS.length);
    const totals = realmEcoTotals();
    expect(totals.species).toBeGreaterThanOrEqual(44);
    expect(totals.flora).toBeGreaterThanOrEqual(14600);
    expect(totals.fauna).toBeGreaterThanOrEqual(900);
    expect(totals.drawCalls).toBe(4);
    for (const p of plans) {
      expect(p.flora.length, `${p.label} 植物物种数`).toBeGreaterThanOrEqual(10);
      expect(p.fauna.length, `${p.label} 动物物种数`).toBeGreaterThanOrEqual(4);
      expect(new Set(p.fauna.map((f) => f.motion)).size, `${p.label} 飞/游/跑/飘齐全`).toBe(4);
      expect(p.flora.some((f) => f.form === 'tree'), `${p.label} 绿树成荫`).toBe(true);
      expect(p.flora.some((f) => f.form === 'flower'), `${p.label} 花花草草`).toBe(true);
      expect(p.flora.some((f) => f.form === 'water'), `${p.label} 流水/水生`).toBe(true);
    }
    for (const r of REALMS) {
      expect(totals.byRealm[r].flora, `${r} 植物株数`).toBeGreaterThan(2000);
      expect(totals.byRealm[r].fauna, `${r} 动物只数`).toBeGreaterThan(200);
    }
  });

  it('人间落点避让：御街、正街、河岸商业排、地标禁入区一律不种树', () => {
    expect(humanPlantOk(0, 0)).toBe(false);                 // 御街中心
    expect(humanPlantOk(120, 52)).toBe(false);              // 北岸正街
    expect(humanPlantOk(300, 40)).toBe(false);              // 河岸商业排
    expect(humanPlantOk(225, 63)).toBe(false);              // 孙羊正店禁入区
    expect(humanPlantOk(30, 900)).toBe(false);              // 中央保留带商业排
    expect(humanPlantOk(760, 20)).toBe(false);              // 东门外 x=760 仍在汴河水域（|z|<31）
    expect(humanPlantOk(-300, 240)).toBe(true);             // 北郊田野
    expect(humanPlantOk(760, 80)).toBe(true);               // 东门外北岸
    expect(humanPlantOk(-760, -80)).toBe(true);             // 西门外南岸
    expect(humanPlantOk(-300, -240)).toBe(true);            // 南郊田野
  });

  it('静态草木实落：每个物种都落满计划数量，且全部有几何片数', () => {
    const report = buildRealmFlora(stub);
    const expected = realmEcoPlan().reduce((n, p) => n + p.flora.length, 0);
    expect(report.length).toBe(expected);
    const short = report.filter((r) => r.placed !== r.requested);
    expect(short.map((r) => `${r.realm}/${r.species}:${r.placed}/${r.requested}`).join(' | ')).toBe('');
    expect(report.every((r) => r.pieces >= r.placed)).toBe(true);
    const byRealm: Record<Realm, number> = { human: 0, heaven: 0, underworld: 0 };
    let pieces = 0;
    for (const r of report) { byRealm[r.realm] += r.placed; pieces += r.pieces; }
    // eslint-disable-next-line no-console
    console.log(`[生态审计] 草木 ${report.reduce((a, r) => a + r.placed, 0)} 株 / ${pieces} 片（≈${Math.round(pieces * 6 / 1000)}k 面），三界 ${byRealm.human}/${byRealm.heaven}/${byRealm.underworld}`);
    for (const r of REALMS) expect(byRealm[r]).toBeGreaterThan(500);
  });

  it('R21 扩容台账不虚高：每物种 requested 与 placed 差距 ≤10%、无空物种、每个计划物种都有几何映射', () => {
    const report = buildRealmFlora(stub);
    const planEntries = realmEcoPlan().reduce((n, p) => n + p.flora.length, 0);
    // buildRealmFlora 按 species 查 RULE，缺映射会整条 continue 跳过 → report 缺条目即台账虚高
    expect(report.length, '每个计划物种都有实落条目（无被 RULE 漏掉的空条目）').toBe(planEntries);
    for (const r of report) {
      expect(r.placed, `${r.realm}/${r.species} 不能是空物种`).toBeGreaterThan(0);
      expect(r.pieces, `${r.realm}/${r.species} 必须有几何片数`).toBeGreaterThan(0);
      expect(Math.abs(r.requested - r.placed) / r.requested, `${r.realm}/${r.species} 台账差距 >10%`).toBeLessThanOrEqual(0.1);
    }
  });

  it('R21 计划数据完整：无空物种、四类运动每界非零、总株数/总只数/物种下限', () => {
    const plans = realmEcoPlan();
    const MOTIONS: FaunaMotion[] = ['fly', 'swim', 'run', 'drift'];
    const names = new Set<string>();
    let totalFlora = 0, totalFauna = 0;
    for (const p of plans) {
      for (const f of p.flora) {
        expect(f.count, `${p.label}/${f.species} count 必须 >0（无空物种）`).toBeGreaterThan(0);
        totalFlora += f.count; names.add(f.species);
      }
      for (const f of p.fauna) {
        expect(f.count, `${p.label}/${f.species} count 必须 >0（无空物种）`).toBeGreaterThan(0);
        totalFauna += f.count; names.add(f.species);
      }
      for (const m of MOTIONS) {
        const n = p.fauna.filter((f) => f.motion === m).reduce((a, f) => a + f.count, 0);
        expect(n, `${p.label} 的 ${m} 类运动数量不得为 0`).toBeGreaterThan(0);
      }
    }
    expect(totalFlora, '静态草木总株数 ≥14600').toBeGreaterThanOrEqual(14600);
    expect(totalFauna, '动态禽鱼走兽总只数 ≥900').toBeGreaterThanOrEqual(900);
    expect(names.size, '物种条目 ≥44').toBeGreaterThanOrEqual(44);
    expect(realmEcoTotals().drawCalls, '动态仍 4 draw call').toBe(4);
  });

  it('R21 天宫新形制：仙花/仙草/仙果/仙树/神木齐备，fruit/divineTree form 都有专属几何', () => {
    const heaven = realmEcoPlan().find((p) => p.realm === 'heaven')!;
    const report = buildRealmFlora(stub);
    const fruit = heaven.flora.filter((f) => f.form === 'fruit');
    const divine = heaven.flora.filter((f) => f.form === 'divineTree');
    expect(fruit.length, '仙果(fruit) 至少 1 个物种').toBeGreaterThanOrEqual(1);
    expect(divine.length, '神木(divineTree) 至少 1 个物种').toBeGreaterThanOrEqual(1);
    // 天宫新增物种总数 ≥6，且花/草/果/树/木形制都有
    const newForms = new Set([...fruit, ...divine].map((f) => f.form));
    expect(heaven.flora.length).toBeGreaterThanOrEqual(14);
    expect(heaven.flora.some((f) => f.form === 'flower'), '仙花').toBe(true);
    expect(heaven.flora.some((f) => f.form === 'grass'), '仙草').toBe(true);
    expect(heaven.flora.some((f) => f.form === 'tree'), '仙树').toBe(true);
    expect(newForms.has('fruit') && newForms.has('divineTree')).toBe(true);
    // 新 form 的物种必须实落几何（fruitTree 7 片 / divineTree 6 片 ≥ 6 片每株）
    for (const f of [...fruit, ...divine]) {
      const r = report.find((x) => x.realm === 'heaven' && x.species === f.species);
      expect(r, `${f.species} 必须有实落台账`).toBeDefined();
      expect(r!.placed, `${f.species} 必须落满`).toBe(f.count);
      expect(r!.pieces, `${f.species} 必须走专属形制几何`).toBeGreaterThanOrEqual(f.count * 6);
    }
  });

  it('动态动物轨道：天宫用世界坐标、地府在幽冥层、人间贴地贴水，且确定性', () => {
    const critters = buildCritterPlan();
    const totals = realmEcoTotals();
    expect(critters.length).toBe(totals.fauna);
    const byMotion: Record<FaunaMotion, number> = { fly: 0, swim: 0, run: 0, drift: 0 };
    for (const c of critters) byMotion[c.motion]++;
    for (const m of Object.keys(byMotion) as FaunaMotion[]) expect(byMotion[m]).toBeGreaterThan(150);
    const heavenY = HEAVEN_BASE_Y + 18;
    const probe = heavenPoint(0, heavenY, 0)[1];
    expect(probe).toBeGreaterThan(HEAVEN_LIFT);
    expect(probe).toBe(HEAVEN_BASE_Y + HEAVEN_LIFT + (heavenY - HEAVEN_BASE_Y) * HEAVEN_SCALE);
    // 索引分段与 ECO_PLAN 的顺序一致：人间 → 天宫 → 地府
    const humanFauna = realmEcoPlan()[0].fauna.reduce((a, f) => a + f.count, 0);
    const heavenFauna = realmEcoPlan()[1].fauna.reduce((a, f) => a + f.count, 0);
    const human = critters.slice(0, humanFauna);
    const heaven = critters.slice(humanFauna, humanFauna + heavenFauna);
    const under = critters.slice(humanFauna + heavenFauna);
    expect(human.every((c) => c.cy < 100)).toBe(true);
    expect(heaven.every((c) => c.cy > 2000)).toBe(true);
    expect(under.every((c) => c.cy < -200)).toBe(true);
    expect(under.every((c) => Math.abs(c.cy - UNDER.y) < 60)).toBe(true);
    const again = buildCritterPlan();
    expect(again.map((c) => `${c.cx.toFixed(3)},${c.cy.toFixed(3)},${c.cz.toFixed(3)},${c.phase.toFixed(3)}`).join('|'))
      .toBe(critters.map((c) => `${c.cx.toFixed(3)},${c.cy.toFixed(3)},${c.cz.toFixed(3)},${c.phase.toFixed(3)}`).join('|'));
  });

  it('动态实例真在跑：4 个合批网格，逐帧矩阵变化，三界坐标不串层', () => {
    const scene = new THREE.Scene();
    const fauna = buildRealmFauna(scene);
    expect(fauna.report.drawCalls).toBe(4);
    expect(fauna.report.instances).toBe(realmEcoTotals().fauna);
    expect(scene.children.filter((o) => o.name.startsWith('eco_')).length).toBe(4);
    const mesh = scene.getObjectByName('eco_fly') as THREE.InstancedMesh;
    expect(mesh.count).toBe(fauna.report.byMotion.fly);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const before = m.elements.slice();
    fauna.update(0.25);
    mesh.getMatrixAt(0, m);
    const after = m.elements.slice();
    expect(after.some((v, i) => Math.abs(v - before[i]) > 1e-6), '飞鸟逐帧位移').toBe(true);
    // 所有实例的世界 y 都落在三界各自的高度带，没有「天宫动物飘在人间」
    const ys: number[] = [];
    for (const o of scene.children) {
      if (!(o instanceof THREE.InstancedMesh)) continue;
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); ys.push(m.elements[13]); }
    }
    expect(ys.length).toBe(fauna.report.instances);
    expect(ys.some((y) => y > 2000)).toBe(true);
    expect(ys.some((y) => y < -200)).toBe(true);
    expect(ys.some((y) => y > -100 && y < 100)).toBe(true);
    const summary = realmEcoSummary(buildRealmFlora(stub), fauna.report);
    expect(summary.placedFlora).toBe(realmEcoTotals().flora);
    expect(summary.fauna?.instances).toBe(realmEcoTotals().fauna);
  });
});
