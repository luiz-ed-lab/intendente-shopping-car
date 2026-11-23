// Confere a versão leve de lojas e estoque que o site pede (site=1): pública, sem logos e com cache.
// O painel (sem site=1) continua recebendo tudo, sem cache. Rodar: node testes/site.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('// ---------------- ROTAS'), src.indexOf('async function rotaLeads'));
let sqls = [], migrou = 0, comSenha = false;
let params = [];
let linhas = () => [];
const query = async (sql, p) => { sqls.push(sql); params.push(p); return { rows: linhas(sql) || [] }; };
const { rotaLojas, rotaVeiculos } = new Function('query', 'migra', 'autorizado', 'negar', 'FORA_DO_SITE', trecho + '; return { rotaLojas, rotaVeiculos };')(
  query, async () => { migrou++; }, () => comSenha, res => res.status(401).json({}), ['Lions Seminovos']);
const pedido = q => ({ method: 'GET', query: q, headers: {} });
const resposta = () => { const r = { h: {}, setHeader(k, v) { r.h[k] = v; }, status() { return r; }, json() { return r; }, end() { return r; } }; return r; };
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };

let r = resposta(); await rotaLojas(pedido({ site: '1' }), r);
assert(!/(select|,)\s+logo_url|\*/.test(sqls[0]) && /s-maxage/.test(r.h['Cache-Control'] || '') && migrou === 0, 'site: lojas sem logos, com cache e sem migra');
assert(/md5\(logo_url\)/.test(sqls[0]), 'site: as lojas trazem a versão da logo (logo trocada no painel muda de endereço)');
assert(r.h['Vercel-Cache-Tag'] === 'site-lojas', 'site: a lista de lojas leva a etiqueta que o painel apaga');
assert(/nome <> all\(\$1\)/.test(sqls[0]) && params[0][0].includes('Lions Seminovos'), 'site: a loja fora do site (FORA_DO_SITE) não vem na lista');

comSenha = true; sqls = []; r = resposta(); await rotaVeiculos(pedido({ site: '1' }), r);
assert(/coalesce\(v\.oculto,false\) = false/.test(sqls[0]) && /s-maxage/.test(r.h['Cache-Control'] || ''), 'site: estoque nunca traz oculto, nem com senha (o cache é de todos)');
assert(/l\.nome <> all\(\$1\)/.test(sqls[0]), 'site: nem o estoque da loja fora do site');
assert(/l\.ativa = true/.test(sqls[0]), 'site: nem o estoque de loja desativada');
assert(/l\.ultimo_erro is null or v\.sincronizado_em >= now\(\) - interval '330 minutes'/.test(sqls[0]), 'site: nem o estoque da loja com falha na leitura depois de passar do tempo (pedido do Luiz, 03/11/2026)');
assert(/count\(\*\) filter \(where ultimo_erro is not null\) \* 2 > count\(\*\)/.test(sqls[0]), 'site: mais da metade das lojas falhando é problema do robô: os anúncios ficam');
assert(r.h['Vercel-Cache-Tag'] === 'site-veiculos', 'site: o estoque leva a etiqueta que o painel apaga');

sqls = []; r = resposta(); await rotaVeiculos(pedido({}), r);
assert(!/oculto,false\) = false/.test(sqls[0]) && !r.h['Cache-Control'] && migrou === 1, 'painel com senha: vê os ocultos, sem cache');
assert(/as fora_por_falha/.test(sqls[0]), 'painel: sabe quais carros saíram do site por falha na leitura da loja');

sqls = []; r = resposta(); await rotaLojas(pedido({}), r);
assert(/select \* from lojas/.test(sqls[0]) && !r.h['Cache-Control'], 'painel: lojas completas (com logos), sem cache');

