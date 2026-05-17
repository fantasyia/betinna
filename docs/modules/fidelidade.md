# Programa Fidelidade

Programa de pontos por empresa. Cliente acumula em pedidos aprovados, resgata em recompensas.

## Modelo

- `ProgramaFidelidade` — 1 por empresa (`@unique empresaId`)
  - `ativo`, `pontosPorReal`, `ttlMeses` (0 = sem expirar), `valorMinimoPedido`
- `RecompensaFidelidade` — catálogo
  - `nome`, `descricao`, `custoPontos`, `tipo` (DESCONTO_PERCENTUAL/DESCONTO_VALOR/BRINDE), `valor`, `estoque` (null = ilimitado), `ativo`
- `SaldoFidelidade` — saldo atual por cliente (1:1, `clienteId @unique`)
- `MovimentoFidelidade` — extrato (`tipo`: GANHO_PEDIDO/ESTORNO_PEDIDO/RESGATE/EXPIRACAO/AJUSTE_MANUAL)
  - **Idempotência**: `@@unique([pedidoId, tipo])` impede duplo crédito

## Permissões (D48)

| Ação | Quem |
|---|---|
| Ver programa, saldo, extrato, ranking | Qualquer user com `fidelidade.view` |
| Resgatar pra cliente | User com `fidelidade.edit` (REP+) |
| Configurar programa, CRUD recompensas, ajuste manual | **ADMIN ou DIRECTOR** |

## Triggers automáticos

### Crédito (pedido aprovado)

`PedidosService.enviarParaOmie` chama `void this.fidelidade.creditarPedidoAprovado(...)` após push:

1. Busca/cria programa da empresa (auto-cria com defaults se não existe)
2. Se `!programa.ativo` → retorna `null` (skip)
3. Se `valorPedido < valorMinimoPedido` → skip
4. Calcula `pontos = floor(valorPedido × pontosPorReal)`
5. Em transação:
   - `findUnique({ pedidoId_tipo: { pedidoId, tipo: 'GANHO_PEDIDO' } })` — se já existe, idempotente, retorna existente
   - Cria `MovimentoFidelidade` + `upsert SaldoFidelidade` somando pontos

### Estorno (pedido cancelado)

`PedidosService.cancelar` chama `void this.fidelidade.estornarPedidoCancelado(id)`:

1. Busca movimento `GANHO_PEDIDO` desse pedido
2. Se não existe → skip (nada a estornar)
3. Em transação: cria movimento `ESTORNO_PEDIDO` com `pontos = -ganho.pontos` + decrementa saldo

Idempotente via `@@unique([pedidoId, tipo='ESTORNO_PEDIDO'])`.

### Best-effort

Ambos os triggers usam try/catch e logam `warn` se algo falha. **Falha em fidelidade NÃO derruba criação/cancelamento do pedido** — é feature secundária.

## Resgate manual

`POST /fidelidade/resgatar` (REP+):

1. Valida saldo do cliente >= `recompensa.custoPontos`
2. Se `recompensa.estoque !== null`: valida `estoque > 0`
3. Em transação atomic:
   - Cria movimento `RESGATE` (pontos negativos)
   - Decrementa saldo
   - Se tinha estoque: decrementa `RecompensaFidelidade.estoque` com `updateMany({estoque: {gt:0}})` (race-safe)
4. Audit log registra (`audit.action='resgatar'`, `resourceIdFrom='response.movimento.id'`)

## Ajuste manual

`POST /fidelidade/ajustar` (DIRECTOR/ADMIN):

- Pontos `+` ou `-`, NUNCA 0 (validação Zod)
- `motivo` obrigatório (min 3 chars, max 280)
- Saldo NÃO fica negativo — se cliente tem 100 e ajuste é -150, vira 0 e movimento registra apenas o que foi de fato debitado
- Audit log registra com motivo

## Endpoints

| Endpoint | Quem | O quê |
|---|---|---|
| `GET /fidelidade/programa` | view | Config atual |
| `PATCH /fidelidade/programa` | ADMIN/DIRECTOR | Atualizar config |
| `GET /fidelidade/recompensas?incluirInativas=true` | view | Catálogo |
| `POST /fidelidade/recompensas` | ADMIN/DIRECTOR | Criar |
| `PATCH /fidelidade/recompensas/:id` | ADMIN/DIRECTOR | Editar |
| `DELETE /fidelidade/recompensas/:id` | ADMIN/DIRECTOR | Desativar (soft) |
| `GET /fidelidade/saldo/:clienteId` | view | Saldo + atualizadoEm |
| `GET /fidelidade/movimentos?clienteId&tipo&page&limit` | view | Extrato paginado |
| `POST /fidelidade/resgatar` | edit | Resgatar recompensa pra cliente |
| `POST /fidelidade/ajustar` | ADMIN/DIRECTOR | Ajuste manual (+/-) com motivo |
| `GET /fidelidade/ranking?limit=10` | view | Top clientes por saldo |

## KPIs (em `/relatorios/fidelidade`)

- **Programa ativo / pausado**
- **Clientes pontuando** (saldo > 0)
- **Saldo total acumulado** (Σ pontos da empresa)
- **No período**: creditados, resgatados, estornados, expirados, ajustados, total de movimentos
- **Taxa de uso** = resgatados ÷ creditados (% — sinal de engajamento real)
- **Top 5 clientes** por saldo

## Fluxos típicos

### A. DIRECTOR configura programa pela 1ª vez

1. DIRECTOR em `/fidelidade` (programa auto-criado com defaults na primeira visita)
2. Clica "Configurar programa" → modal
3. Define: `pontosPorReal=1`, `ttlMeses=12`, `valorMinimoPedido=100`
4. Ativa o programa (toggle)
5. Volta e clica "+ Nova recompensa" — cria "5% de desconto" custando 500 pts
6. Cria mais 3 recompensas
7. Pronto — próximos pedidos aprovados creditam pontos automaticamente

### B. REP resgata recompensa pra cliente

1. REP em `/fidelidade` consulta saldo do cliente (busca por nome)
2. Cliente tem 800 pts; recompensa "Frete grátis" custa 500
3. REP clica "Resgatar" → modal: seleciona cliente + recompensa
4. Confirma → backend valida saldo + estoque → cria movimento + debita
5. UI atualiza extrato — saldo agora 300
6. REP comunica cliente: "seu frete grátis está liberado, válido pelos próximos 30 dias"

### C. Cancelamento estorna pontos

1. Pedido `PED-0042` (R$ 500) aprovado e enviado ao OMIE → creditou 500 pts ao cliente
2. 2 dias depois, problema fiscal → DIRECTOR cancela pedido
3. Sistema detecta → cria movimento `ESTORNO_PEDIDO` (-500 pts)
4. Saldo do cliente volta ao que era

### D. Ajuste por cortesia

1. Cliente reclamou de atraso → DIRECTOR quer dar 200 pts de cortesia
2. DIRECTOR em `/fidelidade` clica "⚙️ Ajuste manual"
3. Seleciona cliente, pontos `+200`, motivo "Cortesia por atraso na entrega do pedido 0042"
4. Confirma → saldo aumenta + audit log registra quem fez
