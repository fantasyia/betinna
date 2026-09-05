import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma exposto como provider injetável.
 * Gerencia ciclo de vida (connect/disconnect) automaticamente.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'error' },
              { emit: 'stdout', level: 'warn' },
            ]
          : [{ emit: 'stdout', level: 'error' }],
      errorFormat: 'pretty',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma conectado ao Postgres');
  }

  /**
   * Fase 3 do shutdown, NÃO a 1 (`onModuleDestroy`). O `@nestjs/bullmq` só drena
   * os workers em `onApplicationShutdown`; fechar aqui na fase 1 deixava o job de
   * IA rodando com a conexão já morta — "Connection is closed." no meio do envio,
   * passo FALHOU, re-execução no worker novo e o cliente recebendo a mensagem em
   * dobro (medido em 05/09). Na mesma fase, este módulo (raiz) fecha por último.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma desconectado');
  }

  /**
   * Helper pra usar em testes — limpa todas as tabelas respeitando FKs.
   * Bloqueado em produção por segurança.
   */
  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase() não pode rodar em produção');
    }
    const tablenames: { tablename: string }[] = await this.$queryRaw`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `;
    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await this.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`);
      }
    }
  }
}
