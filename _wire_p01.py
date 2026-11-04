import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

INJECT = (
    "\n    // P0-1 步 1：登记实体表（pos 为快照，beast 分量字段步 2 改引用同步；谁都不读）\n"
    "    allocate('beast', { pos: { x: this.beasts[this.beasts.length - 1].x, y: this.beasts[this.beasts.length - 1].y, z: this.beasts[this.beasts.length - 1].z } });"
)

# ---- crowd.ts ----
p = 'src/actors/crowd.ts'
src = open(p, encoding='utf-8').read()
if "a.eid = allocate('npc'" not in src:
    old = "    initBehavior(a, undefined, this.rng);\n    return a;\n  }"
    assert src.count(old) == 1, 'crowd anchor count=%d' % src.count(old)
    new = (
        "    initBehavior(a, undefined, this.rng);\n"
        "    // P0-1 步 1：登记实体表（谁都不读，零行为变化）；pos 传 Vector3 引用（结构兼容 {x,y,z}，天然同步）\n"
        "    a.eid = allocate('npc', { pos: a.pos, persist: true });\n"
        "    return a;\n  }"
    )
    src = src.replace(old, new, 1)
if "from '../rt/entity'" not in src:
    old_imp = "import { JOBS, JOB_MAP, SpotRegistry } from '../data/jobs';"
    assert src.count(old_imp) == 1, 'crowd import anchor'
    src = src.replace(old_imp, old_imp + "\nimport { allocate } from '../rt/entity';", 1)
open(p, 'w', encoding='utf-8', newline='').write(src)
print('crowd.ts wired')

# ---- creatures.ts ----
p = 'src/sky/creatures.ts'
src = open(p, encoding='utf-8').read()
if "allocate('beast'" not in src:
    pat = 'this.beasts.push({'
    assert src.count(pat) == 2, 'beasts.push count=%d' % src.count(pat)
    idx = 0
    inserted = 0
    while True:
        j = src.find(pat, idx)
        if j == -1:
            break
        end = src.find('\n    });', j)
        assert end != -1, 'push block end not found'
        insert_pos = end + len('\n    });')
        src = src[:insert_pos] + INJECT + src[insert_pos:]
        inserted += 1
        idx = insert_pos + len(INJECT)
    assert inserted == 2, 'inserted=%d' % inserted
if "from '../rt/entity'" not in src:
    first_import = re.search(r'^import .*?;$', src, re.M)
    assert first_import, 'no import line'
    src = src.replace(first_import.group(0), first_import.group(0) + "\nimport { allocate } from '../rt/entity';", 1)
open(p, 'w', encoding='utf-8', newline='').write(src)
print('creatures.ts wired (2 sites)')
