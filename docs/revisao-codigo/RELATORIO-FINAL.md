 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER# Relatório Final — Revisão de Código betinna.ai
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Data:** 12/06/2026 · **Base:** consolidação dos 14 batches (`batch-01` a `batch-14`)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Escopo coberto:** banco (schema), backend base, segurança/auth, shared, CRM, atendimento/bot, demais módulos, OMIE, WhatsApp/Evolution, 4 marketplaces, Meta/Google/e-mail, frontend base, componentes e páginas.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Legenda:** 🚨 quebra em produção · 🔴 vira problema ao crescer · 🟡 dívida técnica · 🟢 polimento
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER---
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER## 0. Status de Correção (atualizado 13/06/2026)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERRastreamento honesto do que **já foi corrigido e deployado** (branch `main` → Railway), com o hash
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERdo commit pra a análise profunda verificar. `✅ feito` · `🟡 parcial` · `⛔ pendente`. Legenda de
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERstatus reflete o que está **no código**, não intenção.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| Achado | Status | Commit | Observação pra verificação |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER|---|---|---|---|
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🚨1 Account takeover `/auth/welcome` | ✅ feito | `f35bfd1` | `welcomeFinalize` exige status `PENDENTE`; spec em `auth-session.service.spec.ts` (conta ATIVA recusada). |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🚨2 DIRECTOR edita/desativa empresa de outro tenant | ✅ feito | `7508064` | `assertCanManageEmpresa` no `empresas.service` (update/activate/deactivate); spec cross-tenant. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 A · `Pedido.numeroOmie` único global | ✅ feito | `faf50a9` | Migration `pedido_numero_omie_por_empresa` → `@@unique([empresaId, numeroOmie])`. Aplica no deploy via `migrate deploy`. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 A · `Conversation` sem `@@unique` real | ✅ já protegido (review errou) | `20260517010000_inbox_race_unique` (pré-existente) | **CORREÇÃO da revisão:** a trava única JÁ EXISTE desde 17/05 — dois índices únicos PARCIAIS (`..._unique_null` p/ proprietarioId IS NULL e `..._unique_owned` p/ IS NOT NULL). O batch 1/6 errou por ler só o `schema.prisma` (Prisma não declara índice parcial → invisível no schema). O `catch(P2002)` do `upsertConversation` FUNCIONA. A migration de consolidação (`NULLS NOT DISTINCT`) seria só cosmética com risco de prod → **NÃO feita de propósito**. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 A · Webhook OMIE resolve tenant sem `empresaId` | 🟡 parcial | `8e15f93` | **Guard** anti-cross-tenant (recusa `codigoOmie` ambíguo). Fix DURÁVEL (endpoint por empresa c/ token) **pendente** — precisa reconfigurar webhook no OMIE. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 A · `/metrics` `@Public` vaza por tenant | ✅ feito | `8b4bfcf` | Trocado por `@Roles('ADMIN')`. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 A · `empresaFilter` retorna `{}` pra ADMIN | ✅ feito | `d7f988f` | Escopa todos os papéis pela empresa ativa; specs em `auth-context`/`comissoes`/`tags` atualizadas. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 B · Webhook Evolution sem HMAC/anti-replay/timing-safe | 🟡 parcial | `cf18ae7`, `f5112c1` | Token timing-safe + anti-replay + **segredo migrado pra header**. HMAC-do-corpo **não se aplica** (Evolution não assina). Rota legada de URL ainda aceita até **re-parear** (depois remover). |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 B · Rate-limit de login burlável (XFF cru) | ✅ feito | `f31bad6` | `TenantThrottlerGuard.getTracker` usa `req.ip` (trust proxy=1); spec prova XFF forjado ignorado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 B · NPS público sem proteção | ✅ feito | `31fd0b1` | `@Throttle` por IP (submit 5/h, GET 30/min) + dedup idempotente por (pesquisa, IP). |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 C · Idempotência pedido OMIE (timeout pós-commit) | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 C · Aceite de proposta cria 2 pedidos (corrida) | ✅ feito | `81da1b3` | CAS atômico no `registrarDecisao` (updateMany com token no where + guard count===1); sequência consumida só pelo vencedor. Spec novo. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 C · `update()` de pedido fura aprovação de desconto | ✅ feito | `183d28b` | `update()` agora transiciona pra AGUARDANDO_APROVACAO + upsert da AprovacaoDesconto quando excede o teto (replica o `create`); notifica gerência ao entrar. 2 specs. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 C · Anti-spam do bot em memória de 1 instância | ✅ feito | `f3ea2a7` | `ehSpam` migrado pro Redis (eval Lua INCR+EXPIRE, janela 60s, fail-open). Compartilha entre api/worker e sobrevive a deploy. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 C · HttpClient re-tenta POST não-idempotente | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 D · Bot 6–8 queries + telefone `contains` sem índice | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 D · Sync OMIE 2 queries/registro | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 D · Frontend sem cache de dados | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 D · Listas grandes sem memo/virtualização | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 E · OAuth boilerplate duplicado (6 services) | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 E · `interpolar()` em 3 lugares | ✅ feito | `027a2d4` | Unificado em `@shared/utils/interpolate` (flag `ausenteVazio` preserva os 2 comportamentos); fluxo-executor re-exporta; 5 specs. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 E · `formatMoeda` reimplementado ~30× | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 E · Dois sistemas de estilo + dois diálogos | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 F · Penhasco de testes (frontend / evolution / módulos novos) | 🟡 parcial | (vários) | Adicionados specs onde foi corrigido: `auth-session`, `empresas`, `auth-context`, `tenant-throttler`, `evolution-webhook`, `nps.service`. Frontend continua **sem teste**; cobertura ampla segue pendente. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 G · `REDIS_URL` default localhost | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 G · body-parser 20mb global | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 G · Margem/custo = chute de 70% | ⛔ pendente | — | Não tocado (aguarda tabela de preço real do OMIE). |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🔴 H · Arquivos gigantes (InboxPage 3.106, FluxoEditor 2.736) | ⛔ pendente | — | Não tocado. |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Resumo:** os **2 🚨 fechados**; do Tema A (isolamento), 3 de 4 fechados (falta `Conversation`,
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERe o webhook OMIE está com guard mas sem o fix durável); Tema B (endurecimento de webhook/limites)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**100% fechado** (com a ressalva honesta de HMAC no Evolution e o re-parear pendente). Temas C–H
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERseguem **pendentes**.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Ações operacionais ainda necessárias do Leo:** (a) **re-parear o WhatsApp** (re-escanear QR) pra
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERativar o segredo-no-header e poder remover a rota de URL legada; (b) decidir sobre o **Item 1b**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER(`Conversation` unique) — começa com a consulta só-leitura de duplicatas.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER---
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER## 1. Resumo Executivo
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Estado geral: BOM (média ~8/10).** Para um SaaS B2B construído nessa velocidade, o código é
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERmaduro e disciplinado — não é um protótipo bagunçado. O backend é o ponto forte: multi-tenant
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERaplicado com consistência rara, dinheiro em `Decimal`, integrações externas (OMIE, marketplaces,
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERMeta) com tratamento de erro/retry/HMAC de quem já apanhou em produção, e **cobertura de teste
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERforte no backend**. Cada decisão difícil tem o comentário com a história do bug que a originou.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Principais pontos fortes:** isolamento por empresa + carteira (RepScope) bem-feito; webhooks dos
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERmarketplaces com HMAC/anti-replay em tempo constante; idempotência de mensagem robusta; FinOps do
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERbot (teto de custo) embutido; design system novo (`ui/`) bem construído; padrões de front
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERamplamente adotados (`useApiQuery`, `StateView`).
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Principais pontos fracos:** (1) **dois furos de isolamento/auth** que só não viraram incidente
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERporque hoje há ~1 tenant ativo; (2) **frontend sem nenhum teste** (~45k linhas) e com regra de
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERnegócio/dinheiro dentro de componentes; (3) **duplicação estrutural** que vai divergir ao crescer
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER(OAuth 6×, formatar dinheiro 30×, dois sistemas de estilo); (4) **arquivos gigantes** (InboxPage
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER3.106 linhas, FluxoEditor 2.736).
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Risco de quebrar em produção: MÉDIO.** Baixo para a operação atual (1 tenant, volume pequeno).
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERSobe para **ALTO no dia do 2º cliente pagante**: os dois 🚨 e vários 🔴 são bombas de isolamento
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERmulti-tenant — invisíveis com uma empresa, incidentes de segurança com duas. Antes de vender pro
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERsegundo cliente, os itens 🚨 + Tema A abaixo são pré-requisito.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER> **Atualização 13/06/2026 (ver Seção 0):** os **2 🚨 já foram corrigidos e deployados**, junto com
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER> o grosso dos Temas A e B. O risco residual pro 2º tenant agora se concentra em **1 item de Tema A
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER> ainda aberto** — a trava única da `Conversation` (Item 1b) — e no **fix durável do webhook OMIE**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER> (hoje só com guard). Temas C–H seguem pendentes. O texto abaixo é o **snapshot da revisão
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER> original** (não reescrito); a Seção 0 é a fonte da verdade do que está corrigido.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER---
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER## 2. Achados Críticos (consolidado, priorizado)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER### 🚨 Quebra em produção (corrigir ANTES do 2º tenant — exploráveis hoje)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| # | Achado | Origem |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER|---|---|---|
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🚨1 | **Account takeover via `/auth/welcome`** — `welcomeFinalize` troca a senha de **qualquer** conta com um access token válido, sem checar se o status é `PENDENTE`. Um XSS (ou um usuário logado mal-intencionado) consegue resetar a senha de outra conta e tomá-la em definitivo. | batch-03 |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER| 🚨2 | **DIRECTOR edita/DESATIVA qualquer outra empresa** — `empresas.controller` (`@Patch/@Delete/@Put ativar`) checa só o **papel** (`DIRECTOR`), nunca o **vínculo** com a empresa. Como DIRECTOR é papel de cliente pagante, o diretor do tenant A pode, por request direto à API, trocar CNPJ/razão social do tenant B ou **desativar o tenant inteiro do concorrente**. O padrão certo (`assertCanManageLogo`) existe no mesmo módulo — só não foi aplicado nos endpoints perigosos. | batch-05 |
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER> Ambos são "seguros por acidente" (1 tenant). Com o segundo cliente, são incidentes de segurança/LGPD.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER### 🔴 Vira problema ao crescer (agrupado por tema)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema A — Isolamento multi-tenant frágil (a maior categoria de risco):**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 `Pedido.numeroOmie @unique` **global** e `Conversation` **sem `@@unique` real** (só índice) — corrida cria conversa duplicada; o `catch(P2002)` do código espera uma trava que **não existe no banco**. *(batch-01, batch-06)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Webhook OMIE resolve o tenant por `codigoOmie` sem `empresaId`** (`findFirst`) — no 2º cliente, um "cliente 1001 bloqueado" pode marcar BLOQUEADO o cliente da **empresa errada**. *(batch-08)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`/metrics` `@Public()` expõe métricas com label `empresa`** — qualquer um na internet lê dados por tenant. *(batch-04)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`empresaFilter(user)` retorna `{}` para ADMIN** — lista de agenda/prompts/comissões/tags mistura **todas** as empresas. *(batch-04)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema B — Endurecimento de webhook/rate-limit inconsistente:**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Webhook do Evolution (provider de WhatsApp ATIVO) só se protege por um token na URL** — sem HMAC do corpo, sem anti-replay, com `!==` não timing-safe. Se a URL vazar, dá pra **injetar mensagem falsa na inbox e disparar o bot**. Contrasta com os 4 marketplaces, que fazem certo. *(batch-09)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Rate-limit de login burlável** — o tracker usa `x-forwarded-for` cru em vez de `req.ip` (com trust proxy). *(batch-03)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **NPS público sem proteção própria** — script enche o banco e **adultera a métrica de NPS** do cliente. *(batch-07)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema C — Idempotência / correção sob concorrência:**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Idempotência do pedido OMIE com ponto cego** — se o OMIE cria o pedido mas a resposta se perde (timeout), o status local fica eterno `RASCUNHO` e o re-envio não reconcilia (trata "já existe" como erro fatal). *(batch-08)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Aceite público de proposta tem corrida** — duplo-clique cria **2 pedidos** (checagem do token fora da transação). *(batch-05)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Editar pedido fura a aprovação de desconto** — `update()` exige motivo mas não muda status pra `AGUARDANDO_APROVACAO`; desconto acima do teto chega ao ERP sem o gerente ver. *(batch-05)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Anti-spam do bot em memória de 1 instância** — zera a cada deploy, não compartilha entre réplicas, cresce sem limpeza. *(batch-06)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`HttpClientService` re-tenta POST não-idempotente** (DEFAULT_RETRIES=3) — risco de duplicar efeito em integração externa. *(batch-04)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema D — Performance latente (invisível hoje, lenta ao crescer):**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Cada mensagem recebida dispara 6–8 queries de gate**, duas com **busca de telefone por `contains` sem índice** (full scan) — explode quando uma campanha de 500 leads responder. *(batch-06, batch-01)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Sync OMIE faz 2 queries por registro em série** (find + create/update) quando o mapper já entrega pronto pro `upsert`. *(batch-08)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Frontend sem cache de dados** — cada troca de tela re-fetcha (o próprio `useApiQuery` admite "dropa TanStack quando precisar"). *(batch-12)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Listas grandes sem memo/virtualização** — `React.memo` em 0 páginas; tabelas de 1.800+ linhas re-renderizam tudo a cada tecla. *(batch-14)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema E — Duplicação estrutural que vai divergir:**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Boilerplate de OAuth copiado em 6 services** (ML, Shopee, Amazon, TikTok, Meta, Google) — `signState` byte-a-byte idêntico; endurecer CSRF/token = 6 edições (e já houve drift). *(batch-10, batch-11)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`interpolar()` `{{var}}` copiada em 3 lugares** — dois deles montam mensagem que vai pro WhatsApp do cliente. *(batch-07)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Formatar dinheiro reimplementado ~30×** no front (sem `formatMoeda` em `lib/`) — formato inconsistente num CRM que exibe margem/comissão. *(batch-14)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Dois sistemas de estilo coexistem (21/21 páginas)** e **dois primitivos de diálogo** (`Modal` legado vs `ui/Dialog`) — toda mudança/correção feita 2×. *(batch-13)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema F — Penhasco de testes:**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Frontend inteiro sem teste** — `lib/api`, `auth-store`, hooks, componentes, ~45k linhas de páginas (com conta de dinheiro): **0 specs**. *(batch-12, batch-13, batch-14)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`evolution/` (provider de WhatsApp em produção) sem nenhum teste**. *(batch-09)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Módulos novos sem spec** — `segmentos`, `metas` (número da diretoria), `nps` (público). *(batch-07)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema G — Config/ops footguns:**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`REDIS_URL` com default `localhost`** — prod sem a var sobe "funcionando" e quebrado. *(batch-02)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **`body-parser` global de 20mb** vale também pros webhooks públicos (superfície de DoS). *(batch-02)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **Margem/custo = chute de 70%** (`precoFabrica = precoTabela × 0.7`) — número inventado que **parece** real na tela. *(batch-08)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER**Tema H — Arquivos gigantes:**
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- 🔴 **InboxPage 3.106 linhas** (app de chat inteiro: lista + thread + composer + gravador de voz + bot) e **FluxoEditor 2.736** — 12 páginas passam de 1.000 linhas. *(batch-14)*
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER### 🟡 Dívidas técnicas (resumo — detalhe em cada batch)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDEREstado de cron no JSON de config; FKs soltas no schema; cache de permissões não sincroniza entre
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERréplicas; `fluxo-executor` (1.060) e `users` (1.593) e `whatsapp-session` (1.239) grandes demais;
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERretry decidido por **texto** do erro (OMIE, WhatsApp); CNPJ alfanumérico (julho/2026) a propagar em
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER~7 pontos; teto de custo do bot com 4 campos e 2 usados; `MULLERBOT_MOCK`/`OMIE_DEMO` não auditados
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERno boot; fachada de e-mail furada por 4 chamadores; permissões espelhadas em 3 lugares no front +
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER2 mecanismos de gate de rota; `Skeleton` nunca usado; `apiErrorMessage` em só 4/44 páginas.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER### 🟢 Polimento
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERÍndices redundantes; nomes/ternários sobrando; chaves de localStorage com 3 separadores; doc do
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER`Button` descrevendo paleta antiga; `postMessage('*')` nos callbacks OAuth; TTL de 7 dias em signed
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDERURL de mídia; logs de diagnóstico "temporários" ainda ligados.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER---
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER## 3. Top-5 Refatorações ANTES de escalar
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER1. **Fechar os furos de isolamento/auth (🚨1, 🚨2 + Tema A).** Checar vínculo de empresa nos
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   endpoints de `/empresas`; checar `PENDENTE` no `/auth/welcome`; criar os `@@unique` compostos
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   reais (`Conversation`, `Pedido.numeroOmie`); tornar `/metrics` privado; corrigir `empresaFilter`
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   do ADMIN. **É o pré-requisito do 2º cliente.** Esforço: pequeno/médio. Risco de não fazer: alto.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER2. **Endurecer o webhook do Evolution + o rate-limit de login (Tema B).** HMAC/segredo timing-safe +
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   IP allowlist no Evolution; `req.ip` no throttler; throttle próprio no NPS público. Esforço:
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   pequeno. É o canal de WhatsApp (o mais usado) sem a proteção que os marketplaces já têm.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER3. **Base compartilhada de integração (OAuth + webhook).** Um `OAuthStateService`/`CredentialStore`
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   e um `WebhookBase` que os 6 OAuth + os webhooks consomem. Centraliza o código sensível, mata a
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   duplicação 6× e o util de HMAC reimplementado. Esforço: médio. Paga em cada integração futura.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER4. **Rede de teste no frontend, começando pelo que faz conta.** `formatMoeda` único + specs de
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   `api.ts`/`auth-store` e das páginas de pedido/proposta/comissão. Esforço: médio. Hoje uma
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   regressão de cálculo no front não é pega por nada.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER5. **Adotar cache de dados (TanStack/SWR) e quebrar os 2 monstros.** A interface do `useApiQuery` já
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   é a do `useQuery` (migração quase mecânica); extrair `InboxPage`/`FluxoEditor` em pedaços
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER   testáveis. Esforço: médio/grande. Destrava performance e manutenção do front.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER---
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER## 4. O que pode esperar (icebox)
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **Migrar as 21 páginas legadas (`styles.ts`) pro `ui/`** e apagar o `Modal.tsx` — grande, contínuo,
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER  sem urgência (o app funciona com os dois).
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **Quebrar `fluxo-executor`/`users`/`whatsapp-session`** em pedaços (strategy/serviços) — refactor
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER  planejado.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **CNPJ alfanumérico** (prazo Receita: julho/2026) — mapear os ~7 pontos quando chegar perto.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **Tabela de preço real do OMIE** (substituir o chute de 70%) — quando o cliente fornecer as
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER  credenciais com tabelas auxiliares.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **pgvector no MullerBot** — só quando uma empresa passar de ~500 produtos.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **WebSocket na Inbox** (hoje polling) — quando o tempo-real virar requisito.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **Multi-page no Meta**, **SQS na Amazon**, **virtualização de listas** — todos already-known,
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER  documentados, sem pressa.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER- **Limpeza de polimento** (índices redundantes, logs temporários, tokens hardcoded de tom) — varrer
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER  numa “semana de dívida”.
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER---
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER
 `🔴 E · `interpolar()` em 3 lugares` PLACEHOLDER*Consolidação somente-leitura dos 14 batches. Nenhum código foi alterado em nenhuma etapa da revisão.*
