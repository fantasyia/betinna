# CLAUDE.md — Betinna.ai Backend

> **Para o assistente:** este arquivo é a fonte da verdade do projeto. Leia-o antes de qualquer
> mudança. Sempre que tomar decisões importantes ou estabelecer convenções, **atualize aqui**.

## 1. O que é este projeto

**Betinna.ai** — plataforma comercial B2B (indústria de alimentos / químicos / bebidas / embalagens).

- CRM com gestão de carteiras por representante
- Pedidos de venda integrados ao OMIE (ERP)
- SAC multicanal (WhatsApp + Marketplaces ML/Shopee/Amazon/TikTok + IG + FB + e-mail)
- MullerBot (IA com RAG sobre descrições de produtos)
- Fluxos de automação visuais
- Aprovações hierárquicas (descontos acima do teto do rep)
- **Multi-tenant** (várias empresas operam isoladamente)

**Repo:** https://github.com/fantasyia/MSM_alimentos
**Protótipo HTML de referência:** `C:\Users\Dell\Downloads\files\betinna.html` (fonte da spec UX)

## 2. Stack

- **NestJS 11** + TypeScript estrito + Node.js 24
- **Prisma 6** + Postgres (Supabase)
- **Supabase**: Auth + Storage + Postgres
- **Pino** (logs estruturados) + **Sentry** (futuro)
- **BullMQ** + Redis (jobs futuros — Redis local dev: `docker run -d -p 6379:6379 redis:7-alpine`)
- **Zod** (validação) via `ZodValidationPipe`
- **Swagger** em `/docs`
- **Vitest** (testes)
- **Helmet + Throttler** (segurança)
- **jose** (JWT verify Supabase)
- **Hospedagem alvo:** Railway (long-running container, suporta BullMQ)

## 3. Papéis (UserRole enum)

| Role | Acesso |
|---|---|
| `ADMIN` | **Master da PLATAFORMA Betinna** (operador da empresa que provê o SaaS). Bypass no PermissionsGuard. Funções cross-tenant: criar/listar empresas, métricas globais, dead-letter, suporte universal. Também pode **operar config de qualquer tenant** como override de suporte (D48). |
| `DIRECTOR` | **Mandatário de UM tenant** (decisor da empresa-cliente). Total dentro do tenant dele: configura integrações (D45), define teto desconto/% comissão (D46), fecha/paga comissões, edita dados fiscais do tenant. |
| `GERENTE` | Gestão operacional sem config/integrações. **Vê apenas carteira dos REPs sob sua gerência** (`Usuario.gerenteId = gerente.id`). Pode ter vários REPs abaixo. |
| `SAC` | Atendimento ao cliente (Inbox marketplaces/redes sociais + ocorrências). Permissões adicionais configuráveis pelo Admin via UI. |
| `REP` | Apenas a própria carteira (filtro automático em listas). **Inbox limitada ao próprio WhatsApp pessoal** (qualquer pessoa que ele conversar — cliente, prospect, fornecedor) — não acessa marketplaces nem redes sociais. |

**Hierarquia rep → gerente:** `Usuario.gerenteId` (nullable, self-FK) aponta o REP pro GERENTE responsável. Se `gerenteId=null`, a carteira é gerenciada pelo DIRECTOR/ADMIN (catch-all). Filtragem centralizada em `RepScopeService.getRepIds(user)` que retorna a lista de REP ids visíveis (null = sem restrição). Aplicado em clientes, pedidos, propostas, aprovações, leads, comissões, amostras, ocorrências, agenda.

**Permissões granulares** (Role × Módulo × Ação) — `src/modules/permissions/permissions.constants.ts`.

## 4. Convenções obrigatórias

### Padrão de resposta
- Sucesso: `{ success: true, data, meta }` (via `ResponseInterceptor`)
- Erro: `{ success: false, error: { code, message, details }, meta }` (via `AllExceptionsFilter`)
- Paginada: `data: { data: [], pagination: { page, limit, total, totalPages } }`

### Erros sempre via `AppException`
- `UnauthorizedException`, `ForbiddenException`, `NotFoundException`,
  `ConflictException`, `ValidationException`, `BusinessRuleException`, `IntegrationException`
- Códigos enumerados em `ErrorCode` (`src/shared/errors/error-codes.ts`)

### Validação
- Sempre com Zod via `new ZodValidationPipe(schema)`
- DTOs em arquivo `*.dto.ts` do módulo

### Segurança
- Endpoints protegidos POR PADRÃO (AuthGuard global)
- Marcar público com `@Public()`
- Restringir por role com `@Roles('ADMIN', 'GERENTE')`
- Restringir por permissão granular com `@RequirePermissions({ module: 'clientes', action: 'edit' })`
- Auditar com `@Audit({ action, resource, resourceIdFrom: 'params.id' })`

### Multi-tenant
- Toda query DEVE filtrar por `empresaId = user.empresaIdAtiva`
- Quando `user.role === 'REP'`, também filtrar por `representanteId = user.id`
- Header `X-Empresa-Id` define empresa ativa; senão usa a primeira de `user.empresaIds`
- Tentativa de acessar empresa não vinculada → `403 TENANT_ACCESS_DENIED`

### Tokens / segredos
- NUNCA expor `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` no client
- Criptografar tokens de integração com `CryptoUtil` (AES-256-GCM)
- Validar env com Zod em `src/config/env.schema.ts`

## 5. Decisões arquiteturais já tomadas

