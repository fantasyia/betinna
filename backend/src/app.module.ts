import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { TenantThrottlerGuard } from '@shared/guards/tenant-throttler.guard';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { EnvModule } from '@config/env.module';
import { EnvService } from '@config/env.service';
import { PrismaModule } from '@database/prisma.module';
import { buildBullMqConnection, createIORedisClient } from '@database/redis-options';
import { AmazonModule } from '@integrations/amazon/amazon.module';
import { EmailModule } from '@integrations/email/email.module';
import { GoogleModule } from '@integrations/google/google.module';
import { MLModule } from '@integrations/mercadolivre/ml.module';
import { MetaModule } from '@integrations/meta/meta.module';
import { OmieModule } from '@integrations/omie/omie.module';
import { ResendModule } from '@integrations/resend/resend.module';
import { ShopeeModule } from '@integrations/shopee/shopee.module';
import { TikTokModule } from '@integrations/tiktok/tiktok.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { EvolutionWebhookModule } from '@integrations/evolution/evolution-webhook.module';
import { CampanhasModule } from '@modules/campanhas/campanhas.module';
import { DeadLetterModule } from '@modules/dead-letter/dead-letter.module';
import { RelatoriosModule } from '@modules/relatorios/relatorios.module';
import { NpsModule } from '@modules/nps/nps.module';
import { MetasModule } from '@modules/metas/metas.module';
import { SegmentosModule } from '@modules/segmentos/segmentos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { ImportModule } from '@modules/import/import.module';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { BotPromptsModule } from '@modules/bot-prompts/bot-prompts.module';
import { AgendaModule } from '@modules/agenda/agenda.module';
import { IncidentsModule } from '@modules/incidents/incidents.module';
import { InboxModule } from '@modules/inbox/inbox.module';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { AmostrasModule } from '@modules/amostras/amostras.module';
import { BadgesModule } from '@modules/badges/badges.module';
import { AdminModule } from '@modules/admin/admin.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AuditModule } from '@modules/audit/audit.module';
import { BackupModule } from '@modules/backup/backup.module';
import { RespostasRapidasModule } from '@modules/respostas-rapidas/respostas-rapidas.module';
import { CatalogoModule } from '@modules/catalogo/catalogo.module';
import { ClientesModule } from '@modules/clientes/clientes.module';
import { ContatosModule } from '@modules/contatos/contatos.module';
import { CrmModule } from '@modules/crm/crm.module';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { MateriaisModule } from '@modules/materiais/materiais.module';
import { DevolucoesModule } from '@modules/devolucoes/devolucoes.module';
import { InboxInternaModule } from '@modules/inbox-interna/inbox-interna.module';
import { WhatsappPacingModule } from '@shared/whatsapp-pacing/whatsapp-pacing.module';
import { SupressaoModule } from '@shared/supressao/supressao.module';
import { EmpresasModule } from '@modules/empresas/empresas.module';
import { HealthModule } from '@modules/health/health.module';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { EmbeddingsModule } from '@integrations/embeddings/embeddings.module';
import { RagModule } from '@modules/rag/rag.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { FunisModule } from '@modules/funis/funis.module';
import { KanbanModule } from '@modules/kanban/kanban.module';
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
import { RODAR_BACKGROUND } from '@shared/utils/service-type';

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
              // Credenciais de integração chegam aninhadas em req.body.credenciais.<key> (POST
              // /integracoes/conectar) — fora do wildcard de 1 nível acima. Redige o objeto inteiro
              // + os segredos comuns aninhados em qualquer profundidade.
              'req.body.credenciais',
              '*.credenciais',
              '*.client_secret',
              '*.clientSecret',
              '*.partner_key',
              '*.partnerKey',
              '*.app_secret',
              '*.appSecret',
              '*.secret',
              '*.privateKey',
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

    // Rate limit global com 4 buckets nomeados (Sprint 2 P1):
    //  - default: 300 req/min — alvo dos overrides @Throttle({ default: {...} }) por rota
    //  - short: 10 req/s — burst protection
    //  - medium: 100 req/min — general API
    //  - long: 300 req/min — sustained per-user throughput
    //
    // CAÇADA-BUG #19: os 18 decorators `@Throttle({ default: {...} })` (login 10/15min, bootstrap
    // 3/15min, import 5/min, propostas, mullerbot, nps, whatsapp, catálogo-share) eram NO-OP — não
    // existia bucket 'default', então o guard nunca lia o override e o login ficava só nos limites
    // globais (~6000 tentativas/h por IP em vez de 40). Adicionar o bucket 'default' faz TODOS os
    // overrides passarem a valer. Como o guard exige `.every()` (todos os buckets), um override
    // STRICTER (login 10/15min) vira o gargalo e passa a proteger de fato. ⚠️ Overrides que queriam
    // AUMENTAR o cap (webhooks 200/min) seguem limitados pelo medium=100/min — sem regressão (já era
    // assim quando o override era no-op); pra webhooks passarem de 100/min, usar @SkipThrottle nos
    // buckets medium/long (follow-up).
    //
    // Storage: Redis (compartilhado entre réplicas). Em ambiente sem Redis
    // (test) cai pra in-memory automaticamente — `skipIf` faz bail.
    ThrottlerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        throttlers: [
          // base permissiva (só vale onde não há override); rotas normais já são capadas por medium.
          { name: 'default', ttl: seconds(60), limit: 300 },
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
                // CRÍTICO: usa createIORedisClient que JÁ vem com handler 'error'
                // attached. Sem isso, ioredis emite 'unhandled error event' em
                // qualquer ETIMEDOUT e Node.js MATA o processo. Hotpatch 2026-05-20.
                const redisUrl = env.get('REDIS_URL');
                return new ThrottlerStorageRedisService(
                  createIORedisClient(redisUrl, {
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                  }),
                );
              })(),
      }),
    }),

    // Cron jobs (sync OMIE, fechamento comissões, triggers de fluxo) — só no worker em produção.
    ...(RODAR_BACKGROUND ? [ScheduleModule.forRoot()] : []),

    // BullMQ — fila global (Redis). Cada módulo registra suas próprias filas.
    BullModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        // buildBullMqConnection detecta TLS pelo scheme da URL (rediss:// vs redis://).
        // maxRetriesPerRequest: null + enableReadyCheck: false = REQUISITO do BullMQ pras
        // conexões bloqueantes (BRPOPLPUSH do Worker). Sem null, após um reconnect do Redis
        // (ex: worker reiniciado) os comandos bloqueantes estouram "max retries" e o
        // consumidor/produtor PARA de funcionar em silêncio — a API (leituras não-bloqueantes)
        // segue OK, mas o worker deixa de enfileirar/consumir jobs de fluxo. Alinha com o
        // ThrottlerStorage e o RedisService, que já setam null.
        connection: buildBullMqConnection(env.get('REDIS_URL'), {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
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
    AdminModule,
    AuditModule,
    BackupModule,
    RespostasRapidasModule,
    PermissionsModule,
    AuthModule,
    UsersModule,
    EmpresasModule,
    TagsModule,
    BotPromptsModule,
    ClientesModule,
    ContatosModule,
    CrmModule,
    ProdutosModule,
    CatalogoModule,
    PedidosModule,
    PropostasModule,
    ComissoesModule,
    WhatsappPacingModule,
    SupressaoModule,
    MateriaisModule,
    DevolucoesModule,
    InboxInternaModule,
    AmostrasModule,
    BadgesModule,
    LeadsModule,
    FunisModule,
    KanbanModule,
    OcorrenciasModule,
    AgendaModule,
    FluxosModule,
    NpsModule,
    MetasModule,
    SegmentosModule,
    NotificacoesModule,
    ImportModule,
    CampanhasModule,
    RelatoriosModule,
    DeadLetterModule,
    InboxModule,
    IncidentsModule,
    MullerBotModule,
    EmbeddingsModule,
    RagModule,
    HealthModule,

    // Integrações externas
    IntegracoesModule,
    OmieModule,
    ResendModule,
    EmailModule,
    GoogleModule,
    WhatsAppModule,
    EvolutionWebhookModule,
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
