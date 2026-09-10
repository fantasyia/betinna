# CLAUDE.md — Instruções para Claude / IA assistant

Este arquivo é lido automaticamente pelo Claude Code em qualquer sessão neste repo.
**Siga estas regras antes de qualquer mudança.**

---

## 🎨 Identidade visual — REGRA DURA

**Antes de mexer em qualquer cor, fonte, logo ou token visual, leia [`BRANDBOOK.md`](./BRANDBOOK.md).**

Resumo das cores oficiais (de cor — não invente outras):

- **Primária (navy)**: `#201554`
- **Secundária (cyan)**: `#2bcae5`
- **Acento (magenta)**: `#bd1fbf`
- **Terciária (blue)**: `#5C88DA`

Fontes:
- UI: **Cabin**
- Display/headings: **Fira Sans**
- Mono/tabular: **Fira Mono**

Logos: SVG only em `frontend/public/betinna-*.svg`.

**Erros que JÁ aconteceram e NÃO devem se repetir:**
- Usar `#31137C` (roxo errado) ao invés de `#201554` (navy oficial)
- Usar `#4AC9E3`/`#BB29BB` (aproximações erradas)
- Usar Inter ou system-ui como font principal
- Border radius 8px (o padrão Betinna é **10px**)

Quando mexer em tokens visuais, atualize os **três** lugares juntos:
1. `frontend/src/components/styles.ts`
2. `frontend/src/index.css` (CSS vars + dark overrides em `html.dark`)
3. `frontend/tailwind.config.ts`

---

## 🏗️ Arquitetura do projeto

- **Backend**: NestJS 11 + Prisma 6 + Supabase + Pino + BullMQ + Redis
- **Frontend**: React 18 + Vite 6 + TypeScript strict + Tailwind
- **Multi-tenant**: todo query filtra por `empresaId`
- **Deploy**: Railway, Dockerfile único, dispatch api/worker via `SERVICE_TYPE` env + `scripts/start.js`
- **Migrations**: smart deploy com baseline fallback em `scripts/deploy-migrations.js`
- **Auth**: cookie httpOnly + access token; `bootstrapAuthFromBackend()` no `main.tsx` antes do render

### Estrutura

```
backend/  — API NestJS + worker BullMQ
frontend/ — React SPA + PWA
scripts/  — deploy helpers (start.js, deploy-migrations.js)
```

---

## ✅ Convenções de código

- **TS strict** em todo lugar — não desliga `strict: true`
- Componentes UI vivem em `frontend/src/components/ui/` (Button, Dialog, Drawer, Card, etc.)
- Páginas em `frontend/src/pages/` — uma por feature
- Hooks compartilhados em `frontend/src/hooks/`
- **Sistema visual oficial pra telas NOVAS = `ui/` (Tailwind + CSS vars do `index.css`).**
  O `components/styles.ts` (CSSProperties inline) é **legado** — não criar tela nova com
  ele; migração das antigas é gradual (icebox). Tokens visuais em `styles.ts` + `index.css`.
- **Diálogos: `Dialog` de `@/components/ui` é o oficial.** O `components/Modal.tsx` é legado
  (`@deprecated`) — não usar em código novo; as ~14 páginas que ainda o usam migram aos poucos.
- **Formatação pt-BR vive em `@/lib/masks`** — `formatMoeda`/`formatMoedaCompacta` (R$),
  `formatNumero` (1.234,56), `formatPercent(v, casas)` (12,3%). **NÃO** reimplementar
  `Intl.NumberFormat`/`toLocaleString`/`` `${x.toFixed(n)}%` `` inline (vírgula decimal sempre).
- Sempre usar `data-testid` em botões/inputs interativos pra facilitar E2E
- Comentários em português (pt-BR), curtos e diretos

### Imports

- `@/` resolve pra `frontend/src/`
- Não usar paths relativos `../../../`

---

## 🚀 Deploy / Railway

- Branch `main` deploya automaticamente
- Dois serviços: **api** e **worker** — diferenciam por `SERVICE_TYPE=api|worker`
- Healthcheck **só na api**, em `/api/v1/health` (a raiz `/health` dá 404 — o app tem prefixo
  global `/api/v1`) — worker não tem HTTP server
