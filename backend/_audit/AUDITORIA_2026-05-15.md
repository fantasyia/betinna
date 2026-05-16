# 🔒 Auditoria Completa Pré-Deploy — Backend Betinna.ai

**Data:** 2026-05-15
**Modelo:** Claude Opus 4.7 max
**Escopo:** 60+ services, 13 integrações externas, 50 modelos Prisma, 9 módulos novos (Campanhas/Relatórios/Fluxos/Marketplaces)
**Auditores:** 7 agentes especializados em paralelo + análise direta

---

## 📊 SUMÁRIO EXECUTIVO

| Severidade | Total | Critério |
|---|---|---|
| 🔴 **P0** | **44** | Vazamento confirmado / exploit ativo / perda direta de dado ou dinheiro |
| 🟠 **P1** | **80** | Inconsistência grave / UX prejudicada / defesa em profundidade ausente |
| 🟡 **P2** | **57** | Hardening / consistência / cosmético |
| **TOTAL** | **181** | findings |

**🚫 Veredicto:** O backend **NÃO está pronto para deploy em produção**. 44 vulnerabilidades P0 confirmadas — qualquer uma delas pode causar vazamento entre tenants, perda de dinheiro, duplicação de cobrança, banimento da Meta, ou exploit de webhook.

**✅ Boa notícia:** A arquitetura está sólida. Quase todos os fixes são localizados (não há refactor estrutural necessário). Estimativa para limpar todos os P0: **~10-15 dias de trabalho focado**.

---

## 🎯 OS 10 BUGS MAIS CRÍTICOS (corrigir HOJE)

| # | Bug | Arquivo | Impacto |
|---|---|---|---|
| 1 | `ComissoesService` sem filtro empresaId | `comissoes.service.ts:46-96` | ADMIN vê comissões de TODOS os tenants |
| 2 | `bulkAssignRep` sem role gate | `clientes.service.ts:226` | REP rouba carteira em massa |
| 3 | OMIE/Meta/Shopee/TikTok webhooks aceitam sem secret | múltiplos | Atacante injeta eventos falsos |
| 4 | ML webhook bypass via X-Forwarded-For | `ml-webhook.controller.ts:173` | IP whitelist contornável |
| 5 | AuthGuard 2 queries/request sem cache | `auth.guard.ts:45-83` | Vai saturar pool Supabase |
| 6 | `gerarNumeroPedido` race + scan | `pedidos.service.ts:478` | 500 errors + Proposta cross-tenant |
| 7 | Idempotência envio campanha quebrada | `campanha-envio.processor.ts:114` | Retry duplica WhatsApp/email |
| 8 | Cron sem singleton lock | múltiplos `*.job.ts` | Duplicação em rolling deploy |
| 9 | FluxoExecutor sem empresaId em ações | `fluxo-executor.service.ts:310+` | Cross-tenant write |
| 10 | Comissão GERENTE snapshot sobrescrito | `comissoes.service.ts:218-247` | Comissão histórica corrompida |

---

## 1️⃣ P0 — VAZAMENTOS MULTI-TENANT (13 findings)

### 1.1 `ComissoesService` totalmente sem filtro de empresa
**Arquivos:** `src/modules/comissoes/comissoes.service.ts:46-83, 85-96, 273-298, 305-342`

`Comissao` no schema **NÃO TEM coluna `empresaId`**. Única chave é `(representanteId, ano, mes)`. Métodos `list`, `findById`, `marcarPago`, `desmarcarPago`, `resumoDoRep` filtram apenas por `representanteId/scope` — sem amarração com empresa ativa.

**Cenário:** ADMIN/DIRECTOR/SAC (`scope === null`) chamando `GET /comissoes` recebe comissões de TODOS os tenants. ADMIN A pode marcar como pago comissão de rep da empresa B.

**Fix:**
1. Migration: `ALTER TABLE "Comissao" ADD COLUMN "empresaId"` + backfill
2. Filtrar `representante: { empresas: { some: { empresaId } } }` interinamente

