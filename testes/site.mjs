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
assert(!/logo_url|\*/.test(sqls[0]) && /s-maxage/.test(r.h['Cache-Control'] || '') && migrou === 0, 'site: lojas sem logos, com cache e sem migra');
assert(/nome <> all\(\$1\)/.test(sqls[0]) && params[0][0].includes('Lions Seminovos'), 'site: a loja fora do site (FORA_DO_SITE) não vem na lista');

comSenha = true; sqls = []; r = resposta(); await rotaVeiculos(pedido({ site: '1' }), r);
assert(/coalesce\(v\.oculto,false\) = false/.test(sqls[0]) && /s-maxage/.test(r.h['Cache-Control'] || ''), 'site: estoque nunca traz oculto, nem com senha (o cache é de todos)');
assert(/l\.nome <> all\(\$1\)/.test(sqls[0]), 'site: nem o estoque da loja fora do site');

sqls = []; r = resposta(); await rotaVeiculos(pedido({}), r);
assert(!/oculto,false\) = false/.test(sqls[0]) && !r.h['Cache-Control'] && migrou === 1, 'painel com senha: vê os ocultos, sem cache');

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
