# ACTION_PLAN — Betinna.ai (Post-Master-Validation)

**Data:** 2026-05-18 (rótulo `2026-05-16` por solicitação do prompt master)
**Baseado em:** `PROJECT_MAP_2026-05-16.md` (mesmo dia) + `MASTER_VALIDATION_REPORT_2026-05-17.md`
**Objetivo:** Plano de ação priorizado pra fechar gaps e definir próximos passos antes do go-live com clientes reais.

> **Sem execução nesta sessão** — apenas planejamento.

---

## Seção 1 — Veredicto Geral

### Estado de saúde: 🟡 **Atenção (1 fix técnico pendente bloqueia go-live limpo)**

> Reclassificado da MASTER_VALIDATION (que dizia 🟢 GO) porque há **2 pendências P0 documentadas (migrations baseline + TD-C consolidação Postgres)** que precisam fechar antes do **1º cliente real**. Pra ambiente de dev/demo continua 🟢.

### Pontos fortes (Top 5)

| # | Ponto forte | Evidência |
| --- | --- | --- |
| 1 | **Segurança madura** | 0 P0/P1, 0 npm vulns, SSRF guard, HMAC em 5 webhooks, anti-replay, refresh rotation, AES-256-GCM em credenciais, CronLock distribuído |
| 2 | **Cobertura funcional ampla** | 33 módulos backend + 43 páginas frontend cobrindo CRM, vendas, automação, SAC multicanal, fidelidade, NPS, fluxos visuais, MullerBot RAG |
| 3 | **Multi-tenant rigoroso** | 47/47 modelos com `empresaId` validado; `RepScopeService` centraliza visibilidade rep→gerente |
| 4 | **Integrações reais** | 4 marketplaces (ML/Shopee/Amazon/TikTok), OMIE, Meta (FB+IG), Google Calendar, SendGrid, WhatsApp Baileys dual-owner — tudo com webhook validation + cron fallback 10min |
| 5 | **Frontend completo** | 43 páginas, dark mode, brandbook oficial aplicado, PWA, exports CSV/XLSX/DOCX/PDF, 67KB bundle, dnd-kit kanban + sortable, useConfirm reutilizável |

### Pontos fracos (Top 5)

| # | Ponto fraco | Evidência |
| --- | --- | --- |
| 1 | **Migrations baseline ausente** | Nenhuma `0_init` em `backend/prisma/migrations/`; deploy novo precisa do smart-fallback pra funcionar |
| 2 | **TD-C consolidação Postgres não executada** | Railway Postgres + Supabase Postgres coexistem; risco operacional baixo enquanto não tem cliente real |
| 3 | **6 módulos backend sem testes** | `formularios`, `funis`, `health`, `metas`, `nps`, `segmentos` — todos sem `.spec.ts` |
| 4 | **6 páginas frontend >800 LOC** | ClienteDetailPage(1951), PedidosPage(1141), PedidoDetailPage(801), InboxPage(857), FluxoEditor(890), FormularioBuilder(857) — refactor difícil quando crescer mais |
| 5 | **Documentação desatualizada** | CHANGELOG sem entrada cobrindo última semana (funis, brandbook, useConfirm, ESTOQUE_ZERADO); `docs/modules/funis.md` inexistente |

### Prontidão para go-live com clientes reais: **~85%**

Cálculo:
- ✅ Funcionalidades core: 95% (33/33 módulos cobertos com ≥1 endpoint funcional)
- ✅ Segurança: 100% (audit limpa)
- ⚠️ Operacional: 70% (migrations + TD-C pendentes; secrets GH pendentes)
- ✅ Performance: 95% (bundle ok, code splitting, cache)
- ⚠️ Cobertura testes: 80% (6 módulos sem; frontend só E2E)
- ⚠️ Documentação: 85% (3 docs faltantes)

**Recomendação:** Fechar P0 da Seção 2 antes de onboardar 1º cliente real. Demos e testes internos podem prosseguir.

---

## Seção 2 — Correções Urgentes P0/P1

### 🔴 P0-1 — Criar baseline `0_init` migration

