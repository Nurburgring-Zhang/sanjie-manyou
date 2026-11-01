// ============ 程序化动作原语库 ============
// 所有动作都是纯函数：t(秒) + 视图参数 → 写入 Pose；由 crowd.writeActor 合成到实例矩阵。
export interface Pose {
  bob: number; crouch: number; rootPitch: number; rootRoll: number;
  bodyPitch: number; bodyRoll: number;
  shPL: number; shPR: number; spL: number; spR: number; elL: number; elR: number;
  legPL: number; legPR: number; kneeL: number; kneeR: number;
  headYaw: number; headPitch: number;
  propHand: number; propEX: number; propEY: number; propEZ: number; propLen: number;
  halo: number; aura: number;
}
export interface ActView { speed: number; seed: number; scale: number; t: number; actionT: number; data?: Record<string, unknown> }

export function newPose(): Pose {
  return {
    bob: 0, crouch: 0, rootPitch: 0, rootRoll: 0, bodyPitch: 0, bodyRoll: 0,
    shPL: 0, shPR: 0, spL: 0.09, spR: 0.09, elL: 0, elR: 0,
    legPL: 0, legPR: 0, kneeL: 0, kneeR: 0, headYaw: 0, headPitch: 0,
    propHand: 0, propEX: 0, propEY: 0, propEZ: 0, propLen: 0, halo: 0, aura: 0,
  };
}
export type ActionFn = (v: ActView, t: number, p: Pose) => void;

const S = Math.sin, C = Math.cos;
const w = (x: number) => S(x) * 0.5 + 0.5;

/** 步行循环基座：k=步幅系数 */
function walkBase(v: ActView, t: number, p: Pose, k = 1): void {
  const ph = t * (4.6 + v.speed * 2.2);
  const a = 0.62 * k;
  p.legPL = S(ph) * a; p.legPR = -S(ph) * a;
  p.kneeL = Math.max(0, -S(ph)) * 0.9 * k; p.kneeR = Math.max(0, S(ph)) * 0.9 * k;
  p.shPL = -S(ph) * 0.5 * k; p.shPR = S(ph) * 0.5 * k;
  p.bob = Math.abs(S(ph)) * 0.055 * k;
  p.bodyRoll = S(ph) * 0.04;
  p.elL = 0.25 + Math.max(0, -S(ph)) * 0.5; p.elR = 0.25 + Math.max(0, S(ph)) * 0.5;
}

