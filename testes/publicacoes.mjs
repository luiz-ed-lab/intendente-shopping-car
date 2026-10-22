// Confere a rota /api/publicacoes (a parte das publicações no painel) sem tocar no GitHub de verdade.
// Rodar: node testes/publicacoes.mjs
import fs from 'fs';
const src = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const trecho = src.slice(src.indexOf('const CATEGORIAS_PUB'), src.indexOf('// ---------------- AVALIAÇÕES DO GOOGLE'));
const criar = new Function('return (async()=>{' + trecho + '; return rotaPublicacoes;})()');
const assert = (c, m) => { if (!c) { console.log('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };
Object.assign(process.env, { GITHUB_TOKEN: 'x', VERCEL_GIT_COMMIT_REF: 'site-novo', VERCEL_GIT_REPO_OWNER: 'luiz-ed-lab', VERCEL_GIT_REPO_SLUG: 'intendente-shopping-car' });
const res = () => { const r = { code: 200 }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); return r; };

// um repositório de mentira: os arquivos do último commit e os blobs criados
const repo = { head: 'c0', arquivos: {}, blobs: {}, commits: [], recusarRef: 0 };
let n = 0;
const resp = (status, corpo) => ({ ok: status < 300, status, json: async () => corpo });
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), cam = u.pathname.replace('/repos/luiz-ed-lab/intendente-shopping-car/', ''), m = o.method || 'GET';
  const corpo = o.body ? JSON.parse(o.body) : null;
  if (m === 'GET' && cam === 'contents/publicacoes.json') {
    const c = repo.arquivos['publicacoes.json'];
    return c ? resp(200, { content: c, sha: 'arq' }) : resp(404, {});
  }
  if (m === 'GET' && cam === 'git/ref/heads/site-novo') return resp(200, { object: { sha: repo.head } });
  if (m === 'GET' && cam.startsWith('git/commits/')) return resp(200, { tree: { sha: 'arvore-' + cam.split('/').pop() } });
  if (m === 'POST' && cam === 'git/blobs') { const sha = 'b' + (++n); repo.blobs[sha] = corpo.content; return resp(201, { sha }); }
  if (m === 'POST' && cam === 'git/trees') { repo.arvore = corpo; return resp(201, { sha: 't' + (++n) }); }
  if (m === 'POST' && cam === 'git/commits') { repo.commit = corpo; return resp(201, { sha: 'c' + (++n) }); }
  if (m === 'PATCH' && cam === 'git/refs/heads/site-novo') {
    if (repo.recusarRef > 0) { repo.recusarRef--; return resp(422, { message: 'Update is not a fast forward' }); }
    // o commit entra: a árvore nova vale para os próximos pedidos
    for (const e of repo.arvore.tree) { if (e.sha === null) delete repo.arquivos[e.path]; else repo.arquivos[e.path] = repo.blobs[e.sha]; }
    repo.head = corpo.sha; repo.commits.push(repo.commit.message); return resp(200, {});
  }
  return resp(500, { erro: 'pedido inesperado ' + m + ' ' + cam });
};
const lista = () => JSON.parse(Buffer.from(repo.arquivos['publicacoes.json'], 'base64').toString('utf8'));
const f = await criar();
const post = async b => { const r = res(); await f({ method: 'POST', body: b }, r); return r; };

let r = res(); await f({ method: 'GET' }, r);
assert(r.body.ok && Array.isArray(r.body.publicacoes) && !r.body.publicacoes.length, 'GET sem o arquivo devolve a lista vazia');

r = await post({ acao: 'salvar', pub: { titulo: 'Mutirão de vistoria na Intendente', categoria: 'Ações no polo', data: '2026-10-10', resumo: ' Resumo ', texto: 'Linha 1\r\n\r\nLinha 2' } });
assert(r.code === 200 && r.body.ok, 'cria a primeira publicação');
assert(r.body.publicacao.id === '2026-10-10-mutirao-de-vistoria-na-intendente', 'o id vem da data e do título, sem acento');
assert(r.body.publicacao.resumo === 'Resumo' && r.body.publicacao.texto === 'Linha 1\n\nLinha 2', 'limpa espaços e o \\r do texto');
assert(repo.arvore.tree.length === 1 && repo.arvore.tree[0].path === 'publicacoes.json' && repo.arvore.base_tree === 'arvore-c0', 'um commit só, com a lista, em cima do commit atual');
assert(repo.commits.pop() === 'Publicações: nova "Mutirão de vistoria na Intendente"', 'mensagem do commit');

const foto = 'data:image/webp;base64,' + Buffer.from('foto-de-teste').toString('base64');
r = await post({ acao: 'salvar', pub: { titulo: 'Conquista nova', categoria: 'Conquistas', data: '2026-10-12', destaque: true }, foto });
const nova = r.body.publicacao;
assert(/^fotos-publicacoes\/2026-10-12-conquista-nova-[a-z0-9]+\.webp$/.test(nova.foto), 'a foto vai para fotos-publicacoes/ com o id no nome');
assert(repo.arvore.tree.length === 2 && Buffer.from(repo.arquivos[nova.foto], 'base64').toString() === 'foto-de-teste', 'a foto e a lista no mesmo commit');
assert(lista()[0].id === nova.id, 'a mais nova vem primeiro');

r = await post({ acao: 'salvar', pub: { titulo: 'Conquista nova', categoria: 'Conquistas', data: '2026-10-12' } });
assert(r.body.publicacao.id === '2026-10-12-conquista-nova-2', 'título repetido ganha outro id');