| Campo | Valor |
| --- | --- |
| **Problema** | `backend/prisma/migrations/` tem 13 migrations incrementais mas falta a baseline `0_init`. Deploy novo (ex: ambiente staging zerado) aplica as 13 sequencialmente sem garantia de chegar ao estado correto. |
| **Por que é urgente** | Em ambiente novo, sem baseline, `prisma migrate deploy` pode aplicar migrations sobre schema inexistente. O smart-fallback `scripts/deploy-migrations.js` mitiga mas é workaround. |
| **Impacto se não corrigir** | Risco de deploy quebrar em staging novo, multi-region setup, ou redeploy do prod. Drift entre schemas de envs. |
| **Esforço** | **S** (1-2h) |
| **Arquivos afetados** | `backend/prisma/migrations/0_init/migration.sql` (a criar), `backend/prisma/migrations/migration_lock.toml` |
| **Plano** | 1. `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/0_init/migration.sql`<br>2. Em prod existente: `prisma migrate resolve --applied 0_init` (marca como aplicada sem rodar)<br>3. Em prod existente: `prisma migrate resolve --applied <cada-uma-das-13-existentes>` para sincronizar `_prisma_migrations` table<br>4. Validar com `prisma migrate status` |

### 🔴 P0-2 — TD-C: Consolidar Postgres Railway → Supabase

| Campo | Valor |
| --- | --- |
| **Problema** | Hoje Railway Postgres plugin é o DB principal. Supabase é usado só pra Auth + Storage. Ter 2 Postgres em prod = complexidade operacional (2 backups, 2 monitorings, 2 connection pools, cross-region latency potencial). |
| **Por que é urgente** | Antes do 1º cliente real, mover de DB. Depois é dor. |
| **Impacto se não corrigir** | Operacional duplicado, SQL editor Supabase não funciona (mostra schema vazio), gestão duplicada de backups |
| **Esforço** | **M** (4-8h) |
| **Arquivos afetados** | `.env` (DATABASE_URL/DIRECT_URL apontam Supabase), Railway env vars |
| **Plano** | Procedimento já documentado em `backend/_audit/POSTGRES_CONSOLIDACAO_TD-C.md` (7 passos): backup Railway → drop schema Supabase → `prisma migrate deploy` → re-seed → atualizar Railway env → smoke test → desativar Railway plugin após 1 semana estável |

### 🟠 P1-1 — Configurar GitHub Secrets pra deploy automatizado

| Campo | Valor |
| --- | --- |
| **Problema** | CI workflow `ci.yml` tem job de deploy gated por `RAILWAY_TOKEN`. Sem o secret, deploy é manual. |
| **Por que é urgente** | Erro humano em deploy manual é vetor de bugs em prod. Automação reduz risco. |
| **Impacto se não corrigir** | Continua manual; tempo de deploy aumenta; janela pra erro de procedimento. |
| **Esforço** | **S** (15min — só pegar token do Railway e colar no GH) |
| **Arquivos afetados** | GitHub Secrets (UI) |
| **Plano** | 1. Railway → Account Settings → Tokens → criar `betinna-deploy-prod`<br>2. GitHub repo → Settings → Secrets → New repository secret: `RAILWAY_TOKEN`<br>3. (Opcional) `E2E_BASE_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` pra job E2E |

### 🟠 P1-2 — Atualizar `prisma generate` workflow local em Windows

| Campo | Valor |
| --- | --- |
| **Problema** | DLL lock no Windows quando dev server está rodando — `prisma generate` falha com EPERM (documentado em `backend/CLAUDE.md` §8) |
| **Por que é urgente** | Toda mudança de schema bloqueia dev até matar processo Node manualmente. Atrapalha velocidade. |
| **Impacto se não corrigir** | Dev workflow degradado; novos enums/models não disponíveis no client até hard restart |
| **Esforço** | **S** (30min) |
| **Arquivos afetados** | `backend/package.json` scripts (sugestão: `db:generate:safe` que faz `pm2 stop` ou similar antes de gerar) |
| **Plano** | Documentar workaround claro em `backend/CLAUDE.md`: matar dev server antes de `npx prisma generate` em Windows. Em CI/Linux funciona normal. |

### 🟠 P1-3 — Atualizar CHANGELOG.md cobrindo última semana

