import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

/**
 * Registro do histórico do board (o "Actions" do Trello).
 *
 * TODA operação do Kanban registra aqui (regra da spec) — é o que alimenta
 * o painel de atividade e o acompanhamento das sessões do Claude via MCP.
 * Falha no registro NÃO derruba a operação principal (best-effort + warn),
 * mesmo padrão do FluxoEventBusService.
 */
@Injectable()
export class KanbanAtividadeService {
  private readonly logger = new Logger(KanbanAtividadeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(params: {
    boardId: string;
    usuarioId: string;
    tipo: string;
    cardId?: string | null;
    dados?: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.prisma.kanbanAtividade.create({
        data: {
          boardId: params.boardId,
          usuarioId: params.usuarioId,
          tipo: params.tipo,
          cardId: params.cardId ?? null,
          dados: params.dados ?? {},
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao registrar atividade kanban "${params.tipo}": ${msg}`);
    }
  }
}
