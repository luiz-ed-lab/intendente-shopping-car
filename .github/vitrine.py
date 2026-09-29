# Vitrine da página inicial: só fotos perfeitas, a regra do Luiz (29/09/2026): carro inteiro, sem tarja
# (faixa lisa branca ou preta nas bordas), sem selo, texto ou logo posto por cima, foto deitada e com boa resolução.
# Roda todo dia pelo GitHub Actions (.github/workflows/vitrine.yml) e grava vitrine.json, que a home lê.
# Uso: python .github/vitrine.py https://endereco-do-site vitrine.json   (COOKIE="..." para uma prévia protegida)
import sys, os, io, json, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

# Lojas cujas fotos de capa seguem o padrão (conferidas uma a uma em 29/09/2026). Selo colado na foto não dá para
# achar sozinho com segurança, então a loja é conferida por gente. Ficaram de fora: selo, texto ou logo por cima
# (Alfa Car, Apollo, Astral, Grande Estilo, Jay Motors, Jazz, Luma Car, Robmar, T.F.A.), tarja em quase todas
# (Bragança), carro cortado, fundo poluído ou foto de todo jeito (FLX, Garra Vip, GTS IndyCar, HiperCar, Lazari)
# e só motos (Riomix). Loja nova só entra depois de conferida.
LOJAS = ['AG Rio Car', 'Auto Barra', 'BitCar Automóveis', 'Maiorano Veículos', 'Perfil Multimarcas', 'TurboMix Veículos']

SITE, SAIDA = sys.argv[1].rstrip('/'), sys.argv[2]

def baixa(url, cabecalhos={}):
    # sem User-Agent de navegador: o servidor das fotos recusa (403) um "Mozilla" incompleto
    with urllib.request.urlopen(urllib.request.Request(url, headers=cabecalhos), timeout=60) as r:
        return r.read()

def tarja(g):
    """espessura da maior faixa lisa (branca ou preta) numa borda, em fração da foto"""
    def borda(linhas):
        n = 0
        for l in linhas:
            if l.std() < 4 and (l.mean() > 225 or l.mean() < 14): n += 1
            else: break
        return n / len(linhas)
    return max(borda(g), borda(g[::-1]), borda(g.T), borda(g.T[::-1]))

def perfeita(url):
    """foto deitada, com resolução boa e sem tarja"""
    try:
        im = Image.open(io.BytesIO(baixa(url)))
        w, h = im.size
        if w < 1000 or not 1.25 <= w / h <= 1.9: return False
        im.draft('L', (w // 4, h // 4))   # o JPEG já sai reduzido: bem mais rápido
        return tarja(np.asarray(im.convert('L').resize((320, 240)), dtype=np.float32)) < .015
    except Exception:
        return False

if os.path.exists(SITE):
    veic = json.load(open(SITE, encoding='utf-8'))
else:
    veic = json.loads(baixa(SITE + '/api/veiculos?path=veiculos&site=1', {'Cookie': os.environ.get('COOKIE', '')}))
cands = [v for v in veic if v.get('fotos') and v.get('tipo') == 'carro' and v.get('loja_nome') in LOJAS]
with ThreadPoolExecutor(16) as ex:   # só a capa: a segunda foto pode ser o painel ou a traseira
    res = list(ex.map(lambda v: perfeita(v['fotos'][0]), cands))
fotos = {str(v['id']): 0 for v, ok in sorted(zip(cands, res), key=lambda x: x[0]['id']) if ok}
json.dump({'fotos': fotos}, open(SAIDA, 'w', encoding='utf-8'), separators=(',', ':'))
print(f'{len(fotos)} de {len(cands)} carros na vitrine', file=sys.stderr)
