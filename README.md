# Betinna.ai

[![CI](https://github.com/fantasyia/MSM_alimentos/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fantasyia/MSM_alimentos/actions/workflows/ci.yml)
[![Security](https://github.com/fantasyia/MSM_alimentos/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/fantasyia/MSM_alimentos/actions/workflows/security.yml)
[![Backup](https://github.com/fantasyia/MSM_alimentos/actions/workflows/backup.yml/badge.svg?branch=main)](https://github.com/fantasyia/MSM_alimentos/actions/workflows/backup.yml)

Plataforma comercial B2B para indústria de alimentos / químicos / bebidas / embalagens.

## Stack

- **Backend:** NestJS 11 + TypeScript + Prisma 6 (Postgres/Supabase) + BullMQ + Redis
- **Frontend:** Vite + React 18 + React Router 6
- **Auth:** Supabase
- **Deploy:** Railway (Web + Worker + Frontend + Postgres + Redis plugins)
- **Observability:** Pino + Sentry + UptimeRobot
- **Testing:** Vitest (332 unit) + Playwright (10 E2E)

## Status

| | Status |
|---|---|
| 🔴 P0 vulnerabilities | **0** |
| 🟠 P1 vulnerabilities | **0** |
| 🧪 Unit tests | **332/332** passing |
| 🎭 E2E tests | **10** ready |
| 📦 Initial bundle | **67.42 KB gzipped** |
| 🚦 Production deploy | ✅ **GO** |

## Quick start

```bash
# Backend
cd backend
npm install
npm run db:push           # aplica schema no Supabase
npm run db:seed           # admin@betinna.ai (senha = SEED_ADMIN_PASSWORD do .env.local)
npm run start:dev         # http://localhost:3001/api/v1/health

# Worker (separado)
npm run worker:dev

# Frontend
cd ../frontend
npm install
npm run dev               # http://localhost:5173

# Tests
cd backend && npm test
cd ../frontend && npx playwright test
```

## Documentação

- [Sprint reports](backend/_audit/) — auditorias de segurança + 5 sprints de fixes
- [Monitoring guide](docs/monitoring.md) — UptimeRobot setup
- [Restore runbook](docs/restore-runbook.md) — recuperação de backup
- [Env vars Railway](env.example.railway.txt) — vars de produção
- [CHANGELOG](CHANGELOG.md) — versionamento semântico

## Deploy

Production runs on Railway com 3 services + 2 plugins:

| Service | Tipo | URL |
|---|---|---|
| `api` | NestJS Web | `https://betinna-api.up.railway.app` |
| `worker` | BullMQ Worker | (sem URL pública) |
| `frontend` | Vite SPA | `https://betinna.up.railway.app` |
| `postgres` | Plugin Railway | (interno) |
| `redis` | Plugin Railway | (interno) |

CI/CD: GitHub Actions auto-deploya em `push origin main`. PRs apenas buildam + testam.

## License

UNLICENSED — propriedade do cliente.
