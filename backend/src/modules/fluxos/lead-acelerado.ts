import type { PrismaService } from '@database/prisma.service';

/**
 * LEAD DE TESTE ACELERADO (Léo, 23/10): a bateria F01–F12 roda em PRODUÇÃO de
 * verdade — corrente entre fluxos, pararQuando, mensagens reais — mas sem esperar
 * os dias. Só pro lead com a etiqueta `teste-acelerado`: as esperas dos fluxos
 * (DELAY) e os prazos de resposta da conversa com IA encolhem 1.440× (1 dia vira
 * 1 minuto). Cliente real não tem a etiqueta e nada muda pra ele.
 *
 * Diferente do modo teste (`fluxos_testar`, `_teste`): aquele é execução de
 * teste isolada (sem corrente, sem pararQuando); este é produção com relógio curto.
 */
export const TAG_TESTE_ACELERADO = 'teste-acelerado';
/** 1 dia → 1 minuto. */
export const FATOR_ACELERADO = 1440;
/** Piso: o passo ainda passa pela fila (não vira "imediato"). */
export const MIN_ACELERADO_MS = 5_000;

/** Prazo encurtado (puro). */
export function prazoAcelerado(ms: number): number {
  return Math.max(MIN_ACELERADO_MS, Math.round(ms / FATOR_ACELERADO));
}

/** O lead tem a etiqueta `teste-acelerado`? Falha de consulta = não (prazo normal). */
export async function leadAcelerado(
  prisma: Pick<PrismaService, 'lead'>,
  empresaId: string,
  leadId: string | null | undefined,
): Promise<boolean> {
  if (!leadId) return false;
  try {
    const n = await prisma.lead.count({
      where: {
        id: leadId,
        empresaId,
        tags: { some: { tag: { nome: { equals: TAG_TESTE_ACELERADO, mode: 'insensitive' } } } },
      },
    });
    return n > 0;
  } catch {
    return false;
  }
}

/** Prazo do lead: o normal, ou o encurtado se ele é de teste acelerado. */
export async function prazoDoLead(
  prisma: Pick<PrismaService, 'lead'>,
  empresaId: string,
  leadId: string | null | undefined,
  ms: number,
): Promise<number> {
  return (await leadAcelerado(prisma, empresaId, leadId)) ? prazoAcelerado(ms) : ms;
}
