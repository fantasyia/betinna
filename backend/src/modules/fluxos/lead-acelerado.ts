import type { PrismaService } from '@database/prisma.service';
import type { Logger } from '@nestjs/common';

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

/** O lead tem esta etiqueta? Falha de consulta = não. */
async function temEtiqueta(
  prisma: Pick<PrismaService, 'lead'>,
  empresaId: string,
  leadId: unknown,
  nome: string,
): Promise<boolean> {
  if (typeof leadId !== 'string' || !leadId) return false;
  try {
    const n = await prisma.lead.count({
      where: {
        id: leadId,
        empresaId,
        tags: { some: { tag: { nome: { equals: nome, mode: 'insensitive' } } } },
      },
    });
    return n > 0;
  } catch {
    return false;
  }
}

/** O lead tem a etiqueta `teste-acelerado`? Falha de consulta = não (prazo normal). */
export function leadAcelerado(
  prisma: Pick<PrismaService, 'lead'>,
  empresaId: string,
  leadId: string | null | undefined,
): Promise<boolean> {
  return temEtiqueta(prisma, empresaId, leadId, TAG_TESTE_ACELERADO);
}

/**
 * Etiqueta `teste` (card cmvl673p6, 23/10): lead de teste do Meta. O barramento
 * não acende fluxo pra ele. Falha de consulta = não (o fluxo roda como sempre).
 */
export const TAG_LEAD_TESTE = 'teste';
export function leadDeTeste(
  prisma: Pick<PrismaService, 'lead'>,
  empresaId: string,
  leadId: unknown,
): Promise<boolean> {
  return temEtiqueta(prisma, empresaId, leadId, TAG_LEAD_TESTE);
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

// ─── Telefones de teste (Léo, 23/10) ─────────────────────────────────

/**
 * `Empresa.config.testeAcelerado.telefones`: lead NOVO com um desses números
 * nasce com a etiqueta `teste-acelerado`. Sem isto não dá pra acelerar o lead
 * que entra pelo formulário do Meta ou pelo WhatsApp — o fluxo dispara no
 * LEAD_CRIADO, antes de alguém conseguir etiquetar. Compara pelos 8 últimos
 * dígitos (regra D18 do resto do app). PURO.
 */
export function telefonesDeTeste(config: unknown): string[] {
  const t = ((config ?? {}) as { testeAcelerado?: { telefones?: unknown } }).testeAcelerado
    ?.telefones;
  if (!Array.isArray(t)) return [];
  return t
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\D/g, ''))
    .filter((x) => x.length >= 8);
}

export function ehTelefoneDeTeste(telefone: string | null | undefined, lista: string[]): boolean {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (d.length < 8) return false;
  return lista.some((t) => t.slice(-8) === d.slice(-8));
}

/**
 * Lead recém-criado com telefone de teste → etiqueta `teste-acelerado` (antes
 * de qualquer fluxo acender). Melhor esforço: erro vira log, o evento segue.
 */
export async function etiquetarSeTelefoneDeTeste(
  prisma: Pick<PrismaService, 'lead' | 'empresa' | 'tag' | 'leadTag'>,
  empresaId: string,
  leadId: unknown,
  logger?: Pick<Logger, 'log' | 'warn'>,
): Promise<void> {
  if (typeof leadId !== 'string' || !leadId) return;
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const lista = telefonesDeTeste(empresa?.config);
    if (lista.length === 0) return;
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { contatoTelefone: true },
    });
    if (!ehTelefoneDeTeste(lead?.contatoTelefone, lista)) return;
    const tag = await prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome: TAG_TESTE_ACELERADO } },
      create: { empresaId, nome: TAG_TESTE_ACELERADO, categoria: 'sistema' },
      update: {},
    });
    await prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId, tagId: tag.id } },
      create: { leadId, tagId: tag.id, origem: 'ia' },
      update: {},
    });
    logger?.log(`[teste-acelerado] lead ${leadId} nasceu com telefone de teste — etiquetado`);
  } catch (err) {
    logger?.warn(`[teste-acelerado] não etiquetou o lead ${leadId}: ${String(err)}`);
  }
}
