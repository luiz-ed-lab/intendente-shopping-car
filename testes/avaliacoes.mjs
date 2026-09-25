// Confere a busca de avaliações do Google (faixa da home) sem chamar o Google de verdade.
// Rodar: node testes/avaliacoes.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('const semAcento'), src.indexOf('// ---------------- ROTEADOR'));
let config = null, updates = [], chamadas = [], respostas = {};
let lojas = [{ id: 1, nome: 'HiperCar' }, { id: 2, nome: 'T.F.A. Motors' }, { id: 3, nome: 'Lazari' }];
const query = async (sql, p) => {
  if (/select valor, em from config/.test(sql)) return { rows: config ? [config] : [] };
  if (/select id, nome from lojas/.test(sql)) return { rows: lojas.slice() };
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
const { avaliacoesGoogle, mesmaLoja } = new Function('query', 'migra', trecho + '; return { avaliacoesGoogle, mesmaLoja };')(query, async () => {});
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };
const passaUmDia = () => { config.em = new Date(Date.now() - 25 * 36e5); chamadas = []; };
const autores = l => l.map(a => a.autor).sort().join();

assert(mesmaLoja('HiperCar', 'Hiper Car Veículos') && mesmaLoja('T.F.A. Motors', 'TFA Motors') && !mesmaLoja('Lazari', 'Oficina do Zé'), 'confere o nome da loja no Google');
delete process.env.GOOGLE_PLACES_KEY;
assert((await avaliacoesGoogle()).length === 0 && chamadas.length === 0, 'sem chave: não chama o Google');
process.env.GOOGLE_PLACES_KEY = 'x';

// primeira vez: todas as lojas; a Lazari falha (cota)
respostas = {
  'HiperCar': ok([{ displayName: { text: 'Hiper Car' }, rating: 4.7, userRatingCount: 120, reviews: [rev(5, 'Ótimo atendimento', 'Ana'), rev(2, 'Ruim', 'Bia'), rev(5, '', 'Cris')] }]),
  'T.F.A. Motors': ok([{ displayName: { text: 'TFA Motors' }, rating: 5, userRatingCount: 40, reviews: [rev(4, 'Recomendo', 'Duda')] }])
};
let l = await avaliacoesGoogle();
assert(chamadas.length === 3 && autores(l) === 'Ana,Duda', 'primeira vez busca todas; só avaliações boas, com texto');
assert(l.find(a => a.autor === 'Ana').link === 'https://maps/Ana' && l.find(a => a.autor === 'Ana').loja === 'HiperCar', 'guarda loja e link');
assert(updates.length === 2 && updates[0][1] === 4.7, 'atualiza a nota das lojas achadas');

chamadas = []; await avaliacoesGoogle();
assert(chamadas.length === 0, 'no mesmo dia não chama o Google de novo');

// dia seguinte: atualiza todas de novo (são menos de 30), inclusive a que falhou
passaUmDia(); respostas.Lazari = ok([{ displayName: { text: 'Lazari Automóveis' }, reviews: [rev(5, 'Muito bom', 'Edu')] }]);
respostas.HiperCar = ok([{ displayName: { text: 'Hiper Car' }, reviews: [rev(5, 'Voltei e comprei de novo', 'Fê')] }]);
l = await avaliacoesGoogle();
assert(chamadas.length === 3 && autores(l) === 'Duda,Edu,Fê', 'uma vez por dia atualiza todas as lojas');

// tudo falhou: mantém o que tinha e tenta de novo na próxima visita
passaUmDia(); respostas = {}; const antes = config.em;
l = await avaliacoesGoogle();
assert(chamadas.length === 3 && autores(l) === 'Duda,Edu,Fê' && config.em === antes, 'falha: mantém as avaliações e não marca o dia');

// loja que saiu da associação some da faixa
lojas = lojas.filter(x => x.nome !== 'Lazari'); passaUmDia();
respostas = { 'HiperCar': ok([]), 'T.F.A. Motors': ok([]) };
l = await avaliacoesGoogle();
assert(!l.some(a => a.loja === 'Lazari'), 'loja que saiu some da faixa');

// mais de 30 lojas: no máximo 30 consultas por dia, as mais antigas primeiro
lojas = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, nome: 'Loja' + (i + 1) }));
config = null; chamadas = []; respostas = { 'Loja': ok([]) };
await avaliacoesGoogle();
assert(chamadas.length === 30, 'primeiro dia: 30 consultas');
passaUmDia(); await avaliacoesGoogle();
assert(chamadas.length === 30 && ['Loja31', 'Loja35'].every(n => chamadas.includes(n)), 'segundo dia: entram as que ficaram de fora');
