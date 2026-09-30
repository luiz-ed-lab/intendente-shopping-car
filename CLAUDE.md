# ACEIMA · site novo (aceima.com.br)

Site da ACEIMA, a associação dos lojistas da Estrada Intendente Magalhães (Rio de Janeiro), o maior polo automotivo da América Latina. O site substitui o antigo "intendenteshoppingcar.com.br", que ficava preso ao Auto Certo. O domínio novo será **aceima.com.br**.

Dono do projeto: Luiz. Toda a comunicação com ele é em português do Brasil.

## Nomes (regra dura)

- A marca do site é **ACEIMA**. O polo se chama **A Intendente**, e as lojas são "lojas da Intendente".
- O nome "Intendente Shopping Car" não existe mais. Não usar em texto, arte, e-mail, legenda nem código novo. O backend ainda tem esse nome em alguns textos de e-mail: trocar quando mexer nele.

## Arquitetura

Sem build. Tudo roda na Vercel.

| Arquivo | O que é |
|---|---|
| `index.html` | O site público inteiro, em um arquivo só: CSS, HTML gerado por funções JS e roteador. JS puro, sem framework. |
| `conteudo.js` | Textos e estilos que o Luiz edita no próprio site (modo de edição, `/?editar`). O site salva direto no GitHub, no ramo da publicação. **Vale por cima do texto padrão do `index.html`.** |
| `painel.html` | Painel administrativo da ACEIMA (lojas, estoque, leads). **Ainda está com a identidade antiga.** |
| `api/[...path].js` | Função serverless única da Vercel (Node, ESM). Atende todas as rotas `/api/*`. |
| `vercel.json` | Cron diário do importador e rewrite de tudo que não é `/api/` para `index.html`. |
| `.github/workflows/sincronizar.yml` | Sincroniza o estoque de hora em hora, uma loja por vez. Usa o secret `PAINEL_TOKEN`. |
| `.github/workflows/vitrine.yml` e `.github/vitrine.py` | Todo dia escolhe as fotos perfeitas para a vitrine da home e grava `vitrine.json` no repositório (um commit por dia quando muda, que a Vercel publica). |
| `marca-nova/` | Logos novas. O site usa `intendente-site.webp` (versão leve e recortada de `intendente-horizontal.png`, a logo do polo) em todas as páginas e `aceima-nova.png` (ACEIMA sem descrição) só na página da ACEIMA. |
| `fundo-vidro.mp4` | Vídeo do fundo animado (vidro em diagonal). `fundo-animado-frame.jpg` é um quadro dele, usado enquanto o vídeo carrega. |
| `docs/` | Mockups aprovados, deck aprovado, análise do site antigo, plano do importador, schema do banco. |
| `arquivo/` | Partes do site antigo que saíram do novo. **Não apagar** até o site estar fechado. |

### Backend