| # | Decisão | Justificativa |
|---|---|---|
| D1 | **Não usar gateway de pagamento (Iugu/Stripe)** | Diretor da empresa-cliente cobra apenas via boleto/Pix emitidos pelo financeiro no OMIE. App só registra a forma escolhida. |
| D2 | **Cliente.omieStatus binário** (`ATIVO` \| `BLOQUEADO`) | Motivo do bloqueio fica no OMIE; rep não precisa saber. |
| D3 | **Tetos de desconto por rep** configuráveis pelo diretor (Usuario.tetoDesconto) | Cada rep tem seu teto; > teto → fluxo de aprovação |
| D4 | **Preços negociados por cliente** vêm do OMIE (sync) | Tabela `ClientePrecoEspecial` é fonte espelhada; `PricingService` resolve. |
| D5 | **Catálogo do rep** = subset de Produtos com markup% por item | Cada rep monta o próprio catálogo personalizado |
| D6 | **Salvar como Proposta** na revisão do Novo Pedido | Alternativa antes de enviar pro OMIE |
| D8 | **Stack: NestJS + Railway + Supabase** | Pivô consciente do Next.js inicial. Justificado pelo briefing senior. |
| D9 | **Integrações com credenciais por empresa** (`IntegracaoConexao`) cifradas AES-256-GCM | Multi-tenant exige isolamento de tokens entre empresas. `obterCredenciaisInternas` é o ponto único de decifragem. |
| D10 | **OMIE_DEMO_MODE default true** | Permite dev/CI sem credenciais reais. Trocar pra `false` no Railway quando plugar tenant real. |
| D11 | **Webhooks externos sempre HMAC-validados** com `req.rawBody` + `timingSafeEqual` | OMIE/Meta/ML/etc todos suportam HMAC. Sem isso qualquer um pode falsificar status changes. |
| D12 | **Dois modelos distintos pra credenciais**: `IntegracaoConexao` (empresa) e `UsuarioIntegracao` (usuário) | Postgres NULL-em-unique é traiçoeiro. Modelos separados deixam o escopo explícito no schema e mantêm o padrão `upsert` limpo. |
| D13 | **Espelhamento Google Calendar é best-effort** | Falha do Google não derruba criação local de AgendaItem — só loga warning. UX > consistência distribuída na agenda pessoal. |
| D14 | **OAuth state JWT derivado da ENCRYPTION_KEY** via SHA256(key + "google-oauth-state") | Isolamento criptográfico: comprometimento do state JWT não vaza ENCRYPTION_KEY direto. TTL 5min + nonce JTI bloqueia replay. |
| D15 | **WhatsApp via Baileys (não-oficial)** em vez de Meta Cloud API | Custo zero, sem template approval, controle total. Trade-off: risco de ban pela Meta, não escala horizontalmente sem trabalho extra (sticky session por empresa). Usar número dedicado. |
| D16 | **Inbox canal-agnóstica desde a primeira linha** (Conversation com enum MessageChannel) | IG/FB/email/marketplaces vão entrar sem rework do core — só plugar adapter no `CanalAdapterRegistry`. |
| D17 | **Auth state do Baileys cifrado em IntegracaoConexao com debounce 200ms** | Auth state muda dezenas de vezes durante pareamento; persistir imediato seria custoso. Debounce + `flush()` no shutdown garante consistência sem I/O excessivo. |
| D18 | **Match de cliente por sufixo de telefone (8 últimos dígitos)** | Variação de formato (com/sem +55, DDD com/sem 9 inicial) é o desespero da vida. Sufixo bate cliente direito em 99% dos casos. |
| D19 | **Meta via Graph API oficial** (não scraping) — uma `IntegracaoConexao` por canal (`facebook`, `instagram`), `externalAccountId` indexável pra routing | Meta é agressiva banindo conexões não-oficiais no IG/FB (muito mais que WhatsApp Web). Custo zero da API oficial + janela 24h compensa o overhead do App Review. |
| D20 | **MVP usa primeira page do user** no OAuth Meta | Multi-page por empresa exige tabela separada (decisão futura). Pra 1ª iteração o esquema unique(empresaId, servico) é suficiente. |
| D21 | **MullerBot usa apenas OpenAI** (não Anthropic) | Decisão do cliente — simplifica setup pra ele (uma única integração). Fallback env (`OPENAI_API_KEY`) garante que sistema sempre tem opção. |
| D21b | **Limite de tokens com truncate inteligente do catálogo** | Pergunta longa demais → rejeita early com BusinessRuleException. Catálogo > orçamento → tenta versão compacta (sem descrição), e só pula se ainda não couber. Evita estouro do context window + custo runaway. |
| D21c | **Sync OMIE incremental por default** baseado em `data_alteracao > IntegracaoConexao.ultimoSync` | Cron diário é incremental (não re-importa tudo). `?modo=completo` ou `/sync/forcar` quando admin precisar forçar. Reduz I/O com OMIE + custo + tempo de sync. |
| D22 | **Keyword search em memória > pgvector no MVP** | ≤500 produtos por empresa cabe perfeitamente em scoring em memória (RAM trivial, latência < 10ms). pgvector entra quando empresa passar desse volume — interface `ProdutoSearchService.buscar` já está pronta pra trocar. |
| D23 | **System prompt do MullerBot proíbe explicitamente alucinação** | "Use APENAS o catálogo fornecido. Se não encontrar, diga." Risco de bot inventar SKU/preço é alto em LLMs sem guardrails; o prompt é a primeira linha de defesa. |
| D24 | **Marketplaces em etapas (4 sessões) com scaffolding compartilhado** | SAC completo por marketplace é trabalho denso. Etapa 1 (ML) cria infra reutilizável (`MarketplaceIncident`, `ConversationCategoria`, `IncidentsService`); Shopee/Amazon/TikTok consomem o mesmo modelo só plugando adapter próprio. |
| D25 | **`MarketplaceIncident` canal-agnóstico com status unificado** | Em vez de modelar reclamação/devolução por marketplace, mapeamos os status nativos (`ML opened`, `Shopee return_requested`, `Amazon A-to-Z opened`) pro mesmo enum (`AGUARDANDO_VENDEDOR/EM_MEDIACAO/RESOLVIDO/...`). UI/dashboard ficam triviais. |
| D26 | **ML usa peerId estruturado** `q:<question_id>`, `pack:<pack_id>`, `claim:<claim_id>` na Inbox | Permite que um mesmo `MLService.enviarTexto` roteie automaticamente pro endpoint certo (answer/message/claim message) com base no prefixo. Sem polimorfismo de Conversation. |
| D27 | **ML webhook valida IP whitelist** (ML não tem HMAC oficial) | ML documenta 4 IPs de origem. Whitelist é a única proteção viável. `ML_WEBHOOK_IP_WHITELIST` configurável (vazio = aceita qualquer IP em DEV, com warning). |
| D28 | **Cron 10min fallback** em todos os marketplaces (ML/Shopee/TikTok) + **10min principal no Amazon** (sem webhook HTTP) | Webhooks perdem eventos em alta carga; Amazon usa SQS (não implementado). Latência máxima 10min garante resposta dentro do prazo dos marketplaces mesmo quando o bot não responde e operador SAC precisa entrar. Pull idempotente via `externalId`. Volume estimado: 5 empresas × 4 marketplaces × 144 runs/dia ≈ 2.9k runs/dia, ~20k chamadas API — dentro dos rate limits. |
| D29 | **Shopee HMAC isolado em `ShopeeSigner`** com 3 modos (public/shop/merchant) | Cada endpoint exige fórmula diferente (auth não inclui access_token+shop_id, shop sim). Encapsular evita espalhar erro — `ShopeeClientService.getShop/postShop` chama o signer transparente, services especializados ficam puros. |
| D30 | **Shopee chat envia via `conv:<conversation_id>`**; returns/disputes NÃO aceitam texto livre | A API de returns Shopee não tem `/send_message` — só ações específicas (`abrirDisputa`, `aceitarOferta`). Adapter bloqueia explicitamente envio de texto pra evitar UX confusa. |
| D31 | **Webhook Shopee assina `<url>\|<body>`** com partner_key | Diferente do ML (sem HMAC), Shopee tem HMAC obrigatório do url cadastrado + body cru. `ShopeeSigner.verifyWebhook` faz a verificação em tempo constante. |
| D32 | **Amazon SAC tem cobertura inerentemente limitada pela API** — não há chat livre nem mensagens INBOUND expostas; A-to-Z Claims/CS contacts só via Seller Central | Restrição da Amazon, não do nosso código. UI precisa deixar claro que respostas do comprador chegam fora do nosso sistema (Amazon não notifica via API). Operador usa Permitted Actions outbound estruturadas. |
| D33 | **Amazon adapter prioriza Permitted Actions por permissividade** (confirmDeliveryDetails → confirmOrderDetails → unexpectedProblem) | Cada pedido tem set diferente de ações disponíveis dependendo do status e marketplace. Em vez de exigir que UI escolha, escolhemos a mais permissiva disponível pra "texto livre". getCustomerInformation continua exigindo chamada dedicada. **NF/sendInvoice fora do escopo** — sai pelo hub fiscal externo do cliente. |
| D34 | **Amazon usa `x-amz-access-token` em vez de AWS Sigv4** (mudança out/2023) | Amazon simplificou: agora SP-API aceita só o LWA access_token como header. Não precisamos implementar AWS Signature v4 nem manter IAM roles. Economia de ~30% de complexidade prevista pra integração. |
| D35 | **Amazon pull periódico (cron 10min)** em vez de SQS subscriber | SQS exige fila configurada + IAM policies + long-polling worker. MVP usa pull a cada 10min. Latência máxima 10min é aceitável pra prazos dos marketplaces Brasil. Quando volume justificar tempo real, plugamos SQS sem mudar interface do `AmazonOrdersService`. |
| D36 | **TikTok HMAC sandwich** `secret + path + sorted_params + body + secret` isolado em `TikTokSigner` | Fórmula diferente do Shopee (que assina só path+params, sem sandwich). Encapsular previne erro de assinatura em todas as ~10 chamadas. |
| D37 | **TikTok Shop bloqueia envio de texto livre** no adapter Inbox | API TikTok Shop não expõe chat livre comprador↔vendedor (só via Seller Center). Adapter lança BusinessRuleException explicitamente — UX clara em vez de erro 4xx silencioso. Returns usam endpoints estruturados (seller_proposal/seller_reject/seller_evidence). |
| D38 | **WhatsApp dual-owner**: 1 número por empresa (central SAC) + 1 por usuário (rep pessoal). Inbox REP filtra por `proprietarioId=user.id` | Sistema atende DOIS perfis: equipe interna SAC (número central da empresa) + cada rep com o próprio celular WhatsApp. `Conversation.proprietarioId` (nullable FK pra Usuario) distingue: null = sessão empresa, preenchido = sessão pessoal. `WhatsAppSessionService` indexa por `ownerKey` (`emp:<id>` ou `user:<id>`). Boot itera ambas tabelas (`IntegracaoConexao` + `UsuarioIntegracao`). REP vê SÓ `proprietarioId=user.id` (próprio WhatsApp) — qualquer pessoa que ele conversa (cliente, prospect, fornecedor) aparece. Marketplaces/IG/FB continuam restritos a SAC/gerência. REP não pode reatribuir. |
| D39 | **MullerBot: REP obrigado a ter chave OpenAI própria** (sem fallback env) | Cada rep paga o próprio crédito OpenAI (rastreabilidade + custo isolado). ADMIN/DIRECTOR/GERENTE/SAC podem usar a chave do env (corporativa) como fallback. REP sem chave → erro com instrução pra configurar em /usuario/integracoes. |
| D40 | **Hierarquia rep → gerente em `Usuario.gerenteId`** (self-FK nullable) + filtragem centralizada em `RepScopeService` | Empresa tem N gerentes, cada um gerencia N reps. REP sem gerente → gerido por DIRECTOR/ADMIN (catch-all). `RepScopeService.getRepIds(user)` retorna `null` (sem filtro: ADMIN/DIRECTOR/SAC), `[user.id]` (REP) ou `findMany({ gerenteId: user.id })` (GERENTE). Centralizar a regra evita drift entre módulos: clientes, pedidos, propostas, aprovações, leads, comissões, amostras, ocorrências, agenda. |
| D41 | **Comissão de GERENTE = somatório de vendas dos REPs sob sua gerência × `Usuario.comissaoPadrao`** | `Comissao.tipo` (`REP`\|`GERENTE`) discrimina os dois fluxos. REP: comissão direta calculada por pedido. GERENTE: agregada no `fecharMes`. `Comissao.percentual` snapshot da % usada (preserva valor histórico se admin alterar depois). Endpoint `PUT /users/:id/comissao` é restrito a ADMIN/DIRECTOR. |
| D42 | **Anti-órfão: ao desativar GERENTE, `gerenteId` dos seus REPs vira `null` automaticamente** | Sem cleanup, REP fica apontando pra alguém inativo → carteira invisível. `setStatus(INATIVO)` em users service faz updateMany pré-update. Reps caem no catch-all do DIRECTOR. |
| D43 | **Cron mensal `ComissoesFechamentoJob` — dia 1 às 04:00 UTC** fecha o mês anterior pra todas as empresas ativas | Idempotente (`reprocessar=false` skipa quem já fechou manual). Falha por empresa loga e segue. Usa `system-cron` AuthenticatedUser. |
| D44 | **BullMQ para Fluxos de Automação** (não cron in-process) — step-by-step, 1 job por nó | Volume esperado alto desde o lançamento. BullMQ garante retry, delay natural (DELAY nodes), visibilidade na fila e zero perda em crash. `FluxoEventBusService` dispara silenciosamente — falha no bus não derruba operação principal. Fila `fluxo-execucao`, concorrência 5 no processor. |
| D45 | **TODAS as integrações de escopo EMPRESA são DIRECTOR-only** (OMIE, WhatsApp empresa, marketplaces ML/Shopee/Amazon/TikTok, social FB/IG). ADMIN NÃO bypassa (diferente do resto do sistema). | Cada integração empresa carrega responsabilidade contratual ou fiscal do decisor da empresa: OMIE (dados fiscais/contábeis), Marketplaces (TOS comerciais, comissões, repasse fiscal), Social (identidade da marca, quem fala em nome da empresa), WhatsApp empresa (risco de ban Meta no número dedicado). Implementado via flag `SERVICO_METADATA.requerDirector` + guard `IntegracoesService.assertDirectorRequerido` (ponto único). ADMIN pode VER status pra debug, mas não conecta/desconecta. **Integrações de escopo USUÁRIO** (google_calendar, openai, anthropic, whatsapp pessoal) NÃO entram aqui — cada user mexe nas suas via `UsuarioIntegracoesService` (que não consulta esta flag). |
| D46 | **Decisões financeiras e fiscais são DIRECTOR-only** — teto de desconto do rep, % de comissão, fechar/pagar/desmarcar comissões, editar/ativar/desativar empresa. ADMIN NÃO bypassa. | Mesma lógica do D45 aplicada a operações que afetam dinheiro ou dados fiscais: definir teto/comissão é cláusula contratual com o rep; fechar mês determina folha; marcar pago libera dinheiro; editar empresa muda CNPJ/razão social. Implementado via `@Roles('DIRECTOR')` nos controllers `users` (teto-desconto + comissao), `comissoes` (fechar-mes + pagar + desmarcar-pago) e `empresas` (PATCH + activate + deactivate). ADMIN continua podendo CRIAR empresa (setup multi-tenant) e CRIAR/EDITAR/ATIVAR/DESATIVAR usuários (operacional, não financeiro), mas NÃO mexe em teto/comissão/folha/dados fiscais da empresa existente. Frontend usa `useRole()` pra esconder esses botões de não-DIRECTOR. |
| D49 | **Auditoria de permissões concluída — sistema coerente entre backend e frontend**. Frontend `PERMISSION_MATRIX` hardcoded é trade-off consciente (UI hide hint); backend `PermissionsGuard` + `@Roles` + tabela dinâmica `Permissao` são o gate real. Drift entre os dois é tolerável (max few reloads pra refresh frontend hardcoded). Identificados módulos "dead code" na matriz DEFAULT_PERMISSIONS sem controller (`audit_log`, `reps`, `metas`) — não causam bug, ocupam espaço, limpeza fica pra quando o módulo for implementado de verdade. | Audit cobriu: Comissões/Campanhas/Relatórios/Fluxos/Integrações/Empresas/Users. Mistura `@Roles('ADMIN','DIRECTOR')` (gate restritivo D45/D46/D48) com `@RequirePermissions({ module, action })` (matriz dinâmica) funciona como AND — backend valida ambos. Frontend `usePermission` + `useRole` espelham a regra pra esconder botões. Quando há `@Roles` mais estrito, frontend usa `useRole()` direto (ex: `canManage = DIRECTOR \|\| ADMIN`); quando é `@RequirePermissions`, usa `usePermission('modulo.acao')`. |
| D48 | **Hierarquia ADMIN vs DIRECTOR clarificada** (revisão de D45/D46): ADMIN é master da PLATAFORMA (cross-tenant), DIRECTOR é mandatário do TENANT. Endpoints D45 (integrações empresa) e D46 (decisões financeiras/fiscais) aceitam **ambos** — DIRECTOR pra operação normal do tenant, ADMIN como override de suporte. Outros papéis (GERENTE/SAC/REP) seguem bloqueados nessas operações. | Interpretação inicial de D45/D46 amarrava só DIRECTOR pelo "responsabilidade contratual", mas a leitura correta é: DIRECTOR tem **mandato** sobre as decisões do tenant dele, ADMIN tem **escopo cross-tenant** (master da plataforma). ADMIN não bypassa a regra de negócio — ele opera como suporte da plataforma; audit log registra quem fez. UX-wise, DIRECTOR é o usuário normal nessas telas; ADMIN só entra em emergências (debug/suporte/onboarding). Implementação: controllers voltam pra `@Roles('ADMIN', 'DIRECTOR')`, `IntegracoesService.assertDirectorRequerido` aceita ADMIN, frontend reflete (`canManage = role === 'DIRECTOR' \|\| role === 'ADMIN'`). |
| D47 | **Refresh token vive em cookie httpOnly, gerenciado pelo backend** (não em localStorage do frontend). Frontend só vê o access token, e em memória apenas. | Antes: SDK do Supabase guardava refresh em localStorage, vulnerável a XSS — uma vulnerabilidade XSS no frontend exporia o refresh token e permitiria roubo de sessão. Agora o backend é o único que conhece o refresh: `POST /api/v1/auth/login` (chama Supabase Auth REST, seta cookie httpOnly com refresh, retorna access), `POST /api/v1/auth/refresh` (lê cookie, troca por novo access+refresh, atualiza cookie), `POST /api/v1/auth/signout` (revoga no Supabase + apaga cookie). Cookie: `httpOnly + secure + SameSite=None` em prod (cross-origin Railway), `SameSite=Lax` em dev. Path restrito a `/api/v1/auth` (minimiza surface CSRF). Frontend: `bootstrapAuthFromBackend()` no `main.tsx` faz refresh inicial, `auth-store` agenda refresh transparente via setTimeout ~60s antes do exp, `api.ts` faz refresh-on-401 automático com retry uma vez. Bundle do frontend caiu 310KB → 105KB (Supabase SDK saiu do path principal). |

