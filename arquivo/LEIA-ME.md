# Arquivo — o que saiu do site novo

Guardado em 22/09/2026, quando o protótipo passou para a identidade ACEIMA.
**Não apagar enquanto o site não estiver fechado.**

| Arquivo | O que é |
|---|---|
| `prototipo-antes-do-redesign.html` | O protótipo inteiro como estava antes do redesign. Serve de referência para qualquer coisa que a gente queira resgatar. |
| `views-removidas.html` | As duas páginas que saíram da estrutura nova: **Venda seu veículo** e **Contato**. O CSS e o JS delas continuam em `prototipo.html`, então basta colar a página de volta e criar a rota. |

## Por que saíram

A estrutura aprovada pela diretoria é: Início · A ACEIMA · Associados · Estoque · Seja um associado · Publicações.
"Venda seu veículo" e "Contato" não entram nessa lista. Os endereços antigos `/vender` e `/contato` continuam
respondendo: `/vender` cai em *Seja um associado* e `/contato` cai em *A ACEIMA*.

## Ainda no diretório principal (fora do site novo)

- `site-online/` — cópia do site antigo do Auto Certo. Continua ali como referência da migração.
- `painel.html` — painel administrativo, ainda com a identidade antiga. Redesign pendente.