export const ACTIONS: Record<string, ActionFn> = {
  stand(v, t, p) {
    p.bob = S(t * 1.4 + v.seed) * 0.012;
    p.headYaw = S(t * 0.5 + v.seed * 2) * 0.3;
  },
  lookAround(v, t, p) {
    p.headYaw = S(t * 0.9 + v.seed) * 0.85;
    p.bob = S(t * 1.3) * 0.01;
    p.shPL = S(t * 0.7 + v.seed) * 0.12;
  },
  walk(v, t, p) { walkBase(v, t, p, 1); },
  run(v, t, p) {
    walkBase(v, t, p, 1.45);
    p.bodyPitch = 0.18;
    p.elL = 1.1; p.elR = 1.1;
  },
  staggerWalk(v, t, p) {
    walkBase(v, t, p, 0.6);
    p.bodyRoll = S(t * 2.1) * 0.22;
    p.bodyPitch = 0.12 + S(t * 1.3) * 0.1;
    p.headPitch = 0.15;
  },
  carryPole(v, t, p) {
    walkBase(v, t, p, 0.72);
    p.propHand = 1; p.propEX = 0; p.propEZ = Math.PI / 2 - 0.06; p.propEY = 0;
    p.propLen = -0.02;
    p.shPL = 1.35; p.shPR = 1.35; p.spL = 0.7; p.spR = 0.7; p.elL = 0.9; p.elR = 0.9;
    p.bodyRoll = S(t * 4) * 0.05;
  },
  waterCarry(v, t, p) {
    walkBase(v, t, p, 0.6);
    p.shPL = 0.5; p.shPR = 0.5; p.elL = 0.4; p.elR = 0.4; p.spL = 0.4; p.spR = 0.4;
    p.bodyPitch = 0.08;
  },
  pullRope(v, t, p) {
    const ph = t * 3.2;
    p.bodyPitch = 0.55 + S(ph) * 0.07;
    p.legPL = S(ph) * 0.5; p.legPR = -S(ph) * 0.5;
    p.kneeL = Math.max(0, -S(ph)) * 0.7; p.kneeR = Math.max(0, S(ph)) * 0.7;
    p.shPL = 1.5; p.shPR = 1.5; p.elL = 0.3; p.elR = 0.3; p.spL = 0.15; p.spR = 0.15;
    p.bob = 0.02;
  },
  row(v, t, p) {
    const ph = t * 2.6;
    p.crouch = 0.62;
    p.bodyPitch = 0.25 + S(ph) * 0.22;
    p.shPL = -1.1 + S(ph) * 0.85; p.shPR = -1.1 + S(ph) * 0.85;
    p.spL = 0.9; p.spR = 0.9; p.elL = 0.2; p.elR = 0.2;
    p.propHand = -1; p.propEX = Math.PI / 2 + S(ph) * 0.5; p.propEZ = 1.15;
    p.bob = S(ph * 2) * 0.03;
  },
  crank(v, t, p) {
    const ph = t * 3.4;
    p.shPL = 1.2 + S(ph) * 0.7; p.shPR = 1.2 - S(ph) * 0.7;
    p.elL = 0.5; p.elR = 0.5; p.bodyPitch = 0.15;
    p.bob = 0.015;
  },
  browse(v, t, p) {
    p.bodyPitch = 0.42 + S(t * 1.1 + v.seed) * 0.08;
    p.headPitch = 0.35;
    p.crouch = 0.08;
    p.shPL = 0.75; p.elL = 0.35; p.shPR = 0.3;
    p.bob = S(t * 1.4) * 0.01;
  },
  hawk(v, t, p) {
    p.bodyPitch = -0.06;
    const g = S(t * 5.2);
    p.shPR = 1.9 + g * 0.35; p.spR = 0.5; p.elR = 0.25 + g * 0.2;
    p.shPL = 0.35; p.elL = 0.7;
    p.headPitch = -0.1;
    p.bob = S(t * 5.2) * 0.02;
  },
  bowTrade(v, t, p) {
    const cyc = (t * 0.9 + v.seed) % 2;
    if (cyc < 0.7) { p.bodyPitch = 0.5 * S((cyc / 0.7) * Math.PI); p.headPitch = 0.3; }
    p.shPL = 0.9; p.shPR = 0.9; p.elL = 0.5; p.elR = 0.5; p.spL = 0.3; p.spR = 0.3;
  },
  drink(v, t, p) {
    const g = w(t * 1.1 + v.seed);
    p.shPR = 1.9 * g; p.elR = 1.9 * g + 0.3; p.spR = 0.25;
    p.headPitch = -0.35 * g;
    p.crouch = 0.5; p.legPL = -1.3; p.legPR = -1.3; p.kneeL = 1.5; p.kneeR = 1.5;
    p.bob = 0.015;
  },
  eat(v, t, p) {
    const g = w(t * 2.0 + v.seed);
    p.shPR = 1.7 * g; p.elR = 1.8 * g; p.headPitch = 0.2 + g * -0.25;
    p.crouch = 0.5; p.legPL = -1.3; p.legPR = -1.3; p.kneeL = 1.5; p.kneeR = 1.5;
  },
  dice(v, t, p) {
    p.crouch = 0.78;
    p.legPL = -1.9; p.legPR = -1.9; p.kneeL = 2.1; p.kneeR = 2.1;
    p.bodyPitch = 0.5;
    const sh = S(t * 12) * 0.14;
    p.shPR = 0.9 + sh; p.shPL = 0.9 - sh; p.elL = 1.2; p.elR = 1.2;
    p.headPitch = 0.4;
  },
  chat(v, t, p) {
    const g = S(t * 2.6 + v.seed);
    p.shPR = 0.7 + Math.max(0, g) * 0.7; p.elR = 1.1 + Math.max(0, g) * 0.6;
    p.headYaw = g * 0.25;
    p.bob = S(t * 1.6) * 0.012;
    p.bodyPitch = Math.max(0, S(t * 0.8)) * 0.12;
  },
  argue(v, t, p) {
    const g = S(t * 6 + v.seed);
    p.shPR = 1.3 + g * 0.5; p.elR = 0.5;
    p.shPL = -0.4 + g * 0.3;
    p.bodyPitch = 0.1 + g * 0.12;
    p.headPitch = 0.12;
  },
  brawl(v, t, p) {
    const ph = t * 5.4 + v.seed;
    const atk = w(ph);
    p.shPR = -0.6 + atk * 2.6; p.elR = 1.5 - atk * 1.1;
    p.shPL = 0.8 - atk * 0.5; p.elL = 1.4;
    p.bodyPitch = 0.12 + atk * 0.2;
    p.legPL = 0.35; p.legPR = -0.3;
    p.kneeL = 0.4; p.kneeR = 0.5; p.crouch = 0.12;
    p.bob = Math.abs(S(ph)) * 0.04;
  },
  sumo(v, t, p) {
    const ph = t * 2.4 + v.seed;
    p.crouch = 0.3;
    p.legPL = S(ph) * 0.4; p.legPR = -S(ph) * 0.4;
    p.kneeL = 0.9; p.kneeR = 0.9;
    p.shPL = 1.1 + S(ph * 1.7) * 0.3; p.shPR = 1.1 - S(ph * 1.7) * 0.3;
    p.elL = 1.2; p.elR = 1.2; p.spL = 0.6; p.spR = 0.6;
    p.bodyRoll = S(ph) * 0.16;
    p.bob = Math.abs(S(ph)) * 0.05;
  },
  kneel(v, t, p) {
    p.crouch = 0.95;
    p.legPL = -2.2; p.legPR = -2.2; p.kneeL = 2.3; p.kneeR = 2.3;
    const bow = w(t * 0.8 + v.seed);
    p.bodyPitch = 0.35 + bow * 0.45;
    p.shPL = 1.2; p.shPR = 1.2; p.spL = 0.3; p.spR = 0.3;
  },
  write(v, t, p) {
    p.crouch = 0.6;
    p.legPL = -1.6; p.legPR = -1.8; p.kneeL = 1.8; p.kneeR = 2.0;
    p.bodyPitch = 0.55;
    const mv = S(t * 3.2 + v.seed);
    p.shPR = 1.0; p.elR = 0.9 + mv * 0.3;
    p.shPL = 0.7; p.elL = 0.8;
    p.headPitch = 0.4;
    p.propHand = 1; p.propEZ = 1.3; p.propEX = 0.4;
  },
  pluck(v, t, p) {
    p.crouch = 0.55;
    p.legPL = -1.5; p.legPR = -1.5; p.kneeL = 1.7; p.kneeR = 1.7;
    p.bodyPitch = 0.18;
    p.propHand = 1; p.propEX = -0.35; p.propEZ = 0.5; p.propLen = 0.2;
    p.shPL = 0.85; p.shPR = 0.7;
    p.elL = 0.8 + S(t * 7) * 0.25; p.elR = 0.7 + S(t * 9 + 1) * 0.25;
    p.headPitch = 0.25;
  },
  flute(v, t, p) {
    p.shPL = 1.7; p.shPR = 2.0; p.elL = 0.9; p.elR = 0.7;
    p.spL = 0.35; p.spR = 0.35;
    p.headPitch = 0.1;
    p.propHand = -1; p.propEX = Math.PI / 2; p.propEY = 0.5; p.propLen = 0.1;
    p.bob = S(t * 1.2) * 0.01;
  },
  fanSway(v, t, p) {
    p.propHand = 1; p.propEZ = 0.6 + S(t * 2.2) * 0.5; p.propEX = 0.3;
    p.shPR = 1.0; p.elR = 0.7;
    p.shPL = 0.5 + S(t * 1.4) * 0.2;
    p.bodyRoll = S(t * 1.1) * 0.1;
    p.headPitch = -0.15 + S(t * 0.9) * 0.1;
    p.bob = S(t * 2.2) * 0.02;
  },
  spinDance(v, t, p) {
    p.shPL = 1.5 + S(t * 6) * 0.4; p.shPR = 1.5 - S(t * 6) * 0.4;
    p.spL = 1.1; p.spR = 1.1;
    p.headYaw = S(t * 6) * 0.5;
    p.bob = Math.abs(S(t * 6)) * 0.08;
    p.bodyRoll = S(t * 6) * 0.12;
  },
  puppeteer(v, t, p) {
    p.shPL = 1.9 + S(t * 4.2) * 0.5; p.shPR = 1.9 - S(t * 4.2) * 0.5;
    p.elL = 0.4; p.elR = 0.4; p.spL = 0.5; p.spR = 0.5;
    p.bodyPitch = 0.12; p.headPitch = 0.2;
    p.bob = S(t * 4.2) * 0.02;
  },
  balancePole(v, t, p) {
    walkBase(v, t, p, 0.4);
    p.propHand = 1; p.propEX = Math.PI / 2; p.propEZ = S(t * 3) * 0.12; p.propLen = -0.3;
    p.shPL = 2.4; p.shPR = 2.4; p.spL = 0.05; p.spR = 0.05;
    p.bodyRoll = S(t * 2.2) * 0.08;
  },
  kiteRun(v, t, p) {
    walkBase(v, t, p, 1.3);
    p.shPL = 2.2; p.shPR = 2.4; p.elL = 0.3; p.elR = 0.3;
    p.headPitch = -0.3;
  },
  sneak(v, t, p) {
    const ph = t * 2.4;
    p.crouch = 0.34;
    p.bodyPitch = 0.3;
    p.legPL = S(ph) * 0.4; p.legPR = -S(ph) * 0.4;
    p.kneeL = Math.max(0, -S(ph)) * 0.8 + 0.5; p.kneeR = Math.max(0, S(ph)) * 0.8 + 0.5;
    p.shPL = 0.5; p.shPR = 0.5; p.elL = 1.2; p.elR = 1.2;
    p.headYaw = S(t * 1.8) * 0.5;
    p.bob = 0.01;
  },
  swim(v, t, p) {
    const ph = t * 3.0;
    p.rootPitch = Math.PI / 2 - 0.08;
    p.shPL = -S(ph) * 1.8; p.shPR = S(ph) * 1.8;
    p.spL = 0.5; p.spR = 0.5;
    p.legPL = S(ph) * 0.4; p.legPR = -S(ph) * 0.4;
    p.kneeL = 0.4; p.kneeR = 0.4;
    p.headPitch = -0.6;
  },
  lieSleep(v, t, p) {
    p.rootPitch = Math.PI / 2;
    p.bob = S(t * 1.1 + v.seed) * 0.02;
    p.headPitch = 0.25;
    p.shPL = 0.15; p.shPR = 0.15; p.spL = 0.2; p.spR = 0.2;
  },
  sitNap(v, t, p) {
    p.crouch = 0.55;
    p.legPL = -1.4; p.legPR = -1.4; p.kneeL = 1.6; p.kneeR = 1.6;
    p.bodyPitch = 0.3; p.headPitch = 0.75;
    p.bob = S(t * 0.9) * 0.015;
  },
  sitTea(v, t, p) {
    p.crouch = 0.55;
    p.legPL = -1.4; p.legPR = -1.4; p.kneeL = 1.6; p.kneeR = 1.6;
    const g = w(t * 0.9 + v.seed);
    p.shPR = 1.5 * g + 0.4; p.elR = 1.6 * g + 0.4;
    p.shPL = 0.5; p.elL = 0.9;
    p.headYaw = S(t * 0.6) * 0.4;
    p.bob = 0.01;
  },
  squatRel(v, t, p) {
    p.crouch = 0.8;
    p.legPL = -1.9; p.legPR = -1.9; p.kneeL = 2.2; p.kneeR = 2.2;
    p.bodyPitch = 0.25;
    p.shPL = 0.4; p.shPR = 0.4;
    p.headYaw = 0.3;
  },
  monkBow(v, t, p) {
    const bow = w(t * 0.7 + v.seed);
    p.bodyPitch = 0.2 + bow * 0.4;
    p.shPL = 1.0 + bow * 0.3; p.shPR = 1.0 + bow * 0.3;
    p.spL = 0.25; p.spR = 0.25;
    p.headPitch = bow * 0.3;
  },
  // 跪拜合十（庙观祈愿）：三拜节奏——俯身→叩首→起身
  pray(v, t, p) {
    const cyc = (t * 0.5 + v.seed * 0.13) % 3;
    const bow = cyc < 1.6 ? Math.max(0, Math.sin((cyc / 1.6) * Math.PI)) : 0;
    p.crouch = 0.62 + bow * 0.18;
    p.legPL = -1.55; p.legPR = -1.55; p.kneeL = 1.75; p.kneeR = 1.75;
    p.bodyPitch = 0.25 + bow * 0.75;
    p.headPitch = 0.15 + bow * 0.55;
    p.shPL = 1.15 + bow * 0.35; p.shPR = 1.15 + bow * 0.35;
    p.spL = 0.3; p.spR = 0.3; p.elL = 1.5 + bow * 0.3; p.elR = 1.5 + bow * 0.3;
    p.bob = 0.008;
  },
  // 上香（持香过顶，随呼吸微动）
  incense(v, t, p) {
    const g = Math.sin(t * 0.8 + v.seed);
    p.bodyPitch = 0.12;
    p.shPL = 2.1 + g * 0.12; p.shPR = 2.1 - g * 0.12;
    p.spL = 0.2; p.spR = 0.2; p.elL = 0.15; p.elR = 0.15;
    p.headPitch = -0.3;
    p.bob = Math.sin(t * 1.2 + v.seed) * 0.01;
  },
  // 结跏趺坐（佛菩萨坐莲台）：垂目结印，腹式呼吸微动，光环呼吸
  sitLotus(v, t, p) {
    const br = Math.sin(t * 0.9 + v.seed) * 0.5 + 0.5;
    p.crouch = 0.5;
    p.legPL = -1.9; p.legPR = -1.9; p.kneeL = 2.3; p.kneeR = 2.3;
    p.bodyPitch = 0.06 + br * 0.015;
    p.shPL = 0.75; p.shPR = 0.75;
    p.spL = 0.22; p.spR = 0.22; p.elL = 1.35; p.elR = 1.35;
    p.headPitch = 0.28;
    p.halo = 0.85 + br * 0.25;
    p.aura = 0.6 + br * 0.3;
    p.bob = 0.006;
  },
  // 讲经（抬手说法印）
  preach(v, t, p) {
    const g = Math.sin(t * 0.55 + v.seed) * 0.5 + 0.5;
    p.crouch = 0.5;
    p.legPL = -1.9; p.legPR = -1.9; p.kneeL = 2.3; p.kneeR = 2.3;
    p.shPR = 1.7 + g * 0.25; p.spR = 0.45; p.elR = 0.9 + g * 0.3;
    p.shPL = 0.6; p.elL = 1.2;
    p.headYaw = Math.sin(t * 0.4) * 0.25;
    p.halo = 0.9; p.aura = 0.7;
    p.bob = 0.008;
  },
  taoSleeve(v, t, p) {
    const g = S(t * 1.6 + v.seed);
    p.shPL = 1.2 + g * 0.6; p.shPR = 1.2 - g * 0.6;
    p.spL = 0.8; p.spR = 0.8; p.elL = 0.3; p.elR = 0.3;
    p.bodyRoll = g * 0.1;
    p.bob = Math.abs(g) * 0.03;
  },
  sweep(v, t, p) {
    const ph = t * 2.8;
    p.bodyPitch = 0.35 + S(ph) * 0.1;
    p.shPL = 0.9 + S(ph) * 0.35; p.shPR = 1.1 - S(ph) * 0.3;
    p.elL = 0.4; p.elR = 0.5;
    p.propHand = 1; p.propEX = -0.7; p.propEZ = 0.35; p.propLen = 0.25;
    p.legPL = 0.2; p.legPR = -0.2;
  },
  hammerAnvil(v, t, p) {
    const cyc = (t * 2.6 + v.seed) % 1;
    const up = cyc < 0.45 ? cyc / 0.45 : 1 - (cyc - 0.45) / 0.55;
    p.bodyPitch = 0.3;
    p.shPR = 2.6 * up + 0.4; p.elR = 0.4;
    p.shPL = 0.6; p.elL = 0.9;
    p.propHand = 1; p.propEX = 0.4; p.propEZ = 0.2;
    p.crouch = 0.15; p.legPL = 0.3; p.legPR = -0.2;
  },
  pullTree(v, t, p) {
    const cyc = (t * 0.8 + v.seed) % 2;
    const eff = cyc < 1 ? cyc : 2 - cyc;
    p.crouch = 0.25 + eff * 0.55;
    p.shPL = 2.6; p.shPR = 2.6; p.spL = 0.25; p.spR = 0.25; p.elL = 0.3; p.elR = 0.3;
    p.bodyPitch = -0.15 - eff * 0.25;
    p.legPL = 0.5; p.legPR = -0.5; p.kneeL = 0.8 + eff * 0.6; p.kneeR = 0.8 + eff * 0.6;
    p.headPitch = -0.3;
  },
  shootBow(v, t, p) {
    const draw = w(t * 0.7 + v.seed);
    p.bodyRoll = -0.35;
    p.shPL = 1.65; p.spL = 0.1; p.elL = 0.08;
    p.shPR = 1.5 - draw * 0.5; p.elR = 1.4 - draw * 0.9;
    p.propHand = 1; p.propEX = 0; p.propEY = Math.PI / 2; p.propLen = 0.35;
    p.headPitch = -0.06;
    p.legPL = 0.25; p.legPR = -0.35;
  },
  swordForm(v, t, p) {
    const ph = t * 3.0 + v.seed;
    p.shPR = 1.4 + S(ph) * 1.2; p.elR = 0.6 - S(ph) * 0.35;
    p.shPL = 0.6 - S(ph) * 0.4; p.elL = 1.0;
    p.propHand = 1; p.propEX = S(ph) * 0.25; p.propEY = 1.2; p.propLen = 0.1;
    p.bodyRoll = S(ph) * 0.14;
    p.legPL = 0.3; p.legPR = -0.3; p.crouch = 0.1;
    p.headYaw = S(ph) * 0.2;
  },
  axeChop(v, t, p) {
    const cyc = (t * 2.2 + v.seed) % 1;
    const up = cyc < 0.4 ? cyc / 0.4 : 1 - (cyc - 0.4) / 0.6;
    p.shPL = 2.8 * up + 0.3; p.shPR = 2.8 * up + 0.3;
    p.elL = 0.25; p.elR = 0.25; p.spL = 0.2; p.spR = 0.2;
    p.propHand = 1; p.propEX = -0.6 * up; p.propLen = 0.1;
    p.bodyPitch = 0.15 + (1 - up) * 0.3;
    p.legPL = 0.35; p.legPR = -0.35;
    p.bob = (1 - up) * 0.04;
  },
  spearThrust(v, t, p) {
    const g = S(t * 2.8 + v.seed);
    p.shPL = 1.3 + g * 0.25; p.shPR = 1.3 - g * 0.25;
    p.elL = 0.2; p.elR = 0.2; p.spL = 0.12; p.spR = 0.12;
    p.propHand = 1; p.propEZ = 0.06; p.propLen = 0.25;
    p.bodyPitch = 0.1 + g * 0.12;
    p.legPL = 0.4; p.legPR = -0.4; p.crouch = 0.14;
  },
  heal(v, t, p) {
    const g = S(t * 1.4);
    p.bodyPitch = 0.35;
    p.shPL = 1.2 + g * 0.15; p.shPR = 1.2 - g * 0.15;
    p.spL = 0.3; p.spR = 0.3; p.elL = 0.4; p.elR = 0.4;
    p.headPitch = 0.35;
    p.crouch = 0.2;
  },
  cook(v, t, p) {
    const g = S(t * 5 + v.seed);
    p.bodyPitch = 0.3;
    p.shPL = 0.8 + g * 0.25; p.shPR = 0.8 - g * 0.25;
    p.elL = 0.9; p.elR = 0.9;
    p.headPitch = 0.3;
    p.crouch = 0.1;
  },
  drum(v, t, p) {
    const ph = t * 5 + v.seed;
    p.shPL = 1.4 + Math.max(0, S(ph)) * 0.9; p.shPR = 1.4 + Math.max(0, -S(ph)) * 0.9;
    p.elL = 0.5; p.elR = 0.5;
    p.bodyPitch = 0.2;
    p.bob = Math.abs(S(ph)) * 0.02;
  },
  fishSit(v, t, p) {
    p.crouch = 0.6;
    p.legPL = -1.5; p.legPR = -1.7; p.kneeL = 1.7; p.kneeR = 2.0;
    p.bodyPitch = 0.2;
    p.shPR = 1.1; p.elR = 0.5;
    p.propHand = 1; p.propEX = -0.9; p.propLen = 0.3;
    p.headPitch = 0.15;
  },
  castNet(v, t, p) {
    const cyc = (t * 1.6 + v.seed) % 1;
    const up = cyc < 0.5 ? cyc * 2 : 2 - cyc * 2;
    p.shPL = 0.6 + up * 2.2; p.shPR = 0.6 + up * 2.2;
    p.spL = 0.6; p.spR = 0.6;
    p.bodyPitch = -up * 0.2;
    p.bob = up * 0.05;
    p.headPitch = -0.2 * up;
  },
  ferryPole(v, t, p) {
    const ph = t * 2.2;
    p.shPL = 1.1 + S(ph) * 0.7; p.shPR = 1.1 + S(ph) * 0.7;
    p.elL = 0.3; p.elR = 0.3;
    p.propHand = 1; p.propEX = S(ph) * 0.5; p.propLen = 0.2;
    p.bodyPitch = 0.12;
    p.legPL = 0.25; p.legPR = -0.25;
  },
  // ---- 天宫专用 ----
  flyIdle(v, t, p) {
    p.legPL = 0.1; p.legPR = -0.05; p.kneeL = 0.25; p.kneeR = 0.15;
    p.shPL = 0.5 + S(t * 1.8) * 0.3; p.shPR = 0.5 - S(t * 1.8) * 0.3;
    p.elL = 0.5; p.elR = 0.5;
    p.bob = S(t * 2.2) * 0.08;
    p.bodyPitch = 0.12;
  },
  flyDash(v, t, p) {
    p.bodyPitch = 0.75;
    p.shPL = 2.6; p.shPR = 2.6; p.spL = 0.1; p.spR = 0.1; p.elL = 0.1; p.elR = 0.1;
    p.legPL = -0.2; p.legPR = 0.1;
    p.headPitch = -0.5;
  },
  staffCombo(v, t, p) {
    const ph = t * 6.5;
    const k = S(ph);
    p.shPL = 1.6 - k * 1.4; p.shPR = 1.6 + k * 1.4;
    p.elL = 0.4; p.elR = 0.35;
    p.spL = 0.2; p.spR = 0.2;
    p.propHand = 1; p.propEX = k * 0.7 - 0.25; p.propEY = Math.PI / 2; p.propLen = 0.2;
    p.bodyRoll = k * 0.3;
    p.bodyPitch = 0.15;
    p.legPL = 0.35; p.legPR = -0.35; p.crouch = 0.12;
    p.bob = Math.abs(k) * 0.05;
    p.headYaw = k * 0.2;
  },
  cloudSomersault(v, t, p) {
    const cyc = (t * 1.8) % 1;
    p.rootPitch = cyc * Math.PI * 2;
    p.crouch = 0.3;
    p.shPL = 1.8; p.shPR = 1.8; p.elL = 1.2; p.elR = 1.2;
    p.legPL = -0.8; p.legPR = -0.8; p.kneeL = 1.6; p.kneeR = 1.6;
  },
  cloneCast(v, t, p) {
    p.shPL = 2.9; p.shPR = 2.9; p.elL = 0.2; p.elR = 0.2;
    p.bodyPitch = -0.2;
    p.headPitch = -0.3;
    p.legPL = 0.3; p.legPR = -0.3;
    p.aura = 1;
  },
  thirdEyeBeam(v, t, p) {
    p.shPL = 1.2; p.shPR = 1.2; p.elL = 0.3; p.elR = 0.3;
    p.propHand = 1; p.propEZ = 0.1; p.propLen = 0.2;
    p.headPitch = 0.15;
    p.aura = 1;
    p.bodyPitch = 0.1;
  },
  towerPress(v, t, p) {
    p.shPL = 2.9; p.shPR = 2.9; p.spL = 0.15; p.spR = 0.15;
    p.bodyPitch = -0.25;
    p.headPitch = -0.4;
    p.propHand = 1; p.propEX = -0.2; p.propLen = 0.3;
    p.aura = 1;
  },
  sleeveWave(v, t, p) {
    const g = S(t * 2.0 + v.seed);
    p.shPL = 1.3 + g * 0.9; p.shPR = 1.3 - g * 0.9;
    p.spL = 1.2; p.spR = 1.2; p.elL = 0.2; p.elR = 0.2;
    p.bodyRoll = g * 0.12;
    p.bob = Math.abs(g) * 0.05;
  },
  lotusPreach(v, t, p) {
    p.crouch = 0.72;
    p.legPL = -2.0; p.legPR = -2.0; p.kneeL = 2.1; p.kneeR = 2.1;
    p.shPL = 1.1; p.shPR = 1.1; p.spL = 0.5; p.spR = 0.5;
    p.headPitch = 0.12;
    p.bob = S(t * 0.9) * 0.02;
    p.aura = 0.6 + w(t * 0.7) * 0.4;
  },
  bellTower(v, t, p) {
    const ph = t * 1.6;
    p.shPR = 1.2 + Math.max(0, S(ph)) * 1.3;
    p.elR = 0.3;
    p.shPL = 0.8;
    p.bodyPitch = 0.1;
    p.bob = 0.01;
  },
  forgeImmortal(v, t, p) {
    const ph = t * 2.2;
    p.bodyPitch = 0.2;
    p.shPL = 0.9 + Math.max(0, S(ph)) * 0.8; p.shPR = 0.9 + Math.max(0, -S(ph)) * 0.8;
    p.elL = 0.6; p.elR = 0.6;
    p.aura = 0.5;
  },
  pickPeach(v, t, p) {
    const g = w(t * 1.2 + v.seed);
    p.shPR = 2.2 * g + 0.4; p.elR = 0.5;
    p.bodyPitch = -0.1 - g * 0.1;
    p.shPL = 0.6;
    p.legPL = 0.2;
    p.headPitch = -0.2;
    p.bob = g * 0.03;
  },
  courtBow(v, t, p) {
    const bow = w(t * 0.5 + v.seed * 0.3);
    p.bodyPitch = 0.3 + bow * 0.3;
    p.shPL = 1.2; p.shPR = 1.2; p.spL = 0.2; p.spR = 0.2;
    p.headPitch = 0.3;
  },
  holdCourt(v, t, p) {
    p.shPL = 0.6 + S(t * 0.8) * 0.25; p.shPR = 0.6 - S(t * 0.8) * 0.25;
    p.elL = 0.8; p.elR = 0.8;
    p.headYaw = S(t * 0.5) * 0.3;
    p.bob = S(t * 1.1) * 0.015;
  },
  thunderDrum(v, t, p) {
    const cyc = (t * 2.4) % 1;
    const up = cyc < 0.3 ? cyc / 0.3 : 1 - (cyc - 0.3) / 0.7;
    p.shPR = 2.8 * up + 0.2;
    p.propHand = 1; p.propEX = -0.5 * up;
    p.shPL = 1.4; p.elL = 0.8;
    p.aura = up;
    p.bodyPitch = 0.1;
  },
  mirrorFlash(v, t, p) {
    const g = w(t * 3.2);
    p.shPL = 1.9; p.spL = 0.4;
    p.propHand = -1; p.propEX = -0.3; p.propLen = 0.25;
    p.aura = g;
    p.headPitch = -0.1;
  },
  dogPounce(v, t, p) {
    const ph = t * 4;
    p.rootPitch = 1.15;
    p.legPL = S(ph) * 0.7; p.legPR = -S(ph) * 0.7;
    p.kneeL = 0.6; p.kneeR = 0.6;
    p.headPitch = -0.7;
    p.shPL = 0.8; p.shPR = 0.8;
  },
  monkeyScratch(v, t, p) {
    const g = S(t * 7 + v.seed);
    p.shPR = 2.4 + g * 0.25; p.elR = 1.9;
    p.headYaw = g * 0.3;
    p.crouch = 0.15;
    p.legPL = 0.25; p.legPR = -0.25;
    p.bob = Math.abs(g) * 0.02;
  },
  impMarch(v, t, p) { walkBase(v, t, p, 1.1); p.bodyPitch = 0.15; p.elL = 0.8; p.elR = 0.8; },
  carryPalanquin(v, t, p) {
    walkBase(v, t, p, 0.55);
    p.shPL = 2.2; p.shPR = 2.2; p.spL = 0.3; p.spR = 0.3; p.elL = 0.2; p.elR = 0.2;
    p.bob = Math.abs(S(t * 4.4)) * 0.06;
  },
  sitSedan(v, t, p) {
    p.crouch = 0.6;
    p.legPL = -1.5; p.legPR = -1.5; p.kneeL = 1.7; p.kneeR = 1.7;
    p.bob = Math.abs(S(t * 4.4)) * 0.05;
    p.headYaw = S(t * 0.7) * 0.3;
  },
  rideAnimal(v, t, p) {
    p.legPL = -1.15; p.legPR = -1.15; p.kneeL = 1.35; p.kneeR = 1.35;
    p.crouch = 0.35;
    p.bodyPitch = 0.08;
    p.shPL = 0.7 + S(t * 5) * 0.08; p.shPR = 0.7 - S(t * 5) * 0.08;
    p.elL = 0.8; p.elR = 0.8;
    p.bob = Math.abs(S(t * 5)) * 0.045;
  },
  // 通用：任意 prop 展示姿态
  present(v, t, p) {
    p.shPL = 1.2; p.elL = 0.6;
    p.shPR = 0.9; p.elR = 0.9;
    p.bob = S(t * 1.5) * 0.012;
    p.headYaw = S(t * 0.8) * 0.2;
  },
  // ---- 物理受击反馈（力分级：趔趄 → 击倒 → 击飞） ----
  /** 趔趄：后仰晃动 1.1s，张臂稳住 */
  staggerHit(v, t, p) {
    const k = Math.min(1, v.actionT / 1.1);
    p.bodyPitch = -0.4 * Math.sin(k * Math.PI);
    p.bodyRoll = Math.sin(v.actionT * 13) * 0.28 * (1 - k);
    p.legPL = -0.55 * (1 - k); p.legPR = -0.35 * (1 - k);
    p.kneeL = 0.6 * (1 - k); p.kneeR = 0.45 * (1 - k);
    p.spL = 0.65; p.spR = 0.65; p.shPL = 0.5; p.shPR = 0.5;
    p.headPitch = -0.22 * (1 - k);
    p.crouch = 0.08 * (1 - k);
  },
  /** 击倒：摔倒→躺地→爬起（3.4s 时间线），之后动作层切回站立 */
  knockedDown(v, t, p) {
    const at = v.actionT;
    const fall = Math.min(1, at / 0.25);
    const rise = at > 2.6 ? Math.min(1, (at - 2.6) / 0.8) : 0;
    p.rootPitch = -1.45 * (fall - rise * (1 - 0)); // 后倒
    if (at > 2.6) p.rootPitch = -1.45 * (1 - rise);
    else p.rootPitch = -1.45 * fall;
    p.bob = -0.1;
    p.legPL = -0.5 * (1 - fall * 0.4); p.legPR = -0.3;
    p.kneeL = 0.7 * (1 - rise); p.kneeR = 0.5;
    p.shPL = 1.6 * (1 - rise); p.shPR = 1.3 * (1 - rise);
    p.spL = 0.9; p.spR = 0.9;
    p.headPitch = 0.3 * fall;
    if (rise >= 1) { p.rootPitch = 0; }
  },
  /** 被击飞：空中大字形，位置由物理系统积分，落地转 knockedDown */
  launched(v, t, p) {
    p.rootPitch = -0.9 + Math.sin(v.actionT * 6) * 0.25;
    p.bodyRoll = Math.sin(v.actionT * 4) * 0.3;
    p.shPL = 2.6; p.shPR = 2.6; p.spL = 0.1; p.spR = 0.1; p.elL = 0.15; p.elR = 0.15;
    p.legPL = -0.7; p.legPR = -0.5; p.kneeL = 0.4; p.kneeR = 0.3;
    p.headPitch = -0.5;
  },
};

// Pose 扩展字段（防御：动作里误写不存在的键）
interface PoseExtra { headRollAlias?: number; bodyYawAlias?: number }
export type { PoseExtra };