## 6. Status dos módulos

### Fase 0 — Bootstrap ✅
- [x] Config + Prisma + Supabase + Logger + Filters + Interceptors + Decorators + Pipes
- [x] Health check (`/api/v1/health`)
- [x] Swagger em `/docs`

### Fase 1 — Identity ✅
- [x] Auth (Supabase JWT verify + AuthGuard global)
- [x] Users (CRUD + invite via Supabase Auth)
- [x] Empresas (CRUD multi-tenant)
- [x] Permissions (RBAC granular com matriz Role × Módulo × Ação)
- [x] Audit log (interceptor automático com `@Audit()`)
- [x] Seed (admin inicial + permissões padrão)

### Fase 2 — CRM ✅
- [x] Tags (CRUD com contagem)
- [x] Clientes (CRUD + tenant + rep filter + 7 listas dinâmicas + bulk assign rep)
- [x] Notas privadas por cliente (autor edita, ADMIN força)
- [x] Documentos (Supabase Storage, 10MB, signed URLs)

### Fase 3 — Catálogo ✅
- [x] Produtos (CRUD + tenant + facets + validações)
- [x] PricingService (preço negociado × tabela × validade × batch)
- [x] Preços especiais (sub-recurso de Cliente)
- [x] Catálogo do Rep (markup % + preview pra cliente + share)