// 01/11/2026: sem a senha, a lista completa das lojas (com o e-mail que recebe os leads) não sai, e o estoque sai só com as colunas públicas
comSenha = false; sqls = []; r = resposta(); let st = 200; r.status = s => { st = s; return r; };
await rotaLojas(pedido({}), r);
assert(st === 401 && !sqls.length, 'sem senha: lojas completas negadas, sem ir ao banco');
// 02/11/2026: sem a senha e sem site=1, o estoque leva ao endereço público (do cache), sem montar a lista no banco a cada pedido
sqls = []; params = []; st = 200; r = resposta(); r.status = s => { st = s; return r; };
await rotaVeiculos(pedido({ precoAte: '50000' }), r);
assert(st === 308 && /site=1/.test(r.h.Location || '') && /s-maxage/.test(r.h['Cache-Control'] || '') && !sqls.length, 'sem senha: o estoque leva ao endereço público, do cache, sem ir ao banco');
comSenha = true; sqls = []; params = []; r = resposta(); await rotaVeiculos(pedido({ precoAte: '50000', loja: 'x; drop table veiculos' }), r);
assert(params[0].length === 1 && params[0][0] === 50000 && !/v\.loja_id = /.test(sqls[0]), 'filtros só com número de verdade (o texto no lugar do id da loja é ignorado)');
comSenha = false;
for (const m of ['POST', 'PATCH', 'DELETE']) {
  sqls = []; st = 200; r = resposta(); r.status = s => { st = s; return r; };
  await rotaLojas({ method: m, query: {}, headers: {}, body: { id: 1, nome: 'X' } }, r);
  assert(st === 401 && !sqls.length, `sem senha: ${m} em lojas negado`);
}
comSenha = true; st = 200; sqls = []; r = resposta(); r.status = s => { st = s; return r; };
await rotaLojas({ method: 'PATCH', query: {}, headers: {}, body: { id: 1, email: 'x" onmouseover="alert(1)' } }, r);
assert(st === 400 && !sqls.some(q => /update lojas/.test(q)), 'e-mail fora do formato não é gravado');
st = 200; sqls = []; r = resposta(); r.status = s => { st = s; return r; };
await rotaLojas({ method: 'PATCH', query: {}, headers: {}, body: { id: 1, logo_url: 'javascript:alert(1)' } }, r);
assert(st === 400, 'logo que não é imagem nem endereço http(s): recusada');

// 03/11/2026: o que muda no painel chega ao site na hora: a etiqueta da lista é apagada na Vercel (o robô não apaga nada)
const apagadas = [];
globalThis[Symbol.for('@vercel/request-context')] = { get: () => ({ purge: { dangerouslyDeleteByTag: async t => { apagadas.push(...t); } } }) };
comSenha = true;
const mudou = async (nome, rota, pedidoDe) => { apagadas.length = 0; const q = resposta(); q.status = () => q; await rota(pedidoDe, q); return nome; };
await mudou('loja', rotaLojas, { method: 'PATCH', query: {}, headers: {}, body: { id: 1, nome: 'X' } });
assert(apagadas.includes('site-lojas') && apagadas.includes('site-veiculos'), 'painel: editar a loja atualiza as lojas e o estoque do site');
linhas = sql => /update lojas set ativa = false/.test(sql) ? [{ id: 1 }] : /delete from repasse_acessos/.test(sql) ? [{ id: 7 }] : [];
sqls = []; await mudou('loja', rotaLojas, { method: 'DELETE', query: { id: '1' }, headers: {}, body: {} });
assert(apagadas.includes('site-lojas') && apagadas.includes('site-veiculos'), 'painel: excluir a loja tira ela e os carros do site na hora');
// 23/11/2026 (a Lazari não saía): loja com lead não podia ser apagada (a chave do banco), a API dava erro e o painel dizia "excluída".
// Agora a loja só fica inativa (o lead continua com o nome dela), e o acesso ao Repasse sai junto, com os carros e as fotos
assert(!sqls.some(q => /delete from lojas/.test(q)) && sqls.some(q => /update lojas set ativa = false/.test(q)) && sqls.some(q => /update veiculos set ativo=false/.test(q)), 'excluir a loja: ela fica inativa (sem apagar a linha que os leads usam) e os carros saem');
assert(sqls.some(q => /delete from repasse_sessoes/.test(q)) && sqls.some(q => /status = 'tirado'/.test(q)) && sqls.some(q => /delete from repasse_fotos/.test(q)), 'excluir a loja: o acesso ao Repasse sai junto, com os carros e as fotos');
linhas = () => [];
st = 200; apagadas.length = 0; r = resposta(); r.status = s => { st = s; return r; };
await rotaLojas({ method: 'DELETE', query: { id: '99' }, headers: {}, body: {} }, r);
assert(st === 404 && !apagadas.length, 'excluir loja que não existe (ou já excluída): 404, sem dizer que excluiu');
await mudou('carro', rotaVeiculos, { method: 'PATCH', query: {}, headers: {}, body: { id: 1, oculto: true } });
assert(apagadas.join() === 'site-veiculos', 'painel: esconder um carro atualiza o estoque do site');
apagadas.length = 0; await rotaLojas(pedido({ site: '1' }), resposta());
assert(!apagadas.length, 'ler a lista não apaga nada');
delete globalThis[Symbol.for('@vercel/request-context')];
apagadas.length = 0; await mudou('fora da Vercel', rotaLojas, { method: 'PATCH', query: {}, headers: {}, body: { id: 1, nome: 'X' } });
assert(!apagadas.length, 'fora da Vercel, gravar continua funcionando');