### 1.2 `AgendaService` vaza cross-tenant
**Arquivos:** `src/modules/agenda/agenda.service.ts:102-115, 117-162, 164-183`

`findById/update/delete` usam `findUnique({ where: { id } })` sem checar empresaId. `AgendaItem` sem coluna `empresaId` própria.

**Cenário:** GERENTE da empresa A consegue ler/editar AgendaItem de qualquer empresa se souber o ID.

**Fix:** Adicionar `empresaId` ao schema OU filtrar via `usuario.empresas`.

### 1.3 `FluxoExecutor` ações sem validação de empresa
**Arquivos:** `src/modules/fluxos/fluxo-executor.service.ts:310-323, 333-369, 401-467`

`acaoEnviarWhatsapp`, `acaoEnviarEmail`, `acaoCriarTarefa`, `acaoMudarTag`, `acaoMoverLeadEtapa`, `acaoAtribuirRep` — TODAS fazem `findUnique/update` por `id` sem filtrar `empresaId`.

**Cenário:** Contexto de fluxo manipulado/malformado dispara ação em cliente/lead de outra empresa.

**Fix:** Validar `{ id, empresaId }` em cada ação.

### 1.4 `Tag` globalmente única — cross-tenant
**Schema:** `prisma/schema.prisma:390-403`

```prisma
model Tag {
  nome  String @unique  // ← GLOBAL, não por empresa
}
```

Empresa A muda tag "VIP" → afeta classificação de clientes da empresa B com mesmo nome de tag.

**Fix:** Adicionar `empresaId` em Tag + `@@unique([empresaId, nome])` + migration.

### 1.5 `PricingService` sem empresaId
**Arquivo:** `src/modules/produtos/pricing.service.ts:38-51, 56-103, 109-161`

`priceFor`, `priceForClient`, `priceForClientBatch` fazem `produto.findUnique({ id })` global.

**Cenário:** REP em pedido passa produtoId de empresa B → preço retornado + pedido criado com produto cross-tenant.

**Fix:** Passar `empresaId` como obrigatório.

### 1.6 `PedidosService.resolveItens` e `PropostasService.resolveItens`
**Arquivos:** `pedidos.service.ts:429-433`, `propostas.service.ts:319-322`

`findMany({ where: { id: { in: produtoIds } } })` sem empresaId.

### 1.7 `InboxService.listMensagens` anchor sem checagem
**Arquivo:** `src/modules/inbox/inbox.service.ts:148-152`

Cursor de paginação aceita `antesDe` de qualquer mensagem do sistema.

### 1.8 `Empresas` endpoint sem checar pertencimento
**Arquivo:** `src/modules/empresas/empresas.controller.ts:44-49`

`@Roles('ADMIN', 'GERENTE')` sem checar `empresaIds.includes(id)`. GERENTE da empresa A consegue ler dados da empresa B via `GET /empresas/<id>`.

### 1.9 `RelatoriosService.repWhere` aceita repId de outra empresa
**Arquivo:** `src/modules/relatorios/relatorios.service.ts:60-62`

Para ADMIN/DIRECTOR, aceita `paramRepId` sem validar que rep pertence à `empresaIdAtiva`.

### 1.10 `IncidentsService.atualizarStatus` sem empresa
**Arquivo:** `src/modules/incidents/incidents.service.ts:237-256`

`update where: { canal_externalId }` sem filtrar empresa — webhook spoofed atualiza incident de outra empresa.

### 1.11 Comissão GERENTE/REP em multi-empresa
Se um usuário pertence a múltiplas empresas, `Comissao @@unique([representanteId, ano, mes])` colide entre empresas.

### 1.12 `UsersService.list/findById` filtro de empresa frágil
**Arquivo:** `src/modules/users/users.service.ts:47-91`

Depende de `params.empresaId` vindo do frontend. GERENTE pode passar `?empresaId=<outra>` se controller não checar.

### 1.13 `setRepDiscountLimit / setComissaoPercentual` sem assertEmpresa
**Arquivo:** `src/modules/users/users.service.ts:194-212`

