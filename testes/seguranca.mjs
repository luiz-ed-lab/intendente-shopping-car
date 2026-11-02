// Confere a segurança da API (01/11/2026) sem banco e sem a Vercel: a sessão do painel no cookie HttpOnly, a senha comparada em
// tempo constante e travada depois de 8 erros, a senha na URL que não vale mais, os leads (validação, armadilha para robôs, limite por
// lugar, anexos só de imagem, a loja tirada do carro), o cron que não dá para imitar e o erro interno sem detalhe. Rodar: node testes/seguranca.mjs
import fs from 'fs';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const corte = (de, ate) => src.slice(src.indexOf(de), src.indexOf(ate));
const seguranca = corte('// ---------------- SEGURANÇA', '// ---------------- MODELO VISUAL DOS E-MAILS');
const leads = corte('// ---------------- LEADS', '// importa UMA loja');
const importar = corte('async function rotaImportar', '// atualização por visita');
const roteador = src.slice(src.indexOf('// ---------------- ROTEADOR')).replace('export default async function handler', 'async function handler');
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };

// um banco de mentira: as sessões do painel, os limites e os leads
let sessoes = [], limites = {}, leadsDb = [], veiculos = { 10: { id: 10, loja_id: 4 } }, sqls = [], emails = [];
const agora = () => Date.now();
async function query(sql, p = []) {
  sqls.push(sql);
  if (/create table/.test(sql)) return { rows: [] };
  if (/select expira from painel_sessoes/.test(sql)) return { rows: sessoes.filter(s => s.token === p[0] && s.versao === p[1] && s.expira > agora()).map(s => ({ expira: new Date(s.expira) })) };
  if (/insert into painel_sessoes/.test(sql)) { sessoes.push({ token: p[0], versao: p[1], expira: agora() + 3600e3 }); return { rows: [] }; }
  if (/delete from painel_sessoes where token/.test(sql)) { sessoes = sessoes.filter(s => s.token !== p[0]); return { rows: [] }; }
  if (/delete from painel_sessoes/.test(sql)) return { rows: [] };
  if (/insert into limites/.test(sql)) { const c = limites[p[0]]; limites[p[0]] = c && c.ate > agora() ? { n: c.n + 1, ate: c.ate } : { n: 1, ate: agora() + p[1] * 1000 }; return { rows: [{ n: limites[p[0]].n }] }; }
  if (/select n from limites/.test(sql)) { const c = limites[p[0]]; return { rows: c && c.ate > agora() ? [{ n: c.n }] : [] }; }
  if (/delete from limites where chave/.test(sql)) { delete limites[p[0]]; return { rows: [] }; }
  if (/select id, loja_id from veiculos/.test(sql)) return { rows: veiculos[p[0]] ? [veiculos[p[0]]] : [] };
  if (/insert into leads/.test(sql)) { const l = { id: leadsDb.length + 1, loja_id: p[0], veiculo_id: p[1], cliente_nome: p[2], cliente_telefone: p[3], cliente_email: p[4], forma_compra: p[5], entrada: p[6], canal: p[7], tipo: p[8], detalhes: p[9] }; leadsDb.push(l); return { rows: [l] }; }
  if (/from lojas/.test(sql)) return { rows: [] };
  throw new Error('sql inesperado: ' + sql);
}
const pausa = async () => {};
process.env.PAINEL_TOKEN = 'senha-do-painel-de-teste';
const inteiro = eval(src.match(/const inteiro = (v => \{.*?\});/)[1]);   // o mesmo de ROTAS
const mods = new Function('query', 'pausa', 'randomBytes', 'createHash', 'createHmac', 'timingSafeEqual', 'migra', 'enviarEmailsLead', 'Buffer', 'inteiro',
  seguranca + leads + '; return { autorizado, rotaAuth, rotaLeads, anexosDoLead, contar, ipDe };')(
  query, pausa, randomBytes, createHash, createHmac, timingSafeEqual, async () => {}, async (lead, so, anexos) => { emails.push({ lead, anexos }); }, Buffer, inteiro);