| Campo | Valor |
| --- | --- |
| **Problema** | Última entrada CHANGELOG é `[1.1.0] 2026-05-17`. Esta semana entrou: funis customizados, brandbook + dark mode, useConfirm hook, ESTOQUE_ZERADO notification, sync OMIE 30min, métricas cliente, tabs Propostas/Amostras/Ocorrências, página `/funis`, página `/pedidos/:id`, duplicar/editar pedido (backend + frontend), kanban transições bidirecionais, validation sweep em 8 forms. |
| **Por que é urgente** | Audit trail. Reproduzir/rollback fica difícil sem CHANGELOG atualizado. |
| **Impacto se não corrigir** | Histórico perdido; difícil pra contributors entenderem o que mudou |
| **Esforço** | **S** (1h) |
| **Arquivos afetados** | `CHANGELOG.md` |
| **Plano** | Criar `[1.2.0] - 2026-05-18` com seções Added/Changed/Fixed cobrindo cada commit dos últimos 10 dias (revisar `git log` desde `1.1.0` ou commit `978561a`) |

### 🟠 P1-4 — Criar `docs/modules/funis.md`

| Campo | Valor |
| --- | --- |
| **Problema** | Funis customizados foram implementados (`backend/src/modules/funis/`, `frontend/src/pages/FunisPage.tsx`) mas sem doc em `docs/modules/` |
| **Por que é urgente** | Onboarding de devs novos sem doc é doloroso |
| **Impacto se não corrigir** | Conhecimento fica só no código; risco bus-factor |
| **Esforço** | **S** (1h) |
| **Arquivos afetados** | `docs/modules/funis.md` (novo) + linkar em `docs/modules/README.md` |
| **Plano** | Seguir template dos outros docs/modules (objetivo, modelos, endpoints, fluxos, edge cases) |

### 🟠 P1-5 — Adicionar testes nos 6 módulos novos sem cobertura

| Campo | Valor |
| --- | --- |
| **Problema** | `formularios`, `funis`, `health`, `metas`, `nps`, `segmentos` não têm `.spec.ts`. Health é trivial mas os outros têm lógica de negócio. |
| **Por que é urgente** | Qualquer mudança nestes módulos arrisca regressão silenciosa |
| **Impacto se não corrigir** | Regressões descobertas em produção |
| **Esforço** | **L** (8-12h pra 6 módulos com cobertura adequada) |
| **Arquivos afetados** | 6 arquivos `*.service.spec.ts` novos |
| **Plano** | Seguir padrão Vitest existente: mock PrismaService, testar happy path + edge cases + assertion empresaId. Prioridade: funis > metas > nps > segmentos > formularios > health |

---

## Seção 3 — Débito Técnico P2

### 🟡 P2-1 — Deprecar `MarketplaceMsg` e `MarketplaceOrder` (legacy)

| Campo | Valor |
| --- | --- |
| **Problema** | Schema Prisma ainda tem 2 modelos legacy substituídos por `Conversation` + `MarketplaceIncident`. Não são usados em código novo mas ocupam espaço e podem confundir leitor. |
| **Esforço** | **M** (4h — migration drop + remover models do schema + verificar zero usage) |
| **Plano** | Validar via `grep` que nenhum service usa esses models; criar migration drop; remover do schema; gerar client |

### 🟡 P2-2 — Refatorar páginas grandes (>800 LOC)

| Página | LOC | Plano |
| --- | --- | --- |
| `ClienteDetailPage.tsx` | 1951 | Extrair cada Tab pra arquivo próprio (`DadosTab.tsx`, `PedidosTab.tsx`, etc) |
| `PedidosPage.tsx` | 1141 | Extrair `PedidoDetailDrawer` pra arquivo separado |
| `PedidoDetailPage.tsx` | 801 | OK por enquanto |
| `InboxPage.tsx` | 857 | Extrair `ConversationPanel`, `MessageList`, `ComposeBox` |
| `FluxoEditor.tsx` | 890 | Extrair `NodeConfigPanel`, `NodeLibrary` |
| `FormularioBuilder.tsx` | 857 | Extrair `FieldPalette`, `LogicEditor` |

**Esforço total:** **XL** (16-24h). Pode ser feito incrementalmente, 1 página por sprint.

### 🟡 P2-3 — Adicionar testes Vitest no frontend

| Campo | Valor |
| --- | --- |
| **Problema** | 0 unit tests no frontend. Apenas 13 E2E Playwright. |
| **Esforço** | **M** (4-6h pra setup + ~10 testes core) |
| **Plano** | Setup `vitest` + `@testing-library/react` em `frontend/`. Testar: hooks (useApiQuery, usePermission, useConfirm, useTheme), components/StateView, components/ui/Field (validação), components/AsyncCombobox (debounce + fetch) |

### 🟡 P2-4 — Migrar `Modal` legacy → `Dialog` (design system)

