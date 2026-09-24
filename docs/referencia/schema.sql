-- ============================================================
--  Banco de dados — Nova Intendente Shopping Car (ACEIMA)
--  Rode este script uma vez no seu banco Postgres (Neon) para
--  criar as tabelas. Depois disso, o site e o painel gravam/leem daqui.
-- ============================================================

-- Lojas associadas ao polo
create table if not exists lojas (
  id            serial primary key,
  nome          text not null,
  endereco      text,
  telefone      text,
  whatsapp      text,          -- só dígitos, ex: 5521999999999
  email         text,
  autocerto_id  text,          -- id da loja no sistema Auto Certo (o robô usa isso p/ ler o estoque)
  autocerto_url text,          -- url do estoque da loja (opcional, alternativa ao id)
  logo_url      text,          -- logo re-hospedada no nosso servidor
  ativa         boolean default true,
  criada_em     timestamptz default now()
);

-- Veículos importados das lojas
create table if not exists veiculos (
  id              serial primary key,
  loja_id         integer references lojas(id) on delete cascade,
  autocerto_id    text,        -- id do anúncio no Auto Certo (usado p/ não duplicar)
  marca           text,
  modelo          text,
  versao          text,
  ano_fabricacao  int,
  ano_modelo      int,
  km              int,
  preco           numeric,
  cambio          text,
  combustivel     text,
  tipo            text,        -- 'carro' | 'moto'
  opcionais       text[],      -- lista de opcionais
  fotos           text[],      -- urls das fotos (re-hospedadas)
  ativo           boolean default true,   -- fica false quando some do estoque da loja (vendeu)
  sincronizado_em timestamptz default now(),
  unique (loja_id, autocerto_id)          -- garante 1 registro por anúncio
);

-- Leads (interessados que preenchem o site)
create table if not exists leads (
  id                serial primary key,
  loja_id           integer references lojas(id),
  veiculo_id        integer references veiculos(id),
  cliente_nome      text,
  cliente_telefone  text,
  cliente_email     text,
  forma_compra      text,      -- 'avista' | 'financiado'
  entrada           text,      -- valor de entrada OU descrição do carro na troca
  canal             text,      -- 'whatsapp' | 'formulario'
  status            text default 'novo',  -- 'novo' | 'enviado' | 'atendido'
  criado_em         timestamptz default now()
);

-- Índices p/ busca rápida no site
create index if not exists idx_veiculos_busca on veiculos (ativo, tipo, marca, preco);
create index if not exists idx_veiculos_loja  on veiculos (loja_id);
create index if not exists idx_leads_loja      on leads (loja_id, status);
