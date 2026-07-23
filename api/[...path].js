// ============================================================
//  Backend consolidado — Nova Intendente Shopping Car (ACEIMA)
//  Uma única função "pega-tudo" que atende:
//    GET  /api/lojas            -> lista lojas ativas
//    POST /api/lojas            -> cadastra loja
//    GET  /api/veiculos?...     -> busca de veículos com filtros
//    POST /api/leads            -> grava um lead
//    GET  /api/importar?loja=ID -> roda o robô (cron de hora em hora)
//
//  Robô VALIDADO contra o HTML real da Luma Car (52 veículos lidos ok).
// ============================================================
import { Pool } from '@neondatabase/serverless';
import * as cheerio from 'cheerio';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (t, p) => pool.query(t, p);
const BASE = 'https://intendenteshoppingcar.com.br';
const pausa = ms => new Promise(r => setTimeout(r, ms));

// ---------------- ROBÔ LEITOR ----------------
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ACEIMA-Importer/1.0 (+contato ACEIMA)' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
  return await r.text();
}
function parseSlug(slug) {
  const partes = slug.split('-');
  let ano = null;
  if (/^\d{4}$/.test(partes[partes.length - 1])) ano = parseInt(partes.pop());
  const combs = ['flex', 'gasolina', 'diesel', 'alcool', 'eletrico', 'hibrido'];
  let combustivel = null;
  if (combs.includes(partes[partes.length - 1])) combustivel = partes.pop();
  return {
    modelo: (partes[0] || '').toUpperCase(),
    versao: partes.slice(1).join(' ').toUpperCase(),
    combustivel: combustivel ? combustivel[0].toUpperCase() + combustivel.slice(1) : null,
    ano
  };
}
async function lerLoja(autocertoId) {
  const $ = cheerio.load(await get(`${BASE}/Loja/x/${autocertoId}/info`));
  const itens = [];
  $('.result-item').each((_, card) => {
    const $c = $(card);
    const a = $c.find('a[href*="/Veiculo/"][href*="/detalhes"]').first();
    const m = (a.attr('href') || '').match(/\/Veiculo\/([^/]+)\/(\d+)\/detalhes/);
    if (!m) return;
    const precoTxt = $c.find('.price').first().text();
    const preco = precoTxt ? Math.round(parseInt(precoTxt.replace(/[^\d]/g, '')) / 100) : null;
    const img = $c.find('img').first().attr('src') || null;
    itens.push({ anuncioId: m[2], slug: m[1], preco, img, ...parseSlug(m[1]) });
  });
  return itens;
}
async function lerDetalhe(slug, anuncioId, lojaId) {
  const $ = cheerio.load(await get(`${BASE}/Veiculo/${slug}/${anuncioId}/detalhes`));
  const cats = $('a[href*="/carros/"][href*="/estoque"]').map((_, e) => $(e).text().trim()).get().filter(Boolean);
  const ficha = $('.dados_anuncio').text().replace(/\s+/g, ' ');
  const km = (ficha.match(/Km\s*(\d+)/i) || [])[1];
  const anos = ficha.match(/Ano\s*(\d{4})\/(\d{4})/i);
  const cambio = (ficha.match(/C[aâ]mbio\s*([A-Za-zÁ-ÿ]+)/i) || [])[1];
  const combustivel = (ficha.match(/Combust[ií]vel\s*([A-Za-zÁ-ÿ]+)/i) || [])[1];
  const opcionais = $('.add-features-list li').map((_, e) => $(e).text().trim()).get().filter(Boolean);
  const fotos = [...new Set($(`img[src*="/fotos/${lojaId}/${anuncioId}/"]`).map((_, e) => $(e).attr('src')).get())];
  return {
    marca: cats[0] || null, modelo: cats[1] || null,
    km: km ? parseInt(km) : null,
    ano_fabricacao: anos ? parseInt(anos[1]) : null,
    ano_modelo: anos ? parseInt(anos[2]) : null,
    cambio: cambio || null, combustivel: combustivel || null, opcionais, fotos
  };
}