- Banco: Postgres no Neon, via `@neondatabase/serverless`. A própria API cria as colunas que faltam (`migra()`). O schema original está em `docs/referencia/schema.sql`.
- Robô importador: lê o site de cada loja (com `cheerio`) e grava os anúncios. Plano completo em `docs/referencia/importador-plano-tecnico.md`.
- Rotas (o front chama `/api/<rota>?path=<rota>`): `lojas`, `parceiros`, `veiculos`, `leads`, `importar`, `refresh`, `auth`. Protegidas por `PAINEL_TOKEN`: `resumo`, `testeemail`, `conteudo`. A rota `avaliacoes` devolve as avaliações reais do Google para a faixa da home (guardadas em `config`, atualizadas uma vez por dia). Para a página do veículo: `logo` devolve a logo de uma loja como imagem (o banco guarda em data URI), com cache; `detalhe` lê na hora, no site da loja, a descrição do anúncio ("Informações do Veículo") e a Vercel guarda por um dia. A descrição não fica no banco.
- O site pede `lojas` e `veiculos` com `site=1`: versão leve (sem os logos, que eram quase todo o peso, e só as colunas que o site usa), sempre pública (nunca traz veículo oculto) e com cache de 5 minutos na Vercel. O painel pede sem `site=1` e continua recebendo tudo, sem cache. Teste: `node testes/site.mjs`.
- E-mails de lead: Resend.
- Variáveis de ambiente (nomes em `.env.example`, valores só na Vercel): `DATABASE_URL`, `PAINEL_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `ACEIMA_EMAIL`, `SITE_URL`, `GITHUB_TOKEN`, `GOOGLE_PLACES_KEY`.

### Front (`index.html`)

- Cada página é uma função que devolve HTML: `home`, `estoque`, `associados`, `veiculo`, `aceima`, `associar`, `publicacoes`, `servicos`. O objeto `VIEWS` liga nome e função, e `go(pagina)` navega.
- Endereços: `/`, `/estoque`, `/associados`, `/a-aceima`, `/seja-um-associado`, `/publicacoes`, `/servicos`, `/veiculo/ID-nome`. Os endereços antigos `/lojas`, `/aceima`, `/vender` e `/contato` redirecionam. Aberto direto do disco (`file://`), usa `#/rota`.
- Dados: `carregar()` busca `/api/lojas` e `/api/veiculos`. Sem API (aberto do disco), usa a amostra `AMOSTRA_V` / `AMOSTRA_L`, que são os mesmos carros dos mockups.
- Os anúncios aparecem intercalados entre as lojas, e nenhuma loja domina a vitrine (`intercalar()`). Não trocar isso por ordenação simples.
- Nomes dos carros (`titulo()`, pedido do Luiz em 30/09/2026): as lojas mandam tudo em maiúsculas; o site escreve só a primeira letra de cada palavra maiúscula. Ficam em maiúsculas as palavras curtas técnicas: as que têm número (4P, 16V, 1.0, HB20, T270), as siglas da lista `SIGLAS` (TSI, TFSI, MPI, CVT, LTZ, BMW...) e as de partes curtas com hífen (HR-V, GR-S). "de", "da", "e" ficam minúsculas. Sigla nova que aparecer escrita errado: acrescentar em `SIGLAS`.
- Celular (até 760px): as medidas foram tiradas das telas de celular aprovadas, com 284px de largura útil, e convertidas em `vw`. Para mudar um tamanho no celular, mantenha essa conversão (px ÷ 2,84 = vw).
- Textos: todo texto institucional passa por `T(id, padrão)`. O que o Luiz edita fica em `conteudo.js` com o mesmo id e vence o padrão. Números que mudam com os dados entram como `{veículos}`, `{lojas}`, `{associados}`, `{anos}` e `{veículos arredondados}` (com "por extenso" saem em palavras). Ao mudar um texto no código, confira se ele não está sobrescrito em `conteudo.js`. Não troque um id que já tem edição, senão a edição se perde.
- Modo de edição: `/?editar`, com a senha do painel. Cores, fontes e pesos ficam limitados às listas `CORES`, `FONTES` e `PESOS`. Salvar faz um commit no ramo pela rota `/api/conteudo`, que precisa da variável `GITHUB_TOKEN`. **Como o Luiz faz commits pelo site, rode `git pull` antes de mexer e antes de cada push.** Teste da rota: `node testes/conteudo.mjs`.
- Menu: barra do componente "Bottom Nav Bar" (21st.dev, @arunachalam), com as medidas e as cores do tema claro. No computador ela fica fixa embaixo, no centro, e a logo fica centralizada no topo. No celular, mostra só o ícone da página no canto; ao tocar, os ícones aparecem na ordem do menu (cada um sempre no seu lugar) e o nome da página aberta aparece em pé, lido subindo, logo depois do ícone, que gira junto; o menu só cresce para baixo. Ao escolher outra página, os nomes trocam e o menu fecha em volta do ícone escolhido. A troca de página é em fusão (View Transitions: a página nova aparece por cima da antiga), com o menu fora dela, parado na tela. Navegador sem suporte: o conteúdo some no azul do fundo e volta. O ícone da página A ACEIMA é o contorno da logo A (a mesma do bloco da home), desenhado em SVG no traço dos outros ícones (pedido do Luiz, 30/09/2026). O nome da página ativa é medido de novo quando a fonte do site carrega, senão corta a última letra.
- Título da home: `inicio.titulo` e `inicio.titulo-dourado` são blocos separados (`.tit`), cada um com a sua altura de linha, e "desde 1998" fica encostado neles. Os tamanhos (tam) vêm do modo de edição. O título fica no meio: a mesma distância até "desde 1998" e até o subtítulo (pedido do Luiz, 28/09/2026). No celular, o título pode passar dos 70% da tela para a parte dourada caber numa linha, "desde 1998" é bem menor (1,87vw) e "Credibilidade que move" tem tamanho fixo (5,33vw, com !important): ali o tam do modo de edição não vale.
- Categorias da home (ordem e textos do Luiz, 28/09/2026): Conheça a ACEIMA → `aceima`; Um polo comercial mais do que completo → `associados`; Seja um associado → `associar`; Estoque Automotivo → `estoque`. Cada uma tem a sua foto ao fundo (`fotos-home/aceima.webp`, `polo.webp`, `associar.webp`, `estoque.webp`, enviadas pelo Luiz em 29/09/2026), sem fade e escura, no clima da primeira foto do carro (`fotos-home/comprar.jpg`, que fica como referência), e bem discreta (opacidade 0,24). No celular, a foto 1 mostra o lado esquerdo e as outras o centro (5º item de cada categoria em `home()`). Foto nova: `python fotos-home/escurecer.py origem.jpg fotos-home/nome.webp`. No computador, o mouse destaca e o clique leva à página. No celular, o toque só abre a categoria e mostra o botão "Acessar"; a troca automática continua a cada 4s e o botão some quando ela avança. As descrições vão até o fim da página (sem limite de largura); no celular, títulos em 3,87vw e descrições em 3vw. Os números da home (descrições, subtítulo e título do estoque) aparecem em algarismos, a pedido do Luiz.
- Bloco "sobre" da home (`sobre()`, pedido do Luiz em 29/09/2026), entre o topo e o estoque, no estilo do modelo NexStudio (nexstudio.demos.tailgrids.com): títulos em peso 400 com o fim em itálico, muito respiro e números grandes. Primeiro vem a ACEIMA, em fundo claro: à esquerda, o título e o texto embaixo dele; à direita, o outro texto e os números. As duas colunas começam e terminam na mesma linha (tinta do texto na altura da tinta do título, base dos rótulos na base da última linha da esquerda). Os números e os rótulos são bem grandes (pedido do Luiz, 30/09/2026): no computador, o número cresce até ocupar todo o espaço entre o texto da direita e a base da coluna (container query, `cqh`), então não sobra espaço vazio em nenhuma largura. Depois vem a parte do empresário que quer se associar, num painel azul, sem chamada: título e texto no centro, o texto de ponta a ponta (na largura dos benefícios), os 4 benefícios com formas em dourado e, embaixo deles, o botão "Quero me associar", largo, ocupando as duas colunas do meio (no celular, a largura toda). A forma do selo é a logo A (`marca-nova/simbolo-a-contorno.png`, contorno da logo do topo). Os textos usam os ids `inicio.sobre-*` e `inicio.empresario-*`. No computador e no celular, cada bloco é uma folha com só os cantos de cima redondos (`--canto`), que sobe por cima da anterior: a clara sobe por cima do topo, e o estoque sobe por cima do painel azul. Nada de canto redondo embaixo.
- Vitrine do estoque na home: só o botão "Ver estoque completo" (o "Buscar por marca" saiu a pedido do Luiz, 29/09/2026). No computador, o título ("1.400 veículos, 23 lojas, um estoque."), a chamada, o texto e o botão são bem maiores, para ocupar o lado da vitrine (pedido do Luiz, 30/09/2026); o título tem sempre duas linhas.
- Página A ACEIMA (30/09/2026): números sem "marcas"; a história fica à esquerda e os benefícios à direita; o contato é uma folha azul que sobe por cima da história (como o painel do empresário da home), com a chamada, o título "Fale com a *ACEIMA.*" e os botões WhatsApp e Como chegar (Google Maps) à esquerda, e endereço, telefones e atendimento à direita.

