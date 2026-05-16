# Load Tests · Betinna.ai

Sprint 5 FIX 3 — k6 load tests pra validar Railway auto-scaling + budgets.

## Pré-requisitos

- [k6](https://k6.io/docs/getting-started/installation/) instalado
- Variáveis de ambiente preenchidas (veja `.env.k6.example`)

## Variáveis

| Var | Default | Descrição |
|---|---|---|
| `BASE_URL` | `http://localhost:3001` | URL backend (com ou sem `/api/v1`) |
| `TEST_EMAIL` | `admin@betinna.ai` | User de teste pra POST /auth |
| `TEST_PASSWORD` | `Betinna@2026` | Senha do user de teste |
| `SUPABASE_URL` | — | URL Supabase pra obter token JWT |
| `SUPABASE_ANON_KEY` | — | apikey header pra Supabase Auth |

## Scripts

```bash
# Smoke — sanity check (1 VU, 30s)
BASE_URL=https://betinna-api.up.railway.app k6 run load-tests/smoke.js

# Stress — ramp 0 → 50 VUs em 2min, sustain 1min, ramp down
BASE_URL=https://betinna-api.up.railway.app k6 run load-tests/stress.js

# Spike — 0 → 100 VUs instantâneo, sustain 30s, drop
BASE_URL=https://betinna-api.up.railway.app k6 run load-tests/spike.js
```

## Thresholds (assertions)

### Smoke
- p95 < 500ms
- error rate < 1%

### Stress
- p95 < 2000ms
- error rate < 5%

### Spike
- Sistema sobrevive sem crash
- Recovery em ≤ 60s após drop dos VUs

## Como ler resultados

k6 imprime no final:
- `http_req_duration{...p(95)}` — latência p95
- `http_req_failed` — rate de falhas
- `iterations` — total de requests
- Linhas vermelhas = threshold quebrado (build falha)

## Próximos passos

1. Rodar smoke contra Railway staging — confirmar p95 < 500ms
2. Rodar stress em janela de baixa atividade — confirmar Railway escala
3. Rodar spike pra validar comportamento sob pico (Black Friday-like)
4. Considerar [k6 Cloud](https://k6.io/cloud) pra runs distribuídos (mais VUs)
