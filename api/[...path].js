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
  // carro x moto (o site tem filtro de tipo e as motos vinham marcadas como carro)
  try { await query('alter table veiculos add column if not exists tipo text'); } catch (_) {}
  try {
    // marca de moto é decisiva: corrige inclusive o que já estava gravado como carro
    await query(`update veiculos set tipo='moto'
                  where coalesce(tipo,'') <> 'moto'
                    and upper(regexp_replace(marca, '^I/', '')) = any($1)`, [MARCAS_MOTO]);
  } catch (_) {}
  const RX_CAMINHAO = '(CONSTELLATION|DELIVERY|WORKER|ATEGO|ACCELO|AXOR|ACTROS|ATRON|TECTOR|STRALIS|EUROCARGO|NPR|NQR|NKR|CAMINH)';
  const RX_UTILITARIO = '^(DAILY|SPRINTER|MASTER|DUCATO|JUMPER|BOXER|V260|BONGO|K-?2500|EXPERT|JUMPY|SCUDO|TRAFIC)';
  try {
    // caminhão: marca pesada, linha conhecida, furgão grande ou PBT no nome (8.160, 11.180)
    await query(`update veiculos set tipo='caminhao'
                  where coalesce(tipo,'') not in ('moto','caminhao')
                    and (upper(marca) = any($1)
                         or upper(coalesce(modelo,'') || ' ' || coalesce(versao,'')) ~ $2
                         or upper(coalesce(modelo,'')) ~ $3
                         or (upper(marca) = 'FORD' and upper(coalesce(modelo,'') || ' ' || coalesce(versao,'')) ~ 'CARGO')
                         or (upper(marca) = 'HYUNDAI' and upper(coalesce(modelo,'')) ~ '^HR( |$)')
                         or coalesce(modelo,'') ~ '[0-9]{1,2}\\.[0-9]{3}'
                         or (upper(marca) = 'MERCEDES-BENZ' and coalesce(modelo,'') ~ '^[0-9]{3,4}$'))`,
      [MARCAS_CAMINHAO, RX_CAMINHAO, RX_UTILITARIO]);
  } catch (_) {}
  try {
    // devolve para "carro" o que foi marcado como caminhão pela regra antiga e não bate mais
    // (era o caso do FIAT DOBLO 1.8 CARGO16V, pego pelo "CARGO" genérico)
    await query(`update veiculos set tipo='carro'
                  where tipo='caminhao'
                    and upper(marca) <> all($1)
                    and upper(coalesce(modelo,'') || ' ' || coalesce(versao,'')) !~ $2
                    and upper(coalesce(modelo,'')) !~ $3
                    and not (upper(marca) = 'FORD' and upper(coalesce(modelo,'') || ' ' || coalesce(versao,'')) ~ 'CARGO')
                    and not (upper(marca) = 'HYUNDAI' and upper(coalesce(modelo,'')) ~ '^HR( |$)')
                    and coalesce(modelo,'') !~ '[0-9]{1,2}\\.[0-9]{3}'
                    and not (upper(marca) = 'MERCEDES-BENZ' and coalesce(modelo,'') ~ '^[0-9]{3,4}$')`,
      [MARCAS_CAMINHAO, RX_CAMINHAO, RX_UTILITARIO]);
  } catch (_) {}
  try { await query("update veiculos set tipo='carro' where tipo is null"); } catch (_) {}
  // quilometragem absurda digitada pela loja (9.999.999) some da vitrine.
  // O que a loja publicou vale, inclusive 0 km — quem decide é o anúncio, não a gente.
  try { await query('update veiculos set km = null where km > 1500000'); } catch (_) {}
  // "0 km" em carro antigo é campo em branco na origem, não um zero de verdade
  try {
    await query('update veiculos set km = null where km = 0 and (ano_modelo is null or ano_modelo < $1)',
      [ANO_ZERO_KM()]);
  } catch (_) {}
  // por que o anúncio está oculto: null = nunca mexido, 'sem_foto' = o robô escondeu, 'manual' = a ACEIMA decidiu
  try { await query('alter table veiculos add column if not exists oculto_motivo text'); } catch (_) {}
  // cor de fundo da logo definida à mão pela ACEIMA (vence a detecção automática)
  try { await query('alter table lojas add column if not exists cor text'); } catch (_) {}
  // parceiros de serviço do polo (vistoria, laudo, ar-condicionado, alimentação...)
  try {
    await query(`create table if not exists parceiros (
      id serial primary key, nome text not null, categoria text, descricao text,
      beneficio text, endereco text, telefone text, whatsapp text, site text,
      logo_url text, cor text, ordem int default 100, ativa boolean default true,
      criado_em timestamptz default now())`);
  } catch (_) {}
  try {
    const { rows: [c] } = await query('select count(*)::int as n from parceiros');
    if (c && c.n === 0) {
      await query(`insert into parceiros (nome, categoria, descricao, ordem) values
        ('LaudoCar','vistoria','Laudo cautelar e vistoria veicular completa antes de fechar negócio.',10),
        ('SISV Inspeção Veicular','vistoria','Inspeção veicular e vistoria de transferência.',20),
        ('Frioline','manutencao','Ar-condicionado automotivo: carga de gás, higienização e reparo.',30),
        ('R21','alimentacao','Restaurante do polo — para quem passa o dia procurando carro e para quem trabalha aqui.',40)`);
    }
  } catch (_) {}
  // anúncio sem foto que entrou antes dessa regra: tira do site agora (fica no painel)
  try {
    await query(`update veiculos set oculto = true, oculto_motivo = 'sem_foto'
                  where coalesce(array_length(fotos,1),0) = 0
                    and coalesce(oculto,false) = false and oculto_motivo is null`);
  } catch (_) {}
  migrado = true;
}
// marcas que só fazem moto — para as que fazem os dois, olhamos o modelo
const MARCAS_MOTO = ['KAWASAKI', 'YAMAHA', 'SHINERAY', 'DAFRA', 'HARLEY-DAVIDSON', 'HALEY', 'ROYAL ENFIELD',
  'TRIUMPH', 'DUCATI', 'KTM', 'KASINSKI', 'TRAXX', 'HAOJUE', 'APRILIA', 'BENELLI', 'MV AGUSTA', 'INDIAN',
  'HUSQVARNA', 'BAJAJ', 'SYM', 'KYMCO', 'PIAGGIO', 'VESPA', 'MOTTU', 'AVELLOZ', 'BULL', 'GCX', 'SOUSA',
  'MUUV', 'WATTS', 'LEV', 'GOODE'];
