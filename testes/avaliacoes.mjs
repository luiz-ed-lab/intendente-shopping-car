// Confere a busca de avaliações do Google (faixa da home e notas dos associados) sem chamar o Google de verdade.
// Rodar: node testes/avaliacoes.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('const semAcento'), src.indexOf('// ---------------- ROTEADOR'));
let config = null, updates = [], chamadas = [], respostas = {}, migrou = 0;
let lojas = [{ id: 1, nome: 'HiperCar' }, { id: 2, nome: 'T.F.A. Motors' }, { id: 3, nome: 'Lazari' }];
const query = async (sql, p) => {
  if (/select valor, em from config/.test(sql)) return { rows: config ? [config] : [] };
  if (/select id, nome from lojas/.test(sql)) return { rows: lojas.filter(l => !(p && p[0] || []).includes(l.nome)) };
  if (/insert into config/.test(sql)) { config = { valor: p[0], em: new Date() }; return { rows: [] }; }
  if (/update lojas/.test(sql)) { updates.push(p); return { rows: [] }; }
  throw new Error('sql inesperado: ' + sql);
};
globalThis.fetch = async (url, o) => {
  const q = JSON.parse(o.body).textQuery;
  chamadas.push(q.split(',')[0]);
  const r = Object.entries(respostas).find(([k]) => q.startsWith(k));
  return r ? r[1] : { ok: false, status: 429 };
};
const rev = (rating, texto, autor) => ({ rating, text: { text: texto }, authorAttribution: { displayName: autor, photoUri: 'https://foto/' + autor, uri: 'https://perfil/' + autor }, googleMapsUri: 'https://maps/' + autor });
const ok = places => ({ ok: true, status: 200, json: async () => ({ places }) });
const { avaliacoesGoogle, mesmaLoja } = new Function('query', 'migra', trecho + '; return { avaliacoesGoogle, mesmaLoja };')(query, async () => { migrou++; });
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };
const passaUmDia = () => { config.em = new Date(Date.now() - 25 * 36e5); chamadas = []; };
const autores = l => l.map(a => a.autor).sort().join();

assert(mesmaLoja('HiperCar', 'Hiper Car Veículos') && mesmaLoja('T.F.A. Motors', 'TFA Motors') && !mesmaLoja('Lazari', 'Oficina do Zé'), 'confere o nome da loja no Google');
delete process.env.GOOGLE_PLACES_KEY;
assert((await avaliacoesGoogle()).length === 0 && chamadas.length === 0, 'sem chave: não chama o Google');
process.env.GOOGLE_PLACES_KEY = 'x';

// os credenciados (PARCEIROS_ROBO) entram na mesma rodada das lojas (pedido do Luiz, 07/10/2026)
const CRED = ['LaudoCar', 'SISV Inspeção Veicular', 'Frioline', 'R21 Bar & Restaurante'];
const deLojas = () => chamadas.filter(n => !CRED.includes(n));
const guardadas = () => JSON.parse(config.valor);

// primeira vez: todas as lojas e os credenciados; a Lazari e os credenciados falham (cota)
respostas = {
  'HiperCar': ok([{ displayName: { text: 'Hiper Car' }, rating: 4.7, userRatingCount: 120, reviews: [rev(5, 'Ótimo atendimento', 'Ana'), rev(2, 'Ruim', 'Bia'), rev(5, '', 'Cris')] }]),
  'T.F.A. Motors': ok([{ displayName: { text: 'TFA Motors' }, rating: 5, userRatingCount: 40, reviews: [rev(4, 'Recomendo', 'Duda')] }])
};
let l = await avaliacoesGoogle();
assert(chamadas.length === 7 && deLojas().length === 3 && autores(l) === 'Ana,Duda', 'primeira vez busca todas as lojas e os credenciados; só avaliações boas, com texto');
assert(l.find(a => a.autor === 'Ana').link === 'https://maps/Ana' && l.find(a => a.autor === 'Ana').loja === 'HiperCar', 'guarda loja e link');
assert(updates.length === 2 && updates[0][1] === 4.7, 'atualiza a nota das lojas achadas');