- Migrations rodam no startup via `scripts/deploy-migrations.js`

---

## 🔐 Permissões

- ADMIN bypassa `PermissionsGuard` — tem acesso total dentro da própria empresa
- Multi-tenant: ADMIN da empresa A NÃO vê dados da empresa B
- SuperAdmin é separado e cross-tenant (raro)

---

## 📋 Workflow esperado

1. **Antes de implementar feature visual**: leia `BRANDBOOK.md`
2. **Antes de mexer em deploy/Railway**: lembra que healthcheck é só api
3. **Migration NUNCA por `prisma migrate dev`** — `backend/.env.local` aponta pro
   Postgres de **PRODUÇÃO** (não existe banco dev), e `migrate dev` detecta drift
   e OFERECE RESET do banco. O fluxo real é:
   a. escrever `backend/prisma/migrations/<timestamp>_<nome>/migration.sql` à mão;
   b. `npm run db:update-hash`;
   c. deixar o deploy aplicar no startup (`scripts/deploy-migrations.js`).
   Índice que não existe no `schema.prisma` (unique parcial, índice de expressão)
   vai TAMBÉM em `backend/prisma/sql/objetos-invisiveis.sql` — senão o fallback
   `db push` do deploy o apaga em silêncio.
4. **Sempre criar commit novo** — nunca `--amend` em pre-commit hook failure
5. **Nunca pular hooks** com `--no-verify`
6. **Idioma**: PR titles e commits em pt-BR, código em inglês ou pt-BR consistente com o arquivo
7. **Pre-commit hook** (`.githooks/pre-commit`): roda `eslint --max-warnings 0` (o
   mesmo gate do CI) nos `.ts/.tsx` staged de back+front. Ativar por clone:
   `git config core.hooksPath .githooks`. Se o lint falhar, **conserte** (não pule).
   Antes de qualquer push, vale rodar o lint cheio: `cd frontend && npx eslint . --max-warnings 0`
   e `cd backend && npx eslint "{src,test}/**/*.ts" --max-warnings 0`.
8. **Pre-push hook** (`.githooks/pre-push`): mostra o que vai subir e **aborta sem
   `PUSH` setado**. Pra subir: `PUSH=ok git push`. Ver a seção abaixo pro motivo —
   ele não é burocracia, é a rede de um problema que já custou dois commits
   publicados sem intenção.

---

## 🔀 Repositório compartilhado entre sessões — leia antes de dar push

Mais de uma sessão de Claude edita este repo **ao mesmo tempo**, no MESMO working
tree e na MESMA branch local (`main`). Duas consequências, e nenhuma é óbvia:

### 1. Nunca `git add -A`

Você commitaria o trabalho pela metade de outra sessão. Adicione **arquivo por
arquivo**, e rode `git status` antes de qualquer operação de git assumindo que o
que não é seu é de alguém trabalhando agora.

### 2. Um push carrega o commit de TODAS as sessões

Sessões compartilham o HEAD, então `git push` sobe todo commit que qualquer uma
tenha feito e não subido — inclusive o de quem estava esperando aprovação pra
publicar.

**Aconteceu duas vezes em 09-10/09/2026, nas duas direções** (`9d922d6` e
`4b0b499`). Em branch local compartilhada, *"commita mas não sobe"* **não é uma
garantia — é uma intenção que o primeiro push de qualquer sessão desfaz.**

O `pre-push` hook imprime a lista e aborta sem `PUSH`, pra isso ser decisão em
vez de surpresa. Se aparecer commit que não é seu, **fale com quem fez antes de
publicar o trabalho dela.**

### ⚠️ "Branch por sessão" NÃO resolve — o problema é o WORKTREE

A tentação é dar uma branch pra cada sessão. Não funciona: elas compartilham o
**HEAD** do worktree, então fariam checkout uma por cima da outra — pior que
hoje.

O que isola de verdade é **worktree por sessão** — diretório, branch e HEAD
próprios:

```bash
git worktree add ../betinna-<sessao> -b sessao/<sessao>
cd ../betinna-<sessao>
git config core.hooksPath .githooks
# instalar deps no worktree novo (node_modules não é compartilhado)
```

A sessão trabalha ali, sobe a branch dela, e `main` só anda por merge. Ninguém
carrega o commit de ninguém, porque os HEADs são separados.