| Campo | Valor |
| --- | --- |
| **Problema** | Coexistem `frontend/src/components/Modal.tsx` (legacy) e `frontend/src/components/ui/Dialog.tsx` (DS). Páginas antigas usam Modal. |
| **Esforço** | **M** (3-4h) |
| **Plano** | Identificar todas as usages do Modal legacy (grep), migrar pra Dialog, remover Modal.tsx |

### 🟡 P2-5 — Cache cross-page com TanStack Query (opcional)

| Campo | Valor |
| --- | --- |
| **Problema** | `useApiQuery` minimalista — sem cache, refetch em cada mount. Páginas pesadas (Dashboard, ClienteDetail) fazem mesmo GET várias vezes. |
| **Esforço** | **L** (8-12h pra migrar todos useApiQuery → useQuery) |
| **Plano** | Avaliar custo/benefício. Bundle: +~30KB. Cache cross-page beneficia muito Dashboard. Se aceitar custo, migrar incrementalmente página por página. |

### 🟡 P2-6 — `i18n` — decidir destino (ativar ou descartar)

| Campo | Valor |
| --- | --- |
| **Problema** | `i18next` configurado em `frontend/src/lib/i18n.ts` mas zero strings traduzidas. |
| **Esforço** | **XL** se ativar (40+ horas pra extrair todas strings); **S** se descartar (remover dep) |
| **Plano** | Decisão produto (Léo): ativar pt-BR/en-US ou descartar até precisar |

### 🟡 P2-7 — Frontend skeleton specs por página (em vez de Spinner genérico)

| Campo | Valor |
| --- | --- |
| **Problema** | `StateView` mostra Spinner em loading. Skeletons específicos por página melhoram percepção de velocidade (~30% perceived perf). |
| **Esforço** | **M** (4-6h) |
| **Plano** | Implementar `<Skeleton>` específico em Dashboard (KPI cards), ClientesPage (tabela), PedidosPage (cards de timeline). Já existe componente base `frontend/src/components/ui/Skeleton.tsx`. |

### 🟡 P2-8 — UptimeRobot + alerting de prod

| Campo | Valor |
| --- | --- |
| **Problema** | `docs/monitoring.md` documenta UptimeRobot setup mas não está configurado |
| **Esforço** | **S** (30min) |
| **Plano** | Configurar 3 monitores: `/health`, `/health/deep` (com token), e frontend root. Slack webhook pra alertas. |

### 🟡 P2-9 — Backup S3 ativo

| Campo | Valor |
| --- | --- |
| **Problema** | Workflow `.github/workflows/backup.yml` existe mas requer secrets `S3_*` pra rodar |
| **Esforço** | **S** (30min) |
| **Plano** | Setup R2 / MinIO / AWS S3 bucket; secrets em GH; primeiro run manual via `workflow_dispatch` pra validar |

### 🟡 P2-10 — Sentry DSN em prod

| Campo | Valor |
| --- | --- |
| **Problema** | `SENTRY_DSN` env var existe mas pode não estar setada em Railway |
| **Esforço** | **S** (15min) |
| **Plano** | Criar projeto Sentry; setar DSN no Railway api + worker; testar com erro proposital; validar trace |

---

## Seção 4 — Plano de Desenvolvimento Frontend

> Baseado no mapeamento + decisões arquiteturais conhecidas. Frontend hoje cobre ~95% do backend. As sugestões abaixo são polish/refactor + features novas planejadas.

### Ordem sugerida (próximas 4-6 semanas)

#### Sprint A (1 semana) — Refactor + cleanup

| # | Item | Esforço |
| --- | --- | --- |
| 1 | Refatorar `ClienteDetailPage` (extrair 7 tabs em arquivos próprios) | M |
| 2 | Migrar Modal legacy → Dialog | M |
| 3 | CHANGELOG.md atualizado + docs/modules/funis.md | S |

#### Sprint B (1 semana) — Testes

| # | Item | Esforço |
| --- | --- | --- |
| 1 | Vitest setup frontend + 10 testes core (hooks + components-chave) | M |
| 2 | Specs nos 6 módulos backend sem cobertura | L |

#### Sprint C (2 semanas) — Polish UX

