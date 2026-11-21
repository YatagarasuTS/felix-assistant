# Феликс: перекраска худи из пресета VRoid (мята + шоколад) в собственный дизайн:
# бирюзовое худи с тёмно-синими «потёками краски», синие манжеты, синий подол вместо вафли,
# вместо бирок «MINT x CHOCOLATE» — бирки FELIX, на груди — эмблема-клевер (Феликс = «удачливый»).
# Пересобирает GLB: заменённые картинки → новые bufferView, остальное копируется как есть.
import io, json, struct, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
PREVIEW = sys.argv[3] if len(sys.argv) > 3 else None
NAVY = np.array([0x26, 0x30, 0x3F], np.float32)      # как волосы
NAVY_HI = np.array([0x3A, 0x4A, 0x63], np.float32)
TEAL_DARK = np.array([0x2C, 0x8E, 0x95], np.float32)


def read_glb(path):
    d = open(path, 'rb').read()
    _, _, length = struct.unpack_from('<4sII', d, 0)
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack_from('<I4s', d, off)
        chunks.append((ctype, d[off + 8: off + 8 + clen])); off += 8 + clen
    return json.loads(chunks[0][1]), chunks[1][1]


def write_glb(path, gltf, views):
    """views: список байтов для каждого bufferView (по порядку) — раскладываем заново с выравниванием 4."""
    blob = bytearray()
    for i, v in enumerate(views):
        while len(blob) % 4: blob.append(0)
        gltf['bufferViews'][i]['byteOffset'] = len(blob)
        gltf['bufferViews'][i]['byteLength'] = len(v)
        blob += v
    while len(blob) % 4: blob.append(0)
    gltf['buffers'][0]['byteLength'] = len(blob)
    js = json.dumps(gltf, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(blob), b'BIN\x00')); f.write(blob)


def hsv(rgb):
    """rgb float 0..1 → h (0..360), s, v"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx


def recolor(img, region=None):
    """Шоколад и посыпка → тёмно-синий (с сохранением светотени), вафля → тёмная бирюза."""
    a = np.asarray(img.convert('RGBA')).astype(np.float32)
    rgb = a[..., :3] / 255
    h, s, v = hsv(rgb)
    alpha = a[..., 3] > 8
    teal = (h > 160) & (h < 215) & (s > 0.18)
    white = (s < 0.12) & (v > 0.8)
    grey = (s < 0.12) & (v <= 0.8)
    waffle = (h >= 20) & (h <= 48) & (v > 0.62) & (s < 0.5) & (s > 0.12)
    choc = (~teal) & (~white) & (~grey) & (~waffle) & (s > 0.12)
    if region is not None:
        choc &= region; waffle &= region
    lum = (0.3 * rgb[..., 0] + 0.59 * rgb[..., 1] + 0.11 * rgb[..., 2])
    out = a.copy()
    # шоколад: светлота шоколада (0.1…0.5) → смесь NAVY…NAVY_HI; посыпка (яркая) тоже уходит в NAVY_HI
    t = np.clip((lum - 0.12) / 0.4, 0, 1)[..., None]
    navy = NAVY * (1 - t) + NAVY_HI * t
    out[..., :3] = np.where((choc & alpha)[..., None], navy, out[..., :3])
    # вафля: тёмная бирюза со светотенью
    t2 = np.clip((lum - 0.55) / 0.35, 0, 1)[..., None]
    wf = TEAL_DARK * (0.85 + 0.25 * t2)
    out[..., :3] = np.where((waffle & alpha)[..., None], np.clip(wf, 0, 255), out[..., :3])
    return Image.fromarray(out.astype(np.uint8), 'RGBA'), int((choc & alpha).sum()), int((waffle & alpha).sum())


def inpaint(img, boxes):
    """Закрасить прямоугольники (бирки) окружающей тканью."""
    a = np.asarray(img.convert('RGBA')).copy()
    m = np.zeros(a.shape[:2], np.uint8)
    for x0, y0, x1, y1 in boxes: m[y0:y1, x0:x1] = 255
    rgb = cv2.inpaint(np.ascontiguousarray(a[..., :3]), m, 9, cv2.INPAINT_TELEA)
    a[..., :3] = rgb
    return Image.fromarray(a, 'RGBA')


def clover(draw, cx, cy, r, fill, edge):
    """Четырёхлистный клевер — знак Феликса («удачливый»)."""
    for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
        x, y = cx + dx * r * 0.62, cy + dy * r * 0.62
        draw.ellipse([x - r * 0.55, y - r * 0.55, x + r * 0.55, y + r * 0.55], fill=fill, outline=edge, width=max(2, int(r * 0.08)))
    draw.ellipse([cx - r * 0.2, cy - r * 0.2, cx + r * 0.2, cy + r * 0.2], fill=edge)


def tag(img, box, vertical=False):
    """Бирка FELIX: тёмно-синий прямоугольник с белой надписью и клевером."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    t = Image.new('RGBA', (h, w) if vertical else (w, h), (0x26, 0x30, 0x3F, 255))
    d = ImageDraw.Draw(t)
    tw, th = t.size
    size = int(th * 0.6)
    while size > 6 and ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf', size).getlength('FELIX') > tw - th * 1.15: size -= 1
    font = ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf', size)
    clover(d, th * 0.5, th * 0.5, th * 0.32, (0x2E, 0xD3, 0xC0, 255), (0x1B, 0x22, 0x2D, 255))
    d.text((th * 0.95, th * 0.5), 'FELIX', font=font, fill=(240, 248, 250, 255), anchor='lm')
    if vertical: t = t.rotate(90, expand=True)
    img.alpha_composite(t, (x0, y0))


