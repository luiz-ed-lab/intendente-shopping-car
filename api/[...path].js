// ============================================================
//  Backend consolidado — Nova Intendente Shopping Car (ACEIMA)
//  Uma única função "pega-tudo" que atende:
//    GET  /api/lojas            -> lista lojas ativas
//    POST /api/lojas            -> cadastra loja
//    PATCH/DELETE /api/lojas    -> edita / remove loja
//    GET  /api/veiculos?...     -> busca de veículos (filtros)
//    POST /api/veiculos         -> mostra/oculta um veículo no site
//    GET/POST /api/leads        -> lista / grava lead
//    GET  /api/importar?loja=ID -> roda o robô (cron de hora em hora)
//
//  O robô lê o SITE PRÓPRIO de cada loja (ex.: autobarra.com.br) e,
//  por compatibilidade, também o portal por ID numérico (Luma Car #285).
// ============================================================
import { Pool } from '@neondatabase/serverless';
import * as cheerio from 'cheerio';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (t, p) => pool.query(t, p);
const PORTAL = 'https://intendenteshoppingcar.com.br';
const pausa = ms => new Promise(r => setTimeout(r, ms));

// garante coluna "oculto" (para o admin esconder um carro sem que a sync o traga de volta)
let migrado = false;
async function migra() {
  if (migrado) return;
  try { await query('alter table veiculos add column if not exists oculto boolean default false'); } catch (_) {}
  try { await query("alter table leads add column if not exists tipo text default 'venda'"); } catch (_) {}
  try { await query('alter table leads add column if not exists detalhes jsonb'); } catch (_) {}
  migrado = true;
}

// envio de e-mail dos leads — pronto para quando a chave do Resend estiver configurada.
// Enquanto não houver RESEND_API_KEY (ou e-mail nas lojas), não faz nada.
async function enviarEmailsLead(lead) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !lead) return;
  let emails = [];
  if (lead.tipo === 'compra') {
    const { rows } = await query("select email from lojas where ativa=true and email is not null and email<>''");
    emails = rows.map(r => r.email);
  } else if (lead.loja_id) {
    const { rows } = await query("select email from lojas where id=$1 and email is not null and email<>''", [lead.loja_id]);
    emails = rows.map(r => r.email);
  }
  if (process.env.ACEIMA_EMAIL) emails.push(process.env.ACEIMA_EMAIL);
  emails = [...new Set(emails.filter(Boolean))];
  if (!emails.length) return;
  const det = lead.detalhes ? (typeof lead.detalhes === 'string' ? JSON.parse(lead.detalhes) : lead.detalhes) : null;
  const assunto = lead.tipo === 'compra'
    ? 'Cliente quer VENDER um veículo — via site Intendente Shopping Car'
    : 'Novo lead de venda — via site Intendente Shopping Car';
  const linhas = [
    'Este é um cliente vindo do site do Intendente Shopping Car.', '',
    'Nome: ' + (lead.cliente_nome || '-'),
    'WhatsApp: ' + (lead.cliente_telefone || '-'),
    lead.cliente_email ? ('E-mail: ' + lead.cliente_email) : null,
    det ? ('Veículo do cliente: ' + [det.marca, det.modelo, det.ano].filter(Boolean).join(' ')
      + (det.km ? (' — ' + det.km + ' km') : '') + (det.valor ? (' — pretende ' + det.valor) : '')
      + (det.fotos ? (' — ' + det.fotos + ' foto(s) enviadas') : '')) : null,
    lead.forma_compra ? ('Forma de compra: ' + lead.forma_compra + (lead.entrada || '')) : null,
    '', 'Mensagem enviada automaticamente pela ACEIMA.'
  ].filter(x => x !== null);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'ACEIMA <leads@intendenteautoshopping.com.br>', to: emails, subject: assunto, text: linhas.join('\n') })
  });
}

// ---------------- utilidades ----------------
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ACEIMA-Importer/1.0 (+contato ACEIMA)' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
  return await r.text();
}
function precoDe(txt) { const m = (txt || '').match(/R\$\s*([\d.]+),/); return m ? parseInt(m[1].replace(/\D/g, '')) : null; }
function intDe(m) { return m ? parseInt(String(m[1]).replace(/\D/g, '')) : null; }
function uniqTexts($, sel) { return [...new Set($(sel).map((_, e) => $(e).text().trim()).get().filter(Boolean))]; }