### Fase 4 — Vendas ✅
- [x] **Pedidos** (preview + create + listar + cancelar + envio OMIE mock)
- [x] **Aprovação de Desconto** (auto-trigger quando desconto > teto do rep + aprovar/rejeitar por gerente)
- [x] **PedidoPricingService** (cálculo de totais, descontos, comissão, max desconto)
- [x] **Propostas** (CRUD + itens + máquina de estados + conversão em pedido)
- [x] **Comissões** (fechamento de mês agregado REP + GERENTE com snapshot de %; `Comissao.tipo` discrimina; cron mensal `ComissoesFechamentoJob` dia 1/04:00 UTC; anti-órfão ao desativar gerente; resumo pessoal pra REP/GERENTE; pagamento)
- [x] **Amostras** (CRUD + follow-up auto-calculado + workflow ENVIADA→CONVERTIDA + **P7 remessa OMIE de amostra grátis**: vincula `produtoId` opcional + `quantidade`; `POST /amostras/:id/enviar-omie` → `OmieAmostrasService.enviarAmostra` monta remessa CFOP 5911 (mesma UF) / 6911 (interestadual, resolve por `Empresa.uf` vs `Cliente.uf`) sem destaque de tributos — cenário fiscal opcional via `OMIE_CENARIO_IMPOSTO_AMOSTRA`; persiste `numeroOmie`/`enviadoOmieEm`/`cfop`. Reusa `OmieClientService.incluirPedido` (mesmo endpoint produtos/pedido/). Funciona em demo mode; validação dos códigos fiscais reais fica pro plugue do OMIE real)

