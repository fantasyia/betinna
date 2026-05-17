# Import / Export

## Export client-side (frontend)

Sem backend — gera arquivos no browser via lazy imports. Mantém bundle inicial leve.

| Formato | Lib | Lazy chunk | Caso de uso |
|---|---|---|---|
| **CSV** | `lib/csv.ts` (sem dep externa) | inline | Operacional (importar em outro sistema, BR-friendly com `;` separador + BOM UTF-8) |
| **Excel** (`.xlsx`) | `xlsx` v0.18 | ~430KB | Planilha tipada (data/número), múltiplas sheets, abrir no Excel |
| **Word** (`.docx`) | `docx` v9 | ~407KB | Documento estruturado (relatório, ficha cadastral) |
| **PDF** | `jspdf` + `jspdf-autotable` | ~390KB | Printable, share via WhatsApp/e-mail |

Plug em qualquer página: importar de `@/lib/{csv,xlsx,docx,pdf}` e usar `exportTo*({ endpoint, columns, filename })`.

### Telas com export plugado

- **ClientesPage** — 4 botões (CSV / Excel / Word / PDF)
- **PedidosPage** — 4 botões

Adicionar em outras telas: copia o padrão, ~20 linhas de código.

## Import bulk (backend)

`POST /api/v1/import/{clientes|produtos}` — recebe CSV em `body.csv` (string),
parsing tolerante via `papaparse`.

### Features

- Auto-detect separador: `,` `;` `\t` `|`
- BOM UTF-8 tolerado
- Headers case-insensitive + sinônimos pt-BR (`razao_social`, `e-mail`, `código`, etc)
- `dryRun: true` valida sem persistir
- `onDuplicate: 'skip' | 'update' | 'error'`
- Limite 5000 linhas/request (passa disso, frontend faz batches)
- Detalhes limitados a 100 (criados/atualizados/erros)

### Permissões

| Tipo | ADMIN | DIRECTOR | GERENTE | SAC | REP |
|---|:-:|:-:|:-:|:-:|:-:|
| Clientes | ✅ | ✅ | ✅ | ❌ | ❌ |
| Produtos | ✅ | ✅ | ❌ | ❌ | ❌ |

### Match de duplicatas

| Tipo | Match por |
|---|---|
| Clientes | CNPJ (limpo) → email |
| Produtos | SKU |

### Throttle

5 imports/minuto por tenant. Suficiente pra onboarding sem virar DoS no DB.

### Exemplo de payload

```json
POST /api/v1/import/clientes
{
  "csv": "nome,cnpj,email\nMinha Empresa,12.345.678/0001-90,a@a.com",
  "dryRun": false,
  "onDuplicate": "skip"
}
```

### Resposta

```json
{
  "total": 1,
  "criados": 1,
  "atualizados": 0,
  "pulados": 0,
  "erros": 0,
  "dryRun": false,
  "detalhes": [{ "linha": 2, "status": "criado", "id": "cli-xyz" }]
}
```

### CSV de exemplo (clientes)

```csv
nome,cnpj,email,telefone,cidade,uf,segmento
Padaria do Zé,12.345.678/0001-90,ze@padaria.com,11999998888,São Paulo,SP,Alimentos
Mercadão Central,98.765.432/0001-21,contato@mercadao.com,1133334444,Campinas,SP,Varejo
```

### CSV de exemplo (produtos)

Headers aceitos: `nome`, `sku|codigo`, `preco|precoTabela`, `marca`, `linha`, `categoria`, `unidade|un`.

```csv
nome;sku;preco;marca;categoria;unidade
Açúcar Refinado 5kg;ACU-REF-5K;28,90;União;Adoçantes;UN
Óleo de Girassol 5L;OLE-GIR-5L;48,00;Soya;Óleos;UN
```

### Estratégia de validação

- Linha sem `nome` → erro (motivo "nome obrigatório")
- CNPJ inválido → vira `null` (não bloqueia)
- Preço inválido em produto → erro (linha pulada, batch continua)
- `precoFabrica` calculado como `precoTabela × 0.7` (heurística — substituir pelo real quando OMIE tabela auxiliar estiver disponível)
