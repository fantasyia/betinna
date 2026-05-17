# Vendas — Pedidos, Propostas, Aprovações, Comissões, Amostras

## Pedidos

Fluxo central da plataforma. Pedido nasce no app, vai pro OMIE.

### Máquina de estados

```
RASCUNHO ───► AGUARDANDO_APROVACAO ───► APROVADO ───► ENVIADO_OMIE
   │              (se desconto > teto)          │           │
   │                                            └──► CANCELADO
   └─► CANCELADO
```

- `RASCUNHO` — criado pelo REP, ainda editável
- `AGUARDANDO_APROVACAO` — desconto excede teto do rep, fica esperando GERENTE
- `APROVADO` — gerente aprovou, pode ir pro OMIE
- `ENVIADO_OMIE` — push feito, `numeroOmie` registrado
- `CANCELADO` — qualquer estado anterior

### Preview + Create

`POST /pedidos/preview` calcula totais sem persistir. Mostra:
- subtotal, descontos por item, desconto geral, total
- comissão estimada
- `maxDesconto` permitido sem aprovação (`min(REP.tetoDesconto, ProdutoMax)`)

`POST /pedidos` persiste. Auto-detecta se precisa de aprovação.

### Aprovação de desconto

Trigger automático quando `descontoTotal > tetoDesconto` do rep:

1. Pedido criado com status `AGUARDANDO_APROVACAO`
2. Cria registro `AprovacaoDesconto` (status `PENDENTE`)
3. GERENTE (ou DIRECTOR catch-all) vê em `/aprovacoes`
4. GERENTE aprova/rejeita com motivo
5. Se aprovado, pedido vira `APROVADO`; se rejeitado, vira `CANCELADO`

### Push pro OMIE

`POST /pedidos/:id/enviar-omie` (status `APROVADO` ou `RASCUNHO` sem aprovação):

1. Valida cliente não está `BLOQUEADO`
2. Monta payload OMIE (`OmieMapper.pedidoToOmie`)
3. POST `producao/pedidovenda/incluirpedido`
4. Atualiza `numeroOmie`, `codigoStatusOmie`, `enviadoOmieEm`
5. **Trigger fidelidade**: `void this.fidelidade.creditarPedidoAprovado(...)` (best-effort)

### Cancelamento

`POST /pedidos/:id/cancelar`:
- Se já enviado ao OMIE → manda cancelar lá também (`/alterarpedido` com status cancel)
- **Trigger fidelidade**: `void this.fidelidade.estornarPedidoCancelado(id)` (best-effort, idempotente)

## Propostas

Alternativa antes de pedido oficial (D6). Mesma estrutura mas:
- Não consome estoque
- Tem `validadeAte` (cliente decide até quando)
- `POST /propostas/:id/converter-em-pedido` cria pedido a partir dela

Estados: `RASCUNHO → ENVIADA → ACEITA → CONVERTIDA` (ou `REJEITADA` / `EXPIRADA`).

## Comissões

### Cálculo

- **REP**: snapshot do `Comissao.percentual` no momento do pedido aprovado. Editar `Usuario.comissaoPadrao` depois NÃO altera comissões já fechadas.
- **GERENTE**: somatório das vendas dos REPs subordinados × `GERENTE.comissaoPadrao` (D41).

### Fechamento mensal

Cron `ComissoesFechamentoJob` (dia 1, 04:00 UTC, D43) processa o mês anterior pra todas as empresas ativas. Idempotente — `reprocessar=false` pula quem já fechou manual.

Endpoints DIRECTOR-only (D46):
- `POST /comissoes/fechar-mes` — força fechamento manual
- `POST /comissoes/:id/pagar` — marca como paga
- `POST /comissoes/:id/desmarcar-pago` — reverter (correção)

### Resumo pessoal

`GET /comissoes/resumo` — REP/GERENTE vê o próprio. ADMIN/DIRECTOR veem todos.

## Amostras

Envio de produto grátis pro cliente avaliar. Estados:

```
RASCUNHO ─► ENVIADA ─► CONVERTIDA (virou pedido)
                  └──► EXPIRADA (sem retorno em N dias)
```

Follow-up automático: `Amostra.dataEnvio + diasFollowup` calcula próxima ação. Trigger BullMQ (`AMOSTRA_FOLLOWUP`) dispara fluxo de automação quando vence.

## Fluxos típicos

### A. Pedido normal (REP, desconto dentro do teto)

1. REP `/pedidos/novo` → seleciona cliente da carteira
2. Adiciona itens, ajusta quantidades, aplica descontos
3. Clica "Pré-visualizar" → backend calcula totais
4. "Salvar como pedido" → status `RASCUNHO`
5. "Enviar ao OMIE" → push direto, status `ENVIADO_OMIE`
6. Cliente recebe boleto/NFe do OMIE
7. **Pontos fidelidade creditados** automaticamente (se programa ativo)

### B. Pedido com desconto acima do teto

1. REP cria pedido com desconto 25% (teto = 15%)
2. **Obrigatório**: preencher `motivoDesconto` (validação Zod)
3. Pedido vira `AGUARDANDO_APROVACAO`, cria `AprovacaoDesconto`
4. GERENTE recebe notificação (in-app + opcional WhatsApp)
5. GERENTE em `/aprovacoes` aprova ou rejeita com motivo
6. Se aprovado: REP pode mandar ao OMIE

### C. Proposta convertida em pedido

1. REP cria `Proposta` com validade 30 dias
2. Compartilha link público com cliente (PDF gerado)
3. Cliente aceita por WhatsApp/e-mail
4. REP marca `ACEITA` em `/propostas/:id`
5. Clica "Converter em pedido" → novo `Pedido` herda itens/preços/condições

### D. Fechamento de mês (DIRECTOR)

1. Dia 1 do mês seguinte, cron auto-fecha 04:00 UTC
2. DIRECTOR em `/comissoes` confere por rep
3. Para cada linha, clica "Marcar como pago" após transferir
4. Audit log registra quem pagou quando

### E. Amostra que converte

1. REP em `/amostras` cria envio (cliente + produtos + dias follow-up)
2. Marca `ENVIADA` quando despacha
3. Em N dias, cron dispara `AMOSTRA_FOLLOWUP` → fluxo manda WhatsApp pro REP "ligar pro cliente"
4. REP cria pedido pro cliente
5. REP volta em `/amostras/:id` → marca `CONVERTIDA`, vincula `pedidoId`
6. Relatório mostra taxa de conversão das amostras