const MARCAS_MISTAS = ['HONDA', 'SUZUKI', 'BMW'];
const MODELOS_MOTO = /\b(CG|BIZ|POP|TITAN|FAN|BROS|XRE|CB ?\d|CBR|PCX|ADV|HORNET|TWISTER|LEAD|NXR|ELITE|SH ?\d|BURGMAN|INTRUDER|GSX|V-STROM|BANDIT|YES|FAZER|FACTOR|CRYPTON|LANDER|TENERE|MT-?\d|XJ6|NMAX|XMAX|CRF|NINJA|VERSYS|VULCAN|G ?310|R ?1250|F ?850|S ?1000)\b/i;
// scooter/ciclomotor elétrico vem com a potência no nome (ex.: "X11 3000W")
const ELETRICA_MOTO = /\b\d{3,4}\s?W\b/i;
// caminhões: marcas que só fazem pesados + linhas conhecidas + o padrão de PBT (11.180, 24.280)
const MARCAS_CAMINHAO = ['SCANIA', 'IVECO', 'DAF', 'MAN', 'AGRALE', 'INTERNATIONAL', 'FREIGHTLINER',
  'WESTERN STAR', 'SINOTRUK', 'SHACMAN', 'FOTON', 'HINO', 'ISUZU'];
// linhas de caminhão de verdade. "CARGO" saiu daqui: pegava "DOBLO 1.8 CARGO16V",
// que é furgão pequeno. Ford Cargo é tratado à parte, pela marca.
const MODELOS_CAMINHAO = /\b(CONSTELLATION|DELIVERY|WORKER|ATEGO|ACCELO|AXOR|ACTROS|ATRON|TECTOR|STRALIS|EUROCARGO|VM ?\d{2}|FH ?\d{2}|FM ?\d{2}|NPR|NQR|NKR|CAMINH)/i;
// furgões grandes / utilitários de carga entram junto com os caminhões
const MODELOS_UTILITARIO = /^(DAILY|SPRINTER|MASTER|DUCATO|JUMPER|BOXER|V260|BONGO|K-?2500|EXPERT|JUMPY|SCUDO|TRAFIC)\b/i;
const NUMERO_CAMINHAO = /\b\d{1,2}\.\d{3}\b/;                 // PBT no nome: 8.160, 11.180, 24.280
const MB_CAMINHAO = /^\s*\d{3,4}\s*$/;                        // Mercedes antigo: 710, 1113, 1620
function tipoVeiculo(marca, modelo, versao) {
  const m = String(marca || '').toUpperCase().trim().replace(/^I\//, '');  // "I/" = importado, no AutoCerto
  const mod = String(modelo || '').toUpperCase().trim();
  const txt = [modelo, versao].join(' ');
  if (MARCAS_MOTO.indexOf(m) >= 0) return 'moto';
  if (ELETRICA_MOTO.test(txt)) return 'moto';
  if (MARCAS_MISTAS.indexOf(m) >= 0 && MODELOS_MOTO.test(txt)) return 'moto';
  if (MARCAS_CAMINHAO.indexOf(m) >= 0) return 'caminhao';
  if (MODELOS_CAMINHAO.test(txt)) return 'caminhao';
  if (MODELOS_UTILITARIO.test(mod)) return 'caminhao';
  if (m === 'FORD' && /\bCARGO\b/i.test(txt)) return 'caminhao';   // linha Cargo é caminhão
  if (m === 'HYUNDAI' && /^HR\b/.test(mod) && !/^HR-?V/.test(mod)) return 'caminhao';
  if (NUMERO_CAMINHAO.test(mod)) return 'caminhao';
  if (m === 'MERCEDES-BENZ' && MB_CAMINHAO.test(mod)) return 'caminhao';
  return 'carro';
}
const ACEIMA_MAIL = process.env.ACEIMA_EMAIL || 'aceima.adm2026@gmail.com';
// Remetente próprio: mesmo domínio do site (aceima.com.br fica para o PitGest).
// Enquanto o domínio não estiver verificado no Resend da conta cuja chave está aqui,
// o envio cai sozinho no remetente de teste — que só entrega para o dono da conta.
const REMETENTE = process.env.RESEND_FROM || 'ACEIMA <leads@intendenteautoshopping.com.br>';
const REMETENTE_RESERVA = 'ACEIMA <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://intendente-shopping-car.vercel.app';

// envia pelo Resend tentando o remetente próprio e, se ele for recusado, o de teste
async function enviarResend(key, payload) {
  const post = (from) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({}, payload, { from }))
  });
  let r = await post(REMETENTE);
  if (!r.ok && REMETENTE !== REMETENTE_RESERVA) {
    let detalhe = ''; try { detalhe = (await r.text()).slice(0, 200); } catch (_) {}
    console.log('Resend recusou o remetente ' + REMETENTE + ' (' + r.status + '): ' + detalhe);
    r = await post(REMETENTE_RESERVA);
  }
  return r;
}