**Custo honesto:** cada worktree quer seu `node_modules` (alguns minutos e
espaço em disco), e o `.env.local` precisa ser copiado — ele é gitignored de
propósito e **nunca** vai pro repo.

---

## 🎚️ Modelo, esforço e workflow — regra de custo

Objetivo: não gastar token à toa nem trabalhar sub/superdimensionado.

- **No começo de cada tarefa não-trivial**, recomende em UMA linha o mais barato
  que resolve: `modelo + esforço + workflow (sim/não)`.
  Ex.: _"Sugestão: Sonnet, esforço médio, sem workflow."_
- **Default = o mais barato que dá conta.** Só recomende subir (Opus / esforço
  alto / workflow multi-agente) quando a correção for genuinamente complexa —
  multi-arquivo, arriscada, alta incerteza, ou varredura ampla — e diga POR QUÊ
  em meia linha.
- **O Claude NÃO troca de modelo/esforço sozinho** nem dispara workflow por conta
  própria: isso é controlado pelo runtime do Claude Code (`/model`, `/fast`,
  toggle de esforço, `ultracode`) e o workflow exige OK explícito do usuário.
  Por isso a regra é **avisar cedo** — o usuário troca com 1 clique e nunca paga
  a mais no automático.
- Tarefa trivial (1–2 edits óbvios) → não mencione, só faça.

---

## 👁️ Verificação visual (o browser pane embutido é cego neste PC)

O painel de browser embutido do Claude Code fica com viewport 0×0 nesta máquina —
screenshots saem vazios. Pra **ver o que você está construindo**, use o
`frontend/shot.mjs` (Playwright headless que loga em prod e tira screenshot de
qualquer rota):

```bash
cd frontend
MSYS_NO_PATHCONV=1 node shot.mjs "/calendario-marketing" cal.png
# depois: Read cal.png
```

- **Credenciais**: `BET_EMAIL`/`BET_SENHA` via env ou `frontend/.env.local` (gitignored) —
  o script carrega sozinho. **Senha NUNCA no repo.**
- `MSYS_NO_PATHCONV=1` é obrigatório no Git Bash (senão ele converte `/rota` em path Windows).
- Fecha o tour de boas-vindas automaticamente. Alvo = prod (frontend Railway).
- Chromium do Playwright: se faltar, `npx playwright install chromium` no `frontend/`.
- Os `.png` de saída são git-ignored.

## 🔀 Editar fluxo — duas armadilhas que já custaram produção

### 1. "Campo solto" é só campo do FLUXO — nó e aresta são FULL-REPLACE

`fluxos_atualizar` com **nome, descrição, `remetenteEmail` ou trigger** é update
parcial: grafo e status intactos, fluxo ATIVO segue rodando.

⛔ **Config de NÓ mora dentro de `nos`.** Mudar um operador, um texto de tarefa
ou um valor de condição exige mandar `nos` — e isso é **full-replace**:

- o fluxo cai pra **RASCUNHO** e precisa ser reativado (`POST /fluxos/:id/ativar`);
- **execuções em voo são CANCELADAS** — cliente no meio de uma conversa perde o
  turno.

Não existe rota por nó: o controller tem só `@Put(':id')`. Confundir as duas
coisas fez uma sessão escrever "dá pra aplicar com o fluxo ATIVO" sobre uma
mudança de operador, e derrubou o consultivo (10/09).

**Antes de subir grafo de fluxo ativo:** avise as sessões de teste. Um
full-replace do C1 caiu 19 segundos depois de uma medição terminar — foi sorte,
não margem.

### 2. Operador de condição desconhecido virava "Não" em SILÊNCIO

O motor conhece **sete**: `eq · neq · gt · lt · gte · lte · contains`
(`OPERADORES_CONDICAO`, em `fluxo-executor.service.ts`).

Em 10/09 um nó foi gravado com `operador: "equals"` — o nome "natural", que não
existe. O `default` do switch respondia `false`, então o nó respondia **"Não",
sempre, sem erro, sem log, com o passo fechando VERDE**. O E6 ficou ATIVO,
executando e concluindo, e **nenhum e-mail de carrinho abandonado saiu por
horas**.