const { autorizado, rotaAuth, rotaLeads, anexosDoLead, ipDe } = mods;
const resposta = () => { const r = { st: 200, h: {}, corpo: null, setHeader(k, v) { r.h[k] = v; }, status(s) { r.st = s; return r; }, json(o) { r.corpo = o; return r; }, end(b) { r.corpo = b; return r; } }; return r; };
const pedido = (method, { headers = {}, body = {}, query: q = {}, ip = '200.1.1.1' } = {}) => ({ method, headers: { 'x-real-ip': ip, ...headers }, body, query: q });

// ---- a senha no cabeçalho (os robôs do GitHub) e a da URL
assert(await autorizado(pedido('GET', { headers: { 'x-painel-token': 'senha-do-painel-de-teste' } })), 'a senha certa no cabeçalho vale');
assert(!(await autorizado(pedido('GET', { query: { token: 'senha-do-painel-de-teste' } }))), 'a senha na URL (?token=) não vale mais');
for (let i = 0; i < 8; i++) await autorizado(pedido('GET', { headers: { 'x-painel-token': 'errada' + i }, ip: '9.9.9.9' }));
assert(!(await autorizado(pedido('GET', { headers: { 'x-painel-token': 'senha-do-painel-de-teste' }, ip: '9.9.9.9' }))), 'oito senhas erradas do mesmo lugar travam o lugar, mesmo com a certa depois');
assert(await autorizado(pedido('GET', { headers: { 'x-painel-token': 'senha-do-painel-de-teste' }, ip: '8.8.8.8' })), 'outro lugar continua entrando');
assert(!Object.keys(limites).some(k => k.includes('9.9.9.9')) && ipDe(pedido('GET', { ip: '9.9.9.9' })) !== ipDe(pedido('GET', { ip: '9.9.9.8' })), 'o IP não fica guardado: só um código dele');

