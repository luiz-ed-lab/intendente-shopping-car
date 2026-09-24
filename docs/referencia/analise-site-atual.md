# Análise Completa — intendenteshoppingcar.com.br

**Data:** 21/07/2026
**Objetivo:** diagnosticar o site atual (mantido pelo Auto Certo) e mapear o que precisamos para construir um site próprio e independente.

---

## 1. Visão geral

O site é um template white-label do Auto Certo, adaptado de forma superficial para o Intendente Shopping Car. Ele funciona, mas tem problemas sérios de identidade, usabilidade, SEO, conteúdo e — o mais crítico para o nosso objetivo — **dependência total do Auto Certo para dados e fotos do estoque**.

Páginas existentes: Home (com busca), Quem Somos, Lojas, Venda seu Veículo, Contato, página de veículo (detalhes) e páginas de estoque por loja/marca.

---

## 2. Dependências do Auto Certo (o que nos prende hoje)

| Item | Situação | Risco |
|---|---|---|
| **Fotos dos veículos** | Hospedadas em `autocerto.com/fotos/...` | Se o Auto Certo cortar acesso, o site fica sem nenhuma imagem |
| **Dados do estoque** | IDs e cadastro vêm do sistema Auto Certo (as lojas cadastram lá) | Sem acordo/integração, perdemos o estoque inteiro |
| **Plataforma/hospedagem** | Site roda na infra do Auto Certo (template ASP.NET) | Não temos o código nem controle |
| **Formulários (propostas, venda, contato)** | Leads passam pelo sistema deles | Não sabemos se temos acesso direto ao histórico de leads |
| **Domínio** | intendenteshoppingcar.com.br | ⚠️ **VERIFICAR no Registro.br quem é o titular.** Se estiver no CNPJ do Auto Certo, é a prioridade nº 1 resolver |
| **Google Tag Manager / Analytics (GTM-TPDLGRS)** | Conta possivelmente gerenciada por eles | Perda do histórico de tráfego |

**Ponto-chave da desvinculação:** as lojas provavelmente usam o Auto Certo como sistema de gestão de estoque (é comum no setor). O novo site precisa de uma fonte própria de dados — ou um painel onde as lojas cadastram os veículos, ou integração via feed (XML/JSON) com os sistemas que cada loja já usa (incluindo o próprio Auto Certo, que exporta feeds para portais).

---

## 3. Problemas encontrados

### Identidade e credibilidade
- O logo tem texto alternativo **"SeminovosRJ Logo"** — sobra de outro cliente do template. Aparece para o Google e leitores de tela.
- A Política de Privacidade está com **campos em branco**: "a (o) ___ adota as seguintes regras" — o nome da empresa nunca foi preenchido.
- Números inconsistentes espalhados pelo site: home diz **+150 revendas**, Quem Somos diz **+70 lojas**, a página Lojas lista **26 lojas**. Isso mina a confiança.
- Rodapé "Desenvolvido por AutoCerto.com" com link — envia autoridade e tráfego para eles.

### Usabilidade (UX)
- **Busca fraca**: a home só tem busca por carro/moto; sem filtros visíveis de preço, ano, km, marca em destaque. Para um polo com "10 mil ofertas", busca é o coração do site e hoje é o ponto mais fraco.
- **Página Lojas é só uma lista de telefones** — sem foto, endereço, mapa, horário ou link direto para o estoque de cada loja. Para um shopping de lojas, essa página deveria ser uma vitrine.
- **Sem botão de WhatsApp** — o contato principal do setor automotivo hoje. O WhatsApp só aparece escondido no texto do anúncio.
- Página do veículo poluída: lista gigante de opcionais sem hierarquia, texto do lojista colado sem formatação, preço aparece sem máscara em um trecho ("R$43900.00").
- Notícias do g1 copiadas na íntegra na home — além de risco de direitos autorais, empurram o conteúdo importante para baixo.
- Menu com títulos errados (todos os links têm tooltip "Quem Somos").
- Zoom bloqueado no celular (`user-scalable=no`) — problema de acessibilidade, penalizado pelo Google.