// ---------------- SEGURANÇA ----------------
// Só a ACEIMA pode escrever (cadastrar/editar/excluir loja, ocultar veículo, ver e mudar leads).
// A senha fica na variável PAINEL_TOKEN do Vercel — nunca no código, que é público.
// Enquanto a variável não existir, nada trava (compatibilidade), mas fica desprotegido.
const PAINEL_TOKEN = process.env.PAINEL_TOKEN || null;
function autorizado(req) {
  if (!PAINEL_TOKEN) return true;
  const h = req.headers || {};
  const enviado = h['x-painel-token'] || h['X-Painel-Token'] ||
    ((req.query && req.query.token) ? String(req.query.token) : '');
  return enviado === PAINEL_TOKEN;
}
function negar(res) { return res.status(401).json({ erro: 'não autorizado' }); }

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
      .marca{width:150px!important;height:64px!important}
    }
  </style></head><body style="margin:0;padding:0;background:#f5f3f2;-webkit-text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
   <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff">
      <tr><td class="pad" style="background:#f2f0ed;border-bottom:1px solid #e6e0dc;padding:20px 26px">
        <div class="marca" style="width:180px;height:78px;max-width:70%;background:url('${SITE_URL}/logo.png') left center no-repeat;background-size:contain">&nbsp;</div>
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
async function enviarEmailsLead(lead, soAceima, anexos) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !lead) return;
  // lead de "quero vender": vai para a ACEIMA e, em cópia oculta, para TODAS as lojas
  // associadas com e-mail cadastrado (uma loja não enxerga o e-mail da outra).
  let emails = [], ocultos = [];
  if (soAceima) { /* teste de layout: nunca vai para a loja */ }
  else if (lead.tipo === 'compra') {
    const { rows } = await query("select email from lojas where ativa=true and email is not null and email<>''");
    ocultos = rows.map(r => r.email);
  } else if (lead.loja_id) {
    const { rows } = await query("select email from lojas where id=$1 and email is not null and email<>''", [lead.loja_id]);
    emails = rows.map(r => r.email);
  }
  emails.push(ACEIMA_MAIL);
  emails = [...new Set(emails.filter(Boolean))];
  ocultos = [...new Set(ocultos.filter(Boolean))].filter(e => !emails.includes(e));
  if (!emails.length) return;
  const det = lead.detalhes ? (typeof lead.detalhes === 'string' ? JSON.parse(lead.detalhes) : lead.detalhes) : null;

  // o lead recém-criado vem do INSERT ... RETURNING *, que NÃO traz o nome do veículo
  // (isso é um join que só existe no GET). Sem isso o e-mail saía com "—".
  let carroInteresse = lead.veiculo_nome || null, precoAnuncio = null, kmAnuncio = null;
  if (lead.veiculo_id) {
    try {
      const { rows: [v] } = await query(
        'select marca, modelo, versao, ano_modelo, ano_fabricacao, km, preco from veiculos where id=$1',
        [lead.veiculo_id]);
      if (v) {
        const ano = v.ano_modelo || v.ano_fabricacao;
        carroInteresse = [v.marca, v.modelo, v.versao].filter(Boolean).join(' ') + (ano ? ' — ' + ano : '');
        precoAnuncio = v.preco; kmAnuncio = v.km;
      }
    } catch (_) {}
  }
  const numero = (n) => {
    const x = Number(String(n == null ? '' : n).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
    return isFinite(x) && x > 0 ? x : null;
  };
  const moeda = (n) => { const x = numero(n); return x ? 'R$ ' + x.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : ''; };
  const kms = (n) => { const x = numero(n); return x ? x.toLocaleString('pt-BR') + ' km' : ''; };
  const compra = lead.tipo === 'compra';
  // lead de venda: a entrada / o carro da troca vêm em detalhes; leads antigos só têm o texto em entrada
  const entradaTxt = (!compra && det && det.entrada) ? (moeda(det.entrada) || String(det.entrada)) : '';
  const trocaTxt = (!compra && det && det.troca) ? String(det.troca) : '';
  const formaTxt = lead.forma_compra
    ? (lead.forma_compra + ((entradaTxt || trocaTxt) ? '' : (lead.entrada || '')))
    : '';
  const assunto = compra
    ? 'Cliente quer VENDER um veículo — via site Intendente Shopping Car'
    : 'Novo lead de venda — via site Intendente Shopping Car';
  const linhas = [
    'Este é um cliente vindo do site da Intendente Shopping Car.', '',
    'Nome: ' + (lead.cliente_nome || '-'),
    'WhatsApp: ' + (lead.cliente_telefone || '-'),
    lead.cliente_email ? ('E-mail: ' + lead.cliente_email) : null,
    det ? ('Veículo do cliente: ' + [det.marca, det.modelo, det.versao, det.ano].filter(Boolean).join(' ')
      + (det.km ? (' — ' + det.km + ' km') : '') + (det.valor ? (' — pretende ' + det.valor) : '')
      + (det.fotos ? (' — ' + det.fotos + ' foto(s) enviadas') : '')) : null,
    (!compra && carroInteresse) ? ('Veículo de interesse: ' + carroInteresse
      + (moeda(precoAnuncio) ? (' — ' + moeda(precoAnuncio)) : '')) : null,
    formaTxt ? ('Forma de compra: ' + formaTxt) : null,
    entradaTxt ? ('Entrada: ' + entradaTxt) : null,
    trocaTxt ? ('Carro na troca: ' + trocaTxt) : null,
    '', 'Mensagem enviada automaticamente pela ACEIMA.'
  ].filter(x => x !== null);

  const tel = String(lead.cliente_telefone || '').replace(/\D/g, '');
  const telBonito = tel.length >= 10
    ? '(' + tel.slice(-11, -9) + ') ' + tel.slice(-9, -4) + '-' + tel.slice(-4)
    : (lead.cliente_telefone || '—');
  const carroCliente = det ? [det.marca, det.modelo, det.versao, det.ano].filter(Boolean).join(' ') : null;

  const tabela = [
    linhaInfo('Cliente', esc(lead.cliente_nome), true),
    linhaInfo('WhatsApp', `<a href="https://wa.me/${tel.length > 11 ? tel : '55' + tel}" style="color:#25a35a;text-decoration:none;font-weight:700">${esc(telBonito)}</a>`),
    linhaInfo('E-mail', lead.cliente_email ? `<a href="mailto:${esc(lead.cliente_email)}" style="color:#241b19;text-decoration:none">${esc(lead.cliente_email)}</a>` : ''),
    compra
      ? linhaInfo('Veículo do cliente', esc(carroCliente || '—'))
      : linhaInfo('Veículo de interesse', esc(carroInteresse || '—')),
    compra ? linhaInfo('Quilometragem', det && det.km ? esc(det.km) + ' km' : '') : '',
    compra ? linhaInfo('Valor pretendido', det && det.valor ? esc(/^R\$/.test(String(det.valor)) ? String(det.valor) : 'R$ ' + det.valor) : '') : '',
    compra ? linhaInfo('Fotos enviadas', det && det.fotos ? esc(det.fotos) + ' foto(s) em anexo neste e-mail' : '') : '',
    !compra ? linhaInfo('Anunciado por', esc(moeda(precoAnuncio))) : '',
    !compra ? linhaInfo('Quilometragem', esc(kms(kmAnuncio))) : '',
    !compra ? linhaInfo('Forma de compra', esc(formaTxt)) : '',
    !compra ? linhaInfo('Entrada', esc(entradaTxt)) : '',
    !compra ? linhaInfo('Carro na troca', esc(trocaTxt)) : ''
  ].join('');

  const html = emailLayout({
    etiqueta: compra ? 'Cliente quer vender' : 'Novo cliente interessado',
    titulo: 'Tem lead novo no seu WhatsApp! 😄',
    subtitulo: 'Confira os dados abaixo:',
    tabela,
    botao: tel ? { url: 'https://wa.me/' + (tel.length > 11 ? tel : '55' + tel), texto: 'Falar com o cliente no WhatsApp' } : null,
    aviso: null,
    rodape: 'Contato gerado pelo site da Intendente Shopping Car e repassado pela ACEIMA.'
  });

  const envelope = { to: emails, reply_to: ACEIMA_MAIL, subject: assunto, text: linhas.join('\n'), html };
  if (ocultos.length) envelope.bcc = ocultos;
  // fotos que o cliente anexou no formulário "Venda seu veículo"
  const arquivos = (Array.isArray(anexos) ? anexos : [])
    .map((f, i) => {
      const conteudo = String(f && f.base64 || '').replace(/^data:[^,]+,/, '');
      if (!conteudo) return null;
      const nome = (f && f.nome) ? String(f.nome).replace(/[^\w.\-]+/g, '_').slice(-40) : ('foto-' + (i + 1) + '.jpg');
      return { filename: nome, content: conteudo };
    })
    .filter(Boolean);
  if (arquivos.length) envelope.attachments = arquivos;
  await enviarResend(key, envelope);
}

