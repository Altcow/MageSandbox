# 切 GPT 介面樣式圖:洋紅去背 -> 連通區塊 -> 依序輸出(左到右、上到下分列)
import sys, numpy as np
from PIL import Image
from collections import deque

def key(im):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # 洋紅度:r、b 高、g 低
    m = np.minimum(r, b) - g
    alpha = np.clip((m - 60) / 80.0, 0, 1)      # m>140 完全透明
    alpha = 1 - alpha
    # 去洋紅溢色:邊緣像素把 r、b 往 g 壓
    spill = np.clip((m - 10) / 130.0, 0, 1) * alpha
    r2 = r - spill * (r - g) * .8
    b2 = b - spill * (b - g) * .8
    out = np.dstack([r2, g, b2, alpha * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

def comps(rgba, minsize=40):
    F = 4
    al = np.asarray(rgba)[..., 3] > 40
    H, W = al.shape
    sm = al[:H // F * F, :W // F * F].reshape(H // F, F, W // F, F).any(axis=(1, 3))
    # 膨脹 2 格(=8px)以連起外框與內部
    d = sm.copy()
    for _ in range(int(__import__("os").environ.get("DIL","2"))):
        e = d.copy(); e[1:] |= d[:-1]; e[:-1] |= d[1:]; e[:, 1:] |= d[:, :-1]; e[:, :-1] |= d[:, 1:]; d = e
    seen = np.zeros_like(d); boxes = []
    h, w = d.shape
    for y0 in range(h):
        for x0 in range(w):
            if d[y0, x0] and not seen[y0, x0]:
                q = deque([(y0, x0)]); seen[y0, x0] = True
                y1 = y2 = y0; x1 = x2 = x0
                while q:
                    y, x = q.popleft()
                    y1 = min(y1, y); y2 = max(y2, y); x1 = min(x1, x); x2 = max(x2, x)
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and d[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                bh = (y2 - y1 + 1) * F; bw = (x2 - x1 + 1) * F
                if bh >= minsize and bw >= minsize:
                    boxes.append((y1 * F, x1 * F, (y2 + 1) * F, (x2 + 1) * F))
    return boxes

def order(boxes, rowtol=60):
    boxes = sorted(boxes, key=lambda b: (b[0] + b[2]) / 2)
    rows = []
    for b in boxes:
        cy = (b[0] + b[2]) / 2
        if rows and abs(cy - rows[-1][0]) < rowtol:
            rows[-1][1].append(b)
        else:
            rows.append([cy, [b]])
    return [sorted(r[1], key=lambda b: b[1]) for r in rows]

if __name__ == '__main__':
    src, prefix = sys.argv[1], sys.argv[2]
    names = sys.argv[3:]
    im = key(Image.open(src))
    flat = [b for r in order(comps(im)) for b in r]
    print(len(flat), 'blocks')
    for b in flat: print(b)
    for nm, b in zip(names, flat):
        c = im.crop((b[1], b[0], b[3], b[2]))
        bb = c.getbbox(); c = c.crop(bb) if bb else c
        c.save('assets/ui/%s.png' % nm); print(nm, c.size)
