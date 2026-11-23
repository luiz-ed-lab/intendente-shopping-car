# Prepara os vídeos das publicações (pedido do Luiz, 23/11/2026: "uma opção de vídeo no mural", com o vídeo sempre inteiro).
# O painel manda o vídeo aos pedaços, e cada pedaço vira um blob no GitHub (a API, acao 'parte'); a publicação é gravada com a lista dos
# pedaços em "video.partes" e fica fora do site. Este robô roda logo depois (.github/workflows/videos.yml): junta os pedaços, converte para
# MP4 H.264 com o som em AAC (o formato que todo navegador toca; o vídeo do iPhone vem em HEVC, que o Chrome não toca), no máximo
# 1920 px no lado maior, até 3 minutos e uns 45 MB, tira a capa num quadro do começo e grava fotos-publicacoes/<id>.mp4 e <id>.jpg.
# Na publicação, "video" passa a ser { id, src, poster, w, h, dur }; com erro, { id, erro }, que o painel mostra.
# uso: python3 .github/videos.py --ver   (escreve ha=1 se tem vídeo esperando)  |  python3 .github/videos.py   (prepara e aplica)
# Os vídeos prontos ficam em /tmp/videos-aceima: se outra gravação entrar no meio, o robô aplica de novo sem converter outra vez.
import base64, json, os, re, shutil, subprocess, sys, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQ = os.path.join(RAIZ, 'publicacoes.json')
PASTA = 'fotos-publicacoes'
CACHE = os.path.join(os.environ.get('RUNNER_TEMP') or '/tmp', 'videos-aceima')
MAX_DUR = 180              # 3 minutos
MAX_MB = 45                # o arquivo final fica abaixo disso (o GitHub recusa arquivo de mais de 100 MB)
# o vídeo do iPhone vem em HDR (HLG, cores BT.2020): sem converter, fica com as cores lavadas fora do iPhone. A conversão para o vídeo
# comum (BT.709) usa o tone mapping "hable", o que deixou a pele e o branco naturais no teste com um vídeo de verdade da Aceima
TOM_HDR = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,'


def tem_tonemap():
    try:
        f = subprocess.run(['ffmpeg', '-hide_banner', '-filters'], capture_output=True, text=True, timeout=60).stdout
        return ' zscale ' in f and ' tonemap ' in f
    except Exception:
        return False


def pendentes(pubs):
    return [p for p in pubs if isinstance(p, dict) and isinstance(p.get('video'), dict) and p['video'].get('partes')]


def baixar(sha, destino):
    """um pedaço do vídeo, pela marca do blob (a API do GitHub devolve o conteúdo em base64, como recebeu da API do site)."""
    req = urllib.request.Request(f"https://api.github.com/repos/{os.environ['REPO']}/git/blobs/{sha}", headers={
        'Authorization': f"Bearer {os.environ['GH_TOKEN']}", 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'aceima-videos'})
    with urllib.request.urlopen(req, timeout=120) as r:
        j = json.load(r)
    if j.get('encoding') != 'base64' or j.get('sha') != sha:
        raise ValueError('blob inesperado')
    with open(destino, 'ab') as f:
        f.write(base64.b64decode(j['content']))


def sonda(arq):
    out = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arq],
                         capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout or '{}')


