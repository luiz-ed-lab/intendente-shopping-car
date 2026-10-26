// Confere o Repasse (rotas repasse e rfoto) sem banco: os acessos só com a senha do painel, a senha guardada só como scrypt, o login,
// as validações, as fotos (só imagem de verdade) e o cache da foto. Rodar: node testes/repasse.mjs
import fs from 'fs';
import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('// ---------------- REPASSE'), src.indexOf('// ---------------- ROTEADOR'));
let sqls = [], linhas = () => [], comSenha = false;
const query = async (sql, p) => { sqls.push([sql, p]); return { rows: linhas(sql, p) || [] }; };
const { rotaRepasse, rotaFotoRepasse, hashSenha, confereSenha } = new Function('query', 'pausa', 'autorizado', 'negar', 'scrypt', 'randomBytes', 'createHash', 'timingSafeEqual',
  trecho + '; return { rotaRepasse, rotaFotoRepasse, hashSenha, confereSenha };')(
  query, async () => {}, () => comSenha, res => res.status(401).json({ erro: 'não autorizado' }), scrypt, randomBytes, createHash, timingSafeEqual);
const resposta = () => { const r = { st: 200, h: {}, corpo: null, setHeader(k, v) { r.h[k] = v; }, status(s) { r.st = s; return r; }, json(o) { r.corpo = o; return r; }, end(b) { r.corpo = b; return r; } }; return r; };
const chama = async (fn, method, q, body, headers) => { const r = resposta(); await fn({ method, query: q, body: body || {}, headers: headers || {} }, r); return r; };
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };
const usou = re => sqls.some(([s]) => re.test(s));

const h = await hashSenha('senha-teste-1');
assert(/^s1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(h) && !h.includes('senha-teste-1') && await confereSenha('senha-teste-1', h) && !(await confereSenha('outra', h)), 'senha guardada só como scrypt, e conferida');

let r = await chama(rotaRepasse, 'GET', { acao: 'acessos' });
assert(r.st === 401 && !usou(/from repasse_acessos a order/), 'acessos das lojas: só com a senha do painel');
comSenha = true; r = await chama(rotaRepasse, 'GET', { acao: 'acessos' });
assert(r.st === 200 && usou(/from repasse_acessos a order/) && r.h['Cache-Control'] === 'no-store', 'com a senha do painel: a lista, sem cache');
comSenha = false;

sqls = []; r = await chama(rotaRepasse, 'GET', {}, null, { 'x-repasse-token': 'abc' });
assert(r.st === 401 && !usou(/repasse_sessoes s join/), 'token fora do formato: 401 sem ir ao banco');
r = await chama(rotaRepasse, 'POST', { acao: 'entrar' }, { email: '', senha: '' });
assert(r.st === 400, 'entrar sem e-mail e senha: 400');

// login: a sessão guarda o hash do token
linhas = s => /from repasse_acessos a join lojas/.test(s) ? [{ id: 7, email: 'loja@teste.com', senha: h, ativo: true, loja: 'TurboMix Veículos', falhas: 0, bloqueio: null }] : [];
sqls = []; r = await chama(rotaRepasse, 'POST', { acao: 'entrar' }, { email: 'Loja@Teste.com ', senha: 'senha-teste-1' });
const ins = sqls.find(([s]) => /insert into repasse_sessoes/.test(s));
assert(r.st === 200 && /^[a-f0-9]{64}$/.test(r.corpo.token) && ins && ins[1][0] === createHash('sha256').update(r.corpo.token).digest('hex'), 'login certo: o aparelho recebe o token e o banco guarda só o hash');
assert(sqls.find(([s]) => /from repasse_acessos a join lojas/.test(s))[1][0] === 'loja@teste.com', 'o e-mail é conferido sem espaços e em minúsculas');
sqls = []; r = await chama(rotaRepasse, 'POST', { acao: 'entrar' }, { email: 'loja@teste.com', senha: 'errada' });
assert(r.st === 401 && usou(/falhas = falhas \+ 1/), 'senha errada: 401 e conta o erro (oito seguidos travam 15 minutos)');

// com a sessão de uma loja
const T = { 'x-repasse-token': 'a'.repeat(64) };
linhas = s => /repasse_sessoes s join/.test(s) ? [{ id: 7, loja_id: 3, loja: 'TurboMix Veículos' }]
  : /count\(\*\)::int as n from repasse_carros/.test(s) ? [{ n: 0 }]
  : /insert into repasse_carros/.test(s) ? [{ id: 55 }]
  : /select id from repasse_carros/.test(s) ? [{ id: 55 }]
  : /octet_length/.test(s) ? [{ fotos: '1000', banco: '50000000' }] : [];