### Fase 5 — Pipeline & Atendimento
- [x] **Leads/Kanban** (CRUD + máquina de estados + won/loss + pipeline ponderado + aging)
- [x] **Ocorrências/SAC** (CRUD + SLA por severidade + timeline de comentários + numero sequencial)
- [x] **Fluxos de Automação** (BullMQ — veja Fase 7 abaixo)
- [ ] Inbox (WhatsApp Business) — junto com Fase 6 (integração Meta)

### Fase 6 — Integrações
- [x] **Infra HTTP compartilhada** (`@shared/http`) — `HttpClientService` (native fetch + retry/backoff + redaction), `WebhookSignatureUtil` (HMAC-SHA256 + `timingSafeEqual`)
- [x] **Integrações CRUD escopo empresa** (`@modules/integracoes`) — CRUD por empresa, credenciais cifradas com AES-256-GCM em `IntegracaoConexao`, cache 5min
- [x] **Integrações CRUD escopo usuário** (`UsuarioIntegracoesService` + `UsuarioIntegracao` no Prisma) — cada rep tem sua conexão (google_calendar, openai, anthropic)
- [x] **OMIE** (`@integrations/omie`) — escopo empresa. Client low-level, mapper, sync paginado clientes/produtos com modo **incremental** (default — só importa `data_alteracao > ultimoSync`) ou **completo** (`?modo=completo`, força tudo). Endpoint `POST /integracoes/omie/sync/forcar` (ADMIN/DIRECTOR) faz sync completo de clientes+produtos em paralelo. Cron diário 04:00 UTC em modo incremental. Push pedido real + webhook HMAC.
- [x] **Resend** (`@integrations/resend` + `@integrations/email`) — e-mail transacional **sistêmico** (provedor ÚNICO; SendGrid removido). `ResendService.enviar({ para, assunto, html/texto })` é o wrapper low-level (`ResendModule` é @Global); `TransactionalEmailService` (em `@integrations/email`, exportado pelo `EmailModule`) é a fachada com os templates de alto nível (boas-vindas, convite, aprovação, comissão, ocorrência, amostra, alerta). Usa o e-mail único da empresa (`RESEND_API_KEY`/`RESEND_FROM_EMAIL`), não credencial por usuário. Lança `IntegrationException` em falha.
- [x] **Google OAuth + Calendar** (`@integrations/google`) — OAuth flow com state JWT HS256 derivado da `ENCRYPTION_KEY` (CSRF protection), refresh token automático com margem 60s, callback `@Public()` em `/integracoes/google/oauth/callback`, `GoogleCalendarService` CRUD em `calendars/primary/events`
- [x] **Agenda** (`@modules/agenda`) — CRUD de `AgendaItem` por usuário, espelhamento opcional no Google Calendar (best-effort, falha no Google não derruba local), tipos VISITA/LIGACAO/REUNIAO/ENTREGA/TAREFA
- [x] **Inbox unificada** (`@modules/inbox`) — modelos `Conversation` + `Message` canal-agnósticos, enums `MessageChannel/Direction/Status/Type`, `ConversationStatus`. `Conversation.proprietarioId` (nullable FK Usuario) distingue conversas de sessões pessoais (WhatsApp do rep) vs empresa. `InboxService` faz upsert manual (findFirst+create — nullable não suporta unique direto), idempotência por (externalId × empresa × canal × peer × proprietario), resolve `Cliente` por sufixo de telefone (8 dígitos finais). **Acesso por papel**: ADMIN/DIRECTOR/GERENTE/SAC veem todos canais e sessões; **REP vê apenas o próprio WhatsApp** (`proprietarioId = user.id`) — qualquer pessoa que conversa com ele aparece (cliente, prospect, fornecedor). REP não pode reatribuir. Adapter recebe `ctx.proprietarioId` pra rotear envio pra sessão correta.
- [x] **WhatsApp via Baileys (dual-owner)** (`@integrations/whatsapp`) — suporta **dois escopos** simultâneos: (1) WhatsApp central da empresa (persistido em `IntegracaoConexao(servico='whatsapp')`) operado pela equipe SAC; (2) WhatsApp pessoal de cada usuário/rep (persistido em `UsuarioIntegracao(servico='whatsapp')`). Sessões Baileys indexadas por `ownerKey` (`emp:<id>` ou `user:<id>`), boot hook restaura ambas. Auth state cifrado AES-256-GCM com debounce 200ms. QR code como Data URL. Reconexão automática com backoff exponencial (max 10 tentativas). Filtra grupos/broadcasts/eco. `Conversation.proprietarioId` distingue de qual sessão veio cada conversa (null = empresa, preenchido = user). Endpoints `/integracoes/whatsapp/*` (empresa, ADMIN/DIRECTOR — SAC só vê status) + `/usuario/integracoes/whatsapp/*` (pessoal, qualquer user autenticado — inclusive GERENTE, que **não acessa o número da empresa**).
- [x] **Meta — Facebook Messenger + Instagram Direct** (`@integrations/meta`) — Graph API oficial. `MetaGraphClientService` low-level. `MetaOAuthService` com Facebook Login (state JWT HS256 derivado da `ENCRYPTION_KEY`), troca short-lived → long-lived user token, lista pages do user, vincula IG Business via `instagram_business_account`. Persiste duas `IntegracaoConexao` separadas (servico=`facebook` e `instagram`) com `externalAccountId` = pageId/igUserId (não-cifrado, indexável) pra routing reverso. Webhook único em `/webhooks/meta` (GET handshake com `META_GRAPH_VERIFY_TOKEN` + POST com HMAC SHA-256 do `META_GRAPH_APP_SECRET`). `FacebookService` e `InstagramService` são adapters auto-registrados na `CanalAdapterRegistry`. Endpoints `/integracoes/meta/oauth/{start,callback}` + `/webhooks/meta`.
- [x] **MullerBot** (`@modules/mullerbot`) — RAG sobre `Produto` da empresa (catálogo importado do OMIE). `ProdutoSearchService` faz keyword scoring TF com pesos (nome=3, marca=2, linha/categoria=1.5, descricao=1), top-K configurável. `MullerBotService` resolve OpenAI (`UsuarioIntegracao` servico='openai' por usuário, fallback `OPENAI_API_KEY` do env). System prompt **força usar só o catálogo fornecido**, sem alucinação. Endpoint `POST /mullerbot/perguntar`. OpenAI Chat Completions (gpt-4o-mini default via `MULLERBOT_MODEL`). **Limite de tokens** via `MULLERBOT_MAX_INPUT_TOKENS` (4000 default) + `MULLERBOT_MAX_OUTPUT_TOKENS` (1024 default): pergunta longa demais é rejeitada (BusinessRuleException), catálogo é **truncado inteligentemente** (tenta versão sem descrição antes de pular) e a resposta inclui `produtosTruncados` pra rastreabilidade. `OmieSyncJob` cron 04:00 UTC ressincroniza clientes + produtos em modo incremental.
- [x] **Mercado Livre — SAC completo** (`@integrations/mercadolivre`) — Etapa 1/4 dos marketplaces. Cobre 100% do atendimento ML: perguntas pré-venda + chat pós-venda (packs) + reclamações + mediações + devoluções + cancelamentos disputados + pedidos. OAuth 2.0 com state JWT (CSRF) + refresh token automático rotativo (60s margem). Webhook único `/webhooks/mercadolivre` (IP whitelist via `ML_WEBHOOK_IP_WHITELIST`) com routing multi-topic. Services especializados: `MLQuestionsService`, `MLMessagesService`, `MLClaimsService`, `MLOrdersService`. Adapter `MLService` roteia `enviarTexto` por prefixo do peerId (`q:` pergunta → POST /answers, `pack:` chat → POST /messages, `claim:` reclamação → POST claim/messages). Cron `MLSyncJob` rodando a cada **10 min** como fallback (claims abertas + perguntas não respondidas + pedidos recentes) — intervalo escolhido pra garantir resposta dentro do prazo do ML mesmo quando o bot não responde e operador SAC precisa entrar.
- [x] **Shopee — SAC completo** (`@integrations/shopee`) — Etapa 2/4. Cobre: chat seller (sellerchat) + returns/refunds + disputas (seller dispute) + cancelamentos + pedidos. `ShopeeSigner` aplica HMAC SHA-256 em CADA request (peculiaridade da Shopee Open Platform v2): fórmula `partner_id + path + timestamp + access_token + shop_id` com `partner_key`, sig em query `?sign=<hex>`. Shop authorization via redirect partner-level (não OAuth padrão) — `code` + `shop_id` trocados por `access_token` (4h) + `refresh_token` (30 dias). `ShopeeClientService` auto-aplica sign e refresh transparente (60s margem) e trata erros no payload (Shopee retorna error em HTTP 200). Webhook `/webhooks/shopee` valida HMAC SHA-256 de `<url>|<rawBody>` com partner_key (header `Authorization`). Routing por `code` (push_type): 3/4 → orders, 6/15/16 → returns/dispute, 7 → chat. Adapter `ShopeeService` envia chat via `conv:<conversation_id>` peerId; returns/disputes não aceitam texto livre (bloqueio explícito, usar `abrirDisputa`/`aceitarOferta`). Cron **10 min**: fallback returns + orders.
- [x] **Amazon SP-API — SAC** (`@integrations/amazon`) — Etapa 3/4. Cobertura SAC limitada pelas restrições inerentes da API Amazon (não há chat livre, mensagens INBOUND do comprador não são expostas, A-to-Z Claims/Customer Service só via Seller Central). O que cobrimos: OAuth Selling Partner (LWA) com state JWT + refresh transparente (60s margem); `AmazonClientService` aplica `x-amz-access-token` (Amazon removeu AWS Sigv4 em out/2023, simplificando muito a integração) + roteamento multi-região (NA/EU/FE + sandbox toggle); Orders pull via `/orders/v0` com paginação `NextToken`; **Messaging API com 4 Permitted Actions estruturadas** (confirmDeliveryDetails, confirmOrderDetails, unexpectedProblem, getCustomerInformation — NFe/sendInvoice está FORA DO ESCOPO porque sai pelo hub fiscal externo do cliente, não por este sistema); adapter `AmazonService` roteia `enviarTexto` para a action permitida disponível no pedido (prioridade: confirmDeliveryDetails → confirmOrderDetails → unexpectedProblem) — rejeita texto < 5 chars; cron **10 min** de pull (Amazon usa SQS/SNS, não webhook HTTP — pull é o caminho PRINCIPAL no MVP, latência máxima 10min; SQS subscriber fica pra fase futura). Endpoints `/integracoes/amazon/oauth/{start,callback}`.
- [x] **TikTok Shop — SAC** (`@integrations/tiktok`) — Etapa 4/4. **Fecha a Fase 6 de marketplaces.** Cobertura: OAuth shop authorization (services.tiktokshop.com) com state JWT + refresh transparente (60s margem; access ~7 dias, refresh ~365 dias); `TikTokSigner` HMAC sandwich `secret + path + sorted_params + body + secret` em hex; `TikTokClientService` aplica sign + access_token + shop_id + shop_cipher em CADA request; Orders v202309 (search + get com lotes 50); Returns v202309 (search/get/seller_proposal/seller_reject/seller_evidence) → `MarketplaceIncident` com mapping de status (IN_ARBITRATION→EM_MEDIACAO, RETURN_OR_REFUND_REQUEST_PENDING→AGUARDANDO_VENDEDOR, REFUND_SUCCESS→RESOLVIDO, etc.); webhook `/webhooks/tiktok` com HMAC `app_key+timestamp+rawBody` (header `x-tts-signature`), routing por `type` (ORDER_STATUS_CHANGE/RETURN_STATUS_CHANGE/REVERSE_ORDER_STATUS_CHANGE/SHIPMENT_INFO_CHANGE); cron **10 min** fallback (orders + returns). Adapter `TikTokService` **bloqueia envio de texto livre** — TikTok Shop não expõe chat livre via API (limitação inerente). Endpoints `/integracoes/tiktok/oauth/{start,callback}` + `/webhooks/tiktok`.