## Rodar

```
npx serve -s .        # só o front, com a amostra de dados
npx vercel dev        # front + API (precisa de `vercel login` e `vercel env pull`)
```

Deploy: repositório GitHub **luiz-ed-lab/intendente-shopping-car**, ligado ao projeto Vercel **intendente-shopping-car** (intendente-shopping-car.vercel.app). **Push na `main` publica o site.** O que está no ar hoje ainda é o front antigo.

- Trabalhe sempre em branch. A Vercel gera um endereço de prévia para cada branch, e é esse endereço que o Luiz deve ver para aprovar.
- Merge na `main` só com aprovação explícita dele.
- Depois de qualquer push, confira se o commit tem mesmo os arquivos esperados. Os uploads grandes pela interface web do GitHub já falharam sem aviso.

## Regra principal de design

**O site tem que ser cópia idêntica dos mockups aprovados.** Não reinterpretar, não misturar com o site antigo, e não dar como pronto enquanto não estiver idêntico.

- Fonte da verdade: `docs/mockups-aprovados/` (imagens desktop e celular) e `docs/mockups-aprovados/codigo-dos-mockups.html`, que é o código original que gerou as telas. Abra com `#home1`, `#secEstoque`, `#estoque` ou `#associados` no fim do endereço.
- Para conferir, abra o site e o código dos mockups lado a lado em 1510×806 e compare as posições dos elementos (`getBoundingClientRect`), não só no olho.
- Deck aprovado: `docs/ACEIMA-Redesign-v8.pdf`.

