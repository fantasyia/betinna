# Automação — Fluxos + Campanhas

## Fluxos de Automação (D44)

Sistema visual de regras `trigger → ação` executado por BullMQ. Permite zero-código pra automatizar follow-ups, notificações, atribuições.

### Modelo

- `Fluxo` — container (`nome`, `ativo`, `arquivado`)
- `FluxoNo` — nó do grafo (`tipo`: TRIGGER/ACAO/CONDICAO/DELAY)
- `FluxoEdge` — aresta (`from`, `to`, `label` opcional pra branches)
- `FluxoExecucao` — instância em execução (`status`: RODANDO/CONCLUIDO/FALHOU/CANCELADO)
- `FluxoExecucaoLog` — passo-a-passo (audit por nó)

### Triggers disponíveis

| Trigger | Quando dispara | Payload |
|---|---|---|
| `LEAD_CRIADO` | Novo lead inserido | `{ leadId, valorEstimado, etapa }` |
| `LEAD_ETAPA_MUDOU` | Lead mudou de etapa | `{ leadId, etapaAnterior, etapaNova }` |
| `PEDIDO_APROVADO` | Pedido vira APROVADO | `{ pedidoId, clienteId, valorTotal }` |
| `PEDIDO_ENTREGUE` | Pedido entregue | `{ pedidoId, clienteId }` |
| `OCORRENCIA_ABERTA` | Nova ocorrência | `{ ocorrenciaId, severidade }` |
| `CLIENTE_INATIVO_30D` | Cliente sem pedido 30d | `{ clienteId }` (cron 30min) |
| `AMOSTRA_FOLLOWUP` | Vence prazo de follow-up | `{ amostraId, clienteId }` (cron 30min) |
| `CRON_AGENDADO` | Horário customizado | `{}` (cron string) |

### Ações disponíveis

| Ação | O quê faz | Variáveis disponíveis |
|---|---|---|
| `ENVIAR_WHATSAPP` | Manda mensagem via WhatsApp | `{{cliente.nome}}`, `{{pedido.numero}}` |
| `ENVIAR_EMAIL` | Manda email via SendGrid | idem |
| `CRIAR_TAREFA` | Cria AgendaItem | idem |
| `MUDAR_TAG` | Adiciona/remove tag do cliente | — |
| `MOVER_LEAD_ETAPA` | Move lead | `{{etapa.nova}}` |
| `ATRIBUIR_REP` | Mudar `representanteId` | — |
| `WEBHOOK_EXTERNO` | POST com payload pra URL externa | — |

### Interpolação

Strings de ação suportam `{{path.to.value}}`. Resolvedor lê do payload + contexto da execução.

Exemplo:
```
"Oi {{cliente.nome}}! Seu pedido {{pedido.numero}} foi aprovado 🎉"
```

### Condições

Nó `CONDICAO` bifurca por `label="true"`/`label="false"`. Expressões suportam:
- comparações: `cliente.faturamentoMes > 5000`
- AND/OR: `pedido.valor > 1000 && cliente.tag.includes("VIP")`
- includes/startsWith/etc.

### DELAY

Nó `DELAY` pausa execução via `BullMQ.delay`:
- Unidade: `MINUTOS`, `HORAS`, `DIAS`
- Limite prático: 30 dias (BullMQ aguenta mais, mas UX fica estranha)

### Validação de grafo

Ao salvar (`ativar`), backend valida:
- Exatamente 1 trigger
- Toda ação tem `acaoTipo` setado
- Arestas não criam ciclos (DFS)
- Sem nós órfãos

### Execução

1. Evento dispara via `FluxoEventBusService.disparar(trigger, payload)`
2. Bus consulta fluxos `ativos` com esse trigger pra essa empresa
3. Cria `FluxoExecucao` (status `RODANDO`)
4. Enfileira primeiro job em BullMQ (`fila fluxo-execucao`)
5. `FluxoExecutorProcessor` (concorrência 5, retry exponencial):
   - Resolve nó atual
   - Avalia condição / executa ação / aplica delay
   - Enfileira próximo nó
6. Loga cada passo em `FluxoExecucaoLog`
7. Última ação → `status=CONCLUIDO`

Falha em qualquer nó → `FALHOU` com `erroMsg`. BullMQ retry 3x antes.

### Best-effort no bus

`FluxoEventBusService.disparar` engole exceções — falha de enfileiramento NÃO derruba a operação principal (criação de pedido, mudança de lead etc).

### Cron jobs próprios do módulo

`FluxoTriggersJob` (`*/30 * * * *`):
- Verifica clientes inativos há 30d → dispara `CLIENTE_INATIVO_30D`
- Verifica amostras vencendo follow-up → dispara `AMOSTRA_FOLLOWUP`

## Campanhas

Hoje é **subset de Fluxos**: trigger único + 1 ação `ENVIAR_WHATSAPP` ou `ENVIAR_EMAIL` em massa.

Endpoints `/campanhas`:
- CRUD + máquina de estados (`RASCUNHO → AGENDADA → EM_ENVIO → CONCLUIDA`)
- Segmentação por filtros (tags, faixa de faturamento, lista dinâmica de clientes)
- IA assist: `POST /campanhas/ia/gerar-conteudo`, `/otimizar`, `/sugerir-segmento`, `/analisar`

> Campanhas standalone (CRUD completo desacoplado de Fluxos) está no backlog
> "nice-to-have". Pra MVP, fluxos cobrem o caso de uso.

## Fluxos típicos

### A. Boas-vindas automáticas

```
TRIGGER: PEDIDO_APROVADO (primeiro pedido do cliente)
   │
   ▼
CONDICAO: cliente.totalPedidos == 1
   │ (true)
   ▼
ACAO: ENVIAR_WHATSAPP
   "Obrigado {{cliente.nome}}! Seu 1º pedido conosco — bem-vindo."
   │
   ▼
DELAY: 3 dias
   │
   ▼
ACAO: CRIAR_TAREFA (tipo LIGACAO)
   "Ligar pro {{cliente.nome}} verificar entrega"
```

### B. Recuperação de cliente inativo

```
TRIGGER: CLIENTE_INATIVO_30D
   │
   ▼
CONDICAO: cliente.tag.includes("VIP")
   │ (true)              │ (false)
   ▼                     ▼
ACAO: ATRIBUIR_REP      ACAO: ENVIAR_EMAIL
"Diretor pessoal"        "Sentimos sua falta — 10% de
                          desconto no próximo pedido"
```

### C. Aprovação rápida via WhatsApp

```
TRIGGER: PEDIDO_APROVADO (com desconto > 10%)
   │
   ▼
ACAO: ENVIAR_WHATSAPP (pro GERENTE)
   "Pedido {{pedido.numero}} de {{cliente.nome}} aguarda análise.
    Ver: {{app.url}}/aprovacoes"
```
