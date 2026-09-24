# Como levar o projeto para o Claude Code

A pasta `aceima-site` já está pronta para o Claude Code. O `CLAUDE.md` explica o projeto, as regras e as pendências, e o Claude Code lê esse arquivo sozinho toda vez que abre a pasta.

## 1. Instalar o Claude Code (uma vez só)

Abra o **PowerShell** e rode:

```
irm https://claude.ai/install.ps1 | iex
```

Depois confira se instalou:

```
claude --version
```

Instale também o [Git for Windows](https://git-scm.com/downloads/win) (é opcional, mas ajuda) e o [Node.js](https://nodejs.org), que é necessário para rodar o site localmente.

Se preferir não usar o terminal, o app Claude Desktop também abre o Claude Code.

## 2. Abrir o projeto

No PowerShell:

```
cd "C:\Users\Luiz\Desktop\Trabson's\ACEIMA\Projeto Site\Site\aceima-site"
claude
```

Na primeira vez, ele abre o navegador para você entrar com a sua conta Claude.

## 3. Primeira mensagem

Cole esta mensagem para ele se situar antes de mexer em qualquer coisa:

> Leia o CLAUDE.md e os mockups em docs/mockups-aprovados. Depois rode o site localmente, abra index.html e o codigo-dos-mockups.html lado a lado e me diga se encontrou alguma diferença entre o site e o que foi aprovado. Não altere nada ainda e não publique nada.

## 4. Ligar ao repositório que já existe

O site já tem um repositório no GitHub, o **luiz-ed-lab/intendente-shopping-car**, e ele está ligado à Vercel: o que entra na `main` vai para o ar. Peça ao Claude Code:

> Conecte esta pasta ao repositório luiz-ed-lab/intendente-shopping-car, crie uma branch "site-novo" com estes arquivos e envie só essa branch. Não mexa na main.

Com isso a Vercel gera um endereço de prévia do site novo, que você abre no celular e no computador sem trocar o site que está no ar. Daqui para frente, cada mudança fica registrada e dá para voltar atrás. Para usar o git, o Claude Code vai pedir para você entrar na conta do GitHub. Esse login é feito por você.

## 5. Publicar (só quando você aprovar)

Aprovou a prévia? Aí é pedir o merge da branch na `main`, e o site novo entra no ar em intendente-shopping-car.vercel.app. A troca para aceima.com.br é um passo à parte, com redirecionamento do domínio antigo. O `CLAUDE.md` já instrui o Claude Code a não publicar nada sem a sua aprovação.

As senhas (`DATABASE_URL`, `PAINEL_TOKEN`, `RESEND_API_KEY` e as demais) continuam só na Vercel. Nunca cole esses valores no chat nem em arquivo.

## O que está na pasta

- `index.html`: o site novo, idêntico aos mockups aprovados.
- `painel.html`: o painel da ACEIMA, ainda com a identidade antiga.
- `api/`, `vercel.json`, `package.json`, `.github/`: a API, o banco e o robô de estoque, os mesmos que já rodam na Vercel.
- `docs/mockups-aprovados/`: as telas aprovadas e o código que gerou cada uma.
- `docs/ACEIMA-Redesign-v8.pdf`: o deck aprovado.
- `docs/referencia/`: a análise do site antigo, o plano do robô importador e o schema do banco.
- `arquivo/`: as páginas que saíram do site novo (Venda seu veículo e Contato), guardadas como ponto de partida.

Os decks antigos, os PDFs e as cópias do site antigo continuam na pasta `Site`, fora do projeto. Não fazem falta ao Claude Code.
