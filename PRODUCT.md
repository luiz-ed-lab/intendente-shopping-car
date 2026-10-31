# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Quem procura carro na Estrada Intendente Magalhães (Rio de Janeiro): chega pelo Google, pelo Instagram ou pelo WhatsApp, quer achar o carro, conhecer a loja e falar com ela.
- Quem quer vender o próprio carro para as lojas do polo.
- Empresários da região, de qualquer ramo, que pensam em se associar à Aceima.
- A equipe da Aceima (Luiz e a diretoria), que administra lojas, credenciados, estoque, leads e publicações pelo painel.
- Os lojistas associados, que usam o Repasse para oferecer às outras lojas os carros pegos na troca.

## Product Purpose

Site da Aceima, a associação dos lojistas da Estrada Intendente Magalhães ("A Intendente"), apresentada como o maior polo automotivo da América Latina. Reúne o estoque das lojas associadas num lugar só, apresenta a associação e os associados (lojas e serviços e comércio credenciados) e leva o visitante até a loja pelo WhatsApp. Substitui o antigo intendenteshoppingcar.com.br, que dependia do Auto Certo, e está no ar em aintendente.com.br desde 30/10/2026.

## Positioning

Um polo inteiro numa rua só, com uma associação que existe desde 1998 por trás: o estoque de todas as lojas da Intendente junto, com a credibilidade da associação.

## Operating Context

- O estoque é lido de hora em hora do site de cada loja; fotos, preços e descrições são os das lojas.
- O contato com as lojas acontece pelo WhatsApp; o site grava o lead e manda o e-mail.
- "Venda seu veículo": o pedido de quem quer vender vai por e-mail para todas as lojas associadas (lead do tipo `compra`), como no site antigo.
- O painel fica em /painel, só com a senha da Aceima.
- Repasse (em criação desde 26/10/2026): página separada do site, sem link a partir dele. Cada loja associada entra com o próprio login (e-mail e senha) que a Aceima cria no painel; a loja pode trocar a senha depois. A loja cadastra os carros pegos na troca que quer repassar; as outras lojas veem e, interessadas, falam com quem cadastrou pelo WhatsApp, e a negociação segue fora do sistema.

## Capabilities and Constraints

- Sem build: HTML, CSS e JS puros (`index.html` para o site, `painel.html` para o painel), na Vercel; uma API serverless em Node; banco Postgres no Neon, o mesmo para a prévia e a produção.
- Nada vai para o ar sem a aprovação do Luiz; a prévia do ramo `site-novo` é onde ele aprova. Nenhuma mudança no banco de produção sem a aprovação dele.
- Textos sem taxas, juros, financiamento ou condição comercial.
- Os descontos e gratuidades dos associados ainda não têm parceiros definidos (26/10/2026): nada de nomes de parceiros, porcentagens ou eventos específicos.

## Brand Commitments

- O nome se escreve "Aceima", só com o A maiúsculo; o polo é "A Intendente". O nome "Intendente Shopping Car" não existe mais.
- Português do Brasil; títulos curtos e afirmativos, na primeira pessoa do plural quando couber; nada de travessão entre frases; nada de texto com cara de IA.
- A Aceima é de todos os ramos, não só de lojas de carro: os textos contam empresas e associados.
- O site segue os mockups aprovados (`docs/mockups-aprovados/`) e as decisões visuais registradas no `CLAUDE.md`.

## Evidence on Hand

- Logos em `marca-nova/` (logo do polo, logo da Aceima, símbolo A); fotos em `fotos-home/` e `fotos-aceima/` (a Intendente antiga, o presidente, a união).
- O estoque real das lojas e as avaliações reais do Google, pela API.
- As cinco publicações do site são exemplos ilustrativos.
- Não existem: depoimentos de clientes, números de vendas e parceiros de desconto definidos.

## Product Principles

1. O menor caminho até a loja certa, pelo WhatsApp.
2. A Aceima aparece como um polo unido, com credibilidade e segurança, nunca como um classificado.
3. Nada inventado: estoque, notas e números vêm de fontes reais.
4. Celular e computador com o mesmo cuidado.