def preparar(v):
    vid = str(v.get('id') or '')
    if not re.fullmatch(r'[a-z0-9-]{1,140}', vid):
        return {'erro': 'Vídeo sem identificação. Envie de novo.'}
    pasta = os.path.join(CACHE, vid)
    pronto = os.path.join(pasta, 'pronto.json')
    if os.path.exists(pronto):
        with open(pronto, encoding='utf-8') as f:
            return json.load(f)
    os.makedirs(pasta, exist_ok=True)
    orig, saida, capa = os.path.join(pasta, 'original'), os.path.join(pasta, 'video.mp4'), os.path.join(pasta, 'capa.jpg')
    if os.path.exists(orig):
        os.remove(orig)
    try:
        for sha in v['partes']:
            if not re.fullmatch(r'[0-9a-f]{40}', str(sha)):
                raise ValueError('marca inválida')
            baixar(sha, orig)
    except Exception as e:
        print('falhou ao baixar', vid, e)
        return {'erro': 'O vídeo não chegou inteiro. Envie de novo.'}
    if v.get('tamanho') and os.path.getsize(orig) != v['tamanho']:
        print('tamanho diferente', vid, os.path.getsize(orig), v['tamanho'])
        return {'erro': 'O vídeo não chegou inteiro. Envie de novo.'}
    info = sonda(orig)
    vs = [s for s in (info or {}).get('streams', []) if s.get('codec_type') == 'video']
    if not info or not vs:
        return {'erro': 'Não deu para ler o vídeo. Envie em MP4 ou MOV.'}
    try:
        dur = float(info['format'].get('duration') or vs[0].get('duration') or 0)
    except (TypeError, ValueError):
        dur = 0
    dur = min(dur or MAX_DUR, MAX_DUR)
    # a taxa do vídeo para o arquivo ficar abaixo de MAX_MB (e no máximo 6 Mbps, que já é a qualidade de um vídeo bom na internet)
    total = int(MAX_MB * 8 * 1024 / max(dur, 1))
    taxa = max(900, min(6000, total - 160))
    hdr = (vs[0].get('color_transfer') or '').lower() in ('arib-std-b67', 'smpte2084')
    # diminui antes (no máximo 1920 px no lado maior) e, no HDR, converte as cores depois, já no tamanho final (bem mais rápido)
    escala = ("scale=w='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)':flags=lanczos,"
              + (TOM_HDR if hdr and tem_tonemap() else '') + "setsar=1,format=yuv420p")
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', orig, '-t', str(MAX_DUR), '-map', '0:v:0', '-map', '0:a:0?', '-vf', escala,
           '-fpsmax', '60', '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', '21',
           '-maxrate', f'{taxa}k', '-bufsize', f'{taxa * 2}k', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
           '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
           '-movflags', '+faststart', saida]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not os.path.exists(saida):
        print('ffmpeg falhou', vid, r.stderr[-2000:])
        return {'erro': 'Não deu para converter o vídeo. Envie em MP4 ou MOV.'}
    fim = sonda(saida)
    fv = [s for s in (fim or {}).get('streams', []) if s.get('codec_type') == 'video']
    if not fim or not fv:
        return {'erro': 'Não deu para converter o vídeo. Envie em MP4 ou MOV.'}
    w, h = int(fv[0]['width']), int(fv[0]['height'])
    d = float(fim['format'].get('duration') or dur)
    # a capa: um quadro logo do começo (1 s, ou 10% de um vídeo curto), na qualidade do vídeo
    t = min(1.0, d * 0.1)
    r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', saida, '-frames:v', '1', '-q:v', '3', capa],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0 or not os.path.exists(capa):
        print('capa falhou', vid, r.stderr[-1000:])
        return {'erro': 'Não deu para converter o vídeo. Envie em MP4 ou MOV.'}
    res = {'src': f'{PASTA}/{vid}.mp4', 'poster': f'{PASTA}/{vid}.jpg', 'w': w, 'h': h, 'dur': round(d, 1)}
    with open(pronto, 'w', encoding='utf-8') as f:
        json.dump(res, f)
    print('pronto', vid, w, 'x', h, round(d, 1), 's', round(os.path.getsize(saida) / 1e6, 1), 'MB')
    return res


def main():
    with open(ARQ, encoding='utf-8') as f:
        pubs = json.load(f)
    lista = pendentes(pubs)
    if len(sys.argv) > 1 and sys.argv[1] == '--ver':
        print('ha=' + ('1' if lista else '0'))
        return
    if not lista:
        print('Nenhum vídeo esperando.')
        return
    for p in lista:
        v = p['video']
        res = preparar(v)
        vid = str(v.get('id') or '')
        if 'erro' not in res:
            pasta = os.path.join(CACHE, vid)
            shutil.copyfile(os.path.join(pasta, 'video.mp4'), os.path.join(RAIZ, PASTA, vid + '.mp4'))
            shutil.copyfile(os.path.join(pasta, 'capa.jpg'), os.path.join(RAIZ, PASTA, vid + '.jpg'))
        p['video'] = {'id': vid, **res}
    # o mesmo formato que a API grava (JSON.stringify com dois espaços), para o commit mostrar só o que mudou
    with open(ARQ, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(pubs, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
