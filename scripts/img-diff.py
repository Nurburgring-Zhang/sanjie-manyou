"""改前/改后逐像素差异：输出差异包围盒、差异像素数，以及一张放大的差异热区图。

用法：python -X utf8 scripts/img-diff.py <before.png> <after.png> <out.png>
"""
import sys
from PIL import Image, ImageChops, ImageDraw

a_path, b_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
a = Image.open(a_path).convert("RGB")
b = Image.open(b_path).convert("RGB")
if a.size != b.size:
    print(f"size mismatch {a.size} vs {b.size}")
    sys.exit(2)
diff = ImageChops.difference(a, b).convert("L")
# 阈值 8/255：压掉 ACES 抖动与阴影重绘的 1-2 级噪声
mask = diff.point(lambda v: 255 if v > 8 else 0)
bbox = mask.getbbox()
n = sum(1 for v in mask.getdata() if v)
print(f"diff>b8 pixels={n} ({n / (a.size[0] * a.size[1]) * 100:.2f}%) bbox={bbox}")
if not bbox:
    sys.exit(0)
# 差异热区：在原图上叠红色，并画框
hot = b.copy()
red = Image.new("RGB", a.size, (255, 40, 40))
hot.paste(red, (0, 0), mask)
d = ImageDraw.Draw(hot)
d.rectangle(bbox, outline=(0, 255, 120), width=3)
hot.save(out_path)
print(f"wrote {out_path}")