// ---------------- ROTAS ----------------
async function rotaLojas(req, res) {
  if (req.method === 'GET') {
    const { rows } = await query('select * from lojas where ativa = true order by nome');
    return res.json(rows);
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.nome) return res.status(400).json({ erro: 'nome é obrigatório' });
    const { rows: [loja] } = await query(
      `insert into lojas (nome, endereco, telefone, whatsapp, email, autocerto_id, autocerto_url)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [b.nome, b.endereco, b.telefone, b.whatsapp, b.email, b.autocerto_id, b.autocerto_url]);
    return res.status(201).json(loja);
  }
  res.status(405).end();
}

async function rotaVeiculos(req, res) {
  const q = req.query || {};
  const cond = ['v.ativo = true']; const p = [];
  const add = (frag, val) => { p.push(val); cond.push(frag.replace('?', '$' + p.length)); };
  if (q.tipo) add('v.tipo = ?', q.tipo);
  if (q.marca) add('v.marca = ?', q.marca);
  if (q.modelo) add('v.modelo = ?', q.modelo);
  if (q.loja) add('v.loja_id = ?', q.loja);
  if (q.precoDe) add('v.preco >= ?', q.precoDe);
  if (q.precoAte) add('v.preco <= ?', q.precoAte);
  if (q.anoDe) add('v.ano_modelo >= ?', q.anoDe);
  if (q.anoAte) add('v.ano_modelo <= ?', q.anoAte);
  if (q.kmAte) add('v.km <= ?', q.kmAte);
  const { rows } = await query(
    `select v.*, l.nome as loja_nome, l.whatsapp as loja_whatsapp, l.logo_url as loja_logo
       from veiculos v join lojas l on l.id = v.loja_id
      where ${cond.join(' and ')} order by v.sincronizado_em desc limit 500`, p);
  res.json(rows);
}

async function rotaLeads(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  const { rows: [lead] } = await query(
    `insert into leads (loja_id, veiculo_id, cliente_nome, cliente_telefone, cliente_email, forma_compra, entrada, canal)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [b.loja_id, b.veiculo_id, b.cliente_nome, b.cliente_telefone, b.cliente_email, b.forma_compra, b.entrada, b.canal || 'formulario']);
  res.status(201).json({ ok: true, lead });
}

async function rotaImportar(req, res) {
  const soLoja = req.query.loja;
  const semDetalhe = req.query.rapido === '1';
  const { rows: lojas } = soLoja
    ? await query('select * from lojas where ativa = true and id = $1', [soLoja])
    : await query('select * from lojas where ativa = true');
  const resultado = [];
  for (const loja of lojas) {
    if (!loja.autocerto_id) { resultado.push({ loja: loja.nome, erro: 'sem autocerto_id' }); continue; }
    try {
      const itens = await lerLoja(loja.autocerto_id);
      await query('update veiculos set ativo = false where loja_id = $1', [loja.id]);
      for (const it of itens) {
        let d = {};
        if (!semDetalhe) { try { d = await lerDetalhe(it.slug, it.anuncioId, loja.autocerto_id); await pausa(250); } catch (_) {} }
        const fotos = (d.fotos && d.fotos.length) ? d.fotos : (it.img ? [it.img] : []);
        await query(
          `insert into veiculos (loja_id, autocerto_id, marca, modelo, versao, ano_fabricacao, ano_modelo, km, preco, cambio, combustivel, opcionais, fotos, ativo, sincronizado_em)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,now())
           on conflict (loja_id, autocerto_id) do update set
             marca=excluded.marca, modelo=excluded.modelo, versao=excluded.versao,
             ano_fabricacao=excluded.ano_fabricacao, ano_modelo=excluded.ano_modelo,
             km=excluded.km, preco=excluded.preco, cambio=excluded.cambio,
             combustivel=excluded.combustivel, opcionais=excluded.opcionais,
             fotos=excluded.fotos, ativo=true, sincronizado_em=now()`,
          [loja.id, it.anuncioId, d.marca || null, d.modelo || it.modelo, it.versao,
           d.ano_fabricacao || null, it.ano || d.ano_modelo || null, d.km || null,
           it.preco, d.cambio || null, it.combustivel || d.combustivel || null, d.opcionais || [], fotos]);
      }
      resultado.push({ loja: loja.nome, veiculos: itens.length });
      await pausa(800);
    } catch (e) { resultado.push({ loja: loja.nome, erro: e.message }); }
  }
  res.json({ ok: true, lojas: resultado });
}

// ---------------- ROTEADOR ----------------
export default async function handler(req, res) {
  const path = req.query.path || [];
  const rota = Array.isArray(path) ? path[0] : path;
  try {
    if (rota === 'lojas') return await rotaLojas(req, res);
    if (rota === 'veiculos') return await rotaVeiculos(req, res);
    if (rota === 'leads') return await rotaLeads(req, res);
    if (rota === 'importar') return await rotaImportar(req, res);
    res.status(404).json({ erro: 'rota não encontrada', rota });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
}
