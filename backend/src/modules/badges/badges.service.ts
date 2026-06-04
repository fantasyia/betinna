import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

export interface BadgeCounts {
  /** Vendas: aprovações de desconto + solicitações de cancelamento pendentes. */
  vendas: number;
  /** Atendimento: conversas que realmente precisam de um humano (precisaHumano).
   *  Antes contava todo PENDENTE — inflava (99+) porque conversa não saía de
   *  PENDENTE quando o bot respondia. */
  atendimento: number;
}

/**
 * F5 (Lote 8) — Contadores de "novidade" pros badges do menu.
 *
 * Counts leves, escopados pela empresa ativa. REP só conta o que é dele
 * (conversas do próprio WhatsApp) e não vê aprovações (não aprova).
 */
@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBadges(user: AuthenticatedUser): Promise<BadgeCounts> {
    const empresaId = user.empresaIdAtiva;
    if (!empresaId) return { vendas: 0, atendimento: 0 };

    // Atendimento: conversas que precisam de HUMANO (bot caiu no fallback /
    // escalou). Não conta as que o bot já respondeu. REP vê só as suas.
    const convWhere: Prisma.ConversationWhereInput = {
      empresaId,
      precisaHumano: true,
      status: { notIn: ['RESOLVIDA', 'ARQUIVADA'] },
    };
    if (user.role === 'REP') convWhere.proprietarioId = user.id;

    // Vendas: aprovações + cancelamentos pendentes. REP não aprova → 0.
    const podeAprovar = user.role !== 'REP';

    const [atendimento, aprovacoes, cancelamentos] = await Promise.all([
      this.prisma.conversation.count({ where: convWhere }),
      podeAprovar
        ? this.prisma.aprovacaoDesconto.count({
            where: { status: 'PENDENTE', pedido: { empresaId } },
          })
        : Promise.resolve(0),
      podeAprovar
        ? this.prisma.pedidoCancelamentoSolicitacao.count({
            where: { status: 'PENDENTE', pedido: { empresaId } },
          })
        : Promise.resolve(0),
    ]);

    return { vendas: aprovacoes + cancelamentos, atendimento };
  }
}