// editar: troca a foto (a velha sai do site), passa o destaque e deixa de ser exemplo
repo.arquivos['publicacoes.json'] = Buffer.from(JSON.stringify(lista().map(x => x.id === '2026-10-10-mutirao-de-vistoria-na-intendente' ? { ...x, exemplo: true } : x))).toString('base64');
const foto2 = 'data:image/jpeg;base64,' + Buffer.from('outra').toString('base64');
r = await post({ acao: 'salvar', pub: { id: '2026-10-10-mutirao-de-vistoria-na-intendente', titulo: 'Mutirão editado', categoria: 'Ações no polo', data: '2026-10-10', destaque: true }, foto: foto2 });
let l = lista(), ed = l.find(x => x.id === '2026-10-10-mutirao-de-vistoria-na-intendente');
assert(ed && ed.titulo === 'Mutirão editado' && !('exemplo' in ed), 'edita mantendo o id e deixa de ser exemplo');
assert(ed.destaque && l.filter(x => x.destaque).length === 1, 'um destaque só');
assert(/\.jpg$/.test(ed.foto), 'foto jpg vira .jpg');
r = await post({ acao: 'salvar', pub: { id: nova.id, titulo: 'Conquista nova', categoria: 'Conquistas', data: '2026-10-12' }, foto: foto2 });
assert(repo.arvore.tree.some(e => e.path === nova.foto && e.sha === null) && !(nova.foto in repo.arquivos), 'foto trocada: a velha sai do site');
const comFoto = lista().find(x => x.id === nova.id).foto;
r = await post({ acao: 'salvar', pub: { id: nova.id, titulo: 'Conquista nova', categoria: 'Conquistas', data: '2026-10-12' }, tirarFoto: true });
assert(lista().find(x => x.id === nova.id).foto === null && !(comFoto in repo.arquivos), 'tirar a foto apaga o arquivo');

// excluir apaga a publicação e a foto dela
const fotoEd = ed.foto;
r = await post({ acao: 'excluir', id: ed.id });
assert(r.body.ok && !lista().some(x => x.id === ed.id) && !(fotoEd in repo.arquivos), 'exclui a publicação e a foto');
assert(repo.commits.pop() === 'Publicações: excluída "Mutirão editado"', 'mensagem da exclusão');

// outro commit entrou no meio: refaz em cima dele
repo.recusarRef = 1;
r = await post({ acao: 'salvar', pub: { titulo: 'Comunicado da diretoria', categoria: 'Comunicados', data: '2026-09-01' } });
assert(r.body.ok && lista().some(x => x.titulo === 'Comunicado da diretoria'), 'refaz quando o ramo mudou no meio');
assert(lista().map(x => x.data).join() === [...lista().map(x => x.data)].sort().reverse().join(), 'a lista fica da mais nova para a mais antiga');

r = await post({ acao: 'salvar', pub: { titulo: '  ' } }); assert(r.code === 400, 'sem título não grava');
r = await post({ acao: 'salvar', pub: { titulo: 'X' }, foto: 'data:text/html;base64,PGI+' }); assert(r.code === 400, 'recusa arquivo que não é foto');
r = await post({ acao: 'salvar', pub: { id: 'nao-existe', titulo: 'X' } }); assert(r.code === 404, 'editar uma que não existe');
r = await post({ acao: 'apagar-tudo' }); assert(r.code === 400, 'ação desconhecida');
r = await post({ acao: 'salvar', pub: { titulo: 'Categoria estranha', categoria: '<script>' } });
assert(r.body.publicacao.categoria === 'Ações no polo', 'categoria fora da lista vira a primeira');

// várias fotos (21/10/2026): a primeira é a capa; as que saem somem do site e as que ficam continuam
const fa = 'data:image/webp;base64,' + Buffer.from('foto-a').toString('base64'), fb = 'data:image/webp;base64,' + Buffer.from('foto-b').toString('base64');
r = await post({ acao: 'salvar', pub: { titulo: 'Galeria', categoria: 'Ações no polo', data: '2026-10-20' }, fotos: [{ nova: fa }, { nova: fb }] });
let gal = r.body.publicacao;
assert(gal.fotos.length === 2 && gal.foto === gal.fotos[0] && /-1\.webp$/.test(gal.fotos[0]) && /-2\.webp$/.test(gal.fotos[1]), 'várias fotos, a primeira é a capa');
assert(Buffer.from(repo.arquivos[gal.fotos[1]], 'base64').toString() === 'foto-b', 'as fotos novas no mesmo commit');
const [g1, g2] = gal.fotos;
r = await post({ acao: 'salvar', pub: { id: gal.id, titulo: 'Galeria', categoria: 'Ações no polo', data: '2026-10-20' }, fotos: [{ caminho: g2 }, { nova: fa }] });
gal = r.body.publicacao;
assert(gal.fotos[0] === g2 && gal.foto === g2 && gal.fotos.length === 2, 'troca a capa e acrescenta outra');
assert(!(g1 in repo.arquivos) && (g2 in repo.arquivos), 'a foto tirada sai do site e a que ficou continua');
r = await post({ acao: 'salvar', pub: { id: gal.id, titulo: 'Galeria', categoria: 'Ações no polo', data: '2026-10-20' }, fotos: [] });
assert(r.body.publicacao.foto === null && !r.body.publicacao.fotos.length && !gal.fotos.some(f => f in repo.arquivos), 'sem fotos: todas saem');
r = await post({ acao: 'salvar', pub: { titulo: 'X' }, fotos: [{ nova: 'data:text/html;base64,PGI+' }] }); assert(r.code === 400, 'recusa arquivo que não é foto na lista');
r = await post({ acao: 'excluir', id: gal.id }); assert(r.body.ok, 'exclui a galeria');
delete process.env.GITHUB_TOKEN;
r = res(); await f({ method: 'GET' }, r); assert(r.code === 500 && /GITHUB_TOKEN/.test(r.body.erro), 'sem GITHUB_TOKEN avisa em vez de gravar');
