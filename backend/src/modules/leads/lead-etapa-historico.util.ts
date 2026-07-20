import type { Logger } from '@nestjs/common';
import type { PrismaService } from '@database/prisma.service';

/**
 * Registro de transição de etapa — histórico IRREVERSÍVEL (transição não gravada
 * é transição perdida). Ponto ÚNICO chamado por TODA mudança de etapa: mover
 * manual (leads.moverEtapa/update + acaoMassa que reusa moverEtapa), fluxo
 * (MOVER_LEAD_ETAPA + LIBERAR_LOTE) e criação.
 *
 * É um HELPER puro (só Prisma) de propósito — leads e fluxos moram em módulos que
 * já têm dependência cruzada (bus); um Nest service compartilhado exigiria
 * forwardRef. Best-effort: falha aqui loga em ERROR mas NÃO derruba o move (o
 * move já commitou; abortar não desfaz e ainda quebraria a operação do usuário).
 */
export type OrigemMudancaEtapa = 'manual' | 'fluxo' | 'api' | 'criacao' | 'seed';

export interface TransicaoEtapa {
  empresaId: string;
  leadId: string;
  funilId?: string | null;
  /** funilEtapaId (ou enum legado) de origem. null = criação/entrada. */
  etapaOrigem?: string | null;
  /** funilEtapaId (ou enum legado) de destino. */
  etapaDestino?: string | null;
  /** userId que moveu; null = sistema/fluxo/cron. */
  quem?: string | null;
  origemMudanca: OrigemMudancaEtapa;
  ocorridoEm?: Date;
}

export async function registrarTransicaoEtapa(
  prisma: PrismaService,
  logger: Logger,
  t: TransicaoEtapa,
): Promise<void> {
  try {
    await prisma.leadEtapaHistorico.create({
      data: {
        empresaId: t.empresaId,
        leadId: t.leadId,
        funilId: t.funilId ?? null,
        etapaOrigem: t.etapaOrigem ?? null,
        etapaDestino: t.etapaDestino ?? null,
        quem: t.quem ?? null,
        origemMudanca: t.origemMudanca,
        ...(t.ocorridoEm ? { ocorridoEm: t.ocorridoEm } : {}),
      },
    });
  } catch (err) {
    // Irreversível → loga ALTO (não só warn) pra virar alerta se começar a falhar.
    logger.error(
      `Falha ao registrar histórico de etapa (lead ${t.leadId}, ${t.etapaOrigem ?? '∅'}→${t.etapaDestino ?? '∅'}): ${String(err)}`,
    );
  }
}
