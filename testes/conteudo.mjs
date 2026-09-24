// Confere a rota /api/conteudo (modo de edição) sem tocar no GitHub de verdade.
// Rodar: node testes/conteudo.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('const CAMPOS_CONTEUDO'), src.indexOf('// ---------------- ROTEADOR'));
const rotaConteudo = new Function('return (async()=>{' + trecho + '; return rotaConteudo;})()');
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };
Object.assign(process.env, { GITHUB_TOKEN: 'x', VERCEL_GIT_COMMIT_REF: 'site-novo', VERCEL_GIT_REPO_OWNER: 'luiz-ed-lab', VERCEL_GIT_REPO_SLUG: 'intendente-shopping-car' });
const res = () => { const r = { code: 200 }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); return r; };
let arquivo = null, puts = [];
globalThis.fetch = async (url, o = {}) => {
  if (!o.method) return arquivo ? { ok: true, status: 200, json: async () => ({ sha: 'abc', content: Buffer.from(arquivo).toString('base64') }) } : { ok: false, status: 404 };
  puts.push({ url, ...JSON.parse(o.body) }); return { ok: true, status: 200 };
};
const f = await rotaConteudo();
let r = res(); await f({ method: 'GET' }, r); assert(r.body.pronto === true && r.body.ramo === 'site-novo', 'GET informa ramo e pronto');
// arquivo ainda não existe: cria sem sha
r = res(); await f({ method: 'POST', body: { mudancas: { 'inicio.titulo': { texto: 'Olá {lojas}', cor: '#FFFFFF', lixo: 1 } } } }, r);
let p = puts.pop(); let txt = Buffer.from(p.content, 'base64').toString();
assert(r.body.ok && !p.sha && p.branch === 'site-novo', 'cria o arquivo no ramo certo');
assert(p.url.endsWith('/repos/luiz-ed-lab/intendente-shopping-car/contents/conteudo.js'), 'repositório certo');
let obj = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
assert(obj['inicio.titulo'].texto === 'Olá {lojas}' && !('lixo' in obj['inicio.titulo']), 'grava só campos conhecidos, com chaves {}');
// arquivo existe: junta com o que já tinha e apaga com null
arquivo = txt;
r = res(); await f({ method: 'POST', body: { mudancas: { 'aceima.titulo': { texto: 'X' }, 'inicio.titulo': null, 'mal id': { texto: 'y' } } } }, r);
p = puts.pop(); txt = Buffer.from(p.content, 'base64').toString(); obj = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
assert(p.sha === 'abc', 'usa o sha da versão atual');
assert(obj['aceima.titulo'].texto === 'X' && !('inicio.titulo' in obj) && !('mal id' in obj), 'junta, apaga com null e ignora id inválido');
assert(p.message === 'Modo de edição: aceima.titulo, inicio.titulo', 'mensagem do commit lista os textos');
// o arquivo gravado é JS válido que o site carrega
globalThis.window = {}; new Function(txt)(); assert(window.CONTEUDO['aceima.titulo'].texto === 'X', 'conteudo.js gravado roda no navegador');
delete process.env.GITHUB_TOKEN;
r = res(); await f({ method: 'POST', body: { mudancas: {} } }, r); assert(r.code === 500 && /GITHUB_TOKEN/.test(r.body.erro), 'sem GITHUB_TOKEN avisa em vez de gravar');