Permite admin global mudar dados de user de qualquer tenant.

---

## 2️⃣ P0 — WEBHOOKS & CRIPTOGRAFIA (4 findings)

### 2.1 Webhooks aceitam sem assinatura quando secret vazio
**Arquivos:**
- `src/integrations/omie/omie-webhook.controller.ts:61-72`
- `src/integrations/meta/meta-webhook.controller.ts:90-99`
- `src/integrations/shopee/shopee-webhook.controller.ts:66-78`
- `src/integrations/tiktok/tiktok-webhook.controller.ts:61-72`

Padrão repetido: `if (secret) validar; else warn + aceitar`. Em `env.schema.ts` os secrets são `optional().default('')`. Produção sem secret → endpoint público arbitrário.

**Exploit OMIE:** POST → muda `Cliente.omieStatus` para BLOQUEADO (bloqueia pedidos do cliente).
**Exploit Meta:** Injeta `MetaMessagingEvent` na Inbox.
**Exploit Shopee/TikTok:** Idem.

**Fix:** Validar no env schema que em `NODE_ENV=production` os secrets são obrigatórios.

### 2.2 ML webhook IP whitelist bypass via X-Forwarded-For
**Arquivo:** `src/integrations/mercadolivre/ml-webhook.controller.ts:173-178`

Express sem `trust proxy`. Atacante envia `X-Forwarded-For: 54.88.218.97` e contorna whitelist. ML não tem HMAC oficial — esta é a única proteção.

**Fix:**
1. `app.set('trust proxy', '<railway ranges>')` em `main.ts`
2. Usar `req.ip`
3. Adicionar shared secret no path: `/webhooks/mercadolivre/<random-token>` por empresa

### 2.3 CryptoUtil decifragem vaza erro detalhado
**Arquivos:** `integracoes.service.ts:184-189`, `usuario-integracoes.service.ts:148-153`

Mensagem "Unsupported state or unable to authenticate data" exposta via HTTP. Dá oracle de padding/tag.

**Fix:** Mensagem genérica ao cliente; detalhes só no log interno.

### 2.4 OAuth callbacks expõem `err.message` em HTML retornado
**Arquivos:** todos `*-oauth.controller.ts`

Em produção pode vazar parte de erro do upstream (`Meta /token HTTP 400: invalid client_secret`).

---

## 3️⃣ P0 — REPSCOPE / CARTEIRA (6 findings)

### 3.1 REP rouba carteira em massa via `bulkAssignRep`
**Arquivos:** `src/modules/clientes/clientes.service.ts:226-242` + `clientes.controller.ts:108-115`

Sem `@Roles`. REP tem `clientes:edit`. `updateMany` filtra só por `empresaId` — REP passa IDs de clientes de outros REPs e reatribui em massa.

**Fix:**
```typescript
@Roles('ADMIN', 'DIRECTOR', 'GERENTE')
```
+ aplicar `RepScopeService.getRepIds` no `updateMany` para GERENTE só reatribuir entre seus reps.

### 3.2 REP transfere cliente via `update` ou `assignRep`
**Arquivos:** `clientes.service.ts:172-207, 210-224`

`updateClienteSchema` aceita `representanteId`. REP em update troca o rep do próprio cliente.

### 3.3 Mesmo padrão em `LeadsService.update / atribuirRep`
**Arquivos:** `leads.service.ts:168-187, 243-257`

### 3.4 CampanhasService: REP atinge toda a base da empresa
**Arquivo:** `campanhas.service.ts:375-419`

`resolverDestinatarios` aceita `segClienteIds/segRepIds/segTagIds` do DTO sem validação. Se REP recebe permissão `campanhas:create`, dispara para TODA base.

### 3.5 RelatoriosService SAC/Campanhas/Amostras sem RepScope
**Arquivo:** `relatorios.service.ts:370-460, 464-549, 553-601`

Filtram apenas por `empresaId`. GERENTE vê KPIs de toda empresa.

