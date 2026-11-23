# Acha os rostos nas fotos das publicações e grava fotos-publicacoes/rostos.json (pedido do Luiz, 23/11/2026: "um intermediário
# invisível entre a postagem e a publicação" que identifica os rostos e faz o melhor encaixe das fotos no site).
# Roda no GitHub logo depois de cada postagem (.github/workflows/rostos.yml). O site (fotos.js, enquadrar) usa os rostos para pôr as
# pessoas no quadro, em qualquer tamanho de moldura. Detector: YuNet (OpenCV), modelo em .github/yunet.onnx.
# Só olha as fotos que ainda não estão no arquivo e tira as que saíram das publicações. Cada rosto: [x, y, largura, altura, nota],
# de 0 a 1 em relação à foto, os maiores primeiro.
import json, os
import cv2

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELO = os.path.join(RAIZ, '.github', 'yunet.onnx')
ARQ = os.path.join(RAIZ, 'fotos-publicacoes', 'rostos.json')


def fotos_das_publicacoes():
    with open(os.path.join(RAIZ, 'publicacoes.json'), encoding='utf-8') as f:
        pubs = json.load(f)
    out = []
    for p in pubs:
        for c in (p.get('fotos') or ([p['foto']] if p.get('foto') else [])):
            if c and c not in out:
                out.append(c)
    return out


def rostos(caminho, det):
    im = cv2.imread(os.path.join(RAIZ, caminho), cv2.IMREAD_COLOR)
    if im is None:
        return None
    H, W = im.shape[:2]
    k = min(1.0, 1280 / max(W, H))   # o detector vê a foto com no máximo 1280 px: acha rosto pequeno sem demorar
    if k < 1:
        im = cv2.resize(im, (round(W * k), round(H * k)), interpolation=cv2.INTER_AREA)
    h, w = im.shape[:2]
    det.setInputSize((w, h))
    _, fs = det.detect(im)
    lista = []
    for r in (fs if fs is not None else []):
        x, y, fw, fh, nota = float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[-1])
        x0, y0, x1, y1 = max(0.0, x), max(0.0, y), min(w, x + fw), min(h, y + fh)
        if x1 - x0 < 6 or y1 - y0 < 6:
            continue
        lista.append([round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4), round((y1 - y0) / h, 4), round(nota, 2)])
    lista.sort(key=lambda f: -f[2] * f[3])
    return {'w': W, 'h': H, 'rostos': lista[:40]}


def main():
    atual = {}
    if os.path.exists(ARQ):
        with open(ARQ, encoding='utf-8') as f:
            atual = json.load(f)
    det = cv2.FaceDetectorYN.create(MODELO, '', (320, 320), 0.6, 0.3, 500)
    novo = {}
    for c in fotos_das_publicacoes():
        if c in atual:
            novo[c] = atual[c]
            continue
        r = rostos(c, det)
        if r is None:
            print('sem a foto:', c)
            continue
        novo[c] = r
        print(c, len(r['rostos']), 'rosto(s)')
    if novo != atual:
        with open(ARQ, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(novo, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
            f.write('\n')
        print('gravado:', len(novo), 'fotos')
    else:
        print('nada mudou')


main()
