/* Fotos (pedido do Luiz, 31/10/2026). No fim, o recorte automático das fotos das publicações (enquadrar). Em todo lugar do site onde se escolhem fotos (o Venda seu veículo da página inicial, o Repasse e o
   painel), dá para colar uma foto (Ctrl+V), soltar fotos em qualquer parte da página e arrastar as fotos para mudar a ordem, porque a
   primeira é a capa. Cada página só marca os lugares:
   - data-fotos no campo de arquivo (input type=file): as fotos coladas ou soltas entram por ele, como se tivessem sido escolhidas. Vale o
     campo que está na tela (o lugar dele é o data-fotos-area mais próximo, ou o pai); o texto do data-fotos aparece enquanto se arrasta
     uma foto sobre a página.
   - data-ordem="função" na caixa das fotos e data-i em cada foto: arrastar uma foto chama função(de, para) com a posição nova. O que
     estiver marcado com data-x (o botão de tirar a foto) não começa o arrasto. Durante o arrasto as fotos só andam na tela (nada muda na
     página); a ordem nova fica por conta da função. */
(function () {
  if (window.__fotos) return;
  window.__fotos = true;
  const st = document.createElement('style');
  st.textContent = `.fotos-solta{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:24px;background:rgba(0,9,26,.6);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .18s ease}
.fotos-solta.on{opacity:1}
.fotos-solta>div{display:grid;place-items:center;align-content:center;gap:14px;width:min(560px,100%);aspect-ratio:16/9;max-height:70vh;border-radius:28px;border:2px dashed rgba(244,176,92,.8);background:rgba(244,176,92,.08);color:#F4B05C;font:600 18px/1.3 Figtree,sans-serif;text-align:center;transform:scale(.97);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.fotos-solta.on>div{transform:none}
.fotos-solta svg{width:44px;height:44px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
[data-ordem]>[data-i]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
[data-ordem]>[data-i] img{-webkit-user-drag:none;-webkit-touch-callout:none}
@media (hover:hover){[data-ordem]>[data-i]{cursor:grab}}
.fotos-arrasta{position:relative;z-index:60!important;cursor:grabbing!important;box-shadow:0 18px 38px -14px rgba(0,0,0,.6)}
@media (prefers-reduced-motion:reduce){.fotos-solta,.fotos-solta>div{transition:none}}`;
  document.head.appendChild(st);
  const reduz = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // na tela de verdade: um passo escondido (o Venda seu veículo deixa os três passos um sobre o outro) não recebe
  const visivel = el => !!el && el.getClientRects().length > 0 && !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden';
  const areaDe = i => i.closest('[data-fotos-area]') || i.parentElement;
  const campo = () => [...document.querySelectorAll('input[type=file][data-fotos]')].find(i => !i.disabled && visivel(areaDe(i)));
  const imagens = l => [...(l || [])].filter(f => /^image\//.test(f.type));
  // as fotos entram pelo campo, como se tivessem sido escolhidas nele
  function entregar(inp, fs) {
    if (!fs.length) return;
    const dt = new DataTransfer();
    (inp.multiple ? fs : fs.slice(0, 1)).forEach(f => dt.items.add(f));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    const a = areaDe(inp), r = a && a.getBoundingClientRect();
    if (r && (r.bottom < 0 || r.top > innerHeight)) a.scrollIntoView({ behavior: reduz() ? 'auto' : 'smooth', block: 'center' });
  }

  // colar: só quando a área de transferência traz imagem. Num campo de texto, com texto copiado junto, cola o texto
  document.addEventListener('paste', e => {
    const inp = campo(), cd = e.clipboardData;
    if (!inp || !cd) return;
    const fs = imagens(cd.files);
    if (!fs.length) return;
    const t = e.target, texto = t && (t.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(t.tagName) && t.type !== 'file'));
    if (texto && [...cd.types].includes('text/plain')) return;
    e.preventDefault();
    entregar(inp, fs);
  });

  // soltar: enquanto um arquivo passa sobre a página, ela inteira recebe, com o aviso por cima. O aviso some quando o arquivo sai da janela
  // (os eventos de arrastar param de chegar) ou é solto. Arrastar uma imagem da própria página não conta
  let capa = null, tempo = 0, interno = false;
  document.addEventListener('dragstart', e => { if (!e.defaultPrevented) interno = true; });
  document.addEventListener('dragend', () => { interno = false; });
  const comArquivo = e => !interno && e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  function mostrar(inp) {
    if (!capa) { capa = document.createElement('div'); capa.className = 'fotos-solta'; capa.setAttribute('aria-hidden', 'true'); document.body.appendChild(capa); }
    const t = inp.dataset.fotos || 'Solte as fotos aqui';
    if (capa.dataset.t !== t) {
      capa.dataset.t = t;
      capa.innerHTML = '<div><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-9 7"/></svg><span></span></div>';
      capa.querySelector('span').textContent = t;
    }
    if (!capa.classList.contains('on')) requestAnimationFrame(() => capa && capa.classList.add('on'));
  }
  const esconder = () => { if (capa) capa.classList.remove('on'); };
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
    if (!comArquivo(e)) return;
    const inp = campo();
    if (!inp) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    mostrar(inp);
    clearTimeout(tempo);
    tempo = setTimeout(esconder, 180);
  }));
  document.addEventListener('drop', e => {
    if (!comArquivo(e)) return;
    const inp = campo();
    if (!inp) return;
    e.preventDefault();
    clearTimeout(tempo);
    esconder();
    entregar(inp, imagens(e.dataTransfer.files));
  });

  // arrastar para mudar a ordem: com o mouse, começa ao mover; no toque, depois de segurar um instante parado (antes disso, o dedo rola a
  // página). As outras fotos abrem espaço deslizando; solta, a foto vai para o lugar e a função da página grava a ordem nova
  let A = null, semClique = 0;
  const itens = box => [...box.children].filter(c => c.matches('[data-i]'));
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  document.addEventListener('pointerdown', e => {
    if (A || e.button > 0) return;
    const it = e.target.closest && e.target.closest('[data-ordem]>[data-i]');
    if (!it || e.target.closest('[data-x]')) return;
    const box = it.parentElement, l = itens(box);
    if (l.length < 2) return;
    A = { it, box, l, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, toque: e.pointerType !== 'mouse', vivo: false, de: l.indexOf(it) };
    if (A.toque) A.t = setTimeout(() => { if (A && !A.vivo) comecar(); }, 240);
  }, true);
  function comecar() {
    A.vivo = true;
    clearTimeout(A.t);
    const br = A.box.getBoundingClientRect();
    A.br = br;
    A.vagas = A.l.map(el => { const r = el.getBoundingClientRect(); return { x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height }; });
    A.para = A.de;
    A.it.classList.add('fotos-arrasta');
    A.l.forEach(el => { if (el !== A.it) el.style.transition = reduz() ? 'none' : `transform .26s ${ease}`; });
    A.it.style.transition = 'none';
    if (A.toque && navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
    mover();
  }
  // de uma vaga para outra (as vagas podem ter tamanhos diferentes): o centro anda e o tamanho acompanha
  const ir = (o, n) => o === n ? '' : `translate(${n.x + n.w / 2 - o.x - o.w / 2}px,${n.y + n.h / 2 - o.y - o.h / 2}px) scale(${n.w / o.w},${n.h / o.h})`;
  // a foto acompanha o dedo; o lugar dela é a vaga mais perto do ponto
  function mover() {
    A.it.style.transform = `translate(${A.x - A.x0}px,${A.y - A.y0}px) scale(1.04)`;
    const br = A.box.getBoundingClientRect(), px = A.x - br.left, py = A.y - br.top;
    let melhor = A.para, dmin = Infinity;
    A.vagas.forEach((v, k) => { const d = Math.hypot(px - (v.x + v.w / 2), py - (v.y + v.h / 2)); if (d < dmin) { dmin = d; melhor = k; } });
    if (melhor === A.para) return;
    A.para = melhor;
    // a ordem nova: a foto arrastada na vaga escolhida e as outras na sequência; cada uma desliza da vaga dela para a nova
    const ordem = A.l.filter(el => el !== A.it);
    ordem.splice(A.para, 0, A.it);
    ordem.forEach((el, k) => {
      if (el === A.it) return;
      el.style.transform = ir(A.vagas[A.l.indexOf(el)], A.vagas[k]);
    });
  }
  function limpar(l) { l.forEach(el => { el.style.transform = ''; el.style.transition = ''; el.classList.remove('fotos-arrasta'); }); }
  function soltar() {
    const a = A;
    A = null;
    clearTimeout(a.t);
    if (!a.vivo) return;
    semClique = Date.now() + 450;   // o clique que vem junto com o soltar não vale (tocar numa foto faz dela a capa)
    const fn = window[a.box.dataset.ordem];
    const fim = () => { limpar(a.l); if (a.para !== a.de && typeof fn === 'function') fn(a.de, a.para); };
    if (reduz()) { fim(); return; }
    a.it.style.transition = `transform .24s ${ease}`;
    a.it.style.transform = ir(a.vagas[a.de], a.vagas[a.para]) || 'none';
    setTimeout(fim, 250);
  }
  document.addEventListener('pointermove', e => {
    if (!A || e.pointerId !== A.id) return;
    A.x = e.clientX;
    A.y = e.clientY;
    if (!A.vivo) {
      const d = Math.hypot(A.x - A.x0, A.y - A.y0);
      if (A.toque) { if (d > 8) { clearTimeout(A.t); A = null; } return; }   // o dedo andou antes do tempo: é a página rolando
      if (d < 5) return;
      comecar();
    }
    mover();
  }, true);
  document.addEventListener('pointerup', e => { if (A && e.pointerId === A.id) soltar(); }, true);
  document.addEventListener('pointercancel', e => { if (A && e.pointerId === A.id) soltar(); }, true);
  document.addEventListener('touchmove', e => { if (A && A.vivo && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (A) e.preventDefault(); }, true);
  document.addEventListener('click', e => { if (Date.now() < semClique) { e.preventDefault(); e.stopPropagation(); semClique = 0; } }, true);
  document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('[data-ordem]')) e.preventDefault(); }, true);
  addEventListener('blur', () => { if (A) soltar(); });

  // o melhor recorte de uma foto (pedido do Luiz, 31/10/2026: a foto de um encontro mostrava só o teto do lugar). A foto é lida pequena e
  // cada ponto ganha uma nota pelo que costuma interessar numa foto: gente (pele com contorno: rostos e mãos) e contornos. Na moldura, a foto anda até a faixa de
  // maior nota que cabe nela (object-position), em qualquer tamanho de moldura, no computador e no celular. Vale para toda <img data-foco>
  // com object-fit: cover; a página chama enquadrar(img) quando a foto carrega, e ele refaz quando a tela muda de tamanho
  const perfis = {};
  function perfil(src) {
    if (perfis[src]) return perfis[src];
    return (perfis[src] = new Promise(ok => {
      const im = new Image();
      im.onload = () => {
        try {
          const k = 96 / Math.max(im.naturalWidth, im.naturalHeight), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const g = cv.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), R = new Float64Array(h), C = new Float64Array(w);
          for (let i = 0; i < w * h; i++) L[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x, r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
            const borda = (x ? Math.abs(L[i] - L[i - 1]) : 0) + (y ? Math.abs(L[i] - L[i - w]) : 0) + (x < w - 1 ? Math.abs(L[i] - L[i + 1]) : 0) + (y < h - 1 ? Math.abs(L[i] - L[i + w]) : 0);
            // pele: o tom de pele, menos o da madeira e do couro (azul baixo demais perto do vermelho) e o do teto claro e liso (pouca cor).
            // Pele com contorno em volta (rosto, mão) vale mais que uma área lisa da mesma cor
            const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
            const pele = r > 80 && gg > 40 && b > 25 && r - gg > 12 && r > b && b / r > .42 && gg / r > .55 && gg / r < .92 && sat > .24 && L[i] < 215 ? .25 + Math.min(1, borda / 40) : 0;
            // o teto e o chão (as pontas de cima e de baixo) valem menos que o meio, onde costumam ficar as pessoas
            const lugar = y < h * .14 ? .55 : y > h * .9 ? .7 : 1;
            const nota = (Math.min(borda, 160) / 160 * .35 + pele * 1.4) * lugar;
            R[y] += nota; C[x] += nota;
          }
          ok({ w, h, R, C });
        } catch (e) { ok(null); }   // foto de outro endereço não deixa ler: fica no meio
      };
      im.onerror = () => ok(null);
      im.src = src;
    }));
  }
  // a faixa do tamanho que a moldura mostra com a maior nota, com uma leve preferência pelo meio (um pouco acima, onde ficam os rostos)
  function faixa(S, n, f) {
    const m = Math.max(1, Math.round(n * f));
    if (m >= n) return 50;
    const P = [0];
    for (let i = 0; i < n; i++) P.push(P[i] + S[i]);
    let melhor = -1, bi = 0;
    for (let i = 0; i + m <= n; i++) { const c = (i + m / 2) / n, v = (P[i + m] - P[i]) * (1 - .45 * Math.abs(c - .44)); if (v > melhor) { melhor = v; bi = i; } }
    return bi / (n - m) * 100;
  }
  async function enquadrar(img) {
    if (!img || !img.isConnected) return;
    const p = await perfil(img.currentSrc || img.src);
    if (!p || !img.isConnected) return;
    const cw = img.clientWidth, ch = img.clientHeight;
    if (!cw || !ch) return;
    const ai = p.w / p.h, ac = cw / ch;
    img.style.objectPosition = ai < ac ? `50% ${faixa(p.R, p.h, ai / ac).toFixed(1)}%` : ai > ac ? `${faixa(p.C, p.w, ac / ai).toFixed(1)}% 50%` : '50% 50%';
  }
  window.enquadrar = enquadrar;
  const todas = () => document.querySelectorAll('img[data-foco]').forEach(i => { if (i.complete && i.naturalWidth) enquadrar(i); });
  todas();
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(todas, 200); });
})();