// 03/11/2026: a loja com falha na leitura sai do site. A leitura sem nenhum anúncio conta como falha, e o cache só é apagado quando muda alguma coisa
const inicio = src.indexOf('async function importarLoja'), fim = src.indexOf('// resumo diário');
assert(inicio > 0 && fim > inicio, 'o importador foi achado no arquivo');
const importar = (ler, sqlsImp, ultimaLeitura) => new Function('query', 'fonteDaLoja', 'lerSite', 'pegarEmail', 'notaGoogle', 'atualizarSite', 'LIMITE_FALHA_MIN', 'pausa', 'detalheSite', 'kmDoAnuncio', 'tipoVeiculo',
  src.slice(inicio, fim) + '; return importarLoja;')(
  async (sql, p) => { sqlsImp.push([sql, p]); return /max\(sincronizado_em\)/.test(sql) ? { rows: [{ em: ultimaLeitura }] } : { rows: [], rowCount: 0 }; },
  () => ({ tipo: 'site', base: 'https://loja.teste' }), ler, async () => null, async () => null, async (...t) => { apagadas.push(...t); }, 330, async () => {}, async () => ({}), () => null, () => 'carro');
const hora = h => new Date(Date.now() - h * 3600e3).toISOString();
const falha = async () => { throw new Error('getaddrinfo ENOTFOUND loja.teste'); };
let qs = [], res;
apagadas.length = 0; res = await importar(falha, qs, hora(6))({ id: 7, nome: 'Riomix', autocerto_url: 'x', ultima_sync: hora(6), ultimo_erro: null });
assert(res.erro && qs.some(([s, p]) => /ultimo_erro = \$1/.test(s) && /ENOTFOUND/.test(p[0])), 'a falha fica anotada na loja');
assert(apagadas.join() === 'site-veiculos', 'a rodada que falha com 6 horas sem leitura boa tira os carros do site na hora');
qs = []; apagadas.length = 0; await importar(falha, qs, hora(12))({ id: 7, nome: 'Riomix', autocerto_url: 'x', ultima_sync: hora(6), ultimo_erro: 'getaddrinfo' });
assert(!apagadas.length, 'as rodadas seguintes da mesma falha não apagam o cache de novo');
qs = []; apagadas.length = 0; await importar(falha, qs, hora(2))({ id: 7, nome: 'Riomix', autocerto_url: 'x', ultima_sync: hora(2), ultimo_erro: null });
assert(!apagadas.length, 'a falha com a última leitura boa recente ainda não tira os carros');
qs = []; apagadas.length = 0; res = await importar(async () => ({ itens: [], ignorados: [], logo: 'data:novo', contato: { telefone: '1' } }), qs, hora(6))({ id: 7, nome: 'Parada', autocerto_url: 'x', ultima_sync: hora(6), ultimo_erro: null });
assert(res.erro === 'nenhum anúncio encontrado no site' && qs.some(([s]) => /ultimo_erro = \$1/.test(s)) && !qs.some(([s]) => /logo_url = coalesce/.test(s)), 'o site que abre sem nenhum anúncio conta como falha e não muda os dados da loja');
qs = []; apagadas.length = 0; res = await importar(async () => ({ itens: [{ anuncioId: 'a', marca: 'FIAT', modelo: 'UNO' }], ignorados: [] }), qs, hora(1))({ id: 7, nome: 'Voltou', autocerto_url: 'x', google_em: new Date().toISOString(), ultima_sync: hora(6), ultimo_erro: 'getaddrinfo' });
assert(!res.erro && apagadas.join() === 'site-veiculos' && qs.some(([s]) => /ultimo_erro = null/.test(s)), 'a loja que volta: os carros voltam para o site na hora');
qs = []; apagadas.length = 0; await importar(async () => ({ itens: [{ anuncioId: 'a', marca: 'FIAT', modelo: 'UNO' }], ignorados: [] }), qs, hora(1))({ id: 7, nome: 'Normal', autocerto_url: 'x', google_em: new Date().toISOString(), ultima_sync: hora(6), ultimo_erro: null });
assert(!apagadas.length, 'a leitura normal do robô não apaga o cache (o estoque relido a cada loja gastaria a Neon)');