function parseSlug(slug) {
  const partes = slug.split('-');
  let ano = null;
  if (/^\d{4}$/.test(partes[partes.length - 1])) ano = parseInt(partes.pop());
  const combs = ['flex', 'gasolina', 'diesel', 'alcool', 'eletrico', 'hibrido', 'gnv'];
  let combustivel = null;
  while (partes.length && (combs.includes(partes[partes.length - 1]) || partes[partes.length - 1] === 'e')) {
    const pp = partes.pop();
    if (pp !== 'e') combustivel = pp;
  }
  return {
    modelo: (partes[0] || '').toUpperCase(),
    versao: partes.slice(1).join(' ').toUpperCase(),
    combustivel: combustivel ? combustivel[0].toUpperCase() + combustivel.slice(1) : null,
    ano
  };
}

// decide a origem do estoque a partir do que o admin cadastrou
function fonteDaLoja(chave) {
  const s = String(chave || '').trim();
  if (/^https?:\/\//i.test(s) || /[a-z]\.[a-z]{2,}/i.test(s)) {
    let u = /^https?:\/\//i.test(s) ? s : 'https://' + s;
    let base;
    try { base = new URL(u).origin; } catch (_) { base = u.replace(/\/(index|veiculos).*/i, ''); }
    return { tipo: 'site', base };
  }
  return { tipo: 'portal', base: PORTAL, portalId: s };
}

// pega a logo do site da loja e re-hospeda como data URI (independência); se muito grande, guarda a URL
async function pegarLogo(base, $) {
  let src = null;
  $('img').each((_, e) => {
    if (src) return;
    const s = $(e).attr('src') || '';
    if (/logo/i.test(s) && !/autocerto\.com|whats|facebook|instagram|youtube|icon-|selo|bandeira|pixel/i.test(s)) src = s;
  });
  if (!src) { const a = $('a[href$="/index"], a[href="/"], a[href$="/Index"]').first(); src = a.find('img').attr('src') || null; }
  if (!src) return null;
  try { src = new URL(src, base).href; } catch (_) {}
  try {
    const r = await fetch(src, { headers: { 'User-Agent': 'ACEIMA-Importer/1.0' } });
    if (!r.ok) return src;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || 'image/png';
    if (buf.length && buf.length <= 160000) return `data:${ct};base64,${buf.toString('base64')}`;
    return src;
  } catch (_) { return src; }
}

// ---------------- ROBÔ: site próprio da loja ----------------
async function lerSite(base) {
  const $ = cheerio.load(await get(base + '/Veiculos'));
  const marcas = uniqTexts($, 'a[href*="marca="]').map(t => t.toUpperCase());
  const modelos = uniqTexts($, 'a[href*="modelo="]').map(t => t.toUpperCase()).sort((a, b) => b.length - a.length);
  const vistos = new Set();
  const itens = [];
  $('a[href*="Veiculo/"][href*="detalhes"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const m = href.match(/Veiculo\/([^/]+)\/(\d+)\/detalhes/);
    if (!m) return;
    const id = m[2];
    const titulo = $a.text().trim().replace(/\s+/g, ' ');
    if (!titulo || titulo.length < 3 || /mais detalhes|financiamento/i.test(titulo)) return; // ignora o link da imagem e os botões
    if (vistos.has(id)) return;
    vistos.add(id);
    // sobe até o cartão que contém o preço
    let card = $a;
    for (let k = 0; k < 6; k++) { const pr = card.parent(); if (!pr || !pr.length) break; card = pr; if (/R\$/.test(card.text()) && card.find('img').length) break; }
    const ctxt = card.text().replace(/\s+/g, ' ');
    let img = card.find('img').first().attr('src') || null; if (img && /embreve/i.test(img)) img = null;
    const T = titulo.toUpperCase();
    const marca = marcas.find(x => T.startsWith(x)) || titulo.split(' ')[0].toUpperCase();
    const resto = titulo.slice(marca.length).trim();
    const R = resto.toUpperCase();
    const modelo = modelos.find(x => R.startsWith(x)) || resto.split(' ')[0].toUpperCase();
    const versao = resto.slice(modelo.length).trim();
    const sl = parseSlug(m[1]);
    itens.push({
      anuncioId: id, slug: m[1], img,
      marca, modelo, versao,
      preco: precoDe(ctxt),
      km: intDe(ctxt.match(/Km\s*([\d.]+)/i)),
      cambio: (ctxt.match(/C[âa]mbio\s*([A-Za-zÁ-ÿ]+)/i) || [])[1] || null,
      combustivel: sl.combustivel,
      ano: sl.ano || intDe(ctxt.match(/Ano\s*(\d{4})/i))
    });
  });
  const logo = await pegarLogo(base, $);
  return { itens, logo };
}
// detalhe do site próprio: só enriquece fotos + opcionais
async function detalheSite(base, slug, id) {
  let html; try { html = await get(`${base}/Veiculo/${slug}/${id}/detalhes`); } catch (_) { return {}; }
  const $ = cheerio.load(html);
  const fotos = [...new Set($(`img[src*="/fotos/"][src*="/${id}/"]`).map((_, e) => $(e).attr('src')).get())].filter(u => u && !/embreve/i.test(u));
  if (!fotos.length) return {}; // provavelmente redirecionou (carro vendido) -> mantém dados da lista
  const opcionais = $('.add-features-list li').map((_, e) => $(e).text().trim()).get().filter(Boolean);
  return { fotos, opcionais };
}