**Inbox/Incidentes — modelo SAC unificado**
- `Conversation.categoria` (enum `ConversationCategoria`): `GERAL`, `PRE_VENDA`, `POS_VENDA`, `RECLAMACAO`, `MEDIACAO`, `DEVOLUCAO`, `DISPUTA`. Default `GERAL`.
- `Conversation.metadata` (JSON): contextos canal-específicos (ML packId/itemId/buyerId, claimId, etc.)
- `Conversation.incidentId` (FK): vincula chat a um `MarketplaceIncident` quando aplicável
- **`MarketplaceIncident`** novo modelo: reclamações/devoluções/mediações/disputas/cancelamentos. Canal-agnóstico (`MARKETPLACE_ML/SHOPEE/AMAZON/TIKTOK`), status unificado (`ABERTO/AGUARDANDO_VENDEDOR/AGUARDANDO_COMPRADOR/EM_MEDIACAO/RESOLVIDO/EXPIRADO/CANCELADO`), prazoResposta (SLA do marketplace), valor/valorReembolso. Endpoint `/marketplace/incidentes` com filtros (canal, tipo, status, aguardandoMim, prazoUrgente) + `/resumo` pra dashboard.

**MullerBot — limitações conhecidas (MVP):**
- Keyword scoring funciona bem ≤500 produtos por empresa. Volume maior pede embeddings (pgvector) — interface `ProdutoSearchService.buscar` está pronta pra trocar sem mudar callers.
- Sem cache de respostas — toda pergunta gera chamada ao LLM.
- Sem histórico de conversação — cada pergunta é independente (stateless). Próxima sessão pode adicionar contexto da `Conversation` da Inbox quando integrado lá.

