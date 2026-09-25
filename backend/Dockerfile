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
COPY scripts ./scripts/
COPY tsconfig*.json nest-cli.json ./

# Instala TODAS as deps (incluindo dev) para build
RUN npm ci --include=dev

# Copia código e builda
COPY src ./src
# Modelos de documento (o contrato do Anexo I é montado pelo app a partir daqui)
COPY assets ./assets
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

# Word → PDF do contrato (Léo, 25/09): o cliente lê e assina o MESMO PDF, e o
# navegador não desenha o .docx direito (imagens EMF somem, não há páginas).
# Fontes: Liberation (Arial/Times), Carlito (Calibri), DejaVu (reserva) e a
# Source Sans Pro, que é a do corpo do modelo e não tem pacote no Alpine —
# baixada da release oficial da Adobe (OFL), com versão fixa.
RUN apk add --no-cache libreoffice-writer fontconfig font-liberation font-carlito ttf-dejavu unzip && \
    mkdir -p /usr/share/fonts/source-sans-pro && \
    curl -fsSL -o /tmp/ssp.zip \
      https://github.com/adobe-fonts/source-sans/releases/download/3.006R/source-sans-pro-3.006R.zip && \
    unzip -q /tmp/ssp.zip -d /tmp/ssp && \
    find /tmp/ssp -name '*.ttf' -exec cp {} /usr/share/fonts/source-sans-pro/ \; && \
    rm -rf /tmp/ssp /tmp/ssp.zip
COPY assets/fonts/60-contrato.conf /etc/fonts/conf.d/60-contrato.conf
RUN fc-cache -f && fc-list | grep -q "Source Sans Pro"

# Cria user não-root pra segurança
RUN addgroup -g 1001 betinna && \
    adduser -u 1001 -G betinna -s /bin/sh -D betinna

WORKDIR /app

# Copia apenas o necessário do builder
COPY --from=builder --chown=betinna:betinna /app/node_modules ./node_modules
COPY --from=builder --chown=betinna:betinna /app/dist ./dist
COPY --from=builder --chown=betinna:betinna /app/prisma ./prisma
# Sem isto o contrato não sai: o modelo .docx é lido do disco em runtime
# (process.cwd()/assets), e o `dist` não carrega arquivo que não é .ts.
COPY --from=builder --chown=betinna:betinna /app/assets ./assets
COPY --from=builder --chown=betinna:betinna /app/package.json ./package.json
# scripts/ inclui deploy-migrations.js (smart, baseline-aware) — usado no CMD
COPY --from=builder --chown=betinna:betinna /app/scripts ./scripts

USER betinna

ENV NODE_ENV=production

# Railway injects PORT dynamically — do not hardcode
# HEALTHCHECK removed - Railway has its own healthcheck via /api/v1/health

# Start wrapper: roda smart migrate + escolhe api/worker baseado em SERVICE_TYPE.
# Railway: API service → SERVICE_TYPE=api, Worker service → SERVICE_TYPE=worker.
# Idempotente. Se migration falhar, container exit code != 0 e Railway aplica
# restart policy.
CMD ["node", "scripts/start.js"]
