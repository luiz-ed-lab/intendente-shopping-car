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
| `marca-nova/` | Logos novas. O site usa `aceima-nova.png` (ACEIMA sem descrição). |
| `fundo-vidro.mp4` | Vídeo do fundo animado (vidro em diagonal). `fundo-animado-frame.jpg` é um quadro dele, usado enquanto o vídeo carrega. |
| `docs/` | Mockups aprovados, deck aprovado, análise do site antigo, plano do importador, schema do banco. |
| `arquivo/` | Partes do site antigo que saíram do novo. **Não apagar** até o site estar fechado. |

### Backend

- Banco: Postgres no Neon, via `@neondatabase/serverless`. A própria API cria as colunas que faltam (`migra()`). O schema original está em `docs/referencia/schema.sql`.
- Robô importador: lê o site de cada loja (com `cheerio`) e grava os anúncios. Plano completo em `docs/referencia/importador-plano-tecnico.md`.
- Rotas (o front chama `/api/<rota>?path=<rota>`): `lojas`, `parceiros`, `veiculos`, `leads`, `importar`, `refresh`, `auth`. Protegidas por `PAINEL_TOKEN`: `resumo`, `testeemail`, `conteudo`. A rota `avaliacoes` devolve as avaliações reais do Google para a faixa da home (guardadas em `config`, atualizadas uma vez por dia).
- E-mails de lead: Resend.
- Variáveis de ambiente (nomes em `.env.example`, valores só na Vercel): `DATABASE_URL`, `PAINEL_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `ACEIMA_EMAIL`, `SITE_URL`, `GITHUB_TOKEN`, `GOOGLE_PLACES_KEY`.

### Front (`index.html`)

- Cada página é uma função que devolve HTML: `home`, `estoque`, `associados`, `veiculo`, `aceima`, `associar`, `publicacoes`, `servicos`. O objeto `VIEWS` liga nome e função, e `go(pagina)` navega.
- Endereços: `/`, `/estoque`, `/associados`, `/a-aceima`, `/seja-um-associado`, `/publicacoes`, `/servicos`, `/veiculo/ID-nome`. Os endereços antigos `/lojas`, `/aceima`, `/vender` e `/contato` redirecionam. Aberto direto do disco (`file://`), usa `#/rota`.
- Dados: `carregar()` busca `/api/lojas` e `/api/veiculos`. Sem API (aberto do disco), usa a amostra `AMOSTRA_V` / `AMOSTRA_L`, que são os mesmos carros dos mockups.
- Os anúncios aparecem intercalados entre as lojas, e nenhuma loja domina a vitrine (`intercalar()`). Não trocar isso por ordenação simples.
- Celular (até 760px): as medidas foram tiradas das telas de celular aprovadas, com 284px de largura útil, e convertidas em `vw`. Para mudar um tamanho no celular, mantenha essa conversão (px ÷ 2,84 = vw).
- Textos: todo texto institucional passa por `T(id, padrão)`. O que o Luiz edita fica em `conteudo.js` com o mesmo id e vence o padrão. Números que mudam com os dados entram como `{veículos}`, `{lojas}`, `{associados}`, `{anos}` e `{veículos arredondados}` (com "por extenso" saem em palavras). Ao mudar um texto no código, confira se ele não está sobrescrito em `conteudo.js`. Não troque um id que já tem edição, senão a edição se perde.
- Modo de edição: `/?editar`, com a senha do painel. Cores, fontes e pesos ficam limitados às listas `CORES`, `FONTES` e `PESOS`. Salvar faz um commit no ramo pela rota `/api/conteudo`, que precisa da variável `GITHUB_TOKEN`. **Como o Luiz faz commits pelo site, rode `git pull` antes de mexer e antes de cada push.** Teste da rota: `node testes/conteudo.mjs`.
- Menu: o botão redondo se abre numa lista, seguindo o componente "List Item / Filter Interaction" de uselayouts (21st.dev). Itens com ícone, nome e círculo de marcação; entrada em cascata.

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

- Paleta: azul profundo `#00091A`, dourado `#C8862E` / `#E8A048` / `#F4B05C`, off-white `#F6F4F1`, tinta `#0B1A33`. Fontes: Archivo (títulos) e Poppins (textos).
- Fundo: a animação de vidro em diagonal do template payload-marketing (21st.dev), exatamente igual, e não uma aproximação em gradiente. Discreta: opacidade 0,17, `mix-blend-mode: screen`, brilho 0,78. Nunca pode ficar parado.
- Azul no topo, nos blocos de ação e no estoque. Páginas de leitura têm o corpo em fundo claro.
- A logo da frente é a da ACEIMA. "INTENDENTE" é o nome do polo e aparece no conteúdo.
- Foto de carro só no estoque. Nas outras páginas, nada de foto de carro.
- Mosaico do estoque: sem espaço vazio (colunas da mesma altura), nenhuma foto vertical, nenhum bloco perto de quadrado, tamanhos variados. As fotos das lojas têm faixa branca embutida: recortar com zoom forte (`scale(1.5)`).
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
- Ele quer respostas curtas e diretas. Não liste cada passo que você deu.
- Soluções simples: o site é um arquivo HTML sem build de propósito. Não introduzir framework nem dependência sem pedir.

## Pendências (em 24/09/2026)

1. **Vídeo do fundo:** é o arquivo do template de terceiros. Confirmar a licença ou gerar um vídeo nosso equivalente. Também está com 17 MB, então vale gerar uma versão mais leve para celular.
2. **Páginas sem mockup aprovado:** A ACEIMA, Seja um associado, Publicações, Serviços do polo, página do veículo e o menu aberto. Foram feitas no mesmo padrão visual, mas ainda precisam passar pelo Luiz.
3. **Painel** (`painel.html`): ainda com a identidade antiga. Precisa do redesign.
4. **Publicar o front novo** e migrar para aceima.com.br, com redirecionamento 301 do domínio antigo. Só com aprovação.
5. **Publicações:** o conteúdo é ilustrativo. Os textos, fotos e datas virão da diretoria.
6. **Política de privacidade e termos:** o site antigo tinha, o novo ainda não tem.
7. **SEO:** faltam `canonical`, dados estruturados (schema.org/Vehicle) e meta por página.
8. **Faixa branca nas fotos:** hoje é resolvida com zoom no CSS. O ideal é recortar a foto na importação, no robô.
9. **Textos do backend** ainda mencionam o nome antigo nos e-mails de lead.
10. **Decisão registrada:** em Associados, "Todos · 23" mostra só as lojas. Serviços e comércio credenciados aparecem no traçado da rua e nos seus próprios filtros.
11. **Avaliações do Google:** a faixa da home mostra avaliações reais (4 e 5 estrelas, com texto) pela API oficial (Places API New), e aparece só quando existe `GOOGLE_PLACES_KEY` na Vercel. Uma vez por dia atualiza até 30 lojas, as mais antigas primeiro, com uma consulta por loja (a pedido do Luiz). Com 23 lojas, todas são atualizadas todo dia. Se passar de 30 lojas, subir `LIMITE_DIA` e a cota no Google. A mesma consulta atualiza a nota da loja. A leitura antiga (`notaGoogle()`, pela busca do Google) não funciona mais, porque o Google exige JavaScript. Teste: `node testes/avaliacoes.mjs`.