sqls = []; r = await chama(rotaRepasse, 'GET', {}, null, T);
const lista = sqls.find(([s]) => /from repasse_carros c join lojas/.test(s));
assert(r.st === 200 && lista && /a\.ativo = true/.test(lista[0]) && /l\.ativa = true/.test(lista[0]) && /interval '30 days'/.test(lista[0]), 'a lista só tem carros de lojas com acesso ativo, por 30 dias');
r = await chama(rotaRepasse, 'POST', { acao: 'publicar' }, { nome: 'Fi', ano: '2020', valor: 50000 }, T);
assert(r.st === 400, 'publicar sem marca e modelo: 400');
r = await chama(rotaRepasse, 'POST', { acao: 'publicar' }, { nome: 'Fiat Argo', ano: '20', valor: 50000 }, T);
assert(r.st === 400, 'publicar sem o ano: 400');
sqls = []; r = await chama(rotaRepasse, 'POST', { acao: 'publicar' }, { nome: 'Fiat Argo Drive', ano: '2021', valor: 58400, fotos: 3 }, T);
let p = sqls.find(([s]) => /insert into repasse_carros/.test(s))[1];
assert(r.st === 201 && r.corpo.id === 55 && p[0] === 3 && p[12] === 'enviando', 'com fotos, o carro nasce "enviando" (fora da lista até o pronto), sempre da loja da sessão');
sqls = []; await chama(rotaRepasse, 'POST', { acao: 'publicar' }, { nome: 'Fiat Argo Drive', ano: '2021', valor: 58400, fotos: 0, placa: 'ABC1D23' }, T);
p = sqls.find(([s]) => /insert into repasse_carros/.test(s))[1];
assert(p[12] === 'ativo' && p[9] === '3', 'sem fotos, já entra no repasse; da placa fica só o final');
r = await chama(rotaRepasse, 'POST', { acao: 'foto' }, { carro: 55, ordem: 0, dados: 'data:image/jpeg;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') }, T);
assert(r.st === 400, 'arquivo que não é imagem: recusado');
sqls = []; r = await chama(rotaRepasse, 'POST', { acao: 'foto' }, { carro: 55, ordem: 0, dados: 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64') }, T);
const ft = sqls.find(([s]) => /insert into repasse_fotos/.test(s));
assert(r.st === 200 && /^[a-f0-9]{32}$/.test(r.corpo.id) && ft && /decode\(\$5, 'base64'\)/.test(ft[0]) && ft[1][3] === 'image/jpeg', 'foto jpg: gravada com endereço sorteado');
linhas = s => /repasse_sessoes s join/.test(s) ? [{ id: 7, loja_id: 3, loja: 'TurboMix Veículos' }] : /select id from repasse_carros/.test(s) ? [{ id: 55 }] : /octet_length/.test(s) ? [{ fotos: '400000000', banco: '50000000' }] : [];
r = await chama(rotaRepasse, 'POST', { acao: 'foto' }, { carro: 55, ordem: 1, dados: 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64') }, T);
assert(r.st === 507 && /Aceima/.test(r.corpo.erro), 'com o espaço das fotos cheio: recusa e pede para avisar a Aceima');
r = await chama(rotaRepasse, 'POST', { acao: 'status' }, { id: 55, status: 'vendido' }, T);
assert(r.st === 400, 'status fora da lista: 400');
sqls = []; r = await chama(rotaRepasse, 'POST', { acao: 'status' }, { id: 55, status: 'tirado' }, T);
const up = sqls.find(([s]) => /update repasse_carros set status = \$3/.test(s));
assert(up && /loja_id = \$2/.test(up[0]) && up[1][1] === 3, 'mudar o status só no carro da própria loja');

// a foto
sqls = []; r = await chama(rotaFotoRepasse, 'GET', { id: '../x' });
assert(r.st === 404 && !usou(/from repasse_fotos/), 'endereço de foto fora do formato: 404 sem ir ao banco');
linhas = s => /from repasse_fotos where id/.test(s) ? [{ tipo: 'image/jpeg', b64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') }] : [];
sqls = []; r = await chama(rotaFotoRepasse, 'GET', { id: 'b'.repeat(32), m: '1' });
assert(r.st === 200 && r.h['Content-Type'] === 'image/jpeg' && /immutable/.test(r.h['Cache-Control']) && r.h['X-Content-Type-Options'] === 'nosniff' && r.corpo[0] === 0xff
  && usou(/coalesce\(mini, dados\)/), 'a foto pequena sai como imagem, com cache de um ano');
