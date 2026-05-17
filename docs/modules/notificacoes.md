# Notificações in-app

Notificações persistidas por usuário, exibidas no sino do header. Backed por tabela
`Notificacao` no Postgres + e-mail transacional opcional via SendGrid.

## Modelo

| Campo | Tipo | Notas |
|---|---|---|
| `id` | cuid | PK |
| `empresaId` | FK Empresa | Multi-tenant |
| `usuarioId` | FK Usuario | Destinatário |
| `tipo` | enum `NotificacaoTipo` | 12 tipos: APROVACAO_PENDENTE, OCORRENCIA_ABERTA, COMISSAO_FECHADA, COMISSAO_PAGA, MENSAGEM_INBOX, AMOSTRA_FOLLOWUP, LEAD_INATIVO, CLIENTE_BLOQUEADO, GENERICO, PEDIDO_APROVADO, OCORRENCIA_RESOLVIDA, APROVACAO_RESOLVIDA |
| `prioridade` | BAIXA \| NORMAL \| ALTA \| URGENTE | Define cor + ordenação |
| `titulo` | text | Max 160 chars |
| `mensagem` | text | Max 500 chars |
| `link` | text? | Deep link (`/pedidos/:id`, `/aprovacoes`) |
| `metadata` | jsonb | Contexto livre (pedidoId, ocorrenciaId, etc) |
| `lidaEm` | timestamp? | null = não lida |
| `criadoEm` | timestamp | Default now() |

Índice composto `[usuarioId, lidaEm, criadoEm]` otimiza queries de "minhas não-lidas".

## Triggers ativos

| Evento | Notificação in-app | E-mail | Destinatário |
|---|---|---|---|
| Pedido com desconto > teto criado | APROVACAO_PENDENTE | — | GERENTE+DIRECTOR |
| Aprovação resolvida (APROVADA/REJEITADA) | APROVACAO_RESOLVIDA | ✅ | REP |
| Ocorrência CRITICA/ALTA aberta | OCORRENCIA_ABERTA | ✅ | GERENTE+DIRECTOR+SAC |
| Ocorrência resolvida | OCORRENCIA_RESOLVIDA | — | Criador |
| Fechamento de mês | COMISSAO_FECHADA | ✅ (com valores individuais) | REPs+GERENTEs |
| Comissão paga | COMISSAO_PAGA | — | Beneficiário |
| Convite/criação user | — | ✅ (boas-vindas) | Próprio user |
| Amostra follow-up cron | — | ✅ | REP responsável |

Todas best-effort: falha NÃO derruba a operação principal.

## Endpoints

| Método | Path | Quem |
|---|---|---|
| `GET /notificacoes?page&limit&apenasNaoLidas&tipo&prioridade` | Lista paginada | Própria |
| `GET /notificacoes/nao-lidas` | Contagem (endpoint barato pra polling) | Própria |
| `PATCH /notificacoes/:id/ler` | Marca lida (idempotente) | Própria |
| `PATCH /notificacoes/ler-todas` | Marca todas como lidas | Própria |
| `DELETE /notificacoes/:id` | Apaga | Própria |
| `POST /notificacoes` (broadcast manual) | Cria pra outro user | ADMIN/DIRECTOR |

## Frontend

- **`NotificationBell`** componente — sino no header desktop+mobile, badge contador, polling 30s
- Dropdown lista 10 últimas, marca lida ao clicar, link clicável navega + marca
- Página `/notificacoes` — lista completa com filtros (lidas/não, prioridade), bulk "marcar todas"

## Política de privacidade

- E-mails nunca incluem dados sensíveis (PII redacted, valores agregados)
- `metadata` cifrável quando necessário (hoje plain — adicionar `Notificacao.metadataCifrado` quando demandado)