// ---- o login do painel e a sessão no cookie
let r = resposta(); await rotaAuth(pedido('POST', { body: { token: 'errada' } }), r);
assert(r.st === 401 && !r.h['Set-Cookie'], 'senha errada: 401 e nenhum cookie');
r = resposta(); await rotaAuth(pedido('POST', { body: { token: 'senha-do-painel-de-teste' } }), r);
const ck = r.h['Set-Cookie'] || '', token = (ck.match(/^__Host-aceima_painel=([a-f0-9]{64});/) || [])[1];
assert(r.st === 200 && token && /HttpOnly/.test(ck) && /Secure/.test(ck) && /SameSite=Strict/.test(ck) && /Path=\//.test(ck) && /Max-Age=3600/.test(ck), 'senha certa: sessão de uma hora num cookie HttpOnly, Secure e SameSite=Strict');
assert(!JSON.stringify(r.corpo).includes(token) && !JSON.stringify(r.corpo).includes('senha-do-painel'), 'a resposta não traz o token nem a senha (o JavaScript da página nunca vê os dois)');
assert(sessoes.length === 1 && sessoes[0].token === createHash('sha256').update(token).digest('hex'), 'o banco guarda só o hash do token');
const comCookie = (m, extra = {}) => pedido(m, { headers: { cookie: 'outro=1; __Host-aceima_painel=' + token, ...extra } });
assert(await autorizado(comCookie('GET')), 'com o cookie, o painel lê');
assert(!(await autorizado(comCookie('POST'))), 'com o cookie, mudar alguma coisa sem o cabeçalho x-aceima: negado (segunda tranca contra pedido vindo de outro site)');
assert(await autorizado(comCookie('POST', { 'x-aceima': '1' })), 'com o cookie e o x-aceima, muda');
r = resposta(); await rotaAuth(comCookie('GET'), r);
assert(r.corpo.ok === true && r.corpo.exp > Date.now(), 'a página pergunta se a sessão vale');
const versaoAntiga = sessoes[0].versao;
process.env.PAINEL_TOKEN = 'outra-senha';
const mods2 = new Function('query', 'pausa', 'randomBytes', 'createHash', 'createHmac', 'timingSafeEqual', seguranca + '; return { autorizado };')(query, pausa, randomBytes, createHash, createHmac, timingSafeEqual);
assert(!(await mods2.autorizado(comCookie('GET'))) && versaoAntiga, 'trocar a senha na Vercel derruba as sessões abertas');
process.env.PAINEL_TOKEN = 'senha-do-painel-de-teste';
r = resposta(); await rotaAuth(comCookie('DELETE'), r);
assert(!sessoes.length && /Max-Age=0/.test(r.h['Set-Cookie']), 'sair apaga a sessão no banco e o cookie');
assert(!(await autorizado(comCookie('GET'))), 'depois de sair, o cookie antigo não vale');
assert(!(await autorizado(pedido('GET', { headers: { cookie: '__Host-aceima_painel=' + 'f'.repeat(64) } }))), 'cookie inventado não vale');
delete process.env.PAINEL_TOKEN;
const mods3 = new Function('query', 'pausa', 'randomBytes', 'createHash', 'createHmac', 'timingSafeEqual', seguranca + '; return { autorizado, rotaAuth };')(query, pausa, randomBytes, createHash, createHmac, timingSafeEqual);
r = resposta(); await mods3.rotaAuth(pedido('POST', { body: { token: '' } }), r);
assert(!(await mods3.autorizado(pedido('GET'))) && r.st === 503, 'sem a PAINEL_TOKEN na Vercel, nada protegido abre (antes abria tudo)');
process.env.PAINEL_TOKEN = 'senha-do-painel-de-teste';

// ---- leads
limites = {};
const lead = (body, ip) => { const x = resposta(); return rotaLeads(pedido('POST', { body, ip }), x).then(() => x); };
r = await lead({ tipo: 'venda', cliente_nome: 'Robô', cliente_telefone: '21999998888', website: 'http://spam' });
assert(r.st === 201 && !leadsDb.length, 'armadilha preenchida: finge que deu certo e não grava');
r = await lead({ tipo: 'qualquer', cliente_nome: 'Ana', cliente_telefone: '21999998888' });
assert(r.st === 400 && !leadsDb.length, 'tipo de lead que o site não tem: 400');
r = await lead({ tipo: 'venda', cliente_nome: 'Ana', cliente_telefone: '123' });
assert(r.st === 400, 'WhatsApp sem DDD e número: 400');
r = await lead({ tipo: 'compra', cliente_nome: 'Ana', cliente_telefone: '21999998888', cliente_email: 'a" onclick="x' });
assert(r.st === 400, 'e-mail fora do formato: 400');
emails = [];
r = await lead({ tipo: 'venda', canal: 'formulario', loja_id: 99, veiculo_id: 10, cliente_nome: '  Ana\u0000 Maria  ', cliente_telefone: '(21) 99999-8888', forma_compra: 'financiado', entrada: ' com entrada de 20.000', detalhes: { entrada: '20.000', lixo: 'x'.repeat(5000), __proto__: { admin: true } }, status: 'atendido' });
let l = leadsDb[leadsDb.length - 1];
assert(r.st === 201 && l.loja_id === 4 && l.veiculo_id === 10, 'a loja do lead vem do carro, não do pedido (o pedido dizia loja 99)');
assert(l.cliente_nome === 'Ana Maria' && l.cliente_telefone === '21999998888', 'nome limpo e WhatsApp só com números');
assert(JSON.parse(l.detalhes).entrada === '20.000' && !('lixo' in JSON.parse(l.detalhes)) && !/status/.test(Object.keys(l).join()) || l.status === undefined, 'só os campos conhecidos entram nos detalhes; o status não vem do pedido');
assert(JSON.stringify(r.corpo) === JSON.stringify({ ok: true, id: l.id }), 'a resposta pública devolve só o ok e o número, não o lead inteiro');
assert(emails.length === 1, 'o e-mail sai antes da resposta (a Vercel pode parar a função depois de responder)');
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpg')]).toString('base64');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('png')]).toString('base64');
const exe = Buffer.from('MZ\x90\x00 programa').toString('base64');
const an = anexosDoLead(['data:image/jpeg;base64,' + jpg, { base64: 'data:image/png;base64,' + png, nome: '../../virus.exe' }, 'data:image/jpeg;base64,' + exe, 'data:text/html;base64,' + jpg, ...Array(10).fill('data:image/jpeg;base64,' + jpg)]);
assert(an.length === 6 && an[0].filename === 'foto-1.jpg' && an[1].filename === 'foto-2.png' && an.every(f => /^foto-\d\.(jpg|png|webp)$/.test(f.filename)), 'anexos: só imagem de verdade, até 8 pedidos, com o nome dado por nós (nada de virus.exe)');
emails = [];
r = await lead({ tipo: 'compra', canal: 'venda_site', cliente_nome: 'Bia', cliente_telefone: '21988887777', cliente_email: 'bia@exemplo.com', detalhes: { marca: 'Fiat', modelo: 'Argo', ano: '2021', fotos: 99 }, fotos: ['data:image/jpeg;base64,' + jpg, 'data:image/jpeg;base64,' + exe] }, '7.7.7.7');
l = leadsDb[leadsDb.length - 1];
assert(r.st === 201 && JSON.parse(l.detalhes).fotos === 1 && emails[0].anexos.length === 1, '"quero vender": o número de fotos é o das fotos que passaram, não o que o pedido diz');
limites = {};
let ultimo;
for (let i = 0; i < 7; i++) ultimo = await lead({ tipo: 'associacao', cliente_nome: 'Carla', cliente_telefone: '21977776666', detalhes: { empresa: 'Padaria', ramo: 'Alimentício' } }, '5.5.5.5');
assert(ultimo.st === 429, 'do mesmo lugar, o sétimo contato em 10 minutos: 429');
r = await lead({ tipo: 'associacao', cliente_nome: 'Carla', cliente_telefone: '21977776666' }, '5.5.5.6');
assert(r.st === 201, 'outro lugar continua mandando');
limites = { 'emails:dia': { n: 80, ate: Date.now() + 864e5 } }; emails = []; const antes = leadsDb.length;
r = await lead({ tipo: 'associacao', cliente_nome: 'Duda', cliente_telefone: '21966665555' }, '6.6.6.6');
assert(r.st === 201 && leadsDb.length === antes + 1 && !emails.length, 'passou de 80 e-mails no dia: o lead fica gravado (aparece no painel) e o e-mail não sai');

// ---- o cron: o cabeçalho dá para imitar, então sem CRON_SECRET ele vale no máximo uma vez a cada 30 minutos
limites = {};
let importadas = 0;
const fImp = new Function('query', 'iguais', 'autorizado', 'negar', 'contar', 'migra', 'inteiro', 'importarLoja', 'resumoSeDevido', 'retencao',
  importar + '; return rotaImportar;')(async (sql) => ({ rows: /from lojas/.test(sql) ? [{ id: 1, nome: 'Loja' }] : [] }),
  (a, b) => a === b, async req => req.headers['x-painel-token'] === 'ok', res => res.status(401).json({}), mods.contar, async () => {},
  inteiro, async () => { importadas++; return {}; }, async () => {}, async () => {});
const imp = async (headers, q = {}) => { const x = resposta(); await fImp({ method: 'GET', headers: { 'x-real-ip': '1.1.1.1', ...headers }, query: q }, x); return x; };
r = await imp({});
assert(r.st === 401 && !importadas, 'sem senha e sem cara de cron: 401');
r = await imp({ 'user-agent': 'vercel-cron/1.0' }, { loja: '3' });
assert(r.st === 200 && importadas === 1, 'cara de cron, sem CRON_SECRET: importa uma vez');
r = await imp({ 'user-agent': 'vercel-cron/1.0' });
assert(r.st === 429 && importadas === 1, 'cara de cron de novo antes de 30 minutos: 429 (antes dava para disparar sem parar)');
process.env.CRON_SECRET = 'segredo-do-cron';
limites = {};
r = await imp({ 'user-agent': 'vercel-cron/1.0' });
assert(r.st === 401, 'com CRON_SECRET na Vercel, a cara de cron sozinha não vale');
r = await imp({ authorization: 'Bearer segredo-do-cron' });
assert(r.st === 200 && importadas === 2, 'com CRON_SECRET, o cron da Vercel (que manda o segredo) importa');
delete process.env.CRON_SECRET;

// ---- erro interno: o detalhe fica no registro, quem pediu recebe só o aviso
const memoria = {};   // o contador em memória de verdade é por instância; aqui, um simples
const naMemoria = (k, max) => (memoria[k] = (memoria[k] || 0) + 1) > max;
const doSite = req => !!(req.query && req.query.site === '1');
let lojasChamadas = 0;
const handler = new Function('rotaLojas', 'console', 'contarNaMemoria', 'ipDe', 'doSite', roteador + '; return handler;')(async () => { lojasChamadas++; throw new Error('relation "lojas" does not exist at character 15'); }, { error() {} }, naMemoria, req => req.headers['x-real-ip'] || 'ip', doSite);
r = resposta(); await handler({ method: 'GET', query: { path: 'lojas' }, headers: {}, url: '/api/lojas?path=lojas' }, r);
assert(r.st === 500 && !/relation|character/.test(JSON.stringify(r.corpo)) && r.h['Cache-Control'] === 'private, no-store', 'erro interno: sem a mensagem do banco, e nenhuma resposta da API fica em cache por padrão');

// ---- enxurrada de pedidos (02/11/2026): endereço público fora do formato não chega ao banco, e o mesmo lugar tem limite por minuto
lojasChamadas = 0;
for (const u of ['/api/lojas?path=lojas&site=1&x=1', '/api/lojas?path=lojas&site=1&site=1', '/api/logo?path=logo&id=1&cb=9', '/api/avaliacoes?path=avaliacoes&t=1', '/api/veiculos?path=veiculos&site=1&path=outra']) {
  const q = Object.fromEntries(new URL(u, 'http://x').searchParams); q.path = new URL(u, 'http://x').pathname.split('/')[2];
  r = resposta(); await handler({ method: 'GET', query: q, headers: {}, url: u }, r);
  assert(r.st === 400 && /s-maxage/.test(r.h['Cache-Control'] || ''), 'fora do formato, sem ir ao banco: ' + u.replace('/api/', ''));
}
assert(lojasChamadas === 0, 'nenhum desses pedidos chegou à rota');
r = resposta(); await handler({ method: 'GET', query: { path: 'lojas', site: '1' }, headers: {}, url: '/api/lojas?path=lojas&site=1' }, r);
assert(lojasChamadas === 1, 'o endereço do site passa');
r = resposta(); await handler({ method: 'GET', query: { path: 'lojas' }, headers: {}, url: '/api/lojas?path=lojas&qualquer=1' }, r);
assert(lojasChamadas === 2, 'sem site=1 é o painel (pede a senha na rota): não é barrado aqui');
let barrados = 0;
for (let i = 0; i < 310; i++) { r = resposta(); await handler({ method: 'GET', query: { path: 'nada' }, headers: { 'x-real-ip': 'robo' }, url: '/api/nada?path=nada' }, r); if (r.st === 429) barrados++; }
assert(barrados === 10, 'o mesmo lugar: até 300 pedidos por minuto, depois 429 (' + barrados + ' barrados)');
r = resposta(); await handler({ method: 'GET', query: { path: 'nada' }, headers: { 'x-real-ip': 'outro' }, url: '/api/nada?path=nada' }, r);
assert(r.st === 404, 'outro lugar continua passando');
