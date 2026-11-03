// Filma o site da Aceima para a apresentação em motion: telas do computador (1440x900, 1,5x) e do celular (390x844, 2,5x).
// Uso: node capturar.mjs <endereço do site> <pasta de saída>. Só olha: não envia formulário, não entra em área restrita.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = (process.argv[2] || 'https://aintendente.com.br').replace(/\/$/, '');
const OUT = process.argv[3] || 'capturas';
fs.mkdirSync(OUT, { recursive: true });
const nav = await chromium.launch();
const lista = [];
const espera = ms => new Promise(r => setTimeout(r, ms));
// sem o menu e com o fundo preso à página (o menu entra por cima, na apresentação)
const SEM_MENU = '#nav,.est-cont,#ckb,.pular{display:none!important} .gl.fix>video.luz{position:absolute!important}';

async function foto(pg, nome, disp, extra = {}) {
  const arq = OUT + '/' + nome + '-' + disp + '.jpg';
  try {
    await pg.screenshot({ path: arq, type: 'jpeg', quality: 86, ...extra });
    const tam = fs.statSync(arq).size;
    lista.push({ nome, disp, arq: nome + '-' + disp + '.jpg', tam });
    console.log('ok', nome, disp, Math.round(tam / 1024) + ' KB');
  } catch (e) { console.log('FALHOU', nome, disp, e.message.split('\n')[0]); }
}
// desce devagar, para os anúncios e as fotos chegarem, e volta ao topo
async function descer(pg, limite) {
  const alt = await pg.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < Math.min(alt, limite || alt); y += 500) { await pg.evaluate(y => scrollTo(0, y), y); await espera(220); }
  await pg.evaluate(() => scrollTo(0, 0)); await espera(600);
}
async function ir(pg, url, ms) {
  await pg.goto(SITE + url, { waitUntil: 'load', timeout: 60000 });
  await espera(ms || 6500);
}
// leva o elemento ao topo da tela, com uma folga
async function ate(pg, sel, folga) {
  const achou = await pg.evaluate(([s, d]) => {
    const e = document.querySelector(s); if (!e) return false;
    scrollTo(0, e.getBoundingClientRect().top + scrollY - d); return true;
  }, [sel, folga || 0]);
  await espera(1200);
  return achou;
}

const APARELHOS = [
  ['pc', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }],
  ['cel', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true }],
];
for (const [disp, opc] of APARELHOS) {
  const ctx = await nav.newContext({ ...opc, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  // a escolha de cookies já feita: sem o aviso e sem contar a visita do robô
  await ctx.addInitScript(() => {
    try { localStorage.setItem('aceima_privacidade', JSON.stringify({ v: 1, estatisticas: false })); } catch (e) {}
  });
  const pg = await ctx.newPage();
  const tel = disp === 'cel';

  // início
  await ir(pg, '/', 8000);
  await foto(pg, 'inicio-topo', disp);
  await pg.addStyleTag({ content: SEM_MENU });
  await descer(pg);
  if (await ate(pg, '.sob', 0)) await foto(pg, 'inicio-aceima', disp);
  if (await ate(pg, '.stag', tel ? 40 : 60)) await foto(pg, 'inicio-vitrine', disp);
  if (await ate(pg, '.vnd', 0)) {
    await espera(800); await foto(pg, 'venda-1', disp);
    try {   // a lista das marcas aberta
      await pg.click('#fp-vdmarca', { timeout: 4000 }); await espera(900);
      await foto(pg, 'venda-marca', disp); await pg.keyboard.press('Escape');
    } catch (e) { console.log('sem lista de marcas', e.message.split('\n')[0]); }
  }

  // estoque
  await ir(pg, '/estoque', 7000);
  await foto(pg, 'estoque-topo', disp);
  await pg.addStyleTag({ content: SEM_MENU });
  await descer(pg, 4000);
  await pg.evaluate(t => scrollTo(0, t ? 520 : 420), tel); await espera(1600);
  await foto(pg, 'estoque-grade', disp);
  if (!tel) {   // o mouse em cima de um anúncio: o nome completo escrito na etiqueta
    const a = await pg.$$('a.anc');
    if (a[1]) { await a[1].hover(); await espera(2200); await foto(pg, 'estoque-mouse', disp); await pg.mouse.move(5, 5); }
  }
  try {   // a busca
    await pg.evaluate(() => scrollTo(0, 0)); await espera(500);
    await pg.click('#fp-busca', { timeout: 4000 }); await espera(400);
    await pg.type('#busca', 'toyota até 120 mil', { delay: 90 }); await espera(2200);
    await foto(pg, 'estoque-busca', disp);
  } catch (e) { console.log('sem busca', e.message.split('\n')[0]); }

  // um carro: o primeiro do estoque
  await ir(pg, '/estoque', 5000);
  const href = await pg.evaluate(() => { const a = document.querySelector('a.anc'); return a ? a.getAttribute('href') : null; });
  if (href) {
    await ir(pg, href, 6000);
    await foto(pg, 'carro-topo', disp);
    await pg.addStyleTag({ content: SEM_MENU });
    await descer(pg);
    if (tel) { await pg.evaluate(() => scrollTo(0, innerHeight * 0.9)); await espera(900); await foto(pg, 'carro-ficha', disp); }
    if (await ate(pg, '#vpCt', 0)) { await espera(600); await foto(pg, 'carro-valor', disp); }
  }

  // associados, com uma loja aberta
  await ir(pg, '/associados', 6500);
  await foto(pg, 'assoc-topo', disp);
  await pg.addStyleTag({ content: SEM_MENU });
  try {
    await ate(pg, '#asLista', tel ? 20 : 40); await foto(pg, 'assoc-lista', disp);
    await pg.click('#asLista .row', { timeout: 4000 }); await espera(2200);
    if (!tel) await ate(pg, '#asLoja', 120);
    await foto(pg, 'assoc-loja', disp);
  } catch (e) { console.log('sem loja aberta', e.message.split('\n')[0]); }

  // seja um associado
  await ir(pg, '/seja-um-associado', 6500);
  await foto(pg, 'associar-topo', disp);
  await pg.addStyleTag({ content: SEM_MENU });
  await descer(pg);
  if (await ate(pg, '.bnf', tel ? 20 : 40)) await foto(pg, 'associar-beneficios', disp);
  if (await ate(pg, '.as2-lf', tel ? 120 : 160)) await foto(pg, 'associar-logos', disp);

  // a Aceima e as publicações
  await ir(pg, '/a-aceima', 6500); await foto(pg, 'aceima-topo', disp);
  await pg.addStyleTag({ content: SEM_MENU });
  await pg.evaluate(() => scrollTo(0, innerHeight * (matchMedia('(max-width:760px)').matches ? 1.05 : 0.8))); await espera(1500);
  await foto(pg, 'aceima-historia', disp);
  await ir(pg, '/publicacoes', 6500); await foto(pg, 'publicacoes', disp);

  // as áreas restritas: só as telas de entrada
  await ir(pg, '/repasse', 5000); await foto(pg, 'repasse-entrada', disp);
  await ir(pg, '/painel', 6000); await foto(pg, 'painel-entrada', disp);
  await ctx.close();
}
await nav.close();
fs.writeFileSync(OUT + '/lista.json', JSON.stringify({ site: SITE, em: new Date().toISOString(), fotos: lista }, null, 1));
console.log('fotos:', lista.length);
