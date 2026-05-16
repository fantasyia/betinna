import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';

/**
 * Gerador atômico de números sequenciais por empresa+tipo.
 *
 * Resolve dois bugs da auditoria:
 *  - Race condition em `count() + 1` (dois creates concorrentes geram o mesmo número)
 *  - Cross-tenant collision em `Proposta.numero @unique` global
 *
 * Estratégia:
 *  1. Redis `INCR seq:{empresaId}:{tipo}` — atomic, milhões de ops/s
 *  2. Persiste em `EmpresaSequence` para durabilidade (Redis pode reiniciar)
 *  3. No boot, `seedFromDb()` repopula Redis a partir da tabela
 *
 * Uso:
 *   const n = await this.sequence.next(empresaId, 'pedido');
 *   const numero = `PED-${String(n).padStart(4, '0')}`;
 */
@Injectable()
export class SequenceService implements OnModuleInit {
  private readonly logger = new Logger(SequenceService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Boot warm-up: garante que Redis tem o último valor de cada sequência.
    await this.seedFromDb().catch((err) => {
      this.logger.warn(
        `Falha no seed inicial de sequências (continuando): ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /**
   * Próximo número da sequência (atomic). Cresce 1 a cada chamada.
   *
   * @param empresaId  Tenant
   * @param tipo  'pedido' | 'proposta' | 'ocorrencia' | etc.
   */
  async next(empresaId: string, tipo: string): Promise<number> {
    const key = this.redisKey(empresaId, tipo);
    const novo = await this.redis.incr(key);

    // Persiste de forma best-effort (não bloqueia o caller se DB lento)
    void this.prisma.empresaSequence
      .upsert({
        where: { empresaId_tipo: { empresaId, tipo } },
        update: { ultimo: novo },
        create: { empresaId, tipo, ultimo: novo },
      })
      .catch((err) => {
        this.logger.warn(
          `Falha persistindo sequência ${empresaId}/${tipo}=${novo}: ${err instanceof Error ? err.message : err}`,
        );
      });

    return novo;
  }

  /**
   * Lê o último valor da sequência sem incrementar (uso em auditoria/UI).
   */
  async peek(empresaId: string, tipo: string): Promise<number> {
    const v = await this.redis.get(this.redisKey(empresaId, tipo));
    if (v != null) return Number(v);
    const row = await this.prisma.empresaSequence.findUnique({
      where: { empresaId_tipo: { empresaId, tipo } },
      select: { ultimo: true },
    });
    return row?.ultimo ?? 0;
  }

  /**
   * Boot: carrega o último valor de cada sequência do DB pro Redis.
   * Necessário quando Redis é volátil ou foi reiniciado.
   *
   * Estratégia: SET key = ultimo (NÃO usa SETNX — se DB tem valor maior que
   * Redis, prevalece o DB para evitar colisão).
   */
  async seedFromDb(): Promise<void> {
    const all = await this.prisma.empresaSequence.findMany({
      select: { empresaId: true, tipo: true, ultimo: true },
    });
    for (const s of all) {
      const key = this.redisKey(s.empresaId, s.tipo);
      // Apenas atualiza Redis se DB > Redis (evita decrementar caso outro pod já incrementou)
      const atual = await this.redis.get(key).catch(() => null);
      const atualNum = atual ? Number(atual) : 0;
      if (s.ultimo > atualNum) {
        await this.redis.set(key, s.ultimo);
      }
    }
    if (all.length > 0) {
      this.logger.log(`SequenceService: seed concluído — ${all.length} sequência(s)`);
    }
  }

  private redisKey(empresaId: string, tipo: string): string {
    return `seq:${empresaId}:${tipo}`;
  }
}