### 3.6 AgendaService visibility — GERENTE vê qualquer agenda
**Arquivo:** `agenda.service.ts:239-255`

`podeVisualizarOutros` retorna true para GERENTE sem checar carteira.

---

## 4️⃣ P0 — BULLMQ / RACE CONDITIONS (7 findings)

### 4.1 Duplicação de WhatsApp/Email em retry — CampanhaEnvioProcessor
**Arquivo:** `src/modules/campanhas/campanha-envio.processor.ts:114-141`

Sequência: envia → update status. Se update falha após envio, retry reenvia. Sem retry hoje (P0-5 abaixo) mas P0-4.

**Fix:** Status `ENVIANDO` antes do envio + `update where status=ENVIANDO`.

### 4.2 Duplicação de email em retry — FluxoExecutor
**Arquivo:** `src/modules/fluxos/fluxo-executor.service.ts:159-185`

Mesmo padrão. SendGrid 202 → processo morre → retry → email 2x.

### 4.3 Race em `disparar` campanha
**Arquivo:** `campanhas.service.ts:211-271`

Sem unique constraint em `(campanhaId, clienteId)`. Sem lock otimista. 2 cliques rápidos = duplicação.

**Fix:** `@@unique([campanhaId, clienteId])` + `updateMany({ where: { id, status: { in: [...] } } })` como claim.

### 4.4 CampanhaEnvioProcessor sem retry — falha vira ERRO permanente
**Arquivo:** `campanhas.service.ts:257-265`

`queue.add` sem `attempts/backoff`. Default BullMQ = 1 tentativa.

### 4.5 Cron sem singleton lock — duplicação em rolling deploy
**Arquivos:** todos `*.job.ts`

Rolling deploy Railway = 2 réplicas momentâneas = todos crons executam 2x. `ComissoesFechamentoJob` duplica registros; `CampanhaSchedulerJob` re-dispara campanha.

**Fix:** Migrar para BullMQ `repeatable jobs` (lock nativo) OU implementar `LockedCronDecorator` com `SETNX`.

### 4.6 OMIE sync race com `ultimoSync`
**Arquivos:** `omie-clientes.service.ts:107`, `omie-produtos.service.ts:99`

Cron + manual em paralelo → último a gravar `ultimoSync` ganha → janela cega.

### 4.7 `fecharMes` não atômico
**Arquivo:** `comissoes.service.ts:105-271`

`groupBy` → `$transaction 1` → query usuarios → `$transaction 2`. Entre elas, pedido pode mudar.

**Fix:** Única `$transaction` + `pg_advisory_lock(empresaId, mes, ano)`.

---

## 5️⃣ P0 — PERFORMANCE CRÍTICA (4 findings)

### 5.1 AuthGuard sem cache — 2 queries por request
**Arquivo:** `auth.guard.ts:45-48, 81-83`

A cada request: `prisma.usuario.findUnique({ include: empresas })` + `update ultimoAcesso`. Em B2B com várias req/s → satura PgBouncer Supabase em minutos.

**Fix:** Cache `AuthenticatedUser` por token (TTL 30-60s) + batch flush de `ultimoAcesso`.

### 5.2 `kanban()`, `facets()`, `listMyCatalog` sem paginação
**Arquivos:** `leads.service.ts:111-127`, `produtos.service.ts:168-181`, `catalogo.service.ts:70-97`

`findMany` em TODOS ativos. Com 10k leads → 50MB+ payload.

### 5.3 Sync OMIE/ML/Shopee com N+1
**Arquivos:** `omie-clientes.service.ts:80-100`, `omie-produtos.service.ts:79-94`, `ml-orders.service.ts`, `shopee-orders.service.ts`

`findUnique + update/create` um a um. 500 produtos × 50 empresas × 144 syncs/dia ≈ 25k roundtrips por 10min.

### 5.4 `gerarNumero*` com `count + 1` (race + scan)
**Arquivos:**
- `pedidos.service.ts:478-482`
- `propostas.service.ts:350-353` (⚠️ Proposta.numero é @unique GLOBAL — cross-tenant collision!)
- `ocorrencias.service.ts:398-401`

