# Pipeline — Leads/Kanban, Ocorrências/SAC, Agenda

## Leads (Kanban)

Pipeline comercial visual. Cada lead percorre etapas até virar pedido (`GANHO`) ou desistir (`PERDIDO`).

### Etapas padrão

Configuráveis por empresa, mas defaults:

```
PROSPECCAO → QUALIFICACAO → PROPOSTA → NEGOCIACAO → GANHO
                                              └────► PERDIDO
```

### Aging

Lead que fica >7 dias na mesma etapa fica "aging" (UI mostra badge laranja). >14 dias = vermelho. Sinaliza pro REP retomar contato.

### Won/Loss

- `GANHO`: vincula a `pedidoId` (se virou pedido) ou `propostaId`
- `PERDIDO`: `motivoPerda` obrigatório (preço/concorrência/timing/outros)

Métricas em `/relatorios/funil`:
- Taxa de conversão (GANHO / total)
- Pipeline ponderado (Σ `valorEstimado × probabilidade(etapa)`)
- Aging médio por etapa

## Ocorrências (SAC)

Tickets internos para problemas operacionais. Diferente de marketplaces (que viram `MarketplaceIncident`).

### Severidade + SLA

| Severidade | SLA resposta | Cor |
|---|---|---|
| `CRITICA` | 2h | vermelho |
| `ALTA` | 4h | laranja |
| `MEDIA` | 24h | amarelo |
| `BAIXA` | 72h | azul |

`SLA estourado` = `abertaEm + slaHoras < now` && `resolvidaEm IS NULL`.

### Estados

```
ABERTA ──► EM_ANDAMENTO ──► RESOLVIDA
                     └────► CANCELADA
```

### Timeline

Cada ocorrência tem `OcorrenciaComentario[]`. Cronologia com autor + tipo (`COMENTARIO`, `MUDANCA_STATUS`, `ATRIBUICAO`).

### Numeração

`numero` sequencial por empresa (`OC-0001`, `OC-0002`, ...). Útil pra referenciar em conversas externas.

## Agenda

Calendário pessoal por usuário. Tipos:

| Tipo | Quando usar |
|---|---|
| `VISITA` | Visita presencial ao cliente |
| `LIGACAO` | Telefonema agendado |
| `REUNIAO` | Reunião interna ou externa |
| `ENTREGA` | Acompanhar entrega de pedido |
| `TAREFA` | Tarefa genérica (cobrança, follow-up) |

### Espelhamento Google Calendar

Se usuário conectou Google Calendar em `/usuario/integracoes`, ao criar `AgendaItem`:
- Backend cria evento via `GoogleCalendarService` (best-effort, D13)
- Se Google falha → loga warning, mas mantém local
- `AgendaItem.googleEventId` guarda o link

UX > consistência distribuída: melhor ter agenda local funcionando do que travar tudo quando Google está fora.

## Fluxos típicos

### A. Lead que vira pedido

1. REP cria lead em `/leads` (cliente potencial, valorEstimado, etapa `PROSPECCAO`)
2. Move para `QUALIFICACAO` após primeira conversa
3. Move para `PROPOSTA` ao mandar proposta formal
4. Cliente aceita: REP cria `Pedido` em `/pedidos/novo` → ao salvar, link automático com lead
5. Move lead pra `GANHO` (sistema já vincula `pedidoId`)

### B. Lead perdido

1. Lead em `NEGOCIACAO` há 10 dias (aging vermelho)
2. REP em `/leads` clica "Marcar como perdido"
3. Modal: motivo (radio: preço/concorrência/timing/outros) + texto livre opcional
4. Lead vai pra `PERDIDO` — sai do board principal, fica em filtro "Perdidos"
5. Relatório mostra distribuição dos motivos pra DIRECTOR analisar

### C. Ocorrência crítica

1. SAC abre `Ocorrencia` (severidade `CRITICA`, SLA 2h)
2. Atribui a um GERENTE como responsável
3. Timeline registra: `ABERTA → ATRIBUICAO → COMENTARIO (gerente: "olhando") → MUDANCA_STATUS (EM_ANDAMENTO)`
4. Gerente resolve dentro do SLA → marca `RESOLVIDA` com solução
5. Relatório SAC: tempo médio de resolução (TMR), % SLA estourado

### D. Visita agendada com Google

1. REP cria `AgendaItem` tipo `VISITA` em `/agenda` (hoje 14h, cliente X)
2. Backend cria evento no Google Calendar primário do REP
3. REP vê visita no Google Calendar do celular + notificação automática
4. Após visita, REP marca `concluido=true` + opcional `observacao`
5. Relatório de produtividade mostra visitas/semana
