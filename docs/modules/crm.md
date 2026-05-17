# CRM — Clientes, Tags, Documentos, Catálogo, Produtos

## Clientes

CRUD multi-tenant com filtros por carteira (REP vê apenas próprios).

### Listas dinâmicas

`GET /clientes?lista=<tipo>` retorna recortes prontos:

| Lista | Critério |
|---|---|
| `todos` | Todos da empresa (com filtro de carteira por papel) |
| `ativos` | `omieStatus=ATIVO` |
| `bloqueados` | `omieStatus=BLOQUEADO` no OMIE |
| `sem_pedido_30d` | Sem pedido nos últimos 30 dias |
| `top_faturamento` | Top 20 por faturamento acumulado |
| `novos` | Criados nos últimos 30 dias |
| `aniversariantes` | Aniversário nos próximos 30 dias |

### Notas privadas

Cada cliente tem `ClienteNota[]`. Autor edita as próprias; ADMIN força edição. Não trafega pelo log público.

### Documentos (Supabase Storage)

Upload via signed URL pro bucket `documentos`. Limite 10MB. Tipos comuns: contrato, ficha cadastral, RG, comprovante endereço.

### Bulk assign rep

`POST /clientes/bulk-assign-rep` — DIRECTOR/GERENTE atribui muitos clientes a um rep de uma vez (após uma reorganização de carteira).

### Sync OMIE

Cron diário 04:00 UTC, **incremental** por `data_alteracao > IntegracaoConexao.ultimoSync`. `POST /integracoes/omie/sync/forcar` força modo completo.

`Cliente.omieStatus` é binário (`ATIVO` | `BLOQUEADO`). Motivo do bloqueio fica no OMIE — rep não precisa saber detalhes (D2).

## Tags

Etiquetas livres por empresa. CRUD com contagem (quantos clientes usam cada tag).

Aplicação:
- Cliente: `Cliente.tags[]` — segmentação para campanhas/fluxos
- Inbox: `Conversation.categoria` (enum diferente — não confundir)

## Produtos

CRUD com facets (categoria, linha, marca, etc.) e validações de unicidade por SKU + empresa.

### Atributos
- `precoTabela` (preço cheio)
- `precoFabrica` (custo — calculado por heurística OMIE 70% configurável via `OMIE_PRECO_FABRICA_RATIO`)
- `categoria`, `linha`, `marca`, `descricao`
- `ativo` (default true), `imagemUrl`

### Sync OMIE
Mesmo cron que clientes. Importa via `OmieClientService.listarProdutos`.

## Catálogo do Rep

**Subset personalizado** de Produtos para cada REP (D5):

- REP escolhe quais produtos da empresa entram no seu catálogo
- Aplica `markup%` por item (margem do rep sobre `precoTabela`)
- Resultado: catálogo final que ele compartilha com clientes via link público

### Endpoints

| Endpoint | O quê |
|---|---|
| `GET /catalogo` | Lista do REP autenticado |
| `POST /catalogo/itens` | Adiciona produto com markup |
| `PATCH /catalogo/itens/:id` | Edita markup |
| `DELETE /catalogo/itens/:id` | Remove do catálogo |
| `GET /catalogo/share/:token` | **Público** — view do catálogo via link |

## Pricing (`PricingService`)

Resolve o **preço final** para um item de pedido considerando 4 fontes em ordem de prioridade:

1. **Preço negociado** — `ClientePrecoEspecial` (importado do OMIE, validade aplicada)
2. **Markup do catálogo do rep** — se rep tem catálogo customizado
3. **Tabela padrão** — `Produto.precoTabela`
4. **Preço fábrica** — fallback raro (custo)

`priceForClientBatch({ clienteId, produtoIds })` retorna `Map<produtoId, { preco, fonte }>` em uma única query.

Decisão: usado tanto no `PedidoNovo` (preview) quanto no `Catalogo/share` (cliente vê).

## Fluxos típicos

### A. REP monta catálogo pra cliente novo

1. REP em `/catalogo` clica "Adicionar produtos"
2. Filtra por categoria/marca, seleciona 50 SKUs
3. Define markup% por item (ex: 30% sobre `precoTabela`)
4. Compartilha link `<frontend>/catalogo/<token>` com cliente via WhatsApp
5. Cliente abre, vê preços com markup aplicado — sem ver custo

### B. Cliente bloqueado no OMIE tenta pedido

1. REP cria pedido pra cliente em `/pedidos/novo`
2. Backend verifica `Cliente.omieStatus` → `BLOQUEADO`
3. Resposta: `BusinessRuleException CLIENTE_BLOQUEADO`
4. Frontend mostra alerta com link "Resolver com financeiro" → contato OMIE