gltf, binc = read_glb(SRC)
views = []
for bv in gltf['bufferViews']:
    o = bv.get('byteOffset', 0); views.append(bytes(binc[o:o + bv['byteLength']]))


def image_index_of_material(name_part):
    for m in gltf['materials']:
        if name_part in m.get('name', ''):
            return gltf['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    raise KeyError(name_part)


def load(i): return Image.open(io.BytesIO(views[gltf['images'][i]['bufferView']])).convert('RGBA')


def store(i, img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True)
    views[gltf['images'][i]['bufferView']] = b.getvalue()


# 1) основное худи (2048²): сначала закрашиваем бирки и значок на груди, потом перекрашиваем
hood = image_index_of_material('N00_005_01_Tops_01_CLOTH')
im = load(hood)
S = im.size[0] / 1024
bx = lambda x0, y0, x1, y1: tuple(int(round(c * S)) for c in (x0, y0, x1, y1))
TAG_SLEEVE, TAG_FRONT, BADGE = bx(852, 161, 936, 197), bx(281, 852, 314, 936), bx(566, 568, 664, 640)
INPAINT = [bx(855, 163, 902, 196), bx(283, 858, 313, 908), BADGE]
im = inpaint(im, INPAINT)
im, nc, nw = recolor(im)
tag(im, TAG_SLEEVE)
tag(im, TAG_FRONT, vertical=True)
d = ImageDraw.Draw(im)
bc = ((BADGE[0] + BADGE[2]) / 2, (BADGE[1] + BADGE[3]) / 2)
clover(d, bc[0], bc[1], 26 * S, (0xF2, 0xFB, 0xF9, 255), (0x26, 0x30, 0x3F, 255))
store(hood, im)
print('hoodie: chocolate px', nc, 'waffle px', nw)

# 2) детали худи из пресета — белые «хвосты» рубашки и вафельный клин — убираем: прозрачная текстура + alphaMode MASK
for part in ('N00_007_01_Tops_01_CLOTH_01', 'N00_007_01_Tops_01_CLOTH_02'):
    i = image_index_of_material(part)
    store(i, Image.new('RGBA', (8, 8), (0, 0, 0, 0)))
    for m in gltf['materials']:
        if m.get('name', '').startswith(part + ' '):
            m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5
            mt = m.get('extensions', {}).get('VRMC_materials_mtoon')
            if mt: mt['transparentWithZWrite'] = False
    print('hidden', part)

# 3) превью-картинка VRM: перекрасить только воротник (низ кадра), волосы не трогать
for i, img in enumerate(gltf['images']):
    if img.get('name') == 'Thumbnail':
        th = load(i); H = th.size[1]
        reg = np.zeros((H, th.size[0]), bool); reg[int(H * 0.72):, :] = True
        th2, a, b = recolor(th, reg); store(i, th2); print('thumbnail', a, b)

# метаданные
meta = gltf['extensions']['VRMC_vrm']['meta']
meta['name'] = 'Felix'
meta['version'] = '1.0'
write_glb(DST, gltf, views)
print('written', DST)
if PREVIEW:
    v = load(hood); bg = Image.new('RGBA', v.size, (80, 80, 80, 255)); bg.alpha_composite(v)
    bg.convert('RGB').resize((1024, 1024)).save(PREVIEW)
