# Importador de Anúncios — Plano Técnico (ACEIMA)

Este é o coração do projeto: o robô que lê o estoque das lojas e mantém o nosso site atualizado sozinho, sem ninguém cadastrar carro na mão. Aqui está como ele funciona e o que precisa ser feito.

---

## 1. O que o importador faz, em uma frase

Todo dia (de hora em hora), o robô visita a página de cada loja associada, lê todos os anúncios (carro, preço, km, ano, opcionais, fotos e a logo da loja), copia as fotos para o nosso servidor e atualiza o nosso banco de dados. O site que o cliente abre lê sempre desse banco — rápido e sempre atualizado.

---

## 2. As duas metades do sistema

**Frente (o que já existe como protótipo):** o site público e o painel da ACEIMA. Hoje eles usam dados de exemplo embutidos. Na versão real, passam a ler do banco de dados.

**Fundo (o que falta construir):** o servidor com banco de dados + o robô importador + o serviço de leads. É a parte que dá "vida" ao site.

---

## 3. Fluxo do importador (passo a passo)

1. **Cadastro da loja** (feito no painel ACEIMA): nome, telefone/WhatsApp, e o link ou ID do estoque da loja no Auto Certo.
2. **Leitura** (robô): acessa a página da loja e extrai a lista de anúncios. Como todas as lojas usam o mesmo modelo de site do Auto Certo, um único leitor serve para todas.
3. **Extração de dados** de cada anúncio: marca, modelo, versão, ano, km, preço, câmbio, combustível, opcionais, e a URL das fotos.
4. **Re-hospedagem das fotos**: baixa cada foto e guarda no nosso servidor/CDN. **Isso é o que nos livra de depender do Auto Certo** — se eles saírem do ar, nossas fotos continuam.
5. **Gravação no banco**: cria/atualiza cada veículo. Veículos que sumiram do estoque da loja (venderam) são marcados como inativos e somem do site.
6. **Publicação**: o site já mostra o estoque novo, porque lê do banco.
7. **Repetição**: tudo isso roda automaticamente de hora em hora.

---

## 4. Estrutura de dados (banco)

**Lojas** — id, nome, endereço, telefone, whatsapp, e-mail, id_no_autocerto, url_logo, ativa.

**Veículos** — id, id_da_loja, marca, modelo, versão, ano, km, preço, câmbio, combustível, opcionais, tipo (carro/moto), fotos (lista), ativo, data_da_última_sincronização.

**Leads** — id, id_da_loja, id_do_veículo, nome_cliente, telefone, forma_de_compra (à vista / financiado), entrada, canal (WhatsApp/formulário), status (novo/enviado/atendido), data.

---

## 5. O serviço de leads

Quando o cliente preenche "Tenho interesse" no site, o backend faz 3 coisas ao mesmo tempo:

1. **Registra o lead** no banco (aparece no painel da ACEIMA).
2. **Encaminha ao WhatsApp** da loja (link já pronto no protótipo).
3. **Dispara os e-mails**: um para a loja com os dados do cliente, e um para a ACEIMA registrando que o lead foi encaminhado.

Os itens 1 e 3 são a parte que falta ligar (precisa do servidor). O WhatsApp já funciona no protótipo.

---

## 6. Tecnologias sugeridas

- **Site + painel**: podem continuar como estão (HTML/CSS/JS), ou migrar para um framework quando crescer.
- **Backend/robô**: Node.js (mesma linguagem do front, facilita) rodando na Vercel (funções serverless) ou num servidor simples.
- **Banco de dados**: Postgres (ex: Neon ou Supabase — têm plano gratuito e integram com a Vercel).
- **Fotos**: armazenamento em CDN (Vercel Blob, Cloudflare R2 ou similar).
- **Agendamento (de hora em hora)**: Vercel Cron Jobs.
- **E-mails**: um serviço tipo Resend ou SendGrid.

---

## 7. Cuidados importantes

- **Não sobrecarregar o Auto Certo**: ler de hora em hora, com pausas entre as lojas. De hora em hora está tranquilo mesmo com 50+ lojas.
- **Resiliência**: se o Auto Certo mudar o layout do site, o leitor pode quebrar. Por isso as fotos re-hospedadas e um alerta automático quando uma importação falhar são essenciais.
- **Titularidade do domínio**: confirmar/transferir intendenteautoshopping.com.br para a ACEIMA antes de divulgar.
- **LGPD**: os dados dos leads são pessoais — guardar com segurança, ter política de privacidade (já criada) e permitir descadastro.

---

## 8. Ordem sugerida de construção

1. **Banco de dados + cadastro de lojas** (painel grava de verdade).
2. **Robô leitor de 1 loja** (validar a extração numa loja real).
3. **Re-hospedagem de fotos**.
4. **Rodar para todas as lojas + agendamento de hora em hora**.
5. **Serviço de leads** (registro + e-mails).
6. **Ligar o site e o painel ao banco** (trocar os dados de exemplo pelos reais).
7. **Migração**: redirecionar as URLs antigas, apontar o domínio, e só então encerrar o Auto Certo.

---

*Este documento é o mapa da fase de backend. O protótipo atual (site + painel) já demonstra toda a experiência; falta construir o "motor" descrito aqui.*
