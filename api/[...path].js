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
  try { await query("alter table leads add column if not exists status text default 'novo'"); } catch (_) {}
  try { await query('alter table lojas add column if not exists ultima_sync timestamptz'); } catch (_) {}
  try { await query('alter table lojas add column if not exists ultimo_erro text'); } catch (_) {}
  try { await query('create table if not exists config (chave text primary key, valor text, em timestamptz default now())'); } catch (_) {}
  // quando o veículo entrou no nosso site (para contar novos/saíram no resumo)
  try { await query('alter table veiculos add column if not exists criado_em timestamptz'); } catch (_) {}
  try { await query('update veiculos set criado_em = coalesce(sincronizado_em, now()) where criado_em is null'); } catch (_) {}
  try { await query('alter table veiculos alter column criado_em set default now()'); } catch (_) {}
  migrado = true;
}
const ACEIMA_MAIL = process.env.ACEIMA_EMAIL || 'aceima.adm2026@gmail.com';
// Enquanto o domínio não estiver verificado no Resend, usa o remetente de teste dele
// (que só entrega para o e-mail do dono da conta). Depois, basta criar a variável
// RESEND_FROM no Vercel com: ACEIMA <leads@intendenteautoshopping.com.br>
const REMETENTE = process.env.RESEND_FROM || 'ACEIMA <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://intendente-shopping-car.vercel.app';

