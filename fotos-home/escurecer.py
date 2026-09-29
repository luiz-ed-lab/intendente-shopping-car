# Escurece uma foto para o fundo das categorias da home, no clima da foto do carro (comprar.jpg, a primeira que o Luiz aprovou):
# curva que leva a mediana da foto até a da foto do carro, menos cor e o mesmo azul frio. Sai em WebP com 1600px de largura.
# Uso: python fotos-home/escurecer.py origem.jpg fotos-home/nome.webp
import sys, os
import numpy as np
from PIL import Image, ImageOps

W = np.array([.2126, .7152, .0722], dtype=np.float32)
ref = np.asarray(Image.open(os.path.join(os.path.dirname(__file__), 'comprar.jpg')).convert('RGB')).astype(np.float32) / 255
tint = ref.reshape(-1, 3).mean(0); tint = tint / (tint @ W)

origem, destino = sys.argv[1], sys.argv[2]
im = ImageOps.exif_transpose(Image.open(origem)).convert('RGB')
im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
f = np.asarray(im).astype(np.float32) / 255
y = f @ W
g = np.clip(np.log(.085) / np.log(np.median(y)), 1.5, 4.5)   # mediana final 0,085, perto da foto do carro (0,07)
out = f * ((y ** g + 1e-3) / (y + 1e-3))[..., None]
c = (out @ W)[..., None]; out = c + (out - c) * .6              # 60% da cor
out = np.clip(out * (.5 + .5 * tint), 0, 1)                    # metade do azul frio da foto do carro
Image.fromarray((out * 255 + .5).astype(np.uint8)).save(destino, 'WEBP', quality=70, method=6)
print(destino, 'gama %.2f' % g, os.path.getsize(destino) // 1024, 'KB')
