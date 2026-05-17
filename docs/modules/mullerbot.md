# MullerBot — Assistente IA com RAG

Assistente de IA do REP que responde perguntas sobre o **catálogo da empresa**. Faz RAG (retrieval-augmented generation) sobre os Produtos importados do OMIE.

## Arquitetura

```
Pergunta do REP
       │
       ▼
ProdutoSearchService (keyword scoring TF)
       │
       ▼
top-K produtos (catálogo compacto)
       │
       ▼
MullerBotService monta system prompt + contexto + pergunta
       │
       ▼
OpenAI Chat Completions (gpt-4o-mini default)
       │
       ▼
Resposta + lista de produtos referenciados
```

## Decisões chave

| Decisão | Por quê |
|---|---|
| **Apenas OpenAI** (D21) | Cliente pediu só uma integração — simplifica setup |
| **Keyword search em memória** (D22) | ≤500 produtos cabem em scoring TF; pgvector entra só quando volume justificar (interface pronta) |
| **System prompt proíbe alucinação** (D23) | "Use APENAS o catálogo fornecido. Se não encontrar, diga." — guardrail contra inventar SKU/preço |
| **REP precisa de chave OpenAI própria** (D39) | Cada rep paga o próprio crédito (rastreabilidade + isolamento de custo). ADMIN/DIRECTOR/GERENTE/SAC usam fallback `OPENAI_API_KEY` do env |
| **Truncate inteligente do catálogo** (D21b) | Pergunta longa → rejeita early; catálogo > orçamento → tenta versão compacta (sem descrição) antes de skipar |

## Scoring (`ProdutoSearchService`)

TF (term frequency) com pesos:

| Campo | Peso |
|---|---|
| `nome` | 3 |
| `marca` | 2 |
| `linha` / `categoria` | 1.5 |
| `descricao` | 1 |

Top-K configurável (`MULLERBOT_TOP_K`, default 10).

## Limites configuráveis

- `MULLERBOT_MAX_INPUT_TOKENS` (default 4000)
- `MULLERBOT_MAX_OUTPUT_TOKENS` (default 1024)
- `MULLERBOT_MODEL` (default `gpt-4o-mini`)
- `MULLERBOT_TOP_K` (default 10)

## Endpoint

`POST /mullerbot/perguntar` — body `{ pergunta: string }`. Resposta:

```json
{
  "resposta": "Para receita de bolo, recomendo o Açúcar Refinado XYZ...",
  "produtosReferenciados": [
    { "id": "prod-1", "nome": "Açúcar Refinado XYZ", "precoTabela": 4.50 }
  ],
  "produtosTruncados": 3,
  "modelo": "gpt-4o-mini",
  "tokensInput": 1230,
  "tokensOutput": 145
}
```

## Quando rejeita

- Pergunta `> MAX_INPUT_TOKENS - reserva` → `BusinessRuleException("Pergunta muito longa")`
- REP sem chave OpenAI configurada → `BusinessRuleException("Configure sua chave em /usuario/integracoes")`
- OpenAI 401/429 → propaga `IntegrationException` com sugestão

## Sync periódico

`OmieSyncJob` (cron 04:00 UTC) ressincroniza clientes + produtos em modo incremental. MullerBot sempre tem o catálogo atualizado.

## Limitações conhecidas (MVP)

- **Sem cache de respostas** — toda pergunta gera chamada OpenAI (custo)
- **Stateless** — cada pergunta é independente, sem histórico conversacional
- **Sem embeddings** — keyword scoring pode falhar em sinônimos ("doce" vs "açúcar"). Pgvector entra quando volume justificar.

## Fluxos típicos

### A. REP configura chave OpenAI

1. REP em `/usuario/integracoes` aba "OpenAI"
2. Cola API key (formato `sk-...`)
3. Backend testa com `GET /v1/models` → se 200, cifra AES-256-GCM e salva
4. UI mostra "✅ Conectado"

### B. REP pergunta sobre receita

1. REP em `/mullerbot` digita: "que produtos eu uso pra fazer brigadeiro?"
2. Backend filtra catálogo: top 10 produtos por keyword (cacau, leite condensado, manteiga)
3. Monta prompt:
   ```
   System: Você é assistente de catálogo da empresa X. Use APENAS os produtos abaixo.
   [catálogo top-10 com nome+marca+preço+descrição]
   User: que produtos eu uso pra fazer brigadeiro?
   ```
4. OpenAI responde citando 3 SKUs do catálogo
5. UI mostra resposta + cards dos produtos clicáveis (vai pra `/produtos/:id`)

### C. ADMIN testa o bot (sem chave própria)

1. ADMIN em `/mullerbot` pergunta algo
2. Backend não acha `UsuarioIntegracao(servico='openai')` pra esse user
3. Fallback: usa `OPENAI_API_KEY` do env (corporativo)
4. Funciona normalmente — custo cai no crédito da plataforma
