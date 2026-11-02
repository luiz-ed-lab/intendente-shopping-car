# O fundo animado da Aceima, gerado do zero por cálculo (02/11/2026, pedido do Luiz: trocar o vídeo do modelo de terceiros, cuja
# licença não foi confirmada). Nada do vídeo antigo entra aqui: são manchas de luz azul e dourada atrás de vidro em diagonal, tudo
# periódico no tempo (o ciclo de 20 segundos se repete sem emenda).
# Variantes: A (vidro em lâminas, o mais parecido com o antigo), B (feixes de luz, sem vidro) e C (vidro ondulado).
# Comparação das três com o vídeo antigo: https://claude.ai/artifact/6fz42GDqeaTr97EUMoKZKr (na conta do Luiz).
#
# Precisa de Python com numpy e do ffmpeg. Gerar o mestre (1280x720, 30 quadros por segundo, 20 s, quase sem perda):
#   python3 docs/fundo-animado/gerar.py A /tmp/A-mestre.mp4
# Versões do site (o vídeo novo vai com nome novo: o aparelho guarda o vídeo por um ano):
#   ffmpeg -i /tmp/A-mestre.mp4 -c:v libx264 -preset veryslow -crf 24 -profile:v high -pix_fmt yuv420p -movflags +faststart -an fundo-aceima-a-720.mp4
#   ffmpeg -i /tmp/A-mestre.mp4 -vf scale=960:540:flags=lanczos -c:v libx264 -preset veryslow -crf 24 -profile:v high -pix_fmt yuv420p -movflags +faststart -an fundo-aceima-a-540.mp4
# O quadro parado (poster e fundo de espera): ffmpeg -ss 7 -i fundo-aceima-a-720.mp4 -frames:v 1 -q:v 3 fundo-aceima-a-quadro.jpg
# Medidos em 02/11/2026 (CRF 24): A 0,9 MB e 0,5 MB; B 0,5 MB e 0,3 MB; C 0,9 MB e 0,6 MB (o antigo: 2,8 MB e 1,7 MB).
import sys, math, subprocess, numpy as np
var = sys.argv[1]; saida = sys.argv[2]
W, H, FPS, T = (int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), float(sys.argv[6])) if len(sys.argv) > 6 else (1280, 720, 30, 20.0)
so = [int(q) for q in sys.argv[7].split('=')[1].split(',')] if len(sys.argv) > 7 else None
N = int(round(FPS * T))
f32 = np.float32
x = ((np.arange(W, dtype=f32) + .5) / H); y = ((np.arange(H, dtype=f32) + .5) / H)
X, Y = np.meshgrid(x, y)
ang = math.radians(38)
A = X * math.cos(ang) - Y * math.sin(ang)          # ao longo das lâminas (sobe para a direita)
S = X * math.sin(ang) + Y * math.cos(ang)          # através das lâminas
TAU = 2 * math.pi
AZ_FUNDO = np.array([.002, .006, .018], f32)
AZUL1 = np.array([.05, .14, .32], f32); AZUL2 = np.array([.08, .22, .46], f32); AZUL3 = np.array([.16, .30, .55], f32)
OURO = np.array([.92, .58, .18], f32)

def mancha(a, s, ca, cs, sa, ss):
    return np.exp(-((a - ca) ** 2) / (2 * sa * sa) - ((s - cs) ** 2) / (2 * ss * ss))

def luz(a, s, t):
    th = TAU * t / T
    out = np.zeros(a.shape + (3,), f32)
    # cada mancha: cor, centro ao longo e através das lâminas (caminhos periódicos), raios e a pulsação (0 a 1)
    bl = [(AZUL2, .15 + .40 * math.sin(th + .3), .45 + .25 * math.sin(2 * th + 1.1), .34, .13, .55 + .45 * math.sin(th + 2.0)),
          (AZUL1, .95 + .30 * math.sin(th + 2.4), 1.30 + .22 * math.sin(th + .7), .42, .16, .6 + .4 * math.sin(2 * th + .5)),
          (AZUL3, .55 + .35 * math.sin(2 * th + 4.0), 1.00 + .30 * math.sin(th + .2), .26, .09, max(0., math.sin(th + 1.7)) ** 1.5),
          (AZUL2, -.20 + .25 * math.sin(th + 5.1), 1.15 + .30 * math.sin(2 * th + 2.6), .30, .12, max(0., math.sin(2 * th + 4.1)) ** 1.2),
          (OURO, .05 + .35 * math.sin(th + .9), .55 + .25 * math.sin(th + 3.3), .24, .085, max(0., math.sin(th + .4)) ** 2.5),
          (OURO, 1.05 + .25 * math.sin(th + 4.2), 1.45 + .20 * math.sin(2 * th + 5.0), .20, .07, max(0., math.sin(th + 3.8)) ** 3)]
    for cor, ca, cs, sa, ss, k in bl:
        if k < .002: continue
        out += (mancha(a, s, ca, cs, sa, ss) * k)[..., None] * cor
    return out