// ---------------- MODELO VISUAL DOS E-MAILS ----------------
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function linhaInfo(rotulo, valor, destaque) {
  if (valor == null || valor === '') return '';
  return `<tr>
    <td style="padding:11px 0;border-bottom:1px solid #f1e8e5;font:600 12px/1.2 Arial,sans-serif;color:#94867f;text-transform:uppercase;letter-spacing:.6px;width:42%">${esc(rotulo)}</td>
    <td style="padding:11px 0;border-bottom:1px solid #f1e8e5;font:${destaque ? '700 17px' : '400 15px'}/1.4 Arial,sans-serif;color:${destaque ? '#d3372a' : '#241b19'}">${valor}</td>
  </tr>`;
}
function emailLayout({ etiqueta, titulo, subtitulo, tabela, botao, aviso, rodape }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @media only screen and (max-width:600px){
      .pad{padding-left:16px!important;padding-right:16px!important}
      .card{display:block!important;width:100%!important;padding:0 0 8px 0!important}
      .h1{font-size:19px!important}
      .cta{display:block!important;text-align:center!important}
      .num{font-size:22px!important}
      .col-min{font-size:12px!important}
      .esconde{display:none!important}
    }
  </style></head><body style="margin:0;padding:0;background:#f5f3f2;-webkit-text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
   <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff">
      <tr><td class="pad" style="background:#7a1a10;padding:20px 26px">
        <img src="${SITE_URL}/logo.png" alt="Nova Intendente Shopping Car" width="160" style="display:block;border:0;width:160px;max-width:60%;height:auto">
      </td></tr>
      <tr><td class="pad" style="padding:24px 26px 4px">
        ${etiqueta ? `<div style="display:inline-block;background:#fdeede;color:#c2410c;font:700 11px/1 Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase;padding:7px 12px;border-radius:99px;margin-bottom:14px">${esc(etiqueta)}</div>` : ''}
        <h1 class="h1" style="margin:0;font:700 22px/1.3 Arial,sans-serif;color:#280a06">${esc(titulo)}</h1>
        ${subtitulo ? `<p style="margin:8px 0 0;font:400 14px/1.6 Arial,sans-serif;color:#6b5a55">${esc(subtitulo)}</p>` : ''}
      </td></tr>
      ${tabela ? `<tr><td class="pad" style="padding:14px 26px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tabela}</table></td></tr>` : ''}
      ${aviso ? `<tr><td class="pad" style="padding:16px 26px 0"><div style="background:#fdf4f2;border:1px solid #f5ddd6;border-radius:12px;padding:14px 16px;font:400 13px/1.6 Arial,sans-serif;color:#94564c">${aviso}</div></td></tr>` : ''}
      ${botao ? `<tr><td class="pad" style="padding:22px 26px 26px"><a class="cta" href="${botao.url}" style="display:inline-block;background:#25a35a;color:#ffffff;font:700 15px/1 Arial,sans-serif;text-decoration:none;padding:15px 26px;border-radius:10px">${esc(botao.texto)}</a></td></tr>` : ''}
      ${rodape ? `<tr><td class="pad" style="padding:0 26px 26px">
        <div style="border-top:1px solid #f1e8e5;padding-top:16px;font:400 12px/1.7 Arial,sans-serif;color:#94867f">${rodape}</div>
      </td></tr>` : ''}
    </table>
   </td></tr>
  </table></body></html>`;
}
// blocos reutilizáveis do resumo
function tituloSecao(txt, margemTopo) {
  return `<tr><td style="padding:${margemTopo || 22}px 0 10px"><div style="font:700 12px/1 Arial,sans-serif;color:#b6a9a3;letter-spacing:1px;text-transform:uppercase">${esc(txt)}</div></td></tr>`;
}
function cartoes(itens) {
  return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${itens.map(c => `
    <td class="card" width="${Math.floor(100 / itens.length)}%" valign="top" style="padding:0 4px">
      <div style="background:#faf7f6;border:1px solid #f1e8e5;border-radius:12px;padding:14px 12px;text-align:center">
        <div class="num" style="font:700 26px/1 Arial,sans-serif;color:${c.cor}">${c.valor}</div>
        <div style="font:600 11px/1.35 Arial,sans-serif;color:#94867f;text-transform:uppercase;letter-spacing:.4px;margin-top:6px">${esc(c.rotulo)}</div>
      </div></td>`).join('')}</tr></table></td></tr>`;
}
function tabelaDados(colunas, linhas, vazio) {
  const th = colunas.map((c, i) => `<th align="${i === 0 ? 'left' : 'center'}" class="${i > 3 ? 'esconde' : ''}" style="padding:0 6px 8px;font:700 11px/1.2 Arial,sans-serif;color:#b6a9a3;text-transform:uppercase;letter-spacing:.5px">${esc(c)}</th>`).join('');
  const tr = linhas.length ? linhas.map(l => `<tr>${l.map((cel, i) => `
      <td align="${i === 0 ? 'left' : 'center'}" class="${i > 3 ? 'esconde' : ''} col-min" style="padding:11px 6px;border-top:1px solid #f4eeec;font:${i === 0 ? '700' : '400'} 13px/1.4 Arial,sans-serif;color:${i === 0 ? '#241b19' : '#5f5e5a'}">${cel}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${colunas.length}" style="padding:14px 6px;border-top:1px solid #f4eeec;font:400 13px/1.4 Arial,sans-serif;color:#94867f">${esc(vazio || 'Nada por aqui.')}</td></tr>`;
  return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th}</tr>${tr}</table></td></tr>`;
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
  emails.push(ACEIMA_MAIL);
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

  const tel = String(lead.cliente_telefone || '').replace(/\D/g, '');
  const telBonito = tel.length >= 10
    ? '(' + tel.slice(-11, -9) + ') ' + tel.slice(-9, -4) + '-' + tel.slice(-4)
    : (lead.cliente_telefone || '—');
  const carroCliente = det ? [det.marca, det.modelo, det.ano].filter(Boolean).join(' ') : null;
  const compra = lead.tipo === 'compra';

  const tabela = [
    linhaInfo('Cliente', esc(lead.cliente_nome), true),
    linhaInfo('WhatsApp', `<a href="https://wa.me/${tel.length > 11 ? tel : '55' + tel}" style="color:#25a35a;text-decoration:none;font-weight:700">${esc(telBonito)}</a>`),
    linhaInfo('E-mail', lead.cliente_email ? `<a href="mailto:${esc(lead.cliente_email)}" style="color:#241b19;text-decoration:none">${esc(lead.cliente_email)}</a>` : ''),
    compra
      ? linhaInfo('Veículo do cliente', esc(carroCliente || '—'))
      : linhaInfo('Veículo de interesse', esc(lead.veiculo_nome || '—')),
    compra ? linhaInfo('Quilometragem', det && det.km ? esc(det.km) + ' km' : '') : '',
    compra ? linhaInfo('Valor pretendido', det && det.valor ? 'R$ ' + esc(det.valor) : '') : '',
    compra ? linhaInfo('Fotos enviadas', det && det.fotos ? esc(det.fotos) + ' foto(s)' : '') : '',
    !compra ? linhaInfo('Forma de compra', lead.forma_compra ? esc(lead.forma_compra + (lead.entrada || '')) : '') : ''
  ].join('');

  const html = emailLayout({
    etiqueta: compra ? 'Cliente quer vender' : 'Novo cliente interessado',
    titulo: compra ? 'Um cliente quer vender o veículo dele' : 'Novo contato pelo site',
    subtitulo: compra
      ? 'Este cliente preencheu o formulário de avaliação no site do Intendente Shopping Car e está aberto a propostas.'
      : 'Este cliente veio do site do Intendente Shopping Car e se interessou por um veículo da sua loja.',
    tabela,
    botao: tel ? { url: 'https://wa.me/' + (tel.length > 11 ? tel : '55' + tel), texto: 'Falar com o cliente no WhatsApp' } : null,
    aviso: '<b>Fale logo com ele.</b> Cliente que recebe resposta rápida fecha mais — e a ACEIMA acompanha o atendimento de cada contato.',
    rodape: 'Contato gerado pelo site do Intendente Shopping Car e repassado pela ACEIMA.<br>Uma cópia foi enviada à associação.'
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: REMETENTE, to: emails, subject: assunto, text: linhas.join('\n'), html })
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

// dados de contato da loja lidos do próprio site (endereço, telefone, WhatsApp)
function pegarContato($) {
  const txt = $('body').text().replace(/\s+/g, ' ');
  let whatsapp = null;
  $('a[href*="whatsapp.com"], a[href*="wa.me"]').each((_, e) => {
    if (whatsapp) return;
    const h = $(e).attr('href') || '';
    const m = h.match(/(?:phone=|wa\.me\/)\+?(\d{10,15})/);
    if (m) whatsapp = m[1].replace(/^0+/, '');
  });
  if (whatsapp && !whatsapp.startsWith('55')) whatsapp = '55' + whatsapp;
  const end = txt.match(/Endere[çc]o:?\s*((?:Est|Estrada|Rua|Av|Avenida|Rod)[^|]{5,90}?)(?:\s*-\s*Rio de Janeiro|\s*Telefone|\s*CEP|\s*$)/i);
  const tel = txt.match(/Telefone:?\s*(\(?\d{2}\)?\s*\d{4,5}-?\d{4})/i);
  return {
    endereco: end ? end[1].trim().replace(/\s*,?\s*$/, '') : null,
    telefone: tel ? tel[1].trim() : null,
    whatsapp
  };
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
  return { itens, logo, contato: pegarContato($) };
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
  if (req.method === 'PATCH') {
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    const { rows: [l] } = await query('update leads set status=$2 where id=$1 returning id, status', [b.id, b.status || 'novo']);
    return res.json({ ok: true, lead: l });
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

// importa UMA loja (usado pelo importar manual, pelo cron e pelo refresh por visita)
async function importarLoja(loja) {
  {
    const chave = loja.autocerto_url || loja.autocerto_id;
    if (!chave) { return { loja: loja.nome, erro: 'sem site/ID cadastrado' }; }
    try {
      const fonte = fonteDaLoja(chave);
      let itens, logoSite = null, contato = null;
      if (fonte.tipo === 'site') { const r = await lerSite(fonte.base); itens = r.itens; logoSite = r.logo; contato = r.contato; }
      else { itens = await lerPortal(fonte.base, fonte.portalId); }
      // o robô preenche os dados da loja sozinho
      try {
        await query(`update lojas set
            logo_url = coalesce($1, logo_url),
            endereco = coalesce($2, endereco),
            telefone = coalesce($3, telefone),
            whatsapp = coalesce($4, whatsapp)
          where id = $5`,
          [logoSite, contato && contato.endereco, contato && contato.telefone, contato && contato.whatsapp, loja.id]);
      } catch (_) {}
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
      try { await query('update lojas set ultima_sync = now(), ultimo_erro = null where id = $1', [loja.id]); } catch (_) {}
      return { loja: loja.nome, veiculos: itens.length };
    } catch (e) {
      try { await query('update lojas set ultima_sync = now(), ultimo_erro = $1 where id = $2', [String(e.message).slice(0, 300), loja.id]); } catch (_) {}
      return { loja: loja.nome, erro: e.message };
    }
  }
}

// resumo diário (no máximo 1x a cada 20h), disparado junto das sincronizações
async function resumoSeDevido() {
  try {
    const { rows: [c] } = await query("select em from config where chave='ultimo_resumo'");
    const devido = !c || (Date.now() - new Date(c.em).getTime()) > 20 * 3600 * 1000;
    if (devido && process.env.RESEND_API_KEY) {
      await enviarResumo();
      await query("insert into config (chave, valor, em) values ('ultimo_resumo', 'ok', now()) on conflict (chave) do update set em = now()");
    }
  } catch (_) {}
}

async function rotaImportar(req, res) {
  await migra();
  const soLoja = req.query.loja;
  // sem ?loja=ID, importa UMA loja por chamada (a mais desatualizada) para não estourar o tempo da função
  const { rows: lojas } = soLoja
    ? await query('select * from lojas where ativa = true and id = $1', [soLoja])
    : await query('select * from lojas where ativa = true order by ultima_sync asc nulls first limit 1');
  const resultado = [];
  for (const loja of lojas) { resultado.push(await importarLoja(loja)); }
  await resumoSeDevido();
  res.json({ ok: true, lojas: resultado });
}

// atualização por visita: relê a loja mais desatualizada, com trava para não repetir
async function rotaRefresh(req, res) {
  await migra();
  const horas = Math.max(1, parseInt(req.query.horas || '2') || 2);
  try {
    const { rows: [lk] } = await query("select em from config where chave='refresh_lock'");
    if (lk && (Date.now() - new Date(lk.em).getTime()) < 150000) return res.json({ ok: true, pulado: 'recente' });
  } catch (_) {}
  const { rows: [loja] } = await query(
    `select * from lojas where ativa = true
       and (ultima_sync is null or ultima_sync < now() - ($1 || ' hours')::interval)
     order by ultima_sync asc nulls first limit 1`, [String(horas)]);
  if (!loja) return res.json({ ok: true, atualizado: false });
  await query("insert into config (chave, valor, em) values ('refresh_lock','1',now()) on conflict (chave) do update set em = now()");
  const r = await importarLoja(loja);
  await resumoSeDevido();
  res.json({ ok: true, atualizado: true, ...r });
}

// resumo diário para a ACEIMA
async function enviarResumo() {
  // 1) LEADS de compra de carro (interesse em anúncio) por loja
  const { rows: leadsLoja } = await query(
    `select lo.nome as loja,
            count(*) as total,
            count(*) filter (where coalesce(le.status,'novo')='novo') as parados
       from leads le join lojas lo on lo.id = le.loja_id
      where le.criado_em >= now() - interval '1 day' and coalesce(le.tipo,'venda')='venda'
      group by lo.nome order by 2 desc`);
  // 2) LEADS de quem quer vender o próprio carro (não tem loja definida)
  const { rows: [aval] } = await query(
    `select count(*) as total, count(*) filter (where coalesce(status,'novo')='novo') as parados
       from leads where criado_em >= now() - interval '1 day' and tipo='compra'`);
  // 3) ESTOQUE por loja
  const { rows: estoque } = await query(
    `select l.nome, l.ultima_sync, l.ultimo_erro,
            count(v.id) filter (where v.ativo and not coalesce(v.oculto,false)) as no_ar,
            count(v.id) filter (where v.criado_em >= now() - interval '1 day') as novos,
            count(v.id) filter (where not v.ativo and v.sincronizado_em >= now() - interval '1 day') as sairam,
            count(v.id) filter (where coalesce(v.oculto,false)) as ocultos
       from lojas l left join veiculos v on v.loja_id = l.id
      where l.ativa = true
      group by l.id, l.nome, l.ultima_sync, l.ultimo_erro
      order by l.nome`);

  const n = x => Number(x || 0);
  const somaLeads = leadsLoja.reduce((s, l) => s + n(l.total), 0) + n(aval.total);
  const parados = leadsLoja.reduce((s, l) => s + n(l.parados), 0) + n(aval.parados);
  const totNoAr = estoque.reduce((s, l) => s + n(l.no_ar), 0);
  const totNovos = estoque.reduce((s, l) => s + n(l.novos), 0);
  const totSairam = estoque.reduce((s, l) => s + n(l.sairam), 0);
  const totOcultos = estoque.reduce((s, l) => s + n(l.ocultos), 0);
  const lojasErro = estoque.filter(l => l.ultimo_erro);

  // versão em texto puro (para quem não vê HTML)
  const linhas = [
    'Resumo das últimas 24h — Intendente Shopping Car', '',
    `Leads: ${somaLeads} (${parados} sem atendimento)`,
    `Estoque no ar: ${totNoAr} · entraram ${totNovos} · saíram ${totSairam} · ocultos ${totOcultos}`, ''
  ];
  leadsLoja.forEach(l => linhas.push(`${l.loja}: ${l.total} interessados (${l.parados} sem atendimento)`));
  if (n(aval.total)) linhas.push(`Avaliação de veículo (cliente quer vender): ${aval.total} (${aval.parados} sem atendimento)`);
  linhas.push('');
  estoque.forEach(l => linhas.push(`${l.nome}: ${l.no_ar} no ar · +${l.novos} · -${l.sairam}${l.ultimo_erro ? ' · FALHA na sincronização' : ''}`));

  const quando = iso => {
    if (!iso) return 'nunca';
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1) return 'agora';
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  };
  const badge = (txt, fundo, cor) => `<span style="display:inline-block;background:${fundo};color:${cor};font:700 11px/1 Arial,sans-serif;padding:5px 9px;border-radius:99px">${esc(txt)}</span>`;

  const linhasLeads = leadsLoja.map(l => [
    esc(l.loja),
    'Interesse em anúncio',
    n(l.total),
    n(l.parados) > 0 ? `<b style="color:#993C1D">${l.parados}</b>` : '0'
  ]);
  if (n(aval.total)) linhasLeads.push([
    'Formulário de avaliação',
    'Quer vender o carro',
    n(aval.total),
    n(aval.parados) > 0 ? `<b style="color:#993C1D">${aval.parados}</b>` : '0'
  ]);

  const tabela = [
    cartoes([
      { rotulo: 'Leads em 24h', valor: somaLeads, cor: '#993C1D' },
      { rotulo: 'Aguardando atendimento', valor: parados, cor: parados > 0 ? '#854F0B' : '#0F6E56' },
      { rotulo: 'Veículos no ar', valor: totNoAr, cor: '#185FA5' }
    ]),
    tituloSecao('Leads das últimas 24h'),
    tabelaDados(['Origem', 'Tipo', 'Contatos', 'Aguardando'], linhasLeads,
      'Nenhum contato nas últimas 24h.'),
    tituloSecao('Estoque por loja'),
    tabelaDados(['Loja', 'No ar', 'Entraram', 'Saíram', 'Sincronizou'],
      estoque.map(l => [
        esc(l.nome) + (l.ultimo_erro ? ' ' + badge('falha', '#fdeaea', '#b3261e') : ''),
        n(l.no_ar),
        n(l.novos) > 0 ? `<b style="color:#0F6E56">+${l.novos}</b>` : '0',
        n(l.sairam) > 0 ? `<b style="color:#854F0B">-${l.sairam}</b>` : '0',
        quando(l.ultima_sync)
      ]),
      'Nenhuma loja cadastrada.')
  ].join('');

  const html = emailLayout({
    etiqueta: 'Resumo diário',
    titulo: 'Resumo das últimas 24 horas',
    subtitulo: 'Contatos recebidos pelo site e movimentação do estoque das lojas.',
    tabela,
    aviso: lojasErro.length
      ? '<b>Sincronização com falha:</b> ' + lojasErro.map(l => esc(l.nome)).join(', ') + '. O estoque dessas lojas pode estar desatualizado no site — vale checar se o site delas está no ar.'
      : null,
    botao: { url: SITE_URL + '/painel.html', texto: 'Abrir o painel da ACEIMA' },
    rodape: null
  });

  const key = process.env.RESEND_API_KEY;
  if (key) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: REMETENTE, to: [ACEIMA_MAIL], subject: 'Resumo diário — Intendente Shopping Car', text: linhas.join('\n'), html })
    });
  }
  return { enviado: !!key, para: ACEIMA_MAIL, resumo: linhas };
}
async function rotaResumo(req, res) {
  await migra();
  res.json({ ok: true, ...(await enviarResumo()) });
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
    if (rota === 'resumo') return await rotaResumo(req, res);
    if (rota === 'refresh') return await rotaRefresh(req, res);
    res.status(404).json({ erro: 'rota não encontrada', rota });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
}
