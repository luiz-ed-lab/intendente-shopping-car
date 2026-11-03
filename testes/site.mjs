// Confere a versão leve de lojas e estoque que o site pede (site=1): pública, sem logos e com cache.
// O painel (sem site=1) continua recebendo tudo, sem cache. Rodar: node testes/site.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('// ---------------- ROTAS'), src.indexOf('async function rotaLeads'));
let sqls = [], migrou = 0, comSenha = false;
let params = [];
const query = async (sql, p) => { sqls.push(sql); params.push(p); return { rows: [] }; };
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
await mudou('loja', rotaLojas, { method: 'DELETE', query: { id: '1' }, headers: {}, body: {} });
assert(apagadas.includes('site-lojas') && apagadas.includes('site-veiculos'), 'painel: excluir a loja tira ela e os carros do site na hora');
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
