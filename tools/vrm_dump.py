# Показать материалы и текстуры VRM (GLB) и выгрузить картинки для осмотра
import json, struct, sys, io, os
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
data = open(src, 'rb').read()
magic, ver, length = struct.unpack_from('<4sII', data, 0)
off = 12
chunks = []
while off < length:
    clen, ctype = struct.unpack_from('<I4s', data, off)
    chunks.append((ctype, data[off + 8: off + 8 + clen]))
    off += 8 + clen
gltf = json.loads(chunks[0][1])
binc = chunks[1][1]
print('materials:')
for i, m in enumerate(gltf['materials']):
    pbr = m.get('pbrMetallicRoughness', {})
    tex = pbr.get('baseColorTexture', {}).get('index')
    ext = m.get('extensions', {})
    mt = ext.get('VRMC_materials_mtoon', {})
    shade = mt.get('shadeMultiplyTexture', {}).get('index')
    print(f"  {i:2d} {m.get('name')!r:50} base_tex={tex} shade_tex={shade} factor={pbr.get('baseColorFactor')}")
print('textures -> images:', [(i, t.get('source')) for i, t in enumerate(gltf['textures'])])
for i, im in enumerate(gltf['images']):
    bv = gltf['bufferViews'][im['bufferView']]
    raw = binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    img = Image.open(io.BytesIO(raw))
    print(f"  image {i}: {im.get('name')!r} {im.get('mimeType')} {img.size} {img.mode}")
    img.save(os.path.join(out, f"{i:02d}_{(im.get('name') or 'img').replace('/', '_')}.png"))
print('meshes:', [m.get('name') for m in gltf['meshes']])
print('extensionsUsed:', gltf.get('extensionsUsed'))
