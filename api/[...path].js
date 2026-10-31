// ============================================================
//  Backend consolidado — site da Aceima
//  Uma única função "pega-tudo" que atende:
//    GET  /api/lojas            -> lista lojas ativas
//    POST /api/lojas            -> cadastra loja
//    PATCH/DELETE /api/lojas    -> edita / remove loja
//    GET  /api/veiculos?...     -> busca de veículos (filtros)
//    POST /api/veiculos         -> mostra/oculta um veículo no site
//    GET  /api/logo?id=ID       -> logo de uma loja, como imagem (?parceiro=Nome: de um credenciado)
//    GET  /api/parceiros?site=1 -> nota no Google e logo dos credenciados (serviços e comércio)
//    GET  /api/detalhe?id=ID    -> descrição do anúncio, lida no site da loja
//    GET/POST /api/leads        -> lista / grava lead
//    GET  /api/importar?loja=ID -> roda o robô (cron de hora em hora)
//    GET/POST /api/repasse      -> o Repasse das lojas (login próprio de cada loja; acao=acessos: o painel cria os acessos)
//    GET  /api/rfoto?id=ID      -> foto de um carro do Repasse
//
//  O robô lê o SITE PRÓPRIO de cada loja (ex.: autobarra.com.br) e,
//  por compatibilidade, também o portal por ID numérico (Luma Car #285).
// ============================================================
import { Pool } from '@neondatabase/serverless';
import * as cheerio from 'cheerio';
import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

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
  // nota do Google da loja, digitada pela Aceima no painel (o site só mostra o que está aqui)
  try { await query('alter table lojas add column if not exists google_nota numeric(2,1)'); } catch (_) {}
  try { await query('alter table lojas add column if not exists google_avaliacoes integer'); } catch (_) {}
  // quando a galeria de fotos foi lida pela última vez (para reler de tempos em tempos)
  try { await query('alter table veiculos add column if not exists galeria_em timestamptz'); } catch (_) {}
  // quilometragem absurda digitada pela loja (9.999.999) some da vitrine.
  // O que a loja publicou vale, inclusive 0 km — quem decide é o anúncio, não a gente.
  try { await query('update veiculos set km = null where km > 1500000'); } catch (_) {}
  try { await query('alter table lojas add column if not exists google_em timestamptz'); } catch (_) {}
  // primeira carga das notas do Google (levantadas uma a uma em 25/08/2026).
  // Só preenche o que está vazio: o que a Aceima digitar no painel nunca é sobrescrito aqui.
  try {
    const semente = [
      ['AG Rio Car',4.7,270],['Apollo Automóveis',4.5,952],['Astral Pickups',4.3,56],
      ['Auto Barra',4.8,469],['BitCar Automóveis',4.7,585],['Bragança Automóveis',4.4,96],
      ['FLX Multimarcas',4.7,266],['GTS IndyCar',4.8,75],['Garra Vip 4x4',4.4,251],
      ['Grande Estilo Veículos',4.3,21],['HiperCar',4.7,117],['Jay Motors',4.0,180],
      ['Jazz Veículos',4.5,5347],['Lazari',4.7,1227],['Lions Seminovos',4.8,7084],
      ['Luma Car',4.6,987],['Maiorano Veículos',4.8,36],['Perfil Multimarcas',3.5,113],
      ['Riomix Motos',4.6,168],['Robmar Automóveis',4.2,2492],['T.F.A. Motors',5.0,36],
      ['TurboMix Veículos',4.9,812]
    ];
    for (const [nome, nota, total] of semente) {
      await query('update lojas set google_nota=$2, google_avaliacoes=$3 where nome=$1 and google_nota is null',
        [nome, nota, total]);
    }
  } catch (_) {}
  // conserta o que a regra antiga quebrou: marca cortada no meio ("MERCEDES" + modelo "-BENZ")
  try {
    await query(`update veiculos set
        marca  = upper(marca) || upper(modelo),
        modelo = upper(split_part(coalesce(versao,''),' ',1)),
        versao = ltrim(substr(coalesce(versao,''), length(split_part(coalesce(versao,''),' ',1)) + 1))
      where modelo like '-%'`);
  } catch (_) {}
  // "0 km" em carro antigo é campo em branco na origem, não um zero de verdade
  try {
    await query('update veiculos set km = null where km = 0 and (ano_modelo is null or ano_modelo < $1)',
      [ANO_ZERO_KM()]);
  } catch (_) {}
  // por que o anúncio está oculto: null = nunca mexido, 'sem_foto' = o robô escondeu, 'manual' = a Aceima decidiu
  try { await query('alter table veiculos add column if not exists oculto_motivo text'); } catch (_) {}
  // cor de fundo da logo definida à mão pela Aceima (vence a detecção automática)
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
const REMETENTE = process.env.RESEND_FROM || 'Aceima <leads@aintendente.com.br>';
const REMETENTE_RESERVA = 'Aceima <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://aintendente.com.br';

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
// Só a Aceima pode escrever (cadastrar/editar/excluir loja, ocultar veículo, ver e mudar leads).
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
  // lead de "quero vender": vai para a Aceima e, em cópia oculta, para TODAS as lojas
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
  // pedido de associação (formulário do Seja um associado): só para a Aceima, com a empresa e o ramo
  if (lead.tipo === 'associacao') {
    const t = String(lead.cliente_telefone || '').replace(/\D/g, ''), wa = 'https://wa.me/' + (t.length > 11 ? t : '55' + t);
    const tb = t.length >= 10 ? '(' + t.slice(-11, -9) + ') ' + t.slice(-9, -4) + '-' + t.slice(-4) : (lead.cliente_telefone || '—');
    const empresa = det && det.empresa ? String(det.empresa) : '', ramo = det && det.ramo ? String(det.ramo) : '';
    const html = emailLayout({
      etiqueta: 'Quer se associar',
      titulo: 'Uma empresa quer se associar!',
      subtitulo: 'Confira os dados abaixo:',
      tabela: [linhaInfo('Nome', esc(lead.cliente_nome), true),
        linhaInfo('WhatsApp', `<a href="${wa}" style="color:#25a35a;text-decoration:none;font-weight:700">${esc(tb)}</a>`),
        linhaInfo('Empresa', esc(empresa)), linhaInfo('Ramo', esc(ramo))].join(''),
      botao: t ? { url: wa, texto: 'Falar no WhatsApp' } : null,
      aviso: null,
      rodape: 'Contato gerado pelo site da Aceima.'
    });
    const texto = ['Uma empresa quer se associar à Aceima, pelo site.', '', 'Nome: ' + (lead.cliente_nome || '-'), 'WhatsApp: ' + tb,
      empresa ? 'Empresa: ' + empresa : null, ramo ? 'Ramo: ' + ramo : null].filter(x => x !== null).join('\n');
    await enviarResend(key, { to: [ACEIMA_MAIL], reply_to: ACEIMA_MAIL, subject: 'Empresa quer se associar — via site da Aceima', text: texto, html });
    return;
  }

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
    ? 'Cliente quer VENDER um veículo — via site da Aceima'
    : 'Novo lead de venda — via site da Aceima';
  const linhas = [
    'Este é um cliente vindo do site da Aceima.', '',
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
    '', 'Mensagem enviada automaticamente pela Aceima.'
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
    rodape: 'Contato gerado pelo site da Aceima.'
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
  // maior primeiro: sem isso "MERCEDES" casava antes de "MERCEDES-BENZ" e o modelo virava "-BENZ"
  const marcas = uniqTexts($, 'a[href*="marca="]').map(t => t.toUpperCase()).sort((a, b) => b.length - a.length);
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

// Nota do Google da loja. Lê a ficha pública do Google e guarda nota + total de avaliações.
// Se o Google mudar o formato ou barrar a leitura, devolve null e o valor atual é mantido:
// nunca inventa nota e nunca apaga o que a Aceima digitou no painel.
async function notaGoogle(nome) {
  const url = 'https://www.google.com/search?hl=pt-BR&gl=br&q='
    + encodeURIComponent('"' + nome + '" Intendente Magalhães Rio de Janeiro');
  let html;
  try {
    const r = await fetch(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    } });
    if (!r.ok) return null;
    html = await r.text();
  } catch (_) { return null; }
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const m = texto.match(/(\d[.,]\d)\s*\(?\s*([\d.]{1,7})\s*\)?\s*avalia/i);
  if (!m) return null;
  const nota = parseFloat(m[1].replace(',', '.'));
  const total = parseInt(m[2].replace(/\./g, ''), 10);
  if (!(nota > 0 && nota <= 5) || !(total > 0)) return null;
  return { nota, total };
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
// O site pede lojas e estoque com site=1: só as colunas que ele usa, sempre a versão pública
// (nunca o que está oculto, mesmo com senha) e com cache na Vercel. O painel pede sem site=1
// e continua recebendo tudo, sem cache. Sem migra(): o site só lê colunas que já existem.
const doSite = req => !!(req.query && req.query.site === '1');
const CACHE_SITE = 's-maxage=300, stale-while-revalidate=86400';   // 5 min novo; depois disso, entrega o anterior na hora e atualiza por trás
async function rotaLojas(req, res) {
  if (req.method === 'GET' && doSite(req)) {
    // sem logo_url: os logos (imagens embutidas) eram quase todo o peso. A página do veículo pede a logo da loja sozinha (rota logo);
    // cor é o fundo da logo que a Aceima escolheu no painel
    const { rows } = await query('select id, nome, endereco, telefone, whatsapp, google_nota, google_avaliacoes, cor from lojas where ativa = true and nome <> all($1) order by nome', [FORA_DO_SITE]);
    res.setHeader('Cache-Control', CACHE_SITE);
    return res.json(rows);
  }
  await migra();
  if (req.method !== 'GET' && !autorizado(req)) return negar(res);
  if (req.method === 'GET') {
    const { rows } = await query('select * from lojas where ativa = true order by nome');
    // o painel conta as empresas como o site: sem as lojas que ficam fora dele
    return res.json(rows.map(l => ({ ...l, fora_do_site: FORA_DO_SITE.includes(l.nome) })));
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.nome) return res.status(400).json({ erro: 'nome é obrigatório' });
    const { rows: [loja] } = await query(
      `insert into lojas (nome, endereco, telefone, whatsapp, email, autocerto_id, autocerto_url, logo_url, google_nota, google_avaliacoes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [b.nome, b.endereco, b.telefone, b.whatsapp, b.email, b.autocerto_id, b.autocerto_url, b.logo_url || null,
       b.google_nota == null ? null : Number(b.google_nota), b.google_avaliacoes == null ? null : parseInt(b.google_avaliacoes)]);
    return res.status(201).json(loja);
  }
  if (req.method === 'PATCH') {
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    // a nota do Google vem do robô das avaliações: sem ela no pedido (o painel não manda), fica a que está
    const { rows: [loja] } = await query(
      `update lojas set nome=coalesce($2,nome), endereco=coalesce($3,endereco),
         telefone=coalesce($4,telefone), whatsapp=coalesce($5,whatsapp),
         email=coalesce($6,email), autocerto_id=coalesce($7,autocerto_id),
         logo_url=coalesce($8,logo_url),
         cor = case when $9::text is null then cor when $9 = '' then null else $9 end,
         google_nota = coalesce($10, google_nota), google_avaliacoes = coalesce($11, google_avaliacoes)
       where id=$1 returning *`,
      [b.id, b.nome, b.endereco, b.telefone, b.whatsapp, b.email, b.autocerto_id, b.logo_url || null,
       (b.cor === undefined ? null : String(b.cor)),
       b.google_nota == null ? null : Number(b.google_nota),
       b.google_avaliacoes == null ? null : parseInt(b.google_avaliacoes)]);
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

// o site digitado no painel sem o https:// ("frioline.com.br")
const siteCompleto = s => { s = String(s || '').trim(); return !s ? null : /^https?:\/\//i.test(s) ? s : 'https://' + s; };
// parceiros de serviço do polo — leitura pública, escrita só com token
async function rotaParceiros(req, res) {
  const painel = req.query && req.query.painel === '1';
  if (req.method === 'GET' && (doSite(req) || painel)) {
    // o site (e o painel, sem cache e com o id dos cadastrados por ele): a nota no Google e se tem logo, de cada credenciado (o robô das
    // avaliações guarda tudo em config), e os dados dos que o painel cadastrou. Sem migra()
    if (painel && !autorizado(req)) return negar(res);
    const [{ rows }, doPainel] = await Promise.all([
      query(`select chave, case when chave = 'avaliacoes_google' then valor end as valor, left(valor, 5) = 'data:' as tem
               from config where chave = 'avaliacoes_google' or chave like 'logo_parceiro:%'`),
      credenciadosDoPainel()]);
    const g = rows.find(r => r.chave === 'avaliacoes_google'), av = g && g.valor ? JSON.parse(g.valor) : {};
    const comLogo = new Set(rows.filter(r => r.chave.startsWith('logo_parceiro:') && r.tem).map(r => r.chave.slice(14)));
    const nota = n => ({ nota: (av[n] || {}).nota || null, total: (av[n] || {}).total || null });
    res.setHeader('Cache-Control', painel ? 'no-store' : CACHE_SITE);
    return res.json(PARCEIROS_ROBO.map(p => ({ nome: p.nome, ...nota(p.nome), logo: comLogo.has(p.nome), site: p.site || null, ramo: p.ramo, descricao: p.descricao }))
      .concat(doPainel.map(p => ({ nome: p.nome, ...nota(p.nome), logo: comLogo.has(p.nome) || p.tem_logo, site: p.site || null, ramo: p.ramo, descricao: p.descricao || '',
        endereco: p.endereco || '', telefone: p.telefone || '', whatsapp: p.whatsapp || '', painel: true, ...(painel ? { id: p.id } : {}) }))));
  }
  await migra();
  if (req.method === 'GET') {
    const { rows } = await query(
      `select * from parceiros ${autorizado(req) ? '' : 'where ativa = true'} order by ordem, nome`);
    return res.json(rows);
  }
  if (!autorizado(req)) return negar(res);
  const b = req.body || {};
  // o robô no credenciado que o painel acabou de cadastrar (ou de novo, quando o site muda)
  if (req.method === 'POST' && req.query && req.query.acao === 'ler') {
    const r = await lerCredenciado(parseInt(b.id, 10) || 0);
    return r ? res.json({ ok: true, ...r }) : res.status(404).json({ erro: 'credenciado não encontrado' });
  }
  if (req.method === 'POST') {
    if (!b.nome) return res.status(400).json({ erro: 'nome é obrigatório' });
    // o mesmo nome de um associado que já existe (loja ou credenciado) não entra duas vezes
    const nome = String(b.nome).trim(), mesmo = x => semAcento(x).replace(/[^a-z0-9]/g, '') === semAcento(nome).replace(/[^a-z0-9]/g, '');
    const { rows: ja } = await query(`select nome from lojas where ativa = true union all select nome from parceiros where ativa = true and coalesce(categoria, '') <> all($1)`, [CATS_ANTIGAS]);
    if (PARCEIROS_ROBO.some(p => mesmo(p.nome)) || ja.some(x => mesmo(x.nome))) return res.status(409).json({ erro: 'já existe um associado com esse nome' });
    const { rows: [p] } = await query(
      `insert into parceiros (nome, categoria, descricao, beneficio, endereco, telefone, whatsapp, site, logo_url, cor, ordem)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,100)) returning *`,
      [nome, b.categoria || 'servico', b.descricao, b.beneficio, b.endereco, b.telefone,
       b.whatsapp, siteCompleto(b.site), b.logo_url || null, b.cor || null, b.ordem]);
    return res.status(201).json(p);
  }
  if (req.method === 'PATCH') {
    if (!b.id) return res.status(400).json({ erro: 'id obrigatório' });
    if (b.site) b.site = siteCompleto(b.site);
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
  if (req.method === 'GET' && doSite(req)) {
    const { rows } = await query(
      `select v.id, v.loja_id, v.tipo, v.marca, v.modelo, v.versao, v.ano_modelo, v.ano_fabricacao, v.km, v.preco, v.cambio, v.combustivel, v.fotos, v.opcionais,
              l.nome as loja_nome, l.whatsapp as loja_whatsapp
         from veiculos v join lojas l on l.id = v.loja_id
        where v.ativo = true and coalesce(v.oculto,false) = false and l.nome <> all($1) order by v.sincronizado_em desc limit 3000`, [FORA_DO_SITE]);
    res.setHeader('Cache-Control', CACHE_SITE);
    return res.json(rows);
  }
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
  // senão a Aceima esconde um carro e nunca mais consegue trazer de volta
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
  // dados de cliente: só a Aceima lê e altera. O site continua podendo CRIAR lead (POST).
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
      // nota do Google: relê no máximo uma vez por semana para não pesar a importação
      try {
        const velha = !loja.google_em || (Date.now() - new Date(loja.google_em).getTime()) > 7 * 864e5;
        if (velha) {
          const g = await notaGoogle(loja.nome);
          if (g) await query('update lojas set google_nota=$2, google_avaliacoes=$3, google_em=now() where id=$1',
            [loja.id, g.nota, g.total]);
          else await query('update lojas set google_em=now() where id=$1', [loja.id]);
        }
      } catch (_) {}
      // ATENÇÃO: NÃO desativar tudo aqui. Se a função morrer no meio (loja grande),
      // o estoque inteiro ficaria fora do ar. A baixa acontece só no fim, e apenas
      // nos anúncios que realmente sumiram do site da loja.

      // quem já tem galeria salva não precisa da página de detalhes de novo.
      // Em loja grande (600 anúncios) buscar tudo estouraria o tempo da função:
      // a lista já traz preço/km/ano/foto principal, e as galerias entram aos poucos.
      const salvos = new Map();
      try {
        const { rows } = await query(
          `select autocerto_id, coalesce(array_length(fotos,1),0) as n, fotos[1] as capa, galeria_em
             from veiculos where loja_id = $1`, [loja.id]);
        rows.forEach(r => salvos.set(String(r.autocerto_id), r));
      } catch (_) {}
      const DIAS_RELEITURA = 7;
      const t0 = Date.now();
      const ORCAMENTO_MS = 20000;   // tempo máximo gasto abrindo páginas de detalhe
      let detalhesLidos = 0, detalhesPendentes = 0;

      for (const it of itens) {
        let extra = {};
        // Reabre a página de detalhes quando: é anúncio novo, ainda não tem galeria,
        // a FOTO DE CAPA mudou (sinal de que a loja trocou as imagens) ou a galeria
        // já está velha. Antes só entrava quem nunca teve galeria, então anúncio com
        // fotos trocadas ficava eternamente com as imagens antigas no nosso site.
        const antes = salvos.get(String(it.anuncioId));
        const capaMudou = !!(antes && it.img && antes.capa && antes.capa !== it.img);
        const galeriaVelha = !!(antes && (!antes.galeria_em ||
          (Date.now() - new Date(antes.galeria_em).getTime()) > DIAS_RELEITURA * 864e5));
        const precisaDetalhe = !antes || antes.n <= 1 || capaMudou || galeriaVelha;
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
          `insert into veiculos (loja_id, autocerto_id, marca, modelo, versao, ano_fabricacao, ano_modelo, km, preco, cambio, combustivel, opcionais, fotos, tipo, oculto, oculto_motivo, ativo, sincronizado_em, galeria_em)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                   coalesce(array_length($13::text[],1),0) <= 1,
                   case when coalesce(array_length($13::text[],1),0) <= 1 then 'sem_foto' else null end,
                   true, now(), case when $15::boolean then now() else null end)
           on conflict (loja_id, autocerto_id) do update set
             marca=excluded.marca, modelo=excluded.modelo, versao=excluded.versao,
             ano_fabricacao=excluded.ano_fabricacao, ano_modelo=excluded.ano_modelo,
             km=excluded.km, preco=excluded.preco, cambio=excluded.cambio,
             combustivel=excluded.combustivel,
             -- não apaga galeria/opcionais já salvos quando a rodada não abriu o detalhe
             opcionais = case when coalesce(array_length(excluded.opcionais,1),0) > 0
                              then excluded.opcionais else veiculos.opcionais end,
             -- leitura de verdade manda, mesmo se a loja tiver reduzido o número de fotos
             fotos = case
                 when $15::boolean and coalesce(array_length(excluded.fotos,1),0) > 0 then excluded.fotos
                 when coalesce(array_length(excluded.fotos,1),0) >= coalesce(array_length(veiculos.fotos,1),0)
                      then excluded.fotos else veiculos.fotos end,
             galeria_em = case when $15::boolean then now() else veiculos.galeria_em end,
             tipo=excluded.tipo, ativo=true, sincronizado_em=now(),
             -- escondido por falta de foto volta sozinho quando a loja publica a imagem;
             -- decisão manual da Aceima ('manual') o robô nunca desfaz
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