chamadas = []; migrou = 0; await avaliacoesGoogle();
assert(chamadas.length === 0, 'no mesmo dia não chama o Google de novo (nem os credenciados que falharam)');
assert(migrou === 0, 'no mesmo dia só lê: não espera as migrações do banco');

// dia seguinte: atualiza todos de novo (são menos de 30), inclusive os que falharam; a nota do credenciado fica guardada
passaUmDia(); respostas.Lazari = ok([{ displayName: { text: 'Lazari Automóveis' }, reviews: [rev(5, 'Muito bom', 'Edu')] }]);
respostas.HiperCar = ok([{ displayName: { text: 'Hiper Car' }, reviews: [rev(5, 'Voltei e comprei de novo', 'Fê')] }]);
respostas.Frioline = ok([{ displayName: { text: 'Frioline Ar-Condicionado' }, rating: 4.7, userRatingCount: 88, reviews: [rev(5, 'Resolveu o ar na hora', 'Gil')] }]);
l = await avaliacoesGoogle();
assert(chamadas.length === 7 && autores(l) === 'Duda,Edu,Fê,Gil', 'uma vez por dia atualiza todas as lojas e os credenciados');
assert(guardadas().Frioline.nota === 4.7 && guardadas().Frioline.total === 88 && l.find(a => a.autor === 'Gil').loja === 'Frioline', 'guarda a nota do credenciado e as avaliações dele vão para a faixa');

// tudo falhou: mantém o que tinha e tenta de novo na próxima visita
passaUmDia(); respostas = {}; const antes = config.em;
l = await avaliacoesGoogle();
assert(chamadas.length === 7 && autores(l) === 'Duda,Edu,Fê,Gil' && config.em === antes, 'falha: mantém as avaliações e não marca o dia');

// credenciado novo (ainda sem consulta): entra na hora, no mesmo dia, só ele
respostas = { 'HiperCar': ok([]), 'T.F.A. Motors': ok([]), 'Lazari': ok([]), 'LaudoCar': ok([{ displayName: { text: 'Laudocar RJ' }, rating: 4.9, userRatingCount: 300, reviews: [] }]) };
passaUmDia(); await avaliacoesGoogle();
const g = guardadas(); delete g.LaudoCar; config.valor = JSON.stringify(g); chamadas = [];
await avaliacoesGoogle();
assert(chamadas.join() === 'LaudoCar' && guardadas().LaudoCar.nota === 4.9, 'credenciado novo entra na hora, sem refazer os outros');

// loja fora do site (FORA_DO_SITE, a Lions): não é consultada e as avaliações guardadas dela não aparecem
lojas.push({ id: 9, nome: 'Lions Seminovos' }); const g2 = guardadas(); g2['Lions Seminovos'] = { em: new Date().toISOString(), lista: [{ loja: 'Lions Seminovos', autor: 'Zé', texto: 'x' }] };
config.valor = JSON.stringify(g2); passaUmDia(); respostas['Lions Seminovos'] = ok([]);
l = await avaliacoesGoogle();
assert(!chamadas.includes('Lions Seminovos') && !l.some(a => a.loja === 'Lions Seminovos') && !guardadas()['Lions Seminovos'], 'loja fora do site não é consultada nem aparece');

// loja que saiu da associação some da faixa
lojas = lojas.filter(x => x.nome !== 'Lazari'); passaUmDia();
respostas = { 'HiperCar': ok([]), 'T.F.A. Motors': ok([]) };
l = await avaliacoesGoogle();
assert(!l.some(a => a.loja === 'Lazari'), 'loja que saiu some da faixa');

// mais de 30 associados: no máximo 30 consultas por dia, os mais antigos primeiro
lojas = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, nome: 'Loja' + (i + 1) }));
config = null; chamadas = []; respostas = { 'Loja': ok([]) };
await avaliacoesGoogle();
assert(chamadas.length === 30, 'primeiro dia: 30 consultas');
chamadas = []; await avaliacoesGoogle();
assert(chamadas.length === 0, 'no mesmo dia, com as 30 do dia feitas, os credenciados novos esperam');
passaUmDia(); await avaliacoesGoogle();
assert(chamadas.length === 30 && ['Loja31', 'Loja35', 'Frioline'].every(n => chamadas.includes(n)), 'segundo dia: entram os que ficaram de fora');
