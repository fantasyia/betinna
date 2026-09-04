import { describe, expect, it, vi } from 'vitest';
import { LeadEtapaSistemaService } from './lead-etapa-sistema.service';

const ETAPAS = {
  propostaEnviada: 'et-1',
  propostaAssinada: 'et-2',
  contratoAssinado: 'et-3',
  instalacao: 'et-4',
};
const ORDEM: Record<string, number> = { 'et-1': 2, 'et-2': 3, 'et-3': 4, 'et-4': 5 };

/**
 * Prisma de mentira com só o que este serviço toca. `leadEm` é a etapa onde o
 * lead está agora — é o que muda de caso pra caso.
 */
const prismaFake = (leadEm: string | null, cfg: Record<string, string> = ETAPAS) => ({
  empresa: { findUnique: vi.fn(async () => ({ config: { funilEtapas: cfg } })) },
  funilEtapa: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      ORDEM[where.id]
        ? { id: where.id, funilId: 'f1', tipo: 'ATIVA', ordem: ORDEM[where.id] }
        : null,
    ),
  },
  lead: {
    findFirst: vi.fn(async () => ({
      funilEtapaId: leadEm,
      funilEtapa: leadEm ? { funilId: 'f1', ordem: ORDEM[leadEm] } : null,
    })),
    findMany: vi.fn(async () => [{ id: 'lead-1' }]),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  conversation: { findFirst: vi.fn(async () => null) },
  leadEtapaHistorico: { create: vi.fn(async () => ({})) },
});

const busFake = () => ({ disparar: vi.fn(async () => undefined) });

const svc = (prisma: ReturnType<typeof prismaFake>, bus = busFake()) =>
  ({ s: new LeadEtapaSistemaService(prisma as never, bus as never), bus }) as const;

describe('LeadEtapaSistemaService', () => {
  it('move, grava o histórico como webhook e dispara LEAD_ETAPA_MUDOU', async () => {
    const prisma = prismaFake('et-2');
    const { s, bus } = svc(prisma);
    const r = await s.mover({
      empresaId: 'e1',
      leadId: 'lead-1',
      marco: 'contratoAssinado',
      origem: 'webhook',
      motivo: 'teste',
    });
    expect(r).toBe('movido');
    expect(prisma.lead.updateMany).toHaveBeenCalledOnce();
    expect(prisma.leadEtapaHistorico.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ origemMudanca: 'webhook', etapaDestino: 'et-3' }),
      }),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'e1',
      'LEAD_ETAPA_MUDOU',
      expect.objectContaining({ leadId: 'lead-1', paraFunilEtapaId: 'et-3' }),
    );
  });

  it('no-op quando o lead já está na etapa — webhook repetido não re-dispara', async () => {
    const prisma = prismaFake('et-3');
    const { s, bus } = svc(prisma);
    const r = await s.mover({
      empresaId: 'e1',
      leadId: 'lead-1',
      marco: 'contratoAssinado',
      origem: 'webhook',
      motivo: 'teste',
    });
    expect(r).toBe('ja-estava');
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('NÃO volta o lead pra uma etapa anterior', async () => {
    const prisma = prismaFake('et-3');
    const { s, bus } = svc(prisma);
    const r = await s.mover({
      empresaId: 'e1',
      leadId: 'lead-1',
      marco: 'propostaAssinada',
      origem: 'webhook',
      motivo: 'webhook fora de ordem',
    });
    expect(r).toBe('nao-retrocede');
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('com somenteDe, só move a partir da etapa exigida', async () => {
    const parado = prismaFake('et-2');
    const r1 = await svc(parado).s.mover({
      empresaId: 'e1',
      leadId: 'lead-1',
      marco: 'instalacao',
      somenteDe: 'contratoAssinado',
      origem: 'erp',
      motivo: 'NF de outro contrato',
    });
    expect(r1).toBe('fora-do-momento');
    expect(parado.lead.updateMany).not.toHaveBeenCalled();

    const pronto = prismaFake('et-3');
    const r2 = await svc(pronto).s.mover({
      empresaId: 'e1',
      leadId: 'lead-1',
      marco: 'instalacao',
      somenteDe: 'contratoAssinado',
      origem: 'erp',
      motivo: 'NF da primeira mensalidade',
    });
    expect(r2).toBe('movido');
  });

  it('tenant sem o marco configurado não move nada', async () => {
    const prisma = prismaFake('et-2', {});
    const { s, bus } = svc(prisma);
    const r = await s.mover({
      empresaId: 'e1',
      leadId: 'lead-1',
      marco: 'contratoAssinado',
      origem: 'webhook',
      motivo: 'teste',
    });
    expect(r).toBe('nao-configurado');
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('resolve o lead pelo cliente quando só o cliente é conhecido', async () => {
    const prisma = prismaFake('et-1');
    const { s } = svc(prisma);
    const r = await s.mover({
      empresaId: 'e1',
      clienteId: 'cli-1',
      marco: 'propostaAssinada',
      origem: 'webhook',
      motivo: 'aceite',
    });
    expect(r).toBe('movido');
    expect(prisma.lead.findMany).toHaveBeenCalledOnce();
  });
});
