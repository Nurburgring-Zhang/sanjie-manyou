"""对比两组机位截图：亮度变化与差异像素占比。

用法：python scripts/compare-shots.py <baseline_dir> <current_dir> [camera...]
输出每机位一行：mean_lum 变化、差异像素占比（>18/255 视为变化）。
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

base = Path(sys.argv[1])
cur = Path(sys.argv[2])
only = sys.argv[3:]
names = sorted(p.stem for p in cur.glob('*.png'))
if only:
    names = [n for n in names if n in only]

print(f"{'camera':<14}{'lum_base':>9}{'lum_now':>9}{'d_lum':>8}{'diff_px%':>9}")
for n in names:
    a = base / f'{n}.png'
    b = cur / f'{n}.png'
    if not a.exists() or not b.exists():
        continue
    ia = Image.open(a).convert('L').crop((0, 90, 1600, 860))
    ib = Image.open(b).convert('L').crop((0, 90, 1600, 860))
    if ia.size != ib.size:
        ib = ib.resize(ia.size)
    ma, mb = ImageStat.Stat(ia).mean[0], ImageStat.Stat(ib).mean[0]
    diff = ImageChops.difference(ia, ib).point(lambda v: 255 if v > 18 else 0)
    changed = ImageStat.Stat(diff).mean[0] / 255 * 100
    print(f'{n:<14}{ma:>9.1f}{mb:>9.1f}{mb - ma:>+8.1f}{changed:>8.1f}%')