**WhatsApp Baileys — limitações conhecidas (MVP):**
- 1 socket por empresa em 1 container — não escala horizontalmente sem gateway (Railway com 1 réplica está ok)
- Apenas 1:1 (grupos e broadcasts ignorados)
- Mídia recebida: marca `tipo=IMAGE/AUDIO/etc` e `mediaMime`, mas conteúdo fica como placeholder (`[imagem]`, `[áudio]`) — download de mídia + Supabase Storage entra depois
- Risco de ban do número pela Meta — usar número dedicado, não pessoal

**OMIE — modo de operação**
- `OMIE_DEMO_MODE=true` (default): retorna dados mock (3 clientes/3 produtos) sem chamar API real — permite dev sem credenciais
- `OMIE_DEMO_MODE=false` + `OMIE_APP_KEY`/`OMIE_APP_SECRET` no env (OU `IntegracaoConexao` por empresa, que tem precedência): chama API real
- `OMIE_WEBHOOK_SECRET` ativo → webhook exige `x-omie-signature` válido (HMAC SHA-256 do body cru). Sem secret: aceita com warning (apenas dev)
- Pedido vai a OMIE via `POST /pedidos/:id/enviar-omie` → `OmiePedidosService.enviarPedido` (status → ENVIADO_OMIE, persiste numeroOmie + enviadoOmieEm)
- Webhook `cliente-status` atualiza `Cliente.omieStatus` (ATIVO|BLOQUEADO) sem disparar lógica adicional

