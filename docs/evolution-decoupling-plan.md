# Evolution Decoupling — Plano Executável

> **Objetivo:** tirar os sockets de WhatsApp de DENTRO do processo da API (Baileys embutido) e movê-los
> pra a **Evolution API como serviço separado no Railway**. Resultado: a API vira **stateless** pra
> WhatsApp → destrava **N réplicas horizontais** (a Parede 1 do [plano de escala]).
>
> Status do mapeamento: 2026-06-28 (2 exploradores no código).

---

## 🎯 TL;DR — a descoberta

**A integração Evolution já está ~80% pronta e o roteamento já está todo no lugar.** O decoupling NÃO é
um épico de 2-4 semanas do zero. O que existe vs falta:

| Camada | Estado |
|---|---|
| Client HTTP (`EvolutionService`) — enviar texto/mídia/áudio/presença/reação, QR, estado, reset, mídia, grupos | ✅ Completo (~20 métodos) |
| Webhook inbound (`/webhooks/evolution`) — HMAC header timing-safe + anti-replay + ACK assíncrono | ✅ Completo |
| Parser inbound (`evolution-inbound.service`) — extrai conteúdo, resolve empresa/proprietário, mídia→Storage, grupos, → `InboxService.processarMensagemEntrante` | ✅ Completo |
| Roteamento de envio — `WhatsAppService` decide Baileys vs Evolution por `WHATSAPP_PROVIDER`; adapter no `CanalAdapterRegistry` | ✅ Completo |
| Consumidores (Fluxos, Campanhas, MullerBot, Inbox responder) — **todos já chamam `WhatsAppService` genérico** | ✅ Sem mudança |
| Pacing anti-ban (`WhatsappPacingService`) — Redis, fica na API | ✅ Sem mudança |
| Fallback poll (cron 1min, janela 45s–12min, dedup por externalId) | ✅ Completo |
| **Persistência de instância** (tabela + sync com a verdade do Evolution) | ❌ Falta |
| **Cleanup on-deactivation** (desativar empresa/rep → deletar instância no Evolution) | ❌ Falta |
| **Degradação graciosa** quando o Evolution está fora | ⚠️ Fraca (falha bruto) |
| **Infra**: Evolution rodando como serviço separado no Railway + env vars | ❓ Confirmar (ver Fase 0) |

**Conclusão:** o trabalho real é **(a) infra** (subir/confirmar o Evolution no Railway) + **(b) ~20% de
código operacional** (persistência/sync/cleanup/erro) + **(c) re-pareamento dos números** (o auth state
do Baileys NÃO migra — cada número escaneia um QR novo no Evolution).

---

## ⚠️ Fase 0 — Confirmar o estado atual (FAZER ANTES DE TUDO)

A memória diz que prod **já usa `WHATSAPP_PROVIDER=evolution`** (envio via Evolution). Mas o default do
schema é `baileys`. Antes de qualquer código, confirmar:

1. **Qual `WHATSAPP_PROVIDER` está setado em prod** (Railway → service API → Variables).
2. **Pra onde aponta `EVOLUTION_API_URL`** — já é um serviço Railway dedicado? Ou um container temporário/local?
3. **Se já é Evolution em prod:** então os sockets JÁ estão fora da API → **a Parede 1 já está
   parcialmente vencida**, e este plano vira só "fechar os 20% operacionais + garantir que o Evolution
   escala". **Se ainda é Baileys:** o plano roda inteiro.
4. Checar `API_PUBLIC_URL` setado (o Evolution precisa dele pra chamar `/webhooks/evolution`).

**Saída da Fase 0:** uma frase — "prod está em \<baileys|evolution\>, Evolution roda em \<url\>, falta \<X\>".

---

## 🏗️ Fase 1 — Evolution API como serviço Railway dedicado

Se ainda não existe um serviço Evolution dedicado e estável:

1. **Subir o `evolution-api`** (projeto open-source) como **novo serviço no Railway** (imagem oficial
   `atendai/evolution-api` ou equivalente). Precisa de:
   - **Postgres** (pode ser um banco separado ou schema dedicado — o Evolution guarda o auth state das
     sessões; é o que mantém os sockets vivos entre restarts).
   - **Redis** (o Evolution usa pra cache/estado; pode reusar o Redis existente ou um dedicado).
   - Env do Evolution: `AUTHENTICATION_API_KEY` (= o `EVOLUTION_API_KEY` que a Betinna usa), webhook
     global desligado (a Betinna seta webhook por-instância no `criarInstancia`).
2. **Configurar na API Betinna** (Railway, service API **e** worker):
   - `WHATSAPP_PROVIDER=evolution`
   - `EVOLUTION_API_URL=https://<evolution>.railway.app`
   - `EVOLUTION_API_KEY=<a mesma key do Evolution>`
   - `API_PUBLIC_URL=https://api-...railway.app` (pro webhook reverso)
3. **Rede:** se Evolution e API estão no mesmo projeto Railway, usar a rede privada (`*.railway.internal`)
   pra o tráfego API→Evolution (mais rápido/seguro); o webhook Evolution→API usa a URL pública.
4. **Healthcheck do Evolution** + alerta se cair (o WhatsApp inteiro depende dele agora).

**Acceptance:** `EvolutionService.ativo()` true; criar 1 instância de teste, parear via QR, enviar e
receber 1 mensagem ponta-a-ponta.

---

## 🧩 Fase 2 — Fechar os ~20% de código operacional

Tudo aqui é **aditivo** (não quebra o que existe). Ordenado por valor:

