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
- Healthcheck **só na api** (`/health`) — worker não tem HTTP server
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
3. **Antes de criar migration**: rodar `prisma migrate dev` local primeiro
4. **Sempre criar commit novo** — nunca `--amend` em pre-commit hook failure
5. **Nunca pular hooks** com `--no-verify`
6. **Idioma**: PR titles e commits em pt-BR, código em inglês ou pt-BR consistente com o arquivo
7. **Pre-commit hook** (`.githooks/pre-commit`): roda `eslint --max-warnings 0` (o
   mesmo gate do CI) nos `.ts/.tsx` staged de back+front. Ativar por clone:
   `git config core.hooksPath .githooks`. Se o lint falhar, **conserte** (não pule).
   Antes de qualquer push, vale rodar o lint cheio: `cd frontend && npx eslint . --max-warnings 0`
   e `cd backend && npx eslint "{src,test}/**/*.ts" --max-warnings 0`.

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

## 📚 Docs relacionados

- [`BRANDBOOK.md`](./BRANDBOOK.md) — identidade visual completa
- [`DEPLOY.md`](./DEPLOY.md) — pipeline Railway, env vars, troubleshooting
- [`CHANGELOG.md`](./CHANGELOG.md) — histórico de mudanças relevantes
- [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) — relatórios de auditoria/segurança