### Regras visuais que o Luiz já definiu

- Paleta: azul profundo `#00091A`, dourado `#C8862E` / `#E8A048` / `#F4B05C`, off-white `#F6F4F1`, tinta `#0B1A33`. Fontes: Outfit (títulos) e Figtree (textos), escolhidas pelo Luiz em 25/09/2026 no lugar de Archivo e Poppins. Ficam nas variáveis `--f1` e `--f2` do `index.html`; para trocar, mude as variáveis e o link do Google Fonts.
- Fundo: a animação de vidro em diagonal do template payload-marketing (21st.dev), exatamente igual, e não uma aproximação em gradiente. Discreta: opacidade 0,17, `mix-blend-mode: screen`, brilho 0,78. Nunca pode ficar parado.
- Azul no topo, nos blocos de ação e no estoque. Páginas de leitura têm o corpo em fundo claro.
- Logo do topo e do rodapé (pedido do Luiz, 30/09/2026): a do polo, INTENDENTE · Polo Comercial e Automotivo do Rio (`marca-nova/intendente-site.webp`), em todas as páginas. A logo da ACEIMA fica só na página da ACEIMA, no meio da mesma altura, para nada abaixo mudar de lugar entre as páginas. No celular, a logo do polo tem 9,86vw de altura, a 5,63vw do topo e da lateral, e o menu desce junto para ficar centralizado com ela.
- Foto de carro só no estoque. Nas outras páginas, nada de foto de carro.
- Fotos da página inicial (vitrine do estoque) têm que ser perfeitas, como a do Toyota Corolla Cross da AG Rio Car que o Luiz mostrou em 29/09/2026: carro inteiro, sem recorte, sem tarja branca, sem selo, texto ou logo por cima. A home só usa as fotos de `vitrine.json`, e sem zoom. `.github/vitrine.py` confere tarja, formato e resolução de cada foto, e só entram as lojas conferidas por gente (lista `LOJAS` no script), porque selo colado na foto não dá para achar sozinho com segurança. Loja nova só entra depois de conferida.
- Página do estoque (pedido do Luiz, 30/09/2026): tudo acima dos anúncios fica centralizado (chamada, título, filtros, ordenar e buscar; no celular os filtros quebram em linhas centralizadas). Os anúncios seguem as fotos do modelo Photography Portfolio (21st.dev, @ecarry): grade de fotos em 4:3, todas do mesmo tamanho (4 colunas; 3 abaixo de 1400px; 2 no tablet; 1 no celular, como o modelo), com a foto exata que a loja enviou, sem zoom (as capas das lojas já vêm em 4:3). No canto de cima, recortada na foto, uma etiqueta com o modelo e o ano ("Polo 2018"); no canto de baixo, o preço, do mesmo jeito. Com o mouse, a foto desfoca, a etiqueta mostra o nome completo (marca, modelo, versão e ano), escrito rápido letra por letra (`digitar()`, sem piscar), e a seta, e aparecem km, câmbio, combustível e a loja, só o que não está no nome. Nome e preço com peso 600 e 700. Os anúncios ficam numa folha azul lisa (cantos de cima redondos), porque as etiquetas precisam ter a cor exata do fundo. A página inicial continua com a vitrine dela (`.stag`), sem mudar. Topo (textos do Luiz, 30/09/2026): chamada "Nosso estoque", título "O maior estoque de automóveis do Brasil em uma única rua" (`estoque.titulo`) e, embaixo, a contagem (com filtro, "N veículos encontrados"). Filtros: um só ouvinte fixo fecha a lista quando se toca fora dela; não voltar a criar um ouvinte por lista aberta, porque ele sobrava depois da escolha e fechava a lista seguinte no mesmo clique (era o "às vezes não clica"). A barra de rolagem da lista segue o tema dela.
- Página do veículo (pedido do Luiz, 30/09/2026), no estilo do modelo USD Halo (21st.dev, @mohammadshehadeh): a primeira foto em destaque (16:9 no computador, 4:3 exata no celular), com a logo da loja no canto de cima sobre um esfumado bem leve (escuro para logo clara, claro para logo escura; a cor da logo escolhida no painel vale por cima da conta; logo com sobra transparente é recortada no desenho). Embaixo, o nome em duas linhas (marca e modelo; versão) e, ao lado, a ficha (ano, quilometragem, câmbio, combustível). Depois todas as outras fotos em 4:3 (4, 3 e 2 colunas), que abrem em tela cheia com setas, teclado e deslizar. Depois as características (IPVA pago, único dono...) e os opcionais, e a descrição que a loja escreveu (texto todo em maiúsculas vira frase normal). Por fim, numa folha azul que sobe por cima: valor, loja (logo, nome, selo), endereço, telefone, nota do Google, Como chegar, Estoque da loja e o formulário de sempre (grava o lead e abre o WhatsApp da loja).
- Logos: entrando ou saindo da página da ACEIMA, as logos têm uma troca própria (nome `logo` na transição de página): a que sai sobe e se desfaz, a que entra sobe de baixo (pedido do Luiz, 30/09/2026).
- Página inicial sem excesso de informação logo de cara.
- Cada página tem layout próprio. Nada de copiar e colar a mesma estrutura.
- Sempre conferir a versão de celular, não só a de desktop.
- Alinhamento é levado a sério: elementos que se repetem ficam sempre na mesma posição.