| # | Item | Esforço |
| --- | --- | --- |
| 1 | Skeleton loading específico por página (Dashboard, Clientes, Pedidos) | M |
| 2 | Cmd+K global search (catálogo + clientes + pedidos) | M |
| 3 | Empty states com ilustração customizada (até hoje usa icon Lucide) | M |
| 4 | Tooltip + helper text em campos complexos (markup, desconto, teto) | S |
| 5 | Drag-drop entre etapas de funis customizados (já funciona; testar edge cases) | S |

#### Sprint D (1-2 semanas) — Features novas (decisões do Léo)

| Feature | Componentes a criar | Endpoints prontos? |
| --- | --- | --- |
| `AuditViewerPage` (ADMIN) | Tabela + filtros + drawer detail | ✅ `/audit` GET existe |
| `MetricasComparativas` em DashboardPage | Charts MoM/YoY | ⚠️ Requer endpoint backend novo |
| Reordenar etapas em funil via drag-drop (já existe, validar) | — | ✅ |
| Bulk operations em pedidos (cancelar múltiplos) | BulkActionsBar | ⚠️ Endpoint backend novo |
| Notificação push (web push API) | Service worker + subscribe UI | ⚠️ Backend não suporta |
| Compartilhar relatório por link público | Token + viewer | ⚠️ Backend novo |

### Componentes shared a criar primeiro

| Componente | Uso futuro |
| --- | --- |
| `<Skeleton.KPICard />`, `<Skeleton.Table />`, `<Skeleton.Drawer />` | Loading states específicos |
| `<BulkActionsBar />` | Pedidos, Clientes, Notificacoes |
| `<DateRangePicker />` | Relatorios, Pedidos, Comissoes |
| `<DataTable />` (Tanstack Table) | Substitui Table custom |
| `<GlobalSearch />` (Cmd+K) | Sidebar topbar |

---

## Seção 5 — Recomendações de Arquitetura

### 5.1 Refatorações que valem a pena

| # | Refatoração | Motivo | Esforço |
| --- | --- | --- | --- |
| 1 | Extrair tabs do ClienteDetailPage em arquivos próprios | Página de 1951 LOC é difícil de manter | M |
| 2 | Adotar TanStack Query (substituir useApiQuery) | Cache cross-page + invalidação granular | L |
| 3 | Adotar TanStack Table (substituir Table custom) | Sort/filter/pagination padronizados; data-virtualization free | M |
| 4 | Migrar páginas que usam `styles.ts` (CSSProperties) pra Tailwind | Consistência visual + dark mode automático | L |
| 5 | Extrair `useExport` hook unificado (CSV/XLSX/DOCX/PDF) | Reduz duplicação em ~5 páginas | S |

### 5.2 Padrões a estabelecer agora

| # | Padrão | Hoje | Recomendação |
| --- | --- | --- | --- |
| 1 | Forms | Validação inline manual por campo | Adotar `react-hook-form` + zod resolver |
| 2 | URL state | Manual via useSearchParams | Adotar `nuqs` ou similar |
| 3 | Empty states | Inconsistente (alguns têm action, outros não) | Padronizar — todo empty state acionável |
| 4 | Modal vs Drawer | Mistura legado (Modal) e DS (Dialog) | Convergir 100% em Dialog do DS |
| 5 | Error boundaries | 1 global no App.tsx | Por rota + reportar Sentry |
| 6 | Tipagem das API responses | Inline `interface` por arquivo | Gerar a partir do backend com `prisma-generator-pothos` ou similar |

### 5.3 Bibliotecas que poderiam substituir código custom

| Custom | Substituto | Benefício |
| --- | --- | --- |
| `useApiQuery` | TanStack Query | Cache, retries, mutations, devtools |
| `Table` | TanStack Table | Sort/filter/pagination/virtualizacao |
| Manual validation no form | react-hook-form + zod | DRY + tipagem |
| `Modal` legacy | Dialog (já existe) — só terminar migração | Consistência |
| Cores hardcoded em styles.ts | Apenas Tailwind tokens | Single source of truth |

### 5.4 Decisões que merecem revisão

| Decisão | Hoje | Avaliar trocar? |
| --- | --- | --- |
| Sem cache global no front | useApiQuery refetch em mount | TanStack Query (+30KB mas big UX win) |
| Inline CSS-in-TS via styles.ts | Pages antigas usam | Convergir Tailwind |
| WhatsApp via Baileys | Custo zero mas risco ban | Quando volume justificar, migrar para Cloud API oficial |
| 1 socket por container WhatsApp | Não escala horizontal | Sticky session + worker pools quando precisar |
| MullerBot keyword scoring em memória | Funciona ≤500 produtos | pgvector quando passar de 500 (interface ProdutoSearchService preparada) |
| `ConfiguracoesPage` ADMIN-only | Hoje | Deveria ser DIRECTOR-only? (D45/D46 dizem que sim) |

