import { Injectable, Logger } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/** Limite (min) pra considerar uma conversa aguardando "fora do prazo". Casa com o selo do front. */
const SLA_MINUTOS = 120;
/** Janela do "tempo médio de 1ª resposta". */
const JANELA_DIAS = 30;

export interface MetricasAtendimento {
  conversas: {
    abertas: number;
    pendentes: number;
    resolvidas: number;
    arquivadas: number;
    total: number;
  };
  /** Snapshot AGORA: conversas com a última mensagem do cliente (aguardando resposta). */
  aguardando: { total: number; dentroDoPrazo: number; estourado: number; slaMinutos: number };
  /** Média (segundos) entre a 1ª pergunta do cliente e a 1ª resposta humana, últimos 30 dias. */
  tempoMedioPrimeiraRespostaSegundos: number | null;
  porAtendente: Array<{
    atendenteId: string | null;
    atendenteNome: string;
    abertas: number;
    aguardando: number;
  }>;
}

/**
 * #25 fatia 3 — KPIs de atendimento (painel gerencial do SAC). Sem coluna nova:
 * agrega por status, calcula o snapshot de SLA a partir da direção da última
 * mensagem, e o tempo médio de 1ª resposta via SQL agregado (janela 30d).
 */
@Injectable()
export class InboxMetricasService {
  private readonly logger = new Logger(InboxMetricasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async metricas(user: AuthenticatedUser): Promise<MetricasAtendimento> {
    const empresaId = user.empresaIdAtiva;
    if (!empresaId) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }

    const [porStatus, abertas, tempoMedio] = await Promise.all([
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: { empresaId },
        _count: { _all: true },
      }),
      this.prisma.conversation.findMany({
        where: { empresaId, status: { in: ['ABERTA', 'PENDENTE'] } },
        select: {
          id: true,
          ultimaMsgEm: true,
          atribuidoId: true,
          atribuido: { select: { nome: true } },
          mensagens: { take: 1, orderBy: { criadoEm: 'desc' }, select: { direction: true } },
        },
      }),
      this.tempoMedioPrimeiraResposta(empresaId),
    ]);

    // Contagem por status
    const cont = (s: string) => porStatus.find((p) => p.status === s)?._count._all ?? 0;
    const conversas = {
      abertas: cont('ABERTA'),
      pendentes: cont('PENDENTE'),
      resolvidas: cont('RESOLVIDA'),
      arquivadas: cont('ARQUIVADA'),
      total: porStatus.reduce((acc, p) => acc + p._count._all, 0),
    };

    // Snapshot de SLA + carga por atendente (a partir das conversas abertas)
    const agora = Date.now();
    const limiteMs = SLA_MINUTOS * 60_000;
    let aguardTotal = 0;
    let dentro = 0;
    let estourado = 0;

    type Acc = {
      atendenteId: string | null;
      atendenteNome: string;
      abertas: number;
      aguardando: number;
    };
    const porAtendenteMap = new Map<string, Acc>();

    for (const c of abertas) {
      const chave = c.atribuidoId ?? '__none__';
      const acc = porAtendenteMap.get(chave) ?? {
        atendenteId: c.atribuidoId,
        atendenteNome: c.atribuido?.nome ?? 'Não atribuído',
        abertas: 0,
        aguardando: 0,
      };
      acc.abertas += 1;

      const aguardandoResposta = c.mensagens[0]?.direction === MessageDirection.INBOUND;
      if (aguardandoResposta) {
        acc.aguardando += 1;
        aguardTotal += 1;
        const esperaMs = c.ultimaMsgEm ? agora - c.ultimaMsgEm.getTime() : 0;
        if (esperaMs > limiteMs) estourado += 1;
        else dentro += 1;
      }
      porAtendenteMap.set(chave, acc);
    }

    const porAtendente = [...porAtendenteMap.values()].sort((a, b) => b.aguardando - a.aguardando);

    return {
      conversas,
      aguardando: { total: aguardTotal, dentroDoPrazo: dentro, estourado, slaMinutos: SLA_MINUTOS },
      tempoMedioPrimeiraRespostaSegundos: tempoMedio,
      porAtendente,
    };
  }

  /**
   * Média (segundos) entre a 1ª mensagem do cliente e a 1ª resposta HUMANA
   * (não-bot) por conversa, nos últimos 30 dias. SQL agregado pra não puxar
   * mensagens em memória. Best-effort: erro → null (não derruba o painel).
   */
  private async tempoMedioPrimeiraResposta(empresaId: string): Promise<number | null> {
    const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000);
    try {
      const rows = await this.prisma.$queryRaw<Array<{ avg_segundos: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (primeira_resposta - primeira_pergunta)))::float8 AS avg_segundos
        FROM (
          SELECT
            c.id,
            MIN(m."criadoEm") FILTER (WHERE m.direction = 'INBOUND') AS primeira_pergunta,
            MIN(m."criadoEm") FILTER (WHERE m.direction = 'OUTBOUND' AND m."enviadaPorBot" = false) AS primeira_resposta
          FROM "Conversation" c
          JOIN "Message" m ON m."conversationId" = c.id
          WHERE c."empresaId" = ${empresaId} AND c."criadoEm" >= ${desde}
          GROUP BY c.id
        ) t
        WHERE t.primeira_resposta IS NOT NULL AND t.primeira_resposta > t.primeira_pergunta
      `;
      const avg = rows[0]?.avg_segundos;
      return avg != null ? Math.round(avg) : null;
    } catch (err) {
      this.logger.warn(
        `tempoMedioPrimeiraResposta falhou (empresa=${empresaId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
