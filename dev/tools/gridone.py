import glob, os, sys
from PIL import Image, ImageDraw
d, out, moment = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(glob.glob(os.path.join(d, f'*__{moment}.jpg')))
w, h = Image.open(files[0]).size
cols = 10
rows = (len(files) + cols - 1) // cols
s = Image.new('RGB', (cols * w, rows * h))
dr = ImageDraw.Draw(s)
for i, f in enumerate(files):
    s.paste(Image.open(f), ((i % cols) * w, (i // cols) * h))
    dr.text(((i % cols) * w + 3, (i // cols) * h + 3), os.path.basename(f).split('__')[0].split('_', 1)[-1][:26], fill=(255, 255, 0))
s.save(out, quality=85)
print(out, s.size)
