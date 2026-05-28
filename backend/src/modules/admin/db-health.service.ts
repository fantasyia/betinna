import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/**
 * DbHealthService — visibilidade sobre o tamanho do banco Postgres.
 *
 * Criado em 2026-05-27 depois que o disco do Railway encheu e travou o
 * Postgres em recovery. Objetivo: dar visibilidade pro ADMIN ver qual
 * tabela mais ocupa espaço e detectar crescimento descontrolado antes
 * do disco estourar de novo.
 *
 * Tudo é leitura. Sem migrations, sem cleanup automático aqui — o ADMIN
 * decide o que fazer com a informação.
 */

export interface TabelaTamanho {
  tabela: string;
  bytes: number;
  tamanhoFmt: string;
  linhasAprox: number;
}

export interface DbHealthStats {
  /** Tamanho total do banco em bytes. */
  totalBytes: number;
  /** Tamanho total formatado (ex: "234 MB"). */
  totalFmt: string;
  /** Top 30 tabelas por tamanho (decrescente). */
  tabelas: TabelaTamanho[];
  /** Quando foi medido (now no servidor). */
  medidoEm: Date;
}

@Injectable()
export class DbHealthService {
  private readonly logger = new Logger(DbHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<DbHealthStats> {
    // Total do banco
    const totalRow = await this.prisma.$queryRawUnsafe<{ total_bytes: bigint }[]>(
      `SELECT pg_database_size(current_database()) AS total_bytes`,
    );
    const totalBytes = Number(totalRow[0]?.total_bytes ?? 0n);

    // Top 30 tabelas (inclui índices via pg_total_relation_size)
    const tabelasRaw = await this.prisma.$queryRawUnsafe<
      Array<{
        tabela: string;
        bytes: bigint;
        tamanho_fmt: string;
        linhas_aprox: bigint;
      }>
    >(
      `SELECT
         c.relname AS tabela,
         pg_total_relation_size(c.oid) AS bytes,
         pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho_fmt,
         c.reltuples::bigint AS linhas_aprox
       FROM pg_class c
       LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname = 'public'
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 30`,
    );

    return {
      totalBytes,
      totalFmt: this.formatBytes(totalBytes),
      tabelas: tabelasRaw.map((r) => ({
        tabela: r.tabela,
        bytes: Number(r.bytes),
        tamanhoFmt: r.tamanho_fmt,
        linhasAprox: Number(r.linhas_aprox),
      })),
      medidoEm: new Date(),
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }
}