### Regras de escrita (textos do site)

- Nunca usar travessão (—) entre frases. Pontuação normal.
- Nada de texto com cara de IA: sem encher linguiça, sem dizer o óbvio, sem descrever o que a imagem já mostra.
- Títulos curtos e afirmativos, em primeira pessoa do plural quando couber ("Somos um Marketplace", "Dois nomes, uma só força.").
- Corpo em frase institucional corrida. Quando explicar uma decisão, diga por que ela é melhor para quem usa o site.

## Como trabalhar com o Luiz

- **Nada vai para o ar sem a aprovação dele.** Isso vale para deploy, troca de domínio e mudança no banco de produção.
- Mostre a tela (print desktop e celular) antes de dizer que está pronto.
- Quando ele devolver um arquivo editado, compare o arquivo inteiro com o seu antes de regerar qualquer coisa. As edições dele valem em tudo.
- Ele quer respostas curtas e diretas. Não liste cada passo que você deu, nem explique o que foi feito no site (pedido dele em 29/09/2026): diga que está pronto, mostre os prints e só detalhe quando precisar de uma ação dele.
- Soluções simples: o site é um arquivo HTML sem build de propósito. Não introduzir framework nem dependência sem pedir.

## Pendências (em 24/09/2026)

1. **Vídeo do fundo:** é o arquivo do template de terceiros. Confirmar a licença ou gerar um vídeo nosso equivalente. Também está com 17 MB, então vale gerar uma versão mais leve para celular.
2. **Páginas sem mockup aprovado:** A ACEIMA, Seja um associado, Publicações, Serviços do polo, página do veículo (refeita no modelo USD Halo em 30/09/2026) e o menu aberto. Foram feitas no mesmo padrão visual, mas ainda precisam passar pelo Luiz.
3. **Painel** (`painel.html`): ainda com a identidade antiga. Precisa do redesign.
4. **Publicar o front novo** e migrar para aceima.com.br, com redirecionamento 301 do domínio antigo. Só com aprovação.
5. **Publicações:** o conteúdo é ilustrativo. Os textos, fotos e datas virão da diretoria.
6. **Política de privacidade e termos:** o site antigo tinha, o novo ainda não tem.
7. **SEO:** faltam `canonical`, dados estruturados (schema.org/Vehicle) e meta por página.
8. **Faixa branca nas fotos:** o estoque mostra a foto exata da loja, sem zoom (pedido do Luiz, 30/09/2026), então a faixa branca que vem embutida aparece (cerca de 5% das capas, quase todas da Bragança e da Riomix). O ideal é recortar só a faixa na importação, no robô.
9. **Textos do backend** ainda mencionam o nome antigo nos e-mails de lead.
10. **Decisão registrada:** em Associados, "Todos · 23" mostra só as lojas. Serviços e comércio credenciados aparecem no traçado da rua e nos seus próprios filtros.
11. **Avaliações do Google:** a faixa da home mostra avaliações reais (4 e 5 estrelas, com texto) pela API oficial (Places API New), e aparece só quando existe `GOOGLE_PLACES_KEY` na Vercel. Uma vez por dia atualiza até 30 lojas, as mais antigas primeiro, com uma consulta por loja (a pedido do Luiz). Com 23 lojas, todas são atualizadas todo dia. **Nunca subir `LIMITE_DIA` nem a cota do Google sem autorização do Luiz.** A mesma consulta atualiza a nota da loja. A leitura antiga (`notaGoogle()`, pela busca do Google) não funciona mais, porque o Google exige JavaScript. Teste: `node testes/avaliacoes.mjs`. No site, a faixa carrega sozinha, sem esperar as lojas e o estoque (bem mais pesados), e o lugar dela fica guardado enquanto chega, para os textos de cima não pularem. Para aparecer rápido: o pedido sai já no começo da página (`preload`); a rota só lê o banco, sem as migrações, que ficam para a atualização do dia; o cache da Vercel entrega a versão anterior por até 7 dias enquanto busca a nova; e o aparelho guarda as avaliações da última visita (`localStorage`), que aparecem na hora.