### SEO e técnica
- Meta descriptions duplicadas/genéricas em quase todas as páginas ("Compre, Venda, Avalie, Compare...").
- Títulos de página iguais em Quem Somos, Lojas e Contato.
- Botão de compartilhar no **Google Plus** — rede que morreu em 2019. Mostra o abandono do template.
- URLs das lojas com espaços sem codificação (`/Loja/Shineray Valqueire/...`).
- Links de compartilhamento gerados com `http://` (sem SSL).
- Sem dados estruturados (schema.org/Vehicle) — perde destaque no Google e no Google Vehicle Ads.
- Página de estoque aparentemente renderizada via JavaScript — dificulta indexação dos veículos pelo Google.

---

## 4. O que o novo site precisa ter

### Essencial (MVP)
1. **Busca poderosa e visível**: filtros por marca, modelo, preço, ano, km, câmbio, combustível, loja — com resultados rápidos e URL amigável por filtro (bom para SEO).
2. **Página de veículo focada em conversão**: galeria de fotos boa, preço em destaque, botão de **WhatsApp** direto para a loja, telefone clicável, simulação de financiamento (o grande diferencial da ACEIMA são as taxas negociadas — hoje isso nem aparece).
3. **Página de Lojas como vitrine**: card por loja com foto, endereço, mapa, WhatsApp e estoque.
4. **Painel administrativo próprio**: para a associação gerenciar lojas e para as lojas gerenciarem seus veículos e fotos (ou importar por feed).
5. **Fotos hospedadas em infraestrutura própria** (nosso servidor/CDN).
6. **Mobile-first**: a maioria esmagadora do público de seminovos navega pelo celular.
7. **Leads centralizados**: propostas e formulários caindo em painel/e-mail nosso, com notificação para a loja dona do anúncio.

### Diferenciais (fase 2)
- Destaque institucional dos diferenciais da ACEIMA: selo de qualidade, laudo cautelar, taxas negociadas com financeiras, SAC.
- Simulador de financiamento com as taxas parceiras.
- Comparador de veículos e favoritos.
- Blog próprio (em vez de copiar o g1) para SEO local: "carros seminovos RJ", "autoshopping Intendente Magalhães" etc.
- Dados estruturados (schema.org) para aparecer nos resultados enriquecidos do Google.
- Área "Venda seu veículo" com fluxo melhor (avaliação online).

---

## 5. Plano de desvinculação do Auto Certo

1. **Confirmar a titularidade do domínio** no Registro.br. Se não estiver no CNPJ da ACEIMA, transferir antes de qualquer coisa.
2. **Criar contas próprias**: hospedagem, Google Analytics 4 + Tag Manager, Google Search Console, e-mail profissional.
3. **Definir a fonte do estoque**: painel próprio de cadastro e/ou importação de feed dos sistemas que as lojas já usam (o Auto Certo exporta feeds para portais — as lojas podem continuar usando o sistema deles internamente e o nosso site consome o feed; isso reduz a resistência dos lojistas na transição).
4. **Construir o novo site** em paralelo, com as fotos copiadas/re-hospedadas.
5. **Migrar com redirecionamentos 301** das URLs antigas para as novas (preserva o ranking no Google).
6. **Trocar o DNS** para a nova hospedagem e só então encerrar o contrato com o Auto Certo.

---

## 6. Resumo executivo

O site atual é um template genérico, desatualizado (botão do Google Plus, política de privacidade em branco, logo de outro cliente) e 100% dependente do Auto Certo em dados, fotos e infraestrutura. As maiores oportunidades do novo site são: busca de verdade, WhatsApp em tudo, página de lojas como vitrine, destaque do financiamento com taxas ACEIMA, e SEO próprio. O primeiro passo prático não é código: é **confirmar quem é dono do domínio** e **definir como o estoque vai chegar ao novo site** sem depender da boa vontade do provedor atual.