// resumo diário para a Aceima
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
    'Resumo das últimas 24h — site da Aceima', '',
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
    botao: { url: SITE_URL + '/painel', texto: 'Abrir o painel da Aceima' },
    rodape: null
  });

  const key = process.env.RESEND_API_KEY;
  if (key) {
    await enviarResend(key, { to: [ACEIMA_MAIL], subject: 'Resumo diário — site da Aceima', text: linhas.join('\n'), html });
  }
  return { enviado: !!key, para: ACEIMA_MAIL, resumo: linhas };
}
async function rotaResumo(req, res) {
  await migra();
  res.json({ ok: true, ...(await enviarResumo()) });
}

// envia um e-mail de lead de EXEMPLO só para a Aceima, para conferir o layout.
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

// ---------------- CONTEÚDO (modo de edição do site) ----------------
// O modo de edição (/?editar) grava textos e estilos em conteudo.js, direto no GitHub,
// no mesmo ramo desta publicação: editar na prévia não mexe no site no ar.
// Precisa da variável GITHUB_TOKEN na Vercel (token do GitHub com escrita em Contents deste repositório).
const CAMPOS_CONTEUDO = ['texto', 'tam', 'cor', 'fonte', 'peso'];
async function rotaConteudo(req, res) {
  const token = process.env.GITHUB_TOKEN, ramo = process.env.VERCEL_GIT_COMMIT_REF;
  if (req.method === 'GET') return res.json({ ok: true, ramo: ramo || null, pronto: !!(token && ramo) });
  if (req.method !== 'POST') return res.status(405).json({ erro: 'método não permitido' });
  if (!token || !ramo) return res.status(500).json({ erro: 'falta configurar o GITHUB_TOKEN na Vercel' });
  const repo = `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`;
  const url = `https://api.github.com/repos/${repo}/contents/conteudo.js`;
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'aceima-site' };
  // lê a versão atual do ramo e aplica só o que mudou (outra aba pode ter salvo antes)
  const g = await fetch(`${url}?ref=${encodeURIComponent(ramo)}`, { headers: h });
  if (!g.ok && g.status !== 404) return res.status(502).json({ erro: `o GitHub respondeu ${g.status} ao ler` });
  let atual = {}, sha;
  if (g.ok) {
    const j = await g.json(); sha = j.sha;
    const txt = Buffer.from(j.content, 'base64').toString('utf8');
    atual = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  }
  const ids = [];
  for (const [id, v] of Object.entries((req.body && req.body.mudancas) || {})) {
    if (!/^[\w.-]+$/.test(id)) continue;
    ids.push(id);
    if (v && typeof v === 'object') atual[id] = Object.fromEntries(Object.entries(v).filter(([k]) => CAMPOS_CONTEUDO.includes(k)));
    else delete atual[id];
  }
  if (!ids.length) return res.json({ ok: true, ramo });
  const corpo = '// Textos e estilos do site, editados no modo de edição (/?editar).\n' +
    '// Cada chave é um texto do index.html. O que não está aqui usa o texto padrão.\n' +
    'window.CONTEUDO = ' + JSON.stringify(atual, null, 2) + ';\n';
  const p = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({
    message: ('Modo de edição: ' + ids.join(', ')).slice(0, 200),
    content: Buffer.from(corpo).toString('base64'), sha, branch: ramo }) });
  if (!p.ok) return res.status(502).json({ erro: `o GitHub respondeu ${p.status} ao gravar` });
  res.json({ ok: true, ramo });
}

