# PROJECT_MAP — Betinna.ai (revisão 2026-05-17)

**Data:** 2026-05-18 (rótulo `2026-05-17` para histórico — versão anterior em `PROJECT_MAP_2026-05-16.md` preservada)
**Escopo:** Estado **atual e medido** do projeto (post fim-de-semana com kanban funil + brandbook + 8 sweeps de UX + relatórios de auditoria)
**Foco desta revisão:** Frontend (páginas, componentes, hooks, types, libs, configs, dependências). Backend só lista deltas.

---

## Índice

1. [Quantidades globais](#1-quantidades-globais)
2. [Frontend — Páginas](#2-frontend--páginas-43-arquivos)
3. [Frontend — Componentes](#3-frontend--componentes)
4. [Frontend — Hooks](#4-frontend--hooks)
5. [Frontend — Lib](#5-frontend--lib)
6. [Frontend — Types](#6-frontend--types)
7. [Frontend — Assets](#7-frontend--assets)
8. [Frontend — Dependências](#8-frontend--dependências-pacote-json)
9. [Frontend — Configurações](#9-frontend--configurações)
10. [Backend — Deltas desde 2026-05-16](#10-backend--deltas-desde-2026-05-16)
11. [Gaps observados na revisão](#11-gaps-observados-na-revisão)

---

## 1. Quantidades globais

| Item | 2026-05-16 | **Hoje (2026-05-17)** | Δ |
| --- | --- | --- | --- |
| Páginas frontend (`pages/`) | 43 | **43** | 0 |
| Componentes shared (`components/`) | 18 (com styles.ts) | **17** | 0 (LanguageSelect existe mas não rege; OnboardingTour ativo) |
| UI design system (`components/ui/`) | 22 | **22** (incl. `index.ts`) | 0 |
| Hooks customizados (`hooks/`) | 7 (declarado) | **4 arquivos** + `useIsMobile` exportado de PageLayout + `useToast` de toast.tsx | – |
| Libs (`lib/`) | 13 | **13** | 0 |
| Types (`types/`) | 1 (`auth.ts`) | **1** | 0 |
| Public assets | 3 SVGs | **3 SVGs + `_redirects`** | +1 |
| Páginas totais LOC | – | **29.663** | – |
| Componentes shared LOC | – | **3.834** | – |
| UI LOC | – | **1.747** | – |
| Módulos backend | 33 | **33** | 0 |
| Integrações backend | 9 | **9** | 0 |
| Migrations Prisma | 14 | **14** | 0 |
| Commits desde 2026-05-16 | – | **20** | (incluindo `8d5dce8` relatórios e fix kanban + funis + brandbook + UX sweep) |

> A versão anterior contava "47 modelos Prisma + 24 enums" — não houve nova migration nesta janela, então valor mantido.

---

## 2. Frontend — Páginas (43 arquivos)

> Status: ✅ funcional/completo · ⚠️ funcional mas LOC alta (refactor recomendado) · 📝 scaffold/parcial · 🌐 público

### 2.1 Páginas públicas (4)

| Página | LOC | Rota | Status | O que renderiza | Endpoints API |
| --- | --- | --- | --- | --- | --- |
| `LoginPage.tsx` | 156 | `/login` | ✅ 🌐 | Form login email/senha + bootstrap token first-run | `POST /auth/login`, `POST /auth/bootstrap` |
| `ForbiddenPage.tsx` | 40 | `/403` | ✅ 🌐 | Fallback "Sem permissão" + link voltar | — |
| `FormularioPublicoPage.tsx` | 337 | `/f/:slug` | ✅ 🌐 | Renderiza form público dinâmico + submit anônimo | `GET /formularios/publico/:slug`, `POST /formularios/publico/:slug/responder` |
| `NpsPublicoPage.tsx` | 208 | `/n/:slug` | ✅ 🌐 | Pesquisa NPS pública + agradecimento | `GET /nps/publico/:slug`, `POST /nps/publico/:slug/responder` |

### 2.2 Páginas protegidas (39)

> Todas atrás de `<ProtectedRoute>`. Restrições por role/permission listadas.

| Página | LOC | Rota | Restrições | Status | O que renderiza | Endpoints API principais |
| --- | --- | --- | --- | --- | --- | --- |
| `DashboardPage.tsx` | 474 | `/dashboard` | qq auth | ✅ | KPIs (faturamento, ticket médio), top reps, funil, atalhos | `GET /relatorios/dashboard` |
| `NotificacoesPage.tsx` | 310 | `/notificacoes` | qq | ✅ | Lista + filtro por tipo/prioridade/lidas | `GET /notificacoes`, `PATCH /:id/ler`, `DELETE /:id` |
| `WhatsAppPage.tsx` | 464 | `/whatsapp` | perm `whatsapp.pessoal` | ✅ | QR code (Baileys) + chat pessoal | `GET/POST /usuario/integracoes/whatsapp` |
| `AdminPage.tsx` | 357 | `/admin` | perm `admin.panel` | ✅ | Dead-letter queue + system status | `GET /admin/dead-letter`, `POST /:id/retry`, `GET /health/deep` |
| `ClientesPage.tsx` | 1509 | `/clientes` | perm `clientes.view` | ⚠️ | Lista + drawer detail + 4 exports + 7 listas + bulk + form criar/editar | `GET/POST /clientes`, `/listas`, `/atribuir-rep-massa`, etc |
| `ClienteDetailPage.tsx` | **1951** | `/clientes/:id` | perm `clientes.view` | ⚠️ | 7 tabs: dados, pedidos, propostas, amostras, ocorrências, notas, documentos, preços + MetricasCard | `GET /clientes/:id/*` (8 sub-recursos) |
| `CatalogoPage.tsx` | 1118 | `/catalogo` | — | ✅ | Grid de cards de produtos + markup % por rep + StockBadge (estoque OMIE 30min) + share | `GET/PUT /catalogo`, `POST /share` |
| `MullerBotPage.tsx` | 401 | `/mullerbot` | — | ✅ | Chat RAG com histórico + produtos relevantes | `POST /mullerbot/perguntar` |
| `PersonaBotPage.tsx` | 557 | `/mullerbot/persona` | ADMIN/DIR | ✅ | Configura persona singleton do bot | `GET/PUT /mullerbot/persona` |
| `MarketplaceIncidentsPage.tsx` | 454 | `/incidentes` | ADMIN/DIR/GER/SAC | ✅ | Lista unificada (ML/Shopee/Amazon/TikTok) com filtros + SLA | `GET /marketplace/incidentes` |
| `ConfiguracoesPage.tsx` | 423 | `/configuracoes` | ADMIN | ✅ | Empresa CRUD + tema | `GET/PATCH /empresas/:id` |
| `ProfilePage.tsx` | 772 | `/perfil` + `/usuarios` + `/usuarios/:id` | qq (perfil); ADMIN/DIR/GER (lista) | ⚠️ | Perfil próprio + admin users (rota dupla) | `GET/PATCH /users/:id`, `POST /users` |
| `TagsPage.tsx` | 321 | `/tags` | perm `clientes.view` | ✅ | CRUD com cores | `GET/POST/PATCH/DELETE /tags` |
| `FluxosPage.tsx` | 529 | `/fluxos` | ADMIN/DIR/GER | ✅ | Lista fluxos + ações (ativar/pausar) + drawer | `GET/POST/PUT /fluxos`, actions |
| `FluxoTemplatesPage.tsx` | 626 | `/fluxos/templates` | ADMIN/DIR/GER | ✅ | Galeria de templates instaláveis | `GET /fluxos/templates`, `POST /:id/instalar` |
| `FluxoEditor.tsx` | 890 | `/fluxos/editor/:id` | ADMIN/DIR/GER | ⚠️ | Editor visual `@xyflow/react` (React Flow) | `GET/PUT /fluxos/:id`, `POST /testar` |
| `CampanhasPage.tsx` | 1126 | `/campanhas` | perm `campanhas.view` | ⚠️ | CRUD + IA (gerar/otimizar/sugerir) + analytics | `GET/POST/PATCH /campanhas`, `/ia/*`, `/disparar/pausar/cancelar` |
| `PermissoesPage.tsx` | 424 | `/permissoes` | ADMIN | ✅ | Matriz RBAC visualização + edição | `GET /permissions`, `PATCH /:role/:module` |
| `RelatoriosPage.tsx` | 955 | `/relatorios` | perm `relatorios.view` | ⚠️ | Builder de relatórios (5+ categorias) | `GET /relatorios/*` |
| `PedidosPage.tsx` | 1141 | `/pedidos` | — | ⚠️ | Lista com timeline visual de status + filtros (período/status/cliente) + drawer detail + 4 exports + novo pedido | `GET/POST /pedidos`, actions |
| `PedidoDetailPage.tsx` | 801 | `/pedidos/:id` | — | ⚠️ | Layout 2-col com banner "Duplicado de #X" + duplicar + editar (modo NovoPedidoDialog) + print | `GET /pedidos/:id`, `POST /duplicar`, PATCH |
| `FunisPage.tsx` | **844** ✨ | `/funis` | ADMIN/DIR/GER | ✅ | CRUD funis customizados (modelo SimplesDesk) + editor drag-drop de etapas + color picker + dialogs CRUD | `GET/POST/PATCH/DELETE /funis`, `/etapas`, `/etapas/reordenar` |
| `LeadsPage.tsx` | **1117** ✨ | `/leads` | — | ✅ | Kanban dinâmico (etapas vêm do funil escolhido) + seletor de funil + link "Configurar funis" | `GET /leads/kanban?funilId=`, `PUT /:id/etapa`, `GET /funis` |
| `FormulariosPage.tsx` | 248 | `/formularios` | ADMIN/DIR/GER (badge `new`) | ✅ | Lista forms + criar + publicar | `GET/POST /formularios` |
| `FormularioBuilder.tsx` | 857 | `/formularios/builder/:id` | ADMIN/DIR/GER | ⚠️ | Builder visual com campos draggable | `GET/PUT /formularios/:id` |
| `NpsPage.tsx` | 655 | `/nps` | ADMIN/DIR/GER | ✅ | CRUD pesquisas + agregados | `GET/POST /nps`, `GET /nps/:id/respostas` |
| `MetasPage.tsx` | 556 | `/metas` | — | ✅ | Metas REP/GERENTE/EMPRESA + progresso | `GET/POST/PATCH /metas` |
| `SegmentosPage.tsx` | 725 | `/segmentos` | ADMIN/DIR/GER | ✅ | Regras builder + preview clientes do segmento | `GET/POST /segmentos` |
| `PropostasPage.tsx` | 1202 | `/propostas` | — | ⚠️ | Lista + drawer + máquina de estados + filtro `?clienteId=` + `?highlight=ID` + form com validação inline | `GET/POST/PATCH /propostas`, transições |
| `AmostrasPage.tsx` | 662 | `/amostras` | — | ✅ | Lista + form + follow-up auto + filtros + `?clienteId=` + `?highlight=ID` | `GET/POST/PUT /amostras`, `/:id/status` |
| `OcorrenciasPage.tsx` | 814 | `/ocorrencias` | — | ⚠️ | Lista + drawer + SLA visual + timeline comentários + filtros + `?clienteId=` + `?highlight=ID` | `GET/POST/PATCH /ocorrencias`, `/comentarios` |
| `ProdutosPage.tsx` | 605 | `/produtos` | — | ✅ | CRUD + estoque manual + ativo/inativo + form com autoFocus + validação inline | `GET/POST/PATCH/PUT/DELETE /produtos` |
| `AgendaPage.tsx` | 546 | `/agenda` | — | ✅ | Calendar view + form com autoFocus + Google sync best-effort | `GET/POST/PATCH /agenda` |
| `AprovacoesPage.tsx` | 555 | `/aprovacoes` | — | ✅ | Lista pendentes (GERENTE) + aprovar/rejeitar com motivo + Reason dialog | `GET /aprovacoes`, `POST /:id/aprovar`, `/rejeitar` |
| `InboxPage.tsx` | 857 | `/inbox` | — | ⚠️ | 3-painel (canais → conversas → mensagens) + bulk + atribuir + responder + mídia | `GET /inbox`, `GET /inbox/:id`, `POST /responder`, etc |
| `IntegracoesPage.tsx` | 835 | `/integracoes` | ADMIN/DIR/GER | ⚠️ | CRUD conexões empresa (OMIE/WhatsApp/Marketplaces/Social) + OAuth flows + feedback validação | `GET/POST /integracoes`, `/oauth/*` |
| `MinhasIntegracoesPage.tsx` | 638 | `/minhas-integracoes` | qq | ⚠️ | Conexões pessoais (Google/SendGrid/OpenAI/Anthropic/WhatsApp pessoal) | `GET/POST /usuario/integracoes/*` |
| `ComissoesPage.tsx` | 502 | `/comissoes` | — | ✅ | Resumo pessoal + lista (REP/GERENTE veem suas) + fechar mês manual + pagar | `GET /comissoes`, `POST /fechar-mes`, `/pagar` |
| `FidelidadePage.tsx` | 1101 | `/fidelidade` | perm `fidelidade.view` | ⚠️ | Programa + recompensas + resgates + ajustes manuais com confirmação | `GET/POST /fidelidade/*`, useConfirm aplicado |

✨ = páginas significativamente modificadas neste fim-de-semana

### 2.3 Padrões aplicados em todas (este fim-de-semana)

- ✅ Validação inline com `setError` específico por campo (substituiu `disabled={!valid}` silencioso) — 8 forms varridos
- ✅ `useConfirm` substitui `window.confirm` em 8 sites (notas, docs, preços, tags, fidelidade, admin retry, campanha cancelar, notificações)
- ✅ `?highlight=:id` em PedidosPage/PropostasPage/AmostrasPage/OcorrenciasPage (abre drawer automaticamente)
- ✅ `?clienteId=:id` em mesmas 4 + banner "Filtrando por cliente"
- ✅ `autoFocus` no primeiro input dos forms (Leads, Cliente, Produto, Agenda, Funil)
- ✅ Dark mode toggle no header (PageLayout)
- ✅ Brandbook oficial: navy `#201554` + cyan `#2bcae5` + magenta `#bd1fbf` + Cabin/Fira Sans
- ✅ Logo SVG oficial em todas instâncias (favicons + sidebar + onboarding)

---

## 3. Frontend — Componentes

### 3.1 Componentes shared (`frontend/src/components/` — 17 arquivos, 3.834 LOC)

| Componente | LOC | Propósito | Usado em (exemplos) |
| --- | --- | --- | --- |
| `PageLayout.tsx` | 480 | Layout master (sidebar + topbar + theme toggle + notification bell + 6 seções de menu) | Todas páginas protegidas |
| `OnboardingTour.tsx` | 473 | Tour guiado 1º visita (multi-passos visuais) | `App.tsx` |
| `NovoPedidoDialog.tsx` | 596 | Modal reusável criar/duplicar/editar pedido (com prop `editandoPedidoId` + `inicial`) | PedidosPage, ClientesPage, ClienteDetailPage, PedidoDetailPage |
| `NotificationBell.tsx` | 339 | Sino + dropdown polling 30s | PageLayout topbar |
| `charts.tsx` | 362 | Wrappers Recharts (LineChart/BarChart/PieChart com tokens design system) | Dashboard, Relatorios |
| `styles.ts` | 313 | Tokens design legacy (`colors`, `card`, `btn`, `badge`, etc — CSSProperties) | Páginas que ainda usam inline styles |
| `AsyncCombobox.tsx` | 231 | Picker assíncrono com debounce 200ms (cliente/produto/usuário) | Forms com seleção remota |
| `toast.tsx` | 230 | `ToastProvider` + `useToast` + 4 variantes (info/success/warning/danger) | Todas páginas |
| `Markdown.tsx` | 173 | Render markdown (`react-markdown` + `remark-gfm`) | MullerBot, descrições |
| `Modal.tsx` | 142 | Modal **legacy** (em migração pra `Dialog` do DS) | Páginas antigas (Fidelidade, Tags, Amostras, Ocorrências, ...) |
| `Table.tsx` | 108 | Tabela compacta (col config) | AdminPage, OcorrenciasPage |
| `ProtectedRoute.tsx` | 88 | Route guard (auth + roles + permission) | `App.tsx` |
| `ErrorBoundary.tsx` | 87 | Catch erros render + report Sentry | `App.tsx` |
| `StateView.tsx` | 87 | Wrapper 3-estados loading/error/empty/children | Todas páginas com fetch |
| `FormField.tsx` | 48 | Wrapper label + input **legacy** (substituído por `Field` do DS) | Páginas antigas |
| `FilterBar.tsx` | 43 | Barra de filtros pills | Páginas antigas |
| `LanguageSelect.tsx` | 34 | Seletor pt-BR / en-US | Não registrado em UI (i18next configurado mas inativo) |

### 3.2 Design system UI (`frontend/src/components/ui/` — 21 components + `index.ts`, 1.747 LOC)

| Componente | LOC | Notas |
| --- | --- | --- |
| `Avatar.tsx` | 117 | Iniciais ou imagem; tamanhos xs/sm/md/lg/xl |
| `Badge.tsx` | 125 | Variants: primary/success/warning/danger/info/neutral/outline + sizes |
| `Button.tsx` | 119 | forwardRef + loading + leftIcon/rightIcon + 4 variants × 3 sizes |
| `Card.tsx` | 125 | + `CardHeader`/`CardTitle`/`CardDescription` |
| `Checkbox.tsx` | 63 | Acessível com label clicável |
| `Dialog.tsx` | 117 | Modal centralizado com backdrop blur + portal + esc-close + focus trap |
| `Drawer.tsx` | 100 | Slide lateral (sm/md/lg/xl/full) com footer fixo |
| `EmptyState.tsx` | 74 | Icon + title + description + action |
| `Field.tsx` | 64 | Label + child + hint/error; `cloneElement` injeta `id` + `aria-invalid` |
| `IconButton.tsx` | 58 | Botão só ícone com aria-label obrigatório |
| `Input.tsx` | 99 | leftIcon + tamanhos; estados focus/disabled/invalid |
| `Label.tsx` | 25 | Com asterisk `required` |
| `Select.tsx` | 75 | Native `<select>` estilizado |
| `Skeleton.tsx` | 70 | Base + helpers (line/circle/rect) |
| `Sparkline.tsx` | 86 | Mini-gráfico inline (KPIs do Dashboard) |
| `Spinner.tsx` | 35 | Loading spinner com tamanhos |
| `Stat.tsx` | 115 | KPI card (value + label + hint + icon tinted) |
| `Switch.tsx` | 60 | Toggle on/off acessível |
| `Tabs.tsx` | 109 | TabList + Tab + TabPanel com URL state opcional |
| `Textarea.tsx` | 43 | Auto-grow desativado, rows custom |
| `Tooltip.tsx` | 68 | Hover/focus baseado em data-attr |
| `index.ts` | – | Re-export central |

> **22 componentes UI** prontos cobrindo Material-like surface (cards, buttons, inputs, modals) sem dependência externa de Radix/Headless UI.

---

## 4. Frontend — Hooks (`frontend/src/hooks/`)

| Hook | LOC | Tipo | Propósito |
| --- | --- | --- | --- |
| `useApiQuery.ts` | 71 | `.ts` | GET minimalista (data/loading/error/refetch) — sem cache cross-page (D-rel: aceita custo de refetch) |
| `usePermission.ts` | 164 | `.ts` | Reactive `usePermission(action)` + `useRole()` + matriz hardcoded `PERMISSION_MATRIX` (mirror do backend) |
| `useTheme.ts` | 53 | `.ts` | Dark/light toggle + `bootstrapTheme()` chamada em `main.tsx` (evita flash) |
| `useConfirm.tsx` | 103 | `.tsx` | Hook promise-style que substitui `window.confirm` — retorna `[confirm, Dialog]` |

**Hooks adicionais exportados de outros arquivos:**
- `useIsMobile` → exportado de `PageLayout.tsx` (matchMedia `(max-width: 768px)`)
- `useToast` → exportado de `components/toast.tsx`
- `useSyncExternalStore` (React built-in) usado em `NotificationBell.tsx` + auth-store

**Total efetivo: 4 arquivos `hooks/` + 2 exportados de components.**

---

## 5. Frontend — Lib (`frontend/src/lib/` — 13 arquivos, 1.563 LOC)

| Arquivo | LOC | Propósito |
| --- | --- | --- |
| `api.ts` | 169 | Cliente HTTP único: timeout 10s, refresh-on-401 com retry único, redirect /403, deserialize envelope `{success, data, meta}` |
| `auth-store.ts` | 199 | Pub/sub auth: bootstrap via cookie httpOnly, agenda refresh transparente 60s antes do exp, `getSession` + `subscribe` + `signOut` |
| `cn.ts` | 14 | `clsx + tailwind-merge` (utility do design system) |
| `csv.ts` | 127 | Export CSV paginado (RFC 4180) |
| `docx.ts` | 197 | Export DOCX paginado via `docx` lib |
| `i18n.ts` | 56 | i18next config (pt-BR default, en-US fallback) — **configurado mas zero strings traduzidas no app** |
| `import.ts` | 83 | Helpers `ImportTipo`/`ImportRequest` (CSV import — usa `import.ts` no backend) |
| `masks.ts` | 124 | CNPJ/CPF/CEP/telefone/UF formatters + parsers |
| `notificacoes.ts` | 91 | Cliente tipado `/notificacoes` + enum `NotificacaoTipo` (13 valores incluindo `ESTOQUE_ZERADO`) |
| `pdf.ts` | 162 | Export PDF via `jspdf` + `jspdf-autotable` |
| `pwa.ts` | 50 | Registro service worker + update prompt |
| `sentry.ts` | 167 | Sentry init + redact patterns + breadcrumbs + tracesSampleRate 0.1 em prod |
| `xlsx.ts` | 124 | Export XLSX paginado via `exceljs` |

---

## 6. Frontend — Types (`frontend/src/types/` — 1 arquivo, 27 LOC)

| Arquivo | Propósito | Bate com backend? |
| --- | --- | --- |
| `auth.ts` | `UserRole` (5 valores), `AuthenticatedUser`, `AuthSession` | ✅ Espelho de `backend/src/shared/types/authenticated-user.ts` |

> Demais tipos vivem **inline em cada página** (interface por arquivo). Não há diretório de tipos compartilhados além de `auth.ts`. Isso é um gap menor — eventualmente vale gerar do backend (zod/prisma → frontend) ou centralizar em `types/api/*.ts`.

---

## 7. Frontend — Assets (`frontend/public/`)

| Arquivo | Tipo | Uso |
| --- | --- | --- |
| `betinna-logo.svg` | SVG | Brandbook (variação alternativa) |
| `betinna-symbol.svg` | SVG | Símbolo isolado (favicons, headers compactos, splash PWA) |
| `betinna-horizontal.svg` | SVG | Logo horizontal (login screen, header marca) |
| `_redirects` | Texto | SPA fallback (Vercel/Netlify-style) |

**Não existe `frontend/src/assets/`** — fonts vêm via Google Fonts CDN no `index.html`, ícones via `lucide-react`.

> Pendência conhecida: `manifest.webmanifest` (gerado pelo VitePWA) aponta pra `favicon.ico` mas o arquivo não existe em `public/`. Ícones PWA dedicados (192/512/maskable) ainda usam favicon.ico fallback.

---

## 8. Frontend — Dependências (`package.json`)

### 8.1 Runtime (`dependencies` — 22 pacotes)

| Categoria | Pacotes | Versão |
| --- | --- | --- |
| **Framework core** | `react`, `react-dom`, `react-router-dom` | 18.3 / 18.3 / 6.27 |
| **Drag-drop** | `@dnd-kit/core`, `@dnd-kit/sortable` | 6.3 / 8.0 |
| **Editor visual** | `@xyflow/react` (React Flow) | 12.10 |
| **Observability** | `@sentry/react` | 10.53 |
| **Styling** | `class-variance-authority`, `clsx`, `tailwind-merge` | 0.7 / 2.1 / 3.6 |
| **Ícones** | `lucide-react` | 1.16 |
| **Exports** | `docx`, `exceljs`, `jspdf`, `jspdf-autotable` | 9.6 / 4.4 / 4.2 / 5.0 |
| **i18n** | `i18next`, `i18next-browser-languagedetector`, `react-i18next` | 26.2 / 8.2 / 17.0 |
| **Markdown** | `react-markdown`, `remark-gfm` | 10.1 / 4.0 |

### 8.2 Build/dev (`devDependencies` — 17 pacotes)

| Categoria | Pacotes |
| --- | --- |
| **Build** | `vite` 6.0, `@vitejs/plugin-react` 4.3, `vite-plugin-pwa` 1.3 |
| **TypeScript** | `typescript` 5.7, `@types/node` 25, `@types/react`, `@types/react-dom` |
| **CSS** | `tailwindcss` 3.4, `autoprefixer` 10.5, `postcss` 8.5 |
| **Lint** | `eslint` 9.18, `@eslint/js`, `@typescript-eslint/*`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals` |
| **E2E** | `@playwright/test` 1.49 |
| **Serve** | `serve` 14.2 (usado pelo railway.toml em prod SPA) |

**Total:** 22 runtime + 17 dev = **39 pacotes**. Bundle alvo < 200KB gzipped; estado atual ~67KB gzipped após code splitting + remoção do SDK Supabase (commit D47).

### 8.3 Bibliotecas **ausentes** que valem considerar

| Lib | Para que | Custo bundle | Recomendação |
| --- | --- | --- | --- |
| `@tanstack/react-query` | Cache cross-page + invalidação granular + retries | ~30KB | ⚠️ Avaliar (substitui `useApiQuery`) |
| `@tanstack/react-table` | Sort/filter/pagination padronizados + virtualization | ~25KB | ⚠️ Avaliar (substitui `Table.tsx`) |
| `react-hook-form` + `@hookform/resolvers` (zod) | Forms tipados + validação dry | ~10KB | ✅ Recomendado (dry validation em ~12 forms) |
| `date-fns` ou `dayjs` | Manipulação de datas (hoje usa `Intl` + `Date` nativo) | ~10KB (date-fns/esm) | Opcional |
| `nuqs` | URL state tipado (substitui `useSearchParams` manual) | ~5KB | Opcional |
| `recharts` | Charts (hoje usa wrappers em `components/charts.tsx`) | Já implementado | — |

---

## 9. Frontend — Configurações

### 9.1 `vite.config.ts`

- **Plugins:** `@vitejs/plugin-react`, `vite-plugin-pwa` (modo `prompt`)
- **PWA manifest:**
  - `name: "Betinna.ai — Plataforma comercial B2B"`
  - `short_name: "Betinna.ai"`
  - `theme_color: "#3b82f6"` ⚠️ (não casa com brandbook navy `#201554` — deveria atualizar)
  - `start_url: "/dashboard"`, `display: "standalone"`
- **Workbox precache:** `**/*.{js,css,html,ico,png,svg,webp,woff2}`
- **APIs não cacheadas:** `/api/v1/*` (NetworkOnly) — preserva multi-tenant + dados sensíveis
- **Alias:** `@/` → `src/`
- **Code splitting:** `manualChunks` divide vendor (react/react-dom) em chunk separado
- **Sourcemap:** `false` em produção (não vazar source)
- **Port:** dinâmico via `process.env.PORT` (Railway injeta)
- **Build target:** Bundle alvo < 200KB gzipped (verificado em ~67KB)

### 9.2 `tailwind.config.ts`

- **Dark mode:** `class` (controlado por `html.dark` via `useTheme`)
- **Content:** `./index.html` + `./src/**/*.{ts,tsx}`
- **Theme:**
  - **Cores** via CSS vars (`bg`, `surface`, `border`, `text`, `primary`, `secondary`, `magenta`, `blue`, `navy`, semânticas `danger/success/warning/info`, canais 8 marketplaces/social)
  - **Brandbook v3:** navy `#201554` + cyan `#2bcae5` + magenta `#bd1fbf`
  - **Fonts:** Cabin (UI), Fira Sans (display), Fira Mono (mono)
- **Plugins:** Nenhum extra (sem `@tailwindcss/forms` ou `typography`)

### 9.3 `tsconfig.json`

- **Target:** ES2022, **lib:** ES2022 + DOM
- **Module:** ESNext + `moduleResolution: bundler`
- **JSX:** `react-jsx`
- **Strict:** ✅ + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch`
- **Paths:** `@/*` → `src/*`
- **References:** `tsconfig.node.json` (config Vite)

### 9.4 `tsconfig.node.json`

- Configuração isolada pro Vite + scripts node (build, configs)

### 9.5 `playwright.config.ts`

- 13 specs em `frontend/e2e/`
- Workers serial (1 por padrão), retries 2 em CI
- Base URL via env

### 9.6 `lighthouserc.cjs`

- Performance > 85, A11y > 90
- FCP < 2s, LCP < 3s, TBT < 300ms, CLS < 0.1

### 9.7 `railway.toml`

- NIXPACKS builder
- `npm ci && npm run build` → `npx serve dist -l $PORT -s`
- Sem healthcheck (serve estático sempre OK quando build passa)

### 9.8 `eslint.config.mjs` (flat config)

- ESLint 9 flat config
- Regras: `react-hooks/recommended` + `react-refresh/only-export-components` + `@typescript-eslint/*`
- Globals navegador

---

## 10. Backend — Deltas desde 2026-05-16

> **Resumo:** Nenhuma nova migration. Nenhum módulo novo. Lista de módulos e integrações idêntica à v1 do PROJECT_MAP. Apenas commits frontend + dois doc commits backend.

### 10.1 Commits desde 2026-05-16 18:00

| Commit | Tipo | Resumo |
| --- | --- | --- |
| `8d5dce8` | docs | PROJECT_MAP_2026-05-16 + ACTION_PLAN_2026-05-16 |
| `2c59343` | chore(ui) | autoFocus + sidebar `/funis` + Pipeline residual |
| `cf979c6` | feat(funil) | **CRUD funis customizados** (backend + frontend) — biggest delta da semana |
| `94a9c06` | fix(funil) | Rename Pipeline→Funil + transições bidirecionais |
| `178426e` | feat(ux) | `useConfirm` substitui `window.confirm` em 8 sites |
| `479547f` | fix(forms) | Último sweep `disabled={!valid}` + empty state acionável |
| `7b23100`, `c6934cb`, `64349d7` | fix(forms) | Validação inline em ~10 forms |
| `169c008`, `da347f0` | feat(filters) | `?clienteId=` + `?highlight=` em 4 listas |
| `da69fa9` | feat(pedidos) | Filtro período PedidosPage |
| `991228a` | feat | Tabs Propostas/Amostras/Ocorrências + banner "Duplicado de" |
| `89597b3` | fix(leads) | Drag-drop + validação kanban |
| `1af294e` | feat | **Backend duplicar + editar itens + métricas cliente + filtros tab pedidos** |
| `7f3d335` | feat | Duplicar/editar pedido + tab pedidos cliente + ESTOQUE_ZERADO |
| `d969b72` | feat | Página `/pedidos/:id` |
| `3c6d29e` | feat | **Sync OMIE estoque 30min + webhook + UI** |
| `978561a`, `d89c221` | feat/docs | **Brandbook oficial + dark mode + Criar pedido** + BRANDBOOK.md + CLAUDE.md |

### 10.2 Backend — módulos e integrações (mesmos da v1)

- **Módulos `src/modules/`:** 33 (`agenda, amostras, audit, auth, campanhas, catalogo, clientes, comissoes, dead-letter, empresas, fidelidade, fluxos, formularios, funis, health, import, inbox, incidents, integracoes, leads, metas, mullerbot, notificacoes, nps, ocorrencias, pedidos, permissions, produtos, propostas, relatorios, segmentos, tags, users`)
- **Integrações `src/integrations/`:** 9 (`amazon, google, mercadolivre, meta, omie, sendgrid, shopee, tiktok, whatsapp`)
- **Migrations Prisma:** 14 (`0_init` ausente + 13 incrementais)
- **Cron jobs:** 10 (todos com CronLock)
- **BullMQ queues:** 3 (`fluxo-execucao`, `campanha-envio`, `dead-letter`)

### 10.3 Novas funcionalidades backend (dentro da janela)

| Feature | Arquivos novos/modificados |
| --- | --- |
| Funis CRUD | `src/modules/funis/{funis.controller.ts, funis.service.ts, funis.module.ts, funis.dto.ts}` |
| Lead.funilId + funilEtapaId | `prisma/schema.prisma` (Lead, Funil, FunilEtapa, FunilEtapaTipo enum) |
| Migration `funis` | `prisma/migrations/20260518090000_funis/migration.sql` |
| Pedido.pedidoOrigemId (duplicar) | `prisma/schema.prisma` + migration `pedido_origem` |
| PATCH /pedidos/:id aceita `itens[]` | `pedidos.service.ts` (`update` recalcula totais) |
| POST /pedidos/:id/duplicar | `pedidos.controller.ts` + `pedidos.service.ts` |
| GET /clientes/:id/metricas | `clientes.controller.ts` + `clientes.service.ts` |
| Estoque OMIE: cron 30min + webhook + ESTOQUE_ZERADO | `omie-estoque.job.ts` + `omie-webhook.controller.ts` (rota `/produto`) + Notificacao enum |
| Transições bidirecionais kanban | `leads.constants.ts` (`TRANSICOES_ETAPA`) |

> Backend está estável — todas mudanças foram aditivas (não-breaking). Cliente Prisma precisa `npx prisma generate` localmente após `git pull` (workaround documentado).

---

## 11. Gaps observados na revisão

### 11.1 Frontend específicos

| # | Gap | Severidade | Recomendação |
| --- | --- | --- | --- |
| 1 | `manifest.webmanifest` aponta pra `favicon.ico` inexistente | ⚠️ baixa | Gerar ícone PWA dedicado (192/512/maskable) com símbolo Betinna |
| 2 | `theme_color: "#3b82f6"` no PWA manifest (azul Tailwind) — não casa brandbook | ⚠️ baixa | Atualizar pra `#201554` (navy oficial) |
| 3 | `Modal.tsx` legacy ainda usado em 6+ páginas | ⚠️ média | Migrar para `Dialog` do DS (FidelidadePage, TagsPage, AmostrasPage, OcorrenciasPage, FormulariosPage, ProdutosPage) |
| 4 | `styles.ts` inline CSS em ~10 páginas legacy | ⚠️ média | Convergir Tailwind (esforço L) |
| 5 | `FormField.tsx` legacy redundante com `Field.tsx` do DS | ⚠️ baixa | Migrar usages do `FormField` → `Field` |
| 6 | `LanguageSelect.tsx` existe mas não registrado em UI | ⚠️ baixa | Decisão produto: ativar i18n ou remover |
| 7 | Tipos compartilhados (`types/`) com apenas `auth.ts` | ⚠️ baixa | Centralizar tipos de API (gerar do backend ou colocar em `types/api/*.ts`) |
| 8 | Sem `vitest` configurado no frontend | ⚠️ média | Setup + ~10 testes core (hooks + UI components críticos) |
| 9 | `useApiQuery` sem cache global | ⚠️ baixa | Avaliar TanStack Query quando dor real aparecer (Dashboard pode ser candidato 1º) |
| 10 | Páginas grandes (>1000 LOC) — 8 páginas: ClienteDetailPage(1951), ClientesPage(1509), PedidosPage(1141), LeadsPage(1117), CatalogoPage(1118), CampanhasPage(1126), PropostasPage(1202), FidelidadePage(1101) | ⚠️ alta | Refactor incremental (1 por sprint) |
| 11 | `lucide-react` 1.16.0 — vale checar se é versão certa (Lucide costuma ser 0.x) | ⚠️ verificar | Provavelmente correto mas curioso |

### 11.2 Frontend novos / sem testes nem doc

| Feature recente | Doc? | Testes? |
| --- | --- | --- |
| Funis customizados (`/funis`) | ❌ | ❌ |
| Dark mode + brandbook | ✅ `BRANDBOOK.md` | ❌ |
| `useConfirm` hook | ❌ | ❌ |
| ESTOQUE_ZERADO notification | ❌ | ❌ |
| Página `/pedidos/:id` dedicada | ❌ | ❌ |
| Duplicar/editar pedido (NovoPedidoDialog em modo edição) | ❌ | ❌ |
| Tabs Propostas/Amostras/Ocorrências no ClienteDetailPage | ❌ | ❌ |
| Filtros `?clienteId=` + `?highlight=` | ❌ | ❌ |

### 11.3 Backend (manteve-se igual à v1)

Sem novos gaps backend desde a v1. Os 2 P0 da v1 permanecem:
1. Baseline `0_init` migration ausente
2. TD-C consolidação Postgres Railway → Supabase pendente

---

## Resumo do que MUDOU desde 2026-05-16

**Versão anterior:** `PROJECT_MAP_2026-05-16.md` (criado hoje, sessão anterior)
**Esta versão:** `PROJECT_MAP_2026-05-17.md` (com medições reais — não houve nada material entre as duas, mas esta versão é mais precisa nos números frontend)

**Mudanças entre as duas versões (escopo "o que mapeei diferente, não o que aconteceu no projeto"):**

| Item | v1 (2026-05-16) | **v2 (2026-05-17) — esta** |
| --- | --- | --- |
| Quantidade de hooks | 7 declarado (incluindo `useIsMobile` + `useToast`) | **4 arquivos** em `hooks/` + 2 exportados de outros lugares |
| LOC páginas | "43 páginas" sem total | **29.663 LOC** total medidos |
| LOC componentes shared | "18 componentes" sem total | **17 arquivos + 3.834 LOC** medidos |
| LOC UI library | "22" sem total | **21 componentes + 1.747 LOC** + `index.ts` |
| Componentes shared | "18" (com styles.ts) | **17** (LanguageSelect contabilizado mas não registrado) |
| LOC lib | implícito | **1.563 LOC** medidos |
| Dependencies | listadas em alto nível | **Tabela completa com versões** (22 runtime + 17 dev) |
| Bibliotecas ausentes | mencionadas | **Tabela com recomendação** + custo bundle estimado |
| PWA manifest | não auditado | **Detectado:** theme_color `#3b82f6` (não-brand) + favicon.ico inexistente |
| Tailwind tokens | mencionados | **Documentado:** CSS vars com brandbook v3 |
| Tipos frontend | "1 arquivo" | **Confirmed:** apenas `auth.ts` (27 LOC) |
| Páginas >800 LOC | 6 mencionadas | **8 páginas >1000 LOC** medidas — refactor priority |

**Mudanças no projeto (que motivaram a regeneração):** Nenhuma. Os commits relevantes (kanban, funis, brandbook, useConfirm, validação) **já estavam na v1**. Esta v2 só refina os números medidos e foca mais profundamente no frontend.

**TL;DR:** Estado do projeto e GO/NO-GO inalterados (🟡 atenção · ~85% pronto). v2 é mais precisa nos números do frontend e detalha dependências + configs.