// 03/11/2026: o estoque não fica mais de 6 horas sem atualizar: a visita garante, e o "nada a fazer" não acorda o banco até a hora de a loja vencer.
// 12/11/2026: uma loja por chamada, e a página chama de novo (a chamada da função pedindo a seguinte parava na quinta loja)
{
  const ini = src.indexOf('const LIMITE_SYNC_MIN'), fimR = src.indexOf('// resumo diário para a Aceima');
  assert(ini > 0 && fimR > ini, 'a rota da visita foi achada no arquivo');
  const rotaR = e => new Function('query', 'migra', 'autorizado', 'importarLoja', 'resumoSeDevido', 'atualizarSite', src.slice(ini, fimR) + '; return rotaRefresh;')(
    async sql => { e.sqls.push(sql);
      if (/min\(ultima_sync\)/.test(sql)) return { rows: [{ em: e.maisAntiga }] };
      if (/select \* from lojas/.test(sql)) return { rows: e.vencidas.length ? [e.vencidas[0]] : [] };
      if (/insert into config/.test(sql)) return { rows: e.trava ? [] : [{ em: new Date() }] };
      if (/update lojas set ultima_sync = now\(\)/.test(sql)) { e.marcadas.push(e.vencidas[0].nome); return { rows: [] }; }
      if (/delete from config/.test(sql)) { e.soltou = true; return { rows: [] }; }
      return { rows: [] }; },
    async () => {}, async () => e.senha, async l => { e.lidas.push(l.nome); e.vencidas.shift(); }, async () => {}, async (...t) => { e.apagadas.push(...t); });
  const novo = c => Object.assign({ sqls: [], lidas: [], marcadas: [], apagadas: [], vencidas: [], senha: false, soltou: false }, c);
  const chama = async (e, q) => { const x = resposta(); let corpo; x.json = o => { corpo = o; return x; }; await rotaR(e)({ method: 'GET', query: q || {}, headers: {} }, x); return { h: x.h, corpo }; };
  const hora = h => new Date(Date.now() - h * 3600e3).toISOString();
  let e = novo({ maisAntiga: hora(2) }), r0 = await chama(e);
  const s = +(/s-maxage=(\d+)/.exec(r0.h['Cache-Control'] || '') || [])[1];
  assert(s > 3.9 * 3600 && s <= 4 * 3600, 'nada a fazer, loja mais antiga com 2 horas: fica no cache da Vercel pelas 4 horas que faltam', s);
  assert(!e.lidas.length && !e.apagadas.length, 'nada a fazer: não lê nem apaga nada');
  assert(/ultima_sync < now\(\) - interval '360 minutes'/.test(e.sqls.join()) && /coalesce\(autocerto_url, autocerto_id, ''\) <> ''/.test(e.sqls.join()), 'vence com 6 horas, e só loja com site');
  e = novo({ maisAntiga: hora(5.999) }); r0 = await chama(e);
  assert(/s-maxage=60$/.test(r0.h['Cache-Control']), 'perto de vencer: guarda no mínimo um minuto');
  e = novo({ vencidas: [{ nome: 'Jazz' }, { nome: 'Lazari' }] }); r0 = await chama(e);
  assert(e.lidas.join() === 'Jazz' && e.marcadas.join() === 'Jazz' && e.soltou, 'loja vencida: lê uma loja só, marcada antes de ler, e solta a trava');
  assert(r0.corpo.continua && !r0.corpo.fim && !e.apagadas.length && !/s-maxage/.test(r0.h['Cache-Control'] || ''), 'falta outra: a resposta diz para continuar, não fica guardada e não apaga o cache ainda');
  r0 = await chama(e, { continuar: '1' });
  assert(e.lidas.join() === 'Jazz,Lazari' && r0.corpo.fim && e.apagadas.includes('site-veiculos') && e.apagadas.includes('site-lojas'), 'a chamada que lê a última apaga o cache do estoque e das lojas, uma vez');
  r0 = await chama(e, { continuar: '1' });
  assert(r0.corpo.fim && !/s-maxage/.test(r0.h['Cache-Control'] || '') && e.apagadas.length === 2, 'continuar sem nada vencido: acabou, sem guardar a resposta e sem apagar de novo');
  e = novo({ vencidas: [{ nome: 'Jazz' }], trava: true }); r0 = await chama(e);
  assert(r0.corpo.pulado && r0.corpo.continua && /s-maxage=30$/.test(r0.h['Cache-Control']) && !e.lidas.length, 'outra leitura em andamento: pula, e a página tenta de novo mais tarde');
  e = novo({ vencidas: [{ nome: 'Jazz' }], trava: true }); r0 = await chama(e, { continuar: '1' });
  assert(r0.corpo.pulado && !/s-maxage/.test(r0.h['Cache-Control'] || ''), 'pulado ao continuar: não fica guardado');
  e = novo({ senha: true }); r0 = await chama(e, { fim: '1' });
  assert(e.apagadas.includes('site-veiculos') && r0.corpo.fim, 'o fim da rodada do robô apaga o cache do site');
  e = novo({ senha: false, maisAntiga: hora(1) }); r0 = await chama(e, { fim: '1' });
  assert(!e.apagadas.length && /s-maxage/.test(r0.h['Cache-Control'] || ''), 'fim=1 sem a senha: é uma visita comum, não apaga nada');
}

