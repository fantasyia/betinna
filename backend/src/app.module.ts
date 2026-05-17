import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { TenantThrottlerGuard } from '@shared/guards/tenant-throttler.guard';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import IORedis from 'ioredis';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { EnvModule } from '@config/env.module';
import { EnvService } from '@config/env.service';
import { PrismaModule } from '@database/prisma.module';
import { buildBullMqConnection, buildRedisOptions } from '@database/redis-options';
import { AmazonModule } from '@integrations/amazon/amazon.module';
import { GoogleModule } from '@integrations/google/google.module';
import { MLModule } from '@integrations/mercadolivre/ml.module';
import { MetaModule } from '@integrations/meta/meta.module';
import { OmieModule } from '@integrations/omie/omie.module';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { ShopeeModule } from '@integrations/shopee/shopee.module';
import { TikTokModule } from '@integrations/tiktok/tiktok.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { CampanhasModule } from '@modules/campanhas/campanhas.module';
import { DeadLetterModule } from '@modules/dead-letter/dead-letter.module';
import { RelatoriosModule } from '@modules/relatorios/relatorios.module';
import { FidelidadeModule } from '@modules/fidelidade/fidelidade.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { ImportModule } from '@modules/import/import.module';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { AgendaModule } from '@modules/agenda/agenda.module';
import { IncidentsModule } from '@modules/incidents/incidents.module';
import { InboxModule } from '@modules/inbox/inbox.module';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { AmostrasModule } from '@modules/amostras/amostras.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AuditModule } from '@modules/audit/audit.module';
import { CatalogoModule } from '@modules/catalogo/catalogo.module';
import { ClientesModule } from '@modules/clientes/clientes.module';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { EmpresasModule } from '@modules/empresas/empresas.module';
import { HealthModule } from '@modules/health/health.module';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { OcorrenciasModule } from '@modules/ocorrencias/ocorrencias.module';
import { PedidosModule } from '@modules/pedidos/pedidos.module';
import { PermissionsModule } from '@modules/permissions/permissions.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { PropostasModule } from '@modules/propostas/propostas.module';
import { TagsModule } from '@modules/tags/tags.module';
import { UsersModule } from '@modules/users/users.module';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';
import { MetricsModule } from '@shared/observability/metrics.module';
import { HttpModule } from '@shared/http/http.module';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { RepScopeModule } from '@shared/scope/rep-scope.module';
import { RequestIdMiddleware } from '@shared/utils/request-id.middleware';
import { SharedUtilsModule } from '@shared/utils/shared-utils.module';

@Module({
  imports: [
    EnvModule,
    PrismaModule,

    // Logger estruturado com Pino
    LoggerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        pinoHttp: {
          level: env.get('LOG_LEVEL'),
          transport: env.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.senha',
              'req.body.token',
              'req.body.apiKey',
              '*.apiKey',
              '*.password',
              '*.senha',
              '*.token',
              '*.access_token',
              '*.refresh_token',
            ],
            censor: '[REDACTED]',
          },
          customLogLevel: (_req, res, err) => {
            if (err) return 'error';
            if (res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
        },
      }),
    }),

    // Rate limit global com 3 buckets nomeados (Sprint 2 P1):
    //  - short: 10 req/s — burst protection
    //  - medium: 100 req/min — general API
    //  - long: 300 req/min — sustained per-user throughput
    //
    // Endpoints específicos (auth, webhooks, whatsapp) podem aplicar
    // @Throttle({ <bucket>: { limit, ttl } }) para sobrescrever.
    //
    // Storage: Redis (compartilhado entre réplicas). Em ambiente sem Redis
    // (test) cai pra in-memory automaticamente — `skipIf` faz bail.
    ThrottlerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        throttlers: [
          { name: 'short', ttl: seconds(1), limit: 10 },
          { name: 'medium', ttl: seconds(60), limit: 100 },
          { name: 'long', ttl: seconds(60), limit: 300 },
        ],
        // Skip throttling em test pra não interferir
        skipIf: () => env.get('NODE_ENV') === 'test',
        storage:
          env.get('NODE_ENV') === 'test'
            ? undefined // in-memory pra tests
            : (() => {
                // buildRedisOptions detecta TLS pelo scheme da URL (rediss:// vs redis://)
                const redisUrl = env.get('REDIS_URL');
                return new ThrottlerStorageRedisService(
                  new IORedis(
                    redisUrl,
                    buildRedisOptions(redisUrl, {
                      maxRetriesPerRequest: null,
                      enableReadyCheck: false,
                    }),
                  ),
                );
              })(),
      }),
    }),

    // Cron jobs (sync OMIE, fechamento comissões, triggers de fluxo)
    ScheduleModule.forRoot(),

    // BullMQ — fila global (Redis). Cada módulo registra suas próprias filas.
    BullModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        // buildBullMqConnection detecta TLS pelo scheme da URL (rediss:// vs redis://)
        connection: buildBullMqConnection(env.get('REDIS_URL')),
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 500 },
        },
      }),
    }),

    // Infraestrutura compartilhada
    HttpModule,
    RepScopeModule,
    SharedUtilsModule,
    MetricsModule,

    // Módulos do domínio
    AuditModule,
    PermissionsModule,
    AuthModule,
    UsersModule,
    EmpresasModule,
    TagsModule,
    ClientesModule,
    ProdutosModule,
    CatalogoModule,
    PedidosModule,
    PropostasModule,
    ComissoesModule,
    AmostrasModule,
    LeadsModule,
    OcorrenciasModule,
    AgendaModule,
    FluxosModule,
    FidelidadeModule,
    NotificacoesModule,
    ImportModule,
    CampanhasModule,
    RelatoriosModule,
    DeadLetterModule,
    InboxModule,
    IncidentsModule,
    MullerBotModule,
    HealthModule,

    // Integrações externas
    IntegracoesModule,
    OmieModule,
    SendGridModule,
    GoogleModule,
    WhatsAppModule,
    MetaModule,
    MLModule,
    ShopeeModule,
    AmazonModule,
    TikTokModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // TenantThrottlerGuard estende ThrottlerGuard padrão usando empresaId
    // como chave (cai pro IP quando não há user). Resolve cenários de NAT
    // compartilhado entre tenants.
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