// ---------------- PUBLICAÇÕES (painel) ----------------
// As publicações ficam em publicacoes.json, no próprio site, e as fotos em fotos-publicacoes/ (pedido do Luiz, 16/10/2026: a parte das
// publicações no painel). O painel grava direto no GitHub, no mesmo ramo desta publicação, como o modo de edição: editar na prévia não
// mexe no site no ar, e nada muda no banco. Cada gravação é um commit só, com a lista e a foto juntas, e a Vercel publica o site em
// cerca de um minuto. Se outro commit entrar no meio (um texto salvo pelo modo de edição), a gravação é refeita em cima dele.
const CATEGORIAS_PUB = ['Ações no polo', 'Conquistas', 'Comunicados', 'Imprensa'];
const slugPub = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'publicacao';
function limparPub(p) {
  const txt = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
  return {
    titulo: txt(p.titulo, 160),
    categoria: CATEGORIAS_PUB.includes(p.categoria) ? p.categoria : CATEGORIAS_PUB[0],
    data: /^\d{4}-\d{2}-\d{2}$/.test(String(p.data || '')) ? p.data : new Date().toISOString().slice(0, 10),
    texto: txt(p.texto, 20000),   // o resumo saiu (pedido do Luiz, 22/10/2026: eram dois textos)
    destaque: !!p.destaque,
  };
}
async function rotaPublicacoes(req, res) {
  const token = process.env.GITHUB_TOKEN, ramo = process.env.VERCEL_GIT_COMMIT_REF;
  if (!token || !ramo || !/^[\w./-]+$/.test(ramo)) return res.status(500).json({ erro: 'falta configurar o GITHUB_TOKEN na Vercel' });
  const repo = `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`;
  const gh = (caminho, metodo, corpo) => fetch(`https://api.github.com/repos/${repo}/${caminho}`, { method: metodo || 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'aceima-site', 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined });
  // a lista como está num commit (o arquivo ainda pode não existir)
  const lerLista = async ref => {
    const r = await gh(`contents/publicacoes.json?ref=${encodeURIComponent(ref)}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`o GitHub respondeu ${r.status} ao ler as publicações`);
    const lista = JSON.parse(Buffer.from((await r.json()).content, 'base64').toString('utf8'));
    return Array.isArray(lista) ? lista : [];
  };
  if (req.method === 'GET') return res.json({ ok: true, ramo, publicacoes: await lerLista(ramo) });
  if (req.method !== 'POST') return res.status(405).json({ erro: 'método não permitido' });
  const b = req.body || {};
  // as fotos chegam já diminuídas pelo painel (webp ou jpg, com no máximo 1600 px no lado maior)
  const lerFoto = d => {
    const m = String(d).match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { erro: 400 };
    if (m[2].length > 4e6) return { erro: 413 };
    return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], base64: m[2] };
  };
  const recusa = e => res.status(e).json({ erro: e === 413 ? 'foto grande demais' : 'foto em formato inválido' });
  let foto = null;
  if (b.foto) { foto = lerFoto(b.foto); if (foto.erro) return recusa(foto.erro); }
  // mais de uma foto (pedido do Luiz, 21/10/2026): a lista na ordem do painel, a primeira é a capa. Cada item é uma foto que já está no
  // site ({ caminho }) ou uma nova ({ nova: data URI })
  const fotosPedidas = Array.isArray(b.fotos) ? b.fotos.slice(0, 12) : null;
  if (fotosPedidas) for (const f of fotosPedidas) if (f && f.nova) { const x = lerFoto(f.nova); if (x.erro) return recusa(x.erro); f.lida = x; }
  const fotosDe = p => Array.isArray(p.fotos) ? p.fotos : (p.foto ? [p.foto] : []);
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const ref = await gh(`git/ref/heads/${ramo}`);
    if (!ref.ok) return res.status(502).json({ erro: `o GitHub respondeu ${ref.status} ao ler o ramo` });
    const base = (await ref.json()).object.sha;
    const lista = await lerLista(base);
    const arquivos = [];   // { path, conteudo } (base64) ou { path, apagar: true }
    const usada = (caminho, menos) => lista.some(x => x !== menos && fotosDe(x).includes(caminho));
    let msg, pub = null;
    if (b.acao === 'excluir') {
      const i = lista.findIndex(x => x.id === b.id);
      if (i < 0) return res.status(404).json({ erro: 'publicação não encontrada' });
      const [velha] = lista.splice(i, 1);
      fotosDe(velha).forEach(f => { if (!usada(f)) arquivos.push({ path: f, apagar: true }); });
      msg = `Publicações: excluída "${velha.titulo}"`;
    } else if (b.acao === 'salvar') {
      const dados = limparPub(b.pub || {});
      if (!dados.titulo) return res.status(400).json({ erro: 'falta o título' });
      const velha = b.pub && b.pub.id ? lista.find(x => x.id === b.pub.id) : null;
      if (b.pub && b.pub.id && !velha) return res.status(404).json({ erro: 'publicação não encontrada' });
      let id = velha ? velha.id : `${dados.data}-${slugPub(dados.titulo)}`;
      if (!velha) { const raiz = id; for (let n = 2; lista.some(x => x.id === id); n++) id = `${raiz}-${n}`; }
      // a publicação editada deixa de ser exemplo; a foto antiga sai quando chega outra ou quando é tirada
      pub = { id, ...dados, foto: velha && velha.foto || null };
      if (fotosPedidas) {
        // as que ficam, as novas na ordem pedida, e as que saíram (se nenhuma outra publicação usa) vão embora no mesmo commit
        const antigas = velha ? fotosDe(velha) : [], novas = [], marca = Date.now().toString(36);
        fotosPedidas.forEach((f, k) => {
          if (f && f.caminho && antigas.includes(f.caminho) && !novas.includes(f.caminho)) novas.push(f.caminho);
          else if (f && f.lida) { const c = `fotos-publicacoes/${id}-${marca}-${k + 1}.${f.lida.ext}`; arquivos.push({ path: c, conteudo: f.lida.base64 }); novas.push(c); }
        });
        antigas.forEach(f => { if (!novas.includes(f) && !usada(f, velha)) arquivos.push({ path: f, apagar: true }); });
        pub.foto = novas[0] || null; pub.fotos = novas;
      } else {
        if ((foto || b.tirarFoto) && pub.foto) { if (!usada(pub.foto, velha)) arquivos.push({ path: pub.foto, apagar: true }); pub.foto = null; }
        if (foto) { pub.foto = `fotos-publicacoes/${id}-${Date.now().toString(36)}.${foto.ext}`; arquivos.push({ path: pub.foto, conteudo: foto.base64 }); }
        if (velha && Array.isArray(velha.fotos)) pub.fotos = [pub.foto, ...velha.fotos.slice(1)].filter(Boolean);
      }
      if (pub.destaque) lista.forEach(x => { x.destaque = false; });   // um destaque só
      if (velha) lista[lista.indexOf(velha)] = pub; else lista.push(pub);
      msg = `Publicações: ${velha ? 'editada' : 'nova'} "${pub.titulo}"`;
    } else return res.status(400).json({ erro: 'ação desconhecida' });
    lista.sort((x, y) => String(y.data).localeCompare(String(x.data)) || String(x.titulo).localeCompare(String(y.titulo), 'pt-BR'));
    arquivos.push({ path: 'publicacoes.json', conteudo: Buffer.from(JSON.stringify(lista, null, 2) + '\n').toString('base64') });
    // um commit só: os arquivos novos viram blobs e a árvore nova parte da do commit atual
    const arvore = [];
    for (const a of arquivos) {
      if (a.apagar) { arvore.push({ path: a.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const bl = await gh('git/blobs', 'POST', { content: a.conteudo, encoding: 'base64' });
      if (!bl.ok) return res.status(502).json({ erro: `o GitHub respondeu ${bl.status} ao gravar um arquivo` });
      arvore.push({ path: a.path, mode: '100644', type: 'blob', sha: (await bl.json()).sha });
    }
    const cm = await gh(`git/commits/${base}`);
    if (!cm.ok) return res.status(502).json({ erro: `o GitHub respondeu ${cm.status} ao ler o commit` });
    const tr = await gh('git/trees', 'POST', { base_tree: (await cm.json()).tree.sha, tree: arvore });
    if (!tr.ok) return res.status(502).json({ erro: `o GitHub respondeu ${tr.status} ao montar a árvore` });
    const nc = await gh('git/commits', 'POST', { message: msg.slice(0, 200), tree: (await tr.json()).sha, parents: [base] });
    if (!nc.ok) return res.status(502).json({ erro: `o GitHub respondeu ${nc.status} ao criar o commit` });
    const up = await gh(`git/refs/heads/${ramo}`, 'PATCH', { sha: (await nc.json()).sha, force: false });
    if (up.ok) return res.json({ ok: true, ramo, publicacoes: lista, publicacao: pub });
    if (up.status !== 422 && up.status !== 409) return res.status(502).json({ erro: `o GitHub respondeu ${up.status} ao gravar` });
  }
  res.status(409).json({ erro: 'o site mudou várias vezes seguidas enquanto gravava; tente de novo' });
}

// ---------------- AVALIAÇÕES DO GOOGLE (faixa da home e notas dos associados) ----------------
// Avaliações reais de cada associado, pela API oficial do Google (Places API New): até 5 por associado.
// Uma vez por dia atualiza até 30 associados, os mais antigos primeiro (uma consulta por associado). Associado que nunca foi
// consultado (um credenciado novo) entra na hora, dentro do mesmo limite de 30 consultas em 24 horas.
// Com 22 lojas e 4 credenciados, todos são atualizados todo dia. Passando de 30, os outros entram nos dias seguintes.
// Nas lojas, a mesma consulta atualiza a nota e o total de avaliações (tabela lojas); nos credenciados, a nota fica junto das
// avaliações, em config. A logo dos credenciados é lida no site de cada um (logosDosParceiros).
// Precisa da variável GOOGLE_PLACES_KEY na Vercel. Sem ela, a faixa não aparece.
const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// lojas que estão no banco e ficam fora do site e do robô (pedido do Luiz, 07/10/2026). O painel continua vendo
const FORA_DO_SITE = ['Lions Seminovos'];
// associados que não são lojas de carro: os mesmos do PARCEIROS do index.html, com o mesmo nome (pedido do Luiz, 07/10/2026)
// site: onde o robô lê a logo. A SISV não tem site nem logo (fica com as iniciais); o do R21 é o r21.com.br (Luiz, 13/10/2026)
// descricao: a descrição curta que o painel mostra (o resumo do texto de cada um no site; pedido do Luiz, 21/10/2026)
const PARCEIROS_ROBO = [
  { nome: 'LaudoCar', site: 'https://laudocarrj.com.br/', ramo: 'Serviços Automotivos',
    descricao: 'Vistoria cautelar: confere estrutura, numerações e o histórico do veículo antes de fechar negócio.' },
  { nome: 'SISV Inspeção Veicular', ramo: 'Serviços Automotivos',
    descricao: 'Inspeção veicular exigida pelo Detran para carros com GNV, sinistrados, blindados ou com característica alterada.' },
  { nome: 'Frioline', site: 'https://www.frioline.com.br/', ramo: 'Serviços Automotivos',
    descricao: 'Ar-condicionado automotivo, com instalação e manutenção em linha nacional e importada.' },
  { nome: 'R21 Bar & Restaurante', site: 'https://r21.com.br/', ramo: 'Alimentício',
    descricao: 'Bar e restaurante com almoço, jantar, música ao vivo e espaço kids.' }
];
// credenciados cadastrados pelo painel (pedido do Luiz, 21/10/2026: no cadastro, o ramo; o que não é loja de automóveis vira credenciado,
// e o robô não lê estoque, só as avaliações e os dados da empresa). Ficam na tabela parceiros, com o ramo em "categoria". As linhas
// antigas dessa tabela (as quatro do começo, com as categorias antigas) não aparecem: os quatro credenciados de antes estão acima
const CATS_ANTIGAS = ['vistoria', 'manutencao', 'alimentacao', 'servico'];
async function credenciadosDoPainel() {
  try {
    const { rows } = await query(`select id, nome, categoria as ramo, descricao, endereco, telefone, whatsapp, site, logo_url is not null as tem_logo
                                    from parceiros where ativa = true and coalesce(categoria, '') <> all($1) order by nome`, [CATS_ANTIGAS]);
    return rows.filter(r => !PARCEIROS_ROBO.some(p => p.nome === r.nome));
  } catch (_) { return []; }
}
// todos os credenciados, para os robôs das avaliações e da logo. Sem o id: o robô das avaliações usa o id para gravar a nota na tabela lojas
async function credenciados() {
  return PARCEIROS_ROBO.concat((await credenciadosDoPainel()).map(r => ({ nome: r.nome, site: r.site || undefined })));
}
// a descrição curta e os contatos lidos no site de um credenciado novo. A descrição é a da página (a primeira frase) ou, sem ela, o título
// sem o nome da empresa ("Ar condicionado para veículos | FRIOLINE" vira "Ar condicionado para veículos.")
async function infoDoSite(site, nome) {
  try {
    const r = await fetch(site, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ACEIMA-Importer/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { erro: 'HTTP ' + r.status };
    const $ = cheerio.load(await r.text());
    const chave = palavraChave(nome) || '', temNome = t => !!chave && semAcento(t).replace(/[^a-z0-9]/g, '').includes(chave);
    let descricao = '';
    const meta = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').replace(/\s+/g, ' ').trim();
    if (meta.length >= 25 && meta.length <= 300 && !/(\[…\]|\[\.\.\.\]|…)$/.test(meta)) descricao = (meta.match(/^.{25,170}?[.!?](?=\s|$)/) || [meta.slice(0, 170)])[0];
    if (!descricao) {
      // a parte do título que diz o que a empresa faz: sem o nome dela, sem "Início" e sem o lugar ("Vila Valqueire (RJ)")
      const parte = $('title').first().text().replace(/\s+/g, ' ').split(/\s+[|–—-]\s+|\s*\|\s*/).map(s => s.trim())
        .find(s => s.split(' ').length >= 2 && !temNome(s) && !/^(home|in[íi]cio|p[áa]gina inicial|bem[- ]vindo)/i.test(s)
          && !/\b(rj|rio de janeiro|vila valqueire|madureira|bento ribeiro|campinho|cascadura|oswaldo cruz|jacarepagu[áa]|grupo)\b/i.test(semAcento(s)));
      // título em maiúsculas iniciais ("Vistoria Cautelar Premium") vira frase; sigla fica como está
      if (parte) descricao = parte.split(' ').map((w, i) => i && !/^[A-Z0-9]{2,}$/.test(w) ? w.toLowerCase() : w).join(' ');
    }
    if (descricao) { descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1); if (!/[.!?]$/.test(descricao)) descricao += '.'; }
    const c = pegarContato($);   // endereço e telefone escritos na página e o WhatsApp dos links
    const tel = d => { d = String(d || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 10 || d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : null; };
    let telefone = tel(c.telefone);
    if (!telefone) telefone = $('a[href^="tel:"]').map((_, e) => tel($(e).attr('href'))).get().find(Boolean) || null;
    let endereco = c.endereco && c.endereco.replace(/\s*-?\s*\d{5}-?\d{3}\s*$/, '');   // sem o CEP no fim
    if (!endereco) {
      const m = $('body').text().replace(/\s+/g, ' ').match(/(?:Estrada|Est\.?)\s+Intendente\s+Magalh[ãa]es,?\s*(?:n[º°o.]*\s*)?(\d{1,5})(?:\s*[-–,]\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+)?))?/);
      if (m) endereco = `Estrada Intendente Magalhães, ${m[1]}${m[2] ? ', ' + m[2] : ''}`;
    }
    return { ok: true, descricao, telefone, whatsapp: c.whatsapp || null, endereco: endereco || null };
  } catch (e) { return { erro: e.message }; }
}
// o robô no credenciado novo: a descrição e os contatos (só o que estiver vazio: o que a Aceima escreveu no painel vale); a logo e as
// avaliações vêm pelas leituras de sempre, que já incluem o credenciado novo (dentro do limite de consultas ao Google do dia)
async function lerCredenciado(id) {
  const { rows: [p] } = await query('select * from parceiros where id = $1', [id]);
  if (!p) return null;
  const info = p.site ? await infoDoSite(p.site, p.nome) : {};
  const { rows: [atual] } = await query(`update parceiros set descricao = coalesce(nullif(descricao, ''), $2), telefone = coalesce(nullif(telefone, ''), $3),
      whatsapp = coalesce(nullif(whatsapp, ''), $4), endereco = coalesce(nullif(endereco, ''), $5) where id = $1 returning *`,
    [id, info.descricao || null, info.telefone || null, info.whatsapp || null, info.endereco || null]);
  try { await avaliacoesGoogle(); } catch (_) {}
  const { rows } = await query(`select chave, case when chave = 'avaliacoes_google' then valor end as valor, left(valor, 5) = 'data:' as tem
                                  from config where chave = 'avaliacoes_google' or chave = $1`, ['logo_parceiro:' + p.nome]);
  const g = rows.find(r => r.chave === 'avaliacoes_google'), av = (g && g.valor ? JSON.parse(g.valor) : {})[p.nome] || {};
  return { parceiro: atual, nota: av.nota || null, total: av.total || null, logo: !!atual.logo_url || rows.some(r => r.chave !== 'avaliacoes_google' && r.tem),
    erroSite: p.site && !info.ok ? (info.erro || 'o site não respondeu') : null };
}
const NOMES_GENERICOS = ['auto', 'car', 'veiculos', 'automoveis', 'motors', 'motos', 'multimarcas', 'seminovos'];
// a palavra principal do nome ("laudocar", "r21"): a primeira com mais de duas letras que não é genérica
const palavraChave = nome => semAcento(nome).replace(/[^a-z0-9 ]/g, '').split(' ').find(w => w.length > 2 && !NOMES_GENERICOS.includes(w));
// confere se o Google achou a loja certa: a palavra principal do nome tem que aparecer no nome do Google
function mesmaLoja(nosso, google) {
  const chave = palavraChave(nosso);
  return !!chave && semAcento(google).replace(/[^a-z0-9]/g, '').includes(chave);
}
// devolve { lista, nota, total } do associado (lista vazia se o Google não achou), ou null se a consulta falhou
async function avaliacoesDaLoja(loja, chave) {
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': chave,
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.reviews' },
      body: JSON.stringify({ textQuery: `${loja.nome}, Estrada Intendente Magalhães, Rio de Janeiro`,
        languageCode: 'pt-BR', regionCode: 'BR', pageSize: 1,
        locationBias: { circle: { center: { latitude: -22.8775, longitude: -43.3505 }, radius: 4000 } } })
    });
    if (!r.ok) return null;
    const p = ((await r.json()).places || [])[0];
    if (!p || !mesmaLoja(loja.nome, p.displayName && p.displayName.text)) return { lista: [], nota: null, total: null };
    if (p.rating && loja.id) await query('update lojas set google_nota=$2, google_avaliacoes=$3, google_em=now() where id=$1',
      [loja.id, p.rating, p.userRatingCount || null]);
    // só as boas (4 e 5 estrelas) e com texto
    return { nota: p.rating || null, total: p.userRatingCount || null,
      lista: (p.reviews || []).filter(v => v.rating >= 4 && v.text && v.text.text && v.authorAttribution)
        .map(v => ({ loja: loja.nome, autor: v.authorAttribution.displayName || '', foto: v.authorAttribution.photoUri || '',
          texto: v.text.text, link: v.googleMapsUri || v.authorAttribution.uri || '' })) };
  } catch (_) { return null; }
}
async function avaliacoesGoogle() {
  const { rows: [c] } = await query("select valor, em from config where chave='avaliacoes_google'");
  const guardadas = c ? JSON.parse(c.valor) : {};   // { nome do associado: { em, lista, nota, total } }
  const todas = () => Object.entries(guardadas).filter(([nome]) => !FORA_DO_SITE.includes(nome)).flatMap(([, g]) => g.lista);
  const chave = process.env.GOOGLE_PLACES_KEY;
  const recente = c && Date.now() - new Date(c.em).getTime() < 864e5;   // a atualização do dia já foi feita
  const parc = await credenciados();   // os de sempre e os cadastrados pelo painel
  const novos = parc.filter(p => !guardadas[p.nome]);
  try { await logosDosParceiros(parc); } catch (_) {}
  if (!chave || (recente && !novos.length)) return todas();
  if (!recente) await migra();   // só a atualização do dia precisa das colunas novas: quem só lê as avaliações não espera as migrações (eram 3s na primeira visita)
  const { rows: lojas } = await query('select id, nome from lojas where ativa = true and nome <> all($1)', [FORA_DO_SITE]);
  const associados = lojas.concat(parc);
  const LIMITE_DIA = 30;   // consultas ao Google em 24 horas. NUNCA subir sem autorização do Luiz.
  const idade = l => guardadas[l.nome] ? new Date(guardadas[l.nome].em).getTime() : 0;
  const feitas = Object.values(guardadas).filter(g => Date.now() - new Date(g.em).getTime() < 864e5).length;   // consultas das últimas 24 horas
  const vez = recente ? novos.slice(0, Math.max(0, LIMITE_DIA - feitas)) : associados.sort((a, b) => idade(a) - idade(b)).slice(0, LIMITE_DIA);
  if (!vez.length) return todas();
  const achadas = await Promise.all(vez.map(l => avaliacoesDaLoja(l, chave)));
  // tudo falhou na atualização do dia (chave errada, cota do dia no fim, Google fora do ar): tenta de novo na próxima visita; erro não é cobrado
  if (!recente && achadas.every(x => x === null)) return todas();
  // quem falhou fica com o que tinha; associado que nunca tinha sido consultado fica marcado, sem avaliações, e entra de novo na atualização
  // do dia seguinte (senão a consulta dele se repetiria a cada visita)
  const agora = new Date().toISOString();
  achadas.forEach((x, i) => { const n = vez[i].nome;
    if (x !== null) guardadas[n] = { em: agora, lista: x.lista, nota: x.nota, total: x.total };
    else if (!guardadas[n]) guardadas[n] = { em: agora, lista: [], nota: null, total: null }; });
  if (!recente) for (const nome of Object.keys(guardadas)) if (!associados.some(l => l.nome === nome)) delete guardadas[nome];   // saiu da associação
  await query("insert into config (chave, valor, em) values ('avaliacoes_google', $1, now()) on conflict (chave) do update set valor = $1, em = now()",
    [JSON.stringify(guardadas)]);
  return todas();
}
// logo dos credenciados, lida no site de cada um e guardada em config ('logo_parceiro:Nome', em data URI). Achada, é lida de novo em
// 30 dias; não achada, fica marcado o site que foi lido ('sem:' + site) e ela é procurada de novo em 3 dias, ou logo que o site mudar.
// Uma leitura que falha não apaga a logo que já estava guardada. Credenciado sem site não é lido
async function logosDosParceiros(lista) {
  const { rows } = await query(`select chave, em, left(valor, 5) = 'data:' as tem, case when valor like 'sem:%' then valor end as lido
                                  from config where chave like 'logo_parceiro:%'`);
  const vez = (lista || PARCEIROS_ROBO).filter(p => { if (!p.site) return false;
    const r = rows.find(x => x.chave === 'logo_parceiro:' + p.nome);
    return !r || Date.now() - new Date(r.em).getTime() > (r.tem ? 30 : 3) * 864e5 || (!r.tem && r.lido !== 'sem:' + p.site); });
  await Promise.all(vez.map(async p => {
    const logo = await logoDoParceiro(p);
    await query(`insert into config (chave, valor, em) values ($1, $2, now()) on conflict (chave) do update
                   set valor = case when $2 like 'data:%' or config.valor not like 'data:%' then $2 else config.valor end, em = now()`,
      ['logo_parceiro:' + p.nome, logo || 'sem:' + p.site]);
  }));
}
// a logo no site do credenciado: a primeira imagem com "logo" no endereço, no texto alternativo ou na classe, e com o nome dele no
// endereço ou no texto alternativo (assim não pega a logo do grupo nem a do sistema de reservas). null se não achou
async function logoDoParceiro(p) {
  const chave = palavraChave(p.nome);
  if (!chave || !p.site) return null;
  try {
    const h = { 'User-Agent': 'Mozilla/5.0 (compatible; ACEIMA-Importer/1.0)' };
    const r = await fetch(p.site, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const $ = cheerio.load(await r.text());
    let src = null;
    $('img').each((_, e) => {
      if (src) return;
      const u = $(e).attr('src') || $(e).attr('data-src') || '', alt = $(e).attr('alt') || '', cl = $(e).attr('class') || '';
      if (!/logo/i.test(u + ' ' + alt + ' ' + cl) || !semAcento(u + ' ' + alt).replace(/[^a-z0-9]/g, '').includes(chave)) return;
      // com várias resoluções (srcset), a menor que tenha pelo menos 600 px de largura: a maior pesaria à toa (a do R21 tem 2560 px)
      const op = String($(e).attr('srcset') || '').split(',').map(x => x.trim().split(/\s+/)).filter(x => x[0] && /^\d+w$/.test(x[1] || ''))
        .map(x => [x[0], parseInt(x[1], 10)]).sort((a, b) => a[1] - b[1]);
      src = (op.find(x => x[1] >= 600) || op[op.length - 1] || [u])[0];
    });
    if (!src) return null;
    const i = await fetch(new URL(src, r.url || p.site).href, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const ct = (i.headers.get('content-type') || '').split(';')[0].trim();
    if (!i.ok || !/^image\//.test(ct)) return null;
    const buf = Buffer.from(await i.arrayBuffer());
    return buf.length && buf.length <= 300000 ? `data:${ct};base64,${buf.toString('base64')}` : null;
  } catch (_) { return null; }
}

// ---------------- VISITAS (os gráficos da visão geral do painel) ----------------
// O site conta as visitas para os gráficos do painel (pedido do Luiz, 21/10/2026): cada página vista é uma linha, com a sessão (um número
// que o site sorteia e que some quando a aba fecha), a página, o carro (na página do veículo), o tempo nela, o tipo de aparelho e, na
// primeira página da sessão, de onde a pessoa veio. As buscas do estoque ficam numa tabela à parte. Nada pessoal: sem IP, sem nome e sem
// nada guardado no aparelho. As duas tabelas são criadas na primeira visita
let visitasProntas = false;
async function tabelasVisitas() {
  if (visitasProntas) return;
  await query(`create table if not exists visitas (
    id bigserial primary key, sessao text not null, vista int not null, pagina text not null, ref text, veiculo_id int,
    segundos int not null default 0, origem text, aparelho text, criado_em timestamptz not null default now(), unique (sessao, vista))`);
  await query('create index if not exists visitas_criado_em on visitas (criado_em)');
  await query('create table if not exists buscas (id bigserial primary key, sessao text, termo text not null, criado_em timestamptz not null default now())');
  await query('create index if not exists buscas_criado_em on buscas (criado_em)');
  visitasProntas = true;
}
const PAGINAS_SITE = ['home', 'estoque', 'associados', 'veiculo', 'aceima', 'associar', 'publicacoes', 'publicacao', 'servicos'];
const APARELHOS = ['Celular', 'Tablet', 'Computador'];
const ORIGENS = ['Google', 'Instagram', 'Facebook', 'WhatsApp', 'YouTube', 'TikTok', 'Bing', 'Direto', 'Outros sites'];
// o site manda pelo sendBeacon (o corpo pode chegar como texto). Pedido fora do formato é ignorado em silêncio
async function rotaVisita(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  const s = String(b.s || '');
  if (!/^[a-z0-9]{8,40}$/.test(s)) return res.status(204).end();
  await tabelasVisitas();
  if (b.busca != null) {
    const termo = String(b.busca).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
    if (termo.length >= 2) await query('insert into buscas (sessao, termo) values ($1, $2)', [s, termo]);
    return res.status(204).end();
  }
  const n = parseInt(b.n, 10), pg = String(b.pg || '');
  if (!(n >= 1 && n <= 1000) || !PAGINAS_SITE.includes(pg)) return res.status(204).end();
  const ref = b.ref == null || b.ref === '' ? null : String(b.ref).slice(0, 120);
  // a mesma página manda o tempo de novo quando a aba some e volta: fica o maior
  await query(`insert into visitas (sessao, vista, pagina, ref, veiculo_id, segundos, origem, aparelho) values ($1, $2, $3, $4, $5, $6, $7, $8)
                 on conflict (sessao, vista) do update set segundos = greatest(visitas.segundos, excluded.segundos)`,
    [s, n, pg, ref, pg === 'veiculo' ? (parseInt(ref, 10) || null) : null,
     Math.max(0, Math.min(1800, parseInt(b.seg, 10) || 0)),   // mais de meia hora parada numa página conta meia hora
     n === 1 && ORIGENS.includes(b.o) ? b.o : null, APARELHOS.includes(b.ap) ? b.ap : null]);
  return res.status(204).end();
}
// os números dos gráficos: o período escolhido no painel (7, 30 ou 90 dias) e o anterior, do mesmo tamanho, para comparar
async function rotaVisitas(req, res) {
  await tabelasVisitas();
  const dias = [7, 30, 90].includes(parseInt(req.query && req.query.dias, 10)) ? parseInt(req.query.dias, 10) : 30;
  const ini = `now() - interval '${dias} days'`, ini2 = `now() - interval '${dias * 2} days'`;   // dias vem da lista acima
  const fuso = `at time zone 'America/Sao_Paulo'`;
  // cada sessão com o tempo somado das páginas: a média e as faixas do tempo no site
  const resumo = (de, ate) => query(`select count(*)::int as visitas, coalesce(sum(pags), 0)::int as paginas, coalesce(round(avg(seg)), 0)::int as seg_medio,
      count(*) filter (where pags = 1)::int as uma_pagina,
      count(*) filter (where seg < 10)::int as t1, count(*) filter (where seg >= 10 and seg < 30)::int as t2,
      count(*) filter (where seg >= 30 and seg < 60)::int as t3, count(*) filter (where seg >= 60 and seg < 180)::int as t4,
      count(*) filter (where seg >= 180 and seg < 600)::int as t5, count(*) filter (where seg >= 600)::int as t6
    from (select sessao, sum(segundos) as seg, count(*) as pags from visitas
           where criado_em >= ${de}${ate ? ` and criado_em < ${ate}` : ''} group by sessao) s`);
  const [atual, antes, porDia, carros, lojas, origem, aparelho, horas, paginas, buscas, leads, leadsAntes] = await Promise.all([
    resumo(ini), resumo(ini2, ini),
    query(`select to_char((criado_em ${fuso})::date, 'YYYY-MM-DD') as dia, count(distinct sessao)::int as visitas, count(*)::int as paginas
             from visitas where criado_em >= ${ini} group by 1`),
    query(`select v.veiculo_id as id, count(*)::int as vistas, count(distinct v.sessao)::int as pessoas, coalesce(round(avg(v.segundos)), 0)::int as seg,
                  max(ve.marca) as marca, max(ve.modelo) as modelo, max(ve.ano_modelo) as ano, max(ve.fotos[1]) as foto, bool_or(ve.ativo) as ativo, max(l.nome) as loja
             from visitas v left join veiculos ve on ve.id = v.veiculo_id left join lojas l on l.id = ve.loja_id
            where v.pagina = 'veiculo' and v.veiculo_id is not null and v.criado_em >= ${ini}
            group by v.veiculo_id order by 2 desc, 3 desc limit 6`),
    query(`select l.nome, count(*)::int as vistas from visitas v join veiculos ve on ve.id = v.veiculo_id join lojas l on l.id = ve.loja_id
            where v.pagina = 'veiculo' and v.criado_em >= ${ini} group by l.nome order by 2 desc, 1 limit 6`),
    query(`select coalesce(origem, 'Direto') as nome, count(*)::int as visitas from visitas where vista = 1 and criado_em >= ${ini} group by 1 order by 2 desc`),
    query(`select coalesce(aparelho, 'Computador') as nome, count(distinct sessao)::int as visitas from visitas where criado_em >= ${ini} group by 1 order by 2 desc`),
    query(`select extract(hour from criado_em ${fuso})::int as h, count(*)::int as visitas from visitas where vista = 1 and criado_em >= ${ini} group by 1`),
    query(`select pagina as nome, count(*)::int as vistas from visitas where criado_em >= ${ini} group by 1 order by 2 desc`),
    query(`select termo, count(*)::int as vezes from buscas where criado_em >= ${ini} group by termo order by 2 desc, 1 limit 8`),
    query(`select count(*)::int as n from leads where criado_em >= ${ini}`),
    query(`select count(*)::int as n from leads where criado_em >= ${ini2} and criado_em < ${ini}`)
  ]);
  // todos os dias do período, também os sem visita (na hora do Rio)
  const hoje = Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()) + 'T12:00:00Z'), dia = {};
  porDia.rows.forEach(r => { dia[r.dia] = r; });
  const lista = [];
  for (let i = dias - 1; i >= 0; i--) {
    const k = new Date(hoje - i * 864e5).toISOString().slice(0, 10);
    lista.push({ dia: k, visitas: dia[k] ? dia[k].visitas : 0, paginas: dia[k] ? dia[k].paginas : 0 });
  }
  const h24 = Array(24).fill(0); horas.rows.forEach(r => { if (r.h >= 0 && r.h < 24) h24[r.h] = r.visitas; });
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, dias, atual: atual.rows[0], anterior: antes.rows[0], leads: leads.rows[0].n, leadsAntes: leadsAntes.rows[0].n,
    porDia: lista, carros: carros.rows, lojas: lojas.rows, origem: origem.rows, aparelho: aparelho.rows, horas: h24, paginas: paginas.rows, buscas: buscas.rows });
}

// ---------------- PÁGINA DO VEÍCULO ----------------
// logo de uma loja como imagem (o banco guarda como data URI), com cache: a página do veículo mostra a logo sem pesar a lista de lojas
async function rotaLogo(req, res) {
  const id = parseInt((req.query && req.query.id) || '', 10), parc = req.query && req.query.parceiro;
  if (!id && !parc) return res.status(400).end();
  const { rows: [l] } = parc   // credenciado: a logo escolhida no painel ou, sem ela, a que o robô leu no site dele
    ? await query(`select coalesce((select logo_url from parceiros where nome = $1 and ativa = true and logo_url is not null and coalesce(categoria, '') <> all($2) limit 1),
                                   (select valor from config where chave = $3)) as logo_url`, [String(parc), CATS_ANTIGAS, 'logo_parceiro:' + String(parc)])
    : await query('select logo_url from lojas where id = $1 and ativa = true', [id]);
  const u = (l && l.logo_url) || '';
  const m = u.match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);
  if (!m && !/^https?:\/\//i.test(u)) { res.setHeader('Cache-Control', 's-maxage=3600'); return res.status(404).end(); }
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
  if (!m) { res.statusCode = 302; res.setHeader('Location', u); return res.end(); }   // guardada como endereço
  res.setHeader('Content-Type', m[1]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");   // logo em SVG não roda script
  return res.end(m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])));
}
// Descrição que a loja escreveu no anúncio ("Informações do Veículo"). Não fica no banco: é lida no site da loja
// quando alguém abre o anúncio, e a Vercel guarda por um dia. Sem descrição (loja fora do ar, carro vendido), volta vazia.
async function rotaDetalhe(req, res) {
  const id = parseInt((req.query && req.query.id) || '', 10);
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });
  const { rows: [v] } = await query(
    `select v.autocerto_id, l.autocerto_url, l.autocerto_id as origem from veiculos v join lojas l on l.id = v.loja_id
      where v.id = $1 and v.ativo = true and coalesce(v.oculto,false) = false`, [id]);
  let descricao = '';
  if (v && v.autocerto_id && (v.autocerto_url || v.origem)) {
    const fonte = fonteDaLoja(v.autocerto_url || v.origem);
    try {
      const r = await fetch(`${fonte.base}/Veiculo/x/${encodeURIComponent(v.autocerto_id)}/detalhes`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ACEIMA-Importer/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (r.ok) descricao = descricaoDoAnuncio(cheerio.load(await r.text()));
    } catch (_) {}
  }
  res.setHeader('Cache-Control', descricao ? 's-maxage=86400, stale-while-revalidate=604800' : 's-maxage=3600');
  return res.json({ descricao });
}
function descricaoDoAnuncio($) {
  const titulo = (_, e) => /informa\S*es do ve/i.test($(e).text());
  let el = $('#vehicle-overview');
  if (!el.length) el = $('strong').filter(titulo).first().parent();
  if (!el.length) return '';
  el = el.clone();
  el.find('strong').filter(titulo).remove();
  el.find('br').replaceWith('\n');
  el.find('p,div,li').each((_, e) => { $(e).append('\n'); });
  return el.text().split('\n').map(s => s.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

// ---------------- REPASSE ----------------
// O Repasse da Aceima (repasse.html, pedido do Luiz em 26/10/2026): cada loja associada entra com o próprio login, que a Aceima cria no
// painel, e oferece às outras lojas os carros pegos na troca. Quatro tabelas, criadas no primeiro pedido (aprovadas pelo Luiz em 26/10/2026):
// os acessos das lojas, as sessões, os carros e as fotos. As fotos ficam no próprio banco, a opção sem custo: chegam diminuídas do aparelho,
// a Vercel guarda cada uma (o endereço de uma foto nunca muda) e elas são apagadas quando o carro sai do repasse, então o espaço usado fica
// do tamanho dos carros que estão no repasse.
let repasseProntas = false;
async function tabelasRepasse() {
  if (repasseProntas) return;
  try {
    await query(`create table if not exists repasse_acessos (
      id serial primary key, loja_id int not null unique, email text not null unique, senha text not null, whatsapp text,
      ativo boolean not null default true, falhas int not null default 0, bloqueio timestamptz,
      criado_em timestamptz not null default now(), ultimo_acesso timestamptz)`);
  } catch (_) {}
  try { await query('create table if not exists repasse_sessoes (token text primary key, acesso_id int not null, expira timestamptz not null)'); } catch (_) {}
  try {
    // status: enviando (as fotos ainda subindo), ativo, repassado, tirado (pela loja) ou vencido (30 dias no repasse)
    await query(`create table if not exists repasse_carros (
      id serial primary key, loja_id int not null, nome text not null, ano text, km int, cambio text, combustivel text, cor text,
      valor int not null, obs text, placa text, donos text, laudo text, status text not null default 'enviando',
      criado_em timestamptz not null default now(), status_em timestamptz)`);
  } catch (_) {}
  try { await query('create index if not exists repasse_carros_status on repasse_carros (status, criado_em)'); } catch (_) {}
  try { await query('create table if not exists repasse_fotos (id text primary key, carro_id int not null, ordem int not null, tipo text not null, dados bytea not null, mini bytea)'); } catch (_) {}
  try { await query('create index if not exists repasse_fotos_carro on repasse_fotos (carro_id, ordem)'); } catch (_) {}
  repasseProntas = true;
}
// a senha da loja fica só como scrypt (nunca o texto); a sessão, como o hash do token que o aparelho guarda
const scryptP = (s, sal) => new Promise((ok, falha) => scrypt(String(s), sal, 32, (e, k) => (e ? falha(e) : ok(k))));
async function hashSenha(senha) { const sal = randomBytes(16); return 's1$' + sal.toString('hex') + '$' + (await scryptP(senha, sal)).toString('hex'); }
async function confereSenha(senha, h) {
  const [v, sal, k] = String(h || '').split('$');
  if (v !== 's1' || !sal || !k) return false;
  const a = await scryptP(senha, Buffer.from(sal, 'hex')), b = Buffer.from(k, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const hashToken = t => createHash('sha256').update(String(t)).digest('hex');
const txtR = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const emailR = s => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s);
// o WhatsApp com o 55 na frente (o wa.me não abre o número sem o país)
const waR = s => { const d = String(s || '').replace(/\D/g, ''); return !d ? '' : d.length <= 11 ? '55' + d : d.slice(0, 15); };
const LIMITE_FOTOS_REPASSE = 300e6;   // as fotos do Repasse juntas; o banco inteiro não passa de 460 MB por causa delas (o plano grátis do Neon)
const CARROS_POR_LOJA = 40;
// o acesso da própria Aceima (pedido do Luiz, 31/10/2026): fica no lugar da loja 0, que não existe na tabela de lojas, então não mexe no
// cadastro de nenhuma loja do site. Entra como "Aceima" e funciona como o de uma loja
const LOJA_ACEIMA = 0;
const LOJA_REPASSE = `left join lojas l on l.id = a.loja_id`;
const LOJA_ATIVA = `(a.loja_id = ${LOJA_ACEIMA} or l.ativa = true)`;
const NOME_LOJA = `coalesce(l.nome, 'Aceima')`;

// a loja da sessão (o token vem no cabeçalho x-repasse-token); acesso desativado ou loja excluída derrubam a sessão na hora
async function sessaoRepasse(req) {
  const t = String((req.headers || {})['x-repasse-token'] || '');
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  const { rows: [s] } = await query(
    `select a.id, a.loja_id, ${NOME_LOJA} as loja from repasse_sessoes s join repasse_acessos a on a.id = s.acesso_id ${LOJA_REPASSE}
      where s.token = $1 and s.expira > now() and a.ativo = true and ${LOJA_ATIVA}`, [hashToken(t)]);
  return s || null;
}
// limpeza, no máximo uma vez por hora: o carro com 30 dias sai do repasse, e as fotos de quem saiu são apagadas (do repassado, 7 dias depois:
// até lá ele aparece em "Seus carros"); o que ficou no meio do envio some depois de um dia
let limpezaRepasse = 0;
async function limparRepasse() {
  if (Date.now() - limpezaRepasse < 3600e3) return;
  limpezaRepasse = Date.now();
  await query(`update repasse_carros set status = 'vencido', status_em = now() where status = 'ativo' and criado_em < now() - interval '30 days'`);
  await query(`delete from repasse_fotos f using repasse_carros c where f.carro_id = c.id and (c.status in ('tirado', 'vencido')
                 or (c.status = 'repassado' and c.status_em < now() - interval '7 days') or (c.status = 'enviando' and c.criado_em < now() - interval '1 day'))`);
  await query(`delete from repasse_carros where status = 'enviando' and criado_em < now() - interval '1 day'`);
  await query('delete from repasse_sessoes where expira < now()');
}
async function entrarRepasse(req, res) {
  const b = req.body || {}, email = txtR(b.email, 120).toLowerCase(), senha = String(b.senha || '');
  if (!email || !senha) return res.status(400).json({ erro: 'Escreva o e-mail e a senha.' });
  const { rows: [a] } = await query(`select a.*, ${NOME_LOJA} as loja from repasse_acessos a ${LOJA_REPASSE} where a.email = $1 and ${LOJA_ATIVA}`, [email]);
  if (a && a.bloqueio && new Date(a.bloqueio) > new Date()) return res.status(429).json({ erro: 'Muitas tentativas com a senha errada. Espere 15 minutos e tente de novo.' });
  if (!a || !(await confereSenha(senha, a.senha))) {
    // oito erros seguidos travam o e-mail por 15 minutos
    if (a) await query(`update repasse_acessos set falhas = falhas + 1, bloqueio = case when falhas + 1 >= 8 then now() + interval '15 minutes' end where id = $1`, [a.id]);
    await pausa(400);
    return res.status(401).json({ erro: 'E-mail ou senha não conferem.' });
  }
  if (!a.ativo) return res.status(403).json({ erro: 'O acesso da sua loja está desativado. Fale com a Aceima.' });
  const token = randomBytes(32).toString('hex');
  await query(`insert into repasse_sessoes (token, acesso_id, expira) values ($1, $2, now() + interval '30 days')`, [hashToken(token), a.id]);
  await query('update repasse_acessos set falhas = 0, bloqueio = null, ultimo_acesso = now() where id = $1', [a.id]);
  return res.json({ ok: true, token, loja: a.loja });
}
// o mercado: os carros no repasse (30 dias), o repassado só no dia em que foi repassado e, da própria loja, os repassados da última semana
async function listaRepasse(s, res) {
  await limparRepasse();
  query(`update repasse_acessos set ultimo_acesso = now() where id = $1 and (ultimo_acesso is null or ultimo_acesso < now() - interval '1 hour')`, [s.id]).catch(() => {});
  const { rows } = await query(
    `select c.*, ${NOME_LOJA} as loja, coalesce(nullif(a.whatsapp, ''), l.whatsapp) as wa,
            coalesce((select json_agg(f.id order by f.ordem) from repasse_fotos f where f.carro_id = c.id), '[]'::json) as fotos
       from repasse_carros c join repasse_acessos a on a.loja_id = c.loja_id and a.ativo = true ${LOJA_REPASSE}
      where ${LOJA_ATIVA}
        and ((c.status = 'ativo' and c.criado_em > now() - interval '30 days')
         or (c.status = 'repassado' and (c.status_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)
         or (c.loja_id = $1 and c.status = 'repassado' and c.status_em > now() - interval '7 days'))
      order by c.criado_em desc limit 500`, [s.loja_id]);
  return res.json({ ok: true, loja: s.loja, agora: new Date().toISOString(), carros: rows.map(c => ({
    id: c.id, nome: c.nome, ano: c.ano || '', km: c.km, cambio: c.cambio || '', comb: c.combustivel || '', cor: c.cor || '', valor: c.valor,
    obs: c.obs || '', placa: c.placa || '', donos: c.donos || '', laudo: c.laudo || '', loja: c.loja, meu: c.loja_id === s.loja_id,
    wa: c.loja_id === s.loja_id ? '' : waR(c.wa), fotos: Array.isArray(c.fotos) ? c.fotos : [],
    criado: c.criado_em, repassado: c.status === 'repassado' ? c.status_em : null })) });
}
// publicar é em três passos, para nenhum pedido passar do limite da Vercel (4,5 MB) e o aparelho mostrar o andamento: os dados (o carro
// nasce "enviando", fora da lista), uma foto por vez e o "pronto", que põe o carro no repasse com a hora daquele momento
async function publicarRepasse(s, b, res) {
  const nome = txtR(b.nome, 80), ano = txtR(b.ano, 9), valor = parseInt(b.valor, 10), km = parseInt(b.km, 10), nf = parseInt(b.fotos, 10) || 0;
  if (nome.length < 3 || !/\d{4}/.test(ano) || !(valor >= 100 && valor <= 20000000)) return res.status(400).json({ erro: 'Faltam a marca e o modelo, o ano ou o valor.' });
  const { rows: [{ n }] } = await query(`select count(*)::int as n from repasse_carros where loja_id = $1 and status in ('ativo', 'enviando') and criado_em > now() - interval '30 days'`, [s.loja_id]);
  if (n >= CARROS_POR_LOJA) return res.status(400).json({ erro: `Sua loja já tem ${CARROS_POR_LOJA} carros no repasse. Tire os que já foram vendidos para colocar outros.` });
  const { rows: [c] } = await query(
    `insert into repasse_carros (loja_id, nome, ano, km, cambio, combustivel, cor, valor, obs, placa, donos, laudo, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [s.loja_id, nome, ano, km >= 0 && km < 3000000 ? km : null, txtR(b.cambio, 20) || null, txtR(b.comb, 20) || null, txtR(b.cor, 30) || null, valor,
     txtR(b.obs, 1000) || null, (String(b.placa || '').match(/\d(?=\D*$)/) || [null])[0], txtR(b.donos, 12) || null, txtR(b.laudo, 30) || null,
     nf > 0 ? 'enviando' : 'ativo']);
  return res.status(201).json({ ok: true, id: c.id });
}
const ASSINATURAS = [['image/jpeg', [0xff, 0xd8, 0xff]], ['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];
function imagemDe(dataUrl, max) {
  const m = String(dataUrl || '').match(/^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64'), t = ASSINATURAS.find(([, sig]) => sig.every((x, i) => buf[i] === x));
  return buf.length && buf.length <= max && t ? { tipo: t[0], b64: m[1] } : null;
}
async function fotoRepasse(s, b, res) {
  const carro = parseInt(b.carro, 10), ordem = parseInt(b.ordem, 10);
  if (!(ordem >= 0 && ordem < 10)) return res.status(400).json({ erro: 'Foto fora da ordem.' });
  const { rows: [c] } = await query(`select id from repasse_carros where id = $1 and loja_id = $2 and status = 'enviando'`, [carro, s.loja_id]);
  if (!c) return res.status(404).json({ erro: 'Carro não encontrado.' });
  const f = imagemDe(b.dados, 1500000), mi = imagemDe(b.mini, 200000);
  if (!f) return res.status(400).json({ erro: 'Uma foto não chegou inteira. Tente de novo.' });
  const { rows: [esp] } = await query(`select coalesce(sum(octet_length(dados) + coalesce(octet_length(mini), 0)), 0)::bigint as fotos,
                                              pg_database_size(current_database())::bigint as banco from repasse_fotos`);
  if (Number(esp.fotos) > LIMITE_FOTOS_REPASSE || Number(esp.banco) > 460e6) return res.status(507).json({ erro: 'O espaço das fotos do Repasse acabou. Avise a Aceima.' });
  const id = randomBytes(16).toString('hex');
  await query('delete from repasse_fotos where carro_id = $1 and ordem = $2', [carro, ordem]);   // a mesma foto enviada de novo não fica duas vezes
  await query(`insert into repasse_fotos (id, carro_id, ordem, tipo, dados, mini) values ($1, $2, $3, $4, decode($5, 'base64'), decode($6, 'base64'))`,
    [id, carro, ordem, f.tipo, f.b64, mi ? mi.b64 : null]);
  return res.json({ ok: true, id });
}
async function prontoRepasse(s, b, res) {
  const { rows: [c] } = await query(`update repasse_carros set status = 'ativo', criado_em = now() where id = $1 and loja_id = $2 and status = 'enviando' returning id`,
    [parseInt(b.carro, 10), s.loja_id]);
  return c ? res.json({ ok: true }) : res.status(404).json({ erro: 'Carro não encontrado.' });
}
// "Foi repassado" (fica riscado até o fim do dia) e "Tirar do repasse" (sai na hora, com as fotos), só nos carros da própria loja
async function mudarRepasse(s, b, res) {
  const id = parseInt(b.id, 10), st = String(b.status || '');
  if (!['repassado', 'tirado'].includes(st)) return res.status(400).json({ erro: 'status inválido' });
  const { rows: [c] } = await query(`update repasse_carros set status = $3, status_em = now() where id = $1 and loja_id = $2 and status = 'ativo' returning id`,
    [id, s.loja_id, st]);
  if (!c) return res.status(404).json({ erro: 'Carro não encontrado.' });
  if (st === 'tirado') await query('delete from repasse_fotos where carro_id = $1', [id]);
  return res.json({ ok: true });
}
async function senhaRepasse(s, b, req, res) {
  const nova = String(b.nova || '');
  if (nova.length < 6) return res.status(400).json({ erro: 'A senha nova precisa ter pelo menos 6 letras ou números.' });
  const { rows: [a] } = await query('select senha from repasse_acessos where id = $1', [s.id]);
  if (!a || !(await confereSenha(String(b.atual || ''), a.senha))) return res.status(400).json({ erro: 'A senha atual não confere.' });
  await query('update repasse_acessos set senha = $2 where id = $1', [s.id, await hashSenha(nova)]);
  // os outros aparelhos saem; este continua
  await query('delete from repasse_sessoes where acesso_id = $1 and token <> $2', [s.id, hashToken(req.headers['x-repasse-token'])]);
  return res.json({ ok: true });
}
// painel (com a senha do painel): os acessos das lojas. Criar (ou trocar o e-mail, o WhatsApp e a senha), desativar e excluir.
// A senha só existe no momento em que a Aceima cria: o painel mostra para copiar e o banco guarda só o scrypt
async function acessosRepasse(req, res) {
  const b = req.body || {};
  if (req.method === 'GET') {
    const { rows } = await query(`select a.id, a.loja_id, a.email, a.whatsapp, a.ativo, a.criado_em, a.ultimo_acesso,
        (select count(*)::int from repasse_carros c where c.loja_id = a.loja_id and c.status = 'ativo' and c.criado_em > now() - interval '30 days') as carros,
        (select count(*)::int from repasse_carros c where c.loja_id = a.loja_id and c.status = 'repassado') as repassados
       from repasse_acessos a order by a.id`);
    return res.json(rows);
  }
  if (req.method === 'POST') {
    const lojaId = parseInt(b.loja_id, 10), email = txtR(b.email, 120).toLowerCase(), senha = String(b.senha || ''), wa = waR(b.whatsapp) || null;
    if (!(lojaId >= 0)) return res.status(400).json({ erro: 'loja obrigatória' });   // 0: o acesso da Aceima, sem loja
    if (!emailR(email)) return res.status(400).json({ erro: 'Confira o e-mail.' });
    const { rows: [ja] } = await query('select id from repasse_acessos where loja_id = $1', [lojaId]);
    if ((!ja || senha) && senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 letras ou números.' });
    const { rows: [outro] } = await query('select id from repasse_acessos where email = $1 and loja_id <> $2', [email, lojaId]);
    if (outro) return res.status(409).json({ erro: 'Esse e-mail já é o acesso de outra loja.' });
    const h = senha ? await hashSenha(senha) : null;
    if (ja) {
      await query('update repasse_acessos set email = $2, whatsapp = $3, senha = coalesce($4, senha), falhas = 0, bloqueio = null where id = $1', [ja.id, email, wa, h]);
      if (h) await query('delete from repasse_sessoes where acesso_id = $1', [ja.id]);   // senha nova: quem estava dentro entra de novo
    } else await query('insert into repasse_acessos (loja_id, email, senha, whatsapp) values ($1, $2, $3, $4)', [lojaId, email, h, wa]);
    return res.json({ ok: true });
  }
  if (req.method === 'PATCH') {
    const id = parseInt(b.id, 10);
    const { rows: [a] } = await query('update repasse_acessos set ativo = $2 where id = $1 returning id', [id, !!b.ativo]);
    if (!a) return res.status(404).json({ erro: 'acesso não encontrado' });
    if (!b.ativo) await query('delete from repasse_sessoes where acesso_id = $1', [id]);
    return res.json({ ok: true });
  }
  if (req.method === 'DELETE') {
    const id = parseInt((req.query && req.query.id) || b.id, 10);
    const { rows: [a] } = await query('delete from repasse_acessos where id = $1 returning loja_id', [id]);
    if (a) {
      // os carros da loja saem do repasse junto, com as fotos
      await query('delete from repasse_sessoes where acesso_id = $1', [id]);
      await query(`update repasse_carros set status = 'tirado', status_em = now() where loja_id = $1 and status in ('ativo', 'enviando')`, [a.loja_id]);
      await query(`delete from repasse_fotos f using repasse_carros c where f.carro_id = c.id and c.loja_id = $1 and c.status = 'tirado'`, [a.loja_id]);
    }
    return res.json({ ok: true });
  }
  return res.status(405).end();
}
async function rotaRepasse(req, res) {
  await tabelasRepasse();
  res.setHeader('Cache-Control', 'no-store');
  const acao = String((req.query && req.query.acao) || ''), b = req.body || {};
  if (acao === 'acessos') return autorizado(req) ? await acessosRepasse(req, res) : negar(res);
  if (acao === 'entrar') return req.method === 'POST' ? await entrarRepasse(req, res) : res.status(405).end();
  const s = await sessaoRepasse(req);
  if (!s) return res.status(401).json({ erro: 'Entre de novo.' });
  if (req.method === 'GET') return await listaRepasse(s, res);
  if (req.method !== 'POST') return res.status(405).end();
  if (acao === 'publicar') return await publicarRepasse(s, b, res);
  if (acao === 'foto') return await fotoRepasse(s, b, res);
  if (acao === 'pronto') return await prontoRepasse(s, b, res);
  if (acao === 'status') return await mudarRepasse(s, b, res);
  if (acao === 'senha') return await senhaRepasse(s, b, req, res);
  if (acao === 'sair') { await query('delete from repasse_sessoes where token = $1', [hashToken(req.headers['x-repasse-token'])]); return res.json({ ok: true }); }
  return res.status(404).json({ erro: 'ação não encontrada' });
}
// a foto de um carro do repasse, pelo endereço sorteado dela (m=1: a pequena, da lista). O conteúdo de um endereço nunca muda, então a
// Vercel guarda por um ano e o banco só trabalha na primeira vez
async function rotaFotoRepasse(req, res) {
  const id = String((req.query && req.query.id) || ''), mini = req.query && req.query.m === '1';
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(404).end();
  await tabelasRepasse();
  const { rows: [f] } = await query(`select tipo, encode(${mini ? 'coalesce(mini, dados)' : 'dados'}, 'base64') as b64 from repasse_fotos where id = $1`, [id]);
  if (!f) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); }
  res.setHeader('Content-Type', f.tipo);
  res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(Buffer.from(f.b64, 'base64'));
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
    if (rota === 'logo') return await rotaLogo(req, res);
    if (rota === 'detalhe') return await rotaDetalhe(req, res);
    if (rota === 'leads') return await rotaLeads(req, res);
    if (rota === 'importar') return await rotaImportar(req, res);
    if (rota === 'resumo') return autorizado(req) ? await rotaResumo(req, res) : negar(res);
    if (rota === 'refresh') return await rotaRefresh(req, res);
    if (rota === 'testeemail') return autorizado(req) ? await rotaTesteEmail(req, res) : negar(res);
    if (rota === 'conteudo') return autorizado(req) ? await rotaConteudo(req, res) : negar(res);
    if (rota === 'publicacoes') return autorizado(req) ? await rotaPublicacoes(req, res) : negar(res);
    if (rota === 'visita') return await rotaVisita(req, res);
    if (rota === 'visitas') return autorizado(req) ? await rotaVisitas(req, res) : negar(res);
    if (rota === 'repasse') return await rotaRepasse(req, res);
    if (rota === 'rfoto') return await rotaFotoRepasse(req, res);
    if (rota === 'avaliacoes') {
      const lista = await avaliacoesGoogle();
      // 1h nova; depois, por até 7 dias, a Vercel entrega a anterior na hora e busca a nova por trás
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=604800');
      return res.json(lista);
    }
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
