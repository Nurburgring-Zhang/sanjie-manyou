"""把改前/改后两张图并排成一张对照图（上：改前；下：改后），便于人工判读与交付。

用法：python -X utf8 scripts/roof-pair.py <before.png> <after.png> <out.png> <标题>
"""
import sys
from PIL import Image, ImageDraw, ImageFont

before, after, out, title = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
a = Image.open(before).convert("RGB")
b = Image.open(after).convert("RGB")
W = min(a.width, b.width)
H = min(a.height, b.height)
a = a.crop((0, 0, W, H))
b = b.crop((0, 0, W, H))

BAR = 34
canvas = Image.new("RGB", (W, H * 2 + BAR), (12, 12, 14))
canvas.paste(a, (0, BAR))
canvas.paste(b, (0, BAR + H))
d = ImageDraw.Draw(canvas)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
except OSError:
    font = ImageFont.load_default()
d.text((10, 7), title, fill=(255, 220, 120), font=font)
d.text((10, BAR + 8), "BEFORE (改前)", fill=(255, 90, 90), font=font)
d.text((10, BAR + H + 8), "AFTER (改后)", fill=(90, 255, 140), font=font)
canvas.save(out)
print(f"wrote {out} ({W}x{H * 2 + BAR})")
