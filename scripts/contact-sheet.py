"""把审计机位截图拼成联系表（证据图，逐格标注机位名）。"""
import sys, os
from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else 'screenshots/audit-20261027'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SRC, 'contact-sheet.jpg')
names = sys.argv[3].split(',') if len(sys.argv) > 3 else [
    'bridge', 'sunyang', 'wharf', 'gate', 'lingxiao', 'jiangtai', 'star9', 'naihe', 'yanluo',
    'fengdu', 'shibayu', 'zichen', 'mt_泰山', 'desert', 'yaochi', 'sansheng', 'wangxiang', 'mengpo', 'scroll',
]
TW, TH, COLS = 400, 225, 5
rows = (len(names) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * TW, rows * (TH + 22)), (10, 12, 16))
draw = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    p = os.path.join(SRC, n.replace('/', '_') + '.png')
    x, y = (i % COLS) * TW, (i // COLS) * (TH + 22)
    if os.path.exists(p):
        im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
        sheet.paste(im, (x, y))
    else:
        draw.rectangle([x, y, x + TW, y + TH], outline=(80, 40, 40))
    draw.text((x + 6, y + TH + 4), n, fill=(210, 220, 230))
sheet.save(OUT, quality=88)
print('contact sheet ->', OUT, sheet.size)
