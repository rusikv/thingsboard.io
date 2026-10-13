"""Pixel-diff matching PNGs in two directories: max channel delta and share of pixels over 5/255."""
import os
import sys

from PIL import Image, ImageChops

a_dir, b_dir = sys.argv[1], sys.argv[2]
worst = []
for name in sorted(os.listdir(a_dir)):
    if not name.endswith('.png'):
        continue
    pb = os.path.join(b_dir, name)
    if not os.path.exists(pb):
        print(f'MISSING in fix: {name}')
        continue
    a = Image.open(os.path.join(a_dir, name)).convert('RGB')
    b = Image.open(pb).convert('RGB')
    if a.size != b.size:
        print(f'SIZE {name}: {a.size} vs {b.size}')
        continue
    d = ImageChops.difference(a, b)
    mx = max(hi for _, hi in d.getextrema())
    g = d.convert('L')
    hist = g.histogram()
    over = sum(hist[6:]) / (a.size[0] * a.size[1])
    worst.append((mx, over, name))
worst.sort(reverse=True)
print(f'{len(worst)} pairs; worst max delta {worst[0][0] if worst else "-"}')
for mx, over, name in worst[:15]:
    print(f'  max {mx:3d}  >5: {over * 100:6.3f}%  {name}')
