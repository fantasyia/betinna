# SESSÃO MASTER 2 — Prompt original (north star)

> Salvo aqui pra não perder o escopo total durante a execução.
> Recomposto a partir do contexto da sessão (2026-05-18).
> Status atualizado em tempo real conforme as partes são entregues.

---

## Identidade visual oficial Betinna.ai (a aplicar em TODA tela tocada)

- Magenta vibrante `#bd1fbf` (CTAs / acento)
- Ciano elétrico `#2bcae5` (texto destaque/AI)
- Azul profundo `#31137C`
- Navy oficial `#201554` (primária)
- Roxo profundo `#221551` (sidebar/bg dark — referência antiga; usar `#201554`)
- Roxo escuro `#250E62` (cards dark — referência antiga; usar `#201554`)
- Preto profundo `#101820` (fundo dark)
- Off-white `#F8F7F2` (fundo light)
- Fonts: Fira Sans Black (títulos), Cabin (corrido), Fira Mono (tabular)
- Border radius padrão: **10px** (não 8 ou 12)
- Estilo: moderno tipo Linear / Vercel / Stripe

**Don'ts** (já cometidos — não repetir):
- ❌ `#7c3aed` (Tailwind violet)
- ❌ `#BB29BB` / `#4AC9E3` (aproximações erradas)
- ❌ `#31137C` na primary (é o `--border-focus`)
- ❌ Inter / Roboto / system-ui como font principal
- ❌ Border radius 8px

---

## Regras globais estritas

- **DO NOT upgrade Prisma** (mantém 6.19.3)
- **DO NOT alterar páginas já 🟢 verdes** a menos que tenha bug visível
- **Cada fix/feature = 1 commit individual**
- **Push pra origin/main após cada commit** (Railway redeploya sozinho)
- `tsc --noEmit` limpo nos 2 projetos ao final
- Testes: **1362+ verde** (1351 anteriores + 11 corrigidos)
- Toda página tocada precisa:
  - loading state
  - error state
  - empty state
  - ErrorBoundary
  - role guards
  - validação client-side
  - toast notifications
  - confirmação em ações destrutivas (`useConfirm` hook, NÃO `window.confirm`)
  - mobile responsive (375px)

---

## Parte 1 — Validação e correção de bugs reportados

### 1.1 — LoginPage redesign brandbook Betinna ✅
- Refeito do zero com navy/cyan/magenta oficiais.
- Commit: `b129751`.

### 1.2 — Sentry helper window funcional ✅
- Helpers `__BETINNA_SENTRY__`, `__BETINNA_TEST_SENTRY__()`,
  `__BETINNA_SENTRY_SDK__` já existiam em `378bcf3`.
- Validado em produção (eventId capturado).

### 1.3 — Validar 5 páginas polidas anteriormente ❌ (skipado)
- Inbox, Campanhas, Relatorios, Metas, NPS.
- Conferir se as features prometidas REALMENTE existem.

### 1.4 — Corrigir 13 testes backend failing ✅
- 11 em `mullerbot.service.spec.ts` (faltava `MullerBotPersonaService` 6º arg).
- 2 em `leads.service.spec.ts` (faltavam mocks `funil`/`funilEtapa` + teste
  obsoleto NOVO → GANHO trocado por PERDIDO → GANHO).
- 1362/1362 verde.
- Commit: `685ee9c`.

---

## Parte 2 — Polish das 6 páginas pendentes ❌ (a fazer)

### AgendaPage
- Drag & drop de eventos no calendário.
- Recorrência (DAILY/WEEKLY/MONTHLY).
- Lib sugerida: `react-big-calendar`.

### MullerBotPage
- Histórico de conversas persistente (Redis cache já existe — `MullerBotCacheService`).
- Configuração de prompts (já tem `MullerBotPersonaService` no backend).
- Renderização markdown da resposta.

### ConfiguracoesPage
- Tabs: Empresa / Integrações / Notificações / Permissões.
- Upload de logo (multipart, signed URL Supabase Storage).
- Edição de dados fiscais (DIRECTOR-only).

### FormularioBuilder
- Multi-step (wizard).
- Campos condicionais (mostrar campo X se campo Y == valor).
- Schema change: `FormularioCampo.condicionalDe` + `condicionalValor`.
- Lib sugerida: `@dnd-kit/sortable` (já no projeto).

### AdminPage
- Audit log (UI pro `AuditController` já existente).
- 4 tabs: Usuários / Empresas / Audit / Sistema.
- Ações admin (impersonate, force logout, etc).

---

## Parte 3 — FluxoEditor com React Flow ❌ (a fazer, XL ~8h)

- Canvas com React Flow.
- Sidebar de nodes (TRIGGER / ACAO / CONDICAO / DELAY).
- Properties panel (config por node selecionado).
- Toolbar (zoom, fit-view, lock).
- Validação de grafo (trigger único, arestas válidas).
- Templates (3-5 templates pré-prontos).
- Undo / redo (Cmd+Z).
- Lib: `reactflow` (instalar).
- Schema/backend já existe (`Fluxo`, `FluxoNo`, `FluxoEdge`).

---

## Parte 4 — Seed de dados demo ✅ (concluída na v1.2.0)

### Schema
- `isDemo Boolean @default(false)` em:
  - Cliente
  - Produto
  - Pedido
  - Proposta
  - Conversation
  - Amostra
  - RespostaNPS
  - Comissao

### Script `backend/scripts/seed-demo.ts`
- Idempotente (rerun limpa + reseed).
- Dataset alvo:
  - 50 clientes (cidades/estados variados, tags)
  - 200 produtos (SKUs reais, preços, descrições)
  - 300 pedidos (3 meses, status variados, com itens)
  - 50 propostas (status variados)
  - 30 conversas (Inbox com mensagens)
  - 100 respostas NPS (1 pesquisa, scores 0-10)
  - 20 amostras (envio + follow-up)
  - 3 meses de comissões fechadas

### Endpoints
- `POST /admin/seed-demo` — body `{ empresaId, multiplier? }` (ADMIN).
- `DELETE /admin/seed-demo` — body `{ empresaId }`, deleta `isDemo=true` (ADMIN).
- `GET /admin/seed-demo/status?empresaId=` — contagens por modelo (ADMIN).

### Frontend
- Nova aba "Demo" em `AdminPage` com:
  - Contagens atuais.
  - Botão "Popular dados demo" (confirmação).
  - Botão "Limpar dados demo" (confirmação destrutiva).
  - Toast de feedback.

### Testes
- 1 spec do `SeedDemoService` (cria 5 clientes, verifica `isDemo=true`).
- 1 spec do cleanup (delete em cascata).

---

## Parte 5 — 5 E2E tests novos ❌ (a fazer)

Cenários sugeridos:
1. Login flow completo (form → dashboard).
2. Criar pedido full pipeline (cliente → produto → preview → confirma).
3. Inbox: receber webhook ML → aparecer conversa → responder.
4. Comissão: fechar mês → ver no resumo do REP.
5. Seed demo: popular → ver no dashboard → limpar.

---

## Parte 6 — Release v1.1.x ✅

- CHANGELOG entry [1.1.1] dated 2026-05-18.
- `backend/package.json`: 1.0.0 → 1.1.1.
- `frontend/package.json`: 1.0.0 → 1.1.1.
- Git tag `v1.1.1` pushada.
- Relatório `_audit/SESSAO_MASTER_2_2026-05-18.md`.
- Commit: `f29bb04`.

---

_Última atualização: 2026-05-19 (Parte 4 fechada na v1.2.0)._