// ---------------- ROBÔ: portal Intendente (por ID) ----------------
async function lerPortal(base, portalId) {
  const $ = cheerio.load(await get(`${base}/Loja/x/${portalId}/info`));
  const itens = [];
  $('.result-item').each((_, card) => {
    const $c = $(card);
    const a = $c.find('a[href*="Veiculo/"][href*="detalhes"]').first();
    const m = (a.attr('href') || '').match(/Veiculo\/([^/]+)\/(\d+)\/detalhes/);
    if (!m) return;
    const preco = precoDe($c.find('.price').first().text() + ',');
    const img = $c.find('img').first().attr('src') || null;
    itens.push({ anuncioId: m[2], slug: m[1], preco, img, ...parseSlug(m[1]) });
  });
  return itens;
}
async function detalhePortal(base, slug, id) {
  const $ = cheerio.load(await get(`${base}/Veiculo/${slug}/${id}/detalhes`));
  const cats = $('a[href*="/carros/"][href*="/estoque"]').map((_, e) => $(e).text().trim()).get()
    .filter(t => t && !/voltar ao resultado|veja mais|nova busca|imprimir|buscar/i.test(t));
  const ficha = $('.dados_anuncio').text().replace(/\s+/g, ' ');
  const anos = ficha.match(/Ano\s*(\d{4})\/(\d{4})/i);
  const fotos = [...new Set($(`img[src*="/fotos/"][src*="/${id}/"]`).map((_, e) => $(e).attr('src')).get())].filter(u => u && !/embreve/i.test(u));
  return {
    marca: cats[0] || null, modelo: cats[1] || null,
    km: intDe(ficha.match(/Km\s*(\d+)/i)),
    ano_fabricacao: anos ? parseInt(anos[1]) : null,
    ano_modelo: anos ? parseInt(anos[2]) : null,
    cambio: (ficha.match(/C[aâ]mbio\s*([A-Za-zÁ-ÿ]+)/i) || [])[1] || null,
    combustivel: (ficha.match(/Combust[ií]vel\s*([A-Za-zÁ-ÿ]+)/i) || [])[1] || null,
    opcionais: $('.add-features-list li').map((_, e) => $(e).text().trim()).get().filter(Boolean),
    fotos
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
      `insert into lojas (nome, endereco, telefone, whatsapp, email, autocerto_id, autocerto_url, logo_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [b.nome, b.endereco, b.telefone, b.whatsapp, b.email, b.autocerto_id, b.autocerto_url, b.logo_url || null]);
    return res.status(201).json(loja);
  }
  if (req.method === 'PATCH') {
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    const { rows: [loja] } = await query(
      `update lojas set nome=coalesce($2,nome), endereco=coalesce($3,endereco),
         telefone=coalesce($4,telefone), whatsapp=coalesce($5,whatsapp),
         email=coalesce($6,email), autocerto_id=coalesce($7,autocerto_id),
         logo_url=coalesce($8,logo_url)
       where id=$1 returning *`,
      [b.id, b.nome, b.endereco, b.telefone, b.whatsapp, b.email, b.autocerto_id, b.logo_url || null]);
    return res.json(loja || { erro: 'loja não encontrada' });
  }
  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || (req.body && req.body.id);
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    await query('update veiculos set ativo=false where loja_id=$1', [id]);
    await query('delete from lojas where id=$1', [id]);
    return res.json({ ok: true });
  }
  res.status(405).end();
}

async function rotaVeiculos(req, res) {
  await migra();
  if (req.method === 'POST' || req.method === 'PATCH') {
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    const oculto = b.oculto === true || b.ativo === false;
    const { rows: [v] } = await query('update veiculos set oculto=$2 where id=$1 returning id, oculto', [b.id, oculto]);
    return res.json({ ok: true, veiculo: v });
  }
  const q = req.query || {};
  const cond = ['v.ativo = true', 'coalesce(v.oculto,false) = false']; const p = [];
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
    `select v.*, l.nome as loja_nome, l.whatsapp as loja_whatsapp
       from veiculos v join lojas l on l.id = v.loja_id
      where ${cond.join(' and ')} order by v.sincronizado_em desc limit 500`, p);
  res.json(rows);
}

async function rotaLeads(req, res) {
  await migra();
  if (req.method === 'GET') {
    const { rows } = await query(
      `select le.*, lo.nome as loja_nome,
              case when v.id is not null then (v.marca || ' ' || v.modelo)
                   when le.detalhes is not null then (coalesce(le.detalhes->>'marca','') || ' ' || coalesce(le.detalhes->>'modelo',''))
                   else null end as veiculo_nome
         from leads le
         left join lojas lo on lo.id = le.loja_id
         left join veiculos v on v.id = le.veiculo_id
        order by le.criado_em desc limit 300`);
    return res.json(rows);
  }
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  const { rows: [lead] } = await query(
    `insert into leads (loja_id, veiculo_id, cliente_nome, cliente_telefone, cliente_email, forma_compra, entrada, canal, tipo, detalhes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [b.loja_id || null, b.veiculo_id || null, b.cliente_nome, b.cliente_telefone, b.cliente_email,
     b.forma_compra, b.entrada, b.canal || 'formulario', b.tipo || 'venda', b.detalhes ? JSON.stringify(b.detalhes) : null]);
  enviarEmailsLead(lead).catch(() => {});
  res.status(201).json({ ok: true, lead });
}

async function rotaImportar(req, res) {
  await migra();
  const soLoja = req.query.loja;
  const { rows: lojas } = soLoja
    ? await query('select * from lojas where ativa = true and id = $1', [soLoja])
    : await query('select * from lojas where ativa = true');
  const resultado = [];
  for (const loja of lojas) {
    const chave = loja.autocerto_url || loja.autocerto_id;
    if (!chave) { resultado.push({ loja: loja.nome, erro: 'sem site/ID cadastrado' }); continue; }
    try {
      const fonte = fonteDaLoja(chave);
      let itens, logoSite = null;
      if (fonte.tipo === 'site') { const r = await lerSite(fonte.base); itens = r.itens; logoSite = r.logo; }
      else { itens = await lerPortal(fonte.base, fonte.portalId); }
      if (logoSite && !loja.logo_url) { try { await query('update lojas set logo_url = $1 where id = $2', [logoSite, loja.id]); } catch (_) {} }
      await query('update veiculos set ativo = false where loja_id = $1', [loja.id]);
      for (const it of itens) {
        let extra = {};
        try {
          extra = fonte.tipo === 'site'
            ? await detalheSite(fonte.base, it.slug, it.anuncioId)
            : await detalhePortal(fonte.base, it.slug, it.anuncioId);
          await pausa(120);
        } catch (_) {}
        const fotos = (extra.fotos && extra.fotos.length) ? extra.fotos : (it.img ? [it.img] : []);
        await query(
          `insert into veiculos (loja_id, autocerto_id, marca, modelo, versao, ano_fabricacao, ano_modelo, km, preco, cambio, combustivel, opcionais, fotos, ativo, sincronizado_em)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,now())
           on conflict (loja_id, autocerto_id) do update set
             marca=excluded.marca, modelo=excluded.modelo, versao=excluded.versao,
             ano_fabricacao=excluded.ano_fabricacao, ano_modelo=excluded.ano_modelo,
             km=excluded.km, preco=excluded.preco, cambio=excluded.cambio,
             combustivel=excluded.combustivel, opcionais=excluded.opcionais,
             fotos=excluded.fotos, ativo=true, sincronizado_em=now()`,
          [loja.id, it.anuncioId,
           it.marca || extra.marca || null,
           it.modelo || extra.modelo || null,
           it.versao || null,
           extra.ano_fabricacao || null,
           it.ano || extra.ano_modelo || null,
           (it.km != null ? it.km : extra.km) || null,
           it.preco != null ? it.preco : null,
           it.cambio || extra.cambio || null,
           it.combustivel || extra.combustivel || null,
           extra.opcionais || [], fotos]);
      }
      resultado.push({ loja: loja.nome, veiculos: itens.length });
      await pausa(500);
    } catch (e) { resultado.push({ loja: loja.nome, erro: e.message }); }
  }
  res.json({ ok: true, lojas: resultado });
}

// ---------------- ROTEADOR ----------------
export default async function handler(req, res) {
  let rota;
  const p = req.query && req.query.path;
  if (Array.isArray(p)) rota = p[0];
  else if (typeof p === 'string' && p) rota = p;
  if (!rota) {
    try { rota = new URL(req.url, 'http://x').pathname.replace(/^\/api\//, '').split('/').filter(Boolean)[0]; } catch (_) {}
  }
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