---

## Seção 6 — Perguntas para o Léo

### 6.1 Decisões de produto (não-tecnológicas)

1. **TD-C consolidação Postgres:** Confirma que migra tudo pra Supabase Postgres e desativa Railway plugin? (Reduz custo, simplifica ops, mas tem leve latência cross-region)

2. **Multi-region Railway:** Vale plugar segundo Railway service em São Paulo (SP) pra latência LatAm? (Custo: 2× pricing)

3. **Frontend i18n:** Ativar pt-BR/en-US gradualmente ou descartar i18next por enquanto?

4. **WhatsApp oficial:** Quando migrar de Baileys (zero custo, risco ban) pra Meta Cloud API ($, sem risco)? Volume estimado pra mês 1, 3, 6?

5. **`SUPABASE_JWT_SECRET`:** Está atualmente vazio (auto-detect funciona). Vale setar pra reduzir 1 round-trip ao Supabase JWKS endpoint?

### 6.2 Funcionalidades opcionais (decidir scope)

6. **AuditViewerPage:** Vale criar UI dedicada ou ADMIN consulta DB direto?

7. **Comparativos MoM/YoY no Dashboard:** Vale incluir? (Requer endpoint novo de agregação)

8. **Push notifications (web push):** Vale gastar 1 sprint pra implementar?

9. **Compartilhar relatório por link público:** Vale? (Risco vazamento; precisa token + expiração)

10. **Bulk actions em pedidos** (cancelar 50 de uma vez): É comum no negócio ou edge case?

### 6.3 Configurações de produção (input do Léo necessário)

11. `RAILWAY_TOKEN` em GitHub Secrets → posso pedir e configurar?
12. Conta Sentry criada? Qual DSN usar?
13. S3 / R2 / MinIO bucket pra backups → qual provider?
14. UptimeRobot / Pingdom / etc → qual ferramenta? (Sugiro UptimeRobot, gratuito)
15. Slack workspace pra alertas? Webhook setup?
16. Email transacional (SendGrid): qual domain/sender validar? `noreply@betinna.ai` está OK?
17. Domínio custom: `app.betinna.ai`? Setup DNS via Cloudflare?

### 6.4 Ambiguidades no escopo

18. **Funis customizados — escopo final:** Cada empresa cria N funis livres ou tem cap (3? 5? 10?)?
19. **Estoque OMIE:** Quando ativar o webhook real (`POST /webhooks/omie/produto`) no painel OMIE em prod?
20. **MullerBot:** REP obrigado a ter chave OpenAI própria (D39). Quem paga setup? Tutorial pra rep configurar?
21. **Marketplace SAC:** Cada empresa-cliente conecta seus marketplaces ou Betinna conecta no nome dela?
22. **Dados de demo no boot:** Manter `/auth/seed-demo`? Por design o token expira após 1º uso?

---

## Resumo executivo

🟡 **Atenção (~85% pronto pra go-live com clientes reais).**

**Top 3 P0 a fechar imediatamente:**
1. Baseline migration `0_init` + reconciliar `_prisma_migrations` em prod (~2h)
2. Executar TD-C consolidação Postgres Railway→Supabase (~6h)
3. Configurar GitHub Secrets (`RAILWAY_TOKEN`) + Sentry DSN + S3 backup (30min cada)

**Top 3 P1 next:**
1. Atualizar CHANGELOG + docs/modules/funis.md (1h)
2. Testes nos 6 módulos backend sem cobertura (~10h)
3. Refactor ClienteDetailPage 1951 LOC → tabs em arquivos próprios (~4h)

**Top 3 perguntas pro Léo:**
1. TD-C consolidação Postgres aprovado?
2. Multi-region Railway / Sentry / UptimeRobot / S3 → qual stack?
3. Funcionalidades opcionais (AuditViewer, push notif, bulk actions) — quais ativar?

**Onde estão os relatórios completos:**
- `backend/_audit/PROJECT_MAP_2026-05-16.md` — mapa completo (10 seções + TL;DR)
- `backend/_audit/ACTION_PLAN_2026-05-16.md` — este arquivo (6 seções)