Race condition + scan crescente. Sem lock = 2 creates concorrentes geram MESMO numero.

**Fix:** Model `EmpresaSequence(empresaId, recurso, atual)` com `UPDATE ... RETURNING atual+1` atômico. `Proposta.numero` precisa virar `@@unique([empresaId, numero])` (corrige cross-tenant também).

---

## 6️⃣ P0 — LÓGICA DE NEGÓCIO (11 findings)

### 6.1 Comissão GERENTE: snapshot sobrescrito no reprocessar
**Arquivo:** `comissoes.service.ts:218-247`

Reprocessar mês re-lê `Usuario.comissaoPadrao` e grava. Se admin alterou %, snapshot histórico é perdido.

**Fix:** No reprocess, manter `percentual` existente; re-gravar só `totalVendas/totalComissao`.

### 6.2 Comissão REP: `percentual` NUNCA gravado
**Arquivo:** `comissoes.service.ts:173-184` (create)

Bloco `create` do REP não inclui `percentual`. Valor histórico perdido para sempre.

### 6.3 Pedido cancelado após fechamento ≠ estorno
**Arquivos:** `pedidos.service.ts:314-333` + `comissoes.service.ts`

Cancelar muda só status. Sem estorno automático em mês já pago. **Dinheiro pago indevidamente.**

**Fix:** Bloquear cancelamento de pedido com comissão paga, ou criar `ComissaoAjuste` no mês corrente.

### 6.4 `marcarPago` não idempotente — race condition
**Arquivo:** `comissoes.service.ts:273-287`

Duas requests simultâneas → 2 updates → 2 `pagoEm` registrados.

**Fix:** `updateMany({ where: { id, pago: false }, ... })` + verificar count.

### 6.5 Reprocessar mês não apaga comissões órfãs
Reps que saíram da empresa após fechamento mantêm registro com valores velhos.

### 6.6 Pricing: preço negociado expirado silenciosamente trocado
**Arquivo:** `pricing.service.ts:73-92, 138-148`

`vigente=false` → retorna preço de tabela sem avisar rep. Cliente recebe NF com valor inesperado.

### 6.7 `descontoGeral` salva % mas campo é Float nominal
**Arquivos:** `pedidos.service.ts:153`, `propostas.service.ts:131`

Schema `Pedido.descontoGeral: Float` ambíguo. Lugares que leem como R$ vão errar.

### 6.8 `gerarNumeroPedido / gerarNumero / Proposta` race condition
Já em 5.4. **Proposta.numero é @unique GLOBAL — cross-tenant collision.**

### 6.9 Aprovação não exige gerente DIRETO do rep
**Arquivo:** `aprovacoes.service.ts:94-148`

GERENTE B pode aprovar pedido de REP gerido por GERENTE A se cair no scope dele.

**Fix:** Validar `apr.representante.gerenteId === user.id` para GERENTE.

### 6.10 Proposta → Pedido: preços congelados, não reaplicados
**Arquivo:** `propostas.service.ts:198-259`

Proposta de janeiro com preço negociado P, em maio P mudou. Conversão usa P antigo.

### 6.11 ADMIN/GERENTE cria pedido sem `representanteId` → sem comissão
**Arquivo:** `pedidos.service.ts:135`

`representanteId = user.role === 'REP' ? user.id : null`. Pedido sem rep = nunca entra no fechamento (`representanteId: { not: null }`).

**Fix:** DTO aceita `representanteId` opcional, validar.

### 6.12 (BÔNUS) `ultimoPedidoEm` nunca é atualizado
**Arquivo:** `pedidos.service.ts`

Cron `CLIENTE_INATIVO_30D` filtra `ultimoPedidoEm < corte OR null`. Como nada atualiza esse campo, TODO cliente fica null → fluxo dispara pra todos a cada 30min.

**Fix:** Atualizar `Cliente.ultimoPedidoEm` em `pedidos.create` ou `enviarParaOmie`.