def quadro(i):
    t = i / FPS; th = TAU * t / T
    if var in ('A', 'C'):
        w = .17 if var == 'A' else .16
        if var == 'A':
            S2 = S + .030 * np.sin(TAU * S / .61 + 1.3) + .012 * np.sin(TAU * A / 1.7 + th)
        else:   # vidro ondulado: as lâminas fazem ondas largas que andam devagar
            S2 = S + .034 * np.sin(TAU * A / 1.45 + th) + .010 * np.sin(TAU * A / .62 - 2 * th + .8)
        q = (S2 + w * .35 * math.sin(th)) / w       # as lâminas balançam um terço de lâmina e voltam: o loop fecha sem emenda
        n = np.floor(q); p = q - n
        S3 = S2 + 3.2 * (p - .5) * w                # refração: cada lâmina desloca e estica a luz de trás
        A3 = A + .16 * np.sin(n * 2.39 + .5) + .05 * (p - .5)   # e cada lâmina mostra a luz num ponto um pouco diferente
        cor = luz(A3, S3, t)
        lente = .72 + .28 * np.sin(np.pi * p)
        junta = 1 - .55 * np.exp(-(p / .012) ** 2) - .55 * np.exp(-((1 - p) / .012) ** 2)
        local = luz(A, S2, t).max(axis=2)
        brilho = np.exp(-((p - .93) / .014) ** 2) * (.55 * local ** 1.3)
        img = cor * (lente * junta)[..., None] + brilho[..., None] * np.array([.62, .74, .95], f32) + AZ_FUNDO
    else:   # B: feixes de luz macios, sem vidro, como luz passando por uma persiana
        img = np.zeros((H, W, 3), f32) + AZ_FUNDO
        fx = [(.30, .040, AZUL2, 1, .2), (.62, .060, AZUL1, -1, 1.9), (.95, .030, AZUL3, 2, 3.1), (1.22, .050, AZUL2, -1, 4.4), (1.50, .035, AZUL1, 1, 5.6), (.78, .025, OURO, 1, 2.2), (1.36, .020, OURO, -2, .9)]
        for s0, larg, cor, ciclos, fase in fx:
            cs = s0 + .10 * math.sin(ciclos * th + fase)
            ca = .40 + .45 * math.sin(th * (1 if ciclos > 0 else 2) + fase * 1.3)
            k = (.45 + .45 * math.sin(th + fase)) if cor is not OURO else max(0., math.sin(th + fase)) ** 2
            feixe = np.exp(-((S - cs) ** 2) / (2 * larg * larg)) * np.exp(-((A - ca) ** 2) / (2 * .45 ** 2))
            img += (feixe * k)[..., None] * cor
    return (np.clip(img, 0, 1) * 255 + .5).astype(np.uint8)

if so:   # só alguns quadros, em png (para conferir)
    import zlib, struct
    def png(nome, a):
        cru = b''.join(b'\x00' + a[r].tobytes() for r in range(a.shape[0]))
        def bloco(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        open(nome, 'wb').write(b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) + bloco(b'IDAT', zlib.compress(cru, 6)) + bloco(b'IEND', b''))
    for q in so: png(f'{saida}/{var}-{q:04d}.png', quadro(q))
    sys.exit()
ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '17', '-pix_fmt', 'yuv420p', '-an', saida], stdin=subprocess.PIPE)
for i in range(N):
    ff.stdin.write(quadro(i).tobytes())
ff.stdin.close(); ff.wait()
