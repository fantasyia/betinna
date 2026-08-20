import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunisService } from './funis.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * O que o REPRESENTANTE enxerga na lista de funis.
 *
 * Antes vinham TODOS os funis da empresa: a triagem bruta do SAC, a nutrição de
 * e-mail marketing e o funil de RECRUTAMENTO DE REPS — a esteira em que o
 * próprio rep foi captado, com os concorrentes dele dentro. E a contagem de
 * leads por etapa era da empresa inteira, o que entrega o tamanho do pipeline
 * de todo mundo.
 */
const usuario = (role: string): AuthenticatedUser =>
  ({ id: 'u1', role, empresaIdAtiva: 'emp-1' }) as AuthenticatedUser;

const FUNIS = [
  { id: 'f1', nome: 'Clientes - Canal Reps', visivelParaRep: true, etapas: [{ id: 'e1' }] },
  { id: 'f2', nome: 'Prospecção Reps', visivelParaRep: false, etapas: [{ id: 'e2' }] },
];

function makeService(escopo: string[] | null) {
  const prisma = {
    funil: {
      findMany: vi.fn().mockResolvedValue(FUNIS),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    lead: { groupBy: vi.fn().mockResolvedValue([]) },
    fluxoNo: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const repScope = { getRepIds: vi.fn().mockResolvedValue(escopo) };
  return { svc: new FunisService(prisma as never, repScope as never), prisma };
}

describe('FunisService.list — visibilidade por papel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('REP: só funil marcado como visível pra ele', async () => {
    const { svc, prisma } = makeService(['u1']);

    await svc.list(usuario('REP'));

    const where = (prisma.funil.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where.visivelParaRep).toBe(true);
  });

  it('gestão (ADMIN/DIRECTOR/GERENTE/SAC) continua vendo tudo', async () => {
    for (const role of ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC']) {
      const { svc, prisma } = makeService(null);
      await svc.list(usuario(role));
      const where = (prisma.funil.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
        .where;
      expect(where.visivelParaRep).toBeUndefined();
    }
  });

  it('a CONTAGEM de leads respeita a carteira do rep', async () => {
    // Sem isso o rep via quantos leads existem em cada etapa da empresa inteira
    // — o nome do funil é o menor dos problemas.
    const { svc, prisma } = makeService(['rep-1']);

    await svc.list(usuario('REP'));

    const where = (prisma.lead.groupBy.mock.calls[0][0] as { where: Record<string, unknown> })
      .where as { representanteId?: { in: string[] } };
    expect(where.representanteId?.in).toEqual(['rep-1']);
  });

  it('gestão conta sem filtro de carteira (vê o total mesmo)', async () => {
    const { svc, prisma } = makeService(null);

    await svc.list(usuario('DIRECTOR'));

    const where = (prisma.lead.groupBy.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where.representanteId).toBeUndefined();
  });
});

describe('FunisService.findById — a porta lateral', () => {
  beforeEach(() => vi.clearAllMocks());

  it('REP abrindo funil pela URL cai no MESMO filtro', async () => {
    // Esconder só na listagem seria decoração: bastava colar o id na URL.
    const { svc, prisma } = makeService(['u1']);

    await svc.findById(usuario('REP'), 'f2').catch(() => undefined);

    const where = (prisma.funil.findFirst.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where.visivelParaRep).toBe(true);
  });
});