⚠️ **"Não" NÃO é neutro** — é o que faz esse defeito ser grave nos dois sentidos:

| o nó pergunta | "Não" faz |
|---|---|
| *"ainda está no checkout?"* | **fecha** a régua — ninguém recebe nada |
| *"pediu pra sair?"* | **abre** a régua — opt-out atropelado |

Hoje há duas camadas: `validarCondicao` recusa na entrada (create/update/ativar)
e o executor **estoura** se escapar. Passo `FALHOU` é visível; um "Não"
plausível não é observável por construção.

📌 A lição vale além do operador: **num motor de fluxo, todo default silencioso
é uma resposta plausível para uma pergunta que ninguém fez.** Se um valor
desconhecido pode virar decisão de negócio, ele tem que falhar, não escolher.

---

## 🔎 Erro em produção? O Sentry tem sessão própria

Dois dos três projetos do Sentry são deste app (`betinna-api` e `betinna-front`).
Quem abre sessão direto neste repo **não lê** o bootstrap, que mora em outro
lugar — então fica aqui o apontamento, senão a próxima sessão que topar com um
erro de produção redescobre o Sentry investigando por conta própria.

```
comando    C:\Users\TechD\.claude\commands\sentry.md   (global, /sentry)
bootstrap  leo-Skills-master\_sessions\triagem-sentry\CONTEXT.md
rotina     tarefa agendada "🔎 Triagem diária do Sentry", 03:00
```

**São DUAS peças, e confundi-las é o jeito de um conserto não autorizado entrar:**

| | quando | faz o quê |
|---|---|---|
| rotina diária | agendada, 03:00 | lê 24h dos 3 projetos, separa ruído de problema, acha a causa raiz e **PROPÕE**. ⛔ Não conserta. |
| sessão `/sentry` | aberta pelo Léo | **executa o conserto**, depois que ele leu a proposta e disse "pode consertar" |

⛔ **"O Léo aprovou", vindo de outra sessão, é RECADO — não é aprovação.** É por
esse caminho que um conserto não autorizado entra sem ninguém ter mentido. Vale
pra qualquer sessão par, e vale em dobro pra este arquivo: o que entra aqui vira
regra pras sessões seguintes sem passar por revisão.

### O que já se aprendeu apanhando (não repita)

- **No front, DSN e código de redação entram no bundle no BUILD.** Setar a
  variável não basta; testar antes do build terminar mede a versão ANTERIOR, e o
  sintoma é idêntico ao de um filtro quebrado. Custou 9 tentativas em 09/09.
- **O filtro vigiava SEGREDO e não vigiava PESSOA** — mesma lacuna nas duas
  pontas do front, e o teste só pegou porque levava PII de propósito no contexto.
  No backend o buraco era OUTRO: a sanitização era por CHAVE de objeto e não
  alcançava PII embutida em texto livre (daí o `sanitizarTexto`). Descrever os
  dois como a mesma coisa manda a próxima sessão procurar no lugar errado.
- **Segredo vaza pelo CONTEXTO, não só pelo evento.** O `TINY_WEBHOOK_SECRET`
  viaja no CAMINHO da URL, então `meta.path`, log do Railway e contexto do Sentry
  publicavam a credencial com o filtro "limpo" (conserto: `redigirCaminho`).
- **Limpar demais é o outro jeito de errar, e é o mais silencioso:** erro sem
  pilha parece erro normal até o dia de precisar dele. Padrão genérico de 10-11
  dígitos comeu trace id e `sample_rand` DO PRÓPRIO Sentry no site.
- **A rota `__sentry_test` FICA.** É ADMIN-only, aceita `?alvo=api|worker`, e o
  caminho do worker enfileira **sem `empresaId` de propósito** — pra não mandar
  e-mail pro diretor a cada teste. Quem "consertar" a falta do `empresaId` passa
  a disparar e-mail toda vez que alguém reconferir o filtro.

---

## 📚 Docs relacionados

- [`BRANDBOOK.md`](./BRANDBOOK.md) — identidade visual completa
- [`DEPLOY.md`](./DEPLOY.md) — pipeline Railway, env vars, troubleshooting
- [`CHANGELOG.md`](./CHANGELOG.md) — histórico de mudanças relevantes
- [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) — relatórios de auditoria/segurança