### Fase 7 — Automação (concluída)
- [x] **Fluxos de Automação** (`@modules/fluxos`) — sistema completo com BullMQ (D44):
  - Schema: `Fluxo`, `FluxoNo`, `FluxoEdge`, `FluxoExecucao`, `FluxoExecucaoLog` + 5 enums
  - CRUD + ativar/pausar/arquivar + validação de grafo (trigger único, arestas válidas, acaoTipo obrigatório)
  - `FluxoEventBusService` — ponte evento → BullMQ, falha silenciosa (não derruba op. principal)
  - `FluxoExecutorService` — motor passo-a-passo: interpola `{{variáveis}}`, avalia condições, executa 7 tipos de ação
  - `FluxoExecutorProcessor` — worker BullMQ (concorrência 5, retry exponencial)
  - `FluxoTriggersJob` — cron `*/30 * * * *` dispara CLIENTE_INATIVO_30D + AMOSTRA_FOLLOWUP
  - Triggers: LEAD_CRIADO, LEAD_ETAPA_MUDOU, PEDIDO_APROVADO, PEDIDO_ENTREGUE, OCORRENCIA_ABERTA, CLIENTE_INATIVO_30D, AMOSTRA_FOLLOWUP, CRON_AGENDADO
  - Ações: ENVIAR_WHATSAPP, ENVIAR_EMAIL, CRIAR_TAREFA, MUDAR_TAG, MOVER_LEAD_ETAPA, ATRIBUIR_REP, WEBHOOK_EXTERNO
  - DELAY nodes com unidade (minutos/horas/dias) via BullMQ `delay`
  - CONDICAO nodes bifurcam por label "true"/"false"
  - Endpoints REST: CRUD, ativar/pausar/arquivar, execuções, teste manual, métricas
  - `BullModule.forRootAsync` registrado no AppModule com `REDIS_URL` do env
  - Testes: 17 specs (FluxosService + interpolate helper)

### Fase 8 — Polimento
- [ ] Relatórios + KPIs
- [ ] Deploy Railway + Supabase em produção
- [ ] CI/CD

### Frontend (Fase paralela)
- [ ] Reescrita Next.js do protótipo HTML monolítico
- [ ] Integração com todas as APIs do backend

## 7. Como rodar localmente

```powershell
cd C:\Users\Dell\dev\betinna\backend
# Node v24+ via C:\Program Files\nodejs (não está no PATH; usar npm.cmd direto)
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run db:push
& "C:\Program Files\nodejs\npm.cmd" run db:seed
& "C:\Program Files\nodejs\npm.cmd" run start:dev
```

**Credenciais admin (criadas pelo seed):**
- Email: `admin@betinna.ai`
- Senha: `Betinna@2026`

**Endpoints:**
- `GET /api/v1/health` (público)
- `GET /docs` (Swagger)
- `GET /api/v1/auth/me` (validar token)

**Login via Supabase** (pra testar API com token real):
```powershell
$body = @{ email = "admin@betinna.ai"; password = "Betinna@2026" } | ConvertTo-Json
$r = Invoke-RestMethod -Method POST `
  -Uri "https://grdiuggfklaoqhvnctto.supabase.co/auth/v1/token?grant_type=password" `
  -Headers @{ "apikey" = "<ANON_KEY de .env.local>"; "Content-Type" = "application/json" } `
  -Body $body
$token = $r.access_token
```

## 8. Notas operacionais

- **Windows execution policy** bloqueia `npm` direto no PowerShell. Sempre usar `& "C:\Program Files\nodejs\npm.cmd"`.
- **Bash** disponível (Git Bash) — usado pra comandos git.
- **Prisma generate em Windows**: se o server está rodando, a DLL fica locked. Matar `node` antes de regenerar.
- **GitHub user.email / user.name** configurados localmente nesse repo como `dev@betinna.ai`/`Betinna Dev` (mudar pra valores reais quando o cliente quiser).

## 9. Pendências conhecidas

**Resolvidas em 2026-05-17 (cleanup):**
- ✅ `npm audit` agora retorna 0 vulnerabilidades em backend e frontend (deps atualizadas pelos commits da semana).
- ✅ Frontend já está em Vite + React (não é mais HTML monolítico — `betinna.html` é só protótipo de referência UX).
- ✅ ENCRYPTION_KEY: schema valida formato (64 hex) e `EnvService.auditProductionReadiness()` chamado em `main.ts` detecta keys óbvias (tudo zero, sequência, repetição) — alerta em dev, aborta boot em prod.
- ✅ SUPABASE_JWT_SECRET: D44 (sprint anterior) ativou auto-detecção HS256/RS256/ES256 — auth funciona com OU sem secret. Audit no boot loga warning quando vazio.
- ✅ OMIE `tabela_de_preco`: heurística 70% agora é configurável via env `OMIE_PRECO_FABRICA_RATIO` (0–1, default 0.7). TODO no código pra substituir pela leitura real quando cliente configurar tabelas auxiliares.

**Pendências ativas:**
- OMIE `tabela_de_preco`: ratio configurável mas ainda heurístico — ler `precoFabrica` real de tabela auxiliar quando cliente fornecer credenciais OMIE com tabelas.
- BOOTSTRAP_TOKEN: endpoint `/auth/bootstrap` se desabilita após 1º usuário (first-run check), mas vale apagar a env var em produção depois de validar.

## 10. Estilo de comunicação preferido

- **Direto, sem rodeios**
- **Português brasileiro** (mas comentários técnicos podem ficar em inglês quando padrão da comunidade)
- **Mostrar progresso real** — não inventar features
- **Validar antes de afirmar que funciona** (build + test + curl)
- **Commitar frequente** quando uma feature está completa e validada
