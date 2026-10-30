"""python grid.py <dir> <out-prefix> [per_page]: one row per spell, one column per moment, labelled."""
import glob, os, sys
from PIL import Image, ImageDraw
d, prefix = sys.argv[1], sys.argv[2]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 6
files = sorted(glob.glob(os.path.join(d, '*.jpg')))
rows = {}
for f in files:
    k, m = os.path.basename(f)[:-4].split('__')
    rows.setdefault(k, {})[m] = f
keys = list(rows)
cols = ['1-antic', '2-release', '3-impact', '4-overview', '5-after']
first = Image.open(next(iter(rows[keys[0]].values())))
w, h = first.size
scale = 0.6 if w > 300 else 1
tw, th = int(w * scale), int(h * scale)
for p in range(0, len(keys), per):
    page = keys[p:p + per]
    sheet = Image.new('RGB', (tw * 5, th * len(page)), (12, 12, 12))
    dr = ImageDraw.Draw(sheet)
    for r, k in enumerate(page):
        for c, m in enumerate(cols):
            if m in rows[k]:
                sheet.paste(Image.open(rows[k][m]).resize((tw, th)), (c * tw, r * th))
        dr.text((6, r * th + 4), k, fill=(255, 255, 0))
    sheet.save(f'{prefix}-{p // per:02d}.jpg', quality=85)
    print(f'{prefix}-{p // per:02d}.jpg', page)