// ---------------- utilidades ----------------
async function get(url, ajax, cookie) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; ACEIMA-Importer/1.0)' };
  // O template novo do AutoCerto só devolve o pedaço com a próxima dúzia de anúncios
  // quando o pedido parece um XHR (o site faz $.get("/Veiculos/"+pagina) na rolagem)
  // E carrega o cookie de sessão — sem ele a resposta volta vazia.
  if (ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; headers['Accept'] = 'text/html, */*; q=0.01'; }
  if (cookie) headers['Cookie'] = cookie;
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
  return await r.text();
}
// primeira visita: além do HTML, guarda o cookie de sessão que o servidor entrega
async function getComSessao(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ACEIMA-Importer/1.0)' }, redirect: 'follow'
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
  const html = await r.text();
  let cookie = '';
  try {
    const lista = (typeof r.headers.getSetCookie === 'function')
      ? r.headers.getSetCookie()
      : [r.headers.get('set-cookie')].filter(Boolean);
    cookie = lista.map(c => String(c).split(';')[0]).filter(Boolean).join('; ');
  } catch (_) {}
  return { html, cookie };
}
function precoDe(txt) { const m = (txt || '').match(/R\$\s*([\d.]+),/); return m ? parseInt(m[1].replace(/\D/g, '')) : null; }
function intDe(m) { return m ? parseInt(String(m[1]).replace(/\D/g, '')) : null; }

// Ano a partir do qual "0 km" é um valor plausível (seminovo de pátio / zero de verdade).
const ANO_ZERO_KM = () => new Date().getFullYear() - 2;
// Quilometragem final do anúncio.
//  - 0 é um valor legítimo em carro novo (Geely e BYD da Auto Barra são 0 km de fábrica);
//    por isso não dá para usar "||", que trata 0 como vazio.
//  - mas várias lojas publicam "0 km" em carro velho quando simplesmente não preencheram
//    o campo (a Bragança tem Cobalt 2012/2013 anunciado com 0 km). Nesse caso vira "não informado".
function kmDoAnuncio(it, extra) {
  extra = extra || {};
  let km = (it.km != null) ? it.km : (extra.km != null ? extra.km : null);
  if (km !== 0) return km;
  const ano = it.ano || extra.ano_modelo || null;
  return (ano && ano >= ANO_ZERO_KM()) ? 0 : null;
}
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

// e-mail da loja: procura na página de contato (mailto ou texto), ignorando e-mails de terceiros
const emailValido = s => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)
  && !/autocerto|resend|google|facebook|instagram|youtube|whatsapp|sentry|example|\.(png|jpg|jpeg|gif|webp)$/i.test(s);
