// Filma o site da Aceima para a apresentação em motion (v2). Computador 1440x900 (1,25x) e celular 390x844 (2x).
// Navegador com a identificação comum do Chrome: o servidor das fotos das lojas recusa o navegador sem tela, e as fotos dos carros
// não apareciam. Sem o menu (a apresentação desenha o dela). Cada página sai em partes, uma por tela, para montar a faixa que rola no
// vídeo, mais as telas com interação (a busca, a lista de marcas, a loja aberta, o valor do carro).
// Uso: node capturar2.mjs <endereço do site> <pasta de saída>. Só olha: não envia formulário, não entra em área restrita.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = (process.argv[2] || 'https://aintendente.com.br').replace(/\/$/, '');
const OUT = process.argv[3] || 'capturas';
fs.mkdirSync(OUT, { recursive: true });
const UA = {
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  cel: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};
const SEM_MENU = '#nav,.est-cont,#ckb,.pular,.nb-pg{display:none!important} .gl.fix>video.luz{position:absolute!important}';
const espera = ms => new Promise(r => setTimeout(r, ms));
const lista = [];

// o carro da página do anúncio: um da vitrine (fotos conferidas), recente, com fotos bastantes; o mais caro deles
let CARRO = null;
try {
  const vit = await (await fetch(SITE + '/vitrine.json')).json();
  const vs = await (await fetch(SITE + '/api/veiculos?path=veiculos&site=1')).json();
  const ok = vs.filter(v => vit.fotos && vit.fotos[v.id] === 0 && (v.fotos || []).length >= 6 && v.tipo !== 'moto');
  const novos = ok.filter(v => (v.ano_modelo || 0) >= 2019);
  CARRO = (novos.length ? novos : ok).sort((a, b) => (b.preco || 0) - (a.preco || 0))[0] || null;
  console.log('carro:', CARRO && [CARRO.id, CARRO.marca, CARRO.modelo, CARRO.ano_modelo, CARRO.preco, CARRO.loja_nome].join(' | '));
  const url = (vs.find(v => v.fotos && v.fotos[0]) || {}).fotos?.[0];
  for (const [n, ua] of [['sem tela', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'], ['comum', UA.pc]]) {
    const f = await fetch(new URL(url, SITE + '/'), { headers: { 'user-agent': ua, referer: SITE + '/' } }).catch(e => ({ status: e.message }));
    console.log('foto de teste, navegador', n + ':', f.status);
  }
} catch (e) { console.log('sem a lista dos carros:', e.message); }

async function fotosProntas(pg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    const falta = await pg.evaluate(() => [...document.images].filter(i => {
      const r = i.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.width > 0 && i.getAttribute('src') && !i.complete;
    }).length);
    if (!falta) break;
    await espera(300);
  }
  return pg.evaluate(() => [...document.images].filter(i => {
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && i.getAttribute('src') && i.complete && i.naturalWidth === 0;
  }).length);
}
async function foto(pg, nome, disp, extra) {
  const arq = nome + '-' + disp + '.jpg';
  try {
    const quebradas = await fotosProntas(pg, 6000);
    await pg.screenshot({ path: OUT + '/' + arq, type: 'jpeg', quality: 85, ...(extra || {}) });
    const y = await pg.evaluate(() => Math.round(scrollY));
    lista.push({ nome, disp, arq, y, quebradas });
    console.log('ok', arq, 'y=' + y, quebradas ? quebradas + ' foto(s) quebrada(s)' : '');
  } catch (e) { console.log('FALHOU', arq, e.message.split('\n')[0]); }
}
// a faixa: uma tela por parte, descendo; cada parte guarda o ponto da página (y), para emendar depois
async function faixa(pg, nome, disp, telas, de) {
  const vh = await pg.evaluate(() => innerHeight);
  const y0 = de || 0;
  for (let k = 0; k < telas; k++) {
    await pg.evaluate(y => scrollTo(0, y), y0 + k * vh);
    await espera(1300);
    await foto(pg, nome + '-p' + k, disp);
  }
  await pg.evaluate(() => scrollTo(0, 0)); await espera(500);
}
async function ir(pg, url, ms) {
  await pg.goto(SITE + url, { waitUntil: 'load', timeout: 60000 });
  await pg.addStyleTag({ content: SEM_MENU });
  await espera(ms || 6500);
}
async function ate(pg, sel, folga) {
  const achou = await pg.evaluate(([s, d]) => {
    const e = document.querySelector(s); if (!e) return false;
    scrollTo(0, e.getBoundingClientRect().top + scrollY - d); return true;
  }, [sel, folga || 0]);
  await espera(1400);
  return achou;
}

const nav = await chromium.launch();
const APARELHOS = [
  ['pc', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, userAgent: UA.pc }],
  ['cel', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA.cel }],
];
for (const [disp, opc] of APARELHOS) {
  const ctx = await nav.newContext({ ...opc, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(() => {   // a escolha de cookies já feita: sem o aviso e sem contar a visita do robô
    try { localStorage.setItem('aceima_privacidade', JSON.stringify({ v: 1, estatisticas: false })); } catch (e) {}
  });
  const pg = await ctx.newPage();
  const tel = disp === 'cel';

  await ir(pg, '/', 8000);
  await faixa(pg, 'inicio', disp, tel ? 5 : 4);
  if (await ate(pg, '.vnd', 0)) {
    await foto(pg, 'venda-1', disp);
    try { await pg.click('#fp-vdmarca', { timeout: 4000 }); await espera(900); await foto(pg, 'venda-marca', disp); await pg.keyboard.press('Escape'); }
    catch (e) { console.log('sem a lista das marcas', e.message.split('\n')[0]); }
  }

  await ir(pg, '/estoque', 7000);
  await faixa(pg, 'estoque', disp, tel ? 5 : 3);
  if (!tel) {
    await pg.evaluate(() => scrollTo(0, 420)); await espera(1500);
    const a = await pg.$$('a.anc');
    if (a[1]) { await a[1].hover(); await espera(2400); await foto(pg, 'estoque-mouse', disp); await pg.mouse.move(5, 5); }
  }
  try {
    await pg.evaluate(() => scrollTo(0, 0)); await espera(500);
    await pg.click('#fp-busca', { timeout: 4000 }); await espera(400);
    await pg.type('#busca', 'toyota até 120 mil', { delay: 90 }); await espera(2600);
    await foto(pg, 'estoque-busca', disp);
    if (tel) { await pg.evaluate(() => scrollTo(0, 560)); await espera(1500); await foto(pg, 'estoque-busca2', disp); }
  } catch (e) { console.log('sem a busca', e.message.split('\n')[0]); }

  if (CARRO) {
    await ir(pg, '/veiculo/' + CARRO.id, 7000);
    await faixa(pg, 'carro', disp, tel ? 3 : 2);
    if (await ate(pg, '#vpCt', 0)) await foto(pg, 'carro-valor', disp);
  }

  await ir(pg, '/associados', 6500);
  await faixa(pg, 'assoc', disp, 2);
  try {
    await ate(pg, '#asLista', tel ? 20 : 40);
    await pg.click('#asLista .row', { timeout: 4000 }); await espera(2200);
    if (!tel) await ate(pg, '#asLoja', 160); else await ate(pg, '#asLista', 20);
    await foto(pg, 'assoc-loja', disp);
  } catch (e) { console.log('sem a loja aberta', e.message.split('\n')[0]); }

  await ir(pg, '/seja-um-associado', 6500);
  await faixa(pg, 'associar', disp, tel ? 4 : 3);
  if (await ate(pg, '.bnf', tel ? 20 : 40)) await foto(pg, 'associar-beneficios', disp);
  if (await ate(pg, '.as2-lf', tel ? 120 : 160)) await foto(pg, 'associar-logos', disp);

  await ir(pg, '/a-aceima', 6500);
  await faixa(pg, 'aceima', disp, tel ? 3 : 2);

  await ir(pg, '/publicacoes', 6500);
  await faixa(pg, 'publicacoes', disp, 2);

  await ir(pg, '/repasse', 5000); await foto(pg, 'repasse-entrada', disp);
  await ir(pg, '/painel', 6000); await foto(pg, 'painel-entrada', disp);
  await ctx.close();
}
await nav.close();
fs.writeFileSync(OUT + '/lista.json', JSON.stringify({ site: SITE, em: new Date().toISOString(), carro: CARRO && { id: CARRO.id, nome: [CARRO.marca, CARRO.modelo, CARRO.ano_modelo].join(' '), loja: CARRO.loja_nome }, fotos: lista }, null, 1));
console.log('fotos:', lista.length);