// 20/11/2026: o anúncio e a publicação saem do servidor com o título, a descrição, a foto e os dados no formato do Google (a prévia do link no
// WhatsApp e os buscadores), e o mapa do site lista as páginas, as publicações e os carros
{
  const iniP = src.indexOf('// ---------------- O QUE SÓ LÊ O HTML'), fimP = src.indexOf('// os arquivos do site que vão junto com a função');
  assert(iniP > 0 && fimP > iniP, 'as rotas da prévia foram achadas no arquivo');
  const siteHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const siglasSite = JSON.parse(siteHtml.match(/const SIGLAS=(\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const inteiro = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let linha = null, pedidos = [];
  const R = new Function('query', 'esc', 'inteiro', 'cacheSite', 'ANUNCIO_EM_DIA', 'FORA_DO_SITE', 'semAcento', src.slice(iniP, fimP) + '; return { SIGLAS, titulo, montarPagina, rotaPagina, rotaSitemap, urlCarro };')(
    async (sql, p) => { pedidos.push([sql, p]); return { rows: linha ? [].concat(linha) : [] }; }, esc, inteiro,
    (res, et) => { res.setHeader('Cache-Control', 's-maxage=10800'); res.setHeader('Vercel-Cache-Tag', et); }, '(true)', ['Lions Seminovos'],
    s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  assert(JSON.stringify(R.SIGLAS) === JSON.stringify(siglasSite), 'as siglas dos nomes dos carros são as mesmas do site');
  assert(R.titulo('TOYOTA COROLLA XEI 2.0 FLEX') === 'Toyota Corolla XEI 2.0 Flex' && R.titulo('VOLKSWAGEN T-CROSS') === 'Volkswagen T-Cross', 'os nomes dos carros como no site', R.titulo('TOYOTA COROLLA XEI 2.0 FLEX'));
  assert(siteHtml.includes('<!--meta-->') && siteHtml.includes('<!--/meta-->') && /og:image" content="https:\/\/aintendente\.com\.br\/marca-nova\/og-intendente\.jpg"/.test(siteHtml), 'o site tem a prévia padrão entre os marcadores');
  const arquivo = nome => nome === 'index.html' ? siteHtml : JSON.stringify([{ id: 'p1', titulo: 'Feirão de <novembro>', categoria: 'Eventos', data: '2026-11-20', texto: 'Texto da publicação.', fotos: ['fotos-publicacoes/p1.webp'] }]);
  const chamaP = async q => { const x = resposta(); let corpo = ''; x.statusCode = 200; x.end = b => { corpo = b; return x; }; await R.rotaPagina({ query: q }, x, arquivo); return { st: x.statusCode, h: x.h, corpo }; };
  linha = { id: 123, marca: 'TOYOTA', modelo: 'COROLLA', versao: 'XEI 2.0', ano_modelo: 2020, km: 68000, preco: 89500, cambio: 'AUTOMATICO', combustivel: 'FLEX', fotos: ['https://loja.teste/a.jpg', 'https://loja.teste/b.jpg'], loja: 'Jazz Veículos', endereco: 'Estrada Intendente Magalhães, 830', telefone: '(21) 3333-4444' };
  let r = await chamaP({ veiculo: '123-toyota-corolla-2020' });
  assert(r.st === 200 && /<title>Toyota Corolla XEI 2\.0 2020 · R\$ 89\.500 \| Aceima<\/title>/.test(r.corpo), 'o anúncio sai com o título do carro e o preço', (r.corpo.match(/<title>[^<]*/) || [])[0]);
  assert(/og:image" content="https:\/\/loja\.teste\/a\.jpg"/.test(r.corpo) && /canonical" href="https:\/\/aintendente\.com\.br\/veiculo\/123-toyota-corolla-2020"/.test(r.corpo), 'com a foto da capa e o endereço oficial do anúncio');
  const ld = JSON.parse(r.corpo.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1]);
  assert(ld['@type'] === 'Car' && ld.offers.price === 89500 && ld.offers.priceCurrency === 'BRL' && ld.offers.seller.name === 'Jazz Veículos' && ld.mileageFromOdometer.value === 68000, 'os dados do carro no formato do Google');
  linha = Object.assign({}, linha, { modelo: 'XTZ 150 CROSSER', versao: 'XTZ 150 CROSSER Z FLEX', marca: 'YAMAHA' }); const rr = await chamaP({ veiculo: '123-x' });
  assert(/<title>Yamaha XTZ 150 Crosser Z Flex 2020/.test(rr.corpo), 'a versão sem repetir o modelo', (rr.corpo.match(/<title>[^<]*/) || [])[0]);
  assert(r.corpo.split('<title>').length === 2 && (r.corpo.match(/og:image/g) || []).length === 1, 'sem a prévia padrão repetida');
  assert(r.h['Vercel-Cache-Tag'] === 'site-veiculos' && /\$1/.test(pedidos[0][0]) && pedidos[0][1][0] === 123, 'lê só aquele carro, e a página fica no cache com a etiqueta do estoque');
  linha = null; r = await chamaP({ veiculo: '999-vendido' });
  assert(r.st === 404 && /<title>Aceima \| Intendente/.test(r.corpo), 'carro vendido: a página normal, com 404 para o Google tirar o endereço');
  r = await chamaP({ publicacao: 'p1' });
  assert(r.st === 200 && /<title>Feirão de &lt;novembro&gt; \| Aceima<\/title>/.test(r.corpo) && /og:image" content="https:\/\/aintendente\.com\.br\/fotos-publicacoes\/p1\.webp"/.test(r.corpo) && /"@type":"Article"/.test(r.corpo), 'a publicação sai com o título, a foto e os dados');
  assert(!/<novembro>/.test(r.corpo.split('<!--/meta-->')[0]) && /\\u003cnovembro>/.test(r.corpo), 'o texto da publicação não abre etiqueta no HTML');
  r = await chamaP({ publicacao: 'nao-existe' });
  assert(r.st === 404, 'publicação que não existe: 404');
  linha = [{ id: 1, marca: 'FIAT', modelo: 'UNO', ano_modelo: 2019 }, { id: 2, marca: 'HONDA', modelo: 'HR-V', ano_modelo: 2021 }];
  const x = resposta(); let xml = ''; x.end = b => { xml = b; return x; }; await R.rotaSitemap({ query: {} }, x, arquivo);
  assert(/^<\?xml/.test(xml) && xml.includes('<loc>https://aintendente.com.br/estoque</loc>') && xml.includes('<loc>https://aintendente.com.br/veiculo/1-fiat-uno-2019</loc>') && xml.includes('<loc>https://aintendente.com.br/veiculo/2-honda-hr-v-2021</loc>') && xml.includes('/publicacoes/p1</loc><lastmod>2026-11-20</lastmod>'), 'o mapa do site tem as páginas, as publicações e os carros');
  assert(x.h['Content-Type'] === 'application/xml; charset=utf-8' && x.h['Vercel-Cache-Tag'] === 'site-veiculos', 'o mapa sai como XML e fica no cache com a etiqueta do estoque');
}

// 21/11/2026: o modelo novo de site do AutoCerto (o da Autryx) traz a marca e o modelo em campos próprios, e o único cabeçalho do cartão é a
// versão. Lido como nome, a cilindrada virava a marca ("1.0") e um pedaço da versão, o modelo ("200"), e as listas de marcas do site
// mostravam "1.0, 1.3, 1.5". Os cartões abaixo seguem o HTML da página de estoque da Autryx e o da Auto Barra (o modelo antigo)
{
  let cheerio = null;
  try { cheerio = await import('cheerio'); } catch (_) {}
  assert(cheerio, 'o cheerio está instalado (rode npm ci antes dos testes)');
  const ini1 = src.indexOf('function precoDe'), fim1 = src.indexOf('// Ano a partir do qual');
  const ini2 = src.indexOf('function uniqTexts'), fim2 = src.indexOf('// decide a origem do estoque');
  const ini3 = src.indexOf('// extrai os cartões de anúncio'), fim3 = src.indexOf('// detalhe do site próprio');
  assert(ini1 > 0 && fim1 > ini1 && ini2 > 0 && fim2 > ini2 && ini3 > 0 && fim3 > ini3, 'o leitor dos cartões das lojas foi achado no arquivo');
  if (cheerio) {
    const { colherCards, uniqTexts } = new Function(src.slice(ini1, fim1) + src.slice(ini2, fim2) + src.slice(ini3, fim3) + '; return { colherCards, uniqTexts };')();
    const ler = html => {   // como o lerSite: as marcas e os modelos dos filtros da página, maiores primeiro
      const $ = cheerio.load(html), maior = (a, b) => b.length - a.length;
      const ctx = { marcas: uniqTexts($, 'a[href*="marca="]').map(t => t.toUpperCase()).sort(maior), modelos: uniqTexts($, 'a[href*="modelo="]').map(t => t.toUpperCase()).sort(maior), vistos: new Set(), itens: [], ignorados: [] };
      colherCards($, ctx);
      return ctx;
    };
    const novo = (slug, id, foto, marca, modelo, cabecalho, comb, km, ano, preco) => `<div class="result-item">
      <div class="result-item-image"><a href="/Veiculo/${slug}/${id}/detalhes" class="media-box loadPageAjax"><img src="${foto}" width="1024" height="768" alt="${marca} ${modelo}"><span class="zoom"><span class="icon"><i class="fa fa-plus-circle"></i></span></span></a></div>
      <div class="result-item-in">
        <div class="vehicle-brand-row"><img src="https://www.autocerto.com/fabricantes/x.webp" class="vehicle-brand-logo" alt="${marca}">
          <span class="vehicle-brand-text"><strong class="vehicle-brand-model">${modelo}</strong><small class="vehicle-brand-name">${marca}</small></span></div>
        <h4 class="result-item-sub-title">${cabecalho}</h4>
        <div class="vehicle-card-specs">
          <span class="vc-spec"><i class="fa-solid fa-gas-pump"></i><em class="vc-spec-txt"><small>Combustível</small><strong>${comb}</strong></em></span>
          <span class="vc-spec"><i class="fa fa-cog"></i><em class="vc-spec-txt"><small>Câmbio</small><strong>Autom&#225;tico</strong></em></span>
          <span class="vc-spec"><i class="fa fa-tachometer"></i><em class="vc-spec-txt"><small>Km</small><strong>${km}<span class="vc-unidade"> km</span></strong></em></span>
          <span class="vc-spec"><i class="fa fa-calendar"></i><em class="vc-spec-txt"><small>Ano</small><strong>${ano}</strong></em></span>
        </div>
      </div>
      <div class="result-item-cont result-item-pricing-home"><div class="row"><div class="col-md-7"><div class="price"><small>R$ </small>${preco}</div></div>
        <div class="col-md-5 divdetalhes"><a href="/Veiculo/${slug}/${id}/detalhes" class="btn btn-primary btnDetalhes loadPageAjax">Ver mais</a>
          <a href="https://api.whatsapp.com/send?phone=5521999999999" class="btn btnWhatsCard"><i class="fa fa-whatsapp"></i> Fale Conosco</a></div></div></div>
    </div>`;
    const autryx = `<ul><li><a href="/Veiculos?marca=TOYOTA" class="loadPageAjax"> <i class="fa fa-caret-right"></i> TOYOTA</a></li>
      <li><a href="/Veiculos?marca=VOLKSWAGEN" class="loadPageAjax"> <i class="fa fa-caret-right"></i> VOLKSWAGEN</a></li>
      <li><a href="/Veiculos?modelo=COROLLA CROSS" class="loadPageAjax">COROLLA CROSS</a></li><li><a href="/Veiculos?modelo=POLO" class="loadPageAjax">POLO</a></li></ul>
      <div class="results-list-view">`
      + novo('polo-1.0-200-tsi-comfortline-automatico-2022', '4496574', 'https://www.autocerto.com/fotos/1719/4496574/16_050357.jpg', 'VOLKSWAGEN', 'POLO', '1.0 200 TSI COMFORTLINE AUTOM&#193;TICO', 'Flex', '20.950', '2022/2022', '92.900,00')
      + novo('corolla-cross-2.0-vvt-ie-flex-xre-direct-shift-2024', '5655548', 'https://www.autocerto.com/fotos/1719/5655548/20_060050.jpg', 'TOYOTA', 'COROLLA CROSS', 'TOYOTA COROLLA CROSS 2.0 VVT-IE FLEX XRE DIRECT SHIFT', 'Gasolina', '43.700', '2023/2024', '149.900,00')
      + `</div>`;
    let c = ler(autryx);
    const polo = c.itens.find(i => i.anuncioId === '4496574') || {}, cross = c.itens.find(i => i.anuncioId === '5655548') || {};
    assert(c.itens.length === 2 && !c.ignorados.length, 'Autryx: os dois cartões entram, cada um uma vez (a foto e o "Ver mais" levam ao mesmo anúncio)', c.itens.length);
    assert(polo.marca === 'VOLKSWAGEN' && polo.modelo === 'POLO' && polo.versao === '1.0 200 TSI COMFORTLINE AUTOMÁTICO', 'Autryx: a marca e o modelo vêm dos campos do cartão, e o cabeçalho é a versão inteira (a cilindrada não vira a marca)', JSON.stringify([polo.marca, polo.modelo, polo.versao]));
    assert(cross.marca === 'TOYOTA' && cross.modelo === 'COROLLA CROSS' && cross.versao === '2.0 VVT-IE FLEX XRE DIRECT SHIFT', 'Autryx: modelo de duas palavras inteiro, e o cabeçalho que repete a marca e o modelo vira só a versão', JSON.stringify([cross.marca, cross.modelo, cross.versao]));
    assert(polo.combustivel === 'Flex' && cross.combustivel === 'Gasolina', 'Autryx: o combustível vem da ficha do cartão (o endereço do anúncio não traz)', polo.combustivel + ' ' + cross.combustivel);
    assert(polo.ano === 2022 && polo.km === 20950 && polo.preco === 92900 && polo.cambio === 'Automático' && /4496574\/16_050357\.jpg$/.test(polo.img || '') && cross.ano === 2024, 'Autryx: ano, km, preço, câmbio e a foto da capa', JSON.stringify([polo.ano, polo.km, polo.preco, polo.cambio]));
    // o modelo antigo (Auto Barra): o nome inteiro no link, o combustível no endereço. Continua como era
    c = ler(`<a href="/Veiculos?marca=AUDI">AUDI</a><a href="/Veiculos?modelo=A3">A3</a><div class="lista-veiculos"><div id="results-holder" class="results-list-view"><div class="result-item">
      <div class="col-md-6 fotoVeiculo"><a href="Veiculo/a3-1.8-tfsi-sedan-16v-180cv-gasolina-4p-automatico-gasolina-2015/5802318/detalhes" class="media-box"><img src="https://www.autocerto.com/fotos/551/5802318/1_023216.jpg" alt=""></a><span class="label label-primary vehicle-age">Gasolina</span></div>
      <div class="col-md-6"><h4 class="result-item-title"><a href="Veiculo/a3-1.8-tfsi-sedan-16v-180cv-gasolina-4p-automatico-gasolina-2015/5802318/detalhes">
        AUDI A3<br />
        <span class="versaoVeiculo">1.8 TFSI SEDAN 16V 180CV GASOLINA 4P AUTOM&#193;TICO</span></a></h4>
      <div class="result-item-pricing"><div class="price"><span>R$ </span> 72.900,00</div></div>
      <ul class="listaEspecificacoes"><li><span>Ano</span><p>2015</p></li><li><span>Km</span><p>111469</p></li></ul></div></div></div></div>`);
    const a3 = c.itens[0] || {};
    assert(c.itens.length === 1 && a3.marca === 'AUDI' && a3.modelo === 'A3' && a3.versao === '1.8 TFSI SEDAN 16V 180CV GASOLINA 4P AUTOMÁTICO' && a3.combustivel === 'Gasolina' && a3.km === 111469 && a3.preco === 72900, 'modelo antigo (Auto Barra): continua lido como antes', JSON.stringify([a3.marca, a3.modelo, a3.versao, a3.combustivel, a3.km]));
    // nenhum outro jeito de chegar à marca: o cartão que só tem a versão não entra com a cilindrada no lugar da marca
    c = ler(`<div class="result-item"><a href="/Veiculo/polo-1.0-mpi-track-manual-2024/5706848/detalhes" class="media-box"><img src="https://www.autocerto.com/fotos/1719/5706848/20_050823.jpg"></a>
      <h4>1.0 MPI TRACK MANUAL</h4><div class="price">R$ 73.900,00</div></div>`);
    assert(!c.itens.length && c.ignorados.join() === '5706848', 'marca sem letra ("1.0") nunca entra: o anúncio fica de fora, contado como sem nome');
  }
  // as listas de marcas do site (o filtro do estoque e o Venda seu veículo) e a do Repasse: marca sem letra não entra
  const siteHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const repHtml = fs.readFileSync(new URL('../repasse.html', import.meta.url), 'utf8');
  const pedacos = (html, onde, res) => { const ms = res.map(re => html.match(re)); assert(ms.every(Boolean), `${onde}: o código da lista de marcas foi achado`); return ms.map(m => m ? m[0] : ''); };
  const ps = pedacos(siteHtml, 'site', [/^const norm=.*$/m, /^const uniq=.*$/m, /^const VD_MARCAS=\[[\s\S]*?\];$/m, /^const vdChave=.*$/m, /^const vdOrdem=.*$/m,
    /^const marcaComLetra=.*$/m, /^function vdMarcas\(\)\{.*$/m, /^\s*if\(k==='marca'\)return .*$/m]);
  ps.push('function marcasDoFiltro(k){' + ps.pop() + '}');   // a linha da marca no opcoes() do filtro do estoque
  const estoque = [{ b: '1.0' }, { b: '1.5' }, { b: '2.0' }, { b: 'Volkswagen' }, { b: 'Gac' }, { b: 'Toyota' }];
  const listas = new Function('V', 'F', ps.join('\n') + '; return { vdMarcas, marcasDoFiltro };')(estoque, {});
  const filtro = listas.marcasDoFiltro('marca'), venda = listas.vdMarcas();
  assert(filtro.join() === 'Gac,Toyota,Volkswagen', 'filtro Marca do estoque: sem "1.0, 1.5, 2.0"', filtro.join());
  assert(!venda.some(b => !/[a-z]/i.test(b)) && venda.includes('Gac') && venda.includes('Volkswagen'), 'Venda seu veículo: a lista de marcas sem número (e com as marcas do estoque)', venda.slice(0, 6).join());
  const pr = pedacos(repHtml, 'Repasse', [/^const norm=.*$/m, /^const VD_MARCAS=\[[\s\S]*?\];$/m, /^const frChave=.*$/m, /^const frOrdem=.*$/m, /^const marcaComLetra=.*$/m, /^function frMarcas\(\)\{.*$/m]);
  const rep = new Function('CAT', pr.join('\n') + '; return frMarcas;')(estoque)();
  assert(!rep.some(b => !/[a-z]/i.test(b)) && rep.includes('Gac'), 'Repasse: a lista de marcas do formulário também sem número', rep.slice(0, 6).join());
}