async function pegarEmail(base) {
  for (const pag of ['/Contato', '/contato', '/Empresa', '/']) {
    let html;
    try { html = await get(base + pag); } catch (_) { continue; }
    const $ = cheerio.load(html);
    let achado = null;
    $('a[href^="mailto:"]').each((_, el) => {
      if (achado) return;
      const e = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
      if (emailValido(e)) achado = e;
    });
    if (!achado) {
      const lista = ($('body').text().match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
      achado = lista.find(emailValido) || null;
    }
    if (achado) return achado.toLowerCase();
  }
  return null;
}

// ---------------- ROBÔ: site próprio da loja ----------------
async function lerSite(base) {
  const inicial = await getComSessao(base + '/Veiculos');
  const $ = cheerio.load(inicial.html);
  const marcas = uniqTexts($, 'a[href*="marca="]').map(t => t.toUpperCase());
  const modelos = uniqTexts($, 'a[href*="modelo="]').map(t => t.toUpperCase()).sort((a, b) => b.length - a.length);
  const vistos = new Set();
  const itens = [], ignorados = [];
  colherCards($, { marcas, modelos, vistos, itens, ignorados });

  // páginas seguintes (/Veiculos/2, /3, ...) — até vir vazio, repetir ou bater o limite
  for (let pagina = 2; pagina <= 80; pagina++) {
    let html;
    try { html = await get(`${base}/Veiculos/${pagina}`, true, inicial.cookie); } catch (_) { break; }
    if (!html || html.length < 300) break;                       // fim da lista
    const antes = itens.length + ignorados.length;
    colherCards(cheerio.load(html), { marcas, modelos, vistos, itens, ignorados });
    if (itens.length + ignorados.length === antes) break;                           // nada novo (template antigo devolve a página toda)
    await pausa(80);
  }

  const logo = await pegarLogo(base, $);
  return { itens, ignorados, logo, contato: pegarContato($) };
}

// extrai os cartões de anúncio de uma página (ou do pedaço devolvido pela rolagem)
// textos de botão que NÃO são nome de veículo (cada loja usa o seu)
const ROTULO_GENERICO = /^(ver mais|mais detalhes|saiba mais|ver detalhes|detalhes|financiamento|ver an[úu]ncio|whatsapp|compartilhar|simular|reservar|\+)$/i;
function colherCards($, ctx) {
  const { marcas, modelos, vistos, itens, ignorados } = ctx;
  $('a[href*="Veiculo/"][href*="detalhes"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const m = href.match(/Veiculo\/([^/]+)\/(\d+)\/detalhes/);
    if (!m) return;
    const id = m[2];
    if (vistos.has(id)) return;
    // sobe até o cartão que contém o preço
    let card = $a;
    for (let k = 0; k < 6; k++) { const pr = card.parent(); if (!pr || !pr.length) break; card = pr; if (/R\$/.test(card.text()) && card.find('img').length) break; }

    // O NOME pode estar no texto do link (template antigo) ou num cabeçalho do cartão
    // (template da Bragança, onde o link é só "Ver mais"). Sem nome de verdade, não sobe.
    const textoLink = $a.text().trim().replace(/\s+/g, ' ');
    const heads = card.find('h1,h2,h3,h4,h5').map((_, e) => $(e).text().trim().replace(/\s+/g, ' ')).get().filter(Boolean);
    let titulo = '';
    if (heads.length) {
      titulo = heads[0];
      if (heads[1] && !titulo.toUpperCase().includes(heads[1].toUpperCase())) titulo += ' ' + heads[1];
    }
    if ((!titulo || ROTULO_GENERICO.test(titulo)) && textoLink && !ROTULO_GENERICO.test(textoLink)) titulo = textoLink;
    if (!titulo || titulo.length < 3 || ROTULO_GENERICO.test(titulo)) return;   // ainda é botão, não é anúncio

    vistos.add(id);
    const ctxt = card.text().replace(/\s+/g, ' ');
    const $img = card.find('img').first();
    let img = $img.attr('src') || $img.attr('data-src') || $img.attr('data-original') || null;
    if (img && /embreve/i.test(img)) img = null;
    const T = titulo.toUpperCase();
    const marca = marcas.find(x => T.startsWith(x)) || titulo.split(' ')[0].toUpperCase();
    const resto = titulo.slice(marca.length).trim();
    const R = resto.toUpperCase();
    const modelo = modelos.find(x => R.startsWith(x)) || resto.split(' ')[0].toUpperCase();
    const versao = resto.slice(modelo.length).trim();
    const sl = parseSlug(m[1]);
    // ano: do slug, "Ano 2021" ou "2021/2021"
    const ano = sl.ano || intDe(ctxt.match(/Ano\s*(\d{4})/i)) || (() => {
      const p = ctxt.match(/\b(\d{4})\/(\d{4})\b/); return p ? parseInt(p[2], 10) : null;
    })();
    // km: "Km 19.000" (um template) ou "19.000 km" / "0 km" (outro).
    // Cuidado com dois detalhes que já causaram erro:
    //  - zero é um valor legítimo, então não dá para usar "||" (0 é falso em JS);
    //  - se o anúncio é 0 km, o número que aparece antes de "Km" é o ANO. Nunca aceitar isso.
    const kmRotulado = intDe(ctxt.match(/Km[:\s]*([\d.]+)/i));
    const kmSolto = intDe(ctxt.match(/(?:^|[^\d.,/])(\d[\d.]*)\s*km\b/i));
    let km = (kmRotulado != null) ? kmRotulado : kmSolto;
    // Zero km é um valor legítimo (Geely da Auto Barra, BYD...) e vale o que a loja publicou.
    // Só descartamos o que é claramente lixo digitado: "9.999.999 km".
    if (km != null && km > 1500000) km = null;
    const item = {
      anuncioId: id, slug: m[1], img,
      marca, modelo, versao,
      preco: precoDe(ctxt), km,
      cambio: (ctxt.match(/C[âa]mbio\s*([A-Za-zÁ-ÿ]+)/i) || [])[1] || null,
      combustivel: sl.combustivel, ano
    };
    // porteira: sem nome utilizável não entra de jeito nenhum (era o caso do "VER MAIS")
    if (!item.marca || item.marca.length < 2 || ROTULO_GENERICO.test(item.marca)) {
      if (ignorados) ignorados.push(id);
      return;
    }
    // sem foto ele ENTRA, mas fica só no painel: o GET público exige ao menos uma foto,
    // então no minuto em que a loja publicar a imagem o anúncio aparece no site sozinho.
    itens.push(item);
  });
}
// detalhe do site próprio: só enriquece fotos + opcionais
async function detalheSite(base, slug, id) {
  let html; try { html = await get(`${base}/Veiculo/${slug}/${id}/detalhes`); } catch (_) { return {}; }
  const $ = cheerio.load(html);
  const fotos = [...new Set($(`img[src*="/fotos/"][src*="/${id}/"]`).map((_, e) => $(e).attr('src')).get())].filter(u => u && !/embreve/i.test(u));
  if (!fotos.length) return {}; // provavelmente redirecionou (carro vendido) -> mantém dados da lista
  // o template repete alguns itens no fim da lista
  const opcionais = [...new Set($('.add-features-list li').map((_, e) => $(e).text().trim()).get().filter(Boolean))];
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
    opcionais: [...new Set($('.add-features-list li').map((_, e) => $(e).text().trim()).get().filter(Boolean))],
    fotos
  };
}