### 6.13 Amostra `CONVERTIDA` sem link pra pedido
**Schema + amostras.service.ts:** Sem campo `pedidoId`. Rastreabilidade amostra→pedido impossível.

---

## 7️⃣ P0 — ERROR HANDLING (5 findings)

### 7.1 `void this.bus.disparar(...)` sem `.catch` defensivo
**Arquivos:** `pedidos.service.ts:301`, `aprovacoes.service.ts:138`, `leads.service.ts:158, 231`, `ocorrencias.service.ts:214`

Se erro escapar do try interno do bus (ex: Redis fora durante boot), `void` engole → unhandledRejection → potencial crash do worker Node.

**Fix:** `void this.bus.disparar(...).catch(err => this.logger.warn(err))`.

### 7.2 `FluxoExecutorService` retry em erro permanente
**Arquivo:** `fluxo-executor.service.ts:159-190`

Cliente sem telefone → erro permanente → BullMQ tenta 3x → ruído + waste.

**Fix:** Marcar erros esperados como `PermanentExecutionError`; processor pula retry.

### 7.3 `IncidentsService.atualizarStatus.catch(() => null)`
**Arquivo:** `incidents.service.ts:242-256`

Engole erro do Prisma silenciosamente. Adapter loga "ok" enquanto banco está dessincronizado com marketplace.

### 7.4 Race em `responder` da Inbox
**Arquivo:** `inbox.service.ts:212-273`

2 operadores SAC respondendo simultâneo → cliente recebe 2 mensagens.

### 7.5 Race em `enviarParaOmie`
**Arquivo:** `pedidos.service.ts:336-373`

2 cliques rápidos → 2 pedidos criados no OMIE.

**Fix:** `updateMany({ where: { id, status: { notIn: ['ENVIADO_OMIE'] } }, data: { status: 'ENVIANDO_OMIE' } })` como claim atomic.

---

## 📋 PLANO DE REMEDIAÇÃO (10-15 dias)

### 🔥 Sprint 1 — BLOQUEIOS DE DEPLOY (2-3 dias)
**Não deploya sem completar.**

| Tarefa | Estimativa |
|---|---|
| Validar secrets de webhook obrigatórios em produção (env schema) | 1h |
| Configurar `trust proxy` no Express | 15min |
| AuthGuard cache em memória + batch ultimoAcesso | 4h |
| `bulkAssignRep` + REP edit blocking | 2h |
| CryptoUtil error message genérica | 15min |
| Adicionar `.catch()` em todos `void bus.disparar` | 1h |
| Status APROVADO_REP no Pedido (bloquear REP edit pós-aprovação) | 2h |
| `marcarPago` idempotente com `updateMany` | 30min |

### 🏗️ Sprint 2 — Vazamentos multi-tenant (3-4 dias)
| Tarefa | Estimativa |
|---|---|
| Migration: `empresaId` em `Comissao`, `AgendaItem`, `Tag` + backfill | 4h |
| PricingService recebe `empresaId` obrigatório | 2h |
| FluxoExecutor: validar empresaId em todas ações | 4h |
| RepScope nos 6 sub-relatórios (refatorar `repWhere`) | 3h |
| `Proposta.numero` virar `@@unique([empresaId, numero])` | 1h + migration |
| InboxService anchor com checagem | 30min |
| EmpresasController checa `empresaIds.includes` | 30min |

### ⚙️ Sprint 3 — BullMQ + Race conditions (3-4 dias)
| Tarefa | Estimativa |
|---|---|
| Idempotência envio campanha + fluxo (claim + externalId) | 1d |
| Migrar crons para BullMQ repeatable jobs | 1d |
| Model `EmpresaSequence` + atomic increment para numero* | 4h |
| `fecharMes` atomic com pg_advisory_lock | 2h |
| `enviarParaOmie` claim atomic | 1h |
| `disparar` campanha lock otimista | 1h |
| `@@unique([campanhaId, clienteId])` | 30min |

