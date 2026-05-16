# Monitoring · Betinna.ai

Guia de configuração de monitoramento externo via **UptimeRobot** (Sprint 5 FIX 5).

UptimeRobot é gratuito até 50 monitores com check de 5min — suficiente pra Betinna.ai
em estado MVP. Quando volume crescer, considerar migrar pra Datadog/Better Uptime.

---

## Pré-requisitos

1. Conta em [uptimerobot.com](https://uptimerobot.com) (gratuita)
2. Deploy Railway funcionando — `https://betinna-api.up.railway.app` e
   `https://betinna.up.railway.app` respondem 200 em `/api/v1/health` e `/`
3. Token de ADMIN do Betinna.ai pra `/health/deep` (gerar via login → copiar do `/auth/me`)

---

## Monitor 1 — Liveness API (5 min)

**Objetivo:** confirmar que processo NestJS está vivo e respondendo.

| Campo | Valor |
|---|---|
| Type | HTTP(s) |
| Friendly Name | `Betinna · API · Liveness` |
| URL | `https://betinna-api.up.railway.app/api/v1/health` |
| Monitoring Interval | 5 minutes (`Free` plan) |
| Monitor Timeout | 30 seconds |
| HTTP Method | `GET` |
| Expected Status Codes | `200` |

**Alert when:** status ≠ 200 OU response time > 10s

### Como configurar
1. Dashboard UptimeRobot → **Add New Monitor**
2. Cole os valores da tabela acima
3. Em "Alert Contacts To Notify": marque `Email` (cadastrar email DIRETOR)
4. Salvar

---

## Monitor 2 — Deep health (15 min)

**Objetivo:** validar que DB, Redis e BullMQ estão saudáveis (não apenas API viva).

⚠️ Esse endpoint exige token ADMIN — UptimeRobot precisa enviar header customizado.

| Campo | Valor |
|---|---|
| Type | HTTP(s) |
| Friendly Name | `Betinna · API · Deep Health` |
| URL | `https://betinna-api.up.railway.app/api/v1/health/deep` |
| Monitoring Interval | 15 minutes |
| Monitor Timeout | 30 seconds |
| HTTP Method | `GET` |
| **Custom HTTP Headers** | `Authorization: Bearer <ADMIN_TOKEN>` |
| **Custom HTTP Headers** | `X-Empresa-Id: <ADMIN_EMPRESA_ID>` |
| Expected Status Codes | `200` |

**Como obter o ADMIN_TOKEN para o header:**
```bash
# 1. Login via Supabase (ou via UI Betinna)
curl -X POST 'https://[ref].supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: [SUPABASE_ANON_KEY]' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@betinna.ai","password":"..."}'

# 2. Copiar `access_token` da resposta
# 3. Token expira em ~1h — UptimeRobot vai começar a falhar
#    → ALTERNATIVA: criar um "service token" de longa duração via Supabase
#      ou usar refresh-track endpoint (Sprint 3 FIX 2)
```

**⚠️ Considere:** se renovação do token virar dor de cabeça, criar um endpoint
`/health/internal` com shared secret HMAC (sem JWT) específico pra monitoring.

---

## Monitor 3 — Frontend keyword check (5 min)

**Objetivo:** confirma que o frontend SPA está servindo e o JS carrega
(detectar 500 do nginx Railway, broken build, certs vencidos).

| Campo | Valor |
|---|---|
| Type | **Keyword** |
| Friendly Name | `Betinna · Frontend · Keyword` |
| URL | `https://betinna.up.railway.app` |
| Monitoring Interval | 5 minutes |
| Monitor Timeout | 30 seconds |
| **Keyword Type** | `Keyword Exists` |
| **Keyword** | `Betinna` |

Se a string "Betinna" não aparecer no HTML retornado → alerta.

⚠️ **Limitação:** UptimeRobot Free pode rodar JS — então o monitor checa o HTML
*server-rendered*. Como Vite serve `index.html` com `<title>Betinna.ai</title>`,
a keyword "Betinna" vai estar lá direto. ✅

---

## Alert Contacts

### Email (sempre)
- **Quem:** DIRETOR(es) da empresa-cliente
- **Quando:** Falha na 1ª checada (após `down` confirmado em retry)
- Cadastrar em UptimeRobot → My Settings → Alert Contacts → Add

### SMS (escalação após 3 falhas consecutivas)
- **Quem:** Plantão técnico (você + 1 backup)
- **Quando:** Após 3 falhas consecutivas (15min de downtime do M1, 45min do M2)
- UptimeRobot Free não tem SMS — opções:
  1. Upgrade pra plano "Pro" (~$7/mo)
  2. Usar [Telegram Bot](https://uptimerobot.com/help/?lang=en-US&i=84) (free, integrado)
  3. Usar email → email-to-SMS gateway (operadora-dependente)

### Slack (opcional)
- UptimeRobot suporta webhook → Slack channel `#betinna-alerts`
- Configurar via Alert Contacts → Add → Webhook

---

## Status Page (público ou semi-público)

UptimeRobot oferece [status pages](https://stats.uptimerobot.com/) grátis.

Recomendado:
- URL custom: `status.betinna.ai` (configurar DNS pra apontar pro UptimeRobot)
- Exibe os 3 monitores acima
- Stakeholders veem realtime sem precisar login

---

## Política de resposta a alertas

| Severidade | Critério | SLA resposta |
|---|---|---|
| **Crítico** | M1 (Liveness) down > 5min | 15min |
| **Alto** | M2 (Deep) down > 30min | 1h |
| **Médio** | M3 (Keyword) down > 30min | 2h |
| **Baixo** | 1 falha isolada que recupera sozinha | Análise no próximo dia útil |

### Playbook de incident response

1. **Confirmar:** abrir `/api/v1/health` manualmente. Falha confirma alerta.
2. **Diagnose rápido (5min):**
   - Railway dashboard → API service → Logs (últimos 5min)
   - Sentry → Issues novos (últimos 30min)
   - UptimeRobot → ver qual monitor caiu primeiro
3. **Mitigação imediata (15min):**
   - Se erro de deploy: rollback Railway (deploy anterior)
   - Se OOM/CPU: aumentar recursos no Railway dashboard
   - Se DB down: ver status Railway Postgres plugin
   - Se Redis down: idem
4. **Comunicar:** Slack `#betinna-alerts` com status + ETA
5. **Postmortem:** documentar em `docs/incidents/YYYY-MM-DD-titulo.md` em até 48h

---

## Métricas internas (Sentry + Railway)

UptimeRobot é apenas **uptime external** — pra latência/erros granulares:

| Métrica | Onde |
|---|---|
| Erros 5xx | Sentry → Issues |
| Latência p95 por endpoint | Sentry → Performance (se tracing habilitado) |
| CPU/Memory Railway | Railway dashboard → Service → Metrics |
| Queue depth BullMQ | `GET /health/deep` → `checks.bullmq.queues` |
| Dead-letter count | `GET /admin/dead-letter` (admin only) |

---

## Próximos passos (Sprint 6+)

- Datadog ou Better Uptime quando ultrapassar 50 monitores grátis
- Synthetics tests (passos: login → fazer pedido) — Datadog Browser Tests ou Checkly
- Real User Monitoring (RUM) — Sentry Performance ou Datadog RUM
- SLO dashboard público em `status.betinna.ai`
