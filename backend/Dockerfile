# syntax=docker/dockerfile:1.6
# ─────────────────────────────────────────────────────────────────────────
# Dockerfile do backend Betinna.ai (Sprint 3 FIX 8)
# Multi-stage build com Node 24 alpine — imagem final ~150MB
# ─────────────────────────────────────────────────────────────────────────

# Stage 1: install deps + build
FROM node:24-alpine AS builder

# Healthcheck precisa de curl no runtime; mas no builder também precisamos
# de openssl pra Prisma generate em alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copia manifests primeiro pra cache de layers
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY tsconfig*.json nest-cli.json ./

# Instala TODAS as deps (incluindo dev) para build
RUN npm ci --include=dev

# Copia código e builda
COPY src ./src
RUN npm run build && \
    npm prune --production

# ─────────────────────────────────────────────────────────────────────────
# Stage 2: runtime image — mínima, apenas dist + node_modules de produção
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

# postgresql-client para os scripts de backup (chamados externamente, não pelo
# app, mas é útil ter no container caso queira rodar via `docker exec`)
# curl para healthcheck
RUN apk add --no-cache openssl libc6-compat curl postgresql-client redis

# Cria user não-root pra segurança
RUN addgroup -g 1001 betinna && \
    adduser -u 1001 -G betinna -s /bin/sh -D betinna

WORKDIR /app

# Copia apenas o necessário do builder
COPY --from=builder --chown=betinna:betinna /app/node_modules ./node_modules
COPY --from=builder --chown=betinna:betinna /app/dist ./dist
COPY --from=builder --chown=betinna:betinna /app/prisma ./prisma
COPY --from=builder --chown=betinna:betinna /app/package.json ./package.json

USER betinna

ENV NODE_ENV=production

# Railway injects PORT dynamically — do not hardcode
# HEALTHCHECK removed - Railway has its own healthcheck via /api/v1/health

# dist/main.js é a entry point do NestJS após build
CMD ["node", "dist/main.js"]
