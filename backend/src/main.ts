import 'reflect-metadata';
// Sprint 3 FIX 5: inicializa Sentry ANTES de qualquer import que pode lançar.
// Loaders do Sentry envolvem o módulo http antes do Express ser carregado.
import { initSentry } from '@shared/observability/sentry';
initSentry();

import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvService } from '@config/env.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Preserva o body raw em req.rawBody — necessário para verificação HMAC em webhooks (OMIE, Meta, etc.)
    rawBody: true,
  });

  // Body parser limit explícito — default Express 100KB conflitava com:
  //   • Import CSV (`csvBody.csv` schema aceita até 1MB)
  //   • Webhooks com payload grande (Meta/OMIE com vários eventos batched)
  // Auditoria 2026-05-17 (P1): subir limite pra 2MB cobre os casos legítimos
  // sem virar vetor de DoS (rate-limit + AuthGuard global continuam ativos).
  // Usa `useBodyParser` (API oficial Nest) que respeita rawBody:true acima.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '2mb' });

  // Logger Pino como logger global
  app.useLogger(app.get(PinoLogger));

  const env = app.get(EnvService);

  // Audita config (ENCRYPTION_KEY fraca, OMIE em demo em prod, etc).
  // Em produção, problemas críticos abortam o boot — corrija antes de subir.
  env.enforceProductionReadiness();

  // Trust proxy — necessário pra que `req.ip` reflita o IP REAL do cliente
  // quando rodamos atrás de proxies (Railway, Nginx, Cloudflare).
  // Sem isso, `req.ip` é sempre o IP do proxy e o ML IP whitelist pode ser
  // contornado via header X-Forwarded-For (auditoria 2026-05-15, P0-2).
  //
  // Valor "1" = confia em 1 hop (o proxy imediato — Railway). Não use "true"
  // em produção pública porque permite spoof via XFF de origem desconhecida.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expressInstance = app.getHttpAdapter().getInstance() as any;
  if (typeof expressInstance.set === 'function') {
    expressInstance.set('trust proxy', 1);
    // Desabilita ETag automático do Express. Em APIs JSON autenticadas,
    // ETag causa 304 em /auth/me e similares — o browser cacheia e fetch
    // do frontend recebe body vazio ao receber 304, quebrando o fluxo
    // de login. APIs REST não devem usar HTTP cache validation por default.
    // Auditoria 2026-05-16 — login travado em produção.
    expressInstance.set('etag', false);
  }

  // Segurança HTTP
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Cookies httpOnly (refresh token de auth — D47)
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Empresa-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // Prefixo /api/v1
  app.setGlobalPrefix(env.get('API_PREFIX'));

  // Swagger / OpenAPI
  if (!env.isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Betinna.ai · API')
      .setDescription('Backend da plataforma comercial Betinna.ai')
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addServer(`http://localhost:${env.get('PORT')}`)
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // APM Sentry: error handler do Express. Captura exceptions que escaparam
  // do AllExceptionsFilter (raro, mas dá segurança extra). No-op se SENTRY_DSN
  // estiver vazio. Precisa ser ANTES do listen.
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(expressInstance);
  }

  // Encerramento gracioso
  app.enableShutdownHooks();

  const port = env.get('PORT');
  await app.listen(port, '0.0.0.0');

  const url = `http://localhost:${port}`;
  // eslint-disable-next-line no-console
  console.log(
    `\n🚀 Betinna.ai backend rodando\n   ${url}/${env.get('API_PREFIX')}/health\n   ${url}/docs (Swagger)\n`,
  );
}

bootstrap().catch((err) => {
  console.error('Falha fatal no bootstrap:', err);
  process.exit(1);
});
