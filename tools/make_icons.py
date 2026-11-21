# Значки Феликса: felix.ico (16–256), tray.png, logo.png — четырёхлистный клевер на бирюзовом фоне
import math, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
TEAL, TEAL_D, NAVY, WHITE = (31, 181, 163), (12, 110, 100), (38, 48, 63), (255, 255, 255)


def clover(d, cx, cy, r, fill, stem=None, stem_w=None):
    if stem:
        w = stem_w or max(2, int(r * 0.16))
        d.line([(cx, cy), (cx + r * 0.55, cy + r * 1.05)], fill=stem, width=w)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = cx + math.cos(a) * r * 0.5, cy + math.sin(a) * r * 0.5
        rr = r * 0.52
        # лист-сердечко: два круга и треугольник к центру
        for s in (-1, 1):
            b = a + s * 0.62
            px, py = x + math.cos(b) * rr * 0.42, y + math.sin(b) * rr * 0.42
            d.ellipse([px - rr * 0.58, py - rr * 0.58, px + rr * 0.58, py + rr * 0.58], fill=fill)
        d.polygon([(cx, cy), (x + math.cos(a + 1.2) * rr * 0.9, y + math.sin(a + 1.2) * rr * 0.9), (x + math.cos(a - 1.2) * rr * 0.9, y + math.sin(a - 1.2) * rr * 0.9)], fill=fill)


def app_icon(S):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # фон: скруглённый квадрат с вертикальным градиентом
    grad = Image.new('RGBA', (S, S))
    for y in range(S):
        t = y / (S - 1)
        grad.paste(tuple(int(TEAL[i] * (1 - t) + TEAL_D[i] * t) for i in range(3)) + (255,), (0, y, S, y + 1))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.24), fill=255)
    im.paste(grad, (0, 0), mask)
    # клевер: тень и белые листья, тёмно-синий стебелёк
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clover(ImageDraw.Draw(sh), S * 0.5, S * 0.47 + S * 0.02, S * 0.33, (0, 40, 36, 110), (0, 40, 36, 110), max(2, int(S * 0.05)))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.02))
    im.alpha_composite(sh)
    d = ImageDraw.Draw(im)
    clover(d, S * 0.5, S * 0.47, S * 0.33, WHITE, NAVY, max(2, int(S * 0.05)))
    d.ellipse([S * 0.5 - S * 0.045, S * 0.47 - S * 0.045, S * 0.5 + S * 0.045, S * 0.47 + S * 0.045], fill=TEAL)
    return im


big = app_icon(512)
big.save(OUT + r'\logo.png')
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
icons = [app_icon(s * 4).resize((s, s), Image.LANCZOS) for s in sizes]
icons[-1].save(OUT + r'\felix.ico', format='ICO', sizes=[(s, s) for s in sizes], append_images=icons[:-1])
# трей: бирюзовый клевер с белой обводкой — виден и на тёмной, и на светлой панели задач
T = 128
tr = Image.new('RGBA', (T, T), (0, 0, 0, 0))
d = ImageDraw.Draw(tr)
clover(d, T * 0.5, T * 0.46, T * 0.44, WHITE, WHITE, int(T * 0.12))
clover(d, T * 0.5, T * 0.46, T * 0.36, TEAL, NAVY, int(T * 0.07))
tr.resize((32, 32), Image.LANCZOS).save(OUT + r'\tray.png')
tr.resize((16, 16), Image.LANCZOS).save(OUT + r'\tray16.png')
print('ok')
