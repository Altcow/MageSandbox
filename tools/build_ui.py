# 把 GPT 4 張介面樣式圖切進 assets/ui(第 2~4 張;第 1 張待原圖)
import os, sys
os.environ['DIL'] = '0'
sys.path.insert(0, os.path.dirname(__file__))
from slice_ui import key, comps, order
from PIL import Image

def cut(im, b, name):
    c = im.crop((b[1], b[0], b[3], b[2])); bb = c.getbbox(); c = c.crop(bb)
    c.save('assets/ui/%s.png' % name); print(name, c.size)

def sheet(path, names, by=None):
    im = key(Image.open(path)); boxes = comps(im)
    if by == 'geom2':
        # 第 2 張:依位置命名
        top = sorted([b for b in boxes if b[0] < 620], key=lambda b: b[1])
        for n, b in zip(['panel', 'slot', 'slotsel'], top): cut(im, b, n)
        rest = [b for b in boxes if b[0] >= 620]
        left = sorted([b for b in rest if b[1] < 780], key=lambda b: b[0])
        right = sorted([b for b in rest if b[1] >= 780], key=lambda b: b[0])
        for n, b in zip(['capsule', 'hpframe'], left): cut(im, b, n)
        for n, b in zip(['bar_hp', 'bar_mp', 'bar_sp'], right): cut(im, b, n)
    else:
        flat = [b for r in order(boxes, 120) for b in r]
        for n, b in zip(names, flat): cut(im, b, n)

D = sys.argv[1]
sheet(D + '/13.webp', None, 'geom2')
sheet(D + '/14.webp', ['b_wear', 'b_stance', 'b_sit', 'b_wear_dn', 'b_stance_dn', 'b_sit_dn'])
sheet(D + '/15.webp', ['i_near', 'i_cls', 'i_cast', 'b_base', 'b_base_dn', 'b_cancel'])
