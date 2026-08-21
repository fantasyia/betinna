import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { RepScopeService } from '@shared/scope/rep-scope.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
  ) {}

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
    if (user.role === 'REP' || user.role === 'GERENTE') {
      convWhere.proprietarioId = user.id;
    } else {
      // Gestão/SAC: badge conta só a caixa da EMPRESA — as sessões pessoais dos
      // reps saíram da visão deles (mesma regra do baseWhere do Inbox).
      convWhere.OR = [{ canal: { not: 'WHATSAPP' } }, { proprietarioId: null }];
    }

    // Vendas: aprovações + cancelamentos pendentes.
    //
    // AUDITORIA (média): era `user.role !== 'REP'`, o que incluía o SAC. E o
    // RepScopeService devolve `null` (= SEM filtro) pro SAC, então ele via o
    // badge "vendas: N" da EMPRESA INTEIRA — de um módulo que a matriz de
    // permissões nem dá pra ele. Badge é isca: mostra número, o cara clica e
    // toma 403. Quem decide desconto/cancelamento é gerência.
    const podeAprovar = ['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role);
    // O badge tem que contar o que a LISTA do usuário mostra. Pro GERENTE a
    // lista é escopada pela carteira dele, mas o contador somava a empresa
    // inteira: ele via "12 pendentes" e abria a tela com 3.
    const scope = await this.repScope.getRepIds(user);
    const filtroCarteira =
      scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {};
    // Cancelamento é decidido por DIRECTOR/ADMIN (P6) — pro GERENTE conta só o
    // que ele mesmo solicitou/da carteira dele, pelo pedido.
    const filtroPedido =
      scope !== null
        ? { empresaId, representanteId: { in: scope.length ? scope : ['__none__'] } }
        : { empresaId };

    const [atendimento, aprovacoes, cancelamentos] = await Promise.all([
      this.prisma.conversation.count({ where: convWhere }),
      podeAprovar
        ? this.prisma.aprovacaoDesconto.count({
            where: { status: 'PENDENTE', pedido: { empresaId }, ...filtroCarteira },
          })
        : Promise.resolve(0),
      podeAprovar
        ? this.prisma.pedidoCancelamentoSolicitacao.count({
            where: { status: 'PENDENTE', pedido: filtroPedido },
          })
        : Promise.resolve(0),
    ]);

    return { vendas: aprovacoes + cancelamentos, atendimento };
  }
}
