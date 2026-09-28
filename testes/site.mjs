// Confere a versão leve de lojas e estoque que o site pede (site=1): pública, sem logos e com cache.
// O painel (sem site=1) continua recebendo tudo, sem cache. Rodar: node testes/site.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('// ---------------- ROTAS'), src.indexOf('async function rotaLeads'));
let sqls = [], migrou = 0, comSenha = false;
const query = async sql => { sqls.push(sql); return { rows: [] }; };
const { rotaLojas, rotaVeiculos } = new Function('query', 'migra', 'autorizado', 'negar', trecho + '; return { rotaLojas, rotaVeiculos };')(
  query, async () => { migrou++; }, () => comSenha, res => res.status(401).json({}));
const pedido = q => ({ method: 'GET', query: q, headers: {} });
const resposta = () => { const r = { h: {}, setHeader(k, v) { r.h[k] = v; }, status() { return r; }, json() { return r; } }; return r; };
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };

let r = resposta(); await rotaLojas(pedido({ site: '1' }), r);
assert(!/logo_url|\*/.test(sqls[0]) && /s-maxage/.test(r.h['Cache-Control'] || '') && migrou === 0, 'site: lojas sem logos, com cache e sem migra');

comSenha = true; sqls = []; r = resposta(); await rotaVeiculos(pedido({ site: '1' }), r);
assert(/coalesce\(v\.oculto,false\) = false/.test(sqls[0]) && /s-maxage/.test(r.h['Cache-Control'] || ''), 'site: estoque nunca traz oculto, nem com senha (o cache é de todos)');

sqls = []; r = resposta(); await rotaVeiculos(pedido({}), r);
assert(!/oculto,false\) = false/.test(sqls[0]) && !r.h['Cache-Control'] && migrou === 1, 'painel com senha: vê os ocultos, sem cache');

sqls = []; r = resposta(); await rotaLojas(pedido({}), r);
assert(/select \* from lojas/.test(sqls[0]) && !r.h['Cache-Control'], 'painel: lojas completas (com logos), sem cache');
