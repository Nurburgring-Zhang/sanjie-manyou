#!/usr/bin/env bash
# 并行波的集成检查：类型 → 单测 → 构建 → 19 机位 → 总览图 → 与基线对比
# 用法：bash scripts/integrate.sh [baseline_dir]
set -u
cd "$(dirname "$0")/.." || exit 2
BASE="${1:-screenshots/baseline-20261028}"
FAIL=0
step() { printf '\n===== %s =====\n' "$1"; }

step "1/5 tsc"
if npx tsc --noEmit; then echo "TSC=PASS"; else echo "TSC=FAIL"; FAIL=1; fi

step "2/5 vitest"
if npm test 2>&1 | tee /tmp/cq-test.log | grep -E "Tests|Test Files"; then :; fi
grep -q "failed" /tmp/cq-test.log && { echo "TEST=FAIL"; FAIL=1; } || echo "TEST=PASS"

step "3/5 build"
if npm run build 2>&1 | tail -4; then echo "BUILD=PASS"; else echo "BUILD=FAIL"; FAIL=1; fi

step "4/5 19 机位"
if node audit-chromium.mjs 2>&1 | tail -3; then echo "AUDIT=DONE"; else echo "AUDIT=FAIL"; FAIL=1; fi

step "5/5 总览与差异"
python scripts/contact-sheet.py screenshots/audit-20261027 screenshots/audit-20261027/contact-sheet.jpg 2>&1 | tail -2
python scripts/compare-shots.py "$BASE" screenshots/audit-20261027 2>&1 | head -40

step "6/6 三视角机器复核"
if [ -d screenshots/three-view ]; then
  node scripts/view-report.mjs screenshots/three-view 2>&1 | tail -4
else
  echo "（无 screenshots/three-view，跳过；先跑 node scripts/three-view.mjs）"
fi

printf '\n===== 结果 =====\n'
if [ "$FAIL" -eq 0 ]; then echo "INTEGRATION=PASS"; else echo "INTEGRATION=FAIL"; fi
exit "$FAIL"
