import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

export interface AuditEntry {
  usuarioId?: string | null;
  empresaId?: string | null;
  acao: string;
  recurso: string;
  recursoId?: string | null;
  detalhes?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Serviço de auditoria.
 *
 * Gravação assíncrona (não bloqueia request). Falhas em audit log nunca
 * derrubam a operação principal — só logam.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          usuarioId: entry.usuarioId ?? null,
          empresaId: entry.empresaId ?? null,
          acao: entry.acao,
          recurso: entry.recurso,
          recursoId: entry.recursoId ?? null,
          detalhes: entry.detalhes ?? Prisma.JsonNull,
          ip: entry.ip ?? null,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Falha ao gravar audit log: ${this.message(err)}`);
      });
  }

  /** Sobrecarga síncrona pra cenários raros onde precisamos esperar */
  async logSync(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          usuarioId: entry.usuarioId ?? null,
          empresaId: entry.empresaId ?? null,
          acao: entry.acao,
          recurso: entry.recurso,
          recursoId: entry.recursoId ?? null,
          detalhes: entry.detalhes ?? Prisma.JsonNull,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao gravar audit log: ${this.message(err)}`);
    }
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
