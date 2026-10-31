// O menu do site nas páginas que ficam fora dele: o Repasse e a página de obra (pedido do Luiz, 31/10/2026: o menu precisa ficar no lugar
// quando a página abre). É a mesma barra do index.html (montarMenu), com o Repasse aceso: no computador, a pílula embaixo, no centro; no
// celular, só o ícone no canto de cima, que abre a lista. Os links levam às páginas do site. Entre o site e estas páginas, o navegador faz a
// fusão de página (view transition entre documentos) com o menu parado, como numa troca de página dentro do site: o nome da página de onde
// se veio fecha (no celular, o menu aberto fecha em volta do ícone do Repasse).
(function () {
  const css = `@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:.45s;animation-timing-function:ease}
::view-transition-group(nav),::view-transition-image-pair(nav),::view-transition-new(nav){animation:none}
::view-transition-old(nav){display:none}
#nav{position:fixed;z-index:350;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;height:52px;padding:8px;border-radius:999px;
  background:#fff;border:1px solid #E5E5E5;box-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.1);view-transition-name:nav}
#nav .nb{display:flex;align-items:center;height:40px;min-width:44px;padding:8px 12px;border-radius:999px;color:#737373;transition:background-color .2s,color .2s}
#nav .nb:hover{background:#F5F5F5}
#nav .nb.on{background:rgba(23,23,23,.1);color:#171717}
#nav .nb svg{flex:none;width:22px;height:22px}
#nav .nbi{display:contents}
#nav .nl{display:block;overflow:hidden;width:0;margin-left:8px;opacity:0;transition:width .26s var(--ease,ease),height .26s var(--ease,ease),margin .26s var(--ease,ease),opacity .2s}
#nav .nl.vis{opacity:1;transition:width .26s var(--ease,ease),height .26s var(--ease,ease),margin .26s var(--ease,ease),opacity .2s .12s}
#nav .nl>span{display:block;white-space:nowrap;font:500 clamp(.625rem,.5263rem + .5263vw,1rem)/1.9 var(--f2,sans-serif)}
#nav.parado .nb,#nav.parado .nl,#nav.parado svg{transition:none!important}
@media (max-width:760px){
  #nav{left:auto;right:4.09vw;top:6.32vw;bottom:auto;transform:none;height:auto;flex-direction:column;align-items:center;gap:0;padding:.53vw}
  #nav .nb{display:grid;grid-template-rows:0fr;min-width:0;height:auto;padding:0 1.6vw;opacity:0;transition:grid-template-rows .35s var(--ease,ease),padding .35s var(--ease,ease),opacity .25s,background-color .2s,color .2s,transform .4s var(--ease,ease)}
  #nav .nbi{display:flex;flex-direction:column-reverse;align-items:center;min-height:0;overflow:hidden}
  #nav .nb.on,#nav.aberto .nb{grid-template-rows:1fr;padding:1.6vw;opacity:1}
  #nav.aberto .nb{transition-delay:calc(var(--i) * 25ms)}
  #nav .nb svg{width:3.73vw;height:3.73vw;transition:transform .26s var(--ease,ease)}
  #nav .nb.nome svg{transform:rotate(-90deg)}
  #nav .nl{writing-mode:vertical-rl;width:auto;height:0;margin:1.6vw 0}
  #nav .nl>span{font-size:3.2vw;line-height:1.2;transform:rotate(180deg)}
}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  // os ícones Lucide do menu do site (ICONES do index.html)
  const ICONES = {
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    aceima: '<g stroke-width="1.7"><path d="M2 20.2L9.4 20.2C11.3 18 13.4 16.5 15.6 15.7L17.6 19.2Q18.1 20.2 19.3 20.2L21.9 20.2L19.3 15L21.3 14.4Q20.8 13.2 18.6 13L14 4.9C13.3 3.2 10.7 3.2 10 4.9Z"/><path d="M9.9 14.9L12.7 9.7L14.5 13.2C12.8 13.5 11.3 14.1 9.9 14.9Z"/></g>',
    associados: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    estoque: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    publicacoes: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
    associar: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    repasse: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'
  };
  const PAG = [['home', 'Início', '/'], ['aceima', 'A Aceima', '/a-aceima'], ['associados', 'Associados', '/associados'], ['estoque', 'Estoque', '/estoque'],
    ['publicacoes', 'Publicações', '/publicacoes'], ['associar', 'Seja um associado', '/seja-um-associado'], ['repasse', 'Repasse', '/repasse']];
  const ic = p => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const n = document.createElement('nav'); n.id = 'nav'; n.setAttribute('aria-label', 'Menu'); n.className = 'parado';
  n.innerHTML = PAG.map((p, i) => `<a href="${p[2]}" class="nb${p[0] === 'repasse' ? ' on' : ''}" data-p="${p[0]}" style="--i:${i}" aria-label="${p[1]}"${p[0] === 'repasse' ? ' aria-current="page"' : ''}><span class="nbi">${ic(ICONES[p[0]])}<span class="nl"><span>${p[1]}</span></span></span></a>`).join('');
  document.body.appendChild(n);
  const cel = () => matchMedia('(max-width:760px)').matches;
  let aberto = false;
  // o nome aberto no tamanho dele: no computador, deitado (largura); no celular, em pé (altura), só com o menu aberto
  function nomes() {
    const v = cel();
    n.querySelectorAll('.nb').forEach(b => {
      const l = b.querySelector('.nl'), on = v ? b.classList.contains('on') && aberto : b.classList.contains('on') || b.classList.contains('hov');
      const t = on ? (v ? l.firstChild.scrollHeight : l.firstChild.scrollWidth) + 'px' : '0px';
      l.style.width = v ? '' : t; l.style.height = v ? t : ''; l.style.margin = on ? '' : '0'; l.classList.toggle('vis', on); b.classList.toggle('nome', on);
    });
  }
  const abrir = a => { aberto = a; n.classList.toggle('aberto', a); nomes(); };
  // no computador, o mouse em cima de uma página abre o nome dela também; saindo da barra, fecha
  n.querySelectorAll('.nb').forEach(b => b.addEventListener('mouseenter', () => {
    if (cel() || !matchMedia('(hover:hover)').matches) return;
    n.querySelectorAll('.nb').forEach(x => x.classList.toggle('hov', x === b)); nomes();
  }));
  n.addEventListener('mouseleave', () => { n.querySelectorAll('.nb.hov').forEach(x => x.classList.remove('hov')); nomes(); });
  // no celular, o primeiro toque só abre o menu; aberto, o Repasse fecha e as outras páginas abrem
  n.addEventListener('click', e => {
    const b = e.target.closest('.nb'); if (!b || !cel() || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!aberto) { e.preventDefault(); abrir(true); return; }
    if (b.dataset.p === 'repasse') { e.preventDefault(); abrir(false); }
  });
  document.addEventListener('click', e => { if (aberto && !n.contains(e.target)) abrir(false); });
  // de onde se veio: a página do site que estava acesa
  let antes = '';
  try {
    const r = new URL(document.referrer);
    if (r.origin === location.origin) {
      const p = r.pathname.replace(/\/$/, '') || '/';
      antes = ({ '/': 'home', '/a-aceima': 'aceima', '/aceima': 'aceima', '/associados': 'associados', '/estoque': 'estoque', '/publicacoes': 'publicacoes', '/seja-um-associado': 'associar' })[p]
        || (p.startsWith('/veiculo') ? 'estoque' : p.startsWith('/publicacoes/') ? 'publicacoes' : '');
    }
  } catch (e) {}
  const solta = () => requestAnimationFrame(() => requestAnimationFrame(() => n.classList.remove('parado')));
  if (antes && cel()) { abrir(true); solta(); setTimeout(() => abrir(false), 650); }
  else if (antes) { const b = n.querySelector(`.nb[data-p="${antes}"]`); if (b) b.classList.add('hov'); nomes(); requestAnimationFrame(() => requestAnimationFrame(() => { n.classList.remove('parado'); if (b) b.classList.remove('hov'); nomes(); })); }
  else { nomes(); solta(); }
  if (document.fonts) document.fonts.ready.then(nomes);   // medido de novo com a fonte do site, senão corta a última letra
  addEventListener('resize', nomes);
})();
