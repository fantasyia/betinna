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
- Tokens visuais em `frontend/src/components/styles.ts` (legacy CSSProperties) e `index.css` (CSS vars novas)
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

---

## 📚 Docs relacionados

- [`BRANDBOOK.md`](./BRANDBOOK.md) — identidade visual completa
- [`DEPLOY.md`](./DEPLOY.md) — pipeline Railway, env vars, troubleshooting
- [`CHANGELOG.md`](./CHANGELOG.md) — histórico de mudanças relevantes
- [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) — relatórios de auditoria/segurança