### 2.1 — Persistência de instância (`EvolutionInstancia`) — **[A, crítico]**
- Migration hand-written (ver [backend/CLAUDE.md]): tabela `EvolutionInstancia` com `instanceName` (PK
  ou unique), `empresaId`, `usuarioId` (nullable), `ownerJid`, `connectionStatus`, `criadoEm`,
  `atualizadoEm`. Índice por `empresaId`.
- Escrever/atualizar no `criarInstancia`/`conectarOuEstado`/`logout`/`deletar` (o `EvolutionService` já
  tem esses pontos).
- **Por quê:** hoje o estado de instância vive só em memória (`qrPorInstancia`/`estadoPorInstancia`) +
  na verdade do Evolution. Sem persistência, não há recovery/auditoria e o status sbackend é volátil.

### 2.2 — Cron de sync + auto-reconexão de zumbi — **[B, médio]**
- `EvolutionSyncInstanciasJob` (cron ~5-15min, **só no worker**, com `CronLockService`): chama
  `listarInstancias()` + `buscarInstancia()`, atualiza `connectionStatus` no banco, e nos zumbis
  (open+401, via `saudavel()`) dispara `resetarForte()` + alerta o diretor (`IntegracaoStatusService`).
- **Por quê:** hoje o operador reconecta na mão (clica "Conectar"). A 3000 reps isso não escala.

### 2.3 — Cleanup on-deactivation — **[C, médio]**
- Quando uma empresa/usuário é desativado (`users.setStatus(INATIVO)`, desativar empresa), chamar
  `evolution.logout()` + `evolution.deletar()` pra a instância correspondente.
- **Por quê:** instâncias órfãs no Evolution consomem recurso + confundem o dashboard.

### 2.4 — Degradação graciosa quando o Evolution está fora — **[D, baixo]**
- No `WhatsAppService`/`EvolutionService`: se o Evolution está inacessível, retornar erro de negócio
  CLARO (não 500 cru) + marcar a integração desconectada + não travar o fluxo de mensagem (o pacing e o
  idempotency gate já são best-effort). Para envios de fluxo/campanha, deixar o BullMQ re-tentar.

### 2.5 — Dashboard de instâncias (debug) — **[1, baixo, opcional]**
- `GET /integracoes/evolution/instances` (ADMIN/DIRECTOR) → lista instâncias + status (do banco, com
  refresh do Evolution). Facilita suporte.

---

## 🔁 Fase 3 — Migração / re-pareamento

**O auth state do Baileys NÃO transfere pro Evolution.** Cada número precisa **escanear um QR novo** na
instância Evolution. Plano:

1. Janela de manutenção comunicada (o WhatsApp fica fora por minutos por número durante o re-pareamento).
2. Pra cada número ativo (empresa + cada rep): abrir a tela de conexão → o `conectarOuEstado` cria a
   instância Evolution + mostra o QR → o dono escaneia.
3. **Ordem:** começar pelo número da empresa (SAC), depois os reps em lotes.
4. Manter o Baileys como **fallback de emergência** por 1 deploy (não deletar o código ainda) — se o
   Evolution falhar feio, dá pra voltar `WHATSAPP_PROVIDER=baileys` num env flip + redeploy.

---

## ✅ Fase 4 — Validar + aposentar o Baileys embutido

1. Rodar 1-2 dias com Evolution + monitorar (envio, recebimento, latência, zumbis).
2. **Provar a horizontalização:** subir 2 réplicas da API (a parte que isto destrava) e confirmar que o
   WhatsApp segue funcionando independente de qual réplica atende o request (porque o socket vive no
   Evolution, não na réplica). Cuidado com o boot do Baileys: garantir que `WHATSAPP_PROVIDER=evolution`
   dorme o Baileys em TODAS as réplicas (já implementado no `onModuleInit`).
3. Quando estável: marcar `whatsapp-session.service.ts` (Baileys) como legado/stub. **Não deletar** já —
   manter como fallback documentado até confiança total.

---

## 🚧 Riscos / pontos de atenção

- **Evolution single-container vira o novo SPOF do WhatsApp.** Healthcheck + alerta obrigatórios. Pra
  escala futura, o `instanceName` (`emp_*`/`user_*`) já permite sharding em N Evolutions por região
  (Fase futura, não agora).
- **Webhook delivery:** se o Evolution não conseguir chamar `/webhooks/evolution` (rede/URL errada), as
  mensagens ficam presas no Evolution. O fallback poll (cron 1min) cobre, mas confirmar a URL no setup.
- **Re-pareamento é disruptivo** (QR novo por número) — comunicar e fazer em lote.
- **Grupos:** tanto Baileys quanto Evolution persistem grupos (@g.us) hoje; o gotcha antigo ("Evolution
  descarta grupos") **já foi resolvido** no `evolution-inbound`. Validar mesmo assim.
- **Pacing fica na API** (não migra) — o anti-ban continua centralizado no Redis da Betinna. ✓

---

## 📌 Sequência sugerida (esforço)

| Fase | O quê | Esforço |
|---|---|---|
| 0 | Confirmar estado atual de prod (provider + infra Evolution) | **P** (1h) |
| 1 | Evolution como serviço Railway dedicado + env | **M** (infra, 1-2 dias) |
| 2 | Persistência + sync/reconexão + cleanup + degradação | **M** (código, ~3-4 dias) |
| 3 | Re-pareamento dos números | **P-M** (operacional + janela) |
| 4 | Validar + provar N réplicas + aposentar Baileys | **P** (validação) |

**Não é 2-4 semanas do zero — é ~1-1.5 semana de trabalho efetivo** (porque o código de integração já
existe), concentrado em infra + operacional. O grande valor: **a API fica stateless → N réplicas.**
