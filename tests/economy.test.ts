import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InteractSystem } from '../src/game/interact';
import { createCalendar, daySpeed, MS_PER_DAY } from '../src/game/calendar';
import type { PlayerController } from '../src/game/player';

/**
 * FIX-012 R4：经济规则单测。
 * vitest 默认 node 环境无 DOM/localStorage/window —— 这里注入最小 stub，
 * 只走 grantPeach()/redeemFerryTicket()/save()/load() 这些无面板依赖的结算路径。
 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const uiRoot = { appendChild: () => {} } as unknown as HTMLElement;
const player = { interactHook: null } as unknown as PlayerController;

beforeEach(() => {
  Object.assign(globalThis, {
    localStorage: new MemStorage(),
    document: {
      createElement: () => ({ id: '', style: {}, textContent: '', appendChild: () => {}, classList: { toggle: () => {} } }),
    },
    window: {},
  });
});

function make(): InteractSystem { return new InteractSystem(uiRoot, player); }

describe('FIX-012 · 蟠桃赏赐日 cap / 冥途牒渡票 / source 唯一性', () => {
  it('① 同一游戏日第二次 peachgrant 被拒（话术「今日已蒙赏赐」）', () => {
    const it = make();
    it.setCalendar(createCalendar());
    it.peach = 3;
    expect(it.grantPeach().ok).toBe(true);
    expect(it.peach).toBe(2);
    expect(it.coins).toBe(600);                 // 500 缺省 + 100
    const second = it.grantPeach();
    expect(second.ok).toBe(false);
    expect(second.msg).toContain('今日已蒙赏赐');
    expect(it.peach).toBe(2);                  // 被拒不扣蟠桃、不进账
    expect(it.coins).toBe(600);
  });

  it('② 注入 clock 前进一日后恢复赏赐', () => {
    let t = 0;
    const cal = createCalendar({ clock: () => t });
    const it = make();
    it.setCalendar(cal);
    it.peach = 5;
    expect(it.grantPeach().ok).toBe(true);
    expect(it.grantPeach().ok).toBe(false);    // 同日仍拒
    t = MS_PER_DAY / daySpeed() + 1000;        // 前进一个游戏日（毫秒）
    cal.tick(t);                               // 外部驱动 → onNewDay 清零 peachGrantedToday
    expect(it.grantPeach().ok).toBe(true);
    expect(it.peachGrantedToday).toBe(1);
  });

  it('③ 冥途牒不再产蟠桃，改产忘川渡票', () => {
    const it = make();
    it.peach = 5;
    it.yinde = 20;
    const r = it.redeemFerryTicket();
    expect(r.ok).toBe(true);
    expect(it.peach).toBe(5);                  // 蟠桃数量必须不变
    expect(it.ferryTicket).toBe(1);
    expect(it.yinde).toBe(10);
    expect(r.msg).toContain('渡票');
    expect(r.msg).not.toContain('蟠桃');
  });

  it('④ 忘川渡票上限 3', () => {
    const it = make();
    it.yinde = 100;
    for (let i = 0; i < 3; i++) expect(it.redeemFerryTicket().ok).toBe(true);
    expect(it.ferryTicket).toBe(3);
    const r = it.redeemFerryTicket();
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('已满');
    expect(it.ferryTicket).toBe(3);
    expect(it.yinde).toBe(70);                 // 只结算了 3 次，第 4 次不扣阴德
  });

  it('⑤ fs 机检：全 src 中 addPeach( 的调用方文件恰好 2 个，且 interact.ts 内无调用', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const srcDir = path.join(ROOT, 'src');
    const hit: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && fs.readFileSync(p, 'utf8').includes('addPeach(')) {
          hit.push(path.relative(ROOT, p).replace(/\\/g, '/'));
        }
      }
    };
    walk(srcDir);
    expect(hit.sort()).toEqual(['src/game/interact.ts', 'src/world.ts']);
    const interact = fs.readFileSync(path.join(srcDir, 'game/interact.ts'), 'utf8');
    expect(interact.match(/\baddPeach\(/g)).toHaveLength(1);   // 仅方法定义，冥途牒已不再调用
  });
});