### 🚀 Sprint 4 — Performance (2-3 dias)
| Tarefa | Estimativa |
|---|---|
| Cache Inbox + telefoneSufixo indexado | 4h |
| Sync OMIE/Marketplaces em batch | 1d |
| Indexes compostos `[empresaId, criadoEm DESC]` | 1h |
| Dashboard cache 60-120s | 2h |
| `kanban`/`facets` paginados | 2h |

### 📐 Sprint 5 — Lógica de negócio (2-3 dias)
| Tarefa | Estimativa |
|---|---|
| Comissão usa `Usuario.comissaoPadrao` (não hardcoded 5%) | 1h |
| `Cliente.ultimoPedidoEm` atualizado em pedidos | 30min |
| Cooldown em `CLIENTE_INATIVO_30D` | 2h |
| `AMOSTRA_FOLLOWUP` usa campo separado | 1h |
| Cron expira propostas | 2h |
| SLA estourado → notificação automática | 4h |
| `Amostra.pedidoId` para rastreabilidade | 2h |
| Validação cross-field nos DTOs (datas, etc.) | 4h |
| SSRF protection em `acaoWebhookExterno` | 2h |
| Loop detection em fluxos | 2h |
| AppException em FluxoExecutor (substituir `throw new Error`) | 2h |

---

## 📑 RELATÓRIOS COMPLETOS (P1 e P2)

Os relatórios individuais de cada agente estão em:
- `tasks/a6520a46f9b8a0874.output` — Multi-tenant (7 P0, 11 P1, 6 P2)
- `tasks/af02db067dd752cf0.output` — Webhooks/Crypto (4 P0, 9 P1, 11 P2)
- `tasks/a583785f1657c2d9f.output` — RepScope (6 P0, 4 P1, 4 P2)
- `tasks/a19db3f41533468df.output` — BullMQ/Race (7 P0, 8 P1, 3 P2)
- `tasks/a677c00027a9c3fbc.output` — Performance (4 P0, 14 P1, 13 P2)
- `tasks/a30136c4e5b593efd.output` — Lógica de Negócio (11 P0, 18 P1, 7 P2)
- `tasks/a97f48e622d87846a.output` — Error Handling (5 P0, 16 P1, 13 P2)

---

## ✅ BOAS PRÁTICAS DETECTADAS (não regredir)

- **AuthGuard global** via `APP_GUARD` (defaults-secure)
- **AES-256-GCM** corretamente implementado em `CryptoUtil`
- **HMAC** com `timingSafeEqual` em `WebhookSignatureUtil`
- **OAuth state JWT** HS256 derivado da ENCRYPTION_KEY (jti + exp 5min)
- **Multi-tenant scope** correto em: clientes (com fix de carteira), pedidos, propostas, leads, ocorrências, amostras
- **Idempotência de Inbox** via `Message.@@unique(conversationId, externalId)`
- **Idempotência de Marketplace Incidents** via `@@unique(canal, externalId)`
- **Pino logger** com redação de campos sensíveis
- **AllExceptionsFilter** mascara stack em produção
- **Cron jobs** com try/catch por empresa (uma falha não derruba batch)
- **RepScopeService** centralizado evita drift entre módulos
- **Documentos** com sanitização de filename (`replace(/[^\w.\-]/g, '_')`)

---

## 🎬 PRÓXIMO PASSO RECOMENDADO

1. **Sentar para review desta auditoria** — você decide o que vira P0 imediato vs o que vira sprint
2. **Priorizar Sprint 1** (bloqueios de deploy) — 2-3 dias de trabalho focado
3. **Após Sprint 1 + 2 (multi-tenant)** → deploy em ambiente staging para testes
4. **Sprints 3-5 podem rodar em paralelo com frontend** sendo construído

**Veredicto pré-deploy:**
- ❌ Hoje: NÃO deploy
- ✅ Após Sprint 1 + 2: DEPLOY STAGING OK
- ✅ Após Sprint 3: DEPLOY PROD OK (com monitoramento ativo)
- ✅ Após Sprint 4 + 5: PRONTO PARA ESCALAR