// ---------------- ROTAS ----------------
async function rotaLojas(req, res) {
  if (req.method !== 'GET' && !autorizado(req)) return negar(res);
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
         logo_url=coalesce($8,logo_url),
         cor = case when $9::text is null then cor when $9 = '' then null else $9 end
       where id=$1 returning *`,
      [b.id, b.nome, b.endereco, b.telefone, b.whatsapp, b.email, b.autocerto_id, b.logo_url || null,
       (b.cor === undefined ? null : String(b.cor))]);
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

// parceiros de serviço do polo — leitura pública, escrita só com token
async function rotaParceiros(req, res) {
  await migra();
  if (req.method === 'GET') {
    const { rows } = await query(
      `select * from parceiros ${autorizado(req) ? '' : 'where ativa = true'} order by ordem, nome`);
    return res.json(rows);
  }
  if (!autorizado(req)) return negar(res);
  const b = req.body || {};
  if (req.method === 'POST') {
    if (!b.nome) return res.status(400).json({ erro: 'nome é obrigatório' });
    const { rows: [p] } = await query(
      `insert into parceiros (nome, categoria, descricao, beneficio, endereco, telefone, whatsapp, site, logo_url, cor, ordem)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,100)) returning *`,
      [b.nome, b.categoria || 'servico', b.descricao, b.beneficio, b.endereco, b.telefone,
       b.whatsapp, b.site, b.logo_url || null, b.cor || null, b.ordem]);
    return res.status(201).json(p);
  }
  if (req.method === 'PATCH') {
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    const { rows: [p] } = await query(
      `update parceiros set nome=coalesce($2,nome), categoria=coalesce($3,categoria),
         descricao=coalesce($4,descricao), beneficio=coalesce($5,beneficio),
         endereco=coalesce($6,endereco), telefone=coalesce($7,telefone),
         whatsapp=coalesce($8,whatsapp), site=coalesce($9,site),
         logo_url=coalesce($10,logo_url),
         cor = case when $11::text is null then cor when $11 = '' then null else $11 end,
         ordem=coalesce($12,ordem), ativa=coalesce($13,ativa)
       where id=$1 returning *`,
      [b.id, b.nome, b.categoria, b.descricao, b.beneficio, b.endereco, b.telefone,
       b.whatsapp, b.site, b.logo_url || null, (b.cor === undefined ? null : String(b.cor)),
       b.ordem, (b.ativa === undefined ? null : !!b.ativa)]);
    return res.json(p || { erro: 'parceiro não encontrado' });
  }
  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || b.id;
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    await query('delete from parceiros where id = $1', [id]);
    return res.json({ ok: true });
  }
  return res.status(405).end();
}

async function rotaVeiculos(req, res) {
  await migra();
  if (req.method === 'POST' || req.method === 'PATCH') {
    if (!autorizado(req)) return negar(res);
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    const oculto = b.oculto === true || b.ativo === false;
    const { rows: [v] } = await query(
      "update veiculos set oculto=$2, oculto_motivo='manual' where id=$1 returning id, oculto", [b.id, oculto]);
    return res.json({ ok: true, veiculo: v });
  }
  const q = req.query || {};
  // o site não mostra o que está oculto; o painel (com token) PRECISA ver,
  // senão a ACEIMA esconde um carro e nunca mais consegue trazer de volta
  const cond = ['v.ativo = true']; const p = [];
  if (!autorizado(req)) cond.push('coalesce(v.oculto,false) = false');
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
      where ${cond.join(' and ')} order by v.sincronizado_em desc limit 3000`, p);
  res.json(rows);
}

