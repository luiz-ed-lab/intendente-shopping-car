// Confere a busca de avaliações do Google (faixa da home) sem chamar o Google de verdade.
// Rodar: node testes/avaliacoes.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('const semAcento'), src.indexOf('// ---------------- ROTEADOR'));
let config = null, updates = [], chamadas = 0, respostas = {};
const query = async (sql, p) => {
  if (/select valor, em from config/.test(sql)) return { rows: config ? [config] : [] };
  if (/select id, nome from lojas/.test(sql)) return { rows: [{ id: 1, nome: 'HiperCar' }, { id: 2, nome: 'T.F.A. Motors' }, { id: 3, nome: 'Lazari' }] };
  if (/insert into config/.test(sql)) { config = { valor: p[0], em: new Date() }; return { rows: [] }; }
  if (/update lojas/.test(sql)) { updates.push(p); return { rows: [] }; }
  throw new Error('sql inesperado: ' + sql);
};
globalThis.fetch = async (url, o) => {
  chamadas++;
  const q = JSON.parse(o.body).textQuery;
  const r = Object.entries(respostas).find(([k]) => q.startsWith(k));
  return r ? r[1] : { ok: false, status: 403 };
};
const rev = (rating, texto, autor) => ({ rating, text: { text: texto }, authorAttribution: { displayName: autor, photoUri: 'https://foto/' + autor, uri: 'https://perfil/' + autor }, googleMapsUri: 'https://maps/' + autor });
const ok = places => ({ ok: true, status: 200, json: async () => ({ places }) });
const { avaliacoesGoogle, mesmaLoja } = new Function('query', 'migra', trecho + '; return { avaliacoesGoogle, mesmaLoja };')(query, async () => {});
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };

assert(mesmaLoja('HiperCar', 'Hiper Car Veículos') && mesmaLoja('T.F.A. Motors', 'TFA Motors') && !mesmaLoja('Lazari', 'Oficina do Zé'), 'confere o nome da loja no Google');
delete process.env.GOOGLE_PLACES_KEY;
assert((await avaliacoesGoogle()).length === 0 && chamadas === 0, 'sem chave: não chama o Google');
process.env.GOOGLE_PLACES_KEY = 'x';
respostas = {
  'HiperCar': ok([{ displayName: { text: 'Hiper Car' }, rating: 4.7, userRatingCount: 120, reviews: [rev(5, 'Ótimo atendimento', 'Ana'), rev(2, 'Ruim', 'Bia'), rev(5, '', 'Cris')] }]),
  'T.F.A. Motors': ok([{ displayName: { text: 'TFA Motors' }, rating: 5, userRatingCount: 40, reviews: [rev(4, 'Recomendo', 'Duda')] }]),
  'Lazari': ok([{ displayName: { text: 'Oficina do Zé' }, reviews: [rev(5, 'Outro lugar', 'Edu')] }])
};
let l = await avaliacoesGoogle();
assert(l.map(a => a.autor).join() === 'Ana,Duda', 'só avaliações boas, com texto, da loja certa');
assert(l[0].loja === 'HiperCar' && l[0].link === 'https://maps/Ana' && l[0].foto === 'https://foto/Ana', 'guarda loja, link e foto');
assert(updates.length === 2 && updates[0][1] === 4.7, 'atualiza a nota das lojas achadas');
assert(JSON.parse(config.valor).length === 2, 'guarda no banco');
chamadas = 0; await avaliacoesGoogle(); assert(chamadas === 0, 'dentro de 7 dias não chama o Google de novo');
config.em = new Date(Date.now() - 8 * 864e5); respostas = {}; chamadas = 0;
l = await avaliacoesGoogle();
assert(chamadas === 3 && l.length === 2 && Date.now() - config.em > 7 * 864e5, 'tudo falhou: mantém as antigas e não marca como atualizado');
respostas = { 'T.F.A. Motors': ok([{ displayName: { text: 'TFA Motors' }, reviews: [rev(5, 'Nova', 'Fê')] }]) };
l = await avaliacoesGoogle();
assert(l.map(a => a.autor).sort().join() === 'Ana,Fê', 'falha parcial: loja que falhou fica com as antigas');