async function rotaLeads(req, res) {
  await migra();
  // dados de cliente: só a ACEIMA lê e altera. O site continua podendo CRIAR lead (POST).
  if (req.method !== 'POST' && !autorizado(req)) return negar(res);
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
  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || (req.body || {}).id;
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    await query('delete from leads where id = $1', [id]);
    return res.json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  const { rows: [lead] } = await query(
    `insert into leads (loja_id, veiculo_id, cliente_nome, cliente_telefone, cliente_email, forma_compra, entrada, canal, tipo, detalhes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [b.loja_id || null, b.veiculo_id || null, b.cliente_nome, b.cliente_telefone, b.cliente_email,
     b.forma_compra, b.entrada, b.canal || 'formulario', b.tipo || 'venda', b.detalhes ? JSON.stringify(b.detalhes) : null]);
  // as fotos vão só para o e-mail (anexo). Não entram no banco: virariam megabytes de base64.
  const anexos = Array.isArray(b.fotos) ? b.fotos.slice(0, 8) : [];
  enviarEmailsLead(lead, false, anexos).catch(() => {});
  res.status(201).json({ ok: true, lead });
}

// importa UMA loja (usado pelo importar manual, pelo cron e pelo refresh por visita)
async function importarLoja(loja) {
  {
    const chave = loja.autocerto_url || loja.autocerto_id;
    if (!chave) { return { loja: loja.nome, erro: 'sem site/ID cadastrado' }; }
    try {
      const fonte = fonteDaLoja(chave);
      let itens, logoSite = null, contato = null, ignorados = [];
      if (fonte.tipo === 'site') { const r = await lerSite(fonte.base); itens = r.itens; ignorados = r.ignorados || []; logoSite = r.logo; contato = r.contato; }
      else { itens = await lerPortal(fonte.base, fonte.portalId); }
      // o robô preenche os dados da loja sozinho (inclusive o e-mail, lido da página de contato)
      let emailSite = null;
      if (fonte.tipo === 'site') { try { emailSite = await pegarEmail(fonte.base); } catch (_) {} }
      try {
        await query(`update lojas set
            logo_url = coalesce($1, logo_url),
            endereco = coalesce($2, endereco),
            telefone = coalesce($3, telefone),
            whatsapp = coalesce($4, whatsapp),
            email    = coalesce($5, email)
          where id = $6`,
          [logoSite, contato && contato.endereco, contato && contato.telefone, contato && contato.whatsapp, emailSite, loja.id]);
      } catch (_) {}
      // ATENÇÃO: NÃO desativar tudo aqui. Se a função morrer no meio (loja grande),
      // o estoque inteiro ficaria fora do ar. A baixa acontece só no fim, e apenas
      // nos anúncios que realmente sumiram do site da loja.

      // quem já tem galeria salva não precisa da página de detalhes de novo.
      // Em loja grande (600 anúncios) buscar tudo estouraria o tempo da função:
      // a lista já traz preço/km/ano/foto principal, e as galerias entram aos poucos.
      let jaTemGaleria = new Set();
      try {
        const { rows } = await query(
          `select autocerto_id from veiculos
            where loja_id = $1 and coalesce(array_length(fotos,1),0) > 1`, [loja.id]);
        jaTemGaleria = new Set(rows.map(r => String(r.autocerto_id)));
      } catch (_) {}
      const t0 = Date.now();
      const ORCAMENTO_MS = 20000;   // tempo máximo gasto abrindo páginas de detalhe
      let detalhesLidos = 0, detalhesPendentes = 0;

      for (const it of itens) {
        let extra = {};
        const precisaDetalhe = !jaTemGaleria.has(String(it.anuncioId));
        let abriuDetalhe = false;   // só quem teve a galeria conferida pode ser julgado
        if (precisaDetalhe && (Date.now() - t0) < ORCAMENTO_MS) {
          try {
            extra = fonte.tipo === 'site'
              ? await detalheSite(fonte.base, it.slug, it.anuncioId)
              : await detalhePortal(fonte.base, it.slug, it.anuncioId);
            detalhesLidos++; abriuDetalhe = true;
            await pausa(120);
          } catch (_) {}
        } else if (precisaDetalhe) { detalhesPendentes++; }
        const fotos = (extra.fotos && extra.fotos.length) ? extra.fotos : (it.img ? [it.img] : []);
        await query(
          `insert into veiculos (loja_id, autocerto_id, marca, modelo, versao, ano_fabricacao, ano_modelo, km, preco, cambio, combustivel, opcionais, fotos, tipo, oculto, oculto_motivo, ativo, sincronizado_em)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                   coalesce(array_length($13::text[],1),0) <= 1,
                   case when coalesce(array_length($13::text[],1),0) <= 1 then 'sem_foto' else null end,
                   true, now())
           on conflict (loja_id, autocerto_id) do update set
             marca=excluded.marca, modelo=excluded.modelo, versao=excluded.versao,
             ano_fabricacao=excluded.ano_fabricacao, ano_modelo=excluded.ano_modelo,
             km=excluded.km, preco=excluded.preco, cambio=excluded.cambio,
             combustivel=excluded.combustivel,
             -- não apaga galeria/opcionais já salvos quando a rodada não abriu o detalhe
             opcionais = case when coalesce(array_length(excluded.opcionais,1),0) > 0
                              then excluded.opcionais else veiculos.opcionais end,
             fotos = case when coalesce(array_length(excluded.fotos,1),0) >= coalesce(array_length(veiculos.fotos,1),0)
                          then excluded.fotos else veiculos.fotos end,
             tipo=excluded.tipo, ativo=true, sincronizado_em=now(),
             -- escondido por falta de foto volta sozinho quando a loja publica a imagem;
             -- decisão manual da ACEIMA ('manual') o robô nunca desfaz
             oculto = case
                 when veiculos.oculto_motivo = 'manual' then veiculos.oculto
                 when $15::boolean and coalesce(array_length(excluded.fotos,1),0) <= 1 then true
                 when veiculos.oculto_motivo = 'sem_foto'
                      and coalesce(array_length(excluded.fotos,1),0) > 1 then false
                 else veiculos.oculto end,
             oculto_motivo = case
                 when veiculos.oculto_motivo = 'manual' then 'manual'
                 when $15::boolean and coalesce(array_length(excluded.fotos,1),0) <= 1 then 'sem_foto'
                 when veiculos.oculto_motivo = 'sem_foto'
                      and coalesce(array_length(excluded.fotos,1),0) > 1 then null
                 else veiculos.oculto_motivo end`,
          [loja.id, it.anuncioId,
           it.marca || extra.marca || null,
           it.modelo || extra.modelo || null,
           it.versao || null,
           extra.ano_fabricacao || null,
           it.ano || extra.ano_modelo || null,
           kmDoAnuncio(it, extra),
           it.preco != null ? it.preco : null,
           it.cambio || extra.cambio || null,
           it.combustivel || extra.combustivel || null,
           extra.opcionais || [], fotos,
           tipoVeiculo(it.marca || extra.marca, it.modelo || extra.modelo, it.versao),
           abriuDetalhe]);
      }
      // agora sim: some do site quem não apareceu mais na leitura de hoje.
      // Só faz a baixa se a leitura veio íntegra (algum anúncio encontrado).
      let saiuDoAr = 0;
      if (itens.length) {
        try {
          const vistosIds = itens.map(x => String(x.anuncioId));
          const { rowCount } = await query(
            `update veiculos set ativo = false
              where loja_id = $1 and ativo = true and autocerto_id <> all($2::text[])`,
            [loja.id, vistosIds]);
          saiuDoAr = rowCount || 0;
        } catch (_) {}
      }
      try { await query('update lojas set ultima_sync = now(), ultimo_erro = null where id = $1', [loja.id]); } catch (_) {}
      return { loja: loja.nome, veiculos: itens.length, sairam: saiuDoAr, sem_nome: (ignorados || []).length, galerias_lidas: detalhesLidos, galerias_pendentes: detalhesPendentes };
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
  // o cron do Vercel chama sem token; aceitamos, mas quem vem de fora precisa estar autorizado
  const doCron = !!(req.headers && (req.headers['x-vercel-cron'] || /vercel-cron/i.test(req.headers['user-agent'] || '')));
  if (!doCron && !autorizado(req)) return negar(res);
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
  const totNoAr = estoque.reduce((s, l) => s + n(l.no_ar), 0);
  const totNovos = estoque.reduce((s, l) => s + n(l.novos), 0);
  const totSairam = estoque.reduce((s, l) => s + n(l.sairam), 0);
  const totOcultos = estoque.reduce((s, l) => s + n(l.ocultos), 0);
  const lojasErro = estoque.filter(l => l.ultimo_erro);

  // versão em texto puro (para quem não vê HTML)
  const linhas = [
    'Resumo das últimas 24h — Intendente Shopping Car', '',
    `Leads: ${somaLeads} (${n(aval.total)} querem vender o próprio carro)`,
    `Estoque no ar: ${totNoAr} · entraram ${totNovos} · saíram ${totSairam} · ocultos ${totOcultos}`, ''
  ];
  leadsLoja.forEach(l => linhas.push(`${l.loja}: ${l.total} interessados nos anúncios`));
  if (n(aval.total)) linhas.push(`Formulário de avaliação (quer vender): ${aval.total}`);
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

  const linhasLeads = leadsLoja.map(l => [esc(l.loja), 'Interesse em anúncio', n(l.total)]);
  if (n(aval.total)) linhasLeads.push(['Formulário de avaliação', 'Quer vender o carro', n(aval.total)]);

  const tabela = [
    cartoes([
      { rotulo: 'Leads em 24h', valor: somaLeads, cor: '#993C1D' },
      { rotulo: 'Querem vender', valor: n(aval.total), cor: '#185FA5' },
      { rotulo: 'Veículos no ar', valor: totNoAr, cor: '#0F6E56' }
    ]),
    tituloSecao('Leads das últimas 24h'),
    tabelaDados(['Origem', 'Tipo', 'Contatos'], linhasLeads,
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
    await enviarResend(key, { to: [ACEIMA_MAIL], subject: 'Resumo diário — Intendente Shopping Car', text: linhas.join('\n'), html });
  }
  return { enviado: !!key, para: ACEIMA_MAIL, resumo: linhas };
}
async function rotaResumo(req, res) {
  await migra();
  res.json({ ok: true, ...(await enviarResumo()) });
}

// envia um e-mail de lead de EXEMPLO só para a ACEIMA, para conferir o layout.
// Não grava nada no banco e nunca manda para a loja.
async function rotaTesteEmail(req, res) {
  await migra();
  const tipo = req.query.tipo === 'compra' ? 'compra' : 'venda';
  const { rows: [v] } = await query(
    `select v.id, v.marca, v.modelo, v.ano_modelo, v.loja_id, l.nome as loja_nome
       from veiculos v join lojas l on l.id = v.loja_id
      where v.ativo = true order by v.preco desc nulls last limit 1`);
  const exemplo = tipo === 'compra'
    ? {
        tipo: 'compra', canal: 'venda_site',
        cliente_nome: 'Exemplo de Cliente', cliente_telefone: '21999998888',
        cliente_email: 'cliente@exemplo.com',
        detalhes: { marca: 'FIAT', modelo: 'Argo Drive', ano: '2021', km: '48000', valor: '62.000', fotos: 4 }
      }
    : {
        tipo: 'venda', canal: 'formulario',
        loja_id: v && v.loja_id, veiculo_id: v && v.id,
        veiculo_nome: v ? [v.marca, v.modelo, v.ano_modelo].filter(Boolean).join(' ') : 'Veículo do anúncio',
        cliente_nome: 'Exemplo de Cliente', cliente_telefone: '21999998888',
        forma_compra: 'financiado', entrada: ' com entrada de 20.000'
      };
  await enviarEmailsLead(exemplo, true);
  res.json({ ok: true, tipo, enviadoPara: ACEIMA_MAIL, loja: v ? v.loja_nome : null, veiculo: exemplo.veiculo_nome || null });
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
    if (rota === 'parceiros') return await rotaParceiros(req, res);
    if (rota === 'veiculos') return await rotaVeiculos(req, res);
    if (rota === 'leads') return await rotaLeads(req, res);
    if (rota === 'importar') return await rotaImportar(req, res);
    if (rota === 'resumo') return autorizado(req) ? await rotaResumo(req, res) : negar(res);
    if (rota === 'refresh') return await rotaRefresh(req, res);
    if (rota === 'testeemail') return autorizado(req) ? await rotaTesteEmail(req, res) : negar(res);
    // login do painel: confere a senha sem nunca devolvê-la
    if (rota === 'auth') {
      const b = req.body || {};
      if (!PAINEL_TOKEN) return res.json({ ok: true, protegido: false });
      return (b.token === PAINEL_TOKEN) ? res.json({ ok: true, protegido: true }) : negar(res);
    }
    res.status(404).json({ erro: 'rota não encontrada', rota });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
}
